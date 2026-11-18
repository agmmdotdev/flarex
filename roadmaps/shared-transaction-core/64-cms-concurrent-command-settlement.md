# Concurrent CMS Commands With Validated Settlement

Status: implemented for the admitted private CMS command profile.

## Outcome And Boundaries

Allow independent same-scope CMS commands to execute while another command
executes or publishes. Keep one read-committed physical transaction, one bounded
request lifetime and one final publisher. Only settlement holds the ordinary
publication lock. Native, commerce and composite writers keep their current
publication-before-business-write order; this cutover introduces no business
lock before publication and no second commit or recovery owner.

This is the CMS portion of completion-plan package 1. Native preparation,
commerce execution overlap, metadata integrity and final connected acceptance
remain explicit subsequent gates. No new framework operation is admitted.

## Selected Contract And Intentional Breaks

The bounded CMS command profile uses a repeatable in-memory working set over
read-committed statement captures. A successful command must validate every
point/absence/tombstone, complete-scan frontier and unique-slot observation at
settlement. A failed validation returns `writeConflict`; callbacks are never
automatically retried. Unread identities can first be captured after another
commit. This is not a command-start historical snapshot or native sandbox OCC.
Standalone reads retain their repeatable-read physical snapshot.

Replace the current-capture API's caller-supplied exact clock with a minimum
admitted sequence and a clock captured in the same SQL statement as its rows.
Verify row revisions do not exceed that statement's committed clock. Preserve
SQL-side identity/body limits and corruption detection. Cache observations and
pending writes; never refresh a dependency silently after a conflict.
Each point observation carries its actual statement sequence. The shared
participant validates it with the existing point validator at that sequence;
the later settlement sequence governs head integrity and materialization, not
the earlier read. Composite Application insert observations retain their
already-protected command sequence. Native snapshot/journal contracts do not change.

Unique lookup captures its owner's revision identity in the same statement.
Comparing that revision with the working set distinguishes concurrent changes
from a malformed claim against an unchanged owner document. Final slot and
point validation remains mandatory, including transient unique attempts.

## Lock And Authority Protocol

1. Before admission, acquire a transaction-scoped advisory lock derived from
   the CMS namespace, scope and exact request key. A hash collision can only
   serialize unrelated requests. It is exclusion, never identity or authority.
   Resolve the durable outcome after taking this lock, so duplicates do not
   execute callbacks. Recovery acquires the same lock and never reruns callbacks.
2. Acquire scope KEY SHARE for lifecycle protection and authenticate the
   binding. Activation, revocation, retention and generation changes still take
   scope FOR UPDATE. Ordinary NO KEY UPDATE publication may proceed.
3. Execute only admitted trusted commands, reading bounded current statements
   and recording pending changes/intents. Do not enter the materializer or take
   business/index-write locks before settlement.
4. Seal the lifetime; acquire scope NO KEY UPDATE, check the admitted epoch,
   generation, fence and retention floor, and use its fresh sequence for the
   existing materializer and dense publication. Validate the complete closure
   before business DML. Existing metadata locks/admission remain live.

The order is request exclusion, lifecycle protection, publication, business
materialization. Existing other-domain writers never acquire the CMS request
lock. Shared admission metadata locks must not conflict with ordinary writers;
strong lifecycle writers must acquire scope FOR UPDATE before changing them.

## Challenged Alternatives

Holding the old exclusive clock through callbacks preserves the bottleneck.
Removing only the reader clock check loses corruption/snapshot guarantees.
Rejecting every changed scope sequence creates false conflicts on independent
records. Repeatable-read writes conflict on the shared dense clock even when
records are independent. A second execution transaction or new durable journal
would add ownership and recovery contracts unnecessary for this trusted profile.

PostgreSQL's [lock matrix](https://www.postgresql.org/docs/18/explicit-locking.html)
permits KEY SHARE beside NO KEY UPDATE; its
[read-committed semantics](https://www.postgresql.org/docs/18/transaction-iso.html)
require fresh statement capture and final dependency validation.

## Validation, Cleanup And Completion

Use actual CMS entry points and ordinary-role PostgreSQL barriers for overlapping
independent inserts/updates, fresh unread captures, same-row/unique/scan conflicts,
duplicate exclusion, replay and cancellation. Preserve snapshot, lifecycle,
native/CMS publication, relation and Payload preference rollback/recovery proofs.
The lifecycle barrier includes two admitted commands upgrading to publication
protection while a strong revocation transition is already queued. The absence
race includes a later scan and repeated get, preserving cached absence until
conflict refusal. Actual Payload relation races cover a deleted target and a
new reference that restricts the pending target deletion.
Run equivalent sequential/fault behavior on PGlite and affected composite tests.
Remove old exact-clock capture arguments and eager materializer entry; update
blocking witnesses to distinguish request-key waits from publication waits.
Do not claim throughput improvement from barriers alone. Both reviewers,
typechecks, lint and one scoped commit are completion gates.
