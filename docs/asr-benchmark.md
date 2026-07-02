# ASR benchmark — Hinglish / Manglish / English (Sprint DS8)

**Status: harness shipped; seed run is synthetic. The real go/no-go number
needs actor-recorded audio through the live Vertex engine (protocol below).**

This answers one of the plan's open questions: _can we trust automatic
transcription of a code-mixed Indian OPD consult enough to auto-apply what
the doctor says?_ — specifically for **drug names**, where a mangled token
is a patient-safety problem, not a cosmetic one.

## What ships

- `packages/llm/src/evals/asr/` — a pluggable ASR benchmark:
  - `wer.ts` — normalised word-error-rate + a **term error rate** that
    scores only the safety-critical vocabulary (drug names, key clinical
    terms) against every reference occurrence.
  - `fixtures.ts` — a code-mix seed set (cardio / endo / GP × en / hi / ml),
    each with a ground-truth reference and the drug names that must survive.
  - `engine.ts` — `IAsrEngine`: `MockAsrEngine` (representative hypotheses,
    for CI) and `VertexAsrEngine` (the real integration point — streams
    recorded audio through Pass-1; guarded stub until the WAVs exist).
  - `scorer.ts` — overall / medical / **drug-name** WER + the golden gate.
  - `runner.ts` + `run.ts` — `pnpm eval:asr`.
- **The golden gate** (`asrGate`): **drug-name WER > 3% ⇒ voice-Rx stays
  confirm-only.** Voice-added prescriptions are confirm-first as shipped
  (DS5); this gate exists to _block any future "auto-accept spoken meds"
  relaxation_ until the measured number is safe. 3% is already generous for
  code-mix ASR — do not loosen it without a clinician sign-off + a citation.

## How to run

```bash
pnpm eval:asr                       # mock engine — deterministic smoke run
ASR_ENGINE=vertex ASR_AUDIO_DIR=... pnpm eval:asr   # the REAL benchmark
```

## Seed run (mock engine — illustrative, NOT a real result)

The mock hypotheses are lightly-perturbed references chosen to exercise the
scorer and the gate — including two realistic code-mix drug-name slips
(`telmisartan → telmisartion`, `insulin → insul`). They demonstrate the
mechanism; they are **not** transcription accuracy numbers.

| Split       | WER      | Drug-name WER |
| ----------- | -------- | ------------- |
| en          | 0.0%     | 0.0%          |
| hi          | 1.1%     | 25.0%         |
| ml          | 2.2%     | 16.7%         |
| **overall** | **1.1%** | **12.5%**     |

**Gate on the seed run:** drug-name WER 12.5% > 3% → **voice-Rx stays
confirm-only** (which is exactly how it ships). This is the mechanism
working, on synthetic data.

## Getting the real number (the remaining ops step)

1. **Record the seed scripts.** For each fixture in `fixtures.ts`, have a
   native Hinglish / Manglish / English speaker read the `reference` aloud
   in a clinic-like setting; save as `<fixture-id>.wav` (16 kHz mono).
   Expand the set toward ~30 consults/​language before trusting the number.
2. **Run the real engine:** `ASR_ENGINE=vertex ASR_AUDIO_DIR=<dir> pnpm
eval:asr` — `VertexAsrEngine` streams each WAV through the asia-south1
   Pass-1 backend and the scorer produces the real drug-name WER.
3. **Read the gate.** If drug-name WER > 3% (the likely outcome for
   code-mix today), voice-Rx correctly stays confirm-first and we log the
   number as the pilot baseline. If it is ever ≤ 3% on a representative
   set, that is the evidence required to _consider_ relaxing — with a
   clinician in the loop.

## DPDP note

Audio for the real run transits the asia-south1 Vertex Pass-1 path (same
residency posture as production). Recordings used for benchmarking are
research artefacts held outside the repo; they are not patient data and
must not include real patient audio.
