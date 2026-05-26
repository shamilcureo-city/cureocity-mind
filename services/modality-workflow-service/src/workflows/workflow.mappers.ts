import type {
  ModalityState as ModalityStateRow,
  ModalityTransition as TransitionRow,
} from '@prisma/client';
import type {
  ModalityState,
  ModalityStateWithHistory,
  ModalityTransition,
  WorkflowGoal,
} from '@cureocity/contracts';

export function toModalityState(row: ModalityStateRow): ModalityState {
  return {
    id: row.id,
    clientId: row.clientId,
    psychologistId: row.psychologistId,
    modality: row.modality,
    currentPhase: row.currentPhase,
    state: (row.state ?? {}) as Record<string, unknown>,
    goals: (row.goals ?? []) as WorkflowGoal[],
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toModalityTransition(row: TransitionRow): ModalityTransition {
  return {
    id: row.id,
    stateId: row.stateId,
    fromPhase: row.fromPhase,
    toPhase: row.toPhase,
    trigger: row.trigger,
    reason: row.reason,
    psychologistId: row.psychologistId,
    evidence: row.evidence === null ? null : (row.evidence as Record<string, unknown>),
    occurredAt: row.occurredAt.toISOString(),
  };
}

export function toModalityStateWithHistory(
  state: ModalityStateRow,
  transitions: TransitionRow[],
): ModalityStateWithHistory {
  return {
    ...toModalityState(state),
    transitions: transitions.map(toModalityTransition),
  };
}
