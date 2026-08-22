# DTE05-C3 Application Scheduling Parity Preflight

Status: blocker recorded; implementation requires separate approval.

Evidence snapshot: 2026-08-22 current repository state after DTE06-F1.

## Why This Gate Exists

DTE06-F2 requires a fresh host to recover an `application_v1` task attempt only
through persisted due state and database time. The lifecycle and persistence
owners can represent that transition, but the connected scheduling path cannot
currently reach it.

Reproduction:

1. create an Application task run through `ApplicationTaskSystem`;
2. grant its first attempt and let the hosted Worker disappear while the
   persisted attempt remains live;
3. reconstruct a scheduler from the trusted located scope; and
4. ask it first for `handle_lease_expiry`, then for the retry's
   `start_attempt` candidate.

Expected behavior: before database-time expiry the scheduler discovers no due
candidate; after expiry it advances the exact attempt to retry waiting, and
after the persisted retry delay it grants a new attempt and execution fence.

Actual behavior: `taskSystemRunReadV1.ts` filters due discovery to
`definition_generation = 'legacy_definition_v1'` and rejects any differently
decoded row. `taskSystemWakeSchedulerPartitionV1.ts` composes only
`makeTaskSystemRunAttemptStoreV1` and `makeRunAttemptLifecycleV1`. The existing
Application store and Application lifecycle decisions therefore cannot be
reached by the scheduler. A fresh host can prove that it does not replay live
work, but it cannot produce the required post-expiry Application transition.

## Ownership And Disposition

This is a shared DTE05/DTE04 scheduling-persistence gap, not a system-test
harness defect. DTE06-F2 must remain blocked until a separately approved
production-inert correction closes it. The harness must not:

- call Application lifecycle decisions directly as a synthetic scheduler;
- rewrite the row generation to Legacy;
- add a host-local retry, lease, fence, or completion owner;
- duplicate due SQL or database-clock policy in `@flarex/system-test`; or
- introduce a second scheduler/state machine, fallback, dual path, Queue/Cron
  host, route, binding, or production activation.

## Bounded Correction Candidate

The smallest coherent correction is DTE05-C3:

1. preserve the existing generation-neutral scheduler algorithm and due
   candidate contract;
2. factor the persistence due-read mechanics behind exact generation-specific
   decoding/projection adapters, retaining the existing Legacy API and SQL
   behavior;
3. add a private Application due-discovery composition using
   `makeApplicationTaskSystemRunAttemptStoreV1` and the already implemented
   Application start/lease-expiry decisions;
4. keep trusted scope resolution, database time, transaction ownership,
   retry/fence allocation, requested effects, and lifecycle authority with
   their current owners; and
5. prove Legacy non-regression plus Application PGlite and genuine PostgreSQL
   no-write-before-expiry, post-expiry recovery, retry grant, concurrency,
   stale authority, rollback, and exact first-failure behavior.

The implementation preflight must inspect the shared lifecycle adapter types
before choosing whether the Application adapter is a dedicated private facade
or a generation-parameterized internal kernel. Either shape must expose one
scheduler semantics owner and must not weaken the compile-time distinction
between Legacy and Application persisted aggregates.

## Stop Boundary

This record authorizes no code change. After explicit approval, DTE05-C3 is one
implementation-bearing capability and one commit. DTE06-F2 resumes only after
that commit passes both mandatory reviewers and its PGlite/genuine-PostgreSQL
matrix. Standard Task APIs, DTE05-E3, DTE06-F3/F4, public APIs, observability,
and production activation remain closed.
