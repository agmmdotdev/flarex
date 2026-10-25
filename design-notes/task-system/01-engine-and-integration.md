# Task Engine And Integration

Status: **accepted design; not implemented**. The [folder index](./README.md)
owns authority; the [roadmap](../../roadmaps/task-system/README.md) owns status.

## Source Adoption

Start from the frozen [Trigger source pin](../../third_party/trigger.dev/SOURCE.json),
`f10bc23785e569e5d917318cf2033aabdbe96a0b`. Preserve the reference island and its
checksums. Copy the admitted connected source and tests into a root-owned fork;
do not mutate the reference or import it directly from runtime packages.
Preserve original licenses/notices and a source-origin/adaptation inventory.
Independent maintenance removes an upstream-sync obligation, not provenance or
license obligations. Later upstream fixes are optional inputs, never a required
release cadence.

The pinned [RunEngine constructor](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/index.ts)
and [SystemResources](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/systems/systems.ts)
combine lifecycle systems with Prisma, Redis, workers and Trigger product state.
Change these dependency owners directly. Remove excluded branches and their
construction, defaults, callbacks and imports together. Do not preserve a large
constructor using dummy dependencies or no-op implementations.

## Required Core

| Source family | Retained behavior | Necessary adaptation |
| --- | --- | --- |
| `trigger`, `enqueueSystem`, `dequeueSystem` | Run creation, eligibility, enqueue/claim orchestration and rejection branches | Trusted definition/input binding, logical claims, capacity and durable dispatch |
| `runAttemptSystem` | Start, completion, success/failure, retry/requeue, cancellation and finalization | Scoped transactions, fencing, stable receipts and durable effects |
| `retrying`, statuses and used error helpers | Attempt limits, failure/retry selection and delay algorithms | Explicit Flarex failure/compute capabilities; remove unsupported machine/product branches |
| `executionSnapshotSystem` and recovery callbacks | State/snapshot correlation, heartbeat, stalled-run recovery and restart decisions | Logical records, database time, persisted due work and bounded repair |
| `delayedRunSystem` | Delay, reschedule, due eligibility and cancellation | Logical due indexes and injected wake transport |
| Required `waitpointSystem` and `checkpointSystem` paths | Block, resolve, timeout, cancel and resume for migrating workflow consumers | Bounded native workflow checkpoint bytes, durable progress and fresh control authority |

Core support includes idempotent create, bounded execution capacity, deadline
handling and lost-response recovery. Claim reserves dispatch/capacity; the
retained start method accepts execution before handler code runs. Dispatch
redelivery is not another business attempt.

Broad batches, debounce, arbitrary concurrency-key policies, multi-queue
fairness, dashboard features, billing, warm starts and Trigger deployment
management are excluded unless a real admitted consumer requires them. Trace
reachable branches before deleting a feature: completion and cancellation can
reach waits, child propagation and delayed-work cleanup. Refuse unsupported
inputs before run creation or capacity reservation.

The legacy [source/query inventory](../../roadmaps/durable-task-engine/preflight/73-trigger-source-and-run-store-query-closure.md)
is useful source evidence. Its infrastructure-retention options and upstream
maintenance assumptions do not govern this fork. Refresh its dependency and
query inventory against the actual promoted module graph.

## What Counts As Reuse

Adapt actual methods such as `startRunAttempt`, `attemptFailed`, `cancelRun` and
`continueRunIfUnblocked`, including their connected internal calls and tests.
Changing signatures, narrowing types, deleting product branches, moving effects
after settlement and restructuring modules are legitimate fork development.

Do not route these methods back through the legacy synchronous aggregate
`decide` callback or duplicate their decisions in an adapter. Tests must execute
the adopted methods and preserve relevant original assertions. Record intentional
semantic differences; do not weaken a witness to match a new implementation.

## Package Ownership

| Owner | Target responsibility |
| --- | --- |
| New private `@flarex/trigger-run-engine` | Adopted engine and required portable helpers; finite semantic store/coordination contracts initially live here |
| Existing `@flarex/durable-task` | Legacy lifecycle during proof; retain only justified integration contracts at cutover, or migrate/delete the package if no owner remains |
| Existing `@flarex/persistence-postgres` | Logical Task store adapters and trusted transaction composition using shared core owners |
| Existing executor/backend/runtime owners | Durable delivery, authenticated definition resolution, host composition and compute adapters |
| Application/Payload/Medusa adapters | Their definitions, authorization, enqueue intent and native handler context |

Start with one new engine package. Additional packages need a stable ownership
reason, not one package per injected interface. Avoid cycles when migrating
contracts from `@flarex/durable-task`; give each contract one owner. Reconcile
existing package/source guards with the admitted fork during implementation,
without weakening their isolation or importing the frozen workspace wholesale.

## Framework And Execution Semantics

Application, Payload and Medusa use one Task lifecycle in an admitted scope.
They do not each install a scheduler or get direct Task-table writes. Keep
task definitions distinct from Application actions and preserve immutable
definition/runtime/principal binding. Do not fabricate Trigger organizations,
projects or environments or equate those identities by renaming fields.

Medusa owns workflow graphs, checkpoint codec/topology, step retries and
compensation. Trigger owns task attempts, task recovery and admitted waitpoint
orchestration. Flarex owns durable resolution, child occurrence identities,
fencing, committed receipts and event eligibility. Assign each failure,
cancellation and retry budget to one owner; restarting a task must not blindly
replay committed commerce children.

Cancellation stops ordinary business execution while admitted compensation and
event cleanup use fresh control authority. Native timeout races and exhausted
cleanup budgets need explicit outcomes; unfinished cleanup remains visibly
unresolved rather than being reported as successful cancellation.

The admitted [inline Product import](../../roadmaps/flarexdb-framework-integration/preflight/109-native-inline-product-import-workflow.md)
and [Task command integration](../../roadmaps/workflow-foundations/05-task-command-integration.md)
are concrete consumers. Migrate their continuation, timeout, cancellation and
cold-checkpoint behavior with them. Trigger process-checkpoint descriptors are
not serialized Medusa workflow state, and adopting the engine does not provide
arbitrary process suspension on Cloudflare Workers.

## Convex Developer Model

The repository's [Convex scheduler](../../../../npm-packages/convex/src/server/scheduler.ts)
is the reference for server-side scheduled invocation and cancellation. It
distinguishes retried scheduled mutations from at-most-once scheduled actions.
The Trigger-derived Task primitive deliberately adds independently bound attempts,
retry policy and workflow continuations; do not silently change Action or
mutation semantics to match Tasks. Backend analysis continues to own deployed
function metadata and managed execution artifacts stay private.
