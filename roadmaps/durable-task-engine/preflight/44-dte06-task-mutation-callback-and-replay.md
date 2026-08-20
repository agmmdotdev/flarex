# Preflight 44: Durable Task Mutation Callback And Replay

## Status And Decision

**Status:** In progress privately and blocked at the persistence settlement
boundary. The source audit and ownership decision are approved. Slice 1 owns
the strict private callback contract plus the
domain-separated stable-key and exact-request preimages. Slice 2 now owns the
opaque Application Task subject and the Task child-mutation transitions over
the existing shared external-effect table. Slice 3 now adds an opaque,
principal-bound entry into the existing Application mutation owner while
retaining its anonymous foreground entry. Slice 4A now wires the strict mutation
RPC through the Application Task Worker, Worker definition, session host,
supervised Worker Loader provider, absolute deadline, cancellation, and
close/drain lifetime. A Slice 4B coordinator draft exposed that the current
external-effect transitions cannot authoritatively reconcile commit-response
loss or prove a bounded Postgres settlement before subject revocation. That
owner expansion is proposed separately in
[`45-dte06-task-mutation-settlement-reconciliation.md`](./45-dte06-task-mutation-settlement-reconciliation.md)
and requires approval before Slice 4B can complete. No production activation
exists.

The first side-effecting Task context capability will be `ctx.runMutation`.
It will not create another mutation engine, another OCC/commit path, another
Task lifecycle effect kind, or a universal compute provider. It will compose:

1. the current Application Task launch-bound principal and runtime target;
2. the existing `ApplicationMutationSystem` transaction, OCC, journal, commit,
   and exact-request replay authority;
3. the existing shared external-effect protocol and
   `fx_system_external_effect_attempt_v1` table, whose admitted contract already
   includes `durable_task_attempt` subjects and `child_mutation` effects; and
4. a new Task-owned callback/session adapter that binds those capabilities to
   the current run, attempt, execution fence, operation ordinal, deadline, and
   cancellation lifetime.

This is reuse of existing Flarex core logic. Trigger.dev remains the frozen
behavior and provenance oracle for durable orchestration, retry, and recovery;
no Trigger runtime package, Prisma query shape, Redis/Redlock authority,
organization identity, workspace, or lockfile enters the implementation.

## Why This Is Not The Query Callback With A Different Method Name

`ctx.runQuery` is read-only. Its session-local ordinal is diagnostic and a
retry may safely execute the query again.

`ctx.runMutation` can commit before its response reaches the Task Worker. If a
Task attempt then retries, process-local call state is gone. Calling the
mutation with a fresh identity could commit twice. The mutation callback must
therefore persist its exact intent before dispatch and use a request identity
that is stable across attempts of the same run.

The existing lifecycle `flarex.task-requested-effect.v1` ledger is not that
record. It contains Task-host orchestration instructions such as dispatch,
wakeup, cancellation, event publication, and notification. Adding a user child
mutation to that union would mix lifecycle authority with external-effect
evidence and is rejected.

## Current Reuse Inventory

### Reused without semantic replacement

- `ApplicationMutationSystem` remains the only owner of Application mutation
  selection, argument validation, grant issuance, session activation, OCC
  rerun, journal execution, commit publication, and durable outcome lookup.
- The point-mutation request key and request SHA remain the mutation owner's
  exact replay/conflict authority. A matching request returns the committed
  result without executing another mutation Worker; contradictory reuse fails.
- `flarex.system/external-effect-execution-subject/v1` already admits a
  `durable_task_attempt` frame with scope, run, attempt, immutable task revision
  commitment, and fence.
- `flarex.system/external-effect-attempt/v1` and
  `fx_system_external_effect_attempt_v1` already admit `child_mutation`, exact
  request commitment, stable effect key, prepared/dispatching/confirmed/
  uncertain state, and confirmed outcome digest.
- `TaskWorkerSessionHost`, `TaskAttemptSupervisor`, and the current Task
  lifecycle remain the owners of session interruption, heartbeat, completion,
  retry, cancellation, and terminal settlement.

### Existing gaps that the implementation must close

- The external-effect persistence operations currently mint and validate only
  a direct-action subject and lock the direct-action parent. The Task branch is
  represented in the protocol/schema but has no Task-side capability or write
  adapter.
- Direct-action evidence allocates an ordinal from the action parent. A Task
  retry instead needs the Worker operation ordinal to reset deterministically
  and correlate with the same run-level mutation request identity.
- `ApplicationMutationSystem` now retains its anonymous foreground entry and
  also admits an opaque authenticated-identity capability prepared from one
  canonical user identity. The Task callback must receive that capability from
  launch composition; it may not silently downgrade to anonymous or accept a
  caller-selected identity per callback.
- The query-only Worker RPC has no mutation request/result envelope, durable
  request key, effect disposition, or drain contract.

## Authority And Identity

The Task mutation session is created only after Application launch authority
has reconstructed and validated:

- concrete `scopeId`;
- `runId`, `attemptId`, and `TaskExecutionFenceV1`;
- the exact `ApplicationTaskRunCreationAuthorityV1` and
  `ApplicationTaskRuntimeTargetV1`;
- `applicationTaskRuntimeTargetSha256`, which is the current Application
  generation's immutable executable task-revision commitment; and
- the owned authenticated-user `ExecutionIdentity` from Preflight 43.

The host mints an opaque Task external-effect subject capability from those
facts. User code, the Worker, and callback input cannot supply or change the
subject digest, scope, run, attempt, fence, runtime-target digest, principal,
stable key, or mutation request key.

The persistence owner derives the stable mutation request key itself from the
capability's current scope and run plus the admitted positive ordinal, using
the Slice 1 canonical preimage and SHA-256 projection. The prepare caller
supplies only the exact request commitment, function path, argument digest,
and ordinal. Its receipt returns the derived key for the mutation owner; an
adapter cannot substitute a second key for the same run ordinal.

Every prepare/dispatch/confirm/uncertain transition reacquires the located
scope authority and verifies that the same run, attempt, and execution fence
remain current. A stale host cannot create effect evidence or invoke a
mutation. No database transaction spans Worker RPC or mutation execution.

## Stable Mutation Identity

The first implementation admits one sequential mutation callback at a time.
The Worker emits a positive operation ordinal beginning at one for each
execution. First admission must be strictly increasing without gaps; an exact
transport/recovery replay of an already admitted ordinal reconciles its stored
request and outcome. A retry begins again at one.

For ordinal `N`, the host derives two different commitments:

1. **Stable mutation request key** — a bounded, domain-separated digest key
   derived from exact scope, run ID, operation kind `child_mutation`, and `N`.
   It intentionally excludes attempt ID and execution fence, so another attempt
   of the same run reuses the same Application mutation request key.
2. **Exact request identity** — a canonical commitment over the stable request
   key, runtime-target digest, function path, canonical argument digest, and
   launch-bound identity-access-policy digest.

This separation is required. If function path or arguments were included in
the request key, divergent retry code could produce another key and commit a
second mutation. With a run-and-ordinal key, the existing mutation authority
sees the same key with a different exact request and rejects it before another
commit.

Task code must therefore preserve mutation order and identity across retries.
Queries may observe newer data, but using that data to change the mutation at a
previously used ordinal produces a typed deterministic-replay conflict rather
than another write.

The compute dispatch identity's `requestedEffectSequence` is not this ordinal.
It identifies the already-persisted host dispatch instruction and remains
unchanged.

## Execution Sequence

For one accepted callback:

```text
Worker normalizes path + arguments and submits ordinal N
  -> host validates ABI, limits, sequence, session, and deadline
  -> host revalidates launch selection + authenticated principal
  -> Task external-effect authority prepares exact child-mutation evidence
  -> authority commits prepared evidence under attempt + fence + ordinal
  -> authority commits prepared -> dispatching
  -> host calls the existing ApplicationMutationSystem
       with stable request key + exact authenticated identity
  -> ApplicationMutationSystem publishes or exactly replays one commit
  -> host canonicalizes the returned value and commits its outcome digest
  -> Worker receives the bounded value
```

Within the same attempt, an exact duplicate callback request at the same
ordinal returns/reconciles the existing evidence; a contradictory duplicate
fails closed. Across attempts, a matching ordinal uses a new attempt evidence
row but the same Application mutation request key. The mutation owner therefore
returns the original committed outcome instead of re-executing the mutation.

The first implementation does not promise exactly-once arbitrary side effects.
It proves one Application mutation commit per exact Task mutation key because
the destination is the existing idempotent Application mutation authority.
Outbound HTTP and other destinations remain excluded until their own
idempotency/replay contract is approved.

## Lost Response, Failure, And Retry

- Failure before `dispatching` is committed closes the prepared effect as
  `failed_before_dispatch`; no mutation call is made.
- Once `dispatching` is committed, an absent, interrupted, timed-out, malformed,
  or otherwise unconfirmed response is recorded as `uncertain` for that
  attempt. It is never relabeled as proven pre-dispatch.
- A later Task attempt may call the same Application mutation request key.
  Published outcomes replay without another mutation Worker; in-progress or
  unresolved outcomes remain unconfirmed and cannot be reported as completed.
- A different function, arguments, runtime target, or principal at the same
  run ordinal is a deterministic replay conflict. It is not retried under a new
  key and does not fall back to anonymous execution.
- The callback result is returned only after its canonical value and outcome
  digest agree with the authoritative mutation outcome. External-effect
  evidence is diagnostic/recovery evidence; it does not replace the mutation
  outcome row.
- A Task attempt cannot report successful completion while one of its mutation
  callbacks remains prepared, dispatching, or uncertain without an exact
  replay resolution.

The first slice performs recovery only when user execution reaches the same
ordinal during a normal Task retry. It does not add an independent effect
redrive scheduler, checkpoint interpreter, or background mutation dispatcher.

## Cancellation And Resource Policy

- Maximum calls, argument bytes, result bytes, operation duration, settlement
  reserve, and close/drain duration are fixed host policy.
- Maximum concurrent mutation callbacks is one. Parallel mutation callbacks
  and race-dependent ordinal assignment are rejected.
- Session close prevents new callbacks and interrupts the owned in-flight host
  Effect.
- A prepared callback that never crossed the durable dispatch boundary is
  closed as `failed_before_dispatch`.
- A callback that may have reached `ApplicationMutationSystem` is confirmed by
  exact replay or remains `uncertain`; cancellation cannot erase it.
- Mutation callback close/drain settles before the supervisor submits Task
  completion or cancellation acknowledgement.
- A late RPC result is disposed and cannot mutate the closed session or produce
  a second completion.

## Package And Capability Placement

| Owner | Admitted responsibility |
| --- | --- |
| `flarex-protocol` | exact private mutation callback request/result wire contract and external-effect compatibility contracts |
| `@flarex/durable-task` | existing run/attempt/fence, retry, cancellation, and terminal lifecycle only |
| `@flarex/persistence-postgres` | Task-subject validation, stable key derivation, and external-effect transitions using the existing table; no mutation execution |
| `@flarex/standard-application-invocation` | identity-aware entry into the existing `ApplicationMutationSystem`; no Task lifecycle logic |
| `flarex-backend` | launch-bound mutation session, ordinal and exact-request input, consumption of the authority-derived key, RPC target, budgets, close/drain, and composition |
| `@flarex/system-test` | connected PGlite, genuine PostgreSQL, and genuine Worker proof only |

The task mutation capability is injected beside the query capability. Neither
is added to `TaskComputeProvider`, which remains the provider-neutral
dispatch/cancellation adapter. There is no common query/mutation/task provider
and no ambient Application service container inside the Worker.

## Required Implementation Slices

1. **Contract and pure identity — complete privately**
   - add the strict mutation callback ABI;
   - add domain-separated stable-key and exact-request commitment helpers;
   - prove canonical capture, byte bounds, hostile input rejection, and
     same-run/same-ordinal conflict behavior.
2. **Task external-effect authority — complete privately**
   - mint an opaque capability from current Task launch/attempt evidence;
   - adapt the existing external-effect transition mechanics to the Task
     parent without changing direct-action behavior;
   - derive the stable mutation request key inside the persistence authority;
   - reject stale scope, attempt, fence, runtime target, phase, or
     post-lock database-time lease before issuing a capability, preparing an
     effect, or declaring dispatch; lease equality is expired and a transaction
     that waited across expiry cannot reuse its transaction-start timestamp;
   - allow failed-before-dispatch, uncertain, and confirmation reconciliation
     after lease expiry only for the same still-current attempt and fence,
     because those operations record cleanup or an already-possible dispatch
     and cannot authorize a new child mutation;
   - reconcile exact duplicate prepare/dispatch/failure/uncertain/confirmation
     transitions and reject contradictory reuse; and
   - preserve rollback at every Task external-effect transition through the
     shared located transaction bridge.
3. **Identity-aware mutation invocation — complete privately**
   - extend the current mutation owner with an operation-specific authenticated
     identity input while retaining the existing anonymous foreground default;
   - reject anonymous identities and forged capabilities, preserve the exact
     launch-bound user token identifier through the backward-compatible
     verified-bearer grant field, and reject caller mutation after preparation;
   - expose only the owned identity-policy digest needed by the Task exact
     request commitment; and
   - preserve the same validation, OCC, journal, commit, and replay path.
4. **Worker/session composition — Slice 4A complete; Slice 4B blocked**
   - Slice 4A adds `ctx.runMutation` only to the Application Task Worker and
     carries a distinct mutation RPC target through the generated Worker
     definition, accepted session host, and supervised Worker Loader provider;
   - Slice 4A validates the complete callback request before consuming its
     Worker-local ordinal, enforces exact sequential ordinals, call/concurrency
     ceilings, the absolute Task deadline, cancellation interruption, and
     bounded callback close/drain. The Worker owns a pending-mutation boundary,
     rejects new calls after handler settlement begins, and drains every
     admitted call before emitting terminal settlement, so an unawaited
     `ctx.runMutation` cannot outlive Task completion. The host independently
     revokes and drains callback authority before exposing that settlement to
     the supervisor, advertises the larger Worker/callback close bound, and
     closes both owners even when either cleanup fails;
   - Slice 4B must supply the concrete Application-owned mutation authority
     through the already-carried exact dispatch request. The coordinator must
     own launch/request snapshots, issue the opaque current-attempt subject,
     derive and correlate the stable and exact request commitments, and invoke
     the existing authenticated Application mutation entry. The mutation owner
     must revalidate the same launch against its active selection before
     mutation work. Completion is blocked until the persistence owner supplies
     authoritative disposition reconciliation and a proven settlement bound as
     specified by Preflight 45; and
   - keep Legacy, outbound, scheduling, routes, and production activation
     unchanged.
5. **Connected proof — after Slice 4B**
   - prove publish, exact replay after lost response, contradictory ordinal,
     stale fence, principal propagation, cancellation, timeout, and cleanup in
     genuine Worker plus PGlite;
   - prove transaction/concurrency/lock behavior on genuine PostgreSQL.

Each slice remains private and production-inert.

## Current Blocking Owner Finding

The Slice 4B draft produced the following reproducible persistence-owner
finding:

- **Scenario:** a prepare, dispatch declaration, or confirmation transaction
  reaches PostgreSQL and the caller loses or cannot classify the settlement
  response while callback close concurrently aborts the admitted mutation.
- **Expected:** one persistence-owned reconciliation transaction reads the
  exact stored child-mutation row under lock, preserves exact request/outcome
  identity, settles `prepared` as failed-before-dispatch, settles
  `dispatching` as uncertain or exact-confirmed, accepts exact already-terminal
  replay, and finishes within an advertised database-owned deadline before the
  opaque subject is revoked.
- **Actual:** the available APIs expose separate phase-specific transitions.
  Caller-local phase guesses cannot distinguish a rolled-back declaration from
  a committed declaration whose response was lost. The shared located Effect
  transaction waits uninterruptibly for the driver promise and supplies no
  statement/lock/transaction settlement bound to the callback authority.
- **Affected owner:** Task external-effect persistence plus its located
  PostgreSQL transaction/deadline capability. This is not authority to change
  Application mutation OCC, commit, journals, Task lifecycle, or Worker session
  contracts.
- **Evidence:** the reproducible cases are interruption after prepare, definite
  declaration failure, post-dispatch interruption, and confirmation response
  loss; the missing proof is authoritative post-transaction state resolution
  and bounded genuine-PostgreSQL settlement.
- **Disposition:** blocked pending explicit approval of Preflight 45. Do not
  activate, merge a retry/fallback guess, or claim Slice 4B complete before that
  gate passes.

## Required Negative And Recovery Proof

The gate must include at least:

- malformed envelope, noncanonical value, oversized path/arguments/result,
  exhausted call budget, parallel calls, skipped/repeated ordinal, and hostile
  accessor/byte-view inputs;
- forged scope/run/attempt/fence/runtime target/principal and stale active
  selection rejected before mutation execution;
- exact same-attempt duplicate, concurrent duplicate, and later-attempt replay
  producing one Application commit;
- response loss after commit followed by a fresh-host/fresh-attempt replay that
  returns the original result without another mutation Worker execution;
- same run/ordinal with different function, arguments, runtime target, or
  identity rejected as contradictory reuse with no second commit;
- interruption before dispatch versus interruption after possible dispatch;
- cancellation and maximum-duration close/drain with no detached RPC or
  persistence transaction;
- rollback at every Task external-effect transition and safe connection reuse;
- Legacy Task, foreground Query/Mutation/Action, Task query callback, Task
  lifecycle vectors, Trigger boundary, Effect boundary, generated Worker, and
  source-map regressions unchanged.

## Explicit Exclusions

This preflight does not authorize:

- outbound HTTP, email, payment, webhook, or arbitrary external effects;
- nested Task creation, enqueue, delay, scheduling, waitpoints, or workflow
  checkpoints;
- a new mutation engine, OCC path, commit journal, result authority, Task
  lifecycle effect kind, or general-purpose effect table;
- public Task SDK stabilization, observability queries, live streams, logs,
  traces, dashboards, or Trigger.dev UI work;
- Queue, Cron, route, binding, Hyperdrive, deployment, or production
  activation;
- Trigger runtime dependencies, Prisma, Redis/Redlock, Trigger organization
  identity, or workspace/lockfile merging; or
- legacy removal, fallback, dual execution, or reinterpretation of stored
  compatibility evidence.

## Stop Boundary And Next Gate

Implementation stops when one private Application Task can execute sequential
`ctx.runMutation` calls through the existing Application mutation owner, recover
an exact committed result across attempt/host loss, reject contradictory replay,
and settle or preserve uncertainty without leaking authority.

Outbound effects and Task scheduling/enqueue require separate preflights after
this gate. Observability remains later and may only project the authoritative
Task, mutation, and external-effect state established here.
