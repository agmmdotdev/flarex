# Native Stock Location Deletion Workflow

## Status And Authority

Status: implemented private bounded native workflow. The current installed
LocationFulfillmentSet/Fulfillment composition and named resource allowance are
owned by [137](./137-native-location-fulfillment-set-workflow.md); this record
retains the original SalesChannelLocation baseline and shared reverse-access
correction. Hosted activation and further default graph admission remain pending.
Authority is the accepted Flarex design, package boundaries, Medusa adoption
roadmap and Medusa 2.13.4 at `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.
The source island remains read-only. Chunked File import and Product export
remain deferred.

The original 114 selection covered Stock Location and SalesChannelLocation.
137 extends it with the complete bounded Fulfillment forest through the stored
LocationFulfillmentSet family. Provider and ShippingOptionPriceSet/Pricing Link
families remain unadmitted; their installation requires connected migration of
every affected deletion composition.

## Native Closure

Promote `core/core-flows/src/stock-location/workflows/delete-stock-locations.ts`
and `stock-location/steps/delete-stock-locations.ts` from the pinned source.
Reuse the promoted `common/steps/remove-remote-links.ts`. The composer calls
genuine `softDeleteStockLocations`, then removes Links using the service's actual
returned linkable-key map. It returns native undefined; retain the established
finite `WorkflowResponse(void 0)` and outer null convention.

Unlike Sales Channel deletion, Link cleanup receives actual deleted identities,
not requested IDs. Missing and already-deleted Locations contribute no cleanup;
repeated requested IDs do not create repeated selected rows. An active pivot
attached to an already-deleted Location is consequently not cleaned merely
because that ID was requested. Preserve this distinction.

The generated service maps Location IDs to native `stock_location_id` and
authored `location_id` aliases. Authenticate both aliases and their agreement.
The genuine router uses its configured `stock_location_id` relationship;
`location_id` is an unused native alias, not a second deletion. Execute a pure
native witness before relying on this source inference.

Empty input still resolves and invokes Stock Location, which returns `{}` from
its generated soft-delete service. The step returns `{ stock_location: {} }`;
the genuine Link router is still called and returns `[null, {}]` without family
calls. There is no Store/default-Location guard, Inventory/reservation guard,
query, workflow EventBus/event/hook, File, Region, Locking or remote effect.

Location deletion preserves Addresses and `address_id`. Address DML's cascade
toward Locations is not a reverse cascade. Preserve Sales Channels, Inventory
Levels, Reservations and Store defaults: this workflow contains no cleanup or
validation for those records. Native Location and Link lifecycle events remain
required and use `internalModuleWorkflowEvents`.

The pinned restore path has no internal mutation subscriber. Its genuine
conventional Drizzle dispatcher derives `stock` from `StockLocation` and emits
`stock.stock-location.restored` with source `stock`. Subscribed forward deletion
uses `stock_location.stock-location.deleted` and source `stock_location`.
Preserve and authenticate these distinct native spellings; do not rename the
restoration message to match the module key.

## Original 114 Implementation And Owners

1. Promote the native composer and deletion step with narrow imports/exports,
   exact provenance and retained transaction-covered compensation callbacks.
2. Add a named Stock Location deletion profile binding genuine generated
   soft-delete/restore methods. Reuse `medusaLifecycle` and checked two-table
   metadata, selecting Location roots only. Retain creation/read/update profiles.
   The receipt policy must verify full rows, preserved Address FK/scalars, actual
   lifecycle activity, both result aliases and deleted/restored module events.
3. Prepare the real SalesChannelLocation Link participant with its existing
   lifecycle repository and eight-row bound. Add an explicit
   `stock-location-deletions` admission with authenticated restore tokens; do not
   impersonate Sales Channel deletion or load unrelated Product participants.
4. Construct native `Link` with exactly that loaded family. Decode the complete
   native cascade tuple and grouped Stock Location endpoint, including empty
   maps and both aliases. Native Link retains errors-as-data. The current atomic
   boundary refuses a nonempty error tuple under preflight 56/137 and retains its
   complete cause through the existing sticky refusal owner.
5. Add `src/workflows/stock-location/delete.ts`, exact module/resource identity
   checks, graph disabled, module-only events, existing queued root scheduling
   and null completion. No Sales Channel endpoint service is required for this
   noncascading pivot lifecycle.

Admit zero to four raw requested IDs and at most eight affected active pivots.
Refuse overflow without truncation and roll back the entire root. Retain current
call/event/byte/catalog/identity limits in this original baseline; 137 owns the
expanded installed graph's named allowance. No
new schema, source lineage, initialization or durable reset is implied. There
was no statically identified core blocker. The preserved connected witness
exposed a shared access gap: forward deletion succeeded, but all-row reverse
pivot reads and retained native Link restore failed `invalidInput` because the
Stock Location endpoint had only an active-row partial index. The owning
[composite-key reverse access correction](../../shared-logical-storage/59-composite-key-reverse-access.md)
implements a derived all-row path in shared logical storage under the continuing
core authorization. Active queries retain eligible native partial-index anchors
instead of loading deleted history. Native DML, partial indexes, aliases and compensation stay intact;
no adapter scan or weaker query admission is permitted.

## Compensation And Verification

Location compensation skips missing/empty IDs, otherwise restores the original
requested list. Link compensation skips only falsey input; its truthy empty map
still resolves/calls Link restore. Nonempty restoration uses the actual forward
map. Preserve these callbacks without claiming a durable restoration API.

Prove empty resource resolution/maps, actual aliases, result-driven cleanup,
missing/repeated/already-deleted targets, native void, callback arguments and
absence of external workflow events through the genuine composer. Both PGlite
and ordinary-role PostgreSQL must prove maximum targets/pivots, overflow,
unchanged endpoints/Addresses, exact lifecycle/events/facts, one settlement,
late failure, native Link errors-as-data poisoning, caught refusals, replay,
identity conflict, scope isolation and cancellation/revocation. Regress stocking,
Stock Location update, Sales Channel links/deletion and shared lifecycle owners.
Complete affected types/builds, source/portability/lint and both reviews before
a scoped commit. Hosted activation and arbitrary installed graphs remain open.

## Further Default Graph Admission

The pinned native graph also defines `LocationFulfillmentProvider` and
`LocationFulfillmentSet`; the former deletes pivots only, while the latter
cascades into FulfillmentSet. Its DML reaches ServiceZone, GeoZone,
ShippingOption and ShippingOptionRule. ShippingOptionPriceSet then reaches
Pricing PriceSet, Price and PriceRule lifecycle and reverse VariantPriceSet
pivots. These require real schemas, services, Link families and bounded receipt/
event closure. 137 installs LocationFulfillmentSet and the bounded eight-table
Fulfillment source; LocationFulfillmentProvider and ShippingOptionPriceSet with
their further cascades retain separate admission. Source promotion alone grants
none of those capabilities.

InventoryLevelStockLocation is a native read-only Link, excluded by
`Link.addModule` from mutation routing. It supplies no Inventory deletion branch.
Do not fabricate empty Fulfillment services or silently omit installed sources.
When the additional families are installed, migrate this deletion profile in
that same connected outcome before claiming the expanded graph.
