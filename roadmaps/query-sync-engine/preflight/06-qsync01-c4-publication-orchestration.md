# QSYNC01-C4 Bounded Publication Orchestration Preflight

## Status

**Preflight status:** proposed on 2026-08-29 for review and explicit approval.
This document is not implementation authority.

`QSYNC01-A`, `QSYNC01-B`, `QSYNC01-C1`, `QSYNC01-C2`, and
`QSYNC01-C3` are complete, private, reference-backed, runtime-neutral, and
production-inert. C2 owns durable publication selection, attempt ordinals,
outcome settlement, blocking, and completion. C4 may orchestrate only those
capabilities. It may not replace their transition authority or add another
work-state owner.

Approval of this preflight would authorize only the bounded reference C4 slice
below. It would not authorize a real delivery adapter, Cloudflare composition,
Flarex mappings, a production caller, a public API, or deployment.

## Decision

C4 adds one separate, namespace-bound publication coordinator:

```ts
makeNamespacePublicationSync({
  binding,
  state,
  publisher,
  policy,
}) => Result.Result<
  NamespacePublicationSync,
  NamespacePublicationSyncConstructionError
>

NamespacePublicationSync.runPublicationWork(turnBudget)
```

There is no `recoverPublication` method and no continuation token.
`claimPublication()` already gives recovery precedence by replaying the one
durable in-flight attempt before it claims pending work. A second method would
be an alias unless C2 added a new recover-only transition, which this slice
does not authorize. Restart creates a new coordinator and invokes the same
`runPublicationWork` operation.

The C4 factory remains separate from `makeNamespaceQuerySync`. A host may
compose both later, but evaluation and publication retain distinct
capabilities, budgets, failures, and lifecycle ownership.

## Umbrella Refinements

This exact preflight deliberately refines two provisional C4 sketches in the
accepted C umbrella:

1. C4 has one restart-safe operation, not indistinguishable run and recovery
   operations.
2. A publication attempt ordinal is engine-owned recovery accounting. It is
   never an external producer sequence, producer epoch, logical publication
   identity, or delivery-adapter idempotency component.

Every physical call for one persisted publication, across later ordinals,
restart replay, and competing coordinators, presents the identical logical
publication identity and result digest to the same bound destination. A real
adapter must reuse its identical producer tuple or equivalent idempotency
identity. It must not mint a new external sequence because C2 advanced its
internal attempt ordinal.

## Completed Prerequisites

The current package already provides all durable transition authority C4
needs:

- `claimPublication()` returns `claimed`, exact `replayed`, `blocked`, or
  `none`;
- `recordPublicationAttemptOutcome(attempt, outcome)` accepts only the exact
  state-issued attempt and one of `knownNotAppended`, `outcomeUnknown`, or
  `terminalRefusal`;
- `completePublication(evidence)` accepts only nominal evidence bound to the
  exact publication identity and result digest;
- claim replay, exact outcome replay, and exact completion replay are safe
  after an unknown state commit;
- only one publication is in flight for a namespace, and newer pending work
  cannot overtake it;
- C2 owns the 128-attempt and seven-day reset-required decisions and the state
  clock used to make them; and
- C1/C2 reserve the durable settlement envelope when work is claimed, so C4
  does not need a capacity escape hatch.

C4 does not add a state operation, aggregate read, transaction callback,
lease, owner token, continuation, schema, migration, or persisted field.

## Namespace And Trust Binding

The factory captures one immutable binding:

```ts
interface NamespacePublicationBinding {
  readonly namespaceId: SyncNamespaceId
  readonly syncModelId: SyncModelId
  readonly sourceEpoch: SyncEpoch
}
```

Construction captures and validates those fields in the listed order, then
captures policy, the three authorized state methods, and the publisher method.
Captured methods preserve their original receiver and cannot be replaced by
later mutation of the input objects.

After claim and before any publisher or settlement call, a claimed or replayed
publication must exactly match the captured namespace, model, and epoch. A
mismatch fails with `PublicationAuthorityMismatchError` and performs no
publisher call or state settlement. The bound publisher is trusted only for
the namespace and authorized destination with which the host constructed it.
Destination
selection, credentials, authentication, and producer state are adapter/host
authority and never become query-sync state.

## Exact State Capability

C4 captures only:

```ts
type QuerySyncPublicationState = Pick<
  QuerySyncTransitionState,
  | "claimPublication"
  | "recordPublicationAttemptOutcome"
  | "completePublication"
>
```

It cannot call source, evaluator, catch-up, registration, evaluation,
invalidation, or aggregate-state operations. C3 keeps its existing six-method
capture and receives no publication capability.

## Result Publisher Contract

`ResultPublisher` is a plain, multi-instance, namespace-and-destination-bound
capability:

```ts
interface PublicationDeliveryBudget {
  readonly remainingPublisherCallsIncludingThisCall: number
  readonly maximumSettlementMilliseconds: number
}

interface ResultPublisher {
  readonly publish: (
    publication: PendingQueryPublication,
    budget: PublicationDeliveryBudget,
  ) => Effect.Effect<void, ResultPublisherError, never>
}
```

The publisher receives only the exact frozen publication persisted by C1/C2:
identity, query identity, completed-through sequence, result digest, and
canonical content. It never receives a transient evaluation artifact.

The publisher does not receive the C2 attempt ordinal or the state-owned first
and last attempt instants. The coordinator retains those solely to settle the
exact C2 attempt. This prevents a delivery adapter from accidentally using an
engine retry ordinal as a producer sequence or logical idempotency key.

A successful `void` means the bound capability has established exact
acceptance of the supplied publication under its own adapter contract. A later
real adapter may return success only after the separately approved receipt,
read-back, or equivalent proof for that exact identity and digest. Transport
receipts and offsets remain adapter-owned and are not persisted by this core.

The closed expected error union has exactly three classifications:

```ts
type ResultPublisherError =
  | ResultPublisherKnownNotAppendedError
  | ResultPublisherOutcomeUnknownError
  | ResultPublisherTerminalRefusalError
```

- `ResultPublisherKnownNotAppendedError` proves this physical call did not
  append; a competing exact replay may still have accepted;
- `ResultPublisherOutcomeUnknownError` means this physical call may have
  appended;
- `ResultPublisherTerminalRefusalError` means this call through the bound
  capability cannot accept the exact publication without
  operator/configuration change; competing or later exact acceptance may still
  resolve C2's blocked work; and
- defects, invariant violations, and interruption remain outside the expected
  error channel and preserve their full Effect `Cause`.

These generic errors expose only their tag and `operation: "publish"`. An
adapter retains provider-specific status, body, receipt, credential, and
redacted diagnostic policy. A timeout is outcome-unknown unless the adapter
can prove no append.

There is no generic retry around `publish`. Each invocation is one physical
call for one state-issued attempt. Another call is allowed only after C2
durably issues the next ordinal or after a later restart replays an unresolved
ordinal; a competing coordinator may also exact-replay and call that same
unresolved ordinal. All such physical calls use the same external logical key.

## Nominal Acceptance Boundary

The existing `AcceptedQueryPublicationEvidence` remains the only value that can
complete durable publication state. Structural or decoded lookalikes remain
invalid.

C4 adds one narrow package-internal bridge in
`kernel/PublicationWork.ts`:

```ts
admitAcceptedQueryPublicationAttempt(
  attempt: PublicationAttempt,
): AcceptedQueryPublicationEvidence
```

The bridge:

- accepts only a WeakSet-authenticated, state-issued `PublicationAttempt`;
- derives identity and result digest only from that attempt's persisted
  publication;
- creates fresh frozen nominal evidence;
- treats an unissued attempt as `QuerySyncInvariantDefect` with the existing
  `operation: "completePublication"` and
  `invariant: "publicationAttemptStateInvalid"` pair, not recoverable external
  input; and
- is exported only from its source module for the connected coordinator,
  never from `./internal/kernel`, `./internal/orchestration`, the package root,
  or a testing barrel.

After publisher success, the coordinator invokes this bridge with the exact
attempt it retained from claim and passes the resulting evidence to
`completePublication`. The publisher never mints or returns core evidence.
`makeAcceptedQueryPublicationEvidenceForTesting` remains testing-only and is
not imported by production orchestration.

## Coordinator API And Capture

```ts
interface NamespacePublicationSyncPolicy {
  readonly stateAttemptsPerOperation: number
  readonly retryDelayMilliseconds: readonly [number, number]
  readonly settlementReserveMilliseconds: number
}

interface PublicationTurnBudget {
  readonly publisherCalls: number
  readonly newWorkWindowMilliseconds: number
}

interface NamespacePublicationSync {
  readonly runPublicationWork: (
    budget: PublicationTurnBudget,
  ) => Effect.Effect<
    PublicationWorkTurnOutcome,
    PublicationWorkTurnError,
    never
  >
}
```

Policy validation matches C3's exact shared limits:

- `stateAttemptsPerOperation` is a positive safe integer no greater than 3;
- `retryDelayMilliseconds` is an owned frozen pair of non-negative safe
  integers, each no greater than 60,000; and
- `settlementReserveMilliseconds` is a positive safe integer less than
  60,000.

Turn validation requires:

- `publisherCalls` in `[1, 32]`; and
- `newWorkWindowMilliseconds` in `[1, 60_000]` and strictly greater than the
  captured settlement reserve.

All policy, budget, binding, progress, and outcome values are copied where
needed and frozen. Caller-owned mutable input does not survive capture.

## Construction And Operation Errors

The factory failure union is closed:

```ts
type NamespacePublicationSyncConstructionError =
  | QuerySyncCanonicalValueError
  | InvalidNamespacePublicationSyncPolicyError
```

`InvalidNamespacePublicationSyncPolicyError` uses
`operation: "makeNamespacePublicationSync"` and names exactly one policy field
plus `invalidValue`, `aboveHardMaximum`, or `invalidPair`. Capability getter,
method, or invariant defects are not converted to construction failures.

The operation failure union is also closed:

```ts
type PublicationWorkTurnError =
  | InvalidPublicationTurnBudgetError
  | PublicationAuthorityMismatchError
  | PublicationSettlementDeadlineError
  | ClaimPublicationError
  | QuerySyncStateIntegrationError<"claimPublication">
  | RecordPublicationAttemptOutcomeError
  | QuerySyncStateIntegrationError<"recordPublicationAttemptOutcome">
  | CompletePublicationError
  | QuerySyncStateIntegrationError<"completePublication">
```

`InvalidPublicationTurnBudgetError` uses
`operation: "runPublicationWork"` and names either `publisherCalls` or
`newWorkWindowMilliseconds`. `PublicationAuthorityMismatchError` includes the
claimed publication identity and the first mismatching binding field.
`PublicationSettlementDeadlineError` includes the exact identity, attempt
ordinal, and this discriminated pending settlement, but never publication
content or provider data:

```ts
type PendingPublicationSettlement =
  | Readonly<{
      readonly _tag: "recordPublicationAttemptOutcome"
      readonly outcome: PublicationAttemptOutcome
    }>
  | Readonly<{
      readonly _tag: "completePublication"
    }>
```

Retaining the exact outcome is required because C2 rejects replay of the same
ordinal with a different classification.

Expected `ResultPublisherError` values are consumed only after their exact C2
outcome is submitted to durable state; they do not escape as turn errors.
Foreign defects and interruption remain Cause, while a failed durable
settlement escapes through the connected state error union. Durable state
remains safely reconcilable: a definitely uncommitted settlement leaves the
attempt discoverable, while an unknown completion may already have removed it
and a later claim may observe `none` or newer pending work.

## Turn Outcomes

`runPublicationWork` returns one frozen value:

```ts
type PublicationWorkTurnOutcome =
  | Readonly<{
      readonly _tag: "idle"
      readonly progress: PublicationWorkTurnProgress
    }>
  | Readonly<{
      readonly _tag: "continuationRequired"
      readonly reason:
        | "deadlineReached"
        | "publisherCallLimitReached"
        | "publicationOutcomeRecorded"
      readonly progress: PublicationWorkTurnProgress
    }>
  | Readonly<{
      readonly _tag: "publicationResetRequired"
      readonly identity: QueryPublicationIdentity
      readonly attemptOrdinal: PublicationAttemptOrdinal
      readonly reason: PublicationBlockReason
      readonly resetRequired: true
      readonly progress: PublicationWorkTurnProgress
    }>
```

There is no process-local continuation. `idle` may contain non-zero progress
after the turn drained work. Hitting the physical-call limit returns
`continuationRequired` before another claim, even if a later read might have
returned `none`.

Progress has this exact shape:

```ts
interface PublicationWorkTurnProgress {
  readonly newlyClaimedAttempts: number
  readonly replayedAttempts: number
  readonly publisherCalls: number
  readonly acceptedPublisherCalls: number
  readonly knownNotAppendedPublisherCalls: number
  readonly outcomeUnknownPublisherCalls: number
  readonly terminalRefusalPublisherCalls: number
  readonly recordedAttemptOutcomes: number
  readonly completedPublications: number
  readonly replayedCompletions: number
  readonly supersededSettlements: number
  readonly recoveryEvidenceExpiredSettlements: number
  readonly blockedPublications: number
}
```

Every field is a non-negative safe integer.

Every counter reflects settled coordinator observations, except
`publisherCalls`, which increments immediately before each physical call.
Defect/interruption may therefore leave no value result while the reference
destination log still proves the call occurred.

## Exact Turn Algorithm

One invocation performs this bounded loop:

1. capture the turn budget and Clock-derived cutoffs;
2. before claim, stop for call-limit or admission-deadline exhaustion;
3. call `claimPublication` with operation-local state retry;
4. return `idle` for `none` or `publicationResetRequired` for `blocked`;
5. for `claimed` or `replayed`, verify exact factory binding;
6. recheck the admission deadline after claim and require at least one whole
   remaining millisecond before publisher entry;
7. increment the physical-call counter and invoke `publish` once with the
   exact persisted publication and bounded delivery budget;
8. on success, create nominal evidence from the retained state-issued attempt
   and settle `completePublication`;
9. on an expected publisher failure, map its tag to the exact C2 outcome and
   settle `recordPublicationAttemptOutcome` with the retained attempt;
10. after `completed`, `replayed`, or a competing `superseded` settlement,
    continue only while the same turn still has call/time budget;
11. after a nonterminal outcome is durably `recorded`, return
    `continuationRequired: publicationOutcomeRecorded` so host scheduling, not
    an in-turn retry loop, decides when to attempt the next ordinal;
12. after `blocked`, return `publicationResetRequired`; and
13. after `superseded` or `recoveryEvidenceExpired` outcome settlement, reclaim
    current durable work within the same bounded loop.

A terminal refusal must settle as `blocked` unless competition made the
attempt stale. A terminal `recorded` receipt is `QuerySyncInvariantDefect`
with the existing `operation: "recordPublicationAttemptOutcome"` and
`invariant: "publicationAttemptStateInvalid"` pair.

## State Retry And Commit Certainty

Only the three semantic state operations use the bounded state retry helper:

| Operation | Retry cutoff | Unknown commit replay |
| --- | --- | --- |
| `claimPublication` | admission cutoff | safe; claim replays the exact in-flight attempt |
| `recordPublicationAttemptOutcome` | settlement cutoff | safe only with the same attempt object and exact outcome |
| `completePublication` | settlement cutoff | safe only with the same nominal evidence object |

`QuerySyncStateUnavailableError` and `QuerySyncStateContentionError` may retry
when marked not committed. `QuerySyncStateCommitOutcomeUnknownError` may retry
only through the exact operation replay above. Domain, corruption,
incompatibility, capacity, authority, and replay-mismatch failures do not
enter a schedule.

State retries preserve argument object identity and do not debit the publisher
call allowance. A lost claim response cannot cause a publisher call until
claim recovery returns. A lost outcome or completion response retries only
state settlement and never calls the publisher again in that turn.

The extracted `Turn.ts` helper accepts only this domain-neutral structural
policy:

```ts
interface StateOperationRetryPolicy {
  readonly stateAttemptsPerOperation: number
  readonly retryDelayMilliseconds: readonly [number, number]
}
```

Both C3's `NamespaceQuerySyncPolicy` and C4's
`NamespacePublicationSyncPolicy` satisfy it. Shared turn mechanics must not
depend on `sourceAttemptsPerRead` or another query/source-specific field.

## Deadline And Clock Ownership

C4 reuses C3's turn-window semantics:

```text
settlement cutoff = turn start + newWorkWindowMilliseconds
admission cutoff  = settlement cutoff - settlementReserveMilliseconds
```

At equality, work is not admitted.

- claim and publisher entry use the admission cutoff;
- publisher receives the floored positive whole milliseconds remaining before
  the admission cutoff;
- after publisher success or expected failure, state settlement may start only
  strictly before the settlement cutoff;
- if no settlement call can start before that cutoff,
  `PublicationSettlementDeadlineError` reports whether completion or outcome
  settlement was pending and leaves the durable attempt restart-discoverable;
- a state operation admitted before its cutoff is awaited even if it settles
  after the cutoff; the coordinator never wraps a possibly committing state
  operation in a generic interrupting timeout; and
- a retry delay that reaches equality is not started.

C4's Effect Clock owns only turn admission, retry delays, and settlement
headroom. C2's state adapter continues to own publication attempt instants,
attempt age, and clock-regression policy. Reference state uses injected Effect
Clock; a later real state adapter must use its transaction/database clock.

## Concurrency, Restart, And Idempotency

C4 adds no lease and cannot claim global single-caller execution. Two
coordinators may replay the same durable attempt and physically call their
publisher capabilities concurrently. State serialization prevents two
different in-flight publications, while the bound delivery adapter must make
the same logical publication idempotent.

The stable external key is derived from the bound destination plus the
persisted publication identity. The exact result digest is part of acceptance
proof. The C2 attempt ordinal, first/last attempt instants, turn identity,
process identity, and coordinator instance are excluded.

Restart behavior is entirely durable:

- before publisher entry: claim replays the same attempt;
- after a possible append but before outcome settlement: claim replays the
  same attempt and the adapter deduplicates or proves acceptance;
- after a recorded nonterminal outcome: claim issues the next ordinal while
  preserving the same external logical key;
- after completion committed but its response was lost, the original turn
  retries `completePublication` with the same retained nominal evidence and
  receives `replayed`; a true restart has no old evidence, calls
  `claimPublication`, and observes `none` or the next pending publication
  without republishing the completed one; and
- after terminal/limit/age blocking: claim returns reset-required and C4 makes
  no publisher call.

Defects and interruption do not become ordinary attempt outcomes and preserve
full Cause. Publisher failure outside the expected channel leaves the attempt
unsettled. A defective or interrupted state capability may or may not have
committed; the next invocation reconciles whichever durable state actually
won, without assuming the attempt remains available.

## Domain-First Files And Exports

After separate approval, C4 may add exactly:

- `packages/query-sync/src/orchestration/Turn.ts` for the shared Clock cutoff,
  bounded delay, and semantic state-retry mechanics currently embedded in
  `CatchUp.ts`;
- `packages/query-sync/src/orchestration/publication/Model.ts`;
- `packages/query-sync/src/orchestration/publication/Errors.ts`;
- `packages/query-sync/src/orchestration/publication/Ports.ts`;
- `packages/query-sync/src/orchestration/publication/Coordinator.ts`;
- `packages/query-sync/src/orchestration/publication/index.ts`;
- `packages/query-sync/src/testing/conformance/ReferenceResultPublisher.ts`;
- `packages/query-sync/test/publicationOrchestration.test.ts`; and
- `packages/query-sync/test/publicationOrchestrationRecovery.test.ts`.

C4 may modify exactly:

- `packages/query-sync/src/orchestration/CatchUp.ts`,
  `Evaluation.ts`, and `Coordinator.ts` only to consume the behavior-preserving
  shared `Turn.ts` mechanics;
- `packages/query-sync/src/orchestration/index.ts` to export the C4 factory,
  types, errors, and hard publisher-call maximum through the existing private
  `./internal/orchestration` subpath;
- `packages/query-sync/src/kernel/PublicationWork.ts` only for the non-barrel
  nominal acceptance bridge, reusing the existing
  `completePublication`/`publicationAttemptStateInvalid` invariant pair;
- `packages/query-sync/src/testing/conformance/index.ts` only for the reference
  publisher harness; and
- the query-sync roadmap files only for approved status/linkage and the eventual
  durable implementation boundary.

`Turn.ts` must be domain-neutral orchestration infrastructure. The extraction
cannot change C3 evaluation/source behavior, error channels, retry counts,
deadline equality, or Effect names without an amended preflight. Publication
code must not import generic turn mechanics from a C3-named catch-up module and
must not duplicate them.

No package export-map, package-root export, dependency, lockfile, kernel/state
semantic operation, package split, schema, migration, codec, or generated file
changes are authorized.

## Effect And Lifecycle Shape

The coordinator operations are named `Effect.fn` workflows. Pure capture,
validation, progress construction, and error projection remain pure
TypeScript/Effect `Result` where appropriate.

The factory returns a plain multi-instance value because binding, state, and
publisher vary dynamically per namespace and destination. It is not a global
`Context.Tag`, singleton `Layer`, `Scope`, `Fiber`, or runtime. It acquires no
resource and starts no background process. Host-owned Layers may construct
real capabilities later, but no such composition belongs in C4.

Expected publisher classifications are caught exhaustively by tag and mapped
to C2 outcomes. No `catchAll` converts defects or interruption into ordinary
failures. No `Effect.run*` call appears in reusable code or the reference
publisher.

## Reference Publisher And Destination

The testing subpath adds a deterministic reference publisher harness with a
shared in-memory destination that can outlive publisher and coordinator
instances. It is not a transport simulator or production adapter.

The shared harness owns explicit destination cells. Deduplication is keyed by
the destination cell plus exact logical publication identity and stores both
the accepted result digest and canonical content observation. Repeated calls
for the same exact publication at one destination produce at most one logical
append. The same publication sent to a different destination is independent.
A same-destination/identity observation with a different digest or different
canonical content is an invariant defect.

The harness scripts and logs at least:

- exact acceptance;
- known-not-appended;
- unknown without append;
- append then unknown;
- terminal refusal;
- defect before append;
- interruption before append;
- append then interruption;
- deterministic blocking/release for races; and
- a later exact read-back/acceptance of a previously appended unknown outcome.

Scripts, call logs, and snapshots are copied/frozen. `Ref` and `Deferred` may
coordinate deterministic tests. Effect TestClock owns time-based tests.

## Smallest Complete Reference Proof Matrix

C4 implementation must prove:

1. construction order, immutable capture, exact policy/budget limits, and use
   of only the three publication state methods;
2. `none` to frozen idle, exact success to durable completion, multiple
   canonical publications drained in state order, and no republish after
   completion;
3. known-not-appended, unknown-without-append, append-then-unknown, and terminal
   refusal with strict `claim -> one publish -> state settlement` order;
4. before-commit and after-commit faults for claim, outcome settlement, and
   completion, with exact state-argument replay and no extra publisher call in
   the retaining turn;
5. after-commit responses that cannot retry before cutoff followed by a new
   coordinator: lost claim publishes the same in-flight ordinal, a committed
   nonterminal outcome publishes only the next durable ordinal, a committed
   terminal/attempt-limit/age block returns reset-required with zero publish,
   and lost completion never republishes the completed publication;
6. admission equality, post-claim cutoff, positive whole-millisecond delivery
   budgets, retry-delay cutoff, and settlement-cutoff equality separately for
   successful completion and expected-failure outcome settlement, including an
   already-started state settlement awaited after cutoff;
7. exact physical-call limits, failures counting as calls, stop-before-claim at
   the limit, state retries not counting, and resume in a fresh turn;
8. restart with a new coordinator/publisher instance before call, after
   possible append, after recorded outcome, and after lost completion response,
   distinguishing in-turn evidence replay from restart claim behavior;
9. publisher defect, interruption-before-append, and append-then-interruption
   preserving full Cause with no ordinary outcome settlement;
10. claim, outcome-settlement, and completion-settlement capability defects and
    interruption preserving full Cause, making no downstream call after the
    interrupted stage, and leaving whichever durable state committed
    restart-recoverable;
11. two coordinators publishing one replayed attempt through a shared destination
   with one logical append and safe completed/replayed/superseded receipts;
12. acceptance versus `knownNotAppended`, `outcomeUnknown`, and terminal
    refusal in both state serialization orders: a later exact acceptance still
    completes the same logical in-flight publication after ordinal advance,
    while acceptance-first makes the delayed outcome `superseded`; conflicting
    non-success classifications preserve the C2 replay error;
13. an adversarial terminal-refusal/`recorded` state receipt dying as the
    declared invariant with no further claim or publisher call;
14. delayed outcome `recoveryEvidenceExpired`, delayed acceptance
    `superseded`, no ordinal rewind, and no newer-work overtake;
15. preblocked, attempt-limit, and age-limit work producing reset-required with
    zero publisher calls;
16. namespace, model, and epoch mismatch independently failing the authority
    fence with zero publisher, outcome-settlement, and completion calls;
17. copied/frozen outputs, two-destination non-cross-deduplication, exact
    digest/content collision rejection, namespace/model/epoch isolation, and a
    small deterministic seeded restart matrix; and
18. all C3 source/evaluator tests remaining green with zero publication calls
    from `makeNamespaceQuerySync`.

C1/C2 pure transition tests remain authoritative for lower-level publication
coalescing, attempt arithmetic, age/clock rules, evidence forgery, and capacity.
C4 tests exercise those only through orchestration seams; they do not duplicate
the entire state-oracle matrix.

## Explicitly Not Authorized

This preflight does not authorize:

- C4 implementation before explicit user approval;
- a real Durable Streams, Electric, HTTP, WebSocket, fetch, queue, filesystem,
  SQLite, PGlite, Postgres, or Cloudflare publisher/state adapter;
- delivery-adapter selection or acceptance of Durable Streams;
- a production runner, Durable Object, Worker, alarm, queue, scheduler,
  background Fiber, route, or deployment;
- Flarex query/model/change/result mappings or `QSYNC-FX01` implementation;
- a public client/gateway, auth protocol, SDK, reconnect/resume/reset API, or
  public relation API;
- a package-root export, new public subpath, client package, or package split;
- a reset/eviction/reconciliation transition for blocked publication work;
- a lease, owner token, concurrent-claim transition, generic transaction,
  aggregate read/save, raw CAS, or state escape hatch;
- transport receipts/offsets, credentials, or external producer identifiers,
  epochs, and sequences in query-sync state; C2's internal attempt ordinal and
  retained outcome/delivery tombstones remain unchanged;
- changes to OCC, commit compilation/execution, journals, idempotency outcomes,
  authoritative application rows, commit/change feed, or application outbox;
- Legacy dual state, dual writes, fallback, comparison, migration, cutover, or
  deletion of the current backend-local sync path;
- `R03-B`, Payload integration, or a claim of proven runtime portability.

Blocked work remains blocked/reset-required. C4 can report it; it cannot clear,
evict, overtake, or reconcile it without a separately approved state-authority
preflight.

## Validation And Review Gate

The eventual significant implementation must pass:

- `pnpm --filter @flarex/query-sync typecheck`;
- the full `@flarex/query-sync` test suite plus the focused C4 suites;
- `pnpm check:effect-boundaries`;
- forbidden-import, package-export, dependency, runtime, aggregate-read,
  transaction, lease, testing-mint, and publisher-ordinal audits;
- ownership inspection proving durable C2 state is the only work authority;
- uncertainty inspection proving no broad publisher retry, no unknown-as-
  rollback conversion, and exact state-operation replay;
- Clock/TestClock deadline and full Cause-preservation inspection;
- `pnpm lint:core`;
- `pnpm lint:diff`;
- `git diff --check`;
- both standing final-diff reviewers; and
- `pnpm lint:diff -- --staged` against the exact intended index before commit.

If reviewer-driven code changes alter the significant diff, both reviews must
rerun. Reference evidence must be reported as reference evidence only. No real
database, network, Cloudflare, or delivery proof may be claimed from C4.

## Exit And Next Gate

C4 exits only when the private coordinator and deterministic reference harness
prove every claim/outcome/completion receipt tag, exact acceptance,
known-not-appended, possible-append uncertainty, terminal refusal, defect,
interruption, state commit uncertainty, deadlines, physical-call bounds,
restart, and competing coordinators without another work authority.

Completion would make `QSYNC01-C` complete only as a private, runtime-neutral,
reference-backed engine contract. It would not make the system public,
deployed, or production-ready.

After C4 implementation is separately approved, completed, reviewed, and
committed:

- `QSYNC-FX01` may receive its own preflight for Flarex mappings and the first
  Cloudflare SQLite state adapter;
- `QSYNC-CF01` remains the independent delivery feasibility/selection gate;
- a real `ResultPublisher` remains blocked on its delivery-adapter preflight;
  and
- `R03-B` remains blocked through the later Flarex adapter, delivery/client,
  restart, and target-only recovery proofs.
