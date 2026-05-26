# modality-workflow-service

Owns the per-client modality state machine: phase tracking, manual + system-suggested transitions, and the exercise prescription engine. Listens on `:3003/api/v1`.

## Endpoints (Sprint 3)

| Method | Path                                    | Status                         |
| ------ | --------------------------------------- | ------------------------------ |
| GET    | `/health`                               | shipped                        |
| POST   | `/workflows`                            | shipped (PR 1)                 |
| GET    | `/workflows/:id`                        | shipped                        |
| POST   | `/workflows/:id/transitions`            | shipped (manual)               |
| GET    | `/workflows/:id/advancement-suggestion` | stub (PR 1); evaluator in PR 2 |
| POST   | `/workflows/:id/prescriptions`          | PR 4                           |

## Modality state model

One `ModalityState` per `Client` (unique). Phase strings are modality-specific and validated against `@cureocity/clinical` (PR 2 onward). Audit trail covers create, transition, and completion.
