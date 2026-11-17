# Overlapped independent native slot reads

Design status **Accepted for the selected slice**. See the
[owning slice](../slices/native-read-batches.md).

## Pinned mechanism

Convex `db914cf06e2b06ee985646611b9e12ed7a770318`
`crates/indexing/src/database_index_snapshot.rs::range_batch` fetches the cache
misses of independent requests concurrently (`buffer_unordered(20)`), keeps one
result slot per request in input order, isolates each slot's error and fills the
transaction cache serially after the concurrent phase. Its callers
(`crates/database/src/transaction_index.rs::range_no_deps`, `query/mod.rs`
`query_batch_next_`) record dependencies, sizes and counts only for consumed
results, in request order, after fetching. Every read of a transaction uses one
begin timestamp. Convex inserts read nothing from persistence: generated IDs are
checked once, batched, at commit (`committer.rs::check_generated_ids`).

`CoreIndexSnapshot.rangeBatch` translates `range_batch` directly. Its single
request path remains `scan`.

## Why native slots differ

Native unique constraints have no Convex counterpart. Each native insert or
identity lookup captures a unique slot from persistence before the native call
continues, because the framework's duplicate failure, its position and the
hooks before it are observable native behavior; moving that check to commit
would change failure order and classification. Direct native commands also
re-select the latest published snapshot on every capture
([direct native read visibility](./native-direct-read-visibility.md)), so the
reads of one batch call need not share a timestamp. Measured Product roots
awaited about one hundred of these absence probes one at a time.

## Replacement

Inside the transaction owner only, a known batch of complete rows or identities
(private event family rows, `writeRows`, `deleteRows` and `lifecycle` identities)
first fetches its distinct, not yet captured slot intervals through one
`rangeBatch` on one fresh capture. That phase records no dependency, charges
nothing, reserves no identity, remembers no row or slot and drops every typed
failure, overflow or incomplete page; defects and interruption propagate. Each
batch call replaces the previous call's unconsumed pages.

One batch call fetches the slots of all its groups on one capture and in one
`rangeBatch`, so groups with a single slot each (the three private event family
rows) share one statement.

A framework adapter still cannot reach the seam. A native commerce context offers
`prefetchInserts`: the adapter announces the complete rows of one graph insert, by
its own table names and in table insert order, immediately before those inserts.
The host that holds the issued facade authenticates the context without a call
charge, translates the table names, captures the rows without charging them (the
write that follows captures and charges them) and forwards them to the seam. The
transaction owner resolves each table through the writer's own authority and write
access and plans the identity and unique slots of whole tables, in order, while
they fit 1,024 slots counted before duplicates are removed; planning stops at the
first table that does not fit. All graph inserts of one transaction together plan
at most 4,096 slots. The planned slots are read in one batch. Only a batch that
stored a page covers its tables. A covered table's insert keeps the pages instead
of starting a batch, until its announced rows were inserted. Every other batch
call, an insert of a table the plan omitted, a replay, a reconstitution cohort and
any non-insert write drop the pages and the coverage, as do a defect or
interruption of the batch and the end of the transaction (finalize, finished read
or abort).

The unchanged sequential consumer still performs its own `nativeCapture` with
its authority, metadata and index observations, then all accounting,
reservation, remembering and conflict checks in the original order. It uses a
prefetched physical page, at most once, only when the page is not newer than its
capture, the entries fit its capture limit,
and its capture's committed write log proves that no write touched the interval
after the prefetch timestamp. The consumer therefore observes exactly the page a
fresh read at its own timestamp would return. Any other case reads in place.

Event staging reaches the prefetch through a module-private seam keyed by the
issued operations object. `CoreNativeOperations`, which framework adapters
receive, gains no method.

Insert batches in `writeRows` also prefetch each complete row's unique-constraint
slots from the row's pure managed normalization, so the eligibility columns the
staging check uses (for example `deleted_at`) are present. Rows that need serial
allocation or fail normalization keep their in-place reads. Native relational
reads with several independent selections (for example `id IN (...)`) prefetch
each selection's unique or range slot before their ordered finds, through the
same module-private seam (`nativePrefetch.ts`).

## Batched transport

Source fetches the misses of `range_batch` as concurrent persistence futures and
pipelines previous-revision groups on one checkout. The pg client does neither:
each statement waits for the previous one. Two transport changes keep every
per-request predicate and result unchanged:

- `CorePersistenceSnapshot.preload` fetches the first SQL page of each bounded
  ascending miss of one `rangeBatch` in a single lateral statement at the
  snapshot timestamp. The identical later `scan` consumes that page once instead
  of issuing its first statement; further pages, unbounded or descending scans,
  index-cache verification and population are unchanged. Rows at a fixed
  timestamp cannot change, and the scan still validates retention after the
  page. A typed preload failure leaves every scan to report its own outcome;
  defects and interruption propagate. The preload takes one owner-wide permit.
- `previousRevisions` and `previousRevisionsOfDocuments` send their exact lookups
  as one lateral statement of at most 1024 lookups instead of eight-way groups and
  single remainders. Ownership, one checkout without a SQL transaction,
  correlation checks, cancellation draining and the retention check after every
  lookup has settled are unchanged.

`rangeBatch` runs its fetches on lanes rather than one fiber per request: each lane
claims the next request in input order, the first starts at once, and another is
forked only while earlier lanes wait on persistence with requests unclaimed.
In-flight fetches stay within the host bound; per-slot order, isolation and serial
fill are unchanged.

## Necessary differences and bounds

- Source's fan-out is 20 per batch. Hosts supply one owner-wide bound
  (`nativeReadConcurrency`, 1 to 64, default 4) because a Cloudflare Worker
  invocation has few simultaneous outbound connections and concurrent roots
  share them. The bound covers overlapped fetches only; sequential reads and
  saves keep their existing connection use.
- A prefetched read may be unused when an earlier row fails first or native
  normalization changes a key. Its I/O is bounded by the batch the caller
  already submitted. Retained pages are uncharged and live until the next batch
  call that is not a covered table's insert, or the end of the transaction: at
  most one batch call's slots, or 1,024 planned slots after an announced graph
  insert, one capture page each. The ordinary consumer still charges every read it
  uses. A defect from a planned table's speculative read propagates at the
  announcement, before the first table insert, and leaves no page behind. The
  announcement runs within the request deadline, so a refusal, defect or
  interruption there is retained as the request's failure like any native call's;
  a read-mode context is refused. Announcements are not counted as calls: after
  the transaction bound is spent Core reads nothing, and the announced rows are
  still captured once. Coverage is granted per batch, not per table. Pages and
  coverage of a graph whose inserts never follow persist until the next batch call
  or the end of the transaction. The speculative reads precede the first table's
  preflight and byte charge, so a request refused at its first write may already
  have read up to 1,024 slots.
- Defects are not reordered to their sequential position: a defect raised by a
  speculative read propagates when the batch starts, ahead of an earlier row's
  typed failure. Persistence and driver failures are typed, so this affects only
  bugs or corruption.
- Admission-time revalidation, pending overlays, duplicate-in-batch detection
  through pending indexes and commit settlement are unchanged.

## Witnesses

Graph inserts: `test/core/nativeInsertGraphScenarios.ts` (PGlite and PostgreSQL):
one uncharged statement with results, charges, usage and observations equal to
per-table batches; competing commit after the prefetch; both slot bounds; unknown,
private and unwritable tables; no coverage without a stored page; defect and
interruption; pages dropped by an update and by a reconstitution; a statement
reference check taking or rejecting its parent's planned page. The adapter's
`logical-product-creation-workflow.test.ts` holds the exact statement and
first-page batch counts of one create.

Driver-independent owner witnesses: `test/core/indexSnapshot.test.ts` (per-slot
order, isolation, serial fill, one shared preload admission, permit admission and
per-call bound) and `test/core/nativeTransaction.test.ts` (observation and usage
parity with a sequential control for inserts and independent finds, competing
commit after prefetch, duplicate keys, batch replacement, no prefetch without a
host bound). `test/core/persistenceScenarios.ts` (PGlite and PostgreSQL) proves
preloaded pages equal ordinary scans across tombstones, absences and further SQL
pages, are consumed once and still fail after retention advances;
`previousRevisionSearchScenarios.ts` and `historyScenarios.ts` retain ownership,
checkout, cancellation and retention ordering for the single-statement lookups. The genuine Medusa consumer
suites and the paired benchmark exercise PGlite and ordinary-role PostgreSQL.
Not yet witnessed: the owner-wide bound across concurrent transactions and the
out-of-retention consumer rejection, which fails closed to an ordinary read.
