# Pricing Logical Storage Cutover

## Status And Authority

This is the focused Pricing implementation preflight under the accepted shared
logical storage design and the standing completion goal. The pinned Pricing
static manifest has six models: PriceSet, Price, PriceRule, PriceList,
PriceListRule and PricePreference. The current adapter admits native base
PriceSet creation, ID reads and their nested Price/Rule rows; calculated
Pricing, PriceList writes and the Product Variant/Pricing/Link workflow remain
outside this first runtime selection.

The selected base-price source is implemented and exercised through the native
`createPriceSetsStep`, pending query graph, event publication and committed
PriceSet read. Its four logical tables and indexes are admitted without module
table DDL. The shared ordered-index contract now preserves PriceList's
`deleted_at IS NULL AND status = 'active'` predicate through catalog storage,
index membership and query selection. This is functional acceptance for the
selected source, not a claim that all Pricing operations or scale are proven.

## Connected Base-Price Slice

Compile the fixed four-table dependency set of the admitted base-price service
(PriceSet, Price, PriceRule and structural PriceList) into one authenticated
logical source, with their native indexes, exact-number companions and foreign
keys. This is an explicit capability boundary from the pinned six-model
manifest, not an arbitrary caller-supplied subset. Do not derive the source
from deployment-specific physical table names. Select that source for the
existing native `createPriceSets`, `listPriceSets` and
`retrievePriceSet` path. Admit only the PriceSet/Price/PriceRule mutations and
their exact native created messages; unexpected table changes, lifecycle
transitions or messages refuse the root. The trusted shared core continues to
own scoped row/index/unique maintenance, transaction settlement, publication
and recovery. A module operation not yet selected must fail closed.

This replaces the private Pricing profile/installation input for the selected
base-price host. Existing physical Pricing profile, generated tables and
Variant/Pricing/Link workflow remain for named unmigrated consumers until their
connected cutover and approved data disposition. No dual write, adapter SQL
fallback or compatibility wrapper is justified by the development fixture.
Native DTO and event names do not change. Validate exact raw numeric values,
nested rows, selected pending and committed reads, event correspondence and
replay on PGlite and ordinary-role PostgreSQL. Shared rollback and two-scope
isolation remain required at the next Pricing/Product/Link runtime cutover;
existing core and Product proofs retain their own scopes.
Run affected typechecks, guards, lint and both required read-only reviews,
then remove displaced selected-fixture setup and commit the connected slice.

## Remaining Gates

The full six-model Pricing source is blocked by a native index semantic gap:
`PriceListRule.value` declares a JSON GIN index in the pinned model, while
`compileDmlSchema` drops its index type and the current logical lowering would
misclassify it as B-tree. Preserve the source-model index kind and add a shared
JSON containment/equality access path before admitting that table. The
separate base-price source makes this limitation explicit; eventual ownership
transfer must retain stable table identities and follow the structural
migration gate rather than silently expanding a live source.

The representative calculated-price query in
[query and constraint acceptance](./02-query-and-constraint-acceptance.md)
must select logical indexes for currency/quantity/time/rules and compare
bounded generic results with the pinned native repository. The existing
Product Variant/Pricing/Link workflow must then move its three participants
and rich Link records without changing native behavior. PriceList,
PricePreference and other currently unadmitted public operations require
separate native-semantic contracts; compiling their definitions does not grant
runtime capability. Retire physical Pricing DDL, profiles, migrations and
fixtures only after their named consumers and data obligations have moved.
