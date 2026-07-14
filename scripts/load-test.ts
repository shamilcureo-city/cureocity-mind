/* eslint-disable no-console */
/**
 * Cureocity Mind — load-test harness (rewritten; replaces the Sprint-10 one).
 *
 * The original script drove the NestJS scaffolds (localhost:3001/3002),
 * which serve no production traffic — it load-tested infrastructure that
 * doesn't exist. This version drives the REAL request path: the apps/web
 * Next.js routes, through the same call sequence the recording flow makes
 * (create session → consent → start → end).
 *
 * What it measures: can the platform absorb N concurrent session workflows
 * with zero 5xx and p95 per step under the 1.5s bar
 * (docs/load-test-results.md). On serverless Vercel + Neon the tenant
 * dimension barely matters (every request is stateless), so N concurrent
 * WORKFLOWS is the honest unit of load — not N fake therapist accounts,
 * which the real API deliberately refuses to mass-create.
 *
 * Usage (local stack — docker compose Postgres + web dev server started
 * with AUTH_BYPASS=true and LLM_BACKEND=mock):
 *
 *   pnpm exec tsx scripts/load-test.ts                       # 10 workers × 5
 *   pnpm exec tsx scripts/load-test.ts --workers=30 --iterations=5
 *
 * Against a Vercel PREVIEW (never production — see the guard):
 *
 *   LOAD_TEST_BASE_URL=https://<preview>.vercel.app ALLOW_REMOTE=true \
 *     pnpm exec tsx scripts/load-test.ts --workers=15
 *
 * The preview must have AUTH_BYPASS=true and a THROWAWAY database branch —
 * the run fabricates clients + sessions (cleaned up best-effort via client
 * soft-delete at the end, but treat the target DB as disposable).
 *
 * Safety rails:
 *   - Production hostnames are refused unconditionally.
 *   - Any non-localhost target additionally requires ALLOW_REMOTE=true.
 *   - Run the target with LLM_BACKEND=mock so /end's generation kick costs
 *     nothing; the harness itself never calls an LLM route directly.
 */

const BASE = (process.env['LOAD_TEST_BASE_URL'] ?? 'http://localhost:3000').replace(/\/$/, '');
const AUTH = { Authorization: 'Bearer dev-bypass', 'Content-Type': 'application/json' };

// ---------------------------------------------------------------------------
// Safety rails
// ---------------------------------------------------------------------------
const PROD_HOSTS = ['mind.cureocity.in', 'cureocity-mind-api.vercel.app'];

function assertSafeTarget(): void {
  const url = new URL(BASE);
  if (PROD_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) {
    console.error(
      `REFUSED: ${url.hostname} is the production deployment. This harness fabricates\n` +
        'clinical rows and must never run against real patient data. Point it at a\n' +
        'local stack or a preview deployment with a throwaway database branch.',
    );
    process.exit(1);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (!local && process.env['ALLOW_REMOTE'] !== 'true') {
    console.error(
      `REFUSED: ${url.hostname} is not localhost. If this is a preview deployment\n` +
        'with AUTH_BYPASS and a disposable DB branch, re-run with ALLOW_REMOTE=true.',
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
interface Args {
  workers: number;
  iterations: number;
  keepData: boolean;
}

function parseArgs(): Args {
  const args: Args = { workers: 10, iterations: 5, keepData: false };
  for (const a of process.argv.slice(2)) {
    const [k, v] = a.split('=');
    if (k === '--workers') args.workers = Number(v);
    if (k === '--iterations') args.iterations = Number(v);
    if (k === '--keep-data') args.keepData = true;
  }
  if (!Number.isFinite(args.workers) || args.workers < 1 || args.workers > 200) {
    throw new Error('--workers must be 1..200');
  }
  if (!Number.isFinite(args.iterations) || args.iterations < 1 || args.iterations > 100) {
    throw new Error('--iterations must be 1..100');
  }
  return args;
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------
interface Sample {
  step: string;
  ms: number;
  status: number;
}
const samples: Sample[] = [];

async function timed(step: string, fn: () => Promise<Response>): Promise<Response> {
  const t0 = Date.now();
  const res = await fn();
  samples.push({ step, ms: Date.now() - t0, status: res.status });
  return res;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

// ---------------------------------------------------------------------------
// The workflow — the exact sequence RecordConfirmStrip performs.
// ---------------------------------------------------------------------------
async function createClient(worker: number): Promise<string> {
  const res = await timed('client-create', () =>
    fetch(`${BASE}/api/v1/clients`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        fullName: `Load Test W${worker} ${Date.now() % 100000}`,
        contactPhone: `+9198${String(10000000 + Math.floor(Math.random() * 89999999))}`,
        consents: [
          { scope: 'AUDIO_RECORDING', scriptVersion: 'v1.0', capturedVia: 'IN_PERSON' },
          { scope: 'AI_NOTE_GENERATION', scriptVersion: 'v1.0', capturedVia: 'IN_PERSON' },
          { scope: 'CROSS_BORDER_PROCESSING', scriptVersion: 'v1.0', capturedVia: 'IN_PERSON' },
        ],
      }),
    }),
  );
  if (!res.ok) throw new Error(`client-create ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

async function oneSessionCycle(clientId: string): Promise<void> {
  // 1. Create (startNow reuses a same-day booked row when one exists).
  const createRes = await timed('session-create', () =>
    fetch(`${BASE}/api/v1/sessions`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        clientId,
        scheduledAt: new Date().toISOString(),
        startNow: true,
      }),
    }),
  );
  if (!createRes.ok) throw new Error(`session-create ${createRes.status}`);
  const session = (await createRes.json()) as { id: string };

  // 2. Consent snapshot (same scopes the record flow acknowledges).
  const consentRes = await timed('consent', () =>
    fetch(`${BASE}/api/v1/sessions/${session.id}/consent`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        scopes: ['AUDIO_RECORDING', 'AI_NOTE_GENERATION', 'CROSS_BORDER_PROCESSING'],
        scriptVersion: 'v1.0',
      }),
    }),
  );
  if (!consentRes.ok) throw new Error(`consent ${consentRes.status}`);

  // 3. Start. A reuse path may already be IN_PROGRESS — tolerate a 4xx
  // here but never a 5xx (the pass/fail gate below catches those).
  const startRes = await timed('start', () =>
    fetch(`${BASE}/api/v1/sessions/${session.id}/start`, { method: 'POST', headers: AUTH }),
  );
  if (startRes.status >= 500) throw new Error(`start ${startRes.status}`);

  // 4. End. Kicks note generation on the target; with LLM_BACKEND=mock that
  // is free and deterministic. No audio was uploaded, so generation may
  // fail-gracefully — the load question is the HTTP path, not the note.
  const endRes = await timed('end', () =>
    fetch(`${BASE}/api/v1/sessions/${session.id}/end`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({}),
    }),
  );
  if (endRes.status >= 500) throw new Error(`end ${endRes.status}`);
}

async function cleanupClient(clientId: string): Promise<void> {
  try {
    await fetch(`${BASE}/api/v1/clients/${clientId}`, { method: 'DELETE', headers: AUTH });
  } catch {
    // best-effort — the target DB is disposable by contract anyway
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  assertSafeTarget();
  const args = parseArgs();

  // Preflight: the target must be up and healthy before we swarm it.
  const health = await fetch(`${BASE}/api/v1/health`).catch(() => null);
  if (!health || !health.ok) {
    console.error(
      `Preflight failed: GET ${BASE}/api/v1/health → ${health ? health.status : 'unreachable'}.\n` +
        'Is the target running (with AUTH_BYPASS=true and LLM_BACKEND=mock)?',
    );
    process.exit(1);
  }

  console.log(
    `Target ${BASE} · ${args.workers} workers × ${args.iterations} session cycles ` +
      `(${args.workers * args.iterations} total)`,
  );
  const wall0 = Date.now();
  const errors: string[] = [];
  const clientIds: string[] = [];

  await Promise.all(
    Array.from({ length: args.workers }, (_, w) =>
      (async () => {
        let clientId: string;
        try {
          clientId = await createClient(w);
          clientIds.push(clientId);
        } catch (e) {
          errors.push(`worker ${w}: ${(e as Error).message}`);
          return;
        }
        for (let i = 0; i < args.iterations; i++) {
          try {
            await oneSessionCycle(clientId);
          } catch (e) {
            errors.push(`worker ${w} iter ${i}: ${(e as Error).message}`);
          }
        }
      })(),
    ),
  );

  const wallMs = Date.now() - wall0;
  if (!args.keepData) {
    await Promise.all(clientIds.map(cleanupClient));
  }

  // ---- report ----
  const steps = [...new Set(samples.map((s) => s.step))];
  const failures = samples.filter((s) => s.status >= 500);
  const report = {
    target: BASE,
    workers: args.workers,
    iterations: args.iterations,
    wallMs,
    requestsPerSec: Number((samples.length / (wallMs / 1000)).toFixed(1)),
    totalRequests: samples.length,
    server5xx: failures.length,
    errors: errors.slice(0, 20),
    steps: Object.fromEntries(
      steps.map((step) => {
        const ms = samples
          .filter((s) => s.step === step)
          .map((s) => s.ms)
          .sort((a, b) => a - b);
        return [
          step,
          {
            count: ms.length,
            p50: pct(ms, 50),
            p95: pct(ms, 95),
            p99: pct(ms, 99),
            max: ms[ms.length - 1] ?? 0,
          },
        ];
      }),
    ),
  };
  console.log(JSON.stringify(report, null, 2));

  // ---- pass/fail against the documented bar ----
  const coreSteps = ['session-create', 'consent', 'start', 'end'];
  const p95Breaches = coreSteps.filter((step) => {
    const ms = samples
      .filter((s) => s.step === step)
      .map((s) => s.ms)
      .sort((a, b) => a - b);
    return ms.length > 0 && pct(ms, 95) > 1500;
  });
  const pass = failures.length === 0 && p95Breaches.length === 0 && errors.length === 0;
  console.log(
    pass
      ? '\nPASS — zero 5xx, all core-step p95 under 1.5s. Log the row in docs/load-test-results.md.'
      : `\nFAIL — 5xx=${failures.length}, p95 breaches=[${p95Breaches.join(', ')}], workflow errors=${errors.length}.`,
  );
  process.exit(pass ? 0 : 1);
}

void main();
