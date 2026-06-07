import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';

/**
 * Sprint 20 Phase 3 — Treatment episode + discharge.
 *
 * A TreatmentEpisode groups a client's care from intake → discharge so
 * the journey arc has a durable terminal state. Distinct from
 * Client.status (a single current flag): a client can have several
 * episodes over time (discharged, returns, discharged again).
 */

export const TreatmentEpisodeStatusSchema = z.enum(['OPEN', 'DISCHARGED', 'TRANSFERRED']);
export type TreatmentEpisodeStatus = z.infer<typeof TreatmentEpisodeStatusSchema>;

/** Terminal statuses — a closed episode. */
export const TERMINAL_EPISODE_STATUSES: TreatmentEpisodeStatus[] = ['DISCHARGED', 'TRANSFERRED'];

export const TreatmentEpisodeSchema = z.object({
  id: CuidSchema,
  clientId: CuidSchema,
  psychologistId: CuidSchema,
  status: TreatmentEpisodeStatusSchema,
  openedAt: IsoDateTimeSchema,
  closedAt: IsoDateTimeSchema.nullable(),
  closeReason: z.string().nullable(),
  outcomeNote: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type TreatmentEpisode = z.infer<typeof TreatmentEpisodeSchema>;

/**
 * POST /api/v1/clients/[id]/discharge — close the client's active
 * episode. Only the two terminal statuses are accepted (you can't
 * "discharge to OPEN"). reason is required so the record is auditable;
 * outcomeNote is an optional free-text the therapist can surface in the
 * client's final progress report.
 */
export const DischargeClientInputSchema = z.object({
  status: z.enum(['DISCHARGED', 'TRANSFERRED']),
  reason: z.string().min(1).max(2000),
  outcomeNote: z.string().max(4000).optional(),
});
export type DischargeClientInput = z.infer<typeof DischargeClientInputSchema>;

export const DischargeClientResponseSchema = z.object({
  episode: TreatmentEpisodeSchema,
});
export type DischargeClientResponse = z.infer<typeof DischargeClientResponseSchema>;
