import { z } from 'zod';
import { RxPadPatchOpSchema } from './rx-pad';

/**
 * Sprint DS12 — voice-edit the plan.
 *
 * After the consult the doctor reviews the AI-drafted plan and speaks ONE
 * instruction ("change amlodipine to 10, add atorvastatin 20 at night,
 * drop the ECG"). A dedicated Gemini pass turns that speech into TYPED edit
 * commands against the current Rx pad; a deterministic mapper resolves them
 * into the existing DS10-B `RxPadPatchOp`s and the doctor approves the
 * result as a diff. Nothing applies silently — the apply tap goes through
 * the audited PATCH /rx-pad route, which recomputes interaction warnings
 * server-side.
 *
 * Field length caps mirror the RxPadPatchOp caps so a valid command always
 * maps onto a valid pad op.
 */

/** One edit the model believes the doctor asked for. */
export const PlanEditCommandSchema = z.discriminatedUnion('action', [
  /** Prescribe a med that is not on the pad yet. */
  z.object({
    action: z.literal('addMed'),
    drug: z.string().min(1).max(120),
    strength: z.string().max(60).optional(),
    dose: z.string().max(60).optional(),
    frequency: z.string().max(60).optional(),
    timing: z.string().max(60).optional(),
    durationDays: z.number().int().positive().max(365).optional(),
    route: z.string().max(40).optional(),
  }),
  /**
   * Change fields on a med already on the pad. Only the provided fields
   * change; `drug` should match the pad row (the mapper resolves
   * case-insensitively and falls back to addMed when the drug is absent).
   */
  z.object({
    action: z.literal('changeMed'),
    drug: z.string().min(1).max(120),
    strength: z.string().max(60).optional(),
    dose: z.string().max(60).optional(),
    frequency: z.string().max(60).optional(),
    timing: z.string().max(60).optional(),
    durationDays: z.number().int().positive().max(365).optional(),
    route: z.string().max(40).optional(),
  }),
  z.object({ action: z.literal('removeMed'), drug: z.string().min(1).max(120) }),
  z.object({
    action: z.literal('addInvestigation'),
    name: z.string().min(1).max(200),
    rationale: z.string().max(300).optional(),
  }),
  z.object({ action: z.literal('removeInvestigation'), name: z.string().min(1).max(200) }),
  z.object({ action: z.literal('addAdvice'), text: z.string().min(1).max(300) }),
  z.object({ action: z.literal('removeAdvice'), text: z.string().min(1).max(300) }),
  z.object({
    action: z.literal('setFollowUp'),
    when: z.string().min(1).max(120),
    withWhat: z.string().max(200).optional(),
  }),
  z.object({ action: z.literal('clearFollowUp') }),
]);
export type PlanEditCommand = z.infer<typeof PlanEditCommandSchema>;

/** The plan-dictation pass output: commands + questions it refused to guess. */
export const PlanDictationV1Schema = z.object({
  version: z.literal('V1').default('V1'),
  edits: z.array(PlanEditCommandSchema).max(20).default([]),
  /**
   * When the instruction is ambiguous (which drug? which unit?) the model
   * asks instead of guessing — clinical safety over convenience.
   */
  clarifications: z.array(z.string().min(1).max(300)).max(10).default([]),
});
export type PlanDictationV1 = z.infer<typeof PlanDictationV1Schema>;

/**
 * One reviewed line of the proposed diff. `ops` are the ready-to-apply pad
 * ops for THIS line (a changed med is remove + re-add), so the doctor can
 * apply or exclude lines individually.
 */
export const PlanEditChangeSchema = z.object({
  kind: z.enum(['add', 'change', 'remove']),
  target: z.enum(['med', 'investigation', 'advice', 'followUp']),
  /** Short human label, e.g. "Atorvastatin 20 mg · HS". */
  label: z.string(),
  /** For `change`/`remove`: the row as it reads today. */
  before: z.string().optional(),
  /** For `add`/`change`: the row as it would read after applying. */
  after: z.string().optional(),
  /** NEW interaction warnings this change would introduce (server-computed). */
  warnings: z.array(z.string()).default([]),
  ops: z.array(RxPadPatchOpSchema).min(1),
});
export type PlanEditChange = z.infer<typeof PlanEditChangeSchema>;

/** POST /sessions/:id/plan-dictation response — a proposal, never a write. */
export const PlanDictationProposalSchema = z.object({
  /** What was heard (the ASR transcript, or the typed text passed through). */
  transcript: z.string(),
  changes: z.array(PlanEditChangeSchema),
  clarifications: z.array(z.string()),
  /** Commands that could not be resolved against the pad, in plain words. */
  skipped: z.array(z.string()),
});
export type PlanDictationProposal = z.infer<typeof PlanDictationProposalSchema>;

/**
 * POST /sessions/:id/plan-dictation request. Either the doctor's typed text
 * or a short spoken clip (16 kHz mono s16le PCM, base64) with its duration.
 * 90s of 16 kHz PCM ≈ 2.9 MB → ~3.9 M base64 chars is the hard ceiling.
 */
export const PlanDictationRequestSchema = z
  .object({
    text: z.string().min(1).max(2_000).optional(),
    audioBase64: z
      .string()
      .min(1)
      .max(4_000_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'audioBase64 must be base64')
      .optional(),
    durationMs: z.number().int().positive().max(90_000).optional(),
  })
  .refine((v) => v.text !== undefined || v.audioBase64 !== undefined, {
    message: 'Provide text or audioBase64',
  })
  .refine((v) => v.audioBase64 === undefined || v.durationMs !== undefined, {
    message: 'durationMs is required with audioBase64',
  });
export type PlanDictationRequest = z.infer<typeof PlanDictationRequestSchema>;
