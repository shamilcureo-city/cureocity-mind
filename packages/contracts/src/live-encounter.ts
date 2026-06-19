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
// Sprint DV6.4 — mid-consult voice commands. A deterministic parser (in
// @cureocity/clinical) scans the rolling transcript for spoken commands
// ("add paracetamol 500 TDS x 3 days", "order ECG", "show last HbA1c")
// and the gateway surfaces them as a `command` event. The doctor confirms;
// nothing is auto-applied. See docs/DOCTOR_VERTICAL_SPRINTS.md DV6.4.
// ============================================================================

export const VoiceCommandSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ADD_MEDICATION'),
    /** The transcript clause the command was parsed from. */
    raw: z.string(),
    drug: z.string(),
    strength: z.string().optional(),
    frequency: z.string().optional(),
    durationDays: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal('ORDER_TEST'),
    raw: z.string(),
    description: z.string(),
  }),
  z.object({
    kind: z.literal('SHOW_DATA'),
    raw: z.string(),
    measure: z.enum(['BP', 'HBA1C', 'FBS', 'LDL', 'WEIGHT']),
  }),
]);
export type VoiceCommand = z.infer<typeof VoiceCommandSchema>;

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

/// Gateway → client events: the three rails + lifecycle status + (DV6.4)
/// recognised voice commands.
export const LiveGatewayEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), state: LiveGatewayStateSchema }),
  z.object({ type: z.literal('transcript'), delta: LiveTranscriptDeltaSchema }),
  z.object({ type: z.literal('note'), partial: PartialStructuredNoteSchema }),
  z.object({ type: z.literal('gap'), gap: EncounterGapSchema }),
  z.object({ type: z.literal('final'), note: MedicalEncounterNoteV1Schema }),
  z.object({ type: z.literal('command'), command: VoiceCommandSchema }),
]);
export type LiveGatewayEvent = z.infer<typeof LiveGatewayEventSchema>;
