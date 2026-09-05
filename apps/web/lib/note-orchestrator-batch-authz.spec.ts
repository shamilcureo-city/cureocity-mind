import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PractitionerCapability, RiskSeverity, SessionKind } from '@cureocity/contracts';

const mocks = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    sessionFindUnique: fn(),
    sessionUpdate: fn(),
    transaction: fn(),
    queryRaw: fn(),
    audioChunkFindMany: fn(),
    transcriptSegmentFindMany: fn(),
    noteDraftFindUnique: fn(),
    noteDraftUpsert: fn(),
    noteDraftUpdate: fn(),
    geminiCallLogCreate: fn(),
    medicationDeleteMany: fn(),
    medicationCreateMany: fn(),
    clinicalOrderDeleteMany: fn(),
    clinicalOrderCreateMany: fn(),
    clinicalReadingDeleteMany: fn(),
    clinicalReadingCreateMany: fn(),
    pass1: fn(),
    pass2: fn(),
    getEffectiveCapabilities: fn(),
    assertAuditedSessionCapabilities: fn(),
    assertCurrentScribeAuthority: fn(),
    writeAudit: fn(),
    ensureEnglishNote: fn(),
    recordCrisisFlag: fn(),
  };
});

vi.mock('./prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    $queryRaw: mocks.queryRaw,
    session: { findUnique: mocks.sessionFindUnique, update: mocks.sessionUpdate },
    audioChunk: { findMany: mocks.audioChunkFindMany },
    transcriptSegment: { findMany: mocks.transcriptSegmentFindMany },
    noteDraft: {
      findUnique: mocks.noteDraftFindUnique,
      upsert: mocks.noteDraftUpsert,
      update: mocks.noteDraftUpdate,
    },
    noteTemplate: { findUnique: vi.fn() },
    geminiCallLog: { create: mocks.geminiCallLogCreate },
    medicationOrder: {
      deleteMany: mocks.medicationDeleteMany,
      createMany: mocks.medicationCreateMany,
    },
    clinicalOrder: {
      deleteMany: mocks.clinicalOrderDeleteMany,
      createMany: mocks.clinicalOrderCreateMany,
    },
    clinicalReading: {
      deleteMany: mocks.clinicalReadingDeleteMany,
      createMany: mocks.clinicalReadingCreateMany,
    },
  },
}));
vi.mock('./llm', () => ({ modelRouter: () => ({ pass1: mocks.pass1, pass2: mocks.pass2 }) }));
vi.mock('./capabilities', () => ({
  assertAuditedSessionCapabilities: mocks.assertAuditedSessionCapabilities,
  getEffectiveCapabilities: mocks.getEffectiveCapabilities,
}));
vi.mock('./scribe-authority', () => ({
  assertCurrentScribeAuthority: mocks.assertCurrentScribeAuthority,
}));
vi.mock('./audit', () => ({ writeAudit: mocks.writeAudit }));
vi.mock('./cost-guard', () => ({
  CostCircuitOpenError: class CostCircuitOpenError extends Error {},
  checkCostCircuit: vi.fn(),
}));
vi.mock('./tenant-crypto', () => ({ encryptForTenant: vi.fn().mockResolvedValue('encrypted') }));
vi.mock('./patient-context', () => ({
  clientIdForSession: vi.fn().mockResolvedValue('client-1'),
  fetchActiveMedications: vi.fn().mockResolvedValue([]),
}));
vi.mock('./transcribe-segment', () => ({
  assembleSegments: vi.fn(),
  coverTranscriptWithSegments: vi.fn(({ transcript }) => [
    { speaker: 'therapist', text: transcript, startMs: 0, endMs: 1 },
  ]),
  transcribeChunkInline: vi.fn(),
}));
vi.mock('./ensure-english-note', () => ({ ensureEnglishNote: mocks.ensureEnglishNote }));
vi.mock('@cureocity/observability/metrics', () => ({
  recordCostCircuitTrip: vi.fn(),
  recordCostInr: vi.fn(),
  recordCrisisFlag: mocks.recordCrisisFlag,
  recordGeminiCall: vi.fn(),
}));

import { runNoteGeneration } from './note-orchestrator';

const MEDICATION = { drug: 'Aspirin', strength: '75 mg' };
const ORDER = { description: 'HbA1c', category: 'LAB' };
const VITALS = { bpSystolic: 120, bpDiastolic: 80, weightKg: 70 };
const SESSION = {
  id: 'session-1',
  psychologistId: 'psy-1',
  clientId: 'client-1',
  scheduledAt: new Date('2026-08-18T00:00:00.000Z'),
  status: 'COMPLETED',
  noteTemplateId: null,
  kind: 'TREATMENT',
  modality: null,
  client: { presentingConcerns: null, preferredModality: null, spokenLanguages: [] },
  psychologist: { vertical: 'DOCTOR' },
};

function callLog(pass: string) {
  return {
    sessionId: 'session-1',
    pass,
    model: 'mock',
    region: 'test',
    promptVersion: 'test',
    inputTokens: 1,
    outputTokens: 1,
    costInr: 0,
    latencyMs: 1,
    status: 'SUCCESS',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryRaw.mockResolvedValue([{ id: 'client-1', psychologistId: 'psy-1' }]);
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      $queryRaw: mocks.queryRaw,
      session: { findUnique: mocks.sessionFindUnique, update: mocks.sessionUpdate },
      noteDraft: { upsert: mocks.noteDraftUpsert, update: mocks.noteDraftUpdate },
      geminiCallLog: { create: mocks.geminiCallLogCreate },
      medicationOrder: {
        deleteMany: mocks.medicationDeleteMany,
        createMany: mocks.medicationCreateMany,
      },
      clinicalOrder: {
        deleteMany: mocks.clinicalOrderDeleteMany,
        createMany: mocks.clinicalOrderCreateMany,
      },
      clinicalReading: {
        deleteMany: mocks.clinicalReadingDeleteMany,
        createMany: mocks.clinicalReadingCreateMany,
      },
    }),
  );
  process.env['LLM_BACKEND'] = 'mock';
  mocks.sessionFindUnique.mockResolvedValue(SESSION);
  mocks.audioChunkFindMany.mockResolvedValue([]);
  mocks.transcriptSegmentFindMany.mockResolvedValue([]);
  mocks.noteDraftFindUnique.mockResolvedValue(null);
  mocks.noteDraftUpsert.mockResolvedValue({ id: 'draft-1' });
  mocks.noteDraftUpdate.mockResolvedValue({ id: 'draft-1' });
  mocks.sessionUpdate.mockResolvedValue(SESSION);
  mocks.geminiCallLogCreate.mockResolvedValue({});
  mocks.medicationDeleteMany.mockResolvedValue({ count: 0 });
  mocks.medicationCreateMany.mockResolvedValue({ count: 1 });
  mocks.clinicalOrderDeleteMany.mockResolvedValue({ count: 0 });
  mocks.clinicalOrderCreateMany.mockResolvedValue({ count: 1 });
  mocks.clinicalReadingDeleteMany.mockResolvedValue({ count: 0 });
  mocks.clinicalReadingCreateMany.mockResolvedValue({ count: 2 });
  mocks.assertAuditedSessionCapabilities.mockResolvedValue('psy-1');
  mocks.writeAudit.mockResolvedValue(undefined);
  mocks.ensureEnglishNote.mockImplementation(async (note) => note);
  mocks.assertCurrentScribeAuthority.mockResolvedValue({
    psychologistId: 'psy-1',
    clientId: 'client-1',
    vertical: 'DOCTOR',
  });
  mocks.pass1.mockResolvedValue({
    output: {
      transcript: 'Patient reports follow-up symptoms.',
      speakerSegments: [],
      affectFeatures: [],
      detectedLanguages: [],
    },
    callLog: callLog('PASS_1_TRANSCRIBE_AND_ANALYSE'),
  });
  mocks.pass2.mockResolvedValue({
    output: {
      kind: 'MEDICAL',
      encounterNote: { chiefComplaint: 'Follow-up', vitals: VITALS },
      medications: [MEDICATION],
      orders: [ORDER],
    },
    callLog: callLog('PASS_2_GENERATE_NOTE'),
  });
});

async function runWith(capabilities: PractitionerCapability[]) {
  mocks.getEffectiveCapabilities.mockResolvedValue({
    profession: 'PHYSICIAN',
    capabilities: new Set(capabilities),
  });
  return runNoteGeneration('session-1');
}

describe('runNoteGeneration medical optional-output authorization', () => {
  it('does not invoke Pass 2 when consent is withdrawn immediately before the model call', async () => {
    mocks.assertCurrentScribeAuthority.mockImplementation(async (_sessionId, boundary) => {
      if (boundary.source === 'pass2BeforeModel') throw new Error('authority denied');
      return { psychologistId: 'psy-1', clientId: 'client-1', vertical: 'DOCTOR' };
    });

    await expect(runWith(['MEDICAL_DOCUMENTATION'])).resolves.toMatchObject({ status: 'FAILED' });

    expect(mocks.pass2).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.writeAudit.mock.calls)).not.toContain('Patient reports');
  });

  it('does not persist Pass 2 PHI when authority is withdrawn before persistence', async () => {
    mocks.assertCurrentScribeAuthority.mockImplementation(async (_sessionId, boundary) => {
      if (boundary.source === 'pass2BeforePersistence') throw new Error('authority denied');
      return { psychologistId: 'psy-1', clientId: 'client-1', vertical: 'DOCTOR' };
    });

    await expect(runWith(['MEDICAL_DOCUMENTATION'])).resolves.toMatchObject({ status: 'FAILED' });

    expect(mocks.pass2).toHaveBeenCalledOnce();
    expect(mocks.noteDraftUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: expect.objectContaining({ chiefComplaint: 'Follow-up' }),
        }),
      }),
    );
    expect(JSON.stringify(mocks.writeAudit.mock.calls)).not.toContain('Follow-up');
  });

  it('completes documentation-only generation without persisting optional output', async () => {
    await expect(runWith(['MEDICAL_DOCUMENTATION'])).resolves.toMatchObject({
      draftId: 'draft-1',
      status: 'COMPLETED',
    });

    expect(mocks.getEffectiveCapabilities).toHaveBeenCalledWith('psy-1');
    expect(mocks.medicationCreateMany).not.toHaveBeenCalled();
    expect(mocks.clinicalOrderCreateMany).not.toHaveBeenCalled();
    expect(mocks.clinicalReadingCreateMany).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CAPABILITY_ACCESS_DENIED' }),
    );
    expect(mocks.noteDraftUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ riskSeverity: 'NONE' }) }),
    );
    expect(mocks.recordCrisisFlag).not.toHaveBeenCalled();
    expect(mocks.writeAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CRISIS_FLAG_RAISED' }),
      expect.anything(),
    );
  });

  it('persists only medication drafts for prescription-only authority', async () => {
    await expect(
      runWith(['MEDICAL_DOCUMENTATION', 'PRESCRIPTION_DRAFTING']),
    ).resolves.toMatchObject({ status: 'COMPLETED' });

    expect(mocks.medicationCreateMany).toHaveBeenCalledOnce();
    expect(mocks.clinicalOrderCreateMany).not.toHaveBeenCalled();
    expect(mocks.clinicalReadingCreateMany).not.toHaveBeenCalled();
  });

  it('persists only clinical orders for order-only authority', async () => {
    await expect(runWith(['MEDICAL_DOCUMENTATION', 'CLINICAL_ORDERS'])).resolves.toMatchObject({
      status: 'COMPLETED',
    });

    expect(mocks.medicationCreateMany).not.toHaveBeenCalled();
    expect(mocks.clinicalOrderCreateMany).toHaveBeenCalledOnce();
    expect(mocks.clinicalReadingCreateMany).not.toHaveBeenCalled();
  });

  it('persists only vitals for chronic-care-only authority', async () => {
    await expect(runWith(['MEDICAL_DOCUMENTATION', 'CHRONIC_CARE'])).resolves.toMatchObject({
      status: 'COMPLETED',
    });

    expect(mocks.medicationCreateMany).not.toHaveBeenCalled();
    expect(mocks.clinicalOrderCreateMany).not.toHaveBeenCalled();
    expect(mocks.clinicalReadingCreateMany).toHaveBeenCalledOnce();
  });
});

function setTherapyOutput(kind: SessionKind, severity: RiskSeverity) {
  mocks.sessionFindUnique.mockResolvedValue({
    ...SESSION,
    kind,
    psychologist: { vertical: 'THERAPIST' },
  });
  const note = {
    riskFlags: { severity, indicators: ['synthetic indicator'], details: 'synthetic detail' },
  };
  mocks.pass2.mockResolvedValue({
    output: kind === 'INTAKE' ? { kind, intakeNote: note } : { kind, therapyNote: note },
    callLog: callLog('PASS_2_GENERATE_NOTE'),
  });
}

describe.each(['INTAKE', 'TREATMENT', 'REVIEW'] as const)('batch %s note risk parity', (kind) => {
  it.each([
    ['none', 'NONE'],
    ['low', 'LOW'],
    ['medium', 'MEDIUM'],
    ['high', 'HIGH'],
    ['critical', 'CRITICAL'],
  ] as const)(
    'persists %s as %s with the existing crisis audit/metric behavior',
    async (severity, stored) => {
      setTherapyOutput(kind, severity);
      await expect(runWith(['BEHAVIORAL_HEALTH_DOCUMENTATION'])).resolves.toMatchObject({
        status: 'COMPLETED',
      });
      expect(mocks.noteDraftUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ riskSeverity: stored, status: 'COMPLETED' }),
        }),
      );
      const crisis = mocks.writeAudit.mock.calls.filter(
        ([entry]) => entry.action === 'CRISIS_FLAG_RAISED',
      );
      if (severity === 'high' || severity === 'critical') {
        expect(crisis).toHaveLength(1);
        expect(crisis[0]?.[0]).toMatchObject({
          actorType: 'SYSTEM',
          targetType: 'Session',
          targetId: 'session-1',
          metadata: {
            severity: stored,
            indicators: ['synthetic indicator'],
            details: 'synthetic detail',
            psychologistId: 'psy-1',
            clientId: 'client-1',
          },
        });
        expect(crisis[0]?.[1]).toEqual(expect.objectContaining({ noteDraft: expect.anything() }));
        expect(mocks.recordCrisisFlag).toHaveBeenCalledExactlyOnceWith(stored);
      } else {
        expect(crisis).toEqual([]);
        expect(mocks.recordCrisisFlag).not.toHaveBeenCalled();
      }
      expect(mocks.medicationCreateMany).not.toHaveBeenCalled();
      expect(mocks.clinicalReadingCreateMany).not.toHaveBeenCalled();
    },
  );
});

describe('batch therapy risk boundaries', () => {
  it('does not repeat a crisis audit/metric when a completed note is requested again', async () => {
    setTherapyOutput('TREATMENT', 'critical');
    await runWith(['BEHAVIORAL_HEALTH_DOCUMENTATION']);
    mocks.noteDraftFindUnique.mockResolvedValue({
      id: 'draft-1',
      status: 'COMPLETED',
      transcriptEncrypted: 'encrypted',
    });
    await runWith(['BEHAVIORAL_HEALTH_DOCUMENTATION']);
    expect(mocks.pass2).toHaveBeenCalledOnce();
    expect(mocks.recordCrisisFlag).toHaveBeenCalledExactlyOnceWith('CRITICAL');
    expect(
      mocks.writeAudit.mock.calls.filter(([entry]) => entry.action === 'CRISIS_FLAG_RAISED'),
    ).toHaveLength(1);
  });

  it('does not emit a crisis metric when the transactional crisis audit fails', async () => {
    setTherapyOutput('TREATMENT', 'high');
    mocks.writeAudit.mockImplementation(async (entry) => {
      if (entry.action === 'CRISIS_FLAG_RAISED') throw new Error('audit unavailable');
    });
    await expect(runWith(['BEHAVIORAL_HEALTH_DOCUMENTATION'])).resolves.toMatchObject({
      status: 'FAILED',
    });
    expect(mocks.recordCrisisFlag).not.toHaveBeenCalled();
  });
});
