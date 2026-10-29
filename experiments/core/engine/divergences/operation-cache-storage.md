# Operation-local cache storage in TypeScript

Design status: **Accepted implementation adaptation within the selected slice**.
Implementation status: **Connected Application operation-local reader implemented**.
Measurement status: **Complete-request performance unmeasured**.
Owner: the [first snapshot read slice](../slices/01-snapshot-reads.md).
This changes in-process representation and bounded memory accounting; it does
not change snapshot, authority, ordering or absence guarantees.

## Pinned mechanism and reason

At Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`,
[DatabaseIndexSnapshotCache and range_batch](../../../../../../crates/indexing/src/backend_in_memory_indexes.rs)
keep ordered documents per index and complete intervals. Bodies populate before
coverage. Lookup splits covered and missing components, limiting cached ranges
per request to three. Cache size charges canonical bodies through the by-ID
path; hitting capacity prevents false complete-range population.
[IntervalSet](../../../../../../crates/common/src/interval/interval_set.rs)
merges adjacent/intersecting intervals over ordered byte boundaries.

Rust's OrdMap/BTreeMap, packed documents, binary-key cuts and heap accounting
cannot be instantiated directly in the TypeScript runtime. Existing PostgreSQL
storage also orders a separate (encodedKey,rowId) tuple; changing its durable
format is unnecessary for this in-process cache. The adaptation preserves that
ordering rather than conflating a page cursor with an encoded-key prefix.

## Replacement and injection

Use a private portable ordered cache at the existing storage/index owner, with
one synchronous instance per operation. Supply a trusted key comparator and
document identity/size metadata. Async resource and cancellation ownership stays
in the existing Effect snapshot owner, whose read gate serializes use.

Use the published `sorted-btree@2.1.0` ordered collection in place of Rust
collections, through its named `BTreeEx` constructor at
`sorted-btree/extended/index.js`. The lean default export is wrapped as an object
by direct Node ESM; the published named subclass works in both that loader and
the bundler without a constructor fallback. Extra extended-entry bundle weight
remains a build/performance gate. Its [primary source](https://github.com/qwertie/btree-typescript)
documents ordered iteration/ranges and copy-on-write cloning. Direct Node ESM,
test-host loading and a browser-targeted bundle are checked; actual DO composition and complete
request costs remain wider-milestone gates. No performance equivalence is
inferred from that API. This is a library selection within the
authorized slice, not a new core package or general runtime registry.

Translate the interval merge/split and three-range fallback algorithm. Represent
cuts as before/after a generic ordered key, with unbounded ends. The reader
adapter maps SQL key bounds and full cursor positions into that same order.
For example, a page returning only (k,r1) must not claim that (k,r2) is absent.
Touching equal cuts may coalesce; before(b) and after(b) leave unknown b between
them and must not coalesce across it.

Charge distinct retained canonical bodies once; bound retained index entries and
coverage metadata too. Derive the initial limits from the owning operation's
admitted document/byte/read budgets. This does not claim exact Rust heap-size
accounting or replace logical-call/result budgets. Capacity refusal is a cache
miss, never an empty or partial successful query. Failed population must not
mark an interval complete; already retained point entries remain usable.

Seed any point reuse from validated typed row results, including actual document
revision and tombstone/no-visible-revision distinctions. Index membership's
commitSeq is not necessarily the hydrated body's revision. Retain the outer
snapshot's authority/history/build checks and result ownership on hits.

## Validation and completion gates

The paired pre-slice challengers identified duplicate encoded keys, lookahead,
unknown point gaps, capacity truncation and old index-membership revisions as
required counterexamples. Test the ordered component with those scenarios and
merge/split/three-range behavior. Then prove the real Application consumer,
logical accounting, closure, revocation, history and output ownership on PGlite
and ordinary-role PostgreSQL. Test the installed dependency under required
typecheck/lint/build and host portability gates.

The ordered component is at
[snapshotIndexCache.ts](../../../../packages/persistence-postgres/src/storage/indexes/snapshotIndexCache.ts)
with [pure scenario tests](../../../../packages/persistence-postgres/test/storage/indexes/snapshotIndexCache.test.ts).
The [Application snapshot owner](../../../../packages/persistence-postgres/src/application/applicationQuerySnapshot.ts)
now uses it for repeated points, completed ranges and exact tuple-cut misses.
Cached row handles detach output only when consumed; the handle privately captures
the typed revision once. Missing point evidence remains operation-local. The
actual query RPC carries existing diagnostic context so connected tests observe
data reads without introducing a business capability or alternate reader.

The selected direct-fetch bypasses are replaced; PostgreSQL readers remain the
authoritative miss path. Live authority/history/index-build checks and logical
accounting still run on hits. This intentionally retains their database work
until a separately challenged replacement proves the corresponding guarantees.
The historical snapshot reader gains tuple cuts through a forward managed
migration; its displaced private signature and callers are replaced without
rewriting historical migrations or deleting application data.

Shared page serving, app-lifetime invalidation, DO storage/restart, native
transaction changes and performance acceptance remain separate required slices.
This implemented operation-local adaptation does not close the wider milestone.

The [selected cache-transfer slice](../slices/02-timestamped-cache-transfer.md)
extends this owner through `SnapshotIndexCache.applyWrite` and `removeIndex`.
Immutable-timestamp `populate` remains a separate population operation.
The extension is implemented in the connected Application handoff path.

The pinned backend applies an index write at a time. This TypeScript owner
deduplicates bodies across indexes, so `applyWrite` groups all of one row's
old/new index positions: remove the old positions, replace its captured body
once, then insert only within already complete coverage. Private reference
counts release a body after its final retained index entry disappears and avoid
charging or replacing it repeatedly. This representation adaptation prevents
stale shared aliases and double body accounting; it is not a second manager.
`removeIndex` releases its entries, intervals and body references. Capacity
refusal clears reuse; inconsistent trusted deltas remain defects. Previously
materialized outputs retain their captured value.
