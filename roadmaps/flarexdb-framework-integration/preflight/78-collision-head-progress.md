# Collision Head Progress

Status: implemented within approved preflight 76. This is the
durable progress invariant; ordinary execution retains full reconstruction until
the connected definition, verifier and transition replacement is complete.

## Storage and reference inventory

Extend `fx_system_framework_migration_collision_head` in place with
`completed_step_count` (nonnegative integer), `last_receipt_storage_id` (nullable
bigint), and `last_step_receipt_sha256` (nullable 32-byte digest). Zero requires
both tail fields null; positive progress requires both. Add a RESTRICT foreign
key from `(last_receipt_storage_id, current_plan_storage_id,
last_step_receipt_sha256)` to the existing receipt terminal tuple. No new head,
table, receipt identity, event identity or externally consumed identity is added.

Retain every existing head column and foreign key catalogued in preflight 77.
The existing canonical head commits the exact plan/admission and event tail;
the new operational columns are an indexed projection of the contiguous
completion events reachable from that tail for that plan. Do not create another
canonical format or digest for the same commitment. Head CAS includes the three
new columns alongside revision/digest, and validates the actual stored result.

`migrationCollisionHeadRepository.ts` remains the only head writer. Its existing
authenticated event dependencies determine progress; callers cannot supply a
count. `storedEventRestoration.ts` verifies that completion events form an exact
ordered plan prefix, refer to original receipts, and belong to the current
attempt's ancestry. A settled head has no live attempt; its exact terminal
retains the producing ancestry at the head fence. Restoration compares every
operational column with that evidence.
Events written after the selected head tail do not retroactively advance it.

Claim, renewal, takeover and publication retain progress. Admitting the next plan
resets the position to that plan's prefix; completion events for its base belong
to the base. A step's DDL, receipt, completion event and head advance remain in
one existing target transaction. Recovery restores the same durable position.
The coordinator selects and reports the head position only after checking it
against its current full receipt inventory. An unreceipted or unrecorded step
cannot silently become committed progress.

## Migration and verification

The migration derives populated heads from their reachable event chains and
exact plan-step receipt projections. It refuses duplicate, missing or reordered
completion positions. It preserves canonical bytes and all immutable history;
there is no default-zero backfill, repair path or compatibility mode. Existing
full restoration still authenticates bytes, lineage and catalog before use.

Prove fresh/partial/complete heads, plan switch, no-work takeover, stale CAS,
malformed count/tail, orphan completion, atomic rollback and uncertain COMMIT.
Run populated migration and coordinator tests on PGlite and ordinary-role native
PostgreSQL. PGlite remains functional-only; native target protection is unchanged.

This step establishes durable progress, not the later O(N + E) execution claim.
The explicit full verifier, prepared definition and direct-dependency transition
must replace the existing reconstruction together before that fast path is kept.
