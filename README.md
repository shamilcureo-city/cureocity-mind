# Cureocity Mind

Ambient therapy scribe for Indian psychologists practising CBT and EMDR. Captures session audio in the browser, generates structured clinical notes via Gemini, manages between-session client exercises, and tracks modality phase progression — all under DPDP-compliant Indian data residency.

## Status

**Planning.** This repo currently contains the engineering execution plan only. No code yet.

The execution plan is the authoritative reference for how V1 will be built. Read it before opening any other PR:

→ **[`docs/EXECUTION_PLAN.md`](docs/EXECUTION_PLAN.md)**

The plan derives from **PRD 22.1 — Cureocity Mind Engineering Specification (Installments 1 & 2)** but diverges on several material points (web instead of Flutter; no mock services; two-pass Gemini architecture for India residency). All divergences are listed in § 1 of the execution plan.

## What's next

After sign-off on the execution plan (see § 9), Sprint 1 begins: monorepo bootstrap + `patient-model-service`. Each subsequent sprint lands in its own series of PRs as specified in § 5.
