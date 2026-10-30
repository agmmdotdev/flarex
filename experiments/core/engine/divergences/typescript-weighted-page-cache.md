# Synchronous TypeScript weighted page-cache maintenance

Design status: **Accepted runtime representation adaptation**.
Implementation status: **Implemented for the bounded fresh Application profile**.
Measurement status: **Required gates unmet**; no capacity or hit-rate claim.

## Ownership and source

The portable shared page owner in the [snapshot/index-cache slice](../slices/06d-snapshot-index-cache.md)
owns this adaptation under the [goal](../GOAL.md). No framework/native behavior
or durable schema changes. Baseline Flarex `6c7e415973de786df7b82e624a2e7f0051c15374`;
Convex `db914cf06e2b06ee985646611b9e12ed7a770318`.

Pinned `crates/indexing/src/{atomic_cache.rs,index_cache/mod.rs}` uses Moka
0.12.16 from convex/moka revision
`ef75713ad43a39fae18c3c01fa414eefa9439af0` in Cargo.lock. Its builder selects
weight/capacity/listener without overriding the default policy. Primary
dependency source inspected: [policy.rs](https://github.com/convex/moka/blob/ef75713ad43a39fae18c3c01fa414eefa9439af0/src/policy.rs),
[frequency_sketch.rs](https://github.com/convex/moka/blob/ef75713ad43a39fae18c3c01fa414eefa9439af0/src/common/frequency_sketch.rs),
[base_cache.rs](https://github.com/convex/moka/blob/ef75713ad43a39fae18c3c01fa414eefa9439af0/src/sync/base_cache.rs)
and `common/concurrent/deques.rs` at that same revision. Local dependency source
was absent; the exact pinned files were obtained before choosing a replacement.

The confirmed policy is TinyLFU admission with probation LRU victim selection;
the window/protected queues are unused. Frequency uses a depth-four, saturating
four-bit Count-Min sketch with periodic halving. Hits and misses contribute;
hits/upserts move to MRU. Weighted admission accumulates LRU victim weight and
frequency, admitting only when candidate frequency is strictly greater than
the combined victims; ties reject. This is neither an asserted W-TinyLFU port
nor an arbitrary plain-LRU replacement.

## Why synchronization differs

Rust uses concurrent map operations, deferred policy-channel maintenance and
potentially lazy removal listeners. DO JavaScript is single-threaded and awaits
can interleave, but synchronous sections cannot. Translating Rust thread/channel
machinery would add queues and deferred allocations without supplying another
thread. DO memory also requires enforcing the configured page weight without
depending on eventual background policy maintenance.

The smallest adaptation is synchronous map/policy updates and synchronous exact
registration cleanup, retaining the confirmed admission/eviction algorithm.
No stale callback can unregister a newer fill because there is no deferred
removal callback. If that changes, source-equivalent refcount/identity protection
must be introduced first. Shared cache correctness still requires two-phase
population identity across awaits and publication participation.

## Replacement and guarantees

The TypeScript owner uses exact canonical keys plus private ordered recency
state and a bounded frequency sketch. Key hashing supplies approximate policy
frequency only; exact key equality and invalidation registration remain separate.
Rust randomized key hashes are process representation, not persisted identities.
Any necessary JavaScript hash representation must remain private, source-bound
and documented in the implementation; collisions cannot establish a cache hit.

Preserve source sketch constants, saturation/aging and weighted candidate/victim
comparison. Eviction or admission rejection is a miss, never a changed result.
Synchronous maintenance changes residency timing and cost from Moka's batched
maintenance; equivalent hit rates or bit-identical randomized frequency state
are not claimed. Page weight is an accounting bound, not total JS heap usage.

Keep exact page identity, begin timestamp, original cursor, ready/populating
identity, write-log gap refusal, old/new-key invalidation, whole-index metadata
invalidation and verification-failure semantics from pinned Convex. No generic
document cache, TTL validity rule, range merging or silent SQL fallback replaces
them. Cache state is private to one database/source lifetime.

## Required witnesses and limits

Test sketch saturation/aging, hit/miss frequency, weighted multi-victim admission,
tie/oversize rejection, synchronous registration cleanup and bounded residency.
Test old fill versus eviction/new fill, publication and metadata races, exact
page/cursor preservation, SQL verification failure and mutable-byte isolation.
Run connected PGlite, ordinary PostgreSQL and actual workerd witnesses separately.
Do not equate policy tests or SQL counts with DO capacity/performance proof.

Interval registration uses the pinned Convex interval-map augmented treap, with JavaScript references in place of Rust slab handles. Key hashing uses private per-owner SipHash-1-3 over canonical UTF-8 keys; Rust standard-library Hash serialization is not claimed identical. Exact equality remains separate from approximate frequency.
