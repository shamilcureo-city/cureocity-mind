# Mind recorded-work history

14 September 2026. Local recorded-work history implementation; not released or
clinically validated. The existing uncommitted UX batch is preserved.

## Purpose and design

Help a psychologist prepare from what they explicitly recorded across visits,
without adding another dashboard or presenting guide navigation as therapy.
Keep the established lavender paper `#f4f5fc`, white surfaces, ink `#232339`,
iris `#6659c9`, warning amber `#815600` and saved forest `#22734c`.
Use Fraunces for the main heading and Inter for readable clinical text.
Left-aligned, bounded reading width; native disclosures and visible focus.

```text
Existing care context
  Work history (optional, loads on opening)
    Most recently recorded visit → work → client response → source visit
      Earlier saved wording (optional)
    Another recorded visit
    Load earlier records / refresh
```

Review against the brief: this is a clinical reading aid, not a progress score or
complete attendance record. Sort by recorded change, label the visit's scheduled
date separately, and keep previous wording out of the primary reading path.
Loading data is not confirmation, editing, signing, sharing or a provider call.

## Bounded engineering scope

- Read-only projection from existing immutable encrypted care records; no new
  table, backfill, migration, clinical content, capability grant or AI context.
- Collapse unchanged inherited work across consecutive care-record versions;
  preserve genuine changes and source version/date. Group by source visit in UI.
- Bounded, descending version pages fixed to one snapshot; no unbounded decrypt
  scan. Missing/unreadable boundaries cannot silently claim complete history.
- Same therapist/owner/client lifecycle and dual-capability checks as care-record
  reads. Private responses, metadata-only access audit, no body logging.
- API returns work fields only, not the rest of the care record. Existing export
  and erasure remain authoritative because no second clinical store is created.
- Read on explicit opening. Key/validate every page to client and snapshot;
  handle retry, stale replies, changed clients, empty pages and access loss.

## Verification plan

Contracts: strict query/page validation and cursor relationships.
Projection: inherited duplicates, corrections, older-visit edits, page boundaries,
legacy absent work, snapshot stability, and unreadable/missing records.
Route: both capabilities, vertical/owner/erasure, bounded reads, source-visit
scope, no clinical writes/provider calls, private headers and minimal audit.
UI: lazy load, grouping, previous wording, append/retry, empty vs partial history,
client/snapshot binding, abort/unmount, keyboard and narrow-screen fictional preview.

## Remaining boundaries

This is recorded-work history, not an attendance or intervention event ledger.
Guide-content/version linkage, reviewed insertion into notes, full source
attribution, clinical pathway approval, authenticated runtime checks and a
separately approved release remain outstanding.

## Implemented behavior and integration

- `GET /api/v1/clients/[id]/session-work-history` reads at most 25 versions plus
  one predecessor. The predecessor identifies whether a section was copied
  forward or actually changed. Cursor pages are fixed to the initial version;
  new writes cannot move that snapshot while older records are being read.
- Every source visit must match the same owner and client. Gaps, unreadable
  ciphertext, an unverified source or a failed access audit return unavailable,
  never a silently incomplete successful page. Both existing capabilities and
  the client lifecycle lock are retained. No clinical text appears in the view
  audit. The API returns only work text, response, disposition and source dates/
  versions, not the other care-record sections.
- `MindWorkHistory` opens on demand from the client record and from the optional
  session work task. Prepare links to the client's history. Doctor client pages
  retain their existing redirect; the new API also rejects the Doctor vertical.
- The latest loaded wording for each source visit stays primary; older changes
  are under **Earlier saved wording**. Sorting is by recorded change, not
  attendance. Opening a source visit is navigation only, not restoration of
  historical wording to an editable draft.
- Empty intermediate pages still offer earlier records, with explicit feedback.
  Network failures hide the prior page until a validated retry succeeds; access
  denial and invalid pages clear it. No clinical browser storage is introduced.
- Browser testing caught lost paging focus. Continuation loads now announce and
  focus the result; failures focus the error. Closing the disclosure prevents
  a late response from pulling focus into hidden content.
- The existing encrypted full-version export and client erasure remain the
  sources of truth. No shadow database, schema migration, guide identifier,
  automatic note insertion, AI call or clinical decision is added.

## Browser evidence

Tested the development-only, closed-transport `/dev/mind-work-history` fixture:
initial disclosure, several visits, an older-visit correction, empty intermediate
page, earlier-wording disclosure, final page, no-records and unavailable states.
The newest wording stayed primary after appending an older version. A missing
client response explicitly remained unknown, not improvement. At 390px width,
expanded history had no horizontal document overflow. Normal viewport restored.
The fixture does not exercise an authenticated database, a real client or model,
nor does it establish a full accessibility audit or psychologist acceptance.

## Final local verification

14 September 2026, Node 22.23.2, after the paging-focus fixes:

| Check                                    | Result                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Full web suite                           | 270 files; 2,430 passed, 37 explicitly skipped                                        |
| Full contracts suite                     | 40 files; 487 passed                                                                  |
| Web typecheck and contracts build        | Passed                                                                                |
| Scoped ESLint, formatting and whitespace | Passed                                                                                |
| Fictional browser                        | Paging/corrections/empty/error/focus/reflow checks passed; no console errors observed |

The 2,917 passing tests are suite totals. This slice adds 109 regression cases:
27 contract, 34 server/route, 26 client protocol/transport, 14 UI-handler and
8 integration/preview-boundary cases. The 37 skipped tests require opt-in
database-backed execution and were not passed. Database and tenant decryption
responses are mocked in the new route tests; handler harnesses are not a browser
or screen-reader substitute. Browser evidence above uses the actual component
with a closed fictional transport.

No production web build, live database concurrency/erasure exercise, authenticated
preview, real device/audio/model session, account activation, commit, push, merge,
migration or deployment was performed for this slice. No production state was
changed. It remains uncommitted over `501754fc61ab1e40f25dce8edd6548d7b6ba02e9`
on `codex/mind-product-release-20260913`, alongside the prior UX candidate;
older PR checks do not verify this combined candidate. The unrelated
`docs/MIND_SCRIBE_DELIVERY_SPRINTS.md` was preserved.
