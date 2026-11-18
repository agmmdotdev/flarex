# Exact physical pages for native commit admission

Design status **Accepted for the selected slice**. Implementation and
measurement follow the [native admission slice](../slices/native-admission-exact-pages.md).

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318` uses timestamped
index pages with validated fills and publication invalidation in
`crates/indexing/src/index_cache/mod.rs`. The `IndexCacheReader` in
`crates/indexing/src/database_index_snapshot.rs` verifies sampled hits against
the physical reader. `crates/database/src/committer.rs` checks conflicts
against the published suffix and pending writes. It has no Flarex native
membership and final graph integrity preparation pass.

Flarex's native committer must reconstruct the committed membership required
by that pass. Reuse an existing cache-owned page only with physical provenance
at the selected timestamp and exact scan identity, after checking the current
index binding and retention. This gives the existing preparation code its
storage input. It confers no grant, dependency, or transaction verdict.
Capture and reuse are bounded by the existing cache's lifetime and capacity.

The independent challenges rejected using ordinary cross-timestamp eligibility
as physical provenance and rejected replacing the integrity pass with the
request's remembered result. Expected membership can differ from the committed
base. A concurrent publication can require fresh preparation. An accepted
removal can change the outcome before its publication, and protected reference
checks may demand pages the request never read.

Keep the actual persistence path for a miss and for point reads. Preserve
retention, failure ordering, published and pending conflict checks, accepted
prefix order, capacity accounting and callback lifetime. Prove same-timestamp
reuse and stale/mismatched misses, cache invalidation races, pending writes,
retention, and the genuine Product workflow in the two database lanes.
