/**
 * Sprint DS8 — the concurrent-session cap (graceful shedding).
 *
 * A single gateway node holds each consult's WebSocket + rolling audio +
 * an in-flight LLM pipeline, so it has a real ceiling. The §0.3 budget is
 * ≥ 50 concurrent sessions/node; past the configured cap we shed NEW
 * sessions with a `busy` status (never dropping a consult already in
 * progress) so the node stays responsive instead of thrashing.
 *
 * Deliberately tiny + synchronous so it's unit-testable without opening
 * sockets. One slot per active session; acquire on start, release on close.
 */
export class GatewayPool {
  private count = 0;

  constructor(readonly max: number) {}

  /** Take a slot; false when the node is already at capacity. */
  tryAcquire(): boolean {
    if (this.count >= this.max) return false;
    this.count++;
    return true;
  }

  /** Return a slot (idempotent-safe: never drops below zero). */
  release(): void {
    if (this.count > 0) this.count--;
  }

  get active(): number {
    return this.count;
  }

  get atCapacity(): boolean {
    return this.count >= this.max;
  }
}

/** The cap from env (default 50 per §0.3), clamped to a sane floor. */
export function maxSessionsFromEnv(): number {
  const raw = Number(process.env['LIVE_GATEWAY_MAX_SESSIONS']);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 50;
}
