# Deployment Analysis And Push

## Push Stores Analyzer Codegen Analysis

Previous completed checkpoint: `a09a2b8` Wire codegen CLI to HTTP analyzer.

What changed:

- `AnalyzedStartPushRequest` success payloads can carry `codegenAnalysis`.
- The public source-only push route now forwards analyzer `codegenAnalysis`
  into `DeploymentDO` instead of dropping it after analysis.
- `DeploymentDO` stores `codegen_analysis_json` on push rows and returns it
  through push status and active deployment status.
- Existing direct analyzed-push callers remain compatible: if
  `codegenAnalysis` is absent, `DeploymentDO` reconstructs it from flattened
  deployment analysis as a fallback.
- Stored codegen analysis is validated against normalized deployment analysis
  before it is persisted.
- The source-only push route now treats an OK analyzer response without
  `codegenAnalysis` as a failed push, keeping fallback reconstruction limited
  to internal/direct analyzed-push compatibility.
- The source-only push route treats `codegenAnalysis: null` as a failed
  source-only push; fallback is reserved for truly absent codegen metadata on
  internal/direct callers.
- Stored `codegen_analysis_json` is revalidated from unknown JSON when push
  status is read, and schema/function comparisons use canonical JSON so key
  insertion order does not affect equality.
- Analyzer and stored analysis payloads remain `unknown` until `DeploymentDO`
  validates schema/functions metadata, so malformed OK analyzer responses fail
  with explicit validation errors instead of worker/runtime 500s.
- Codegen function metadata must match flattened deployment metadata including
  source position, not only kind/validators/partition metadata.
- Codegen analysis rejects duplicate module entries so the preserved shape
  matches generated API assumptions.

Why it changed:

The analyzer response contract now carries both flattened deployment analysis
and final codegen analysis. Dropping `codegenAnalysis` in the backend push path
would make final deployment status depend on lossy reconstruction, which is the
opposite of the Convex-style rule that backend analysis is authoritative.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - `StartPushResponse` is the backend analysis boundary.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final generated files consume analysis from the backend response.
- `npm-packages/convex/src/cli/lib/components.ts`
  - push/start analysis metadata flows downstream into codegen.

Flarex differences:

- Flarex still keeps flattened `DeploymentAnalysis` for backend invocation and
  runtime metadata, while `DeploymentCodegenAnalysis` is preserved for
  generated files.
- Direct internal `/push/start-analyzed` requests can omit `codegenAnalysis`
  during migration; the fallback reconstruction path remains for prototype
  tests and older callers.
- The schema change is a Durable Object SQLite additive column rather than a
  Postgres migration because this is still the backend DO deployment metadata
  prototype.

Known limitations:

- Stored codegen analysis validation checks consistency with flattened
  deployment metadata, but the hosted Dynamic Worker analyzer service itself is
  still future work.
- Existing push rows without `codegen_analysis_json` still reconstruct codegen
  metadata on read.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/push.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

## CLI Codegen Selects HTTP Analyzer

Previous completed checkpoint: `5aff422` Add HTTP backend source analyzer.

What changed:

- `flarex-dev codegen` can now select the HTTP analyzer via
  `--analyzer-url`, `--deployment-id`, and repeatable `--analyzer-header`.
- Normal codegen and dry-run codegen both pass the selected analyzer through
  the existing `sourceAnalyzer` seam.
- The CLI rejects partial analyzer configuration before bundling source or
  writing generated files.
- Typecheck options are kept separate from analyzer execution options so the
  generated-output typecheck boundary remains filesystem/compiler-only.
- Regression coverage combines analyzer flags with `--typecheck` to prove that
  runtime-only analyzer options do not leak into generated-output typecheck.

Why it changed:

Backend analysis is supposed to be authoritative. The previous checkpoint
implemented the HTTP adapter and response contract; this checkpoint wires that
adapter into the codegen command so local tooling can consume backend-owned
analysis without changing final codegen.

Convex references inspected:

- `npm-packages/convex/src/cli/codegen.ts`
  - Convex codegen can target deployment credentials before running codegen.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated files are downstream of deployment/backend metadata.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - backend analysis response shape is the deployment boundary.

Flarex differences:

- Flarex does not yet have Convex's deployment-selection flow, so this uses
  explicit analyzer flags as a temporary platform seam.
- Analyzer auth is represented by generic headers for now instead of a
  platform admin key or project token.
- The backend push route is not called directly by CLI codegen yet; only the
  analyzer seam is selectable.

Known limitations:

- No hosted analyzer implementation is provided by this slice.
- No deployment config discovery exists yet.
- CLI dry-run can use the remote analyzer, but the remote analyzer must accept
  the temporary source package paths generated by the dry-run temp project.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
```

## HTTP Analyzer Response Carries Codegen Analysis

Previous completed checkpoint: `2560e38` Route codegen through backend analysis seam.

What changed:

- Extended `AnalyzeSourcePackageResponse` so successful analyzer responses must
  include `codegenAnalysis`.
- `createLocalAnalyzerService(...)` now returns both flattened backend
  deployment analysis and the codegen analysis used by final generated files.
- Added `HttpBackendSourceAnalyzer` as a client-side analyzer adapter that
  requires `codegenAnalysis` and preserves analyzer diagnostics on failures.
- The HTTP adapter validates nested codegen schema/module/function metadata at
  the response boundary and reuses the shared analyzer diagnostics normalizer.
- Parser-level validator failures now return the same
  `ExecutionArtifactAnalysisError` shape as other analyzer contract failures,
  so diagnostics are not lost.
- Parser failures now include the invalid `codegenAnalysis` path. This keeps
  missing analysis, malformed schema metadata, malformed validators,
  unsupported route metadata, and impossible success-with-error bodies
  distinguishable.
- Local analyzer service success responses are checked with
  `satisfies AnalyzeSourcePackageResponse` and convert local SDK validators to
  backend-safe validator JSON before returning `codegenAnalysis`.

Why it changed:

Flarex needs one backend-owned analysis result to drive both deployment state
and generated client/server files. The flattened deployment analysis is
sufficient for runtime invocation, but final codegen still needs module names
and export names. Returning `codegenAnalysis` from the analyzer response keeps
that metadata authoritative without reverse-engineering it from flattened
function paths.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/components.ts`
  - backend push response carries the analyzed metadata used downstream.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - defines the backend response boundary for push analysis.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final codegen consumes backend analysis from that response.

Flarex differences:

- Flarex's analyzer endpoint currently returns both backend deployment analysis
  and codegen analysis; Convex's response shape is broader and component-aware.
- The backend Worker still forwards only flattened analysis into
  `/push/start-analyzed`; `DeploymentDO` can reconstruct codegen analysis for
  push status.
- Hosted analyzer authentication and deployment ownership checks are not wired
  in this adapter.
- Non-null `route` metadata is rejected by the HTTP adapter instead of being
  silently erased; Flarex codegen currently treats `partition` as the supported
  routing metadata.
- `DeploymentCodegenFunction` no longer includes `route`, while flattened
  executable `DeploymentFunctionMetadata` still can. That keeps codegen
  metadata aligned with the Convex-style generated API path and leaves legacy
  route compatibility at the backend execution metadata layer.

Known limitations:

- `HttpBackendSourceAnalyzer` is not yet exposed through CLI flags.
- Hosted Dynamic Worker analysis is still future work; this adapter only
  defines the HTTP seam that can consume it.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-backend typecheck
git diff --check
```

## Codegen Uses Backend Source Analyzer Seam

Previous completed checkpoint: `5bdc5d9` Add codegen dry-run.

What changed:

- Codegen orchestration now calls `analyzeFlarexSourcePackage(...)`, which
  accepts a `BackendSourceAnalyzer`.
- The default analyzer is `LocalExecutionArtifactBackendAnalyzer`, matching the
  backend push analysis seam already used by local dev.
- `generateFlarex(...)` and `dryRunFlarexCodegen(...)` accept
  `FlarexCodegenOptions.sourceAnalyzer`, so tests and future hosted flows can
  supply backend-owned analysis without changing final codegen.

Why it changed:

The deployment model requires backend-controlled analysis to be authoritative.
Convex's `startPush` response carries analyzed module/schema metadata into
codegen. Flarex is not yet calling hosted push from CLI codegen, but this
checkpoint removes direct local artifact analysis from generator orchestration
and makes backend source analysis the codegen boundary.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/components.ts`
  - constructs and sends the push/start request with bundled modules.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - defines `StartPushResponse`, the backend analysis response consumed by
    later codegen steps.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final codegen reads analysis from `StartPushResponse`.

Flarex differences:

- The default analyzer is still local and deterministic-checking, not hosted.
- `BackendSourceAnalyzer` currently returns the codegen analysis shape directly;
  hosted deployment metadata persistence remains separate.
- Local dev already uses `LocalBackendPushCoordinator`; this checkpoint brings
  standalone codegen closer to that boundary without requiring a backend server.

Known limitations:

- Hosted `/push/start` is not yet the source of CLI codegen analysis.
- Codegen analysis is not yet reconstructed from persisted active deployment
  metadata for standalone CLI commands.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "injected backend source analysis" --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example generate
git diff --check
```

## Decision

Flarex developers write ordinary TypeScript modules. They do not write or
deploy Cloudflare Worker code.

```txt
application deployment
  frontend, mobile app, Next.js app, or other client
  hosted wherever the developer chooses

Flarex function deployment
  ordinary TypeScript modules under flarex/
  bundled by Flarex tooling
  uploaded to the Flarex backend
  executed by a Flarex-managed dynamic execution isolate
```

Avoid Cloudflare platform terms that suggest the developer writes or deploys
Worker code. Use these terms instead:

- **developer modules**: ordinary files written under `flarex/`
- **source package**: bundled developer modules, source maps, schema, and module
  metadata uploaded to Flarex
- **execution artifact**: internal Flarex runtime wrapper plus the source
  package metadata needed for analysis and execution
- **Dynamic Worker runtime**: Flarex-managed Cloudflare runtime that loads and
  executes only the uploaded `flarex/` source package, not the developer's
  whole application
- **deployment analysis**: authoritative metadata produced by evaluating the
  source package in the backend-controlled execution environment

## Developer Contract

The intended developer API remains Convex-shaped:

```ts
import { mutation, query } from "./_generated/server";
import { v } from "flarex/values";

export const list = query({
  args: {},
  returns: v.array(v.object({ text: v.string() })),
  handler: async ctx => {
    return await ctx.db.query("messages").collect();
  },
});

export const send = mutation({
  args: { text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", args);
    return null;
  },
});
```

The developer does not provide:

- a Worker `fetch` handler,
- Wrangler configuration,
- Dynamic Worker bindings,
- database connections,
- Durable Object stubs,
- execution or analysis endpoints.

Flarex tooling and the hosted platform own all of those runtime details.

## How Convex Performs Analysis

Convex analysis is runtime module analysis, not source-text scanning.

### 1. Function Registration Adds Runtime Metadata

Convex function builders wrap the developer handler and attach properties used
by the backend isolate:

```txt
isQuery / isMutation / isAction
isPublic / isInternal
exportArgs()
exportReturns()
_handler
```

`exportArgs()` and `exportReturns()` serialize validators to JSON. The strict
JSON replacer rejects undefined validators, including undefined values caused
by circular imports.

Convex references:

- `npm-packages/convex/src/server/impl/registration_impl.ts`
  - `queryGeneric`, `mutationGeneric`, `actionGeneric`, and internal variants
    attach runtime markers, validator exporters, and `_handler`.
  - `exportArgs` defaults missing args to `v.any()` and serializes validators.
  - `exportReturns` serializes a missing returns validator as `null`.
  - `strictReplacer` rejects undefined validator fields.

### 2. CLI Discovers And Bundles Modules

Convex initial codegen writes enough generated code for developer modules to
bundle. The CLI then:

- discovers deployable entry points,
- separates isolate and `"use node"` modules,
- bundles modules with esbuild,
- includes source maps,
- records module path and environment,
- hashes source plus source map,
- uploads changed modules while referencing unchanged module hashes.

The source package contract is conceptually:

```ts
type ModuleConfig = {
  path: string;
  source: string;
  sourceMap?: string;
  environment: "isolate" | "node";
};
```

Convex references:

- `npm-packages/convex/src/bundler/index.ts`
  - `entryPoints`, `entryPointsByEnvironment`, `bundle`, and module hashing.
- `npm-packages/convex/src/cli/lib/components/definition/bundle.ts`
  - `bundleImplementations` bundles schemas and function modules.
- `npm-packages/convex/src/cli/lib/components.ts`
  - `partitionModulesByChanges` sends changed modules and unchanged hashes.
- `npm-packages/convex/src/cli/lib/deployApi/modules.ts`
  - Serialized module and analyzed-module request/response shapes.

### 3. Backend Isolate Evaluates Modules

The Convex backend receives the source package, reconstructs unchanged modules,
and evaluates each non-dependency module in its isolate. It inspects the actual
module namespace after evaluation.

Analysis uses a restricted import-time environment:

- deterministic seeded non-cryptographic RNG,
- fixed import-phase Unix timestamp,
- bounded user-code timeout,
- explicitly supplied environment variables,
- no cryptographic randomness,
- no Performance API,
- no table mapping fetch,
- no database operations,
- no synchronous or asynchronous runtime syscalls,
- import-time logs retained for deployment error reporting.

This matters because module top-level code runs during both analysis and later
execution-isolate startup. Analysis metadata cannot be trusted if top-level
registration can change based on uncontrolled time, randomness, I/O, or
environment state.

For each exported object, Convex:

1. recognizes it only when exactly one function-kind marker is present,
2. checks public/internal visibility markers,
3. calls `exportArgs()` and parses the serialized argument validator,
4. calls `exportReturns()` and parses the serialized return validator,
5. verifies the handler is a function,
6. validates the exported function name,
7. resolves the handler source position through the source map,
8. records the analyzed function.

Exports that are not recognized as registered functions are ignored. An export
with no kind marker or multiple kind markers is skipped. An export marked both
public and internal is skipped with a warning. Once an export is recognized as
a registered function, malformed validator exporters or an invalid handler
fail the push.

Convex's authoritative analyzed shape contains:

```ts
type AnalyzedModule = {
  functions: AnalyzedFunction[];
  httpRoutes?: unknown;
  cronSpecs?: unknown;
  sourceIndex?: number;
};

type AnalyzedFunction = {
  name: string;
  position?: SourcePosition;
  udfType: "Query" | "Mutation" | "Action";
  visibility?: "public" | "internal";
  args: SerializedArgsValidator;
  returns: SerializedReturnsValidator;
};
```

Convex references:

- `crates/isolate/src/environment/analyze.rs`
  - `AnalyzeEnvironment` defines the restricted import-time environment.
  - `udf_analyze`, `parse_args_validator`, and `parse_returns_validator`.
- `crates/model/src/modules/module_versions.rs`
  - Authoritative `AnalyzedModule` and `AnalyzedFunction` models.
- `crates/application/src/lib.rs`
  - `analyze_modules` enforces module limits and converts analysis errors into
    deployment errors.

### 4. Schema Is Evaluated Separately

Convex bundles `schema.ts` separately. The backend isolate evaluates the schema
module, requires a default schema export, calls its runtime `export()` method,
and deserializes the resulting database schema.

Convex references:

- `crates/isolate/src/environment/schema.rs`
  - `SchemaEnvironment::evaluate_schema`.
- `crates/application/src/deploy_config.rs`
  - `evaluate_components` analyzes modules and evaluates schemas before
    constructing the checked deployment.

### 5. Backend Persists Analysis As The Execution Contract

Convex requires every non-dependency module to have an analyzed result.
Execution resolves the deployed analyzed function by module path and function
name before running it.

The authoritative metadata controls:

- whether a function exists,
- function kind,
- public versus internal visibility,
- argument validation,
- return validation,
- scheduled-function validation,
- source positions and operational metadata.

Convex references:

- `crates/model/src/modules/mod.rs`
  - `ModuleModel::apply` requires analyzed metadata for non-dependency modules.
  - `get_analyzed_function` resolves deployed functions from analyzed metadata.
- `crates/udf/src/validation.rs`
  - `ValidatedPathAndArgs` checks existence, visibility, expected function
    kind, argument size, and argument validators before execution.
  - Return validators are carried into post-execution validation.
- `crates/model/src/modules/function_validators.rs`
  - Argument validators must be an object validator or unvalidated `any`.
  - Return validators are independently validated.

## Convex Push Lifecycle

Convex deployment is deliberately split:

```txt
initial codegen
  -> bundle definitions, schema, and implementations
  -> start_push
      upload/reconstruct source packages
      evaluate schemas
      analyze modules
      validate component definitions
      prepare schema/index changes
      return authoritative analysis
  -> final codegen from start_push response
  -> TypeScript typecheck
  -> wait_for_schema
      validate existing documents
      wait for index backfills
      detect overwritten/racing schema changes
  -> finish_push
      recheck race-sensitive state
      atomically apply modules, analysis, schema, indexes, and deployment state
```

Convex references:

- `npm-packages/convex/src/cli/lib/components.ts`
  - Orchestrates initial codegen, bundling, `startPush`, final codegen,
    typecheck, schema wait, and `finishPush`.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - Defines `StartPushRequest`, authoritative analysis response, and schema
    change status.
- `crates/application/src/deploy_config.rs`
  - `start_push`, `evaluate_push_contents`, `wait_for_schema`, and
    `finish_push`.

## Flarex Target Design

Flarex should port the same lifecycle with a Cloudflare-specific execution
artifact boundary.

```txt
flarex dev / flarex deploy
  -> initial codegen
  -> bundle only the flarex/ developer modules, schema, and source maps
  -> POST start_push source package to Flarex backend
  -> Flarex creates an internal candidate execution artifact
  -> backend invokes candidate analysis inside the Dynamic Worker runtime
  -> candidate returns authoritative module and schema analysis
  -> backend validates and stores candidate analysis
  -> CLI performs final codegen from backend response
  -> CLI typechecks
  -> backend validates schema/index changes
  -> finish_push atomically activates candidate deployment version
```

The execution artifact is an internal implementation detail. Conceptually,
Flarex adds a runtime wrapper around the developer bundle:

```ts
import * as module0 from "./messages.js";
import * as module1 from "./users.js";
import schema from "./schema.js";
import { createExecutionArtifact } from "flarex/runtime";

export default createExecutionArtifact({
  modules: { "messages.js": module0, "users.js": module1 },
  schema,
});
```

The developer never writes or sees this entrypoint.

## Current Prototype Gaps

The current implementation proves several pieces, but it is not yet the target
deployment architecture:

- `packages/flarex-dev/src/analyze.ts` bundles modules and imports them inside
  the local Node process.
- Current analysis trusts `__flarexFunction`, `kind`, and `visibility` fields
  and does not produce validators or source positions.
- Generated metadata reads raw runtime validator objects from the generated
  function registry.
- Local dev deploys schema and function metadata through direct backend PUT
  routes.
- `DeploymentDO` destructively replaces active schema and functions.
- The backend has no candidate source package, authoritative analyzed-module
  record, push state machine, or active execution-artifact pointer.

These shortcuts are useful prototype scaffolding. They should be replaced
incrementally by the shared push lifecycle rather than expanded into a second
deployment model.

## Flarex Registration Contract

Flarex should move closer to Convex's runtime registration contract.

Current Flarex registered functions expose raw validator and handler objects:

```txt
__flarexFunction
kind
visibility
args
returns
handler
```

Target contract:

```txt
isQuery / isMutation / isAction / isWorkflowMutation
isPublic / isInternal
exportArgs()
exportReturns()
_handler
```

Recommended approach:

1. Add Convex-compatible marker and exporter properties.
2. Keep current Flarex properties temporarily for migration.
3. Port Convex's strict undefined-validator serialization behavior.
4. Make authoritative analysis call validator exporter functions and parse
   their JSON rather than directly trusting object fields.
5. Eventually remove prototype-only marker fields when generated and runtime
   code no longer depends on them.

`workflowMutation` is an intentional Flarex extension and must be represented
as an additional exclusive function-kind marker.

## Authoritative Analysis Contract

The first Flarex backend analysis response should include:

```ts
type AnalyzedSourcePosition = {
  path: string;
  startLine: number;
  startColumn: number;
};

type AnalyzedFunction = {
  name: string;
  kind: "query" | "mutation" | "action" | "workflowMutation";
  visibility: "public" | "internal";
  args: ValidatorJson;
  returns: ValidatorJson | null;
  position?: AnalyzedSourcePosition;
};

type AnalyzedModule = {
  path: string;
  environment: "isolate";
  functions: AnalyzedFunction[];
  sourceMap?: string;
};

type StartPushResponse = {
  pushId: string;
  bundleHash: string;
  modules: AnalyzedModule[];
  schema: DeploymentSchema;
  schemaChange: SchemaChange;
};
```

Later additions should follow Convex's domains:

- HTTP routes,
- cron specifications,
- environment-variable declarations,
- component definitions,
- external dependencies,
- separate action/runtime environments.

## Validation Layers

Copy Convex's layered validation model:

### During SDK Registration

- Convert argument validator records to object validators.
- Serialize validators with strict undefined rejection.
- Preserve Convex's unvalidated semantics: arguments serialize as `any`, while
  missing return validation serializes as `null`.
- Support the same practical registration forms as Convex: a direct handler or
  an object containing optional `args`, optional `returns`, and `handler`.

### During Bundle Construction

- Apply Convex-compatible function entry-point rules.
- Reject reserved paths.
- Record path, source, source map, environment, and hash.
- Enforce module count and source-size limits.

### During Authoritative Analysis

- Evaluate modules in the dynamic execution isolate.
- Run with a controlled import-phase timestamp and randomness contract.
- Ignore non-function exports.
- Recognize only exports with exactly one function-kind marker.
- Match Convex's compatibility behavior for ambiguous markers: skip exports
  with multiple kinds or both public/internal markers and retain analysis logs.
- Require valid handler functions.
- Parse exported validator JSON.
- Validate function names and module paths.
- Record source positions.
- Evaluate schema separately and validate its exported JSON.
- Disable database syscalls and prevent mutations during import/analysis.
- Disable external I/O, cryptographic randomness, unsupported environment
  access, and asynchronous runtime operations during import/analysis.
- Retain bounded import-time logs and include them in push failures.
- Enforce an analysis CPU/time limit.

### During `start_push`

- Validate the complete analyzed deployment.
- Compute schema and index diffs.
- Reject malformed analysis responses.
- Store candidate metadata without changing active invocation routing.

### During Invocation

- Resolve the function only from active authoritative analyzed metadata.
- Enforce visibility and expected kind before execution.
- Validate arguments before user code.
- Validate return values before mutation commit.
- Treat local execution-artifact validation as fast feedback only; backend
  validation remains authoritative.

### During `finish_push`

- Detect concurrent or superseded pushes.
- Confirm schema validation and required index work completed.
- Atomically activate source package, execution artifact reference, schema, and
  analyzed metadata.

## Cloudflare Adaptation

Cloudflare Workers cannot evaluate arbitrary uploaded JavaScript source with
`eval()` or `new Function()`. Therefore Flarex does not store raw TypeScript and
ask one permanent Worker to evaluate it directly.

Flarex tooling bundles only the developer's `flarex/` folder into a source
package. The backend stores that source package and creates an internal
execution artifact for the Flarex-managed Dynamic Worker runtime. The
developer's frontend, mobile app, Next.js app, or other application deployment
is not bundled into this artifact and is not deployed by Flarex.

This keeps the developer model close to Convex. The developer uploads ordinary
Flarex backend modules to Flarex and uses client APIs from their app wherever
that app is hosted.

### Import-Phase Determinism Risk

Cloudflare provides isolation, but it does not directly expose Convex's
`AnalyzeEnvironment` controls. Flarex must determine and enforce a portable
import-phase contract before claiming equivalent analysis semantics.

The target is:

```txt
execution artifact runtime prelude
  -> install controlled import-phase globals where Cloudflare permits
  -> deny outbound I/O during analysis
  -> expose no database/syscall capability during module import
  -> evaluate developer modules
  -> analyze exports
  -> compare result against the artifact's declared module/hash manifest
```

Where Cloudflare cannot safely patch or control a global used at module import,
Flarex must initially reject that import-time usage with a clear deployment
error. Silent nondeterminism is not acceptable because analysis metadata could
then disagree with the functions available in a later isolate.

Before implementing hosted analysis, create focused probes for:

- whether a generated prelude can reliably control `Date.now()` and
  `Math.random()` before bundled developer module evaluation,
- whether cryptographic randomness and Performance APIs can be denied,
- top-level `fetch` and other outbound I/O behavior,
- environment-variable exposure during module initialization,
- consistency across separate cold isolate starts.

If full control is not portable, Flarex should define a stricter import-time
subset than Convex and enforce it at bundle and runtime boundaries.

Relevant Cloudflare runtime constraint:

- `https://developers.cloudflare.com/workers/runtime-apis/web-standards/`
  - Workers prohibit `eval()` and `new Function()`, so Flarex must analyze and
    execute prepared source packages through its managed runtime boundary.

## Deployment State Model

`DeploymentDO` currently replaces schema and functions directly. The target
model needs candidate and active deployment versions:

```txt
deployment
  activePushId
  activeExecutionArtifact
  activeSchemaVersion

push
  pushId
  state
  bundleHash
  sourcePackageRef
  executionArtifactRef
  analyzedModules
  schema
  schemaChange
  error
  createdAt
```

Suggested push states:

```txt
created
uploaded
analyzing
analyzed
validatingSchema
ready
active
failed
superseded
```

Large source packages and source maps should live outside Durable Object SQLite,
likely in R2. `DeploymentDO` should own authoritative state transitions,
analysis metadata, schema metadata, and the active pointer.

## Proposed Push API

Keep the public shape close to Convex while using deployment-scoped Flarex
routes:

```txt
POST /deployments/:deploymentId/pushes/evaluate
POST /deployments/:deploymentId/pushes/start
POST /deployments/:deploymentId/pushes/:pushId/wait-for-schema
POST /deployments/:deploymentId/pushes/:pushId/finish
GET  /deployments/:deploymentId/pushes/:pushId
```

`evaluate` performs analysis and computes schema/index effects without
activating or beginning long-lived schema work.

`start` creates candidate state, performs authoritative analysis, and begins
schema/index preparation.

`wait-for-schema` long-polls candidate schema validation and index preparation.

`finish` verifies the candidate is still valid and atomically switches the
active deployment pointer.

Internal execution-artifact routes should not be public application APIs:

```txt
POST /__flarex_internal/analyze
POST /__flarex_internal/invoke
```

They are invoked only through the Flarex dispatch/control plane and must require
an unforgeable internal capability scoped to the deployment and candidate push.

## Local Development

Local development must use the same push state machine:

```txt
Vite watcher
  -> initial codegen
  -> source package
  -> local start_push
  -> candidate Miniflare execution artifact
  -> authoritative local analysis
  -> final codegen
  -> local finish_push
```

Miniflare is the local execution-artifact adapter for the same source-package
analysis contract. Local dev must not keep a separate metadata deployment
shortcut.

## Ownership Boundaries

Target responsibilities:

```txt
packages/flarex
  function registration markers
  validator exporters
  developer-facing runtime types

packages/flarex-dev
  initial codegen
  source bundling and hashing
  push client
  final codegen from StartPushResponse
  local dev orchestration

packages/flarex-backend
  push API contracts and validation
  DeploymentDO candidate/active state machine
  authoritative analyzed metadata persistence
  invocation resolution against active metadata

Flarex Dynamic Worker runtime
  load candidate source packages
  run candidate analysis
  run active invocation
  enforce import-time and syscall boundaries
```

The Dynamic Worker runtime/control path should be separated from the public
request/data plane. Public invocation code must not receive raw storage
bindings, database connections, or unrestricted runtime capabilities.

Do not create a new package solely for the adapter until local Miniflare and
the hosted Dynamic Worker runtime create a real shared contract. At that point,
extract the interface and shared push orchestration instead of duplicating the
state machine.

## Implementation Plan

### Phase 1: Port Registration And Analysis Contracts

1. Port Convex-style marker fields, validator exporters, and strict serializer
   into `packages/flarex`.
2. Port Convex-compatible function registration overloads and unvalidated
   args/returns behavior.
3. Expand Flarex analyzed module/function types to include validators and
   source positions.
4. Make the current local analyzer use the same contract and failure behavior
   as the future backend analyzer.
5. Add focused compatibility tests for malformed markers, malformed
   validators, ambiguous visibility, invalid handlers, invalid names, aliases,
   reexports, and source positions.

### Phase 1 Step 1 Implementation Update

Completed the first isolated registration-contract step in `packages/flarex`.
No backend push state, deployment routing, local-dev push flow, or Dynamic
Worker integration changed.

Implemented:

- Convex-style direct handler registration:

  ```ts
  query(async (ctx, args) => ...)
  ```

- Convex-style object registration with optional `args` and `returns`:

  ```ts
  query({ handler })
  query({ args, handler })
  query({ args, returns, handler })
  ```

- runtime registration metadata:

  ```txt
  isFlarexFunction
  isQuery / isMutation / isAction / isWorkflowMutation
  isPublic / isInternal
  exportArgs()
  exportReturns()
  _handler
  ```

- missing args export as `v.any()` JSON,
- missing returns export as `null`,
- strict undefined-validator rejection during `exportArgs()` and
  `exportReturns()`,
- `internalActionGeneric` and `internalAction` registration,
- root argument-validator support in validation helpers,
- exact generated API argument and declared-return type inference.

Temporary compatibility fields remain:

```txt
__flarexFunction
kind
visibility
args
returns
handler
```

They keep the existing local analyzer, metadata generator, and generated Worker
operational until the next step changes analysis to consume Convex-style
markers and validator exporters.

Convex references copied closely:

- `npm-packages/convex/src/server/registration.ts`
  - `DefaultFunctionArgs`, optional-validator builder typing, registered
    function runtime fields, and direct/object registration forms.
- `npm-packages/convex/src/server/impl/registration_impl.ts`
  - function kind/visibility markers, `_handler`, `exportArgs`,
    `exportReturns`, `v.any()` default args, `null` default returns, and strict
    undefined-validator serialization.

Current intentional or temporary differences:

- Flarex uses `isFlarexFunction`, not Convex's `isConvexFunction`.
- `workflowMutation` adds `isWorkflowMutation`.
- Flarex still exposes prototype compatibility fields listed above.
- Flarex execution still calls `handler`; it does not yet use Convex-style
  `invokeQuery`, `invokeMutation`, or `invokeAction` wrappers.
- `internalAction` exists in the public SDK but is not yet emitted by the
  generated `_generated/server.ts` template.
- Convex backend analysis rejects argument validators other than object or
  unvalidated `any`; Flarex authoritative analysis does not enforce that yet.
- Flarex's strict undefined error currently points at the serialized
  `fieldType` property and does not include Convex's documentation URL.

Focused tests cover:

- exclusive kind and visibility markers,
- public and internal registrations,
- direct handlers,
- object definitions without validators,
- root `v.any()` arguments,
- serialized args and returns validators,
- strict undefined-validator failures,
- `_handler` identity,
- existing generated API argument and return inference.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

Next isolated step: update `packages/flarex-dev/src/analyze.ts` to consume these
runtime markers and validator exporters and to return validator metadata. Do
not add backend push state in that step.

### Phase 1 Step 2 Implementation Update

Completed the isolated local-analysis contract step. No backend push state,
deployment activation, Dynamic Worker analysis adapter, or final-codegen
metadata source changed.

The `flarex-dev` analyzer now:

- classifies function exports from exactly one of `isQuery`, `isMutation`,
  `isWorkflowMutation`, or `isAction`,
- classifies visibility from exactly one of `isPublic` or `isInternal`,
- ignores the temporary `__flarexFunction`, `kind`, and `visibility`
  compatibility fields,
- verifies `_handler` is callable,
- calls `exportArgs()` and `exportReturns()` with the registered function as
  `this`,
- requires exporter results to be strings,
- parses and structurally validates the serialized validator JSON through the
  zero-runtime-dependency `flarex/validator-json` subpath,
- enforces that argument validators are object validators or unvalidated
  `v.any()`, and
- returns normalized `args` and `returns` validator metadata in every analyzed
  function record.

Malformed or ambiguous marker exports are skipped. Invalid handlers, exporter
types, exporter return values, JSON, validator shapes, and argument validator
kinds fail analysis with a module/export-qualified error.

Convex references copied closely:

- `crates/isolate/src/environment/analyze.rs`
  - exclusive kind-marker detection,
  - visibility-marker detection,
  - `_handler` validation,
  - `exportArgs()` and `exportReturns()` invocation,
  - exporter string and JSON failure behavior.
- `crates/model/src/modules/module_versions.rs`
  - analyzed functions own validator metadata produced by analysis.

Intentional and temporary differences:

- Flarex adds `isWorkflowMutation`.
- Flarex currently requires exactly one visibility marker and skips exports
  without visibility. Convex can retain an analyzed function with no
  visibility for compatibility; Flarex avoids accidentally defaulting an
  unmarked function to public.
- Flarex local analysis returns normalized validator JSON objects. Convex
  stores serialized validator JSON strings in `AnalyzedFunction`.
- Source positions are not included yet.
- Final generated `functionMetadata.ts` still evaluates the function registry
  instead of consuming analyzed validator metadata. Moving final codegen to
  the analysis response remains a later isolated step.
- Analysis still runs in the trusted local Vite process, not the
  backend-controlled Dynamic Worker boundary.

Focused tests cover:

- marker-based kind and visibility classification,
- ignoring tampered compatibility fields,
- query, mutation, workflow mutation, and internal action analysis,
- parsed argument and return validators,
- ambiguous kind and visibility markers,
- missing visibility,
- malformed exporter types and results,
- invalid JSON and validator shapes,
- invalid argument validator kinds, and
- invalid handlers.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

### Phase 1 Step 3 Implementation Update

Completed the isolated final-codegen authority step. Backend push state,
deployment activation, source bundling, and Dynamic Worker analysis remain
unchanged.

Final codegen now serializes `functionMetadata.ts` directly from
`AnalyzedModule[]`. The generated metadata module is static data and no longer
imports or evaluates `functionRegistry.ts`.

The generated Worker now uses analyzed metadata for:

- function kind checks,
- argument validation,
- backend execution-session start requests, and
- return validation.

`functionRegistry.ts` is now used only to resolve the executable registered
function and call its Convex-style `_handler`. Temporary compatibility fields
such as `kind`, `visibility`, `args`, `returns`, and `handler` can no longer
change generated deployment metadata or invocation validation after analysis.

Convex references copied in principle:

- `npm-packages/convex/src/cli/codegen_templates/component_api.ts`
  - final static codegen derives function references and types from analyzed
    modules rather than re-evaluating developer exports.
- `crates/model/src/modules/module_versions.rs`
  - analyzed function metadata is the durable description of function kind,
    visibility, and validators.

Intentional and temporary differences:

- Flarex emits a generated static runtime metadata module because the current
  generated Worker exposes `/__flarex_internal/metadata`. Convex persists
  analyzed metadata in its backend.
- The executable registry still imports developer modules because Flarex has
  not produced or uploaded a separate execution artifact yet.
- Analysis remains local and trusted. The static metadata is authoritative
  only for this local generation run until backend-controlled analysis and
  push state exist.

Tests prove that mutating legacy runtime compatibility fields after
registration cannot alter generated function kind, visibility, args, returns,
or Worker invocation validation.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

### Phase 2: Produce A Real Source Bundle

1. Separate initial codegen, source bundling, and final codegen APIs.
2. Emit module path, source, source map, environment, and stable hash.
3. Bundle schema separately.
4. Add changed-module and unchanged-hash support after the full-bundle path is
   correct.

### Phase 2 Step 1 Implementation Update

Completed the first immutable source-package step. No backend push API,
candidate deployment state, Miniflare analysis adapter, or hosted Dynamic
Worker upload was added.

The generation pipeline is now explicit:

```txt
initialCodegen()
  -> bundleFlarexSourcePackage()
  -> analyzeSourcePackageLocally()
  -> finalCodegen()
```

`generateFlarex()` remains the convenience orchestration API and calls those
four phases in order.

The serializable source-package contract is:

```ts
type SourceModule = {
  path: string;
  source: string;
  sourceMap?: string;
  environment: "isolate";
  sha256: string;
};

type SourcePackage = {
  modules: SourceModule[];
  functions: string[];
  schema?: string;
  execution: string;
};
```

The package contains:

- one self-contained isolate bundle per developer function entrypoint,
- a separately bundled schema module when `flarex/schema.ts` or
  `flarex/schema.js` exists, and
- a self-contained internal execution entrypoint that exports the function
  module namespaces and is consumed by local analysis.

Modules are sorted by logical path. Source maps are normalized to remove
machine-specific project and SDK paths. Each `sha256` covers:

```txt
source + NUL + normalized source map
```

Local analysis now executes the source package's internal execution entrypoint,
not a transient analyzer-only Vite bundle. This establishes the artifact
contract that a future Miniflare adapter and hosted Dynamic Worker adapter can
both consume.

Convex references copied closely:

- `npm-packages/convex/src/cli/lib/components/definition/bundle.ts`
  - bundles schema separately,
  - bundles isolate function entrypoints with source maps,
  - returns module path, source, source map, and environment.
- `npm-packages/convex/src/cli/lib/deployApi/modules.ts`
  - `ModuleConfig` and `ModuleHashConfig` transport shapes.
- `crates/model/src/config/types.rs`
  - module hash identity covers source plus source map.

Intentional and temporary differences:

- Convex uses esbuild and its backend source-package storage. Flarex currently
  uses Vite/Rollup and returns an in-memory serializable package.
- Flarex adds a duplicated self-contained internal execution entrypoint so a
  Flarex-managed execution artifact can load all registered functions from one
  module. Individual function bundles remain available for Convex-style module
  identity and future changed-module pushes.
- Source maps are preserved and normalized, but analyzed source positions are
  not extracted yet.
- Schema is bundled separately but not yet evaluated from the source package.
- Full packages are always produced; changed-module and unchanged-hash push
  optimization remains follow-up work.

Tests prove:

- identical projects under different machine paths produce identical source
  packages and hashes,
- module ordering is deterministic,
- schema, function, and execution bundles are separate,
- unrelated generated files do not affect package identity,
- changing one function changes its bundle and the execution entrypoint but
  not unrelated function or schema hashes, and
- the execution entrypoint can be analyzed and passed to final codegen.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

### Phase 2 Step 2 Implementation Update

Completed complete local deployment analysis from the immutable source package.
No backend candidate state, push routes, Miniflare adapter, or hosted Dynamic
Worker analysis was added.

`analyzeSourcePackageLocally()` now returns:

```ts
type DeploymentAnalysis = {
  functions: AnalyzedModule[];
  schema: AnalyzedSchema;
};
```

The schema bundle referenced by `SourcePackage.schema` is evaluated directly
from its immutable bundled source. Analysis normalizes:

- stable table IDs assigned by sorted table name,
- table names,
- structurally validated document validators,
- default and explicit placement rules,
- index names and field lists, and
- stable index IDs.

`finalCodegen()` now consumes the complete `DeploymentAnalysis`. Generated
`deploymentSchema.ts` is static analyzed data and does not import
`../schema`. The generated Worker derives table-name and table-ID metadata from
that static deployment schema and also no longer imports `../schema`.

The developer schema remains imported only by generated `dataModel.ts` for
compile-time TypeScript inference. Runtime deployment metadata and invocation
behavior no longer evaluate it after analysis.

Convex references copied in principle:

- `crates/application/src/lib.rs`
  - evaluates the separately bundled schema module before deployment.
- `npm-packages/convex/src/cli/lib/deployApi/componentDefinition.ts`
  - deployment analysis returns both analyzed functions and analyzed schema.
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - final codegen consumes analyzed schema returned by deployment analysis.

Intentional and temporary differences:

- Flarex currently normalizes directly into the existing Durable Object
  `DeploymentSchema` shape. Convex's analyzed database schema contains richer
  schema-validation and index lifecycle metadata.
- Projections remain excluded from authoritative storage schema, matching the
  current backend capability. Projection analysis needs its own later domain
  step.
- Schema version remains prototype constant `1`; push-state activation will
  own real schema version progression.
- Schema import-phase restrictions are not enforced until analysis moves into
  a controlled execution artifact.

Tests prove:

- schema validators, indexes, and placement survive source package bundling and
  analysis,
- final codegen consumes the analyzed schema,
- modifying the developer schema file after analysis cannot change generated
  deployment metadata, and
- generated Worker runtime code no longer imports the developer schema.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

### Phase 3: Add Backend Push State

1. Define `StartPushRequest`, `StartPushResponse`, `PushStatus`, and
   `FinishPushRequest`.
2. Add candidate push state and active deployment pointer to `DeploymentDO`.
3. Store authoritative analysis per candidate push.
4. Keep existing direct schema/functions PUT routes only as temporary test
   helpers, then remove them from normal dev/deploy flow.

### Phase 3 Step 1 Implementation Update

Added the first backend candidate push lifecycle. No Dynamic Worker analysis,
Miniflare analysis adapter, hosted source-package loading, schema diff
validation, or local-dev push orchestration was added.

New backend API types:

- `StartPushRequest`
- `StartPushResponse`
- `FinishPushRequest`
- `PushStatus`
- `PushSourcePackage`
- `DeploymentAnalysis`

New routes:

```txt
POST /deployments/:deploymentId/push/start
GET  /deployments/:deploymentId/push/:pushId
POST /deployments/:deploymentId/push/:pushId/finish
```

For this step, the dev/client side supplies both the source package metadata
and the already-produced deployment analysis. `DeploymentDO` validates and
stores the candidate, but it does not run analysis itself yet.

Candidate push state is stored in `DeploymentDO` with:

- push ID,
- state,
- source package metadata and hashes,
- analyzed schema,
- analyzed functions,
- failure error,
- created/updated timestamps.

Supported states:

```txt
pending
analyzed
failed
activated
superseded
```

Current state behavior:

- A start request with valid analysis stores an `analyzed` candidate.
- A start request without analysis but with an error stores a `failed`
  candidate.
- Starting a new analyzed/failed candidate supersedes previous `pending` or
  `analyzed` candidates.
- Active schema/functions remain unchanged until `finish`.
- `finish` atomically applies candidate schema and function metadata through
  the same validation path used by the legacy direct `PUT /schema` and
  `PUT /functions` routes.
- Failed, superseded, and unknown pushes cannot activate.

Convex references copied in principle:

- `crates/application/src/deploy_config.rs`
  - `start_push` / `finish_push` lifecycle and candidate deployment state.
- `crates/application/src/lib.rs`
  - analyzed modules and schema flow into activation only after validation.
- `crates/model/src/source_packages/types.rs`
  - source package metadata and hashes are part of deployment state.

Intentional and temporary differences:

- Convex backend performs analysis during push. Flarex accepts analysis from
  dev tooling for this step.
- Flarex stores source package contents inline in Durable Object SQLite for the
  prototype. Hosted production should store large immutable artifacts outside
  `DeploymentDO` and keep hashes/references there.
- Historical note: direct schema/functions PUT routes existed at this
  checkpoint for tests and dev runtime. They were later removed from the
  public backend route surface after tests/dev moved to push activation.
- Local dev runtime later moved to `push/start` and `push/finish`.
- No push race token, schema diff, wait-for-schema, index backfill, or
  execution-artifact pointer is enforced yet.

Tests prove:

- start stores an analyzed candidate,
- active deployment is unchanged before finish,
- finish activates schema/functions,
- failed and unknown pushes cannot activate,
- a second push supersedes the previous analyzed candidate, and
- superseded pushes cannot activate.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

### Phase 4: Local Authoritative Push

1. Add an execution-artifact adapter interface.
2. Implement the first adapter with Miniflare.
3. Run candidate analysis through the execution artifact, not through Node
   dynamic import.
4. Change local dev and `flarex-test` to use `start_push` and `finish_push`.
5. Generate final API types from `StartPushResponse`.

### Phase 4 Step 1 Implementation Update

Local dev now uses the backend candidate push lifecycle for reload and
activation. It still uses local Node/Vite analysis; no execution-artifact
adapter was introduced yet.

New reload order:

```txt
initialCodegen()
  -> bundleFlarexSourcePackage()
  -> analyzeSourcePackageLocally()
  -> POST /push/start
  -> finalCodegen()
  -> build app Worker
  -> POST /push/:pushId/finish
```

The push request sends:

- source package metadata and hashes,
- analyzed schema,
- flattened analyzed function metadata.

Final codegen still uses the grouped local analysis result so the generated
function registry can import executable exports by module/export. Backend
activation uses the flattened metadata shape already stored by
`DeploymentDO`.

Intentional and temporary differences:

- Convex backend analysis is authoritative during push. Flarex local dev still
  supplies analysis to the backend.
- Final codegen is not yet driven directly from `StartPushResponse` because the
  backend stores flattened function metadata. Reconstructing or returning a
  codegen-ready analysis tree belongs with the execution-artifact analyzer
  step.
- The generated Worker metadata endpoint remains for compatibility, but local
  dev no longer uses it for deployment.

Tests prove:

- local dev records an activated backend push,
- activated push metadata contains analyzed schema and functions,
- invoke still works through the generated Worker after push activation.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

### Phase 4 Step 2 Implementation Update

Previous completed checkpoint: `7abaa43` Use backend push lifecycle in local
dev.

Added the first execution-artifact adapter boundary and wired local generation
and local dev reload through it.

New API:

```ts
interface ExecutionArtifactAdapter {
  analyze(sourcePackage: SourcePackage): Promise<DeploymentAnalysis>;
}
```

`LocalMiniflareExecutionArtifactAdapter` now creates a temporary Miniflare
Worker module from the immutable source package, imports the bundled execution
entrypoint and schema entrypoint inside that Worker-shaped isolate, and returns
the same `DeploymentAnalysis` shape used by final codegen and backend
`push/start`.

Normal local dev reload is now:

```txt
initialCodegen()
  -> bundleFlarexSourcePackage()
  -> LocalMiniflareExecutionArtifactAdapter.analyze(sourcePackage)
  -> POST /push/start
  -> finalCodegen()
  -> build generated app Worker
  -> POST /push/:pushId/finish
```

`generateFlarex()` also uses the adapter. The older
`analyzeSourcePackageLocally()` path remains exported as a transition/debug
helper and as a test oracle while the artifact analyzer is still being proven.

Convex references copied in principle:

- `crates/isolate/src/environment/analyze.rs`
  - analysis executes evaluated runtime exports instead of scanning source.
- `crates/application/src/deploy_config.rs`
  - push analysis produces the metadata consumed by final codegen and
    activation.
- `npm-packages/convex/src/cli/lib/components.ts`
  - local dev orchestration treats analysis as a deployment step between
    source bundling and final codegen.

Intentional and temporary differences:

- Convex analyzes in the backend Rust/V8 isolate. This step analyzes in a
  local Miniflare Worker-shaped artifact so the boundary is Cloudflare-shaped
  before the hosted Dynamic Worker runtime is connected.
- The artifact analyzer embeds a small analyzer runtime instead of importing
  `flarex-dev` internals. This keeps the future hosted artifact self-contained,
  but the code should be deduplicated once the runtime package boundary is
  created.
- The backend still receives client-supplied analysis in `push/start`; it does
  not yet create the candidate artifact or call analysis itself.
- Import-phase determinism controls, source positions, logs, module limits,
  source package storage, and hosted Dynamic Worker loading remain future work.

Tests prove:

- the Miniflare execution-artifact analyzer returns the same function and
  schema analysis as the old direct Node analyzer for a source package, and
- final codegen can consume the artifact analysis.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

### Phase 4 Step 3 Implementation Update

Previous completed checkpoint: `27bb9f5` Analyze source packages in execution
artifact.

Backend push status now returns a codegen-ready grouped analysis response in
addition to the flattened activation metadata:

```ts
type DeploymentCodegenAnalysis = {
  schema: DeploymentSchema;
  functions: Array<{
    moduleName: string;
    functions: Array<{
      moduleName: string;
      exportName: string;
      kind: DeploymentFunctionKind;
      visibility: FunctionVisibility;
      args: ValidatorJson;
      returns: ValidatorJson | null;
    }>;
  }>;
};
```

`DeploymentDO` still stores the existing flattened `DeploymentFunctions`
shape because that is the active runtime validation and invocation metadata.
When returning `push/start`, `push/:id`, or `push/:id/finish`, it reconstructs
the grouped codegen modules from function paths:

```txt
lessons:list -> moduleName "lessons", exportName "list"
lessons      -> moduleName "lessons", exportName "default"
```

Local dev now requires `started.codegenAnalysis` from the backend before
running `finalCodegen()`. The locally produced artifact analysis is still sent
to `push/start` because the backend does not own analysis yet, but final codegen
is now driven by the backend response instead of the pre-push local variable.

Convex references copied in principle:

- `npm-packages/convex/src/cli/lib/components.ts`
  - final codegen consumes the deployment analysis returned from push.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - `startPush` returns analyzed modules and schema information needed by the
    client-side codegen/typecheck phase.
- `crates/model/src/modules/module_versions.rs`
  - active runtime metadata remains the durable backend function contract.

Intentional and temporary differences:

- Convex's backend produces the analysis itself. Flarex still receives local
  artifact analysis in the request and validates/stores it before returning a
  backend-shaped codegen response.
- Flarex reconstructs grouped modules from flattened paths. This is sufficient
  for current generated API output but source positions and richer analyzed
  module records still require backend-owned artifact analysis.
- `codegenAnalysis` is duplicated in the push response and not stored as a
  separate database column. It is deterministic from stored schema/functions.

Tests prove:

- `push/start`, `push/:id`, and `push/:id/finish` return grouped
  `codegenAnalysis`, and
- local dev exposes the backend-returned grouped analysis and can still invoke
  generated functions after activation.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

### Phase 4 Step 4 Implementation Update

Previous completed checkpoint: `3cbd471` Return codegen analysis from push
start.

Added a local backend push coordinator boundary in `flarex-dev`.

The local dev reload loop now hands only the immutable source package to the
push coordinator:

```txt
initialCodegen()
  -> bundleFlarexSourcePackage()
  -> LocalBackendPushCoordinator.start(sourcePackage)
      -> local execution-artifact analysis
      -> POST /deployments/:deploymentId/push/start with analyzed metadata
  -> finalCodegen(context, started.codegenAnalysis)
  -> build generated app Worker
  -> LocalBackendPushCoordinator.finish(pushId)
```

This removes execution-artifact analysis from the visible local dev reload
path. The coordinator owns the local Miniflare artifact analyzer and the
translation from grouped codegen analysis to flattened backend activation
metadata.

Convex references copied in principle:

- `npm-packages/convex/src/cli/lib/components.ts`
  - the dev/deploy orchestration calls a backend push boundary rather than
    treating analysis as a separate application-level step.
- `crates/application/src/deploy_config.rs`
  - `start_push` owns evaluation/analysis before returning the deployment
    metadata needed by final codegen.

Intentional and temporary differences:

- Hosted Convex analysis happens inside the backend process. Flarex local dev
  cannot literally run Miniflare from inside the backend Worker/Durable Object,
  so the local backend coordinator is a Node-side stand-in for the hosted
  artifact service.
- The backend HTTP/DO API still accepts `analysis` in `StartPushRequest`.
  Removing that field requires a hosted or service-bound analyzer available to
  the backend runtime.
- The coordinator uses the local Miniflare adapter. Production should replace
  this with the hosted Dynamic Worker analysis/invocation adapter.

Tests prove:

- callers pass only `SourcePackage` to `LocalBackendPushCoordinator.start()`,
  and
- the coordinator owns artifact analysis and sends normalized analyzed metadata
  to backend `push/start`.

`flarex-dev` now has a package-level Vitest config with serial file execution,
matching the backend package. The dev tests create Vite/esbuild/Miniflare
runtimes; serial execution avoids Windows workspace-test resource exhaustion
while preserving the same assertions.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

### Phase 4 Step 5 Implementation Update

Previous completed checkpoint: `67b2e04` Move local analysis behind push
coordinator.

Split the prototype push API into a public source-only request and an internal
analyzed-candidate request.

Public request:

```ts
type StartPushRequest = {
  sourcePackage: PushSourcePackage;
};
```

Internal prototype request:

```ts
type AnalyzedStartPushRequest =
  | { sourcePackage: PushSourcePackage; analysis: DeploymentAnalysis }
  | { sourcePackage: PushSourcePackage; error: string };
```

Backend routes now behave as:

```txt
POST /deployments/:deploymentId/push/start
  source package only
  returns 501 until backend artifact analysis is configured

POST /deployments/:deploymentId/push/start-analyzed
  internal prototype route used by local dev coordinator
  stores analyzed/failed candidate in DeploymentDO
```

`LocalBackendPushCoordinator` now depends on a `BackendSourceAnalyzer`
interface. The local implementation, `LocalExecutionArtifactBackendAnalyzer`,
wraps the Miniflare execution-artifact adapter. The coordinator calls that
backend analyzer and then posts to the internal analyzed route. This keeps
analysis out of `StartPushRequest` while preserving the working local-dev
prototype.

Convex references copied in principle:

- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - the public push request sends source/config material to the backend push
    boundary; analyzed metadata is a backend result, not client-authored
    deployment truth.
- `crates/application/src/deploy_config.rs`
  - `start_push` evaluates and analyzes push contents before candidate
    activation.

Intentional and temporary differences:

- Convex does not need an exposed `start-analyzed` route. Flarex keeps this as
  an internal local-dev bridge until the backend runtime has a hosted Dynamic
  Worker analyzer service.
- `POST /push/start` currently returns 501 instead of analyzing because the
  Worker/Durable Object runtime cannot yet create candidate execution
  artifacts by itself.
- `DeploymentDO` still stores the same validated candidate schema/functions.
  Only the boundary shape changed.

Tests prove:

- public source-only `push/start` rejects with the expected backend-analysis
  not-configured error,
- internal `push/start-analyzed` still stores, supersedes, and activates
  candidates, and
- local dev's coordinator posts analyzed metadata only through the internal
  analyzed route.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

### Phase 4 Step 6 Implementation Update

Previous completed checkpoint: `c563d88` Make push start source-only.

Connected the public source-only `push/start` route to a backend analyzer
binding.

Backend behavior is now:

```txt
POST /deployments/:deploymentId/push/start
  -> read StartPushRequest { sourcePackage }
  -> call env.FLAREX_ANALYZER /analyze when configured
  -> forward { sourcePackage, analysis } to internal /push/start-analyzed
  -> return DeploymentDO PushStatus
```

If `FLAREX_ANALYZER` is not configured, the route still returns the explicit
501 analysis-not-configured error. That keeps hosted production honest until
the Dynamic Worker analyzer service is implemented.

Local dev configures `FLAREX_ANALYZER` as a Miniflare service binding backed
by `createLocalAnalyzerService()`. That service uses
`LocalExecutionArtifactBackendAnalyzer`, which wraps the local Miniflare
execution artifact adapter. `LocalBackendPushCoordinator` is now source-only
again and posts only to public `push/start`.

Convex references copied in principle:

- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - `StartPushRequest` carries source/config inputs; `StartPushResponse`
    carries backend-produced analysis.
- `npm-packages/convex/src/cli/lib/components.ts`
  - the client pushes source material and final codegen consumes the backend
    push response.
- `crates/application/src/deploy_config.rs`
  - backend `start_push` evaluates and analyzes candidate contents before
    activation.

Intentional and temporary differences:

- Convex performs analysis inside its backend isolate stack. Flarex local dev
  uses a service binding to a Node-side Miniflare analyzer because the hosted
  Dynamic Worker analyzer path is not implemented yet.
- `/push/start-analyzed` remains an internal prototype route behind the
  analyzer binding. It should disappear or become private platform plumbing
  once hosted backend analysis is real.
- Analyzer failures currently become failed push candidates. Later schema and
  module validation should preserve richer analysis logs and source positions.

Tests prove:

- source-only `push/start` still rejects when no analyzer binding exists,
- local dev supplies an analyzer service binding and successfully reloads via
  public `push/start`,
- the local analyzer service returns flattened backend deployment analysis,
  and
- the coordinator no longer sends analysis itself.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

### Phase 4 Step 7 Implementation Update

Previous completed checkpoint: `0a57edd` Analyze push source through backend
binding.

Added bounded analyzer diagnostics to the push contract and `DeploymentDO`
candidate state.

Backend behavior is now:

```txt
POST /deployments/:deploymentId/push/start
  -> call FLAREX_ANALYZER /analyze
  -> receive { analysis, diagnostics } or { error, diagnostics }
  -> store diagnostics with the analyzed or failed push
  -> return diagnostics from push/start and push/:id
```

`DeploymentDO` stores diagnostics in `pushes.diagnostics_json` and validates
at most the newest 100 entries. This mirrors Convex's bounded analysis log
retention rather than letting import-time output grow unbounded.

Convex references copied in principle:

- `crates/isolate/src/environment/analyze.rs`
  - `AnalyzeEnvironment` has `collected_logs: VecDeque<String>`.
  - analysis keeps a maximum of 100 import-time console log entries.
  - failed analysis appends collected logs to the deployment error message for
    push failure reporting.

Intentional and temporary differences:

- Convex appends collected import-time logs into the JavaScript analysis error
  string. Flarex stores structured `{ level, message }` diagnostics beside the
  error so the push API can later expose logs, warnings, and source-positioned
  diagnostics without reparsing text.
- Convex captures logs inside its Rust/V8 isolate. Flarex currently captures
  logs in the local Miniflare execution artifact and forwards them through the
  analyzer service binding. Hosted Flarex must move the same contract behind
  the Dynamic Worker analyzer runtime.
- Flarex currently captures `console.log`, `console.warn`, and `console.error`
  only. More console methods and source positions remain future work.

Tests prove:

- failed push candidates retain diagnostics when returned from `push/start` and
  later fetched by `push/:id`, and
- local execution-artifact analysis captures import-time console output before
  module analysis.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Runtime Materializer Cache Update

Previous completed checkpoint: `f88296c` Authorize artifact runtime calls.

The hosted runtime service path now has a materializer/cache abstraction. The
backend still sends an `ExecutionArtifactInvokePayload`, but the runtime
service can now materialize once and reuse the artifact for repeated invokes.

Added behavior:

- first invoke for an artifact calls `ExecutionArtifactMaterializer.materialize`,
- repeated invokes with the same `artifactId` and source package hash reuse the
  cached `MaterializedExecutionArtifact`,
- a reused `artifactId` with a different source package hash rematerializes,
- runtime service validates artifact identity headers before materialization.

Convex references inspected:

- `crates/application/src/module_cache/mod.rs`
  - cache key includes sha256 to avoid stale module reuse.
- `crates/node_executor/src/executor.rs`
  - executor request/response model includes source package identity and
    import/download timing.

Cloudflare difference:

- Flarex's cache currently lives in a service helper and is in-memory per
  runtime instance. It is not distributed and has no eviction policy yet.
- The actual materializer still needs to load/build a Cloudflare Dynamic Worker
  artifact from R2.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

### Phase 5 Step 1 Implementation Update

Previous completed checkpoint: `b3e17bb` Preserve analyzer diagnostics in
push state.

Added the first import-phase compatibility prelude to the local execution
artifact analyzer.

Before importing developer modules for analysis, the generated artifact now:

- captures console diagnostics,
- installs a fixed `Date.now()` and zero-argument `new Date()` timestamp,
- installs deterministic `Math.random()`,
- rejects import-time `fetch()`,
- rejects import-time `crypto.randomUUID()`,
- rejects import-time `crypto.getRandomValues()`,
- rejects import-time `performance.now()`.

Rejected import-time APIs throw clear deployment-analysis errors and append an
`error` diagnostic before the import fails. This makes failed analysis useful
to the pusher and keeps the candidate push state compatible with the structured
diagnostics added in the previous checkpoint.

Convex references copied in principle:

- `crates/isolate/src/environment/analyze.rs`
  - `AnalyzeEnvironment` seeds `ChaCha12Rng` from
    `udf_config.import_phase_rng_seed`.
  - `unix_timestamp()` returns `udf_config.import_phase_unix_timestamp`.
  - `crypto_rng()` rejects cryptographic randomness at import time.
  - `performance_now()` and `performance_time_origin()` reject the Performance
    API at import time.
  - `syscall()` and async syscall paths reject database/syscall use at import
    time.

Intentional and temporary differences:

- Convex enforces these rules inside its Rust/V8 isolate environment. Flarex
  currently enforces them in a generated Miniflare analysis prelude by patching
  globals before dynamic imports.
- Convex supports a configured import timestamp and RNG seed per deployment
  config. Flarex currently uses fixed prototype constants and must later make
  them deployment-configurable and persisted.
- This slice does not yet block database/syscall access because user code still
  has no analysis-time `ctx.db` or syscall capability. That must remain true
  when the hosted execution artifact runtime is added.
- Hosted Dynamic Worker analysis still needs probes to verify which globals can
  be patched consistently across cold isolates.

Tests prove:

- two separate local analysis artifacts observe identical import-time
  `Date.now()`, `new Date()`, and `Math.random()` diagnostics, and
- top-level `fetch`, `crypto.randomUUID`, `crypto.getRandomValues`, and
  `performance.now` fail analysis with structured diagnostics.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

### Phase 6 Step 2 Implementation Update

Previous completed checkpoint: `363d7e0` Add local execution artifact runtime
invoke.

Added the first execution artifact store boundary.

`flarex/artifacts` now owns the deterministic source-package manifest hash and
`ExecutionArtifactRef` validation. `DeploymentDO` uses that shared helper
instead of its previous local duplicate.

`flarex-dev` now has `ExecutionArtifactStore` and
`LocalInMemoryExecutionArtifactStore`. Local dev stores the source package
before `finish_push`, then validates the active deployment ref exists in the
store before invoking.

This gives Phase 6 the next missing abstraction:

```txt
sourcePackage
  -> ExecutionArtifactStore.put
  -> ExecutionArtifactRef
  -> finish_push active deployment
  -> ExecutionArtifactStore.get(ref)
  -> ExecutionArtifactRuntime.invoke(ref, request)
```

Convex references inspected:

- `crates/model/src/source_packages/mod.rs`
  - `SourcePackageModel::put` stores packages and returns durable
    `SourcePackageId`; `get` retrieves by ID.
- `crates/model/src/modules/types.rs`
  - module metadata carries `source_package_id`, environment, analyzed module
    metadata, and module `sha256`.
- `crates/application/src/application_function_runner/mod.rs`
  - execution retrieves source package metadata before constructing executor
    requests.

Cloudflare difference:

- Convex stores source packages in system tables backed by its database and
  module storage. Flarex's first implementation is an in-memory dev store.
- Hosted Flarex still needs durable artifact storage, runtime authorization,
  and Dynamic Worker loading from `ExecutionArtifactRef`.

Tests prove:

- identical source package manifests produce identical refs,
- changing a module hash changes the ref,
- local store retrieves the exact source package by ref,
- retrieved packages are cloned, and
- unknown refs fail with a clear error.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Runtime Capability Authorization Update

Previous completed checkpoint: `c623476` Route invoke through artifact
runtime.

The backend-to-execution-artifact runtime path now has an optional internal
capability token.

Added pieces:

- `Env.FLAREX_ARTIFACT_RUNTIME_TOKEN?: string` in `flarex-backend`.
- `ServiceBindingExecutionArtifactRuntime` attaches
  `Authorization: Bearer <token>` when the token is configured.
- generated execution artifacts accept `Env.FLAREX_INTERNAL_TOKEN?: string`.
- generated `/__flarex_internal/*` routes reject with `401` when
  `FLAREX_INTERNAL_TOKEN` is configured and the authorization header is absent
  or wrong.
- local dev remains compatible because the token is optional.

Current internal invoke shape:

```txt
backend Worker
  -> Authorization: Bearer <runtime capability>
  -> FLAREX_ARTIFACT_RUNTIME
  -> generated /__flarex_internal/invoke
```

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - executor requests include `auth_header` and a `callback_token` issued by
    the backend key broker.
- `crates/node_executor/src/executor.rs`
  - serialized executor requests include `backendCallbackToken`,
    `authHeader`, source package identity, and package hashes.

Cloudflare difference:

- Convex has a broader authenticated executor/callback protocol. Flarex now
  has only a narrow internal bearer capability for artifact runtime calls.
- This does not yet authenticate individual syscalls from generated user code.
  Syscalls still go through backend execution sessions and need their own
  session-scoped authorization hardening later.
- Token storage/rotation is not implemented. Hosted deployment should use
  Cloudflare secret bindings or another internal secret source.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

### Phase 6 Step 3 Implementation Update

Previous completed checkpoint: `bccc7cd` Add execution artifact store
boundary.

Added the hosted artifact store contract and R2-shaped adapter.

`R2ExecutionArtifactStore` writes two JSON objects per artifact:

```txt
artifacts/{artifactId}/manifest.json
artifacts/{artifactId}/source-package.json
```

The manifest records:

```ts
{
  version: 1,
  ref: ExecutionArtifactRef,
  sourcePackagePath: string,
}
```

Reads validate:

1. manifest exists,
2. manifest version is supported,
3. manifest ref matches the requested ref,
4. source package object exists, and
5. recomputed source package ref matches the requested ref.

Convex references inspected:

- `crates/model/src/source_packages/mod.rs`
  - source packages have a model-level `put`/`get` boundary.
- `crates/model/src/source_packages/types.rs`
  - package metadata includes storage key and `sha256`.
- `crates/application/src/application_function_runner/mod.rs`
  - executor setup resolves package storage metadata and passes package hash
    information to the executor.

Cloudflare difference:

- Convex stores source package metadata in system tables and packages in module
  storage. Flarex's hosted adapter is R2-shaped and stores a manifest plus the
  normalized source package JSON.
- This checkpoint does not add a real Worker binding, hosted Dynamic Worker
  loader, authorization, or garbage collection.

Tests prove:

- `put` writes source package and manifest JSON objects,
- `get` validates manifest and source package hash before returning,
- unknown artifact refs fail clearly,
- mismatched refs fail clearly, and
- `delete` removes both objects.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

### Architecture Terminology Cleanup

Previous completed checkpoint: `da42b4a` Add analysis import phase prelude.

Cleaned the deployment-analysis roadmap to match the current architecture
decision:

```txt
developer app
  hosted by the developer anywhere
  uses Flarex client APIs

flarex/ source package
  bundled by Flarex tooling
  pushed to the Flarex backend
  analyzed and executed by the Flarex-managed Dynamic Worker runtime
```

Removed stale hosted-platform dispatch wording and standardized the terms
`source package`, `Flarex-managed execution artifact`, and `Dynamic Worker
runtime`.

Convex reference remains the same:

- `npm-packages/convex/src/cli/lib/components.ts`
  - Convex pushes backend function modules, not the developer's whole
    application.
- `crates/application/src/deploy_config.rs`
  - backend deployment analysis and activation operate on uploaded module
    packages.

Cloudflare difference: Flarex still uses Cloudflare runtime isolation, but the
documented target is now specifically the Flarex-managed Dynamic Worker runtime
for the uploaded `flarex/` source package. The developer's application is not
part of that artifact.

Verification:

```sh
git diff --check
```

### Phase 5 Step 2 Implementation Update

Previous completed checkpoint: `d1b83a9` Clarify Dynamic Worker source package
architecture.

Added a cold-isolate consistency gate to the local backend analyzer boundary.

`LocalExecutionArtifactBackendAnalyzer` now analyzes the same source package
twice through the execution-artifact adapter. The two runs are separate
Miniflare execution artifacts when using the default local adapter. The
analyzer compares the returned deployment analysis JSON and rejects the push
candidate if the metadata differs:

```txt
Flarex analysis is nondeterministic across cold isolates.
```

Diagnostics from both analysis runs are preserved. On mismatch, the analyzer
throws `ExecutionArtifactAnalysisError` with both runs' diagnostics plus an
error diagnostic for the nondeterminism failure.

Convex references copied in principle:

- `crates/isolate/src/environment/analyze.rs`
  - `AnalyzeEnvironment` controls import-time timestamp, RNG, crypto,
    Performance API, syscalls, and logs so analysis is stable.
- `crates/application/src/deploy_config.rs`
  - candidate push analysis is a backend-side deployment gate before activation.

Intentional and temporary differences:

- Convex's backend isolate environment is controlled enough that it does not
  need to double-run every module analysis as a normal compatibility check.
  Flarex uses this extra local gate while the hosted Dynamic Worker analyzer
  contract is still being proven.
- The comparison currently uses deterministic JSON for the existing analysis
  shape. Once source positions and richer metadata are added, this comparison
  must either include canonicalization for those fields or explicitly exclude
  fields that are allowed to vary.
- Successful analysis returns diagnostics from both runs, so duplicate
  import-time logs are expected in local dev until diagnostics gain structured
  run/source labels.

Tests prove:

- local backend analysis calls the execution-artifact adapter twice and returns
  combined diagnostics when metadata is stable, and
- divergent metadata across the two runs fails analysis with preserved
  diagnostics.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

### Phase 5 Step 3 Implementation Update

Previous completed checkpoint: `c471b67` Gate analysis on cold isolate
consistency.

Added first-class source-position metadata to analyzed functions.

The Flarex analysis shape now carries:

```ts
type AnalyzedSourcePosition = {
  path: string;
  startLine: number;
  startColumn: number;
};
```

Local source-package analysis and local execution-artifact analysis both derive
positions from source-map `sourcesContent` by finding exported registered
function declarations. The metadata is preserved through:

- `DeploymentAnalysis`,
- analyzer-service flattening,
- `DeploymentDO` candidate push state,
- active `functions` table metadata via `position_json`,
- `codegenAnalysis`,
- generated `functionMetadata.ts`.

Convex references copied in principle:

- `crates/model/src/modules/module_versions.rs`
  - `AnalyzedSourcePosition` stores source path, start line, and start column
    on `AnalyzedFunction`.
- `crates/isolate/src/environment/analyze.rs`
  - Convex reads handler script line/column, resolves it through the module
    source map, and stores the mapped source position when valid.

Intentional and temporary differences:

- Convex resolves the actual handler function origin from V8 and maps that
  token through the source map. Flarex currently scans original source text for
  `export const name =` or `export default` declarations. This is deterministic
  and useful, but less precise for aliases, reexports, and handler properties.
- Flarex exposes `startLine` and `startColumn` as one-based camelCase fields.
  Convex's serialized Rust model uses `start_lineno` and `start_col`.
- Source positions are now part of the cold-isolate comparison. Any future
  richer position metadata must remain canonical or be explicitly excluded.

Tests prove:

- local execution-artifact analysis reports a stable position for an exported
  function in `users.ts`,
- analyzer-service flattening preserves positions, and
- backend push state and reconstructed `codegenAnalysis` preserve positions.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

### Phase 5 Step 4 Implementation Update

Previous completed checkpoint: `6db912b` Preserve analyzed function source
positions.

Added the first active deployment pointer to `DeploymentDO`.

`finish_push` now records:

```txt
meta.active_push_id
meta.active_activated_at
```

and `GET /deployments/:deploymentId/deployment` returns:

```ts
type ActiveDeploymentStatus = {
  activePushId: string;
  activatedAt: number;
  schemaVersion: number;
  sourcePackage: PushSourcePackage;
  analysis: DeploymentAnalysis;
  codegenAnalysis: DeploymentCodegenAnalysis;
};
```

This keeps the active deployment version separate from candidate push state.
Starting a push still stores a candidate and leaves active deployment metadata
unchanged until `finish_push` succeeds.

Convex references copied in principle:

- `crates/application/src/deploy_config.rs`
  - `finish_push` is the activation boundary for checked deployment contents.
- `crates/model/src/modules/mod.rs`
  - active module metadata is applied as durable deployment state and used for
    later function resolution.

Intentional and temporary differences:

- Convex stores richer module/config versions. Flarex currently points to the
  activated push row and keeps the source package inline in Durable Object
  SQLite as prototype storage.
- There is no active Dynamic Worker artifact pointer yet. That field should be
  added when hosted source-package loading is implemented.
- Legacy direct `/schema` and `/functions` PUT routes can still mutate active
  metadata without setting an active push pointer. Those routes remain
  prototype/test helpers and should be removed from normal deployment flow.

Tests prove:

- a candidate push does not create an active deployment before finish,
- finishing a push records the active push, schema version, source package, and
  analyzed metadata, and
- a later failed finish on a superseded push does not move the active pointer.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Create-Root Artifact Invoke Activation

Previous completed checkpoint: `10c02a4` Run create-root execution sessions.

The deployment push and artifact runtime path now allows active
`partitionCreateRoot` metadata to reach execution instead of being stopped by
client/generator request shaping.

Updated flow:

```txt
push/start-analyzed
  -> active metadata includes partitionCreateRoot
public /invoke without partitionKey
  -> active deployment artifact runtime
  -> materialized source package
  -> ExecutionDO.start without partitionKey
  -> backend preallocates root id
```

Convex references:

- `crates/model/src/modules/mod.rs`
  - analyzed function metadata is durable deployment state.
- `crates/application/src/application_function_runner/mod.rs`
  - active deployment metadata drives function execution.
- `crates/model/src/source_packages/mod.rs`
  - source packages are loaded by backend-controlled identity.

Cloudflare difference: Flarex public invoke must allow missing `partitionKey`
for create-root artifact invocations. Existing-root invocations are still
validated by active function partition metadata once `ExecutionDO.start` runs.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/artifactRuntimeRoute.test.ts --maxWorkers=1
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Root Partition Analysis Lowering

Checkpoint: `40b9999` Infer existing root partitions from model table.

Previous completed checkpoint: `3bd5d77` Generate root model objects.

Deployment analysis now accepts the root model marker emitted by
`partition: model.table` and lowers it before metadata leaves analysis. This
keeps the authoritative deployment artifact compatible with the existing
selector-shaped function metadata and backend routing model.

Analysis rule:

- `partition: model.users` is valid only when args contain exactly one required
  `v.id("users")` field.
- The analyzer lowers that declaration to `model.users.byId("fieldName")`
  metadata and fills the route from the same arg when no explicit route exists.
- Multiple required ids for the same root table are rejected as ambiguous.
- No id is rejected. For mutations the error explicitly calls this
  unimplemented create-root mode.
- `model.table` is rejected for non-`_id` partition roots. Those tables must use
  the explicit generated selector.

The same logic was added to:

- `packages/flarex-dev/src/analyze.ts`
- the embedded Miniflare execution-artifact analyzer in
  `packages/flarex-dev/src/executionArtifact.ts`

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - Convex records analyzed module/function metadata as the deployment truth.
- `crates/application/src/application_function_runner/mod.rs`
  - execution consumes backend-owned source package and function metadata.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated code is completed from analysis output, not only local source
    scanning.

Cloudflare difference:

- Convex analysis does not need to derive a `PartitionDO` route. Flarex lowers
  root model declarations to existing selector metadata so hosted push,
  generated API metadata, client inference, and backend invoke all continue to
  agree on one partition key.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter @flarex/example generate
```

## Create-Root Analysis Classification

Checkpoint: `601256a` Classify create-root partition analysis.

Previous completed checkpoint: `14c303e` Prefer root model partitions in
example.

Deployment analysis now distinguishes create-root declarations from invalid
root declarations. For a root table partitioned by `_id`:

- exactly one required `v.id(table)` arg still lowers to selector metadata,
- zero required `v.id(table)` args on `mutation` or `workflowMutation` becomes
  `partitionCreateRoot`,
- zero required root ids on query/action remains invalid, and
- multiple required root ids remain invalid as ambiguous.

The policy shape is:

```ts
{
  type: "partitionCreateRoot",
  table: string,
  partitionField: "_id",
}
```

The embedded Miniflare execution-artifact analyzer returns the same shape, so
backend-style analysis and local direct analysis agree. Final codegen rejects
the policy until root id preallocation and create-root invocation are
implemented.

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - deployment analysis stores function metadata as an explicit model.
- `crates/application/src/application_function_runner/mod.rs`
  - execution reads backend-owned deployment metadata before running user code.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated files should reflect backend analysis and fail early on
    unsupported analyzed metadata.

Cloudflare difference:

- Convex can allocate new document ids inside the same database transaction.
  Flarex cannot choose a root `PartitionDO` for a new root document unless the
  backend allocates the root id before invoking user code.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
```

## Backend Create-Root Metadata Acceptance

Previous completed checkpoint: `601256a` Classify create-root partition
analysis.

Deployment metadata validation now accepts `partitionCreateRoot` as a first
class analyzed partition policy. `DeploymentDO` validates that:

- the target table exists and is active,
- the table is `partitionBy("_id")`, and
- create-root metadata does not also declare route metadata.

This lets backend push state preserve create-root analysis metadata without
pretending generated clients can execute it yet.

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - analyzed module/function metadata is a durable deployment model.
- `crates/application/src/application_function_runner/mod.rs`
  - execution consumes validated deployment metadata.

Cloudflare difference:

- Flarex deployment metadata must carry enough routing intent to choose a
  Durable Object. Convex does not need create-root routing metadata because id
  allocation and commit happen inside one logical database.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Backend Artifact Runtime Invoke Update

Previous completed checkpoint: `804a055` Add backend artifact storage binding.

Public backend invoke can now route through a backend-owned execution artifact
runtime boundary when hosted artifact bindings are configured.

Added backend pieces:

- `packages/flarex-backend/src/artifactRuntime.ts`
  - `BackendExecutionArtifactRuntime`
  - `ServiceBindingExecutionArtifactRuntime`
  - `ExecutionArtifactInvokePayload`
- optional `Env.FLAREX_ARTIFACT_RUNTIME?: Fetcher` binding.
- `/deployments/:deploymentId/invoke` now:
  - parses the normal `InvokeRequest`,
  - loads the active deployment metadata,
  - loads the active source package from `ARTIFACTS` using
    `executionArtifactRef`,
  - forwards a normalized payload to `FLAREX_ARTIFACT_RUNTIME`,
  - falls back to the prototype in-process registry when artifact runtime
    bindings are absent.

Current hosted invoke path:

```txt
POST /deployments/:deploymentId/invoke
  -> load active deployment
  -> active executionArtifactRef
  -> R2BackendExecutionArtifactStore.get(ref)
  -> FLAREX_ARTIFACT_RUNTIME /invoke
  -> generated execution artifact /__flarex_internal/invoke
  -> backend execution session syscalls
```

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - Node execution resolves `SourcePackageModel::get_latest`, signs the stored
    package URL, and sends package key/hash metadata to the executor.
- `crates/model/src/source_packages/mod.rs`
  - source package identity is durable backend model state.
- `crates/model/src/source_packages/types.rs`
  - source packages carry storage key and hash metadata used by execution.

Cloudflare difference:

- Convex sends signed storage URLs and package hashes to a Node executor.
  Flarex currently loads the source package JSON from R2 in the backend Worker
  and sends it to a runtime service binding.
- The real hosted Dynamic Worker loader should eventually materialize the
  internal execution artifact from this package/ref without sending raw source
  through a public API.
- Runtime authorization is still missing. `FLAREX_ARTIFACT_RUNTIME` must become
  an internal-only capability before this path is production safe.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Local Source Package Runtime Materializer Update

Previous completed checkpoint: `0447832` Add artifact runtime materializer cache.

The hosted invoke path now has a concrete local materializer proof. The backend
public invoke route still owns the active deployment lookup and R2 source
package load. The artifact runtime service now can materialize that package
into a Worker-shaped execution artifact and run the active function through
backend execution sessions.

Proven path:

```txt
POST /deployments/:deploymentId/invoke
  -> load active deployment
  -> R2BackendExecutionArtifactStore.get(executionArtifactRef)
  -> FLAREX_ARTIFACT_RUNTIME /invoke
  -> LocalMiniflareExecutionArtifactMaterializer.materialize(sourcePackage)
  -> generated internal /__flarex_internal/invoke wrapper
  -> backend /executions/start + syscalls + finish
```

The new integration test starts an analyzed push, stores the exact source
package in R2, finishes activation, invokes a mutation that performs
`insert()` then `patch()`, invokes a query through an index, and verifies the
artifact is materialized once then reused from the runtime cache.

Convex references copied in principle:

- `crates/application/src/application_function_runner/mod.rs`
  - active deployment execution resolves package identity before executor
    invocation.
- `crates/application/src/module_cache/mod.rs`
  - reusable loaded module state is keyed by package/module identity.
- `crates/node_executor/src/executor.rs`
  - execution is a separate executor boundary reached with package metadata.

Intentional differences:

- Flarex local development uses Miniflare as the concrete materializer instead
  of Convex's Rust/V8 runner or Node executor.
- The runtime wrapper is generated by Flarex around the stored source package.
  The developer still does not write Worker code.
- Hosted Flarex still needs the real Dynamic Worker loader, runtime eviction,
  and source-map diagnostics. The materializer contract is the boundary those
  hosted pieces should implement.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- artifactRuntimeRoute.test.ts
```

## Local Dev Uses Hosted Push/Invoke Shape Update

Previous completed checkpoint: `c8c16bb` Materialize stored source packages
locally.

Local dev now configures the backend Miniflare runtime with:

- `ARTIFACTS` R2 bucket,
- `FLAREX_ARTIFACT_RUNTIME` service binding,
- `FLAREX_ARTIFACT_RUNTIME_TOKEN`,
- `LocalMiniflareExecutionArtifactMaterializer`.

That means public local push and invoke now share the hosted deployment shape:

```txt
push/start
  -> backend analyzer service
  -> backend stores source package in ARTIFACTS
  -> finish activates executionArtifactRef

/__flarex_dev/invoke
  -> backend /deployments/:deploymentId/invoke
  -> active executionArtifactRef
  -> ARTIFACTS get(source package)
  -> artifact runtime service
  -> materialized source package execution
```

Convex references copied in principle:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - local dev uses the deployment push loop rather than a separate app-owned
    execution model.
- `crates/application/src/deploy_config.rs`
  - source packages are part of backend deployment state before activation.
- `crates/application/src/application_function_runner/mod.rs`
  - active deployment metadata controls function execution.

Intentional difference: Flarex still keeps generated app Worker support for
compatibility and future `/sync`, but normal dev invoke now goes through the
backend artifact runtime. Hosted production should keep this route shape and
swap the Miniflare materializer for the Dynamic Worker loader.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- dev.test.ts
```

## Runtime-Owned Source Package Loading Update

Previous completed checkpoint: `ef50030` Use artifact runtime for local dev
invoke.

The artifact runtime service can now own source-package loading. Runtime invoke
payloads may omit `sourcePackage` when the runtime service is configured with a
`BackendExecutionArtifactStore`; the service resolves the active
`executionArtifactRef` from its own store before materializing.

The backend service-binding runtime keeps compatibility mode by default, but
can now be configured with:

```ts
sendSourcePackage: false
```

The backend Worker exposes that through:

```txt
FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE=true
```

Local dev uses this hosted shape:

```txt
backend /deployments/:deploymentId/invoke
  -> send deploymentId + executionArtifactRef + request only
  -> FLAREX_ARTIFACT_RUNTIME
  -> runtime R2 ARTIFACTS get(ref)
  -> materialize source package
  -> execute through backend sessions
```

Convex references copied in principle:

- `crates/application/src/application_function_runner/mod.rs`
  - executor requests carry package identity and hash rather than requiring
    the application invoke path to own module bytes.
- `crates/model/src/source_packages/mod.rs`
  - source packages are durable backend state retrieved by package identity.
- `crates/node_executor/src/executor.rs`
  - execution is a package-loader boundary, not an inline source transport
    boundary.

Cloudflare difference: this is still a Miniflare/R2 local proof. Hosted Flarex
should use the same runtime-store contract with the Dynamic Worker loader.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- artifactRuntime.test.ts
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts dev.test.ts
```

## Artifact Runtime Lifecycle Update

Previous completed checkpoint: `e1ccf14` Let artifact runtime load source
packages.

The execution artifact runtime service now exposes a lifecycle surface:

```ts
dispose(): Promise<void>
cacheSize(): number
```

and cached materialized artifacts may implement:

```ts
dispose?(): Promise<void> | void
```

The runtime cache disposes artifacts when they are evicted, replaced by a new
source hash, or cleared by service disposal.

Convex references copied in principle:

- `crates/application/src/module_cache/mod.rs`
  - loaded module state is cached by identity and owned by the runtime layer.
- `crates/application/src/application_function_runner/mod.rs`
  - execution uses cached runtime state behind an application runner boundary.

Intentional difference: Flarex exposes this lifecycle at the TypeScript
runtime-service boundary because the hosted Dynamic Worker implementation is
still being prototyped. The public developer push/invoke API is unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- artifactRuntime.test.ts
```

### Phase 5 Step 5 Implementation Update

Previous completed checkpoint: `b08269e` Record active deployment pointer on
finish.

Runtime function resolution now prefers the active deployment analysis.

`packages/flarex-backend/src/invoke.ts` added active deployment loaders:

```ts
loadActiveDeployment(env, deploymentId)
loadActiveFunctionMetadata(env, deploymentId, path)
```

`ExecutionDO.start` now resolves:

```txt
DeploymentDO.active_push_id
  -> active push analysis.schema
  -> active push analysis.functions.functions[path]
  -> argument validation
  -> partition schema sync
  -> transaction begin
```

This means a generated execution session cannot start from a stale mutable
`/functions` table entry after a different push is active. The activated push
analysis is the contract used for function kind, argument validator, return
validator, and schema metadata.

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - `ValidatedPathAndArgs` and `FunctionMetadata` are passed into isolate
    execution after backend validation.
  - `run_mutation_inner` resolves validated path/args and return validator
    before executing the mutation and validating the outcome.
- `crates/application/src/lib.rs`
  - deployment/module analysis metadata is written before functions are run
    through the application function runner.

Cloudflare difference:

- Convex runs the analyzed module through its Rust-managed isolate runner.
  Flarex currently runs generated local execution sessions and syscalls, so
  this checkpoint makes the metadata boundary authoritative before the hosted
  Flarex-managed Dynamic Worker runtime exists.
- `executeInvoke` still has a no-active-deployment fallback for low-level
  transaction tests and prototypes. When an active deployment exists, it
  rejects paths missing from active analysis before handler execution.

Known follow-up:

- Add an active execution artifact reference alongside `active_push_id`.
- Route hosted Dynamic Worker invocation through that active artifact reference
  instead of the generated local execution harness.
- Remove normal use of legacy direct `/schema` and `/functions` mutation
  routes from development and deployment flows.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

### Phase 5 Step 6 Implementation Update

Previous completed checkpoint: `4a6e66f` Resolve execution sessions from
active deployment.

Active deployment status now includes a deterministic execution artifact
reference:

```ts
type ExecutionArtifactRef = {
  runtime: "dynamic-worker";
  artifactId: string;
  sourcePackageHash: string;
  executionModule: string;
};
```

`finish_push` computes the reference from a canonical source-package manifest,
stores it in:

```txt
meta.active_execution_artifact_ref
```

and `GET /deployments/:deploymentId/deployment` returns it next to
`activePushId`, source package, schema, function analysis, and codegen
analysis.

The source package hash is based on:

- execution module path,
- schema module path,
- function module paths,
- each module path,
- each module environment, and
- each module `sha256`.

It intentionally does not hash raw source text directly because each module
hash is already the source/source-map identity in the current source package
contract.

Convex references inspected:

- `crates/model/src/source_packages/mod.rs`
  - `SourcePackageModel::put` stores source packages as durable deployment
    metadata and returns a `SourcePackageId`.
- `crates/model/src/modules/types.rs`
  - active module metadata stores `source_package_id`, environment, analyzed
    metadata, and module `sha256`.
- `crates/application/src/application_function_runner/mod.rs`
  - function execution can resolve source package metadata and pass package
    identity/hash information into executor requests.

Cloudflare difference:

- Convex uses database-backed source package documents and module metadata.
  Flarex currently stores a deterministic artifact reference in
  `DeploymentDO` metadata and still keeps the source package JSON inline in
  Durable Object SQLite.
- The reference is not yet backed by R2, KV, or a hosted Dynamic Worker
  artifact registry. It is the stable pointer that the hosted runtime will
  consume later.

Tests prove:

- active deployment returns the expected artifact reference,
- superseded push finish attempts do not move the active artifact reference,
  and
- a later activated push moves both `activePushId` and
  `executionArtifactRef` together.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

### Phase 6 Step 1 Implementation Update

Previous completed checkpoint: `d5e13dd` Store active execution artifact
reference.

Added the first invoke-side execution artifact runtime boundary in local dev.

The active deployment record's `executionArtifactRef` is now consumed by
`createFlarexDevRuntime` when handling:

```txt
POST /__flarex_dev/invoke
```

Local dev resolves the active deployment from the backend, passes its
`executionArtifactRef` to `LocalMiniflareExecutionArtifactRuntime`, and invokes
the generated execution artifact through:

```txt
POST /__flarex_internal/invoke
```

The generated Worker still supports public `/invoke`, but it also exposes the
internal artifact endpoint required by the future hosted Dynamic Worker
adapter.

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - source package identity and package hashes are passed into executor
    requests when execution happens outside the main Rust isolate path.
- `crates/model/src/source_packages/mod.rs`
  - source packages are durable deployment metadata looked up for execution.

Cloudflare difference:

- Convex has a mature isolate/node executor selection path. Flarex currently
  models that as an `ExecutionArtifactRuntime` interface and a local Miniflare
  implementation.
- The hosted Dynamic Worker adapter does not exist yet. This checkpoint only
  makes invocation depend on `executionArtifactRef` through a replaceable
  runtime boundary.

Tests prove:

- the local runtime adapter calls `/__flarex_internal/invoke` with artifact
  identity headers,
- generated Worker code includes the internal invoke route, and
- local dev exposes the active deployment `executionArtifactRef` while
  `/__flarex_dev/invoke` still reaches backend execution sessions/syscalls.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

### Phase 5: Import-Phase Compatibility Layer

1. Port Convex's import-phase restrictions into the Flarex execution-artifact
   runtime where Cloudflare permits.
2. Add static bundle checks for import-time capabilities that cannot be safely
   controlled.
3. Add cold-isolate consistency tests for analyzed function metadata.
4. Block hosted activation until candidate analysis satisfies the import-phase
   contract.

### Phase 6: Hosted Dynamic Worker Runtime

1. Store immutable candidate source packages.
2. Build or load internal execution artifacts for those source packages.
3. Invoke internal analysis through the Dynamic Worker analyzer boundary.
4. Apply CPU, subrequest, egress, and import-phase restrictions.
5. Route invocation through the active execution-artifact pointer.
6. Garbage-collect failed and superseded candidates.

### Phase 7: Schema Validation And Activation

1. Port schema diff and push race detection semantics.
2. Validate existing shard documents against candidate schemas.
3. Track index creation/backfill status across relevant partitions.
4. Activate candidate metadata and execution artifact atomically in
   `finish_push`.

## Required Tests

- Registration metadata matches Convex-style markers and validator exporters.
- Undefined validators fail during analysis with useful source context.
- Non-function exports are ignored.
- Invalid registered exports fail the push.
- Import-time database, syscall, crypto-randomness, and external-I/O attempts
  fail analysis.
- Separate cold analysis isolates produce identical authoritative metadata.
- Function name, kind, visibility, args, returns, and source positions survive
  bundle -> analysis -> persistence -> invocation.
- Schema is evaluated independently from function modules.
- Failed candidate analysis leaves the active deployment unchanged.
- Concurrent pushes produce a deterministic race/superseded result.
- Final codegen consumes backend analysis, not local source scanning.
- Local Miniflare and hosted Dynamic Worker adapters pass the same push
  contract suite.
- Runtime invocation resolves only active authoritative metadata.

## Known Intentional Differences

- Flarex adds `workflowMutation`; Convex has query, mutation, and action UDF
  types.
- Flarex uses a Flarex-managed Dynamic Worker runtime instead of Convex's
  Rust/V8 function runner.
- Flarex may initially enforce a stricter import-time API subset where
  Cloudflare cannot reproduce Convex's controlled import environment.
- Flarex schema validation and index preparation must account for partitioned
  Durable Object storage rather than one Convex deployment database.

These differences must remain isolated behind execution-artifact, schema
validation, and partition coordination boundaries. The developer-facing module,
analysis, validation, and push mental model should remain as close to Convex as
possible.

## Verification

Documentation and research only:

```sh
git diff --check
```

## Implementation Checkpoints

### `5b61214` Add Convex-style function registration contract

Added Convex-style function registration forms, runtime markers, validator
exporters, internal actions, strict serialization, tests, and the detailed
deployment-analysis plan in this roadmap.

### `101eb89` Analyze Convex-style function metadata

Changed local analysis to classify functions from Convex-style runtime markers,
call validator exporters, validate their JSON, and return normalized argument
and return metadata.

### `0ff9e46` Generate metadata from analyzed functions

Changed final codegen and generated Worker validation to consume static
analyzed metadata while limiting the runtime registry to executable `_handler`
lookup.

### `9eaf596` Bundle deterministic Flarex source packages

Split generation into explicit phases and added deterministic, source-mapped,
hashed function, schema, and internal execution bundles that local analysis can
consume without developer filesystem access.

### `054a81e` Analyze schema from Flarex source packages

Changed local source-package analysis to return both analyzed functions and
analyzed schema, then made final codegen and generated Worker runtime consume
that complete deployment analysis.

### `e2f28b8` Add backend deployment push lifecycle

Added backend candidate push routes and `DeploymentDO` push state so analyzed
source packages can be started, inspected, superseded, failed, and atomically
activated.

### `7abaa43` Use backend push lifecycle in local dev

Changed local dev reload to start and finish backend candidate pushes instead
of deploying schema/functions through the legacy direct metadata routes that
existed at that checkpoint.

### `27bb9f5` Analyze source packages in execution artifact

Added the local Miniflare execution-artifact analyzer and wired local
generation/dev reload to analyze immutable source packages through that
Cloudflare-shaped boundary.

### `3cbd471` Return codegen analysis from push start

Added `codegenAnalysis` to backend push status and changed local dev final
codegen to consume the backend push response.

### `67b2e04` Move local analysis behind push coordinator

Added `LocalBackendPushCoordinator`, moved local artifact analysis out of the
dev reload loop, and made `flarex-dev` tests run serially for stable
Vite/esbuild/Miniflare execution on Windows.

### `b3e17bb` Preserve analyzer diagnostics in push state

Added structured analyzer diagnostics to the push contract, persisted them in
`DeploymentDO`, and captured import-time console output in the local execution
artifact analyzer.

### `d1b83a9` Clarify Dynamic Worker source package architecture

Cleaned stale hosted-platform dispatch wording and clarified that Flarex
bundles only the uploaded `flarex/` source package for its managed Dynamic
Worker runtime.

### `c471b67` Gate analysis on cold isolate consistency

Added a local analyzer gate that analyzes the same source package twice through
fresh execution artifacts and rejects nondeterministic analyzed metadata before
the backend stores it.

### `6db912b` Preserve analyzed function source positions

Added source-position metadata to analyzed functions and preserved it through
local analysis, backend push state, active function metadata, codegen analysis,
and generated function metadata.

## Partition Metadata Runtime Binding Update

## Root Model Partition Analysis Plan

Checkpoint title: `Plan explicit partition table API`

Previous completed checkpoint: `ff5dae0` Generate partition-scoped mutation
types.

The v1 partition API target changes analysis from selector metadata to root
model metadata:

```ts
partition: model.documents
```

Analysis should resolve that declaration into one of these backend policies:

- existing root partition: exactly one required `v.id("documents")` argument
  exists, so the backend routes from that argument,
- create root partition: mutation has zero required `v.id("documents")`
  arguments, so the backend preallocates a root ID before execution,
- invalid: query has zero root IDs, or query/mutation has multiple required
  root IDs for the same root table.

What changed:

- The roadmap now treats `model.<rootTable>` as the final v1 metadata source.
- `model.<rootTable>.byId("arg")` remains a compatibility shape from the
  previous prototype.
- Backend analysis must own ambiguity rejection. Generated TypeScript may help,
  but deployment analysis is the authority.

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - analyzed function metadata is durable backend state.
- `crates/application/src/application_function_runner/mod.rs`
  - runtime function execution consumes analyzed deployment metadata.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated files are written from analysis results.
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
  - generated server APIs expose app-specific helper objects.

Cloudflare difference:

- Convex does not analyze shard-routing metadata because function execution
  targets one logical deployment database. Flarex analysis must produce a
  concrete root partition policy before invocation can start.

Remaining limitations:

- Current analysis extracts `exportPartition()` selector objects with
  `argField`.
- Active backend metadata has no create-mode partition policy yet.
- Final codegen still emits selector-based model helpers.
- `model.<rootTable>.byId(...)` must stay until active deployment metadata,
  runtime invocation, sync, and generated clients support root-model policies.

Verification:

```sh
Documentation-only change; no runtime validation required.
```

## Root Model Migration Order

Checkpoint title: `Document root model migration order`

Previous completed checkpoint: `fa7bf98` Add explicit schema table
constructors.

What changed:

- Documented that deployment analysis is the blocker for removing
  selector-style model helpers.
- Analysis must eventually convert `partition: model.<rootTable>` into one of:
  - existing-root policy with the inferred root ID argument,
  - create-root policy requiring backend preallocation,
  - analysis error for query create mode or ambiguous multiple root IDs.
- Until those policy shapes are active metadata, `.byId(...)` remains a
  required compatibility helper.

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - analyzed function metadata is the durable deployment contract.
- `crates/application/src/application_function_runner/mod.rs`
  - invocation consumes analyzed metadata, not ad hoc client intent.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - codegen should follow authoritative analysis output.

Cloudflare difference:

- Convex analysis does not need to encode a `PartitionDO` route. Flarex must
  preserve selector metadata until the new root-model policy can drive Durable
  Object selection and root allocation.

Remaining limitations:

- No root-model policy type exists in `DeploymentAnalysis` or active backend
  function metadata yet.
- No create-root preallocation path exists in execution sessions.

Verification:

```sh
Documentation-only change; no runtime validation required.
```

## Required Partition Metadata Runtime Update

Checkpoint title: `Require partition metadata for execution`

Previous completed checkpoint: `7673d45` Bind execution sessions to partition
metadata.

The analyzed `partition` field is now required for normal backend execution.
Route metadata and raw `partitionKey` are no longer accepted as fallback
authority paths.

What changed:

- Backend execution rejects active query/mutation metadata without
  `partition`.
- Route metadata remains stored and propagated for compatibility, but runtime
  scope resolution does not use it unless a partition descriptor is already
  present and needs consistency checking.
- Direct legacy test fixtures were updated to include partition metadata and
  owner tables where colocated tables need a partition root.

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - deployment metadata is the backend-owned function authority.
- `crates/application/src/application_function_runner/mod.rs`
  - active deployment metadata selects the function execution context.
- `crates/function_runner/src/lib.rs`
  - backend-owned transaction state, not client input, determines execution.

Cloudflare difference:

- Flarex's deployment metadata must include enough information to choose a
  concrete `PartitionDO`. Convex does not store this extra partition selector
  because its backend database is logically global.

Remaining limitations:

- The legacy direct `/functions` metadata route can still store functions
  without partition metadata, but those functions cannot execute through
  normal invoke/session paths.
- Future global/projection/workflow metadata should add explicit non-partition
  policies instead of reintroducing raw `partitionKey` authority.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Partition Metadata Runtime Binding Update

Checkpoint title: `Bind execution sessions to partition metadata`

Previous completed checkpoint: `231447a` Preserve partition selector metadata.

The analyzed and stored `partition` metadata now participates in backend
execution, not only in generated files and push validation.

What changed:

- `DeploymentFunctionMetadata.partition` is resolved into a
  `FunctionExecutionScope` at execution start.
- Direct `/invoke` and `ExecutionDO` both prefer stored partition metadata over
  route metadata when validating the target shard.
- The backend rechecks that the partition descriptor still matches the active
  schema before opening a `PartitionDO` transaction. At this checkpoint that
  also protected prototype direct metadata routes; those public routes were
  later removed.
- Added regression coverage for stored metadata in the direct invoke and
  execution-session paths.

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - analyzed function metadata is backend deployment state.
- `crates/application/src/application_function_runner/mod.rs`
  - active deployment metadata selects the function execution context.
- `crates/function_runner/src/lib.rs`
  - execution merges user-code reads and writes into backend-owned transaction
    state.

Cloudflare difference:

- Convex does not have to turn function metadata into a Durable Object name.
  Flarex must resolve `partition.table/selector/argField` into a concrete
  `PartitionDO` key before starting the transaction.

Remaining limitations:

- Runtime binding does not remove the legacy explicit `partitionKey` transport
  field yet; generated clients still send it.
- This does not yet persist execution-session state across `ExecutionDO`
  eviction.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Partition Metadata Analysis Update

Checkpoint title: `Preserve partition selector metadata`

Previous completed checkpoint: `63896da` Generate model partition selectors.

Deployment analysis now treats function partition selectors as authoritative
metadata, not just local codegen sugar.

What changed:

- Local source-package analysis reads each function's `exportPartition()`
  marker and returns partition metadata in `DeploymentAnalysis`.
- The embedded execution-artifact analyzer performs the same extraction inside
  the backend-shaped isolate boundary.
- `LocalBackendPushCoordinator` and backend analysis conversion preserve
  partition metadata into the analyzed push request.
- `DeploymentDO` persists `partition_json` on active functions and exposes it
  through `/functions`, active deployment status, and push `codegenAnalysis`.
- Backend validation cross-checks partition metadata against the analyzed
  schema before a candidate push can be stored:
  - target table must exist and be active,
  - target table must use `partitionBy`,
  - selector and partition field must match the schema placement,
  - the referenced argument must be required,
  - explicit `route` metadata must match the partition argument.

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - analyzed function metadata is stored as backend-owned deployment state.
- `npm-packages/convex/src/server/impl/registration_impl.ts`
  - runtime function wrappers export validator metadata for backend analysis.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final codegen is derived from backend/analyzed metadata.

Cloudflare difference:

- Convex analysis validates function/module metadata but does not need to bind
  functions to user-visible shard selectors. Flarex must validate this extra
  partition selector because it determines which `PartitionDO` owns execution
  and OCC.

Remaining limitations:

- Push validation proves the declared route and schema match; it does not yet
  prove every future `ctx.db` access stays inside the scoped placement at the
  TypeScript level.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
```

## Backend Artifact Storage Binding Update

Previous completed checkpoint: `873fee7` Add R2 execution artifact store
adapter.

`flarex-backend` now owns the first hosted artifact-storage boundary instead
of depending on `flarex-dev` infrastructure code.

Added backend pieces:

- `packages/flarex-backend/src/artifactStore.ts`
  - `BackendExecutionArtifactStore`
  - `R2BackendExecutionArtifactStore`
  - `manifestKey(ref)`
  - `sourcePackageKey(ref)`
- optional `Env.ARTIFACTS?: R2Bucket` binding.
- public `push/start` persists the uploaded source package after successful
  backend analysis when `ARTIFACTS` is configured.
- public `push/:pushId/finish` verifies that the analyzed push's execution
  artifact exists in durable storage before forwarding activation to
  `DeploymentDO`.

Current public hosted path:

```txt
POST /deployments/:deploymentId/push/start
  -> FLAREX_ANALYZER analyzes uploaded flarex/ source package
  -> R2BackendExecutionArtifactStore.put(sourcePackage)
  -> DeploymentDO /push/start-analyzed

POST /deployments/:deploymentId/push/:pushId/finish
  -> load candidate push metadata
  -> recompute executionArtifactRef
  -> verify R2 manifest/source package
  -> DeploymentDO finish_push activates candidate
```

The stored object layout matches the local/dev R2-shaped adapter:

```txt
artifacts/{artifactId}/manifest.json
artifacts/{artifactId}/source-package.json
```

Convex references inspected:

- `crates/model/src/source_packages/mod.rs`
  - `SourcePackageModel::put` and `get` store source package metadata as
    backend-owned durable state.
- `crates/model/src/source_packages/types.rs`
  - `SourcePackage` tracks storage key, package hash, package size, external
    dependency package, and runtime node version metadata.
- `crates/application/src/deploy_config.rs`
  - `finish_push` downloads source packages by storage key and sha256 before
    committing deployment metadata.
- `crates/application/src/application_function_runner/mod.rs`
  - Node execution resolves the latest source package and passes storage
    identity/hash to the executor.

Cloudflare difference:

- Convex stores package metadata in system tables and package bytes in module
  storage. Flarex currently stores the source package JSON directly in R2
  under the deterministic execution artifact ID.
- Convex's `finish_push` receives the original `StartPushResponse` and runs the
  commit in the Rust backend transaction. Flarex public finish now verifies R2
  availability before calling `DeploymentDO`, while `DeploymentDO` still owns
  push state and activation.
- The internal `/push/start-analyzed` route remains a prototype/local-dev escape
  hatch. Hosted production should eventually protect or remove it once backend
  analysis and artifact storage are fully authoritative.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Remove Direct Metadata Routes

Previous completed checkpoint: `63637f9` Harden create-root sync docs and
tests.

The public legacy metadata mutation routes are removed:

```txt
PUT /deployments/:deploymentId/schema     -> 404
GET /deployments/:deploymentId/schema     -> 404
PUT /deployments/:deploymentId/functions  -> 404
GET /deployments/:deploymentId/functions  -> 404
```

Runtime invocation now requires an active deployment created by the push flow.
`executeInvoke()` loads `/deployment`, uses active analyzed schema, and treats
active function metadata as authoritative when it exists. Tests that used old
schema/function writes now activate analyzed pushes through:

```txt
POST /deployments/:deploymentId/push/start-analyzed
POST /deployments/:deploymentId/push/:pushId/finish
```

What changed:

- Removed public Worker routing for direct schema/functions metadata.
- Removed `DeploymentDO` direct `PUT /schema`, `GET /schema`, `PUT /functions`,
  and `GET /functions` handlers.
- Removed invoke fallback helpers that loaded mutable schema/function metadata
  outside the active deployment record.
- Migrated backend invoke, execution, and push tests to push-activated
  deployment metadata.
- Added a regression that direct schema/functions metadata routes return 404.

Convex references:

- `crates/application/src/deploy_config.rs`
  - deployment changes are applied through push/finish, not arbitrary metadata
    replacement routes.
- `crates/model/src/modules/mod.rs`
  - analyzed module/function metadata is durable deployment state.
- `crates/application/src/application_function_runner/mod.rs`
  - execution resolves the active deployment/package metadata before running
    user code.

Cloudflare difference: Flarex still has `/push/start-analyzed` for local dev
and tests because the hosted Dynamic Worker analyzer is not the only analyzer
yet. The removed routes were more dangerous because they bypassed source
package identity entirely.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/push.test.ts test/invoke.test.ts test/executionDO.test.ts --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run --maxWorkers=1
corepack pnpm --filter flarex-backend build
```

## Typed Codegen To Backend Analysis Conversion

Previous completed checkpoint: `63637f9` Harden create-root sync docs and
tests.

What changed:

- Changed `backendAnalysisFromCodegenAnalysis(...)` in `flarex-dev` to return
  backend `DeploymentAnalysis` directly.
- Converted generated schema validators into backend validator JSON,
  recursively rejecting unsupported BigInt literal validators instead of
  allowing the wider developer-side validator type to leak into backend
  metadata.
- Converted generated function metadata into backend
  `DeploymentFunctionMetadata`, including typed query/mutation args, returns,
  positions, and executable partition metadata.
- Made `partitionRoot` fail at the backend-analysis conversion boundary because
  it is a generated model-table handle, not executable backend function
  metadata. `partition` and `partitionCreateRoot` remain accepted.

Why it changed:

The hosted sync generation test needs the normal generated app analysis to feed
the backend push and executor activation path. A shallow test-local guard would
hide metadata drift. The shared converter is the correct boundary: once codegen
analysis crosses into backend deployment state, TypeScript should treat it as
backend deployment metadata.

Convex references:

- `crates/application/src/deploy_config.rs`
  - deployed config validation turns analyzed modules/schema into authoritative
    backend deployment state.
- `crates/model/src/modules/mod.rs`
  - function metadata is stored in backend-owned deployment records after
    analysis.
- `npm-packages/convex/src/server/registration.ts`
  - developer query/mutation registrations produce metadata that backend
    analysis must normalize before execution.

Flarex differences:

- Convex performs this normalization inside the integrated backend analysis and
  deploy flow. Flarex currently performs local/dev analysis in `flarex-dev`,
  then converts that result to backend metadata before calling the Cloudflare
  backend push routes.
- Flarex has model-table `partitionRoot` handles for developer ergonomics, but
  backend executable metadata currently accepts only routed `partition` and
  root-creating `partitionCreateRoot` functions.

Known limitations:

- The converter is still local/dev TypeScript code. Hosted authoritative
  analysis should eventually run in the backend-controlled execution boundary
  and return backend metadata directly.
- The converter rejects BigInt literal validators because backend JSON metadata
  cannot represent BigInt literals.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendSyncRuntime.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
git diff --check
```
