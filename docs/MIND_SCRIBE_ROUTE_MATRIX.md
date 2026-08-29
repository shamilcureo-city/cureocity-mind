# Cureocity Mind / Cureocity Scribe route matrix

**Status:** Sprint 0 product-boundary contract.

Cureocity Mind and Cureocity Scribe are separate practitioner products on one platform. They share infrastructure and selected implementation helpers, but their user journeys are owned independently.

- **Mind:** `mind.cureocity.in`, `PractitionerVertical = THERAPIST`
- **Scribe:** `scribe.cureocity.in`, `PractitionerVertical = DOCTOR`
- **Care:** `care.cureocity.in`, separate D2C identity; outside this matrix

`apps/web/lib/product.ts` is the source of truth for host-to-product mapping. Authenticated application behavior must use the stored practitioner vertical. Do not infer a practitioner journey from the host alone.

## Route ownership

| Journey stage | Cureocity Mind (`THERAPIST`) | Cureocity Scribe (`DOCTOR`) | Ownership |
|---|---|---|---|
| Public landing | `/` on `mind.cureocity.in` | `/` on `scribe.cureocity.in`, internally served by `/for-doctors` | Product-specific |
| Authentication | `/login`, branded from host | `/login`, branded from host | Shared shell, product-specific copy |
| Onboarding | `/onboarding`, presets `THERAPIST` | `/onboarding`, presets `DOCTOR` | Shared shell, vertical-specific fields/copy |
| Current authenticated entry | `/app` currently serves the recording/client-picker surface; `/app/today` serves Today | `/app/clinic` | Product-specific |
| Sprint 2 canonical home target | `/app` becomes canonical Today; `/app/today` remains a compatibility alias during migration | `/app/clinic` remains unchanged | Mind-only planned change |
| Primary roster | `/app/clients` | `/app/patients` | Product-specific |
| Person detail | `/app/clients/[id]` | `/app/patients/[id]` | Product-specific |
| New work | Mind session start/preflight from Today, client, or capture entry | Start encounter from Clinic/patient flow | Product-specific |
| Legacy/new-capture route | `/app/encounters/new` aliases the Mind capture entry until canonical navigation migration completes | Doctor capture modes remain under doctor encounter flow | Product-specific semantics; route name is not product vocabulary |
| Live work | `/app/sessions/[id]/live` | `/app/patients/[id]/encounters/[sessionId]/live` | Product-specific |
| Review and completion | Mind session workspace today; planned Mind-only Review & Close | Existing doctor Review & Sign | Product-specific; never replace one with the other |
| Longitudinal care | Mind client Journey, outcomes, treatment plan, homework | Doctor chronic-care/medical history surfaces | Product-specific presentation; selected engines may be shared |
| Operational overview | Mind Today and Analytics | Clinic queue and Insights | Product-specific |
| Patient/client portal | `/p/[token]` and related shared artefact routes, with artefact-specific presentation | Doctor after-visit/Rx shares may use shared delivery infrastructure | Shared infrastructure, product-specific artefacts |
| Settings/billing/help | `/app/settings`, `/app/learn`, shared shell | Same routes, vertical-aware content where required | Shared-neutral only when semantics match |

## Complete authenticated page inventory

This table classifies every current `apps/web/app/app/**/page.tsx` route. “Shared-neutral” means the task has the same meaning for both practitioner verticals; vertical-specific content inside it must still branch explicitly.

| Route | Owner | Notes |
|---|---|---|
| `/app` | Mind-only | Current recording/client-picker entry; redirects doctors to Clinic |
| `/app/clients` | Mind-only | Therapist client roster |
| `/app/clients/[id]` | Mind-only | Therapist longitudinal client record |
| `/app/clinic` | Scribe-only | Doctor OPD queue |
| `/app/dashboard` | Mind-only | Therapist analytics/attention surface |
| `/app/data-rights/erasure-queue` | Shared-neutral | Practitioner data-rights operations |
| `/app/encounters/new` | Mind-only | Compatibility alias for the Mind capture entry; visible copy says session |
| `/app/insights` | Scribe-only | Doctor end-of-clinic evidence view |
| `/app/learn` | Shared-neutral | Shared education shell; content may be vertical-aware |
| `/app/learn/[topic]` | Shared-neutral | Shared topic reader |
| `/app/learn/words` | Shared-neutral | Shared glossary |
| `/app/marketing` | Mind-only | Therapist public profile and appointment inbox |
| `/app/me` | Mind-only | Therapist practice outcomes |
| `/app/notes-due` | Mind-only | Therapy notes awaiting completion |
| `/app/patients` | Scribe-only | Doctor patient roster |
| `/app/patients/[id]` | Scribe-only | Doctor patient record |
| `/app/patients/[id]/encounters/[sessionId]` | Scribe-only | Doctor dictate/upload encounter and Review & Sign |
| `/app/patients/[id]/encounters/[sessionId]/live` | Scribe-only | Doctor live consult |
| `/app/practice-assistant` | Mind-only | Therapist practice assistant |
| `/app/search` | Mind-only | Therapy-note search |
| `/app/sessions/[id]` | Mind-only | Therapy session workspace |
| `/app/sessions/[id]/live` | Mind-only | Therapist live session |
| `/app/settings` | Shared-neutral | Redirects to shared account settings |
| `/app/settings/account` | Shared-neutral | Practitioner account identity |
| `/app/settings/clinic` | Shared-neutral | Practice/clinic membership administration |
| `/app/settings/plan` | Shared-neutral | Practitioner billing and entitlement |
| `/app/settings/preferences` | Shared-neutral | Shared preferences with doctor-only letterhead branch |
| `/app/settings/security` | Shared-neutral | Practitioner account security |
| `/app/templates` | Mind-only | Therapy-note templates |
| `/app/today` | Mind-only | Therapist daily agenda |
| `/app/video/[appointmentId]` | Mind-only | Therapist appointment video room |
| `/app/video/session/[sessionId]` | Mind-only | Therapist virtual-session room and scribe |

Route ownership and runtime enforcement are separate checks. Mind-only pages touched by this roadmap must use the therapist vertical guard or an equivalent explicit redirect; Scribe-only pages must retain `requireOnboardedDoctor`.

## Visible vocabulary

| Concept | Mind | Scribe |
|---|---|---|
| Person receiving care | Client | Patient |
| Unit of work | Session | Encounter or consult |
| Daily home | Today | Clinic |
| Start action | Start session | Start encounter |
| Clinical completion | Review & Close | Review & Sign |
| Longitudinal surface | Journey & outcomes / Plan of care | Medical history / chronic-care surfaces |

Technical table names (`Client`, `Session`) and compatibility routes may remain shared. Visible product language must follow the authenticated vertical.

## Shared-file change rules

The following files are shared boundaries and require both Mind and Scribe regression review when changed:

- `apps/web/lib/product.ts`
- `apps/web/middleware.ts`
- `apps/web/app/login/**`
- `apps/web/app/onboarding/**`
- `apps/web/app/app/layout.tsx`
- `apps/web/components/app/Sidebar.tsx`
- `apps/web/components/app/MobileNav.tsx`
- shared session/client API routes and contracts

For authenticated behavior, branch on the stored vertical:

```ts
if (practitioner.vertical === 'THERAPIST') {
  // Mind-only journey behavior.
}

// Preserve the existing doctor behavior.
```

Use `productFromHost` for public branding and `canonicalPractitionerProduct` / `practitionerHostRedirect` for canonical host routing. Do not scatter hard-coded product domains.

## Mind journey feature flags

Mind journey work is released through flags that fail closed for non-therapist verticals:

- `unifiedPreflight`
- `safeFinalization`
- `todayHome`
- `sessionCloseout`
- `clientWorkspace`
- `clientCareLoop`

Even if a Mind flag is enabled globally, its evaluator must return `false` for `DOCTOR`. Scribe changes require their own explicitly approved requirement and flag.

## Pull-request acceptance gate

Every pull request touching a shared boundary must answer:

1. What changes for Mind?
2. What changes for Scribe? The expected answer for the Mind journey roadmap is **nothing**.
3. Which automated test proves the vertical boundary?
4. Which Mind route was manually exercised?
5. Which Scribe route was manually exercised?

A Mind journey pull request fails review if it changes Scribe landing, onboarding, Clinic, Patients, encounter start/live flow, medical note, prescription, or Review & Sign without an explicit Scribe requirement.
