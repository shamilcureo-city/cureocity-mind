import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';

export const ExerciseAssignmentStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'SKIPPED',
  'EXPIRED',
]);
export type ExerciseAssignmentStatus = z.infer<typeof ExerciseAssignmentStatusSchema>;

export const CreateExerciseAssignmentInputSchema = z.object({
  clientId: CuidSchema,
  /** Stable id from @cureocity/clinical catalog (cbt_* or emdr_*). */
  exerciseId: z.string().regex(/^(cbt|emdr)_[a-z0-9_]+$/),
  dueAt: IsoDateTimeSchema.optional(),
  therapistNote: z.string().max(2000).optional(),
});
export type CreateExerciseAssignmentInput = z.infer<typeof CreateExerciseAssignmentInputSchema>;

export const RecordCompletionInputSchema = z.object({
  /** Structured per the exercise's responseSchema; opaque here. */
  response: z.record(z.unknown()),
  /** Optional note from the client. */
  notes: z.string().max(2000).optional(),
});
export type RecordCompletionInput = z.infer<typeof RecordCompletionInputSchema>;

export const ExerciseAssignmentSchema = z.object({
  id: CuidSchema,
  clientId: CuidSchema,
  psychologistId: CuidSchema,
  exerciseId: z.string(),
  assignedAt: IsoDateTimeSchema,
  dueAt: IsoDateTimeSchema.nullable(),
  status: ExerciseAssignmentStatusSchema,
  completedAt: IsoDateTimeSchema.nullable(),
  response: z.record(z.unknown()).nullable(),
  therapistNote: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ExerciseAssignment = z.infer<typeof ExerciseAssignmentSchema>;

export const CreateMoodLogInputSchema = z.object({
  rating: z.number().int().min(0).max(10),
  notes: z.string().max(2000).optional(),
  recordedAt: IsoDateTimeSchema.optional(),
});
export type CreateMoodLogInput = z.infer<typeof CreateMoodLogInputSchema>;

export const MoodLogSchema = z.object({
  id: CuidSchema,
  clientId: CuidSchema,
  rating: z.number().int().min(0).max(10),
  notes: z.string().nullable(),
  recordedAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
});
export type MoodLog = z.infer<typeof MoodLogSchema>;

export const CreateJournalEntryInputSchema = z.object({
  content: z.string().min(1).max(20_000),
  mood: z.number().int().min(0).max(10).optional(),
  recordedAt: IsoDateTimeSchema.optional(),
  /** Default false — entry stays private to the client. */
  sharedWithTherapist: z.boolean().optional(),
});
export type CreateJournalEntryInput = z.infer<typeof CreateJournalEntryInputSchema>;

export const JournalEntrySchema = z.object({
  id: CuidSchema,
  clientId: CuidSchema,
  content: z.string(),
  mood: z.number().int().min(0).max(10).nullable(),
  sharedWithTherapist: z.boolean(),
  recordedAt: IsoDateTimeSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

// ============================================================================
// Next-session reminder for the patient PWA home. Returns the next
// SCHEDULED session for the logged-in client, or null if none. Sprint 8 PR 2.
// ============================================================================

export const NextSessionSummarySchema = z.object({
  sessionId: CuidSchema,
  scheduledAt: IsoDateTimeSchema,
  modality: z.enum(['CBT', 'EMDR', 'OTHER']),
  psychologistFullName: z.string(),
});
export type NextSessionSummary = z.infer<typeof NextSessionSummarySchema>;

export const AdherenceSummarySchema = z.object({
  clientId: CuidSchema,
  windowDays: z.number().int().positive(),
  totalAssigned: z.number().int().nonnegative(),
  totalCompleted: z.number().int().nonnegative(),
  totalSkipped: z.number().int().nonnegative(),
  totalExpired: z.number().int().nonnegative(),
  totalPending: z.number().int().nonnegative(),
  /** completed / (assigned - pending), 0..1; null when denominator is 0. */
  completionRate: z.number().min(0).max(1).nullable(),
  perExercise: z.array(
    z.object({
      exerciseId: z.string(),
      lastPrescribedAt: IsoDateTimeSchema.nullable(),
      assigned: z.number().int().nonnegative(),
      completed: z.number().int().nonnegative(),
      completionRate: z.number().min(0).max(1),
    }),
  ),
  computedAt: IsoDateTimeSchema,
});
export type AdherenceSummary = z.infer<typeof AdherenceSummarySchema>;
