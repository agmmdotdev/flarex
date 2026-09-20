# Nonempty Request Settlement And Concurrency

Status: bounded zero/eight-row settlement and concurrency witnesses implemented;
complete-request CE0 acceptance remains open.

## Outcome And Owners

Extend the existing zero-row PostgreSQL settlement scenarios to both zero and
eight-row first inserts through the core and matched request reference. A written
row/index/claim/publication prefix is not a commit. Verify authoritative replay
after lost COMMIT acknowledgement, refusal without automatic re-execution when
COMMIT was not sent, cancellation before and after settlement, duplicate-request
serialization, distinct-request disjoint/unique contention and progress in
another scope while the first scope is held.

The physical session and request-recovery owners remain shared and unchanged.
The reference independently materializes nonempty rows, memberships and claims;
its common schema validation, bounded readers and lifetime remain explicit. This proves
the admitted first-insert profile, not complete CE0, capacity or a new concurrency
protocol. The [first-insert executor](./52-ce0-first-insert-execution.md) now owns
its fixed pending insert flow independently. Standalone reads, broader document
operations, update/swap/relation profiles and lifecycle races remain open.

## Design Challenge And Cutover

Zero-row outcome equality cannot establish nonempty rollback or atomic recovery.
Extend the existing settlement matrix with actual returned documents and full
scoped inventories rather than adding a second recovery implementation. Observe
real PostgreSQL blocking PIDs on distinct connections, use deterministic release
barriers and require another scope to commit before releasing the holder.
Keep the old zero-row semantic/authority scenario in its existing test; move its
settlement matrix into the shared zero/nonempty test and remove the duplicate.

Cancellation after row, index, claim and complete publication writes also runs
in the shared PGlite/PostgreSQL first-insert scenario. Every refused request must
leave all scoped durable families unchanged; explicit caller re-entry after rollback must
produce one complete commit and both engines must replay the exact result.
After a committed cancellation, inspect durable state before replay so replay
cannot conceal an absent commit. Check execution counts and unchanged inventory.

No production contracts, schemas, durable data or public APIs change. Only test
placement changes, with all existing zero-row witnesses retained. New Medusa
integration, lock shortening and advanced schema evolution are outside scope.

## Completion Gates

Run focused PGlite semantics and ordinary-role PostgreSQL settlement/lock tests,
affected types and lint. Require failed connections to be quarantined, recovery
on another backend, full Cause distinctions and drained pools. Obtain both
read-only reviews, remove displaced test code, stop owned resources and commit.
Record limitations without calling this a latency or throughput measurement.

## Evidence Boundary

The zero/eight-row PostgreSQL matrix uses both implementations for uncertain
settlement and cancellation. Contention holds the core publisher and observes
the reference waiting on its scope clock: duplicate delivery executes once,
disjoint requests both commit densely, and competing titles produce one commit
and one typed uniqueness refusal. Another scope commits the same titles and
request key before the holder releases. Reverse holder ordering, lifecycle
transitions and broader workload contention remain outside this matrix. These
witnesses preserve current same-scope serialization; they do not shorten it.
