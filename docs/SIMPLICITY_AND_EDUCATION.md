# Simplicity & Education — making the product teach as it works

> Status: **Sprint 58 shipped (inline foundation). Sprints 59–64 planned.**
> Owner-facing epic doc: the rationale, the information architecture, and
> the sprint-by-sprint build plan for turning Cureocity Mind into a tool a
> first-time-software, non-jargon-fluent therapist feels is **simple,
> clear, and worth it.**

## 1. The problem, stated honestly

Our pilot users are practising therapists, not software people. Many have
never used a clinical SaaS, and a good number were never trained on the
shorthand the app speaks fluently — SOAP, MSE, ICD-11, formulation,
reliable change. Today the product quietly assumes all of it:

- The session-note screen showed engineering language to the user —
  _"Pass 1 transcribes + diarizes; Pass 2 writes the clinical draft"_,
  _"polling every 2 seconds"_, a footer of _Segments / Transcript chars /
  Backend_. (Fixed in Sprint 58.)
- Note sections were bare clinical headings: _Subjective_, _Mental status
  exam_, _Working hypothesis_. (Fixed in Sprint 58 for the note views.)
- The **Learn** area (`/app/learn`) is a single flat scroll of five
  paragraphs — itself written in jargon ("Vertex Gemini pipeline
  transcribes and diarizes", "diagnosis candidates with ICD-11 codes").
  It is not navigable, not searchable, has no per-topic depth, and the
  sidebar points **both** "Learn" and "Get Help" at it.

The result: a powerful product that _feels_ like it's for someone else.
The fix is not a glossary page. It is to make the whole product **teach
as it works** — plain words first, the real term underneath, depth one
tap away — and to give that teaching a real **home with proper
navigation and big, calm clarity.**

## 2. Principles

1. **Plain-first, depth-on-tap.** The big heading is always human ("How
   they seemed today"); the clinical term sits small underneath ("Mental
   status exam"); the full explanation is a calm, collapsed "What's
   this?" — never forced, never cluttering.
2. **Big clarity over density.** Large headings, short lines, one idea per
   block, generous spacing, a picture or a step-list wherever a wall of
   text would otherwise sit. The opposite of a manual.
3. **Never intimidate.** Reassurance is a feature ("Nothing is final yet —
   you decide what it says"). Empty states teach instead of scolding.
4. **Teach the vocabulary, don't hide it.** Therapists should _grow_ into
   the real terms by seeing them paired with plain language — not be left
   ignorant of SOAP forever.
5. **India-first voice.** Calm, respectful, never preachy; examples and
   money in Indian terms; ready to speak Hinglish/Manglish.
6. **Deterministic + offline-friendly.** Education content is typed source
   in the repo (no CMS, no LLM, no GCP) — versioned, testable, instant,
   and works in dev/CI with the mock backend.
7. **One source of truth, reused everywhere.** A term is written once in
   the glossary / content registry and surfaces inline, in the Learn hub,
   in search, and (later) in every language.

## 3. The Learn & Help Center — information architecture

This is the heart of the ask: **not a glossary page — a navigable place
with the right information and big clarity.**

### 3.1 Structure

```
/app/learn                      ← Hub: hero + topic cards + search + "continue"
/app/learn/[topic]              ← A topic page (big clarity, plain language)
/app/learn/words                ← "Words explained" (glossary, browsable + searchable)
```

Left-hand **section navigation** inside Learn (sticky on desktop, a
collapsible menu on mobile), grouped the way a therapist's day flows —
NOT the way the code is organised:

| Group                    | Topics                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Getting started**      | What this app does · Add your first client · Consent & recording                                                                                        |
| **Recording a session**  | Before you press record · During the session · If something goes wrong                                                                                  |
| **Your notes**           | What a session note is · The four parts (SOAP), in plain words · The first-session record (intake) · Editing & fixing a note · Signing a note (and why) |
| **Understanding the AI** | What the AI does (and doesn't) · The clinical brief & diagnosis ideas · Why it shows evidence · You're always in charge                                 |
| **Measuring progress**   | PHQ-9 & GAD-7 in plain words · What "real change" means · The client's journey                                                                          |
| **Sharing with clients** | What you can send · WhatsApp / email / link · What the client can and can't see                                                                         |
| **Safety**               | Safety flags · Safety plans · India crisis helplines                                                                                                    |
| **Privacy & the law**    | How data is kept safe (DPDP) · Your client's rights · Recording consent                                                                                 |
| **Your practice**        | Billing & your plan · The Assistant · Settings                                                                                                          |
| **Words explained**      | The full plain-language glossary                                                                                                                        |

### 3.2 Page anatomy (the "big clarity" pattern)

Every topic page follows one calm template:

```
┌───────────────────────────────────────────────────────────┐
│  ‹ Your notes                                              │  ← breadcrumb
│                                                            │
│  The four parts of a note, in plain words                  │  ← big serif H1
│  A one-line promise of what you'll understand after this.  │  ← lede
│                                                            │
│  ● In one sentence            (a bolded plain summary)     │
│                                                            │
│  ── What the client shared ──────────────────────────────  │
│  2–3 short lines. A real example in a tinted box.          │
│  [ small illustration / annotated screenshot ]             │
│                                                            │
│  ── What you make of it ─────────────────────────────────  │
│  …                                                         │
│                                                            │
│  ✦ Try it now  → Open a session note                       │  ← deep link CTA
│  Related: Signing a note · Editing a note                  │  ← see-also
└───────────────────────────────────────────────────────────┘
```

- **One H1, short lede, a one-sentence summary up top** so a hurried
  therapist gets it in 5 seconds.
- **Sections mirror the product's plain titles** (the same strings the
  glossary uses), so what they read in Learn is what they see on screen.
- **Examples in tinted boxes; annotated screenshots; step-lists** — never
  a wall of prose.
- **"Try it now"** deep-links into the real screen (`/app`, `/app/clients`,
  a session tab) so learning converts to doing.
- **"Related"** cross-links keep navigation flowing.

### 3.3 Search

A single search box over (a) topic titles + summaries and (b) glossary
terms. Deterministic client-side index (the content is small and static),
results grouped "Topics" / "Words". No backend, no latency.

### 3.4 Contextual entry — Learn is reachable from where confusion happens

- Every inline **"What's this?"** gains a **"Read more →"** that deep-links
  to the matching Learn topic.
- A persistent **"?" help button** opens help _for the current screen_
  (Sprint 61) plus the search box.
- The sidebar splits cleanly: **Learn** → the hub; **Get Help** →
  troubleshooting/contact + the same search (no longer the same page).

## 4. The sprint plan

Each sprint is independently shippable and verifiable in dev/CI with the
mock backend (deterministic content; no GCP). Sprint 58 is done.

### Sprint 58 — Inline education foundation ✅ (shipped: commit `dbf359a`)

**Goal:** make the session-note documentation teach as it works.

- `apps/web/lib/clinical-glossary.ts` — typed, India-voiced plain-language
  entries (`plainTitle` / `term` / `what` / `why?` / `example?`).
- `apps/web/components/app/EduHeading.tsx` — `EduSection`,
  `InlineExplainer`, `HelpNote` (tap-first, collapsed by default,
  full-width readable reveal panel).
- Rewired `NotePreview` (SOAP) + `IntakeNotePreview` (intake) to lead with
  plain titles + clinical subtitle + "What's this?".
- De-jargoned `NotesTab` generate/sign/processing copy; collapsed the
  technical footer; added "Nothing is final yet" + sign-off explainer.
- **Verified:** typecheck + lint + `next build` green.

**Remaining tail (fold into 59):** broaden glossary coverage; add the
"Read more →" hook (inert until the hub exists).

### Sprint 59 — Education everywhere (the rest of the documentation)

**Goal:** every clinical surface speaks plain-first, using the same
components.

- Extend the glossary with ~30 terms: ICD-11, diagnosis candidate,
  confidence %, supporting evidence, formulation (5 Ps), treatment plan &
  goals, recommended therapy, crisis flag severity, reliable change,
  remission, response, baseline, PHQ-9, GAD-7, journey stages, episode,
  discharge, pre-session brief, therapy script, reflection questions,
  share channels, portal, etc.
- Wire `EduSection` / `InlineExplainer` into: `ClinicalBriefTab`,
  `InitialAssessmentTab`, `InstrumentRunner` (Measures), `CaseBriefingPanel`,
  `DiagnosisHistoryCard`, `RiskBanner`, `ShareModal`, `JourneyHeader`.
- Add a `relatedTopic?` field to glossary entries; render "Read more →" on
  every explainer (resolves once Sprint 60 lands).
- **Files:** `lib/clinical-glossary.ts`, the components above.
- **Verify:** typecheck/lint/build; visual pass per tab with mock data.
- **No** migration, no LLM.

### Sprint 60 — The Learn & Help Center (the navigable hub) ★

**Goal:** replace the flat `/app/learn` scroll with the navigable,
high-clarity hub in §3. This is the centerpiece.

- **Content registry:** `apps/web/lib/learn-content.ts` — a typed model:
  `LearnGroup[] → LearnTopic { slug, title, lede, oneLiner, sections:
LearnSection[], related[], tryIt?, glossaryRefs[] }`. Deterministic,
  unit-testable, version-controlled. (A test asserts every `relatedTopic`
  in the glossary resolves to a real topic, and every topic's
  `glossaryRefs` exist — the same "no dangling reference" discipline as
  the audit-coverage chaos test.)
- **Routes:** rebuild `app/app/learn/page.tsx` (hub: hero + grouped topic
  cards + search + "continue where you left off"); add
  `app/app/learn/[topic]/page.tsx` (topic template from §3.2); add
  `app/app/learn/words/page.tsx` (browsable glossary).
- **Components:** `components/app/learn/LearnNav.tsx` (sticky section nav +
  mobile menu), `LearnSearch.tsx` (client-side index over topics +
  glossary), `LearnTopicBody.tsx`, `TryItLink.tsx`, plus a small set of
  inline SVG/annotated illustrations.
- **De-jargon** the migrated onboarding copy entirely.
- **Sidebar:** point **Learn** → hub; repoint **Get Help** → a help/
  troubleshooting topic + search (no longer the same URL).
- **Wire** every inline "Read more →" to `/app/learn/[topic]#[section]`.
- **Verify:** typecheck/lint/build; registry-integrity test; nav + search
  by hand.

### Sprint 61 — First-run welcome, guided tour, "?" help

**Goal:** hold a new therapist's hand the first time, and make help
reachable from anywhere.

- **First-run welcome:** a calm 4–5 card overlay on first login (what this
  is, how a session flows, you're always in charge, where help lives).
  Gated by a per-therapist `hasSeenWelcome` flag — Psychologist column +
  a one-line migration + a `WELCOME_DISMISSED` audit action (wired, per
  the audit-coverage rule), with a localStorage fast-path so it works
  before the column ships.
- **Guided tour:** lightweight coach-marks on the session workspace the
  first time a draft appears (point at the plain titles, "What's this?",
  Sign off). Dismissible, resumable from Learn.
- **"?" help button:** persistent, opens contextual help for the current
  route + the Learn search. Maps route → Learn topic via a small table.
- **Empty states:** sweep the main screens; every empty state gets a
  `HelpNote`.
- **Files:** `components/app/WelcomeOverlay.tsx`, `HelpButton.tsx`,
  `lib/route-help-map.ts`, `prisma` migration, settings route + audit.
- **Verify:** typecheck/lint/build; migration deploy in dev; chaos test
  still green.

### Sprint 62 — Multilingual education (Hinglish / Manglish / Hindi first)

**Goal:** speak the therapist's language, literally.

- Make the glossary + Learn registry **locale-keyed** (`en` default, then
  `hi` + Hinglish/Manglish phrasing, expandable to ta/bn/ml…). Respect the
  therapist's preferred UI language; a toggle on the help surfaces.
- **Human-validated copy only** — no machine translation (per the existing
  CLAUDE.md multilingual rule). Ship English + one Indian language end-to-
  end as the pattern; stub the rest behind a clean fallback to English.
- **Files:** locale layer in `lib/clinical-glossary.ts` +
  `lib/learn-content.ts`; a `useLearnLocale` hook; translation files.
- **Verify:** typecheck/lint/build; missing-key fallback test.

### Sprint 63 — Documentation features, education baked in

**Goal:** the documentation features we scoped — but each ships _with_ its
plain-language teaching, so it lands simple.

- **Note-format choice** (SOAP / DAP / BIRP / narrative) with a "Which
  should I pick?" helper and a per-therapist default. Generalises the note
  contract (same discriminated-union pattern as intake/treatment).
- **Pre-sign "Is this note ready?"** — a friendly, deterministic
  completeness / golden-thread check (empty sections; risk flagged in the
  brief but not the note; plan not linked to a goal) shown as gentle
  suggestions, not blockers, each with a "why".
- **Case-file export + discharge summary + referral letter** — each
  introduced by a Learn topic + inline help, credential/RCI-stamped.
- **Sequencing note:** format-choice + ready-check are near-term and reuse
  Sprint 58 scaffolding; the case documents are a larger sub-epic (own
  PRs) and may split into 63a/63b.

### Sprint 64 — Close the loop: learn from what confuses people

**Goal:** make the education self-improving.

- **Lightweight telemetry:** count which "What's this?" / topics get
  opened most (a `HELP_VIEWED` metric via the existing observability
  counters — no PII). The terms opened most are the ones to simplify
  further or surface earlier.
- **"Was this helpful?"** thumbs on topic pages → a tiny feedback signal.
- Feed both into a quarterly copy pass.

## 5. Data model & conventions

- **No new UI primitives in `components/ui/`** — compose existing ones;
  education components live in `components/app/` and `components/app/learn/`.
- **Glossary entry** (`lib/clinical-glossary.ts`): `plainTitle`, `term?`,
  `what`, `why?`, `example?`, `relatedTopic?` (Sprint 59+), locale map
  (Sprint 62).
- **Learn topic** (`lib/learn-content.ts`): typed, with a registry-
  integrity unit test (no dangling topic/term references).
- **State-changing endpoints** (welcome dismissal, feedback) use
  `writeAudit` with literal action strings and a wired writer, per the
  audit-coverage chaos test.
- **Deterministic everywhere** — content is source, not model output; the
  whole epic runs in dev/CI with `LLM_BACKEND=mock`.

## 6. Cross-cutting

- **Accessibility:** real `<button>`/`aria-expanded` (already in
  `EduHeading`); keyboard + screen-reader reachable; tap targets sized for
  phones.
- **Performance:** static content, client-side search index, zero added
  network calls on the clinical path.
- **Mobile:** plain-first + collapsed depth is mobile-friendly by design;
  Learn nav collapses to a menu.
- **Tone QA:** one reviewer owns voice consistency (plain, warm, India-
  first) across every string.

## 7. Out of scope (for now)

- A full CMS / non-engineer content editing — content stays typed source.
- Video tutorials / animated walkthroughs (text + annotated stills first).
- AI-generated, personalised help answers (revisit after telemetry in
  Sprint 64 shows the real questions).
- Machine-translated copy — explicitly disallowed; human-validated only.
