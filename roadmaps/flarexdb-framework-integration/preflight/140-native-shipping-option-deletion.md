# Native Shipping Option deletion preflight (140)

Status: implemented as private bounded support on fresh logical storage.
The unchanged native composer, services, stored Links and
retained callbacks have separate native characterization. Public/hosted
activation, populated upgrades and arbitrary providers remain outside this slice.

## Authority and connected outcome

Authority remains Medusa 2.13.4 at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded in
`third_party/medusa/SOURCE.json`. Native paths here are relative to
`third_party/medusa/upstream`:

- `packages/core/core-flows/src/fulfillment/workflows/delete-shipping-options.ts`
  declares `deleteShippingOptionsWorkflow`, ID
  `delete-shipping-options-workflow`.
- `packages/core/core-flows/src/fulfillment/steps/delete-shipping-options.ts`
  declares `deleteShippingOptionsStep`, ID `delete-shipping-options-step`.
- `integration-tests/modules/__tests__/shipping-options/workflows/delete-shipping-options.ts`
  contains upstream linked deletion and downstream-failure compensation cases.
- `packages/modules/fulfillment/src/models/shipping-option.ts` declares the
  Option's `rules` delete cascade. Type, Profile, Provider and ServiceZone are
  references, not descendants of this cascade.
- `packages/modules/link-modules/src/definitions/shipping-option-price-set.ts`
  declares the stored Option–PriceSet Link and its Pricing-side delete cascade.

The connected target is genuine Shipping Option soft deletion, local Rule
cascades, installed Link cleanup, linked Pricing lifecycle, workflow events and
all retained callbacks under one existing outer atomic settlement. Standalone
Option mutation does not complete this target. Public/hosted activation,
populated upgrades, arbitrary providers, Product file import and Product export
remain outside it.

## Native source trace

The composer calls `deleteShippingOptionsStep(input.ids)`, then runs
`removeRemoteLinkStep(softDeletedEntities)` and `emitEventStep` in native
`parallelize`. Link cleanup receives the actual Fulfillment result map; it is
not constructed from requested IDs. The event is
`ShippingOptionWorkflowEvents.DELETED` (`shipping-option.deleted`) with raw
`input.ids`. The common event step maps an array to individual messages, so
event identity/order must be checked independently of affected-row maps.

The deletion step returns early for absent/empty IDs. Otherwise it resolves
Fulfillment and invokes inherited `softDeleteShippingOptions(ids)`, returning
`StepResponse({ fulfillment: softDeletedEntities }, ids)`. Its retained callback
invokes `restoreShippingOptions(prevIds)` using the original requested IDs.
Generated service lifecycle methods and linkable-map projection belong to
`packages/medusa-utils/src/modules-sdk/medusa-service.ts` in the executing tree.

The executing common step in
`packages/medusa-core-flows/src/common/steps/remove-remote-links.ts` groups the
returned map, invokes genuine Link.delete, and retains that grouped input for
Link.restore. The Link definition routes affected Option identities to stored
ShippingOptionPriceSet rows, then into Pricing's PriceSet lifecycle. Pricing
owns its declared Price and PriceRule descendants. The characterized linked
forward calls are Fulfillment.softDeleteShippingOptions, Link.delete, stored
Link.softDelete and Pricing.softDeletePriceSets. Cancellation invokes
Link.restore, stored Link.restore, Pricing.restorePriceSets, then
Fulfillment.restoreShippingOptions. Unlinked Options still invoke the stored
Link lifecycle selection; its empty map prevents a Pricing call.

The composer has no Query, child workflow, hook, Region/StockLocation read,
provider calculation or remote fulfillment effect. It has no explicit workflow
result. Reuse the existing finite SDK's implicit-void result representation and
transaction-covered compensation metadata when promoting these exact sources.

## Characterized native behavior

The external packet
`%TEMP%/flarex-140-native-shipping-option-deletion-witness` preserves the
unchanged source loader, emitted bytes and provenance. The full native matrix
is recorded in
`unchanged-native-runs/2026-10-18T13-35-01.695Z-19152/report.json`; the separate
initial empty selection is retained alongside it. It uses genuine native
Drizzle/SQLite local modules, three independently generated native
MikroORM/PostgreSQL Link services under an ordinary role, the actual in-process
SDK/orchestrator, full installed Link router and local EventBus. These native
module transactions do not establish cross-module atomicity or default app
bootstrap. Every recorded historical preparation completed without method or
cascade errors and its before-target snapshots contain the intended history.
The full maximum-history fixture contains eight Links, eight PriceSets,
sixteen Prices and 48 PriceRules before deletion.

### Empty and requested identities

`{ ids: [] }` completes with undefined result and no workflow errors; genuine
cancellation reaches reverted with no errors. Fulfillment/Pricing methods,
stored Link lifecycle, Query and events are absent, and all local/Link rows and
event groups remain identical. The common Link step still executes actual
Link.delete and Link.restore, both returning `[null, {}]`.

This is not an absent common-step branch. Native
`workflows-sdk/src/utils/composer/helpers/create-step-handler.ts` stores the
void step in a WorkflowData envelope. In `resolve-value.ts`, the step-reference
lookup uses `output ?? invokeRecord`, so undefined output resolves to that
envelope. Common Link removal groups its `__type` string into numeric
character-key arrays; native Link ignores the unregistered `__type` service.
Preserve those genuine empty calls through the private SDK/reference owner.
Do not accept arbitrary caller-authored `__type` objects or skip the common step.
The baseline establishes no native TypeError or required business correction.
The existing finite SDK already supplies this marker through
`packages/medusa-workflows-sdk/src/resolution.ts` and `responses.ts`, with the
void-reference contract covered by `test/workflow-conditions.test.ts` in the
adapter. Reuse that behavior. The selected private Link resource needs an exact
argument union for the real Fulfillment map and the bounded native grouped
void marker, then still invokes actual Link.delete/restore. The public root
remains the strict `{ ids }` contract; no SDK extension is established here.

Missing-only nonempty IDs call Fulfillment and yield an empty affected map;
the workflow still emits the requested missing string ID. Duplicate/mixed IDs
retain every raw requested string in workflow event order, including duplicate
and missing IDs. Module maps/events describe actual affected identities once.
Link cleanup uses those actual maps. A pre-deleted Option also yields an empty
forward map while retaining its raw ID for the module inverse.

### Ordering, events and row preservation

Reverse lexical fixture insertion returns Options in `[z, a]` order and their
Rules in parent/insertion order `[z-z, z-a, a-z, a-a]`, in forward and inverse
maps/module events. These are backend observations, not an explicit portable
ordering contract. Pinned `packages/database/drizzle/src/medusa.ts`
`softDelete`/`restore` perform direct `UPDATE ... RETURNING`, and restore's
precheck `SELECT` has no `ORDER BY`. Descendants follow
`updateDeletedAtRecursively`→`updateRelationDeletedAt`, also using unordered
`UPDATE ... RETURNING`; `addRowsToCascadeMap` retains the database result
sequence. These paths do not invoke `preservePrimaryKeyOrFilterOrder` or the
ordinary find/default-order helpers. Within-model affected-row order is thus
unspecified by this native SQL. The adapter's existing deterministic ID ordering
does not require a new business correction on this evidence. Do not introduce
a SQLite physical-insertion policy. Exact affected identities, declared model
traversal and raw workflow-event order remain independent requirements.

The separate `run.controls.mjs` preserves the original runner and observations.
Its native results are recorded in
`unchanged-native-controls-runs/2026-10-18T13-46-53.327Z-6384/report.json`.
Both opposite request/insertion controls bind root IDs in request order but
return rows in fixture insertion order, in forward and inverse SQL. Inserting
`[z, a]` and requesting `[a, z]` produces affected Option/module-event order
`[z, a]`, while the workflow string messages remain `[a, z]`; the opposite
insertion/request control reverses those observations. Rule returning order
similarly follows the backend result. The recorded root/child statements lack
`ORDER BY`. These controls establish that the native lifecycle path does not
apply explicit requested-ID ordering, without elevating observed SQLite
insertion order into a portable guarantee.

Linked, empty and missing-input controls install throwing sentinels on the
registered Query callable/graph/gql/index and all selected Manual provider
methods after fixture construction. All three complete and cancel without
triggering any sentinel. This supports excluding Query and provider execution
from the workflow capability closure while retaining genuine constructors and
full routing metadata.

Fulfillment module events precede the parallel common steps. In the observed
linked run, workflow deleted messages precede Link detached messages and Pricing
module messages. Preserve native parallel composition; this observation does
not establish an arbitrary scheduler interleaving guarantee. Pricing groups
PriceSet events before Price events before PriceRule events; Link can batch
multiple IDs in one message. Cancellation clears only the grouped
`shipping-option.deleted` messages, then emits native attached/restored events.
It does not erase module evidence. No grouped workflow deleted messages remain
after any completed inverse or the injected late-parent failure.

Across the matrix, no row identity sets, creation times or business scalar
fields change through deletion and restoration. Reached rows change managed
update/deletion timestamps; ordinary retained inverses restore deleted_at to
null with renewed updated_at. Types, Profiles, Providers, Sets, Zones, GeoZones,
Locations and other Link families remain untouched. All target forward and
inverse Query observations are empty; no provider calculation executes.

### Historical restoration and retained inverse limits

Native inverse is not an exact snapshot undo. Historical cases establish:

| State before the workflow | Forward behavior | Retained inverse |
| --- | --- | --- |
| Option and its Rule already deleted | Empty affected map; no row changes | Raw IDs restore Option and Rule |
| Historical Option Rule under active Option | Parent cascade reaches historical Rule | Rule becomes active |
| Historical PriceRule or Price under active PriceSet | Pricing cascade reaches historical children | Price and Rules become active |
| Historical PriceSet under active Option/Link | Option/Link delete; Pricing returns empty map | Link inverse restores historical Pricing graph |
| Historical Link/Pricing under active Option | Option deletes; Link returns empty map | Grouped actual Option ID restores Link/Pricing history |
| Option/Rule/Link/Pricing all already deleted | Empty affected map | Only raw Option/Rule inverse runs; Link/Pricing stay deleted |
| Dismissed old Link plus active replacement | Only replacement Pricing is deleted | Both Links restore; both Pricing graphs are reached |

The maximum-history case deletes four active Links and four linked PriceSets,
eight Prices and 24 PriceRules, alongside four Options and sixteen Rules.
Cancellation reaches all eight historical Links/eight PriceSets/sixteen
Prices/48 PriceRules, including active old Pricing parents touched by restore.
The original native router permits two active PriceSet partners per Option on
this inverse. Preserve that original witness separately from the already
accepted active-cardinality divergence in
[preflight 63](./63-native-singular-link-storage.md): conflicting restoration in
the adapter must fail atomically rather than loosen that invariant.

The genuine injected late-parent failure runs retained callbacks automatically,
reaches reverted and retains only the injected error. Its row/event behavior
matches the ordinary linked inverse's managed timestamp and cancellation
boundaries. Explicit compensation remains distinct from whole-root rollback.

### Shared endpoint admission and cascade-error data

Both shared-PriceSet controls attempt a genuine native Link.create for a second
Option targeting an already linked PriceSet. Native Link.create's uniqueness
validation rejects setup with `invalid_data` and
`Cannot create multiple links between 'fulfillment' and 'pricing'`. Neither
target deletion runs. Preserve this admission refusal; do not fabricate Link
rows or claim deletion parity for a graph the real setup refused. The source
owner is `packages/core/modules-sdk/src/link.ts`: the absent opposite hasMany
flags select the active existing-Link uniqueness query before create dispatch.

The separately labeled failure control replaces one already resolved Pricing
soft-delete callable with a throwing foreign boundary; all native Link,
workflow and persistence bodies remain unchanged. Link catches that error and
returns its actual nonempty cascade-error list plus the partial affected Link
map. The common workflow step ignores the returned tuple, so the original
native workflow still completes without workflow errors: Option/Rule/Link are
deleted while Pricing remains unchanged. Genuine cancellation restores the
graph successfully.

The adapter must reuse the already accepted `links/cascade-result.ts` boundary:
authenticate that complete tuple, then refuse nonempty errors as
`adapterFailure` with the full error/partial map retained. The existing sticky
refusal owner prevents partial root settlement even if a caller catches the
resource rejection. Keep this native partial-success witness separate from the
atomic adapter refusal proof; no new native correction or fallback is implied.

## Implementation ownership

The installed schema and Link families come from
[Shipping Option creation](./138-native-shipping-option-creation.md). Reuse
their complete native routing metadata and the existing native Link return-map
correction from
[Location–Fulfillment Set integration](./137-native-location-fulfillment-set-workflow.md).
Do not trim metadata or fabricate reduced module routing to hide branches.

The shared Fulfillment lifecycle owners are
`modules/fulfillment/fulfillment-graph-contracts.ts`,
`fulfillment-lifecycle-repository.ts` and `fulfillment-lifecycle-receipt.ts`
under `packages/medusa-adapter/src/`. They already provide complete checked DML,
historical descendant traversal, native model maps/events and exact lifecycle
receipt correlation. The selected Shipping Option root adds only Option/Rule
entities and the actual Option→Rule receipt traversal at those owners. Existing
Set/Zone root bounds remain unchanged. The implementation reuses
`repository/lifecycle.ts` and `repository/lifecycle-graph-receipt.ts`, with no
parallel traversal or write implementation.

A named Fulfillment factory exposes only genuine
`softDeleteShippingOptions` and `restoreShippingOptions`. It reuses
`defineFulfillmentPersistenceModule`, the installed eight-table metadata and
the existing constructor; unselected repositories remain denied. No new schema
inventory or migration is introduced.

The composed resource uses authenticated ShippingOptionPriceSet lifecycle methods from
`links/shipping-option-price-set-service.ts` and the existing
`pricing-shipping-options` lifecycle profile in `modules/pricing/service.ts`.
The selected closure contains Fulfillment, the PriceSet Link and Pricing.
Shared complete Fulfillment routing metadata now belongs to
`fulfillment-module.ts`; the existing Set deletion consumer migrates to that
owner. Full native routing metadata is retained without granting unreachable
methods. Link/Pricing methods remain hidden from workflow callbacks and their
four authenticated dependency tokens must match the installed participants.

The resource reuses `links/cascade-result.ts`: native cascade errors remain tuple data, while
the accepted atomic boundary authenticates the complete tuple and refuses
nonempty errors through the existing sticky refusal owner. Ordered raw-string
workflow event validation and current-root pending cancellation remain shared
owners; module evidence/resource charges remain distinct from external publication.

## Selected bounds and authority

The selected root admits zero to four raw Option IDs and sixteen historical
Option Rules. It reuses existing installed lifecycle bounds of eight rich PriceSet
Link rows/eight distinct endpoint IDs, eight PriceSets, sixteen base Prices
(two per Set) and 48 PriceRules. Historical rows count toward complete cohorts.
The native maximum original/replacement history reaches those exact descendant
cohorts. Shared endpoint setup is refused by actual native Link.create; it does
not establish an additional admitted target graph. Complete history cohorts and
resource/observation bounds are checked independently of requested-ID bounds.

The named root selects the installed deletion envelope of 512 calls,
256 events, 2 MiB and 30 seconds through the existing identity-bound API.
Forward work and genuine retained callbacks share that request budget.
Shared defaults, SQL/lock limits, packet ceilings,
publication grouping, exact reconstitution guards and settlement authority are
unchanged. Only authenticated Pricing may select its established mixed
publication profile. Schema installation remains fresh/private.

## Limits and decision gate

No new native business or core correction is established by the matrix and
controls. Preserve raw-ID inverse revivals, exact requested workflow messages,
backend-unspecified within-model ordering, refused shared-Link setup, and the
accepted Link cardinality/atomic cascade-error boundaries. The private SDK
already accounts for native void-reference envelopes; the selected Link
resource admits only their exact grouped internal form without widening
public contracts. The public root remains strict `{ ids }`; the private marker
does not authorize caller-authored SDK envelopes or another module method.
Any proposed new native business correction still requires a preserved baseline,
separate candidate and explicit decision.

## Validation and activation boundaries

The connected witnesses exercise actual native deletion and all three retained
callbacks, historical revival, conflicting-Link refusal, pending cancellation,
scalar/identity preservation, rollback, replay, overflow, authority substitution,
exact receipt coverage and revoked callback lifetimes. The history arrangements
use the canonical table keys: Links use their genuine endpoint pairs, while
module rows use IDs. Each historical cohort is checked before the target runs.
Source guards compare the complete promoted native callbacks, permitting only
the recorded import, finite-void and transaction-covered adaptations.

PGlite and ordinary-role PostgreSQL remain separate validation gates. This
bounded fresh/private profile does not admit populated upgrades, public serving,
arbitrary providers or a general Medusa transaction API. Other workflows retain
their existing profiles and activation gates.
