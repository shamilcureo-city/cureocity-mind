# Cost-efficiency sprint plan — Sprints 74–78

**Goal:** cut the AI cost of a session by ~50–60% while making the clinical
answers _better_, then restructure pricing so no account is unprofitable.

**Basis:** 45-minute code-mixed session; "live rates" = prudent Gemini 2.5
Vertex estimates (Flash audio-in ≈ $1.00/M, Flash out ≈ $2.50/M, Pro in
$1.25/M, Pro out ≈ $10/M incl. thinking; ₹ = $ × 83). The constants in
`packages/llm/src/pricing.ts` are a generation older — Sprint 74 trues them
up against the actual Vertex invoice, and every number below gets re-based
on logged actuals (`GeminiCallLog`, `NoteDraft.totalCostInr`).

## 1. Where the money goes today

Every completed session automatically runs Pass 1 (Flash, audio→transcript),
Pass 2 (Pro, note) and Pass 3 (Pro, clinical brief). Nine more generations
are click-gated (brief, script, map, consult, reflections, modify, assistant,
translate, case briefing) — all Pro. **No pass caps thinking tokens** (billed
as output), every pass re-reads raw transcript/history, and "unlimited" plans
put no ceiling on any of it.

| Cost line                     | ≈ share of auto bill (live) |
| ----------------------------- | --------------------------- |
| Audio input (Pass 1)          | ~40%                        |
| Pro output + thinking (P2/P3) | ~50%                        |
| Everything else               | ~10%                        |

## 2. Cost per session, stage by stage (live rates)

| After…                            | Auto pipeline | Typical active¹ | Click-everything |
| --------------------------------- | ------------- | --------------- | ---------------- |
| Today                             | ₹25           | ₹35             | ₹65+ (unbounded) |
| S74 thinking caps                 | ₹21           | ₹30             | ₹52              |
| S75 case digest + prompt caching  | ₹19           | ₹27             | ₹45              |
| S76 model routing (P2→Flash)      | ₹15–17        | ₹20–22          | ₹32–35           |
| S77 audio diet (VAD trim)         | **₹13–15**    | **₹17–19**      | ₹28–32           |
| S76b optional: P3→Flash (if eval) | ₹10–11        | ₹13–15          | ₹25              |
| S78 fair-use pricing              | —             | —               | **bounded**      |

¹ auto + pre-session brief + reflections + one therapy script.

**Margins at the end state** (typical session ≈ ₹15–18):

| Plan                | Revenue / session | Margin                            |
| ------------------- | ----------------- | --------------------------------- |
| Trainee ₹499 / 15   | ₹33               | ~60–70% (with copilot metering)   |
| Starter ₹1,499 / 30 | ₹50               | ~65–70%                           |
| Pro ₹3,499 @ 100/mo | ₹35               | ~50–60%                           |
| Overage ₹30/session | ₹30               | ~45–50% — the tail earns, forever |

## 3. Quality — what each change does, and its guardrail

| Change                                    | Quality effect                                                                                                                 | Guardrail                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Thinking caps (P2 tight, P3 generous)     | Neutral — note generation is extraction/formatting; P3 keeps a real reasoning budget                                           | Env-tunable per pass; eval suite before/after; loosen instantly if briefs degrade |
| Case File Digest                          | **Better** — every pass sees longitudinal state (score trajectory, goal status, risk history) instead of raw-transcript sprawl | Digest core is deterministic (from cumulative tables); therapist can read it      |
| Pass 2 → Flash                            | Neutral **if** the eval gate passes                                                                                            | Flip only when Flash ≥ Pro baseline on completeness + risk-flag capture           |
| Pass 3 → Flash (optional)                 | Real risk — this is the diagnosis pass                                                                                         | Off by default; only if evals clearly pass; otherwise Pro + capped thinking       |
| VAD silence trim                          | Neutral with conservative thresholds                                                                                           | Collapse only >2 s silences with padding; env flag; transcript spot-checks        |
| Risk-flag verification micro-pass (Flash) | **Better** on the safety-critical dimension                                                                                    | Additive only — never removes a flag, only questions/confirms                     |
| Regenerate-with-feedback                  | **Better** — targeted second drafts instead of blind re-rolls; fewer retries                                                   | —                                                                                 |

Net: two changes are neutral-guarded, three actively improve answers. The
only genuinely risky swap (P3→Flash) is optional and gated.

## 4. The sprints

### Sprint 74 — Meter & cap (zero quality risk)

- `thinkingConfig.thinkingBudget` on every Pro call site (6 backends + 3
  web routes), read from env (`LLM_THINKING_BUDGET_PASS2` etc.); defaults:
  P2 ≈ 1024, P3 ≈ 4096, on-demand ≈ 2048. `-1` restores automatic.
- COGS readout: per-therapist month view (aggregate `GeminiCallLog` +
  `NoteDraft.totalCostInr`) — cost/session, per-pass breakdown, outlier flag.
- True up `pricing.ts` against the live Vertex invoice (audio is currently
  billed at the Flash _text_ rate — wrong).
- **Exit:** real cost/session visible; Pro output spend −20–30%; briefs
  spot-checked unchanged.

### Sprint 75 — Case File Digest (quality + input cost)

- `ClientCaseDigest` (one row per client): deterministic core built from
  cumulative tables (diagnosis, plan+goals, instruments, problems, risk
  history) + one Flash narrative refresh on session close.
- Passes 3/5/6/7/8 consume the digest instead of raw history; transcript
  still included only where verbatim quotes are required (intake, P3
  supporting evidence).
- Prompt layout for Vertex implicit caching: stable system prompt first,
  digest second, per-call content last.
- **Exit:** input tokens −40–60% on returning clients; briefs/consults cite
  longitudinal facts they previously missed.

### Sprint 76 — Eval gate + model routing (the swap, done safely)

- Gold set: ~20 demo/anonymised transcripts + rubric scoring in
  `packages/llm/src/evals` (note completeness, risk capture, ICD accuracy).
- `LLM_PASS2_MODEL` / `LLM_PASS3_MODEL` env flags; A/B Flash vs Pro on the
  gold set; flip P2 if ≥ baseline. P3 stays Pro w/ capped thinking unless
  Flash clearly passes.
- Route assistant chat, reflections, share-translate to Flash (low risk).
- Add the Flash risk-flag verification micro-pass.
- **Exit:** auto pipeline ≤ ₹15 live; eval report committed to `docs/`.

### Sprint 77 — Audio diet

- Voice-activity trim in the capture pipeline (audio worklet): collapse
  silences > 2 s, keep 300 ms padding; env-flagged, default off until
  10-session transcript fidelity spot-check passes.
- **Exit:** audio tokens −20–30%; transcripts unchanged.

**Status (landed, default-off):** `SilenceTrimmer` (`packages/audio/src/
silence-trim.ts`) is a pure, streaming, unit-tested transform — never clips
speech (per-frame classification keeps any frame with energy whole), collapses
only runs longer than `minSilenceMs`, keeps `paddingMs` on each edge. Wired
into the **batch upload path** (`apps/web/lib/audio/upload-file.ts`) between
the decimator and the chunker, behind `NEXT_PUBLIC_AUDIO_SILENCE_TRIM=true`
(threshold / min-silence / padding overridable via
`NEXT_PUBLIC_AUDIO_SILENCE_*`). When off it is a byte-for-byte no-op. It logs
`dropped N% of audio` per upload so the spot-check has a number. **Remaining
(operational / device-gated):** run the 10-session transcript-fidelity check
on real uploads, tune the threshold per device, then flip the flag; live-
capture wiring is deferred (the live gateway already does its own VAD
windowing).

### Sprint 78 — Fair-use pricing (bound the tail)

- `PLAN_CATALOG`: Pro/Premium become fair-use (≈120 / 250 sessions per
  month) + transparent overage ≈ ₹30/session; Trainee gets metered copilot
  actions (core pipeline stays untouched).
- Metering from existing `GeminiCallLog`; soft enforcement (warn → gate);
  grandfather existing subscribers; Plan-page copy + Razorpay line items.
- **Exit:** no account can be unprofitable; margin floor holds at the
  measured, not estimated, cost.

## 5. Standing constraints

- Pass 1 stays in `asia-south1` (DPDP residency) — audio model choices are
  limited to that region's catalog.
- Reliable-change thresholds and other clinical constants are untouched —
  this plan changes _how much we pay to think_, never what the clinical
  rules are.
- Every lever is env-tunable and reversible; nothing flips without the
  eval gate or a prod spot-check.
