import { z } from 'zod';

/**
 * Sprint DV8.2 — ABDM (Ayushman Bharat Digital Mission) push DTOs. Link
 * the patient's ABHA address and push the encounter's prescription
 * (as a FHIR Bundle) to their ABDM PHR. The real HIP/gateway call is
 * env-gated (ABDM sandbox creds); the adapter + mock are wired so the
 * flow runs end-to-end in dev. See docs/DOCTOR_VERTICAL_SPRINTS.md DV8.
 */

/** A 14-digit ABHA number or an ABHA address (handle@domain). */
const AbhaAddressSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[\w.-]+@[\w.-]+$|^\d{2}-?\d{4}-?\d{4}-?\d{4}$/, 'Enter a valid ABHA address or number');

export const AbdmPushInputSchema = z.object({
  /** Optional — links + persists this ABHA on the patient if given;
   *  otherwise the patient's already-linked ABHA is used. */
  abhaAddress: AbhaAddressSchema.optional(),
});
export type AbdmPushInput = z.infer<typeof AbdmPushInputSchema>;

export const AbdmPushResultSchema = z.object({
  pushed: z.boolean(),
  /** PHR document reference returned by the gateway (null on mock/failure). */
  phrReference: z.string().nullable(),
  abhaAddress: z.string(),
  /** 'mock' | 'gateway' — which adapter handled the push. */
  provider: z.string(),
  /** FHIR resource count pushed, for the UI confirmation. */
  resourceCount: z.number().int().nonnegative(),
});
export type AbdmPushResult = z.infer<typeof AbdmPushResultSchema>;
