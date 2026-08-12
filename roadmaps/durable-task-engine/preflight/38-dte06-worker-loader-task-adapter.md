# Preflight 38: DTE06 Worker Loader Task Adapter

## Status

**Decision:** Approve the ordered, production-inert DTE06-D implementation
sequence defined here. Do not wire a Worker host, route, Queue, Cron Trigger,
deployment binding, public API, or production activation.

**DTE06-D1 checkpoint:** The private launch-subject contract and verification
authority are implemented. The authority resolves one exact trusted scope,
correlates the C2 prepared execution with the full canonical runtime binding,
verifies all content-addressed runtime objects under explicit byte budgets, and
returns a lazy exact-input capability. The repository still has no production
publisher/reader or role-owned body codec for the referenced runtime-object
bodies. The authority therefore requires an explicit trusted role-codec port,
which only a deterministic fake implements in this checkpoint. D1 stops
at its approved ownership boundary: only located-source ports and deterministic
fakes exist, no real storage adapter or Worker Loader composition is claimed,
and D2 is not the next implementation step until the Standard Application
publication owner is separately preflighted and approved.

This preflight closes the design question left by Preflights 33 and 37: the
Cloudflare provider must reuse Flarex's existing artifact-runtime and Worker
Loader owners, but it cannot launch from `TaskComputeDispatchRequestV1` alone.
The missing full runtime binding and input evidence are resolved through a
trusted backend launch authority. They are not added to the provider-neutral
durable-task request and are not accepted from an untrusted caller.

The first implementation checkpoint remains deliberately smaller than durable
attempt supervision. It may prove that one exact task entry is loaded and
started through a private Worker Loader RPC contract. DTE06-E still owns
heartbeat, completion, result publication, cancellation acknowledgement,
worker-loss recovery, and durable settlement.

## Question

What is the smallest correct adapter that can turn one accepted, fenced Flarex
compute-delivery request into execution of the exact immutable
`durable_task` entry while:

- reusing existing Flarex materialization, module-graph, Worker Loader, cache,
  and isolation mechanics;
- preserving Trigger-derived dispatch, uncertainty, and cancellation behavior
  already admitted by Preflight 37;
- keeping Task System lifecycle and persistence authority outside the runtime;
- avoiding a second artifact runtime, a renamed `action`, or an extension of
  the public `/invoke` contract; and
- remaining testable without enabling a deployed host?

## Current Repository Evidence

### The Provider Request Is Intentionally Host-Neutral

`TaskComputeDispatchRequestV1` contains the exact scope, run, requested-effect,
attempt, fence, definition revision, lease, compute profile, cancellation
projection, and maximum duration. It deliberately contains neither a full
Standard Application runtime binding nor an input object reference.

The C2 repository reconstructs a richer `TaskComputePreparedExecutionV1` with:

- the provider-neutral dispatch request;
- the immutable runtime-binding commitment; and
- the immutable task-input reference.

The connected candidate runner currently and correctly calls
`TaskComputeProvider.dispatch` with only the provider request. Widening that
domain contract with R2, Standard Application, Worker Loader, or backend
authority would reverse the accepted dependency direction and make every
provider implementation understand Flarex hosting internals.

### The Full Runtime Contract Exists As Immutable Definition Evidence

The Standard Application task-definition owner already defines:

- `TaskDefinitionRuntimeBindingV1` and its commitment projection;
- the exact `TaskRuntimeEntryFrameV1` with logical module, artifact module,
  export name, task identity, and `group: "durable_task"`;
- content-addressed runtime object references for projection, entry, group
  manifest, and materialization specification; and
- the `flarex.r2/standard-application-task-runtime/v1` store identity and
  canonical object-key derivation.

That is the source of runtime identity. The provider request's definition
revision ID and the prepared commitment are correlation evidence; neither is a
license to synthesize a module path, export, artifact hash, or object key.

### Runtime Object Publication And Input Reading Are Not Yet Runtime Owners

The repository contains schemas, canonical codecs, digests, object references,
and definition-persistence support for task runtime objects. It does not yet
contain a production runtime-object reader/publisher that reconstructs the
Worker Loader module graph, nor a task-input reader for
`flarex.r2/task-input/v1`.

Those are prerequisites, not reasons to bypass integrity checks or pass raw R2
authority into user code. If implementation proves that runtime-object
publication is absent from the Standard Application readiness pipeline, that
is an upstream owner boundary: record the exact missing publication evidence
and stop until that owner is separately approved. DTE06-D may add the narrow
read-side ports and system-test fakes it owns; it may not silently invent a
second publication path.

### Existing Flarex Runtime Mechanics Are Reusable

The current artifact-runtime owner already provides the mechanics DTE06-D
needs:

- content-addressed source authority and immutable materialization identity;
- module-graph construction and reserved-path collision protection;
- `WorkerLoader.load(...)` and exact `getEntrypoint(...)` ownership;
- cold materialization and warm cache behavior;
- Worker result detachment, disposal, timeout, and foreign-error boundaries;
- explicit compatibility date, CPU, wall, and subrequest limits; and
- generated Worker definitions with `globalOutbound: null` for egress denial.

The older deployable `apps/artifact-runtime` route is evidence of hosted Worker
Loader composition, but it is not the task adapter. The newer
`packages/flarex-backend/src/artifactRuntime` owners are the implementation
seam to generalize. DTE06-D must not copy either implementation into a new task
runtime package.

### Existing Invocation Semantics Are Not Reusable

The ordinary application runtime resolves query/mutation entrypoints and owns
their RPC/result semantics. The older hosted route accepts `InvokeRequest` and
uses public invocation identity. Neither contract carries a Task attempt,
execution fence, cancellation generation, heartbeat sequence, or result
commitment.

A durable task therefore must not be represented as:

- `kind: "action"` or `kind: "internalAction"`;
- a query or mutation sent to the existing application execution host;
- a public `/invoke` request;
- an anonymous execution identity; or
- a runtime-selected definition, artifact, input, database, or scope.

## Trigger And Flarex Reuse Decision

Preflight 37 remains the source map for Trigger's connected runtime. DTE06-D
does not reopen that map and does not claim an unchanged Trigger package
transplant. Trigger's supervisor/workload HTTP services, organization routing,
deployment model, Docker/Kubernetes hosts, Prisma, and Redis ownership conflict
with the accepted Flarex system.

The reuse decision is:

| Concern | Decision | Owner |
| --- | --- | --- |
| Dispatch identity, uncertainty decision, same-identity replay | Preserve the admitted Trigger-derived control flow | Durable Task + backend connected runner |
| Provider request and acceptance/cancellation receipts | Reuse unchanged | `@flarex/durable-task` |
| Full binding/input resolution | Add a narrow trusted port; do not widen the provider request | `flarex-backend` |
| Runtime-object and input byte reads | Add verified adapters behind narrow ports | Existing Standard Application/R2 owners |
| Materialization, module graph, cache, Worker Loader, isolation | Reuse/generalize at the existing owner | `flarex-backend/artifactRuntime` |
| Workload HTTP API, `startRunAttempt`, snapshot polling | Discard | Trigger product/runtime host |
| Task runtime start/cancel contract | Add a private Flarex versioned RPC ABI | Private runtime protocol owner |
| Heartbeat, completion, result publication, cancellation acknowledgement | Defer | DTE06-E |
| Scheduled delivery and deployment activation | Defer | DTE05-E3 after DTE06-F |

This is reuse-first integration: Trigger-derived task behavior stays in the
admitted lifecycle/delivery decisions, and existing Flarex runtime mechanics
stay in their current owner. New code is limited to the adapter contract that
neither existing system can supply.

## Accepted Architecture

```text
TaskComputeDispatchRequestV1
  -> TaskRuntimeLaunchAuthority.resolve(request)
       -> trusted scope/definition lookup
       -> exact full runtime binding + commitment correlation
       -> verified runtime object reads
       -> verified task input reference
       -> owned TaskRuntimeLaunchSubject
  -> Task Worker definition/materialization
       -> existing source authority + module graph + Worker Loader cache
       -> globalOutbound: null + restricted bindings
  -> private Task Runtime RPC V1
       -> start exact durable_task entry
       -> return dispatch acceptance identity
       -> request generation-correlated interruption
  -> TaskComputeProvider receipt

DTE06-E only:
  runtime heartbeat/completion/cancellation acknowledgement
    -> fenced Task System lifecycle commands
  result bytes
    -> result object store
    -> bounded TaskResultCommitmentV1
```

### Trusted Launch Authority

Add an unversioned backend service capability named for its role, such as
`TaskRuntimeLaunchAuthority`. It accepts one already captured
`TaskComputeDispatchRequestV1` and returns one owned, immutable launch subject.
It must:

1. resolve the trusted scope from `request.identity.scopeId` without accepting
   a caller-selected database target;
2. load the exact definition revision named by the request;
3. decode the full canonical `TaskDefinitionRuntimeBindingV1`;
4. correlate every commitment facet already persisted in C2 prepared evidence,
   including application revision, task ID, task entry, catalog/root hashes,
   package/artifact/source/semantic hashes, and runtime-object references;
5. verify the entry is `group: "durable_task"` and matches the exact task
   definition revision;
6. load runtime objects by their declared store, key, byte length, and digest;
7. load or mint only a narrow read capability for the exact input reference;
8. derive the Worker materialization identity and permitted compute limits from
   trusted evidence and policy; and
9. return owned values without raw rows, Drizzle handles, R2 buckets, account
   credentials, or mutable caller objects.

The launch authority is not a lifecycle repository and cannot create attempts,
renew leases, acknowledge cancellation, complete runs, or decide retries.

### Read-Side Object Ports

DTE06-D may introduce two narrow read capabilities at their existing owners:

- a task-runtime-object reader for the exact Standard Application runtime
  object reference; and
- a task-input reader for the exact `TaskInputReferenceV1`.

Both must verify store identity, canonical key, byte length, digest, maximum
size, and codec before returning owned bytes or a narrower decoded value. A
missing, truncated, mismatched, unsupported, or corrupt object fails closed.
No compatibility fallback may search another bucket, infer another key, accept
an unchecked body, or use application source as a replacement runtime object.

The task input can be as large as the durable-task contract permits. The
implementation must therefore prove its chosen Worker boundary rather than
assuming a 32 MiB body can be copied through RPC safely. Preferred order:

1. pass only the exact input reference plus a private input-read capability;
2. let the runtime read through that capability after exact launch identity is
   established; and
3. admit direct byte transfer only if Miniflare and hosted evidence prove its
   limits, ownership, and cancellation behavior.

The child Worker never receives a general R2 binding or bucket authority.

### Private Task Runtime ABI

The RPC/wire shapes are concrete compatibility contracts and may use `V1`.
Capability/service implementations remain unversioned under the repository
naming rule.

The minimum ABI consists of:

- `TaskRuntimeStartRequestV1`
  - exact compute dispatch identity;
  - task-definition revision and immutable runtime-binding commitment;
  - exact task runtime entry identity;
  - compute profile and bounded maximum duration;
  - current cancellation projection;
  - exact input reference or an opaque exact-input capability; and
  - private callback/correlation token derived by the trusted host, not a
    public bearer credential;
- `TaskRuntimeStartAcceptanceV1`
  - the same dispatch identity;
  - one provider execution ID;
  - `kind: "accepted"`; and
  - no claim that the task completed, heartbeated, or became durable merely
    because the RPC returned;
- `TaskRuntimeCancellationRequestV1`
  - exact dispatch identity and execution ID;
  - monotonic cancellation generation; and
- `TaskRuntimeCancellationAcceptanceV1`
  - exact identity, execution ID, and accepted generation;
  - meaning only that interruption delivery was accepted, not that Task System
    cancellation was acknowledged.

The ABI must have strict codecs, exact version checks, owned input capture,
canonical evidence where bytes cross a persistence/replay boundary, hostile
input tests, and no public HTTP representation. Reserved RPC methods and
unexpected exports fail closed.

### Worker Loader Runtime Profile

The task profile reuses the existing application runtime machinery but has a
separate task entrypoint and host kit. It must:

- construct the exact module graph from verified immutable runtime objects;
- reject missing, extra, colliding, or digest-mismatched modules;
- resolve only the declared `durable_task` module/export pair;
- preserve materialization identity across cold and warm starts;
- set `globalOutbound: null` unless a later separately approved compute profile
  introduces a restricted outbound capability;
- expose no raw Task tables, persistence transaction, tenant routing,
  Cloudflare account credential, R2 bucket, or unrestricted service binding;
- map compute-profile limits to supported Worker Loader limits through trusted
  policy; and
- dispose RPC stubs/results and classify foreign runtime failures without
  converting defects or interruption into ordinary task outcomes.

It may share total construction mechanics with the existing application
materializer and execution host. It must not make the ordinary application
host understand Task lifecycle, and must not copy its query/mutation result
contract into the task ABI.

### Dispatch Acceptance Is Not Durable Supervision

Cloudflare RPC begins an execution context when a `WorkerEntrypoint` method is
invoked. `ctx.waitUntil()` can extend work after an RPC or response returns,
but that extension is bounded and may be cancelled when the caller disconnects
or the platform limit is reached. It is useful for proving a private start
handshake; it is not durable attempt authority.

Platform evidence for that boundary is the official Cloudflare
[`Workers RPC lifecycle`](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/)
and
[`Context / waitUntil`](https://developers.cloudflare.com/workers/runtime-apis/context/)
documentation. DTE06-D must reverify those semantics during hosted proof rather
than treating this docs snapshot as a permanent platform guarantee.

For DTE06-D, provider acceptance means only:

1. the exact request and runtime ABI were decoded;
2. the exact Worker definition/entrypoint was selected;
3. the runtime accepted the same identity and execution ID; and
4. the provider can replay that acceptance or request interruption for the
   same identity.

It does not mean the handler completed, a heartbeat was stored, cancellation
was acknowledged, or the attempt survived loss of both Worker contexts. The
DTE06-D adapter remains production-inert until DTE06-E/F prove the durable
supervision topology. If that proof requires Queue, Durable Object, Workflow,
or another host owner, it requires its own explicit preflight; DTE06-D must not
silently add one.

### Cancellation

Cancellation delivery remains generation-correlated:

- a generation lower than the accepted dispatch projection or previously
  accepted cancellation is stale;
- the same generation is idempotent;
- a newer generation may request interruption for the exact execution;
- an unknown execution or lost Worker cannot be reported as acknowledged; and
- process-local maps are cache hints only, never the source of cancellation or
  attempt truth.

DTE06-D may return `interruption_requested` after the child runtime accepts the
generation. DTE06-E alone may turn runtime evidence into the existing fenced
Task cancellation acknowledgement.

## Failure Ownership

The implementation keeps failures at the boundary that can explain and act on
them:

| Failure | Owner/disposition |
| --- | --- |
| Scope/definition/commitment mismatch | Launch authority; reject before Worker Loader |
| Runtime object/input missing or corrupt | Object reader/launch authority; fail closed |
| Unsupported compute profile or duration | Provider policy; typed rejection |
| Worker definition/module collision | Existing artifact-runtime owner |
| Worker Loader transport/materialization failure | Cloudflare adapter; typed transport failure |
| Task ABI decode/correlation failure | Private runtime ABI/adapter; typed rejection |
| Handler throws or returns invalid result | DTE06-E runtime settlement owner, not provider delivery |
| Lease/fence/cancellation changes after launch | DTE06-E lifecycle commands and C2 delivery recovery |
| Unknown start response | Existing C3 unknown-delivery recovery; exact same-identity replay |
| Worker/context loss after accepted start | DTE06-E expiry/reacquisition; never synthesize completion |

Provider delivery errors do not directly mutate Task lifecycle. The C2
repository records only its admitted delivery evidence and the Task lifecycle
owner remains the sole transition authority.

## Ordered Implementation Checkpoints

### DTE06-D1: Launch-Subject Resolution

- add the private backend launch-authority service and owned launch subject;
- add or reuse exact full-binding lookup through a trusted scope capability;
- add narrow runtime-object and input readers with deterministic memory fakes;
- correlate the provider request, C2 commitment, full binding, entry, and object
  references;
- prove hostile input, corruption, stale definition, wrong scope, and exact
  receiver/Effect error ownership; and
- stop if the required runtime objects are not published by the owning Standard
  Application readiness path.

No Worker Loader call is admitted in D1.

### DTE06-D2: Private ABI And Runtime Core

- define the strict versioned start/cancel RPC codecs;
- add a task-specific Worker entrypoint/runtime core that resolves only the
  verified `durable_task` export;
- add a narrow input-read bootstrap capability;
- prove identity/cancellation correlation and deterministic cold runtime tests;
- retain heartbeat/completion/result callbacks as explicitly unavailable DTE06-E
  ports; and
- keep the contract private and absent from public package exports unless an
  exact internal subpath and boundary checker are approved.

No real provider composition is admitted in D2.

### DTE06-D3: Worker Loader Provider Adapter

- compose launch authority, existing materializer/module graph, Worker Loader,
  and the private task RPC;
- implement the real Cloudflare `TaskComputeProvider` adapter without changing
  the provider-neutral interface;
- preserve exact dispatch acceptance and generation-correlated cancellation;
- prove cold/warm materialization, idempotent replay, unknown response,
  unsupported profile, lost execution, timeout, and cleanup behavior;
- prove no import or runtime fallback to `InvokeRequest`, `/invoke`, action,
  query, or mutation hosts; and
- keep the adapter absent from every deployable composition root.

### DTE06-D4: Private System-Test Composition

- compose the D3 adapter only in an explicitly private Miniflare/system-test
  owner;
- execute one canonical Standard Application `durable_task` entry with an exact
  immutable input reference;
- prove same-identity duplicate dispatch and monotonic cancellation delivery;
- prove egress denial, capability restriction, module/object corruption,
  reserved-path rejection, and cache identity;
- prove interruption/external cancellation preserves `Cause` and cleanup;
- inspect the bundle/import graph for Trigger, Prisma, Redis, Node-host, and
  legacy invocation dependencies; and
- record that no host, route, binding, deployment, heartbeat, completion, or
  result settlement exists.

## Validation Matrix

| Claim | Minimum evidence |
| --- | --- |
| Provider domain remains host-neutral | package boundary/type tests; no Standard Application/R2/Worker Loader imports in `@flarex/durable-task` |
| Exact launch subject | full-binding/commitment/reference correlation tests with hostile and corrupt inputs |
| Object ownership | length/digest/codec/key tests; detached owned bytes; no raw bucket capability |
| Existing runtime reuse | source map plus tests using the existing module graph/materializer/Worker Loader constructors |
| Private strict ABI | encode/decode/canonical/hostile/correlation tests and boundary checker |
| Isolation | `globalOutbound: null`, restricted bindings, no raw DB/R2 credentials, denied egress test |
| Cold/warm correctness | Miniflare or Worker Loader system tests with one materialization identity |
| Acceptance semantics | start handshake proves exact identity but no lifecycle completion claim |
| Cancellation semantics | lower/same/newer generation tests and unknown-execution non-acknowledgement |
| Unknown delivery | existing C3 moved/unchanged/uncertain recovery lane with real adapter test double or system test |
| Cleanup | timeout/interruption/lost-response finalizer and RPC stub disposal tests |
| No fallback | bundle/import checks and negative tests for `/invoke`, action, query, mutation paths |
| Cloudflare behavior | hosted proof before any production-capable claim; Miniflare alone is not hosted parity |

Every significant code checkpoint requires package typecheck, focused Effect
tests, boundary checks, scoped diff checks, and both project reviewers. Schema
or transaction changes are not expected; if discovered, stop and preflight
their persistence owner separately.

## Explicit Non-Goals

DTE06-D does not authorize:

- changing `TaskComputeDispatchRequestV1` or exposing C2 prepared evidence to a
  provider as raw persistence authority;
- a generic requested-effect consumer;
- a second artifact materializer, module graph, cache, executor, or user-code
  runtime;
- a public task HTTP endpoint or extension of `/invoke`;
- reusing action/internal-action lifecycle or contexts;
- heartbeat, completion, result-object publication, Task lifecycle
  cancellation acknowledgement, retry decisions, or lease renewal;
- process-local execution state as durable truth;
- direct Trigger workspace imports, Prisma, Redis, Redlock, Trigger product
  identity, or Trigger compute hosts;
- Queue, Cron Trigger, Workflow, Durable Object, Worker route, binding,
  deployment, or production activation; or
- claims of Trigger runtime parity from a private Worker Loader adapter.

## Stop Boundary

### DTE06-D1 implementation receipt

The completed production-inert foundation adds:

- `flarex-backend/internal/task-runtime-launch`, containing the unversioned
  `TaskRuntimeLaunchAuthority` service and its explicit multi-instance located
  source/directory ports;
- exact decoding and correlation of `TaskComputeDispatchRequestV1`, the C2
  `TaskComputePreparedExecutionV1`, the full
  `TaskDefinitionRuntimeBindingV1`, and its canonical commitment projection;
- bounded, content-addressed reads for every declared task runtime object,
  including owned-byte capture, exact byte-length/digest verification, and a
  required trusted role-codec validation capability;
- a lazy exact-input capability that revalidates the immutable input reference
  and canonical Flarex value evidence on every read; and
- Trigger boundary admission for only the exact provider-request and
  input-reference symbols consumed by this private owner, with negative host
  import coverage.

Focused evidence is package typecheck, ten deterministic authority tests,
the live Trigger compatibility checker, its 27-test suite, scripts typecheck,
and both required project reviewers. No schema, migration, transaction,
Worker Loader call, runtime ABI, route, binding, host, or deployment is part of
this checkpoint.

Repository inspection confirmed the stop condition anticipated by this
preflight: Standard Application definitions persist the full binding and
content-addressed references, while task creation persists the immutable input
reference, but no production owner publishes, serves, and role-decodes the
referenced runtime-object bodies. A fake adapter would conceal that missing
readiness guarantee.
The next roadmap action was therefore a separate Standard Application
runtime-object publication/read-authority preflight. SAP-TRP1 is now complete:
all five role codecs, root preimages, and the private ABI/materialization
identities are fixed. DTE06-D2 may proceed under this preflight, while the real
D1 located adapter and DTE06-D3 remain blocked on later publication/readiness
and the separate run-input store.

That owner preflight is now recorded in
[`39-standard-application-task-runtime-publication.md`](./39-standard-application-task-runtime-publication.md).
Its approved pure canonical role-contract checkpoint is complete. No
persistence, R2, readiness, real located reader, Worker Loader, or host was
added by that checkpoint.

This preflight authorizes only DTE06-D1 through D4 in the stated order. The
first code slice is D1 launch-subject resolution and read-side object ports. It
must stop before Worker Loader composition if exact runtime objects are not
already published by the Standard Application owner.

Completion of DTE06-D proves only that the exact immutable task entry and input
can be accepted by a restricted Worker Loader runtime through a private ABI,
with idempotent dispatch identity and generation-correlated interruption
delivery. It does not prove durable task completion, supervision, result
storage, hosted platform parity, or production readiness.

DTE06-E follows with a separate preflight for the durable supervision and
settlement topology. DTE06-F then owns the private end-to-end hosted proof.
Only after those gates may DTE05-E3 consider a scheduled Worker host and
activation.
