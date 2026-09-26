# Pricing Logical Storage Cutover

## Status And Authority

This is the focused Pricing implementation preflight under the accepted shared
logical storage design and the standing completion goal. The pinned Pricing
static manifest has six models: PriceSet, Price, PriceRule, PriceList,
PriceListRule and PricePreference. The selected composer and host now admit the
complete pinned source. The current adapter admits native PriceSet creation,
ID reads and their nested Price/Rule rows; calculated Pricing and PriceList
writes remain outside the selected service methods.

The selected PriceSet service is exercised through the native
`createPriceSetsStep`, pending query graph, event publication and committed
PriceSet read. All six logical tables and their indexes are admitted without module
table DDL. The shared ordered-index contract now preserves PriceList's
`deleted_at IS NULL AND status = 'active'` predicate through catalog storage,
index membership and query selection. This is functional acceptance for the
selected service methods, not a claim that all Pricing operations or scale are proven.

## Original PriceSet Service Cutover

The original service cutover compiled PriceSet, Price, PriceRule and structural
PriceList. The selected source now uses all six pinned models under the
[full-source cutover](./47-full-pricing-source-cutover.md), while retaining its
native indexes, exact-number companions and foreign keys. Do not derive the
source from deployment-specific physical table names. Select that source for the
existing native `createPriceSets`, `listPriceSets` and
`retrievePriceSet` path. Admit only the PriceSet/Price/PriceRule mutations and
their exact native created messages; unexpected table changes, lifecycle
transitions or messages refuse the root. The trusted shared core continues to
own scoped row/index/unique maintenance, transaction settlement, publication
and recovery. A module operation not yet selected must fail closed.

This replaces the private Pricing profile/installation input for the selected
PriceSet host. The native Pricing fixture and selected Variant/Pricing/Link
workflow now use logical sources; the former combined physical profile builder
is retired under [Pricing fixture retirement](./37-pricing-physical-fixture-retirement.md).
No dual write, adapter SQL fallback or compatibility wrapper is justified by
the development fixture.
Native DTO and event names do not change. Validate exact raw numeric values,
nested rows, selected pending and committed reads, event correspondence and
replay on PGlite and ordinary-role PostgreSQL. Shared rollback and two-scope
isolation are exercised by the selected Pricing/Product/Link workflow;
existing core and Product proofs retain their own scopes.
Run affected typechecks, guards, lint and both required read-only reviews,
then remove displaced selected-fixture setup and commit the connected slice.

## Remaining Gates

The pinned `PriceListRule.value` JSON GIN declaration now lowers to a generic
logical containment requirement. The shared core has a scope-confined current
JSON entry family, physical GIN readiness, transactional maintenance and
bounded `@>` candidate reads. A six-model Pricing-shaped source can be admitted
and can write/query PriceListRule through the private core contract. This is
not yet a native calculated-Pricing service cutover. The composer and runtime
now select the full six-model source. A populated former four-table source
must follow the structural migration gate rather than being silently
reinterpreted; no named data is reset by this code cutover.

The representative calculated-price query in
[query and constraint acceptance](./02-query-and-constraint-acceptance.md)
must select logical indexes for currency/quantity/time/rules and compare
bounded generic results with the pinned native repository. The selected
Product Variant/Pricing/Link workflow now uses three logical participants;
broader calculated Pricing still needs its own proof. PriceList,
PricePreference and other currently unadmitted public operations require
separate native-semantic contracts; compiling their definitions does not grant
runtime capability. The selected physical Pricing DDL/profile and fixtures
are retired. Framework migration-system retirement and any named durable-data
disposition follow the structural migration plan.
