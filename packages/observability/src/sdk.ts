import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

/**
 * Cureocity Mind observability bootstrap. Sprint 10 PR 1.
 *
 * One call early in each service's main.ts wires:
 *   - OTLP/HTTP trace export to OTEL_EXPORTER_OTLP_ENDPOINT
 *     (defaults to http://localhost:4318, which the otel-collector in
 *     infrastructure/docker-compose.yml listens on).
 *   - Prometheus metrics scrape endpoint at OTEL_PROMETHEUS_PORT
 *     (defaults to PORT + 1000, so scribe-service on :3002 exposes
 *     metrics on :4002). Prometheus scrape jobs in
 *     infrastructure/prometheus/prometheus.yml target these ports.
 *   - Auto-instrumentation for http, express, pg, redis, ioredis,
 *     undici/fetch — covers every wire we care about without manual
 *     spans.
 *
 * Disabled when OTEL_DISABLED=true is set (tests + CI default to this
 * via the env-schema so spec runs don't try to open ports).
 */
export interface ObservabilityOptions {
  serviceName: string;
  serviceVersion?: string;
  /** Override the OTLP trace endpoint. */
  otlpEndpoint?: string;
  /** Override the Prometheus scrape port. */
  prometheusPort?: number;
  /** When true, bootstrap is a no-op. */
  disabled?: boolean;
}

export interface ObservabilityHandle {
  sdk: NodeSDK | null;
  shutdown: () => Promise<void>;
}

export function initObservability(opts: ObservabilityOptions): ObservabilityHandle {
  if (opts.disabled || process.env['OTEL_DISABLED'] === 'true') {
    return { sdk: null, shutdown: async () => {} };
  }

  const otlpEndpoint =
    opts.otlpEndpoint ?? process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318';
  const prometheusPort =
    opts.prometheusPort ??
    (process.env['OTEL_PROMETHEUS_PORT'] ? Number(process.env['OTEL_PROMETHEUS_PORT']) : undefined);

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: opts.serviceName,
    [ATTR_SERVICE_VERSION]: opts.serviceVersion ?? '0.0.0',
  });

  const traceExporter = new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` });

  // PrometheusExporter starts its own HTTP server when given a port; if
  // no port is provided the metric reader is registered but no port is
  // opened (useful in tests).
  const metricReader = new PrometheusExporter({
    ...(prometheusPort !== undefined && { port: prometheusPort, host: '0.0.0.0' }),
    preventServerStart: prometheusPort === undefined,
  });

  const sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader,
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs instrumentation generates a flood of spans for typical
        // Node.js workloads — disabled to keep trace volume tractable.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // The dns auto-instrumentation is similarly noisy.
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();

  const shutdown = async (): Promise<void> => {
    try {
      await sdk.shutdown();
    } catch (e) {
      // Don't crash the shutdown path on OTel hiccups.
      console.warn(`[observability] shutdown error: ${(e as Error).message}`);
    }
  };

  // Best-effort flush on SIGTERM / SIGINT — NestJS shutdown hooks
  // call this too, but services without enableShutdownHooks() still get
  // covered.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void shutdown();
    });
  }

  return { sdk, shutdown };
}
