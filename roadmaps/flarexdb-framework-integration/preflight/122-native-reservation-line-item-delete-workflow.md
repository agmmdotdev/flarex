# Native Reservation Deletion By Line Item

## Status And Authority

Status: bounded native workflow integration is implemented with the approved
restore correction and complete-history access. Inline Product
import and Inventory workflows through standalone Level creation are implemented
in their recorded bounds. Chunked File import and Product export remain deferred.

Authority is the accepted architecture and pinned Medusa 2.13.4 fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f` from `third_party/medusa/SOURCE.json`.
The source root/step are `packages/core/core-flows/src/reservation/workflows/`
`delete-reservations-by-line-items.ts` and the matching `reservation/steps/` file.
Both are promoted with the narrow portable wrapper/metadata seams below. The
executing Inventory module preserves the pinned behavior except for the approved
restore correction. Its existing pure quantity grouping/projection is extracted
once for native execution and receipt validation, without changing arithmetic.

## Native Closure And Compensation

`deleteReservationsByLineItemsWorkflow`, ID `delete-reservations-by-line-items`,
accepts `{ ids: string[] }`. It unconditionally resolves Inventory and calls
`deleteReservationItemsByLineItem(rawIds)`, including empty input. There are no
child workflows, hooks, Locking provider, Order/Cart reads, Stock Location, Link,
File, Region or remote effects. Line Item IDs are scalar Reservation selectors;
they do not grant access to another module.

The step captures the raw IDs. Its inverse skips absent/empty arrays; otherwise
it calls `restoreReservationItemsByLineItem(previousRawIds)`. Preserve duplicate,
missing and ordered raw selectors at those boundaries. Native `buildQuery`
deduplicates read-filter arrays independently. The composer needs the same exact
portable `WorkflowResponse` wrapper and transaction-covered step metadata seam
as the admitted individual Reservation roots. Those seams require source guards;
public null output does not alter native intermediate void or inverse input.

## Pinned Native Restore Defect

Pinned deletion lists active matching Reservations, soft-deletes the raw filter,
then uses native grouped MathBN arithmetic to release their reserved quantity.
Restore also lists with default active visibility before restoring the raw
filter, then passes that earlier list to the restore quantity helper. It ignores
the restored rows returned by the internal lifecycle service.

The genuine method witness constructs actual Inventory services, decorators,
`MedusaInternalService`, `buildQuery` and quantity helpers over a recording DAL.
The DAL returns explicitly scripted arrays; it does not implement query,
lifecycle or quantity behavior. Unexpected repository/manager acquisition fails.

| Scripted pre-restore history | Existing reserved | Actual native preimage input | Observed requested reserved | Required restored invariant |
| --- | --- | --- | --- | --- |
| Deleted quantity 3 | 0 | Empty active list | No Level update | 3 |
| Active 2 and deleted 3 | 2 | Active quantity 2 | 4 | 5 |

The unchanged grouped deletion control releases quantities 2 and 3 from 5 to 0.
These observations establish native method arguments and order over scripted
results. They do not establish actual PGlite/PostgreSQL visibility, lifecycle,
events, isolation or whole-workflow compensation safety. The table preserves the
original pinned characterization, not acceptance of the incorrect invariant.
The executing witness separately asserts the approved restore invariants.

The original native test `should delete reseravation items by line item and
restore them` checks that Reservation rows reappear. The adjacent quantity test
checks deletion from 6 to 2. Neither checks reserved quantity after restore or
mixed history. The individual Reservation preflight already retains a separate
restore-preimage gate.

## Correct Owner And Native Behavior Decision

The defect is native `InventoryModuleService.restoreReservationItemsByLineItem_`
selecting active rows as restoration preimages. Default deleted-row exclusion
in shared storage is correct. Do not inject visibility, duplicate arithmetic,
repair quantities, add transactions or suppress compensation in the adapter.

The concrete correction reads with `withDeleted: true`, selects only deleted
matching preimages before restoration, restores the original raw filter and
passes those preimages to the existing native quantity helper. A shallow snapshot
before awaiting restore protects the preimage values if managed rows mutate.
Enabling history alone double-counts active rows. Using returned restored roots
alone is also insufficient when those roots include already-active matches.

The user explicitly approved this native business correction. Public
signatures, raw selectors, native grouping, events and borrowed lifetime remain
unchanged. Matching deleted rows rebuild reserved demand; already-active rows
and repeated restores must not add demand. Native service consumers are affected;
currently admitted individual Reservation roots do not expose this by-Line-Item
method. By-ID restoration is outside this correction and remains separately
gated. No backfill or repair of previously inconsistent Levels is included.

The executing service is classified as `inventoryServiceFork`. Exact source and
runtime guards authenticate the corrected restore body, the delegated arithmetic
method and the source-derived pure helper, then restore both original methods
for whole-module comparison. Intended invariants are labeled separately from
the pinned defect evidence above; the comparison snapshot remains unchanged.

The raw-ID native inverse restores all matching history, including tombstones
that predate the forward deletion. Correct stock accounting does not make that
inverse an exact undo for an external saga. The admitted finite runtime uses
transaction-covered root rollback and does not invoke compensators. A retained
inverse witness must exercise the genuine callback explicitly in a borrowed
attempt, observe its native history effects, then prove the failed outer root
restores the complete original snapshot. External saga safety remains unclaimed.

## Complete-History Access

The native `reservation_item.line_item_id` index is partial on
`deleted_at IS NULL`. The Inventory compiler preserves that predicate. The
nullable scalar Line Item field is neither a foreign key nor a composite-key
suffix, so shared reverse-access derivation does not add an unconditional path.
The active index alone does not prove complete-history access.

`compileInventoryDefinition` adds an explicit derived unconditional equality
index for this one field, using the same existing
lowering/installation/readiness mechanisms as Store's derived default Sales
Channel index. Do not loosen generic query eligibility or infer foreign-key
semantics. Both drivers must prove installed access/readiness, complete history,
scope isolation and overflow including deleted rows. Any durable upgrade remains
subject to the existing schema lifecycle; this preflight authorizes no reset.

## Bounded Admission

1. The genuine root and step use only the recorded wrapper/metadata seams. The
   facade admits at most four raw Line Item IDs, returning null.
2. A dedicated Inventory profile exposes native delete-by-Line-Item and its
   retained restore inverse. It admits at most four complete matching history
   rows and four affected Level tuples. A Line Item may match several rows;
   preserving native grouping and raw missing/duplicate selectors.
3. Checked Reservation row/raw-quantity contracts and existing lifecycle,
   query and receipt owners authenticate complete preimages, lifecycle
   membership, after rows, quantity results and actual native event grammar.
   Existing stock receipts do not admit restored events automatically.
4. The workflow reuses the trusted identity-bound scope-exclusive stock profile.
   The native root has no Locking resolve; no provider is added. The workflow
   host accepts an explicit checked `scopeExclusive` preparation selection,
   includes it in workflow identity and verifies the existing exclusion before
   native callbacks. Existing provider-derived selections retain their identity.
   The complete graph retains the existing 64-call, 64-event, 128-identity and
   byte/node bounds; its forward and retained inverse each use 27 entry spans.

## Connected Proof Required

Preserve original deletion and row-restoration assertions; add corrected stock
invariants for deleted-only, mixed, active-only, repeated and grouped restores,
multiple Levels, zero/fractional quantities and missing/deleted Levels. Distinguish
empty forward calls from skipped empty inverse calls. Observe complete event,
fact and raw-quantity identity/order instead of projecting before validation.

PGlite and ordinary-role PostgreSQL must cover maximum and overflow history,
untouched neighboring families, scope isolation, one settlement, replay/revision
conflict, wrong profiles, forged DTOs/maps/events, late failure, caught denial,
cancellation and revoked continuations. PostgreSQL competitors include individual
Reservation create/update/release and stock adjustment roots, proving exclusion
or the named conflict without stale success. Regress existing Reservation,
Item/Level lifecycle and native consumer witnesses, types, provenance, portability,
builds and lint; obtain both required project reviews before a scoped commit.
