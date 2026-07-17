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

/**
 * Sprint DS10-B — provenance of a pad row. `dictated` = spoken during the
 * consult (voice/AI-drafted from the transcript); `ai` = adopted from the
 * differential's suggested plan with an explicit tap; `manual` = typed by
 * the doctor in the plan composer. Display-only — safety is carried by
 * `status` (only `confirmed` rows are prescribed), not by source.
 */
export const RxRowSourceSchema = z.enum(['dictated', 'ai', 'manual']);
export type RxRowSource = z.infer<typeof RxRowSourceSchema>;

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
  /** Sprint DS10-B — provenance badge (absent on pre-DS10 rows = dictated). */
  source: RxRowSourceSchema.optional(),
  /**
   * Sprint DS11.5-fu — for a HEARD (voice-dictated) row, the id of the
   * utterance it was spoken in. Powers the 🗣 quote-chip that scroll-highlights
   * the source in the live transcript. Absent on continued/AI-drafted rows.
   */
  utteranceId: z.string().optional(),
});
export type RxMedRow = z.infer<typeof RxMedRowSchema>;

export const RxInvestigationSchema = z.object({
  name: z.string(),
  rationale: z.string().optional(),
  /** Sprint DS10-B — provenance badge (absent on pre-DS10 rows = dictated). */
  source: RxRowSourceSchema.optional(),
  /** Sprint DS11.5-fu — source utterance for a heard investigation chip. */
  utteranceId: z.string().optional(),
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

// ============================================================================
// Sprint DS10-B — the plan composer. PATCH /sessions/:id/rx-pad applies a
// typed edit to the DRAFT pad (never a signed one): the doctor adopts an AI
// suggestion, adds an item manually, confirms a pending med, or removes a
// row. Every op is audited (RX_PAD_EDITED); interaction warnings are
// recomputed server-side after every med change.

/** A med being added (adopted from AI or typed manually). */
export const RxPadAddMedSchema = z.object({
  op: z.literal('addMed'),
  source: RxRowSourceSchema,
  med: z.object({
    drug: z.string().min(1).max(120),
    strength: z.string().max(60).optional(),
    dose: z.string().max(60).optional(),
    frequency: z.string().max(60).optional(),
    timing: z.string().max(60).optional(),
    durationDays: z.number().int().positive().max(365).optional(),
    route: z.string().max(40).optional(),
    /**
     * Sprint DS12 — preserve the carried-forward badge when a continued med
     * is re-added by a voice change or an undo restore. Display provenance
     * only; the prescribing decision is still carried by `status`.
     */
    continued: z.boolean().optional(),
  }),
});

export const RxPadPatchOpSchema = z.discriminatedUnion('op', [
  RxPadAddMedSchema,
  z.object({ op: z.literal('removeMed'), drug: z.string().min(1).max(120) }),
  /** Flip a pending (voice/AI-drafted) med to confirmed — the prescribe tap. */
  z.object({ op: z.literal('confirmMed'), drug: z.string().min(1).max(120) }),
  /**
   * Sprint DS12 — flip a confirmed med back to pending. The inverse of
   * confirmMed; lets the voice-edit Undo restore a removed PENDING row
   * without silently elevating it to prescribed (nothing auto-prescribes).
   */
  z.object({ op: z.literal('unconfirmMed'), drug: z.string().min(1).max(120) }),
  z.object({
    op: z.literal('addInvestigation'),
    source: RxRowSourceSchema,
    name: z.string().min(1).max(200),
    rationale: z.string().max(300).optional(),
  }),
  z.object({ op: z.literal('removeInvestigation'), name: z.string().min(1).max(200) }),
  z.object({
    op: z.literal('addAdvice'),
    source: RxRowSourceSchema,
    text: z.string().min(1).max(300),
  }),
  z.object({ op: z.literal('removeAdvice'), text: z.string().min(1).max(300) }),
  z.object({
    op: z.literal('setFollowUp'),
    source: RxRowSourceSchema,
    when: z.string().min(1).max(120),
    withWhat: z.string().max(200).optional(),
  }),
  z.object({ op: z.literal('clearFollowUp') }),
]);
export type RxPadPatchOp = z.infer<typeof RxPadPatchOpSchema>;

export const RxPadPatchInputSchema = z.object({
  ops: z.array(RxPadPatchOpSchema).min(1).max(10),
});
export type RxPadPatchInput = z.infer<typeof RxPadPatchInputSchema>;

/** GET/PATCH /sessions/:id/rx-pad response — the current draft pad. */
export const RxPadResponseSchema = z.object({
  rxPad: RxPadDraftSchema.nullable(),
  /** True once the note is signed — the pad is then read-only. */
  signed: z.boolean(),
});
export type RxPadResponse = z.infer<typeof RxPadResponseSchema>;
