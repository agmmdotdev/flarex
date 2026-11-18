# Reuse immutable write-log views by generation

Design status **Accepted for the selected slice**. See the
[owning slice](../slices/reuse-write-log-snapshots.md).

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318` clones its
`WriteLog` in `LogWriter::snapshot` under the owner lock. In
`crates/database/src/write_log.rs`, the ordered index maps and sets use
persistent roots and retain the purged timestamp with the captured log.
Append precedes cache invalidation, and conflicts use the captured
retention boundary.

Core uses mutable outer maps and copy-on-write B+tree wrappers for
its distinct committed conflicts and native transitions. Reusing an exact
view within a log generation removes repeated outer map reconstruction
and tree cloning. The view exposes neither map. Append and actual pruning
discard the current view before mutating its source. Held views remain
valid for their original observation and continue to return detached bytes.

Cache fill, native capture, and commit admission still ask the log owner
for the current view at their existing frontiers. Pending writes, physical
retention checks and the PostgreSQL settlement boundary remain separate.
No stored format or migration changes.
