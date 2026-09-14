import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  canonicalSessionUsagePayload,
  type SessionUsageCommand,
  type SessionUsageRegistration,
  type SessionUsageReceipt,
} from '@cureocity/contracts';
import {
  MockGeminiPass1Backend,
  MockGeminiPass2Backend,
  MockGeminiReasoningBackend,
  MockGeminiTherapyReasoningBackend,
  Pass2BackendError,
  type GeminiCallLogData,
} from '@cureocity/llm';
import { LiveUsageReporter, sessionUsageUrl } from './usage-reporter';
import { LiveSession } from './live-session';
import type { LiveBackends } from './llm';

const registration: SessionUsageRegistration = {
  version: 1,
  domain: 'CUREOCITY_LIVE_USAGE_V1',
  type: 'REGISTER',
  connectionId: '10000000-0000-4000-8000-000000000001',
  sessionId: 'fictional-session',
  psychologistId: 'fictional-owner',
  vertical: 'THERAPIST',
  backend: 'vertex',
  startedAt: '2026-09-13T00:00:00.000Z',
};
const usage = (overrides: Partial<GeminiCallLogData> = {}): GeminiCallLogData => ({
  sessionId: registration.sessionId,
  pass: 'PASS_1_TRANSCRIBE_AND_ANALYSE',
  model: 'gemini-2.5-flash',
  region: 'asia-south1',
  promptVersion: 'test-v1',
  inputTokens: 100,
  outputTokens: 20,
  costInr: 0.0123,
  latencyMs: 1,
  status: 'SUCCESS',
  ...overrides,
});
const backends = (): LiveBackends => ({
  backend: 'vertex',
  pass1: new MockGeminiPass1Backend(),
  pass2: new MockGeminiPass2Backend(),
  reasoning: new MockGeminiReasoningBackend(),
  therapyReasoning: new MockGeminiTherapyReasoningBackend(),
});
const pass1Input = {
  sessionId: registration.sessionId,
  audioBytes: Buffer.alloc(0),
  durationMs: 1,
};
const pass2Input = {
  sessionId: registration.sessionId,
  transcript: 'fictional utterance',
  speakerSegments: [],
  kind: 'TREATMENT' as const,
  modality: null,
  clientContext: {},
};
function acknowledgement(packet: SessionUsageCommand, overrides: object = {}) {
  return new Response(
    JSON.stringify({
      version: 1,
      domain: registration.domain,
      connectionId: packet.connectionId,
      sessionId: packet.sessionId,
      acceptedSequence: packet.type === 'REGISTER' ? 0 : packet.sequence,
      latestSequence: packet.type === 'REGISTER' ? 0 : packet.sequence,
      status: packet.type === 'REGISTER' ? 'REGISTERED' : 'ACCEPTED',
      payloadHash:
        packet.type === 'REGISTER'
          ? null
          : createHash('sha256').update(canonicalSessionUsagePayload(packet)).digest('hex'),
      ...overrides,
    }),
  );
}
function harness(custom?: (packet: SessionUsageCommand, attempt: number) => Promise<Response>) {
  const packets: SessionUsageCommand[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
    const packet = JSON.parse(String(init?.body)) as SessionUsageCommand;
    packets.push(packet);
    return custom ? custom(packet, packets.length) : acknowledgement(packet);
  });
  const reporter = new LiveUsageReporter({
    registration,
    authorityUrl: 'https://fictional.example/api/v1/internal/live-authority',
    serviceSecret: 'fictional-secret',
    fetchImpl,
    retryDelaysMs: [0, 0],
  });
  return {
    reporter,
    fetchImpl,
    packets,
    receipts: () =>
      packets.filter((packet): packet is SessionUsageReceipt => packet.type === 'RECEIPT'),
  };
}
async function billable(fake: LiveBackends, reporter: LiveUsageReporter, log = usage()) {
  const original = fake.pass1.run.bind(fake.pass1);
  fake.pass1 = { run: async (input) => ({ ...(await original(input)), callLog: log }) };
  await reporter.wrapBackends(fake).pass1.run(pass1Input);
}

describe('per-socket durable usage reporter', () => {
  it('uses only the configured trusted origin and rejects credentials, redirects and unsafe HTTP origins', async () => {
    expect(sessionUsageUrl('https://web.example/api/v1/internal/live-authority')).toBe(
      'https://web.example/api/v1/internal/session-usage',
    );
    expect(
      sessionUsageUrl('http://127.0.0.1:3000/api/v1/internal/live-authority', false),
    ).toContain('127.0.0.1:3000');
    for (const unsafe of [
      'http://web.example/api/v1/internal/live-authority',
      'https://user:secret@web.example/api/v1/internal/live-authority',
      'https://web.example/api/v1/internal/live-authority?target=x',
      'https://web.example/untrusted',
    ])
      expect(() => sessionUsageUrl(unsafe, false)).toThrow();
    expect(() =>
      sessionUsageUrl('http://127.0.0.1:3000/api/v1/internal/live-authority', true),
    ).toThrow();
    const { reporter, fetchImpl } = harness();
    expect(await reporter.register()).toBe(true);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { authorization: 'Bearer fictional-secret' },
    });
  });

  it('cannot start a backend before a durable registration acknowledgement', async () => {
    const { reporter } = harness();
    const fake = backends();
    const spy = vi.spyOn(fake.pass1, 'run');
    await expect(reporter.wrapBackends(fake).pass1.run(pass1Input)).rejects.toThrow(
      'not accepting',
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('checks registration identity and keeps its packet stable across lost responses', async () => {
    const { reporter, packets } = harness(async (packet, attempt) =>
      attempt < 3
        ? acknowledgement(packet, { sessionId: 'wrong-session' })
        : acknowledgement(packet),
    );
    expect(await reporter.register()).toBe(true);
    expect(packets).toHaveLength(3);
    expect(packets[1]).toEqual(packets[0]);
    expect(packets[2]).toEqual(packets[0]);
  });

  it('normalizes UUIDs and dates before registration hashing and retry', async () => {
    const packets: SessionUsageCommand[] = [];
    const reporter = new LiveUsageReporter({
      registration: {
        ...registration,
        connectionId: 'ABCDEFAB-1234-4000-8000-ABCDEFABCDEF',
        startedAt: '2026-09-13T05:30:00+05:30',
      },
      authorityUrl: 'https://fictional.example/api/v1/internal/live-authority',
      serviceSecret: 'fictional',
      fetchImpl: async (_url, init) => {
        const packet = JSON.parse(String(init?.body)) as SessionUsageCommand;
        packets.push(packet);
        return acknowledgement(packet);
      },
    });
    expect(await reporter.register()).toBe(true);
    expect(packets[0]).toMatchObject({
      connectionId: 'abcdefab-1234-4000-8000-abcdefabcdef',
      startedAt: '2026-09-13T00:00:00.000Z',
    });
  });

  it('fails registration on service refusal without a retry loop', async () => {
    const { reporter, packets } = harness(async () => new Response('{}', { status: 403 }));
    expect(await reporter.register()).toBe(false);
    expect(packets).toHaveLength(1);
  });

  it('bounds network retries and never treats a response with the wrong hash as an acknowledgement', async () => {
    const { reporter, packets } = harness(async (packet) =>
      acknowledgement(packet, packet.type === 'RECEIPT' ? { payloadHash: '0'.repeat(64) } : {}),
    );
    await reporter.register();
    await billable(backends(), reporter);
    await reporter.flush();
    expect(packets).toHaveLength(4);
    expect(packets.slice(1)).toEqual([packets[1], packets[1], packets[1]]);
  });

  it('accounts rejected output exactly once without serializing clinical text or error payloads', async () => {
    const { reporter, receipts, packets } = harness();
    await reporter.register();
    const fake = backends();
    fake.pass2 = {
      run: async () => {
        throw new Pass2BackendError(
          'private rejected content',
          usage({
            costInr: 0.4321,
            status: 'ERROR',
            errorMessage: 'private error',
            pass: 'PASS_2_NOTE_GENERATION',
          }),
        );
      },
    };
    await expect(reporter.wrapBackends(fake).pass2.run(pass2Input)).rejects.toThrow();
    reporter.terminate('FINAL_REPORTED');
    await reporter.flush();
    expect(receipts().at(-1)).toMatchObject({
      state: 'FINAL_REPORTED',
      totals: { pass2Calls: 1, costInr: '0.4321', notesInr: '0.4321' },
      coverageReasons: ['UNREPORTED_PROVIDER_ATTEMPTS'],
    });
    expect(JSON.stringify(packets)).not.toContain('private');
    expect(JSON.stringify(packets)).not.toContain('fictional utterance');
  });

  it('reports an unlogged thrown backend result as missing usage rather than known free use', async () => {
    const { reporter, receipts } = harness();
    await reporter.register();
    const fake = backends();
    fake.pass1 = {
      run: async () => {
        throw new Error('private provider payload');
      },
    };
    await expect(reporter.wrapBackends(fake).pass1.run(pass1Input)).rejects.toThrow();
    reporter.terminate('FINAL_REPORTED');
    await reporter.flush();
    expect(receipts().at(-1)).toMatchObject({
      totals: { unknownCalls: 1, pass1Calls: 1, costInr: '0.0000' },
      coverageReasons: ['MISSING_CALL_USAGE', 'UNREPORTED_PROVIDER_ATTEMPTS'],
    });
  });

  it('coalesces cumulative updates behind one immutable packet and retains exact decimal sums', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { reporter, receipts } = harness(async (packet) => {
      if (packet.type === 'RECEIPT' && packet.sequence === 1) await held;
      return acknowledgement(packet);
    });
    await reporter.register();
    const wrapped = backends();
    const original = wrapped.pass1.run.bind(wrapped.pass1);
    wrapped.pass1 = {
      run: async (input) => ({ ...(await original(input)), callLog: usage({ costInr: 0.0001 }) }),
    };
    const observed = reporter.wrapBackends(wrapped);
    await observed.pass1.run(pass1Input);
    for (let i = 0; i < 20; i++) await observed.pass1.run(pass1Input);
    reporter.terminate('FINAL_REPORTED');
    expect(receipts()).toHaveLength(1);
    release();
    await reporter.flush();
    expect(receipts()).toHaveLength(2);
    expect(receipts().at(-1)).toMatchObject({
      sequence: 2,
      state: 'FINAL_REPORTED',
      totals: { costInr: '0.0021', pass1Calls: 21 },
    });
  });

  it('waits for all started calls before final, and keeps disconnect coverage incomplete after late settlement', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { reporter, receipts } = harness();
    await reporter.register();
    const fake = backends();
    const original = fake.pass1.run.bind(fake.pass1);
    fake.pass1 = {
      run: async (input) => {
        await held;
        return { ...(await original(input)), callLog: usage() };
      },
    };
    const call = reporter.wrapBackends(fake).pass1.run(pass1Input);
    reporter.terminate('FINAL_REPORTED');
    await reporter.flush();
    expect(receipts().at(-1)?.state).toBe('OPEN');
    reporter.terminate('INCOMPLETE', 'INTERRUPTED');
    release();
    await call;
    await reporter.flush();
    expect(receipts().at(-1)).toMatchObject({
      state: 'INCOMPLETE',
      totals: { costInr: '0.0123', pass1Calls: 1 },
      coverageReasons: ['INTERRUPTED', 'UNREPORTED_PROVIDER_ATTEMPTS'],
    });
  });

  it('does not downgrade a normal finalized connection when its socket closes afterward', async () => {
    const { reporter, receipts } = harness();
    await reporter.register();
    reporter.terminate('FINAL_REPORTED');
    reporter.terminate('INCOMPLETE', 'INTERRUPTED');
    await reporter.flush();
    expect(receipts()).toHaveLength(1);
    expect(receipts()[0].state).toBe('FINAL_REPORTED');
  });

  it('bounds provenance and visibly marks unknown model pricing', async () => {
    const { reporter, receipts } = harness();
    await reporter.register();
    for (let i = 0; i < 20; i++)
      await billable(
        backends(),
        reporter,
        usage({ model: `unpriced-model-${i}`, promptVersion: 'Unsafe private text\n' }),
      );
    reporter.terminate('FINAL_REPORTED');
    await reporter.flush();
    const receipt = receipts().at(-1)!;
    expect(receipt.provenance.models).toHaveLength(16);
    expect(receipt.provenance.promptVersions).toEqual([]);
    expect(receipt.coverageReasons).toEqual([
      'PROVENANCE_TRUNCATED',
      'UNPRICED_USAGE',
      'UNREPORTED_PROVIDER_ATTEMPTS',
    ]);
  });

  it('normal LiveSession termination seals a final receipt, disposal remains idempotent', async () => {
    const { reporter, receipts } = harness();
    await reporter.register();
    const session = new LiveSession(
      registration.sessionId,
      null,
      reporter.wrapBackends(backends()),
      () => {},
      undefined,
      undefined,
      undefined,
      'THERAPIST',
      'TREATMENT',
      null,
      null,
      undefined,
      reporter,
    );
    await session.finalize();
    session.dispose();
    await reporter.flush();
    expect(receipts().at(-1)?.state).toBe('FINAL_REPORTED');
  });

  it('keeps a timed-out final note incomplete when the already-started provider call settles later', async () => {
    vi.useFakeTimers();
    vi.stubEnv('LIVE_FINALIZE_BUDGET_MS', '5000');
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { reporter, receipts } = harness();
    let session: LiveSession | null = null;
    try {
      await reporter.register();
      const fake = backends();
      const original = fake.pass2.run.bind(fake.pass2);
      const note = vi.fn(async (input: Parameters<typeof original>[0]) => {
        await held;
        return {
          ...(await original(input)),
          callLog: usage({ pass: 'PASS_2_NOTE_GENERATION', costInr: 0.5 }),
        };
      });
      fake.pass2 = { run: note };
      session = new LiveSession(
        registration.sessionId,
        null,
        reporter.wrapBackends(fake),
        () => {},
        undefined,
        undefined,
        undefined,
        'THERAPIST',
        'TREATMENT',
        null,
        null,
        undefined,
        reporter,
      );
      session.seedResume([
        { id: 'u1', text: 'Fictional source', speaker: 'patient', tStartMs: 0, tEndMs: 1000 },
      ]);
      const ending = session.finalize();
      await vi.advanceTimersByTimeAsync(1);
      expect(note).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(5000);
      await ending;
      await reporter.flush();
      expect(receipts().at(-1)).toMatchObject({
        state: 'INCOMPLETE',
        coverageReasons: ['FINALIZATION_TIMEOUT', 'UNREPORTED_PROVIDER_ATTEMPTS'],
      });
      release();
      await vi.advanceTimersByTimeAsync(1);
      await reporter.flush();
      expect(receipts().at(-1)).toMatchObject({
        state: 'INCOMPLETE',
        totals: { pass2Calls: 1, costInr: '0.5000' },
      });
      expect(receipts().some((receipt) => receipt.state === 'FINAL_REPORTED')).toBe(false);
    } finally {
      release();
      session?.dispose();
      await reporter.flush();
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  it('marks paused shutdown incomplete without starting new provider work', async () => {
    const { reporter, receipts } = harness();
    await reporter.register();
    const fake = backends();
    const pass1 = vi.spyOn(fake.pass1, 'run');
    const note = vi.spyOn(fake.pass2, 'run');
    const session = new LiveSession(
      registration.sessionId,
      null,
      reporter.wrapBackends(fake),
      () => {},
      undefined,
      undefined,
      undefined,
      'THERAPIST',
      'TREATMENT',
      null,
      null,
      undefined,
      reporter,
    );
    await session.pause('10000000-0000-4000-8000-000000000009');
    await session.finalizeForShutdown();
    await reporter.flush();
    expect(receipts().at(-1)).toMatchObject({
      state: 'INCOMPLETE',
      coverageReasons: ['PROCESS_SHUTDOWN', 'UNREPORTED_PROVIDER_ATTEMPTS'],
    });
    expect(pass1).not.toHaveBeenCalled();
    expect(note).not.toHaveBeenCalled();
    session.dispose();
    await reporter.flush();
  });
});
