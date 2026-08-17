import { PractitionerCapabilitySchema, type PractitionerCapability } from '@cureocity/contracts';
import { resolveEffectiveCapabilities, type EffectiveCapabilitySet } from '@cureocity/orbit-core';
import { prisma } from './prisma';

export async function getEffectiveCapabilities(
  psychologistId: string,
): Promise<EffectiveCapabilitySet> {
  const practitioner = await prisma.psychologist.findUnique({
    where: { id: psychologistId },
    select: {
      vertical: true,
      profession: true,
      credentials: {
        select: { kind: true, status: true, jurisdiction: true, verifiedAt: true, expiresAt: true },
      },
      capabilityGrants: {
        select: { capability: true, source: true, active: true, revokedAt: true },
      },
      clinicMemberships: {
        select: {
          clinic: {
            select: {
              capabilityGrants: {
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
