# Documentation & Education — master sprint roadmap

> The single, ordered backlog for the whole "make documentation great +
> make it feel simple" effort. It merges three workstreams:
>
> - **Education / simplicity** (plain-language everywhere + a real Learn
>   Center) — design detail in [`SIMPLICITY_AND_EDUCATION.md`](./SIMPLICITY_AND_EDUCATION.md).
> - **A — Making the note better** (post-consultation).
> - **B — Making the case a document** (the "case" features).
>
> Feature rationale + evidence: [`FEATURE_RESEARCH.md`](./FEATURE_RESEARCH.md).
>
> Sequencing rule: **every documentation feature ships already wrapped in
> plain-language help** (glossary entry + inline "What's this?" + a Learn
> topic), so nothing lands as a bare power-user feature. All sprints are
> independently shippable and verifiable in dev/CI with `LLM_BACKEND=mock`.

Legend: ✅ shipped · ◐ partially exists in product · ☐ to build.

---

## Phase 1 — Plain-language everywhere (education)

### S58 — Inline education foundation ✅ (shipped: `dbf359a`)

- ✅ Glossary (`lib/clinical-glossary.ts`) + `EduSection` / `InlineExplainer`
  / `HelpNote` (`components/app/EduHeading.tsx`).
- ✅ SOAP + intake note views lead plain-first; de-jargoned the
  generate / sign / processing copy; technical footer collapsed.

### S59 — Education on every clinical surface

- ☐ Wire `EduSection` / `InlineExplainer` into: Clinical Brief, Initial
  Assessment, Measures (PHQ-9/GAD-7), Case Briefing, Diagnosis History,
  Risk banner, Share modal, Journey.
- ☐ +~30 glossary terms (ICD-11, confidence, evidence, formulation/5 Ps,
  treatment goals, reliable change, remission, response, baseline,
  stages, episode, discharge, brief, script, channels…).
- ☐ Add `relatedTopic?` to glossary entries + render "Read more →"
  (inert until S60).
- Files: `lib/clinical-glossary.ts`, the listed components. No migration.

### S60 — The Learn & Help Center (navigable hub) ★

- ☐ Typed content registry `lib/learn-content.ts` (groups → topics →
  sections) + registry-integrity unit test (no dangling refs).
- ☐ Rebuild `app/app/learn/page.tsx` (hub) + `learn/[topic]/page.tsx`
  (big-clarity topic template) + `learn/words/page.tsx` (glossary browse).
- ☐ `LearnNav` (section nav + mobile menu), `LearnSearch` (client-side
  over topics + words), `TryItLink`, light SVG/annotated illustrations.
- ☐ Split sidebar: **Learn** → hub, **Get Help** → troubleshooting + search.
- ☐ Resolve every inline "Read more →".

### S61 — Welcome + guided tour + "?" help

- ☐ First-run welcome overlay (4–5 calm cards), gated by a per-therapist
  `hasSeenWelcome` flag (Psychologist column + migration +
  `WELCOME_DISMISSED` audit), localStorage fast-path.
- ☐ Guided coach-marks on the session workspace first draft.
- ☐ Persistent "?" help button → contextual help for the current route +
  search (`lib/route-help-map.ts`).
- ☐ Empty-state sweep — every empty screen gets a `HelpNote`.

---

## Phase 2 — Making the note better (A)

### S62 — Note-format choice + "Is this note ready?" check ★

- ☐ **Note-format library:** SOAP / DAP / BIRP / GIRP / narrative; a
  per-therapist default + per-client override; a plain "Which should I
  pick?" helper. Generalise the note contract to a discriminated union by
  format (same pattern as intake-vs-treatment). New `GeminiPass`/prompt
  variants reuse Pass 2 plumbing; mock backend covers each format.
- ☐ **Pre-sign completeness / golden-thread check** (deterministic, no
  LLM): empty/thin sections; risk flagged in the brief but `NONE` in the
  note; plan not linked to any active goal; diagnosis without evidence;
  consent/mode-of-session missing. Rendered as gentle suggestions with a
  "why" — never a hard blocker.
- Contracts: note-format enum + schema union (`packages/contracts`).
  Migration: note-format column on `NoteDraft`/`TherapyNote`. Audit:
  `NOTE_FORMAT_CHANGED`.

### S63 — Smarter editing

- ☐ **Learn-from-edits style profile:** mine the existing `NoteEdit`
  trail (before/after per field) → a per-therapist style profile (length,
  person/tense, habitual adds/cuts) that conditions the next Pass 2 draft.
  New `PsychologistStyleProfile` table; recompute on each sign.
- ☐ **Inline targeted edit:** select a sentence → "tighten / add risk
  language / expand" (vs today's whole-note `/note/modify`). New
  `/note/modify-span` route; preserves severity + modality verbatim.
- ☐ **Post-sign addendum:** an append-only, timestamped, signed addendum
  (distinct from field-level revision). New `NoteAddendum` rows;
  `NOTE_ADDENDUM_ADDED` audit; surfaced on the record + PDF.

### S64 — Note depth & continuity

- ☐ **Process notes vs progress notes:** a separate private "process
  notes" space kept out of the official + shareable record. New
  `ProcessNote` model (psychologist-private; never in any `PatientShare`).
- ☐ **Auto "progress since last session":** a thread-line generated from
  the previous note + instrument deltas, woven into the new draft.
- ☐ **Structured per-modality sections:** turn the generic
  `modalitySpecific` blob into typed sections (EMDR SUDS/VOC, exposure
  hierarchy, couples genogram), rendered with EduSection help.

---

## Phase 3 — Making the case a document (B)

### S65 — Case file + discharge summary

- ☐ **Full case-file PDF export:** one chronological document — intake →
  every note → diagnosis history → plan versions → instrument trajectory
  → shares → discharge. New `GET /clients/[id]/case-file/pdf`
  (react-pdf), credential/RCI-stamped. Audit: `CASE_FILE_EXPORTED`.
- ☐ **Formal discharge / closing summary** (clinician-facing, distinct
  from the patient Progress Report): generated off the existing discharge
  flow. New artefact + `DISCHARGE_SUMMARY_GENERATED` audit.

### S66 — Letters (referral + supporting)

- ☐ **Referral letter** to a psychiatrist/GP (MHCA medication-referral
  need), generated from the cumulative record, signed, credential-stamped.
- ☐ **Supporting letters:** attendance, fitness-to-work/study,
  accommodation/court support — from a small template set the therapist
  edits. New `Letter` model + `LETTER_GENERATED` audit; PDF + share.
- Dependency: credential/RCI stamping (shared with S65) must land here.

### S67 — Find & manage

- ☐ **Problem list:** a stable, editable per-client problem list (seeded
  from the Case Briefing, then therapist-owned). New `ProblemListItem`.
- ☐ **Cross-note search:** full-text over a client's notes + caseload
  ("where did we discuss her father", "which clients have open SI
  flags"). Postgres FTS over note content; tenant-scoped.
- ☐ **Documentation worklist + batch sign:** a "notes due" queue with
  quick-sign for end-of-day batching. New `/app/today`-adjacent surface
  or a dashboard card.

### S68 — Collaboration

- ☐ **Supervisor co-sign / review:** route a note to a supervisor for
  feedback or co-sign (trainee notes co-signed by a licensed clinician —
  India M.Phil supervised-hours reality). Needs a light supervisor
  relationship + `NOTE_COSIGNED` / `NOTE_REVIEW_REQUESTED` audit.

---

## Phase 4 — Reach, trust, and the learning loop

### S69 — Multilingual education

- ☐ Locale-key the glossary + Learn registry (en default → Hindi +
  Hinglish/Manglish, expandable). Human-validated copy only — no machine
  translation. Toggle on help surfaces; clean fallback to English.

### S70 — Compliance & interop

- ☐ **Credential / RCI stamping everywhere** an export leaves the app
  (notes, letters, receipts) — if not already shipped with S65/S66.
- ☐ **Amendment-visible record:** surface "amended on X" on the note
  itself (the immutable `NoteEdit` trail already exists) — medico-legal
  honesty without opening the audit log.
- ☐ **ABHA / ABDM linkage** (forward-looking): link a record to India's
  health ID for interop/portability.

### S71 — Learn from confusion

- ☐ **Help telemetry:** count which "What's this?" / topics open most
  (a `HELP_VIEWED` observability counter, no PII) → simplify what
  confuses, surface it earlier.
- ☐ **"Was this helpful?"** thumbs on topic pages → a small feedback
  signal feeding a quarterly copy pass.

---

## What's already in the product (don't rebuild)

- ◐ Per-signed-note PDF export · field-level post-sign revision
  (`NoteEdit`) · cumulative diagnosis + plan history · Case Briefing
  (Pass 6) synthesis · patient-facing Progress Report · WebAuthn signing.
  The roadmap above extends these rather than duplicating them.

## Cross-cutting conventions (apply to every sprint)

- Contracts-first (Zod in `packages/contracts`); validate at the boundary.
- Audit every state-changing endpoint with a literal action string + a
  wired writer (audit-coverage chaos test).
- No new UI primitives in `components/ui/` — compose existing ones.
- Per-sprint Prisma migration; append-only enum values with
  `ADD VALUE IF NOT EXISTS`.
- Deterministic content + mock-backed passes so dev/CI need no GCP.
- Every user-facing string: plain-first, India voice, teach-don't-hide.
