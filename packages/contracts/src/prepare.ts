import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';
import { PreSessionBriefV1Schema } from './brief';
import { JourneyActivePlanSchema, JourneyStageSchema, NextBestActionSchema } from './journey';
import { InstrumentChangeSchema } from './instrument';

/**
 * Sprint 50 — Prepare panel summary.
 *
 * What the Today screen renders inside the expandable "Prepare" view
 * on each scheduled session card. Composed deterministically from
 * cumulative state by `GET /api/v1/clients/[id]/prepare` — never
 * triggers a Pass-5 generation on its own (N expanded cards must not
 * bill N Gemini calls). The therapist gets a single button inside the
 * panel that explicitly calls the existing pre-session-brief
 * generation route when they want fresh narrative.
 *
 * Every field is optional-or-defaulted so the panel renders sensibly
 * for a brand-new client (no cached brief, no plan, no instruments,
 * no homework, no crises) — empty-state copy lives in the UI.
 */

/**
 * Latest single homework assignment from `ExerciseAssignment`. Cap is
 * 5 in the route; UI renders the most recent two prominently. We keep
 * the shape minimal (description + status + dates) so the panel does
 * not need the full ExerciseAssignment DTO surface.
 */
export const PrepareHomeworkEntrySchema = z.object({
  id: CuidSchema,
  description: z.string().min(1).max(2000),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'EXPIRED']),
  assignedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.nullable(),
  dueAt: IsoDateTimeSchema.nullable(),
});
export type PrepareHomeworkEntry = z.infer<typeof PrepareHomeworkEntrySchema>;

/**
 * Open crisis flag echoed from the shared `crisis-flags.ts` helper.
 * `kind` is the same Pass-3 ClinicalCrisisKindSchema string ("suicidal_ideation"
 * etc.) so the panel can localise the label if needed.
 */
export const PrepareCrisisFlagSchema = z.object({
  kind: z.string().min(1),
  severity: z.enum(['high', 'critical']),
  lastSeenAt: IsoDateTimeSchema,
});
export type PrepareCrisisFlag = z.infer<typeof PrepareCrisisFlagSchema>;

/**
 * Journey signals — kept tight (stage + plan + reliable-change
 * verdicts + next-best action). The wider JourneySummary is also
 * reachable via `GET /clients/[id]/journey`; the Prepare summary
 * carries only what the panel actually renders.
 */
export const PrepareJourneySchema = z.object({
  stage: JourneyStageSchema,
  activePlan: JourneyActivePlanSchema.nullable(),
  instrumentChanges: z.array(InstrumentChangeSchema).max(6),
  nextBestAction: NextBestActionSchema.nullable(),
});
export type PrepareJourney = z.infer<typeof PrepareJourneySchema>;

export const PrepareSummaryV1Schema = z.object({
  version: z.literal('V1'),
  clientId: CuidSchema,
  /**
   * Most recent cached pre-session brief, or null when none has ever
   * been generated. Even when present, may be stale (see
   * `briefIsStale`).
   */
  cachedBrief: PreSessionBriefV1Schema.nullable(),
  /**
   * True when the cached brief's `lastSessionId` no longer points at
   * the latest completed session — i.e. the brief is from before the
   * most recent session, and the therapist should regenerate to get
   * recent context. False when there is no cached brief (the panel
   * renders the empty state in that case).
   */
  briefIsStale: z.boolean(),
  journey: PrepareJourneySchema,
  homework: z.array(PrepareHomeworkEntrySchema).max(5),
  openCrises: z.array(PrepareCrisisFlagSchema).max(5),
  /**
   * FK to the last COMPLETED session so the panel can deep-link
   * "Open last session's copilot". Null for a brand-new client.
   */
  lastCompletedSessionId: CuidSchema.nullable(),
});
export type PrepareSummaryV1 = z.infer<typeof PrepareSummaryV1Schema>;
