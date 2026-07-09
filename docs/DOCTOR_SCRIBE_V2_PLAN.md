# Doctor Scribe V2 — strategy + build plan

> **Status note (2026-07):** the §5 V2 _architecture_ (kill O(n²)
> re-transcription, incremental windows + VAD, `RxPadV1`, one-tap
> actions, live differential) has since been BUILT — see
> `docs/DOCTOR_SCRIBE_V2_SPRINTS.md` (DS0–DS9) and
> `docs/DS11_CONSULT_UX_SPRINTS.md` (DS11). What remains genuinely
> forward-looking is the GTM strategy: the Hinglish ASR benchmark (§3),
> pricing (§6), and the pilot plan (§7). Read §5 as _shipped design
> rationale_, §3/§6/§7 as _open strategy_.

_Research-backed plan for revamping the doctor ambient-scribe vertical.
Sources: a 107-agent deep-research pass (July 2026) with adversarial
claim verification — every cited fact below survived 3-vote
verification against primary sources (NEJM Catalyst, NEJM AI,
JAMIA, JMIR, vendor primary pages). Where research could NOT verify a
question, it is listed honestly under §3 as an open question with a
week-1 validation task, not silently guessed._

---

## 1. The single differentiating bet

> **The 3-minute OPD operating system: an Rx-first ambient scribe where
> the prescription writes itself during the consult — in code-mixed
> Indian speech — with passive, patient-specific safety intelligence
> (drug interactions, red flags, chronic trends) the doctor confirms
> with one tap.**

Not "an AI scribe with more features." The bet decomposes into three
claims, each grounded in verified evidence:

1. **Live in-visit clinical decision support is a structurally open
   lane — even at the top of the market.** Microsoft Dragon Copilot
   (100,000+ clinicians as of March 2026) ships NO native live CDS:
   decision support is delegated to marketplace partners (Regard,
   Optum, Canary Speech, Humata Health), and its own ICD-10 coding
   arrives at post-encounter note review, not in-visit. [Microsoft
   HIMSS 2026 blog, verified 3-0]. India's EkaScribe is a
   voice-to-prescription documentation product with no live CDS on the
   scribe surface (Eka's CDS lives in a separate product, DocAssist).
   Sunoh.ai ($149/user/mo, US) is post-visit documentation. Abridge
   raised $300M at $5.3B (June 2025) — we cannot outspend anyone; we
   can only out-wedge them.

2. **Rx-first beats SOAP-first for Indian OPD.** Indian OPD
   documentation culture is prescription-pad-first; EkaScribe's own
   tagline is "Voice to Prescription." Our current pipeline produces a
   SOAP-style encounter note as the primary artifact — that's the US
   shape, not the Indian one. In a 3–7 minute consult the doctor needs
   the **Rx pad** (Dx line, meds, tests, advice, follow-up) finished
   and printable/WhatsApp-able at the moment the patient stands up.
   The SOAP note becomes the byproduct (for records, ABDM, referrals),
   not the product.

3. **The safety rail is the moat — if designed passively.** The
   alert-fatigue literature is unambiguous: ~90% physician override
   prevalence for interruptive alerts, but GPs are NOT anti-alert —
   their complaints are poor design, inaccurate content, and missing
   patient context [JMIR 2025 systematic review, 3-0]. The tested UX
   blueprint: **noninterruptive sidebar nudges by default, rare
   well-timed interruptive alerts for true criticals** [JMIR Human
   Factors, 3-0]. Our deterministic engines (interactions, red flags,
   chronic trends) are exactly the patient-context-gated, non-generic
   content the literature says doctors accept. Nobody in the category
   ships this live. That's the wedge.

---

## 2. What the verified evidence says (and how it changes the plan)

### 2.1 Adoption physics — what actually makes scribes stick

| Verified finding                                                                                                                                                     | Source                   | Design consequence                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| Kaiser TPMG: 7,260 physicians, ~2.5M encounters, sustained voluntary use — category works at scale                                                                   | NEJM Catalyst 2025 (3-0) | This is a real product category, not a demo                                     |
| Time savings are SMALL: ~22 s/use; after-hours docs −1.03 min/appt                                                                                                   | NEJM Catalyst (3-0)      | **Never pitch "save hours" — it's not supported**                               |
| The real driver: 84% said scribe improved patient interactions; 82% work satisfaction                                                                                | NEJM Catalyst (3-0)      | Position = restored attention + cognitive relief + end-of-clinic-done           |
| Per-visit usage is the binding constraint: even FREE, doctors used scribes in <⅓ of visits; ~15% never activated                                                     | UCLA RCT, NEJM AI (3-0)  | **Per-consult activation friction is THE metric.** Zero clicks between patients |
| Product execution decides outcomes: Nabla −9.5% time-in-note (P=.02) vs DAX no effect (P=.66) in head-to-head RCT                                                    | NEJM AI RCT (3-0)        | Category label buys nothing; latency + edit burden decide                       |
| Accuracy trust gap persists: clinically significant inaccuracies "occasionally" (2.7–2.8/5) even for best-funded products; 1 mild adverse event (omitted counseling) | NEJM AI RCT (3-0)        | Confirm-first UX everywhere; nothing auto-applies                               |

### 2.2 Technology — the fact that changes our ASR thinking

On the omi.health medical STT benchmark (PriMock57, 42 models, open
methodology, updated Apr 2026):

- **General-purpose Gemini-class LLM transcription beats dedicated
  medical ASR on medical-term accuracy**: Gemini 3 Pro 1.37% / Gemini
  2.5 Pro 1.52% medical-WER vs AssemblyAI medical 2.83%, Deepgram
  Nova-3 Medical 3.17%.
- **Drug-name error diverges 7–11×**: Gemini 3 Pro 1.1% vs Deepgram
  Nova-3 Medical 7.9%, Whisper-large-turbo 12.2%.

**ASR choice is a medication-safety decision, not a cost decision** —
especially for our voice-commanded Rx ("add atorvastatin 40"). Our
existing Gemini/Vertex transcription choice is validated by this data.

Two critical caveats (both verified as caveats):

- Those Gemini numbers are **batch** mode (~60 s/file), not streaming.
- The benchmark is **British English**, not Hinglish/Manglish or
  Indian-accented speech. **No Hinglish medical-ASR benchmark survived
  verification — we must build our own (see §3).**

### 2.3 Live CDS design rules (from the alert literature)

1. Default = **passive sidebar cards** (our Live Copilot rail). Never
   modal, never blocking, mid-consult.
2. Interruptive is reserved for **rare, critical, patient-specific**
   events — and even then prefer a **"before you close" gate** (unacted
   ACS red flag, contraindicated drug) over a mid-consult popup.
3. Every card must be **patient-context-gated** (this patient's meds,
   this patient's trend), never generic rule-firing.
4. **No one can prove "we avoid alert fatigue" by citation** — a May
   2026 JAMIA umbrella review found no standardized measurement.
   Opportunity: instrument accept/dismiss/override per card type from
   pilot day 1 and **publish Indian-OPD acceptance metrics** — that
   becomes our differentiating evidence and a sales asset.

---

## 3. Open questions the research could NOT verify (validate in weeks 1–2)

These produced no claims that survived adversarial verification.
Treat every number attached to them in this doc as an **estimate to
validate**, not a fact:

| Open question                                                                                              | Week-1/2 validation task                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hinglish/Manglish streaming WER for medical speech                                                         | Build a 50-consult benchmark set (consented recordings across 3 specialties); score Gemini Live vs Flash-batch-on-windows vs Sarvam/AI4Bharat; drug-name WER is the primary metric                                       |
| Real per-minute streaming costs at our shape                                                               | Meter actual token burn per consult in the pilot gateway; kill the O(n²) re-transcription first (see §5)                                                                                                                 |
| India competitor pricing (EkaScribe Pro is unpublished; HealthPlix/Practo/Eka EMR price points unverified) | 5 sales calls posing as clinic buyers; pull EkaScribe Pro price from checkout                                                                                                                                            |
| ABDM integration as a moat (real pull vs checkbox)                                                         | Ask the 10 pilot doctors: does ABDM/ABHA matter to you today?                                                                                                                                                            |
| CDSCO SaMD line for CDS claims                                                                             | One legal opinion. Until then: all copy says "documentation aid + reference information; the clinician confirms all clinical content" — no diagnostic claims. Confirm-first UX (already our pattern) is the safe posture |
| Willingness-to-pay in INR                                                                                  | Price-ladder test inside pilot (see §6)                                                                                                                                                                                  |

---

## 4. Product strategy — the V2 shape

### 4.1 The consult loop (the product IS this loop)

```
Patient walks in (token N)
  → doctor taps token / says "next patient"          [0 clicks target]
  → ambient capture on; patient context card visible
  → doctor talks + examines, glances at Copilot rail
  → Rx pad ASSEMBLES ITSELF live: Dx line, meds (voice-commanded or
    suggested), tests, advice, follow-up
  → red flag / interaction cards slide in passively; one tap = accept
  → "End" → before-you-close gate (unacted criticals only)
  → Rx printed / WhatsApp'd to patient; SOAP note + codes filed;
    ABDM push queued
  → next token                                        [≤10 s turnover]
```

### 4.2 What changes vs today

| Today (DV1–DV9)                                             | V2                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| SOAP-style encounter note is the artifact                   | **Rx pad is the artifact**; SOAP note auto-derived byproduct                                     |
| Copilot cards are informational                             | **One-tap actionable** (order ECG → orders API; accept codes → note; swap drug → Rx draft)       |
| Consult starts from encounter page (several clicks)         | **Token-queue home screen**; one tap (or voice) starts the next consult                          |
| Full rolling-buffer re-transcription every 4 s (O(n²) cost) | **Incremental window transcription** (the Sprint-57 transcribe-on-arrival pattern, applied live) |
| Mid-consult criticals just render                           | **Before-you-close gate** for unacted criticals                                                  |
| No metrics                                                  | **Per-card accept/dismiss/override instrumentation from day 1**                                  |

### 4.3 Positioning (evidence-constrained)

- Lead: _"Look at your patient, not your screen. The Rx writes itself."_
- Support: _"A second set of eyes on every consult"_ (interactions,
  red flags, trends — confirmed by you).
- Never: "save hours" (unsupported), "AI diagnosis" (regulatory).

---

## 5. Architecture V2

### 5.1 Components (keep / rebuild / cut)

**KEEP (proven, valuable):**

- `services/live-gateway` — WebSocket service, session auth (DV8
  HMAC token), event protocol. The bones are right.
- All deterministic engines in `@cureocity/clinical`: interactions,
  specialty templates, chronic trends, voice-command parser. These are
  the patient-context-gated CDS content the literature endorses.
- Contracts-first Zod event protocol (`live-encounter.ts`).
- DV9 live-note persistence; FHIR export; ABDM stub.
- The new 3-column live UI (capture bar / note / Copilot rail).

**REBUILD:**

1. **The audio pipeline** (the big one). Today the gateway re-runs
   Pass 1 + Pass 2 on the ENTIRE rolling buffer every 4 s — cost grows
   quadratically with consult length and latency degrades. Replace
   with incremental windows:
   - VAD + silence trimming at the edge (OPD audio is heavily silent).
   - Transcribe only NEW 15–30 s windows (Flash-class, streaming or
     micro-batch); append to running transcript. This is the
     therapist Sprint-57 "transcribe-on-arrival" pattern, applied live.
   - Deterministic engines run on transcript deltas (≈free, <100 ms).
   - A small **live reasoning pass** (Flash-class) every ~20–30 s on
     (delta + running state) emits/updates: Rx-pad draft, Dx line,
     coding candidates. Structured-output, temperature 0.
   - ONE **final pass** (Pro-class) at consult end: polished Rx pad +
     SOAP note + final codes. This is the only expensive call.
2. **The primary artifact**: `RxPadV1` contract (diagnosis line, meds
   with strength/frequency/duration, investigations, advice lines,
   follow-up) + print/PDF + WhatsApp share via the existing
   PatientShare rails. SOAP note derives from the same state.
3. **One-tap actions** on Copilot cards → existing orders /
   medication-orders / note APIs (they already exist from DV5).

**CUT (for now):**

- The batch differential tab as a separate surface (fold coding into
  the live rail + final pass).
- Any therapist-shaped surfaces in the doctor nav.
- ABDM beyond the stub until pilot doctors confirm pull (§3).

### 5.2 Latency budget (targets)

| Surface                                          | Target                                |
| ------------------------------------------------ | ------------------------------------- |
| Live transcript visible                          | ≤ 2 s from speech                     |
| Deterministic nudge (interaction/red-flag/trend) | ≤ 2.5 s from the triggering utterance |
| LLM Rx-draft / coding update                     | ≤ 10 s                                |
| Final Rx pad + note after "End"                  | ≤ 15 s                                |
| Between-patients turnover                        | ≤ 10 s, 0–1 clicks                    |

### 5.3 Cost per consult (ESTIMATE — validate by metering, §3)

Assumptions: 5-min consult, VAD trims to ~2.5 min effective audio;
Flash-class live passes; one Pro-class final pass; prompt caching on.

| Component                               | Est. ₹/consult |
| --------------------------------------- | -------------- |
| Incremental transcription (Flash-class) | 0.3 – 0.8      |
| Live reasoning micro-passes (Flash)     | 0.2 – 0.5      |
| Deterministic engines                   | ~0             |
| Final pass (Pro-class, once)            | 0.5 – 1.5      |
| **Total**                               | **₹1 – 3**     |

High-token doctor (80 consults/day × 26 days = 2,080 consults/mo):
**COGS ≈ ₹2,100–6,200/mo**, engineering target ≤ ₹2/consult →
**≤ ₹4,200/mo worst case**. The #1 cost lever is killing the O(n²)
re-transcription; #2 is VAD; #3 is Flash-for-live / Pro-only-at-end.

---

## 6. Pricing (recommendation to test, not fact)

Anchors: EkaScribe is freemium (5 consults/day free, Pro unpublished);
Sunoh $149/mo is the US mid-market anchor; a human assistant in India
costs ₹15–25k/mo; an 80-patient/day specialist grosses ₹40k–120k/DAY —
affordability is not the constraint, habit is.

| Tier            | Cap            | Price (test ladder) | Est. gross margin       |
| --------------- | -------------- | ------------------- | ----------------------- |
| Free            | 5 consults/day | ₹0                  | — (funnel, matches Eka) |
| Clinic          | 30/day         | ₹2,500 – 3,500/mo   | ~70–85%                 |
| High-volume OPD | unlimited      | ₹6,000 – 8,000/mo   | ~70%+ at ₹2/consult     |

Sell the high-volume tier as "less than half a human assistant, never
absent." Validate with a price ladder in the pilot (offer 3 prices to
3 cohorts). >70% gross margin holds if the §5 cost work lands.

---

## 7. The 90-day plan

### Days 1–15 — Foundations + truth

- Rebuild the gateway audio path: VAD + incremental windows + delta
  engines + Flash live pass + Pro final pass. Meter every token.
- Build the Hinglish/Manglish benchmark set (50 consented consults,
  3 specialties). Score candidates; **drug-name WER decides**.
- Legal opinion on CDSCO claim language.
- Instrumentation: per-card accept/dismiss/override events.

### Days 16–45 — The Rx-first product

- `RxPadV1` contract + live assembly + print/PDF + WhatsApp share.
- One-tap Copilot actions wired to real APIs; before-you-close gate.
- Token-queue home screen; ≤10 s next-patient turnover; "next patient"
  voice command.
- Host the gateway in-region (Vercel can't hold the socket); wire
  `NEXT_PUBLIC_LIVE_GATEWAY_URL` on prod.

### Days 46–75 — Pilot

- 5–10 high-volume doctors (2–3 specialties: general medicine,
  cardio, endo), onboarded personally.
- Success metrics (pre-registered, from the evidence):
  - **Per-consult activation rate** (target >60% of eligible consults
    by week 3 — vs the <33% UCLA baseline)
  - Edit burden: % Rx pads signed with ≤1 edit
  - Copilot acceptance rate per card type; override reasons
  - Between-patient turnover time
- Price-ladder test across pilot cohorts.

### Days 76–90 — Decide + publish

- Kill/scale decision per pre-registered metrics.
- Write up the pilot acceptance metrics (the JAMIA gap = nobody has
  standardized live-CDS acceptance data; Indian OPD data is novel) —
  this becomes the sales + credibility asset.
- If green: clinic-tier GTM through the pilot doctors' networks.

### Kill criteria (decide honestly)

- Drug-name WER on Hinglish benchmark >3% after tuning → the voice-Rx
  bet fails; fall back to docs-only until ASR improves.
- Per-consult activation <30% at week 3 despite friction work → the
  workflow doesn't fit; rethink form factor (e.g., assistant-operated).
- COGS can't get under ₹3/consult → re-price or cap tiers.

---

## 8. Why we win (and why incumbents can't just copy this)

1. **Structural**: Dragon/Abridge/Nabla monetize US enterprise notes;
   live CDS invites regulatory scrutiny they avoid by design
   (Microsoft explicitly pushes CDS to partners). Their price points
   (>$100/mo) can't reach Indian OPD.
2. **EkaScribe** (the real competitor) is documentation-first; its CDS
   lives in a separate product. Our fusion — scribe + live
   patient-gated safety in one surface — is the thing they'd have to
   re-architect to match.
3. **Evidence posture**: instrumenting + publishing acceptance metrics
   from day 1 builds the credibility moat the whole category lacks
   (verified: no standardized alert-fatigue measurement exists).
4. **We already own the hard parts**: deterministic engines, event
   protocol, session auth, FHIR/ABDM rails — the 90 days is workflow +
   audio-pipeline + artifact work, not research.
