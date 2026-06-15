# Local Dev Server

## Current Implementation

Added the first Convex-shaped local dev runtime behind the Vite plugin.

The Vite plugin now:

1. generates Flarex files before dev startup,
2. starts a backend Miniflare runtime with the backend Worker and Durable
   Objects,
3. starts a generated app Worker Miniflare runtime with a `FLAREX_BACKEND`
   service binding to the backend runtime,
4. reads generated schema/function metadata from the app Worker,
5. deploys that metadata into the backend runtime,
6. exposes `/__flarex_dev/*` through Vite middleware,
7. debounces app file changes by 500ms and reloads/regenerates/redeploys.

Current dev routes:

```txt
GET  /__flarex_dev/health
POST /__flarex_dev/invoke
```

The proxy strips `/__flarex_dev` and forwards to the generated app Worker, so
`/__flarex_dev/invoke` executes the same generated Worker `/invoke` path used by
the example E2E test.

## Why

Convex local dev is a long-running orchestrator, not just a static generator.
It watches files, generates code, talks to a running backend, and keeps local
development state synchronized. Flarex should keep that shape while replacing
the local Rust backend process with Cloudflare-native Miniflare Workers and
Durable Objects.

## Convex References

- `npm-packages/convex/src/cli/lib/dev.ts`
  - `devAgainstDeployment` owns the long-running dev loop.
  - `watchAndPush` regenerates/pushes code and waits on file/backend changes.
  - File watch uses a quiescence delay before rerunning push.
- `npm-packages/convex/src/cli/lib/localDeployment/run.ts`
  - Convex starts a separate local backend process, persists state, and
    health-checks a local URL.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Convex prepares generated files before analysis and push.

## Cloudflare Difference

Convex starts a local backend binary. Flarex starts Miniflare runtimes:

```txt
Vite dev server
  /__flarex_dev/*
    -> generated app Worker Miniflare
      -> FLAREX_BACKEND service binding
        -> backend Worker/DO Miniflare
```

The generated app Worker remains the user-code execution boundary. The backend
Worker and Durable Objects remain the transaction/session/OCC boundary.

The app project should not need a generated Wrangler config for normal Vite
dev or hosted production. The application client should target either the
hosted Flarex deployment URL or the local dev URL exposed by Vite
(`/__flarex_dev`). Wrangler belongs to the Flarex backend/platform deployment
target, not to every app using Flarex.

## Known Limitations

- `/__flarex_dev/sync` is only structurally proxied if the generated Worker path
  exists; WebSocket upgrade handling is not implemented in the Vite middleware
  yet.
- The local dev runtime uses Vite bundling on reload. It does not yet implement
  Convex's full module analysis pipeline or streamed logs.
- WebSocket upgrade handling is not implemented in the Vite middleware yet.
  `/__flarex_dev/sync` remains future work.
- Test runs should use a Vitest-specific config instead of loading an app's
  Vite dev plugin. The example app now follows that rule.
- The dev runtime persists state under `.flarex/dev` by default and removes it
  on dispose unless a custom `persistDir` is provided.

## Target Push Lifecycle

Local dev must stop deploying metadata through a special shortcut. It should
exercise the same Convex-shaped lifecycle as hosted Flarex:

```txt
file change
  -> initial codegen
  -> source bundle
  -> local start_push
  -> candidate Miniflare execution artifact
  -> authoritative candidate analysis
  -> final codegen from analysis response
  -> typecheck
  -> local finish_push
  -> active candidate serves invoke requests
```

Miniflare is the local implementation of the execution-artifact adapter.
Workers for Platforms dynamic dispatch is the hosted implementation. The push
state machine, analysis contract, final codegen input, and activation semantics
must be shared.

See `roadmaps/17-deployment-analysis-and-push.md`.

## Verification

```sh
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm typecheck
corepack pnpm test
corepack pnpm --filter @flarex/example test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex build
corepack pnpm --filter @flarex/example build
```

The deployable backend wrapper no longer runs Wrangler as its normal `build`.
Wrangler deployment validation is available through
`corepack pnpm --filter @flarex/backend deploy:dry-run`.
