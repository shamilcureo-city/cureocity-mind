# AI Counseling ("Cureocity Care") — engineering build spec

> Status: **BUILD SPEC — no code yet.** Sprint plan in
> [`AI_COUNSELING_SPRINTS.md`](AI_COUNSELING_SPRINTS.md).
>
> **This is a standalone consumer product, not a feature of the
> therapist co-pilot.** No human therapist prescribes, configures, or
> reviews it. It lives in the same monorepo because it reuses the
> platform's engine — and this product reuses more of it than anything
> else we have built: the AI takes the _therapist's seat_ in the same
> clinical arc the co-pilot already encodes.

## 0. What this is (read this first)

**An AI therapist.** Not a chat toy, not a vague "wellness companion"
— the complete experience of _seeing a therapist_, delivered by AI
voice, end to end:

- The **first session is a real intake** — a conversation, not a form:
  presenting concerns, history, context, goals.
- After intake the user receives their **assessment & plan**: a
  plain-language formulation ("what's going on and why it makes
  sense") and proposed goals they can accept or adjust — collaborative
  goal-setting, like a real first visit.
- **Weekly structured treatment sessions** follow the plan: homework
  check-in → agenda → the work (evidence-based protocols: CBT thought
  work, behavioural activation, grounding, sleep hygiene — drawn from
  the `@cureocity/clinical` exercise + modality catalog) → summary →
  new homework.
- **Outcomes are measured**, not vibes: PHQ-9 / GAD-7 check-ins every
  two weeks through the existing instruments registry, scored by the
  existing deterministic **reliable-change engine**
  (`change-score.ts`), rendered as an honest progress verdict.
- Every ~6th session is a **review session**: progress against the
  plan, goals updated, plan re-versioned — and the user always gets
  the **full report** after every session.

This is the therapist platform's own clinical loop —
`INTAKE → TREATMENT → REVIEW`, formulation, treatment plan, homework,
measurement-based care, journey stages — with the AI as the clinician
and the user as the direct customer.

Two honest lines the product never crosses:

1. **Disclosure**: the user always knows their therapist is an AI —
   at signup, and whenever they ask. No pretending to be human, no
   fake credentials.
2. **Crisis**: the AI never plays crisis counselor. The deterministic
   safety architecture (§2) hands crises to humans — hotlines, a
   trusted contact, a bridge to licensed therapists — immediately.

Working name: **Cureocity Care** (`Care*` models, `/care` routes,
`/api/v1/care/*`). Consumer brand + the marketing use of the word
"therapy" are open decisions (§14 — the _experience_ is a therapist
either way; the _label_ is a legal/positioning call per market).

## 1. The therapy arc (mirrors the platform's SessionKind machinery)

```
 /care landing ─▶ signup ─▶ choose your therapist ─▶ consent + safety gate
                             (name · voice · style)
                                      │
              ┌───────────────────────▼────────────────────────────────┐
              │ SESSION 1 · INTAKE (live voice, ~30 min)               │
              │   concerns · history · context · what you want to change│
              │   → Pass 10 INTAKE branch: Assessment & Plan            │
              │     formulation + proposed goals + session cadence      │
              │   → user reviews, adjusts goals, ACCEPTS THE PLAN       │
              └───────────────────────┬────────────────────────────────┘
                                      │
              ┌───────────────────────▼────────────────────────────────┐
              │ SESSIONS 2..n · TREATMENT (weekly rhythm, ~25 min)     │
              │   homework check-in → agenda → the work → summary →     │
              │   homework                                              │
              │   → Pass 10 TREATMENT branch: session report            │
              │   PHQ-9 / GAD-7 check-in every 2 weeks (instruments)    │
              └───────────────────────┬────────────────────────────────┘
                                      │ every ~6 sessions, or on request
              ┌───────────────────────▼────────────────────────────────┐
              │ REVIEW session                                          │
              │   reliable-change verdict (change-score.ts) · goals     │
              │   achieved/revised · plan re-versioned · continue or    │
              │   wind down                                             │
              │   → Pass 10 REVIEW branch: progress review              │
              └────────────────────────────────────────────────────────┘

  `CareSession.kind` is inferred server-side from cumulative state —
  exactly the Sprint-19 convention (users don't pick "intake").
```

## 2. Safety model — no human in the loop, so the rails are harder

Deterministic layers first; the model is never the only thing standing
between a vulnerable user and harm. This is what lets the product be a
real therapist the rest of the time.

| #   | Layer                             | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Disclosure**                    | Signup, session start, and any direct question: the therapist is an AI. No human impersonation, no invented credentials. "Not for emergencies" + hotlines are persistent chrome on every authed screen.                                                                                                                                                                                                                                                                                                                                              |
| 2   | **Onboarding gate**               | 18+ self-attestation. A baseline safety question ("Are you currently having thoughts of harming yourself?") — a _yes_ routes to hotlines + the licensed-therapist bridge and does **not** start AI sessions. Optional trusted-contact capture (name + phone, used only per layer 5's rules).                                                                                                                                                                                                                                                         |
| 3   | **In-prompt protocol**            | Hard rules in the system prompt: no medication advice; diagnosis-adjacent language stays plain and provisional ("this pattern looks like…", never an ICD label pronounced as fact); on any disclosure of self-harm, harm to others, abuse, or medical emergency → say the clinician-authored bridging script verbatim, then call the `flag_crisis` tool. Prompt + bridging script are versioned copy with clinician sign-off (same discipline as `change-score.ts` thresholds).                                                                      |
| 4   | **Live crisis screen**            | (a) Deterministic: every finished transcript turn is mirrored to the server (§4.6) and screened by `packages/clinical/src/crisis-screen.ts` — clinician-reviewed keyword/phrase lists per language incl. transliterated code-mix, unit-tested, zero LLM. (b) Model-side: `flag_crisis(severity, reason)` tool declared in the locked Live setup. Either trigger → session hard-stops server-side, UI takes over full-screen with `INDIA_CRISIS_HOTLINES` (language-filtered) + trusted contact + licensed-therapist bridge. `CARE_CRISIS_ESCALATED`. |
| 5   | **Safety hold + follow-up**       | A crisis event sets `CareUser.safetyHoldAt`: AI sessions lock until the user passes a next-day check-in screen. The trusted contact is surfaced to the _user_ as a one-tap call — never messaged automatically. A second crisis event within 30 days keeps sessions locked and promotes the human-help bridge to the primary CTA.                                                                                                                                                                                                                    |
| 6   | **Measurement as a tripwire**     | PHQ-9 item 9 > 0 on any check-in → immediate hotline interstitial + safety-hold rules; worsening reliable-change verdicts across two consecutive check-ins → the REVIEW session is pulled forward and the licensed-therapist bridge is surfaced prominently ("an AI has limits; here's a human"). Thresholds are clinician-signed, never loosened silently.                                                                                                                                                                                          |
| 7   | **Post-session re-screen + caps** | Pass 10 re-reads the full transcript for missed risk (`riskScreen`, internal — drives safety UX, never rendered raw). Hard caps: session length via ephemeral-token TTL (§4.2), sessions/week by plan tier.                                                                                                                                                                                                                                                                                                                                          |

## 3. Architecture in one diagram

```
                        ┌───────────────────────────────────────────┐
                        │            apps/web (Vercel)              │
 Consumer browser       │                                           │
 /care/session/[id]     │  POST /api/v1/care/sessions               │
   │                    │    gate check · kind inferred (INTAKE /   │
   ├──── start ────────▶│    TREATMENT / REVIEW) → CareSession +    │
   │                    │    startToken                             │
   ├──── redeem ───────▶│  POST .../sessions/[id]/token             │
   │                    │    single-use (Redis / in-mem fallback)   │
   │                    │    → ephemeral Live credential (§4.2)     │
   │  WSS (audio both ways, transcription events)                   │
   ├────────────────────┼──────────────▶ Gemini Live API            │
   │                    │               (native-audio model, §4)    │
   ├─ turn batches ────▶│  POST .../sessions/[id]/turns             │
   │                    │    append transcript + crisis-screen      │
   │                    │    → {action: continue | crisis_stop}     │
   ├──── end ──────────▶│  POST .../sessions/[id]/end               │
   │                    │    persist stitched transcript            │
   │                    │    after(): PASS 10 (kind-branched, §5)   │
   └── report view ────▶│  GET  .../sessions/[id]  (poll report)    │
                        └───────────────────────────────────────────┘
```

**Transport decision — browser ↔ Gemini directly (chosen).** The
battle-tested recipe this spec adapts has the browser open the WSS to
Google itself: lowest latency, no in-region socket relay to scale,
Vercel-compatible. The server still sees every turn in near-real-time
via the turn-mirroring POSTs — which is what the safety layer needs.
**Fallback:** relay through a `live-gateway`-style service (the doctor
vertical already runs one) if a pilot demands zero client trust; the
wire contracts stay transport-agnostic so it is a drop-in swap.

## 4. The live voice loop (Gemini Live API)

The platform's existing passes run on **Vertex** (`@google/genai`).
The Live native-audio dialog models are, today, most reliable on the
**AI Studio v1beta Live endpoint** — so the live loop is an
env-switchable backend, and _only_ the live loop uses AI Studio;
Pass 10 (the reports) stays on Vertex like every other pass:

```
CARE_LIVE_BACKEND = mock | ai-studio | vertex
  mock       → scripted local WS server, no creds (dev/CI default)
  ai-studio  → wss://generativelanguage.googleapis.com/ws/
               google.ai.generativelanguage.v1beta.GenerativeService.
               BidiGenerateContent            (requires GEMINI_API_KEY)
  vertex     → LlmBidiService.BidiGenerateContent on Vertex — wire it
               behind the same interface the day native-audio dialog
               models land in a usable region (§13, open decision)
```

### 4.1 Model + voice (dated pins only)

| Setting  | Value                                                                                                                           | Why                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model    | `models/gemini-2.5-flash-native-audio-preview-12-2025`                                                                          | **Dated pin, never `-latest`** — alias rotation caused two outages in the source project. Pin lives in one place: `packages/llm/src/live/config.ts`.      |
| Voice    | User picks their therapist at onboarding: persona = name + voice (`Puck` / `Kore` / `Charon` / `Aoede`, probe-verified) + style | The therapist persona is stable across sessions — continuity of relationship is the product.                                                              |
| Modality | `AUDIO` output **only**                                                                                                         | Text+audio simultaneously produces echo. Captions come from output transcription events, not a TEXT modality.                                             |
| ❌       | `gemini-3.1-flash-live-preview`                                                                                                 | Accepted at setup, then drops mid-conversation (audio-streaming/VAD-runtime suspect, unresolved). Do not use until re-probed via `scripts/live-probe.ts`. |

### 4.2 Connection + credentials (the recipe, hardened)

The proven flow: server mints a **single-use session token** → client
redeems it once → client opens the WSS itself. We keep that flow and
upgrade what the token _contains_:

1. `POST /api/v1/care/sessions` (user-authed, §9) runs safety-hold +
   plan-tier + cap checks, **infers the session kind** from cumulative
   state (no accepted plan yet → INTAKE; review due → REVIEW; else
   TREATMENT), creates the `CareSession` row, and returns
   `{sessionId, kind, startToken}` — 32 random bytes hex.
2. Server stores `startToken` in **Redis** (`EX 2100`, 35-min TTL ≥
   the longest session cap). Dev fallback when `REDIS_URL` is unset:
   in-memory `Map<token, {payload, createdAt}>` with a 60-second
   sweeper — same pattern, zero setup, matches the codebase's
   auth-bypass philosophy.
3. `POST /api/v1/care/sessions/[id]/token` redeems it: **single-use**
   (Redis `GETDEL`), returns the live credential.
4. **The credential is a Gemini ephemeral auth token, not the API
   key.** The source recipe returned the full WSS URL with
   `?key=GEMINI_API_KEY` — which puts the long-lived key in the browser
   at redeem time. Instead the server calls the ephemeral-token API
   (`v1alpha auth_tokens.create`, google-genai SDK
   `client.authTokens.create`) with:
   - `uses: 1`, `expireTime`: now + session cap, short
     `newSessionExpireTime` (~2 min to connect);
   - **`liveConnectConstraints` locking the entire setup server-side**
     — model, voice, VAD, and crucially the **system instruction**.
     The case file in the prompt (formulation, plan, history) never
     ships to the browser, and the client physically cannot tamper
     with the model, the persona, or the safety rules.
     The browser connects with `access_token=<ephemeral>` in place of
     `key=`.
5. **Fallback flag** `CARE_LIVE_TOKEN_MODE=ephemeral|url` — `url`
   reproduces the source recipe exactly (full WSS URL w/ key in Redis,
   single-use redeem) if the ephemeral-token API misbehaves. Ship with
   `ephemeral`; keep `url` behind the flag, never the default.

### 4.3 The setup payload (first WS message, snake_case)

Sent as one JSON string on `onopen`; **wait for `{"setupComplete":{}}`
before sending any audio** — sending early drops the connection. With
ephemeral-token constraints this payload is fixed at mint time
server-side; in `url` fallback mode the browser sends it verbatim.
snake_case throughout (both cases work for setup; we standardize snake
— it is what the source project ran in production).

```json
{
  "setup": {
    "model": "models/gemini-2.5-flash-native-audio-preview-12-2025",
    "generation_config": {
      "response_modalities": ["AUDIO"],
      "speech_config": {
        "voice_config": {
          "prebuilt_voice_config": { "voice_name": "Kore" }
        }
      }
    },
    "realtime_input_config": {
      "automatic_activity_detection": {
        "disabled": false,
        "start_of_speech_sensitivity": "START_SENSITIVITY_HIGH",
        "end_of_speech_sensitivity": "END_SENSITIVITY_LOW",
        "silence_duration_ms": 700
      }
    },
    "input_audio_transcription": {},
    "output_audio_transcription": {},
    "tools": [
      {
        "function_declarations": [
          {
            "name": "flag_crisis",
            "description": "Call IMMEDIATELY if the user expresses self-harm, suicidal thought or plan, harm to others, abuse, or a medical emergency.",
            "parameters": {
              "type": "OBJECT",
              "properties": {
                "severity": { "type": "STRING", "enum": ["MODERATE", "HIGH", "CRITICAL"] },
                "reason": { "type": "STRING" }
              }
            }
          },
          {
            "name": "end_session",
            "description": "Call when the session reaches its natural close or time is up, after the closing summary and goodbye.",
            "parameters": {
              "type": "OBJECT",
              "properties": { "reason": { "type": "STRING" } }
            }
          }
        ]
      }
    ],
    "system_instruction": {
      "parts": [{ "text": "<THERAPIST PROMPT — §4.8, kind-branched, built server-side>" }]
    }
  }
}
```

### 4.4 VAD tuning — therapy needs longer silences than coaching

The source values (`START_SENSITIVITY_HIGH` / `END_SENSITIVITY_LOW` /
`400ms`) were tuned for a language-coach. Therapy clients pause to
think, get emotional, and cry — being talked over mid-pause is not a
UX bug here, it is _anti-therapeutic_. So:

- Keep `START_SENSITIVITY_HIGH` + `END_SENSITIVITY_LOW` (never flip
  END to HIGH — the AI will talk over the user).
- Default `silence_duration_ms: 700`, **per-user tunable 400–1200**
  (`CareUser.vadSilenceMs`, exposed in settings as "give me more time
  to think"). The 400 ms source baseline is the floor, not the target.

### 4.5 Audio formats (exact, or Gemini rejects/garbles)

| Direction        | Format                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mic → Gemini     | 16-bit signed PCM little-endian, **16,000 Hz**, mono, `audio/pcm;rate=16000`, base64 chunks of ~100–250 ms via `realtime_input.media.data` frames |
| Gemini → speaker | 16-bit signed PCM little-endian, **24,000 Hz**, mono                                                                                              |

- Capture: `getUserMedia` → `AudioWorklet` → resample to 16 kHz →
  base64. **Reuse `@cureocity/audio`** — the worklet + resampler +
  chunker already produce exactly this for the scribe recording path;
  only the frame envelope (base64 JSON vs binary upload) differs.
- Playback: dedicated `AudioContext({ sampleRate: 24000 })` feeding
  `AudioBufferSourceNode`s from a queue. **Never resample the output
  to 16 kHz** — audible chipmunk artifacts. New small module
  `apps/web/lib/audio/live-playback.ts`.
- Barge-in: on Gemini `interrupted` signal, flush the playback queue.

### 4.6 Transcription events + server mirroring (feeds BOTH the report and the crisis screen)

The two empty objects in setup are load-bearing — they enable
transcript emission. **Empty objects only**: adding
`language_codes: [...]` broke transcription entirely in the source
project (their May-30 revert). Auto-detect handles code-mix better
anyway.

Gemini emits:

```json
{ "serverContent": { "input_transcription":  { "text": "...", "finished": true } } }
{ "serverContent": { "output_transcription": { "text": "...", "finished": true } } }
```

The browser stitches these chronologically into turns
(`{seq, role: 'user'|'therapist', text, atMs}`) and **mirrors every
finished turn to the server** — `POST .../turns`, batched (flush every
turn or 3 s, whichever first, with monotonic `seq` for dedupe/ordering).
The server appends to `CareSession.liveTranscript`, runs the
deterministic crisis screen on each batch, and replies
`{action: 'continue'}` or `{action: 'crisis_stop'}` (client must
hard-stop + show the crisis takeover). The mirrored transcript — not
anything client-computed — is the input to Pass 10. If the client goes
dark mid-session (network death, closed tab), a sweeper finalizes the
session from whatever was mirrored: the report degrades gracefully
instead of vanishing.

### 4.7 Resilience + caps (Indian mobile networks are hostile)

- Enable **`session_resumption`** in setup; store the handle from
  `sessionResumptionUpdate` messages; on WS drop, reconnect with the
  handle within the ephemeral token's session window instead of
  restarting the conversation.
- Handle **`goAway`** (server-initiated shutdown warning) by
  reconnecting proactively with the resumption handle.
- Enable **context-window compression** (sliding window) so a 30-min
  intake cannot die of context exhaustion.
- Hard caps: ephemeral token `expireTime` = session cap (server-side
  truth); UI countdown; prompt instructs wrap-up at cap−3 min (the
  closing summary IS part of the method); `/turns` rejects after
  expiry (defense in depth).

### 4.8 The system prompt — a therapist's session, kind-branched

Assembled by `packages/llm/src/prompts/care-therapist.ts` (versioned
like every other pass prompt), built server-side per session from the
**case file**: persona (name/voice/style), user profile + goals,
accepted plan (formulation summary, active goals + status), last
session's report + homework, latest instrument scores, recurring
themes. Branched on `CareSession.kind`:

**INTAKE**

```
You are <PersonaName>, a therapist conducting a first session. You are
an AI and say so if asked, without dwelling on it. USER: <first name>.
Speak <language guidance — mirror the user's code-mix>.
SESSION LENGTH: 30 minutes. At 27 minutes, begin closing.

CONDUCT A REAL INTAKE, conversationally, not as a checklist:
- what brings them here now; how long; what it's costing them
- context: work/study, relationships, sleep, body, substances (light touch)
- history: has this happened before; what helped; any current treatment
- risk (gently, directly): thoughts of self-harm — if yes, SAFETY rules
- strengths + supports; what they want to be different
- close: reflect what you heard, say the assessment & plan will be
  ready to read in a minute, and that you'll agree on goals together.

STYLE: one question at a time; reflect before you ask; let silences
sit; their words > your labels.
SAFETY (hard rules): <bridging script + flag_crisis, verbatim block>
```

**TREATMENT**

```
You are <PersonaName>, <first name>'s therapist — session <n> of the
plan you built together.
PLAN: <formulation one-liner> · active goals: <goals + status>.
LAST TIME: <report summary>. HOMEWORK WAS: <homework + any check-in data>.
TODAY'S METHOD: <protocol step from the plan's modality track — e.g.
"thought record review, then challenge one hot thought" — steps sourced
from @cureocity/clinical exercises>.
SESSION SHAPE (~25 min): check in on homework (5) → set today's agenda
together (2) → the work (14) → summarize what they found, not what you
said (2) → agree homework (2). At 22 minutes, begin closing.
STYLE + SAFETY: <same blocks>
```

**REVIEW**

```
...you are reviewing progress against the plan. SCORES: PHQ-9
<series + reliable-change verdict>, GAD-7 <…> — the verdicts are
computed, not yours to re-judge; discuss what they mean with the user.
Walk goals one by one: keep / achieved / revise. Close with what the
next stretch of work is — or, if the verdicts say so, an honest
conversation about winding down or seeing a human therapist.
```

The bridging script, the intake structure, and the per-modality
protocol steps are **clinician-authored, versioned copy** — the same
discipline as the reliable-change thresholds.

### 4.9 Hard-won gotchas (inherited — do not relearn these)

| Don't                                          | Why                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| Use `-latest` in any model ID                  | Alias rotation → outages. Dated pins only.                                        |
| Add `language_codes` to transcription configs  | Kills transcription entirely. Empty objects auto-detect.                          |
| Send audio before `setupComplete`              | Connection drops.                                                                 |
| Use `gemini-3.1-flash-live-preview`            | Drops mid-session, cause unknown. Re-probe before adopting.                       |
| Resample 24 kHz output to 16 kHz               | Chipmunk audio. Use a 24 kHz `AudioContext`.                                      |
| Request TEXT+AUDIO modalities together         | Echo. Captions come from output transcription.                                    |
| Ship the API key (or setup payload) to browser | Ephemeral tokens with locked setup (§4.2). `url` mode is a flagged fallback only. |
| Flip END sensitivity to HIGH                   | AI talks over a thinking/crying user.                                             |

### 4.10 Mock backend (dev/CI must run the whole loop with no creds)

`CARE_LIVE_BACKEND=mock` (default) starts a tiny local WS server
(`services/care-mock-live/`) that speaks the exact wire protocol:
accepts setup → replies `setupComplete` → emits scripted
`output_transcription` + pre-rendered PCM24 audio +
`input_transcription` echoes (canned) → honors a scripted
`flag_crisis` fixture. Fixtures exist for **all three session kinds**
so the full arc — signup → intake → plan acceptance → treatment →
check-in → review — runs deterministically offline, matching the
repo's `LLM_BACKEND=mock` convention. CI drives it with Playwright.

## 5. Pass 10 — kind-branched reports (the same convention as Pass 2/3)

Live is conversation-only; after `/end`, a REST `generateContent` call
on **Vertex** produces the session's artefacts. Output is a
**discriminated union on `kind`** — exactly the Sprint-19 pattern, so
narrow before reading the body:

```
CareReportV1 = discriminated union on kind:

kind: 'INTAKE'  → assessmentAndPlan:
  formulation        plain-language "what's going on and why it makes
                     sense" — provisional wording, no ICD labels as fact
  concernAreas[]     named problem areas w/ evidence quotes
  proposedGoals[]    {goal, why, how measured} — user edits then accepts
  modalityTrack      which protocol family the plan draws from (CBT /
                     behavioural activation / grounding / sleep), from
                     the @cureocity/clinical catalog
  cadence            suggested rhythm (e.g. weekly, 25 min)
  riskScreen         internal (§2 layer 7)

kind: 'TREATMENT' → sessionReport:
  headline           one warm sentence
  summary            what we worked on, second person
  insights[]         {observation, evidenceQuote}
  goalProgress[]     {goalIndex, movement, evidence}
  moodTrajectory     {before, after, inSessionShift}
  homework           {title, steps[], whyItHelps} — catalog-linked
  reflectionPrompt   one journal question
  riskScreen         internal

kind: 'REVIEW'   → progressReview:
  verdicts[]         per-instrument reliable-change verdicts — COMPUTED
                     by change-score.ts and passed IN; the model
                     explains, never re-judges the numbers
  goalOutcomes[]     {goalIndex, status: ACHIEVED|KEEP|REVISED, note}
  planChanges        revised goals / modality track (re-versions CarePlan)
  recommendation     CONTINUE | STEP_DOWN | HUMAN_THERAPIST — honest,
                     rule-assisted (worsening verdicts force the
                     HUMAN_THERAPIST option to be discussed)
  riskScreen         internal
```

- **Enum**: `GeminiPass.PASS_10_CARE_REPORT` (+ migration
  `ALTER TYPE ... ADD VALUE IF NOT EXISTS`).
- **Backend**: `packages/llm/src/backends/vertex-care-report.backend.ts`
  modeled on `vertex-clinical.backend.ts` (which already handles a
  kind-branched output); mock twin in `mock-gemini.backend.ts`; wired
  through `ModelRouter` + `llm.ts` + `recordGeminiCall` — the full
  §5-of-CLAUDE.md checklist.
- **Input**: stitched server-side transcript, case file (plan, goals,
  homework, prior themes), mood before/after, instrument series (+
  precomputed reliable-change verdicts for REVIEW).
- **Trigger**: `after()` on `/end` (the Pass-3 pattern) + synchronous
  `POST .../report` re-run with its own budget (Vercel Hobby's 60 s
  cap can kill `after()` work). The report screen polls with a
  graceful skeleton.
- **Parsing**: strip markdown fences before Zod parse; defensive
  `.catch()` fallbacks on every leaf so a partially-valid report still
  renders (the `clinical-mappers.ts` philosophy).
- **Plan acceptance is a user action, not a model action**: the INTAKE
  branch only _proposes_; `POST /care/plan/accept` (with the user's
  goal edits) creates the versioned `CarePlan` — mirroring how the
  co-pilot's therapist confirms Pass-3 suggestions before they persist.

## 6. Identity — self-serve signup, choose your therapist

This product's users are **not** `Client` rows (those belong to a
human therapist's tenant). A new, self-owned identity:

- **`/care`** — the consumer landing page (server-rendered; reuses
  `Container`/`ButtonLink`/`Reveal` + the `lp-*` animation layer the
  way `/for-doctors` does, with its own palette + copy). A real D2C
  marketing page for cold traffic.
- **`/care/login`** — Firebase **phone OTP** (India-first) + email-link
  fallback. Signup and login are the same flow; a new Firebase UID
  creates a `CareUser` row. Session cookie minted via the
  `/api/v1/auth/session` pattern with a distinct `care` audience claim
  — a care cookie never resolves as a practitioner or portal client,
  and vice versa.
- **Onboarding** (short — the intake _session_ does the real intake):
  display name → **choose your therapist** (persona name + voice with
  3-second samples + style: gentle/direct) → language(s) → 18+ +
  disclosure screen + consent (§13) → baseline safety question (§2
  layer 2) → optional trusted contact → straight into "book your
  first session" (start now or pick a reminder time).
- **Guard**: `requireCareUserId(req)` beside `requirePsychologistId`;
  every `/api/v1/care/*` route uses it; every query filters by the
  resolved `careUserId`.
- **Dev bypass**: when Firebase env is missing, resolve a seeded demo
  `CareUser` — same auto-engage/auto-disengage convention as the
  existing bypasses.

## 7. Data model (Prisma) — self-contained, no tenant coupling

```prisma
enum CareUserStatus { ACTIVE SAFETY_HOLD DELETED }

model CareUser {
  id            String  @id @default(cuid())
  firebaseUid   String  @unique
  displayName   String
  phone         String?                    // encrypted-companion column from day one
  email         String?
  preferredLanguage String @default("en")
  spokenLanguages   String[] @default([])
  personaName   String  @default("Meera")  // the therapist the user chose
  voiceName     String  @default("Kore")
  personaStyle  String  @default("gentle") // gentle | direct
  vadSilenceMs  Int     @default(700)      // §4.4 "give me time to think"
  trustedContactName  String?
  trustedContactPhone String?
  status        CareUserStatus @default(ACTIVE)
  safetyHoldAt  DateTime?                  // §2 layer 5
  planTier      String  @default("free")   // free | plus (Razorpay, §11)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  deletedAt DateTime?
  sessions    CareSession[]
  carePlans   CarePlan[]
  checkins    CareCheckin[]
  instruments CareInstrumentResponse[]
}

/// The accepted assessment & plan — versioned like TreatmentPlan.
/// A REVIEW session that changes goals creates a new version; history
/// is never mutated.
model CarePlan {
  id           String @id @default(cuid())
  careUserId   String
  version      Int
  formulation  Json                        // plain-language, from INTAKE branch
  goals        Json                        // [{goal, why, measure, status}]
  modalityTrack String                     // CBT | BA | GROUNDING | SLEEP (catalog keys)
  cadence      String                      // "weekly-25min"
  acceptedAt   DateTime                    // user action, not model action (§5)
  createdAt DateTime @default(now())
  @@unique([careUserId, version])
}

enum CareSessionKind   { INTAKE TREATMENT REVIEW }
enum CareSessionStatus { CREATED IN_PROGRESS COMPLETED ABORTED CRISIS_ESCALATED }
enum CareRiskLevel     { NONE LOW MODERATE HIGH }

model CareSession {
  id            String @id @default(cuid())
  careUserId    String
  kind          CareSessionKind            // inferred server-side (§4.2)
  carePlanId    String?                    // the plan version in force
  status        CareSessionStatus @default(CREATED)
  moodBefore    Int?                       // 0-10
  moodAfter     Int?
  startedAt     DateTime?
  endedAt       DateTime?
  durationSec   Int?
  liveTranscript Json    @default("[]")    // mirrored turns {seq, role, text, atMs}
  model         String
  promptVersion String
  crisisAt      DateTime?
  crisisSource  String?                    // 'keyword_screen' | 'model_tool' | 'user_button'
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  report CareReport?
  @@index([careUserId, createdAt])
}

model CareReport {
  id            String @id @default(cuid())
  careSessionId String @unique
  kind          CareSessionKind            // denormalized for queries
  body          Json                       // CareReportV1 (discriminated, §5)
  riskLevel     CareRiskLevel @default(NONE)
  createdAt DateTime @default(now())
}

model CareCheckin {
  id         String @id @default(cuid())
  careUserId String
  mood       Int                           // 0-10 daily dial
  note       String?
  createdAt  DateTime @default(now())
  @@index([careUserId, createdAt])
}

/// Self-administered PHQ-9 / GAD-7 — reuses the @cureocity/clinical
/// instruments registry (items, scoring) but NOT the tenant-coupled
/// InstrumentResponse table.
model CareInstrumentResponse {
  id            String @id @default(cuid())
  careUserId    String
  instrumentKey String                     // 'phq9' | 'gad7'
  answers       Json
  totalScore    Int
  item9         Int?                       // PHQ-9 only — safety tripwire (§2 layer 6)
  createdAt DateTime @default(now())
  @@index([careUserId, instrumentKey, createdAt])
}
```

Enum additions to existing types: `GeminiPass.PASS_10_CARE_REPORT` +
`GeminiPass.LIVE_CARE_SESSION` (call logging), new `AuditAction`s
(§11). Billing reuses the Razorpay adapter code but gets its own
`CareBilling` table in the billing sprint — the existing
`BillingAccount` is keyed to psychologists and stays untouched.

DPDP posture: `CareUser` is a data principal with us as the fiduciary
directly. `phone` + `liveTranscript` get encrypted companion columns
from day one via the `tenant-crypto.ts` pattern (keyed per care-user);
self-serve export + erasure in `/care/settings`.

## 8. Contracts (`packages/contracts/src/care.ts`)

Contracts-first: `CareUserSchema` + onboarding input; `CarePlanSchema`

- `AcceptPlanInputSchema` (goal edits); `CareTurnSchema`
  (`{seq, role, text, atMs}`) + `MirrorTurnsInputSchema` (batch +
  `{action}` response); `StartCareSessionInputSchema` (moodBefore) /
  `RedeemLiveTokenResponseSchema` (discriminated on token mode);
  `EndCareSessionInputSchema`; **`CareReportV1Schema` — discriminated
  union on `kind`** (§5, defensive `.catch()` on every leaf; always
  narrow on `kind` before reading, the Pass-2/3 rule);
  `CareCheckinInputSchema`; `CareInstrumentInputSchema` (validated
  against the instruments registry). Live wire messages get
  `CareLiveEventSchema` mirroring the `live-encounter.ts` style so the
  mock server + browser validate both sides.

## 9. API routes (all `parseJson`/`parseQuery` validated, all audited)

All user-facing routes under `/api/v1/care/`, guarded by
`requireCareUserId`:

| Route                             | Does                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `POST /care/onboarding`           | Persona pick, languages, attestations, trusted contact; capture consent                                        |
| `GET  /care/home`                 | Next-session card (kind + gate verdict in plain words), plan goals + status, homework, streak, check-in prompt |
| `POST /care/checkins`             | Daily mood dial                                                                                                |
| `POST /care/instruments`          | PHQ-9/GAD-7 self check-in → score via registry; item-9 tripwire (§2 layer 6)                                   |
| `POST /care/sessions`             | Gate → infer kind → `CareSession` + `startToken`                                                               |
| `POST /care/sessions/[id]/token`  | Single-use redeem → ephemeral Live credential (§4.2)                                                           |
| `POST /care/sessions/[id]/turns`  | Mirror batch → crisis screen → `{action}`                                                                      |
| `POST /care/sessions/[id]/end`    | moodAfter, stitch + persist, `after()` Pass 10 (kind-branched)                                                 |
| `GET  /care/sessions/[id]`        | Status + report body when ready (report screen polls)                                                          |
| `POST /care/sessions/[id]/report` | Synchronous Pass-10 re-run (Pass-3 pattern)                                                                    |
| `POST /care/plan/accept`          | User accepts/edits proposed goals → versioned `CarePlan` (§5)                                                  |
| `POST /care/sessions/[id]/crisis` | User tapped "I need help now" — same escalation path                                                           |
| `GET  /care/progress`             | Journey: plan goals, instrument series + reliable-change verdicts, mood trend, session history                 |
| `POST /care/safety/resume`        | Next-day check-in acknowledgement lifts `SAFETY_HOLD` (§2 layer 5)                                             |
| `GET/POST /care/settings`         | Persona/voice, VAD, languages, trusted contact, export / delete account                                        |
| `POST /care/billing/checkout`     | Razorpay order for the plus tier (billing sprint)                                                              |

## 10. Screens (wireframes — visual mockups accompany this doc)

All mobile-first; the product is a phone product.

**S1 · `/care` — landing.** Hero: "Your own therapist. Tonight." —
real sessions in your own language, an actual plan, progress you can
see. How-it-works = the arc (intake → plan → weekly sessions →
progress). Honesty block: your therapist is an AI (say it proudly,
with the disclosure), not for emergencies + hotline strip. Pricing
teaser. One CTA.

**S2 · `/care/login`.** Phone → OTP; email-link fallback; 18+ note.

**S3 · onboarding — choose your therapist.** Persona cards (name +
voice sample + style: gentle/direct), language chips, disclosure +
consent, baseline safety question, trusted contact (optional) → "book
your first session" (start now / remind me).

**S4 · `/care/home`.** Next-session card is kind-aware: "First
session — let's understand what's going on (~30 min)" → after intake:
"Session 4 with Meera · Thursday rhythm · CBT track". Plan card: goals
with progress ticks. Homework card. Daily mood dial + streak.
Persistent safety strip.

```
┌────────────────────────────┐
│ Good evening, Arjun 🌙  🔥4 │
│ ┌────────────────────────┐ │
│ │ SESSION 4 · with Meera │ │
│ │ CBT track · ~25 min    │ │
│ │ Today: challenge one   │ │
│ │ hot thought            │ │
│ │      [ ▶ Start ]       │ │
│ └────────────────────────┘ │
│ YOUR PLAN  v2              │
│ ◉ Sleep before 1am   ▲    │
│ ◉ One social thing/wk ─    │
│ ○ Sunday-dread toolkit     │
│ Homework  ☑ thought record │
│──────────────────────────  │
│ Not for emergencies →      │
│ iCall 9152987821 · SOS     │
└────────────────────────────┘
```

**S5 · `/care/session/[id]` — live session.** Full-screen, dark, calm.
Breathing orb, optional captions, remaining-time ring, mute + end,
persistent "Need urgent help?" pill. Same screen for all three kinds —
the _conversation_ differs, not the chrome.

**S5b · crisis takeover (state of S5).** Full-screen, instant:
hotlines (language-filtered `INDIA_CRISIS_HOTLINES`), trusted-contact
one-tap call, licensed-therapist bridge. Session already terminated
server-side; safety hold set.

**S6a · `/care/plan` (after intake) — Assessment & Plan.** The
formulation in plain language, concern areas with the user's own
words as evidence, proposed goals as editable cards (accept / tweak /
remove), modality track + cadence, big "This is my plan" accept
button. This is the collaborative-goal-setting moment — the product's
first "wow".

**S6b · `/care/session/[id]/report` — session report.** Headline,
summary, insights with quotes, goal progress ticks, mood shift,
homework (expandable steps), reflection prompt. Share/save. The
screenshot artifact.

**S7 · `/care/progress` — the journey.** Stage line (Getting started →
Assessment → Active work → Review), PHQ-9/GAD-7 trend with
reliable-change verdicts in plain words ("reliably improved — this is
real change, not noise"), goals across plan versions, mood trend,
session history.

**S8 · `/care/plan-tier`.** Free tier state → plus via Razorpay;
manage/cancel.

**S9 · `/care/settings` + safety-resume.** Persona/voice, "give me
time to think" VAD slider, languages, trusted contact, export/delete.
The safety-resume check-in is forced full-screen after a crisis event.

## 11. Audit, observability, cost

- **Audit actions** (chaos-test rules: literals, no ternaries):
  `CARE_USER_REGISTERED`, `CARE_ONBOARDING_COMPLETED`,
  `CARE_CONSENT_CAPTURED`, `CARE_SESSION_STARTED / COMPLETED /
ABORTED`, `CARE_PLAN_PROPOSED`, `CARE_PLAN_ACCEPTED`,
  `CARE_PLAN_REVISED`, `CARE_INSTRUMENT_SUBMITTED`,
  `CARE_CRISIS_ESCALATED`, `CARE_SAFETY_HOLD_SET / LIFTED`,
  `CARE_REPORT_GENERATED`, `CARE_CHECKIN_SUBMITTED`,
  `CARE_PLAN_UPGRADED / CANCELLED` (billing), `CARE_ACCOUNT_DELETED`.
- Live sessions log to `GeminiCallLog` as `LIVE_CARE_SESSION`
  (duration, token stats, cost ₹, status); Pass 10 logs as
  `PASS_10_CARE_REPORT`. `recordGeminiCall` union extended for both.
- `cost-guard.ts` gets a per-user daily Live-minutes budget — native-
  audio minutes are the COGS; tier caps enforced server-side at
  session-create ARE the unit economics.
- Counters: signups, activation (intake completed), plan-acceptance
  rate, week-4 retention, sessions by kind, crisis escalations by
  source, reliable-change outcomes, report latency, WS reconnects.

## 12. The licensed-therapist bridge (design for it now, ship later)

The one place the two products touch — and the growth loop between
them:

- Crisis takeover, safety-hold, and a REVIEW recommendation of
  `HUMAN_THERAPIST` all surface **"See a licensed therapist"** → a
  referral surface listing therapists on the existing platform
  (opt-in per therapist; India-wide teletherapy).
- A CareUser can later **share their Care history** (plan, reports,
  instrument series) with a therapist they choose — creating a normal
  `Client` row in that therapist's tenant with an imported summary.
  Strictly user-initiated, per-artefact consent.
- Nothing in V1 depends on this; the models are kept separate
  precisely so the bridge is an explicit, consented import — never an
  implicit join.

## 13. Compliance — stated plainly

- **We are the data fiduciary for CareUsers directly** (DPDP). Consent
  at onboarding in plain language: what is recorded (voice →
  transcript), what is generated (plan, reports), where audio is
  processed, retention, self-serve deletion. Withdrawable in settings.
- **Live audio via AI Studio is processed outside India** —
  cross-border transfer named explicitly in the consent copy. The day
  Vertex Live supports native-audio dialog models in a DPDP-friendly
  region, `CARE_LIVE_BACKEND=vertex` flips the loop in-region with no
  product change. Track quarterly.
- **The word "therapy" in marketing is a per-market legal call**
  (some jurisdictions restrict AI products calling themselves
  therapy; India currently does not, but the Mental Healthcare Act
  regulates _professionals_, which an AI is not). The product
  experience is a therapist regardless; the landing-page noun is an
  open decision (§14). In-app disclosure (an AI, not a licensed
  professional) is non-negotiable either way.
- Pass 10 runs on Vertex global — same posture as the platform's
  existing passes. Transcripts + phone encrypted from day one (§7).
- 18+ product. No guardian flows in V1.

## 14. Open decisions (need a call before AC2 ends)

1. **Brand name** + persona names for the therapist roster; the
   marketing noun ("AI therapist" vs "AI counselor" vs "therapy-based
   support") per §13.
2. **AI Studio vs Vertex for Live** at launch — re-probe native-audio
   model availability on Vertex Live API + region (AC0 deliverable).
3. **Pricing**: free tier = intake + assessment & plan free, N
   treatment sessions/month? Plus price point. Caps enforced from AC3
   either way; the paywall lands in AC7.
4. **Voice ↔ language matrix**: probe Puck/Kore/Charon/Aoede quality
   for Hindi / Malayalam / code-mix; pick per-language persona
   defaults (AC0 spike deliverable).
5. **Modality tracks at launch**: CBT + behavioural activation +
   grounding + sleep are in the catalog today — which ship in V1, and
   which need new clinician-authored protocol steps?
6. **Licensed-therapist bridge** (§12) timing — after retention data,
   or as a launch differentiator?
