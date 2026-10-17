# Native Store Deletion Workflow

## Status And Authority

Status: implemented for the bounded private shared-storage admission below.
This admission does not include Store creation/update, bootstrap, hosted
activation, chunked File Product import or Product export.

The pinned Medusa fork is `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, version
2.13.4. Native source is `packages/core/core-flows/src/store/workflows/`
`delete-stores.ts`, `store/steps/delete-stores.ts` and the existing common
`remove-remote-links` step. Installed Store metadata and its existing read-only
Sales Channel deletion guard are current foundations, not mutation admission.

## Native Closure

`deleteStoresWorkflow`, ID `delete-stores`, takes `{ ids: string[] }`. It calls
Store `softDeleteStores(rawIds)` followed by the unconditional generic Link
deletion step with `{ store: { store_id: rawIds } }`. It has no Query, Pricing,
Currency, Region, Sales Channel, Stock Location, Inventory, hooks or external
effects. The generated Store module owns lifecycle events; there is no separate
workflow event step.

Both forward calls remain required for empty arrays. Store compensation skips
absent/empty captured arrays and otherwise restores raw IDs. Link compensation
skips only absent input; the grouped object containing an empty array is truthy
and still reaches native restoration routing. Preserve raw order, duplicates and
missing IDs at these boundaries and the native void/null boundary adaptation.

Installed Store Link declarations are read-only Currency/Locale expansions;
there is no stored Store Link family. Use the genuine empty native Link router
for delete and restore. Do not invent endpoint deletions or suppress empty calls.

## Ownership And Bounds

The separate Store deletion profile exposes only `softDeleteStores` and
`restoreStores`, retaining the existing guard profile. Use genuine native
`StoreModuleService` and all three existing DML models. Native `Module` registration
owns generated joiner configuration and identity maps, as it does for the existing
Notification adapter; do not fabricate maps/events or fork the Store service.

Shared `medusaLifecycle` owns the Store, StoreCurrency and StoreLocale cascade.
Native Store declares both child cascades; their foreign keys already supply
complete-history indexed reverse access. Default Channel/Region/Location scalar
IDs are not lifecycle descendants and grant no endpoint capabilities.

Bounds are four raw Store IDs, eight total matching historical Currency
children and eight total matching historical Locale children: at most twenty
lifecycle rows. The complete closure is checked before transitions. Existing
64-call/event and other resource bounds remain unchanged. No new core mechanism
is required by this admission.

Authenticate complete native lifecycle rows, mutation/no-op evidence, maps and
event order at the Store receipt owner even though the native step discards its
module result. Preserve native restoration of all matching history, including
already-active roots and predeleted descendants. Native soft-delete dispatch
uses deleted events for predeleted descendants as well; derive that grammar from
the actual generated service rather than assuming updated events.

## Promotion And Connected Proof

The genuine root and step use portable imports, the exact finite
`WorkflowResponse` wrapper and transaction-covered step metadata. Preserve callback
bodies and authenticate the allowed seams with source guards and mutations.
The finite runtime does not execute compensators: explicit genuine retained
callback probes must be distinguished from automatic compensation. Native raw-ID
restoration can revive older tombstones; terminal failed-root rollback must
restore the complete pre-attempt snapshot independently.

PGlite and ordinary-role PostgreSQL cover empty calls, maximum history,
missing/duplicate IDs, full Store/child maps and event grammar, active/deleted
restoration, untouched neighboring families and scopes, replay, later failure,
denied extra methods and child-history overflow before publication. PostgreSQL
also covers two genuine Store cascades reaching the same pending state before
settlement: one succeeds, one conflicts and only one fact/event/outcome set
commits. Fixture rows use the existing canonical dataset owner; this grants no
Store creation API. Parent-before-child fixture ordering uses its existing
adjacent-table batching within unchanged limits.

The existing read-only Store guard remains a separate profile and is refused as
a deletion participant. Its real reads remain valid after native module
registration. Store-default Sales Channel guards and focused lifecycle consumers
remain regression obligations. Native Store create/update remain separate roots because
their relation replacement and Pricing preference dependencies are not present
in this deletion closure.
