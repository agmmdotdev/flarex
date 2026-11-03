# Generated Serial Defaults

## Status And Scope

The relational schema declares generated signed int32 defaults for fresh definitions.
The [Core continuation](../../experiments/core/engine/slices/27-native-order-generated-serials.md)
moves standalone Order creation and deletion and Order Change Action creation
to Core. The checkout fixture still uses the Legacy working set. Existing
preserve-mode Order definitions retain their identities.

## Current Sources Of Truth

The [accepted shared storage design](../../design-notes/flarexdb-shared-logical-storage.md)
owns settlement and logical storage. The relational schema protocol, Core transaction
and neutral and native consumer scenarios own the translated contract. The pinned
Medusa Drizzle `applyGeneratedSerialValues` defines the selected non-primary
serial behavior. The
[Medusa adoption roadmap](../flarexdb-framework-integration/06-medusa-adoption.md)
owns connected workflow admission.

## Current Architecture

`serialNext` is valid only on a required integer column. For a new row, omitted
or null input uses `coalesce(max(column), 0) + 1`. An empty table starts at one;
a nonempty negative-only table increments its actual negative maximum. Explicit
values remain unchanged and participate in subsequent allocation.

Core finds the maximum with an authenticated descending ordinary index query and
the current transaction overlay. It records the consumed upper interval or
exhaustion. If the root already observed the complete table, Core uses that
membership with pending writes. Pending inserts, updates and soft-deleted rows
count. Physically deleted rows have no current value, so deleting the maximum
permits reuse. Independent columns allocate separately.

The Legacy working set reads the complete bounded identity range on the same
borrowed manager. That path remains for the existing checkout fixture.

## Invariants And Trust Boundaries

The existing scope, schema, index-membership, negative-interval and row
dependencies remain settlement authority. Allocation adds no durable counter,
database sequence, extra transaction or adapter SQL. Rollback consumes no value;
durable request replay returns the committed result. Int32 overflow, stale
observations and oversized examined prefixes refuse before settlement.

Complete row validation still requires an int32 value. Pure row-local
normalization cannot allocate from database membership. Medusa lowering selects
generation explicitly; its default preserves existing schema identities.

## Convex Compatibility And Flarex Divergences

This is a declared relational framework default. It adds no numeric serial API
to the portable Convex application model and does not replace application IDs
or application OCC.

## Known Gaps And Limitations

The examined prefix must fit the existing Core resource bounds. Legacy checkout
still requires the complete cohort to fit. Physical-table lowering refuses
`serialNext`: PostgreSQL sequence behavior differs in explicit-value handling,
rollback and maximum reuse. Populated-schema evolution remains gated.

## Next Correctness Gates

The neutral allocation scenarios and both direct Order consumers passed on
PGlite and ordinary-role PostgreSQL. Connected checkout, payment financial
workflow admission, and populated-schema upgrades have separate gates.
