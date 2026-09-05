# Mind psychologist workspace — first implementation

Status: local implementation, 5 September 2026. Not deployed or clinically validated.

## The product experience

Mind is the psychologist product; Scribe remains the doctor product. The frontend-design guidance shaped a paper-and-violet visual system, clear reading hierarchy, progressive disclosure and deliberate navigation. Engagement comes from completing real documentation, never points for diagnoses, interventions, questionnaires or client outcomes.

The implemented path is **Today → prepare → session → note review → sign → explicit next-step decisions**.

- Today presents one next session, an open preparation brief, an accessible Start/Resume action, a compact agenda and a visible attention queue. Documentation progress counts signed, locked notes belonging to completed, non-demo sessions on today's agenda. It is not an assessment or clinical-quality score.
- The session workspace opens the note first. Review & Close owns signing; clinical context is available through `?tab=review`. AI note tools and sharing receipts are secondary disclosures. Signing, sharing, delivery and client opening remain different states.
- Live sessions default to Quiet focus. Guided mode reveals questions and threads progressively; all live safety cues remain visible. The transcript can be shown when needed. Guide watchpoints remain visible in Quiet when a guide has been selected. Suggestion “shown” audits track disclosed cards, not all model output; hidden and collapsed ordinary suggestions do not count as shown. Disclosure is not proof the clinician read or acted on a suggestion.
- Session guides are visible in the client's Plan of care, no longer buried in the tools drawer. A psychologist reviews an AI draft for suitability before using step-by-step navigation. Optional response branches, watchpoints and adaptations remain available. Advancing a section does not mark it reviewed; review markers are in-memory only and never imply delivered therapy, assigned homework or a clinical save.
- The live page can load up to five previously prepared guides, matched to the current plan and primary diagnosis IDs. Loading never generates guidance. These are previously prepared drafts, not a fresh recommendation based on the current conversation.

## Boundaries and implementation

The shell branches on the stored practitioner vertical, not the hostname. Mind typography, colours and navigation are scoped under `.mind-workspace-shell`; Scribe navigation and doctor review flow remain separate. Signing and sharing continue to use existing authenticated routes.

Guide generation now uses explicit POST to `/api/v1/clients/[id]/therapy-scripts` with the existing query schema. GET is cache-only and returns `THERAPY_SCRIPT_NOT_CACHED` on a miss. Both are private/no-store and enforce therapist/workflow capability, ownership and active-client boundaries. POST rechecks capability around the model call and atomically persists the script and audit under the existing active-client lock. The browser validates the returned contract and ignores obsolete responses after a different selection or close.

The live-note finalizer now preserves the note's actual risk severity instead of saving every therapist note as `NONE`. Crisis audit effects occur in the same transaction as the durable finalization; metrics follow commit. Existing clinical thresholds and model prompts are unchanged.

Key implementation files:

- `components/app/MindTodayWorkspace.tsx`, `MindTodayProgress.ts` and `MindTodayStudio.module.css`
- `components/app/MindSessionCloseout.tsx`, `MindSessionReviewHeader.tsx` and `NotesTab.tsx`
- `components/app/MindTherapyGuide.tsx`, `TherapyLibrary.tsx` and `TherapistLiveSession.tsx`
- `lib/mind-guidance.ts`, `lib/load-prepared-mind-guides.ts` and `lib/note-risk.ts`
- `app/app/mind-workspace.css` and `lib/practitioner-navigation.ts`

All paths above are relative to `apps/web`.

## Verification and local preview

The synthetic preview at `/dev/mind-workspace` renders the actual presentational components. It is available only when both `NODE_ENV=development` and `MIND_WORKSPACE_PREVIEW=true`; otherwise it returns 404. It has no recording, signing, database or model connection. Navigation and administrative actions are intercepted so a design check cannot operate on real records.

```sh
MIND_WORKSPACE_PREVIEW=true pnpm --filter @cureocity/web exec next dev --hostname 127.0.0.1 --port 3000
pnpm --filter @cureocity/web test
pnpm --filter @cureocity/web exec tsc --noEmit --incremental false
```

Use Node 22.12 or newer. Tests cover severity persistence, capability/erasure boundaries, cache-only GET versus explicit generation, prepared-guide filtering, truthful progress, Quiet risk visibility and Doctor navigation preservation. Database, gateway and model boundaries in these tests are mocked.

Final local check: 1,038 web tests and 284 clinical-package tests passed; whole-web TypeScript and changed-source ESLint passed. Formatting and whitespace checks passed for the new and edited implementation files. A production build and authenticated staging test were not run.

Browser checks cover the actual Today layout, the guide's suitability gate and independent review markers, keyboard focus continuity, responsive Today/guide layout at 390px, Quiet/Guided disclosure, and computed neutral/red/amber Card styles. This does not establish authenticated end-to-end recording or clinical correctness.

## What remains before a clinical release

1. Exercise authenticated Mind recording, interruptions/recovery, note edits/signing, guide generation/reuse, sharing and revocation against an isolated staging database and gateway. Recheck Scribe Clinic, live encounter and Review & Sign there. Do not use production clients as test fixtures.
2. Have qualified psychologists review and approve the protocol content, indications, exclusions, adaptations, source versions and licensing. The existing AI-generated guide engine is not a validated therapy manual; the new UI does not make it one.
3. Build evidence-based diagnostic support with explicit uncertainty, alternative explanations, missing criteria and source-linked ICD terminology. Keep diagnosis confirmation under practitioner control; no new diagnostic thresholds or automatic diagnosis were introduced here.
4. Add clinician-approved assessment pathways and questionnaire selection based on the case and client preferences, including a first-class counselling pathway without forcing a disorder diagnosis. This implementation does not add a complete validated questionnaire library.
5. Measure transcription accuracy, speaker attribution, multilingual note fidelity, unsupported note claims, correction burden and signing time using consented evaluation material. Add failure/load/accessibility testing and pilot with psychologists before any quality or superiority claim.
6. If guide use needs durable continuity, design consent-aware, tenant-scoped events that distinguish viewed, reviewed, selected and actually delivered. Current review markers deliberately do not persist or drive clinical outcomes.

The new guide does not include the old player's browser read-aloud controls. Evaluate an explicit, privacy-reviewed optional playback mode separately from microphone capture; do not silently play guidance into the recorded session.

This is the first integrated workflow and design layer, not completion of the full clinical product vision.
