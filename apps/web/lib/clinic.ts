import { Prisma } from '@prisma/client';
import type { Clinic, ClinicRole } from '@cureocity/contracts';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';

/**
 * Sprint 39 — clinic helpers (Phase 1).
 *
 * ensurePersonalClinic is idempotent + self-healing: it guarantees a
 * therapist has at least one clinic membership, creating a personal SOLO
 * clinic (as OWNER) if none exists. Called on signup AND lazily on the
 * first clinic read, so seeded fixtures and any backfill gap heal on
 * access without a separate migration step.
 */
export async function ensurePersonalClinic(
  tx: Prisma.TransactionClient,
  args: { psychologistId: string; name: string },
): Promise<{ clinicId: string; created: boolean }> {
  const existing = await tx.clinicMembership.findFirst({
    where: { psychologistId: args.psychologistId },
    select: { clinicId: true },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return { clinicId: existing.clinicId, created: false };

  const clinic = await tx.clinic.create({
    data: {
      name: args.name.trim() || 'My practice',
      kind: 'SOLO',
      memberships: {
        create: { psychologistId: args.psychologistId, role: 'OWNER' },
      },
    },
  });
  await writeAudit(
    {
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: args.psychologistId,
      action: 'CLINIC_CREATED',
      targetType: 'Clinic',
      targetId: clinic.id,
      metadata: { kind: 'SOLO', auto: true },
    },
    tx,
  );
  await writeAudit(
    {
      actorType: 'PSYCHOLOGIST',
      actorPsychologistId: args.psychologistId,
      action: 'CLINIC_MEMBER_ADDED',
      targetType: 'Clinic',
      targetId: clinic.id,
      metadata: { psychologistId: args.psychologistId, role: 'OWNER', auto: true },
    },
    tx,
  );
  return { clinicId: clinic.id, created: true };
}

interface ClinicWithMembers {
  id: string;
  name: string;
  kind: 'SOLO' | 'GROUP';
  createdAt: Date;
  memberships: {
    psychologistId: string;
    role: ClinicRole;
    createdAt: Date;
    psychologist: { fullName: string };
  }[];
}

// ============================================================================
// Phase 2 (Sprint 42) — admin powers.
// ============================================================================

/**
 * Resolve the requester's role in a clinic, or null if they aren't a member.
 * The route layer turns null / insufficient-role into 404 / 403.
 */
export async function clinicRoleOf(
  clinicId: string,
  psychologistId: string,
): Promise<ClinicRole | null> {
  const m = await prisma.clinicMembership.findUnique({
    where: { clinicId_psychologistId: { clinicId, psychologistId } },
    select: { role: true },
  });
  return m?.role ?? null;
}

export function isClinicAdminRole(role: ClinicRole | null): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/**
 * Client-scoped tables that carry a `psychologistId` ownership column.
 * On reassignment every one moves to the new therapist so they get full
 * continuity. KEEP IN SYNC with the schema: a new client-scoped table with
 * a psychologistId must be added here or a reassigned client's rows in it
 * stay invisible to the new owner. (Verified against the schema in
 * lib/__tests__ / the reassign route's comment.)
 *
 * Immutable authorship columns (signedBy, confirmedByPsychologistId, audit
 * actorPsychologistId) are deliberately NOT touched — custody moves, history
 * stays truthful about who did what.
 */
const CLIENT_SCOPED_OWNED_MODELS = [
  'assessmentItem',
  'clientClaimToken',
  'clientConceptualMap',
  'clientDiagnosis',
  'clinicalReport',
  'consent',
  'exerciseAssignment',
  'instrumentResponse',
  'modalityState',
  'patientShare',
  'preSessionBrief',
  'safetyPlan',
  'session',
  'therapyScript',
  'treatmentEpisode',
  'treatmentPlan',
] as const;

/**
 * Transfer a client's custody from one therapist to another, atomically.
 * Moves Client.psychologistId + the psychologistId on every client-scoped
 * owned table so the new therapist sees full history. Caller has already
 * authorised (both therapists are members of the same clinic, requester is
 * admin) and audited CLIENT_REASSIGNED.
 */
export async function transferClientCustody(
  tx: Prisma.TransactionClient,
  args: { clientId: string; toPsychologistId: string },
): Promise<void> {
  const where = { clientId: args.clientId };
  const data = { psychologistId: args.toPsychologistId };
  for (const model of CLIENT_SCOPED_OWNED_MODELS) {
    // Each delegate has the same updateMany shape; the union is wide so
    // we cast through a minimal structural type.
    await (tx[model] as { updateMany: (a: unknown) => Promise<unknown> }).updateMany({
      where,
      data,
    });
  }
  await tx.client.update({
    where: { id: args.clientId },
    data: { psychologistId: args.toPsychologistId },
  });
}

/**
 * Bulk custody transfer — move a therapist's ENTIRE caseload to another
 * (the departure flow). Same table set, but scoped by current owner rather
 * than one client, so it's a single updateMany per table. Returns the count
 * of clients moved. Authorisation + audit are the caller's job.
 */
export async function transferAllCustody(
  tx: Prisma.TransactionClient,
  args: { fromPsychologistId: string; toPsychologistId: string },
): Promise<number> {
  const where = { psychologistId: args.fromPsychologistId };
  const data = { psychologistId: args.toPsychologistId };
  for (const model of CLIENT_SCOPED_OWNED_MODELS) {
    await (tx[model] as { updateMany: (a: unknown) => Promise<unknown> }).updateMany({
      where,
      data,
    });
  }
  const moved = await tx.client.updateMany({ where, data });
  return moved.count;
}

/** Map a clinic + its memberships to the DTO, from one therapist's view. */
export function toClinic(row: ClinicWithMembers, viewerPsychologistId: string): Clinic {
  const mine = row.memberships.find((m) => m.psychologistId === viewerPsychologistId);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    myRole: mine?.role ?? 'MEMBER',
    members: row.memberships.map((m) => ({
      psychologistId: m.psychologistId,
      fullName: m.psychologist.fullName,
      role: m.role,
      joinedAt: m.createdAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
  };
}
