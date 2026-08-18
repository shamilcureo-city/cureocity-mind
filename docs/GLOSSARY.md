# Glossary — the domain vocabulary

The load-bearing terms in the Cureocity Mind codebase, with where each lives.
For the big picture see **[`docs/ARCHITECTURE.md`](ARCHITECTURE.md)**; for the
entities see **[`docs/DATA_MODEL.md`](DATA_MODEL.md)**.

### ABDM / ABHA

India's **Ayushman Bharat Digital Mission** and the patient's **Ayushman
Bharat Health Account** address. Doctor vertical pushes prescriptions to a
patient's PHR via ABDM; `Client.abhaAddress` holds the linkage
(`api/v1/sessions/[id]/abdm/push`).

### Ask-next ("questions you haven't asked yet")

Live copilot rail that surfaces missing clinical questions. Two sources —
DIFFERENTIAL (from the model) and TEMPLATE (deterministic completeness);
managed by `AskNextManager` (`services/live-gateway/src/ask-next.ts`),
self-resolves once answered.

### Auth bypass

Outside production, missing Firebase env vars (or `AUTH_BYPASS=true`) resolve
practitioner requests to the seeded dev fixture `dev-firebase-uid-priya`.
Production ignores bypass and fails **closed**. See `docs/AUTH_SESSION.md`.

### CaptureMode

How a doctor encounter was captured: `LIVE` (WebSocket gateway) · `DICTATE` ·
`UPLOAD` (both batch). `Session.captureMode`; default in
`Psychologist.defaultCaptureMode`.

### CaseState + citation gate

The live reasoning substrate (`services/live-gateway/src/case-state.ts`). The
**citation gate** is the safety rule: a clinical finding is kept only if it
cites the id of a real, already-seen `Utterance` — no hallucinated evidence.

### Clinical Brief / Initial Assessment Brief

Pass 3 output. For TREATMENT/REVIEW sessions it's a `ClinicalReportV1`
(diagnosis candidates + evidence + plan); for INTAKE sessions it's an
`InitialAssessmentBriefV1`. `packages/contracts/src/clinical.ts`.

### Consent scope

A scoped patient grant (audio recording / AI note generation / cross-border
processing …). `Consent` rows + a per-session `consentSnapshot`.

### Contracts-first

Every DTO crossing the API boundary is a Zod schema in
`packages/contracts/src` — the single source of truth. Routes validate with
`parseJson` / `parseQuery`; never accept unvalidated JSON.

### DEK / envelope encryption / KMS

Client PII is encrypted with a per-tenant **Data Encryption Key** (DEK),
itself wrapped ("enveloped") by a KMS master key. DEKs live in
`PsychologistTenantKey`; the KMS is **GCP Cloud KMS** in prod (local-dev
scrypt key in dev). `packages/crypto` + `apps/web/lib/tenant-crypto.ts` +
`client-pii.ts`.

### Differential

The ranked list of candidate diagnoses the doctor copilot maintains live
(≤5, ICD-10, likelihood/trend/urgency, evidence for/against). Batch:
`PASS_9_DIFFERENTIAL`; live: folded into `PASS_11_REASONING`.

### DPDP

India's **Digital Personal Data Protection Act** — the compliance regime
that drives data residency (`asia-south1`), PII encryption, consent, and DSR.
See `docs/dpdp-data-flow.md`.

### DSR (Data Subject Rights)

DPDP-mandated patient rights: erasure, correction, data export, grievance,
nomination. Routes under `api/v1/clients/[id]/dsr/*`; erasure fulfilment is
admin-gated (`api/v1/admin/erasure`).

### FHIR

The health-record interchange format the doctor vertical exports to
(`api/v1/sessions/[id]/fhir`).

### Gemini passes

The AI stages. Therapist batch: **Pass 1** transcript · **Pass 2** note ·
**Pass 3** clinical brief · **Pass 4** therapy script · **Pass 5**
pre-session brief. Doctor: **PASS_9_DIFFERENTIAL** (batch), **PASS_10_FINDINGS**
(substrate, not run live), **PASS_11_REASONING** (the combined live pass). All
routed through `ModelRouter`. See CLAUDE.md §3 / §3b.

### Journey hub / stages

The therapist's per-client care arc: `INTAKE → ASSESSMENT → ACTIVE_TREATMENT
→ REVIEW_DUE → DISCHARGE_READY → DISCHARGED`. Composed deterministically in
`apps/web/lib/journey.ts`. See `docs/MEASUREMENT_BASED_CARE.md`.

### Live gateway

The standalone WebSocket service (`services/live-gateway`) running the doctor
live consult on Cloud Run. Has no DB — the browser relays its events to
`apps/web` to persist. CLAUDE.md §3b.

### Meter

Per-consult accounting of tokens / INR cost / latency percentiles
(`services/live-gateway/src/meter.ts` → `LiveConsultMetric`). Feeds the
`/app/insights` pilot dashboard.

### Mock backend

`LLM_BACKEND=mock` (default) gives deterministic AI output end-to-end with no
GCP creds — a complete offline dev/CI path. Output is tagged `[mock]`; share
snapshots strip the tag.

### ModelRouter

`packages/llm/src/model-router.ts` — the single dispatcher that maps each
pass to its backend (Vertex or mock) and fires the call-log hook.

### OPD

**Out-Patient Department.** The doctor's home is a zero-click OPD queue
(`/app/clinic`), ordered by `Session.tokenNumber` per IST clinic day.

### Reliable change

The deterministic (no-AI) verdict on PHQ-9 / GAD-7 movement — Improving / No
change / Worsening, with response + remission tags. Thresholds from the
validation literature: `packages/clinical/src/instruments/change-score.ts`
(PHQ-9 reliable change = 5 pts, remission ≤4; GAD-7 = 4 pts, remission ≤4).

### Review & Sign

The single doctor sign-off surface — a **component**
(`apps/web/components/app/ReviewAndSign.tsx`), not a route. Both the live and
dictate/upload paths converge on it.

### Rx pad

The doctor's prescription pad (`RxPadV1`). Assembled deterministically from
three sources: **CONTINUED** (patient's active meds), **SPOKEN** (voice
commands), **DRAFTED** (from the note). Nothing auto-prescribes. Editable via
typed patch ops; read-only once signed.

### Tenant / tenancy

One `Psychologist` = one tenant. Every row is scoped by `psychologistId`;
no records are shared across practitioners in V1.

### Utterance

A diarized unit of the live transcript with a stable `id`. Citations
(findings, Rx rows) reference utterance ids so the UI can highlight the
source. `packages/contracts/src/live-encounter.ts`.

### VAD / windowing

**Voice Activity Detection** — energy-based silence detection that cuts the
audio into 6–12s windows (`services/live-gateway/src/vad.ts`). This is what
makes live transcription O(n) instead of O(n²) re-transcription.

### Vertex Gemini

The LLM backend — Google Vertex AI Gemini (`@google/genai` SDK). Flash in
`asia-south1` (audio/DPDP), Pro global (transcript-only passes).

### WebAuthn signing

Note sign-off is passkey-gated: the sign route cryptographically verifies a
WebAuthn assertion when the account has a registered credential
(`WebAuthnCredential`). `REQUIRE_WEBAUTHN_SIGNING=true` forces enrollment.
