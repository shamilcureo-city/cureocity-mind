import { NextResponse, type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { sessionSummaryLine } from '@cureocity/clinical';
import { CaseFilePdf, type CaseFilePdfProps } from '@/components/pdf/CaseFilePdf';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { resolveClientPii } from '@/lib/client-pii';
import { ageFromDob, safeFileSlug } from '@/lib/doc-format';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/clients/[id]/case-file/pdf — Sprint 65.
 *
 * Assembles the whole client chart (diagnoses + plans + outcome measures
 * + episodes + session history) into one consolidated PDF and streams it
 * to the therapist. Read-only; audits as CASE_FILE_EXPORTED. Tenant-gated:
 * the client must belong to the requesting psychologist.
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
      status: true,
      createdAt: true,
      dateOfBirth: true,
      presentingConcerns: true,
    },
  });
  if (!client || client.psychologistId !== psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  const pii = await resolveClientPii(client);

  const [psychologist, diagnoses, plans, instruments, episodes, sessions] = await Promise.all([
    prisma.psychologist.findUnique({
      where: { id: psychologistId },
      select: { fullName: true, rciNumber: true },
    }),
    prisma.clientDiagnosis.findMany({
      where: { clientId },
      orderBy: { confirmedAt: 'asc' },
      select: {
        icd11Code: true,
        icd11Label: true,
        confidence: true,
        isPrimary: true,
        confirmedAt: true,
        supersededAt: true,
      },
    }),
    prisma.treatmentPlan.findMany({
      where: { clientId },
      orderBy: { version: 'desc' },
      select: { version: true, body: true, confirmedAt: true, supersededAt: true },
    }),
    prisma.instrumentResponse.findMany({
      where: { clientId },
      orderBy: { administeredAt: 'asc' },
      select: { instrumentKey: true, score: true, severity: true, administeredAt: true },
    }),
    prisma.treatmentEpisode.findMany({
      where: { clientId },
      orderBy: { openedAt: 'asc' },
      select: {
        status: true,
        openedAt: true,
        closedAt: true,
        closeReason: true,
        outcomeNote: true,
      },
    }),
    prisma.session.findMany({
      where: { clientId },
      orderBy: { scheduledAt: 'asc' },
      select: {
        scheduledAt: true,
        kind: true,
        status: true,
        therapyNote: { select: { signedAt: true, content: true } },
      },
    }),
  ]);

  const activePlanRow = plans.find((p) => p.supersededAt === null) ?? null;
  const priorPlanCount = plans.length - (activePlanRow ? 1 : 0);

  const props: CaseFilePdfProps = {
    clientFullName: pii.fullName,
    status: client.status,
    clientSince: client.createdAt.toISOString(),
    ageYears: ageFromDob(client.dateOfBirth),
    presentingConcerns: client.presentingConcerns?.trim() || null,
    preparedBy: psychologist?.fullName ?? 'Clinician',
    rciNumber: psychologist?.rciNumber ?? '—',
    generatedAt: new Date().toISOString(),
    diagnoses: diagnoses.map((d) => ({
      icd11Code: d.icd11Code,
      icd11Label: d.icd11Label,
      confidence: d.confidence,
      isPrimary: d.isPrimary,
      confirmedAt: d.confirmedAt.toISOString(),
      supersededAt: d.supersededAt?.toISOString() ?? null,
    })),
    activePlan: activePlanRow
      ? shapePlan(activePlanRow.version, activePlanRow.body, activePlanRow.confirmedAt)
      : null,
    priorPlanCount,
    instruments: instruments.map((m) => ({
      instrumentKey: m.instrumentKey,
      score: m.score,
      severity: m.severity,
      administeredAt: m.administeredAt.toISOString(),
    })),
    episodes: episodes.map((e) => ({
      status: e.status,
      openedAt: e.openedAt.toISOString(),
      closedAt: e.closedAt?.toISOString() ?? null,
      closeReason: e.closeReason,
      outcomeNote: e.outcomeNote,
    })),
    sessions: sessions.map((s) => ({
      scheduledAt: s.scheduledAt.toISOString(),
      kind: s.kind,
      status: s.status,
      signed: Boolean(s.therapyNote?.signedAt),
      summary: sessionSummaryLine(s.kind, s.therapyNote?.content ?? null),
    })),
  };

  const buffer = await renderToBuffer(CaseFilePdf(props));

  await writeAudit({
    actorType: 'PSYCHOLOGIST',
    actorPsychologistId: psychologistId,
    action: 'CASE_FILE_EXPORTED',
    targetType: 'Client',
    targetId: clientId,
    metadata: {
      ...auditMetadataFromRequest(req),
      bytes: buffer.length,
      sessions: sessions.length,
      diagnoses: diagnoses.length,
    },
  });

  const dateStr = new Date().toISOString().slice(0, 10);
  const safeName = safeFileSlug(pii.fullName);
  const filename = `case-file-${safeName}-${dateStr}.pdf`;

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

/** Defensive shaping of the stored TreatmentPlan.body JSON. */
function shapePlan(
  version: number,
  body: unknown,
  confirmedAt: Date,
): CaseFilePdfProps['activePlan'] {
  const b = (body ?? {}) as {
    modality?: unknown;
    phaseSequence?: unknown;
    goals?: unknown;
    expectedDurationSessions?: unknown;
  };
  const phases = Array.isArray(b.phaseSequence)
    ? b.phaseSequence.filter((p): p is string => typeof p === 'string')
    : [];
  const goals = Array.isArray(b.goals)
    ? b.goals
        .map((g) => g as { description?: unknown; measure?: unknown })
        .filter((g) => typeof g.description === 'string' && typeof g.measure === 'string')
        .map((g) => ({ description: g.description as string, measure: g.measure as string }))
    : [];
  return {
    version,
    modality: typeof b.modality === 'string' ? b.modality : 'mixed',
    phaseSequence: phases,
    goals,
    expectedDurationSessions:
      typeof b.expectedDurationSessions === 'number' ? b.expectedDurationSessions : null,
    confirmedAt: confirmedAt.toISOString(),
  };
}
