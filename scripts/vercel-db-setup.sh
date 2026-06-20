#!/bin/bash
# Migrate against Neon.
# Called from apps/web/vercel.json buildCommand.
# Uses the non-pooled connection (PgBouncer doesn't speak Prisma DDL).
#
# `prisma db seed` is INTENTIONALLY NOT run here. The seed writes the dev
# fixtures (Priya/Rohan/Aisha/Samuel/Lakshmi/Meera) — useful for local dev
# and CI, never safe for production: it re-injects fake "patient" identities
# into the live DB on every deploy. Run seed manually for local dev:
#   DATABASE_URL=... pnpm exec prisma db seed
set -euo pipefail
export DATABASE_URL="$DATABASE_URL_UNPOOLED"
pnpm exec prisma migrate deploy
