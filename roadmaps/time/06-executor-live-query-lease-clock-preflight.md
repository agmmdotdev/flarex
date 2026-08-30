# Executor Live-Query Lease Clock Preflight

Status: ECLK01-E complete.

## Scope

This package-only gate covers `@flarex/executor` live-query connection and
subscription timing: connection touch and close observations, subscription
lease creation, expired-connection cleanup cutoffs, active-subscription stale
scan cutoffs, and the stale-rerun orchestration that owns that scan.

It does not change `apps`, executor HTTP or Nitro adapters, persistence
implementations, database schemas, live-query delivery claim or acknowledgement
timing, delivery identifier policy, freshness semantics, public executor types,
or PostgreSQL transaction-time authority.

## Authority And Existing Order

The executor clock supplies application observations passed to persistence.
PostgreSQL continues to own transaction time, lock order, committed evidence,
and the authoritative comparison of stored connection expiry values. This gate
does not move an expiry decision out of persistence or introduce a second
clock inside a transaction.

The existing operation order is:

- touch: assert deployment/project authority, read an explicit `now` or the
  executor clock, read and validate the lease duration, derive `expiresAt`
  from the same Date, then upsert the connection;
- record subscription: assert authority, select explicit `updatedAt` or one
  clock observation, derive the connection lease, project read-set and result
  evidence, then upsert the subscription and connection together;
- remove a connection: assert authority, capture the connection key, read one
  close observation, close the connection, then delete its subscriptions;
- remove expired subscriptions: assert authority, capture the deployment ID,
  select explicit `expiredAt` or one clock observation, then call persistence;
- list expired deployments: validate the limit before reading the explicit
  cutoff or clock, then call persistence;
- find stale subscriptions: capture the deployment ID, select explicit
  `activeAt` or one clock observation, list active subscriptions, then check
  and classify freshness sequentially; and
- rerun stale subscriptions: validate the rerun limit, perform that stale scan,
  rerun selected subscriptions sequentially, optionally deliver changes, then
  project the result.

Every failure stops later work. Authority failures suppress clock and write
operations. Invalid scan and rerun limits suppress the clock and persistence.
The historical touch contract reads time before rejecting an invalid lease
duration, and this gate retains that order.

## Compatibility Contract

- `FlarexExecutorConfig.clock` remains the public compatibility clock.
- Each configured `clock.now()` call retains its placement, count, returned
  Date identity, and thrown-cause identity.
- Persistence method lookup retains its original position before inline input
  and clock evaluation, including the original receiver on invocation.
- Explicit `now`, `updatedAt`, `expiredAt`, and `activeAt` values suppress the
  corresponding clock read and pass through by identity.
- `lastSeenAt` uses the selected Date by identity; `expiresAt` remains a newly
  allocated Date derived from that one observation and the existing duration.
- Authority, validation, freshness, delivery, and persistence failures retain
  their public Promise rejection behavior and first-failure order.
- `DeploymentProjectMismatchError` remains directly distinguishable in the
  internal Effect error channel; only unknown authority failures use the
  foreign-operation wrapper.
- Stale reruns reuse the same Effect-native stale-scan operation rather than a
  second clock path or nested runtime.

## Effect Design

`liveQueries.ts` owns named Effect operations for the seven time-connected
public flows. Narrow adapters map throwing synchronous work and Promise
rejections once to an internal tagged foreign failure. The public executor
boundary unwraps configured-clock and foreign causes, preserving the existing
Promise facade and rejection identity.

The package-local `makeExecutorTimeEffect` remains the shared clock mechanic.
The live-query owner supplies its own configured-clock error and boundary
projection. The executor composition root creates one lazy time Effect per
executor instance. This lifecycle-free multi-instance capability must not
become a singleton Context service or Layer.

The separately owned `rerunLiveQuerySubscription` Promise operation remains a
bounded adapter inside the stale-rerun Effect. Migrating its result/delivery
domain is not necessary to remove the lease-family clock path and would expand
this gate beyond temporal ownership.

## Completion Gate

Completion requires:

- Effect `TestClock` coverage for native connection lease and close times;
- coverage proving every explicit lease or cutoff timestamp suppresses time;
- configured-clock and explicit-Date identity coverage;
- authority, validation, clock, persistence, and sequential failure-order
  coverage;
- focused live-query tests, the full executor suite, executor typecheck, core
  lint, changed-lines lint, and exact staged-diff lint; and
- both required final reviewers with no unresolved findings.

Real PostgreSQL is required only if this gate changes database clock,
transaction, locking, expiry-comparison, ordering, or isolation semantics. It
must not make those changes.

## Implemented Result

`liveQueries.ts` now owns the named Effect operations, typed configured-clock
and foreign failures, shared lease derivation, and Promise compatibility
runner for this family. The executor composition root creates one lazy
live-query time Effect per executor and runs each public time-connected
entrypoint exactly once.

Native lease and close observations are `TestClock`-controlled. Explicit
lease/cutoff timestamps suppress time reads and retain Date identity.
Authority and invalid-limit branches do no temporal or persistence work;
configured-clock and persistence failures retain public cause identity; the
historical time-before-invalid-duration ordering and key-before-clock ordering
remain pinned. Persistence-method-before-clock failure precedence and the typed
project-mismatch channel are pinned as well.

Focused live-query/session validation passed 100 tests. The full serial executor
suite passed 451 tests with 6 skipped, alongside executor typecheck, core lint,
and changed-lines lint. `FLAREX_POSTGRES_DATABASE_URL` was not configured; the
real-PostgreSQL lane was not required because no database time, transaction,
lock, expiry-comparison, ordering, or isolation behavior changed.
