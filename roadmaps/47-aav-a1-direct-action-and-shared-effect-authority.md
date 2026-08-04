# AAV-A1 Direct Action And Shared External-Effect Authority

## Status And Decision

**Status:** Accepted and complete privately. Both mandatory exact-final
reviewers reported no findings after the final corrections. The four admitted
protocol identities, R2 evidence-body owner,
exactly two PostgreSQL tables, operation-specific authority, active-action
admission facade, and PGlite/genuine-PostgreSQL proofs now exist. The capability
remains production-inert: there is no action runtime, route, binding, trigger,
scheduler, task integration, or production caller.

Implementation evidence preserves the ownership decision: canonical argument,
result, and HTTP bodies live only in content-addressed R2 objects; PostgreSQL
stores their identities, codec/length/digest commitments, parent authority,
fences, lifecycle, and uncertainty evidence. The active-action admission
composition writes and verifies R2 before the short PostgreSQL transaction,
and exact request replay reuses one invocation row and one R2 object.

The admitted design is one private, production-inert capability with two
deliberately different parent authorities:

1. a direct edge-action invocation owner for request admission, singular
   request-scoped execution, exact replay, and terminal result; and
2. one external-effect evidence owner that can bind to a direct action now and
   a fenced durable-task attempt later without owning either lifecycle.

The first implementation uses exactly two new tables. It does not add an
action run, action attempt, action lease, action heartbeat, task alias, outcome
table, effect-subject registry, transition-event table, queue, scheduler, or
redrive table.

## Sources Of Truth

This receipt refines, but does not replace:

- [`46-private-standard-edge-action-vertical.md`](./46-private-standard-edge-action-vertical.md)
  for the ordered AAV-A1, AAV-A2, and SAP07 gates;
- [`42-standard-application-apis.md`](./42-standard-application-apis.md) for
  Standard API placement and route-independent sequencing;
- [`durable-task-engine/README.md`](./durable-task-engine/README.md),
  [`durable-task-engine/02-task-definition-identity-and-scope.md`](./durable-task-engine/02-task-definition-identity-and-scope.md),
  and
  [`durable-task-engine/03-run-attempt-engine.md`](./durable-task-engine/03-run-attempt-engine.md)
  for first-class task identity and task run/attempt lifecycle;
- [`durable-task-engine/preflight/10-dte-ip01-input-and-store-port-contract.md`](./durable-task-engine/preflight/10-dte-ip01-input-and-store-port-contract.md)
  and
  [`durable-task-engine/preflight/16-operation-outcomes-evidence-effects-and-errors.md`](./durable-task-engine/preflight/16-operation-outcomes-evidence-effects-and-errors.md)
  for the scope-bound Task System port and sequenced orchestration effects;
- [`../design-notes/flarex-durable-task-engine.md`](../design-notes/flarex-durable-task-engine.md)
  for the direct-action versus durable-task distinction;
- [`../design-notes/flarexdb-system-apis-proposal.md`](../design-notes/flarexdb-system-apis-proposal.md)
  for private capability ownership;
- existing active-revision, candidate-publication, R2, readiness, activation,
  validator, executor, SAP04, SAP05, and C07 owners; and
- the current `@flarex/durable-task` run-attempt model as implementation
  evidence only until its owning checkpoint is committed.

## Ownership Reconciliation

### Facts owned by the durable-task engine

The Task System API remains the only owner of:

- stable task run and task attempt identity;
- task run version and execution fence;
- attempt grant, lease, heartbeat, retry, cancellation, and terminal phase;
- task policy, retry jitter, compute profile, and attempt limits; and
- sequenced `flarex.task-requested-effect.v1` orchestration instructions such
  as dispatch, wakeup, cancellation, event publication, and notification.

Those requested effects describe what the task host should do next. They do
not prove whether user code dispatched a payment, email, webhook, HTTP request,
or child mutation.

### Facts owned by direct action invocation

The direct-action owner controls only:

- exact request-key admission and contradictory-reuse rejection;
- the immutable active revision, candidate, action entry, authenticated
  execution identity, arguments, compatibility date, and host-policy binding
  captured when the request was admitted;
- one bounded request-scoped execution generation and deadline;
- exact completed-result replay or a typed terminal non-completed result; and
- cancellation and recovery decisions for that direct request.

It has no task ID, run ID, attempt number, task lease, heartbeat, retry policy,
queue, due time, checkpoint, waitpoint, schedule, or task event stream.

### Facts owned by shared external-effect evidence

The shared owner records only:

- an authenticated execution-subject commitment and fence;
- a monotonic effect ordinal under that subject;
- the exact effect kind, request commitment, stable effect key, and R2 body
  references prepared before dispatch;
- the conservative dispatch boundary; and
- confirmed response, confirmed pre-dispatch failure, or uncertain-after-
  possible-dispatch evidence.

It cannot claim, retry, cancel, schedule, or complete its parent. Parent
coordinators inspect evidence and make their own lifecycle decision.

## Private Protocol Identities

The implementation preflight admits these exact private identity spellings:

- `flarex.system/application-action-invocation-request/v1`;
- `flarex.system/application-action-invocation-outcome/v1`;
- `flarex.system/external-effect-execution-subject/v1`; and
- `flarex.system/external-effect-attempt/v1`.

The earlier proposed
`flarex.system/application-action-effect-attempt/v1` is rejected before
implementation because an action-named journal would force a parallel task
journal later. There is no dual decoder or compatibility alias because the
earlier spelling was never implemented or shipped.

Canonical execution subjects have a closed parent-kind union:

```text
direct_action
  scope authority + invocation ID + request identity
durable_task_attempt
  scope authority + run ID + attempt ID + task-definition revision
```

The canonical subject identity is a SHA-256 commitment over the versioned
parent frame. Its separate positive unsigned fence is:

- the direct action execution generation for `direct_action`; or
- `TaskExecutionFenceV1` for `durable_task_attempt`.

The shared protocol does not import either parent package. Parent adapters
construct the versioned preimage and issue an operation-scoped, scope-bound
capability. User code cannot supply a subject digest, parent kind, fence,
ordinal, or object-store reference.

Only the `direct_action` parent adapter is implemented in AAV-A1. The
`durable_task_attempt` encoding and hostile vectors are admitted now so the
storage identity cannot later be reinterpreted, but no task host, task table,
Task System method, or task-side write is added in this slice.

## R2 Body Ownership

PostgreSQL is not an invocation-body store. R2 owns canonical bodies for:

- direct action arguments and completed results;
- outbound HTTP request and response bodies;
- bounded declared application-error details when durable replay needs them;
  and
- any future task input/result/effect body admitted by its owning roadmap.

The AAV-A1 object-store identity is:

- `flarex.r2/execution-evidence-body/v1`.

The first codec identities are:

- `flarex.codec/canonical-flarex-value/v1`;
- `flarex.codec/canonical-http-request/v1`; and
- `flarex.codec/canonical-http-response/v1`.

Every PostgreSQL reference stores the object-store identity, codec identity,
deterministically derived object key, byte length, and SHA-256 digest. The R2
adapter fetches the exact object and verifies all five claims before use. A
missing, wrong-codec, wrong-length, wrong-digest, noncanonical, or oversized
body fails closed. No source module, runtime projection, arguments, result,
HTTP body, arbitrary headers JSON, stack, Cause, or foreign error is stored in
PostgreSQL.

The private Standard System compositions are the first write consumers for
arguments, completed results, and outbound HTTP request/response references.
They publish the canonical bytes to R2, cold-read and verify the exact stored
object, and only then enter the short PostgreSQL transition. The lower
persistence owner re-decodes every supplied reference and stores only its
captured canonical identity fields; it is not an alternate object-store
verification or publication API.

The owning AAV-A2 host-policy identity sets argument, result, request,
response, cumulative, and concurrency ceilings. AAV-A1 validates references
against the captured host policy rather than creating a second set of action
size constants. R2 publication precedes a transaction that references the
object. A failed transaction may leave an unreferenced content-addressed object
for later garbage collection; a database row must never point at an object
that was not successfully written and verified first.

## Minimal Persistence Shape

### `fx_system_application_action_invocation_v1`

There is one mutable state row per scope and request key. It contains only:

- scope UUID plus captured epoch and storage-generation fence;
- request key, generated invocation ID, request identity SHA-256, and exact
  action binding commitment;
- immutable application revision, candidate, action function, authenticated
  identity commitment, compatibility date, and host-policy commitment;
- canonical argument R2 reference;
- lifecycle kind, positive execution generation, database-authoritative fixed
  invocation time, execution deadline, and request-owned random-seed
  commitment;
- the last allocated external-effect ordinal;
- nullable cancellation request time;
- completed-result R2 reference or closed terminal failure/uncertainty code;
  and
- admitted, updated, and terminal database timestamps.

The primary key is `(scope_uuid, request_key)`. `invocation_id` is unique under
the scope. The exact request identity makes same-key replay deterministic and
contradictory reuse an error. The row pins the admitted revision/candidate for
its lifetime: a later active-head change does not move or invalidate an
in-flight invocation. Scope revocation or storage-generation change still
fails closed.

Lifecycle is exactly:

```text
admitted
  -> executing
       -> completed
       -> failed
       -> uncertain
       -> cancelled
       -> admitted       only after proven pre-dispatch recovery
admitted
  -> cancelled
```

There is no separate outcome table. Terminal outcome fields are constant-
cardinality members of the invocation row and exact replay returns them from
that row.

### `fx_system_external_effect_attempt_v1`

There is one row per
`(scope_uuid, subject_kind, subject_identity_sha256, subject_fence,
effect_ordinal)`. It contains only:

- the canonical subject fields and positive ordinal;
- effect kind: `outbound_http` or `child_mutation`;
- stable effect key and exact request identity SHA-256;
- the request R2 reference for outbound HTTP, or the derived SAP04 child
  request key plus exact callee/argument commitment for a child mutation;
- state, prepared time, dispatch-declared time, settled time;
- confirmed HTTP response R2 reference or confirmed child mutation outcome
  commitment when available; and
- a closed failure/uncertainty code.

State is exactly:

```text
prepared
  -> failed_before_dispatch
  -> dispatching
       -> confirmed
       -> uncertain
```

`dispatching` is committed before the host hands the request to a network or
child-mutation adapter. A crash between that commit and the actual send is
conservatively uncertain even if the destination never observed the request.
Once `dispatching` is committed, no failure is classified as proven pre-
dispatch and the platform never automatically sends that effect again. The
stable effect key improves behavior only when the destination explicitly
honors idempotency; it does not establish exactly-once delivery.

There is no subject registry table and no polymorphic foreign key. The
scope-bound parent coordinator supplies an unforgeable in-memory capability;
the repository validates the canonical subject commitment and fence on every
transition. This avoids duplicating parent state while keeping user-authored
subject values outside the API.

## Direct Action Operations

The private System owner exposes narrow operations, not a generic repository:

1. `admitDirectActionInvocationV1` uploads/verifies argument evidence, reads one
   coherent active selection, and inserts or exactly replays the request.
2. `claimDirectActionExecutionV1` changes `admitted` to `executing`, increments
   the execution generation, fixes database time/deadline and random-seed
   commitment, and returns an operation-scoped subject capability.
3. `prepareExternalEffectAttemptV1` allocates the next ordinal and records the
   exact request before dispatch.
4. `declareExternalEffectDispatchV1` changes `prepared` to `dispatching` in a
   short transaction before the host calls the external adapter.
5. `confirmExternalEffectAttemptV1` records a verified response/outcome
   commitment after dispatch.
6. `failExternalEffectBeforeDispatchV1` is permitted only from `prepared`.
7. `markExternalEffectUncertainV1` changes `dispatching` to `uncertain`.
8. `settleDirectActionInvocationV1` records a validated completed result or a
   closed terminal non-completed result. A parent cannot become completed,
   failed, or cancelled while a prepared effect remains, and an uncertain
   parent atomically closes every dispatching effect as uncertain.
9. `requestDirectActionCancellationV1` records cancellation intent; cancellation
   before execution settles immediately, while an executing host must drain
   owned work before the parent can classify the result. Expiry recovery never
   clears that intent or resurrects the invocation as admitted: it closes
   undispatched effects and terminals the parent as cancelled.
10. `recoverExpiredDirectActionExecutionV1` uses database time and current
    effect/child-outcome evidence to retry only a proven pre-dispatch execution;
    any possible dispatch settles the parent as uncertain.
11. `inspectDirectActionInvocationV1` returns a detached, scope-authorized
    projection with no raw bodies or persistence rows.

Every operation reacquires one scope-bound capability, validates epoch and
storage generation before lookup, uses database time, decodes stored state as
corruption, performs one short transaction, and returns detached immutable
data. No transaction spans Worker execution, R2 I/O, HTTP I/O, or SAP04/SAP05.
Once a transaction has started, caller interruption is observed only after the
transaction settles; the caller cannot return while an uncancellable driver
transaction continues in the background. Every caller-supplied digest is
captured before the asynchronous persistence boundary.

Concurrent exact admission has one winner and exact followers replay it.
Contradictory request-key reuse writes nothing. Concurrent claim, effect
ordinal allocation, dispatch declaration, settlement, cancellation, and
recovery use expected lifecycle/generation/fence checks and return current
state or a typed conflict without partial writes.

## Replay, Recovery, And Cancellation Rules

- Exact completed replay returns the stored validated result without loading
  or executing the Worker.
- Exact terminal non-completed replay returns the same typed terminal result.
- A duplicate while `executing` returns current/in-progress; it does not start
  another Worker.
- An execution deadline is not a task lease and is not renewed by heartbeats.
  It bounds one request-scoped execution generation.
- Expiry with no `dispatching`, `confirmed`, or `uncertain` effect and no child
  mutation that may have committed permits a new generation for the same exact
  request.
- Expiry, cancellation, timeout, cleanup failure, or response loss after a
  possible dispatch atomically marks dispatching evidence `uncertain`, closes
  any concurrently prepared evidence as `failed_before_dispatch`, and marks
  the parent `uncertain`; already confirmed evidence remains confirmed. User
  code is not restarted to reconstruct its continuation.
- A prepared but not dispatch-declared effect can be closed as
  `failed_before_dispatch` and does not by itself prevent exact-request retry.
- A confirmed child mutation is never rolled back by the action. It remains a
  separate SAP04/C07 outcome.
- A later active application head does not change the admitted target or
  replay. Scope revocation and storage-generation replacement still invalidate
  authority.

The first slice performs no automatic redrive. A caller may retry the same
request key and receive exact replay, in-progress, safe pre-dispatch recovery,
or terminal uncertainty according to stored evidence.

## Failure And Result Contract

The System result distinguishes:

- admitted/claimed/current execution;
- completed validated action value;
- declared application or validator failure;
- cancelled before dispatch;
- retryable failure proven to precede any possible effect;
- uncertain after possible external or child-mutation dispatch;
- contradictory request-key reuse;
- stale or revoked scope authority;
- retryable versus terminal R2/persistence integration failure; and
- stored protocol/evidence corruption.

Expected domain failures remain typed. Foreign persistence/R2 causes are
retained only on internal errors and redacted at transport/log boundaries.
Defects, interruption Cause, stacks, credentials, headers, and response bodies
are never normalized into an ordinary public error.

## Migration And Repository Gate

The implementation may add one forward-only migration containing exactly the
two tables above plus matching Drizzle schema and generated metadata. It must:

- use the next migration number at implementation time and never rewrite
  migration history;
- add explicit checks and dependency-safe foreign keys only to existing scope,
  revision, and candidate owners where the relationship is exact;
- avoid `CASCADE`, generic JSON state, PostgreSQL body bytes, duplicate outcome
  rows, dual writes, compatibility views, and fallback readers;
- keep one private repository/facade with operation-specific transaction
  methods; and
- remain production-inert with no route, binding, trigger, scheduler, queue,
  alarm, or background consumer.

If implementation evidence requires another table, a parent-lifecycle write
from the shared evidence repository, a task package dependency from
`flarex-protocol`, or a second external-effect identity, stop and amend this
preflight before migration work.

## Required Validation

### Protocol and identity

- exact canonical request, outcome, subject, and effect vectors;
- field-order, tag, version, digest, fence, ordinal, bounds, wrong-parent, and
  cross-scope perturbations;
- direct-action and durable-task subject commitments are distinct for equal
  text identifiers; and
- the rejected action-only effect identity has no decoder, export, generated
  vector, table, or compatibility alias.

### R2 ownership

- warm/cold write-read verification for arguments, results, HTTP requests, and
  responses;
- missing object, wrong store/codec/key/length/digest, noncanonical body, and
  policy-ceiling rejection; and
- PostgreSQL inspection proving no canonical body/source/runtime bytes are
  stored in either table.

### PGlite and genuine PostgreSQL

- fresh migration, upgrade from the current head, repeated migration, and
  rollback/refusal evidence;
- concurrent exact admission winner and contradictory reuse loser;
- singular claim, monotonic generation, ordinal allocation, and fence checks;
- prepared rollback, dispatch-boundary uncertainty, confirmed response,
  completed replay, cancellation, deadline recovery, and lost-response cases;
- transaction failure at every write boundary with no partial state;
- controlled interruption proving the caller waits for transaction settlement,
  plus hostile post-validation buffer mutation proving persisted digests use
  owned captures;
- stale scope epoch/storage generation and captured-revision behavior; and
- server version, concurrency counts, zero skips, and bounded stress evidence.

### Regression and ownership

- SAP04, SAP05, SAP06, C03/C07, active selection, readiness, R2 publication,
  database metadata, generated identity, and Effect-boundary checks;
- durable-task lifecycle/vector tests unchanged;
- schema inventory proving only two AAV-A1 tables; and
- both mandatory exact-final reviewers after the final significant code diff,
  followed by fixes, reruns, and re-review.

## Explicit Exclusions

AAV-A1 does not authorize:

- AAV-A2 Worker/runtime implementation or SAP07 composition;
- task creation, task host integration, schedules, queues, retries, waitpoints,
  checkpoints, workflows, cron, alarms, or effect redrive;
- public SDK/API stabilization, FSV07 routing, bindings, triggers, production
  callers, or activation changes;
- internal actions, `runAction`, query/mutation-to-action calls, Node actions,
  provider placement, containers, or heavy jobs;
- another active reader, alternate OCC/commit, action-owned application
  transaction, child rollback, dual writes/acceptance, fallback, or legacy
  removal; or
- PostgreSQL storage of user code, artifact bodies, canonical arguments,
  results, HTTP bodies, logs, traces, or arbitrary JSON.

## Next Gate

The separately approved AAV-A2 implementation is accepted and complete
privately in
[`48-aav-a2-candidate-bound-edge-action-runtime.md`](./48-aav-a2-candidate-bound-edge-action-runtime.md).
It pins one candidate-bound `action-edge` exact runtime, authenticated
outbound/query/mutation callback bridge, target/profile/syscall ABI, canonical
host policy, resource ceilings, and cleanup semantics. Its outbound and child-
mutation bridges reuse this AAV-A1 authority rather than creating another
invocation or effect journal. SAP07, durable-task host
integration, routes, and production behavior remain later gates. The next
separate Standard gate is SAP07.
