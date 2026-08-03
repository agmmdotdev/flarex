# DTE01: Trigger Source Reuse And Package Admission

## Status And Mandate

**Status:** Active design preflight. The first substantial DTE01-A capability
closure is complete; no package admission or implementation is authorized yet.

This roadmap owns the first decision required by the
[`Flarex Durable Task Engine`](./README.md) roadmap family:

> Which connected Trigger.dev source slice should Flarex reuse first, how will
> its dependency and authority seams be transformed, and what evidence must
> exist before that transformed source enters the active Flarex workspace?

This is not the task database roadmap and does not define task tables. It must
finish before schema design because the retained lifecycle, transaction units,
identity inputs, failure behavior, and recovery semantics determine what the
private Task System API and its persistence implementation must guarantee.

Completion of this roadmap may authorize one bounded transformed package slice.
It does not authorize the complete Trigger run engine, a merged workspace,
production routing, public APIs, or the later durable-task vertical.

## Preflight Receipts

- [`preflight/01-run-attempt-lifecycle-closure.md`](./preflight/01-run-attempt-lifecycle-closure.md)
  accepts the complete run-attempt lifecycle as the first medium capability,
  rejects whole-file copying, identifies its authority and atomicity seams, and
  defines the source/test closure for DTE01-B.

## Parent Vision And Fixed Boundaries

The parent vision fixes these decisions:

1. Trigger.dev is migration input and a regression oracle, not an embedded
   Flarex product or permanent runtime dependency.
2. Source reuse is the default. Reimplementation requires evidence that reuse,
   seam adaptation, or adapter translation cannot preserve the correct
   behavior without importing the wrong authority.
3. The frozen Trigger workspace and the active Flarex workspace retain separate
   manifests, pnpm lockfiles, dependency versions, generation commands, and
   test lanes during extraction.
4. Trigger organizations, membership, auth, billing, routing, Prisma, Redis,
   Redlock, Node supervisor, Docker, Kubernetes, registry, and compute-provider
   ownership are not Flarex authority.
5. Active Flarex packages must not import Trigger package names, generated
   Trigger clients, or `third_party/trigger.dev` paths.
6. Transformed source must use root-owned package manifests and dependencies,
   preserve required license notices and source provenance, and pass Flarex
   package and Worker bundle boundaries.
7. Test-only differential comparison is permitted. Production dual execution,
   dual writes, shadow task authority, fallback to Trigger, and runtime
   comparison are forbidden.

This roadmap may refine the extraction mechanics. It may not weaken those
boundaries merely to make the first import easier.

## Current Source Island

The compatibility island is pinned by
[`../../third_party/trigger.dev/SOURCE.json`](../../third_party/trigger.dev/SOURCE.json)
to Trigger.dev commit
`f10bc23785e569e5d917318cf2033aabdbe96a0b`. The imported upstream tree is
verified against [`SOURCE_SHA256SUMS`](../../third_party/trigger.dev/SOURCE_SHA256SUMS)
and retains the upstream Apache License 2.0 repository license plus the
package-local MIT license for the imported `@trigger.dev/core` source.

Its pnpm workspace contains:

- `@internal/run-engine`;
- `@internal/run-store`;
- `@internal/run-ops-database`;
- `@trigger.dev/database`;
- `@internal/redis` and `@trigger.dev/redis-worker`;
- `@internal/cache`;
- `@internal/metrics-pipeline` and `@internal/tracing`;
- `@internal/compute`;
- `@internal/testcontainers`;
- the selected `@trigger.dev/core` source; and
- the Trigger supervisor application.

The run engine directly depends on Trigger database/core packages, run store,
Redis worker, cache, tracing, metrics, Redlock, and other Node-oriented
dependencies. Package presence therefore does not identify a portable source
boundary. DTE01 must trace the actual file-and-symbol closure for the selected
behavior.

## Reuse Ladder

Every selected source file, exported symbol, and directly required test must be
classified into exactly one primary reuse class.

| Class | Meaning | Default treatment |
| --- | --- | --- |
| `U`: unchanged reuse | Runtime behavior and contract are already portable and correct for Flarex. | Copy the implementation and tests with provenance; change only package/build imports that do not alter semantics. |
| `S`: seam-adapted reuse | Control flow and decisions are reusable, but direct dependencies must become narrow Flarex ports or supplied values. | Preserve the connected operation and failure order; replace only authority-bearing inputs and outputs. |
| `T`: adapter translation | The module owns persistence, queue, lock, transport, or host mechanics that Flarex implements differently. | Preserve operation semantics, transaction/order constraints, race cases, and tests while translating mechanics to the correct Flarex owner. |
| `D`: discard or reimplement | Behavior is Trigger product policy, contradicts Flarex authority, or cannot be separated safely. | Record the exact reason and retained tests/invariants; reimplementation is last and must be bounded to the irreducible concern. |

Classification is per connected behavior, not per filename convenience. One
large Trigger file may contain reusable policy, adapter mechanics, and product
policy that require different target owners. Splitting is allowed only after
the complete operation and its failure ordering have been characterized.

## Candidate First Source Slice

The current hypothesis is to start from a substantial, medium-sized connected
capability: the complete run-attempt lifecycle required by the first private
product proof. The slice should cover attempt start, completion, retry,
cancellation, stale or duplicate outcomes, and the execution-state evidence
that connects those decisions. Candidate production sources include:

- [`statuses.ts`](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/statuses.ts)
  for run and execution-status predicates;
- [`retrying.ts`](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/retrying.ts)
  for completion-to-cancel/fail/retry decisions;
- [`runAttemptSystem.ts`](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/systems/runAttemptSystem.ts)
  for start, completion, retry, and attempt orchestration;
- [`executionSnapshotSystem.ts`](../../third_party/trigger.dev/upstream/internal-packages/run-engine/src/engine/systems/executionSnapshotSystem.ts)
  for execution-state evidence used by the attempt path;
- the exact constants, errors, event shapes, run-store operations, core retry
  helpers, and compute/runtime types called by those modules; and
- their direct unit, integration, replica-lag, race, restart, and uncertainty
  tests.

This list is a hypothesis, not an approved copy set. DTE01-A must prove the
complete transitive source and test closure and may reshape or reject it. It
must not shrink the slice to isolated predicates or retry helpers that avoid
the actual orchestration, persistence, race, and recovery seams. In particular,
it must determine whether execution snapshots are part of the first Flarex
authority or a Trigger representation projected from the run/attempt contract.

The first slice should exclude unless the closure proves an immediate need:

- batches and bulk actions;
- debounce;
- waitpoints and checkpoints;
- TTL sweeping;
- advanced fair-queue and concurrency-key algorithms;
- pending-version promotion;
- broad run-list, dashboard, and public realtime APIs;
- Trigger billing, machine pricing, and entitlement behavior;
- Redis key formats, Lua scripts, and Redlock implementation;
- Docker/Kubernetes/registry supervisor behavior; and
- public Trigger SDK compatibility.

Exclusion means later ownership, not loss of provenance or evidence.

## Required Source Map

DTE01 must produce a machine-readable or mechanically checkable source map for
every admitted file or symbol. Each entry must contain at least:

```ts
type TriggerSourceReuseEntry = {
  readonly upstreamCommit: string;
  readonly upstreamPath: string;
  readonly upstreamSha256: string;
  readonly selectedSymbols: readonly string[] | "whole-file";
  readonly targetPackage: string;
  readonly targetPath: string;
  readonly reuseClass: "U" | "S" | "T" | "D";
  readonly semanticChanges: readonly string[];
  readonly authorityReason: string;
  readonly retainedTests: readonly string[];
  readonly addedFlarexTests: readonly string[];
  readonly licenseNotice: "apache-2.0" | "mit" | "mixed";
};
```

The final representation may differ, but it must support these checks:

- every transformed source file has an exact upstream origin or is explicitly
  Flarex-authored;
- unchanged and adapted source can be distinguished;
- semantic changes are not hidden inside formatting or import rewrites;
- discarded behavior has a recorded reason and retained invariant/test owner;
- upstream source hashes still identify the pinned import; and
- required license and notice content can be audited before publication or
  distribution.

The source map is not permission to regenerate active source automatically from
the internet or a moving upstream branch. The pinned island remains the sole
extraction input until a separate source-refresh decision.

## DTE01-A: Prove The Connected Capability Closure

### Objective

Identify the complete medium-sized Trigger capability required for the first
run-attempt lifecycle proof and enumerate every source, type, generated
contract, test, and runtime dependency it actually uses.

### Required analysis

For each candidate entrypoint:

1. trace static and dynamic imports;
2. trace injected resources and direct global/singleton use;
3. trace Prisma models, selects/includes, unique errors, and transaction
   clients;
4. trace Redis/Redlock operations and the invariants callers expect from them;
5. trace clock, randomness, ID generation, timers, logging, tracing, metrics,
   and process/runtime assumptions;
6. trace Trigger organization/project/environment/deployment/auth/product data;
7. identify all state transitions, external effects, emitted events, and
   failure/exception exits;
8. identify tests that cover ordinary, duplicate, race, restart, replica-lag,
   cancellation, and uncertainty paths; and
9. identify behavior that is currently implicit in schema constraints, Prisma
   errors, Redis scripts, or process lifetime rather than explicit code.

### Deliverable

A bounded capability graph showing:

```text
Trigger entry operation
  -> reusable decisions
  -> required Trigger domain/core types
  -> required run-store operations
  -> required queue/lock/compute/event capabilities
  -> required tests and fixtures
```

### Exit criteria

- The slice has one named product outcome, not a miscellaneous helper list.
- Every production dependency and direct behavioral test is accounted for.
- Hidden database, Redis, clock, and process authority is explicit.
- Excluded adjacent features have named later owners.
- The closure is substantial enough to exercise orchestration, state,
  persistence, race, and recovery seams while remaining bounded enough for one
  coherent transformed-package admission checkpoint.

## DTE01-B: Classify Reuse And Semantic Change

### Objective

Assign `U`, `S`, `T`, or `D` to the proven closure and state exactly how much of
the Trigger implementation remains.

### Rules

- Type-only coupling does not justify rewriting a function. Replace the type
  owner and preserve behavior when the runtime contract is still correct.
- A direct store lookup inside reusable policy should normally become a supplied
  immutable input or a narrow capability, while retaining decision order.
- A Prisma operation should be translated from its existing semantics and
  tests, not replaced by generic CRUD because Drizzle has a different API.
- Redis and Redlock code is not reusable authority merely because its callers
  depend on mutual exclusion. Preserve the required invariant and race tests;
  locate the replacement authority before translating the mechanism.
- Trigger identity and billing fields must be separated into required task
  semantics, control-plane policy, observability metadata, or discarded product
  policy. Do not mechanically rename them.
- Refactoring style, renaming, Effect adoption, storage translation, and
  lifecycle changes must not be combined without a receipt that isolates each
  semantic difference.

### Exit criteria

- Every selected symbol has one primary reuse class.
- Every `D` classification explains why all three reuse forms are unsuitable.
- Observable validation, failure, effect, and event ordering is recorded.
- The retained Trigger behavior and deliberate Flarex divergence are separately
  testable.

## DTE01-C: Decide The Active Package Boundary

### Objective

Choose the exact root-workspace owner for the first transformed source slice
without importing the compatibility island or creating an unbounded common
package.

### Candidate strategies

#### Candidate 1: transformed source in a host-neutral durable-task package

Copy the admitted connected source into a workspace-private Flarex domain
package, replace dependencies with Flarex contracts/ports, and use root catalog
versions. This is the preferred hypothesis because it admits reusable logic
without making Trigger packages runtime dependencies.

The preflight must still decide:

- exact package name and `private` status;
- public versus package-private exports;
- whether the first slice is coherent enough to justify a package;
- allowed dependencies, including whether `effect` and `flarex-protocol` are
  semantically required;
- which service contracts live with the domain and which adapters remain in
  persistence, executor, backend, or host owners; and
- how the package remains Worker-compatible.

#### Candidate 2: root-workspace compatibility package

Create a quarantined package that preserves more Trigger types temporarily.
This is not preferred because temporary Prisma-shaped or Trigger-identity
contracts can become a second permanent architecture. It is acceptable only if
the preflight proves a bounded removal gate, no deployable import path, and a
meaningful reduction in parity risk that Candidate 1 cannot provide.

#### Candidate 3: separately built external artifact

Build selected Trigger packages in the island and consume an artifact through
a process or transport boundary. This may support reference testing but is not
a suitable first production path while the artifact retains Node, Prisma,
Redis, and Trigger identity authority. Any non-test proposal requires explicit
Worker/runtime, lifecycle, and deployment evidence.

#### Candidate 4: combined workspace and lockfile

Merge the Trigger workspace into the Flarex root. This remains rejected by
default. It may be reconsidered only if the preceding candidates are proven
incapable and a complete dependency, generation, patch, bundle, provenance,
and removal analysis demonstrates lower total risk. Convenience or deduplication
alone is insufficient.

### Package-direction constraint

The intended direction is:

```text
host/composition
  -> reused Flarex durable-task domain
       <- Postgres adapter implementation
       <- executor/compute adapter implementation
       <- Cloudflare wake adapter implementation
```

The domain package must not import concrete Postgres, Drizzle, Cloudflare,
Redis, HTTP, Node supervisor, Worker Loader, or Trigger compatibility owners.
Exact direction must be reconciled with
[`../16-package-boundaries.md`](../16-package-boundaries.md) before admission.

### Exit criteria

- One package strategy is accepted with exact owner, dependencies, exports, and
  prohibited imports.
- Every new dependency is justified against the installed root version.
- No cycle or authority inversion is introduced.
- The first package has a bounded removal/splitting policy if it contains any
  temporary compatibility contract.
- Public SDK and public protocol exports remain excluded.

## DTE01-D: Define Provenance And License Handling

### Objective

Make source reuse durable and auditable without obscuring which behavior came
from Trigger.dev and which behavior Flarex changed.

### Required decisions

- per-file or per-module attribution format;
- source-map storage and validation command;
- handling for Apache-licensed repository source and MIT-licensed core source;
- whether copied upstream tests retain their original headers or use a central
  notice plus source map;
- how significant semantic changes are documented without turning source files
  into changelogs;
- how formatting-only drift is separated from semantic patches; and
- how a later upstream refresh would be reviewed without silently overwriting
  Flarex adaptations.

Legal compliance must be reviewed at the appropriate release boundary. DTE01
must preserve the existing notices and provenance; it does not make a final
legal or trademark determination.

### Exit criteria

- Every admitted source/test path has auditable provenance.
- Required notices survive build and distribution decisions.
- Generated or transformed files are distinguishable from Flarex-authored
  adapters.
- A future source refresh cannot silently rewrite adapted behavior.

## DTE01-E: Design The Compatibility Receipt Harness

### Objective

Prove that seam carving and adapter translation preserve intended Trigger
behavior without linking the two workspaces or running two production engines.

### Harness shape

```text
versioned scenario fixture
  -> frozen Trigger workspace runner
       -> normalized Trigger receipt
  -> active Flarex workspace runner
       -> normalized Flarex receipt
  -> structural and semantic comparison
```

The separate runners may be orchestrated by a root test script or CI job, but
each must resolve dependencies from its own lockfile and execute in an isolated
process. The root implementation must never import the Trigger runner.

### Minimum normalized receipt

The first slice should compare all applicable fields:

```ts
type DurableTaskCompatibilityReceipt = {
  readonly scenarioVersion: string;
  readonly initialState: unknown;
  readonly commands: readonly unknown[];
  readonly stateTransitions: readonly unknown[];
  readonly attemptNumbers: readonly number[];
  readonly retryDecisions: readonly unknown[];
  readonly cancellationDecisions: readonly unknown[];
  readonly emittedEvents: readonly unknown[];
  readonly requestedEffects: readonly unknown[];
  readonly terminalOutcome: unknown;
};
```

The accepted receipt must replace `unknown` with versioned, canonical,
redacted fields appropriate to the selected slice. It must exclude unstable
wall-clock values, random IDs, stack paths, raw secrets, user payloads, and
incidental ORM/Redis representations unless the scenario explicitly controls
and normalizes them.

### Required scenarios

At minimum, assess whether the selected closure covers:

- successful first attempt;
- retryable and non-retryable failure;
- configured retry exhaustion and global attempt ceiling;
- cancellation before and during execution;
- duplicate start or completion;
- stale attempt completion;
- heartbeat or completion after lease/fence loss;
- worker loss and recovery;
- completion committed with a lost response;
- OOM/machine escalation when retained; and
- invalid or corrupt stored retry configuration.

Scenarios not represented by Trigger today must be identified as Flarex-added
authority tests rather than presented as upstream parity.

### Exit criteria

- Both runners consume the same versioned semantic scenario.
- Receipts compare intended behavior rather than ORM, Redis, or timestamp noise.
- Deliberate divergences have named expectations and rationale.
- The harness cannot enter a deployable package or production bundle.
- Failure of the Trigger oracle, Flarex implementation, or comparison is
  distinguishable.

## DTE01-F: Define Boundary And Bundle Gates

### Objective

Prevent a successful source transplant from importing Trigger runtime authority
or Node-only dependencies into Flarex production graphs.

### Required static gates

Extend or compose the existing
[`check-trigger-compatibility-boundary.mjs`](../../scripts/check-trigger-compatibility-boundary.mjs)
only after the exact target package exists. The accepted gate must reject:

- `@trigger.dev/*` imports or dependencies;
- Trigger internal package names;
- `third_party/trigger.dev` source or file dependencies;
- generated Prisma clients and Prisma-generated domain types;
- direct Redis, Redlock, Trigger supervisor, Docker/Kubernetes, registry, or
  Trigger product-control dependencies;
- accidental Node built-ins in a package declared Worker-portable; and
- public exports of temporary compatibility shapes.

The gate should also verify the source-map/provenance contract for copied or
adapted files. Do not weaken the existing compatibility boundary globally to
admit one exception unless the exception is explicitly test-only and proven
outside every deployable graph.

### Required runtime/build gates

- package typecheck and focused tests under root catalog versions;
- compatibility receipt comparison for the selected scenarios;
- app/package dependency graph inspection;
- relevant Worker bundle proof with no Prisma, Redis, Node supervisor, Trigger
  source, or local test harness code;
- PGlite and real-Postgres tests only when a later adapter translation actually
  introduces persistence; and
- Cloudflare/workerd tests only when a later host adapter enters the slice.

DTE01 defines these gates; implementation roadmaps run the proportionate subset
when the corresponding owner exists.

### Exit criteria

- Forbidden dependency checks are machine-enforceable.
- The proposed package can be proven absent from unintended deployable graphs.
- Root and island validation remain independently runnable.
- Test-only compatibility tooling cannot be imported by production source.

## DTE01-G: Final Package Admission Decision

### Objective

Consolidate DTE01-A through DTE01-F into one bounded decision before files are
copied into `packages/`.

### Required decision record

The final preflight must state:

1. first product outcome and exact source/test closure;
2. reuse class and semantic-change budget for every selected owner;
3. exact target package, paths, exports, and dependency direction;
4. ports to be introduced and the later adapter owners that will satisfy them;
5. Trigger product/infrastructure behavior explicitly excluded;
6. provenance, notice, and source-map mechanism;
7. compatibility fixtures, receipts, and expected divergences;
8. static, test, and bundle gates;
9. rollback/removal behavior for the uncommitted implementation slice; and
10. the exact next implementation checkpoint and its stop boundary.

### Admission outcomes

The decision must choose one:

- **admit** one bounded transformed source slice;
- **narrow** the closure and repeat the affected DTE01 gates;
- **defer** because a prerequisite identity/lifecycle decision is missing; or
- **reject** the candidate and select a different Trigger capability.

It must not produce a blanket authorization to copy the run engine.

### Complete exit gate

DTE01 is complete only when:

- the capability graph and source map are accepted;
- reuse is maximized and every reimplementation decision is justified;
- one exact package boundary is accepted;
- parity/compatibility evidence is executable by design;
- provenance and license handling are defined;
- forbidden runtime dependencies and bundle gates are machine-enforceable;
- the first implementation slice is small enough to complete and validate as
  one checkpoint; and
- no database schema, host activation, public API, or production route was
  authorized implicitly.

## Sequencing After DTE01

The expected dependency order is:

```text
DTE01 source reuse and package admission
  -> task definition, identity, revision, artifact, and scope authority
  -> reused run/attempt lifecycle and deliberate Flarex divergences
  -> private Task System API atomic operations
  -> Postgres/Drizzle schema and adapter translation
  -> Cloudflare wake and scheduling adapters
  -> compute-provider/runtime integration
  -> observability, live APIs, and UI read models
  -> first production-inert private vertical
  -> public API and activation preflight
```

Database design must consume the accepted lifecycle and atomic-operation
contracts. It must not infer them from Trigger's Prisma schema or begin because
DTE01 identified a package.

## Non-Goals

DTE01 does not:

- create a new Flarex package;
- copy or edit imported upstream source;
- change root or island dependencies or lockfiles;
- generate Prisma or Drizzle clients;
- define task tables, migrations, SQL, or indexes;
- accept final task statuses, lifecycle, error taxonomy, or wire contracts;
- add Trigger compatibility to the public Flarex SDK or management API;
- implement task execution, scheduling, wake delivery, compute, observability,
  or UI behavior;
- authorize Trigger organizations, Redis, Redlock, or supervisor assumptions;
- modify existing Flarex application-data OCC or commit owners; or
- activate a task route, queue consumer, alarm, cron trigger, or deployment.

## Authority And Evidence

Use these sources in order for DTE01 decisions:

1. [`README.md`](./README.md) for the durable-task roadmap-family vision;
2. [`../../design-notes/flarex-durable-task-engine.md`](../../design-notes/flarex-durable-task-engine.md)
   for accepted architecture and the first private vertical;
3. this roadmap for source reuse and package admission gates;
4. [`../../third_party/trigger.dev/SOURCE.json`](../../third_party/trigger.dev/SOURCE.json),
   [`../../third_party/trigger.dev/NOTICE.md`](../../third_party/trigger.dev/NOTICE.md),
   and the frozen imported source/tests for exact provenance and behavior;
5. [`../../third_party/trigger.dev/pnpm-workspace.yaml`](../../third_party/trigger.dev/pnpm-workspace.yaml)
   and lockfile for the compatibility dependency graph;
6. [`../16-package-boundaries.md`](../16-package-boundaries.md) and
   [`../../pnpm-workspace.yaml`](../../pnpm-workspace.yaml) for active Flarex
   ownership and dependency direction;
7. [`../../scripts/check-trigger-compatibility-boundary.mjs`](../../scripts/check-trigger-compatibility-boundary.mjs)
   for the current machine-enforced import boundary; and
8. current package manifests, source, tests, and build outputs as evidence,
   never as automatic approval to preserve an upstream authority.
