import { describe, expect, it } from 'vitest';
import { CreateExerciseAssignmentInputSchema, HomeworkResponseInputSchema } from './continuity';

const clientId = 'c123456789012345678901234';

describe('Sprint 5.3 explicit homework contracts', () => {
  it('requires a task, a frequency or due date, and a delivery channel', () => {
    expect(
      CreateExerciseAssignmentInputSchema.safeParse({
        clientId,
        task: 'Notice one thought',
        deliveryChannel: 'EMAIL',
      }).success,
    ).toBe(false);
    expect(
      CreateExerciseAssignmentInputSchema.safeParse({
        clientId,
        task: 'Notice one thought',
        frequency: 'Daily',
        deliveryChannel: 'EMAIL',
        idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
      }).success,
    ).toBe(true);
  });

  it('rejects assignments that mix catalog and custom homework', () => {
    expect(
      CreateExerciseAssignmentInputSchema.safeParse({
        clientId,
        exerciseId: 'cbt_thought_record',
        task: 'Notice one thought',
        frequency: 'Daily',
        deliveryChannel: 'EMAIL',
        idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
      }).success,
    ).toBe(false);
  });

  it('accepts Done, Partly, and Not yet with an optional reflection or barrier', () => {
    for (const outcome of ['DONE', 'PARTLY', 'NOT_YET'] as const) {
      expect(
        HomeworkResponseInputSchema.safeParse({ outcome, reflection: 'Busy week' }).success,
      ).toBe(true);
    }
  });

  it('requires durable response time and accepted share provenance in assignment DTOs', async () => {
    const { ExerciseAssignmentSchema } = await import('./continuity');
    const base = {
      id: clientId,
      clientId,
      psychologistId: clientId,
      exerciseId: null,
      source: 'CUSTOM',
      customDescription: 'Practice grounding',
      sourceTherapyScriptId: null,
      sourceSessionId: clientId,
      assignedAt: '2026-08-01T00:00:00.000Z',
      dueAt: null,
      frequency: 'Daily',
      deliveryChannel: 'EMAIL',
      status: 'IN_PROGRESS',
      completedAt: null,
      response: { outcome: 'PARTLY' },
      therapistNote: null,
      respondedAt: '2026-08-03T00:00:00.000Z',
      responseShareId: clientId,
      responseShareBatchId: 'batch-1',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    };
    expect(ExerciseAssignmentSchema.parse(base)).toMatchObject({
      respondedAt: '2026-08-03T00:00:00.000Z',
      responseShareId: clientId,
      responseShareBatchId: 'batch-1',
    });
  });

  it('keeps partial and overdue context in Prepare-compatible persisted truth', async () => {
    const { PrepareHomeworkEntrySchema } = await import('./prepare');
    const parsed = PrepareHomeworkEntrySchema.parse({
      id: clientId,
      description: 'Practice grounding',
      status: 'IN_PROGRESS',
      assignedAt: '2026-08-01T00:00:00.000Z',
      completedAt: null,
      dueAt: '2026-08-02T00:00:00.000Z',
      outcome: 'PARTLY',
      reflection: 'Work got in the way',
      overdue: true,
    });
    expect(parsed).toMatchObject({ outcome: 'PARTLY', overdue: true });
  });
});
