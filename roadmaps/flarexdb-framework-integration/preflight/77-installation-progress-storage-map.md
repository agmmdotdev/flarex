# Installation Progress Storage And Reference Map

Status: receipt lifetime cutover implemented within approved preflight 76. This does not activate
the optimized execution path. The existing full reconstruction contract remains
until the connected progress, verification and recovery replacement is complete.

## Receipt lifetime

A completed structural step belongs to its admitted plan. Its receipt retains
the attempt and fence that actually executed it; takeover must not mint another
receipt or completion event for the same operation. A successor verifies and
reobserves the committed prefix, then continues with the next operation.

This is a clean change to internal receipt selection and relational references.
Canonical receipt fields and digests remain unchanged. Receipt identity remains
the hash of the exact completion evidence, including its producing attempt.
The unique completion coordinate changes from `(attempt_storage_id, step_id)`
to `(plan_storage_id, step_id)`. No compatibility reader or execution mode is
introduced. Existing development histories with cloned completions cannot meet
the new unique constraint; migration must refuse them atomically, never delete
history or choose a preferred duplicate. Resetting a database requires naming
its exact disposable target separately.

## Exact affected storage inventory

Names below are SQL column names. All tables have the
`fx_system_framework_migration_` prefix unless specified otherwise.

| Table | Columns and disposition |
| --- | --- |
| `step_receipt` | Retain `receipt_storage_id`, `created_transaction_id`, `collision_storage_id`, `plan_storage_id`, `attempt_storage_id`, `attempt_id`, `attempt_fence`, `step_id`, `step_sha256`, `precondition_sha256`, `postcondition_sha256`, `observed_postcondition_sha256`, `dependency_count`, `step_receipt_sha256`, `frame_format`, `frame_version`, `canonical_byte_length`, `canonical_bytes`. Change uniqueness/reference tuples below; producer identity is not rewritten. |
| `step_receipt_dependency` | Retain `receipt_storage_id`, `dependency_ordinal`, `dependency_receipt_storage_id`, `dependency_step_id`, `dependency_step_receipt_sha256`. Replace `attempt_storage_id` with `plan_storage_id`, derived from the owning receipt during migration. Both endpoints must belong to that plan. |
| `attempt_terminal` | Retain `terminal_storage_id`, `collision_storage_id`, `plan_storage_id`, `attempt_storage_id`, `admission_storage_id`, `admission_sha256`, `attempt_id`, `attempt_fence`, `outcome_kind`, `required_step_set_sha256`, `failure_reason`, `evidence_sha256`, `last_receipt_storage_id`, `last_step_receipt_sha256`, `attempt_terminal_sha256`, `frame_format`, `frame_version`, `canonical_byte_length`, `canonical_bytes`. The tail belongs to the plan, and may have been produced by an ancestor attempt. |
| `attempt_start` | Retain every column: `attempt_storage_id`, `collision_storage_id`, `plan_storage_id`, `migration_plan_sha256`, `admission_storage_id`, `admission_sha256`, `attempt_id`, `attempt_fence`, `lease_owner_id`, `lease_expires_at`, `previous_attempt_storage_id`, `previous_attempt_id`, `attempt_start_sha256`, `frame_format`, `frame_version`, `canonical_byte_length`, `canonical_bytes`. The predecessor chain and increasing fences remain takeover provenance. |
| `collision_head` | Retain existing sole mutable row and its CAS for this receipt cutover. Its complete columns are `collision_storage_id`, `current_plan_storage_id`, `current_plan_sha256`, `current_admission_storage_id`, `current_admission_sha256`, `head_revision`, `attempt_fence`, `current_attempt_storage_id`, `current_attempt_id`, `current_attempt_fence`, `current_lease_owner_id`, `current_lease_expires_at`, `last_event_storage_id`, `last_event_sequence`, `last_event_sha256`, `collision_head_sha256`, `frame_format`, `frame_version`, `canonical_byte_length`, `canonical_bytes`. Preflight 78 now extends this row with a completed position and exact receipt tail; no second head is introduced. |

Unchanged definition storage is catalogued in preflight 10: target namespace,
collision domain, physical name assignments, plan/steps/dependencies/base,
admission/assignments. Their semantic identities, foreign keys and sealed-child
rules remain required. No table is removed solely to reduce table count.

## Foreign keys and identities

All affected FKs retain RESTRICT on update and delete.

| Constraint suffix (`fx_framework_migration_`) | Before | After |
| --- | --- | --- |
| `receipt_attempt_step_unique` | `(attempt_storage_id, step_id)` | Replace with `receipt_plan_step_unique (plan_storage_id, step_id)`. |
| `receipt_source_unique` | `(receipt_storage_id, attempt_storage_id)` | `(receipt_storage_id, plan_storage_id)`. |
| `receipt_dependency_unique` | `(receipt_storage_id, attempt_storage_id, step_id, step_receipt_sha256)` | `(receipt_storage_id, plan_storage_id, step_id, step_receipt_sha256)`. |
| `receipt_terminal_unique` | `(receipt_storage_id, attempt_storage_id, step_receipt_sha256)` | `(receipt_storage_id, plan_storage_id, step_receipt_sha256)`. |
| `receipt_dependency_source_fk` | Sidecar `(receipt_storage_id, attempt_storage_id)` to receipt source tuple. | Replace attempt with plan on both sides. |
| `receipt_dependency_target_fk` | Sidecar `(dependency_receipt_storage_id, attempt_storage_id, dependency_step_id, dependency_step_receipt_sha256)` to receipt dependency tuple. | Replace attempt with plan on both sides. |
| `terminal_last_receipt_fk` | Terminal `(last_receipt_storage_id, attempt_storage_id, last_step_receipt_sha256)` to receipt terminal tuple. | Replace attempt with plan on both sides. |

Retain receipt primary key and globally unique digest. Retain its producer FK
`receipt_attempt_fk` with `(attempt_storage_id, collision_storage_id,
plan_storage_id, attempt_id, attempt_fence)`, and its exact plan-step FK with
step/precondition/postcondition digests. Keep dependency ordinal PK, target
uniqueness, non-self-reference and cardinality/canonical checks.

The event subject is a validated digest reference, not a subject FK. Existing
`stepCompleted` events continue to identify the original receipt digest. Event
sequence, previous-event FK and head event-tail FK do not change. Head
plan/admission/current-attempt FKs do not change. No table has an incoming FK to
the mutable collision-head digest: its digest is an internal CAS commitment,
not an installation identity.

Published installation references the successful terminal through
`frameworkSchema/installation/schema.ts`, including collision, plan, admission,
success kind and terminal digest. Readiness references installation; availability
history/head and binding retain their existing references. A successor terminal
may now commit the original predecessor tail, so installation restoration and
prepared runtime evidence must include every producing attempt and receipt.

## Graph policies and prepared evidence

The old additive-policy boolean was also applied by fresh binding reads. That
incorrectly imposed the additive-only two-attempt cap on fresh installation
ancestry, rejecting cold binding after two takeovers. The shared owner is now
`graphLimits.ts`, with explicit ordinary, binding and additive policies. Binding
retains its eight availability-history and 128-event ceilings. Fresh binding
ancestry is bounded by the existing 64-root preparation budget; total root, row,
name, byte and time bounds remain. Actual additive plans retain their two-attempt
limit through collision-based policy selection. Nested binding work cannot
downgrade additive policy, and read-pass keys distinguish all three policies.
This corrects the shared policy owner; no consumer bypass or deadline increase
is introduced.

Prepared installation evidence decodes all sixteen required digest sections
through one exact Schema. Empty, missing, malformed or extra sections and extra
result rows fail closed. The availability-head fingerprint uses the same digest
contract. Plan-wide receipt evidence includes original predecessor completions;
changing those bytes after preparation invalidates acceptance.

## Writers, readers and completion gates

`migrationStepReceiptRepository.ts` is the receipt/sidecar writer and exact
conflict-occupant reader. It must use the unique plan-step coordinate, retain
producer validation, and validate cross-attempt dependency references against
the exact plan/admission and predecessor lineage. Sidecars remain inserted and
validated in the root transaction before the database stamp closes the set.

`migrationAttemptTerminalRepository.ts` is the terminal writer. Its prefix is
the contiguous plan prefix produced no later than the terminal attempt's fence,
with the exact nullable tail pair. Later successor completions cannot change an
older terminal's prefix. An empty terminal must not absorb future completions.
Canonical capture and stored restoration must agree on these rules.

`freshCoordinator.ts` owns claim, takeover, execution, recovery and publication.
Takeover closes the previous attempt, starts the successor, reobserves the
authenticated prefix without DDL replay, and preserves original receipts/events.
Ordinary progress and recovery read the plan prefix at the current attempt fence.
Finalization still requires a complete authenticated prefix and catalog check.
`carryForwardPredecessorReceipts` and its receipt/event writes are retired.

`frameworkSchema/installation/runtimeEvidence.ts` must fingerprint all plan
receipts and their dependencies, including predecessor producers, within its
existing fresh-Commerce preparation contract. Runtime binding does not acquire
migration authority or adopt another freshness owner.

Tests must cover multiple takeovers including a successor that executes no new
steps, unchanged original receipt IDs/bytes/events, cross-attempt dependencies,
old terminal restoration after successor progress, wrong-plan/future-fence or
off-lineage evidence, duplicate plan-step refusal, corruption/conflict occupants,
restart, uncertain COMMIT, finalization and cold binding. Run the existing fast
PGlite functional lane and ordinary-login real PostgreSQL lane independently.

This cutover removes receipt cloning; it does not establish linear normal-run
cost. The full verifier/progress replacement and algorithmic/timing acceptance
remain preflight 76 gates. Preserve original corruption witnesses until the
explicit verification boundary replaces their detection schedule.
