# Native Cart creation preflight

## Status and authority

Status: proposed next connected objective after the bounded
[Variant and item pricing workflow](./159-native-variant-item-price-calculation.md).
Static source tracing is complete; original-native executable characterization,
capacity measurements and adapter admission remain pending.

The executing reference is Medusa 2.13.4, commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded by
`third_party/medusa/SOURCE.json`. The root is `createCartWorkflow` in
`third_party/medusa/upstream/packages/core/core-flows/src/cart/workflows/create-carts.ts`.
The accepted Medusa boundary, shared logical storage and existing workflow
transaction owners remain authoritative. This plan admits no Cart writes or
new resource allowance. Product export and chunked file import remain deferred.

## Connected native closure

The native root selects Sales Channel, Region and Customer in parallel. It
invokes the pricing-context hook, the existing Variant/item pricing child and
inventory confirmation, derives addresses and Customer/currency defaults,
optionally translates data, invokes validation, and creates the Cart. It then
refreshes taxes and promotions, runs payment refresh and `cart.created`
emission in parallel, invokes `cartCreated`, and returns the original created
Cart value. Do not assume that value equals a subsequent persisted Cart read.

| Owner | Existing reuse and required work |
| --- | --- |
| Product and Pricing | Reuse 159's genuine native calculation and complete graph. |
| Inventory | Reuse stored owners; admit native confirmation, its Location projection, Channel and required/available quantity checks, and backorder behavior. |
| Store, Sales Channel and Region | Extend named reads for default-channel selection, native channel retrieval, wildcard fields and Countries. |
| Cart | Add its nine native models, persistence, line items, tax lines, adjustments, totals and raw decimal presentation. |
| Customer | Add the native owner, guest/account/email selection, creation and genuine compensating deletion. |
| Tax | Add native persistence, service and provider registration, including genuine local SystemTax calculation. |
| Promotion | Add native automatic/manual calculation, adjustment writes and Cart-Promotion Link traversal. |
| Payment | Prove the Cart-PaymentCollection graph and conditional service/provider resolution; never fabricate a skipped or successful call. |

Empty Cart input still reaches connected owners. Tax refresh resolves Tax
before its no-context exit and invokes both Cart tax-line setters, including
empty arrays. Promotion refresh invokes `computeActions`; no supplied code
does not exclude automatic promotions. Cart-Promotion queries its real Link
family without codes. Some empty adjustment compensators still resolve Cart.

## Native observations required before implementation

Construct the fixture from genuine native module services, repositories,
Query, stored Links and SDK execution. Freeze source and emitted dependencies,
and execute through ordinary-role PostgreSQL. Reuse existing fixture owners;
do not replace missing modules with canned Query rows or success callbacks.

Characterize these connected cases:

- Empty and populated Carts, supplied/default Channel and Region, addresses,
  currency defaults and native returned values versus final stored state.
- Existing Customers and guest creation, email/account selection, late
  validation failure after Customer creation, and genuine Customer compensation.
- Complete Variant pricing, inventory rejection, required quantities,
  available quantities, Channel membership and backorders.
- Genuine SystemTax calculation with a usable address and TaxRegion,
  automatic and supplied promotions, and complete adjustment/tax-line results.
- Native events, hooks, cancellation, late failure and retained compensation,
  including concurrent payment refresh and event emission.

SystemTax is an actual local native provider; configured external providers may
perform remote effects. Fresh Cart creation appears to leave
`payment_collection` absent, but its skipped payment/session calls need an
executable witness. A reachable provider/session path must retain its genuine
behavior or remain explicitly outside the admitted profile.

Verify the actual nested SDK context: acquire/release steps can skip before
Locking resolution when a parent idempotency key exists. Record actual
translation flags, hook registrations and optional Caching resolution. Do not
remove these paths from the native fixture to simplify the dependency graph.

## Admission and implementation gates

Measure the complete participant cohort, calls, events and stored/read graph
before selecting bounds. The cohort may exceed 159's named nine-logical-owner
allowance; no larger allowance is established by this static trace. Default
profiles and physical limits retain their current contracts.

Use the existing trusted outer transaction and publication owners. Untrusted
hooks, workflow pauses and remote provider effects cannot execute inside a
held database transaction. Establish a genuine local execution profile from
the native witness, or address that lifecycle at its owner; do not silently
split the root or introduce another settlement lifetime.

The recorded native Promise/Cause classification issue in
[workflow host composition](../../workflow-foundations/11-workflow-host-composition.md)
remains a separate connected-owner correction. Preserve typed native domain
errors, defects, interruption and complete Causes; changing only an outer
catch or inventing compensation does not resolve it.

After the native baseline, implement the complete admitted closure, then
validate PGlite and ordinary-role PostgreSQL separately, affected owner and
consumer regressions, types, builds, source/promotion/portability checks and
lint. Obtain both required read-only reviews and commit the completed slice.
Bounded private admission will not establish hosted activation, arbitrary
providers/hooks or general Cart workflow support.
