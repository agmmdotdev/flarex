# Flarex Dynamic Worker Bundle Partitioning

Status: accepted runtime design direction; not yet implemented

This note defines how Flarex should package query, mutation, workflow-mutation,
action, and HTTP-action code across managed Cloudflare Dynamic Workers and
provider-neutral action executors when one execution bundle approaches its
runtime's size or startup limits. It records the intended developer experience,
runtime and transaction boundaries, automatic grouping policy, nested-call
behavior, readiness gates, rejected alternatives, and unresolved implementation
questions.

This is an architecture note, not an implementation roadmap. Current runtime
status and active work remain owned by
[`../roadmaps/06-dynamic-worker-execution.md`](../roadmaps/06-dynamic-worker-execution.md)
and deployment analysis/push work remains owned by
[`../roadmaps/17-deployment-analysis-and-push.md`](../roadmaps/17-deployment-analysis-and-push.md).

## Executive Decision

Flarex should not expose Dynamic Worker bundle placement to developers and
should not model deployment as exactly one query Worker, one mutation Worker,
and one action Worker.

The target has two internal levels:

```text
runtime capability profile
  -> one or more deterministic, size-bounded execution groups
```

The expected common deployment is:

```text
one transaction execution group
  -> queries
  -> mutations
  -> workflow mutations
  -> deterministic helper code

one or a small number of edge-action execution groups
  -> ordinary Worker-compatible actions and HTTP actions
  -> latency-sensitive integrations

optional Node-action artifacts
  -> explicitly Node-compatible action modules
  -> large SDKs or Node APIs outside the Worker profile

optional heavy/job artifacts
  -> container or workflow execution for binaries, high memory, or long work
```

Flarex should create additional transaction groups only when measured bundle
size, startup cost, or an incompatible dependency boundary requires them.
Nested transactional functions should be colocated when practical. When they
cannot be colocated, an internal remote nested-dispatch path must attach the
target function to the caller's existing executor session. A code partition
must not become a transaction, OCC, snapshot, subscription, data, or tenant
partition.

Execution grouping is automatic. Developers continue to write ordinary Flarex
modules and use ordinary function references:

```ts
export const getProduct = query({ /* ... */ })
export const checkout = mutation({ /* ... */ })
export const sendEmail = action({ /* ... */ })

await ctx.runQuery(api.products.getProduct, args)
```

Developers do not name Workers, execution groups, group hashes, or nested-call
routes. They may declare a semantic runtime requirement when their code truly
requires Node or a future heavy/job environment, but they do not select AWS,
Cloudflare Containers, regions, or artifact placement in application code.

## Why This Design Is Needed

Convex can deploy a comparatively generous backend module graph into its owned
execution infrastructure. Flarex instead materializes untrusted developer code
as Cloudflare Dynamic Workers. The currently published paid-Worker limits are
10 MB after gzip, 64 MB before compression, and one second of startup time.
Those values may change and must be verified rather than treated as eternal
constants, but the architectural constraint remains: each materialized Worker
has a finite code-size and initialization budget.

Large code also has costs before the hard limit:

- more code must be loaded, compiled, and initialized on a cold start;
- Dynamic Worker startup CPU is billable;
- large global-scope initialization can fail before a request handler runs;
- frequently evicted or weakly reused groups can add tail latency; and
- a deployment that fails only on first production invocation is not an
  acceptable readiness model.

Queries and mutations will usually be smaller than actions. They normally
contain database operations, authorization, validation, business rules, data
transformation, and deterministic helpers. Actions are more likely to import
payment, email, AI, document, image, storage, third-party API, Node-compatible,
or WASM dependencies. This is a useful expectation, not a correctness
guarantee. A mature transaction bundle can still become large through a large
function inventory, generated lookup data, locale data, parsers, deterministic
WASM, non-tree-shakeable barrels, or accidental cross-runtime imports.

The design must therefore optimize the common case without assuming that
transaction code can never exceed a Worker limit.

## Current Flarex Baseline

The current implementation is an unshipped prototype baseline, not the target
described in this note.

[`../packages/flarex-dev/src/sourcePackage.ts`](../packages/flarex-dev/src/sourcePackage.ts)
currently creates:

- one bundled artifact for every discovered function module;
- a separately bundled schema module when present;
- a separately bundled auth-config module when present; and
- one combined `_flarex/execution.js` entry that imports all function modules.

[`../packages/flarex-backend/src/artifactRuntime/HostKit.ts`](../packages/flarex-backend/src/artifactRuntime/HostKit.ts)
currently copies every source-package module into the materialized Worker in
addition to the generated runtime shell. Normal invocation imports the combined
execution entry, so per-module analysis artifacts, schema/auth artifacts, and
the combined execution artifact can cause unnecessary or duplicated code to be
present in the Worker definition.

That accidental duplication must be removed before execution partitioning is
used to justify more complexity. The first correction is a runtime projection:

```text
canonical source package in artifact storage
  -> complete modules, schema/auth inputs, analysis inputs, source maps,
     provenance, and rollback identity

materialized execution projection
  -> generated runtime shell
  -> selected executable entry modules
  -> only their transitive runtime chunks
```

Other relevant current boundaries are:

- hosted Dynamic Workers use `globalOutbound: null`;
- only queries and mutations are currently executable by the generated hosted
  artifact route;
- current `ctx.runQuery` and `ctx.runMutation` resolve the nested registered
  function inside the same execution module; and
- current nested query/mutation execution reuses the caller's executor session,
  identity, read/write set, depth counter, and finalization owner.

Remote execution groups, action execution, action outbound policy, remote
same-session nested dispatch, runtime bundle-size policy, and speculative group
preparation do not exist yet.

## Terms And Boundaries

### Canonical Source Package

The immutable deployment input kept for analysis, codegen, provenance,
readiness, activation, and rollback. It may contain artifacts that are never
loaded into a normal invocation Worker.

### Runtime Projection

The subset and generated shell materialized for one executable runtime artifact.
A runtime projection must not indiscriminately copy the entire canonical source
package.

### Runtime Capability Profile

A security and execution-policy class. The accepted target profiles are:

```text
transaction
  no ambient outbound network
  query/mutation/workflow-mutation execution
  executor-backed transaction session capabilities

action-edge
  controlled outbound capability
  Cloudflare Worker-compatible JavaScript
  no direct database or transaction handle
  ctx.runQuery / ctx.runMutation / ctx.runAction through platform RPC

action-node
  explicit Node runtime semantics
  controlled outbound capability
  no direct database or transaction handle
  provider-neutral remote executor adapter

action-heavy-job
  future explicit container/workflow semantics
  large binaries, higher resource needs, or long-running work
  no direct database or transaction handle

analysis
  restricted import and metadata extraction
  no application database authority
  no ambient outbound network
```

Capability profiles are trust boundaries. An execution group must never gain
authority because of its size, name, or neighboring functions.

### Execution Group

One deterministic, runtime-envelope-bounded code group inside a capability
profile. It is an internal deployment optimization and routing target.

### Provider-Neutral Execution Manifest

The immutable deployment record mapping each function to its semantic runtime
profile, execution group, exact artifact digest, and platform-owned placement.
Callers resolve functions through this manifest but cannot choose or override
its provider placement.

### Function Metadata

Backend-authoritative metadata for function path, kind, visibility, validators,
source position, capability profile, and execution-group identity.

### Data Partition

A storage/transaction routing concept such as a scope or declared application
partition. It is unrelated to execution grouping.

```text
data partition
  -> authority, storage, snapshot, transaction and OCC scope

execution group
  -> which Dynamic Worker contains executable JavaScript
```

Flarex must never infer one from the other.

## Developer Experience

Execution grouping is automatic and invisible in normal user code.

The user owns semantic declarations:

- query, mutation, workflow-mutation, action, and HTTP-action registration;
- public or internal visibility;
- validators and schema declarations;
- explicit data-routing or partition policy where the public API requires it;
  and
- a future runtime directive such as Convex's `"use node"` only when it states
  an actual runtime requirement.

The platform owns deployment placement:

- dependency analysis;
- runtime-profile classification;
- execution-group construction;
- function-to-group routing;
- group hashes and stable Worker Loader identities;
- local versus remote nested dispatch;
- size and startup readiness gates; and
- regrouping on a later deployment.

There must be no normal API shaped like:

```ts
// Rejected public design.
mutation({ bundleGroup: "commerce-2", /* ... */ })
ctx.runQuery("tx-3", api.products.get, args)
```

Making physical group names public would leak Cloudflare infrastructure into
application semantics, inhibit automatic rebalancing, create stale placement
contracts, and encourage confusion between code and data partitions.

A future advanced placement hint may be considered only if real evidence shows
that automatic grouping cannot express an important optimization. Such a hint
must remain optional, non-semantic, validated, and overridable by Flarex.

## Ordinary Helpers Versus Registered Nested Functions

An ordinary imported helper is a hard code dependency:

```ts
import { calculatePrice } from "./pricing"

export const getCart = query({
  handler: async (ctx) => calculatePrice(/* ... */),
})
```

The helper's transitive runtime code must be present in the caller's execution
group.

A registered nested function is a logical function invocation:

```ts
export const getCart = query({
  handler: async (ctx) =>
    ctx.runQuery(internal.products.getPrices, {}),
})
```

The target should be colocated when that improves latency and fits the group
budget, but colocation is not required for correctness once remote same-session
dispatch exists.

Registered functions should not replace ordinary helpers merely for code reuse.
An ordinary helper is preferable when the code does not need an independently
addressable function boundary, validator boundary, authorization boundary,
scheduler/action target, component boundary, or separate observability record.

## Why Query And Mutation Are Not Separate Primary Workers

Queries and mutations have different capabilities, but they belong to the same
transaction runtime profile:

| Kind | Reads | Writes | Ambient outbound network |
| --- | --- | --- | --- |
| Query | Yes | No | No |
| Mutation | Yes | Yes | No |
| Workflow mutation | Yes | Yes, through its accepted transaction semantics | No |
| Action | Through function calls | Through function calls | Controlled action policy |

Write authority comes from the invocation kind, generated context, and trusted
executor session. The presence of mutation code in the same Worker does not
grant a query write authority. The executor must reject a write attempted under
a query session even if the Worker contains mutation handlers.

Physically separating every query from every mutation would add a remote
boundary to common mutation-to-query and mutation-to-mutation calls without
providing a durable size guarantee. Any of the three kind-based Workers could
still exceed the platform limit, while shared dependencies would be duplicated.

The default should therefore be one transaction group containing all query,
mutation, and workflow-mutation functions when that projection stays within the
internal size/startup budget.

## Why Actions Are A Natural Capability Split

Actions have a different authority and failure model:

- they may need external network access;
- they must not receive a direct application database or transaction handle;
- `ctx.runQuery` and `ctx.runMutation` cross a platform function boundary; and
- multiple mutation calls made by one action are separate transactions unless
  a separately designed workflow provides stronger semantics.

This makes an action Worker/profile a justified physical security boundary,
not merely a bundle-size trick. Action code should normally be grouped by
dependency affinity so that unrelated heavy integrations do not contaminate
one another:

```text
action/integrations
  -> email, payments, webhooks

action/documents
  -> PDF/document generation

action/ai
  -> AI-provider integrations
```

Not every action is large, and not every transaction group is small. The
bundler must measure rather than assume.

### Action Runtime Tiers And Provider Placement

Actions should be bundled separately from transaction code by default, but
"separate" does not mean that every action should run on AWS or another remote
provider. The accepted placement model is:

| Semantic profile | Default platform shape | Intended use |
| --- | --- | --- |
| `action-edge` | Cloudflare Dynamic Worker | Ordinary Worker-compatible actions, HTTP actions, and latency-sensitive integrations |
| `action-node` | Provider-neutral Node executor; AWS Lambda or an equivalent adapter is a candidate | Large Node SDKs, Node built-ins, or dependencies incompatible with the Worker runtime |
| `action-heavy-job` | Future container/workflow adapter such as Cloudflare Containers or an AWS container service | Large binaries, high memory/filesystem needs, or work whose duration/recovery model does not fit an ordinary action |

`action(...)` remains an edge action by default. Flarex should preserve the
Convex-compatible file-level `"use node"` signal for action modules that need
Node semantics. A future heavy/job profile needs an explicit API and failure
contract; the bundler must not infer that semantic change from bytes alone.

Developers declare runtime semantics, not infrastructure vendors. The active
platform configuration maps `action-node` and `action-heavy-job` to concrete
providers. This keeps source portable and lets self-hosted or single-cloud
installations choose different adapters without changing function references.

An oversized `action-edge` candidate must fail deployment with attribution and
an actionable diagnostic. Flarex must not silently spill it to Lambda or a
container because that would silently change region, latency, billing,
credentials, native architecture, payload limits, observability, retry
behavior, and rollback requirements.

HTTP actions should remain edge by default because they own latency-sensitive
ingress behavior. A small HTTP action may validate the request and call an
explicit Node or heavy action when the expensive work needs another runtime.

Remote action execution is semantically easier than cross-group transactional
execution: every action callback through `ctx.runQuery` or `ctx.runMutation` is
an independent platform invocation and transaction. It never joins a database
session held by the action. The remote action protocol must nevertheless carry
the exact deployment/action-artifact digest, authenticated execution identity,
function path, validated arguments, deadline, invocation ID, and retry policy.
The runner receives narrowly scoped callback capabilities, never raw Postgres,
Hyperdrive, executor, deployment-admin, or provider credentials.

External side effects make retry and idempotency part of the action contract.
The platform must distinguish retry-safe transport failure from an action that
may already have completed an external effect; moving execution to another
provider cannot weaken that rule.

The 2026-08-04 private Standard action preflight in
[`../roadmaps/46-private-standard-edge-action-vertical.md`](../roadmaps/46-private-standard-edge-action-vertical.md)
turns that requirement into an explicit implementation gate. Existing
`edge_action` publication, R2 materialization, readiness, and active selection
are sufficient artifact authority, but no direct action request/result owner or
shared external-effect evidence owner currently settles crash and response-loss
uncertainty. `AAV-A1` must close that private protocol/storage boundary without
duplicating durable-task run/attempt/orchestration state before a Dynamic Worker
action host is accepted. `AAV-A2` then owns the candidate-bound edge-action
target/profile/syscall ABI. A future durable-task adapter may reuse lower-level
loader, sandbox, outbound, callback, and resource mechanics through a narrow
compute port while retaining a distinct `durable_task` target and lifecycle. No
current query or mutation identity is widened, and no in-memory or legacy
runtime fallback counts as proof.

The implementation-bearing ownership and storage receipt is
[`../roadmaps/47-aav-a1-direct-action-and-shared-effect-authority.md`](../roadmaps/47-aav-a1-direct-action-and-shared-effect-authority.md).
It admits one direct-action invocation row and one shared external-effect row,
keeps canonical bodies in R2, and rejects a parallel action-only effect journal.

### Verified Convex Node-Action Reference Model

Convex provides the semantic and implementation reference for this boundary.
Its public developer contract promises a default Convex runtime and an opt-in
Node.js runtime selected with a file-level `"use node"` directive. It does not
make AWS part of the developer API. Current Convex Cloud backend source does,
however, explicitly model AWS Lambda configurations, versions, invocation IDs,
and Lambda-specific package headroom for Node actions. Self-hosted Convex uses a
local Node executor process by default and can use a configured remote Node
executor instead. Flarex should preserve the same separation between portable
runtime semantics and provider-specific hosting.

Convex deployment and execution currently follow this shape:

```text
CLI
  -> classify entry modules by default versus "use node" environment
  -> bundle default and Node modules in separate esbuild passes
  -> upload one source package plus separately installable Node dependencies

Convex backend
  -> detect that the package contains Node modules
  -> enable the Node-action executor
  -> store source/dependency packages
  -> invoke the Node executor with function path, arguments and package refs

Convex Cloud Node executor
  -> AWS Lambda implementation
  -> static Lambda version tied to a source package when ready
  -> dynamic Lambda fallback that downloads packages at invocation time

Self-hosted Node executor
  -> local Node server over a private socket, or a configured remote executor
```

The checked-in model is package-oriented rather than one Lambda per exported
action. A Node invocation carries the requested function path inside the
executor request. Static Lambda readiness is compared with the active source
package, while the dynamic Lambda can load packages at invocation time. This is
an implementation inference from the open source model; Convex does not expose
Lambda topology as a public compatibility promise.

Most importantly, the Node executor does not receive a database connection.
The backend constructs an invocation containing:

- the exact function path and validated arguments;
- short-lived signed source and external-dependency package URLs;
- environment variables;
- the original authentication header and derived user identity;
- the Convex backend callback address;
- an encrypted, time-limited action callback token scoped to a component;
- execution, request, scheduling and trace context; and
- the configured action deadline and deployment metadata.

Inside the Node runtime, the Convex SDK translates action capabilities into
internal asynchronous syscalls:

```text
ctx.runQuery(reference, args)
  -> 1.0/actions/query
  -> POST {backendAddress}/api/actions/query

ctx.runMutation(reference, args)
  -> 1.0/actions/mutation
  -> POST {backendAddress}/api/actions/mutation

ctx.runAction(reference, args)
  -> 1.0/actions/action
  -> POST {backendAddress}/api/actions/action
```

Those callbacks carry the action callback token, original authorization,
calling-action name, request/execution identity and trace context. Backend
middleware validates the callback token and its issue time, reconstructs the
original caller identity as of that issue time, validates the component scope,
resolves public or internal function references, and invokes the ordinary
trusted query, mutation or action runner. `internalQuery` and
`internalMutation` are therefore callable from the authenticated action path
without becoming public client endpoints.

Every `ctx.runQuery` is a separate read transaction and every
`ctx.runMutation` is a separate write transaction. The action owns no database
session, does not receive `ctx.db`, and cannot make several callbacks atomic.
Authentication propagates, but transaction state does not. An external side
effect followed by a failed mutation therefore still needs application-level
idempotency, reconciliation or a durable workflow.

Flarex should closely port this semantic boundary:

1. define a provider-neutral Node-action executor request/response protocol;
2. bundle `"use node"` entry modules separately from transaction and edge-action
   modules;
3. give remote executors content-bound package/artifact references, never raw
   database or Hyperdrive credentials;
4. issue a short-lived callback capability bound at minimum to scope/component,
   deployment, action artifact and deadline, with invocation binding preferred;
5. preserve verified caller identity and trace context across callbacks;
6. route callbacks through backend-owned function resolution, visibility,
   argument/return validation and normal transaction execution;
7. keep each query/mutation callback an independent transaction; and
8. provide local and remote executor adapters against the same protocol.

AWS Lambda is now a proven Convex reference and a strong candidate for Flarex's
first hosted `action-node` adapter. It is not yet an accepted provider choice:
bundle/payload limits, regions, networking, concurrency, credentials, cold
starts, observability, deployment readiness, rollback and operating cost still
need a focused provider preflight. Whichever adapter is selected must remain
behind the provider-neutral contract above.

## Automatic Execution-Group Construction

The push pipeline should build execution groups deterministically from exact
candidate inputs.

### Inputs

- backend-authoritative function kind and visibility;
- resolved source-module and dependency graph;
- emitted chunks and their uncompressed/compressed contribution;
- capability-profile constraints;
- source-module boundaries and side-effect metadata;
- statically discoverable registered-function references;
- shared-dependency affinity;
- internal target and rejection budgets; and
- optional previous-deployment telemetry used only as a non-authoritative
  optimization hint if reproducibility rules permit it.

### Default Packing Policy

1. Build the smallest correct runtime projection rather than the full source
   package.
2. Put all transaction functions in one group if it remains comfortably under
   the internal target.
3. Split actions by declared semantic runtime profile, then build groups within
   each profile by capability and dependency affinity.
4. If the transaction group exceeds its target, cluster transactional
   functions by source/domain proximity, shared dependencies, and nested-call
   affinity.
5. Strongly prefer colocating functions that call each other, but stop before
   violating size/startup headroom.
6. Emit stable deterministic group IDs and content hashes.
7. Emit an immutable function-to-group manifest for the exact artifact.
8. Cold-materialize and validate every group before activation.

Illustrative internal manifest:

```ts
{
  "products:get": {
    kind: "query",
    profile: "transaction",
    group: "tx-catalog",
  },
  "orders:checkout": {
    kind: "mutation",
    profile: "transaction",
    group: "tx-orders",
  },
  "reports:generatePdf": {
    kind: "action",
    profile: "action-node",
    group: "action-documents",
    artifact: "node-action-documents@sha256:...",
  },
}
```

The call graph is an optimization input, not a correctness dependency.
JavaScript can select function references dynamically, and complete static call
graph discovery is not generally possible. At runtime, the exact target path is
resolved through the active artifact manifest.

### Group Size Policy

Architecture should define percentage/headroom policy rather than permanently
embedding today's platform numbers. For Dynamic Worker profiles, a practical
initial policy is:

- target groups substantially below the published hard limit;
- warn before the target becomes risky;
- reject activation before the Cloudflare hard limit so the runtime shell,
  platform changes, compression variance, and startup cost retain headroom;
- enforce both raw and compressed limits; and
- keep startup-time readiness independent from byte-size readiness.

With a published 10 MB gzip limit, a provisional 4-6 MB target and a rejection
threshold below the platform maximum are reasonable starting points. Exact
values must be validated against real Worker Loader behavior and remain
configurable platform policy rather than developer API.

Node and heavy/job adapters need their own declared compressed, uncompressed,
asset, startup, memory, payload, and duration envelopes. A larger provider limit
does not remove the need for headroom or candidate-readiness validation.

## Nested Transactional Calls

### Same-Group Fast Path

When caller and target share a group:

```text
outer function
  -> resolve target locally
  -> validate expected function kind
  -> execute handler with caller session
  -> merge reads/writes into the same executor-owned session
```

This is the normal expected path for commonly nested functions.

### Cross-Group Correctness Path

When the target is in another transaction group:

```text
tx-orders Worker
  -> ctx.runQuery(products:get)
  -> internal nested-dispatch capability
  -> active manifest resolves products:get to tx-catalog
  -> tx-catalog Worker executes nested-only request
  -> target attaches to the existing executor session
  -> result returns to tx-orders
  -> outer invocation alone finishes or aborts the session
```

The target must not start an independent query or mutation session. Doing so
would break one or more of:

- exact-snapshot consistency;
- read-your-writes;
- staged-write visibility;
- combined read-set/OCC validation;
- subscription dependency collection;
- identity and visibility continuity;
- bounded nested-call depth;
- cancellation and timeout propagation; and
- exactly-once finalization ownership.

### Nested Session Capability

Remote nested dispatch requires an opaque, short-lived, platform-owned
capability bound at least to:

- project/scope and deployment;
- active artifact and exact group manifest;
- storage generation/fence where applicable;
- executor session;
- execution identity;
- allowed target kind and visibility;
- call depth and deadline; and
- outer finalization ownership.

Developer code must never receive the raw session capability, executor token,
service binding, or group router. A nested Worker may borrow the session for
authorized execution but may not finish, commit, or abort it.

Concurrent nested calls, including calls created through `Promise.all`, require
an explicit ordering/concurrency contract at the executor-session boundary.
Remote grouping must not introduce races that the same-group implementation did
not have.

## Colocation Policy And Its Limit

Commonly nested transactional functions should be grouped together. This is
expected to keep nearly all nested calls local for most applications.

However, blindly colocating the full transitive registered-function call graph
would recreate a monolithic Worker. A small shared function such as
`auth:getCurrentUser` may be called by catalog, orders, reports, and admin
domains; requiring every caller to share its group would merge the whole
application.

The rule is therefore weighted rather than absolute:

> Prefer colocation for strong nested-call and dependency affinity while the
> group remains within its safe size and startup budget. Preserve remote
> same-session dispatch as the overflow path.

Potential future optimization: a small, immutable internal function may be
replicated into more than one group when doing so is cheaper than a frequent
remote call. Replication requires exact artifact hashes, consistent source
positions and logging, safe module-initialization semantics, and one canonical
direct-invocation owner. It is not required for the initial design.

## Latency And Dynamic Worker Preparation

The approximate paths are:

```text
same group
  -> local JavaScript dispatch
  -> existing executor session syscalls

different group, warm target
  -> internal dispatcher RPC
  -> argument/result serialization
  -> target Dynamic Worker invocation
  -> existing executor session syscalls

different group, cold target
  -> all warm-target work
  -> group code retrieval on cache miss
  -> compilation and isolate/module initialization
```

Remote dispatch is therefore a correctness-preserving fallback, not a free
substitute for useful colocation. Sequential cross-group calls can form an
internal N+1 RPC pattern and should be visible in diagnostics.

### Speculative Preparation

The active artifact manifest may record likely first-hop target groups. The
artifact runtime can prepare those groups concurrently with the root group so
their cold-start work overlaps:

```text
load/execute root group ----+
prepare likely group A -----+ concurrent
prepare likely group B -----+
```

Calling `WorkerLoader.get(...)` only obtains a stub and may not force an isolate
to start. A real preparation design likely needs an internal `prepare` RPC that
imports the exact group, verifies its artifact/group hash, starts no executor
session, and invokes no developer handler.

Preparation is only an optimization:

- Cloudflare does not guarantee that later requests, even through the same
  stub, use the same isolate;
- a conditional nested call may never occur;
- every preparation consumes runtime work and may add a billable invocation;
- preparing every transitive target creates cache pressure and wasted startup;
  and
- deployment-time readiness probes do not globally warm all production
  locations.

The preferred order is:

1. colocate frequent/strongly related calls;
2. selectively prepare a bounded set of highly likely first-hop groups; and
3. lazily load rare, conditional, or deep targets.

Correctness must never depend on a preparation prediction or cache hit.

## Mixed-Kind Modules

Convex permits a normal isolate module to export queries, mutations, and
actions together. Flarex should not reject such source merely to simplify
physical placement.

A mixed transaction/action module creates a capability-projection problem. The
safe options are to emit profile-specific entries from the same canonical
source or duplicate the minimum required module closure across profiles. The
bundler must preserve top-level module semantics and must not assume that an
export can be separated when package side-effect metadata says otherwise.

Tooling may recommend placing heavy action imports in a dedicated module:

```ts
// Avoid contaminating transaction projections with a large action-only import.
import { generatePdf } from "large-pdf-package"
```

That recommendation is dependency hygiene, not mandatory manual execution-group
assignment.

## Oversized Indivisible Dependencies

Automatic packing cannot make one function's indivisible dependency closure
smaller than the platform limit.

```text
reports:generatePdf
  -> handler
  -> PDF library
  -> WASM engine
  -> embedded fonts
  -> total exceeds one Worker budget
```

The push must reject the inactive candidate with actionable attribution rather
than defer failure until invocation. The diagnostic should report:

- affected function/profile/group;
- raw and compressed closure size;
- configured target/rejection/platform limits;
- largest modules and packages;
- whether side effects prevented tree shaking; and
- supported remediation.

Valid remediation may include:

- use a lighter Worker-compatible dependency;
- move fonts, templates, models, locale data, or other assets to R2/KV;
- isolate a heavy action dependency from unrelated actions;
- use a platform-owned capability/service binding;
- move the operation to an explicitly supported compute environment; or
- remove an unsupported Node/native dependency.

Dynamic `import()` is not a size escape when the imported chunk is still part
of the Worker definition.

## Push, Readiness, Activation, And Rollback

Size and materialization are candidate-readiness properties.

Before activation, the backend-controlled push flow must:

1. validate source-package and analysis identity;
2. construct the exact runtime projections and immutable provider-neutral
   execution manifest;
3. calculate raw and compressed size metrics;
4. reject groups outside platform policy;
5. cold-materialize every transaction and edge-action group through a
   hosted-equivalent Worker Loader lane;
6. deploy or register every Node/heavy action artifact through its configured
   provider adapter and verify provider readiness;
7. validate startup, group/artifact hash, runtime profile, callback authority,
   and internal routes;
8. retain diagnostics and per-group/per-provider measurements; and
9. activate the source package, provider-neutral execution manifest, and
   execution identity
   atomically only after every required group is ready.

Any failure leaves the previous active deployment executable. Rollback selects
the previous immutable source package and its exact previous provider-neutral
execution manifest, including matching remote action artifacts; it does not
recompute groups or provider placement from current heuristics.

At invocation time, a missing group, hash mismatch, capability mismatch, load
failure, or malformed nested response fails closed. The outer invocation owns
abort/finalization and must not publish partial mutation state.

## Observability And Diagnostics

Flarex should expose deployment and runtime evidence without exposing raw
infrastructure capabilities.

Deployment diagnostics should include:

- profile/group raw and compressed bytes;
- runtime-shell versus developer-code contribution;
- largest packages, modules, assets, and shared chunks;
- tree-shaking/side-effect blockers;
- cold materialization/startup time;
- functions assigned to each group; and
- why a new group was created.

Runtime telemetry should include:

- local versus cross-group nested-call counts;
- target group and call depth;
- warm/cold/cache-miss evidence when available;
- dispatcher, load, initialization, execution, and serialization latency;
- speculative preparations used versus wasted;
- sequential cross-group/N+1 patterns;
- group load and capability failures; and
- per-group invocation/startup cost attribution.

Telemetry may inform later optimization suggestions. It must not silently alter
an already activated immutable artifact.

## Security And Trust Invariants

1. The backend-controlled analyzer and push flow own authoritative function and
   group metadata.
2. A client cannot choose a group, runtime profile, nested session, or target
   artifact independently from a function path.
3. Execution grouping never changes data authority, transaction scope, OCC
   validation, subscription dependency ownership, or tenant isolation.
4. Transaction Workers receive no ambient outbound network.
5. Action outbound access is explicit, controlled, and separate from database
   authority.
6. Developer code receives no Worker Loader, R2 handle, service-binding
   namespace, executor token, database handle, or raw nested-session
   capability.
7. Nested Workers cannot finish, commit, or abort the outer session.
8. Every local or remote target is resolved against the exact active immutable
   artifact and group manifest.
9. Runtime projection cannot overwrite Flarex-reserved shell/module paths.
10. Size pressure cannot justify weakening validator, identity, capability, or
    finalization checks.
11. Runtime-provider placement comes only from the active immutable manifest.
    A caller cannot choose a provider, region, artifact, or semantic profile.
12. Remote action runners receive callback capabilities, not raw database or
    platform-control authority.

## Rejected Alternatives

### Keep One Monolithic Worker Forever

Simple initially, but it eventually converts a known platform limit into a
deployment or first-request failure and makes action outbound capability harder
to isolate.

### Exactly One Query, One Mutation, And One Action Worker

Useful as a rough conceptual split but not a durable strategy. Queries and
mutations share the transaction profile and commonly call each other; separating
them adds RPC boundaries. Any one kind-based Worker can still exceed the size
limit, and shared dependencies are duplicated.

### One Dynamic Worker Per Function

Avoids large groups but fragments caches, multiplies cold starts and Worker
identities, duplicates shared dependencies, increases invocation/billing
pressure, and makes nested calls remote by default.

### Mandatory User-Selected Bundle Groups

Leaks infrastructure into developer APIs, blocks automatic rebalancing, and
turns a deployment optimization into a compatibility contract.

### Colocate The Entire Transitive Registered-Function Call Graph

Eventually merges unrelated domains through shared functions and recreates a
monolithic Worker. Complete static call-graph discovery is also impossible for
dynamic function references.

### Start A New Session For A Cross-Group Nested Call

Breaks snapshot consistency, read-your-writes, staged writes, combined OCC/read
sets, subscription dependencies, and atomic mutation behavior.

### Eagerly Prepare Every Reachable Group

Wastes invocations and startup work on conditional paths, creates cache
pressure, and still cannot guarantee isolate reuse.

### Treat Dynamic Import As External Code Loading

Chunks included in the Worker definition still count toward Worker size. Truly
external code/capabilities require an explicitly supported platform boundary.

### Run Every Action On A Large Remote Runtime

This removes one bundle limit but imposes cross-cloud or container cold-start
latency, cost, regional, credential, and operability overhead on small actions
and HTTP ingress. Edge actions remain the default; Node and heavy placement is
explicitly selected by semantic need.

### Silently Spill Oversized Actions To Another Provider

Bundle size is not enough evidence to change runtime semantics. Automatic
provider spill would make deployment success depend on hidden changes to
latency, native compatibility, retries, credentials, and billing. Deployment
must fail with a clear diagnostic until the developer explicitly declares the
required runtime profile.

## Expected Common Case

After accidental source-package duplication is removed, most applications are
expected to fit this shape:

```text
transaction/default
  -> all queries
  -> all mutations
  -> workflow mutations
  -> deterministic helpers

action-edge/integrations
  -> ordinary Worker-compatible third-party integrations
  -> HTTP actions

optional action-node/domain groups
  -> Node-only or large SDK dependencies

optional action-heavy-job artifacts
  -> large binaries, high resource needs, or long-running work
```

Most transactional nested calls remain local. Multi-group transaction execution
and remote same-session nested dispatch remain an advanced safety valve for
large applications rather than the normal tax paid by every request.

## Required Future Capabilities

This note does not authorize an implementation gate. A future roadmap preflight
must validate ordering and choose the smallest correctness-preserving slice.
The complete target requires:

- runtime projection distinct from the canonical source package;
- exact bundle graph and size attribution;
- configurable raw/compressed/startup policy;
- immutable execution-group manifest and protocol types;
- deterministic automatic grouping;
- function-to-group routing in the artifact runtime;
- transaction, edge-action, Node-action, and future heavy/job runtime profiles;
- provider-neutral action-executor adapters and immutable artifact placement;
- authenticated, least-authority action callback protocol;
- explicit action retry/idempotency behavior across provider boundaries;
- remote nested-only invocation with opaque session capabilities;
- one-owner finish/abort and cancellation semantics;
- cross-group concurrency tests;
- hosted Worker Loader cold-materialization readiness plus configured remote
  action-provider readiness;
- rollback using the previous immutable provider-neutral execution manifest;
- latency/cold-start/cross-group observability; and
- focused real-Cloudflare conformance tests near and beyond platform limits.

## Unresolved Questions

The direction above is accepted, but these details require focused research
before implementation:

1. What byte calculation most accurately predicts Worker Loader enforcement
   for a multi-module `WorkerCode` object?
2. What target, warning, and rejection budgets provide enough headroom for the
   generated shell, compression variance, startup, and future runtime changes?
3. Which provider adapter should Flarex implement first for `action-node`, and
   what bundle, payload, region, concurrency, and timeout envelope does it
   advertise without leaking vendor choice into user code?
4. What explicit API and recovery contract should introduce
   `action-heavy-job`, rather than overloading ordinary action semantics?
5. How should mixed transaction/action source modules be projected without
   unsafe top-level duplication or unnecessary dependency contamination?
6. What exact signed/opaque capability permits nested group execution while
   preventing finalization or arbitrary session reuse?
7. How are concurrent nested calls ordered and cancelled across groups?
8. Can useful direct function-reference edges be extracted without making
   correctness depend on a static call graph?
9. Should previous-deployment telemetry influence only diagnostics or also the
   next deterministic grouping result?
10. Does a dedicated `prepare` RPC materially reduce cold latency in real
   Cloudflare locations given that isolate reuse is not guaranteed?
11. When is selective replication of a small internal function safer and
    cheaper than cross-group dispatch?
12. What action dependencies should become platform-owned capability services
    instead of repeatedly bundled application code?
13. How should local Miniflare simulate group loading, eviction, remote nested
    calls, and readiness without claiming hosted-cache equivalence?

## Primary References

Current Flarex source and owning runtime records:

- [`../packages/flarex-dev/src/sourcePackage.ts`](../packages/flarex-dev/src/sourcePackage.ts)
- [`../packages/flarex-backend/src/artifactRuntime/HostKit.ts`](../packages/flarex-backend/src/artifactRuntime/HostKit.ts)
- [`../packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts`](../packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts)
- [`../apps/artifact-runtime/src/worker.ts`](../apps/artifact-runtime/src/worker.ts)
- [`../roadmaps/06-dynamic-worker-execution.md`](../roadmaps/06-dynamic-worker-execution.md)
- [`../roadmaps/17-deployment-analysis-and-push.md`](../roadmaps/17-deployment-analysis-and-push.md)

Checked-in Convex references:

- `../../../npm-packages/convex/src/bundler/index.ts`
  - entry discovery, environment classification, module bundling, and chunks.
- `../../../npm-packages/convex/src/cli/lib/config.ts`
  - separate Convex-isolate and Node build passes plus external Node packages.
- `../../../crates/isolate/src/environment/analyze.rs`
  - backend analysis of registered query/mutation/action exports.
- `../../../crates/application/src/application_function_runner/mod.rs`
  - Node invocation construction, package URLs, identity propagation, callback
    token issuance and action-result validation.
- `../../../crates/model/src/aws_lambda_versions/types.rs` and
  `../../../crates/model/src/aws_lambda_versions/mod.rs`
  - AWS Lambda configuration/version metadata and static-versus-dynamic package
    routing.
- `../../../crates/model/src/source_packages/types.rs`
  - Lambda-derived zipped and unzipped Node package headroom.
- `../../../crates/node_executor/src/executor.rs`
  - provider-neutral Rust Node-executor interface and invocation envelope.
- `../../../npm-packages/node-executor/src/syscalls.ts`
  - Node syscall interception and authenticated HTTP callbacks to the backend.
- `../../../crates/local_backend/src/node_action_callbacks.rs`
  - protected callback routes, token validation, identity reconstruction and
    independent query/mutation/action dispatch.
- `../../../crates/keybroker/src/broker.rs`
  - encrypted, issued-at and component-scoped action callback tokens.
- `../../../crates/node_executor/src/local.rs` and
  `../../../crates/node_executor/src/remote.rs`
  - self-hosted local-process and remote Node-executor adapters.

Convex primary documentation, verified during the Node-action research:

- [Convex runtimes](https://docs.convex.dev/functions/runtimes)
- [Convex actions](https://docs.convex.dev/functions/actions)
- [Convex Ready for Actions](https://stack.convex.dev/ready-for-actions)

Cloudflare primary documentation, verified while this note was prepared:

- [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Dynamic Workers API reference](https://developers.cloudflare.com/dynamic-workers/api-reference/)
- [Dynamic Workers getting started](https://developers.cloudflare.com/dynamic-workers/getting-started/)
- [Dynamic Workers pricing](https://developers.cloudflare.com/dynamic-workers/pricing/)
- [Cloudflare Containers overview](https://developers.cloudflare.com/containers/)
- [Cloudflare Containers limits](https://developers.cloudflare.com/containers/platform-details/limits/)
- [Cloudflare Containers architecture and lifecycle](https://developers.cloudflare.com/containers/platform-details/architecture/)

AWS primary documentation, verified while the action-runtime decision was
prepared:

- [AWS Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
- [Deploy Node.js Lambda functions with zip archives](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-package.html)
