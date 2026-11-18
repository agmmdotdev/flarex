# Native Inventory Item Update Workflow

## Status And Authority

Status: implemented private bounded native profile with the shared finite-number
correction. Populated installation upgrades and hosted activation remain gated.
Authority is the accepted Flarex design, package boundaries, Medusa adoption
roadmap and Medusa 2.13.4 at `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.
The source island remains read-only. Chunked File import and Product export
remain deferred.

This closes a real pending Inventory operation: Product's native child already
creates InventoryItems, the stocking root creates InventoryLevels and the
stock-mutation profile adjusts stock and individual reservations, but existing
InventoryItem scalar repositories still refuse updates. Item attributes are a
connected prerequisite for maintaining those already admitted Products and
Inventory records. Absolute level updates and Inventory deletion remain distinct
native workflow outcomes; do not replace them with stock deltas or broaden this
slice into their guards, cascades or aggregate query dependencies.

## Native Closure

Promote exactly these pinned files:

- `packages/core/core-flows/src/inventory/workflows/update-inventory-items.ts`:
  `updateInventoryItemsWorkflow`, ID `update-inventory-items-workflow`, forwards
  `input.updates` to the genuine update step and returns its array result.
- `packages/core/core-flows/src/inventory/steps/update-inventory-items.ts`:
  `updateInventoryItemsStep`, ID `update-inventory-items-step`, native preimage
  capture, update and compensation callback.

The step resolves Inventory before checking input length. Empty input returns
`[]` with empty compensation fields; it does not list or update, but Inventory
remains a required authentic resource. Nonempty input computes native selects
and relations, then lists full preimages with `{ id: input.map(id) }, {}`. Those
computed selects/relations are compensation data, not a projection for this
forward list. It then calls genuine `updateInventoryItems(input)` once.

The promoted `InventoryModuleService.updateInventoryItems` retains scalar/array
serialization, sanitizes `location_levels` out before passing data to its
transaction-covered helper and delegates to genuine InventoryItem internal
service update. This workflow always uses the array overload. No quantity,
InventoryLevel, Reservation or stored Variant–InventoryItem Link mutation is
part of this path. There is no query graph, remote query, Link, EventBus workflow
step, workflow event/hook, Locking, Stock Location service, File, Region or remote
effect. Native Inventory module events remain required through
`internalModuleWorkflowEvents`.

## Keyed Selection And Scalar Semantics

The genuine `MedusaInternalService.update` builds a keyed data Map and `$or`
selector for data-only updates. Repeated IDs retain the final supplied patch;
there is one selected row per ID rather than one write/result for every raw
request. Missing unique IDs produce its native NOT_FOUND before repository
updates. Do not add adapter deduplication, silently ignore missing IDs or require
output length to equal raw input length.

Use the existing native `preservePrimaryKeyOrFilterOrder` helper over the actual
native built predicate for repository results, not a separately authored ID
sort. Add a pure witness for repeated/out-of-order IDs, including the native
query builder's normalization, before freezing receipt/event order expectations.
The native keyed service merges metadata with the corresponding entity, unlike
the shared selector-patch behavior observed for multi-Location selector updates.
Preserve null, empty object, nested objects and deletion-marker behavior through
the native metadata helper. Native Drizzle's
`packages/database/drizzle/src/medusa.ts` skips a root write and afterUpdate when
scalar update data is empty; an ID-only patch therefore returns the selected
full row without a mutation, updated_at change or update event.

InventoryItem DML owns nullable scalar fields, finite number dimensions,
requires_shipping and active nullable SKU uniqueness. Permit its typed update
attributes: sku, origin_country, hs_code, mid_code, material, dimensions,
requires_shipping, description, title, thumbnail and metadata. Managed identity,
lifecycle timestamps, quantity/computed fields and relation changes remain
unadmitted. The native module's transient-field stripping must retain a pure
witness; public admitted DTOs do not grant arbitrary object keys.

## Implementation Plan And Owners

1. Promote the genuine composer/step with direct child imports, portable SDK
   and narrow existing utility imports. Preserve the genuine compensation code
   with `transactionCovered`; expose narrow workflow/step exports and exact
   source provenance. No native business algorithm needs copying or repair.
2. Add a named `item-updates` Inventory admission with source profile
   `inventory-item-updates`, preserving existing items/levels/stock/deletion/
   batch profiles and callers. Bind genuine listInventoryItems and
   updateInventoryItems methods. Keep all InventoryLevel, Reservation, lifecycle
   and Link mutation methods unavailable in this profile.
3. Extend InventoryItem's repository through existing checked scalar metadata,
   keyed-update planning, native filter ordering and subscribed mutation events.
   Reuse existing owners; do not duplicate transaction logic or import a
   SalesChannel/StockLocation-specific adapter. Scope native selection to the
   requested IDs with complete-set refusal, detached mutable preimages and
   authenticated original rows. Preserve native missing-ID and empty-patch
   behavior.
4. Derive complete returned/preimage row validation from checked InventoryItem
   DML via the existing complete-row/projection owners. The current permissive
   ID-plus-JSON creation output is insufficient for a new complete update
   contract; do not claim DTO types validate returned storage values.
5. Add an update-only receipt/event policy authenticating last-patch selection,
   unchanged fields and dependencies, metadata merges, full result rows/order,
   actual patch facts and exact native `inventory.inventory-item.updated`
   events. Read calls and ID-only updates have no mutation/event allowance.
6. Add `src/workflows/inventory/update-items.ts` using the genuine composer,
   exact installed Inventory source/profile identity, module-only events and
   graph disabled. Preserve one trusted atomic root/settlement, default OCC,
   existing call/event/byte/catalog/identity limits and ordinary request replay.

Bound zero to four raw update entries and at most four selected InventoryItems.
Raw duplicates consume request bounds even when native selection deduplicates.
Keep the existing 64-call/64-event envelope and ordinary 128-identity working set;
prove the complete maximum before requesting any limit change. This path has no
native sibling concurrency, so new borrowed scheduling or scope-exclusive
locking is not statically required. Changed source definitions retain their
installation gates; no lineage or durable-data reset is implied. Native SQLite
execution preserves fractional dimensions and values
beyond int32; current generic DML lowering incorrectly selects shared int32
storage. The authorized [finite number correction](../../shared-logical-storage/60-native-finite-number-storage.md)
adds the representation at its shared owner and selects it through generic DML
lowering. It preserves integer limits and refuses stale populated source hashes;
no migration, conversion or reset is included.

## Compensation And Verification

The genuine callback skips missing or empty dataBeforeUpdate. Otherwise it maps
full preimages through `convertItemResponseToUpdateRequest(data, selects,
relations)` and calls updateInventoryItems once. Retain that exact conversion:
nested metadata inputs produce dotted selects, which need not cause the helper
to include the complete metadata object in compensation. Do not silently upgrade
native compensation into a full-row restore or claim an independently durable
undo API. Whole-root rollback and native callback fidelity are separate proofs.

Pure genuine composer/callback/native-helper witnesses must prove required empty
resolution, full `{}` preimage list configuration, scalar/array module ABI,
transient stripping, last-patch duplicate handling, missing-ID errors, native
selection/result/event order, per-row metadata behavior, ID-only no-op behavior,
compensation including dotted metadata selects, and failure propagation without
running transaction-covered inverses.

Both PGlite and ordinary-role PostgreSQL must prove four-entry maximum, empty
input, mixed null/scalar/dimension/metadata changes, repeated/out-of-order IDs,
empty patches, missing and soft-deleted targets, active SKU conflicts and SKU
reuse after unrelated soft deletion, complete malformed-result/event/receipt
refusal, late failure, caught sticky refusal, one settlement, replay/conflicting
identity, scope isolation and cancellation/revocation. Verify InventoryLevels,
Reservations and rich Variant–InventoryItem Links remain byte-for-byte unchanged.
Retain the two upstream Inventory update assertions in
`packages/modules/inventory/integration-tests/__tests__/inventory-module-service.spec.ts`
for scalar and array updates, explicitly distinguishing any authored adapter
scope cases from those original assertions.

Regress Product/Variant Inventory creation, stocking, stock adjustments and
individual reservations, Product deletion/batching and shared scalar/keyed
owners as affected. Complete affected types/builds, pinned source/promotion/
portability guards, configured lint and both required read-only reviews before
one scoped commit. Hosted activation, arbitrary Inventory query filters,
Inventory deletion/absolute-level updates and larger batches remain pending.
