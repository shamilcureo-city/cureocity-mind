import type { Prisma } from '@prisma/client';
import { ClinicalReportV1Schema, InitialAssessmentBriefV1Schema } from '@cureocity/contracts';
import { writeAudit } from './audit';
import { prisma } from './prisma';

type AssessmentItemDatabase = Pick<
  Prisma.TransactionClient,
  'treatmentEpisode' | 'assessmentItem' | 'session'
>;

/**
 * Sprint 22 — reconcile Pass 3 output into the running differential.
 *
 * Pass 3 (clinical analysis / initial assessment) emits the diagnostic
 * questions to ask next — `assessmentGaps` (cross-candidate) and each
 * candidate's `gapsToFill` (criteria to confirm THAT candidate). Until
 * now these were regenerated + discarded every session. This turns them
 * into persistent `AssessmentItem` rows that carry forward and close
 * over sessions.
 *
 * Dedup is scoped to the current episode and clinical identity, including
 * CLOSED items. Rewording a rationale is not evidence to overturn a clinician's
 * resolution. Clinicians can explicitly reopen an existing item when new
 * information warrants reassessment. A different question/diagnostic target
 * or a new episode is eligible; a fresh safety question from a later session
 * is always eligible after closure, without rewriting the old resolution.
 */

interface ReconcileArgs {
  clientId: string;
  psychologistId: string;
  sourceSessionId: string;
  /** Opaque Pass 3 body — InitialAssessmentBriefV1 or ClinicalReportV1. */
  pass3Body: unknown;
  kind: 'INTAKE' | 'TREATMENT' | 'REVIEW';
}

interface CandidateItem {
  kind: 'DIAGNOSTIC_CRITERION' | 'ASSESSMENT_GAP' | 'SAFETY';
  question: string;
  rationale: string;
  icd11Code: string | null;
}

/** Normalise question text for dedup — lowercase, collapse whitespace, strip trailing punctuation. */
function normalise(q: string): string {
  return q
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.?!]+$/, '');
}

function candidateIdentity(item: Pick<CandidateItem, 'question' | 'kind' | 'icd11Code'>): string {
  return JSON.stringify([
    normalise(item.question),
    item.kind,
    item.icd11Code?.trim().toUpperCase() ?? null,
  ]);
}

export function assessmentCandidateAlreadyTracked(
  candidate: CandidateItem,
  existing: Array<{
    kind: string;
    question: string;
    icd11Code: string | null;
    status: string;
    sourceSessionId: string | null;
    addressedSessionId: string | null;
  }>,
  sourceSessionId: string,
): boolean {
  return existing.some((item) => {
    const sameIdentity =
      candidateIdentity(candidate) ===
      candidateIdentity({
        ...item,
        kind: item.kind as CandidateItem['kind'],
      });
    // Safety semantics must survive legacy gaps that were stored as generic
    // assessment questions. An already-open matching question avoids duplication;
    // a closed one must not silence a new session's safety concern.
    const sameSafetyQuestion =
      candidate.kind === 'SAFETY' && normalise(candidate.question) === normalise(item.question);
    if (!sameIdentity && !sameSafetyQuestion) return false;
    if (item.status !== 'CLOSED') return true;
    if (candidate.kind !== 'SAFETY') return true;
    return item.sourceSessionId === sourceSessionId || item.addressedSessionId === sourceSessionId;
  });
}

export async function reconcileAssessmentItems(
  args: ReconcileArgs,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const db: AssessmentItemDatabase = tx ?? prisma;
  const candidates = extractCandidates(args.pass3Body, args.kind);
  if (candidates.length === 0) return;

  // Resolve the client's open episode so new items group correctly.
  const openEpisode = await db.treatmentEpisode.findFirst({
    where: { clientId: args.clientId, psychologistId: args.psychologistId, status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
    select: { id: true, openedAt: true },
  });

  const source = await db.session.findFirst({
    where: {
      id: args.sourceSessionId,
      clientId: args.clientId,
      psychologistId: args.psychologistId,
    },
    select: { startedAt: true, endedAt: true, scheduledAt: true },
  });
  if (!source) return;
  const sourceAt = source.startedAt ?? source.endedAt ?? source.scheduledAt;
  // A late re-run of an older episode must not seed the new episode's ledger.
  if (openEpisode && sourceAt < openEpisode.openedAt) return;

  // Legacy null-episode rows are considered only for legacy clients without
  // an open episode; old episode resolutions cannot block a new assessment.
  const existing = await db.assessmentItem.findMany({
    where: {
      clientId: args.clientId,
      psychologistId: args.psychologistId,
      episodeId: openEpisode?.id ?? null,
    },
    select: {
      kind: true,
      question: true,
      icd11Code: true,
      status: true,
      sourceSessionId: true,
      addressedSessionId: true,
    },
  });
  const seen = new Set<string>();

  for (const c of candidates) {
    const key = candidateIdentity(c);
    if (seen.has(key)) continue;
    seen.add(key);
    if (assessmentCandidateAlreadyTracked(c, existing, args.sourceSessionId)) continue;
    const created = await db.assessmentItem.create({
      data: {
        clientId: args.clientId,
        psychologistId: args.psychologistId,
        episodeId: openEpisode?.id ?? null,
        kind: c.kind,
        question: c.question,
        rationale: c.rationale,
        icd11Code: c.icd11Code,
        status: 'OPEN',
        sourceSessionId: args.sourceSessionId,
      },
    });
    await writeAudit(
      {
        actorType: 'SYSTEM',
        action: 'ASSESSMENT_ITEM_CREATED',
        targetType: 'AssessmentItem',
        targetId: created.id,
        metadata: {
          clientId: args.clientId,
          sourceSessionId: args.sourceSessionId,
          kind: c.kind,
          icd11Code: c.icd11Code,
        },
      },
      tx,
    );
  }
}

function extractCandidates(body: unknown, kind: ReconcileArgs['kind']): CandidateItem[] {
  const out: CandidateItem[] = [];
  if (kind === 'INTAKE') {
    const parsed = InitialAssessmentBriefV1Schema.safeParse(body);
    if (!parsed.success) return out;
    const brief = parsed.data;
    for (const gap of brief.assessmentGaps) {
      out.push({
        kind: gap.purpose === 'safety' ? 'SAFETY' : 'ASSESSMENT_GAP',
        question: gap.question,
        rationale: gap.rationale,
        icd11Code: null,
      });
    }
    for (const d of brief.differential) {
      for (const g of d.gapsToFill) {
        out.push({
          kind: 'DIAGNOSTIC_CRITERION',
          question: g,
          rationale: `Tests ${d.icd11Code} ${d.icd11Label}.`,
          icd11Code: d.icd11Code,
        });
      }
    }
    return out;
  }

  const parsed = ClinicalReportV1Schema.safeParse(body);
  if (!parsed.success) return out;
  const report = parsed.data;
  for (const gap of report.assessmentGaps) {
    out.push({
      kind: gap.purpose === 'safety' ? 'SAFETY' : 'ASSESSMENT_GAP',
      question: gap.question,
      rationale: gap.rationale,
      icd11Code: null,
    });
  }
  for (const d of report.diagnosisCandidates) {
    for (const g of d.gapsToFill) {
      out.push({
        kind: 'DIAGNOSTIC_CRITERION',
        question: g,
        rationale: `Tests ${d.icd11Code} ${d.icd11Label}.`,
        icd11Code: d.icd11Code,
      });
    }
  }
  return out;
}

// Re-export for callers that thread Prisma types.
export type { Prisma };
