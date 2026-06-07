# Measurement-Based Care — Sprint 20 model

This document explains the **Sprint 20 measurement-based-care loop**:
what it is, why it exists, the clinical evidence behind it, and how the
pieces connect in code. For the Sprint-by-Sprint product narrative,
read `docs/CLINICAL_COPILOT.md`. For agent conventions + reuse map,
read `CLAUDE.md`.

## 1. The problem this fixes

Through Sprint 19 the product was excellent at producing per-session
artefacts — SOAP note, intake note, clinical brief, initial-assessment
brief, reflection questions, therapy script — but every artefact was
an island. There was no arc, no measured verdict on whether therapy
was _actually working_, and nothing meaningful to give the client at
the end.

> "I'm totally disappointed because there is no user experience where
> they can fully make the counseling and give the clients a result.
> After the initial assessment this said like, assessment gaps and
> all… but there should be a researched thing for this scientifically,
> how therapists can benefit from this with huge user experience and
> how this will be a better product."
>
> — User, June 2026

Sprint 20 closed that loop.

## 2. The evidence base

Three converging streams from the psychotherapy literature drove the
design:

1. **Measurement-Based Care (MBC)** — routinely measuring symptoms and
   feeding the trend back to the clinician beats treatment-as-usual,
   nearly _doubles_ reliable-improvement rates in poor-prognosis
   clients, and cuts dropout ~20%. (Meta-analyses of 24+ routine-
   outcome-monitoring studies; 51 RCTs.)

2. **Feedback-Informed Treatment (FIT)** — the active ingredient is a
   simple on-track (green) / not-on-track (red) signal. Catching
   not-on-track cases early is where a co-pilot adds the most value.

3. **Stepped care + episode-of-care lifecycle** — care is an arc
   (assess → formulate → treat → re-measure → terminate with an
   outcome), not a flat pile of sessions. The arc needs a durable
   terminal state to be measurable.

Two practical constraints from the implementation literature:

- **PHQ-9 and GAD-7 thresholds are deterministic and bakeable** —
  reliable change ≈ 5 points (PHQ-9) / 4 points (GAD-7); remission
  ≤ 4; response = ≥50% reduction from baseline. No AI needed to
  compute the verdict.
- **Clinical decision support gets abandoned when it nags** — alert
  fatigue + workflow friction are the top adoption killers. Passive,
  dismissible, in-workflow suggestions that respect clinician
  autonomy get used.

The India-specific anchor — the Healthy Activity Program (Lancet RCT,
Goa) — showed lay counsellors delivering manualised PHQ-9-tracked
therapy with **plain-language, visual patient materials and family
involvement** get strong outcomes. That's the user our Progress
Report copy is written for.

## 3. The loop, end to end

```
                ┌──────────────────────────────────────────────────┐
                │  INTAKE                                          │
                │  Pass 2 IntakeNoteV1; Pass 3 InitialAssessment   │
                │  Recommended instruments → one-tap administer    │
                └─────────────────────────┬────────────────────────┘
                                          ▼
                ┌──────────────────────────────────────────────────┐
                │  BASELINE                                        │
                │  Therapist administers PHQ-9 + GAD-7 once        │
                │  (Journey hub Next-Best-Action: "Set a baseline")│
                └─────────────────────────┬────────────────────────┘
                                          ▼
                ┌──────────────────────────────────────────────────┐
                │  ACTIVE TREATMENT                                │
                │  Confirmed diagnosis + plan; sessions run.       │
                │  Goals get toggled on the journey hub as the     │
                │  client makes progress.                          │
                └─────────────────────────┬────────────────────────┘
                                          ▼
                ┌──────────────────────────────────────────────────┐
                │  RE-MEASURE                                      │
                │  Therapist re-administers PHQ-9 / GAD-7.         │
                │  Journey hub flips to a verdict:                 │
                │   • Reliable improvement (green)                 │
                │   • No reliable change (muted)                   │
                │   • Deterioration (red)                          │
                │  Plus response (≥50%) + remission (≤ cutoff) tags│
                └─────────────────────────┬────────────────────────┘
                                          ▼
                ┌──────────────────────────────────────────────────┐
                │  IF NOT-ON-TRACK                                 │
                │  Journey Next-Best-Action: "Not improving —      │
                │  consider a plan review" after 3+ flat reads.    │
                │  Therapist iterates the plan.                    │
                └─────────────────────────┬────────────────────────┘
                                          ▼
                ┌──────────────────────────────────────────────────┐
                │  REMISSION REACHED                               │
                │  Journey Next-Best-Action: "Consider discharge". │
                │  Therapist clicks Discharge → DischargeModal     │
                │  captures reason + optional outcome note.        │
                └─────────────────────────┬────────────────────────┘
                                          ▼
                ┌──────────────────────────────────────────────────┐
                │  CLIENT RESULT                                   │
                │  Therapist clicks "Share final outcome report" → │
                │  client gets a private /p/<token> link with a    │
                │  plain-language pre→post they walk away with.    │
                └──────────────────────────────────────────────────┘
```

If a discharged client returns later, recording a new session opens a
**fresh episode** — the prior discharged episode stays on the record.

## 4. Code map

| Concern                                                      | Where                                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| **Reliable-change engine** (deterministic verdicts)          | `packages/clinical/src/instruments/change-score.ts`                   |
| **Thresholds** (PHQ-9 = 5 pts; GAD-7 = 4 pts; remission ≤ 4) | same file, constants `RELIABLE_CHANGE_THRESHOLD` + `REMISSION_CUTOFF` |
| **Journey composer** (stage, verdicts, next-best-action)     | `apps/web/lib/journey.ts`                                             |
| **Journey route** (returns `JourneySummary`)                 | `apps/web/app/api/v1/clients/[id]/journey/route.ts`                   |
| **Journey hub UI** (band at top of client page)              | `apps/web/components/app/JourneyHeader.tsx`                           |
| **Progress Report builder** (deterministic copy)             | `apps/web/lib/progress-report.ts`                                     |
| **Progress Report contract** (`PROGRESS_REPORT` artefact)    | `packages/contracts/src/share.ts`                                     |
| **Progress Report portal render**                            | `apps/web/app/p/[token]/page.tsx` `PROGRESS_REPORT` branch            |
| **Treatment episode model**                                  | `prisma/schema.prisma` (`TreatmentEpisode`)                           |
| **Episode opens at session create**                          | `apps/web/app/api/v1/sessions/route.ts`                               |
| **Discharge route**                                          | `apps/web/app/api/v1/clients/[id]/discharge/route.ts`                 |
| **Discharge UI**                                             | `apps/web/components/app/DischargeModal.tsx`                          |
| **Per-goal status side table**                               | `prisma/schema.prisma` (`TreatmentGoalProgress`)                      |
| **Per-goal status route**                                    | `apps/web/app/api/v1/treatment-plans/[id]/goals/[index]/route.ts`     |
| **Per-goal status UI** (cycle dot on journey hub)            | `apps/web/components/app/JourneyHeader.tsx` `GoalRow`                 |
| **My Practice view** (therapist self-reflection)             | `apps/web/app/app/me/page.tsx`                                        |

## 5. Design constraints

These are intentional invariants — break them only with clinician
sign-off and a citation.

- **Thresholds are deterministic, not AI-judged.** The verdict comes
  from `change-score.ts` constants. The Progress Report copy comes
  from a templated builder, not Gemini. AI is allowed for the SOAP /
  intake / brief generation; the _measurement_ must be deterministic.
- **Next-Best-Action is passive.** It's a single dismissible card,
  not a modal, not an interruption. If you want to add a second
  suggestion, add a different surface — don't stack two NBA cards.
- **Discharge is reversible.** Recording a new session reopens care
  as a fresh episode. UI copy frames discharge as "close this
  episode", not "end the relationship".
- **Client-facing copy adapts to the verdict, never blames the client.**
  Worsening branch is soft + plan-forward + includes India crisis
  hotlines (iCall 9152987821, NIMHANS 080-46110007).
- **The Journey hub never shows a discharged comparison against peers.**
  My Practice view explicitly avoids comparison framing — adoption
  research says competency dashboards that compare get abandoned.

## 6. What's missing today

Tracked in `CLAUDE.md` § 11 — short list:

- **Multilingual Progress Report copy** — schema is locale-aware; copy
  is English-only and needs validated translations.
- **More scored instruments** (WHODAS-2, PCL-5, …) — registry supports
  it; validated item wording required.
- **Episode aggregation across returns** — the My Practice view counts
  episodes closed but doesn't yet show a "retention" curve. Easy to
  add when there's enough data to be meaningful.

## 7. Verifying the loop on a real client

End-to-end walkthrough for a fresh client (after the Sprint 20
migrations run):

1. Create the client + record an intake session.
2. Open the Initial Assessment tab → tap the "+ Administer PHQ-9" chip
   → score it (e.g. 18) → repeat for GAD-7.
3. Run 2-3 treatment sessions; re-administer PHQ-9 (e.g. 7).
4. Open the client page → the Journey hub band should now show a
   **green "Reliable improvement"** verdict on PHQ-9 + the trend
   `18 → 7`.
5. Click **"Share progress report"** → choose Portal → open the
   `/p/<token>` link → confirm the headline ("Your depression score
   has come down by 61% since we started"), the per-instrument
   narrative, the goals list, and the three encouragement lines.
6. Click **Discharge** → fill the reason → confirm the Journey hub
   flips to a terminal banner + the "Share final outcome report"
   button appears.
7. Record a new session for the same client → the discharged banner
   should disappear and a fresh episode opens.

If any of those steps doesn't behave as described, that's a bug —
file it.
