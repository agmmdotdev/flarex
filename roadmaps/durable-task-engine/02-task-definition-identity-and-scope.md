# DTE02: Task Definition, Identity, Revision, Artifact, And Scope Authority

## Status

**Status:** Complete — **admit** the private task identity, scope, revision,
runtime-binding, DTE-IP01 command, and Task System store-port contract. DTE02-A
through DTE02-G are complete. Roadmap 03 is active; DTE03-A's lifecycle
inventory and DTE03-B's phase/aggregate model are complete, and DTE03-C's
failure/retry/attempt policy is next. DTE-IP01 package creation remains blocked
on Roadmap 03's complete lifecycle-model gate.

This roadmap owns the identity and authority boundary required before the
admitted `@flarex/durable-task` package can be created. It does not authorize a
database schema, migration, public task SDK, task host, compute execution,
scheduler, deployment route, or production activation.

Roadmap 01 admitted a reusable Trigger.dev run-attempt lifecycle closure. That
admission deliberately stopped before inventing Flarex task identity. This
roadmap now defines how a first-class task catalog is added to Flarex's private
Standard Application chain and associated with application-revision,
runtime-artifact, and data-scope owners without importing Trigger.dev's
organization model or creating a parallel deployment system.

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

The existing active-revision selection and runtime-publication chain is the
authority framework. DTE02-D now fixes its task extension as one canonical
task catalog plus a separate `durable_task` projection, group manifest,
materialization specification, and application-revision task-binding digest.
It does not treat a current function target as task authority merely because
the artifact mechanics look similar. The durable task binding captures only
the identifiers, digests, and immutable object references needed to prove that
the task definition and handler artifact came from the same authenticated
application revision. See
[`preflight/08-application-revision-and-runtime-binding.md`](./preflight/08-application-revision-and-runtime-binding.md).

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
No current function kind is the durable task contract. DTE02-B instead admits
a separate canonical task catalog derived from Trigger.dev's task metadata and
manifest semantics. The existing action surface remains prototype evidence
only and does not decide task identity, context, artifact group, or execution.

The Standard Application path does not yet implement that task catalog. The
future private definition/analysis extension must add it beside the existing
function catalog without creating a second application definition owner.

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

For the first private vertical, the logical task key is a stable developer task
ID under one trusted Flarex scope:

```text
(trusted scope, TaskIdV1)
```

The ID remains stable across application revisions. Function path, module path,
export name, and artifact location are handler-binding evidence, not logical
task identity. Renaming those locations does not silently create a new task;
changing `TaskIdV1` does.

The first private producer may construct this definition before a public SDK
exists. A later Trigger-style `task({ id, run, ... })` API must lower to the
same canonical private task manifest rather than create a parallel model.

### Immutable Task-Definition Revision

The Task System owner will issue one opaque task-definition-revision identity
for an accepted immutable binding. The working internal name is:

`TaskDefinitionRevisionIdV1`

This ID denotes exactly one accepted tuple:

- resolved scope authority at registration or run-binding time;
- immutable application revision ID;
- stable `TaskIdV1` and canonical task-manifest identity;
- exact handler module/export and handler artifact identity;
- payload/output validator commitments;
- canonical task-catalog digest, `durable_task` entry/projection/group-manifest
  evidence, and `applicationRevisionTaskBindingSha256`;
- immutable runtime materialization specification and object references needed
  for restart-safe reconstruction;
- artifact and package evidence required by the compute boundary; and
- versioned retry/timeout/compute policy owned by the task definition.

The ID is not interchangeable with task ID, application revision ID, handler
path, deployment ID, or artifact digest. DTE02-E fixes it as a storage-issued
`taskdef_` plus canonical lowercase UUIDv4 identity. Canonical binding evidence
and a scope-local unique semantic binding key make identical registrations
converge; the ID itself is not a content digest. Roadmap 04 owns the physical
constraint and transactional proof.

There is no mutable `latest` field inside a task-definition revision. Any
change to handler binding, retry policy, timeout, compute policy, or immutable
runtime evidence creates another revision.

### Task Run Identity

The working internal name for a durable run identifier remains:

`TaskRunIdV1`

A new run captures one `TaskDefinitionRevisionIdV1`. The binding never changes
after insertion. Attempts inherit the run's definition revision; they do not
resolve the currently active application revision again.

DTE02-D separates this stable definition binding from the durable
`TaskRunCreationAuthorityReceiptV1`, which records the activation revision,
head, readiness, candidate, and task-binding evidence that authorized the new
run. Re-observing or later changing activation does not change the definition
revision.

Run creation also owns a scope-local idempotency identity. Its exact spelling,
request digest, conflict behavior, retention, and replay receipt belong to
Roadmaps 03 and 04. It must not use tenant ID or an untrusted environment ID as
the transaction authority.

### Attempt Identity And Fence

An attempt has a `TaskAttemptIdV1`, `TaskAttemptNumberV1`, and monotonic
`TaskExecutionFenceV1`. The attempt identifier names lifecycle history, the
number describes retry-policy position, and the fence authorizes a specific
execution ownership generation. They are not interchangeable, and an attempt
ID or number by itself cannot authorize heartbeat, completion, cancellation
acknowledgment, or retry commitment.

DTE02-E fixes their identity and encoding contracts. Roadmap 03 owns the exact
transition commands and decides which transitions create attempt history or
consume a retry ordinal. All operations still occur through the same
scope-bound Task System capability as the run.

## Private Authority Flow

```text
authenticated control-plane request
  -> Flarex deployment/environment resolution
  -> persistence-owned trusted scope resolution
  -> authenticated active application revision selection
  -> fresh located authority matched to the selection
  -> operation-scoped Task System store capability
  -> canonical Standard Application task manifest lookup by TaskIdV1
  -> immutable task-definition revision binding
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
capabilities needed for the next operation. The exact new-run and continuation
paths, port lifetime, and per-transaction revalidation rules are fixed by
[`preflight/07-scope-capability-contract.md`](./preflight/07-scope-capability-contract.md).

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
analysis artifacts. Their future task-catalog extension must adapt Trigger task
metadata/indexing semantics into the same stage chain. DTE02 must not reuse an
action entry as a shortcut or add a parallel application parser/analyzer.

## Definition And Run Semantics

### Definition Acceptance

The first vertical accepts a task target only when all of the following are
true:

1. the request holds an issuer-backed active application selection;
2. the selection resolves to the same trusted scope used by the Task System
   operation;
3. `TaskIdV1` exists exactly once in the canonical task catalog;
4. its canonical manifest, handler binding, validators, and policies agree
   with the authenticated application revision;
5. its task-catalog and handler-artifact evidence are complete;
6. its exact runtime capability has been separately admitted rather than
   inferred from the action prototype;
7. its task policy passes a versioned, deterministic decoder; and
8. registration or lookup returns one immutable task-definition revision.

Failure is fail-closed. There is no fallback to another application revision,
task ID, action/function entry, artifact, deployment, or source-island
implementation.

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
- a renamed handler or removed task in a later revision does not change it;
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

### DTE02-B: First-Class Task Definition Contract

**Status:** Revised and complete. See
[`preflight/06-task-target-and-definition-contract.md`](./preflight/06-task-target-and-definition-contract.md).

Required output:

- exact first-class canonical task-manifest shape for the first vertical;
- stable task-ID and canonical task lookup rule;
- versioned task policy input and normalized form;
- logical-key and immutable-revision distinction;
- definition registration idempotency and conflict rules; and
- proof that no action alias or parallel Standard Application analyzer is
  introduced.

Exit gate: one first-class private task definition can be identified by stable
task ID in a verified application revision without using the action prototype,
adding a public SDK surface, or promising an unsupported runtime.

### DTE02-C: Scope Capability Contract

**Status:** Complete. See
[`preflight/07-scope-capability-contract.md`](./preflight/07-scope-capability-contract.md).

Accepted output:

- the exact two-stage backend authorization then persistence scope-resolution
  call path for new runs and existing-run continuation;
- `TaskSystemRunAttemptStore` as the domain-visible scope-bound capability,
  dynamically constructed and Effect-scoped rather than a generic scope
  service or singleton;
- exact active-selection/fresh-authority equality, target-local scope-clock
  revalidation, and fail-closed stale epoch, generation, locator, and
  deployment behavior;
- a proof matrix showing that caller-supplied tenant/scope text cannot
  establish authority or switch a captured capability to another scope; and
- per-operation reacquisition and in-transaction revalidation requirements.

Exit gate: task lifecycle commands cannot cross scope by changing a serialized
identifier or by reusing a port under another request. The gate is accepted at
the contract level; Roadmap 04 must execute its PGlite and real-Postgres proof
when the first adapter exists.

### DTE02-D: Application Revision And Runtime Binding

**Status:** Complete. See
[`preflight/08-application-revision-and-runtime-binding.md`](./preflight/08-application-revision-and-runtime-binding.md).

Accepted output:

- one canonical task catalog and a separate `durable_task` runtime projection
  committed into the existing application revision and activation head;
- task runtime entry, projection, group-manifest, materialization-specification,
  and application-revision binding frames with exact digest relationships;
- immutable task-definition runtime binding separated from the activation
  receipt that authorized new-run creation;
- explicit artifact-unavailable, foreign-resource, corruption,
  unsupported-runtime, and compute-availability failure meanings;
- later activation affecting only new runs; and
- restart recovery from the stored definition revision and immutable objects
  without current active selection or mutable host runtime defaults.

Exit gate: a durable run deterministically resolves its original runtime target
without consulting a mutable `latest` pointer or accepting a caller artifact.
The contract is accepted; its package/protocol, persistence, readiness, and
compute proofs remain owned by their later implementation roadmaps.

### DTE02-E: Domain Identity Types And Ownership

**Status:** Complete. See
[`preflight/09-domain-identity-types-and-ownership.md`](./preflight/09-domain-identity-types-and-ownership.md).

Accepted output:

- exact `TaskIdV1`, `TaskDefinitionRevisionIdV1`, `TaskRunIdV1`,
  `TaskAttemptIdV1`, `TaskAttemptNumberV1`, and `TaskExecutionFenceV1`
  contracts;
- storage-issued canonical UUIDv4 identities for definition revision, run,
  and attempt, with no Trigger internal/friendly alias pair;
- persistence-owned generation, bounded collision behavior, and scope-local
  lookup through the DTE02-C capability;
- canonical equality, serializable/opaque/visible boundaries, and distinct
  malformed, absent, cross-scope, corrupt, stale, and exhausted behavior; and
- explicit separation from application, scope, transaction-session, and
  transaction-fence authorities.

Exit gate: DTE-IP01 can define the approved task-domain identifiers with its
already admitted `effect` dependency and without `flarex-protocol` or
persistence dependencies. The contract gate is accepted; executable schema
and package proofs remain DTE-IP01 work.

### DTE02-F: DTE-IP01 Input Contract

**Status:** Complete. See
[`preflight/10-dte-ip01-input-and-store-port-contract.md`](./preflight/10-dte-ip01-input-and-store-port-contract.md).

Accepted output:

- six exact service commands, including the explicit heartbeat operation
  already present in DTE01's admitted source/test closure;
- exact run, lease, cancellation, heartbeat, database-time, result-commitment,
  and requested-effect supporting values;
- a two-operation scope-bound `TaskSystemRunAttemptStore` with one pure,
  re-invocable transactional decision seam and one authoritative inspection;
- exact command, decision, and store error categories;
- complete retained Trigger identity/field mapping and product-authority
  removal rationale; and
- DTE01 service-list correction without a new source, dependency, export, or
  package boundary.

Exit gate: the complete admitted package can be created without authority
placeholders, generic identity strings, hidden host/persistence state, or a new
workspace dependency. The contract gate is accepted; implementation remains
production-inert DTE-IP01 work.

### DTE02-G: Final Identity Admission

**Status:** Complete — **admit**. See
[`preflight/11-final-identity-admission.md`](./preflight/11-final-identity-admission.md).

Accepted output:

- one consolidated admit decision and closed identity/authority inventory;
- end-to-end new-run, existing-run, runtime/effect, and observability trust
  boundaries;
- repository-consistency audit against current Standard Application,
  registration/activation, scope, persistence, protocol, transaction, and
  Trigger-boundary owners;
- explicit DTE01 reopening matrix with no triggered condition;
- current pre-admission checks plus exact Roadmap03, DTE-IP01 compile-time, and
  runtime-test gates; and
- exact sequence: Roadmap 03 lifecycle-model admission, then production-inert
  DTE-IP01 package creation under DTE01's stop boundary.

Exit gate: DTE02 identity/scope is admitted without placeholders or ownership
conflicts. It does not bypass Roadmap 03 or authorize persistence/host work.

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

## Completion Receipt

DTE02-B through DTE02-G now have durable evidence. The final receipt names the
exact identity types, scope capability, immutable revision/runtime binding,
validation owners, service commands, store port, trust boundaries, executable
gates, and implementation sequence.

The result admits a bounded private contract. It is not permission to add
placeholder lifecycle unions, skip Roadmap 03, or begin persistence/host work.

## Authority And References

Use these sources in order:

1. [`./README.md`](./README.md) for the durable-task vision and non-negotiable
   reuse boundaries;
2. [`./01-source-reuse-and-package-admission.md`](./01-source-reuse-and-package-admission.md)
   and [`./preflight/05-final-package-admission.md`](./preflight/05-final-package-admission.md)
   for the admitted source/package closure and its identity prerequisite;
3. [`./preflight/11-final-identity-admission.md`](./preflight/11-final-identity-admission.md)
   for the consolidated DTE02 decision and handoff;
4. [`../../design-notes/flarexdb-system-apis-proposal.md`](../../design-notes/flarexdb-system-apis-proposal.md)
   for control-plane versus data-plane authority;
5. [`../42-standard-application-apis.md`](../42-standard-application-apis.md)
   for private Standard Application stage ownership;
6. current application registration, readiness, activation, scope-resolution,
   and runtime-target code and tests for implemented behavior;
7. [`../16-package-boundaries.md`](../16-package-boundaries.md) for the admitted
   package dependency direction; and
8. the pinned Trigger.dev source only as compatibility evidence, never as
   Flarex identity authority.
