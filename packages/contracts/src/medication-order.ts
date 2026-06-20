import { z } from 'zod';

/**
 * Sprint DV1 scaffold → Sprint DV5. Drug prescription + clinical orders.
 *
 * NOTE: this is the DRUG Rx, distinct from the therapy-exercise
 * recommendation in `prescription.ts` — do not overload that one.
 * `MedicationOrderV1` / `ClinicalOrderV1` are the clinical CONTENT; the
 * DB row wraps them with id / status / timestamps (see the DTOs below
 * and the `MedicationOrder` / `ClinicalOrder` Prisma models).
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

// ============================================================================
// Sprint DV5 — order lifecycle. The AI drafts orders (DRAFT); the doctor
// confirms each (CONFIRMED) or discards it (DISCARDED). Nothing is ever
// "auto-prescribed" — confirmation is an explicit clinical act.
// ============================================================================

export const OrderStatusSchema = z.enum(['DRAFT', 'CONFIRMED', 'DISCARDED']);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/** A persisted medication order row → DTO (content + lifecycle). */
export const MedicationOrderDTOSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  status: OrderStatusSchema,
  content: MedicationOrderV1Schema,
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
});
export type MedicationOrderDTO = z.infer<typeof MedicationOrderDTOSchema>;

/** A persisted clinical (lab / imaging / referral) order row → DTO. */
export const ClinicalOrderDTOSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  status: OrderStatusSchema,
  content: ClinicalOrderV1Schema,
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
});
export type ClinicalOrderDTO = z.infer<typeof ClinicalOrderDTOSchema>;

/** GET /sessions/[id]/orders response. */
export const SessionOrdersSchema = z.object({
  medications: z.array(MedicationOrderDTOSchema),
  clinicalOrders: z.array(ClinicalOrderDTOSchema),
});
export type SessionOrders = z.infer<typeof SessionOrdersSchema>;

/**
 * PATCH /medication-orders/[id] body. The doctor confirms (optionally
 * editing dose / frequency / duration / instructions first) or discards.
 * `interactionWarnings` is server-owned — re-run, never client-supplied.
 */
export const UpdateMedicationOrderInputSchema = z.object({
  status: z.enum(['CONFIRMED', 'DISCARDED']),
  edits: MedicationOrderV1Schema.pick({
    dose: true,
    frequency: true,
    durationDays: true,
    instructions: true,
  })
    .partial()
    .optional(),
});
export type UpdateMedicationOrderInput = z.infer<typeof UpdateMedicationOrderInputSchema>;

/** PATCH /clinical-orders/[id] body — confirm or discard a lab/imaging/referral. */
export const UpdateClinicalOrderInputSchema = z.object({
  status: z.enum(['CONFIRMED', 'DISCARDED']),
});
export type UpdateClinicalOrderInput = z.infer<typeof UpdateClinicalOrderInputSchema>;
