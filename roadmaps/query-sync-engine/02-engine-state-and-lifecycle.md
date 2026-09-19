# Engine State, Operations, And Lifecycle

## Status

Accepted replacement semantics under the
[design](../../design-notes/runtime-agnostic-query-sync-engine.md).
Current code still implements the former moving-latest completion and exact
publication-attempt model. This document does not relabel that implementation.
The [redesign preflight](./preflight/15-live-query-service-redesign.md) owns breaks.

## Conceptual State

Retain only state required for correctness, bounded recovery or a measured cache:
namespace/source identity and admitted progress; query definitions plus bounded
execution material; active subscriber leases; query-set and reset generations;
fixed in-progress targets; bounded result versions with dependencies/validity;
pending future work; and enough session delivery progress to reconcile or reset.

These are semantic roles, not a requirement for one SQL table per role. Exact
method counts, row layouts, attempt-history retention and storage versions are
not frozen. Business records and mutation results are not sync-owned state.

## Ordered Source Admission

The source owns epoch, committed positions, retained history and complete change
facts. For the current dense Flarex source mapping, duplicate positions are
idempotent, exact-next batches advance atomically, and gaps require replay rather
than accepting the maximum seen position. Preserve source-owned precision and
scope-lifetime numbering; an epoch reset does not restart the database counter.

A wake is a latency hint. Only correlated source evidence advances progress.
Source omission/corruption, missing history and authority replacement must be
explicit; no empty-page shortcut manufactures a clean interval. Source progress
and a session's published target are separate values.

## Fixed-Target Advancement

1. Authenticate/bind session interest and choose a fixed source target `T` not
   behind the published session position or mutation visibility floor.
2. Use bounded cached result versions valid at `T`; execute other queries at
   exactly `T` or through an equivalent certified query-set snapshot.
3. Capture complete read dependencies, definition/authority revisions and
   canonical results. External execution never holds a sync-state transaction.
4. Reconcile changes around dependency installation so no post-target change is
   missed. Atomically install fenced evidence while preserving later dirty work.
5. Build one transition for the exact session query-set/reset/auth generation,
   apply it atomically on the client, and then advance the client checkpoint.
6. Continue toward a subsequent target. New writes do not move the target that
   is currently being completed.

An evaluation at `S <= T` is reusable only if complete dependency and authority
evidence proves validity through `T`. A newer arbitrary result is not proof of
validity at `T`. An equal digest may omit value bytes, never dependency updates
or a session progress transition. Historical data validity cannot override a
newly observed authorization/code fence.

Installation must reject stale attempts after release, re-registration, reset,
query-set change or definition/authority replacement. Preserve all required
result versions, not just one latest slot. An old completion cannot clear dirty
work newer than its target. Invalidated provisional dependencies still require
complete source reconciliation; do not delete the old refresh checks before
this successor proof exists.

Target duration, evaluation work and source-history pinning are bounded. Admission
must not choose a target the source cannot honor. History expiry produces an
explicit retry/error/reset, not mixed snapshots or indefinite retention. Progress
under sustained writes is tested with fair admitted budgets and an available
source, not claimed under unlimited overload.

## Sessions, Errors And Mutation Visibility

A session owns a versioned query set in one source namespace. Result sharing is
per canonical authorized instance; removing one interest cannot remove another.
Changing membership while work runs is fenced. Slow queries may delay their own
consistent set but not other sessions; bounded failure becomes a defined error
or reset state, never an old value mislabeled as current.

Frames/checkpoints distinguish source position from session/reset generation and
query-set/authorization revision. Apply a complete transition before advancing a
checkpoint. Test duplicates, reverse delivery, missing predecessor, resume from
expired history and reset. Exact frame codecs are a later implementation contract.

Reactive mutation completion and optimistic-state removal wait for appropriate
session visibility at or beyond the committed position. Database commit does not
wait for sync, and failure to catch up after commit is not mutation rollback.
Freeze deadline/reconnect and concurrent mutation/membership behavior before SDK
cutover. No cross-source atomic snapshot is promised.

## Reconstructible Lifecycle

Leased interest keeps work active. Release is idempotent; expiry reclaims unused
queries, dependencies, executable material and results under fences. Store
arguments or an authenticated durable resolver, not only argument/access digests.
Credentials and old claims are not permanent execution permission.

The initial durable host retains enough leases/material/progress for useful
restart recovery. A reset path may reconstruct derived state and re-register
active client interest instead of recovering every abandoned evaluation/send.
It must detect generation loss, notify or reattach sessions, and reject old work.
Corruption is not fresh absence; reset needs an explicit safe state disposition.
Never delete or reset authoritative database data as part of sync recovery.

## Delivery And Backpressure

The default is recovery to a valid session state, not a lossless history of UI
results. Coalesce obsolete intermediate transitions, bound queued bytes and age,
and reset slow consumers when retention is exceeded. Versioned transitions plus
reconciliation replace mandatory scope-wide exact publication-attempt settlement.
A blocked destination or session cannot prevent unrelated sessions progressing.

Notification loss still requires a proved recovery owner. Active connections
must reconcile or be explicitly reset; a best-effort push is insufficient.
Exactly-once business effects and the database's transactional outboxes remain
separate. A selected stream adapter may have its own exact append protocol, but
that does not define the portable session contract.

## State Transactions And Effect Ownership

Retain semantic atomic operations and operation-scoped selective reads. Every
operation specifies revalidated facts, fencing/idempotency, affected state,
refusal behavior, uncertainty recovery and read/write/work bounds. Do not load
whole namespace aggregates or run whole-store integrity audits on every change.
Validate accessed rows and use storage constraints; larger audits are separately
budgeted maintenance/readiness work.

Pure policies remain plain TypeScript with typed value failures. Reusable async
orchestration follows the repository Effect guidance. Namespace/session/target
capabilities are scoped multi-instance values, not global services. Layers
construct/acquire resources; construction is not registration or semantic work.
Runners stay at real host boundaries. No transaction handle crosses an evaluator
or network call. Defects/interruption remain distinguishable from expected
codec, authority, transient, quota, history and reset outcomes.

## Required Bounds

Set explicit limits for source pages, changed keys, dependencies and canonical
bytes; active interests/queries/targets; result versions and snapshot lifetime;
evaluations and scheduling turns; per-session queues and aggregate scope work;
leases, resume age and recovery scans. Fairness applies across queries, sessions
and scopes. Report saturation and lag instead of silently dropping required work
or raising limits to make an adapter test pass.
