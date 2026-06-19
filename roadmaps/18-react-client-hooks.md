# React Client Hooks

## Current Decision

Flarex should expose a `flarex/react` entrypoint that feels like Convex's
React SDK while remaining explicit about Cloudflare shard routing.

The first React slice is intentionally small:

- `FlarexReactClient`
- `FlarexProvider`
- `useFlarex`
- `useQuery`
- `useQueries`
- `useMutation`

These APIs sit on top of the existing sync client and `watchQuery()` primitive.
They do not introduce a second subscription implementation.

## Convex References

- `npm-packages/convex/src/react/client.ts`
  - `ConvexReactClient`, `ConvexProvider`, `useQuery`, `useMutation`, and the
    public hook ergonomics.
- `npm-packages/convex/src/react/use_queries.ts`
  - `useQueries` builds watches and feeds them through a subscription helper.
- `npm-packages/convex/src/react/queries_observer.ts`
  - Tracks active query watches by identifier, reuses subscriptions across
    renders, and reads local results/errors from stateless watches.
- `npm-packages/convex/src/react/use_subscription.ts`
  - Uses a React-safe subscription pattern so updates between render and effect
    are not lost.

## Cloudflare Difference

Convex can infer query routing from its deployment-wide data model and backend.
Flarex currently requires explicit shard routing:

```ts
const lessons = useQuery(
  api.lessons.list,
  { courseId: "english" },
  { partitionKey: userId },
);
```

Mutations keep the same explicit routing at call time:

```ts
const complete = useMutation(api.lessons.complete);

await complete({ lessonId: "intro" }, { partitionKey: userId });
```

This is less magical than Convex, but it prevents the SDK from implying a
global transaction boundary that the Durable Object design does not provide.
Generated placement metadata may later infer `partitionKey` for colocated
tables and common app patterns.

## Partition Routing Ergonomics Plan

The full backend/platform routing invariant is recorded in
[`19-function-routing-and-shard-policy.md`](./19-function-routing-and-shard-policy.md).
This section only covers the React ergonomics bridge.

Do this in stages instead of jumping directly to full generated inference.

### Stage 1: Provider Default Partition

Add a default `partitionKey` to `FlarexProvider`:

```tsx
const client = new FlarexReactClient(import.meta.env.VITE_FLAREX_URL);

<FlarexProvider client={client} partitionKey={userId}>
  <App />
</FlarexProvider>;
```

Then normal user-sharded calls can look close to Convex:

```ts
const lessons = useQuery(api.lessons.list, { courseId: "english" });

const complete = useMutation(api.lessons.complete);

await complete({ lessonId: "intro" });
```

The hook layer resolves routing in this order:

1. Explicit call option:

```ts
useQuery(api.leaderboard.top, { leagueId }, { partitionKey: `league:${leagueId}` });
```

2. Provider default:

```ts
<FlarexProvider client={client} partitionKey={userId}>
```

3. Runtime error if no route exists.

This keeps routing honest while removing repetitive `{ partitionKey: userId }`
from normal user-owned app screens.

### Stage 2: Generated Routing Inference

Later, generated APIs should use schema placement metadata to infer the route
where it is unambiguous:

```ts
defineTable(...)
  .colocateWith("users", "userId");
```

Generated helpers can then derive `partitionKey` from:

- auth identity for current-user functions
- function args such as `args.userId`
- model placement metadata from `.partitionBy(...)` and `.colocateWith(...)`
- explicit overrides for global/projection/cross-shard reads

If inference is ambiguous, generated helpers must require an explicit route or
throw a clear runtime error. They must not pretend a cross-shard operation is a
single-shard transaction.

## Implemented First Slice

Previous completed checkpoint: `e349214` Add Convex-style watch query client
API.

Implemented `flarex/react` in `packages/flarex`:

- added the `./react` package export
- added React as a peer dependency and test/type dependency
- added `src/react.ts` for the public provider and hooks
- added `src/react/useSubscription.ts` as the React-safe subscription helper
- added `src/react/queriesObserver.ts` for Convex-style query watch reuse
- added `test/react.test.ts` covering provider-backed `useQuery`,
  provider-backed `useMutation`, and accidental React event object rejection

The hook layer uses `watchQuery()` for live queries. `useQuery()` memoizes
arguments and options by serialized JSON so object literals do not cause
render-loop resubscriptions.

## Object Query State Update

Previous completed checkpoint: `81850e6` Add Convex-style React client hooks.

Added `useQuery_experimental()` to match Convex's object-result query hook
shape:

```ts
const lessons = useQuery_experimental({
  query: api.lessons.list,
  args: { courseId: "english" },
  partitionKey: userId,
});

if (lessons.status === "pending") {
  // loading
}
if (lessons.status === "error") {
  // lessons.error
}
if (lessons.status === "success") {
  // lessons.data
}
```

The hook also supports `throwOnError: true`, matching Convex's behavior for
callers that want query failures to flow through React error boundaries.

Convex reference:

- `npm-packages/convex/src/react/client.ts`
  - `useQuery_experimental()` returns `{ status: "pending" }`,
    `{ status: "success", data }`, or `{ status: "error", error }`, and throws
    when `throwOnError` is enabled.

Cloudflare difference:

- Flarex adds top-level `partitionKey` and optional `journal` fields to the
  object options because query watches are still explicitly shard-routed.
- Convex's object form only needs `{ query, args, throwOnError }` because the
  hosted backend owns routing.

Tests now cover pending-to-success, default error-result mode, and
`throwOnError` behavior.

## Known Limitations

- `useAction` is not implemented yet because action-over-sync is not connected.
- `usePaginatedQuery` is not implemented yet.
- Optimistic updates are not implemented.
- Auth helpers, connection state hooks, hydration helpers, and Next.js helpers
  remain future work.
- Hooks infer `partitionKey` from generated `_partition` metadata for functions
  declared with `partition: model.table.byX(argField)`.
- `partitionKey` is still required in hook options for references without
  `_partition`, but backend execution now requires active partition metadata
  for normal functions.
- Provider-level default routing remains future work for app-wide auth/current
  user routing, but it is no longer the only way to remove repetitive
  partition options.
- The first hook tests use `react-test-renderer`, which React now marks as
  deprecated. Keep the tests small until the app-level React test environment
  is introduced.

## Verification

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example build
corepack pnpm --filter @flarex/example test
```

## Partition-Aware Hook Update

Checkpoint title: `Infer client partition keys from partition metadata`

Previous completed checkpoint: `79d11ce` Require partition metadata for
execution.

React hooks now follow the partition-aware `FlarexClient` path:

```ts
const lessons = useQuery(api.lessons.list, { userId });
const complete = useMutation(api.lessons.complete);
await complete({ userId, lessonId: "intro" });
```

The generated function reference supplies `_partition` from
the analyzed `partition: model.users` declaration, and the client sends
`partitionKey: args.userId` on the sync/invoke protocol.

Current example coverage now uses `partition: model.users` directly for the
lesson query and mutation, with generated metadata assertions proving the hook
and client path still receive selector-shaped partition metadata.

Convex reference:

- `npm-packages/convex/src/react/client.ts`
  - hooks delegate to the client/watch layer and keep call sites compact.
- `npm-packages/convex/src/react/use_queries.ts`
  - query subscriptions are managed by function reference and args.

Cloudflare difference:

- Flarex still sends a `partitionKey` transport field because Durable Objects
  require a concrete object name. The hook no longer exposes that for normal
  generated partition-backed calls.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

## Create-Root Mutation Transport Update

Previous completed checkpoint: `b5c9780` Enable create-root generated
execution.

`useMutation(api.users.create)` can now follow the normal client mutation path
for generated create-root references. The client sends a sync mutation without
`partitionKey`; the backend validates `partitionCreateRoot` metadata and
preallocates the root id.

What remains unchanged:

- `useQuery(...)` and live query subscriptions still require generated or
  explicit partition keys.
- Existing-root mutations still infer `partitionKey` from generated partition
  metadata.
- React hooks did not need a separate API surface for create-root.

Convex reference:

- `npm-packages/convex/src/react/client.ts`
  - hooks delegate mutation execution to the client.
- `npm-packages/convex/src/browser/sync/client.ts`
  - the client owns sync mutation transport details.

Cloudflare difference: hook ergonomics are Convex-like, but the generated
function reference still carries Flarex-specific partition metadata so the
client/backend can distinguish create-root from existing-root execution.

Verification:

```sh
corepack pnpm --filter flarex exec vitest run test/client.test.ts --maxWorkers=1
```

## Route-Aware Hook Update

Checkpoint title: `Add route-aware generated client inference`

React hooks now follow the route-aware `FlarexClient` path:

```ts
const lessons = useQuery(api.lessons.list, { userId });
const complete = useMutation(api.lessons.complete);
await complete({ userId, lessonId: "intro" });
```

The generated function reference supplies `_route: routeFromArgs("userId")`,
and the client sends `partitionKey: userId` on the sync/invoke protocol. This
is closer to Convex hook ergonomics while keeping Flarex's shard routing
explicit in generated metadata.
