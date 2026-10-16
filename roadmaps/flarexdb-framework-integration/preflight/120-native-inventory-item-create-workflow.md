# Native Standalone Inventory Item Creation Workflow

## Status And Authority

Status: preflight complete; implementation pending. Inventory Item update (115),
Level update (116), Level deletion (117), Item deletion (118), and Level batch
(119) are implemented for their bounded private profiles. Core62 is implemented.
Chunked File Product import, Product export and hosted activation remain deferred.

Authority is the accepted Flarex design/package boundaries and pinned Medusa
2.13.4, commit `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. Exact root:
createInventoryItemsWorkflow, ID create-inventory-items-workflow, native source
packages/core/core-flows/src/inventory/workflows/create-inventory-items.ts. Unlike
119, this composer is **already promoted and executing** beneath native Product
Variant creation. The missing work is its complete standalone facade/profile and
retained physical Item inverse. Add a narrow package export, not another composer.
Keep the source island read-only.

## Exact Native Order And Result Contract

The ordered root transforms input with buildLocationLevelMapAndItemData, invokes
createInventoryItemsStep, builds the Level child input with
buildInventoryLevelsInput, always invokes createInventoryLevelsWorkflow, and
returns the original created Item DTO array. There is no when, parallelize, hook,
Locking, Link, Pricing, File, Region, remote effect or workflow EventBus step.
Attached native Inventory module events remain required.

The first helper assigns data.items = data.items ?? [], then removes each
location_levels member from the data forwarded to Item creation. It retains an
index→nested-Level-array map; absent and empty nested arrays become []. The
native interface declares items required, but the executable helper admits
missing items as an empty collection. A truthful standalone boundary can make
items optional and preserve that native fallback. Public null/malformed fields
can still fail closed; do not infer their admission from JavaScript's broader
nullish behavior. Native helper mutation operates on the existing detached
workflow capture, never on a caller-owned object. Keep this helper unchanged.

The second helper iterates the **returned Items in result order**, retrieves the
nested array at the same ordinal, flattens Levels in per-Item input order, and
adds inventory_item_id:item.id after spreading each nested record. Do not map by
SKU, input ID, sorted ID or a separate adapter association algorithm. Preserve
native final-assignment precedence over any foreign transient nested Item ID;
the admitted nested DTO itself omits inventory_item_id. Item creation must fully
authenticate returned length, unique actual identities, complete bodies and
**array order before this transform**. Merely checking that returned IDs belong
to an inserted set permits reordered valid Items to attach Levels to the wrong
Item. This is a concrete stronger receipt obligation at the existing Item-create
owner, whose current inventoryCreateEventPolicy checks set membership rather
than complete ordered DTO correlation.

The Level child is unconditional even with no Items/no nested Levels. The root
returns Items only; nested Level DTOs are discarded by its composer but must be
fully authenticated by their module boundary. The existing promoted child-option
seam uses runAsStep({ input: inventoryLevelsInput.input }) instead of passing the
transformed options proxy as an own-property record. This preserves the native
transformed input under the portable SDK's capture contract. Retain and narrowly
authenticate that exact existing seam; do not copy either mapping helper.

## Providers, Empty Inputs And Stock Location Behavior

createInventoryItemsStep always resolves Inventory and calls the native array
overload, including []. The real module sanitizes location_levels out of foreign
Item data and delegates genuine internal creation/defaults. Its StepResponse
captures the returned Item IDs. Empty Item input returns [] but does not skip the
Level workflow.

The real createInventoryLevelsWorkflow first calls
validateInventoryLocationsStep, then createInventoryLevelsStep. Native location
validation resolves REMOTE_QUERY even for [] and requests entryPoint
stock_location, fields:[id], variables.id equal to every requested Level's raw
location_id. The executing portable fork resolves Query.graph instead, uses the
native stock_location alias and the same IDs, and requires complete count/skip
metadata before the unchanged arrayDifference/NOT_FOUND business guard. It uses
the existing maxPageSize, not a new page traversal or fallback. arrayDifference
uses Set membership, so missing location names are deduplicated in first input
occurrence order. Exact error:
Stock locations with ids: ID, ID was not found.

An empty child therefore still performs the Stock Location Query with id:[] and
then resolves Inventory and calls createInventoryLevels([]). Preserve this exact
ordered Inventory→Query/Stock Location read→Inventory closure and no-op method
calls. Empty roots still require the installed read-only Stock Location graph
participant. This differs from 119's direct create step, which has no Stock
Location validation. Do not reuse the batch facade or bypass this native child.

Only the Stock Location ID-read profile is required: graph true, methods:[], no
creation/update/deletion capability and no Address mutation. Native Item/Level
creation needs Inventory create methods, with inverse-only physical deletes.
The root creates no Stock Locations or addresses. Existing inactive/deleted
location filtering, genuine missing/duplicate ID behavior, scalar Item FK and
active Item/Location uniqueness remain with their existing owners. Missing
locations fail after Item creation has staged, so the whole root must roll back.

The existing Stock Location read receipt checks read-only effects but does not
correlate native returned IDs/count with observed rows. For this standalone
existence guard, add a scoped result-authentication correction at that same read
owner, deriving the exact selected native projection/count from genuine activity.
First add a failing forged-existing-ID witness, then regress other Stock Location
read consumers. No adapter SQL reread, synthetic successful location, alternative
transaction or shared-core weakening is an acceptable replacement.

## Retained Physical Inverses And Native Events

Item creation compensation skips missing/empty IDs before resolution; otherwise
it calls plural generated deleteInventoryItems(capturedCreatedIds). This is
physical deletion, not 118's soft-delete workflow and not remote Link cleanup.
Its module API returns void; the generated internal service constructs
{$or:[{id},...]} and dispatches actual deleted Item IDs. The current Item/Level
creation profiles deny this inverse. 119's physical Level inverse is
reusable only after that slice completes its validation; it does not grant
physical Item deletion or its cascade closure.

InventoryItem DML declares cascades over location_levels and reservation_items.
The pinned compiler lowers the inverse belongsTo FKs to onDelete:cascade. Native
Drizzle physical delete relies on database FK cascades and returns/emits for
**root Item rows**, not child Level/Reservation deletion messages from a separate
module-service call. Reuse medusaLifecycle(...,"delete") to plan/remove the
complete logical FK closure in child-before-parent order, and pass only actual
root IDs back to the genuine internal Item service for native afterDelete event
dispatch. Do not replay the soft-delete descendant event map here or emit a
second set of physical events at the repository. All physical descendant facts
still require exact full-row/tombstone authentication.

The ordinary retained inverse order is Level-create compensation first, then
Item-create compensation. The genuine Level inverse calls plural physical
deleteInventoryLevels(actualCreatedLevelIds), already prepared by 119, with
Level deleted events. Item compensation then removes the Item roots; children
already removed by the earlier inverse are missing no-ops. Separately prove
Item-only inverse traversal while descendants still exist, including deleted
history. It must preserve the native physical cascade rather than fail on an
otherwise supported Item/Level graph or substitute quantity-release commands.
No native stock/reservation sufficiency guard applies at this inverse edge.
No Link provider is resolved and no remote Link routing is invented.

Propose the existing four-Item/two-persisted-Levels/one-persisted-Reservation per
Item closure for the private Item inverse: at most four Items, eight historical
Levels and four historical Reservations, including already-deleted rows. This
keeps 118's complete history bounds and authentic quantities/raw companions;
overflow refuses before publication rather than truncating descendants. The
forward workflow creates no Reservations or Links. If another endpoint/reference
obligation produces a real refusal, preserve it and correct its actual owner;
this is not authorization for a hidden Link cleanup or an arbitrary public
physical Item-deletion API.

## Proposed Connected Work

1. Reuse the already promoted native root, Item step and real Level child. Add
   the exact standalone export and durable source guards for both mapping
   helpers, ordered callbacks, existing child-option seam, empty behavior,
   returned array and retained inverses. Regress their existing Product/Variant
   consumers; source provenance must not depend on regenerated hashes alone.
2. Add one named Inventory item-creations profile with createInventoryItems and
   createInventoryLevels, plus retained-only deleteInventoryItems and
   deleteInventoryLevels. Keep update/stock/reservation/soft-delete APIs denied.
   Reuse the genuine scalar Item creation owner and 119's strict Level create,
   physical Level lifecycle binding and event receipts once validated. Factor
   current complete Item row contracts from 115 where they match actual native
   creation DTOs; do not maintain duplicate shape/default validators or wrappers.
   Fully authenticate Item input/defaults/metadata/dimensions, ordered DTOs and
   module events. Apply the same complete-before-discard rule to Level results.
3. Extend the real Inventory physical lifecycle owner for the bounded Item FK
   cascade and root-only native event grammar. Do not turn the soft-delete
   helper into a universal operation dispatcher or use a SQL deletion shortcut.
   Keep other consumers' current profiles/limits and native callback behavior.
4. Reuse the read-only Stock Location graph and strengthen its actual ID-result
   receipt as described above. Add no Location/Address writes or unrelated
   providers. Bind exactly Inventory and stock_location in a new standalone
   facade over createInventoryItemsWorkflow, module-only events and one existing
   default-OCC outer settlement. Ordered native composition needs no new
   scope-exclusive lock or parallel scheduling profile.

Admit optional items≤4; each Item may have absent/empty or at most two nested
Level DTOs (location_id plus optional finite stocked/incoming numbers), total
Levels≤8 and up to eight distinct existing Stock Location IDs. Reuse the existing
Item creation fields/defaults and explicit internal creation-ID disposition
rather than silently changing established seed/consumer contracts. Nested Level
inputs cannot specify another Item identity, reserved quantity, raw companions
or managed lifecycle values. Native dimensions and quantities retain signed,
fractional and large finite values where their actual contracts permit them.
Return the full ordered created Item DTO array≤4, including defaults, with no
invented nested Level response or alternate create summary.

The maximum forward outcome is twelve new rows and twelve Inventory created
identities, plus up to eight genuine Location observations. A complete reverse
callback probe can physically remove eight Levels then four Items with the
corresponding twelve root method events; Item-only inverse can remove its full
sixteen-row history closure while emitting only root Item events. Start with
existing 64-call/64-event, 128-identity and current byte/catalog/node allowances.
Measure maximum forward and both inverse shapes before claiming they fit; any
needed allowance belongs to a named trusted identity-bound owner, never input
or a silently widened default. Expected expanded ordered graph is four nodes:
Item step, Level child workflow, Location validation and Level create step.
Verify the actual prepared graph rather than raising the 64-node ceiling.

## Required Proofs And Disposition

Pure genuine tests must prove index-based association with deliberately reordered
scripted outputs, exact missing-location error/deduplication, omitted/[] behavior,
complete provider closure including empty queries, default handling and helper
ownership. Distinguish a scripted source callback characterization from the
private receipt's required rejection of forged/reordered service results.
Characterize both physical inverse methods, their exact captured generated IDs,
absent/empty skips, native void results and child-before-parent inverse use.

PGlite and ordinary-role PostgreSQL must prove four Items/two Levels each across
eight existing Locations, full Item and ignored Level DTO authentication, signed
quantities/raw companions, complete module events/facts, one settlement/replay,
request conflicts and actual scope isolation. Preserve nonempty preexisting
Product/Variant/Pricing/Link/Reservation/Location/Address families. Exercise fifth
Items, third nested Level, duplicate active SKU/tuple, missing/deleted Locations,
forged Location ID/count, malformed/reordered Item results, malformed Level
results/events, caught participant refusal, late child failure and cancellation.
Prove caller input remains unchanged despite the native helper's mutation.

Retained inverse proofs need actual physical tombstones with null payload hashes,
full history and cardinality refusal, missing/already-removed identities and
correct root-only versus explicit Level-delete events. They are separate from
whole-root rollback after the native child refuses. Ordinary PostgreSQL races
with native Stock Location soft deletion or conflicting Item SKU/Level tuple
creation must retain read/uniqueness dependencies and produce a coherent root or
sticky conflict, not stale successful validation or silent retries.

Run affected creation/stocking, 115–118, 119 after completion, Product/Variant
creation/batch, read-result and lifecycle regressions, both database lanes,
source/promotion/browser guards, typechecks/builds, lint, required reviews and
exact staged checks before a scoped commit. Concrete missing owners are ordered
full Item-create receipts, the standalone composition, retained physical Item
cascade and Stock Location read-result authentication. No additional core,
schema/migration, locking or host blocker is established by source inspection;
new connected failures still belong to their true owner. This preflight makes
no implementation or deployment claim.
