# Nullable Payload Keys Through Shared Storage

Status: implemented for fresh admitted scalar configurations.

## Outcome And Owners

Complete the nullable-key part of the shared query/constraint contract through
real Payload Local API operations. Optional scalar fields retain Payload default
and validation behavior, use explicit null in stored documents, and participate
in ordinary shared indexes. A unique tuple with a null component acquires no
claim. The existing shared build, pending-state and settlement owners enforce it.

The collection compiler owns native configuration translation; analysis owns
authenticated nullable validators; the existing unique-declaration owner derives
null-distinct specifications. The Payload adapter normalizes omitted create
values and skips undefined update members. It does not enforce uniqueness.

## Evidence And Design

Payload 3.88.0's installed field lifecycle owns defaults and required validation.
The pinned [Drizzle schema traversal](https://github.com/payloadcms/payload/blob/v3.88.0/packages/drizzle/src/schema/traverseFields.ts)
emits ordinary SQL unique indexes and adds NOT NULL only for required fields.
Its [write traversal](https://github.com/payloadcms/payload/blob/v3.88.0/packages/drizzle/src/transform/write/traverseFields.ts)
omits undefined members. PostgreSQL supplies null for an omitted nullable column
without a default; an update omission leaves the existing column unchanged.

Use the [shared conditional constraint contract](./08-conditional-unique-constraints.md)
without changing native Application null/missing semantics. Stored optional
Payload scalars are required nullable values, not optional document properties:
this keeps null reads, pending index membership and uniqueness aligned with the
SQL-backed framework. Add an ordinary logical index for optional unique fields,
because omitted unique claims cannot answer null membership queries. Compound
unique declarations already carry ordinary indexes.

Payload numeric ranges constrain the finite-number domain. Upper-only comparisons
include a lower bound of `-Number.MAX_VALUE` so null does not enter either shared
index bounds or residual matching. Shared Application mixed-value ordering stays
unchanged. This is framework predicate translation, not a separate query engine.

## Contract Changes And Cleanup

Replace the required-only scalar configuration restriction with authenticated
`nullable: true` metadata for non-required fields. Required declarations retain
their previous representation. Exact schema verification must reject missing,
weakened or mismatched null unions. Required timestamp fields cannot be nullable.
Nullable unique selections derive `nullsDistinct: true`; required-only selections
retain their existing physical specification. No physical table is added.

This admits fresh configurations, not populated-table ownership or requiredness
changes. Existing evolution safeguards and the deferred migration boundary remain.
No second writer, constraint engine, compatibility wrapper or fallback is added.
Medusa's installation/storage/publication cutover remains a connected subsequent
package; this slice does not claim that its generated physical storage has moved.

## Completion Gates

- Native compilation and analysis authenticate requiredness, null unions and indexes.
- Local API creates with omitted/null values, native defaults and required errors.
- Non-null duplicates fail with native field paths; multiple null tuples succeed.
- Null/value updates change pending indexed reads and unique claims together;
  late failure rolls back rows, indexes, claims, facts, wakes and outcomes.
- Upper-only numeric ranges exclude null through indexed, pending and previously
  scanned views, including the lowest finite number and signed-zero boundaries.
- PGlite and ordinary-role PostgreSQL run the same connected scenario; distinct
  PostgreSQL transactions prove null independence and non-null contention.
- Required-only regressions, affected typechecks, lint and both reviews pass.

General Payload field types, localization, arbitrary query operators, Medusa
activation, advanced populated-data migration and capacity claims remain outside
this slice.
