# Native relational queries over ordinary Core indexes

Status: **Selected native query implementation and connected consumer proof
complete; broader migration and retirement gates remain open.**
Owner: [Native Product slice](../slices/16-native-product-links-and-references.md).

## Pinned mechanism and need

Pinned Convex `db914cf06e2b06ee985646611b9e12ed7a770318` query/index
owners provide bounded ordered reads, pending overlays and precise consumed
prefix/EOF dependencies. They do not execute Medusa's captured relational
selectors, native searchable-text semantics, JSON predicates, storage insertion
ordering or count-before-population contract.

## Replacement and guarantees

[`nativeRelationalQuery.ts`](../../../../packages/persistence-postgres/src/core/nativeRelationalQuery.ts)
uses the existing
[`relational query value compiler`](../../../../packages/persistence-postgres/src/values/relationalQuery.ts)
and authenticated native row policy. Complete reads lower scalar/tuple selections
and required-null anchors into existing Core native `find` operations. Full rows
are validated before genuine pure predicates, order inspection and projection.
Search and JSON containment evaluate over the admitted bounded indexed cohort;
this does not implement Source UDF search or promise a separate trigram/JSON
index engine. Unavailable indexed-null anchors refuse. Candidate capture remains
bounded; there is no unbounded scan fallback or adapter SQL.

Complete native reads can order a non-null `timestamptz` column. The accepted
row value is a four-digit, nonzero-year UTC instant with exactly three
fractional digits. Its UTF-8 bytes sort chronologically. When instants compare
equal, both sort directions use the ascending native primary-key tuple in
Core's ordered UTF-8 encoding. The native PostgreSQL reader also orders ties
by primary identity; database text collation governs its text comparison.
Count and offset/limit use the same matched cohort. The pinned Convex
index appends document identity to ordered values (`crates/common/src/index.rs`);
native primary identity is supplied by the authenticated relational definition.
The ordinary Core index suffix can order ties differently. Examined-page
reads therefore continue to refuse timestamp order, including when an index
starts with that column.

The [declared equality correction](./native-declared-equality-indexes.md) implements
missing lowering of authenticated unconditional native scalar declarations.
It reuses these ordinary indexes and observations with paired owner proof;
complete Native20 consumer acceptance remains open. It grants no search, range,
JSON or constraint capability.

The existing
[`transaction native observation owner`](../../../../packages/persistence-postgres/src/core/transaction.ts)
retains first physical membership, first originals, negative/EOF dependencies
and pending writes. Native unique/range overlays seek the already maintained
pending-index BTree through
[`nativeQuery.ts`](../../../../packages/persistence-postgres/src/core/nativeQuery.ts),
with written-identity suppression and live final interval members. This reuses
the existing Source transaction-index mechanism; see the
[pending-index mapping](./incremental-pending-indexes.md#translated-core-native-selection-at-the-current-pin).
It does not refresh remembered originals, widen a frozen membership, discard
unique releases or weaken accepted-prefix integrity.

Complete reads count matched roots before their projected window. Storage
insertion ordering uses the Core envelope's creation time and stable storage-ID
tie. Other admitted ordering uses the existing native byte/numeric encodings.
The selected Customer Cart read uses this order for group pivots, including
pending membership. Core allocation order can differ from Legacy settlement
order under overlapping writers. The selected Customer profiles admit no
membership writer. Independent membership writers require a connected
ordering witness before activation.
Examined pages remain a distinct, narrower capability: their supported ascending
ordinary-index shape delegates to native `findPage` and
[`nativePage.ts`](../../../../packages/persistence-postgres/src/core/nativePage.ts),
preserving consumed-prefix and EOF observations without observing the untouched
suffix. Unsupported page shapes and PostgreSQL-dependent `postgresText` or
`postgresNumericCast` families refuse before candidate access; no JavaScript
approximation substitutes for those contracts.

[`nativeStore.ts`](../../../../packages/persistence-postgres/src/frameworks/commerceTransaction/nativeStore.ts)
adapts capture, the borrowed framework context, resource charging and returned
JSON values. It introduces no transaction or query engine. The genuine
[`Product query owner`](../../../../packages/medusa-adapter/src/modules/product/query.ts)
and shared
[`Medusa read/population owner`](../../../../packages/medusa-adapter/src/query/read.ts)
retain root relation filtering, child population, selector grammar and the
Product count-before-population convention. Category tree operations and
framework projection remain in their existing adapter/service owners.

[`Product`](../../../../packages/medusa-adapter/src/modules/product/schema.ts)
and [`stored Product Links`](../../../../packages/medusa-adapter/src/links/product-definition.ts)
compile their genuine complete native definitions into the shared logical
schema lifecycle. Native business IDs and pivots remain authoritative records;
query translation does not convert them into hidden membership projections.
The trusted host fixes the admitted request/query/identity budgets. The existing
1,000-image graph belongs to its selected Product profile; it does not authorize
larger generic limits, timeout changes or truncated relation results.

## Required proof and limits

Complete proof of the original Product selector/search/internal/category/population/count
cases and Module Link reads across both databases, plus neutral plan dependency
and refusal cases. Unsupported native predicates remain closed. Source UDF
search and arbitrary framework query admission are separate capabilities.
The complete original-case inventory, its create/read/delete cleanup closure,
cross-driver dependency/conflict witnesses and actual Worker composition remain
completion gates. A passing graph operation alone does not establish its full
lifecycle or arbitrary framework support.

The retained logical/physical relational working-set queries still serve named
unmigrated native modules, workflows and protected consumers. They are not a
fallback for this Core native profile. Remove their old dispatch, fixtures and
duplicate query mechanisms only as those genuine consumers migrate, preserving
required behavior and any named durable-data disposition. General retirement,
hosting and performance remain governed by the full goal; no performance campaign
is activated by this correctness replacement.

