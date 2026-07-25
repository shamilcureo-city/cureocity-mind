import { z } from 'zod';
import { Icd11CodeSchema } from './clinical';

/**
 * Direct edits to a confirmed diagnosis — PC3.
 *
 * A `ClientDiagnosis` row is created when the therapist confirms a Pass-3
 * candidate, so every row is anchored to the session + clinical report that
 * proposed it (both FKs are required). That anchoring is worth keeping — it
 * is what makes a diagnosis auditable back to the evidence.
 *
 * What it did NOT allow was fixing one afterwards. A mistyped code, a label
 * the therapist words differently, the wrong row marked primary, or a
 * diagnosis that no longer holds all required going back through the copilot,
 * and removal was impossible. These schemas cover correcting and retiring a
 * diagnosis in place, without loosening the provenance FKs.
 *
 * Retiring is a supersede (`supersededAt`), never a delete: the row stays in
 * the history the Diagnosis History card reads, so the record shows the
 * clinical picture changing rather than silently losing a row.
 */

export const UpdateClientDiagnosisInputSchema = z
  .object({
    icd11Code: Icd11CodeSchema.optional(),
    icd11Label: z.string().trim().min(1).max(300).optional(),
    /** Promote to primary. Demoting is implicit — promote another row. */
    isPrimary: z.literal(true).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine(
    (v) =>
      v.icd11Code !== undefined ||
      v.icd11Label !== undefined ||
      v.isPrimary !== undefined ||
      v.notes !== undefined,
    { message: 'Provide at least one field to update.' },
  );
export type UpdateClientDiagnosisInput = z.infer<typeof UpdateClientDiagnosisInputSchema>;

/** Why a diagnosis is being retired — kept for the clinical record. */
export const RetireClientDiagnosisInputSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type RetireClientDiagnosisInput = z.infer<typeof RetireClientDiagnosisInputSchema>;

export const ClientDiagnosisItemSchema = z.object({
  id: z.string(),
  icd11Code: z.string(),
  icd11Label: z.string(),
  isPrimary: z.boolean(),
  notes: z.string().nullable(),
  confirmedAt: z.string(),
  supersededAt: z.string().nullable(),
});
export type ClientDiagnosisItem = z.infer<typeof ClientDiagnosisItemSchema>;
