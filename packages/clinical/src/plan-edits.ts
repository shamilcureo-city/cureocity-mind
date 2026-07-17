import type {
  PlanDictationV1,
  PlanEditChange,
  RxFollowUp,
  RxMedRow,
  RxPadDraft,
  RxRowSource,
  RxRowStatus,
} from '@cureocity/contracts';
import { interactionWarningsByDrug } from './interactions';

/**
 * Sprint DS12 — resolve the plan-dictation pass's edit commands against the
 * CURRENT Rx pad into a reviewable diff of ready-to-apply `RxPadPatchOp`s.
 *
 * Deterministic and pure — the LLM proposes, this resolves, the doctor
 * approves. Resolution rules:
 *   - Med targets resolve against a RUNNING view of the pad, so several
 *     edits to the same drug in one instruction compose into ONE diff line
 *     instead of clobbering each other.
 *   - Targets match case-insensitively; a unique substring match (doctor
 *     says "ECG", pad says "12-lead ECG") also resolves. An ambiguous match
 *     becomes a clarification, never a guess.
 *   - `changeMed` merges the provided fields over the existing row and maps
 *     to remove + re-add (the pad has no in-place edit op). A change to a
 *     PENDING (not-yet-confirmed) row appends `unconfirmMed` so the edit can
 *     never silently prescribe — and the diff line says so. Changing a drug
 *     that isn't on the pad downgrades to an add.
 *   - `addMed` for a drug already on the pad upgrades to a change (the
 *     intent is clearly "make it read like this").
 *   - A continued (carried-forward) med keeps its badge through a change.
 *   - Removals of rows that don't exist are reported in `skipped`, never
 *     silently dropped.
 *   - Each change carries the NEW interaction warnings it would introduce,
 *     computed per drug via interactionWarningsByDrug so brand names
 *     (Ecosprin → Aspirin) still land on the right diff line. The server
 *     recomputes authoritative warnings on apply.
 */

export interface PlanEditProposal {
  changes: PlanEditChange[];
  clarifications: string[];
  skipped: string[];
}

const norm = (s: string): string => s.trim().toLowerCase();
const eq = (a: string, b: string): boolean => norm(a) === norm(b);

/** Exact match first; then a UNIQUE substring match; else missing. */
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

/** The running (post-edits-so-far) view of one med on the pad. */
interface WorkingMed {
  fields: MedFields;
  status: RxRowStatus;
  continued: boolean;
  source?: RxRowSource;
  /** Whether the drug was on the pad BEFORE this instruction. */
  onPad: boolean;
  /** The original row, when onPad. */
  original?: RxMedRow;
  /** Index of the diff line currently representing this drug, if any. */
  changeIdx?: number;
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
  const deadChangeIdx = new Set<number>();
  const clarifications = [...dictation.clarifications];
  const skipped: string[] = [];

  const working = new Map<string, WorkingMed>(
    meds.map((m) => [
      norm(m.drug),
      {
        fields: medFieldsOf(m),
        status: m.status,
        continued: m.continued,
        ...(m.source !== undefined && { source: m.source }),
        onPad: true,
        original: m,
      },
    ]),
  );

  /** Rebuild the ops + labels for a drug's diff line from its working state. */
  function medChangeFor(w: WorkingMed): PlanEditChange {
    const after = describeMed(w.fields);
    // A change to a pending row keeps it pending — and the doctor sees it.
    const staysPending = w.onPad && w.status === 'pending';
    const afterLabel = staysPending ? `${after} · stays pending confirm` : after;
    if (w.onPad) {
      const original = w.original!;
      return {
        kind: 'change',
        target: 'med',
        label: afterLabel,
        before: describeMed(medFieldsOf(original)),
        after: afterLabel,
        warnings: [],
        ops: [
          { op: 'removeMed', drug: original.drug },
          {
            op: 'addMed',
            source: 'dictated',
            med: { ...w.fields, ...(w.continued && { continued: true }) },
          },
          ...(staysPending ? ([{ op: 'unconfirmMed', drug: w.fields.drug }] as const) : []),
        ],
      };
    }
    return {
      kind: 'add',
      target: 'med',
      label: after,
      after,
      warnings: [],
      ops: [{ op: 'addMed', source: 'dictated', med: { ...w.fields } }],
    };
  }

  function upsertMedChange(key: string, w: WorkingMed): void {
    const change = medChangeFor(w);
    if (w.changeIdx !== undefined) {
      changes[w.changeIdx] = change;
    } else {
      changes.push(change);
      w.changeIdx = changes.length - 1;
    }
    working.set(key, w);
  }

  for (const edit of dictation.edits) {
    switch (edit.action) {
      case 'addMed':
      case 'changeMed': {
        const entries = [...working.entries()];
        const resolved = resolveTarget(entries, ([, w]) => w.fields.drug, edit.drug);
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
          const [key, w] = resolved.item;
          const merged: MedFields = { ...w.fields, ...provided, drug: w.fields.drug };
          if (describeMed(merged) === describeMed(w.fields) && w.changeIdx === undefined) {
            skipped.push(
              `${w.fields.drug} already reads “${describeMed(w.fields)}” — nothing to change.`,
            );
            break;
          }
          w.fields = merged;
          upsertMedChange(key, w);
        } else {
          const key = norm(edit.drug);
          const w: WorkingMed = {
            fields: { ...provided, drug: edit.drug },
            // The reviewed add IS the prescribing decision (same as a manual add).
            status: 'confirmed',
            continued: false,
            onPad: false,
          };
          upsertMedChange(key, w);
        }
        break;
      }
      case 'removeMed': {
        const entries = [...working.entries()];
        const resolved = resolveTarget(entries, ([, w]) => w.fields.drug, edit.drug);
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
        const [key, w] = resolved.item;
        if (!w.onPad) {
          // Added earlier in this same instruction, then removed — net nothing.
          if (w.changeIdx !== undefined) deadChangeIdx.add(w.changeIdx);
          working.delete(key);
          skipped.push(`${w.fields.drug} was added and then removed — no change.`);
          break;
        }
        const original = w.original!;
        const removeLine: PlanEditChange = {
          kind: 'remove',
          target: 'med',
          label: original.drug,
          before: describeMed(medFieldsOf(original)),
          warnings: [],
          ops: [{ op: 'removeMed', drug: original.drug }],
        };
        if (w.changeIdx !== undefined) {
          changes[w.changeIdx] = removeLine;
        } else {
          changes.push(removeLine);
        }
        working.delete(key);
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

  // Interaction preview — per drug, so brand names resolve inside the
  // engine and the comparison is between IDENTICAL raw strings. A line is
  // NEW when the same drug didn't already carry it on the current pad.
  // The server remains the authority — it recomputes on apply.
  const beforeByDrug = new Map<string, Set<string>>();
  const currentDrugs = meds.map((m) => m.drug);
  interactionWarningsByDrug(currentDrugs).forEach((lines, i) => {
    beforeByDrug.set(norm(currentDrugs[i]!), new Set(lines));
  });
  const futureEntries = [...working.values()];
  interactionWarningsByDrug(futureEntries.map((w) => w.fields.drug)).forEach((lines, i) => {
    const w = futureEntries[i]!;
    if (w.changeIdx === undefined || deadChangeIdx.has(w.changeIdx)) return;
    const before = beforeByDrug.get(norm(w.fields.drug));
    const change = changes[w.changeIdx]!;
    for (const line of lines) {
      if (before?.has(line)) continue;
      if (!change.warnings.includes(line)) change.warnings.push(line);
    }
  });

  return {
    changes: changes.filter((_, i) => !deadChangeIdx.has(i)),
    clarifications,
    skipped,
  };
}
