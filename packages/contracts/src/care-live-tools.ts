import { z } from 'zod';

/**
 * Cureocity Care — CP2 live structure tools (docs/CARE_PSYCHOLOGIST.md §CP2).
 *
 * The live session's machine-readable work record: the model drives session
 * structure through silent tool calls; the browser renders them (phase rail,
 * worksheet card, moment toast, homework card) and mirrors each one to the
 * server as a CareLiveEvent row — so the report is grounded in the work that
 * actually happened, not prose reverse-engineered from a transcript.
 *
 * Design law (CARE_PSYCHOLOGIST.md §Design): the LLM converses; deterministic
 * code keeps time, structure, and state. These schemas are the contract for
 * both sides.
 */

/// log_moment — a clinically important moment, with the user's OWN words
/// (anti-Barnum: verbatim quotes, never paraphrase presented as quote).
export const CareLogMomentArgsSchema = z.object({
  type: z.enum(['INSIGHT', 'QUOTE', 'SKILL']),
  text: z.string().min(1).max(300),
  quote: z.string().max(500).optional(),
});
export type CareLogMomentArgs = z.infer<typeof CareLogMomentArgsSchema>;

/// worksheet_update — today's method worked onto a shared sheet, field by
/// field, as the conversation produces them. The user watches it fill in.
export const CareWorksheetKeySchema = z.enum([
  'THOUGHT_RECORD',
  'ACTIVITY_PLAN',
  'GROUNDING_KIT',
  'SLEEP_PLAN',
]);
export type CareWorksheetKey = z.infer<typeof CareWorksheetKeySchema>;

export const CareWorksheetUpdateArgsSchema = z.object({
  worksheetKey: CareWorksheetKeySchema,
  /// Short free-text fields (situation, hot_thought, evidence_for, …).
  fields: z.record(z.string(), z.string().max(400)),
});
export type CareWorksheetUpdateArgs = z.infer<typeof CareWorksheetUpdateArgsSchema>;

/// assign_homework — the agreed week's practice, structured (not one string).
export const CareAssignHomeworkArgsSchema = z.object({
  title: z.string().min(1).max(160),
  steps: z.array(z.string().min(1).max(160)).min(1).max(5),
  whyItHelps: z.string().max(300).catch(''),
});
export type CareAssignHomeworkArgs = z.infer<typeof CareAssignHomeworkArgsSchema>;

/// The persisted live-event envelope — one row per tool signal, idempotent by
/// (careSessionId, seq). AGENDA_SET is reserved for the set_agenda tool
/// (next CP2 slice); the schema accepts it so the wire is forward-compatible.
export const CareLiveEventTypeSchema = z.enum([
  'AGENDA_SET',
  'PHASE_MARKED',
  'MOMENT_LOGGED',
  'WORKSHEET_UPDATED',
  'HOMEWORK_ASSIGNED',
]);
export type CareLiveEventType = z.infer<typeof CareLiveEventTypeSchema>;

export const CareLiveEventSchema = z.object({
  /// Monotonic per-session sequence number — server dedupes on it.
  seq: z.number().int().nonnegative(),
  type: CareLiveEventTypeSchema,
  /// The tool's (client-validated) args, stored as-is for the report.
  payload: z.record(z.string(), z.unknown()),
  /// Milliseconds since session start.
  atMs: z.number().int().nonnegative(),
});
export type CareLiveEvent = z.infer<typeof CareLiveEventSchema>;

export const MirrorLiveEventsInputSchema = z.object({
  events: z.array(CareLiveEventSchema).min(1).max(50),
});
export type MirrorLiveEventsInput = z.infer<typeof MirrorLiveEventsInputSchema>;
