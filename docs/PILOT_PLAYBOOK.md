# Pilot Playbook — first 5 therapists, 4 weeks

Status: written July 2026 (AUD3). Owner: founder. This is the
operational one-pager for the first therapist pilot — who's in it, what
"working" means, what to measure, and the weekly ritual. Keep it short
enough to actually run.

## 1. Shape of the pilot

- **Cohort**: 5 therapists (solo practitioners or from the partner
  clinic), each with an active caseload of at least 5 clients.
- **Duration**: 4 weeks of real sessions. Week 0 is setup + one supervised
  dry-run session per therapist.
- **Devices**: their own phone or laptop — no hardware handed out. The
  product must survive their real room, their real accent mix, their
  real network.
- **Support channel**: one WhatsApp group (founder + all pilots). Every
  bug report or confusion gets a reply the same day; the group doubles
  as the qualitative-feedback record.

## 2. What success means (decide BEFORE week 1)

The pilot answers one question: **does a signed, honest clinical record
now take less effort than not keeping one?** Concretely, at week 4:

| #   | Criterion                                                          | Target                      |
| --- | ------------------------------------------------------------------ | --------------------------- |
| 1   | Therapists still active in week 4 (recorded ≥1 session that week)  | ≥ 4 of 5                    |
| 2   | Signed notes per active therapist per week (week 3–4 average)      | ≥ 3                         |
| 3   | Time from session end → signed note (median)                       | ≤ 10 minutes                |
| 4   | Clients with a baseline instrument (PHQ-9/GAD-7) after 2+ sessions | ≥ 60%                       |
| 5   | Of those, clients re-measured within the instrument's cadence      | ≥ 50%                       |
| 6   | Live-copilot suggestions acted on (of shown), for live-mode users  | ≥ 20% (and dismissed < 60%) |
| 7   | A therapist says, unprompted, that they'd pay                      | ≥ 1                         |

Criteria 1–3 are the scribe working; 4–5 are measurement-based care
actually happening; 6 is the copilot earning its screen space; 7 is the
business signal. If 1–3 hit but 4–6 miss, the pilot still "passes" — the
scribe is the wedge, the rest is coaching.

## 3. Metric definitions (so nobody argues later)

All computable from existing tables — no new instrumentation needed.

- **Active therapist (week N)**: ≥1 `Session` with `status=COMPLETED` in
  that ISO week (IST).
- **Signed notes/week**: count of `ENCOUNTER_NOTE_SIGNED` +
  `NOTE_SIGNED`-family audit rows per therapist per week.
- **Time-to-first-signed-note**: `TherapyNote.signedAt − Session.endedAt`,
  median per therapist per week. (Sessions signed next-day count
  honestly — that IS the finding.)
- **Baseline coverage**: of clients with ≥2 completed sessions, the share
  with ≥1 `InstrumentResponse`.
- **Re-measure coverage**: of clients with a baseline ≥2 weeks old, the
  share with a later `InstrumentResponse` (the Journey card's "measure
  due" logic is the source of truth).
- **Copilot action rate**: `LIVE_SUGGESTION_ACTED / LIVE_SUGGESTION_SHOWN`
  audit rows; dismissal rate analogous. (Doctor vertical already has
  `/app/insights` for this rollup; therapist rows land in the same audit
  stream.)
- **Live vs record-only share**: `Session.captureMode` distribution per
  therapist per week — tells us whether live scribing survives contact
  with real rooms or everyone retreats to batch recording.

Recruiting the cohort: message templates + objection cheat-sheet +
tracker in **`docs/pilot/outreach.md`**.

## 4. Week 0 — setup checklist (per therapist)

The full 45-minute run-of-show (with exit checklist) is
**`docs/pilot/week0-runbook.md`** — the list below is the summary.

1. Account provisioned; onboarding completed (vertical = THERAPIST).
2. Passkey registered (Settings → sign hardening) — before
   `REQUIRE_WEBAUTHN_SIGNING` is flipped on.
3. `spokenLanguages` set correctly on their first 3 clients (code-mix
   reality: ml+en, hi+en — this drives Pass 1 quality).
4. One supervised dry-run: record a role-played 10-minute session end to
   end — record → note → sign → share to their OWN WhatsApp. They must
   see the whole loop once before a real client.
5. Consent script walked through: they can explain recording + AI
   processing + the client's rights in one breath.
6. Their default capture mode chosen (live vs record-only) — set
   expectations that live needs decent network.

## 5. The weekly ritual (30 minutes, founder-run)

Every Friday:

1. **Pull the numbers** (§ 3) for the week — run
   `scripts/pilot-scorecard.sql` in the Neon SQL editor (read-only; one
   labelled section per metric, edit `week_start` at the top of each).
2. **Rank the friction**: top 3 complaints/confusions from the WhatsApp
   group, each tagged fix-now / fix-next / won't-fix.
3. **One coaching nudge per therapist**, chosen from their own data —
   e.g. "you have 4 clients past measure-due" or "your notes sign
   next-day; try signing in-room before the client leaves".
4. **Post a one-paragraph week summary** to the group: what shipped,
   what's coming, one win from the cohort (social proof inside the
   pilot).
5. Update the running scorecard against § 2 targets.

## 6. Kill / continue / scale (end of week 4)

- **Scale** (≥5 of 7 criteria hit): raise to 15–20 therapists, turn on
  billing (trial cap already enforced at session-create), flip
  `REQUIRE_WEBAUTHN_SIGNING=true`.
- **Continue** (3–4 hit, and week-over-week trend is up): run 4 more
  weeks with the same cohort; fix the top friction items first.
- **Kill the assumption, not the product** (≤2 hit): the failing
  criterion names the broken assumption — e.g. if time-to-sign misses,
  the note quality or the review UX is the problem, not the market. Do
  the post-mortem per criterion, not vibes.

## 7. Ops guardrails during the pilot

- Cost circuit: per-session (₹500) and monthly (₹15,000) caps are
  enforced in code; watch `GeminiCallLog` weekly for outliers.
- The audio retention cron must be verified live in week 0 (one
  `AUDIO_RETENTION_PURGED` audit row proves it).
- Any clinical-safety incident (missed crisis flag, wrong-client share)
  is a stop-the-line event: pause the affected flow, write the incident
  down, fix before the next session — not at the Friday ritual.
- Data-loss complaints ("my recording vanished") get same-day forensics
  via the audit log before memory fades.
