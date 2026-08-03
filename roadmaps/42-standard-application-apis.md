# Standard Application APIs

## Status And Scope

**Status:** Active internal contract. `SAP01-A` through `SAP01-D`, `SAP02`, and
`SAP03` are implemented. The pure
`@flarex/standard-application-definition/v1` package
exposes canonical-program and artifact-materialization stages plus a combined
definition-preparation operation. The backend definition fixture, the corpus's
valid and materialization-failure lanes, and the `flarex-dev` developer
producer use those Standard contracts. Canonical-failure corpus cases remain
isolated with their owning decoder. `SAP01-D` machine-enforces the definition
package's direct manifest, export, and production-import boundary.
`@flarex/standard-application-analysis/v1` exposes the function-first analysis
operation over a request-scoped context, and the analyzer app provides the
first private implementation over the accepted replacement host.
`@flarex/standard-application-registration/v1` exposes the narrow inactive
registration result over the persistence-owned `FSV02` System operation, and
the private SAP04 consumer now reaches one authoritative point mutation. The
second vertical is owned by
[`44-second-flarexdb-system-api-point-query-vertical.md`](./44-second-flarexdb-system-api-point-query-vertical.md):
PQV-A1 snapshot authority, PQV-A2 query runtime/ABI, and the private SAP05
System/Standard point query are complete. None of
those gates authorizes FSV07 routing or public SDK stabilization.
The completed first internal-call capability is recorded in
[`45-private-internal-user-code-calls.md`](./45-private-internal-user-code-calls.md).
It implements only inline query-to-internal-query execution as `SAP06-A1` and
leaves every mutation call direction separately gated.

This roadmap owns the stable workspace-internal application-facing APIs that
sit between:

- developer-facing authoring APIs and code generation;
- explicit internal test definitions and deterministic corpora; and
- the existing canonical program, materializer, analyzer, registration,
  function-runtime, executor, and persistence owners.

It does not own the ergonomic public SDK, the internal test corpus or
real-system harness, canonical program semantics, artifact formats, analyzer
semantics, deployment authority, runtime capabilities, transactions, OCC,
commit behavior, persistence, or production routing.

**Standard** means a deliberately versioned internal application contract
shared by more than one producer. It does not mean public npm API,
production-routed, trusted, or independently authoritative.

## Current Sources Of Truth

Read these authorities together:

- [`39-canonical-declarative-program-contract.md`](./39-canonical-declarative-program-contract.md)
  and
  [`../packages/declarative-program/src/v1.ts`](../packages/declarative-program/src/v1.ts)
  own canonical schema and function intent, normalization, budgets, and typed
  failures;
- [`../packages/declarative-materializer/src/v1.ts`](../packages/declarative-materializer/src/v1.ts)
  owns prebuilt module-graph admission and immutable artifact-ingress
  materialization;
- [`41-private-standard-application-composition-and-real-system-harness.md`](./41-private-standard-application-composition-and-real-system-harness.md)
  owns the internal test corpus, workload model, and private real-system
  harness;
- [`43-first-flarexdb-system-api-vertical.md`](./43-first-flarexdb-system-api-vertical.md)
  owns the ordered function-first composition from the completed replacement
  analyzer port through SAP02, SAP03, readiness, activation, SAP04, and one
  authoritative point mutation;
- [`44-second-flarexdb-system-api-point-query-vertical.md`](./44-second-flarexdb-system-api-point-query-vertical.md)
  owns the separately gated private point-query sequence: scoped target-native
  snapshot authority, candidate-bound exact query runtime/ABI, then SAP05;
- [`09-sdk-and-cli-fork.md`](./09-sdk-and-cli-fork.md) owns public developer
  ergonomics, generated APIs, CLI/codegen, and distribution;
- [`17-deployment-analysis-and-push.md`](./17-deployment-analysis-and-push.md)
  owns authenticated analysis, registration, activation, and push lifecycle;
- [`40-host-neutral-function-runtime.md`](./40-host-neutral-function-runtime.md)
  owns portable function-execution semantics and host capabilities;
- [`15-test-sdk.md`](./15-test-sdk.md) owns the later public testing API; and
- [`16-package-boundaries.md`](./16-package-boundaries.md) owns workspace
  dependency direction and package extraction rules.

Exact implemented behavior remains owned by package manifests, export maps,
source, and tests. This roadmap wins only for the Standard API layer's
placement, dependency direction, composition rules, and ordered gates.

## Current Architecture

Both current producers enter the Standard definition layer:

```text
current developer path
  flarex SDK objects
    -> flarex-dev materialization-budget admission and SDK inspection
    -> Standard canonical-program stage
    -> flarex-dev legacy-policy rejection and source-package lowering
    -> Standard artifact-materialization stage

current internal test path
  backend-owned explicit fixture and corpus
    -> combined Standard definition-preparation operation
```

The Standard stages delegate to the existing canonical-program and
declarative-materializer owners without duplicating their semantics. The
combined operation composes those same stages for producers that already hold
all four raw inputs. It does not own additional cross-stage validation or
policy that staged producers could bypass.

The accepted composition is:

```text
developer API producer                 internal test API producer
  query, mutation, schema, codegen       explicit data, seeds, faults
                    \                   /
                     v                 v
             Standard Application APIs
               definition preparation
               authenticated analysis
               later registration port
               later invocation port
                         |
                         v
             existing domain/core owners
          canonical program and materializer
          analyzer, registry, runtime, executor
          OCC, commit, and persistence
```

Developer and test APIs may have different ergonomics. They must converge on
the same Standard API before downstream domain owners. Neither producer is
authority merely because it successfully constructs an inert value.

## Invariants And Trust Boundaries

1. **One canonical representation.** Standard APIs reuse the canonical
   declarative program, artifact-ingress plan, analyzer result, verified
   projection, invocation contract, and existing typed errors. They do not
   create parallel representations.
2. **Thin composition, not a second core.** A Standard API may sequence owner
   operations and name their combined stage result. It must not reimplement
   validation, canonical ordering, hashing, semantic emission, verification,
   schema lifecycle, invocation, OCC, commit, or persistence.
3. **No authority elevation.** A prepared definition is inert. It is not an
   authenticated artifact, verified registration, active revision, execution
   claim, database capability, or committed result.
4. **Capabilities appear only when real.** A Standard API must omit analysis,
   registration, query, mutation, nested call, workflow, action, or scheduling
   methods until the owning end-to-end capability exists.
5. **Exact error ownership.** Composition exposes unions of the existing owner
   errors and preserves first-failure order. It does not wrap every failure in
   a generic `StandardApplicationError`.
6. **Host neutrality.** Pure definition preparation has no Node, Vite,
   Miniflare, Cloudflare binding, network, database, Context service, Layer, or
   Effect runner.
7. **Lifecycle ownership stays downstream.** Later live APIs use Effect where
   interruption, scope, resources, foreign causes, or injected capabilities
   require it. Request, analyzer session, invocation, transaction, and Durable
   Object capabilities remain operation-scoped.
8. **No root catch-all.** Do not create `@flarex/standard`, a package-root
   barrel, a universal `Application` object, or `invoke(anything)`.
9. **Version locality.** A V1 suffix versions one contract. It does not grant
   migration, compatibility, activation, or removal authority.
10. **Public SDK independence.** The public `flarex` package does not re-export
    workspace-internal Standard APIs unless a later publication preflight
    proves the consumer and compatibility obligations.

## Decisions And Rationale

### Use A Family Of Narrow Stage APIs

Standard Application APIs are a layer, not necessarily one package. Each stage
must remain narrow enough that its dependency direction and authority are
obvious:

| Stage | Standard responsibility | Existing authority retained below it |
| --- | --- | --- |
| Definition preparation | Normalize explicit schema/function intent and materialize the prebuilt module graph | canonical declarative program and declarative materializer |
| Analysis | Submit one admitted immutable artifact to the supported replacement analyzer port | analyzer engine/host, verifier, evidence, and progress owners |
| Registration | Request registration of one verified application revision | deployment, schema/catalog, readiness, and activation owners |
| Invocation | Invoke one admitted function through an approved host-neutral contract | function runtime, executor, journal, OCC, commit, and persistence |

The first package is intentionally
`@flarex/standard-application-definition`, exported only through `./v1`.
Later stages do not automatically belong in that package. Their preflights
must first decide whether a narrow export beside an existing owner or another
small composition package produces the cleanest acyclic graph.

Definition preparation itself exposes two narrow Standard stages:

```ts
prepareStandardApplicationProgramV1(programInput, programBudget)
materializeStandardApplicationArtifactsV1(
  program,
  graphInput,
  materializationBudget,
)
```

`prepareStandardApplicationDefinitionV1` is the convenience composition for a
producer that already has both raw budgets, the program input, and the graph
input. Its ordering remains program-budget admission, program normalization,
materialization-budget admission, then artifact materialization.

The stages are necessary for the developer producer rather than optional
aliases. Its source-package graph is derived against the normalized canonical
program, so the graph input does not exist before program normalization. It
also authenticates the opaque materialization budget before SDK or source
inspection to preserve its established failure precedence and to obtain the
trusted bounds used by source-package lowering. The Standard program and
artifact stages let that producer interleave only those producer-owned steps
while sharing the same downstream contracts as the combined operation.

The combined operation must remain a composition of the exported stages. It
must not gain hidden cross-stage validation, authority, or failure policy that
a staged producer would bypass. A future invariant that genuinely spans the
two stages requires an explicit roadmap amendment and migration of every
producer; it may not be added only to the convenience operation.

### Keep Explicit Standard Data Below Developer Ergonomics

The Standard definition input is explicit data:

- schema table and logical-index declarations;
- logical modules;
- function export name, kind, visibility, argument validator, and return
  validator;
- prebuilt source modules and source maps;
- explicit logical-to-artifact entry bindings; and
- explicit deterministic budgets.

This is sufficient to represent public and internal queries, mutations,
workflow mutations, and actions as canonical metadata. It does not claim those
function kinds are all executable. Schedules remain separately owned trigger
descriptors and are not added as a function kind.

The later developer API may provide `defineTable`, `query`, `mutation`,
`internalMutation`, `action`, and generated references. The internal test API
may instead provide literal fixtures, invalid shapes, seeds, and fault plans.
Those producers lower into the same explicit Standard definition preparation
operation.

### Preserve Existing Owner Types

`SAP01-A` introduces no alternative schema, function, module, artifact, or
error model. Its input fields use:

- `CanonicalDeclarativeProgramInputV1`;
- `CanonicalDeclarativeProgramBudgetInputV1`;
- `DeclarativeV2PrebuiltModuleGraphInputV1`; and
- `DeclarativeV2MaterializationBudgetInputV1`.

Its successful result contains the exact
`CanonicalDeclarativeProgramV1` and
`DeclarativeV2ArtifactIngressPlanV1` values returned by their owners.
Its failure type is the exact union of
`CanonicalDeclarativeProgramV1Error` and
`DeclarativeV2MaterializationV1Error`.

The named Standard result groups two inert stage outputs for its callers. It
does not become a serializable application record or downstream source of
authority.

The combined operation retains the typed
`CanonicalDeclarativeProgramInputV1` field. The importable program stage accepts
`unknown` because it is the runtime normalization boundary used by the
developer SDK analyzer, whose structural validator representation is broader
at compile time than the canonical input contract. Only the canonical owner
decoder establishes `CanonicalDeclarativeProgramV1`; the stage does not cast or
weaken that decoder.

### First Package Dependency Direction

The approved first dependency graph is:

```text
@flarex/standard-application-definition
  -> @flarex/declarative-program
  -> @flarex/declarative-materializer
  -> effect                    (pure Result composition only)

flarex-dev developer adapter ---------\
                                        -> standard definition package
internal test fixture/corpus ----------/

standard definition package -X-> analysis, backend, executor, persistence
standard definition package -X-> flarex, flarex-dev, flarex-test, apps/*
```

The package exists because definition preparation is cross-owner composition
with two distinct producers: developer tooling and internal tests. Placing it
inside `flarex-dev` would make tests depend on the developer composition root.
Placing it inside `flarex-backend` would make developer tooling depend on the
backend. Placing it inside either core owner would make that owner responsible
for coordinating an adjacent domain. A broad standard package would collect
unrelated live dependencies too early.

## Convex Compatibility And Flarex Divergences

Flarex preserves Convex's developer-facing direction: developers author typed
schema and function definitions, while codegen and deployment machinery lower
them into backend-consumable forms. The Standard API is below those
ergonomics, so it is not intended to look like Convex's public `query()` or
`mutation()` surface.

Flarex diverges because portable ESM, immutable Source Artifact V2, Semantic
Artifact V1, Cloudflare isolation, explicit host capabilities, and
Postgres-authoritative schema/runtime state require a visible inert boundary
before authenticated analysis and execution. That divergence does not justify
exposing host bindings, database handles, or deployment authority through the
Standard API.

## Implemented Capabilities

`SAP01-A` provides:

- the workspace-internal
  `@flarex/standard-application-definition/v1` export;
- `prepareStandardApplicationDefinitionV1`, which preserves the documented
  program-budget, program-decode, materialization-budget, and materialization
  first-failure order through Effect v4 `Result`;
- the exact existing canonical program, artifact-ingress plan, and two owner
  error types without a generic Standard error wrapper; and
- the first backend definition-fixture success consumer.

`SAP01-B` moves valid and materialization-failure corpus evaluation onto that
operation while retaining canonical-failure isolation, stable case IDs, replay
policy, expected projections, and test-owned fixture allocation.

`SAP01-C` provides the two producer-stage operations used by the combined
operation and migrates `flarex-dev` to them. SDK analysis, unsupported legacy
auth-field rejection, opaque materialization-budget precedence,
source-package validation, `.js` binding policy, and graph construction remain
developer-producer responsibilities. Canonical program normalization and final
artifact materialization now enter the same Standard contracts used by the
internal test producer.

The reusable lower-level capabilities remain:

- bounded canonical schema and function normalization in
  `@flarex/declarative-program/v1`;
- bounded prebuilt module-graph admission and deterministic artifact-ingress
  materialization in `@flarex/declarative-materializer/v1`;
- a test-local direct definition seed and deterministic valid/invalid corpus;
  and
- a developer-tooling adapter that lowers SDK definitions and source packages
  around the two pure Standard stages.

The lower-level capabilities remain independent owners rather than being
absorbed into the Standard package.

`SAP02` provides:

- the narrow `@flarex/standard-application-analysis/v1` export and
  `analyzeStandardApplicationV1(preparedDefinition, analysisContext)`;
- the exact accepted analyzer registration-complete success value without a
  parallel Standard analysis representation;
- exact propagation of the context's typed failure and requirement channels;
- request/analyzer-session Scope ownership rather than a global analyzer
  singleton;
- the first private live adapter in `apps/analyzer`, which sequences only the
  accepted host's authenticated execute and rehydrate inputs and rejects empty
  or non-registration terminal plans; and
- developer and private-test convergence on the same Standard operation
  without giving developer tooling analyzer authority or enabling production
  routing.

`SAP03` provides:

- the narrow
  `registerStandardApplicationRevisionV1(verifiedAnalysis, requestKey,
  registrationContext)` operation;
- a stable result containing only registration status, revision identity,
  schema-version identity, and the database-authoritative registration
  timestamp;
- exact propagation of the System registration error and Scope channels rather
  than a parallel Standard error hierarchy;
- private paired request-owned analysis and registration contexts in the
  analyzer app, with opaque context-owned candidate/producer authority and
  exact-result correlation that cannot be reconstructed or cloned from the
  public SAP02 projection; and
- the private FSV02-A1 adapter over one backend-owned, definition-correlated
  authenticated registration-evidence capability, so the Standard composition
  never manufactures the candidate or terminal producer receipt structurally;
  exact replay retains the same opaque handle and Scope release invalidates it;
  and
- durable inactive registration through `FSV02` without exposing candidate,
  attempt, artifact, function, validator, handler, or registration-root
  evidence through the Standard result.

## Known Gaps And Limitations

- SAP03 registers only an authenticated inactive revision. Target-native
  readiness, replacement activation, active-revision reading, and invocation
  remain separate unimplemented capabilities.
- The host-neutral runtime currently proves only its admitted point-mutation
  scope; general query, internal call, workflow, action, and scheduling
  operations are not available.
- No general package-DAG check currently enforces every Standard API
  dependency rule. `SAP01-D` first makes the implemented definition package's
  direct manifest, export, and production-import boundary executable without
  claiming repository-wide graph coverage.

## Target Direction

Build Standard Application APIs capability by capability:

```text
explicit definition
  -> prepared canonical program and artifact ingress
  -> authenticated analysis result
  -> verified registered revision
  -> admitted function invocation
  -> bounded runtime and authoritative outcome
```

Each arrow is a separately owned transition with its own typed failures and
trust boundary. Developer and test APIs share these transitions without
sharing ergonomics, fault policy, or lifecycle ownership.

## Next Correctness Gates

### Implemented `SAP01-A`: Pure Standard Definition Preparation

Create the workspace-internal
`@flarex/standard-application-definition` package with one explicit `./v1`
export and one operation:

```ts
prepareStandardApplicationDefinitionV1(input)
  -> Result<
       PreparedStandardApplicationDefinitionV1,
       CanonicalDeclarativeProgramV1Error
         | DeclarativeV2MaterializationV1Error
     >
```

The input groups the four existing raw inputs named above. The operation must
execute this exact first-failure order:

1. create/admit the canonical-program budget;
2. decode and normalize the canonical program;
3. create/admit the materialization budget; and
4. materialize the existing prebuilt module graph against that program.

The success value contains only:

```ts
{
  program: CanonicalDeclarativeProgramV1;
  artifactIngressPlan: DeclarativeV2ArtifactIngressPlanV1;
}
```

The slice must:

1. call the four existing owner operations rather than reproduce their logic;
2. preserve their exact success values, typed errors, validation order,
   canonical bytes, source bytes, source maps, usage, and allocation rules;
3. keep the operation pure and expressed as Effect v4 `Result` composition;
4. add focused valid, canonical-failure, materialization-failure,
   deterministic-output, and fresh-input tests;
5. migrate only the existing `orders` definition-fixture success test to the
   new operation as the first external consumer; and
6. leave the corpus, `flarex-dev`, analyzer, backend production source,
   runtime, executor, persistence, manifests outside the new package,
   routes, bindings, configuration, and activation unchanged.

The implementation allowlist is:

- `packages/standard-application-definition/package.json` (new);
- `packages/standard-application-definition/tsconfig.json` (new);
- `packages/standard-application-definition/src/v1.ts` (new);
- `packages/standard-application-definition/test/v1.test.ts` (new);
- `packages/flarex-backend/package.json` for a development-only dependency;
- `packages/flarex-backend/test/privateStandardApplication/definitionFixtureV1.test.ts`;
- `pnpm-lock.yaml` only as required by the workspace dependency; and
- this roadmap and package-boundary/index roadmaps for durable corrections.

Exit criteria:

- the new package typecheck and focused tests pass;
- declarative-program and materializer focused tests remain green;
- the migrated backend fixture test proves the same semantic and source
  outputs through the Standard API;
- `flarex-backend` typecheck passes;
- package exports work from a fresh workspace consumer; and
- both standing reviewers accept the final significant code/test diff.

### Implemented `SAP01-B`: Move The Internal Corpus Onto The Standard Definition API

After `SAP01-A`, valid and materialization-failure corpus evaluation uses the
Standard operation. Canonical-failure cases may either use the Standard
operation or continue calling the canonical owner directly when the test must
isolate that owner's exact failure. The corpus remains test-owned and retains
stable IDs, replay policy, expected projections, and fresh allocation.

This gate must delete the duplicated composition sequence in the migrated
tests. It must not move corpus policy into the Standard package.

### Implemented `SAP01-C`: Move The Developer Producer Onto The Same API

The `flarex-dev` adapter retains SDK inspection, legacy-policy rejection,
source-package validation, `.js` binding convention, UTF-8 encoding, and
producer-specific typed failures. Its established dependency and failure order
is:

1. authenticate the opaque materialization budget before SDK or source reads;
2. inspect the SDK definition and construct the candidate program input;
3. normalize that candidate through
   `prepareStandardApplicationProgramV1`;
4. reject unsupported legacy auth source fields;
5. lower the source package into a graph against the canonical program; and
6. materialize through `materializeStandardApplicationArtifactsV1`.

The two Standard stages preserve the core-owner outputs and typed failures.
They do not move SDK/source policy into the Standard package. The combined
definition operation composes the same stages for internal test producers that
already have all inputs. Focused parity and hostile-budget tests preserve the
developer prebuild output and first-failure order. This gate does not publish
the Standard package or redesign the public SDK.

### Implemented `SAP01-D`: Enforce The Definition Package Boundary

One repository check for the accepted
`@flarex/standard-application-definition` boundary now fails when:

1. the package exposes a root or any export other than `./v1`;
2. its runtime dependency surface differs from
   `@flarex/declarative-program`, `@flarex/declarative-materializer`, and
   `effect`;
3. a production source file imports a non-relative module outside the exact
   two owner subpaths and `effect`, or a relative module outside its own source
   root; or
4. optional or peer runtime dependencies silently widen the package graph; or
5. a symbolic link or unsupported filesystem entry could make production
   source discovery skip content.

The checker owns only static package/source policy. It does not resolve the
complete transitive workspace graph, inspect test imports, ban future local
source modules, or make a later analysis, host, registry, runtime, executor, or
persistence dependency valid. Its pure fixture API and CLI filesystem adapter
must remain separate so allowed and rejected manifests, exports, static
imports, direct CommonJS loads and resolution references, dynamic imports,
JSDoc and TypeScript type imports, reference directives, path containment, and
filesystem entry classification are testable without mutating the workspace.

The implementation remains limited to:

- `scripts/check-standard-application-definition-boundaries.mjs` (new);
- `scripts/check-standard-application-definition-boundaries.test.js` (new);
- root `package.json` for normal check, test, and script-typecheck wiring;
- this roadmap and
  [`16-package-boundaries.md`](./16-package-boundaries.md); and
- no production package, application, route, binding, deployment, or
  activation changes.

This is the first bounded checkpoint toward the general package-dependency
checker in roadmap 16. It must not mark that broader gate complete.

### Later Capability Gates

| Gate | Outcome | Entry condition |
| --- | --- | --- |
| `SAP03` | **Complete:** narrow Standard inactive-registration operation over the implementation-bearing System Schema function; slices `FSV02` and private evidence prerequisite `FSV02-A1` | Implemented with backend-owned opaque authenticated evidence, private exact-result correlation, and a narrow durable projection |
| `SAP04` | **Complete privately:** narrow Standard point-mutation invocation over the implementation-bearing System Application Data function; slice `FSV06` | Implemented over coherent FSV05 selection, C03-V validation, FSV06-A1 exact runtime dispatch, and the existing C07 owners; no route, production caller, or public SDK stabilization is implied |
| `SAP05` | **Complete privately:** thin Standard point-query consumer over `invokeApplicationPointQueryV1` returning only the validated value | Implemented over the coherent FSV05 active reader, PQV-A1 snapshot authority, PQV-A2 candidate-bound R2/Workerd query runtime, and zero-mutation-publication proof; no route, production caller, or public SDK stabilization is implied |
| `SAP06-A1` | **Complete privately:** one public/internal query handler calls one registered internal query inline | Separate private target/profile/ABI binds the same candidate and PQV-A1 snapshot; SAP05 selects it as the sole query runtime path; no child transaction, outcome, route, or public internal-function invocation |
| `SAP06-A2+` | Add mutation-to-internal-query, mutation-to-internal-mutation, workflow, action, and schedule operations individually | each capability has an implemented owner contract and focused preflight; query-to-mutation remains forbidden |

Stop and amend this roadmap before implementation if a slice would create a
second canonical/application/artifact/error representation, add a catch-all
package, introduce a dependency cycle, expose a public SDK API, absorb
producer-specific SDK or test policy, import a host or persistence owner into
the definition package, or claim an unsupported live capability.
