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

## Necessary differences and bounds

- Source's fan-out is 20 per batch. Hosts supply one owner-wide bound
  (`nativeReadConcurrency`, 1 to 64, default 4) because a Cloudflare Worker
  invocation has few simultaneous outbound connections and concurrent roots
  share them. The bound covers overlapped fetches only; sequential reads and
  saves keep their existing connection use.
- A prefetched read may be unused when an earlier row fails first or native
  normalization changes a key. Its I/O is bounded by the batch the caller
  already submitted. Retained pages are uncharged and live only until the next
  batch call or the end of the transaction, at most that batch's slots times one
  capture page each; the ordinary consumer still charges every read it uses.
- Defects are not reordered to their sequential position: a defect raised by a
  speculative read propagates when the batch starts, ahead of an earlier row's
  typed failure. Persistence and driver failures are typed, so this affects only
  bugs or corruption.
- Admission-time revalidation, pending overlays, duplicate-in-batch detection
  through pending indexes and commit settlement are unchanged.

## Witnesses

Driver-independent owner witnesses: `test/core/indexSnapshot.test.ts` (per-slot
order, isolation, serial fill, permit admission and per-call bound) and
`test/core/nativeTransaction.test.ts` (observation and usage parity with a
sequential control, competing commit after prefetch, duplicate keys, batch
replacement, no prefetch without a host bound). The genuine Medusa consumer
suites and the paired benchmark exercise PGlite and ordinary-role PostgreSQL.
Not yet witnessed: the owner-wide bound across concurrent transactions and the
out-of-retention consumer rejection, which fails closed to an ordinary read.
