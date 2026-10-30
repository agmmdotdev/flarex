# Task System

## Status And Scope

Status: **paused implementation goal; portable adopted attempt-start component
implemented; storage work checkpointed for translated-core reconciliation**.
The [independent Trigger fork design](../../design-notes/task-system/README.md)
owns architecture. The [goal](./GOAL.md) authorizes bounded implementation using
the [challenge/worker/review workflow](./WORKFLOW.md). This roadmap owns current
status and gates. The current task
implementation remains operational for admitted private consumers until cutover.
The new fork package has a portable attempt-start component. Logical Task
installation, a live core borrower, runtime migration, data reset and hosted
activation remain unimplemented.

The [revised connected slice](./slices/04-translated-core-integration.md) targets
the accepted Convex TypeScript/Drizzle rewrite, including physical persistence.
Uncommitted candidate/source/provisioning/publication experiments are preserved
as evidence; their current APIs and storage assumptions are not the target.

Start at the [source map](./REFERENCES.md), [consumer baseline](./baseline/README.md),
[decisions](./DECISIONS.md), [question queue](./OPEN-QUESTIONS.md) and
[first slice](./slices/01-source-and-installation-contract.md). Source challenge
does not itself admit a runtime contract or close the connected engine gate.

The entire [older DTE folder](../durable-task-engine/README.md) is legacy Task
initiative evidence. Do not resume its backlogs or use its approvals to extend
the custom engine. Its source inventories, behavioral witnesses and still-live
caller contracts are inputs to the replacement, verified against current code.

## Current Sources Of Truth

- [Accepted FlarexDB authority](../../design-notes/flarex-db-accepted-design.md)
  and [shared logical storage](../../design-notes/flarexdb-shared-logical-storage.md).
- [Shared schema installation/evolution](../../design-notes/flarexdb-shared-schema-lifecycle.md)
  owns common core lifecycle APIs for Application, Payload, Medusa and Tasks.
- [Engine and integration](../../design-notes/task-system/01-engine-and-integration.md),
  [logical storage](../../design-notes/task-system/02-logical-storage.md),
  [host adapters](../../design-notes/task-system/03-host-adapters.md) and
  [cutover/retirement](../../design-notes/task-system/04-cutover-and-retirement.md).
- [Pinned Trigger source](../../third_party/trigger.dev/SOURCE.json) and the
  legacy [source/query inventory](../durable-task-engine/preflight/73-trigger-source-and-run-store-query-closure.md).
- Current [custom lifecycle](../../packages/durable-task/src/runAttempt/Layers/RunAttemptLifecycleLive.ts),
  [Task store](../../packages/persistence-postgres/src/tasks/taskSystemRunAttemptStoreV1.ts),
  [physical schema](../../packages/persistence-postgres/src/database/schema/taskRuns.ts)
  and [compute contract](../../packages/durable-task/src/computeProvider/Services/TaskComputeProvider.ts).
- [Task command integration](../workflow-foundations/05-task-command-integration.md)
  and [native inline Product import](../flarexdb-framework-integration/preflight/109-native-inline-product-import-workflow.md).

## Current Architecture

The executing engine uses custom aggregate decisions and Task-specific physical
Postgres tables. Its private Application composition includes Worker Loader,
supervision, result publication and recovery. Trusted workflow continuations,
checkpoint persistence and finite commerce-child authority also exist. These
are baseline capabilities, not proof that retained Trigger methods execute
through logical Task storage. No active runtime imports the frozen Trigger island.

## Invariants And Trust Boundaries

Postgres owns durable outcomes through trusted Flarex core settlement. Task
operations use authenticated scopes, short transactions, database time, fenced
claims, stable replay identities and durable publication. Handler code, workflow
waits and remote effects never run inside a database transaction. Queue/timer
delivery is replaceable and non-authoritative. Private Task schemas cannot be
mutated by ordinary application/framework data APIs. Medusa retains native
workflow and compensation ownership.

## Decisions And Rationale

Adopt actual Trigger source once and maintain an independent fork; upstream
sync and full feature parity are not goals. Start with one new private
`@flarex/trigger-run-engine` package and adapt existing infrastructure owners.
Use Convex-style private logical system tables over shared FlarexDB physical
storage for all Task-owned state, including platform discovery and repair
metadata. The Trigger fork remains the engine. Each app/environment binds the
platform-maintained Task definitions alongside its app/framework logical data;
installation creates no dedicated Task SQL schema/table/index family. Retire
all Task-specific physical schemas after cutover.
The [shared core indexing and DO cache contract](../../design-notes/task-system/02-logical-storage.md#shared-core-indexing-and-do-cache)
is part of this destination: Task schemas declare indexes, shared core owners
maintain/query them, and eligible Task reads reuse the core cache through its
DO adapter. Integrate Task writers with shared publication/refresh. Build no
separate Task database, index engine or cache layer; Trigger remains the engine.
Task schemas use the same shared core admission, installation, migration/build,
validation, progress/recovery and activation owners as Application, Payload and
Medusa. Platform Task definitions and conversion meaning are producer-owned;
there is no Task installer or independently authoritative migration engine.
System bootstrap must not require app code analysis or the Task engine to run.
Cloudflare delivery/timer/compute adapters are first; AWS is an extension point.
Cloudflare Workflows does not become a second lifecycle owner.

## Convex Compatibility And Flarex Divergences

The [pinned storage reference](../../design-notes/task-system/02-logical-storage.md#convex-storage-reference)
traces Convex's internal job/argument tables through shared document persistence
and due-time indexes. Adopt that storage ownership model while keeping the
Trigger fork's lifecycle methods. Convex's scheduler/Workflow/Workpool are not
replacement engines. Flarex uses bounded partition discovery and repair rather
than copying an unrestricted scan of application namespaces.

Preserve server-side scheduled work, private runtime artifacts and mutation
publication semantics. The [atomic enqueue contract](../../design-notes/task-system/02-logical-storage.md#atomic-enqueue-and-external-effects)
requires business writes and their enqueue obligation to settle together;
idempotent run creation may follow from durable intent. It does not imply that
the run record shares the business transaction or that remote effects are atomic.
The native [Convex scheduler](../../../../npm-packages/convex/src/server/scheduler.ts)
distinguishes scheduled mutations and actions. Explicit durable Tasks add retry
and continuation behavior through their own definition/attempt contract; do not
change ordinary Action semantics. Flarex scope/Postgres/host boundaries and
finite framework support remain explicit divergences.

## Implemented Capabilities

The new [portable component](./slices/02-adopted-attempt-start.md) adopts actual
Trigger start/snapshot methods and their reached cap-failure closure in
[`@flarex/trigger-run-engine`](../../packages/trigger-run-engine/README.md).
It uses finite borrowed Effect primitives and tentative outcomes; no production
database/host consumes it yet. Its primitive-port tests establish source policy
and failure channels, not database settlement or runtime integration.

The operational implementation remains the legacy baseline. Its witnesses include
[connected Application Task execution](../../packages/system-test/test/integration/applicationTaskSystemConnected.test.ts),
[PostgreSQL execution](../../packages/system-test/test/integration/applicationTaskSystemConnected.postgres.test.ts)
and [workflow continuation behavior](../../packages/durable-task/test/workflow-continuation.test.ts).
The inline Product import owner records its bounded native behavior and
activation limits. Re-run relevant witnesses during migration; old receipts do
not establish replacement correctness or production support.

## Known Gaps And Limitations

The promoted source graph, finite store result/query contracts, logical schema
installation/privacy, lock graph, capacity claims, directory reconciliation,
checkpoint envelope, native failure budgets, consumer/data inventory and
performance acceptance remain open. No retained-code percentage or runtime
parity is claimed. Old logical CRUD support alone proves none of these gates.
Shared core query cache reuse and bounded DO RAM composition exist, but Task
read/write/cache integration is pending. Persistent DO SQLite caching is not
an implemented Task capability. Cache eligibility must preserve Task visibility,
fresh claims, private scope access and atomic settlement.
Shared schema lifecycle consolidation and authenticated platform installation
remain pending. The committed baseline's `system` label does not remove mandatory
Application-analysis coordinates. The preserved V3 experiment does not establish
a usable system serving capability either.
Task schema versions/lifetimes must remain independent of app code redeployment.

## Target Direction

One shared Task lifecycle serves Application, Payload and admitted Medusa
workflows. Platform-maintained logical definitions bind private Task data into
execution scopes; platform logical records discover and repair work across
those scopes. Host adapters wake and execute the retained engine. The final
installation has no custom parallel lifecycle or Task-specific physical tables.

## Next Correctness Gates

| Gate | Observable exit criterion | Status |
| --- | --- | --- |
| Source and contract admission | Exact adopted methods/tests/dependencies, private package boundaries, finite store operations, transaction/claim/visibility contract and numeric bounds are specified against current consumers | Prior-pin challenge and peer exchange complete; active-pin refresh and exact runtime contract open; execution paused |
| Logical state and discovery | Both database lanes prove private scope/platform system-table installation over shared storage, no per-app Task DDL, atomic indexed claims, directory repair, fencing and bounded progress without Task-specific physical tables | Pending |
| Shared schema lifecycle | Core APIs install/evolve Task definitions with authenticated system authority, no fabricated Application analysis, bootstrap/restart before engine execution, replay-safe progress, dependency/readiness/activation checks and no Task-specific installer | Pending |
| Shared core indexes and DO cache | Task point/range reads, index maintenance and every admitted writer use core owners; warm/cold reads, invalidation/refresh, scope isolation and DO restart preserve freshness and claim authority without a separate Task database/cache layer | Pending |
| Connected fork proof | Adopted methods execute enqueue through terminal/retry/cancel and fresh-host recovery, with required wait/resume behavior and injected hosts | Pending |
| Framework cutover | Application, Payload and a real Medusa consumer share the engine; enqueue rollback/crash/replay and native contexts/child outcomes are proven; displaced paths are removed | Pending |
| Complete retirement | Concrete development-data disposition is executed, no old lifecycle or Task-specific physical objects remain on supported installs, and guards/setup/tests match the new owner | Pending |
| Hosted admission | Actual Cloudflare delivery/timer/compute behavior and operational limits are proven before production routing; another cloud requires its own admission | Deferred |

These gates describe connected outcomes, not a requirement for one commit or
package per row. An isolated fork proof precedes caller migration; each activated
cutover includes its own cleanup. When resumed, the goal authorizes bounded runtime
work after source convergence, explicit worker scope and ownership coordination.
General advanced evolution, public/production activation and unspecified data
deletion remain outside that authorization.
