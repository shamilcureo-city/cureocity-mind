import { Prisma } from '@prisma/client';
import type { Clinic, ClinicRole } from '@cureocity/contracts';
import { writeAudit } from '@/lib/audit';

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
