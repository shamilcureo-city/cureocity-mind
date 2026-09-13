import { createHash } from 'node:crypto';
import {
  SessionUsageAckSchema,
  SessionUsageRegistrationSchema,
  SessionUsageReceiptSchema,
  canonicalSessionUsagePayload,
  type SessionUsageReceipt,
  type SessionUsageRegistration,
} from '@cureocity/contracts';
import {
  Pass2BackendError,
  ReasoningBackendError,
  TherapyReasoningBackendError,
  type GeminiCallLogData,
} from '@cureocity/llm';
import type { LiveBackends } from './llm';

type CoverageReason = SessionUsageReceipt['coverageReasons'][number];
type Category = 'pass1' | 'pass2' | 'reasoning';
export interface UsageLifecycle {
  terminate(state: 'FINAL_REPORTED' | 'INCOMPLETE', reason?: CoverageReason): void;
}

interface ReporterOptions {
  registration: SessionUsageRegistration;
  authorityUrl: string;
  serviceSecret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryDelaysMs?: number[];
  now?: () => number;
  onIdle?: () => void;
}

/** No callback URL may come from a browser or token. Reuse only the trusted
 * authority origin; never forward the shared secret across a redirect. */
export function sessionUsageUrl(
  authorityUrl: string,
  production = process.env['NODE_ENV'] === 'production',
): string {
  const url = new URL(authorityUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.replace(/\/$/, '') !== '/api/v1/internal/live-authority' ||
    (url.protocol !== 'https:' && (production || url.protocol !== 'http:' || !local))
  )
    throw new Error(
      'Usage reporting requires a trusted HTTPS authority origin (loopback HTTP only in development)',
    );
  return new URL('/api/v1/internal/session-usage', url.origin).toString();
}

/** One actual socket, one registered receipt stream. Only bounded aggregate
 * metadata is retained here: never input, output, audio, or provider errors.
 * A pending packet is immutable across retries; subsequent calls coalesce into
 * one latest cumulative snapshot. A process crash still leaves an open record. */
export class LiveUsageReporter implements UsageLifecycle {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly reasons = new Set<CoverageReason>();
  private readonly models = new Set<string>();
  private readonly regions = new Set<string>();
  private readonly promptVersions = new Set<string>();
  private readonly counts = {
    inputTokens: 0,
    outputTokens: 0,
    pass1Calls: 0,
    pass2Calls: 0,
    reasoningCalls: 0,
    unknownCalls: 0,
  };
  private readonly units = { transcriptionInr: 0, notesInr: 0, reasoningInr: 0 };
  private activeCalls = 0;
  private registered = false;
  private ending: 'FINAL_REPORTED' | 'INCOMPLETE' | null = null;
  private endedAt: string | null = null;
  private revision = 0;
  private sentRevision = 0;
  private sequence = 0;
  private worker: Promise<void> | null = null;

  constructor(private readonly options: ReporterOptions) {
    // Normalize identity/timestamps before hashing. Database UUID and timestamp
    // round-trips must agree with the exact bytes retried by this producer.
    this.options = {
      ...options,
      registration: SessionUsageRegistrationSchema.parse(options.registration),
    };
    this.endpoint = sessionUsageUrl(options.authorityUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    if (options.registration.backend === 'vertex') this.reasons.add('UNREPORTED_PROVIDER_ATTEMPTS');
  }

  async register(): Promise<boolean> {
    this.registered = await this.deliver(this.options.registration);
    return this.registered;
  }

  /** Wrap call boundaries, not clinical-output events. Rejected output and
   * late settlement after socket loss are still recorded exactly once. */
  wrapBackends(backends: LiveBackends): LiveBackends {
    const wrap = <Input, Result extends { callLog: GeminiCallLogData }>(
      backend: { run(input: Input): Promise<Result> },
      category: Category,
    ): { run(input: Input): Promise<Result> } => ({
      run: async (input: Input): Promise<Result> => {
        if (!this.registered || this.ending)
          throw new Error('Live usage connection is not accepting new work');
        this.activeCalls++;
        try {
          const result = await backend.run(input);
          this.record(category, result.callLog);
          return result;
        } catch (error) {
          const callLog =
            error instanceof Pass2BackendError ||
            error instanceof ReasoningBackendError ||
            error instanceof TherapyReasoningBackendError
              ? error.callLog
              : null;
          this.record(category, callLog);
          throw error;
        } finally {
          this.activeCalls--;
          this.changed();
        }
      },
    });
    return {
      backend: backends.backend,
      pass1: wrap(backends.pass1, 'pass1'),
      pass2: wrap(backends.pass2, 'pass2'),
      ...(backends.pass2Final ? { pass2Final: wrap(backends.pass2Final, 'pass2') } : {}),
      reasoning: wrap(backends.reasoning, 'reasoning'),
      therapyReasoning: wrap(backends.therapyReasoning, 'reasoning'),
    };
  }

  terminate(state: 'FINAL_REPORTED' | 'INCOMPLETE', reason?: CoverageReason): void {
    // Closing the browser after a successfully finished/settled connection
    // cannot retroactively turn its acknowledged usage into an interruption.
    if (this.ending === 'FINAL_REPORTED' && this.activeCalls === 0) return;
    if (reason) this.reasons.add(reason);
    if (!this.ending || state === 'INCOMPLETE') this.ending = state;
    this.endedAt ??= new Date(this.now()).toISOString();
    this.changed();
  }

  get settled(): boolean {
    return this.ending !== null && this.activeCalls === 0 && this.worker === null;
  }

  /** Drain only already-started delivery, not provider work. Caller retains the
   * process shutdown deadline; an unfinished provider tail remains incomplete. */
  async flush(): Promise<void> {
    while (this.worker) await this.worker;
  }

  private record(category: Category, log: GeminiCallLogData | null): void {
    this.counts[
      category === 'pass1' ? 'pass1Calls' : category === 'pass2' ? 'pass2Calls' : 'reasoningCalls'
    ]++;
    if (
      !log ||
      ![log.inputTokens, log.outputTokens, log.costInr].every((n) => Number.isFinite(n) && n >= 0)
    ) {
      this.counts.unknownCalls++;
      this.reasons.add('MISSING_CALL_USAGE');
      return;
    }
    this.counts.inputTokens += Math.round(log.inputTokens);
    this.counts.outputTokens += Math.round(log.outputTokens);
    this.units[
      category === 'pass1' ? 'transcriptionInr' : category === 'pass2' ? 'notesInr' : 'reasoningInr'
    ] += Math.round(log.costInr * 10_000);
    this.addProvenance(this.models, log.model, 16);
    this.addProvenance(this.regions, log.region, 16);
    this.addProvenance(this.promptVersions, log.promptVersion, 32);
    if (
      this.options.registration.backend === 'vertex' &&
      !/^gemini-2\.5-(?:flash(?:-lite)?|pro)(?:-|$)/.test(log.model)
    )
      this.reasons.add('UNPRICED_USAGE');
  }

  private addProvenance(target: Set<string>, value: string, limit: number): void {
    if (!/^[a-zA-Z0-9._:/-]{1,128}$/.test(value) || (target.size >= limit && !target.has(value))) {
      this.reasons.add('PROVENANCE_TRUNCATED');
      return;
    }
    target.add(value);
  }

  private changed(): void {
    this.revision++;
    if (!this.registered || this.worker) return;
    const run = this.runQueue();
    this.worker = run;
    void run.finally(() => {
      if (this.worker === run) this.worker = null;
      if (this.sentRevision < this.revision) this.changed();
      else this.options.onIdle?.();
    });
  }

  private async runQueue(): Promise<void> {
    while (this.sentRevision < this.revision) {
      const revision = this.revision;
      const packet = this.snapshot(++this.sequence);
      if (packet) await this.deliver(packet);
      // A exhausted bounded retry remains unacknowledged at the server. A new
      // call may later report its cumulative total, but never spin indefinitely.
      this.sentRevision = revision;
    }
  }

  private snapshot(sequence: number): SessionUsageReceipt | null {
    const state =
      this.ending === 'FINAL_REPORTED' && this.activeCalls > 0 ? 'OPEN' : (this.ending ?? 'OPEN');
    const { registration } = this.options;
    const result = SessionUsageReceiptSchema.safeParse({
      version: 1,
      domain: registration.domain,
      type: 'RECEIPT',
      connectionId: registration.connectionId,
      sessionId: registration.sessionId,
      psychologistId: registration.psychologistId,
      vertical: registration.vertical,
      sequence,
      state,
      endedAt: state === 'OPEN' ? null : this.endedAt,
      totals: {
        ...this.counts,
        ...Object.fromEntries(Object.entries(this.units).map(([k, n]) => [k, decimal(n)])),
        costInr: decimal(
          this.units.transcriptionInr + this.units.notesInr + this.units.reasoningInr,
        ),
      },
      usageBasis: registration.backend === 'mock' ? 'MOCK_ZERO' : 'LOCAL_ESTIMATE',
      coverageReasons: [...this.reasons].sort(),
      provenance: {
        models: [...this.models].sort(),
        regions: [...this.regions].sort(),
        promptVersions: [...this.promptVersions].sort(),
        pricingVersion: null,
        configurationVersion: 'LIVE_USAGE_V1',
      },
    });
    // Contract overflow is missing evidence, never truncate a monetary total
    // or leak a rejected payload through logs.
    return result.success ? result.data : null;
  }

  private async deliver(packet: SessionUsageRegistration | SessionUsageReceipt): Promise<boolean> {
    const serialized = canonicalSessionUsagePayload(packet);
    const hash = createHash('sha256').update(serialized).digest('hex');
    const delays = this.options.retryDelaysMs ?? [250, 750];
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (attempt) await new Promise<void>((resolve) => setTimeout(resolve, delays[attempt - 1]));
      try {
        const response = await this.fetchImpl(this.endpoint, {
          method: 'POST',
          redirect: 'error',
          headers: {
            authorization: `Bearer ${this.options.serviceSecret}`,
            'content-type': 'application/json',
          },
          body: serialized,
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 2_000),
        });
        if (!response.ok) {
          if (response.status >= 400 && response.status < 500 && response.status !== 429)
            return false;
          continue;
        }
        const result = SessionUsageAckSchema.safeParse(await response.json());
        if (!result.success) continue;
        const ack = result.data;
        if (ack.connectionId !== packet.connectionId || ack.sessionId !== packet.sessionId)
          continue;
        if (packet.type === 'REGISTER') {
          if (
            ack.status === 'REGISTERED' &&
            ack.acceptedSequence === 0 &&
            (ack.payloadHash === null || ack.payloadHash === hash)
          )
            return true;
        } else if (
          (ack.status === 'ACCEPTED' || ack.status === 'DUPLICATE') &&
          ack.acceptedSequence === packet.sequence &&
          ack.latestSequence >= packet.sequence &&
          ack.payloadHash === hash
        )
          return true;
      } catch {
        /* Network/parse errors carry no safe usage evidence to log. */
      }
    }
    return false;
  }
}

function decimal(units: number): string {
  return `${Math.floor(units / 10_000)}.${String(units % 10_000).padStart(4, '0')}`;
}
