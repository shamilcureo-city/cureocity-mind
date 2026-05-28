# Cureocity Mind

Ambient therapy scribe for Indian psychologists practising CBT and EMDR. Captures session audio in the browser, generates structured clinical notes via Gemini, manages between-session client exercises, and tracks modality phase progression — all under DPDP-compliant Indian data residency.

## Status

**Active development.** Sprint 1 in progress. The execution plan is the authoritative reference for how V1 is being built — read it before opening any PR:

→ **[`docs/EXECUTION_PLAN.md`](docs/EXECUTION_PLAN.md)**

The plan derives from **PRD 22.1 — Cureocity Mind Engineering Specification (Installments 1 & 2)** but diverges on several material points (web instead of Flutter; no mock services; two-pass Gemini architecture for India residency). All divergences are listed in § 1 of the execution plan.

## Prerequisites

- **Node.js 22 LTS** — run `nvm use` to pick up `.nvmrc`
- **pnpm 10+** — `corepack enable` or `npm install -g pnpm`
- **Docker 24+ with Compose v2** — required for local infrastructure

## Getting started

```bash
# Install workspace dependencies
pnpm install

# Set up local environment
cp .env.example .env

# Start local infrastructure (Postgres + Redis + Kafka + MinIO)
pnpm infra:up

# Verify all four containers are healthy
docker compose -f infrastructure/docker-compose.yml ps

# Stop infrastructure when done
pnpm infra:down
```

## Workspace commands

| Command             | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `pnpm lint`         | Run ESLint across all projects (`nx run-many -t lint`) |
| `pnpm typecheck`    | Run `tsc --noEmit` across all projects                 |
| `pnpm test`         | Run tests across all projects                          |
| `pnpm build`        | Build all projects                                     |
| `pnpm format`       | Auto-format with Prettier                              |
| `pnpm format:check` | Verify formatting without modifying files              |
| `pnpm infra:up`     | Start docker-compose infrastructure (detached)         |
| `pnpm infra:down`   | Stop docker-compose infrastructure                     |
| `pnpm infra:logs`   | Tail logs from infrastructure containers               |

## Local infrastructure

`infrastructure/docker-compose.yml` provides the four data services every backend depends on:

| Service  | Image                        | Host port                  | Purpose                                     |
| -------- | ---------------------------- | -------------------------- | ------------------------------------------- |
| Postgres | `postgres:16-alpine`         | 5432                       | Primary data store                          |
| Redis    | `redis:7-alpine`             | 6379                       | Cache + rate limiting                       |
| Kafka    | `apache/kafka:3.7.1` (KRaft) | 29092                      | Event bus (in-docker apps use `kafka:9092`) |
| MinIO    | `minio/minio`                | 9000 (API), 9001 (console) | S3-compatible storage for audio + PDFs      |

The `minio-init` container creates the `cureocity-mind-audio` and `cureocity-mind-pdfs` buckets on first startup. MinIO console is reachable at <http://localhost:9001> with the credentials from `.env.example`.

## Repository layout (target)

```
apps/             # Next.js applications (clinician PWA, patient PWA — Sprint 6+)
services/         # NestJS microservices (Sprint 1+)
packages/         # Shared TypeScript libraries (Sprint 2+)
infrastructure/   # docker-compose, Terraform (Sprint 7+)
docs/             # Engineering documentation
```

As of Sprint 1 PR 1, only `infrastructure/` and `docs/` contain code. Subsequent PRs populate `services/`, `packages/`, and `apps/`.

## What's next

See § 5 of the [execution plan](docs/EXECUTION_PLAN.md) for the full sprint-by-sprint roadmap. Sprint 1 lands the `patient-model-service` (Prisma schema + five endpoints + Firebase auth + tests + CI) across five PRs.
