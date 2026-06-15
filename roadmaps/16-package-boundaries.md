# Package Boundaries

## Problem

The current prototype has a bad package boundary:

```ts
return resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/backend/src/worker.ts");
```

This makes the tooling package reach upward into `apps/backend`. It proves the
local dev path can reuse the real backend Worker, but it is not an acceptable
long-term structure.

## Decision

Keep exactly one real backend implementation and reuse it from dev, tests, and
production deployment.

Target package shape:

```txt
packages/flarex
  public SDK used by app code
  defineSchema, defineTable, query, mutation, v, client

packages/flarex-backend
  actual backend Worker runtime
  RegistryDO, DeploymentDO, PartitionDO, ExecutionDO, SchedulerDO, ConnectionDO
  exports Worker entry and Durable Object classes

packages/flarex-dev
  generator, Vite plugin, local dev runtime
  starts Miniflare using packages/flarex-backend

packages/flarex-test
  test SDK
  reuses the same local runtime core as flarex-dev

packages/flarex-core
  optional later extraction for shared pure contracts
  only create when SDK/backend/dev duplicate real shared logic

apps/backend
  thin deployable Cloudflare Worker wrapper around packages/flarex-backend

apps/example
  normal application using packages/flarex and optionally packages/flarex-dev
  no app-owned Wrangler deployment config
```

## Why

This matches the Convex-like model:

```txt
one backend/runtime implementation
  reused by hosted/backend deployment
  reused by local dev server
  reused by test harness
```

The Vite plugin should not implement a fake backend. It should start the real
backend runtime package in Miniflare. The test SDK should do the same unless a
separate pure mock is intentionally added later.

## Convex References

- `npm-packages/convex/src/cli/lib/localDeployment/run.ts`
  - Convex local dev starts a real local backend process rather than turning
    the application into a backend deployment.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - Convex dev orchestrates codegen, push, watches, and a running backend.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Generated app files support type-safe function authoring and client APIs;
    they are not app-owned deployment infrastructure.

## Cloudflare Difference

Flarex needs a generated app Worker bundle because user functions execute in a
Cloudflare-compatible runtime. That does not mean the user's app should own a
Wrangler deployment. The generated Worker is a runtime artifact loaded by:

- hosted Flarex platform,
- local dev Miniflare runtime,
- test SDK runtime.

The actual Wrangler deployment target is the Flarex backend/platform Worker.

## Follow-Up Work

1. Add `packages/flarex-core` only when shared pure contracts need extraction.

## Verification

## Implementation Update

Completed the package split:

- renamed the tooling package from `packages/flarex-backend` to
  `packages/flarex-dev`,
- moved the real backend Worker runtime and backend tests from `apps/backend`
  into `packages/flarex-backend`,
- added a thin deployable wrapper at `apps/backend/src/worker.ts`,
- updated `packages/flarex-dev/src/dev.ts` to resolve
  `flarex-backend/worker` instead of `../../../apps/backend/src/worker.ts`,
- updated example app imports to use `flarex-dev` for generation/Vite and
  `flarex-backend` for backend test utilities.

The current runtime path is now:

```txt
packages/flarex-dev
  -> starts generated app Worker Miniflare
  -> starts packages/flarex-backend Worker Miniflare

apps/backend
  -> deployable Wrangler wrapper around packages/flarex-backend
```

Convex reference:

- `npm-packages/convex/src/cli/lib/localDeployment/run.ts`
  - Local dev starts a backend runtime owned by the platform, not by the app.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - Dev tooling orchestrates the backend and generated app code.

Cloudflare difference:

- Flarex packages the backend as a Worker/Durable Object runtime that can be
  loaded by Miniflare in dev/tests and by Wrangler through `apps/backend`.

Verification:

```sh
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-dev build
corepack pnpm --filter @flarex/example build
corepack pnpm --filter @flarex/backend build
```

The deployable wrapper now separates local build verification from Wrangler
deployment validation:

```sh
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter @flarex/backend deploy:dry-run
```

`build` typechecks the thin wrapper. `deploy:dry-run` keeps the Wrangler
command for explicit deployment checks without making normal workspace builds
depend on Wrangler.

## Codegen Boundary Update

App codegen no longer accepts `generateWrangler` or `workerName` and never
writes an app-owned Wrangler configuration. `flarex-dev` now explicitly
depends on the public `flarex` SDK because its module analyzer must resolve and
bundle developer imports such as `flarex/server`.

Convex reference:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Application codegen emits generated developer bindings, not deployment
    configuration for the frontend application.
- `npm-packages/convex/src/cli/lib/components.ts`
  - CLI tooling owns bundling, analysis orchestration, and final codegen.

Cloudflare difference:

- Flarex final codegen additionally emits a generated user-function Worker
  runtime artifact, but Flarex dev/test/hosted infrastructure owns loading it.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example generate
```
