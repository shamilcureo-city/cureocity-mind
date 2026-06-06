# CLAUDE.md — agent + developer guide

This document is the operational guide for AI agents (Claude Code, Claude
Agent SDK) and human developers working in the Cureocity Mind codebase.
For product context, read **[`docs/CLINICAL_COPILOT.md`](docs/CLINICAL_COPILOT.md)**
first — it explains what the product currently does. This file is about
*how the code is organised* and the conventions to follow.

## 1. What this codebase is

A clinical co-pilot for Indian psychotherapists. The therapist records
a session in the browser; five Gemini passes produce a transcript,
SOAP note, ICD-11 clinical brief, step-by-step therapy script (read
aloud to the client), and a pre-session brief for the next visit.
The therapist confirms each AI suggestion; confirmed diagnoses + plans
persist cumulatively. Patient-facing content can be shared via WhatsApp
/ email / portal link.

Originally a 13-sprint "AI scribe" plan; pivoted at Sprint 13 to
"clinical co-pilot". Sprints 13–17 built that out:

- **Sprint 13** — Pass 3 (Clinical Analysis) + Clinical Brief tab
- **Sprint 14** — Pass 4 (Therapy Script) + Therapy Library
- **Sprint 15** — Patient CRM + share via WhatsApp / email / portal
- **Sprint 16** — Multilingual / code-mix-first (Manglish, Hinglish, …)
- **Sprint 17** — Pass 5 (Pre-Session Brief) + PHQ-9/GAD-7 + SafetyPlan + Competency dashboard

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

## 8. Documentation map

| File | What it covers |
|---|---|
| `README.md` | Quick getting-started + current product summary |
| `CLAUDE.md` | This file |
| `docs/CLINICAL_COPILOT.md` | Sprint 13-17 — the clinical co-pilot pivot |
| `docs/EXECUTION_PLAN.md` | **Historical** — original 13-sprint plan; superseded by CLINICAL_COPILOT for Sprint 13+ |
| `docs/SETUP.md` | Account procurement + env var matrix per sprint |
| `docs/dpdp-data-flow.md` | DPDP compliance data flows + DSR endpoints + cross-border |
| `docs/security-audit.md` | OWASP top-10 + secrets + IAM matrix |
| `docs/runbooks/README.md` | Operational runbooks index |
| `docs/load-test-results.md` | Pre-pilot load test record |

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

| When you want to… | Start here |
|---|---|
| Add a new API endpoint | `apps/web/app/api/v1/sessions/[id]/note/modify/route.ts` (the canonical pattern) |
| Add a new Gemini pass | `packages/llm/src/backends/vertex-pro-global.backend.ts` + this CLAUDE.md § 5 |
| Add a new tab on the session detail page | `apps/web/app/app/sessions/[id]/page.tsx` + `apps/web/components/app/SessionWorkspaceTabs.tsx` |
| Add a new audit action | `packages/contracts/src/audit.ts` + this CLAUDE.md § 6 |
| Change the SOAP note shape | `packages/contracts/src/note.ts` (`TherapyNoteV1Schema`) |
| Change the Clinical Brief shape | `packages/contracts/src/clinical.ts` (`ClinicalReportV1Schema`) |
| Add a UI primitive | Don't. Compose existing ones in `apps/web/components/ui/` |
| Add a patient-facing share artefact type | `packages/contracts/src/share.ts` + `apps/web/lib/share-snapshots.ts` + `apps/web/app/p/[token]/page.tsx` |
| Curate a new scored instrument | `packages/clinical/src/instruments/index.ts` + add tests |
| Add a new India crisis hotline | `packages/clinical/src/crisis.ts` |

## 11. What's NOT in scope (still on the backlog)

These survive the clinical co-pilot pivot and gate a real Indian pilot:

- **PII field encryption rollout** — schema has the `*_encrypted` columns;
  apps/web still reads/writes plaintext. Sprint 9 PR 3 author was
  patient-model-service; need to extend to apps/web.
- **WebAuthn-bound signing** — `lib/webauthn.ts` exists; the sign route
  accepts `assertion` as optional. Make required after registration.
- **Real Firebase auth cutover** — drop `shouldBypass()` in prod.
- **Multi-tenant Clinic + roles** — currently single-tenant.
- **Settings pages** under `/app/settings/*` — none exist.
- **Billing** (Stripe + Razorpay) — none.
- **Observability stack** — Sentry, OTel collector, Grafana — only
  metric counters exist.
- **Pilot account provisioning + first-5-therapist onboarding** —
  manual.

When asked to "do the next thing", default to one of the above unless
the user has redirected.
