import {
  PractitionerCapabilitySchema,
  type LiveGatewayEvent,
  type PractitionerCapability,
} from '@cureocity/contracts';

export type LiveAuthorityCloseReason =
  | 'live_authority_denied'
  | 'live_authority_unavailable'
  | 'live_token_expired';

interface LiveAuthorityOptions {
  sessionId: string;
  psychologistId: string;
  tokenExpiresAtSec: number;
  requiredCapabilities: ReadonlySet<PractitionerCapability>;
  verifierUrl: string;
  serviceSecret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  intervalMs?: number;
  close: (reason: LiveAuthorityCloseReason) => void;
  updateCapabilities: (capabilities: ReadonlySet<PractitionerCapability>) => void;
}

const OPTIONAL_EVENT_CAPABILITY: Partial<Record<LiveGatewayEvent['type'], PractitionerCapability>> =
  {
    finding: 'CLINICAL_ANALYSIS',
    reasoning: 'CLINICAL_ANALYSIS',
    therapyReasoning: 'CLINICAL_ANALYSIS',
    gap: 'CLINICAL_ANALYSIS',
    rxDraft: 'PRESCRIPTION_DRAFTING',
    command: 'CLINICAL_ANALYSIS',
  };

/**
 * Revalidates a live socket against the web app's current server-side authority.
 * No patient data, transcript, note, or token is sent to the verifier.
 */
export class LiveAuthority {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly intervalMs: number;
  private capabilities = new Set<PractitionerCapability>();
  private interval: NodeJS.Timeout | null = null;
  private expiry: NodeJS.Timeout | null = null;
  private inFlight: Promise<boolean> | null = null;
  private closed = false;

  constructor(private readonly options: LiveAuthorityOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 2_000;
    this.intervalMs = options.intervalMs ?? 5_000;
  }

  start(): void {
    const untilExpiryMs = this.options.tokenExpiresAtSec * 1_000 - Date.now();
    if (untilExpiryMs <= 0) {
      this.deny('live_token_expired');
      return;
    }
    this.expiry = setTimeout(() => this.deny('live_token_expired'), untilExpiryMs);
    this.interval = setInterval(() => void this.revalidate(), this.intervalMs);
  }

  dispose(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.expiry) clearTimeout(this.expiry);
    this.interval = null;
    this.expiry = null;
  }

  /** Recheck immediately before every regulated gateway output. */
  async authorizeEvent(event: LiveGatewayEvent): Promise<LiveGatewayEvent | null> {
    if (this.closed) return null;
    if (this.options.tokenExpiresAtSec * 1_000 <= Date.now()) {
      this.deny('live_token_expired');
      return null;
    }
    if (!(await this.revalidate())) return null;

    const required = OPTIONAL_EVENT_CAPABILITY[event.type];
    if (required && !this.capabilities.has(required)) return null;
    if (event.type === 'final') {
      return {
        ...event,
        medications: this.capabilities.has('PRESCRIPTION_DRAFTING') ? event.medications : [],
        orders: this.capabilities.has('CLINICAL_ORDERS') ? event.orders : [],
        ...(this.capabilities.has('PRESCRIPTION_DRAFTING') ? {} : { rxPad: undefined }),
      };
    }
    return event;
  }

  async revalidate(): Promise<boolean> {
    if (this.closed) return false;
    if (this.inFlight) return this.inFlight;
    const check = this.performRevalidation();
    this.inFlight = check;
    try {
      return await check;
    } finally {
      if (this.inFlight === check) this.inFlight = null;
    }
  }

  private async performRevalidation(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(this.options.verifierUrl, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${this.options.serviceSecret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: this.options.sessionId,
          psychologistId: this.options.psychologistId,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        this.deny('live_authority_denied');
        return false;
      }
      const body = (await response.json()) as { authorized?: unknown; capabilities?: unknown };
      if (body.authorized !== true || !Array.isArray(body.capabilities)) {
        this.deny('live_authority_denied');
        return false;
      }
      const parsed = body.capabilities.map((capability) =>
        PractitionerCapabilitySchema.safeParse(capability),
      );
      if (parsed.some((capability) => !capability.success)) {
        this.deny('live_authority_denied');
        return false;
      }
      const capabilities = new Set(
        parsed.flatMap((capability) => (capability.success ? [capability.data] : [])),
      );
      if ([...this.options.requiredCapabilities].some((required) => !capabilities.has(required))) {
        this.deny('live_authority_denied');
        return false;
      }
      // Expiry or another mandatory denial may have fired while the verifier
      // request was in flight. Never publish that now-stale successful result.
      if (this.closed) return false;
      if (this.options.tokenExpiresAtSec * 1_000 <= Date.now()) {
        this.deny('live_token_expired');
        return false;
      }
      this.capabilities = capabilities;
      this.options.updateCapabilities(capabilities);
      return true;
    } catch {
      this.deny('live_authority_unavailable');
      return false;
    }
  }

  private deny(reason: LiveAuthorityCloseReason): void {
    if (this.closed) return;
    this.closed = true;
    this.dispose();
    this.options.close(reason);
  }
}
