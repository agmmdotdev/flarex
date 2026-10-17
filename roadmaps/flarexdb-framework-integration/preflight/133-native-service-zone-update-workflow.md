# Native Service Zone update preflight (133)

Status: implemented bounded private native Service Zone update on PGlite and
ordinary-role PostgreSQL. Genuine full-service SQLite characterization owns the
selected native behavior, with the genuine portable root and retained inverse.
No native business correction is proposed. Public/hosted activation, populated
schema evolution, chunked Product file import and Product export remain gated.

Connected implementation uses the authorized shared
[insertion-generation order correction](../../shared-logical-storage/67-insertion-generation-order.md).
The genuine native old-Geo witness retains and returns Z,A,new after insertion
of supplied IDs Z,A and reversed existing-ID update input. The original portable
public projected preimage returned A,Z, then refused with sticky receiptMismatch
and rolled back. Native Geo hydration explicitly orders by SQLite rowid; the
[accepted creation contract](./131-native-service-zone-create-workflow.md)
already preserves that insertion-order distinction. ID sorting cannot satisfy it.
The correction belongs to neutral protected row metadata, settlement and
prepared read ordering. Adapter history reconstruction, cached ordinals, fake
native fields, timestamp guesses or weakened expected order are not remedies.
The selected logical participant admits protected insertion ordering through its
identity-bound `allowStorageInsertionOrder` capability. Core migration 149 keeps
existing revision generations unknown instead of guessing or rewriting them;
ordered reads refuse selected unknown generations. Fresh private compositions
establish this workflow without claiming a populated framework upgrade.

## Connected outcome and existing installation

Admit the genuine selector-based `updateServiceZonesWorkflow`, including name
updates, all four geographic types, existing child retention, complete geographic
replacement, projected preimages and the genuine retained upsert inverse.
The installed eight-table Fulfillment composition from 131/132 remains unchanged:
Set, Zone, GeoZone, Profile, Type, Provider, Option and Rule. Reuse its source,
write-profile, binding lineage and genuine twelve-model Fulfillment constructor.
No new table, duplicate inventory, populated upgrade or reset is required.

The mutation graph is Zone/GeoZone. Set/Profile/Type/Provider/Option/Rule rows and
FKs remain unchanged. Installing their structural tables does not admit general
Shipping Option/provider methods, Pricing, Location or stored Links. Existing
Type/Profile/Zone workflows retain their independent admitted profiles.

## Exact native root, public types and dependency closure

Pin: Medusa 2.13.4, `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, authenticated
by `third_party/medusa/SOURCE.json`. Native paths below are relative to
`third_party/medusa/upstream`.

- `packages/core/core-flows/src/fulfillment/workflows/update-service-zones.ts:15-50`
  exports `updateServiceZonesWorkflow`, ID `update-service-zones-workflow`,
  returning `WorkflowResponse(updateServiceZonesStep(input))`. Public output
  alias remains `ServiceZoneDTO[]`; there is no void-result adaptation.
- `packages/core/core-flows/src/fulfillment/steps/update-service-zones.ts:26-61`
  resolves Fulfillment, derives selects/relations from `[input.update]`, calls
  `listServiceZones(input.selector,{select:selects,relations})`, invokes genuine
  `updateServiceZones(input.selector,input.update)` and retains the projected
  originals. Nonempty inverse calls genuine `upsertServiceZones(prevData)`;
  empty/absent inverse skips resolution.
- `packages/core/types/src/workflow/fulfillment/service-zones.ts:45-82` already
  executes unchanged in `packages/medusa-types/src/workflow/fulfillment/service-zones.ts`
  through `@medusajs/types/workflow/fulfillment/service-zones`.

Workflow update fields are `name?: string | null` and optional `geo_zones`.
Entries are new country/province/city/zip data or an existing `{id:string}`.
The workflow does not declare root id, metadata, fulfillment_set_id or
shipping_options. Wider module DTOs are not an implicit workflow expansion.
In particular, Type129's root-ID retarget admission does not apply here.
The original public types remain unchanged; private resource admission bounds
their selected execution rather than replacing them with narrower native types.

There is no native Query-container resource, Link, provider invocation, hook,
external workflow event, file, lock, pause or sibling workflow. Actual internal
repository/relational reads remain mandatory. Module-only event policy, event
resource and subscriber infrastructure remain required through the existing
`internalModuleWorkflowEvents` owner. Empty forward resolves Fulfillment and
executes genuine projected-list/selector-update closure; missing or exclusively
historical matches return [] without writes/messages. Empty inverse skips it.

Promotion is limited to direct portable imports, existing narrow workflow and
Fulfillment type seams, and `compensation: "transactionCovered"` step metadata.
Full runtime/public-type comparisons and exact source-pair/classification guards
must authenticate the root and step. The existing workflow type source stays
unchanged and authenticated; no duplicate DTO or blanket type barrel is needed.

## Genuine service and persistence behavior

`packages/modules/fulfillment/src/services/fulfillment-module-service.ts:938-1118`:

1. Selector update lists active original roots. No matches returns [] before the
   internal helper. Matches become `{id:selected.id,...data}` and update in that
   native selected order. The wider module runtime merge is not root-ID workflow
   retarget authority.
2. `_updateServiceZones` always hydrates current active roots with geo_zones,
   even for scalar/empty patches, and authenticates missing target identities.
3. Supplied geo_zones is replacement, including []. Existing child IDs must
   belong to that particular current active Zone's active children. Foreign,
   missing and historical child IDs refuse with native NOT_FOUND. A shared
   existing child array cannot be applied across multiple parents arbitrarily.
4. Omitted current active children are physically deleted before internal Zone
   update. New entries use genuine `validateGeoZones`; retained existing entries
   merge current data. Existing-ID module patches bypass new-child validation;
   the workflow's declared existing entry remains ID-only.

At `:1153-1208`, genuine `upsertServiceZones_` partitions truthy IDs into the same
update helper and ID-less values into create, returning created before updated.
Missing ID-bearing roots refuse rather than being recreated. A mixed native
create/update upsert rolls back the earlier create if its later update refuses.
These module branch observations establish inverse closure, not an additional
public arbitrary-create/upsert capability.

Pinned Drizzle `packages/database/drizzle/src/medusa.ts:463-586` writes the root
only for nonempty scalar update data, then processes supplied collections.
At `:2710-2895`, collection replacement authenticates owner FKs/child identities,
rejects duplicate child primary keys, reads physical current children, removes
omitted rows, preserves unchanged retained rows and inserts/updates actual rows.
Its physical read includes history even though service membership uses active
children. Nonempty replacement physically removes omitted historical children.
The distinct empty-collection branch at `:3097-3109` skips DAL collection
replacement: service predeletion removes active omitted children, while historical
children remain untouched. Native nonempty replacement of one active/one
historical child dispatches active-child deleted, new-child created, then
historical-child deleted. Empty [] dispatches only active-child deleted. These
are different authentic paths, not inconsistent evidence to normalize away.

`packages/core/dal/src/metadata.ts:48-91` always refreshes updated_at when
persistence preparation becomes a write. Native change detection determines
whether that preparation is persisted. Preserve these distinct observed paths:

- Empty patch retains only root id, returns scalar rows and changes no timestamps
  or messages. Its ID-only retained inverse also does no write/message.
- Supplying the same name still writes, advances root updated_at and emits
  `fulfillment.service-zone.updated`. Its scalar inverse does likewise.
- Empty name is valid. Null name, though present in the workflow type, refuses
  at native required-name persistence validation; it is not a clearing operation.
- Relation-only updates leave root timestamps and root events unchanged.
- ID-only retained/reordered active children with primitive/null scalars are
  unchanged, with no child timestamp update or message. Existing non-null object
  or array postal JSON is different: independent deserialization produces
  distinct references, and native `hasChangedFields` at `:3967-3996` compares
  values with strict inequality after normalizing Dates only. These retained
  children retimestamp and emit GeoZone updated on forward and inverse despite
  unchanged JSON content. Preserve this observable native behavior; substituting
  deep equality would change it. New/removed children emit actual created/deleted.

New GeoZone validation preserves native type-specific required-field order,
truthiness and defaults: country_code; then province_code; then city; then
postal_expression for zip. Unknown/missing type is native INVALID_DATA. Casing
and postal JSON are retained; do not add HTTP-validator normalization.

## Exact projection, result shape and ordering

`packages/core/utils/src/common/get-selects-and-relations-from-object-array.ts`
is the real projection owner. Objects/arrays recurse; metadata is its explicit
nonrelation exception. Postal JSON can produce
`geo_zones.postal_expression.eq` select and
`geo_zones.postal_expression` relation paths. Genuine preimages preserve an
existing zip's complete multi-key/nested object, array or primitive postal JSON,
including opaque content outside the requested eq path. Do not project only the
eq property, drop the scalar JSON value, fabricate a relation payload or invent
a fully populated DTO. Extract the exact native storage-independent
`relationScalarFieldPaths` helper (`:3766-3820`) into the existing portable
Drizzle relation-query owner with metadata-only descriptors. This is projection
translation, not additional relationship or SQL authority. Preserve its raw_
scalar aliases and virtual terminal-field handling as well as the postal case.

Observed retained originals differ by patch:

- Empty patch: root `{id}` only.
- Scalar name: root `{id,name}` only.
- ID-only children: root id and child `{id,service_zone_id}`.
- Country replacement: child id, type, country_code and owner FK.
- The four-type replacement projection includes relevant geographic scalars and
  the complete old scalar postal expression, plus id/owner FK, without unselected
  managed fields/metadata.
- Empty [] replacement derives no child scalar selects and loads complete old
  child rows. Actual [] on an empty parent stays [] in retained data.

Scalar update results contain actual root scalars with absent geo_zones and
shipping_options. Relation-input updates include actual geo_zones, including []
when cleared, but do not initialize shipping_options. Creation131's generic
empty-to-many initialization does not apply to these results or preimages.

Root order is not merely SQL order. Native Drizzle `:348-353` applies
`preservePrimaryKeyOrFilterOrder` after the SELECT. Its helpers at `:1536-1615`
permit no ordering or sole primary-key ASC, extract direct/$or primary-key
filter order and sort actual matches by that order. Before that helper, genuine
`modules-sdk/build-query.ts:67-94` recursively normalizes array filters with
first-occurrence `deduplicate`. Thus service selector [A,B,A] returns A,B;
the helper's Map does not receive that raw duplicate array. Reversed Unicode
selectors likewise retain genuine normalized filter order even though emitted
SQL contains ORDER BY id ASC. Reuse genuine buildQuery plus the already promoted
filter-order helper and adapter `repository/result.ts`; do not apply the helper
to an unnormalized selector, substitute lexical/locale order or label this result
unspecified. Missing/duplicate IDs do not fabricate rows. Retained inverse and
update order follow genuine selected root order.

Existing child arrays use native relation loading order, not supplied replacement
array order: reversed ID-only inputs preserve stored child presentation. Genuine
event order follows actual native service and relation actions. Full active
replacement dispatches old active deletion before new creation; retained object/
array JSON with new siblings dispatches new creation before retained updates.
Historical cleanup has the separate ordering described above. Distinguish checked
native action groups from unguaranteed order within an unordered physical deletion
batch. Authenticate actual identities and messages together.

## Retained inverse limitation is part of native support

Adding children to an empty graph retains [], and the genuine inverse deletes
those newly added children successfully. Retaining all old children while adding
new ones also has a successful inverse; primitive/null old rows remain unchanged
while new rows are removed, and retained object/array JSON rows receive their
native update writes/messages. Full four-empty-root→sixteen-new forward/inverse
emits sixteen created then sixteen deleted. Full four-root/sixteen-current empty
patch plus inverse is a true no-op. These are real business compensation paths,
separate from atomic failed-root rollback.

Removing any old active child physically removes its ID. The genuine projected
inverse then passes that old ID to the helper's current-active-child membership
check and refuses with MedusaError NOT_FOUND:
`The following geo zones does not exists: <old IDs>`.
This holds for replacement, partial removal and []. The inverse changes no rows
or messages on refusal; it does not silently recreate old rows. For multiple
roots, the error names the missing children of the first failing selected parent.

The complete four-root sixteen-old→sixteen-new native replacement emits sixteen
GeoZone deleted messages followed by sixteen created messages, with no Zone
timestamp/event write. Its genuine inverse refuses the removed old IDs. Preserve
that outcome. Do not skip deletion, retain synthetic rows, handwrite a successful
inverse or enable generic reconstitution to repair native behavior. Retaining
this native limitation requires no new native business decision. Any proposed
correction needs a separate explicit decision and genuine failing witness.

## Bounds, resources and shared owners

Private execution admits at most four selected Zones, sixteen current
Geo rows including required history and at most four replacement entries per
Zone. Full replacement can involve thirty-two distinct old/new Geo identities;
receipts/working sets must cover the complete before/after graph instead of
truncating to sixteen identities. The native broader module characterization
includes one retained plus four new children only to establish behavior; it does
not silently expand the private four-entry-per-parent bound.

Reuse the existing eight-table metadata/source/binding, genuine constructor,
`service-zone-graph-contracts.ts`, current query/row/event owners and actual shared
graph replacement machinery. Native business checks/projection remain in the
genuine service. Shared replacement evidence must prove complete current/history
reads, owner hierarchy, real physical deletion, generated IDs, retained no-op
rows, timestamps, result projections and message correlation. It must not grant
an inverse that the genuine helper refuses.

The complete admitted graph covers new-child forward plus genuine inverse,
retained-child compositions, scalar compositions and full replacement plus
authentic inverse refusal. Preserve the
full graph and accepting forward result when inverse is not invoked; when an
inverse failure occurs inside one portable atomic root it must make that entire
root rollback-only. Native callbacks used separate native transactions, so the
native report alone cannot establish portable settlement/resource behavior.

The named update profile selects 128 calls through the existing trusted,
identity-bound host and logical resource API. The complete four-empty-root to
sixteen-new-child root plus genuine inverse requires 123 calls; the default
64-call allowance cannot admit that connected outcome. The default event
allowance remains unchanged and covers its thirty-two module messages. This
selection is independent of the 132 deletion-only 256-call/128-event profile;
all unrelated profiles and other limits remain unchanged.

Native backend SQL formatting remains distinct from the accepted typed host
failure boundary. Native required-name/duplicate-child/plain uniqueness errors
must retain atomic refusal, while portable storage emits its authenticated typed
failure and latches rollback-only. Native business MedusaError validation and
NOT_FOUND checks stay genuine. Do not misclassify backend formatting as a new
business correction or swallow native failures.

## Connected implementation and admission boundary

Native ownership includes workflow/step update-service-zones files, two narrow
exports, complete runtime/public-type guards and mutation cases, exact two source
pairs/classifications/provenance and portable inventory. The existing native
workflow type source/export remains reused unchanged. The portable relation-query
owner gains only exact metadata-driven relationScalarFieldPaths extraction, with
complete runtime/public seam guards and exact native source provenance. Parent
owns promotion refresh/build/source gates; these native changes alone do not
establish connected adapter support.

The adapter binds the genuine root through service-zone-update input, graph,
query, repository, receipt and service owners. It reuses the existing DML
inventory, graph replacement, scalar/query and event mechanics. Existing Product
and Store replacement profiles explicitly retain their upsert operation and
declared column ordering; update semantics and intrinsic child ordering belong
to the selected Service Zone profile.

The bounded contract covers native success/refusal, projected originals,
no-op/event/inverse paths, full maximums, complete indexed selection/history,
FK/dependency preservation, global name conflicts, concurrent child
insertion/deletion, overflow, caught denial/rollback-only, scope identity,
cancellation, replay and revocation. Module events and subscribers remain
mandatory even though this root emits no external workflow event. Physical
rollback does not replace the genuine native inverse or grant it stronger
membership behavior.

Broader selectors, arbitrary module upserts, larger graphs and public/hosted
activation remain unadmitted. General Shipping Option creation still needs its
own provider/ServiceZone/Set/Query/Link preflight. Installing the future
Location–FulfillmentSet Link also requires migrating Stock Location deletion's
complete native cascade; the current eight-table source does not install it.
