import * as Sentry from '@sentry/node';

/**
 * Gateway error reporting. The web app has had Sentry since Sprint 57, but
 * the gateway — the one service holding live patient audio — only logged to
 * Cloud Run's console, so a broken consult was invisible unless someone went
 * log-diving. Env-gated: without SENTRY_DSN every call here is a no-op and
 * nothing changes (dev, CI, unit tests).
 *
 * `Sentry.init` also auto-captures uncaught exceptions and unhandled
 * rejections (default Node integrations), preserving crash-exit semantics.
 */
const dsn = process.env['SENTRY_DSN'];

export function initSentry(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env['NODE_ENV'] ?? 'development',
    // The gateway is a WS pipeline, not an HTTP request tree — error
    // reporting only, no performance tracing spend.
    tracesSampleRate: 0,
  });
  console.log('[live-gateway] Sentry error reporting enabled');
}

/**
 * Log AND report a handled pipeline error. Keeps the console line (Cloud
 * Run logs remain the first-look surface) and mirrors it to Sentry with
 * the pipeline stage as a tag so consult failures group sensibly.
 */
export function reportError(stage: string, err: unknown): void {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(`[live-gateway] ${stage}:`, e.message);
  if (!dsn) return;
  Sentry.captureException(e, { tags: { stage } });
}
