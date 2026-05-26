# patient-model-service

NestJS service that owns the five-layer patient model: Psychologist, Client, Consent, Session (stub at Sprint 1), and AuditLog. Authenticates incoming requests against Firebase phone-OTP JWTs.

## Local development

```bash
# From repo root
cp .env.example .env
pnpm db:generate
pnpm db:migrate            # create the schema
pnpm db:seed               # one psychologist + one client + three consents

# Start the service
AUTH_BYPASS=true pnpm nx run patient-model-service:serve
```

The service listens on `http://localhost:3001/api/v1`.

## Endpoints (Sprint 1)

| Method | Path                    | Status  |
| ------ | ----------------------- | ------- |
| GET    | `/health`               | shipped |
| POST   | `/psychologists`        | PR 4    |
| POST   | `/clients`              | PR 4    |
| GET    | `/clients`              | PR 4    |
| GET    | `/clients/:id`          | PR 4    |
| GET    | `/clients/:id/briefing` | PR 4    |
| PATCH  | `/clients/:id`          | PR 4    |

## Auth modes

| `AUTH_BYPASS` | Behaviour                                                                       |
| ------------- | ------------------------------------------------------------------------------- |
| `true`        | Skips Firebase verification, injects a dev user (matches the seed psychologist) |
| `false`       | Verifies `Authorization: Bearer <id-token>` via Firebase Admin SDK              |

In production, `AUTH_BYPASS=false` and the three `FIREBASE_*` env vars must be set.

## Tests

```bash
pnpm nx run patient-model-service:test          # vitest unit tests
pnpm nx run patient-model-service:typecheck     # tsc --noEmit
pnpm nx run patient-model-service:lint          # eslint
```
