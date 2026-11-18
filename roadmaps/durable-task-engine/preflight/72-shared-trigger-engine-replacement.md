# Shared Trigger Engine Replacement Preflight

> **Legacy Task record - superseded direction.**
> The [Task System design](../../../design-notes/task-system/README.md) and
> [current roadmap](../../task-system/README.md) own replacement work.
> This body is historical baseline/source evidence; its statuses, approvals and
> next steps apply to the former initiative. Preserve applicable behavior and
> tests until consumer cutover. Do not use this record to extend the custom
> engine or retain Task-specific physical tables.

## Status And Scope

Status: **accepted design/admission decisions; proof gates open; implementation
not authorized**. This preflight turns the
[selected replacement direction](../../../design-notes/flarexdb-shared-task-system.md)
into a connected source, storage, consumer and retirement plan. It records no
successful replacement execution, migration, performance or deployment proof.

The outcome is one retained Trigger lifecycle serving Application, Payload and
admitted trusted workflows through Flarex logical storage and existing execution
owners. The first connected proof covers enqueue, eligibility/claim, dispatch,
start, heartbeat, completion, retry, cancellation and fresh-host recovery.
Trusted-workflow blocking, confirmation, timeout, cancellation and resume are a
connected acceptance gate wherever a migrating consumer uses them. They cannot
be left on a parallel custom lifecycle after that consumer cuts over.

This plan excludes public Trigger SDK/API parity, dashboards, arbitrary native
workflows, broad batch/fairness features without an admitted consumer, hosted
activation and automatic cross-framework atomicity. No runtime, dependency,
guard, schema or data change follows from preparing these documents.

## Authority And Source Evidence

The [accepted database design](../../../design-notes/flarex-db-accepted-design.md),
[shared logical storage](../../../design-notes/flarexdb-shared-logical-storage.md)
and [package boundaries](../../16-package-boundaries.md) govern authority and
placement. The replacement design owns the accepted architectural decisions;
this preflight records their contract and remaining proof gates. Existing DTE
records remain evidence for the custom baseline. Their inactive-only source
policy must be reconciled in an
approved admission, not bypassed by this document.

The frozen [Trigger source pin](../../../third_party/trigger.dev/SOURCE.json)
is `f10bc23785e569e5d917318cf2033aabdbe96a0b`. Preserve that reference and its
licenses. Native Medusa behavior remains owned by the
[Medusa adoption roadmap](../../flarexdb-framework-integration/06-medusa-adoption.md),
[Task command contract](../../workflow-foundations/05-task-command-integration.md)
and [inline import preflight](../../flarexdb-framework-integration/preflight/109-native-inline-product-import-workflow.md),
using the [recorded Medusa pin](../../../third_party/medusa/SOURCE.json).
[Payload admission](../../flarexdb-framework-integration/07-payload-adoption.md)
owns the new job/task adapter; its current package selects Payload 3.88.0.

### Implemented Baseline And Replacement Disposition

| Current source | Observed responsibility | Disposition |
| --- | --- | --- |
| [Lifecycle](../../../packages/durable-task/src/runAttempt/Layers/RunAttemptLifecycleLive.ts), [policy](../../../packages/durable-task/src/runAttempt/Policy.ts) | Custom run/attempt transitions, retry classification/delay and requested-effect construction. | Replace task decisions with retained Trigger methods. Preserve meaningful regression assertions. |
| [Task store contract](../../../packages/durable-task/src/runAttempt/Services/TaskSystemRunAttemptStore.ts) | Synchronous `decide` callback over a loaded aggregate. | Replace with semantic repository operations that retained async methods can use in one trusted transaction. |
| [Postgres lifecycle store](../../../packages/persistence-postgres/src/tasks/taskSystemRunAttemptStoreV1.ts) | Scope/run locks, database time, ledger correlation, version checks, atomic state/attempt/effect persistence. | Retain guarantees and existing transaction machinery; replace aggregate-specific storage and callback choreography. |
| [Task schema](../../../packages/persistence-postgres/src/database/schema/taskRuns.ts) | Physical task runs, bindings, request keys, attempt identities, requested effects and repair state. | Inventory actual records and readers; move admitted task-domain records to reserved logical schemas. Infrastructure control records need a responsibility-based disposition. |
| [ApplicationTaskSystem](../../../packages/standard-application-invocation/src/ApplicationTaskSystem.ts) | Active definition selection, principal issuance and Application run creation. | Retain Application admission above the common primitive. |
| [Trusted workflow binding](../../../packages/durable-task/src/runCreation/TrustedWorkflowBinding.ts), [creation](../../../packages/persistence-postgres/src/tasks/trustedWorkflowTaskRunCreation.ts) | Immutable scope/workflow/adapter/policy/principal identity and idempotent run creation without Application metadata. | Adapt this real consumer and preserve identity/conflict/replay meaning. |
| [Trusted execution subject](../../../packages/persistence-postgres/src/tasks/trustedWorkflowExecutionSubject.ts), [commerce commands](../../../packages/persistence-postgres/src/frameworks/atomicCommerce/commands.ts) | Authentic live-attempt authority and finite fenced commerce child, with stable occurrence identity and exact outcome recovery. | Retain authority; rebind its live checks to the new run/attempt owner. |
| [Scheduler composition](../../../packages/persistence-postgres/src/tasks/taskSystemWakeSchedulerPartitionV1.ts), [lifecycle gateway](../../../packages/persistence-postgres/src/tasks/taskAttemptLifecycleGateway.ts) | Legacy/Application due handling and callbacks into custom decisions. | Migrate actual callers with the engine; admit trusted-workflow delivery explicitly. |
| [Compute delivery](../../../packages/flarex-backend/src/taskComputeDelivery/ConnectedRunner.ts), [Worker Loader](../../../packages/flarex-backend/src/taskComputeDelivery/WorkerLoaderTaskComputeProvider.ts), [supervision](../../../packages/flarex-backend/src/taskComputeDelivery/TaskAttemptSupervisor.ts) | Bounded delivery/recovery, sandbox execution, heartbeat and session cleanup. | Reuse host mechanics and resource ownership; remove displaced task policy and rebind lifecycle operations. |
| [Payload configuration](../../../packages/payload-adapter/src/configuration.ts) | Empty admitted job task/workflow lists. | New explicit native handler admission, not an already connected producer. |

Application and trusted-workflow creation currently own separate task
transactions. The finite commerce child proves Task-to-business authority; it
does not establish business-to-Task atomic enqueue.

### Pending Trusted Workflow Changes

The working tree contains continuation work in the custom lifecycle, model,
schema and persistence projection, plus proposed files
`packages/durable-task/src/runAttempt/WorkflowContinuation.ts`,
`packages/persistence-postgres/src/tasks/trustedWorkflowCheckpoint.ts`,
`trustedWorkflowCheckpointSchema.ts`, `trustedWorkflowContinuationStore.ts` and
`trustedWorkflowCallback.ts`. It also contains native orchestration
promotion under `packages/medusa-orchestration/` and
`packages/medusa-workflows-sdk/src/durable/`, with native-runtime and continuation
tests. These paths are an overlap inventory, not an admission or validation
claim. They are intentionally not prerequisites that a clean checkout must
already contain.

Observed work adds `continuation_waiting`/`continuation_ready`, checkpoint
revision/digest references, registration/resolution receipts, confirmation,
timeout, cancellation and control-mode resume. The pending continuation store
borrows the existing Task transaction to couple checkpoint persistence and
suspension, while still calling custom lifecycle decisions. That is useful
atomicity structure, not a validated retained-engine replacement.
The workflow owner must establish
which behavior lands and which remains proposed before Gate 1. Refresh the
inventory rather than treating file presence or a test name as completion.
Preserve landed native business semantics, and replace duplicate shared task
decisions in the same consumer cutover. This planning change neither interrupts
nor absorbs another owner's uncommitted implementation.

## Accepted Fork And Package Boundary

Use one private maintained fork package,
`@flarex/trigger-run-engine`, for the connected retained implementation. Preserve
recognizable upstream engine/system paths and a file/method/test source map.
Keep its adapted `RunStore`, record types and coordination contracts with that
fork initially; split a contract package only for an actual dependency need.
The package identity is selected; creating its workspace entry and admitting
its executable dependency graph remain gated implementation work.

`@flarex/durable-task` may retain necessary host-neutral Flarex admission and
integration contracts and depend on the fork. It must lose migrated lifecycle
and retry algorithms. `@flarex/persistence-postgres` implements the fork's store
and coordination contracts using the shared logical-storage and transaction
owners. The fork imports neither persistence nor framework/runtime hosts.
Trusted composition roots bind these owners without a dependency cycle or a
universal framework dispatcher. Framework adapters retain native handler types
and execution semantics.

Promote only the required dependency closure, with original notices and
reviewable patches. Do not merge the entire upstream workspace, modify the
frozen comparison source, retain generated Prisma runtime types, or use
`@trigger.dev/core` as an unrestricted runtime dependency. Required portable
core code belongs in the recorded fork closure, with its source and license.

### Connected Source Closure

The [exact-source and RunStore query annex](./73-trigger-source-and-run-store-query-closure.md)
records the pinned method/branch closure, Q01–Q17 read shapes, connected writes,
direct-client dependencies, source limits and remaining evidence. Its static
inventory is established; executable dependency admission, finite typed store
contracts and runtime proofs remain open. In particular, `RunStore` injection
alone leaves direct control-plane Prisma reads, Redis queue authority and worker
publication outside the accepting transaction.

Engine paths in this table refer to the pinned
[`run-engine/src`](../../../third_party/trigger.dev/upstream/internal-packages/run-engine/src)
directory; `systems/` and `controlPlaneResolver.ts` are under its `engine/`
subdirectory. The store path is relative to the upstream root. Follow transitive
calls and types before promoting the selected
methods; the table is not permission to stub reachable behavior.

| Retained source/method | Required adaptation and proof |
| --- | --- |
| `engine/index.ts`: `trigger` and admitted lifecycle entry points; `systems/enqueueSystem.ts`: `enqueueRun`, `publishRun` | Retain creation/enqueue orchestration. Resolve immutable Flarex definition/principal data; make publication a settled durable intent. |
| `systems/dequeueSystem.ts`: `dequeueFromWorkerQueue`; `run-queue/index.ts` eligibility/reservation operations | Replace Redis/Lua and product-worker selection at their real seams. Preserve atomic eligibility and permit acquisition; no per-command Redis emulation. |
| `systems/runAttemptSystem.ts`: `startRunAttempt`, `completeRunAttempt`, `attemptFailed`, `tryNackAndRequeue`, `cancelRun` and reachable terminal/retry helpers | Retain task rules; borrow one authoritative context, remove root-Prisma bypasses, and persist dispatch/retry/cancellation effects atomically. |
| `systems/executionSnapshotSystem.ts`: snapshot creation, `heartbeatRun`, heartbeat expiry/restart paths | Keep ordering and stale-snapshot decisions; use database time/fences and durable heartbeat work, with delivery after commit. |
| `systems/waitpointSystem.ts`: associated-run waitpoint creation/completion required by the basic engine | Preserve lazy creation for standalone runs and eager creation for a waiting parent, plus required terminal propagation. Do not remove reachable waitpoint behavior merely to make the baseline smaller. |
| `systems/waitpointSystem.ts`: `createManualWaitpoint`, `blockRunWithWaitpoint`, `completeWaitpoint`, `continueRunIfUnblocked` and reachable helpers | Connect trusted-workflow suspension/resolution; preserve blocking/completion races and native workflow decision ownership. |
| `systems/systems.ts`, `controlPlaneResolver.ts`, store types in `internal-packages/run-store/src/types.ts` | Replace concrete Prisma/Redis/product dependencies with scoped capabilities and immutable runtime projections. No fabricated Trigger organization/project records. |

Date-time waits, checkpoints, TTL, delayed work and other systems join the
closure when reachable from the admitted path. Otherwise refuse their entry
points. Fairness algorithms may be retained with replacement snapshot inputs
when admitted; a bounded single-queue proof does not establish fair-queue,
batch, arbitrary concurrency-key or product parity.

The retained closure includes `retrying.ts`, terminal helpers and the engine's
stalled/repair callbacks. Audit feature defaults and worker jobs as well as
entry points: configured default TTL can make expiry reachable without an
explicit TTL argument; missing-version parking needs a real recovery or rejection
disposition. The full upstream constructor is not an admitted minimal runtime.

## Accepted Semantic Store And Transaction Contract

Retain useful upstream operation names/results, narrowed to actual call shapes.
Replace Prisma `where/select/include` and generated payloads with finite typed
queries and domain records. Do not build a general Prisma emulator or retain
the old aggregate as an artificial compatibility format.

Indexed discovery returns bounded pages and resumable progress. Budget exhaustion
must retain enough durable work/progress for another pass; it cannot silently
omit affected runs. Derive concrete query shapes and numeric limits from the
retained call graph and existing core limits, then prove their bounds. Arbitrary
Prisma queries and speculative broad limits are not admitted.

The source inspection identifies unbounded completion fan-out, cancellation
children, per-run blockers and snapshot waitpoint hydration. Upstream history's
50-snapshot limit and 100-waitpoint hydration chunks do not establish exhaustive
progress or a total byte bound. The annex separates those limits from current
core budgets and records the required access paths. Before store admission,
each operation needs exact result fields, indexed scope-bound predicates,
numeric input/output/write budgets and a rejection or durable-continuation
disposition. A partial blocker page cannot authorize resume.

The outer Task transaction runner acquires an authenticated scope/placement and
bounded database resource. It lends an opaque transaction-bound store to trusted
engine code, then alone commits or rolls back. Borrowed methods cannot open an
independent transaction or escape the lifetime. Framework handlers and untrusted
Workers never receive this handle. Async repository calls are allowed only for
admitted database work; remote effects and execution happen after settlement.

| Operation family | Required atomic unit and result |
| --- | --- |
| Create/replay | Request-key exclusion, immutable binding/input/principal comparison, run plus required associated waitpoint and initial due intent; return the original run or an explicit conflict. |
| Discover/claim | Bounded indexed selection is advisory; recheck eligibility, scope and capacity in the accepting transaction. Reserve capacity and fenced dispatch ownership with conditional writes and durable dispatch intent; this does not authorize handler execution. |
| Start | Validate the current dispatch reservation, advance attempt identity/ordinal, create the executing snapshot and lease, and record a stable start receipt and required heartbeat evidence together. Only this acceptance authorizes handler execution. |
| Heartbeat/expiry | Check live attempt/snapshot/fence and database time; renew or expire atomically. A stale callback cannot renew a newer attempt. |
| Complete/retry/cancel | Update run, attempt and snapshot; release/retain reservations according to admitted policy; publish ordered durable effects and stable replay evidence together. |
| Block/resolve/resume | Couple checkpoint reference, wait identity and blocked state; serialize confirmation/timeout/cancellation; publish one winning resume intent and revalidate on claim. |
| Inspect/history/result | Scope-bound bounded reads over the authoritative representation, preserving intended result/reference, cancellation and history contracts. |

Upstream `createRun` throws on idempotency-key collision; it does not supply the
accepted Flarex binding/input replay-or-conflict contract. Preserve that
responsibility at creation. Likewise, upstream `findRunOnPrimary` is not a
transaction-bound read merely because it uses a writer: every accepting path
must use the borrowed store, including retry/context and checkpoint helpers.

Use per-run serialization with the selected domain order:

```text
core authority/admission -> run -> waitpoint/checkpoint
  -> queue reservations -> child-effect records
```

Sort multiple identities within a class consistently and acquire all required
run locks before shared-resource locks. Preserve the existing scope/run/effect
relationship where those owners compose. This domain order is accepted; the
complete physical order remains a proof gate covering core index, uniqueness,
relation and publication locks, foreign-key checks and lock upgrades. Reuse the
core owner's discipline. A new scope-wide exclusive lock is not a substitute
for that proof, and a claim cannot lock queue then run while completion locks
run then queue.

For a shared waitpoint, commit the winning resolution and durable continuation
work, then process affected runs in bounded transactions. Retain Trigger's
completion-to-continuation flow rather than locking every dependent run in one
transaction. Prove that concurrent edge insertion/blocking, bounded discovery,
crashes and duplicate continuation cannot strand work or resume it twice.

Use a trusted short READ COMMITTED Task profile for retained methods requiring
fresh statement visibility. This does not replace Application OCC or select a
universal execution profile. The pinned `PostgresRunStore` deliberately checks
pending waitpoints in a separate statement after blocking to see concurrent
commits. Prove this through logical storage; reject a snapshot-only substitution.
The existing logical API provides bounded CRUD, not proof of these claims.

Keep current database-time lease checks after relevant locks, version/fence
checks at writes, rollback-only handling, interruption draining, deadline-owned
pool acquisition and uncertain-COMMIT recovery. An uncertain outcome is resolved
by its stable persisted operation identity; do not retry the whole engine
method with new identities or repeat an external effect blindly.

### Deliberate Upstream Adaptations

1. Preserve `startRunAttempt`'s attempt/snapshot atomicity. Move snapshot-emitted
   worker jobs and events into durable effects delivered after settlement.
2. Replace Redis nack-before-run-update in `tryNackAndRequeue` with one accepting
   transition plus durable delivery. Route `attemptFailed` through its borrowed
   store rather than a root client.
3. Claim reserves capacity and fenced dispatch ownership; the retained start
   method alone accepts execution before handler code runs. Adapt Flarex's
   current pre-dispatch execution grant and callback evidence to this split.
   Duplicate delivery recovers the same reservation/start receipt; takeover
   rejects obsolete dispatch identities. Resolve lost start responses by durable
   acceptance lookup, not another attempt allocation. Keep transport/dispatch
   retry accounting distinct from business attempt accounting; prove exact
   limits and transitions before admission.
4. Preserve the distinction between queue permit release and actual process
   termination. Cancellation delivery and cleanup remain runtime-owned; a permit
   release does not prove the process stopped or authorize stale writes.
5. Replace Trigger product identities with admitted Flarex projections, while
   preserving framework-specific definitions and actual durable identities.

## Reserved Logical Records And Core Admission

Trigger's process checkpoint (`type`, `location`, `imageRef`, `reason`) and the
pending native workflow checkpoint are different representations. Retain the
engine's suspend/resume decisions with an explicit native checkpoint mapping;
do not fabricate process/image fields to fit the upstream type. The mapping must
cover `continueRunIfUnblocked`'s suspended-with-checkpoint requirement as well as
atomic save/block, replay and fresh execution authority.

The selected record responsibilities are immutable definition bindings, runs, attempts,
execution snapshots, creation/completion/resolution receipts, due work,
reservations and durable requested effects. Add waitpoints and run-wait edges
where required by the retained closure. Trusted workflow checkpoints retain
revision, codec, digest, binding and run correlation. Do not copy all upstream
tables or force every record into the old aggregate JSON.

Required access paths include scoped request-key uniqueness, run identity,
run/attempt ordinal and fence uniqueness, ordered snapshot/effect sequences,
bounded due ordering, reservation ownership, waitpoint-to-run reverse traversal
and checkpoint revision comparison. The platform installs private Task schemas
through shared logical installation/readiness machinery independently of framework
configuration. Lifecycle write capabilities remain with the engine/store;
ordinary `ctx.db`, Payload or Medusa repositories cannot write these records.
Reserved naming alone is insufficient: prove private read/write policy on every
application-visible access path, including logical storage APIs.

Initially co-locate each run and its required transactional records within its
authenticated scope/placement. Cross-partition waits/dependencies require a
separately proved durable protocol. Select concrete keys, limits, indexes and
private write capability construction before implementing a store method.

Core admission must establish conditional claims/reservations, atomic multi-row
publication, required fresh-read visibility and private system-schema access.
Missing behavior belongs to the shared storage/transaction owner with a failing
witness and explicit correction scope. No adapter raw SQL, unbounded scan,
local uniqueness map, extra settlement path or fallback engine may compensate.
Existing physical Task SQL is migration evidence, not a logical-store shortcut.

Checkpoint bytes are framework state rather than task output. The accepted first
storage profile is bounded Postgres-backed logical records, settling checkpoint
revision/digest and blocked state together. Preserve the useful atomicity in the
pending borrowed checkpoint/continuation transaction while replacing its custom
lifecycle decisions and physical representation.

Measure the complete encoded record, including metadata, against the admitted
core envelope and retention policy. The pending payload cap is 1 MiB and the
current Application document semantic limit is also 1 MiB; equality of those
numbers does not prove the eventual logical Task record fits. Establish the
actual Task profile's encoding and bounds. Do not silently enlarge core limits,
truncate a checkpoint or reduce an already supported payload contract.

If required native checkpoints exceed the proved envelope, immutable object
storage requires an explicit additional admission: verified publication, atomic
reference attachment, recovery and orphan cleanup. Automatic database/object
fallback is excluded. External bytes are never part of the SQL transaction.

## Trusted Workflow And Framework Contract

Reuse trusted-workflow bindings and authentic subjects. A binding digest alone
does not grant authority: keep stored canonical binding/policy/principal checks,
live run/attempt/fence/lease checks, revocation and owned inspection results.
After resume or retry, issue fresh execution authority; never revive a suspended
subject or retain its SQL transaction/connection.

Medusa retains its native graph, checkpoint serialization, step outcome, retry,
compensation and grouped-event decisions. Trigger owns admitted run attempts,
queue policy and waitpoint blocking/unblocking. Flarex supplies durable storage,
publication, authenticated resolution and execution authority. Task attempt
recovery must resume the native checkpoint; it must not restart already committed
business work with fresh occurrence keys.

| Decision | Accepted owner | Remaining proof |
| --- | --- | --- |
| Execution loss, dispatch recovery and task-attempt policy | Retained Trigger engine | Exact failure classification and dispatch/attempt counters; a transport redelivery does not allocate a new business attempt. |
| Native step retries and compensation retries | Medusa interpreter | Preserve native retry eligibility, limits and checkpointed outcomes without multiplied retries from the outer task. |
| Durable resolution, fencing, receipts and wake delivery | Flarex persistence/execution owners | Atomic/idempotent transitions, stale-authority rejection and fresh-host recovery. |

Map each concrete failure to one responsible policy and budget before connecting
the interpreter. Task recovery resumes the checkpoint and reuses child-occurrence
identities; it does not reset native retry budgets or committed outcomes.

For the inline import, preserve the native race recorded by its owner: timeout
is eligible at `now > startedAt + timeout`; confirmation can win until an actual
timeout transition wins, including at/after the deadline. The framework owner
supplies that decision under authenticated authority. A shared waitpoint records
one resolution and one resumable state; it must not add an independent stricter
confirmation deadline. Ordinary cancellation cannot erase required compensation
or event-clear work; any admitted control resume is fenced from ordinary business
execution and has explicit retry limits. Cancellation stops ordinary business
execution while explicitly admitted compensation/event cleanup uses fresh
fenced control authority. Exhausted cleanup remains visibly unresolved; it must
not be reported as successful cancellation. Preserve that distinction in stored
outcomes and read APIs, not only logs.

Checkpoint acceptance and blocking must be atomic. Resolution must be idempotent
across lost replies, reject a mismatched wait/binding, and survive a crash before
wake delivery. Resume must correlate the winning resolution and checkpoint,
obtain a fresh fence and preserve stable run/child occurrence identities. Test
confirmation versus timeout/cancellation, duplicate resolution, interrupted save,
stale checkpoint writes and fresh-host reconstruction. Pending custom continuation
states/receipts are migration inputs; retaining a second decision engine is not
the destination.

The finite commerce child keeps its actual command/policy/argument identity,
entry and final lease checks, same-transaction effect/outcome publication and
stable occurrence key across attempts. The existing admitted occurrence bounds
and event eligibility contract remain in force unless separately changed and
proved. A resumed attempt cannot rerun an uncertain or expired child outcome
under a fresh key. Native release/clear decisions use existing event owners;
they do not create a second workflow event outbox.

Application keeps active-revision selection, analysis, immutable runtime pins,
principals and query/mutation callbacks. Payload requires a named native task
definition/handler profile and its real Local API context; its disabled jobs
configuration is not permission to expose all Payload jobs. Prove one real
Application operation, one admitted Payload operation/hook and one native Medusa
workflow through the same retained engine before claiming the shared primitive.

### Reliable Business-To-Task Enqueue

The default is task intent in the business operation's existing atomic publication,
followed by idempotent run creation with pinned definition/principal evidence.
Direct enlisted creation is permissible only if the same trusted settlement and
storage placement are proved. Cross-database placement requires durable handoff.
Use the existing commit/outbox owners, not a per-framework outbox. Prove rollback
leaves no runnable intent, commit survives a crash before dispatch, redelivery
returns the original run, and changed binding/input conflicts deterministically.
A plain after-commit callback is insufficient.

## Consumer And Data Cutover

Inventory all real callers of custom lifecycle decisions, store factories,
gateways, scheduling, compute delivery, history/results/cancellation reads and
trusted workflow children. Classify each as migrate, retain for a named durable
obligation, or delete. Recheck concurrent workflow edits before finalizing this
inventory; an Application-only cutover cannot establish shared-engine completion.

Account for run/attempt IDs, definition generations, request keys, fences,
completion and resolution receipts, pending retry/dispatch/cancellation work,
repair cursors, principal/input/result references, child outcomes, event groups,
and any landed waits/checkpoints. Prefer explicit reset for confirmed disposable
development environments, and migrate actual surviving records/obligations.
Inventory each environment and approve its exact reset or migration disposition
before any destructive operation. Agreement to this policy does not approve a
specific reset. Never infer that production-inert code has no durable data.
Preserve external identity or supply its approved mapping; migration must not
turn an already committed child into a new operation.

Switch each connected consumer's producers, callbacks and readers together.
Remove displaced decisions/policy, aggregate codecs/projections, registrations,
exports, unused dependencies, fixtures and stale source maps after their coverage
and data obligations move. Differential execution is isolated testing only;
production dual writes, old-engine fallback and duplicate wait authorities are
excluded. Any temporary retained reader/codec needs a named consumer and removal
gate. Do not drop whole packages containing still-required authority or runtime
owners merely because their task policies are replaced.

## Ordered Gates And Observable Acceptance

| Gate | Exit criteria |
| --- | --- |
| 1. Authorization and concrete admission | Design choices are accepted; obtain implementation authorization before code changes. Refresh landed trusted-workflow work and close the concrete source/query closure, physical lock graph, private schema contract, claim/start receipt mapping, checkpoint envelope/retention, failure-budget mapping and environment disposition. Record authorized core correction scope; preserve unsupported gates. |
| 2. Retained lifecycle proof | Execute actual retained Trigger creation/enqueue/claim/start/heartbeat/complete/retry/cancel methods through real Flarex logical storage and existing runtime owners. Prove atomic effects, races, stale callbacks and fresh-host recovery on both database lanes. No helper-only or custom-decider proxy counts. |
| 3. Trusted workflow proof | Execute the admitted native interpreter with atomic checkpoint/block, winning resolution, fresh resume, fenced commerce child, exact replay and native compensation/event decisions. Include every landed continuation behavior required by migrating consumers. |
| 4. Shared producers and handoff | Real Application, Payload and Medusa producers use the same engine. Prove native contexts, scope isolation, binding/principal stability and atomic business intent/recoverable enqueue. Unsupported framework features fail closed. |
| 5. Coherent cutover and retirement | Apply approved data disposition, migrate affected callers/readers, remove displaced algorithms and executable paths, reconcile admission guards/docs, complete required reviews/checks and commit the connected result. |

Gates are dependency order, not permission to leave a consumer half migrated.
An isolated proof can precede cutover, but each activated replacement includes
its consumers, regression coverage and removal obligations. No gate above has
passed for this retained-engine replacement. Acceptance of the design choices
does not mark a runtime, database or migration proof complete.

### Required Witnesses And Validation Owners

| Evidence | Required cases |
| --- | --- |
| Retained upstream implementation | Run selected assertions from `engine/systems/runAttemptSystem.test.ts`, `executionSnapshotSystem.test.ts`, `enqueueSystem.test.ts`, and `engine/tests/attemptFailures.test.ts`, `cancelling.test.ts`, `heartbeats.test.ts`, `dequeuing.test.ts` against the retained methods. Adapt construction/storage inspection, not task assertions to fit the old engine. |
| Queue/waitpoint semantics | Preserve applicable `run-queue/tests/dequeueMessageFromWorkerQueue.test.ts`, `releaseConcurrency.test.ts`, `nack.test.ts`, plus `engine/tests/waitpoints.test.ts`, `waitpointRace.test.ts` and `waitpointReplicaLag.test.ts`. Label any necessary semantic divergence with its own witness. |
| Current Flarex regressions | Migrate [lifecycle persistence races](../../../packages/persistence-postgres/test/tasks/taskSystemRunAttemptStore.postgres.test.ts), [trusted workflow creation](../../../packages/persistence-postgres/test/tasks/trustedWorkflowTask.test.ts), [subject authority](../../../packages/persistence-postgres/test/tasks/trustedWorkflowExecutionSubject.test.ts), Application callbacks and finite commerce-child/event-eligibility cases. Keep actual replay/fencing assertions. |
| PGlite | Schema/query/constraint behavior, atomic rollback, codec correlation, same-process lifecycle and consumer integration. This lane does not prove remote pool/resource bounds or real Postgres concurrency. |
| Ordinary-role Postgres | Competing claims and capacity reservations, lock order, fresh-statement waitpoint races, database-time leases after lock waits, cancellation/completion ordering, deadline/resource cleanup, uncertain commit and fresh-host recovery. Migration and plan claims require this lane independently. |
| Workflow recovery | Exact deadline and just-after-deadline resolution, confirmation/timeout/cancellation orderings, checkpoint/blocked-state atomicity, stale save rejection, control resume and compensation failure, stable child key/outcome, grouped-event release/clear and crash before wake. |
| Admission and packaging | Retained-source provenance, license notices, no active Prisma/Redis/Redlock or unintended Trigger product/supervisor dependencies, no custom-engine fallback, and executable Worker/runtime bundle checks. |

Affected package typechecks/builds/tests and the existing
`check:trigger-compatibility-boundary`, `check:durable-task-source-map`,
`check:durable-task-lifecycle-vectors` and `check:connected-runtime-source-map`
must be reconciled to the admitted replacement rather than disabled. Preserve
the frozen upstream reference checks. Use configured lint/diff/staged checks and
both required read-only project reviewers for significant implementation.
Stop owned test databases, Workers and temporary runtimes. Git owns validation
receipts; this document owns the gates, not a test log.

## Convex Compatibility And Remaining Proof Gates

The local Convex scheduling model in
[`crates/model/src/scheduled_jobs/mod.rs`](../../../../../crates/model/src/scheduled_jobs/mod.rs)
records scheduled work through its transaction. Preserve the developer-facing
expectation that accepted transactional scheduling survives commit and vanishes
on rollback where that API is admitted. Trigger's explicit task definitions,
native framework workflows and Flarex's partitioned Postgres/Cloudflare execution
are deliberate additional profiles; they do not imply full Trigger or Convex
scheduler compatibility. Backend analysis and managed artifacts remain private.

The architecture choices are accepted. The following evidence remains required;
none is implied by current file presence or by accepting this preflight.

| Remaining gate | Owner and decisive evidence |
| --- | --- |
| Source and query closure | [Annex 73](./73-trigger-source-and-run-store-query-closure.md) establishes the pinned static method/branch and Q01–Q17 query inventory. Fork/store owners must still close the adapted executable symbol/test/license graph, finite typed results, installed logical index mapping and numeric budgets; prove borrowed-store confinement, fresh visibility and bounded progress without omissions. Static inspection does not close these execution gates. |
| Physical concurrency and visibility | Shared storage/transaction owners reconcile the selected domain order with all physical locks and prove competing claim/complete/cancel/waitpoint paths plus fresh READ COMMITTED statement visibility on ordinary-role Postgres. |
| Private schema admission | Shared schema/storage owners prove platform installation/readiness, inaccessible ordinary writes, authorized reads and scope/placement isolation for all Task record access paths. |
| Claim/start mapping | Engine/runtime owners prove one accepted execution before handler code, stable reservation/start replay, stale takeover rejection, lost responses and independent dispatch/business retry accounting. |
| Checkpoint envelope and retention | Workflow/storage owners measure real native serialized checkpoints plus encoding/metadata, prove atomic save/block, CAS/replay and retention. Larger required bodies trigger explicit object-storage admission. |
| Native failure and cancellation mapping | Workflow/engine owners specify exact errors, budgets, control authority and observable unresolved cleanup; prove native timeout races, checkpoint resume, child replay and compensation/event failures. |
| Durable enqueue | Business publication/Task owners prove rollback exclusion, committed intent after crash, duplicate delivery and binding/input conflict. Direct enlisted creation needs common settlement/placement evidence. |
| Environment and removal disposition | Task/data owners inventory real records and approve each reset/migration; prove identity/outcome preservation and removal of displaced executable paths without fallback. |

These are proofs and concrete dispositions for the accepted architecture, not
authority to work around a shared-owner gap. Runtime proofs follow implementation
authorization; they are not claimed by this documentation change. Implementation
remains stopped at this documentation boundary.
