import { z } from 'zod';

/**
 * Sprint DV1 scaffold — doctor encounter-note contracts.
 *
 * STUB: shapes are placeholders for the DV3 batch medical-note sprint.
 * Kept minimal + permissive (every field defaulted) so the doctor
 * vertical compiles end-to-end now; fields tighten (OLDCART HPI, ROS,
 * guarded PE/vitals, linkedEvidence) when DV3 lands.
 * See docs/DOCTOR_VERTICAL.md §6.
 */

/// Super-specialty OPD encounter kinds — the doctor analogue of the
/// therapy `SessionKind`. Append-only.
export const MedicalSessionKindSchema = z.enum([
  'NEW_OPD',
  'FOLLOW_UP',
  'PROCEDURE',
  'REVIEW_REPORTS',
  'TELECONSULT',
]);
export type MedicalSessionKind = z.infer<typeof MedicalSessionKindSchema>;

/// One note field traced back to the transcript segment + timestamp that
/// produced it — the anti-hallucination "linked evidence" mechanism.
export const EvidenceRefSchema = z.object({
  segmentId: z.string().optional(),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
  quote: z.string().optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const VitalsSchema = z.object({
  bpSystolic: z.number().int().positive().optional(),
  bpDiastolic: z.number().int().positive().optional(),
  heartRateBpm: z.number().int().positive().optional(),
  respRateBpm: z.number().int().positive().optional(),
  tempCelsius: z.number().optional(),
  spo2Pct: z.number().int().min(0).max(100).optional(),
  weightKg: z.number().positive().optional(),
});
export type Vitals = z.infer<typeof VitalsSchema>;

export const MedicalEncounterNoteV1Schema = z.object({
  version: z.literal('V1'),
  kind: MedicalSessionKindSchema.default('NEW_OPD'),
  chiefComplaint: z.string().default(''),
  hpi: z.string().default(''),
  reviewOfSystems: z.array(z.string()).default([]),
  /// Physical exam is GUARDED (DV3): never model-invented; doctor confirms.
  physicalExam: z.string().default(''),
  vitals: VitalsSchema.default({}),
  assessment: z.string().default(''),
  plan: z.string().default(''),
  linkedEvidence: z.array(EvidenceRefSchema).default([]),
});
export type MedicalEncounterNoteV1 = z.infer<typeof MedicalEncounterNoteV1Schema>;
