# Cureocity Mind — Execution Plan (V1, web-only)

**Status:** Draft for sign-off · **Version:** 1.0 · **Date:** May 2026
**Parent specification:** PRD 22.1 — Cureocity Mind Engineering Specification (Installments 1 & 2)
**Audience:** Engineering, Clinical, Compliance, Product, CEO

---

## 1. Context

Cureocity Mind is an ambient therapy scribe for Indian psychologists practising CBT and EMDR. PRD 22.1 specifies a Flutter-based mobile build over twelve weeks. After product review, this execution plan **diverges from the parent PRD** on several material points. Each divergence is listed here and explained inline at the relevant section.

| PRD 22.1 said | This plan does | Rationale |
|---|---|---|
| Flutter mobile apps (psychologist + client) | Two Next.js web apps | Faster pilot iteration; desktop browser is reliable for in-person ambient scribing; defers App Store / Play Store dependency |
| Mock services for `partnermanagement`, `communication`, `document-analysis` | No mocks — build real integrations or skip the feature | "No fake things" — reduce throwaway code |
| `FakeBackend` for Gemini in tests/dev | Real Gemini only; recorded fixtures for tests | "No fake things" — test against real recorded outputs |
| `attribution-service` shipped as V1 stub | Not built in V1 | Defer all monetization machinery to Phase 2; pilot proves clinical value first |
| Cureocity longevity surfaces in client app | Not built in V1 | Same as above |
| Sessions in-person OR telehealth | In-person only for V1 | Telehealth tab-audio capture is a Safari blocker; revisit in V2 |
| Gemini "ap-south P0 hard gate" | Two-pass: Flash in asia-south1 + Pro globally | Gemini Pro is not in asia-south1; see § 6.1 |

Everything else in PRD 22.1 (clinical model, exercise catalog, consent flow, audit log, sprint cadence) carries forward unchanged.

---

## 2. Architecture

```
                       ┌──────────────────┐
                       │ pdf-generator    │   consumes signed notes
                       └────────┬─────────┘
                                │
                       ┌────────▼─────────┐
                       │ continuity-svc   │   exercises, mood, journal
                       └────────┬─────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
       ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐
       │ modality-   │   │ affect-     │   │ (attribution│
       │ workflow    │   │ engine      │   │  deferred)  │
       └──────┬──────┘   └──────┬──────┘   └─────────────┘
              │                 │
              └─────────┬───────┘
                        │
                ┌───────▼────────┐
                │ scribe-service │   orchestrator; calls Gemini (two-pass)
                └───────┬────────┘
                        │
                ┌───────▼────────┐
                │ patient-model- │   five-layer patient model
                │ service        │
                └────────────────┘

  Web clients  ──HTTPS──▶  service mesh (NestJS + Kafka + Postgres + Redis + S3)
  ───────────              ─────────────────────────────────────────────────────
  apps/therapist-web        services/*  +  packages/*
  apps/client-web (PWA)
```

Six NestJS services, two Next.js web apps, six shared packages, Postgres + Redis + Kafka + S3 (MinIO in dev). Hosted in AWS ap-south-1. Gemini called from `scribe-service` via two-pass model router (§ 6.1).

---

## 3. Repository layout

```
cureocity-mind/
├── apps/
│   ├── therapist-web/                    # Next.js 15 App Router       [Sprint 6]
│   └── client-web/                       # Next.js 15 PWA              [Sprint 8]
├── services/
│   ├── patient-model-service/            # NestJS                      [Sprint 1]
│   ├── scribe-service/                   # NestJS, two-pass Gemini     [Sprint 2]
│   ├── modality-workflow-service/        # NestJS, CBT/EMDR machines   [Sprint 3]
│   ├── affect-engine-service/            # NestJS                      [Sprint 4]
│   ├── continuity-service/               # NestJS                      [Sprint 5]
│   └── pdf-generator-service/            # NestJS + Puppeteer          [Sprint 6]
├── packages/
│   ├── types/                            # Prisma-generated + manual   [Sprint 1]
│   ├── contracts/                        # Zod schemas (shared)        [Sprint 1]
│   ├── llm/                              # Gemini backends, prompts    [Sprint 2]
│   ├── audio/                            # Web Audio chunking/format   [Sprint 2]
│   ├── clinical/                         # CBT/EMDR machines, catalog  [Sprint 3]
│   └── ui/                               # Shared React components     [Sprint 6]
├── prisma/
│   ├── schema.prisma                     # Single source of truth      [Sprint 1]
│   ├── migrations/                                                     [Sprint 1]
│   └── seed.ts                                                         [Sprint 1]
├── infrastructure/
│   └── docker-compose.yml                # PG, Redis, Kafka, MinIO     [Sprint 1]
├── docs/
│   ├── EXECUTION_PLAN.md                 # This document
│   ├── dpdp-data-flow.md                                               [Sprint 9]
│   └── runbooks/                                                       [Sprint 10]
├── .github/workflows/                                                  [Sprint 1]
├── pnpm-workspace.yaml
├── nx.json
├── tsconfig.base.json
└── README.md
```

Dropped from PRD 22.1:
- `apps/partner-app/`, `apps/client-app/` (Flutter)
- `mocks/` (no mocks)
- `services/attribution-service/` (Phase 2)
- LocalStack → MinIO (sufficient for dev S3-compatible storage)

---

## 4. Tooling and versions

| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces + Nx 18 | Nx for affected-graph CI; pnpm for fast installs |
| Backend framework | NestJS 10 | Per PRD |
| Web framework | Next.js 15 (App Router) + React 19 | RSC for briefing dossier (server-rendered patient data); Server Actions for note edits |
| Styling | Tailwind CSS + shadcn/ui | Themeable to PRD's NAVY/SLATE palette; accessible defaults |
| Client state (web) | RSC for reads, Zustand for active-session state | Avoids Redux complexity; matches Next 15 idioms |
| Database | PostgreSQL 16 + Prisma 5 | Per PRD |
| Cache / session | Redis 7 | Per PRD |
| Event bus | Kafka 3.6 | Per PRD |
| Object store | S3 (MinIO in dev) | Per PRD |
| Auth | Firebase Auth (phone OTP) + Firebase Admin SDK on backend | Per PRD |
| Audio capture | Web Audio API + AudioWorklet (16 kHz mono PCM) | See § 6.2 |
| Offline buffer | Service Worker + IndexedDB (+ Storage Buckets API where available) | See § 6.2 |
| Wake lock | Screen Wake Lock API | Prevents laptop sleep during long sessions |
| Biometric sign-off | WebAuthn (platform authenticator) | Touch ID / Windows Hello / Android biometric |
| Push notifications | Web Push (FCM) + email + SMS fallback | iOS Safari needs PWA install; see § 6.3 |
| LLM | `@google-cloud/vertexai` SDK → Vertex AI | Two-pass; see § 6.1 |
| PDFs | Puppeteer rendering React server components | Per PRD |
| Logs | Pino + OpenTelemetry | Per PRD |
| Tests | Vitest, Playwright (web e2e), supertest (API) | Modern, fast |
| CI | GitHub Actions | Per PRD; Jenkins is Phase 2 |

Locked versions: Node 20.x LTS, TypeScript 5.4.x, pnpm 9.x, Tailwind 4.x.

---

## 5. Sprint-by-sprint plan

Each sprint contains: **Goal · Acceptance criteria · PR breakdown · Verification · Dependencies · Open questions for sign-off**.

### Sprint 1 — Monorepo + patient-model-service (Week 1)

**Goal:** Foundation. Nothing else can start until this is done.

**Acceptance criteria** (adapted from PRD 22.1 Part 16)
- Nx monorepo created at the structure specified in § 3
- PostgreSQL + Prisma + Redis + Kafka + MinIO running via docker-compose
- Full Prisma schema (PRD Part 2) deployed; migrations applied. **Schema additions vs PRD**: `Session.status` enum extended with `CANCELLED`, `NO_SHOW`, `RESCHEDULED` (gap G5); `AttributableEvent` table omitted (Phase 2).
- `patient-model-service` scaffolded as NestJS app
- Five core endpoints implemented: `POST /psychologists`, `POST /clients`, `GET /clients`, `GET /clients/:id`, `GET /clients/:id/briefing`, `PATCH /clients/:id`
- Unit tests for each endpoint, integration test against the Postgres container
- GitHub Actions CI green on push (lint, typecheck, prisma validate, test affected)
- Audit log model + first write sites (consent capture)

**PR breakdown**
1. `chore/workspace`: pnpm-workspace, nx.json, tsconfig.base.json, .prettierrc, eslint config
2. `feat/schema`: full Prisma schema + initial migration + seed
3. `feat/patient-model-scaffold`: NestJS app, Firebase auth guard, Prisma module, health endpoint
4. `feat/patient-model-endpoints`: the five endpoints + DTOs + tests
5. `chore/ci`: GitHub Actions workflows

**Verification**
```bash
docker compose up -d
npx prisma migrate dev
npx prisma db seed
npx nx test patient-model-service
npx nx serve patient-model-service
curl -H "Authorization: Bearer <test-token>" \
  http://localhost:3001/api/v1/clients/<test-client-id>/briefing
```

**Open questions for sign-off (before Sprint 1 starts)**
- G5: confirm `Session.status` enum extensions (`CANCELLED`, `NO_SHOW`, `RESCHEDULED`)
- G7: confirm supervisor / co-signature workflow is out of scope for V1 schema (pilot uses only senior RCI-registered therapists)
- G13: confirmed → two-pass Gemini architecture (see § 6.1). Consent script gets cross-border clause; needs Sharafath sign-off this sprint

---

### Sprint 2 — scribe-service + Gemini two-pass (Week 2)

**Goal:** First end-to-end Gemini call. Both passes shipping.

**Acceptance criteria**
- `scribe-service` scaffolded
- Audio chunk upload endpoint (`POST /sessions/:id/audio-chunks`) accepts multipart, stores in S3 (MinIO in dev) as `audio/pcm;rate=16000` chunks
- Session lifecycle endpoints: `POST /sessions`, `POST /sessions/:id/consent`, `POST /sessions/:id/start`, `POST /sessions/:id/end`, `GET /sessions/:id/note-draft`
- `packages/llm` with `ModelRouter` interface and two real backends:
  - `VertexGeminiFlashIndiaBackend` — Pass 1, asia-south1, audio → `{ transcript, speakerSegments, affectFeatures }`
  - `VertexGeminiProGlobalBackend` — Pass 2, global, transcript text → `TherapyNoteV1`
- Three system prompts shipped verbatim in `packages/llm/src/prompts/` with version constants:
  - `TRANSCRIBE_AND_ANALYSE_SYSTEM_PROMPT_V1` (new — Flash pass)
  - `THERAPY_NOTE_SYSTEM_PROMPT_V1` (adapted to consume transcript text)
  - `MISSED_THEMES_SYSTEM_PROMPT_V1` (unchanged from PRD Part 10.3)
- Note-generation worker (SQS consumer) runs Pass 1 → Pass 2 → Zod validation → persistence
- Hard cost circuit breaker per session (gap G6): if estimated cost exceeds configurable cap, halt and surface to therapist
- `GeminiCallLog` writes (per PRD Part 2) include `region` field
- End-to-end test: upload synthetic 5-min audio → end → receive validated `TherapyNoteV1`

**PR breakdown**
1. `feat/scribe-scaffold`: NestJS app, sessions module
2. `feat/audio-upload`: chunk endpoint, MinIO client, chunk-validator
3. `feat/llm-router`: ModelRouter interface, both Gemini backends, prompts, prompt versioning
4. `feat/note-worker`: SQS-driven two-pass orchestration, validation, persistence
5. `feat/cost-circuit-breaker`: per-session cost gate, per-therapist monthly cap
6. `test/scribe-e2e`: synthetic-audio fixture, nightly e2e against real Gemini

**Verification**
```bash
GEMINI_API_KEY=... \
GCP_SA_KEY_PATH=... \
npx nx test scribe-service
npx nx run scribe-service:e2e -- --fixture=test/fixtures/cbt-session-5min.pcm
```

**Open questions for sign-off**
- G3: crisis escalation protocol when Pass 2 returns `severity: critical` — auto-text iCall? Email supervisor? After-hours protocol?
- G6: confirm cost circuit breaker per-session cap (suggest ₹500/session as hard stop)
- Confirm Sprint 1 cross-border consent clause is approved by Sharafath before this sprint goes live

---

### Sprint 3 — modality-workflow + CBT (Week 3)

**Goal:** First modality state machine; CBT phase progression with prescription engine.

**Acceptance criteria**
- `modality-workflow-service` scaffolded
- CBT 5-phase state machine in `packages/clinical/src/modalities/cbt/`
- Endpoints: `POST /workflows`, `GET /workflows/:id`, `POST /workflows/:id/transitions`, `GET /workflows/:id/advancement-suggestion`
- Exercise prescription engine: given session note + current phase + adherence, returns recommended exercises
- 20 CBT exercises from PRD Appendix D seeded into `packages/clinical/src/exercises/catalog.ts`
- Integration test: simulate a 4-session CBT trajectory; verify phase transitions and prescription correctness

**PR breakdown**
1. `feat/modality-scaffold`: NestJS app, workflows module
2. `feat/cbt-machine`: 5-phase state machine, transition guards, advancement evaluator
3. `feat/cbt-catalog`: 20 CBT exercise definitions (English canonical; Hi/Ml/Ta/Bn placeholders for Sprint 5)
4. `feat/prescription-engine`: phase-appropriate filtering, adherence intelligence, risk suppression

---

### Sprint 4 — EMDR + affect-engine (Week 4)

**Goal:** EMDR 8-phase machine; affect baseline + deviation detection.

**Acceptance criteria**
- EMDR 8-phase machine with Phase 2 (Preparation) gate before Phase 3 (Assessment)
- Per-target memory tracking (SUDS/VOC/NC/PC fields)
- Endpoints: `POST /workflows/:id/emdr/targets`, `POST /workflows/:id/emdr/preparation-complete`, etc.
- `affect-engine-service` scaffolded
- Consumes `affectFeatures` from `scribe-service`'s Pass 1 (no separate Gemini call needed)
- Baseline computation (4-session minimum, 10-session sliding window)
- Deviation detection with 1.5σ thresholds; neutral-language flags only
- Endpoint: `GET /affect/clients/:id/baseline`, `GET /affect/clients/:id/trend`
- 20 EMDR exercises seeded (guided audio placeholders for V1; production audio post-pilot)
- Test: simulate 6 sessions with varying affect; verify baseline forms at session 4 and deviation flagged at session 6

**Open questions for sign-off**
- G1: confirm speaker diarization approach — prompt the Flash pass for diarization explicitly; validate accuracy with a 10-session pilot dataset; baseline only on segments labeled as client

---

### Sprint 5 — continuity-service + catalog complete (Week 5)

**Goal:** Between-session machinery; full exercise catalog; retention job; audit log writes everywhere.

**Acceptance criteria**
- `continuity-service` scaffolded
- Exercise catalog fully seeded (40 exercises from PRD Appendix D)
- Standardized outcome measures added (gap G4): PHQ-9, GAD-7, WHODAS-2.0 as exercise entries with structured response schemas
- Endpoints: `GET /continuity/me/exercises`, `POST /continuity/me/exercises/:id/completions`, mood logs, journal entries, adherence aggregator
- Audio retention cron job (S3 30-day lifecycle + daily DB cross-check)
- Audit log writes verified across all services for all `AuditAction` enum values

**Open questions for sign-off**
- G4: confirm PHQ-9 / GAD-7 / WHODAS-2.0 inclusion (clinical sign-off from Dr. Noufal)

---

### Sprint 6 — pdf-generator + therapist-web foundation (Week 6)

**Goal:** PDFs ready; therapist web app scaffolded with auth + briefing screen.

**Acceptance criteria**
- `pdf-generator-service` scaffolded with Puppeteer rendering React server components
- Therapist session note PDF template
- Client treatment plan PDF template (stripped-down, plain-language)
- Both PDFs generate in EN / HI / ML (TA / BN in v1.5)
- `apps/therapist-web` scaffolded: Next.js 15 App Router, Tailwind, shadcn/ui base, Firebase Auth phone OTP
- Account recovery flow scaffolded (gap G8): backup email registered at onboarding; recovery via email OTP
- Briefing screen (`/clients/[id]/briefing/[sessionId]`) renders all sections from `patient-model-service` via React Server Component

**Open questions for sign-off**
- G8: confirm backup-email recovery approach (alternative: security questions, magic-link via WhatsApp)

---

### Sprint 7 — therapist-web capture + review (Week 7) — highest-risk sprint

**Goal:** Real ambient capture in the browser; psychologist signs a note end-to-end.

**Acceptance criteria**
- ConsentScreen with bilingual rendering and WebAuthn capture for consent
- SessionScreen with:
  - AudioWorklet capture, 48 kHz → 16 kHz polyphase FIR decimation, 30-s Int16 PCM chunks
  - Worker-driven IndexedDB persistence + chunk POST upload
  - Service Worker offline buffer (drain on `online` event with exponential backoff)
  - Screen Wake Lock during recording, re-acquired on `visibilitychange`
  - Tab-visibility resilience: capture continues in backgrounded tab (worklet thread; no main-thread timers)
  - **Session resume after refresh** (gap G2): sticky mic permission, IDB-persisted chunk offset, backend stitching by `(sessionId, chunkIndex)`. `beforeunload` warning. 200–500 ms gap is acceptable.
  - Storage Buckets API with `{durability: 'strict', persisted: true}` on Chromium 122+; falls back to `navigator.storage.persist()` on Safari/Firefox
- ReviewScreen with inline note editing, **NoteEdit history table** (gap G11), risk acknowledgement, WebAuthn sign-off binding the note hash into the WebAuthn challenge
- End-to-end demo: 10-min real session from Start → PDF in therapist's hand

**PR breakdown**
1. `feat/audio-worklet`: AudioWorklet processor, resampler WASM, format module in `packages/audio`
2. `feat/session-storage`: Service Worker, IndexedDB schema, Storage Buckets fallback
3. `feat/session-resume`: refresh detection, sticky-permission re-attach, backend stitching
4. `feat/consent-screen`: bilingual render, scope toggles, WebAuthn capture
5. `feat/session-screen`: recording UI, network badge, wake lock, end-session flow
6. `feat/review-screen`: inline editing, NoteEdit history, missed-themes panel
7. `feat/webauthn-signoff`: per-note signing, challenge binding, audit log entry

**Open questions for sign-off**
- G2: confirm 200–500 ms resume gap is acceptable in pilot consent script
- G11: confirm `NoteEdit` table schema (per-field old/new value, editor, timestamp, reason)

---

### Sprint 8 — client-web PWA (Week 8)

**Goal:** Client-side adherence loop.

**Acceptance criteria**
- `apps/client-web` scaffolded as Next.js PWA
- QR claim flow: psychologist generates QR after session, client scans, account binds via one-time claim token
- Therapy home: today's exercises, mood log card, next session reminder
- Exercise execution screens: ≥5 CBT + ≥5 EMDR (structured-form archetype + timed-protocol archetype)
- Mood log (1–5 scale, optional note)
- Journal with share/private toggle
- Web Push subscription via FCM, with PWA install prompt for iOS
- Email + SMS fallback for critical adherence reminders (per § 6.3)
- WATI integration for treatment plan PDF send (real, not mock)

**Open questions for sign-off**
- WATI account credentials must be procured before sprint starts (no mock fallback)
- SendGrid + Twilio (or Indian alternatives) confirmed for email/SMS fallback

---

### Sprint 9 — End-to-end integration + compliance (Weeks 9–10)

**Goal:** Glue, polish, full compliance surface.

**Acceptance criteria**
- Full E2E demo: therapist signs up → adds client → conducts session → signs note → exercises push to client → client completes exercises → adherence visible in next briefing
- All 5 consent scopes captured separately in ConsentScreen
- Cross-border-processing consent clause active (per § 6.1)
- All 6 DSR endpoints implemented and tested
- Audit log writes verified for every audited action (chaos-style test: every endpoint generates exactly the expected audit entries)
- S3 30-day retention job tested with mocked time
- `docs/dpdp-data-flow.md` published
- Admin role added to `Psychologist` schema (gap G9); admin endpoints for audit-log read with row-level audit-of-the-audit
- Field-level encryption strategy (gap G10): PII columns (`Client.contactPhone`, `Client.contactEmail`, `JournalEntry.content`, `Session.transcript`) encrypted via pgcrypto + AWS KMS per-tenant data key, 90-day rotation
- `NoteEdit` table fully integrated; review screen shows revision history

---

### Sprint 10 — Hardening + pilot (Weeks 11–12)

**Goal:** Pilot-ready.

**Acceptance criteria**
- Observability stack live: Prometheus, Grafana, OTel collector
- All alerts configured with runbook files at `docs/runbooks/*.md`
- Load test: simulate 30 therapists running 5 concurrent sessions; system stable
- DR test: kill a service mid-session; verify graceful recovery (no audio lost; session resumes)
- Security audit checklist passed (OWASP top 10, secrets management, IAM)
- Backup/recovery targets (gap G12): RPO ≤ 15 min (Postgres PITR), RTO ≤ 1 hour (documented restore procedure tested)
- First 5 pilot therapist accounts provisioned
- First end-to-end real session with friendly psychologist + consenting test client

---

## 6. Cross-cutting decisions

### 6.1 Gemini integration — two-pass architecture

The PRD's "ap-south P0 hard gate" is technically infeasible as written. Vertex AI in asia-south1 (Mumbai) serves only Gemini 2.5 Flash / Flash-Lite. All Pro tier and 3.x models are global-endpoint only. Vertex's Data Residency Zone commitment for ML *processing* covers US and EU only — not India.

**Decision: two-pass architecture.** Audio stays in India; only transcript text crosses the border to the higher-quality Pro tier.

```
┌─────────────────────────────────────────────────────────────────┐
│  Pass 1: Transcription + paralinguistic features                │
│  Model: Gemini 2.5 Flash via Vertex AI asia-south1 endpoint     │
│  Input: 16 kHz mono PCM audio + patient context                 │
│  Output: { transcript, speakerSegments, affectFeatures }        │
│  Region: India (audio never leaves)                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓  transcript text only
┌─────────────────────────────────────────────────────────────────┐
│  Pass 2: Structured note generation + missed-themes             │
│  Model: Gemini 2.5 Pro (or 3.x) via global endpoint             │
│  Input: transcript text + patient context + modality state      │
│  Output: TherapyNoteV1 (structured JSON)                        │
│  Region: global (US/EU possible)                                │
│  Audio is NEVER sent to this pass.                              │
└─────────────────────────────────────────────────────────────────┘
```

**ModelRouter interface (revised from PRD Part 4.3):**

```ts
interface ModelRouterBackend {
  // Pass 1 — region-pinned, audio in
  transcribeAndAnalyseAudio(input: TranscribeInput): Promise<TranscribeOutput>;
  // Pass 2 — global, text in only
  generateStructuredNote(input: GenerateNoteInput): Promise<GenerateNoteOutput>;
  // Phase 2 (deferred)
  streamLivePromptEngine?(...): AsyncIterable<LivePrompt>;
}
```

Two concrete backends ship in V1: `VertexGeminiFlashIndiaBackend` (Pass 1) and `VertexGeminiProGlobalBackend` (Pass 2). `scribe-service` calls them in sequence on session end.

**Cost & latency:** ~30% higher Gemini cost per session (two calls). ~+8–15 s end-to-end latency. Pass 1's `affectFeatures` flow to `affect-engine-service` directly — no third call for affect.

**Consent script change.** A new clause: *"The text of my session (not the audio) may be processed by Google's AI service outside India to generate the structured clinical note. The audio recording itself stays in India."* Sprint 1 work. Requires Sharafath (Compliance) sign-off before Sprint 2 ships.

**Common ground:**
- SDK: `@google-cloud/vertexai` (handles regional + global endpoints cleanly)
- Auth: GCP service account JSON in AWS Secrets Manager; rotated every 90 days
- Prompts in `packages/llm/src/prompts/` as versioned constants. Changes require Dr. Noufal Hameed sign-off + version bump.
- Tests: unit (Zod validation against recorded fixture JSON), CI integration (record/replay via msw), nightly e2e (real Gemini, ~$2–5/run)
- Every call logged with model, region, latency, tokens, USD cost. Per-pass alerts. Hard circuit breaker per gap G6.

### 6.2 Web audio capture

- **AudioWorklet only.** MediaRecorder cannot emit raw PCM in any browser. Pipeline: `MediaStreamSource → AudioWorkletNode → Worker → IndexedDB + fetch upload`.
- **Safari gotcha:** `new AudioContext({sampleRate: 16000})` is silently ignored on WebKit. Capture at the hardware rate (usually 48 kHz) and resample in JS regardless of browser.
- **Resampling:** 48 → 16 kHz is integer 3:1 decimation. Apply a polyphase FIR low-pass (~7.5 kHz cutoff) before decimation. Use `libsamplerate-js` or `speex-resampler-wasm`.
- **Stream request:** `getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })`. Disabling AGC/NS preserves paralinguistic features for affect analysis.
- **Foreground reliability:** Chrome's Memory Saver and Energy Saver exempt tabs with active audio capture. Safari/Edge behave the same.
- **Background tab:** AudioWorklet keeps producing samples even when backgrounded, but main-thread `setTimeout`/`rAF` are throttled. **All chunking and upload work runs in the worklet or a Worker**, never on a main-thread timer.
- **Screen Wake Lock:** requested on session start. Auto-releases on tab hide / low battery → re-request on `visibilitychange`. Does not keep a backgrounded tab alive; only prevents screen sleep while visible.
- **Storage:** chunks → IndexedDB (`Blob`/`ArrayBuffer` keyed by `(sessionId, chunkIndex)`). `navigator.storage.persist()` at session start. Storage Buckets API with `{durability: 'strict'}` on Chromium 122+; fallback to standard IDB on Safari/Firefox. 10 MB is well under any quota.
- **Offline buffer drain:** Service Worker on `online` event; exponential backoff. Delete from IDB on 2xx.

**Session resume after refresh — honest answer.** In-flight capture is lost at the moment of refresh. Service Workers cannot host `getUserMedia` or Web Audio. Recovery path: persist chunk offset to IDB on every chunk; on page load, detect open session, re-request mic (sticky after first grant), resume with new chunk index; backend stitches by `(sessionId, chunkIndex)`. With sticky permission the gap is 200–500 ms. `beforeunload` warning to deter accidental refreshes. Documented in the consent script as a known web-vs-native trade-off.

### 6.3 Notifications

- Web Push via FCM. Android Chrome: ~99% delivery.
- **iOS Safari requires PWA install.** Client-web shows "Add to Home Screen" prompt during QR claim flow.
- Safari 18.4+ Declarative Web Push improves reliability for installed PWAs (~85–95%).
- **Treat Web Push as best-effort.** Pair with **email (SendGrid) + SMS (Twilio or Gupshup)** fallback for clinical adherence reminders. Critical reminders (e.g., post-risk-flag follow-up) never rely on push alone.

**WebAuthn for biometric sign-off.** `navigator.credentials.get({userVerification: "required"})` produces a signature over `authenticatorData || clientDataHash`. **The note hash is bound into the challenge** so the signature is cryptographically per-note. Note: the platform dialog says "Sign in to Cureocity Mind" — not "Sign Patient X's note" — so ReviewScreen displays the note prominently immediately before triggering the prompt. The `txAuthSimple` extension would solve this UX gap but has near-zero browser support; do not rely on it. Platform support is excellent on desktop (Touch ID, Windows Hello, Android biometric).

### 6.4 Mock services — none built

- `mock-partnermanagement` → not built. Psychologist registration goes directly into `patient-model-service`. Future integration with a production partnermanagement service is a Phase 2 schema migration.
- `mock-communication` → not built. Notifications use **real** integrations from day one (FCM, WATI, SendGrid, Twilio). **API keys must be procured before Sprint 8.**
- `mock-document-analysis` → not built. Document upload from SessionScreen is deferred to Phase 2.

### 6.5 Attribution & longevity surfaces — out of V1

- `attribution-service` not built.
- `AttributableEvent` table not created in V1 schema.
- Client-web has no Discover/longevity tab.
- The `LongevitySurfaceEligibility` rule engine is not built. The eligibility patterns (under-18, recent risk, opt-out, etc.) still apply to **any** monetization surface — re-implement when that surface lands.

### 6.6 Compliance sequencing

- Consent capture (DB models, `REQUIRED_FOR_SESSION` enum) — Sprint 1
- Cross-border consent clause (per § 6.1) — Sprint 1, Sharafath sign-off
- Audit log model — Sprint 1; write sites added per service
- Retention cron job — Sprint 5
- All 6 DSR endpoints — Sprint 9
- `docs/dpdp-data-flow.md` — Sprint 9
- Admin role + audit-log read endpoints — Sprint 9 (gap G9)
- Field-level encryption strategy — Sprint 9 (gap G10)

---

## 7. PRD gaps to resolve before relevant sprints

The PRD is thorough, but re-reading it with a web-only / no-fakes lens surfaced these gaps. Each has a sprint of decision; none are global blockers.

| # | Gap | Sprint of decision |
|---|---|---|
| G1 | Speaker diarization not specified | Sprint 4 (affect-engine) — addressed by Pass 1 Flash prompt |
| G2 | Session resume on tab refresh not addressed | Sprint 7 — resolution in § 6.2 |
| G3 | Crisis escalation protocol stops at "P0 incident" | Sprint 2 (when risk flags first detected) |
| G4 | No standardized outcome measures (PHQ-9, GAD-7, WHODAS) | Sprint 5 (catalog finalization) |
| G5 | Session statuses missing `CANCELLED`, `NO_SHOW`, `RESCHEDULED` | Sprint 1 (schema) |
| G6 | No hard cost circuit breaker, only alerts | Sprint 2 |
| G7 | Clinical supervision / co-signature workflow absent | Sprint 1 (defer or add supervisor role) |
| G8 | Account recovery if phone OTP fails | Sprint 6 |
| G9 | Audit log has no admin role defined | Sprint 9 |
| G10 | Field-level encryption strategy underspecified | Sprint 9 |
| G11 | Note edit history schema not modeled | Sprint 7 |
| G12 | No backup / RPO / RTO targets | Sprint 10 |
| G13 | Gemini Pro not in asia-south1 | **Resolved** — two-pass architecture (§ 6.1) |

---

## 8. Out of scope for V1

Explicitly named:
- Flutter mobile apps (replaced by web)
- Gemini Live API real-time prompts
- `attribution-service` and commission ledger
- Cureocity longevity surfaces in client app
- Mock services (no fakes)
- Telehealth video session capture (in-person only V1)
- WATI two-way messaging (one-way send only)
- Document analysis parsing
- In-app therapist ↔ client messaging
- AWS production deploy via Jenkins (V1 = GitHub Actions to staging)
- All Phase 2 items from PRD 22

---

## 9. Sign-off gates

Per PRD 22.1 Installment 2 closing line, sign-off required from:

- **Shamil** (CEO) — overall + product
- **Adhin** (Product) — sprint scope
- **Arjun** (Engineering) — architecture + delivery
- **Dr. Noufal Hameed** (Clinical) — clinical content, prompt templates, outcome measure inclusion
- **Sharafath** (Compliance) — DPDP, cross-border-processing consent clause, audit-log strategy
- **Jobin** (Pilot recruitment) — pilot readiness

Plus, this plan also needs explicit acknowledgment that:
1. Mobile-app deferral is acceptable for the pilot (no iOS / Android app store presence)
2. iOS Web Push reliability limitation is acceptable for client-side adherence (mitigated by email + SMS fallback)
3. Cross-border processing of session transcript text (not audio) is acceptable for clinical quality
4. The PRD gaps in § 7 are accepted as flagged-for-decision (not blockers to plan approval)
