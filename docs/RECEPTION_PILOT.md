# Reception pilot for Mind and Scribe

## Product boundary

One shared administrative reception engine, presented within each product. The initial desk belongs to a single authenticated practitioner. Clinic membership alone never grants access to another practitioner's enquiries, patients or calendar. This release does not create receptionist accounts or cross-practitioner delegation.

The public web assistant retrieves only practitioner-approved answers. It does not send patient questions to an LLM, expose the private practice assistant, inspect clinical records, diagnose, triage, or sign anything. Unknown questions become human-review enquiries. It is not an emergency service.

## First complete workflow

1. Practitioner configures a private, initially disabled desk: name, public slug, UAE/India time zone, opening hours, appointment duration, visit mode and approved FAQs.
2. Patient views current available times and explicitly consents to contact before submitting a request. A request is not a reservation or confirmed appointment.
3. Practitioner reviews the encrypted enquiry, verifies identity outside the chat, and selects the correct existing patient. New patients are created in the established patient workflow first. Shared phone numbers never auto-link a record.
4. Booking approval rechecks current availability and creates an appointment and scheduled session atomically. Duplicate/replayed actions must not create another booking.
5. Cancellation, rescheduling and general questions remain human-handled requests. Marking an enquiry resolved does not change an appointment or claim a message was delivered.

## Deployment and rollout gates

- No production migration, deployment, real message, or real patient write is authorized by the local build task. Disposable local databases may be migrated for verification.
- `RECEPTION_PILOT_ENABLED=true` is required for live APIs; otherwise they fail closed. Each practitioner's desk also starts disabled.
- Public submissions require `RECEPTION_RATE_LIMIT_SECRET` (at least 32 random characters) for keyed abuse counters and replay fingerprints. Do not log it or put it in a browser variable. Trusted Vercel proxy headers are used on Vercel; elsewhere requests share an anonymous bucket unless a verified, header-overwriting reverse proxy is configured with `RECEPTION_TRUST_PROXY=true`.
- New storage needs the additive migration and the existing runtime-role grants. Do not silently fall back to unencrypted/local storage when unavailable.
- Preview is fictional and opt-in: development mode plus `RECEPTION_WORKSPACE_PREVIEW=true`.
- Reception-created appointments suppress automatic reminder emails. The UI must disclose that staff still needs to contact the patient.
- Clinic custody transfers are blocked while either practitioner's reception desk is enabled. Even with both desks paused or the pilot disabled, patients with linked reception enquiries or reception-created appointments cannot be transferred: the pilot has no encrypted ownership-transfer workflow for this booking history. Erasing an enquiry does not remove the appointment safeguard. Patients without reception history may use the existing transfer workflow after both desks are paused. The pilot does not introduce cross-practitioner scheduling delegation.
- Public reception slots use the explicitly selected UAE or India time zone. The existing Scribe clinic queue still assigns tokens by its India-time clinic day; UAE-local queue-day behavior is a separate launch gate, especially around midnight. Reception does not claim to have changed that shared clinical screen.
- Pilot one clinic, one practitioner, one appointment type and web channel first. Keep a staffed review queue and a way to pause new requests.
- The owner can explicitly delete an enquiry's contact/message and activity records without deleting its appointment or patient chart. Linked enquiries are also removed by patient erasure. Before public activation, agree and operate the clinic's retention process for unlinked enquiries; this release does not claim an automatic retention scheduler.
- Before enabling with real patients, exercise authenticated request/approval, conflicting writes from all calendar entry points, replay, wrong-tenant access, erased patients, and rollback on audit failure against disposable PostgreSQL. Confirm contact consent wording, retention handling, clinic policy and deployment configuration.
- Browser preview and mocked tests are not evidence of production database or real-user validation.

## Test plan

| Area                     | Verification                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contracts and time zones | Validated input limits, explicit consent, international phone format, UTC/date boundaries, overlapping windows and slot exclusion                      |
| Identity and tenancy     | Owner-only scoped reads/writes; public responses never disclose requests or patient records; explicit patient selection; erased/demo patient rejection |
| Calendar writes          | Shared lock ordering, fresh conflict checks, atomic appointment/session/request/event, duplicate approval and concurrent rescheduling                  |
| Public abuse             | Durable bounded submissions, idempotency with payload matching, field limits, no raw IP/contact values in events or logs                               |
| Privacy                  | Encrypted contact/message data, no clinical context in FAQs, erasure integration, no localStorage contact persistence                                  |
| Messaging                | No provider calls during enquiry/approval; existing reminder paths exclude reception-created appointments                                              |
| UI                       | Loading/error/empty states, keyboard navigation, focus visibility, mobile layout, both product nouns, unambiguous request versus booking status        |

## Next phases, not enabled here

Scheduling-only staff accounts with explicit delegation; verified patient self-service; two-way WhatsApp/email delivery with consent and reconciliation; waitlist offers with expiry and atomic acceptance; rule-based automatic confirmation; external calendars; then telephone voice. Delivery, confirmation and attendance remain separate outcomes. Reception usage must not silently consume the consultation credits advertised for Scribe.

## Local verification

`apps/web/lib/reception-postgres.spec.ts` is opt-in and refuses implicit database URLs, migration-owner roles, remote hosts and connection-string overrides. It requires `RUN_RECEPTION_POSTGRES_TESTS=1` and an explicit `RECEPTION_TEST_DATABASE_URL` using role `reception_test_runtime` at `127.0.0.1:55442/cureocity_mind_test`. The runtime role must be non-superuser, non-owner, without schema-create rights, with the repository migrations applied. The repository's existing fresh-CI preparation script is needed for its historical booking migration ordering.

Tests use fictional identities and substitute encryption envelopes, not real KMS or production authentication. They exercise actual PostgreSQL locking, competing approvals/calendar writes, replay, ownership rejection, request erasure, disabled desks and abuse counters. The disposable database may be removed after the run; do not point the test at a production clone.

The development-only `/dev/reception` preview runs in memory. Switching product resets its fictional data. It can demonstrate the public-request-to-owner-inbox flow, but it is not an authenticated end-to-end production test.
