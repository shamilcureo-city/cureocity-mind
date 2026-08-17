# Cureocity ORBIT — launch and recovery runbook

Sprint 12 is code-complete only when every automated gate passes. Production launch additionally requires recorded human approvals; documentation must never represent an unperformed rehearsal or approval as complete.

## Deployment gate

Run `pnpm --filter @cureocity/web orbit:readiness` using the exact production environment. A launch is blocked when authentication bypass is enabled, Firebase Admin is incomplete, KMS is not production-backed, WebAuthn is unpinned, or billing is not live.

## Required rehearsals

1. Apply migrations to a production-shaped clone and record duration and validation queries.
2. Roll the application back while keeping additive migrations in place.
3. Restore the database into an isolated account, validate tenant boundaries, and record RPO/RTO.
4. Rotate a tenant DEK, confirm old ciphertext remains readable, and confirm new writes use the new key.
5. Revoke a WebAuthn credential and verify regulated signing fails closed.
6. Simulate Firebase, KMS, billing, and clinical gateway outages and verify no demo or plaintext fallback occurs.
7. Exercise incident notification, privacy escalation, evidence preservation, and patient-data breach procedures.

## E2E release matrix

- Behavioral health: intake → encounter → note review → signature → share.
- Medical: consultation → differential → order → credential-gated prescription signature → export.
- Multidisciplinary: one Patient workspace with capability-filtered panels and explicit confidentiality boundaries.
- Privacy: export, correction, consent withdrawal, erasure queue, grievance, and audit evidence.

## Approval record

| Gate            | Required owner   | Evidence                                                        |
| --------------- | ---------------- | --------------------------------------------------------------- |
| Clinical safety | Clinical lead    | Signed scenario review and residual-risk acceptance             |
| Security        | Security lead    | Threat-model delta, penetration results, secret/KMS review      |
| Privacy         | DPO/privacy lead | DPIA/DPDP review and data-rights evidence                       |
| Platform        | Platform lead    | Migration, rollback, restore, monitoring, and on-call rehearsal |

Launch is blocked until every row has a named approver, date, and immutable evidence link in the release record.
