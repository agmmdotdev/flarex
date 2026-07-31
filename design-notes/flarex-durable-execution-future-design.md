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

## Shared Domain Execution Substrate

### One Mechanism Layer, Multiple Semantic Owners

The same durable engine can support Flarex application tasks, AI agents,
Payload jobs, and Medusa asynchronous work. It should standardize execution
mechanics without pretending that every domain has the same workflow meaning.

~~~text
Flarex task adapter ---------+
AI agent adapter ------------+
Payload jobs adapter --------+--> shared durable engine
Medusa workflow adapter -----+        -> Supervisor
                                      -> AgentOS
~~~

The shared engine may own:

- durable run and attempt identity;
- queues, scheduling, fairness, and concurrency;
- retry timing, timeouts, and cancellation transport;
- heartbeats and lost-attempt handling;
- durable waits, signals, child runs, and batches;
- compute placement and workload lifecycle;
- generic payload, result, and event persistence; and
- run timelines, logs, traces, and usage measurements.

Domain adapters retain:

| Domain | Semantic owner |
| --- | --- |
| Flarex | Generated references, task API, artifacts, transactional dispatch, and FlarexDB calls |
| AI agents | Agent loop, model/tool policy, memory, approvals, budgets, and step journal |
| Payload | Payload task/workflow configuration, restoration rules, job access, and compatibility API |
| Medusa | Commerce workflow graph, step state, compensation, module access, and transaction meaning |

The durable engine executes work reliably. It does not decide what a model tool
call means, when a Payload task output is restorable, or which Medusa
compensation must run.

A possible private command family is:

~~~ts
type DurableRunCommand =
  | {
      kind: "flarex-task";
      functionId: string;
      artifactId: string;
      input: Json;
    }
  | {
      kind: "agent-run";
      agentId: string;
      artifactId: string;
      input: Json;
    }
  | {
      kind: "payload-task";
      taskSlug: string;
      artifactId: string;
      input: Json;
    }
  | {
      kind: "medusa-workflow-step";
      workflowId: string;
      transactionId: string;
      stepId: string;
      direction: "invoke" | "compensate";
      artifactId: string;
      input: Json;
    };
~~~

This union is illustrative only. Domain-specific identifiers are locators and
correlation evidence, not authority. Every adapter must validate and project a
bounded private command through its owning trust boundary.

### AI Agent Runs

The durable engine is a strong substrate for AI agents because agent execution
naturally needs:

- long-running and multi-step runs;
- model and tool-call retries;
- concurrency and rate limits;
- human approval waitpoints;
- cancellation and budget enforcement;
- child agents and parallel tool work;
- resumability after host failure; and
- detailed traces, token usage, and cost accounting.

It does not replace an agent framework. A Flarex agent domain must still own:

- agent instructions and model selection;
- message and conversation state;
- tool registration and authorization;
- context and memory construction;
- structured-output validation;
- model fallback and loop termination;
- token, cost, elapsed-time, and tool budgets;
- human approval policy; and
- model- and tool-specific failure classification.

Every expensive or externally visible step should have durable identity and
outcome evidence:

~~~text
agent run
  -> model call 1: completed
  -> tool call 1: completed
  -> model call 2: completed
  -> approval wait: suspended
  -> model call 3: pending
~~~

Retrying a whole AgentOS attempt must not automatically repeat already accepted
model calls, charge the same token work again, or invoke completed tools twice.
The agent layer therefore needs a step journal or child-run mapping above the
generic run engine.

Model calls are usually safe to repeat only from a business-correctness
perspective, not from cost or user-experience perspectives. Tool calls may
produce irreversible external effects. Each step needs an explicit restoration,
idempotency, or replay policy.

Agent-specific observability should extend the common run timeline with:

- model provider and model identity;
- request and response identifiers;
- prompt, completion, cached, and reasoning token counts where available;
- latency, retries, and provider rate-limit evidence;
- tool name, call identity, approval state, and result size;
- per-step and aggregate cost; and
- redacted prompt, output, and error policy.

Secrets, raw prompts, tool arguments, and model outputs must not be logged by
default merely because the durable engine supports metadata and traces.

### Payload Jobs Adapter

Payload currently provides its own Jobs Queue with tasks, workflows, jobs,
named queues, retries, schedules, cancellation, persisted task outputs, and
workflow restoration. Jobs are stored in the Payload database's payload-jobs
collection and can be processed by a dedicated process, cron-triggered command,
HTTP endpoint, or Local API.

Current upstream behavior should be verified against:

- [Payload Jobs Queue](https://payloadcms.com/docs/jobs-queue/overview);
- [Payload tasks](https://payloadcms.com/docs/jobs-queue/tasks);
- [Payload workflows](https://payloadcms.com/docs/jobs-queue/workflows);
- [Payload jobs](https://payloadcms.com/docs/jobs-queue/jobs); and
- [Payload queues](https://payloadcms.com/docs/jobs-queue/queues).

The target Flarex integration should preserve Payload-facing authoring where
Payload compatibility is promised:

~~~ts
await payload.jobs.queue({
  task: "generateImageVariants",
  input: { imageId },
});
~~~

Internally, the Payload adapter can translate a registered task, workflow,
queue, schedule, retry policy, and invocation into Flarex artifact metadata and
one or more private durable commands.

~~~text
Payload config and handler
  -> Flarex authoritative analysis
  -> Payload-compatible function metadata
  -> Flarex artifact projection
  -> Payload job adapter
  -> shared durable engine
  -> AgentOS
  -> Payload task context
~~~

Payload's public config is not downstream runtime authority by itself. The
backend-controlled analyzer must verify task/workflow identity, handler
location, schemas, queue policy, and runtime projection before activation.

The difficult compatibility question is job-state authority. Payload expects
job records to be queryable through payload-jobs, while the proposed shared
engine has Flarex-owned run and attempt state. The permanent system must choose
one authority:

1. Flarex run state is authoritative and Payload job APIs are projections over
   it.
2. Payload job state is authoritative and the shared engine operates through a
   strict Payload persistence adapter.
3. Both are writable authorities synchronized through a bridge.

Option 3 is rejected as the permanent target because state can disagree about
queue admission, retries, cancellation, step completion, or terminal outcome.

The leading direction is Flarex orchestration as authority with a
Payload-compatible API and read model. If strict compatibility requires a
payload-jobs collection, it should be an explicitly owned projection or facade,
not an independently writable execution state machine. The precise choice
requires source inspection and compatibility inventory before acceptance.

Payload workflows restore completed task outputs and rerun their handler while
returning cached results for previously completed tasks. The adapter must
preserve that observable behavior. It may map workflow tasks to child runs or
a domain journal, but it must not silently reinterpret restoration as a generic
whole-run retry.

Payload cancellation currently allows an executing task to finish and prevents
later tasks from running. A Flarex adapter may eventually provide stronger
compute cancellation, but it cannot claim compatibility if it changes the
observable completion and restoration behavior without an explicit divergence.

### Medusa Workflow Adapter

Medusa currently has a built-in workflow system for multi-system commerce
operations. It tracks workflow and step state, supports retry configuration,
asynchronous steps, subscriptions, and compensation functions that reverse
already-completed work after failure.

Current upstream behavior should be verified against:

- [Medusa workflows](https://docs.medusajs.com/learn/fundamentals/workflows);
- [Medusa long-running workflows](https://docs.medusajs.com/learn/fundamentals/workflows/long-running-workflow);
- [Medusa Workflow Engine Module](https://docs.medusajs.com/resources/infrastructure-modules/workflow-engine);
- [Medusa Redis Workflow Engine Module](https://docs.medusajs.com/resources/infrastructure-modules/workflow-engine/redis); and
- [Medusa scheduled jobs](https://docs.medusajs.com/learn/fundamentals/scheduled-jobs).

Medusa's default Workflow Engine Module is in-memory. Its production
recommendation is the Redis module, which uses Redis and BullMQ for tracking,
retries, timeouts, and scheduled workflow work. Medusa also documents the
Workflow Engine Module as replaceable by a custom mechanism or third-party
service. That is the likely integration seam.

The target should preserve Medusa authoring and commerce meaning:

~~~text
Medusa workflow and steps
  -> Medusa workflow-semantic adapter
  -> shared durable primitives
  -> AgentOS step execution
  -> Medusa module/repository operations
  -> invoke or compensate decision owned by Medusa semantics
~~~

The generic run engine may persist and execute steps, but the Medusa adapter
must own:

- workflow graph and step identity;
- invoke versus compensate direction;
- step inputs, outputs, and idempotency keys;
- compensation registration and reverse ordering;
- asynchronous-step success and failure signals;
- Medusa module/container access;
- commerce transaction boundaries; and
- workflow subscriptions and compatibility results.

A generic retry is not a Medusa compensation. For example:

~~~text
reserve inventory
  -> authorize payment
  -> create fulfillment
  -> failure
  -> compensate payment
  -> release inventory
~~~

The durable engine can schedule and observe those operations, but only the
Medusa workflow layer can decide the correct compensation graph and commerce
meaning.

The easiest initial Medusa integrations are non-core asynchronous work:

- scheduled jobs;
- event-subscriber background work;
- product or inventory imports;
- ERP, search, and CMS synchronization;
- email and notification delivery;
- media processing;
- analytics and cleanup; and
- abandoned-cart processing.

Core Medusa workflows require either:

1. a Flarex-backed implementation of the Medusa Workflow Engine Module contract;
   or
2. a carefully proven translation from the Medusa step graph and compensation
   protocol into Flarex durable primitives.

Running an entire Medusa Redis/BullMQ workflow inside one Flarex durable task is
acceptable only as a temporary compatibility bridge. It creates nested
authorities for retries, cancellation, timeouts, step completion, stored
outputs, and observability. The bridge must name its consumer and deletion
condition.

This proposal also preserves the accepted FlarexDB rule that Medusa commerce
uses a separate trusted transaction lane. The durable engine does not turn
Medusa writes into generic ctx.db writes and does not introduce an atomic
ctx.db plus ctx.commerce promise.

### Avoid Nested Durable Engines

The permanent architecture should not be:

~~~text
Flarex durable run
  -> Payload job runner
      -> Payload workflow retries
~~~

or:

~~~text
Flarex durable run
  -> Medusa Redis workflow
      -> BullMQ retry and timeout worker
~~~

Nested engines create competing answers to:

- which attempt is active;
- which retry count is authoritative;
- whether cancellation succeeded;
- whether a step completed;
- whether an external side effect is ambiguous;
- which timeout applies;
- which output should be restored;
- when compensation should begin; and
- which dashboard represents the truth.

A temporary bridge may wrap an upstream engine to prove packaging and runtime
compatibility, but only one engine should own durable execution state in the
accepted target. Domain adapters own semantics; the shared engine owns
mechanics.

### Domain Integration Order

The proposed order is:

1. Flarex-native durable tasks establish the generic engine and AgentOS
   vertical.
2. AI-agent runs add step journaling, budgets, approvals, and model/tool
   observability.
3. Payload single tasks and schedules validate framework task adaptation.
4. Payload workflows add restoration and compatibility read models.
5. Medusa scheduled jobs and subscriber work validate commerce-hosted
   background execution without replacing workflow semantics.
6. A Medusa Workflow Engine Module adapter proves step state, async signals,
   retries, compensation, subscriptions, and recovery.
7. Upstream duplicate runners and stores are removed only after compatibility
   and fault-injection evidence passes.

The first vertical must not include all four domains. Shared architecture is a
destination; each adapter requires a separate proportional preflight and proof.


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

### FDE08 — Domain Adapters

- add AI-agent step journaling, approval waits, cost budgets, and model/tool
  observability above the generic run engine;
- adapt Payload single tasks before workflows and choose one authoritative job
  state;
- preserve Payload restoration, cancellation, queue, and generated-type
  behavior through compatibility tests;
- adapt Medusa scheduled and subscriber work before core workflows;
- implement or port the Medusa Workflow Engine Module boundary without losing
  compensation, async-step, subscription, or idempotency semantics; and
- retire every nested-engine bridge only after restart, retry, cancellation,
  restoration, compensation, and observability parity is proven.

Exit criterion: each enabled domain has one durable execution authority,
domain-correct restoration or compensation behavior, one observable run
identity, and no remaining unowned duplicate job state.

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
13. Whether Payload compatibility requires a physical payload-jobs projection
    or only API-level compatibility.
14. The exact Medusa Workflow Engine Module surface that can be backed by
    Flarex durable primitives without preserving Redis/BullMQ execution.
15. Whether AI agent steps are child runs, a domain journal, or a hybrid, and
    which layer owns model/tool replay and cost restoration.

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
  complete Trigger.dev product;
- Payload and Medusa integrations preserve their public domain semantics while
  using only one durable execution authority; and
- AI-agent retries cannot silently repeat accepted model costs or externally
  visible tool effects.

Until these conditions pass an explicit implementation preflight, this note
remains a future proposal only.
