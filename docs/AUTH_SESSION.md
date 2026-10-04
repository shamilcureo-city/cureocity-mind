# Auth & session model (production)

This is the canonical reference for how therapist authentication, the
`__session` cookie, and the API/page guards work in production. It exists
because a single incident on **2026-06-20/21** burned a whole day chasing
auth/session symptoms; almost every "fix" along the way was the wrong
layer. Read this before touching anything under `apps/web/lib/auth-*.ts`,
the login/onboarding flows, or the sign-out path.

> TL;DR of the incident root cause: **the sidebar "Sign out" was a plain
> `<Link href="/api/v1/auth/signout">` and the route was a `GET` that
> cleared the cookie. Next.js prefetches every `<Link>`, so the cookie was
> being wiped by prefetch as soon as the sidebar mounted.** Everything
> else ("Missing Bearer token or session", rapid-click bounce, missing
> cookie in DevTools) was downstream of that. See § 6.

---

## 1. The sign-in flow

`/login` (`apps/web/app/login/page.tsx`) offers three methods, all via the
Firebase **client** SDK (`apps/web/lib/firebase-therapist.ts`):

1. **Google** (`signInWithGoogle`) — popup; falls back to
   `signInWithRedirect` when the popup is blocked (common with
   privacy/ad-block extensions).
2. **Email + password**.
3. **Phone OTP**.

All three obtain a Firebase **id token** and POST it to
`POST /api/v1/auth/session`, which:

- verifies the id token with Firebase Admin,
- auto-provisions a `Psychologist` row on first sign-in (this IS the
  signup; placeholder `email`/`rciNumber`/`phone` are filled at
  `/onboarding`),
- mints the **`__session` Firebase session cookie** and sets it on the
  response.

### Cookie attributes (must stay exactly these)

```
__session = <Firebase session cookie JWT>
  Path=/
  Max-Age=432000        (5 days)
  Secure                (process.env.NODE_ENV === 'production')
  HttpOnly
  SameSite=Lax
  (no Domain → host-only for the exact deploy host)
```

These are correct and verified-in-prod. A future "cookie isn't working"
bug is **almost never** these attributes — check § 6 first.

### The Google redirect trap (fixed, Sprint — PR #17)

`signInWithGoogle()` returns `null` when it falls back to
`signInWithRedirect`. The login page **must** call
`completeGoogleRedirect()` (wraps `getRedirectResult`) on mount and run
`startSession()` with the result — otherwise the redirect path leaves the
user signed in to Firebase with **no `__session` cookie minted**. Do not
remove that mount effect in `login/page.tsx`.

---

## 2. Two guards, two credential models

| Surface                                                 | Guard                                                                                                                   | Reads                                                           | On failure                              |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------- |
| **Pages** (`/app/*`, `/onboarding`) — server components | `currentPsychologist()` / `requirePagePsychologist()` / `requireOnboardedPsychologist()` in `apps/web/lib/auth-page.ts` | **only the `__session` cookie**                                 | `redirect('/login')` (or `/onboarding`) |
| **API routes** (`/api/v1/*`)                            | `requirePsychologistId()` → `verifyRequestIdentity()` in `apps/web/lib/auth-server.ts`                                  | `Authorization: Bearer <idToken>` **OR** the `__session` cookie | 401 JSON                                |

**Key asymmetry:** a server component rendering a page can only read the
**cookie** — it cannot read an `Authorization` header off a `<Link>`
navigation. So **pages are 100% dependent on the cookie being present and
sent.** API routes have the Bearer fallback; pages do not. This is why a
cookie problem shows up as a page bounce to `/login` even when API calls
are fine.

Both guards resolve identity, then look up the `Psychologist` row by
`firebaseUid`. **If the row is missing, the guard returns null even though
the cookie is cryptographically valid** — see § 5.

---

## 3. Page-bound identity for browser API calls

`AuthedFetchProvider` wraps the practitioner app, operator console and
onboarding form with the Firebase UID verified by their server page guard.
It installs a scoped fetch wrapper and waits for Firebase initialisation
**before mounting children**, so child mount-time requests cannot race the
identity check. The wrapper is removed when that authenticated layout unmounts.

- The browser Firebase user must match the page UID before a token is attached.
  A mismatched user is not silently preferred, and failed authentication never
  falls back to an unmodified request. A missing browser user may still use the
  existing cookie.
- Same-origin practitioner API requests carry `x-cureocity-session-uid`. This
  is only a consistency assertion, not authentication or authority. The server
  compares it with its independently verified identity, detecting an old page
  paired with a newly changed cookie.
- If both Bearer and cookie credentials are supplied, **both must verify and
  their UIDs must agree**. Invalid credentials return a reauthentication 401;
  conflicting identities return 401 with `SESSION_IDENTITY_MISMATCH`, without
  patient lookup, capability changes, or identifying data in the response.
- True Bearer-only and cookie-only clients remain supported. Existing role,
  lifecycle, consent, ownership, capability and origin checks remain in force.
- Tokens/assertions are never added to cross-origin URLs, API-prefix lookalikes,
  Care/public/paired-patient endpoints, or session exchange/sign-out requests.
  Guarded API redirects are refused rather than forwarding identity headers.
- The paired patient home uses its own Firebase Bearer identity and explicitly
  omits ambient practitioner cookies on its GET and refresh-request POST.
- Onboarding no longer silently remints a cookie from persisted Firebase state.
  Only an explicit login exchanges credentials for a new session.

A mismatch pauses subsequent API actions and shows a sign-in recovery notice.
Already-mounted draft state stays on the page, but is **not claimed saved**.
The user can copy unsaved work before choosing recovery. That explicit action
signs out Firebase, deletes the server cookie and performs full navigation to
login. It never selects a replacement account or retries failed writes.

This protects against the historical Bearer self-heal (PR #20) using a different
persisted account than the cookie that rendered the roster. It does not resolve
missing/erased/transferred patient records or grant missing clinical authority.

---

## 4. Verification: no revocation check, with transient-retry

`verifyWithRetry()` in `auth-server.ts` wraps `verifyIdToken` /
`verifySessionCookie` for both guards.

- **`checkRevoked` is intentionally NOT passed.** That flag makes a
  network call to Firebase Identity Platform on _every_ request to check
  revocation. There is **no "sign out all devices" feature** in the app,
  so it was pure overhead. (If you ever build sign-out-all-devices,
  re-enable `checkRevoked` _and_ keep the retry.)
- Even without `checkRevoked`, `verifySessionCookie` still fetches
  Google's public signing keys over the network — **cached only after the
  first call**. On a cold function instance, concurrent requests race that
  first fetch, and a transient failure throws.
- `verifyWithRetry` retries **transient** errors (network / internal /
  key-fetch) up to 3× with short backoff, and **fails fast** on genuine
  auth errors (`auth/session-cookie-expired`, `…-revoked`, `…-invalid`,
  `auth/argument-error`, and the id-token equivalents) so real
  expiries/logouts still happen. The `GENUINE_TOKEN_FAILURES` set is the
  allowlist of "do not retry, log the user out".

---

## 5. Deleting/wiping Psychologist rows invalidates live cookies

A `__session` cookie encodes a Firebase `uid`, not a DB row id. The guard
verifies the cookie, then does
`prisma.psychologist.findUnique({ where: { firebaseUid } })`. **If that
row was deleted** (e.g. a `TRUNCATE psychologists`, a hard delete, or a
DSR erasure), the cookie still verifies but the lookup returns `null` →
the page bounces to `/login`.

This bit us after a clean-slate DB wipe during the incident: every tab
holding a pre-wipe cookie bounced to `/login`. **Recovery is just: sign in
again** — it re-provisions the row and mints a fresh cookie. Keep this in
mind any time you wipe/migrate prod data: existing sessions are
invalidated, not corrupted.

---

## 6. Sign-out MUST be a POST, never a GET `<Link>` (the incident root cause)

**The bug:** the sidebar (`apps/web/components/app/Sidebar.tsx`) rendered

```tsx
<Link href="/api/v1/auth/signout">Sign out</Link> // ❌ never do this
```

and `apps/web/app/api/v1/auth/signout/route.ts` was a **`GET`** that
cleared the `__session` cookie. **Next.js prefetches every `<Link>` on
screen by default**, so Next fired `GET /api/v1/auth/signout` the moment
the sidebar mounted (or on hover) — which executed the side effect and
**wiped the live user's cookie**. Every subsequent navigation then bounced
to `/login`. The "rapid clicks / 5th click bounces" symptom was just when
prefetch happened to fire.

**The fix (PR #25):**

- Sign out is now a `<form method="POST" action="/api/v1/auth/signout">`
  with a submit button. **Forms and `POST` verbs are never prefetched.**
- The route is **POST-only** (the `GET` handler was removed), redirecting
  with **`303 See Other`** so the browser follows with `GET /login`.
- Even if someone re-adds a `<Link>` to the URL later, a prefetched `GET`
  now returns `405` with no side effect.

**Rule: any route with a side effect must not be reachable by `GET`,**
because GET is what prefetchers, link-scanners, and "open in new tab"
fire speculatively. This is the single most important takeaway from the
incident.

---

## 7. Troubleshooting "bounced to /login"

Every null/redirect branch now logs its reason (PR #24). Reproduce the
bounce, then read **Vercel → project → Logs** (or runtime logs) and match:

| Log line                                                                                                 | Cause                                                                                                                                | Fix                                            |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `[auth-page] no __session cookie on request`                                                             | The cookie isn't on the request. Check for a **side-effecting GET being prefetched** (§ 6), an expired/cleared cookie, or incognito. | Make side-effect routes POST-only; re-sign-in. |
| `[auth-page] verifySessionCookie failed code=auth/session-cookie-expired` (or `…-revoked` / `…-invalid`) | Genuine: the cookie is expired/invalid.                                                                                              | User re-signs in (expected).                   |
| `[auth-page] verifySessionCookie failed code=auth/internal-error` (or `network…` / `unknown`)            | Transient verify failure; `verifyWithRetry` exhausted.                                                                               | Widen retry/backoff if frequent.               |
| `[auth-page] no psychologist row for uid=…`                                                              | Cookie valid but the DB row is gone (§ 5 — wipe/delete).                                                                             | Re-sign-in re-provisions.                      |
| `[auth-server] verify… failed code=…`                                                                    | The bounce is from an **API** guard, not a page.                                                                                     | Different path; inspect the calling component. |

If logs are completely empty after a reproduction, the deploy under test
probably predates the logging — check the production deploy is the right
commit.

---

## 8. Deploy/DB pipeline facts that touch auth

- **`prisma db seed` is NOT run on production deploys** (`scripts/
vercel-db-setup.sh`, PR #19). It writes the dev fixtures
  (Priya/Rohan/Aisha/Samuel/Lakshmi/Meera) and would re-inject fake
  "patient" identities into the live DB on every build, _and_ their fixed
  emails/RCI numbers collide with real signups (the onboarding "email
  already used by another account" error). Run seed manually for local
  dev only.
- **`vercel-db-setup.sh` self-heals a P3009 freeze** (PR #22). A build
  cancelled mid-`migrate deploy` leaves a migration recorded as _failed_,
  and then every deploy aborts with `P3009` on every branch until the row
  is hand-deleted (this froze all deploys for 18h+ during the incident).
  The script now detects P3009, rolls back the named failed migration(s)
  with `prisma migrate resolve --rolled-back`, and retries once — safe
  only because **every migration is idempotent** (`ADD COLUMN IF NOT
EXISTS`, guarded `CREATE TYPE`, …). New migrations must preserve that.
- **`AUTH_BYPASS`** resolves practitioner requests to the seeded fixture
  (`dev-firebase-uid-priya`) only outside production; it auto-engages when
  Firebase env is missing on a non-production deploy and **fails closed**
  (no bypass) in production. The `/app` layout shows a "Demo mode" banner when
  bypass is active on a Vercel deploy.

---

## 9. Incident PR index (2026-06-20/21)

| PR  | What it fixed                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #17 | Google **redirect** sign-in now mints the session cookie (`completeGoogleRedirect` on login mount).                                                                                         |
| #19 | Stop `prisma db seed` running on prod deploys.                                                                                                                                              |
| #20 | `AuthedFetchProvider` — Bearer token on every in-app `/api/v1` fetch.                                                                                                                       |
| #21 | `pass3-normalise.ts` — normalise Gemini crisis-flag enum drift before the Zod parse (`suicidal-ideation-risk` → `suicidal_ideation`, `moderate` → `medium`). Unknown values still rejected. |
| #22 | P3009 stuck-migration self-heal in `vercel-db-setup.sh`.                                                                                                                                    |
| #23 | Drop `checkRevoked` from `verifySessionCookie` (kept; defence-in-depth).                                                                                                                    |
| #24 | `verifyWithRetry` for transient verify failures **+ the diagnostic logging that found the real bug**.                                                                                       |
| #25 | **Root cause:** stop Next prefetching sign-out; route is POST-only.                                                                                                                         |

Manual ops during the incident: cleared the stuck `_prisma_migrations`
row (P3009 recovery), and a `TRUNCATE … CASCADE` clean-slate DB wipe.
