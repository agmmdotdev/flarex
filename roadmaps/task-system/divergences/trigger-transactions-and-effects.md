# Trigger Transactions And Durable Effects

Status: **accepted adaptation direction; exact runtime contract pending**.
This records a necessary source difference before affected implementation.
The [first slice](../slices/01-source-and-installation-contract.md) and
[Task storage design](../../../design-notes/task-system/02-logical-storage.md)
own required guarantees.

## Source And Necessary Difference

At Trigger `f10bc23785e569e5d917318cf2033aabdbe96a0b`,
[attempt start](../../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/systems/runAttemptSystem.ts)
reads attempt/snapshot state under a Redis run lock before the inner transaction.
[Snapshot creation](../../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/systems/executionSnapshotSystem.ts)
can enqueue heartbeat work and emit events during that transaction. Retry and
terminal paths also separate persisted state, Redis queue release/requeue,
waitpoint completion and follow-up worker jobs.

Flarex removes Redis authority and keeps one trusted outer settlement. Retain
actual engine orchestration/decisions, move/revalidate authority-bearing reads
inside the correct core lock graph, and persist required due/delivery/release/
wait-resolution obligations atomically with their state transition. Publish or
drain them idempotently after commit. Do not translate each source call into an
independently committed CRUD operation or emit remote effects before settlement.

## Preserved Guarantees And Proof

Stable operation/receipt identities reconcile lost commit responses. A failed
transaction publishes no obligation; a committed transition survives crash
before wake publication. Duplicate drain never creates another attempt or
releases capacity twice. Bounded intent discovery/progress prevents lost work.

Prove concurrent start, terminal/retry/cancel races, lost completion response,
uncertain commit, crash before publication, duplicate wake/release and cold
drain on both database lanes. Shared-core lock/transaction changes also need
their AGENTS.md core divergence/ownership record before implementation. The
legacy SHARE-to-NO-KEY-UPDATE upgrade is not an admitted graph. No adapter SQL,
scope mutex, extra settlement owner or weakened witness may substitute for it.
