# DTE03-A: Current Trigger Lifecycle And Source-To-Flarex Transition Inventory

## Receipt Status

**Status:** Complete as the Roadmap 03 inventory checkpoint.

**Decision:** Continue under the DTE03-B model with one authoritative Flarex
run-attempt aggregate. DTE03-B is now complete in
[`13-phase-terminal-and-aggregate-model.md`](./13-phase-terminal-and-aggregate-model.md):
it retains the admitted Trigger transition semantics and hostile scenarios
without copying Trigger's independently mutable status axes.

DTE03-C's policy is complete in
[`14-failure-retry-and-attempt-policy.md`](./14-failure-retry-and-attempt-policy.md),
and DTE03-D's exhaustive transition/race tables are complete in
[`15-cancellation-heartbeat-lease-and-race-tables.md`](./15-cancellation-heartbeat-lease-and-race-tables.md).
DTE03-E's exact result/evidence/effect/error contract is complete in
[`16-operation-outcomes-evidence-effects-and-errors.md`](./16-operation-outcomes-evidence-effects-and-errors.md).
DTE03-F is the next checkpoint.

This receipt inventories current source behavior and fixes the questions the
remaining Roadmap 03 checkpoints must answer. It does not define the final
`RunAttemptPhaseV1`, terminal outcome, aggregate, failure, effect, or operation
outcome unions and does not authorize DTE-IP01.

## Method And Boundary

The inventory was traced against the DTE01-pinned Trigger source and executable
source map, principally:

- `run-engine/src/engine/statuses.ts`;
- `run-engine/src/engine/consts.ts`;
- `run-engine/src/engine/errors.ts`;
- `run-engine/src/engine/retrying.ts`;
- the selected `RunAttemptSystem` regions;
- `ExecutionSnapshotSystem.heartbeatRun` and heartbeat timeout selection;
- the selected stalled-snapshot branches in `RunEngine`;
- the selected `RunStore` attempt/snapshot semantic operations; and
- the admitted attempt-failure, cancellation, heartbeat, replica-lag, and
  store-routing tests.

The classifications used below are:

- **retain** — preserve the domain behavior or invariant;
- **seam-adapt** — preserve behavior while changing the authority-bearing
  input, representation, or requested side effect;
- **deliberate divergence** — change behavior because the Trigger form
  conflicts with admitted Flarex authority or durable replay;
- **defer** — useful behavior owned by a later roadmap; and
- **discard** — Trigger product or adapter policy with no first-vertical owner.

## Source State Model

### Two Independent Status Axes

Trigger stores a product-facing `TaskRunStatus` on the run and an
`TaskRunExecutionStatus` on append-only execution snapshots. The latest valid
snapshot is selected by identity and creation ordering. Several transitions
write both axes, but they do not have identical meanings or terminal timing.

This produces three useful classes of information:

1. scheduling/product presentation such as delayed, pending version, paused,
   or retrying;
2. execution coordination such as pending execution, executing, pending
   cancellation, or finished; and
3. terminal classification such as success, user error, system failure, crash,
   timeout, or cancellation.

Flarex needs these facts, but not two independently authoritative status
columns. DTE03-B must place the retained facts in one aggregate and derive
later read projections from it.

### Trigger Execution-Snapshot Status Inventory

| Trigger status | Current meaning | First-vertical disposition |
| --- | --- | --- |
| `RUN_CREATED` | run exists before queue admission | defer to Roadmap 04 run creation; DTE-IP01 receives an already-created run |
| `DELAYED` | waiting for delayed enqueue | defer to Roadmaps 04/05 scheduling |
| `QUEUED` | present in Trigger's Redis run queue | seam-adapt as later durable-discovery/wake state, not a Redis-authoritative domain phase |
| `QUEUED_EXECUTING` | execution continues while concurrency reacquisition is queued | defer; tied to waitpoint/concurrency continuation outside the first vertical |
| `PENDING_EXECUTING` | dequeued/locked and awaiting attempt start | retain the pre-attempt claim/grant semantic; replace snapshot/worker lock with run version, attempt allocation, fence, and lease authority |
| `EXECUTING` | current worker attempt is executing | retain as the core active-attempt semantic |
| `EXECUTING_WITH_WAITPOINTS` | worker is active but blocked on waitpoints | defer and reject as unsupported in the first vertical; do not silently alias it to ordinary execution |
| `SUSPENDED` | checkpointed or blocked execution can later resume | defer to waitpoint/checkpoint work |
| `PENDING_CANCEL` | cancellation requested; worker confirmation still pending | retain the in-flight cancellation semantic but model request generation and acknowledgement separately |
| `FINISHED` | no further execution should occur | retain terminality, while terminal reason/outcome is a separate closed union |

The first package therefore needs pre-attempt, executing, cancellation-pending,
retry/durable-wait, and terminal facts. DTE03-B decides whether durable-wait is
a package phase or a handoff outcome owned by Roadmap 04. It must not expose
waitpoint or checkpoint phases merely because the Trigger enum contains them.

### Trigger Run Status Inventory

| Trigger status | Current meaning | First-vertical disposition |
| --- | --- | --- |
| `DELAYED` | scheduled for future queue admission | defer to scheduling |
| `PENDING` | waiting for worker execution | retain only the generic due/unclaimed fact needed by later Task System operations |
| `PENDING_VERSION` | blocked until compatible task/version data exists | defer to definition/activation policy; not an attempt phase |
| `WAITING_FOR_DEPLOY` | deprecated predecessor of pending version | discard as a Flarex contract |
| `DEQUEUED` | pulled from queue but not executing | retain the claim-before-start semantic, translated to authoritative fenced state |
| `EXECUTING` | worker is executing | retain |
| `WAITING_TO_RESUME` | system-paused, normally waitpoint/checkpoint related | defer |
| `RETRYING_AFTER_FAILURE` | failure accepted and later retry expected | retain retry intent, but derive it from aggregate policy/effect state |
| `PAUSED` | user-paused | defer |
| `CANCELED` | product run marked canceled | retain terminal cancellation only after acknowledgement, known worker loss, or a cancellation of non-executing work |
| `INTERRUPTED` | primarily development-environment interruption | discard as an environment-specific first-vertical outcome; later compute policy may add an explicit interruption class |
| `COMPLETED_SUCCESSFULLY` | successful terminal completion | retain |
| `COMPLETED_WITH_ERRORS` | terminal user/task failure | retain the semantic through typed terminal failure classification |
| `SYSTEM_FAILURE` | terminal platform/engine failure | retain the semantic through typed terminal failure classification |
| `CRASHED` | terminal user configuration/resource/process crash | retain the semantic only where the failure taxonomy can prove it; do not copy Trigger process codes blindly |
| `EXPIRED` | TTL elapsed before execution | defer to later TTL/scheduling policy |
| `TIMED_OUT` | maximum task duration exceeded | retain as a terminal failure kind when supplied by the later compute boundary |

## Source Transition Inventory

### Start Attempt

Current Trigger order is:

1. acquire a run-scoped Redis lock;
2. read the latest execution snapshot;
3. reject a changed snapshot ID;
4. load the run from the owning store;
5. reject absence, finished/pending-finished execution, or missing worker lock;
6. calculate `nextAttemptNumber = (attemptNumber ?? 0) + 1`;
7. if the next attempt exceeds the global ceiling, permanently fail the run;
8. atomically increment the attempt and append an `EXECUTING` snapshot; and
9. return an execution projection assembled from product/runtime data.

Flarex disposition:

- retain expected-current-state validation, one-attempt-at-a-time semantics,
  attempt-number increment, global ceiling, and atomic active-state evidence;
- seam-adapt snapshot identity and Redis lock to run version, attempt ID,
  execution fence, lease version, and a database transaction;
- allocate attempt ID and fence inside the accepted transaction;
- return a bounded accepted/idempotent/current domain receipt rather than the
  Trigger execution payload; and
- separate terminal failure caused by attempt exhaustion from the thrown
  validation error Trigger returns after writing that failure.

DTE03-B/C must decide the legal pre-start aggregate and exact exhaustion
outcome. A caller's attempt ID, fence, time, or worker lock is never accepted as
authority.

### Heartbeat

Current Trigger heartbeat behavior:

1. reads the latest snapshot without the run lock;
2. returns the latest state unchanged when the supplied snapshot is stale;
3. logs, but does not reject, a worker-ID mismatch;
4. selects a timeout from the execution status; and
5. reschedules a worker heartbeat job using host time.

The source behavior does not persist a monotonic heartbeat sequence or a
database-authoritative lease renewal.

Flarex disposition:

- retain stale-delivery non-authority and status-dependent lease policy;
- deliberately replace snapshot identity and worker ID with attempt ID,
  execution fence, lease version, and heartbeat sequence;
- accept a greater sequence, including a gap, exactly once;
- return an idempotent/current result for a duplicate sequence without
  extending the lease twice;
- return lower sequence and stale fence as current state according to DTE03-D,
  with the exact outcome record fixed by DTE03-E; and
- compute and store lease renewal from database time in the same transaction.

### Successful Completion

Current Trigger success behavior validates the latest snapshot, rejects an
already-finished snapshot, reads current usage from the owning primary,
updates the run to successful completion, writes a final snapshot, completes
related waitpoints, emits success, performs terminal cleanup, and returns
`RUN_FINISHED`.

Flarex disposition:

- retain current-attempt/fence validation, one terminal success, and atomic
  terminal state plus bounded result evidence;
- deliberately add replay identity: identical attempt/fence/completion
  redelivery returns the stored receipt, while a different completion for that
  composite conflicts;
- store only the admitted result commitment in DTE-IP01;
- persist ordered success/cleanup effect intents atomically, then deliver them
  after commit; and
- discard waitpoint, billing, Trigger event, and public result projections.

### Failed Completion And Retry

Current Trigger failure behavior validates the latest snapshot, rejects
finished execution, clears blocking waitpoints, computes a retry outcome,
records usage/retry state, then chooses cancellation, permanent failure,
durable queue retry, or immediate execution continuation.

Flarex disposition:

- retain cancellation recognition, terminal-versus-retry policy, immediate
  versus durable retry, OOM escalation intent, and current usage evidence only
  where the admitted bounded model needs it;
- exclude waitpoint clearing and Trigger pricing;
- calculate time from authoritative database time and the jitter stored when
  the attempt started;
- atomically store the retry decision, evidence, replay receipt, and ordered
  requested effects;
- represent durable retry as state plus a wake request, never as proof that a
  queue message exists; and
- make ambiguous completion delivery replayable rather than rejecting every
  already-finished request.

### Cancellation Request And Acknowledgement

Current Trigger behavior has three major branches:

- already `FINISHED`: return current state with `alreadyFinished: true`;
- already `PENDING_CANCEL` without finalization: notify the worker again and
  return current state; and
- otherwise write run status `CANCELED`, remove queued work, then either append
  `PENDING_CANCEL` and notify an executing worker or append `FINISHED` for
  non-executing/forced-finalization work.

The running branch therefore exposes `run.status = CANCELED` before execution
is terminal.

Flarex disposition:

- retain idempotent repeated request, worker notification intent, immediate
  terminal cancellation for work known not to be executing, and finalization
  after worker acknowledgement or proven lease loss;
- deliberately separate cancellation request/generation from terminal
  cancellation;
- do not publish a terminal cancellation outcome while a current fenced
  attempt can still complete;
- accept `TASK_RUN_CANCELLED`-equivalent completion only for the current
  attempt/fence and bind it to the acknowledged generation; and
- defer child-run fan-out, waitpoint cleanup, bulk actions, and queue removal
  mechanics to later owners.

### Lease Expiry And Stalled Work

Current Trigger stalled-snapshot branches are:

| Source execution state | Current action | Flarex disposition |
| --- | --- | --- |
| stale snapshot ID | no-op | retain using expected lease version/current fence |
| `PENDING_EXECUTING` | nack/requeue; terminal system failure after queue retry exhaustion | retain pre-start loss recovery, translate queue attempt policy into durable state/effect policy |
| `EXECUTING` | synthesize stalled/OOM failure and force a queued retry or terminal failure | retain worker-loss retry/failure semantics; make OOM interpretation explicit compute policy |
| `EXECUTING_WITH_WAITPOINTS` | same family with waitpoint-specific error | defer; unsupported in first vertical |
| `PENDING_CANCEL` | force terminal cancellation | retain after current lease version expires |
| `SUSPENDED` | inspect waitpoints and restart heartbeat with backoff | exclude from first vertical |
| states that should have no heartbeat | throw `NotImplementedError` | replace with exhaustive current/idempotent/typed invariant behavior |

Flarex `handleLeaseExpiry` uses expected lease version rather than a snapshot
ID. A renewed lease makes the old wake stale. Completion and expiry race in one
authoritative transaction and exactly one transition wins.

## Retry Decision Order

The source `retryOutcomeFromCompletion` evaluates these decisions in order:

1. recognize `TASK_RUN_CANCELLED` before ordinary sanitization;
2. sanitize the failure;
3. handle OOM before general retry eligibility:
   - load run retry/machine/usage data;
   - require a configured different OOM machine;
   - calculate a retry delay;
   - queue the retry or fail with `wasOOMError`;
4. enhance the error and reject non-retryable failures;
5. reject an attempt number greater than the global maximum;
6. read authoritative run max-attempt/retry/usage policy;
7. reject a missing run, absent max-attempt value, or exhausted run limit;
8. when completion supplies no retry settings, require lookup eligibility,
   decode locked retry configuration, and calculate the next delay;
9. default a looked-up retry to durable queue delivery; and
10. otherwise use the completion's retry settings and select queue versus
    immediate from `retryUsingQueue`.

Three details require explicit Roadmap 03 decisions:

- start rejects when the *next* attempt is greater than 250, while completion
  rejects retry only when the *current* attempt is greater than 250; DTE03-C
  must fix one exact ceiling and prove the boundary with vectors;
- source retry timestamps use `Date.now()` and completion-provided absolute
  timestamps; Flarex uses database time, bounded stored jitter, and policy
  delay instead; and
- OOM lookup catches every foreign error and degrades to terminal failure.
  DTE03-C/E must distinguish an ordinary unavailable escalation from a store
  failure or defect rather than hiding it in policy.

The source's `MAX_TASK_RUN_ATTEMPTS = 250` remains compatibility evidence, not
automatic public configuration authority.

## Source Terminal Failure Classification

`runStatusFromError` currently classifies:

- non-internal errors as `COMPLETED_WITH_ERRORS`;
- task input/output/middleware/uncaught and recursive-wait errors as
  `COMPLETED_WITH_ERRORS`;
- task cancellation as `CANCELED`;
- maximum duration as `TIMED_OUT`;
- stalled execution as development cancellation or production task error;
- OOM, possible OOM, segmentation, disk, SDK/configuration handler, process
  exit, and explicit crash codes as `CRASHED`; and
- executor/task/import/configuration, heartbeat/dequeue, graceful-exit,
  provider, execution, batch, payload, and unspecified internal codes as
  `SYSTEM_FAILURE`.

Flarex retains the distinction among user/task failure, platform/system
failure, resource/process crash, timeout, and cancellation. It does not copy
Trigger's error-code vocabulary or its development-versus-production
environment branch wholesale. DTE03-C must define a bounded
`TaskExecutionFailureV1`, classify only failures supported by the first
compute/runtime boundary, and preserve unknown foreign causes as typed adapter
failure or defect rather than an `UNSPECIFIED_ERROR` catch-all.

## Transaction, Evidence, And Effect Inventory

### Retained Atomicity

The source explicitly requires attempt increment plus `EXECUTING` snapshot to
commit in one owning-store transaction and uses primary reads where replica
lag could change retry or completion decisions. These invariants are retained:

- the decision reads one authoritative aggregate;
- start allocation and active state commit together;
- terminal/retry state and its evidence commit together;
- decisions cannot consult a stale replica; and
- operation receipts are detached from transaction-owned state.

Flarex implements those semantics through the DTE02 two-operation store port
and pure re-invocable decision callback, not Prisma generics or a Redis lock.

### Source Side Effects To Translate

The selected Trigger flows directly perform or emit:

- notify current worker to fetch state/start/cancel;
- nack/requeue at a future timestamp;
- schedule or reschedule heartbeat work;
- run succeeded;
- run attempt failed;
- retry scheduled;
- run canceled; and
- terminal cleanup and related product fan-out.

DTE03-E admits only bounded lifecycle-requested effects needed by the first
vertical. Every admitted effect receives a run-local monotonic effect sequence
and is persisted in transition order. Queue/wake delivery, compute dispatch,
observability projection, and cleanup adapters consume those intents later;
their delivery cannot retroactively authorize or reject the transition.

Child cancellation, batch completion, waitpoint completion, billing, Trigger
event payloads, and public realtime projection remain excluded even if their
source call appears in an admitted orchestration method.

### Source Uncertainty To Remove

The Flarex model must deliberately improve these source boundary behaviors:

- latest-by-snapshot/creation ordering becomes monotonic run and lease
  versions;
- a process/Redis lock becomes database transaction and fence authority;
- host-clock timestamps become database time;
- scheduler rescheduling becomes durable lease evidence plus requested wake;
- direct queue/event calls become atomic requested effects;
- terminal completion redelivery becomes idempotent replay or conflict;
- cancellation request no longer presents premature terminal cancellation;
  and
- caught OOM/store uncertainty is not silently converted into ordinary policy.

These are authority-preserving adaptations, not reasons to reimplement the
entire lifecycle independently.

## Command-To-Source Coverage

| DTE02 operation | Principal source behavior | DTE03 obligation |
| --- | --- | --- |
| `startAttempt` | `startRunAttempt` plus atomic start/snapshot store methods | exact eligible phase, allocation, fence/lease grant, ceiling, accepted/idempotent/current outcomes |
| `heartbeatAttempt` | `heartbeatRun` and heartbeat timeout selection | sequence, fence, lease renewal, duplicate/gap/stale behavior |
| `completeAttempt` | success, failed, cancellation, permanent failure, and retry branches | canonical completion identity, failure policy, retry outcome, replay/conflict, effects |
| `requestCancellation` | `cancelRun` request/current/finalize branches | generation, current attempt notification, immediate versus pending terminality |
| `handleLeaseExpiry` | admitted stalled-snapshot branches | expected lease version, pre-start/executing/cancel recovery, race outcomes |
| `inspectCurrentAttempt` | latest execution result/evidence lookup | safe immutable projection, absence/corruption behavior, no scope/fence disclosure beyond internal contract |

No source operation justifies adding another service or store-port method.

## Compatibility Scenario Inventory

The following admitted source scenarios must become canonical DTE03-F vectors:

| Source scenario | Required retained claim |
| --- | --- |
| retry user error and succeed | retry does not increment attempt until the next start; later success terminates once |
| fail with no retries | definition attempt limit terminates the run |
| fail non-retryable error | retry policy cannot override non-retryable classification |
| OOM fail | unavailable escalation terminates with resource/process evidence |
| OOM retry on larger machine | accepted escalation requests a different compute class and durable retry |
| OOM failure after escalation | the same escalation cannot loop indefinitely |
| cancel executing run | request becomes pending, worker acknowledgement makes it terminal |
| cancel non-executing run | cancellation may terminate immediately |
| cancel dequeued/pre-start run | pre-start ownership and cancellation race is deterministic |
| pre-start timeout then success | lost pre-start grant recovers and a later attempt can execute |
| all pre-start attempts time out | bounded recovery exhaustion is terminal system failure |
| executing worker misses heartbeat | worker loss enters retry or terminal failure policy |
| pending cancellation heartbeat expires | cancellation becomes terminal without worker acknowledgement |
| stale heartbeat snapshot | stale work cannot renew or regress current state |
| heartbeat keeps run alive | accepted heartbeat postpones current expiry |
| retry decision under replica lag | policy reads authoritative transaction state |
| start/completion primary-read guards | recent ownership and policy writes cannot be missed |

Suspended/manual/run waitpoint heartbeat scenarios remain source evidence for
later waitpoint work and are not first-vertical compatibility claims.

## Decisions Closed By This Inventory

DTE03-A closes these direction questions:

1. Flarex will not copy Trigger's two independently mutable status axes.
2. The first aggregate will retain pre-start claim, executing, cancellation
   pending, retry/durable-wait, and terminal facts only where DTE03-B proves
   they belong to DTE-IP01.
3. Waitpoint/checkpoint/suspended, pause, delayed scheduling, pending-version,
   TTL, batch, child-run, and public product states remain outside the first
   lifecycle model.
4. Cancellation request is orthogonal to terminal cancellation.
5. Heartbeat is durable lease renewal, not scheduler rescheduling.
6. Latest state is decided by monotonic versions and fences, not timestamped
   snapshot identity.
7. Retry time is derived from database time and stored jitter.
8. Transition evidence, replay receipt, and requested effects are atomic.
9. Identical completion redelivery is idempotent; different completion for the
   same attempt/fence conflicts.
10. The Trigger source and tests remain the default behavior oracle; the
    deliberate divergences above require explicit vectors.

## Roadmap 03 Decision Ledger

### DTE03-B — Complete

- exact `RunAttemptPhaseV1` members and names;
- whether retry wait is an aggregate phase or an accepted handoff outcome;
- exact terminal outcome union;
- aggregate field presence rules for attempt, lease, cancellation, retry, and
  terminal evidence;
- legal already-created/pre-dispatched initial state; and
- representation of unsupported source states at the adapter boundary.

### DTE03-C — Complete

- exact failure union and classification table;
- exact global ceiling and per-definition limit semantics;
- retry policy fields and validation bounds;
- OOM escalation availability versus adapter failure;
- backoff and jitter calculation/overflow;
- immediate versus durable retry threshold ownership; and
- exact error-evaluation order.

### DTE03-D — Complete

- cancellation generation request/acknowledgement table;
- heartbeat duplicate/gap/lower-sequence outcomes;
- lease expiry for every admitted phase;
- stale fence/version/lease behavior; and
- completion/cancellation/expiry race winners and replay responses.

### DTE03-E — Complete

- five mutation outcome unions and inspection projection;
- evidence kinds and payload bounds;
- replay receipt fields;
- requested effect variants and exact order; and
- typed domain/store/corruption error order.

### DTE03-F — Next

- canonical scenario and receipt encoding;
- which Trigger scenarios can run differentially and which are translated
  assertions only;
- explicit expected differences; and
- executable compatibility gates.

### DTE03-G

- final lifecycle admission and DTE-IP01 implementation gate.

## Handoff

Proceed to DTE03-F using the admitted source inventory, five-phase aggregate,
failure/retry policy, transition/race tables, and exact DTE03-E service contract.
Create canonical compatibility vectors and executable fixtures without adding
scheduling, persistence, host, waitpoint, or product state.

Do not create `packages/durable-task/` until DTE03-G admits the complete model.

## Authority And Evidence

- [`../03-run-attempt-engine.md`](../03-run-attempt-engine.md)
- [`15-cancellation-heartbeat-lease-and-race-tables.md`](./15-cancellation-heartbeat-lease-and-race-tables.md)
- [`16-operation-outcomes-evidence-effects-and-errors.md`](./16-operation-outcomes-evidence-effects-and-errors.md)
- [`../01-source-reuse-and-package-admission.md`](../01-source-reuse-and-package-admission.md)
- [`../02-task-definition-identity-and-scope.md`](../02-task-definition-identity-and-scope.md)
- [`01-run-attempt-lifecycle-closure.md`](./01-run-attempt-lifecycle-closure.md)
- [`02-source-map-and-package-boundary.md`](./02-source-map-and-package-boundary.md)
- [`03-provenance-and-compatibility-harness.md`](./03-provenance-and-compatibility-harness.md)
- [`05-final-package-admission.md`](./05-final-package-admission.md)
- [`10-dte-ip01-input-and-store-port-contract.md`](./10-dte-ip01-input-and-store-port-contract.md)
- [`11-final-identity-admission.md`](./11-final-identity-admission.md)
- [`13-phase-terminal-and-aggregate-model.md`](./13-phase-terminal-and-aggregate-model.md)
- [`14-failure-retry-and-attempt-policy.md`](./14-failure-retry-and-attempt-policy.md)
- [`source-map.run-attempt-v1.json`](./source-map.run-attempt-v1.json)
- frozen Trigger source and tests at commit
  `f10bc23785e569e5d917318cf2033aabdbe96a0b`
