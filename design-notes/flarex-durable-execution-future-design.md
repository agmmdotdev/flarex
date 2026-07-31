# Durable Background Execution And AgentOS Compute

Status: proposed future cross-domain design; not accepted for implementation

Last reviewed: 2026-08-01

## Purpose And Authority

This note records a possible future architecture that combines Flarex's
Convex-inspired application backend with selected durable-execution mechanisms
derived from Trigger.dev and an AgentOS compute host.

It is a proposal, not current behavior, an implementation plan, or permission
to change FlarexDB, the public SDK, deployment routing, production execution,
or infrastructure. If this direction is accepted, its durable domain ownership
and ordered correctness gates must move into one or more focused roadmaps before
implementation.

The existing authorities continue to win:

1. [FlarexDB accepted design](./flarex-db-accepted-design.md) owns app-data
   authority, trust boundaries, transactions, and replacement rules.
2. [Host-neutral function runtime](../roadmaps/40-host-neutral-function-runtime.md)
   owns portable user-code execution semantics and host-adapter boundaries.
3. [Dynamic Worker execution](../roadmaps/06-dynamic-worker-execution.md) owns
   Cloudflare isolation, artifact materialization, and hosted runtime behavior.
4. [SDK and CLI fork](../roadmaps/09-sdk-and-cli-fork.md) owns public authoring,
   generated APIs, codegen, and developer tooling.
5. [Deployment analysis and push](../roadmaps/17-deployment-analysis-and-push.md)
   owns backend-authoritative analysis, artifact validation, and activation.
6. [Production redelivery](../roadmaps/37-production-redelivery-and-c06b.md)
   owns the existing exact FlarexDB attempt, claim, journal, and scheduled-host
   boundaries.

This proposal must not create a parallel OCC engine, transaction journal,
commit compiler, app-data retry coordinator, commit feed, outbox authority, or
application-row store.

## Proposed Outcome

Flarex would become a complete application backend with two intentionally
different execution domains:

- short, deterministic queries and mutations executed through Flarex's existing
  Cloudflare and FlarexDB transaction architecture; and
- durable, retryable, potentially long-running actions and tasks scheduled by a
  Flarex-owned orchestration service and executed by AgentOS.

Flarex would own every public developer-facing contract. Trigger.dev-derived
code would become an internal implementation source for durable run mechanics,
not a second product or public compatibility surface.

~~~text
Flarex SDK and generated references
  -> Flarex public backend
  -> direct invocation or transactional task command
  -> Flarex-owned durable run engine
  -> Flarex Supervisor
  -> AgentOS runtime
  -> Flarex function runtime
  -> developer action/task
  -> restricted Flarex APIs
~~~

## Decisions Proposed For Future Review

### Flarex Owns The Public Product

Developers import only Flarex packages and use Flarex concepts. Flarex owns:

- query, mutation, action, and task declarations;
- validators and generated api/internal references;
- local development, analysis, code generation, bundling, and deployment;
- tenants, projects, deployments, environments, artifacts, and function
  identities;
- public trigger, cancel, inspect, schedule, and observability APIs;
- the user-code context and all capabilities available through it; and
- the dashboard identity model and presentation.

The following must not become public Flarex requirements:

- the Trigger.dev SDK;
- Trigger organizations, projects, environments, API keys, or deployment APIs;
- Trigger task registration globals;
- Trigger container-image configuration;
- Trigger workload tokens or internal run protocol; or
- Trigger-specific identifiers in generated application code.

An internal compatibility adapter may initially translate a Flarex function
manifest and invocation into Trigger-derived engine contracts. That bridge must
remain private and have a deletion or permanent-ownership decision before the
first supported release.

### Trigger.dev Is A One-Time Source, Not An Upstream Dependency

The proposed adoption model is a one-time fork or source import. Flarex would
own and maintain the derived code without assuming continued synchronization
with Trigger.dev.

This is justified only for the bounded execution vertical. The useful source
areas identified in Trigger.dev commit f10bc23 are:

- internal-packages/run-engine for run state, queues, retries, waitpoints, and
  concurrency;
- apps/supervisor for dequeue and workload lifecycle;
- selected packages/core execution protocols;
- managed run controller and worker lifecycle behavior;
- selected build and indexing behavior; and
- run timeline, logging, and observability concepts.

The complete Trigger.dev product should not be imported as Flarex architecture.
Its Remix application, billing, organizations, authentication, deployment
product, container registry flow, and unrelated dashboard services duplicate
Flarex ownership.

Imported code must retain the licenses, copyright notices, and attribution
required by its exact source files. The Trigger.dev root inspected for this
proposal is Apache-2.0 and several published packages declare MIT. A concrete
source and license inventory is required before import; this note is not legal
advice and does not authorize copying code without that inventory.

### Flarex Identity Replaces Trigger Tenancy

One Flarex app must not be modeled as one Trigger tenant. The proposed mapping
is:

| Trigger.dev concept | Flarex-owned concept |
| --- | --- |
| Organization | Tenant, account, or workspace |
| Project | Flarex project/application |
| RuntimeEnvironment | Flarex deployment environment |
| WorkerDeployment | Immutable deployment push/version |
| BackgroundWorker | Analyzed execution artifact |
| BackgroundWorkerTask | Function entry in the Flarex manifest |
| TaskRun | Durable Flarex run |
| TaskRunAttempt | One compute execution attempt |

The current Flarex schema already records deploymentId, projectId, an active
package, and one scope per deployment. That is evidence for the project,
deployment, artifact, and scope distinction, but it is not yet a complete
tenant control-plane schema.

A future execution identity should carry immutable, explicitly owned fields:

~~~ts
type ExecutionIdentity = {
  tenantId: string;
  projectId: string;
  deploymentId: string;
  scopeId: string;
  artifactId: string;
  functionId: string;
};
~~~

These identities should be shared by runs, attempts, schedules, queue policy,
usage, logs, traces, and AgentOS workloads.

### Keep Orchestration State Separate From App-Data State

FlarexDB remains the only authoritative committed application-data store.
The durable engine owns workflow state only.

~~~text
FlarexDB authority
  application rows and revisions
  exact snapshots and OCC
  commits and idempotent mutation outcomes
  commit/change feed and transactional outbox

Durable-execution authority
  runs and attempts
  queues and concurrency
  retries and cancellation
  schedules and waitpoints
  compute leases and heartbeats
  durable task results and execution events
~~~

The two domains may share a PostgreSQL cluster, but orchestration records should
have a distinct logical schema and must not be placed inside every physical
app-data database. Flarex supports shared-database, schema-per-scope, and
database-per-scope placement; platform orchestration must continue to operate
without assuming that all application rows are colocated.

Existing Flarex transaction sessions, attempt fences, execution claims, and
journals must not be reused as long-running task runs. They are short-lived,
snapshot-bound app-data transaction mechanisms. A durable task may run for
hours, perform external side effects, and call multiple independent Flarex
queries and mutations. It cannot hold a FlarexDB snapshot or Postgres
transaction open.

### Transactional Dispatch Connects The Domains

A query never schedules work. A mutation may schedule work only by recording a
logical command atomically with its application-data commit. The command is
delivered after commit to the durable engine.

~~~text
mutation execution
  -> stage application writes
  -> stage task command
  -> OCC validation
  -> atomic FlarexDB commit
  -> canonical outbox/commit evidence
  -> bounded dispatcher
  -> idempotent durable run creation
~~~

If the mutation rolls back, no task exists. If dispatch is delivered more than
once, one logical run is created.

A deterministic dispatch identity can derive from server-owned evidence such as
scope UUID, commit sequence, and command ordinal. The exact contract belongs to
a future FlarexDB/outbox preflight and must not be introduced incidentally by
the durable engine.

No distributed transaction between FlarexDB and the run engine is proposed.
The correctness model is transactional outbox plus idempotent consumption.

### The Run Must Pin Exact Code

A run records the exact immutable artifact and function identity at trigger
time:

~~~ts
type DurableRunTarget = {
  deploymentId: string;
  artifactId: string;
  functionId: string;
};
~~~

If a deployment activates a newer artifact while a run is queued, that queued
run continues using its pinned artifact. The Supervisor must not resolve
"currently active code" when the attempt starts.

Scope epoch, authorization revocation, and deployment deletion policies require
a separate decision. A stored run locator is not permission to execute. Each
attempt must receive freshly validated, short-lived capability material from a
trusted owner.

## Flarex SDK Direction

### Preserve Convex-First Authoring

Flarex should preserve the existing Convex-inspired mental model for queries,
mutations, actions, validators, function paths, generated references, and
scheduling wherever portable.

Durable tasks are a deliberate Flarex extension. Before finalizing the public
surface, the SDK roadmap must compare Convex scheduling and action semantics
and document each divergence.

A possible authoring surface is:

~~~ts
import {
  query,
  mutation,
  action,
  task,
  internalTask,
} from "flarex/server";
~~~

Example mutation:

~~~ts
export const createOrder = mutation({
  args: {
    productId: v.id("products"),
    quantity: v.number(),
  },
  handler: async (ctx, args) => {
    const orderId = await ctx.db.insert("orders", {
      ...args,
      status: "pending",
    });

    await ctx.scheduler.runAfter(
      0,
      internal.orders.processOrder,
      { orderId },
    );

    return orderId;
  },
});
~~~

The scheduling call above records transaction-owned intent. Awaiting it does not
wait for the background task to finish.

Example durable task:

~~~ts
export const processOrder = internalTask({
  args: {
    orderId: v.id("orders"),
  },
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutMs: 1_000,
    maxTimeoutMs: 60_000,
  },
  runtime: {
    provider: "agentos",
    memory: "256mb",
    timeout: "30m",
  },
  run: async (ctx, { orderId }) => {
    const order = await ctx.runQuery(
      internal.orders.getForProcessing,
      { orderId },
    );

    const payment = await ctx.fetch(
      "https://payment-provider.example/charge",
      {
        method: "POST",
        body: JSON.stringify(order),
      },
    );

    await ctx.runMutation(
      internal.orders.markCompleted,
      {
        orderId,
        paymentId: payment.id,
      },
    );
  },
});
~~~

The exact spelling is unresolved. In particular, task versus workflow, handler
versus run, and runtime policy should not be accepted until SDK analysis,
generated-reference, testing, and error contracts are designed together.

### Capability Matrix

The proposed semantic distinction is:

| Capability | Query | Mutation | Action | Durable task |
| --- | ---: | ---: | ---: | ---: |
| Direct ctx.db | Read | Read/write | No | No |
| runQuery/runMutation | No | No | Yes | Yes |
| External network | No | No | Yes | Yes |
| Transactional scheduling | No | Yes | No | No |
| Direct task start | No | No | Yes | Yes |
| Durable wait | No | No | No | Yes |
| Durable retry policy | OCC only | OCC only | No by default | Yes |
| Default host | Dynamic Worker | Dynamic Worker | Policy-selected | AgentOS |

Actions and tasks may share runtime implementation, but their public lifecycle
semantics remain different. An ordinary action is request/response and is not
silently retried after an ambiguous external side effect. A durable task is
run-engine-controlled and may be retried according to explicit policy.

A future API may allow an action to select AgentOS for native software, more
memory, or longer execution without making the action durable. Durability and
compute placement are separate choices.

### Flarex Context Replaces Trigger Globals

Trigger.dev-style concepts should map to explicit Flarex context capabilities:

| Trigger.dev concept | Possible Flarex capability |
| --- | --- |
| tasks.trigger | ctx.tasks.start |
| tasks.triggerAndWait | ctx.tasks.run |
| batch.trigger | ctx.tasks.startBatch |
| wait.for | ctx.wait.for |
| wait.until | ctx.wait.until |
| logger | ctx.log |
| global run context | ctx.run |
| task references | generated Flarex references |

These names remain proposals. The important boundary is that user code never
imports or depends on the Trigger.dev SDK.

## Build, Analysis, And Artifact Design

### Flarex Owns One Logical Deployment

Developers continue writing ordinary modules under flarex/. They do not create
Worker entrypoints, AgentOS boot files, Dockerfiles, or Trigger configuration.

The Flarex pipeline remains:

~~~text
developer modules
  -> local analysis for feedback
  -> backend-authoritative analysis
  -> canonical function metadata
  -> generated typed references
  -> target-specific runtime projections
  -> content-addressed artifact storage
  -> verified deployment activation
~~~

The Trigger.dev build pipeline may provide implementation evidence, especially
for module discovery, source maps, dependency handling, and runtime bootstrap,
but it must not become artifact authority.

### One Root Manifest, Multiple Runtime Targets

One logical deployment should produce a root manifest with separate target
projections rather than one universal JavaScript bundle.

~~~text
root execution artifact
  -> Cloudflare projection
       queries
       mutations
       edge actions
  -> AgentOS projection
       AgentOS actions
       durable tasks
       workflow/runtime support
       admitted assets and dependencies
~~~

A possible non-authoritative shape is:

~~~json
{
  "formatVersion": 1,
  "artifactId": "artifact_a84c",
  "projectId": "project_shop",
  "deploymentId": "deployment_production",
  "targets": {
    "cloudflare": {
      "entrypoint": "edge/index.mjs",
      "contentHash": "..."
    },
    "agentos": {
      "entrypoint": "agentos/bootstrap.mjs",
      "contentHash": "...",
      "runtimeVersion": "1"
    }
  },
  "functions": [
    {
      "id": "orders:createOrder",
      "kind": "mutation",
      "runtime": "cloudflare",
      "module": "orders.mjs",
      "exportName": "createOrder"
    },
    {
      "id": "orders:processOrder",
      "kind": "task",
      "runtime": "agentos",
      "module": "orders.mjs",
      "exportName": "processOrder",
      "retry": {
        "maxAttempts": 5
      }
    }
  ]
}
~~~

This sketch is not an accepted protocol, naming convention, or permission to
create a second artifact format beside Declarative V2. A future design must
reuse the canonical declarative program, semantic artifact, authoritative
analysis, and activation owners. Runtime projections are derived evidence, not
developer-authored authority.

### AgentOS Is Not An OCI Runtime

Trigger.dev currently dispatches OCI image references to Docker, Kubernetes, or
managed compute. AgentOS is not assumed to pull and run those images. The
Flarex AgentOS adapter therefore resolves a Flarex content-addressed artifact,
not a Trigger image.

The initial supported profile should be deliberately narrow:

- JavaScript or TypeScript compiled to JavaScript;
- dependencies proven compatible with the selected AgentOS environment;
- no native Node addon promise;
- no arbitrary Linux package or container-image promise;
- explicit assets only;
- bounded payload, result, log, and source-map behavior; and
- one fresh or proven-reset runtime per attempt.

Native addons, browsers, ffmpeg, database engines, package-install scripts, and
arbitrary executables require separate capability profiles or a different full
sandbox host. They must fail at analysis/deployment rather than fail
unpredictably during a production run.

Secrets are never included in the artifact. A trusted host injects only the
short-lived capabilities and environment values authorized for that attempt.

## Shared Function Runtime

### Share Semantics, Not Host Claims

The existing host-neutral runtime direction should be extended only through its
own roadmap and preflight. A future shared Flarex runtime may own:

- strict function lookup by pinned metadata;
- argument and return validation;
- a per-invocation function registry;
- Flarex context construction;
- nested Flarex calls;
- task, wait, logging, and cancellation ports where applicable;
- result normalization;
- user-code failure classification; and
- trace-context propagation.

Host adapters retain:

- module materialization and hash verification;
- isolation and ambient-global restrictions;
- transport and serialization;
- process, timer, signal, and subprocess lifecycle;
- resource limits;
- cancellation translation;
- host-specific logging boundaries; and
- deterministic cleanup.

The proposed shape is:

~~~text
@flarex/function-runtime
  shared invocation semantics

@flarex/runtime-cloudflare
  Dynamic Worker host adapter

@flarex/runtime-agentos
  AgentOS host adapter

direct invocation controller
  actions

durable invocation controller
  tasks, attempts, waits, heartbeats, cancellation
~~~

The AgentOS host does not weaken the existing rule that Cloudflare production
evidence is required for Dynamic Worker isolation, module freshness, Worker
Loader behavior, and RPC lifecycle.

### Share Runtime Code, Not Live Tenant State

Actions and durable tasks may use the same AgentOS runtime implementation and
artifact projection. They should not initially reuse one live environment
across unrelated tenants or artifacts.

The safe first policy is one attempt, one environment, one artifact, one
short-lived capability, followed by termination. Warm reuse is a later
optimization and must prove cleanup of:

- environment variables and credentials;
- temporary files and mounted state;
- module-level mutable state;
- open sockets and child processes;
- timers and asynchronous work; and
- logging or trace context.

A future warm-pool key would need at least tenant, deployment, artifact, and
runtime-profile identity. Pooling is not part of the initial correctness proof.

## Durable Engine Boundary

### Internal Contract

The durable engine should consume Flarex-owned commands rather than public
Trigger.dev request types.

~~~ts
interface DurableRunEngine {
  trigger(command: DurableRunCommand): Promise<RunHandle>;
  cancel(runId: string): Promise<void>;
  resume(waitpointId: string, value: unknown): Promise<void>;
}

interface WorkloadProvider {
  start(attempt: ExecutionAttempt): Promise<WorkloadHandle>;
  terminate(workloadId: string): Promise<void>;
}

interface ArtifactProvider {
  resolve(artifactId: string): Promise<ExecutionArtifact>;
}
~~~

The exact interfaces remain unresolved. They illustrate three separate
authorities:

- the run engine owns durable orchestration;
- the workload provider owns compute lifecycle; and
- the artifact provider owns immutable code resolution.

### Behavior Worth Porting

The Trigger.dev-derived execution vertical is valuable for:

- run and attempt state transitions;
- queue admission and fair selection;
- environment, task, and custom concurrency limits;
- retry backoff;
- parent and child runs;
- cancellation and timeout propagation;
- waitpoints and durable sleeps;
- batches;
- heartbeats and stalled-attempt handling;
- Supervisor reconnect and redelivery behavior;
- run timeline events; and
- OpenTelemetry-oriented tracing.

Ported behavior must retain or improve its decisive tests. Existing code is
evidence, not automatic authority. Every interaction with FlarexDB's existing
attempt, outbox, or production redelivery domains requires an explicit
duplicate-authority review.

### Persistence Placement

A possible future control-plane separation is:

~~~text
flarex control plane
  tenants
  projects
  deployments
  artifact catalog
  function catalog

FlarexDB data plane
  scope clocks
  rows and revisions
  OCC dependencies
  commits and outcomes
  change feed and transactional outbox

durable orchestration
  runs and attempts
  queues and schedules
  waitpoints and dependencies
  execution events and snapshots
~~~

The durable engine may initially retain Redis for operational queues and locks
while PostgreSQL owns durable run state. Replacing Redis with Cloudflare
coordination is a separate design problem. A nominal Redis API adapter is not
enough: queue ordering, blocking dequeue, visibility, atomic scripts, locks,
backpressure, and worker-loop lifetimes must be re-proven.

## AgentOS Compute Adapter

The Supervisor's compute seam can be modeled as a workload provider. A future
AgentOS implementation would:

1. receive an already-authorized execution attempt;
2. resolve and verify the pinned Flarex artifact;
3. create a bounded AgentOS environment;
4. make the artifact available without granting artifact-store authority to
   user code;
5. inject the attempt identity, trace context, runtime policy, and short-lived
   Flarex capabilities;
6. start the Flarex AgentOS bootstrapper;
7. maintain heartbeat, cancellation, timeout, and result channels;
8. report terminal or lost outcomes to the durable engine; and
9. deterministically terminate or reset the environment.

The adapter is small only if AgentOS supports the required worker assumptions.
A proof must cover module loading, Node compatibility, subprocess behavior if
used, IPC if used, signals, timers, outbound networking, filesystem semantics,
source maps, cancellation, resource enforcement, and cleanup.

If the existing Trigger managed controller and worker can run correctly inside
AgentOS, they may be used as a temporary private bridge. Otherwise Flarex should
implement a native durable controller against the same run protocol. The public
SDK and artifact format must not depend on that choice.

Trigger checkpoint or CRIU semantics are not assumed to work in AgentOS.
Durable waits should first be represented by persisted engine state and a later
fresh attempt. Warm process snapshots are a separate optimization.

## Failure And Delivery Semantics

The proposed system provides durable orchestration, not magical exactly-once
external side effects.

- Dispatch from a committed mutation is at least once and idempotently consumed.
- A run has one logical identity and may have multiple execution attempts.
- An attempt may become ambiguous after performing an external side effect but
  before recording completion.
- Automatic retry is safe only when the task or external operation is
  idempotent, fenced, or protected by a provider idempotency key.
- Cancellation is cooperative until the compute host proves termination.
- A timeout or lost heartbeat does not prove that an external side effect did
  not occur.
- Parent completion, child waits, and batch joins require durable engine state,
  not in-memory promises.
- Run completion must not directly mutate FlarexDB application rows outside a
  normal authenticated Flarex mutation.

The SDK and dashboard should expose attempt history and ambiguity instead of
presenting every retry as exactly-once execution.

## Security And Trust Boundaries

- User code receives no Postgres, Hyperdrive, Drizzle, Redis, R2, Docker, or
  AgentOS management handle.
- Artifact IDs, run IDs, and attempt IDs are locators, not authority.
- Every attempt receives bounded, short-lived, audience-specific capabilities.
- The host validates tenant, project, deployment, scope, artifact, function,
  run, attempt, and runtime pins before executing code.
- Artifact bytes and manifests are content-verified before import.
- AgentOS networking and filesystem access follow declared capability policy.
- Secrets are delivered at execution time and redacted at log boundaries.
- User logs, exceptions, metadata, payloads, and results require explicit size,
  retention, and redaction policies.
- Runtime reuse across tenants is rejected until isolation and cleanup are
  decisively proven.
- The orchestration service never receives FlarexDB transaction authority merely
  because a task originated from a mutation.

## Observability And Dashboard

Flarex should own a unified identity chain:

~~~text
tenantId
projectId
deploymentId
scopeId
artifactId
functionId
runId
attemptId
traceId
optional originating commitSeq
~~~

The dashboard may adapt Trigger.dev run-list, run-detail, timeline, span, log,
retry, queue, and concurrency concepts. It must read Flarex-owned APIs and
identity models rather than preserving duplicate Trigger organizations,
projects, and environments.

A desired trace can connect:

~~~text
HTTP request
  -> Flarex mutation
  -> committed task command
  -> durable run
  -> AgentOS attempt
  -> external API call
  -> later Flarex mutation
  -> FlarexDB commit
~~~

Logs and traces are observability evidence, not durable run-state or app-data
authority.

## Proposed Repository Shape

A possible long-term package arrangement is:

~~~text
apps/
  backend/                 Cloudflare public backend
  executor/                trusted FlarexDB executor Worker
  orchestrator/            Node durable-engine host
  supervisor/              AgentOS workload host

packages/
  flarex/                  public SDK
  flarex-dev/              analysis, codegen, local development
  function-runtime/        host-neutral invocation semantics
  runtime-cloudflare/      Dynamic Worker adapter
  runtime-agentos/         AgentOS adapter and bootstrap
  durable-engine/          Flarex-owned Trigger-derived run engine
  durable-queue/           queue and concurrency implementation
  durable-protocol/        private orchestration protocol
  durable-build/           AgentOS target projection
  observability/           run events, logs, traces, presentation contracts
~~~

This is a responsibility map, not approved package naming or permission to
reorganize the workspace.

## Rejected Or Deferred Alternatives

### Merge The Entire Trigger.dev Product

Rejected as the target. It creates duplicate tenants, projects, deployments,
authentication, billing, artifact authority, public APIs, and dashboard backend
models.

### Expose The Trigger.dev SDK

Rejected. It would make Flarex applications depend on two authoring models and
prevent the Flarex analyzer, generated references, and artifact manifest from
being authoritative.

### Treat One App As One Tenant

Rejected. Tenant/account quotas and ownership, project/application identity,
deployment environments, immutable artifacts, and individual runs are distinct
concerns.

### Run A Durable Task Inside A FlarexDB Transaction

Rejected. Long execution and external side effects are incompatible with a
short exact-snapshot OCC transaction. Tasks call independent Flarex queries and
mutations.

### Reuse FlarexDB Transaction Attempts As Task Attempts

Rejected. Their authority, duration, retry cause, journal, and completion
contracts differ.

### Let AgentOS Pull Trigger OCI Images

Rejected as an assumption. Flarex should emit and resolve its own
content-addressed AgentOS artifact projection.

### Replace Redis With A Cloudflare-Compatible Client Adapter

Deferred and insufficient by itself. The complete queue, lock, visibility,
fairness, backpressure, and worker-lifecycle semantics require redesign and
proof.

### Share Live AgentOS Environments Across Tenants

Deferred until isolation, cleanup, resource accounting, and secret revocation
are proven.

### Promise Arbitrary Node And Native Package Compatibility

Rejected for the first vertical. Unsupported dependencies must be detected
before activation or routed to a separately proven host profile.

## Proposed Adoption Gates

### FDE00 — Research And Inventory

- inspect Convex scheduling, actions, function references, and deployment
  semantics;
- inventory the exact Trigger.dev source commit, licenses, packages, transitive
  dependencies, tests, and Node/Redis/Postgres assumptions;
- compare Trigger run state with existing Flarex exact-attempt and redelivery
  state;
- identify duplicate authorities and classify each imported path as keep, port,
  rewrite, delete, or temporary bridge; and
- test AgentOS against the minimum controller and runtime requirements.

Exit criterion: an accepted preflight identifies one bounded vertical and no
unresolved duplicate state-machine authority.

### FDE01 — Flarex-Owned Contracts

- define execution identity and immutable run target;
- define a private durable command;
- extend authoritative analysis with a proposed task kind without creating
  runtime authority from SDK objects;
- define the AgentOS artifact projection; and
- define typed errors and size limits.

Exit criterion: static fixtures prove one Flarex task maps deterministically to
one validated manifest entry and one private run command.

### FDE02 — One Non-Transactional Manual Task

- retain the existing Flarex deployment and artifact authority;
- create one durable run through a private/manual endpoint;
- launch one fresh AgentOS environment;
- load one pinned artifact and function;
- call one Flarex query and one Flarex mutation;
- report logs and a terminal result; and
- clean up the attempt deterministically.

Exit criterion: a restart-safe integration test proves artifact pinning,
attempt identity, result persistence, duplicate completion handling, and
cleanup.

### FDE03 — Transactional Mutation Dispatch

- add one bounded task-command shape to the accepted FlarexDB outbox/commit
  path through its own approved preflight;
- derive a server-owned idempotency identity;
- dispatch after commit;
- prove rollback produces no task; and
- prove duplicate outbox delivery creates one run.

Exit criterion: PGlite and real-Postgres tests prove atomic intent and
idempotent run creation without a distributed transaction.

### FDE04 — Retry, Cancellation, And Lost Attempts

- port the bounded run-attempt lifecycle;
- prove heartbeat loss, timeout, cancellation, and Supervisor restart;
- classify ambiguous external side effects honestly;
- require retry-safe examples and provider idempotency keys; and
- ensure no orchestration recovery path mints FlarexDB transaction authority.

Exit criterion: fault-injection tests cover crashes before start, during user
code, after side effects, before completion, and during completion persistence.

### FDE05 — Waitpoints And Child Runs

- add durable sleep and external waitpoints;
- add child-run and batch relationships;
- prove parent cancellation and retry behavior;
- resume through fresh attempts rather than assumed process snapshots; and
- bound payload/result retention.

Exit criterion: restart tests prove no in-memory promise, timer, or AgentOS
instance is durable authority.

### FDE06 — SDK And Dashboard Acceptance

- finalize Convex comparison and Flarex divergences;
- expose generated task references and typed client/context methods;
- adapt dashboard presenters to Flarex identities;
- unify trace and run timelines; and
- remove the temporary Trigger compatibility surface.

Exit criterion: a developer uses only Flarex APIs from authoring through
deployment, execution, observation, cancellation, and testing.

### FDE07 — Scale And Optional Optimizations

- measure queue fairness and Redis operational cost;
- decide whether Cloudflare coordination replaces any Redis responsibility;
- evaluate AgentOS warm pools;
- add additional runtime profiles only with compatibility evidence; and
- define retention, usage metering, backpressure, and regional placement.

Exit criterion: performance changes preserve durable state, isolation, fairness,
and recovery invariants under load and fault testing.

## Open Decisions

The following remain deliberately unresolved:

1. Whether action placement is explicit, automatic, or capability-derived.
2. Whether workflow is a separate public function kind or task plus durable
   operations.
3. The exact Flarex task, scheduling, wait, batch, and cancellation API.
4. Whether the first durable engine retains Prisma internally or receives a
   persistence-port extraction first.
5. Whether Redis remains the initial operational queue.
6. The control-plane tenant/workspace schema and quota authority.
7. Scope epoch and deployment deletion behavior for already-created runs.
8. AgentOS support for every required Node, IPC, signal, network, and filesystem
   behavior.
9. The initial payload, result, log, trace, and artifact size limits.
10. Warm-pool eligibility and reset evidence.
11. The permanent location and naming of Trigger-derived code.
12. Which Trigger dashboard components are reusable without carrying its
    backend data model.

## Acceptance Conditions For This Direction

This direction should be accepted only if a proof shows all of the following:

- Flarex remains the sole public SDK, identity, deployment, and artifact owner;
- FlarexDB remains the sole authoritative committed app-data store;
- no Trigger-derived run state competes with FlarexDB transaction attempts or
  production redelivery;
- the transactional handoff is atomic intent plus idempotent dispatch;
- one run always pins one exact artifact and function;
- AgentOS can execute the bounded runtime profile with deterministic cleanup;
- retries and ambiguous external side effects are represented honestly;
- user code receives only restricted Flarex capabilities;
- Cloudflare and AgentOS adapters share semantics without claiming identical
  host guarantees; and
- the first vertical can be implemented and tested without importing the
  complete Trigger.dev product.

Until these conditions pass an explicit implementation preflight, this note
remains a future proposal only.
