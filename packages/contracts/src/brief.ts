import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';
import { ClinicalLocaleSchema } from './clinical';

/**
 * Sprint 17 — Pre-Session Brief (Pass 5).
 *
 * Generated when the therapist opens a client to prepare for the
 * next session. Grounded in the cumulative confirmed clinical
 * record + most recent therapy script + last session's homework +
 * latest instrument scores. The brief is short — designed to be
 * read in ~30 seconds before the session starts.
 *
 * Cached per (clientId, lastSessionId, language). Regenerates when
 * a new session lands.
 */

export const PreSessionBriefV1Schema = z.object({
  version: z.literal('V1'),
  language: ClinicalLocaleSchema.default('en'),

  /** One-sentence positioning: "Session 4 of 8 · CBT for panic disorder." */
  contextLine: z.string().min(1).max(400),

  /**
   * 2-3 sentence recap of what was confirmed in the last clinical
   * brief + outcome of last session. Empty for first-session briefs.
   */
  lastSessionRecap: z.string().min(0).max(1500),

  /**
   * 2-3 sentences: what the treatment plan says we should focus on
   * today, written as therapist instructions.
   */
  todaysFocus: z.string().min(1).max(1500),

  /**
   * Verbatim opening line the therapist can say (1-2 sentences).
   * Written in the therapist's output language; meant to be adapted
   * in the moment.
   */
  openingLine: z.string().min(1).max(800),

  /**
   * 2-5 short bullet-style watchpoints — things to actively listen
   * for or steer towards based on history.
   */
  riskWatchpoints: z.array(z.string().min(1).max(400)).max(5).default([]),

  /**
   * Homework status from last session if any was assigned. Null
   * when this is a first session or no homework was assigned.
   */
  homeworkStatus: z
    .object({
      description: z.string(),
      /** "completed" | "partial" | "skipped" | "unknown" */
      outcome: z.enum(['completed', 'partial', 'skipped', 'unknown']),
      notes: z.string().nullable(),
    })
    .nullable(),

  /**
   * If a prior session flagged a high/critical crisis that hasn't
   * been resolved, surface it here so the therapist can open with
   * a safety check.
   */
  carryoverCrisis: z
    .array(
      z.object({
        kind: z.string(),
        severity: z.enum(['high', 'critical']),
        lastSeenAt: IsoDateTimeSchema,
      }),
    )
    .max(5)
    .default([]),

  /**
   * Most recent scored instrument readings, if any. Lets the
   * therapist see the trend at a glance.
   */
  latestInstruments: z
    .array(
      z.object({
        instrumentKey: z.string(),
        score: z.number().int(),
        severity: z.string(),
        administeredAt: IsoDateTimeSchema,
      }),
    )
    .max(6)
    .default([]),
});
export type PreSessionBriefV1 = z.infer<typeof PreSessionBriefV1Schema>;

// ============================================================================
// Server-side row DTO
// ============================================================================

export const PreSessionBriefStatusSchema = z.enum(['PENDING', 'COMPLETED', 'FAILED']);
export type PreSessionBriefStatus = z.infer<typeof PreSessionBriefStatusSchema>;

export const PreSessionBriefSchema = z.object({
  id: CuidSchema,
  clientId: CuidSchema,
  psychologistId: CuidSchema,
  lastSessionId: CuidSchema.nullable(),
  language: ClinicalLocaleSchema,
  status: PreSessionBriefStatusSchema,
  body: PreSessionBriefV1Schema.nullable(),
  totalCostInr: z.string(),
  errorMessage: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type PreSessionBrief = z.infer<typeof PreSessionBriefSchema>;

export const GeneratePreSessionBriefQuerySchema = z.object({
  /** Optional language override; defaults to session/client preference. */
  language: ClinicalLocaleSchema.optional(),
  /** Force a fresh generation even when a cached row exists. */
  refresh: z.coerce.boolean().optional(),
});
export type GeneratePreSessionBriefQuery = z.infer<typeof GeneratePreSessionBriefQuerySchema>;
