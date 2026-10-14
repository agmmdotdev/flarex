# Stock Location Creation And Inventory Levels

## Status And Scope

Status: implemented bounded private native admission.
The selected outcome stocks existing Inventory items at new or existing Stock
Locations. It follows the complete Product root and the adapter organization
cleanup; performance tuning remains paused.

The private root admits zero to four locations, each with at most one inline
address, and zero to eight levels across existing Inventory items. A level uses
an existing location ID or an ordinal into the root's newly created locations.
Zero-input native calls remain real. This is not arbitrary Stock Location or
Inventory module support, reservations, stock adjustments, Sales Channel/location
links, Cart execution, hosted activation or a general workflow engine.

## Current Sources Of Truth

- [Medusa adoption](../06-medusa-adoption.md) and the preceding
  [Inventory child](95-product-variant-inventory-workflow.md) and
  [Product root](96-native-create-products-workflow.md) own admitted capability.
- [Organization and reuse](../../medusa-design-quality/02-organization-and-reuse.md)
  owns the new module, repository, composition and workflow placement.
- [Pinned source](../../../third_party/medusa/SOURCE.json) selects fork
  `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The island stays immutable;
  promoted executing files and provenance guards own executable behavior.
- [Shared logical storage](../../shared-logical-storage/README.md) owns physical
  persistence; native DML and module services own commerce semantics.

## Native Preflight And Ownership

`createStockLocationsWorkflow` calls the native creation step, which delegates
to `StockLocationModuleService.createStockLocations`. The internal service
delegates nested persistence to the DAL; creation retains scalar/array results,
native mutation subscribers, serialization and `stockLocationsCreated`.
The StockLocation DML declares its nullable Address FK and one-to-one relation.
The adapter writes an inline Address before its owning Location through the
existing scalar write/event owner. Address retrieval, independent creation,
update and deletion remain refused. Simultaneous inline address and address ID
are outside the finite admission; existing address IDs use the declared FK.

`createInventoryLevelsWorkflow` always runs `validateInventoryLocationsStep`
before the native level step. It resolves the existing remote-query resource,
reads Stock Location IDs and retains the pinned missing-location error. The
Inventory service sanitizes level input, then its internal service delegates
creation to the DAL. Reserved quantity is owned by reservations: this facade
does not accept it. The DML owns InventoryItem FK integrity and active uniqueness
of `(inventory_item_id, location_id)`; no duplicate adapter enforcement is added.
Native public input admits finite numeric stocked and incoming quantities;
omission retains the model defaults, including reserved quantity zero.

Inventory's `available_quantity` is computed by the pinned ORM initialization
hook using BigNumber subtraction of raw stocked/reserved quantities. Extract
that storage-independent calculation into the promoted Inventory package and
reuse it after complete exact-pair validation. Do not load ORM entity hooks or
reimplement the formula in Flarex core. The existing adapter exact-numeric owner
encodes/checks numeric and raw companions before native DTO serialization.

## Construction And Trust Boundaries

Existing Inventory item-only and Stock Location ID-read admissions retain their
refusals. Trusted factories select distinct level/create profiles; the new
workflow selects only level creation, location creation and Stock Location graph
reads. It borrows the original logical sources and shared transaction, event,
idempotency, cancellation and publication owners.

The facade composes both actual native workflows. It resolves ordinal references
only from authenticated Location results and exposes the native location hook
plus its own `inventoryStocked` hook after both children. Existing IDs pass to
native validation unchanged. Each run settles once; separate runs do not become
atomic implicitly. Native compensation callbacks remain declared, while this
atomic profile retains whole-root rollback rather than inverse writes.

The named stocking profile retains the existing 64-call, 64-event, byte, row,
fact and time limits. The maximum graph plus a pending Location hook read uses
55 bounded calls. Validate that graph against the unchanged envelope. This is
bounded admission, not performance
acceptance. Unsupported writes caught by a hook must still poison the root.

## Cutover And Correctness Gates

Reuse `module/`, `repository/`, `value/` and `workflow/` mechanics. Put genuine
Inventory quantity and Stock Location address behavior in their module owners;
place the named stocking facade in `workflows/inventory/`. The Stock Location
factory's name now covers both explicit profiles; migrate its existing callers
without forwarding modules. The shared scalar owner exposes its existing Effect
create operation so extensions reuse it without nested Promise runners or SQL.

No native DML, logical source lineage, durable identity, database table or data
format changes are selected. No migration/reset or old-consumer retirement is
required. Module-only Product and existing-Product Variant operations stay
distinct from stocking, and no location-level fields are invented for the
native Product composer.

Prove maximum creation with exact quantities/raw companions, native hooks/events,
pending validation reads, one publication, replay and uncertain acknowledgement;
existing endpoints, defaults and empty calls; missing locations/items and active
uniqueness; late failure, caught refusals, cancellation/revocation and matching
identities in two shops. Preserve native error order and both database lanes.
Regress both old Inventory/Product roots and shared scalar consumers, run
affected builds/typechecks/provenance/browser guards, and complete both required
read-only reviews before one scoped commit.

Convex's portable execution/atomic mutation model and scope isolation remain;
framework-native Inventory semantics and exact numeric companions remain the
named Medusa-profile divergence. The schema and transaction owners are unchanged.
