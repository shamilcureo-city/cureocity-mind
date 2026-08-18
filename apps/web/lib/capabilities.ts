import { PractitionerCapabilitySchema, type PractitionerCapability } from '@cureocity/contracts';
import { resolveEffectiveCapabilities, type EffectiveCapabilitySet } from '@cureocity/orbit-core';
import { prisma } from './prisma';

export async function getEffectiveCapabilities(
  psychologistId: string,
): Promise<EffectiveCapabilitySet> {
  if (!psychologistId) throw new Error('Practitioner context is required');
  const practitioner = await prisma.psychologist.findUnique({
    where: { id: psychologistId },
    select: {
      vertical: true,
      profession: true,
      credentials: {
        where: { status: 'VERIFIED', jurisdiction: 'IN' },
        select: { kind: true, status: true, jurisdiction: true, verifiedAt: true, expiresAt: true },
      },
      capabilityGrants: {
        where: { active: true, revokedAt: null },
        select: { capability: true, source: true, active: true, revokedAt: true },
      },
      clinicMemberships: {
        select: {
          clinic: {
            select: {
              capabilityGrants: {
                where: { active: true, revokedAt: null },
                select: { capability: true, active: true, revokedAt: true },
              },
            },
          },
        },
      },
    },
  });
  if (!practitioner) throw new Error(`Practitioner ${psychologistId} not found`);
  const effective = resolveEffectiveCapabilities({
    legacyVertical: practitioner.vertical,
    configuredProfession: practitioner.profession,
    credentials: practitioner.credentials,
    grants: [
      ...practitioner.capabilityGrants,
      ...practitioner.clinicMemberships.flatMap(({ clinic }) =>
        clinic.capabilityGrants.map((grant) => ({
          ...grant,
          source: 'ORGANIZATION_POLICY' as const,
        })),
      ),
    ],
  });
  const enabled = new Set(effective.capabilities);
  for (const raw of (process.env['ORBIT_DISABLED_CAPABILITIES'] ?? '').split(',')) {
    const parsed = PractitionerCapabilitySchema.safeParse(raw.trim());
    if (parsed.success) enabled.delete(parsed.data);
  }
  return { ...effective, capabilities: enabled };
}

export function serializeCapabilities(effective: EffectiveCapabilitySet): PractitionerCapability[] {
  return [...effective.capabilities].sort();
}

/** Re-query grants immediately adjacent to a regulated execution or write. */
export async function assertCurrentCapabilities(
  psychologistId: string,
  required: readonly PractitionerCapability[],
): Promise<void> {
  if (required.length === 0) return;
  const effective = await getEffectiveCapabilities(psychologistId);
  const missing = required.find((capability) => !effective.capabilities.has(capability));
  if (missing) throw new CapabilityAuthorizationError(missing);
}

/** Resolve ownership from the persisted session, then re-query current grants. */
export async function assertSessionCapabilities(
  sessionId: string,
  required: readonly PractitionerCapability[],
): Promise<string> {
  if (!sessionId) throw new Error('Session context is required');
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { psychologistId: true },
  });
  if (!session) throw new Error(`Session ${sessionId} not found`);
  await assertCurrentCapabilities(session.psychologistId, required);
  return session.psychologistId;
}

export class CapabilityAuthorizationError extends Error {
  constructor(readonly capability: PractitionerCapability) {
    super(`Missing current ${capability} authorization`);
    this.name = 'CapabilityAuthorizationError';
  }
}
