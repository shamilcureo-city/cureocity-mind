import { z } from 'zod';
import { EvidenceRefSchema, MedicalEncounterNoteV1Schema } from './medical-note';

/**
 * Sprint DV1 scaffold — the streaming / live contracts (Rails 1–3 of the
 * live copilot). STUB for the DV4 live-path sprint.
 * See docs/DOCTOR_VERTICAL.md §4, §6.
 */

/// Rail 1 — an interim/final ASR token delta.
export const LiveTranscriptDeltaSchema = z.object({
  text: z.string(),
  isFinal: z.boolean().default(false),
  speaker: z.enum(['doctor', 'patient', 'unknown']).default('unknown'),
  startMs: z.number().int().nonnegative().optional(),
  endMs: z.number().int().nonnegative().optional(),
});
export type LiveTranscriptDelta = z.infer<typeof LiveTranscriptDeltaSchema>;

/// Rail 2 — the incremental structured note, emitted repeatedly during
/// the consult. A partial of the final encounter note.
export const PartialStructuredNoteSchema = MedicalEncounterNoteV1Schema.partial();
export type PartialStructuredNote = z.infer<typeof PartialStructuredNoteSchema>;

/// Rail 3 — a live gap / red-flag / coding nudge surfaced mid-consult.
export const EncounterGapKindSchema = z.enum([
  'MISSING_QUESTION',
  'RED_FLAG',
  'DRUG_INTERACTION',
  'CODING',
]);
export type EncounterGapKind = z.infer<typeof EncounterGapKindSchema>;

export const EncounterGapSchema = z.object({
  kind: EncounterGapKindSchema,
  severity: z.enum(['info', 'warn', 'critical']).default('info'),
  message: z.string(),
  evidenceRef: EvidenceRefSchema.optional(),
});
export type EncounterGap = z.infer<typeof EncounterGapSchema>;
