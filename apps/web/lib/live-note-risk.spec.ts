import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RiskSeverity, SessionKind } from '@cureocity/contracts';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requirePsychologistId: vi.fn(),
  requireCapability: vi.fn(),
  sessionFindUnique: vi.fn(),
  transaction: vi.fn(),
  upsert: vi.fn(),
  writeAudit: vi.fn(),
  encrypt: vi.fn(),
  translate: vi.fn(),
  metric: vi.fn(),
  after: vi.fn(),
  persistDraftedOrders: vi.fn(),
  persistVitalReadings: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: mocks.after,
}));
vi.mock('@/lib/auth-server', () => ({
  requirePsychologistId: mocks.requirePsychologistId,
  requireCapability: mocks.requireCapability,
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { session: { findUnique: mocks.sessionFindUnique }, $transaction: mocks.transaction },
}));
vi.mock('@/lib/audit', () => ({
  writeAudit: mocks.writeAudit,
  auditMetadataFromRequest: () => ({}),
}));
vi.mock('@/lib/tenant-crypto', () => ({ encryptForTenant: mocks.encrypt }));
vi.mock('@/lib/ensure-english-note', () => ({ ensureEnglishNote: mocks.translate }));
vi.mock('@/lib/note-orchestrator', () => ({
  persistDraftedOrders: mocks.persistDraftedOrders,
  persistVitalReadings: mocks.persistVitalReadings,
  runClinicalAnalysis: vi.fn(),
  runDifferential: vi.fn(),
}));
vi.mock('@/lib/transcribe-segment', () => ({ coverTranscriptWithSegments: vi.fn() }));
vi.mock('@cureocity/observability/metrics', () => ({ recordCrisisFlag: mocks.metric }));

import { POST } from '../app/api/v1/sessions/[id]/live-note/route';
import { ClientPhiWriteForbiddenError } from './phi-write-lock';

const auth = {
  ok: true,
  value: { psychologistId: 'psy-1', user: { capabilities: [] } },
};
const severityCases = [
  ['none', 'NONE'],
  ['low', 'LOW'],
  ['medium', 'MEDIUM'],
  ['high', 'HIGH'],
  ['critical', 'CRITICAL'],
] as const;

function therapyNote(kind: SessionKind, severity: RiskSeverity) {
  const fields =
    kind === 'INTAKE'
      ? {
          presentingConcerns: 'Synthetic intake',
          historyOfPresentingIllness: 'Synthetic history',
          pastPsychiatricHistory: '',
          familyHistory: '',
          socialHistory: '',
          mentalStatusExam: 'Synthetic observations',
          workingHypothesis: 'Review required',
          immediatePlan: 'Clinician to review',
        }
      : {
          modality: 'CBT',
          subjective: 'Synthetic statement',
          objective: 'Synthetic observation',
          assessment: 'Review required',
          plan: 'Clinician to review',
        };
  return {
    version: 'V1',
    ...fields,
    riskFlags: { severity, indicators: ['synthetic indicator'], details: 'synthetic detail' },
  };
}

let session: Record<string, unknown>;
let storedDraft: Record<string, unknown> | null;
let storedAudits: Array<Record<string, unknown>>;
let events: string[];
let clientActive: boolean;
let failAudit: boolean;
let failCommit: boolean;
let tx: {
  $queryRaw: ReturnType<typeof vi.fn>;
  session: { updateMany: ReturnType<typeof vi.fn>; findUniqueOrThrow: ReturnType<typeof vi.fn> };
  noteDraft: { upsert: typeof mocks.upsert };
};

beforeEach(() => {
  vi.resetAllMocks();
  session = {
    id: 'session-1',
    psychologistId: 'psy-1',
    clientId: 'client-1',
    kind: 'TREATMENT',
    status: 'IN_PROGRESS',
    scheduledAt: new Date('2026-09-05T10:00:00Z'),
    language: 'en',
    modality: 'CBT',
    client: { presentingConcerns: null },
    psychologist: { vertical: 'THERAPIST', specialty: null },
    therapyNote: null,
  };
  storedDraft = null;
  storedAudits = [];
  events = [];
  clientActive = true;
  failAudit = false;
  failCommit = false;
  mocks.requirePsychologistId.mockResolvedValue(auth);
  mocks.requireCapability.mockResolvedValue(auth);
  mocks.sessionFindUnique.mockImplementation(async () => ({ ...session }));
  mocks.encrypt.mockResolvedValue('encrypted-transcript');
  mocks.translate.mockImplementation(async (note) => note);
  mocks.metric.mockImplementation(() => events.push('metric'));
  mocks.upsert.mockImplementation(async ({ create, update }) => {
    storedDraft = { ...(storedDraft ?? { id: 'draft-1' }), ...(storedDraft ? update : create) };
    return storedDraft;
  });
  mocks.writeAudit.mockImplementation(async (entry, auditTx) => {
    expect(auditTx).toBe(tx);
    if (failAudit && entry.action === 'CRISIS_FLAG_RAISED') throw new Error('audit unavailable');
    storedAudits.push(entry);
  });
  tx = {
    $queryRaw: vi.fn(async () =>
      clientActive ? [{ id: 'client-1', psychologistId: 'psy-1' }] : [],
    ),
    session: {
      updateMany: vi.fn(async ({ where, data }) => {
        if (session.status !== where.status) return { count: 0 };
        Object.assign(session, data);
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async () => ({ ...session })),
    },
    noteDraft: { upsert: mocks.upsert },
  };
  mocks.transaction.mockImplementation(async (callback) => {
    const before = { session: { ...session }, draft: storedDraft, audits: [...storedAudits] };
    try {
      const value = await callback(tx);
      if (failCommit) throw new Error('commit failed');
      events.push('commit');
      return value;
    } catch (error) {
      session = before.session;
      storedDraft = before.draft;
      storedAudits = before.audits;
      events.push('rollback');
      throw error;
    }
  });
});

function post(body: unknown) {
  return POST(
    new Request('https://mind.example/api/v1/sessions/session-1/live-note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as NextRequest,
    { params: Promise.resolve({ id: 'session-1' }) },
  );
}

function payload(kind: SessionKind = 'TREATMENT', severity: RiskSeverity = 'high') {
  return { kind, note: therapyNote(kind, severity), transcript: 'Synthetic transcript' };
}

describe.each(['INTAKE', 'TREATMENT', 'REVIEW'] as const)('Mind live %s note risk', (kind) => {
  it.each(severityCases)(
    'persists %s as %s and escalates only high/critical after commit',
    async (severity, stored) => {
      session.kind = kind;
      expect((await post(payload(kind, severity))).status).toBe(201);
      expect(storedDraft).toMatchObject({
        riskSeverity: stored,
        transcriptEncrypted: 'encrypted-transcript',
      });
      expect(mocks.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ riskSeverity: stored }),
          update: expect.objectContaining({ riskSeverity: stored }),
        }),
      );
      const crisis = storedAudits.filter((entry) => entry.action === 'CRISIS_FLAG_RAISED');
      if (severity === 'high' || severity === 'critical') {
        expect(crisis).toEqual([
          expect.objectContaining({
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
          }),
        ]);
        expect(mocks.metric).toHaveBeenCalledExactlyOnceWith(stored);
        expect(events).toEqual(['commit', 'metric']);
      } else {
        expect(crisis).toEqual([]);
        expect(mocks.metric).not.toHaveBeenCalled();
      }
      expect(mocks.persistDraftedOrders).not.toHaveBeenCalled();
      expect(mocks.persistVitalReadings).not.toHaveBeenCalled();
    },
  );
});

describe('Mind live risk persistence boundaries', () => {
  it('does not duplicate draft/crisis/lifecycle effects or metrics on replay', async () => {
    expect((await post(payload())).status).toBe(201);
    expect((await post(payload())).status).toBe(409);
    expect(mocks.upsert).toHaveBeenCalledOnce();
    for (const action of ['NOTE_DRAFT_CREATED', 'CRISIS_FLAG_RAISED', 'SESSION_ENDED']) {
      expect(storedAudits.filter((entry) => entry.action === action)).toHaveLength(1);
    }
    expect(mocks.metric).toHaveBeenCalledExactlyOnceWith('HIGH');
  });

  it.each(['CANCELLED', 'NO_SHOW', 'COMPLETED'])(
    'refuses stale completion from %s before risk writes',
    async (status) => {
      session.status = status;
      expect((await post(payload())).status).toBe(409);
      expect(mocks.upsert).not.toHaveBeenCalled();
      expect(storedAudits).toEqual([]);
      expect(mocks.metric).not.toHaveBeenCalled();
    },
  );

  it('does not save or emit crisis effects when transcript encryption fails', async () => {
    mocks.encrypt.mockRejectedValue(new Error('KMS unavailable'));
    expect((await post(payload())).status).toBe(503);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(storedDraft).toBeNull();
    expect(mocks.metric).not.toHaveBeenCalled();
  });

  it.each(['audit', 'commit'])(
    'does not leave a completed draft or emit a metric after %s failure',
    async (failure) => {
      failAudit = failure === 'audit';
      failCommit = failure === 'commit';
      await expect(post(payload())).rejects.toThrow();
      expect(session.status).toBe('IN_PROGRESS');
      expect(storedDraft).toBeNull();
      expect(storedAudits).toEqual([]);
      expect(mocks.metric).not.toHaveBeenCalled();
    },
  );

  it('respects the active-client lock when erasure wins', async () => {
    clientActive = false;
    await expect(post(payload())).rejects.toBeInstanceOf(ClientPhiWriteForbiddenError);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.metric).not.toHaveBeenCalled();
  });

  it('rejects an invalid clinical severity at the request boundary', async () => {
    const invalid = payload();
    expect(
      (await post({ ...invalid, note: { ...invalid.note, riskFlags: { severity: 'urgent' } } }))
        .status,
    ).toBe(400);
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.metric).not.toHaveBeenCalled();
  });

  it('keeps owner, signature and documentation capability guards before persistence', async () => {
    session.psychologistId = 'another-practitioner';
    expect((await post(payload())).status).toBe(404);
    session.psychologistId = 'psy-1';
    session.therapyNote = { signedAt: new Date() };
    expect((await post(payload())).status).toBe(409);
    session.therapyNote = null;
    mocks.requireCapability.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    });
    expect((await post(payload())).status).toBe(403);
    expect(mocks.requireCapability).toHaveBeenCalledWith(
      expect.anything(),
      'BEHAVIORAL_HEALTH_DOCUMENTATION',
      auth,
    );
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.metric).not.toHaveBeenCalled();
  });

  it('preserves doctor live behavior without applying therapist risk escalation', async () => {
    session.psychologist = { vertical: 'DOCTOR', specialty: null };
    const response = await post({
      note: { version: 'V1', chiefComplaint: 'Synthetic concern' },
      transcript: 'Synthetic transcript',
    });
    expect(response.status).toBe(201);
    expect(storedDraft).toMatchObject({ riskSeverity: 'NONE' });
    expect(storedAudits.some((entry) => entry.action === 'ENCOUNTER_NOTE_DRAFTED')).toBe(true);
    expect(storedAudits.some((entry) => entry.action === 'CRISIS_FLAG_RAISED')).toBe(false);
    expect(mocks.metric).not.toHaveBeenCalled();
    expect(mocks.translate).not.toHaveBeenCalled();
    expect(mocks.requireCapability).toHaveBeenCalledWith(
      expect.anything(),
      'MEDICAL_DOCUMENTATION',
      auth,
    );
  });
});
