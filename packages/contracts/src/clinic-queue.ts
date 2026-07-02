import { z } from 'zod';

/**
 * Sprint DS7 — the OPD token queue (the "zero-click clinic flow").
 *
 * Distinct from `clinic.ts` (the multi-tenant Clinic org model): this is
 * one doctor's *today* — the list of patients waiting to be seen, each
 * carrying a token number, so the doctor's landing page is a live queue
 * rather than a roster. Tokens are auto-assigned server-side at
 * session-create time for the DOCTOR vertical (`Session.tokenNumber`);
 * statuses derive from the session lifecycle. See
 * docs/DOCTOR_SCRIBE_V2_SPRINTS.md DS7.
 */

/** Queue status, derived from `Session.status` (never stored separately). */
export const ClinicQueueStatusSchema = z.enum(['WAITING', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
export type ClinicQueueStatus = z.infer<typeof ClinicQueueStatusSchema>;

export const ClinicQueueEntrySchema = z.object({
  sessionId: z.string(),
  clientId: z.string(),
  /** Today's token; null for legacy/therapist rows that predate DS7. */
  tokenNumber: z.number().int().positive().nullable(),
  patientName: z.string(),
  age: z.number().int().nonnegative().nullable(),
  status: ClinicQueueStatusSchema,
  /** ISO datetime the session was scheduled/created. */
  scheduledAt: z.string(),
  isDemo: z.boolean().default(false),
});
export type ClinicQueueEntry = z.infer<typeof ClinicQueueEntrySchema>;

/** GET /api/v1/clinic/queue — the doctor's queue for the clinic day. */
export const ClinicQueueSchema = z.object({
  /** ISO date (yyyy-mm-dd) of the clinic day this queue is for. */
  date: z.string(),
  /** Ordered by token (ascending); tokenless rows last, by time. */
  entries: z.array(ClinicQueueEntrySchema),
  /** The next WAITING patient (lowest token), or null when the list is clear. */
  nextUp: ClinicQueueEntrySchema.nullable(),
  waitingCount: z.number().int().nonnegative(),
  doneCount: z.number().int().nonnegative(),
});
export type ClinicQueue = z.infer<typeof ClinicQueueSchema>;
