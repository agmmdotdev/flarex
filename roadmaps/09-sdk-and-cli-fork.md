# SDK And CLI Fork

## Current Decision

Fork the Convex npm package as the starting point for Flarex's developer SDK,
but treat it as a compatibility SDK, not as the backend source of truth.

The goal is to keep the developer-facing experience as close to Convex as
possible while replacing hosted Convex transport, deployment, analysis, and
runtime assumptions with Flarex's Cloudflare backend.

## What To Reuse Heavily

Reuse or closely port these Convex npm-package surfaces:

- `query`
- `mutation`
- `action`
- `defineSchema`
- `defineTable`
- table `.index(...)`
- validators from `convex/values`
- `FunctionReference`
- generated `api`
- generated `_generated/server`
- query builder style:

```ts
ctx.db
  .query("lessonProgress")
  .withIndex("by_user_lesson", q =>
    q.eq("userId", args.userId).eq("lessonId", args.lessonId),
  )
  .collect()
```

- React/client API shapes where portable:
  - `useQuery`
  - `useMutation`
  - `useAction`
- Next.js helpers where they only depend on public client APIs.

This should keep most app code visually and mentally close to Convex.

## What To Replace

Replace or rewrite these areas:

- Convex cloud deployment selection and authentication.
- Convex push/analyze protocol.
- Convex hosted backend endpoints:
  - `/api/query`
  - `/api/mutation`
  - `/api/action`
  - `/api/sync`
- Direct assumptions about Convex's Rust backend, module analyzer, function
  runner, and sync server.
- CLI commands that manage Convex projects, teams, deployments, dashboard,
  WorkOS, or cloud tokens.
- Any code path that assumes global transactional writes across one deployment
  database.

Flarex transport should target:

```txt
POST /deployments/:deploymentId/invoke
POST /invoke
future /deployments/:deploymentId/sync
future Dynamic Worker function registry / loader
```

## Flarex-Specific Additions

Flarex needs a small set of intentional API differences:

```ts
defineTable(...).partitionBy("_id")
defineTable(...).colocateWith("users", "userId")
defineTable(...).global()
defineProjection(...)
```

Client invocation also needs shard routing until a better generated helper can
derive it:

```ts
await client.mutation(api.lessons.complete, args, {
  partitionKey: userId,
});
```

These differences are not optional implementation details. They are how Flarex
stays honest about Durable Object shard boundaries.

## Convex References

Primary npm package areas to fork or study:

- `npm-packages/convex/src/server/schema.ts`
  `defineSchema`, `defineTable`, table indexes, schema typing.
- `npm-packages/convex/src/server/registration.ts`
  `query`, `mutation`, `action`, context types, handler registration.
- `npm-packages/convex/src/server/database.ts`
  `GenericDatabaseReader`, `GenericDatabaseWriter`, table query APIs.
- `npm-packages/convex/src/server/query.ts`
  Query initializer and query builder types.
- `npm-packages/convex/src/server/index_range_builder.ts`
  `q.eq` and index range builder shape.
- `npm-packages/convex/src/server/api.ts`
  `FunctionReference` and generated API reference model.
- `npm-packages/convex/src/values`
  Validators and value typing.
- `npm-packages/convex/src/browser/http_client.ts`
  HTTP client shape, but not endpoints as-is.
- `npm-packages/convex/src/browser/sync`
  Future live sync inspiration, not a drop-in port.
- `npm-packages/convex/src/react`
  React hook shapes.
- `npm-packages/convex/src/nextjs`
  Next.js helper shapes.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  Codegen control flow.
- `npm-packages/convex/src/cli/codegen_templates`
  Generated `api`, `server`, and data model templates.

Backend behavior references remain:

- `crates/database/src/transaction.rs`
- `crates/database/src/committer.rs`
- `crates/database/src/reads.rs`
- `crates/function_runner/src/lib.rs`
- `crates/isolate/src/environment/udf/syscall.rs`

## Cloudflare Difference

Convex's npm package talks to Convex's hosted/Rust backend. Flarex's SDK must
talk to Cloudflare Workers and Durable Objects:

```txt
SDK / generated API
  -> Flarex invoke or sync transport
  -> Worker route
  -> DeploymentDO metadata
  -> PartitionDO shard
  -> OCC commit
```

The SDK should preserve developer ergonomics, but it must not hide impossible
cross-shard transaction semantics. Normal mutations remain single-shard unless
the developer explicitly opts into workflow-style cross-shard behavior.

## Migration Plan

1. Create a forked SDK package from the Convex npm package subset, not the full
   hosted CLI.
2. Port values, schema, registration, function references, and query-builder
   types first.
3. Add Flarex placement APIs to table definitions.
4. Replace generated transport with Flarex `/invoke`.
5. Keep generated `_generated/api` and `_generated/server` close to Convex.
6. Add a minimal Flarex CLI/codegen command before porting larger Convex CLI
   behavior.
7. Add React/Next.js helpers after invoke and sync protocols stabilize.
8. Only then revisit WebSocket live sync and optimistic updates.

## Known Limitations

- `packages/flarex` now exists as the first compatibility-SDK foundation, but
  it still contains a deliberately small subset of Convex's public SDK.
- Current `packages/flarex-dev` generator is still a prototype and does not
  yet generate a deployment manifest.
- Dynamic Worker loading is not connected yet, so generated functions are not
  deployed through the new backend invoke registry.
- Client-side partition routing is still explicit.
- Live sync is not implemented yet, so React hook compatibility will be staged
  after the backend sync protocol exists.

## Last Update

Renamed the prototype `packages/flarex-client` package to the canonical
`packages/flarex` SDK and switched application imports to Convex-style package
entry points:

```ts
import { query, mutation } from "flarex/server";
import { v } from "flarex/values";
import { FlarexClient } from "flarex/browser";
```

Ported the core function-reference model inspired by:

- `npm-packages/convex/src/server/api.ts`
- `npm-packages/convex/src/server/functionName.ts`
- `npm-packages/convex/src/server/registration.ts`
- `npm-packages/convex/src/cli/codegen_templates/api.ts`

Flarex now provides `anyApi`, `makeFunctionReference`, `getFunctionName`,
`ApiFromModules`, typed function arguments and typed function returns. The
generator now emits an API proxy typed from application function modules,
instead of emitting untyped literal references.

Unlike Convex, Flarex references retain a serializable `_path`, and client
invocations still require an explicit `partitionKey`. This preserves the
Cloudflare shard routing contract rather than implying a deployment-wide
transaction boundary.

Also added the missing `.global()` table placement API. Full database query
builder types, CLI commands, React, Next.js, and sync transport remain
follow-up work. `packages/flarex/LICENSE.convex` preserves the upstream
Apache-2.0 license for selectively ported Convex SDK work.

## Typed Data Model Update

Implemented the next selective SDK-fork slice:

- Expanded `flarex/values` with Convex-style validator types and metadata:
  - `v.id`
  - `v.null`
  - `v.number` / `v.float64`
  - `v.int64`
  - `v.boolean`
  - `v.string`
  - `v.bytes`
  - `v.literal`
  - `v.array`
  - `v.object`
  - `v.record`
  - `v.union`
  - `v.optional`
  - `v.nullable`
  - `v.any`
- Added optional-field inference and validator JSON metadata.
- Changed `defineSchema` to return a typed `SchemaDefinition` containing
  authoritative table definitions and Flarex placement metadata.
- Added `DataModelFromSchemaDefinition`, `DocumentByName`,
  `TableNamesInDataModel`, and `WithoutSystemFields`.
- Typed `DatabaseReader` and `DatabaseWriter` from the generated data model.
- Added generic query, mutation, workflow mutation, and action builders.
- The generator now emits `_generated/dataModel.ts`.
- The generator now specializes `_generated/server.ts` builders and contexts
  with the application's generated `DataModel`.

This follows the shape of:

- `npm-packages/convex/src/values/validator.ts`
- `npm-packages/convex/src/values/validators.ts`
- `npm-packages/convex/src/server/schema.ts`
- `npm-packages/convex/src/server/data_model.ts`
- `npm-packages/convex/src/server/registration.ts`
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
- `npm-packages/convex/src/cli/codegen_templates/server.ts`

Flarex still differs by retaining `partitionBy`, `colocateWith`, `global`, and
projection definitions in schema metadata. The validator layer currently
exports metadata and types, but invoke-time argument/document validation is not
yet connected to the backend execution boundary. Broader query-builder
features beyond exact indexed equality are still pending.

## Query Builder Update

Implemented the first Convex-style database query-builder slice:

```ts
const progress = await ctx.db
  .query("lessonProgress")
  .withIndex("by_user", q => q.eq("userId", userId))
  .collect();
```

The generated data model now drives:

- valid table names
- valid index names
- required index-field order
- equality value types
- returned document types

Added lazy query construction and `collect`, `take`, `first`, and `unique`
consumers. The public shape follows:

- `npm-packages/convex/src/server/database.ts`
- `npm-packages/convex/src/server/query.ts`
- `npm-packages/convex/src/server/index_range_builder.ts`

Flarex now supports whole-index reads, partial equality prefixes, and typed
`gt`, `gte`, `lt`, and `lte` bounds on the next index field. The authoritative
backend resolves names through deployment schema metadata, compiles expressions
into ordered half-open bounds, and records the numeric index interval in the
transaction read set for OCC.

The query SDK now also provides Convex-style ordered cursor pagination:

```ts
const result = await ctx.db
  .query("scores")
  .withIndex("by_user_score", q => q.eq("userId", userId))
  .order("desc")
  .paginate({ numItems: 25, cursor });
```

`paginationOptsValidator`, `PaginationOptions`, and `PaginationResult` are
exported from `flarex/server`. Cursors are currently ordered index-key strings;
query fingerprint validation and reactive page splitting remain future work.

Verified with:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check -- custom/cloudflare-executor
```

## Runtime Validator Update

The validator metadata exported by `flarex/values` is now executable through
`validateValue` and `validateFunctionArgs`. The generated standalone Worker
uses these helpers before user function execution and before document writes.

This follows Convex's separation between SDK validator declarations and backend
runtime enforcement, particularly:

- `crates/udf/src/validation.rs`
- `crates/model/src/modules/function_validators.rs`
- `crates/common/src/schemas/validator.rs`

Unlike Convex, the generated Worker currently imports the application schema
directly and validates writes locally. The authoritative Flarex backend also
validates at `PartitionDO.commit`; generated Worker storage remains a prototype
until it is replaced by the authoritative syscall/OCC path.

See `10-runtime-validation.md` for the complete contract, limitations, and
follow-up work.

## Function Metadata Generation

The generator now emits `_generated/functionMetadata.ts`. It imports the
application's registered functions and serializes:

- path
- kind
- visibility
- argument validator JSON
- return validator placeholder

The generated artifact is intended to be uploaded to:

```txt
PUT /deployments/:deploymentId/functions
```

This follows Convex's analyzed module metadata shape in:

- `crates/model/src/modules/module_versions.rs`
- `npm-packages/convex/src/cli/lib/deployApi/modules.ts`

Flarex does not yet run a full Convex-style analyzer. The current generator
uses the registered function objects directly, which is sufficient for typed
argument metadata but does not yet capture source positions or return
validators.

Return validators are now part of the registered function object:

```ts
export const complete = mutation({
  args: { lessonId: v.string() },
  returns: v.object({ completed: v.boolean() }),
  handler: async (ctx, args) => {
    return { completed: true };
  },
});
```

The generator serializes `fn.returns` into function metadata with
`validatorToJson`. This follows Convex's `returns` field in:

- `npm-packages/convex/src/server/registration.ts`
- `npm-packages/convex/src/server/impl/registration_impl.ts`

The registration type now also constrains the handler return when `returns` is
declared. For example, this is rejected by `tsc`:

```ts
mutation({
  args: {},
  returns: v.object({ ok: v.boolean() }),
  handler: () => ({ ok: "yes" }),
});
```

This follows Convex's `ReturnValueForOptionalValidator` and overloaded builder
pattern in `npm-packages/convex/src/server/registration.ts`. Runtime validation
remains authoritative, but common handler/validator mismatches are now caught
before deploy.

## Canonical ID Validation Update

The SDK validator runtime now accepts an optional ID resolver:

```ts
validateValue(v.id("users"), value, "$", {
  validateId: (tableName, id, path) => {
    // Runtime-specific table check.
  },
});
```

The generated Worker and authoritative backend both use this hook with numeric
table IDs. This keeps the SDK runtime portable while preserving Convex's
`v.id("table")` semantics.

The generator previously emitted standalone Worker storage code. It now emits
a Worker that calls backend execution sessions through a `FLAREX_BACKEND`
service binding. Generated Worker code imports:

```ts
import { createQueryInitializer, parseFlarexId } from "flarex/server";
```

Generated `ctx.db` operations no longer write to local Worker SQLite state.
They call:

```txt
/deployments/:deploymentId/executions/start
/deployments/:deploymentId/executions/:sessionId/syscall
/deployments/:deploymentId/executions/:sessionId/finish
```

The generated Worker still derives a deterministic table-id map from sorted
schema table names for local `v.id("table")` argument and return validation.
Deployment-owned table IDs from `DeploymentSchema.tables` remain authoritative
for backend validation and commits.

The example app now has an end-to-end test proving the generated Worker can use
the generated service-binding path against the backend execution session API.
This is not the final CLI deploy flow yet, but it verifies the generated
runtime contract:

- generated function metadata is accepted by the backend
- local generated validation rejects malformed IDs before `/executions/start`
- `ctx.db.insert` and `ctx.db.query(...).withIndex(...).collect()` cross the
  backend syscall API
- committed documents are read back through the authoritative backend index

Convex reference:

- `npm-packages/convex/src/server/registration.ts`
  - The developer-facing function and validator APIs stay portable and typed.
- `crates/common/src/schemas/validator.rs`
  - Backend ID validation resolves encoded IDs against schema/table metadata.

Cloudflare difference:

- Convex's analyzer and backend own the deployed table mapping. Flarex's
  generated Worker still performs local fast validation, but all data syscalls
  now route through the authoritative backend/OCC path.

## Generated Deployment Metadata Update

The generator now emits `_generated/deploymentSchema.ts` next to
`functionMetadata.ts`. It imports the developer schema, converts table
validators with `validatorToJson`, assigns deterministic table IDs from sorted
table names, assigns deterministic index IDs from sorted tables and declared
index order, and preserves Flarex placement metadata.

The generated Worker now exposes:

```txt
GET /__flarex_internal/metadata
```

returning:

```ts
{
  schema: deploymentSchema,
  functions: functionMetadata,
}
```

This gives the local dev runtime a generated metadata source instead of
manually duplicating schema/function conversion in the Vite plugin.

Convex reference:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Convex prepares generated files and writes them in dependency order so the
    app can be analyzed and typechecked consistently.
- `npm-packages/convex/src/cli/lib/components.ts`
  - Convex's push/codegen flow sends analyzed schema/function metadata to the
    backend as part of deployment.

Cloudflare difference:

- Convex analysis is backend-owned. Flarex currently generates deployment
  metadata in the generated Worker bundle and the local dev runtime reads it
  from an internal Worker route before deploying it to backend Durable Objects.

Verification:

```sh
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm typecheck
corepack pnpm test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex build
corepack pnpm --filter @flarex/example build
```

The deployable backend wrapper no longer runs Wrangler as its normal `build`.
Wrangler deployment validation is available through
`corepack pnpm --filter @flarex/backend deploy:dry-run`.

## App Wrangler Generation Cleanup

`generateFlarex` no longer writes `wrangler.generated.jsonc` by default.
Application projects are not required to be Wrangler Workers just to use
Flarex. The Vite plugin and future test SDK should own local Miniflare runtime
setup for app development and tests.

The old opt-in `generateWrangler: true` escape hatch and `workerName` option
have now been removed. In the Convex-like model, application code generation
emits typed bindings and runtime bundles for the Flarex platform/dev server; it
does not emit an app-owned Wrangler deployment config.

The application client should talk to either:

```txt
hosted Flarex deployment URL
local Flarex dev URL, e.g. /__flarex_dev
```

not to an app Wrangler Worker the developer has to deploy.

Convex reference:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Convex codegen emits generated TypeScript bindings for the application; it
    does not make the user's frontend app a backend deployment artifact.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - Convex dev owns the local backend/deployment orchestration separately from
    frontend app bundling.

Cloudflare difference:

- Flarex still generates an app Worker bundle because user functions must run
  in a Cloudflare-compatible Worker runtime, but that bundle is owned by the
  Flarex dev/test/platform runtime, not by the user's app Wrangler config.
- Self-hosting should deploy the Flarex backend/platform Worker, not each
  individual application as its own generated Wrangler Worker.

Follow-up:

1. Make the generated client default to the Flarex hosted URL in production and
   the Vite/dev URL in development.
2. Keep Wrangler config only in the backend/platform deployment target.

Verification:

```sh
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter @flarex/example generate
corepack pnpm typecheck
corepack pnpm test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex build
corepack pnpm --filter @flarex/example build
```

Confirmed `apps/example/wrangler.generated.jsonc` is not generated by default
after `generate` or `build`.

## Convex-Style Module Analysis And Two-Phase Codegen

The generator no longer discovers functions by scanning source text with
regular expressions. It now follows the same broad sequence as Convex:

```txt
discover function modules
  -> write initial generated dataModel/server/api files
  -> bundle and execute modules for analysis
  -> inspect actual registered function exports
  -> write final generated files in dependency order
  -> remove stale generated entries
```

`packages/flarex-dev/src/analyze.ts` uses Vite/Rollup to bundle the actual
developer modules, then inspects exported runtime values carrying the
`__flarexFunction` registration marker. This correctly handles named, aliased,
reexported, default, public, and internal function exports while ignoring
non-function helper exports.

Function entry-point discovery also ports Convex's relevant `entryPoints`
rules: it rejects reserved `_deps` content and skips `_generated`, schemas,
dotfiles, editor temp files, multi-dot test/spec files, spaced paths, unsupported
extensions, and TypeScript files without an import or export.

Final codegen emits a shared `_generated/functionRegistry.ts`. Both
`functionMetadata.ts` and the generated Worker import that registry, avoiding
two independently generated function maps.

Generated files are written in dependency order:

```txt
dataModel.ts
server.ts
api.ts
functionRegistry.ts
functionMetadata.ts
deploymentSchema.ts
worker.ts
```

### Convex References

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - `doInitialComponentCodegen` writes enough generated code for module
    bundling and analysis.
  - `doCodegen` writes generated files in dependency order and removes stale
    generated entries.
- `npm-packages/convex/src/bundler/index.ts`
  - `entryPoints` defines which developer files become deployable function
    modules and which common support/test/generated files are skipped.
- `npm-packages/convex/src/cli/lib/components.ts`
  - `startComponentsPushAndCodegen` runs initial codegen before bundling and
    backend analysis, then runs final codegen from `StartPushResponse`.
- `npm-packages/convex/src/cli/lib/deployApi/modules.ts`
  - Defines Convex's serialized `AnalyzedModule` and `AnalyzedFunction` shapes.
- `crates/model/src/modules/module_versions.rs`
  - Defines the authoritative backend analyzed-module model.

### Cloudflare Difference

Convex sends bundled modules to its backend, where its isolate/runtime performs
authoritative analysis and returns analyzed modules for final codegen. Flarex
currently performs trusted local analysis inside the `flarex-dev` Node process
using Vite, then generates the Cloudflare Worker registry from those results.

### Known Limitations

- Analysis executes trusted developer module import-time code in the local
  Node/Vite process. Hosted deployment must eventually analyze inside the
  Dynamic Worker/isolate boundary.
- The analyzed model does not yet include source positions, serialized
  validators, HTTP routes, cron specs, module environment, or source maps.
- Stale cleanup currently removes every unknown `_generated` entry. Before
  supporting generated extensions, add an explicit preserved-entry policy like
  Convex's `PRESERVED_GENERATED_ENTRIES`.
- Final codegen does not yet consume an authoritative backend analysis response.

### Authoritative Push Direction

The next codegen change must not make developers write or deploy Worker code.
Developers continue writing ordinary modules under `flarex/`. Flarex tooling
will bundle those modules and send the source bundle to the Flarex backend.
The platform will create the internal Cloudflare execution artifact, analyze it
inside a backend-controlled dynamic execution isolate, and return authoritative
analysis for final codegen.

The detailed Convex analysis, validation, `start_push`, and `finish_push` porting
plan is recorded in `roadmaps/17-deployment-analysis-and-push.md`.

### Verification

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example generate
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

The generator tests cover alias exports, reexports, internal functions, default
exports, ignored helper exports, the shared registry, stale cleanup, and the
absence of app Wrangler generation. Full workspace typecheck, tests, build, and
diff checks pass. No app `.flarex` persistence directory or generated Wrangler
configuration remains after verification.

## Static Final Metadata Codegen Update

Final codegen now emits `functionMetadata.ts` as static data derived directly
from analyzed modules. It no longer imports `functionRegistry.ts` or reads
runtime compatibility fields from registered function objects.

The generated Worker uses this analyzed metadata for validation and backend
execution-session requests. The function registry is limited to executable
handler resolution through `_handler`.

This follows Convex's split between initial codegen and analysis-informed final
codegen. Flarex still emits runtime metadata into the generated execution
artifact, while Convex persists authoritative analyzed metadata in its backend.

## Phased Generation And Source Package Update

Exposed explicit `initialCodegen`, `bundleFlarexSourcePackage`,
`analyzeSourcePackageLocally`, and `finalCodegen` APIs. `generateFlarex`
orchestrates them for compatibility.

This makes the current local development flow follow Convex's initial-codegen,
bundle, analyze, final-codegen ordering and gives future backend push logic a
serializable immutable artifact instead of requiring access to the developer's
filesystem.

The detailed source-package contract, Convex references, determinism rules,
differences, and tests are recorded in
`roadmaps/17-deployment-analysis-and-push.md`.

## Implementation Checkpoints

### `772fce2` Refactor Flarex runtime and add Convex-style codegen

Separated reusable backend runtime, development tooling, test SDK, and
deployable wrapper packages; added Convex-style generated APIs and local
development behavior.
