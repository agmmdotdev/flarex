# DTE05-C3 Application Scheduling Parity Preflight

Status: DTE05-C3 complete privately.

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

## Implemented Boundary

The approved correction keeps one scheduling algorithm and adds only
generation-specific private adapters:

- `makeTaskSystemDueDiscoveryV1` retains the exact Legacy API while both
  persisted generations now use one database-time and paging kernel;
- `makeApplicationRunAttemptLifecycleV1` binds the existing shared Application
  decisions to the existing Application transaction store;
- `makeApplicationRunAttemptDueCandidateHandlerV1` projects Application
  receipts through the existing due-candidate handler semantics; and
- `makeApplicationTaskSystemWakeSchedulerPartitionV1` composes those adapters
  without a host trigger, wake publisher, fallback, or production route.

Validation evidence on 2026-08-22:

- the DTE05-C3 PGlite lane passed all three tests across the new Application
  parity scenario and unchanged Legacy scheduler regression;
- the genuine PostgreSQL 18 lane passed all four environment, Application,
  and Legacy tests against isolated temporary schemas;
- the shared Application scenario proved no write before database-time lease
  expiry, exactly one accepted concurrent expiry recovery, persisted retry
  delay, fresh scheduler reconstruction and second grant, pre-write
  first-failure short-circuiting, late attempt-identity conflict rollback after
  the aggregate update, and stale-scope rejection;
- all 110 durable-task tests passed, including the unchanged scheduler kernel
  and Legacy wake-publication behavior; and
- `pnpm lint:core` and `pnpm lint:diff` passed. The durable-task TypeScript
  project also passed with an ES2023 library override for the current shared
  `toSorted` baseline.
  The wider persistence TypeScript project remains independently blocked in
  `apps/analyzer` by its pre-existing undeclared
  `@flarex/standard-application-definition/v1` import; the compiler reached no
  DTE05-C3 diagnostic.
- both mandatory exact-final reviewers reported no findings. The systems
  review specifically confirmed that the late attempt-identity conflict occurs
  after the aggregate update and proves full transaction rollback with bounded
  retry; the TypeScript review found no contract or Effect correction.

## Stop Boundary

DTE05-C3 remains one implementation-bearing capability and one commit.
DTE06-F2 fresh-host recovery and takeover is complete privately. The docs-only
runtime-kernel/provider-placement decision in
[`Preflight 47`](./47-dte06-runtime-kernels-and-provider-placement.md) and the
private, unwired provider router in
[`Preflight 48`](./48-dte06-task-compute-provider-router.md) are complete.
Standard Task APIs, DTE05-E3, DTE06-F3/F4, public APIs, observability, and
production activation remain closed.
