import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PractitionerCapability } from '@cureocity/contracts';
const mocks = vi.hoisted(() => ({ decrypt: vi.fn(), lock: vi.fn() }));
vi.mock('./tenant-crypto', () => ({ decryptForTenant: mocks.decrypt }));
vi.mock('./phi-write-lock', () => ({ lockActiveClient: mocks.lock }));
import { loadMindCareDataExport } from './mind-care-data-export';
const now = new Date('2026-09-10T09:00:00Z');
const care = {
  version: 'V1',
  agreement: {
    scope: 'Fictional agreement',
    confidentialityAndLimits: '',
    practicalArrangements: '',
    contactAndCrisisArrangements: '',
    clientPriorities: '',
    discussedOn: null,
    reviewOn: null,
  },
  clientVoice: {
    recordedOn: null,
    whatHelped: '',
    whatCouldChange: '',
    everydayChanges: '',
    clinicianReflection: '',
  },
  continuity: {
    stage: 'NOT_PLANNED',
    maintenancePlan: '',
    warningSignsAndResponse: '',
    endingOrReferralPlan: '',
    referralFollowThrough: '',
    reviewOn: null,
  },
};
const tx = {
  $queryRaw: vi.fn(),
  mindSessionPreparation: { findMany: vi.fn() },
  mindManualNoteDraft: { findMany: vi.fn() },
  clientMindCareRecord: { findMany: vi.fn() },
  mindInstrumentDraft: { findMany: vi.fn() },
  exerciseAssignment: { findMany: vi.fn() },
};
const caps = new Set<PractitionerCapability>([
  'BEHAVIORAL_HEALTH_DOCUMENTATION',
  'MEASUREMENT_BASED_CARE',
  'THERAPY_WORKFLOWS',
]);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lock.mockResolvedValue({ id: 'client' });
  tx.$queryRaw.mockResolvedValue([{ exists: true }]);
  tx.mindSessionPreparation.findMany.mockResolvedValue([]);
  tx.mindManualNoteDraft.findMany.mockResolvedValue([
    {
      sessionId: 'visit',
      session: { mindPurpose: 'COUNSELLING' },
      revision: 2,
      updatedAt: now,
      encryptedFields: 'manual-cipher',
      lastMutationHashEncrypted: 'private-receipt',
    },
  ]);
  tx.clientMindCareRecord.findMany.mockResolvedValue([
    {
      id: 'record',
      version: 1,
      createdAt: now,
      bodyEncrypted: 'care-cipher',
      operationId: 'private-operation',
    },
  ]);
  tx.mindInstrumentDraft.findMany.mockResolvedValue([
    {
      instrumentKey: 'PHQ9',
      revision: 1,
      status: 'ACTIVE',
      answersEncrypted: 'instrument-cipher',
      updatedAt: now,
      submittedResponseId: null,
      riskFlagged: false,
    },
  ]);
  tx.exerciseAssignment.findMany.mockResolvedValue([
    { id: 'homework', sourceAgreementId: 'agreement', sourceAgreementRevision: 3 },
  ]);
  mocks.decrypt.mockImplementation(async (_owner, ciphertext) =>
    ciphertext === 'manual-cipher'
      ? JSON.stringify({ subjective: 'Fictional draft' })
      : ciphertext === 'care-cipher'
        ? JSON.stringify(care)
        : JSON.stringify({ '1': 2 }),
  );
});
describe('Mind new-record DSR disclosure', () => {
  it('exports confirmed session work from the encrypted care body without omitting its source or unknown response', async () => {
    const work = {
      sessionId: 'source-visit',
      scheduledAt: '2026-09-10T09:00:00.000Z',
      disposition: 'PAUSED',
      workDone: 'Fictional confirmed work',
      clientResponse: '',
    };
    const prior = mocks.decrypt.getMockImplementation()!;
    mocks.decrypt.mockImplementation(async (owner, ciphertext) =>
      ciphertext === 'care-cipher'
        ? JSON.stringify({ ...care, sessionWork: work })
        : prior(owner, ciphertext),
    );
    const result = await loadMindCareDataExport(tx as never, 'client', 'owner', caps);
    expect(result.mindCareRecords?.[0]?.body.sessionWork).toEqual(work);
    expect(result.omittedMindSections).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/cipher|private-operation/);
  });
  it('exports decrypted drafts, all care versions and provenance, never encrypted retry receipts', async () => {
    const result = await loadMindCareDataExport(tx as never, 'client', 'owner', caps);
    expect(result.mindManualNoteDrafts?.[0]?.fields?.subjective).toBe('Fictional draft');
    expect(result.mindCareRecords?.[0]?.body.agreement.scope).toBe('Fictional agreement');
    expect(result.mindInstrumentDrafts?.[0]?.responses).toEqual({ '1': 2 });
    expect(result.assignmentProvenance?.[0]?.sourceAgreementRevision).toBe(3);
    expect(result.omittedMindSections).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/cipher|private-receipt|private-operation/);
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      tx.mindManualNoteDraft.findMany.mock.invocationCallOrder[0]!,
    );
    expect(mocks.decrypt).toHaveBeenCalledWith('owner', 'manual-cipher');
  });
  it('does not read protected clinical sections without capabilities and explicitly declares omissions', async () => {
    const result = await loadMindCareDataExport(tx as never, 'client', 'owner', new Set());
    expect(result.omittedMindSections).toHaveLength(5);
    for (const model of Object.values(tx)) {
      if ('findMany' in model) expect(model.findMany).not.toHaveBeenCalled();
    }
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it('requires workflow authority as well as documentation for the care agreement', async () => {
    const result = await loadMindCareDataExport(
      tx as never,
      'client',
      'owner',
      new Set(['BEHAVIORAL_HEALTH_DOCUMENTATION']),
    );
    expect(tx.clientMindCareRecord.findMany).not.toHaveBeenCalled();
    expect(result.omittedMindSections).toContain('mindCareRecords');
  });
  it('exports a questionnaire tombstone without resurrecting answer ciphertext', async () => {
    tx.mindInstrumentDraft.findMany.mockResolvedValue([
      {
        instrumentKey: 'GAD7',
        revision: 3,
        status: 'DISCARDED',
        answersEncrypted: 'stale-cipher',
        updatedAt: now,
        submittedResponseId: null,
        riskFlagged: false,
      },
    ]);
    const result = await loadMindCareDataExport(tx as never, 'client', 'owner', caps);
    expect(result.mindInstrumentDrafts?.[0]?.responses).toEqual({});
    expect(mocks.decrypt).not.toHaveBeenCalledWith('owner', 'stale-cipher');
  });
  it('fails closed after erasure or failed decryption rather than returning a misleading empty record', async () => {
    mocks.lock.mockRejectedValueOnce(new Error('erased'));
    await expect(loadMindCareDataExport(tx as never, 'client', 'owner', caps)).rejects.toThrow(
      'erased',
    );
    expect(mocks.decrypt).not.toHaveBeenCalled();
    mocks.decrypt.mockResolvedValue(null);
    await expect(loadMindCareDataExport(tx as never, 'client', 'owner', caps)).rejects.toThrow(
      'Clinical export data unavailable',
    );
  });
  it('exports all exact-visit revisions, including clears, without workflow entitlement or an editing flag', async () => {
    const preparationBody = {
      version: 1,
      source: 'CLINICIAN_WRITTEN',
      scheduledAt: now.toISOString(),
      focus: 'Fictional focus',
    };
    tx.mindSessionPreparation.findMany.mockResolvedValue([
      {
        id: 'prep-1',
        sessionId: 'visit-1',
        psychologistId: 'owner',
        revision: 1,
        operationId: 'private-operation',
        createdAt: now,
        bodyEncrypted: 'prep-cipher',
      },
      {
        id: 'prep-2',
        sessionId: 'visit-1',
        psychologistId: 'owner',
        revision: 2,
        operationId: 'private-operation',
        createdAt: now,
        bodyEncrypted: 'clear-cipher',
      },
      {
        id: 'prep-3',
        sessionId: 'visit-2',
        psychologistId: 'owner',
        revision: 1,
        operationId: 'private-operation',
        createdAt: now,
        bodyEncrypted: 'prep-cipher',
      },
    ]);
    const prior = mocks.decrypt.getMockImplementation()!;
    mocks.decrypt.mockImplementation(async (owner, cipher) =>
      cipher === 'prep-cipher'
        ? JSON.stringify(preparationBody)
        : cipher === 'clear-cipher'
          ? JSON.stringify({ ...preparationBody, focus: null })
          : prior(owner, cipher),
    );
    const result = await loadMindCareDataExport(
      tx as never,
      'client',
      'owner',
      new Set(['BEHAVIORAL_HEALTH_DOCUMENTATION']),
    );
    expect(
      result.mindSessionPreparations?.map((row) => [row.sessionId, row.revision, row.body.focus]),
    ).toEqual([
      ['visit-1', 1, 'Fictional focus'],
      ['visit-1', 2, null],
      ['visit-2', 1, 'Fictional focus'],
    ]);
    expect(tx.mindSessionPreparation.findMany).toHaveBeenCalledWith({
      where: { psychologistId: 'owner', session: { clientId: 'client', psychologistId: 'owner' } },
      orderBy: [{ sessionId: 'asc' }, { revision: 'asc' }],
    });
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0]!,
    );
    expect(JSON.stringify(result)).not.toMatch(/cipher|private-operation/);
  });
  it('allows a confirmed pre-migration absence without omitting unknown history', async () => {
    tx.$queryRaw.mockResolvedValue([{ exists: false }]);
    const result = await loadMindCareDataExport(tx as never, 'client', 'owner', caps);
    expect(result.mindSessionPreparations).toEqual([]);
    expect(tx.mindSessionPreparation.findMany).not.toHaveBeenCalled();
  });
  it('aborts the whole export when existing preparation cannot be read or decrypted', async () => {
    tx.mindSessionPreparation.findMany.mockRejectedValueOnce(
      new Error('preparation query unavailable'),
    );
    await expect(loadMindCareDataExport(tx as never, 'client', 'owner', caps)).rejects.toThrow(
      'preparation query unavailable',
    );
    tx.mindSessionPreparation.findMany.mockResolvedValue([
      {
        id: 'prep',
        sessionId: 'visit',
        psychologistId: 'owner',
        revision: 1,
        createdAt: now,
        bodyEncrypted: 'unreadable-preparation',
      },
    ]);
    const prior = mocks.decrypt.getMockImplementation()!;
    mocks.decrypt.mockImplementation(async (owner, cipher) =>
      cipher === 'unreadable-preparation' ? null : prior(owner, cipher),
    );
    await expect(loadMindCareDataExport(tx as never, 'client', 'owner', caps)).rejects.toThrow(
      'Clinical export data unavailable',
    );
  });
  it('does not export a malformed decrypted preparation as an empty focus', async () => {
    tx.mindSessionPreparation.findMany.mockResolvedValue([
      {
        id: 'prep',
        sessionId: 'visit',
        psychologistId: 'owner',
        revision: 1,
        createdAt: now,
        bodyEncrypted: 'malformed-preparation',
      },
    ]);
    await expect(loadMindCareDataExport(tx as never, 'client', 'owner', caps)).rejects.toThrow();
  });
});
