/**
 * Sprint 40 — Next.js instrumentation hook.
 *
 * `register()` runs once per server start; `onRequestError` is Next 15's
 * official server-error hook (fires for unhandled errors in routes,
 * server components, and route handlers). Both feed the observability
 * sink, which forwards to whatever collector OBSERVABILITY_WEBHOOK_URL
 * points at (or just logs).
 *
 * Full OpenTelemetry tracing (the @cureocity/observability NodeSDK) is
 * wired into the NestJS services; bringing the heavy Node SDK into the
 * Next serverless runtime is a deliberate follow-up — error capture is
 * the high-value 80% and ships dependency-free here.
 */

export async function register(): Promise<void> {
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

export async function onRequestError(
  error: unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext,
): Promise<void> {
  // Only the Node runtime can reach the sink's fetch reliably; the edge
  // runtime would too, but our routes are nodejs. Guard import so the
  // edge bundle never pulls it.
  if (process.env['NEXT_RUNTIME'] === 'edge') return;
  const { captureError } = await import('@/lib/observability-sink');
  await captureError(error, {
    source: 'server',
    ...(request.path && { route: request.path }),
    ...(request.method && { method: request.method }),
    extra: {
      routerKind: context.routerKind,
      routeType: context.routeType,
      routePath: context.routePath,
      renderSource: context.renderSource,
    },
  });
}
