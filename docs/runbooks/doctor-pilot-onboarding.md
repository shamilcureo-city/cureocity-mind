# Runbook — Doctor-vertical pilot onboarding

Operational checklist for onboarding the first super-specialty OPD clinic
to the doctor vertical (DV1–DV8). Pairs with `docs/DOCTOR_VERTICAL.md`
(build spec) and `docs/DOCTOR_VERTICAL_SPRINTS.md` (what's built).

## 0. Pre-flight (per environment)

| Concern      | Dev                                         | Pilot / prod                                                                                                         |
| ------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Auth         | `AUTH_BYPASS=true` → seeded doctor fixture  | Real Firebase (`FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY`) — bypass auto-disables                                |
| LLM          | `LLM_BACKEND=mock` (no creds)               | `LLM_BACKEND=vertex` + `VERTEX_PROJECT_ID` + `GOOGLE_APPLICATION_CREDENTIALS[_JSON]`; Pass 1 in `asia-south1` (DPDP) |
| Live gateway | `pnpm --filter @cureocity/live-gateway dev` | Deploy `services/live-gateway` in-region (asia-south1); set `NEXT_PUBLIC_LIVE_GATEWAY_URL`                           |
| ABDM         | `ABDM_BACKEND=mock` (default)               | `ABDM_BACKEND=gateway` + ABDM sandbox creds + HIP registration (see §4)                                              |
| DB           | local Postgres                              | run `prisma migrate deploy` (DV1–DV8 migrations included)                                                            |

## 1. Provision the doctor account

1. Doctor signs up → onboarding collects **medical registration number**
   (NMC/state council) + **specialty** (DV1.3). `vertical` is set to
   `DOCTOR`; the nav + dashboard branch to the doctor shape.
2. Confirm the specialty matches a template key for live gap-checks
   (`cardiology` / `endocrinology` today — DV6.3). Unknown specialties
   still work; they just get the generic completeness nudges.

## 2. First encounter (smoke the clinical loop)

1. Create a patient (reuses the `Client` model + PII encryption).
2. **Batch path** (DV3): Start encounter → record → medical note drafts
   → confirm Rx + orders (interaction-checked, DV5) → differential auto-
   runs (DV6) → sign → share after-visit summary.
3. **Live path** (DV4): open "Live copilot" → the note + gaps + 💊
   interaction flags + voice commands surface mid-consult. Mic audio is
   streamed (not stored); confirm the gateway is reachable.
4. **Chronic care** (DV7): vitals auto-capture into the trajectory; log
   an HbA1c; share the progress report.
5. **Interoperability** (DV8): Download FHIR; link ABHA + push to PHR.

## 3. Verify the safety rails

- **PE/vitals guard** — the note never invents an exam or vitals not
  spoken (`MedicalEncounterNoteV1` guard).
- **Interaction engine** — confirm a deliberately interacting Rx
  (e.g. warfarin + ibuprofen) raises the 💊 flag (`@cureocity/clinical`
  `checkInteractions`).
- **Nothing auto-prescribed** — every order/command requires explicit
  confirmation.
- **Tenant isolation** — a second doctor cannot see the first's patients
  (every query filters by `psychologistId`).

## 4. ABDM / ABHA (DV8.2) — pending procurement

The push flow (FHIR bundle build, ABHA link, audit, route, UI) is
complete; only the gateway call is env-gated:

1. Register as an ABDM **HIP** (Health Information Provider) in the
   sandbox; obtain client id/secret + the gateway base URL.
2. Wire `GatewayAbdmProvider.pushPrescription` in `apps/web/lib/abdm.ts`
   (consent artefact → `/health-information` push of the FHIR Bundle).
3. Set `ABDM_BACKEND=gateway` + the `ABDM_*` env. Re-run §2.5.
4. DPDP: the PHR push is a cross-border-free, in-India data flow; record
   it in `docs/dpdp-data-flow.md`.

## 5. Billing (DV8.4) — pending

Razorpay per-seat (Sprint 53) extends to the doctor vertical: enforce the
trial cap at **encounter-create** and add doctor-plan pricing
(~₹999–2,499/seat/mo). Operational only once the pilot moves to paid.

## 6. Load + security sign-off (DV8.5)

- Extend `docs/load-test-results.md` with the live-gateway concurrency
  profile (sockets are stateful — size the in-region service for peak
  simultaneous consults, not just request rate).
- Extend `docs/security-audit.md` with the new doctor surfaces (FHIR
  egress audit `ENCOUNTER_FHIR_EXPORTED`, ABDM push, chronic readings).
- File this runbook + the two above with the clinic before go-live.

## 7. Rollback

The vertical is additive: every doctor feature gates on
`vertical === 'DOCTOR'`. Disabling a doctor account (or flipping the
vertical) removes the surfaces without touching the therapist product.
Migrations are append-only (enum `ADD VALUE`, new tables) — safe to leave
in place on rollback.
