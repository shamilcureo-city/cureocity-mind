# Load test results

Append a row per drill. Run via:

```bash
pnpm exec tsx scripts/load-test.ts --therapists=30 --sessions=5 --duration-sec=60
```

The acceptance bar from the Sprint 10 plan: **30 therapists × 5
concurrent sessions, system stable**, where stable means:

- zero 5xx responses across the run
- p95 latency for create/consent/start/end under 1.5 seconds each
- audit_writes_total counter increments at the rate the request count
  predicts (1 audit row per write endpoint × throughput)

## Drill log

| Date         | Therapists | Sessions/T | Duration | p95 ms (create / consent / start / end) | Errors | Notes      |
| ------------ | ---------- | ---------- | -------- | --------------------------------------- | ------ | ---------- |
| _yyyy-mm-dd_ | _N_        | _N_        | _Ns_     | _XX/XX/XX/XX_                           | _0_    | _baseline_ |

## Interpreting failures

| Symptom in output           | Likely cause                                    |
| --------------------------- | ----------------------------------------------- |
| `failuresByStatus["500"]>0` | service crashed; check logs                     |
| `failuresByStatus["429"]>0` | rate limit hit; the cost-guard is too tight     |
| `failuresByStatus["409"]>0` | session created twice on the same client/time   |
| `p99ms` >> `p95ms`          | DB lock contention or BullMQ saturation         |
| `requestsPerSec` drops      | service died mid-run; check `docker compose ps` |

## Doctor vertical — live-gateway concurrency (DV8.5)

The batch path (record → upload chunks → generate-note) shares the
therapist load profile above; the **net-new** load characteristic is the
live copilot (DV4), which holds a **stateful WebSocket per active
consult** in `services/live-gateway`.

Size the in-region gateway for **peak simultaneous consults**, not
request rate:

- One socket + one rolling audio buffer + one in-flight Pass-1/Pass-2
  cycle (every ~4 s) per concurrent consult. Memory scales with the
  rolling buffer (bounded by consult length × 16 kHz s16le ≈ 1.9 MB/min).
- The structurer cadence (Pass 2 every cycle) drives Gemini spend +
  latency — the cost-guard does **not** cover the gateway (it's outside
  `apps/web`); add a per-consult cycle cap before scaling the pilot.
- A consult is long-lived (10–20 min). Plan capacity as
  `peak_parallel_consults`, and load-test the socket service separately
  from the HTTP app (a 30-doctor clinic with ~6 rooms ≈ 6 parallel
  sockets, not 30).

Acceptance bar for the gateway drill: N parallel sockets streaming a
fixture for the consult duration with zero dropped frames, note emitted
within one cycle of each tick, and bounded memory growth.

| Date         | Parallel consults | Duration | Note-at-end p95 | Dropped frames | Notes      |
| ------------ | ----------------- | -------- | --------------- | -------------- | ---------- |
| _yyyy-mm-dd_ | _N_               | _Ns_     | _XX ms_         | _0_            | _baseline_ |

## See also

- `scripts/load-test.ts` — script source.
- `docs/runbooks/high-latency.md` — what to do when p95 drifts.
- `docs/runbooks/dr-postgres-restore.md` — DR procedure.
- `scripts/dr-test.ts` — DR test harness.
