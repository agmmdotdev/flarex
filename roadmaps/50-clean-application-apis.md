# Clean Application APIs Preflight

## Status And Decision Boundary

**Status:** Accepted workspace-internal migration roadmap. `CAPI-A` through
`CAPI-D` are complete privately. `CAPI-E` is in progress through bounded
removal checkpoints; its system-test product-surface removal is implemented
privately, validated, and reviewed on 2026-08-29.

The user approved the `CAPI-A` implementation slice on 2026-08-28. That slice
adds `@flarex/application-definition`, its clean opaque authoring handles, pure
`prepareApplication` composition, deterministic create/query lowering, and
focused boundary tests. The user approved `CAPI-B` on the same date. That slice
migrates the `flarex-dev` SDK/source-package producer and the reusable
system-test definition producer onto `prepareApplication`, adds the clean
source-production bridge, and removes the displaced raw developer adapters.
The user approved `CAPI-C` on the same date. That slice adds the clean
`@flarex/application-invocation` root with separate typed query, mutation, and
Action operations over the existing live owners and migrates the smallest
PGlite query consumer. It does not authorize system-test facade naming, broad
simulation migration, public, or production gates.
The user approved `CAPI-D` on the same date. That slice adds plain system-test
subpaths and names, delegates typed scenario calls through the clean invocation
operations, migrates the English-learning and cooking simulations, and removes
the displaced create/read definition assembler. It does not remove the retained
versioned product exports or authorize public or production gates.

This preflight defines a clean, unversioned workspace-internal entry surface
for application definition and invocation. It responds to the current
simulation and test experience, where application authors must see or assemble
canonical-program inputs, materialization budgets, module-graph bindings,
artifact paths, source bytes, and compatibility-named invocation wrappers.

The target uses plain current-product names. It does not introduce `V2`, a
second Standard generation, chronology suffixes, or compound version names.
Concrete wire, persisted, manifest, receipt, codec, and source-artifact
contracts may retain their existing versions because exact decoding and
migration compatibility require them. Those versions remain below the clean
Application APIs.

Beyond the completed `CAPI-A` through `CAPI-D` slices, this roadmap does not authorize package
renames, public SDK changes, routes, bindings, deployment, production routing,
schemas, migrations, runtime changes, compatibility aliases, fallbacks,
comparison execution, or dual writes.

## Current Sources Of Truth

Read this preflight with:

- [`42-standard-application-apis.md`](./42-standard-application-apis.md) for the
  existing Standard layer and historical capability gates;
- [`41-private-standard-application-composition-and-real-system-harness.md`](./41-private-standard-application-composition-and-real-system-harness.md)
  for simulation ownership and real-system evidence;
- [`49-application-analysis-migration.md`](./49-application-analysis-migration.md)
  for the current Application Analysis and consumer authority;
- [`../packages/standard-application-definition/src/v1.ts`](../packages/standard-application-definition/src/v1.ts),
  [`authoringV1.ts`](../packages/standard-application-definition/src/authoringV1.ts),
  and
  [`applicationSource.ts`](../packages/standard-application-definition/src/applicationSource.ts)
  for current definition, typed-authoring, and source-production behavior;
- [`../packages/standard-application-invocation/src/ApplicationQuerySystem.ts`](../packages/standard-application-invocation/src/ApplicationQuerySystem.ts),
  [`ApplicationMutationSystem.ts`](../packages/standard-application-invocation/src/ApplicationMutationSystem.ts),
  and
  [`ApplicationActionSystem.ts`](../packages/standard-application-invocation/src/ApplicationActionSystem.ts)
  for the current unversioned live owners; and
- [`../packages/system-test/src/environment/applicationEnvironment.ts`](../packages/system-test/src/environment/applicationEnvironment.ts)
  plus
  [`../packages/system-test/src/simulation/applicationSimulation.ts`](../packages/system-test/src/simulation/applicationSimulation.ts)
  for the current private orchestration and simulation-authoring boundaries.

Code, package manifests, and tests remain the exact-behavior authorities. This
preflight owns only the target product naming, facade boundaries, package
direction, migration order, and stop conditions.

## Current Problem

The current implementation has already established the correct downstream
owners:

- `ApplicationQuerySystem` owns current query selection, snapshots, source
  loading, Worker execution, and validated results;
- `ApplicationMutationSystem` owns current mutation admission, request-key
  correlation, grants, journals, OCC, commit, outcomes, feeds, and outbox;
- `ApplicationActionSystem` and the Task owners retain their distinct durable
  and external-effect semantics; and
- canonical program, materializer, Application Analysis, persistence, executor,
  and protocol packages retain their exact authorities.

The problem is the ingress surface above those owners:

1. `standardV1` combines validators, schema authoring, function contracts,
   modules, and references under a chronology-shaped namespace.
2. `StandardApplicationDefinitionInputV1` exposes four infrastructure inputs:
   program policy, program data, materialization policy, and graph data.
3. System simulations manually bind logical modules to artifact paths and
   source bytes and calculate limits that should be producer or host policy.
4. The test environment imports unversioned Application systems but calls them
   through compatibility-named `invokeStandardApplication...V1` wrappers.
5. Package subpaths such as `./v1`, `./simulation/v1`, and `./environment/v1`
   make current product APIs look like coexistence contracts even when no
   supported second generation exists.

The result is real conceptual leakage. The complexity is not proof that query,
mutation, or schema semantics must be merged. It is evidence that source and
contract preparation need one facade and that tests should consume the same
facade instead of manufacturing lower-level inputs.

## Accepted Shape

```text
developer producer                         system-test producer
  SDK modules and files                      explicit fixture modules
          \                                      /
           -> clean Application Definition API <-
                    defineApplication
                    defineSchema / defineTable
                    defineModule
                    query / mutation / action
                    typed references
                             |
                             v
               existing canonical lowerings
          program -> materializer -> source artifact
                             |
                             v
                 Application Analysis authority
                             |
                             v
                  active Application selection
                             |
                             v
              clean Application Invocation API
                  runQuery / runMutation
                  runAction / Task entry ports
                             |
                             v
               existing runtime and data owners
       query snapshot | mutation OCC/commit | action/task
```

There are two API packages, not a universal core package:

1. `@flarex/application-definition` owns pure inert application authoring and
   preparation composition.
2. `@flarex/application-invocation` owns clean live invocation entry operations
   over the existing separate Application systems.

`@flarex/system-test` remains a consumer and composition root. The public
`flarex` SDK and `flarex-dev` remain developer producers. No production owner
may depend on the system-test package.

## Definition API

### Target Export

The target package has one unversioned supported export. It exposes only plain
current names:

```ts
import {
  action,
  defineApplication,
  defineModule,
  defineSchema,
  defineTable,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  sourceModule,
  v,
  workflowMutation,
  type ApplicationDefinition,
  type ApplicationModule,
  type FunctionReference,
  type InferFunctionArgs,
  type InferFunctionReturn,
} from "@flarex/application-definition";
```

No exported name contains `Standard`, `V1`, `V2`, `Point`, `Declarative`,
`Canonical`, `ArtifactIngress`, or `Materialization`. Those are downstream
owner and concrete-contract concepts, not application authoring concepts.

### Target Use

The private authoring shape should read like application intent:

```ts
const recipeModule = defineModule({
  path: "recipes",
  source: sourceModule({
    path: "functions/recipes.js",
    bytes: recipeSource,
  }),
  functions: {
    get: query({
      args: v.object({ id: v.id("recipes") }),
      returns: v.nullable(recipeDocument),
    }),
    create: mutation({
      args: recipeInput,
      returns: v.id("recipes"),
    }),
  },
});

export const cooking = defineApplication({
  schema: defineSchema({
    recipes: defineTable(recipeFields)
      .index("by_difficulty", ["difficulty"]),
  }),
  modules: [recipeModule],
});
```

This example fixes the intended responsibility, not the final implementation
mechanics:

- one module owns its logical path, function contracts, typed references, and
  one opaque owned source-module value;
- the definition owns schema and module membership;
- logical module-to-source correlation is established once;
- the application author does not provide budgets, canonical formats, graph
  roles, execution paths, schema paths, function-entry arrays, or artifact
  bindings; and
- functions remain inert metadata. They do not contain database capabilities,
  active selection, invocation authority, or executable host state.

`sourceModule` is the lowest clean boundary at which an explicit fixture may
provide bytes. It defensively owns those bytes and validates only source-module
shape. Node file reading, Vite inspection, source-package policy, and source-map
discovery remain producer adapters. A later public developer API continues to
author ordinary files and handlers; it does not ask developers to pass bytes.

### Preparation Boundary

Application preparation is a separate pure operation below ordinary authoring:

```ts
prepareApplication(definition, policy)
  -> Result<PreparedApplication, ApplicationPreparationError>
```

`policy` is selected by trusted developer tooling, analysis composition, or the
system-test lane. It is not a member of `ApplicationDefinition`. The operation
calculates the exact lower-level program and materialization bounds required by
the selected policy, delegates to the existing canonical program and
materializer owners, and returns an inert prepared value.

`ApplicationPreparationError` is a type alias over the exact owner failures,
not a generic tagged wrapper. Validation and first-failure order remain
unchanged. The implementation stays pure and uses Effect v4 `Result`; it does
not introduce a service, Layer, runtime, or Promise bridge.

The prepared value may contain existing versioned canonical program and
artifact contracts internally. Those concrete types are not re-exported as the
ordinary authoring result and do not leak back into system simulation configs.

## Invocation API

### Target Export

The invocation package exposes separate named operations from one unversioned
package root:

```ts
import {
  runAction,
  runMutation,
  runQuery,
  type ActionResult,
  type MutationOutcome,
} from "@flarex/application-invocation";
```

The first supported calls are:

```ts
runQuery(reference, args, { identity })
runMutation(reference, args, { requestKey })
runAction(reference, args, { requestKey })
```

They are reusable `Effect.fn` operations with exact success, failure, and
requirement channels. They delegate to `ApplicationQuerySystem`,
`ApplicationMutationSystem`, and `ApplicationActionSystem`. They do not merge
those services, share a generic error, or route through `invoke(kind, input)`.

The package must not export a universal `Application`, `ApplicationCore`,
`ApplicationSystem`, `invoke`, `execute`, or `run` object. A package root with
several exact named operations is discoverable; a catch-all authority object is
not.

### Input Representation

Queries and mutations do not accept arbitrary bytes as their semantic API:

- a function is selected by an opaque typed `FunctionReference`;
- arguments are ordinary values inferred from the reference contract;
- the invocation owner normalizes and validates those values into the existing
  canonical Flarex runtime-value domain exactly once;
- queries may receive the currently supported identity and invocation Scope but
  no mutation request key;
- mutations receive a request key because durable replay and outcome
  correlation are part of their contract; and
- action and Task entry remain separate because external-effect uncertainty and
  durable run lifecycle are not mutation semantics.

The first root mutation and action facade does not add a caller-chosen identity
parameter that their current root owners do not support. Authenticated Task and
callback mutations continue through their issuer-owned specialized ports. A
later root-authentication surface requires its own authority and compatibility
preflight.

Versioned bytes, semantic byte counts, digests, and Worker request envelopes
appear only after admission at protocol, source-artifact, persistence, and host
boundaries. The clean API never treats raw bytes as proof of schema validity,
function authority, identity, active selection, or commit authority.

### Result Representation

- `runQuery` returns the function's validated value.
- `runMutation` returns `MutationOutcome<Value>` because commit sequence,
  published-versus-replayed disposition, and authoritative outcome identity are
  real core semantics. A later developer adapter may project only `value`.
- `runAction` preserves the existing completed/non-completed result contract;
  it does not disguise uncertainty as a mutation outcome.
- Task creation, delivery, run reads, logs, and subscriptions remain separately
  named APIs and are not included in the first cleanup slice.

## Naming Rules

1. Accepted current product and operation names are unversioned.
2. Do not add `V2` replacements. Migrate the accepted current implementation to
   its plain name.
3. Keep version suffixes only on exact wire, persisted, envelope, manifest,
   receipt, codec, source-artifact, or migration contracts that can coexist or
   require exact decoding.
4. Do not expose those concrete contract suffixes through ordinary application
   authoring or invocation names.
5. Use `Legacy...` only for a displaced implementation that must remain for a
   proven compatibility consumer. Code presence and tests alone do not prove
   that obligation.
6. Do not retain old and new current paths as fallbacks or comparison
   authorities. Each consumer migrates once.
7. Remove `Point` from the application-facing operation names. The current
   implementation may support a bounded point vertical internally, but the
   semantic API operation is a query or mutation and admits only capabilities
   actually present in its selected function/runtime contract.
8. Test APIs use plain `defineSimulation`, `runSimulation`, `Simulation`,
   `SimulationClient`, `DatabaseLane`, and `AuthoritativeInspection` names.
   Fault operations remain visibly test-only and explicitly named.

## Ownership And Effect Boundaries

| Concern | Owner | Clean API responsibility |
| --- | --- | --- |
| Validators, tables, indexes, modules, references | Application Definition | Pure owned metadata and type inference |
| Program normalization and graph materialization | Existing canonical owners | Invoked by `prepareApplication`; never reimplemented |
| Source files and bundling | `flarex-dev` or test producer | Produce owned source-module inputs |
| Analysis, manifest, and receipt | Application Analysis | No authority is added by definition preparation |
| Active selection | Activation repository | Invocation reads or receives issuer-owned selection |
| Query snapshot and reads | Query system and persistence | `runQuery` delegates with Scope |
| Mutation journal, OCC, commit, outcome, feed, outbox | Mutation system, executor, persistence | `runMutation` delegates unchanged |
| Action effect uncertainty | Action system | `runAction` delegates unchanged |
| Durable Task lifecycle | Task domain and providers | Separate future clean entry APIs |
| Simulation setup, faults, inspection, lanes | `@flarex/system-test` | Test-only composition over the same clean APIs |

Pure definition constructors remain ordinary TypeScript. Pure recoverable
preparation remains `Result`. Live invocation remains Effect-native with named
`Effect.fn` entry operations, precise tagged failures, injected Context
services, and Scope-owned request resources. Layer construction owns service
composition only; it does not execute application business operations.

## Package Direction

```text
@flarex/application-definition
  -> schema-definition and canonical preparation owners
  -> effect Result only
  -X-> backend, executor, persistence, system-test, apps

@flarex/application-invocation
  -> Application query/mutation/action and their required owners
  -X-> system-test

flarex-dev -----------------------------> application-definition
@flarex/system-test -> application-definition + application-invocation
production owners ----------------------X-> @flarex/system-test
```

Whether the two existing `@flarex/standard-application-*` package directories
are renamed in place or replaced atomically is an implementation-preflight
inventory decision. The target package names above are fixed; do not create
permanent bridge packages. If no supported external consumer exists, migrate
workspace imports and rename atomically. If a supported external consumer is
proven, retain the smallest explicit `Legacy...` adapter behind an internal
compatibility subpath until its removal gate passes.

## Ordered Implementation Gates

### `CAPI-A` — Definition facade

**Status:** Complete privately on 2026-08-28. The clean package is not yet a
public SDK or production entry surface, and the legacy package remains only as
the bounded implementation dependency scheduled for removal by later gates.

Add the clean pure authoring model and `prepareApplication` while delegating to
the existing validator, schema, canonical program, and materializer owners.
Migrate only the smallest create/query definition fixture. Do not change
analysis, source publication, runtime, persistence, or invocation.

Exit criteria:

- the fixture contains no direct canonical-program, materializer, graph-role,
  artifact-binding, or budget construction;
- module/function/source correlation is established once;
- type inference, runtime ownership, exact lowerings, and failure order are
  pinned by focused tests; and
- no versioned product API is added.

### `CAPI-B` — Definition consumers and source production

**Status:** Complete privately on 2026-08-28. `flarex-dev` now owns one clean
SDK/source-package adapter that produces an opaque `ApplicationDefinition`,
enters `prepareApplication`, and delegates source generation through
`produceApplicationSource`. Its displaced declarative-program and materializer
entry points, raw graph inputs, paired budget inputs, and direct tests are
removed. The reusable system-test create/read producer now returns the same
opaque definition, while the runner owns preparation policy and uses the same
source-production path.

The existing task-publication fixture still consumes the displaced prepared
definition contract. `withLegacyPreparedApplication` is the sole explicit
callback bridge from the clean prepared value to that downstream owner, and it
is exposed only through `@flarex/application-definition/internal/preparation`,
not the clean package root. It does not prepare, compare, fall back, or add a
second definition path. Its removal belongs to the later downstream-consumer
migration gate.

Preparation policy is admitted and snapshotted once by the clean owner before
the SDK or source-package adapter reads producer input. The admitted handle is
then reused by core preparation. The SDK adapter bounds the complete source
module container and proves source and source-map byte totals before allocating
their byte arrays. Simulation typed-reference checks are derived from the same
admitted prepared program used for analysis and registration; there is no
side-channel definition catalog.

Migrate `flarex-dev` and the reusable system-test definition producer to the
clean definition facade. Producer-specific file, SDK, graph, and diagnostic
policy remains outside the definition owner. Remove migrated raw-input helpers;
do not retain dual definition paths.

Exit criteria:

- developer and test producers converge on `prepareApplication`;
- system simulations do not expose `programBudgetInput`, `programInput`,
  `materializationBudgetInput`, or `graphInput`;
- source bytes are visible only inside producer/source-module adapters; and
- Application Analysis receives byte-for-byte and semantic-equivalent source
  artifacts through the existing authority path.

### `CAPI-C` — Invocation facade

**Status:** Complete privately on 2026-08-28. The new
`@flarex/application-invocation` package exposes only `runQuery`,
`runMutation`, and `runAction` from one unversioned root. Each named
`Effect.fn` delegates directly to its existing unversioned Application System,
retains all owner failures and the exact Scope requirement, and adds only a
typed `ApplicationResultContractError` when the caller's opaque local reference
disagrees with the authoritative runtime result. Query and Action results are
returned by identity after that local contract check. The
mutation facade decodes the owner's authenticated canonical JSON result into
the contract's runtime value while retaining the authoritative scope, epoch,
commit sequence, and replay disposition. No generic dispatcher or new
authority exists.

The local result check proves runtime shape only. In particular, an authored
`Id<Table>` remains a table hint for inputs, while inferred invocation results
expose it as `string`; the facade has no active table-ID authority and does not
pretend otherwise. Mutation mismatch errors retain the original committed
outcome by identity, and completed Action mismatch errors retain the original
completed result, so a stale local contract cannot hide already-published work
or invite an evidence-free retry.

The application-native query PGlite harness is the first real-system consumer
of the clean query facade and proves a mismatched local result contract is
rejected after real execution. The definition owner now issues runtime-
inspectable, compile-time-opaque function references. This check validates
result shape; it does not make local authoring metadata activation authority.
A boundary checker pins the clean invocation package to the definition facade
and its exact reference-inspection bridge, the three exact internal system
owner subpaths, Effect, and the required protocol identity, transaction,
validator, and value owners.
Existing Standard invocation exports remain temporary migration dependencies
until the later removal gate.

Add `runQuery`, `runMutation`, and `runAction` as thin Effect-native consumers
of the existing unversioned systems. Migrate the smallest typed invocation
consumer first. Do not change query snapshots, mutation admission, journals,
OCC, commit, outcomes, action uncertainty, or host execution.

Exit criteria:

- each operation has a distinct typed failure and requirement channel;
- query has no mutation request key or durable outcome;
- mutation preserves replay and authoritative outcome evidence;
- action preserves uncertainty semantics; and
- no generic kind switch, catch-all error, or shared transaction is created.

### `CAPI-D` — System-test facade and simulations

**Status:** Complete privately on 2026-08-28. Plain system-test subpaths now
expose `defineSimulation`, `runSimulation`, `SimulationClient`,
`DatabaseLane`, and `AuthoritativeInspection`. English-learning and cooking
author their applications directly through the clean definition API and invoke
ordinary operations through the clean invocation facade; malformed calls remain
on explicit unsafe test operations. The old product exports remain only for the
separately gated `CAPI-E` removal inventory.

The retained `/environment/v1` runner remains an exact compatibility quarantine
rather than sharing the new client adapter. This temporary duplication avoids
changing its lifecycle or failure behavior before the `CAPI-E` consumer
inventory; `CAPI-E` removes that displaced runner instead of creating a lasting
second composition owner.

Move `@flarex/system-test` to plain subpaths and names. Migrate the independent
English-learning simulation before the large cooking simulation, then migrate
cooking without changing scenario assertions, fault behavior, execution counts,
or authoritative-state evidence.

Exit criteria:

- simulations import no `/v1` Application product subpaths;
- ordinary scenarios use typed references and clean invocation operations;
- intentionally invalid calls remain behind visibly unsafe test-only methods;
- `makeCreateAndReadDefinitionV1` and equivalent migrated assemblers are
  deleted; and
- PGlite and genuine PostgreSQL lanes retain their current evidence meaning.

### `CAPI-E` — Versioned product-surface removal

**Status:** In progress privately on 2026-08-29. The first bounded checkpoint
removes the four versioned `@flarex/system-test` product subpaths, deletes the
duplicate compatibility runner and simulation definition, and makes the plain
environment, inspection, lane, and simulation names the direct implementation.
The private simulation authoring value and in-memory run receipt no longer
carry an unneeded chronology field. Concrete Task, protocol, persistence, and
receipt contracts retain their exact versions. Invocation and definition
product-surface removals remain separate checkpoints.

Inventory every workspace and supported external consumer, then remove the
displaced versioned product exports and names. Keep only concrete versioned
protocol and persistence contracts required by exact decoding or migration.

Exit criteria:

- no supported current Application definition, invocation, or system-test API
  is exported from a `/v1` product subpath;
- no current product type or function has a chronology suffix;
- no fallback, comparison path, dual producer, or dual invocation authority
  remains; and
- package-boundary checks enforce the final dependency graph.

Stop after each gate for focused validation and review. Later public SDK and
public test API work remains owned by roadmaps 09 and 15 and requires separate
approval.

## Validation Plan For Implementation

For each code gate:

- package typecheck and focused unit tests for every touched owner;
- `pnpm lint:core` and `pnpm lint:diff` before significant review;
- relevant package-boundary and Effect-boundary checks;
- the smallest PGlite real-system lane that traverses the changed facade;
- genuine PostgreSQL when the gate claims transaction, locking, migration, or
  full real-system parity; unavailable PostgreSQL must be reported, not
  inferred; and
- both standing reviewers before every significant commit, followed by the
  main thread's exact staged lint gate.

The final cooking migration must prove unchanged query values, mutation
outcomes, replay dispositions, commit sequences, rows, revisions, feeds,
outbox, runtime-execution counts, action uncertainty, Task behavior, and fault
evidence. Passing by weakening assertions or reproducing shared system logic in
the test package is forbidden.

## Explicit Non-Goals

- no rewrite of FlarexDB storage, transactions, OCC, commit, feeds, or outbox;
- no parallel commit or invocation system;
- no universal database adapter or unrestricted relational transaction host;
- no raw executor or persistence capability exposed to application code;
- no public route, HTTP contract, production caller, deployment, or cutover;
- no public SDK redesign in this plan;
- no relation, sync, Payload, Medusa, scheduler, or Task lifecycle expansion;
- no new serialized application format merely to support the facade;
- no conversion of source bytes into query or mutation argument bytes at the
  semantic API; and
- no broad package cleanup outside directly migrated consumers.

## Current Stop Condition

Stop after the first `CAPI-E` system-test removal checkpoint and its focused
validation, review, and commit. The next bounded checkpoint removes the
versioned invocation product surface; definition removal follows only after
its exact internal canonical contracts are separated from obsolete authoring.
Public SDK, deployment, routing, and production entry surfaces remain
separately gated.
