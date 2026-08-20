# Preflight 45: Durable Task Mutation Settlement Reconciliation

## Status And Decision

**Status:** Proposed. Approval is required before implementation. This document
records the persistence-owner blocker discovered by the private Slice 4B Task
mutation coordinator draft. It does not authorize production activation,
routes, Queue/Cron wiring, new mutation/OCC logic, or a change to Task lifecycle
contracts.

The proposed direction is one persistence-owned reconciliation capability for
Task child mutations. It must resolve stored state, exact identity, and
database settlement under the same located authority rather than asking the
host coordinator to infer PostgreSQL state from its last process-local line of
code.

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
