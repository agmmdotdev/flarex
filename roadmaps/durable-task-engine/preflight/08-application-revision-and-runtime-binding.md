# DTE02-D: Application Revision And Durable Task Runtime Binding

## Decision

**Outcome: ADMIT one task-specific runtime publication bound into the existing
Flarex application revision, readiness, activation, and active-selection
chain.**

A durable task is not executed from the current action catalog or
`edge_action` projection. A task-capable Standard Application revision carries
one canonical task catalog and one separate `durable_task` runtime projection.
Their digests are committed by a versioned application-revision task-binding
frame and become part of the same registered revision, readiness decision,
activation head, and issuer-backed active selection already owned by Flarex.

At new-run creation, the active selection authorizes exactly one task
definition in that revision. The Task System records one immutable
task-definition revision and the run stores only its
`TaskDefinitionRevisionIdV1`. Later activation changes do not alter that
binding. After process loss, the host loads the stored definition under a
fresh scope-bound Task System capability, verifies every digest and immutable
artifact reference, and reconstructs a fresh compute capability without
consulting a mutable active head or accepting a caller artifact.

This receipt fixes the binding and recovery contract. It does not modify the
current Standard Application packages or protocols, create task artifacts,
add storage, implement a compute provider, expose a task route, or activate a
runtime.

## Current Flarex Runtime Authority

The current application-revision path already has the authority mechanics the
task system should extend.

### Registration

Application revision registration currently:

1. claims authenticated, definition-correlated analysis evidence;
2. resolves current trusted scope authority and the exact target;
3. prepares schema and function identity evidence;
4. derives immutable package and execution-artifact digests;
5. constructs deterministic runtime projections;
6. publishes projection objects immutably;
7. writes and replay-validates their target-local publication rows; and
8. registers one inactive application revision with canonical evidence.

The registered revision includes candidate, attempt, schema, function,
validator, handler-set, package, artifact, and registration-root evidence.
The narrow Standard Application registration result intentionally does not
expose those internals.

### Current Candidate And Runtime Publication

`DeclarativeV2CandidateFrameV1` currently commits source, semantic, package,
artifact, schema, validator, function-handler, runtime-projection, and
function-group-manifest evidence. Its runtime publication contains only
ordinary functions.

The current execution groups are exactly:

```text
transaction
edge_action
```

The function group entry is keyed by function ordinal/path and records
function kind, visibility, handler module/export, group, and projection
digest. It does not contain `TaskIdV1`, a canonical task manifest, retry or
duration policy, compute profile, queue policy, or a durable task handler
contract.

The current projection builder groups `query`, `mutation`, and
`workflowMutation` under `transaction`, and `action` under `edge_action`.
There is no durable-task execution group.

### Readiness, Activation, And Selection

Readiness proves the candidate and required runtime artifacts against the
located target. Activation revalidates that evidence under scope-clock-first
transaction ordering and publishes one application activation head.

`ActiveApplicationRevisionMetadataV1` commits:

- application and activation revision identity;
- candidate, readiness receipt, and activation-head digests;
- package and artifact digests;
- source and semantic roots;
- schema artifact and binding digests;
- function metadata, validator, and declared-handler roots; and
- runtime-projection-set and function-group-manifest digests.

`AuthenticatedActiveApplicationRevisionSelectionV1` holds that metadata,
trusted scope authority, schema manifest, candidate bytes, and loaded runtime
publication behind issuer-owned state. A copied record cannot recreate the
selection, and Scope release revokes it.

### Current Candidate-Bound Runtime Targets

Current point-mutation and query targets prove a useful reconstruction
pattern:

```text
issuer-backed active selection
  -> exact function entry and projection claim
  -> candidate/metadata/publication digest agreement
  -> immutable object-reference reads
  -> byte length, codec, kind, and digest validation
  -> projection/module-root recomputation
  -> canonical candidate-bound target frame
  -> ephemeral scoped runtime capability
```

The task runtime should reuse these verification, immutable-reference,
bounded-load, canonical-frame, and scoped-capability mechanics. It must not
reuse their mutation/query identity or pretend a task is a function path.

## Gap That Must Be Closed

The current revision is insufficient for durable tasks because:

- Standard Application definition now has the production-inert DTE04-A2b task
  catalog and runtime/authority frames, but no registration or activation
  integration;
- authenticated analysis emits no task-catalog evidence;
- the current candidate and registration roots contain no task commitment;
- runtime publication contains only function entries and the two function
  execution groups;
- active metadata and selection state contain no task catalog or task runtime
  publication;
- existing candidate-bound runtime targets select by function path; and
- compatibility date and exact runtime materialization are currently supplied
  by the function host rather than durably pinned for task recovery.

Adding an optional `taskId` to a function entry or mapping tasks to
`edge_action` would leave these gaps intact. It would also make the action
prototype the task identity and artifact owner, contradicting DTE02-B.

## Accepted Task Runtime Artifact Model

### Dedicated Execution Group

The first durable-task execution group is exactly:

```text
durable_task
```

It is separate from `transaction` and `edge_action` because its handler is
entered under durable run/attempt, cancellation, lease, retry, and compute
authority rather than a one-shot function invocation contract.

The group name classifies an immutable runtime projection. It does not choose
Cloudflare, AgentOS, a region, a machine, or a billing tier. Provider placement
remains the ComputeProvider owner's decision within the task definition's
admitted compute profile.

Current function projection code may supply reusable ordering, module framing,
root derivation, immutable publication, and corruption checks. The accepted
implementation must extract or adapt those mechanics without widening the
existing function-group discriminant in place as an incidental change.

### Canonical Task Catalog

One task-capable Standard Application revision owns a canonical ordered
catalog of the `CanonicalTaskManifestV1` values admitted by DTE02-B.

The catalog contract is:

- reject duplicate `TaskIdV1` values before registration;
- order entries deterministically by the canonical Task ID spelling;
- encode each manifest with one versioned canonical codec;
- hash every manifest independently;
- frame and hash the ordered catalog; and
- preserve task ID as the lookup key while treating module/export as handler
  evidence only.

The catalog root is named:

`taskCatalogSha256`

It commits task ID, handler binding, payload/output validators, run-attempt
policy, maximum duration, compute-profile reference, and queue policy because
those values are fields of `CanonicalTaskManifestV1`.

The exact Standard definition package placement and codecs are now closed by
DTE04-A2b in
[`24-standard-application-task-definition-contract.md`](./24-standard-application-task-definition-contract.md):
one private subpath on the existing definition owner, with no new package or
public protocol export. This earlier receipt fixed the required output but did
not itself authorize that implementation.

### Task Runtime Entry

The canonical task runtime entry is named:

`TaskRuntimeEntryFrameV1`

Its semantic fields are:

```ts
interface TaskRuntimeEntryFrameV1 {
  readonly kind: "task_runtime_entry";
  readonly taskOrdinal: bigint;
  readonly taskId: TaskIdV1;
  readonly canonicalTaskManifestSha256: Uint8Array;
  readonly logicalExecutionModule: string;
  readonly artifactExecutionModule: string;
  readonly exportName: string;
  readonly group: "durable_task";
  readonly projectionSha256: Uint8Array;
}
```

The task ordinal is a canonical catalog position, not logical identity. The
entry must agree with the manifest's handler binding and the artifact ingress
plan's logical-to-artifact module mapping. No runtime global registry or
function-path parsing establishes the binding.

The ordered entry hashes produce:

`taskEntryRootSha256`

### Task Runtime Projection

The task runtime projection is named:

`TaskRuntimeProjectionFrameV1`

It preserves the current immutable projection mechanics with the task-specific
group:

```ts
interface TaskRuntimeProjectionFrameV1 {
  readonly kind: "task_runtime_projection";
  readonly group: "durable_task";
  readonly executionModule: string;
  readonly moduleCount: bigint;
  readonly rawByteLength: bigint;
  readonly moduleRootSha256: Uint8Array;
}
```

Each module frame commits ordinal, artifact module path, the Source Artifact V2
role mask, `isolate` / `es_module` metadata, raw byte length, source digest, and
owned authenticated source bytes. The first version conservatively includes
every runtime-role module because the current ingress
contract does not publish a complete transitive import graph. That is a
bounded reuse of current projection behavior, not permission to include
analyzer evidence, source maps, credentials, or unrelated object bodies.

SAP-TRP1 now implements these task-owned frames, their canonical bodies, exact
UTF-8 path ordering, and a distinct typed module-root preimage. It does not
reuse the ordinary function projection codec or root namespace.

The projection digest is named:

`taskRuntimeProjectionSha256`

### Task Runtime Group Manifest

The task runtime group manifest is named:

`TaskRuntimeGroupManifestFrameV1`

Its semantic fields are:

```ts
interface TaskRuntimeGroupManifestFrameV1 {
  readonly kind: "task_runtime_group_manifest";
  readonly taskCatalogSha256: Uint8Array;
  readonly taskCount: bigint;
  readonly taskEntryRootSha256: Uint8Array;
  readonly taskRuntimeProjectionSha256: Uint8Array;
  readonly taskRuntimeMaterializationSpecSha256: Uint8Array;
}
```

Its digest is named:

`taskRuntimeGroupManifestSha256`

The group manifest binds definition, entry, projection, and runtime
materialization evidence. It is not the function group manifest with a renamed
kind.

### Immutable Object References

Task manifest, entry, projection, module, and group-manifest bytes use the same
content-addressed publication principles as current runtime artifacts:

- immutable object kind and codec identity;
- store identity;
- canonical object key;
- byte length;
- SHA-256 digest; and
- put-if-absent replay with byte-for-byte conflict detection.

The current `DeclarativeV2RuntimeArtifactObjectReferenceV1` kind union does not
admit task object kinds. A later protocol preflight must add a versioned
task-owned reference contract or deliberately extend the internal artifact
contract. It must not lie by storing task bytes under
`function-group-entry`, `function-group-manifest`, or `runtime-projection`
kinds.

## Runtime Materialization Specification

Durable recovery cannot depend on whatever Worker Loader version,
compatibility date, bridge source, or provider default happens to be current
when a retry occurs.

The canonical provider-neutral task runtime specification is named:

`TaskRuntimeMaterializationSpecV1`

It must commit:

- runtime contract identity, fixed for this first model as
  `flarex.task-runtime/durable-task/v1`;
- execution bridge/ABI identity;
- compatibility date and compatibility flags when the selected provider uses
  them;
- exact runtime profile and runtime implementation version;
- deterministic catalog-wide supported compute-profile policy/set; each task
  manifest remains authoritative for its exact per-task profile;
- deterministic module-entry construction policy; and
- any other configuration whose change can alter handler behavior or the
  generated compute artifact.

Preflight 39 clarifies the catalog cardinality behind this field: because one
application revision has one materialization-spec digest but may contain tasks
with different manifest-level compute profiles, the spec commits the supported
catalog-wide profile policy/set rather than one task's profile. The selected
task manifest remains the exact per-task profile authority.

Its canonical digest is:

`taskRuntimeMaterializationSpecSha256`

Provider credentials, account identifiers, regions selected at dispatch,
ephemeral Worker names, leases, and compute instance IDs are not part of the
specification. The future ComputeProvider may choose among locations that
satisfy the immutable profile, but it may not silently change the runtime ABI
or compatibility configuration.

Roadmap 06 owns the exact first Worker Loader/AgentOS implementation and ABI.
Before runtime activation, it must implement and validate every field committed
by this specification. DTE-IP01 does not need that implementation because it
is a production-inert domain package.

## Application Revision Task Binding

### Binding Frame

Task evidence is attached to the authenticated Application task-catalog
binding through one canonical child binding, not through a second deployment
head or a displaced Declarative candidate digest.

The binding frame is named:

`ApplicationRevisionTaskBinding`

Its semantic fields are:

```ts
interface ApplicationRevisionTaskBinding {
  readonly kind: "application_revision_task_binding";
  readonly applicationTaskCatalogBindingSha256: Uint8Array;
  readonly taskCatalogSha256: Uint8Array;
  readonly taskCount: bigint;
  readonly taskEntryRootSha256: Uint8Array;
  readonly taskRuntimeProjectionSha256: Uint8Array | null;
  readonly taskRuntimeGroupManifestSha256: Uint8Array | null;
  readonly taskRuntimeMaterializationSpecSha256: Uint8Array | null;
}
```

The digest is:

`applicationRevisionTaskBindingSha256`

For a populated task catalog, all three nullable runtime fields must be
present. For an explicitly empty task catalog, `taskCount` is zero, the entry
root is the canonical empty root, and all three runtime fields are `null`.
Mixed forms are invalid. A current Application revision with no task binding
is non-task-capable, not equivalent to an explicitly empty task-capable
revision. This absence state is not a second numbered runtime implementation.

The binding digest must enter the application revision's canonical
registration claim/root, readiness evidence, activation revision/head, and
active-selection state. Adding columns without adding those cryptographic
commitments is insufficient.

### One Revision And One Activation Head

The task binding is a child of the existing application revision:

```text
registered application revision
  existing candidate and function evidence
  applicationRevisionTaskBindingSha256
    canonical task catalog
    durable_task runtime group manifest
    durable_task projection and modules
    runtime materialization specification
```

There is no task deployment, task activation head, task “latest” pointer, or
second task readiness lifecycle. Application revision readiness must prove all
required task objects and supported runtime materialization evidence before a
task-capable revision can activate.

An application may remain valid for ordinary function invocation while being
ineligible for task activation only if a future roadmap deliberately defines
partial capability readiness. The first vertical does not: a populated task
catalog with missing or unsupported task runtime evidence makes the entire
revision not ready for activation.

### Active Selection Projection

The same `AuthenticatedActiveApplicationRevisionSelectionV1` must hold the
task binding and loaded task runtime publication behind issuer-owned state.
Task code receives neither the selection nor its artifact references.

A future persistence-owned claim operation may project a
task-specific basis from that selection, but it must prove:

- active metadata and task-binding digest agreement;
- candidate digest agreement;
- task catalog and task count agreement;
- task entry root and group-manifest agreement;
- task projection and materialization-spec agreement;
- exact `TaskIdV1` lookup and manifest digest agreement; and
- current trusted scope agreement from DTE02-C.

A structurally similar task-binding record cannot authorize run creation.

## Immutable Task-Definition Runtime Binding

### Definition Binding Versus Activation Receipt

Two different durable facts must not be collapsed.

`TaskDefinitionRuntimeBindingV1` identifies the immutable application/task
runtime tuple. Its semantic projection contains:

- `applicationRevisionId`;
- `candidateSha256`;
- `applicationRevisionTaskBindingSha256`;
- `TaskIdV1` and canonical task-manifest digest;
- task entry digest and entry fields;
- task catalog, entry-root, projection, group-manifest, and materialization
  specification digests;
- package, artifact, source-root, and semantic-root digests from the same
  candidate;
- payload/output validator commitments and normalized policy through the task
  manifest digest; and
- immutable object references needed to reconstruct the task projection.

It deliberately excludes the active-head digest and activation revision. The
same task definition in one application revision must not receive a new
definition identity merely because that application revision is observed
through a later activation event.

`TaskRunCreationAuthorityReceiptV1` separately records the active evidence
that authorized a new run:

- application revision ID;
- activation revision;
- activation-head digest;
- readiness-receipt digest;
- candidate digest;
- application-revision task-binding digest; and
- task-definition revision ID selected for the run.

The receipt is durable audit/idempotency evidence, not a capability. Existing
run continuation does not revalidate it against the current active head.

### Definition Revision Identity

`TaskDefinitionRevisionIdV1` denotes exactly one accepted
`TaskDefinitionRuntimeBindingV1`. The Task System may store the canonical
binding directly or normalize it across application-revision rows, but:

- identical scope/application-revision/task bindings must converge;
- different manifest, handler, artifact, projection, runtime spec, validator,
  retry, duration, compute, or queue evidence must not converge;
- the ID remains distinct from application revision, task ID, candidate
  digest, manifest digest, or runtime-target digest; and
- DTE02-E now fixes its identity as storage-issued `taskdef_` plus canonical
  lowercase UUIDv4; Roadmap 04 owns the unique semantic binding constraint and
  transactional implementation.

The stored row is physically constrained by the trusted scope. Scope identity
is not reintroduced as a caller command field merely because persistence keys
the record correctly.

### Run Binding

New-run creation under the active selection performs:

```text
claim active task basis for TaskIdV1
  -> match fresh scope authority under DTE02-C
  -> validate catalog, manifest, entry, projection, and binding roots
  -> find or insert immutable TaskDefinitionRevisionIdV1
  -> validate payload against the bound manifest
  -> atomically insert run with TaskDefinitionRevisionIdV1
  -> store TaskRunCreationAuthorityReceiptV1
```

The run does not store a mutable task ID lookup as its execution target. Task
ID remains useful for display and audit, but execution follows the captured
definition revision.

## Recovery And Compute Resolution

### Restart-Safe Recovery Flow

After all process-local capabilities are lost:

```text
trusted internal wake or recovery operation
  -> reacquire scope-bound Task System store under DTE02-C
  -> load run by captured scope and TaskRunIdV1
  -> load TaskDefinitionRevisionIdV1 and canonical stored binding
  -> validate stored binding and application-revision linkage
  -> load immutable task manifest/entry/manifest/projection/module objects
  -> validate kind, codec, store, key, length, digest, ordering, and roots
  -> validate task runtime materialization specification
  -> issue a fresh scoped authenticated task-runtime binding
  -> ask the admitted ComputeProvider to materialize/dispatch the exact target
  -> execute under run ID, attempt ID, fence, cancellation, and lease authority
```

The current active revision is not read. A task removed or changed in a later
revision therefore does not alter an existing run.

The compute host may derive a provider-specific content-addressed runtime
target digest from the verified binding and materialization spec. That digest
is an execution/materialization identity, not `TaskDefinitionRevisionIdV1`.
Recreating the same target after restart must yield the same canonical target
digest.

### Artifact Availability And Corruption

Required failure distinctions are:

| Condition | Required classification |
| --- | --- |
| definition revision absent under captured scope | non-disclosing task definition unavailable |
| immutable reference absent but retention requires it | artifact unavailable; retry only under explicit availability policy |
| object-store read or target-resource rejection | typed transient or terminal resource failure according to the boundary |
| reference kind, codec, store, key, or length mismatch | corruption |
| object bytes do not match SHA-256 | corruption |
| task catalog, entry, projection, module, manifest, or binding root mismatch | corruption |
| runtime materialization spec unsupported | terminal unsupported-runtime failure |
| provider cannot currently allocate an allowed compute target | compute availability failure, not artifact corruption |

No failure falls back to:

- the currently active application revision;
- another task with the same handler path;
- an action/function entry;
- another projection or artifact object;
- source-island Trigger execution; or
- a newly generated artifact under mutable host defaults.

### Retention

Every object referenced by a non-terminal run or a run retained for supported
replay/inspection must remain available. Garbage collection requires a later
retention roadmap that understands definition-revision and run references.

The first vertical must use conservative retention. Manual application
deletion, later activation, or task removal does not authorize deleting
artifacts still referenced by retained runs.

## Later Activation Behavior

| Event | New runs | Existing runs and attempts |
| --- | --- | --- |
| activate another revision with the same TaskIdV1 and otherwise unchanged task content | receive a new definition revision because application revision ID is part of the binding | remain on captured definition revision |
| activate revision with same TaskIdV1 but changed manifest/handler/runtime | receive a new definition revision | remain unchanged |
| activate revision without the task | task lookup fails for new runs | remain unchanged and recover from old binding |
| rename module/export without changing TaskIdV1 | new revision captures changed handler evidence | remain on old handler evidence |
| change compute profile, duration, retry, validators, queue policy, compatibility config, or runtime ABI | new immutable definition revision | remain unchanged |
| deactivate/delete current application | policy may reject new runs | in-flight/retained behavior requires explicit operational policy; artifacts are not deleted implicitly |

No row or cache named `latest_task_definition` is admitted.

## Package And Owner Boundaries

### Standard Application Owners

The future task-catalog extension owns canonical task intent, duplicate ID
rejection, manifest encoding, catalog ordering, and authenticated analysis
evidence. It extends the same definition/analysis stages; it does not create a
parallel task application parser.

### Persistence Owner

`@flarex/persistence-postgres` owns registration binding, immutable runtime
publication rows, readiness/activation integration, issuer-backed active task
claims, stored definition binding, corruption checks, and scope-keyed
transactions. Roadmap 04 authorizes its schema and adapter changes later.

### Durable-Task Domain Owner

`@flarex/durable-task` receives only task-definition revision identity and the
policy snapshot needed by its lifecycle store contract. It does not import
candidate frames, runtime object references, R2, Standard Application,
persistence, or backend runtime targets.

### Backend And Compute Owners

`flarex-backend` owns active-selection composition, immutable object loading,
task runtime capability issuance, and ComputeProvider dispatch. Roadmap 06
owns provider materialization, ABI, cancellation/interruption, and runtime
context.

### Protocol Placement

The accepted frame names in this receipt are private ownership contracts, not
authorization for public `flarex-protocol` exports. The task-catalog and
runtime package preflights must select internal subpaths, codecs, dependency
direction, and versioning without widening current public contracts.

## Required Proof Matrix

### Definition And Registration

1. task catalog ordering and manifest hashes are deterministic;
2. duplicate Task IDs fail before registration;
3. task entries agree with catalog manifests and artifact module bindings;
4. changing any task manifest/runtime field changes the relevant binding
   digest;
5. identical application-revision task binding replays converge;
6. legacy revisions lacking the binding cannot masquerade as empty task
   catalogs; and
7. task evidence enters registration root and cannot be swapped under the same
   application revision.

### Readiness And Activation

1. a populated task catalog requires a complete `durable_task` projection,
   group manifest, object references, and materialization specification;
2. missing/corrupt task objects prevent readiness;
3. readiness receipt and activation head commit the task binding digest;
4. active selection claims reject copied, revoked, or contradictory task
   evidence;
5. task-capable activation remains the existing application activation head;
   and
6. no action/function entry can satisfy a task claim.

### Run Binding And Recovery

1. new-run lookup uses stable Task ID under an issuer-backed active selection;
2. the run captures exactly one task-definition revision;
3. later activation does not change an existing run;
4. restart recovery succeeds without current active selection;
5. recovery recomputes every catalog/entry/projection/module/binding root;
6. missing objects, foreign resource failure, corruption, and unsupported
   runtime remain distinct;
7. mutable host compatibility/runtime defaults cannot change recovered target
   identity; and
8. scope A cannot load scope B's definition revision or artifact binding.

### Current Evidence Reused

Current Flarex tests already prove deterministic function runtime projection,
immutable publication replay/conflict behavior, candidate/publication
corruption checks, readiness/activation coherence, issuer-backed active
selection, candidate-bound target hashing, bounded object reads, exact module
root validation, and PGlite/Postgres parity for current function paths.

Those are reusable mechanics and test patterns. They do not prove any task
catalog, `durable_task` projection, or task runtime exists.

## DTE01 And DTE-IP01 Consequences

DTE01 remains unchanged. The production-inert run-attempt package needs only
opaque task-definition revision identity and deterministic lifecycle policy.
It does not load or interpret the runtime binding defined here.

DTE-IP01 may use test-owned task-definition revision fixtures and policy
snapshots. It must not add candidate frames, R2 references, active selections,
runtime materialization specs, ComputeProvider calls, or a fake artifact
loader to `@flarex/durable-task`.

DTE02-E has now fixed the exact identity types and validation owners in
[`09-domain-identity-types-and-ownership.md`](./09-domain-identity-types-and-ownership.md).
DTE02-F now maps the run-attempt commands to the opaque
`TaskDefinitionRevisionIdV1` without exposing this binding surface in
[`10-dte-ip01-input-and-store-port-contract.md`](./10-dte-ip01-input-and-store-port-contract.md).

## Explicit Non-Goals

DTE02-D does not authorize:

- task catalog implementation or a new Standard Application package;
- mutation of the current candidate/protocol schemas;
- a task table, definition table, artifact table, or migration;
- an R2 bucket, object write, or retention worker;
- a third execution group in active production code;
- action-to-task conversion;
- a task deployment/readiness/activation head;
- Worker Loader, AgentOS, ComputeProvider, or task context implementation;
- provider credentials, regions, quotas, billing, or machine tiers;
- public task definition, invocation, management, observability, or UI APIs;
- current-run retargeting, dual runtime, fallback, or shadow execution; or
- production activation.

## Decision Receipt

DTE02-D is complete with these conclusions:

1. task runtime evidence is a child of the existing application revision and
   activation head, never a second task deployment system;
2. tasks use a separate `durable_task` projection and task runtime group
   manifest, not `edge_action` or an ordinary function entry;
3. canonical task catalog, task entry root, task projection, task group
   manifest, and runtime materialization specification have separate committed
   digests;
4. `applicationRevisionTaskBindingSha256` binds that evidence to the existing
   candidate and must enter registration, readiness, activation, and the
   issuer-backed selection;
5. `TaskDefinitionRuntimeBindingV1` is stable for one application revision and
   task definition, while `TaskRunCreationAuthorityReceiptV1` separately
   records the activation that authorized a new run;
6. each run captures exactly one `TaskDefinitionRevisionIdV1` and never
   resolves `latest` again;
7. restart recovery loads immutable stored binding and content-addressed
   objects under fresh scope authority without consulting current activation;
8. runtime ABI, compatibility configuration, and materialization policy are
   immutable digest inputs rather than host defaults;
9. current runtime publication and candidate-bound target mechanics are reuse
   inputs, while their function identity and groups are not;
10. DTE01 admission and DTE-IP01 scope remain unchanged; and
11. DTE02-E domain identity types and ownership is now complete in
    [`09-domain-identity-types-and-ownership.md`](./09-domain-identity-types-and-ownership.md),
    and DTE02-F is now complete in
    [`10-dte-ip01-input-and-store-port-contract.md`](./10-dte-ip01-input-and-store-port-contract.md).

## Authority And Evidence

This decision is grounded in:

- `packages/persistence-postgres/src/applicationRevisionRegistrationV1.ts`;
- `packages/persistence-postgres/src/candidateRuntimeProjectionV1.ts`;
- `packages/persistence-postgres/src/candidateRuntimePublicationRepositoryV1.ts`;
- `packages/persistence-postgres/src/applicationRevisionReadinessV1.ts`;
- `packages/persistence-postgres/src/applicationRevisionActivationV1.ts`;
- `packages/persistence-postgres/src/applicationRevisionActiveSelectionStateV1.ts`;
- current mutation/query application-revision runtime-target adapters;
- current candidate-bound runtime-target protocol and backend loaders;
- [`../02-task-definition-identity-and-scope.md`](../02-task-definition-identity-and-scope.md);
- [`./06-task-target-and-definition-contract.md`](./06-task-target-and-definition-contract.md);
- [`./07-scope-capability-contract.md`](./07-scope-capability-contract.md); and
- [`./05-final-package-admission.md`](./05-final-package-admission.md).
