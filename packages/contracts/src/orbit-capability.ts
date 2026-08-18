import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';

export const PractitionerProfessionSchema = z.enum([
  'PSYCHOLOGIST',
  'COUNSELLOR',
  'PSYCHIATRIST',
  'PHYSICIAN',
  'SPECIALIST_PHYSICIAN',
]);

export const PractitionerCredentialKindSchema = z.enum([
  'RCI_REGISTRATION',
  'NMC_REGISTRATION',
  'STATE_MEDICAL_COUNCIL_REGISTRATION',
  'OTHER_CLINICAL_REGISTRATION',
]);

export const PractitionerCredentialStatusSchema = z.enum([
  'PENDING_VERIFICATION',
  'VERIFIED',
  'SUSPENDED',
  'EXPIRED',
  'REVOKED',
]);

export const PractitionerCapabilitySchema = z.enum([
  'AMBIENT_CAPTURE',
  'LIVE_ENCOUNTER',
  'BEHAVIORAL_HEALTH_DOCUMENTATION',
  'MEDICAL_DOCUMENTATION',
  'CLINICAL_ANALYSIS',
  'THERAPY_WORKFLOWS',
  'MEASUREMENT_BASED_CARE',
  'SAFETY_PLANNING',
  'PRESCRIPTION_DRAFTING',
  'PRESCRIPTION_SIGNING',
  'CLINICAL_ORDERS',
  'CHRONIC_CARE',
  'FHIR_EXPORT',
  'ABDM_PUSH',
  'PATIENT_SHARING',
]);

export const CapabilityGrantSourceSchema = z.enum([
  'LEGACY_BACKFILL',
  'VERIFIED_CREDENTIAL',
  'ORGANIZATION_POLICY',
  'ADMIN_OVERRIDE',
]);

export const PractitionerCredentialSchema = z.object({
  id: CuidSchema,
  psychologistId: CuidSchema,
  kind: PractitionerCredentialKindSchema,
  registrationNumber: z.string().min(1).max(120),
  issuingAuthority: z.string().min(1).max(200),
  jurisdiction: z.string().min(2).max(80).default('IN'),
  status: PractitionerCredentialStatusSchema,
  verifiedAt: IsoDateTimeSchema.nullable(),
  expiresAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const PractitionerCapabilityGrantSchema = z.object({
  id: CuidSchema,
  psychologistId: CuidSchema,
  capability: PractitionerCapabilitySchema,
  source: CapabilityGrantSourceSchema,
  active: z.boolean(),
  grantedAt: IsoDateTimeSchema,
  revokedAt: IsoDateTimeSchema.nullable(),
  metadata: z.record(z.unknown()).nullable().default(null),
});

export const EffectiveCapabilitiesSchema = z.object({
  profession: PractitionerProfessionSchema.nullable(),
  capabilities: z.array(PractitionerCapabilitySchema),
  verifiedCredentialKinds: z.array(PractitionerCredentialKindSchema),
});

export type PractitionerProfession = z.infer<typeof PractitionerProfessionSchema>;
export type PractitionerCredentialKind = z.infer<typeof PractitionerCredentialKindSchema>;
export type PractitionerCredentialStatus = z.infer<typeof PractitionerCredentialStatusSchema>;
export type PractitionerCapability = z.infer<typeof PractitionerCapabilitySchema>;
export type CapabilityGrantSource = z.infer<typeof CapabilityGrantSourceSchema>;
export type PractitionerCredential = z.infer<typeof PractitionerCredentialSchema>;
export type PractitionerCapabilityGrant = z.infer<typeof PractitionerCapabilityGrantSchema>;
export type EffectiveCapabilities = z.infer<typeof EffectiveCapabilitiesSchema>;

export const PRESCRIPTION_CAPABILITIES = [
  'PRESCRIPTION_DRAFTING',
  'PRESCRIPTION_SIGNING',
] as const satisfies readonly PractitionerCapability[];
