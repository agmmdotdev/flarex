# DTE06 Runtime Kernels And Provider Placement Preflight

Status: accepted docs-only architecture checkpoint before DTE06-F3; no code,
contract, schema, deployment, or external-resource change is authorized.

Evidence snapshot: 2026-08-27 current repository state after private DTE06-F2.

## Decision

Flarex should share the low-level Application runtime substrate while retaining
three operation-specific runtime kernels:

```text
Application runtime substrate
  -> transaction runtime kernel -> QuerySystem / MutationSystem
  -> action runtime kernel      -> ApplicationActionSystem
  -> task runtime kernel        -> TaskComputeProvider / Task supervision
```

The Task kernel remains provider-neutral. Worker Loader is its first real
private provider, not its permanent product identity. A future Node runtime,
AgentOS runtime, container runtime, or another approved backend must implement
the Task compute boundary without gaining Task lifecycle, database, deployment,
or application-selection authority.

This is not a decision to create one universal Query/Mutation/Action/Task
runtime service. Shared mechanics and operation authority are different things.

## Why This Checkpoint Exists

The first private Task vertical correctly reused the existing Application
Worker machinery. That proved real execution without inventing a second
materializer or executor. Current source inspection also shows that the broader
runtime refactor is already substantially complete and must not be repeated:

- Roadmap 40 is closed after the exact Query, Mutation, internal-call, and
  Action profiles adopted dedicated runtime kernels plus Function API Core;
- `ApplicationWorkerRuntime` already owns the plain multi-instance Worker
  Loader code projection and entrypoint-acquisition seam shared by foreground
  execution and accepted Task sessions;
- the connected `ApplicationWorkerDefinition` path still provides Transaction
  and Action entrypoints over the combined Application Worker core where that
  private path remains selected;
- the Task Worker has its own `FlarexApplicationTaskWorker` entrypoint, runtime
  target, host policy, start-session ABI, interruption, and settlement path;
- `ApplicationTaskWorkerDefinition` currently embeds the same
  `APPLICATION_WORKER_CORE_SOURCE` used by that connected foreground path; and
- the Task runtime context currently admits only `runQuery` and `runMutation`.

That is a valid first provider implementation. It is not evidence that all
operations should share one full runtime, that every Task must remain a
Cloudflare Dynamic Worker, or that a longer-lived process is itself durable.
It is also not authority to reopen the closed exact-runtime/Function API Core
work or split `ApplicationWorkerCore` incidentally.

## Current Implemented Boundaries

| Concern | Current implementation | Authority conclusion |
| --- | --- | --- |
| Function API Core and exact profiles | Dedicated exact Query, Mutation, internal-call, and Action kernels share portable capability primitives under Roadmap 40 | Closed accepted foundation; do not create a parallel core |
| Worker Loader seam | `ApplicationWorkerRuntime` shares exact code projection and fresh entrypoint acquisition across foreground and Task execution | Existing runtime substrate; plain multi-instance value by design |
| Connected Transaction and Action path | `ApplicationWorkerDefinition` retains separate Transaction and Action entrypoints over its current combined core | Existing private behavior; not a reason to collapse operation authority |
| Task definition | `ApplicationTaskWorkerDefinition` creates a distinct Task entrypoint with Task target/profile/duration policy | Task kernel is already a distinct execution mode |
| Task execution | `WorkerLoaderTaskComputeProvider` resolves the trusted launch, loads a fresh Worker, and returns an accepted session | Worker Loader is one provider adapter |
| Task compute port | `TaskComputeProvider` exposes provider-neutral `dispatch` and `requestCancellation` operations | The port is not Query/Mutation execution and does not own completion |
| Task callbacks | The Task context exposes authenticated `runQuery` and `runMutation` bridges | Every callback remains an independent owned invocation/transaction |
| Task durability | PostgreSQL lifecycle, attempts, leases, fences, retries, requested effects, result publication, and settlement remain authoritative | No runtime provider may replace or bypass these owners |

Provider acceptance means only that the exact execution target accepted the
correlated attempt. It never means that the Task completed durably.

## Accepted Runtime Decomposition

### Shared Application Runtime Substrate

The shared substrate may own exact, operation-neutral mechanics such as:

- immutable source/runtime-object loading and digest verification;
- runtime module-graph construction and generated shell mechanics;
- Worker Loader materialization and fresh-load isolation;
- host-policy projection and bounded resource configuration;
- narrow RPC transport, envelope codecs, and callback plumbing;
- structured cancellation/interruption transport;
- resource cleanup, session joining, and host-scope shutdown mechanics; and
- privacy-safe execution evidence.

The substrate must not own function visibility, query snapshot rules, mutation
OCC/journals, Action side-effect policy, Task lifecycle transitions, scheduling,
retry decisions, or terminal settlement.

### Transaction Runtime Kernel

The transaction kernel serves Query and Mutation execution. It retains:

- direct database capability only through the existing transaction/executor
  owners;
- Query read-snapshot and Mutation OCC/commit semantics;
- current function resolution, visibility, argument, and result validation; and
- current bounded transaction execution and response contracts.

Query and Mutation are not dispatched through `TaskComputeProvider`.

### Action Runtime Kernel

The Action kernel serves independently invokable foreground external-I/O work.
It retains:

- request/response invocation identity;
- Action host policy, egress, deadline, and resource limits;
- callback access to ordinary Query/Mutation invocations; and
- Action-specific uncertainty and idempotency policy for external effects.

Action may share loader, sandbox, callback, outbound, and cleanup mechanics with
Task. This does not give Action a Task run, attempt, lease, fence, retry, wait,
or eventual-result lifecycle.

The accepted Action placement direction remains in
[`../../../design-notes/flarex-dynamic-worker-bundle-partitioning.md`](../../../design-notes/flarex-dynamic-worker-bundle-partitioning.md):
developers declare runtime semantics, while trusted platform configuration maps
those semantics to concrete providers.

### Task Runtime Kernel

The Task kernel serves one durably granted attempt. It retains:

- exact run, attempt, fence, cancellation generation, runtime target, compute
  profile, maximum duration, and provider execution identity;
- accepted-session, heartbeat, interruption, cleanup, and settlement transport;
- narrowly admitted Task context capabilities;
- compatibility with provider loss and fresh-host recovery; and
- the rule that Task results become durable only through the Task-owned result
  and lifecycle owners.

The Task kernel must not receive raw Postgres, Drizzle, task tables, application
selection, deployment administration, provider credentials, or a transaction
that spans Task callbacks.

## Runtime Profiles And Trusted Placement

Developer intent should describe semantic capability, not a vendor:

```text
Task definition/runtime target
  -> immutable semantic compute profile
  -> trusted placement policy
  -> approved provider adapter and provider version
  -> scoped execution session
```

The following rules are accepted:

1. A Task definition selects an admitted compute profile, not `cloudflare`,
   `aws`, `agentos`, or another provider name.
2. Publication/readiness binds the immutable Task runtime target to the profile
   and compatible runtime ABI. A caller cannot choose a provider per run.
3. Trusted host configuration resolves the profile to an approved provider.
4. The accepted execution records the exact provider descriptor and execution
   identity already required by the compute contract.
5. Retry and recovery preserve the immutable application revision, Task runtime
   target, and compatible semantic profile. They must not silently change
   runtime semantics.
6. A provider upgrade or placement migration applies through a new immutable
   activation/runtime target or an explicitly compatible provider revision; it
   does not mutate the meaning of an existing run.
7. Oversize, unsupported, or incompatible targets fail readiness or dispatch
   with typed evidence. There is no silent spill, fallback, or dual execution.

If a runtime exposes Node-specific APIs, native modules, a filesystem, agent
tools, or another non-portable capability, that difference belongs in an
explicit semantic profile and versioned wire/runtime contract. It cannot be
hidden behind the same profile as the Worker-compatible runtime.

## Provider Composition And Effect Lifetimes

The existing `TaskComputeProvider` service is correct for a composition that
selects one concrete provider. Multi-provider placement must not turn it into a
single process-wide union service or place dynamic execution sessions in
singleton `Context` tags.

The future composition direction is:

```text
long-lived host scope
  -> trusted Task placement policy/directory
     -> select provider for immutable runtime target
        -> acquire scoped provider/session value
           -> dispatch / cancel / join / close
```

Rules:

- long-lived hosts acquire their Effect runtime and stable directory once;
- request, attempt, callback, and transaction values remain request/scoped
  values rather than ambient globals;
- dynamically repeated or simultaneous provider instances are plain or scoped
  values returned by a directory/factory;
- `Scope` owns provider clients, execution sessions, fibers, cancellation
  bridges, deadlines, and cleanup;
- Layers own construction, requirement closure, startup gates, acquisition, and
  release, not business execution; and
- shutdown stops admission, interrupts or hands off owned sessions according to
  their contract, joins cleanup, and releases dependencies in order.

The exact placement API and any new persisted target/profile contract require a
separate implementation preflight. This document does not name or authorize
those public or wire types.

## Control, Callback, Data, And Projection Planes

The provider boundary must keep these planes separate:

| Plane | Purpose | Authority rule |
| --- | --- | --- |
| Compute control | Dispatch and cancellation requests/receipts | Provider acceptance is not lifecycle completion |
| Runtime session | Interruption, heartbeat evidence, terminal outcome, join, and cleanup | Task supervisor interprets evidence; lifecycle owner commits transitions |
| Application callbacks | Authenticated `runQuery` and `runMutation` calls | Each call uses its existing Application authority and independent transaction |
| Immutable data | Source/runtime target, Task input, and successful result objects | Existing content, size, digest, and publication owners remain authoritative |
| Observability/output | Logs, traces, progress, and future output streams | Projections only; never transition authority |

Task should not gain a broad `runAction` merely because the Action runtime
exists. A future durable external-effect API must define effect identity,
idempotency, uncertainty, replay, redaction, and reconciliation through a
separate approved ledger/contract.

## Remote Provider Trust Boundary

Any Node, AgentOS, container, or remote hosted provider must satisfy at least:

- a short-lived authenticated capability bound to scope, run, attempt, fence,
  runtime target, provider target, and deadline;
- exact source/dependency references or bounded content-addressed access, never
  raw database or infrastructure credentials;
- host-owned authorization for every Query/Mutation callback;
- stale-fence and cancellation-generation rejection;
- bounded request, result, callback, log, trace, and error envelopes;
- explicit secret, environment, egress, filesystem, native-module, and tool
  policy for the selected semantic profile;
- typed classification of pre-acceptance failure, accepted-but-uncertain loss,
  provider rejection, timeout, cancellation, and malformed evidence;
- provider loss recovery through persisted Task authority, not provider memory;
  and
- privacy-safe receipts and deterministic teardown evidence.

The remote process may remain alive for a long time. It still does not become
the durable source of truth.

## What “Long Running” Means

An approved Task provider may allow user code to execute continuously for a
larger bounded duration while the provider is healthy. Flarex durability means
that the platform can recover the Task lifecycle after total provider loss. It
does not mean that Flarex can restore an arbitrary JavaScript stack, open
socket, local filesystem mutation, or in-memory agent state.

Durable sleep/wait, checkpoints, child Tasks, signals/events, batches, and
exactly-once-looking external effects each require explicit persisted semantics
and separate preflights. They must not be simulated by keeping one Node or
AgentOS process alive indefinitely.

## Required Delivery Order

No implementation is authorized by this document. If separately approved, the
safe order is:

1. retain Roadmap 40's Function API Core, exact operation kernels, and
   `ApplicationWorkerRuntime` as the current shared foundations;
2. add a production-inert Task provider router that maps immutable compute
   profiles to plain provider instances and routes cancellation by the accepted
   provider descriptor;
3. prove fail-closed routing, exact provider correlation, method ownership, and
   unchanged `TaskComputeProvider` request/error/receipt contracts;
4. adapt the current Worker Loader provider into a routed host composition only
   in a later separately approved wiring slice;
5. preflight and implement one Node Task provider as its own bounded slice;
6. preflight AgentOS/agent-tool capabilities separately from generic Node
   execution; and
7. design new Task authoring/context APIs only after their durable semantics and
   authority owners are accepted.

The router does not require a new persisted runtime-profile contract: the
current dispatch request already carries the immutable compute profile, while
the accepted execution already carries provider name and version. Any future
change to those wire contracts requires its own versioned preflight.

## Characterization And Admission Gates

A later implementation preflight must preserve or prove:

- exact Query, Mutation, and Action behavior and authority;
- exact Task run/attempt/lease/fence/retry/result behavior;
- separate Transaction, Action, and Task Worker entrypoints;
- current Task context members and callback transaction boundaries;
- immutable source/runtime target and digest checks;
- fresh Worker Loader isolation and provider/session cleanup;
- provider acceptance versus durable completion separation;
- process restart and fresh-host recovery without shared in-memory state;
- no raw database, Task tables, provider credentials, or ambient service bag in
  user code;
- no fallback, comparison provider, dual write, or dual execution;
- package/typecheck, runtime bundle, PGlite, genuine PostgreSQL, Miniflare, lint,
  provenance, and reviewer gates appropriate to the changed slice; and
- explicit Scope/fiber shutdown tests for any new provider composition.

## Non-Goals

This checkpoint does not authorize:

- any TypeScript, JavaScript, schema, migration, wire, route, binding, Wrangler,
  deployment, credential, or external-resource change;
- DTE06-F3/F4 execution or DTE05-E3 scheduled-host work;
- a public `task()` or `action()` API change;
- a Node, AgentOS, container, workflow, or remote-provider implementation;
- new Task context capabilities, `runAction`, checkpoints, waits, signals,
  child Tasks, batches, or output streams;
- changes to Task lifecycle, OCC, commit compilation/execution, journals,
  idempotency outcomes, feeds, outbox behavior, or Application-row semantics;
- replacement of the current Worker Loader provider; or
- a universal runtime service shared by all operation systems.

## Stop Boundary And Next Gate

Stop at this documentation checkpoint. The current private Worker Loader Task
vertical and DTE06-F1/F2 evidence remain unchanged.

The first separately approved code gate is now complete privately in
[`Preflight 48`](./48-dte06-task-compute-provider-router.md): a private,
production-inert provider router with no Worker Loader rewiring. It must leave
the current runtime kernels, Worker definitions, provider adapter, lifecycle,
and F1/F2 evidence unchanged. Node and AgentOS providers remain later,
independent gates.
