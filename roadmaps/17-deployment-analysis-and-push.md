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

Cloudflare calls dynamically dispatched scripts "User Workers." Flarex
documentation should avoid that term because it incorrectly suggests that the
developer writes Worker code. Use these terms instead:

- **developer modules**: ordinary files written under `flarex/`
- **source bundle**: bundled developer modules, source maps, schema, and module
  metadata uploaded to Flarex
- **execution artifact**: internal Cloudflare script created and managed by
  Flarex from the source bundle plus the Flarex runtime wrapper
- **dynamic execution isolate**: Cloudflare runtime instance executing the
  Flarex-managed execution artifact
- **deployment analysis**: authoritative metadata produced by evaluating the
  source bundle in the backend-controlled execution environment

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
  -> bundle developer modules, schema, and source maps
  -> POST start_push source bundle to Flarex backend
  -> Flarex creates an internal candidate execution artifact
  -> backend invokes candidate analysis inside dynamic execution isolate
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
- Atomically activate source bundle, execution artifact reference, schema, and
  analyzed metadata.

## Cloudflare Adaptation

Cloudflare Workers cannot evaluate arbitrary uploaded JavaScript source with
`eval()` or `new Function()`. Therefore Flarex cannot upload a source bundle to
one permanent Dynamic Worker and ask that Worker to execute the source directly.

Flarex must internally convert each candidate source bundle into a
Flarex-managed execution artifact and upload it to a Workers for Platforms
dispatch namespace. The Flarex dispatch Worker can then invoke that artifact
dynamically.

This does not change the developer model. The developer still uploads ordinary
Flarex modules to Flarex, exactly as they upload ordinary Convex modules to
Convex.

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

Official Cloudflare references:

- `https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/how-workers-for-platforms-works/`
  - A platform accepts customer code, deploys it into a dispatch namespace, and
    invokes it through a dynamic dispatch Worker.
- `https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/platform-examples/`
  - Execution artifacts are uploaded programmatically through the platform API.
- `https://developers.cloudflare.com/workers/runtime-apis/web-standards/`
  - Workers prohibit `eval()` and `new Function()`.

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

Large source bundles and source maps should live outside Durable Object SQLite,
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
  -> source bundle
  -> local start_push
  -> candidate Miniflare execution artifact
  -> authoritative local analysis
  -> final codegen
  -> local finish_push
```

Miniflare replaces Workers for Platforms only at the execution-artifact adapter
boundary. Local dev must not keep a separate metadata deployment shortcut.

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

Cloudflare deployment control plane
  execution-artifact upload/delete
  dispatch candidate analysis
  dispatch active invocation
  Cloudflare API credentials
```

The hosted Cloudflare deployment control plane should be separated from the
public request/data plane because artifact-upload credentials are highly
privileged. The first prototype may keep the adapter near
`packages/flarex-backend`, but public invocation code must not receive or expose
Cloudflare upload credentials.

Do not create a new package solely for the adapter until the Miniflare and
Workers for Platforms implementations create a real shared contract. At that
point, extract the interface and shared push orchestration instead of
duplicating the state machine.

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
  Cloudflare execution artifact can load all registered functions from one
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
Miniflare analysis adapter, hosted artifact upload, schema diff validation, or
local-dev push orchestration was added.

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

### Phase 5: Import-Phase Compatibility Layer

1. Port Convex's import-phase restrictions into the Flarex execution-artifact
   runtime where Cloudflare permits.
2. Add static bundle checks for import-time capabilities that cannot be safely
   controlled.
3. Add cold-isolate consistency tests for analyzed function metadata.
4. Block hosted activation until candidate analysis satisfies the import-phase
   contract.

### Phase 6: Hosted Dynamic Execution Isolate

1. Implement Workers for Platforms artifact upload and dispatch.
2. Upload immutable candidate execution artifacts.
3. Invoke internal analysis through the dispatch binding.
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
- Local Miniflare and hosted dispatch adapters pass the same push contract
  suite.
- Runtime invocation resolves only active authoritative metadata.

## Known Intentional Differences

- Flarex adds `workflowMutation`; Convex has query, mutation, and action UDF
  types.
- Flarex uses Cloudflare-managed execution artifacts and dynamic dispatch
  instead of Convex's Rust/V8 function runner.
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
