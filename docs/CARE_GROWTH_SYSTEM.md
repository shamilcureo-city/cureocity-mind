# Cureocity Care — the Growth System

**Onboarding → assessment & plan → habit engine → monetization → growth loops.**
This is the full attraction-and-attachment design for the `/care` product: how a
stranger becomes an activated user, an attached user, a paying user, an
advocate — and eventually a graduate. It closes two decisions the original spec
left open (`docs/AI_COUNSELING.md` §14: #1 brand noun, #3 pricing) and extends
the AC sprint line with a growth track (**CG1–CG6**, §12).

_How this doc was made:_ two code-grounding passes over the live product, two
research passes (India competitive landscape + behavior-design evidence), five
parallel system designs (onboarding, assessment/plan, habit, monetization,
growth), then two adversarial critiques — a clinical-ethics attack and a
staff-engineer feasibility attack verified line-by-line against the repo. Every
conflict the critics found is resolved inline; §14 lists the changes they
forced.

---

## 1. The thesis: attached, not addicted

The ask was "make the user attracted and addicted." In a mental-health product
the durable version of addicted is **attached**: the user returns because the
product demonstrably remembers them and because they can see themselves getting
better. Compulsion mechanics (shame streaks, FOMO, countdowns, upsells timed to
emotional moments) are precisely what the FTC complaint against Replika
documents, what app-store reviews punish, and what churns users at their most
vulnerable. Every loop in this system therefore runs on one of two fuels:

1. **Being remembered.** The persona provably holds your story (case-file
   continuity — already built). Every cheap daily action (a 10-second mood dial,
   a one-line note) makes tomorrow's session visibly better. That is the
   ethical variable reward, and it is the one loop Wysa/Replika-class
   competitors demonstrably fail at (their #1 complaints: repetition and memory
   loss).
2. **Evidence of getting better.** Deterministic PHQ-9/GAD-7 reliable-change
   verdicts ("past the bar clinicians use to call change reliable") — the
   product's headline promise, currently structurally dead because no UI ever
   administers the instruments (§11).

The endgame is designed, not fought: **graduation** — getting better and
leaving — is a tracked success outcome and a pricing feature ("we stopped your
billing ourselves"), because "the app that celebrated me leaving" is the most
credible acquisition asset this category can produce.

Why this is the commercial choice, not just the ethical one: trust is the
entire purchase decision in this category ("cheap chatbot" skepticism × therapy
stigma), regulation is moving (Illinois' WOPR Act bans AI therapy outright;
India's DPDP scrutiny of emotion-AI is rising), and every competitor's churn
story is a trust failure. Honesty is the moat. The product already says "we
never pretend otherwise" — this system makes every mechanic keep that promise.

---

## 2. The funnel at a glance

```
STRANGER ──ad/reel/SEO──▶ /care landing ─▶ /care/check (no-signup PHQ-9)
   │                                             │
   ▼                                             ▼
SIGNUP (phone OTP, de-shamed) ─▶ onboarding v2 (4 thin steps, voice previews)
   │
   ▼
FIRST DAY: prelude ritual → intake session → mood-after → THE REVEAL
   (their own words quoted back) → plan-accept ceremony → baseline PHQ-9
   → next-session intent + reminder opt-in            [ACTIVATED]
   │
   ▼
WEEKS 1–3: habit engine — daily micro-loop (dial + one line), homework
   ticks, "Meera remembers" prep lines, WhatsApp utility nudges,
   loss-proof showing-up record                        [ATTACHED]
   │
   ├──▶ cap moment (the ONE sanctioned commerce surface) → Plus  [PAYING]
   ▼
SESSION 6: pre-review check-in gate → REVIEW → verdict moment
   ("reliable improvement" / "we change something, not you")
   │
   ├──▶ milestone/graduation share cards, gift-a-session  [ADVOCATE]
   ▼
GRADUATION: billing stopped by us, alumni mode, door-open win-back [GRADUATE]
```

---

## 3. Positioning & brand (closes open decision #1)

**The noun: "AI therapist" — never "therapist" unqualified.** The ethics
critique flagged the drafted hero ("Your own therapist. Tonight.") as the
single strongest attack line against the product: under MHCA/RCI framing
"therapist" implies a licensed professional, and the product's own research
says the disclosure IS the hook. Three characters fix it:

> **"Your own AI therapist. Tonight."**

**The one-line promise:** _"Not a chatbot that agrees with you — an AI
therapist that shows its work."_ Every session ends in a written report that
quotes your own words; every sixth session is scored on the same instruments
clinicians use; when you're better, it tells you to leave.

**The competitive opening (mid-2026):** Woebot's consumer app shut down (June
2025). Wysa has drifted B2B. Ash (Slingshot, $93M) set the product bar but is
US/English-only. Amaha is an English-only human-therapy funnel; Healo is
coach-grade voice. **Nobody has shipped a code-mix Indian-language voice
therapist with a clinical session arc and deterministic outcome measurement.**
That sentence is the press pitch, the ad angle, and the moat.

**Anti-stigma register (the copy voice):** never diagnosis words, never "get
help," never urgency. The register is dignity + generosity:

- "You don't need a diagnosis to deserve an hour of being heard."
- Hinglish: "Therapy ka matlab pagal hona nahi hai. Bas akele carry
  karte-karte thak jaana kaafi hai."
- "It's 1:40am again. Your therapist is awake." (the /care/sleep page)

**The generosity truth-fix:** the landing currently sells "first session free"
but the real model is better — 2 sessions/week, free, forever. Market the
truth: **"Start free — 2 sessions every week. Not a trial. Always."**

---

## 4. The first day (onboarding & first-run)

**Core insight:** a skeptical, possibly-ashamed visitor at 11pm doesn't need
convincing that therapy works — they need proof this thing can actually _hear_
them. The first day is engineered as two proofs of being heard, bracketing
everything else: (1) **the persona's voice in their ears before we ask for
anything**, and (2) **their own words quoted back in a bespoke, editable plan
within the hour**. Everything between those proofs is friction to cut. The one
friction never cut: the safety gate.

Expectation-setting is itself treatment (outcome expectancy predicts therapy
outcomes; role induction improves adherence — Constantino), so the "what
tonight looks like" screen is a clinical intervention wearing marketing
clothes.

### The minute-by-minute arc

| T      | Moment               | What happens                                                                                                                                                                                                                                                                                                       |
| ------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:00   | Landing              | Hero "Your own AI therapist. Tonight." + ▶ **Hear Meera — 15 seconds** on the existing CSS session preview (pre-recorded sample, labelled "AI voice · sample"). Truth-fixed free line. "🕐 Most people start after 10pm. That's fine — she's awake."                                                               |
| 0:45   | Login                | "No email. No real name yet. Just a number so your sessions stay yours." Phone/OTP autofill (`autocomplete="one-time-code"`), auto-submit on 6th digit. Precise promise: "No calls. No marketing. Only messages you switch on — and STOP always works."                                                            |
| 2:00   | Onboarding (4 steps) | (1) **Languages first** (primes the code-mix promise) → (2) **persona pick with ▶ voice samples in the chosen language** → (3) **the contract screen** (below) → (4) the honesty screen — UNCHANGED in substance: 18+, AI+data consent, baseline self-harm question, trusted contact collapsed behind "add later." |
| 4:00   | The prelude          | Before the single-use token is redeemed: mic-check ritual ("Say anything — 'testing, testing' works" → the orb blooms with THEIR voice), the will/won't/can't cards, SOS preview, headphones hint. **Token redeems only on "I'm ready"** — today a mic failure burns the token (verified defect).                  |
| 5:00   | The session          | The warm three-sentence open (already shipped in `CARE_THERAPIST_PROMPT_V2`), then a real 30-minute intake.                                                                                                                                                                                                        |
| ~35:00 | The between          | Mood-after dial. Improved: "6 → 8 tonight." **Not improved (new branch — today silence): "Still heavy. That's honest — the plan will meet you there."** One guided breath while waiting ("That was the whole exercise. They're all this small.")                                                                   |
| ~36:30 | THE REVEAL           | Staged, tap-paced (§5). Their own words quoted back. Editable goals. Dated terms.                                                                                                                                                                                                                                  |
| ~38:00 | Commit + baseline    | Plan-accept ceremony → **then** the 90-second PHQ-9 "starting line" (canonical placement: post-accept; one later home re-prompt ever; never inside the report-wait window — ethics ruling). Next-session day chips + WhatsApp reminder opt-in (in-app tap = the consent; a spoken yes never enables sends).        |
| ~40:00 | Home                 | Plan card + "Session 2 · with Meera" + time-honest greeting + the showing-up record at week 1 with its no-shame rules stated.                                                                                                                                                                                      |

**The contract screen** (step 3 — process promises only, zero outcome claims):

> **What tonight looks like**
> 🌙 Tonight — a real first session. About 30 minutes, voice, no forms.
> 📝 Right after — your written assessment & plan, in about a minute. You edit
> the goals before anything starts.
> 📅 Then — up to 2 sessions a week. Free.
> 📊 Every few weeks — progress measured with PHQ-9 and GAD-7, the same
> questionnaires clinicians use. Real change, or the honest opposite.
> _One thing that matters: the more honestly you talk, the better your plan.
> Meera goes at your pace — silence is fine._

**First-day metrics:** median time-to-voice (landing tap → first live persona
audio) target < 4 min; per-step onboarding completion; mic-grant rate;
voice-preview play rate and its lift on login-start (the key A/B).

---

## 5. The aha: assessment & plan

**Core insight:** being-understood must be made visible, then made
**falsifiable**. The reveal converts 30 minutes of vulnerable disclosure into
an artefact built from the user's OWN quoted words (the `evidenceQuote` field
exists for exactly this — anti-Barnum by schema). The baseline instrument then
turns the plan into a falsifiable promise: "same nine questions after six
sessions, and an honest answer." Horoscopes flatter; clinicians measure. The
willingness to be proven wrong is simultaneously the trust moat, the retention
engine (perceived improvement drives adherence — Brighten study), and the
graduation path.

### The staged reveal (4 beats, user-paced taps, no timers)

1. **The formulation alone**, large serif: "Meera wrote this for you." / "What's
   going on — in plain words."
2. **"In your own words"** — concern areas as verbatim pull-quotes ("You said —
   '{evidenceQuote}'"). The aha beat. Plus the **resonance check**: "Did this
   feel like it understood you?" (Yes, strongly / Mostly / Not really). A "Not
   really" pre-fills the next session's topic — Meera opens by asking what she
   missed (rupture-repair is itself alliance-building, and the answers are a
   prompt-quality dataset by language × persona).
3. **Editable goals** — theirs to rewrite (goal-edit rate is a co-authorship
   metric; target >30%).
4. **The dated terms**, derived from the real constant
   (`CARE_REVIEW_EVERY_N_SESSIONS = 6` — the current UI hardcodes "every 2
   weeks," which is false at free cadence; a verified trust bug): "How we'll
   work: CBT track · two sessions a week · after six sessions, the same nine
   questions — and an honest answer about whether it's working."

### The ceremony (acceptance ≠ a redirect)

Today accept POSTs and bounces to home — the peak-commitment moment evaporates.
Replace with a full-screen beat:

> **Plan v1 — yours, in writing.**
> Accepted 14 July · Starting point: PHQ-9 12
> Two sessions a week. After six, the same nine questions — and an honest
> answer. Review around 4 August — at your pace.
> _Written with Meera (an AI). Accepted by you._

(Ethics ruling: the AI is **credited, never a signatory** — "Signed: you +
Meera" reads as an unlicensed entity executing a clinical document.)

Quiet and typographic. No confetti. **Zero commerce on the reveal, ceremony,
baseline, and report screens — ever** (§9, invariant 4).

### The starting line (baseline PHQ-9/GAD-7)

Canonical placement: immediately post-accept, framed as a starting photo,
skippable with an honest cost line ("without it, your review can't show real
change"), one later home re-prompt ever. Item-9 > 0 routes to the existing
warm `CrisisTakeover` — **and the takeover says the assessment is saved and
waiting** ("Your plan will be here."). The report is never withheld.

### The verdict moment (session 6, and every 6 after)

Pre-review soft gate: "Before your review — the same nine questions from day
one. Meera can't show you real change without today's number." (soft: a
`needsCheckin` flag the UI honors; a user who insists still gets their
session).

Three honest branches on the review report:

- **Reliable improvement:** "PHQ-9: 12 → 6. That's past the bar clinicians use
  to call change reliable. We can't prove what caused it — but you were there
  for all of it." Near remission → name the finish line: "Finishing is the
  goal — this was never meant to be forever."
- **No reliable change:** "The scores haven't moved yet. That's information,
  not failure — and it means **we change something, not you**. Here's what
  changes: we switch to the Behavioural Activation track, and we check again
  after four sessions instead of six." (ROM literature: feedback's largest
  effects are for not-on-track clients.)
- **Deterioration:** review was likely pulled forward — say so, surface the
  human-therapist handover prominently, never gated, with **rails** (§9,
  timidity fix): a clinician-facing summary export (plan + verdicts +
  instrument series) and a vetted referral path, not a dead-end sentence.

Two verified code defects this section fixes (both live bugs): plan revisions
hardcode `modalityTrack='CBT'` + `cadence='weekly-25min'` (a SLEEP-track user's
plan v2 silently becomes CBT); and REVIEW `goalOutcomes` ACHIEVED is never
persisted, so the home strikethrough is dead code.

---

## 6. The habit engine (between sessions)

**Core insight:** the variable reward is **being remembered**. The daily
micro-loop feeds the persona's memory so tomorrow's continuity is visibly
richer; the external trigger (a WhatsApp line the user asked for aloud)
migrates to the internal trigger ("it's 10pm and my chest is tight → talk to
Meera"). Everything counts UP and nothing can be lost — for a shame-prone
clinical population, a breakable streak is evidence for the negative
self-schema; a cumulative record is evidence against it.

### The daily micro-loop (≤30 seconds)

MoodDial (≤10s) + one optional line against the last report's
`reflectionPrompt` — which Pass 10 already generates and the UI then drops on
the floor. Feasibility correction: **no migration needed** — `CareCheckin.note`
exists in schema, the contract accepts it, the route persists it; only the UI
field and the case-file fold-in are missing. The line feeds
`recentThemes` → the next session opens on it:

> "You wrote on Wednesday that rest still felt like slacking off. Want to
> start there?"

That sentence is the whole retention engine. Deterministically sourced from
real data — a fabricated "Meera remembers" line, noticed once, destroys the
alliance (personalization theater is the named anti-pattern).

### The showing-up record (streak v2 — ships from day 1)

The daily 🔥 streak is abolished, not softened (it's structurally breakable on
a 2/week free tier — every new user would experience "broken" within days).
Two layers, neither zeroable:

- **Weekly spine:** "weeks showing up" — a week counts with ≥1 session OR ≥4
  check-in days; a thin week auto-bridges as a "life happens" week (up to 2 in
  a row, granted automatically, never purchasable, never named as "used up").
- **Lifetime floor:** "14 sessions · 31 check-ins — all yours."

Display rules: visible from day 0 with its rules stated ("Miss a day? It just
pauses — no shame here"); returns after gaps are explicitly celebrated
("Coming back is the skill — the gap doesn't erase anything"); loss language
is banned by copy-lint; the entire surface freezes during SAFETY_HOLD ("You
matter more than a streak" is already product canon — this makes it true
mechanically).

### Homework as tiny habits

Homework fails on Ability, not Motivation (Fogg B=MAP), so the Pass-10 prompt
is changed to force the shape: **≤2-minute action, anchored as an if-then
implementation intention** ("After I put my phone on charge → one slow breath
cycle" — Gollwitzer meta-analysis d≈0.65). One-tap "Done today ✓" →
persona-voiced celebration ("that's 3 evenings this week. Small is the
point.") → ticks feed the case file → the next session opens on them ("You did
the breathing three nights. What did you notice?"). "Not done" is never
mentioned by any nudge; only the persona may explore it in-session.

### The WhatsApp utility channel (the wire everything runs on)

Reality check (verified): the WATI adapter is **template-message-only** — every
message type is a Meta-approved template with days-to-weeks approval lead time
and per-conversation fees, not free-form persona text. Pilot scope: **2–3
templates** (report-ready, session-day reminder, one re-engagement rung),
approvals filed on sprint day 1.

Channel policy (a pure, spec'd `care-nudge.ts`, like `care-gate.ts`):

- Consent finalizes ONLY via an explicit in-app tap with notice text +
  timestamp + per-category toggles (TRAI DCA). The persona may _raise_ the
  offer in-voice; a spoken yes never enables sends (consent inside the
  relationship-of-influence is theater — ethics ruling).
- **Discreet by default:** bodies never contain clinical vocabulary, scores,
  or the persona-sender framing ("You have 1 update waiting — open Care");
  persona voice ("Meera here…") is an explicit opt-in. Joint-family phones are
  the norm; the lock screen is a disclosure surface.
- ≤2 proactive messages/week total; quiet hours (user-chosen window, default
  9–10pm IST); STOP instant; suppression checked at send time and audited
  (`CARE_NUDGE_SENT` / `CARE_NUDGE_SUPPRESSED` — provable negatives).
- Zero pricing content, ever. Zero sends during SAFETY_HOLD, ever.

### The re-engagement ladder (day-3 / day-7 / day-30, then silence)

- **Day-3:** "No pressure — your Tuesday slot is open if today's a good day.
  If this week is heavy, a 10-second check-in also counts."
- **Day-7:** "A week is just a week. Your plan is exactly where you left it —
  nothing reset, nothing lost."
- **Day-30 (final):** "I won't keep messaging — this is the last one unless
  you reply. Whenever you come back, we pick up where we left off."
  Then silence forever unless the user returns. Return handling celebrates
  coming back and never mentions gap length.
- NEVER: "your streak is about to break," "we miss you 😢," discounts,
  anything during a hold.

**Dependency guardrail (the IGAP finding):** sessions/week among users with
WORSENING verdicts must not exceed the improving cohort. If the sickest users
are the heaviest users, the habit engine is feeding the wrong loop — reviews
escalate to humans harder, nudges never increase.

---

## 7. Monetization (closes open decision #3)

**Core insight:** the paywall is a **receipt for value already received**,
never a toll on access to care. Willingness-to-pay peaks at evidence-of-
getting-better moments; India's payment reality is UPI-shaped micro-commitment,
not Western annual subscriptions. Price against the ₹800–3,500 human-therapy
session — **always with the non-equivalence line attached** ("Care is an AI,
not a replacement for a therapist — that's part of why it costs less") — not
against ₹125/month content apps.

### The tier ladder

| Tier               | Price                                 | What it is                                                                                                                                                                   |
| ------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Free — forever** | ₹0                                    | The full clinical loop: intake, assessment & plan, **2 sessions/week**, every report, progress, crisis machinery, export. "More than most weekly therapy" — the honest line. |
| **Care Plus**      | **₹599/month** (single SKU at launch) | **Up to 4 sessions/week** + priority + (later trains: 35-min sessions, weekly digest). Sold as _flexibility for heavy weeks_, never as "daily therapy."                      |
| **Session Pack**   | ₹149 (CG5)                            | +2 sessions this week, UPI one-tap, expires in 7 days, nothing recurring. Max 1 pack/week.                                                                                   |
| **Alumni**         | ₹0 (computed tier, CG6)               | Post-graduation: one check-in session/month, mood tracking, reports forever.                                                                                                 |

**Why Plus is 4/week, not 7 (ethics blocker, accepted):** selling daily AI
therapy monetizes the dependency loop the product warns about — the heaviest
users are statistically the sickest, and daily 35-min AI therapy has no
evidence base. 4/week doubles the free cadence, protects the margin (a 7/week
power user at 35-min costs ~₹1,050–1,470/month against ₹599), and >4
sessions/week for 2 consecutive weeks auto-pulls a review + instrument instead
of more sessions. The cap default changes in `care-gate.ts` (env-overridable
stays); **cap reductions apply to new purchases only** — existing subscribers
get notice + pro-rata credit.

**Launch simplification (feasibility ruling):** ONE SKU — Plus monthly as a
prepaid 30-day Razorpay **order** (the Sprint-53 therapist pattern ported:
`notes.careUserId` branch in the webhook → `CareUser.planTier` write +
`CarePayment` row). No UPI Autopay mandates (different API surface, zero code
in repo), no weekly SKU, no annual at launch, no price A/B (no A/B infra
exists). Annual (₹3,999 framed as ₹333/month) and weekly follow once renewal
behavior is observed. Payment failure is non-punitive by copy and by code:
"Nothing changed, and your sessions are untouched."

### The three sanctioned moments (and only these)

1. **The graceful cap** — THE conversion surface. Today `WEEKLY_CAP` renders a
   dead-end string (verified: no CTA, no link — the single highest-intent
   moment in the product is wasted). Three stacked layers:
   - Validation + certainty: "You've done your 2 sessions this week — that's
     more than most weekly therapy. Your next session unlocks **Saturday**."
     (`nextUnlockAt` computed on the gate verdict; never an invented clinical
     norm — the drafted "full weekly cadence most therapy runs at" was a
     fabricated claim, cut by ethics.)
   - Something to DO now: homework card + check-in dial ABOVE any commerce.
   - Quiet commerce: Plus card + (CG5) the ₹149 pack.
2. **The plan-tier page** — the honest ladder, the safety-free guarantee
   printed ("Everything safety-related is free on every tier. Always."), the
   price anchor with the non-equivalence line.
3. **Post-improving-review** (CG5+, after suppression lib is proven): "Your
   scores moved past the reliable-change bar. If you want to keep this pace,
   Plus is there. If not, your 2 free sessions carry the plan just fine."
   Worsening/not-on-track verdicts get a pulled-forward review or the human
   handover — never an offer.

**Zero commerce anywhere in the first run** — reveal, ceremony, baseline,
report screens are permanently commerce-free (the strictest of the three
designs' rules, adopted portfolio-wide). The 7-day no-card trial (CG5) is
offered at the cap moment / plan-tier page, ends silently back to Free with
exactly one conversion prompt, no countdown mechanics.

### Unit economics (estimates until metering lands — hence metering is CG1)

Gemini native-audio Live, 25-min session: **~₹28–40 COGS/session** (≈38–48K
audio-in tokens @ $3/1M + ≈15–19K audio-out @ $12/1M + the Pass-10 report
call). Plus at ₹599 / 4-week cap ≈ 26–47% gross margin at realistic 2.5–3
sessions/week usage; the ₹149 pack ≈ ₹74.5/session against ₹28–40 = 34–53%
margin (healthiest in the ladder). Free-tier COGS ceiling: ≤₹300/user/month —
that's CAC, and it should be compared against paid-channel CAC, which will be
worse. **The server currently never sees usage** (browser↔Gemini direct):
relay `usageMetadata` at session end (the doctor vertical's
`LiveConsultMetric` is the copy-paste template), store tokens + ₹ per session,
and price from a week of real data before the SKU launches.

### Graduation as a pricing feature (CG6)

Consecutive improving reviews + goals achieved → the product initiates the
downgrade itself: "This is the outcome we work for — we've stopped your Plus
billing." Pro-rata credit on anything prepaid. Alumni mode is free. Win-back
fires only on the user's own visible signal (a worsening mood series THEY
logged), one door-open utility message, no discount, no guilt. Pause (up to 3
months, plan/history kept) is always offered before cancel.

**The extraction tripwire (standing kill-trigger):** %-improving-at-review
among paying users must be ≥ the free-user rate. If payers improve less than
free users, the pricing system is monetizing dependency — the improvement-
moment offers get killed.

---

## 8. Growth loops & marketing hooks

**Core insight:** in India the growth blocker is a double stigma — admitting
you need therapy is socially expensive, and "AI therapist" triggers
cheap-chatbot skepticism. So the loop cannot run on confession ("I'm in
therapy"); it runs on **proof** and **generosity**. Care is the only product
in the market whose artefacts prove themselves.

### The loops, in build order

1. **Landing truth + proof (CG1 copy, CG5 bands).** "Shows its work"
   positioning; a "See a real assessment" band (fictional, labelled sample
   report with quoted words); Hinglish in the hero, not just the chips.
2. **`/care/check` (CG5)** — the built-but-orphaned PHQ-9 as anonymous
   top-of-funnel. "The same 2-minute check-in clinicians use. No sign-up.
   Nothing stored." Targets the highest-intent SEO cluster ("am I depressed or
   lazy", "depression test in hindi"). The probe stigma allows: **checking is
   not admitting.** Item-9 > 0 or severe band → crisis resources inline,
   unauthenticated, never gated behind signup. The score rides into intake
   only with explicit consent at the CTA ("We'll carry tonight's answers into
   your first session — OK?" — the drafted silent sessionStorage handoff was a
   DPDP violation, cut by ethics).
3. **`/care/safety` (CG5)** — honesty-as-hook: publish how SAFETY_HOLD
   **behaves** (SOS, holds, 12h resume, hotlines, the named clinical advisor
   and review cadence) — never the keyword lexicon or thresholds (evasion
   risk). This page is also the press kit.
4. **Programmatic landing pages (CG5)** — `/care/hindi`, `/care/malayalam`,
   `/care/sleep`, `/care/exam-stress`, `/care/cant-afford-therapy` — the
   intent × language matrix nobody else can serve (Amaha's most-requested
   unmet feature is regional language). Human-reviewed copy only; the
   no-machine-translation rule extends to marketing pages making
   clinical-adjacent claims.
5. **Share cards (CG6)** — pride-shaped, clinical-content-free **by
   construction**: server-built snapshots from whitelisted numeric/milestone
   facts; the client can never inject text. Kinds: MILESTONE ("3 weeks of
   showing up for myself 🌱"), MOOD_DELTA ("Tonight: 3 → 7"), VERDICT (score
   delta + "measured the way clinicians measure it" + the mandatory "one
   person's numbers, not a promise" line — causal/"validated" language cut by
   ethics), QUOTE (two-step opt-in, server-copied headline, riskScreen-gated),
   GRADUATION ("Some apps fight to keep you. This one celebrated me
   leaving."). Every card mints a revocable `/care/s/[token]` mini landing
   page (next/og self-rendered — the /care CSP forbids external images).
   **Share cards are never referral-incentivized** — an incentivized outcome
   card is the company's own outcome claim under FTC/ASCI rules.
6. **Gift-a-session referral (CG6)** — generosity, not evangelism: the gift
   implies the sender is thoughtful, not ill. Friend's first week = 3
   sessions; referrer earns +1 credit **when the friend completes intake** (a
   30-min voice session behind OTP — expensive to fake), capped +2/week.
   Surfaced post-good-session and at the cap moment ("Kindness pays both
   ways"), never during/within 7 days of a hold.
7. **Creator kit + `/care/demo` (CG5/6)** — a scripted 45-second demo page
   (canned captions on the real session aesthetics — never the live LLM;
   labelled "scripted preview"), plus a creator brief: the AI disclosure IS
   the hook ("keep it in frame"), no cure claims, no fake testimonials, **no
   on-camera crisis or handover reenactment** (creators will dramatize the
   handover because it's the best hook — banned by brief). Hooks that work:
   "POV: it's 2:47am and the one thought won't stop" / "Maine bola main bas
   lazy hoon. Usne poocha — kab se?"
8. **Campus (CG6+, colleges/18+ ONLY)** — the drafted JEE/NEET coaching wedge
   is **cancelled** (ethics blocker: predominantly-minor audiences + DPDP §9 +
   "AI therapist recruits NEET kids" headline risk). College counselling
   cells + UPSC/semester-exam timing survive, with DOB attestation on `?ref`
   landings.
9. **The transparency report (CG6+)** — quarterly `/care/transparency`
   rendered from existing audit rows (verdict distribution, holds, escalations,
   suppression counts). The audit spine + deterministic engines can produce
   what no competitor can: published numbers. "We publish our numbers" joins
   the launch narrative.

**Launch narrative (PR):** "India's first measured AI therapist — it shows its
work, and when you're better, it tells you to leave." Pitch against the IGAP
2026 finding (chatbot safety deteriorates as distress intensifies): "we built
the structural opposite — distress pauses the AI."

---

## 9. The ethics charter (12 invariants, each enforced in code)

These are load-bearing product mechanics, not compliance prose. Each maps to
an enforcement point; several are CI-assertable.

1. **Crisis is never gated, never monetized, never interrupted.** SOS, holds,
   hotlines free on every tier and every surface, including anonymous
   `/care/check` strangers.
2. **One suppression predicate for everything commercial/social.** A pure
   `care-suppression.ts` (spec'd like `care-gate.ts`): SAFETY_HOLD ∪ crisis
   event ≤7d ∪ latest riskScreen ≠ LOW ∪ worsening verdict ∪ declining mood
   series → suppress commerce, shares, gifts, and trials **identically**. The
   drafted per-surface predicates had drift gaps (a MODERATE-risk cap-hit user
   would still have seen ₹149). CI asserts all surfaces call it.
3. **The AI is always disclosed** — in the hero, in every persona voice sample
   label, in the ceremony attestation ("Written with Meera (an AI). Accepted
   by you."), in creator briefs. "AI therapist," never "therapist."
4. **Zero commerce at emotional peaks.** Reveal, ceremony, baseline, and all
   report screens are permanently commerce-free. The cap moment on home is
   the sanctioned surface.
5. **Nothing can be lost.** No breakable streaks, no expiring progress, no
   loss language (copy-lint enforced: banned list includes loss framing, 🔥
   iconography, "streak broke," and — in message bodies — clinical vocabulary).
6. **Outbound is utility-only, discreet by default, consented by tap.** ≤2
   proactive/week, quiet hours, STOP instant, suppression audited at send
   time (`CARE_NUDGE_SUPPRESSED` rows prove the negative). Nudges sent during
   SAFETY_HOLD must equal exactly 0.
7. **No invented clinical norms, no outcome claims, no causal claims.**
   "Reliable change" vocabulary is reserved for the deterministic engine;
   verdict copy adds "we can't prove what caused it." Marketing claims stay
   artefact-shaped ("shows its work"), never outcome-shaped ("cures anxiety").
8. **Every promise string maps to a shipped mechanism or is cut.** The
   currently-unkept ones (export "in Settings", "2 weeks" review cadence,
   plan-tier's three phantom perks, "we never call it") are fixed in CG1–CG3.
9. **Shares leak nothing by construction.** Server-built snapshots; QUOTE
   opt-in with verbatim preview; revocable tokens; cascade on delete; no
   share/gift affordance under suppression (invariant 2). Never
   referral-incentivized.
10. **Graduation is success.** Tracked as a win in every dashboard, billing
    stopped proactively, zero re-engagement post-graduation, and any softening
    of the human-handover recommendation is forbidden (never A/B-tested toward
    retention). Thresholds and recommendation branches require clinician
    sign-off to change (same rule as `change-score.ts`).
11. **Human clinical oversight exists and is published.** A named clinical
    advisor; monthly review of sampled anonymized reports + 100% of hold
    transcripts; cadence published on `/care/safety`. (The critique's
    "too-timid" finding: this is the cheapest trust asset available and nobody
    in-category has it.)
12. **The regret test governs new loops.** Every mechanic must survive "would
    the user endorse this if they understood exactly how it works?" — the
    check-in makes their next session better, the nudge was asked for, the
    record only counts up, day-30 silence is a promise we keep.

---

## 10. Metrics

**North star (never engagement):** reliable-change rate at first REVIEW among
users with a Day-1 baseline. (npj 2025 meta-analysis: persuasive design drives
engagement, engagement doesn't reliably drive outcomes. Also: this metric is
structurally zero today — no UI administers the baseline.)

**Activation:** within 72h of first OTP verify — completed intake (≥15 min or
`end_session`) + viewed report + accepted plan v1. **Measured Start** =
Activated + baseline instrument recorded (the definition every downstream
promise depends on).

**Retention:** W1 = session 2 within 7 days of plan-accept (target ≥25% of
activated). W4 = ≥1 completed session in days 22–28 (category median 30-day
retention is **3.3%** — Baumel 2019, 93 MH apps; target ≥10x among activated).

**Leading indicator:** 3-item WAI-SR-short alliance pulse at session 3
(alliance forms in days 3–5 and predicts retention before any verdict exists;
low bond → offer the persona switch Settings already promises).

**Funnel:** landing→login start; voice-preview play rate (+ lift); OTP
completion; per-step onboarding; mic grant; intake completion; report viewed;
resonance distribution (by language × persona — >15% "Not really" in any slice
is a prompt regression to fix); plan accept; goal-edit rate (>30%); baseline
take rate; time-to-voice < 4 min.

**Monetization:** cap-hit rate among free WAU (expect 25–40% — it's the demand
signal); cap-hit→Plus (3–5%); free→paid by day 30 (target 4–6% vs 2.2%
freemium median); pack:subscription mix (packs dominating 3:1 = cadence
pricing is wrong); COGS/session median + P95 vs the ₹28–40 model; Plus gross
margin ≥35%.

**Growth:** /care/check completions + check→signup (≥15%); share-page
visit→signup CTR (≥8%); gift→signup→intake conversion; realized K (target
≥0.25 by month 3 — CAC subsidy, not fantasy virality); referred-cohort verdict
rates vs organic (growth must not degrade the north star).

**Guardrails (hard, alerting, never optimized down):** commerce/share/gift
impressions under suppression = **0**; nudges during SAFETY_HOLD = **0**;
anonymous check item-9 crisis-resource display = **100%**; safety-gate "yes"
rate at onboarding must not fall after redesigns (falling = we're discouraging
honesty); worsening-cohort sessions/week ≤ improving cohort (dependency
watch); payers' improvement rate ≥ free users' (extraction tripwire);
report-generation p95 < 90s (the "about a minute" promise); per-rung opt-out
<2%.

Instrumentation rides the existing audit spine (one `CARE_FUNNEL_EVENT` action
with a step metadata field — not one enum value per step; the chaos-test cost
of granular enum-per-event is not worth it pre-pilot). No third-party pixels
on authed surfaces (DPDP posture).

---

## 11. What the code says today (grounded, verified)

**Solidly built:** the clinical loop core — gate (`care-gate.ts`, pure,
display+enforcement unified), kind cadence (INTAKE → TREATMENT → REVIEW every
**6th** session — several docs say 4th; code says 6), case-file continuity +
6 protocol steps × 4 tracks, plan versioning, warm kind-branched reports,
mood check-ins, IST streak, and the full safety machinery (keyword screen,
flag_crisis, item-9 tripwire, SAFETY_HOLD + 12h resume gate, SOS).

**The three critical breaks (all verified):**

1. **Monetization is a dead end.** `CareUser.planTier` has NO write path
   anywhere; all Razorpay routes authenticate psychologists only; the
   plan-tier page says "Pricing is being finalised"; the WEEKLY_CAP block — the
   highest-intent moment — is a dead-end string with no CTA. The plan-tier
   card promises three perks that don't exist (longer sessions, digest, "all
   voices" — all four voices are already free).
2. **The measurement loop has no front door.** `POST /api/v1/care/instruments`
   (scoring, item-9 tripwire, audit) is complete with **zero UI callers**:
   baselines never exist, every REVIEW prompt gets "no instrument data yet,"
   the worsening pull-forward can never fire, progress verdict cards never
   render. The headline promise is structurally dead. One form component
   activates the entire built subsystem — the highest leverage-per-effort work
   in the portfolio.
3. **Zero outbound re-engagement.** `packages/notifications` has no Care
   references; the only Care cron is the session sweeper — which is itself
   **not scheduled in `vercel.json`** (abandoned sessions are never swept in
   prod; dropped-tab reports vanish).

**Smaller verified defects:** the home aside renders only ONE card
(`planCard || homeworkCard || lastReportCard` — homework + last-report
permanently hidden once a plan exists); goal ACHIEVED never persists
(strikethrough is dead code); plan revisions reset track to CBT (live bug);
"progress check every 2 weeks" is false (constant says 6 sessions); greeting
hardcodes "Good evening 🌙" at 9am; mic failure burns the single-use start
token; consent copy promises export that doesn't exist; Settings promises
persona switching with no control; `reflectionPrompt` is generated then
dropped; reports have no share/export; `CareCheckin.note` exists but has no UI.

---

## 12. The sprint plan (CG1–CG6 — each shippable alone)

Ordering per the feasibility critique: truth debt and the measurement loop
first (they gate the north-star metric and every marketing claim), billing
before growth loops, WhatsApp before re-engagement, virality last (K-factor on
pilot WAU is noise).

### CG1 — Close the measurement loop + pay the truth debt

_The north-star metric becomes computable; every currently-false promise
becomes true. Zero new product surface area._

- [ ] `CareInstrumentForm.tsx` (items from `@cureocity/clinical` registry) —
      mounted post-plan-accept ("your starting line"), as a one-time home
      re-prompt, and as the pre-REVIEW soft gate (`needsCheckin` flag on the
      sessions route). Item-9 → existing CrisisTakeover, **with "your
      assessment is saved and will be here" copy**.
- [ ] Fix the CBT-reset bug: plan revisions carry the current plan's
      track/cadence (from the case file via the session GET payload).
- [ ] Persist goal ACHIEVED from REVIEW `goalOutcomes` at review plan-accept
      (goals JSON already carries status — no migration).
- [ ] Home aside bug (render all three cards) + time-aware IST greeting.
- [ ] Derive the review-interval copy from `CARE_REVIEW_EVERY_N_SESSIONS`
      (kill "every 2 weeks").
- [ ] Landing truth-fix: "Your own AI therapist. Tonight." + "2 sessions
      every week. Not a trial. Always."
- [ ] Data export: JSON export route (sessions, reports, plan versions,
      check-ins, instruments) + Settings button — the consent copy already
      promises it (DPDP portability is non-optional).
- [ ] COGS metering: relay `usageMetadata` from `CareLiveSession`, 3 columns
      on CareSession, rollup query (template: `LiveConsultMetric`).
- [ ] Schedule the session sweeper in `vercel.json` (it exists, it's unwired).

### CG2 — The first day

- [ ] The contract screen ("What tonight looks like") + onboarding reorder
      (languages → persona) + trusted-contact collapse.
- [ ] `CareSessionPrelude.tsx`: mic-check ritual, will/won't/can't cards, SOS
      preview — **token redeems only on "I'm ready"** (compute RMS over
      `onFrame` PCM for the orb bloom; no metering exists in
      `use-live-stream.ts` to reuse).
- [ ] The staged reveal (4 beats) + resonance check (+ `topic` pre-fill repair
      path) + the accept ceremony ("Written with Meera (an AI). Accepted by
      you.") — zero commerce.
- [ ] Not-improved mood branch ("Still heavy. That's honest…") + waiting-room
      breath.
- [ ] OTP autofill/auto-submit + precise phone promise.
- [ ] Free persona switching in Settings (the promise already exists; alliance
      is never paywalled) + session-3 alliance pulse.
- [ ] Trusted-contact prompt after session 2 ("If things ever get heavy, who
      should Meera mention?").

### CG3 — The billing spine + the graceful cap

- [ ] `care-suppression.ts` — the ONE pure suppression predicate, spec'd; all
      commerce/share/gift/trial surfaces call it (CI-asserted).
- [ ] Care checkout: ONE SKU (Plus monthly ₹599, prepaid 30-day order),
      `notes.careUserId` webhook branch → `planTier` write + `CarePayment`
      model + renewal-reminder cron reuse. Non-punitive failure copy. Audits:
      `CARE_CHECKOUT_CREATED` / `CARE_PLAN_UPGRADED` / `CARE_PAYMENT_FAILED`.
- [ ] Plus cap default → 4/week in `care-gate.ts` (env override stays;
      reductions grandfather existing buyers). >4/wk × 2wks auto-pulls a
      review.
- [ ] The graceful cap: `nextUnlockAt` on the gate verdict; validation →
      homework/check-in → quiet commerce; suppression-aware.
- [ ] Plan-tier v2: honest card (only enforced perks), safety-free guarantee,
      price anchor + non-equivalence line.

### CG4 — The WhatsApp channel + the habit engine

- [ ] Meta template approvals filed day 1 (report-ready, session-day, one
      ladder rung). Discreet-mode default bodies; persona voice opt-in.
- [ ] `care-nudge.ts` policy lib (caps, quiet hours, suppression, dedupe) +
      `CareNudge` table + consent columns + cron (**with its `vercel.json`
      entry** + deploy-checklist line).
- [ ] Consent UX: in-session raise (prompt addition) + in-app tap finalize
      (report view + Settings toggles). Audits: `CARE_NUDGE_*`,
      `CARE_REMINDER_OPTIN`.
- [ ] Check-in note UI (**no migration** — `CareCheckin.note` exists) +
      case-file fold-in (last 3 notes → `recentThemes`) + `/care/checkin`
      deep-link surface.
- [ ] Streak v2: `computeCareWeeks` alongside the existing pure function;
      showing-up record UI; 🔥 retired; SAFETY_HOLD freeze.
- [ ] Homework ticks: `CareHomeworkTick` + prompt shape change (≤2-min if-then
      anchor) + card tick UI + case-file "done N days" line.
- [ ] Re-engagement ladder (day-3/7/30) + return celebration + "same time next
      week?" picker.

### CG5 — Funnel + top-of-funnel

- [ ] ₹149 session pack (`CareSessionCredit`, gate `availableCredits` input,
      1/week ceiling with the honest "more sessions isn't the answer" copy).
- [ ] 7-day no-card Plus trial (computed tier, one-shot, silent end) — offered
      at the cap/plan-tier, never in first run.
- [ ] `/care/check` anonymous PHQ-9 (client-side scoring; nothing stored;
      inline unauthenticated crisis branch; explicit-consent score handoff).
- [ ] `/care/safety` (behaviors not lexicon; named clinical advisor + review
      cadence; grievance contact + consent-withdrawal links).
- [ ] Voice previews en + hi (6 assets, "AI voice · sample" labels; ml/ta/bn
      gated on native-speaker listening QA).
- [ ] Programmatic landing template + first 3 pages (human-reviewed copy).

### CG6 — Advocacy + graduation

- [ ] `CareShareCard` (MILESTONE / MOOD_DELTA / VERDICT / QUOTE / GRADUATION;
      server-built snapshots; `/care/s/[token]` + next/og; revocation;
      suppression-gated; never incentivized).
- [ ] Gift-a-session referral (`CareReferral`, credit on friend's completed
      intake, +2/week cap, cap-moment + post-good-session surfaces).
- [ ] Graduation: trigger on consecutive improving reviews (clinician-signed
      threshold), proactive billing stop + pro-rata, alumni computed tier,
      door-open win-back, graduation card.
- [ ] Human-handover rails: clinician-facing summary export + vetted referral
      directory.
- [ ] `/care/transparency` v1 from audit rows.
- [ ] Creator kit + `/care/demo` (scripted, labelled); campus program
      (colleges/18+ only, DOB attestation on `?ref`).

---

## 13. Copy bank (canonical strings — clinician sign-off before real users)

**Hero:** "Your own AI therapist. Tonight." / "Not a chatbot that agrees with
you — an AI therapist that shows its work." / CTA: "Start free — 2 sessions
every week. Not a trial. Always."

**Login:** "No email. No real name yet. Just a number so your sessions stay
yours." / "No calls. No marketing. Only messages you switch on — and STOP
always works."

**Persona samples:** Meera: "Hi, I'm Meera. There's no form and no hurry here.
We just talk — in whatever mix of languages feels natural to you. Start
anywhere." · Dev: "I'm Dev. I'll be straight with you, and warm about it." ·
Asha: "I'm Asha. Whatever brought you here tonight — it's a good enough
reason."

**Prelude:** "She will — listen, ask one thing at a time, remember what you
tell her." / "She won't — judge you, rush you, or pretend to be human." /
"She can't — handle an emergency. That ⚠ button is always at the bottom: a
person, right now."

**Reveal/ceremony:** "Meera wrote this for you." / "In your own words" /
"This is my plan ✓" / "Plan v1 — yours, in writing. Written with Meera (an
AI). Accepted by you — 14 July."

**Starting line:** "Nine questions, about 90 seconds. The same form clinicians
use. Your check-in around 4 August measures against tonight — so you'll know
if this is really working, not just feeling different." / "Sealed until your
review — no grades, no judgment."

**Cap:** "You've done your 2 sessions this week — more than most weekly
therapy. Your next session unlocks Saturday." / "Until then: your homework is
below, and the daily check-in keeps your progress moving."

**Verdict:** "PHQ-9: 12 → 6. That's past the bar clinicians use to call change
reliable. We can't prove what caused it — but you were there for all of it." /
"The scores haven't moved yet. That's information, not failure — we change
something, not you." / "The numbers moved the wrong way, so we brought this
review forward. This is where an AI should hand over."

**Record:** "Showing up · Week 3 · 5 sessions, 12 check-ins — all yours." /
"Coming back is the skill — the gap doesn't erase anything."

**Ladder day-30:** "I won't keep messaging — this is the last one unless you
reply. Whenever you come back, we pick up where we left off: your plan, your
words, your progress."

**Graduation:** "This is the outcome we work for: you don't need us weekly
anymore. We've stopped your Plus billing ourselves — and one check-in session
a month stays free, always."

**Hinglish bank:** "Therapy ka matlab pagal hona nahi hai. Bas akele carry
karte-karte thak jaana kaafi hai." / "Raat 2 baje overthinking? Sunno ye kaisa
lagta hai — apni language mein therapy. Free, aaj raat." / "Maine bola main
bas lazy hoon. Usne poocha — kab se?" / "3 hafte, khud ke liye time nikala 🌱"

---

## 14. What the adversarial pass changed (the record)

**Ethics blockers (all accepted):** hero regains the "AI" qualifier; Plus
capped at 4/week (selling daily AI therapy monetizes dependency); VERDICT
share cards lose causal/"validated" language + all cards decoupled from
referral credits (incentivized outcome cards = company outcome claims under
FTC/ASCI); JEE/NEET campus wedge cancelled (DPDP §9 minors risk).

**Ethics majors (all accepted):** one canonical baseline placement
(post-accept — the two designs contradicted each other); "Signed: you + Meera"
→ credited-not-signatory; the invented "full weekly cadence" norm → the honest
generosity line; price anchor always carries non-equivalence; WhatsApp discreet
mode by default + tap-finalized consent; "we never call it" → the precise
promise; ONE suppression predicate for all surfaces; streak v2 from day 1 (the
two designs contradicted); export ships before "yours forever" marketing;
`/care/check` handoff needs explicit consent; `/care/safety` publishes
behaviors not lexicon.

**Ethics "too timid" (adopted):** named clinical advisor + published review
cadence; human-handover rails (summary export + referral path); trusted-contact
prompt after session 2; transparency report; alliance pulse + persona switch
promoted into CG2.

**Feasibility corrections (all adopted):** WATI is template-only → 2–3
approved templates at pilot, filed day 1; ONE SKU, no UPI Autopay, no A/B at
launch; metering moves ahead of pricing (CG1); `CareCheckin.note` already
exists → no migration; the sweeper cron is unscheduled → fix in CG1; sell only
enforced Plus perks; single owner per duplicated fix; referral/shares demoted
to CG6; trial placement contradiction resolved to strictest rule (no first-run
commerce); reviews fire every **6th** session, not 4th; no level metering
exists in `use-live-stream.ts` to reuse (compute RMS in the prelude); funnel
events as one audit action with metadata, not enum-per-step.

---

_Related docs: [`AI_COUNSELING.md`](AI_COUNSELING.md) (build spec),
[`AI_COUNSELING_SPRINTS.md`](AI_COUNSELING_SPRINTS.md) (AC0–AC7),
[`runbooks/care.md`](runbooks/care.md) (ops). Open decisions #1 and #3 from
the spec's §14 are closed by §3 and §7 of this document._
