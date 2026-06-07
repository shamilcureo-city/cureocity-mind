# Cureocity Mind

A clinical co-pilot for Indian psychotherapists that **closes the
measurement-based-care loop**. The therapist records a session in the
browser; Gemini produces a transcript, an intake or SOAP note (depending
on session kind), an ICD-11 clinical brief or initial-assessment brief
with diagnosis candidates + cited evidence + (where relevant) a
treatment plan, a step-by-step therapy script, and a pre-session brief
for next time. Confirmed diagnoses and plans persist cumulatively.

On top of that, every client has a **Journey hub** that shows where they
are in their care arc (Intake → Assessment → Active treatment → Review
due → Discharge ready → Discharged), a deterministic reliable-change
verdict on PHQ-9 and GAD-7 (Improving / No change / Worsening, with
response and remission tags — thresholds from the validation literature,
no AI), the plan goals with per-goal achievement status, and a passive
next-best-action. When the client is ready, the therapist shares a
plain-language **Progress Report** they can read on a private portal
link, then closes the care episode with a one-click Discharge.

Designed for real Indian practice: the audio can be in any language
(English, Malayalam, Hindi, Tamil, Bengali, …) or any code-mix
(Manglish, Hinglish, Tanglish, …). Pass 1 detects what was actually
spoken and transcribes faithfully in the spoken language(s).

## Start here

| Doc                                                                | Purpose                                                                          |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| [`CLAUDE.md`](CLAUDE.md)                                           | Agent + developer operational guide — read this first                            |
| [`docs/CLINICAL_COPILOT.md`](docs/CLINICAL_COPILOT.md)             | Product context — Sprints 13-19, clinical co-pilot pivot + intake-aware flow     |
| [`docs/MEASUREMENT_BASED_CARE.md`](docs/MEASUREMENT_BASED_CARE.md) | Sprint 20 — the journey hub, reliable-change engine, progress report, episodes   |
| [`docs/SPRINT_21.md`](docs/SPRINT_21.md)                           | Sprint 21 — diagnosis history, intake-note modify, My Practice view, goal status |
| [`docs/SETUP.md`](docs/SETUP.md)                                   | Account procurement + env var matrix per sprint                                  |
| [`docs/dpdp-data-flow.md`](docs/dpdp-data-flow.md)                 | DPDP compliance data flows                                                       |
| [`docs/security-audit.md`](docs/security-audit.md)                 | Pre-pilot security audit                                                         |
| [`docs/EXECUTION_PLAN.md`](docs/EXECUTION_PLAN.md)                 | **Historical** — original 13-sprint scribe plan, superseded for Sprint 13+       |

## Status

| Track                                                                                                 | Status      |
| ----------------------------------------------------------------------------------------------------- | ----------- |
| Clinical co-pilot (Sprints 13-17)                                                                     | **Shipped** |
| Sprint 18 — Therapist settings + WebAuthn registration + sign hardening                               | **Shipped** |
| Sprint 19 — Scribing flow revamp (intake-aware: Pre-Flight panel, IntakeNote, InitialAssessmentBrief) | **Shipped** |
| Sprint 20 — Measurement-based-care loop (Journey hub, Progress Report, Episodes, goal status)         | **Shipped** |
| Sprint 21 — Diagnosis history, intake-note AI modify, My Practice view                                | **Shipped** |
| Pre-pilot blockers (real Firebase auth, PII field encryption, WebAuthn-required sign)                 | **Pending** |
| Other backlog (multi-tenant Clinic, billing, observability stack, multilingual progress copy)         | **Pending** |

Latest sprint highlights:

- **Sprint 21** — Cumulative diagnosis history card on the client page;
  AI modify panel now works on intake notes (kind-aware route); new
  `/app/me` "How it's going" view for therapist self-reflection;
  per-goal `NOT_STARTED / IN_PROGRESS / ACHIEVED` status with a clickable
  cycle dot on the journey hub.
- **Sprint 20** — Journey hub band on every client page with stage rail,
  reliable-change verdict, plan goals, and a passive Next-Best-Action;
  `PROGRESS_REPORT` patient-share artefact built deterministically from
  the change engine; `TreatmentEpisode` + `POST /clients/[id]/discharge`
  give the arc a real terminal state.
- **Sprint 19** — Single-screen Pre-Flight panel replaces the 3-step
  PreRecordWizard; `SessionKind = INTAKE | TREATMENT | REVIEW` drives
  Pass 2 / Pass 3 prompt branches; intake sessions produce
  `IntakeNoteV1` + `InitialAssessmentBriefV1` instead of forcing a SOAP
  shape onto a first session.

## The five Gemini passes

| Pass | Input                                                              | Output                                                                                                              | Region                         | Pass label                      |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------- |
| 1    | Audio (PCM 16kHz)                                                  | Transcript + speakerSegments (with language tag) + affectFeatures + detectedLanguages[]                             | `asia-south1` (DPDP residency) | `PASS_1_TRANSCRIBE_AND_ANALYSE` |
| 2    | Transcript text                                                    | `TherapyNoteV1` (SOAP + riskFlags + modalitySpecific)                                                               | Global                         | `PASS_2_NOTE_GENERATION`        |
| 3    | Transcript + note + history                                        | `ClinicalReportV1` (ICD-11 diagnosis candidates + gaps + formulation + plan + recommended therapies + crisis flags) | Global                         | `PASS_3_CLINICAL_ANALYSIS`      |
| 4    | Therapy name + diagnosis + plan + history                          | `TherapyScriptV1` (opening + step-by-step + branches + closing + homework)                                          | Global                         | `PASS_4_THERAPY_SCRIPT`         |
| 5    | Client context (last session, homework, plan, crisis, instruments) | `PreSessionBriefV1` (context line + recap + today's focus + opening line + watchpoints)                             | Global                         | `PASS_5_PRE_SESSION_BRIEF`      |

## Prerequisites

- **Node.js 22 LTS** — run `nvm use` to pick up `.nvmrc`
- **pnpm 10+** — `corepack enable` or `npm install -g pnpm`
- **Docker 24+ with Compose v2** — for local Postgres / Redis / MinIO

## Getting started

```bash
nvm use
corepack enable
pnpm install
cp .env.example .env.local           # fill in what you have; mock backend works without GCP
pnpm exec prisma generate
DATABASE_URL=... pnpm exec prisma migrate deploy
DATABASE_URL=... pnpm exec prisma db seed
pnpm --filter @cureocity/web dev     # http://localhost:3000
```

`LLM_BACKEND=mock` (default) runs the whole pipeline end-to-end with
deterministic mocks — record → transcript → note → clinical brief →
therapy script → pre-session brief — no GCP creds needed.

## Workspace commands

| Command             | Purpose                                      |
| ------------------- | -------------------------------------------- |
| `pnpm -r build`     | Build every package + service + app          |
| `pnpm -r lint`      | ESLint across the workspace                  |
| `pnpm -r test`      | Vitest across packages + services            |
| `pnpm format`       | Auto-format with Prettier                    |
| `pnpm format:check` | Verify formatting without modifying          |
| `pnpm infra:up`     | Start local Postgres / Redis / Kafka / MinIO |
| `pnpm infra:down`   | Stop the same                                |

## Repository layout

```
apps/
  web/                    # The single user-facing Next.js 15 app
                          # - Therapist UI under /app/*
                          # - Patient portal under /p/[token]
                          # - API routes under /api/v1/*

packages/                 # Shared TypeScript libraries
  contracts/              # Zod schemas — DTO source of truth
  llm/                    # Gemini backends + ModelRouter + prompts (all 5 passes)
  clinical/               # CBT/EMDR engines, PHQ-9/GAD-7, India crisis hotlines
  audio/                  # Web Audio capture (worklet + decimator + chunker)
  crypto/                 # Envelope encryption
  notifications/          # WATI / SendGrid / Twilio / WebPush adapters
  observability/          # OpenTelemetry metrics + audit counters
  storage/                # S3 / Vercel Blob

services/                 # NestJS scaffolds — NOT the live request path.
                          # Kept for test coverage; live requests go through
                          # apps/web/app/api/v1/*.

prisma/
  schema.prisma           # DB source of truth
  migrations/             # Sprint-prefixed folders

infrastructure/           # docker-compose for local dev
docs/                     # Engineering documentation
```

## Tech stack

- **Frontend** — Next.js 15 (App Router, RSC) + React 19 + Tailwind 4
- **Backend** — Next.js API routes (Node runtime)
- **Database** — Postgres 16 (Neon in prod) + Prisma 5
- **LLM** — Vertex Gemini 2.5 Flash (Pass 1) + Gemini 2.5 Pro (Passes 2-5)
- **Auth** — Firebase phone OTP (therapist + client)
- **Audio** — Web Audio API + AudioWorklet → 16kHz mono PCM
- **Signing** — WebAuthn-bound note sign-off (Sprint 7)
- **Storage** — Vercel Blob (audio) + S3 / MinIO (PDFs)
- **Notifications** — WATI (WhatsApp), SendGrid (email), Twilio (SMS), Web Push
- **Tests** — Vitest

## Audit + compliance posture

Every state-changing endpoint writes a row to `audit_logs`. A chaos test
(`packages/contracts/src/audit-coverage.spec.ts`) parses the
`apps/web/{app,lib}` source tree and asserts every `AuditAction` enum
value has at least one writer. Failing this test means the codebase
can't answer the regulator's "where is action X audited?" question.

Cumulative audit-action count as of Sprint 21: **85+** distinct actions
covering clinical lifecycle, sharing, instruments, DSR rights, admin
operations, crisis surfacing, session-defaults cascade decisions,
treatment-episode lifecycle, per-goal achievement toggles, and
progress-report generation + sharing.

## Contributing

Read **[`CLAUDE.md`](CLAUDE.md)** before opening a PR. It covers the
conventions: contracts-first, audit-everything, tenant filtering, the
five-pass architecture, common gotchas.
