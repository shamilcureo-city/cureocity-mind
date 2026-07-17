import type {
  PlanDictationV1,
  PlanEditChange,
  RxFollowUp,
  RxMedRow,
  RxPadDraft,
  RxPadPatchOp,
} from '@cureocity/contracts';
import { checkInteractions, formatInteraction } from './interactions';

/**
 * Sprint DS12 — resolve the plan-dictation pass's edit commands against the
 * CURRENT Rx pad into a reviewable diff of ready-to-apply `RxPadPatchOp`s.
 *
 * Deterministic and pure — the LLM proposes, this resolves, the doctor
 * approves. Resolution rules:
 *   - Targets match pad rows case-insensitively; a unique substring match
 *     (doctor says "ECG", pad says "12-lead ECG") also resolves. An
 *     ambiguous match becomes a clarification, never a guess.
 *   - `changeMed` merges the provided fields over the existing row and maps
 *     to remove + re-add (the pad has no in-place edit op). Changing a drug
 *     that isn't on the pad downgrades to an add — the intent is clearly
 *     "this should be prescribed".
 *   - `addMed` for a drug already on the pad upgrades to a change (the
 *     intent is clearly "make it read like this").
 *   - Removals of rows that don't exist are reported in `skipped`, never
 *     silently dropped.
 *   - Each change carries the NEW interaction warnings it would introduce
 *     (computed against the pad as it would look after ALL proposed
 *     changes), so the doctor sees the clash in the diff — before the
 *     server recomputes authoritative warnings on apply.
 */

export interface PlanEditProposal {
  changes: PlanEditChange[];
  clarifications: string[];
  skipped: string[];
}

const norm = (s: string): string => s.trim().toLowerCase();
const eq = (a: string, b: string): boolean => norm(a) === norm(b);

/** Exact match first; then a UNIQUE substring match; else null / 'ambiguous'. */
function resolveTarget<T>(
  items: T[],
  labelOf: (item: T) => string,
  target: string,
): { kind: 'found'; item: T } | { kind: 'ambiguous'; labels: string[] } | { kind: 'missing' } {
  const exact = items.filter((i) => eq(labelOf(i), target));
  if (exact.length === 1) return { kind: 'found', item: exact[0]! };
  if (exact.length > 1) return { kind: 'ambiguous', labels: exact.map(labelOf) };
  const t = norm(target);
  const fuzzy = items.filter((i) => {
    const l = norm(labelOf(i));
    return l.includes(t) || t.includes(l);
  });
  if (fuzzy.length === 1) return { kind: 'found', item: fuzzy[0]! };
  if (fuzzy.length > 1) return { kind: 'ambiguous', labels: fuzzy.map(labelOf) };
  return { kind: 'missing' };
}

type MedFields = {
  drug: string;
  strength?: string;
  dose?: string;
  frequency?: string;
  timing?: string;
  durationDays?: number;
  route?: string;
};

function describeMed(m: MedFields): string {
  return [
    m.drug,
    m.strength,
    m.dose,
    m.frequency,
    m.timing,
    m.durationDays !== undefined ? `${m.durationDays} days` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

function medFieldsOf(row: RxMedRow): MedFields {
  return {
    drug: row.drug,
    ...(row.strength !== undefined && { strength: row.strength }),
    ...(row.dose !== undefined && { dose: row.dose }),
    ...(row.frequency !== undefined && { frequency: row.frequency }),
    ...(row.timing !== undefined && { timing: row.timing }),
    ...(row.durationDays !== undefined && { durationDays: row.durationDays }),
    ...(row.route !== undefined && { route: row.route }),
  };
}

function describeFollowUp(f: RxFollowUp): string {
  return [f.when, f.withWhat].filter(Boolean).join(' · ');
}

export function proposePlanEdits(
  pad: RxPadDraft | null,
  dictation: PlanDictationV1,
): PlanEditProposal {
  const meds = pad?.meds ?? [];
  const investigations = pad?.investigations ?? [];
  const adviceLines = pad?.adviceLines ?? [];
  const followUp = pad?.followUp;

  const changes: PlanEditChange[] = [];
  const clarifications = [...dictation.clarifications];
  const skipped: string[] = [];

  // Track the med list as it would look after the proposed changes, so the
  // interaction preview reflects the whole instruction (an added statin can
  // clash with an added macrolide from the same sentence).
  const futureDrugs = new Map<string, string>(meds.map((m) => [norm(m.drug), m.drug]));
  // Which change introduced each future drug — for attaching new warnings.
  const drugChangeIndex = new Map<string, number>();

  for (const edit of dictation.edits) {
    switch (edit.action) {
      case 'addMed':
      case 'changeMed': {
        const resolved = resolveTarget(meds, (m) => m.drug, edit.drug);
        if (resolved.kind === 'ambiguous') {
          clarifications.push(
            `“${edit.drug}” matches more than one medicine on the pad (${resolved.labels.join(
              ', ',
            )}) — say which one.`,
          );
          break;
        }
        const { action: _action, ...provided } = edit;
        if (resolved.kind === 'found') {
          const row = resolved.item;
          const merged: MedFields = { ...medFieldsOf(row), ...provided, drug: row.drug };
          const before = describeMed(medFieldsOf(row));
          const after = describeMed(merged);
          if (before === after) {
            skipped.push(`${row.drug} already reads “${before}” — nothing to change.`);
            break;
          }
          changes.push({
            kind: 'change',
            target: 'med',
            label: after,
            before,
            after,
            warnings: [],
            ops: [
              { op: 'removeMed', drug: row.drug },
              { op: 'addMed', source: 'dictated', med: merged },
            ],
          });
          drugChangeIndex.set(norm(row.drug), changes.length - 1);
        } else {
          const med: MedFields = { ...provided, drug: edit.drug };
          changes.push({
            kind: 'add',
            target: 'med',
            label: describeMed(med),
            after: describeMed(med),
            warnings: [],
            ops: [{ op: 'addMed', source: 'dictated', med }],
          });
          futureDrugs.set(norm(edit.drug), edit.drug);
          drugChangeIndex.set(norm(edit.drug), changes.length - 1);
        }
        break;
      }
      case 'removeMed': {
        const resolved = resolveTarget(meds, (m) => m.drug, edit.drug);
        if (resolved.kind === 'missing') {
          skipped.push(`${edit.drug} isn’t on the pad — nothing to remove.`);
          break;
        }
        if (resolved.kind === 'ambiguous') {
          clarifications.push(
            `“${edit.drug}” matches more than one medicine on the pad (${resolved.labels.join(
              ', ',
            )}) — say which one.`,
          );
          break;
        }
        const row = resolved.item;
        changes.push({
          kind: 'remove',
          target: 'med',
          label: row.drug,
          before: describeMed(medFieldsOf(row)),
          warnings: [],
          ops: [{ op: 'removeMed', drug: row.drug }],
        });
        futureDrugs.delete(norm(row.drug));
        break;
      }
      case 'addInvestigation': {
        const resolved = resolveTarget(investigations, (i) => i.name, edit.name);
        if (resolved.kind === 'found') {
          skipped.push(`${resolved.item.name} is already on the pad.`);
          break;
        }
        changes.push({
          kind: 'add',
          target: 'investigation',
          label: edit.name,
          after: edit.name,
          warnings: [],
          ops: [
            {
              op: 'addInvestigation',
              source: 'dictated',
              name: edit.name,
              ...(edit.rationale !== undefined && { rationale: edit.rationale }),
            },
          ],
        });
        break;
      }
      case 'removeInvestigation': {
        const resolved = resolveTarget(investigations, (i) => i.name, edit.name);
        if (resolved.kind === 'missing') {
          skipped.push(`${edit.name} isn’t on the pad — nothing to remove.`);
          break;
        }
        if (resolved.kind === 'ambiguous') {
          clarifications.push(
            `“${edit.name}” matches more than one test (${resolved.labels.join(
              ', ',
            )}) — say which one.`,
          );
          break;
        }
        changes.push({
          kind: 'remove',
          target: 'investigation',
          label: resolved.item.name,
          before: resolved.item.name,
          warnings: [],
          ops: [{ op: 'removeInvestigation', name: resolved.item.name }],
        });
        break;
      }
      case 'addAdvice': {
        if (adviceLines.some((a) => eq(a, edit.text))) {
          skipped.push(`The advice “${edit.text}” is already on the pad.`);
          break;
        }
        changes.push({
          kind: 'add',
          target: 'advice',
          label: edit.text,
          after: edit.text,
          warnings: [],
          ops: [{ op: 'addAdvice', source: 'dictated', text: edit.text }],
        });
        break;
      }
      case 'removeAdvice': {
        const resolved = resolveTarget(adviceLines, (a) => a, edit.text);
        if (resolved.kind === 'missing') {
          skipped.push(`No advice line matches “${edit.text}”.`);
          break;
        }
        if (resolved.kind === 'ambiguous') {
          clarifications.push(`“${edit.text}” matches more than one advice line — say which one.`);
          break;
        }
        changes.push({
          kind: 'remove',
          target: 'advice',
          label: resolved.item,
          before: resolved.item,
          warnings: [],
          ops: [{ op: 'removeAdvice', text: resolved.item }],
        });
        break;
      }
      case 'setFollowUp': {
        const after = describeFollowUp({
          when: edit.when,
          ...(edit.withWhat !== undefined && { withWhat: edit.withWhat }),
        });
        if (followUp && describeFollowUp(followUp) === after) {
          skipped.push(`Follow-up is already “${after}”.`);
          break;
        }
        changes.push({
          kind: followUp ? 'change' : 'add',
          target: 'followUp',
          label: after,
          ...(followUp && { before: describeFollowUp(followUp) }),
          after,
          warnings: [],
          ops: [
            {
              op: 'setFollowUp',
              source: 'dictated',
              when: edit.when,
              ...(edit.withWhat !== undefined && { withWhat: edit.withWhat }),
            },
          ],
        });
        break;
      }
      case 'clearFollowUp': {
        if (!followUp) {
          skipped.push('No follow-up is set — nothing to clear.');
          break;
        }
        changes.push({
          kind: 'remove',
          target: 'followUp',
          label: describeFollowUp(followUp),
          before: describeFollowUp(followUp),
          warnings: [],
          ops: [{ op: 'clearFollowUp' }],
        });
        break;
      }
    }
  }

  // Interaction preview: which warnings exist AFTER the proposal that don't
  // exist today? Attach each to the change that introduced its drug. The
  // server remains the authority — it recomputes on apply.
  const beforeMessages = new Set(checkInteractions(meds.map((m) => m.drug)).map(formatInteraction));
  for (const interaction of checkInteractions([...futureDrugs.values()])) {
    const message = formatInteraction(interaction);
    if (beforeMessages.has(message)) continue;
    for (const drugKey of [interaction.drugA, interaction.drugB].map(norm)) {
      for (const [futureKey, idx] of drugChangeIndex) {
        if (!futureKey.includes(drugKey) && !drugKey.includes(futureKey)) continue;
        const change = changes[idx]!;
        if (!change.warnings.includes(message)) change.warnings.push(message);
      }
    }
  }

  return { changes, clarifications, skipped };
}
