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

## See also

- `scripts/load-test.ts` — script source.
- `docs/runbooks/high-latency.md` — what to do when p95 drifts.
- `docs/runbooks/dr-postgres-restore.md` — DR procedure.
- `scripts/dr-test.ts` — DR test harness.
