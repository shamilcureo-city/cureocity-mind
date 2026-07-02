import { z } from 'zod';

/**
 * Sprint DS1 — the reasoning substrate for the doctor live copilot.
 *
 * A per-consult `CaseState` is the memory the live reasoning engine writes
 * to and reads from. It holds the patient context (seeded from the DB at
 * consult start) and the ordered list of structured clinical findings that
 * the differential (DS2) and ask-next (DS3) engines cite by id.
 *
 * This file imports NOTHING from `live-encounter.ts` — the wire protocol
 * imports FROM here (one direction) so there is no schema-eval cycle. The
 * PassFindings input/output types live in `@cureocity/llm` types (which
 * already depend on these contracts).
 *
 * Safety: every finding carries the utterance ids that justify it
 * (citation-gated — see DOCTOR_SCRIBE_V2_SPRINTS.md §0.1). Findings whose
 * citations don't resolve to a real utterance are dropped before they ever
 * reach the case state; this is the hallucination control.
 */

/// Patient context, seeded from the DB when the consult starts. All fields
/// optional/empty-safe so a thin start payload still works.
export const PatientContextSchema = z.object({
  age: z.number().int().nonnegative().max(150).optional(),
  sex: z.enum(['male', 'female', 'other', 'unknown']).default('unknown'),
  knownConditions: z.array(z.string()).default([]),
  activeMeds: z.array(z.string()).default([]),
  allergies: z.array(z.string()).default([]),
});
export type PatientContext = z.infer<typeof PatientContextSchema>;

/// The kind of clinical atom a finding represents.
export const ClinicalFindingKindSchema = z.enum([
  'symptom',
  'sign',
  'vital',
  'history',
  'negative',
  'medication',
  'social',
]);
export type ClinicalFindingKind = z.infer<typeof ClinicalFindingKindSchema>;

/// Whether the finding is asserted, explicitly denied, or unknown. A
/// `negative` kind ("no chest pain") is polarity `denied`.
export const FindingPolaritySchema = z.enum(['present', 'denied', 'unknown']);
export type FindingPolarity = z.infer<typeof FindingPolaritySchema>;

/// One structured clinical finding extracted from the transcript. `id` is
/// model-assigned + stable across updates so the differential can cite it
/// and the UI can animate rather than flicker.
export const ClinicalFindingSchema = z.object({
  id: z.string(),
  kind: ClinicalFindingKindSchema,
  /** Short clinical label, e.g. "exertional chest pressure". */
  label: z.string(),
  /** Optional qualifier, e.g. "×2 days, relieved by rest". */
  detail: z.string().optional(),
  /** Citation into the transcript — the utterance ids that justify this. */
  utteranceIds: z.array(z.string()).default([]),
  polarity: FindingPolaritySchema.default('present'),
});
export type ClinicalFinding = z.infer<typeof ClinicalFindingSchema>;

/// The full per-consult reasoning state. `version` is monotonic so the
/// client can render idempotently and drop superseded updates.
export const CaseStateSchema = z.object({
  patient: PatientContextSchema,
  findings: z.array(ClinicalFindingSchema).default([]),
  /** Ask-next question ids the extractor has seen answered on-mic. */
  answeredQuestionIds: z.array(z.string()).default([]),
  version: z.number().int().nonnegative().default(0),
});
export type CaseState = z.infer<typeof CaseStateSchema>;
