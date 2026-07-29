# Standard Application APIs

## Status And Scope

**Status:** Accepted direction. The current repository has the canonical
declarative-program and artifact-materialization cores, plus direct developer
and test adapters that call those owners. It does **not** yet have a cohesive
Standard Application API layer. The first pure definition-and-materialization
slice, `SAP01-A`, is specified below as the next implementation gate. Preserve
its change ownership separately from the `SAC01-B1` test-corpus slice.

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

The existing call paths bypass a Standard API:

```text
current developer path
  flarex SDK objects
    -> flarex-dev SDK inspection and source-package adapters
    -> @flarex/declarative-program/v1
    -> @flarex/declarative-materializer/v1

current internal test path
  backend-owned explicit fixture and corpus
    -> @flarex/declarative-program/v1
    -> @flarex/declarative-materializer/v1
```

The lower-level contracts are real and implemented, but their existence does
not make them the Standard Application API. They are the core owners that a
Standard API must compose without duplicating.

The accepted target is:

```text
developer API producer                 internal test API producer
  query, mutation, schema, codegen       explicit data, seeds, faults
                    \                   /
                     v                 v
             Standard Application APIs
               definition preparation
               later analysis port
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

The Standard Application API layer itself has no implemented package or
export yet.

The reusable lower-level capabilities already exist:

- bounded canonical schema and function normalization in
  `@flarex/declarative-program/v1`;
- bounded prebuilt module-graph admission and deterministic artifact-ingress
  materialization in `@flarex/declarative-materializer/v1`;
- a test-local direct definition seed and deterministic valid/invalid corpus;
  and
- a developer-tooling adapter that currently lowers SDK definitions and source
  packages directly into the two core owners.

These are prerequisites and migration inputs, not evidence that the Standard
API already exists.

## Known Gaps And Limitations

- No `@flarex/standard-application-definition` package or `./v1` export exists.
- Test fixtures and `flarex-dev` still duplicate the sequence that admits
  budgets, normalizes a program, and materializes an artifact-ingress plan.
- The developer adapter performs additional SDK inspection and source-package
  lowering that must stay producer-owned; only its final core composition is a
  candidate for the Standard API.
- No supported replacement analyzer port is ready for a Standard analysis API.
- No approved application-revision/schema-lifecycle adapter is ready for a
  Standard registration API.
- The host-neutral runtime currently proves only its admitted point-mutation
  scope; general query, internal call, workflow, action, and scheduling
  operations are not available.
- No package-DAG check currently enforces every Standard API dependency rule.

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

### `SAP01-A`: Pure Standard Definition Preparation

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

### `SAP01-B`: Move The Internal Corpus Onto The Standard Definition API

After `SAP01-A`, valid and materialization-failure corpus evaluation uses the
Standard operation. Canonical-failure cases may either use the Standard
operation or continue calling the canonical owner directly when the test must
isolate that owner's exact failure. The corpus remains test-owned and retains
stable IDs, replay policy, expected projections, and fresh allocation.

This gate must delete the duplicated composition sequence in the migrated
tests. It must not move corpus policy into the Standard package.

### `SAP01-C`: Move The Developer Producer Onto The Same API

The `flarex-dev` adapter retains SDK inspection, legacy-policy rejection,
source-package validation, `.js` binding convention, UTF-8 encoding, and
producer-specific typed failures. After it has produced the four explicit
inputs, its final program/materializer composition delegates to the Standard
operation.

This gate must prove parity with the current developer prebuild output and
failure order. It does not publish the Standard package or redesign the public
SDK.

### Later Capability Gates

| Gate | Outcome | Entry condition |
| --- | --- | --- |
| `SAP02` | Narrow Standard analysis operation over the supported replacement analyzer port | A1b2 exposes one accepted complete analyzer port |
| `SAP03` | Narrow Standard verified-registration operation for one application revision | schema/catalog publication, readiness, and registration composition are approved |
| `SAP04` | Narrow Standard point-mutation invocation operation | host-neutral runtime and foundation `C07` are assembled through the real owner path |
| `SAP05+` | Add query, internal call, workflow mutation, action, and schedule operations individually | each capability has an implemented owner contract and focused preflight |

Stop and amend this roadmap before implementation if a slice would create a
second canonical/application/artifact/error representation, add a catch-all
package, introduce a dependency cycle, expose a public SDK API, absorb
producer-specific SDK or test policy, import a host or persistence owner into
the definition package, or claim an unsupported live capability.
