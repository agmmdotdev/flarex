# Compute Provider And Durable Task Runtime

## Status And Scope

**Status:** Active roadmap. DTE06-A's docs-only source/contract preflight and
DTE06-B's private host-neutral provider domain are complete and
production-inert. DTE06-C0 now completes the docs-only durable-delivery schema
and transaction preflight, and DTE06-C1 completes its canonical evidence and
Task-owned storage checkpoint. Their contracts and implementation receipt live in
[`preflight/33-dte06-compute-provider-and-runtime-contract.md`](./preflight/33-dte06-compute-provider-and-runtime-contract.md).
The C0 schema/transaction decision is recorded in
[`preflight/34-dte06-durable-compute-delivery.md`](./preflight/34-dte06-durable-compute-delivery.md).
The provider port, deterministic in-memory conformance adapter, canonical
evidence boundary, and checkpoint tables now exist; no requested-effect
delivery operation, checkpoint transaction, task runtime route, Worker binding,
deployment configuration, or production activation is admitted. DTE06-C2 and
later checkpoints require separate approval.

Roadmaps 01 through 05 already establish first-class task definitions,
scope-bound durable run state, fenced attempts, requested effects, Queue wake
hints, and durable repair. This roadmap owns the missing boundary between one
durably granted attempt and restricted user-code execution through a
Flarex-owned compute provider.

It must reuse the repository's existing artifact-runtime and Worker Loader
mechanics without making a durable task an `action`, extending public `/invoke`
semantics by accident, or giving a runtime authority over Task System state.

## Goal

Prove one private, production-inert execution vertical:

1. read one persisted `dispatch_attempt` requested effect under a trusted,
   scope-bound capability;
2. freshly revalidate its run, attempt, execution fence, lease, cancellation
   state, definition revision, immutable application revision, runtime objects,
   input reference, and compute profile;
3. establish one operation-specific dispatch claim/checkpoint without making
   that checkpoint lifecycle authority;
4. deliver one idempotent provider request through a host-neutral
   `TaskComputeProvider` contract;
5. execute the exact `durable_task` runtime entry through reused Flarex artifact
   materialization and restricted runtime capabilities;
6. submit fenced heartbeats, cancellation acknowledgement, and terminal
   completion through the existing Task System lifecycle operations;
7. store result bodies outside the Task System tables and commit only their
   bounded content commitment; and
8. recover correctly from duplicate delivery, dispatch uncertainty, provider
   loss, lease expiry, cancellation races, and a lost completion response.

The first vertical remains private and unwired. It is an architectural and
correctness prerequisite for DTE05-E3; it is not production activation.

## Current Reality

### Existing Task Owners

The current workspace already provides:

- a host-neutral `@flarex/durable-task` lifecycle with attempt IDs, monotonic
  execution fences, lease versions, heartbeat sequences, cancellation
  generations, retry policy, terminal completion, and requested effects;
- a scope-bound Drizzle/PostgreSQL Task System store that atomically persists
  the aggregate, acceptance evidence, and ordered requested effects;
- read-only, bounded due-discovery and requested-effect-ledger capabilities;
- trusted scope resolution, Queue wake hints, bounded repair sweeps, and a
  durable repair checkpoint; and
- canonical Standard Application task-definition/runtime binding evidence for
  the `durable_task` artifact group.

The requested-effect ledger deliberately has no claim, acknowledgement, or
delivery operation yet. A row containing `dispatch_attempt` is durable intent,
not permission for arbitrary code to invoke compute.

### Existing Runtime Owners

[`../06-dynamic-worker-execution.md`](../06-dynamic-worker-execution.md) and
current code provide substantial reusable runtime mechanics:

- immutable execution-artifact references and R2-backed source loading;
- local Miniflare and hosted Worker Loader materialization;
- shared module construction and reserved-path collision checks;
- generated runtime shells with narrow context/syscall facades;
- authenticated artifact-runtime and executor service bindings;
- egress-denied hosted user code;
- artifact/materialization identity caches; and
- typed runtime-response decoding, abort, OCC, and cleanup behavior for current
  query/mutation invocation.

Those owners do **not** currently provide a durable task ABI. The current
hosted route accepts an `InvokeRequest`, resolves registered query/mutation
functions, and returns an ordinary invocation response. Actions and workflow
mutations are intentionally unsupported. There is no Task attempt identity,
execution fence, heartbeat, cancellation, result-object publication, or Task
completion callback in that contract.

### Existing Prototype Evidence Is Not Task Authority

Current `action` and `internalAction` behavior remains prototype evidence for
runtime isolation, outbound I/O, and callback mechanics. It does not own task
identity, retry policy, attempt state, task context, result durability, or
scheduling. A task must never be encoded as `kind: "action"` merely to reach
the existing runtime.

## Ownership And Dependency Direction

| Concern | Owner |
| --- | --- |
| Run/attempt lifecycle, fences, retry, heartbeat, cancellation, completion | `@flarex/durable-task` |
| Scope-bound rows, transactions, dispatch checkpoint DDL/SQL if admitted | `@flarex/persistence-postgres` |
| Tenant/deployment/scope/revision resolution and provider composition | `flarex-backend` |
| Canonical task definition and immutable runtime binding | Standard Application definition owners |
| Artifact loading, runtime projection, Worker construction, restricted host kit | Existing artifact-runtime owners |
| Provider-neutral task dispatch/cancel contract and in-memory conformance adapter | `@flarex/durable-task` private compute-provider subpaths |
| Effect delivery, trusted resolution, and provider composition | `flarex-backend` |
| Cloudflare Worker Loader task provider adapter | Existing artifact-runtime/Cloudflare host owner |
| Task input/result body storage and retention | R2-backed object-store owner admitted by Roadmap 06 |
| Public task API | Later public SDK roadmap |
| Run reads, events, logs, traces, live status, output streaming | Roadmap 07 |

The dependency direction is:

```text
scope-bound Task requested effect
  -> operation-specific dispatch preparation and checkpoint
  -> trusted definition/runtime/input resolution
  -> TaskComputeProvider
       -> deterministic in-memory adapter for conformance
       -> Cloudflare artifact-runtime / Worker Loader adapter
  -> fenced Task System heartbeat, completion, and cancellation operations
```

Neither provider adapter receives a tenant-selected database target, raw
Postgres/Drizzle capability, Task tables, scheduler capability, Cloudflare
account credentials, or authority to create a new attempt.

## Reuse Boundary

### Reuse Directly Or Generalize At The Existing Owner

- content-addressed artifact identity and R2 loading;
- runtime-projection verification and immutable object resolution;
- Worker Loader definition/materialization and cache identity;
- module collision and reserved-module enforcement;
- generated-runtime isolation and egress denial;
- private service-binding authentication and credential-version identity;
- executor-backed restricted database syscalls where the task runtime profile
  explicitly admits them;
- response-size, JSON, error, cleanup, and source-map mechanics where their
  exact semantics match; and
- local Miniflare construction for fast conformance tests.

Shared mechanics stay with the existing artifact-runtime owner. Roadmap 06 may
add a narrow task profile or task route to that owner; it must not fork the
materializer, cache, runtime shell, or executor protocol into a second runtime
package.

### Adapt Behind A Task-Specific Contract

- invocation payload becomes a versioned task-attempt execution envelope;
- function-path lookup becomes resolution of the immutable `durable_task`
  runtime entry for the persisted task-definition revision;
- request/response completion becomes heartbeat and fenced lifecycle commands;
- ordinary result values become bounded result-object publication plus a
  `TaskResultCommitmentV1`;
- runtime timeout becomes the task's bound maximum duration and lease policy;
- provider cancellation becomes generation-correlated interruption followed by
  Task System acknowledgement or lease-expiry recovery; and
- provider placement becomes a trusted interpretation of
  `TaskComputeProfileRefV1`, never caller-selected routing.

### Do Not Reuse As Task Semantics

- `InvokeRequest`, public `/invoke`, query/mutation/action identity, or HTTP
  request/response identity;
- anonymous execution identity defaults;
- `FLAREX_INVOKE_MAX_ATTEMPTS` or mutation OCC retries as durable task retry
  policy;
- current action/internal-action names or contexts;
- legacy partition keys, deployment IDs, or artifact refs supplied by an
  untrusted request;
- runtime HTTP status as a Task lifecycle outcome;
- process-local timers or a Worker instance as attempt authority; or
- Trigger.dev organization/project/environment, Prisma, Redis, Redlock, or
  compute-host models.

## Required Contracts

### Operation-Specific Dispatch Preparation

Roadmap 06 must not add a generic consumer for every requested-effect kind. It
may add only the operations it owns:

- `dispatch_attempt`; and
- `request_execution_cancellation`.

Dispatch preparation starts from a scope-bound requested-effect cursor and
must freshly correlate:

- requested-effect sequence, `runId`, and accepted run version;
- task-definition revision;
- attempt ID, attempt number, and execution fence;
- lease version and current database-clock eligibility;
- compute profile;
- current cancellation state/generation;
- immutable application revision and `durable_task` runtime binding; and
- immutable task input reference.

A stale, terminal, replaced, expired, corrupt, or authority-mismatched effect
must not reach a provider. The resulting provider request contains owned,
decoded values and opaque capabilities/references, never a raw row or caller-
owned object.

### Dispatch Claim And Checkpoint

At-least-once delivery and an uncertain service-binding response require one
operation-specific durable dispatch protocol. Its exact schema is deferred to
DTE06-C, but its authority is fixed now:

- identity is at least trusted scope plus run, requested-effect sequence,
  attempt ID, and execution fence;
- a claim is a bounded host-coordination lease, not run/attempt authority;
- provider dispatch uses one stable idempotency identity across claim takeover
  and uncertain retry;
- provider acceptance is recorded only after the adapter proves the provider
  accepted that exact identity;
- uncertainty replays the same identity and never allocates a new attempt;
- a later Task lifecycle state always wins over a stale dispatch checkpoint;
  and
- checkpoint state cannot complete, retry, cancel, or extend an attempt lease.

Any new table or column requires its own DDL, migration, PGlite, and genuine-
PostgreSQL gate. Reusing the repair-scheduler singleton row or Queue delivery
state is prohibited.

### `TaskComputeProvider`

The private provider-neutral port must support two semantically distinct
operations:

1. idempotently dispatch an exact prepared attempt; and
2. idempotently request interruption for an exact attempt, execution fence, and
   cancellation generation.

Dispatch returns only provider-acceptance evidence, such as an opaque provider
execution handle and provider identity/version. It does not return or imply a
Task heartbeat or completion. Cancellation delivery returns provider delivery
evidence; only the Task System can acknowledge cancellation or resolve the run.

The first package-local in-memory adapter must implement the same duplication,
uncertainty, cancellation, and receiver/lifecycle behavior as the Cloudflare
adapter. It is a conformance adapter, not an alternative state machine.

### Task Runtime ABI

The first task runtime ABI must be versioned independently from the existing
invoke protocol and commit at least:

- runtime contract and ABI version;
- immutable application revision and task-definition revision evidence;
- exact task ID and immutable runtime entry location;
- run ID, attempt ID, attempt number, execution fence, and provider dispatch
  identity;
- current cancellation generation/state at preparation time;
- compute profile and bound maximum duration;
- immutable input reference plus verified input bytes or a strictly bounded
  runtime-owned input capability;
- restricted task context/capability version; and
- bounded correlation fields needed for privacy-safe operational receipts.

The runtime response is a versioned execution outcome, not a lifecycle write.
It may describe success, typed task/system/resource/timeout failure, or a
cancellation acknowledgement. The trusted host validates and maps it into an
existing `TaskAttemptCompletionV1`, then calls the scope-bound Task System
operation with the exact attempt ID and execution fence.

### Heartbeat And Lease Rules

- A compute instance proposes monotonically increasing heartbeat sequences.
- The Task System uses database time and remains the sole lease authority.
- A rejected/current heartbeat instructs the host to stop or quarantine stale
  compute; it never allows the provider to extend the lease locally.
- Provider health pings, Worker Loader liveness, and HTTP progress are not Task
  heartbeats unless the fenced lifecycle operation accepts them.
- Host and database deadline policies must leave a positive settlement reserve
  before a lease or platform event expires.

### Cancellation Rules

- Cancellation delivery is keyed by attempt ID, execution fence, and monotonic
  cancellation generation.
- Duplicate delivery is idempotent; a lower generation cannot cancel or
  acknowledge a newer request.
- Dispatch racing with cancellation must be resolved from freshly reloaded Task
  state and the DTE06-C race table; process-local ordering is not authority.
- Runtime interruption alone is not cancellation acknowledgement. The Task
  System accepts acknowledgement only through the existing fenced completion
  command.
- If compute disappears, lease-expiry recovery remains authoritative.

### Input, Result, And Output Boundaries

Task input bytes are addressed by the existing immutable
`TaskInputReferenceV1`. Roadmap 06 must provide a trusted, bounded loader that
verifies object key, byte length, digest, value codec, and runtime-input schema
before user code runs.

Successful result bodies, error details, logs, traces, and output streams do
not belong in Task System rows. Before a successful completion:

1. the trusted host canonicalizes and bounds the result;
2. the result store publishes it idempotently under a content-addressed key;
3. the host derives the exact `TaskResultCommitmentV1`; and
4. the Task System accepts or rejects the fenced completion.

A lost completion response replays the same completion and commitment.
Unreferenced objects created before a rejected/stale completion require a
later bounded retention/GC policy; the host must not delete a possibly
referenced object based on an uncertain response.

Roadmap 07 owns authenticated reads and live/output delivery. Compute may emit
through narrow observability/output ports later, but those projections never
authorize lifecycle transitions.

## Failure And Uncertainty Rules

| Boundary | Required behavior |
| --- | --- |
| Effect read/preparation fails before claim | Typed retry or terminal host receipt; no provider call |
| Claim acquired, provider definitely rejects before acceptance | Record retryable/terminal delivery evidence according to bounded policy |
| Provider response is uncertain | Retain/recover claim and replay the same dispatch identity |
| Duplicate provider dispatch | Return the same accepted handle or an exact idempotent acceptance |
| Provider accepted, host crashes before checkpoint | Takeover replays the same identity and recovers acceptance |
| Heartbeat is stale or lease expired | Stop/quarantine compute; do not renew locally |
| Completion response is lost | Replay identical fenced completion and result commitment |
| Completion is stale/current | Preserve authoritative current state; never rewrite it from provider state |
| Provider disappears | Database lease expiry drives retry/cancellation/terminal policy |
| Cancellation delivery is lost | Operation-specific durable redelivery plus lease-expiry recovery |

Typed provider transport failures, malformed provider responses, runtime task
failures, Task System current outcomes, and defects remain distinct. A host
must not classify an unknown throw as a user task failure or convert a
database-uncertain lifecycle write into a retryable provider failure.

## Checkpoints

### DTE06-A: Source, Reuse, And Contract Preflight — Complete

- inventory current Task, Standard Application, persistence, backend, and
  artifact-runtime owners;
- separate reusable runtime mechanics from query/mutation/action semantics;
- fix provider, delivery, lifecycle, object-store, and activation ownership;
- identify the missing operation-specific dispatch checkpoint; and
- keep every runtime and deployment path unchanged.

The completion receipt is
[`preflight/33-dte06-compute-provider-and-runtime-contract.md`](./preflight/33-dte06-compute-provider-and-runtime-contract.md).

### DTE06-B: Host-Neutral Provider Domain — Complete

- add the private `@flarex/durable-task/internal/compute-provider-v1`
  `TaskComputeProvider` dispatch/cancel contract and a separate testing subpath;
- add owned request/receipt/error codecs and frozen snapshots;
- provide a deterministic in-memory conformance adapter;
- prove duplicate dispatch, stable idempotency, cancellation generations,
  receiver preservation, timeout/interrupt semantics, and typed failures; and
- add no database, app, Worker, route, or deployment wiring.

The admitted private package subpaths are
`@flarex/durable-task/internal/compute-provider-v1` and
`@flarex/durable-task/internal/compute-provider-testing-v1`. The contract owns
strict versioned dispatch/cancellation codecs, provider acceptance and
interruption-request receipts, typed failure distinctions, receipt correlation,
and an Effect service. The deterministic adapter proves same-identity replay,
semantic-conflict rejection, cancellation generations, accepted-but-unknown
recovery, receiver preservation, hostile input rejection, and interruption and
timeout behavior without claiming Task lifecycle acknowledgement.

### DTE06-C: Dispatch Preparation And Durable Checkpoint — C1 Complete

- DTE06-C0 fixes the operation-specific dispatch/cancellation delivery schema,
  prepared execution subject, fenced transaction protocol, uncertainty rules,
  and bounded discovery contract without changing code;
- DTE06-C1 adds canonical delivery evidence and the two Task-owned tables;
- DTE06-C2 will add the scope-bound fenced transaction repository;
- DTE06-C3 will add bounded connected delivery against only the deterministic
  provider;
- freshly correlate scope, effect, run, attempt, fence, lease, cancellation,
  definition, runtime binding, and input reference;
- prove claim exclusion, expiry takeover, uncertain replay, fairness,
  corruption rejection, and lifecycle-current dominance in PGlite and genuine
  PostgreSQL; and
- keep provider execution mocked and production-inert.

C0 and C1 are complete. C1 deliberately adds no claim transaction,
effect-ledger discovery, provider call, or runtime wiring. C2 and C3 require
their preceding receipts and separate admission. The exact contract is
[`preflight/34-dte06-durable-compute-delivery.md`](./preflight/34-dte06-durable-compute-delivery.md).

### DTE06-D: Worker Loader Task Runtime Adapter — Pending

- generalize the existing artifact-runtime owner at its narrow reusable seam;
- add a private versioned task runtime ABI/route/profile without weakening
  current query/mutation behavior;
- resolve the exact `durable_task` runtime entry and verified input;
- preserve egress denial, internal authentication, cache identity, and
  restricted executor capabilities; and
- prove local Miniflare/hosted-adapter conformance, bundle safety, and no legacy
  fallback.

### DTE06-E: Attempt Supervision And Settlement — Pending

- connect accepted compute to fenced heartbeat, completion, result publication,
  and cancellation operations;
- bound CPU/wall time, heartbeat cadence, result bytes, retries, and settlement
  reserves;
- prove stale fence, lease loss, cancel/complete races, worker loss, result
  publication uncertainty, and lost completion response; and
- emit only privacy-safe aggregate operational receipts.

### DTE06-F: Private End-To-End Runtime Proof — Pending

- compose real Standard Application task binding, R2 objects, Worker Loader,
  executor capabilities, Task System Postgres, and one private invocation;
- prove cold and warm materialization, success, typed failure/retry,
  cancellation, duplicate dispatch, restart/takeover, and cleanup;
- run real Cloudflare/Hyperdrive/PostgreSQL evidence where platform behavior is
  part of the claim; and
- remain behind an explicit disabled-by-default host/deployment gate.

After DTE06-F closes the minimum safe compute path, DTE05-E3 may add the
scheduled Worker host and Cron Trigger through its own exact deployment
preflight. Queue and cron activation still require an explicit rollout
decision.

### DTE06-G: Final Admission — Pending

Require provenance, package, Effect, bundle, PGlite, genuine PostgreSQL,
Miniflare, Cloudflare, duplicate/loss/reordering, cancellation, object
retention, operational receipt, and reviewer gates. Admission does not expose
a public SDK or observability UI.

## Validation Gates

Every implementation checkpoint must include the focused forms that apply:

- pure contract and hostile-input tests;
- deterministic in-memory provider conformance;
- existing durable-task lifecycle/source-map regression gates;
- PGlite transaction and corruption tests;
- genuine PostgreSQL concurrency, takeover, and uncertainty tests for schema or
  transaction changes;
- Miniflare and Worker bundle tests for runtime changes;
- real Cloudflare proof before claiming Worker Loader/Hyperdrive production
  behavior;
- Standard Application and Trigger-source boundary checks;
- package-local TypeScript and repository Effect boundary checks; and
- both required project reviewers before every significant code commit.

## Non-Goals

Roadmap 06 does not authorize:

- public `task()` SDK ergonomics or HTTP invocation APIs;
- treating `action` or `internalAction` as a task definition;
- a generic requested-effect delivery framework;
- replacing Task System lifecycle, Postgres authority, OCC, commit, journal,
  outbox, feed, or application-row owners;
- a second artifact materializer, executor, or user-code runtime;
- Trigger.dev Prisma, Redis, organization, deployment, compute, or runtime
  services in the production import graph;
- raw user payloads, results, logs, traces, headers, tokens, or database values
  in operational receipts;
- waitpoints, checkpoints, batches, debounce, broad concurrency/fairness, or
  AgentOS implementation in the first vertical;
- Roadmap 07 query/live/output APIs; or
- production Queue, cron, Worker, route, binding, or deployment activation.

## Stop Boundary

DTE06-C1 stops at canonical delivery evidence and production-inert Task-owned
storage. DTE06-C2 requires explicit approval. This roadmap does not authorize
effect-ledger delivery,
database or application changes, Worker/runtime wiring, routes, bindings,
deployment, or production activation.
