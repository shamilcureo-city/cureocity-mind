import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { MindInstrumentDraftInput, MindInstrumentDraftState } from '@cureocity/contracts';
import { MindInstrumentDraftController } from './mind-instrument-draft-client';

function server() {
  let saved: MindInstrumentDraftState = {
    instrumentKey: 'PHQ9',
    language: 'en',
    revision: 0,
    status: 'ACTIVE',
    responses: {},
    updatedAt: null,
    submittedResponseId: null,
    riskFlagged: false,
  };
  let lastMutation: string | null = null;
  let loseNext: 'SAVE' | 'SUBMIT' | 'DISCARD' | null = null;
  let failing = false;
  let scores = 0;
  let hold: (() => Promise<void>) | null = null;
  const requests: MindInstrumentDraftInput[] = [];
  const transport = vi.fn(async (_url: string, init?: RequestInit) => {
    if (failing) throw new Error('Offline');
    if (init?.method !== 'POST') return Response.json(saved);
    const input = JSON.parse(String(init.body)) as MindInstrumentDraftInput;
    requests.push(input);
    if (input.mutationId !== lastMutation) {
      if (input.expectedRevision !== saved.revision)
        return Response.json({ error: 'Changed in another tab' }, { status: 409 });
      if (input.operation === 'SUBMIT') scores += 1;
      saved = {
        ...saved,
        revision: saved.revision + 1,
        status:
          input.operation === 'SAVE'
            ? 'ACTIVE'
            : input.operation === 'SUBMIT'
              ? 'SUBMITTED'
              : 'DISCARDED',
        responses: input.operation === 'SAVE' ? input.responses! : {},
        updatedAt: '2026-09-10T00:00:00.000Z',
        submittedResponseId: input.operation === 'SUBMIT' ? `scored-${scores}` : null,
        riskFlagged: input.operation === 'SUBMIT',
      };
      lastMutation = input.mutationId;
    }
    if (hold) {
      const wait = hold;
      hold = null;
      await wait();
    }
    if (loseNext === input.operation) {
      loseNext = null;
      throw new Error('Reply lost');
    }
    return Response.json(saved);
  });
  let sequence = 0;
  const controller = new MindInstrumentDraftController(
    'fictional-client',
    transport,
    vi.fn(),
    () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  );
  return {
    controller,
    requests,
    transport,
    state: () => saved,
    scoreCount: () => scores,
    lose: (operation: typeof loseNext) => {
      loseNext = operation;
    },
    offline: (value: boolean) => {
      failing = value;
    },
    external: (value: Partial<MindInstrumentDraftState>) => {
      saved = { ...saved, ...value };
    },
    pause: () => {
      let release: () => void = () => undefined;
      hold = () =>
        new Promise<void>((resolve) => {
          release = resolve;
        });
      return () => release();
    },
  };
}

describe('questionnaire recovery client', () => {
  it('recovers an encrypted-server draft into memory after reload', async () => {
    const test = server();
    test.external({ revision: 3, responses: { phq9_2: 2 }, updatedAt: '2026-09-10T00:00:00.000Z' });
    await test.controller.load('PHQ9');
    expect(test.controller.entry('PHQ9').answers).toEqual({ phq9_2: 2 });
    expect(test.requests).toHaveLength(0);
    expect(test.controller.hasUnsaved()).toBe(false);
  });

  it('serializes rapid clicks and saves later answers after the first acknowledgement', async () => {
    const test = server();
    await test.controller.load('PHQ9');
    const release = test.pause();
    test.controller.answer('PHQ9', 'phq9_1', 1);
    test.controller.answer('PHQ9', 'phq9_2', 2);
    expect(test.requests).toHaveLength(1);
    expect(test.controller.hasUnsaved()).toBe(true);
    release();
    await test.controller.flush('PHQ9');
    expect(test.requests.map((request) => request.expectedRevision)).toEqual([0, 1]);
    expect(test.state().responses).toEqual({ phq9_1: 1, phq9_2: 2 });
    expect(test.controller.hasUnsaved()).toBe(false);
  });

  it('retains answers on lost save reply and retries the identical receipt', async () => {
    const test = server();
    await test.controller.load('PHQ9');
    test.lose('SAVE');
    test.controller.answer('PHQ9', 'phq9_1', 2);
    await expect(test.controller.flush('PHQ9')).rejects.toThrow('Reply lost');
    expect(test.controller.entry('PHQ9').answers).toEqual({ phq9_1: 2 });
    expect(test.controller.hasUnsaved()).toBe(true);
    await test.controller.flush('PHQ9');
    expect(test.requests[1]).toEqual(test.requests[0]);
    expect(test.state().revision).toBe(1);
    expect(test.controller.hasUnsaved()).toBe(false);
  });

  it('retains both a failed request and newer answers; retry saves them in order', async () => {
    const test = server();
    await test.controller.load('PHQ9');
    test.lose('SAVE');
    test.controller.answer('PHQ9', 'phq9_1', 1);
    await expect(test.controller.flush('PHQ9')).rejects.toThrow('Reply lost');
    test.controller.answer('PHQ9', 'phq9_1', 3);
    await test.controller.flush('PHQ9');
    expect(test.requests[1]).toEqual(test.requests[0]);
    expect(test.requests[2]!.responses).toEqual({ phq9_1: 3 });
    expect(test.state().responses).toEqual({ phq9_1: 3 });
  });

  it('never silently overwrites a newer server revision after a conflict', async () => {
    const test = server();
    await test.controller.load('PHQ9');
    test.external({ revision: 1, responses: { phq9_1: 3 } });
    test.controller.answer('PHQ9', 'phq9_1', 1);
    await expect(test.controller.flush('PHQ9')).rejects.toThrow('another tab');
    expect(test.state().responses).toEqual({ phq9_1: 3 });
    expect(test.controller.entry('PHQ9').answers).toEqual({ phq9_1: 1 });
    await test.controller.load('PHQ9');
    expect(test.controller.entry('PHQ9').answers).toEqual({ phq9_1: 1 });
    await test.controller.load('PHQ9', true);
    expect(test.controller.entry('PHQ9').answers).toEqual({ phq9_1: 3 });
  });

  it('failed explicit reload preserves unsaved local answers and the retry request', async () => {
    const test = server();
    await test.controller.load('PHQ9');
    test.offline(true);
    test.controller.answer('PHQ9', 'phq9_1', 1);
    await expect(test.controller.flush('PHQ9')).rejects.toThrow('Offline');
    await expect(test.controller.load('PHQ9', true)).rejects.toThrow('Offline');
    expect(test.controller.entry('PHQ9').answers).toEqual({ phq9_1: 1 });
    expect(test.controller.hasUnsaved()).toBe(true);
  });

  it('does not clear answers until a successful submission receipt', async () => {
    const test = server();
    await test.controller.load('PHQ9');
    test.controller.answer('PHQ9', 'phq9_1', 1);
    await test.controller.flush('PHQ9');
    test.lose('SUBMIT');
    await expect(test.controller.finish('PHQ9', 'SUBMIT')).rejects.toThrow('Reply lost');
    expect(test.controller.entry('PHQ9').answers).toEqual({ phq9_1: 1 });
    expect(test.controller.entry('PHQ9').completionPending).toBe(true);
    await expect(test.controller.finish('PHQ9', 'DISCARD')).rejects.toThrow(
      'Confirm the previous submission',
    );
    test.controller.answer('PHQ9', 'phq9_1', 3);
    expect(test.controller.entry('PHQ9').answers).toEqual({ phq9_1: 1 });
    const receipt = await test.controller.finish('PHQ9', 'SUBMIT');
    expect(receipt).toMatchObject({
      status: 'SUBMITTED',
      submittedResponseId: 'scored-1',
      riskFlagged: true,
    });
    expect(test.controller.entry('PHQ9').answers).toEqual({});
    expect(test.scoreCount()).toBe(1);
    expect(test.requests[2]).toEqual(test.requests[1]);
  });

  it('does not clear local answers when a submit acknowledgement omits its scored response ID', async () => {
    const test = server();
    await test.controller.load('PHQ9');
    test.controller.answer('PHQ9', 'phq9_1', 1);
    await test.controller.flush('PHQ9');
    test.transport.mockResolvedValueOnce(
      Response.json({
        ...test.state(),
        status: 'SUBMITTED',
        revision: 2,
        responses: {},
        submittedResponseId: null,
      }),
    );
    await expect(test.controller.finish('PHQ9', 'SUBMIT')).rejects.toThrow(
      'score receipt could not be verified',
    );
    expect(test.controller.entry('PHQ9').answers).toEqual({ phq9_1: 1 });
    expect(test.controller.hasUnsaved()).toBe(true);
  });

  it('can recover a successful submission through reload without restoring old answers', async () => {
    const test = server();
    test.external({
      revision: 4,
      status: 'SUBMITTED',
      responses: {},
      submittedResponseId: 'scored-1',
    });
    await test.controller.load('PHQ9');
    expect(test.controller.entry('PHQ9')).toMatchObject({
      answers: {},
      dirty: false,
      saved: { status: 'SUBMITTED', submittedResponseId: 'scored-1' },
    });
    expect(test.requests).toHaveLength(0);
  });

  it('only discards local answers after confirmed server tombstone', async () => {
    const test = server();
    await test.controller.load('PHQ9');
    test.controller.answer('PHQ9', 'phq9_1', 1);
    await test.controller.flush('PHQ9');
    test.lose('DISCARD');
    await expect(test.controller.finish('PHQ9', 'DISCARD')).rejects.toThrow('Reply lost');
    expect(test.controller.entry('PHQ9').answers).toEqual({ phq9_1: 1 });
    await test.controller.finish('PHQ9', 'DISCARD');
    expect(test.controller.entry('PHQ9').answers).toEqual({});
    expect(test.state().status).toBe('DISCARDED');
    expect(test.scoreCount()).toBe(0);
  });

  it('cannot edit another questionnaire before its own server snapshot is loaded', async () => {
    const test = server();
    await test.controller.load('PHQ9');
    test.controller.answer('GAD7', 'gad7_1', 1);
    expect(test.controller.entry('GAD7').answers).toEqual({});
    expect(test.requests).toHaveLength(0);
  });

  it('uses no plaintext browser storage for draft answers and preserves a close-page warning', () => {
    const client = readFileSync(
      new URL('./mind-instrument-draft-client.ts', import.meta.url),
      'utf8',
    );
    const hook = readFileSync(new URL('./use-mind-instrument-drafts.ts', import.meta.url), 'utf8');
    expect(client + hook).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    expect(hook).toContain('useUnsavedWorkGuard(');
    expect(hook).not.toContain("addEventListener('beforeunload'");
    expect(hook).toContain('controller.hasUnsaved()');
  });
});
