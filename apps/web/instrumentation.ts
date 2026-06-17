/**
 * Sprint 40 — Next.js instrumentation hook.
 * Sprint 57 — adds Sentry + OTel metric export.
 *
 * `register()` runs once per server cold-start; we lazy-import the
 * runtime-specific Sentry config + the OTel metrics bootstrap (Node
 * only). `onRequestError` is Next 15's official server-error hook
 * (fires for unhandled errors in routes, server components, and route
 * handlers); we forward to Sentry AND the existing webhook sink so
 * the OBSERVABILITY_WEBHOOK_URL fallback keeps working for users
 * who don't run Sentry.
 */
import * as Sentry from '@sentry/nextjs';

export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    await import('./sentry.server.config');
    const { initOtelMetrics } = await import('./lib/otel-metrics-init');
    await initOtelMetrics();
  }

  if (process.env['NEXT_RUNTIME'] === 'edge') {
    await import('./sentry.edge.config');
  }

  if (process.env['OBSERVABILITY_WEBHOOK_URL']) {
    console.info('[observability] error forwarding enabled (OBSERVABILITY_WEBHOOK_URL set)');
  }
}

interface RequestErrorRequest {
  path?: string;
  method?: string;
}
interface RequestErrorContext {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
  renderSource?: string;
}

export const onRequestError: typeof Sentry.captureRequestError = async (
  error,
  request,
  context,
) => {
  // Sentry first — its hook expects the official Next signatures and
  // attaches the route + runtime metadata for grouping.
  await Sentry.captureRequestError(error, request, context);

  // Existing webhook capture: keeps the OBSERVABILITY_WEBHOOK_URL path
  // working for self-hosters who don't run Sentry. Edge-runtime errors
  // come back through here too, but the sink only fetches in Node.
  if (process.env['NEXT_RUNTIME'] === 'edge') return;
  try {
    const { captureError } = await import('@/lib/observability-sink');
    const req = request as RequestErrorRequest;
    const ctx = context as RequestErrorContext;
    await captureError(error, {
      source: 'server',
      ...(req.path && { route: req.path }),
      ...(req.method && { method: req.method }),
      extra: {
        routerKind: ctx.routerKind,
        routeType: ctx.routeType,
        routePath: ctx.routePath,
        renderSource: ctx.renderSource,
      },
    });
  } catch {
    // Swallow — the reporter must never throw.
  }
};
