# Native Service Zone creation preflight (131)

Status: implemented bounded private native Service Zone creation and complete
historical physical inverse, with PGlite and ordinary-role PostgreSQL proofs.
Hosted/public activation and populated-schema evolution remain outside this slice.

## Connected scope

The genuine `createServiceZonesWorkflow` creates bounded new Service Zones and
nested GeoZones of all four native types under existing FulfillmentSets. Its
genuine retained inverse physically deletes selected Zones and their complete
bounded GeoZone/Option/Rule history. Service Zone update and soft-delete/restore
workflow roots remain unadmitted. Shipping Option/provider/Location topology,
chunked Product file import and Product export retain their separate gates.

## Pinned and executing source

Medusa 2.13.4 pin is `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, authenticated by
`third_party/medusa/SOURCE.json`. Native paths below are relative to
`third_party/medusa/upstream`; executing paths explicitly begin `packages/`.

Primary root and step:

- `packages/core/core-flows/src/fulfillment/workflows/create-service-zones.ts:48-55`
  exports `createServiceZonesWorkflow`; ID `create-service-zones-workflow`.
- `packages/core/core-flows/src/fulfillment/steps/create-service-zones.ts:17-42`
  exports `createServiceZonesStep`; ID `create-service-zones`.
- `packages/core/types/src/workflow/fulfillment/service-zones.ts:35` declares
  `{data: CreateServiceZone[]}`. Creation entries have name, fulfillment_set_id
  and optional geo_zones. Their nested types come from the real Fulfillment DTOs.
- `packages/modules/fulfillment/src/services/fulfillment-module-service.ts:349-395`
  contains the real create method and transaction-decorated internal helper;
  `:2145-2180` contains `validateGeoZones`.
- Executing constructor/service/DML copies already exist under
  `packages/medusa-fulfillment/src/`. Existing shared constructor is
  `packages/medusa-adapter/src/modules/fulfillment/fulfillment-module.ts` /
  `defineFulfillmentPersistenceModule`.

The root executes only `new WorkflowResponse(createServiceZonesStep(input.data))`.
The step resolves Fulfillment, calls genuine `createServiceZones(input)`, returns
the actual array and retains `createdServiceZones.map(row => row.id)`. Inverse
returns before resolution for absent/empty IDs, otherwise calls genuine
`deleteServiceZones(createdIds)`.

There is no Query-container, Link resource, workflow hook, workflow emit-event
step, provider invocation, child workflow, lock, external effect, file or pause.
Native repository graph reads and module events do not justify inventing those
workflow resources. Use existing graph-disabled host composition and module
event bus, not a direct insert facade.
The host still requires its genuine module-event policy and event resource:
reuse `internalModuleWorkflowEvents`, event-resource preparation and admitted
subscribers, as in the existing Shipping Profile update facade. Absence of a
native workflow emit-event step removes no required module-event infrastructure.
No separate external workflow event family is introduced by this root.

For `{data: []}`, Fulfillment resolution and its genuine public create still
occur. `createServiceZones_` returns [] before internal repository creation, so
there is no graph write/module creation message. Root returns []; inverse skips
empty IDs before resolving Fulfillment. Do not short-circuit that public method
resolution in the facade or invent an external workflow event dependency.

## Service validation and DML contracts

The public service normalizes scalar/array input only for its internal call,
serializes the genuine result and preserves the caller's scalar/array shape.
The root/step call the array overload, including empty arrays.

Before any repository create, the helper traverses every root's nonempty
geo_zones and invokes the genuine static validator. Keep its existing redundant
inner length check. Do not replace or copy its required-property matrix:

- country: truthy country_code;
- province: country_code and province_code;
- city: country_code, province_code and city;
- zip: those fields plus truthy postal_expression.

It rejects an unknown type with native MedusaError/INVALID_DATA and message
`Invalid geo zone type: <type>`. Missing/falsy required values produce
`Missing required property <property> for geo zone type <type>` in native loop
order. There is no lowercasing, ISO-code validation, postal-expression parser or
business normalization in this create method. Empty country_code is rejected by
the native truthiness check. Non-required nullable fields and JSON retain DML
semantics; HTTP/DTO prose is not additional persistence validation.

GeoZone DML defaults type to country, but the service validator runs before that
default. Missing type in a nonempty child therefore fails with native
`Invalid geo zone type: undefined`, while direct DAL creation defaults it to
country. Shape capture preserves this service/default precedence without
repairing invalid GeoZones or duplicating native business validation.

Models already promoted:

- `packages/medusa-fulfillment/src/models/service-zone.ts`: serzo ID, required
  name and fulfillment_set FK, nullable JSON metadata, geo_zones/shipping_options
  hasMany, global active-name unique index, delete cascades to both child families.
- `models/geo-zone.ts`: fgz ID, native enum/default, required country_code,
  nullable province_code/city/postal_expression/metadata, required service_zone
  FK and native active geographic indexes.
- `models/fulfillment-set.ts`: fuset parent, required name/type, nullable
  metadata and global active-name uniqueness. Parent creation is not part of
  this root; an existing physically present parent is an explicit precondition.
- `models/shipping-option.ts` and `models/shipping-option-rule.ts` determine the
  physical inverse's already-owned Option branch and its Rule cascade.

Preserve native active-name uniqueness globally, not per FulfillmentSet. A
historical same-name Zone may coexist; a second active same-name Zone may not.
Active and historical FulfillmentSet parents both accept the scalar FK; there
is no active-parent business lookup. In the pinned SQLite comparison, missing
parents fail with DrizzleQueryError caused by FK refusal, and active-name
collision throws plain Error `Service zone with name: <name>, already exists.`
from native DAL index validation. The adapter preserves physical parent
existence and active-name uniqueness through shared constraints and their typed
failure boundary, including deferred FK refusal. It does not fabricate an
active-parent guard or native SQL error. Empty Zone names remain valid and
participate in uniqueness.

## Actual DAL create and output shape

Pinned `packages/database/drizzle/src/medusa.ts` owns:

- `:416-459`: create, nested graph, actual requested population, null to-one and
  generic empty-to-many initialization, created mutation dispatch.
- `:984-1063`: scalar defaults/required fields, actual SQL insert, mutation
  recording then nested creation. Root create is insert, not upsert.
- `:1065-1190`: hasMany creation. When every child has a complete primary key
  and all already exist, it invokes genuine replacement/association instead;
  otherwise it recursively creates children and forces their owner FK.
- `:1228-1289`: only explicitly present relation inputs induce population paths.
- `:2209-2295`, `:3856-3925`: relation loading and native ordering. GeoZone has
  neither rank nor display_id, so default related ordering falls back to SQLite
  rowid, not an invented ID sort. Newly created children retain actual
  insertion/grouping order.
- `packages/database/drizzle/src/mutation-events.ts:85-104`: every accumulated
  root/child creation dispatches actual native afterCreate. Module aggregation
  may group messages; do not infer message order by flattening returned DTOs.

Use checked DML rows and the existing portable relation grouping/population
owner. Reuse the extracted authentic `fillEmptyToManyRelations` from
`@medusajs/drizzle/relation-query`. Fresh scalar Zones expose
empty geo_zones and shipping_options; nonempty requested GeoZones are loaded
from actual inserted rows. Root output contains full scalar columns plus those
two to-many fields. Children contain full scalar columns and service_zone_id,
with nullable scalar defaults preserved.

`ServiceZoneDTO` declares a full fulfillment_set object, but the scalar parent
ID input does not itself request parent population. Do not manufacture that
object or copy input as a fake relation. GeoZone's unrequested service_zone
object likewise must not be invented. New-child output follows actual insertion
order rather than lexical IDs, including a complete four-root graph. Native
postal_expression retains truthy objects, arrays, strings, numbers and booleans;
DTO Record prose does not narrow the checked JSON column. Creation results,
arbitrary lists and projected preimages remain distinct contracts.

The named profile admits new root/child identities generated by
native/default machinery. It does not admit supplied root/GeoZone IDs or parent
objects. This follows the root DTO and avoids silently claiming reparenting or
mixed existing-child association. If supplied child IDs are later admitted,
trace the existing-target branch above and preserve it rather than treating it
as ordinary nested insert. Native all-existing children can be reparented and
patched while emitting only the new Zone's created event. A mixed existing/new
child array takes the insert branch and can fail a child primary-key collision,
rolling back the full graph. An ID-only child still fails the service's missing
type validation before association. These characterized branches remain outside
this new-child admission. No prior-create ledger is added to inverse authority.

## Genuine physical inverse and complete selected graph

Generated `deleteServiceZones` (`packages/medusa-utils/src/modules-sdk/medusa-service.ts`,
delete branch) calls the internal service and returns void. Internal delete at
`medusa-internal-service.ts:456` uses a genuine transaction and normalizes keys.
The root retains actual newly returned IDs; the admitted command is nevertheless
a bounded physical deletion capability, following Store/Type creation profiles.
It is not cryptographically restricted to rows created by an earlier call.

Pinned DAL `medusa.ts:590-635` selects physical roots without an active predicate,
performs its detach work, physically deletes roots and dispatches root afterDelete.
Native compiler `schema.ts:270-317` derives FK onDelete cascade from inverse DML
cascade declarations. Physical FK cascades therefore remove matching GeoZones,
Options and Option Rules, including historical rows. Preserve this complete
selected closure instead of rejecting all nonempty descendants for convenience.

The DAL does not call itself recursively for each FK-cascaded child, and the
root's afterDelete dispatch does not manufacture child module deletion messages.
Reuse the Store creation/inverse distinction: authenticate all actual descendant
mutations/facts while matching native explicit module events for ServiceZone
roots only. Forward native graph creation does emit actual GeoZone creates.
Native creation messages interleave each Zone created message with its child
GeoZone created messages, then continue with the next root. Retained physical
inverse emits only the matching Zone deleted messages, preserving root deletion
order while authenticating all cascade facts.

There is no cross-module remote Link cleanup in this physical inverse. The
minimum selected topology installs no Zone-specific Link family. Do not add
Pricing cleanup or fake nonempty Link support. A later full Fulfillment schema
can contain additional inbound references (for example Fulfillment to Option);
that broader installed topology requires separate native constraint/detach
proof and must not inherit an unjustified whole-module deletion claim.

## Installed source reuse and fresh composition

The installed fresh composition contains ShippingProfile, ShippingOption,
ServiceZone, FulfillmentSet, ShippingOptionType, FulfillmentProvider, GeoZone and
ShippingOptionRule. The same twelve-model native snapshot and genuine constructor
own all eight. The existing schema owner exposes
`captureServiceZoneCreationMetadata` and `compileServiceZoneCreationDefinition`,
retaining the medusa.shippingProfile source/write-profile and
commerce.shipping-profile lineage. No duplicate Set/Zone inventory, constructor
or provider implementation is introduced. Four tables remain checked FK targets
without public mutation authority.

Prior one/six-table definitions and capabilities remain exact for their consumers.
Existing Profile update and Type creation profiles also execute sequentially
against the same installed eight-table binding without weakening their selected contracts. This
does not admit duplicate participants for one source inside a single atomic
root; each composition retains one authenticated participant for that source.

This is a fresh private installation, not an in-place upgrade of populated six-
table installations. Do not mutate their schema identity, reset data or add a
generic migration engine. If the implementation must target an existing named
populated installation, stop that dependent path and record its separate schema
evolution gate. Broader source inspection/promoted models confer no additional
table or lifecycle authority.

## Admitted bounds and owners

Forward root: zero to four Zones, each with zero to four new GeoZones (sixteen
total); all four native GeoZone types. Existing parent IDs are length-bounded.
Input and stored JSON retain existing byte limits. Required/nullable scalar
contracts come from checked DML; native service validation retains error order.

Physical inverse: at most four raw Zone IDs; complete descendants
bounded at sixteen GeoZones, eight Options and sixteen Rules. Counts include
historical rows. Overflow refuses before applying a partial graph. These are
explicit admission/resource bounds, not native business maxima. The physical
inverse validates the complete selected historical closure before applying it;
it does not skip descendants, events or reference proofs to fit the limits.

The complete creation/root-plus-inverse graph and complete historical physical
inverse use existing optimistic atomic execution and default 64 calls/events;
all other catalog/query/fact/byte limits remain unchanged. Neither 129's
preserving-deletion upsert nor 130's active-restore selection is needed by this
insert/physical-delete root. No scope-exclusive lock is implied. Hook borrowing
does not apply because this native root has no hook.

Reuse these actual owners:

- `fulfillment-module.ts`, native module service/event bus and denied repositories;
- current selected metadata/schema lowering and installation binding;
- `write/create.ts` / graph-model.ts, native defaults, row validation and graph
  relation assembly for new child graphs;
- `repository/lifecycle.ts` for bounded full-history physical cascade planning;
- Store create/inverse receipt structure for complete graph evidence with root-
  only delete module messages; reuse mechanics, not Store business field logic;
- complete-row/projection contracts, mutation subscriber, existing sticky refusal,
  logical read evidence, atomic event publication and native workflow host.

Do not invent a generic CRUD registry, duplicate validation matrix, second
transaction, temporary shadow storage, fake DTO relation or direct SQL path.
An actual shared-owner failure must retain its witness and be corrected there
under existing core authorization; source-only concerns are not confirmed bugs.

## Executing ownership and source guards

Native promotion/type seam:

- `packages/medusa-core-flows/src/fulfillment/workflows/create-service-zones.ts`
- `packages/medusa-core-flows/src/fulfillment/steps/create-service-zones.ts`
- narrow root/step exports in medusa-core-flows/package.json;
- authentic `packages/medusa-types/src/workflow/fulfillment/service-zones.ts` and
  its narrow package export. The top-level FulfillmentWorkflow namespace retains
  shipping-profiles. The root imports its original namespace directly through
  the service-zones subpath; CreateServiceZoneDTO and ServiceZoneDTO use the
  existing @medusajs/types/fulfillment/index seam. The top-level barrel is not
  broadened or replaced.

Adapter/workflow:

- existing `modules/fulfillment/shipping-profile-schema.ts` selected-source owner;
- `modules/fulfillment/service-zone-create-input.ts` (DML-derived contracts);
- `service-zone-create-graph.ts`, `service-zone-create-repository.ts`,
  `service-zone-create-receipt.ts`, `service-zone-create-service.ts`;
- `workflows/fulfillment/create-service-zones.ts` genuine-root facade, no hook API;
- affected adapter package exports, native/portable provenance scripts/manifest;
- focused workflow/receipt tests and the existing shared fixture owner.

Preserve full native root/step bodies, original aliases, method arguments,
empty/return/inverse branches. Only direct portable imports and existing
transactionCovered step metadata differ. Exact emitted-program/public-contract,
unchanged native workflow-type and source-pair guards authenticate this finite
promotion. Comparison snapshots remain unchanged.

## Connected acceptance boundary

The native full-service/SQLite comparison and connected adapter proofs preserve
these behaviors within the named profile:

1. Two/four roots with omitted, empty and nonempty GeoZones; all native types,
   actual nested rows/empty relations/order, defaults/nulls and absent parent DTOs.
2. Exact native validation errors/order, missing type versus DML default, falsy
   required fields, no case normalization and actual postal-expression behavior.
3. Missing/active/historical parent semantics, global active-name uniqueness,
   historical same-name reuse, duplicate names within one genuine transaction
   and rollback/publication on a late database failure.
4. Genuine retained physical inverse, empty skip, historical root/children,
   nonempty Option/Rule descendants and missing IDs; distinguish root/child
   create events from physical-cascade root-only delete messages. Characterize
   any linked required-FK refusal in a fuller native topology separately.
5. Supplied root/child IDs and all-existing/mixed child branches as boundary
   characterization, even though the first public profile admits new children.

Bounded PGlite and ordinary-role PostgreSQL proofs cover the complete creation
and retained-inverse graph, full historical physical cascade, actual FK and
active-name constraints, exact rows/events, source/scope authority, authenticated
complete reads, overflow, atomic refusal/rollback, cancellation, replay and
closed/cross-scope resources. Concurrent global-name and parent/reference behavior
remains owned by shared constraints; native compensation remains distinct from
exact failed-root rollback. Sequential Profile update/Type creation compatibility retains their
existing capabilities and source identity.

No native business alteration or resource-limit increase is part of this profile.
Exact output/event/error boundaries come from executing native source. Fresh
source composition is the material storage boundary; general populated upgrades
and public activation remain deferred.

## Why Shipping Option creation still waits

Exact native sources are the fulfillment create-shipping-options workflow,
validate-fulfillment-providers.ts, validate-shipping-option-prices.ts,
upsert-shipping-options.ts, add-shipping-options-prices.ts and
set-shipping-options-price-sets.ts under core-flows/src/fulfillment.

Provider validation always resolves Fulfillment, lists existing Options by IDs
and resolves REMOTE_QUERY, even for empty input. Its graph asks for ServiceZone
through FulfillmentSet to Location and enabled Providers; absent availability
produces native NOT_ALLOWED. Those stored LocationFulfillmentSet and
LocationFulfillmentProvider Link families are not currently admitted.

Price validation computes optionIds with map; nonempty create input gives a
nonempty array even when individual IDs are undefined. Preserve that native
update-like read branch before claiming flat-rate creation is trivial. Calculated
prices invoke real provider canCalculate; flat-only paths still call the genuine
empty calculated-validation method. Region reads are conditional on region-ID
prices. The price-set step creates a real PriceSet even for calculated Options'
empty prices, and its inverse physically deletes those PriceSets.

The root's final parallel branch queries existing ShippingOptionPriceSet Links,
dismisses/creates actual Links and emits shipping-option.created. The Option
upsert step preserves native type_id translation, possible update preimages,
created-ID difference and update/delete inverse. Input/output positional mapping
must be characterized before relying on service create/update partition order.

There is also a source-level alias question: provider validation requests
fulfillment_set.locations, whereas pinned LocationFulfillmentSet extends the
Set with fieldAlias location (singular). Inspect the genuine joiner/remote query
execution before asserting a bug or repairing that path. This is unverified
source evidence, not a native behavior decision for 131.

Location FulfillmentSet creation itself uses the real create-fulfillment-set step
and associate-locations-with-fulfillment-sets step, whose inverse dismisses the
original links. Its stored Link definition has deleteCascade into FulfillmentSet.
The owning Stock Location deletion preflight114 requires migrating connected
deletion admission when that additional family is installed. Do not bypass that
obligation with a hidden router omission. These are later connected outcomes,
not additional capabilities granted by the implemented Service Zone creation root.
