# DTE02: Task Definition, Identity, Revision, Artifact, And Scope Authority

## Status

**Status:** Active preflight. DTE02-A current-authority inventory and DTE02-B
task-target/definition contract are complete. DTE02-C scope capability is next.

This roadmap owns the identity and authority boundary required before the
admitted `@flarex/durable-task` package can be created. It does not authorize a
database schema, migration, public task SDK, task host, compute execution,
scheduler, deployment route, or production activation.

Roadmap 01 admitted a reusable Trigger.dev run-attempt lifecycle closure. That
admission deliberately stopped before inventing Flarex task identity. This
roadmap now defines how a task is associated with Flarex's existing Standard
Application, application-revision, runtime-artifact, and data-scope owners
without importing Trigger.dev's organization model or creating a parallel
deployment system.

## Mandate

DTE02 must answer five questions precisely:

1. what identifies a logical task and one immutable task-definition revision;
2. which existing Flarex capability authorizes that definition and its runs;
3. how tenant, project, environment, deployment, and concrete scope differ;
4. how a run remains pinned to an immutable application revision and runtime
   artifact after later activation changes; and
5. which identity values the admitted run-attempt package may receive without
   becoming an identity, deployment, or persistence authority.

The result must be a private, real-system-compatible contract. Public SDK
ergonomics and Trigger.dev API compatibility remain later work.

## Non-Negotiable Decisions

### 1. Trigger Product Identity Is Not Migrated

The following Trigger.dev concepts are compatibility-source inputs, not Flarex
authorities:

- organization and organization membership;
- project and project membership;
- runtime environment;
- deployment and worker deployment;
- API key and Trigger authentication ownership; and
- billing, plan, entitlement, and product-routing identifiers.

They must not be copied into Flarex tables, retained as hidden columns, or
renamed mechanically. In particular:

- `organizationId -> tenantId` is invalid;
- `runtimeEnvironmentId -> scopeId` is invalid;
- `deploymentId -> applicationRevisionId` is invalid; and
- a caller-supplied `scopeId` is not proof of scope authority.

An upstream field may survive only when a source-closure preflight proves that
the lifecycle algorithm needs its semantics. The adapter must then map it to
the exact Flarex owner described below, not retain the Trigger product model.

### 2. Tenant And Scope Are Different Authorities

A **tenant** is a control-plane customer and administration boundary. Tenant
membership may authorize a user to operate a project or environment, but the
tenant identifier is not the task engine's data-plane routing or transaction
authority.

A **scope** is the concrete data-plane authority for a deployment environment.
The current Flarex authority includes:

- `scopeId`;
- epoch;
- storage generation and storage-generation fence;
- physical locator;
- deployment binding; and
- current commit and outbox sequence evidence.

The backend resolves a request through authenticated control-plane context to
a trusted scope authority. Persistence revalidates the scope metadata,
provisioning receipt, physical target, epoch, and generation at its owned
boundary. Task code never derives this authority from tenant, project,
environment, or user-supplied scope text.

### 3. Dynamic Scope Is An Operation Capability

The durable-task domain package must not import
`@flarex/persistence-postgres`, `flarex-protocol`, Drizzle, or a physical
locator merely to carry scope.

Instead, host composition obtains a trusted, operation-scoped Task System
capability from the persistence owner. That capability is already bound to one
resolved scope and exposes only task operations. The run-attempt service uses
that capability and task-domain identifiers; it does not accept a raw
`tenantId`, `projectId`, `environmentId`, `deploymentId`, `scopeId`, epoch, or
storage generation as a freely constructible command field.

This is an authority boundary, not only a TypeScript shape:

- the host cannot prove authority by assembling a record;
- the capability must be issued by the trusted resolution path;
- the persistence implementation revalidates authority when transaction
  freshness matters;
- every stored task row is still physically keyed or constrained by the
  owning scope in Roadmap 04; and
- a Task System capability must not be installed as a singleton Context value
  when several scopes can share one process.

The admitted domain Layer may construct a lifecycle service over a supplied
store port. The dynamically selected, scope-bound port is provided at the
operation or request composition boundary.

### 4. Application Activation Is Reused, Not Duplicated

Flarex already owns a private authenticated active-application-revision
selection. The selection is issuer-backed rather than a public serializable
record, and it can expose:

- coherent active revision metadata;
- trusted scope authority;
- schema manifest evidence; and
- the candidate-bound runtime target and publication.

DTE02 will reuse that capability for the first private vertical. It will not
create a task-specific deployment head or second application-activation
system.

Creating a new run begins from a currently valid active application selection,
locates an accepted task target in that revision, and captures an immutable
task execution binding. Changing the active application revision affects later
run creation only. It must not retarget an existing run or attempt.

### 5. Runtime Artifacts Are Resolved Through The Revision

A caller must not provide an arbitrary artifact URL, object-store key,
`packageSha256`, or `artifactSha256` and claim that it belongs to a task.

The existing active-revision runtime target is the source of runtime
publication evidence. The durable task binding captures the identifiers and
digests needed to prove that the function target and runtime artifact came
from the same authenticated application revision. The exact minimal durable
projection is decided in DTE02-D; it must not copy an entire runtime
publication merely for convenience.

Large source, artifact, input, output, log, trace, and checkpoint bodies remain
in their owning object stores. Task state stores bounded identities, digests,
references, versions, and lifecycle evidence.

## Current Implemented Authority Inventory

This section records current committed behavior, not proposed APIs.

### Standard Application Stages

The Standard Application path currently separates:

1. **definition** - canonical private application definition;
2. **analysis** - private authenticated source and semantic evidence;
3. **registration** - durable, idempotent, inactive application revision; and
4. **invocation** - private capability-gated execution surfaces.

A prepared definition is inert. It is not an authenticated artifact, verified
analysis, registered application revision, active revision, or execution
claim. DTE02 must preserve those distinctions.

The current function-kind vocabulary contains `query`, `mutation`,
`workflowMutation`, and `action`, with internal/public visibility represented
separately. Cron is a trigger descriptor rather than a fifth function kind.
DTE02 does not add a public `task` function kind. DTE02-B admits exactly an
`internal` `action` in the existing `edge_action` runtime group for the first
private target. Its definition/artifact path exists; invocation remains closed
until the later action compute capability is proven.

### Registered Application Revision

The current registration owner durably records one inactive application
revision with a revision ID, deployment ID, scope ID, candidate and attempt
digests, schema version, function metadata digest, validator root, declared
handler-set digest, registration root, and registration time.

The Standard Application wrapper intentionally projects only its supported
public-private surface: registered status, revision ID, schema version ID, and
registration time. Internal scope, attempt, candidate, and digest evidence
remain with the implementation-bearing System operation.

### Active Revision Selection

The current activation owner exposes an
`AuthenticatedActiveApplicationRevisionSelectionV1`. Its state is held behind
an issuer-owned `WeakMap`; a structurally similar object is rejected. The
selection can be claimed for coherent active metadata, trusted scope authority,
schema manifest evidence, and a candidate-bound runtime target.

Active metadata already binds the application revision to candidate,
readiness, activation-head, package, artifact, source, semantic, schema,
function, validator, handler-set, runtime-projection, and function-group
digests. This is the existing authority DTE02 must narrow for task use rather
than recreating.

### Scope Authority

The current `TrustedScopeAuthority` contains deployment, scope, physical
location, storage generation and fence, epoch, and current sequence evidence.
It is resolved from persistence-owned metadata, provisioning, and scope-clock
ports. DTE02 treats it as the authority source while keeping its concrete type
out of `@flarex/durable-task`.

## Identity Model

### Logical Task Key

For the first private vertical, a task is selected by a canonical function path
inside a verified Standard Application revision. That path is a definition
lookup key, not durable authorization and not a globally unique customer ID.

The first vertical will not introduce a public developer-chosen task ID. A
future SDK may add a stable task key or rename policy, but it must map into this
private model without changing existing run bindings.

### Immutable Task-Definition Revision

The Task System owner will issue one opaque task-definition-revision identity
for an accepted immutable binding. The working internal name is:

`TaskDefinitionRevisionIdV1`

This ID denotes exactly one accepted tuple:

- resolved scope authority at registration or run-binding time;
- immutable application revision ID;
- canonical function path and exact function metadata identity;
- accepted function kind and visibility;
- candidate and runtime-projection evidence;
- artifact and package evidence required by the compute boundary; and
- versioned retry/timeout/compute policy owned by the task definition.

The ID is not interchangeable with application revision ID, function path,
deployment ID, or artifact digest. Roadmap 04 decides whether the ID is
storage-issued or content-addressed after the canonical registration input and
idempotency behavior are fixed.

There is no mutable `latest` field inside a task-definition revision. Any
change to handler binding, retry policy, timeout, compute policy, or immutable
runtime evidence creates another revision.

### Task Run Identity

The working internal name for a durable run identifier remains:

`TaskRunIdV1`

A new run captures one `TaskDefinitionRevisionIdV1`. The binding never changes
after insertion. Attempts inherit the run's definition revision; they do not
resolve the currently active application revision again.

Run creation also owns a scope-local idempotency identity. Its exact spelling,
request digest, conflict behavior, retention, and replay receipt belong to
Roadmaps 03 and 04. It must not use tenant ID or an untrusted environment ID as
the transaction authority.

### Attempt Identity And Fence

An attempt has a task-domain attempt identifier and a monotonic execution
fence. The attempt identifier names lifecycle history. The fence authorizes a
specific lease generation. They are not interchangeable, and an attempt ID by
itself cannot authorize heartbeat, completion, cancellation acknowledgment, or
retry commitment.

Exact types and transition commands remain Roadmap 03's owner. DTE02 fixes only
that all attempt operations occur through the same scope-bound Task System
capability as the run.

## Private Authority Flow

```text
authenticated control-plane request
  -> Flarex deployment/environment resolution
  -> persistence-owned trusted scope resolution
  -> authenticated active application revision selection
  -> canonical Standard Application function target lookup
  -> immutable task-definition revision binding
  -> scope-bound Task System capability
  -> idempotent run creation using TaskDefinitionRevisionIdV1
  -> run-attempt lifecycle service
```

The flow intentionally has two different forms of evidence:

- issuer-backed live capabilities authorize an operation now; and
- durable IDs and digest projections preserve what was authorized for later
  reconstruction after process loss.

Persisting a capability object is meaningless. Persisting a copied metadata
record does not recreate issuer authority. On recovery, the Task System loads
the durable binding and the host reacquires and validates the current
capabilities needed for the next operation.

## Package Boundary Consequences

The DTE01 package admission remains valid without adding a dependency.

`@flarex/durable-task` may own:

- opaque task run, attempt, and task-definition-revision domain identities;
- lifecycle models and pure transition policy;
- the typed lifecycle service;
- a narrow scope-bound Task System store port;
- lifecycle errors and receipts; and
- the production-inert domain Layer.

It must not own or import:

- tenant, project, environment, or deployment administration;
- scope resolution, physical locators, epoch provisioning, or storage routing;
- application registration, readiness, or activation;
- runtime publication loading or artifact verification;
- Postgres, Drizzle, Prisma, Redis, Cloudflare, or host APIs; or
- public SDK definition syntax.

`@flarex/persistence-postgres` will own the adapter that binds the private Task
System operations to a resolved Flarex scope and enforces stored scope keys,
transactions, constraints, fences, and database-clock rules.

`flarex-backend` will own request authentication, control-plane resolution,
active application selection, runtime-target lookup, operation-scoped adapter
composition, and safe host projections.

Standard Application packages remain the source of canonical definition and
analysis artifacts. DTE02 must not add a second parser or analyzer for the same
function definition merely to recognize tasks.

## Definition And Run Semantics

### Definition Acceptance

The first vertical accepts a task target only when all of the following are
true:

1. the request holds an issuer-backed active application selection;
2. the selection resolves to the same trusted scope used by the Task System
   operation;
3. the canonical function path exists exactly once in the selected revision;
4. it is the DTE02-B `action` + `internal` + `edge_action` target and remains
   invocation-inert until the first action compute route is admitted;
5. its validator and declared-handler evidence agree with the authenticated
   revision metadata;
6. its runtime projection and artifact publication are complete;
7. its task policy passes a versioned, deterministic decoder; and
8. registration or lookup returns one immutable task-definition revision.

Failure is fail-closed. There is no fallback to another application revision,
function path, artifact, deployment, or source island implementation.

### New Run Creation

A run-creation request must contain only domain inputs the caller is permitted
to choose, such as the selected task key, validated input reference, and
idempotency key. The host supplies the active selection and scope-bound Task
System capability out of band.

The durable creation transaction records or references the immutable task
definition revision. A replay with the same idempotency identity and same
canonical request returns the original receipt. A replay with a conflicting
request fails with a typed conflict; it does not silently create another run.

### Existing Run Continuation

Once a run exists:

- a later application activation does not retarget it;
- a renamed or removed function in a later revision does not change it;
- a new runtime artifact does not change it;
- losing a process-local capability does not lose its durable binding;
- every claimed attempt still requires a fresh, scope-bound store operation;
  and
- compute must load the artifact proven by the run's immutable binding.

Revocation, application deletion, tenant suspension, and artifact-retention
policy may prevent a new operation. Their exact new-run versus in-flight-run
semantics require an explicit operational-policy roadmap and are not inferred
from deletion alone.

## Preflight Checkpoints

### DTE02-A: Current Authority Inventory

**Status:** Complete.

Evidence required and now located:

- Standard Application definition, analysis, registration, and invocation
  boundaries;
- durable inactive application-revision receipt;
- active revision metadata and issuer-backed selection;
- runtime target state carried behind the selection;
- trusted scope authority and its persistence-owned resolution; and
- the DTE01 package dependency and host ownership gates.

Conclusion: Flarex already owns the required application, runtime, and scope
authorities. DTE02 must compose and narrow them; it must not introduce a
Trigger-shaped identity subsystem.

### DTE02-B: Task Target And Definition Contract

**Status:** Complete. See
[`preflight/06-task-target-and-definition-contract.md`](./preflight/06-task-target-and-definition-contract.md).

Required output:

- exact accepted private function kind for the first vertical;
- canonical function-target lookup rule;
- versioned task policy input and normalized form;
- logical-key and immutable-revision distinction;
- definition registration idempotency and conflict rules; and
- proof that no parallel Standard Application analyzer is introduced.

Exit gate: one private task definition can be identified in a verified
application revision without adding a public SDK surface or unsupported
runtime promise.

### DTE02-C: Scope Capability Contract

**Status:** Next.

Required output:

- exact host-to-persistence scope resolution call path;
- scope-bound Task System port construction and lifetime;
- stale epoch, generation, locator, and deployment mismatch behavior;
- tests proving that caller-supplied tenant/scope text cannot establish
  authority; and
- an explicit decision on which operations must reacquire or revalidate scope
  authority inside their transaction.

Exit gate: task lifecycle commands cannot cross scope by changing a serialized
identifier or by reusing a port under another request.

### DTE02-D: Application Revision And Runtime Binding

**Status:** Pending.

Required output:

- exact projection copied from active revision metadata;
- exact function-target and runtime-publication evidence captured;
- binding digest and canonical encoding owner;
- artifact availability and corruption failures;
- later-activation behavior; and
- recovery proof after all process-local capabilities are lost.

Exit gate: a durable run deterministically resolves its original runtime target
without consulting a mutable `latest` pointer or accepting a caller artifact.

### DTE02-E: Domain Identity Types And Ownership

**Status:** Pending.

Required output:

- exact internal names and validators for task-definition revision, run, and
  attempt identities;
- generation and storage authority for each identifier;
- opaque versus serializable boundaries;
- canonical equality and error behavior; and
- confirmation that no type duplicates an existing Flarex protocol authority.

Exit gate: DTE-IP01 can import or define the approved task-domain identifiers
without adding `flarex-protocol` or persistence dependencies.

### DTE02-F: DTE-IP01 Input Contract

**Status:** Pending.

Required output:

- exact run-attempt service command fields;
- exact scope-bound Task System port surface consumed by the admitted source
  closure;
- mapping from every retained Trigger identity field;
- removed organization/environment/deployment fields and rationale; and
- executable package-boundary updates if the final contract changes any DTE01
  assumption.

Exit gate: the complete admitted package can be created without placeholders,
generic strings standing in for authority, or a new workspace dependency.

### DTE02-G: Final Identity Admission

**Status:** Pending.

Required output:

- one final decision receipt: admit, revise, or reject;
- closed inventory of all identity authorities and trust boundaries;
- reviewer-confirmed consistency with current Standard Application and
  persistence contracts;
- focused tests or compile-time gates for the approved private surface; and
- exact handoff to Roadmap 03 and DTE-IP01 package creation.

## Reopening Rules

DTE01 package admission must be reopened before implementation if DTE02
requires any of the following:

- a new runtime dependency beyond the admitted root-catalog `effect`;
- a public protocol export or package-root export;
- an import from persistence, backend, an app, Trigger.dev, or the source
  island;
- different lifecycle behavior, error ordering, or service semantics from the
  admitted closure; or
- a host/runtime API inside the domain package.

Finding that persistence must store a scope key does not reopen DTE01; that is
Roadmap 04 adapter work. Finding that host composition must provide a
scope-bound port does not reopen DTE01 so long as the port remains the admitted
domain-owned interface.

## Explicit Non-Goals

DTE02 does not authorize:

- tenant, project, environment, deployment, or scope tables;
- a task-definition table or migration;
- copying Trigger.dev Prisma IDs or relations;
- new application activation or task deployment heads;
- public `task()` syntax or a new Standard Application function kind;
- cron, batching, debounce, waitpoint, or schedule identity;
- task input/output object-store layout;
- compute-provider selection or Worker Loader changes;
- retention, deletion, suspension, or billing policy;
- observability authorization or UI APIs; or
- production routing.

## Completion Condition

DTE02 is complete only when DTE02-B through DTE02-G have durable evidence and
the final receipt names the exact identity types, scope capability, immutable
revision/artifact projection, validation owner, and service inputs that
DTE-IP01 may implement.

Until then, the current result is a bounded architecture decision and inventory,
not permission to add placeholder identity fields to the admitted package.

## Authority And References

Use these sources in order:

1. [`./README.md`](./README.md) for the durable-task vision and non-negotiable
   reuse boundaries;
2. [`./01-source-reuse-and-package-admission.md`](./01-source-reuse-and-package-admission.md)
   and [`./preflight/05-final-package-admission.md`](./preflight/05-final-package-admission.md)
   for the admitted source/package closure and its identity prerequisite;
3. [`../../design-notes/flarexdb-system-apis-proposal.md`](../../design-notes/flarexdb-system-apis-proposal.md)
   for control-plane versus data-plane authority;
4. [`../42-standard-application-apis.md`](../42-standard-application-apis.md)
   for private Standard Application stage ownership;
5. current application registration, readiness, activation, scope-resolution,
   and runtime-target code and tests for implemented behavior;
6. [`../16-package-boundaries.md`](../16-package-boundaries.md) for the admitted
   package dependency direction; and
7. the pinned Trigger.dev source only as compatibility evidence, never as
   Flarex identity authority.
