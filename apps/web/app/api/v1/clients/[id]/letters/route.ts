import { NextResponse, type NextRequest } from 'next/server';
import { CreateLetterInputSchema, type Letter } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';
import { composeLetter } from '@/lib/letter-templates';

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
    select: { psychologistId: true, deletedAt: true, fullName: true, presentingConcerns: true },
  });
  if (!client || client.deletedAt !== null || client.psychologistId !== psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  const [psychologist, diagnosis, completedSessions, firstSession, lastSession] = await Promise.all(
    [
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
    ],
  );

  const composed = composeLetter(dto.value.kind, {
    clientFullName: client.fullName,
    therapistFullName: psychologist?.fullName ?? 'Clinician',
    rciNumber: psychologist?.rciNumber ?? '—',
    diagnosis: diagnosis
      ? { icd11Code: diagnosis.icd11Code, icd11Label: diagnosis.icd11Label }
      : null,
    presentingConcerns: client.presentingConcerns?.trim() || null,
    completedSessions,
    firstSessionAt: firstSession?.scheduledAt.toISOString() ?? null,
    lastSessionAt: lastSession?.scheduledAt.toISOString() ?? null,
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
