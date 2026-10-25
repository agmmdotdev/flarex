# Task System

## Status And Scope

Status: **active replacement authority; design accepted; implementation pending**.
The [independent Trigger fork design](../../design-notes/task-system/README.md)
owns architecture. This roadmap owns current status and gates. The current task
implementation remains operational for admitted private consumers until cutover.
No fork package, logical Task schema, runtime migration, data reset or hosted
activation is established by these documents.

The entire [older DTE folder](../durable-task-engine/README.md) is legacy Task
initiative evidence. Do not resume its backlogs or use its approvals to extend
the custom engine. Its source inventories, behavioral witnesses and still-live
caller contracts are inputs to the replacement, verified against current code.

## Current Sources Of Truth

- [Accepted FlarexDB authority](../../design-notes/flarex-db-accepted-design.md)
  and [shared logical storage](../../design-notes/flarexdb-shared-logical-storage.md).
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
All Task-owned state, including platform discovery and repair metadata, uses
logical storage. Retire all Task-specific physical schemas after cutover.
Cloudflare delivery/timer/compute adapters are first; AWS is an extension point.
Cloudflare Workflows does not become a second lifecycle owner.

## Convex Compatibility And Flarex Divergences

Preserve server-side scheduled work, private runtime artifacts and mutation
publication semantics. The native [Convex scheduler](../../../../npm-packages/convex/src/server/scheduler.ts)
distinguishes scheduled mutations and actions. Explicit durable Tasks add retry
and continuation behavior through their own definition/attempt contract; do not
change ordinary Action semantics. Flarex scope/Postgres/host boundaries and
finite framework support remain explicit divergences.

## Implemented Capabilities

Only the legacy baseline is implemented. Existing witnesses include
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

## Target Direction

One shared Task lifecycle serves Application, Payload and admitted Medusa
workflows. Platform-maintained logical definitions bind private Task data into
execution scopes; platform logical records discover and repair work across
those scopes. Host adapters wake and execute the retained engine. The final
installation has no custom parallel lifecycle or Task-specific physical tables.

## Next Correctness Gates

| Gate | Observable exit criterion | Status |
| --- | --- | --- |
| Source and contract admission | Exact adopted methods/tests/dependencies, private package boundaries, finite store operations, transaction/claim/visibility contract and numeric bounds are specified against current consumers | Pending |
| Logical state and discovery | Both database lanes prove private scope/platform installation, atomic indexed claims, directory repair, fencing and bounded progress without Task-specific physical tables | Pending |
| Connected fork proof | Adopted methods execute enqueue through terminal/retry/cancel and fresh-host recovery, with required wait/resume behavior and injected hosts | Pending |
| Framework cutover | Application, Payload and a real Medusa consumer share the engine; enqueue rollback/crash/replay and native contexts/child outcomes are proven; displaced paths are removed | Pending |
| Complete retirement | Concrete development-data disposition is executed, no old lifecycle or Task-specific physical objects remain on supported installs, and guards/setup/tests match the new owner | Pending |
| Hosted admission | Actual Cloudflare delivery/timer/compute behavior and operational limits are proven before production routing; another cloud requires its own admission | Deferred |

These gates describe connected outcomes, not a requirement for one commit or
package per row. An isolated fork proof precedes caller migration; each activated
cutover includes its own cleanup. Future implementation needs an explicit task
scope; this documentation request authorizes no runtime changes or data deletion.
