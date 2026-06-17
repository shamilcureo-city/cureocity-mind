/**
 * Sprint 40 — observability sink (dependency-free).
 *
 * One place every captured error/event flows through. It always logs to
 * stdout (Vercel captures that), and — when OBSERVABILITY_WEBHOOK_URL is
 * set — fire-and-forget POSTs a structured JSON payload to it. Point that
 * URL at Sentry's ingest, an OTel collector, Better Stack, Axiom, a Slack
 * relay — anything that speaks "POST me JSON". The sink itself takes no
 * dependency on any vendor SDK, so the web app stays lean and the choice
 * stays yours.
 *
 * Hard rule: this never throws. An error in the error reporter must not
 * become a second error on the request path.
 */

export interface CaptureContext {
  /** Where it came from: 'server' | 'client' | 'global-error' | route name. */
  source: string;
  route?: string;
  method?: string;
  digest?: string;
  psychologistId?: string;
  extra?: Record<string, unknown>;
}

interface ErrorPayload {
  type: 'error';
  timestamp: string;
  service: 'cureocity-web';
  env: string;
  name: string;
  message: string;
  stack?: string;
  source: string;
  route?: string;
  method?: string;
  digest?: string;
  psychologistId?: string;
  extra?: Record<string, unknown>;
}

function buildPayload(error: unknown, ctx: CaptureContext): ErrorPayload {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    type: 'error',
    timestamp: new Date().toISOString(),
    service: 'cureocity-web',
    env: process.env['VERCEL_ENV'] ?? process.env['NODE_ENV'] ?? 'local',
    name: err.name,
    message: err.message.slice(0, 2000),
    stack: err.stack?.slice(0, 8000),
    source: ctx.source,
    ...(ctx.route && { route: ctx.route }),
    ...(ctx.method && { method: ctx.method }),
    ...(ctx.digest && { digest: ctx.digest }),
    ...(ctx.psychologistId && { psychologistId: ctx.psychologistId }),
    ...(ctx.extra && { extra: ctx.extra }),
  };
}

export async function captureError(error: unknown, ctx: CaptureContext): Promise<void> {
  const payload = buildPayload(error, ctx);
  // Always surface in logs.
  console.error(
    `[observability] ${payload.source} ${payload.route ?? ''} — ${payload.name}: ${payload.message}`,
  );

  // Sprint 57 — Sentry. The SDK is initialised in instrumentation.ts +
  // sentry.{server,edge,client}.config.ts; if VERCEL_ENV is unset it's
  // a no-op so local dev stays silent.
  try {
    const Sentry = await import('@sentry/nextjs');
    Sentry.captureException(error, {
      tags: {
        source: ctx.source,
        ...(ctx.route && { route: ctx.route }),
        ...(ctx.method && { method: ctx.method }),
      },
      contexts: {
        capture: {
          digest: ctx.digest,
          psychologistId: ctx.psychologistId,
          ...ctx.extra,
        },
      },
    });
  } catch {
    // Swallow — never throw from the reporter.
  }

  const url = process.env['OBSERVABILITY_WEBHOOK_URL'];
  if (!url) return;
  const token = process.env['OBSERVABILITY_WEBHOOK_TOKEN'];
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      // Bound the call so a slow collector never delays the response path.
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Swallow — the reporter must never throw.
  }
}
