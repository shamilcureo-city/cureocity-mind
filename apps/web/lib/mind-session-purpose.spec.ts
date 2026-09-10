import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mindSessionPurposeLabel,
  sessionKindForMindPurpose,
  CreateSessionInputSchema,
} from '@cureocity/contracts';
import { mindSessionDestination } from './mind-session-start';
import type { Session } from '@prisma/client';
const mocks = vi.hoisted(() => ({
  lock: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('./prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('./phi-write-lock', () => ({ lockActiveClientForSession: mocks.lock }));
vi.mock('./audit', () => ({ writeAudit: mocks.audit }));
import { selectMindSessionPurpose } from './mind-session-purpose';
const now = new Date('2026-09-10T10:00:00Z');
const row = {
  id: 's1',
  psychologistId: 'p1',
  status: 'SCHEDULED',
  kind: 'TREATMENT',
  mindPurpose: null,
  updatedAt: now,
} as Session;
const tx = { session: { findUnique: mocks.find, update: mocks.update } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.find.mockResolvedValue(row);
  mocks.transaction.mockImplementation((run) => run(tx));
  mocks.update.mockImplementation(({ data }) => ({ ...row, ...data }));
});
describe('clinician-selected purpose and documentation routing', () => {
  it('keeps a second assessment in assessment format instead of silently starting therapy', async () => {
    expect(await selectMindSessionPurpose(row, 'p1', 'ASSESSMENT')).toMatchObject({
      kind: 'INTAKE',
      mindPurpose: 'ASSESSMENT',
      noteTemplateId: null,
      modality: null,
    });
    expect(mocks.lock).toHaveBeenCalledWith(tx, 's1', 'p1');
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SESSION_PURPOSE_SELECTED' }),
      tx,
    );
  });
  it('uses supportive counselling without requiring a diagnostic classification', async () => {
    expect(await selectMindSessionPurpose(row, 'p1', 'COUNSELLING')).toMatchObject({
      kind: 'TREATMENT',
      mindPurpose: 'COUNSELLING',
      modality: 'SUPPORTIVE',
    });
    expect(mindSessionPurposeLabel('COUNSELLING', 'TREATMENT')).toBe('Supportive counselling');
  });
  it.each(['IN_PROGRESS', 'COMPLETED', 'CANCELLED'])(
    'does not reinterpret an already %s visit',
    async (status) => {
      mocks.find.mockResolvedValue({ ...row, status });
      await expect(selectMindSessionPurpose(row, 'p1', 'ASSESSMENT')).rejects.toThrow(
        'already started or changed',
      );
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );
  it('rejects stale booking versions and foreign owners', async () => {
    mocks.find.mockResolvedValueOnce({ ...row, updatedAt: new Date(now.getTime() + 1) });
    await expect(selectMindSessionPurpose(row, 'p1', 'ASSESSMENT')).rejects.toThrow();
    mocks.find.mockResolvedValueOnce({ ...row, psychologistId: 'another' });
    await expect(selectMindSessionPurpose(row, 'p1', 'ASSESSMENT')).rejects.toThrow(
      'Session not found',
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('keeps legacy defaults unchanged when no clinician choice is submitted', async () => {
    expect(await selectMindSessionPurpose(row, 'p1')).toBe(row);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mindSessionPurposeLabel(null, 'INTAKE')).toBe('Assessment session');
    expect(sessionKindForMindPurpose('REVIEW')).toBe('REVIEW');
  });
  it('resumes a manual visit at its clinician workspace, never the recorder', () => {
    expect(
      mindSessionDestination({
        id: 's1',
        clientId: 'c1',
        status: 'IN_PROGRESS',
        mindDocumentationMode: 'MANUAL',
      }),
    ).toBe('/app/sessions/s1');
    expect(CreateSessionInputSchema.shape.mindDocumentationMode.safeParse('MANUAL').success).toBe(
      true,
    );
    expect(
      CreateSessionInputSchema.shape.mindDocumentationMode.safeParse('UNRESTRICTED_AI').success,
    ).toBe(false);
  });
});
