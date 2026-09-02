import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createMindShareRequestLifecycle,
  type MindShareLoadState,
  type MindShareRequestIdentity,
} from './mind-share-request-lifecycle';
import type { MindOutcomeCandidate } from './mind-care-loop';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

const identity = (mindSessionId: string, clientId: string): MindShareRequestIdentity => ({
  mindSessionId,
  clientId,
});

const candidate = (mindSessionId: string, patientTakeaway: string): MindOutcomeCandidate => ({
  label: 'Session takeaway',
  artefact: { artefactType: 'SESSION_TAKEAWAY', sessionId: mindSessionId },
  patientTakeaway,
});

describe('R2-06 request-bound Mind share lifecycle', () => {
  it.each([
    ['session', identity('session-b', 'client-a')],
    ['client', identity('session-a', 'client-b')],
  ])('synchronously clears all request-bound state on a %s A→B transition', async (_, next) => {
    let state: MindShareLoadState = { status: 'closed', requestIdentity: null };
    const clearPhi = vi.fn();
    const resetDeliveryIdentity = vi.fn();
    const lifecycle = createMindShareRequestLifecycle({
      clearPhi,
      resetDeliveryIdentity,
      applyState: (value) => {
        state = value;
      },
    });
    const a = deferred<MindOutcomeCandidate[]>();
    lifecycle.transition(identity('session-a', 'client-a'), () => a.promise);
    a.resolve([candidate('session-a', 'A private takeaway')]);
    await settle();
    expect(state.status).toBe('ready');

    const b = deferred<MindOutcomeCandidate[]>();
    lifecycle.transition(next, () => b.promise);

    expect(clearPhi).toHaveBeenCalledTimes(2);
    expect(resetDeliveryIdentity).toHaveBeenCalledTimes(2);
    expect(state).toMatchObject({ status: 'loading' });
    expect(lifecycle.canSubmit()).toBe(false);
    expect(() => lifecycle.assertCanSubmit()).toThrow('Sharing options are not ready.');
  });

  it('ignores stale A success and error while failed, invalid, or empty B stays cleared', async () => {
    let state: MindShareLoadState = { status: 'closed', requestIdentity: null };
    const applyState = vi.fn((value: MindShareLoadState) => {
      state = value;
    });
    const lifecycle = createMindShareRequestLifecycle({
      clearPhi: vi.fn(),
      resetDeliveryIdentity: vi.fn(),
      applyState,
    });

    const staleSuccess = deferred<MindOutcomeCandidate[]>();
    lifecycle.transition(identity('session-a', 'client-a'), () => staleSuccess.promise);
    const failedB = deferred<MindOutcomeCandidate[]>();
    lifecycle.transition(identity('session-b', 'client-b'), () => failedB.promise);
    staleSuccess.resolve([candidate('session-a', 'A private takeaway')]);
    failedB.reject(new Error('B failed'));
    await settle();
    expect(state.status).toBe('error');
    expect(lifecycle.canSubmit()).toBe(false);

    const staleError = deferred<MindOutcomeCandidate[]>();
    lifecycle.transition(identity('session-a', 'client-a'), () => staleError.promise);
    lifecycle.transition(identity('session-b', 'client-b'), async () => []);
    staleError.reject(new Error('stale A error'));
    await settle();
    expect(state.status).toBe('empty');

    lifecycle.transition(identity('session-b', 'client-b'), async () => null as never);
    await settle();
    expect(state.status).toBe('invalid');
    expect(applyState).not.toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: expect.arrayContaining([
          expect.objectContaining({ patientTakeaway: 'A private takeaway' }),
        ]),
      }),
    );
  });

  it('fails closed until valid B candidates resolve and resets close/reopen identity', async () => {
    let state: MindShareLoadState = { status: 'closed', requestIdentity: null };
    const resetDeliveryIdentity = vi.fn();
    const lifecycle = createMindShareRequestLifecycle({
      clearPhi: vi.fn(),
      resetDeliveryIdentity,
      applyState: (value) => {
        state = value;
      },
    });
    const b = deferred<MindOutcomeCandidate[]>();

    lifecycle.transition(identity('session-b', 'client-b'), () => b.promise);
    expect(lifecycle.canSubmit()).toBe(false);
    b.resolve([candidate('session-b', 'B safe takeaway')]);
    await settle();
    expect(state.status).toBe('ready');
    expect(lifecycle.canSubmit()).toBe(true);
    expect(lifecycle.assertCanSubmit()).toEqual(
      expect.objectContaining({
        candidates: [expect.objectContaining({ patientTakeaway: 'B safe takeaway' })],
      }),
    );

    lifecycle.transition(null, null);
    expect(state).toEqual({ status: 'closed', requestIdentity: null });
    expect(lifecycle.canSubmit()).toBe(false);

    const reopened = deferred<MindOutcomeCandidate[]>();
    lifecycle.transition(identity('session-b', 'client-b'), () => reopened.promise);
    expect(state.status).toBe('loading');
    expect(lifecycle.canSubmit()).toBe(false);
    expect(resetDeliveryIdentity).toHaveBeenCalledTimes(3);
  });

  it('binds ShareModal rendering, fetch, submit, and delivery identity to the lifecycle', () => {
    const source = readFileSync(
      join(import.meta.dirname, '../components/app/ShareModal.tsx'),
      'utf8',
    );

    expect(source).toContain('createMindShareRequestLifecycle');
    expect(source).toContain('signal,');
    expect(source).toContain('mindShareLifecycle.canSubmit(currentMindRequestIdentity)');
    expect(source).toContain("const visibleTakeaway = mindCandidatesReady ? takeaway : '';");
    expect(source).toContain('const visiblePreview = mindCandidatesReady ? preview : null;');
    expect(source).toContain('const visibleResults = mindCandidatesReady ? results : null;');
    expect(source).toContain(
      "const visibleTherapistMessage = mindCandidatesReady ? therapistMessage : '';",
    );
    expect(source).toMatch(
      /setResolvedCandidates\(null\)[\s\S]*setTakeaway\(''\)[\s\S]*setPersistedTakeaway\(''\)[\s\S]*setOutcomeIndex\(0\)[\s\S]*setPreview\(null\)/,
    );
    expect(source).toContain('deliveryIdempotencyKeyRef.current = null');
    expect(source).toContain('disabled={busy || !mindCandidatesReady}');
    expect(source).toContain('aria-pressed={index === outcomeIndex}');
    expect(source).toContain(
      'Edits replace the saved patient-facing takeaway and are recorded as an audited update.',
    );
  });
});
