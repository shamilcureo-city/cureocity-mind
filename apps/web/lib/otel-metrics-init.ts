/**
 * Sprint 57 — OTel metric export for the Next runtime.
 *
 * The metric recorders in `packages/observability/src/metrics.ts`
 * (recordCrisisFlag, recordGeminiCall, etc.) use the global OTel
 * MeterProvider. Until one is installed, every recorder call is a
 * no-op. This module installs a MeterProvider with an OTLP/HTTP
 * exporter pointed at `OTEL_EXPORTER_OTLP_ENDPOINT` — pair it with
 * Grafana Cloud, Honeycomb, or any OTLP-compatible backend.
 *
 * Env vars (all optional; missing endpoint = no-op):
 *   OTEL_EXPORTER_OTLP_ENDPOINT   base URL, e.g. https://otlp-gateway-prod-us-central-0.grafana.net/otlp
 *   OTEL_EXPORTER_OTLP_HEADERS    comma-separated key=value pairs for auth
 *
 * Serverless caveat: PeriodicExportingMetricReader flushes on its own
 * interval (30s). Vercel functions can die between flushes — at worst
 * 30s of metrics are lost on cold-stop. Crisis-flag counts have a
 * durable backup in audit_log; cost counters are a rough estimate, not
 * a billing source.
 */

let initialized = false;

export async function initOtelMetrics(): Promise<void> {
  if (initialized) return;
  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  if (!endpoint) return;

  const [{ metrics: metricsApi }, sdk, exporterModule, resources, semconv] = await Promise.all([
    import('@opentelemetry/api'),
    import('@opentelemetry/sdk-metrics'),
    import('@opentelemetry/exporter-metrics-otlp-http'),
    import('@opentelemetry/resources'),
    import('@opentelemetry/semantic-conventions'),
  ]);

  const exporter = new exporterModule.OTLPMetricExporter({
    url: `${endpoint.replace(/\/$/, '')}/v1/metrics`,
    ...(process.env['OTEL_EXPORTER_OTLP_HEADERS'] && {
      headers: parseHeaders(process.env['OTEL_EXPORTER_OTLP_HEADERS']),
    }),
  });

  const provider = new sdk.MeterProvider({
    resource: new resources.Resource({
      [semconv.ATTR_SERVICE_NAME]: 'cureocity-web',
      [semconv.ATTR_SERVICE_VERSION]: process.env['VERCEL_GIT_COMMIT_SHA'] ?? '0.0.0',
    }),
    readers: [
      new sdk.PeriodicExportingMetricReader({
        exporter,
        exportIntervalMillis: 30000,
        exportTimeoutMillis: 5000,
      }),
    ],
  });

  metricsApi.setGlobalMeterProvider(provider);
  initialized = true;
  console.info('[observability] OTel metric export enabled');
}

function parseHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq < 1) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}
