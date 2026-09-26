# Scribe note-to-source comparison: local second milestone

## Problem and outcome

Doctors can already correct all seven medical-note sections before signing. The shared review
screen displays a transcript for incomplete capture, but complete drafts expose only model-supplied
evidence badges. Those badges are not proof that a quote exists in the saved source or supports an
edited statement. This milestone makes that distinction visible without adding another AI pass.

As a doctor, I can open the saved source beside the note, choose a clinical section, find its exact
linked words and retain that reference while correcting the note. Source refreshes must not replace
my unsaved corrections. Unreadable, missing and quarantined transcripts have different explanations.

## Scope and acceptance criteria

- A doctor-only, owned-active-patient read endpoint returns one saved draft/source snapshot. It uses
  the existing encrypted transcript decoder and artifact quarantine, with private no-store responses.
- Complete and incomplete saved Scribe drafts offer the same optional comparison. Mind is unchanged.
- Seven clinical sections can be selected. Quote matching preserves case, punctuation, negation,
  numbers and Unicode; only whitespace normalization is permitted, with original-text offsets.
- Found text is described as a located quotation, never a verified diagnosis or supported claim.
  Missing/absent quotes and multiple occurrences are explicit. Model timestamps are not audio proof.
- Edited sections retain original provenance with a warning that the reference belongs to the
  original draft. A refreshed different draft is not silently compared as if it were the original.
- The editor remains visible while comparing. Closing/reopening the comparison must not lose edits.
- Existing incomplete-capture, Rx, clinician signature and post-sign controls remain authoritative.
  Comparison is not a review receipt and does not clear a signing gate.
- No browser persistence, new AI request, database migration or deployment is part of this milestone.

## Design

Keep the existing clinical palette: white `#ffffff`, source background `#f6f6fa`, ink `#0b0c10`,
secondary text `#525965`, separators `#e3e5ee`, warning `#985516`. Use the existing Fraunces/Inter
roles. One left-aligned comparison frame places the editable note on the left and saved source on
the right; phones stack the panes. A highlighted exact quotation is the focal element, not a score,
decorative dashboard or clinical-correctness badge. Controls retain 44px touch targets and visible
keyboard focus. This reuses the current product's visual language rather than introducing a theme.

## Non-goals

Semantic contradiction/omission detection, automated clinical verification, audio playback or
timestamp verification, coding, extra generated documents, new templates, durable draft autosave
and production rollout are separate work. Clinician judgment may legitimately add information that
was not spoken; absence of a quote is not by itself evidence of an error.

## Validation plan

Unit tests cover exact/Unicode/whitespace matching, offsets, absent and repeated quotes, partial and
zero-valued vitals, schema validation and source identity. API tests cover ownership, role,
capability, deleted patients, incomplete generation, unreadable/quarantined/empty source and audit
minimization. UI tests cover section navigation, edited/stale drafts, loading/retry, stale replies,
unmount/session changes, retaining edits and unchanged capture/sign safety. A fictional local
preview supports desktop/mobile visual checks without patient data or clinical API calls.

Pilot success targets are hypotheses, not measured results: clinicians can locate an available
linked quote without leaving review, notice deliberately missing references and retain corrections
through source refresh. Timing and clinical usefulness still require observed clinician testing.

## Local verification completed

- Full web suite on Node 24.19.0: 313 test files passed; 2,951 tests passed and 44 opt-in database
  tests skipped. Database integration was not exercised by this run.
- Web TypeScript check, scoped ESLint, formatting and diff whitespace checks passed.
- Fictional preview at `http://127.0.0.1:3000/dev/scribe-source-review`: desktop and 390px mobile
  layouts inspected; typed corrections survived closing/reopening comparison and remained intact
  after source changes. Exact quotation highlighting and absent-quote warnings were checked.
- Changed-draft warnings suppress matching against the wrong baseline. Source warnings remain
  visible even when transcript text is available. Neither comparison nor refresh approves an
  incomplete capture or changes signature requirements.
- No production build, authenticated clinical-record walkthrough, real-device consultation or
  clinician validation was completed for this milestone. No migration or deployment was run.

## Release boundary

Local implementation and automated checks are not clinical validation. Before enabling a released
workflow, test authenticated saved encounters and obtain clinician review of the comparison labels
and editing flow. The separate video milestone still requires its database and real-device checks.
