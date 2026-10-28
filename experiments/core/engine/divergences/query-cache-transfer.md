# Completed Application query cache handoff

Design status: **Accepted bounded translation contract; activation requires the
owning slice's writer, history and consumer proofs**.
Implementation status: **Unstarted**. Measurement status: **Unmeasured**.
Owner: [timestamped cache-transfer slice](../slices/02-timestamped-cache-transfer.md).
The full [goal](../GOAL.md) authorizes connected implementation within settled
guarantees. No durable-data reset, native replay or authorization weakening is
selected by this record.

## Pinned mechanism

Reference: Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`.
[Transaction::into_token_and_index_cache](../../../../../../crates/database/src/transaction.rs)
returns `TimestampedIndexCache`; the active
[scheduled-jobs caller](../../../../../../crates/application/src/scheduled_jobs/mod.rs)
takes the previous cache, fast-forwards it and begins with the refreshed cache.
It consumes the readonly transaction before retaining its cache, then drops the
idle cache after its configured transaction window.
[LogReader::fast_forward_index_cache](../../../../../../crates/database/src/write_log.rs)
requires complete `(begin, end]` log coverage, drops unavailable indexes and
applies writes. Missing retained log returns no reusable cache.

[DatabaseIndexSnapshotCache::apply_write](../../../../../../crates/indexing/src/backend_in_memory_indexes.rs)
removes the old key, inserts the new body only inside previously complete
coverage, preserves proven intervals and clears reuse on capacity failure.
Same-key body changes still generate updates through
[IndexRegistry](../../../../../../crates/indexing/src/index_registry.rs).
The pin's shared page reader remains a comparison path; this record translates
the separate active timestamped transfer mechanism.

The relevant inspected test-facing/helper material does not supply executable
scenarios for this handoff and refresh contract. Author connected failure
witnesses rather than treating comments or source guards as test results.

## Why the adaptation is necessary

Convex's active caller is a sequential scheduler with one previous cache. Our
selected consumer is an existing Application query service with overlapping
operations, separate negative-point evidence and per-operation capacity limits.
Ordinary queries currently remain open until scope closure; they have no
equivalent consuming transaction method. Directly returning their mutable state
from a generic finalizer would permit aliases and late reads.

The separate [PostgreSQL refresh record](./postgres-cache-refresh.md) explains
the durable-feed reconstruction and retained live gates. The existing
[storage adaptation](./operation-cache-storage.md) owns the TypeScript collection
and body-accounting representation; it gains explicit write application for
this transfer rather than attempting to reuse immutable `populate`.

## Planned replacement

Keep the ordered cache and typed private row bodies under portable owners.
An app-scoped handoff owner transfers exclusive data-cache ownership between
completed operations. It does not transfer authentication, dependencies,
budgets, sticky failures, pending mutations or a live database transaction.
An operation already reading at old S keeps its own immutable view. Keep at most
one idle candidate per injected app owner. An older concurrent return cannot
replace a newer candidate, and a query at S below that candidate starts cold
without rewinding it. Refresh privately before making the cache available.

Add explicit trusted consume/seal under the existing read gate, after successful
Worker completion and drained RPC failures, and after evaluation receipt
finalization and assembly when applicable. Only the entire selected success path
may return the candidate. Failed/cancelled work discards its checkout;
queued or late reads cannot retain an alias to returned data.

Bind reusable data to the actual app/scope generation and relevant definition
identities. Initially clear the separate negative-point map on checkout rather
than translating old tombstone/no-visible-revision evidence. This can add point
misses; it cannot carry stale absence past an insertion. The pinned cache keeps
negative coverage inline, so this representation difference is explicit.
Initially require matching effective body/entry/interval limits rather than
inventing app-global defaults or silently widening the receiving budget.

The host scope owns retention and disposal of its single bounded idle candidate.
Checkout rechecks authoritative retained history and has a finite refresh budget;
old or overly expensive candidates go cold. This does not adopt Convex's numeric
idle timer default, which is not an accepted engine setting. A separate time
expiry policy may shorten retention; it cannot replace history validation.
No Cloudflare type belongs in the handoff algorithm. The initial actual DO host
and its restart proofs remain required later gates.

## Consequences, removal and proof

This can avoid repeated data fetches across operations. Do not claim lower
complete-query cost from fewer cache misses; the refresh adapter adds its own
work. A zero-body cache can still contain completed empty ranges, so it cannot
skip write application merely because it retains no documents.

Migrate actual query construction and remove the displaced selected cache setup
and refresh bypasses. Retain current eligibility only until the versioned
metadata, grant and complete-writer protocol proves a correct replacement.
Do not turn this staged retention into the final engine architecture.

The owning slice lists the source challenge, exact producer boundary, required
counterexamples and PGlite/PostgreSQL/host/performance gates. Record actual
executing symbols after implementation; this design record supplies no runtime,
performance, native compatibility or DO lifecycle evidence.
