# Native Variant and line-item price calculation preflight

## Status and authority

Status: implemented for the bounded private native read profile on PGlite and
ordinary-role PostgreSQL. Native characterization and both adapter database
lanes retain the original projection, pricing and failure behavior.
The preceding [Price List Price batch](./158-native-price-list-price-batch.md)
is admitted with its approved, identity-bound 256-call profile. That allowance
does not extend to this root. Product chunked file import and Product export
remain deferred.

Authority remains the accepted [Medusa boundary](../../../design-notes/flarex-db-accepted-design.md#medusa-boundary),
[package boundaries](../../16-package-boundaries.md) and
[source promotion contract](./04-medusa-fork-source-island-and-package-convergence.md).
The source is Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded in
`third_party/medusa/SOURCE.json`.

The next connected root is `getVariantsAndItemsWithPrices`, workflow ID
`get-variant-items-with-prices-workflow`, in
`third_party/medusa/upstream/packages/core/core-flows/src/cart/workflows/get-variants-and-items-with-prices.ts`.
Its original children are `useQueryGraphStep` and `getVariantPriceSetsStep`;
the latter calls the genuine Pricing module's `calculatePrices`. The original
`prepareLineItemData` owns the final line-item conversion. This is a read
calculation branch, not Cart persistence admission.

## Native closure and behavior

The default Variant projection requires Product, Pricing, Inventory, Stock
Location, Sales Channel and Fulfillment ShippingProfile reads. Four stored
Link families participate: Variant–PriceSet, Variant–InventoryItem,
Product–ShippingProfile and SalesChannel–StockLocation. InventoryLevel's
`location_id` reaches StockLocation through the native read-only extension;
it is not another authoritative Link table. Stock Location rows still come
from their genuine read owner; a missing or deleted endpoint is not fabricated
from the Level's stored ID. Product type and collection are
module-local relationships. Cart, Region and Customer are supplied values;
this branch introduces no corresponding module reads or Cart writes. Native
SDK EventBus and optional Workflow Engine resolution remain infrastructure
dependencies. No File or provider effect is needed.

Preserve the following original behavior, including inconvenient outcomes:

- Explicit `variants.id` wins, including an empty array. Otherwise Variant
  selection prefers `cart.items` to `input.items`; pricing and final line
  items prefer `input.items` to `cart.items`.
- Both original graph requests retain their aliases, projections and cache
  hints. The first uses `variants` with the complete native default fields;
  the second uses `variant` with `id` and `price_set.id`. A minimal explicit
  field set does not establish support for the default projection.
- Context merges selected Cart fields, Customer and Region objects and the
  caller's pricing context before the final currency, IDs, quantity and
  `is_custom_price`. Native context grouping and item ID/hash behavior remain
  native. Observe what survives actual SDK materialization before deciding
  which own undefined properties reach Pricing.
- Currency remains optional in supplied transport for empty or manual-item
  paths that create no Pricing group. Each actual group retains the original
  required-currency guard after the native Cart/Region fallback. Missing
  currency raises `MedusaError` with type `INVALID_DATA` and message
  `Method calculatePrices requires currency_code in the pricing context`.
  The existing Commerce failure boundary preserves that native error in its
  cause; a generic `invalidInput` refusal must not replace it.
- The pricing step computes `is_custom_price` from `!!item.unit_price`;
  final preparation uses `item.is_custom_price ?? isDefined(item.unit_price)`.
  Zero and explicit custom flags need distinct witnesses.
- Pricing's public native service owns sale/override selection, original and
  calculated amounts, PriceRule/PricePreference reads and tax flags. The
  repository row selector alone is not the complete calculation result.
  The pinned repository orders eligible List Prices by specificity and amount,
  without promoting override type. With equally specific sale 7 and override
  15 candidates, the native service selects sale 7 and retains the first
  non-List original: base 10, or quantity tier 8 when eligible. A matching
  region Rule can make the sale tax inclusive while the original remains tax
  exclusive under its currency preference. An override selected without that
  lower sale retains its distinct native override behavior. Do not repair the
  native comment into a different selection algorithm.
- Duplicate items, grouped contexts, result order and in-place attachment of
  calculated prices to a shared Variant stay native. Missing or unpublished
  Variants, missing Links/prices and invalid quantities require original
  failure witnesses; deferred validation may be preceded by a dereference.

The complete 30-case original-native PostgreSQL characterization captures both
actual Query calls, complete default and optional Variant projections, complete
Pricing DTOs and final root results. It covers nested Customer/Region/context
values, boolean and array Rules, zero or positive custom unit prices, native
selection precedence, missing/deleted endpoints and empty items. Empty input
still requires both Query and Pricing resources.
Cancellation and a failed later parent step preserve the read-only business
state and produce no business events. Native SDK event-group release/clear
calls are lifecycle operations, not emitted business events.

The original Pricing call includes `is_custom_price: false`; undefined
Customer/Region members disappear during native SDK materialization. The native
Variant result omits the requested nonpersistent presentation fields and
retains hydration join keys such as `product_id`, rich-Link `variant_id` and
nested InventoryItem `id`. These are native result semantics, not new stored
columns. Complete Query capture includes raw quantities and the nested
Location/Channel graph. Native `stock_locations` remains an array; Level IDs,
Level `inventory_item_id`, rich-Link IDs and Collection IDs are absent from this
selected projection. Product Type and Collection absence is explicit null;
undefined presentation fields are omitted. The boolean-true Rule case also
distinguishes native calculated amount 5 from the supplied custom line price 7.

## Scoped owner corrections

The bounded implementation reuses these owners:

1. The promoted common graph step and direct Query facade share the existing
   bounded complete-result planner. The exact native cache hint is forwarded
   as the second graph argument; calls without it retain one argument.
   `isList` remains a local compatibility shaping option. Unknown cache options
   refuse before dispatch, and the private host remains cache disabled.
2. Checked Product DML owns local Variant–Product–Type/Collection hydration.
   Native Link metadata owns to-one PriceSet and ShippingProfile traversal,
   rich Variant–Inventory traversal and Location–Channel traversal. Genuine
   read-only Inventory Item and Level counts supply quantities through the
   existing repository/projection owners. The native read-only Level–Location
   extension supplies its array relationship. Graph projection preserves the
   captured native join keys, omitted fields and explicit null without adding
   stored columns or constructing business records in the workflow.
3. The separate named Pricing boundary captures complete supplied JSON context
   and invokes the verbatim native required-currency guard before flattening
   or candidate reads, retaining the native failure type/message through the
   existing boundary. It calls the original native flattening utility and admits verified
   primitive/array values after flattening, including boolean false, while
   preserving the older scalar profile's refusals and limit. It does not strip
   nested context or add native attribute-cache support.
4. An authenticated `calculatePrices` workflow method invokes the genuine
   PricingModuleService through the existing module/repository bridge and
   validates the complete returned DTO. All other selected module capabilities
   are graph reads. Original native services retain selection, normalization,
   tax and line-item conversion under the existing single settlement owner.

The existing equality-only PriceRule profile remains in force. Numeric quantity
tiers are distinct from unsupported Rule range operators. Unbounded context,
arbitrary requested fields or graph support must not be inferred from this
workflow's name.

The complete adapter graph preserves nine authentic logical participants: six
native service owners plus Product Links, Variant Links and Channel/Location
Links. The original default-eight host refuses this composition before any
workflow callback on both database lanes. Under the standing authorization for
necessary core corrections, the named allowance selects nine logical
participants through the trusted, identity-bound host API. Default compositions
and every physical binding remain capped at eight; the nine-participant
selection refuses any physical participant. Omitted, explicit eight and
explicit nine allowances have distinct request identities. The original
64-call root also refuses the complete default graph. Under the same standing
core authorization, this root selects its own named 256-call outer allowance,
including four distinct contexts and the combined stored Pricing fixture.
The 64-event ceiling, existing ten-second command deadline, participant
resources and other limits remain unchanged. This read root admits zero
business events. Bounded admission preserves both default-profile refusals;
the logical-only participant and call allowances do not extend other roots.

Each effective item array and the explicit Variant ID array admit up to four
raw entries, with numeric quantities and optional custom prices, supplied Cart/Customer/Region
JSON values and the native default Variant fields. The stored graph admits four
Products and Variants, four PriceSet Links, four ShippingProfile Links, eight
rich Inventory Links, four Inventory Items, sixteen Levels, four Stock Locations,
four Sales Channels and eight Channel/Location Links. Pricing candidates retain
their existing complete indexed-read bounds: selector cohorts contain at most
sixteen IDs per indexed selection, with the default 256-row `queryRows` ceiling
and unchanged participant working-set, identity, byte and node bounds. The
outer root's distinct aggregate allowance remains 256 calls under the existing
ten-second command deadline. A cohort must be complete or refuse; it is never
silently truncated.
Pricing retains equality Rules and at most ten flattened
non-currency/non-quantity context attributes.
The native eleven-attribute characterization does not extend that boundary.

The combined Pricing capacity fixture contains two base Prices per selected
PriceSet, four Lists with two Prices and two List Rules each, two Price Rules
per List Price, and two context Preferences. It exercises all four distinct
quantity contexts with the complete Product/Inventory graph. That fixture is
not proof of every possible stored Pricing maximum: other admitted profiles can
leave additional active or historical Prices and Rules. Those cohorts remain
subject to the same complete-read and aggregate limits and may refuse. Final
admission must retain this boundary rather than advertise arbitrary historical
Pricing capacity.

## Separate Product setup limitation

A genuine setup root creating one Product with four Variants can fail with
ordinary PostgreSQL SQLSTATE `57014` while publishing `fx_app_row_rev` under
the existing Product command deadline. This Product creation reliability issue
remains unresolved and is preserved independently of 159 capacity and semantic
validation. The read fixture creates its maximum cohort through four genuine
single-Product setup roots, each with one Variant, before invoking the complete
159 root once. That fixture composition neither splits a production workflow
nor extends its deadline, and does not establish reliability of the original
one-Product/four-Variant creation root.

## Implementation and validation sequence

1. Assemble an external original-native producer using six actual module
   services, ordinary-role PostgreSQL repositories, all four real stored
   Links, the native read-only extension and genuine merged RemoteQuery.
   Freeze executing source, emitted bytes and dependency identities. Fixture
   construction is scoped module assembly, not complete app bootstrap.
2. Characterize complete default projection, empty-resource resolution,
   nested/boolean context, custom zero/nonzero prices and native failures.
   Record complete result values, actual calls and unchanged business tables
   and events through normal completion, cancellation and late parent failure.
3. Set bounded admission from those observations. Reuse or correct native
   fork, graph, module and shared storage owners as necessary. Preserve the
   original witness separately from any proposed native business correction;
   obtain an explicit decision for such a divergence.
4. Validate the actual admitted native root and connected owner regressions
   separately on PGlite and ordinary-role PostgreSQL. Run affected types,
   builds, source/promotion/portability guards and lint, then both required
   read-only reviews. Stop owned runtime resources and commit the complete
   slice. Bounded private admission does not establish hosted activation,
   arbitrary Cart workflows, scale or production cache behavior.
