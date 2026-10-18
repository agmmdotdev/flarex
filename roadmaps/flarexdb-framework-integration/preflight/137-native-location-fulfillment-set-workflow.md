# Native Location–Fulfillment Set workflow preflight (137)

Status: implemented within the bounded private profile. Healthy pinned-native
creation, physical inverse
and full-graph router behavior are characterized. The approved native return-map
correction accompanies linked creation and both connected deletion migrations.
This record admits no hosted activation or populated schema upgrade.

## Connected outcome and native authority

Integrate genuine `createLocationFulfillmentSetWorkflow`, install its stored
LocationFulfillmentSet Link, and migrate the existing StockLocation and
Fulfillment Set deletion compositions to that installed graph together.
Standalone Set creation or a creation-only Link fixture does not complete this
outcome: existing deletion resources must clean up and restore the installed
relationship through the real router.

Authority remains Medusa 2.13.4, commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. Native paths below are relative to
`third_party/medusa/upstream`.

- `packages/core/core-flows/src/stock-location/workflows/create-location-fulfillment-set.ts`
  forwards only name/type to actual Set creation, transforms the first actual
  created ID into one association, and returns implicit void.
- `fulfillment/steps/create-fulfillment-set.ts` returns complete created Sets
  and retains their actual IDs for physical deletion.
- `stock-location/steps/associate-locations-with-fulfillment-sets.ts` invokes
  actual Link.create and retains raw endpoint definitions for Link.dismiss.
  Empty outer input skips Link resolution; nonempty outer input with empty
  inner IDs still calls Link.create([]).
- `packages/modules/link-modules/src/definitions/fulfillment-set-location.ts`
  owns the locfs identity, endpoint definitions and cascade into Fulfillment
  Sets. One Location can own multiple Sets. Set-side cleanup does not delete
  Locations. Link storage has no endpoint FK or liveness read.

Creation needs Fulfillment and Link, with no Query, provider, Region, Pricing,
File, hook or pause. Reuse the existing narrowly guarded portable
`WorkflowResponse(void 0)` seam for implicit native void composers. The oracle
executes the unchanged native composer and genuine in-process orchestrator.

## Native behavior and existing accepted corrections

The healthy native witness uses genuine twelve-model Fulfillment and two-model
StockLocation services on native Drizzle/SQLite, plus the genuine MikroORM/
PostgreSQL stored-Link repository and full native Link router. Module DI scopes
remain separate. These are independent native module transactions, not a claim
of cross-module atomicity or deployed/default bootstrap support.

Creation succeeds with active, missing and historical Location IDs. Do not add
endpoint existence checks. Extra supplied Set ID, metadata or zones are ignored
by the workflow. Native cancellation and late parent failure dismiss the Link,
then physically delete the created Set, leaving dismissed Link history.

Repeated pair creation and historical recreation upsert the endpoint-PK row,
replace its non-key native Link ID and preserve creation time. Exact duplicate
upsert need not advance update time. A returned native dismiss DTO can retain
the old update timestamp while the stored hook-updated row has advanced it;
receipts must authenticate returned and persisted values separately. Existing
shared Link mechanics and preflight 99 already own pair identity and ID
replacement.

Pinned-native restore can reactivate an old partner alongside a new active
partner. This is deliberately changed by the already accepted reusable
[scalar-Link cardinality correction](./63-native-singular-link-storage.md):
the promoted generator derives active uniqueness from opposite hasMany, and
conflicting restore fails atomically. Adopt that existing fresh-private-schema
contract for this family, making fulfillment_set_id active-unique. Preserve the
original native two-active witness and separately label the accepted correction;
do not present it as unchanged native parity or add adapter-only enforcement.

The native generator's signed hexadecimal hash gives this family's quoted
index names a minus sign. Shared Link metadata capture admits that generated
index-name representation separately from authored table/column/service names.
Keep native names and expressions unchanged through logical lowering; authored
identifier grammar remains unchanged.

Native StockLocation restore emits `stock.stock-location.restored`; preserve
that established namespace. Link attached/detached messages can contain a batch
of IDs in one message. Genuine Set deletion compensation restores the full
Fulfillment graph twice: once through Link restoration and once through the
Set step's retained inverse. Do not remove the second call or its events.

## Atomic cascade refusal boundary

[Preflight 56](./56-native-link-storage-contract.md) requires the atomic adapter
to latch and refuse a nonempty native cascade-error result. The shared decoder
previously accepted that tuple as success, allowing a workflow that ignored the
result to commit genuine partial lifecycle writes. The correction belongs in
`links/cascade-result.ts`: validate the complete tuple first, then refuse valid
nonempty errors as `adapterFailure`, retaining the complete decoded errors and
partial identity map as the cause. Malformed tuples remain `storedCorruption`;
identifier, shape and resource limits remain unchanged.

The existing composed-resource output boundary owns `checkedCommerceValue` and
the root's sticky refusal. Reuse it for every consumer of the shared decoder;
no additional latch, retry or resource-specific error check is introduced.
Native Link still returns errors as data. Both propagated and caught resource
rejections retain the original `adapterFailure` and refuse root settlement.
This fulfills the accepted atomic adapter contract and does not change native
cascade behavior.

## Native return-map decision

The full native Fulfillment joiner lists fulfillment_address_id before the
reached Set/Zone/Geo/Option/Rule keys. In
`packages/core/modules-sdk/src/link.ts`, executeCascade takes the first declared
key for a nested return map regardless of the actual lifecycle result. The
healthy full-graph witness therefore returns
`fulfillment: { fulfillment_address_id: [undefined] }`; JSON renders the element
as null. The actual lifecycle result contains real affected IDs under other
configured keys. Existing strict Link cascade decoding correctly refuses the
malformed identifier.

The approved correction belongs in that promoted native Link owner: select the
first declared key actually present in the lifecycle result and accumulate its
real returned IDs. If no configured key is returned, omit that return-map entry
while continuing existing processed-ID tracking and recursive traversal. Keep
existing valid-first-key results, lifecycle calls, errors-as-data, storage,
events, metadata and compensation unchanged. Preserve the pinned failure and
use separately labeled candidate/corrected witnesses.

Do not trim/reorder the full native joiner metadata, substitute a Set-only
router, manufacture identifiers, weaken JSON decoding or repair the map in an
adapter. General core-change authorization remains in force; this native
observable-result change has its own explicit business/public approval.

## Existing owners and admitted bounds

The native definition/export and named Link metadata/source compiler reuse
captureLinkMetadata, generateEntityDefinition, prepareLinkService,
prepareLinkRepository, lifecycle receipts and event policy. Require the existing
StockLocation and eight-table Fulfillment sources. Preserve existing source
identities and install only fresh schema compositions.

The existing Fulfillment Set lifecycle owner admits the genuine Link cascade
selector object plus the full native returnLinkableKeys configuration while
retaining its raw-ID workflow ABI. The current repository normalizes the actual
DAL selector; the existing lifecycle receipt authenticates both routes without
a second cascade or lifecycle implementation. The cascade ABI retains up to
eight raw IDs, including duplicates, independently bounded to four distinct Sets.

134's empty Link registry and 114's SalesChannelLocation-only composition are
replaced by installed stored-family routing. The StockLocation router includes
both Link families and actual Fulfillment cascade methods, preserving agreeing
location_id / stock_location_id aliases and complete historical cleanup.

The creation bound is one Location, one new Set and one Link. Deletion
retains zero to four raw requested IDs, up to eight selected physical locfs
rows and at most four distinct Set endpoints across active and historical
selection. Keep the existing complete aggregate forest: four Sets, four Zones,
sixteen Geos, eight Options and sixteen Rules. Retain 114's four Locations /
addresses and eight SalesChannelLocation rows. Extra history or a fifth reached
Set must refuse atomically; active cardinality cannot bound tombstone history.
The shared Link lifecycle receipt applies the distinct-Set bound to its already
authenticated complete history, including deleted rows absent from the native
forward return map. Other receipt profiles retain their existing defaults.
Set-side history may reference eight distinct Location IDs; Set deletion grants
no mutation authority to Locations, Addresses, Channels or their eight Links.

The named Stock Location profile admits 256 calls and 128 event messages. The
Set profile admits 512 calls and 256 event messages. Both use the existing
trusted identity-bound API; all other resource limits remain unchanged. Linked
creation retains the ordinary 64-call/64-event profile. These selections cover
complete roots and genuine retained callbacks. The native all-active Set forest plus four Links
emits 49 messages forward and 97 on cancellation, so the prior 128-event
empty-Link allowance cannot be presumed sufficient. With both installed Link
families, native StockLocation forward/cancellation each emit 54 messages;
linked creation emits two each way.
Native arithmetic does not replace actual portable call/event measurements.

## Native graph and atomic boundary

The combined SalesChannelLocation plus LocationFulfillmentSet native router
witness includes the complete 48-row Fulfillment forest, four Locations, four
Addresses, eight SalesChannelLocation rows and four LocationFulfillmentSet rows.
Both deletion roots preserve Address data and Location address references, and
Set deletion leaves Locations and SalesChannelLocation rows unchanged. Mixed
descendant and Link history reaches the genuine native lifecycle and inverse.
Observational container-resolution taps are not dependency authority when
native scoped containers bypass them.

Genuine endpoint lifecycle calls followed by explicitly injected throws yield
native errors-as-data tuples with partial maps. Native restore name collisions
can leave partial module state: StockLocation cancellation can report reverted
while Fulfillment remains deleted, and Set cancellation can fail in its direct
inverse. These independent native module transactions do not authorize partial
settlement under the accepted atomic Flarex boundary. Preserve the native
observations and apply the existing preflight 56 refusal decision above.

Creation, the shared metadata/receipt/refusal corrections and both installed
deletion migrations form one connected outcome. They retain genuine callbacks,
the accepted cardinality correction, events and native quirks. Validate both database lanes, actual retained
callbacks, complete outputs/maps, scope/replay/lifetime, cancellation, late
failure, history/overflow and PostgreSQL contention. Run affected existing
consumers, types/builds, provenance/portability/source guards and both required
reviews before a scoped commit.

General Shipping Option creation, providers and populated upgrades remain
separate. Chunked Product file import and Product export remain deferred.
