# Doctor Vertical — engineering build spec

This document is the **engineering blueprint** for a second product
vertical built on the existing Cureocity Mind codebase: an **ambient +
dictation AI scribe and in-room copilot for doctors**, with a different
landing page and dashboard but the **same repo, same APIs, same
infra** as the psychotherapist product.

It is a design document, not a record of shipped work. Nothing here is
implemented yet. Read order:

1. `CLAUDE.md` — how the code is organised + conventions (read first).
2. `docs/CLINICAL_COPILOT.md` — what the psychology product does today.
3. `docs/MEASUREMENT_BASED_CARE.md` — the Journey / reliable-change
   engine we will **reuse** for chronic-disease tracking (§9).
4. This file — the doctor vertical.

The guiding decision (made with the founder, June 2026): **one repo,
two verticals, discriminated by a `vertical` field**, with the first
release targeting the **high-volume super-specialty OPD** — the
hardest latency bar but the clearest India wedge.

---

## 1. Why a doctor vertical (the short version)

The long-form market + competitor research lives in the founder
conversation; the load-bearing facts:

- Ambient AI scribes are healthcare AI's first proven ROI category
  (~$600M in 2025). A 2025 multi-site study found physician burnout
  fell from **51.9% → 38.8% in 30 days**; a JAMA study found
  **burnout −21%, wellbeing +31%**.
- India has **64 doctors per 100k people** (global avg 150). The
  workload-reduction value proposition is existential, not a nicety.
- The frontier is moving from *"document what happened"* to
  *"help me think and act"* — live differentials, missed-question
  alerts, drafted orders, real-time coding. **No one owns this
  cleanly in India yet.**
- India incumbent to beat: **EkaScribe / Eka Care** (own LLM
  "Parrotlet", real-time transcription, 15+ Indian languages,
  auto-prescriptions, ABDM-compliant, offline, 3,000+ doctors). We
  differentiate on **(a)** the in-room reasoning copilot, **(b)** being
  EMR-agnostic / embeddable rather than forcing doctors onto our EMR,
  and **(c)** the longitudinal chronic-disease outcomes loop we
  already own.

**What we already have that competitors (especially US ones) cannot
easily match:** DPDP-compliant, asia-south1 residency-by-architecture;
per-tenant envelope encryption; an append-only audit log; code-mix
(Hinglish/Manglish/…) language modelling; a patient portal + WhatsApp
share channel; and a deterministic measurement-based-care loop.

---

## 2. The target user: high-volume super-specialty OPD

This segment choice drives every UX and latency decision below.

**The reality.** Super-specialty OPDs in India see **200+ patients/day
at ~2 minutes each**; even tertiary medical OPDs average ~7 minutes.
On 4G, multi-lingual, code-mix. In a 2-minute consult there often
*isn't* a long ambient conversation — the doctor speaks tersely or
dictates.

**Design implications (non-negotiable):**

| Reality | Product consequence |
| --- | --- |
| 2–3 min/patient | The note must be **~90% done at "end consult"**, not started then. The 20–40s batch wait (see §4) is a dealbreaker. |
| Doctor often dictates, not converses | Support a **dictation ⇄ ambient hybrid** in one capture surface — the live note builds either way. |
| 200 patients/day | Zero-friction patient switching; one-tap "next patient"; defaults that need no configuration. |
| Code-mix, regional language | Indic-strong **streaming** ASR, not English-first batch. |
| 4G / flaky connectivity | Live path must **degrade gracefully** to the existing batch path; never lose audio. |
| Specialty-specific | Per-specialty templates + gap-checks (a cardiology follow-up ≠ a nephrology review). |

The hero feature for this user is **Rail 3** (§4.3): the live
gap / red-flag sidebar that makes them faster *and* safer in the room.

---

## 3. Current architecture in one diagram (what we're extending)

```
record (apps/web/lib/audio, packages/audio)
   │  48kHz → decimate 16kHz → Int16 → 30s CHUNKS → IndexedDB → POST on end
   ▼
POST /api/v1/sessions/:id/generate-note        (note-orchestrator.ts)
   │  Pass 1 (ASR, ~10–15s)  ─┐ inline, synchronous
   │  Pass 2 (note, ~5–10s)  ─┘ Vertex Gemini, asia-south1 / global
   ▼
returns draftId ──► UI POLLS GET /note-draft every 1–2s
   │
   └─ Pass 3 (clinical analysis, ~15–30s) deferred via Next.js after()
```

Everything below this line is **reused unchanged**: audio capture,
decimator, encoder, KMS envelope encryption, tenant isolation, the
audit log, the `/p/[token]` patient portal, WhatsApp/email share,
Razorpay billing, observability counters, DPDP residency.

---

## 4. The core pivot: batch → live

### 4.1 Why today's flow is structurally too slow

Traced in the real code:

- **Audio is sliced into 30-second windows.**
  `packages/audio/src/types.ts:37` → `DEFAULT_CHUNK_SECONDS = 30`.
  `chunker.ts` reassembles server-side; nothing is transcribed until
  the session ends. (The chunker *does* accept a `chunkSeconds`
  option, but shrinking it only makes more batch calls — it does not
  produce interim, low-latency partials.)
- **It's batch, not streaming.** `packages/audio/src/types.ts:9-13`
  documents the pipeline as `chunker → IndexedDB → multipart POST`.
  There is **no WebSocket, no SSE, no streaming ASR anywhere in the
  repo.**
- **Passes run after upload.** `apps/web/lib/note-orchestrator.ts`
  runs Pass 1 → Pass 2 synchronously; Pass 3 is deferred via `after()`
  in `apps/web/app/api/v1/sessions/[id]/generate-note/route.ts`; the UI
  polls `apps/web/app/api/v1/sessions/[id]/note-draft/route.ts`.

Net: **20–40s of spinner after the session ends.** Fine for a 50-min
therapy session, fatal for a 2-min OPD consult.

### 4.2 The live architecture (doctor vertical)

Run a **parallel streaming path**. The batch path stays as the
finalizer and the offline fallback.

```
 mic ──100–250ms frames──► WS/SSE gateway ──► Streaming ASR  (<300ms interim)
 (services/ persistent svc, asia-south1)         │
        ┌───────────────────────────────────────┼─────────────────────────────┐
        ▼                       ▼                 ▼                             ▼
  RAIL 1 live transcript   RAIL 2 live note   RAIL 3 live GAPS & FLAGS    debounced
  (word-by-word)           skeleton fills      - questions not yet asked   "structurer"
                           (CC,HPI,ROS,PE,A&P)  - red flags / drug intxn    (Gemini Flash,
                           + Rx draft            - missing exam/ROS items    every 2–4s on
                                                 - undercoding nudge          rolling transcript)
        └──────────────────────────── "End consult" ──────────────────────────────┘
                                       │
                            Finalizer pass (2–5s): polish note + Rx + orders + AVS
                            → note already ~90% complete, not started from zero
```

**Three rails, one capture surface:**

- **Rail 1 — live transcript.** Interim + final tokens stream as the
  doctor/patient speaks. Sub-300ms perceived latency.
- **Rail 2 — live structured note.** A cheap fast model
  (Gemini Flash) re-reads the rolling transcript every 2–4s and
  incrementally fills the specialty note skeleton + a draft Rx. This
  is a *debounced, incremental* version of today's Pass 2 — not a new
  conceptual pass.
- **Rail 3 — live gaps & flags (the differentiator).** The same
  cadence emits a passive, dismissible sidebar:
  - ❓ *"Not yet asked: duration / fever / drug allergy"* (completeness
    vs. the specialty template's required HPI/ROS elements)
  - 🔴 *"Chest pain + breathlessness mentioned — consider ECG (ACS
    red flag)"*
  - 💊 *"Ibuprofen + warfarin — interaction"*
  - 🧾 *"Documentation supports ICD-10 X — add Y to avoid undercoding"*

Rail 3 must follow the psychology product's hard-won lesson
(`docs/MEASUREMENT_BASED_CARE.md` §2): **CDS that nags gets abandoned.**
Suggestions are passive, dismissible, in-workflow, and never block.

### 4.3 The transport + ASR decision (the one genuinely new build)

This is the only piece that is true net-new engineering. Three
sub-decisions, each with a recommendation:

1. **Streaming ASR engine** (ranked by India fit):
   1. **Indic-native streaming** (Sarvam / AI4Bharat-class) — best for
      Hindi/Tamil/code-mix, can run in-region for DPDP. More
      integration work. **Recommended for the high-volume Indic OPD
      target.**
   2. **Gemini Live API / Vertex streaming** (`@google/genai`, already
      our SDK) — lowest integration cost, keeps the Vertex
      relationship. **Verify asia-south1 streaming availability for
      residency before committing.**
   3. **Deepgram Nova-3 Medical** — sub-300ms, medical vocab, mature
      WS API; weaker Indic/code-mix, US vendor (residency review).
      Good for an English-first pilot only.
2. **Live transport.** The repo's first WebSocket/SSE endpoint.
   **Vercel serverless cannot hold a socket** — the streaming gateway
   runs as a small persistent service in asia-south1. This is exactly
   what the dormant `services/` NestJS scaffold is for (per CLAUDE.md
   §2 it is the "blueprint + unit-test home"); promote it to a real
   live service *only* for the streaming gateway. All non-streaming
   endpoints stay Next.js routes under `apps/web/app/api/v1/*`.
3. **Structurer cadence.** Debounce 2–4s; cap spend with the existing
   `apps/web/lib/cost-guard.ts` circuit; reuse
   `recordGeminiCall` in `packages/observability/src/metrics.ts`
   (add a `pass: 'structure'` / `'finalize'` union member).

---

## 5. Multi-vertical architecture on one repo

The codebase already has the precedent: **Pass 2 / Pass 3 are
discriminated unions on `Session.kind`** (`INTAKE | TREATMENT |
REVIEW`), and prompts branch on it (`CLAUDE.md` §"Session kinds").
We extend that pattern one level up with a **`vertical`
discriminator**. No fork, no second app.

### 5.1 The discriminator

Add `vertical: 'THERAPIST' | 'DOCTOR'` to the practitioner record and
thread it through the auth context exactly like `psychologistId` is
threaded today (`apps/web/lib/auth-page.ts`,
`apps/web/lib/auth-server.ts`). Every downstream choice — prompt,
contract, nav, landing — dispatches on it.

> **Naming.** Keep the `Psychologist` Prisma model name in v1 to avoid
> a 50-file rename; add the `vertical` + medical-credential fields to
> it (§11). A later sprint can introduce a `Practitioner` view/alias
> once the doctor vertical is proven. Renaming first is pure cost with
> no v1 value.

### 5.2 Reuse-vs-build map

| Layer | Today (psychology) | Doctor vertical | Effort |
| --- | --- | --- | --- |
| Landing page | `apps/web/app/page.tsx` (single, hardcoded copy) | `(marketing)` route group + `/for-doctors`; reuse all `lp-*` animation + layout primitives | Low |
| Dashboard nav | `components/app/Sidebar.tsx` (hardcoded therapy routes) | Branch nav on `vertical`; hide Templates/therapy-Journey, show Patients/Prescriptions/Orders | Low |
| Auth / identity | `Psychologist` + `rciNumber` (RCI) | Add `vertical`, `medicalRegNumber` (NMC/state council), `specialty` | Med |
| Pass 1 (ASR) | Batch, therapy prompt | **New streaming path** (§4) + medical ASR prompt; audio capture reused as-is | High |
| Pass 2 (note) | `TherapyNoteV1` / `IntakeNoteV1` | New `MedicalEncounterNoteV1` branch (§6) | Med |
| Pass 3 (reasoning) | `ClinicalReportV1` (ICD-11) | New `DifferentialDiagnosisV1` + live gap/flag schema (§6) | Med–High |
| Rx / orders | `prescription.ts` is *therapy-exercise* recs (not drug Rx) | New `MedicationOrderV1` + `ClinicalOrderV1` + interaction data (§6) | Med |
| Instruments + Journey + reliable-change | PHQ-9/GAD-7, discharge journey | **Retarget** to chronic-disease tracking (BP, HbA1c, weight) — the engine transfers (§9) | Med, high value |
| Reused as-is | audio capture, KMS encryption, audit log, tenant isolation, `/p/[token]` portal, WhatsApp/email share, Razorpay billing, DPDP residency, observability | same | ~0 |

### 5.3 Where the `vertical` branch lives

- **Prompt selection** — add a vertical-aware loader in
  `packages/llm/src/prompts/index.ts` (the prompts are currently
  hardcoded for psychotherapy). Mirror the existing `kind`-based
  branch.
- **Contract dispatch** — in the note/clinical routes, pick the Zod
  schema by `vertical` at `parseJson` time (same place `kind` narrows
  today).
- **ModelRouter** — add `passStructure` + `passFinalize` (live) and
  `passDifferential` to `ModelRouterOptions`
  (`packages/llm/src/model-router.ts`), wired in `apps/web/lib/llm.ts`
  with mock + Vertex variants (follow `CLAUDE.md` §5 "add a new pass").
- **Session defaults** — `apps/web/lib/session-defaults.ts` gains
  doctor session kinds (§6) and skips the therapy modality cascade for
  `DOCTOR`.

---

## 6. New contracts (`packages/contracts/src/`)

All new; follow the contracts-first convention (`CLAUDE.md` §4). Names
below are proposals.

**`medical-note.ts`**

- `MedicalEncounterNoteV1Schema` — SOAP is the shared backbone (we
  already render SOAP for therapy), specialised for medicine:
  - `chiefComplaint`
  - `hpi` (OLDCART-structured: onset, location, duration, character,
    aggravating/relieving, radiation, timing, severity)
  - `reviewOfSystems[]` (system → findings/denials)
  - `physicalExam` — **guarded** (see §10): findings the doctor must
    confirm; never model-invented
  - `vitals` (BP, HR, RR, temp, SpO₂, weight, …)
  - `assessment` (problem list + working diagnosis)
  - `plan` (orders, Rx refs, follow-up, patient instructions)
  - `linkedEvidence[]` — per field, the transcript segment + timestamp
    that produced it (the trust mechanism; §10)
- `MedicalSessionKindSchema` — e.g.
  `NEW_OPD | FOLLOW_UP | PROCEDURE | REVIEW_REPORTS | TELECONSULT`
  (super-specialty-shaped, not therapy `INTAKE/TREATMENT/REVIEW`).

**`live-encounter.ts`** (the streaming contracts)

- `PartialStructuredNoteSchema` — the Rail-2 incremental note (every
  field optional; emitted repeatedly during the consult).
- `EncounterGapSchema` — Rail 3: `{ kind: 'MISSING_QUESTION' |
  'RED_FLAG' | 'DRUG_INTERACTION' | 'CODING' , severity:
  'info'|'warn'|'critical', message, evidenceRef? }`.
- `LiveTranscriptDeltaSchema` — interim/final ASR tokens for Rail 1.

**`differential.ts`**

- `DifferentialDiagnosisV1Schema` — `candidates[]` with
  `{ condition, icd10Code, likelihood, supportingEvidence[],
  discriminatingQuestions[], suggestedWorkup[] }`. The medical analogue
  of `ClinicalReportV1` (`clinical.ts`), evidence-linked.

**`medication-order.ts`**

- `MedicationOrderV1Schema` — `{ drug, form, strength, dose, route,
  frequency, durationDays, prn?, instructions, interactionWarnings[] }`.
  (Note: the existing `prescription.ts` is therapy-exercise
  recommendation — do **not** overload it; this is a distinct drug Rx.)
- `ClinicalOrderV1Schema` — labs / imaging / referrals drafted from the
  same recording.

**`aftervisit.ts`**

- `AfterVisitSummaryV1Schema` — patient-facing, plain-language,
  locale-aware. Plugs into the **existing** `PatientShare` artefact
  pipeline (`CLAUDE.md` §"Patient-facing artefacts") so it renders on
  `/p/[token]` and shares to WhatsApp with zero new channel work.

---

## 7. New prompts + passes

Follow `CLAUDE.md` §5. The doctor passes:

| Pass | Input → Output | Backend | Cadence |
| --- | --- | --- | --- |
| `ASR-live` | audio frames → `LiveTranscriptDelta` | streaming engine (§4.3) | continuous |
| `structure` | rolling transcript → `PartialStructuredNote` + `EncounterGap[]` | Gemini Flash | debounced 2–4s |
| `finalize` | full transcript + last partial → `MedicalEncounterNoteV1` + `MedicationOrderV1[]` + `ClinicalOrderV1[]` | Gemini Pro | once, on end |
| `differential` | note + history → `DifferentialDiagnosisV1` | Gemini Pro (or clinical backend) | `after()` / on-demand |

- New prompts + version constants in `packages/llm/src/prompts/index.ts`
  (vertical-aware loader). The psychology prompts open with *"expert
  clinical scribe for an Indian psychotherapy practice"* — the doctor
  prompts need their own medical persona + specialty awareness.
- New types in `packages/llm/src/types/index.ts`; new Vertex backends
  modelled on the existing five; mock variants in
  `mock-gemini.backend.ts` (so `LLM_BACKEND=mock` stays a complete
  end-to-end dev path).
- Extend `recordGeminiCall` union in
  `packages/observability/src/metrics.ts`.

---

## 8. Patient & encounter data model (Prisma)

Minimise churn; add, don't rename.

- **`Psychologist`** (`prisma/schema.prisma`): add
  `vertical PractitionerVertical @default(THERAPIST)`,
  `medicalRegNumber String?`, `specialty String?`. New enum
  `PractitionerVertical { THERAPIST DOCTOR }`. Keep `PsychologistRole`
  (`THERAPIST | ADMIN`) for the admin gate.
- **`Client`** already models a patient with PII encryption + tenant
  isolation — reuse as the doctor's "Patient" (UI label only).
- **`Session`** → the encounter. Reuse; medical session kind stored
  alongside `kind` (or a parallel nullable column) so the union
  narrows by `vertical` first, then `kind`.
- **New** `MedicationOrder`, `ClinicalOrder` tables keyed by
  `(sessionId)`, tenant-filtered.
- **Vitals / instruments** reuse the instrument registry shape
  (`packages/clinical/src/instruments/`) — BP / HbA1c / weight become
  "instruments" with their own trend logic (§9).
- Per-sprint migration folder per `CLAUDE.md` §"Per-sprint prisma
  migrations"; append-only enum values with
  `ALTER TYPE ... ADD VALUE IF NOT EXISTS`.

---

## 9. The biggest reuse win: longitudinal chronic-disease tracking

`apps/web/lib/journey.ts` + `packages/clinical/src/instruments/change-score.ts`
(the Journey hub + deterministic reliable-change engine, see
`docs/MEASUREMENT_BASED_CARE.md`) are **not psychology-specific in
spirit**. A hypertensive's BP-control trajectory or a diabetic's HbA1c
trend is the *same* longitudinal-outcome problem the engine already
solves for PHQ-9/GAD-7:

- the per-client **arc** → per-patient disease-control arc
- **deterministic verdicts** (reliable change, remission thresholds) →
  control targets (e.g., BP < 140/90, HbA1c < 7%) — again deterministic,
  literature-anchored, **no AI needed for the verdict**
- the **next-best-action** → "due for HbA1c", "BP uncontrolled, titrate"
- the **shareable Progress Report** → patient-facing control trajectory
  on WhatsApp ("BP 150/90 → 130/80 over 8 visits")

This gives the doctor product a moat the pure-scribe competitors
(including EkaScribe) do **not** have: not "I documented your visit"
but "here is your disease-control trajectory." Retargeting is medium
effort, high value — keep the thresholds gated behind a clinician
sign-off + citation, exactly as the PHQ-9/GAD-7 thresholds are today.

---

## 10. Trust & safety (a feature, not just a gate)

Hallucination runs ~1–7% across vendors; **physical-exam sections are
the #1 fabrication risk** (AI documenting exams that never happened).
Every vendor disclaims clinical liability — the signing doctor owns the
note.

- **Linked evidence on every line** (`MedicalEncounterNoteV1.linkedEvidence`)
  — our strongest anti-hallucination move; we already capture
  per-segment, timestamped transcript. This matches the current market
  gold standard (Abridge's "Linked Evidence").
- **Guard the exam + vitals hardest** — never let the model assert a
  physical finding or a vital the doctor didn't state; require explicit
  confirmation. Default to "not examined" rather than inventing normals.
- **Mandatory sign-off** — reuse the existing
  "confirm every clinical call" + WebAuthn biometric sign pattern
  (`apps/web/app/api/v1/sessions/[id]/sign/route.ts`).
- **Disclaimer stays** — "Not a medical device; clinical decisions
  remain with the treating professional" (already on the landing
  footer). Correct regulatory posture for India.

---

## 11. India compliance & integration

- **DPDP + residency** — keep ASR + structurer in asia-south1; reuse
  per-tenant envelope encryption (`apps/web/lib/tenant-crypto.ts`) and
  the append-only audit log. Streaming gateway must also be in-region.
- **ABDM / ABHA / FHIR** (net-new module) — ABDM mandates FHIR EHR
  across 140k+ facilities; ABDM-linked prescriptions land in the
  patient's PHR via ABHA. Build FHIR export of `MedicalEncounterNoteV1`
  + `MedicationOrderV1` and ABHA linking → tender/hospital-ready and at
  parity with EkaScribe.
- **Code-mix Indic ASR** — our existing `spokenLanguages[]` multi-value
  model carries over; the streaming engine must handle mid-sentence
  switching natively.
- **Offline / 4G** — the live path degrades to the existing batch path
  on connection loss; never drop audio (IndexedDB persistence already
  exists in the capture pipeline).
- **Pricing** — global scribes are $99–$750/mo; reuse Razorpay per-seat
  billing priced for India (~₹999–2,499/seat/mo + clinic plans).

---

## 12. Audit actions to add

Per `CLAUDE.md` §6, add to `packages/contracts/src/audit.ts`
`AuditActionSchema`, the Prisma `AuditAction` enum, a migration
(`ALTER TYPE ... ADD VALUE IF NOT EXISTS`), and at least one literal
writer each (no ternaries — the chaos test regex is naïve):

- `ENCOUNTER_NOTE_DRAFTED`, `ENCOUNTER_NOTE_SIGNED`
- `MEDICATION_ORDER_DRAFTED`, `MEDICATION_ORDER_CONFIRMED`
- `CLINICAL_ORDER_DRAFTED`
- `DIFFERENTIAL_GENERATED`
- `AFTER_VISIT_SUMMARY_SHARED` (if clinically distinct from the generic
  `PATIENT_ARTEFACT_SHARED`)
- `ABDM_PRESCRIPTION_PUSHED` (when the ABDM module lands)

---

## 13. Phased roadmap

The task-level breakdown of these phases into sprints **DV0–DV8** lives
in `docs/DOCTOR_VERTICAL_SPRINTS.md`.

**Phase 0 — Spike (1 wk).** Prove the live loop on one specialty.
WS gateway + chosen streaming ASR + a structurer filling a note
skeleton live. Hardcoded, no auth. Validate **latency (< 5s note at
end-consult) + Indic/code-mix accuracy**. De-risks everything.

**Phase 1 — Vertical foundation (1–2 wk).** `vertical` enum + auth
threading; `/for-doctors` landing; doctor dashboard nav;
`MedicalEncounterNoteV1` contract + prompt as a new union branch; mock
backend end-to-end.

**Phase 2 — Live MVP (2–3 wk).** Productionise the streaming path
(in-region service), Rail 1/2/3, doctor sign-off, after-visit summary
into the existing portal. Batch path as fallback.

**Phase 3 — Copilot depth (3–4 wk).** Rx + interaction checks,
orders/referrals, ICD-10 coding nudges, specialty templates, voice
commands.

**Phase 4 — Moat (parallel).** ABDM/ABHA + FHIR; retarget Journey /
reliable-change to chronic-disease tracking (§9); offline degradation.

---

## 14. Open decisions (need a call before Phase 0 ends)

1. **ASR engine** — Indic-native (recommended for this segment) vs.
   Gemini Live vs. Deepgram. Gated on asia-south1 streaming
   availability + Indic accuracy benchmarks on real OPD audio.
2. **Streaming gateway home** — promote a `services/` NestJS app to a
   live in-region service, vs. a standalone lightweight socket service.
3. **First specialty template** — which super-specialty to template
   first (cardiology / nephrology / endocrinology …); drives the
   Phase-0 gap-check rules.
4. **EMR posture** — standalone app first vs. embeddable widget into
   existing hospital EMRs (the EkaScribe-differentiation angle).

---

## 15. Appendix — competitor reference

| Player | Edge relevant to us |
| --- | --- |
| Abridge | Best-in-KLAS; **Linked Evidence** (timestamp-mapped trust) — we match via `linkedEvidence` |
| Suki | Voice commands mid-visit; documentation + coding + Q&A in one |
| Ambience | Real-time coding (AutoCDI), prior-auth, drafted referrals |
| Heidi | **Live word-by-word transcription** + real-time SNOMED/ICD mapping — closest to our live vision |
| DeepScribe | Per-specialty models |
| **EkaScribe (India)** | Own LLM, real-time, 15+ Indian languages, auto-Rx, ABDM, offline, 3,000+ doctors — **the one to beat** |
| Augnito (India) | Voice dictation, structured reports |

Our wedge = the **live in-room reasoning copilot (Rail 3)** +
**EMR-agnostic** + **longitudinal chronic-disease outcomes** +
**DPDP residency** + India pricing — a combination none of the above
hold together today.
