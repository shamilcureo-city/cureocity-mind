import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';
import { ClientSchema, SessionModalitySchema } from './client';
import { ConsentSchema } from './consent';

export const SessionStatusSchema = z.enum([
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
]);

export const BriefingSessionSummarySchema = z.object({
  id: CuidSchema,
  modality: SessionModalitySchema,
  status: SessionStatusSchema,
  scheduledAt: IsoDateTimeSchema,
  startedAt: IsoDateTimeSchema.nullable(),
  endedAt: IsoDateTimeSchema.nullable(),
});

export const ClientBriefingSchema = z.object({
  client: ClientSchema,
  consents: z.array(ConsentSchema),
  recentSessions: z.array(BriefingSessionSummarySchema),
  /**
   * Latest signed therapy note. Always null until scribe-service ships
   * (Sprint 2 PR 4); kept as a typed field so the frontend can render
   * "no notes yet" without conditional schema handling.
   */
  lastNote: z.null(),
});

export type BriefingSessionSummary = z.infer<typeof BriefingSessionSummarySchema>;
export type ClientBriefing = z.infer<typeof ClientBriefingSchema>;
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
