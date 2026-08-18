import type {
  CapabilityGrantSource,
  PractitionerCapability,
  PractitionerCredentialKind,
  PractitionerCredentialStatus,
  PractitionerProfession,
  PractitionerVertical,
} from '@cureocity/contracts';

export interface CapabilityCredentialInput {
  kind: PractitionerCredentialKind;
  status: PractitionerCredentialStatus;
  jurisdiction: string;
  verifiedAt: Date | string | null;
  expiresAt: Date | string | null;
}

export interface CapabilityGrantInput {
  capability: PractitionerCapability;
  source: CapabilityGrantSource;
  active: boolean;
  revokedAt: Date | string | null;
}

export interface ResolveCapabilitiesInput {
  legacyVertical: PractitionerVertical;
  configuredProfession?: PractitionerProfession | null;
  credentials: CapabilityCredentialInput[];
  grants: CapabilityGrantInput[];
  now?: Date;
}

export interface EffectiveCapabilitySet {
  profession: PractitionerProfession | null;
  capabilities: ReadonlySet<PractitionerCapability>;
  verifiedCredentialKinds: ReadonlySet<PractitionerCredentialKind>;
}

const MEDICAL_CREDENTIALS = new Set<PractitionerCredentialKind>([
  'NMC_REGISTRATION',
  'STATE_MEDICAL_COUNCIL_REGISTRATION',
]);

/**
 * Resolves effective authority. Explicit active grants provide product access;
 * verified, unexpired credentials add only credential-gated authority.
 */
export function resolveEffectiveCapabilities(
  input: ResolveCapabilitiesInput,
): EffectiveCapabilitySet {
  const now = input.now ?? new Date();
  const capabilities = new Set<PractitionerCapability>();
  for (const grant of input.grants) {
    if (grant.active && grant.revokedAt === null) capabilities.add(grant.capability);
  }

  const verifiedCredentialKinds = new Set<PractitionerCredentialKind>();
  for (const credential of input.credentials) {
    const verifiedAt = credential.verifiedAt ? new Date(credential.verifiedAt) : null;
    const expiresAt = credential.expiresAt ? new Date(credential.expiresAt) : null;
    if (
      credential.status === 'VERIFIED' &&
      credential.jurisdiction === 'IN' &&
      verifiedAt !== null &&
      Number.isFinite(verifiedAt.getTime()) &&
      verifiedAt.getTime() <= now.getTime() &&
      (!expiresAt || expiresAt.getTime() > now.getTime())
    ) {
      verifiedCredentialKinds.add(credential.kind);
    }
  }

  const hasMedicalCredential = [...verifiedCredentialKinds].some((kind) =>
    MEDICAL_CREDENTIALS.has(kind),
  );
  if (hasMedicalCredential && capabilities.has('PRESCRIPTION_DRAFTING')) {
    capabilities.add('PRESCRIPTION_SIGNING');
  } else {
    capabilities.delete('PRESCRIPTION_SIGNING');
  }

  const hasRciCredential = verifiedCredentialKinds.has('RCI_REGISTRATION');
  const behavioral = capabilities.has('BEHAVIORAL_HEALTH_DOCUMENTATION');
  const medical = capabilities.has('MEDICAL_DOCUMENTATION');
  let profession: PractitionerProfession | null = null;
  if (input.configuredProfession === 'COUNSELLOR') profession = 'COUNSELLOR';
  else if (input.configuredProfession === 'PSYCHOLOGIST' && hasRciCredential) {
    profession = 'PSYCHOLOGIST';
  } else if (
    input.configuredProfession &&
    input.configuredProfession !== 'PSYCHOLOGIST' &&
    hasMedicalCredential
  ) {
    profession = input.configuredProfession;
  } else if (behavioral && medical && hasMedicalCredential) profession = 'PSYCHIATRIST';
  else if (hasMedicalCredential) profession = 'PHYSICIAN';
  else if (hasRciCredential) profession = 'PSYCHOLOGIST';

  return { profession, capabilities, verifiedCredentialKinds };
}

export function hasCapability(
  effective: EffectiveCapabilitySet,
  capability: PractitionerCapability,
): boolean {
  return effective.capabilities.has(capability);
}
