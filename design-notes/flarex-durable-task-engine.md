# Flarex Durable Task Engine

## Status And Scope

**Status:** Accepted architecture direction. Implementation authority now lives
in [`../roadmaps/durable-task-engine/README.md`](../roadmaps/durable-task-engine/README.md).
The private lifecycle, Task System Postgres, scheduling/repair, provider, and
compute-delivery persistence foundations are implemented but production-inert.
The connected runtime is paused pending approval of the completed candidate
source-reuse audit in
[`../roadmaps/durable-task-engine/preflight/37-dte06-connected-runtime-reuse-audit.md`](../roadmaps/durable-task-engine/preflight/37-dte06-connected-runtime-reuse-audit.md).

This note defines how the pinned Trigger.dev compatibility island may inform a
Flarex-native durable background-task engine. It does not activate the imported
source, add either pnpm workspace to the other, install its dependencies, adopt
its Prisma schema, or authorize production scheduling.

The admitted first lifecycle map records transformed reuse rather than an
unchanged package transplant: 13 seam-adapted entries, 12 adapter translations,
four discards, and no unchanged entry. Later Flarex-owned persistence,
scheduling, Cloudflare, and provider work remains valid integration
infrastructure, but it is not evidence that Trigger's connected runtime has
already been reused or that Trigger parity has been reached.

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

Trigger also has a mature task-definition boundary: stable task IDs, task
metadata and manifests, payload schemas, retry and duration policy, queues,
compute selection, lifecycle hooks, resource-catalog lookup, and duplicate-ID
collision detection. Those definition semantics are migration input alongside
the run engine; Flarex should not replace them with its current action
prototype.

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

## First-Class Task Definitions

A Flarex durable task is a first-class Standard Application definition, not an
alias for `action`, `internalAction`, mutation, query, or `workflowMutation`.

The private Standard Application model should gain a canonical task catalog
beside its existing function catalog. Each canonical task manifest binds:

- stable developer `TaskIdV1`;
- handler module/export and immutable artifact evidence;
- payload and output validators;
- normalized retry and maximum-duration policy;
- Flarex compute-profile policy; and
- versioned queue policy.

`TaskIdV1` remains stable across application revisions and is the logical task
identity under a trusted scope. Handler function path is location evidence,
not public identity. Each application revision creates an immutable
task-definition revision that captures the exact manifest, artifact,
validators, and policies used by its runs.

Current Flarex action code is prototype evidence only. Action runtime work may
later provide reusable sandbox, external-I/O, or nested-call mechanics, but it
does not decide the task definition, context, artifact class, or lifecycle.

The first private producer should target the canonical task manifest directly.
A later Trigger-style public `task({ id, run, ... })` API must lower to that
same model rather than introduce a second task representation.

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

- stable task ID and canonical task-manifest identity bound to an immutable
  application revision and runtime artifact;
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

- task options, metadata, manifest, stable-ID, duplicate-collision, handler
  catalog, payload-schema, retry, and maximum-duration semantics;
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
- public Trigger SDK and API transport/product contracts, while preserving the
  reusable task-definition semantics behind a Flarex-owned API;
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

Actions and durable tasks may share low-level application artifact,
materialization, sandbox, compute, log, trace, and nested-call mechanics. They
do not share identity, definition, context, or invocation semantics.

- An action is normally a direct request/response execution. Its caller owns
  the request lifetime, and completion is returned synchronously when possible.
- A task creates durable run authority before execution. Retries, delays,
  cancellation, heartbeats, checkpoints, and eventual result inspection belong
  to the task engine rather than the request lifetime.
- A task is selected by stable task ID from a canonical task catalog. It is not
  selected by reinterpreting an action function path.

The shared implementation seam should be a narrow user-code execution/compute
port, not either product API calling the other. A direct edge-action adapter and
a durable-task attempt adapter may both use the same R2 loader, Worker sandbox,
controlled outbound capability, authenticated query/mutation callback
mechanics, and resource accounting. The action adapter binds an `edge_action`
target and request lifetime; the task adapter binds a distinct `durable_task`
target, task definition revision, attempt fence, and task context.

External-effect dispatch uncertainty is the one deliberately shared evidence
concern. Its owner may bind evidence to either a direct action invocation or a
fenced task attempt, but must preserve those distinct parent identities and may
not own scheduling, leases, retries, cancellation, or terminal transitions.
Task lifecycle “requested effects” remain internal orchestration instructions
and are not widened into the user external-effect journal.

The task engine must not become a parallel FlarexDB transaction or commit
system. User-code database effects continue through the existing trusted
executor and its OCC/commit owners. Task lifecycle transactions govern task
state only.

## First Vertical Proof

The first implementation should deliberately omit broad Trigger parity. It
should prove one private, production-inert path:

1. define and analyze one first-class canonical Flarex task manifest with a
   stable task ID;
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

This proof is now the progress gate. Before more connected-runtime code is
added, Preflight 37 must identify the exact Trigger dispatch, supervision,
heartbeat, cancellation, settlement, and recovery source closure. After that
approval, implementation should close this private vertical before adding
another generalized task foundation.

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

Capability maps are local grants, not blanket permission to either copy or
freshly reimplement the rest of Trigger. Every later connected capability must
name the exact upstream symbols or control-flow segments and tests it retains,
classify each as unchanged, seam-adapted, adapter-translated, or discarded, and
justify why a more direct reuse class is unsafe.

## Package And Workspace Boundary

The Trigger compatibility island intentionally has its own
`pnpm-workspace.yaml`, lockfile, dependency versions, generation commands, and
test lane. No decision in this note authorizes merging that workspace into the
Flarex root.

The accepted boundary is:

1. keep the imported island frozen, separately installable, and outside the
   Flarex workspace and runtime graph;
2. do not merge, regenerate, or reconcile its lockfile with the Flarex root
   lockfile;
3. do not make active Flarex packages depend directly on upstream Trigger
   package names;
4. transform admitted capabilities into Flarex-owned packages with Flarex
   identity, protocols, typed failures, storage capabilities, and host
   boundaries;
5. retain provenance and executable compatibility evidence for adapted Trigger
   control flow and tests;
6. keep Prisma, Redis, Trigger product identity, Node supervisor, and imported
   package names outside the active runtime graph; and
7. admit each later capability only through its own source map and focused
   package, behavior, database, bundle, and reviewer gates.

The private `@flarex/durable-task` package and its Flarex Postgres adapters are
now admitted under this model. The separate compatibility island remains
provenance and regression input, not a second production package graph. The
current decision is no longer whether to merge workspaces; that remains
rejected. The active question is how much concrete Trigger connected-runtime
control flow can be retained around the existing Flarex seams before the first
end-to-end private vertical is implemented.
