# Native accepted-state durability dependencies

Status: **Necessary native adaptation implemented for the selected slot profile; broader native and performance gates remain open.**

## Pinned source invariant

At `db914cf06e2b06ee985646611b9e12ed7a770318`,
`crates/database/src/write_log.rs:984` explicitly requires pending commits to be
nonconflicting so any subset can persist in any order. The pending-overlap check
in `committer.rs:1035` enforces this before the concurrent write batcher. Ordered
publication and acknowledgements do not impose physical save order. Leader
bootstrap takes the maximum durable timestamp after fencing; it does not discard
later durable rows behind a missing predecessor.

## Necessary native difference

Native exact owner equality can accept a held insert of K because an accepted,
unpublished rename removes the published owner of K. This preserves required
native acceptance without replay, but creates a dependency excluded by the source
invariant. If the insert saves first and the rename fails before saving, restart
would otherwise expose duplicate K and a committed insert outcome. Publication
ordering cannot repair that state.

## Selected mechanism

The existing native slot-validation fold records every earlier accepted batch
with an index transition touching an observed slot, including removals and
net-zero ABA transitions. Accepted commits retain confirmed persistence
completion separately from ordered publication acknowledgement. A dependent
save enters SQL only after external predecessors have durable success; members
of the same atomic SQL batch need no internal wait.

Wait outside the acceptance mutex, SQL and scarce save permits. Keep draining
bounded accepted work so a blocked dependent does not prevent independent saves.
Preserve contiguous FIFO batch formation: external dependencies then point to
strictly earlier batches. Do not regroup noncontiguous ready commits into batches
that can introduce dependency cycles. An unready dependent must not pull an
otherwise ready independent commit into an unnecessary blocked batch.

Failure or uncertain predecessor settlement prevents dependent persistence and
fails retained completion waiters with the full stop Cause. Recheck owner state
before starting a save; already-entered writes retain their settlement/drain
owner. Result-only success that consumed pending restoration also waits for its
prerequisites. Original deadlines govern acceptance, without replaying native
callbacks or inventing a second settlement owner.

This adds selective dependency ordering, not global serialization of callbacks
or saves, a publication watermark as commit authority, or an additional physical
claim family. PostgreSQL remains the only durable authority.

## Required evidence

The [native slice](../slices/10-payload-native-core-cutover.md) owns acceptance.
Preserve a failing predecessor-before-SQL/cold-reopen witness, then prove no
dependent rows or success outcome survive that failure. Cover durable predecessor
acknowledgement loss, atomic same-batch failure, transitive dependencies,
cancellation/draining and independent persistence while a predecessor is gated.
Run PGlite and ordinary-role PostgreSQL separately and both project reviews.
Existing success-only pending-removal tests do not establish crash recovery.
