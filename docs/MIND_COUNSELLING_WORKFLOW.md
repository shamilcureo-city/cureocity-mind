# Mind counselling workflow implementation

Local implementation, 10 September 2026. No release authorization is implied.

For the latest follow-up fixes, verification results and outstanding release gates, see [the release preflight](MIND_COUNSELLING_RELEASE_PREFLIGHT.md). The implementation ledger below records the original build pass.

## Product decision

Mind supports a psychologist and client working together over time. It must not force every person through diagnosis before counselling. Documentation happens throughout care; diagnosis, measures and a selected guide are tools, not prerequisites for being helped. Scribe's doctor workflow remains separate.

The everyday path is: prepare → choose today's purpose and how to document → meet → review/sign the note → agree a next step → review progress next time. Assessment can continue alongside counselling. An ending or referral is a clinician/client decision, never a score-triggered state transition.

## Scope and acceptance

| Slice                            | Acceptance criteria                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose and manual documentation | Explicit assessment/counselling/therapy/review choice. A clinician-written session needs no recording or AI permission. Partial drafts survive reload through tenant encryption and versioned saves. Completing a note does not create a model log, invented transcript, diagnosis or utterance evidence. Existing review/sign/PDF remain available. |
| Progress logic                   | A plan can be active without a diagnosis or questionnaire baseline. Assessment remains ongoing. Worsening takes precedence over improvement. No automatic discharge suggestion from scores alone. Closed assessment questions do not reappear merely because generated wording/rationale changed.                                                    |
| Continuity                       | Unfinished commitments span visits and expose their source. Retirement records a reason and preserves history. Homework creation requires review, records agreement revision provenance and tolerates retries without duplication. Creating an assignment never sends it.                                                                            |
| Counselling record               | Clinician-authored expectations, client priorities/feedback, review arrangements and ending/referral follow-through are versioned and encrypted. They neither grant recording consent nor change an episode status or send a referral.                                                                                                               |
| Live background                  | Default off until compatible gateway release. Explicit review/send and matching gateway acknowledgement are required before claiming use. Historical context cannot substitute for current-session evidence. Capability loss, rejected/late replies and disconnects cannot show a false confirmation.                                                |
| Questionnaires                   | Partial curated English answers can be saved/recovered without creating a score. Submission and discard are explicit, version-checked, idempotent operations. No plaintext browser persistence. A submitted/discarded tombstone prevents a late save from resurrecting answers.                                                                      |
| Privacy                          | New records are owner/capability checked, protected against erasure races and covered by the erasure manifest. DSR export includes authorized new drafts/versions and explicitly names sections omitted for missing capabilities. Cryptographic receipts and ciphertext are never exported.                                                          |

## Deliberate exclusions

- No autonomous diagnosis, prescribed therapy, discharge, crisis action or referral.
- No new treatment protocols, questionnaire translations, instrument cutoffs or claims of clinical validation.
- No scores, streaks or reward loops for clinical decisions.
- No permission to record a microphone, send a message, touch a real patient's record, merge, deploy or migrate production.
- Manual notes support existing signed PDF output. Automated patient-summary translation/sharing is not added to the manual-note path in this batch.

## Release boundaries

New additive migrations follow the earlier local UI/consent/reminder work:

- `20260926000700_mind_manual_sessions`
- `20260926000800_mind_agreement_homework`
- `20260926000900_mind_care_record`
- `20260926001000_mind_instrument_drafts`

`MIND_LIVE_CASE_CONTEXT=true` enables the optional reviewed background panel. Leave unset until web **and** standalone live gateway share the new acknowledgement protocol. A web release does not deploy the gateway. Changing the feature flag does not establish clinical validation.

Two pre-existing empty untracked migration directories are not repaired or deleted by this work. Disposable validation uses a copied schema/migration snapshot excluding only those empty directories. Production migration history must be checked separately before release.

## Verification and pilot gate

Implementation acceptance is not proof of clinical efficacy. Automated checks cover logic, request boundaries, replay/conflict behavior, privacy and compilation. An authenticated pilot must still test real browser/device recovery, passkey signing, tenant KMS, client consent, practice workflow, and clinician review of generated support. Measure note correction burden, time to signed note, recovery failures and missed follow-up commitments; do not treat usage time as a clinical outcome.

### Local verification ledger

- Web: 215 files, 1,770 tests passed. The standard run skips 29 database-only cases; those are exercised separately against disposable PostgreSQL, not a production database.
- Clinical logic: 24 files, 290 tests passed. LLM boundary/prompt tests: 17 files, 138 tests passed. Live gateway: 21 files, 280 tests passed using fake local WebSocket/model fixtures; the full suite required local socket permission. Final gateway typecheck and full lint passed.
- Real isolated PostgreSQL: the consent/reminder/counselling run passed 53 tests. After the final care-record ownership trigger was replayed, the counselling suite passed all six tests, including direct database rejection of cross-tenant and erased-client records. This uses fixture identity/KMS; it does not validate production authentication or cloud encryption.
- Contracts/clinical/LLM compilation, generated Prisma client, web/gateway typechecks, expanded web component/API lint and whitespace checks passed. The optimized web build passed, including route generation and type validation. Existing Next/Sentry configuration deprecation warnings remain; no configuration or runtime release was attempted.
- Migration guard: 21 tests passed; replay-safe DDL and PostgreSQL index-name limits passed. All four new migrations were applied to an isolated copy of the migration history; the final care-record trigger was replayed and tested separately.
- Actual browser walkthrough with explicitly fictional local records: manual note save/full reload, care agreement version save/full reload, and partial PHQ-9 save/close/full reload/resume passed. Partial answers did not create a scored result. A narrow care-overview layout was inspected. No microphone, signing, sending or real model calls were used.
- The final live-context review found and corrected a queued-output revocation gap. Background replacement/removal clears derived prompt carryover; the browser removes derived suggestions while retaining clinician-carried safety/context and raw words. Gateway outputs are tied to the originating context authority, including the final send boundary. This is an authorization safeguard, not clinical validation of generated advice.

### Remaining release checks

- This is local implementation only: no commit, push, merge, production migration or deployment was performed.
- Use the canonical `http://localhost:3000` origin in this local environment. Opening the same development server through `127.0.0.1` produced an origin mismatch on saves; the cross-site mutation guard was not weakened.
- Mobile questionnaire interaction, actual microphone/transcription latency, production sign-in/passkeys, cloud KMS, generated-support quality and real clinician/client suitability remain unverified.
- Historical safety indicators retain their existing latest-completed-visit age-out policy. The new note/draft source labels improve continuity but are not a clinician-reviewed resolution lifecycle; validate this policy with the pilot clinicians.
- New schema models showed no remaining model/SQL drift in the isolated comparison. Existing reminder-provider column/default and historical index-name differences remained in that fixture. Reconcile actual production history, these existing differences and the two empty local migration directories in a separate release preflight; do not blindly apply a generated schema diff.
- Reviewed live background remains disabled until both the web and standalone gateway are released together with the new acknowledgement/capability-clear protocol.
