# Canonical Declarative Program Contract

## Status And Scope

**Status:** The canonical-program preflight and first internal opt-in
implementation slice are complete. The follow-on materialization preflight is
also complete and accepted for the narrow inert slice defined below.
M8 is complete: the protocol contracts, host-neutral materializer core, direct
`orders:place` fixture, analyzer-consumption proof, and private `flarex-dev`
prebuild adapter are implemented and validated below. No production producer,
consumer, upload route, stored artifact, or activation path has been migrated.

This record owns the proposed standard contract boundary between:

- ergonomic developer APIs in `flarex`;
- direct, minimal program fixtures used to develop and test downstream domains
  before the developer APIs are mature;
- developer-machine or CI compilation and artifact generation;
- Declarative V2 source and semantic artifact production;
- analyzer and verifier inputs; and
- the later verified runtime projection consumed by a function runtime host.

The decision is to create stable inter-domain contracts rather than let one
domain consume another domain's classes, builders, incidental object layout, or
private implementation details.

This record does not grant general migration or runtime authority. The
accepted preflights below approve only their named private packages and bounded
implementation slices. Public exports, production routes, artifact version
changes, readiness transitions, activation, and removal of existing paths
remain separately gated.

## Why This Boundary Is Needed

The public developer API is intentionally ergonomic and is still evolving.
Schema builders, validators, function registration helpers, generated
references, and future higher-level APIs should be free to improve without
forcing the analyzer, verifier, executor, or runtime to understand every SDK
implementation generation.

The inverse is also important. Work on the analyzer, runtime, and FlarexDB must
not be blocked until the final developer experience exists. Tests and internal
tools need a supported way to describe a minimal valid application without
constructing private SDK objects or copying analyzer-specific payloads.

The accepted direction is:

```text
ergonomic developer API                 direct test/tool fixture
          |                                      |
          +---------- normalize and validate ----+
                                 |
                                 v
                 canonical declarative program input
                                 |
                   compile / bundle / materialize
                                 |
              +------------------+------------------+
              |                                     |
              v                                     v
      immutable Source Artifact V2       Semantic Artifact V1
              |                                     |
              +-------------- verify ---------------+
                                 |
                                 v
                    verified runtime projection
                                 |
                                 v
                       function runtime host
```

The canonical program input is not deployment authority. Source artifacts,
semantic artifacts, analyzer evidence, verified projections, activation
records, and execution requests retain their own contracts and authority
owners.

## Current Sources Of Truth

Current behavior must be verified against:

- [`packages/flarex/src/schema.ts`](../packages/flarex/src/schema.ts) and
  [`packages/flarex/src/server.ts`](../packages/flarex/src/server.ts) for the
  current developer schema and function-registration objects;
- [`packages/analysis/src/index.ts`](../packages/analysis/src/index.ts) for the
  current loaded-module and schema-object analyzer input;
- [`packages/flarex-protocol/src/declarative-v2-semantic-artifact-v1.ts`](../packages/flarex-protocol/src/declarative-v2-semantic-artifact-v1.ts)
  for the current canonical Semantic Artifact V1 wire contract;
- [`packages/flarex-backend/src/declarativeV2`](../packages/flarex-backend/src/declarativeV2)
  for current private authenticated read, command, verification, and progress
  boundaries;
- [`17-deployment-analysis-and-push.md`](./17-deployment-analysis-and-push.md)
  for deployment analysis, artifact, readiness, and activation sequencing;
- [`38-declarative-v2-external-analyzer-compute.md`](./38-declarative-v2-external-analyzer-compute.md)
  for the portable ESM, analyzer-compute, and trust boundary; and
- [`16-package-boundaries.md`](./16-package-boundaries.md) for dependency
  direction and public-versus-internal ownership.

Current naming remains **Declarative V2 + Source Artifact V2 + Semantic Artifact
V1**. A future in-memory program contract must not be called Semantic Artifact
V2 or imply a new artifact generation without a separate versioning decision.

## Current Architecture

The current developer SDK registers functions as runtime objects carrying
markers, validators, partition policy, and handlers. The current analysis
package can inspect loaded execution-module exports and a live schema
definition. It lowers those values into deployment analysis and codegen shapes.

Declarative V2 is a separate private path. Its finalized source and Semantic
Artifact V1 bytes are immutable evidence. Authenticated backend capabilities
produce bounded inert analyzer commands; the analyzer/verifier cannot acquire
backend, persistence, readiness, activation, or application transaction
authority from those values.

No single canonical in-memory program model currently allows both:

1. the developer SDK to lower its definitions into a stable downstream input;
   and
2. focused tests to construct the same downstream input without using the
   developer SDK.

Consequently, current tests often begin from a live SDK object, analyzer-owned
shape, protocol artifact, or source module map depending on the domain under
test. Those are useful current interfaces, but they do not yet form the
accepted standard boundary described here.

## Decisions And Rationale

### Use A Contract Chain, Not One Universal Object

Each transition owns a value with claims appropriate to that transition:

```text
DeveloperDefinition
  -> CanonicalProgramInput
  -> BuildInputs
  -> SourceArtifactV2 + SemanticArtifactV1
  -> AnalyzerEvidence
  -> VerifiedRuntimeProjection
  -> FunctionExecutionRequest
```

These values may reuse exact lower-level types, but they are not aliases for
one another. In particular:

- an SDK object may contain methods, symbols, closures, and type-only
  ergonomics;
- a canonical program input is normalized application intent;
- an artifact is immutable encoded provenance;
- analyzer output is inert evidence;
- a verified projection records trusted verification and publication claims;
  and
- an execution request carries only the bounded data needed for one attempt.

Collapsing these claims would either make the developer API storage-shaped or
let untrusted serialized input masquerade as verified authority.

### Allow Two Legitimate Producers

The canonical program input has exactly two intended producer categories:

1. the developer SDK/compiler adapter; and
2. an explicit fixture/tool builder for downstream development and tests.

The fixture builder is not a second language or analyzer. It must use the same
decoder, normalization, canonical ordering, version rules, and artifact
materializer as the SDK adapter.

### Keep Compilation On The Developer Or CI Side

Developer tooling or CI owns TypeScript, dependency resolution, bundling,
minification, source maps, and generation of portable ESM and semantic
declarations. The trusted verifier hashes, frames, correlates, parses, and
verifies bounded portable inputs. It does not install packages or run arbitrary
build plugins.

### Keep Authority Out Of The Standard Program Contract

The canonical program contract must not carry:

- authenticated backend sessions or request-local proof handles;
- persistence repositories, transactions, or physical locators;
- readiness, publication, activation, or routing authority;
- executor or journal capabilities;
- Cloudflare bindings, Worker Loader handles, or R2 credentials; or
- caller-authored claims that source or semantic content has been verified.

### Use A Dedicated Domain Owner

The completed preflight selects `@flarex/declarative-program`. It owns the
host-neutral in-memory model, strict decoder, deterministic normalization, and
fixture construction needed by independent SDK/compiler and analysis/test
consumers. Exact wire primitives remain in explicit `flarex-protocol`
subpaths, and the SDK adapter remains outside the contract package. This does
not create a vague `core`, `common`, or catch-all package.

## Proposed Contract Responsibilities

Subject to preflight, the canonical program input should be able to describe:

- contract/version identity;
- logical modules and canonical module paths;
- function export identity, derived path, kind, visibility, and validators;
- schema tables, document validators, and logical indexes;
- deterministic ordering and bounded counts.

It should not attempt to encode JavaScript closures or pretend a TypeScript
type is runtime evidence. Executable functions still become portable ESM.
Runtime validators and declarations need an explicit encoded form.

The completed preflight narrows this responsibility: module source, source
maps, and source positions are not members of the canonical program. They are
build inputs and derived analyzer evidence, joined by canonical module path.
Likewise, catalog schema versions, table IDs, index IDs, lifecycle state, and
physical bindings are derived deployment values, not developer intent.

## Mandatory Preflight Before Implementation

The preflight is a research deliverable, not an implementation checkpoint. It
must inspect current code and tests and produce an accepted amendment to this
record before a package or migration begins.

### P1. Producer And Consumer Inventory

Locate every current producer and consumer of:

- SDK schema definitions and registered function objects;
- loaded execution modules;
- deployment analysis and codegen analysis;
- source packages and source maps;
- Source Artifact V2 and Semantic Artifact V1;
- schema manifests and function metadata;
- analyzer commands, responses, and verification evidence; and
- runtime projections and materialization definitions.

For each edge, record whether the value is trusted, untrusted, authenticated,
canonical bytes, decoded data, process-local capability, or runtime-only
object.

### P2. Shape And Semantics Matrix

Create a field-by-field matrix covering schema, validators, functions, module
paths, visibility, routing/placement policy, indexes, source positions, and
runtime capability declarations.

For every field, identify:

- current owner and exact source type;
- producer and consumers;
- normalization and canonical-order rules;
- validation and failure owner;
- whether omission differs from `undefined` or `null`;
- whether it is intent, derived evidence, or authority; and
- whether it is still part of the accepted FlarexDB target.

This step must expose legacy partition/placement assumptions rather than
silently freezing them into a new standard.

### P3. Convex And Current Flarex Research

Inspect the matching Convex schema, function registration, codegen, analysis,
and function-runner boundaries before finalizing the contract. Record what can
be ported directly and each necessary Flarex divergence caused by Cloudflare,
portable ESM, Postgres authority, or the accepted deployment model.

### P4. Contract And Package Options

Compare at least:

1. a dedicated `@flarex/declarative-program` owner;
2. explicit protocol subpaths plus adapters in existing owners; and
3. retaining current boundaries with only a test-fixture adapter.

The choice must include an import/dependency graph, Worker-bundle
compatibility, Effect applicability, public/internal export status, and a
reason each rejected option is worse for the proven consumers.

### P5. Canonicalization And Versioning

Define:

- the exact in-memory and encoded identities;
- deterministic module and declaration ordering;
- size/count/depth limits and their owners;
- duplicate and path-collision behavior;
- validation order and typed failures;
- unknown-field compatibility;
- contract-version versus artifact-version rules; and
- how the same input proves reproducible Source Artifact V2 and Semantic
  Artifact V1 output.

No version suffix grants migration or compatibility authority by itself.

### P6. Compatibility And Migration Audit

Identify shipped or supported consumers before retaining compatibility
wrappers. The first implementation plan must choose one narrow vertical,
preserve current behavior with parity evidence, and avoid dual writes, silent
fallbacks, or a repository-wide rewrite.

### P7. Validation Plan

Specify focused tests for:

- SDK definition and direct fixture producing equivalent normalized programs;
- deterministic encoded output;
- malformed and over-budget inputs;
- analyzer acceptance/rejection parity;
- Source Artifact V2 and Semantic Artifact V1 correlation;
- package export and fresh-consumer behavior if anything becomes public; and
- unchanged activation, OCC, commit, feed, and application-row semantics.

## Completed Preflight

### P1. Producer, Consumer, And Trust Inventory

The current edges are:

| Edge | Current producer | Current consumer | Actual claim |
| --- | --- | --- | --- |
| SDK schema object | `flarex` schema builders | `@flarex/analysis` | Mutable process-local developer object; not canonical and not authority |
| registered function object | `flarex` function builders | loaded-module analysis | Process-local object containing markers, exporters, handler closures, and legacy partition policy |
| loaded execution modules | `flarex-dev` data-URL or Miniflare module evaluation | `analyzeExecutionModulesEffect` | Executed developer code plus module namespace objects; untrusted runtime values |
| V1 source package and source maps | `flarex-dev` Vite bundling | local or isolated V1 analyzer | Developer-produced portable source text and optional debugging evidence |
| V1 deployment analysis/codegen analysis | `@flarex/analysis` | V1 push and code generation | Decoded analysis data; not Declarative V2 verification authority |
| Source Artifact V2 | Declarative V2 upload/finalization | authenticated read session and verifier | Immutable finalized source bytes and provenance after the owning finalization proof |
| Semantic Artifact V1 | developer/CI materialization and finalization | semantic stream decoder and verifier | Canonical bounded NDJSON artifact evidence; its decoded records remain inert |
| authenticated analyzer command | backend command producer | private analyzer/verifier compute | Request-scoped, bounded, inert command; it cannot mint backend or deployment authority |
| verifier progress/evidence | private verifier plus backend persistence | readiness/projection owners | Evidence requiring backend authentication and stored correlation before it is trusted |
| active point-mutation metadata | activation/projection owner | point-mutation start | Trusted runtime-selection data containing function validators and schema manifest |
| exact-runtime request | executor runtime-neutral runner | isolated Dynamic Worker | Strict bounded execution projection; the separate journal object is the only database capability |

This inventory confirms that a normalized developer program belongs before
artifact creation. It must not be accepted where finalized artifact proof,
authenticated verifier evidence, active metadata, or an execution capability
is required.

### P2. Shape And Semantics Matrix

| Concern | Current source | Canonical program decision | Later owner |
| --- | --- | --- | --- |
| module identity | source-package path and loaded-module key | one validated logical module path; modules sorted by UTF-16 code-unit order | Source Artifact V2 revalidates its artifact path contract |
| function identity | module key plus export name; V1 path is derived | store module path and export name once; derive the function path with the current default-versus-named rule | semantic materializer emits function and handler records |
| kind and visibility | runtime marker properties | explicit closed unions | analyzer and runtime projection retain their narrower admission checks |
| argument validator | live validator or `exportArgs()` JSON | protocol `ValidatorJsonV1`, restricted to object or `any` for function arguments | semantic validator record and active runtime metadata |
| return validator | live validator or `exportReturns()` JSON | protocol `ValidatorJsonV1 | null`; omission is invalid after normalization | semantic validator record and active runtime metadata |
| table declaration | mutable SDK table object | reuse schema-manifest app table declaration input; no catalog table ID | schema-manifest materializer assigns/binds IDs |
| index declaration | mutable SDK index array | reuse schema-manifest app index declaration input; developer field order is significant | schema materialization owns physical identity and lifecycle |
| table placement | SDK `partitionBy`, `colocateWith`, or `global`; missing currently means `_id` partitioning | not admitted by the first canonical contract except the target-compatible global/unpartitioned slice | a later FlarexDB placement preflight must decide its target contract |
| function partition | SDK exporter and analyzer-owned lowering | not admitted in the first slice | a later compatibility or target-routing decision; it is not silently frozen into V1 |
| source module text | V1 `SourceModule.source` | excluded; a build input keyed by canonical module path | bundler and Source Artifact V2 |
| source map and position | source-package source map and analyzer regex resolution | excluded; source map is build evidence and position is derived analyzer evidence | analyzer diagnostics/codegen |
| schema/catalog version | analyzer currently synthesizes version `1`; runtime uses catalog version IDs | excluded | schema catalog and deployment projection |
| table/index IDs and state | current V1 analysis synthesizes numeric IDs; manifests own stable bindings | excluded | schema catalog, persistence, and activation |
| handler closure | registered function `_handler` | excluded | portable ESM module export |
| runtime/database capability | host context, binding, and journal objects | prohibited | function runtime host and one-call journal boundary |

Omission, `undefined`, and `null` are not interchangeable. The unknown-input
decoder rejects missing required members and explicit `undefined`; only fields
whose type includes `null` admit explicit absence. Normalized output contains
no optional representation chosen merely for producer convenience.

### P3. Convex Comparison And Required Divergence

Convex provides a useful ergonomic precedent, not the target internal
contract. Its SDK schema class exports JSON, registered functions expose
`exportArgs()` and `exportReturns()`, and server-side analysis evaluates module
namespaces in an isolate before inspecting those runtime objects. Flarex's
current V1 path closely follows that shape.

Flarex should retain the developer-facing ergonomics and validator spellings,
but it must diverge at the downstream boundary:

- developer/CI tooling, not the trusted backend verifier, owns TypeScript,
  dependency resolution, bundling, and evaluation of SDK exporters;
- portable ESM and immutable Source Artifact V2 replace Convex's assumption
  that the server can treat the submitted module graph as its build input;
- Semantic Artifact V1 provides bounded declaration evidence independently of
  JavaScript object identity;
- Postgres schema/catalog authority assigns table and index identities rather
  than accepting analyzer-synthesized IDs as authority; and
- Cloudflare Worker isolation and explicit journal capabilities prevent a
  loaded application module from inheriting backend bindings.

Therefore, directly porting Convex's runtime-object analyzer as the permanent
inter-domain API would preserve the coupling this roadmap is intended to
remove.

### P4. Package Decision

The selected owner is a dedicated, initially workspace-internal
`@flarex/declarative-program` package with an explicit `/v1` export. It owns the
pure versioned model, strict decoder, deterministic normalizer, budget value,
typed normalization errors, function-path derivation, and direct fixture
builder. It does not re-export through the public `flarex` root.

Dependency direction:

```text
@flarex/declarative-program
  --imports--> @flarex/utils
  --imports--> effect                 (Result and Schema only)
  --imports--> flarex-protocol        (exact validator and schema-declaration contracts)

@flarex/analysis
  --imports--> @flarex/declarative-program

flarex-dev
  --imports--> flarex
  --imports--> @flarex/declarative-program
  --imports--> @flarex/analysis

flarex
  --does not import--> @flarex/declarative-program in the first slice
```

The package is host-neutral: no Node filesystem API, Vite, Miniflare,
Cloudflare binding, persistence adapter, Context service, Layer, or Effect
runner. Pure unknown-input recovery returns Effect v4 `Result`; the analyzer
enters its typed Effect error channel once with `Effect.fromResult`. Calling
SDK exporters remains an effectful foreign boundary in the `flarex-dev`
adapter because developer getters/functions and JSON parsing can throw.

The rejected options are:

1. **Protocol subpaths plus existing adapters.** Exact validator and
   schema-declaration primitives remain in `flarex-protocol`, but the aggregate
   program is normalized intent rather than a wire, artifact, or authority
   protocol. Putting the aggregate there would mix lifecycle claims and make
   the protocol package the owner of compiler composition.
2. **Only a fixture adapter over current analysis inputs.** This would leave
   loaded SDK classes and exporter methods as the analyzer's standard API and
   would make fixtures a second incidental shape. It does not create the
   independent producer/consumer boundary requested by this roadmap.

The package is justified by two distinct producers—the SDK/compiler adapter
and direct fixtures—and by two distinct downstream uses—analysis and later
artifact materialization. Publication outside the workspace remains a
separate semver and fresh-consumer decision.

### P5. Approved V1 Contract And Canonicalization

The first package must define equivalents of these concrete shapes:

```ts
interface CanonicalDeclarativeProgramV1 {
  readonly format: "flarex.declarative-program/v1";
  readonly version: 1;
  readonly schema: CanonicalDeclarativeSchemaV1;
  readonly modules: ReadonlyArray<CanonicalDeclarativeModuleV1>;
}

interface CanonicalDeclarativeSchemaV1 {
  readonly tables:
    ReadonlyArray<SchemaManifestAppTableDeclarationV1>;
  readonly indexes:
    ReadonlyArray<SchemaManifestAppIndexDeclarationV1>;
}

interface CanonicalDeclarativeModuleV1 {
  readonly modulePath: CanonicalDeclarativeModulePathV1;
  readonly functions: ReadonlyArray<CanonicalDeclarativeFunctionV1>;
}

interface CanonicalDeclarativeFunctionV1 {
  readonly exportName: CanonicalDeclarativeExportNameV1;
  readonly kind: "query" | "mutation" | "workflowMutation" | "action";
  readonly visibility: "public" | "internal";
  readonly argsValidator: ObjectValidatorJsonV1 | AnyValidatorJsonV1;
  readonly returnsValidator: ValidatorJsonV1 | null;
}
```

The function path is derived, not duplicated:

```text
default export -> modulePath
named export   -> modulePath + ":" + exportName
```

The V1 contract deliberately has no generic metadata bag and no placement,
partition, route, source, source-map, position, table-ID, index-ID, lifecycle,
verification, or authority field. Adding any of those requires an owner and a
versioned preflight; unknown fields fail rather than being retained.

The package owns a tagged `CanonicalDeclarativeProgramV1Error` whose operation,
reason, logical path, and optional observed/maximum facets are stable. Schema
decoder errors are mapped once into that domain error; callers may translate
the domain error at their adapter boundary but must not reinterpret defects as
ordinary invalid input.

#### Canonicalization, Budgets, And Versioning

The decoder and normalizer obey these rules:

1. capture exact own data records and arrays without invoking inherited
   properties; reject accessors, symbols, sparse arrays, unknown members, and
   `undefined`;
2. validate input arrays from left to right, with the first invalid member or
   second colliding identity winning;
3. reuse protocol validator and schema-declaration decoders rather than
   redeclaring their grammars;
4. establish ownership by copying admitted plain data, including validator
   trees, before recursively freezing only the supported program domain;
5. sort modules, functions, tables, and indexes by exact UTF-16 code-unit
   order after successful validation; preserve declared index-field order;
6. reject duplicate module paths, derived function paths, table names, and
   table-name/index-descriptor pairs;
7. derive function paths once and reject path collisions, including
   default-versus-named collisions; and
8. emit no canonical bytes directly. Artifact owners encode the normalized
   value into their own versioned Source Artifact V2 and Semantic Artifact V1
   formats.

Numeric validator literals must be finite and must not be negative zero at the
protocol codec and SDK-exporter owners because those JavaScript spellings
cannot survive ordinary JSON artifact encoding without changing validator
behavior. The first contract rejects them; admitting them requires a separately
designed extended-float representation.

`CanonicalDeclarativeProgramBudgetV1` is an opaque package-owned value created
by a validating factory. It has explicit maxima for module count, function
count, cumulative UTF-8 identifier bytes, cumulative UTF-8 validator literal
string bytes, validator nodes, and validator depth. An accepted depth budget
may not exceed the protocol's stack-safe nesting ceiling of 128. The separate
literal-string ceiling closes the boundedness gap that node and identifier
counts alone leave for `v.literal("...")`. Schema tables, indexes, indexes per
table, declared index fields, and schema-validator depth additionally retain
the exact hard ceilings already owned by
`flarex-protocol/schema-manifest`. The normalizer receives a budget; there is
no unbounded convenience overload and no producer-specific default. Artifact
upload and verifier budgets remain separate and may be stricter.

Program V1, Source Artifact V2, and Semantic Artifact V1 are independent
versions. Changing one does not authorize rewriting another. Reproducibility
means that the same owned normalized program plus the same separately
canonicalized build inputs produces byte-identical source and semantic
artifacts under their pinned materializer versions; the program alone cannot
prove source bytes it does not contain.

### P6. First Implementation Vertical And Compatibility Gate

The approved first vertical is one global table with one ordered index and one
public, unpartitioned mutation with explicit argument and return validators.
It includes only:

1. the new package's V1 model, opaque budget, `Result` decoder/normalizer,
   direct fixture builder, and unit tests;
2. a `flarex-dev` SDK/compiler adapter that lowers the selected SDK subset into
   the same unknown-input decoder;
3. an internal `@flarex/analysis` entrypoint that consumes only the canonical
   program and produces the existing V1 analysis/codegen result shapes; and
4. parity tests showing the SDK definition and direct fixture normalize to the
   same owned program and yield the same analyzer result.

The existing `analyzeLoadedSourcePackageEffect`, V1 push route, Declarative V2
artifact path, readiness, activation, and runtime remain unchanged. The first
slice is opt-in and internal. It must not inspect a failed canonical attempt
and silently fall back to live SDK analysis, persist both representations, or
publish both as competing authority.

The SDK adapter reports a typed unsupported-policy failure for partitioned or
colocated tables and partitioned functions in this slice. The current path
continues to support them until a separate FlarexDB placement/partition
preflight decides whether each policy is target behavior or legacy
compatibility. This restriction is a slice boundary, not a claim that the
current behavior has already been removed.

Rollback before production routing is deletion of the new internal package and
opt-in entrypoints; no stored state or artifact migration is involved. The
direct live-object analyzer may be removed only after every supported
schema/function variant has parity evidence, the selected deployment producer
uses the canonical input without fallback, and its owning roadmap explicitly
approves the cutover.

### P7. Validation And Non-Regression Plan

The first slice must run:

- package typecheck, unit tests, and a fresh explicit `/v1` import test;
- SDK-versus-fixture normalized-program deep equality and runtime ownership
  tests;
- analyzer output and diagnostic parity for the approved vertical;
- repeated normalization and materialization determinism tests;
- duplicate module/function/table/index, malformed validator, unknown-field,
  accessor, sparse-array, over-count, over-byte, over-node, and over-depth
  failures;
- explicit rejection tests for legacy placement/partition in the first
  adapter;
- Source Artifact V2/Semantic Artifact V1 correlation tests before any later
  materializer consumes the contract; and
- the existing focused activation, point-mutation start, exact-runtime, OCC,
  commit, feed, outbox, and application-row tests before any production route
  is changed.

No benchmark claim follows from the contract. It improves composability and
test isolation; storage, index, planner, and runtime performance require their
own measured evidence.

## First Implementation Receipt

The approved internal vertical now exists without production routing:

- `@flarex/declarative-program/v1` owns the nominal program and budget types,
  strict left-to-right `Result` decoder, deterministic normalization, owned
  recursive snapshots, function-path derivation, and direct fixture builder;
- `@flarex/analysis/internal/canonical-declarative-program-v1` projects an
  admitted program into the existing V1 deployment-analysis shape using global
  placement and no partition policy;
- `flarex-dev/internal/declarative-program-v1` adapts live SDK definitions,
  rejects unsupported schema members, legacy table placement, and function
  partition policy, then enters the canonical decoder once with
  `Effect.fromResult`; and
- `flarex-protocol/validator-json` and the SDK exporter now reject non-finite
  and negative-zero numeric literals at their shared JSON boundary.

Focused validation covers package typechecking, the explicit `/v1` import,
SDK-versus-fixture equality, analyzer equality, owned recursive freezing,
unknown/accessor/sparse input, collision precedence, every program budget
dimension, linear validator depth, numeric-literal rejection, unsupported
SDK policy, and the directly connected legacy analyzer suites. The later
Source Artifact V2/Semantic Artifact V1 materializer implementation and
correlation gates remain open, as do all production routing and removal gates.

## Materialization Preflight

This preflight selects the next private boundary after canonical program
admission. It does not authorize a deployment route. Its purpose is to let
developer tooling and direct fixtures deterministically construct the
untrusted bytes and metadata that the existing Source Artifact V2 and Semantic
Artifact V1 upload owners will later admit and authenticate.

### M1. Concrete Gap And Scope

The canonical declarative program carries normalized developer intent. It
deliberately does not carry compiled JavaScript bytes, source maps, artifact
module paths, content roots, upload selectors, analyzer evidence, or runtime
authority.

The current `flarex-dev` build path already emits immutable JavaScript modules,
including `_flarex/execution.js`, function entry modules such as `orders.js`,
and optional schema or auth modules. Source Artifact V2 and Semantic Artifact
V1 already own their framing, upload, finalization, and backend-derived
identity. What is missing is one host-neutral contract that combines a
canonical program with a separately normalized prebuilt module graph and
produces an inert ingress plan for those artifact owners.

The materializer is therefore a deterministic pre-upload transformation:

```text
CanonicalDeclarativeProgramV1
  + normalized prebuilt module graph
  + explicit logical-to-artifact bindings
  + caller-supplied materialization budget
                  |
                  v
DeclarativeV2ArtifactIngressPlanV1
  - ordered Source Artifact V2 module inputs
  - canonical Semantic Artifact V1 NDJSON bytes
  - bounded usage receipt
```

It does not compile TypeScript, invoke Vite, read the filesystem, upload
blocks, derive authenticated roots, mint selectors, finalize artifacts, run
analysis, or create readiness or activation authority.

### M2. Current Producer, Consumer, And Contract Inventory

The first producers are:

- the private `flarex-dev` prebuild adapter, after its build owner has already
  produced normalized ESM modules; and
- a direct internal fixture/tool adapter that supplies the same normalized
  prebuilt graph without constructing SDK objects or running Vite.

The first consumers are private tests and later adapters to the existing
Source Artifact V2 and Semantic Artifact V1 upload cores. The public
`flarex-test` surface is not migrated in this slice.

Existing authority remains where it is:

- `@flarex/declarative-program/v1` owns normalized intent;
- Source Artifact V2 owns source roles, bytes, framing, block/tree hashing,
  roots, upload selectors, generations, and fences;
- Semantic Artifact V1 owns its framed stream, backend-derived root, source
  root binding, upload lifecycle, and finalization;
- the analyzer owns bounded semantic consumption, diagnostics, and evidence;
  and
- readiness and activation own deployability and active authority.

The materializer may reuse those versioned wire contracts. It must not
redeem, weaken, or duplicate their authority.

### M3. Logical Names Versus Artifact Paths

The preflight found one important non-identity: the canonical program names a
developer module `orders`, while the prebuilt source artifact commonly names
its emitted ESM module `orders.js`. Appending or removing `.js` inside the
materializer would make a build-tool convention into hidden protocol policy.

Every function entry must therefore carry an explicit binding:

```text
logicalModulePath:  orders
artifactModulePath: orders.js
```

The logical name remains the input to developer-visible function-path
derivation, such as `orders:place`. The artifact path is used by source-module
records and semantic module, function, and handler records. The materializer
validates both domains and rejects missing, duplicate, conflicting, or
unreferenced entry bindings; it never guesses between them.

Artifact-module path syntax is a shared pure wire concern. Its existing
incremental analyzer verdict must be moved or projected into a
`flarex-protocol` owner and parity-tested, while analyzer-specific opaque
handles and receipts remain in `@flarex/analysis`.

### M4. Selected Package And Dependency Direction

Create a workspace-internal package:

```text
@flarex/declarative-materializer/v1
```

It is host-neutral and deterministic. Its allowed dependencies are:

- `@flarex/declarative-program`;
- internal `flarex-protocol` contracts for Source Artifact V2 roles, semantic
  records, and artifact module paths;
- `@flarex/utils` for exact domain-neutral primitives; and
- Effect's pure `Result` data type.

It must not depend on Node, Vite, `@flarex/analysis`, `flarex-backend`,
Cloudflare bindings, persistence, an Effect runtime, or deployment routes.
Dependency direction is from `flarex-dev` and private fixtures into the
materializer, never from the materializer back into those hosts.

The Source Artifact V2 role bits are currently declared with backend framing.
The first slice must give their pure role vocabulary one internal
`flarex-protocol` owner and have backend framing import it; the materializer
must not duplicate the numeric mapping or depend on the backend. Framing,
hashing, and upload behavior remain backend-owned.

The semantic-record wire shape and canonical encoder also belong in
`flarex-protocol`. Today the incremental decoder types live under
`@flarex/analysis` while the matching encoder exists only in tests. The first
slice must establish one protocol-owned record contract so a production
encoder and analyzer decoder cannot drift.

### M5. Approved V1 Input And Output Shape

The materializer input contains:

- an admitted `CanonicalDeclarativeProgramV1`;
- ordered artifact modules with exact artifact paths, role sets, immutable
  source bytes, and optional immutable source-map bytes;
- explicit logical-module-to-artifact-module function entry bindings;
- exact execution module path; and
- optional schema and auth module paths reserved by the existing role
  vocabulary.

The first implementation accepts only function and execution roles. Schema and
auth roles remain named but unsupported until their semantic and runtime
contracts receive separate bounded slices.

The output is an owned, immutable
`DeclarativeV2ArtifactIngressPlanV1` containing:

- ordered source modules with artifact path, roles, source bytes, and optional
  source-map bytes;
- execution path and the admitted function-entry bindings;
- canonical Semantic Artifact V1 NDJSON bytes, record count, and maximum
  encoded record size; and
- an exact materialization usage receipt.

It contains no caller-asserted digest, source root, semantic root, upload
selector, generation, fence, finalized status, verified status, candidate,
readiness evidence, or activation claim. Those values can be created only by
their existing backend owners after accepting the bytes.

### M6. Semantic Record Construction

The protocol-owned encoder emits exactly one canonical JSON object followed by
LF for every record, including the final record. Record order is:

1. header;
2. modules;
3. functions;
4. schema;
5. tables;
6. indexes;
7. validators; and
8. handlers.

Module, function, and handler records use the explicit artifact module path.
The developer-visible function path remains the path already derived from the
logical canonical module. The approved first vertical emits `partition: null`.

Validator identifiers are deterministic fixed-width ordinals allocated after
sorting the complete validator-owner list. V1 does not content-deduplicate
equal validators. The schema record uses a materializer-version-pinned
declaration identity, not a mutable catalog version or backend identity.

Before returning, the materializer proves the same cross-record completeness
expected by the semantic consumer: functions refer to admitted modules,
validators, and handlers; tables refer to validators; indexes refer to tables;
and handlers refer to functions. The analyzer remains responsible for
independently checking the bytes it receives.

### M7. Budgets, Errors, And Effect Cutline

`DeclarativeV2MaterializationBudgetV1` is opaque and caller-supplied. There is
no unbounded overload or hidden default. It bounds at least:

- artifact module count and function-entry binding count;
- cumulative source and source-map bytes;
- cumulative copied/output bytes;
- semantic record count;
- maximum encoded semantic-record bytes; and
- total semantic stream bytes.

The pure package returns `Result` with a package-owned tagged
`DeclarativeV2MaterializationV1Error`. It preserves deterministic
left-to-right validation and first-failure order. Foreign filesystem, Vite,
and bundler failures stay in the `flarex-dev` Effect/Promise adapter. Backend
authentication, hashing, R2, upload, and persistence failures stay in their
existing Effect owners.

### M8. First Implementation Vertical

The only approved implementation slice is the same narrow program already
used by the canonical-program receipt:

- one global `orders` table;
- one ordered `by_status` index;
- one public unpartitioned `orders:place` mutation;
- logical module `orders` explicitly bound to artifact module `orders.js`;
- `orders.js` carrying the function role; and
- `_flarex/execution.js` carrying the execution role.

Implement it in this order:

1. establish the internal protocol-owned Source Artifact V2 role vocabulary
   and make backend framing reuse it without changing the numeric wire values;
2. move or define the semantic-record wire contract and canonical encoder in
   `flarex-protocol`, then migrate the analyzer decoder to that one contract;
3. establish the shared pure artifact-module-path verdict in
   `flarex-protocol` and prove analyzer parity;
4. add `@flarex/declarative-materializer/v1` with its model, opaque budget,
   deterministic `Result` materializer, errors, and owned snapshots;
5. add direct fixture and private `flarex-dev` prebuild adapters;
6. produce deterministic source ingress data and semantic NDJSON for the
   approved vertical; and
7. add focused package, negative, ownership, budget, and cold-run
   determinism tests.

This slice is inert. It does not call either upload core or change a route.

### M9. Parity, Correlation, And Removal Gates

The first slice must prove:

- SDK-prebuild and direct-fixture inputs produce byte-identical ingress plans;
- repeated cold materialization produces byte-identical source inputs and
  semantic bytes;
- logical and artifact path collisions fail explicitly;
- unknown fields, accessors, sparse arrays, invalid roles, missing bindings,
  duplicate paths, inconsistent references, and every budget dimension fail
  deterministically;
- the analyzer accepts the emitted semantic bytes and reports the expected
  program; and
- protocol encoder/decoder and artifact-path implementations remain in parity.

A later, separate integration slice may drive the inert plan through in-memory
instances of the existing Source Artifact V2 and Semantic Artifact V1 upload
cores. That slice must prove stable backend-derived content roots across cold
runs and prove that the semantic root is bound to the backend-derived source
root. Upload selectors and attempt identities are lifecycle identities and are
not required to be stable across runs.

No current producer, analyzer path, or fixture may be removed until every
supported variant has parity evidence and its owning roadmap approves the
cutover. Rollback before routing is deletion of the new package and private
adapters; no stored state is involved.

## Materialization Preflight Exit Decision

The preflight passes only for M8:

1. the producers, first consumers, and authority owners are explicit;
2. logical module names and emitted artifact paths are separately modeled;
3. the package and dependency direction are host-neutral;
4. the versioned input, inert output, budgets, typed errors, ordering, and
   Effect boundary are selected;
5. source roles, semantic wire records, and artifact path syntax have one
   protocol owner;
6. the narrow vertical, deterministic tests, rollback, and later correlation
   gate are defined; and
7. production upload, verification, readiness, activation, and runtime routing
   remain blocked.

This decision does not change Source Artifact V2, Semantic Artifact V1, or
Canonical Declarative Program V1 versions. It approves implementation of the
private materializer slice, not deployment of its output.

## Materialization Implementation Receipt 1

The first M8 checkpoint establishes the protocol contracts required before the
materializer package can exist:

- `flarex-protocol/internal/declarative-v2-source-artifact-v2` now owns the
  exact existing Source Artifact V2 codec version and role-bit vocabulary plus
  the shared branded role-set verdict;
- backend framing and upload admission reuse that verdict while retaining
  their existing errors, framing, hashing, and lifecycle ownership;
- `flarex-protocol/internal/declarative-v2-semantic-record-v1` now owns the
  semantic record union, exact key sets, record-kind order, canonical JSON
  payload encoder, and canonical LF-terminated record encoder;
- the incremental analyzer retains its bounded state machine and error owner
  but imports and compatibility-reexports the protocol record contract;
- `flarex-protocol/internal/declarative-v2-artifact-module-path-v1` now owns a
  branded pure string verdict, while the analyzer retains its opaque
  incremental byte handle and proves acceptance parity plus exact UTF-8
  round-trip spelling; and
- the shared role verdict closes the prior 32-bit coercion hole that could
  admit a safe integer above the four-bit role mask.

Reviewer hardening also pinned two boundary properties: terminal unpaired
surrogates are rejected through the existing canonical UTF-8 owner, and the
production semantic record encoder includes the mandatory final LF. The
payload-only helper is deliberately named and used only where the analyzer's
per-record budget excludes the line delimiter.

Focused validation passes:

- `flarex-protocol`, `@flarex/analysis`, and `flarex-backend` typechecks;
- 130 focused protocol, analyzer-parity, semantic-framing, and backend framing
  tests across seven files;
- the workspace Effect runtime-boundary check; and
- `git diff --check`.

Both required standing reviewers reported no remaining actionable findings.
This receipt does not authorize the materializer package to upload anything;
the next implementation checkpoint is recorded below.

## Materialization Implementation Receipt 2

The second M8 checkpoint adds the inert host-neutral transformation without
crossing an upload, storage, verifier, readiness, activation, or runtime
authority boundary:

- `@flarex/declarative-materializer/v1` depends only on the canonical program,
  protocol contracts, domain-neutral utilities, and Effect's pure `Result`
  data types; it has no analyzer, backend, Node, Vite, or Cloudflare runtime
  dependency;
- an opaque, factory-created budget covers module and binding counts, source
  and source-map bytes, cumulative allocation bytes, semantic record count,
  maximum record bytes, and total stream bytes; copied or structurally forged
  budgets are rejected;
- exact module-graph input keeps logical module names separate from artifact
  paths, requires explicit one-to-one function bindings and role declarations,
  rejects unsupported schema/auth roles, and snapshots non-shared module bytes
  before retaining them;
- the pure materializer sorts source modules and bindings by their owned
  contract order, emits only inert Source Artifact V2 ingress data and
  canonical Semantic Artifact V1 NDJSON, and returns an immutable usage
  receipt rather than roots, selectors, finalization claims, or activation
  authority;
- canonical semantic UTF-8 measurement now belongs to `flarex-protocol` and is
  reused by the existing static-finalization owner. The materializer admits
  each full LF-terminated record before the protocol encoder allocates its
  canonical string or byte arrays, then uses the protocol-owned line encoder;
  and
- a direct canonical `orders` / `by_status` / public `orders:place` mutation
  fixture proves deterministic source and semantic bytes, ownership
  detachment, every budget dimension, hostile structural inputs, path/role/
  binding collisions, and analyzer consumption through the real incremental
  semantic decoder.

Focused validation passes:

- `@flarex/declarative-materializer`, `flarex-protocol`,
  `@flarex/analysis`, and `flarex-backend` typechecks;
- all 387 `flarex-protocol` tests, including canonical-JSON measurement,
  semantic-record framing, and existing static finalization;
- 30 materializer tests, 69 focused analyzer consumer/parity tests, and 21
  focused backend Source Artifact V2 tests;
- the workspace Effect runtime-boundary check; and
- `git diff --check`.

Both required standing reviewers reported no remaining actionable findings on
the final code diff.

This checkpoint still has only one private producer: the direct test fixture.
The second private producer and its parity receipt are recorded below.
Upload-core correlation remains a later M9 integration slice and production
routing remains blocked.

## Materialization Implementation Receipt 3

The final M8 checkpoint adds the private developer-tooling producer without
changing V1 bundling, push, upload, backend, verifier, readiness, activation,
or runtime routing:

- `flarex-dev/internal/declarative-materializer-v1` combines the existing
  loaded-SDK canonical-program adapter with an already-built `SourcePackage`
  and the host-neutral materializer through one named Effect operation;
- the `.js` logical-to-artifact binding convention remains owned by
  `flarex-dev`. The adapter selects only declared function modules and the
  execution module, while schema intent comes from the canonical program and
  auth-bearing prebuilds fail closed until an auth-role slice is approved;
- caller-supplied SourcePackage digests are not projected as authority. The
  adapter supplies source text and source maps only; the materializer owns
  byte snapshots and later backend owners must still derive authenticated
  roots from accepted bytes;
- a two-phase pure preflight bounds raw prebuilt module count, selected module
  and binding counts, UTF-8 source and source-map bytes, and adapter
  materialization bytes before allocating encoded arrays. A materializer-owned
  admission operation authenticates the opaque budget before the adapter reads
  any budget field. The adapter captures each admitted string once, preserves
  left-to-right first failure, rejects sparse or accessor-backed producer
  members, and rejects duplicate function or selected-module paths rather than
  deduplicating them; and
- a Vite-free SDK-prebuild fixture produces byte-identical source ingress,
  semantic NDJSON, and usage receipts to the direct fixture. A separate
  integration test proves that the existing Vite build owner's normalized
  `SourcePackage` enters the same adapter without moving Vite into the
  materializer.

Focused validation passes:

- `flarex-dev` and `@flarex/declarative-materializer` typechecks;
- eleven adapter tests, fifteen connected canonical-program/source-package
  tests, and all thirty materializer tests;
- the workspace Effect runtime-boundary check; and
- `git diff --check`.

The broader serial `flarex-dev` run currently reports 201 of 205 tests passing
across twenty files. The four failures are unchanged
`executionArtifact.test.ts` import-policy cases that independently reproduce
`window is not defined` instead of their expected sandbox messages; this
adapter does not import or change that flow.

Both required standing reviewers reported no remaining actionable
implementation findings on the final code diff. The TypeScript reviewer found
the earlier aggregate test count stale; the serial rerun above supplies the
corrected receipt.

M8 is now complete. M9 upload-core correlation remains a separate preflight
and implementation decision, and production routing remains blocked.

## Preflight Exit Decision

The preflight exit criteria are satisfied for the narrow first vertical:

1. its producers are the `flarex-dev` SDK adapter and direct fixture builder;
2. its first consumer is the canonical analysis entrypoint, with artifact
   materialization explicitly deferred;
3. intent, artifact provenance, analyzer evidence, verified projection, and
   runtime authority remain separate;
4. package ownership, dependency direction, versioned shapes, Result/Effect
   boundary, error owner, ordering, budgets, and duplicates are defined;
5. the global-table/unpartitioned-mutation slice avoids freezing unresolved
   legacy placement and partition behavior; and
6. rollback, removal, parity, negative, and later non-regression gates are
   explicit.

This approval does not authorize Source Artifact V2 or Semantic Artifact V1
version changes, a production routing switch, or removal of the current
loaded-module analyzer.

## Preflight Exit Criteria

Implementation may begin only after the preflight has:

1. named every first-slice producer and consumer;
2. separated intent, artifact provenance, analyzer evidence, verified
   projection, and authority;
3. selected the package owner and dependency direction;
4. proposed concrete versioned types and error ownership;
5. defined canonicalization and boundedness;
6. identified the smallest migration vertical and rollback/removal gate;
7. defined parity and negative tests; and
8. been recorded as an accepted update to this roadmap.

The completed preflight above satisfies these items only for the approved
first vertical. A wider migration remains gated.

## Known Risks

- A universal model could become a cross-domain god object.
- Freezing current SDK classes could make internal representation a permanent
  compatibility obligation.
- Re-declaring existing protocol types could create subtly different
  validation or canonicalization.
- A fixture builder could become a second compiler if it bypasses shared
  normalization.
- Legacy placement or runtime metadata could be accidentally promoted into the
  target architecture.
- A public export could create semver obligations before the contract is
  mature.

## Target Direction

The target permits each domain to be tested independently:

```text
SDK tests
  -> developer definitions -> canonical program

compiler tests
  -> canonical program fixture -> deterministic artifacts

analyzer tests
  -> canonical artifacts -> evidence and diagnostics

verifier tests
  -> authenticated artifact fixtures -> verified projection

runtime tests
  -> verified projection fixture -> function execution
```

No downstream domain needs the final ergonomic SDK in order to develop its own
semantics, and no downstream domain accepts an SDK object as authority.

## Next Correctness Gate

M8 is complete. The next work is only a new preflight for the in-memory
upload-core correlation slice described in M9. That preflight must identify the
existing Source Artifact V2 and Semantic Artifact V1 in-memory owners, exact
adapter inputs, backend-derived root correlation, budgets, errors, and rollback
before implementation begins.

Do not fold upload calls, backend routes, stored state, or a production producer
cutover into that preflight or infer implementation authority from M8.

The host-neutral function-runtime work in roadmap 40 does not wait for that
materializer merely to obtain an execution fixture. Its first exact
point-mutation slice consumes the already authenticated active function
metadata, schema manifest, and stable bindings held by the trusted executor.
Roadmap 40 must keep that verified execution projection distinct from this
developer-intent contract.

Do not route production, change artifact versions, migrate placement or
partition policy, or touch readiness, activation, OCC, commit, feed, outbox,
or application-row semantics.
