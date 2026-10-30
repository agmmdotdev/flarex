# Task Source And Ownership References

Status: **portable attempt-start closure promoted; remaining lifecycle graph and
connected runtime contract under refinement**. Source
identity and symbols are evidence, not runtime support. The [design](../../design-notes/task-system/README.md)
and [goal](./GOAL.md) govern use of these references.

## Adopted Engine

The frozen [Trigger source receipt](../../third_party/trigger.dev/SOURCE.json)
pins `f10bc23785e569e5d917318cf2033aabdbe96a0b`. Preserve its
[manifest](../../third_party/trigger.dev/SOURCE_SHA256SUMS), original notices and
reference island. Adopted code lives in
[`packages/trigger-run-engine`](../../packages/trigger-run-engine/README.md);
its [source map](../../packages/trigger-run-engine/trigger-source-map.json) records
the current start/snapshot/reached cap-failure closure. No runtime import may
reach the frozen workspace.
Verify the source with the repository's `trigger:source:verify` command before
promotion. Record exact promoted source/tests/dependencies and adaptations in
the admitted slice; retain original test assertions and label deliberate changes.

| Source | Mechanism to inspect |
| --- | --- |
| [RunEngine](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/index.ts) and [resources](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/systems/systems.ts) | `trigger`, initial run/snapshot construction, stalled-snapshot recovery and eager Prisma/Redis/worker wiring |
| [Enqueue](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/systems/enqueueSystem.ts) and [dequeue](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/systems/dequeueSystem.ts) | Eligibility/publication, capacity/queue ownership, `dequeueFromWorkerQueue`, locked runtime binding and pending-execution snapshot |
| [Run attempts](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/systems/runAttemptSystem.ts) and [retry selection](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/retrying.ts) | `startRunAttempt`, `completeRunAttempt`, success/failure/retry, `tryNackAndRequeue`, `cancelRun` and constructor-owned Redis/LRU product coupling |
| [Execution snapshots](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/systems/executionSnapshotSystem.ts) and [delayed runs](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/systems/delayedRunSystem.ts) | `createExecutionSnapshot`, `heartbeatRun`, `restartHeartbeatForRun`, due eligibility and reschedule/cancellation |
| [Waitpoints](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/systems/waitpointSystem.ts) and [checkpoints](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/systems/checkpointSystem.ts) | Block/resolve/continue, timeout/cancel cleanup, fan-out and checkpoint continuation; completion/failure/cancel reach this closure even when broad batches are excluded |
| [RunStore contract](../../third_party/trigger.dev/upstream/internal-packages/run-store/src/types.ts) and [PostgresRunStore](../../third_party/trigger.dev/upstream/internal-packages/run-store/src/PostgresRunStore.ts) | Semantic operation inventory and compound persistence units; Prisma client/query/result shapes are coupling to narrow, not the Flarex adapter contract |
| [Legacy query inventory](../durable-task-engine/preflight/73-trigger-source-and-run-store-query-closure.md) | Source/query evidence only; refresh actual retained closure and do not inherit former infrastructure options |

The remaining connected lifecycle dependency/test graph still needs admission.
The [portable component](./slices/02-adopted-attempt-start.md) establishes its own
bounded adopted methods and primitive-port assertions only. Replacing only the outer
constructor or RunStore misses inner construction and effects. Inspect reads
protected by the source Redis lock before inner transactions; revalidate their
snapshot/fence under the new authoritative lock. Snapshot creation emits and
schedules while a borrowed transaction can be open, and source heartbeat work
is Redis scheduling rather than durable lease renewal. Adapt these responsibilities
through same-settlement durable intents and current database-time authority.
Queue release, wait resolution and continuation need durable bounded progress;
per-page/chunk limits alone do not establish total invocation bounds.

## Original Assertion Families

Port relevant assertions into the admitted method closure; these links are not
a claim that all source suites execute through Flarex or that every Trigger
product feature is supported.

| Tests | Assertions to inspect |
| --- | --- |
| [Trigger](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/tests/trigger.test.ts) and [initial snapshot collapse](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/tests/triggerSnapshotCollapse.test.ts) | Single-run success/failure and one initial queued snapshot |
| [Attempt failures](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/tests/attemptFailures.test.ts) | Retry then success, exhausted retries and non-retriable errors |
| [Heartbeats](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/tests/heartbeats.test.ts) | Start/attempt timeout, retry after timeout and heartbeat liveness |
| [Cancellation](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/tests/cancelling.test.ts) and [delays](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/tests/delays.test.ts) | Nonexecuting/dequeued cancellation, reachable child cleanup, delay/reschedule/cancel; first-profile support remains explicit |
| [Waitpoints](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/tests/waitpoints.test.ts), [wait race](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/tests/waitpointRace.test.ts) and [checkpoints](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/tests/checkpoints.test.ts) | Failure cleanup, manual idempotency, blocker edge removal before continuation and checkpoint create/continue/failure |
| [Attempt read residency](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/tests/startRunAttemptReadResidency.test.ts) and [wait replica lag](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/tests/waitpointReplicaLag.test.ts) | Fresh owning reads and read-after-write visibility rather than stale replica/cached authority |

## Shared Database Mechanisms

The enclosing Convex checkout is pinned by the
[core source identity](../../experiments/core/REFERENCES.md#convex-source-identity)
to `84fbb0e70b4e857913673871cb847ad11a55f3d5`. Local links require that checkout;
do not silently replace the pin with current upstream. The
[Task storage source map](../../design-notes/task-system/02-logical-storage.md#convex-storage-reference)
records logical system-table persistence, due indexes and scheduler cache reuse.
Convex guides database mechanics, not replacement of Trigger's lifecycle.

The pinned [system-table bootstrap](../../../../crates/model/src/lib.rs)
uses `initialize_application_system_tables` / `initialize_application_system_table`
with system identity, shared table/index owners and idempotent index checks.
[Scheduler storage](../../../../crates/model/src/scheduled_jobs/mod.rs) inserts
system documents through its supplied transaction. The
[scheduler runner](../../../../crates/application/src/scheduled_jobs/mod.rs)
borrows/refreshes/returns database index cache and discovers due jobs through
`by_next_ts`. Reuse these ownership principles without requiring Task execution
for bootstrap or copying unbounded cross-namespace discovery into Flarex.

| Flarex source | Responsibility |
| --- | --- |
| [Candidate protocol](../../packages/flarex-protocol/src/logical-schema-candidate.ts) and [preparation](../../packages/analysis/src/logicalSchemaCandidate.ts) | Definitions, system producer representation, bounded capture and current mandatory Application-analysis binding |
| [Admission](../../packages/persistence-postgres/src/storage/catalog/logicalSchemaAdmission.ts) | Existing catalog settlement, target admission, stable identities and immutable candidates |
| [Definitions](../../packages/persistence-postgres/src/storage/catalog/logicalStorageDefinitions.ts) and [readiness](../../packages/persistence-postgres/src/storage/catalog/logicalStorageReadiness.ts) | Shared index/constraint definitions, metadata and readiness; neither source label nor candidate admission is serving authority |
| [Catalog session](../../packages/persistence-postgres/src/database/catalogControlSession.ts) and [logical source admission](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts) | Reuse authentic control settlement and current source/binding verification; no ready platform Task serving capability follows from generic owner inspection |
| [Task transaction](../../packages/persistence-postgres/src/tasks/taskPersistenceTransaction.ts), [scope admission](../../packages/persistence-postgres/src/tasks/taskSystemScopeAuthorityV1.ts) and [physical Task store](../../packages/persistence-postgres/src/tasks/taskSystemRunAttemptStoreV1.ts) | Existing deadline-owned READ COMMITTED borrowing, authoritative run/attempt checks and projection/effect correlation; derive an equivalent logical atomic operation rather than adopting aggregate callbacks |
| [Scope clock](../../packages/persistence-postgres/src/scope/scopeClock.ts) and [Commerce admission](../../packages/persistence-postgres/src/frameworks/commerceTransaction/admission.ts) | Ordinary logical writes acquire the publication clock mode before work; legacy Task clock SHARE followed by a logical writer upgrade can deadlock, so prove the complete new lock graph |
| [Cache handoff](../../packages/persistence-postgres/src/application/applicationQueryDataCache.ts), [guarded refresh](../../packages/persistence-postgres/src/application/applicationQueryCacheRefresh.ts) and [DO composition](../../apps/executor/src/applicationQueryDO.ts) | Existing bounded Application cache machinery to reuse only after Task writer/history/publication closure and profile-correct admission; current DO composition is not Task cache proof |
| [Shared schema lifecycle](../../design-notes/flarexdb-shared-schema-lifecycle.md) | Four-consumer installation/evolution ownership, platform bootstrap and consolidation limits |
| [Task logical storage](../../design-notes/task-system/02-logical-storage.md) | Private scopes, fresh Task transaction profile, atomic units, shared index/cache reuse and discovery |

Current system namespace/producer labels establish representation, not trusted
installer authority. Platform admission must retain legitimate scope/deployment
locator authority while replacing mandatory Application-analysis evidence with
an authenticated system-root contract. Carry readers/readiness/source bindings
through that change coherently; making a field optional is not the whole slice.

Short READ COMMITTED mechanics exist, but the authenticated shared logical Task
operation borrower and publication capability remain a connected core gap.
READ COMMITTED finalization cannot inherit a fixed Application snapshot merely
to reuse cache. Close every relevant writer before shared Task cache reuse.

## Baseline And Validation

The [consumer baseline](./baseline/README.md) owns executing obligations. Root
AGENTS.md and [WORKFLOW](./WORKFLOW.md) own checks/reviews. Recheck compiler,
workspace, package/source and bundle guards before actual commands. Existing core
changes belong to their current owner until a coordinated handoff; source HEAD
alone never captures the complete executing shared-worktree graph.
