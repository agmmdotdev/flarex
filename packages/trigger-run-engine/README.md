# Flarex Trigger Run Engine

Private, independently maintained adoption of connected Trigger engine source
from `f10bc23785e569e5d917318cf2033aabdbe96a0b`. The only current export is
`@flarex/trigger-run-engine/internal/run-attempt`. It implements the portable
attempt-start component admitted by the [Task slice](../../roadmaps/task-system/slices/02-adopted-attempt-start.md).
The [full goal](../../roadmaps/task-system/GOAL.md) remains open.

## Current Component

`RunAttemptSystem.startRunAttempt` retains the source order: current snapshot
identity, run existence, finished/pending-cancel status, execution lock, next
attempt and global cap 250. A successful start requests the attempt increment,
first-execution timestamp, EXECUTING snapshot, heartbeat/snapshot notice,
optional expiry retirement and attempt-start notice in their source order.

The reached cap branch retains snapshot revalidation, wait-blocker cleanup,
permanent `CRASHED` failure, FINISHED snapshot, queue release, optional associated
waitpoint completion, failure notice and heartbeat finalization. The only
admitted failure completion is the source synthetic `TASK_RUN_CRASHED` /
`Max attempts reached.` result; broad failure/retry machinery is not exposed
through an adapter-owned policy callback.

`ExecutionSnapshotSystem.createExecutionSnapshot` retains snapshot creation,
heartbeat status dispatch, error suppression and snapshot notice order. Product
IDs, organization/environment hydration, metrics, billing, caches and unsupported
batch/Task-hierarchy branches are removed. The engine imports no frozen Trigger
package, Prisma, Redis, legacy Task decisions or host SDK.

## Borrowed Operation And Settlement

The future trusted shared-core issuer must lend one already-live, finite,
single-run operation. Its closures bind the target, run, operation identity,
claim/fence and lifetime, enforce current database predicates, decode returned
data and participate in one outer settlement. The engine's structural port and
Schema-derived DTOs do not authenticate or issue such authority. Admission of
this component is restricted to the selected unbatched single-run profile.

The engine neither opens nor settles a transaction. Database operation time is
supplied by that owner. All recorded intents are tentative durable requests;
none sends a notification, executes a handler or proves a committed release.
The integration must supply atomic state/intent persistence, stable identities,
replay, lock ordering, bounded wait cleanup and after-settlement dispatch.

Ordinary no-write validation refusals are `AttemptStartValidationError` failures.
Store failures retain their precise `StoreError`/environment, defects and
interruption; there is no generic error catch or 500 conversion. Cap exhaustion
returns `startRefusedAfterTerminalization` as successful tentative domain data.
The outer owner must confirm settlement before projecting its expected refusal.
Likewise `started` is not a launch grant or commit receipt: execution may begin
only through the trusted integration after settlement. Failure/uncertainty must
remain with that owner's rollback/outcome-recovery protocol.

Constructor configuration uses a deliberate synchronous trusted-startup Schema
decode. Operation data is already decoded and admitted by the future issuer;
the component is not an untrusted input/handler API.

## Evidence Limits And Development

Scripted primitive-port tests establish adopted branches, request ordering and
failure-channel behavior. They do not emulate or prove database transactions,
locking, authority, rollback, uncertain commits, PGlite/PostgreSQL, DO caches or
consumer execution. Those remain required shared-core/connected milestones.
This package is not a production in-memory Task backend and has no active core
borrower, installer or runtime route.

The package typecheck explicitly uses the authorized Oxc checker:

```sh
pnpm --filter @flarex/trigger-run-engine typecheck
pnpm --filter @flarex/trigger-run-engine test
```

`trigger-source-map.json` records source hashes, selected ranges, promoted files
and adaptations. Preserve its provenance, [notices](./THIRD_PARTY_NOTICES.md)
and license copies when changing adopted code. Root workspace source/bundle
guards remain responsible for dependency and frozen-island isolation.
