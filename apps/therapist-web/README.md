# therapist-web

Next.js 15 (App Router) + Tailwind 4 + Firebase Auth (phone OTP). Listens on `:3100` in dev (`pnpm nx run therapist-web:serve`).

## Pages (Sprint 6)

| Route                                      | Purpose                                      |
| ------------------------------------------ | -------------------------------------------- |
| `/`                                        | redirects to `/login`                        |
| `/login`                                   | phone-OTP sign-in (Firebase Auth client SDK) |
| `/recover`                                 | backup-email recovery scaffold (gap G8)      |
| `/clients/[clientId]/briefing/[sessionId]` | RSC briefing dossier (Sprint 6 deliverable)  |

Subsequent sprints add: `/clients` index, the live session capture screen (Sprint 7), note review + signing (Sprint 7), PDF download flow (Sprint 7).

## Env vars

```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
PATIENT_MODEL_SERVICE_BASE=http://localhost:3001/api/v1
```

The briefing RSC currently passes a `Bearer dev-bypass` token to patient-model-service, matching its `AUTH_BYPASS=true` mode. Sprint 7 wires the real session-cookie → token exchange via a Next.js route handler.

## Not done yet

- Component tests + Playwright e2e — Sprint 7 / 9
- shadcn/ui CLI integration — components are hand-rolled with Tailwind classes for V1; we'll bring in shadcn when a third UI primitive (modal / popover / etc.) is needed
- Real session cookie + secure token forwarding — Sprint 7
- TA / BN locale UIs — v1.5
