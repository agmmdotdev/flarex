# Native Order Change scalar update workflow

## Status and scope

Status: implemented private scalar update profile on PGlite and ordinary-role
PostgreSQL. The connected native
`updateOrderChangesWorkflow` operates on zero to four patches for existing
OrderChange rows. It uses the full 23-model Order definition and independent
`flarex-order-change-update` / `order.changeUpdate` capability. Cart, Tax and
Payment retain their existing owners; creating or confirming Changes, creating
Actions, finance, serial allocation and hosted activation remain separate gates.

## Current sources of truth

Medusa 2.13.4 fork `48d5cc675e4e8bc821e22c20c88a751acc66fb5f` owns the
native step, generated Order methods, DML, duplicate handling and events. The
[Order foundation](./order-archive-foundation.md), accepted shared logical
storage design and existing atomic workflow host govern installation, confined
reads, facts, receipts, replay and settlement. The native root's mistaken Action
DTO annotation is corrected to its actual Change DTO without changing runtime
behavior; selected imports and transaction-covered compensation follow the
existing workflow seam.

## Current architecture and invariants

The native step selects the union of submitted scalar fields and IDs before
calling the genuine generated `updateOrderChanges`. Its retained callback sends
those selected preimages through the same method. Admitted fields are status,
description, internal note, requested/confirmed/declined/canceled actors,
declined reason and carry-over promotions. Native nullable columns preserve
null values, empty strings and false. Metadata, dates, relationship keys and
managed columns refuse at the command boundary.

The final duplicate ID's whole patch wins. An ID-only final patch discards any
earlier patch for that ID and produces no write or module event. A supplied
same-value scalar does write and emit an update in the selected portable
Drizzle mutation lane. Updates return complete, checked Change DTOs with all
unchanged date/JSON/scalar values and the required owning Order reference;
Actions and the other Order tables remain unchanged. Full rows are validated
before selection, and supporting parent reads remain authenticated receipt
observations rather than mutation authority.

The selected projection, ID ordering and required-parent read eligibility follow
the characterized native PostgreSQL repository: selected scalar preimages can
include a Change whose parent Order is historical, but the internal full-row
lookup excludes it and update fails without writes. Raw native SQLite/Drizzle
instead follows storage order, omits the synthesized Order reference, and permits
that historical parent. Native PostgreSQL dirty checking can also skip an
explicit same-value write. These manager lanes are characterized separately;
the portable profile retains the existing native PostgreSQL presentation and
Drizzle write/event choices rather than claiming universal manager parity.

Module messages are native `order.order-change.updated`, captured atomically
with actual distinct writes. The root emits no workflow messages or hooks.
Repeated retained inverses use the native assignment behavior; managed
`updated_at` advances and is not restored. Durable replay returns the checked
committed result without repeating writes or events. Only the trusted outer
owner settles; no new transaction, raw database or finalizer capability is
granted to the module.

## Known gaps and next correctness gates

General metadata updates are unadmitted because the native inverse's metadata
merge retains newly added keys and mutates its retained object. A tombstone
patch cannot restore every prior object because a legitimate stored empty-string
value is interpreted as deletion by the native merge. Native Change cancellation
also omits prior status from its retained projection, so undo leaves the Change
canceled. Genuine original SQLite and ordinary-role PostgreSQL executions
preserve both failures; no adapter workaround or business correction is applied.
Admitting cancellation or general metadata updates requires an explicit native
correction decision and exact restoration/retry witnesses at the native owner.

The scalar profile's both-driver witnesses cover maximum cohorts,
selected preimages, complete results, genuine and repeated compensation, duplicate
and ID-only semantics, empty/missing/historical cases, unchanged other tables,
late-root rollback, replay corruption, scope/capability confinement and cleanup.
Source guards admit only the exact two native source pairs and the erased type
correction; public activation and broader Order workflows remain separate gates.
