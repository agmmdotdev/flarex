# Native Price List creation preflight

## Status and closure

Status: implemented for connected bounded private execution.
Product chunked file import and Product export remain deferred.

Authority is Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded in
`third_party/medusa/SOURCE.json`. The original root is
`packages/core/core-flows/src/price-list/workflows/create-price-lists.ts`.
It executes adjacent original steps `validate-variant-price-links.ts` and
`create-price-lists.ts`, returning complete native DTOs in input root order.
It retains actual created root IDs for physical deletion.

Query and Pricing are required even for an empty outer array, which makes no
actual public calls. Nonempty lists with omitted or empty prices still call
Query with an empty variant selector before Pricing creation.

The closure needs existing Pricing, the stored ProductVariantPriceSet Link
graph and authenticated workflow Query. Its flat fields are `variant_id` and
`price_set_id`. No Product or PriceSet endpoint hydration, Link writes, Region,
provider, File handling or remote effect is required.

## Original native evidence

The immutable packet `%TEMP%/flarex-152-native-price-list-create-witness`
executes the original root and both complete steps, generated/internal Pricing
services, default MikroORM, all six Pricing models, real LocalEventBus, original
Query/RemoteQuery/RemoteJoiner and the generated stored Link service on
ordinary-role PostgreSQL. Source/emission, dependencies, arguments, complete
DTOs, DML history, events, SDK state and cleanup are preserved.

Link rows are created through genuine routing with original Product/Pricing
joiner metadata. Product persistence is absent because no endpoint read
executes. The native Link schema has no endpoint foreign keys; actual fetches
are checked to target the Link service alone. Versioned instrumentation and
filesystem-audit corrections remain separate from unchanged native evidence.
Outside-DTO runtime probes do not widen admission.

## Native contract

The workflow DTO requires string title and description, with optional status,
nullable/optional date strings, optional prices and generic list rules. Prices
have variant ID, currency and numeric amount, optional nullable quantities and
generic scalar rules. Module-only `type` and operator-array probes are outside
this DTO.

Defaults are draft status, sale type, null dates and empty child arrays. Native
empty strings, currency case, negative/fractional amounts and quantities,
reversed quantity ranges, empty membership arrays and duplicate membership
values remain accepted. No storefront validation is added.

Valid dates normalize to ISO instants. Equal/reversed date ranges succeed.
Invalid nonempty dates fail native validation before writes; empty strings
reach the native invalid-time failure. Both leave no partial graph or events.

Native price-key normalization retains the last amount and first key position
for duplicates. Rule insertion order affects priorities and the key.
PriceRules use `eq` and bounded priorities zero and one. Rule counts count
attributes; ListRule arrays preserve original values and order.

Public Query and RemoteQuery retain raw selector order and duplicates. Native
RemoteJoiner filters nullish values and deduplicates in first-occurrence order
at its fetch boundary. The maximum candidate has eight raw entries over four
distinct endpoints. Empty strings survive. Missing/deleted Links fail native
validation with raw missing-ID order and duplicates. An active Link to a
historical PriceSet is accepted; no endpoint liveness check is introduced.

Complete outputs contain root scalar fields, `prices` and `price_list_rules`;
Prices include raw numeric metadata and `price_rules`. Child IDs, foreign keys,
timestamps, operators and priorities are validated before projection.

The maximum native graph has four roots, eight Prices, eight ListRules and
sixteen PriceRules: 36 rows and created events. The late-parent inverse adds
four root-deleted events, totaling 40. These are native observations, not
adapter command accounting or capacity proof.

Native creation emission order is roots, ListRules, Prices, then PriceRules,
with each group's actual DTO order. The finite list catalog preserves that
sequence; event receipts verify ordered vectors rather than membership alone.
Other Pricing catalogs retain their own ordering.

The inverse removes complete descendant graphs, including history, outside
edits and later-added children, while preserving PriceSets, base Prices,
preferences and Links. Only actual deleted roots emit deleted events;
database-cascaded children add no invented families. Already-absent roots are
successful zero-write/zero-event no-ops. Empty retained IDs skip inverse calls.
The bounded inverse uses the existing identity-bound storage-insertion root
read before unchanged lifecycle planning/application. This matches observed
native root traversal without guessing lexical or selector order. It does not
assert a universal PostgreSQL physical-return ordering guarantee.

Native SDK cancellation reuses the original transaction handler/container;
supplying a separate container does not revoke it. Finite adapter fresh-attempt
binding, revocation and settlement require their own proof and establish no
post-completion scheduler cancellation support.

## Erased type seams

The original program supplies explicit undefined quantities/rules and an
undefined map on the empty validation branch. Narrow DTO adaptations record
those actual values while retaining required PriceSet identity. The original
nonempty lookup uses erased non-null operators after its genuine validation;
the existing Query function type annotates the container resolution. Exact
source guards compare the complete emitted programs and pin these declarations.
No runtime guard, default, fallback object or normalization is added.

The portable SDK already captures/resolves nested step references, including
optional results, but its former authoring signature could not express this
native input object. Its StepFunction input type now describes recursive
literal containers and typed references, preserving Date/function boundaries
and rejecting incompatible branded outputs. Runtime capture, resolution and
authority remain unchanged. Neutral type/runtime coverage and the complete
native consumer establish separate owner and integration obligations.

## Connected plan and admission gates

1. Extend the existing workflow Query and Link read owners for the exact
   `product_variant_price_set`/`variables.variant_id` ABI. Preserve raw public
   arguments and metadata authority. Allow empty query strings without widening
   stored/mutation IDs. Use genuine graph reads, including empty selectors.
2. Add `price-list-creations` admission to existing Pricing, exposing creation
   and physical inverse with graph access off. Replace positional configuration
   with its admission union. Complete native list inputs, defaults, generic
   rules, priorities and DTOs; remove displaced Product-specific list inputs
   and shallow receipts while preserving other admissions.
3. Reuse native normalization, complete DML contracts, graph writers and the
   shared lifecycle/reference owner. Prove every created row/event, complete
   inverse removal, actual deleted-root events and protected data. No adapter
   SQL, copied normalization or additional transaction is admitted.
4. Promote the original root and steps through direct portable imports and
   explicit transaction-covered inverse metadata. Wire authentic Pricing and
   read-only Link/Query resources, retaining empty calls and compensation.
5. Validate genuine callbacks, DTOs, normalization, errors, history/interference,
   no-ops, rollback, retries, replay, revocation, cancellation and maximum demand
   on PGlite and ordinary-role PostgreSQL. Run affected consumers, types,
   portability/source guards, lint, both required reviews and cleanup before
   committing.

Forward bounds are zero to four lists, two prices per list, four distinct Link
endpoints, two PriceRule attributes per price and two ListRule attributes per
list with two string values each. Historical inverse cleanup uses existing
shared resource bounds. Existing 64-call/64-event, byte and deadline limits
remain unchanged; actual adapter accounting is an admission gate.

No native business correction is indicated. Production activation, durable
external event delivery, arbitrary scale and cold recovery remain separate.
