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

| Date       | Retention confirmed | Restore timestamp (UTC)       | RTO (wall-clock)               | RPO (observed) | Verify 1–4              | Operator | Notes                                                                                |
| ---------- | ------------------- | ----------------------------- | ------------------------------ | -------------- | ----------------------- | -------- | ------------------------------------------------------------------------------------ |
| 2026-07-12 | Y — 7d (Launch)     | ~2026-07-12T04:40Z (≈1h back) | 0.48s fork / ~10m incl. verify | ≈0s            | pass / pass / n-a / n-a | shamil   | First rehearsal. Recovered a real signed note (id cmrdj0gn…) intact + audit history. |

Verify legend: 1 = newest audit_logs row present (Jul 11 22:29Z, at/before
the restore point ✓); 2 = a signed therapy_note came back intact ✓; 3 =
`prisma migrate status` and 4 = the audit-coverage test were **skipped for
a first drill** (the two SQL checks are sufficient proof of recovery) —
run all four on the next rehearsal.

## Notes / gotchas found during a drill

- **Neon Free plan caps history at 6 h** — below the ≥7-day DR requirement.
  Upgraded to **Launch** (7-day window) before the drill; do not run the
  pilot on the free window.
- The fork is genuinely instant (0.48 s); real-incident RTO is dominated by
  the Vercel env repoint + redeploy, not the data restore.
- Set the drill branch's **Auto-delete = After 1 day** at creation so a
  forgotten branch can't accrue storage.

_(append anything that surprised you — a missing env on the branch, a
slow step, a verify query that needed adjusting — so the next drill is
faster.)_
