# DTE05-P26: Trusted Scope Scheduler Composition

## Decision

**Outcome: DTE05-C1 complete; admit no later host.** The first Postgres
scheduling adapter is a production-inert composition over one already-resolved
`LocatedTrustedScopeAuthority`. It reuses the Roadmap 04 Drizzle due-discovery
and lifecycle-store adapters behind the DTE05-B host-neutral scheduler. It does
not add SQL, a second state machine, caller-selected scope fields, or a new
transaction owner.

Global scheduler-partition discovery is DTE05-C2 and remains pending. Flarex
may place scopes in a shared database, schema-per-scope, or database-per-scope
target. A task-table scan in one database therefore cannot prove a complete
global directory. The existing point-mutation redelivery scope scanner is
specialized owner evidence, not task-scheduler authority and not an API to
reinterpret.

## Current Reusable Owners

The necessary single-scope pieces already exist:

- `makeTaskSystemDueDiscoveryV1` owns stable, bounded Drizzle discovery under
  captured scope authority and database time;
- `makeTaskSystemRunAttemptStoreV1` owns scope-qualified lifecycle
  transactions, locks, idempotency, database time, corruption classification,
  and authority revalidation;
- `RunAttemptLifecycleLive` owns the host-neutral lifecycle algorithms;
- `makeRunAttemptDueCandidateHandlerV1` maps due candidates into the admitted
  lifecycle operations; and
- `makeTaskWakeSchedulerV1` owns sequential paging, budgets, exact receipts,
  continuations, and adapter-contract validation.

DTE05-C1 connects these exact owners. It must not clone due SQL into a new
adapter, implement Trigger's `RunStore`, or add a Prisma-shaped abstraction
over Drizzle.

## C1 Capability

The persistence-owned factory accepts:

- one already-resolved
  `LocatedTrustedScopeAuthority<LocatedTaskSystemRunAttemptTargetV1>`;
- captured scheduler page and candidate budgets;
- an injected `TaskRetryJitterSourceV1`; and
- existing due-read and lifecycle-store adapter options.

It returns the standard
`TaskWakeSchedulerV1<SourceFailure, HandlerFailure>` capability. The returned
value exposes only `run({ dueKind, cursor })`. It exposes no deployment,
tenant, scope, epoch, physical locator, Drizzle database, transaction, or
authority record.

The same located authority and exact target construct both the due source and
lifecycle store. A candidate cannot select another scope, and every read or
lifecycle transaction revalidates the captured authority through the admitted
Roadmap 04 mechanisms.

The composition is an explicit local factory because several scope-bound
scheduler instances may coexist. It is not a process-global Context service.
The lifecycle service may have a plain multi-instance constructor used by its
existing Layer and this persistence composition; that constructor remains
private to the admitted package subpath and does not replace the Layer for
ordinary dependency graphs.

## Failure And Retry Contract

C1 preserves the existing channels without wrapping them:

- invalid scheduler configuration remains
  `InvalidTaskWakeSchedulerConfigurationError` at construction;
- due reads retain `TaskSystemDueDiscoveryErrorV1`, including typed invalid
  input, corruption, stale authority, transient store, and terminal store
  failures;
- lifecycle handling retains `RunAttemptLifecycleErrorV1` plus the explicit
  handler/lifecycle contract error; and
- scheduler request, source-contract, and handler-contract failures remain the
  DTE05-B types.

The composition adds no retry. Roadmap 04 owns bounded transaction retries.
The later Queue or cron host may retry only typed transient operation failures
under its own bounded delivery policy. Defects and interruption remain Causes
for the future host boundary.

## Jitter And Requested Effects

Retry jitter remains injected. C1 does not call `Math.random`, capture a
Cloudflare global, or invent a persistence-owned randomness policy. A later
host adapter must provide a validated `[0, 1)` source with explicit lifecycle
ownership.

Lifecycle acceptance continues to persist requested effects atomically. C1
does not deliver `dispatch_attempt`, publish observability, call a Worker, or
consume the requested-effect ledger. Roadmaps 05 through 07 retain their
existing effect ownership. Production scheduling remains closed so an accepted
attempt cannot be orphaned by prematurely activating this composition before
Roadmap 06 compute delivery exists.

## C2 Partition Discovery Cutline

DTE05-C2 must define a control-plane directory capability that emits inert
routing candidates, not execution authority. At minimum it must prove:

1. a bounded stable directory snapshot across shared and split placements;
2. deployment-led fresh resolution of the exact located scope authority;
3. no caller-supplied scope or physical locator;
4. missing, moved, stale, and corrupt entries fail closed without disclosing
   another scope's task state;
5. continuation data can only skip or repeat inert partition hints; and
6. every selected partition constructs a fresh C1 capability before work.

The preflight must first decide whether the point-mutation scanner's exact
directory mechanics can move behind a generic control-plane owner without
changing its contract. Repetition alone does not authorize copying or widening
that specialized scheduler API.

## Validation Gate

DTE05-C1 requires:

- one PGlite end-to-end scheduler proof using the real due source, lifecycle
  store, lifecycle service, and standard scheduler;
- stable continuation and bounded multi-page behavior through Drizzle;
- accepted lifecycle settlement followed by durable no-longer-due behavior;
- stale-authority and cross-scope/non-disclosure coverage inherited from the
  same concrete adapters and exercised through the composition where useful;
- one genuine PostgreSQL lane using the same factory and driver-specific
  located target;
- exact package and Trigger-boundary allowlists with no production consumer;
- package typecheck, relevant DTE04 regression lanes, scheduler tests, and both
  required project reviewers.

Completion evidence on 2026-08-05 satisfies this gate: both packages
typechecked; all 73 durable-task tests passed; the two-case PGlite composition
lane passed; the genuine-PostgreSQL DTE04-E matrix passed all 15 tests; the
genuine-PostgreSQL DTE05-C1 lane passed both tests, including scheduler
reconstruction between durable pages; and all 56 script tests plus the
29-entry source-map and boundary gates passed. The final reviewer disposition
is recorded by the accepting commit.

## Stop Boundary

DTE05-C1 does not authorize:

- global scope enumeration or a scheduler directory host;
- Queue, cron, alarm, HTTP, Worker, or deployment bindings;
- a caller-selected tenant, deployment, scope, locator, or database;
- task-table scans outside the captured scope;
- a new migration or task table;
- requested-effect delivery or compute dispatch;
- a process-global multi-tenant scheduler service; or
- production activation.
