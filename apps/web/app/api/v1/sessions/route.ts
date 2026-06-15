import { NextResponse, type NextRequest } from 'next/server';
import { CreateSessionInputSchema, planTierLabel } from '@cureocity/contracts';
import { requirePsychologistId } from '@/lib/auth-server';
import { auditMetadataFromRequest, writeAudit } from '@/lib/audit';
import { getEntitlement } from '@/lib/billing';
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

  // Sprint 53 — trial cap gate. Soft enforcement: existing sessions,
  // notes, shares, and copilot all keep working at cap. Only new
  // session creation is blocked, and demo "Example" client sessions
  // never count (handled inside getEntitlement). Returns 402 with a
  // structured code the three creation UIs flip into an UpgradeModal.
  if (!client.isDemo) {
    const entitlement = await getEntitlement(auth.value.psychologistId);
    if (!entitlement.isPaidActive && entitlement.trialUsed >= entitlement.trialCap) {
      await writeAudit({
        actorType: 'SYSTEM',
        action: 'TRIAL_CAP_REACHED',
        targetType: 'Psychologist',
        targetId: auth.value.psychologistId,
        metadata: {
          ...auditMetadataFromRequest(req),
          trialCap: entitlement.trialCap,
          trialUsed: entitlement.trialUsed,
        },
      });
      return NextResponse.json(
        {
          error: `You have used ${entitlement.trialUsed} of ${entitlement.trialCap} trial sessions. Upgrade your plan to record another.`,
          code: 'TRIAL_CAP_REACHED',
          upgradeUrl: '/app/settings/plan',
        },
        { status: 402 },
      );
    }
    // Sprint 56 — paid-tier rolling-30-day session cap (Trainee 15 /
    // Starter 30). Pro/Premium carry monthlySessionCap = null and never
    // gate here; FREE_TRIAL is handled by the trial branch above.
    if (
      entitlement.isPaidActive &&
      entitlement.monthlySessionCap !== null &&
      entitlement.monthlyUsed >= entitlement.monthlySessionCap
    ) {
      await writeAudit({
        actorType: 'SYSTEM',
        action: 'PLAN_CAP_REACHED',
        targetType: 'Psychologist',
        targetId: auth.value.psychologistId,
        metadata: {
          ...auditMetadataFromRequest(req),
          plan: entitlement.plan,
          monthlySessionCap: entitlement.monthlySessionCap,
          monthlyUsed: entitlement.monthlyUsed,
        },
      });
      return NextResponse.json(
        {
          error: `You've recorded ${entitlement.monthlyUsed} sessions in the last 30 days — your ${planTierLabel(entitlement.plan)} plan includes ${entitlement.monthlySessionCap} a month. Upgrade to Pro for unlimited sessions.`,
          code: 'PLAN_CAP_REACHED',
          upgradeUrl: '/app/settings/plan',
        },
        { status: 402 },
      );
    }
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

    // Sprint 20 Phase 3 — ensure the client has an OPEN treatment
    // episode. A new client (or one who returned after discharge)
    // starts a fresh episode of care here so the journey arc has a
    // durable container with a real openedAt.
    const openEpisode = await tx.treatmentEpisode.findFirst({
      where: { clientId: dto.value.clientId, status: 'OPEN' },
      select: { id: true },
    });
    if (!openEpisode) {
      const episode = await tx.treatmentEpisode.create({
        data: {
          clientId: dto.value.clientId,
          psychologistId: auth.value.psychologistId,
          status: 'OPEN',
        },
      });
      await writeAudit(
        {
          actorType: 'SYSTEM',
          action: 'TREATMENT_EPISODE_OPENED',
          targetType: 'TreatmentEpisode',
          targetId: episode.id,
          metadata: {
            clientId: dto.value.clientId,
            sessionId: row.id,
          },
        },
        tx,
      );
    }
    return row;
  });
  return NextResponse.json(toSession(created), { status: 201 });
}
