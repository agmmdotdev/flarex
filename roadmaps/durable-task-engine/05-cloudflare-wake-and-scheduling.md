# Roadmap 05: Cloudflare Wake And Scheduling

## Status

**Status:** Active. DTE05-A admits the host-neutral scheduling boundary and
pins the first Trigger scheduling sources. DTE05-B completes the first
implementation checkpoint: one scope-bound, production-inert scheduler core,
its narrow ports, and deterministic in-memory adapters. DTE05-C1 completes
one already-resolved trusted-scope Postgres composition, and DTE05-C2 completes
the production-inert trusted partition directory. No
Cloudflare binding, cross-scope scheduler host, deployment configuration, or
production activation is authorized.

Roadmap 04 remains the durable-state authority. Its due-discovery candidates
and lifecycle transactions are sufficient to reconstruct missed work. Queue
messages, alarms, cron events, and process-local notifications are wake hints;
they never prove that a transition or external effect occurred.

## Outcome

Deliver a reusable Flarex scheduling domain that:

1. reads bounded due candidates from an adapter-neutral source;
2. handles candidates sequentially through the admitted lifecycle authority;
3. returns an exact bounded receipt and continuation;
4. behaves safely under duplicate, stale, reordered, and missed wake hints;
5. supports deterministic in-memory tests without reimplementing lifecycle
   logic;
6. accepts Postgres, Cloudflare Queue, cron, and optional Durable Object alarm
   adapters through narrow composition boundaries; and
7. remains fail-closed and production-inert until compute delivery is admitted
   by Roadmap 06.

This roadmap does not port Trigger's Redis queue. It adapts Trigger's durable
revalidation and stale-delivery behavior to Flarex's Postgres-authoritative
lifecycle.

## Current Baseline

The following pieces already exist:

- `@flarex/durable-task` owns the pure run-attempt decisions and the
  `RunAttemptLifecycle` service;
- `TaskSystemRunAttemptStore` is a dynamically supplied, scope-bound storage
  capability;
- `@flarex/persistence-postgres` implements the lifecycle store, run creation,
  due discovery, and requested-effect reads through Drizzle;
- due discovery returns only `start_attempt` and `handle_lease_expiry`
  candidates with their exact version, attempt, fence, and lease bases;
- lifecycle acceptance re-reads durable state under database time and returns
  accepted, idempotent, or current outcomes; and
- the private scheduling subpaths now provide the scope-bound bounded runner,
  lifecycle candidate adapter, injected jitter boundary, and deterministic
  in-memory test adapters; and
- the private persistence subpath now composes those owners over one located
  trusted scope; there is no global scheduler partition, Cloudflare event
  host, or production activation.

The existing point-mutation and live-query schedulers are specialized owners.
Their count budgets, continuations, claims, cleanup, and host boundaries are
implementation evidence, not general task-scheduler authority.

## Core Architecture

Roadmap 05 separates durable recovery from low-latency wake delivery:

```text
Queue / cron / alarm / test host
        -> trusted scope or scheduler-partition resolution
        -> TaskWakeSchedulerV1
             -> TaskDueWorkSourceV1
             -> TaskDueCandidateHandlerV1
                  -> RunAttemptLifecycle
                       -> TaskSystemRunAttemptStore
```

The first core is deliberately scope-bound. Several scope instances may exist
at once, so the source, handler, and scheduler are explicit immutable
capability values rather than process-global Context services. Their factories
must document that cardinality and must not accept a caller-selected tenant or
scope string.

Cloudflare adapters will own the one runtime bridge for their callback. The
domain core remains Effect-native and exposes its exact success and typed
failure channels. Layer construction may capture stable adapters but must not
execute scheduling work.

### Standard Ports

The admitted first contracts are:

- `TaskDueWorkSourceV1<Failure>`: read one bounded, stable due-work page;
- `TaskDueCandidateHandlerV1<Failure>`: revalidate and handle exactly one
  candidate through the lifecycle owner;
- `TaskRetryJitterSourceV1`: supply the accepted `[0, 1)` sample used when a
  start candidate wins; and
- `TaskWakeSchedulerV1<SourceFailure, HandlerFailure>`: process pages
  sequentially under captured page and candidate budgets and return a
  continuation.

The ports use the existing run-read and lifecycle domain types. They do not
expose SQL, Drizzle, transactions, Cloudflare events, physical locators,
authentication claims, or raw scope IDs.

### In-Memory Adapters

The package may provide deliberate private testing adapters for:

- immutable due-candidate pages with stable keyset behavior;
- fixed retry jitter;
- recording candidate handling and injected typed failure; and
- snapshots of requests and handled candidates.

These adapters exercise the same scheduler core. They must not recreate the
run-attempt state machine. Lifecycle behavior continues to use
`RunAttemptLifecycleLive` plus a test store where that behavior is under test.

Memory proofs cover orchestration, pagination, budgets, duplicate delivery,
continuation, ordering, and typed failure propagation. They do not admit SQL,
transactions, locks, scope isolation, database time, or crash settlement;
PGlite and real Postgres remain required for those claims.

## Trigger Reuse Decision

The first source closure is pinned at Trigger.dev commit
`f10bc23785e569e5d917318cf2033aabdbe96a0b`:

- `internal-packages/run-engine/src/engine/systems/delayedRunSystem.ts` for
  re-reading current durable state when delayed work fires and skipping a wake
  that has moved or is no longer delayed;
- `internal-packages/run-engine/src/engine/systems/enqueueSystem.ts` for the
  boundary between durable state promotion and non-transactional queue
  publication; and
- `internal-packages/run-engine/src/engine/systems/dequeueSystem.ts` for
  revalidating dequeued work and acknowledging stale or invalid messages
  without starting duplicate execution.

The frozen SHA-256 receipts are:

| Source | SHA-256 |
| --- | --- |
| `delayedRunSystem.ts` | `5403afe544d27215254e9e86970f651da4fdff38e99f983772e6f041b5c88074` |
| `enqueueSystem.ts` | `5de82fccc85100b5600f977f6222cc1f26e5c26a97186094f42accc3d678ef3a` |
| `dequeueSystem.ts` | `d67f8fbfec2851fdbc8d4551979e0db531f2f145cbcdca498f6d5e968efb1a22` |

Roadmap 05 preserves those behaviors while replacing Prisma, Redis, Redlock,
worker jobs, Trigger organization/environment ownership, and Node supervisor
lifecycle. Source provenance and retained hostile scenarios must be recorded
before DTE05 admission. DTE05-B is a Flarex-authored seam implementation, not
a direct source transplant; the final provenance ledger must map the retained
behaviors and tests without falsely claiming unchanged source reuse.

## Requested-Effect Ownership

| Effect kind | Roadmap owner |
| --- | --- |
| `continue_retry` | Roadmap 05 coordination |
| `wake_retry` | Roadmap 05 |
| `wake_lease_expiry` | Roadmap 05 |
| `cancel_obsolete_lease_wake` | Roadmap 05 |
| `release_queue_ownership` | Roadmap 05 after concurrency ownership is fixed |
| `dispatch_attempt` | Roadmap 06 |
| `request_execution_cancellation` | Roadmap 06 |
| `publish_lifecycle_event` | Roadmap 07 |
| `notify_current_state` | Roadmap 07 |

Roadmap 05 must not add a generic consumer that delivers every requested
effect. The due index is already sufficient for retry and lease-expiry
recovery, so a generic requested-effect delivery table is not a correctness
prerequisite for the first wake scheduler.

## Checkpoints

### DTE05-A: Source And Contract Preflight — Complete

- pin the Trigger delayed, enqueue, and dequeue sources;
- classify reusable semantics versus Prisma/Redis/product mechanics;
- confirm Postgres due state remains authoritative;
- fix the standard core/port boundary and scope-bound cardinality; and
- keep compute, observability, and production activation closed.

### DTE05-B: Host-Neutral Core And Memory Adapters — Complete

- introduce the private scheduling-v1 contracts;
- implement a sequential bounded runner with stable continuation;
- adapt due candidates to the existing lifecycle service;
- inject retry jitter rather than reading `Math.random`;
- add deterministic in-memory source, jitter, and recording-handler adapters;
- prove ordering, page and candidate budgets, continuation, duplicate/stale
  outcomes, and exact typed-failure propagation; and
- extend package and boundary checks without enabling a host.

Completion evidence on 2026-08-05:

- `@flarex/durable-task` typecheck passed;
- all 73 package tests passed, including stable paging, bounded continuation,
  exact source/handler failure identity, duplicate lifecycle settlement,
  hostile adapter receipts, and immutable memory-source snapshot inputs;
- the Trigger compatibility boundary, 65-vector lifecycle gate, 29-entry
  source-map gate, and Standard Application boundary passed; and
- all 55 focused script tests passed. No production package consumes either
  scheduling subpath.

### DTE05-C: Trusted Scheduler Partition And Postgres Adapter — Active

The owning preflight is
[`preflight/26-dte05-trusted-scope-scheduler-composition.md`](./preflight/26-dte05-trusted-scope-scheduler-composition.md).

#### DTE05-C1: Located-Scope Postgres Composition — Complete

- compose the standard scheduler from the already-admitted due source,
  lifecycle store, and lifecycle service over one located trusted authority;
- expose no authority, locator, database, transaction, or caller-selected
  scope value;
- preserve the exact source, lifecycle, and scheduler error channels;
- prove PGlite and genuine PostgreSQL behavior; and
- keep the package subpath private and production-inert.

Completion evidence on 2026-08-05:

- the durable-task and persistence packages typechecked;
- all 73 durable-task tests passed, including construction-time lifecycle and
  jitter capture;
- the PGlite composition suite passed both bounded resume/no-longer-due and
  stale-authority cases through the real Drizzle source and lifecycle store;
- the genuine-PostgreSQL DTE04-E regression matrix passed all 15 tests and the
  reconstructed-scheduler DTE05-C1 lane passed both acceptance tests; and
- the 29-entry source-map gate, Trigger boundary, Standard Application
  boundary, and all 56 script tests passed. No production package consumes the
  new persistence subpath.

#### DTE05-C2: Trusted Partition Directory — Complete

The owning preflight is
[`preflight/27-dte05-trusted-partition-directory.md`](./preflight/27-dte05-trusted-partition-directory.md).

- extract only the generic stable replacement-scope directory kernel while
  preserving the exact point-mutation adapter contract;
- discover bounded inert partition hints without caller-selected scope IDs;
- freshly resolve and correlate located authority for every hint before
  constructing a new DTE05-C1 scheduler;
- expose no locator, database, transaction, or authority record; and
- prove stable snapshots, placement changes, restart, and non-disclosure in
  PGlite and genuine PostgreSQL without importing the point-mutation scheduler.

Completion evidence on 2026-08-06:

- the full 27-package workspace typecheck passed;
- all 73 durable-task tests and all 11 existing executor multi-scope
  point-mutation scheduler tests passed;
- the 11-test C2 PGlite lane preserved the existing point-mutation directory
  contract and proved task-directory discovery, fresh authority resolution,
  stable high-water paging, mismatch failure, C1 settlement, and
  reconstruction;
- the four-test genuine-PostgreSQL C2 lane preserved duplicate-scan and bounded
  primary-key plan proofs and completed the real task-directory flow, while the
  two-test C1 PostgreSQL regression also passed; and
- the 65-vector lifecycle gate, 29-entry source-map gate, Trigger boundary,
  Standard Application boundary, and all 57 script tests passed. No production
  package consumes the new private directory subpath.

### DTE05-D: Queue Wake Hints — Pending

- define the minimal authenticated/opaque wake envelope;
- publish only after durable transition settlement;
- consume at-least-once messages through the same scheduler core;
- re-read durable state before every action;
- acknowledge stale/current outcomes and retry only typed transient failures;
  and
- prove lost publication is repaired by durable discovery.

### DTE05-E: Cron Repair Sweep — Pending

- add a bounded scheduled host over trusted scheduler partitions;
- persist or reconstruct continuation without making it authority;
- enforce count, time, and settlement reserves; and
- prove recovery after lost messages, exhausted delivery retries, and host
  restart.

### DTE05-F: Optional Durable Object Alarm Acceleration — Pending

Admit only if measured latency or cost evidence justifies it. One object alarm
may coordinate a scheduler shard, but no task run receives an authoritative
per-run Durable Object. Alarm replacement, duplicate execution, exhausted
alarm retries, and cron recovery must be covered.

### DTE05-G: Final Admission — Pending

Require provenance, package, bundle, PGlite, real-Postgres, Cloudflare adapter,
duplicate/loss/reordering, operational receipt, and reviewer gates. Admission
does not activate production scheduling; Roadmap 06 compute delivery and the
later private vertical remain prerequisites.

## Failure And Retry Rules

- Invalid scheduler configuration is a typed construction failure.
- Due-source and candidate-handler failures retain their original typed error;
  the scheduler does not wrap them merely to add context.
- Candidates are processed sequentially in stable order in the first core.
- A failure stops the current invocation. Earlier accepted transitions remain
  durable, and replay from the previous continuation is safe through lifecycle
  idempotency and current-state responses.
- Only an adapter that owns a typed transient failure may retry it, and retries
  must be bounded.
- Defects and interruption remain full causes for the host boundary; they are
  not converted into ordinary scheduling failures.

## Stop Boundary

Roadmap 05 does not authorize:

- a root-workspace dependency on Trigger packages or source paths;
- Redis, Redlock, Prisma, or Trigger organization/environment runtime models;
- direct execution from a Queue or alarm payload without lifecycle
  revalidation;
- caller-selected tenant, scope, physical locator, or scheduler authority;
- a generic requested-effect delivery engine;
- `dispatch_attempt`, cancellation delivery, observability publication, or
  user-code execution;
- reinterpretation of the point-mutation or live-query scheduler as the task
  scheduler;
- deployment bindings, Wrangler activation, production routes, or dual
  execution; or
- a claim that memory tests admit Postgres or distributed behavior.

## Admission Gate

Roadmap 05 may become **complete: admit** only when:

1. the standard core and all adapter contracts preserve exact Effect success,
   failure, and requirement channels;
2. duplicate, stale, reordered, missed, and repeated work cannot bypass
   lifecycle versions, fences, leases, or database time;
3. scheduler partition authority is trusted, bounded, and non-disclosing;
4. Queue and cron paths call the same core and retain at-least-once semantics;
5. PGlite and real Postgres prove storage and concurrency claims;
6. Cloudflare bundle and local event-host tests pass without production
   activation;
7. Trigger provenance and retained hostile cases are complete; and
8. both required project reviewers accept the final significant code diff.
