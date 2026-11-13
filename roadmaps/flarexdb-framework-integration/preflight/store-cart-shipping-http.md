# Store Cart Shipping HTTP

Status: private bounded HTTP promotion complete; production activation remains gated.

## Scope and authority

Select pinned `GET /store/shipping-options` and
`POST /store/carts/:id/shipping-methods` together. Genuine native option
discovery and Shipping Method selection run in the existing private Cart host.
The catalog adds the existing Location–FulfillmentSet and ShippingOption–PriceSet
Link owners to Cart's eighteen sources. Shipping discovery selects eighteen
participants without unused Store and Tax capabilities. Selection and the HTTP
mutation roots select nineteen without Store. The existing nineteen-participant
admission bound remains authoritative; standalone Cart roots retain their own
resource selections and Store fallback.

Fulfillment owns native GeoZone, ServiceZone, FulfillmentSet and option-rule
eligibility. Pricing owns flat option prices in the native Cart context.
StockLocation owns Address reads. The local Manual provider owns method-data
validation. The selected native workflows own Shipping Method replacement,
Cart refresh, Tax, promotions and Payment refresh. Core retains queued borrowed
calls, sticky failure, scope exclusion, outcome recovery and sole PostgreSQL
settlement.

Discovery's prepared wrapper has ten recursive nodes and 34 maximum SDK
operations, within ordinary construction. Selection has 132 recursive nodes
and 320 maximum SDK operations, within the existing 243-node Cart mutation
profile and 1,065-operation root allowance. Participant and standalone creation
budgets remain unchanged. The HTTP host retains its 32-host and 8 MiB prepared
resource limits.

The HTTP Shipping Cart profile requires an assigned, nonempty Sales Channel.
HTTP creation supplies one, and Shipping selection validates its presence. A
Cart update's native `input.sales_channel_id ?? cart.sales_channel_id` preserves
it when the input omits the value or supplies null. Independently authored Carts
without a channel refuse with 400 during the existing Cart read, before native
Store fallback. The same-row admission and receipt check belong to the named
Cart profile, so other HTTP Cart reads using that profile share this boundary.
The ordinary standalone Cart profile retains nullable-channel eligibility.

The named Shipping Pricing profile derives 92 native context paths from the
selected Cart/Variant/Product fields, compiled Line Item and Address wildcard
columns, and native Line Item totals with raw companions. Those declared paths
extend the existing 64-leaf allowance for other context data, giving a derived
non-control ceiling of 156. Dynamic JSON descendants still consume the original
64-leaf allowance. Ordinary, standalone creation and ordinary Cart mutation
profiles retain their separate 10, 17 and 64 bounds. Calculation and receipt
validation use the same admission helper; byte, value and read budgets remain
unchanged.

Independent challenges of current Core, accepted direction and pinned Convex
`db914cf06e2b06ee985646611b9e12ed7a770318` identified no necessary Core mechanism
change or divergence. Existing schemas and Link definitions supply the stored
endpoints; no durable-data reset is selected.

The actual native Query and RemoteJoiner own ShippingOptionPriceSet aliases,
forwarded arguments, absent relations and output selection. The
[Local Graph Query owner](../../workflow-foundations/06-local-graph-query.md)
defines native execution and authenticated command/cohort admission. Shipping
does not retain an adapter Link join or response projector.

The Shipping Inventory read profile admits native local `location_levels`
population through the existing Inventory source and checked DML relationship.
It reuses the module's quantity projection and exact receipt validation under
the existing four-level bound. The ordinary Variant price-calculation profile
retains its scalar-only restriction. Safe absent scalar join aids in Cart,
Region and Fulfillment descriptors use their named native DAL projection
policies; malformed paths and unsupported relations still refuse.

The callable workflow query ABI delegates missing singleton Cart validation to
the native RemoteJoiner key validator, retaining the Cart entity's 404 label
instead of the unrelated StockLocation label from the former generic branch.

## Native behavior

GET requires `cart_id` and passes the native `is_return` context. Its workflow
queries the Cart's Sales Channel locations and fulfillment sets, applies native
geographic and option-rule eligibility, resolves flat prices and computes the
`insufficient_inventory` flag at each option's location. The flag does not
remove an option. Discovery does not invoke provider price calculation.

The native GET handler ignores pagination arguments and returns
`{ shipping_options }` without count metadata or a final response projection.
Requested fields are combined with mandatory workflow fields, so `fields=id`
still returns those native fields. Discovery does not add completed-Cart or
required-country prechecks. Complete native candidate cohorts remain bounded
before context-rule filtering.

POST accepts native strict `{ option_id, data? }`. The handler forwards
`additional_data`, but the pinned body validator rejects that member. Cart
response fields are admitted before execution and refetched independently after
commit. Native Cart validation rejects completed Carts.

Selection uses the genuine with-pricing child, validates eligibility and price,
and calls Manual fulfillment data validation. The provider returns the submitted
method data. Flat prices come from Pricing; the Manual provider's unsupported
calculated-price operation retains its native refusal.

A linked option without a matching price may carry `calculated_amount: null`.
The native presence validator accepts null because `isDefined` checks only
undefined. The source port retains that decision order; the existing private
Cart amount authoring contract still requires a numeric amount.

The workflow soft-deletes previous methods, creates the replacement and runs
native Cart item refresh. Shipping Tax and promotion adjustments, Cart–Promotion
Links, Payment Collection amount changes and System Session invalidation settle
with one native `cart.updated` event. Ordinary refresh retains Region automatic
Tax policy; the dedicated Tax endpoint remains the separate forced-calculation
path.

Cart graph presentation retains native Shipping Method totals and exact raw
companions before projection, using the native total-field contract. Direct
Shipping Method creation DTOs retain their original undecorated shape. The
unpriced workflow's internal calculated candidate may own `amount: undefined`;
the source port preserves it until the existing JSON boundary omits the member.
The Cart Shipping relation also retains its native primary key when the Tax
workflow selects amount, option and Tax fields without explicitly selecting ID.
Unrequested name, metadata and parent Cart fields remain omitted. This is native
relation projection metadata; the pinned Tax query remains unchanged.

The existing Promotion profile refuses equal application-method values because
native SQL does not define their relative order. Shipping does not add a
synthetic tie-breaker. Connected positive cohorts use distinct values; equal
values retain their existing refusal and atomic business rollback.

ShippingMethod declares no native cascade-delete relation. Soft deletion and
restore change only that method; Tax and Adjustment children retain their
historical state. Its compiled child foreign keys are restrictive. The native
add-step's physical inverse succeeds for an unreferenced method and refuses a
populated method. Whole-root rollback remains distinct from retained native
compensation and does not invent child cleanup.

## Acceptance and remaining gates

Acceptance requires meaningful eligible/ineligible option discovery, return
rules, geographic and Sales Channel links, flat price context, inventory flags,
provider data validation, repeated replacement history, Shipping Tax and
promotions, Payment refresh, native events, malformed request refusal, complete
rollback, lost acknowledgement and same-key replay. Prove module lifecycle and
retained inverse behavior separately from the connected workflows.

Use PGlite and ordinary-role PostgreSQL for lifecycle and settlement claims.
Actual Workerd HTTP must independently observe durable rows, revisions, indexes
and outcomes after stopping the serving owner and refetch after recreation.
The existing compatibility profile uses `nodejs_compat`; this bounded selection
does not establish all Medusa providers, general framework support or capacity
acceptance. Remote fulfillment providers, calculated provider prices, checkout
completion, mixed deployment and production activation remain separate gates.
