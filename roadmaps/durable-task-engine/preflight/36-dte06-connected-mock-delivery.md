# Preflight 36: DTE06-C3 Bounded Connected Mock Delivery

## Status

**Decision:** the C3 preflight is open, but C3 implementation is not yet
admitted. The intended production-inert boundary is sound: add operation-
specific candidate discovery in `@flarex/persistence-postgres`, then compose
fresh trusted scope resolution, the completed C2 repository, and only the
deterministic `TaskComputeProvider` in `flarex-backend`.

One connected-flow prerequisite remains unresolved. C2 cannot durably settle a
provider `TaskComputeCancellationStaleError` when a newer cancellation
generation has already been accepted. C3 may not hide that outcome, translate
it into an unrelated rejection, invent a cancellation receipt, or leave the
older checkpoint in an endless uncertain-replay loop. The bounded C2 contract
correction described below requires separate approval before C3 code begins.

Completed C2 commit `ff83e5bb` remains valid for its admitted repository
contract. This preflight records a missing connected outcome, not permission to
rewrite C2 transactions, the Task lifecycle, or the provider contract.

## Question

What is the smallest bounded runner that can discover persisted dispatch and
cancellation work, freshly resolve its scope, call the deterministic provider,
and durably settle only outcomes that the existing owners can prove, while
returning an exact restart continuation and remaining completely unwired?

## Source-Grounded Ownership

### Existing Owners Reused Directly

- `@flarex/durable-task/internal/compute-provider-v1` owns provider request,
  acceptance, cancellation, receipt, error, service, and Layer contracts.
- `@flarex/durable-task/internal/compute-provider-testing-v1` owns the
  deterministic in-memory provider and its accepted-but-response-lost hooks.
- `@flarex/persistence-postgres/internal/task-compute-delivery-repository-v1`
  owns fresh preparation, database-time claims, opaque handles, provider-call
  start evidence, claim renewal/release, and durable settlement.
- `replacementScopeDirectoryDiscoveryV1.ts` owns the existing stable
  replacement-scope directory mechanics. Its directory rows remain identity-
  only and carry neither a locator nor trusted authority.
- `scopeAuthorityResolution.ts` and the DTE05 repair-directory pattern own
  fresh control-plane-to-located-scope resolution and candidate-local failure
  handling.
- `taskRepairSweepV1.ts` is evidence for conservative unknown-progress
  charging, exact active-partition restart, receiver preservation, and empty
  filtered-page progress.

### Owner Of The Connected Flow

`flarex-backend` owns C3 effect delivery, fresh scope resolution, and provider
composition. It may depend on the two private package contracts above, but it
must not absorb their models or expose their capabilities through a public
route.

The persistence package continues to own SQL and located-scope construction.
The durable-task package continues to own provider semantics. The backend owns
only the orchestration decision that connects one acquired candidate to one
provider call and one permitted repository settlement.

## Reuse Classification

| Existing logic | Reuse class | C3 treatment |
| --- | --- | --- |
| Provider contract and deterministic adapter | unchanged | Supply the existing `TaskComputeProvider` service; do not wrap it in a second provider abstraction. |
| C2 repository | unchanged after its separately approved prerequisite | Call its exact acquire/start/settle operations; never reproduce SQL or mint handles. |
| Replacement-scope directory | seam-adapted | Reuse its discovery primitive with C3-owned errors and a resolver that constructs one located delivery partition. |
| Repair sweep control flow | seam-adapted evidence | Preserve high-water restart, owned capture, conservative reservations, and filtered-page advancement without importing repair-specific scheduler/due-cursor contracts into backend. |
| Run-specific requested-effect reader | rejected for discovery | It requires a known run and cannot find unseen work across a scope. |
| Generic outbox/effect framework | rejected | Dispatch and cancellation retain separate discovery, budgets, provider operations, and settlements. |
| Direct import of `@flarex/executor` repair sweep | rejected | It would reverse the intended backend ownership and leak repair-specific types into compute delivery. |

This is reuse of established control flow at the correct seams, not a rewrite
of provider, lifecycle, or transaction logic.

## Required C2 Prerequisite

### Reproducible Scenario

1. Persist two cancellation requested effects for the same accepted dispatch,
   with generations `g` and `g + 1`.
2. Two connected hosts acquire the independent C2 cancellation rows.
3. The provider accepts generation `g + 1` first.
4. Delivery of generation `g` returns
   `TaskComputeCancellationStaleError` with `receivedGeneration = g` and
   `acceptedGeneration = g + 1`.

The same result is possible after a crash if the provider accepted a newer
generation while Flarex lost or has not yet replayed its corresponding receipt.

### Expected

The older row closes with durable, non-receipt evidence that a strictly newer
generation superseded it. This outcome must not acknowledge Task cancellation,
must not manufacture the newer receipt, and must not consume a retry ceiling as
if the provider were unavailable.

### Actual

`TaskComputeCancellationKnownFailureV1` accepts only provider rejection and
definite transport failures. `recordCancellationKnownFailure` therefore cannot
accept the provider's typed stale-generation result. C3 could only propagate
the error after `markCancellationDeliveryStarted`, leaving the claim to expire
and replay forever, or misclassify it through an unsupported settlement.

### Affected Owner And Trust Boundary

The gap belongs to the private C2 persistence contract in
`taskComputeDeliveryRepositoryV1.ts`. It is not a defect in the deterministic
provider: rejecting a lower generation is the correct provider invariant. It
is not authority for C3 to add SQL, widen Task lifecycle outcomes, or create a
process-local generation lock.

### Recommended Bounded Correction

Extend only the C2 cancellation known-outcome path:

- admit `TaskComputeCancellationStaleError` as an exact known cancellation
  outcome after delivery has started;
- capture its caller-owned fields once and require identity equality,
  `receivedGeneration` equality with the checkpoint request, and
  `acceptedGeneration > receivedGeneration`;
- close the checkpoint as `rejected` with the stable reason
  `provider_stale_generation`;
- return a distinct `cancellation_rejected` receipt using that reason;
- clear claim state and close the opaque handle through the existing
  transaction/settlement boundary;
- store no provider receipt, execution secret, foreign cause, or invented
  acknowledgement; and
- do not change the Task aggregate or mark cancellation acknowledged.

The reason column already stores bounded snake-case reason codes, so this
correction should require no DDL or migration. Its focused gate must include
ordinary success, hostile/accessor input, identity/generation mismatch,
newer-before-older concurrency, replay after restart, handle closure, and all
existing C2 PGlite and genuine-PostgreSQL proofs unchanged.

A durable per-execution generation gate is not recommended for this gap. It
would add schema, migration, lock-order, expiry, and recovery authority merely
to avoid recording an exact provider outcome that already exists.

## C3 Persistence Discovery Contract

After the prerequisite is complete, persistence adds one private located-scope
subpath, tentatively
`@flarex/persistence-postgres/internal/task-compute-delivery-discovery-v1`.
It exposes two operations rather than a generic effect query:

```ts
interface TaskComputeDeliveryCandidateDiscoveryV1 {
  readonly discoverDispatchCandidates: (input: unknown) =>
    Effect.Effect<TaskComputeDeliveryCandidatePageV1, DiscoveryErrorV1>;
  readonly discoverCancellationCandidates: (input: unknown) =>
    Effect.Effect<TaskComputeDeliveryCandidatePageV1, DiscoveryErrorV1>;
}
```

Each candidate contains only:

- operation kind;
- branded run ID;
- branded requested-effect sequence; and
- the database-derived eligibility position used by the page.

It contains no effect payload, provider request, checkpoint bytes, locator,
authority, claim token, execution reference, or mutable row. C2 acquisition
freshly revalidates all authoritative state.

### Candidate Sources

Each operation-specific query unions exactly two sources:

1. an unseen requested effect of the matching kind with no operation checkpoint;
2. a nonterminal checkpoint whose initial/retry/expired-claim eligibility is at
   or before the captured database-time bound.

Accepted, delivered, rejected, and obsolete rows are excluded. Active claims
are visible only at their database-owned expiry. Retry rows are visible only at
`next_attempt_at`. A waiting cancellation remains discoverable so dispatch
acceptance can promote it, but it receives only the cancellation budget.

### Ordering And Continuation

Pages use deterministic
`eligible_at, run_id, requested_effect_sequence` ordering. The first page
captures a database-time bound and the maximum candidate tuple inside that
bound. A continuation contains:

- codec version and operation kind;
- database-time bound;
- high-water eligibility/identity tuple; and
- last-returned eligibility/identity tuple.

Decode rejects a mismatched operation, non-finite or non-canonical time,
`last > highWater`, excess properties, and malformed brands. Subsequent pages
remain within the captured high water. New work may wait for the next cycle;
candidate discovery never grants authority, so acquisition still decides
whether a returned identity is current, busy, not due, delivered, or closed.

The page limit is a validated positive safe integer with a small package-owned
ceiling. The query requests `limit + 1`, validates row count and exact ordering,
detaches driver rows, and returns frozen owned candidates. SQL, stale authority,
invalid input, and stored-row corruption remain distinct typed failures.

## C3 Trusted Directory

C3 reuses the replacement-scope directory primitive but supplies C3-owned
deployment decoding and failure types. Discovery returns deployment/scope
identity only. Resolution must:

1. freshly resolve the deployment through trusted control-plane ports;
2. prove the resolved authority scope equals the directory candidate;
3. construct the located candidate discovery and C2 repository from that same
   located target;
4. capture their methods once with receiver preservation; and
5. return candidate-local inert failure evidence for unavailable authority or
   invalid construction so one scope cannot starve the whole directory.

Page-level corruption or SQL failure remains fatal because advancing without a
trusted cursor is unsafe. Empty filtered directory pages with a continuation
advance normally.

## Connected Runner Contract

The backend adds a private `taskComputeDelivery` domain with a narrow service
contract, implementation Layer, continuation codec, and deterministic tests.
It is not placed in the existing live-query `delivery` folder and is not
exported from the public worker entrypoint.

One runner invocation:

1. decodes and owns its continuation and policy;
2. discovers or freshly re-resolves the exact active scope;
3. alternates dispatch and cancellation pages so each has an independent
   budget and continuation;
4. acquires each identity through C2;
5. treats `busy`, `not_due`, already delivered/accepted, waiting, and closed as
   handled candidate outcomes without calling the provider;
6. marks a claim as delivery-started before the provider call;
7. calls the existing `TaskComputeProvider` service outside every database
   transaction;
8. records exact acceptance/receipt success through C2;
9. records only provider rejection, definite transport failure, or the
   separately approved stale-generation outcome through C2;
10. leaves uncertain, contract, conflict, defect, timeout-after-start, and
    interruption-after-start outcomes unlabelled so expiry recovery can replay;
    and
11. returns an owned receipt and exact continuation without mutating Task
    lifecycle state.

Provider errors are not wrapped in a second generic delivery error. The runner
uses exhaustive tag-specific policy:

| Provider outcome | Durable action |
| --- | --- |
| Dispatch/cancellation success | Record exact canonical acceptance/receipt. |
| Typed provider rejection | Record C2 known failure with its retryable facet. |
| Typed definite transport failure | Record C2 known failure. |
| Typed stale cancellation generation | Record the approved C2 superseded-generation outcome. |
| Typed uncertain result | No known settlement; retain no local handle ownership and rely on expiry replay. |
| Contract mismatch or dispatch semantic conflict | No known settlement; fail closed and surface candidate evidence. |
| Defect or interruption | Preserve the Cause; do not translate it into a business failure. |

## Fairness And Boundedness

Policy is captured once and validates independent ceilings for:

- directory pages and scope resolutions;
- dispatch pages/candidates/provider calls;
- cancellation pages/candidates/provider calls;
- total scope visits and total operations;
- per-operation cooperative time admission;
- total wall time; and
- settlement reserve.

An active scope alternates operation pages and keeps both operation cursors in
its continuation. Finite high-water snapshots ensure busy or waiting rows can
be passed without permanently hiding later rows. The runner advances to the
next scope only after both operation snapshots exhaust or their per-scope visit
ceilings are charged. A later fresh cycle can revisit still-due work.

Unknown progress is charged conservatively. Once a database page or provider
operation is admitted, its full configured maximum is reserved. A typed
failure, timeout, interruption, or missing receipt does not refund that
reservation. Confirmed work counters remain separate from budget charges so
operational receipts never report worst-case reservations as completed work.

The Effect timeout is cooperative orchestration admission, not a claim that an
uninterruptible driver transaction was stopped. C3 reuses the proven
PostgreSQL deadline/disposition owner beneath C2 and does not add a second
timeout authority.

## Canonical Continuation

The private continuation records:

- version;
- unstarted/continuing/exhausted directory state;
- an optional exact active deployment/scope identity;
- directory position after that active scope;
- next operation turn;
- dispatch discovery cursor or exhausted marker; and
- cancellation discovery cursor or exhausted marker.

Encoding and decoding use one strict canonical codec. An active continuation
is never trusted as authority: resume freshly resolves the expected candidate
and rejects deployment/scope mismatch before using either inner cursor. The
codec validates outer/inner high-water correlation, operation correlation,
explicit-null versus legacy-missing semantics if compatibility is admitted,
and all bounds before returning an owned frozen value.

No continuation is persisted or scheduled in C3. Tests pass encoded evidence
between separate runner instances to prove restart. A later checkpoint must
own durable scheduling, fencing, and activation.

## Validation Gates

The admitted implementation, after its prerequisite, must prove:

- C2 stale-generation settlement in PGlite and genuine PostgreSQL;
- dispatch and cancellation discovery unseen/due/expired union semantics;
- stable high water, exact ordering, canonical continuation, empty pages, and
  hostile/corrupt rows;
- two-host claim exclusion and crash/restart replay;
- dispatch acceptance before cancellation readiness;
- lower/newer cancellation generation races without endless replay;
- accepted-but-response-lost dispatch and cancellation recovery against the
  deterministic provider;
- separate operation budgets, active-scope resume, later-scope progress, and
  conservative unknown-progress accounting;
- receiver preservation and caller-owned input capture;
- typed failures, defects, interruption, and settlement behavior;
- durable-task, persistence, and backend focused typechecks/tests;
- lifecycle, source-map, Effect, and Trigger-compatibility boundary gates; and
- both required project reviewers against the final significant code diff.

## Implementation Sequence After Approval

1. Correct and prove the bounded C2 stale-generation settlement.
2. Add the private persistence discovery models, codecs, SQL, and PGlite plus
   genuine-PostgreSQL proof.
3. Add the backend trusted directory and exact active-scope continuation codec.
4. Add the Effect service/Layer and single-candidate dispatch/cancellation
   operations against the existing provider and repository.
5. Add the bounded connected runner and deterministic restart/fairness suite.
6. Run final gates, reviewers, update the roadmap receipt, and commit while
   leaving every host and activation path absent.

## Stop Boundary

This preflight does not authorize:

- the C2 prerequisite correction until separately approved;
- changing requested-effect or Task lifecycle semantics;
- a generic effect/outbox framework or direct raw Drizzle use in backend;
- a real provider, Cloudflare adapter, Worker Loader route, R2 input loading,
  task runtime, heartbeat, completion, or result publication;
- a scheduled host, Queue/cron consumer, durable C3 checkpoint, deployment
  binding, or production activation;
- public SDK, management, observability, log, trace, or output-stream APIs; or
- DTE06-D/E/F or DTE05-E3 implementation.
