# Mind evaluation foundation (MP01)

This is an offline-tested engineering harness, not evidence that Mind transcribes
accurately or produces clinically adequate notes. No recordings, provider calls,
clinical review, release, or model switch are authorized by installing it.

## Offline checks

`pnpm --filter @cureocity/llm exec vitest run src/evals` exercises injected
backends and tiny synthetic WAV buffers. No microphone, credentials, or paid
provider is used. `pnpm --filter @cureocity/llm eval:mind` without the opt-in
returns `NOT_EVALUATED` and exit 2, not a mock quality pass.

Scribe's `eval:asr` drug-name policy is unchanged. Its real WAV path now uses the
DOCTOR persona and additionally requires `ASR_ALLOW_PROVIDER_CALLS=true`.
Mind explicitly uses THERAPIST; it does not reuse a prescription threshold.

## Preparing a separately authorized real run

Before any real call, obtain authorization for the corpus, processing region,
provider spend, data handling, and reviewers. Use opaque fixture IDs, not names.
Keep the manifest, reference text, annotations, recordings, and detailed failed
examples in approved protected evaluation storage outside Git and ordinary logs.
The data custodian must define access, retention/deletion, and withdrawal handling.
The two approval IDs in the manifest are traceability references, not automated
verification that consent, rights, or clinical review have happened.

The strict `MindAudioManifestSchema` in `manifest.ts` specifies metadata, a
development/held-out split, per-language minimum sample counts, and a reviewer-set
WER threshold. No quality bound is silently invented by this command. Provide
`<fixture-id>.wav` files: PCM signed 16-bit LE, 16 kHz, mono, at most 128 MiB each.
Unsupported formats are rejected, not silently converted. WAV headers are removed
before the existing Pass-1 backend wraps the PCM in its own WAV.

For an approved run, supply `MIND_EVAL_MANIFEST`, `ASR_AUDIO_DIR`,
`VERTEX_PROJECT_ID`, the authorized credential mechanism and, only then,
`MIND_EVAL_ALLOW_PROVIDER_CALLS=true`. Optional model/region variables are
`VERTEX_FLASH_MODEL` and `VERTEX_FLASH_REGION` (default `asia-south1`). Invoke
`pnpm --filter @cureocity/llm eval:mind`. This adapter makes one attempt per file;
it does not reproduce live VAD windows, browser rendering or reconnect behavior.

The JSON report contains counts, opaque IDs, hashes, limits and actual model,
region/prompt versions from call metadata, never hypotheses or reference text.
Exit 0 means the specified held-out engineering checks passed, 1 means a failed
gate, and 2 means unavailable/insufficient evidence. Failed requests remain in
the denominator. Missing required languages, empty reference denominators, and
invalid annotations cannot pass. Per-language failures cannot hide in a pooled
score. Development scores cannot rescue held-out failures. Silence insertion and
known artifact checks are explicit; WER is not semantic or clinical accuracy.

## Note evaluator boundary

`evals/note` now enforces required sections, expected kind, lower **and upper**
reviewer-specified risk severity, nonempty evidence, literal critical phrases and
annotated forbidden claims. `criticalFacts` / `forbiddenClaims` are exact phrase
regression examples. They do not detect all unsupported statements, resolve
meaning, or measure factual precision. In particular, unannotated negation,
attribution, paraphrases, and unsupported facts still require human review.
No all-claims denominator or automated clinical judgment is fabricated.

`runNoteEval` accepts either the reference transcript or an explicit per-fixture
ASR transcript/segment map. Reports distinguish these sources. Missing or empty
ASR never falls back to golden text. This API is ready for a paired source-versus-
note experiment; it does not yet provide the approved corpus or human annotations.

The existing synthetic note CLI stays a smoke/regression tool. Even running its
seeds through a real model is not clinical validation. Its legacy 0.6 keyword-recall
bound is not the proposed human-annotated 95% precision / 90% recall target.
Real note calls require `NOTE_EVAL_ALLOW_PROVIDER_CALLS=true` as well as
`LLM_BACKEND=vertex`. A passing report does not authorize production changes.

## Not completed by this foundation

- The 40-case actor corpus, untouched held-out cohort and language reviewers.
- Adjudicated atomic-claim precision/recall, critical-risk rubric and reviewer veto.
- Speaker-attribution scoring, full-session live-window alignment, browser speech-
  end latency, correction-time measurement and real-device recovery tests.
- End-to-end real ASR → note comparison, runtime cost evidence and clinical pilot.

These need separately authorized evidence and human review; passing mocked tests
does not complete MP01 or establish a release decision.
