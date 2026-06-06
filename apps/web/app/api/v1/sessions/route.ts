import { NextResponse, type NextRequest } from 'next/server';
import { CreateSessionInputSchema } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { toSession } from '@/lib/mappers';
import {
  SessionDefaultsError,
  computeSessionDefaults,
  modalityWasOverridden,
} from '@/lib/session-defaults';
import { parseJson } from '@/lib/validate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/sessions — create a session row in SCHEDULED state.
 *
 * Sprint 19 — modality is now OPTIONAL in the input. When absent, the
 * session-defaults cascade picks one (TreatmentPlan → Client →
 * Psychologist → INTAKE / SUPPORTIVE) and writes a
 * SESSION_MODALITY_INFERRED audit. When the therapist passes a value
 * that differs from what the cascade would pick, writes
 * SESSION_MODALITY_OVERRIDDEN. session.kind is always inferred
 * server-side from cumulative state — therapists can't override it
 * directly (drives Pass 2/3 prompt branches).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requirePsychologistId(req);
  if (!auth.ok) return auth.response;
  const dto = await parseJson(req, CreateSessionInputSchema);
  if (!dto.ok) return dto.response;

  const client = await prisma.client.findUnique({ where: { id: dto.value.clientId } });
  if (!client || client.deletedAt !== null) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  if (client.psychologistId !== auth.value.psychologistId) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  let defaults;
  try {
    defaults = await computeSessionDefaults(dto.value.clientId, auth.value.psychologistId);
  } catch (e) {
    if (e instanceof SessionDefaultsError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    throw e;
  }

  const submittedModality = dto.value.modality ?? null;
  const resolvedModality = submittedModality ?? defaults.modality;
  const overridden = modalityWasOverridden(defaults.modality, submittedModality);

  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.session.create({
      data: {
        clientId: dto.value.clientId,
        psychologistId: auth.value.psychologistId,
        modality: resolvedModality,
        kind: defaults.kind,
        status: 'SCHEDULED',
        scheduledAt: new Date(dto.value.scheduledAt),
      },
    });
    await writeAudit(
      {
        actorType: 'PSYCHOLOGIST',
        actorPsychologistId: auth.value.psychologistId,
        action: 'SESSION_CREATED',
        targetType: 'Session',
        targetId: row.id,
        metadata: {
          ...auditMetadataFromRequest(req),
          clientId: dto.value.clientId,
          modality: resolvedModality,
          kind: defaults.kind,
        },
      },
      tx,
    );
    // Sprint 19 — record the cascade decision so the competency
    // dashboard can attribute auto vs manual. The two actions are
    // mutually exclusive: inferred when modality came from the
    // cascade alone, overridden when the therapist supplied a value
    // that differs from what the cascade picked.
    if (overridden) {
      await writeAudit(
        {
          actorType: 'PSYCHOLOGIST',
          actorPsychologistId: auth.value.psychologistId,
          action: 'SESSION_MODALITY_OVERRIDDEN',
          targetType: 'Session',
          targetId: row.id,
          metadata: {
            cascadeModality: defaults.modality,
            cascadeSource: defaults.modalitySource,
            submittedModality,
          },
        },
        tx,
      );
    } else {
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'SESSION_MODALITY_INFERRED',
          targetType: 'Session',
          targetId: row.id,
          metadata: {
            cascadeModality: defaults.modality,
            cascadeSource: defaults.modalitySource,
          },
        },
        tx,
      );
    }
    return row;
  });
  return NextResponse.json(toSession(created), { status: 201 });
}
