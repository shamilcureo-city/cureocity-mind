# Clinical Co-Pilot — Sprints 13-17

Cureocity Mind started as an "AI scribe" — a tool to make Indian
psychologists faster at documenting sessions. By Sprint 12 that surface
was feature-complete. Sprint 13 pivoted to a different premise:
**many of the Indian psychologists actually using the product needed
help with diagnosis, treatment planning, and in-session technique** —
not just faster notes.

Sprints 13-17 built the clinical co-pilot. This doc explains what it
does, the architectural decisions behind it, and the new surfaces that
showed up in the codebase.

For the operational guide (how the code is organised, conventions to
follow), read **[`CLAUDE.md`](../CLAUDE.md)**.

## 1. The premise

The clinician records a session as before. After Pass 2 produces the
SOAP note, **three new things happen automatically**:

1. **Pass 3** reads the transcript + note + the client's confirmed
   history, and produces a **Clinical Brief**: ICD-11 diagnosis
   candidates with verbatim transcript citations + confidence, the
   assessment gaps still open, a case formulation, a treatment plan
   with measurable goals, recommended therapies, and any crisis flags.
2. The therapist reviews each section in the Clinical Brief tab and
   **accepts / modifies / rejects**. Confirmed diagnoses persist to a
   cumulative `ClientDiagnosis` table; confirmed plans persist to a
   versioned `TreatmentPlan` table.
3. **Pass 5** (the next time the therapist opens this client)
   produces a **Pre-Session Brief**: what to focus on today, what
   the last session ended on, an opening line the therapist can read
   aloud, and any open crises that need a safety check first.

Between sessions, the therapist can pick any recommended therapy from
the **Therapy Library**. **Pass 4** generates a step-by-step in-session
script — opening line, ordered steps with VERBATIM language the
therapist reads aloud, common branches for client responses, closing
line, homework, and risk watchpoints. The Script Player UI walks the
therapist through the steps in real time with an optional read-aloud
TTS (`SpeechSynthesisUtterance`).

Any artefact (signed note, reflection questions, therapy script,
treatment plan) can be sent to the patient via **WhatsApp / email /
private portal link**. The patient opens `/p/<token>` and sees a
typed, language-localised view of what was sent — the snapshot is
locked at share time so future edits don't change the patient's view.

Real Indian practice is code-mixed. The language model treats Manglish
(`["ml", "en"]`), Hinglish (`["hi", "en"]`), Tanglish, etc. as the
baseline case, not the edge case. Pass 1 transcribes in the spoken
language(s) preserving native scripts; notes are in the therapist's
output language (default English); patient-facing content is in the
client's preferred language.

## 2. The locked decisions

These were settled with the user before Sprint 13 PR 1 was written:

| Decision | Value | Rationale |
|---|---|---|
| AI authority | **Decision-support + confirm** | AI proposes, clinician confirms. Defensible under RCI scope-of-practice + DPDP audit trail. |
| Clinical content origin | **LLM-generated live** | No pre-curated knowledge base. Gemini Pro produces diagnoses + plans + scripts on demand from transcript + history. Faster to ship; the audit trail + confirm-gates carry the safety load. |
| Diagnosis codes | **ICD-11** chapter 06 | WHO's current standard, India-aligned, royalty-free. Codes stay in English even when narrative is in Malayalam. |
| Languages | **Multi-value spoken + single output + single patient-preferred** | Real Indian sessions are code-mixed; force a single language and we lose clinical signal. See § 5. |
| Curated content | **Only scored instruments** | PHQ-9 + GAD-7 are validated screeners whose validity depends on EXACT wording. Everything else is LLM-generated. |

## 3. The five Gemini passes

Each pass has its own prompt + Vertex backend + mock backend + router
entrypoint. Mock backends produce schema-valid deterministic output so
dev/CI exercise the full path without GCP creds.

```
                                  ┌──────────────────────────────┐
                                  │ Pass 5 — Pre-Session Brief   │
                                  │ context line + recap + focus │
                                  │ + opening line + watchpoints │
                                  └───────────────▲──────────────┘
                                                  │ before next session
                                                  │
record session ──▶ Pass 1 ──▶ Pass 2 ──▶ Pass 3 ──┴──▶ Pass 4 ──▶ Therapy Library
   audio          transcript    SOAP     Clinical    on demand    + Script Player
                  + per-segment  note    Brief        per therapy
                  language tag           (diagnosis +
                  + detected            plan + crisis)
                  languages[]
```

### Pass 1 — Transcribe + analyse (multilingual / code-mix)

File: `packages/llm/src/backends/vertex-flash-india.backend.ts`

- Vertex Gemini 2.5 Flash in `asia-south1` (DPDP residency for audio)
- Output: `transcript`, `speakerSegments[]` with per-segment `language`
  tag, `affectFeatures[]`, `detectedLanguages[]` (sorted by prevalence)
- Hints: `client.spokenLanguages[]` is sent as a soft transcription bias
- Schema: `Pass1OutputSchema` in `packages/llm/src/types/index.ts`
- Prompt: `TRANSCRIBE_AND_ANALYSE_SYSTEM_PROMPT_V2` (S16 bumped from V1)

Per-segment `language` is an ISO 639-1 code, `"mixed"` for true
code-switching, or `"unknown"` if detection failed. `detectedLanguages`
on the top level is a flat array sorted by prevalence: `["en"]`,
`["ml", "en"]`, `["hi", "en"]`, etc.

### Pass 2 — Note generation (unchanged from scribe era)

File: `packages/llm/src/backends/vertex-pro-global.backend.ts`

- Vertex Gemini 2.5 Pro (global)
- Output: `TherapyNoteV1` (SOAP + riskFlags + modalitySpecific + phaseHints)
- Schema: `TherapyNoteV1Schema` in `packages/contracts/src/note.ts`

### Pass 3 — Clinical Analysis (Sprint 13)

File: `packages/llm/src/backends/vertex-clinical.backend.ts`

- Vertex Gemini 2.5 Pro (global), `temperature=0.15` for deterministic
  diagnostic reasoning
- Output: `ClinicalReportV1` with:
  - `diagnosisCandidates[]` — each with `icd11Code`, `icd11Label`,
    `confidence` (0..1), `supportingEvidence[]` (verbatim transcript
    quotes), `gapsToFill[]`
  - `primaryDiagnosisIndex` — nullable index into candidates
  - `assessmentGaps[]` — open questions for next session
  - `formulation` — 3-6 sentence case formulation
  - `treatmentPlan` — modality + phaseSequence + goals + duration
  - `recommendedTherapies[]` — name + rationale + evidenceSummary + whenInPlan
  - `crisisFlags[]` — kind + severity + indicators + recommendedAction
- Prompt: `CLINICAL_ANALYSIS_SYSTEM_PROMPT_V1` — hard rules require
  chapter-06 ICD-11 codes, verbatim transcript quotes, confidence
  calibration (≤0.7 unless ≥2 independent supporting quotes)
- Confirmation: per-section `accept | modify | reject` via
  `PATCH /api/v1/clinical-reports/[id]/sections/[section]`. Accept on
  `diagnosis` writes `ClientDiagnosis` rows (supersedes prior primary
  on a different ICD code). Accept on `plan` bumps `TreatmentPlan.version`.
  Accept on `crisis` at high/critical severity writes
  `CRISIS_ACKNOWLEDGED` audit.
- UI: `apps/web/components/app/ClinicalBriefTab.tsx` — six section
  cards (diagnosis, gaps, formulation, plan, therapies, crisis). High/
  critical crisis renders a top banner with India hotline numbers that
  dims the rest of the brief until acknowledged.

### Pass 4 — Therapy Script (Sprint 14)

File: `packages/llm/src/backends/vertex-therapy-script.backend.ts`

- Vertex Gemini 2.5 Pro (global), `temperature=0.35` for natural
  verbatim speech variation
- Output: `TherapyScriptV1`:
  - `openingScript` (2-3 sentences) + `closingScript`
  - `mainExercise.steps[]` — each step has `purpose`, verbatim
    `therapistSays`, `listenFor` cue, 0-4 `branches` (`ifClientSays` →
    verbatim `thenDo`)
  - `adaptationCues[]`, `riskWatchpoints[]`, `homework`,
    `estimatedDurationMin`
- Prompt: `THERAPY_SCRIPT_SYSTEM_PROMPT_V2` (S16 bumped from V1) —
  distinguishes `outputLanguage` (therapist reads silently) from
  `spokenLanguage` (therapist reads aloud TO the client). Allows
  mid-sentence English clinical terms ("anxiety", "panic", "homework")
  when `spokenLanguage != en`.
- Cache: `(clientId, cacheKey)` where `cacheKey` is a SHA-256 hash of
  `(therapy, language, spokenLanguage, primaryDx, plan, lastSummary)`.
  v2 in S16 because the spokenLanguage component was added.
- UI: `apps/web/components/app/TherapyLibrary.tsx` — recommended
  therapies (from latest Clinical Report) + 10-entry built-in library.
  Script Player walks the therapist through steps with optional
  Web Speech API TTS (with BCP-47 voice mapping for Indian languages).

### Pass 5 — Pre-Session Brief (Sprint 17)

File: `packages/llm/src/backends/vertex-brief.backend.ts`

- Vertex Gemini 2.5 Pro (global), `temperature=0.2`
- Output: `PreSessionBriefV1`:
  - `contextLine` ("Session 4 of 8 · CBT for panic disorder.")
  - `lastSessionRecap` (2-3 sentences, empty for first sessions)
  - `todaysFocus` (2-3 sentences)
  - `openingLine` (verbatim, references something concrete from
    homework / last session)
  - `riskWatchpoints[]` (≤5 concrete cues)
  - `homeworkStatus` (description + outcome enum + notes)
  - `carryoverCrisis[]` (any open high/critical crisis flags from
    prior reports)
  - `latestInstruments[]` (latest PHQ-9 / GAD-7 readings)
- Cache: per `(clientId, lastSessionId, language)`. Re-generates
  automatically when a new session lands; `refresh=1` forces a fresh
  run.
- UI: `apps/web/components/app/PreSessionBriefCard.tsx` rendered at
  the top of the client detail page. Carryover crisis renders as a
  warning banner.

## 4. The cumulative clinical record

Confirmed AI suggestions persist to cumulative tables so the next session
is grounded in real history rather than re-asking the model from scratch.

| Source section | Confirmed → persists to | Supersession |
|---|---|---|
| `ClinicalReport.confirmations.diagnosis = ACCEPTED/MODIFIED` | `ClientDiagnosis` rows (one per candidate) | New diagnosis confirmation supersedes prior active diagnoses (`supersededAt` set) |
| `ClinicalReport.confirmations.plan = ACCEPTED/MODIFIED` | `TreatmentPlan` row (versioned) | New plan supersedes prior active plan; `version` auto-increments per client |
| `ClinicalReport.confirmations.crisis = ACCEPTED/MODIFIED` at high/critical | `CRISIS_ACKNOWLEDGED` audit; therapist optionally creates a `SafetyPlan` row | New safety plan supersedes prior |

The therapist can also administer **PHQ-9 / GAD-7** screeners
(`packages/clinical/src/instruments`); scored rows live in
`instrument_responses` and the trend feeds Pass 5.

## 5. Languages — multi-value, code-mix-first

The single most important design decision of Sprint 16:

| Concept | Field | Single or multi? | Purpose |
|---|---|---|---|
| Spoken | `Client.spokenLanguages`, `Session.spokenLanguages` | multi (ISO 639-1 + `mixed`) | What comes out of mouths. Pass 1 fills `Session.spokenLanguages`. |
| Output | `Session.language` | single | What therapist-facing notes / brief / script rationale is in. Defaults to English. |
| Patient-preferred | `Client.preferredLanguage` | single | What patient-facing content (portal, reflection questions, share copy) is in. |
| Verbatim-speech | Pass 4 `spokenLanguage` parameter | single | What the therapist reads ALOUD to the client. Defaults to client's first spoken language. |

For a Manglish-speaking client whose therapist takes notes in English
and shares portal content in Malayalam:

```
Client.spokenLanguages = ["ml", "en"]
Client.preferredLanguage = "ml"
Session.language = "en"             // notes in English
Pass 4 spokenLanguage = "ml"        // therapistSays in Malayalam with
                                    // mid-sentence English clinical terms
```

Pass 1 transcribes in the actual spoken language(s) preserving native
scripts ("എനിക്ക് anxiety undu" stays verbatim — not translated to
"I have anxiety"). Notes summarise in the therapist's output language.
Patient-facing materials render in their preferred language.

## 6. Sharing

Sprint 15 introduced the patient-share flow. Every share creates a
`PatientShare` row with:

- `artefactType` ∈ `SIGNED_NOTE | REFLECTION_QUESTIONS | THERAPY_SCRIPT | TREATMENT_PLAN`
- `channel` ∈ `WHATSAPP | EMAIL | PORTAL_LINK`
- `snapshot` (JSONB, locked at share time — the patient view never
  changes even if the source row is edited or deleted later)
- `shareToken` (16 random bytes → 22 base64url chars; the URL is the auth)
- `expiresAt` (default 30 days)
- `openedAt` (set on first portal view)

The portal page lives at `/p/[token]` — no auth, the entropy of the
token is the auth. The view is typed per `artefactType` with friendly
copy ("Hi {firstName}, here is the note from our session…").

Channels:
- **WhatsApp** via WATI's `sendTemplateMessage`. Template name in
  `WATI_TEMPLATE_PATIENT_SHARE` env (default `patient_share`). Template
  must be pre-approved by WhatsApp Business.
- **Email** via SendGrid. From-address in `SENDGRID_FROM_EMAIL`.
- **Portal link only** — no send; therapist copies the URL.

Snapshot builders strip therapist-facing verbatim language (script
steps, raw plan rationale) and produce patient-friendly summaries.
The `[mock]` tag prefix that mock backends use is stripped before
sending.

## 7. Curated content

The clinical co-pilot is intentionally LLM-generated except for two
small curated sets:

### Scored instruments
File: `packages/clinical/src/instruments/index.ts`

- **PHQ-9** (Kroenke 2001) — 9 items, 0..3 scale, 5 severity bands,
  item 9 is the suicidality risk flag.
- **GAD-7** (Spitzer 2006) — 7 items, 0..3 scale, 4 severity bands.
- Scoring is deterministic sum-of-items + band lookup. Throws on
  missing / out-of-range items.
- English-only in V1. The schema supports Malayalam / Hindi / Tamil /
  Bengali but those translations require clinician sign-off; no
  machine-translation.

### India crisis hotlines
File: `packages/clinical/src/crisis.ts`

- 5 verified hotlines (iCall, Vandrevala, NIMHANS, Childline, Women Helpline)
- `hotlinesForCrisisKind()` picks the most relevant 3 for a given
  crisis kind (suicidal_ideation, child_safety, intimate_partner_violence, …)
- Refreshed annually as numbers / hours can change

## 8. Audit + observability

| Sprint | New AuditAction values |
|---|---|
| 13 | `CLINICAL_REPORT_GENERATED`, `CLINICAL_SECTION_CONFIRMED`, `DIAGNOSIS_CONFIRMED`, `PLAN_CONFIRMED`, `CRISIS_ACKNOWLEDGED` |
| 14 | `THERAPY_SCRIPT_GENERATED`, `THERAPY_SCRIPT_VIEWED` |
| 15 | `PATIENT_ARTEFACT_SHARED`, `PATIENT_PORTAL_OPENED` |
| 16 | (no new audit actions; schema-only) |
| 17 | `PRE_SESSION_BRIEF_GENERATED`, `PRE_SESSION_BRIEF_VIEWED`, `INSTRUMENT_ADMINISTERED`, `INSTRUMENT_VIEWED`, `SAFETY_PLAN_CREATED`, `SAFETY_PLAN_UPDATED` |

| Sprint | New GeminiPass enum value |
|---|---|
| 13 | `PASS_3_CLINICAL_ANALYSIS` |
| 14 | `PASS_4_THERAPY_SCRIPT` |
| 17 | `PASS_5_PRE_SESSION_BRIEF` |

The audit-coverage chaos test
(`packages/contracts/src/audit-coverage.spec.ts`) scans `apps/web/app/api`
+ `apps/web/lib` + `apps/web/app/p` for `action: 'X'` literals and
asserts each AuditAction enum value has at least one writer or is
explicitly listed in `KNOWN_UNWIRED_ACTIONS`.

Observability `recordGeminiCall` accepts all 5 passes as label values;
each call also writes a `GeminiCallLog` row with model, region, prompt
version, token counts, latency, cost INR.

## 9. The competency dashboard (Sprint 17)

`/app/admin/competency` is a read-only roll-up table per therapist:

- Sessions completed
- Clinical reports generated
- % sections accepted / modified / rejected (from
  `CLINICAL_SECTION_CONFIRMED` audit metadata)
- Median time-to-confirm (pairs `CLINICAL_REPORT_GENERATED` audits with
  subsequent `CLINICAL_SECTION_CONFIRMED` via `clinicalReportId`
  metadata)
- Crisis-flag raise count
- Therapy scripts generated
- Pre-session briefs generated
- Patient shares sent

Useful for pilot evaluation; sellable to clinic owners as the
multi-tenant clinic role lands.

## 10. New schema (Sprints 13-17)

```
clinical_reports     (per session, JSONB body + per-section confirmations)
client_diagnoses     (cumulative, supersedable, ICD-11 + supporting quotes)
treatment_plans      (cumulative, versioned, supersedable)
therapy_scripts      (cached Pass 4 output, keyed by (clientId, cacheKey))
patient_shares       (one per artefact × channel, JSONB snapshot, expiry)
pre_session_briefs   (cached Pass 5 output, per clientId × lastSessionId × language)
instrument_responses (PHQ-9 / GAD-7 administrations, denormalised score + severity)
safety_plans         (Stanley & Brown 5-step, supersedable per client)
```

Session.spokenLanguages + Session.language + Client.spokenLanguages +
Client.preferredLanguage are the four language fields.

## 11. New routes (Sprints 13-17)

| Method + Path | Sprint | Purpose |
|---|---|---|
| `POST /api/v1/sessions/[id]/clinical-analysis` | 13 | Manually (re)run Pass 3 |
| `GET /api/v1/sessions/[id]/clinical-analysis` | 13 | Read the report |
| `PATCH /api/v1/clinical-reports/[id]/sections/[section]` | 13 | Accept / modify / reject |
| `GET /api/v1/clients/[id]/therapy-scripts?therapy=X[&refresh=1]` | 14 | Pass 4 cached/fresh |
| `POST /api/v1/share` | 15 | Fan-out share to N channels |
| `GET /api/v1/clients/[id]/shares` | 15 | History |
| `GET /p/[token]` | 15 | Public patient portal |
| `GET /api/v1/clients/[id]/pre-session-brief[?refresh=1]` | 17 | Pass 5 cached/fresh |
| `GET /api/v1/instruments` | 17 | Catalogue (PHQ-9, GAD-7) |
| `POST /api/v1/clients/[id]/instruments` | 17 | Administer + score |
| `GET /api/v1/clients/[id]/instruments` | 17 | History/trend |
| `POST /api/v1/clients/[id]/safety-plan` | 17 | Save (supersedes prior) |
| `GET /api/v1/clients/[id]/safety-plan` | 17 | Active plan |

Plus the new admin page `/app/admin/competency`.

## 12. Limits + caveats

- **No curated diagnostic knowledge base.** Everything except instruments
  comes from the LLM. The audit trail + per-section confirm gates are
  the safety mechanism.
- **No DSM-5.** ICD-11 chapter 06 only (the prompt enforces this).
- **English-only PHQ-9 / GAD-7** ship in V1. Schema supports translations
  but they require validated clinician-vetted versions.
- **Lightweight portal, not a full PWA.** A real patient PWA stays on
  the backlog if the portal proves insufficient.
- **No live "whisper" in-session assistant** yet (requires realtime STT).
- **Single-tenant per therapist** — multi-clinic with roles is pre-pilot
  backlog.
- **WATI templates must be approved** by WhatsApp Business before real
  prod sends. Dev/CI uses NoopBackend so the route still works without
  a template.

## 13. Where to extend

If you're adding the next feature, the most likely candidates are
backlog items from the original 13-sprint plan that survived the pivot:

- PII field-encryption rollout (schema has `*_encrypted` columns; apps/web
  doesn't read/write them yet)
- WebAuthn-bound note signing (mandatory after register flow lands)
- Real Firebase auth (drop the dev bypass)
- Multi-tenant Clinic + ClinicMembership + role-based admin
- Settings pages under `/app/settings/*`
- Billing (Stripe + Razorpay) with session quotas
- Sentry + observability dashboards + runbooks
- Validated Malayalam / Hindi PHQ-9 + GAD-7 (clinical sign-off required)

See `CLAUDE.md` § 11 for the full backlog list.
