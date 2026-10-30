# Empty Application source projection

Status: **Independent challenge and peer exchange complete / Bounded publisher
correction implemented / Unmeasured**.
The [slice](../slices/04c3c-empty-application-source-projection.md) owns its gates.

At Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`, schema metadata can
contain an empty table map; table/index creation iterates only actual declarations.
See [schema JSON](../../../../../../crates/common/src/schemas/json.rs),
[schema model](../../../../../../crates/database/src/bootstrap_model/schema/mod.rs)
and [index model](../../../../../../crates/database/src/bootstrap_model/index.rs).
These are source findings, not an upstream test claim.

Flarex additionally retains a shared logical-source candidate and derives native
read-root/table/access projections. An all-Payload app still needs its exact empty
Application evidence carrier for ownership and analysis correlation, while native
read roots serve only admitted actual storage. Convex has no direct equivalent of
this projection contract.

Omit serving projection inserts for the authenticated Application/application.occ
document carrier only when every storage declaration and binding is empty. Retain
its full canonical evidence and all write/function/commit owners. Preserve the
existing all-view and native-policy/default-table refusals. A broad zero-binding
skip would bypass native evidence checks and is explicitly rejected.

No new table, fake read capability, transaction, fallback, format or historical
deletion is introduced. Missing root lookups continue to fail closed; old
nonempty roots remain at their distinct immutable schema coordinates. This is a
representation correction for admitted native apps, not a cache capacity or
complete-request performance claim. The executing owner is
[`publishLogicalReadMetadata`](../../../../packages/persistence-postgres/src/storage/documents/logicalReadMetadata.ts);
native and protected-read witnesses exercise the actual candidate, projection and
lookup path. Wider engine completion remains separate.
