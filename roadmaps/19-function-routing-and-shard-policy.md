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
- Generated model partition selectors such as `model.teams.bySlug("teamSlug")`
  are not implemented yet and depend on `partitionBy(field)` owner uniqueness.
- Only `routeFromArgs(field)` exists.
- `routeFromArgs(field)` requires exact string equality between
  `partitionKey` and `args[field]`.
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
