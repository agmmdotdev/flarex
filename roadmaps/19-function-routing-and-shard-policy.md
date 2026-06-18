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

- `colocateWith` exists in the roadmap design but is not yet fully enforced as
  a route-inference source.
- Only `routeFromArgs(field)` exists.
- `routeFromArgs(field)` requires exact string equality between
  `partitionKey` and `args[field]`.
- Route transforms, `currentUser()`, global route declarations, projection
  route declarations, and workflow/cross-shard route declarations do not exist
  yet.
- Backend execution still accepts explicit `partitionKey` as the route carrier.
- Backend route validation checks function route policy before execution, but
  generated clients do not infer or hide routes yet.
- There is no static or runtime validation that every read/write matches schema
  placement beyond the fact that execution happens inside one `PartitionDO`.
- Provider-level default routing is a convenience, not a correctness boundary.

## Last Update

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
