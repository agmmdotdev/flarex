# DTE01-A Receipt: Run-Attempt Lifecycle Capability Closure

## Receipt Status

**Status:** First substantial capability-closure preflight complete.

**Upstream source:** Trigger.dev commit
`f10bc23785e569e5d917318cf2033aabdbe96a0b`.

**Decision:** Continue with the complete run-attempt lifecycle as the first
medium-sized source-reuse candidate. Do not admit or copy the four candidate
files wholesale. The reusable unit is a capability assembled from selected
behaviors across those files plus the stalled-execution handler and narrow
store contracts.

This receipt completes the first DTE01-A analysis checkpoint. It does not
complete DTE01, approve a target package, define Flarex task schemas, or
authorize implementation.

## Product Outcome In Scope

The selected capability must be able to take one already-created and
already-dispatched durable run through the complete attempt lifecycle:

1. validate an expected execution version and acquire an attempt;
2. atomically advance the attempt number and enter executing state;
3. accept a success, failure, cancellation acknowledgement, or system failure;
4. decide terminal failure versus bounded retry;
5. choose immediate continuation versus durable requeue;
6. record authoritative execution evidence and requested external effects;
7. detect worker loss through bounded heartbeat or lease evidence;
8. reject stale or duplicate attempt outcomes; and
9. return the current authoritative outcome after ambiguous delivery.

This is intentionally larger than extracting status predicates or a retry
calculator. It exercises orchestration, persistence, concurrency, recovery,
queue, clock, event, and compute-policy seams together.

## Capability Boundary

### Included operations

The Trigger behavior to characterize and reuse is:

- start an attempt from the expected latest execution state;
- complete an attempt successfully;
- complete an attempt with a retryable or terminal error;
- treat a cancellation completion as cancellation;
- request cancellation and later finalize cancellation;
- handle a system failure;
- requeue after a failed start or long retry delay;
- continue immediately after a short retry delay;
- detect stale heartbeat work and convert a lost worker into a retry or
  terminal outcome;
- append and retrieve the execution evidence needed by those decisions; and
- emit normalized lifecycle effects only after authoritative state accepts the
  transition.

### Included source regions

The connected upstream regions are:

| Source | Included behavior | Initial class |
| --- | --- | --- |
| [`statuses.ts`](../../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/statuses.ts) | executing, pending-executing, finished, and initial-state predicates used by attempt and cancellation flows | `S` |
| [`retrying.ts`](../../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/retrying.ts) | cancellation recognition, error sanitization, retry eligibility, global/run limits, configured delay, immediate/queue choice, and OOM escalation decision | `S` split from `T` storage and compute seams |
| [`runAttemptSystem.ts`](../../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/systems/runAttemptSystem.ts) | `startRunAttempt`, `completeRunAttempt`, `attemptSucceeded`, `attemptFailed`, `systemFailure`, `tryNackAndRequeue`, `cancelRun`, permanent failure, terminal cleanup, and usage/error helpers only where retained | `S` orchestration split from `T` adapters and `D` product projections |
| [`executionSnapshotSystem.ts`](../../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/systems/executionSnapshotSystem.ts) | latest-state lookup, result projection, snapshot append, and heartbeat request behavior needed by the attempt lifecycle | `S` evidence semantics split from `T` persistence and wake mechanics |
| [`index.ts`](../../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/index.ts) | the `PENDING_EXECUTING`, `EXECUTING`, `EXECUTING_WITH_WAITPOINTS`, and `PENDING_CANCEL` branches of `#handleStalledSnapshot` | `S` failure/recovery policy split from `T` worker scheduling |
| [`consts.ts`](../../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/consts.ts) | the hard global attempt ceiling as compatibility evidence | `S`; Flarex policy ownership remains open |
| [`errors.ts`](../../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/errors.ts) | error-to-terminal-status decisions used by permanent failure | `S` with deliberate Flarex error and environment types |
| [`run-store/src/types.ts`](../../../third_party/trigger.dev/upstream/internal-packages/run-store/src/types.ts) | the semantics of the attempt and snapshot methods listed below | `T`; Prisma-shaped signatures are not admitted |

`S` means seam-adapted reuse and `T` means adapter translation as defined by
[DTE01](../01-source-reuse-and-package-admission.md). These are closure-level
classifications; DTE01-B must still produce the exact symbol source map.

### Explicitly excluded source regions

The first capability does not include:

- `resolveTaskRunContext` and its organization, project, environment,
  deployment, queue, task, machine, Redis-cache, and backward-compatible SDK
  payload assembly;
- metadata packet parsing and `runMetadataUpdated` projection;
- waitpoint aggregation, completed-waitpoint output hydration, checkpoint
  projection, or `getExecutionSnapshotsSince`;
- suspended-waitpoint heartbeat backoff;
- batch completion and child-run cancellation implementation;
- delayed-run implementation;
- bulk-action membership behavior;
- Trigger usage billing, price calculation, and event payload fields;
- Trigger machine-preset lookup and product-specific OOM machine naming;
- public Trigger result, SDK, realtime, and dashboard contracts; and
- Trigger's Redis cache, Redis queue, Redlock, worker catalog, and Prisma
  representations.

Where included orchestration currently calls an excluded system, the Flarex
capability may emit a typed requested effect or call a narrow later-owned port.
It must not import the excluded implementation.

## Source Identity

These hashes bind this receipt to the frozen import:

| Path | Lines | SHA-256 |
| --- | ---: | --- |
| `run-engine/src/engine/statuses.ts` | 61 | `2757dfdf5821ed862169d85b693211139cdea3b6f2032f5d89f89ad14f37551e` |
| `run-engine/src/engine/retrying.ts` | 254 | `ceccb71c6689401969f9ba6fa8f2218e853f38101ae02b015643a0181738f54a` |
| `run-engine/src/engine/systems/runAttemptSystem.ts` | 2,143 | `98071807cd629d7a93ed66883374c5c6ef8a78e8b766cd4ea0202f968f03bada` |
| `run-engine/src/engine/systems/executionSnapshotSystem.ts` | 657 | `643d183bb7c6e349dac109f33da5ddabc32f0f4807087946854f288d0714e3ed` |
| `run-engine/src/engine/index.ts` | 3,094 | `e024fd612f4078f833a892eef3fb8b3f7e6757c375503150bd94215bda2362a7` |
| `run-engine/src/engine/consts.ts` | 11 | `b8f466f2c2013b765e9bade5a507a80ace29deeb4c7f5e3d6eb39fb7a3cdf65d` |
| `run-engine/src/engine/errors.ts` | 130 | `8e276e753b42b5f114c584281af7811cc5f325f1c56c2ba333a51345aaf57ffc` |
| `run-store/src/types.ts` | 906 | `e918905f149cc35749ef51f6f55cd82d1b6b95e031cf0d7e7c11b01f66b87e1e` |

Paths in this table are relative to their imported internal package roots.
The pinned import's `SOURCE_SHA256SUMS` remains the authoritative whole-tree
receipt.

## Connected Capability Graph

```text
start attempt
  -> expected latest execution evidence
  -> run-scoped serialization/fence check
  -> attempt ceiling
  -> atomic run attempt bump + EXECUTING evidence
  -> heartbeat/lease wake request
  -> execution dispatch projection

complete attempt
  -> expected latest execution evidence
  -> success
       -> terminal run update + FINISHED evidence
       -> queue release + terminal event + parent/batch effects
  -> failure
       -> normalize error + retry policy + current run policy
       -> cancellation | permanent failure | retry
       -> retry immediately | durable requeue
       -> execution wake or terminal effects

heartbeat/lease expiry
  -> ignore stale wake when execution version changed
  -> pending execution: requeue or system failure
  -> executing: retry/fail as a lost worker
  -> pending cancellation: finalize cancellation
```

The execution dispatch projection is a consumer of accepted attempt state, not
part of the lifecycle authority. Trigger currently builds it inside
`startRunAttempt`; Flarex should keep that projection in a runtime/executor
adapter.

## Required Flarex Capability Seams

The closure needs these semantic capabilities. Names are descriptive, not
approved TypeScript APIs.

| Capability | Required semantic claim | Trigger mechanism to replace |
| --- | --- | --- |
| task scope | Every command and read is bound to one authoritative application/environment scope before run existence is disclosed. | `environmentId` filters plus organization/project/environment lookups |
| clock | Transaction time, retry eligibility, lease expiry, and event time come from an owned clock with defined authority. | `new Date()` and `Date.now()` throughout the flow |
| run transaction | A run-scoped operation can compare the expected execution version/fence and commit all authoritative state changes atomically. | Redis run lock plus `RunStore.runInTransaction` and Prisma transactions |
| run lifecycle store | Load current policy/state and commit start, success, retry, cancellation, or failure outcomes. | selected `RunStore` methods with Prisma selects/includes |
| execution evidence store | Append and read ordered execution evidence tied to the accepted transition. | execution snapshot rows and latest-by-`createdAt` reads |
| lease/fence | A worker completion proves it still owns the accepted attempt generation. | latest snapshot ID check under a Redis run lock |
| durable effects | Persist queue/wake, notification, event, parent/batch, and cleanup intentions with the transition that caused them. | direct queue calls, worker jobs, and in-process event emission |
| retry policy | Decide eligibility, delay, attempt limits, and retry delivery method from immutable inputs. | Trigger core helpers plus a run lookup inside `retrying.ts` |
| compute policy | Classify OOM and optionally select a larger compatible resource class. | Trigger machine presets and `retryOOMOnMachine` |
| error policy | Normalize foreign failures and map a terminal failure to a Flarex-owned outcome. | Trigger `TaskRunError`, sanitizers, and `runStatusFromError` |
| runtime projection | Build the executor input after attempt acquisition without giving product metadata authority to the lifecycle package. | `resolveTaskRunContext` and the latter half of `startRunAttempt` |
| observability projection | Project accepted events, logs, metrics, and traces without making delivery part of the transaction result. | `eventBus.emit`, tracing spans, and logger calls |

## Trigger Store Semantics To Preserve As Evidence

The first Flarex Task System API design must account for these observed store
operations:

| Trigger operation | Observed mutation or read | Required Flarex meaning |
| --- | --- | --- |
| `findLatestExecutionSnapshot` | latest valid snapshot, optionally environment-scoped | load current execution version within the task scope |
| `findRun` / `findRunOnPrimary` | selected retry, usage, lock, and lifecycle fields; explicit read-your-writes paths | load authoritative current lifecycle inputs, never a stale replica for a decision |
| `runInTransaction` | chooses the run's owning store and supplies one transaction-bound store/client | execute one co-located authoritative run transition |
| `startAttempt` | sets run `EXECUTING`, attempt number, first execution time, and warm-start marker | acquire the next fenced attempt |
| `createExecutionSnapshot` | appends execution evidence and its waitpoint links | append ordered evidence inside the accepted transition |
| `completeAttemptSuccess` | sets terminal success and creates the final snapshot in the same run update | commit success and terminal evidence atomically |
| `recordRetryOutcome` | updates machine and accumulated usage only | persist accepted retry policy inputs/outcome; Flarex must also make the retry transition explicit |
| `requeueRun` | sets run status to `PENDING` | make a retry durably discoverable |
| `cancelRun` | sets run status to `CANCELED`, optionally before worker cancellation is acknowledged | distinguish cancellation requested from cancellation finalized |
| `failRunPermanently` | stores terminal status, completion time, error, and usage | commit terminal failure and evidence atomically |

The Prisma `select` and `include` shapes are evidence of data dependencies, not
candidate Flarex port signatures.

## Atomicity And Ordering Findings

### Start attempt

Trigger correctly documents that the attempt-number bump and `EXECUTING`
snapshot must commit in one transaction. That invariant is retained.

The implementation also schedules heartbeat work and emits
`executionSnapshotCreated` from `createExecutionSnapshot` while it may be
running inside that database transaction. Those side effects can escape a
later rollback. Flarex must preserve the intended observable behavior through
transactional requested effects or an outbox, not preserve this placement.

### Successful completion

Trigger commits the terminal run update and final snapshot together through
`completeAttemptSuccess`, which is a useful retained invariant. Queue
acknowledgement, snapshot event emission, waitpoint completion, terminal event,
batch scheduling, and heartbeat cancellation happen afterward and are not one
durable atomic unit.

Flarex must make a repeated completion return or reconstruct the already
accepted result and must durably retain the later effects. A lost response
after the terminal commit must not turn a retrying caller into an error merely
because the expected snapshot is now finished.

### Failed completion and retry

Trigger validates the latest snapshot, clears blocking waitpoints, reads retry
policy, updates usage/machine state, emits retry events, and then either nacks
the queue message or appends an immediate-retry snapshot. These steps do not
form one persistence transaction.

The queue nack happens before `requeueRun`; a failure between them can leave
queue and database state disagreeing. This order is compatibility evidence and
a required uncertainty test, not a Flarex design to copy.

`attemptFailed` accepts a transaction argument but establishes its main
`prisma` variable from `this.$.prisma`; the passed transaction is used only by
selected nested calls. The Flarex operation must have one explicit transaction
owner and must not reproduce this ambiguous client selection.

### Cancellation

Trigger writes run status `CANCELED` before it may append a
`PENDING_CANCEL` execution snapshot and notify the worker. That is a deliberate
two-level representation, but it makes one field appear terminal before
execution has acknowledged cancellation.

The Flarex lifecycle should retain the behavioral distinction while giving it
explicit authority: cancellation request/generation, worker acknowledgement,
and terminal cancellation must be separate facts. Exact names belong to the
lifecycle roadmap, not this closure receipt.

### Permanent failure

Trigger writes the failed terminal run, then appends the `FINISHED` snapshot,
then releases the queue and emits downstream effects. A crash between those
steps can expose terminal state without matching evidence or effect delivery.
Flarex needs one terminal transition plus durable effect intents.

### Heartbeat and worker loss

Heartbeat jobs carry a snapshot ID. A job for an older snapshot becomes a
no-op, which is a useful stale-wake invariant. Worker loss is converted into a
retry/failure path, while pending cancellation is forced terminal after its
heartbeat deadline.

Snapshot ID alone is not an adequate Flarex execution fence. The accepted
operation must compare a monotonic attempt generation or fence in the same
transaction as the completion mutation.

## Hidden Authority And Portability Findings

1. **Prisma is both a driver and a type system.** Generated status enums,
   payload types, JSON types, transaction types, and select/include results
   reach all four files. These must become domain models and narrow ports; a
   Drizzle-shaped clone would repeat the coupling.
2. **Redis locking is lifecycle authority.** Per-run serialization currently
   relies on `runLock`. Flarex requires database-checked fences and cannot treat
   a process/Redis lock as proof that a completion is current.
3. **Snapshots are more than observability.** They gate stale commands and
   drive heartbeats, retries, cancellation, and runner continuation. The first
   slice therefore needs authoritative execution evidence, even if the later
   UI read model uses a different projection.
4. **The latest snapshot query is policy.** It filters `isValid` and orders by
   `createdAt`. DTE01-B must decide a deterministic Flarex sequence/version
   contract rather than inheriting timestamp ordering accidentally.
5. **Tenant checks are mixed with product projection.** Environment scoping can
   hide run existence, while organization/project/environment data also flows
   into events and runtime payloads. Flarex task scope must be an input to every
   operation; Trigger organization ownership is discarded.
6. **Retry policy performs I/O.** `retryOutcomeFromCompletion` reads the run and
   clock internally. The decision core should consume an immutable snapshot of
   retry inputs; the lifecycle operation owns the authoritative read.
7. **OOM fallback suppresses foreign failures.** `retryOOMOnMachine` catches any
   store error, logs it, and converts it to no OOM retry. Preserve this as an
   upstream behavior receipt, but decide explicitly whether Flarex treats
   storage failure as uncertainty instead of an ordinary terminal decision.
8. **Product billing is intertwined with correctness paths.** Usage duration,
   cost, machine preset, base cost, and environment type influence writes and
   events. The first Flarex capability retains optional execution-usage
   evidence, not Trigger pricing authority.
9. **External effects are not durable with their transitions.** Queue actions,
   worker jobs, events, parent waitpoints, batches, and child cancellation can
   be lost or duplicated around a database commit. Flarex needs durable effect
   intents and idempotent consumers.
10. **Public execution payload assembly is not the lifecycle domain.** The
    Redis-cached task/org/project/deployment resolution and deprecated payload
    fields should be replaced by a Flarex runtime projection after acquisition.

## Test Closure

### Direct upstream suites retained as scenario evidence

- `systems/runAttemptSystem.test.ts`: start, success, retry, cancellation,
  single-store routing, and store-boundary behavior;
- `systems/executionSnapshotSystem.test.ts`: snapshot creation and latest-read
  routing;
- `tests/attemptFailures.test.ts`: retry success, exhaustion, non-retryable
  error, OOM failure, OOM escalation, and failure after escalation;
- `retryDecisionReadAfterWrite.replicaLag.test.ts`: retry decisions must use
  authoritative lock-time policy rather than a stale replica;
- `tests/startRunAttemptReadResidency.test.ts`: a newly locked run must start
  despite replica lag;
- `tests/runAttemptSystemReplicaLag.guard.test.ts`: retry, success, failure,
  cancellation, context, and force-requeue read-your-writes guards;
- `tests/cancelling.test.ts`: executing, non-executing, dequeued, and child-run
  cancellation behavior; and
- the `PENDING_EXECUTING`, executing timeout, pending-cancel, and live
  heartbeat cases in `tests/heartbeats.test.ts`.

### Deferred upstream suites

`getSnapshotsSince` and waitpoint/suspended-heartbeat suites remain evidence
for later waitpoint, runner-resume, and observability roadmaps. Batch, debounce,
TTL, checkpoint, and public routing suites are not part of this first closure.

### Flarex scenarios that must be added

The compatibility harness must add scenarios not sufficiently proven by the
selected Trigger tests:

- duplicate start with the same expected fence;
- competing starts with the same expected fence;
- stale completion from an earlier attempt;
- duplicate identical completion after commit;
- conflicting completion after commit;
- terminal commit followed by a lost response and caller retry;
- database commit before wake/event delivery;
- durable-effect delivery before consumer acknowledgement;
- retry queue publication duplicated or delayed;
- lease expiry racing a successful completion;
- cancellation generation racing completion;
- clock skew between host and authoritative database time; and
- corrupted stored retry policy distinguished from storage unavailability.

## DTE01-A Decision

The medium capability passes the product-value and connectivity test. It is
large enough to prove a real durable lifecycle and exposes all critical
authority seams. It is also bounded: waitpoints, checkpoints, batches, delayed
runs, UI read models, public APIs, and product metadata stay outside.

The four-file copy hypothesis is rejected. The accepted source-reuse hypothesis
for DTE01-B is:

```text
Flarex run-attempt lifecycle domain
  = adapted Trigger transition/retry/recovery behavior
  + Flarex-owned scope, clock, fence, and error models
  + translated Task System API operations
  + durable requested effects
  + runtime and observability projections outside the domain
```

The next preflight checkpoint must create the exact symbol-level source map and
decide the target package/service boundary. No TypeScript package or database
schema is admitted by this receipt.
