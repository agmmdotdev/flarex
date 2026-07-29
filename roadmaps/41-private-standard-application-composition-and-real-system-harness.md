# Private Standard Application Composition And Real-System Harness

## Status And Scope

**Status:** Accepted composition direction recorded for a future docs-first
preflight. The complete replacement analyzer port, private real-system harness,
and their composition are not implemented or green as one system. This record
does not assume that another canonical application or invocation contract is
required.

The immediate product-engineering milestone is a private, test-owned way to
define, compile, upload, analyze, register, and invoke real Flarex queries,
mutations, internal functions, and scheduled functions without first designing
or publishing the developer-facing SDK.

This record owns only the cross-domain composition goal, the internal
direct-fixture producer requirement, the private real-system acceptance ladder,
and checkpoint ordering across existing domain owners. It does not own or
replace:

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

Compose the existing standard contracts into one internal path below future SDK
ergonomics and above host-specific execution:

```text
internal direct fixtures now / developer SDK and codegen later
  -> existing canonical declarative-program contract
  -> canonical module graph and immutable artifact bundle
  -> content-addressed artifact upload
  -> authenticated analyzer and verifier
  -> verified registration and execution projection
  -> standard internal invocation contract
  -> Dynamic Worker, in-process test host, cron host, or another approved host
  -> request-scoped runtime capabilities
  -> real journal, FlarexDB OCC, commit compiler/execution, and PostgreSQL
```

The future developer APIs and the private direct-fixture adapter are separate
producers of the existing canonical declarative-program contract. SDK objects
must not become authority that downstream analysis, execution, or persistence
trusts. Internal tests must be able to produce the same canonical contract
directly through bounded test-owned adapters.

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

## Internal Definition Producer

The default decision is to reuse the canonical contract owned by
[`39-canonical-declarative-program-contract.md`](./39-canonical-declarative-program-contract.md).
The private harness needs a direct-fixture producer that constructs that
contract without depending on a public SDK. The future SDK and codegen become
another producer of the same contract.

The exact fixture API requires a dedicated preflight. It must first prove that
the existing canonical program can express the required application and
function facts. Conceptually, the produced canonical input must describe:

- stable application and function identity;
- function kind: query, mutation, internal function, or scheduled function;
- logical module and exported entry point;
- canonical argument and result contracts;
- visibility and invocation policy;
- declared runtime capability requirements;
- deterministic execution and analysis budgets;
- trigger descriptors such as cron schedules;
- canonical contract and compatibility versions; and
- immutable references to the materialized program and artifact bundle.

The fixture producer and its canonical output must not contain:

- live backend, analyzer, executor, database, transaction, journal, fence, OCC,
  commit, R2, route, or activation capabilities;
- host-local request, cursor, proof, or result handles;
- mutable process-state identities;
- an alternate schema, transaction, or persistence authority;
- a generic metadata bag that bypasses versioned contracts; or
- SDK-specific objects that downstream systems must trust.

Queries, mutations, functions, and cron jobs may share canonical definition and
invocation mechanics, but they do not share all capabilities:

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

## Compilation, Bundling, Analysis, And R2

The private fixture producer and future SDK compiler should produce inert input
for the existing canonical-program materializer. The bundling owner, not the
analyzer, owns canonical module packaging and bundle bytes.

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

Do not make the direct-fixture producer or later SDK depend directly on the
current collection of low-level cursors and codecs. The composition should
depend on one narrow analyzer port whose adapter owns those details.

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

1. use a bounded direct-fixture producer to define a small test application
   containing queries, mutations, internal functions, and scheduled functions
   in the existing canonical declarative-program contract;
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

## Acceptance Ladder

Acceptance is ordered:

1. **One real mutation:** a test-owned mutation definition compiles, uploads,
   analyzes, registers privately, executes, commits, and has its authoritative
   PostgreSQL result verified.
2. **Queries and function composition:** test-owned queries and internal
   functions use the same registered application and scoped runtime
   capabilities without bypassing the executor.
3. **Fault correctness:** conflicts, cold restart, takeover, cancellation,
   confirmed-rollback retry, decision uncertainty, crash, and redelivery cases
   preserve exact ownership and outcome rules.
4. **Real-Postgres concurrency and stress:** sustained concurrent execution,
   contention, resource ceilings, fixed budgets, and leak-free lifecycle
   behavior pass against real PostgreSQL.
5. **Observability and reproducibility:** failures have bounded evidence,
   deterministic reproduction inputs, stable identities, useful metrics, and
   explicit environment receipts.
6. **Developer-facing APIs and activation:** only after the private system is
   usable and stable should SDK ergonomics, generated APIs, public routes,
   readiness, activation, publication, and cutover proceed.

Passing an earlier step does not authorize a later one.

## Current Repository Truth

At the time this direction was recorded:

- the canonical declarative-program and first materialization contracts exist
  under their owning roadmap;
- a host-neutral exact point-mutation runtime vertical exists under its owning
  roadmap;
- local and hosted artifact-runtime/R2 machinery exists, but that does not
  prove the replacement standard application pipeline;
- the public `flarex-test` harness exists, but its current behavior and legacy
  compatibility do not prove this private replacement milestone;
- many private A1b2 request, response, restart, readback, progress, sizing, and
  verifier components are implemented but intentionally inert or unwired;
- the complete replacement analyzer engine, Effect host, and production caller
  are absent;
- link-page and registration-page analyzer planning remain incomplete;
- private executor-host composition remains absent; and
- `C07` remains a separate prerequisite for the real point-mutation proof.

This roadmap does not claim that a direct-fixture producer, complete private
analyzer port, private real-system harness, developer API, or production
activation is implemented or green. It also does not claim that another
canonical application contract is needed.

## Required Preflight Before Implementation

The next session should begin with a read-only, docs-first preflight named:

**`SAC01-P — private standard application composition preflight`**

That preflight must:

1. inventory current definition producers, canonical-program consumers,
   materializers, upload owners, analyzer ports, registries, runtime hosts,
   invocation protocols, test helpers, and function references;
2. distinguish current public SDK/test APIs, private internal contracts,
   legacy/monolithic paths, and replacement production callers;
3. prove whether the existing canonical declarative-program contract is
   sufficient for direct query, mutation, internal-function, and cron fixtures;
   a new representation is rejected by default and requires an exact,
   owner-backed semantic gap;
4. define exact query, mutation, internal-function, and cron semantics,
   including capability profiles and unsupported cases;
5. define the smallest direct-fixture adapter into the existing
   declarative-program materializer without inventing a second program or
   artifact representation;
6. reuse the existing host-neutral function-runtime contract and identify only
   the bounded capability extensions needed for query, mutation,
   internal-function, and cron-trigger execution;
7. define the narrow analyzer adapter and any missing invocation adapter,
   including their identity, authentication, budget, ownership, lifecycle,
   error, and version contracts;
8. trace R2 upload, verified registration, private resolution, runtime loading,
   and authoritative PostgreSQL outcome/readback;
9. prove dependency direction and prevent alternate OCC, commit, journal,
   persistence, route, activation, or application-row authority;
10. propose exact implementation gates, path allowlists, validation lanes, both
   required code reviewers, and stop conditions; and
11. identify which work must wait for A1b2, `C07`, or another current owner
    instead of widening the standard layer.

No implementation should begin from this record alone. The preflight must
verify current code and living roadmap status because the analyzer, upload,
runtime, and foundation streams are active.

## Non-Goals And Governance

This direction does not authorize:

- a public query/mutation/function/cron API or SDK design;
- a second canonical program, application-definition, or invocation
  representation without an accepted owner-backed preflight;
- a new package, public export, route, binding, configuration, or activation;
- schema, DDL, migration, V1 replacement, or production cutover;
- direct database access from canonical definitions or artifact bytes;
- alternate OCC, commit compilation/execution, journals, idempotency outcomes,
  feeds, outbox behavior, or authoritative application-row semantics;
- analyzer-owned bundling, R2 publication, deployment activation, or runtime
  execution;
- test-only successful outcomes, direct row writes, authority reconstruction,
  dual writes, fallback execution, or comparison execution;
- collapsing A1b2 and `C07`; or
- treating an inert contract, codec, upload receipt, or unit test as proof that
  the private real system is assembled.

The enduring rule is: produce the existing inert canonical contracts from
direct fixtures now and SDK ergonomics later, grant authority only at owned host
boundaries, and exercise the real system before designing the developer-facing
surface.
