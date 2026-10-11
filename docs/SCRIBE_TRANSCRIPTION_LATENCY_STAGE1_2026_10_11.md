# Scribe transcription latency — stage 1

At the initial validation checkpoint, this change was implemented and tested locally,
but not committed, pushed, merged or deployed. Release status must be checked separately.

## Scope

Remove doctor-note and copilot model waits from the ordered transcription pump.
Initially developed on `b270afa`, this isolated release is based on main `255cd5d`
in `codex/scribe-latency-stage1`; it does not include the pending PR #171 package.
It changes only
the DOCTOR runtime path in the shared gateway. Mind's processing behaviour,
microphone capture, audio window sizes, providers, models, regions, consent checks,
billing rules and database schema are unchanged. Provisional streaming stays off
by default; enabling it is a separate stage requiring validation.

## Behaviour

- Pass 1 remains sequential: accepted audio is transcribed once, in order.
- A single doctor worker serializes reasoning and interim notes independently of
  transcription. Pending work coalesces, and existing refresh/debounce limits remain.
- Manual note refresh uses that worker, not the transcription lock.
- Due reasoning is serviced during silent pump ticks without refreshing notes on
  every tick. Newly completed notes trigger deterministic safety checks so draft
  medication warnings do not require another spoken word.
- Reasoning accepts citations only from source IDs available in its request.
  Results from before a clinical-authority loss are discarded even after regrant.
- Pause acknowledgement waits for captured audio, not background notes. No new
  background work starts while paused; already-owned work may complete.
- End joins owned analysis inside the existing deadline, processes the remaining
  source, then generates one final note. Disposal/timeouts invalidate late output.
- Background costs still count toward the ceiling; a crossed reasoning ceiling
  skips another interim note and enters the bounded finalization path.

## Test plan and evidence

Use direct mock backends, synthetic PCM and deferred promises. No microphone,
patient record, production database, real model or external audio upload is used.
The WebSocket integration fixtures run locally.

| Area                   | Test type and acceptance criterion                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slow models            | Deterministic pipeline tests: later ordered utterances appear while an earlier reasoning/note promise remains unresolved.                           |
| Coalescing and refresh | Pipeline tests: reasoning and notes never overlap each other; pending requests retain source and obey throttles.                                    |
| Source integrity       | Pipeline tests: note inputs are immutable snapshots; future citations are rejected; final note receives all captured source including a short tail. |
| Lifecycle              | Fake-clock/deferred tests: pause, disposal, authority revoke/regrant, errors and final timeout do not publish stale results or start new work.      |
| Safety and spend       | Pipeline tests: delayed note medication interactions surface during silence; paid synthetic usage triggers ceilings.                                |
| Compatibility          | Full gateway suite, including existing Mind, authority, pause and completion tests; TypeScript, ESLint and formatting checks.                       |

The isolated release on main `255cd5d` passes **350 tests across 27 gateway files**,
including **16 new Scribe regressions**. Gateway TypeScript, ESLint, package build,
formatting and diff checks also pass, using the installed Node.js 24.19.0 runtime.
The fresh checkout's contracts, clinical and LLM packages were built before running
the checks. WebSocket fixtures bind only locally; no external services are exercised.

The original development base passed 378 tests across 28 files; that larger branch
includes changes deliberately excluded from this release. Current main's
asynchronous completion fixtures and therapist finalization regressions are
preserved unchanged. The former doctor-blocking comparison test now asserts the
intended nonblocking behaviour.

## Remaining validation and release boundary

This proves pipeline scheduling and lifecycle behaviour, not real speech-to-display
latency or clinical transcription accuracy. The existing 2.5–6 second doctor audio
window and provider/network latency remain. This is not word-by-word streaming.

Before release, test the exact gateway build in a controlled environment using
consented or fictional speech, including mixed Malayalam/English, silence and a
long consultation. Compare speech-to-transcript p50/p95, ordered source retention,
note coverage and cost against the prior build. Deploying the web app alone cannot
ship this gateway fix. Production release and any pending branch release need
separate authorization and compatibility checks.
