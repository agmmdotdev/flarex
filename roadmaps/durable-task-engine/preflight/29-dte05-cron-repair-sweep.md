# Preflight 29: DTE05 Cron Repair Sweep

## Status

**Decision:** Admit DTE05-E1 only. The admitted slice is a private,
host-neutral, operation-local repair sweep plus a repair-tolerant view of the
trusted scheduler directory. It remains unwired and production-inert.

**E1 implementation status:** Complete on 2026-08-09. DTE05-E remains active
because E2 and E3 are still pending.

This preflight does **not** admit a persisted scheduler claim/checkpoint, a
Worker `scheduled()` handler, a Wrangler Cron Trigger, deployment, or
production activation. Those remain DTE05-E2 and DTE05-E3 work.

## Why This Slice Exists

DTE05-D Queue messages are deliberately non-authoritative wake hints. A lost
publication, exhausted Queue delivery, or delayed notification must therefore
be repaired from the authoritative Postgres due indexes. The repair operation
must also remain fair across tenants: one stale or unavailable scope near the
front of the directory cannot prevent every later scope from being visited.

The accepted DTE05-C2 directory is intentionally fail-fast. It resolves every
candidate before returning a page, so a candidate-local authority failure
loses the page continuation. That contract remains correct for trusted
callers, but it is not a safe fairness boundary for a recurring repair host.
DTE05-E1 therefore adds a separate repair view rather than weakening C2.

## Current Cloudflare Host Evidence

Cloudflare invokes Cron Triggers through a Worker's `scheduled()` handler and
awaits the returned promise; `ctx.waitUntil()` is available when a handler must
register additional work. Cron expressions run in UTC. Current platform limits
also distinguish wall duration from CPU time and give scheduled invocations a
maximum wall duration of 15 minutes. The eventual host configuration must pin
a conservative budget for its actual plan and cron interval rather than treat
the platform maximum as domain policy.

Primary references:

- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

`apps/executor/src/scheduledLifecycle.ts` already owns the Hyperdrive client
lifecycle and the one scheduled-event Effect-to-Promise bridge for the existing
point-mutation scheduler. DTE05-E3 must reuse or honestly generalize that host
owner. E1 must not add a second runtime bridge.

## Admitted E1 Contract

### Repair directory

`@flarex/persistence-postgres/internal/task-wake-scheduler-repair-directory-v1`
reuses replacement-scope high-water pagination and fresh trusted authority
resolution.

- input, SQL, detached-row, ordering, and corruption failures still fail the
  page because there is no safe cursor to advance;
- authority unavailability, candidate/current-scope mismatch, and invalid
  per-partition scheduler configuration become inert candidate outcomes;
- a failed candidate retains the page continuation so later scopes remain
  reachable;
- a ready item contains a freshly built non-publishing C1 scheduler and its
  exact per-run count ceilings; and
- neither outcome exposes a physical locator, database target, transaction,
  authority record, or error cause.

This does not make a directory hint authoritative. Every resume repeats
directory discovery and current authority resolution.

### Host-neutral repair sweep

`@flarex/executor/internal/task-repair-sweep-v1` owns one bounded cycle.

- it processes `start_attempt` before `handle_lease_expiry` for each scope;
- it runs the existing Task scheduler and lifecycle logic rather than cloning
  transitions in the host;
- it admits each scheduler call against worst-case per-run page and candidate
  ceilings before starting it;
- it enforces directory-page, scheduler-call, task-page, and candidate limits,
  plus cooperative wall/per-operation admission and a host-return reserve;
- a typed candidate or scheduler failure is counted and the sweep advances to
  the next directory candidate;
- page-level directory failures remain typed failures of the whole operation;
- defects and interruption remain in `Cause`; and
- the receipt exposes aggregate counts and a private continuation, not tenant
  identities or failure causes as operational fields.

The E1 continuation is an operation-local TypeScript value, not a storage or
wire codec. It records the directory position before the current candidate,
the expected deployment/scope correlation, due kind, and inner scheduler
cursor. On resume, a changed or deleted candidate discards the inner cursor;
the cursor never selects authority.

## Recovery And Fairness Semantics

The repair scheduler is deliberately non-publishing. A transition may persist
a later retry or lease-expiry due time without publishing a new Queue hint;
the same recurring Postgres repair path will rediscover it. Queue remains the
low-latency accelerator, while Postgres remains the recovery authority.

E1 returns a continuation but does not yet persist it. Therefore E1 proves
operation-local boundedness and restart-safe re-execution, not fair durable
progress across an unbounded directory. Replaying from the beginning is safe
through lifecycle idempotency, but could starve later scopes under a permanent
early budget. Production activation is prohibited until E2 adds a Task-owned
claim/checkpoint with a codec and real-Postgres restart/concurrency proof.

The Effect timeout bounds interruptible host work, but it is not a hard
database deadline. Existing due-read and lifecycle transactions contain
uninterruptible settlement regions, so a stalled driver operation may outlive
the requested operation timeout. E1 therefore does not claim a hard wall-time
bound. Before E3 activation, E2 must add or prove database-owned statement,
lock, and transaction timeout policy while preserving uncertain-transaction
semantics, including a deliberately stalled-transaction test.

## Remaining Stages

### DTE05-E2: Durable repair checkpoint

- E2A is admitted separately by
  [`30-dte05-durable-repair-checkpoint.md`](./30-dte05-durable-repair-checkpoint.md):
  canonical continuation evidence plus the inert Task-owned scheduler row;
- define and version the continuation codec;
- add a Task-owned scheduler claim, lease, renew/checkpoint/release protocol;
- preserve confirmed-rollback versus uncertain-failure semantics;
- establish database-owned statement, lock, and transaction timeout behavior
  and prove the host reserve against a stalled transaction;
- prove duplicate hosts, claim expiry, crash between transition and
  checkpoint, restart, and high-water fairness in genuine PostgreSQL; and
- keep the point-mutation checkpoint as evidence, not as Task authority.

E2B retains the transaction protocol and E2C retains genuine-Postgres
concurrency, recovery, fairness, and hard database-timeout proof. E2A alone
does not satisfy this stage.

### DTE05-E3: Cloudflare scheduled host and activation gate

- reuse/generalize the existing scheduled-event lifecycle owner;
- select a conservative plan- and interval-specific CPU/wall budget;
- add the Worker `scheduled()` export and Wrangler Cron Trigger only after its
  exact deployment preflight;
- prove installed Worker types and a local Cloudflare scheduled-event test;
- emit only non-disclosing aggregate operational receipts; and
- remain disabled until Roadmap 06 can deliver an admitted attempt to compute.

Starting attempts before compute delivery exists could strand leased work, so
Roadmap 06 is a correctness prerequisite, not merely a rollout preference.

## E1 Validation Gate

E1 must prove:

- PGlite continuation past a candidate-local authority mismatch;
- start-attempt then lease-expiry ordering;
- fresh directory resolution before every inner-cursor resume;
- count-budget continuation, conservative unknown-progress charging, and exact
  resume;
- valid empty/filtered directory-page advancement;
- explicit failure when a partition can never fit the host budget;
- failed-candidate and typed-scheduler-failure isolation;
- defect preservation;
- invalid-policy short circuit before any database work;
- package typechecks and Trigger boundary checks; and
- no import from an app, Worker entrypoint, or deployment configuration.

No new SQL or migration is admitted in E1. Genuine-Postgres checkpoint and
concurrency proof belongs to E2; the already accepted C1/C2 real-Postgres lanes
remain regression evidence for the reused queries and lifecycle operations.

Completion evidence:

- the final executor typecheck and all 14 focused repair-sweep tests passed;
- the focused persistence source/test typecheck and all five repair-directory
  PGlite tests passed;
- the C1 and C2 PGlite regressions passed all 2 and 13 tests respectively;
- the full executor regression passed 358 active tests with five existing
  skips before the final receipt-validation-only correction, and the focused
  final lane passed afterward;
- the 65-vector lifecycle gate, 29-entry source-map gate, Trigger boundary,
  Standard Application boundary, and all 59 script tests passed;
- both required project reviewers accepted the final staged diff with no
  remaining findings; and
- no production app, Worker entrypoint, Wrangler file, SQL migration, or
  runtime bridge imports or activates E1.

## Stop Boundary

DTE05-E1 does not authorize:

- changing DTE05-C2's fail-fast contract;
- a caller-selected tenant, scope, locator, or database target;
- Queue payload authority or a Queue-only recovery claim;
- a new run transition, retry policy, requested-effect owner, or lifecycle
  implementation;
- importing or casting the point-mutation scheduler checkpoint as Task state;
- persisting the operation-local continuation without an admitted codec and
  transaction protocol;
- a second scheduled-event runtime bridge;
- a claim that Effect interruption alone hard-bounds a database transaction;
- a Worker scheduled handler, Wrangler cron configuration, deployment, or
  production scheduling; or
- marking DTE05-E complete before E2 and E3 close their gates.
