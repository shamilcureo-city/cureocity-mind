import { NextResponse, type NextRequest } from 'next/server';
import { CreateLetterInputSchema, type Letter } from '@cureocity/contracts';
import { composeLetter, type LetterInstrumentPoint } from '@cureocity/clinical';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { resolveClientPii } from '@/lib/client-pii';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

// TS4 — readable phrases for the plan modality, for the letter's therapeutic
// focus line. Keyed by the SessionModality enum stored in TreatmentPlan.body.
const MODALITY_PHRASE: Record<string, string> = {
  CBT: 'cognitive behavioural therapy',
  EMDR: 'EMDR (eye-movement desensitisation and reprocessing)',
  ACT: 'acceptance and commitment therapy',
  IFS: 'internal family systems therapy',
  PSYCHODYNAMIC: 'psychodynamic therapy',
  MI: 'motivational interviewing',
  MBCT: 'mindfulness-based cognitive therapy',
  SUPPORTIVE: 'supportive counselling',
  OTHER: 'psychological therapy',
};

/** The plan's modality → a readable therapeutic-focus phrase (or null). */
function treatmentFocusFrom(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const modality = (body as Record<string, unknown>)['modality'];
  return typeof modality === 'string' ? (MODALITY_PHRASE[modality] ?? null) : null;
}

/**
 * TS4 — the episode-scoped measurement trajectory for the referral's clinical
 * reasoning. Groups the rows by instrument, keeps those with ≥2 readings in
 * the current episode, and reports baseline (first) → latest (last).
 */
function buildTrajectory(
  rows: { instrumentKey: string; score: number; administeredAt: Date }[],
  episodeOpenedAt: Date | null,
): LetterInstrumentPoint[] {
  const scoped = episodeOpenedAt ? rows.filter((r) => r.administeredAt >= episodeOpenedAt) : rows;
  const out: LetterInstrumentPoint[] = [];
  for (const key of ['PHQ9', 'GAD7'] as const) {
    const series = scoped.filter((r) => r.instrumentKey === key);
    if (series.length < 2) continue;
    out.push({
      instrumentKey: key,
      baselineScore: series[0]!.score,
      latestScore: series[series.length - 1]!.score,
      administrationCount: series.length,
    });
  }
  return out;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/clients/[id]/letters — Sprint 66.
 *
 * Composes a referral / supporting letter deterministically from the
 * client's record + an optional therapist note, persists it, and returns
 * it (with id) so the UI can offer the PDF. Tenant-gated; audits
 * LETTER_GENERATED.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const { id: clientId } = await params;
  const psychologistId = auth.value.psychologistId;

  const dto = await parseJson(req, CreateLetterInputSchema);
  if (!dto.ok) return dto.response;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      psychologistId: true,
      deletedAt: true,
      fullNameEncrypted: true,
      contactPhoneEncrypted: true,
      contactEmailEncrypted: true,
      presentingConcerns: true,
    },
  });
  if (!client || client.deletedAt !== null || client.psychologistId !== psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  const pii = await resolveClientPii(client);

  const [
    psychologist,
    diagnosis,
    completedSessions,
    firstSession,
    lastSession,
    activePlan,
    instrumentRows,
    latestEpisode,
  ] = await Promise.all([
    prisma.psychologist.findUnique({
      where: { id: psychologistId },
      select: { fullName: true, rciNumber: true },
    }),
    prisma.clientDiagnosis.findFirst({
      where: { clientId, supersededAt: null },
      orderBy: [{ isPrimary: 'desc' }, { confirmedAt: 'desc' }],
      select: { icd11Code: true, icd11Label: true },
    }),
    prisma.session.count({ where: { clientId, status: 'COMPLETED' } }),
    prisma.session.findFirst({
      where: { clientId, status: 'COMPLETED' },
      orderBy: { scheduledAt: 'asc' },
      select: { scheduledAt: true },
    }),
    prisma.session.findFirst({
      where: { clientId, status: 'COMPLETED' },
      orderBy: { scheduledAt: 'desc' },
      select: { scheduledAt: true },
    }),
    // TS4 — the active treatment plan (for the therapeutic-focus line).
    prisma.treatmentPlan.findFirst({
      where: { clientId, supersededAt: null },
      orderBy: { version: 'desc' },
      select: { body: true },
    }),
    // TS4 — PHQ-9 / GAD-7 series for the referral's measurement trajectory.
    prisma.instrumentResponse.findMany({
      where: { clientId, instrumentKey: { in: ['PHQ9', 'GAD7'] } },
      orderBy: [{ administeredAt: 'asc' }, { createdAt: 'asc' }],
      select: { instrumentKey: true, score: true, administeredAt: true },
    }),
    prisma.treatmentEpisode.findFirst({
      where: { clientId },
      orderBy: { openedAt: 'desc' },
      select: { openedAt: true },
    }),
  ]);

  const composed = composeLetter(dto.value.kind, {
    clientFullName: pii.fullName,
    therapistFullName: psychologist?.fullName ?? 'Clinician',
    rciNumber: psychologist?.rciNumber ?? '—',
    diagnosis: diagnosis
      ? { icd11Code: diagnosis.icd11Code, icd11Label: diagnosis.icd11Label }
      : null,
    presentingConcerns: client.presentingConcerns?.trim() || null,
    completedSessions,
    firstSessionAt: firstSession?.scheduledAt.toISOString() ?? null,
    lastSessionAt: lastSession?.scheduledAt.toISOString() ?? null,
    treatmentFocus: treatmentFocusFrom(activePlan?.body),
    instrumentTrajectory: buildTrajectory(instrumentRows, latestEpisode?.openedAt ?? null),
    note: dto.value.note ?? null,
  });

  const row = await prisma.letter.create({
    data: {
      clientId,
      psychologistId,
      kind: dto.value.kind,
      recipient: dto.value.recipient,
      subject: composed.subject,
      body: composed.body,
    },
  });

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: psychologistId,
    action: 'LETTER_GENERATED',
    targetType: 'Letter',
    targetId: row.id,
    metadata: { ...auditMetadataFromRequest(req), clientId, kind: dto.value.kind },
  });

  const letter: Letter = {
    id: row.id,
    kind: row.kind,
    recipient: row.recipient,
    subject: row.subject,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
  return NextResponse.json({ letter }, { status: 201 });
}
