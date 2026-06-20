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

# ---------------------------------------------------------------------------
# Self-heal a P3009 freeze.
#
# If a previous build is cancelled mid-migration (e.g. a newer push
# supersedes it while `migrate deploy` is running), Prisma records that
# migration as "failed" in `_prisma_migrations`. Every subsequent deploy
# then aborts with P3009 — "migrate found failed migrations" — and refuses
# to apply anything, on EVERY branch. This froze all deploys for 18h+ on
# 2026-06-20 and was only recovered by hand-deleting the stuck row in Neon.
#
# Every migration in prisma/migrations is idempotent (ADD COLUMN IF NOT
# EXISTS, guarded CREATE TYPE, CREATE INDEX IF NOT EXISTS — the per-sprint
# convention in CLAUDE.md), so re-running a migration that was rolled back
# by a killed transaction is safe. On P3009 we therefore roll back the
# named failed migration(s) and retry `migrate deploy` exactly once.
#
# A *genuine* migration error (bad SQL, not a cancellation) will fail again
# on the retry and surface normally — the self-heal does not loop, and it
# never touches a migration that isn't already recorded as failed.
#
# IMPORTANT: this is only safe because every migration is idempotent. New
# migrations MUST preserve that property.
# ---------------------------------------------------------------------------

MIGRATE_LOG="$(mktemp)"

# Run `migrate deploy`, tee-ing output so we can inspect a failure. Returns
# Prisma's real exit code (pipefail makes the pipe reflect it).
run_migrate() {
  pnpm exec prisma migrate deploy 2>&1 | tee "$MIGRATE_LOG"
  return "${PIPESTATUS[0]}"
}

if run_migrate; then
  exit 0
fi

if ! grep -q "P3009" "$MIGRATE_LOG"; then
  echo "[vercel-db-setup] migrate deploy failed and it is NOT a P3009 stuck-migration — surfacing the error."
  exit 1
fi

echo "[vercel-db-setup] P3009 detected: a previous build left a failed migration. Auto-resolving (migrations are idempotent) and retrying once."

# Prisma prints one line per failed migration:
#   The `20260717000000_dv1_practitioner_vertical` migration started at ... failed
# Extract the migration directory names (14-digit timestamp + name).
FAILED_MIGRATIONS="$(grep -oE 'The `[0-9]{14}_[A-Za-z0-9_]+` migration' "$MIGRATE_LOG" \
  | grep -oE '[0-9]{14}_[A-Za-z0-9_]+' \
  | sort -u || true)"

if [ -z "$FAILED_MIGRATIONS" ]; then
  echo "[vercel-db-setup] could not parse the failed migration name from the P3009 output — surfacing the error."
  exit 1
fi

while IFS= read -r migration; do
  [ -z "$migration" ] && continue
  echo "[vercel-db-setup] rolling back failed migration: $migration"
  pnpm exec prisma migrate resolve --rolled-back "$migration"
done <<<"$FAILED_MIGRATIONS"

echo "[vercel-db-setup] retrying migrate deploy after rollback"
pnpm exec prisma migrate deploy
