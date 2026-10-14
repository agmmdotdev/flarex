# Product Variant Inventory Workflow

## Status And Scope

Status: approved and implemented bounded private admission. The owner approved
native variant creation with managed Inventory and stored Variant–InventoryItem
Links while performance optimization remains paused. This scope grants selected
framework capabilities; it introduces no shared-core exception.

The native variant composer advances the existing Product Variant Pricing branch
into variant creation with managed Inventory and stored Variant–InventoryItem Links. It starts
with an existing Product and valid options, one to four variants, existing or
automatically created InventoryItems, and the currently admitted base Pricing
bounds. Include unmanaged variants and empty child inputs. Nonempty location
levels, reservation/stock adjustment and arbitrary Inventory operations remain
later admissions. The complete bounded Product root is separately admitted by
[its owning record](./96-native-create-products-workflow.md).

## Current Sources Of Truth

The [accepted design](../../../design-notes/flarex-db-accepted-design.md),
[package boundaries](../../16-package-boundaries.md),
[Medusa adoption](../06-medusa-adoption.md), and
[shared logical workflow cutover](../../shared-logical-storage/16-product-variant-pricing-workflow-cutover.md)
control authority and storage. The executable
[Pricing branch](../../../packages/medusa-adapter/src/workflows/product/variant-pricing.ts)
uses native steps but is deliberately not the complete variant composer.
The [complete variant facade](../../../packages/medusa-adapter/src/workflows/product/variant-inventory.ts)
executes the pinned parent composer and Inventory children with authentic
Inventory and Stock Location query dependencies. The Pricing-only branch remains
for its named Product-launch consumer. That existing-Product/Tag operation needs
an explicit consumer cutover; the new-Product root alone does not replace it.
The [Product-root preflight](./96-native-create-products-workflow.md) inventories
the actual retained consumers and cleanup gate.

Native paths below are relative to
`third_party/medusa/upstream/packages/`, pinned by
[SOURCE.json](../../../third_party/medusa/SOURCE.json) to fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.

| Native source | Required behavior |
| --- | --- |
| `core/core-flows/src/product/workflows/create-product-variants.ts` | Create variants, validate supplied Inventory IDs, create default items for managed variants without supplied items, reject duplicate item IDs per variant, attach Links, create Pricing and emit the native event/hook. Inventory calls remain reachable with empty input. |
| `core/core-flows/src/inventory/workflows/create-inventory-items.ts` | Preserve item ordering and always invoke the inventory-level child, including for no location levels. |
| `core/core-flows/src/inventory/workflows/create-inventory-levels.ts` | Always validate locations and call Inventory level creation. Empty inputs do not eliminate these dependencies. |
| `core/core-flows/src/inventory/steps/validate-inventory-items.ts` | Execute the authentic `inventory_item` ID graph query and preserve native missing-item errors. |
| `core/core-flows/src/inventory/steps/validate-inventory-locations.ts` | Execute the authentic `stock_location` ID graph query even when the ID array is empty. |
| `modules/inventory/src/services/inventory-module.ts` | Native creation strips `location_levels` from item persistence input, strips `reserved_quantity` from level input, preserves scalar/array serialization and emits through native decorators. |
| `modules/inventory/src/services/inventory-level.ts` | Genuine custom internal service depends on quantity repository methods; supply a confined module extension rather than substituting a generic service for the native owner. |
| `modules/inventory/src/models/` and `static-manifest.ts` | Three-model closure: InventoryItem, InventoryLevel and ReservationItem; preserve nullable SKU uniqueness, numeric dimensions and structural dependencies. |
| `modules/link-modules/src/definitions/product-variant-inventory-item.ts` | Rich many-to-many Link with `pvitem` identity and integer `required_quantity` default 1. It is not the singular Variant–PriceSet Link. |

## Construction And Boundaries

The finite native source closure uses the existing source/provenance guards,
shared logical schema compilation, commerce module construction, module-owned
workflow registrations, graph reads and Link mechanics. Inventory's genuine
InventoryLevel service is an explicit extension. Its portable repository ABI
retains the three quantity method names with denied implementations; ORM/SQL
quantity logic is outside this profile.

The actual Stock Location ID-query endpoint serves the empty inventory-level
child. Its complete two-model structural source includes the inverse address
relation, while the profile admits only Stock Location ID reads. Nonempty levels
remain a sticky refusal at the trusted root. Retain InventoryLevel and
ReservationItem structural definitions without granting reservation mutations.
Unselected public methods, including quantity operations, fail closed.

The native ORM hooks compute level availability and lazy hidden item aggregates.
The selected creation/serialization contract omits these computed item fields;
it neither persists them nor synthesizes zero aggregates. Nonempty level/aggregate
support needs its own admitted proof.

One authentic root and settlement owner serves Product, Inventory, Pricing,
Stock Location reads and both stored Link families. Native input/output order,
defaults, errors, event evidence, scope confinement, request identity and replay
remain intact. The facade admits one to four variants on one existing Product,
up to two supplied items and two base prices per variant, one string-valued rule
per price, and a named 256-call allowance. Existing 128-call profiles remain
unchanged. Required quantity uses the native signed integer column and default 1.

The Product command boundary validates transient `inventory_items`, then the
native service removes that association input before Product persistence. The
Inventory child translates its transformed options envelope to the portable
SDK's explicit `{ input }` call form. Transaction-covered compensation metadata
continues to belong to the existing single settlement owner. These adaptations
preserve native business behavior rather than replacing the composer.

## Admitted Contract And Continuing Gates

- Exercise actual native workflow/child calls for managed variants with default
  items, supplied existing items, unmanaged variants and empty children. Preserve
  native duplicate/missing-item errors and `required_quantity` behavior.
- Preserve the two unchanged native Inventory item-creation cases from
  `modules/inventory/integration-tests/__tests__/inventory-module-service.spec.ts`.
  Separately prove defaults, nullable/duplicate SKU behavior, structural access
  refusal and the selected serialized result.
- Prove pending graph reads, one commit, exact event intents, late rollback,
  cancellation, replay, uncertain settlement and cross-shop isolation on PGlite
  and focused ordinary-role PostgreSQL. Regress existing Pricing, Product,
  workflow composition and stored Links; use no generated commerce DDL.
- Run affected strict checks, source/provenance guards, required lint and both
  read-only reviews. Remove displaced assembly in the admitted closure. Report
  bounded compatibility separately from performance and production activation.

The complete native `createProductsWorkflow` composition against Sales Channel,
ShippingProfile and the full variant child has its separate owning record.
Stock Location writes and inventory levels are separate useful capabilities,
not assumed prerequisites for the default-item branch.
The separate [stocking root](97-stock-location-inventory-levels.md) now admits
native Location creation and levels against existing Inventory items. This
Variant child keeps its original item-only admission and empty-level behavior.
