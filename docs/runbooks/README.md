# Cureocity Mind — operational runbooks

One file per Prometheus alert rule in
`infrastructure/prometheus/alerts/cureocity-alerts.yml`. Each runbook
follows the same shape so an on-call engineer (or clinician for the
clinical alerts) can act inside the first 10 minutes without context.

Pages page the on-call rotation immediately; tickets file into the
next-business-day queue. Both still demand a runbook.

| Alert                 | Severity | Runbook                                              |
| --------------------- | -------- | ---------------------------------------------------- |
| CrisisFlagRaised      | page     | [crisis-flag-raised.md](./crisis-flag-raised.md)     |
| CostCircuitTripped    | page     | [cost-circuit-tripped.md](./cost-circuit-tripped.md) |
| HighHttpErrorRate     | page     | [high-http-error-rate.md](./high-http-error-rate.md) |
| HighRequestLatencyP95 | ticket   | [high-latency.md](./high-latency.md)                 |
| GeminiCallTimeouts    | ticket   | [gemini-timeouts.md](./gemini-timeouts.md)           |
| AuditWritesStalled    | ticket   | [audit-writes-stalled.md](./audit-writes-stalled.md) |

There's also a non-alert runbook for the disaster-recovery procedure:
[dr-postgres-restore.md](./dr-postgres-restore.md). It's exercised as
part of the Sprint 10 DR test (PR 3).

## Doctor-vertical pilot

[doctor-pilot-onboarding.md](./doctor-pilot-onboarding.md) — the
operational checklist for onboarding the first super-specialty OPD clinic
to the doctor vertical (DV1–DV8): account provisioning, the clinical-loop
smoke, the safety-rail verification, and the env-gated ABDM / billing
steps still pending procurement.

## Go-live walkthrough

[go-live.md](./go-live.md) — sequenced, one-time setup that takes the
codebase from the current state (mock backends, auth bypass, no
payments) to real money + real patients. Covers every env var and
provider step the Sprint 56 features (pricing ladder, upsell modal,
renewal reminders, dunning, watermark, GST invoice, referral, etc.)
need to function in production. Estimated 3–5 hours of clicking plus
1–3 days waiting on WhatsApp template approval.
