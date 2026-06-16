# Deployment Analysis And Push

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
- Direct schema/functions PUT routes remain for existing tests and dev runtime.
  They are now legacy helpers, not the target deploy path.
- Local dev runtime still calls direct PUT after reading generated Worker
  metadata. Moving it to `push/start` and `push/finish` is the next local-dev
  orchestration step.
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
of deploying schema/functions through legacy direct metadata routes.

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
