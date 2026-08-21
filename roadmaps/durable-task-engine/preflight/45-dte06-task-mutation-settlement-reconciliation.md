# Preflight 45: Durable Task Mutation Settlement Reconciliation

## Status And Decision

**Status:** Approved and in progress privately. The persistence owner now has
one exact terminal reconciliation operation plus a deadline-owned PostgreSQL
target/resource. The Application-owned coordinator consumes that operation
instead of process-local phase guesses and construction-checks the advertised
settlement budget against callback close. Completion remains gated on the
genuine PostgreSQL deadline/cleanup acceptance lane and the final validation
matrix. The focused connected genuine Worker proof now commits a real
`ctx.runMutation(...)` through `ApplicationMutationSystem` and observes exact
confirmed external-effect evidence. This approval does not authorize production
activation, routes, Queue/Cron wiring, new mutation/OCC logic, or a change to
Task lifecycle contracts.

### Connected Proof Finding: Pre-Heartbeat External Effect Admission

- **Reproducible scenario:** the connected genuine Application Task Worker is
  accepted and calls `ctx.runMutation(...)` before heartbeat sequence `1`
  commits. The durable run is still in its valid `attempt_granted` phase.
- **Expected behavior:** as established by Preflight 41, a Worker may execute
  and even settle before the first heartbeat wins the race. Its exact
  attempt/fence/lease-bound child mutation must therefore be admitted or
  rejected by a separately approved stronger start barrier.
- **Actual behavior:** Task external-effect subject issuance accepts
  `attempt_granted`, but `prepareTaskChildMutationEffect` immediately rechecks
  the same current parent and requires `executing`. The genuine Worker receives
  `TaskExternalEffectAuthorityStaleError { reason: "phase" }`, which projects to
  callback `staleLaunch` and fails the Task.
- **Affected owner:** `@flarex/persistence-postgres` Task external-effect parent
  phase admission, at the boundary between accepted Worker execution and the
  first supervisor heartbeat. The system-test harness is diagnostic evidence
  only.
- **Evidence:** the focused connected `mutation_callback` scenario reaches the
  real callback and fails at external-effect `prepare`; no mutation Worker is
  invoked and no effect row is created. Preflight 41 already documents that
  terminal observation may win while the run remains `attempt_granted`.
- **Disposition:** separately approved and corrected in the smallest bounded
  owner slice. Live-lease Task external-effect prepare/dispatch operations now
  admit `attempt_granted` while retaining exact current attempt, fence, runtime
  target, database lease, subject, and sequence checks. Exact current-attempt
  confirmation and reconciliation also admit `attempt_granted` for terminal
  settlement without granting a new dispatch. The focused persistence matrix
  proves pre-heartbeat admission and settlement plus stale/forged/revoked
  rejection, and the connected genuine Worker mutation scenario passes.

The first connected rerun also exposed a harness-local composition defect: the
fixture supplied a placeholder runtime-host string to a real point-mutation
runner that correctly requires the backend-owned exact runtime-host identity.
The harness now reuses `APPLICATION_RUNTIME_HOST_IDENTITY`; no runtime owner or
mutation execution contract was weakened.

### Resolved Review Finding: Pre-Heartbeat Mutation Settlement

- **Reproducible scenario:** a valid current Application Task attempt remains
  `attempt_granted`; prepare and dispatch declaration succeed; the child
  mutation commits before heartbeat sequence `1`; confirmation is attempted
  immediately and reconciliation follows that failure.
- **Expected behavior:** the already-committed result must be confirmable by the
  exact current attempt/fence subject, or reconciliation must recover that same
  confirmed disposition, even when the Worker wins the documented
  pre-heartbeat race.
- **Behavior before correction:** confirmation and reconciliation both used the
  settlement parent check, which required `executing`. The deterministic
  persistence regression proved confirmation failed with stale reason `phase`;
  reconciliation had the same parent requirement. The effect could remain
  `dispatching` after the mutation itself committed.
- **Affected owner:** `@flarex/persistence-postgres` Task external-effect
  settlement-phase admission. This is not authority to change Task lifecycle,
  heartbeat scheduling, or Worker start ordering.
- **Evidence that exposed the race:** the connected real mutation passed because
  its full mutation execution was slow enough for heartbeat `1` to commit first,
  while the direct pre-heartbeat regression proved a faster committed mutation
  was timing-dependent.
- **Disposition:** separately approved and corrected. `attempt_granted` is now
  admitted only for exact current-attempt/fence confirmation and reconciliation,
  without granting a new dispatch or relaxing subject, runtime-target, sequence,
  request, outcome, or authority checks. Deterministic pre-heartbeat confirmation
  and reconciliation recovery proofs cover the fast-mutation race.

The accepted direction is one persistence-owned reconciliation capability for
Task child mutations. It resolves stored state, exact identity, and database
settlement under the same located authority rather than asking the host
coordinator to infer PostgreSQL state from its last process-local line of code.

## Problem

The current Task external-effect API exposes separate operations for prepare,
dispatch declaration, failed-before-dispatch, uncertain, and confirmation.
Those operations are correct when the caller knows which transition settled.
They are insufficient after commit-response uncertainty:

1. prepare may have committed although the caller received no projection;
2. declaration may have rolled back, leaving `prepared`, or committed, leaving
   `dispatching`;
3. confirmation may have committed although the caller received a failure;
4. a callback close must not revoke the opaque subject until this ambiguity is
   resolved; and
5. the current located Effect bridge waits uninterruptibly for the driver
   transaction promise, so an outer timeout does not prove that the query,
   transaction, rollback, release, or connection has settled.

Trying `failBeforeDispatch` and then `markUncertain`, or the reverse, is not an
authoritative probe. It can produce lifecycle conflicts, obscure the owning
failure, and still leave nonterminal evidence.

## Required Persistence Capability

Add one narrow Task-child-mutation reconciliation operation owned beside the
existing external-effect transitions. Its input must carry the already-issued
opaque subject, effect ordinal, stable request key, exact request identity,
function path, arguments digest, and optional canonical outcome digest. It must
not accept arbitrary scope/run/attempt/fence authority from the caller.

Inside one located transaction it must lock and decode the exact effect row and
produce one of these decisions:

- `missing`: no dispatch became possible; do not create or dispatch work during
  cleanup;
- `prepared`: settle failed-before-dispatch with the exact terminal code;
- `dispatching` without a trusted outcome: settle uncertain;
- `dispatching` with the exact trusted outcome: confirm that digest;
- `confirmed`: accept only exact outcome replay and reject a contradictory
  digest;
- `failed_before_dispatch` or `uncertain`: accept only the exact compatible
  cleanup replay; and
- any request/stable-key/function/arguments/subject mismatch: fail closed as a
  typed conflict without changing the row.

The returned projection must be owned and must prove its terminal state. A
host coordinator may return a mutation result only after exact `confirmed`
evidence agrees with the canonical result digest.

## Required Deadline And Settlement Contract

The reconciliation owner and every transition used by the callback close path
must have a real database-owned deadline/disposition contract:

- PostgreSQL statement and lock deadlines apply inside the transaction;
- BEGIN, callback work, COMMIT/rollback, release, and unsafe-connection
  quarantine have an explicit maximum settlement budget;
- the exported capability advertises that validated budget to the callback
  composition;
- the callback close bound is construction-checked against that budget and the
  Worker/supervisor lease reserve; and
- Effect interruption preserves the full Cause but never pretends an outer
  timeout cancelled an uninterruptible driver promise.

PGlite may prove state-machine behavior but cannot prove the genuine PostgreSQL
deadline, lock, rollback, release, or connection-reuse claims.

## Required Proof

The approval gate must include:

1. complete PGlite state/identity matrix for `missing`, `prepared`,
   `dispatching`, `confirmed`, `failed_before_dispatch`, and `uncertain`;
2. definite pre-update declaration rejection leaves no nonterminal evidence;
3. response loss after committed prepare resolves to failed-before-dispatch;
4. response loss after committed declaration resolves to uncertain or exact
   confirmation according to available outcome evidence;
5. response loss after committed confirmation returns exact confirmed replay;
6. contradictory stable key, request identity, function, arguments, outcome,
   subject, attempt, or fence never changes the row;
7. callback close waits for reconciliation and revokes the subject exactly
   once afterward;
8. genuine PostgreSQL lock/query timeout proves rollback and pool reuse with no
   outstanding operation or waiter; and
9. the connected genuine Worker proof then exercises cancellation, maximum
   duration, lost response, fresh-attempt replay, and cleanup through the real
   `ApplicationMutationSystem` layer.

## Non-Goals

- no new Application mutation, OCC, commit, journal, or idempotency path;
- no new Task lifecycle effect kind or provider contract;
- no polling fallback, dual write, or phase guessing in the host;
- no Trigger.dev runtime, Prisma, Redis/Redlock, or organization identity; and
- no observability UI/API work before the durable core gate completes.

## Current Validation Evidence

- the PGlite reconciliation/state/identity matrix passes all nine cases;
- the Application mutation coordinator and task-launch identity suites pass all
  fifteen cases;
- the isolated connected PGlite lane passes all thirteen genuine Worker and
  supervision scenarios, including a real `ctx.runMutation(...)` commit and
  exact confirmed external-effect evidence;
- the Trigger compatibility boundary tests pass all sixty-six cases, and its
  live scan has no finding in this slice (the unrelated existing
  `physicalDefinitionRetirementPins.ts` finding remains outside this owner);
- `@flarex/standard-application-invocation` typechecks; persistence and
  system-test package typechecks reach the unrelated existing Analyzer import
  failure for `@flarex/standard-application-definition/v1`; and
- genuine PostgreSQL acceptance is still open: the dedicated persistence tests
  skip and the connected acceptance harness fails closed when
  `FLAREX_POSTGRES_DATABASE_URL` is absent. No PostgreSQL deadline, rollback,
  release, or pool-reuse claim is accepted from the PGlite receipts.
