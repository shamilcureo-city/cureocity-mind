import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';
import { SessionModalitySchema } from './client';

export const WorkflowGoalSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1).max(500),
  targetSessionCount: z.number().int().positive().optional(),
  achieved: z.boolean().default(false),
  achievedAt: IsoDateTimeSchema.nullable().optional(),
  evidence: z.string().max(2000).optional(),
});
export type WorkflowGoal = z.infer<typeof WorkflowGoalSchema>;

export const CreateWorkflowInputSchema = z.object({
  clientId: CuidSchema,
  modality: SessionModalitySchema,
  initialPhase: z.string().min(1).max(50),
  goals: z
    .array(
      WorkflowGoalSchema.omit({ achieved: true, achievedAt: true }).extend({
        achieved: z.boolean().default(false).optional(),
      }),
    )
    .min(1)
    .max(20),
});
export type CreateWorkflowInput = z.infer<typeof CreateWorkflowInputSchema>;

export const ModalityTransitionTriggerSchema = z.enum([
  'PSYCHOLOGIST_MANUAL',
  'SYSTEM_SUGGESTION_ACCEPTED',
  'SYSTEM_AUTO',
]);
export type ModalityTransitionTrigger = z.infer<typeof ModalityTransitionTriggerSchema>;

export const CreateTransitionInputSchema = z.object({
  toPhase: z.string().min(1).max(50),
  reason: z.string().min(1).max(1000),
  evidence: z.record(z.unknown()).optional(),
});
export type CreateTransitionInput = z.infer<typeof CreateTransitionInputSchema>;

export const ModalityTransitionSchema = z.object({
  id: CuidSchema,
  stateId: CuidSchema,
  fromPhase: z.string(),
  toPhase: z.string(),
  trigger: ModalityTransitionTriggerSchema,
  reason: z.string(),
  psychologistId: CuidSchema.nullable(),
  evidence: z.record(z.unknown()).nullable(),
  occurredAt: IsoDateTimeSchema,
});
export type ModalityTransition = z.infer<typeof ModalityTransitionSchema>;

export const ModalityStateSchema = z.object({
  id: CuidSchema,
  clientId: CuidSchema,
  psychologistId: CuidSchema,
  modality: SessionModalitySchema,
  currentPhase: z.string(),
  state: z.record(z.unknown()),
  goals: z.array(WorkflowGoalSchema),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ModalityState = z.infer<typeof ModalityStateSchema>;

export const ModalityStateWithHistorySchema = ModalityStateSchema.extend({
  transitions: z.array(ModalityTransitionSchema),
});
export type ModalityStateWithHistory = z.infer<typeof ModalityStateWithHistorySchema>;

/** What the system suggests as the next phase. null = stay where you are. */
export const AdvancementSuggestionSchema = z.object({
  workflowId: CuidSchema,
  currentPhase: z.string(),
  suggestedPhase: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  signals: z.record(z.unknown()),
});
export type AdvancementSuggestion = z.infer<typeof AdvancementSuggestionSchema>;
