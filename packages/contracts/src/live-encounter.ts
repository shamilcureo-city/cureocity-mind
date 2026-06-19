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

// ============================================================================
// Sprint DV4 — live gateway wire protocol. The doctor's browser opens a
// WebSocket to the streaming gateway (a standalone in-region service —
// Vercel can't hold a socket). The gateway streams the three rails +
// lifecycle; the client sends start/stop. Both sides validate with these
// schemas. See docs/DOCTOR_VERTICAL.md §4 + services/live-gateway.
// ============================================================================

/// Client → gateway commands.
export const LiveGatewayCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    sessionId: z.string().optional(),
    specialty: z.string().optional(),
  }),
  z.object({ type: z.literal('stop') }),
]);
export type LiveGatewayCommand = z.infer<typeof LiveGatewayCommandSchema>;

export const LiveGatewayStateSchema = z.enum(['connected', 'listening', 'finalizing', 'done']);
export type LiveGatewayState = z.infer<typeof LiveGatewayStateSchema>;

/// Gateway → client events: the three rails + lifecycle status.
export const LiveGatewayEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), state: LiveGatewayStateSchema }),
  z.object({ type: z.literal('transcript'), delta: LiveTranscriptDeltaSchema }),
  z.object({ type: z.literal('note'), partial: PartialStructuredNoteSchema }),
  z.object({ type: z.literal('gap'), gap: EncounterGapSchema }),
  z.object({ type: z.literal('final'), note: MedicalEncounterNoteV1Schema }),
]);
export type LiveGatewayEvent = z.infer<typeof LiveGatewayEventSchema>;
