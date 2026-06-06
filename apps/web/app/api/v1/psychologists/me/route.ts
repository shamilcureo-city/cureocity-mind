import { NextResponse, type NextRequest } from 'next/server';
import { UpdatePsychologistInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { toPsychologist } from '@/lib/mappers';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/psychologists/me — read own profile.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const row = await prisma.psychologist.findUnique({
    where: { id: auth.value.psychologistId },
  });
  if (!row) return NextResponse.json({ error: 'Psychologist not found' }, { status: 404 });
  return NextResponse.json({ psychologist: toPsychologist(row) });
}

/**
 * PATCH /api/v1/psychologists/me — self-service profile editing.
 *
 * Settable fields: fullName, headline, bio, photoUrl, specialties,
 * languages, modalities, yearsOfExperience, locationCity,
 * locationProvince, sessionFeeInr, isAcceptingNewClients,
 * defaultOutputLanguage, defaultModality, backupEmail.
 *
 * Email, phone, RCI number, role, status are NOT settable here —
 * those require re-verification (separate flow).
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const body = await parseJson(req, UpdatePsychologistInputSchema);
  if (!body.ok) return body.response;

  const updates = body.value;
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (v === undefined) continue;
    data[k] = v;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.psychologist.update({
      where: { id: auth.value.psychologistId },
      data: data as never,
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'PSYCHOLOGIST_UPDATED',
        targetType: 'Psychologist',
        targetId: auth.value.psychologistId,
        metadata: {
          ...auditMetadataFromRequest(req),
          fields: Object.keys(data),
        },
      },
      tx,
    );
    return row;
  });

  return NextResponse.json({ psychologist: toPsychologist(updated) });
}
