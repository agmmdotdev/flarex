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

A command or root transaction keeps the persistence snapshot its latest capture
opened. A later capture of that transaction that selects the same timestamp and
the same registry takes it instead of opening another; any other selection opens
its own, which replaces it. Every capture still selects the published snapshot
and write log, checks the owner, the transaction's authority at the current and
the selected registry and the leader retention floor for the selected timestamp,
and builds its own index snapshot; every read through the kept snapshot still
validates retention itself. Nothing is kept after a capture that fails, dies or
is interrupted, nor after the transaction closed. The pinned transaction holds
one `DatabaseIndexSnapshot` over one persistence snapshot for its whole lifetime
(`crates/database/src/transaction_index.rs::TransactionIndex`); here only the
opened snapshot of an unchanged timestamp is shared, never a result. The kept
snapshot's unconsumed first pages of its latest `preload` stay with it, so an
identical later scan at that timestamp may consume one, as within one capture.

## Replacement

Inside the transaction owner only, a known batch of complete rows or identities
(private event family rows, `writeRows`, `deleteRows` and `lifecycle` identities)
first fetches its distinct, not yet captured slot intervals through one
`rangeBatch` on one fresh capture. That phase records no dependency, charges
nothing, reserves no identity, remembers no row or slot and drops every typed
failure, overflow or incomplete page; defects and interruption propagate. Each
batch call replaces the previous batch call's unconsumed pages.

One batch call fetches the slots of all its groups on one capture and in one
`rangeBatch`, so groups with a single slot each (the three private event family
rows) share one statement.

A framework adapter still cannot reach the seam. A native commerce context offers
`announce({ finds?, inserts? })`: before the calls themselves, the adapter
announces, by its own table names, the finds that follow (each the table and the
query its later `find` or `count` receives) and the complete rows of one graph
insert in table insert order. The host that holds the issued facade authenticates
the context without a call charge, translates the table names, captures the
queries and rows without charging them (the call that follows captures and
charges them) and forwards them to the seam as one plan (`planCoreNativeSlots`).
It prepares each announced query through the read's own preparation and derives
its native find conditions through the read's own derivation
(`coreNativeRelationalFindWheres`), one per selection. A table it does not hold,
or a query the read would refuse, ends that list there. A read request may
announce finds only: announced inserts are refused as `invalidAuthority`.

The host forwards a query's conditions only whole. It admits queries in announced
order while all conditions of each fit the 256 finds Core examines of one
announcement, and ends the list at the first query that does not fit, without
capturing or preparing anything after it; a query without a condition takes one
place. Core would cover a query forwarded in part only in part, and that query's
read would then issue a second batch for the rest. One relational read holds at
most 256 selections (`relationalReadLimits.filterOperands`), so a query alone
always fits. With fewer than two conditions and no insert the host does not call
the seam: one find has nothing to share a statement with, and Core keeps what it
holds of the previous announcement.

The transaction owner plans finds first, in announced order. Each find resolves
its table through the announcing access's read authority and derives, through the
same owners the ordered find uses (`captureCoreNativeWhere`,
`planCoreNativeQuery`), the unique or range slot that find captures first. A find
with any other plan, an unreadable table and a derivation failure plan nothing.
At most 256 finds of one announcement are examined; the rest read in place. Graph
inserts follow as before: each table resolves through the writer's own authority
and write access and plans the identity and unique slots of whole tables, in
order, while they fit 1,024 slots counted before duplicates are removed; planning
stops at the first table that does not fit. All announcements of one transaction
together plan at most 4,096 slots, finds included. Past either bound an
announcement is truncated at the first item that does not fit; it is never an
error. Every planned slot, of every table, is read in one batch. The transaction
bound can still end the finds inside one query, whose read then batches the rest
itself.

A find whose slot the previous announcement planned, and whose page is still held
unconsumed under the current drop generation, keeps that page: the slot is not
read again and is not counted again in the 4,096. This is how an adapter keeps a
read that is still to come across a nested announcement: it announces it again,
and a find it no longer announces loses its page as before. The kept page stays
with its own, older timestamp, which the consumer's write log proof below covers
like any other, and is held again under the new announcement's registered find
set before the batch is issued, so a write staged to its table ends it. A kept
find still counts among the 256 examined, and its derivation is the new
announcement's, under the same rules as any other. An insert slot's page is kept
only when a find announced again derives the same slot.

An announced page is only a physical first page keyed by its index and interval.
The ordered find that derives the same slot takes it through the unchanged
consumer below, so its dependencies, charges, visibility and pending-write
overlay are those of an unannounced find; a find of any other range, and every
find after the first consumer, reads in place or from the transaction's own
observation. A page nothing consumes records and charges nothing.

An announcement's derivations are kept as well, so the announced read does not
repeat them. None changes what a read does: each is the value its owner would
return again for the same input, and a read without one derives in full.

- The adapter issues an announced relation read with the query object it
  announced (same table, predicate object and order, no options of its own).
- The host keeps each announced query's capture and preparation by the announced
  query object, until its next announcement. A read handed that same object
  still captures and charges its input; when that capture equals the announced
  one, for the same table, it takes the kept preparation instead of preparing
  again. A query object changed since its announcement prepares what it says.
- One prepared query yields the same frozen condition objects for the same table
  definition each time (`coreNativeRelationalFindWheres`), so that read issues
  the very conditions the host forwarded.
- The transaction owner keeps, by the condition object itself, the captured
  condition and the unique or range plan it derived for an announced find. Only
  a condition that is frozen, with every range it holds frozen, is kept. The
  ordered find and a read batch handed that same object for the same table
  definition take them instead of capturing and planning again; the find then
  proceeds exactly as before. A derivation holds only while its table's
  announced find set is the registered one: the next announcement, every
  complete drop, a staged write to that table and the end of the transaction end
  it. Only an owner that reaches the seam can have a derivation kept, and only
  for a condition object it supplied; a find of any other object, an equal one
  included, derives in full.

Announced pages are retained as follows.

- One announcement replaces the previous one's unconsumed pages and coverage,
  except the pages of finds it announces again, as above.
- Read batches (a relational read's own selections) and ordinary finds keep them.
- Coverage is per insert table. A table is covered when a page of one of its own
  planned slots is held, or when its insert has no slot left to read (every one
  already observed by the transaction). A table none of whose own slots has a
  page, although its insert must read one, is not covered, whatever the same
  batch stored for finds and other tables: its insert starts its own batch, as
  unannounced, instead of reading each slot in place. That batch is an ordinary
  write batch and ends the announcement for the tables after it. A covered
  table's insert keeps the pages instead of starting a batch, until its announced
  rows were inserted.
- Every staged write to a table, whichever call stages it, drops the announced
  find pages of that table. This is deliberately wider than correctness needs: a
  transaction's own writes never change a committed physical page, and the
  pending overlay already supplies them.
- Every other write batch (an insert of a table the plan omitted, an event family
  insert, a replay, a reconstitution cohort and any non-insert write) drops every
  page and the coverage, as do a defect or interruption of the batch and the end
  of the transaction (finalize, finished read or abort).
- Each complete drop advances a drop generation. A batch records the generation
  it started under: a page whose generation is no longer current is neither
  stored nor served, so a batch still in flight when a drop passes leaves nothing
  behind. A table's announced finds are registered before the batch is issued, so
  a write staged to that table while the batch is in flight ends them the same
  way.

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
allocation or fail normalization keep their in-place reads. Slots of a normalised
insert row are derived from the normalised row itself, without a document capture;
a row the document codec later refuses may therefore have had its slots read.
Native relational
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
  already submitted. Retained pages are uncharged and live until the drops listed
  above or the end of the transaction: at most one batch call's slots, plus the
  current announcement's 256 find slots and 1,024 graph insert slots, one capture
  page each. The ordinary consumer still charges every read it uses. A defect from
  an announcement's speculative read propagates at the announcement, before the
  first announced call, and leaves no page behind. The announcement runs within
  the request deadline, so a refusal, defect or interruption there is retained as
  the request's failure like any native call's; a read-mode context that announces
  inserts is refused. Announcements are not counted as calls: after the
  transaction bound is spent Core reads nothing, and the announced queries and
  rows are still captured once, the queries only while they fit the 256 finds.
  Pages and coverage of an announcement whose calls never follow persist until the
  next announcement, a dropping write or the end of the transaction. The
  speculative reads precede the first announced call's preflight and byte charge,
  so a request refused at that call may already have read up to 1,280 slots.
- An announced find that a read-only host's PostgreSQL snapshot read serves
  instead (a full-set read) is simply never consumed.
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
reference check taking or rejecting its parent's planned page. Announced finds,
same file: finds of two tables and a graph insert in one uncharged statement with
results, charges, usage and observations equal to unannounced reads; nothing
recorded for an unconsumed find; a covered insert dropping only its table's finds
and an update dropping all, with the write visible to the find that reads again;
no page stored by a batch a drop passed in flight; pages kept across a read batch
and other finds; a find of another range read in place; the 256-find bound and
the truncating transaction bound; a reader's finds planned and its announced
inserts not; an announced condition's derivation taken by the find and the read
batch handed the same frozen object with results, charges, usage and observations
equal to announced conditions that are not kept, derived in full for an equal
object, another table and an object that can still change, and derived again after
a covered insert, an update and the next announcement; the first and the last
insert table of a mixed announcement left to their own batch when none of their
own slots stored a page; a find announced again keeping its held page with results,
charges, usage and observations equal to unannounced finds, that page dropped by a
write to its table before and after the repeating announcement, a carried page read
in place when another transaction committed into its interval after the page was
read, and kept pages not counted again in the transaction bound. Same file: a row the document codec refuses has its normalized
slots read, is refused as before and stages nothing; one transaction's captures
open one persistence snapshot per published timestamp, another transaction and
a later timestamp open their own, and a closed transaction opens none
(`nativeRootScenarios.ts` for the children of one root). Host seam: `test/core/nativeCheckpointScenarios.ts` (PGlite and
PostgreSQL): table translation, no call or byte charge, stopping at an unknown
table or a refused query, a read request's finds accepted and its inserts
refused, foreign, rollback-only and revoked contexts; an announced query prepared
once for the find handed the same unchanged object, and afresh for an equal
object, another table's store, a changed object and after the next announcement,
with equal results and charges; whole-query admission within the find bound, the
list ended at the first query that does not fit with nothing after it prepared,
and a lone find that asks nothing and keeps the held pages.
`test/core/nativeRelationalQuery.test.ts`: one
prepared query's frozen conditions per table definition. The adapter's
`population.test.ts` holds the announced query object reaching its read,
`replace-announcement.test.ts` the same for the replacement's selections,
`product-relation-read-statements.test.ts` a node whose five reads of sixty
parents exceed the find bound (four whole reads in one batch, the fifth in its
own, three statements against six unannounced), and
`logical-product-creation-workflow.test.ts` the exact statement and
first-page batch counts of one create.

Driver-independent owner witnesses: `test/core/indexSnapshot.test.ts` (per-slot
order, isolation, serial fill, one shared preload admission, permit admission and
per-call bound) and `test/core/nativeTransaction.test.ts` (observation and usage
parity with a sequential control for inserts and independent finds, competing
commit after prefetch, duplicate keys, batch replacement, no prefetch without a
host bound; the kept snapshot's key, repeated opening checks, retention refusal
and its end on failure, defect, interruption and close). `test/core/persistenceScenarios.ts` (PGlite and PostgreSQL) proves
preloaded pages equal ordinary scans across tombstones, absences and further SQL
pages, are consumed once and still fail after retention advances;
`previousRevisionSearchScenarios.ts` and `historyScenarios.ts` retain ownership,
checkout, cancellation and retention ordering for the single-statement lookups. The genuine Medusa consumer
suites and the paired benchmark exercise PGlite and ordinary-role PostgreSQL.
Not yet witnessed: the owner-wide bound across concurrent transactions and the
out-of-retention consumer rejection, which fails closed to an ordinary read.
