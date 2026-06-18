# Doctor Vertical — sprint plan

The task-level execution plan for the doctor vertical specified in
`docs/DOCTOR_VERTICAL.md`. Read that build spec first — it explains the
*why* and the architecture; this file is the *how*, sprint by sprint.

Sprints are labelled **DV0–DV8** (Doctor Vertical) so they read as a
parallel track that slots into the main product's sprint numbering.
Estimated total: **~16–20 weeks**. The hardest, highest-risk work
(streaming) is de-risked first (DV0) and the medical note is proven on
the *existing batch pipeline* (DV3) **before** the live path (DV4) — so
contracts and prompts are validated independently of the streaming
build.

---

## 0. Definition of Done (every sprint obeys these)

Per `CLAUDE.md`, no task is complete until:

- **Contracts-first** — every new DTO is a Zod schema in
  `packages/contracts/src/`; routes use `parseJson` / `parseQuery`.
- **Audit** — every state-changing endpoint calls `writeAudit` with a
  **literal** action string; new actions are added to
  `AuditActionSchema` + the Prisma `AuditAction` enum + the migration,
  and the chaos test (`audit-coverage.spec.ts`) is green.
- **Migrations** — one per-sprint folder
  `YYYYMMDDHHMMSS_dv<N>_<desc>`; append-only enum values via
  `ALTER TYPE ... ADD VALUE IF NOT EXISTS`.
- **Mock parity** — every new Gemini pass has a mock backend in
  `mock-gemini.backend.ts`, so `LLM_BACKEND=mock` stays a complete
  end-to-end dev path (no GCP creds needed in CI).
- **Tenant isolation** — every query filters by the practitioner; the
  `vertical` discriminator narrows *before* `kind`.
- **No therapist regression** — the existing psychotherapy flow is
  untouched; its test suite stays green every sprint.
- **UI primitives** — compose `apps/web/components/ui/*` + design
  tokens; author no new primitives.

---

## 1. Sprint map

| Sprint | Theme | Est. | Exit criteria (demo) |
| --- | --- | --- | --- |
| **DV0** | Live-loop spike (de-risk) | 1 wk | < 5s note-at-end on a code-mix fixture; ASR + gateway decisions recorded |
| **DV1** | Vertical foundation: identity + routing | 1–2 wk | A doctor account logs in to a doctor-shaped (empty) dashboard; therapist flow unchanged |
| **DV2** | Doctor landing + patient/encounter model | 1 wk | Doctor creates a patient + starts an encounter (no AI yet) |
| **DV3** | Medical note on the **batch** path (parity first) | 1–2 wk | Doctor records (batch) → medical note → signs → shares after-visit summary |
| **DV4** | The **live** path (streaming MVP) | 2–3 wk | Note ~90% done at end-consult; gaps surface mid-consult; degrades on 4G drop |
| **DV5** | Rx + orders + interaction checks | 2 wk | Interaction-checked Rx draft + lab/referral drafts, confirmed + shared |
| **DV6** | Differential + coding + templates + voice | 2–3 wk | Per-specialty gap-checks + live differential + ICD-10 nudges + voice commands |
| **DV7** | Chronic-disease outcomes (the moat) | 1–2 wk | Per-patient control trajectory (BP/HbA1c) + shareable progress report |
| **DV8** | ABDM/ABHA/FHIR + offline + pilot hardening | 2 wk | Pilot-ready for one super-specialty clinic |

**Critical path:** DV0 → DV1 → DV3 → DV4 → DV5. **Parallelisable:** DV2
alongside DV1; DV7 alongside DV5/DV6; DV8's FHIR module alongside DV6.

---

## DV0 — Live-loop spike (de-risk the one new thing)

**Goal.** Prove the live transcription → live structured note loop and
measure latency on real code-mix audio. Throwaway code; the only output
that ships is a *decision*.

- **DV0.1** Stand up a minimal WebSocket gateway that accepts 16 kHz
  Int16 PCM frames and streams back interim/final transcript tokens.
  Decide its home: promote a `services/` NestJS app to a live in-region
  service vs. a standalone Node socket service (decision goes back into
  `docs/DOCTOR_VERTICAL.md` §14).
- **DV0.2** Behind the gateway, wire **two** ASR sources: (a) a mock
  that replays a fixture transcript token-by-token, (b) one *real*
  engine candidate (Gemini Live or an Indic-native streaming model).
- **DV0.3** Throwaway `/app/doctor-spike` page: capture mic with the
  existing `packages/audio` worklet + decimator but **stream frames**
  instead of chunking; render the live transcript (Rail 1).
- **DV0.4** Debounced "structurer" call (Gemini Flash, mock-first)
  every 2–4 s that fills a hardcoded note skeleton (Rail 2) and emits
  2–3 example gaps (Rail 3).
- **DV0.5** Benchmark on Hinglish/Manglish OPD fixtures: token latency,
  time-to-note at "end consult", transcription accuracy. Record results
  + the **ASR engine choice** and **residency finding** (asia-south1
  availability) in the build spec.

**Exit.** < 5 s note-ready at end-consult on a fixture; engine +
gateway decisions written down. No production code retained.

---

## DV1 — Vertical foundation: identity + routing

**Goal.** Introduce the `vertical` discriminator end-to-end. No
clinical features yet — pure plumbing.

- **DV1.1** Prisma: add `enum PractitionerVertical { THERAPIST DOCTOR }`
  and `vertical` (`@default(THERAPIST)`), `medicalRegNumber String?`,
  `specialty String?` to the `Psychologist` model. Migration
  `…_dv1_practitioner_vertical`. (Keep the model name; rename to
  `Practitioner` is deferred per spec §5.1.)
- **DV1.2** Thread `vertical` into the auth context in
  `apps/web/lib/auth-page.ts` + `apps/web/lib/auth-server.ts`; add a
  `requireDoctor()` / `requireTherapist()` guard pair beside the
  existing ones.
- **DV1.3** Onboarding branch (`apps/web/app/onboarding/page.tsx`):
  doctor sign-up collects medical registration number + specialty
  instead of RCI; gate with a new `DoctorOnboardingInputSchema`.
- **DV1.4** Branch the nav in `apps/web/components/app/Sidebar.tsx` on
  `vertical` — doctor sees Patients / Encounters / (placeholders for)
  Prescriptions; therapy-only items (Templates, therapy Journey)
  hidden.
- **DV1.5** Scaffold the vertical-aware prompt loader in
  `packages/llm/src/prompts/index.ts` (returns therapy prompts today; a
  `DOCTOR` switch arm returns a stub).
- **DV1.6** Scaffold (types only, no logic) the new contract files:
  `medical-note.ts`, `live-encounter.ts`, `differential.ts`,
  `medication-order.ts`, `aftervisit.ts`.
- **DV1.7** Seed a dev doctor fixture (mirror `dev-firebase-uid-priya`)
  so `AUTH_BYPASS` resolves a doctor in dev.

**Exit.** A doctor account logs in and sees a doctor-shaped (empty)
dashboard; the entire therapist flow + test suite is unchanged.

---

## DV2 — Doctor landing + patient/encounter model

**Goal.** The public face + the CRUD shell. Runs in parallel with DV1.

- **DV2.1** Add a `(marketing)` route group; build `/for-doctors`
  reusing the `lp-*` animation layer + `Container`/`ButtonLink`/`Reveal`
  primitives from `apps/web/app/page.tsx`. Doctor hero, "2 minutes per
  patient" framing, live-copilot demo, DPDP/ABDM trust cells.
- **DV2.2** Patient = reuse the `Client` model (PII encryption + tenant
  isolation already there); add a UI label map so `DOCTOR` renders
  "Patient" where therapist renders "Client".
- **DV2.3** Medical session kinds: add
  `MedicalSessionKindSchema` (`NEW_OPD | FOLLOW_UP | PROCEDURE |
  REVIEW_REPORTS | TELECONSULT`) and branch
  `apps/web/lib/session-defaults.ts` so `DOCTOR` skips the therapy
  modality cascade.
- **DV2.4** Encounter list + detail pages: minimally fork
  `apps/web/app/app/sessions/*` (or label-map them) into the doctor
  nav. No AI tabs yet.

**Exit.** A doctor creates a patient and starts an encounter; nothing
is transcribed yet.

---

## DV3 — Medical note on the batch path (parity first)

**Goal.** Validate the medical contracts + prompts on the **existing**
batch pipeline before touching streaming. This isolates clinical-NLP
risk from infra risk.

- **DV3.1** Finalise `MedicalEncounterNoteV1Schema` in
  `medical-note.ts` (CC, HPI/OLDCART, ROS, **guarded** PE, vitals,
  assessment, plan, `linkedEvidence[]`). Model on `note.ts` lenience
  patterns (e.g. the `mentalStatusExam` preprocess).
- **DV3.2** Author medical ASR + note prompts (+ version constants) in
  `packages/llm/src/prompts/index.ts`; add Vertex backends modelled on
  the existing five + mock variants in `mock-gemini.backend.ts`.
- **DV3.3** Branch `apps/web/lib/note-orchestrator.ts` + `ModelRouter`:
  `vertical === 'DOCTOR'` parses Pass 2 against
  `MedicalEncounterNoteV1Schema`; extend `ModelRouterOptions` +
  `recordGeminiCall` union (`packages/observability/src/metrics.ts`).
- **DV3.4** Note render UI: a doctor `NotesTab` variant showing
  SOAP/HPI/ROS/PE/A&P with per-field **linked-evidence** chips
  (the trust mechanism, spec §10).
- **DV3.5** Sign-off: reuse `…/sessions/[id]/sign/route.ts`; add
  `ENCOUNTER_NOTE_DRAFTED` + `ENCOUNTER_NOTE_SIGNED` audit actions
  (+ migration + writers).
- **DV3.6** After-visit summary: `AfterVisitSummaryV1Schema` →
  plug into the **existing** `PatientShare` pipeline
  (`share.ts` enum + `share-snapshots.ts` builder + `/p/[token]`
  render branch, per `CLAUDE.md` §"Patient-facing artefacts") + PDF.

**Exit.** With `LLM_BACKEND=mock`, a doctor records (batch) → gets a
medical note → signs → shares an after-visit summary to WhatsApp.
End-to-end green.

---

## DV4 — The live path (streaming MVP)

**Goal.** Replace batch with the 3-rail live experience on the doctor
capture surface. The flagship sprint.

- **DV4.1** Productionise the DV0 streaming gateway in asia-south1
  (DPDP residency); auth the socket against the practitioner session.
- **DV4.2** Integrate the chosen streaming ASR engine; handle
  interim vs. final tokens; emit `LiveTranscriptDelta` (Rail 1).
- **DV4.3** Capture surface: stream frames; keep the IndexedDB buffer
  and **degrade gracefully to the existing batch path** on socket loss
  (never drop audio).
- **DV4.4** Rail 2 — the `structure` pass: debounced 2–4 s, emits
  `PartialStructuredNote`; spend-capped via
  `apps/web/lib/cost-guard.ts`.
- **DV4.5** Rail 3 — the `gap/flag` pass: emits `EncounterGap[]`
  (missing question / red flag / coding); render as a **passive,
  dismissible** sidebar (heed the alert-fatigue lesson,
  `docs/MEASUREMENT_BASED_CARE.md` §2).
- **DV4.6** Finalizer pass on "End consult": full transcript + last
  partial → `MedicalEncounterNoteV1` (note is ~90% pre-filled).
- **DV4.7** Observability: add `structure` / `finalize` pass members to
  the metrics union; track time-to-note + structurer cost per encounter.

**Exit.** Live note is ~90% done at end-consult; gaps surface during
the consult; a forced 4G drop falls back to batch with no data loss.

---

## DV5 — Rx + orders + interaction checks

**Goal.** Move from "documents" to "acts" — the EkaScribe parity bar.

- **DV5.1** `MedicationOrderV1Schema` + `ClinicalOrderV1Schema`
  (`medication-order.ts`); `MedicationOrder` + `ClinicalOrder` Prisma
  tables keyed by `(sessionId)`, tenant-filtered; migration.
  (Do **not** overload the existing therapy `prescription.ts`.)
- **DV5.2** Wire a drug + interaction data source; run an
  interaction-check on every drafted Rx (the 💊 Rail-3 flag).
- **DV5.3** Auto-draft Rx from the transcript in the finalizer + live
  structurer.
- **DV5.4** Rx UI (confirm / edit dose-frequency-duration) + orders /
  referral-letter draft UI.
- **DV5.5** Audit: `MEDICATION_ORDER_DRAFTED`,
  `MEDICATION_ORDER_CONFIRMED`, `CLINICAL_ORDER_DRAFTED`; sign + share
  the Rx via the portal.

**Exit.** Doctor receives an interaction-checked Rx draft + lab/referral
drafts, confirms them, and shares the Rx.

---

## DV6 — Differential + coding + specialty templates + voice

**Goal.** The reasoning-copilot depth that earns daily loyalty.

- **DV6.1** `DifferentialDiagnosisV1Schema` + a `differential` pass
  (run via `after()` / on-demand like today's Pass 3) + UI panel with
  evidence + discriminating questions + suggested workup.
- **DV6.2** ICD-10 coding nudges / undercoding flags surfaced in
  Rail 3; `DIFFERENTIAL_GENERATED` audit action.
- **DV6.3** Specialty template registry (start with **cardiology**, the
  DV-segment pick) — each template defines required HPI/ROS/PE elements
  that drive the Rail-3 completeness gap-checks.
- **DV6.4** Voice commands mid-consult ("show last HbA1c", "add
  paracetamol 500 TDS × 3 days") — a command parser on the live
  transcript stream.

**Exit.** Per-specialty gap-checks + live differential + coding nudges +
working voice commands.

---

## DV7 — Chronic-disease outcomes (the moat)

**Goal.** Retarget the measurement-based-care engine — the reuse win in
spec §9. Parallelisable with DV5/DV6.

- **DV7.1** Add vitals/labs as "instruments" in
  `packages/clinical/src/instruments/` (BP, HbA1c, weight) with their
  own trend logic.
- **DV7.2** Retarget `apps/web/lib/journey.ts` +
  `packages/clinical/src/instruments/change-score.ts` to
  disease-control verdicts (BP < 140/90, HbA1c < 7 %) — deterministic,
  literature-anchored, **citation-gated** like the PHQ-9/GAD-7
  thresholds.
- **DV7.3** Patient-facing disease-control progress report
  ("BP 150/90 → 130/80 over 8 visits") via the existing portal +
  WhatsApp share.

**Exit.** Per-patient control trajectory + a shareable plain-language
report.

---

## DV8 — ABDM/ABHA/FHIR + offline + pilot hardening

**Goal.** India interoperability + production-readiness for the first
clinic.

- **DV8.1** FHIR export of `MedicalEncounterNoteV1` + `MedicationOrderV1`.
- **DV8.2** ABHA linking; push the prescription to the patient's ABDM
  PHR; `ABDM_PRESCRIPTION_PUSHED` audit action.
- **DV8.3** Harden offline degradation (4G drop, resume after refresh —
  reuse the chunker's `initialChunkIndex` resume path).
- **DV8.4** Billing: extend Razorpay per-seat to the doctor vertical
  (India pricing ~₹999–2,499/seat/mo + clinic plans); trial-cap at
  encounter-create.
- **DV8.5** Load test (extend `docs/load-test-results.md`), security
  review (`docs/security-audit.md`), and a pilot-onboarding runbook
  under `docs/runbooks/`.

**Exit.** Pilot-ready for one super-specialty clinic.

---

## 2. Risks & how the sequencing mitigates them

| Risk | Mitigation in this plan |
| --- | --- |
| Streaming is hard / latency unknown | **DV0** spikes it first; ship nothing else until the number is proven |
| Medical NLP quality (hallucinated exams) | **DV3** validates contracts/prompts on the batch path first; PE/vitals guarded + linked-evidence (spec §10) |
| Scope creep into a full EMR | Reuse `Client`/`Session`/portal/billing as-is; build only the net-new clinical surfaces |
| DPDP residency on streaming | DV0.5 records the asia-south1 finding before DV4 commits the engine |
| Breaking the live therapist product | `vertical` discriminator + "no therapist regression" in the DoD every sprint |
| Competing with EkaScribe's head start | Differentiate on DV4 Rail-3 copilot, DV6 reasoning, DV7 outcomes moat, EMR-agnostic — not on raw scribing parity alone |
