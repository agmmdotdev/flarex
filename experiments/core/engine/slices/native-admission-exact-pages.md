# Reuse exact committed pages during native admission

Scope: shared Core index cache and committer, baseline `6a85e6eab`.
The full Product creation trace records 125 request page calls and 123
additional admission page calls. Each admission call matched an earlier
physical page at the exact same published timestamp and index request.
The user selected removal of these physical repeats with all existing
admission checks retained.

| Owner | Pinned mechanism | Selected replacement and witness |
| --- | --- | --- |
| Shared index cache | `crates/indexing/src/index_cache/mod.rs` validates fills, bounds residency, and invalidates on publication. `database_index_snapshot.rs::IndexCacheReader` verifies a selected hit against persistence. | Retain exact physical provenance on an existing detached, ready page. A successful ordinary verification can update provenance. A hit served without a physical read cannot. Keep ordinary sampling and cache admission. |
| Committer | `crates/database/src/committer.rs` validates the published suffix and pending writes against transaction evidence before acceptance. | Use exact pages as inputs to existing native admission. Preserve fresh registry selection, retention, index/range checks, authority, accounting, accepted batches, candidate writes and all suffix checks. Fetch on any miss. |

The two independent challenges first proposed retaining pages at the native
root. Peer challenge established that the existing fenced cache already owns
the detached page, eviction and invalidation. Reusing it avoids a second
retention budget and a finalization capability handoff. Its ordinary timestamp
eligibility alone cannot prove a physical read at the admission timestamp.
Exact evidence requires the same timestamp, table, logical and physical index,
half-open bounds, order and limit. An older verifier cannot mark a replacement.
Misses include stale evidence, failed or skipped verification, eviction, and
index generation changes.

A matched page still needs the physical index retention checks. Admission
continues to form every demand, including demands from Application writes
without native observations. It uses the existing point path for point
observations. Concurrent publication can still invalidate preparation, and
accepted but unpublished writes still participate in the decision. No
durable representation or migration changes.

Run cache ownership, retention and concurrency witnesses, paired PGlite and
ordinary-role PostgreSQL admission regressions, and the full Product graph
with hook, durable outcome and readback checks. Measure exact physical page
counts separately from quiet latency and CPU. Local timing does not supply
the missing matched native Product creation reference.

See [native exact page reuse](../divergences/native-admission-exact-pages.md).
