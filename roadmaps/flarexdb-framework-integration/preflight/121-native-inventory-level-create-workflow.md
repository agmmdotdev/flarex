# Native Standalone Inventory Level Creation Workflow

## Status And Selection

Status: source preflight complete; standalone implementation pending. Inventory
maintenance 115–119 is implemented privately; standalone Item creation 120 is under
validation. This document makes no 121 implementation or database-validation claim.
Chunked File Product import, Product export and hosted activation remain deferred.

The recommended next complete slice is the genuine
createInventoryLevelsWorkflow for existing Items and existing Stock Locations.
The root already executes under 97's combined Stock Location creation/stocking
and 120's Item creation child. Its dedicated standalone facade/profile is absent:
97 grants Location creation and 120 requires new Item creation. 119's direct
create branch deliberately performs no Location existence validation. A narrow
standalone admission supplies the native existing-endpoint operation without
copying an algorithm or duplicating any of those composers.

Authority remains accepted architecture/package boundaries and pinned Medusa
2.13.4, fork 48d5cc675e4e8bc821e22c20c88a751acc66fb5f. SOURCE.json and the exact
executing promoted copy agree on the source island. No new native source file is
needed: packages/medusa-core-flows/src/inventory/workflows/create-inventory-levels.ts
already has its narrow package export.

The other inventory root, bulkCreateDeleteLevelsWorkflow, is explicitly marked
deprecated with TODO removal in the pinned source and points to the batch
replacement admitted by 119. Do not promote it without a named compatibility
consumer. There is no native Reservation batch composer in the pinned reservation
workflow directory. Reservation-by-line-items is a useful subsequent candidate,
with a native restoration gate described below.

## Exact Native Order, Empty Closure And Output

The unchanged createInventoryLevelsWorkflow, ID
create-inventory-levels-workflow, accepts {inventory_levels:[...]} and executes:

1. validateInventoryLocationsStep(input.inventory_levels).
2. createInventoryLevelsStep(input.inventory_levels).
3. WorkflowResponse with the full ordered Level DTO array from creation.

There are two actual step nodes, no child, when, parallel group, hook, separate
workflow event, Locking, Item creation, Reservation, Link, Pricing, File or Region
provider. The native module's Level created events remain required.

Both steps always execute for an explicit empty array. The validation step
resolves Query and performs the real Stock Location ID query with filters.id:[],
then creation resolves Inventory and calls createInventoryLevels([]). Preserve
Query/Stock Location-read → Inventory order and actual empty method invocations.
Omitted inventory_levels is not a native fallback and remains invalid. Do not
copy 120's optional items boundary onto this root. Ordinary foreign-input capture
may omit enumerable own undefined object members, after which this required key
still fails Schema decoding. Exact optional-key semantics for quantities remain
with their current input owner, separately from intermediate undefined values.

The executing validation fork uses the existing exact Query.graph bridge with
entity stock_location, fields:[id], raw ordered Location IDs, and the existing
maxPageSize. Its completeness check requires metadata.count equal to result
length and skip 0 before the unchanged native arrayDifference guard. 120's durable
callback guard authenticates this precise bridge and native missing-ID tail;
reuse that guard rather than inventing another parser or broad normalization.
Missing names are Set-deduplicated in first requested order. Native error text
is Stock locations with ids: A, B was not found, with NOT_FOUND type.

The Location participant is the authentic read-only Stock Location profile with
graph:true and methods:[]. It must remain installed for empty requests. Reuse
120's ID/count/projection receipt correction. No Location/Address mutation or
cross-module endpoint creation is granted. The actual Inventory module sanitizes
foreign reserved_quantity then invokes genuine InventoryLevelService.create;
the standalone public schema continues to refuse that managed field rather than
expanding admission based on the sanitizer. Item existence is the existing
Inventory FK obligation; no Item graph provider or adapter lookup is added.

## Narrow Owners And Bounds

Propose one named inventory-level-creations module admission over the genuine
InventoryModuleService and InventoryLevelService. Expose exactly
createInventoryLevels plus retained-only deleteInventoryLevels, no Inventory
graph/Item method, no update, quantity adjustment, Reservation or managed-delete
method. Item and Reservation repositories stay denied. This is a dedicated
construction entry point using existing owners, not a universal CRUD dispatcher.

Reuse current 120 prepareInventoryLevelCreationMethods for the two command/method
bindings, compileInventoryLevelContracts, the strict InventoryLevelCreatedRows (eight)
output, prepareInventoryQuantityRepository creation/numeric conversion, and
119's inventoryLevelLifecycleRepository physical inverse. Factor only the small
shared Level construction/event-receipt owner where the named profiles currently
assemble it; keep 119's update/deletion and 120's Item capabilities excluded from
the new profile. The current batch receipt already has complete ordered create
and physical-delete branches; extract/reuse those authoritative branches rather
than copying their validators or admitting unrelated commands at the facade.

Input is a required mutable array of at most eight InventoryLevelInput rows, with
inventory_item_id, location_id, optional finite stocked_quantity and
incoming_quantity. at most eight existing Items/Locations may be referenced. Do not
add 120's two-Levels-per-created-Item restriction to this existing-Item workflow.
Build mutable arrays before applying collection checks: in the installed Effect
version Schema.mutable rebuilds array schemas and drops earlier array checks.

Return the complete ordered array (up to eight) with native generated identities, quantities,
computed available quantity, metadata/defaults and managed timestamps. Validate
every full DTO/raw companion and exact input/default/result order at the module
receipt before exposing it. Keep the older open InventoryLevelsOutput for its
existing consumers only; the new facade uses the current strict owner.

The retained native compensator captures actual created Level IDs, skips absent
or empty IDs before resolution, otherwise invokes plural physical
deleteInventoryLevels(ids). It does not run 117's stock/incoming/reservation
soft-delete guards. Reuse the native generated selector, actual root identities,
physical after:null facts/tombstones and exactly one source of Level deleted
events from the native internal service. Missing/already-removed IDs remain
native no-ops. The private inverse accepts at most eight raw IDs and must never remove
unselected rows or invent an Item/Reservation/Link cascade.

Use one existing default-OCC outer settlement with Inventory writes and Stock
Location reads. Ordered composition needs no new scheduling or scope-exclusion
resource. Start with existing 64-call/64-event, 128-identity and current byte/node
limits. Forward has at most eight new Level facts/events plus authentic endpoint
observations; inverse at most eight physical removals/events. Measure complete forward
and inverse roots on both drivers before claiming they fit. No broader allowance,
schema/migration, shared-core or host change is established by this preflight.

## Connected Plan And Required Validation

1. Add the standalone facade over the existing native root and the exact narrow
   profile above. Bind only Inventory and read-only Stock Location. Reuse 120's
   callback/helper provenance guard and existing package export; no copied
   composer, helper or native source promotion is necessary.
2. Reuse 120/119 fixture topology and native Item/Location seeds outside the tested
   root. Exercise eight Levels across eight existing Items/Locations, both distinct and
   repeated Item patterns, signed/fractional/large finite quantities, defaults,
   exact raw companions, full DTOs, all eight native created identities and one
   replayable settlement. Preserve nonempty Product/Variant/Pricing/rich Link/
   Reservation/Stock Location/Address families and all existing Items.
3. Genuine pure callbacks prove exact node/provider order, required empty query
   and create calls, native missing-ID order, array result/order, captured inverse
   IDs and empty inverse skips. Observe mock calls outside replaceable scripted
   mock implementations; ordered native prepared.parallel is omitted, not[].
4. Both database lanes prove missing/deleted Location refusal before Level
   creation; missing Item FK and duplicate active tuple refusal with whole-root
   rollback; ninth raw input, managed/unknown fields and malformed quantities;
   reordered/full-body/quantity/raw-companion/default/event forgeries; forged
   Location IDs/count; late native failure, caught forbidden sibling, cancellation
   and escaped callback revocation; request/revision conflict and real scope
   isolation. No generic success/failure assertion may replace a named error or
   complete snapshot obligation.
5. Separate native inverse probes delete eight actual rows with eight strict after:null
   tombstones and eight native deleted identities; characterize empty, duplicate,
   missing and already-removed raw inverse IDs without projecting selected IDs
   from an untrusted returned array. Preserve Item roots and neighboring records.
6. Ordinary-role PostgreSQL races after native Location validation with genuine
   Location soft deletion, and after staged creation with a competing native
   same Item/Location tuple create. Require coherent committed results or the
   actual sticky conflict with no stale success/retry. Regress 97, 119, 120 and the
   Stock read owner, both native Product/Variant consumers, relevant module/type/
   browser/source guards, lint and required reviews before the scoped commit.

## Subsequent Reservation Candidate And Native Gate

The next genuinely unpromoted Reservation root is
deleteReservationsByLineItemsWorkflow, ID delete-reservations-by-line-items,
from reservation/workflows/delete-reservations-by-line-items.ts. Its one step
always resolves Inventory, including ids:[], calls
deleteReservationItemsByLineItem(rawIds), and captures raw Line Item IDs for
restoreReservationItemsByLineItem compensation. No Order/Cart provider is
resolved: line_item_id is scalar Reservation data. Preserve raw duplicate/missing
IDs and empty execution. The source composer returns WorkflowData<void>; promote
the same narrow WorkflowResponse wrapper used by existing reservation roots,
with final public null and transaction-covered retained callback metadata.

The native delete method first lists active Reservations by line_item_id, then
soft-deletes that filter and adjusts reserved quantities from those exact
preimages. The adjustment helper groups demand per Item/Location before updating
the actual Levels. Current individual Reservation schema has a one-row maximum and the
quantity repository accepts only ID filters/lifecycle selectors; neither grants
line_item_id selection, multirow soft deletion or restore. A subsequent named
profile would need bounded complete line-item filter/lifecycle reads, strict
Reservation rows/raw quantities and exact Level arithmetic/event receipts. It
must not silently widen 98's individual roots or claim a nonexistent native
Reservation batch workflow. A starting proposal is four raw Line Item IDs, four total
matching active+deleted Reservations and four affected Level tuples, with existing
limits measured. Multirow demand release does not establish batch-create
availability correctness.

There is a concrete source-derived restoration gate before admission. Native
InventoryModuleService.restoreReservationItemsByLineItem_ lists with config{}
before calling internal restore; default reads exclude deleted rows. Its later
adjustInventoryLevelsForReservationsRestore consumes that pre-restore active
list, not the restored rows. Thus the normal delete→restore shape appears to
restore Reservations without increasing reserved quantities; mixed active and
deleted matching history can adjust the wrong preimage set. This is the exact
restore-visibility characterization gate already recorded by 98, not a newly
established database outcome. The retained original by-Line-Item test checks
row restoration and separately deletion arithmetic, but does not check reserved
quantity after restore.

First run a focused genuine native module witness recording list/restore/Level
update arguments, then both-driver behavior if admitting the root. If confirmed,
the native Inventory method owns the correction and any behavior divergence
decision; no adapter withDeleted injection, synthetic quantity fix, extra
transaction, shared-core exception or weakened compensation test is acceptable.
That gate is why the complete existing-Item Level creation root is recommended
as 121 while Reservation-by-Line-Item behavior is investigated separately.
