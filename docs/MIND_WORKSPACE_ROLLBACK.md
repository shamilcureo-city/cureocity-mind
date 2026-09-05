# Mind workspace release and rollback

Prepared 5 September 2026. This runbook does not authorize an automatic rollback; the owner can request one if needed.

## Recovery checkpoint

- Pre-release `main`: `d200a75a71be6f58d361f0f45b6502a16975a598` (Google sign-in runtime fix, PR #147).
- GitHub backup branch: `codex/backup-mind-workspace-20260905-d200a75`.
- Previous working production deployment: `dpl_iDFAPtsQwCosJr32G2u11RpwyMfK`.
- Deployment URL: `https://cureocity-mind-mp85o589u-shamilcureo-citys-projects.vercel.app`.
- Vercel project: `cureocity-mind-web`, team `shamilcureo-citys-projects`.

The checkpoint deployment was READY and listed as a rollback candidate when this runbook was prepared. Recheck its availability before using it.

## Prefer reverting the workspace commit

The PR intentionally contains separate commits:

1. `fix(mind): preserve live-note risk during finalization` — retain this safety correction.
2. `feat(mind): add psychologist workspace and guided sessions` — the interface and guide workflow upgrade, including its tests and documentation.

Use a merge commit, not squash or rebase merging, to preserve these commit identities. The PR description records their exact SHAs after syncing to `main`.

For an interface rollback, start a fresh `codex/` branch from the latest `origin/main`, use `git revert` on the exact workspace commit from the PR, rerun CI, and merge the rollback PR. Keep the risk-fix commit in place. A revert adds a new commit; it does not erase history or discard subsequent unrelated changes. Inspect and resolve conflicts if later changes overlap.

Do not use a hard reset or force-push on `main`. Do not blindly use GitHub's whole-PR Revert button: that also reverses the risk correction and restores the previous live-note severity bug.

## Urgent deployment rollback

If the live app is materially broken, the owner can ask to switch Vercel back to the checkpoint deployment above. Inspect the target and current aliases first, and use Vercel's rollback flow rather than rebuilding an arbitrary older branch. Afterwards reconcile Git with an explicit rollback PR so a future push does not unexpectedly redeploy the unwanted version.

A full deployment rollback also restores the old risk-recording implementation until the standalone safety correction is redeployed. Prefer the workspace-only code revert when a rebuild is acceptable.

## Data and compatibility

- This upgrade has no schema, migration, dependency, infrastructure or deployed environment-variable changes. No reverse database migration is needed.
- Code rollback does **not** reverse notes, signatures, regenerated guides, shares, delivery attempts, audits or costs already created. Preserve those records. Never restore an older database just to undo the interface.
- Guide generation changes from GET to POST. Refresh already-open browser tabs after deploy or rollback so browser and server versions agree.
- `/dev/mind-workspace` is a fictional-data design preview, not a staging clinical test; it remains unavailable in production.
- Validate Mind Today, session start, risk visibility, note review/signing and guide access after recovery; confirm Scribe Clinic and Review & Sign remain available.

The owner can simply ask: **“Revert the Mind workspace upgrade, keep the safety fix.”** Use the exact commits and current state rather than guessing from a branch name.
