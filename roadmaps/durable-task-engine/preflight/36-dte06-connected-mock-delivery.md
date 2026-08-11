# Preflight 36: DTE06-C3 Bounded Connected Mock Delivery

## Status

**Decision:** the C3 preflight and its bounded pending-membership amendment are
approved. The first implementation checkpoint is complete: operation-specific
discovery reads the indexed projection and closes its migration, transaction,
high-cardinality, PGlite, and ordinary-role PostgreSQL gates. The backend
trusted directory is the next admitted production-inert checkpoint.

The connected-flow prerequisite is resolved. C2 now captures and correlates a
provider `TaskComputeCancellationStaleError`, rejects the older checkpoint as
`provider_stale_generation`, clears its claim, closes its handle, stores no
receipt, and leaves Task cancellation unacknowledged. Focused PGlite and
ordinary-role genuine-PostgreSQL 18 lanes prove newer-before-older provider
ordering and exact closed replay. No DDL or lifecycle change was required.

Completed C2 commit `ff83e5bb` remains the base repository checkpoint, and
correction commit `a1f2d296` adds only the exact connected outcome described
below. Neither rewrites the Task lifecycle or the provider contract.

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

## Resolved C2 Prerequisite

### Reproducible Scenario

1. A valid provider request for one dispatch identity reaches the provider with
   cancellation generation `g + 1`.
2. Before Flarex has recorded or recovered that newer receipt, delivery or
   uncertain replay of a persisted older row submits generation `g` for the
   same identity.
3. Delivery of generation `g` returns
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
newer-before-older provider ordering, replay after restart, handle closure, and
all existing C2 PGlite and genuine-PostgreSQL proofs unchanged. Two-host
discovery and overlapping connected settlements remain a C3 orchestration gate;
C2 must not manufacture extra lifecycle-ledger rows to simulate them.

A durable per-execution generation gate is not recommended for this gap. It
would add schema, migration, lock-order, expiry, and recovery authority merely
to avoid recording an exact provider outcome that already exists.

## C3 Persistence Discovery Contract

Persistence now owns one private located-scope subpath,
`@flarex/persistence-postgres/internal/task-compute-delivery-discovery`.
The capability and product names are unversioned; only the concrete
continuation compatibility contract carries `V1`.
It exposes two operations rather than a generic effect query:

```ts
interface TaskComputeDeliveryCandidateDiscovery {
  readonly discoverDispatchCandidates: (input: unknown) =>
    Effect.Effect<TaskComputeDeliveryCandidatePage, DiscoveryError>;
  readonly discoverCancellationCandidates: (input: unknown) =>
    Effect.Effect<TaskComputeDeliveryCandidatePage, DiscoveryError>;
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

1. an indexed pending membership for an unmaterialized requested effect of the
   matching kind;
2. a nonterminal checkpoint whose initial/retry/expired-claim eligibility is at
   or before the captured database-time bound.

Accepted, delivered, rejected, and obsolete rows are excluded. Active claims
are visible only at their database-owned expiry. Retry rows are visible only at
`next_attempt_at`. A waiting cancellation remains discoverable so dispatch
acceptance can promote it, but it receives only the cancellation budget.
Pending membership retains its database-derived, millisecond-aligned
`eligible_at`. Initial legacy checkpoints receive the first page's captured
database-time bound as their stable eligibility position. Retry and claimed
checkpoints retain their millisecond-aligned `next_attempt_at` and
`claim_expires_at` positions respectively.

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

### Persistence Discovery And Pending-Membership Receipt

The candidate first checkpoint now provides:

- an unversioned private located-scope capability with separate dispatch and
  cancellation Effects and exact operation-specific error channels;
- a strict owned `TaskComputeDeliveryContinuationV1` codec that rejects excess
  fields, malformed brands and timestamps, operation mismatch, future bounds,
  backward positions, and driver/cursor correlation failure;
- one locked-authority READ COMMITTED query per page, with database-owned lock,
  statement, and transaction deadlines, raw indexed timestamp keysets, a
  `limit + 1` merge, a retained database-time bound, and an exact high-water
  tuple;
- inert candidates containing only operation, eligibility position, branded
  run ID, and branded requested-effect sequence; and
- focused PGlite proof plus genuine PostgreSQL 18 ordinary-role migration,
  transaction, and `EXPLAIN ANALYZE (BUFFERS)` proof for the pending, due, and
  claim indexes over large checkpointed history.

The capability remains unwired. It creates no claim, provider call, backend
service, host, route, checkpoint, schedule, or lifecycle transition. Cloned
pagination fixtures deliberately exercise only inert identity ordering; C2
still performs the complete aggregate/effect correlation before authority can
be acquired.

#### Resolved boundedness evidence

- **Scenario:** a mature scope has a large number of dispatch or cancellation
  requested effects whose operation checkpoints already exist, with no unseen
  effect currently pending.
- **Expected:** each empty or fresh discovery query performs index-bounded work
  before returning an empty page or the next pending effect.
- **Previous actual:** the requested-effect kind index enumerated matching history and
  the checkpoint anti-join rejects rows afterward; `limit` cannot stop the scan
  until enough absent checkpoints are found. The same work occurs in the
  high-water and page branches and can repeatedly hit the statement deadline.
- **Owner boundary:** exact pending membership must be materialized by the
  requested-effect/checkpoint schema and write transaction owner. SQL-only C3
  discovery cannot index absence across the two tables.
- **Evidence:** the final systems review rejected the one-row index-name plan
  assertion as insufficient; a high-cardinality checkpointed-history case
  remains unprovable with the current representation.
- **Disposition:** resolved by the purpose-built pending-delivery projection
  below. The final ordinary-role PostgreSQL plan reads the pending covering
  index without touching requested-effect history and keeps observed rows and
  buffers within the admitted page bound.

#### Approved pending-membership amendment

The Task System lifecycle transaction adds one Task-owned persisted projection,
`fx_system_durable_task_compute_pending_v1`. This is not a second requested-
effect ledger and grants no delivery authority. It contains only:

- trusted `scope_id`, branded `run_id`, and requested-effect sequence;
- the exact requested kind, limited to `dispatch_attempt` or
  `request_execution_cancellation`; and
- a database-derived, millisecond-aligned `eligible_at` ordering position.

Its primary key is the requested-effect identity. A covering discovery index
orders `(scope_id, kind, eligible_at, run_id, requested_effect_sequence)`, and
an exact foreign key binds each row to the immutable requested effect.

The existing lifecycle transaction inserts the projection in the same commit
as each admitted compute requested effect. A failure to insert either rolls
back both. It does not decode provider evidence, create a compute checkpoint,
claim work, or call a provider. Other requested-effect kinds never receive a
row.

C2 acquisition deletes the exact pending row inside the same located,
authority-locked transaction that validates the requested effect and creates or
observes its operation checkpoint. Any later rollback restores the pending row;
a committed checkpoint and pending row cannot be produced by the amended write
path. A missing row remains compatible with already-materialized checkpoints
and legacy pre-amendment recovery, while a present row with a mismatched kind is
stored corruption and rolls back.

Migration backfills only compute requested effects that do not already have
their operation checkpoint. All backfilled rows share the migration's captured
millisecond database time; tuple identity still gives a total order. The
migration must be atomic and idempotent through the Drizzle journal, preserve
all historical requested effects and checkpoints, and prove constraints plus
backfill on PGlite and genuine PostgreSQL.

Discovery removes the requested-effect/checkpoint anti-join. Its unseen branch
reads only the pending projection through the covering index; retry and expired-
claim branches read the checkpoint indexes, with initial/retry scans restricted
to partial `claim_owner is null` due indexes. A populated genuine-PostgreSQL
`EXPLAIN ANALYZE (BUFFERS)` lane must prove nonempty pending, initial, retry, and
expired-claim branch work stays bounded when checkpointed requested-effect
history is much larger than the pending set.

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

The C3 implementation must prove:

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

1. **Complete:** correct and prove the bounded C2 stale-generation settlement.
2. **Complete:** the pending projection, atomic lifecycle write and C2
   consumption, backfill migration, indexed private discovery SQL, V1
   continuation, and deadline policy pass their focused gates.
3. **Next:** add the backend trusted directory and exact active-scope
   continuation codec.
4. Add the Effect service/Layer and single-candidate dispatch/cancellation
   operations against the existing provider and repository.
5. Add the bounded connected runner and deterministic restart/fairness suite.
6. Run final gates, reviewers, update the roadmap receipt, and commit while
   leaving every host and activation path absent.

## Stop Boundary

This preflight does not authorize:

- additional C2 transaction, schema, requested-effect, or lifecycle changes;
- changing requested-effect or Task lifecycle semantics;
- a generic effect/outbox framework or direct raw Drizzle use in backend;
- a real provider, Cloudflare adapter, Worker Loader route, R2 input loading,
  task runtime, heartbeat, completion, or result publication;
- a scheduled host, Queue/cron consumer, durable C3 checkpoint, deployment
  binding, or production activation;
- public SDK, management, observability, log, trace, or output-stream APIs; or
- DTE06-D/E/F or DTE05-E3 implementation.
