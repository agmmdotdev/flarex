# Logical Commerce Initialization

## Status And Scope

Status: implemented private initialization contract, consumed by the bounded
native Store guard in Sales Channel deletion. This extends
the existing source-scoped Commerce bootstrap. It does not introduce a migration
engine, runtime table-selection capability or new settlement owner.

## Current Sources Of Truth

The accepted shared logical storage design governs authority and settlement.
`commerceTransaction/host.ts` owns bootstrap execution and
`initializationRows.ts` owns strict dataset routing. The neutral
`commerceLogicalInitialization.test.ts` and `commerceInitializationRows.test.ts`
cover the shared owner. The connected consumer is the native Store guard in
[Sales Channel deletion](../flarexdb-framework-integration/preflight/112-native-sales-channel-delete-workflow.md).

## Current Architecture And Invariants

Nonempty initialization of a logical source with multiple tables uses ordered
`{ table, row }` entries. The complete entries remain inside the existing hashed
canonical dataset, so the digest binds both target names and row values. Every
target must name a table from the authenticated source admission before any
write can begin. Adjacent entries for one table share a batch; interleaving is
preserved for foreign-key dependencies.

The original host retains request exclusion, authority/fencing, the source-wide
empty-first-data gate, row and byte limits, working-set validation, one atomic
publication and the source initialization receipt. Failed constraints publish no
rows, facts, commits or receipts. Retried identical initialization resolves its
existing committed outcome. Receipts and row identities remain scope bound.

Physical initialization, flat single-table datasets and empty initialization
retain their existing paths. Flat nonempty data for a multi-table logical source
still fails closed. No durable table or data reset is required.

## Decisions And Compatibility

The preceding blanket refusal prevented complete framework schemas from seeding
one of their own tables. Explicit target data corrects that core limitation
without adding Store CRUD or adapter SQL. This is a framework bootstrap contract;
the Application/Convex developer model and native Application OCC are unchanged.

## Remaining Gates

Validate each connected framework consumer through its native service and
workflow. This contract establishes neither arbitrary framework seed profiles,
populated-data conversion nor hosted activation.
