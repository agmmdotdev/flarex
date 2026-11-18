# Exact range completion evidence

Status: **Newly executed range evidence corrected; full pending milestone open**.
Owner: [pending-state replacement](./04-mutation-pending-state.md). This is its
first connected prerequisite, not completion of that milestone or the full goal.

Source checkpoint: Flarex `526182cf05c6f42a0aa874a12db31d80a7a9134c`; Convex
`84fbb0e70b4e857913673871cb847ad11a55f3d5`. The independent current-owner,
pinned-mechanism and replacement-boundary agents formed findings, then exchanged
and challenged the protocol, accounting, cache and stored-replay consequences.

## Current owner and correctness gap

[`appIndexEntries.projectRangePage`](../../../../packages/persistence-postgres/src/storage/indexes/appIndexEntries.ts)
already authenticates a fetched N+1 membership row but returns only N positions.
The finite and durable
[`indexedQueries`](../../../../packages/persistence-postgres/src/execution/journal/indexedQueries.ts)
producers compensate for staged rows, suppress their old positions, merge and
sort pending keys, then record a non-final dependency only through the last
returned row. A committed lookahead can affect exact `isDone` without appearing
in that evidence.

Example: snapshot `[A,B]`, limit `1`, returns `[A], false`. Deleting or moving B
can change that verdict while leaving the retained A point/prefix unchanged.
Preserve a failing acceptance witness using the real producer and a genuine
competing writer before changing the producer.

The [divergence record](../divergences/range-completion-evidence.md) owns why
Flarex retains its existing exact verdict and selected-body point evidence while
the pinned Convex paginator and write-log mechanism differ.

## Selected contract

1. Extend the internal `AppIndexRangePageV1` with required
   `lookahead: AppIndexRangeCursorV1 | null`, reusing the existing authenticated
   `{ encodedKey, rowId }` shape. The common projection retains `decoded[limit]`
   separately. `lookahead === null` exactly when the raw page is done.
   `entries` and `continueCursor` keep their current limit and last-returned
   position. Current, historical and batch readers use that same owner.
2. Keep existing N+S compensation, where S bounds staged identities. After
   suppressing at most S base identities, the extra fetched base position cannot
   enter the first N returned documents. Do not request a larger physical limit,
   add a query, hydrate its body or charge it as a user-visible document.
3. Finite and durable evidence producers merge the base membership lookahead
   with existing base/pending positions under the same suppression, tuple order,
   bounds and cursor. For a non-final logical page, retain the logical N+1
   position as the inclusive dependency frontier. This may conservatively extend
   through a pending witness; an optimization needs explicit provenance.
   Done pages retain the complete requested interval. Returned documents,
   continuation and logical document/byte accounting remain unchanged.
4. Preserve selected-body point evidence. Current same-key body writers can
   leave membership storage unchanged, so range evidence alone is insufficient.
   Keep existing metadata, grant, lifetime, replay, closure and settlement owners.
5. Synthetic complete native pages set `lookahead: null`. A membership-only
   witness or pending row must never expand shared cache coverage beyond its
   materialized bodies. Mutation cache reuse is not activated by this change.

No new service, transaction, settlement owner, decoder or parallel page engine
is selected. Replace the discarded-lookahead projection and insufficient
evidence frontier at their existing owners; migrate internal page constructors
and meaningful tests.

## Stored data and activation boundary

This changes newly produced evidence, not the database schema or saved receipt
format. No table, row, request identity or committed outcome is deleted.
Durable operation replay returns saved outcomes before running this producer;
stored range evidence and seals are checked for integrity, not semantically
recomputed against old pending state. The producer fix therefore does not repair
pre-fix open or sealed durable attempts. Requerying at a later pending state is
not a valid reconstruction.

Their explicit retention/migration and safe cutover belong to the parent
replacement before whole-engine activation. Do not introduce a global codec
bump, reject known committed outcomes or replay native hooks to hide this gap.
No production rollout or new execution profile is selected by this substep.

## Coordinated work and required proof

The storage worker owns the common membership-page contract/projection and its
direct reader tests. The dependency worker owns finite/durable frontier assembly
and the native complete-page constructor. They exchange the exact type before
dependent edits. The witness worker owns genuine native/CMS producer-writer-
acceptance regressions on the existing shared PGlite/PostgreSQL seam. The
coordinator owns records, exports/remaining constructor migration, validation,
resource cleanup and integration. Preserve foreign shared-worktree changes.

Required witnesses: deleting or moving a committed lookahead; true exhaustion
and phantom insertion; pending insert/delete/key moves and refill; a pending
lookahead; a selected same-key body update; unchanged page contents/cursors and
logical accounting; current/historical/batch and synthetic page invariants; and
cache coverage that does not advance from the membership witness. Use meaningful
existing owner/consumer regressions, both database lanes, scoped Oxc checks and
both final reviewers. [Incremental pending indexes](./04b-incremental-pending-indexes.md)
have their own bounded implementation. Old journal cutover and the real Standard
migration remain open parent gates.

## Executing owners and bounded proof

`projectRangePage` retains the decoded membership tuple separately from the
limited entries. Both `runFiniteIndexedQueryEffect` and
`runIndexedQueryInTransactionEffect` keep their existing sorted merged positions
and materialization loop. `indexRangeDependencyFromPage` compares their logical
extra position with the unshadowed raw lookahead and uses the earlier tuple.
This computes the merged N+1 frontier without another array, sort or body read.
The synthetic complete native page and exact-shape reader assertions use null.

The [shared native/CMS scenario](../../../../packages/persistence-postgres/test/frameworks/cmsTransaction/nativeCmsPublicationScenario.ts)
exercises newly executed durable evidence against real CMS deletion and bounded
key movement. The [finite scenario](../../../../packages/persistence-postgres/test/execution/journal/finiteIndexedQueriesScenario.ts)
uses genuine prepared admission, entry, journal, freeze and publication owners;
a second finite mutation commits its deletion before the stale proposal is
rejected. Both check unchanged durable inventory after refusal. The finite
fixture selects the existing bounded `finiteCapture` target transport; its
control database remains ordinary. No engine guard or timeout limit changes.

Direct readers cover current, historical and batched pages, tuple ties,
exhaustion and tombstones. Journal tests retain selected-only accounting,
unselected-body nonmaterialization, private pending refill and replay without
additional charges. Existing snapshot and actual DO scenarios retain their
cache-coverage and public-result contracts. Validation receipts belong in Git.
