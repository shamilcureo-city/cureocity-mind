# Mind session usage — local receipt implementation

Updated 13 September 2026. The first usable MP08 receipt slice is implemented
locally and remains uncommitted, default-off and unreleased. Migration SQL is
prepared but **not applied**. No provider calls, model/cap changes, merge or
deployment were performed. See the implementation ledger for fresh test evidence.

## Outcome and exact first slice

The implementation adds **one durable record per actual live connection**, plus
a consuming session-estimate reader and optional UI. It reuses session-linked web
`GeminiCallLog` entries. Audit logs are not accounting storage. Gateway reporting
is **Mind/THERAPIST only** in this rollout; Scribe capture remains unchanged.

The first slice provides a **reported session subtotal with explicit coverage**.
It does not establish a complete provider bill: legacy connections, unallocated
client-level calls, hidden provider retries, missing usage and post-erasure
records cannot be reconstructed from the current schema.

## Baseline inspected before this continuation

The legacy mechanisms below still exist for compatibility. New reporting and
canonical readers augment them; they do not rewrite historical clinical records.

| Area                   | Evidence and consequence                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway meter          | [`ConsultMeter`](../services/live-gateway/src/meter.ts) accumulates totals per `LiveSession` instance. It has neither a durable connection ID nor an acknowledged receipt sequence.                                                                                                                                                                                                                 |
| Persistence            | [`live-metric`](../apps/web/app/api/v1/sessions/[id]/live-metric/route.ts) accepts only completed sessions, keeps the first session-unique metric, and mirrors a positive Vertex aggregate as `LIVE_CONSULT_ROLLUP_V1` in `GeminiCallLog`. A later connection cannot replace or add to it.                                                                                                          |
| Browser relay          | [`TherapistLiveSession`](../apps/web/components/app/TherapistLiveSession.tsx) and [`DoctorLiveEncounter`](../apps/web/components/app/DoctorLiveEncounter.tsx), `persistMeter`, mark a one-shot flag before best-effort fetch and do not check the acknowledgement. Closing/reconnecting can lose accounting even when words are preserved.                                                          |
| Attribution            | [`pre-session-brief`](../apps/web/app/api/v1/clients/[id]/pre-session-brief/route.ts), [`therapy-scripts`](../apps/web/app/api/v1/clients/[id]/therapy-scripts/route.ts) and [`case-consult`](../apps/web/app/api/v1/clients/[id]/case-consult/route.ts) create some logs with `sessionId: null` and no `psychologistId`. A reader cannot safely assign these historical calls to a visit or owner. |
| Failure costs          | [`Vertex Flash`](../packages/llm/src/backends/vertex-flash-india.backend.ts) captures response usage before validating output and can return positive cost with `ERROR`. [`transcribe-segment`](../apps/web/lib/transcribe-segment.ts), `markSegmentFailed` / `persistCallLog`, persists those failed-call logs. Usable output and incurred model usage are different facts.                        |
| Cost guard             | [`cost-guard`](../apps/web/lib/cost-guard.ts) previously summed `SUCCESS` only. This batch includes persisted positive `SUCCESS`, `ERROR` and `TIMEOUT` costs; `CIRCUIT_OPEN` is not a provider invocation. Configured caps, model choices and boundary comparisons are unchanged. Missing logs still mean missing evidence, not fabricated usage.                                                  |
| Missing raw provenance | [`GeminiCallLogData`](../packages/llm/src/types/index.ts) retains aggregated input/output tokens, not all modality/cache/thought counts or a provider-attempt ID. Flash retries internally; a returned call log is not a complete physical-attempt ledger.                                                                                                                                          |
| Existing circuits      | [`tenant-spend`](../services/live-gateway/src/tenant-spend.ts) is an in-memory, per-instance safeguard, not durable accounting. Do not silently replace or loosen it.                                                                                                                                                                                                                               |
| Erasure                | [`dpdp-erasure`](../apps/web/lib/dpdp-erasure.ts) deletes session-linked call logs and live metrics under the client lock. Session parents may remain as redacted attestation proof, so a foreign-key cascade alone is insufficient for a new usage table.                                                                                                                                          |

## Implemented additive storage

Migration `20260926001200_session_usage_connections` adds mapped
`SessionUsageConnection` / `session_usage_connections` with:

- A gateway-generated UUID for each **actual socket**, bound to authenticated
  session and tenant ownership. Authorization renewal keeps that connection;
  a new socket gets a new UUID even if a start token was reused.
- Registered/start/end times and lifecycle state: open, final reported, or
  incomplete. An unreported/open connection is not a zero-cost connection.
- Last accepted sequence, canonical payload hash and bounded cumulative fields:
  token counts, call counts and estimated cost/category breakdown. Totals are
  nullable before a receipt; no default zero that asserts missing usage is known.
- Usage basis and coverage reasons, plus available model, region, prompt,
  pricing/configuration versions. Missing details stay explicitly unknown.

The first slice stores the latest acknowledged cumulative receipt per connection,
not a new row for every periodic heartbeat. Use a strict shared contract and
decimal arithmetic. Corrections that would reduce a previously recorded total
need an explicit revision mechanism; do not silently overwrite earlier evidence.
Retention follows the owning session/client record lifecycle, with explicit
erasure in addition to foreign-key cascades. No separate post-erasure ledger,
indefinite billing exception or new automatic TTL is introduced. Reporting holds
only latest cumulative metadata, not an unbounded history of receipt packets.

## Gateway-to-web receipt workflow

1. Register the actual connection through a dedicated internal HTTPS endpoint
   using the established service-auth pattern in
   [`LiveAuthority`](../services/live-gateway/src/live-authority.ts). The gateway
   still has no database connection. Do not piggyback accounting data onto an
   audit log or reinterpret a browser-supplied summary as trusted spend.
2. Send versioned, domain-bound receipts containing only ownership identifiers,
   connection/sequence, cumulative usage, lifecycle and bounded provenance. Use
   service authentication or a domain-separated signature; never send patient
   text, audio, provider error payloads or credentials in the receipt/report.
3. In a short transaction, verify registered ownership and acquire the same
   active-client/session lock used by existing PHI writers. Same sequence and
   hash is an idempotent acknowledgement; a conflicting same-sequence payload
   is refused. Older receipts cannot lower/overwrite the latest one. A delayed
   receipt may update its own connection after the visit ends, but never after
   client erasure and never change clinical session state.
4. Publish a checkpoint after recorded calls, including rejected output. Retry
   a bounded queue with stable sequence/hash, independent of the browser socket
   and independently of clinical-output filtering. A lost browser must not be
   the sole reason already-incurred usage disappears.
5. Emit a final receipt only after all already-started calls settle. A timeout,
   process crash or unfinished finalize tail leaves coverage incomplete. Drain
   pending receipts on normal shutdown within existing shutdown limits, without
   starting new AI calls or blocking clinical recovery indefinitely.

Registration is acknowledged **before model work**. The internal endpoint is
`POST /api/v1/internal/session-usage`, authenticated with `LIVE_GATEWAY_SECRET`.
The gateway derives its fixed path from the configured authority origin, refuses
redirects, and requires HTTPS except development loopback. Bodies are bounded to
32 KiB and parsed through strict, versioned/domain-bound schemas. Dates and UUIDs
are canonicalized before hashing.

If registration fails, `usageUnavailable` stops live startup. Startup PCM is
held only in this tab for an explicit newly authorized retry; it is not falsely
claimed to follow into Record only. Leaving/changing mode requires resolving any
held audio. A failed final microphone drain is not proof that all speech survived.
No clinical text or audio is placed in the receipt queue.

Receipt retries are bounded (three attempts, two-second request deadlines,
250/750 ms backoff), independent of the browser. Same latest sequence/hash is
acknowledged without rewriting; a conflict is refused. Older packets are `STALE`
with no hash claim: latest-only storage cannot prove their previous payload.
Totals/counts never decrease. Final reports are sealed; incomplete reports keep
their original end time and incomplete status while accepting late costs.

## Reader, UI and double-counting rules

`GET /api/v1/sessions/[id]/usage` requires current owner/documentation authority,
uses an active-client lock, session ownership reread and private/no-store responses. The optional
Session details panel exposes subtotal, exclusions, connection coverage and
unreconciled status. Shared integrity validation rejects malformed stored usage.

- For newly tracked sessions, sum the latest accepted receipt **once per
  connection**, plus session-linked web-call leaves. Include persisted positive
  failed-call usage, not only successfully generated clinical content.
- Identify the exact `LIVE_CONSULT_ROLLUP_V1` sentinel as a legacy aggregate;
  never exclude every `PASS_11_REASONING` row because real reasoning calls also
  use that pass. Do not add both parent aggregate and its underlying usage.
- Prefer enabling new accounting for newly started sessions. A legacy-only
  session can display its old partial rollup with an unknown-coverage label.
  If legacy and new records coexist and disjointness cannot be proven, expose
  the ambiguity; do not blindly sum them or silently claim the old connection
  cost is zero. No historical attribution/backfill is implied.
- With ambiguous legacy/new overlap, use **web leaves + max(legacy live
  aggregate, new connection subtotal)**. Label it a lower bound. This avoids
  double-counting and never lowers the old recorded-cost guard baseline.
- Cost guards and console/account dashboards use this same precedence. Existing
  live-metric writers remain unchanged; doctor latency insights label their old
  first-connection estimate explicitly. Monthly connection allocation uses start
  time, not unavailable per-call billing timestamps. Large owner/admin windows
  currently read selected metadata rows; query scalability needs load validation.
- Keep `LiveConsultMetric` as legacy latency telemetry. It is not another
  addend in the new canonical total. Before changing existing writers, migrate
  all affected dashboard/budget readers to an explicit legacy/new precedence
  rule so old rollup mirrors cannot double count or disappear from safeguards.
- Show estimates, not invoices or a per-minute tariff. Hosting, taxes, account
  adjustments and unallocated client activity remain separate. A recorded zero
  with explicit zero usage differs from no receipt or unknown model pricing.

## Follow-on required for genuine whole-session completeness

These changes need integrated design, not an isolated new schema stub:

- Add a stable usage-event/attempt ID and usage basis to the existing call-log
  path, preserving it across persistence retries. Capture provider-reported
  modality/cache/thought categories when available; retain uncertainty where
  response usage or physical retry accounting is absent.
- Use a scoped writer for web calls and their failures. Client-level calls need
  explicit tenant/client ownership, and an optional **validated originating
  session** when the operation really came from a visit. Do not infer attribution
  from whichever visit happens to be latest. Unallocated activity stays separate.
- A cache hit is reuse, not a new provider call. Preserve the original call's
  provenance without charging its generation repeatedly to later visits.
- Reconcile only against authorized, matching provider usage periods/categories
  when that evidence is available. Missing evidence cannot pass reconciliation.
  Erasure means retained application totals may no longer cover a provider's
  historical billing window; do not evade erasure by keeping linked records.

## Verification and release boundaries

The receipt slice includes contract/handler tests, a consuming reader/UI,
and simulated gateway delivery. The regression and staging matrix covers:

- Two connections plus a session-linked web follow-up; every source counted once.
- Duplicate, delayed, out-of-order and conflicting receipts; renewal versus reconnect.
- No final receipt, failed registration and an in-flight finalization tail.
- Positive rejected-output cost, missing usage, known zero, and unknown provenance.
- Legacy/new overlap, cache reuse, and client calls with no valid originating visit.
- Cross-tenant refusal and receipt registration/write racing terminal erasure.

The [`erasure manifest`](../apps/web/lib/dpdp-erasure-manifest.ts), explicit
transaction deletion and sanitized
[`DSR export`](../apps/web/app/api/v1/clients/[id]/dsr/data-export/route.ts) have
been extended together, independent of reporting flags and both verticals.
They omit service credentials, hashes and retry identifiers. Only proven table
absence uses pre-migration fallback; unavailable or malformed storage fails
closed. Routine audits describe receipt writes without clinical/provider payloads.

The additive migration and opt-in PostgreSQL tests are prepared; **the database
tests have not been executed against PostgreSQL and migration is unapplied**.
Applying it requires separate authority. Release the compatible schema/API/web
reader before enabling the separately deployed gateway reporter. Verify the exact
web and gateway revisions and preserve the compatible reader during rollback.
New web registrations/UI use `SESSION_USAGE_RECEIPTS_ENABLED`; Mind gateway
reporting uses `LIVE_USAGE_RECEIPTS_ENABLED`. Both default false. Disable new
gateway reporting first during rollback; keep accepted receipt drain, readers,
export/erasure and schema available. Never drop the table as a source rollback.
The web browser must understand `usageUnavailable` before the gateway emits it.
Already-open tabs retain their old JavaScript bundle. Keep the gateway flag off
until affected Mind live tabs are refreshed/newly opened, ideally with no active
legacy live views; deploying the web build does not upgrade existing tabs.
Do not disable existing clinical authorization, consent, recovery or cost ceilings
to make accounting tests pass. Real-provider reconciliation and production rollout
remain separate, explicitly authorized work.
