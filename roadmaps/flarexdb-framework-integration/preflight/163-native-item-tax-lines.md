# Native item and shipping tax lines

## Status and authority

Status: selected native contract characterized; the shared null-constraint and
partial-index prerequisite is implemented. The bounded SQL-real prerequisite
is validated through ordinary execution and finite capture on both database
lanes. The bounded native Tax adapter is admitted on PGlite and ordinary-role
PostgreSQL. The independent child is `tax/steps/get-item-tax-lines.ts`, composed
as one private workflow around the genuine `getItemTaxLinesStep`.

The executing reference remains Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. Accepted shared logical storage,
framework ownership and workflow lifetime boundaries remain authoritative.
Standing approval covers necessary core corrections. No native business
correction or larger resource allowance is selected by this preflight.

The original characterization and the separate full-graph supplement remain
distinct. The complete original matrix covers native branching, selection,
provider resolution and numeric observations. Supplementary complete graph
cases establish complete mixed-rule and item/shipping candidate cohorts,
including late parent failure. Observer capture failures remain harness
failures, separate from native Tax outcomes and any business correction.

## Connected native contract

Inputs are supplied Cart or Order values, items, shipping methods and optional
calculation flags/address. They are read-only values for this child. It neither
loads nor persists Cart, Order, Customer, Product or Shipping Option records.

Preserve the step's actual evaluation order. Gift-card items are filtered
before Tax resolution. The Tax module is resolved even when no tax context
will be calculated. Automatic taxes or an explicit force flag enable context
construction; forcing calculation without a country produces the native
business error. A missing country without force and disabled automatic taxes
return both empty output arrays.

An explicit non-null shipping address overrides the supplied Cart/Order
address. Customer group IDs, customer metadata, locale, return status and
context shipping methods retain the native projection. Context shipping
methods come from `orderOrCart.shipping_methods`; taxable shipping lines come
from the separate `shipping_methods` input. Preserve this distinction.

Item and shipping calculation calls remain separate, in their native order.
The item call is selected by the original item-array length, so a gift-card-only
array still invokes genuine `getTaxLines([])` after filtering. Empty item and
shipping arrays do not invent module calls. Output remains
`{ lineItemTaxLines, shippingMethodsTaxLines }`, with the native IDs, fields,
array order and scalar rates.

The native provider context also distinguishes omitted fields from own
`undefined` values, including nested metadata. Default workflow method input
capture erases those object properties before the argument decoder runs. The
shared method boundary now offers an explicit `preserveOwnUndefined` selection
and bounded JSON transport through the existing capture owner, as described in
[workflow host composition](../../workflow-foundations/11-workflow-host-composition.md).
The Tax method selects that mode and decodes its complete transported input;
reconstructing a fixed list of Tax keys cannot preserve arbitrary native context.
The outer supplied-value input remains bounded JSON. Native-created intermediate
properties retain their own undefined values; external undefined JSON is not a
new root input contract. Default methods and Query inputs retain their existing
omission policy.

## Tax service and local provider

Use the genuine four-model Tax module and its internal services:
`TaxProvider`, `TaxRegion`, `TaxRate` and `TaxRateRule`. Expose only the
connected `getTaxLines` method to the workflow. Tax configuration writes,
general Tax CRUD and provider administration remain outside this slice.

The native service normalizes country and province codes for Region selection.
It selects country/province Regions, returns no lines without a country-level
Region, and queries complete candidate Rates with their actual Region and
Rule relations. Preserve default matching, Product/Product Type/Shipping
Option rule matching, province precedence, stable equal-priority input order
and the optional combinable parent Rate. Repository translation must retain
complete native candidates rather than replace the service's matching or
priority calculation.

Bind the genuine local Tax provider service and `SystemTaxService` through
their native construction and provider identity. The service selects using
normalized lookup context but passes the original calculation context to the
provider. SystemTax returns native item/shipping tax lines, converts a null
Rate to zero through its existing expression, and identifies itself as
`system`. It does not calculate or persist monetary tax totals.

The executing Tax service and its call receipt reuse the same native pure
selection and SystemTax field projection. The extracted selection retains the
five original matching/priority method bodies, stable candidate order and
combinable parent behavior. The formatter keeps the native lazy identifier
lookup once per emitted line. Receipt validation computes the complete ordered
result from checked cohorts; it neither copies the matching algorithm nor calls
the provider again. Raw read-support observations are fully decoded before the
receipt reconstructs active selections; valid deleted support rows do not become
active Rules or corruption failures. Native default primary-key ordering remains
the candidate Rate ordering.

The private `@medusajs/deps/awilix-portable` entrypoint extracts the pinned modern
Awilix container, resolver, parser and Error classes. Host module loading remains
unavailable. The published browser artifact's Error inheritance does not preserve
the native missing-provider branch, so that artifact is not selected. Exact source
guards authenticate the loader-free extraction and genuine declaration reuse.
Request cradles register the logger explicitly and retain the same stateless
SystemTax instance for one immutable module preparation. Browser-bundle execution
is distinct from Workerd or hosted activation.

Native context declarations now describe explicitly supplied undefined properties
and original shipping BigNumber values. These type corrections preserve the
executing step's projection rather than deleting properties or coercing amounts.

External/remote providers are excluded. No transaction may span a remote tax
request. Supporting such a provider needs a separate workflow boundary and
connected preflight.

## Complete schema and numeric prerequisites

Install all four genuine DML models with their checks, relationships, indexes
and managed fields. The selected read path does not justify omitting inactive
model constraints.

TaxRegion requires both native implications: a non-null parent requires a
null provider and a non-null province. Its active nullable-province uniqueness
also requires a conjunction of two null tests. The implemented
[neutral prerequisite](../../shared-logical-storage/71-null-constraints-and-partial-indexes.md)
extends the existing constraint, partial-index, uniqueness and query-selection
owners through the checked `nullImplication` and `allNull` contracts. It preserves row validation on
deleted data, complete merged updates, initialization, restore/reconstitution,
stored-corruption refusal and both-guard index eligibility. Existing unrelated
predicate families and supported profiles keep their semantics.

The native TaxRate column is SQL `real`, with binary32 storage and the native
database driver's text-to-JavaScript representation. It is not the existing
`doublePrecision` contract. The observed creation DTO, stored value and cold
read can differ; directly applying `Math.fround` to the original JavaScript
input does not reproduce every characterized native case.

The [neutral SQL-real owner](../../shared-logical-storage/72-sql-real-scalar-mechanics.md)
implements decimal-to-PostgreSQL-REAL-to-wire normalization on the existing
borrowed session. It requires actual `extra_float_digits = 1`, preserves
complete row validation after conversion, and rejects noncanonical stored
values rather than repairing them. Its primitive finite/null input check
makes no canonical conversion claim. The neutral installed proof covers ordinary
execution and finite capture on PGlite and ordinary-role PostgreSQL.

REAL literal defaults, REAL-valued index/unique keys, REAL comparison and
sorting, and displaced physical-DDL support remain unsupported. The named
neutral real reference-maintenance gate explicitly refuses terminal set-null
and reference replacement on REAL-bearing source rows; Tax configuration
mutations are not admitted by this read child. Fresh pure canonical validation
without prepared SQL mechanics also refuses REAL. These boundaries do not
permit omitting the native models' reference/check/index declarations.

The scalar proof includes initialization, decimal rounding/ties, maximum/subnormal
and refused underflow/overflow, complete merged rows, cold reads, retained
historical bytes and admitted inverses, actual session refusal, protected finite
capture, canonical corruption and atomic rollback. The shared owner records the
remaining historical-query, fault-injection and reference-replacement proof
limits. Native creation DTO retention remains the framework's
boundary; this prerequisite does not admit general Tax CRUD or change its DTO
normalization. Preserve existing int32, binary64 and exact numeric contracts.

## Bounded admission plan

The implemented branch uses one read-only Tax participant with the complete four
native models. It exposes only `getTaxLines`, retains default 64-call/64-event
limits and the existing outer settlement owner, and admits the complete bounded
item/shipping and Rate/Rule cohorts below. Larger cohorts refuse before provider
output; no partial result is returned.

1. Complete the neutral schema prerequisites and bounded SQL-real owner proof with
   their owning regressions. Preserve original failures and separate corrected
   candidates. Necessary core changes remain within standing approval.
2. Promote the exact native step and the required Tax/SystemTax source closure
   through the existing provenance and portability owners. Preserve actual
   calls, selectors, empty calls, relation hydration, context identity,
   serialization and provider behavior.
3. Bind one checked Tax participant using existing module construction,
   repository, relation, call-local receipt and Promise/Cause owners. Admit
   complete bounded cohorts: at most four item lines, four shipping lines, two
   selected Regions, eight candidate Rates and sixteen Rules, with the genuine
   local provider. Refuse larger cohorts explicitly before returning partial
   results. These are connected read bounds, not general Tax configuration
   limits or arbitrary graph support.
4. Compose the genuine step under the existing outer workflow owner. Retain
   native no-context/gift-card behavior, missing provider and native business
   failures, deleted data exclusion, matching/precedence, complete output,
   original input ownership, replay and late parent rollback. This read-only
   step has no native compensator or Tax mutation/event publication to invent.
5. Measure complete item-plus-shipping calls and events, including the complete
   Rate/Rule cohorts, before selecting resources. Keep the original default
   call, event and other limits until a measured failure and a separate decision
   authorize a named allowance.
6. Validate PGlite and focused ordinary-role PostgreSQL separately, run affected
   types/builds/source/portable checks and lint, obtain both required reviews,
   and commit the connected admitted slice.

The four pending Cart decisions remain outside this child: Country ordering,
Cart-owned Address compensation, Cart–Promotion compensation, and Promotion
threshold/empty-disjunction behavior. This preflight admits no complete Cart
root, Cart writes, Tax administration, remote provider, export/import work or
hosted activation.
