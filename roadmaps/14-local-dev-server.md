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

## Push Lifecycle Gap

The backend now exposes candidate push routes, but local dev still deploys by
reading generated Worker metadata and calling legacy direct schema/functions
PUT routes. This is intentionally left as a separate step.

The next local-dev change should use:

```txt
initialCodegen
  -> bundleFlarexSourcePackage
  -> analyzeSourcePackageLocally
  -> POST /push/start
  -> finalCodegen from push response
  -> POST /push/:pushId/finish
```

That change should keep the generated Worker behavior the same while making
the dev server exercise the same backend push lifecycle as hosted deploy.

## Push Lifecycle Implementation Update

Local dev reload now follows the backend push lifecycle:

```txt
initialCodegen
  -> bundleFlarexSourcePackage
  -> analyzeSourcePackageLocally
  -> POST /deployments/:deploymentId/push/start
  -> finalCodegen
  -> build generated app Worker
  -> POST /deployments/:deploymentId/push/:pushId/finish
```

The dev runtime no longer reads generated Worker metadata to deploy schema or
function metadata, and it no longer calls legacy direct schema/functions PUT
routes during reload. The generated app Worker still serves `/invoke`, `/sync`,
`/health`, and `/__flarex_internal/metadata` for compatibility, but local dev
deployment no longer depends on that metadata endpoint.

Activation is ordered conservatively: if final codegen or app Worker build
fails, the push is not finished and the previous app runtime remains active.

The dev health/push debug routes now expose the latest backend push state so
tests and future Vite middleware can verify which candidate is active:

```txt
GET /__flarex_dev/health
GET /__flarex_dev/push
```

Convex references:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - local dev orchestration performs codegen, push, and backend coordination.
- `crates/application/src/deploy_config.rs`
  - push activation happens through `start_push` / `finish_push`.

Cloudflare difference: Flarex still analyzes locally in the Node dev process
and starts an app Miniflare Worker from generated code. The next step is to
move analysis into an execution-artifact adapter so local Miniflare and hosted
Workers for Platforms share the same analyzer boundary.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Execution Artifact Analysis Update

Previous completed checkpoint: `7abaa43` Use backend push lifecycle in local
dev.

Local dev reload now analyzes the source package through
`LocalMiniflareExecutionArtifactAdapter` instead of direct Node import:

```txt
initialCodegen
  -> bundleFlarexSourcePackage
  -> local Miniflare execution artifact analysis
  -> POST /deployments/:deploymentId/push/start
  -> finalCodegen
  -> build generated app Worker
  -> POST /deployments/:deploymentId/push/:pushId/finish
```

This keeps the local dev server closer to the hosted target: the analyzer
receives an immutable source package and runs in a Worker-shaped isolate. The
app project still does not need Wrangler config for Vite dev; Flarex owns the
internal Miniflare runtimes.

Convex references:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - local dev performs codegen, push, and backend coordination in a
    long-running loop.
- `crates/isolate/src/environment/analyze.rs`
  - function metadata is derived from evaluated runtime exports.

Cloudflare difference: Convex local dev talks to a local backend binary that
owns analysis. Flarex now uses a local Miniflare execution artifact as an
adapter boundary, while backend-owned hosted analysis remains future work.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Backend Codegen Analysis Update

Previous completed checkpoint: `27bb9f5` Analyze source packages in execution
artifact.

Local dev now runs final codegen from the backend `push/start` response:

```txt
local Miniflare execution artifact analysis
  -> POST /deployments/:deploymentId/push/start
  -> backend returns codegenAnalysis
  -> finalCodegen(context, started.codegenAnalysis)
```

The locally produced analysis is still needed temporarily because hosted
backend-owned analysis has not been implemented. The important boundary change
is that final generated files now consume the backend's validated and
normalized response, matching Convex's push/codegen order more closely.

Convex references:

- `npm-packages/convex/src/cli/lib/components.ts`
  - final codegen happens after push returns analyzed deployment metadata.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - push responses carry the analyzed metadata needed for generation.

Cloudflare difference: Flarex's local backend reconstructs grouped codegen
modules from flattened function paths. Hosted Flarex should replace the
client-supplied analysis request with backend-created execution-artifact
analysis.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Local Backend Push Coordinator Update

Previous completed checkpoint: `3cbd471` Return codegen analysis from push
start.

Local dev now calls a backend push coordinator with only the bundled source
package:

```txt
reload
  -> initialCodegen
  -> bundleFlarexSourcePackage
  -> pushCoordinator.start(sourcePackage)
  -> finalCodegen from backend push response
  -> build app Worker
  -> pushCoordinator.finish(pushId)
```

`LocalBackendPushCoordinator` owns the local execution-artifact analyzer and
the conversion from grouped codegen metadata to flattened backend activation
metadata. This keeps the reload loop closer to Convex's mental model: source
is pushed to a backend boundary, and analyzed deployment metadata comes back.

Convex references:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - the dev loop pushes bundled source to a backend-controlled deployment
    boundary.
- `npm-packages/convex/src/cli/lib/components.ts`
  - final codegen consumes metadata returned from the push process.

Cloudflare difference: this coordinator is Node-side local dev scaffolding
because the local backend Worker cannot spawn nested Miniflare analysis. The
hosted replacement should be a backend-owned execution-artifact service using
Workers for Platforms dispatch.

`flarex-dev` now runs Vitest files serially, like `flarex-backend`, because
these tests start Vite/esbuild/Miniflare runtimes and can exhaust Windows
workspace-test resources under file-level parallelism.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Source-Only Push Boundary Update

Previous completed checkpoint: `67b2e04` Move local analysis behind push
coordinator.

The public backend `push/start` request is now source-package only. It no
longer accepts analyzed metadata in `StartPushRequest`.

Local dev still works through the coordinator:

```txt
reload
  -> bundleFlarexSourcePackage
  -> LocalBackendPushCoordinator.start(sourcePackage)
      -> BackendSourceAnalyzer.analyze(sourcePackage)
      -> POST /push/start-analyzed
  -> finalCodegen from backend push response
```

`/push/start-analyzed` is explicitly an internal prototype route. It keeps
local dev moving while the hosted backend analyzer is not implemented. The
normal public route returns a clear 501 in this runtime instead of silently
accepting client-authored analysis.

Convex references:

- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - push sends source/config material and receives analyzed metadata.
- `npm-packages/convex/src/cli/lib/components.ts`
  - local dev treats analysis as part of backend push, not application code.

Cloudflare difference: Flarex local dev uses a Node-side
`BackendSourceAnalyzer` to run the local Miniflare artifact. Hosted Flarex
should replace that analyzer with Workers for Platforms artifact dispatch.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Analyzer Service Binding Update

Previous completed checkpoint: `c563d88` Make push start source-only.

Local dev now configures the backend Miniflare runtime with a
`FLAREX_ANALYZER` service binding. The reload path still calls only:

```txt
pushCoordinator.start(sourcePackage)
  -> POST /deployments/:deploymentId/push/start
```

The backend Worker receives that public source-only request, calls
`FLAREX_ANALYZER`, then forwards the analyzed candidate to its internal
`/push/start-analyzed` route. This is closer to Convex's local-dev shape:
the tooling pushes source to the backend boundary and receives backend
analysis in the response.

Convex references:

- `npm-packages/convex/src/cli/lib/components.ts`
  - local dev pushes source and performs final codegen from the backend push
    response.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - backend push response contains analyzed deployment metadata.

Cloudflare difference: the local analyzer binding is a Node-side Miniflare
service, not hosted Workers for Platforms dispatch. It is the adapter boundary
for the hosted implementation.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

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
