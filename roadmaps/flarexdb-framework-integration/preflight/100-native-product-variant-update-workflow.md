# Native Product Variant Update Workflow

## Status And Outcome

Status: implemented bounded profile.

The next connected Product milestone is the actual
`updateProductVariantsWorkflow`, including existing-variant edits, replacement
of base prices, Inventory-Link dismissal and the native completion hook/event.
The owner authorizes continued preflight, implementation, necessary adapter/fork
and shared-core corrections, validation, review and scoped commits one slice at
a time. This does not authorize destructive durable-data changes or hosted
activation. Existing creation, stocking, reservation and location-Link profiles
remain supported.

The larger `updateProductsWorkflow` remains the following Product milestone.
It additionally needs Product upsert workflow methods, previous-variant reads,
Sales Channel/ShippingProfile replacement, endpoint-selected Link deletion and
the `upsertVariantPricesWorkflow` child. These are connected later gates, not
prerequisites for standalone native variant updates.

## Native Source And Executing Boundary

Authority is Medusa 2.13.4 at fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded in
`third_party/medusa/SOURCE.json`. The source island is read-only. Relevant files
under `third_party/medusa/upstream/` are:

- `packages/core/core-flows/src/product/workflows/update-product-variants.ts`
- `packages/core/core-flows/src/product/steps/update-product-variants.ts`
- `packages/core/core-flows/src/product/steps/get-variant-pricing-link.ts`
- `packages/core/core-flows/src/product/steps/dismiss-product-variants-inventory.ts`
- `packages/core/core-flows/src/pricing/steps/update-price-sets.ts`
- `packages/modules/product/src/services/product-module-service.ts`
- `packages/modules/pricing/src/services/pricing-module.ts`
- `integration-tests/modules/__tests__/product/workflows/update-product-variants.spec.ts`
- `packages/modules/pricing/integration-tests/__tests__/services/pricing-module/price-set.spec.ts`

The executing packages promote the actual parent composer, variant update step,
Pricing update step and Link lookup/dismissal steps. The named Product variant
update view uses existing command owners; the image workflow retains its
thumbnail-only selector contract. Pricing's explicit `variant-updates` profile
admits the native Price/PriceRule mutation closure, while its default creation
profile retains its existing method selection. Variant Link preparation admits
Inventory dismissal only in the explicit update profile.

Native preimage selections contain DTO-only fields. The named workflow list
methods follow the pinned Drizzle projection behavior: retain primary keys and
select actual stored columns. Ordinary reads retain strict projection admission.
The workflow outcome boundary captures native optional `undefined` members as
omitted JSON properties before core settlement. Neither seam changes the native
business algorithm or introduces another settlement owner.

## Native Trace And Compatibility

1. The composer removes `prices` from Product inputs. The batch step requires
   every variant ID, skips Product list/upsert for an empty batch, otherwise
   captures previous rows and calls native `upsertProductVariants`. The selector
   branch captures selected fields/relations before `updateProductVariants`.
   Native Product service normalization, option validation and missing-ID errors
   remain authoritative.
2. Explicit `manage_inventory: false` selects variant IDs for Link-root graph
   lookup and native tuple dismissal. Empty IDs still resolve Query and Link
   before the step's early return. Nonempty dismissal records the old endpoint
   pairs for declared compensation. Inventory items, levels and reservations are
   not deleted or adjusted. Setting the flag true does not create or reattach
   Inventory links in this native workflow.
3. Only variants with an explicitly supplied `prices` value request Pricing
   links. Omitted prices skip that lookup; `prices: []` is truthy and requests
   removal of base prices. The lookup skips Link resolution for empty IDs;
   otherwise native `getLinkModule(...).list(...)` selects endpoint columns and
   the native count/missing-ID check rejects missing associations.
4. The Pricing step resolves Pricing even when its input is `{}`. That branch
   returns an empty result without reads/writes. Batch price-set inputs capture
   old sets and call native `upsertPriceSets`; selector inputs capture native
   fields/relations and call `updatePriceSets`.
5. Native Pricing normalizes base prices, matches existing IDs, creates/updates
   incoming prices and physically deletes omitted base prices. Rule replacement,
   clearing and omission retain their native meanings. The existing-price query
   includes `price_list_id: null`; associated PriceList prices must survive.
   Exact numeric/raw pairs, generated identities, relation rereads, native event
   capture and result assembly remain with their existing owners.
   The native rule-update path creates new rules before deleting old rules. A
   retained Price with replacement rules using the same attribute/operator can
   collide with PriceRule's active unique index. Preserve a failing witness and
   characterize both database lanes; do not reorder the native algorithm in the
   adapter or weaken uniqueness. Rule omission, clearing and replacement using
   different keys retain their independent admission. A native behavior
   correction needs its own explicit disposition after native constraint proof.
6. Output variants receive `price_set` from the sets updated by this execution.
   Omitted price work does not trigger an extra hydration read. The composer
   emits ordered `product-variant.updated` workflow messages and runs
   `productVariantsUpdated` with `additional_data` before completion.

Keep native compensation declarations. The atomic host rolls back failed roots;
it must not execute inverse writes as a substitute for rollback. Preserve empty
calls, duplicate delegation, order, missing-link failures and native response
shape. This trace is static evidence, not an executing compatibility claim.

## Proposed Finite Admission

- Batch `product_variants` contains zero to four entries, each with an existing
  variant ID. Selector/update admits an ID or up to four IDs, including an empty
  ID array, with native selected-result behavior. No general predicate updates.
- Derive admitted variant scalar edits from checked Product metadata and reuse
  existing option-value update behavior. Parent identity changes, new variants,
  inline Inventory association edits and arbitrary module-local creation remain
  outside this root. Preserve nullable fields and native Variant metadata
  replacement: `updateVariants_` calls internal-service `upsertWithReplace`,
  bypassing the separate scalar `update` metadata-merge path. Pinned Drizzle
  replaces the supplied JSON column rather than merging its previous keys.
- Each selected set has at most two existing base prices and at most two incoming
  prices, each with at most one admitted string-valued rule or a null-valued
  rule removal. Retain native
  create-versus-partial-update field requirements; do not reuse a create-only DTO
  as the partial-update decoder. Oversized persisted closure must fail through
  the appropriate owner before publication, rather than truncate old rows.
- Each variant has at most two existing Inventory links. This root dismisses
  those links only when the native composer selects them.
- Admit a named 256-call/64-event root using the existing typed budget issuer.
  Existing profiles and byte, row, fact, deadline and isolation limits retain
  their contracts. Prove the maximum mixed graph first. If it cannot fit, revise
  the named admission explicitly; never silently raise a shared default.
- Retain default atomic OCC. No native Locking resource is resolved by this
  composer, and it performs no stock arithmetic or reservations. Concurrent
  competing updates require ordinary-role PostgreSQL proof.

## Construction And Implementation Order

1. Prove the native Pricing update path at its owning repository/value/event
   boundary. Reuse shared scalar reads, keyed writes, graph insertion, lifecycle
   deletion and event mechanics. Admit the exact Price/PriceRule reads and
   mutations required by the native algorithm, including preservation of
   PriceList prices and exact numeric companions. Keep unsupported Pricing
   methods refused. No adapter SQL, replacement business algorithm or new
   transaction/lifecycle owner.
2. Extend Product workflow methods over existing update/upsert command owners.
   Keep the image workflow's thumbnail-only contract intact while giving this
   named slice the metadata-validated edits it requires.
3. Extend the existing native Link resource and per-source method bindings with
   selected dismissal and exact Pricing-Link list operations. Preserve schema
   source/table identities and source-local mutation receipts. The synchronous
   native `getLinkModule` returns a service object; the current composed-resource
   ABI returns asynchronous JSON. Do not pretend those contracts match or expose
   a raw service. Prefer a narrow portable fork lookup seam: move only this exact
   native service selection/list invocation behind an authenticated JSON-returning
   resource operation, retaining the native missing-link algorithm in the step.
   Reuse the actual native Link router for service selection and dismissal.
4. Promote the composer and required steps with source hashes and narrow imports,
   adding transaction-covered declarations at the existing SDK seam. Prepare one
   facade under `src/workflows/product/`, authentic method selections, checked
   inputs/outputs, native hook adaptation and ordered workflow-event correlation.
   Core alone settles. Use Link-root Query without cross-module hydration.
5. Compose existing Product, Pricing, Inventory, Stock Location and Variant Link
   schema sources as required by their structural closure. Runtime mutation
   grants select Product, Pricing and the Link sources only. Inventory/Stock
   Location schema availability does not grant endpoint writes or remote calls.
   Keep current creation consumers and source identities; no migration/reset or
   displaced public consumer is proposed.

No shared persistence correction is established by this static trace. Any
executing invariant failure needs a retained witness, correct-owner disposition,
owner and consumer regressions. The owner's continuing authorization covers
necessary in-scope core corrections; it does not permit adapter workarounds.

## Validation And Completion Gates

Exercise both native input forms, empty input and empty selectors; native scalar/
option updates and missing-ID behavior; omitted/empty/mixed prices; retained and
replaced IDs; rule omission/replacement/clearing; exact numeric values; preservation
of PriceList prices; missing Pricing links; Inventory management false/true and
zero/one/two stored links; maximum mixed graphs and malformed/managed fields.

Retain the original workflow's empty-list and both failing-hook rollback
witnesses. Distinguish its native runner error envelope from this private host's
typed failure contract instead of weakening original source assertions. Add late
failure after price deletion and Inventory dismissal, sticky caught refusal,
escaped capabilities, cancellation, replay/changed identity, uncertain settlement,
forged construction tokens and two-shop confinement.

PGlite proves its functional lane. Ordinary-role real PostgreSQL independently
proves native deletion/constraints, rollback and competing updates. Regress Product
creation, Pricing creation/calculation, Variant Inventory, image workflows,
stocking, adjustments/reservations and Sales Channel/location links. Run affected
types/builds, source-island/promotion/test-port/browser guards, core/diff lint and
exact staged lint. Both required read-only project reviewers must review the
exact owned checkpoint; correct findings and rerun affected validation before a
scoped implementation commit.

Whole-Product updates, variant insertion/removal, endpoint lifecycle cascades,
general PriceList updates, arbitrary graph hydration, Cart/Order, durable remote
delivery, hosted activation and scale remain separately preflighted outcomes.
