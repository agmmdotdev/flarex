# Native Absolute Inventory Level Update Workflow

## Status And Authority

Status: implemented for the bounded private absolute-Level update profile,
including the shared conjunctive point-planning correction.
Authority is the accepted Flarex design, package boundaries, Medusa adoption
roadmap and Medusa 2.13.4 at `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`.
The source island remains read-only. Chunked File import and Product export
remain deferred.

This selects the pending native absolute-level update root. Existing stocking
creates levels and the stock-mutation profile applies deltas and individual
reservations; none executes `updateInventoryLevelsWorkflow`. Preserve this
operation's native absolute values rather than converting them into adjustments
or routing it through the Locking-dependent adjustment step.

## Exact Native Closure

Promote exactly `packages/core/core-flows/src/inventory/workflows/update-inventory-levels.ts`
and `inventory/steps/update-inventory-levels.ts`. The workflow ID is
`update-inventory-levels-workflow`; its only node is
`update-inventory-levels-step`. It forwards `input.updates` and returns the
updated array through WorkflowResponse. The step always resolves Inventory.
For `[]`, it returns `[]` and empty compensation data without listing/updating.
For nonempty input it computes native selects/relations, calls
`listInventoryLevels({ $or: input.map(({inventory_item_id,location_id}) =>
({inventory_item_id,location_id})) }, {})`, then genuine
`updateInventoryLevels(input)` once. The first list is complete preimage capture;
its computed selects/relations are compensation-only.

The actual service closure is `InventoryModuleService.updateInventoryLevels`
→ `sanitizeInventoryLevelInput` → transaction-covered
`updateInventoryLevels_` → genuine `ensureInventoryLevels` →
`InventoryLevelService.list/update` → native internal keyed update/repository.
The public service retains scalar/array overloads; the workflow is array-only.
There is no graph/remote query, Stock Location lookup, Link, Locking resource,
workflow EventBus step/event/hook, File, Region or remote effect. Native
Inventory module events remain required through `internalModuleWorkflowEvents`.

## Native Fields, Lookups And Caller ID

`UpdateInventoryLevelInput` requires inventory_item_id and location_id, with
optional id, stocked_quantity and incoming_quantity. Its declared quantities
are numbers. Preserve finite fractional, negative and large finite values
through the existing exact quantity/raw companion owner; do not impose a new
nonnegative/available-stock restriction. The service strips reserved_quantity
from foreign input so reservations remain its owner. Public admitted DTOs need
not grant arbitrary excess keys: Level DML metadata exists but this update DTO
does not declare metadata, and this slice does not invent a metadata workflow.
Pure service witnesses should still preserve native transient stripping.

`ensureInventoryLevels` selects by the supplied item/location pairs, checks each
pair and emits native NOT_FOUND for missing pairs, in requested order. It does
not validate stock availability for this operation. An explicit caller id does
not bypass the pair-existence lookup. The helper builds a pair→persisted-ID map,
then creates each internal update as `{ id: resolvedId, ...update }`.
**An explicit caller id therefore overrides the resolved ID.** Preserve this
native precedence; do not rewrite/ignore caller IDs or add adapter mismatch
validation. Internal keyed update subsequently selects the caller identity;
a missing/soft-deleted caller ID has the native internal NOT_FOUND path, while a
mismatched active caller ID can hit genuine active tuple uniqueness/FK integrity
when the supplied pair fields are written. Keep those errors with their actual
native/shared owners. A correct matching caller ID and omitted ID both work.

The native keyed service retains only the last update for each final ID.
Repeated tuples/caller IDs therefore do not imply repeated result rows. Full
preimage and pair-validation lists have no ID ordering filter and retain default
ID ASC; the internal keyed `$or` ID list uses the genuine native filter-order
helper, including its last-occurrence index for repeated `$or` entries. Use the
actual query builder/helper and pure witnesses instead of independently sorting
or deduplicating requests in the adapter.

Every nonempty typed update contains its item/location scalar keys, even when
both optional quantities are absent. Native Drizzle consequently still performs
a root UPDATE and update event for that tuple-only patch, although scalar values
may remain equal. Do not inherit InventoryItem ID-only no-op suppression or
optimize away these writes/events. Explicit metadata outside the DTO is not an
excuse to broaden the admitted graph. Public results preserve full native
numeric DTOs and computed available_quantity = stocked minus reserved; reserved
quantity is unchanged. There is no reservation sufficiency guard: setting stock
below reserved stock may produce negative availability natively.

## Implementation Owners And Bounds

1. Promote the exact composer/step with narrow portable imports and retained
   transaction-covered compensation. Reuse already promoted native conversion
   and selection helpers; no native algorithm repair is identified.
2. Add a named Inventory `level-updates` profile, preserving all existing item,
   level-create, stock, Product-deletion/batch and item-update admissions. Bind
   real listInventoryLevels/updateInventoryLevels; no other mutation authority
   is implied. Keep a real native scalar/array command ABI and array workflow
   method, following the item-update ownership pattern.
3. Extend Inventory's existing quantity repository at its real owner. Current
   stock-mutation update admission permits numeric fields only and cannot simply
   accept this method: native updates include inventory_item_id/location_id
   scalar keys and caller-ID selection. Reuse checked DML, scalar/keyed planning,
   exact quantity/raw capture, read predicates and subscribed native mutation
   events with this explicitly selected wider input contract. Do not strip tuple
   keys, duplicate availability/identity validation or add another transaction.
4. Authenticate complete original and returned rows, exact companion values,
   scalar preservation, computed numeric availability, actual native keyed
   selection/order and every `inventory.inventory-level.updated` event in a
   dedicated update receipt policy. Reject unrelated InventoryItem, Reservation,
   lifecycle, Link and endpoint activity; replay cannot repeat updates/events.
5. Add `src/workflows/inventory/update-levels.ts` over the genuine composer,
   exact installed source/profile checks, graph disabled and module-only events.
   Keep one outer settlement, default OCC and existing resource allowances.

Bound zero to four raw update entries, four selected requested tuples, at most
four selected final IDs and the union of at most eight observed Level rows when
explicit IDs differ from pair-derived rows. Bound actual touched Levels by four.
Retain the default 64-call/64-event envelope, existing bytes/catalog bounds and
ordinary 128-identity working sets; prove the complete maximum before any limit
change. No schema, source lineage, installation or durable reset is required by
the static closure. The runtime shared-owner correction is recorded below.
The existing exact
numeric row owner already supports these quantities; any actual mismatch must
be preserved as a failing witness and corrected at its owner.

## Isolation, Compensation And Verification

This native root contains no Locking.execute and does not promise callback
exclusion. Use default OCC; the scope-exclusive profile exists for the separate
native adjustment/reservation closure and is not automatically inherited here.
Focused PostgreSQL competition must prove one coherent outcome or a sticky
writeConflict for stale full-row/quantity observations, including competing
reservation and delta roots. Do not let an absolute update overwrite a newly
committed reserved_quantity, silently lose a delta or claim key-level exclusion.
A discovered shared-owner defect is covered by continuing core-change authority,
but an adapter mutex/retry/extra transaction is not a correction.

Actual PostgreSQL execution exposes broad scalar-prefix dependency reads for
complete native tuples, including extra same-Location Levels and an existing
other-Location Level for a missing tuple. Results are native-correct, but strict
receipts refuse those extra bodies. The authorized
[conjunctive point correction](../../shared-logical-storage/61-conjunctive-composite-point-access.md)
must select the existing complete composite access path through shared demand,
coverage and dependency proofs. Receipt checks, native queries and limits remain
unchanged.

The compensation callback skips missing/empty preimages; otherwise it restores
only fields selected by the genuine `convertItemResponseToUpdateRequest` helper
and calls updateInventoryLevels once. Keep its actual IDs/pairs/quantity data,
number serialization and transaction-covered callback. Whole-root rollback does
not replace callback fidelity, and this is not an independently durable restore
API.

Pure native composer/service/internal-helper witnesses must cover empty
resolution, exact full-preimage query/config, pair lookup before final-ID
selection, missing tuples and IDs, matching/mismatched caller IDs, last-patch
Map behavior and result order, quantities omitted/present, reserved sanitization,
native callback inputs, failure order and absence of external dependencies.
Both PGlite and ordinary-role PostgreSQL must prove the four-entry maximum,
exact fractional/zero/negative/large quantities and companions, unchanged
reserved quantities and live reservations, negative computed availability,
correct caller IDs and native mismatch/missing failures, unique collisions,
soft-deleted rows, malformed complete outputs/receipts/events, exact facts/event
order and tuple-only writes, late/caught failure rollback, cancellation,
revocation, replay/conflicting identity and scope isolation. Prove Product,
InventoryItem, Variant–InventoryItem Links and Stock Location rows unchanged.
Retain the pinned original Inventory tests `should update inventory level` and
`should fail to update inventory level for item in location that isn't stocked`
with their original assertions on real native service/storage.

Regress stocking, stock adjustments/individual reservations, Product Inventory,
item updates and the exact numeric/shared keyed owners as affected. Complete
both database lanes, affected types/builds, provenance/portability/source guards,
configured lint and both required read-only reviews before one scoped commit.
The next connected outcome is
[native Level deletion](./117-native-inventory-level-delete-workflow.md).
Inventory Item deletion, level batching, larger batches and hosted activation
remain separate pending outcomes.
