# Native conditional uniqueness

Status: **Selected shared constraint and connected Product/Links proof complete;
broader consumer migration and retirement remain open.**
Owner: [Native Product slice](../slices/16-native-product-links-and-references.md).

## Pinned mechanism and need

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318` ordinary
indexes maintain document keys and track exact reads; they are not declarative
SQL partial UNIQUE constraints. Product and stored Links require active-row
uniqueness/cardinality, nullable native keys and conflicting-restore refusal.

## Replacement and guarantees

Extend the existing [native unique owner](./native-unique-constraints.md).
Authenticate the eligibility predicate separately from actual unique key fields
and null-distinctness. An access index may prefix `deleted_at`, but that prefix
does not become a nullable unique key component. Active nullable SKU uniqueness
must skip null SKUs only, never every active row.

Use ordinary indexes for lookup/dependencies and the current claim/release,
whole-candidate/accepted-prefix validation and actual contributing save
prerequisites. Soft-delete releases and restore claims belong to the same root.
Preserve native constraint descriptors/error semantics and old frozen profiles'
stored shapes. No SQL partial index, extra physical family or adapter checker.

The [relational schema owner](../../../../packages/persistence-postgres/src/core/nativeRelationalSchema.ts)
captures the native eligibility and nullable key contract. The
[native policy](../../../../packages/persistence-postgres/src/core/nativePolicy.ts)
authenticates it against the installed logical schema. Existing
[transaction constraints](../../../../packages/persistence-postgres/src/core/transaction.ts)
and [observations](../../../../packages/persistence-postgres/src/core/nativeObservations.ts)
retain current claims and exact ordinary-index dependencies. Pending lookups use
the shared [transaction index overlay](../../../../packages/persistence-postgres/src/core/transaction.ts),
including written-ID suppression, rather than reencoding every pending body
for each claim. This changes traversal cost, not constraint or failure meaning.

## Required proof and limits

Use neutral nullable/conditional cases and real Product/Link duplicate,
soft-delete/reuse, conflicting restore and unpublished predecessor failure
on both database lanes. This record does not admit arbitrary native SQL
predicates or general migration conversions. Full Product and Link consumer
closure remains a separate acceptance gate.

## Ordinary workflow and Tax continuation

The [Native17 continuation](../slices/17-native-atomic-workflows-and-tax.md)
extends the same owner for Tax Region's two-null predicate and Tax Rate's
null-plus-boolean active-default predicate. This shared extension and the complete
admitted Tax workflow closure have paired native/owner proof. Preserve normalized
authenticated eligibility separately from null-distinct business keys, original
single-null frozen shapes, exact pending lookup and final accepted-prefix
validation. An index prefix is an access path, not another unique-key field.
No general SQL predicate parser or Pricing activation follows from Tax support.

