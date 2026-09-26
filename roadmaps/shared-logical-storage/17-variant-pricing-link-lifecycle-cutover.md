# Variant–PriceSet Link Lifecycle Logical Cutover

Status: selected Link lifecycle implemented under the approved shared-storage
completion goal. The generalized singular Link boundary now uses shared logical
storage; other named Link consumers follow their owning cutovers.

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
The generalized Link boundary has since moved to a logical source with native
create, direct upsert, dismiss, restore, event, uniqueness, replay, rollback,
two-shop and PostgreSQL contention witnesses. Its generated-table test profile
and physical event policy are retired. Other physical profiles and tables remain
only for separately named callers and durable-data obligations. No named durable
environment is reset or converted.

The generalized cutover exposed an operation-specific timestamp mismatch:
the physical native upsert kept managed `updated_at` on an existing pair, while
logical normalization advanced it. Shared logical row normalization now
preserves that timestamp for upsert conflict and still advances it for ordinary
updates and lifecycle writes. The replacement checks exact timestamp retention
and one logical row-change fact. A test-owned PostgreSQL claim witness observes
the generic unique-claim lock for both winner commit and rollback; the separate
native-host race checks one successful same-endpoint attach.

## Validation And Completion Gates

Run affected typechecks, source provenance guards and lint, focused PGlite and
ordinary-role PostgreSQL tests, both read-only reviews and staged lint. Verify
bounded indexed selection, exact native events, active endpoint claims, pending
reads, rollback, replay and no generated per-shop module table. Reconcile the
Link roadmap and remaining consumer inventory, then commit one coherent slice.
Broader Link modules, general cascade deletion, cross-framework references,
advanced populated-data evolution and developer APIs remain later gates.
