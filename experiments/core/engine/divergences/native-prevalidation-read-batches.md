# Mechanism: batched first pages in native commit prevalidation

Design status: **Accepted**.
Implementation status: **Implemented**.
Measurement status: **Required gates unmet**; local load only.

## Ownership and decision

- Owning slice: [Native prevalidation batches](../slices/native-prevalidation-batches.md).
- Owner: `prepareCoreNativeIndexes` in `packages/persistence-postgres/src/core/nativeValidation.ts`.
- No unresolved guarantee. No durable data or public contract changes.

## Pinned Convex mechanism

- Revision: `db914cf06e2b06ee985646611b9e12ed7a770318`.
- `crates/indexing/src/database_index_snapshot.rs::range_batch` fetches independent
  misses concurrently, keeps one result slot per request and isolates each error.
- `crates/database/src/committer.rs` has no index-page scan during validation. It
  checks read sets against the published suffix; generated IDs are point lookups.

Convex therefore has no direct counterpart to this pass. The pass itself is recorded
in [Exact pages in native admission](./native-admission-exact-pages.md).

## Current core and proposed direction challenge

- Under load the published timestamp moves on each commit, so exact-timestamp cache
  pages miss and every observation became its own round trip.
- Reusing pages across timestamps stays rejected, and verification stays at 100%.
- Both challengers accepted batching if the preload is advisory, filters stale
  indexes without failing, and uses the loop's exact page size.
- A preload that propagated typed failures, or hoisted the generation check, was
  rejected because it could change which error a transaction reports.

## Why a difference is necessary

Flarex's native integrity pass has no Convex equivalent, and one TCP round trip per
observation is the cost being removed. Bare `range_batch` slot handling is not
needed because the ordered loop still performs every scan and reports every error.

## Replacement mechanism and implementation

`advisoryPreload` is shared with `CoreIndexSnapshot.rangeBatch`. Before the loop, the
first page of each current observation is requested once at the pass's snapshot. Each
scan consumes its page by exact request identity and still validates retention. A
typed batch failure drops the batch, and a defect or interruption propagates. A pass
with more than 1,024 observations scans in turn, so one statement stays bounded.

## Preserved and changed guarantees

Preserved: results, refusal order, generation checks, retention validation, capacity
limits and verification. Changed: a batch failure may issue one extra statement before
the loop reports the same outcome.

## Required witnesses and remaining limits

- `test/core/nativeIndexValidation.test.ts` covers exact request identity, a stale
  index left to the loop, a single observation, typed failure and defect propagation.
- A batch defect from a slot the loop would not have reached still stops the committer.
- Foreign-key probes remain sequential, about 10 round trips per Product create at
  concurrency 16. Batching them needs a failure-tolerant pre-walk.
- Refresh iterations still rescan. Folding the write-log suffix over a prepared result
  is a separate design, and the log keeps keys only today.
