# Transaction operation exclusion in TypeScript

Design status: **Accepted within the existing transaction contract**.
Implementation status: **Implemented in the selected fresh-target slice**.
Measurement status: **Required gates unmet**; bounded correctness controls do
not establish host queue or throughput limits.

## Ownership and decision

[Slice 06a](../slices/06a-application-persistence-cutover.md) owns this adaptation
under the [replacement workflow](../REFACTOR.md#convex-guided-replacement-workflow).
The portable transaction owns its mutable observations, pending writes, accounting
and finalization. No new transaction semantics or database lifetime is introduced.
Old consumers remain on their named targets until their connected migration.

## Pinned Convex mechanism

At db914cf06e2b06ee985646611b9e12ed7a770318, crates/database/src/transaction.rs uses
exclusive mutable transaction access, including asynchronous reads; writes.rs and
transaction_index.rs update that same transaction state. Their raw Git identities
are in [REFERENCES](../../REFERENCES.md#current-source-hashes). Rust's mutable
borrow excludes another mutation of this state while the first awaits a read.
This language property is not provided by JavaScript's event loop.

## Current core and direction challenge

The independent current-core, accepted-direction and upstream challenges selected
one operation-local transaction. During implementation an overlapping-patch
counterexample exposed the missing exclusion: both patches could observe the
same original document before either recorded its pending result, losing a field.
Keeping ordinary Promise interleaving therefore does not translate the source.
Serializing unrelated transactions or holding a SQL transaction across user code
would add broader ownership and lifetime costs without solving the proper owner.

## Replacement mechanism

packages/persistence-postgres/src/core/transaction.ts uses one Effect semaphore
per transaction. Public operations and private metadata accesses enter the same
exclusive section. Admission counts queued and active operations; finalize refuses
an unfinished graph. Closing the transaction prevents queued work from entering
or returning a usable result. Interruption releases permits and admission counts.
The semaphore covers only this transaction; separate transactions and persistence
saves retain their own concurrency owners. No SQL transaction spans user execution.

## Preserved guarantees and remaining proof

The adaptation preserves one ordered mutation history, first-original/final writes,
tracked reads and consistent accounting. It adds a runtime exclusion mechanism
where Rust enforces exclusivity statically. The overlapping-patch control in
packages/persistence-postgres/test/core/bootstrapScenarios.ts must retain both
fields; finalization, cancellation and consumer regressions must remain covered in
PGlite and ordinary-role PostgreSQL.

Actual Worker syscall admission, pending-argument memory limits and app-DO owner
lifecycle remain goal gates. A per-transaction semaphore does not bound the number
or memory of incoming requests. Reassess this implementation if the host begins
providing equivalent exclusive access; do not retain duplicate queues by default.
