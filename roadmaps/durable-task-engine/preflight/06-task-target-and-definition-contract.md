# DTE02-B: First-Class Task Definition Contract

## Decision

**Outcome: REVISE the earlier action-based candidate and ADMIT a first-class
Flarex task-definition model derived from Trigger.dev's task contract.**

The first private durable task is not an `action`, `internalAction`, mutation,
query, or `workflowMutation`. It is a separate Standard Application task
definition with:

- one stable developer task ID;
- one immutable handler/artifact binding;
- payload and output validation;
- normalized retry and maximum-duration policy;
- Flarex-owned compute policy;
- one first-version queue policy; and
- a `run` handler executed under durable run/attempt authority.

Existing Flarex `action` and `internalAction` code is prototype evidence only.
It may later contribute sandbox, artifact-loading, external-I/O, or nested-call
mechanics, but it does not define task identity, task metadata, execution
lifecycle, or public API direction.

This correction does not revoke DTE01's run-attempt package admission. It
changes the definition and identity feeding that engine before implementation
begins.

## Why The Earlier Action Decision Was Withdrawn

The current Flarex action surface proves only that the repository can describe
an `action` function kind with public/internal visibility and an `ActionCtx`
containing authentication plus `runQuery`/`runMutation` placeholders. Current
roadmaps already state that actions are not executable end to end.

That prototype is too weak to become durable-task authority. Treating it as
the foundation would incorrectly make these provisional choices permanent:

- function path as logical task identity;
- `internal` visibility as task authorization;
- `edge_action` as the durable task artifact class;
- `ActionCtx` as the durable task context; and
- action invocation semantics as the task execution contract.

None follows from Trigger.dev's task model or from the durable lifecycle we
already admitted. The revised decision removes those assumptions now, before
schema or package implementation makes them expensive.

## Trigger.dev Definition Logic To Reuse

The pinned Trigger source already separates task metadata from run-engine
state. Its reusable definition concepts include:

- `TaskOptions` / `CommonTaskOptions`;
- stable `id` that remains constant between deployment versions;
- payload schema and JSON-schema metadata;
- `run` handler;
- retry policy and defaults;
- queue name and concurrency limit;
- maximum duration and TTL;
- compute or machine selection;
- lifecycle hooks;
- `TaskMetadata` and `TaskManifest`;
- task resource catalog and handler lookup; and
- duplicate task-ID collision detection across source files.

These are migration inputs, not dependencies. Flarex will source-map and adapt
their semantics into Flarex-owned types, Effect decoders, canonical encodings,
artifacts, and tests. Active packages still may not import `@trigger.dev/*` or
the frozen source island.

### Reuse Classification

| Trigger capability | Flarex treatment |
| --- | --- |
| stable task ID and duplicate collision behavior | preserve semantics and hostile tests |
| task metadata/manifest field meanings | seam-adapt into a canonical private Flarex task manifest |
| retry defaults and backoff algorithm | reuse under DTE01's admitted deterministic policy |
| task resource catalog lookup | adapt into immutable revision/artifact lookup; remove global mutable runtime authority |
| `run` handler and payload/output typing | preserve developer semantics behind a Flarex runtime boundary |
| maximum duration | preserve meaning with database/compute-owned enforcement evidence |
| queue and concurrency metadata | translate to the private Task System and later scheduling owner |
| machine preset | replace with a Flarex compute-profile reference |
| organization/project/environment/deployment fields | discard; resolve through Flarex control-plane and scope authority |
| runtime global registration and Node file-context behavior | replace with deterministic Standard Application analysis/indexing |
| Trigger lifecycle hooks | defer until their execution ordering and failure semantics have their own source map |

Reimplementation remains last. A field or algorithm is rewritten only when it
cannot be separated from Trigger product, host, or storage authority.

## First-Class Standard Application Model

The target Standard Application shape has two distinct catalogs:

```text
Standard Application revision
  function catalog
    query
    mutation
    action
    workflowMutation

  task catalog
    CanonicalTaskManifestV1
      taskId
      handler binding
      payload/output validators
      run-attempt policy
      maximum duration
      compute profile
      queue policy
```

The task catalog is not a fifth ordinary function kind. A task is a durable
execution definition whose handler, policies, and lifecycle are bound
together. The handler may reuse common artifact mechanics, but its definition
cannot be reconstructed from a function entry alone.

The existing Standard Application definition API does not currently implement
this task catalog. A later focused implementation preflight must extend the
private Standard definition/analysis/registration chain without weakening the
existing function contract or introducing a second competing application
definition.

## Canonical Private Task Manifest

The working normalized type name is:

`CanonicalTaskManifestV1`

Its first-version semantic fields are:

```ts
interface CanonicalTaskManifestV1 {
  readonly version: 1;
  readonly taskId: TaskIdV1;
  readonly handler: CanonicalTaskHandlerBindingV1;
  readonly payloadValidator: CanonicalTaskValidatorV1;
  readonly outputValidator: CanonicalTaskValidatorV1 | null;
  readonly runAttemptPolicy: RunAttemptPolicyV1;
  readonly maximumDurationInSeconds: number;
  readonly computeProfile: TaskComputeProfileRefV1;
  readonly queue: { readonly kind: "default" };
}
```

These are ownership names, not implementation authorization. DTE02-D/E and
the future task-definition package preflight must decide exact codecs, imports,
brands, and protocol placement before code is added.

### First-Version Inclusion

The first private vertical includes:

- stable task ID;
- one handler export and immutable artifact binding;
- payload and output validators;
- retry policy;
- maximum attempt duration;
- one default queue;
- one Flarex compute profile; and
- the `run` handler.

### Deferred Definition Features

The first private vertical excludes:

- named queues and configurable concurrency;
- TTL;
- schedules and trigger sources;
- lifecycle hooks and middleware;
- catch-error callbacks that mutate retry policy;
- child tasks;
- batches and debounce;
- waitpoints and checkpoints;
- user-selected deployment versions or regions;
- Trigger machine names and pricing tiers; and
- public `task()` SDK syntax.

Those Trigger features remain reuse candidates with their source and tests.
They are not discarded merely because the first vertical defers them.

## Stable Logical Task Identity

The first logical task key is:

```text
(trusted Flarex scope, TaskIdV1)
```

`TaskIdV1` preserves Trigger's important semantic rule: a developer-specified
task ID is unique within the application/scope and remains stable across
application revisions.

Consequences:

- the same task ID in a later application revision is the same logical task
  with a new immutable definition revision;
- changing the task ID creates a different logical task;
- renaming a source file, module, export, or bundle path does not by itself
  change logical task identity;
- task ID is not globally unique across scopes;
- knowing a task ID does not authorize run creation; and
- duplicate task IDs in one analyzed application are rejected before
  registration.

Function path may remain handler-location evidence. It is not the logical task
key and must not leak into public task identity.

## Immutable Task-Definition Revision

The working identity remains:

`TaskDefinitionRevisionIdV1`

One revision binds exactly one accepted tuple:

- trusted scope supplied by authority;
- stable `TaskIdV1`;
- immutable application revision ID;
- canonical task manifest digest;
- exact handler module/export and artifact evidence;
- payload and output validator commitments;
- normalized run-attempt policy;
- maximum duration;
- compute-profile reference; and
- queue-policy version.

Changing any tuple member creates another definition revision. There is no
mutable `latest` policy, handler, artifact, or compute target inside a revision.

A run captures one `TaskDefinitionRevisionIdV1` at creation. Later application
activation changes which revision new runs resolve, but never retargets an
existing run or attempt.

## Standard Application Stage Integration

### 1. Private Definition

A private producer supplies task intent to the Standard Application definition
owner. The producer is not yet a public SDK. The definition owner normalizes
task IDs, handler bindings, validators, and policies into the canonical task
catalog beside the existing canonical function program.

### 2. Analysis And Indexing

Analysis validates the task catalog and handler source graph, rejects duplicate
task IDs, and produces canonical task-manifest evidence. Trigger's indexer and
resource-catalog behavior are the reuse oracle, but a mutable runtime global is
not the Flarex authority.

### 3. Registration

Application revision registration binds the canonical task-catalog digest,
handler artifact commitments, and validator/policy evidence into the immutable
application revision. Registration remains inactive.

### 4. Readiness And Activation

Readiness proves required task artifacts can be materialized and validated.
Activation includes task-catalog/artifact commitments in the same coherent
application revision selection. DTE02 does not create a second task deployment
head.

### 5. Run Creation

Under an authenticated active application selection and a scope-bound Task
System capability, run creation resolves `TaskIdV1` from the canonical task
catalog, captures its immutable definition revision, validates the payload,
and performs idempotent durable run insertion.

## Task Handler And Runtime Boundary

The durable task handler receives a task-specific context, not today's
prototype `ActionCtx` by inheritance.

The future context may expose deliberately admitted capabilities such as:

- run and attempt metadata;
- cancellation signal;
- structured logger and trace context;
- `runQuery` and `runMutation` through existing Flarex runtime owners;
- child-task and wait capabilities only after their roadmaps; and
- no raw Task System, Postgres, Drizzle, Cloudflare, object-store, or compute
  credentials.

Action runtime work may later supply reusable sandbox or nested-call mechanics.
That is implementation reuse below the task contract, not an `action -> task`
identity mapping.

The task artifact class and exact execution-group spelling remain DTE02-D and
Roadmap 06 decisions. They must not default silently to `edge_action` merely
because that prototype group exists.

## Versioned Run-Attempt Policy

Task retry policy remains owned by the durable-task domain, not by the existing
function catalog. The first version preserves the DTE01-admitted Trigger
semantics:

```ts
interface RunAttemptPolicyV1 {
  readonly version: 1;
  readonly retry: {
    readonly maxAttempts: number;
    readonly factor: number;
    readonly minTimeoutInMs: number;
    readonly maxTimeoutInMs: number;
    readonly randomize: boolean;
  };
  readonly outOfMemory: { readonly kind: "disabled" };
}
```

Omitted private input fields normalize to:

```text
maxAttempts = 3
factor = 2
minTimeoutInMs = 1,000
maxTimeoutInMs = 60,000
randomize = true
outOfMemory = disabled
```

DTE01's deterministic jitter, attempt numbering, duration output, finite/safe
validation, corruption separation, and compatibility tests remain in force.
Compute escalation stays disabled until a Flarex compute-profile owner exists.

Maximum duration is separate from retry delay. It belongs to the immutable
task manifest and requires compute interruption plus durable attempt evidence;
it must not be approximated by a process-local timer alone.

## Definition Registration Idempotency

The registration request still uses a scope-local idempotency key and a
canonical claim digest.

Required behavior remains:

| Existing state | New request | Result |
| --- | --- | --- |
| no receipt, no matching claim | valid key and claim | insert one definition revision and receipt |
| same key, same claim digest | identical replay | return original revision |
| same key, different claim digest | conflicting reuse | typed request-key conflict |
| different key, same claim digest | identical task definition | converge on the same revision |
| different key, different claim digest | new immutable definition | insert another revision |

The canonical claim now includes stable task ID and canonical task-manifest
evidence rather than treating function path/action metadata as the definition.

## Package Consequences

DTE01 remains admitted exactly as a run-attempt lifecycle package with only
`./internal/run-attempt-v1`. It may receive validated task-definition-revision
identity and policy snapshots through its store contract, but it does not own
Standard Application task definition, analysis, registration, or artifacts.

The first-class task catalog requires its own focused package/API preflight.
That preflight must decide whether the owner is an extension of the private
Standard Application definition chain or a narrow task-definition package
consumed by it. This receipt does not authorize another package, dependency,
or public export.

No active package may import Trigger task types directly. Provenance mapping
must point from each adapted task-definition/catalog symbol to its Flarex owner
and retained tests.

## Required Proofs

### Definition And Catalog

- stable task IDs survive application revisions;
- duplicate IDs across files/modules are rejected deterministically;
- source/module/export renames do not silently change logical identity;
- unknown manifest fields and invalid policy fail closed;
- canonical task ordering and digest behavior are deterministic; and
- no action/function entry can masquerade as a task manifest.

### Revision And Activation

- a definition revision binds task ID, application revision, artifact,
  validators, and policy coherently;
- identical registration replays converge;
- later activation affects only new runs;
- existing runs remain pinned after task changes or removal; and
- a caller cannot provide its own artifact or scope and claim authority.

### Trigger Compatibility

- task ID stability and duplicate-collision scenarios are retained;
- retry defaults and backoff vectors remain compatible;
- included first-version task fields have a source-map entry;
- deferred Trigger fields remain explicitly inventoried; and
- Trigger organization, environment, deployment, machine, and host globals do
  not enter the Flarex domain contract.

## Decision Receipt

DTE02-B is complete after revision with these conclusions:

1. durable tasks are first-class Standard Application definitions;
2. `TaskIdV1`, not function path, is the logical task identity;
3. `CanonicalTaskManifestV1` is separate from the existing function catalog;
4. immutable definition revisions bind task, application, artifact, validator,
   policy, duration, compute, and queue evidence;
5. Trigger task metadata, manifest, catalog, collision, retry, and executor
   semantics are reuse inputs;
6. Flarex action prototypes do not define task identity or lifecycle;
7. DTE01 run-attempt admission remains valid; and
8. DTE02-C was the required next handoff and is now completed by
   [`07-scope-capability-contract.md`](./07-scope-capability-contract.md).

## Authority And Evidence

This revised decision is grounded in:

- Trigger `CommonTaskOptions`, `TaskOptions`, `TaskMetadata`, `TaskManifest`,
  `TaskMetadataWithFunctions`, and resource-catalog collision behavior;
- current Flarex action code and roadmap evidence that it is not executable end
  to end;
- [`../02-task-definition-identity-and-scope.md`](../02-task-definition-identity-and-scope.md);
- [`./05-final-package-admission.md`](./05-final-package-admission.md); and
- the DTE01 source map for retry and run-attempt behavior.
