# Native Product Deletion Workflows

## Status And Authority

Status: implemented bounded private Product and Variant deletion admission.

The connected slice is the actual `deleteProductsWorkflow` and
`deleteProductVariantsWorkflow`, including their `deleteInventoryItemWorkflow`
child. Each facade selects one atomic root and its authenticated module
capabilities. Production and hosted activation remain separate gates.

Authority remains the accepted Flarex design and package boundaries, the owning
Medusa roadmap, current executing code, and Medusa 2.13.4 at fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded in
`third_party/medusa/SOURCE.json`. The source island stays read-only. Existing
creation, update, stocking, reservation and Link profiles retain their contracts.
General deletion, restoration, durable-data destruction and hosted activation
remain separate gates.

## Pinned Sources

Paths below are relative to `third_party/medusa/upstream/`:

- `packages/core/core-flows/src/product/workflows/delete-products.ts:56-134`
- `packages/core/core-flows/src/product/workflows/delete-product-variants.ts:57-124`
- `packages/core/core-flows/src/product/steps/get-products.ts`
- `packages/core/core-flows/src/product/steps/delete-products.ts`
- `packages/core/core-flows/src/product/steps/delete-product-variants.ts`
- `packages/core/core-flows/src/inventory/workflows/delete-inventory-items.ts:43-61`
- `packages/core/core-flows/src/inventory/steps/delete-inventory-items.ts:12-58`
- `packages/core/core-flows/src/common/steps/remove-remote-links.ts`
- `packages/core/modules-sdk/src/link.ts`, especially native `executeCascade`
  and `delete`
- `packages/core/utils/src/modules-sdk/{medusa-service,medusa-internal-service}.ts`
- Product, Inventory, Pricing and Link DML and canonical joiner configurations
- `packages/modules/inventory/src/utils/apply-mikro-orm-decorators.ts:26-39`
- `packages/database/drizzle/src/schema.ts:110-111` and
  `packages/database/drizzle/src/medusa.ts`

## Native Ordering And Results

The Product root first calls `getProductsStep`. Empty IDs return an empty list;
otherwise the step lists matching Products with their Variants. The parent
derives stored Variant IDs, then queries entity `variants` for `id`,
`manage_inventory`, `inventory.id` and `inventory.variants.id`. Its unchanged
transform determines which Inventory Items are exclusively owned by the
selected Variant set.

It runs the Inventory deletion child before the native parallel declaration of
`Link.delete({ product: { variant_id, product_id } })` and Product soft deletion.
It emits `product.deleted` for the original input IDs, in input order, and runs
`productsDeleted({ ids })`. The Product deletion step calls
`softDeleteProducts`; it is not physical Product deletion. The step's void
result becomes null at the existing completed-workflow JSON boundary.

The Variant root queries the same complete ownership graph first, but removes
Variant Links before invoking the Inventory child. Its ownership transform uses
the captured graph from before Link deletion. It then calls
`softDeleteProductVariants`, emits `product-variant.deleted` for the original
input IDs in their input order, and runs `productVariantsDeleted({ ids })`.
Its completed result is likewise null.

This ordering is a material rollback requirement. In the Variant root, a later
Inventory reservation refusal occurs after Link deletion and native Pricing
cascade. Those earlier changes must all roll back. The Product root reaches the
Inventory reservation guard before its Product and Link deletions. Keep native
step dependencies, native Link concurrency and compensation declarations; use
the existing atomic transaction-covered compensation seam and one outer
settlement rather than invoking inverse writes to repair a failed root.

The promoted private atomic SDK orders declaration effects. The Product
composer therefore declares the source's sibling Link removal and Product
soft deletion in Link-then-Product order, after the Inventory child. This is
one serialization of those independent native siblings within the admitted
atomic profile. Native Link's own concurrent cascade dispatch remains intact.
This admission does not establish general native `parallelize` support or
execution across remote effects.

## Inventory Ownership And Reservation Guard

The native selected-Variant map contains every queried selected Variant,
including those with `manage_inventory: false`. Only selected Variants with
truthy `manage_inventory` contribute candidate Items. A candidate is selected
for deletion only when every inverse-linked Variant ID belongs to that map.

An Item shared with any outside Variant therefore survives, including an
outside Variant whose Inventory management flag is false. If all selected
Variants have false flags, no Item is selected. A mixture of true and false
selected Variants can jointly own an Item that is deleted. The native transform
skips null Inventory entries. Do not replace these conditions with a different
ownership rule or infer completeness from a truncated inverse list.

The child queries entity `inventory` for `id` and `reserved_quantity`, by its
candidate IDs. `validateInventoryDeleteStep` rejects Items for which
`MathBN.gt(reserved_quantity, 0)` is true, preserving the native invalid-data
error. The condition is positive quantity, not an adapter-defined generic
nonzero predicate. Zero-reserved Items can proceed. Only after this check does
the child call `softDeleteInventoryItems`, then
`Link.delete({ inventory: { inventory_item_id } })`. It returns its original
input ID array.

Inventory Item DML cascades to `location_levels` and `reservation_items`.
Product DML cascades to Variants, options and images, and options cascade to
values. Variant DML does not declare a deletion cascade into its option values
or Product images. Soft deletion does not authorize physical removal of silent
membership pivots or unrelated endpoint records.

## Computed Inventory Read Disposition

There is a source gap to resolve before claiming native compatibility. The
Inventory Item model declares `reserved_quantity` computed, while the pinned
Drizzle schema compiler explicitly skips computed properties. Its repository
implementation contains no Inventory quantity formula. The actual reserved
quantity formula is supplied only by the Inventory MikroORM decorators:
`SUM(inventory_level.reserved_quantity)` over levels for the Item whose
`deleted_at` is null, with a Number serializer. The native child nevertheless
requests this computed field before deciding whether deletion is allowed.

The accepted implementation disposition is an Inventory-owned, named bounded
computed read derived from that pinned Inventory formula over existing active
level data. It must reuse existing admitted bounded reads and exact quantity
handling, and preserve the native comparison and observable quantity
representation. The named projection sums checked exact persisted quantities
before applying the native Number serializer. A complete empty SUM is null,
whose native Number serialization is zero. Active levels must fit the two-level
envelope; malformed, non-finite or incomplete results refuse.

The facade and shared Query router must not sum levels, fabricate zero, or
import the ORM. This does not authorize new SQL, new aggregate persistence, a
second quantity authority, or a fake stored column for the computed field.
Inventory owns the quantity semantics; shared graph infrastructure owns only
the authenticated projection and routing contract. Incomplete level reads must
refuse rather than understate reservations.

## Finite Envelope

These named bounds do not widen existing profiles implicitly.

- At most four input ID entries and four unique target Products or Variants.
  Product deletion admits at most four total owned Variants, two images and one
  option with four values per Product, and four tags/categories per Product.
- At most two Inventory edges per selected Variant: eight candidate Items.
  Admit at most four inverse-linked Variants per Item, hence 32 inverse edges
  and at most 28 distinct Variant identities including retained outside owners.
  The authenticated inverse endpoint read has an explicit 32-row ceiling.
- Per candidate Item, at most two levels and one reservation: at most eight
  Items, 16 levels and eight reservations in the Inventory lifecycle closure.
- At most four linked PriceSets, each with two base Prices and two PriceList
  Prices, and one PriceRule per Price. Reuse Pricing's authenticated lifecycle
  and keep PriceList endpoints independent.
- Each Product retains the existing two-Sales-Channel/one-Shipping-Profile
  envelope. Their endpoint services are not deleted by Link cleanup.

Lifecycle bounds must cover persisted descendants actually traversed by native
deletion, including already-soft-deleted descendants, rather than only the
visible preimage graph. Complete inverse-reference and lifecycle selections
must either fit the named envelope or fail closed. No pagination truncation,
default empty relation or unsupported shared-reference assumption is allowed.

The complete event envelope is 36 Product-owned transitions,
32 Inventory transitions, 36 Pricing transitions, up to four native Link
envelopes and four workflow events: 112 for Product deletion. The corresponding
Variant root has four Variant transitions, 32 Inventory, 36 Pricing,
up to two Link envelopes and four workflow events: 78. Link envelopes batch
their detached identities; module transitions and workflow events retain their
own native families. Missing and already-deleted targets contribute workflow
events for requested IDs without inventing module transitions.

The named root allowance is 512 calls, 128 events and 2 MiB, with ordinary
128-identity participant working sets and default OCC. Reuse explicit queued
operation scheduling for native concurrent Link calls. Deletion selects ordinary
publication; it does not inherit update-specific mixed publication or raise
shared defaults.

## Executing Owners

Product owns named list/soft-delete workflow methods over its existing command,
value, lifecycle and event owners. Public and internal lifecycle calls preserve
native empty, missing and duplicate membership semantics. Receipts derive
eligible requested roots from observed rows and first mutation preimages,
authenticate unchanged restores through core-owned operation rows, and require
their complete lifecycle coverage. Descendant ownership follows the selected
Product, including option-value ancestry. The native internal empty result is
`[[], {}]`; the workflow facade's completed void result is null.
Workflow events are based on requested IDs, which can differ from changed IDs.
Validate their native order against authentic call input, independently from
the module's actual transition evidence.

Shared Query owns a bounded authenticated cross-module projection through the
canonical ProductVariant–InventoryItem Link and back to every linked Variant.
The deletion Link profile declares only `inventory` and `inventory.variants`
on the Variant root. Query derives endpoint and Link columns from pinned
aliases/extends, resolves authentic selected commands, and checks complete
counts, endpoint identities and per-source bounds. Native relation grouping
and partial-result projection retain their owners. The native ownership
transform stays in the composer. Other profiles keep their existing paths.

Inventory owns its named deletion admission, computed read, real
`softDeleteInventoryItems` method, DML lifecycle traversal and item/level/
reservation receipts and events. The named `product-deletions` profile uses
existing shared Medusa lifecycle mechanics for Items and their owned children.
Existing Items/Levels/Stock workflow profiles expose neither the Item deletion
method nor the computed graph field. Compensations do not grant a public
restoration capability.

Link owns a deletion-specific resource accepting Product selectors with
`product_id` and `variant_id`, and Inventory selectors with `inventory_item_id`.
Its named deletion profiles admit native Sales Channel/Shipping Profile
soft deletion, Variant Link deletion and PriceSet cascades, complete return
tuples and sticky callback failures. Only the reverse Inventory selector gains
the eight-Item allowance. Each selected Link lifecycle closure must be complete
and fit eight rows before writes. Existing update and creation resources keep
their identities and native methods. Mutable array declarations attach limits
after mutability conversion so their existing bounds remain enforced.

## Conformance And Remaining Gates

The promoted two Product composers, get/delete steps, Inventory child and
validation/delete steps use narrow portable imports and existing SDK seams.
The conformance boundary covers requested-ID ordering, null outcomes, native
hooks/errors, empty and missing calls, duplicates, callback refusal and one
outer settlement.

Regression coverage must retain:

- Exclusively owned and shared Items, outside false-flag Variant retention,
  all-false selected Variants and mixed true/false selected owners.
- Zero and positive reserved quantities, exact numeric boundaries, empty and
  soft-deleted levels, and refusal of an incomplete computed-read closure.
- Variant-root reservation failure after actual Link/Pricing deletion, plus
  both completion-hook failures, with full rows/events/commits rollback.
- Empty, missing and duplicate IDs with native module effects and workflow
  event order checked separately.
- Both actual maximum roots, exact event families, call/byte use, and one-over
  inverse-reference, level/reservation and persisted-history closure refusal.
- Same-key replay, lost commit acknowledgement, OCC conflict, cancellation,
  escaped resource refusal and two-shop confinement.
- Focused PGlite and ordinary-role PostgreSQL owner/consumer regressions,
  affected typechecks and promotion/source guards, required lint and both
  read-only project reviews on the final checkpoint.

General deletion/restoration, arbitrary remote graph expansion, arbitrary
Inventory histories or shared references, durable destructive operations,
scale claims and hosted activation retain their separate gates. A passing
bounded slice must not be described as general native deletion support.
