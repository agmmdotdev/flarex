# React Client Hooks

## Status And Scope

**Status:** Active domain authority with an implemented initial React client
layer. The current hooks cover basic reactive queries and mutations, but they
do not yet provide the complete Convex React lifecycle, auth, pagination,
optimistic-update, or server-rendering surface.

This roadmap owns:

- the `flarex/react` provider and hook contracts;
- React query loading, success, and error-state behavior;
- subscription lifecycle and render-safe observer behavior;
- mutation-call ergonomics at the React boundary; and
- the React-specific parity sequence with Convex.

It does not own:

- the public SDK, package exports, or npm distribution, covered by
  [`09-sdk-and-cli-fork.md`](./09-sdk-and-cli-fork.md);
- portable query-sync/delivery boundaries, covered by
  [`query-sync-engine/`](./query-sync-engine/README.md), and concrete Flarex
  transport/reconnect composition, covered by
  [`21-cloudflare-freshness-cache.md`](./21-cloudflare-freshness-cache.md);
- authoritative scope, storage, OCC, or physical routing, covered by the
  [accepted database design](../design-notes/flarex-db-accepted-design.md) and
  FlarexDB foundation plans; or
- backend action, pagination, or auth capabilities that React hooks may later
  expose.

## Current Sources Of Truth

Use these sources in order when they disagree:

1. [`../AGENTS.md`](../AGENTS.md) and the
   [accepted database design](../design-notes/flarex-db-accepted-design.md) for
   authority and replacement rules;
2. [`09-sdk-and-cli-fork.md`](./09-sdk-and-cli-fork.md),
   [`query-sync-engine/`](./query-sync-engine/README.md), and
   [`21-cloudflare-freshness-cache.md`](./21-cloudflare-freshness-cache.md) for
   adjacent SDK, portable sync, and Flarex adapter decisions;
3. this roadmap for the durable React contract and direction;
4. [`packages/flarex/src/react.ts`](../packages/flarex/src/react.ts),
   [`react/queriesObserver.ts`](../packages/flarex/src/react/queriesObserver.ts),
   and [`react/useSubscription.ts`](../packages/flarex/src/react/useSubscription.ts)
   for exact current behavior; and
5. [`packages/flarex/test/react.test.ts`](../packages/flarex/test/react.test.ts)
   for the currently proven React behavior.

Primary checked-in Convex references are:

- [`react/client.ts`](../../../npm-packages/convex/src/react/client.ts) for the
  provider, query, mutation, action, and public hook ergonomics;
- [`react/use_queries.ts`](../../../npm-packages/convex/src/react/use_queries.ts)
  for watch construction and multi-query subscription composition;
- [`react/queries_observer.ts`](../../../npm-packages/convex/src/react/queries_observer.ts)
  for active-watch reuse, client replacement, and local result reads;
- [`react/use_subscription.ts`](../../../npm-packages/convex/src/react/use_subscription.ts)
  for render-safe external subscription behavior;
- [`react/use_paginated_query.ts`](../../../npm-packages/convex/src/react/use_paginated_query.ts)
  for pagination behavior; and
- [`react/ConvexAuthState.tsx`](../../../npm-packages/convex/src/react/ConvexAuthState.tsx)
  and [`react/auth_helpers.tsx`](../../../npm-packages/convex/src/react/auth_helpers.tsx)
  for React auth-state composition.

## Current Architecture

### Provider And Client

`FlarexReactClient` is a thin subclass of `FlarexClient`.
`FlarexProvider` places one client in React context, and `useFlarex` returns it
or fails when called outside the provider. The provider does not own a default
partition, physical route, storage generation, or trusted scope.

### Queries And State

`useQuery` accepts a typed query reference, arguments or `"skip"`, and current
watch options. It delegates to `useQueries`, returns `undefined` while pending,
returns the query value on success, and throws an `Error` during render so a
React error boundary can handle it.

`useQuery_experimental` exposes an object result:

```ts
{ status: "pending" }
{ status: "success", data }
{ status: "error", error }
```

With `throwOnError: true`, the error variant is removed from the declared
result and query failures are thrown during render. `"skip"` produces pending
state in the object form and no active watch.

`useQueries` accepts a dynamic identifier-to-query map without requiring a
variable number of React hooks. A `QueriesObserver` owns active watches,
updates the watch factory when the provider client changes, prunes removed
queries, and releases watches on unmount. `useSubscription` reads once during
render, subscribes after commit, and rechecks immediately so an update between
render and the passive effect is not lost.

The current equality/memoization boundary uses `JSON.stringify` over query
arguments and watch options. This prevents common object-literal resubscribe
loops but is not yet a canonical Flarex-value identity contract.

### Mutations

`useMutation` returns a typed async function that delegates to
`FlarexClient.mutation`. It deliberately has no React-owned mutation cache or
pending/error state. It rejects an accidental React synthetic event argument
and otherwise leaves transport selection and execution errors to the client.

### Current Routing Compatibility

Generated `_partition` and `_route` metadata, explicit `partitionKey` watch
options, and create-root transport behavior remain inputs to the current
compatibility client. They are not accepted React authority and do not imply
that callers choose Postgres scope, storage generation, or physical placement.

The earlier provider-default-partition proposal is rejected. A provider-wide
default can silently bind unrelated components to one legacy shard key and
would promote prototype transport detail into durable UI context. The accepted
replacement derives trusted scope and physical routing at server-controlled
boundaries. React should normally supply a logical function reference,
arguments, and authentication state.

## Invariants And Trust Boundaries

1. **React remains a client adapter.** Hooks reuse `FlarexClient` watches and
   mutations; they do not implement a second sync engine or authoritative
   cache.
2. **The client does not own authoritative scope.** React context, hook options,
   and generated compatibility metadata cannot select a trusted Postgres
   scope, storage generation, fence, or physical route.
3. **Query state is explicit.** Classic `useQuery` means `undefined` while
   loading and throws query errors; the object form preserves distinct pending,
   success, and error states unless `throwOnError` is selected.
4. **Skipped queries do not subscribe.** A skipped query must not create an
   active watch or retain an obsolete subscription.
5. **Subscriptions are render-safe and disposable.** Updates between render
   and subscription are rechecked, stale callbacks cannot update an unmounted
   component, removed queries unsubscribe, and provider-client replacement
   rebuilds watches.
6. **Transport behavior stays below hooks.** Reconnect, journals, auth refresh,
   mutation retry/idempotency, delivery order, and resnapshot semantics belong
   to the client/sync layer.
7. **Unsupported backend semantics are not hidden by hooks.** React APIs for
   actions, pagination, optimistic updates, or SSR are added only with a defined
   lower-layer contract and decisive tests.
8. **Public React imports stay isolated.** Non-React SDK consumers should not
   need React at runtime merely because the core `flarex` SDK exists.

## Decisions And Rationale

### Keep Hooks Thin Over The Client

The Convex observer/subscription shape is portable and already matches the
desired developer mental model. Keeping network and sync behavior in
`FlarexClient` prevents browser and React APIs from drifting into different
protocol implementations.

### Do Not Add A Provider Partition Default

The accepted architecture makes Postgres authoritative and trusted scope a
server-derived property. Retaining explicit or generated partition keys during
migration may be necessary for the compatibility protocol, but adding them to
provider context would deepen the obsolete contract rather than help remove
it.

### Preserve Both Query Result Shapes While The Object API Is Experimental

The classic Convex-like form is compact and integrates with error boundaries.
The object form is useful when loading and errors must be rendered explicitly.
Its experimental name means Flarex may still align it more closely with the
current Convex contract before declaring it stable.

### Add Higher-Level Hooks Only After Their Semantics Exist Below React

`useAction`, pagination, optimistic updates, auth state, and hydration are not
mere wrappers. Each depends on runtime, recovery, identity, cursor, or snapshot
semantics that must be accepted and implemented in the owning domain first.

## Convex Compatibility And Flarex Divergences

Flarex currently follows Convex for:

- a client context and provider;
- typed `useQuery`, `useQueries`, and `useMutation` ergonomics;
- `"skip"` for conditional queries;
- observer-managed watches reused across renders;
- pending-as-`undefined` and render-thrown errors in classic `useQuery`;
- the experimental discriminated query result; and
- post-commit subscription with an immediate missed-update check.

Current Flarex divergences are:

- watch options still expose compatibility `partitionKey` and journal fields;
- generated references still carry compatibility routing metadata;
- the React client lacks actions, pagination, optimistic updates, auth hooks,
  connection-state hooks, hydration, and Next.js helpers;
- query identity uses raw JSON serialization rather than Convex value
  serialization plus a settled canonical Flarex equality contract; and
- React 19 is currently a mandatory peer of the source-only `flarex` package
  instead of being isolated to React consumers.

Only Cloudflare/Postgres constraints and deliberate API choices justify a
lasting divergence. Missing implementation is a gap, not a permanent Flarex
difference.

## Implemented Capabilities

The current implementation exposes:

- the `flarex/react` export and `FlarexReactClient`;
- provider-backed client lookup;
- reactive single-query subscription;
- dynamic multi-query observer infrastructure;
- classic query error throwing;
- experimental pending, success, error, and `throwOnError` behavior;
- typed mutation execution through the provider client;
- accidental React-event rejection; and
- generated compatibility route inference through the underlying client.

Focused React tests directly prove provider-backed single-query
pending-to-success updates, experimental query states and `throwOnError`,
provider-backed mutation execution, and accidental React-event rejection. The
multi-query observer, classic error path, client replacement, and cleanup
contracts are currently code-grounded but not all directly covered. These
tests do not prove browser/concurrent-rendering, reconnect, scope authority, or
production sync correctness.

## Known Gaps And Limitations

- There is no `useAction` because the public client and deployed runtime do not
  yet provide end-to-end action execution.
- There is no `usePaginatedQuery` or accepted live pagination state machine.
- Optimistic updates and mutation-local state are absent.
- Auth is configured directly on `FlarexClient`; React auth providers,
  authenticated/loading state, and token-transition behavior are absent.
- Connection state, reconnect/resnapshot UX, offline behavior, and recovery
  hooks are absent.
- SSR preload, hydration, React Server Component, and Next.js contracts are
  absent.
- Query equality is based on raw `JSON.stringify`; canonical value equality,
  argument key ordering, and option identity have not been hardened.
- Focused tests do not directly prove multi-query add/remove behavior, `"skip"`
  cleanup, classic `useQuery` error-boundary behavior, provider-client
  replacement, Strict Mode, concurrent rendering, tearing resistance, or
  unmount cleanup.
- Tests use deprecated `react-test-renderer`; there is no browser/DOM React
  integration lane.
- `react` remains a package-wide mandatory peer dependency even for consumers
  that never import `flarex/react`.

## Target Direction

The target is a Convex-familiar React layer whose application-facing inputs
are logical function references, typed arguments, authentication state, and
documented UI options. The trusted backend derives scope and physical routing;
the client owns transport, recovery, and local sync state; React owns only
context, lifecycle, and render-facing state.

Compatibility partition fields may remain temporarily while the client and
backend migrate, but they should disappear from normal React call sites rather
than gain a provider-level abstraction. New hooks should closely port the
checked-in Convex implementation where its lower-layer semantics are portable.

## Next Correctness Gates

1. **Harden the existing query lifecycle.** Replace ad hoc query identity with
   an accepted canonical Flarex-value comparison and add focused tests for
   multi-query add/remove, `"skip"`, client replacement, unmount, Strict Mode,
   and concurrent update timing.
2. **Remove React routing authority.** Reconcile generated routing metadata and
   client options with the Postgres scope contract, then prove ordinary hooks
   need no caller-selected physical partition while compatibility behavior
   remains available only at the migration boundary.
3. **Define React auth and connection state.** Port the relevant Convex provider
   pattern after client token transitions, reconnect, resnapshot, and stale
   identity behavior have accepted contracts and recovery tests.
4. **Add actions only with end-to-end runtime support.** A `useAction` exit gate
   includes a public client action method, deployed execution, typed errors,
   auth propagation, and focused React coverage.
5. **Add pagination and optimistic updates after protocol gates.** Define cursor
   continuity, query identity, rollback, retry, and reconnect behavior before
   exposing hooks.
6. **Design SSR and hydration around authoritative snapshots.** Preloaded state
   must carry enough scope/epoch/generation/fence identity to detect stale data
   and resnapshot safely without exposing trusted routing controls.
7. **Finish React distribution and integration proof.** Isolate React from
   non-React SDK consumers and add a maintained DOM/browser test lane covering
   provider, error boundary, lifecycle, and recovery behavior.
