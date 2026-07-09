# CLAUDE.md — agent + developer guide

This document is the operational guide for AI agents (Claude Code, Claude
Agent SDK) and human developers working in the Cureocity Mind codebase.
For product context, read **[`docs/CLINICAL_COPILOT.md`](docs/CLINICAL_COPILOT.md)**
(the therapist vertical) and **[`docs/DOCTOR_VERTICAL.md`](docs/DOCTOR_VERTICAL.md)**
(the doctor vertical) — they explain what each product does. This file is
about _how the code is organised_ and the conventions to follow.

## 1. What this codebase is

**One platform, two practitioner verticals**, chosen per account by
`Psychologist.vertical: PractitionerVertical = 'THERAPIST' | 'DOCTOR'`.
Both share one Next.js app, one `Client` / `Session` schema, and the same
auth / audit / crypto / billing / Vertex-Gemini plumbing; they diverge in
the recording flow, the AI passes, and the UI surface. (The codebase was
therapist-only until the doctor vertical was grafted on at Sprint DV1.)

**Therapist — psychology co-pilot.** The therapist records a session in
the browser; five Gemini passes (§3) produce a transcript, a SOAP note (or
intake note), an ICD-11 clinical brief (or initial-assessment brief), a
step-by-step therapy script (read aloud to the client), and a pre-session
brief for the next visit. The therapist confirms each AI suggestion;
confirmed diagnoses + plans persist cumulatively. Patient-facing content
can be shared via WhatsApp / email / portal link. Sprint 19 made the
start-of-session flow clinically honest (intake vs treatment vs review);
Sprint 20 closed the **measurement-based-care loop** (Journey hub,
deterministic reliable-change verdict on PHQ-9 / GAD-7, passive
next-best-action, Discharge flow, plain-language Progress Report — see
**[`docs/MEASUREMENT_BASED_CARE.md`](docs/MEASUREMENT_BASED_CARE.md)**).

**Doctor — ambient live-scribe for OPD.** The doctor's home is a
zero-click OPD **queue**; "Start encounter" opens a **live** consult that
streams audio to a standalone WebSocket **gateway** (`services/live-gateway`,
§3b). As the doctor talks, the gateway streams back a live transcript, a
structured medical note, a **prescription pad**, and a passive three-rail
copilot (evolving differential, "questions you haven't asked yet", red-flags
/ drug-interactions, examine/order prompts). The doctor reviews + signs on a
single **Review & Sign** surface, shares an after-visit summary / Rx, then
taps "next patient". Capture can also be **dictate** or **upload** (both run
the batch medical-note path). See §3b + **[`docs/DOCTOR_VERTICAL.md`](docs/DOCTOR_VERTICAL.md)**.

Sprint timeline:

_Therapist track_ (pivoted at Sprint 13 from the original "AI scribe" plan):

- **Sprint 13** — Pass 3 (Clinical Analysis) + Clinical Brief tab
- **Sprint 14** — Pass 4 (Therapy Script) + Therapy Library
- **Sprint 15** — Patient CRM + share via WhatsApp / email / portal
- **Sprint 16** — Multilingual / code-mix-first (Manglish, Hinglish, …)
- **Sprint 17** — Pass 5 (Pre-Session Brief) + PHQ-9/GAD-7 + SafetyPlan + Competency dashboard
- **Sprint 18** — Therapist settings + WebAuthn registration + sign hardening
- **Sprint 19** — Scribing flow revamp: SessionKind (INTAKE/TREATMENT/REVIEW),
  expanded SessionModality, Pre-Flight panel replaces PreRecordWizard,
  IntakeNoteV1 + InitialAssessmentBriefV1 contracts
- **Sprint 20** — Measurement-based-care loop:
  Phase 1 Journey hub + reliable-change engine,
  Phase 2 client-facing Progress Report (PROGRESS_REPORT artefact),
  Phase 3 TreatmentEpisode + discharge flow + per-goal achievement
- **Sprint 21** — Diagnosis history card, intake-note AI modify, therapist
  My Practice (`/app/me`) view

_Doctor track_ (parallel; **DV** = foundation, **DS** = the Rx-first live
revamp — both SHIPPED):

- **DV0–DV3** — streaming spike; the `vertical` discriminator; `/for-doctors`
  landing; `MedicalEncounterNoteV1` proven on the batch pipeline; after-visit summary
- **DV4–DV8** — the live gateway; Rx + orders + drug-interactions; live
  differential (`PASS_9_DIFFERENTIAL`); chronic-disease reuse of the Journey
  engine; FHIR export + ABDM / ABHA push
- **DS0–DS9** — the Rx-first revamp: incremental O(n) live pipeline + metering;
  the Live Clinical Reasoning Engine (CaseState + `PASS_11_REASONING` + ask-next);
  the Rx pad; one-tap actions + before-you-close gate; the zero-click clinic
  queue; gateway hardening; pilot insights
- **DS10–DS11** — two-lane Plan Pad, then Consult UX v3: one Review & Sign
  surface, `CaptureMode` (LIVE / DICTATE / UPLOAD), gateway preflight + graceful
  degrade, first-class Examine / Order prompts

## 2. Repository layout

```
apps/
  web/                          # The single user-facing Next.js 15 app
                                # - Therapist UI under /app/*
                                # - Patient portal under /p/[token]
                                # - API routes under /api/v1/*

packages/                       # Shared TypeScript libraries
  contracts/                    # Zod schemas — single source of truth for DTOs
  llm/                          # Gemini pass backends + ModelRouter + prompts
  clinical/                     # CBT/EMDR engines, exercise catalog,
                                # PHQ-9/GAD-7 instruments, India crisis hotlines
  audio/                        # Web Audio capture (worklet + decimator + chunker)
  crypto/                       # Envelope encryption (KMS-backed)
  notifications/                # WATI / SendGrid / Twilio / WebPush adapters
  observability/                # OpenTelemetry metrics + audit-write counters
  storage/                      # S3 / Vercel Blob adapters

services/                       # Mostly NestJS scaffolds (unit-test home for
                                # clinical / audio / llm packages; NO prod traffic)
  live-gateway/                 # …EXCEPT live-gateway: a REAL standalone
                                # WebSocket runtime — the doctor live consult
                                # (§3b). Vercel serverless can't hold a socket.

prisma/
  schema.prisma                 # Single source of truth for the DB
  migrations/                   # Numbered (date-prefixed) per-sprint folders

docs/                           # Engineering documentation (see § 8)
infrastructure/                 # docker-compose for local dev (Postgres, Redis, etc.)
```

**Important architectural fact**: the HTTP request path is `apps/web` only —
every REST endpoint is a Next.js route under `apps/web/app/api/v1/*`, and the
NestJS apps in `services/` are scaffolds (unit-test home for shared packages)
that serve no production traffic. **The one exception is `services/live-gateway`**:
a real, deployed standalone WebSocket service that runs the doctor live consult
(§3b). It has **no DB access** — the browser relays its events back to `apps/web`
routes to persist them.

## 3. The five Gemini passes

```
record session                                          (apps/web/lib/audio)
   │
   ▼
PASS 1  audio → transcript + diarized speakerSegments + per-segment language
        + detectedLanguages[] + affectFeatures
        Vertex Gemini Flash (asia-south1) for DPDP residency
        packages/llm/src/backends/vertex-flash-india.backend.ts
        Hint: client.spokenLanguages[] is sent as a transcription bias
   │
   ▼
PASS 2  transcript → TherapyNoteV1 (SOAP + riskFlags + modalitySpecific)
        Vertex Gemini Pro (global)
        packages/llm/src/backends/vertex-pro-global.backend.ts
   │
   ▼
PASS 3  transcript + note + history → ClinicalReportV1
        - diagnosisCandidates[] with ICD-11 + confidence + supportingEvidence[]
        - assessmentGaps[], formulation, treatmentPlan, recommendedTherapies[]
        - crisisFlags[] with severity + indicators
        packages/llm/src/backends/vertex-clinical.backend.ts
        Therapist accepts / modifies / rejects each section in the
        Clinical Brief tab; confirmed diagnoses + plans persist to
        ClientDiagnosis + TreatmentPlan rows (cumulative).
   │
   ▼
PASS 4  therapy name + diagnosis + plan → TherapyScriptV1
        - openingScript, mainExercise.steps[] (with verbatim therapistSays
          + listenFor + 2-4 branches), closingScript, homework, watchpoints
        Two languages: output (therapist reads silently) vs spoken
        (read ALOUD — must match what the client understands)
        packages/llm/src/backends/vertex-therapy-script.backend.ts
        Cached per (clientId, cacheKey) where cacheKey = SHA-256 of inputs
   │
   ▼
PASS 5  client context → PreSessionBriefV1
        - contextLine, lastSessionRecap, todaysFocus, openingLine,
          watchpoints[], homeworkStatus, carryoverCrisis[], latestInstruments[]
        packages/llm/src/backends/vertex-brief.backend.ts
        Cached per (clientId, lastSessionId, language)
```

All five passes wired through `ModelRouter` in
`packages/llm/src/model-router.ts`. Mock backends in
`packages/llm/src/backends/mock-gemini.backend.ts` cover dev/CI.

## 3b. The doctor live-scribe pipeline

The doctor vertical replaces the batch five-pass flow with a **live**
consult. Audio streams from the browser to a standalone WebSocket
**gateway** (`services/live-gateway`) that runs the pipeline and streams
results back; the browser **relays** those events to `apps/web` routes to
persist them (the gateway has no DB access). Capture can instead be
**dictate** or **upload**, both of which run the batch medical-note path.

**Vertical routing.** `Psychologist.vertical` is set at onboarding
(`api/v1/onboarding/complete`). Page guards `requireOnboardedDoctor()` /
`requireOnboardedTherapist()` (`apps/web/lib/auth-page.ts`); API routes
re-check `vertical === 'DOCTOR'` (409 otherwise). `/app` redirects doctors
to `/app/clinic`; `Sidebar` / `MobileNav` branch on `vertical`;
`subjectNounFor(vertical)` (`apps/web/lib/vertical.ts`) maps
THERAPIST→"client" / DOCTOR→"patient". Doctors and therapists share ONE
`Client` and ONE `Session` table — the only doctor markers on a session
are `tokenNumber` (OPD token) and `captureMode`.

**The live gateway** (`services/live-gateway/src/`):

```
browser mic ──PCM 16kHz──▶  server.ts        WS entry; /healthz; token verify; conn caps
                            live-session.ts  per-consult pipeline; 1s pump() tick
   ▲                          │
   │ events (transcript /     ├─ vad.ts       Rail 1: energy VAD → O(n) windows
   │ note / finding /         │                (6–12s, cut at ≥600ms silence gap)
   │ reasoning / gap /        ├─ Pass 1       transcript / window — Flash, asia-south1
   │ rxDraft / meter /        ├─ Pass 2       medical note — Flash interim, Pro on finalize
   │ final)                   ├─ reasoning-loop.ts  debounced PASS_11_REASONING scheduler
   │                          │   └─ case-state.ts  CaseState + CITATION GATE (a finding is
   │                          │                     kept only if it cites a real seen
   │                          │                     utterance id) + differential (≤5)
   │                          │       └─ ask-next.ts  "questions you haven't asked" lifecycle
   │                          ├─ gaps.ts      Rail 3: deterministic red-flags + completeness
   │                          ├─ rx-pad.ts    deterministic Rx assembly (CONTINUED / SPOKEN /
   │                          │                DRAFTED sources; nothing auto-prescribes)
   │                          └─ meter.ts     per-consult tokens / INR / latency (DOC-9)
   └───────────────────────── auth.ts (HMAC start-token; FAILS CLOSED in prod w/o secret),
                              pool.ts (session cap + graceful "busy" shed)
```

**Passes.** The live copilot runs **`PASS_11_REASONING`** — the combined
differential + ask-next + red-flags + examine/order pass (folds findings
in): `packages/llm/src/backends/vertex-reasoning.backend.ts`, prompt
`REASONING_SYSTEM_PROMPT_V1`, normalised through
`backends/reasoning-normalise.ts` before Zod. `PASS_10_FINDINGS` is a
standalone findings substrate (wired through `ModelRouter`, not run live).
The batch differential is `PASS_9_DIFFERENTIAL`. Transcription is Pass 1
(Flash), the note is Pass 2 (Flash interim, Pro finalize). `LLM_BACKEND=mock`
gives a full offline live UX.

**Browser-relays-persistence.** `apps/web/components/app/DoctorLiveEncounter.tsx`
opens `NEXT_PUBLIC_LIVE_GATEWAY_URL` (default `ws://localhost:8787`) and POSTs to:

- `sessions/[id]/live-token` — mint the HMAC gateway token; also transitions
  SCHEDULED→IN_PROGRESS, writes the consent snapshot, sets `captureMode='LIVE'`,
  returns the patient's `activeMeds` (cross-visit interaction seeding).
- `sessions/[id]/live-note` — upsert the final note as a COMPLETED `NoteDraft`
  (+ encrypted transcript + `rxPad`), mark the Session COMPLETED, persist
  drafted orders + vitals.
- `sessions/[id]/live-metric` — one `LiveConsultMetric` row (`LIVE_CONSULT_METERED`).
- `sessions/[id]/live-suggestion` — one audit row per copilot event
  (`LIVE_SUGGESTION_SHOWN|ACTED|DISMISSED|AUTORESOLVED`); the pilot dataset
  (no dedicated table).
- `sessions/[id]/rx-pad` (GET / PATCH) — typed patch ops on the draft pad;
  server recomputes drug-interaction warnings; read-only once signed (`RX_PAD_EDITED`).
- `live/health` — server-side proxy to the gateway `/healthz` (the preflight).

**OPD queue.** Doctor home `/app/clinic` (`ClinicBoard`) reads
`loadClinicQueue()` (`apps/web/lib/clinic-queue.ts`); tokens are assigned in
the session-create tx via `nextClinicToken` (IST-day-scoped `Session.tokenNumber`).
`GET /api/v1/clinic/queue` is the API twin.

**Review & Sign** is a **component** (`apps/web/components/app/ReviewAndSign.tsx`),
NOT a route — both the live and dictate/upload paths converge on it. It shows
the medical note, the exam ledger, the two-lane `PlanComposer` (draft Rx vs
AI-suggested plan), the differential / orders / interop panels, then signs
(WebAuthn-gated, `ENCOUNTER_NOTE_SIGNED`) and shares the after-visit summary /
Rx (+ PDF). **Pilot insights**: `/app/insights` (`InsightsBoard` +
`apps/web/lib/insights.ts`), a rollup over `LiveConsultMetric` +
`LIVE_SUGGESTION_*` with anonymised CSV export.

**Doctor contracts** (`packages/contracts/src/`): `live-encounter.ts` (the
wire protocol — `LiveGatewayEvent` / `Command`, `Utterance`, `VoiceCommand`,
`MeterSummary`, `LiveNoteInput`, `LiveSuggestionEvent`), `live-reasoning.ts`,
`case-state.ts`, `rx-pad.ts` (`RxPadV1` + DS10-B patch ops), `clinic-queue.ts`,
`insights.ts`, `medical-note.ts` (`MedicalEncounterNoteV1`),
`medication-order.ts`, `chronic.ts`.

**Doctor schema** (`prisma/schema.prisma`): `PractitionerVertical`,
`CaptureMode {LIVE,DICTATE,UPLOAD}`, `Session.tokenNumber`,
`Session.captureMode`, `Psychologist.defaultCaptureMode`, `NoteDraft.rxPad`
(+ `TherapyNote.rxPad` snapshot at sign), `LiveConsultMetric`, `GeminiPass`
+= `PASS_9_DIFFERENTIAL` / `PASS_10_FINDINGS` / `PASS_11_REASONING`, plus the
chronic-care + orders models. Chronic-disease tracking **reuses** the Sprint-20
Journey / reliable-change engine.

**Gotchas.**

- The gateway **fails closed in production** without `LIVE_GATEWAY_SECRET`.
- There is **no committed Cloud Run manifest** — deploy is the `Dockerfile` +
  env; the browser default `NEXT_PUBLIC_LIVE_GATEWAY_URL` is the localhost dev URL.
- The gateway has **no Prisma** — never add DB writes there; relay to an
  `apps/web` route instead.
- `PASS_11_REASONING`'s prompt **version string is `REASONING_SYSTEM_PROMPT_V2`**
  even though the const is named `..._V1` — persist the string.
- Any new live copilot suggestion needs its lifecycle audit written via the
  `live-suggestion` route (four literal `writeAudit` calls) or the
  audit-coverage chaos test breaks.

## 4. Conventions to follow

### Contracts first

Every DTO crossing the API boundary is a Zod schema in `packages/contracts/src/`.
Routes call `parseJson(req, MySchema)` or `parseQuery(req.url, MySchema)`
(both in `apps/web/lib/validate.ts`). Never accept unvalidated JSON.

### Audit every state-changing endpoint

Use `writeAudit({ actorType, actorPsychologistId, action, targetType, targetId, metadata }, tx?)`
from `apps/web/lib/audit.ts`. Pass `tx` when the audit write should be
atomic with the business write.

There's a chaos test (`packages/contracts/src/audit-coverage.spec.ts`)
that scans for `action: 'X'` literals in `apps/web/{app,lib}` and asserts
every `AuditAction` enum value has at least one writer. If you add a new
audit action, either wire a writer or add it to `KNOWN_UNWIRED_ACTIONS`
with a comment.

The regex is naïve: `action: ternary ? 'A' : 'B'` will NOT match. Use two
separate `writeAudit` calls in an if/else instead.

### Tenant filtering

Every list/get filters by `psychologistId` from `requirePsychologistId(req)`.
Routes that touch a client also check `client.psychologistId === auth.value.psychologistId`.
There are no shared records across therapists in V1.

### Per-sprint prisma migrations

Each sprint owns a single migration directory named
`YYYYMMDDHHMMSS_sprint<N>_<description>`.

**Every migration MUST be idempotent (safe to replay).** The P3009 self-heal
in `scripts/vercel-db-setup.sh` rolls back a failed migration and re-runs its
SQL; a bare `CREATE`/`ADD` then fails with "already exists" and wedges every
deploy (the 2026-06-20 incident). So all DDL uses the guarded form:

- `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- `ALTER TYPE ... ADD VALUE IF NOT EXISTS` for new enum values
- a brand-new enum type wrapped in a guard block:
  ```sql
  DO $$ BEGIN CREATE TYPE "Foo" AS ENUM ('A', 'B');
  EXCEPTION WHEN duplicate_object THEN null; END $$;
  ```

`pnpm db:check-migrations` (`scripts/check-migration-idempotency.mjs`, wired
into CI) enforces this for every migration dated on/after the convention
cutoff. **Never edit an already-applied migration** to fix it — that changes
its Prisma checksum and trips drift detection. Fix it forward in a new,
guarded migration instead.

### Mappers

Prisma row → DTO conversion lives in `apps/web/lib/mappers.ts` (legacy
shapes) and `apps/web/lib/clinical-mappers.ts` (S13+ clinical shapes).
Defensive: invalid stored JSON falls back to safe defaults rather than
throwing — the UI keeps rendering.

### Component conventions

- Server components are the default. Mark client interactivity with
  `'use client'`.
- UI primitives live in `apps/web/components/ui/` (Button, Card, Badge,
  Container, Field). Compose these; don't author new ones.
- Use the design tokens (`var(--color-accent)`, `var(--color-ink-2)`,
  `var(--color-line-soft)` etc.) from the existing global CSS.
- Mock-backend output is tagged with `[mock]` so it's obvious in the
  UI; the `share-snapshots` builder strips this tag before sending
  content to patients.

### Languages (multi-value, code-mix-first)

- `Client.spokenLanguages: string[]` — therapist hint for what the
  client speaks. Real Indian clients are usually multi-value
  (`["ml", "en"]` for Manglish, `["hi", "en"]` for Hinglish).
- `Client.preferredLanguage: string` — single ISO 639-1 for patient-facing
  content (portal, reflection questions).
- `Session.language: string` — single ISO 639-1 for therapist-facing
  output (notes, brief).
- `Session.spokenLanguages: string[]` — Pass 1 fills this in from audio.
- Pass 4 `spokenLanguage` is special: the language for verbatim
  `therapistSays` text that's READ ALOUD to the client. Defaults to
  the client's first spoken language entry.

### Session kinds + nullable modality (Sprint 19)

- `Session.kind: SessionKind` (`INTAKE | TREATMENT | REVIEW`) is
  inferred server-side from cumulative state at session-create time —
  therapists can't override it. It drives Pass 2 / Pass 3 prompt
  branches (intake-note + initial-assessment-brief vs SOAP + clinical-
  brief vs review-verdict).
- `Session.modality` is **nullable**. The cascade in
  `apps/web/lib/session-defaults.ts` picks one (TreatmentPlan → Client
  → Psychologist → INTAKE fallback → SUPPORTIVE last-resort); the
  session-create route writes either `SESSION_MODALITY_INFERRED` (auto)
  or `SESSION_MODALITY_OVERRIDDEN` (therapist edited).
- `Pass2Output` + `Pass3Output` are **discriminated unions** on
  `kind`. Always narrow before reading the body:
  ```ts
  if (pass2.output.kind === 'INTAKE') {
    // pass2.output.intakeNote
  } else {
    // pass2.output.therapyNote
  }
  ```

### Measurement-based care + episodes (Sprint 20)

- `apps/web/lib/journey.ts` is the per-client arc composer. It
  derives the stage (`INTAKE` → `ASSESSMENT` → `ACTIVE_TREATMENT` →
  `REVIEW_DUE` → `DISCHARGE_READY` → `DISCHARGED`), per-instrument
  reliable-change verdicts, and a deterministic Next-Best-Action. No
  new tables — composed from existing cumulative state. See
  `docs/MEASUREMENT_BASED_CARE.md` for the full conceptual model.
- `packages/clinical/src/instruments/change-score.ts` is the
  deterministic reliable-change engine. Thresholds:
  - PHQ-9 reliable change = 5 pts; remission ≤ 4
  - GAD-7 reliable change = 4 pts; remission ≤ 4
  - "Response" = ≥50% reduction from baseline
    All from the validation literature — DO NOT loosen these without a
    clinician sign-off and a citation.
- A `TreatmentEpisode` is opened (`status = OPEN`) by the session-create
  route if the client has no open episode; closed via
  `POST /api/v1/clients/[id]/discharge` (status `DISCHARGED` or
  `TRANSFERRED`). A new session after a closed episode opens a fresh
  one. The journey composer flips to `DISCHARGED` stage only if no
  completed session happened after the close (returning client stays
  active).
- `TreatmentGoalProgress` is a **side table** keyed by
  `(treatmentPlanId, goalIndex)`. Toggling a goal's status NEVER
  re-versions the plan — historical plans keep their own progress.

### Patient-facing artefacts (`PatientShare`)

The portal at `/p/<token>` is the canonical surface; per-channel
messages (WhatsApp / email) link to it. Adding a new artefact type
(canonical pattern, follow Sprint 20 Phase 2 commit `a52e2ce`):

1. Add to `PatientShareArtefactTypeSchema` enum in
   `packages/contracts/src/share.ts` + add a `*SnapshotSchema` branch
   to `PatientShareSnapshotSchema` discriminated union + a
   `Share*InputSchema` branch to `ShareArtefactRefSchema`.
2. Add the enum value to `PatientShareArtefactType` in
   `prisma/schema.prisma` + a migration with
   `ALTER TYPE ... ADD VALUE IF NOT EXISTS`.
3. Add a builder dispatch in `apps/web/lib/share-snapshots.ts`
   (`buildSnapshot` switch).
4. Add `extractArtefactId(input)` mapping in the share route
   (`apps/web/app/api/v1/share/route.ts`).
5. Add a render branch in `apps/web/app/p/[token]/page.tsx`
   `SnapshotView` switch.
6. Add an audit action for the lifecycle event if it's clinically
   distinct from the generic `PATIENT_ARTEFACT_SHARED` (e.g.
   `PATIENT_PROGRESS_REPORT_SHARED`).

## 5. How to add a new Gemini pass

1. Add Zod input + output schema to `packages/contracts/src/`.
2. Add prompt + version constant to `packages/llm/src/prompts/index.ts`.
3. Add types (`Pass<N>Input` / `Pass<N>OutputSchema` / `IPass<N>Backend`)
   to `packages/llm/src/types/index.ts`.
4. Add Vertex backend in `packages/llm/src/backends/vertex-<name>.backend.ts`
   modelled on the existing ones (same SDK, safety-off, same wrap).
5. Add Mock backend to `packages/llm/src/backends/mock-gemini.backend.ts`.
6. Extend `ModelRouter` + `ModelRouterOptions` to include `pass<N>`.
7. Update `apps/web/lib/llm.ts` (and `services/scribe-service/src/llm/llm.module.ts`)
   to wire mock + Vertex variants.
8. Add the new pass value to the observability types:
   `packages/observability/src/metrics.ts` `recordGeminiCall` union.
9. Add migration adding the new `GeminiPass` enum value.
10. Add a route + UI + audit action.

The five existing passes are the template — pick the closest analogue.

## 6. How to add a new audit action

1. Add the literal to `packages/contracts/src/audit.ts` (`AuditActionSchema` enum).
2. Add it to the Prisma `AuditAction` enum in `prisma/schema.prisma`.
3. Add an `ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS '...'` to your
   sprint's migration.
4. Wire at least one writer in `apps/web/app/api/v1/*` or `apps/web/app/p/*`
   or `apps/web/lib/*` using `writeAudit`. The chaos test enforces this.
5. Use a literal string, not a ternary, so the chaos-test regex picks it up.

## 7. Common gotchas

- **Prisma format** rearranges whitespace in `schema.prisma`. Don't rely
  on exact whitespace for `Edit` tool matches — use `Read` first to see
  the current layout.
- **Vertex SDK** is `@google/genai` (the new one) NOT
  `@google-cloud/vertexai` (deprecated). The migration was done in early
  Sprint 13.
- **Auth bypass** auto-engages when Firebase env vars are missing OR
  `AUTH_BYPASS=true`. Requests then resolve to the seeded dev fixture
  (`dev-firebase-uid-priya`). Real Firebase env disables bypass.
- **Mock backends in dev** prefix outputs with `[mock]`. Share snapshots
  strip the tag automatically (`share-snapshots.ts` `stripBracketTag`).
- **Reflection questions** are not persisted; they're regenerated on the
  fly. The Share flow snapshots them inline into `PatientShare.snapshot`.
- **Pass 4 cacheKey** is bumped to v2 in Sprint 16 because it now
  includes `spokenLanguage`. Clearing cache on a language change is
  automatic.
- **Audit-coverage chaos test** scan roots: `apps/web/app/api`,
  `apps/web/lib`, `apps/web/app/p`. Writers in other directories won't
  be discovered — add the dir to `SCAN_ROOTS` in
  `packages/contracts/src/audit-coverage.spec.ts` if needed.
- **The `services/` NestJS apps build + test** but don't serve traffic;
  changes there only matter for the unit-test coverage of shared
  packages. Don't add live business logic there.
- **Pass 2 / Pass 3 output is a discriminated union on `kind`** (Sprint
  19). Older code that does `pass2.output.therapyNote.xxx` directly
  will not typecheck. Narrow first: `if (pass2.output.kind === 'INTAKE')`.
- **`mentalStatusExam` schema is lenient** — accepts either a prose
  string OR an object keyed by MSE element (Gemini Pro sometimes returns
  the structured form even when the prompt asks for prose). The
  preprocess flattens objects to "Appearance: …\\nBehaviour: …\\n…" before
  the string validator runs. See `packages/contracts/src/note.ts`.
- **Pass 3 (Clinical Analysis) runs in `after()`** in the generate-note
  route, not inline. The function's `maxDuration` is shared between
  request handling and the `after()` callback — on Vercel **Hobby**
  (60s cap regardless of `vercel.json`) Pass 3 sometimes gets killed.
  The Clinical Brief / Initial Assessment tabs poll + offer a
  synchronous "Re-run now" via `POST /clinical-analysis` which has its
  own 120s budget.
- **`GET /clinical-analysis` returns BOTH `report` and
  `initialAssessmentBrief`**. INTAKE-kind sessions store an
  `InitialAssessmentBriefV1` in `body` which fails the
  `ClinicalReportV1Schema` parse (returning `body: null` in `report`).
  Use `initialAssessmentBrief` from the response on intake sessions.
- **Plan goals are NOT versioned in the plan JSON** (Sprint 20 Phase 3
  follow-up). Per-goal status lives in `TreatmentGoalProgress`, a side
  table keyed by `(treatmentPlanId, goalIndex)`. Toggling the status
  doesn't re-version the plan.
- **The Journey hub auto-flips to `DISCHARGED`** when a terminal episode
  is the most recent — UNLESS a completed session happened after the
  close (a returning client stays active, the discharge becomes part of
  the history).
- **Auth/session — read `docs/AUTH_SESSION.md` before touching
  `apps/web/lib/auth-*.ts`, the login/onboarding flow, or sign-out.** The
  load-bearing rules from the 2026-06-20/21 incident:
  - **Any route with a side effect MUST be POST-only, never reachable by
    `GET`.** A `GET /api/v1/auth/signout` behind a `<Link>` got
    _prefetched_ by Next and silently cleared the `__session` cookie —
    the root cause of "rapid sidebar clicks bounce me to /login".
    Sign-out is now a `<form method="POST">` + POST-only route (303).
  - **Pages authenticate via the `__session` cookie ONLY** (a server
    component can't read a Bearer header off a `<Link>` nav). API routes
    accept cookie OR `Authorization: Bearer`. In-app client `/api/v1`
    fetches get the Bearer automatically via `AuthedFetchProvider`
    (mounted in the `/app` layout; it monkey-patches `window.fetch`).
  - **Deleting/wiping a `Psychologist` row invalidates that user's live
    cookie** — it verifies, but `findUnique` returns null → bounce to
    `/login`. Recovery: sign in again (re-provisions the row).
  - `verifySessionCookie` is called **without** `checkRevoked` (no
    per-request Firebase network call; no "sign out all devices"
    feature) and wrapped in `verifyWithRetry` for transient key-fetch
    races. Every redirect-to-login branch logs its cause
    (`[auth-page] …` / `[auth-server] …`) — grep Vercel runtime logs to
    diagnose; don't guess.
- **`prisma db seed` is NOT run on prod deploys** (removed from
  `scripts/vercel-db-setup.sh`): it injects the demo fixtures, whose
  fixed emails/RCI numbers collide with real signups (the onboarding
  "email already used by another account" 409). The script also
  **self-heals a P3009** stuck-migration freeze (rolls back the failed
  migration + retries once — safe only because every migration is
  idempotent). Run seed manually for local dev.
- **Pass 3 crisis-flag enum drift is normalised** before the Zod parse in
  `packages/llm/src/backends/pass3-normalise.ts` (`suicidal-ideation-risk`
  → `suicidal_ideation`, `moderate` → `medium`, …); unknown values still
  fail validation (clinical safety). Any new Pass-3 backend must route its
  raw JSON through `normalisePass3Output` before parsing.

## 8. Documentation map

| File                               | What it covers                                                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                        | Quick getting-started + current product summary                                                                                                                             |
| `CLAUDE.md`                        | This file — operational guide + conventions                                                                                                                                 |
| `docs/ARCHITECTURE.md`             | **System overview** — both verticals, request paths, deploy topology, the two pipelines (current-state, start here)                                                         |
| `docs/DATA_MODEL.md`               | **Schema guide** — the core spine, entity groups, Session lifecycle, key enums                                                                                              |
| `docs/GLOSSARY.md`                 | **Domain vocabulary** — the ~35 load-bearing terms decoded, with where each lives                                                                                           |
| `docs/ENVIRONMENT.md`              | **Config + deploy** — env-var matrix by subsystem + which var lives on Vercel vs Cloud Run                                                                                  |
| `docs/CLINICAL_COPILOT.md`         | Sprint 13-19 — clinical co-pilot pivot + intake-aware flow                                                                                                                  |
| `docs/MEASUREMENT_BASED_CARE.md`   | Sprint 20+ — Journey hub, reliable-change engine, episodes, Progress Report                                                                                                 |
| `docs/DOCTOR_VERTICAL.md`          | Doctor vertical — foundational architecture + rationale; **DV0–DV8 SHIPPED** (see § 3b)                                                                                     |
| `docs/DOCTOR_VERTICAL_SPRINTS.md`  | Doctor vertical DV0–DV8 sprint record — **SHIPPED** (per-sprint "Status: built" blocks)                                                                                     |
| `docs/DOCTOR_SCRIBE_V2_PLAN.md`    | Rx-first V2 strategy — § 5 architecture **SHIPPED**; § 3/6/7 (benchmark, pricing, pilot) forward-looking                                                                    |
| `docs/DOCTOR_SCRIBE_V2_SPRINTS.md` | Doctor Scribe V2 DS0–DS9 — live reasoning engine + Rx pad + OPD queue + insights, **SHIPPED**                                                                               |
| `docs/DS11_CONSULT_UX_SPRINTS.md`  | Consult UX v3 (DS11.1–11.8) — live-first single Review & Sign surface + CaptureMode, **SHIPPED**                                                                            |
| `docs/SPRINT_21.md`                | Sprint 21 incremental polish (diagnosis history, intake modify, My Practice, goal status)                                                                                   |
| `docs/EXECUTION_PLAN.md`           | **Historical** — original 13-sprint plan; superseded by CLINICAL_COPILOT for Sprint 13+                                                                                     |
| `docs/SETUP.md`                    | Account procurement + env var matrix per sprint                                                                                                                             |
| `docs/dpdp-data-flow.md`           | DPDP compliance data flows + DSR endpoints + cross-border                                                                                                                   |
| `docs/security-audit.md`           | OWASP top-10 + secrets + IAM matrix                                                                                                                                         |
| `docs/AUTH_SESSION.md`             | **Auth & session model** — `__session` cookie, page vs API guards, Bearer self-heal, the sign-out-must-be-POST rule, "bounced to /login" troubleshooting (2026-06 incident) |
| `docs/runbooks/README.md`          | Operational runbooks index                                                                                                                                                  |
| `docs/load-test-results.md`        | Pre-pilot load test record                                                                                                                                                  |

## 9. Running the codebase locally

```bash
nvm use                              # Node 22 LTS
corepack enable                      # pnpm
pnpm install
cp .env.example .env.local           # fill in the bits you have
pnpm exec prisma generate
DATABASE_URL=... pnpm exec prisma migrate deploy
DATABASE_URL=... pnpm exec prisma db seed
pnpm --filter @cureocity/web dev     # http://localhost:3000
```

`LLM_BACKEND=mock` (default) is a complete end-to-end path — record →
transcript → note → clinical brief → therapy script → pre-session brief
all run with deterministic mocks. No GCP creds needed for dev.

## 10. Critical files / where to look first

| When you want to…                                | Start here                                                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Add a new API endpoint                           | `apps/web/app/api/v1/sessions/[id]/note/modify/route.ts` (the canonical pattern)                                                 |
| Add a new Gemini pass                            | `packages/llm/src/backends/vertex-pro-global.backend.ts` + this CLAUDE.md § 5                                                    |
| Add a new tab on the session detail page         | `apps/web/app/app/sessions/[id]/page.tsx` + `apps/web/components/app/SessionWorkspaceTabs.tsx`                                   |
| Add a new audit action                           | `packages/contracts/src/audit.ts` + this CLAUDE.md § 6                                                                           |
| Change the SOAP note shape                       | `packages/contracts/src/note.ts` (`TherapyNoteV1Schema`)                                                                         |
| Change the intake note shape                     | `packages/contracts/src/note.ts` (`IntakeNoteV1Schema`)                                                                          |
| Change the Clinical Brief shape                  | `packages/contracts/src/clinical.ts` (`ClinicalReportV1Schema`)                                                                  |
| Change the Initial Assessment Brief shape        | `packages/contracts/src/clinical.ts` (`InitialAssessmentBriefV1Schema`)                                                          |
| Add a UI primitive                               | Don't. Compose existing ones in `apps/web/components/ui/`                                                                        |
| Add a patient-facing share artefact type         | `packages/contracts/src/share.ts` + `apps/web/lib/share-snapshots.ts` + `apps/web/app/p/[token]/page.tsx`                        |
| Curate a new scored instrument                   | `packages/clinical/src/instruments/index.ts` + add tests                                                                         |
| Add a new India crisis hotline                   | `packages/clinical/src/crisis.ts`                                                                                                |
| Edit the session-start cascade                   | `apps/web/lib/session-defaults.ts` + `apps/web/app/api/v1/clients/[id]/session-defaults/route.ts`                                |
| Change the Journey hub / reliable-change verdict | `apps/web/lib/journey.ts` + `packages/clinical/src/instruments/change-score.ts`                                                  |
| Change the Progress Report copy                  | `apps/web/lib/progress-report.ts` (deterministic — no LLM) + portal render branch in `apps/web/app/p/[token]/page.tsx`           |
| Open / close a treatment episode                 | `apps/web/app/api/v1/sessions/route.ts` (opens) + `apps/web/app/api/v1/clients/[id]/discharge/route.ts` (closes)                 |
| Toggle a goal status                             | `apps/web/app/api/v1/treatment-plans/[id]/goals/[index]/route.ts`                                                                |
| Work on the doctor live consult (gateway)        | `services/live-gateway/src/live-session.ts` (+ `vad`/`case-state`/`reasoning-loop`/`rx-pad`) — see § 3b                          |
| Change the live reasoning pass                   | `packages/llm/src/backends/vertex-reasoning.backend.ts` + `reasoning-normalise.ts` + prompt `REASONING_SYSTEM_PROMPT_V1`         |
| Persist a live gateway event                     | Relay from `apps/web/components/app/DoctorLiveEncounter.tsx` → an `apps/web/app/api/v1/sessions/[id]/live-*` route               |
| Change the OPD queue / token assignment          | `apps/web/lib/clinic-queue.ts` + `apps/web/app/app/clinic/page.tsx` + `apps/web/app/api/v1/clinic/queue/route.ts`                |
| Change the doctor Review & Sign surface          | `apps/web/components/app/ReviewAndSign.tsx` (a component — both live + batch converge here)                                      |
| Change the Rx pad                                | `packages/contracts/src/rx-pad.ts` + `services/live-gateway/src/rx-pad.ts` + `apps/web/app/api/v1/sessions/[id]/rx-pad/route.ts` |
| Change doctor capture modes                      | `apps/web/components/app/StartEncounterButton.tsx` + `CaptureMode` in `prisma/schema.prisma` + `defaultCaptureMode`              |
| Debug auth / "bounced to /login"                 | `docs/AUTH_SESSION.md` (log-line → cause table) + `apps/web/lib/auth-page.ts` + `apps/web/lib/auth-server.ts`                    |
| Add a route with a side effect                   | Make it **POST-only** (prefetchers fire `GET`). Pattern: `apps/web/app/api/v1/auth/signout/route.ts`                             |
| Make a client component call `/api/v1`           | Just `fetch('/api/v1/...')` — `AuthedFetchProvider` adds the Bearer token (`apps/web/components/app/AuthedFetchProvider.tsx`)    |
| Change the Pass-3 crisis-flag normaliser         | `packages/llm/src/backends/pass3-normalise.ts` (+ its spec) — wired into `vertex-clinical.backend.ts`                            |

## 11. What's NOT in scope (still on the backlog)

These gate a real Indian pilot. **Critical-path items live at the top.**

**Pilot-blocking (security + identity — needs your env to verify):**

- **Real Firebase auth cutover** — DONE IN CODE (Sprint 31+) and now
  **exercised live in prod** end-to-end (real Google sign-in → onboard →
  record → notes) as of the 2026-06-20/21 session-auth incident.
  `currentPsychologist()` + the API guards verify the real `__session`
  Firebase cookie / Bearer token; `isAuthBypassed()` fails closed on
  Vercel production when Firebase env is missing. The session path was
  hardened during the incident (redirect-cookie mint, Bearer self-heal,
  verify-retry, **sign-out-must-be-POST**) — see `docs/AUTH_SESSION.md`.
  Remaining work is OPERATIONAL only: set `FIREBASE_PROJECT_ID/
CLIENT_EMAIL/PRIVATE_KEY` on the prod deployment (then bypass
  auto-disables).
- **PII field encryption rollout** — DUAL-WRITE DONE for every Client
  PII field: `contactPhone` + `contactEmail` (Sprint 32) and `fullName`
  (Sprint 54), across create / update / DSR-correction + the
  `/admin/encryption/backfill` route, via `apps/web/lib/tenant-crypto.ts`
  (LocalDevKmsProvider in dev). READ CUTOVER DONE (Sprint 72) + **PLAINTEXT
  DROP DONE (S32 Phase 2, 2026-07)**: Google Cloud KMS is live in prod
  (`KMS_BACKEND=gcp-kms`, asia-south1, over the REST API via `GcpKmsProvider`
  in `packages/crypto` + `apps/web/lib/gcp-kms-rest.ts`, reusing the Vertex
  service account `GOOGLE_APPLICATION_CREDENTIALS_JSON` — no gRPC SDK, no new
  credential), and the legacy plaintext columns (`fullName` / `contactPhone` /
  `contactEmail`) were **DROPPED**. `apps/web/lib/client-pii.ts` is now the
  single **decrypt-only** read path — no plaintext fallback: `resolveClientPii`
  / `decryptClientField` decrypt the `*Encrypted` columns and render `''`
  (logged) on an undecryptable value. Writes (create / update / DSR-correction)
  set only the `*Encrypted` columns. Remaining is OPERATIONAL: any pre-cutover
  prod row still holds old local-dev ciphertext that won't decrypt under the GCP
  key — run `/admin/encryption/backfill` for those (else they render blank; a
  visibly-broken row can be archived from its roster). `AwsKmsProvider` stays
  in `packages/crypto` for portability but is not wired in apps/web.
  `NoteDraft.transcriptEncrypted` now
  dual-writes at the source (note-orchestrator, Sprint 54) + backfill.
  `JournalEntry.contentEncrypted` column exists but has no live
  `apps/web` write path (journal creation is a patient-app /
  continuity-service concern) — nothing to wire there yet.
- **WebAuthn-bound signing** — the sign route requires + cryptographically
  verifies an `assertion` whenever the account has ≥1 registered credential
  (Sprint 18 → 33). Sprint 72 added `REQUIRE_WEBAUTHN_SIGNING=true` (env,
  default off, skipped under auth bypass): when set, an account with **no**
  registered passkey is refused (403) until it enrols — forcing enrollment
  before signing. Remaining work is OPERATIONAL: flip the flag on in prod
  once pilot therapists have registered a passkey.

**Big features (need scoping before a blanket build):**

- **Multi-tenant Clinic + roles** — Clinic + membership exist (Phase 2
  metrics), but billing is still per-therapist; clinic-plan billing
  isn't built.
- **Billing** — Razorpay DONE (Sprint 53): trial-cap enforcement at
  session-create + Checkout + webhook + Plan page. Self-serve lifecycle
  DONE since: renewal reminders (`app/api/v1/cron/billing-reminders`),
  pause/resume/**cancel** (`app/api/v1/billing/lifecycle` + `PlanManageButtons`),
  and receipt/invoice PDFs (`app/api/v1/billing/payments/[id]/invoice` +
  `apps/web/lib/invoice.ts`). Remaining: refunds + clinic-plan billing.
  (Stripe explicitly out of scope.)
- **Observability stack** — Sentry + OTel are WIRED, not just counters:
  `@sentry/nextjs` (`apps/web/sentry.client.config.ts` + `instrumentation.ts`
  - `global-error.tsx`) and the OTel SDK (`packages/observability/src/sdk.ts`).
    Remaining is OPERATIONAL/config only — set `SENTRY_DSN` (+ OTLP endpoint)
    on the prod deployment; a Grafana/collector backend is optional.
- **Pilot account provisioning + first-5-therapist onboarding** —
  manual.

**Smaller follow-ups carried over from Sprint 20-21:**

- **Intake-note sign-off** — DONE (Sprint 49 + Sprint 55):
  `SignNoteInputSchema` is now a `SignedNoteContent` union and the
  sign route narrows by `session.kind`; intake notes sign + share
  (`SIGNED_INTAKE_NOTE`) + PDF (Sprint 49). Post-sign revision
  through `/note/edit` accepts a kind-discriminated
  `ReviseNoteInputSchema` and writes per-field `NoteEdit` rows for
  intake notes at parity with treatment notes (Sprint 55).
- **Multilingual progress report** — schema is locale-aware; copy is
  English-only and needs validated translations (do not machine-translate).
- **More scored instruments** (WHODAS-2, PCL-5, …) — registry supports
  it; validated item wording required.
- **Treatment-plan inline edit** — DONE (Sprint 35): the Clinical Brief's
  plan section has an `Edit and accept` path (`PlanEditor` in
  `apps/web/components/app/ClinicalBriefTab.tsx`) that POSTs `action: 'modify'`
  with the edited `{ treatmentPlan }` to
  `app/api/v1/clinical-reports/[id]/sections/[section]` (versions the plan).

**Doctor vertical (§ 3b) — SHIPPED, not backlog.** DV0–DV8 + DS0–DS11 are
built and live; only operational items remain: set the gateway's prod URL
(`NEXT_PUBLIC_LIVE_GATEWAY_URL`) + `LIVE_GATEWAY_SECRET`, and the forward-
looking GTM work (Hinglish ASR benchmark, pricing, first-doctor pilot) in
`docs/DOCTOR_SCRIBE_V2_PLAN.md` § 3/6/7.

When asked to "do the next thing", default to the pilot-blocking
section unless the user has redirected. **NB:** this backlog drifts stale —
much of it has been built since it was written (treatment-plan edit,
billing lifecycle, observability wiring, the PII plaintext drop were all
listed as open but are done). VERIFY a backlog item against the code before
building it.
