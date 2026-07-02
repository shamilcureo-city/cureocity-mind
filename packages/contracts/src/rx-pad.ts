import { z } from 'zod';

/**
 * Sprint DS5 — the Rx-first artifact (the pad).
 *
 * The prescription assembles LIVE as the doctor talks and becomes the
 * signable Indian Rx pad at the end of the consult. It's a structured
 * re-presentation of what already flows through the pipeline — the drafted
 * medications + clinical orders + assessment — plus the patient's continued
 * meds (auto-carried from context) and any spoken meds (confirm-first).
 *
 * Safety (DOCTOR_SCRIBE_V2_SPRINTS.md §0.1): nothing auto-prescribes. A
 * `pending` row is an AI/voice suggestion the doctor must confirm; a
 * `continued` row is a known active med carried forward; only `confirmed`
 * rows are the doctor's prescription. This file imports nothing from the
 * wire protocol — the wire protocol imports FROM here.
 */

/// Where a med row came from + whether the doctor has confirmed it.
export const RxRowStatusSchema = z.enum(['confirmed', 'pending']);
export type RxRowStatus = z.infer<typeof RxRowStatusSchema>;

export const RxMedRowSchema = z.object({
  drug: z.string(),
  strength: z.string().optional(),
  dose: z.string().optional(),
  /** Indian dosing shorthand, e.g. "1-0-1" (morning-noon-night). */
  frequency: z.string().optional(),
  /** e.g. "after food". */
  timing: z.string().optional(),
  durationDays: z.number().int().positive().optional(),
  route: z.string().optional(),
  /** A continued med carried from the patient's active list. */
  continued: z.boolean().default(false),
  /** `pending` rows (AI/voice-drafted) need an explicit confirm tap. */
  status: RxRowStatusSchema.default('pending'),
  /** Deterministic interaction warnings (server-owned). */
  warnings: z.array(z.string()).default([]),
});
export type RxMedRow = z.infer<typeof RxMedRowSchema>;

export const RxInvestigationSchema = z.object({
  name: z.string(),
  rationale: z.string().optional(),
});
export type RxInvestigation = z.infer<typeof RxInvestigationSchema>;

export const RxFollowUpSchema = z.object({
  when: z.string(),
  withWhat: z.string().optional(),
});
export type RxFollowUp = z.infer<typeof RxFollowUpSchema>;

/// The full Rx pad (finalized at End).
export const RxPadV1Schema = z.object({
  version: z.literal('V1').default('V1'),
  /** The diagnosis / impression line at the top of the pad. */
  dxLine: z.string().default(''),
  meds: z.array(RxMedRowSchema).default([]),
  investigations: z.array(RxInvestigationSchema).default([]),
  /** Plain-language advice (bilingual copy is allowed). */
  adviceLines: z.array(z.string()).default([]),
  followUp: RxFollowUpSchema.optional(),
  allergies: z.array(z.string()).default([]),
  /** One-line vitals summary, e.g. "BP 148/92 · HR 88". */
  vitalsLine: z.string().optional(),
});
export type RxPadV1 = z.infer<typeof RxPadV1Schema>;

/// The live, partial pad emitted mid-consult as it assembles.
export const RxPadDraftSchema = RxPadV1Schema.partial();
export type RxPadDraft = z.infer<typeof RxPadDraftSchema>;
