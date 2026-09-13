# Mind sprint implementation ledger

13 September 2026. This tracks implementation against [the product sprint plan](MIND_PRODUCT_EXCELLENCE_SPRINT_PLAN.md). The owner has now requested deployment; [release preflight](MIND_2026_09_13_RELEASE_CHECKLIST.md) tracks the exact publication, migration and runtime gates. The earlier sections below describe their implementation-time boundaries, not a claim that deployment has occurred. **The programme is not complete.**

## Baseline and boundaries

- Working branch: `codex/mind-counselling-workflow`, committed HEAD `561888581257c61f6a22f0e584a9d87efd7a45ad`.
- Read-only GitHub check: remote main `8af631f8c7ae3b368f967660fddd4ebac9f6be64`. Comparing that commit's source tree with HEAD produced no differences. This does not include the substantial uncommitted changes.
- The existing [transcript/cost candidate](MIND_TRANSCRIPT_QUALITY_FIX.md) was preserved and extended, not treated as released. The older Mind/Scribe delivery document is untouched.
- No commits, pushes, merges, database migration applications, web/gateway deployments, real-client edits, recording or paid provider calls were performed for this implementation batch.
- Active production revisions, gateway traffic and deployed flags have not been revalidated for this batch. Do not infer them from GitHub or the fictional preview.

## Engineering delivered in this batch

| Plan ticket     | Local result                                                                                                                                                                                                                                                                      | What is not established                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MP00-2          | Initial note page, refreshed draft and dedicated transcript use one source-view mapping. Encrypted turns retain role/time/warning data; unreadable ciphertext cannot fall back to stale plaintext turns.                                                                          | Historical records have not been repaired; runtime encryption and real transcription quality need separate checks.                                       |
| MP00-3          | New EMDR workflows start at history taking in both API and UI. Shared prerequisite gates, strict boolean flags, active-client row lock, late-erasure/ownership checks and duplicate-start protection. Existing workflows remain readable with incomplete-record notices.          | Recorded flags do not certify clinical readiness. No approved prior-care entry shortcut or new EMDR policy.                                              |
| MP00-4 / MP02-4 | Capture copy distinguishes live text-only capture from recorded/uploaded audio, and describes configured retention without promising universal 30-day replay.                                                                                                                     | The whole capture state machine and supported physical devices are not revalidated by a copy change.                                                     |
| MP01-1          | Real PCM-WAV Pass-1 adapter and Mind evaluation command, explicit provider-call opt-in, held-out/per-language gates, safe unavailable/failure exits and provenance.                                                                                                               | No approved actor corpus or paid run. Mocked/injected success is never a release pass. Batch audio is not live-browser timing.                           |
| MP01-3          | Stronger deterministic note regression checks: required sections/kind, both directions of annotated risk, empty evidence, critical/forbidden literal claims and distinct reference-vs-ASR inputs.                                                                                 | Literal checks are not semantic factual precision, adjudicated claim recall or clinical judgment.                                                        |
| MP02-2          | Manual notes checkpoint to the existing encrypted server API after a bounded typing interval. Only acknowledgements show saved; ambiguous retries retain mutation IDs, conflicts preserve text, finish drains latest changes, signing stays explicit.                             | No new browser clinical storage. Real-browser multi-tab/device interruption tests remain.                                                                |
| MP03-4 / MP04-1 | Optional source comparison from normal unsigned note review; transcript panel is keyboard-scrollable and reflows at narrow width. Derived mindmap is collapsed and labelled separately from transcript evidence. Comparison controls/source pane are excluded from note printing. | Not a full accessibility audit, observed usability study, exact quote-to-note attribution or controlled AI edit-diff implementation.                     |
| MP06-1          | One typed source for the ten existing guide choices, labelled approach/technique/protocol stage, AI-draft status and EMDR training notice; existing names and generation/cache identity preserved.                                                                                | This reconciles guide-choice display only, not every exercise/tracker registry. No new reviewed therapy protocol, source licence or approved adaptation. |

Additional bounded results:

- **MP00 / MP03 start-boundary hardening:** session creation, exact/generic booking reuse and follow-up receipts recheck active ownership under the existing Client-then-Session locking order. Dependent session/episode writes cannot occur after an erasure that wins the lock. Existing consent/capture actions, scheduling, Scribe tokens and billing gates are preserved. Tests simulate races using the real locking helper with mocked database responses; they do not prove a live PostgreSQL race.
- **MP00 source edge case:** malformed empty ciphertext is treated as unreadable, not an absent transcript, in display and the locked signing boundary. It cannot unlock a stale plaintext fallback or a source-check bypass.
- **MP07-1 / MP07-3:** recorded and manual closeout reuse one collapsed form for clinician-confirmed work and optional client response. Preparation displays the source visit, IST date and saved version. No guide click, note, homework or AI action is substituted for confirmation. The section is encrypted, versioned and covered by existing export/erasure. Render-time identity guards prevent a prior client's work flashing under a different client; unresolved drafts/receipts remain bound to their original client and visit. See [scope and compatibility](MIND_SESSION_WORK_CONTINUITY.md). This is **one current work entry plus version history**, not the complete intervention timeline, guide-version linkage or reviewed note insertion.
- **MP08-2:** saved-note processing details now label the amount as a partial AI estimate, not a whole-session bill or per-minute tariff. Missing/zero legacy values do not claim free processing. Speaker-turn counts are no longer labelled audio segments.
- **MP08 accounting hardening:** existing session/month cost guards include positive persisted ERROR/TIMEOUT usage as well as SUCCESS. CIRCUIT_OPEN and nonpositive values are excluded. Existing ceilings, models and tenant/month scopes are unchanged; genuinely recorded costs can reach the same ceiling sooner. This does not supply missing usage or fix complete attribution. Shared Scribe accounting receives the same correction.

Both storage slices, [session-bound preparation](MIND_SESSION_PREPARATION_IMPLEMENTATION.md) and [whole-session usage receipts](MIND_SESSION_USAGE_IMPLEMENTATION.md), are now implemented locally in the continuations below. Neither is released. The release checklist records the subsequent isolated database verification separately from these original implementation results.

## Continuation: MP03-2 exact-visit preparation

Implemented 13 September 2026, on the same uncommitted branch. This is the next
bounded engineering slice, not completion of all ten programme packages.

- Optional clinician-written focus, explicitly confirmed with **Use for this visit**.
  Today supplies the exact booking; walk-ins can select/create the canonical visit
  before preparing, then separately start. Preparation selection does not commit
  a manual documentation mode or start recording, consent, a note or AI.
- The acknowledged visit ID survives retries. If creation might have succeeded
  without a usable reply, the UI asks the clinician to choose it from Today and
  blocks a blind repeat. Request time is captured on first selection, not when a
  preflight page was opened before midnight.
- Encrypted immutable revision history includes explicit clears. Writes validate
  expected client, session, revision and appointment time, and serialize with
  start/erasure under Client-then-Session locks. A saved visit cannot be reassigned
  to a different client or owner after preparation exists.
- Lost-save replies retain an exact retry packet and block Start/visit changes.
  Save conflicts preserve unsaved wording. Today reschedule/no-show requires
  saving or discarding edits; rescheduled focus remains labelled with its original
  appointment time until explicitly re-adopted.
- Existing device scratch is neither imported nor deleted. It is hidden when the
  new feature is enabled. No preparation text is inserted into a clinical note,
  transcript, consent snapshot or live AI context.
- Manual, normal and live session pages can read the same preparation. All
  revisions are included in authorized export and erasure even with editing off.
  Only proven absence of the pre-migration table is skipped; other storage or
  decryption errors fail closed.
- The additive migration is `20260926001100_mind_session_preparation`.
  `MIND_SESSION_PREPARATION_ENABLED` defaults to false and must remain off until
  migration/runtime checks are approved and verified. The compatible reader,
  privacy handling and new schema must be retained in rollback after data exists.

### Fresh continuation verification

| Check                                                             | Result                                  |
| ----------------------------------------------------------------- | --------------------------------------- |
| Full web suite                                                    | 246 files; **2,138 passed, 32 skipped** |
| Full contracts suite                                              | 36 files; **430 passed**                |
| Contracts / clinical / AI / gateway / web typechecks              | All five passed                         |
| Scoped lint, formatting and whitespace                            | Passed                                  |
| Prisma format, validate, generate; migration static safety checks | Passed; no database migration applied   |

The initial integration runs caught a route-policy inventory shape mismatch and
a non-audit `SAVE` literal in the audit coverage scanner. The inventory and
documented non-audit literals were corrected without relaxing route authorization
or adding a fake audit event. Final complete runs above passed.

The **2,568 passing tests** are combined web/contracts counts, not new-test counts
or clinical accuracy. The prior clinical/AI/gateway full-suite results below
belong to the earlier batch; only their typechecks were rerun for this continuation.
The 32 skipped tests include eight opt-in counselling PostgreSQL tests (three
new preparation persistence/constraint/concurrency cases), fifteen appointment
reminder tests and nine consent recovery tests. Docker's local runtime check was
unavailable/hung and was stopped; no container or configured database was changed.

Browser verification used `/dev/session-preparation`, restricted to development
with `MIND_WORKSPACE_PREVIEW=true`. Its explicitly injected transport stores only
fictional records in memory; it does not call the real API, database, microphone
or provider. Verified typing does not save, explicit acknowledgement, independent
same-day visits, original focus on reopening the first visit, lost-response draft
retention and Start/visit-switch blocking, successful same-save retry, read-only
state after fictional start, and 360px layout with visible keyboard focus. The
viewport was restored. Reloading this fixture resets its fictional records.

Still required before enabling: apply/replay the migration in isolated staging,
run real PostgreSQL race/export/erasure tests, verify authenticated reload and KMS,
exercise the complete manual/live start journey against a real test backend,
review deployment/rollback compatibility and approve release. A fictional preview
does not establish these. **No commit, push, merge, deployment or migration apply
was performed.** Next engineering slice: durable whole-session usage receipts.

## Continuation — MP08 durable connection receipts and session estimates

Implemented locally on 13 September 2026. This is a usable reported-cost slice,
**not complete provider billing or completion of all product sprints**.

- Mind registers each actual socket durably before model work. Token renewal
  keeps that ID; reconnects receive new IDs. The standalone gateway has no direct
  database access and reports bounded metadata through a service-authenticated
  fixed-origin endpoint.
- The latest cumulative receipt is counted once. Exact retries are acknowledged,
  conflicts and lower totals refused. Older packets are explicitly stale, not
  falsely hash-verified. Interrupted/time-out receipts stay incomplete even when
  an already-started call later supplies additional cost. No new AI is started
  just to complete accounting.
- Registration failure stops live startup and offers explicit retry/recovery.
  Untranscribed startup audio remains memory-only in the current tab. Mode changes
  and leaving must resolve that held audio; no automatic upload, discard or
  transcript/note generation is introduced.
- The optional **AI processing estimate** disclosure sits in Session details.
  It labels missing records, recorded zero, incomplete connections and old/new
  overlap. No prominent session UI, subscription charge, invoice or per-minute
  price is inferred from these amounts.
- Positive persisted SUCCESS/ERROR/TIMEOUT web calls are included. Exact legacy
  `LIVE_CONSULT_ROLLUP_V1` is handled as an aggregate, not an ordinary reasoning
  call. Ambiguous overlap uses web leaves + max(legacy live, new live) as an
  explicitly incomplete lower bound. Cost guards and cost dashboards use this
  same rule; configured ceilings, models and in-memory gateway caps are unchanged.
- Export/erasure cover the new patient-linked records even with reporting off.
  Missing table fallback requires proven absence; malformed or inaccessible
  storage fails closed. No historical backfill or clinical record rewrite occurs.
- Migration `20260926001200_session_usage_connections` is prepared and unapplied.
  Both `SESSION_USAGE_RECEIPTS_ENABLED` (web) and `LIVE_USAGE_RECEIPTS_ENABLED`
  (gateway) default false. The gateway flag is Mind-only; Scribe capture is unchanged.

### MP08 verification and limits

Final integrated web verification after the startup-tail review fix:

| Check                                                | Result                                               |
| ---------------------------------------------------- | ---------------------------------------------------- |
| Full web suite                                       | 255 files; **2,236 passed, 36 skipped**              |
| Full contracts suite                                 | 38 files; **455 passed**                             |
| Full live gateway suite                              | 25 files; **318 passed**                             |
| Contracts / clinical / AI / gateway / web typechecks | All five passed; web repeated after the recovery fix |
| Scoped ESLint, formatting and whitespace             | Passed                                               |
| Prisma validate/generate and migration static checks | Passed; no migration applied                         |

These are **3,009 passing automated tests across web/contracts/gateway**, not
3,009 new tests or a clinical accuracy result. Gateway build also passed. The
full gateway run needed permission to bind its existing fictional local
WebSocket test server; no external provider or microphone was used. Clinical/AI
full-suite results elsewhere in this ledger are historical; their typechecks
were rerun for this continuation. Production web build/runtime and authenticated
database/provider checks remain unverified.

Fictional browser checks passed at desktop and 360px widths, including visible
keyboard focus, keyboard expansion and distinct missing/zero/overlap wording.
The temporary viewport was restored. `/dev/session-usage` is development-gated
and uses fictional values without API/database, microphone or provider calls.
The preview proves layout/disclosure behavior, not authenticated persistence.

The initial full web run passed 2,222 tests with 36 skips. Independent review
then identified the worklet shutdown-tail recovery edge case. The final run adds
tail-drain, duplicate-close, cleanup timeout, full buffer, explicit retry/discard,
and consent-recovery visibility coverage. These use fictional frames/hook event
harnesses, not a live physical microphone. The 36 skipped cases include four new
isolated PostgreSQL usage tests alongside the earlier 32 opt-in database cases;
skipped means unverified, not passed.

Before enabling: run the opt-in PostgreSQL constraints/concurrency/export/erasure
tests against isolated staging, verify authenticated same-visit reads across
actual gateway reconnects, test outage/recovery on a real authorized device,
and approve the exact web/schema/gateway rollout and compatible rollback.
Deploy compatible schema/API/browser handling before enabling the gateway flag.
Refresh affected live tabs before enabling: existing tabs retain old event handling.
Keep receipt drain/readers/privacy handling during rollback after records exist.
**No commit, push, merge, deployment, database apply or paid provider call occurred.**

Further engineering remains: physical-attempt usage/provenance, validated
originating-session attribution for client-level calls, provider reconciliation,
large-window query load checks and quality-gated cost optimization. Historical
unallocated calls and hidden retries cannot be reconstructed as complete bills.
See [implementation and release sequence](MIND_SESSION_USAGE_IMPLEMENTATION.md).

## Verification evidence — earlier batch

### Local browser

`/dev/transcript-quality` is development-only and requires `MIND_WORKSPACE_PREVIEW=true`. It uses fictional text, not client data, microphone access, credentials or paid AI.

- Opened and closed the real comparison component; observed correct disclosure state and speaker/time/source text.
- Inspected the desktop layout and 360px-wide reflow.
- Used keyboard Tab then End to reach and scroll the labelled transcript region to its last turn; visible focus was retained.
- Restored the browser viewport override after verification.
- Opened the saved-note processing disclosure and verified the visible partial-estimate, missing-usage and no-tariff wording using fictional amounts.
- This does not test authenticated session loading, real network-loss recovery, browser printing, 200% zoom, assistive technology or a clinician's ability to complete the whole journey unaided.

### Automated checks

Unit/route mocks, isolated database integration and real runtime checks must not be combined into one unqualified claim. Fresh package runs:

| Suite           | Result                                               |
| --------------- | ---------------------------------------------------- |
| Contracts       | 35 files, 400 tests passed                           |
| Clinical logic  | 24 files, 301 tests passed                           |
| AI package      | 22 files, 226 tests passed                           |
| Live gateway    | 23 files, 296 tests passed                           |
| Web application | 239 files, 2,010 tests passed; 29 explicitly skipped |

The first sandboxed gateway attempt failed five fake-WebSocket tests because the local server could not bind (`EPERM`). The complete suite passed when rerun with authorized local test-server permission; no production provider was used.

The first integrated web run exposed two old manual-note button-label assertions. They were updated to verify editable fields and explicit Finish/sign boundaries, with an added reopen → type → acknowledged autosave → Finish → Sign handler test. The final complete web run passed. The 29 opt-in database-backed tests remain skipped, not passed.

**Total: 3,233 automated tests passed, 29 skipped** across the five suites. All five package typechecks passed; web typecheck was repeated after the last source/signing changes. Scoped ESLint, formatting and whitespace checks passed. The package counts are not new-test counts and are not clinical accuracy measurements. Production web build/image, live database concurrency, real auth/KMS/audio and deployment checks were not performed.

## Remaining programme work

| Package | Remaining work and release gate                                                                                                                                                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MP00    | Final integrated candidate review, current web/gateway/flags, compatible reader/writer rollout and rollback evidence.                                                                                                                                                                     |
| MP01    | Authorized 40-case actor corpus, held-out discipline, language/clinical annotations, semantic claim adjudication, paired real ASR-to-note study and actual effort/latency baseline.                                                                                                       |
| MP02    | Full live/batch/manual interruption matrix, long-session renewal/recovery and authorized device/microphone checks.                                                                                                                                                                        |
| MP03    | Session-bound preparation is local and feature-gated; isolated database/authenticated rollout checks remain. Optional explicit legacy scratch adoption, remaining navigation/quiet-guided refinements and observed usability/accessibility work remain.                                   |
| MP04    | Source/history/clinician-addition attribution, reviewed proposed edits, unified optional agreement/homework/booking closeout with partial-failure proof.                                                                                                                                  |
| MP05    | Grounded evidence/uncertainty, versioned permitted terminology checks, explainable next-action fidelity and governed instrument metadata.                                                                                                                                                 |
| MP06    | Immutable reviewed content versions, permissions/rights, qualified reviewer, one scoped complete pathway and separately labelled adaptations.                                                                                                                                             |
| MP07    | Verified session-bound actual-work/response continuity; guide-version linkage, reviewed insertion into notes and the multi-visit scenario matrix.                                                                                                                                         |
| MP08    | Connection receipts and reported-subtotal UI are local/default-off; isolated DB/runtime release checks remain. Physical-attempt provenance, originating-session attribution, provider reconciliation, large-window query validation and quality-gated optimization are still outstanding. |
| MP09    | Observed fictional journeys, real device/access/encryption checks, clinical pilot approval, stop criteria and release decision.                                                                                                                                                           |

These are real outstanding tickets, not all blocked on clinical review: further engineering remains. Clinical content publication, real-audio validation and release require the separate decisions/evidence below.

## External decisions and safe continuation

1. Name a qualified psychologist to review the first pathway, note rubric and fictional cases; advanced EMDR entry needs appropriately qualified review. Generic engineering can continue meanwhile.
2. Approve the recording corpus, actor participation, protected storage/retention, language reviewers and provider processing/spend before real audio/model runs.
3. Confirm rights and exact editions before publishing scored instruments or protocol content. AI drafts cannot supply this approval.
4. Review the exact production candidate and web/gateway/flags before merge/deploy. No database apply or production smoke is implied by this ledger.

## Compatibility notes

- Keep the encrypted transcript-envelope reader in every rollback target once any new-format transcript has been saved. Rolling back only to an old reader can render serialized data as transcript text.
- Clinical records are not silently backfilled or rewritten. Signing, sharing, booking and clinical decisions remain explicit actions.
- Additive encrypted JSON/schema changes need old/new decoder, export, erasure and rollback evidence. A source-code rollback is not a data rollback.
- The new care-record `sessionWork` section also requires the additive decoder and omission-preservation logic in any rollback reader after new records exist. The initial batch needed no SQL migration; the MP03-2 continuation adds the separately gated preparation migration above.
