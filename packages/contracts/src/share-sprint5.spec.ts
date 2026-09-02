import { describe, expect, it } from 'vitest';
import { CreateExerciseAssignmentInputSchema } from './continuity';
import { PatientShareSnapshotSchema, ShareArtefactRefSchema, ShareInputSchema } from './share';

const id = 'c123456789012345678901234';

describe('Sprint 5.1 session takeaway contract', () => {
  it('accepts a concise patient-facing takeaway distinct from the signed note', () => {
    expect(
      PatientShareSnapshotSchema.safeParse({
        kind: 'SESSION_TAKEAWAY',
        summary: 'Practise the grounding sequence before the next session.',
      }).success,
    ).toBe(true);
    expect(
      ShareArtefactRefSchema.safeParse({ artefactType: 'SESSION_TAKEAWAY', sessionId: id }).success,
    ).toBe(true);
  });

  it('rejects empty and oversized takeaways', () => {
    expect(
      PatientShareSnapshotSchema.safeParse({ kind: 'SESSION_TAKEAWAY', summary: '' }).success,
    ).toBe(false);
    expect(
      PatientShareSnapshotSchema.safeParse({ kind: 'SESSION_TAKEAWAY', summary: 'x'.repeat(2001) })
        .success,
    ).toBe(false);
  });
});

describe('Sprint 5 share request idempotency contract', () => {
  const request = {
    clientId: id,
    channels: ['PORTAL_LINK'],
    artefact: { artefactType: 'SESSION_TAKEAWAY', sessionId: id },
  };

  it('accepts legacy delivery requests without a caller idempotency key', () => {
    expect(ShareInputSchema.safeParse(request).success).toBe(true);
  });

  it('accepts side-effect-free previews without a caller idempotency key', () => {
    expect(ShareInputSchema.safeParse({ ...request, preview: true }).success).toBe(true);
  });

  it('accepts an explicit UUID for modern replay-safe callers', () => {
    expect(
      ShareInputSchema.safeParse({
        ...request,
        idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
      }).success,
    ).toBe(true);
  });

  it.each(['stable-but-not-a-uuid', '', '123e4567-e89b-42d3-a456-42661417400z'])(
    'rejects an invalid supplied idempotency key: %s',
    (idempotencyKey) => {
      expect(ShareInputSchema.safeParse({ ...request, idempotencyKey }).success).toBe(false);
    },
  );
});

describe('Sprint 5.3 homework receipt contract', () => {
  it('requires caller UUID idempotency for custom side effects', () => {
    const custom = {
      clientId: id,
      task: 'Practise paced breathing',
      frequency: 'Daily',
      deliveryChannel: 'PORTAL_LINK',
    } as const;
    expect(CreateExerciseAssignmentInputSchema.safeParse(custom).success).toBe(false);
    expect(
      CreateExerciseAssignmentInputSchema.safeParse({
        ...custom,
        idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
      }).success,
    ).toBe(true);
  });

  it('tracks the durable patient response in the shared snapshot', () => {
    const parsed = PatientShareSnapshotSchema.parse({
      kind: 'HOMEWORK',
      assignmentId: id,
      task: 'Practise paced breathing',
      frequency: 'Daily',
      dueAt: null,
      therapistNote: null,
      responseOutcome: 'PARTLY',
      responseReflection: 'Remembered on three days',
      respondedAt: '2026-09-01T08:00:00.000Z',
    });
    expect(parsed.kind).toBe('HOMEWORK');
    if (parsed.kind === 'HOMEWORK') expect(parsed.responseOutcome).toBe('PARTLY');
  });
});
