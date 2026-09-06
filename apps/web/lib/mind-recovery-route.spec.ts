import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { buildRecoveryPrefix, mergeRecoveryPrefix } from './mind-recovery-prefix';

const state = vi.hoisted(() => ({
  vertical: 'THERAPIST',
  denied: false,
  erased: false,
  withdrawn: false,
  status: 'IN_PROGRESS',
  signed: false,
  audioCount: 0,
  draft: null as Record<string, unknown> | null,
  ciphertexts: new Map<string, string>(),
  audit: vi.fn(),
  encrypt: vi.fn(),
  updates: vi.fn(),
}));
vi.mock('./auth-server', () => ({
  requireCapability: vi.fn(async () =>
    state.denied
      ? { ok: false, response: NextResponse.json({ error: 'Denied' }, { status: 403 }) }
      : { ok: true, value: { psychologistId: 'psy-1', user: { vertical: state.vertical } } },
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
            psychologistId: 'psy-1',
            status: state.status,
            consentSnapshot: {},
            therapyNote: state.signed ? { id: 'signed-1' } : null,
            noteDraft: state.draft,
          })),
          update: state.updates,
        },
        noteDraft: {
          upsert: vi.fn(
            async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
              state.draft = { id: 'draft-1', ...(state.draft ? args.update : args.create) };
              return state.draft;
            },
          ),
        },
        audioChunk: { count: vi.fn(async () => state.audioCount) },
      }),
  },
}));

import { POST } from '../app/api/v1/sessions/[id]/recovery-transcript/route';
const utterances = [
  {
    id: 'u1',
    speaker: 'patient' as const,
    text: 'Original live words.',
    tStartMs: 0,
    tEndMs: 1000,
  },
];
const request = (action = 'CONTINUE_RECORDING', rows = utterances) =>
  new NextRequest('https://mind.example/api/v1/sessions/session-1/recovery-transcript', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, utterances: rows }),
  });
const run = (req = request()) => POST(req, { params: Promise.resolve({ id: 'session-1' }) });

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = false;
  state.erased = false;
  state.withdrawn = false;
  state.vertical = 'THERAPIST';
  state.status = 'IN_PROGRESS';
  state.signed = false;
  state.audioCount = 0;
  state.draft = null;
  state.ciphertexts.clear();
  state.encrypt.mockImplementation(async (_id: string, text: string) => {
    const key = `sealed-${state.ciphertexts.size}`;
    state.ciphertexts.set(key, text);
    return key;
  });
  state.updates.mockImplementation(async () => {
    state.status = 'COMPLETED';
  });
});

describe('recovery POST adapter', () => {
  it('acknowledges encrypted prefix without completing a handoff session', async () => {
    const response = await run();
    expect(response.status).toBe(200);
    expect(state.draft?.recoveryTranscriptEncrypted).toMatch(/^sealed-/);
    expect(state.draft?.transcriptEncrypted).toMatch(/^sealed-/);
    expect(JSON.stringify(state.draft)).not.toContain('Original live words');
    expect(state.updates).not.toHaveBeenCalled();
    expect(JSON.stringify(state.audit.mock.calls)).not.toContain('Original live words');
  });
  it('finalize checkpoints then ends once; a repeated request is idempotent', async () => {
    expect((await run(request('FINALIZE'))).status).toBe(200);
    expect((await run(request('FINALIZE'))).status).toBe(200);
    expect(state.updates).toHaveBeenCalledOnce();
  });
  it('refuses stale conflicting recovery words rather than overwriting the prefix', async () => {
    await run();
    const saved = state.draft?.recoveryTranscriptEncrypted;
    expect(
      (await run(request('CONTINUE_RECORDING', [{ ...utterances[0], text: 'Different words.' }])))
        .status,
    ).toBe(409);
    expect(state.draft?.recoveryTranscriptEncrypted).toBe(saved);
  });
  it.each(['denied', 'erased', 'withdrawn', 'signed'] as const)(
    'rejects %s before a clinical write',
    async (flag) => {
      state[flag] = true;
      expect((await run()).status).toBe(flag === 'denied' ? 403 : flag === 'erased' ? 404 : 409);
      expect(state.draft).toBeNull();
      expect(state.updates).not.toHaveBeenCalled();
    },
  );
  it('cannot use Mind recovery for a doctor', async () => {
    state.vertical = 'DOCTOR';
    expect((await run()).status).toBe(409);
    expect(state.encrypt).not.toHaveBeenCalled();
  });
  it('cannot prepend an untracked live prefix after batch audio already exists', async () => {
    state.audioCount = 1;
    expect((await run()).status).toBe(409);
    expect(state.draft).toBeNull();
  });
  it('fails closed on secure storage failure and never reports a saved session', async () => {
    state.encrypt.mockRejectedValue(new Error('KMS unavailable'));
    expect((await run()).status).toBe(503);
    expect(state.draft).toBeNull();
    expect(state.updates).not.toHaveBeenCalled();
  });
  it('rejects duplicate utterances at the actual request contract', async () => {
    expect((await run(request('FINALIZE', [utterances[0], utterances[0]]))).status).toBe(400);
    expect(state.draft).toBeNull();
  });
});

it('offsets batch speakers after the imported prefix and never mutates either source', () => {
  const prefix = buildRecoveryPrefix(utterances);
  const batch = {
    transcript: 'After switch.',
    speakerSegments: [
      { speaker: 'client' as const, text: 'After switch.', startMs: 0, endMs: 500 },
    ],
  };
  const merged = mergeRecoveryPrefix(prefix, batch);
  expect(merged.transcript).toBe('Client: Original live words.\nAfter switch.');
  expect(merged.speakerSegments[1].startMs).toBe(1000);
  expect(batch.speakerSegments[0].startMs).toBe(0);
});
