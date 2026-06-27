# Test SDK

## Test SDK Reset Helper

Previous completed test-SDK checkpoint: `d94ef92` Cover packed test SDK
Postgres subscriptions.

What changed:

- Added `reset(): Promise<void>` to the public `FlarexTest` harness.
- `reset()` disposes the current dev runtime, clears a configured test
  persistence directory when `persistDir` is a string, and creates a fresh dev
  runtime with the same options.
- `flarex-test` now reuses `resolveFlarexDevPersistDir(...)` from `flarex-dev`
  instead of duplicating the dev runtime's persistence path convention.
- Reset deletion now goes through `resolveResettableFlarexDevPersistDir(...)`,
  which rejects paths outside the app `.flarex/` directory before recursive
  cleanup.
- The resettable path is validated during `flarexTest(...)` setup, before any
  runtime is disposed, so invalid reset paths fail without leaving a disposed
  harness behind.
- `reset()`, `reload()`, and `dispose()` now share a harness lifecycle queue so
  concurrent lifecycle calls do not leak duplicate runtimes.
- The harness now tracks active, disposed, and lifecycle-failed states so reset
  failures after runtime teardown produce an explicit test-harness error on
  later use, while dispose only becomes idempotent after cleanup succeeds.
- Updated the example invoke E2E to verify committed data disappears after
  `t.reset()`.
- Updated the packed fresh-consumer scripts to prove installed `flarex-test`
  can reset both the legacy/default runtime and the Postgres/PGlite executor
  runtime, including a string `persistDir` Postgres lane.

Why it changed:

Convex-style app tests need a compact harness that can isolate test cases
without manually constructing runtimes or deleting backend state. The recent
packed consumer gates proved query, mutation, and subscriptions; reset is the
next practical test helper to make those checks reusable in larger suites.

Convex references inspected:

- Convex testing helper ergonomics recorded in this roadmap:
  `convex-test` exposes harness-level helpers instead of making each app test
  manually rebuild backend state.
- `npm-packages/convex/package.json`
  - installed package exports define the consumer-facing test contract.

Flarex differences:

- Convex's mock/test runtime owns in-memory backend state directly. Flarex
  resets by recreating the local Miniflare/dev runtime so Durable Objects,
  generated app Workers, and the Postgres/PGlite executor lane are reset
  together.
- Existing clients created before reset are not migrated; tests should create
  new clients after `reset()`.
- `flarex-test` keeps its default `persistDir: false`, while explicit string
  persistence follows the shared `flarex-dev` resolver.
- Explicit string persistence must be under the app `.flarex/` directory to be
  resettable. This is stricter than raw dev runtime persistence because reset
  performs deletion.

Known limitations:

- `withIdentity(...)`, `run(fn)`, and seed helpers remain future work.
- `reset()` is a local test harness operation, not a production deployment
  cleanup API.
- Concurrent lifecycle calls are serialized, but database operations issued
  while reset or dispose is in progress are still test-author responsibility.
- The resettable path guard is unit-tested in `flarex-dev`, and the packed
  Postgres consumer exercises valid string `persistDir` cleanup. Broader
  persistence lifecycle tests remain future work.
- Path guard tests include relative unsafe paths plus absolute paths both
  outside and inside `root/.flarex/`.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- dev.test.ts
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-test typecheck
corepack pnpm --filter flarex-test build
corepack pnpm --dir apps/example exec vitest run flarex/invoke-e2e.test.ts --hookTimeout=60000 --testTimeout=60000
corepack pnpm --filter @flarex/example typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Consumer Postgres Test SDK Subscription

Previous completed test-SDK checkpoint: `9b0486f` Cover packed test SDK
Postgres invoke flow.

What changed:

- Extended `packed-flarex-postgres-test.ts` to create a public
  `FlarexClient` from `flarexTest({ executorTransport: "postgres" }).client()`.
- The packed Postgres script now subscribes to `api.messages.list`, waits for
  the initial Postgres-backed query result, runs `client.mutation(api.messages.send, ...)`,
  and waits for the live-query update delivered through the Postgres executor
  delivery path.
- Extracted a shared generated `packed-live-query-helpers.ts` helper so both
  legacy and Postgres packed scripts use the same order-insensitive message-set
  predicate, timeout behavior, cleanup, and async subscription error handling.

Why it changed:

The previous checkpoint proved direct Postgres query/mutation/read-after-write
from a clean installed consumer. Convex-style app tests also depend on the
client subscription surface, so the packed test SDK must prove that the
Postgres transport can drive live query delivery through the public harness.

Convex references inspected:

- `npm-packages/convex/src/browser/sync/client.ts`
  - Convex's browser client owns live query subscription updates.
- Convex testing helper ergonomics recorded in this roadmap remain the API
  inspiration: generated function references plus a compact app-test harness.

Flarex differences:

- Flarex's Postgres local lane uses PGlite plus the trusted executor and
  Cloudflare-shaped sync bridge. Convex's test surface talks to one Convex
  backend runtime.
- The transport selector remains Flarex-specific during migration from the
  legacy Durable Object prototype.

Known limitations:

- This covers packed Postgres live-query delivery in the local PGlite lane, not
  real Postgres network latency or production WebSocket hosting.
- Identity helper, reset helper, seed helper, and built-artifact package
  validation remain future work.
- The shared helper is generated only inside this packed-consumer fixture. A
  future SDK helper may expose a first-class live-query assertion API.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Consumer Postgres Test SDK Invoke

Previous completed test-SDK checkpoint: `d133982` Cover packed test SDK live
query flow.

What changed:

- Added `packed-flarex-postgres-test.ts` to the fresh packed-consumer fixture.
- The installed `flarex-test` package is now exercised with
  `flarexTest({ executorTransport: "postgres", deploymentId: "packed-postgres" })`.
- The packed script uses generated `api.messages.list` and `api.messages.send`
  references, verifies the initial query is empty, runs a mutation, and then
  verifies a follow-up query observes the committed Postgres/PGlite document.

Why it changed:

The test SDK package boundary already proved direct invoke and live-query
behavior on the default local runtime. The forward architecture is the trusted
Postgres executor, so a clean installed consumer also needs to prove that the
public harness can select and run the Postgres transport without repo-local
imports.

Convex references inspected:

- Convex testing helper ergonomics recorded in this roadmap remain the API
  inspiration: app tests should call generated function references through a
  compact harness.
- `npm-packages/convex/package.json`
  - installed package exports define the consumer-facing test contract.

Flarex differences:

- Flarex exposes `executorTransport: "postgres"` during migration because the
  local runtime still has both legacy and Postgres execution paths. Convex's
  test helper targets a unified Convex backend/test runtime.
- This packed consumer uses PGlite through the local Postgres executor path,
  not a real Postgres server.

Known limitations:

- This proves direct Postgres query/mutation/read-after-write from a packed
  consumer, not Postgres live-query delivery from a packed consumer.
- Identity helper, reset helper, and built-artifact package validation remain
  future work.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Consumer Test SDK Subscription

Previous completed test-SDK checkpoint: `a738186` Cover packed test SDK
mutation flow.

What changed:

- Extended the packed fresh-consumer runtime script to create a public
  `FlarexClient` through `flarexTest().client()`.
- The script now subscribes to `api.messages.list` with `client.onUpdate(...)`,
  waits for the initial live query result, runs `client.mutation(api.messages.send, ...)`,
  and waits for the live query update.
- The live update wait uses semantic message-set predicates instead of exact
  callback counts, fails immediately on async subscription errors, and verifies
  the new message appears with the expected `userId` and body.

Why it changed:

The packed test SDK already proved direct query and mutation invocation. A
Convex-style app test harness also needs the client/live-query surface, because
frontend tests depend on subscription updates after mutations.

Convex references inspected:

- `npm-packages/convex/src/browser/sync/client.ts`
  - Convex's browser client drives live query updates over the sync protocol.
- Convex testing helper ergonomics recorded in this roadmap remain the API
  inspiration: tests should use a compact harness and generated references.

Flarex differences:

- Flarex uses the test SDK's Miniflare-backed WebSocket constructor and local
  dev runtime. Convex's sync client talks to Convex's backend sync service.

Known limitations:

- This covers the legacy/local dev sync path from a packed consumer, not the
  Postgres executor delivery path.
- Identity helper, reset helper, and Postgres-transport packed test SDK gates
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

- This covers a single-partition mutation followed by a query. Subscription was
  added in the next checkpoint; identity helper, reset helper, and
  Postgres-transport packed test SDK gates remain future work.
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
