# Mind visual workspace

Approved design implementation, 12 October 2026. Scope: Today, client overview and session preparation. This is a presentation change; it does not enable the new server encryption format, change the schema, or change AI providers.

## Visual plan

- Palette: paper `#f8f8f4`, ink `#302b45`, purple `#6753ad`, lilac `#eae5f4`, sage surface `#edf2ec`, sage ink `#476752`. Existing semantic warning colours remain authoritative.
- Type: existing Fraunces for headings and Inter for clinical text. Readable sentence-case labels, no invented health scores or clinical achievement badges.
- Layout: left-aligned content; a next-appointment scene and agenda on Today, care continuity and dated comparisons on the client overview, saved focus then context and setup on preparation.
- Review against the approved design: preserve its original consultation-room illustration and calm hierarchy, but replace every sample name, time, count, score and narrative with existing records or honest missing-data states. Read-only context must not look like newly assessed progress.

```text
Today                  Client overview            Preparation
next visit + room      identity + real actions    exact visit + focus
agenda | unfinished    continuity | check-ins     recap | carry | agenda
recovery remains       history | recorded goals   consent + setup
```

## Boundaries

The existing Mind-only authenticated routes and outer `mind-workspace-shell` remain the authority. The three screens opt into `mind-visual-workspace`; the new palette cannot apply to the doctor workspace. Reuse existing UI primitives and business functions. Preserve crisis banners, recovery priority, demo labels, consent, microphone readiness, note signing, explicit preparation saving and pending/dirty guards.

The preparation scan is a read-only view of the existing prepare response. A stale brief is labelled as such and is not promoted to a current agenda. The existing generation action remains explicit. Guide selection uses the existing prepared-guide list and does not generate or confirm treatment. Manual, live, record-only, dictation and upload paths stay separate.

## Validation approach

Regression suites exercise existing preparation state and navigation contracts, plus rendered empty/stale presentation. A development-only fictional harness at `/dev/mind-visual-design` renders the real components with memory-only request fixtures. Its browser check denies real API traffic and media access. Local rendering, type checks and tests do not establish production, clinical or real-device readiness. No migration, push, merge or deployment is part of this implementation request.

## Verified local checks

- Full web suite: 385 test files passed; 4,204 tests passed, 75 skipped, zero failures.
- TypeScript: `tsc --noEmit --incremental false` passed.
- ESLint: changed application and test TypeScript files passed with zero warnings.
- Production build: `next build` passed, including lint, types, static pages and route generation. The first attempt exceeded the local default JavaScript heap; retrying with a process-only 6 GB heap succeeded, without an application configuration change.
- Final targeted regression rerun after copy/fixture cleanup: 65 tests passed.
- Browser: Today, client overview and preparation at 1440, 900, 390 and 320 pixels; no horizontal overflow or runtime errors.
- Connected navigation preserved the exact booked visit from Today to client overview to preparation.
- Manual start was enabled before edits, disabled for dirty and pending preparation, and the memory-only save received acknowledgement.
- Browser isolation: no real API requests, microphone/display requests or local/session storage writes.
- Local production-mode check: `/dev/mind-visual-design` returned HTTP 404 even with the preview flag set, confirming that the fictional harness is development-only.

The harness renders the production presentation components but replaces transport and some peripheral actions with clearly labelled fictional fixtures. Authenticated production, consent updates, signing, real-device recording, cross-browser behaviour and clinical usability still require their own checks. Existing safety/recovery/empty-state regressions are retained; the calmer presentation does not establish clinical readiness.
