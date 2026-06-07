# CLAUDE.md — agent + developer guide

This document is the operational guide for AI agents (Claude Code, Claude
Agent SDK) and human developers working in the Cureocity Mind codebase.
For product context, read **[`docs/CLINICAL_COPILOT.md`](docs/CLINICAL_COPILOT.md)**
first — it explains what the product currently does. This file is about
_how the code is organised_ and the conventions to follow.

## 1. What this codebase is

A clinical co-pilot for Indian psychotherapists. The therapist records
a session in the browser; Gemini passes produce a transcript, a SOAP
note (or intake note), an ICD-11 clinical brief (or initial-assessment
brief), a step-by-step therapy script (read aloud to the client), and
a pre-session brief for the next visit. The therapist confirms each
AI suggestion; confirmed diagnoses + plans persist cumulatively.
Patient-facing content can be shared via WhatsApp / email / portal link.

Sprint 19 reworked the start-of-session flow to be clinically honest
(intake vs treatment vs review). Sprint 20 closed the
**measurement-based-care loop**: the therapist now sees a per-client
arc (Journey hub), a deterministic reliable-change verdict on PHQ-9 /
GAD-7, a passive next-best-action, an explicit Discharge flow, and
shares a plain-language Progress Report with the client. Read
**[`docs/MEASUREMENT_BASED_CARE.md`](docs/MEASUREMENT_BASED_CARE.md)**
for the conceptual model.

Originally a 13-sprint "AI scribe" plan; pivoted at Sprint 13 to
"clinical co-pilot". Sprint timeline:

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

services/                       # NestJS scaffolds (NOT the live request path).
                                # Kept as the "blueprint + unit-test home"
                                # for clinical / audio / llm packages. Live
                                # requests go through apps/web/app/api/v1/*.

prisma/
  schema.prisma                 # Single source of truth for the DB
  migrations/                   # Numbered (date-prefixed) per-sprint folders

docs/                           # Engineering documentation (see § 8)
infrastructure/                 # docker-compose for local dev (Postgres, Redis, etc.)
```

**Important architectural fact**: the live request path is `apps/web` only.
The NestJS services in `services/` exist as scaffolds — they hold unit
tests for shared packages and document how a future microservice split
would look — but they do not handle production traffic. Every API
endpoint is a Next.js route under `apps/web/app/api/v1/*`.

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
`YYYYMMDDHHMMSS_sprint<N>_<description>`. Append-only enum values use
`ALTER TYPE ... ADD VALUE IF NOT EXISTS` so re-runs are idempotent.

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

## 8. Documentation map

| File                             | What it covers                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `README.md`                      | Quick getting-started + current product summary                                           |
| `CLAUDE.md`                      | This file — operational guide + conventions                                               |
| `docs/CLINICAL_COPILOT.md`       | Sprint 13-19 — clinical co-pilot pivot + intake-aware flow                                |
| `docs/MEASUREMENT_BASED_CARE.md` | Sprint 20+ — Journey hub, reliable-change engine, episodes, Progress Report               |
| `docs/SPRINT_21.md`              | Sprint 21 incremental polish (diagnosis history, intake modify, My Practice, goal status) |
| `docs/EXECUTION_PLAN.md`         | **Historical** — original 13-sprint plan; superseded by CLINICAL_COPILOT for Sprint 13+   |
| `docs/SETUP.md`                  | Account procurement + env var matrix per sprint                                           |
| `docs/dpdp-data-flow.md`         | DPDP compliance data flows + DSR endpoints + cross-border                                 |
| `docs/security-audit.md`         | OWASP top-10 + secrets + IAM matrix                                                       |
| `docs/runbooks/README.md`        | Operational runbooks index                                                                |
| `docs/load-test-results.md`      | Pre-pilot load test record                                                                |

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

| When you want to…                                | Start here                                                                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Add a new API endpoint                           | `apps/web/app/api/v1/sessions/[id]/note/modify/route.ts` (the canonical pattern)                                       |
| Add a new Gemini pass                            | `packages/llm/src/backends/vertex-pro-global.backend.ts` + this CLAUDE.md § 5                                          |
| Add a new tab on the session detail page         | `apps/web/app/app/sessions/[id]/page.tsx` + `apps/web/components/app/SessionWorkspaceTabs.tsx`                         |
| Add a new audit action                           | `packages/contracts/src/audit.ts` + this CLAUDE.md § 6                                                                 |
| Change the SOAP note shape                       | `packages/contracts/src/note.ts` (`TherapyNoteV1Schema`)                                                               |
| Change the intake note shape                     | `packages/contracts/src/note.ts` (`IntakeNoteV1Schema`)                                                                |
| Change the Clinical Brief shape                  | `packages/contracts/src/clinical.ts` (`ClinicalReportV1Schema`)                                                        |
| Change the Initial Assessment Brief shape        | `packages/contracts/src/clinical.ts` (`InitialAssessmentBriefV1Schema`)                                                |
| Add a UI primitive                               | Don't. Compose existing ones in `apps/web/components/ui/`                                                              |
| Add a patient-facing share artefact type         | `packages/contracts/src/share.ts` + `apps/web/lib/share-snapshots.ts` + `apps/web/app/p/[token]/page.tsx`              |
| Curate a new scored instrument                   | `packages/clinical/src/instruments/index.ts` + add tests                                                               |
| Add a new India crisis hotline                   | `packages/clinical/src/crisis.ts`                                                                                      |
| Edit the session-start cascade                   | `apps/web/lib/session-defaults.ts` + `apps/web/app/api/v1/clients/[id]/session-defaults/route.ts`                      |
| Change the Journey hub / reliable-change verdict | `apps/web/lib/journey.ts` + `packages/clinical/src/instruments/change-score.ts`                                        |
| Change the Progress Report copy                  | `apps/web/lib/progress-report.ts` (deterministic — no LLM) + portal render branch in `apps/web/app/p/[token]/page.tsx` |
| Open / close a treatment episode                 | `apps/web/app/api/v1/sessions/route.ts` (opens) + `apps/web/app/api/v1/clients/[id]/discharge/route.ts` (closes)       |
| Toggle a goal status                             | `apps/web/app/api/v1/treatment-plans/[id]/goals/[index]/route.ts`                                                      |

## 11. What's NOT in scope (still on the backlog)

These gate a real Indian pilot. **Critical-path items live at the top.**

**Pilot-blocking (security + identity — needs your env to verify):**

- **Real Firebase auth cutover** — `shouldBypass()` still auto-engages
  when Firebase env vars are missing, and `/app/*` server pages
  hard-code the seeded `dev-firebase-uid-priya` user. Effectively no
  per-therapist auth in prod yet.
- **PII field encryption rollout** — schema has the `*_encrypted`
  columns; `apps/web` still reads/writes plaintext. The
  `@cureocity/crypto` envelope is built; just needs the writer cutover.
- **WebAuthn-bound signing** — sign route accepts `assertion` as
  optional. Sprint 18 introduced per-account WebAuthn registration;
  next is making the assertion required once any credential is
  registered (partial — currently enforced only if registrations exist).

**Big features (need scoping before a blanket build):**

- **Multi-tenant Clinic + roles** — currently single-tenant.
- **Settings pages** under `/app/settings/*` — none exist.
- **Billing** (Stripe + Razorpay).
- **Observability stack** — Sentry, OTel collector, Grafana — only
  metric counters exist today.
- **Pilot account provisioning + first-5-therapist onboarding** —
  manual.

**Smaller follow-ups carried over from Sprint 20-21:**

- **Intake-note sign-off** — `SignNoteInputSchema` + the sign route's
  per-field edit-diff verification are TherapyNoteV1-shaped. The
  modify panel works for intake (Sprint 21); sign-off needs the sign
  contract to become a union.
- **Multilingual progress report** — schema is locale-aware; copy is
  English-only and needs validated translations (do not machine-translate).
- **More scored instruments** (WHODAS-2, PCL-5, …) — registry supports
  it; validated item wording required.
- **Treatment-plan inline edit** — Clinical Brief's plan section is
  still "Accept or reject" (no Edit-and-Accept).

When asked to "do the next thing", default to the pilot-blocking
section unless the user has redirected.
