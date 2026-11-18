# Stock Adjustments And Reservations

## Status And Scope

Status: implemented bounded private native admission.
The private facades adjust stocked quantities and create, change and release
individual reservations against existing Inventory levels. The preceding
[stocking admission](97-stock-location-inventory-levels.md) supplies those levels.
Performance tuning remains paused.

Adjustment admits zero to four sequential deltas, including repeated pairs,
fractions and negative stock. Reservation roots admit zero or one row/ID each.
Reservation quantities are finite and nonnegative, including zero. Creation
retains native backorder behavior; updates change quantity at the same item and
location while retaining the backorder flag. Each root settles independently.

Batch reservations, relocation, backorder flag changes, public restore,
Cart/Order fulfillment, Sales Channel location selection, distributed lock
administration, remote effects and workflow suspension remain unadmitted.

## Sources And Executing Owners

The [adoption roadmap](../06-medusa-adoption.md),
[workflow foundations](../../workflow-foundations/README.md),
[package boundaries](../../16-package-boundaries.md), accepted shared logical
storage design and adapter organization roadmap retain their authority.
`third_party/medusa/SOURCE.json` selects Medusa 2.13.4 at fork commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The source island stays immutable.
The promoted Inventory service, selected core flows, types, helpers and
promotion manifest own executing behavior and pinned provenance.

## Native Branches

| Entry | Native dependencies and behavior |
| --- | --- |
| `adjustInventoryLevelsStep` | Inventory `adjustInventory` and Locking `execute`; unique item IDs are lock keys. The step maps snake-case input to the camel-case service ABI. The service reads and updates each item/location pair sequentially using MathBN. Compensation uses inverse deltas. |
| `createReservationsWorkflow` | The native step locks item IDs, checks level availability, creates reservations and increases reserved quantities. Compensation locks the same items and hard-deletes returned reservation IDs. |
| `updateReservationsWorkflow` | The native step reads selected preimages using native select/relation helpers and updates quantities. Compensation restores the native update preimage. The pinned step does not resolve Locking. |
| `deleteReservationsWorkflow` | The native step soft-deletes IDs and decreases reserved quantities. Compensation restores those IDs. The pinned step does not resolve Locking. |

There is no standalone native delta-adjustment workflow in this pin. The named
private adjustment composer wraps the actual native step.
`updateInventoryLevelsWorkflow` sets absolute quantities and remains a different
operation. Order/Fulfillment and Cart graphs are not dependencies of these roots.

The reservation composers have no hooks or separate workflow events. Native
Inventory events still participate in the one publication owner: reservation
creation/update/deletion and actual level updates. Receipts authenticate the
operation-local row and lifecycle evidence, including empty calls and native
event grouping. Separate runs do not become atomic implicitly.

ReservationItem DML already belongs to the installed Inventory source. Its
InventoryItem relationship, active indexes, exact quantity/raw pair and nullable
line-item identifier are declared there. Its location ID is text, not a Stock
Location FK. Explicit reservations use native existing-level checks. No DML,
logical source lineage, durable identity or data-format change is selected.

## Native Gaps And Finite Admission

Targeted probes against the executing promoted service body with recording
internal repositories establish these algorithm outcomes. They are not database
or concurrency proofs.

- With available quantity 5, a same-pair batch of two quantity-4 reservations
  passes individual checks and requests reserved quantity 8. Expected stock-safe
  batch behavior rejects aggregate demand. The native Inventory algorithm owns
  this gap; the adapter adds no aggregate-enforcement workaround.
- Moving a quantity-3 reservation to a destination with availability 0 passes
  and updates only the destination level. The expected move checks full
  destination demand and decrements the source. Native Inventory owns this gap;
  relocation is excluded.
- Zero creation requests a real zero update because MathBN returns an object.
  The native truthiness check does not discard that update. Zero creation and
  same-location updates are admitted. Negative reservation quantities remain
  outside the finite profile.

Native adjustment has no observed floor at zero or reserved quantity. Preserve
that behavior. Backorder flag changes and restore preimage visibility retain
separate characterization gates. Existing original Inventory tests do not prove
batch availability or relocation correctness.

## Explicit Outer Exclusion

The ordinary atomic profile retains snapshot-read admission and publication-time
read revalidation. Its neutral Currency witness allows two callbacks to read
value 2 concurrently: one commits value 3 and the other fails with `writeConflict`
backed by `PointCommitConflictV1Error`. Revalidation prevents a lost update but
does not supply native callback exclusion. The witness remains as a default-
profile regression rather than being weakened or removed.

The approved core extension is the trusted, identity-bound
`executionIsolation: "scopeExclusive"` profile. It selects the existing ordinary
writer clock owner before logical admission and callbacks, retaining exclusion
through the existing settlement owner. Other profiles and limits are unchanged.
Changing isolation conflicts with a retained request identity.

The workflow entry and composed Locking resource authenticate the core issuer's
live, request-bound exclusion evidence. A host that drops the selection refuses
before native work; closed or foreign contexts cannot reuse evidence. The
callback borrows the existing bounded Promise owner and selected method tokens.
It receives no raw transaction, clock, commit or finalizer capability.

The scope lock is deliberately coarser than native item keys. Those keys retain
native identity but do not claim per-item parallelism. Distinct shops retain
independent exclusion even with matching native IDs and request keys. No new lock
store, SQL primitive, transaction, recovery owner, default-global serialization
or module-specific persistence exception is introduced.

## Adapter And Portable Fork Boundaries

Each facade selects only its required authentic methods. Existing item-only and
level-create profiles retain their refusals. Inventory owns pair/ID selectors,
quantity validation/serialization and reservation lifecycle translation; shared
scalar, query, keyed-write, lifecycle, event and publication owners remain the
only storage mechanics.

Native arithmetic entities retain checked exact decimal strings and raw
companions through reads and writes. Public serialization converts to native
numeric DTOs after pair validation. Repeated updates therefore preserve native
arithmetic beyond the DTO's numeric precision. Computed availability reuses the
existing native Inventory helper. Scalar DAL normalization and metadata-derived
companions are reusable extensions; Inventory owns the quantity policy. The
create-only level repository is removed.

The adjustment adapter preserves the actual decorated service context slot for
the array ABI. Native inverse-delta compensation uses an exact JSON decimal
string accepted by BigNumberInput. The delete composer wraps its original void
step in WorkflowResponse and reuses existing top-level void-to-null completion.
Native compensators remain declared as transaction-covered; root failure rolls
back rather than issuing inverse writes inside an aborted transaction.

The four-delta graph and individual reservation graphs retain the ordinary
64-call/64-event envelope and existing byte, row, fact, deadline and lock-timeout
limits. No performance acceptance, schema migration or reset is implied.

## Correctness And Remaining Gates

The behavioral owners cover fractional/repeated/negative deltas; exact repeated
arithmetic; reservation creation, increase, decrease, zero and release; native
missing-pair, missing-ID and availability failures; backorders and empty calls;
late-failure rollback, cancellation and late completion; replay and uncertain
acknowledgement recovery; dropped-profile refusal; and native events with one
publication per root. Real ordinary-role Postgres separately proves competing
requests and cross-shop exclusion. PGlite proves its semantic lane, not database
lock concurrency.

Keep Product, Variant/Inventory, stocking and scalar consumers in the regression
scope, with affected builds/typechecks, provenance/browser guards and required
reviews. Hosted activation, general Inventory/Locking compatibility, larger
reservation graphs and native business corrections remain separate gates.
