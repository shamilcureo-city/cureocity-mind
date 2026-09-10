import {
  PractitionerCapabilitySchema,
  type LiveGatewayEvent,
  type PractitionerCapability,
} from '@cureocity/contracts';
import { extractVerifiedClaims } from './auth';

export type LiveAuthorityCloseReason = 'live_authority_denied' | 'live_authority_unavailable';

interface LiveAuthorityOptions {
  sessionId: string;
  psychologistId: string;
  tokenExpiresAt: number;
  vertical: 'THERAPIST' | 'DOCTOR';
  requiredCapabilities: ReadonlySet<PractitionerCapability>;
  verifierUrl: string;
  serviceSecret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
  close: (reason: LiveAuthorityCloseReason) => void;
  updateCapabilities: (capabilities: ReadonlySet<PractitionerCapability>) => void;
}

function optionalEventCapability(event: LiveGatewayEvent): PractitionerCapability | undefined {
  switch (event.type) {
    case 'finding':
    case 'reasoning':
    case 'therapyReasoning':
    case 'therapyContextReviewed':
      return 'CLINICAL_ANALYSIS';
    case 'rxDraft':
      return 'PRESCRIPTION_DRAFTING';
    case 'command':
      switch (event.command.kind) {
        case 'ADD_MEDICATION':
          return 'PRESCRIPTION_DRAFTING';
        case 'ORDER_TEST':
          return 'CLINICAL_ORDERS';
        case 'SHOW_DATA':
          return 'CHRONIC_CARE';
        case 'NEXT_PATIENT':
          return 'LIVE_ENCOUNTER';
      }
      return undefined;
    case 'gap':
      return event.gap.kind === 'DRUG_INTERACTION' ? 'PRESCRIPTION_DRAFTING' : 'CLINICAL_ANALYSIS';
    default:
      return undefined;
  }
}

/**
 * Revalidates a live socket against the web app's current server-side authority.
 * No patient data, transcript, note, or token is sent to the verifier.
 */
export class LiveAuthority {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private capabilities = new Set<PractitionerCapability>();
  private interval: NodeJS.Timeout | null = null;
  private expiryTimer: NodeJS.Timeout | null = null;
  private inFlight: Promise<boolean> | null = null;
  private renewal: Promise<number | null> | null = null;
  private tokenExpiresAt: number;
  private renewalAllowed = true;
  private started = false;
  private closed = false;

  constructor(private readonly options: LiveAuthorityOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 2_000;
    this.intervalMs = options.intervalMs ?? 5_000;
    this.now = options.now ?? Date.now;
    this.tokenExpiresAt = options.tokenExpiresAt;
  }

  start(): void {
    if (!this.authorizeInput() || this.started) return;
    this.started = true;
    this.interval = setInterval(() => void this.revalidate(), this.intervalMs);
    this.armExpiry();
  }

  private armExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    const expiresAt = this.tokenExpiresAt;
    this.expiryTimer = setTimeout(
      () => {
        if (this.tokenExpiresAt === expiresAt) this.deny('live_authority_denied');
      },
      Math.max(0, expiresAt * 1_000 - this.now()),
    );
  }

  dispose(): void {
    this.closed = true;
    this.renewalAllowed = false;
    if (this.interval) clearInterval(this.interval);
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.interval = null;
    this.expiryTimer = null;
  }

  /** Stop/drain may finish already-authorized work, but cannot extend its lease. */
  preventRenewal(): void {
    this.renewalAllowed = false;
  }

  /** Renew only authorization: never recreate the session or resume capture. */
  async renewToken(token: string): Promise<number | null> {
    if (!this.authorizeInput() || !this.renewalAllowed) return null;
    const claims = extractVerifiedClaims(token, this.options.sessionId, this.options.serviceSecret);
    if (
      !claims ||
      claims.psychologistId !== this.options.psychologistId ||
      claims.vertical !== this.options.vertical ||
      claims.exp <= this.tokenExpiresAt ||
      this.renewal
    ) {
      this.deny('live_authority_denied');
      return null;
    }

    // Let the old request finish before starting a new verifier snapshot. New
    // input/output checks wait behind this renewal, so an older denial or grant
    // can never arrive after the replacement lease has committed.
    const previousCheck = this.inFlight;
    const renewal = (async (): Promise<number | null> => {
      if (previousCheck && !(await previousCheck)) return null;
      if (!this.authorizeInput() || !this.renewalAllowed) return null;
      const capabilities = await this.fetchCapabilities(claims.exp);
      // The OLD expiry timer remains live throughout the fetch. Stop, disposal,
      // expiry, or another mandatory denial cannot be undone by a late reply.
      if (!capabilities || !this.authorizeInput() || !this.renewalAllowed) return null;
      this.tokenExpiresAt = claims.exp;
      this.capabilities = capabilities;
      this.options.updateCapabilities(capabilities);
      if (this.started) this.armExpiry();
      return claims.exp;
    })();
    this.renewal = renewal;
    try {
      return await renewal;
    } finally {
      if (this.renewal === renewal) this.renewal = null;
    }
  }

  /** Synchronous local gate immediately before accepting any socket input. */
  authorizeInput(): boolean {
    if (this.closed) return false;
    if (this.now() >= this.tokenExpiresAt * 1_000) {
      this.deny('live_authority_denied');
      return false;
    }
    return true;
  }

  /** Current server authority gate immediately before consuming socket input. */
  authorizeCurrentInput(): Promise<boolean> {
    return this.revalidate();
  }

  /** Recheck immediately before every regulated gateway output. */
  async authorizeEvent(event: LiveGatewayEvent): Promise<LiveGatewayEvent | null> {
    if (this.closed) return null;
    if (!(await this.revalidate())) return null;

    const required = optionalEventCapability(event);
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
    if (!this.authorizeInput()) return false;
    while (this.renewal) {
      const pending = this.renewal;
      await pending;
      if (!this.authorizeInput()) return false;
      if (this.renewal === pending) this.renewal = null;
    }
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
    const capabilities = await this.fetchCapabilities(this.tokenExpiresAt);
    if (!capabilities || !this.authorizeInput()) return false;
    this.capabilities = capabilities;
    this.options.updateCapabilities(capabilities);
    return true;
  }

  private async fetchCapabilities(
    tokenExpiresAt: number,
  ): Promise<Set<PractitionerCapability> | null> {
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
          tokenExpiresAt,
          vertical: this.options.vertical,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        this.deny('live_authority_denied');
        return null;
      }
      const body = (await response.json()) as { authorized?: unknown; capabilities?: unknown };
      if (body.authorized !== true || !Array.isArray(body.capabilities)) {
        this.deny('live_authority_denied');
        return null;
      }
      const parsed = body.capabilities.map((capability) =>
        PractitionerCapabilitySchema.safeParse(capability),
      );
      if (parsed.some((capability) => !capability.success)) {
        this.deny('live_authority_denied');
        return null;
      }
      const capabilities = new Set(
        parsed.flatMap((capability) => (capability.success ? [capability.data] : [])),
      );
      if ([...this.options.requiredCapabilities].some((required) => !capabilities.has(required))) {
        this.deny('live_authority_denied');
        return null;
      }
      // Another mandatory denial may have fired while the verifier request was
      // in flight. Never publish that now-stale successful result.
      if (!this.authorizeInput()) return null;
      return capabilities;
    } catch {
      this.deny('live_authority_unavailable');
      return null;
    }
  }

  private deny(reason: LiveAuthorityCloseReason): void {
    if (this.closed) return;
    this.closed = true;
    this.dispose();
    this.options.close(reason);
  }
}
