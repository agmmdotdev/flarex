# Product Variant Inventory Workflow

## Status And Scope

Status: researched proposal for the next Product workflow admission. The owner
has resumed Product/workflow integration while performance optimization is
paused. This record proposes the bounded connected capability for discussion;
it does not claim Inventory support or authorize a shared-core exception.

Advance the existing Product Variant Pricing branch into native variant
creation with managed Inventory and stored Variant–InventoryItem Links. Start
with an existing Product and valid options, one to four variants, existing or
automatically created InventoryItems, and the currently admitted base Pricing
bounds. Include unmanaged variants and empty child inputs. Nonempty location
levels, reservation/stock adjustment, arbitrary Inventory operations and the
full Product root composer remain later admissions.

## Current Sources Of Truth

The [accepted design](../../../design-notes/flarex-db-accepted-design.md),
[package boundaries](../../16-package-boundaries.md),
[Medusa adoption](../06-medusa-adoption.md), and
[shared logical workflow cutover](../../shared-logical-storage/16-product-variant-pricing-workflow-cutover.md)
control authority and storage. The executable
[Pricing branch](../../../packages/medusa-adapter/src/product-variant-pricing-workflow.ts)
uses native steps but is deliberately not the complete variant composer.
Inventory and Stock Location are not executable adapter dependencies today.

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

## Proposed Construction And Boundaries

Promote the finite native source closure through the existing source/provenance
guards. Reuse shared logical schema compilation, commerce module construction,
module-owned workflow registrations, graph reads and Link mechanics. Keep
Inventory's genuine service extension explicit. The quantity repository is
ORM-coupled; inspect the import closure and isolate its portable dependency seam
before promotion rather than copying its SQL into the adapter.

Register the actual Stock Location ID-query endpoint required by the empty
inventory-level child. A canned empty provider or skipped child is not native
compatibility. Bound this profile to the selected read contract; nonempty levels
remain a sticky refusal at the trusted root. Retain InventoryLevel and
ReservationItem structural definitions without granting reservation mutations.
Unselected public methods, including quantity operations, fail closed.

The native ORM hooks compute level availability and lazy hidden item aggregates.
Do not persist computed fields or synthesize zero aggregates. Verify the actual
selected creation/serialization contract and preserve omitted versus loaded
values. Nonempty level/aggregate support needs its own admitted proof.

Use one authentic root and settlement owner for Product, Inventory, Pricing and
both stored Link profiles. Preserve native input/output order, defaults, errors,
compensation data, event evidence, scope confinement, request identity and replay.
Measure the connected call budget before selecting it; existing 128-call profiles
do not automatically admit this larger closure. Missing shared contracts require
a failing witness and correction at their actual owner before dependent work.

## Completion Gates

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

After this capability, preflight the complete native `createProductsWorkflow`
composition against Sales Channel, ShippingProfile and the full variant child.
Stock Location writes and inventory levels are separate useful capabilities,
not assumed prerequisites for the default-item branch.
