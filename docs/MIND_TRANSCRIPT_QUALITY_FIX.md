# Mind transcript quality and cost-estimate correction

## Scope

Fixes the September 12 placeholder transcript and lost saved speaker turns. This
is a local implementation, not proof of a production release, a corrected
historical clinical record, or model accuracy with real speech.

- Removed internal development/sign-off footers from runtime prompts, advancing
  affected prompt audit versions without claiming clinical approval.
- Rejects recognizable generated transcription artifacts before authoritative
  speech, note storage, signing or downstream clinical analysis. The detector is
  deliberately narrow; it is not a general hallucination detector.
- Applies the ordinary silence/speech-fraction gate to bounded End windows,
  preserving short actual speech. Rejected windows produce a review warning,
  never invented substitute words, and still count recorded provider usage.
- Keeps finalized speaker roles, timestamps and quality warnings through save
  and recovery. Old unlabelled transcripts render as readable paragraphs; no
  historical speaker labels are invented and no stored text is silently erased.
- Known-contaminated Mind source transcripts block signing even if the generated
  note appears clean. Recover from original audio if available, or create a new
  clinician-written session note. Existing signed records are not rewritten.
- Cost is an estimate for one connection, broken down into transcription,
  note-writing and live suggestions. It is not an invoice or a per-minute tariff.

## Cost assumptions

The estimator uses provider usage when available, separate text/audio input
rates, output plus thinking tokens, cache discounts and recognized Gemini 2.5
model prices. Unknown models retain a fallback estimate; missing usage and
ambiguous transport failures cannot establish an invoice amount. The conversion
assumption remains INR 83 per USD, not a current foreign-exchange quote.

Hosting, other connections, follow-up web AI passes, taxes and account-specific
billing terms are not included. Changed accounting can increase or decrease a
displayed estimate. The existing cost ceiling remains unchanged and can be
reached sooner now that thinking tokens are counted. No model-quality reduction
or reasoning/refresh cadence change is included.

Primary references checked during implementation:

- [Vertex pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)
- [Vertex usage metadata](https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/GenerateContentResponse)

## Storage and rollout boundaries

New Mind live/recovery saves put a versioned `cureocity-transcript-v1` envelope
(transcript, speaker segments, warning) inside the existing encrypted transcript
column. New readers also accept historical encrypted plain transcript text.
No migration or backfill is required. New live speaker texts are not copied to
the legacy plaintext JSON column. Batch-only storage outside this fix is
unchanged.

Both `apps/web` and the separately deployed `services/live-gateway` need release.
A Vercel-only release does not update the gateway's prompt or silence behavior.
Deploy the compatible web reader/UI before the updated gateway. Old clients
remain accepted but their invalid artifact payloads are rejected.

Rollback must retain the new transcript decoder: after new envelopes have been
saved, rolling web back to a pre-fix reader would show or process serialized JSON
as transcript text. Backport the compatible reader to any web rollback target;
do not discard/decrypt-overwrite ciphertext to make rollback easier. A gateway
rollback alone leaves web reader compatibility intact but restores the old
transcription defect, so pause live use if that becomes necessary.

## Verification and remaining release checks

Final local verification on September 12: web 1,858 passed (29 PostgreSQL-dependent
checks skipped), contracts 394 passed, LLM 193 passed, gateway 296 passed. Contracts
and LLM builds, web/gateway type checks, changed-TypeScript lint and formatting
checks passed. Gateway socket tests passed with local socket access after the
sandbox initially prevented their fake server from listening. Desktop browser
inspection confirmed actual component rendering, legacy disclosure and quality
warning using the fictional preview; this was not an authenticated live session.

Unit/route regressions cover exact screenshot artifact strings; ordinary uses
of placeholder and names; Malayalam/code-mixed text; silent/short End, Pause and
reconnect; output gaps; encrypted conversation round-trips; legacy rendering;
signing and clinical-source guards; and provider usage/failure accounting.
The local-only `/dev/transcript-quality` preview uses fictional data and no
microphone, database or model calls. It is unavailable in production.

Before release: run tests/type checks, inspect the exact release diff, and obtain
release approval. After releasing web and gateway, verify actual microphone
speech, silence, Pause/Resume/End, saved speaker turns and warning behavior using
a fictional consented session. Record the model/revision and usage categories;
compare them with Google billing separately. Do not promise a latency, per-minute
price or clinical-accuracy result from synthetic checks.
