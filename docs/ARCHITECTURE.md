# Architecture — the whole system on one page

The current-state, subsystem-oriented overview of Cureocity Mind. Where the
sprint docs answer _"how was this built?"_, this file answers _"how does it
work now?"_. Companion references: **[`docs/DATA_MODEL.md`](DATA_MODEL.md)**
(the schema), **[`docs/ENVIRONMENT.md`](ENVIRONMENT.md)** (config + deploy),
**[`docs/GLOSSARY.md`](GLOSSARY.md)** (terms), and **[`CLAUDE.md`](../CLAUDE.md)**
(conventions + the five passes §3 / the doctor pipeline §3b).

## 1. One platform, two verticals

Cureocity Mind is **one Next.js app + one database** serving **two
practitioner verticals**, discriminated by
`Psychologist.vertical: PractitionerVertical = 'THERAPIST' | 'DOCTOR'`:

- **Therapist** — a psychology co-pilot. Batch flow: record a session,
  five Gemini passes produce a transcript → note → clinical brief →
  therapy script → pre-session brief. Measurement-based-care loop on top.
- **Doctor** — an ambient live-scribe for OPD. Live flow: a WebSocket
  gateway streams back a transcript + medical note + Rx pad + a passive
  three-rail copilot while the doctor talks.

Both share ONE `Client` and ONE `Session` table and the same auth / audit /
crypto / billing / Vertex-Gemini plumbing. The `Psychologist` row (despite
the therapist-era name) is the **practitioner** for both verticals.

## 2. Process & deploy topology

```
                         ┌──────────────────────────── the browser ───────────────────────────┐
                         │  Next.js React (therapist /app/*, doctor /app/clinic·patients·…,     │
                         │  patient portal /p/[token]).  Firebase JS SDK for sign-in.           │
                         └───────┬───────────────────────────────────────────────┬─────────────┘
              HTTPS (REST)       │                                    WSS (PCM audio + events)
                                 ▼                                                 ▼
     ┌───────────────────────────────────────────┐        ┌──────────────────────────────────────┐
     │  apps/web  — Next.js 15 App Router          │        │  services/live-gateway               │
     │  ON VERCEL (serverless functions, global CDN)│       │  ON CLOUD RUN (asia-south1)          │
     │  • pages (RSC) + /api/v1/* route handlers   │        │  • standalone Node WebSocket runtime │
     │  • the ONLY code that touches the DB        │        │  • runs the live pipeline            │
     │  • relays live-gateway events → DB          │◀──────▶│  • NO DB access (relays via browser) │
     └───────┬───────────────┬───────────────┬─────┘        └───────────────┬──────────────────────┘
             │               │               │                              │
             ▼               ▼               ▼                              ▼
     ┌─────────────┐  ┌────────────┐  ┌──────────────┐            ┌────────────────────┐
     │ Neon        │  │ Vercel Blob│  │ Vertex Gemini│            │ Vertex Gemini      │
     │ Postgres    │  │ (audio +   │  │ Flash asia-  │            │ Flash asia-south1  │
     │ (Prisma)    │  │  PDFs)     │  │ south1 +     │            │ (Pass 1 + reasoning)│
     └─────────────┘  └────────────┘  │ Pro global   │            │ Pro on finalize    │
     ┌─────────────┐  ┌────────────┐  └──────────────┘            └────────────────────┘
     │ GCP Cloud   │  │ Firebase   │   external: Razorpay (billing), WATI/SendGrid/Twilio/
     │ KMS (a-s1)  │  │ Auth       │   WebPush (patient messaging), ABDM/ABHA + FHIR (doctor)
     └─────────────┘  └────────────┘
```

**Key facts.**

- **`apps/web` is the only code with DB access.** Every REST endpoint is a
  Next.js route under `apps/web/app/api/v1/*` (`runtime = 'nodejs'`,
  `dynamic = 'force-dynamic'`). Vercel serverless functions.
- **`services/live-gateway` is the one exception to "everything is apps/web"** —
  a real, deployed standalone WebSocket service (Vercel can't hold a socket).
  It has **no Prisma**; the browser relays its events to `apps/web` routes
  (`sessions/[id]/live-*`) to persist. Everything else in `services/` is a
  NestJS scaffold (unit-test home for shared packages; no prod traffic).
- **Data residency (DPDP).** Audio-touching work runs in `asia-south1`:
  Pass 1 transcription, the live gateway, and Cloud KMS. Transcript-only
  passes (2–5) use global Pro. Postgres is Neon; PII is envelope-encrypted
  under GCP Cloud KMS (asia-south1).

## 3. Repository layout

```
apps/web/                 The single Next.js app (pages + /api/v1/* + patient portal /p)
packages/                 Shared TypeScript libraries (Zod contracts-first)
  contracts/              Zod schemas — the single source of truth for every DTO
  llm/                    Gemini pass backends + ModelRouter + prompts (+ mock backends)
  clinical/               CBT/EMDR engines, instruments (PHQ-9/GAD-7), drug interactions, crisis
  audio/                  Web Audio capture (worklet + decimator + chunker) + live stream
  crypto/                 Envelope encryption (IKmsProvider / IFieldEncryptor; local-dev + GCP KMS)
  billing/                Razorpay orders/checkout/webhook logic
  notifications/          WATI / SendGrid / Twilio / WebPush adapters
  observability/          OpenTelemetry metrics + audit-write counters
  storage/                S3 / Vercel Blob adapters
services/
  live-gateway/           REAL — the doctor live consult WebSocket runtime (§3b of CLAUDE.md)
  scribe-service/ …       NestJS scaffolds — unit-test homes only, no prod traffic
prisma/schema.prisma      Single source of truth for the DB (see DATA_MODEL.md)
docs/                     This documentation
infrastructure/           docker-compose for local dev (Postgres, Redis, Kafka, MinIO)
```

## 4. The two pipelines

### 4a. Therapist — the five-pass batch pipeline

Record in the browser → audio chunks to Vercel Blob → five Gemini passes,
each a Zod contract in/out, wired through `ModelRouter`
(`packages/llm/src/model-router.ts`):

```
Pass 1  audio → transcript + diarized segments + languages + affect   (Flash, asia-south1)
Pass 2  transcript → TherapyNoteV1 (SOAP) | IntakeNoteV1              (Pro, global)
Pass 3  + history → ClinicalReportV1 | InitialAssessmentBriefV1        (Pro)  ← runs in after()
Pass 4  diagnosis+plan → TherapyScriptV1 (read aloud)                  (Pro, cached)
Pass 5  client context → PreSessionBriefV1                             (Pro, cached)
```

The therapist confirms each AI suggestion; confirmed diagnoses + plans
persist cumulatively (`ClientDiagnosis` / `TreatmentPlan`). See CLAUDE.md §3.
On top sits the **measurement-based-care loop** (`apps/web/lib/journey.ts` +
`packages/clinical/src/instruments/change-score.ts`): Journey stages,
deterministic reliable-change verdicts, episodes, Progress Report.

### 4b. Doctor — the live-scribe pipeline

Audio streams from the browser to the gateway; the gateway runs an
incremental O(n) pipeline and streams events back; the browser relays them
to `apps/web` to persist. See CLAUDE.md §3b for the full map.

```
browser mic ─PCM─▶ live-gateway:  vad (windows) → Pass 1 (transcript/window)
                                 → Pass 2 (medical note; Flash interim, Pro finalize)
                                 → reasoning-loop → PASS_11_REASONING → case-state
                                     (citation gate) → differential + ask-next
                                 → gaps (red-flags) → rx-pad (deterministic assembly) → meter
   ◀── events (transcript/note/finding/reasoning/gap/rxDraft/meter/final) ──
browser relays → POST /api/v1/sessions/[id]/live-{token,note,metric,suggestion} + rx-pad
```

Capture can also be **dictate** or **upload** (`CaptureMode`), which run the
batch medical-note path instead of the live gateway. Both converge on one
**Review & Sign** surface (`apps/web/components/app/ReviewAndSign.tsx`).

## 5. Cross-cutting concerns

| Concern              | How it works                                                                                                                                                     | Where                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Contracts**        | Every DTO is a Zod schema in `packages/contracts`; routes call `parseJson`/`parseQuery`. Never accept unvalidated JSON.                                          | CLAUDE.md §4                     |
| **Auth**             | Firebase `__session` cookie (pages) or `Bearer` token (API); `AUTH_BYPASS` auto-engages without Firebase env → seeded dev fixture. Side-effect routes POST-only. | `docs/AUTH_SESSION.md`           |
| **Tenancy**          | Every query filters `psychologistId`; client-touching routes re-check `client.psychologistId`. No shared records across practitioners.                           | CLAUDE.md §4                     |
| **PII encryption**   | Client name/phone/email are envelope-encrypted (per-tenant DEK, wrapped by GCP Cloud KMS). Single decrypt-only read path `apps/web/lib/client-pii.ts`.           | `packages/crypto`, CLAUDE.md §11 |
| **Audit**            | Every state change writes an `AuditLog` row via `writeAudit(...)`. A chaos test asserts every `AuditAction` has a writer.                                        | CLAUDE.md §4/§6                  |
| **Vertical routing** | Page guards `requireOnboardedDoctor/Therapist`; API routes re-check `vertical`; `/app` redirects doctors to `/app/clinic`; nav branches on `vertical`.           | CLAUDE.md §3b                    |
| **i18n**             | Code-mix-first: Pass 1 detects the spoken language(s); patient-facing content uses `Client.preferredLanguage`.                                                   | CLAUDE.md §4                     |
| **Observability**    | OpenTelemetry SDK + Sentry wired; per-pass Gemini call metrics; audit-write counters.                                                                            | `packages/observability`         |
| **Migrations**       | One idempotent, guarded migration folder per sprint; `pnpm db:check-migrations` enforces idempotency in CI.                                                      | CLAUDE.md §4                     |

## 6. Reading order for a newcomer

1. **This file** — the shape of the system.
2. **[`docs/GLOSSARY.md`](GLOSSARY.md)** — decode the domain vocabulary.
3. **[`docs/DATA_MODEL.md`](DATA_MODEL.md)** — the entities everything hangs off.
4. **[`CLAUDE.md`](../CLAUDE.md)** §3 / §3b — the two pipelines in detail + conventions.
5. Vertical deep-dives: **[`docs/CLINICAL_COPILOT.md`](CLINICAL_COPILOT.md)** +
   **[`docs/MEASUREMENT_BASED_CARE.md`](MEASUREMENT_BASED_CARE.md)** (therapist);
   **[`docs/DOCTOR_VERTICAL.md`](DOCTOR_VERTICAL.md)** +
   **[`docs/DOCTOR_SCRIBE_V2_SPRINTS.md`](DOCTOR_SCRIBE_V2_SPRINTS.md)** (doctor).
6. **[`docs/ENVIRONMENT.md`](ENVIRONMENT.md)** when you need to run or deploy it.
