# Native relational foreign keys and delete closure

Status: **Selected shared integrity and connected Product/Links proof complete;
broader consumer migration and retirement remain open.**
Owner: [Native Product slice](../slices/16-native-product-links-and-references.md).

## Pinned mechanism and need

At `db914cf06e2b06ee985646611b9e12ed7a770318`, Convex
`crates/common/src/schemas/validator.rs` validates table-typed IDs without target
row reads. `crates/database/src/bootstrap_model/user_facing.rs` deletes ordinary
documents; cron/scheduled-job models explicitly clean their child records.
It supplies no SQL-native-key FK, nullable tuple, noAction or cascade contract.

Medusa Product's 15 FKs require native-key existence and declared actions.
Soft-deleted rows still exist. Missing endpoints in Module Links remain permitted.
Protected cross-framework references have their separate liveness/retention
policies. These genuine native requirements cannot be implemented by treating
all relations as table-typed Core IDs.

## Replacement and guarantees

Extend authenticated native schema and the existing Core integrity owners with
declared native key tuples, nullable components, reverse ordinary-index access
and original/final-state validation. Keep native business keys separate from
Core envelope IDs. Apply the whole accepted pending prefix plus committed suffix
and actual predecessor durability; never replay native callbacks.

Keep scalar pending deletion separate from bounded complete closure preparation.
A deleted parent replaced under the same native key can satisfy surviving
children. Reuse native child-first discovery/observations; freeze actual changes
before result/event sealing. Final acceptance validates the frozen graph and
must conflict on new incoming members instead of silently widening deletions.
Native lifecycle maps/events remain framework-owned. Preserve noAction timing
and sticky failure. No extra physical storage or FK SQL trigger is introduced.

The [native relational schema](../../../../packages/persistence-postgres/src/core/nativeRelationalSchema.ts)
authenticates key tuples, actions and ordinary access indexes. The existing
[transaction](../../../../packages/persistence-postgres/src/core/transaction.ts)
owns pending changes, complete closure preparation and rollback of a refused
operation. The [foreign-key owner](../../../../packages/persistence-postgres/src/core/nativeForeignKeys.ts)
validates the frozen graph through bounded
[key probes](../../../../packages/persistence-postgres/src/core/nativeKeyProbe.ts);
the [committer](../../../../packages/persistence-postgres/src/core/committer.ts)
uses accepted-prefix observations and contributing durability prerequisites.
Both native and ordinary Application writers enforce installed protected
references through the existing
[reference owner](../../../../packages/persistence-postgres/src/core/nativeProtectedReferences.ts).

Protected assignment intent is recorded on the actual pending document change.
Clearing then assigning the same inactive target counts as a new assignment;
an unrelated edit to an unchanged retained edge does not. Failed bulk or
closure operations restore pending writes, indexes and assignment intent while
retaining real reads and nonrefundable resource use. The native request lifetime
owns sticky caller failure; the lower-level Core operations remain catchable.

## Required proof and limits

Prove neutral native-key/tuple/null fixtures and actual Product nullable FKs,
self hierarchy, cascades, noAction, replacement-key preservation, concurrent
incoming membership, pending predecessor failure and unchanged native presentation
on PGlite and ordinary-role PostgreSQL. The large Product delete graph must also
fit the unchanged shared resource profile; a passing create does not prove its
cleanup path. Arbitrary cyclic cascades, broad model conversion and Tax
checkpoint migration are not established by this record.

