# DTE03-B: Run-Attempt Phase, Terminal Outcome, And Aggregate Model

## Receipt Status

**Status:** Complete — admit the DTE03-B phase, terminal-outcome, and aggregate
shape as the state-model input to DTE03-C through DTE03-G. DTE03-C now refines
the policy-owned leaves in
[`14-failure-retry-and-attempt-policy.md`](./14-failure-retry-and-attempt-policy.md).

**Decision:** Use one five-phase discriminated aggregate with orthogonal
cancellation, leased attempt ownership, bounded completion replay, and ordered
effect cursors. Do not reproduce Trigger's separately mutable run-status and
execution-snapshot status axes.

This receipt fixes the exact state topology and valid field combinations for
the future private `@flarex/durable-task` package. DTE03-C still owns the leaf
failure/retry policy and its validation bounds; DTE03-D owns exact command
transition tables; DTE03-E owns the closed operation-outcome, evidence,
requested-effect, and error unions. Those later checkpoints fill the named
owners below without adding another phase, another aggregate axis, or an
authority-bearing command field.

This is documentation admission only. It does not authorize package creation,
schema, migration, adapter, host, scheduler, runtime, route, or activation
work.

## Why One Aggregate

The DTE03-A inventory found that Trigger uses one product run status and one
latest execution-snapshot status. That representation carries useful semantic
facts but permits contradictory projections, most visibly a run already marked
`CANCELED` while its execution remains `PENDING_CANCEL`.

Flarex needs one answer to each authoritative question:

- may a new attempt be granted now;
- does one attempt/fence currently own execution;
- has execution liveness been observed;
- is a retry waiting for its eligibility time;
- has cancellation been requested or resolved; and
- is the run terminal, with which immutable outcome.

Those answers are represented by one phase union plus phase-specific fields.
Later query/UI projections may derive familiar labels, but no second status
column may become lifecycle authority.

## Exact Phase Union

`RunAttemptPhaseV1` is exactly:

```ts
type RunAttemptPhaseV1 =
  | "ready"
  | "attempt_granted"
  | "executing"
  | "retry_waiting"
  | "terminal";
```

The meanings are:

| Phase | Authoritative meaning |
| --- | --- |
| `ready` | no attempt owns execution; `startAttempt` may grant the next attempt once the stored eligibility time is due |
| `attempt_granted` | one attempt/fence and lease have been granted and dispatch requested, but no heartbeat has yet durably proven runtime liveness |
| `executing` | the current attempt/fence remains leased and at least one heartbeat sequence has been durably accepted |
| `retry_waiting` | no attempt owns execution; an accepted retry is waiting for durable discovery at its stored not-before time |
| `terminal` | no attempt owns execution and exactly one immutable terminal outcome exists |

There is no `pending_cancel` phase. Cancellation is orthogonal state on an
active attempt and becomes terminal only through acknowledgement, proven lease
loss, or cancellation when no attempt is active.

There is no separate `retry_ready` phase. An immediate retry uses `ready` with
a retry origin and stored eligibility time. A durable retry uses
`retry_waiting`; `startAttempt` may consume it directly once due. No mutation is
needed merely to rename a due retry.

There is no phase for `queued`, `delayed`, `pending_version`, `paused`,
`suspended`, `executing_with_waitpoints`, `expired`, or Trigger deployment
state. Those capabilities retain their later roadmap owners.

## Common Immutable Run State

Every aggregate variant carries this common state:

```ts
interface TaskRunAttemptAggregateBaseV1 {
  readonly version: "flarex.task-run-attempt-aggregate.v1";
  readonly runId: TaskRunIdV1;
  readonly taskDefinitionRevisionId: TaskDefinitionRevisionIdV1;
  readonly createdAtMs: TaskDatabaseTimeMsV1;
  readonly runVersion: TaskRunVersionV1;
  readonly boundPolicy: TaskRunAttemptBoundPolicyV1;
  readonly attemptHistory: TaskAttemptHistoryCursorV1;
  readonly lastLifecycleAcceptance:
    | TaskRunAttemptMutationAcceptanceV1
    | null;
  readonly completionReplays: readonly TaskAttemptCompletionReplayV1[];
  readonly requestedEffectCursor: TaskRequestedEffectCursorV1;
}
```

`runId` and `taskDefinitionRevisionId` never change. `runVersion` advances
exactly once for each accepted lifecycle mutation. `createdAtMs` comes from
the Task System run-creation transaction and is not host time.

`lastLifecycleAcceptance` stores the exact most recent accepted lifecycle
mutation receipt. It is sufficient for direct duplicate start, heartbeat,
cancellation, and lease-expiry delivery while that acceptance remains current.
An intervening accepted mutation replaces it, after which the old delivery
returns current state. Completion is the deliberate exception: its replay must
survive later attempts and therefore also enters `completionReplays`.

DTE03-E fixes the closed operation-specific members of
`TaskRunAttemptMutationAcceptanceV1`. Every member contains its canonical
command identity, observed database time, accepted run version, resulting
phase/outcome, exact evidence, and persisted requested effects. It is not an
unbounded command log and does not retain raw input, foreign errors, or host
authority.

`boundPolicy` is the immutable normalized policy captured when the run is
created:

```ts
interface TaskRunAttemptBoundPolicyV1 {
  readonly runAttempt: RunAttemptPolicyV1;
  readonly maximumDurationMs: TaskDurationMsV1;
  readonly initialComputeProfile: TaskComputeProfileRefV1;
  readonly leaseDurationMs: TaskDurationMsV1;
  readonly immediateRetryThresholdMs: TaskDurationMsV1;
}
```

DTE03-C fixes the exact `RunAttemptPolicyV1` bounds, attempt-ceiling
interaction, backoff, OOM/compute-profile decisions, and duration overflow.
DTE03-B fixes that the accepted values are immutable aggregate state. The live
Layer may supply defaults while constructing a new run, but an existing run is
never reinterpreted under changed process configuration after restart.

`TaskComputeProfileRefV1` is the opaque compute-profile reference already owned
by the canonical task manifest. The lifecycle package compares and returns it
as policy data; it does not resolve a runtime target, machine, provider, price,
region, or credentials.

## Monotonic Cursors

### Attempt History Cursor

Zero is not represented as a branded attempt number:

```ts
type TaskAttemptHistoryCursorV1 =
  | { readonly kind: "none" }
  | {
      readonly kind: "issued";
      readonly lastAttemptNumber: TaskAttemptNumberV1;
    };
```

The cursor advances only when `startAttempt` accepts a new attempt grant. A
retry decision does not increment it. The next candidate number is one greater
than the issued value, or `1` when the cursor is `none`, subject to DTE03-C's
ceiling and overflow rules.

### Requested-Effect Cursor

Effect sequence zero is likewise not encoded as a branded sequence:

```ts
type TaskRequestedEffectCursorV1 =
  | { readonly kind: "none" }
  | {
      readonly kind: "issued";
      readonly lastSequence: TaskRequestedEffectSequenceV1;
    };
```

The cursor covers every run-local requested effect, including any admitted by
Roadmap 04 during run creation. The store assigns contiguous sequences in the
decision's array order and advances this cursor atomically. Delivery state is
not part of the lifecycle aggregate and cannot change `runVersion`.

## Ready State

Ready state explains why the run is eligible without retaining a queue:

```ts
type TaskRunReadyStateV1 =
  | {
      readonly kind: "initial";
      readonly eligibleAtMs: TaskDatabaseTimeMsV1;
    }
  | {
      readonly kind: "immediate_retry";
      readonly eligibleAtMs: TaskDatabaseTimeMsV1;
      readonly acceptedRetry: TaskAcceptedRetryV1;
    };
```

An initial ready run is created by the later new-run Task System operation. An
immediate retry is still durable state: it records the accepted retry and
eligibility time before emitting `continue_retry`. “Immediate” selects the
continuation delivery lane; it does not permit execution before
`eligibleAtMs` and does not allow a process-local sleep to become authority.

`ready` has no attempt, fence, lease, cancellation request, retry-wake state,
or terminal outcome.

## Current Attempt And Lease

The exact current-attempt structure is:

```ts
interface TaskCurrentAttemptV1 {
  readonly attemptId: TaskAttemptIdV1;
  readonly attemptNumber: TaskAttemptNumberV1;
  readonly executionFence: TaskExecutionFenceV1;
  readonly grantBasisRunVersion: TaskRunVersionV1;
  readonly computeProfile: TaskComputeProfileRefV1;
  readonly retryJitter: TaskRetryJitterV1;
  readonly grantedAtMs: TaskDatabaseTimeMsV1;
  readonly lease: TaskAttemptLeaseV1;
}

interface TaskAttemptLeaseV1 {
  readonly version: TaskLeaseVersionV1;
  readonly renewedAtMs: TaskDatabaseTimeMsV1;
  readonly expiresAtMs: TaskDatabaseTimeMsV1;
}
```

`grantBasisRunVersion` is the `expectedRunVersion` whose accepted start created
this attempt. A duplicate start is idempotent only while the last lifecycle
acceptance is that exact grant; otherwise it receives current state.

The lease is valid only with the enclosing current attempt and fence.
`expiresAtMs` must be strictly greater than `renewedAtMs`, and their difference
must equal the captured lease duration. Lease renewal advances lease and run
versions together. Attempt ID, attempt number, fence, compute profile, retry
jitter, and grant time never change during that attempt.

Heartbeat state distinguishes grant from observed execution:

```ts
type TaskAttemptHeartbeatStateV1 =
  | { readonly kind: "none_accepted" }
  | {
      readonly kind: "accepted";
      readonly highestSequence: TaskHeartbeatSequenceV1;
    };
```

`attempt_granted` requires `none_accepted`. `executing` requires `accepted`.
The first accepted heartbeat changes phase to `executing`; later greater
sequences keep that phase and renew the lease. A gap is valid. Duplicate or
lower sequences cannot renew the lease.

Completion is valid from either active phase. A short-lived execution may
finish before its first heartbeat, so `attempt_granted` is not evidence that
user code did not run.

## Cancellation State

Cancellation is exactly:

```ts
interface TaskCancellationNotRequestedV1 {
  readonly kind: "not_requested";
  readonly generation: TaskCancellationGenerationV1; // exactly 0
}

interface TaskCancellationRequestedV1 {
  readonly kind: "requested";
  readonly generation: TaskCancellationGenerationV1; // positive
  readonly reason: TaskCancellationReasonV1;
  readonly requestedAtMs: TaskDatabaseTimeMsV1;
}

interface TaskCancellationResolvedV1 {
  readonly kind: "resolved";
  readonly generation: TaskCancellationGenerationV1; // positive
  readonly reason: TaskCancellationReasonV1;
  readonly requestedAtMs: TaskDatabaseTimeMsV1;
  readonly resolvedAtMs: TaskDatabaseTimeMsV1;
  readonly resolution:
    | "without_active_attempt"
    | "acknowledged"
    | "lease_expired"
    | "superseded_by_completion";
}

type TaskCancellationStateV1 =
  | TaskCancellationNotRequestedV1
  | TaskCancellationRequestedV1
  | TaskCancellationResolvedV1;
```

The `not_requested` schema requires generation zero; the other variants require
a positive generation. Resolution time cannot precede request time. The first
accepted reason for a generation remains immutable.

Only `attempt_granted` and `executing` may carry `requested`. `ready` and
`retry_waiting` cancellation resolves atomically to terminal cancellation
because no attempt owns execution. `terminal` carries either `not_requested`
or `resolved`; it never carries a pending request.

`superseded_by_completion` exists only so DTE03-D can choose a current-attempt
success/failure race winner without discarding accepted cancellation evidence.
It is legal only with terminal success or failure, never terminal cancellation.
The exact winner and response table remains DTE03-D's responsibility.

## Accepted Retry State

Both immediate and durable retry states use one accepted decision:

```ts
interface TaskAcceptedRetryV1 {
  readonly previousAttempt: TaskTerminalAttemptRefV1;
  readonly acceptedAtMs: TaskDatabaseTimeMsV1;
  readonly notBeforeMs: TaskDatabaseTimeMsV1;
  readonly nextComputeProfile: TaskComputeProfileRefV1;
  readonly cause: TaskRetryCauseV1;
}

type TaskRetryCauseV1 =
  | {
      readonly kind: "failed_completion";
      readonly failure: TaskExecutionFailureV1;
    }
  | {
      readonly kind: "lease_expired_before_heartbeat";
      readonly failure: TaskExecutionFailureV1;
    }
  | {
      readonly kind: "lease_expired_after_heartbeat";
      readonly failure: TaskExecutionFailureV1;
    };
```

The failure is bounded domain evidence, not a foreign error or stack. DTE03-C
fixes its exact union and the retry calculation. `notBeforeMs` must not precede
`acceptedAtMs` and is derived from transaction database time plus the accepted
bounded delay.

`retry_waiting` stores `TaskAcceptedRetryV1` and emits a durable `wake_retry`.
`ready` with `immediate_retry` stores the same value and emits
`continue_retry`. The delivery choice is therefore visible in phase, while the
policy decision and evidence use one shape.

## Terminal Attempt Reference

Historical and terminal evidence uses:

```ts
interface TaskTerminalAttemptRefV1 {
  readonly attemptId: TaskAttemptIdV1;
  readonly attemptNumber: TaskAttemptNumberV1;
  readonly executionFence: TaskExecutionFenceV1;
}
```

This is internal authority evidence. It is not an execution grant and does not
authorize heartbeat, completion, cancellation acknowledgement, or runtime
resolution after the current-attempt field has been removed.

## Exact Terminal Outcome Union

The terminal outcome is exactly:

```ts
type TaskRunTerminalOutcomeV1 =
  | {
      readonly kind: "succeeded";
      readonly completedAtMs: TaskDatabaseTimeMsV1;
      readonly attempt: TaskTerminalAttemptRefV1;
      readonly result: TaskResultCommitmentV1 | null;
      readonly executionDurationMs: TaskExecutionDurationMsV1 | null;
    }
  | {
      readonly kind: "cancelled";
      readonly completedAtMs: TaskDatabaseTimeMsV1;
      readonly attempt: TaskTerminalAttemptRefV1 | null;
      readonly cancellationGeneration: TaskCancellationGenerationV1;
      readonly reason: TaskCancellationReasonV1;
      readonly resolution:
        | "without_active_attempt"
        | "acknowledged"
        | "lease_expired";
      readonly executionDurationMs: TaskExecutionDurationMsV1 | null;
    }
  | {
      readonly kind: "failed";
      readonly completedAtMs: TaskDatabaseTimeMsV1;
      readonly attempt: TaskTerminalAttemptRefV1 | null;
      readonly classification: TaskTerminalFailureClassV1;
      readonly failure: TaskExecutionFailureV1;
      readonly executionDurationMs: TaskExecutionDurationMsV1 | null;
    };

type TaskTerminalFailureClassV1 =
  | "task_failure"
  | "system_failure"
  | "resource_exhaustion"
  | "timed_out";
```

Success always names the completing attempt. Cancellation may have no attempt
when accepted from `ready` or `retry_waiting`. Failure may have no attempt only
for a later Roadmap 04/system transition that terminalizes before any attempt
is granted. DTE-IP01 task-completion and lease-loss failures name their attempt.

Attempt-limit exhaustion rejects retry while retaining the original failure
classification. A valid startable aggregate always has another attempt
available. Fence, version, lease-version, cancellation-generation, or
effect-sequence exhaustion remains the DTE02 terminal store or counter error
and is not disguised as task failure.

`TaskExecutionFailureV1` and the complete mapping into these classes are fixed
by DTE03-C. Trigger's product status spelling is not stored.

Terminal cancellation fields must exactly match the aggregate's resolved
cancellation generation, reason, resolution, and time. Terminal success or
failure permits cancellation only as `not_requested` or
`superseded_by_completion`.

## Completion Replay State

The aggregate retains a bounded replay entry for every accepted completion,
including a failed completion that scheduled a later attempt:

```ts
interface TaskAttemptCompletionReplayV1 {
  readonly attempt: TaskTerminalAttemptRefV1;
  readonly completion: TaskAttemptCompletionV1;
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly acceptedRunVersion: TaskRunVersionV1;
  readonly resultingPhase: RunAttemptPhaseV1;
  readonly outcome: CompleteAttemptOutcomeV1;
  readonly evidence: readonly TaskRunAttemptEvidenceV1[];
  readonly requestedEffects:
    readonly PersistedTaskRequestedEffectV1[];
}
```

The entry contains the canonical accepted completion and exact persisted
acceptance receipt needed to reconstruct an idempotent response after the run
has advanced. DTE03-E fixes the leaf outcome/evidence/effect unions; it may not
remove the canonical completion or original receipt fields.

Replay entries obey all of these invariants:

- at most one entry exists for an attempt ID/fence pair;
- entries are strictly ordered by attempt number;
- every entry's attempt number is at most the attempt-history cursor;
- length is bounded by the admitted global attempt ceiling;
- an identical completion reconstructs the entry;
- a different completion for the same attempt/fence is a typed conflict;
- a lease-expired attempt may have no completion replay; and
- arrays and digest evidence are owned immutable snapshots.

Persistence may normalize aggregate, replay, evidence, and effect data into
separate tables. `TaskRunAttemptAggregateV1` is the decoded domain transaction
input, not a requirement to use one JSON column.

## Exact Aggregate Union

The aggregate is a discriminated union rather than a flat record with optional
fields:

```ts
type TaskRunAttemptAggregateV1 =
  | TaskRunAttemptReadyAggregateV1
  | TaskRunAttemptGrantedAggregateV1
  | TaskRunAttemptExecutingAggregateV1
  | TaskRunAttemptRetryWaitingAggregateV1
  | TaskRunAttemptTerminalAggregateV1;

interface TaskRunAttemptReadyAggregateV1
  extends TaskRunAttemptAggregateBaseV1 {
  readonly phase: "ready";
  readonly ready: TaskRunReadyStateV1;
  readonly cancellation: TaskCancellationNotRequestedV1;
}

interface TaskRunAttemptGrantedAggregateV1
  extends TaskRunAttemptAggregateBaseV1 {
  readonly phase: "attempt_granted";
  readonly currentAttempt: TaskCurrentAttemptV1;
  readonly heartbeat: { readonly kind: "none_accepted" };
  readonly cancellation:
    | TaskCancellationNotRequestedV1
    | TaskCancellationRequestedV1;
}

interface TaskRunAttemptExecutingAggregateV1
  extends TaskRunAttemptAggregateBaseV1 {
  readonly phase: "executing";
  readonly currentAttempt: TaskCurrentAttemptV1;
  readonly heartbeat: {
    readonly kind: "accepted";
    readonly highestSequence: TaskHeartbeatSequenceV1;
  };
  readonly cancellation:
    | TaskCancellationNotRequestedV1
    | TaskCancellationRequestedV1;
}

interface TaskRunAttemptRetryWaitingAggregateV1
  extends TaskRunAttemptAggregateBaseV1 {
  readonly phase: "retry_waiting";
  readonly retry: TaskAcceptedRetryV1;
  readonly cancellation: TaskCancellationNotRequestedV1;
}

interface TaskRunAttemptTerminalAggregateV1
  extends TaskRunAttemptAggregateBaseV1 {
  readonly phase: "terminal";
  readonly terminal: TaskRunTerminalOutcomeV1;
  readonly cancellation:
    | TaskCancellationNotRequestedV1
    | TaskCancellationResolvedV1;
}
```

Phase-inapplicable fields are absent, not present as optional `undefined` or
`null`. In particular, a terminal aggregate cannot retain `currentAttempt` or
`lease`, and a ready aggregate cannot retain a stale fence.

## Legal-State Matrix

| Field/fact | `ready` | `attempt_granted` | `executing` | `retry_waiting` | `terminal` |
| --- | --- | --- | --- | --- | --- |
| ready state | required | absent | absent | absent | absent |
| current attempt/fence/lease | absent | required | required | absent | absent |
| heartbeat state | absent | `none_accepted` | accepted positive sequence | absent | absent |
| pending cancellation | forbidden | allowed | allowed | forbidden | forbidden |
| resolved cancellation | forbidden | forbidden | forbidden | forbidden | allowed |
| accepted retry | only as immediate-ready origin | absent | absent | required durable retry | absent |
| terminal outcome | absent | absent | absent | absent | required |
| attempt-history cursor | none or issued | issued and equals current attempt number | issued and equals current attempt number | issued and equals previous attempt number | none or issued |
| last lifecycle acceptance | null only before first DTE-IP01 mutation, otherwise latest | latest accepted mutation | latest accepted mutation | latest accepted mutation | latest accepted mutation |
| completion replay | bounded history | bounded history excluding current attempt | bounded history excluding current attempt | bounded history may include previous attempt | bounded history |

Additional cross-field invariants are mandatory:

1. every current, retry, terminal, and replay attempt reference agrees with the
   same run's attempt-history ordering;
2. a current attempt number is exactly the last issued number;
3. a retry's previous attempt number is exactly the last issued number;
4. `ready` and `retry_waiting` always have a next attempt within the bound
   inclusive attempt limit;
5. a terminal success attempt is the last issued attempt;
6. terminal cancellation acknowledgement/lease expiry names the last issued
   attempt, while cancellation without an active attempt may be null;
7. terminal outcome and cancellation resolution fields agree exactly;
8. all timestamp addition and ordering is safe and database-derived;
9. completion replay keys and effect sequences are unique and monotonic;
10. no phase contains a host authority, scope identifier, transaction, queue,
   artifact locator, or mutable foreign value; and
11. unsupported or contradictory stored combinations decode as corruption,
    not a recoverable transition request.

## Operation Applicability Matrix

This matrix fixes which states each admitted operation may interpret. DTE03-D
will fix the exact accepted/idempotent/current variants and race order.

| Operation | `ready` | `attempt_granted` | `executing` | `retry_waiting` | `terminal` |
| --- | --- | --- | --- | --- | --- |
| `startAttempt` | grant when due | exact-basis replay or current | current | grant directly when due | current |
| `heartbeatAttempt` | stale/current | first accepted heartbeat enters `executing` | greater sequence renews; duplicate/lower is idempotent/current | stale/current | current |
| `completeAttempt` | replay/conflict lookup only | may accept current completion | may accept current completion | replay/conflict lookup only | replay/conflict/current lookup only |
| `requestCancellation` | terminal cancellation | record/return active request | record/return active request | terminal cancellation | current terminal outcome |
| `handleLeaseExpiry` | stale/current | early wake or pre-heartbeat loss policy | early wake or executing-loss policy | stale/current | current |
| `inspectCurrentAttempt` | inspect | inspect | inspect | inspect | inspect |

`startAttempt` must compare `expectedRunVersion` before using an allocation
candidate. Being in a startable phase is not sufficient if the command basis
is stale. `retry_waiting` additionally requires database time at or after
`notBeforeMs`.

Completion replay/conflict lookup precedes a generic “not active” response so
lost accepted responses remain recoverable after phase advancement.

## Initial Aggregate Contract

Roadmap 04's new-run transaction must create the DTE-IP01 input as:

```text
phase = ready
ready.kind = initial
runVersion = 1
attemptHistory = none
cancellation = not_requested, generation 0
lastLifecycleAcceptance = null
completionReplays = []
boundPolicy = immutable normalized task/run policy
```

`requestedEffectCursor` may be `none` or may reflect earlier run-creation
effects admitted by Roadmap 04. `eligibleAtMs` is database-derived. Run
creation stores the immutable task-definition revision and bound policy before
any attempt can be granted.

DTE-IP01 does not create, repair, or infer this aggregate. Missing or malformed
initial state is unavailable/corruption through the store port.

## Inspection Projection Consequences

`RunAttemptInspectionV1` will project this aggregate without becoming another
authority model:

- common run, definition revision, phase, run version, and attempt-history
  cursor;
- ready eligibility, current attempt/lease/heartbeat, retry eligibility, or
  terminal summary according to phase;
- current cancellation generation and state;
- bounded result commitment/failure summary where authorized; and
- no completion replay internals, raw result, raw failure cause, requested
  effect delivery state, scope, storage, artifact, or host authority.

DTE03-E fixes the exact inspection union. Its phase-specific projection must
remain exhaustive over the five admitted aggregate variants.

## Trigger Status Projection

Compatibility tests may derive Trigger-like normalized labels, but the mapping
is one-way:

| Flarex aggregate | Trigger semantic comparison |
| --- | --- |
| `ready` initial | pending/eligible work |
| `attempt_granted` | pending executing |
| `executing` | executing |
| active phase plus cancellation requested | pending cancel, without premature terminal cancellation |
| `ready` immediate retry | immediate retry continuation |
| `retry_waiting` | retrying/queued retry |
| terminal succeeded | finished/completed successfully |
| terminal cancelled | finished/canceled |
| terminal failed | finished plus mapped failure class |

Trigger-only states cannot be decoded into this aggregate by production code.
The compatibility runner must mark waitpoint, checkpoint, delayed, paused,
pending-version, TTL, batch, or product-environment scenarios as outside the
first candidate rather than weakening a phase.

## Schema And Ownership Contract

The future package owns hoisted Effect Schema values for every admitted type in
this receipt, including the five aggregate variants and their closed union.
Decoding must reject unknown fields, wrong phase-specific fields, invalid
brands, non-finite/out-of-range values, inconsistent timestamp order,
duplicate replay keys, non-monotonic cursors, and contradictory terminal/
cancellation combinations.

The decoded aggregate supplied to a pure decision is a detached recursively
immutable domain snapshot. The adapter must establish ownership before
freezing nested arrays, records, and digest bytes; it may not freeze a caller-
owned or driver-owned value in place. Completion replay result commitments
retain their DTE02 owned 32-byte digest rule.

The runtime representation is private. It is neither a public wire contract
nor a persistence row type. Roadmap 04 codecs may translate normalized tables
into it only after scope-clock validation and corruption checks.

## Decisions Closed By DTE03-B

1. `RunAttemptPhaseV1` has exactly five members.
2. Cancellation is orthogonal and has not-requested, requested, and resolved
   states; pending cancellation is not a phase.
3. A grant becomes `executing` on the first accepted heartbeat, while
   completion is valid before that heartbeat.
4. Immediate retry is `ready`; durable retry is `retry_waiting`; both store one
   accepted retry shape and eligibility time.
5. Only active phases carry current attempt/fence/lease state.
6. Terminal state carries exactly one success, cancellation, or failure
   outcome and no current execution authority.
7. Attempt and effect zero values use explicit cursor variants rather than
   weakening positive brands.
8. Direct mutation replay uses one latest-acceptance slot; completion replay is
   bounded per accepted attempt and survives later phase advancement.
9. The aggregate is a discriminated union with absent inapplicable fields, not
   a flat optional record.
10. Roadmap 04 creates the only initial `ready` aggregate; DTE-IP01 only
    transitions or inspects it.

## Exact Remaining Work

### DTE03-C — Complete

[`14-failure-retry-and-attempt-policy.md`](./14-failure-retry-and-attempt-policy.md)
fixes:

- `RunAttemptPolicyV1` validation bounds and normalization;
- the global and definition attempt-ceiling boundary;
- `TaskExecutionFailureV1` and its terminal/retry classification;
- retry eligibility and directive precedence;
- exponential backoff, stored jitter, safe timestamp arithmetic, and immediate
  versus durable selection;
- OOM/compute-profile policy for the first vertical; and
- exact failure-evaluation and typed-error order.

DTE03-C fills `boundPolicy`, `TaskRetryCauseV1`,
`TaskTerminalFailureClassV1`, and `TaskExecutionFailureV1` without adding a
phase or moving host/persistence authority into the aggregate. It also removes
the provisional attempt-limit terminal class: the last attempt's original
failure remains terminal and startable states must have another attempt.

### DTE03-D Through DTE03-G

DTE03-D fixes cancellation, heartbeat, lease, completion, and expiry transition
tables. DTE03-E fixes operation outcomes, replay receipt leaf unions, evidence,
effects, inspection, and errors. DTE03-F creates executable compatibility
vectors. DTE03-G audits and decides final admission.

## Reopening Audit

DTE03-B does not reopen DTE01 or DTE02:

- no new Trigger source symbol or runtime dependency is required;
- the package remains private and production-inert;
- all six service operations and two store operations remain unchanged;
- all command fields and identity meanings remain unchanged;
- scope, time, allocation, transaction, and effect-sequence authority remain
  with the Task System adapter;
- run creation remains outside DTE-IP01; and
- no waitpoint, scheduler, compute host, observability, or public contract is
  admitted.

## Handoff

Proceed to DTE03-D using the exact five-phase aggregate and DTE03-C policy.
Define exhaustive cancellation, heartbeat, completion, and lease-expiry race
tables without adding another phase or retry authority.

Do not create `packages/durable-task/` until DTE03-G admits the complete
lifecycle contract.

## Authority And Evidence

- [`../03-run-attempt-engine.md`](../03-run-attempt-engine.md)
- [`12-current-lifecycle-and-transition-inventory.md`](./12-current-lifecycle-and-transition-inventory.md)
- [`10-dte-ip01-input-and-store-port-contract.md`](./10-dte-ip01-input-and-store-port-contract.md)
- [`11-final-identity-admission.md`](./11-final-identity-admission.md)
- [`06-task-target-and-definition-contract.md`](./06-task-target-and-definition-contract.md)
- [`09-domain-identity-types-and-ownership.md`](./09-domain-identity-types-and-ownership.md)
- [`source-map.run-attempt-v1.json`](./source-map.run-attempt-v1.json)
- [`14-failure-retry-and-attempt-policy.md`](./14-failure-retry-and-attempt-policy.md)
- frozen Trigger source and tests at commit
  `f10bc23785e569e5d917318cf2033aabdbe96a0b`
