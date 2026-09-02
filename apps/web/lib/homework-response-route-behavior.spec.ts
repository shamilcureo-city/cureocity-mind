import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  artefactType: 'HOMEWORK' as 'HOMEWORK' | 'THERAPY_SCRIPT',
  shareUpdate: vi.fn(),
  assignmentUpdate: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock('@cureocity/contracts', () => ({
  PatientShareTokenSchema: { safeParse: (value: string) => ({ success: true, data: value }) },
  HomeworkResponseInputSchema: {},
  HomeworkSnapshotSchema: {
    safeParse: (value: { kind?: string; assignmentId?: string }) =>
      value?.kind === 'HOMEWORK' ? { success: true, data: value } : { success: false },
  },
  TherapyScriptSnapshotSchema: {
    safeParse: (value: { kind?: string; homeworkAssignmentId?: string }) =>
      value?.kind === 'THERAPY_SCRIPT' ? { success: true, data: value } : { success: false },
  },
}));
vi.mock('./validate', () => ({
  parseJson: vi.fn(async () => ({ ok: true, value: { outcome: 'DONE', reflection: 'helped' } })),
}));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: () => ({}),
  writeAudit: mocks.writeAudit,
}));
vi.mock('./prisma', () => {
  const snapshot = () =>
    mocks.artefactType === 'HOMEWORK'
      ? { kind: 'HOMEWORK', assignmentId: 'assignment-1' }
      : { kind: 'THERAPY_SCRIPT', homeworkAssignmentId: 'assignment-1' };
  const share = () => ({
    id: 'share-used',
    shareBatchId: 'batch-1',
    clientId: 'client-1',
    psychologistId: 'psy-1',
    artefactId: mocks.artefactType === 'HOMEWORK' ? 'assignment-1' : 'script-1',
    artefactType: mocks.artefactType,
    snapshot: snapshot(),
    status: 'SENT',
    expiresAt: new Date(Date.now() + 60_000),
  });
  const tx = {
    $executeRaw: vi.fn(),
    patientShare: {
      findUnique: vi.fn(async () => share()),
      findMany: vi.fn(async () => [
        {
          id: 'share-used',
          artefactType: mocks.artefactType,
          snapshot: snapshot(),
          status: 'SENT',
        },
        {
          id: 'share-other-channel',
          artefactType: mocks.artefactType,
          snapshot: snapshot(),
          status: 'SENT',
        },
      ]),
      updateMany: mocks.shareUpdate,
    },
    exerciseAssignment: {
      findFirst: vi.fn(async () => ({ id: 'assignment-1', response: null })),
      update: mocks.assignmentUpdate,
    },
  };
  return {
    prisma: {
      patientShare: { findUnique: vi.fn(async () => share()) },
      $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
    },
  };
});

import { POST } from '../app/api/v1/p/[token]/homework/route';

describe('homework response channel and source provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.artefactType = 'HOMEWORK';
    mocks.shareUpdate.mockResolvedValue({ count: 1 });
  });

  it('marks only the token channel OPENED while updating sibling snapshots and persisting response provenance', async () => {
    const response = await POST(
      new Request('https://mind.cureocity.in/api/v1/p/token/homework', {
        method: 'POST',
        body: '{}',
      }) as never,
      { params: Promise.resolve({ token: 'token' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.assignmentUpdate).toHaveBeenCalledWith({
      where: { id: 'assignment-1' },
      data: expect.objectContaining({
        responseShareId: 'share-used',
        responseShareBatchId: 'batch-1',
      }),
    });
    const used = mocks.shareUpdate.mock.calls.find(([arg]) => arg.where.id === 'share-used')?.[0];
    const sibling = mocks.shareUpdate.mock.calls.find(
      ([arg]) => arg.where.id === 'share-other-channel',
    )?.[0];
    expect(used?.data).toEqual(
      expect.objectContaining({ status: 'OPENED', openedAt: expect.any(Date) }),
    );
    expect(sibling?.data).not.toHaveProperty('status');
    expect(sibling?.data).not.toHaveProperty('openedAt');
  });

  it.each([
    ['HOMEWORK', 'homework_portal'],
    ['THERAPY_SCRIPT', 'therapy_script_portal'],
  ] as const)(
    'audits an explicit %s response with its accurate source',
    async (artefactType, source) => {
      mocks.artefactType = artefactType;

      const response = await POST(
        new Request('https://mind.cureocity.in/api/v1/p/token/homework', {
          method: 'POST',
          body: '{}',
        }) as never,
        { params: Promise.resolve({ token: 'token' }) },
      );

      expect(response.status).toBe(200);
      expect(mocks.writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ source }) }),
        expect.anything(),
      );
    },
  );
});
