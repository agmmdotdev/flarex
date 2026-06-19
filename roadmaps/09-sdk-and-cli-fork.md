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
definePartitionTable(...)
defineColocatedTable("documents", "documentId", ...)
defineGlobalTable(...)
defineProjection(...)

partition: model.documents
```

Legacy prototype forms remain temporarily implemented but are no longer the v1
product target:

```ts
defineTable(...).partitionBy("_id")
defineTable(...).colocateWith("users", "userId")
defineTable(...).global()
partition: model.documents.byId("documentId")
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
  Fork/refactor target for live sync state, public client behavior, and protocol
  shape. The transport URL, authentication, timestamp encoding, and
  partition-routing fields must be adapted for Flarex.
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
3. Add explicit Flarex placement constructors:
   `definePartitionTable`, `defineColocatedTable`, and `defineGlobalTable`.
4. Generate `model.<rootTable>` as the normal function partition API.
5. Replace generated transport with Flarex `/invoke`.
6. Keep generated `_generated/api` and `_generated/server` close to Convex.
7. Add a minimal Flarex CLI/codegen command before porting larger Convex CLI
   behavior.
8. Port the Convex sync client layering before React hooks:
   `LocalSyncState`-style query-set bookkeeping, `BaseConvexClient`-style
   sync transport boundary, and `ConvexClient`-style public callback API.
9. Add React/Next.js helpers after the live client exposes stable
   `onUpdate`, `watchQuery`, `mutation`, and connection-state semantics.
10. Revisit optimistic updates, paginated sync, auth refresh, and reconnect
   polish after the first partition-aware live client is working.

## Known Limitations

- `packages/flarex` now exists as the first compatibility-SDK foundation, but
  it still contains a deliberately small subset of Convex's public SDK.
- Current `packages/flarex-dev` generator is still a prototype and does not
  yet generate a deployment manifest.
- Dynamic Worker loading is not connected yet, so generated functions are not
  deployed through the new backend invoke registry.
- Generated clients currently infer partition routing for functions that
  declare `partition: model.<table>.by<Field>(...)`, but the v1 target is
  `partition: model.<table>`.
- Generated `_generated/server.ts` currently exposes
  `model.<table>.by<Field>(...)` partition selectors. These need migration to
  root model objects.
- Generated `_generated/server.ts` now emits `PartitionScopes` and narrows
  `mutation` / `internalMutation` / `workflowMutation` handler write tables
  when a function declares first-class partition metadata.
- Live sync now has an initial `packages/flarex` client-side stack, but it is
  still smaller than Convex's full browser client.

## Explicit Partition API Redesign

Checkpoint title: `Plan explicit partition table API`

Previous completed checkpoint: `ff5dae0` Generate partition-scoped mutation
types.

What changed:

- The SDK/codegen target now uses explicit table constructors:
  `definePartitionTable`, `defineColocatedTable`, and `defineGlobalTable`.
- Root partition tables are `_id` owned only in v1.
- Generated `_generated/server.ts` should expose root partition model objects:
  `model.documents`, `model.rooms`, `model.carts`.
- Function definitions should use `partition: model.documents` for both
  create and existing single-shard mutations; analyzer/runtime decides mode
  from args and schema.
- Selector methods such as `model.documents.byId("documentId")` become
  compatibility-only implementation details until removed or demoted.

Target app code:

```ts
export default defineSchema({
  documents: definePartitionTable({
    title: v.string(),
  }),
  comments: defineColocatedTable("documents", "documentId", {
    documentId: v.id("documents"),
    body: v.string(),
  }).index("by_document", ["documentId"]),
});

export const addComment = mutation({
  partition: model.documents,
  args: { documentId: v.id("documents"), body: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("comments", args);
  },
});
```

Convex references:

- `npm-packages/convex/src/server/schema.ts`
  - schema authoring should stay compact and generated-model friendly.
- `npm-packages/convex/src/server/registration.ts`
  - function registration is the public layer for metadata and typed handler
    contexts.
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
  - generated server files bind SDK generics to app-specific generated types.
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - data model codegen should continue to derive document/table types from the
    developer schema.

Cloudflare difference:

- Convex does not need developer-visible physical placement APIs. Flarex does,
  but the v1 API should expose one simple concept: root partition tables and
  colocated child tables.

Known limitations:

- This checkpoint does not implement the constructors yet.
- Current tests/examples still use legacy chain placement and selector model
  APIs.
- Backend invoke/sync still expects analyzed partition metadata with an
  argument field. Create-mode root preallocation is a follow-up.

Verification:

```sh
Documentation-only change; no runtime validation required.
```

## Explicit Schema Constructor Update

Checkpoint title: `Add explicit schema table constructors`

Previous completed checkpoint: `ebf431a` Plan explicit partition table API.

What changed:

- `flarex/server` now exports the new public schema constructors:
  `definePartitionTable`, `defineColocatedTable`, and `defineGlobalTable`.
- The constructors preserve the existing Convex-style `defineTable` typing for
  document validators, field paths, indexes, and generated data model
  inference.
- The implementation is intentionally a thin compatibility layer over current
  placement metadata so no backend or generator behavior changes in this
  checkpoint.
- Schema tests now cover each explicit constructor and verify it records the
  expected placement metadata.

Convex references:

- `npm-packages/convex/src/server/schema.ts`
  - schema constructors should preserve validator and field-path inference.
- `npm-packages/convex/src/server/registration.ts`
  - generated function types depend on schema-derived data model fidelity.
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - data model codegen stays downstream of the schema definition shape.

Cloudflare difference:

- Flarex adds named placement constructors because physical placement is part
  of correctness on Durable Objects. Convex keeps physical placement hidden
  behind its logical database.

Known limitations:

- Existing example apps and generator tests still use chain-style placement.
- `model.table` root partition declarations are not implemented yet.
- Backend execution still consumes selector-style partition metadata.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
```

## Partition-Scoped Mutation Type Update

Checkpoint title: `Generate partition-scoped mutation types`

Previous completed checkpoint: `d3ef699` Infer client partition keys from
partition metadata.

What changed:

- `packages/flarex` now exports `DatabaseWriterForTables`,
  `MutationCtxForTables`, `MutationCtxForPartition`, and `PartitionScopeMap`.
- `MutationBuilder` accepts generated partition scopes as an extra type
  parameter. Object-form mutations with
  `partition: model.<table>.by<Field>(...)` receive a handler `ctx.db` whose
  write methods are narrowed to the root table and colocated tables for that
  partition root.
- `packages/flarex-dev` derives `PartitionScopes` from analyzed schema
  placement and emits it into `_generated/server.ts`.
- Generated `mutation`, `internalMutation`, and `workflowMutation` are now
  bound as `MutationBuilder<DataModel, ..., PartitionScopes>`.
- Direct handlers and legacy `partition: routeFromArgs(...)` definitions keep
  the full `MutationCtx<DataModel>` type. They are not the final normal path,
  but this preserves compatibility while partition metadata becomes mandatory
  at runtime.

Example generated scope:

```ts
export type PartitionScopes = {
  users: "lessonProgress" | "users";
};
```

Convex references:

- `npm-packages/convex/src/server/registration.ts`
  - Convex `MutationBuilder` gives generated mutation handlers a
    `GenericMutationCtx<DataModel>`.
  - `GenericMutationCtxWithTable` shows the existing pattern of specializing
    the mutation context by replacing `db`.
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
  - generated `_generated/server` binds generic builders to the app
    `DataModel`.
- `npm-packages/convex/src/server/data_model.ts`
  - data model table-name and document typing remain the foundation for
    typed `ctx.db`.

Cloudflare difference:

- Convex can expose a full `GenericDatabaseWriter<DataModel>` because one
  logical deployment database owns mutation atomicity. Flarex must narrow
  normal partitioned mutation writes because the runtime transaction is owned
  by one `PartitionDO`.

Known limitations:

- This is compile-time DX only. Runtime placement validation in backend
  syscalls and `PartitionDO` commit remains authoritative.
- Reads are intentionally not narrowed yet; cross-partition reads still need a
  clearer query/projection policy before static enforcement.
- The scope computation follows `colocateWith(...)` chains to a partition root
  and excludes `global()` tables from normal partitioned mutation writes.
- Cross-shard writes remain future `atomicMutation` or workflow work, not
  normal `mutation` semantics.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- --run packages/flarex-dev/test/generate.test.ts
corepack pnpm --filter @flarex/example typecheck
```

## Sync Client Fork Plan

The live client should not be a new hand-written WebSocket wrapper. It should
selectively port Convex's browser sync client architecture and keep the
Flarex-specific changes narrow and named.

### Convex Files To Port Closely

- `npm-packages/convex/src/browser/sync/local_state.ts`
  - Owns query tokens, query IDs, query-set versions, subscription
    deduplication, restart query-set reconstruction, and `Remove` emission
    only after the last subscriber unsubscribes.
- `npm-packages/convex/src/browser/sync/client.ts`
  - Owns the base sync client boundary: subscribe, local query result,
    mutation enqueueing, server message handling, and transition callbacks.
- `npm-packages/convex/src/browser/simple_client.ts`
  - Owns the public `ConvexClient` style: `onUpdate`, `query`, `mutation`,
    unsubscribe objects, callback dispatch, and connection-state subscription.
- `npm-packages/convex/src/browser/sync/protocol.ts`
  - Owns message names and payload shape. Flarex should keep names such as
    `ModifyQuerySet`, `Transition`, `QueryUpdated`, `QueryFailed`,
    `QueryRemoved`, `Mutation`, and `MutationResponse`.

### Flarex Adaptations

- Flarex sync URLs target the Flarex backend, not Convex's
  `/api/{version}/sync` path.
- The initial live client must include `partitionKey` in `AddQuery` and
  `Mutation` messages, and the query token must include that partition route.
- Client protocol types belong in `packages/flarex`, not by importing
  `packages/flarex-backend`. The client package may mirror the shared protocol
  shape, but it must not depend on backend-only code.
- Keep the current HTTP `/invoke` client as a compatibility path while the live
  sync client is introduced.
- Stage out Convex features that require backend support Flarex does not have
  yet: auth refresh, component paths, optimistic updates, paginated reactive
  sync, transition chunks, action-over-sync, and production reconnect polish.

### First Implementation Slice

1. Add `packages/flarex/src/sync/protocol.ts` with a client-side mirror of the
   current Flarex `/sync` messages, using Convex names.
2. Add `packages/flarex/src/sync/localState.ts` as a close Flarex port of
   Convex `LocalSyncState`, adapted for `partitionKey`.
3. Add a minimal `BaseFlarexClient` that opens a WebSocket, sends
   `ModifyQuerySet` and `Mutation`, ingests `Transition` and
   `MutationResponse`, and exposes local query results.
4. Extend `FlarexClient` with Convex-style live APIs while keeping existing
   HTTP invoke APIs:

```ts
const unsubscribe = client.onUpdate(
  api.lessons.list,
  args,
  result => {
    // result changed
  },
  error => {
    // query failed
  },
  { partitionKey: userId },
);

await client.mutation(api.lessons.complete, args, {
  partitionKey: userId,
});
```

5. Cover the slice with fake-WebSocket tests that assert exact protocol
   messages and local callback behavior.

### Current Planning Checkpoint

Previous completed checkpoint: `dbac8a6` Add mutation execution over sync.

This planning update promotes `npm-packages/convex/src/browser/sync` from
"future inspiration" to a concrete fork/refactor target for the next SDK slice.
The first code step should port the client state machine and public live-client
shape closely, while rewriting only the Flarex transport and explicit
partition-routing differences.

Verification:

```sh
git diff --check
```

## Watch Query API Update

Previous completed checkpoint: `04fc3cb` Default client mutations to sync
transport.

Added `FlarexClient.watchQuery()` as the primitive live-query API, matching
Convex's public watch shape:

```ts
const watch = client.watchQuery(api.lessons.list, { userId }, { partitionKey });

const unsubscribe = watch.onUpdate(() => {
  const result = watch.localQueryResult();
});
```

`watchQuery()` is inert until `watch.onUpdate()` is called, so creating a watch
does not open a WebSocket or modify the backend query set. The existing
value-callback `FlarexClient.onUpdate(...)` API now wraps `watchQuery()` instead
of owning separate subscription state.

Convex references:

- `npm-packages/convex/src/react/client.ts`
  - public `watchQuery()` returns a watch with `onUpdate()` and
    `localQueryResult()`.
- `npm-packages/convex/src/browser/sync/client.ts`
  - base sync client owns subscription registration and local query-result
    lookup.

Current differences from Convex:

- Flarex still requires explicit `partitionKey` in `watchQuery()` options until
  generated routing metadata can infer the shard route.
- Query tokens still include the partition route.
- `localQueryLogs()` is not implemented yet.
- React hooks are still pending; this checkpoint only adds the client primitive
  they can build on.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example build
```

## Last Update

Added generated model partition selectors to `_generated/server.ts`.

Checkpoint title: `Generate model partition selectors`

Previous completed checkpoint: `d70c486` Enforce partition owner uniqueness.

What changed:

- `flarex/server` function builders now accept `partition` alongside `route`.
- `packages/flarex-dev` initial codegen emits a permissive dynamic `model` so
  source analysis can evaluate function declarations before schema analysis is
  authoritative.
- Final codegen emits concrete schema-derived selectors:
  `model.users.byId(...)`, `model.teams.bySlug(...)`, and similar.
- Selectors return the existing `FunctionRoutePolicy`, so generated API
  references and client route inference continue using the same path as
  `routeFromArgs(...)`.
- Added generator coverage for `partition: model.teams.bySlug("teamSlug")`.

Convex references:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated SDK files are rebuilt from analyzed metadata.
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
  - generated server entrypoint exports typed function builders.
- `npm-packages/convex/src/server/registration.ts`
  - query/mutation declarations are the correct place to attach metadata.

Cloudflare difference:

- This is a Flarex-specific generated API because Cloudflare execution must
  select one `PartitionDO` before the function starts. Convex has no equivalent
  public routing selector.

Remaining limitations:

- The first selectors are route metadata only; they do not yet create scoped
  `ctx.db` table surfaces.
- The dynamic initial model is intentionally permissive until final backend
  analysis regenerates concrete selectors.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter @flarex/example generate
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

## Previous Update

Added `useQuery_experimental()` to the `flarex/react` entrypoint with
Convex-style object query state:

```ts
const lessons = useQuery_experimental({
  query: api.lessons.list,
  args: { courseId: "english" },
  partitionKey: userId,
});
```

It returns `pending`, `success`, or `error` states and supports
`throwOnError: true`.

Previous completed checkpoint: `81850e6` Add Convex-style React client hooks.

Convex references:

- `npm-packages/convex/src/react/client.ts`
  - `useQuery_experimental()` object-result contract and `throwOnError`
    behavior.

Current differences from Convex:

- `useQuery_experimental()` requires top-level `partitionKey` unless `args` is
  `"skip"`.
- It also accepts optional `journal` because Flarex watch options are
  explicitly routed for now.
- Next routing ergonomics step: add provider-level default `partitionKey` so
  user-sharded apps can write `useQuery(api.lessons.list, args)` and
  `await complete(args)` under `<FlarexProvider partitionKey={userId}>`.
- Later routing step: generated APIs infer routes from schema placement
  metadata when unambiguous.
- `useAction`, pagination, optimistic updates, auth helpers, connection state,
  hydration, and Next.js helpers are still pending.

Detailed notes are recorded in
[`18-react-client-hooks.md`](./18-react-client-hooks.md).

Validation:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example build
corepack pnpm --filter @flarex/example test
```

## Initial Sync Client Slice

Implemented the first Convex-style sync client slice in `packages/flarex`.
This ports the browser sync layering at a small scale:

- protocol mirror in `src/sync/protocol.ts`
- query-set state in `src/sync/localState.ts`
- base WebSocket client in `src/sync/baseClient.ts`
- public live option/unsubscribe types in `src/sync/simpleClient.ts`
- `FlarexClient.onUpdate(...)` in `src/client.ts`
- initial opt-in sync mutation via `mutation(..., { transport: "sync" })`,
  promoted to the default mutation transport in the following checkpoint

Previous completed checkpoint: `6ca1454` Plan Convex-style sync client port.

Convex references:

- `npm-packages/convex/src/browser/sync/protocol.ts`
- `npm-packages/convex/src/browser/sync/local_state.ts`
- `npm-packages/convex/src/browser/sync/client.ts`
- `npm-packages/convex/src/browser/simple_client.ts`

Current differences from Convex:

- Flarex still requires explicit `partitionKey` in live query and sync mutation
  options.
- Query tokens include the partition route.
- HTTP `/invoke` remained the default for `client.mutation()` in this initial
  slice. The next checkpoint changed the default to sync transport.
- The first base client has no auth refresh, reconnect/backoff manager,
  optimistic updates, paginated sync, action-over-sync, transition chunks, or
  connection-state subscriptions yet.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
```

## Initial SDK Package Update

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
will bundle those modules and send the source package to the Flarex backend.
The platform will create the internal Flarex-managed execution artifact,
analyze it inside a backend-controlled dynamic execution isolate, and return
authoritative analysis for final codegen.

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

## Complete Deployment Analysis Update

`analyzeSourcePackageLocally()` now returns one complete deployment analysis
containing analyzed functions and analyzed schema. `finalCodegen()` consumes
that result rather than reading schema runtime objects from the developer
filesystem.

Generated runtime deployment schema and Worker table metadata are static
analysis outputs. Generated `dataModel.ts` still imports the developer schema
solely for TypeScript type inference.

## Architecture Terminology Cleanup

Previous completed checkpoint: `da42b4a` Add analysis import phase prelude.

Normalized SDK/CLI wording around deployment input. Flarex tooling sends the
`flarex/` source package to the backend; it does not bundle the developer's
whole app or require developers to deploy Worker code.

Verification:

```sh
git diff --check
```

## Source Position Metadata Codegen Update

Previous completed checkpoint: `c471b67` Gate analysis on cold isolate
consistency.

Final codegen now preserves optional analyzed function source positions in
`functionMetadata.ts`. This keeps generated metadata aligned with the backend
analysis response instead of dropping dev-tooling context after push analysis.

Convex reference:

- `crates/model/src/modules/module_versions.rs`
  - analyzed function metadata includes an optional source position.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final generated artifacts are produced from deployment analysis context.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Partition-Aware Generated API Update

Checkpoint title: `Infer client partition keys from partition metadata`

Previous completed checkpoint: `79d11ce` Require partition metadata for
execution.

Generated API references now carry partition metadata directly and SDK
partition-key inference uses `_partition`, not `_route`.

What changed:

- `FunctionReference` now includes optional `_partition` metadata.
- `createApi()` accepts analysis-derived reference metadata with both `route`
  and `partition`, while still reading old route-map values for compatibility.
- Final codegen writes `{ route, partition }` entries into `_generated/api.ts`.
- `FlarexClient`, React hooks, and `flarex-test` all use
  `reference._partition.argField` to derive the wire `partitionKey`.
- Route-only generated references no longer infer automatically. They require
  an explicit `{ partitionKey }`, and the backend will still require active
  partition metadata for normal execution.
- Example E2E now proves generated refs call without explicit partition
  options and report partition-validation errors for mismatched overrides.

Convex references:

- `npm-packages/convex/src/server/api.ts`
  - generated function references are the client-facing API handle.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated API files are based on analyzed function metadata.
- `npm-packages/convex/src/react/client.ts`
  - React hooks delegate routing/invocation to the client layer.

Flarex difference:

- Convex references do not need shard metadata. Flarex references carry
  `_partition` so the SDK can compute the `PartitionDO` transport key while the
  backend remains the authority.

Remaining SDK limitation:

- `_route` still exists as compatibility metadata and for old generated files,
  but it is no longer used for automatic partition inference.
- Explicit `{ partitionKey }` remains a low-level override, primarily for tests
  and future non-partition policies. Normal generated app calls should use
  `_partition`.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-test typecheck
corepack pnpm --filter flarex-test test
corepack pnpm --filter @flarex/example generate
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

## Partition Selector Metadata Update

Checkpoint title: `Preserve partition selector metadata`

Previous completed checkpoint: `63896da` Generate model partition selectors.

Final codegen now emits Convex-style generated model helpers that preserve
Flarex partition-selector metadata:

```ts
import { model, mutation } from "../_generated/server";

export const create = mutation({
  args: { teamSlug: v.string(), name: v.string() },
  partition: model.teams.bySlug("teamSlug"),
  handler: async ctx => {
    // runs through route metadata derived from teamSlug today
  },
});
```

The generated helper returns:

```ts
{
  type: "partition",
  table: "teams",
  selector: "bySlug",
  partitionField: "slug",
  argField: "teamSlug",
}
```

What changed:

- `_generated/server.ts` keeps `routeFromArgs` for compatibility and now
  exposes `model` helpers as first-class partition metadata producers.
- Generated selector return values use literal-preserving `as const` so
  TypeScript accepts them as `FunctionPartitionPolicy`.
- `functionMetadata.ts` includes both `route` and `partition`. Current
  generated clients still use `route` for partition-key inference.
- The dynamic initial-codegen `model` proxy uses the same metadata shape as
  final codegen so initial bundling and final TypeScript behavior agree.

Convex references:

- `npm-packages/convex/src/server/schema.ts`
  - schema definitions drive generated types and helpers.
- `npm-packages/convex/src/server/registration.ts`
  - function builders own the metadata contract.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated `_generated/server` and API files are analysis-informed.

Flarex difference:

- Convex table helpers do not expose shard selectors because Convex functions
  run against one logical transactional database. Flarex adds `model.table.byX`
  to make the selected `PartitionDO` explicit while keeping the normal
  query/mutation declaration shape familiar.

Remaining SDK limitation:

- The helper validates declaration metadata, but TypeScript does not yet infer
  a scoped `ctx.db` writer surface from `partition: model.table.byX(...)`.
- `partition` still lowers to route metadata for client calls; richer
  generated client behavior can come after scoped execution contexts exist.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter @flarex/example generate
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

## Route-Aware Generated API Update

Checkpoint title: `Add route-aware generated client inference`

Final codegen now emits generated API references through
`createApi(routeByPath)` instead of plain `anyApi`. The route map comes from
analyzed function metadata, so SDK calls can infer the partition key for
functions declared with:

```ts
export const list = query({
  args: { userId: v.id("users") },
  route: routeFromArgs("userId"),
  handler: async ctx => {
    // ...
  },
});
```

Normal client/test/React calls can now omit the explicit partition option:

```ts
await client.mutation(api.lessons.complete, { userId, lessonId: "intro" });
const lessons = useQuery(api.lessons.list, { userId });
await t.invokeRaw(api.lessons.list, { userId });
```

Convex reference:

- `npm-packages/convex/src/server/api.ts`
  - generated function references are the stable client-facing API surface.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final generated files consume analysis output rather than only filesystem
    shape.

Flarex difference:

- `_route` is Flarex-specific metadata needed to select a `PartitionDO`.
  Convex generated refs do not expose shard placement because Convex routes
  through one logical backend database.

Remaining SDK limitation:

- `anyApi` remains route-less and still requires explicit `{ partitionKey }`.
- Only exact `routeFromArgs(field)` inference is implemented.

## Implementation Checkpoints

### `772fce2` Refactor Flarex runtime and add Convex-style codegen

Separated reusable backend runtime, development tooling, test SDK, and
deployable wrapper packages; added Convex-style generated APIs and local
development behavior.
