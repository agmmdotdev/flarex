# Native Service Zone deletion preflight (132)

Status: implemented bounded private native Service Zone soft deletion and raw
restore. The genuine root, complete cascade and retained raw inverse execute on
PGlite and ordinary-role PostgreSQL within the selected resource profile.
Public/hosted activation and populated schema evolution remain outside this slice.

## Connected scope

The selected genuine `deleteServiceZonesWorkflow` accepts zero to four raw Zone IDs,
with native GeoZone/ShippingOption/ShippingOptionRule soft cascades and the
genuine raw-ID restore inverse. It reuses the fresh eight-table source from 131.
This completes native lifecycle for the new geography graph without installing
provider/Location/Pricing Links or narrowing the cascade to empty zones.

Service Zone update remains pending; its native geographic replacement and
projected upsert inverse are substantially different. Its source-level inverse
limitation is recorded below. Update requires its own native characterization;
the existing Type/ShippingProfile update adapter does not establish that support.

Chunked Product file import and Product export remain deferred.

## Exact native graph and portable representation

Pin: Medusa 2.13.4, `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, as authenticated by
`third_party/medusa/SOURCE.json`. Native paths below are relative to
`third_party/medusa/upstream`.

- `packages/core/core-flows/src/fulfillment/workflows/delete-service-zones.ts`
  exports `deleteServiceZonesWorkflow`, ID `delete-service-zones-workflow`.
  Public input alias is `{ids: string[]}`. Composer calls only
  `deleteServiceZonesStep(input.ids)` and implicitly returns void.
- `packages/core/core-flows/src/fulfillment/steps/delete-service-zones.ts`
  exports `deleteServiceZonesStep`, ID `delete-service-zones`; input is string[].
  Forward always resolves Fulfillment, awaits `softDeleteServiceZones(ids)` and
  returns `StepResponse(void 0, ids)`. Retained input is the raw requested array.
  Inverse skips falsey/empty input before resolving Fulfillment; otherwise calls
  genuine `restoreServiceZones(prevIds)`.

There is no native Query-container, Link resource, provider invocation, guard,
hook, transform, parallel sibling, external workflow event, child workflow, file,
lock or pause. Internal DAL relation reads are still real required commands.
The module subscriber/aggregator and host module-event policy/resource remain
mandatory: reuse `internalModuleWorkflowEvents`, event-resource preparation and
admitted subscribers rather than treating absence of emitEventStep as absence
of event infrastructure.

The portable composer currently requires `WorkflowResponse` synchronously
(`packages/medusa-workflows-sdk/src/definition.ts:192-205`). Preserve all native
root operations and add only the established void-result representation:
import WorkflowResponse and append `return new WorkflowResponse(void 0)`.
Existing native Stock Location/Sales Channel deletion roots use that seam.
Do not change the SDK globally or substitute the module map for the root result.
The host-facing result is null. This is an existing portable representation
adaptation, not a new native business decision.

Empty root input still resolves Fulfillment and invokes genuine soft deletion;
the generated/internal empty method returns an empty cascade map. No row write
or module message should be fabricated. Empty retained inverse skips resolution.
Both empty and missing generated lifecycle methods return {}. No Query/Link or
root workflow event dependency is present to skip or imitate.

## Generated service, DAL and complete lifecycle closure

Executing `packages/medusa-fulfillment/src/services/fulfillment-module-service.ts`
has no specialized ServiceZone soft-delete/restore override. The genuine
generated methods in `packages/medusa-utils/src/modules-sdk/medusa-service.ts`
normalize IDs, call internal service lifecycle, map cascade rows to native
linkable keys and retain manager/event decorators.

Pinned DAL `packages/database/drizzle/src/medusa.ts:684-813`:

- Soft-delete updates active matching roots only, assigning native deletion and
  update time, then calls `updateDeletedAtRecursively` on those returned roots.
- Restore selects all physical matching roots, checks active unique indexes,
  clears deletion and updates time for every match, including active roots,
  then traverses the same declared cascade graph.
- Both dispatch actual native cascaded mutation events and return a tuple of
  root rows and model-name cascade map. Generated service translates that map;
  the native workflow step ignores its value but the adapter must validate it.

`updateDeletedAtRecursively` and `updateRelationDeletedAt` at `:1867-1949` traverse
only cascadeDelete descriptors. Their descendant UPDATE uses the owner-FK
predicate without an active-only/deletion-time predicate. The visited map
deduplicates identities for recursive traversal and result maps.

Real DML closure already selected in 131:

1. ServiceZone cascades to GeoZone and ShippingOption.
2. ShippingOption cascades to ShippingOptionRule.
3. GeoZone and Rule are leaves.

Four other installed models (Set, Profile, Type, Provider) remain unchanged FK
targets. There is no cascade to them, Fulfillment, Products, Pricing or any
stored Link in this native root. Physical rows/FKs remain present. The native
soft root is not 131's physical delete inverse: it emits cascaded lifecycle
messages for affected children, rather than only physical-root delete messages.

Generated output keys follow native model groups: service_zone_id, geo_zone_id,
shipping_option_id and shipping_option_rule_id, present only for actual reached
rows. Module messages follow those same model groups. Empty maps are {}, with no
empty child keys. The native joiner derives/merges DML linkable keys even for
models omitted from the shorter explicit joiner list. Validate maps from actual
mutations rather than copying fixture IDs.

The SQLite comparison returns insertion order within each model, including
reversed Unicode requests. Neither root nor descendant UPDATE RETURNING has
ORDER BY: that observed storage order is not a portable SQL guarantee, raw input
order or an implicit ID sort. The portable profile checks the native DML model
group order independently of FK-oriented write order. Within each group, map IDs
and module messages must agree with actual authenticated logical lifecycle
selection/transition order; no SQLite rowid parity or raw-request ordering is
claimed. Complete membership and correlation cannot be weakened on the grounds
that SQL's within-family order is unspecified.

## Native behavior that must remain visible

Genuine full-service/SQLite and unchanged step callbacks establish these
distinct root/descendant rules:

- Missing requested roots remain missing. Duplicate raw requests are retained
  as inverse input but physical SQL matches/maps/messages contain actual unique
  rows. Result/event order is not automatically raw request order or ID order.
- Already-deleted requested roots are not changed by forward soft deletion, and
  their subtrees are not reached merely because their IDs were requested.
- An active reached root can have historical children. Cascading soft deletion
  rewrites those children's deleted_at and updated_at again. Native event
  dispatch supplies synthetic original deletion=null, so those rewrites emit
  deleted, not an invented updated or no-op classification.
- Restore reaches all physical requested roots, including rows deleted before
  forward and rows that were already active. Descendants follow FKs across all
  history and lifecycle states. Older child tombstones can therefore be revived.
- Already-active restored roots/children must still advance update time and emit
  restored under the native synthetic original-deletion convention.
- Restore's global active ServiceZone name check can reject if another active
  Zone now owns that name. Preserve atomic refusal and no partial child restore.
- The inverse uses raw requested IDs, not the forward map or a prior-change
  ledger. Genuine business compensation is broader than exact failed-root
  state/event rollback and may fail native uniqueness constraints.

The creation profile's physical inverse remains distinct from this native
soft-cascade/restore path. Preserve
historical child timestamps and active-restore writes rather than recycling a
scalar Type deletion expectation across an entire graph.

The native SQLite witness's plain `Error` message, `Service zone with name:
<name>, already exists.`, comes from the Drizzle constraints formatter rather
than a ServiceZone business guard. The existing shared logical unique-conflict
owner instead returns the typed host `invalidInput` failure and latches the outer
root rollback-only. The accepted backend-error formatting boundary already
distinguishes these representations: preserve the native witness as its own lane,
and require the portable boundary's exact typed failure, rollback-only state and
complete unchanged snapshot. This is neither a required core correction nor a
native business change.

## Existing owners and core-gap assessment

Reuse the 131 eight-table metadata/source binding and
`captureServiceZoneCreationMetadata` / `compileServiceZoneCreationDefinition`,
same medusa.shippingProfile source/write-profile and commerce.shipping-profile
lineage. No table, source inventory, migration, reset or populated upgrade is
needed. Keep the original one/six-table profiles and consumers unchanged.

Reuse the genuine twelve-model `defineFulfillmentPersistenceModule` constructor
and existing lifecycle/row/query/event/subscriber authorities. Admit only the
native ServiceZone soft-delete/restore service methods and the exact graph
repositories they require. No GeoZone/Option/Rule public CRUD or provider methods
are exposed merely because their rows participate in a cascade.

`repository/lifecycle.ts` already traverses declared cascadeDelete relationships
for softDelete/restore, loads complete bounded history and orders affected
models by FKs. Its root selector filters active rows only for softDelete. Shared
logical row workingSet already performs managed softDelete writes for explicit
historical descendants; there is no source evidence requiring a new repeated-
soft-delete core flag. Preserve a failing runtime witness if that assessment
does not hold; do not preemptively add core API or work around it in the adapter.

Select the existing identity-bound logical `allowActiveRestoreUpdate: true`
capability introduced for Type deletion130. It must cover active restored roots
and children in this named participant. Existing/default profiles retain their
active-restore no-op contract. No new active-restore core mechanism is needed.

The shared adapter receipt owner `repository/lifecycle-graph-receipt.ts` correlates
selected multi-entity identities, real managed transitions, complete changes and
native maps. Store deletion reuses it with its existing active-restore behavior;
Service Zone deletion selects active restore writes. The module policy still
authenticates complete reads, the real two-level Zone→Option→Rule parent chain,
cohort bounds and declared event groups. A scalar receipt repeated four times
would not establish that graph proof. Shared checked metadata/row contracts live
in `modules/fulfillment/service-zone-graph-contracts.ts`, reused by creation and
deletion without changing the installed eight-table source. No native-specific
map/message policy moves into core persistence.

The native comparison has not identified a required new shared-core mechanism.
Core corrections remain authorized if a genuine failing witness identifies one;
API absence inferred from an adapter's current field assumptions is not proof.

## Bounds and complete maximum composition

Retain 131's complete selected cohorts: at most four raw Zone IDs, sixteen
GeoZones, eight Options and sixteen Rules, including history. There can be at
most 44 reached rows per full forward or restore call. Overflow refuses before
partial mutation; actual complete read evidence is mandatory.

The genuine native maximum emits 44 distinct deleted messages followed by 44
restored messages, 88 total, for four active roots and all active descendants.
Historical reached descendants and active restores retain their native writes
and event families. The complete maximum root and genuine retained inverse are
admitted together under one accepting portable settlement, including every call,
message and other resource cost. Native prepared-statement counts remain distinct
from portable logical call accounting.

Separate maximum forward/restore calls and smaller roundtrips can diagnose the
parts, but do not prove the complete maximum composition. Do not replace that
acceptance gate with separate executions, a reduced graph or expected refusal.
Do not silently deduplicate opposite event families or omit native messages.

The complete admitted composition selects a named 256-call/128-event allowance
through the existing trusted, identity-bound resource API under standing
necessary-core authorization. This allowance covers the unchanged complete
maximum graph and genuine retained inverse. Both ceilings use the existing trusted
requestCallLimit/requestEventLimit and matching logical participant resource
ceilings. Their selection is scoped to this ServiceZone deletion/retained-inverse
profile: the host's request limits and selected logical resource ceilings agree,
and established prepared identity/replay checks include those selections. Original
64-call or 64-event admission refuses the complete maximum composition without
partial settlement. The full four-root/history/descendant graph, ordinary
optimistic execution, all unrelated resource limits and other profiles remain
unchanged.
This is resource admission, not a native business change or a new universal API.
Complete connected support includes the maximum accepting composition and both
database lanes' identity/resource enforcement. Native-only characterization does
not establish that portable contract.

## Connected implementation and acceptance boundary

Native promotion:

- `packages/medusa-core-flows/src/fulfillment/workflows/delete-service-zones.ts`
- `packages/medusa-core-flows/src/fulfillment/steps/delete-service-zones.ts`
- narrow root/step package exports, exact runtime/public-input guards and mutation
  witnesses, source-pair/classification/provenance and portable entries.
- No new native type file is required: the root/step declare their aliases and
  IFulfillmentModuleService already has the existing narrow Fulfillment seam.

Adapter:

- service-zone-delete-input/repository/receipt/service.ts under the existing
  Fulfillment owner, factoring only genuinely reusable existing mechanics;
- shared `service-zone-graph-contracts.ts` and
  `repository/lifecycle-graph-receipt.ts`, with existing creation/Store consumers
  migrated while preserving their contracts;
- `workflows/fulfillment/delete-service-zones.ts` genuine-root facade;
- existing source/schema/fixture owners with focused deletion cases and no
  duplicate native tables;
- focused native workflow/receipt/lifecycle coverage of the admitted behavior.

The authentic native service/callback comparison covers
active/deleted/missing/raw duplicate roots; historical
descendant re-deletion with changed timestamps; active and historical raw restore;
map/event ordering and complete keys; roots skipped versus reached subtrees;
global-name restore collision; empty resolution; unchanged FK targets; complete
maximum forward plus genuine retained inverse; multi-entity module events and
cascade-branch bounds. Native count is 88 for the complete maximum pair; portable
same-settlement resource accounting is enforced by the selected named profile.
Comparison snapshots remain unchanged; no storage/service result is fabricated.

Both PGlite and ordinary-role real PostgreSQL cover exact full/history
closure, complete indexed selections, native maps/events, unchanged parents/FKs,
the complete maximum root/retained-inverse composition under its measured named
resource profile, plus overflow/unauthorized-allowance refusal, late rollback,
caught denial, cancellation/replay/revocation and scope isolation. Separate
maximum operations remain diagnostic coverage rather than the complete proof.
The concurrency boundary includes real insertion/restoration under indexed
cascade predicates and global active-name restore conflicts. The shared receipt
owner preserves Store's prior lifecycle behavior; 131 creation/physical inverse
and Type130 active-restore selection retain their separate contracts. Affected
types/builds/source/portable/lint checks and both required read-only reviews
remain the acceptance obligations for changes to this bounded support.

## Why Service Zone update is a separate following slice

Exact pending sources are `fulfillment/workflows/update-service-zones.ts` and
`fulfillment/steps/update-service-zones.ts` under native core-flows. They execute
the full projected preimage list, genuine selector update and retained
`upsertServiceZones(prevData)`. There is no Query/Link/provider/hook/external
workflow-event dependency, but module-event infrastructure remains required.

The real Fulfillment service at `fulfillment-module-service.ts:939-1208`:

- selector branch lists original roots, builds `{id: selected.id, ...data}` and
  returns [] early when no original roots match;
- `_updateServiceZones` always loads current roots with geo_zones and checks
  missing targets, even for a scalar patch;
- supplied geo_zones is replacement, including []: it computes omitted current
  IDs, requires supplied existing child IDs to belong to that particular current
  Zone, merges their old fields and validates genuinely new children;
- it physically deletes omitted GeoZones before internal Zone update;
- real `upsertServiceZones_` partitions truthy IDs into `_updateServiceZones`,
  ID-less data into create, and returns created before updated. It is not Type129
  DAL upsert and does not automatically recreate a missing ID-bearing root.

Consequences to characterize, not repair in advance:

1. Projected original children can be physically removed by forward replacement;
   the genuine inverse's existing-child membership check can then reject those
   old IDs. Root/child existence and projection completeness must be traced;
   do not promise exact business undo or bypass the native check with generic
   graph reconstitution.
2. Native workflow UpdateServiceZone declares name and geo_zones, while the
   module DTO additionally permits id. Do not infer workflow ID-retarget support
   from Type129 or silently broaden the original workflow contract. If a named
   persistence boundary admits more, preflight its exact semantics separately.
3. Empty patch derives an ID-only preimage, but native internal update still
   performs GeoZone hydration. Child replacement/projection fields (including
   postal JSON) go through the real helper's nested relation interpretation.
4. A single shared update object selecting multiple Zones has per-parent child
   membership constraints. Existing child IDs cannot be indiscriminately applied
   across all selected roots. New children, omitted children, [] and ID-only
   retained children have distinct native paths and event behavior.

This requires a full geographic replacement/preimage/inverse witness before
implementation; it should not delay the smaller deletion root or trigger a
native business correction without an explicit decision. General Shipping
Option/provider/Location/Pricing topology, populated evolution and hosted
activation remain outside these bounded roots.
