# Trigger Source And RunStore Query Closure

## Status And Authority

Status: **static source/query inventory established; executable closure and store
proofs open; implementation not authorized**. This is the source/query annex to
[replacement preflight 72](./72-shared-trigger-engine-replacement.md), under its
accepted admission decisions. It does not introduce another engine design or
authorize changes to packages, guards, schemas or data.

The exact reference is Trigger commit
`f10bc23785e569e5d917318cf2033aabdbe96a0b`, recorded in
[SOURCE.json](../../../third_party/trigger.dev/SOURCE.json). The imported bytes
are enumerated by [SOURCE_SHA256SUMS](../../../third_party/trigger.dev/SOURCE_SHA256SUMS).
Preserve the [source notice](../../../third_party/trigger.dev/NOTICE.md), repository
[Apache-2.0 license](../../../third_party/trigger.dev/upstream/LICENSE), and portable
core code's [MIT license](../../../third_party/trigger.dev/upstream/packages/core/LICENSE).
This is a selective frozen import, not a claim about current upstream main.

Paths and line numbers below refer to that pin. `engine/` and `run-queue/` are
under [run-engine/src](../../../third_party/trigger.dev/upstream/internal-packages/run-engine/src);
`store/` means [run-store/src](../../../third_party/trigger.dev/upstream/internal-packages/run-store/src);
`core/` means [packages/core/src](../../../third_party/trigger.dev/upstream/packages/core/src).
These source anchors specify the existing operations and projections; proposed
logical keys below are requirements, not installed indexes or query-plan proof.

## Connected Methods And Branches

| Source anchor | Connected responsibility | Disposition for the proof |
| --- | --- | --- |
| `engine/index.ts:799` `trigger`; `systems/enqueueSystem.ts:28,135` `enqueueRun`, `publishRun` | Create run and initial snapshot, optionally associated waitpoint; then parent block, delayed scheduling or queue publication. | Retain orchestration, with binding/request-key acceptance and durable publication in the trusted settlement. Ordinary standalone trigger creates its associated waitpoint lazily; do not require an eager waitpoint for every run. |
| `systems/dequeueSystem.ts:120,828` `dequeueFromWorkerQueue`, `#getRunWithBackgroundWorkerTasks` | Queue reservation, latest snapshot, definition/version/queue resolution, run lock-to-worker write, heartbeat scheduling, recovery on failure. | Retain status/eligibility decisions and error branches. Replace product-worker inputs with admitted immutable definition/runtime projections. Claim creates dispatch ownership; start still accepts execution. |
| `systems/runAttemptSystem.ts:297,647,690,882,1187,1240,1347,1598,1756` | `startRunAttempt`, `completeRunAttempt`, `attemptSucceeded`, `attemptFailed`, `systemFailure`, `tryNackAndRequeue`, `cancelRun`, `#permanentlyFailRun`, `#finalizeRun`. | All are in the basic lifecycle closure, including terminal waitpoint propagation and heartbeat cleanup. Retaining only the public wrappers or pure retry helpers is insufficient. |
| `engine/retrying.ts:46,187`; `statuses.ts`, `errors.ts`, `consts.ts`, `machinePresets.ts` | Retry/cancel/final error selection, retry settings and OOM branch, status predicates, error mapping, attempt cap and machine lookup. | Preserve actual task policy and its witnesses. Bind machine/retry configuration to Flarex policy; machine escalation cannot be silently accepted by an incapable host. The OOM helper catches read failures and returns no retry: explicitly review that foreign-error behavior before promotion. |
| `systems/executionSnapshotSystem.ts:203,299,432,526,583,619` | Latest snapshot, snapshot history, snapshot creation, heartbeat, restart and enqueue-if-needed. | Latest/create/heartbeat are mandatory. History is conditional on the migrated observer API, but the latest snapshot's completed waitpoints are mandatory when waits are used. Remove optional direct-Prisma fallback from the active path. |
| `engine/index.ts:2530,2803`; `workerCatalog.ts` | Stalled/repair callbacks call nack/requeue, failure, continuation, heartbeat restart or cancellation according to snapshot state. | Recovery is part of the connected proof. Persist typed heartbeat/repair/cancel/continuation intents; excluding the Redis worker must not exclude its work. |
| `systems/waitpointSystem.ts:55,76,456,672,949,970,999` | Clear blockers; complete; block; continue; build, derive terminal output for, and lazily create run-associated waitpoints. | Preserve conditional winner, block/complete races, associated-run outcome and continuation. `continueRunIfUnblocked`'s `SUSPENDED` branch requires a checkpoint. |
| `systems/waitpointSystem.ts:208,303` | Date-time and manual tokens, idempotency-key rotation/upsert and timeout worker job. | Manual resolution/timeout is required for the admitted trusted workflow. Date-time waits join if a consumer uses them; the timeout job remains required even without a date-time public API. |
| `systems/checkpointSystem.ts:40,269` | `createCheckpoint`, `continueRunExecution`: suspend, checkpoint, requeue/release capacity, resume. | Include the suspend/resume decisions for workflow consumers, with an explicit checkpoint representation adaptation. Upstream `type/location/imageRef/reason` describes a process checkpoint; it is not our serialized native workflow state. |
| `systems/delayedRunSystem.ts:26,98,204,213` | Reschedule, enqueue when due, schedule and prevent delayed enqueue. | Required wherever existing scheduled Application work or an admitted engine path uses delay. Cancellation reaches prevention even if creation exposes no delay option. |
| `systems/ttlSystem.ts:25,126,146`; `engine/index.ts:2927` | Per-run expiration, scheduled expiration, batch queue expiration and default/max TTL resolution. | Conditional feature closure, including defaults: absence of an explicit TTL argument does not prove TTL is unreachable. Either include the queue-expiry callback and batch path or prove the admitted profile cannot select them. |
| `systems/dequeueSystem.ts:721`; `systems/pendingVersionSystem.ts:37` | Park a missing version; discover/promote runs on worker registration. | A missing definition/version must have an explicit terminal rejection or durable recovery disposition. Do not retain parking with a no-op pending lookup. Native Trigger deployment/ClickHouse behavior is not automatically admitted. |

The existing constructor (`engine/index.ts:138`) eagerly wires all systems,
Redis, RunQueue, Worker, batch queue, billing/cache and resolver defaults. It is
not a minimal composition root that can be copied unchanged. `SystemResources`
still carries `prisma`, `readOnlyPrisma`, `runStore`, `controlPlaneResolver`,
`worker`, `eventBus`, `runLock`, `runQueue`, tracing/metrics, race simulation and
pending-version lookup. Replace authority-bearing dependencies at this owner.

Keep batch, debounce, buffered pre-materialization cancellation, bulk actions,
dashboard/repair reports, queue administration, arbitrary concurrency keys and
multi-queue fairness outside the first profile unless a named consumer requires
them. Refuse unsupported parameters **before** run creation or reservation, and
exclude their worker callbacks/defaults as well as their public entry points.
This is the existing narrow admission applied to reachable branches, not
permission to drop behavior required by a migrating consumer. In particular:

- `trigger` reaches debounce and parent blocking; its batch branch calls
  `blockRunWithWaitpointLockless`. Single child waits cannot be removed merely
  because batch triggering is excluded.
- Terminal `#finalizeRun` schedules batch completion when `batchId` is present;
  cancellation optionally records bulk-action membership and schedules child
  cancellations. These are conditional edges, not dead methods by filename.
- `createCancelledRun` and `createFailedTaskRun` serve buffered/batch creation;
  neither belongs in the basic create path without that admitted producer.
- Native Medusa step children are finite business commands, not automatically
  nested Trigger runs. Their stable occurrence/outcome identity remains required.

## Finite RunStore Query Inventory

`store/types.ts:348` is a broad Prisma-shaped interface, not the target contract.
The table identifies call-site query shapes to narrow. Every target lookup must
also carry authenticated scope/placement; upstream global IDs and optional
`environmentId` filters do not establish Flarex authority. Lifecycle decisions
must read the accepting primary transaction, including reads currently named
`OnPrimary` that do not accept a borrowed transaction.

| ID / call sites | Existing predicate, projection and result | Required access path / bound |
| --- | --- | --- |
| Q01 run point reads: attempt `344`; dequeue `838`; retry `99,199`; waitpoint `715`; stalled `2579` | `findRun({id})`; dequeue uses `dequeueRunSelect` (`dequeueSystem.ts:42`): task/queue/version, environment/project, attempt/start/duration/retry/machine scalars. Start reads id/friendlyId/attempt/project/environment/status/lockedBy/TTL. Retry reads maxAttempts, lockedRetryConfig, usage/cost/machine; OOM omits maxAttempts. Continuation/stall currently fetch full run. | Scoped unique run ID; one row. Define finite projections for decision, retry and continuation, with bounded encoded fields. A full Prisma row is not the logical contract. |
| Q02 primary point reads: attempt `175,735,950,1408,1623` | `findRunOnPrimary`: context projection at `175` includes identity, definition/queue/principal-related context, attempt/status/retry, timing, usage/cost, trace and parent/root/batch. Usage reads select usageDurationMs/costInCents/machinePreset. Retry/final-state probe selects status/span/maxAttempts/event-store/timestamps. | Same key; one row. Context construction must use authentic immutable Flarex projections; no replica or separate root read inside a borrowed transaction. |
| Q03 latest snapshot: snapshot `203`; store `1710` | `findLatestExecutionSnapshot`: `runId`, `isValid:true`, optional environment; `createdAt desc`, first row; includes checkpoint and **all** completed waitpoints. Dedicated store hydrates links then waitpoint bodies (`1748`). | Scoped run + valid snapshot ordering. Single snapshot does not bound relation rows/bytes. Use a deterministic sequence/tie rule consistent with accepted ordered snapshots; source ordering alone has no tie-breaker. |
| Q04 snapshot history: snapshot `299–428` | `findExecutionSnapshot` gets cursor snapshot by `{id,runId,environment?}` selecting createdAt; `findManyExecutionSnapshots` gets later valid snapshots by `createdAt > cursor.createdAt`, descending, `take:50`, checkpoint included; reverse result. Only latest returned snapshot receives completed waitpoint bodies. | Scoped run + snapshot order; retain result meaning for admitted observer. The source returns newest 50, not a lossless history cursor. Prove tie and >50-transition behavior; do not reuse as exhaustive lifecycle-event history. |
| Q05 snapshot waitpoint hydration: snapshot `126,147,175` | `findSnapshotCompletedWaitpointIds`, `findSnapshotCompletedWaitpointIdsWithPresence`, then `findManyWaitpoints` by ID chunks of **100**. Presence distinguishes absent snapshot from an empty relation; history repairs missing/stale joins via primary. Accumulates all bodies. | Scoped snapshot-to-waitpoint links and waitpoint IDs; bound total IDs and bytes, not only each chunk. Preserve ordering/duplicate occurrence meaning from `completedWaitpointOrder`; missing cannot mean completed. |
| Q06 token replay: waitpoint `233,337` | `findWaitpoint({environmentId,idempotencyKey})`, optional co-located run; returns full token; expiry causes rotation then upsert. | Scoped request/token key uniqueness and one row; use writer consistency. Environment/user key alone must not override binding/input conflict rules. |
| Q07 winning completion: waitpoint `93,104,131` | `forWaitpointCompletion(id,{routeKind:"MANUAL"})`; conditional update `{id,status:"PENDING"}` sets completedAt/output/type/error; then `findWaitpointOnPrimary({id})`. Update count distinguishes winner; output read must be winning stored output. | Scoped waitpoint ID; one winner + durable continuation work in one accepting transaction. A routing hint supplies no authorization. Duplicate callbacks return the stored resolution, not a second publication. |
| Q08 completion fan-out: waitpoint `151` | `findManyTaskRunWaitpoints({waitpointId}, select:{taskRunId,spanIdToComplete,createdAt})` on primary; **no take/order/cursor**. Enqueues each continuation, then optional cached-run event. | Reverse edge index `(scope,waitpointId,stable edge order)`; paged IDs/metadata and durable progress. Edge insertion concurrent with completion needs a block-side recheck/continuation witness. |
| Q09 run blockers: waitpoint `685,929`; `55` | By taskRunId, selects edge id/batch/index and waitpoint id/status/type/completedAfter; **no bound**. Continuation deletes only captured edge IDs; clear deletes all edges by taskRunId. | `(scope,runId,edge identity)` plus unique run/wait occurrence. Complete blocker truth must be known before unblocking. Do not check only one page or delete newly inserted edges. Bound admitted blocker set, or prove a durable complete-set algorithm. |
| Q10 blocking race: waitpoint `496,509`; store `2022,2107` | `blockRunWithWaitpointEdges` inserts edges and connected-run links from ID array with conflict-ignore. `countPendingWaitpoints(ids,writer,runId)` is a **separate READ COMMITTED statement**; returns count of PENDING tokens. | Bounded authenticated/co-located ID set, unique edge keys, fresh statement visibility. Validate every referenced token; absence must not reduce pending count into a false success. Preserve both edge discovery and post-insert check. |
| Q11 associated-run waitpoint: waitpoint `1009,1028,1049` | Run by ID with associatedWaitpoint; re-read under run lock; create lazily with `completedByTaskRunId`. Terminal run output becomes completed waitpoint output. | Scoped run-to-associated-token uniqueness; one optional token. Creation/completion and replay must not produce two tokens or lose a terminal outcome. |
| Q12 cancellation child discovery: attempt `1433,1580` | `cancelRun` returns id/state/timing/event/parent/delay/environment plus associated waitpoint id and `childRuns:{id}`; all children, no page bound. | `(scope,parentRunId,child identity)`; split mutation receipt from bounded child cancellation work. Publication/progress and concurrent child admission must prevent missed children. Permit release is not termination. |
| Q13 delayed/expiry point access: delayed `115`; TTL `36,64` | Full run by ID; expire result includes identity/status/timestamps/TTL/span/parent/environment/associated waitpoint. | Scoped run ID; fresh locked due/status/fence checks plus durable next work. Due discovery belongs to coordination, not these point queries. |
| Q14 batch TTL, if reachable: TTL `161,222` | `findRuns({id in runIds})` primary, selects state/lockedAt/TTL/associated waitpoint and event identities; filters PENDING and unlocked in JS, then `expireRunsBatch(ids)`. No call-site ID cap. | Bounded candidate IDs, conditional acceptance recheck against dispatch/lock race, atomic outcome + effect intent per admitted unit. Array input alone is not a bound. |
| Q15 pending versions, if retained: pending `37–147` | Worker/environment/tasks/queues via direct Prisma; injected lookup limit `(configured batch size ?? 200)+1`; `findRuns({id in candidates,status:PENDING_VERSION},createdAt asc)`; `promotePendingVersionRuns`, then `findRunOrThrow` in store transaction. | Scoped definition/version pending index and durable cursor if supported. Default no-op lookup and best-effort external discovery do not prove absence or eventual recovery. |
| Q16 concurrency sweep, if retained: engine `2952` | IDs from queue, completedAt <= cutoff, organizationId non-null, final status set; selects id/status/organizationId; default store reader. | Bounded authoritative reconciliation of reservation owner/fence and terminal state. No replica-negative evidence may release a live reservation. Redis repair discovery is not durable inventory. |
| Q17 optional waitpoint inspection: engine `1946` | Token by ID with blockingTaskRuns -> taskRun id/friendlyId; unbounded include. | A private bounded reverse-edge page, if an actual consumer requires this API. Do not promote the unrestricted inspection endpoint with the lifecycle. |

### Write And Result Closure

These write families complete Q01–Q17; adapting read predicates alone is not a
RunStore closure. Preserve returned identities, status, attempt ordinal,
snapshot/associated waitpoint correlation and replay semantics while dropping
only fields belonging to explicitly excluded product consumers.

| Existing methods / source | Atomic logical responsibility and finite result |
| --- | --- |
| `createRun` (`index.ts:962`, store `676`) | Run + initial snapshot + conditional associated waitpoint, immutable binding/input/request-key acceptance and initial durable intent. Source duplicate-key translation throws; it does **not** implement Flarex's exact replay-or-conflict comparison. Return accepted/replayed run identity and required creation projection. |
| `lockRunToWorker` (dequeue `436`, store `1161`) | Definition/queue/retry/machine lock fields + pending-execution snapshot and completed-waitpoint links. Adapt to claim/reservation/dispatch receipt; do not allocate a business attempt here. Source returns full TaskRun; narrow to actual dispatch needs. |
| `runInTransaction`, `startAttempt` (attempt `410,411`) | Increment attempt and create EXECUTING snapshot in one unit; source result includes payload/metadata, context, usage, parent/batch and event fields. Return authentic execution input + stable start receipt; heartbeat/effect rows settle with it. |
| `completeAttemptSuccess` (attempt `760`, store `834`) | Successful output/status/timestamps/usage plus FINISHED snapshot; result includes associated waitpoint ID and event/parent fields. Couple reservation release, outcome and terminal propagation intents at the outer settlement. |
| `recordRetryOutcome`, `requeueRun` (attempt `1030,1292`) | Retry usage/machine update; status reset and subsequent snapshot/queue work. Narrow retry projection and `{id,status,attemptNumber}` requeue result. Persist future eligibility and delivery intent with acceptance. |
| `cancelRun`, `failRunPermanently` (attempt `1433,1649`) | Terminal/pending-cancel state, error/timing/usage, followed by snapshot and downstream effects. Return stable outcome and optional associated token, with child discovery separately bounded (Q12). `recordBulkActionMembership` (`1378`) is conditional on admitted bulk actions. |
| `createExecutionSnapshot` (snapshot `432`, store `1827`) | Snapshot, completed-waitpoint links/order, checkpoint reference and prior snapshot correlation. Source worker/event side effects are outside its database write; move required work to durable intents. |
| `upsertWaitpoint`, `updateWaitpoint`, `createWaitpoint`, `updateManyWaitpoints`, `blockRunWithWaitpointEdges`, `deleteManyTaskRunWaitpoints` | Token replay/rotation, lazy associated token, conditional resolution, blocker insertion/removal. Their complete predicates/results are Q06–Q11. Rotation/upsert must share authoritative uniqueness handling; a stale probe is insufficient. |
| `suspendForCheckpoint`, `createTaskRunCheckpoint`, `resumeFromCheckpoint` (checkpoint `123,174,317`) | Source suspend returns full run; checkpoint returns its record; resume selects id/state/attempt/environment/project/org/timing/tags/batch. Target must atomically save bounded native checkpoint + blocked state + registration receipt, and later resume under fresh authority. Keep revision/digest/codec/binding correlation; do not store native state in a fabricated imageRef. |
| `rescheduleRun`, `enqueueDelayedRun`; conditional `expireRun`, `expireRunsBatch`, `parkPendingVersion`, `promotePendingVersionRuns` | Delayed/due/expiry or version transition with snapshot where required and durable scheduling/publication. Do not preserve root-client writes followed by independently committed work as the target transaction contract. |

Other RunStore methods (generic finalize, metadata/tags/streams, batch records,
arbitrary findRuns/findRunsByIds/idempotency-key presenters and tag APIs) are not
automatically admitted by the interface. The active dependency scan must show
each is unreachable or separately inventoried. Snapshot-presence helpers and
waitpoint routing helpers used by the upstream dual-database router are evidence
for absence/consistency behavior; initial co-location does not require importing
that router or its legacy/dedicated schema hydrators.

## Dependencies Outside RunStore

| Existing source/dependency | Required disposition |
| --- | --- |
| `controlPlaneResolver.ts`: resolveEnv, resolveAuthenticatedEnv, resolveWorkerVersion, assertEnvExists | Replace with scope/definition/principal/runtime projections. Current rich environment includes API key and product/member data; these must not be reconstructed or exposed merely to satisfy upstream types. |
| Attempt context helpers `runAttemptSystem.ts:1765–2009` | Direct cached replica reads of backgroundWorkerTask, organization, runtimeEnvironment/project, taskQueue and deployment/worker. Resolver injection alone does not remove these dependencies. Include context construction in the cutover. |
| Dequeue diagnostic `dequeueSystem.ts:925` and pending-version worker query | Direct Prisma lookup survives resolver use. Replace diagnostic/version policy at its real owner or reject the unsupported branch explicitly. |
| `run-queue/index.ts`: enqueue, dequeue, acknowledge, nack, releaseAllConcurrency; Lua command registration; `keyProducer.ts`, `fairQueueSelectionStrategy.ts` | Queue eligibility/capacity and recovery are Redis authority today. Replace with database claims/reservations and durable due work; inventory selected fast-path, retry and repair branches. Fairness/seedrandom is conditional. No per-Lua-command CRUD translation. |
| `locking.ts`; Redis/Redlock; `workerCatalog.ts`, `ttlWorkerCatalog.ts`; Redis Worker | Database lock/fence discipline and durable typed work replace leases/timers. Worker enqueue/reschedule/ack and notification order must map to settled intents and replay. EventEmitter is not durable publication. |
| `engine/retrying.ts` -> `core/v3/errors.ts`, `core/v3/utils/retries.ts`, `core/v3/schemas/schemas.ts` | Retain used error/retry helpers and RetryOptions semantics with tests. Follow their leaf imports when promoting; importing the core barrel is not closure. |
| IDs/duration/max-duration in `core/v3/isomorphic/`; run-engine schemas in `core/v3/schemas/`; `core/v3/serverOnly/idempotencyKeys.ts`, packet serialization, timeoutError | Classify each used symbol as retained portable logic, adapted Flarex identity/contract, or excluded product-only field. Exact generated-ID, time and randomness seams must support deterministic replay. Preserve license/provenance of copied code. |
| Engine package dependencies: internal redis, metrics-pipeline, tracing, cache, run-store; Trigger core/database/redis-worker; assert-never, nanoid, redlock, seedrandom, zod, p-map | Dependency names do not imply admission. Remove Prisma/database/run-ops runtime, Redis/cache/worker infrastructure and host timers from the retained core. Bind diagnostics to existing owners; admit only actually reachable portable dependencies with their exact versions/notices. `run-store` additionally depends on run-ops-database. |

The remaining executable-source gate is a file/symbol/test manifest for the
**adapted** module graph, with original hash, retained symbols, intentional
patches, excluded branch/entry-point enforcement and licenses of transitive
external dependencies. The tables above identify the connected source and
observed query shapes; they do not claim that the unmodified constructor or
every transitive core barrel is ready for a Worker bundle.

## Current Flarex Fit And Concrete Limits

The current [Task store](../../../packages/durable-task/src/runAttempt/Services/TaskSystemRunAttemptStore.ts)
still accepts a synchronous `decide` over an aggregate. Its
[Postgres owner](../../../packages/persistence-postgres/src/tasks/taskSystemRunAttemptStoreV1.ts)
owns locks, database time and settlement; it does not supply these async RunStore
operations. The [logical store](../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/model.ts)
provides bounded reads/writes; `findPage` returns rows/hasMore, not a durable Task
fan-out cursor. Private Task schema admission, fresh READ COMMITTED observations,
conditional acceptance and atomic effects remain work for the correct owners.

| Existing bound | Meaning and limitation for this closure |
| --- | --- |
| Snapshot history `take:50`; waitpoint chunks `100` | Real upstream call-site limits, but neither bounds all hydration bytes nor guarantees exhaustive progress. Latest-snapshot hydration has no equivalent overall cap. |
| Pending-version batch default `200`, lookup `maxCount+1` | Conditional upstream discovery default, not an accepted Task transaction size or proof that external discovery finds every pending run. |
| [Indexed query page cap](../../../packages/flarex-protocol/src/commit-limits.ts) `128` | Upper storage page bound. Task pages may need to be smaller after accounting for relations, effects, indexes and bytes. |
| [Logical materialization budget](../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/policy.ts): `2048` rows, `64` pages, `4,194,304` document bytes | Existing materialization budget, not automatic permission for a Task command to consume it or hold a transaction across fan-out. |
| [Bounded row reads](../../../packages/persistence-postgres/src/storage/documents/appRows.ts): `1,048,576` maximum document/value-byte bounds | Encoded metadata, checkpoint body, waitpoint outputs and response arrays need independent envelope/accounting proof. A 100-token chunk can exceed the byte budget. |
| `MAX_TASK_RUN_ATTEMPTS = 250` | Source policy constant, not a query bound or chosen Flarex business/dispatch retry budget. Preserve exact comparison semantics until the accepted failure mapping is proved. |

Before accepting each Q row, record numeric maximum input IDs, result rows,
encoded result bytes, affected writes/index entries, database statements and
transaction duration; identify whether excess is rejected before acceptance or
continues through durable work. Source-unbounded cardinalities stay explicitly
**unproved**. Do not invent a large default, silently truncate, or treat a
generic core budget as a workload measurement.

Uncommitted trusted-workflow continuation/checkpoint code remains an overlap
input as described in preflight 72. It borrows the current Task transaction and
still executes custom decisions. Refresh its landed contract before migration;
its file presence cannot close the retained-engine query or checkpoint gates.

## Remaining Evidence And Exit Criteria

| Gate | Established by source inspection | Still required |
| --- | --- | --- |
| S1 exact reference | Pinned imported source, manifest and license owners; concrete lifecycle, helper, recovery and conditional branch anchors above. | Adapted executable file/symbol/test/license manifest; prove excluded features cannot enter through defaults, callbacks, stored records or constructor imports. Existing source guards remain unchanged. |
| S2 finite query contract | Q01–Q17 predicates/projections, write families, direct-client escapes, unbounded relations and actual source limits. | Finite typed results, mandatory scope/placement binding, numeric budgets, concrete private logical schema/index mapping and query plans. No generic Prisma-shaped target contract. |
| S3 atomicity/read visibility | Start uses a transaction-bound store; other paths still bypass it or publish before settlement. Blocking relies on a fresh statement after edge insertion. | Borrowed-store confinement for every reachable read/write; write/fence/receipt/effect atomicity; physical lock graph, absence semantics and rollback/uncertain-commit witnesses. |
| S4 bounded progress | Completion/children/blockers/hydration can be unbounded; history is not an exhaustive cursor. | Durable continuation frontier, stable ordering, late-edge insertion and crash recovery; test >1 page, ties, byte exhaustion, duplicate work and concurrent creation/cancellation. Never resume from an incomplete blocker scan. |
| S5 connected behavior | Existing upstream witnesses name relevant invariants. | Execute actual retained methods through the future Flarex store; separately validate PGlite and ordinary-role Postgres, including fresh-host recovery. Source tests alone do not prove logical-store behavior. |

Start witness selection with `engine/tests/attemptFailures.test.ts`,
`cancelling.test.ts`, `heartbeats.test.ts`, `dequeuing.test.ts`, `waitpoints.test.ts`,
`waitpointRace.test.ts`, `waitpointReplicaLag.test.ts`;
`engine/retryDecisionReadAfterWrite.replicaLag.test.ts`;
`engine/tests/completeWaitpointReadResidency.test.ts`,
`engine/tests/blockEdgeResidency.test.ts`,
`engine/tests/datetimeWaitpointColocation.test.ts`,
`engine/tests/controlPlaneResolverInjectability.test.ts`;
and `store/PostgresRunStore.writeAtomicity.test.ts`,
`runOpsStore.cancelRunReadAfterWrite.replicaLag.test.ts`,
`runOpsStore.usageCostUndercountReadAfterWrite.test.ts`,
`runOpsStore.snapshotCompletedWaitpoints.test.ts`.
Use queue `ack`, `nack`, `releaseConcurrency` and dequeue witnesses for permit
semantics. Inspect assertions and map exact retained cases before promotion;
test names or an unrelated bounded-connected-runs test do not prove Q08/Q12.

S1–S2 now have a source-grounded inventory, not completed implementation proof.
The next planning closure is the finite operation/result and logical index/budget
mapping, followed by the physical lock graph and checkpoint representation.
Implementation and all runtime proof remain gated by explicit authorization.
