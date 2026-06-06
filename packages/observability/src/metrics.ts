import { metrics, type Counter, type Histogram } from '@opentelemetry/api';

/**
 * Domain-specific metrics for Cureocity Mind. Each service can import
 * the typed accessors below; they all share the global meter set up by
 * initObservability() so a single Prometheus scrape sees everything.
 *
 * Naming convention: <service>_<noun>_<unit>. Matches Prometheus
 * conventions so Grafana dashboards work out of the box.
 */

const METER_NAME = 'cureocity-mind';

let cachedMeter: ReturnType<typeof metrics.getMeter> | null = null;
function meter() {
  if (!cachedMeter) cachedMeter = metrics.getMeter(METER_NAME);
  return cachedMeter;
}

let auditWritesTotal: Counter | null = null;
export function recordAuditWrite(action: string, actorType: string): void {
  if (!auditWritesTotal) {
    auditWritesTotal = meter().createCounter('audit_writes_total', {
      description: 'Number of audit_log rows written, by action + actor type.',
    });
  }
  auditWritesTotal.add(1, { action, actor_type: actorType });
}

let crisisFlagsRaisedTotal: Counter | null = null;
export function recordCrisisFlag(severity: string): void {
  if (!crisisFlagsRaisedTotal) {
    crisisFlagsRaisedTotal = meter().createCounter('crisis_flags_raised_total', {
      description:
        'CRISIS_FLAG_RAISED events. Labelled by severity (high|critical). Alert rule: any value > 0 over 1 minute pages the on-call clinician.',
    });
  }
  crisisFlagsRaisedTotal.add(1, { severity });
}

let geminiCallDurationMs: Histogram | null = null;
export function recordGeminiCall(opts: {
  pass:
    | 'PASS_1_TRANSCRIBE_AND_ANALYSE'
    | 'PASS_2_NOTE_GENERATION'
    | 'PASS_3_CLINICAL_ANALYSIS'
    | 'PASS_3_MISSED_THEMES'
    | 'PASS_4_THERAPY_SCRIPT';
  status: 'SUCCESS' | 'ERROR' | 'TIMEOUT' | 'CIRCUIT_OPEN';
  region: string;
  durationMs: number;
}): void {
  if (!geminiCallDurationMs) {
    geminiCallDurationMs = meter().createHistogram('gemini_call_duration_ms', {
      description: 'Gemini call duration in ms, labelled by pass + status + region.',
      unit: 'ms',
    });
  }
  geminiCallDurationMs.record(opts.durationMs, {
    pass: opts.pass,
    status: opts.status,
    region: opts.region,
  });
}

let costInrCounter: Counter | null = null;
export function recordCostInr(opts: { service: string; durationLabel: string; inr: number }): void {
  if (!costInrCounter) {
    costInrCounter = meter().createCounter('vendor_cost_inr_total', {
      description: 'Cumulative INR cost across vendor calls. Wired by cost-guard + WATI.',
      unit: 'INR',
    });
  }
  costInrCounter.add(opts.inr, { service: opts.service, duration_label: opts.durationLabel });
}

let audioChunksUploadedTotal: Counter | null = null;
export function recordAudioChunkUpload(opts: { sampleRate: number; sizeBytes: number }): void {
  if (!audioChunksUploadedTotal) {
    audioChunksUploadedTotal = meter().createCounter('audio_chunks_uploaded_total', {
      description: 'Successful audio chunk uploads. Labelled by sample rate bucket.',
    });
  }
  audioChunksUploadedTotal.add(1, {
    sample_rate_hz: String(opts.sampleRate),
    size_bucket: bucketBytes(opts.sizeBytes),
  });
}

function bucketBytes(n: number): string {
  if (n < 32 * 1024) return 'under_32kb';
  if (n < 128 * 1024) return 'under_128kb';
  if (n < 512 * 1024) return 'under_512kb';
  return 'over_512kb';
}

let costCircuitTripsTotal: Counter | null = null;
export function recordCostCircuitTrip(scope: 'session' | 'monthly'): void {
  if (!costCircuitTripsTotal) {
    costCircuitTripsTotal = meter().createCounter('cost_circuit_trips_total', {
      description: 'Cost circuit breaker trips. Alert if any value > 0 over 5 minutes.',
    });
  }
  costCircuitTripsTotal.add(1, { scope });
}
