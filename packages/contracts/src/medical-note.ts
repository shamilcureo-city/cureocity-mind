import { z } from 'zod';

/**
 * Doctor encounter-note contracts. DV1 scaffold → DV3 production shape.
 *
 * Mirrors the lenience of the therapy notes (packages/contracts/src/note.ts):
 * narrative fields are plain strings (Gemini is unpredictable about deep
 * structure), while the physical exam is GUARDED so the model cannot
 * invent findings. See docs/DOCTOR_VERTICAL.md §6, §10.
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

/// One note statement traced back to the transcript segment + timestamp
/// that produced it — the anti-hallucination "linked evidence" mechanism.
export const EvidenceRefSchema = z.object({
  segmentId: z.string().optional(),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
  quote: z.string().optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

/// Only the vitals explicitly stated in the consult — every field
/// optional; the prompt omits anything not said (never guesses).
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

/**
 * GUARDED physical exam (docs/DOCTOR_VERTICAL.md §10): the #1 hallucination
 * risk in ambient scribes is a documented exam that never happened. The
 * default is "not examined" — the prompt must only set examined=true with
 * findings the doctor explicitly stated.
 */
export const PhysicalExamSchema = z.object({
  examined: z.boolean().default(false),
  findings: z.string().default(''),
});
export type PhysicalExam = z.infer<typeof PhysicalExamSchema>;

export const MedicalEncounterNoteV1Schema = z.object({
  version: z.literal('V1'),
  /// The encounter kind (NEW_OPD, FOLLOW_UP, …). Named `encounterKind` to
  /// avoid colliding with the Pass-2 output discriminator (`kind`).
  encounterKind: MedicalSessionKindSchema.default('NEW_OPD'),
  chiefComplaint: z.string().default(''),
  /// History of present illness — an OLDCART narrative.
  hpi: z.string().default(''),
  /// Pertinent positives/negatives, one short entry per system touched.
  reviewOfSystems: z.array(z.string()).default([]),
  physicalExam: PhysicalExamSchema.default({}),
  vitals: VitalsSchema.default({}),
  /// Clinical impression + working diagnosis (+ relevant differentials).
  assessment: z.string().default(''),
  /// Investigations, medications, advice, follow-up.
  plan: z.string().default(''),
  /// Per-statement provenance back to the transcript (anti-hallucination).
  linkedEvidence: z.array(EvidenceRefSchema).default([]),
});
export type MedicalEncounterNoteV1 = z.infer<typeof MedicalEncounterNoteV1Schema>;
