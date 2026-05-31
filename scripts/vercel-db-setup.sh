#!/bin/bash
# Migrate + seed the dev fixtures against Neon.
# Called from apps/web/vercel.json buildCommand.
# Uses the non-pooled connection (PgBouncer doesn't speak Prisma DDL).
set -euo pipefail
export DATABASE_URL="$DATABASE_URL_UNPOOLED"
pnpm exec prisma migrate deploy
pnpm exec prisma db seed
