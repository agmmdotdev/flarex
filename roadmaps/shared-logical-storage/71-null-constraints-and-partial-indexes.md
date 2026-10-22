# Null implications and two-null partial indexes

## Status and scope

Status: bounded implementation in shared logical storage, validated on PGlite
and ordinary-role PostgreSQL. This extends the
existing shared relational row, ordered-index and uniqueness owners for the
native [item Tax lines prerequisite](../flarexdb-framework-integration/preflight/163-native-item-tax-lines.md).
The connected row, membership and catalog contracts are implemented. Tax
workflow admission and SQL-real numeric conversion retain separate gates.

This adds no transaction owner, module-specific storage, general expression
language or public document constraint API.

## Authority and semantic requirement

The [accepted database design](../../design-notes/flarex-db-accepted-design.md),
[shared storage decision](../../design-notes/flarexdb-shared-logical-storage.md)
and [package boundaries](../16-package-boundaries.md) remain authoritative.
Frameworks declare native constraints; shared storage owns their enforcement.

Native TaxRegion has two row checks:
`parent_id IS NULL OR provider_id IS NULL` and
`parent_id IS NULL OR province_code IS NOT NULL`. Their truth does not depend
on soft-deletion state. An active nullable-province unique index on
`country_code` also requires both `province_code IS NULL` and
`deleted_at IS NULL`. Dropping either check or either index guard changes the
native model's accepted rows.

## Representation and ownership

The checked relational source adds `nullImplication` with scoped, distinct
same-table `nonNullColumn` and `requiredColumn` references and an exact
`required: "null" | "notNull"` value. The source declaration uses the
corresponding `nonNullColumnId` and `requiredColumnId` fields. When the first
column is non-null, the second must have the declared nullness. Existing
column type/nullability checks still run on the complete row.

The existing row-value owner applies that constraint after defaults and
merged updates, including initialization, deleted rows, restoration,
same-root reconstitution and validated stored reads. Incomplete or forged
preimages retain their existing refusal; the new check grants no history or
reconstitution authority. Constraint failures retain the existing atomic
failure and publication boundary.

The checked source's `allNull` predicate contains exactly two distinct
nullable columns belonging to its table. Canonicalization sorts the pair by
the existing UTF-16 identity ordering. Ordered and unique requirements lower
it to the exact physical variant
`{ kind: "fieldsAreNull", fields: [first, second] }`. Both actual fields must
be null for membership. Existing key encoding, ordered entries, revisions,
unique claims and publication consume the same membership contract.

Ordered point and page eligibility require both guards. Historical conditional
unique eligibility retains the complete predicate as its contract. An unrelated complete index may still serve a broader
query; the conditional index is never advertised as an unconditional native
scalar anchor. Warmed misses, pending membership changes and cold reopening
retain the existing metadata and row lifetime owners.

## Compatibility and cutover

Existing unconditional, null-only, text and Boolean predicate bytes and
identities remain unchanged. Existing relational constraints retain their
canonical encodings. The new variants do not widen Application/Payload
document unique declarations, Convex's public table/index grammar, or the
ordinary application developer model.

Catalog migration `0151` extends the ordered and unique physical-spec JSON
CHECKs from their `0150` definitions to admit the exact two-null variant.
Existing catalog definitions and stored data need no rewrite. Fresh
installation and the actual predecessor-to-new CHECK transition have
separate validation. This does not establish general populated-source schema
evolution, data conversion or installer-drain support.

The retained per-table physical-DDL route explicitly refuses these new
relational constraint and predicate variants. Logical-source admission does
not establish support in that displaced schema engine.

## Correctness gates

Validate neutral installed insert, complete merged update, initialization,
restore/reconstitution, deleted-row checks and canonical stored-corruption
refusal on both PGlite and ordinary-role PostgreSQL. A refused operation must
leave rows, revisions, index entries, unique claims, facts, commits,
initialization receipts and durable outcomes unchanged.

Prove membership enters and leaves independently through each null guard,
duplicate exclusion and active conflicts, prefix rollback, retained history,
historical snapshot access, warmed miss-to-hit behavior, missing-guard partial
index ineligibility and cold reopening. Preserve existing nullable-field, text/Boolean
predicate and conditional-uniqueness controls. Malformed catalog JSON must
remain refused before and after the additive CHECK transition.

Direct installed historical conditional-unique query execution remains a
separate correctness gate. Retained row snapshots establish row history;
they do not by themselves establish that unique-query execution path.

The complete four-model native Tax schema must retain both implications and
the two-null unique predicate before its read workflow is admitted. Native
Tax/SystemTax behavior, SQL-real conversion, complete Cart composition and
hosted activation remain separate gates.
