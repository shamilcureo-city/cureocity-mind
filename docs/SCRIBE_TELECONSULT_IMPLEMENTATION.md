# Scribe teleconsultation: local first milestone

## Scope and product boundary

Scribe gets a doctor-owned video encounter and patient join page. Mind keeps its therapist routes,
workspace, prompts and clinical outputs. The shared LiveKit room component remains backwards
compatible; the new two-sided mixer and capture adapter do not stop call-owned tracks when
documentation pauses.

```text
Scribe encounter → patient invitation → built-in video call
                                       ↓ explicit patient + doctor consent
                              two-sided audio → existing live gateway
                                       ↓
                         medical draft → capture review → sign
```

Joining video does not start AI capture. The patient can decline AI documentation. The doctor
starts documentation explicitly, can pause independently of the call, and reviews the note in
Scribe. Finishing the note does not by itself end the video discussion. Coding, expanded document
generation and doctor template generation are later milestones, not delivered by this change.

## Entry points

- Doctor: `/app/patients/[id]/encounters/[sessionId]/teleconsult`, linked from the encounter page.
- Patient: `/p/scribe/teleconsult/[id]#token=...`; the private grant stays out of request URLs.
- Fictional layout preview: `/dev/scribe-teleconsult`, development only with
  `SCRIBE_WORKSPACE_PREVIEW=true`. It opens no media devices and performs no clinical API calls.

## Capture and consent boundaries

- Server-owned doctor, patient, encounter and product binding; no access inferred from branding.
- Separate patient opt-in/withdrawal and doctor acknowledgement of audio/AI/cross-border processing.
- Expiring, replaceable, revocable patient links. Missing signing configuration fails closed.
- Both local and remote microphones must be available; there is no silent microphone-only fallback.
- A lost/muted source or revoked consent stops capture; recovery requires an explicit resume.
- Preparation, active documentation and completion have distinct states. The clinical capture keeps
  its authority while already-sent audio drains; a local send buffer alone is not a gateway ACK.
- Gateway authorization distinguishes new input from processing already-captured input, preventing
  a paused socket from continuing to send new audio under output-only permission.
- A confirmed video-capture pause stops token renewal. Resume obtains fresh consent authority and
  replays retained transcript; ending after the paused lease expires preserves an explicitly
  incomplete draft for review rather than claiming finalization succeeded.
- Interrupted capture uses the existing incomplete-note review/sign gate. Conflicts are not reported
  as successful saves. Navigation remains protected until a final draft is confirmed saved.
- Closing/replacing a call requests LiveKit room deletion. Failure is reported rather than described
  as a confirmed disconnect. Already-issued room tokens have a short lifetime; a database revocation
  is not cryptographic cancellation of a token already issued by LiveKit.

## Storage and rollout prerequisites

The feature is disabled by default. No environment setting, deployed service or database is changed
by adding this code. It needs:

1. The existing `20260928000000_scribe_doctor_workflow` workspace migration, then the additive
   `20260929000000_scribe_teleconsult` constraint/index migration. Neither was applied in this task.
2. LiveKit URL/API credentials and a separately generated strong `SCRIBE_TELECONSULT_LINK_SECRET`.
3. The matching web/contracts **and live-gateway** versions, with input/output authority support.
   Web deployment alone does not deliver the new gateway check.
4. `SCRIBE_TELECONSULT_ENABLED=true` only in an explicitly selected validation environment first.

Encrypted teleconsult records reuse the existing workspace export/erasure lifecycle. Invitations
store no raw token in that record. No separate database, account migration, cross-product patient
sharing or infrastructure split is introduced.

## Verification boundary

Automated checks cover owned media cleanup, two-sided mixing, late/replaced/muted tracks,
reconnection, explicit capture, consent freshness/withdrawal, link binding, permissions, save
conflicts and Mind compatibility. Desktop/mobile layout review uses a fictional device-free preview.

Still required before enabling for clinical use: apply/test migrations in a disposable database;
authenticated two-device LiveKit calls; headphones and browser/OS combinations; microphone loss,
mute/rejoin, network interruption, consent withdrawal while streaming, final tail completeness,
saved-note/review/sign behavior, and qualified clinical/consent-copy review. Automated tests and
a rendered preview do not establish clinical readiness.

### Local verification, 26 September 2026

Using the bundled Node 24.19.0 runtime:

- Web: 310 test files, 2,858 tests passed; 44 opt-in PostgreSQL integration tests skipped.
- Live gateway: 26 test files, 331 tests passed with local synthetic WebSocket listeners.
- Shared contracts: 40 test files, 516 tests passed.
- Web, gateway and contracts TypeScript checks passed; scoped feature TypeScript/TSX lint passed.
- Migration static/replay-convention checks passed (21 script tests); no database migration ran.
- `git diff --check` and Next configuration syntax check passed.

An additional ESLint invocation on the CommonJS `next.config.js` reports existing global/import
rule mismatches; that file is outside the repository's normal web lint target. Its new route
headers were inspected and its JavaScript syntax checked. No production build, deployment or
authenticated real-device capture was performed.

External Zoom/Meet/tab/system-audio capture is not part of this milestone.
