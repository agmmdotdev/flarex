# Test SDK

## Packed Consumer Test SDK Mutation

Previous completed test-SDK checkpoint: `5cb7dee` Run packed test SDK against
generated app.

What changed:

- Extended the packed fresh-consumer temp app with a public
  `messages.send` mutation.
- The packed `packed-flarex-test.ts` script now:
  - confirms the initial generated query result is empty,
  - invokes `api.messages.send` through `flarexTest().mutation(...)`,
  - verifies the returned message id shape,
  - queries `api.messages.list` again and verifies the persisted document is
    visible with the returned `_id`, expected `userId`, and expected body.

Why it changed:

The previous checkpoint proved that the installed `flarex-test` package can
boot a generated app and run a query. The test SDK also needs package-boundary
coverage for mutation/write sessions because Convex-style test harnesses are
used to validate application mutations, not only reads.

Convex references inspected:

- Convex testing helper ergonomics recorded in this roadmap remain the API
  inspiration: app tests should invoke generated function references through a
  compact harness.
- `npm-packages/convex/package.json`
  - installed SDK exports define the consumer-facing test contract.

Flarex differences:

- Flarex's packed consumer harness runs through local Miniflare/dev runtime and
  the current Flarex backend simulation. Convex's equivalent helper path runs
  against Convex's backend/test runtime.

Known limitations:

- This covers a single-partition mutation followed by a query. Subscription,
  identity helper, reset helper, and Postgres-transport packed test SDK gates
  remain future work.
- The typecheck is still a Vite/Bundler-style source-package check until Flarex
  publishes built artifacts.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Consumer Test SDK Invocation

Previous completed test-SDK checkpoint: `44878a0` Add packed consumer smokes
for test and Nitro packages.

What changed:

- Extended the fresh-consumer packed install fixture with a
  `packed-flarex-test.ts` script.
- After packed `flarex-dev` generates `_generated/api`, the temp consumer now
  runs `flarexTest()` from the installed `flarex-test` tarball.
- The script invokes `api.messages.list` through the test SDK and asserts the
  generated app returns an empty list, then disposes the runtime.
- The packed script uses the public `encodeFlarexId` helper instead of casting
  a string to a branded ID.
- The script derives the numeric `users` table id from generated
  `deploymentSchema` before calling `encodeFlarexId`, avoiding a duplicated
  analyzer table-id convention.
- The table name is typed with generated `TableNames`, so the branded ID type
  and generated metadata lookup stay aligned in the packed consumer script.
- The temp consumer manifest declares `tsx` directly because the packed test
  SDK smoke runs through `pnpm exec tsx`.

Why it changed:

The previous checkpoint proved install, import, and runtime resolution for the
test SDK, but it did not prove the packed `flarex-test` factory could actually
boot a generated Flarex app from a clean consumer install. This closes that
package-consumer gap without adding a second test framework inside the temp
app.

Convex references inspected:

- Convex testing helper ergonomics recorded in this roadmap remain the API
  inspiration: app tests should call a compact harness rather than manually
  wiring the backend.
- `npm-packages/convex/package.json`
  - installed package exports define the consumer-facing test contract.

Flarex differences:

- Flarex's packed consumer harness runs against the local Miniflare/dev runtime
  path. Convex's test helpers target Convex's own backend/test environment.

Known limitations:

- The packed test SDK invocation covers a read-only query with no writes.
  Mutation and subscription invocation from packed `flarex-test` remain future
  consumer gates.
- Identity helpers, reset helpers, and richer test harness APIs remain future
  work.
- The typecheck is still a Vite/Bundler-style source-package check until Flarex
  publishes built artifacts.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Test SDK Fresh-Consumer Smoke

Previous completed test-SDK checkpoint: `fad789f` Add test SDK and Nitro
package boundaries.

What changed:

- Added `flarex-test` to the packed fresh-consumer install fixture.
- The fixture now overrides transitive `flarex-test` dependencies to the packed
  local tarballs, including `flarex-dev`.
- The temp consumer imports the primary `flarexTest` factory,
  `FlarexTestInvocationError`, and the `FlarexTest` public type from the
  installed tarball.
- The fixture runs both consumer `tsc` and runtime `tsx` smokes after codegen.

Why it changed:

`flarex-test` is an app-test package. It must resolve from a clean consumer
install, not only from the workspace package graph.

Convex references inspected:

- Convex testing helper ergonomics recorded in this roadmap remain the API
  inspiration.
- `npm-packages/convex/package.json`
  - installable package boundaries are part of the public testing contract.

Flarex differences:

- Flarex's test SDK wraps the local dev runtime and Miniflare path. Convex's
  test package targets Convex's own backend/test harness.

Known limitations:

- The packed-consumer smoke imports the test SDK but does not yet run
  `flarexTest(...)` against the generated packed fixture.
- Identity helpers, reset helpers, and richer test harness APIs remain future
  work.
- The typecheck is still a Vite/Bundler-style source-package check until Flarex
  publishes built artifacts.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/internal-packages-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/internal-packages-pack.integration.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Test SDK Tarball Boundary

Previous completed test-SDK checkpoint: `339e671` Add packed consumer
generated typecheck gate.

What changed:

- Added `files: ["src"]` to `packages/flarex-test/package.json`.
- Added `flarex-test` to `integration/internal-packages-pack.integration.test.ts`.

Why it changed:

The test SDK is meant to be consumed by app tests, so its packed artifact should
only expose the public helper source and package metadata. Repo-local type tests
and `tsconfig.json` should not be part of the install surface.

Convex references inspected:

- `npm-packages/convex/package.json`
  - installable package contents are explicit package-boundary metadata.
- Convex testing helper ergonomics remain the API inspiration recorded below.

Flarex differences:

- `flarex-test` runs through the local Flarex runtime and Miniflare path rather
  than Convex's hosted backend test harness.

Known limitations:

- This does not yet run `flarex-test` from a packed consumer fixture.
- `flarex-test` still lacks `run(fn)`, `withIdentity(...)`, and reset helpers.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/internal-packages-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/internal-packages-pack.integration.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Postgres Executor Runtime Option

Previous completed test-SDK checkpoint: `d76c97c` Add reviewer subagent
configs.

What changed:

- Added `executorTransport?: "legacy" | "postgres"` to `flarexTest(...)`.
- The option forwards to `createFlarexDevRuntime(...)`, letting integration
  tests choose the legacy backend path or the Postgres/PGlite executor path.
- Updated the example sync E2E to use this option for the public-client
  Postgres delivery scenario.

Why it changed:

The test SDK already ran the same Miniflare runtime as the Vite dev path, but
it always used the default legacy transport. The current architecture needs
tests to opt into the Postgres executor path without constructing dev-runtime
internals by hand.

Convex references inspected:

- `npm-packages/convex/src/browser/sync/client.ts`
  - client subscriptions receive backend query transitions.
- Convex testing docs / `convex-test` API shape
  - tests use a compact harness API instead of directly wiring the backend.

Flarex differences:

- Convex test helpers can mock a unified Convex backend. Flarex exposes a
  transport option because the local runtime has two meaningful execution
  paths during migration: legacy DO execution and Postgres-authoritative
  execution.

Known limitations:

- The option is transport-level only. It does not expose lower-level executor
  hooks, seeded persistence, or real Postgres configuration yet.
- `flarex-test` still lacks `run(fn)`, `withIdentity(...)`, and reset helpers.

Verification:

```sh
corepack pnpm --filter @flarex/example test -- sync-e2e.test.ts
```

## Decision

Flarex needs a dedicated test SDK, but it should not fork `convex-test` as the
primary execution engine.

Instead, Flarex should copy the developer ergonomics of `convex-test` while
running tests through the same real Flarex local runtime used by the Vite
plugin:

```txt
flarex-test
  -> generated app Worker Miniflare
  -> FLAREX_BACKEND service binding
  -> backend Worker/DO Miniflare
```

This keeps test behavior close to production-critical Cloudflare behavior:
Durable Objects, execution sessions, schema/function metadata, syscalls, and
OCC all stay in the tested path.

## Proposed API

Convex-style test entrypoint:

```ts
import { flarexTest } from "flarex-test";
import { api } from "../flarex/_generated/api";

const t = await flarexTest();

await t.mutation(api.lessons.complete, {
  userId: "2:u1",
  lessonId: "intro",
});

const lessons = await t.query(api.lessons.list, {
  userId: "2:u1",
});

await t.dispose();
```

Expected first methods:

- `query(reference, args, options?)`
- `mutation(reference, args, options?)`
- `action(reference, args, options?)`
- `run(fn)`
- `fetch(path, init?)`
- `withIdentity(identity)`
- `reset()`
- `dispose()`

Flarex-specific options must include partition routing until generated helpers
can infer it safely:

```ts
await t.mutation(api.lessons.complete, args, {
  partitionKey: "user:2:u1",
});
```

## Convex References

- `convex-test` package
  - Public package description: JS mock of the Convex backend for testing
    Convex functions.
  - `convexTest(schema?, modules?)` returns a `t` object with `query`,
    `mutation`, `action`, `run`, `fetch`, identity helpers, and scheduled
    function helpers.
- Convex docs: testing overview
  - Convex documents two automated testing lanes: `convex-test` pure JS tests
    and testing against a real local backend.

## Cloudflare Difference

`convex-test` is a pure TypeScript mock backend. That is useful for fast unit
tests in Convex, but it would hide the most important Flarex behavior:

- Durable Object routing and persistence
- backend execution sessions
- service-binding syscalls
- partition-local OCC
- generated Worker validation and metadata deployment

So Flarex should not start by forking `convex-test` internals. It should fork
or mimic its public API shape, then back that API with Flarex's real Miniflare
runtime core.

Later, Flarex may add a pure JS mock layer for very fast unit tests, but that
must be secondary to the real-runtime test SDK.

## Follow-Up Work

1. Add `run(fn)` and `withIdentity(identity)` helpers.
2. Add scheduler helpers after scheduler semantics exist.
3. Add reset/seed APIs that clear local DO persistence between tests.
4. Add first-party tests inside `packages/flarex-test` instead of relying only
   on the example app integration test.
5. Add Vite dev-server browser WebSocket coverage after middleware upgrade
   handling exists.

## Implementation Update

Added the first `packages/flarex-test` package.

Implemented:

- `flarexTest(options)`
- `query(reference, args, { partitionKey })`
- `mutation(reference, args, { partitionKey })`
- `action(reference, args, { partitionKey })`
- `invokeRaw(reference, args, { partitionKey })`
- `fetch(path, init)`
- `reload()`
- `dispose()`

`flarex-test` reuses `createFlarexDevRuntime` from `flarex-dev`, so tests run
through the generated app Worker and real `flarex-backend` Durable Object
runtime. By default it uses in-memory Durable Object persistence, not the
application's `.flarex/dev` directory.

Migrated `apps/example/flarex/invoke-e2e.test.ts` from a hand-written
Miniflare/backend harness to `flarex-test`. The test still uses `invokeRaw` for
backend envelope assertions (`committedTs`, `writes`, `readSet`) and raw
`fetch` for malformed-ID validation.

Convex reference:

- `convex-test`
  - Public API shape: `convexTest`, `query`, `mutation`, `action`, `run`,
    `fetch`, identity helpers, scheduler helpers.

Cloudflare difference:

- `convex-test` is a pure JS mock backend. `flarex-test` starts from a real
  Miniflare-backed Worker/DO runtime because Cloudflare routing, service
  bindings, execution sessions, and OCC are core Flarex semantics.

## Sync Client Test Update

Previous completed checkpoint: `be78189` Add Convex-style sync client slice.

`flarex-test` now exposes a WebSocket-capable public client for real app tests:

```ts
const client = t.client();

const unsubscribe = client.onUpdate(
  api.lessons.list,
  { userId },
  value => {
    // live query result
  },
  error => {
    // query failure
  },
  { partitionKey },
);
```

The implementation creates a browser-like `WebSocketConstructor` backed by the
same `createFlarexDevRuntime` Miniflare stack used for `query`, `mutation`, and
`invokeRaw`. It connects to:

```txt
ws://flarex.test/__flarex_dev/sync
```

which the dev runtime forwards to the active backend deployment sync route.

Added `apps/example/flarex/sync-e2e.test.ts`, proving the public generated API
path end to end:

```txt
api.lessons.list
  -> FlarexClient.onUpdate
  -> /__flarex_dev/sync
  -> backend /deployments/:deploymentId/sync
  -> ConnectionDO
  -> active execution artifact
  -> PartitionDO/OCC
  -> Transition.QueryUpdated back to the SDK callback
```

The test subscribes to `api.lessons.list`, observes the initial empty result,
executes `api.lessons.complete` through sync mutation transport, and observes
the live query refresh with the completed lesson.

Convex reference:

- `npm-packages/convex/src/browser/sync/client_node_test_helpers.ts`
  - Convex tests the client with a Node `ws` WebSocket bridge.
- `npm-packages/convex/custom-vitest-environment.ts`
  - Convex injects a Node WebSocket implementation for browser-shaped tests.

Cloudflare difference:

- The Flarex helper is backed by Miniflare and real Durable Objects rather than
  a standalone in-memory WebSocket server, because DO routing and execution
  artifacts are part of the behavior under test.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm --filter flarex-test test
corepack pnpm --filter flarex-test build
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example build
```

## Verification

Research checked:

```sh
npm pack convex-test
```

Validation commands run:

```sh
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm --filter @flarex/example test
```

The previous `apps/example` Vitest close-timeout warning is fixed. The root
cause was Vitest loading the example's Vite config and Flarex Vite plugin for
tests. Added `apps/example/vitest.config.ts` so tests do not load the app dev
plugin unless they are actually running Vite dev.
