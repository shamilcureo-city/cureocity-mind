# Runbook — turning on Cureocity Care sign-in (phone OTP)

Scope: what to configure so real users can sign in at `/care/login`.
Product spec: [`../AI_COUNSELING.md`](../AI_COUNSELING.md). Ops:
[`care.md`](./care.md).

## The symptom this fixes

`/care/login` shows a **"Demo mode — phone sign-in is off"** card, and
"Continue as the demo user" bounces back to the login page. That happens
when the **patient Firebase _client_ keys are not set** (so the phone flow
can't start) while server auth-bypass is **off** (so the demo door has no
session to land on). Production is exactly this state until the keys below
are configured.

> After the login hardening (the `demoMode` change), an environment with
> neither the keys nor bypass now says _"sign-in isn't available on this
> deployment yet"_ instead of showing a demo button that goes nowhere.

## How Care auth is wired (read this first)

- **Client** (`apps/web/lib/firebase-client.ts`) issues the phone-OTP id
  token using the `NEXT_PUBLIC_FIREBASE_CLIENT_*` keys.
- **Server** (`apps/web/lib/firebase-admin.ts`) verifies that id token and
  mints the `__session` cookie using the **one shared admin**
  (`FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`)
  at `POST /api/v1/care/auth/session`.
- Firebase `verifyIdToken` only accepts a token whose project matches the
  admin's project. **So the Care client keys MUST point at the same
  Firebase project as `FIREBASE_PROJECT_ID`** (the one the platform already
  uses for therapists). The patient vs practitioner **audience split is
  enforced in the database** — a uid resolves through `care_users` OR
  `psychologists`, never both — not by separate Firebase projects.
- Therapist web uses `NEXT_PUBLIC_FIREBASE_*` (no `_CLIENT_`); Care uses
  `NEXT_PUBLIC_FIREBASE_CLIENT_*`. They can (and, with one shared admin,
  must) be the **same project** — just a second Web App registration is
  fine, or reuse the existing one.

## Env vars to set (Vercel → Settings → Environment Variables, Production)

Already present in production (used by the therapist app — do not change):

| Var                     | What it is                                 |
| ----------------------- | ------------------------------------------ |
| `FIREBASE_PROJECT_ID`   | Server admin project id                    |
| `FIREBASE_CLIENT_EMAIL` | Server admin service-account email         |
| `FIREBASE_PRIVATE_KEY`  | Server admin private key (newline-escaped) |

Add these four (the Web App config of the **same** project as
`FIREBASE_PROJECT_ID`):

| Var                                       | Where to find it (Firebase console)                |
| ----------------------------------------- | -------------------------------------------------- |
| `NEXT_PUBLIC_FIREBASE_CLIENT_API_KEY`     | Project settings → Your apps → Web app → `apiKey`  |
| `NEXT_PUBLIC_FIREBASE_CLIENT_AUTH_DOMAIN` | `authDomain` (e.g. `your-project.firebaseapp.com`) |
| `NEXT_PUBLIC_FIREBASE_CLIENT_PROJECT_ID`  | `projectId` — **must equal `FIREBASE_PROJECT_ID`** |
| `NEXT_PUBLIC_FIREBASE_CLIENT_APP_ID`      | `appId`                                            |

These are `NEXT_PUBLIC_*` → **build-time inlined**, so after adding them you
must **redeploy** (not just restart) for the client bundle to pick them up.

## Firebase console steps

1. **Authentication → Sign-in method → Phone → Enable.**
2. **Authentication → Settings → Authorized domains →** add
   `mind.cureocity.in` (and any custom Care domain). `localhost` is
   allowed by default for dev.
3. **Project settings → Your apps →** register a **Web app** (or reuse the
   existing one) and copy its config into the four vars above.
4. Phone auth uses an **invisible reCAPTCHA** (the login already renders the
   `#care-recaptcha` container) — no extra client work, but the domain must
   be authorized (step 2).
5. **Billing:** phone auth has a small free daily SMS quota; real volume
   needs the **Blaze** plan. Turn it on before a launch.

## Verify

1. Redeploy production after setting the vars.
2. Open `https://mind.cureocity.in/care/login` → it should now show the
   **phone number input** ("Text me the code"), not the demo card.
3. Enter a real number → receive the 6-digit SMS → verify. A first-time
   number provisions a `CareUser` (`CARE_USER_REGISTERED` audit row) and
   lands on onboarding; a returning one lands on home.
4. `GET /api/v1/health/auth` reports Firebase-admin health (server side).

## Alternative — a demo-only preview (NOT production)

To click through Care without real phone auth (e.g. to demo the UI on a
Vercel **Preview**), set `AUTH_BYPASS=true` **scoped to Preview only**, then
open the branch preview. The demo user (Kavya) walks the whole arc.

> ⚠️ **Never set `AUTH_BYPASS=true` on Production.** It is the
> platform-wide bypass shared by the therapist and doctor apps — on prod it
> would turn every visitor into the seeded demo identity across all three
> products. Previews only.
