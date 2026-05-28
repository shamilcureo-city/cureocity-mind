# scribe-service

Owns the session lifecycle (create → consent → start → end), audio chunk ingestion (Sprint 2 PR 2), two-pass Gemini orchestration (PRs 3-4), and the cost circuit breaker (PR 5). Listens on `:3002/api/v1`.

## Endpoints (Sprint 2 PR 1)

| Method | Path                         | Status          |
| ------ | ---------------------------- | --------------- |
| GET    | `/health`                    | shipped         |
| POST   | `/sessions`                  | shipped         |
| GET    | `/sessions/:id`              | shipped         |
| POST   | `/sessions/:id/consent`      | shipped         |
| POST   | `/sessions/:id/start`        | shipped         |
| POST   | `/sessions/:id/end`          | shipped         |
| GET    | `/sessions/:id/note-draft`   | 404 stub (PR 4) |
| POST   | `/sessions/:id/audio-chunks` | PR 2            |

## Lifecycle

```
SCHEDULED ──/consent──▶ SCHEDULED (with consentSnapshot)
                ──/start──▶ IN_PROGRESS (only if consent recorded)
                            ──/end──▶ COMPLETED
                            ──cancel──▶ CANCELLED  (Sprint 3+)
```

`/start` enforces consent has been recorded. `/end` will (in PR 4) enqueue a BullMQ job that runs Pass 1 (Flash, asia-south1) then Pass 2 (Pro, global) and persists a `NoteDraft`.

## Local development

```bash
# Apply migrations + generate Prisma client
cp .env.example .env
pnpm db:migrate
pnpm db:generate

# Run
AUTH_BYPASS=true pnpm nx run scribe-service:serve
```

## Tests

```bash
pnpm nx run scribe-service:test          # unit
RUN_INTEGRATION_TESTS=1 \
  DATABASE_URL=... AUTH_BYPASS=true \
  pnpm nx run scribe-service:test        # + integration
```
