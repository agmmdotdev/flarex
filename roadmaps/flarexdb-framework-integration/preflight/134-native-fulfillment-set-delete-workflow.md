# Native Fulfillment Set deletion preflight (134)

Status: implemented within the bounded private portable profile. This record
does not activate a public API, bootstrap host or populated schema upgrade.
The original empty-Link baseline below is preserved as a distinct native
witness. [137](./137-native-location-fulfillment-set-workflow.md) replaces that
assembly with the stored LocationFulfillmentSet family and owns the current
512-call/256-event allowance, complete history and genuine double restoration.

## Complete selected outcome

Admit the genuine `deleteFulfillmentSetsWorkflow` with zero to four raw Set IDs,
the complete local Set/Zone/GeoZone/ShippingOption/ShippingOptionRule soft cascade,
the genuine common remote-Link cleanup, and the retained raw restore callbacks.
Reuse the eight-table Fulfillment source already selected by 131–133. Installing
a LocationFulfillmentSet Link and linked Set creation belong to 137's connected
outcome. Chunked Product file import and Product export remain deferred.

Native authority is Medusa 2.13.4, commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, authenticated by
`third_party/medusa/SOURCE.json` and `SOURCE_SHA256SUMS`. Native paths below are
relative to `third_party/medusa/upstream`.

## Native root, steps and ordering

- `packages/core/core-flows/src/fulfillment/workflows/delete-fulfillment-sets.ts:36–46`
  exports `deleteFulfillmentSetsWorkflow`, ID `delete-fulfillment-sets-workflow`.
  Its public alias is `{ids: string[]}`. It calls
  `deleteFulfillmentSetsStep(input.ids)` and then
  `removeRemoteLinkStep({[Modules.FULFILLMENT]:{fulfillment_set_id:input.ids}})`.
  Its native result is void.
- `fulfillment/steps/delete-fulfillment-sets.ts:15–38` always resolves Fulfillment,
  awaits `softDeleteFulfillmentSets(ids)`, discards its map and returns
  `StepResponse(void 0, ids)`. The inverse skips absent/empty retained arrays,
  otherwise resolves Fulfillment and awaits `restoreFulfillmentSets(prevIds)`.
- `common/steps/remove-remote-links.ts:29–79` groups scalar/array entries without
  deduplicating ID arrays, resolves Link and awaits `delete(grouped)`. The actual
  grouped object is both output and retained input. The inverse skips only an
  absent object, then resolves Link and awaits `restore(removedLinks)`.

The Set and Link actions are serial despite not consuming each other's result.
The unchanged root composer and native `OrchestratorBuilder` execute registration
as Set then Link. Native `create-step.ts` applyStep delegates to flow.addAction;
`orchestrator-builder.ts:38–48` appends after findLastStep. Native
`transaction-orchestrator.ts:189–199,223–229` sorts compensation by descending
depth and waits for next steps to be reverted. The reverse sequence is Link
then Set. No parallelize call is present.

The external comparison executes unchanged callbacks and exact composer/builder
registration; it does not execute the complete native workflow scheduler.
Connected portable genuine SDK tests must separately establish the supported
root/retained-callback composition. Manually choosing a convenient inverse order
does not prove native scheduler behavior or one outer settlement.

Promoted execution uses
`packages/medusa-core-flows/src/fulfillment/{workflows,steps}/delete-fulfillment-sets.ts`
and the existing common step. Narrow exports are
`@medusajs/core-flows/fulfillment/delete-fulfillment-sets` and `-step`.
The only adaptations are direct portable imports, transactionCovered step
metadata, and the established explicit `WorkflowResponse(void 0)` completion.
Public root/step input aliases and callback bodies remain native. Host completion
is null. No SDK-wide behavior change or native business correction is selected.

## Empty dependencies and real Link boundary

`{ids:[]}` still resolves Fulfillment and calls native soft deletion. The native
map is `{}` and no mutation event is emitted. The common step receives one object
containing an empty endpoint array, so it must resolve Link, call delete, and
retain `{fulfillment:{fulfillment_set_id:[]}}`. Its retained inverse resolves Link
and calls restore even when that endpoint array is empty. The Set inverse skips
its empty raw array. Both genuine empty Link methods return `[null,{}]`.
Passing `[]` directly to the common step is different: its entries array is empty
and neither forward nor absent retained inverse resolves Link.

The original 134 baseline uses the genuine promoted Link class with an explicitly selected empty Link
registry. `new Link([])` natively falls back to `MedusaModule.getLoadedModules()`;
the comparison retains that exact constructor and authentic static Map/accessor
implementation. Its selected registry is genuinely empty, with full Fulfillment
constructed outside bootstrap. This is not evidence for an arbitrary native
global bootstrapped module graph. Do not mock an accessor or synthesize empty
Link results. The portable explicit Link resource admits only the Fulfillment
`fulfillment_set_id` endpoint and the actual bounded raw arrays.

There is no root Query, provider invocation, external workflow event, hook,
Pricing, Region, File, Locking or pause. Internal indexed lifecycle reads and
module subscriber/event aggregation remain required. Reuse
`internalModuleWorkflowEvents`, the host event policy/resource and selected
subscribers. Absence of emitEventStep does not remove module event infrastructure.

## Genuine generated service and five-model cascade

Executing `packages/medusa-fulfillment/src/services/fulfillment-module-service.ts`
inherits the Set lifecycle. Native generated methods in
`packages/core/utils/src/modules-sdk/medusa-service.ts:268–327` normalize IDs,
invoke internal lifecycle and translate actual model cascade rows into linkable
keys. Internal lifecycle/decorators are in `medusa-internal-service.ts:557–610`.

The native Drizzle owner is `packages/database/drizzle/src/medusa.ts:684–813`;
recursive declared-cascade traversal is at `:1867–1949`, and visited model/row
membership at `:2093–2120`. Active root soft deletion assigns deleted_at and
updated_at, then traverses declared delete cascades. Restore selects all physical
matching roots, including active or historical rows, checks active uniqueness,
clears deletion and assigns update time before the same traversal. Descendant
FK UPDATE has no active-only or matching-deletion-time predicate.

The actual model graph is:

1. FulfillmentSet cascades service_zones.
2. ServiceZone cascades geo_zones, then shipping_options.
3. ShippingOption cascades rules.
4. GeoZone and ShippingOptionRule are leaves.

Native model paths are `packages/modules/fulfillment/src/models/fulfillment-set.ts:5–24`,
`service-zone.ts:27–57` and `shipping-option.ts:11–42`. Set and Zone names each
have global active-name uniqueness. Required parent and Option Profile/Type/
Provider FKs remain present. No cascade reaches those dependency rows or
Fulfillment, its address/items/labels, Product or Pricing. The full native
twelve-model comparison retains all seven other tables unchanged; portable
storage reuses its existing eight owned tables without duplicating inventory.

Native maps and module-event groups follow Set→Zone→Geo→Option→Rule. Keys are
`fulfillment_set_id`, `service_zone_id`, `geo_zone_id`, `shipping_option_id` and
`shipping_option_rule_id`, included only for actually reached rows. Empty maps
are `{}`. Events use the corresponding native deleted/restored family names and
actual IDs. Validate map/event correlation from genuine mutations; never copy a
fixture's expected rows into a result.

Root/descendant UPDATE RETURNING has no ORDER BY. Observed SQLite within-family
insertion order is not a portable SQL guarantee or a raw-request/ID ordering
contract. Preserve checked native model-group order independently of FK write
order. Within-group IDs and events correlate with the actual authenticated
logical lifecycle transitions; this profile does not select133's insertion-order
capability or claim SQLite rowid parity.

## Characterized native behavior retained

- Duplicate/missing raw IDs remain exactly in the genuine retained array and
  common Link grouping. Physical row/map/event membership contains unique
  actual matches. Missing rows are not created.
- Historical Set roots are skipped by forward soft deletion, and their active
  descendants are not reached solely because the Set ID was requested. Raw
  inverse can nevertheless restore that historical Set and its later children.
- Reached historical descendants are soft-deleted again, advancing deletion
  and update timestamps. Synthetic original deletion=null drives deleted events.
- Restore follows physical FKs across active/historical descendants. Already
  active rows advance update time and emit restored again, including repeated
  restore of the exact same genuine retained input. Older child history may be
  revived; this is not an exact prior-state restoration ledger.
- The complete 48-row active graph and all-active-root mixed-history graph each
  emit 48 native module events in forward and 48 in restore. These are semantic
  complete-graph counts, not measured portable bounded-call costs.
- Restore can fail if a new active Set or Zone owns a restored global name.
  Native Set collision is a formatted plain Error; descendant Zone collision
  surfaces native DrizzleQueryError with SQLite unique-constraint cause. Both
  roll back the complete service operation and emit no mutation messages.
  Preserve the accepted shared typed invalidInput failure and rollback-only
  boundary rather than copying backend SQL/error formatting into a business API.
- Scalar data, IDs, FKs and created_at remain unchanged by the lifecycle. Only
  native deletion/update timestamps and the corresponding lifecycle events move.

Use the existing explicitly selected identity-bound
`allowActiveRestoreUpdate:true` policy for all five affected families. Default
profiles keep their prior behavior. Raw inverse authority is the bounded native
ID command, not a hidden prior-forward identity ledger.

## Shared Fulfillment receipt correction

The shared `modules/fulfillment/fulfillment-lifecycle-receipt.ts` owner serves
both the existing 132 Zone lifecycle and 134 Set lifecycle. It must distinguish
actual final observations from the first mutation preimages used to plan native
selection and transitions. For each written identity, the observed final row
must equal the decoded afterimage of that identity's final mutation, including
managed values and every native scalar. Repeated writes compare against the
last mutation rather than an intermediate afterimage. A missing or forged final
observation fails with receiptMismatch.

Expected: genuine final observations remain independently authenticated while
first preimages reconstruct the command's entry state for lifecycle planning.
Actual defect in the previous 132 validator: its planning map could overwrite
final observations with first preimages without independently comparing the
actual final row to the last mutation. A forged final observation could therefore
be masked by otherwise genuine planning evidence.

Disposition: correct that shared Fulfillment receipt owner, retain separate
actual-final and planning-preimage maps, and require final-afterimage equality
before graph/map/event correlation. Both Zone and Set consumers use the same
correction. Preserve genuine preimage planning, native selection/event ordering,
full history, active restore and complete rollback behavior. This repairs adapter
evidence validation; it does not change the shared storage protocol, introduce
an extra read or alter native business behavior. Existing132 regression coverage
and adversarial missing/forged final-observation cases remain required.

## Original 134 Bounds, Source Reuse And Resource Profile

Admission is zero to four raw IDs, each nonempty and at most 256
characters, preserving duplicates and Unicode. The complete aggregate graph is
at most 4 Sets, 4 Zones, 16 Geos, 8 Options and 16 Rules: 48 rows. These are global
limits, not four Zones per Set. Preserve complete historical FK candidate
coverage and distinguish physical candidates from active forward results.

Keep existing per-record/value/read/write/scan/byte caps and identity/replay
proofs. The complete 48-row forward plus actual retained Link/Set inverse selects
the original 134 identity-bound optimistic 256-call/128-event profile through the
existing trusted API. That empty-Link composition uses 173 bounded calls and 96
events on both drivers; separate method maxima do not establish this allowance.
Default 64 limits cannot admit that composition. Do not shrink the connected
graph or widen any other profile. This named allowance uses the existing
resource owner under standing core authorization; no new core mechanism is
selected and all other profiles and resource limits remain unchanged.

Adapter construction reuses `modules/fulfillment/fulfillment-module.ts` and the
existing eight-table schema source. `fulfillment-graph-contracts.ts` owns the
checked graph, preserving explicit four-family Zone consumers and selecting the
five-family Set graph. All 131–133 callers use that owner; the displaced
service-zone-graph-contracts source/export/inventory entry is removed.
No populated upgrade or reset is selected.

## Location Link installation is owned by 137

The original 134 slice installed no LocationFulfillmentSet family. Native
`packages/modules/link-modules/src/definitions/fulfillment-set-location.ts:4–72`
owns `location_fulfillment_set`, StockLocation/Set endpoints and deletion cascade
into FulfillmentSet. 137 migrates this deletion resource and the existing Stock
Location deletion together, satisfying 114's connected-family admission and
131's source-composition gate. Endpoint installation/schema
authority does not imply referenced-row existence: accepted stored-Link policy
uses no endpoint FKs, and native dangling scalar endpoint success is preserved.

Native Set creation is `createLocationFulfillmentSetWorkflow`, not an isolated
module-create root: its required Location Link belongs to 137's connected outcome.
General ShippingOption creation additionally requires actual provider/Query,
Pricing/Link and conditional Region closure and remains unadmitted.

## Acceptance and provenance

Authenticate complete root/step runtime and erased public types against their
exact pinned source pairs. Source guards permit only the named portable seams;
mutation tests reject changed endpoints, empty guards, grouping inputs, resource
resolution, step order, results, awaits, raw inverse and extra imports/effects.
Public package exports and browser portability must include the genuine new
root and facade. Promotion refresh must preserve all retained source pairs,
classifications and output proofs, retiring only the named displaced graph owner
and its truly owned obsolete outputs.

Connected proof must include both database drivers, actual full root and genuine
retained callbacks, complete 48-row composition and resource exhaustion rollback,
historical descendants, active repeated restore, both global-name conflicts,
concurrent indexed child insertion/uniqueness, wrong source/scope/replay,
malformed maps/events/Link output, cancellation and existing131–133 consumers.
Native comparison evidence does not establish those portable gates. Required
types/builds/source/portability/lint checks and both read-only reviews precede a
scoped commit; no broader activation follows from bounded private support.
