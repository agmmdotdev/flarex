# DTE06 Node Task Provider Architecture Preflight

Status: accepted architecture checkpoint on 2026-08-28. The separately
approved N1 runtime-family and immutable artifact-contract gate, N2
execution-session seam, and N3 Node executor protocol/client gate are complete.
The separately approved N4 authenticated callback transport and N5 local Node
conformance gates are also complete. N6 remains unapproved; no hosted Node
provider, deployment, external resource, or production activation exists.

Evidence snapshot: 2026-08-28 current repository state after the completed N5
local Node conformance gate.

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

After executor acceptance, the private scoped `NodeTaskExecutorSession`
receives one strict, versioned callback-capability attachment before it is
projected into the provider-neutral `TaskExecutionSession`. The attachment is
correlated to the accepted start, session, execution, capability identifier,
and expiry. Attachment is idempotent only for identical pre-issued credential
material, which must be retained and reused after an uncertain acknowledgement;
contradictory attachment fails closed. No undocumented process environment or
provider side channel is part of this contract.

The callback gateway may time out an uncommitted query directly. Mutation
deadline or revocation instead closes the bound mutation authority and awaits
its disposition proof: a known success remains success, a typed mutation
failure remains that failure, and an unprovable disposition becomes
`outcome_uncertain`. The transport must never relabel a known committed
mutation as `timed_out`.

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

N1 and N2 were separately approved and completed. The remaining gates still
require separate approval and retain this safe order:

1. **N1 — runtime-family and artifact contract:** define the private trusted
   compute-profile catalog semantics and Node-compatible immutable Task
   artifact/publication/readiness contract; prove isolate artifacts cannot be
   routed to Node and escalation cannot switch runtime family;
2. **N2 — execution-session seam:** extract the minimum provider-neutral
   `TaskExecutionSession` consumed by supervision and adapt the current Worker
   Loader provider without changing its behavior or wires; **complete**;
3. **N3 — Node executor protocol:** add the backend-private Node client port,
   strict versioned protocol, deterministic fake, typed failures, idempotent
   start/cancel/recovery keys, and scoped lifecycle; no real Node process;
   **complete**;
4. **N4 — authenticated callback transport:** expose the existing Task query
   and mutation authorities through short-lived launch-bound private transport
   and prove replay, stale fence, revocation, budget, and independent
   transaction behavior; **complete**;
5. **N5 — local Node conformance:** run one immutable Node Task artifact in a
   local isolated process using trusted test fixtures and no configured
   egress/secrets/native modules/tools, then
   prove success, failure, timeout, cancellation, lost response, process loss,
   callback replay, fresh-host recovery, and cleanup; **complete**; and
6. **N6 — hosted provider:** select and preflight one concrete production host,
   external resources, rollout, and rollback separately.

Each significant code gate requires focused validation, applicable package and
system tests, `lint:core`, exact diff/staged lint, Effect boundary checks, and
both standing project reviewers against the exact final diff.

## Non-Goals

This checkpoint does not authorize beyond the completed N1 through N5
slices:

- a hosted Node provider, public callback endpoint, or deployment wire;
- an AWS resource, container, route, binding, public token
  issuer, provider infrastructure credential, or user secret;
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

Stop after N5. The local adapter is a development and system-test conformance
host for trusted repository fixtures, not a production provider or hostile-code
sandbox. The current isolate artifact/session wire behavior remains unchanged.
Node profiles remain production-provider-disabled and Node artifact admission
continues to report dispatch as blocked.

The next separately approved gate is N6 only: select and preflight one concrete
hosted provider, including its security boundary, limits, lifecycle, rollout,
rollback, cost, and external-resource ownership. Do not create hosted resources
or production routing before that preflight is accepted.

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

## N2 Implementation Receipt

Completed on 2026-08-28:

- added an unversioned, provider-neutral `TaskExecutionSession` with semantic
  acceptance, generation-correlated interruption, settlement, close budget,
  and typed post-acceptance failures;
- moved `TaskAttemptSupervisor` to that seam and removed its dependency on the
  Worker session host, Worker wire envelopes, and Worker identity helper;
- added a Worker Loader adapter that projects the existing decoded acceptance
  and settlement values into neutral semantics, reconstructs the unchanged V1
  interruption request only at the Worker boundary, and preserves the original
  Worker failure as the typed neutral error cause;
- strips completed Worker result envelopes to the canonical value and semantic-
  size evidence needed by shared supervision, while retaining the existing
  Worker terminal mapper as a source-compatible wire adapter;
- makes shared supervision independently correlate settlement generation,
  execution ID, and full durable identity with the accepted session before it
  may publish a result or acknowledge an interruption;
- retained current start classification, callback lease ownership,
  cancellation receipts, terminal disposition, supervision, close deadlines,
  and every versioned Task Worker wire contract; and
- kept Node client, protocol, callback transport, process, and deployment work
  absent during N2.

Focused receipt: the backend typecheck, 75 session/supervision/Worker lifecycle
tests, workspace `lint:core`, unstaged diff lint, and Effect boundary check
passed. The complete backend run passed 154 of 155 files and 1,412 of 1,413
tests; its sole Sync test failure was accompanied by a Miniflare `ECONNRESET`
and passed immediately when rerun alone.

## N5 Implementation Receipt

Completed on 2026-08-28:

- added a scoped local Node provider in `flarex-dev` that accepts only the
  authenticated private executor start contract, verifies the canonical Node
  artifact plus immutable bundle and per-module digests, and runs a trusted
  repository fixture in a separate permission-mode Node process;
- added a strict local bundle envelope and VM module loader that admits only
  bundle-relative modules, denies package, built-in, and dynamic imports, does
  not inherit the host environment, and exposes no direct process, filesystem,
  native-module, child-process, secret, tool, or network global to Task code;
- used an ephemeral binary channel between the matched local Node processes so
  the complete canonical Task runtime value domain, including `ArrayBuffer`,
  bigint, special numbers, and large Unicode text, survives input, callback,
  and settlement transport without defining a hosted or persisted wire;
- made the child attest its actual Node runtime ABI before acceptance and
  before the provider sends artifact modules, then evaluated the artifact's
  exact committed execution module before resolving and invoking the separately
  committed Task module/export;
- retained the explicit security boundary: VM isolation and Node permission
  mode provide local conformance separation, not a hostile-code sandbox or
  production deployment claim;
- installed the short-lived callback capability through the Node-private
  session attachment channel, preserving the existing authenticated gateway's
  validation, replay, query, mutation, fencing, budget, and revocation owners;
- added provider-owned uncertain-start recovery across fresh stateless client
  views, exact interruption, deadline termination, process-loss reporting,
  output/log ceilings, memory configuration, terminal settlement, and scoped
  process/runtime cleanup;
- bounded that local recovery proof precisely: a fresh Task-host client may
  recover through the surviving provider-owned execution lookup; loss of the
  local provider host reports session loss so persisted Task/delivery authority
  can retry, and does not restore the old JavaScript stack;
- retired terminal live process/session state into minimal digest-correlated
  tombstones, retaining every unexpired start within a 16-entry local capacity
  for idempotent start and recovery while releasing callback credentials,
  closures, streams, and large artifact bytes; new starts fail closed with
  `capacity_unavailable` instead of evicting an unexpired idempotency record;
- assigned session identities from a provider-owned monotonic ordinal rather
  than the bounded live/tombstone collection size;
- projected the attached versioned Node session into the same unversioned
  `TaskExecutionSession` used by shared Task supervision, without changing the
  current Worker Loader wire or Task lifecycle; and
- kept production Node placement disabled and added no public Task/Action API,
  hosted resource, route, secret, egress, native dependency, persistent
  filesystem, AgentOS, or tool capability.

Focused receipt: backend and `flarex-dev` typechecks, Effect boundary check,
31 backend protocol/gateway tests, and all 12 local Node conformance tests passed.
The complete backend run passed 157 files and 1,444 tests. A concurrent complete
`flarex-dev` run passed 207 tests with 9 skipped and retained unrelated
failures: generated-consumer checks target a library older than ES2023 while
current protocol code uses `toSorted`, four existing analysis tests observe
`window is not defined` before their expected import-time diagnostic, and one
Vite case timed out while both complete suites competed for the host.
