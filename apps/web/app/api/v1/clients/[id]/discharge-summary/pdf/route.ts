import { NextResponse, type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import {
  DischargeSummaryPdf,
  type DischargeGoal,
  type DischargeOutcome,
  type DischargeSummaryPdfProps,
} from '@/components/pdf/DischargeSummaryPdf';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { resolveClientPii } from '@/lib/client-pii';
import { ageFromDob, safeFileSlug } from '@/lib/doc-format';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/clients/[id]/discharge-summary/pdf — Sprint 65b.
 *
 * A clinician-facing end-of-episode summary (distinct from the patient
 * Progress Report): reason for care, working diagnosis, goals + whether
 * they were met, measured outcome (first → last), and the reason for
 * ending. Scoped to the client's most recent episode of care. Tenant-
 * gated; read-only; audits as DISCHARGE_SUMMARY_EXPORTED.
 *
 * 404 if the client has no episode of care yet.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;
  const psychologistId = auth.value.psychologistId;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      psychologistId: true,
      fullNameEncrypted: true,
      contactPhoneEncrypted: true,
      contactEmailEncrypted: true,
      dateOfBirth: true,
      presentingConcerns: true,
    },
  });
  if (!client || client.psychologistId !== psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  const pii = await resolveClientPii(client);

  const episode = await prisma.treatmentEpisode.findFirst({
    where: { clientId },
    orderBy: { openedAt: 'desc' },
    select: { status: true, openedAt: true, closedAt: true, closeReason: true, outcomeNote: true },
  });
  if (!episode) {
    return NextResponse.json(
      { error: 'No episode of care yet — a discharge summary needs at least one started episode.' },
      { status: 404 },
    );
  }

  // Scope outcome + session counts to the episode window.
  const windowEnd = episode.closedAt ?? new Date();

  const [psychologist, diagnosis, plan, instruments, completedSessions] = await Promise.all([
    prisma.psychologist.findUnique({
      where: { id: psychologistId },
      select: { fullName: true, rciNumber: true },
    }),
    prisma.clientDiagnosis.findFirst({
      where: { clientId, supersededAt: null },
      orderBy: [{ isPrimary: 'desc' }, { confirmedAt: 'desc' }],
      select: { icd11Code: true, icd11Label: true },
    }),
    prisma.treatmentPlan.findFirst({
      where: { clientId, supersededAt: null },
      select: { body: true, goalProgress: { select: { goalIndex: true, status: true } } },
    }),
    prisma.instrumentResponse.findMany({
      where: { clientId, administeredAt: { gte: episode.openedAt, lte: windowEnd } },
      orderBy: { administeredAt: 'asc' },
      select: { instrumentKey: true, score: true, administeredAt: true },
    }),
    prisma.session.count({
      where: {
        clientId,
        status: 'COMPLETED',
        scheduledAt: { gte: episode.openedAt, lte: windowEnd },
      },
    }),
  ]);

  const props: DischargeSummaryPdfProps = {
    clientFullName: pii.fullName,
    ageYears: ageFromDob(client.dateOfBirth),
    preparedBy: psychologist?.fullName ?? 'Clinician',
    rciNumber: psychologist?.rciNumber ?? '—',
    generatedAt: new Date().toISOString(),
    episodeStatus: episode.status,
    openedAt: episode.openedAt.toISOString(),
    closedAt: episode.closedAt?.toISOString() ?? null,
    closeReason: episode.closeReason,
    outcomeNote: episode.outcomeNote,
    completedSessions,
    presentingConcerns: client.presentingConcerns?.trim() || null,
    finalDiagnosis: diagnosis
      ? { icd11Code: diagnosis.icd11Code, icd11Label: diagnosis.icd11Label }
      : null,
    goals: shapeGoals(plan?.body, plan?.goalProgress ?? []),
    outcomes: shapeOutcomes(instruments),
  };

  const buffer = await renderToBuffer(DischargeSummaryPdf(props));

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: psychologistId,
    action: 'DISCHARGE_SUMMARY_EXPORTED',
    targetType: 'Client',
    targetId: clientId,
    metadata: {
      ...auditMetadataFromRequest(req),
      bytes: buffer.length,
      episodeStatus: episode.status,
    },
  });

  const dateStr = new Date().toISOString().slice(0, 10);
  const safeName = safeFileSlug(pii.fullName);
  const filename = `discharge-summary-${safeName}-${dateStr}.pdf`;

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, no-store',
    },
  });
}

/** Map plan goals to their per-goal achievement status (side-table). */
function shapeGoals(
  body: unknown,
  progress: { goalIndex: number; status: string }[],
): DischargeGoal[] {
  const b = (body ?? {}) as { goals?: unknown };
  if (!Array.isArray(b.goals)) return [];
  const statusByIndex = new Map(progress.map((p) => [p.goalIndex, p.status]));
  // Keep the RAW index: TreatmentGoalProgress.goalIndex is keyed by the
  // position in the unfiltered goals array (the goal-PATCH route stores the
  // URL index against goals.length), so capture i BEFORE filtering or a
  // malformed earlier goal would shift every later goal's status.
  return b.goals
    .map((g, i) => ({ g: g as { description?: unknown; measure?: unknown }, i }))
    .filter(({ g }) => typeof g.description === 'string' && typeof g.measure === 'string')
    .map(({ g, i }) => ({
      description: g.description as string,
      measure: g.measure as string,
      status: normaliseStatus(statusByIndex.get(i)),
    }));
}

function normaliseStatus(raw: string | undefined): DischargeGoal['status'] {
  return raw === 'ACHIEVED' || raw === 'IN_PROGRESS' ? raw : 'NOT_STARTED';
}

// Instruments where a LOWER score is the better outcome (symptom /
// disability scales). Only these get an 'improved'/'worse' label; any other
// instrument (e.g. a future wellbeing scale where higher is better) falls
// back to the polarity-neutral 'changed' so the summary never asserts a
// direction it can't justify. Compared case-insensitively.
const LOWER_IS_BETTER_INSTRUMENTS = new Set(['PHQ9', 'GAD7', 'PCL5', 'WHODAS2']);

/** First → last score per instrument, with a plain direction. */
function shapeOutcomes(
  rows: { instrumentKey: string; score: number; administeredAt: Date }[],
): DischargeOutcome[] {
  const byKey = new Map<string, { instrumentKey: string; score: number; administeredAt: Date }[]>();
  for (const r of rows) {
    const list = byKey.get(r.instrumentKey) ?? [];
    list.push(r);
    byKey.set(r.instrumentKey, list);
  }
  const out: DischargeOutcome[] = [];
  for (const [key, list] of byKey) {
    const first = list[0];
    const last = list[list.length - 1];
    if (!first || !last) continue;
    const change = last.score - first.score;
    const lowerIsBetter = LOWER_IS_BETTER_INSTRUMENTS.has(key.toUpperCase());
    const direction: DischargeOutcome['direction'] =
      change === 0 ? 'no-change' : !lowerIsBetter ? 'changed' : change < 0 ? 'improved' : 'worse';
    out.push({
      instrumentKey: key,
      firstScore: first.score,
      lastScore: last.score,
      firstAt: first.administeredAt.toISOString(),
      lastAt: last.administeredAt.toISOString(),
      change,
      direction,
    });
  }
  return out;
}
