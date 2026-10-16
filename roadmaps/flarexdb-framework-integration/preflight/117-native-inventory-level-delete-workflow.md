# Native Inventory Level Deletion Workflow

## Status And Authority

Status: preflight complete; implementation pending after absolute Level update.
Authority is the accepted Flarex design, package boundaries, Medusa adoption
roadmap and Medusa 2.13.4 at `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.
The source island remains read-only. Chunked File import and Product export
remain deferred.

The real pending root is `deleteInventoryLevelsWorkflow`, distinct from the
Inventory module's physical `deleteInventoryLevel(item,location)` helper and
from InventoryItem deletion. It selects existing Levels, applies the native
workflow guard and soft deletes selected identities under one outer settlement.

## Exact Native Closure

Promote `packages/core/core-flows/src/inventory/workflows/delete-inventory-levels.ts`
and `common/steps/delete-entities.ts`; reuse the already promoted
`common/steps/use-remote-query.ts`. The workflow ID is
`delete-inventory-levels-workflow`. Its genuine nodes are remote query,
`validate-inventory-levels-delete` (defined in the workflow file) and
`delete-entities-step`. The composer removes force from filters, queries
`inventory_levels`, validates the returned rows, maps their actual IDs and calls
the generic step with constant Inventory registration and
softDeleteInventoryLevels/restoreInventoryLevels method names. It returns native
undefined through WorkflowResponse; the private public boundary returns null.

Native Inventory joiner metadata actually generates the inventory_level and
inventory_levels aliases for InventoryLevel and the inventory_level_id linkable
key. The current adapter graph only admits InventoryItem: Level graph reads and
generated Level soft-delete/restore are real missing capabilities. No Stock
Location, Locking, Link, InventoryItem service call, workflow EventBus event/hook,
File, Region or remote effect is a dependency. Native Inventory module lifecycle
events remain required through `internalModuleWorkflowEvents`.

## Guard And Projection Fidelity

The genuine query selects exactly id, stocked_quantity, reserved_quantity and
location_id. It does **not** select incoming_quantity. The inline guard checks
reserved_quantity > 0 OR incoming_quantity > 0 first, then stocked_quantity > 0
unless force is truthy. With the actual projected rows, incoming_quantity is
undefined and its comparison is false. Thus a positive incoming quantity alone
is not refused by this native composer. The same guard called directly with a
complete row does refuse positive incoming quantity. Preserve and label both
witnesses; do not silently add the missing field, synthesize incoming data,
strengthen the adapter guard or refuse this native branch as a workaround.

An exact pinned callback witness confirms the distinction with genuine native
deduplicate/MedusaError. Native reservation refusal precedes stock refusal;
location names in messages are first-occurrence deduplicated. Force bypasses
positive stock, never positive reserved quantity. Zero and negative selected
quantities do not trigger > 0 checks. Preserve exact errors and numeric DTO
projection; this path does not check availability or actual Reservation rows.

Projected remote query results must remain the requested four-field records,
even if their authenticated storage receipts observe complete Level bodies.
The portable query step requires a complete bounded result; a fifth match must
refuse before deletion, not become a page tail. Empty selectors select all active
Levels within the admitted bound. Empty ID arrays, missing IDs and already-deleted
IDs yield zero matches without native missing-key errors. Duplicate requested
IDs do not create duplicate selected rows or repeated lifecycle transitions.
The query's native filter/primary-key ordering drives actual deletion and
compensation IDs; retain ID-array ordering through the existing native helper.

## Lifecycle, Compensation And Boundaries

The generic deleteEntitiesStep always resolves the Inventory resource, including
zero selected IDs. It calls softDeleteInventoryLevels only when data.length is
nonzero and discards its actual native return value. Retain full generated
service result authentication anyway: inventory_level_id must describe actual
lifecycle rows, including the native empty map behavior for a direct empty call.
Do not pretend the method returns void just because this composer ignores it.

InventoryLevel DML has no outgoing cascade lifecycle. Its InventoryItem belongsTo
FK is preserved; Stock Location is a scalar location_id rather than a native
mutation dependency. Preserve InventoryItem, ReservationItem, Product/Variant,
rich Variant–InventoryItem Links, Stock Location rows and addresses. Deletion is
soft, leaving exact quantities, raw companions, metadata and endpoint identities
intact. It neither adjusts quantities nor releases reservations. Reuse
medusaLifecycle and native mutation subscribers rather than direct SQL or a new
lifetime. Generated native restore retains its existing conventional event path.

The compensator stores the selected IDs, module registration and compensate
method name, then calls restoreInventoryLevels on nonempty IDs. Empty IDs skip
resolution/calls. Its original non-null assertion does not add a runtime guard:
compensate(undefined) throws during destructuring before the empty check. Retain
that genuine callback behavior under transactionCovered, without inventing a
standalone durable restore contract. Whole-root rollback is a separate proof.

The generic step's strings are constants in this composer. A narrow type-only
foreign method interface can replace upstream any; exact installed module and
method capabilities remain enforced by the existing prepared resource binder.
Promoting the helper grants no arbitrary module/method dispatch authority.
The existing remote-query ABI exposes partial JSON rather than full DTOs;
promote a named projected-row decoding/type seam as needed. Represent the
actually absent incoming field faithfully and preserve emitted native guard
behavior. Any type-only guard correction must retain its missing-field runtime
witness and existing source-promotion equality checks.

## Implementation Plan And Bounds

1. Promote the genuine workflow, inline guard and generic deletion step with
   narrow portable imports and transaction-covered callback. Reuse existing
   deprecated remote-query compatibility; do not add another query engine.
2. Add named Inventory `level-deletions` admission/profile
   inventory-level-deletions. Bind actual listAndCountInventoryLevels for graph
   reads and genuine softDeleteInventoryLevels/restoreInventoryLevels. Keep
   Item/Reservation/Level create or quantity mutation unavailable.
3. Build the Level-only graph definition from native aliases and existing
   scalar read/projection owners, preserving exact numeric companions before
   the selected native DTO projection. Admit supported combinations of id,
   inventory_item_id and location_id, scalar or arrays of at most four entries;
   bounded native $or tuple selectors can reuse the existing Level owner.
   Unknown fields and unsupported quantity/operator grammar fail closed. This
   does not claim arbitrary Inventory filter compatibility.
4. Reuse checked existing three-model metadata and the real Level lifecycle
   owner. Authenticate complete before/after rows, actual active transitions,
   preserved non-lifecycle data, generated result maps and exact native deleted/
   restored module events. Read/empty roots permit no extra writes/events.
5. Add src/workflows/inventory/delete-levels.ts using the genuine composer,
   exact source/profile/method identity, Level graph enabled, module-only events
   and one atomic settlement. Keep default OCC and existing resource allowances.

Admit at most four raw IDs per array/selector and four actual selected Levels;
empty selectors are bounded by actual match count. Repeated requests consume raw
bounds. Keep default 64 calls/64 events, bytes/catalog limits and ordinary
128-identity working sets. No schema, source lineage, installation or durable
reset is implied. The complete composite point-access correction identified by
Level update remains its shared owner prerequisite for tuple reads; do not
repair broad coverage in this adapter or weaken receipt checks. No additional
static core/locking blocker is identified.

Default OCC must bind the guard's quantity observations and lifecycle write.
There is no native Locking.execute/callback exclusion promise to emulate.
Focused ordinary PostgreSQL races against quantity/reservation roots must prove
a coherent deletion or sticky conflict, without a stale reserved guard leading
to deletion after a newly committed reservation. Do not add adapter mutexes,
silent retries, availability guards or extra transactions.

## Verification And Following Work

Pure genuine composer/guard/callback witnesses must prove the exact query fields,
force stripping, projected incoming omission versus full-row direct guard,
reservation-before-stock error ordering and location deduplication, actual
selected IDs rather than requested IDs, empty Query/Inventory resolution without
softDelete invocation, map-result discard, native undefined and callback
arguments including undefined compensation failure.

Both PGlite and ordinary-role PostgreSQL must prove maximum/fifth-match refusal,
ID/Item/Location selectors, empty/all/missing/repeated/soft-deleted selections,
reserved and stock refusal, force, zero/negative quantities, **positive incoming
alone retaining native deletability**, complete selected-field output, exact
lifecycle facts/events/result maps, unchanged quantities/raw companions and all
unrelated endpoints, one settlement, late/caught failure rollback, malformed
native results/events/receipts, replay/conflicting identity, scope isolation and
cancellation/revocation. Trace competition with existing reservation/delta/Level
update roots. Native physical-delete helper assertions do not prove this soft-
delete workflow; label any retained service assertions by their actual method.

Regress Level updates and stocking, stock adjustments/individual reservations,
Product Inventory deletion/batching and the shared lifecycle/point-read owners
as affected. Complete affected types/builds, provenance/source/promotion/browser
guards, configured lint and both required read-only reviews before one scoped
commit. InventoryItem deletion, Level batch/bulk roots, larger graphs and hosted
activation remain pending; File import and Product export remain deferred.
