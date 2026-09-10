import { describe, expect, it, vi } from 'vitest';
import {
  loadConsentRecovery,
  saveConsentRecovery,
  isSessionConsentFailure,
  liveNoteStatus,
} from './mind-consent-recovery-client';
import {
  MIND_CONSENT_RECOVERY_SCOPES,
  MIND_CONSENT_RECOVERY_SCRIPT_VERSION,
  type MindConsentRecoveryInput,
  type MindConsentRecoveryState,
} from './mind-consent-recovery';

const state: MindConsentRecoveryState = {
  sessionId: 'same-session',
  status: 'IN_PROGRESS',
  revision: 'a'.repeat(64),
  scriptVersion: MIND_CONSENT_RECOVERY_SCRIPT_VERSION,
  scopes: MIND_CONSENT_RECOVERY_SCOPES.map((scope) => ({
    scope,
    sessionAcknowledged: true,
    standingStatus: 'GRANTED',
  })),
  ready: true,
};
const input: MindConsentRecoveryInput = {
  operationId: '8b948e71-98c9-4b66-b405-2c437a5bc4ae',
  expectedRevision: 'a'.repeat(64),
  confirmations: { AUDIO_RECORDING: true, AI_NOTE_GENERATION: true, CROSS_BORDER_PROCESSING: true },
};
const signal = () => new AbortController().signal;

describe('same-session consent recovery client', () => {
  it('loads only the exact session without a cached response', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify(state)));
    expect(await loadConsentRecovery(state.sessionId, signal(), request)).toEqual(state);
    expect(request).toHaveBeenCalledWith(
      '/api/v1/sessions/same-session/consent-recovery',
      expect.objectContaining({ cache: 'no-store' }),
    );
    await expect(loadConsentRecovery('different-session', signal(), request)).rejects.toThrow(
      'could not be verified',
    );
  });
  it('sends all explicit confirmations and reuses the exact operation on retry', async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Lost response'))
      .mockResolvedValue(
        new Response(JSON.stringify({ ...state, operationId: input.operationId, replayed: true })),
      );
    await expect(saveConsentRecovery(state.sessionId, input, signal(), request)).rejects.toThrow();
    expect((await saveConsentRecovery(state.sessionId, input, signal(), request)).replayed).toBe(
      true,
    );
    expect(request.mock.calls[0][1].body).toBe(request.mock.calls[1][1].body);
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual(input);
  });
  it.each([
    { ready: false },
    { sessionId: 'different-session' },
    { operationId: '176c28f9-5e30-4cdb-a193-28f87e4f5bd2' },
    { revision: 'not-a-revision' },
  ])('rejects a receipt that cannot confirm this operation: %j', async (override) => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...state,
            operationId: input.operationId,
            replayed: false,
            ...override,
          }),
        ),
    );
    await expect(saveConsentRecovery(state.sessionId, input, signal(), request)).rejects.toThrow(
      'save reply could not be verified',
    );
  });
  it('rejects an unticked permission before sending any request', async () => {
    const request = vi.fn();
    await expect(
      saveConsentRecovery(
        state.sessionId,
        {
          ...input,
          confirmations: { ...input.confirmations, CROSS_BORDER_PROCESSING: false },
        } as unknown as MindConsentRecoveryInput,
        signal(),
        request,
      ),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('requires a reload after conflict and never surfaces raw server text', async () => {
    const request = vi.fn(
      async () => new Response('{"error":"RAW_INTERNAL_SCOPE"}', { status: 409 }),
    );
    await expect(
      saveConsentRecovery(state.sessionId, input, signal(), request),
    ).rejects.toMatchObject({ needsReload: true });
    await expect(
      saveConsentRecovery(state.sessionId, input, signal(), request),
    ).rejects.not.toThrow('RAW_INTERNAL_SCOPE');
  });
  it.each(['SESSION_INVALID_STATE', 'SESSION_CONCURRENT_MODIFICATION', undefined])(
    'does not misclassify %s as missing consent',
    (code) => {
      expect(isSessionConsentFailure(409, { code })).toBe(false);
    },
  );
  it('recognizes only the explicit consent error code with 409', () => {
    expect(isSessionConsentFailure(409, { code: 'SESSION_CONSENT_INVALID' })).toBe(true);
    expect(isSessionConsentFailure(403, { code: 'SESSION_CONSENT_INVALID' })).toBe(false);
  });
  it.each(['idle', 'connecting', 'error', 'paused', 'done'])(
    'never claims Writing when %s',
    (phase) => {
      expect(
        liveNoteStatus({ phase, consentBlocked: false, refreshing: false, updatedAgo: null }),
      ).not.toMatch(/Writing|Preparing/);
    },
  );
  it('consent-blocked state wins over stale updating and prior draft timestamps', () => {
    expect(
      liveNoteStatus({ phase: 'error', consentBlocked: true, refreshing: true, updatedAgo: 2 }),
    ).toBe('Capture off · consent required');
  });
});
