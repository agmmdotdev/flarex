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

## Known Limitations

- `useAction` is not implemented yet because action-over-sync is not connected.
- `usePaginatedQuery` is not implemented yet.
- `useQuery_experimental` object-return form is not implemented yet.
- Optimistic updates are not implemented.
- Auth helpers, connection state hooks, hydration helpers, and Next.js helpers
  remain future work.
- `partitionKey` is still required in hook options.
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
