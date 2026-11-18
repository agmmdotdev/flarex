# Reuse write-log snapshots within one published generation

Baseline `b57f6a36e4e7aba9d63c6f85cfd801ef63b0e9b0`. The full Product
profile from the previous slice attributed about 11 ms of sampled time per
request to rebuilding committed write-log views. The main callers were
cache fill validation and native snapshot selection. Effect, value capture,
and authority cost were larger in aggregate. Both independent challenges
found that those samples span several required mechanisms, while this
specific write-log work is redundant within a single generation.

| Owner | Pinned Convex mechanism | Selected mechanism |
| --- | --- | --- |
| `CoreWriteLog` | `crates/database/src/write_log.rs::LogWriter::snapshot` clones persistent `OrdMap` roots and records the retained window. | Reuse one immutable TypeScript snapshot of the same write-log generation. Existing COW index and transition roots stay private. |
| Publication and retention | The committed log advances before cache invalidation, and readers enforce the retained floor. | Invalidate the current view before appending and before actual pruning. A retention-only change can invalidate at the same latest timestamp. Previously borrowed views retain their original roots and floor. |

The challengers compared the raw profile to the executing Core and pinned
Convex. They agreed that cache fills must still read the current history
after fetching, and native captures must still select the current published
registry, data timestamp and write log together. There is no change to
published suffix checks, pending writes, native key transition semantics,
retention failures, index authority, or durable settlement.

Keep distinct log instances isolated. Capture a new view after any append,
including a commit without index keys, and after any actual retention change.
Reuse after a no-op prune. Preserve old-view conflict results and detached
conflict bytes. Run the focused write-log and native transition cases,
connected cache and native admission checks on both drivers, and paired
complete Product timing against pinned native Medusa. Count snapshot calls
and builds separately from quiet timing.

See [immutable write-log views](../divergences/write-log-generation-snapshots.md).
