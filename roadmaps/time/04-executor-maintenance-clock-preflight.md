# Executor Session Maintenance Clock Preflight

Status: ECLK01-C complete.

## Scope

This package-only gate covers `@flarex/executor` session-maintenance cutoff
time and the maintenance sweep that composes it. It makes deployment listing,
one-deployment maintenance, and the sequential sweep Effect-native internally
while retaining the public Promise facade.

It does not change `apps`, executor HTTP or Nitro adapters, persistence
implementations, PostgreSQL clocks, session-state rules, stale-session query
semantics, deployment pagination, outbox delivery, live-query leases or
deliveries, or the public executor types.

## Existing Authority And Order

The maintenance cutoff is application time. It is distinct from the later
session-abort finish observation, which remains owned by the Effect-native
session capability from ECLK01-B1. PostgreSQL continues to own database
ordering and transaction semantics.

For one deployment, the current order is:

1. validate `staleAfterMs`;
2. validate the session limit;
3. read the cutoff clock once;
4. invoke `Date.prototype.getTime` through the returned configured value;
5. derive a fresh `olderThan` Date;
6. validate deployment existence and project ownership;
7. read the session finish clock separately; and
8. abort the bounded stale-session batch.

A sweep lists deployments before any clock observation, then processes the
page sequentially. Each deployment performs its own cutoff and finish reads.
The sweep stops at the first failure and does not return partial results.

## Compatibility Contract

- Invalid policy input performs no clock or persistence work after the failing
  validation point.
- A configured executor `Clock` retains exact `clock.now()` dispatch count and
  ordering. Its thrown cause remains the public Promise rejection by identity.
- The cutoff Date retains one configured `getTime()` dispatch. A thrown cause
  remains the public rejection by identity.
- The configured Date returned for the later abort finish observation is passed
  to persistence by identity through the session capability.
- The cutoff Date is a fresh value derived from the observed milliseconds;
  invalid configured Dates and the existing numeric arithmetic remain
  compatible rather than gaining a new validation rule.
- Deployment listing failures occur before clock acquisition and preserve the
  original public rejection by identity.
- The public Promise inputs, results, ordering, pagination, and error classes do
  not change.

## Effect Design

`maintenance.ts` owns named Effect operations for deployment listing,
one-deployment maintenance, and a sequential sweep. The one-deployment
operation receives the same lazy per-executor time Effect used by the session
capability. Native executors therefore use Effect Clock; configured executors
retain the compatibility adapter established in ECLK01-B1.

The sweep composes the Effect operations directly and has no nested runner.
One Promise runner remains at each public executor entrypoint. Foreign listing
rejections enter one maintenance-owned tagged failure and are unwrapped only at
that public compatibility boundary. Known maintenance and session failures
remain typed and identity-preserved.

The maintenance operations stay explicit, lifecycle-free values. They reuse
the already justified per-executor session capability and do not introduce a
singleton Context service or Layer.

## Completion Gate

Completion requires:

- configured-clock characterization for validation order, read count,
  `getTime` dispatch, and rejection identity;
- Effect `TestClock` coverage proving separate cutoff and finish observations;
- Effect `TestClock` coverage proving a fresh cutoff for every sequential sweep
  deployment;
- focused maintenance and session tests;
- the full executor suite, executor typecheck, core lint, changed-lines lint,
  and exact staged-diff lint; and
- both required final reviewers with no unresolved findings.

Real PostgreSQL is required only if this gate changes database clock,
transaction, lock, expiry, or isolation semantics. This gate must not make
those changes.

## Implemented Result

`maintenance.ts` owns the three named Effect operations and one Promise
compatibility runner. The executor composition root creates one lazy
maintenance time Effect per executor instance, runs each public maintenance
entrypoint once, and leaves configured-clock failures and foreign deployment
listing failures unchanged at the Promise boundary.

The sweep now composes deployment listing and per-deployment maintenance in one
Effect flow. It retains sequential execution, fresh per-deployment cutoffs,
separate abort-finish observations, first-failure behavior, and existing result
allocation and ordering. Effect `TestClock` covers the native observation
contract; Promise tests retain configured-clock dispatch and identity evidence.
