/* eslint-disable no-console */
/**
 * Cureocity Mind — load test harness. Sprint 10 PR 3.
 *
 * Per the plan: "simulate 30 therapists running 5 concurrent sessions;
 * system stable". This script drives that against a running stack.
 *
 * What "stable" means here:
 *   - p95 session create + start + end latency under 1.5s
 *   - zero 5xx responses
 *   - audit_writes_total counter increments at expected rate
 *
 * Usage:
 *   pnpm exec tsx scripts/load-test.ts                       # default 30×5
 *   pnpm exec tsx scripts/load-test.ts --therapists=30 --sessions=5
 *   pnpm exec tsx scripts/load-test.ts --duration-sec=60
 *
 * Requires:
 *   - AUTH_BYPASS=true on every service.
 *   - Seeded fixtures (psychologist + client) so the script doesn't
 *     have to manage Firebase tokens. The bootstrap step in main()
 *     creates them if absent (idempotent — patient-model-service's
 *     /psychologists is idempotent on firebaseUid).
 *
 * Output: a JSON summary written to stdout. Pipe to
 * docs/load-test-results.md or your incident ticket.
 */

const PATIENT_BASE = process.env['PATIENT_SERVICE_BASE'] ?? 'http://localhost:3001/api/v1';
const SCRIBE_BASE = process.env['SCRIBE_SERVICE_BASE'] ?? 'http://localhost:3002/api/v1';
const BYPASS_AUTH = 'Bearer dev-bypass';

interface Args {
  therapists: number;
  sessionsPerTherapist: number;
  durationSec: number;
  dryRun: boolean;
}

interface Sample {
  step: string;
  ms: number;
  ok: boolean;
  status?: number;
}

function parseArgs(): Args {
  const args: Args = {
    therapists: 30,
    sessionsPerTherapist: 5,
    durationSec: 60,
    dryRun: false,
  };
  for (const a of process.argv.slice(2)) {
    const [k, v] = a.replace(/^--/, '').split('=');
    if (k === 'therapists' && v) args.therapists = Number(v);
    if (k === 'sessions' && v) args.sessionsPerTherapist = Number(v);
    if (k === 'duration-sec' && v) args.durationSec = Number(v);
    if (k === 'dry-run') args.dryRun = true;
  }
  return args;
}

async function timed<T>(step: string, fn: () => Promise<T>, samples: Sample[]): Promise<T | null> {
  const start = Date.now();
  try {
    const result = await fn();
    samples.push({ step, ms: Date.now() - start, ok: true });
    return result;
  } catch (e) {
    const ms = Date.now() - start;
    const msg = (e as Error).message;
    const m = msg.match(/(\d{3})/);
    samples.push({
      step,
      ms,
      ok: false,
      ...(m ? { status: Number(m[1]) } : {}),
    });
    return null;
  }
}

async function http<T>(method: string, url: string, body?: unknown, dryRun = false): Promise<T> {
  if (dryRun) return {} as T;
  const res = await fetch(url, {
    method,
    headers: { Authorization: BYPASS_AUTH, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${method} ${url} ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

interface SessionFixture {
  clientId: string;
  psychologistId: string;
}

async function bootstrap(args: Args): Promise<SessionFixture> {
  console.log('Bootstrapping fixtures…');
  const psy = await http<{ id: string }>(
    'POST',
    `${PATIENT_BASE}/psychologists`,
    {
      fullName: 'LoadTest Therapist',
      email: 'loadtest@example.in',
      phone: '+919800000001',
      rciNumber: 'L00001',
    },
    args.dryRun,
  );
  const client = await http<{ id: string }>(
    'POST',
    `${PATIENT_BASE}/clients`,
    {
      fullName: 'LoadTest Client',
      contactPhone: '+919800000002',
      consents: [
        { scope: 'AUDIO_RECORDING', scriptVersion: 'v1.0', capturedVia: 'IN_PERSON' },
        { scope: 'AI_NOTE_GENERATION', scriptVersion: 'v1.0', capturedVia: 'IN_PERSON' },
      ],
    },
    args.dryRun,
  );
  return {
    psychologistId: psy.id ?? 'dryrun-psy',
    clientId: client.id ?? 'dryrun-client',
  };
}

async function oneSession(fixture: SessionFixture, args: Args, samples: Sample[]): Promise<void> {
  const session = await timed(
    'create',
    () =>
      http<{ id: string }>(
        'POST',
        `${SCRIBE_BASE}/sessions`,
        {
          clientId: fixture.clientId,
          modality: 'CBT',
          scheduledAt: new Date().toISOString(),
        },
        args.dryRun,
      ),
    samples,
  );
  if (!session) return;
  const sid = session.id ?? 'dryrun-session';

  await timed(
    'consent',
    () =>
      http(
        'POST',
        `${SCRIBE_BASE}/sessions/${sid}/consent`,
        { scopes: ['AUDIO_RECORDING'], scriptVersion: 'v1.0' },
        args.dryRun,
      ),
    samples,
  );
  await timed(
    'start',
    () => http('POST', `${SCRIBE_BASE}/sessions/${sid}/start`, undefined, args.dryRun),
    samples,
  );
  // Skip audio chunk uploads — they're tested by the scribe-service
  // integration harness; this script focuses on the request rate the
  // session-lifecycle path produces.
  await timed(
    'end',
    () => http('POST', `${SCRIBE_BASE}/sessions/${sid}/end`, undefined, args.dryRun),
    samples,
  );
}

async function therapistLoop(
  fixture: SessionFixture,
  args: Args,
  samples: Sample[],
  deadline: number,
): Promise<void> {
  while (Date.now() < deadline) {
    const concurrent: Promise<void>[] = [];
    for (let i = 0; i < args.sessionsPerTherapist; i++) {
      concurrent.push(oneSession(fixture, args, samples));
    }
    await Promise.all(concurrent);
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

function summarise(samples: Sample[], wallMs: number): unknown {
  const byStep = new Map<string, Sample[]>();
  for (const s of samples) {
    const arr = byStep.get(s.step) ?? [];
    arr.push(s);
    byStep.set(s.step, arr);
  }
  const perStep: Record<string, unknown> = {};
  for (const [step, arr] of byStep.entries()) {
    const ok = arr.filter((s) => s.ok);
    const fail = arr.filter((s) => !s.ok);
    const times = ok.map((s) => s.ms);
    perStep[step] = {
      count: arr.length,
      okCount: ok.length,
      failCount: fail.length,
      failureRate: arr.length === 0 ? 0 : fail.length / arr.length,
      p50ms: percentile(times, 0.5),
      p95ms: percentile(times, 0.95),
      p99ms: percentile(times, 0.99),
      failuresByStatus: countBy(fail, (s) => String(s.status ?? 'n/a')),
    };
  }
  return {
    durationSec: Math.round(wallMs / 1000),
    totalRequests: samples.length,
    requestsPerSec: samples.length / (wallMs / 1000),
    perStep,
  };
}

function countBy<T>(arr: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of arr) {
    const k = key(t);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(
    `Load test: ${args.therapists} therapists × ${args.sessionsPerTherapist} concurrent sessions × ${args.durationSec}s${args.dryRun ? ' (DRY RUN)' : ''}`,
  );
  const fixture = await bootstrap(args);
  console.log(`Fixture ready: clientId=${fixture.clientId}`);

  const samples: Sample[] = [];
  const start = Date.now();
  const deadline = start + args.durationSec * 1000;

  const therapists: Promise<void>[] = [];
  for (let t = 0; t < args.therapists; t++) {
    therapists.push(therapistLoop(fixture, args, samples, deadline));
  }
  await Promise.all(therapists);

  const summary = summarise(samples, Date.now() - start);
  console.log(JSON.stringify(summary, null, 2));
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
