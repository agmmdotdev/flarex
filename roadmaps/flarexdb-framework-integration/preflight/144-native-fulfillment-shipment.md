# Native Fulfillment shipment preflight

Status: bounded private shipment integration is implemented. The unchanged-native
PostgreSQL matrix and separate populated-to-empty Label inverse witness establish
the native contract. The private root retains that contract on PGlite and
ordinary-role PostgreSQL, including both retained-preimage timestamp paths.
Public/hosted activation, external provider effects,
populated upgrades and delivery remain separate.

## Native authority and connected closure

Authority is Medusa 2.13.4 at pinned revision
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f` in
`third_party/medusa/SOURCE.json`. The executing native closure is:

- `packages/core/core-flows/src/fulfillment/workflows/create-shipment.ts`:
  `validateShipmentStep(input.id)`, the original input spread and generated
  `shipped_at: new Date()`, followed by `updateFulfillmentWorkflow.runAsStep`.
- `fulfillment/steps/validate-shipment.ts`: retrieve the native scalar guard
  projection, then refuse shipped, canceled and absent Shipping Option in that
  order. Delivered is not an additional shipment guard.
- `fulfillment/workflows/update-fulfillment.ts` and
  `fulfillment/steps/update-fulfillment.ts`: derive selects/relations from actual
  update data with `getSelectsAndRelationsFromObjectArray`, retrieve that
  preimage, execute the genuine service update, and retain the actual projected
  DTO for the original inverse. The inverse calls the same update method with
  the retained remainder after removing its root ID.
- `packages/modules/fulfillment/src/services/fulfillment-module-service.ts`:
  native retrieval, Item/Label hydration, existing-Label normalization, internal
  update, serialization and module events.

Paths above are relative to `third_party/medusa/upstream/`; the module service
already executes from `packages/medusa-fulfillment`. Only the four workflow/step
files and two unchanged workflow input declarations need promotion. Finite
import relocations and the established `transactionCovered` compensation
annotation preserve the original runtime bodies. The exact emitted-source
guard authenticates the complete promoted closure, including guard precedence,
date generation, projected preimage, nested workflow and retained inverse.

The target requires only Fulfillment retrieve/update. No provider method,
workflow Query, Stock Location, Link, Inventory, Pricing, Order, hook or locking
step is reached. Native fixture creation uses the existing genuine Manual and
Stock Location setup; those are not target capabilities. Observer resolution
arrays are incomplete for native scoped containers and are not an exhaustive
container-resolution proof. The source closure and actual module/SQL calls
establish the selected target path.

## Executed unchanged-native observations

The ordinary-role PostgreSQL packet is
`%TEMP%/flarex-144-native-shipment-witness/unchanged-native-postgres-runs/2026-10-19T06-27-57.067Z-12952/report.json`.
Runner SHA256 is
`91565ab5e95539a8da0d5e7d5ea980a306b6c221a7dec7d33079a7bef79f653b`.
All 32 artifact byte lengths and SHA256 values match; preparations succeeded,
targets executed, cleanup failures are empty and all 64 schema absence checks
succeeded. A separately executed nominal run is preserved. No shipment Drizzle
comparison or portable parity result follows from this native packet.

The runner loads the pinned genuine SDK, composer, workflow/step bodies,
services, MikroORM repositories and local Manual fixture. Retained inverse
evidence uses actual `WorkflowResult.transaction` objects and recursively
observes the real nested child results; it does not reconstruct compensation
payloads from submitted input. Original creation and cancellation packets remain
unchanged. A filtered run selecting no case fails closed, and an unfiltered
run requires the complete declared matrix.

The separately executed populated-to-empty witness is preserved at
`%TEMP%/flarex-144-native-shipment-witness-v2/unchanged-native-postgres-runs/2026-10-19T07-19-15.362Z-4140/report.json`.
Its immutable runner SHA256 is
`c9faf818fafc82a11a1f6deba1a5ef8c9680d564d64a1bf2e785fb6237936492`.
The single required case starts with four active Labels and four Items, submits
`labels: []`, completes shipment, and cancels the original genuine transaction.
The target finishes `done`, the inverse finishes `reverted`, errors and cleanup
failures are empty, and the four restored Label rows equal their original raw
stored rows, including both timestamps. Artifact lengths and hashes match the
execution index. The original 32-case packet remains unchanged.

| Native cohort | Observation |
| --- | --- |
| Initially empty Labels and four-for-four Label replacement, populated Items/Address/data, optional marker | Generated shipped date, complete native update DTO and original nested retained inverse; unrelated graph unchanged |
| Four active Labels replaced by `[]`, then original scheduler cancellation | Complete retained Labels restore original IDs, business values and both timestamps; Items and protected graph unchanged |
| Shipped/canceled/absent Option combinations, including all three | Shipped wins, then canceled, then absent Option; no mutation or module event |
| Delivered-only or packed-only root | Shipment succeeds; no invented delivered guard |
| Missing or historical Fulfillment | Native NOT_FOUND from active retrieval |
| Omitted/null, historical or physically detached Option | Genuine validator refuses the native selected scalar view |
| Historical, unregistered or null Provider | Shipment succeeds without provider invocation |
| Historical delivery Address | Native owning reference presentation retained |
| Marker omitted, explicit null, or replacement of an existing marker | Only selected marker data is changed/retained; inverse restores its projected prior value |
| Existing Label ID-only/partial/full controls | Original module normalization preserves omitted business fields; actual preimage selects only requested paths |
| Historical Label plus active Label replacement | Independent historical row is byte-preserved; replacement addresses only active membership |
| Repeated successful shipment | Genuine already-shipped refusal before another update |
| Omitted Labels runtime control | Native execution succeeds, independently of the stricter public typed shipment envelope |
| Null Labels runtime control | Genuine non-null collection failure; no successful target mutation/event and permanently failed transaction cannot be canceled |
| Late parent failure | Both genuine nested child transactions revert; original Label IDs/business values and shipped date are restored through native compensation |

### Label replacement and inverse are not snapshot undo

The existing update-step TODO does not prove a failure in this selected path.
Actual PostgreSQL cohorts remove introduced Labels and restore prior Label IDs
and business values, including after the late parent failure. In the witnessed
nonempty replacement cohorts, deleted/reinserted Labels receive fresh
`created_at` and `updated_at`. Surviving modified Labels
retain `created_at` and receive a new update stamp; unchanged ID-only survivors
retain both stamps. Independent historical Labels remain unchanged. These
observations do not establish the populated-to-empty case: the initial empty
case started without Labels. The separate native witness establishes that its
complete retained DTO restores both timestamps. The corresponding portable
failure reaches the shared managed-field refusal; the existing reconstitution
owner also always advances `updated_at`. The scoped correction adds an explicit
identity-bound `preserveTimestamps` policy to that owner, retaining its exact
same-root active deleted-preimage proof. Existing consumers select
`advanceUpdatedAt` and retain their behavior. Managed-free projected inverses
continue to use ordinary insertion with fresh timestamps.

The retained DTO has root `id`, prior `shipped_at`, optional selected marker,
and selected Label fields. Complete new Label input captures all three Label
business fields; ID-only input captures IDs, and partial tracking-number input
captures only IDs and tracking numbers. Empty submitted Labels retain complete
prior Label DTOs; empty prior collections retain `[]`.

Events follow actual native operation grouping. Four-for-four replacement emits
Label-created ×4, root-updated, then Label-deleted ×4; its inverse does the same
with restored/new cohorts reversed. Empty-prior insertion emits creations then
the root update; the empty-collection inverse emits root update then deletions.
Surviving Label modifications follow the root update. The late parent failure
has two distinct native module emit groups, forward and inverse. Preserve these
native events separately from whole-root atomic publication/rollback.

The maximum native cohort distinguishes collection order from primary-key
sorting: creation, retained and restored Labels stay in creation order, forward
Labels follow submitted order, and unchanged Items retain creation order. The
selected shipment read/graph profiles use the existing storage-insertion order
for Items and Labels, with authenticated ordered read identities in receipts.
This is a scoped translation for the witnessed native cohorts, not a general
claim about unspecified SQL ordering.

## Implementation plan and ownership

1. Promote the four genuine callbacks, two unchanged input declarations and
   finite exports. Authenticate exact runtime behavior with negative provenance
   controls; retain the native update input type even though its static surface
   understates Labels forwarded by the shipment runtime spread.
2. Reuse the existing installed twelve-table Fulfillment source, native module
   constructor and `makeLocalFulfillmentCreationCommands`. Add authenticated
   retrieve/update methods at that owner while retaining exact creation and
   cancellation selections. Avoid another module factory, source lineage,
   provider implementation or independent lifecycle.
3. Extend the selected DAL through existing read/projection and graph mutation
   owners. Validate complete stored rows before exact selected preimage
   projection. Keep Item/Address/Provider/Option reads distinct from the only
   writable root shipment fields and Label children. Native hydration and Label
   normalization remain inside the original service body.
4. Reuse shared graph replacement with explicit module policies for empty
   collection replacement and active-only has-many orphan membership. Current
   generic update skips empty collections, and its default replacement cohort
   includes history. Those existing policies cannot represent the witnessed
   PostgreSQL Label behavior. Preserve targeted failing witnesses before
   correcting the actual owner; other consumers retain their default policies.
   Do not add adapter-local cleanup or weaken historical-row checks.
5. Add strict causal retrieve/update receipts: actual config and selected
   results, complete row/read coverage, root/Label deltas, ownership, original
   IDs with the native projected/full-preimage timestamp behavior, historical exclusion, final DTOs and
   ordered native module events. Creation/cancellation receipts retain their
   existing obligations. Native normalization is not duplicated as a second
   business algorithm in the harness.
6. Compose one private root with strict `{ id, labels, marked_shipped_by? }`,
   zero to four complete new Labels, and optional string/null marker. Internal
   retained ID-bearing/partial Labels are not an extra public input grant.
   Select only `retrieveFulfillment` and `updateFulfillment`, disable graph
   access, and start within normal resource limits. Any measured insufficiency
   must be resolved through the existing authenticated resource owner.
7. Validate genuine forward, retained inverse and late-failure behavior on
   PGlite and ordinary-role PostgreSQL separately, including maximal/replacement,
   empty, guard, history, scope, replay, borrowed lifetime and resource-refusal
   cases. Run shared graph, creation/cancellation/reference-detachment and
   affected consumer regressions, typechecks, source/portability guards, lint,
   both read-only reviews and exact-index checks before a scoped commit.

The initial maximum portable witness fails before DAL execution: the finite
SDK rejects the genuine transform's generated `Date` as a non-plain record.
Native `utils/composer/helpers/resolve-value.ts` serializes reached transform
results with `parseStringifyIfNecessary`, producing an ISO string for that
Date. The SDK resolution owner now snapshots a valid bare intrinsic Date to
that string before downstream capture. Invalid or decorated Dates, subclasses,
custom serialization and arbitrary classes remain unsupported. Ordinary and
final JSON contracts, value bounds and persistence authority are unchanged.
The failing workflow and focused SDK witnesses precede this scoped correction;
owner and connected workflow regressions remain admission gates.

The initial 64-call private shipment allowance refuses the maximum replacement
and retained inverse before settlement. Shipment therefore selects a distinct
named 128-call allowance through the existing trusted resource policy; business
inputs cannot choose it. The maximal forward uses 65 calls and nine messages;
the empty-collection retained inverse uses 103 calls, and the four-for-four
retained inverse uses 117 calls. Both database lanes must validate the selected
allowance. Other profiles, event/byte limits and command
deadlines are unchanged.

No native business correction, schema migration, new storage authority or
external effect is established by this preflight. Delivery remains a subsequent
workflow with its own Remote Query and locking closure. Chunked Product file
import and Product export remain deferred by user scope.
