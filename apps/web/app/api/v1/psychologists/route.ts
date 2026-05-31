import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { CreatePsychologistInputSchema } from '@cureocity/contracts';
import { resolvePsychologist } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/psychologists — idempotent registration. Replaces
 * services/patient-model-service/src/psychologists/psychologists.service.ts.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await resolvePsychologist(req);
  if (!auth.ok) return auth.response;
  const body = await parseJson(req, CreatePsychologistInputSchema);
  if (!body.ok) return body.response;

  const existing = await prisma.psychologist.findUnique({
    where: { firebaseUid: auth.value.firebaseUid },
  });
  if (existing) {
    return NextResponse.json(existing);
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const psy = await tx.psychologist.create({
        data: {
          firebaseUid: auth.value.firebaseUid,
          email: body.value.email,
          fullName: body.value.fullName,
          phone: body.value.phone,
          rciNumber: body.value.rciNumber,
          status: 'PENDING_VERIFICATION',
        },
      });
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'PSYCHOLOGIST_REGISTERED',
          targetType: 'Psychologist',
          targetId: psy.id,
          metadata: {
            ...auditMetadataFromRequest(req),
            firebaseUid: auth.value.firebaseUid,
            email: body.value.email,
          },
        },
        tx,
      );
      return psy;
    });
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const fields = (e.meta?.['target'] as string[] | undefined)?.join(', ') ?? 'unique field';
      return NextResponse.json({ error: `Already in use: ${fields}` }, { status: 409 });
    }
    throw e;
  }
}
