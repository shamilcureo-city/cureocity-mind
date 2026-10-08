import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const state = vi.hoisted(() => ({
  vertical: 'DOCTOR',
  denied: false,
  erased: false,
  withdrawn: false,
  owner: 'doctor-1',
  status: 'IN_PROGRESS',
  captureMode: 'LIVE',
  manual: false,
  signed: false,
  audioCount: 0,
  draft: null as Record<string, unknown> | null,
  ciphertexts: new Map<string, string>(),
  audit: vi.fn(),
  encrypt: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock('./auth-server', () => ({
  requireCapability: vi.fn(async () =>
    state.denied
      ? { ok: false, response: NextResponse.json({ error: 'Denied' }, { status: 403 }) }
      : { ok: true, value: { psychologistId: 'doctor-1', user: { vertical: state.vertical } } },
  ),
}));
vi.mock('./tenant-crypto', () => ({
  encryptForTenant: state.encrypt,
  decryptForTenant: vi.fn(
    async (_id: string, ciphertext: string) => state.ciphertexts.get(ciphertext) ?? null,
  ),
}));
vi.mock('./audit', () => ({ writeAudit: state.audit, auditMetadataFromRequest: () => ({}) }));
vi.mock('./phi-write-lock', () => {
  class ClientPhiWriteForbiddenError extends Error {}
  return {
    ClientPhiWriteForbiddenError,
    lockActiveClientForSession: vi.fn(async () => {
      if (state.erased) throw new ClientPhiWriteForbiddenError();
    }),
  };
});
vi.mock('./consent-gate', () => {
  class Denied extends Error {}
  return {
    assertValidScribeConsent: vi.fn(async () => {
      if (state.withdrawn) throw new Denied();
    }),
    consentAuthorizationResponse: (error: unknown) =>
      error instanceof Denied
        ? NextResponse.json({ error: 'Consent withdrawn' }, { status: 409 })
        : null,
  };
});
vi.mock('./prisma', () => ({
  prisma: {
    $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        $queryRaw: vi.fn(async () => []),
        session: {
          findUnique: vi.fn(async () => ({
            id: 'session-1',
            clientId: 'client-1',
            psychologistId: state.owner,
            status: state.status,
            captureMode: state.captureMode,
            mindDocumentationMode: state.manual ? 'MANUAL' : 'AI',
            consentSnapshot: {},
            therapyNote: state.signed ? { id: 'signed' } : null,
            noteDraft: state.draft,
          })),
        },
        noteDraft: { upsert: state.upsert },
        audioChunk: { count: vi.fn(async () => state.audioCount) },
      }),
  },
}));

import { GET, PUT } from '../app/api/v1/sessions/[id]/scribe-capture-recovery/route';
const row = {
  id: 'u1',
  speaker: 'patient',
  text: 'Fictional captured words.',
  tStartMs: 0,
  tEndMs: 1000,
};
const payload = (utterances = [row], captureIncomplete = false) => ({
  version: 1,
  utterances,
  captureIncomplete,
});
const request = (body = payload()) =>
  new NextRequest('https://scribe.example/api/v1/sessions/session-1/scribe-capture-recovery', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const context = { params: Promise.resolve({ id: 'session-1' }) };
const put = (body = payload()) => PUT(request(body), context);
const get = () =>
  GET(
    new NextRequest('https://scribe.example/api/v1/sessions/session-1/scribe-capture-recovery'),
    context,
  );

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, {
    vertical: 'DOCTOR',
    denied: false,
    erased: false,
    withdrawn: false,
    owner: 'doctor-1',
    status: 'IN_PROGRESS',
    captureMode: 'LIVE',
    manual: false,
    signed: false,
    audioCount: 0,
    draft: null,
  });
  state.ciphertexts.clear();
  state.encrypt.mockImplementation(async (_id: string, text: string) => {
    const key = `sealed-${state.ciphertexts.size}`;
    state.ciphertexts.set(key, text);
    return key;
  });
  state.upsert.mockImplementation(
    async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
      state.draft = {
        id: 'draft-1',
        ...(state.draft ?? {}),
        ...(state.draft ? args.update : args.create),
      };
      return state.draft;
    },
  );
});

describe('Scribe encrypted capture checkpoint route', () => {
  it('acknowledges encrypted source without completing, signing, or generating a draft', async () => {
    const res = await put();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true, sessionId: 'session-1', utteranceCount: 1 });
    expect(state.draft).toEqual({
      id: 'draft-1',
      sessionId: 'session-1',
      status: 'PENDING',
      recoveryTranscriptEncrypted: 'sealed-0',
    });
    expect(JSON.stringify(state.draft)).not.toContain(row.text);
    expect(JSON.stringify(state.audit.mock.calls)).not.toContain(row.text);
    const read = await get();
    expect(read.headers.get('cache-control')).toBe('no-store');
    expect(await read.json()).toEqual({ sessionId: 'session-1', recovery: payload() });
    expect(state.audit).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'NOTE_DRAFT_VIEWED' }),
      expect.anything(),
    );
  });
  it('returns null for a new consultation and rejects unrecoverable ciphertext', async () => {
    expect(await (await get()).json()).toEqual({ sessionId: 'session-1', recovery: null });
    state.draft = { id: 'draft-1', recoveryTranscriptEncrypted: 'unknown' };
    expect((await get()).status).toBe(503);
    expect(state.upsert).not.toHaveBeenCalled();
  });
  it('allows monotonic append and rejects overwrite, shortening, and cleared warning', async () => {
    expect((await put(payload([row], true))).status).toBe(200);
    const second = { ...row, id: 'u2', text: 'More fictional words.' };
    expect((await put(payload([row, second], true))).status).toBe(200);
    const saved = state.draft!.recoveryTranscriptEncrypted;
    for (const body of [
      payload([row], true),
      payload([row, second]),
      payload([{ ...row, text: 'Rewritten.' }, second], true),
    ])
      expect((await put(body)).status).toBe(409);
    expect(state.draft!.recoveryTranscriptEncrypted).toBe(saved);
  });
  it.each(['denied', 'erased', 'withdrawn', 'signed', 'manual'] as const)(
    'rejects %s without checkpoint mutation',
    async (flag) => {
      state[flag] = true;
      expect((await put()).status).toBe(flag === 'denied' ? 403 : flag === 'erased' ? 404 : 409);
      expect(state.upsert).not.toHaveBeenCalled();
    },
  );
  it.each(['SCHEDULED', 'COMPLETED', 'CANCELLED'])(
    'rejects write for %s lifecycle',
    async (status) => {
      state.status = status;
      expect((await put()).status).toBe(409);
      expect(state.upsert).not.toHaveBeenCalled();
    },
  );
  it('refuses Mind, foreign owner, other capture modes, and existing batch audio', async () => {
    state.vertical = 'THERAPIST';
    expect((await put()).status).toBe(403);
    state.vertical = 'DOCTOR';
    state.owner = 'other';
    expect((await put()).status).toBe(404);
    state.owner = 'doctor-1';
    state.captureMode = 'UPLOAD';
    expect((await put()).status).toBe(409);
    state.captureMode = 'LIVE';
    state.audioCount = 1;
    expect((await put()).status).toBe(409);
    expect(state.upsert).not.toHaveBeenCalled();
  });
  it.each([{ status: 'COMPLETED' }, { status: 'IN_PROGRESS' }, { content: {} }])(
    'does not overwrite an existing clinical draft %j',
    async (draft) => {
      state.draft = { id: 'draft-1', ...draft };
      expect((await put()).status).toBe(409);
      expect(state.upsert).not.toHaveBeenCalled();
    },
  );
  it('rejects duplicates and known generated text before encryption', async () => {
    expect((await put(payload([row, row]))).status).toBe(400);
    expect(
      (
        await put(
          payload([
            {
              ...row,
              text: 'PLACEHOLDER: This is a placeholder for the audio transcription. The actual transcription will be generated based on the audio input.',
            },
          ]),
        )
      ).status,
    ).toBe(422);
    expect(state.encrypt).not.toHaveBeenCalled();
    expect(state.upsert).not.toHaveBeenCalled();
  });
  it('fails closed when encryption is unavailable', async () => {
    state.encrypt.mockRejectedValue(new Error('fictional encryption failure'));
    expect((await put()).status).toBe(503);
    expect(state.upsert).not.toHaveBeenCalled();
  });
});
