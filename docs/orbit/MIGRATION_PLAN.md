# Cureocity ORBIT — convergence sprints

The migration is a strangler program, not a rewrite. Every sprint leaves production deployable.

| Sprint                      | Status       | Outcome                                                               |
| --------------------------- | ------------ | --------------------------------------------------------------------- |
| 0 — Product lock            | **Complete** | Charter, glossary, capability matrix, target architecture, and scope. |
| 1 — Architecture foundation | **Complete** | Canonical domain types, repositories, and legacy mappers.             |
| 2 — Capability model        | **Complete** | Credential and server-enforced capability resolution.                 |
| 3 — Brand convergence       | **Complete** | Central ORBIT branding, logo, metadata, and customer-facing surfaces. |
| 4 — Unified shell           | **Complete** | One navigation, Today home, and New Encounter action.                 |
| 5 — Patient roster          | **Complete** | Canonical patient routes with legacy redirects.                       |
| 6 — Patient workspace       | **Complete** | One timeline and longitudinal workspace with capability panels.       |
| 7 — Encounter foundation    | **Complete** | Shared lifecycle, profiles, and capture strategies.                   |
| 8 — Behavioral Health Pack  | **Complete** | Existing therapy workflows registered in ORBIT.                       |
| 9 — Medical Care Pack       | **Complete** | Existing doctor workflows registered in ORBIT.                        |
| 10 — Backend convergence    | **Complete** | Tested application services and thin live route adapters.             |
| 11 — Legacy retirement      | In progress  | Capability guards landed; measured compatibility retirement remains.  |
| 12 — Launch hardening       | In progress  | Fail-closed gates/runbook landed; rehearsals and sign-offs remain.    |

## Current implementation boundary

Sprints 0–10 are complete. Sprints 11–12 have their engineering gates in place but remain rollout/operational work until compatibility usage reaches zero and launch evidence is signed. Sprint 10 moves Encounter lifecycle orchestration, transactional audits,
document-draft creation, and concurrency control into a tested application service behind thin routes. See
[`STATUS.md`](STATUS.md) for the detailed delivered and pending checklist.
