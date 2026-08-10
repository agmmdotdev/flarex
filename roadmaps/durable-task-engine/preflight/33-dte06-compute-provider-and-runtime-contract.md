# Preflight 33: DTE06 Compute Provider And Runtime Contract

## Status

**Decision:** DTE06-A completed the docs-only source, ownership, reuse, and
contract preflight on 2026-08-10. DTE06-B was subsequently approved and is now
complete as a private host-neutral provider contract plus deterministic
in-memory conformance adapter.

DTE06-B adds only TypeScript and the two private package exports owned by
`@flarex/durable-task`. It adds no database schema/migration, Worker route,
binding, deployment configuration, requested-effect consumer, Cloudflare
adapter, or production activation.

## Question

How should a durably granted Flarex task attempt reach compute while reusing the
existing Worker Loader/artifact runtime, preserving Postgres and Task System
authority, and supporting deterministic in-memory and Cloudflare adapters?

## Sources Inspected

### Durable Task And Persistence

- `packages/durable-task/src/runAttempt/Model.ts` and its codecs/services for
  attempt, fence, lease, heartbeat, completion, cancellation, and requested-
  effect contracts;
- `packages/durable-task/src/runCreation` for immutable input references;
- `packages/persistence-postgres/src/taskSystemRunAttemptStoreV1.ts` for the
  scope-bound lifecycle transaction adapter;
- `packages/persistence-postgres/src/taskSystemRunReadV1.ts` for read-only due
  and requested-effect capabilities; and
- Roadmaps 04 and 05 for durable-state, wake, repair, and effect ownership.

### Standard Application Runtime Binding

- `packages/standard-application-definition/src/taskDefinition` for the
  canonical task definition, `durable_task` runtime entry, application-revision
  task binding, and immutable runtime-object evidence; and
- DTE02-D/DTE04-A2b decisions for `TaskRuntimeMaterializationSpecV1` and trusted
  definition authority.

### Existing Execution Runtime

- [`../../06-dynamic-worker-execution.md`](../../06-dynamic-worker-execution.md)
  for the continuing artifact-runtime authority;
- `packages/flarex-backend/src/artifactRuntime.ts` for the backend-to-runtime
  service-binding boundary;
- `packages/flarex-backend/src/artifactRuntime/HostKit.ts` for shared local and
  hosted Worker construction mechanics;
- `packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts` and
  Function API Core for the restricted generated runtime;
- `apps/artifact-runtime/src/worker.ts` for R2 loading, Worker Loader
  materialization, caching, and internal invocation; and
- current runtime tests for Miniflare/hosted payload parity, authentication,
  module collision, restricted syscalls, retry/abort, and response validation.

### Trigger Compatibility Source

The pinned Trigger.dev island remains a semantic and failure-scenario oracle
for compute supervision, heartbeat, cancellation, and retry behavior. It is not
an importable runtime or package dependency, and its organization, Prisma,
Redis, deployment, and compute-host models are not Flarex authority.

## Findings

### 1. Runtime Mechanics Are Reusable; Invocation Semantics Are Not

The current artifact runtime already owns the expensive and security-sensitive
mechanics that Roadmap 06 needs: immutable artifact resolution, R2 reads,
Worker Loader definitions, module collision checks, runtime caches, private
service bindings, restricted syscalls, egress denial, and local Miniflare
parity.

Its current contract is nevertheless an ordinary `InvokeRequest` path for
queries and mutations. It has no durable attempt/fence/lease identity and no
task heartbeat, cancellation, result-store, or completion protocol. Routing a
task through that contract as an `action` would erase Task authority and make
action retry/response behavior compete with the lifecycle model.

**Decision:** generalize the existing artifact-runtime owner at a lower shared
materialization/host-kit seam and add a separate private task ABI/profile. Do
not build a second materializer and do not extend public `/invoke` by stealth.

### 2. `dispatch_attempt` Is Durable Intent, Not A Provider Command

The lifecycle atomically appends a `dispatch_attempt` requested effect with the
run version, definition revision, attempt reference, lease version, and compute
profile. The persistence package can page that ledger but intentionally cannot
claim, acknowledge, or deliver it.

Between effect creation and delivery, the attempt can be cancelled, completed,
replaced, expire, or become corrupt/stale relative to trusted scope or runtime
authority. A dispatcher cannot safely deserialize the row and call compute
directly.

**Decision:** Roadmap 06 owns an operation-specific preparation step that
freshly correlates Task state, effect identity, definition/runtime binding,
input reference, lease, and cancellation before constructing an owned provider
request. Generic requested-effect delivery remains prohibited.

### 3. Dispatch Requires Stable Idempotency And Durable Coordination

Cloudflare service-binding delivery may succeed while the response is lost.
A process-local flag cannot distinguish rejection from accepted-but-unknown,
and allocating a new attempt would violate the lifecycle fence.

**Decision:** a later DTE06-C schema preflight must define a narrow dispatch
claim/checkpoint keyed by the exact scope/effect/attempt/fence identity. It may
coordinate competing hosts and remember exact provider acceptance, but it may
not alter Task lifecycle, extend a lease, or make provider state authoritative.
Uncertainty always retries the same provider dispatch identity.

### 4. Provider Acceptance Is Not Task Execution Evidence

A Worker Loader adapter can report that it accepted or recovered an idempotent
dispatch. That does not prove the task started, heartbeated, completed, or
acknowledged cancellation.

**Decision:** keep provider dispatch/cancellation receipts separate from Task
System lifecycle receipts. Only accepted fenced Task System operations move a
run from `attempt_granted` to `executing` or terminal state.

### 5. Task Retry Policy Must Stay Above Runtime Transport

The current invocation runtime has bounded mutation OCC retry/abort behavior.
Those retries repeat one invocation/session attempt; they are not durable task
attempt retries. Durable retry count, backoff, compute escalation, lease loss,
and terminal classification already belong to `@flarex/durable-task`.

**Decision:** the provider reports a validated execution outcome. The Task
lifecycle decides retry or terminal state. Runtime transport may retry only an
idempotent delivery or an explicitly retained inner OCC operation, never create
a new Task attempt or reinterpret Task policy.

### 6. Cancellation Needs Its Own Operation-Specific Delivery

`request_execution_cancellation` carries attempt ID, fence, and cancellation
generation. It can race with initial dispatch, provider acceptance, heartbeat,
completion, lease expiry, and a newer cancellation generation.

**Decision:** Roadmap 06 owns a separate idempotent provider cancellation
operation. The provider may interrupt compute, but only an exact fenced
`cancellation_acknowledged` completion resolves Task state. Provider
interruption, host abort, and lease expiry remain distinct evidence.

### 7. Input And Result Bodies Need Trusted Object-Store Adapters

The run already commits an immutable `TaskInputReferenceV1`. The attempt result
model stores only a bounded `TaskResultCommitmentV1`; it deliberately does not
store the result body in Postgres.

**Decision:** the compute host must verify and bound input bytes before user
code. It must publish successful result bytes content-addressably before
submitting completion, and replay the same commitment after an uncertain/lost
completion response. Exact result-reference/read/retention ownership must close
before DTE06-E; Roadmap 07 owns consumer-facing reads and streams.

### 8. A Host-Neutral Port Is Necessary

The same dispatch, cancellation, duplication, uncertainty, and lifecycle
contract needs a deterministic fast test lane and a Cloudflare implementation.
Embedding Worker Loader types in the domain would make in-memory testing a
mock of Cloudflare rather than a conformance adapter.

**Decision:** define a private provider-neutral port with a deterministic
in-memory adapter first. Cloudflare-specific bindings, Worker definitions,
service stubs, placement, and errors stay in the Cloudflare adapter.

## Fixed DTE06-A Contract

The roadmap now fixes these boundaries:

1. `TaskComputeProvider` is Task-specific and provider-neutral; it is not one
   universal database/runtime API.
2. It supports idempotent dispatch and generation-correlated cancellation as
   separate operations.
3. Provider requests are created only from fresh, scope-bound Task and Standard
   Application authority.
4. Stable dispatch identity includes the exact requested effect and attempt
   execution fence; retries never allocate a new attempt.
5. Provider acceptance/checkpoint, heartbeat, completion, and cancellation
   acknowledgement are distinct receipts.
6. PostgreSQL remains run/attempt/lease/fence authority; provider and checkpoint
   state are subordinate coordination evidence.
7. Task runtime ABI is versioned separately from public `/invoke` and does not
   encode the task as an action.
8. Existing artifact materialization, HostKit, Worker Loader, R2, restricted
   syscalls, authentication, and cache mechanics must be reused at their owning
   seams.
9. Input and result bodies stay in bounded object storage; Task System stores
   references/commitments and lifecycle state only.
10. The first implementation is private, deterministic, and production-inert.

## Admitted DTE06-B Surface

DTE06-B is confined to `@flarex/durable-task`. The production contract belongs
at the private
`@flarex/durable-task/internal/compute-provider-v1` subpath, with deterministic
adapter construction isolated behind the private
`@flarex/durable-task/internal/compute-provider-testing-v1` subpath. Neither
contract may move to `@flarex/executor`, `flarex-backend`, or a generic utility
package.

`flarex-backend` later owns effect delivery, trusted resolution, and provider
composition. The existing artifact-runtime owner later implements the
Cloudflare adapter. DTE06-B should add:

- owned, versioned provider dispatch and cancellation request models;
- provider acceptance/cancellation delivery receipts;
- tagged typed errors separating invalid input, stale/cancelled preparation
  outcomes supplied by the caller, definite provider rejection, retryable
  transport failure, uncertainty, and contract violation;
- a `TaskComputeProvider` Effect service/port whose lifecycle requirements are
  explicit;
- deterministic frozen snapshots and hostile-input/receiver tests; and
- an in-memory adapter that records exact dispatch identity and returns the
  same acceptance for duplicate delivery.

DTE06-B must not add:

- effect-ledger reads or claims;
- a Postgres table or migration;
- Standard Application/R2 resolution;
- a task runtime payload or generated Worker source;
- `flarex-backend` or app composition;
- Cloudflare Worker Loader types or bindings; or
- heartbeat/completion lifecycle calls.

This separation proves the reusable core contract before infrastructure
composition, while keeping DTE06-C/D/E large enough to prove real behavior
rather than accumulating isolated helpers.

## DTE06-B Completion Receipt

The admitted implementation proves:

- exact request/receipt decoding, branding, ownership, and runtime freezing;
- stable dispatch idempotency across duplicate calls;
- no aliasing of caller-owned nested values; DTE06-B deliberately carries no
  payload byte-array field;
- one-read/receiver-preserving provider method capture;
- distinct definite rejection, retryable transport, uncertainty, cancellation,
  and malformed-receipt failures;
- same-fence duplicates return the original acceptance;
- different scope/run/effect/attempt/fence identities cannot collide;
- lower or duplicate cancellation generations are idempotent/stale according
  to the fixed contract;
- provider cancellation never manufactures Task acknowledgement;
- Effect interruption/timeout semantics match the installed Effect version;
  and
- no import from persistence, backend apps, Cloudflare Worker types, Wrangler,
  or the Trigger source island.

The compatibility boundary admits only the two new private exports and the
protocol-owned replacement-scope authority type. It continues to reject
persistence, backend, Node-host, Cloudflare, Wrangler, Prisma, Redis, and
Trigger-island imports. Package tests, package typecheck, Effect/source-map
checks, the compatibility boundary, and both required project reviewers are
the completion gates.

## Deferred Decisions

The following are intentionally not fixed by DTE06-A and require their owning
checkpoint:

- dispatch checkpoint table shape, claim deadlines, retry ceilings, and GC
  (subsequently closed by
  [`34-dte06-durable-compute-delivery.md`](./34-dte06-durable-compute-delivery.md));
- whether the deployable artifact-runtime Worker uses a distinct private route
  or Workers RPC after current platform evidence is inspected;
- exact task runtime module entrypoint and context fields;
- heartbeat cadence and host/platform deadline budgets;
- result object key, reference codec, maximum bytes, retention, and GC;
- compute-profile-to-Cloudflare placement mapping;
- hosted logs/traces/output stream ports;
- AgentOS adapter design; and
- public SDK or observability APIs.

Deferral does not authorize an implementation default. Each item must be closed
before the checkpoint that depends on it.

## Activation Dependency

DTE05-E3 remains blocked. Activating cron before a provider can accept,
supervise, and settle a granted attempt could create leases with no safe
compute consumer. After DTE06-F proves the private execution vertical,
DTE05-E3 may separately preflight:

- reuse/generalization of `apps/executor/src/scheduledLifecycle.ts`;
- the Worker `scheduled()` handler;
- Wrangler Cron Trigger configuration;
- plan/interval-specific count, CPU, wall, and settlement budgets; and
- disabled-by-default deployment and rollback controls.

Neither DTE06-F nor DTE05-E3 automatically activates production scheduling.

## Stop Boundary

DTE06-B did not authorize:

- implementing DTE06-C without its own preflight and explicit approval; C0 is
  now complete, while C1 still requires explicit approval under
  [`34-dte06-durable-compute-delivery.md`](./34-dte06-durable-compute-delivery.md);
- changing the current action/query/mutation runtime behavior;
- adding a generic effect-delivery engine;
- adding or changing Task, application, OCC, commit, journal, outbox, or feed
  schemas;
- importing Trigger.dev runtime packages;
- adding a Worker route, service binding, queue consumer, scheduled handler,
  Wrangler Cron Trigger, deployment, or production activation; or
- marking DTE06, DTE05-E3, DTE05-E, or Roadmap 05 complete.
