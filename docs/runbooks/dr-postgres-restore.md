# Disaster recovery — database restore (Neon)

**Severity:** invoked manually during DR. **Owner:** the founder / whoever
holds the Neon + Vercel credentials (there is no separate platform on-call —
see the bus-factor note at the end).

> This runbook describes the **real** production stack: **Vercel** (stateless
> Next.js app + serverless API routes) and **Neon** (serverless Postgres, the
> single source of truth — `prisma/schema.prisma`, **including session audio**,
> which is stored inline as `AudioChunk.bytes` BYTEA). There is **no
> Kubernetes, no self-managed Postgres, and no S3 audio bucket**; the
> `services/*` NestJS apps are non-live scaffolds (CLAUDE.md §2). Any earlier
> version of this file that told you to `kubectl scale` or replay WAL from an
> S3 bucket was describing infrastructure that never existed — ignore it.

## Targets

- **RPO** (recovery point objective): bounded by Neon's **history retention
  window**. Neon streams WAL continuously, so PITR granularity is effectively
  to-the-second within the retention window — confirm the plan's retention
  (Console → Project → Settings → _Storage / History retention_; paid plans
  default to 7 days). **Action item:** set retention ≥ 7 days before pilot.
- **RTO** (recovery time objective): minutes. A Neon restore is a metadata
  operation (create a branch at a timestamp) + a Vercel env repoint +
  redeploy — no data copy over the wire.

## What can fail, and the recovery for each

| Failure                                                                                 | Recovery                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bad write / accidental delete / bad migration** (data is corrupt but Neon is healthy) | Neon **PITR** to just before the incident (below). This is the common case.                                                                                                                                                                                                                                                                         |
| **Neon project/branch lost or unreachable**                                             | Restore from Neon's retained history into a new branch, or (worst case) contact Neon support — Neon replicates storage across AZs, so a total loss is a provider-level event.                                                                                                                                                                       |
| **Audio chunk loss**                                                                    | Audio IS database rows (`AudioChunk.bytes` BYTEA) — it restores with the Neon branch like every other table, and is equally at risk in a DB incident. Within the DPDP 30-day audio window, Neon PITR recovers it; past the window it was purged on purpose. The transcript on the `NoteDraft` row remains the durable clinical source for the note. |
| **Vercel app down**                                                                     | Stateless — redeploy the last good commit, or roll back in the Vercel dashboard. No data lives in the app tier.                                                                                                                                                                                                                                     |

## Restore procedure — Neon Point-in-Time Restore

Do this from the Neon Console (or `neonctl`). **Prefer restoring into a NEW
branch** and repointing, rather than an in-place reset — it's non-destructive
and lets you diff the recovered data before cutting over.

1. **Freeze writes (optional but preferred).** In Vercel → Project →
   Settings → Environment Variables, you can flip the app into maintenance by
   pointing `DATABASE_URL` at a paused/empty branch, or simply proceed —
   Neon PITR reads from history, it doesn't need the primary stopped.

2. **Identify the recovery timestamp.** The last-known-good moment, just
   before the incident. Note it in UTC in the incident ticket.

3. **Create a branch at that timestamp** (time travel):
   - Console: Project → **Branches** → _Create branch_ → _From a point in
     time_ → pick the timestamp → name it `restore-<incident-date>`.
   - CLI:
     ```bash
     neonctl branches create \
       --project-id "$NEON_PROJECT_ID" \
       --name "restore-<incident-date>" \
       --parent-timestamp "2026-07-08T16:30:00Z"
     ```

4. **Get the new branch's connection strings** (pooled + unpooled):

   ```bash
   neonctl connection-string "restore-<incident-date>" --pooled
   neonctl connection-string "restore-<incident-date>"          # unpooled
   ```

5. **Verify the recovered branch BEFORE cutover** (see next section). Point a
   scratch `DATABASE_URL` at it locally and spot-check.

6. **Cut over.** In Vercel → Environment Variables (Production), set:
   - `DATABASE_URL` → the new branch's **pooled** string,
   - `DATABASE_URL_UNPOOLED` → the new branch's **unpooled** string,
     then **redeploy** (Deployments → … → _Redeploy_, or push a no-op commit).
     Env changes only take effect on a new deployment.

7. Once traffic is healthy on the restored branch, you can promote it to be
   the project's default/primary in the Neon console and retire the old one.

## Verify before re-opening traffic

Run against the **recovered branch's** connection string:

1. **Freshness** — the newest audit row should be at (or just before) the
   recovery timestamp, not older:
   ```sql
   SELECT MAX("createdAt") FROM audit_logs;
   ```
2. **Spot-check a recent signed note** exists and is intact:
   ```sql
   SELECT id, "signedAt" FROM therapy_notes ORDER BY "signedAt" DESC NULLS LAST LIMIT 1;
   ```
3. **Schema integrity** — migrations are all applied (no drift):
   ```bash
   DATABASE_URL=<recovered-branch> pnpm exec prisma migrate status
   ```
4. **Audit-coverage** — the contracts chaos test still passes against the
   recovered shape (`pnpm --filter @cureocity/contracts test`).

## Audio + PDFs

- Audio chunks live as `AudioChunk` **BYTEA rows in Postgres** (the
  chunk-upload route writes Postgres — see
  `apps/web/app/api/v1/audio/chunks/upload/route.ts`), so they restore with
  the Neon branch; there is no separate object-store restore step. PDFs are
  generated on demand from DB rows (letterhead routes) and need no restore.
- **Retention interaction:** keep Neon history retention ≤ the audio
  retention window + 7 days, so purged audio also ages out of restorable
  history (DPDP — a purge that survives in backups indefinitely isn't a
  purge).

## Mandatory before pilot — run one real drill

**None of the above has been rehearsed.** Before go-live, the credential
holder MUST:

1. Confirm Neon history retention ≥ 7 days is enabled on the prod project.
2. Do one **real** PITR into a throwaway branch, run the four verify steps
   against it, and record the wall-clock RTO + observed RPO in
   `docs/runbooks/dr-log.md`.
3. Practice the Vercel env repoint + redeploy on a preview deployment.

A restore path that has never been executed is not a recovery plan. This
drill is a pilot blocker.

## Related

- Neon PITR docs: <https://neon.tech/docs/introduction/point-in-time-restore>
- `scripts/vercel-db-setup.sh` — the deploy-time migrate + P3009 self-heal.
- DPDP § 8(7) — backups / continuity are a Data-Fiduciary duty.
