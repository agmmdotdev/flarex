# Private Application Corpus And Real-System Harness

## Status And Scope

**Status:** `SAC01-P`, `SAC01-A`, and the `SAC01-B1` pure corpus foundation are
complete. A pure test-local definition fixture, deterministic case catalog,
and replay selection are implemented under the backend test owner. The
definition-fixture success lane enters the implemented Standard definition
API. The corpus's valid and materialization-failure lanes use the same
operation, while canonical-failure cases remain isolated with their owning
decoder. A dedicated harness package, complete replacement analyzer port,
private real-system harness, deterministic workload runner, and live
composition are not implemented or green as one system.

The immediate product-engineering milestone is a private, test-owned way to
define, compile, upload, analyze, register, and invoke real Flarex queries,
mutations, actions, public and internal variants, and scheduled invocations,
then replay bounded multi-application workloads without first designing or
publishing the developer-facing SDK.

This record owns only the internal test corpus, workload and real-system
harness requirements, their package-separation rules, the real-system
acceptance ladder, and checkpoint ordering across existing domain owners. It
does not own or replace:

- [`42-standard-application-apis.md`](./42-standard-application-apis.md), which
  owns the shared Standard Application API layer used by developer and test
  producers;

- [`39-canonical-declarative-program-contract.md`](./39-canonical-declarative-program-contract.md),
  which owns the canonical declarative program and materialization contracts;
- [`40-host-neutral-function-runtime.md`](./40-host-neutral-function-runtime.md),
  which owns portable user-function execution semantics and host adapters;
- [`17-deployment-analysis-and-push.md`](./17-deployment-analysis-and-push.md),
  which owns authenticated analysis, artifact upload, registration, and
  activation gates;
- [`06-dynamic-worker-execution.md`](./06-dynamic-worker-execution.md), which
  owns isolated Dynamic Worker materialization and execution;
- [`20-postgres-executor.md`](./20-postgres-executor.md) and the
  [FlarexDB foundation](./flarexdb-foundation/README.md), which own trusted
  execution, journals, OCC, commit compilation/execution, PostgreSQL authority,
  and the private `C07` mutation proof; or
- [`15-test-sdk.md`](./15-test-sdk.md), which owns the public test SDK and must
  remain a convenience layer over real production-domain paths.

## Decision

Compose the existing contracts through separate Standard Application and
private test-owned surfaces below future SDK ergonomics and above
host-specific execution:

```text
developer SDK producer / internal test definition producer
  -> Standard Application APIs
  -> existing canonical declarative-program contract
  -> canonical module graph and immutable artifact bundle
  -> content-addressed artifact upload
  -> authenticated analyzer and verifier
  -> verified registration and execution projection
  -> standard internal invocation contract
  -> private real-system harness composition root
  -> Dynamic Worker, in-process test host, cron host, or another approved host
  -> request-scoped runtime capabilities
  -> real journal, FlarexDB OCC, commit compiler/execution, and PostgreSQL

deterministic private workload scenarios
  -> repeat the same definition and harness APIs
  -> bounded multi-application, revision, concurrency, and fault workloads
  -> reproducible evidence and authoritative readback
```

The future developer APIs and the internal Test APIs are separate producers of
the Standard Application APIs owned by roadmap 42. SDK objects and test
fixtures must not become authority that downstream analysis, execution, or
persistence trusts.

Do not implement this as one universal compiler, one universal object, or a
second representation parallel to the canonical declarative program. Use the
existing contract chain with explicit owners and trust boundaries. A new
representation is permitted only if a later preflight proves an exact semantic
gap that the existing owner cannot legitimately express.

## Why This Comes Before Developer-Facing APIs

The replacement system needs correctness and stress evidence before public API
shape and SDK ergonomics can stabilize. Requiring public `query()`,
`mutation()`, `internalFunction()`, or `cron()` APIs first would couple core
correctness to an unproven frontend and encourage test-only substitutes.

The private milestone must prove that a test-owned definition can travel
through the same artifacts, analyzer, runtime, transaction, OCC, commit, and
authoritative-row paths that production will use. The later SDK should only add
authoring ergonomics, type generation, codegen, routing, and distribution.

## Private Test API Layers

The private milestone requires three deliberately separate test layers over
the shared Standard Application APIs:

1. **Application definition fixtures.** Pure, inert, deterministic test data
   supplies explicit Standard definition inputs, including the canonical
   program input, prebuilt module graph, function-entry bindings, and budgets.
   It owns no production API or live capability.
2. **Real-system harness.** An Effect-owned composition API drives the real
   upload, authenticated analyzer, verifier, private registration, runtime
   host, executor, OCC, commit, and authoritative-readback owners. Its methods
   expose only capabilities that are implemented end to end. Unsupported
   query, mutation, internal-call, action, or scheduling operations are absent
   rather than simulated.
3. **Workload and corpus.** A deterministic test API describes bounded valid
   and invalid application corpora, application revisions, invocation steps,
   concurrency, faults, seeds, and replay receipts. It calls the definition and
   harness APIs; it is not another compiler, runtime, scheduler, or persistence
   owner.

Do not collapse these layers into a generic `Application` object or an
untyped `invoke(anything)` operation. Definition data, live orchestration, and
repeatable workload policy have different authority and lifecycle owners.

## Internal Test Definition Producer

The default decision is to enter the Standard definition API owned by roadmap
42, which in turn reuses the canonical contract owned by
[`39-canonical-declarative-program-contract.md`](./39-canonical-declarative-program-contract.md).
The private harness must not depend on a public SDK. The future SDK/codegen and
the private fixture/corpus become separate producers of the same Standard API.

`SAC01-P` found that the smallest Test API groundwork is fixture data passed
directly to the existing canonical decoder and materializer, not a generic
builder or application representation. Roadmap 42 now owns migration of that
fixture sequence onto the shared Standard definition operation. The current V1
canonical program already owns:

- logical module and exported entry point;
- function kind: query, mutation, workflow mutation, or action;
- function visibility: public or internal;
- canonical argument and result contracts;
- schema table, document-validator, and logical-index declarations;
- deterministic ordering and bounded construction; and
- canonical contract and local version identity.

Do not misclassify an internal function as a function kind. `internal` is
visibility applied to a query, mutation, workflow mutation, or action. A cron
schedule is a separately owned trigger descriptor that points at an admitted
registered function; it is not another function kind or compiler.

Application identity and revision, declared runtime capability grants, trigger
descriptors, immutable artifact references, verified registration, execution
projection, and invocation claims remain separate owned contracts. The
definition API may compose those owners through explicit inputs and outputs,
but must not add them to `CanonicalDeclarativeProgramV1` merely to create one
convenient aggregate.

The definition producer and its canonical output must not contain:

- live backend, analyzer, executor, database, transaction, journal, fence, OCC,
  commit, R2, route, or activation capabilities;
- host-local request, cursor, proof, or result handles;
- mutable process-state identities;
- an alternate schema, transaction, or persistence authority;
- a generic metadata bag that bypasses versioned contracts; or
- SDK-specific objects that downstream systems must trust.

Queries, mutations, actions, internal variants, and scheduled invocations may
share canonical definition and invocation mechanics, but they do not share all
capabilities:

- a query receives an approved read capability and cannot publish writes;
- a mutation produces logical journal operations and commits only through the
  existing OCC and commit system;
- an internal or externally capable function receives only its declared,
  host-granted capabilities;
- a cron definition is a trigger descriptor pointing at a registered function,
  not a separate function compiler or execution model; each firing still
  requires a fresh authenticated invocation claim; and
- nested function calls must use an owned invocation boundary rather than
  passing ambient database or host authority.

## Schema Lifecycle Composition

Bulk testing across different applications is not real if every fixture reuses
one preinstalled schema or writes rows around the schema owner. The private
harness must compose, without replacing, the existing schema lifecycle:

```text
canonical schema declarations
  -> existing schema-manifest and catalog materialization
  -> stable table and index bindings
  -> required index readiness
  -> registered application revision and verified execution projection
  -> request-scoped logical database capability
```

This roadmap does not authorize new DDL, catalog, placement, partition,
migration, or index-readiness semantics. It requires the harness to invoke the
existing owners and to stop when a requested application shape is unsupported.
The first slice remains limited to the currently accepted global-table and
unpartitioned-function contract. Broader placement and partition behavior need
their owning preflights.

## Compilation, Bundling, Analysis, And R2

The Standard definition API accepts inert inputs from internal tests and the
future SDK/compiler producer, then composes the existing canonical-program and
materializer owners. The bundling owner, not the Standard API or analyzer,
owns canonical module packaging and bundle bytes.

The artifact upload owner stores the immutable, content-addressed bundle in R2
and returns bounded storage evidence. R2 is artifact storage, not application
row authority, a deployment registry, or a source of runtime capability.

The analyzer consumes a freshly authenticated immutable artifact and produces
bounded semantic, verifier, progress, evidence, and registration outputs. It
must not gain R2 publication, deployment activation, transaction, OCC, commit,
or application-row authority merely because it verifies the artifact.

The deployment or function registry records which verified artifact and
execution projection belong to an application revision. Activation and public
routing remain later explicit gates.

## Standard Analyzer Boundary

The current repository contains important private analyzer components, but not
one complete replacement analyzer operation suitable for this standard layer.
The existing monolithic analyzer path remains a compatibility path and must not
silently become the new standard contract.

The target boundary is:

1. a pure analyzer engine consumes an already admitted, same-factory,
   result-bound command view, an authenticated command plan, and an optional
   claimed restart source;
2. the engine returns only a bounded inert result cursor using the accepted
   analyzer-to-executor response contract;
3. an Effect-owned analyzer host supplies the fresh release handshake,
   request `Scope`, cancellation/interruption, full foreign `Cause`, resources,
   uncertainty handling, release, and finalization; and
4. a narrow adapter exposes that host as the analyzer port used by this
   composition pipeline.

The current private request, response, restart-input, claimed-source,
settled-page-readback, progress, parse-sizing, source-page, and resumable-frame
owners are prerequisites. Link-page authority, registration-page authority,
the complete command plan and companion, the pure command engine, the Effect
host, and executor composition remain incomplete until their owning roadmaps
say otherwise.

Do not make the private application-definition API or later SDK depend directly
on the current collection of low-level cursors and codecs. The composition
should depend on one narrow analyzer port whose adapter owns those details.

The analyzer port and real-system harness orchestration are reusable,
observable Effect operations with typed failures, requirements, interruption,
and resource ownership. The analyzer host owns the fresh request `Scope` and
full foreign `Cause`; the application-definition and artifact-materialization
operations remain pure `Result` transformations. Long-lived host Layers may
own stable configuration and clients, but must never capture request,
transaction, Durable Object, or invocation capabilities.

## Invocation And Existing Runtime Boundary

After verified registration, an internal invocation identifies:

- the exact application revision and function definition;
- canonical argument bytes;
- function kind and trigger kind;
- a fresh authenticated execution claim;
- request, attempt, and deterministic-host identities;
- declared capability and resource budgets; and
- the exact verified execution projection.

Serialized invocation data remains inert. The default runtime owner is the
existing host-neutral contract in
[`40-host-neutral-function-runtime.md`](./40-host-neutral-function-runtime.md).
A selected host authenticates the invocation and grants fresh request-scoped
capabilities. A Dynamic Worker, in-process test host, cron host, or other
approved host may implement the host adapter, but all hosts must invoke those
same owned function-runtime semantics. New query, mutation, internal-function,
or scheduler capabilities require bounded extensions in that owner rather than
a competing invocation engine.

The artifact bundle does not receive a transferable database connection.
Instead, the trusted host grants a narrow logical database or journal
capability for that invocation:

```text
verified function invocation
  -> host-neutral function runtime
  -> request-scoped logical database/journal port
  -> existing executor transaction capability
  -> existing FlarexDB OCC
  -> existing commit compiler and commit execution
  -> authoritative PostgreSQL rows and outcome readback
```

Tests may observe bounded receipts and authoritative readback. They must not
write application rows directly or synthesize successful commit outcomes.

## Relationship Between A1b2 And C07

`A1b2` and `C07` are separate prerequisites that converge in the private
real-system proof:

- `A1b2` supplies authenticated Declarative V2 artifact analysis, durable
  verifier progress, restart, response, and executor-host composition.
- `C07` supplies the private real point-mutation journal, OCC, commit
  compilation/execution, and authoritative PostgreSQL result proof.

Neither proves the other. Do not move analyzer authority into the commit
system, and do not create a second transaction or commit path inside the
analyzer, function runtime, test harness, or artifact pipeline.

The composition connects these owners through their existing narrow contracts
and capabilities; it does not merge their authority or assume another universal
contract.

## Private Real-System Harness

The first consumer is an internal correctness and stress harness, not the
public test SDK. It must be able to:

1. use test-owned fixtures and workload policy to enter the Standard
   Application APIs for a small application containing schema declarations,
   queries, mutations, internal variants, actions, and separately owned
   scheduled trigger descriptors;
2. compile and materialize the canonical program and bundle;
3. upload the immutable bundle through the real artifact-storage owner;
4. authenticate and analyze it through the replacement analyzer;
5. register the verified execution projection without activating public
   routing;
6. invoke functions through an approved host adapter;
7. exercise real runtime database calls, journals, OCC, commit
   compilation/execution, and PostgreSQL rows; and
8. observe bounded evidence, committed outcomes, and authoritative readback.

Test-only helpers may improve fixture construction and fault injection, but
they must remain thin capability-scoped adapters over existing owners. They may
not create alternate analysis, artifact, database, OCC, commit, storage,
authority, dual-write, fallback, or production-route behavior.

The same definition must support complementary evidence lanes:

| Lane | Purpose |
| --- | --- |
| Pure contract and analyzer corpus | High-volume deterministic valid and invalid definitions, artifacts, analyzer inputs, evidence, and diagnostics |
| In-process runtime semantics | Fast capability-specific function lookup, validation, context, nested-call, result, and logical-journal behavior |
| Adapter parity | Equivalent supported fixtures through the in-process and workerd/Dynamic Worker hosts |
| Real system | R2/artifact storage, authenticated analysis, private registration, runtime loading, executor, OCC, commit, and PostgreSQL authority |

The fast lanes do not prove platform or persistence behavior. The real-system
lane does not need to run every generated corpus member at maximum scale; use a
bounded representative selection with explicit coverage and environment
receipts.

## Acceptance Ladder

Acceptance is ordered:

1. **One real mutation:** a test-owned mutation definition compiles, uploads,
   analyzes, registers privately, executes, commits, and has its authoritative
   PostgreSQL result verified.
2. **Representative application shape:** one registered revision contains
   multiple modules, functions, global tables, and indexes within current
   limits, and its schema/catalog bindings are established only by the existing
   owners.
3. **Queries and internal composition:** test-owned queries and internal
   variants use the same registered application and scoped runtime
   capabilities without bypassing the executor or passing ambient authority.
4. **Scheduled invocation:** a trigger descriptor targets an already registered
   function and each firing obtains a fresh authenticated invocation claim.
5. **Deterministic multi-application corpus:** bounded valid and invalid
   applications, revisions, analyzers, and invocation scenarios reproduce from
   stable seeds and replay receipts.
6. **Fault correctness:** conflicts, cold restart, takeover, cancellation,
   confirmed-rollback retry, decision uncertainty, crash, and redelivery cases
   preserve exact ownership and outcome rules.
7. **Real-Postgres concurrency and stress:** sustained concurrent execution,
   contention, resource ceilings, fixed budgets, and leak-free lifecycle
   behavior pass against real PostgreSQL.
8. **Observability and reproducibility:** failures have bounded evidence,
   deterministic reproduction inputs, stable identities, useful metrics, and
   explicit environment receipts.
9. **Developer-facing APIs and activation:** only after the private system is
   usable and stable should SDK ergonomics, generated APIs, public routes,
   readiness, activation, publication, and cutover proceed.

Passing an earlier step does not authorize a later one.

## Current Repository Truth

At the time this direction was recorded:

- the canonical declarative-program and first materialization contracts exist
  under their owning roadmap;
- the canonical program can represent schema tables, indexes, query, mutation,
  workflow-mutation, and action metadata with public or internal visibility,
  but the accepted first fixture and parity proof cover only one global table,
  one ordered index, and one public unpartitioned mutation;
- the current direct fixture entrypoint is a bounded canonical decoder, not a
  complete standard application authoring, revision, workload, or lifecycle
  API;
- the materializer admits function and execution module roles while schema and
  auth source-module roles remain separately deferred;
- a host-neutral exact point-mutation runtime vertical exists under its owning
  roadmap, but query builders, nested calls, general mutations, actions, and
  scheduling are not implemented by that kernel;
- local and hosted artifact-runtime/R2 machinery exists, but that does not
  prove the replacement standard application pipeline;
- the public `flarex-test` harness exists, but its current behavior and legacy
  compatibility do not prove this private replacement milestone;
- many private A1b2 request, response, restart, readback, progress, sizing, and
  verifier components are implemented but intentionally inert or unwired;
- the complete replacement analyzer engine, Effect host, and production caller
  are absent;
- link-page and registration-page analyzer planning remain incomplete;
- schema/catalog lifecycle composition for arbitrary private application
  revisions and a scheduled-trigger contract remain absent;
- private executor-host composition remains absent; and
- `C07` remains a separate prerequisite for the real point-mutation proof.

This roadmap does not claim that the Standard Application API family, complete
private analyzer port, private real-system harness, deterministic workload
runner, Developer API migration, or production activation is implemented or
green. It also does not claim that another canonical application contract is
needed.

## Package Separation Direction

Package boundaries follow authority and dependency direction. Standard APIs
must not accumulate in one catch-all package:

| Concern | Default owner |
| --- | --- |
| Pure shared definition preparation across the next two owners | future `@flarex/standard-application-definition/v1`, owned by roadmap 42 |
| Pure canonical application intent and bounded fixture normalization | existing `@flarex/declarative-program/v1` |
| Pure source/semantic artifact materialization | existing `@flarex/declarative-materializer/v1` |
| Exact portable wire contracts | intentional `flarex-protocol` subpaths |
| Capability-specific user-function semantics | existing `@flarex/function-runtime` subpaths |
| Upload, analyzer host, verification, registration, and runtime selection | their existing backend domains |
| Schema catalog, bindings, readiness, OCC, commit, and rows | their existing FlarexDB, executor, and persistence domains |
| Cross-domain real-system orchestration and deterministic workloads | initially one private test-owned composition root; extract only under the gate below |
| Public ergonomics and generated references | later `flarex`, `flarex-dev`, and `flarex-test` adapters |

Do not create `@flarex/core`, `@flarex/standard`, a generic application service,
or a package that owns copied schema, analyzer, runtime, and executor
lookalikes. The first composition vertical should remain test-local to the
selected host owner when it has one concrete consumer. A dedicated internal
system-harness package becomes justified only when the preflight identifies at
least two concrete consumers, an acyclic dependency graph, an explicit
lifecycle owner, a private export policy, and deletion of the corresponding
test-local duplication in the same extraction slice.

If extraction is justified, the system-harness package is a top-level
development/test dependency leaf: it may depend on the private domain APIs it
composes, but no production domain package may depend on it. Pure corpus
generation may later become a separate dependency-light subpath only after a
second consumer needs it without the live harness dependencies.

### Accepted Starting Separation

The accepted starting separation, updated by roadmap 42, is:

1. place only pure cross-owner definition preparation in
   `@flarex/standard-application-definition/v1`;
2. keep canonical normalization and any exact pure fixture mechanics in
   `@flarex/declarative-program/v1`;
3. keep module-graph admission and artifact construction in
   `@flarex/declarative-materializer/v1`;
4. keep every new runtime semantic in a capability-specific
   `@flarex/function-runtime` subpath only after its owning preflight;
5. keep definition fixtures, corpus membership, replay, expectations, and
   faults test-locally under
   `flarex-backend/test/privateStandardApplication/`;
6. migrate those tests onto the Standard definition operation without moving
   test policy into its package;
7. leave the future live cross-domain harness owner undecided until the
   replacement analyzer and `C07` expose the exact adapters it must compose;
   do not force it into `flarex-backend` if that requires backend-to-persistence
   or backend-to-executor-worker ownership reversal; and
8. extract a dedicated private system-harness package only when the
   package-separation gate above is satisfied.

`flarex-backend` already has development-only dependencies on the canonical
program and materializer, so it can own a pure application seed and its
upload-lane use without a manifest change. The executor application is the
accepted production composition owner for A1b2 and already owns executor and
persistence dependencies. Neither fact alone proves the correct home for the
eventual end-to-end test root.

## SAC01-P Preflight Checklist

The read-only, docs-first preflight was:

**`SAC01-P — private application corpus and harness preflight`**

That preflight must:

1. inventory current definition producers, canonical-program consumers,
   materializers, upload owners, analyzer ports, registries, runtime hosts,
   invocation protocols, test helpers, and function references;
2. distinguish current public SDK/test APIs, private internal contracts,
   legacy/monolithic paths, and replacement production callers;
3. prove whether the existing canonical declarative-program contract is
   sufficient for query, mutation, workflow-mutation, and action metadata with
   public or internal visibility, and identify the separate owner for scheduled
   trigger fixtures; a new representation is rejected by default and requires
   an exact, owner-backed semantic gap;
4. correct the taxonomy to function kind plus visibility and a separate trigger
   descriptor, then define exact query, mutation, workflow-mutation, action,
   internal-visibility, nested-call, and scheduled-invocation semantics,
   including capability profiles and unsupported cases;
5. define the smallest test-owned definition input sequence into the existing
   declarative-program materializer without inventing a second program or
   artifact representation;
6. reuse the existing host-neutral function-runtime contract and identify only
   the bounded capability extensions needed for query, mutation,
   internal-function, and cron-trigger execution;
7. define the narrow analyzer adapter and any missing invocation adapter,
   including their identity, authentication, budget, ownership, lifecycle,
   error, and version contracts;
8. trace R2 upload, verified registration, private resolution, runtime loading,
   schema/catalog binding and readiness, and authoritative PostgreSQL
   outcome/readback;
9. prove dependency direction and prevent alternate OCC, commit, journal,
   persistence, route, activation, or application-row authority;
10. define deterministic corpus, workload, seed, replay, fault, evidence, and
    real-system sampling contracts without creating a second runtime;
11. decide whether the first composition remains test-local or satisfies the
    dedicated internal system-harness package extraction gate, and record exact
    package dependencies and forbidden reverse dependencies;
12. propose exact implementation gates, path allowlists, validation lanes, both
    required code reviewers, and stop conditions; and
13. identify which work must wait for A1b2, `C07`, schema lifecycle, a query
    runtime, scheduling, or another current owner
    instead of widening the standard layer.

`SAC01-P` completed this checklist against current code and living roadmap
status on 2026-07-29. Its accepted implementation scope, gates, and stop
conditions follow.

### Owner And Capability Inventory

| Concern | Current usable owner | Preflight result |
| --- | --- | --- |
| Canonical application intent | `@flarex/declarative-program/v1` | Reuse directly. Its fixture entry point is the canonical decoder, not a separate authoring system. |
| Module graph and artifact plan | `@flarex/declarative-materializer/v1` | Reuse directly for function and execution modules. Schema and auth source-module roles remain unsupported. |
| Deterministic semantic records | materializer output plus analysis semantic decoder | Usable for pure corpus and compatibility-consumption tests; not proof of the replacement analyzer. |
| Content-addressed source and semantic upload | backend Declarative V2 artifact-upload host and cores | Implemented for private tests and real R2 adapters, but upload receipts alone are not verified registration. |
| Authenticated verifier reads | backend request-bound verifier read-session owner | Implemented as a prerequisite. It does not supply the missing command engine or host. |
| Replacement analyzer | A1b2 command producer, command plan, executor-HTTP transports, persistence readback, and future Effect host | Incomplete. Link and registration planning, the complete engine, host composition, and production caller remain active or absent. |
| Verified application/function registration | no completed replacement composition owner | Blocked. The current backend registry creates and lists deployments; the V1 deployment service and monolithic analyzer path are not substitutes. |
| Schema/catalog lifecycle | persistence schema publication, manifest, binding, and index owners | Domain capabilities exist, but no accepted replacement application-revision composition adapter currently connects them to this harness. |
| Portable function execution | `@flarex/function-runtime/point-mutation` | Exact public point mutation only. Query builders, nested calls, general mutation capabilities, actions, and scheduling are not present. |
| Trusted mutation/OCC/commit path | executor and FlarexDB foundation owners | The pieces remain owned there; `C07` is still the required assembled PGlite and real-Postgres point-mutation proof. |
| Current public test API | `flarex-test` over `flarex-dev` | Compatibility and developer convenience only; it cannot prove this replacement pipeline. |

The existing `orders:place` fixtures in the declarative-program,
materializer, analysis, backend, and function-runtime tests resemble each other
but do not have one interchangeable authority. The program fixture owns
canonical normalization, the materializer fixture owns graph admission, the
analysis fixture owns semantic-stream consumption, the backend fixture owns
upload correlation, and the runtime fixture owns verified invocation
projection. The first slice may centralize only the exact program/graph test
data consumed by the backend upload lane. It must not move runtime projections
or analysis-owned expectations into a generic fixture.

### Contract Sufficiency And Unsupported Semantics

No new application representation is justified. The canonical program already
represents schema tables and indexes plus these function facts:

| Fact | Canonical definition | Executable replacement path today |
| --- | --- | --- |
| Public or internal query | Yes | No query runtime/database capability |
| Public or internal mutation | Yes | Public exact point-mutation kernel only; real assembled proof waits for `C07` |
| Public or internal workflow mutation | Yes | No assembled workflow-mutation runtime |
| Public or internal action | Yes | No assembled action host/capability profile |
| Nested function call | Function targets can be described separately | No owned nested-invocation capability |
| Scheduled invocation | No; schedule is not a function kind | No accepted trigger descriptor and scheduler-to-invocation claim composition |

Therefore the pure corpus may exercise all canonical kinds and visibility
values as metadata, but every scenario must declare its evidence lane. It must
not label metadata acceptance as executable query, action, internal-call,
workflow, or schedule support.

The smallest definition adapter is no adapter: test fixtures provide owned
inputs for the existing canonical decoder and materializer. A test-owned
fixture descriptor may group the exact canonical-program input, program budget,
module-graph input, materialization budget, and expected facts for corpus
selection. It is not accepted by analyzer, registry, runtime, or persistence
code and must never become an authoritative application representation.

### Dependency And Lifecycle Decision

The first slice needs only dependencies already present in
`flarex-backend`'s development graph:

```text
flarex-backend test fixture
  -> @flarex/declarative-program/v1
  -> @flarex/declarative-materializer/v1
  -> existing backend upload-correlation test
```

There is no permitted reverse dependency from a production package to this
test fixture. The first slice must not import `apps/executor`, persistence
package internals, analyzer package internals, the legacy deployment service,
the monolithic verifier dispatch, `flarex-dev`, or `flarex-test`.

The eventual live harness operation is an Effect-owned, scoped composition
operation with typed failures. Stable host configuration and clients may later
be Layer-owned. Request, verifier session, Durable Object, transaction,
journal, and invocation capabilities remain operation-scoped and must never be
captured in a singleton Layer. The test boundary performs the one runtime
bridge. Pure definition, canonical decoding, graph construction, corpus
selection, and materialization remain plain data or `Result` operations.

One test-local consumer does not justify a new Context service or package.
Promote the harness to named services and Layers only when the accepted live
composition exposes reusable capabilities and at least two concrete consumers
need the same lifecycle owner.

### Implemented Test-Fixture Slice: `SAC01-A`

`SAC01-A` establishes one private test-fixture contract, and the backend
upload-correlation fixture consumes it. It does not create a Standard API or
the live harness.

Exact path allowlist:

- `packages/flarex-backend/test/privateStandardApplication/definitionFixtureV1.ts`
  (new);
- `packages/flarex-backend/test/privateStandardApplication/definitionFixtureV1.test.ts`
  (new);
- `packages/flarex-backend/test/declarativeV2UploadCorrelationFixture.ts`;
- `packages/flarex-backend/test/declarativeV2UploadCorrelation.test.ts` only
  when an assertion must follow the moved fixture data; and
- this roadmap for receipts or corrections.

`SAC01-A` must:

1. retain the existing global `orders` table, `by_status` index, public
   unpartitioned `orders:place` mutation, function module, execution module,
   source map, and explicit budgets as its first seed;
2. group only exact test input contracts and expected inert facts;
3. call the canonical decoder and materializer rather than reimplementing
   validation, normalization, ordering, hashing, or semantic emission;
4. preserve the current upload-correlation assertions and root/digest behavior;
5. return owned/frozen fixture data or freshly allocate mutable raw inputs as
   required by the owning decoder contract; and
6. make no manifest, export-map, production-source, analyzer-source, executor,
   persistence, runtime, route, binding, or configuration change.

The initial API should favor explicit fixture data and owner calls over a
generic builder. A fluent schema/query/mutation API, arbitrary metadata bag,
untyped function registry, generic `invoke`, or wrapper that erases the
canonical/materializer error unions is outside this slice.

Validation for `SAC01-A`:

- focused new fixture tests;
- the existing backend upload-correlation test;
- `flarex-backend` typecheck;
- focused declarative-program and materializer tests when their public inputs
  or assumptions are exercised by the new fixture; and
- both standing custom reviewers before commit because this slice moves and
  materially centralizes test coverage.

### Implemented Pure Corpus Slice: `SAC01-B1`

`SAC01-B1` provides the first deterministic canonical-program and
materialization corpus without advancing the analyzer or live harness. It
remains test-local under
`flarex-backend/test/privateStandardApplication/`.

The corpus is a discriminated test-case catalog, not another application,
artifact, error, or execution representation:

- a `valid` case produces a fresh
  `PrivateStandardApplicationDefinitionFixtureV1` and declares inert facts to
  verify after the existing canonical decoder and materializer succeed;
- a `canonicalFailure` case produces fresh existing program and budget inputs
  and declares the complete stable existing canonical error-data projection
  expected from that owner; and
- a `materializationFailure` case produces a fresh existing definition fixture
  plus a deliberately invalid existing graph or budget input and declares the
  complete stable existing materialization error-data projection.

Case IDs are stable literal test identities. Selection accepts a non-negative
safe-integer seed and bounded case count, rotates over one fixed case-ID order,
and returns a fresh replay value containing corpus version, seed, and explicit
case IDs. The explicit IDs, not recomputation from a seed after a later corpus
version changes, are the replay authority. Each case factory allocates fresh
mutable raw inputs and bytes.

Exact path allowlist:

- `packages/flarex-backend/test/privateStandardApplication/corpusV1.ts`
  (new);
- `packages/flarex-backend/test/privateStandardApplication/corpusV1.test.ts`
  (new);
- `packages/flarex-backend/test/privateStandardApplication/definitionFixtureV1.ts`
  only when a representative valid definition belongs with the existing
  definition seed; and
- this roadmap for durable boundary or status corrections.

The first corpus must include the existing point-mutation seed, one valid
multi-module/multi-function metadata shape, canonical identity/schema/
validator/budget failures, and materialization binding/role/budget failures.
Success cases may exercise query, mutation, workflow-mutation, action, public,
and internal metadata, but they must not claim executable support for those
capabilities. Corpus evaluation calls the existing owners directly and retains
their exact `Result` failures; it must not create a common corpus error or
success type.

This slice makes no upload-correlation, analyzer, executor, persistence,
runtime, manifest, export-map, route, binding, configuration, or activation
change. `SAC01-C` remains the first gate allowed to adapt the corpus to the
replacement analyzer.

### Later Gates

| Gate | Scope | Entry condition |
| --- | --- | --- |
| `SAC01-B2` | Expand corpus membership or workload parameters without adding new domain semantics | Standard API `SAP01-B` is complete and a concrete coverage gap is identified; remains pure and test-local unless a second real consumer proves extraction |
| `SAC01-C` | Move the owned analyzer corpus lane through the implemented Standard analysis operation | `SAP02` and the A1b2 command plan, link and registration ownership, pure engine, Effect host, and private adapter are implemented; the slice must retain corpus ownership and must not invent registration or runtime authority |
| `SAC01-D` | Compose verified registration and schema/catalog publication/readiness for one private application revision | Replacement registration owner and an approved schema-lifecycle adapter exist without direct database access |
| `SAC01-E` | Execute and authoritatively read back one real point mutation | `SAC01-C`, `SAC01-D`, and foundation `C07` are complete with real PGlite/Postgres evidence |
| `SAC01-F` | Add queries, internal calls, workflow mutations, actions, and scheduled invocations one capability at a time | Each capability has its own runtime/host/claim contract and focused preflight |
| `SAC01-G` | Extract a dedicated private corpus or system-harness package | At least two concrete consumers, an acyclic graph, explicit lifecycle owner, private exports, and same-slice deletion of test-local duplication |

### Parallel-Work Safety And Stop Conditions

Future `SAC01-B2` expansions that remain within the pure B1 corpus boundary are
safe to run in parallel with analyzer work because the corpus allowlist excludes
`packages/analysis/**`, `apps/analyzer/**`, analyzer transports, analyzer
roadmaps, and production composition. Before implementation and before commit,
recheck the working tree for overlap.

Stop and run a new preflight if the work would:

- edit or depend on the active analyzer implementation or its provisional
  command-plan shape;
- use the monolithic verifier dispatch or V1 deployment service as the
  replacement analyzer or registration port;
- add a production dependency, package, export, route, binding, or activation;
- require backend production code to import executor-worker or persistence
  internals;
- introduce a second canonical application, artifact, schema, invocation,
  journal, OCC, commit, or successful-outcome representation;
- directly write application rows, synthesize verified registration, or fake a
  successful runtime/commit result;
- require new schema/DDL/index-readiness, query, nested-call, action, workflow,
  trigger, or scheduling semantics;
- change bytes, ordering, budgets, diagnostics, roots, digests, ownership, or
  first-failure behavior rather than merely centralizing the exact fixture;
- encounter concurrent edits inside
  `packages/flarex-backend/test/privateStandardApplication/**` or another
  active slice allowlist; or
- need a live integration before A1b2, the registration/schema adapter, or
  `C07` satisfies its stated entry gate.

## Non-Goals And Governance

This direction does not authorize:

- a public query/mutation/function/cron API or SDK design;
- a second canonical program, application-definition, or invocation
  representation without an accepted owner-backed preflight;
- a new production package, public export, route, binding, configuration, or
  activation; one private test-only composition package remains gated by the
  package-separation proof above;
- new schema, DDL, catalog, placement, partition, migration, or index-readiness
  semantics, V1 replacement, or production cutover; the harness must call the
  existing owners for supported schema lifecycle behavior;
- direct database access from canonical definitions or artifact bytes;
- alternate OCC, commit compilation/execution, journals, idempotency outcomes,
  feeds, outbox behavior, or authoritative application-row semantics;
- analyzer-owned bundling, R2 publication, deployment activation, or runtime
  execution;
- test-only successful outcomes, direct row writes, authority reconstruction,
  dual writes, fallback execution, or comparison execution;
- collapsing A1b2 and `C07`; or
- treating a fast pure or in-process lane as proof of R2, workerd, executor,
  OCC, commit, or PostgreSQL behavior; or
- treating an inert contract, codec, upload receipt, or unit test as proof that
  the private real system is assembled.

The enduring rule is: let explicit Test APIs and later ergonomic Developer APIs
enter the same Standard Application APIs, keep the corpus and workload policy
test-owned, compose schema and runtime authority only through their existing
owners, grant authority only at owned host boundaries, and exercise both
high-volume deterministic corpora and the representative real system before
stabilizing the developer-facing surface.
