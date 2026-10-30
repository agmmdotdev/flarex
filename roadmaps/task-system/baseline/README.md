# Task Replacement Consumer Baseline

Status: **source-grounded private consumer baseline; replacement runtime pending**.
The following executing responsibilities constrain migration. They do not make
every historical fixture a compatibility obligation or establish public,
production or arbitrary framework support. Recheck current sources at cutover;
[GOAL](../GOAL.md) owns complete retirement.

## Executing Consumers

| Area | Current owner | Obligation to preserve |
| --- | --- | --- |
| Legacy lifecycle | [Lifecycle implementation](../../../packages/durable-task/src/runAttempt/Layers/RunAttemptLifecycleLive.ts) and [retry policy](../../../packages/durable-task/src/runAttempt/Policy.ts) | Preserve intended accepted behavior and meaningful assertions while replacing the custom decisions and aggregate choreography with adopted Trigger methods |
| Application creation | [ApplicationTaskSystem](../../../packages/standard-application-invocation/src/ApplicationTaskSystem.ts), composed by [StandardApplicationTaskSystem](../../../packages/standard-application-invocation/src/StandardApplicationTaskSystem.ts) | Issue the launch principal, replay an exact accepted request before selecting latest code, validate authentic definition/runtime/scope and create through the trusted owner; replay must not rebind to a later deployment |
| Application reads/results | [Read queries](../../../packages/standard-application-invocation/src/StandardApplicationTaskReadQuery.ts) and [result query](../../../packages/standard-application-invocation/src/StandardApplicationTaskResultQuery.ts) | Migrate run/list/attempt/event surfaces and durable success/body validation; a listed reference does not acquire result or cancellation authority |
| Application cancellation/await | [Cancellation](../../../packages/standard-application-invocation/src/StandardApplicationTaskCancellation.ts) and [TaskAwait](../../../packages/application-invocation/src/TaskAwait.ts) | Preserve caller authority, typed failed/cancelled/timeout outcomes, interruption and cleanup; await lives outside the Standard package too |
| Application dispatch/compute | [Compute delivery](../../../packages/standard-application-invocation/src/ApplicationTaskComputeDelivery.ts) and [delivery event host](../../../packages/standard-application-invocation/src/ApplicationTaskDeliveryEventHost.ts) | Preserve launch-bound callbacks, duplicate delivery suppression, exact cancellation generations, stale-fence rejection, lease/max-duration behavior and uncertain/lost completion-result recovery |
| Native Product | [Inline import Task](../../../packages/medusa-adapter/src/workflows/product/import-inline-task.ts) and [workflow host](../../../packages/medusa-adapter/src/workflow/host.ts) | Migrate actual suspension, confirm/expire/cancel, heartbeat, terminal results, checkpoint hydration and fresh execution/control authority with the consumer |
| Native Fulfillment | [Delivery Task](../../../packages/medusa-adapter/src/workflows/fulfillment/delivery-task.ts) | Preserve native delivery interpretation, checkpointed children, locking/notification callback journals, cancellation compensation and callbacks observing committed state |
| Payload | [Adapter configuration](../../../packages/payload-adapter/src/configuration.ts) | Native jobs configure empty task/workflow lists. No current Payload Task producer is established; a planned producer needs a new admitted proof rather than an invented compatibility obligation |

`runTaskChild` and `runControlChild` on the native workflow host execute
idempotent committed commerce commands inside a parent Task. They do not prove
hierarchical child Task runs, batching or arbitrary Task dependency graphs.
Preserve the child-command identities/outcomes without broadening that claim.

## Decisive Existing Witness Families

| Witness | Coverage to carry to adopted methods |
| --- | --- |
| [Connected Application execution](../../../packages/system-test/test/integration/applicationTaskSystemConnected.test.ts) and [PostgreSQL lane](../../../packages/system-test/test/integration/applicationTaskSystemConnected.postgres.test.ts) | Genuine Worker query/mutation callbacks, handler retry, cancellation generation acknowledgement, max duration, stale fence/lost lease, result publication uncertainty, lost completion response and duplicate delivery/cancel races |
| [Fresh-host takeover](../../../packages/system-test/test/integration/applicationTaskSystemFreshHostTakeover.test.ts) and [PostgreSQL lane](../../../packages/system-test/test/integration/applicationTaskSystemFreshHostTakeover.postgres.test.ts) | A newly constructed host discovers expired work and recovers without treating old process state as authority |
| [Await](../../../packages/application-invocation/test/task-await.test.ts) and [list authority](../../../packages/application-invocation/test/task-list.test.ts) | Caller interruption/timeout/outcome projection and refusal to promote listed read-only references into result/cancellation authority |
| [Continuation store](../../../packages/persistence-postgres/test/tasks/trustedWorkflowContinuation.test.ts), [aggregate continuation](../../../packages/durable-task/test/workflow-continuation.test.ts) and [native durable storage](../../../packages/medusa-adapter/test/durable-native-storage.test.ts) | Atomic checkpoint/suspension, registration replay after lease retirement, one confirm/timeout/cancel winner, descriptor/revision identity and fresh-subject continuation |
| [Native Fulfillment delivery](../../../packages/medusa-adapter/test/logical-fulfillment-delivery-workflow.test.ts) | Driver-selected PGlite/PostgreSQL native delivery, cold terminal replay, cancellation/preimage compensation, changed callback owner and contention |

These are source/test obligations, not fresh validation receipts. PostgreSQL
suites can skip when their database environment is absent; collection or a
green skipped suite is not ordinary-role PostgreSQL evidence. Rehost meaningful
assertions onto adopted methods instead of preserving a harness that delegates
the new engine back to legacy `decide` functions.

## Native Wait And Authority Boundary

[Continuation persistence](../../../packages/persistence-postgres/src/tasks/trustedWorkflowContinuationStore.ts)
uses a short deadline-owned transaction to persist a prepared checkpoint and
suspend atomically. It validates the live subject/fence and exact descriptor;
registration receipt replay can survive retirement of the old lease. Winning
confirmation/expiry is durable and immutable. Resumption requires fresh charged
execution/control authority, never a lease or transaction held across a wait.

[Subject admission](../../../packages/persistence-postgres/src/tasks/trustedWorkflowExecutionSubject.ts)
checks scope, binding, principal, cancellation mode, attempt/fence, database-time
lease and duration. The current [checkpoint envelope](../../../packages/durable-task/src/runAttempt/WorkflowContinuation.ts)
limits complete encoded checkpoint bytes to 1,048,576 and binds digest/revision.
That existing limit is a consumer constraint to account for, not a proof that
every proposed logical record or combined transaction fits its budgets.

The first connected proof can use one manual/native wait with opaque native
checkpoint bytes, original wait deadline and one winning confirm/timeout/cancel
receipt. Full Product/Fulfillment graph cutover follows its own connected slice;
the initial proof must still preserve their required authority and format seams.

## Physical State And Retained Owners

The initial Task-specific SQL inventory contains **11 `pgTable` declarations**:

| Definition owner | Initial Task-specific records |
| --- | --- |
| [taskRuns.ts](../../../packages/persistence-postgres/src/database/schema/taskRuns.ts) | Seven: repair scheduler, definition revision, trusted workflow Task binding, run, run request, attempt identity and requested effect |
| [taskCompute.ts](../../../packages/persistence-postgres/src/database/schema/taskCompute.ts) | Three: compute pending, dispatch and cancellation |
| [trustedWorkflowCheckpointSchema.ts](../../../packages/persistence-postgres/src/tasks/trustedWorkflowCheckpointSchema.ts) | One: trusted workflow checkpoint |

This is a starting ownership inventory, not a complete drop list. Registration,
constraints/indexes, migrations/bootstrap/reset, callback records and callers
must be accounted for. Shared external-effect, commerce outcome/fact/event
ledgers may contain Task subjects; those rows/identities need disposition, not
blanket deletion of their shared tables.

The [Task scheduler directory](../../../packages/persistence-postgres/src/tasks/taskSystemWakeSchedulerDirectoryV1.ts),
[repair directory](../../../packages/persistence-postgres/src/tasks/taskSystemWakeSchedulerRepairDirectoryV1.ts)
and [compute delivery directory](../../../packages/persistence-postgres/src/tasks/taskComputeDeliveryControlDirectory.ts)
already use [generic replacement scope discovery](../../../packages/persistence-postgres/src/tasks/replacementScopeDirectoryDiscoveryV1.ts)
over the shared control scope directory. Do not invent a separate current Task
directory table or remove generic scope/provisioning/catalog/clock authority.

Reuse correct [deadline-owned Task transaction mechanics](../../../packages/persistence-postgres/src/tasks/taskPersistenceTransaction.ts),
immutable runtime/principal/artifact binding, core settlement/publication,
backend result/effect recovery and Worker/session compute owners. The current
[physical store](../../../packages/persistence-postgres/src/tasks/taskSystemRunAttemptStoreV1.ts)
correlates aggregate, projection, attempt identity and requested effects under
database-time checks; logical CRUD alone does not prove an equivalent atomic
authority unit. The new borrower/lock graph must be derived through the shared
logical writer, not copied wholesale from legacy scope-clock SHARE admission.

## Data And Working-Tree Boundary

No named database, schema or scope has a reset disposition yet. Pre-production
status permits clean replacement design; it does not make every accessible
store disposable. Committed child identities and external outcomes need explicit
accounting. Runtime changes in the shared core/Medusa working tree are separately
owned until a coordinated handoff, and may change this inventory before cutover.
