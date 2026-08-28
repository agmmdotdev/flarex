# QSYNC01-C3 Bounded Evaluation Orchestration Preflight

## Status

**Preflight status:** proposed on 2026-08-28 for explicit review and approval.
This document is not implementation authority until the user approves this
exact C3 contract. The package remains private, runtime-neutral,
reference-backed, and production-inert.

`QSYNC01-A`, `QSYNC01-B`, `QSYNC01-C1`, and `QSYNC01-C2` are complete. C2
established durable, revision-fenced evaluation selection and replay-safe
evaluation-attempt outcomes. C3 may orchestrate those capabilities; it may not
replace their transition authority or add another work-state owner.

Approval of this document authorizes only the bounded C3 implementation and
reference proof described below. It does not authorize C4 publication
delivery, a real state/source/evaluator adapter, Flarex or Cloudflare
composition, or a production caller.

## Decision

C3 adds one plain namespace-bound coordinator to `@flarex/query-sync` with
three caller-driven operations:

1. catch durable namespace state up to one exact admitted source authority;
2. register and evaluate one initial query without accepting caller-supplied
   namespace, model, or epoch authority; and
3. run one bounded turn of already-durable evaluation work.

Catch-up and refresh are shared internal state machines. Initial evaluation and
dirty evaluation share one evaluator, artifact-capture, refresh-to-current, and
atomic-completion pipeline. There is no separate recovery operation. A restart
passes a null evaluation-scan hint and C2 rediscovers the durable provisional or
dirty active query.

C3 may complete an evaluation and thereby create C1's durable pending
publication intent. It never claims, attempts, records, or completes
publication delivery. Those operations remain exclusively C4.

## Completed Prerequisites

The implementation prerequisites are present:

- `QSYNC01-A` completed the portable transition kernel in `bd7dc357`;
- `QSYNC01-B` completed the admitted change and semantic state boundary in
  `51b52695`;
- `QSYNC01-C1` completed retry-safe evaluation begin/completion and atomic
  publication intent in `b6621cf3`; and
- `QSYNC01-C2` completed durable work selection and attempt state in
  `1df70907`.

The C2 receipt records 17 test files and 168 tests plus package typecheck,
Effect-boundary, lint, diff, staged-diff, and both standing-reviewer gates.
That reference evidence does not prove a real database, Cloudflare runtime, or
production evaluator.

## Authority, Trust, And Lifecycle Boundary

The factory captures one already-canonical `NamespaceCursor` as its bootstrap
binding. Its namespace, sync-model, and source-epoch fields bind the source,
state, evaluator, every request, and every returned artifact. The bootstrap
sequence is construction-only initialization evidence; after initialization,
the durable state cursor is the sole catch-up cursor authority.

Callers may supply a `QueryDescriptor` for initial registration. They may not
supply a `QueryOperationTarget`, namespace, model, epoch, active-generation
fence, dirty frontier, source cursor, authority witness, or evaluation
generation. The coordinator constructs the first-registration request from its
binding with `expectedActiveGeneration: null` and
`requestedDirtyThroughSequence: null`. C2 state issues every evaluation
attempt.

`AdmittedChangeSource`, `QuerySyncTransitionState`, and `QueryEvaluator` are
trusted static adapter code. Input and output values still undergo the existing
capture, nominal-evidence, and authority checks. Trusted code does not permit
the coordinator to assert a crossed or mutable artifact into authority.

The coordinator is a plain multi-instance value, not a Context service. It
contains only the frozen binding and policy plus captured source, state, and
evaluator capabilities. All counters, page buffers, refresh batches, artifacts,
and scan hints are method-local.

The production coordinator adds no Layer, Scope, Fiber, Ref, SynchronizedRef,
runtime, runner, lease, owner token, alarm, wake, or background process. It
acquires no resource and owns no lifecycle. The testing-only scripted evaluator
may own synchronized harness state for deterministic calls and races; that
state is never orchestration or work authority. Several namespace coordinators
and concurrent calls may coexist; semantic state transactions and C1/C2 fences
decide their races.

## Exact Files, Export, And Dependencies

C3 may add exactly:

- `packages/query-sync/src/orchestration/Model.ts`;
- `packages/query-sync/src/orchestration/Errors.ts`;
- `packages/query-sync/src/orchestration/Ports.ts`;
- `packages/query-sync/src/orchestration/CatchUp.ts`;
- `packages/query-sync/src/orchestration/Evaluation.ts`;
- `packages/query-sync/src/orchestration/Coordinator.ts`;
- `packages/query-sync/src/orchestration/index.ts`;
- `packages/query-sync/src/testing/conformance/ReferenceQueryEvaluator.ts`;
- `packages/query-sync/test/catchUpOrchestration.test.ts`; and
- `packages/query-sync/test/evaluationOrchestration.test.ts`.

C3 may modify exactly:

- `packages/query-sync/package.json` to add
  `"./internal/orchestration": "./src/orchestration/index.ts"`;
- `packages/query-sync/src/testing/conformance/index.ts` to export the
  reference evaluator;
- `packages/query-sync/test/fixtures.ts` only for connected C3 captured
  builders;
- this preflight, the query-sync README, and the C umbrella only for linkage,
  status, and the eventual implementation receipt.

No kernel, change, state, or reference-reducer semantic contract is modified.
A discovered need for a new state receipt, aggregate read, cursor-only write,
claim token, or transition is a C3 preflight amendment and separate approval,
not implementation convenience.

No package, root export, dependency, lockfile change, persisted codec, schema,
or migration is added. The existing `effect` and `@flarex/utils` dependency
boundary remains unchanged.

## Coordinator Construction And Operations

The exact construction shape is:

```ts
interface NamespaceQuerySyncInput {
  readonly bootstrapCursor: NamespaceCursor
  readonly source: AdmittedChangeSource
  readonly state: QuerySyncTransitionState
  readonly evaluator: QueryEvaluator
  readonly policy: NamespaceQuerySyncPolicy
}

interface EvaluationWorkTurnRequest {
  readonly continuation: EvaluationWorkScanContinuation | null
}

interface NamespaceQuerySync {
  readonly catchUp: (
    budget: CatchUpTurnBudget,
  ) => Effect.Effect<CatchUpTurnOutcome, CatchUpTurnError, never>

  readonly beginQuery: (
    descriptor: QueryDescriptor,
    budget: EvaluationTurnBudget,
  ) => Effect.Effect<BeginQueryTurnOutcome, BeginQueryTurnError, never>

  readonly runEvaluationWork: (
    request: EvaluationWorkTurnRequest,
    budget: EvaluationTurnBudget,
  ) => Effect.Effect<
    EvaluationWorkTurnOutcome,
    EvaluationWorkTurnError,
    never
  >
}

declare function makeNamespaceQuerySync(
  input: NamespaceQuerySyncInput,
): Result.Result<
  NamespaceQuerySync,
  NamespaceQuerySyncConstructionError
>
```

Construction is pure. It captures and freezes the bootstrap cursor and policy,
rejects an invalid policy through Effect v4 `Result`, and performs no I/O.
Returned operations are named `Effect.fn` values with custom requirement
channel `never`. Dependencies are supplied only at construction.

Construction validation order is bootstrap cursor, state attempts, source
attempts, retry-delay pair from left to right, then settlement reserve.
Operation validation follows the turn-budget field order listed below.
`beginQuery` then captures its descriptor before reading Clock. This order is
part of deterministic first-failure behavior.

`NamespaceQuerySyncConstructionError` is exactly the existing namespace-cursor
capture error or `InvalidNamespaceQuerySyncPolicyError`. The latter identifies
one exact policy field and violated hard constraint without retaining the
caller's mutable policy object.

`catchUp` returns after one bounded ordered catch-up turn.

`beginQuery` first captures an owned descriptor before any asynchronous work,
then catches the namespace up and submits only the exact first-registration
request described above. A created or replayed state-issued attempt enters the
common evaluation pipeline. An already-active query is a value outcome; C3 does
not manufacture a rerun fence from incomplete state. Later invalidation-driven
work is selected through C2 by `runEvaluationWork`.

`runEvaluationWork` first catches the namespace up, then claims and evaluates
up to the caller's bounded query count. Its input continuation is either null
or the exact process-local C2 scan continuation returned by an earlier call in
the same authority process.

`recoverEvaluationWork` is deliberately not added. Null-continuation
`runEvaluationWork` is the restart path, and a second method would duplicate
the same durable state machine.

## Pure Policy And Budget Capture

`NamespaceQuerySyncPolicy` contains exactly:

- `stateAttemptsPerOperation`, a positive safe integer no greater than 3;
- `sourceAttemptsPerRead`, a positive safe integer no greater than 3;
- `retryDelayMilliseconds`, an owned frozen pair of non-negative safe
  integers, each no greater than 60,000; attempt two uses the first member and
  attempt three uses the second; and
- `settlementReserveMilliseconds`, a positive safe integer less than 60,000.

```ts
interface NamespaceQuerySyncPolicy {
  readonly stateAttemptsPerOperation: number
  readonly sourceAttemptsPerRead: number
  readonly retryDelayMilliseconds: readonly [number, number]
  readonly settlementReserveMilliseconds: number
}
```

An operation call supplies a fresh captured turn budget. No caller supplies an
absolute deadline or clock instant.

`CatchUpTurnBudget` contains:

- `sourceReads` in `[1, 32]`;
- `admittedBatches` in `[1, 4_096]`;
- `sourceTransportBytes` in `[1, 16 MiB]`;
- `modelSemanticWorkUnits` in `[1, 65_536]`;
- `modelSemanticBytes` in `[1, 16 MiB]`;
- `dependencyKeyExaminations` in `[1, 65_536]`;
- `canonicalDependencyBytes` in `[1, 16 MiB]`; and
- `newWorkWindowMilliseconds` in `[1, 60_000]` and strictly greater than the
  captured settlement reserve.

`EvaluationTurnBudget` extends that exact budget with:

- `evaluatedQueries` in `[1, 32]`; and
- `evaluatorCallsPerQuery` in `[1, 2]`.

```ts
interface CatchUpTurnBudget {
  readonly sourceReads: number
  readonly admittedBatches: number
  readonly sourceTransportBytes: number
  readonly modelSemanticWorkUnits: number
  readonly modelSemanticBytes: number
  readonly dependencyKeyExaminations: number
  readonly canonicalDependencyBytes: number
  readonly newWorkWindowMilliseconds: number
}

interface EvaluationTurnBudget extends CatchUpTurnBudget {
  readonly evaluatedQueries: number
  readonly evaluatorCallsPerQuery: number
}
```

The coordinator always requests C2's full maximum 4,096 query inspections per
claim. A smaller process-local scan chunk can starve later canonical keys after
repeated host restarts because a scan continuation is intentionally not
serializable. A turn makes at most `evaluatedQueries + 1` claim calls. A
`continued` or `scanRestarted` receipt ends the current step and returns a
continuation rather than looping under revision churn.

All numbers reject zero where positive is required, negative values,
fractions, NaN, infinity, unsafe integers, and values above the hard maximum.
The captured policy and budgets are owned and frozen; caller mutation cannot
alter an executing turn. Because Effect operations are lazy, per-call descriptor
and budget capture occurs as the first synchronous step when the Effect starts,
before Clock or any capability call. Mutation before the Effect is executed is
outside the operation; mutation after execution begins cannot alter the
captured turn.

## Shared Budget Charging

One turn ledger is shared by initial catch-up, post-evaluation durable catch-up,
and every refresh reread for every query in that operation. The limits are not
additive per phase or per query.

- Every physical admitted-source invocation, including a retry of the same
  request, consumes one of the shared 32 source-read units. One exact request
  is additionally bounded by `sourceAttemptsPerRead`. C3 can therefore never
  multiply the 32-call turn ceiling by the retry maximum.
- Every page batch returned consumes one admitted-batch unit and reserves that
  unit for its first semantic state apply. A discarded page retains the charge.
  The first apply and physical retries of the exact state operation do not
  debit the unit again.
- Page `sourceTransportBytes` and projection metrics are charged immediately
  and cumulatively, including work from a page later discarded because the
  turn stops.
- Each source call receives a `ChangeReadBudget` made from the remaining
  cumulative allowances. `committedBatches` is
  `min(remaining admitted batches, 1_024)`; every other member is the remaining
  allowance, never above B's existing per-read maximum.
- All physical evaluator calls count, including transient retries,
  resnapshots, and reruns. The two-call per-query ceiling therefore means two
  total evaluator invocations, not two logical evaluations each with three
  hidden attempts.
- A refresh source read is also a global source read. The umbrella maximum of
  32 refresh reads for one query is consequently a derived secondary ceiling,
  never an additional 32 reads for each of 32 queries.

Progress counts both admitted batches and settled batch transitions, but only
the admitted-batch counter owns the caller's 4,096 allowance. Because a
transition can only consume a previously charged page batch, first state
transitions are also bounded by 4,096 without double-debiting the budget.

If an indivisible source unit cannot fit the remaining caller allowance, the
existing `budgetInsufficient` evidence is returned. C3 never widens a remaining
budget to make progress and never hides already-consumed source work.

## Catch-Up State Machine

Catch-up is sequential:

1. call `initializeOrInspectNamespace` with the captured bootstrap cursor;
2. on `initialized` or `existing`, use the receipt's durable cursor;
3. read one admitted page after that exact cursor with the remaining budget;
4. apply each page batch in source order through
   `applyAdmittedBatchAndAdvance`;
5. accept `duplicate` only for the exact admitted batch being replayed;
6. stop on `gap`, `resetRequired`, source history loss, epoch replacement,
   model replacement, budget shortfall, or exhausted turn admission;
7. after every page, re-run `initializeOrInspectNamespace` before constructing
   another source request; and
8. return `caughtUp` only when a final page's nominal caught-up authority
   sequence equals the re-inspected durable applied-through cursor exactly.

The final reinspection is mandatory. A competing coordinator may make every
local apply return duplicate and advance durable state beyond the locally read
page. In that case, C3 reads again from the durable cursor to obtain a newer
source authority; it does not claim caught-up from stale page evidence.

If the final authority is behind the re-inspected durable cursor, catch-up
continues from the durable cursor. If durable state is behind a completely
applied page, the result is a gap/reset outcome or typed failure; C3 does not
fabricate progress. An empty final page is valid authority evidence when its
sequence exactly matches durable state.

No `Effect.all` is used. No state transaction spans a source call, retry delay,
or another state operation. Affected-query receipt arrays are observability
only and never work or cursor authority.

## Evaluator And Artifact Contract

The evaluator port is:

```ts
interface QueryEvaluationArtifact {
  readonly evaluation: QueryEvaluationEvidence
  readonly publication: QueryPublicationArtifact
}

interface EvaluationCallBudget {
  readonly remainingEvaluatorCallsIncludingThisCall: number
  readonly maximumSettlementMilliseconds: number
}

interface QueryEvaluator {
  readonly evaluate: (
    attempt: QueryEvaluationAttempt,
    budget: EvaluationCallBudget,
  ) => Effect.Effect<
    QueryEvaluationArtifact,
    | QueryEvaluatorUnavailableError
    | QueryEvaluatorTimeoutError
    | QueryEvaluatorRefusedError,
    never
  >
}

interface QueryEvaluatorUnavailableError {
  readonly _tag: "QueryEvaluatorUnavailableError"
  readonly operation: "evaluate"
  readonly reason: "temporarilyUnavailable"
  readonly cause: unknown
}

interface QueryEvaluatorTimeoutError {
  readonly _tag: "QueryEvaluatorTimeoutError"
  readonly operation: "evaluate"
  readonly reason: "settlementTimedOut"
  readonly cause: unknown
}

interface QueryEvaluatorRefusedError {
  readonly _tag: "QueryEvaluatorRefusedError"
  readonly operation: "evaluate"
  readonly reason: "terminalRefusal"
  readonly cause: unknown
}
```

`EvaluationCallBudget` contains the remaining physical evaluator-call count and
the positive maximum settlement milliseconds available before the coordinator's
new-work admission boundary. The call count includes the invocation being
admitted. If less than one whole positive millisecond remains, no evaluator
call starts. The milliseconds value is
`floor(remainingNanoseconds / 1_000_000n)` and is never rounded up past the
cutoff. The evaluator adapter owns its timeout and maps it to
`QueryEvaluatorTimeoutError`. The coordinator does not wrap evaluation in a
generic interrupting timeout.

The three evaluator errors use `Data.TaggedError`. They have
`operation: "evaluate"`, a nested unknown `cause`, and exact reasons:

- `QueryEvaluatorUnavailableError` / `temporarilyUnavailable`;
- `QueryEvaluatorTimeoutError` / `settlementTimedOut`; and
- `QueryEvaluatorRefusedError` / `terminalRefusal`.

An admissible evaluator:

- runs outside all engine state transactions;
- is read-only against application authority and safe to invoke again;
- obtains one coherent authoritative snapshot sequence;
- derives dependencies, result digest, authority witness, and canonical
  publication content from that same snapshot;
- returns only the bound namespace/model/epoch, exact descriptor, and exact
  state-issued generation; and
- preserves unexpected throws, defects, and interruption outside its typed
  error channel.

Before any refresh source work, C3 first recaptures evaluation evidence with
`captureQueryEvaluationEvidence`, then compares namespace, model, epoch,
descriptor key and identity, generation, registration lower bound, and
requested dirty lower bound against the exact attempt in that order. Only
after those checks pass does it recapture publication content with
`captureQueryPublicationArtifact`. The resulting evaluation and publication
values are owned and frozen.

Canonical-capture failure or `InvalidQueryEvaluationArtifactError` is a typed
coordinator failure. It is not converted to terminal query refusal and is not
recorded as a durable query block; it indicates invalid trusted adapter
evidence. No source read is consumed after such a mismatch.

Flarex query execution, snapshot acquisition, row decoding, result-envelope
construction, and real evaluator timeout implementation remain later adapter
work.

## Initial Query Evaluation

`beginQuery`:

1. recaptures the caller's descriptor through `captureQueryDescriptor` before
   the first asynchronous operation;
2. completes the shared catch-up state machine;
3. constructs the bound `QueryOperationTarget` from that owned descriptor and
   the captured binding;
4. calls `beginQueryEvaluation` with both first-registration fences null;
5. enters the common evaluation pipeline on `created` or `replayed`;
6. returns `alreadyActive` on `alreadyAdvanced`; and
7. catches only
   `QueryEvaluationWorkBlockedError<"beginQueryEvaluation">` and projects that
   already-durable evidence to `evaluationBlocked` without
   clearing, bypassing, or re-registering it.

`beginQuery` does not accept a rerun request. The receipt-only state port does
not expose enough state to let orchestration reconstruct an active generation
or dirty frontier, and C3 does not add an aggregate read. C2 work selection owns
all later dirty reruns.

If a turn stops after begin but before completion, the provisional is durable.
A later `runEvaluationWork({ continuation: null }, ...)` can reclaim and
reevaluate it.

## Durable Evaluation Work

`runEvaluationWork` passes the caller's exact C2 continuation or null and the
full 4,096-inspection allowance to `claimEvaluationWork`.

- `claimed` enters the common evaluation pipeline and retains the returned next
  continuation only as a same-process scan hint.
- `continued` and `scanRestarted` return `continuationRequired` immediately
  with their exact continuation.
- `blocked` returns `evaluationBlocked` only after C2 has found no runnable work
  in a stable full wrap.
- `none` returns `idle`. It is authoritative only for that stable full wrap.

An unknown claim response is never retried as the same claim. The successful
receipt may have been lost after the fairness anchor moved, and another claim
could select different work. The exact
`QuerySyncStateCommitOutcomeUnknownError<"claimEvaluationWork">` remains in the
typed error channel. A later caller-driven turn uses a null scan hint and asks
durable state again. C3 never evaluates an attempt it did not receive and never
renames the unknown result rollback.

The caller-supplied continuation is used only for the first claim of a turn.
After any `claimed` attempt reaches a durable or stale-work outcome, C3 discards
that scan capability and makes the next claim with null. Claim and completion
can both change C2 work revision, so blindly reusing the earlier continuation
would force `scanRestarted`. Null does not lose fairness: C2's durable fairness
anchor already advanced when the work was claimed. This permits up to 32
queries without adding a kernel receipt or orchestration-owned scan state.

Runnable work is not leased or made exclusive. Concurrent turns may evaluate
the same provisional. Exact completion replay remains success; a different
completion fingerprint remains the existing typed conflict and cannot
overwrite the winner.

## Evaluation, Refresh, And Completion

For one state-issued attempt, the common pipeline:

1. invokes and captures the evaluator artifact;
2. catches durable namespace state up to an admitted final-page authority;
3. starts a separate admitted-source pass strictly after the evaluation
   snapshot;
4. accumulates every exact contiguous admitted batch after that snapshot;
5. applies only through the semantic state method, accepting exact duplicates
   as concurrent/recovery progress;
6. after every final page, reinspects durable state;
7. if durable state is ahead of the refresh authority, continues the refresh
   pass after the last refresh authority until the missing interval and a new
   final authority are observed;
8. calls `admitGenerationRefreshEvidence` only after the complete interval and
   durable cursor agree with the same final authority; and
9. calls `completeQueryEvaluation` atomically with the exact attempt, captured
   evaluation, nominal refresh evidence, and captured publication artifact.

The durable catch-up pass and refresh-from-snapshot pass are distinct. Reading
only after the evaluation snapshot can skip durable cursor work when an
evaluator observes ahead of state. Catch-up first closes that gap; refresh then
proves evaluation relevance over the exact post-snapshot interval.

Completion receipts are handled exactly:

- `completed` and `replayed` are success value outcomes;
- `superseded` and `recoveryEvidenceExpired` are distinct stale-work outcomes;
- `refreshRequired` extends the refresh interval to the newly required durable
  cursor inside the same remaining turn ledger;
- `resnapshotRequired` discards the artifact and reevaluates the same durable
  provisional only if a physical evaluator call remains;
- `rerunRequired` likewise reevaluates the same provisional so its next
  snapshot can cover the relevant frontier, only if a call remains.

A concurrent durable terminal record may instead make
`completeQueryEvaluation` fail with
`QueryEvaluationWorkBlockedError<"completeQueryEvaluation">`. C3 catches only
that already-durable blocked variant and projects it to `evaluationBlocked`;
all other completion failures remain in the typed error channel.

Source history loss while catching up from the durable state cursor returns the
source history/reset value. History loss only in the post-evaluation refresh
pass invalidates that candidate: C3 reevaluates if a call remains, otherwise it
returns `continuationRequired` with reason `resnapshotRequired`. Epoch
replacement always returns epoch/reset evidence.

An incomplete or noncontiguous interval, crossed authority, invalid refresh
evidence, or authority witness mismatch can never install a candidate.
Continuously moving source head yields bounded continuation, never an unbounded
loop or stale completion.

Artifacts and refresh arrays are never persisted, cached on the coordinator,
or returned as recovery authority. When a turn stops, they are discarded. A
later turn reevaluates the durable provisional.

## Retry And Commit Certainty

There is no retry around an entire workflow. Retry is local to one exact
capability invocation and stops at its attempt maximum or new-work admission
boundary.

State operations:

- `QuerySyncStateUnavailableError` and `QuerySyncStateContentionError` are
  retried only with the exact same operation arguments;
- `QuerySyncStateCommitOutcomeUnknownError` may replay the exact
  `initializeOrInspectNamespace`, `beginQueryEvaluation`,
  `applyAdmittedBatchAndAdvance`, `completeQueryEvaluation`, or
  `recordEvaluationAttemptOutcome` operation because their C1/C2 identity and
  receipts define exact recovery;
- `claimEvaluationWork` outcome unknown follows the null-continuation recovery
  rule above and is never invocation-locally replayed; and
- stored corruption, incompatibility, capacity, kernel authority/canonical
  failure, collision, exhaustion, invalid evidence, and durable block are not
  retry-schedule inputs.

Source reads retry only `ChangeSourceUnavailableError` with the identical
cursor and remaining-budget request. Corruption, incompatibility, cursor-ahead,
sequence exhaustion, limits, projection failure, history loss, epoch
replacement, and budget insufficiency never enter the retry schedule.

Evaluator unavailable and timeout errors retry the same nominal state-issued
attempt while both physical-call and admission budget remain. When they
exhaust, C3 records `transientExhausted` for that exact attempt before returning
`continuationRequired`. A terminal refusal is never retried; C3 first records
`terminalRefusal` and returns `evaluationBlocked` only from a durable
`blocked` receipt.

Outcome-record receipts are exhaustive:

- transient `eligible` returns `continuationRequired`;
- either transient or terminal `blocked` returns `evaluationBlocked`;
- either `superseded` or `recoveryEvidenceExpired` returns that stale-work
  outcome; and
- terminal `eligible` is an invariant defect because C2 cannot produce it for
  `terminalRefusal`.

If recording cannot settle, its typed state error remains in the Effect error
channel. C3 never claims the attempt is eligible or blocked without a durable
receipt.

Unexpected evaluator failure, `Effect.die`, interruption, and cancellation are
not caught, mapped, or recorded as an evaluation outcome. Their full Cause is
preserved and the durable provisional remains discoverable.

Retry delay uses installed Effect v4
`Effect.sleep(Duration.millis(delayMilliseconds))`. Interruption during a delay
stops the turn. There is no broad `catchAll`, `catchCause`, Promise catch, or
`Effect.result` inside the reusable coordinator.

## Admission Deadline And Settlement

C3 measures elapsed turn duration with Effect
`Clock.currentTimeNanos`. Tests use `TestClock`. It never calls `Date.now` and
never accepts caller-supplied current time.

The new-work admission boundary is:

```text
turn start + newWorkWindowMilliseconds - settlementReserveMilliseconds
```

The settlement cutoff is `turn start + newWorkWindowMilliseconds`.

At or beyond equality, C3 admits no new optional source, state, evaluator,
claim, completion, retry, or retry-delay unit. It returns the appropriate
continuation/value outcome. Before an evaluator call, the positive remaining
duration to that boundary is passed as its maximum settlement milliseconds.

One `recordEvaluationAttemptOutcome` settlement is paired with, and
pre-authorized by, an admitted evaluator call. If that evaluator returns a
typed transient or terminal failure at the admission boundary, the paired
state record may start in the settlement reserve; it is not a new evaluation
unit. Only that exact attempt/outcome and its operation-local safe retries may
use the reserve. No source read, evaluation, claim, refresh, or completion may
start there. If settlement still cannot establish a durable receipt, its typed
state error is returned and C3 claims neither eligible nor blocked certainty.

No retry sleep starts unless its complete duration ends strictly before the
applicable cutoff; equality refuses the retry. Ordinary capability retries use
the new-work admission boundary. The paired outcome-record operation and its
safe retries use the settlement cutoff. If the evaluator itself returns at or
after that cutoff before the first outcome record can start, C3 fails with
`EvaluationOutcomeSettlementDeadlineError` and claims no durable disposition.
An already-started state operation is still awaited after either cutoff.

The boundary is not a generic interrupting timeout. A state or source operation
started before it is awaited to its adapter-classified settlement, even if it
settles after the admission boundary. In particular, C3 never interrupts a
possibly committing state operation and guesses rollback. A real source/state
adapter must later prove its own finite settlement and timeout/commit-certainty
classification. Reference capabilities settle finitely.

No detached Fiber survives the caller's structured Effect.

## Exact Value Outcomes And Error Channels

The shared detached progress projection is:

```ts
interface OrchestrationTurnProgress {
  readonly sourceCalls: number
  readonly admittedBatches: number
  readonly settledBatchTransitions: number
  readonly sourceTransportBytes: number
  readonly modelSemanticWorkUnits: number
  readonly modelSemanticBytes: number
  readonly dependencyKeyExaminations: number
  readonly canonicalDependencyBytes: number
  readonly claimedEvaluationAttempts: number
  readonly evaluatorCalls: number
  readonly completedEvaluations: number
  readonly replayedEvaluations: number
  readonly supersededEvaluations: number
  readonly recoveryEvidenceExpiredEvaluations: number
  readonly blockedEvaluations: number
  readonly lastDurableCursor: NamespaceCursor
}
```

`sourceCalls` is the whole-turn physical call count and never exceeds 32.
`evaluatorCalls` is the whole-turn total, while the method-local ledger also
tracks each query-generation pair and permits at most
`evaluatorCallsPerQuery` calls for it. The derived whole-turn evaluator maximum
is therefore `evaluatedQueries * evaluatorCallsPerQuery`, initially at most 64.
No evaluator count is additive outside that product.

The exact stop reasons are:

```ts
type CatchUpContinuationReason =
  | "deadlineReached"
  | "sourceReadLimitReached"
  | "admittedBatchLimitReached"
  | "sourceTransportByteLimitReached"
  | "modelSemanticWorkLimitReached"
  | "modelSemanticByteLimitReached"
  | "dependencyKeyExaminationLimitReached"
  | "canonicalDependencyByteLimitReached"

type EvaluationContinuationReason =
  | CatchUpContinuationReason
  | "evaluatedQueryLimitReached"
  | "evaluatorCallLimitReached"
  | "transientEvaluatorExhausted"
  | "refreshRequired"
  | "resnapshotRequired"
  | "rerunRequired"
  | "scanContinued"
  | "scanRestarted"

interface EvaluationTurnContinuation {
  readonly phase: CatchUpPhase | "evaluation"
  readonly reason: EvaluationContinuationReason
  readonly scan: EvaluationWorkScanContinuation | null
}
```

`scan` is non-null only for `scanContinued` or `scanRestarted` using the exact
C2 receipt capability. Every stop after a claimed evaluation uses null because
the work revision may have changed. Catch-up stops and `beginQuery` stops also
use null.

Catch-up boundary shapes are:

```ts
type CatchUpPhase =
  | "initialCatchUp"
  | "postEvaluationCatchUp"
  | "refreshReplay"

type CatchUpBoundaryOutcome<
  Phase extends CatchUpPhase = CatchUpPhase,
> =
  | Readonly<{
      readonly _tag: "continuationRequired"
      readonly phase: Phase
      readonly reason: CatchUpContinuationReason
      readonly progress: OrchestrationTurnProgress
    }>
  | Readonly<{
      readonly _tag: "budgetInsufficient"
      readonly phase: Phase
      readonly evidence: ChangeBudgetInsufficient
      readonly progress: OrchestrationTurnProgress
    }>
  | Readonly<{
      readonly _tag: "historyUnavailable"
      readonly phase: Phase
      readonly evidence: ChangeSourceHistoryUnavailable
      readonly progress: OrchestrationTurnProgress
    }>
  | Readonly<{
      readonly _tag: "modelReplaced"
      readonly phase: "initialCatchUp"
      readonly existingCursor: NamespaceCursor
      readonly requestedSyncModelId: SyncModelId
      readonly progress: OrchestrationTurnProgress
    }>
  | Readonly<{
      readonly _tag: "epochReplaced"
      readonly phase: Phase
      readonly evidence:
        | Readonly<{
            readonly source: "state"
            readonly existingCursor: NamespaceCursor
            readonly requestedSourceEpoch: SyncEpoch
          }>
        | Readonly<{
            readonly source: "changeSource"
            readonly value: ChangeSourceEpochReplaced
          }>
      readonly progress: OrchestrationTurnProgress
    }>
  | Readonly<{
      readonly _tag: "gap"
      readonly phase: Phase
      readonly expectedSequence: SyncSequence
      readonly observedSequence: SyncSequence
      readonly progress: OrchestrationTurnProgress
    }>
  | Readonly<{
      readonly _tag: "resetRequired"
      readonly phase: Phase
      readonly expectedSourceEpoch: SyncEpoch
      readonly observedSourceEpoch: SyncEpoch
      readonly progress: OrchestrationTurnProgress
    }>

type CatchUpTurnOutcome =
  | Readonly<{
      readonly _tag: "caughtUp"
      readonly cursor: NamespaceCursor
      readonly authority: CaughtUpChangeAuthority
      readonly progress: OrchestrationTurnProgress
    }>
  | CatchUpBoundaryOutcome<"initialCatchUp">
```

`gap` is not collapsed into an epoch reset. Its expected/observed sequence
evidence remains visible so a host can distinguish source-order failure from
epoch replacement.

Evaluation boundary and operation shapes are:

```ts
type EvaluationBoundaryOutcome =
  | Exclude<
      CatchUpBoundaryOutcome,
      { readonly _tag: "continuationRequired" }
    >
  | Readonly<{
      readonly _tag: "continuationRequired"
      readonly continuation: EvaluationTurnContinuation
      readonly progress: OrchestrationTurnProgress
    }>
  | Readonly<{
      readonly _tag: "evaluationBlocked"
      readonly blockedWork: BlockedEvaluationWorkEvidence
      readonly continuation: null
      readonly progress: OrchestrationTurnProgress
    }>

type BeginQueryTurnOutcome =
  | Readonly<{
      readonly _tag: "completed" | "replayed"
      readonly generation: QueryGeneration
      readonly publicationDisposition:
        QueryCompletionPublicationDisposition
      readonly progress: OrchestrationTurnProgress
    }>
  | Readonly<{
      readonly _tag: "alreadyActive"
      readonly descriptor: QueryDescriptor
      readonly requestedExpectedActiveGeneration: null
      readonly activeGeneration: QueryGeneration
      readonly freshThroughSequence: SyncSequence
      readonly progress: OrchestrationTurnProgress
    }>
  | Readonly<{
      readonly _tag: "superseded" | "recoveryEvidenceExpired"
      readonly generation: QueryGeneration
      readonly activeGeneration: QueryGeneration
      readonly progress: OrchestrationTurnProgress
    }>
  | EvaluationBoundaryOutcome

type EvaluationWorkTurnOutcome =
  | Readonly<{
      readonly _tag: "idle"
      readonly progress: OrchestrationTurnProgress
    }>
  | EvaluationBoundaryOutcome
```

The C3-owned coordinator validation and settlement failures have exact facets:

```ts
interface InvalidNamespaceQuerySyncPolicyError {
  readonly _tag: "InvalidNamespaceQuerySyncPolicyError"
  readonly operation: "makeNamespaceQuerySync"
  readonly field:
    | "stateAttemptsPerOperation"
    | "sourceAttemptsPerRead"
    | "retryDelayMilliseconds"
    | "settlementReserveMilliseconds"
  readonly reason: "invalidValue" | "aboveHardMaximum" | "invalidPair"
}

interface InvalidQuerySyncTurnBudgetError {
  readonly _tag: "InvalidQuerySyncTurnBudgetError"
  readonly operation: "catchUp" | "beginQuery" | "runEvaluationWork"
  readonly field:
    | keyof CatchUpTurnBudget
    | "evaluatedQueries"
    | "evaluatorCallsPerQuery"
  readonly reason:
    | "invalidValue"
    | "aboveHardMaximum"
    | "notGreaterThanSettlementReserve"
  readonly observed: number
}

interface InvalidQueryEvaluationArtifactError {
  readonly _tag: "InvalidQueryEvaluationArtifactError"
  readonly operation: "captureQueryEvaluationArtifact"
  readonly reason:
    | "namespaceMismatch"
    | "modelMismatch"
    | "epochMismatch"
    | "queryKeyMismatch"
    | "queryIdentityMismatch"
    | "generationMismatch"
    | "snapshotBeforeRegistration"
    | "snapshotBeforeRequestedDirtyFrontier"
  readonly queryKey: CanonicalQueryKey
  readonly generation: QueryGeneration
}

interface EvaluationOutcomeSettlementDeadlineError {
  readonly _tag: "EvaluationOutcomeSettlementDeadlineError"
  readonly operation: "recordEvaluationAttemptOutcome"
  readonly reason: "settlementWindowElapsed"
  readonly queryKey: CanonicalQueryKey
  readonly generation: QueryGeneration
  readonly outcome: EvaluationAttemptOutcome
}
```

Their implementations use `Data.TaggedError`. The turn-budget `observed` field
is numeric, including NaN or infinity when that is the invalid input; none of
these errors retains a caller object or foreign cause. Policy pair validation
copies and validates members but does not echo or retain the caller's array.

The exact pure/error aliases are:

```ts
type NamespaceQuerySyncConstructionError =
  | CaptureNamespaceCursorError
  | InvalidNamespaceQuerySyncPolicyError

type CatchUpTurnError =
  | InvalidQuerySyncTurnBudgetError
  | BuildQuerySyncStateError
  | ApplyInvalidationsError
  | AdmittedChangeSourceError
  | QuerySyncStateIntegrationError<
      | "initializeOrInspectNamespace"
      | "applyAdmittedBatchAndAdvance"
    >

type QueryEvaluationArtifactCaptureError =
  | CaptureEvaluationEvidenceError
  | QuerySyncCanonicalValueError
  | InvalidQueryEvaluationArtifactError

type EvaluationPipelineError =
  | CatchUpTurnError
  | QueryEvaluationArtifactCaptureError
  | RefreshEvidenceAdmissionError
  | Exclude<
      CompleteQueryEvaluationError,
      QueryEvaluationWorkBlockedError<"completeQueryEvaluation">
    >
  | QuerySyncStateIntegrationError<"completeQueryEvaluation">
  | RecordEvaluationAttemptOutcomeError
  | QuerySyncStateIntegrationError<"recordEvaluationAttemptOutcome">
  | EvaluationOutcomeSettlementDeadlineError

type BeginQueryTurnError =
  | InvalidQuerySyncTurnBudgetError
  | CaptureQueryDescriptorError
  | Exclude<
      BeginQueryEvaluationError,
      QueryEvaluationWorkBlockedError<"beginQueryEvaluation">
    >
  | QuerySyncStateIntegrationError<"beginQueryEvaluation">
  | EvaluationPipelineError

type EvaluationWorkTurnError =
  | InvalidQuerySyncTurnBudgetError
  | ClaimEvaluationWorkError
  | QuerySyncStateIntegrationError<"claimEvaluationWork">
  | EvaluationPipelineError
```

The operation channel table is consequently:

| Operation | Success | Expected error | Requirements |
| --- | --- | --- | --- |
| `makeNamespaceQuerySync` | `NamespaceQuerySync` | `NamespaceQuerySyncConstructionError` in pure `Result` | none |
| `catchUp` | `CatchUpTurnOutcome` | `CatchUpTurnError` | `never` |
| `beginQuery` | `BeginQueryTurnOutcome` | `BeginQueryTurnError` | `never` |
| `runEvaluationWork` | `EvaluationWorkTurnOutcome` | `EvaluationWorkTurnError` | `never` |

Raw evaluator unavailable, timeout, and refusal errors do not appear in the
coordinator aliases because the exact outcome-record protocol consumes them.
`QuerySyncStateCommitOutcomeUnknownError<"claimEvaluationWork">` remains inside
`EvaluationWorkTurnError` through the state-integration union. The two mapped
blocked errors appear as `evaluationBlocked` values and are excluded from
their operation error aliases.

`CatchUpTurnOutcome` has exactly these tags:

- `caughtUp` with equal durable cursor and nominal source authority;
- `continuationRequired` with progress and stop reason;
- `budgetInsufficient` with existing source evidence and progress;
- `historyUnavailable` with existing source evidence and progress;
- `modelReplaced`;
- `epochReplaced`;
- `gap` with exact expected and observed sequences; and
- `resetRequired` for an apply epoch-reset receipt.

`BeginQueryTurnOutcome` has exactly:

- `completed`;
- `replayed`;
- `alreadyActive`;
- `superseded`;
- `recoveryEvidenceExpired`;
- `continuationRequired`;
- `evaluationBlocked`;
- `budgetInsufficient`;
- `historyUnavailable`;
- `modelReplaced`;
- `epochReplaced`;
- `gap`; and
- `resetRequired`.

`EvaluationWorkTurnOutcome` has exactly:

- `idle` after a stable C2 `none` scan, including progress completed earlier in
  the same turn;
- `continuationRequired`;
- `evaluationBlocked`;
- `budgetInsufficient`;
- `historyUnavailable`;
- `modelReplaced`;
- `epochReplaced`;
- `gap`; and
- `resetRequired`.

Per-query completed, replayed, superseded, and expired decisions in
`runEvaluationWork` are counted in progress and the scan continues while budget
remains. Transient evaluator exhaustion records `transientExhausted` and ends
the turn with `continuationRequired` as specified above. Reaching a query,
source, batch, evaluator, or deadline limit also returns
`continuationRequired` with the last safe scan hint.

Frozen progress includes only detached counters and the last re-inspected
durable cursor. Evaluation continuation contains the C2 scan continuation or
null plus a closed stop-reason union. It never contains an evaluator artifact,
refresh batches, caught-up authority, query claim, or durable-work assertion.

Expected branching decisions stay in success values. Exhausted source/state
capability errors, corrupt/incompatible state, invalid trusted evidence,
canonical/authority failures, collisions, exhaustion, and refresh-admission
errors remain the connected typed error unions. Raw evaluator typed failures
are consumed only by the exact durable outcome protocol above. Defects and
interruption remain Cause.

All public C3 values are owned and frozen. The coordinator error channel is a
closed union of concrete existing or C3 tagged errors; no `unknown`, `Error`,
string, or ad-hoc result union is exposed.

## Restart And Concurrency Rules

`EvaluationWorkScanContinuation` remains a state-issued, process-local nominal
capability. It is not encoded, persisted, cloned, structurally reconstructed,
sent across Workers, or accepted from an untrusted client. Losing it is safe.
The next turn passes null and begins after C2's durable fairness anchor.

There is no evaluation lease. Unknown claim recovery, crash after evaluation,
crash during refresh, deadline exhaustion, and interruption all leave the
provisional discoverable. Reevaluation is expected.

For concurrent coordinators:

- a duplicate apply is only local recovery evidence; final catch-up still
  reinspects durable state;
- identical completion fingerprint replays;
- different candidates for the same attempt preserve the existing typed
  `InvalidQueryCompletionReplayError` and never overwrite;
- terminal outcome replay blocks once and increments work revision once;
- completion winning before outcome recording returns stale-work evidence and
  cannot be converted into a block; and
- no in-memory flag or continuation can suppress durable work.

## Reference And Test Plan

`ReferenceQueryEvaluator` is a deterministic scripted testing capability behind
`./testing/conformance`. It can record calls, return captured artifacts or each
typed evaluator error, preserve defects/interruption, and coordinate races. It
does not execute Flarex queries or become a second transition oracle.

`catchUpOrchestration.test.ts` proves:

- exact budget maxima and rejection of zero, negative, fractional, non-finite,
  unsafe, above-max, and reserve/window-invalid values;
- caller mutation after Effect execution begins cannot change a captured
  descriptor or turn budget;
- exact 4,096 admitted batches authorize 4,096 first applies, 4,097 is refused,
  and apply retries do not double-debit;
- empty final page and multi-page ordered catch-up;
- one shared read/batch/byte/work ledger across pages;
- lost apply response followed by exact duplicate recovery;
- competing advance beyond the local final page and mandatory reinspection;
- gap, history loss, model/epoch replacement, reset, and indivisible shortfall;
- source transient success/exhaustion with identical request replay;
- exact deadline-minus-one admission and equality rejection with TestClock; and
- retry delay with one millisecond left, exact-cutoff equality, and settlement-
  cutoff refusal without oversleep;
- a started state operation may settle after admission closes without generic
  interruption.

`evaluationOrchestration.test.ts` proves:

- first registration derives authority from binding and rejects crossed
  descriptors/evaluator artifacts before refresh work;
- created/replayed completion, already-active, superseded, expired, and blocked
  outcomes;
- transient-to-success uses the same attempt and counts both physical calls;
- transient exhaustion records eligible; terminal refusal records blocked;
- competing transient/terminal outcome records map `blocked` to
  `evaluationBlocked` and terminal-to-`eligible` is a defect;
- lost outcome response replays the exact outcome;
- evaluator defect/interruption makes no outcome-record call and preserves
  Cause;
- a new coordinator instance reclaims a durable provisional with null
  continuation;
- snapshot-equal empty refresh, multi-page refresh, durable suffix application,
  duplicate replay, and exact nominal admission;
- `refreshRequired` extension, witness-drift resnapshot, relevant-change rerun,
  and the two-call cap shared by retry/resnapshot/rerun;
- continuously moving head, refresh history loss, budget exhaustion, and
  interruption return without installing stale state;
- `continued` and `scanRestarted` return promptly under revision churn;
- two clean queries complete in one turn by discarding the post-completion
  stale scan hint and reclaiming from the durable fairness anchor;
- stable none/blocked, runnable-before-blocked fairness, and no restart
  starvation with the full scan allowance;
- before/after-commit fault injection for every C3-used state operation,
  including typed propagation and non-replay of unknown claim;
- two coordinators evaluating one provisional, exact completion replay, and
  differing-fingerprint conflict; and
- no publication claim/delivery operation is ever called by C3.

Tests use `Effect.gen`, `TestClock`, scoped fibers/Deferred only inside the test
owner, the existing state fault injector, call logs, and durable snapshots.
They do not reproduce orchestration logic as a test oracle.

## Explicitly Not Authorized

C3 approval does not authorize:

- C4 publication claim, publisher calls, attempt outcomes, acceptance evidence,
  delivery completion, or full publication recovery;
- a real SQLite, Postgres, PGlite, filesystem, network, Electric, Durable
  Streams, or other source/state/evaluator/publisher adapter;
- a schema, migration, DDL, table, column, index, persisted codec, protocol
  frame, or package split;
- Flarex query execution, commit-feed/model mapping, active-head mapping,
  result-envelope construction, or scope/application registry;
- a Worker, Durable Object, alarm, queue, route, scheduler, wake implementation,
  background Fiber, runtime bridge, or production caller;
- Context/Layer instances per namespace, query, request, transaction, Worker,
  or Durable Object;
- a lease, owner token, renewal, expiry, steal, release, destructive reset,
  re-registration, blocked-work bypass, or eviction;
- aggregate read/save, generic transaction callback, raw CAS, cursor-only write,
  arbitrary driver access, or new coordinator-owned durable state;
- client authentication, gateway, subscription protocol, SDK, WebSocket, SSE,
  long poll, reconnect, resume, or reset API;
- OCC, journals, commit compilation/execution, authoritative application rows,
  commit feed, or existing application outbox changes;
- Legacy dual state, dual writes, fallback, comparison, migration, or cutover;
- Payload, public relational APIs, `R03-B`, or a portability/production-readiness
  claim; or
- incidental repair of a kernel, state, change, backend, persistence, or host
  owner discovered by C3 tests.

A system or orchestration test that exposes a shared-owner defect records the
reproduction and stops at that boundary until separately approved.

## Validation And Review Gate

The significant C3 implementation must pass:

- `pnpm --filter @flarex/query-sync typecheck`;
- the full `@flarex/query-sync` test suite;
- `pnpm check:effect-boundaries`;
- forbidden-import, package-export, dependency, runtime, aggregate-read,
  transaction-callback, lease-token, and publication-operation audits;
- ownership inspection proving durable C2 state is the only work authority and
  no artifact/continuation survives a turn;
- uncertainty inspection proving operation-local retry, no unknown-as-
  rollback, and no unknown claim replay;
- boundedness inspection proving one shared source/evaluator ledger;
- `pnpm lint:core` and `pnpm lint:diff`;
- `git diff --check`;
- both standing reviewers against the final significant diff; and
- `pnpm lint:diff -- --staged` against the exact intended index before commit.

If reviewer-driven code changes alter the significant diff, both reviews are
rerun. Reference evidence must be reported as reference evidence only.

## Exit And Next Gate

C3 exits only when the private coordinator and reference tests prove:

- exact source/durable-cursor reconciliation under concurrency;
- authority-safe initial query registration;
- bounded evaluator retry, terminal block, refresh, resnapshot, and rerun;
- operation-specific commit-uncertainty recovery;
- restart from durable work without persisted orchestration state;
- Effect Clock/TestClock deadline behavior with preserved Cause; and
- zero C4 publication-delivery behavior.

Completion makes the portable engine capable of bounded evaluation
orchestration over reference capabilities. It does not complete `QSYNC01-C`,
prove a real runtime, or authorize an adapter.

C4 remains the next separate gate for publication orchestration and the full
reference publication-recovery matrix. Only after C4 completes may
`QSYNC-FX01` preflight the first Flarex mappings and Cloudflare SQLite adapter.
