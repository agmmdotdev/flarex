# Flarex Durable Task Engine

## Status And Scope

**Status:** Accepted architecture direction; package integration and
implementation are not yet authorized.

This note defines how the pinned Trigger.dev compatibility island may inform a
Flarex-native durable background-task engine. It does not activate the imported
source, add either pnpm workspace to the other, install its dependencies, adopt
its Prisma schema, or authorize production scheduling.

The current source boundary remains documented in
[`../third_party/trigger.dev/README.md`](../third_party/trigger.dev/README.md)
and the repository package boundary remains owned by
[`../roadmaps/16-package-boundaries.md`](../roadmaps/16-package-boundaries.md).

## Current Reality

Flarex already has important execution foundations:

- Standard application definition, analysis, registration, readiness,
  activation, and exact runtime selection;
- R2-owned source and runtime artifact bodies;
- Worker Loader based runtime materialization;
- trusted executor, transaction, OCC, commit, feed, and outbox owners;
- private FlarexDB application-data work; and
- specialized Durable Object scheduling for live-query maintenance and bounded
  point-mutation redelivery.

Those capabilities do not yet form a general durable task engine. Flarex does
not currently provide one end-to-end owner for task runs, attempts, delayed
execution, retries, cancellation, waitpoints, checkpoints, fair queues,
concurrency limits, heartbeats, and compute supervision. Existing scheduler
code must not be reinterpreted as that owner merely because it uses alarms or
redelivery.

The imported Trigger.dev run engine contains mature implementations and tests
for many of those semantics. Its current construction is nevertheless tied to
Trigger-specific identity and product models plus Prisma, PostgreSQL, Redis,
Redlock-style coordination, Node timer loops, and long-running Docker or
Kubernetes supervisor processes. It cannot run unchanged as a Cloudflare
Worker.

## Accepted Direction

Trigger.dev is migration input, not a runtime dependency or embedded product.
Flarex will preserve and adapt proven durable-execution semantics while
replacing Trigger-specific storage, tenancy, runtime, deployment, and host
authority.

The target dependency direction is:

```text
Flarex task and scheduler APIs
        -> Flarex durable-run state machine
             -> private FlarexDB Task System API
             -> Cloudflare wake and coordination adapters
             -> Flarex ComputeProvider
                  -> Worker Loader runtime
                  -> AgentOS or another provider
```

The durable-run state machine should be host-neutral. It should express
validated commands, current durable state, deterministic transition decisions,
required atomic writes, emitted events, and typed failures. Cloudflare Workers,
Durable Object alarms, Queues, and cron triggers wake or host that logic; they
do not become an independent source of run truth.

Every Worker invocation must be able to reconstruct authority from durable
state. Correctness must not depend on a permanently running Node process, an
in-memory timer, or delivery of one particular wakeup. Wakeups may reduce
latency, but durable discovery and fenced claims must recover missed or
duplicated delivery.

## Storage Ownership

Replacing Trigger's database integration means:

- the engine no longer imports Prisma types or clients;
- Trigger's Prisma schema is not migrated table-for-table;
- the engine calls a private FlarexDB-owned task capability;
- Flarex owns task identities, tenancy, schema, transactions, clocks, fences,
  and corruption policy; and
- the storage implementation remains replaceable below that capability.

This does **not** require eliminating PostgreSQL as FlarexDB's physical storage.
In the current architecture PostgreSQL may remain the authoritative persistence
engine behind FlarexDB. The durable task engine must not know or depend on that
fact. The replacement boundary is Trigger Prisma/PostgreSQL ownership to
FlarexDB System API ownership, not a claim that no PostgreSQL process exists.

Durable task state is platform control state, not arbitrary user application
data. It belongs behind a reserved private Task System API even when stored in
the same located target database. User functions must not receive raw access
to its tables or transaction capabilities.

Before defining tables, the task lifecycle and atomic operations must be
specified. The likely authoritative concepts are:

- task definition identity bound to an immutable application revision and
  runtime artifact;
- run identity, application/environment scope, input reference, and creation
  idempotency identity;
- attempt number, execution fence, compute assignment, and lease expiry using
  an authoritative database clock;
- queue, priority, due time, and concurrency-key relationships;
- retry policy and next eligible attempt;
- monotonic cancellation generation and terminal outcome;
- waitpoint and checkpoint identity;
- ordered run events and durable result, log, trace, and checkpoint references.

Large payloads, user code, runtime artifacts, logs, traces, and checkpoint
bodies should remain in R2 or their owning observability store. FlarexDB should
persist authoritative identities, relationships, fences, states, lengths,
digests, and content-addressed references rather than becoming a duplicate
body store.

## What To Preserve And What To Replace

Preserve or adapt from Trigger.dev:

- run and attempt state-transition invariants;
- retry, cancellation, heartbeat, and visibility-timeout behavior;
- checkpoint, resume, waitpoint, delayed-run, debounce, and TTL semantics;
- fair scheduling and concurrency algorithms;
- event ordering and idempotency rules;
- failure, race, restart, and uncertainty tests; and
- operational observability concepts.

Replace rather than carry forward:

- Trigger organization, project, environment, deployment, and authentication
  ownership;
- public Trigger SDK and API contracts;
- Prisma models, generated clients, and direct database access;
- Redis keyspace, Lua script, and Redlock authority;
- long-running Node polling and in-memory timer ownership;
- Trigger bundling, bootstrap, and artifact protocols;
- Docker, Kubernetes, ECR, and Trigger compute-provider assumptions; and
- Trigger billing and product-specific routing.

Extraction must proceed by capability and authority, not by copying entire
packages into the active workspace. A module that mixes reusable transition
policy with Prisma or Redis mechanics should first be characterized and then
split at the semantic boundary.

## Actions And Durable Tasks

Actions and durable tasks may share application artifacts, runtime
materialization, sandboxing, compute providers, logs, and traces. They do not
share the same invocation semantics.

- An action is normally a direct request/response execution. Its caller owns
  the request lifetime, and completion is returned synchronously when possible.
- A task creates durable run authority before execution. Retries, delays,
  cancellation, heartbeats, checkpoints, and eventual result inspection belong
  to the task engine rather than the request lifetime.

The task engine must not become a parallel FlarexDB transaction or commit
system. User-code database effects continue through the existing trusted
executor and its OCC/commit owners. Task lifecycle transactions govern task
state only.

## First Vertical Proof

The first implementation should deliberately omit broad Trigger parity. It
should prove one private, production-inert path:

1. define and analyze one Flarex task;
2. bind it to one immutable application revision and runtime artifact;
3. create one idempotent durable run;
4. persist and discover the due run through the Task System API;
5. acquire one attempt through a database-clock lease and monotonic execution
   fence;
6. execute the task through the existing Worker Loader/runtime boundary;
7. record bounded heartbeat evidence;
8. commit one terminal result or retry decision; and
9. recover correctly from duplicate wakeups, worker loss, lease expiry, and a
   lost completion response.

The proof should begin with one queue and a bounded retry policy. Cron,
batches, debounce, waitpoints, advanced fairness, cross-provider placement, and
AgentOS integration follow only after the singular run/attempt authority is
proven.

## Required Preflight Before Implementation

Before moving any Trigger-derived source into active Flarex packages, produce a
capability map that classifies each relevant Trigger module as:

1. preserve the algorithm or invariant;
2. replace with a FlarexDB Task System API operation;
3. replace with a Cloudflare host adapter;
4. replace with a Flarex compute-provider adapter; or
5. discard as Trigger product or infrastructure policy.

That preflight must define the run lifecycle, atomic operations, clock and
fencing authority, failure taxonomy, restart model, data-retention boundary,
and the first vertical proof. It must also reconcile with existing FlarexDB
schemas before adding tables so superficially similar lifecycle, lease,
idempotency, or event concepts are not duplicated.

## Package And Workspace Integration Is Deferred

The Trigger compatibility island intentionally has its own
`pnpm-workspace.yaml`, lockfile, dependency versions, generation commands, and
test lane. No decision in this note authorizes merging that workspace into the
Flarex root.

The accepted holding plan is:

1. keep the imported island frozen, separately installable, and outside the
   Flarex workspace and runtime graph;
2. do not merge, regenerate, or reconcile its lockfile with the Flarex root
   lockfile;
3. do not make active Flarex packages depend directly on upstream Trigger
   package names;
4. use the capability preflight to identify the smallest coherent semantic
   owner worth extracting;
5. transform that capability into a Flarex-owned package with Flarex identity,
   protocols, typed failures, storage capabilities, and host boundaries; and
6. admit transformed packages to the Flarex workspace one at a time, only after
   focused behavior-parity tests and Worker bundle checks pass.

This is a pause, not a decision to preserve two permanent production package
graphs. The compatibility island remains provenance and migration input while
the active implementation gradually becomes Flarex-owned. The package strategy
must be revisited before the first extraction because the exact package owner
and dependency closure depend on the selected vertical capability.

The next design discussion must compare at least:

- keeping the island frozen while reimplementing selected capabilities in new
  Flarex-owned packages;
- promoting a small transformed package at a time into the Flarex workspace;
- temporarily building selected upstream packages as external artifacts; and
- attempting one combined workspace and dependency graph.

The comparison must account for provenance, lockfile ownership, dependency
version conflicts, generated Prisma clients, Node-only dependencies, Worker
bundle safety, test isolation, patch ownership, and future extraction cost.
Until that decision is recorded, the compatibility island remains separately
installable, inactive, and forbidden from the Flarex runtime import graph.
