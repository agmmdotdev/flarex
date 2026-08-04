# DTE02-F: DTE-IP01 Input And Task System Store-Port Contract

## Status And Scope

**Status:** Complete contract receipt, refined by DTE03-E's implementability
corrections to idempotent decision replay and effect-sequence finalization.
DTE02-G final identity admission remains complete; DTE03-F's canonical vectors
and executable contract gate are complete, and DTE03-G has admitted the final
Roadmap 03 lifecycle contract. DTE-IP01 is now the next checkpoint.

This receipt fixes the exact command boundary consumed by the admitted
`@flarex/durable-task` run-attempt service and the exact semantic
`TaskSystemRunAttemptStore` surface that a later Postgres adapter must
implement. It maps every identity-bearing input retained from the selected
Trigger lifecycle source and removes Trigger product, persistence, lock,
queue, and host identities from the domain package.

This receipt does not implement the package or adapter. It does not define SQL,
tables, public APIs, run creation, scheduling, compute dispatch, result-object
storage, observability projections, or production activation. Roadmap 03 owns
and has now fixed the complete phase/transition, retry/failure, outcome,
evidence, effect, inspection, acceptance, and error contract through DTE03-E.
Roadmap 04 owns the physical Task System schema and transaction implementation.

## Correction To The DTE01 Service List

DTE01 admitted Trigger heartbeat deadline and stale-heartbeat behavior, mapped
`ExecutionSnapshotSystem.heartbeatRun` and related symbols to the package, and
required heartbeat/lease compatibility tests. Its conceptual service list,
however, named only five operations and omitted the operation that actually
renews a lease.

DTE02-F corrects that surface to six operations:

```text
startAttempt
heartbeatAttempt
completeAttempt
requestCancellation
handleLeaseExpiry
inspectCurrentAttempt
```

This is a contract correction, not a new source or behavioral admission.
Heartbeat source, lease semantics, stale-wake behavior, requested wake effects,
and tests are already inside DTE01's admitted map. Without an explicit
`heartbeatAttempt`, the implementation would have to put an authoritative
write behind a read method, let the host mutate lease state, or omit retained
behavior. All three would contradict DTE01.

The source map, dependency budget, package layout, provenance set, and
compatibility closure remain unchanged. The related DTE01 roadmap receipts are
updated only to show the sixth operation.

## Boundary Rules

### Commands Carry Domain Evidence, Not Scope Authority

Every command is used with one dynamically supplied, issuer-backed,
scope-bound Task System store under DTE02-C. A command never contains:

- tenant, organization, membership, project, or environment identity;
- deployment ID, scope ID, epoch, storage generation, or generation fence;
- physical locator, database name, connection string, or Drizzle transaction;
- application revision, active head, artifact URL, or object-store key chosen
  by the caller;
- Trigger internal/friendly ID pairs, snapshot IDs, Redis locks, queue locks,
  worker IDs, runner IDs, region, or residency; or
- host wall-clock timestamps.

The port captures scope authority out of band. Its adapter revalidates that
authority and reads database time before loading a task row in every operation.

### Commands Act On Already-Created Runs

DTE-IP01 begins with an already-created durable run. New-run creation and
`TaskRunIdV1` generation remain a separate Task System operation composed from
the Standard Application task binding under DTE02-B through DTE02-E. They are
not methods on the narrow run-attempt service or its consumed port.

Consequently:

- no DTE-IP01 command accepts `TaskIdV1`;
- no command accepts a caller-chosen `TaskDefinitionRevisionIdV1`;
- no command accepts a caller-chosen `TaskRunIdV1` during creation;
- `startAttempt` loads the run's captured definition revision; and
- the accepted start receipt carries that revision to the later runtime
  projection without interpreting it.

The broader Task System owner may later expose a separate new-run operation.
Adding it to this port merely because the same tables are involved is
prohibited.

### Canonical Commands Are Closed Values

Commands are readonly discriminated records decoded before service execution.
Unknown fields fail closed. No command contains a function, service, mutable
`Date`, arbitrary metadata record, raw payload/output body, Prisma/Drizzle
shape, or open-ended string map.

The internal TypeScript types are not public wire contracts. A later Worker or
HTTP boundary must define and validate its own encoded envelope and translate
once into these domain commands.

## Supporting Domain Values

DTE02-E already fixes the task-definition revision, run, attempt, attempt
number, and execution-fence identities. DTE02-F adds the exact monotonic and
bounded values necessary to replace Trigger snapshot, wall-clock, and queue
lock inputs without inventing generic strings.

### Monotonic Versions

The package owns these additional branded values:

| Type | Decoded representation | Range | Meaning |
| --- | --- | --- | --- |
| `TaskRunVersionV1` | `bigint` | `1..9223372036854775807` | increments for every accepted authoritative run-attempt state mutation |
| `TaskLeaseVersionV1` | `bigint` | `1..9223372036854775807` | increments for every accepted lease grant or renewal |
| `TaskCancellationGenerationV1` | `bigint` | `0..9223372036854775807` | `0` means no accepted request; each new accepted cancellation request advances it |
| `TaskRequestedEffectSequenceV1` | `bigint` | `1..9223372036854775807` | run-local order assigned when intents are persisted |

Their encoded form is canonical unsigned base-10 text with the same no-sign,
no-leading-zero, no-whitespace, signed-64-bit bounds used by DTE02-E's fence.
They are nominally distinct and cannot be substituted for one another.
Exhaustion never wraps or resets.

`TaskRunVersionV1` replaces Trigger's latest-snapshot identity as the general
optimistic lifecycle version. `TaskLeaseVersionV1` separately invalidates an
old lease-expiry wake after a heartbeat extends the same fenced execution.
`TaskExecutionFenceV1` remains the execution-ownership authority; neither run
nor lease version replaces it.

### Heartbeat Sequence

`TaskHeartbeatSequenceV1` is a positive safe integer, starting at `1` for each
attempt execution. The trusted runtime adapter increments it for each logical
heartbeat. The value is not authority; the attempt ID and fence are still
required.

The store records the greatest accepted sequence for the current fence:

- any greater sequence renews the lease once;
- an identical sequence returns an idempotent receipt without extending the
  lease again;
- a lower sequence is stale/current-authoritative;
- a sequence for another attempt or fence cannot renew anything; and
- a gap is accepted because loss of an earlier heartbeat delivery must not
  prevent a later live heartbeat from preserving the execution.

This prevents duplicate message delivery from extending a lease indefinitely.

### Database Time And Durations

`TaskDatabaseTimeMsV1` is a non-negative safe integer representing an
authoritative database-derived Unix millisecond snapshot. It is produced only
inside the store transaction and returned as evidence. It is never accepted
from a lifecycle command.

`TaskDurationMsV1` is a non-negative safe integer. Addition to database time
must remain a safe integer and within the supported persistence timestamp
range. Lease duration is immutable Layer configuration; retry delays come from
the bound run policy and completion directive. Neither is read from host time.

### Retry Jitter

`TaskRetryJitterV1` is a finite number in the half-open interval `[0, 1)`. The
trusted host supplies one sample on `startAttempt`; the store captures it with
the accepted attempt before dispatch. Completion policy later uses that stored
sample, so retrying a lost completion response cannot recalculate a different
backoff.

The sample affects delay only. It cannot authorize execution, select scope,
increase retry limits, change compute policy, or override terminal error
classification. A duplicate start returns the stored accepted sample and does
not replace it with a later caller value.

### Result Commitment

The first package does not own output bodies or their object-store locations.
It accepts only this bounded lifecycle evidence:

```ts
interface TaskResultCommitmentV1 {
  readonly codec: "flarex.task-result.v1";
  readonly byteLength: number; // non-negative safe integer
  readonly sha256: Uint8Array; // exactly 32 bytes, owned snapshot
}
```

The runtime/output owner validates and stores any body before creating this
commitment. The domain clones the digest at its boundary and never receives a
bucket, URL, path, database locator, or raw body. A later result-read roadmap
may bind the commitment to a retrievable host reference without changing
run-attempt transition policy.

### Completion And Cancellation Values

`TaskExecutionDurationMsV1` is a non-negative safe integer. It is optional
execution-usage evidence and never becomes Trigger pricing or billing input.

`TaskRetryDirectiveV1` is exactly:

```ts
type TaskRetryDirectiveV1 =
  | { readonly kind: "use_bound_policy" }
  | { readonly kind: "do_not_retry" }
  | {
      readonly kind: "override_delay";
      readonly delayMs: TaskDurationMsV1;
    };
```

An override changes only the candidate delay and remains subject to bound
attempt ceilings, retry eligibility, cancellation state, and global policy.
There is no absolute retry timestamp or caller compute-class override.

`TaskCancellationReasonV1` is a closed reason code plus an optional bounded
message. V1 codes are `requested`, `execution_cancelled`, and
`policy_cancelled`. A message is at most 1,024 UTF-8 bytes, contains no null or
control character, and is not authority or stable program logic.

`TaskExecutionFailureV1` remains the bounded, sanitized, closed failure union
admitted by DTE01 and completed by Roadmap 03. It cannot contain an arbitrary
foreign error, stack, host path, Prisma error, or Trigger product record.

### Schema Ownership

`Schema.ts` owns stable Effect Schema values named after every encoded domain
type above:

- `TaskRunVersionV1Schema`;
- `TaskLeaseVersionV1Schema`;
- `TaskCancellationGenerationV1Schema`;
- `TaskRequestedEffectSequenceV1Schema`;
- `TaskHeartbeatSequenceV1Schema`;
- `TaskDatabaseTimeMsV1Schema`;
- `TaskDurationMsV1Schema` and `TaskExecutionDurationMsV1Schema`;
- `TaskRetryJitterV1Schema` and `TaskRetryDirectiveV1Schema`;
- `TaskResultCommitmentV1Schema`;
- `TaskCancellationReasonV1Schema`; and
- the DTE02-E identity schemas.

The schemas produce branded or closed readonly domain values. Stable decoders
are hoisted. The internal boundary does not accept assertions, coercive number
parsing, mutable `Date`, or an unconstrained generic decoder.

## Exact Run-Attempt Service Commands

### Command Union

The internal command union is exactly:

```ts
type RunAttemptCommandV1 =
  | StartAttemptCommandV1
  | HeartbeatAttemptCommandV1
  | CompleteAttemptCommandV1
  | RequestCancellationCommandV1
  | HandleLeaseExpiryCommandV1
  | InspectCurrentAttemptCommandV1;
```

Every command has a literal `type`. No optional common identity bag exists.
Each variant carries only evidence that its operation actually needs.

`RunAttemptCommandV1Schema` is the closed union schema. The package also owns
one schema named for each command variant. A host decoding unknown input uses
those schemas before calling the typed service; it may not claim a command by
passing a TypeScript generic argument.

### Start Attempt

```ts
interface StartAttemptCommandV1 {
  readonly type: "start_attempt";
  readonly runId: TaskRunIdV1;
  readonly expectedRunVersion: TaskRunVersionV1;
  readonly retryJitter: TaskRetryJitterV1;
}
```

The expected run version comes from the durable discovery/wake receipt. It
replaces Trigger's expected latest snapshot ID. The command does not choose an
attempt ID, attempt number, fence, lease version, database time, definition
revision, compute class, or dispatch target.

An accepted result returns a `TaskAttemptGrantV1` containing:

- the run and captured task-definition revision IDs;
- the store-issued attempt ID and policy-owned attempt number;
- the store-issued execution fence;
- the initial lease version and database-derived expiry;
- the accepted run version;
- the immutable compute-class reference selected by policy; and
- persisted requested effects, including dispatch and lease-expiry wake.

A duplicate start with the same basis version returns the already accepted
grant as idempotent when that grant remains the direct result of the basis. A
stale start that cannot identify that exact acceptance returns current
authoritative state; it never creates another attempt.

### Heartbeat Attempt

```ts
interface HeartbeatAttemptCommandV1 {
  readonly type: "heartbeat_attempt";
  readonly runId: TaskRunIdV1;
  readonly attemptId: TaskAttemptIdV1;
  readonly executionFence: TaskExecutionFenceV1;
  readonly heartbeatSequence: TaskHeartbeatSequenceV1;
}
```

The command carries no timestamp or requested expiry. An accepted heartbeat
uses transaction database time and immutable lease duration, advances lease
and run versions, persists lease-expiry wake intent, and returns the new
database-derived expiry. Duplicate sequence delivery is idempotent and does
not extend the lease twice.

### Complete Attempt

```ts
interface CompleteAttemptCommandV1 {
  readonly type: "complete_attempt";
  readonly runId: TaskRunIdV1;
  readonly attemptId: TaskAttemptIdV1;
  readonly executionFence: TaskExecutionFenceV1;
  readonly completion: TaskAttemptCompletionV1;
}

type TaskAttemptCompletionV1 =
  | {
      readonly kind: "succeeded";
      readonly result: TaskResultCommitmentV1 | null;
      readonly executionDurationMs: TaskExecutionDurationMsV1 | null;
    }
  | {
      readonly kind: "failed";
      readonly failure: TaskExecutionFailureV1;
      readonly retry: TaskRetryDirectiveV1;
      readonly executionDurationMs: TaskExecutionDurationMsV1 | null;
    }
  | {
      readonly kind: "cancellation_acknowledged";
      readonly cancellationGeneration: TaskCancellationGenerationV1;
      readonly executionDurationMs: TaskExecutionDurationMsV1 | null;
    };
```

The attempt ID plus fence is the completion identity. The store retains the
canonical accepted completion value and resulting receipt for that composite:

- an identical redelivery returns the stored receipt as idempotent, including
  after the run advanced or the original response was lost;
- a different completion for the same attempt/fence is a typed conflict;
- a completion for an attempt/fence that never held execution is stale; and
- a cancellation acknowledgement must equal the currently requested
  generation for that execution.

There is no redundant inner run ID, caller timestamp, retry-at timestamp,
worker ID, runner ID, task ID, task-definition revision, metadata packet, raw
output, or queue control flag.

### Request Cancellation

```ts
interface RequestCancellationCommandV1 {
  readonly type: "request_cancellation";
  readonly runId: TaskRunIdV1;
  readonly reason: TaskCancellationReasonV1;
}
```

The operation loads current state and chooses whether to record a new
cancellation generation, return the existing request, or return the terminal
outcome. It does not accept Trigger's `finalizeRun`, `completedAt`,
`bulkActionId`, worker/runner identity, or transaction. Executing cancellation
produces a fenced cancellation-request effect; non-executing cancellation may
become terminal according to Roadmap 03.

The first accepted reason wins for its generation. Redelivery does not rewrite
the reason or increment the generation. A later policy requiring separately
idempotent administrative requests needs its own command identity preflight;
it is not inferred from a message string.

### Handle Lease Expiry

```ts
interface HandleLeaseExpiryCommandV1 {
  readonly type: "handle_lease_expiry";
  readonly runId: TaskRunIdV1;
  readonly attemptId: TaskAttemptIdV1;
  readonly executionFence: TaskExecutionFenceV1;
  readonly expectedLeaseVersion: TaskLeaseVersionV1;
}
```

The command is a durable wake hint. The transaction compares current attempt,
fence, and lease version and then uses database time:

- another fence or lease version is stale/current-authoritative;
- an unexpired matching lease is an early wake and returns current state plus
  at most a replacement wake intent;
- an expired matching lease runs the admitted worker-loss or pending-cancel
  policy; and
- no host-supplied timestamp decides expiry.

### Inspect Current Attempt

```ts
interface InspectCurrentAttemptCommandV1 {
  readonly type: "inspect_current_attempt";
  readonly runId: TaskRunIdV1;
}
```

Inspection returns a detached, readonly domain projection observed under fresh
scope authority and database time. It performs no heartbeat, lease extension,
effect delivery, runtime resolution, or observability query. A missing or
cross-scope run uses the same non-disclosing unavailable error.

## Service Results

Mutation operations return a `RunAttemptServiceReceiptV1<Outcome>`:

```ts
interface RunAttemptServiceReceiptV1<Outcome> {
  readonly disposition: "accepted" | "idempotent" | "current";
  readonly observedAtMs: TaskDatabaseTimeMsV1;
  readonly runVersion: TaskRunVersionV1;
  readonly outcome: Outcome;
  readonly evidence: readonly TaskRunAttemptEvidenceV1[];
  readonly requestedEffects: readonly PersistedTaskRequestedEffectV1[];
}
```

`accepted` means this call committed a new authoritative transition.
`idempotent` means it reconstructed the exact earlier acceptance. `current`
means the supplied wake/version no longer applies and the call returns the
current authorized state without pretending the old command succeeded.

Only `accepted` receipts may contain newly persisted evidence/effects.
Idempotent receipts return the exact stored acceptance evidence/effects by
persisted sequence and semantic identity, not newly assigned duplicates.
Current receipts return no newly requested effects. DTE03-D deliberately makes
an early lease-expiry wake current/no-write rather than accepting a replacement
wake.

Inspection returns `RunAttemptInspectionV1`, containing the run ID, captured
definition revision ID, current run version and phase, cancellation generation,
current attempt/fence/lease summary when present, and terminal summary when
present. It excludes payloads, raw results, effect-delivery internals, scope,
artifact location, and persistence rows.

The exact service shape is:

```ts
interface RunAttemptLifecycleShape {
  readonly startAttempt: (
    command: StartAttemptCommandV1,
  ) => Effect.Effect<
    RunAttemptServiceReceiptV1<StartAttemptOutcomeV1>,
    RunAttemptLifecycleErrorV1
  >;

  readonly heartbeatAttempt: (
    command: HeartbeatAttemptCommandV1,
  ) => Effect.Effect<
    RunAttemptServiceReceiptV1<HeartbeatAttemptOutcomeV1>,
    RunAttemptLifecycleErrorV1
  >;

  readonly completeAttempt: (
    command: CompleteAttemptCommandV1,
  ) => Effect.Effect<
    RunAttemptServiceReceiptV1<CompleteAttemptOutcomeV1>,
    RunAttemptLifecycleErrorV1
  >;

  readonly requestCancellation: (
    command: RequestCancellationCommandV1,
  ) => Effect.Effect<
    RunAttemptServiceReceiptV1<RequestCancellationOutcomeV1>,
    RunAttemptLifecycleErrorV1
  >;

  readonly handleLeaseExpiry: (
    command: HandleLeaseExpiryCommandV1,
  ) => Effect.Effect<
    RunAttemptServiceReceiptV1<HandleLeaseExpiryOutcomeV1>,
    RunAttemptLifecycleErrorV1
  >;

  readonly inspectCurrentAttempt: (
    command: InspectCurrentAttemptCommandV1,
  ) => Effect.Effect<
    RunAttemptInspectionV1,
    RunAttemptLifecycleErrorV1
  >;
}
```

The outcome names are fixed service owners; Roadmap 03 supplies their exact
closed variants from the admitted transition table. No operation returns a
generic database value or Trigger result shape.

Roadmap 03 owns the exact closed `Outcome`, phase, evidence, terminal, retry,
and cancellation unions. It may refine names inside those owners but cannot
add an authority-bearing command field or weaken the dispositions above.

## Exact `TaskSystemRunAttemptStore` Surface

The domain-owned port has exactly two operations:

```ts
interface TaskSystemRunAttemptStoreShape {
  readonly transactRunAttempt: <Outcome>(
    request: TaskSystemRunAttemptTransactionV1<Outcome>,
  ) => Effect.Effect<
    TaskSystemRunAttemptTransactionReceiptV1<Outcome>,
    TaskSystemRunAttemptStoreErrorV1
  >;

  readonly inspectRunAttempt: (
    request: TaskSystemRunAttemptInspectionRequestV1,
  ) => Effect.Effect<
    TaskSystemRunAttemptInspectionSnapshotV1,
    TaskSystemRunAttemptStoreErrorV1
  >;
}
```

There is no `findRun`, `updateRun`, generic query, transaction getter, raw
clock, append-snapshot method, effect insert, ID generator, or Drizzle-shaped
method. The scope-bound port is obtained dynamically and is not a singleton
cross-scope service.

### Transaction Request

```ts
interface TaskSystemRunAttemptTransactionV1<Outcome> {
  readonly operation:
    | "start_attempt"
    | "heartbeat_attempt"
    | "complete_attempt"
    | "request_cancellation"
    | "handle_lease_expiry";
  readonly runId: TaskRunIdV1;
  readonly decide: (
    input: TaskSystemRunAttemptDecisionInputV1,
  ) => Result.Result<
    TaskRunAttemptDecisionV1<Outcome>,
    RunAttemptDecisionErrorV1
  >;
}
```

The callback is an in-process pure decision seam, not serializable data. It
must not call Effect, return a Promise, read a clock/random source, mutate its
input, retain adapter-owned values, or perform I/O. The adapter may invoke it
more than once when a serializable transaction is retried, so evaluation must
be deterministic for the supplied input.

### Decision Input

The adapter opens a transaction on its captured target, validates the scope
clock, loads and decodes the domain aggregate, and then supplies:

```ts
interface TaskSystemRunAttemptDecisionInputV1 {
  readonly databaseNowMs: TaskDatabaseTimeMsV1;
  readonly current: TaskRunAttemptAggregateV1;
  readonly attemptGrantCandidate: TaskAttemptGrantCandidateV1 | null;
}
```

`TaskRunAttemptAggregateV1` is the minimum domain state required by the
admitted policy: captured definition revision, run version/phase, immutable
retry/compute/lease policy, attempt ordinal, current attempt/fence/lease,
cancellation generation, bounded accepted-completion replay evidence, terminal
outcome, and pending effect-order evidence. It is a detached readonly domain
value, not a row or public read model.

`attemptGrantCandidate` is non-null only for `start_attempt`. It contains the
adapter-issued attempt ID and fence plus the next policy ordinal derived under
the same locked state. A decision may use it only when it accepts a new grant.
Unused candidates create no row and are not exposed. A transaction retry may
receive a different uncommitted candidate.

This allocation seam preserves both owners:

- the Task System adapter generates IDs/fences inside authoritative storage;
  and
- the domain policy decides whether current lifecycle state permits a grant.

### Decision Result

```ts
type TaskRunAttemptDecisionV1<Outcome> =
  | {
      readonly kind: "no_change";
      readonly disposition: "idempotent";
      readonly replay: TaskRunAttemptAcceptedReceiptV1<Outcome>;
    }
  | {
      readonly kind: "no_change";
      readonly disposition: "current";
      readonly outcome: Outcome;
    }
  | {
      readonly kind: "commit";
      readonly expectedRunVersion: TaskRunVersionV1;
      readonly next: TaskRunAttemptAggregateV1;
      readonly evidence: readonly TaskRunAttemptEvidenceV1[];
      readonly requestedEffects:
        readonly PersistedTaskRequestedEffectV1[];
      readonly outcome: Outcome;
    };
```

For `commit`, the adapter must require the current stored run version to equal
`expectedRunVersion`, require `next.runVersion` to advance exactly once, and
validate every operation-specific fence/lease/completion invariant before
writing. It validates that the decision's proposed effect sequences begin at
the current cursor plus one, remain contiguous in array order, agree with the
accepted run/version, and equal the cursor stored in `next`. It atomically
stores the aggregate mutation, evidence, accepted completion replay value,
terminal result commitment, and requested effects. Transactional validation is
the authoritative sequence assignment.

For `no_change`, the adapter writes nothing. An idempotent decision returns only
the exact `TaskRunAttemptAcceptedReceiptV1` selected from the latest direct
acceptance or completion replay; the adapter reconstructs the service receipt
from it. A current decision returns its current outcome, and the adapter uses
the transaction observation time/current version plus empty evidence/effects.

A `RunAttemptDecisionErrorV1` causes rollback/no write and is lifted by
`RunAttemptLifecycle` into its typed Effect error channel. The store never
converts a rejected decision into a partial commit.

### Transaction Receipt

The adapter returns detached readonly domain values:

- the database time used by the accepted/current decision;
- accepted/idempotent/current disposition;
- resulting run version and operation outcome;
- persisted evidence generated by this acceptance or reconstructed from an
  earlier acceptance; and
- requested effects with their assigned sequences.

The receipt contains no transaction/client, SQL result, row, scope authority,
locator, generated-ID callback, or unvalidated JSON. A commit-response loss is
recovered by rerunning the same service command and reconstructing the stored
idempotent receipt.

### Inspection Request

The inspection request contains only `runId`. The adapter opens a read
transaction, validates scope clock first, loads and decodes current state, and
returns current domain state plus database observation time. It may not return
from a replica or cache whose freshness cannot prove the same authority.

## Durable Requested Effects

The pure `TaskRequestedEffectV1` union contains exactly these first-version
kinds:

- `dispatch_attempt` with run, definition revision, attempt, attempt number,
  fence, lease version, and immutable compute-class reference;
- `continue_retry` for an immediate but still durable continuation;
- `wake_retry` with accepted run version and database-derived not-before time;
- `wake_lease_expiry` with attempt, fence, lease version, and not-before time;
- `request_execution_cancellation` with attempt, fence, and cancellation
  generation;
- `release_queue_ownership` naming only the run and accepted lifecycle cause;
- `publish_lifecycle_event` with a bounded domain event projection;
- `notify_current_state` with run and accepted run version; and
- `cancel_obsolete_lease_wake` with the exact attempt/fence/lease version being
  superseded.

Waitpoint, checkpoint, batch, child-run, debounce, delayed-run, stream,
billing, metadata, and arbitrary host callback variants are not admitted.

The pure decision deterministically proposes `TaskRequestedEffectSequenceV1`
from the decoded aggregate cursor, and the store validates and commits that
exact contiguous range while persisting the transition. This correction is
required so `next`, its replay receipt, and its effect cursor are already one
coherent atomic value. The decision cannot choose another starting sequence,
and the store remains the assignment authority. The persisted effect identity
is the scope-bound `(TaskRunIdV1, sequence)` pair. Delivery adapters use that
pair idempotently, but possession of it does not authorize a task transition.

An effect consumer may fail, retry, duplicate, or arrive late without changing
the already committed lifecycle state. It reacquires scope authority and
fetches current state where its effect kind requires freshness.

## Error Contract

### Store Error Union

`TaskSystemRunAttemptStoreErrorV1` is exactly:

- `TaskSystemRunAttemptUnavailableError` for absent or cross-scope state using
  one non-disclosing projection;
- `TaskSystemRunAttemptCorruptionError` for malformed or contradictory stored
  task state, binding reference, completion replay evidence, or effect order;
- `TaskSystemRunAttemptStaleScopeAuthorityError` for epoch/generation/locator
  authority that must be reacquired;
- `TaskSystemRunAttemptTransientStoreError` for a bounded retryable foreign
  persistence failure whose transaction did not produce an accepted receipt;
  and
- `TaskSystemRunAttemptTerminalStoreError` for unsupported integration,
  placement, transaction capability, or exhausted identity/fence/version
  allocation that cannot be retried as an ordinary store outage.

Each is a tagged domain-port error with operation and safe detail. Foreign
causes are mapped once at the persistence adapter, retained as causes where
safe, and never exposed as Prisma/Drizzle/Postgres public types.

### Decision Error Union

`RunAttemptDecisionErrorV1` is exactly:

- `InvalidRunAttemptTransitionError`;
- `StaleTaskRunVersionError`;
- `StaleTaskExecutionFenceError`;
- `ConflictingTaskAttemptCompletionError`;
- `InvalidTaskCancellationAcknowledgementError`;
- `TaskRunAttemptPolicyError`; and
- `TaskRunAttemptCounterExhaustedError`.

DTE03-E refines `StaleTaskRunVersionError` and
`StaleTaskExecutionFenceError` to impossible accepted-commit proposals whose
basis/fence disagrees with decoded current state. Ordinary old command delivery
returns the operation's typed `current` outcome under DTE03-D; it does not enter
the error channel.

Attempt exhaustion, retry exhaustion, non-retryable execution failure, and
ordinary cancellation are accepted lifecycle outcomes, not thrown errors.
Malformed foreign command input is decoded before service invocation into
`InvalidRunAttemptCommandError`. Illegal state that came from storage is
corruption, not an invalid command.

The exported `RunAttemptLifecycleErrorV1` combines the command, decision, and
store unions without collapsing them to `Error`. Backend authentication and
active-selection errors occur before the service and do not enter this union.

## Trigger Identity And Field Mapping

### Selected Method Inputs

| Trigger retained input | Flarex mapping | Decision |
| --- | --- | --- |
| `runId: string` | `TaskRunIdV1` on every operation | retain meaning; replace Trigger internal/friendly aliasing |
| `snapshotId: string` on start | `expectedRunVersion: TaskRunVersionV1` | replace timestamp/latest-snapshot identity with monotonic lifecycle evidence |
| `snapshotId: string` on heartbeat | `attemptId + executionFence + heartbeatSequence` | replace snapshot identity with explicit ownership and idempotent renewal delivery |
| `snapshotId: string` on expiry | `attemptId + executionFence + expectedLeaseVersion` | make an old expiry wake stale after a renewal of the same execution |
| `snapshotId: string` on completion | `attemptId + executionFence` plus stored canonical completion replay evidence | replace snapshot equality with fenced idempotent completion |
| `completion.id` | removed | it redundantly repeats run identity; mismatched legacy input is rejected at the adapter |
| `completion.output` / `outputType` | `TaskResultCommitmentV1 | null` | retain bounded result evidence, remove raw body/storage location |
| `completion.error` | `TaskExecutionFailureV1` | seam-adapt into bounded Flarex failure union |
| `completion.retry.timestamp` | removed | database time plus validated delay owns eligibility |
| `completion.retry.delay` | `TaskRetryDirectiveV1.override_delay` | retain delay meaning under bound retry policy |
| `completion.skippedRetrying` | `TaskRetryDirectiveV1.do_not_retry` | retain explicit no-retry meaning |
| `completion.usage.durationMs` | `TaskExecutionDurationMsV1 | null` | retain duration evidence; discard pricing |
| cancellation `reason` | `TaskCancellationReasonV1` | retain bounded domain reason |
| cancellation `finalizeRun` | explicit `cancellation_acknowledged` completion or state-derived immediate finalization | remove caller Boolean that bypasses lifecycle meaning |
| `isWarmStart` | removed from lifecycle command | compute/runtime observability evidence, not transition authority |
| `forceRequeue` | `handleLeaseExpiry`/failure policy | remove caller queue control; domain decides durable versus immediate retry |
| `workerId` / `runnerId` | removed | compute-provider observability identity does not authorize lifecycle |
| `environmentId` | scope-bound store capability | remove caller scope text |
| `tx` / Prisma client | adapter-owned transaction | remove persistence authority from domain |
| `completedAt`, `failedAt`, `retryAt`, heartbeat timestamps | transaction database time and derived durations | remove host wall-clock authority |
| `bulkActionId` | excluded | batch/bulk behavior is outside DTE-IP01 |

### Retained Store/Row Evidence

| Trigger field or relation used by retained logic | Flarex owner |
| --- | --- |
| run `id` and `friendlyId` | one `TaskRunIdV1`; no alias pair |
| snapshot `id` / latest-by-created-time | `TaskRunVersionV1`, fence, and lease version depending on operation |
| `attemptNumber` | `TaskAttemptNumberV1` |
| current lock/worker ownership | current `TaskAttemptIdV1`, `TaskExecutionFenceV1`, and durable lease |
| `lockedById`, `lockedQueueId`, queue message identity | removed from aggregate; represented by durable semantic effects |
| retry configuration and `maxAttempts` | immutable validated `RunAttemptPolicyV1` captured with the run |
| `machinePreset` | opaque Flarex compute-class reference under bound compute policy |
| `executedAt`, `startedAt`, `completedAt`, snapshot `createdAt` | database-derived `TaskDatabaseTimeMsV1` evidence |
| snapshot execution/run statuses | Flarex closed phase and terminal unions from Roadmap 03 |
| execution snapshots needed for authority | ordered `TaskRunAttemptEvidenceV1`; no UI snapshot row contract |
| output/error | result commitment or bounded execution failure |
| usage duration | optional bounded execution duration |
| cost/base cost/plan/environment pricing type | discarded |
| task identifier/version used for execution context | captured `TaskDefinitionRevisionIdV1`; task ID display remains outside lifecycle |

### Product And Runtime Projection Fields Removed

Selected orchestration must not reintroduce the discarded Trigger execution
context. Organization ID, project ID, runtime-environment ID/slug/type/branch,
deployment ID/version, task export path, worker/runner ID, queue ID/name,
region, residency, machine pricing, SDK/CLI version, git metadata, trace/span
context, parent/root run, batch, tags, metadata packets, checkpoint, waitpoint,
and Trigger auth/billing values are absent from DTE-IP01 commands and store
port types.

Some of those concepts may later have Flarex-owned runtime or observability
projections. They are not renamed fields in this package. The runtime host
resolves `TaskDefinitionRevisionIdV1` through DTE02-D and combines the accepted
attempt grant with separately authorized compute context.

## Service And Layer Composition

`RunAttemptLifecycle` remains a `Context.Service`. Its six operations are named
`Effect.fn` implementations over the scope-bound store. The live Layer owns
immutable attempt ceiling, lease duration, immediate-retry threshold, bounded
message limits, and other policy configuration admitted by DTE01/Roadmap 03.

The dynamically selected store is supplied at the operation composition
boundary. A host may construct a scoped lifecycle service over that store or
provide the store directly to a scoped effect. It may not install one store in
a process-global Layer shared across scopes.

The package owns no runtime bridge. Backend request/queue/alarm handlers own
the eventual `Effect.runPromise` boundary and release scoped resources after
the operation.

## Package-Boundary Consequences

DTE02-F does not reopen DTE01 package admission:

- runtime dependency remains only root-catalog `effect`;
- private export remains `./internal/run-attempt-v1`;
- no protocol, persistence, backend, Trigger, Node, crypto, Cloudflare, or
  utility import is added;
- the two-operation semantic port fits the admitted service/Layer ownership;
- heartbeat makes already-admitted behavior callable rather than adding new
  source; and
- run creation stays outside the package.

The internal subpath may export the six service commands/results, the exact
identity/version schemas required to construct them, the service and store
contracts, the typed error unions, and the live Layer constructor. It must not
export the transaction decision callback as a public persistence extension
point beyond the private adapter contract, row codecs, effect-delivery APIs,
or Trigger compatibility types.

The DTE01 machine-readable source map needs no new entry. When DTE-IP01 creates
the package, its active copy records target hashes and the heartbeat operation
in the implementation change receipt.

## Proof Matrix

DTE-IP01 focused tests must prove:

1. command schemas reject unknown fields and every authority-bearing field
   removed above;
2. the six service operations require only the store and immutable policy;
3. start allocates attempt/fence only inside the store and duplicate/competing
   starts do not allocate accepted duplicates;
4. heartbeat sequence redelivery does not extend a lease twice;
5. an old lease-expiry wake is stale after renewal even with the same fence;
6. identical completion redelivery reconstructs the same receipt and effects;
7. conflicting completion for one attempt/fence fails;
8. cancellation generation races completion deterministically;
9. database time, not host time, determines lease and retry eligibility;
10. pure decisions are deterministic and safe to reinvoke;
11. evidence and effect array order is preserved;
12. no-change decisions persist nothing;
13. store/decision/command error variants remain exhaustive in the Effect
    channel; and
14. the package typechecks and bundles with only `effect`.

Roadmap 04 must additionally prove:

1. scope clock is validated before row lookup in every transaction;
2. the callback observes authoritative decoded state and database time;
3. run version compare, state/evidence/result/effects, and effect sequences
   commit atomically;
4. serialization retries may reinvoke the pure decision without duplicating
   accepted IDs or effects;
5. commit-response loss reconstructs idempotent acceptance;
6. stale fences cannot heartbeat, complete, or acknowledge cancellation;
7. identity/version/fence/cancellation/lease exhaustion never wraps;
8. stored corruption is distinct from absence and transient failure;
9. cross-scope IDs are non-disclosing; and
10. PGlite and real Postgres agree except where real concurrency proof is
    explicitly Postgres-only.

Static package checks must reject command/store fields named `organizationId`,
`projectId`, `environmentId`, `deploymentId`, `scopeId`, `snapshotId`,
`workerId`, `runnerId`, `tx`, `prisma`, `drizzle`, `redis`, `region`, or
`residency` in the admitted internal contract.

## Explicit Non-Goals

DTE02-F does not authorize:

- new-run creation in `RunAttemptLifecycle`;
- a task-definition/runtime binding loader in the domain package;
- a generic repository or transaction callback exposed to application code;
- a heartbeat timestamp supplied by a Worker;
- raw task input, output, metadata, trace, log, or stream bodies;
- output object-store layout or retrieval API;
- queue IDs, concurrency keys, Redis locks, or queue acknowledgement authority;
- waitpoints, checkpoints, child runs, batches, debounce, cron, TTL, or delayed
  run commands;
- compute-provider worker/runner identity as a fence;
- public API/SDK schemas;
- observability read models or live APIs;
- SQL, Drizzle schema, migrations, or production adapter; or
- production activation.

## Decision Receipt

DTE02-F is complete with these conclusions:

1. DTE-IP01 exposes six lifecycle operations, adding explicit
   `heartbeatAttempt` for behavior already admitted by DTE01;
2. commands carry only run/attempt lifecycle evidence and never raw scope,
   product, persistence, clock, lock, queue, or compute-host authority;
3. DTE-IP01 acts on already-created runs and does not own task lookup,
   definition binding, run creation, or run-ID generation;
4. start uses expected run version and store-issued attempt/fence evidence;
5. heartbeat uses attempt/fence plus attempt-local sequence, while lease-expiry
   wakes additionally carry expected lease version;
6. completion identity is the attempt/fence composite plus canonical
   completion value, supporting identical replay and conflicting-redelivery
   detection without another caller-generated ID;
7. cancellation generation, run version, lease version, database time, retry
   jitter, result commitment, and effect sequence now have exact owners and
   representations;
8. `TaskSystemRunAttemptStore` has only `transactRunAttempt` and
   `inspectRunAttempt`, with a pure re-invocable decision callback and no CRUD,
   row, transaction, clock, or ID-generator leakage;
9. the pure decision proposes cursor-derived contiguous effect sequences, and
   the adapter validates and persists accepted state, evidence, completion
   replay data, sequenced effects, and the cursor atomically before returning
   detached domain receipts;
10. every retained Trigger identity field has an explicit Flarex mapping or
    removal rationale;
11. exact command, decision, and store error meanings remain in the typed
    Effect channel; and
12. no DTE01 dependency/export/source-map reopening condition is triggered;
    DTE02-G now admits the consolidated contract in
    [`11-final-identity-admission.md`](./11-final-identity-admission.md).

## Authority And Evidence

This decision is grounded in:

- DTE01's source closure, symbol map, package boundary, compatibility harness,
  and final package admission receipts;
- selected Trigger `RunAttemptSystem.startRunAttempt`, completion, failure,
  cancellation, and recovery flows;
- selected Trigger `ExecutionSnapshotSystem` latest-snapshot and heartbeat
  behavior;
- selected Trigger `RunStore` transactional/read-your-writes semantics;
- Trigger `TaskRunExecutionResult`, `StartRunAttemptResult`, and
  `CompleteRunAttemptResult` schemas as compatibility inputs only;
- [`07-scope-capability-contract.md`](./07-scope-capability-contract.md);
- [`08-application-revision-and-runtime-binding.md`](./08-application-revision-and-runtime-binding.md);
- [`09-domain-identity-types-and-ownership.md`](./09-domain-identity-types-and-ownership.md);
- DTE03-E's
  [`16-operation-outcomes-evidence-effects-and-errors.md`](./16-operation-outcomes-evidence-effects-and-errors.md);
  and
- [`../02-task-definition-identity-and-scope.md`](../02-task-definition-identity-and-scope.md).
