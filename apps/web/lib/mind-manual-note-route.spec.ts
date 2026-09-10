import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  MindManualNoteFieldsSchema,
  canonicalMindManualNote,
  sessionKindForMindPurpose,
} from '@cureocity/contracts';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  capability: vi.fn(),
  lock: vi.fn(),
  query: vi.fn(),
  session: vi.fn(),
  update: vi.fn(),
  draft: vi.fn(),
  canonical: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock('@/lib/auth-server', () => ({
  requirePsychologistId: mocks.auth,
  requireCapability: mocks.capability,
}));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('@/lib/audit', () => ({
  writeAudit: mocks.audit,
  auditMetadataFromRequest: () => ({ requestId: 'fictional' }),
}));
vi.mock('@/lib/tenant-crypto', () => ({
  encryptForTenant: mocks.encrypt,
  decryptForTenant: mocks.decrypt,
}));
vi.mock('@/lib/phi-write-lock', async (original) => ({
  ...(await original<typeof import('./phi-write-lock')>()),
  lockActiveClientForSession: mocks.lock,
}));
import { GET, POST } from '../app/api/v1/sessions/[id]/manual-note/route';
import { ClientPhiWriteForbiddenError } from './phi-write-lock';

const now = new Date('2026-09-10T10:00:00.000Z');
const ctx = { params: Promise.resolve({ id: 's1' }) };
type Current = {
  id: string;
  clientId: string;
  psychologistId: string;
  status: string;
  kind: string;
  mindPurpose: string | null;
  mindDocumentationMode: string | null;
  modality: 'SUPPORTIVE' | 'CBT' | null;
  captureMode: string | null;
  updatedAt: Date;
  consentSnapshot: unknown;
  noteDraft: { content: unknown; updatedAt: Date } | null;
  therapyNote: { locked: boolean; signedAt: Date } | null;
  mindManualNoteDraft: {
    encryptedFields: string | null;
    revision: number;
    lastMutationId: string;
    lastMutationHashEncrypted: string;
  } | null;
  _count: { audioChunks: number; transcriptSegments: number; geminiCallLogs: number };
};
let current: Current;
const envelopes = new Map<string, string>();
const tx = {
  $queryRaw: mocks.query,
  session: { findUnique: mocks.session, update: mocks.update },
  mindManualNoteDraft: { upsert: mocks.draft },
  noteDraft: { upsert: mocks.canonical },
};
const request = (body?: unknown) =>
  new NextRequest('http://localhost/api/v1/sessions/s1/manual-note', {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
const fields = () =>
  MindManualNoteFieldsSchema.parse({
    subjective: 'Client described workplace worry.',
    objective: 'Discussed the agreed focus.',
    assessment: 'Further assessment is needed; no diagnosis confirmed.',
    plan: 'Continue assessment next visit.',
    riskSeverity: 'none',
    riskDetails:
      'Asked about current safety. No current concern reported; review again if circumstances change.',
  });
const writeInput = (operation = 'save', overrides = {}) => ({
  operation,
  expectedRevision: current.mindManualNoteDraft?.revision ?? 0,
  expectedNoteUpdatedAt: current.noteDraft?.updatedAt.toISOString() ?? null,
  mutationId: 'a433f7e1-06fb-41aa-afb7-a9e19c20d85b',
  fields: fields(),
  ...overrides,
});
beforeEach(() => {
  vi.resetAllMocks();
  envelopes.clear();
  current = {
    id: 's1',
    clientId: 'c1',
    psychologistId: 'p1',
    status: 'SCHEDULED',
    kind: 'TREATMENT',
    mindPurpose: null,
    mindDocumentationMode: null,
    modality: 'SUPPORTIVE',
    captureMode: null,
    updatedAt: now,
    consentSnapshot: null,
    noteDraft: null,
    therapyNote: null,
    mindManualNoteDraft: null,
    _count: { audioChunks: 0, transcriptSegments: 0, geminiCallLogs: 0 },
  };
  mocks.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'p1', user: { vertical: 'THERAPIST' } },
  });
  mocks.capability.mockImplementation(async (_req, _cap, auth) => auth);
  mocks.lock.mockResolvedValue({ id: 'c1', psychologistId: 'p1' });
  mocks.session.mockImplementation(async () => structuredClone(current));
  mocks.update.mockImplementation(async ({ data }) => Object.assign(current, data));
  mocks.draft.mockImplementation(async ({ create, update }) => {
    current.mindManualNoteDraft = current.mindManualNoteDraft
      ? { ...current.mindManualNoteDraft, ...update }
      : create;
    return current.mindManualNoteDraft;
  });
  mocks.canonical.mockImplementation(async ({ create, update }) => {
    current.noteDraft = current.noteDraft
      ? { ...current.noteDraft, ...update }
      : { ...create, updatedAt: now };
    return current.noteDraft;
  });
  mocks.encrypt.mockImplementation(async (_owner, plaintext) => {
    const key = `envelope-${envelopes.size}`;
    envelopes.set(key, plaintext);
    return key;
  });
  mocks.decrypt.mockImplementation(async (_owner, ciphertext) => envelopes.get(ciphertext) ?? null);
  mocks.transaction.mockImplementation(async (run) => {
    const before = structuredClone(current);
    try {
      return await run(tx);
    } catch (error) {
      current = before;
      throw error;
    }
  });
});
async function start() {
  return POST(request({ operation: 'start', expectedUpdatedAt: now.toISOString() }), ctx);
}

describe('clinician-written sessions', () => {
  it('starts without recording/AI/cross-border consent and does not fabricate consent, transcript or model output', async () => {
    const response = await start();
    expect(response.status).toBe(200);
    expect(current).toMatchObject({
      status: 'IN_PROGRESS',
      mindDocumentationMode: 'MANUAL',
      consentSnapshot: null,
      noteDraft: null,
    });
    expect(mocks.canonical).not.toHaveBeenCalled();
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SESSION_STARTED',
        metadata: expect.objectContaining({ source: 'CLINICIAN_WRITTEN' }),
      }),
      tx,
    );
    expect((await start()).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });
  it('preserves existing consent history without regranting it', async () => {
    current.consentSnapshot = { entries: [{ scope: 'AUDIO_RECORDING', ackedAt: 'historic' }] };
    expect((await start()).status).toBe(200);
    expect(current.consentSnapshot).toEqual({
      entries: [{ scope: 'AUDIO_RECORDING', ackedAt: 'historic' }],
    });
  });
  it('honors a further assessment choice even when the inferred kind was treatment', async () => {
    const response = await POST(
      request({
        operation: 'start',
        expectedUpdatedAt: now.toISOString(),
        mindPurpose: 'ASSESSMENT',
      }),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(current.kind).toBe('INTAKE');
    expect(current.mindPurpose).toBe('ASSESSMENT');
    expect(current.modality).toBeNull();
  });
  it('uses supportive counselling rather than a previous therapy modality', async () => {
    current.modality = 'CBT';
    const response = await POST(
      request({
        operation: 'start',
        expectedUpdatedAt: now.toISOString(),
        mindPurpose: 'COUNSELLING',
      }),
      ctx,
    );
    expect(response.status).toBe(200);
    expect(current.kind).toBe('TREATMENT');
    expect(current.mindPurpose).toBe('COUNSELLING');
    expect(current.modality).toBe('SUPPORTIVE');
  });
  it.each(['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'])(
    'does not convert a %s capture session to manual',
    async (status) => {
      current.status = status;
      expect((await start()).status).toBe(409);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );
  it.each(['audioChunks', 'transcriptSegments', 'geminiCallLogs'] as const)(
    'preserves a scheduled session with existing %s work',
    async (key) => {
      current._count[key] = 1;
      expect((await start()).status).toBe(409);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );
  it('rejects stale activation', async () => {
    current.updatedAt = new Date(now.getTime() + 1);
    expect((await start()).status).toBe(409);
  });
  it('rejects unauthenticated, doctor, missing-capability, wrong-owner and erased-client reads/writes', async () => {
    mocks.auth.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Sign in' }, { status: 401 }),
    });
    expect((await start()).status).toBe(401);
    mocks.auth.mockResolvedValueOnce({
      ok: true,
      value: { psychologistId: 'p1', user: { vertical: 'DOCTOR' } },
    });
    expect((await start()).status).toBe(404);
    mocks.capability.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Not available' }, { status: 403 }),
    });
    expect((await start()).status).toBe(403);
    current.psychologistId = 'other';
    expect((await start()).status).toBe(404);
    mocks.lock.mockRejectedValue(new ClientPhiWriteForbiddenError());
    expect((await GET(request(), ctx)).status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('persists incomplete fields only inside encrypted server recovery, never canonical generated output', async () => {
    await start();
    const input = writeInput('save', { fields: { subjective: 'Fictional unfinished note' } });
    const response = await POST(request(input), ctx);
    expect(response.status).toBe(200);
    expect(current.mindManualNoteDraft?.encryptedFields).toBe('envelope-0');
    expect(current.noteDraft).toBeNull();
    expect(await response.json()).toMatchObject({
      revision: 1,
      hasUnappliedDraft: true,
      fields: { subjective: 'Fictional unfinished note', riskSeverity: null },
    });
    expect(mocks.audit).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'NOTE_DRAFT_EDITED' }),
      tx,
    );
  });
  it('retries an uncertain save once without overwriting a newer revision', async () => {
    await start();
    const input = writeInput();
    expect((await POST(request(input), ctx)).status).toBe(200);
    expect((await POST(request(input), ctx)).status).toBe(200);
    expect(mocks.draft).toHaveBeenCalledTimes(1);
    expect(
      (await POST(request({ ...input, fields: { ...fields(), subjective: 'different' } }), ctx))
        .status,
    ).toBe(409);
    expect(
      (await POST(request({ ...input, mutationId: 'b433f7e1-06fb-41aa-afb7-a9e19c20d85b' }), ctx))
        .status,
    ).toBe(409);
  });
  it('finishes unsigned into the existing note shape with no transcript, evidence or artificial model passes', async () => {
    await start();
    const input = writeInput('complete');
    const result = await POST(request(input), ctx);
    expect(result.status).toBe(200);
    expect(current.status).toBe('COMPLETED');
    expect(current.mindManualNoteDraft?.encryptedFields).toBeNull();
    expect(current.noteDraft).toMatchObject({
      status: 'COMPLETED',
      content: { subjective: fields().subjective, linkedEvidence: [], phaseHints: [] },
    });
    expect(current.noteDraft).not.toHaveProperty('transcriptEncrypted');
    expect(current.therapyNote).toBeNull();
    expect((await POST(request(input), ctx)).status).toBe(200);
    expect(mocks.canonical).toHaveBeenCalledTimes(1);
  });
  it('does not invent a risk assessment or fill missing clinical fields to make the note signable', async () => {
    await start();
    expect((await POST(request(writeInput('complete', { fields: {} })), ctx)).status).toBe(409);
    expect(current.noteDraft).toBeNull();
    expect(current.status).toBe('IN_PROGRESS');
    expect(() =>
      canonicalMindManualNote('TREATMENT', 'SUPPORTIVE', { ...fields(), riskSeverity: null }),
    ).toThrow();
  });
  it('refuses a stale canonical note version even when the manual revision is unchanged', async () => {
    await start();
    await POST(request(writeInput('complete')), ctx);
    const prior = writeInput('complete', { mutationId: 'b433f7e1-06fb-41aa-afb7-a9e19c20d85b' });
    current.noteDraft!.updatedAt = new Date(now.getTime() + 1);
    expect((await POST(request(prior), ctx)).status).toBe(409);
    expect(mocks.canonical).toHaveBeenCalledTimes(1);
  });
  it('blocks signed/locked notes and preserves work if secure persistence fails', async () => {
    await start();
    current.therapyNote = { locked: true, signedAt: now };
    expect((await POST(request(writeInput()), ctx)).status).toBe(409);
    expect(mocks.encrypt).not.toHaveBeenCalled();
    current.therapyNote = null;
    mocks.encrypt.mockRejectedValueOnce(new Error('Fictional private text'));
    const response = await POST(request(writeInput()), ctx);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('Fictional private text');
    expect(current.mindManualNoteDraft).toBeNull();
  });
  it('rolls back note and lifecycle when audit persistence fails', async () => {
    await start();
    mocks.audit.mockRejectedValueOnce(new Error('Audit unavailable'));
    expect((await POST(request(writeInput('complete')), ctx)).status).toBe(503);
    expect(current.status).toBe('IN_PROGRESS');
    expect(current.noteDraft).toBeNull();
    expect(current.mindManualNoteDraft).toBeNull();
  });
  it('allows no-diagnosis counselling and explicit review without changing existing SessionKind values', () => {
    expect(sessionKindForMindPurpose('COUNSELLING')).toBe('TREATMENT');
    expect(sessionKindForMindPurpose('REVIEW')).toBe('REVIEW');
    expect(canonicalMindManualNote('TREATMENT', 'SUPPORTIVE', fields())).toMatchObject({
      assessment: fields().assessment,
    });
  });
});
