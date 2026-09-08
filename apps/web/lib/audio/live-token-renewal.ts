import type { LiveGatewayCommand, LiveGatewayEvent } from '@cureocity/contracts';

export interface LiveTokenLease {
  expiresInSec: number;
  /** Captured before the mint request, not after its response. */
  requestedAtMs: number;
}

interface LiveTokenRenewalOptions {
  sessionId: string;
  initialLease: LiveTokenLease;
  send: (command: LiveGatewayCommand) => void;
  /** Must stop capture and require explicit recovery; never auto-reconnect. */
  onFailure: () => void;
}

const REQUEST_TIMEOUT_MS = 20_000;
const ACK_TIMEOUT_MS = 20_000;

function leaseDeadline(lease: LiveTokenLease): number | null {
  if (
    !Number.isFinite(lease.requestedAtMs) ||
    !Number.isFinite(lease.expiresInSec) ||
    lease.expiresInSec <= 0 ||
    lease.expiresInSec > 86_400
  )
    return null;
  return lease.requestedAtMs + lease.expiresInSec * 1_000;
}

/**
 * One controller per socket. Renewal never opens a socket, touches the mic,
 * replays audio, or changes clinical state. The old deadline remains enforced
 * until a matching acknowledgement proves that the gateway accepted the lease.
 */
export class LiveTokenRenewal {
  private active = false;
  private disposed = false;
  private deadline = 0;
  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private requestAbort: AbortController | null = null;
  private pending: { requestId: string; deadline: number } | null = null;

  constructor(private readonly options: LiveTokenRenewalOptions) {}

  start(): void {
    if (this.active || this.disposed) return;
    this.active = true;
    const deadline = leaseDeadline(this.options.initialLease);
    if (deadline === null || deadline <= Date.now()) {
      this.fail();
      return;
    }
    this.installLease(deadline);
  }

  handleEvent(event: LiveGatewayEvent): void {
    if (
      !this.active ||
      this.disposed ||
      event.type !== 'tokenRenewed' ||
      !this.pending ||
      event.requestId !== this.pending.requestId
    )
      return;
    // expiresAt belongs to the server's clock. A correlated acknowledgement
    // confirms that exact pending token, whose relative TTL came from the
    // authenticated mint route. Keep local timers in the local clock domain.
    const deadline = this.pending.deadline;
    if (
      this.deadline <= Date.now() ||
      !Number.isSafeInteger(event.expiresAt) ||
      event.expiresAt <= 0 ||
      deadline <= this.deadline ||
      deadline <= Date.now()
    ) {
      this.fail();
      return;
    }
    this.pending = null;
    this.clearPendingTimer();
    this.installLease(deadline);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = false;
    if (this.renewTimer) clearTimeout(this.renewTimer);
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.renewTimer = null;
    this.expiryTimer = null;
    this.clearPendingTimer();
    this.requestAbort?.abort();
    this.requestAbort = null;
    this.pending = null;
  }

  private installLease(deadline: number): void {
    if (this.renewTimer) clearTimeout(this.renewTimer);
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.deadline = deadline;
    const remaining = deadline - Date.now();
    const lead = Math.min(60_000, remaining * 0.2);
    this.expiryTimer = setTimeout(() => this.fail(), remaining);
    this.renewTimer = setTimeout(() => void this.renew(), Math.max(0, remaining - lead));
  }

  private async renew(): Promise<void> {
    if (this.disposed || !this.active) return;
    const requestedAtMs = Date.now();
    const abort = new AbortController();
    this.requestAbort = abort;
    // A dedicated timer also fails closed when a fetch implementation ignores
    // abort. Late success is ignored by the disposed/identity guards below.
    this.pendingTimer = setTimeout(() => this.fail(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`/api/v1/sessions/${this.options.sessionId}/live-token`, {
        method: 'POST',
        signal: abort.signal,
      });
      if (this.disposed || this.requestAbort !== abort) return;
      if (!response.ok) throw new Error('Live authorization renewal refused');
      const body = (await response.json()) as { token?: unknown; expiresInSec?: unknown };
      if (this.disposed || this.requestAbort !== abort) return;
      const deadline =
        typeof body.expiresInSec === 'number'
          ? leaseDeadline({ requestedAtMs, expiresInSec: body.expiresInSec })
          : null;
      if (
        typeof body.token !== 'string' ||
        body.token.length === 0 ||
        body.token.length > 8192 ||
        deadline === null ||
        deadline <= this.deadline ||
        this.deadline <= Date.now()
      )
        throw new Error('Invalid live authorization lease');
      this.requestAbort = null;
      this.clearPendingTimer();
      const requestId = crypto.randomUUID();
      this.pending = { requestId, deadline };
      this.pendingTimer = setTimeout(() => this.fail(), ACK_TIMEOUT_MS);
      this.options.send({ type: 'renewToken', requestId, token: body.token });
    } catch {
      if (!this.disposed) this.fail();
    }
  }

  private clearPendingTimer(): void {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
  }

  private fail(): void {
    if (this.disposed) return;
    this.dispose();
    this.options.onFailure();
  }
}
