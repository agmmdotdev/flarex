# DTE06 Node Task Provider Architecture Preflight

Status: accepted architecture checkpoint on 2026-08-28. The separately
approved N1 runtime-family and immutable artifact-contract gate is complete.
N2 and later gates remain unapproved; no Node provider, session refactor,
callback transport, process, deployment, credential, external resource, or
production activation exists.

Evidence snapshot: 2026-08-28 current repository state after the completed
provider router and private Worker Loader routed composition in Preflights 48
and 49.

## Decision

Add Node execution later as a second Task compute provider, not as a new Task
kind, an Action alias, or a replacement for the Task lifecycle:

```text
task definition
  -> immutable runtime-family-compatible compute profile
  -> immutable Node-compatible Task artifact and runtime ABI
  -> trusted TaskComputeProviderRouter placement
  -> Node Task provider
  -> provider-neutral Node executor client
  -> local, hosted-function, container, or other approved Node adapter
```

The durable API remains `task`. Node describes execution semantics. The
provider name describes trusted deployment placement. Neither becomes a caller
chosen per-run option.

The existing `TaskComputeProvider` dispatch/cancellation ABI remains the outer
compute port. PostgreSQL and the existing Task System owners remain the only
run, attempt, lease, fence, retry, cancellation, result, and terminal-state
authority.

## What Is Ready And What Is Not

The core is ready for a second provider at the control-plane boundary:

- `TaskComputeProviderRouter` routes immutable compute profiles for dispatch
  and accepted provider descriptors for cancellation;
- dispatch and cancellation already carry exact run, requested-effect,
  attempt, fence, lease, cancellation-generation, duration, and runtime-target
  identity;
- provider acceptance is already separate from durable Task completion; and
- the current Worker Loader provider proves real callback, supervision,
  cancellation, settlement, and fresh-host recovery semantics.

The current runtime artifact and session boundary are not Node-ready:

- `TaskRuntimeProjectionModuleFrameV1.sourceEnvironment` is fixed to
  `isolate`;
- the current materialization spec fixes the current Worker runtime profile,
  bridge ABI, module-entry policy, and Worker Loader implementation;
- `ApplicationTaskRuntimeTargetV1` resolves the current isolate source bundle;
- `TaskRuntimeLaunchAuthority` returns that current source/binding rather than
  a Node source/dependency package;
- the current query and mutation callback capabilities are Cloudflare RPC
  targets and cannot be handed to another process or remote provider; and
- `TaskAttemptSupervisor` consumes the Worker-owned `TaskWorkerSession` and
  `TaskWorkerSessionHostError` contract directly.

Therefore a second router route alone would be unsafe. It could select a Node
provider for an isolate artifact and would pressure a remote executor to mimic
Cloudflare RPC and Worker-named session failures.

## Product And API Boundary

| Concern | Accepted owner | Consequence |
| --- | --- | --- |
| Query | Transaction runtime kernel | Direct read capability inside one bounded query transaction |
| Mutation | Transaction runtime kernel | Direct journal/OCC capability inside one bounded mutation transaction |
| Action | Action runtime kernel | Foreground request/response external-I/O operation; no Task lifecycle |
| Task | Task runtime kernel | Durable run/attempt lifecycle dispatched through a compute provider |
| Node | Runtime family | May host a Node Action or Node Task; does not define lifecycle semantics |
| AgentOS | Future Task provider/capability family | Requires a separate tool, checkpoint, secret, and agent-state preflight |

This checkpoint does not add `task` and `action` as two methods on a universal
runtime. Query/Mutation continue through their existing Systems. Action and
Task may reuse low-level bundle, sandbox, callback, transport, and resource
mechanics while retaining different invocation, uncertainty, retry, and
settlement owners.

Public authoring syntax remains deferred. A future source signal such as
`"use node"` is plausible for Node Actions, but this checkpoint does not apply
that file-level Action convention automatically to Tasks. The private Task
definition already selects a compute profile; trusted publication must resolve
that profile to one runtime family and compatible artifact contract before a
run can be created.

## Runtime Family And Compute Profile

Compute profile routing remains the provider-selection input, but a compute
profile is not allowed to hide an arbitrary runtime switch.

The trusted compute-profile catalog must classify every admitted profile by at
least:

- runtime family, initially `isolate` or `node`;
- compatible Task runtime contract and bridge ABI;
- resource class and duration ceiling;
- egress, filesystem, native-module, environment, and secret policy; and
- approved provider descriptors and deployment placement.

Publication/readiness must prove that:

1. the initial compute profile resolves to the same runtime family as the
   immutable Task artifact;
2. every compute profile reachable through out-of-memory escalation resolves
   to that same runtime family and compatible ABI;
3. the selected provider admits the exact profile and artifact family;
4. no provider fallback, spill, comparison execution, or implicit runtime
   conversion exists; and
5. a runtime-family or incompatible ABI change creates new immutable
   publication/readiness evidence rather than mutating an existing run.

This preserves the current provider dispatch wire and router. If the existing
materialization, projection, or binding contracts cannot commit the runtime
family without ambiguity, their owning preflight must introduce a new concrete
wire generation. A profile name convention alone is not sufficient authority.

## Node Artifact Contract

The Node provider must execute an immutable, deployment-ready Node artifact. It
must not transpile arbitrary TypeScript, resolve an unlocked package graph, or
run a package manager during a Task attempt.

The Node artifact boundary must commit:

- the exact Task module and export;
- the Node runtime/ABI compatibility identity;
- the exact bundled application modules;
- a content-addressed external-dependency package when dependencies are not
  included in the bundle;
- package format, architecture, native-module, and module-system policy;
- byte counts and digests for every source/dependency object;
- the compatible compute-profile family; and
- the same Application revision, Task manifest, principal, and input authority
  already bound at run creation.

The executor receives bounded content-addressed objects or short-lived
object-specific download capabilities. It never receives an R2 bucket binding,
arbitrary object key, deployment-admin credential, database credential, or a
mutable source checkout.

Node artifact construction belongs to analysis/publication/readiness. Provider
dispatch consumes the admitted artifact; it does not repair or reinterpret it.

## Provider-Neutral Node Executor Protocol

The Node Task provider owns one backend-private client port with separate live
adapters. Its concrete remote protocol must be versioned because it crosses a
process or network boundary.

The start request must contain only bounded, validated evidence:

- exact Task compute dispatch identity and provider execution ID;
- exact Application Task runtime-target and Node artifact commitments;
- Task module/export identity;
- input reference or one exact-input read capability;
- verified execution principal;
- absolute deadline and resource policy;
- current cancellation projection;
- one short-lived launch capability for callbacks and session reporting; and
- trace/correlation data that contains no raw user body or credential.

The executor protocol must distinguish:

- definite pre-acceptance rejection;
- retryable transport failure before acceptance;
- accepted-but-uncertain start;
- correlated acceptance;
- session heartbeat/health evidence;
- generation-correlated interruption acceptance;
- terminal settlement;
- session loss; and
- cleanup outcome.

The provider maps those results into the existing compute-provider errors and
the transport-neutral Task execution session. It must not turn a lost response
into a definite rejection or manufacture Task completion from provider state.

## Transport-Neutral Execution Session Refactor

Before a real Node provider, extract the semantic session required by
`TaskAttemptSupervisor` from the Worker Loader host:

```text
TaskExecutionSession
  acceptance
  maximumCloseMilliseconds
  requestInterruption(generation-correlated request)
  settlement
  close
```

The extracted capability is an unversioned internal service shape. The
existing Task Worker session ABI and its versioned wire values remain
compatible and the Worker Loader adapter projects them into the new shape.
The Node provider projects its own versioned executor protocol into the same
shape.

The shared session must use provider-neutral typed failures for start,
interruption, settlement, loss, timeout, and cleanup. Worker Loader and Node
adapters classify foreign failures once at their source. The supervisor may
interpret the common session outcome, but it must not gain provider-specific
recovery, transport, deployment, or credential logic.

Dynamic execution sessions remain plain scoped values. They are not Context
singletons. `Scope` owns client resources, callback leases, supervision fibers,
deadline interruption, terminal join, and cleanup. A stable Node executor
client may be a long-lived Effect service/Layer when its implementation and
lifecycle justify that ownership.

## Authenticated Query And Mutation Callbacks

Node user code receives no direct database or Task System capability. Its Task
context may expose only the already admitted `ctx.runQuery` and
`ctx.runMutation` semantics.

The current Application Task query and mutation authorities remain the
authorization and transaction owners. A new transport adapter may expose them
to Node, but it must preserve:

- a short-lived, single-execution launch capability bound to scope, run,
  requested effect, attempt, fence, provider execution, runtime target,
  principal, and absolute deadline;
- active-selection and stale-launch revalidation for every call;
- public/internal function visibility and exact argument/result validation;
- one independent query transaction per `runQuery`;
- one independently owned mutation/OCC transaction per `runMutation`;
- the existing mutation ordinal, stable request identity, contradictory replay
  rejection, and terminal reconciliation;
- bounded call count, concurrency, duration, request, result, and diagnostic
  sizes; and
- revocation and in-flight interruption when the execution settles, is
  cancelled, loses authority, or closes.

The current Cloudflare `RpcTarget` objects are Worker transport adapters, not
the remote callback contract. The Node transport needs strict versioned
request/response codecs plus authenticated private endpoints or an equivalent
provider channel. It must not expose the ordinary public Query/Mutation API as
a callback-token substitute.

`ctx.runAction`, scheduler, storage, arbitrary Task creation, checkpoints,
signals, and tools remain absent.

## Duration, Cancellation, And Recovery

Node permits a larger bounded execution envelope; it does not make an
arbitrary JavaScript stack durable.

- maximum wall duration is the minimum of Task policy, compute-profile ceiling,
  provider ceiling, launch-capability expiry, and host settlement reserve;
- CPU, memory, temporary disk, process, file-descriptor, output, log, callback,
  and concurrency budgets are explicit provider policy;
- cancellation targets the exact accepted provider execution and monotonic
  generation;
- the same cancellation generation is idempotent, a lower generation is stale,
  and an unknown/lost execution is never reported as Task cancellation
  acknowledgement;
- retries redeliver the same dispatch identity until lifecycle authority grants
  a new attempt; and
- fresh-host recovery uses persisted Task/delivery authority plus the
  provider's idempotent execution lookup or start key, never an old process map.

Provider loss may cause lease expiry and a later Task attempt. Flarex does not
restore open sockets, local files, timers, heap state, or the JavaScript stack.
Durable wait, sleep, checkpoints, signals, child Tasks, streams, and agent state
need separate persisted contracts.

## Egress, Filesystem, Native Modules, And Secrets

The first Node implementation remains fail-closed:

- no ambient Internet egress;
- no user secrets or arbitrary environment variables;
- no persistent filesystem;
- no native modules; and
- no child processes or agent tools.

This still proves Node module semantics, a separate process/runtime, longer
bounded work, exact artifacts, callbacks, cancellation, and recovery without
combining external-effect uncertainty with the first provider slice.

Later profiles may admit those capabilities only through separate policy and
security preflights. Egress does not imply exactly-once external effects.
Credentials must be scope/execution bound, least-privilege, redacted, rotated,
and kept separate from provider infrastructure credentials.

AgentOS is not a Node configuration flag. Tool grants, durable agent memory,
model credentials, human approval, prompt/tool audit, checkpointing, and token
streams require their own provider/capability design.

## Deployment Ownership

The Node Task contract stays provider-neutral. AWS Lambda, a self-hosted Node
process, Cloudflare Containers, Kubernetes, or another host is an adapter and
deployment decision.

The first real conformance adapter should be a local isolated Node process used
only for development and system tests. It proves process separation, protocol
decoding, cancellation, cleanup, and callbacks without claiming production
sandbox strength or hosted reliability. Until a hardened sandbox is separately
proved, that adapter may execute only trusted repository-owned fixtures; it is
not an untrusted-user-code security boundary.

A hosted adapter requires a later provider preflight covering current platform
limits, regions, cold start, networking, concurrency, credentials, package
limits, cancellation behavior, observability, readiness, rollback, cost, and
external resource lifecycle. AWS Lambda remains a useful Convex reference, not
an accepted Flarex dependency or public contract.

## Failure Ownership

| Failure | Owner |
| --- | --- |
| profile/runtime-family mismatch | publication/readiness; fail before activation or dispatch |
| Node artifact missing, corrupt, oversize, or incompatible | artifact/launch authority |
| unsupported profile or disabled provider | Node Task provider typed rejection |
| executor transport fails before known acceptance | Node adapter retryable transport failure |
| start response lost after possible acceptance | Node provider uncertain start; same-identity recovery |
| callback token stale, revoked, replayed, or mismatched | callback gateway fail-closed rejection |
| query/mutation fails | existing Application Query/Mutation owner and callback envelope |
| user handler fails or returns invalid output | execution session terminal settlement |
| executor disappears after acceptance | session loss; Task lease/fresh-host recovery remains authoritative |
| cancellation cannot locate exact execution | provider cancellation rejection/uncertainty, never acknowledgement |
| lease/fence becomes stale | Task lifecycle owner; close runtime without lifecycle invention |
| hosted platform outage or quota | hosted adapter typed transient/terminal classification |

## Ordered Delivery Gates

N1 was separately approved and completed. The remaining gates still require
separate approval and retain this safe order:

1. **N1 — runtime-family and artifact contract:** define the private trusted
   compute-profile catalog semantics and Node-compatible immutable Task
   artifact/publication/readiness contract; prove isolate artifacts cannot be
   routed to Node and escalation cannot switch runtime family;
2. **N2 — execution-session seam:** extract the minimum provider-neutral
   `TaskExecutionSession` consumed by supervision and adapt the current Worker
   Loader provider without changing its behavior or wires;
3. **N3 — Node executor protocol:** add the backend-private Node client port,
   strict versioned protocol, deterministic fake, typed failures, idempotent
   start/cancel/recovery keys, and scoped lifecycle; no real Node process;
4. **N4 — authenticated callback transport:** expose the existing Task query
   and mutation authorities through short-lived launch-bound private transport
   and prove replay, stale fence, revocation, budget, and independent
   transaction behavior;
5. **N5 — local Node conformance:** run one immutable Node Task artifact in a
   local isolated process using trusted test fixtures and no configured
   egress/secrets/native modules/tools, then
   prove success, failure, timeout, cancellation, lost response, process loss,
   callback replay, fresh-host recovery, and cleanup; and
6. **N6 — hosted provider:** select and preflight one concrete production host,
   external resources, rollout, and rollback separately.

Each significant code gate requires focused validation, applicable package and
system tests, `lint:core`, exact diff/staged lint, Effect boundary checks, and
both standing project reviewers against the exact final diff.

## Non-Goals

This checkpoint does not authorize beyond the completed N1 contract slice:

- a runtime-target, callback, provider, session, or deployment wire;
- a local child process, AWS resource, container, route, binding, token issuer,
  secret, or credential;
- a public `task()`/`action()` API or `"use node"` syntax change;
- a Node Action implementation;
- AgentOS, tools, model calls, durable agent memory, checkpoints, signals,
  child Tasks, schedules, streams, or `runAction`;
- outbound network access, native modules, arbitrary environment variables, or
  persistent filesystem access;
- a change to Task lifecycle, retry, scheduling, result, OCC, commit, journal,
  outbox, feed, or Application-row authority; or
- fallback, spill, dual execution, provider racing, or production activation.

## Stop Boundary And Next Gate

Stop after N1. The Worker Loader remains the only real private provider and the
current isolate artifact/session behavior remains unchanged. Node profiles are
explicitly provider-disabled and Node artifact admission reports dispatch as
blocked.

The next separately approved code gate is N2 only: extract the minimal
provider-neutral `TaskExecutionSession` seam and adapt Worker Loader without
changing behavior or versioned wires. Do not begin the Node executor protocol,
callback endpoints, local process, or hosted deployment in that slice.

## N1 Implementation Receipt

Completed on 2026-08-28:

- added a strict, canonical, owned compute-profile catalog that commits runtime
  family, Task runtime/bridge/profile identities, resource-class identity,
  duration ceiling, fail-closed capabilities, and provider placement;
- retained the current isolate ABI and enabled Worker Loader placement while
  defining Node placement as unconfigured and provider-disabled;
- added canonical immutable Node artifact evidence for exact revision,
  candidate, Task manifest, handler, modules, Node ABI, content-addressed bundle
  and dependency objects, supported profiles, and the exact canonical compute-
  profile catalog digest;
- made Node artifact admission hash the canonical manifest, catalog, and
  artifact; authenticate revision, candidate, Task, handler, and manifest
  commitments; reject cross-family supported profiles; and return the exact
  immutable artifact/catalog hex commitments plus defensive artifact readers
  while dispatch remains blocked;
- kept the current Worker publication/materialization contract unchanged: its
  isolate ABI remains explicit, and Standard Application manifests continue to
  reject OOM escalation until the complete active launch path can consume a
  bound same-family reachable-profile set; and
- kept Node artifacts unwired from routing, launch authority, sessions,
  callbacks, processes, and deployment.

Focused receipt: Standard Application definition typecheck and 81 tests,
workspace `lint:core`, unstaged and exact-staged diff lint, Effect boundary
check, and Standard Application boundary check passed. The whole-workspace
typecheck passed through the owned package and was blocked later in the
executor app by concurrent Persistence relation-binding work outside this
slice; the exact staged N1 snapshot remains the commit gate.
