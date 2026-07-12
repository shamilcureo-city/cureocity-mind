# DR drill log

One row per disaster-recovery rehearsal. The `dr-postgres-restore.md`
runbook calls this the pilot-blocking proof: **a restore path that has
never been executed is not a recovery plan.** Do a real Neon
point-in-time restore into a throwaway branch, run the four verify
steps, record the wall-clock RTO + observed RPO here, then delete the
branch.

## How to run one (≈15 min)

Full detail in `dr-postgres-restore.md`. The short version:

1. **Retention** — Neon console → Project → Settings → Storage /
   History retention → confirm **≥ 7 days**. (One-time; only needs
   doing again if the plan changes.)
2. **Note the start time** (you're timing the RTO).
3. **Create the restore branch** — console → Branches → Create branch →
   _From a point in time_ → pick a timestamp ~1 hour ago → name it
   `dr-drill-<date>`.
4. **Verify** against the new branch's connection string (Connect
   button → SQL editor on that branch, or a local `DATABASE_URL`):
   - `SELECT MAX("createdAt") FROM audit_logs;` — newest row should be
     at/just before the restore timestamp, not older.
   - `SELECT id, "signedAt" FROM therapy_notes ORDER BY "signedAt" DESC NULLS LAST LIMIT 1;`
     — a recent signed note is intact.
   - `DATABASE_URL=<branch> pnpm exec prisma migrate status` — no drift.
   - `pnpm --filter @cureocity/contracts test` — audit-coverage passes
     against the recovered shape.
5. **Note the end time**, compute RTO (end − start) and RPO (restore
   timestamp − newest recovered row; should be ≈ 0).
6. **Delete the drill branch** so it doesn't accrue storage.
7. Fill in the row below and commit.

## Drill log

| Date         | Retention confirmed | Restore timestamp (UTC) | RTO (wall-clock) | RPO (observed) | Verify 1–4            | Operator | Notes             |
| ------------ | ------------------- | ----------------------- | ---------------- | -------------- | --------------------- | -------- | ----------------- |
| _yyyy-mm-dd_ | _≥7d? Y/N_          | _2026-mm-ddThh:mm:00Z_  | _mm:ss_          | _~0s_          | _pass/pass/pass/pass_ | _name_   | _first rehearsal_ |

## Notes / gotchas found during a drill

_(append anything that surprised you — a missing env on the branch, a
slow step, a verify query that needed adjusting — so the next drill is
faster.)_
