# Native Inventory Item Deletion Workflow

## Status And Authority

Status: implemented for the bounded private native root. Inventory Level deletion
and its shared call-local observation prerequisite are implemented. Authority is
the accepted Flarex design, package boundaries, Medusa adoption roadmap and Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The source island remains read-only.
Chunked File Product import and Product export remain deferred.

The exact root is singular `deleteInventoryItemWorkflow`, ID
`delete-inventory-item-workflow`, in native
`inventory/workflows/delete-inventory-items.ts`. There is no plural
`deleteInventoryItemsWorkflow` export in the pinned file. Its composer and steps
already execute as nested Product/Variant deletion dependencies; a standalone
complete Item root and its retained Item/Link compensators are now admitted.
This slice must use that genuine composer, rather than the Inventory module's
physical `deleteInventoryItems` method or a synthetic selected-ID delete root.

## Native Closure And Observable Behavior

The genuine ordered steps are `use-query-graph-step`,
`validate-inventory-item-delete`, `delete-inventory-item-step`, then
`remove-remote-links`. The query is exactly entity `inventory`, fields
`[id,reserved_quantity]`, filters `{id: input}`. The guard uses native
`MathBN.gt(reserved_quantity,0)` and refuses with type `invalid_data` and message:
`Cannot remove following inventory item(s) since they have reservations: [ID, ID].`
The error's ID order comes from the actual selected native query rows.

`reserved_quantity` is the Item computed sum over active InventoryLevel reserved
quantities; it is not the number of ReservationItem rows or the sum of their
quantities. The native Drizzle projection owner is
`packages/database/drizzle/src/inventory.ts`; it reads active Levels, aggregates
exact BigNumbers and exposes numeric DTO values. Empty active Level sets yield
zero. Reuse the existing `inventoryDeletionFind` and
`inventoryItemReservedQuantity` adapter seam, which already supports this exact
query for nested Product deletion. Do not introduce a stronger per-Level or
ReservationItem-existence guard, clamp negative contributions, inspect stock or
incoming quantities, check availability, or add a force flag. A positive sum
refuses; zero/negative sums are natively deletable. Zero-quantity genuine
ReservationItems allow a successful maximum cascade witness without bypassing
this guard.

The workflow deletes its raw input IDs, not the query's selected IDs, and returns
that same raw array through WorkflowResponse. Missing, duplicate and already
soft-deleted requested IDs remain in the returned array. The private public
boundary must return the array, rather than null or a list of changed IDs. The
guard query normally excludes soft-deleted Items. The lifecycle owner determines
actual membership and changed rows independently of the returned raw array.
Direct ID-array duplicates are first-occurrence deduplicated by native buildQuery
before filter ordering; repeated OR branches retain their separate native
ordering behavior. Do not confuse raw response order with lifecycle/event order.

The delete step always resolves Inventory and calls
`softDeleteInventoryItems(input)`, including `[]`; the native internal service
may then return an empty result without a repository call. The generated service
returns its actual linkable-key map, normally Item/Level/Reservation keys for
actual cascade rows; the step ignores that return value. Fully authenticate the
map even though the composer discards it.

Generated linkable-key arrays retain lifecycle encounter order. The pinned
Drizzle UPDATE RETURNING path does not promise a global child-ID sort. The
existing lifecycle owner traverses Items by ID and each Item's children by ID;
receipts correlate the exact issued lifecycle order, including reordered-map
refusal, rather than sorting results or comparing only membership.

`removeRemoteLinkStep` receives `{inventory:{inventory_item_id:input}}`. Even
`input=[]` is a nonempty outer entry object, so the step resolves Link and calls
`link.delete({inventory:{inventory_item_id:[]}})`. The genuine router then skips
empty endpoint values; it need not call any stored Link service. Empty roots
therefore require Query, Inventory and Link resources in that order. No Locking,
Stock Location, Product, Pricing, workflow EventBus, hook, File, Region or remote
effect is a static executing dependency. Native Inventory and Link module events
remain required through internalModuleWorkflowEvents.

## Complete Lifecycle And Stored Link Closure

InventoryItem DML explicitly cascades `location_levels` and `reservation_items`.
Use the existing three-model compiled Inventory metadata and `medusaLifecycle`;
retain complete child history bounds before any transition. The existing owner
admits two persisted Levels and one persisted ReservationItem per Item, including
already-deleted descendants. Actual native soft deletion updates descendant
lifecycle fields recursively; their quantities, raw exact numeric companions,
metadata, location/item identities and other scalar data remain intact. It does
not release ReservationItems through the specialized reservation service or
subtract reserved quantities. Preserve those genuine cascade outcomes instead
of invoking quantity mutations to make the graph easier to delete.

The one installed remote family needed here is genuine
ProductVariantInventoryItem, with rich stored required_quantity. Its Inventory
extension routes inventory_item_id to the generated Link service. Neither Link
relationship declares deleteCascade, so deleting selected Inventory endpoints
soft-deletes only their matching Link rows and stops. ProductVariant rows are
not deleted, Product/Variant manage_inventory is not changed, and unrelated
Items, Levels, Reservations, rich Links, Pricing, Sales Channel links, Stock
Locations and addresses remain unchanged. Shared Variants and links to an
outside Item must remain. Stock Location is a scalar Level endpoint and is not
a mutable dependency.

Reuse the existing native Link router and single-family service/repository,
workflow method authentication, decodeLinkCascade and lifecycle event policy.
The router returns its full errors-as-data tuple and generated endpoint maps;
removeRemoteLinkStep ignores the return tuple but the private resource boundary
must authenticate it before projection/discard. A caught participant failure
must retain the existing sticky rollback-only state. Do not translate a native
error tuple into successful partial persistence, add a repair transaction, or
reimplement cascade traversal. Authenticate the exact native noncascading
joiner identity instead of accepting user-provided routing objects.

## Compensation Fidelity

The Item step captures raw input IDs. Its native compensator skips missing or
empty IDs before resolution; otherwise it resolves Inventory and calls
restoreInventoryItems(rawIDs), ignoring the actual generated linkable-key map.
This needs actual Item restoration over the same three-model lifecycle owner,
full before/after/result-map/RESTORED event authentication and unchanged restore
observations. The existing product-deletions Inventory profile exposes only
softDeleteInventoryItems and cannot currently execute this retained compensator.

The Link step captures grouped `{inventory:{inventory_item_id:rawIDs}}`. Its
compensator skips an absent payload, but a grouped empty-ID object is truthy and
still resolves Link and calls restore. The genuine router owns whether any
stored method follows. A nonempty inverse calls the actual generated Link
restore method with native selectors/returnLinkableKeys and emits attached
module events.

Restoration is endpoint membership based, not a remembered list of only rows
changed by the forward operation. Native Drizzle restores all matching child
history recursively, and native Link restore reads matching deleted and active
rows. Characterize predeleted descendants/Links and active unchanged restore
explicitly; do not silently narrow the retained callback to only freshly
deleted rows. All callback invocations remain transactionCovered. Whole-root
failure rollback is a separate proof and must not depend on running inverse
callbacks or introduce a standalone durable restoration API.

## Implemented Profile And Bounds

1. Reuse the already promoted genuine Item composer/steps and portable Query and
   Link steps. Add only the narrow package export needed for this native root;
   preserve its source mapping and emitted guard/callback behavior. Its existing
   eight-row projected decoder is required by nested Product deletion, so the
   standalone root's four-request admission must not weaken that older consumer.
   Restore the shared removeRemoteLinkStep invocation to its pinned executable
   body through type-only seams; the earlier Object.entries rewrite is displaced.
   Authenticate the exact Item/Link callbacks and the composer's named projected
   decoding seam through the existing source guard owner. Existing Product and
   Variant deletion consumers retain their native behavior and regression gates.
2. Add a named Inventory item-deletions preparation/profile using the existing
   computed Item graph and complete deletion owner. Expose only
   softDeleteInventoryItems and restoreInventoryItems, graph true; keep Level
   create/update, stock and reservation mutation and physical deletion unbound.
   Reuse lifecycle bounds/metadata and generalize the actual owner for restore
   rather than duplicating cascade algorithms. Preserve the existing Product
   deletion profile and consumers.
3. Prepare exactly the rich Variant–InventoryItem Link family for endpoint
   deletion and restoration. Extend the existing Link workflow-service lifecycle
   admission where appropriate; use a named capability-bound composed resource
   exposing delete/restore for the constant Inventory endpoint. Follow the
   existing single-family Stock Location/Sales Channel deletion patterns; do not
   require their unrelated families or Pricing just to reuse the broad Product
   deletion resource.
4. Add src/workflows/inventory/delete-items.ts, using genuine
   deleteInventoryItemWorkflow, checked installed Inventory and Link participants,
   exact source/profile/method identity, module-only events and one default-OCC
   outer settlement. Export a four-raw-ID input and array result schema. No native
   Locking.execute or new scope-exclusive profile is implied.

Admit four raw input IDs; repeated IDs consume the raw bound. The complete
connected outcome admits at most four Items, eight persisted Levels (two/Item),
four persisted ReservationItems (one/Item), and eight matching rich Links
in total. Every individual history/cardinality overflow must refuse the whole
root before publication, not truncate children or treat a page as completeness.
Bound the rich Link inverse by the same complete eight-row selection, including
history/unchanged restore semantics. Maintain ordinary 128-identity working
sets and current bytes/catalog bounds. The complete forward graph fits the
existing 64-call/64-event root allowances. Its 24 lifecycle row identities emit
16 Inventory singleton messages and one native Link batch containing eight IDs.
The Link preparation authenticates its complete-history configuration against
the genuine immutable repository binding before issuing workflow methods;
structural replacements cannot attest a different bound closure. No shared or
default resource limits are widened.

The shared core62 call-local row observation correction is a prerequisite. The
guard may observe Item/Level bodies which later commands do not use, and cached
rereads by those later commands must still be correctly attributed. Keep strict
per-command receipts and whole-root dependencies. No additional static core,
schema, migration or locking blocker was identified from the pinned closure;
that is not a substitute for connected failures and ordinary PostgreSQL races.

## Verification And Following Work

Pure genuine composer/service/callback proofs must cover exact query/guard,
computed positive reservation refusal and exact error, native query ordering,
raw-versus-selected IDs and output, ignored real maps and Link tuples, empty
Query→Inventory→Link resolution, exact Item and grouped Link compensators and
absent-versus-empty inverse distinctions. Retain type-only source guards for
unchanged native callbacks and separately label authored boundary assertions.
Old native physical-delete service assertions do not establish this root.

PGlite and ordinary-role PostgreSQL must prove maximum graph and child/history/
Link overflow refusal; nonempty preserved Product/Variant/Pricing/Stock/otherLink
families; positive stock/incoming not becoming invented guards; zero-reservation
cascade success, positive active-Level reserved sum refusal before any deletion,
empty/missing/repeated/soft-deleted raw IDs and unchanged return arrays; exact
soft-delete/restore facts, full native maps, module events and numeric companions;
predeleted/active inverse behavior; one settlement, replay/conflicting request
identity, late and caught failure rollback, malformed native results/events/
receipts, scope isolation and cancellation/revocation.

Run focused ordinary PostgreSQL competition against actual reservation, stock
delta and absolute Level update roots. Guard observations must remain in OCC:
there must be a coherent successful delete or sticky conflict, never committed
deletion based on a stale zero-reserved observation after a committed positive
reservation. No adapter mutex, silent retry or extra transaction is permitted.
Regress nested Product/Variant deletion and batches, Level deletion/update,
stocking/reservations and shared lifecycle/call-local read owners as affected.
Complete affected typechecks/builds, source/promotion/browser guards, lint and
both required read-only reviews before one scoped commit.

The next preflighted native root is
[batchInventoryItemLevelsWorkflow](./119-native-inventory-level-batch-workflow.md)
(create/update/delete with native parallelize and retained deletion child).
Subsequent candidates include standalone createInventoryItemsWorkflow (Item plus
optional Levels) and the still-present deprecated bulkCreateDeleteLevelsWorkflow. Their raw
optional outputs, child dependencies, conditionals and scheduling need separate
preflights; neither deprecation alone nor existing module methods prove their
integration. Chunked File import, Product export and hosted activation remain
deferred.
