# PostgreSQL-backed timestamped cache refresh

Design status: **Accepted bounded translation contract; activation requires
writer and connected-consumer proofs**. Implementation status: **Unstarted**.
Measurement status: **Unmeasured**.
Owner: [timestamped cache-transfer slice](../slices/02-timestamped-cache-transfer.md).
The related [query handoff record](./query-cache-transfer.md) owns concurrent
checkout, consumption and receiving-budget adaptation.

## Pinned mechanism and current-owner challenge

At Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`,
[LogReader::fast_forward_index_cache](../../../../../../crates/database/src/write_log.rs)
applies index writes carrying old/new keys and the new document over exactly
`(begin, end]`, drops unavailable indexes and returns no cache when log coverage
is unavailable. Its `index_keys_from_full_documents` derives those writes from
full old/new document inputs through the
[index registry](../../../../../../crates/indexing/src/index_registry.rs)
derive old/new keys, including unchanged keys with changed document bodies.
The [backend cache](../../../../../../crates/indexing/src/backend_in_memory_indexes.rs)
applies these changes only to already complete intervals and clears on capacity
failure. The source pin and active caller are recorded in the owning slice.

Independent source agents found an actual reusable Flarex publication/feed path,
but no ready full-document refresh API. Current
[commit-feed capture](../../../../packages/persistence-postgres/src/commit/commitFeed.ts)
checks contiguous headers and fact-to-revision identity; it returns row identities
and has no upper target. Its observed head can be newer than the admitted query.
Separate feed and row fetches would also permit history compaction between them.

## Why and how persistence differs

PostgreSQL is the accepted sole durable authority. The current trusted producers
already publish app-row identities and data atomically; replacing that protocol
with an in-memory full-document log is a larger commit/publication slice. Reuse
the sound durable owners here, with one protected reconstruction adapter, rather
than pretending identity facts are already Convex's document log.

Capture exactly `(cachedS, admittedS]` under one authority/history-protected read.
Reuse `readCommitFeedPageInTransactionV1Effect`, whole-commit continuity and the
historical row decoders. Hydrate the old row at `commitSeq - 1` and the new row
at `commitSeq`, preserving absence, tombstones, reinsert and canonical revision
evidence. Never advance to a later observed head or reuse latest-row fallback.
Prefer the existing snapshot-open transaction; no database transaction spans
Worker execution or user callbacks.

Require cached S at or above the retained row-history floor. The feed alone can
accept `floor - 1`, but old-body reconstruction cannot assume that older state
survives. Bound headers, changes and hydrated data by the owning admitted reuse
capacity. Missing history or exhausted reuse capacity discards the candidate;
corruption, SQL failures and interruption keep their typed classification.

Match scope/generation/epoch and relevant definitions. Prune unavailable or
changed index identities instead of invalidating unrelated definitions by an
unrelated global schema stamp. Retain fresh selection, grant, history and build
checks until the separately proved versioned-owner protocol can replace them.
Fixed data timestamp alone supplies no such authority.

## Writer boundary and consequences

The owning slice records supported point, finite, CMS, logical-commerce and
cross-domain publishers: documents, row facts, headers and clock advance share
the trusted outer transaction. Index-only reference/backfill writers derive keys
from those canonical row values and retain their eligibility restrictions.
Physical relational caches are excluded.

The runtime role intentionally retains ordinary business DML. Database privileges
do not enforce every revision's converse fact. Supported trusted API closure and
confinement of raw SQL/transaction capabilities are therefore part of the proof.
Arbitrary operator SQL and direct fixture injection are outside the coherence
contract. Maintenance/reset paths must cross the real generation/epoch boundary
or discard reuse; do not invent a second writer authority in the adapter.

This adaptation adds feed and old/new history statements where Convex reads its
in-memory write log. Unchanged timestamps can avoid refresh work; busy writes
may make cold execution cheaper. Record actual statement/body counts and compare
complete query operations before claiming an improvement. The source-backed
closure is not a measured throughput claim or production activation proof.

## Implementation and required evidence

Planned owners are the existing commit-feed/history storage family and the
portable data-cache owner, connected at actual Application snapshot admission.
Migrate selected construction and refresh callers; avoid another independent
transaction lifecycle or an adapter-side copy of publication validation.
No schema change or data reset is implied by this record.

Prove target bounding with a newer publication, protected retention, missing
history, epoch/fence changes, genuine producer writes and same-key body updates
on PGlite and ordinary-role PostgreSQL. Preserve exact failure behavior and
existing authority/build/accounting witnesses. The owning slice supplies the
remaining handoff, host, performance, review and cleanup gates. Runtime remains
unstarted; add exact executing symbols after implementation.
