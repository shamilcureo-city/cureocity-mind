# Feature research — what solo Indian psychotherapists want from a SaaS like this

> **Scope:** India-first · solo private-practice psychotherapists/counselling
> psychologists · goal = prioritized "what to build next" roadmap, gap-analysed
> against what Cureocity Mind already ships.
> **Method:** 5 parallel web-research passes (practice-management table stakes,
> AI-scribe competitor landscape, India market + compliance, client engagement +
> outcomes, monetization + adoption drivers), with per-claim reliability flags.
> **Date:** 2026-06-22

---

## The one-paragraph takeaway

Cureocity's AI scribe + instrument-based measurement-based care already sit
**ahead** of most competitors on the two hardest problems in this category —
clinical-note trust (the confirm/modify/reject + evidence-linked diagnoses
neutralize the hallucination backlash now triggering class-action lawsuits in the
US) and _real_ progress measurement (the reliable-change engine beats the
"transcript-inferred progress" rivals sell). The research is unanimous on where
the gaps are: **the rest of the admin stack** (booking, reminders, intake/consent,
India-native billing) and **an active between-session client loop**. Raw "saves
you time on notes" is no longer a differentiator — a large 2026 multi-center study
found ambient scribes save only ~16 min per 8 hours of care — so the next build
should convert clinical data into _retained clients and collected payments_, not
more notes.

---

## Priority table

| #   | Feature                                          | Tier           | Already have?                             | Why it matters (evidence)                                             | Build effort               |
| --- | ------------------------------------------------ | -------------- | ----------------------------------------- | --------------------------------------------------------------------- | -------------------------- |
| 1   | WhatsApp appointment reminders                   | **P0**         | ❌ Gap                                    | No-shows 20–30%+ in MH therapy; reminders cut them ~20–36%            | Low–Med                    |
| 2   | Scheduling + online self-booking                 | **P0**         | ❌ Gap                                    | #1 admin-time saver after notes; table stakes vs every rival          | Med                        |
| 3   | Intake forms + e-consent + consent-to-record     | **P0**         | ❌ Gap                                    | DPDP verifiable consent + lawful recording dependency; trust feature  | Med                        |
| 4   | GST/UPI invoicing + claim-ready receipts         | **P0**         | ⚠️ Partial (Razorpay billing ≠ invoicing) | Disqualifier gap vs Practipal/LifeHetu; near-zero build (data exists) | Low                        |
| 5   | DPDP operational compliance (breach/DSR/erasure) | **P0**         | ⚠️ Partial                                | 72-hr breach report, access/correction/erasure are legal obligations  | Low–Med                    |
| 6   | "Not-on-track" alerting on existing MBC          | **P1**         | ⚠️ Extends MBC                            | Feedback halves deterioration, doubles recovery in failing cases      | Low                        |
| 7   | Between-session client loop (check-ins/homework) | **P1**         | ⚠️ Partial (artefacts, not a loop)        | Homework r≈0.22–0.26, d≈0.48; where Blueprint/Eleos differentiate     | Med–High                   |
| 8   | Telehealth — start with video-link, not native   | **P1**         | ❌ Gap                                    | Table stakes vs SimplePractice/Jane; but commoditized                 | Low (link) / High (native) |
| 9   | Therapist-owned profile/microsite + referrals    | **P1**         | ❌ Gap                                    | Deepest client-acquisition pain; but eroding moat                     | Med                        |
| 10  | Relapse-prevention / aftercare on discharge      | **P1**         | ⚠️ Extends discharge                      | RR≈0.76 over 24 mo; cheap "smart-messaging" maintenance               | Low                        |
| 11  | Couples/family/group multi-participant sessions  | **P1/P2**      | ❌ Gap                                    | Highest-fee (₹2,000–5,750), fastest-growing service line              | Med                        |
| 12  | Automated note compliance/audit scoring          | **P2**         | ❌ Gap                                    | Eleos "golden-thread" play — but US-insurance-shaped, weak for India  | Med                        |
| 13  | Psychoeducation / worksheet library              | **P2**         | ⚠️ Partial                                | Valued time-saver/stickiness; **no** measured outcome evidence        | Low–Med                    |
| 14  | Supervision / peer-consultation                  | **P2**         | ❌ Gap                                    | Real monthly need, but a marketplace feature not a co-pilot one       | Med                        |
| 15  | CPD/CE tracking                                  | **P2 (defer)** | ❌ Gap                                    | No binding recert clock in India → low urgency                        | Low                        |
| —   | Direct corporate-EAP integration                 | **Defer**      | ❌ Gap                                    | Platform-intermediated; hard to disintermediate                       | High                       |

---

## P0 — Must-build (table stakes + compliance + highest, most quantifiable ROI)

### 1. WhatsApp appointment reminders → no-show reduction

- **Why solo Indian therapists want it:** A no-show is a directly lost
  ₹800–₹2,500. Mental-health therapy runs **20–30%+** no-show rates (25–40% for
  first appointments), well above the ~18% all-specialty average. Automated
  reminders cut no-shows **~20–36%** (a 26-study systematic review found reminded
  patients 23% more likely to attend).
- **Gap status:** Genuine gap. You have WhatsApp _sharing_ but not scheduled,
  template-based reminders.
- **Build/impact:** Low–medium. The single most quantifiable ROI story ("pays for
  itself in one recovered session/month") and it _extends the existing WhatsApp
  channel_. ⚠️ Must use approved **WhatsApp Business API Utility templates,
  opt-in capture, and respect the 24-hr session window** — don't free-text.

### 2. Scheduling + online self-booking

- **Why:** After documentation (already solved), scheduling is the #1 admin-time
  sink. 68% of providers say admin detracts from care; self-booking is marketed by
  SimplePractice as saving "hours/week"; baseline across SimplePractice, Jane,
  TheraNest, and India-native LifeHetu/Practipal.
- **Gap status:** Genuine gap.
- **Build/impact:** Medium. Pairs with #1 (booking → confirmation → reminder is one
  flow). Table stakes you currently fail on vs _every_ competitor.

### 3. Intake forms + e-consent + explicit consent-to-record

- **Why:** Not just convenience in India — a **legal dependency.** DPDP makes you a
  "data fiduciary" needing free, specific, informed, verifiable consent (and
  parental consent for minors). Consent-to-record specifically _gates the core
  scribe legally_. AI-scribe recording without consent is driving US class-actions
  (Sutter, MemorialCare, Sharp) and clients reporting feeling "violated" — so an
  explicit consent UX is becoming a **trust differentiator** that plays to the
  DPDP-residency story.
- **Gap status:** Genuine gap.
- **Build/impact:** Medium. Sequence _early, alongside booking_ — it's the
  lawful-recording prerequisite, not a nice-to-have.

### 4. GST-compliant invoicing + UPI collection + claim-ready receipts

- **Why:** India is overwhelmingly **cash-pay**. Local competitors (Practipal,
  LifeHetu) already market GST invoices + UPI (GPay/PhonePe/Paytm) links — their
  absence is a **direct disqualifier**. The ~40% with OPD coverage / EAP need an
  ICD-coded, itemized, reimbursement-ready receipt. You **already capture the
  ICD-11 diagnosis, fee, and session data** → near-zero marginal build.
- **Nuance:** GST only bites above ₹20 lakh/yr turnover; most solo therapists are
  below it → make GST **optional, toggle-on**. Note the genuine ambiguity that
  psychologists may fall _outside_ the healthcare GST exemption (18% can apply).
- **Gap status:** Partial — you have Razorpay _subscription_ billing (you charging
  the therapist), not therapist→client invoicing.
- **Build/impact:** Low effort, high adoption impact. Strong candidate for _first_
  build.

### 5. DPDP operational compliance plumbing

- **Why:** DPDP Rules 2025 impose hard obligations beyond encryption (Rule 6
  already validates the design): **72-hour breach reporting** to the Data
  Protection Board, data-principal **access/correction/erasure** rights, a
  grievance-redressal contact, and **erasure-on-inactivity**. Penalties reach
  ₹250 crore.
- **Gap status:** Partial — residency + encryption done; the DSR/breach/erasure
  _workflows_ are the gap.
- **Build/impact:** Low–medium, mostly internal — table stakes for clinic/enterprise
  trust and legally non-optional.
- **Credential nuance (cheap, important):** Capture each therapist's **credential
  type + RCI/registration number** and auto-stamp it on receipts/WhatsApp
  (telemedicine norm). **Don't over-claim "telemedicine-compliant"** — the 2020
  Telemedicine Guidelines apply only to _doctors (RMPs)_, not counsellors (relevant
  to the doctor vertical, not solo psychotherapists).

---

## P1 — High-value differentiators

### 6. "Not-on-track" alerting on the MBC you already have

- **Why:** Highest-leverage, lowest-build move. Progress-feedback's biggest payoff
  is in _failing_ cases: deterioration drops ~21%→13% and clinically significant
  recovery rises ~20%→35% when therapists get alerted; clinical-support tools lift
  the effect to g≈0.36–0.53. You already compute reliable-change verdicts on
  PHQ-9/GAD-7 — surface a proactive "this client is deteriorating, here's the
  suggested action."
- **Gap status:** Extends existing MBC. Build/impact: Low effort, high
  differentiation.

### 7. Active between-session client engagement loop

- **Why:** The clearest thing competitors do that you don't. Blueprint/Eleos push
  assessments, worksheets, journals, and daily check-ins to a client app, then
  **auto-summarize for the therapist before the next session**. Homework adherence
  correlates with outcomes (r≈0.22–0.26; d≈0.48 advantage, biggest for depression)
  _and_ reduces dropout (~20% of clients drop out). You have one-way artefacts
  (progress reports, homework) but **not a recurring client-input loop**.
- **Critical caveat:** App engagement is the bottleneck (median completion ~37.6%);
  it only works with **reminders + clinician-prescribed framing** — which maps to
  India's "clinician-endorsement is decisive for app adoption" finding and to the
  WhatsApp channel. Build a _WhatsApp-delivered_ check-in loop feeding the
  pre-session brief before a native client app.
- **Gap status:** Partial gap. Build/impact: Medium–high; the single biggest
  clinical differentiator available.

### 8. Telehealth — video-link first, native later

- **Why:** Table stakes vs SimplePractice/Jane/TheraNest, but the most commoditized,
  infrastructure-heavy item; 2026 reliability complaints against Heidi (lost
  recordings) show how video/recording reliability becomes a churn driver.
- **Build/impact:** Ship a **video-link/WhatsApp-video integration** (low) before a
  native stack (high). Defer native video behind 1–5.

### 9. Therapist-owned profile/microsite + India-native directory + referral tracking

- **Why:** Client acquisition is the **deepest** pain (Psychology Today referrals
  collapsing — one profile 357 contacts in 2021 → 40 in 2025; India has no dominant
  clinician-owned directory; TherapyRoute's "no commissions, no algorithm"
  positioning signals unmet demand). Therapists are squeezed by EAP platforms paying
  ₹500–700/session while charging clients 2–3×, motivating independent direct
  practice.
- **Caveat:** The **weakest moat** (cheap to clone, eroding surface). Valuable for
  adoption, but don't over-invest.
- **Gap status:** Genuine gap. Build/impact: Medium.

### 10. Relapse-prevention / aftercare extension of the discharge flow

- **Why:** Structured relapse prevention cuts relapse ~24% over 24 months
  (RR≈0.76); cheap personalized post-therapy "smart-messaging" improves 12-month
  maintenance. You already have an explicit discharge flow — a small extension that
  demonstrably protects outcomes.
- **Gap status:** Extends existing discharge. Build/impact: Low.

### 11. Couples/family/group multi-participant sessions

- **Why:** Highest-fee (₹2,000–5,750 vs ₹800–2,500 individual), fastest-growing
  segment (APAC online couples-therapy ~9.5% CAGR, India a named driver). A
  revenue-expansion lever for the therapist.
- **Gap status:** Genuine gap. Build/impact: Medium (touches session model, notes,
  billing).

---

## P2 — Nice-to-have / deprioritize

- **12. Automated note compliance/audit scoring** (Eleos golden-thread style) —
  clever, but US-insurance-shaped; weak ROI for India cash-pay solo. Revisit if you
  push the clinic/EAP segment.
- **13. Psychoeducation/worksheet library** (à la Therapist Aid) — a valued
  _stickiness_ play with strong market precedent but **no measured outcome
  evidence** — treat as retention, not an efficacy claim.
- **14. Supervision / peer-consultation** — real monthly professional need and an
  income lever, but a _marketplace/matching_ feature, not a co-pilot one. Secondary.
- **15. CPD/CE tracking — defer.** Unlike US licensure, India has no binding
  recertification clock for solo therapists; low urgency.
- **Direct corporate-EAP integration — defer.** The ₹2.6B→₹4B EAP market is real but
  **platform-intermediated** (1to1help, YourDOST); you won't disintermediate them. A
  lighter wedge is _helping solo therapists manage EAP-referred clients_, not
  integrating with the EAPs.

---

## Two strategic (non-feature) notes worth as much as the features

1. **Pricing:** The India competitive ceiling is **~₹1,499/mo** (≈ one session) with
   a free <5-client tier. The #1 churn driver across the category is **price hikes +
   forced up-tier bundling** (SimplePractice's repeated increases). Keep tiers
   **modular and unbundled**; never force solo users onto multi-therapist plans to
   reach core features. The AI scribe + MBC justify a _premium above_ the generalist
   ceiling — but frame ROI as "one retained client/month pays for it."

2. **Go-to-market:** Borrow **Eleos's playbook of publishing outcome (not
   time-saved) evidence.** Raw time savings are now modest and undifferentiated; you
   uniquely have a _reliable-change engine_ — instrument it to produce aggregate
   "clients on X improved by Y" evidence. A moat competitors with transcript-inferred
   progress can't credibly match.

---

## Recommended build order

- **First wave (P0, one cohesive flow):** GST/UPI invoicing (#4, cheapest win) →
  WhatsApp reminders (#1) → booking (#2) → intake/e-consent (#3) → DSR/breach
  plumbing (#5).
- **Second wave (P1, differentiation):** not-on-track alerts (#6) → WhatsApp
  between-session loop (#7) → aftercare (#10) → video-link (#8).

---

## Sources (by research angle)

**Practice-management table stakes**

- No-show rates / reminder impact: <https://curogram.com/blog/average-patient-no-show-rate>, <https://curogram.com/blog/mental-health/mental-health-appointment-no-shows>
- Reminder RCT / pragmatic trial evidence: <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10356735/>, <https://clinicaltrials.gov/study/NCT03850431>, <https://www.ajmc.com/view/feb09-3915p105-112>
- No-show cost: <https://www.prospyrmed.com/blog/post/no-show-rates-impact-revenue>, <https://www.getorva.com/blog/the-true-cost-of-patient-no-shows>
- Online booking / portal as admin saver: <https://www.simplepractice.com/features/online-booking/>, <https://www.simplepractice.com/features/client-portal/>
- Feature-parity comparisons: <https://www.choosingtherapy.com/theranest-vs-simplepractice/>, <https://softwarefinder.com/resources/simplepractice-vs-theranest>
- Admin burden / burnout: <https://www.simplepractice.com/blog/therapist-burnout-report/>, <https://www.businesswire.com/news/home/20230929995058/en/>, <https://pimsyehr.com/administrative-friction-and-clinician-burnout/>
- India online-therapy + WhatsApp channel: <https://www.mhfaindia.com/blog/indias-mental-health-landscape-insights>, <https://docvita.com/therapists>, <https://www.towardshealthcare.com/insights/online-therapy-services-market-sizing>
- India telehealth consent: <https://www.coveryou.in/blog/legal-issues-telehealth-practice-india-2026/>, <https://www.nmc.org.in/MCIRest/open/getDocument>, <https://www.ricago.com/blog/legal-guidelines-for-digital-health-and-telemedicine-under-the-dpdpa>

**AI-scribe competitor landscape**

- Upheal Golden Thread / pricing: <https://www.upheal.io/features/golden-thread>, <https://www.upheal.io/pricing>
- Mentalyc progress tracker / comparison: <https://www.mentalyc.com/ai-progress-tracker>, <https://www.upheal.io/comparisons/upheal-vs-mentalyc>
- Blueprint engagement + decision support: <https://www.blueprint.ai/platform/assistant>, <https://www.blueprint.ai/pricing>, <https://ebchelp.blueprint.ai/en/articles/5662181>
- Eleos compliance + outcomes: <https://eleos.health/documentation/>, <https://eleos.health/blog-posts/launch-note-compliance-ai-behavioral-health/>, <https://eleos.health/press-releases/ai-therapy-improves-patient-outcomes/>
- Twofold billing: <https://www.trytwofold.com/solutions/ai-scribe-with-billing-support>, <https://www.trytwofold.com/specialties/behavioral-health>
- Heidi review + reliability: <https://www.veroscribe.com/blog/heidi-health-review-2026>, <https://www.commure.com/blog-scribe/heidi-health-review>
- Freed / JotPsych: <https://www.getfreed.ai/resources/best-note-taking-software-therapists>, <https://www.deepcura.com/resources/freed-ai-review>, <https://jotpsych.com/features>
- India AI-scribe gap: <https://rxnote.ai/en/blog/best-ai-medical-scribe-for-psychiatrists-in-2026-in-india>, <https://pmhscribe.com/ai-scribe-for-therapists/>
- Time-saved reality / adoption: <https://www.statnews.com/2026/04/01/ai-ambient-scribes-modest-time-savings-clinical-documentation/>, <https://www.commure.com/blog-scribe/ai-therapy-notes>
- Hallucination / consent backlash: <https://clearhealthcosts.com/blog/2025/03/therapy-notes-by-ai-create-false-narratives-therapists-say/>, <https://www.medscape.com/viewarticle/patients-sue-two-more-health-systems-over-ai-scribe-use-lack-2026a1000bwq>, <https://www.npr.org/2026/05/26/nx-s1-5826943/>, <https://www.aicerts.ai/news/therapy-note-privacy-faces-patient-backlash-over-ai-scribes/>

**India market + compliance**

- DPDP Act / Rules 2025: <https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf>, <https://www.cy5.io/blog/dpdp-rules-2025-complete-compliance-guide-cloud-security/>, <https://www.ey.com/en_in/insights/cybersecurity/decoding-the-digital-personal-data-protection-act-2023>, <https://www.dpdpa.com/dpdparules/rule6.html>, <https://amlegals.com/reasonable-security-safeguards-under-dpdpa/>
- Telemedicine / telepsychiatry: <https://www.psalegal.com/telemedicine-guidelines-2020-faq/>, <https://corporate.cyrilamarchandblogs.com/2020/04/dial-a-doctor-a-look-at-the-telemedicine-practice-guidelines-2020/>, <https://www.lexology.com/library/detail.aspx?g=a1d76ffa-1853-4c7a-84e8-f8ef37d44525>, <https://nimhans.co.in/wp-content/uploads/2021/09/Telepsychiatry-Operational-Guidelines-2020.pdf>, <https://pmc.ncbi.nlm.nih.gov/articles/PMC8554922/>
- Licensing / titles / records: <https://www.therapyroute.com/article/mental-health-licensing-regulation-in-india-2025-guide-by-therapyroute>, <https://www.mhfaindia.com/mental-health-india-who-can-help-qualified-become-one>
- GST / payments: <https://www.taxtmi.com/forum/issue?id=118213>, <https://taxguru.in/goods-and-service-tax/health-care-services-gst.html>, <https://amlegals.com/taxability-of-supply-of-wellness-or-therapy-services-under-gst/>, <https://cleartax.in/s/gst-registration-limits-increased>, <https://razorpay.com/learn/gst-registration-limits/>
- Session fees: <https://www.therapyroute.com/article/how-much-does-therapy-cost-in-india-2025-by-therapyroute>, <https://careme.health/blog/how-much-does-therapy-costs-in-india-in-2024-a-comprehensive-guide>
- Insurance / EAP: <https://www.business-standard.com/finance/personal-finance/mental-health-insurance-in-india-costs-coverage-and-key-providers-124101000251_1.html>, <https://www.policywings.com/blog/mental-health-insurance-coverage-in-india-whats-covered-how-to-claim-your-rights-under-irdai-IFx0sZKEDQ7iQh6KgAaJ>
- WhatsApp norms / Business API: <https://hyperleap.ai/blog/whatsapp-clinics-hospitals-india-patient-communication>, <https://www.messagecentral.com/blog/whatsapp-business-api-india-guide>, <https://whatsappbusiness.com/policy/>

**Client engagement + outcomes**

- Dropout: <https://clinica.ispa.pt/sites/default/files/16._dropout_meta_analysis.pdf>, <https://www.researchgate.net/publication/232606718_A_Meta-Analysis_of_Psychotherapy_Dropout>, <https://pmc.ncbi.nlm.nih.gov/articles/PMC4679463/>
- MBC adoption + efficacy: <https://psychiatryonline.org/doi/10.1176/appi.ps.202100735>, <https://psychiatryonline.org/doi/10.1176/appi.ajp.2015.14050652>
- Feedback / not-on-track alerting: <https://www.sciencedirect.com/science/article/pii/S0272735821000453>, <https://pmc.ncbi.nlm.nih.gov/articles/PMC11076375/>
- Homework: <https://link.springer.com/article/10.1007/s10608-010-9297-z>, <https://www.researchgate.net/publication/229646088_Meta-Analysis_of_Homework_Effects_in_Cognitive_and_Behavioral_Therapy_A_Replication_and_Extension>
- Self-monitoring / messaging: <https://www.frontiersin.org/journals/psychiatry/articles/10.3389/fpsyt.2021.687270/full>, <https://www.sciencedirect.com/science/article/abs/pii/S0165032717316786>, <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11361596/>
- Content libraries: <https://www.therapistaid.com/>, <https://www.psychologytools.com/downloads/cbt-worksheets-and-therapy-resources>
- Relapse prevention / aftercare: <https://pmc.ncbi.nlm.nih.gov/articles/PMC10539522/>, <https://pmc.ncbi.nlm.nih.gov/articles/PMC7216897/>
- India app adoption: <https://www.sciencedirect.com/science/article/abs/pii/S1876201824003083>, <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12514412/>, <https://thesouthfirst.com/health/therapy-in-your-pocket-promise-and-questions-behind-indias-mental-health-apps/>

**Monetization + adoption drivers**

- Supply / market: <https://www.business-standard.com/health/197-million-indians-need-mental-health-support-here-s-what-s-missing-125101000277_1.html>, <https://www.datamintelligence.com/research-report/india-mental-health-market>
- Directories / acquisition: <https://www.choosingtherapy.com/psychology-today-review/>, <https://clearhealthcosts.com/blog/2025/12/therapists-say-psychology-today-referrals-have-dried-up-and-express-concern/>, <https://www.practo.com/delhi/psychologist>, <https://practipal.in/a-simple-marketing-system-for-indian-therapists-without-daily-instagram-posting/>, <https://www.therapyroute.com/therapists/india>
- Billing / GST / UPI: <https://practipal.in/practipal-the-complete-practice-management-software-for-therapists-in-india-2026-guide/>, <https://www.thrizer.com/blog/understanding-superbills-for-therapy>
- Pricing / willingness-to-pay / churn: <https://practipal.in/pricing/>, <https://www.manoshala.com/post/what-is-the-price-of-a-therapy-session-in-india-2025-city-wise-comparison>, <https://crowncounseling.com/reviews/simplepractice/>, <https://www.mbpractice.com/blog/cloud-based-therapy-practice-management-software-pricing>
- EAP / B2B2C: <https://www.imarcgroup.com/india-corporate-wellness-market>, <https://www.1to1help.com/whitepapers-guides/state-of-emotional-wellbeing-in-corporate-india-2024>, <https://thepolisproject.com/read/therapists-mental-health-india/>
- Supervision / CPD / couples: <https://careerplanb.co/how-to-become-a-therapist-in-india/>, <https://www.thebusinessresearchcompany.com/report/online-therapy-services-global-market-report>, <https://www.therapyroute.com/article/academic-credentials-for-mental-health-professionals-in-india-by-therapyroute>

> **Reliability note:** clinical effect sizes above are peer-reviewed (Swift &
> Greenberg dropout meta-analysis; Guo et al. MBC RCT; Kazantzis et al. homework
> meta-analyses; de Jong / Lambert feedback work). DPDP / GST / telemedicine claims
> trace to primary statutes and law-firm analysis. No-show percentages, pricing, and
> market-size figures are vendor/industry sources — treat as directional ranges.
