# Variant–PriceSet Link Lifecycle Logical Cutover

Status: selected Link lifecycle implemented under the approved shared-storage
completion goal; other physical Link consumers remain.

## Contract And Owner

The selected native `ProductVariantPriceSet` Link owns create, dismiss and
restore semantics, including its generated non-key ID and attached/detached
events. Its composite endpoint pair is the storage identity; active endpoint
cardinality is enforced by shared conditional unique claims. The generated ID
is non-unique, so event receipts count repeated IDs across distinct pairs. The core logical
row store already exposes bounded soft-delete/restore with an operation-local
lifecycle receipt. Flarex remains the only settlement and publication owner.

The preceding logical Link selection admitted only a new attach. Its event policy
refused replacement and lifecycle shapes. A focused physical fixture proved
singular endpoint conflicts, dismiss and restore without endpoint rows.
No endpoint FK or existence rule is implied by this cutover.

The first connected run exposed two owners: native restore by `price_set_id`
refused in the shared query planner because only an active-row index existed,
and create after dismiss patched the existing pair while leaving `deleted_at`
non-null. The physical relational upsert clears that timestamp on conflict.
The corrected definition supplies the missing bounded all-row selection; the
shared logical row owner now reactivates soft-deleted rows on upsert. The native
service and event receipts remain the consumer proof for both corrections.

## Connected Slice And Breaking Change

Expose selected native Link dismiss and restore commands through the existing
prepared Link service. The selected replacement witness dismisses an active
pair before creating a new ID on that pair in separate settled commands. Restore selects soft-deleted records by
`price_set_id`, so the logical definition includes an all-row lookup index beside
its native active-row unique index. Shared logical upsert now reactivates a
soft-deleted row on key conflict, matching the physical relational owner.
Validate each write's attempted row and lifecycle receipt
against its native event IDs, including unchanged restore. Use the core's
existing indexed selection, conditional claims and one publication. Do not
implement adapter SQL, a second lifecycle writer, or a generic core Link engine.

Move the focused physical cardinality/dismiss/restore witness to the logical
source, including explicit-ID replacement, rollback on conflicting restore,
replay, two-shop isolation and ordinary-role concurrent restore where applicable.
Remove the displaced physical fixture and its manifest entry in this slice.
The generalized physical Link fixture stays only for its other named Link
consumers; physical profiles and tables remain until all callers and durable
data obligations have moved. No named durable environment is reset or converted.

## Validation And Completion Gates

Run affected typechecks, source provenance guards and lint, focused PGlite and
ordinary-role PostgreSQL tests, both read-only reviews and staged lint. Verify
bounded indexed selection, exact native events, active endpoint claims, pending
reads, rollback, replay and no generated per-shop module table. Reconcile the
Link roadmap and remaining consumer inventory, then commit one coherent slice.
Broader Link modules, general cascade deletion, cross-framework references,
advanced populated-data evolution and developer APIs remain later gates.
