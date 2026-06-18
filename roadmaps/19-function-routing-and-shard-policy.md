# Function Routing And Shard Policy

## Current Decision

This is a Flarex platform design issue, not an application design issue.

Every query and mutation must have an authoritative execution shard before user
code starts running:

```txt
function reference + args + identity + deployment metadata
  -> route policy
  -> PartitionDO shard
  -> execution session
  -> OCC transaction
```

If Flarex cannot determine that shard, it cannot safely choose:

- which `PartitionDO` executes the function
- which OCC timestamp and write log apply
- which documents can be read or written transactionally
- which subscriptions are invalidated after commit
- whether the function is single-shard, global, projection-backed, or
  cross-shard/workflow-only

The current visible `partitionKey` client option is therefore a prototype leak
of missing platform routing metadata. It is not the final product API.

## Desired Developer Experience

Normal application code should look close to Convex:

```ts
const lessons = useQuery(api.lessons.list, { courseId: "english" });

const complete = useMutation(api.lessons.complete);

await complete({ lessonId: "intro" });
```

The app developer should not have to understand Durable Object routing for the
common single-owner case.

Flarex still must keep shard ownership explicit in platform metadata. The
developer-facing API can hide route plumbing only after Flarex can infer and
validate the route deterministically.

## Required Platform Model

Function routing must become first-class deployment metadata, similar to
argument validators and schema metadata.

Possible route declarations:

```ts
export const list = query({
  route: currentUser(),
  args: { courseId: v.string() },
  handler: async (ctx, args) => {
    // runs in the current user's shard
  },
});

export const profile = query({
  route: routeFromArgs("userId"),
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // runs in the shard owned by args.userId
  },
});

export const top = query({
  route: routeFromArgs("leagueId", leagueId => `league:${leagueId}`),
  args: { leagueId: v.string() },
  handler: async (ctx, args) => {
    // runs in the leaderboard/projection shard
  },
});
```

The exact API names are not final. The invariant is final: every deployed
function needs an execution route policy unless it is explicitly declared as
global or workflow/cross-shard.

## Relationship To Schema Placement

Schema placement and function routing are related but not identical.

Schema placement says where records live:

```ts
users: defineTable({
  name: v.string(),
}).partitionBy("_id")

lessonProgress: defineTable({
  userId: v.id("users"),
  lessonId: v.string(),
  completed: v.boolean(),
}).colocateWith("users", "userId")
```

Function routing says where function execution starts:

```ts
export const complete = mutation({
  route: currentUser(),
  args: { lessonId: v.string() },
  handler: async (ctx, args) => {
    // may read/write colocated user-owned tables transactionally
  },
});
```

For a single-shard mutation, the function route must match the placement of
the authoritative records it touches. If a function wants to touch records in
multiple shards, it must use an explicit cross-shard/workflow API instead of
silently pretending to be a Convex-style single transaction.

## Backend Enforcement

The backend must not trust a client-supplied `partitionKey` as authority.

Final route enforcement should be:

1. Analyze and store each function's route policy during deployment push.
2. Generated clients infer a route where possible and include it in requests.
3. The backend recomputes or validates the route from function metadata, args,
   identity, and schema placement.
4. The backend rejects missing, malformed, or mismatched routes before starting
   an execution session.
5. The execution session is bound to one `PartitionDO`.
6. `ctx.db` syscalls enforce that reads and writes stay inside the declared
   shard unless the function is using a declared global/projection/workflow
   boundary.

This keeps the runtime honest even if a malicious or buggy client sends the
wrong route.

## Codegen Responsibilities

Generated client APIs should hide routing only when deterministic.

Examples:

```ts
// current-user route, derived from auth/session
await api.lessons.complete({ lessonId: "intro" });

// arg-derived route
const profile = useQuery(api.users.profile, { userId });

// explicit override for advanced/global/projection cases
const top = useQuery(
  api.leaderboard.top,
  { leagueId },
  { partitionKey: `league:${leagueId}` },
);
```

If codegen cannot infer the route, it should keep an explicit route option or
produce a type/runtime error with a clear message. It should not guess.

## Temporary Bridge

Provider-level default routing is still useful as a short-term bridge:

```tsx
<FlarexProvider client={client} partitionKey={userId}>
  <App />
</FlarexProvider>
```

Then user-owned app code can avoid repetitive call-site routing:

```ts
const lessons = useQuery(api.lessons.list, { courseId: "english" });
await complete({ lessonId: "intro" });
```

This is not the final design. It is only an ergonomic stopgap until function
route metadata and backend validation exist.

## Convex References

- `crates/application/src/api.rs`
  Convex routes application calls through deployment/function metadata and
  returns structured application-level results.
- `crates/function_runner/src/lib.rs`
  Function execution is mediated by a backend-controlled runner rather than
  giving user code direct database access.
- `crates/isolate/src/environment/udf/syscall.rs`
  User code reaches storage through syscalls, which gives the backend a place
  to enforce transaction and environment boundaries.
- `crates/database/src/transaction.rs`
  Transaction execution has a known database/transaction context before user
  syscalls are evaluated.
- `npm-packages/convex/src/server/registration.ts`
  Function declarations are the right developer-facing layer for metadata such
  as args, returns, visibility, and future Flarex route policy.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  Generated APIs can encode deployment analysis results into developer-facing
  TypeScript.

## Cloudflare Difference

Convex presents one logical transactional database to developers. Its backend
can run OCC over the deployment database and reject conflicts.

Flarex uses Durable Object shards as the single-writer transaction boundary.
That makes route selection part of correctness:

```txt
wrong route
  -> wrong PartitionDO
  -> wrong write log
  -> wrong OCC conflict set
  -> wrong subscription invalidation
```

Therefore Flarex must make routing an explicit backend/platform contract even
if the public client API becomes Convex-like.

## Implementation Plan

1. Keep current explicit `partitionKey` as the prototype route carrier.
2. Add route policy metadata to function registration types.
3. Include route policy in generated function metadata and deployment analysis.
4. Teach backend invoke/sync/execution-session start to validate route policy.
5. Add provider-level default `partitionKey` for React ergonomics.
6. Teach generated clients to infer routes from route policy where possible.
7. Enforce syscall shard boundaries from the bound execution session.
8. Add cross-shard/workflow-only route declarations for functions that cannot
   be single-shard.
9. Remove or demote raw client `partitionKey` from normal app APIs once
   generated inference is reliable.

## RouteFromArgs Implementation

Previous completed checkpoint: `d6b4712` Document function routing shard
policy.

Implemented the first platform route policy:

```ts
export const list = query({
  route: routeFromArgs("userId"),
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // runs only when partitionKey === args.userId
  },
});
```

What changed:

- `flarex/server`
  - Added `FunctionRoutePolicy`.
  - Added `routeFromArgs(field)`.
  - Added optional `route` to query, mutation, workflow mutation, and action
    registration object forms.
  - Registered functions now expose `route` and `exportRoute()` for analysis.
- `flarex-dev`
  - Local module analysis reads `exportRoute()`.
  - Execution-artifact analysis reads `exportRoute()` inside the analysis
    Worker template.
  - Generated `functionMetadata.ts` includes `route`.
  - Generated `_generated/server.ts` re-exports `routeFromArgs`.
  - Local backend push preserves route metadata when converting codegen
    analysis into backend deployment analysis.
- `flarex-backend`
  - `DeploymentFunctionMetadata` includes `route`.
  - `DeploymentDO` stores route metadata in `functions.route_json`.
  - `executeInvoke()` validates route policy before schema sync, transaction
    begin, or handler execution.
  - `ExecutionDO.start()` validates route policy before creating an execution
    session.
- `apps/example`
  - `lessons:list` and `lessons:complete` declare `routeFromArgs("userId")`.
  - Invoke and sync E2E use `partitionKey = userId`.
  - Invoke E2E verifies a mismatched route is rejected before execution.

Current validation behavior:

```txt
route: routeFromArgs("userId")
args.userId = "2:u1"
partitionKey = "2:u1"
  -> allowed

route: routeFromArgs("userId")
args.userId = "2:u1"
partitionKey = "2:other-user"
  -> 400 RouteValidationError
```

This is intentionally exact matching only. Prefix/transform routes such as
`user:${args.userId}`, auth-derived routes, global routes, and workflow routes
remain separate follow-up policies.

## Known Limitations

- `colocateWith` and `partitionBy(field)` for `field !== "_id"` are enforced
  for backend DB reads/writes, index query ranges, and `PartitionDO` commit,
  but are not yet route-inference sources.
- Generated model partition selectors now exist for `partitionBy(...)` root
  tables and lower to the existing exact arg route policy.
- Only exact arg-field route policies exist. They can be written directly with
  `routeFromArgs(field)` or through generated `model.<table>.by<Field>(field)`.
- Exact arg-field routes require string equality between `partitionKey` and
  `args[field]`.
- Route transforms, `currentUser()`, global route declarations, projection
  route declarations, and workflow/cross-shard route declarations do not exist
  yet.
- Backend execution still accepts explicit `partitionKey` as the route carrier.
- Backend route validation checks function route policy before execution.
- `partitionBy("_id")` root-record enforcement is not implemented yet.
- There is no static validation that owner-scoped index reads include the
  placement field in their range.
- Provider-level default routing is a convenience, not a correctness boundary.

## Last Update

Implemented generated model partition selectors.

Checkpoint title: `Generate model partition selectors`

Previous completed checkpoint: `d70c486` Enforce partition owner uniqueness.

What changed:

- `_generated/server.ts` now exports `model`.
- Final codegen derives model selectors from schema placement:
  - `partitionBy("_id")` -> `model.<table>.byId(argField)`
  - `partitionBy("slug")` -> `model.<table>.bySlug(argField)`
- Query, mutation, action, and workflow mutation declarations now accept
  `partition` as an alias for route metadata.
- The first implementation intentionally lowers
  `partition: model.<table>.by<Field>(...)` to the existing `{ type: "args",
  field }` route policy. Backend route validation, generated API references,
  client inference, and sync behavior therefore reuse the existing route path.
- The example app now uses `partition: model.users.byId("userId")` instead of
  raw `routeFromArgs("userId")`.

Current API:

```ts
export const complete = mutation({
  partition: model.users.byId("userId"),
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    // still current ctx.db surface for now
  },
});
```

Convex references:

- `npm-packages/convex/src/server/registration.ts`
  - function declarations carry metadata alongside handlers.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated server files are derived from schema/function analysis.
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
  - generated `_generated/server` is the developer-facing function-definition
    entrypoint.

Cloudflare difference:

- Convex does not need partition selectors because function execution is routed
  into one logical database. Flarex uses generated selectors as a DX layer over
  the required `PartitionDO` route.

Remaining limitations:

- Selectors only support exact arg-field routing; transforms, auth-derived
  routes, global routes, and projection routes remain future work.
- Generated `model` does not yet narrow `ctx.db` to the selected partition's
  allowed tables.
- Owner-scoped query builders still require explicit owner equality at runtime.

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

Recorded backend owner uniqueness as the prerequisite for generated model
partition selectors.

Checkpoint title: `Enforce partition owner uniqueness`

Previous completed checkpoint: `b39f3bc` Plan partition owner uniqueness.

What changed:

- Backend root-owner uniqueness for `partitionBy(field)` is now implemented, so
  future generated selectors like `model.teams.bySlug("teamSlug")` can rely on
  one current root owner per partition value.
- The function API direction remains `partition: model.<table>.by<Field>(...)`,
  not `shard`.
- Route inference and scoped `ctx.db` types remain future work; this checkpoint
  only hardened the storage invariant they depend on.

Convex references:

- `npm-packages/convex/src/server/registration.ts`
  - function declarations remain the right layer for route/partition metadata.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated files should encode schema and function analysis.
- `npm-packages/convex/src/server/database.ts`
  - generated `ctx.db` types should eventually narrow available tables and
    queries.

Cloudflare difference:

- Convex generated functions do not need partition selectors. Flarex needs
  them because route selection determines the `PartitionDO` and therefore the
  transaction boundary.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/transaction.test.ts
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Previous Update

Planned generated model partition selectors on top of owner uniqueness.

Checkpoint title: `Plan partition owner uniqueness`

Previous completed checkpoint: `ea69fc5` Enforce partitionBy field ownership.

What changed:

- Kept public wording consistent: function APIs should use `partition`, not
  `shard`, because schema APIs already use `partitionBy`.
- Planned generated model selectors from schema placement:
  - `partitionBy("_id")` -> `model.<table>.byId(argField)`
  - `partitionBy("slug")` -> `model.<table>.bySlug(argField)`
  - `partitionBy("clerkId")` -> `model.<table>.byClerkId(argField)`
- Clarified that these selectors should infer function routing and narrow
  `ctx.db` to the selected partition's allowed tables, instead of making
  developers repeat raw `routeFromArgs(...)`, owner-field writes, and owner
  equality in every query.
- Deferred implementation until the backend enforces root-owner uniqueness for
  `partitionBy(field)`.

Desired API direction:

```ts
export const createProject = mutation({
  args: {
    teamSlug: v.string(),
    name: v.string(),
  },

  partition: model.teams.bySlug("teamSlug"),

  handler: async (ctx, args) => {
    await ctx.db.projects.insert({ name: args.name });
  },
});
```

The generated selector is safe only if `teams.partitionBy("slug")` guarantees
one current `teams` root document for `slug = args.teamSlug`.

Convex references:

- `npm-packages/convex/src/server/registration.ts`
  - function declarations carry metadata alongside handlers.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated server/client files can encode analysis and schema-derived
    metadata.
- `npm-packages/convex/src/server/database.ts`
  - generated `ctx.db` types should narrow the developer's database surface.

Cloudflare difference:

- Convex does not need generated partition selectors because route selection is
  not part of the public database model. Flarex needs generated selectors to
  make the single-`PartitionDO` execution boundary type-directed and ergonomic.

Verification:

```sh
git diff --check
```

## Previous Update

Implemented `partitionBy(field)` owner-field enforcement for routed
single-shard functions.

Checkpoint title: `Enforce partitionBy field ownership`

Previous completed checkpoint: `9e60c33` Require colocated query placement
equality.

What changed:

- Function execution routed to one partition now enforces root-table owner
  fields for `partitionBy(field)` where `field !== "_id"`.
- User-code DB writes, commit writes, and index queries must agree with the
  selected partition key.
- This extends the single-shard model beyond child tables to root tables such
  as carts, org settings, workspaces, teams, rooms, or tenants when their owner
  is represented as a normal field.

Convex references:

- `crates/database/src/transaction.rs`
  - backend transaction context mediates storage access.
- `crates/database/src/committer.rs`
  - invalid write sets are rejected before persistence.
- `crates/database/src/reads.rs`
  - indexed ranges become transaction read records.

Cloudflare difference:

- Convex does not require route/placement agreement because one logical
  database owns all records. Flarex must require the selected `PartitionDO`,
  document owner field, and query owner equality to agree.

Remaining limitations:

- `partitionBy("_id")` remains a separate ID-allocation design problem.
- Placement metadata still does not infer function route metadata by itself.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

## Previous Update

Implemented query-time colocated placement enforcement.

Checkpoint title: `Require colocated query placement equality`

Previous completed checkpoint: `3326e3f` Enforce colocated placement at
commit.

What changed:

- Backend query execution now rejects colocated table index reads that do not
  constrain the colocated field to the current partition.
- This closes the gap where a function could route to one shard but issue a
  broad child-table query that was not explicitly scoped to that shard owner.
- The valid Convex-like single-shard pattern is now explicit:
  `routeFromArgs("userId")` plus `q.eq("userId", args.userId)`.

Convex references:

- `npm-packages/convex/src/server/query.ts`
  - client-side query-builder calls are structured rather than raw SQL.
- `crates/database/src/reads.rs`
  - indexed reads are represented as structured ranges for transaction
    validation.

Cloudflare difference:

- Convex does not require a shard-owner equality in the query range because it
  has one logical database. Flarex requires it for colocated tables so the
  selected `PartitionDO` and query range describe the same owner slice.

Remaining limitations:

- This is runtime validation only; generated TypeScript query builders do not
  yet encode required colocated equality.
- `colocateWith` still does not automatically infer a function route.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

## Previous Update

Implemented commit-time colocated placement validation in `PartitionDO`.

Checkpoint title: `Enforce colocated placement at commit`

Previous completed checkpoint: `51d840a` Enforce colocated document placement.

What changed:

- The route-selected partition stores its concrete partition key with schema
  cache metadata.
- The authoritative commit path validates colocated writes against that stored
  partition key.
- Direct commits that bypass generated clients and `ctx.db` syscall validation
  are rejected when they attempt to write child records for another owner.

Convex references:

- `crates/database/src/committer.rs`
  - commit validation is the final storage authority.
- `crates/database/src/transaction.rs`
  - write sets are validated after function execution and before persistence.

Cloudflare difference:

- Convex does not route documents into per-owner Durable Objects, so it has no
  equivalent placement key. Flarex must carry the selected shard identity into
  the commit boundary and reject cross-owner child writes there.

Remaining limitations:

- `colocateWith` still does not infer function routes by itself.
- `partitionBy("_id")` root ownership still needs a dedicated creation and ID
  allocation policy.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

## Previous Update

Implemented backend colocated document placement enforcement.

Checkpoint title: `Enforce colocated document placement`

Previous completed checkpoint: `c7f8f7d` Add route-aware generated client
inference.

What changed:

- Route-selected execution sessions now pass their concrete partition key down
  into backend DB validation.
- `ctx.db.insert`, `replace`, `patch`, and `delete` validate
  `colocateWith(..., field)` documents against the current partition.
- `ctx.db.get` and index query results validate colocated documents before
  returning them to user code.
- The route-selected shard and the schema placement rule now agree for the
  common single-owner case.

Convex references:

- `crates/database/src/transaction.rs`
  - backend transactions mediate reads/writes and commit validation.
- `crates/common/src/schemas/mod.rs`
  - schema metadata participates in backend behavior.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user code reaches storage through a backend-controlled syscall boundary.

Cloudflare difference:

- Convex does not need a placement check for `colocateWith`, because Convex
  does not expose table-to-shard placement. Flarex must verify that a function
  routed to one `PartitionDO` does not write child records owned by another
  shard.

Remaining limitations:

- `routeFromArgs(field)` is still the only function route policy.
- `colocateWith` does not yet automatically infer the function route.
- `partitionBy("_id")` root owner enforcement needs a separate root document
  creation/allocation design.
- Cross-shard workflows and projection routes remain explicit future work.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

## Previous Update

Removed route-only and raw `partitionKey` fallback authorization from normal
backend execution.

Checkpoint title: `Require partition metadata for execution`

Previous completed checkpoint: `7673d45` Bind execution sessions to partition
metadata.

What changed:

- `FunctionExecutionScope` now has only the partition-backed shape. The old
  `route` and `explicit` execution-scope variants were removed.
- `/invoke` and `ExecutionDO` now reject normal query/mutation execution unless
  function metadata declares `partition`.
- `routeFromArgs` metadata may still exist for generated-client transport
  compatibility, but it no longer authorizes backend execution by itself.
- Raw `partitionKey` remains a wire value that must match the declared
  partition argument. It is no longer accepted as an authority fallback.
- Removed route-only authorization tests and converted fixtures to declare
  partition metadata.

Convex references:

- `crates/function_runner/src/lib.rs`
  - execution is created from backend-owned function metadata and transaction
    state before user code runs.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user code cannot choose storage authority directly; it uses backend
    syscalls.
- `npm-packages/convex/src/server/impl/registration_impl.ts`
  - function registration metadata is the durable source for function
    behavior.

Cloudflare difference:

- Convex has no developer-visible shard selector because one logical database
  owns transaction routing. Flarex must require `partition: model.table.byX`
  until explicit global/projection/workflow policies exist.

Remaining limitations:

- Generated clients still send `partitionKey` as transport. The backend now
  validates it from `partition`, but the protocol field has not been removed.
- Non-sharded/global/projection execution policies are not implemented, so
  every normal query/mutation currently needs `partition`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Previous Update

Bound backend execution to stored partition metadata.

Checkpoint title: `Bind execution sessions to partition metadata`

Previous completed checkpoint: `231447a` Preserve partition selector metadata.

What changed:

- Added `FunctionExecutionScope` as the backend runtime view of a function's
  selected shard.
- `/invoke` now resolves execution scope from stored `partition` metadata
  first, then falls back to `route`, then to explicit legacy `partitionKey`.
- `ExecutionDO` session start uses the same resolver, so syscall-backed Dynamic
  Worker sessions and direct invokes enforce the same boundary.
- Partition metadata now rejects mismatched `partitionKey` before schema cache
  sync, transaction begin, handler execution, or syscalls.
- Added backend tests proving stored `partition` metadata drives both direct
  invoke and execution-session routing even without `route` metadata.

Convex references:

- `crates/function_runner/src/lib.rs`
  - function execution is bound to a backend-owned transaction context before
    user code runs.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user code accesses storage through syscalls after the backend establishes
    execution context.
- `npm-packages/convex/src/server/impl/registration_impl.ts`
  - function metadata is attached to the registered handler, not trusted from
    client calls.

Cloudflare difference:

- Convex chooses a logical transaction context without a developer-visible
  shard key. Flarex must resolve a `PartitionDO` key from partition metadata
  and verify the client-sent key is only a transport value, not authority.

Remaining limitations:

- Scoped TypeScript `ctx.db` surfaces are still future work. Runtime now has a
  `FunctionExecutionScope`, but generated handler types do not yet narrow
  allowed writes from `partition: model.table.byX(...)`.
- The explicit `partitionKey` fallback existed at this checkpoint, then was
  removed by `Require partition metadata for execution`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Previous Update

Preserved `partition: model.table.byField(argField)` as first-class function
partition metadata while still lowering it to the existing route metadata for
current runtime compatibility.

Checkpoint title: `Preserve partition selector metadata`

Previous completed checkpoint: `63896da` Generate model partition selectors.

What changed:

- `query`, `mutation`, `action`, and workflow builders now retain optional
  `partition` metadata separately from the route used by today's invoke/sync
  clients.
- `FunctionReference` route inference still receives `{ type: "args", field }`
  so current clients and React hooks keep working.
- Generated `model.users.byId("userId")` and `model.teams.bySlug("teamSlug")`
  now return literal partition descriptors with table, selector,
  partition field, and argument field.
- Local analysis, embedded execution-artifact analysis, and backend
  `DeploymentDO` validation reject partition metadata that:
  - references an unknown table,
  - targets a non-partitioned table,
  - uses a selector that does not match `partitionBy(field)`,
  - points at a missing optional argument,
  - disagrees with explicit route metadata.
- Active function metadata stores `partition_json` next to `route_json`.

Convex references:

- `npm-packages/convex/src/server/registration.ts`
  - function declarations attach metadata to handler wrappers.
- `npm-packages/convex/src/server/schema.ts`
  - schema/table metadata is the source of generated developer APIs.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final generated files consume analyzed backend metadata.

Cloudflare difference:

- Convex does not need a function-level partition selector because one logical
  backend database chooses execution and OCC scope. Flarex must preserve this
  metadata to select and validate the `PartitionDO` boundary before user code
  runs.

Remaining limitations:

- `partition` currently lowers to `routeFromArgs(argField)` for execution.
  Scoped `ctx.db` APIs that statically expose only colocated writes are still
  future work.
- Cross-shard mutations remain out of normal mutation semantics.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter @flarex/example generate
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

## Previous Update

Implemented route-aware generated client references.

Checkpoint title: `Add route-aware generated client inference`

Previous completed checkpoint: `a9ab4bf` Implement routeFromArgs shard policy.

What changed:

- `FunctionReference` now carries optional `_route` metadata.
- `createApi(routeByPath)` creates generated API references whose `_route`
  comes from deployment analysis.
- Final codegen writes analyzed route policies into `_generated/api.ts`.
- `FlarexClient.query()`, `mutation()`, `watchQuery()`, and `onUpdate()` infer
  `partitionKey` from `routeFromArgs(field)` when explicit options omit it.
- `flarex-test` uses the same route inference before posting to the dev
  backend.
- React hooks no longer require `partitionKey` in normal routed calls.
- Example invoke and sync E2E now use generated refs without repeated
  `{ partitionKey }`, while the mismatch test still passes an explicit wrong
  partition to prove backend rejection.

Convex references:

- `npm-packages/convex/src/server/api.ts`
  - generated `api` references are ordinary function references used by client
    calls.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final generated API files are derived from analyzed function/module
    metadata.
- `npm-packages/convex/src/react/client.ts`
  - hooks delegate to the client/watch layer instead of requiring callers to
    supply routing infrastructure.

Cloudflare difference:

- Convex references do not need route metadata because the backend routes into
  one logical database. Flarex references carry `_route` only to derive the
  `PartitionDO` key before sending `/invoke` or `/sync` messages.
- Backend validation still owns correctness. Client inference is a DX layer,
  not an authority boundary.

Remaining limitations:

- Inference only supports exact `routeFromArgs(field)`.
- Unrouted functions still require explicit `{ partitionKey }`.
- Direct raw backend requests still need a concrete `partitionKey`; generated
  clients/test SDK infer before calling the backend.
- No static placement validation exists yet for reads and writes inside the
  selected partition.

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
corepack pnpm --filter flarex-test build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

## Previous Update

Implemented `routeFromArgs(field)` as the first real function route policy and
enforced it at backend execution boundaries.

Previous completed checkpoint: `d6b4712` Document function routing shard
policy.

Convex references:

- `npm-packages/convex/src/server/registration.ts`
  - function declarations carry metadata alongside handlers.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated files preserve analysis-derived function metadata.
- `crates/function_runner/src/lib.rs`
  - user functions execute through a backend-controlled boundary.
- `crates/isolate/src/environment/udf/syscall.rs`
  - storage access is mediated after the backend establishes the function
    execution context.

Cloudflare difference:

- Flarex route metadata selects the `PartitionDO` execution boundary before
  OCC begins. Convex does not need this user-visible route policy because its
  backend presents one logical transactional database.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example build
```
