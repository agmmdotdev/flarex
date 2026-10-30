# Recover a selected serving-relation repair

Status: **Independent challenge and peer exchange complete; durable obligation
and owner reuse selected; runtime unstarted**. This is the destructive or
installer-spanning continuation of the
[readiness prerequisite](./04c3a-maintained-relation-readiness.md). Ordinary
nondestructive [serving certification](./04c3a1-serving-certification.md) does
not require this lane. Replication is deferred.

## Why a durable obligation is necessary

The installation owner durably drains and rotates its job/incarnation, but
command phase/queue are process-local and a successor overwrites job identity.
Physical build progress can become enabled before new baseline activation.
Neither proves completion after a crash, especially when a selected installer
duty audits clean without rebuilding anything. Generic structure/privilege
verification alone could reopen an old, uncertified head.

Once this installer-spanning duty is selected, commit a target-local per-scope
pending baseline before its audit or destructive cleanup. Do not create such an
obligation for every ordinary concurrent deployment/audit.

## Smallest durable reference

```text
scopeId                     primary key
targetRevisionId             genuine fresh immutable target; restricting FK
expectedActivationSequence   nullable
expectedHeadSha256           nullable
```

The predecessor pair is absent together or present together. Exact tuple
equality plus the existing immutable target publication identifies the duty.
That publication/candidate supplies canonical target commitment, deployment and
reconstructable scope authority, all reauthenticated on use. Do not duplicate
job, mode, U, attempt or an activation-request digest not yet knowable.
Serving2 already records the complete authentic observed head/readiness basis.

Mark only under the actual drained maintenance owner and scope lock after
authenticating the fresh inactive target and exact current predecessor. The
same tuple replays; another tuple refuses. Prevent inactive revision/candidate
cleanup or cascading deletion from erasing a pending duty. No historical
readiness, outcome, commit-header or R03 rewrite is selected.

## Existing transaction and lifecycle owners

Reuse the actual installation owner, bounded build cleanup/backfill/semantic
validation, the existing mechanical transaction settlement lane and
`activateRelationInTransaction`. Normal serving rebuild refusal remains strict.
A narrow private maintenance-issued target/accepting-transaction facet must
authenticate the exact backend, database, scope, job generation/incarnation and
command lane. It lends no raw database or arbitrary callback to an adapter.

Keep the fold-owned prepared activation, catalog lease and exact CAS from A1.
Separate control uses its actual outer catalog transaction. Colocated control
needs one in-transaction catalog handoff, deployment before authority/clock,
without nested transactions on the same backend. PGlite uses its real owner-only
single-backend maintenance profile, never a fabricated PostgreSQL capability.

Derive the existing canonical activation request only after genuine immutable
readiness at U exists. Clear pending only in the activation transaction after
the exact canonical new **current** head, full certified root and floor match.
Existing historical activation replay alone does not inspect the current head
and cannot clear the duty.

## Crash, uncertainty and reopen

Unknown settlement leaves durable draining and closes/quarantines the
predecessor. A successor first tries exact stored activation replay before
recapturing U, rebuilding or cleaning again. Confirm both the actual current
head/root/floor and pending disposition. If absent, resume/restart through the
existing progress owner; corruption, mismatched authority or historical-only
activation leaves the duty and draining intact.

Every real reopen entrance needs a fresh/atomic no-pending predicate: the shared
PostgreSQL verification/publish owner covering verified and full-proof exports,
and PGlite initialization/reopen. A namespace also serving target data checks
its own duties. Separate control does not imply a cross-database atomic clear.

Dangling business references fail validation. Do not automatically delete
sources, invent targets, restore business rows or manufacture old facts. Actual
data disposition would require its own authority; hypothetical corrupt data
does not block the independent A1 implementation.

Required proofs cover crashes before/after cleanup, physical enablement and
activation; audit-clean obligation; same/different intent; target retention;
all reopen paths; separate and colocated control; actual PGlite ownership;
successful COMMIT with lost acknowledgement and unproven settlement; exact
current-head reconciliation and preserved historical bytes. Both database
lanes, mandatory reviews and parent cutover/commit remain required.
