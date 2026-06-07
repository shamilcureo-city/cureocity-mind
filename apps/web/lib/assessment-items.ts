import type { Prisma } from '@prisma/client';
import { ClinicalReportV1Schema, InitialAssessmentBriefV1Schema } from '@cureocity/contracts';
import { writeAudit } from './audit';
import { prisma } from './prisma';

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
 * Dedup: an OPEN/ADDRESSED item with the same normalised question text
 * is NOT recreated — re-running Pass 3 only adds genuinely new
 * questions. CLOSED items are NOT reopened (the therapist resolved them).
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
  kind: 'DIAGNOSTIC_CRITERION' | 'ASSESSMENT_GAP';
  question: string;
  rationale: string;
  icd11Code: string | null;
}

/** Normalise question text for dedup — lowercase, collapse whitespace, strip trailing punctuation. */
function normalise(q: string): string {
  return q
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.?!]+$/, '')
    .trim();
}

export async function reconcileAssessmentItems(args: ReconcileArgs): Promise<void> {
  const candidates = extractCandidates(args.pass3Body, args.kind);
  if (candidates.length === 0) return;

  // Resolve the client's open episode so new items group correctly.
  const openEpisode = await prisma.treatmentEpisode.findFirst({
    where: { clientId: args.clientId, status: 'OPEN' },
    orderBy: { openedAt: 'desc' },
    select: { id: true },
  });

  // Existing non-closed items → dedup set (CLOSED ones are intentionally
  // excluded so a resolved question stays resolved).
  const existing = await prisma.assessmentItem.findMany({
    where: { clientId: args.clientId, status: { in: ['OPEN', 'ADDRESSED'] } },
    select: { question: true },
  });
  const seen = new Set(existing.map((e) => normalise(e.question)));

  for (const c of candidates) {
    const key = normalise(c.question);
    if (seen.has(key)) continue;
    seen.add(key);
    const created = await prisma.assessmentItem.create({
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
    await writeAudit({
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
    });
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
        kind: 'ASSESSMENT_GAP',
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
      kind: 'ASSESSMENT_GAP',
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
