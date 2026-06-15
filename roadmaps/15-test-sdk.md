# Test SDK

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
