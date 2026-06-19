import { z } from 'zod';

/**
 * Sprint DV1 scaffold — drug prescription + clinical orders. STUB for DV5.
 *
 * NOTE: this is the DRUG Rx, distinct from the therapy-exercise
 * recommendation in `prescription.ts` — do not overload that one.
 * See docs/DOCTOR_VERTICAL.md §6.
 */
export const MedicationOrderV1Schema = z.object({
  version: z.literal('V1'),
  drug: z.string(),
  form: z.string().optional(),
  strength: z.string().optional(),
  dose: z.string().optional(),
  route: z.string().optional(),
  frequency: z.string().optional(),
  durationDays: z.number().int().positive().optional(),
  prn: z.boolean().default(false),
  instructions: z.string().optional(),
  interactionWarnings: z.array(z.string()).default([]),
});
export type MedicationOrderV1 = z.infer<typeof MedicationOrderV1Schema>;

export const ClinicalOrderV1Schema = z.object({
  version: z.literal('V1'),
  category: z.enum(['LAB', 'IMAGING', 'REFERRAL', 'PROCEDURE']),
  description: z.string(),
  rationale: z.string().optional(),
});
export type ClinicalOrderV1 = z.infer<typeof ClinicalOrderV1Schema>;
