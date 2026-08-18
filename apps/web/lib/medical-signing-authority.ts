import type {
  CapabilityGrantSource,
  PractitionerCapability,
  PractitionerCredentialKind,
  PractitionerCredentialStatus,
  PractitionerProfession,
  PractitionerVertical,
} from '@cureocity/contracts';
import type { Prisma } from '@prisma/client';

export type MedicalSigningAuthorizationFailure =
  | 'PRACTITIONER_INACTIVE'
  | 'MISSING_PRESCRIPTION_SIGNING'
  | 'NO_QUALIFYING_CREDENTIAL';

export class MedicalSigningAuthorizationError extends Error {
  constructor(readonly reason: MedicalSigningAuthorizationFailure) {
    super(
      reason === 'NO_QUALIFYING_CREDENTIAL'
        ? 'No current verified Indian medical registration authorizes this signature'
        : 'Current prescription-signing authority is required',
    );
    this.name = 'MedicalSigningAuthorizationError';
  }
}

export interface MedicalSigningCredentialSnapshot {
  id: string;
  kind: 'NMC_REGISTRATION' | 'STATE_MEDICAL_COUNCIL_REGISTRATION';
  registrationNumber: string;
  issuingAuthority: string;
  jurisdiction: 'IN';
  verifiedAt: string;
  expiresAt: string | null;
}

type PractitionerRow = {
  id: string;
  vertical: PractitionerVertical;
  profession: PractitionerProfession | null;
  status: string;
  deletedAt: Date | null;
};

type CredentialRow = {
  id: string;
  psychologistId: string;
  kind: PractitionerCredentialKind;
  registrationNumber: string;
  issuingAuthority: string;
  jurisdiction: string;
  status: PractitionerCredentialStatus;
  verifiedAt: Date | string | null;
  expiresAt: Date | string | null;
};

type GrantRow = {
  capability: PractitionerCapability;
  source?: CapabilityGrantSource;
  active: boolean;
  revokedAt: Date | string | null;
};

type ClinicMembershipRow = { clinicId: string };

function validDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function credentialSnapshot(
  row: CredentialRow,
  now: Date,
): MedicalSigningCredentialSnapshot | null {
  if (
    row.status !== 'VERIFIED' ||
    row.jurisdiction !== 'IN' ||
    (row.kind !== 'NMC_REGISTRATION' && row.kind !== 'STATE_MEDICAL_COUNCIL_REGISTRATION')
  ) {
    return null;
  }
  const registrationNumber = row.registrationNumber.trim();
  const issuingAuthority = row.issuingAuthority.trim();
  const verifiedAt = validDate(row.verifiedAt);
  const expiresAt = validDate(row.expiresAt);
  if (
    registrationNumber.length === 0 ||
    issuingAuthority.length === 0 ||
    verifiedAt === null ||
    verifiedAt.getTime() > now.getTime() ||
    (row.expiresAt !== null && expiresAt === null) ||
    (expiresAt !== null && expiresAt.getTime() <= now.getTime())
  ) {
    return null;
  }
  return {
    id: row.id,
    kind: row.kind,
    registrationNumber,
    issuingAuthority,
    jurisdiction: 'IN',
    verifiedAt: verifiedAt.toISOString(),
    expiresAt: expiresAt?.toISOString() ?? null,
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCredentials(
  left: MedicalSigningCredentialSnapshot,
  right: MedicalSigningCredentialSnapshot,
): number {
  const kindOrder = { NMC_REGISTRATION: 0, STATE_MEDICAL_COUNCIL_REGISTRATION: 1 } as const;
  return (
    kindOrder[left.kind] - kindOrder[right.kind] ||
    compareText(left.registrationNumber, right.registrationNumber) ||
    compareText(left.issuingAuthority, right.issuingAuthority) ||
    compareText(left.id, right.id)
  );
}

function capabilityDisabled(capability: PractitionerCapability): boolean {
  return (process.env['ORBIT_DISABLED_CAPABILITIES'] ?? '')
    .split(',')
    .some((raw) => raw.trim() === capability);
}

/**
 * Resolve medical signing authority only after locking every mutable row that
 * can supply or revoke it. The locks live until the caller's transaction
 * atomically commits the note, edits, audit event, and authenticator counter.
 */
export async function lockAndResolveMedicalSigningAuthority(
  tx: Prisma.TransactionClient,
  psychologistId: string,
  now = new Date(),
): Promise<MedicalSigningCredentialSnapshot> {
  const practitioners = await tx.$queryRaw<PractitionerRow[]>`
    SELECT "id", "vertical", "profession", "status", "deletedAt"
    FROM "psychologists"
    WHERE "id" = ${psychologistId}
    FOR UPDATE
  `;
  const credentials = await tx.$queryRaw<CredentialRow[]>`
    SELECT "id", "psychologistId", "kind", "registrationNumber", "issuingAuthority",
           "jurisdiction", "status", "verifiedAt", "expiresAt"
    FROM "practitioner_credentials"
    WHERE "psychologistId" = ${psychologistId}
    FOR UPDATE
  `;
  const practitionerGrants = await tx.$queryRaw<GrantRow[]>`
    SELECT "capability", "source", "active", "revokedAt"
    FROM "practitioner_capability_grants"
    WHERE "psychologistId" = ${psychologistId}
      AND "capability" IN ('PRESCRIPTION_DRAFTING', 'PRESCRIPTION_SIGNING')
    FOR UPDATE
  `;
  const memberships = await tx.$queryRaw<ClinicMembershipRow[]>`
    SELECT "clinicId"
    FROM "clinic_memberships"
    WHERE "psychologistId" = ${psychologistId}
    FOR UPDATE
  `;
  const clinicGrants = await tx.$queryRaw<GrantRow[]>`
    SELECT cg."capability", cg."active", cg."revokedAt"
    FROM "clinic_capability_grants" cg
    INNER JOIN "clinic_memberships" cm ON cm."clinicId" = cg."clinicId"
    WHERE cm."psychologistId" = ${psychologistId}
      AND cg."capability" IN ('PRESCRIPTION_DRAFTING', 'PRESCRIPTION_SIGNING')
    FOR UPDATE OF cg
  `;

  const practitioner = practitioners[0];
  if (!practitioner || practitioner.deletedAt !== null || practitioner.status !== 'ACTIVE') {
    throw new MedicalSigningAuthorizationError('PRACTITIONER_INACTIVE');
  }

  // Reading memberships is itself part of the lock protocol, even though the
  // joined grant query carries the clinic ids. Keep the value observed so a
  // future refactor cannot accidentally remove that serialization point.
  void memberships;

  const hasDraftingAuthority = [...practitionerGrants, ...clinicGrants].some(
    (grant) =>
      grant.capability === 'PRESCRIPTION_DRAFTING' && grant.active && grant.revokedAt === null,
  );
  if (capabilityDisabled('PRESCRIPTION_SIGNING') || !hasDraftingAuthority) {
    throw new MedicalSigningAuthorizationError('MISSING_PRESCRIPTION_SIGNING');
  }

  const selected = credentials
    .map((row) => credentialSnapshot(row, now))
    .filter((snapshot): snapshot is MedicalSigningCredentialSnapshot => snapshot !== null)
    .sort(compareCredentials)[0];
  if (!selected) {
    throw new MedicalSigningAuthorizationError('NO_QUALIFYING_CREDENTIAL');
  }
  return selected;
}
