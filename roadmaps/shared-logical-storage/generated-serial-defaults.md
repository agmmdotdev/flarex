# Generated Serial Defaults

## Status And Scope

Implemented as a bounded private prerequisite. The shared relational schema and logical
working set own generated signed int32 serial defaults for fresh definitions.
Native Order Change Action creation is the selected framework consumer; existing
Order definitions retain their preservation-only default.

## Current Sources Of Truth

The [accepted shared storage design](../../design-notes/flarexdb-shared-logical-storage.md)
owns settlement and logical storage. The relational schema protocol, logical
working set, neutral serial scenarios and native Order serial consumer test own
the executable contract. The pinned Medusa Drizzle `applyGeneratedSerialValues`
defines the selected non-primary serial behavior. The
[Medusa adoption roadmap](../flarexdb-framework-integration/06-medusa-adoption.md)
owns connected workflow admission.

## Current Architecture

`serialNext` is valid only on a required integer column. For a new row, omitted
or null input uses `coalesce(max(column), 0) + 1`. An empty table starts at one;
a nonempty negative-only table increments its actual negative maximum. Explicit
values remain unchanged and participate in subsequent allocation.

The existing working-set owner reads the complete bounded identity-index range
on the same borrowed manager. Its current overlay includes pending inserts,
updates and soft-deleted rows. Physically deleted rows have no current value,
so deleting the maximum permits reuse. Independent columns allocate separately.

## Invariants And Trust Boundaries

The existing scope, schema, index-membership, negative-interval and row
dependencies remain settlement authority. Allocation adds no durable counter,
database sequence, extra transaction or adapter SQL. Rollback consumes no value;
durable request replay returns the committed result. Exhaustion and an incomplete
or oversized cohort refuse before settlement.

Complete row validation still requires an int32 value. Pure row-local
normalization cannot allocate from database membership. Medusa lowering selects
generation explicitly; its default preserves existing schema identities.

## Convex Compatibility And Flarex Divergences

This is a declared relational framework default. It adds no numeric serial API
to the portable Convex application model and does not replace application IDs
or application OCC.

## Known Gaps And Limitations

The complete identity cohort must fit the existing resource bounds. This is no
unbounded or production-scale allocation claim. Physical-table lowering refuses
`serialNext`: PostgreSQL sequence behavior differs in explicit-value handling,
rollback and maximum reuse. Populated-schema evolution remains gated.

## Next Correctness Gates

Native Order Action creation, preserved ordinals, replay and subsequent
allocation are supported on both PGlite and ordinary-role PostgreSQL. Payment
financial workflow admission remains a separate connected gate. Populated-schema
upgrades and allocation beyond the existing complete-cohort limits remain gated.
