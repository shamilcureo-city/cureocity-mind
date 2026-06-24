# Shipped — Education + Documentation epic (branch `claude/dazzling-babbage-82imy0`)

> A consolidation record for the 12 sprints built in this session, plus a
> **deploy / verify checklist** and the **deferred follow-ups**. Roadmap:
> [`DOCUMENTATION_ROADMAP.md`](./DOCUMENTATION_ROADMAP.md). Rationale:
> [`SIMPLICITY_AND_EDUCATION.md`](./SIMPLICITY_AND_EDUCATION.md),
> [`FEATURE_RESEARCH.md`](./FEATURE_RESEARCH.md).

All work was verified by **typecheck + lint + production build** (and the
audit-coverage chaos test where new audit actions were added). Nothing was
runtime-tested against a live database, because this environment has no DB
connection — see **§3** for what that means and how to land it.

## 1. What shipped

| Sprint | Commit | What | DB? |
| --- | --- | --- | --- |
| S58 | `dbf359a` | Inline plain-language education on the session notes (glossary + `EduSection`/`InlineExplainer`/`HelpNote`; de-jargoned the flow) | no |
| S59 | `7ea291f` | Education on every clinical surface (Clinical Brief, Initial Assessment, Measures, Risk, Diagnosis history) + ~18 glossary terms | no |
| S60 | `0d0cfcb` | The navigable **Learn & Help Center** (`/app/learn` hub, `/app/learn/[topic]`, `/app/learn/words`, search) | no |
| S61 | `0e2ade6` | First-run **welcome overlay**, persistent **"?" help button**, route-aware help, empty-state sweep | no* |
| S62a | `9fb1b0c` | **"Is this note ready?"** pre-sign completeness check | no |
| S62b | `52b3b3e` | **Note-format view** (SOAP / DAP / BIRP / Narrative) — deterministic re-map | no |
| S65 | `3e9ca5b` | **Case-file PDF** export (whole chart) | **migration** |
| S65b | `a658808` | **Discharge / treatment summary** PDF | **migration** |
| S66 | `a419430` | **Referral & supporting letters** (compose + PDF) | **migration** |
| S67a | `a47409b` | **Cross-note search** (`/app/search`) | no |
| S67b | `ff6dd00` | **Documentation worklist** (`/app/notes-due`) | no |
| S67c | `2617ce5` | **Per-client problem list** | **migration** |

\* S61's welcome dismissal uses **localStorage** (the roadmap-sanctioned
fast-path); the durable DB flag is a deferred follow-up (§4).

## 2. Migrations added (apply on deploy)

Four append-only migrations, all idempotent / standard:

- `prisma/migrations/20260724000000_sprint65_case_file_export` — adds
  `CASE_FILE_EXPORTED` audit value.
- `prisma/migrations/20260725000000_sprint65b_discharge_summary` — adds
  `DISCHARGE_SUMMARY_EXPORTED` audit value.
- `prisma/migrations/20260726000000_sprint66_letters` — `LetterKind` enum
  + `letters` table + `LETTER_GENERATED` audit value.
- `prisma/migrations/20260727000000_sprint67c_problem_list` —
  `ProblemStatus` enum + `problem_list_items` table + 3 audit values.

## 3. Deploy / verify checklist

These are the steps to actually land + trust the DB-backed features. The
pure-UI sprints (S58–S62b, S67a, S67b) need no special verification beyond
a normal deploy.

1. **Apply migrations** on the target DB:
   ```bash
   DATABASE_URL=… pnpm exec prisma migrate deploy
   ```
   Confirm `prisma migrate status` is clean (4 new migrations applied).
2. **Regenerate the client** if not part of the build:
   `pnpm exec prisma generate`.
3. **Click-through each new surface** with a real client that has a few
   signed sessions + an episode + some PHQ-9/GAD-7 scores:
   - Client page → **Download case file (PDF)** → opens, sections populate.
   - Client page → **Download discharge / treatment summary (PDF)**.
   - Client page → **Write a letter** → pick each type → **Download PDF**.
   - Client page → **Problem list** → add / resolve / reopen / remove.
   - Sidebar **Search** → query a word you know is in a note → result +
     snippet → opens the session.
   - Dashboard → **Notes to finish** → buckets render, links work.
   - Session note → **Format** switch (SOAP/DAP/BIRP/Narrative).
   - Sidebar **Learn** → hub, a topic page, **Words**, search; the **"?"**
     button on any screen; first-run **welcome** (clear `localStorage`
     key `cm.welcome.v1` to re-trigger).
4. **Audit sanity**: each export/letter/problem action writes its audit
   row (the chaos test already proves a writer exists for every action).

## 4. Deferred follow-ups (intentionally not built here)

Quality-bar reasons (runtime-unverifiable here, or out of scope):

- **PDF-per-format** — the in-app note **Format** switch (S62b) is a view;
  `GET …/note/pdf` still renders SOAP. Thread the format through the PDF
  route + a generalized PDF component.
- **Native per-format generation** — retraining Pass 2 to *write* DAP/BIRP
  natively (vs. re-mapping). Needs GCP + a note-contract union; higher
  blast radius across sign/edit/share — deferred deliberately.
- **Durable welcome flag** — replace S61's localStorage with a per-
  therapist `hasSeenWelcome` column + `WELCOME_DISMISSED` audit + a
  settings route (needs a migration + a real DB to verify).
- **Letter / ProblemListItem cascade** — both use scalar owner FKs (no
  Prisma relation) to keep migrations self-contained; add an
  `onDelete: Cascade` relation (or wire into the DSR-erasure sweep) so a
  client soft-delete/erasure also clears these.
- **Cross-note search at scale** — V1 scans `content::text ILIKE`; add a
  `tsvector` column + GIN index if a caseload's note volume grows.
- **Letter editing** — letters are composed + persisted; an edit-before-
  download surface is a follow-up.

## 5. Remaining roadmap (not started)

- **S68 — Supervisor co-sign / review** (last Phase 3 item): route a note
  to a supervisor for feedback / co-sign. Needs a supervisor-relationship
  model + a review workflow — the largest remaining build.
- **S69 — Multilingual education**: locale-key the glossary + Learn
  content (human-validated copy only; no machine translation).
- **S70 — Compliance & interop**: credential stamping audit on the record,
  amendment-visible note, ABHA/ABDM linkage.
- **S71 — Learn-from-confusion**: `HELP_VIEWED` telemetry + "was this
  helpful?".

## 6. Conventions held throughout

Contracts-first (Zod in `packages/contracts`); audit every state-changing
endpoint with a literal action + a wired writer (chaos test enforced);
tenant filtering by `psychologistId` on every read/write; per-sprint
migration with append-only enum values; no new UI primitives in
`components/ui/`; deterministic + mock-friendly (no GCP needed for any
shipped sprint); every user-facing string plain-first + India-voiced.
