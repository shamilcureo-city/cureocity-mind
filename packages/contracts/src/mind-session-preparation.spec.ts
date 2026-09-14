import { describe, expect, it } from 'vitest';
import { DsrDataExportSchema } from './dsr';
import { AuditActionSchema } from './audit';
import {
  MindSessionPreparationBodySchema,
  MindSessionPreparationSchema,
  MindSessionPreparationResponseSchema,
  MindSessionPreparationSaveResponseSchema,
  SaveMindSessionPreparationInputSchema,
} from './mind-session-preparation';

const scheduledAt = '2026-09-13T09:00:00.000Z';
const operationId = '35976a7e-762c-4575-abee-c07dcba0e4c1';
const body = { version: 1, source: 'CLINICIAN_WRITTEN', scheduledAt, focus: 'A fictional focus' };
const input = {
  operationId,
  expectedClientId: 'client',
  expectedRevision: 0,
  expectedScheduledAt: scheduledAt,
  action: 'SAVE',
  focus: 'A fictional focus',
};
const record = {
  id: 'preparation',
  sessionId: 'visit-1',
  psychologistId: 'owner',
  revision: 1,
  operationId,
  body,
  createdAt: scheduledAt,
};
const response = {
  sessionId: 'visit-1',
  clientId: 'client',
  scheduledAt,
  status: 'SCHEDULED',
  preparation: record,
};

describe('explicit exact-visit preparation contracts', () => {
  it('canonicalizes authored whitespace and equivalent scheduled instants', () => {
    expect(
      SaveMindSessionPreparationInputSchema.parse({
        ...input,
        focus: '  A fictional focus  ',
        expectedScheduledAt: '2026-09-13T14:30:00+05:30',
      }),
    ).toEqual(input);
  });
  it('allows explicit clear without inventing a focus', () => {
    expect(
      SaveMindSessionPreparationInputSchema.parse({ ...input, action: 'CLEAR', focus: null }).focus,
    ).toBeNull();
    expect(MindSessionPreparationBodySchema.parse({ ...body, focus: null }).focus).toBeNull();
  });
  it.each([
    { action: 'SAVE', focus: null },
    { action: 'SAVE', focus: '' },
    { action: 'SAVE', focus: '   ' },
    { action: 'SAVE', focus: 'x'.repeat(201) },
    { action: 'CLEAR', focus: 'do not silently discard this' },
    { action: 'IMPORT', focus: 'unverified device scratch' },
    { expectedRevision: -1 },
    { expectedRevision: 2_147_483_647 },
    { expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { expectedClientId: undefined },
    { expectedClientId: '' },
    { expectedClientId: 'x'.repeat(201) },
    { expectedRevision: 1.2 },
    { operationId: 'not-a-uuid' },
    { expectedScheduledAt: '2026-02-30T09:00:00Z' },
    { expectedScheduledAt: '2026-09-13' },
    { clientId: 'not-a-client-selection-endpoint' },
    { body: { diagnosis: 'not preparation' } },
  ])('rejects ambiguous or unbounded input %j', (patch) => {
    expect(SaveMindSessionPreparationInputSchema.safeParse({ ...input, ...patch }).success).toBe(
      false,
    );
  });
  it.each([
    { version: 'V1' },
    { version: 2 },
    { source: 'ADOPTED_DEVICE_SCRATCH' },
    { diagnosis: 'not preparation' },
    { consent: true },
    { focus: '' },
  ])('does not accept inferred clinical decisions or future body versions %j', (patch) => {
    expect(MindSessionPreparationBodySchema.safeParse({ ...body, ...patch }).success).toBe(false);
  });
  it('supports absent history and historical lifecycle states without requiring a save', () => {
    expect(
      MindSessionPreparationResponseSchema.parse({ ...response, preparation: null }).preparation,
    ).toBeNull();
    expect(
      MindSessionPreparationResponseSchema.parse({ ...response, status: 'COMPLETED' }).preparation
        ?.body.focus,
    ).toBe(body.focus);
  });
  it('requires a positive immutable revision and a complete acknowledgement', () => {
    expect(MindSessionPreparationSchema.safeParse({ ...record, revision: 0 }).success).toBe(false);
    expect(MindSessionPreparationSaveResponseSchema.safeParse(response).success).toBe(false);
    expect(
      MindSessionPreparationSaveResponseSchema.parse({
        ...response,
        currentRevision: 2,
        replayed: true,
      }).currentRevision,
    ).toBe(2);
  });
  it('bounds revisions to PostgreSQL Int and reserves room for the next revision', () => {
    expect(
      SaveMindSessionPreparationInputSchema.parse({ ...input, expectedRevision: 2_147_483_646 })
        .expectedRevision,
    ).toBe(2_147_483_646);
    expect(
      MindSessionPreparationSchema.parse({ ...record, revision: 2_147_483_647 }).revision,
    ).toBe(2_147_483_647);
    expect(
      MindSessionPreparationSchema.safeParse({ ...record, revision: 2_147_483_648 }).success,
    ).toBe(false);
    expect(
      MindSessionPreparationSaveResponseSchema.safeParse({
        ...response,
        currentRevision: 2_147_483_648,
        replayed: true,
      }).success,
    ).toBe(false);
  });
  it('exports preparation bodies and clears but excludes retry identifiers and ciphertext', () => {
    const exported = {
      id: record.id,
      sessionId: record.sessionId,
      psychologistId: record.psychologistId,
      revision: 1,
      body,
      createdAt: scheduledAt,
    };
    const schema = DsrDataExportSchema.pick({ mindSessionPreparations: true });
    expect(
      schema.parse({
        mindSessionPreparations: [
          exported,
          { ...exported, revision: 2, body: { ...body, focus: null } },
        ],
      }).mindSessionPreparations,
    ).toHaveLength(2);
    expect(
      schema.safeParse({ mindSessionPreparations: [{ ...exported, operationId }] }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        mindSessionPreparations: [{ ...exported, bodyEncrypted: 'never disclosed' }],
      }).success,
    ).toBe(false);
    expect(AuditActionSchema.parse('MIND_SESSION_PREPARATION_SAVED')).toBe(
      'MIND_SESSION_PREPARATION_SAVED',
    );
  });
});
