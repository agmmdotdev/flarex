# Native Inventory Level Batch Workflow

## Status And Authority

Status: implemented for the bounded private native root. Native Inventory Item update
(115), absolute Level update (116), and Level deletion (117) are implemented.
Inventory Item deletion (118) is implemented. Shared core62 call-local row
observations are implemented. This admission does not establish deployment
activation or unbounded Inventory support. Chunked File Product
import and Product export remain deferred.

Authority is the accepted Flarex design, package boundaries, owning adoption
roadmap, and Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The exact pinned source is
`packages/core/core-flows/src/inventory/workflows/batch-inventory-item-levels.ts`
inside the read-only source island. Its actual root is
`batchInventoryItemLevelsWorkflow`, ID `batch-inventory-item-levels-workflow`.
That composer is promoted into `packages/medusa-core-flows` with its genuine
create/update steps and deletion child. Do not substitute
`bulkCreateDeleteLevelsWorkflow`, a custom three-command sequence, or the
standalone create-level workflow.

## Native Composer, Optional Values And Results

The composer has no conditional `when` branches. Its first transform always
forms createInput = data.create || [], updateInput = data.update || [], and
`deleteInput = { id: data.delete || [], force: data.force ?? false }`. The three
branches always exist, including for `{}` and explicit empty arrays:

1. `createInventoryLevelsStep(createInput)`;
2. `updateInventoryLevelsStep(updateInput)`;
3. genuine `deleteInventoryLevelsWorkflow.runAsStep({ input: deleteInput })`.

The actual call to `parallelize` groups those three results. The final native
transform returns created = res[0], updated = res[1], and
**deleted = data.input.delete**. It neither uses the selected deletion result
nor defaults the output deleted member to an empty array. Missing, repeated and
already-deleted raw IDs therefore remain in deleted when supplied. Actual
lifecycle membership, ordering, events and result maps remain independent.

The pinned TypeScript output extends BatchWorkflowOutput, which declares a
required deleted array, but the executable callback returns undefined when the
input delete member is absent. Preserve this behavior. The promoted output type
uses a narrow truthful optional deleted member, and the private JSON output
schema uses an optional key. The genuine intermediate object retains its own
undefined member; existing captureWorkflowValue and private omission metadata
already handle it. At final JSON settlement `{}` yields
`{ created: [], updated: [] }`; explicit `{ delete: [] }` yields
`{ created: [], updated: [], deleted: [] }`. Do not invent null, force deleted:[],
rewrite the native transform, or bypass the existing capture owner. The typed
facade and its exact optional-key Schema admit an omitted delete key or an
array; explicit `{ delete: undefined }` is outside that typed/Schema contract.
At the foreign JavaScript `host.run` entry, the existing captureCommerceInput
runs before Schema decoding and omits an enumerable own undefined object member,
so that representation reaches the decoder as `{}`. Direct decodeInput/Schema
calls do not use this capture and refuse the explicit undefined member. This
input seam is separate from the native intermediate output and res[2] undefined
slots preserved below. Null/nonarray input is refused by the current Schema
after capture, even though native JavaScript uses the broader || fallback.

The deletion child contributes a genuine positional undefined result in res[2].
Reuse the existing intermediate capture solution introduced for Product batch;
ordinary input/final JSON remains with its current owners. Keep the tuple and
native branch grouping in preparation identity. The expanded graph contains six
staged nodes: two direct steps, one child-workflow node, and the child's three
steps. It retains the existing 64-node ceiling; transforms themselves are
deferred values, not staged steps.

## Exact Service And Provider Closure

Create calls the actual Inventory service array overload even for []. It resolves
Inventory before invoking createInventoryLevels, captures the returned DTO array,
and stores the returned IDs in its retained compensation payload. Unlike
createInventoryLevelsWorkflow, this batch calls the direct create step and
**does not call validateInventoryLocationsStep**. No Stock Location graph or
provider should be injected to add that standalone workflow's validation.
InventoryLevel.location_id is native scalar text; a nonempty ID without a Stock
Location row is a useful compatibility witness. The Inventory Item relation,
active tuple uniqueness, normal creation defaults and numeric/raw companions
remain with genuine DML/service and shared constraints. Do not bypass those
owners or add a location-existence/availability guard.

Update resolves Inventory even for []. Empty input returns an empty result and
an empty dataBeforeUpdate/selects/relations compensation record without a DAL
read or update. Nonempty input computes native selects/relations, calls the full
`listInventoryLevels({ $or: item/location pairs }, {})` preimage read, then genuine
updateInventoryLevels once. Preserve the 116 service behavior: finite signed and
fractional stocked/incoming values; sanitization of reserved_quantity at the
native foreign service edge; required item/location existence; caller id
precedence after pair lookup; last keyed patch semantics; native result order;
and tuple-only updates/events. Native missing/soft-deleted or conflicting caller
IDs retain their actual NOT_FOUND/constraint paths. Do not independently sort,
deduplicate, suppress updates or reconcile these rows.

Deletion uses the complete 117 child. It queries exactly inventory_levels fields
id, stocked_quantity, reserved_quantity, location_id, filters raw delete IDs,
then runs the native guard before soft deletion of actual selected IDs. Force
bypasses positive stock only. The query omits incoming_quantity even though the
guard reads it; preserve that native projection omission. Positive incoming
alone is not an extra refusal in this composer. Reserved refusal precedes stock
refusal, with genuine location deduplication and error messages. Empty selection
still resolves Query and Inventory, while the generic deletion step skips the
actual softDelete method. The complete selected set remains bounded rather than
paged.

Static executing providers are Inventory and Query, plus attached native module
events. There is no native Locking.execute, Stock Location, Link, Product,
Pricing, workflow EventBus step, hook, File, Region, network effect or pause.
Empty input still enters the create and update callbacks and the deletion Query
child; verify their interleaved native resolution trace. Do not assert a total
Query→Inventory order across the three parallel callbacks. Each branch's own
resolution/call ordering remains exact. No stock-mutation or scope-exclusive
locking profile is inferred from shared Inventory storage.

## Retained Compensators And Lifecycle Ownership

All three genuine compensators remain transactionCovered. Root failure rollback
and native compensation are distinct proofs; neither substitutes for the other.

Create compensation skips absent or empty IDs before resolution. Otherwise it
resolves Inventory and invokes the **plural generated physical**
`deleteInventoryLevels(ids)`, not softDeleteInventoryLevels and not the singular
custom `deleteInventoryLevel(item, location)` helper. The inherited generated
module method ignores internal returned IDs and returns void. The real internal
service normalizes its IDs into selectors, invokes repository.delete and emits
afterDelete events for actual deleted identities. It imposes no stock/reservation
quantity guard at this inverse edge. The retained callback captures generated
creation IDs, including an empty array on an empty forward call.

The batch profile adds its retained physical Level-delete capability through
medusaLifecycle(..., "delete") and the actual generated/internal service, with
full before/delete/after-null/returned-ID/event correlation. Existing standalone
creation profiles retain their prior capabilities. The shared Level lifecycle
owner reuses checked contracts and native event dispatch. There are
no outgoing Level cascades, and no mutable Item/Reservation/Stock/Link endpoint
is granted. Existing scalarLifecycleReceipt authenticates only softDelete and
restore; do not misapply it to physical delete or merely validate a void result.
The internal command can encode native void as the established private null
representation while the genuine compensator continues to discard it. Keep this
capability internal to the batch's retained callback, with no new standalone
public physical-delete root or durable restoration API.

Update compensation skips an absent/empty preimage before resolving Inventory.
Otherwise it uses the exact captured selects/relations and genuine
convertItemResponseToUpdateRequest before the same updateInventoryLevels method.
That converter retains each row id and selected scalar keys. Both required pair
keys were in every admitted update, so the inverse retains them. Preserve full
numeric preimages and native conversion; do not snapshot/replay arbitrary stored
metadata or add another rollback transaction. The existing 116 method/receipt
owner supports this inverse contract.

Deletion compensation retains the generic 117 payload containing actual selected
IDs/module/restore method. Empty IDs skip resolution, nonempty calls genuine
restoreInventoryLevels; undefined payload preserves the native destructuring
failure. Restore includes unchanged active selected rows and their actual map
and RESTORED events. Creation rollback must remain physical removal, while this
inverse remains restoration. These operations share the deleted module-event
name but have different storage evidence; distinguish them by authentic command
identity and operation, not by event name alone.

## Implemented Composition And Bounds

1. Promote exactly the pinned batch composer with direct narrow imports of the
   already promoted create/update steps and deletion workflow. Use portable SDK
   and primary framework types. Add its exact package export/source mapping and
   truthful optional output type. Keep callbacks/transforms executable-identical
   after erased type seams; add source guards and mutation witnesses for || and
   ?? normalization, force forwarding, actual parallelize order, tuple positions,
   raw deleted output, and all three inverse payload/invocation contracts.
2. Prepare one named Inventory level-batches module/profile exposing exactly
   createInventoryLevels, listInventoryLevels, updateInventoryLevels,
   listAndCountInventoryLevels for the graph, softDeleteInventoryLevels,
   restoreInventoryLevels and internal physical deleteInventoryLevels. Reuse the
   existing creation, absolute update and Level lifecycle owners. Factor their
   connected bindings/contracts/receipts at the actual Inventory/Level owner
   rather than copying three services or creating a universal dispatcher. One
   authenticated Inventory participant owns the shared Level working set. Keep
   Item and Reservation mutation methods, quantity-adjustment helpers, physical
   Item deletion and unbounded relation APIs denied. Preserve 116/117/118 and
   existing Product creation/batch profiles.
3. Reuse the metadata-derived Level contracts for stored rows and DTO comparison.
   Existing create admits eight rows; update/deletion contracts admit four each.
   Keep these specific cardinalities rather than globally widening the four-row
   update/deletion decoders. Authenticate complete create DTOs and exact numeric
   companions, update preimages/results and per-operation lifecycle maps before
   projection. Compose command-specific event/receipt policies using authentic
   command identities, preserving strict per-command activity and aggregate root
   dependencies. Core62 is the existing prerequisite, not a second correction.
4. Add src/workflows/inventory/batch-levels.ts using the genuine composer,
   captured exact module/source/profile/method identity, graph true,
   internalModuleWorkflowEvents and one default-OCC outer settlement. Input
   admits optional create≤8, update≤4, raw delete≤4 and boolean force. Repeated
   raw requests consume their respective bound. Output has complete created≤8,
   updated≤4 and optional deleted≤4 raw IDs, preserving omitted versus [].
   Collection checks follow mutable-array construction: the installed Effect
   conversion rebuilds array schemas without retaining earlier checks. The
   facade must reject fifth raw delete requests before any native sibling runs;
   downstream child refusal is not a substitute for this admission boundary.
5. Keep genuine parallel callbacks and use existing trusted identity-bound
   operationScheduling:"queued" for their calls on one borrowed participant.
   Existing Product batches prove this scheduling mechanism. It serializes owned
   database operations without replacing parallelize with an ordered composer or
   implying cross-request exclusion. Start with the existing borrowed scheduling
   setting; only select the existing additional borrowed FIFO if an actual
   native within-command overlap witness requires it. Do not add a mutex,
   transaction, retry or separate Promise lifetime.

The maximum independent forward graph is eight created Levels, four actual
updated Levels and four actual soft-deleted Levels: sixteen lifecycle identities
and at most sixteen ordinary module event identities. Caller-ID/pair mismatch
reads can observe additional existing Level bodies within the existing 128-row
working set. Retained inverse probes must also cover eight physical deletes,
four native updates and four restores with their complete evidence. Do not
substitute a create-only or disjoint reduced workload for the full maximum.
The complete forward graph and retained inverses fit the existing 64-call/
64-event and byte/catalog/identity/node allowances. No named or default limit is
widened. Larger workloads need their own connected admission rather than smaller
witnesses or a silently loosened default.

Native parallel composition does not promise create→update→delete business
serialization. Overlapping update/delete selectors and creates targeting an
updated pair need explicit characterization under the admitted scheduler. Preserve
native successful results or native failure plus whole-root rollback. Do not add
an undocumented cross-branch disjointness guard, reread the deletion guard at a
new point, or rewrite the batch to make a preferred overlap outcome happen.
Coherent cross-request settlement remains shared OCC's responsibility.

## Validation And Disposition

Pure genuine composer tests should cover all omitted/empty combinations, force
normalization, raw deleted identities/order, the positional undefined deletion
result, optional final JSON output, exact provider closure and genuine parallel
regions. Keep native preimage and all three retained compensation bodies; prove
absent/empty inverses, ignored physical-delete return, exact updated field
selection and native generic deletion undefined-compensation behavior. Mutate
these contracts in durable provenance tests so executable drift cannot pass
merely by regenerating hashes.

PGlite and ordinary-role PostgreSQL must independently prove the full 8/4/4 graph,
complete result bodies, numerical/raw preservation, lifecycle facts/events and
physical versus soft deletion, one settlement, replay and conflicting request
identity. Exercise fifth update/delete, ninth create, malformed fields, missing
pairs, actual deleted history, duplicate tuples/IDs and caller-ID precedence.
Preserve nonempty Item, Reservation, Product/Variant, rich Links, Pricing and
Stock Location/address data. Explicitly prove the direct batch create lacks the
standalone Stock Location validation while genuine Item FK/tuple uniqueness
remains enforced. Authenticate forged ignored maps, forged/reordered result
bodies, malformed/missing/extra events and receipt effects.

Failures must include creation uniqueness/FK refusal, missing update after create
has staged, reserved/stock deletion refusal after sibling effects, caught native
participant failure, late foreign rejection and cancellation with a paused
sibling. Preserve the initiating complete Cause, sticky rollback-only state,
join/revoke escaped callbacks and publish no partial rows/facts/events/outcomes.
Test overlapping within-root operations as native parallel cases separately
from disjoint maximum coverage; do not assert an invented total branch order.

Ordinary PostgreSQL competition should run the full batch against actual
reservation, stock-delta and absolute-Level update roots over the same affected
Level. Guard and update/preimage observations must remain OCC dependencies,
including earlier graph bodies omitted from later command receipts. Accept a
coherent success/native domain refusal or sticky write conflict; never commit
stale deletion after a competing committed positive reservation, lose a committed
quantity update, or add silent retries. Validate actual scopes, identical native
keys/request keys and revoked continuations separately.

Regress native Level create/stocking, 116 absolute update, 117 deletion, 118 Item
cascade/Link deletion, reservations/deltas, Product nested creation
and batch, and shared call-local observation/lifecycle owners. Run affected
source/promotion/browser guards, typechecks/builds, lint, required two read-only
reviews and exact staged validation before one scoped commit. This slice supplies
the promoted composer, truthful optional-output type seam, combined Level profile
and retained physical-delete binding. It reuses core62 without an additional
core/schema/locking extension. Larger connected witnesses still belong to their
actual owners.

The next preflighted root is
[standalone createInventoryItemsWorkflow](./120-native-inventory-item-create-workflow.md)
(Items plus optional Levels). Deprecated bulkCreateDeleteLevelsWorkflow remains
a separate candidate requiring its own exact-source preflight. Deprecation and
existing module methods do not establish integration. Chunked File import,
Product export and hosted activation remain deferred.
