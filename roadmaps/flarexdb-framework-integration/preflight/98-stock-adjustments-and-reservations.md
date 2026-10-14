# Stock Adjustments And Reservations

## Status And Scope

Status: native preflight complete; implementation proposed, not admitted.
The requested next outcome changes stocked quantities and creates, changes and
releases reservations against existing Inventory levels. The preceding
[stocking admission](97-stock-location-inventory-levels.md) supplies those levels.
Performance tuning remains paused.

The proposed initial profile uses the native delta step with up to four
adjustments, and the native reservation workflows with zero or one reservation
per call. Quantity updates retain the reservation's item and location. Separate
roots retain separate settlement; they do not become atomic together implicitly.
Batch reservations, relocation, public restore, Cart/Order fulfillment, Sales
Channel location selection, distributed lock administration, remote effects and
workflow suspension remain outside this proposed admission.

## Sources And Executing Owners

The [adoption roadmap](../06-medusa-adoption.md),
[workflow foundations](../../workflow-foundations/README.md),
[package boundaries](../../16-package-boundaries.md), accepted shared logical
storage design and adapter organization roadmap retain their authority.
`third_party/medusa/SOURCE.json` selects Medusa 2.13.4 at fork commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`. The immutable source island owns
comparison evidence. The executing Inventory service is already promoted at
`packages/medusa-inventory/src/services/inventory-module.ts`; the selected
reservation composers and delta step still require source promotion.

## Native Branches

| Entry | Native dependencies and behavior |
| --- | --- |
| `adjustInventoryLevelsStep` | Inventory `adjustInventory` and Locking `execute`; unique item IDs are lock keys. The step maps snake-case input to camel-case service arguments. The service processes deltas sequentially, reads the item/location pair, adds the delta with MathBN and updates stocked quantity. Compensation repeats the same method with inverse deltas. |
| `createReservationsWorkflow` | `createReservationsStep` resolves Inventory and Locking, checks level availability, creates reservation rows and increases reserved quantities. Compensation locks the same items and hard-deletes the returned reservation IDs. |
| `updateReservationsWorkflow` | `updateReservationsStep` lists selected preimages using native select/relation helpers, then invokes `updateReservationItems`. Compensation restores the native update preimage. The pinned step does not resolve Locking. |
| `deleteReservationsWorkflow` | `deleteReservationsStep` soft-deletes reservation IDs and decreases reserved quantities. Its compensation restores those IDs. The pinned step does not resolve Locking. |

There is no standalone native delta-adjustment workflow in this pin.
`updateInventoryLevelsWorkflow` sets absolute quantities and is a different
operation. A named private composer may wrap the actual adjustment step without
importing the Order/Fulfillment graph that also consumes it.

The reservation composers have no hooks or separate workflow events. Native
Inventory module events are still required. Reservation creation produces
reservation-created and level-updated evidence; quantity changes produce
reservation-updated and the actual level updates; release produces the native
reservation lifecycle event and level updates. Validate actual event identities
and operation-local evidence, including empty and unchanged operations, rather
than assuming one event for each supplied row.

ReservationItem DML already belongs to the installed Inventory source. Its
InventoryItem relationship, active indexes, exact quantity/raw pair and nullable
line-item identifier are declared there. Its location ID is text, not a Stock
Location FK. Explicit reservations use native existing-level checks; they do not
require Cart or Order schemas. No new DML or durable format is selected.

## Native Characterization And Excluded Cases

Targeted probes against the executing promoted service body, using recording
internal-service repositories and an injected context, establish these algorithm
outcomes. They are not database, event, decorator-lifetime or concurrency proofs.

- Calling `createReservationItems_` with available quantity 5 and two quantity-4
  reservations for the same item/location passes individual availability checks
  and requests a reserved-quantity update to 8. Expected stock-safe batch behavior
  would reject the aggregate demand. The native Inventory algorithm owns this
  gap; the adapter must not add aggregate enforcement as a workaround.
- Calling `updateReservationItems_` to move a quantity-3 reservation from a
  level with reserved quantity 3 to a destination with available quantity 0
  passes and requests only a destination reserved-quantity update to 3. The
  expected move checks the full destination demand and decrements the source.
  The native Inventory algorithm owns this gap. Relocation remains excluded.
- Zero-quantity creation requests a real zero update: MathBN returns an object,
  so the native truthiness check does not produce an undefined update entry in
  that probe. Do not classify this as a defect from a JavaScript-number reading
  of the source. Characterize public zero/negative quantity admission separately
  before selecting its finite input contract.

The pinned original Inventory integration tests cover create/read, availability
failure, same-location quantity changes, hard deletion, line-item deletion and
restore, and delta adjustments. Preserve applicable original assertions. Their
existing coverage does not establish the excluded batch and relocation cases.

Native adjustment has no observed floor at zero or reserved quantity. Preserve
that behavior rather than inventing a stock-floor rule. Backorder creation uses
the native availability bypass. Backorder flag changes and restore preimage
visibility need characterization before admission; do not change native `||`
or default soft-delete visibility in an adapter.

## Locking And Transaction Gate

Native `locking.execute(keys, callback)` takes an opaque callback, so it is not
an ordinary JSON command. The existing composed-resource argument decoder runs
before JSON result capture and its callback owner already bounds foreign
Promises. Reuse that seam if it can authenticate the finite item keys and
callback lifetime; expose only the selected Inventory methods, never a manager,
raw transaction, clock or settlement capability.

Do not assume an atomic root already provides native item exclusion. The current
atomic host enters application admission with the default snapshot-read clock
access. Its physical participants explicitly enter publication before business
execution; the selected logical Inventory participants do not use that physical
path. The ordinary writer clock owner exists, but its later acquisition is not
proof that an earlier availability read was exclusive. Request-key exclusion
alone does not serialize different requests for the same Inventory item.

The first implementation gate is a two-request, same-item witness and a trace
of the current logical read/validation/settlement protocol. Prove either that
the existing protocol supplies the required exclusion/revalidation or select
the smallest shared-owner extension using the existing clock/authority owner.
A no-op Locking provider, adapter SQL/mutex, second transaction, extra finalizer
or distributed lock system is not selected. If a core correction is required,
preserve the witness and obtain scoped authorization under AGENTS.md before
dependent adapter work. Earlier reference-coverage approval does not authorize
an unrelated locking correction. Exercise empty lock keys, cancellation,
revocation, late callback completion, and different-shop identity isolation.

## Adapter And Portable Fork Plan

1. Characterize the locking gate and native quantity/lifecycle edges first.
   Retain exact expected/actual witnesses and their actual owner. The proposed
   single-reservation profile avoids aggregate and relocation changes; any
   native business correction requires its own explicit decision.
2. Promote the four connected native entries and their helper closure, using
   existing portable imports and explicit transaction-covered compensation.
   Keep the declared native compensators. The atomic profile rolls back the
   root rather than issuing inverse writes inside an aborted transaction.
3. Adapt the delete composer to return `WorkflowResponse` around its original
   void step. This is the existing finite SDK contract, not a general relaxation.
   Reuse `workflow/runtime.ts`, which already normalizes successful top-level
   void completion to JSON null; no new result-normalization owner is needed.
4. Extend the Inventory module owner with pair and ID reads, native `$or`
   selectors, update preimage projections, exact numeric/raw updates and
   computed availability. Add ReservationItem create/update/soft-delete storage
   translation through existing scalar, query, keyed-write and lifecycle owners.
   Preserve detached mutable native entities and serialization order. Keep
   item-only and level-create profiles confined to their existing capabilities.
5. Add the named locking resource and workflow facades under the organized
   `workflow/`, `modules/inventory/` and `workflows/inventory/` owners. Extend
   module-event capture and receipt validation for actual mutations/lifecycle
   evidence. Reuse the one outer settlement/publication/recovery owner.

Retain the existing 64-call/64-event and other resource envelopes until the
complete proposed maximum graph has been measured. Resource expansion is not
implicit. There is no selected schema migration, reset, source-lineage change,
production activation or performance acceptance.

## Exit Gates

Prove positive/negative/fractional and repeated-pair sequential adjustments;
create, increase, decrease and release one reservation; native availability,
missing-pair and missing-ID failures; defaults, exact raw companions, computed
availability and empty calls. Characterize backorder and zero quantities before
admitting them. Prove atomic stock/reservation consistency after a late failure,
caught refusals, cancellation, replay, uncertain acknowledgement and one
publication. Real ordinary-role Postgres must prove competing same-item requests;
PGlite is a separate semantic lane, not that concurrency proof.

Regress Product, Variant/Inventory, stocking and the reused scalar/lifecycle
owners. Run affected builds/typechecks, promotion/provenance/browser guards,
core/diff/staged lint and both required read-only reviews before one scoped
implementation commit. This preflight does not establish any new runtime
admission.
