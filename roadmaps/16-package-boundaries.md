# Package Boundaries

## Executor Injection For DeliveryDO

Previous completed checkpoint: `e4ddeca` Plan DeliveryDO live query fanout.

What changed:

- Added platform-agnostic claim/ack methods to `@flarex/executor`.
- Exposed them through `@flarex/executor-http` and `@flarex/executor-nitro`.
- Kept Cloudflare-specific delivery work out of executor packages.

Boundary rule:

`DeliveryDO` should receive an injected executor client/config later:

```ts
{
  executorUrl,
  capabilityToken,
}
```

It should call the executor over HTTP:

```txt
POST /maintenance/live-queries/claim
POST /maintenance/live-queries/ack
```

It should not import `@flarex/executor`, open Postgres connections, or depend
on Nitro internals.

Convex references inspected:

- `crates/sync/src/state.rs`
- `crates/sync/src/worker.rs`

Flarex difference:

Convex's sync worker does not need an injected executor boundary. Flarex keeps
the boundary explicit because Cloudflare fanout and trusted Postgres execution
are separate runtime deployments.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
```

## DeliveryDO Production Boundary

Previous completed checkpoint: `3288183` Wire live query delivery callback
bridge.

Decision:

Production live-query delivery should be split like this:

```txt
@flarex/executor
  owns durable delivery-row claim/ack semantics

@flarex/executor-http / @flarex/executor-nitro
  expose authenticated claim/ack routes

packages/flarex-backend
  owns Cloudflare DeliveryDO, wake route, ConnectionDO fanout

ConnectionDO
  owns per-client sync state and Transition emission
```

Boundary rule:

- Vercel/Nitro may notify Cloudflare after commit.
- Vercel/Nitro should not own an unbounded fanout loop.
- Cloudflare `DeliveryDO` should own bounded fanout and retries because it runs
  next to `ConnectionDO`.
- The direct executor HTTP callback helper remains a test/fallback primitive,
  not the preferred production drain owner.

Convex references inspected:

- `crates/sync/src/state.rs`
- `crates/sync/src/worker.rs`

Flarex difference:

Convex's sync worker is colocated with backend state. Flarex needs an explicit
runtime boundary because the trusted Postgres executor and Cloudflare WebSocket
ownership are separate deployments.

Verification:

```sh
git diff --check
```

## Live-Query Delivery Bridge Boundary

Previous completed checkpoint: `4e4d736` Add ConnectionDO live query delivery
consumer.

What changed:

- `packages/flarex-backend` now owns the Cloudflare-specific delivery route
  and `ConnectionDO` fanout:
  `POST /deployments/:deploymentId/sync/deliver-live-query`.
- `@flarex/executor-http` now owns a framework-neutral HTTP callback helper:
  `createFlarexBackendLiveQueryDelivery(...)`.
- `@flarex/executor-nitro` re-exports that helper for Nitro/Vercel executor
  apps.

Boundary rule:

- Executor core decides when rows can be acked.
- HTTP/Nitro adapter wires a `deliver(...)` callback.
- Cloudflare backend Worker owns Durable Object namespace access.
- `ConnectionDO` owns the live WebSocket session and transition versioning.

Convex references inspected:

- `crates/sync/src/state.rs`
- `crates/sync/src/worker.rs`

Flarex difference:

Convex does not need this package split because its sync worker and backend
execution are part of the same trusted backend. Flarex needs the split so a
trusted Postgres executor can run on Nitro/Vercel while Cloudflare still owns
WebSocket fanout.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
```

## Postgres Executor Package Boundary Pivot

Previous completed checkpoint: `beef4d2` Document Postgres multitenant
persistence schema.

The Postgres-authoritative plan changes the package target. The trusted
executor must be framework-neutral core first, not a Nitro app first.

New target packages:

```txt
packages/persistence-postgres
  generic document/index persistence and PGlite/Postgres adapters

packages/executor
  trusted transaction executor core with a stable fetch/direct-call protocol

packages/executor-nitro
  Nitro/Vercel adapter only

packages/flarex-test
  in-process executor harness using PGlite by default
```

`packages/flarex-backend` remains the current Cloudflare DO prototype while the
Postgres executor is introduced. It should not grow new Postgres transaction
logic directly. The refactor path is to extract/port reusable contracts into
executor/postgres packages, then retire the authoritative `PartitionDO` commit
path after the Postgres executor is proven.

Detailed plan: `roadmaps/20-postgres-executor.md`.

Convex references:

- `crates/database/src/transaction.rs`
- `crates/database/src/committer.rs`
- `crates/application/src/application_function_runner/mod.rs`
- `npm-packages/convex/src/cli/lib/dev.ts`

Flarex difference:

- Nitro is a production host adapter for Vercel, while local dev and tests call
  the same executor core in-process.

Verification:

```sh
git diff --check
```

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

## Local Backend Push Coordinator Update

Previous completed checkpoint: `3cbd471` Return codegen analysis from push
start.

Added `LocalBackendPushCoordinator` to `packages/flarex-dev`. This keeps local
dev orchestration separate from both:

- the backend Durable Object runtime in `packages/flarex-backend`, and
- the execution-artifact analyzer adapter in `packages/flarex-dev`.

The coordinator is the local stand-in for a hosted backend artifact service:
it accepts a `SourcePackage`, runs the local execution-artifact analyzer, sends
validated analysis to backend `push/start`, and returns the backend push
status used by final codegen.

Convex reference:

- `npm-packages/convex/src/cli/lib/components.ts`
  - CLI orchestration coordinates source bundling, push, final codegen, and
    activation without making application code own backend runtime details.

Cloudflare difference: local Flarex needs a Node-side coordinator because a
Miniflare backend Worker cannot spawn another Miniflare runtime for candidate
artifact analysis. Hosted Flarex should replace this local coordinator with a
backend Dynamic Worker analyzer service for uploaded source packages.

The package also gained its own Vitest config so `flarex-dev` test files run
serially. This matches `flarex-backend` and keeps package-local Vite/esbuild/
Miniflare tests stable during `pnpm -r test`.

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

## Backend Analyzer Boundary Update

Previous completed checkpoint: `67b2e04` Move local analysis behind push
coordinator.

`packages/flarex-dev` now names the analyzer dependency explicitly:

```ts
interface BackendSourceAnalyzer {
  analyze(sourcePackage: SourcePackage): Promise<DeploymentAnalysis>;
}
```

`LocalExecutionArtifactBackendAnalyzer` wraps the local Miniflare execution
artifact adapter. `LocalBackendPushCoordinator` depends on this analyzer
interface and posts analyzed candidates to the internal
`/push/start-analyzed` route.

This keeps package responsibilities clearer:

- `flarex-dev` owns local orchestration and local analyzer adapters.
- `flarex-backend` owns Durable Object candidate state and activation.
- Public `StartPushRequest` is source-only and no longer contains analysis.

Convex reference:

- `npm-packages/convex/src/cli/lib/components.ts`
  - CLI orchestration coordinates source push and consumes backend analysis,
    but the analyzed deployment contract is backend-owned.

Cloudflare difference: Flarex still needs a local Node-side analyzer adapter
until the backend platform can load candidate source packages into the hosted
Dynamic Worker analyzer itself.

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

## Executor HTTP Boundary Update

Previous completed checkpoint for this roadmap: `c563d88` Make push start
source-only.

The trusted Postgres executor HTTP API now has a dedicated adapter package:
`@flarex/executor-http`.

Package responsibilities:

- `@flarex/executor` owns platform behavior:
  - deployment/package resolution
  - function resolution
  - invoke preparation
  - invoke session creation
- `@flarex/persistence-postgres` owns Drizzle schema, migrations, PGlite, and
  low-level Postgres persistence helpers.
- `@flarex/executor-http` owns the real HTTP API router using Elysia:
  - `GET /health`
  - `POST /invoke/prepare`
  - `POST /invoke/start`
  - `POST /invoke/syscall`
  - `POST /invoke/finish`
  - request shape validation
  - executor error-to-status mapping
- `@flarex/executor-nitro` is only a Nitro/deployment wrapper over the HTTP
  app. It must not regain route semantics as invoke/session APIs grow.

Why this changed:

Nitro file routing is a deployment convenience, but Flarex needs one explicit,
testable platform API surface. Elysia gives us a fetch-compatible router that
can be tested directly and mounted under Nitro using Nitro's documented server
entry approach.

External reference:

- `https://nitro.build/examples/elysia`
  - Nitro supports an Elysia server entry where the Elysia app handles incoming
    requests.

Convex reference:

- `crates/local_backend/src/lib.rs`
  - HTTP surfaces are adapters over backend behavior.
- `crates/application/src/application_function_runner/mod.rs`
  - execution semantics stay below the HTTP layer.

Current update:

- `POST /invoke/start` is now part of `@flarex/executor-http` and maps to
  `executor.beginInvokeSession(...)`.
- `POST /invoke/syscall` is now part of `@flarex/executor-http` and maps to
  `executor.invokeSyscall(...)`.
- `POST /invoke/finish` is now part of `@flarex/executor-http` and maps to
  `executor.finishInvokeSession(...)`.
- Nitro remains a wrapper and must continue delegating route behavior to
  `@flarex/executor-http`.

Known limitations:

- No concrete Nitro `server.ts` host app exists yet.
- `@flarex/executor-http` currently has health, invoke prepare, invoke start,
  invoke syscall, and query invoke finish only.
- API request validation is manual until the route bodies settle.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Backend Artifact Store Boundary Update

Previous completed checkpoint: `873fee7` Add R2 execution artifact store
adapter.

`flarex-backend` now has its own artifact store boundary:
`R2BackendExecutionArtifactStore`. This deliberately avoids importing
`flarex-dev` from hosted backend code.

Current package split:

- `flarex`
  - shared runtime-neutral artifact ref/hash helpers in `flarex/artifacts`.
- `flarex-backend`
  - hosted R2 artifact persistence and public push finish verification.
- `flarex-dev`
  - local in-memory artifact store, local Miniflare execution-artifact runtime,
    and local analyzer service.

Known cleanup:

- The R2 object layout and manifest validation are duplicated between
  `flarex-backend` and `flarex-dev`.
- Once the hosted Dynamic Worker loader and local runtime use the same durable
  store contract, extract the duplicated object-layout code into a shared core
  package or a runtime-neutral `flarex/artifact-store` export.

Convex reference:

- `crates/model/src/source_packages/mod.rs`
  - source package persistence is backend model code, not CLI/dev-tool-only
    code.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Runtime Materializer Package Export Update

Previous completed checkpoint: `f88296c` Authorize artifact runtime calls.

`flarex-backend` now exports `./artifact-runtime` for the hosted runtime Worker
surface. The exported module contains the runtime-service-side materialization
contract and cache:

- `ExecutionArtifactMaterializer`
- `MaterializedExecutionArtifact`
- `CachedExecutionArtifactMaterializer`
- `createExecutionArtifactRuntimeService`

Package responsibility:

- `flarex-backend` owns the backend/runtime contract and cache helper.
- a future hosted runtime Worker imports `flarex-backend/artifact-runtime` and
  supplies the Cloudflare Dynamic Worker materializer.
- `flarex-dev` remains responsible only for local Miniflare simulation.

Convex reference:

- `crates/application/src/module_cache/mod.rs`
  - package/module retrieval is a backend execution concern with explicit cache
    boundaries.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Runtime Capability Boundary Update

Previous completed checkpoint: `c623476` Route invoke through artifact
runtime.

Runtime capability ownership is now split by package:

- `flarex-backend`
  - owns `FLAREX_ARTIFACT_RUNTIME_TOKEN`,
  - attaches the bearer capability when calling the hosted runtime binding.
- generated execution artifact code from `flarex-dev`
  - owns `FLAREX_INTERNAL_TOKEN`,
  - rejects unauthorized `/__flarex_internal/*` requests.

This keeps secret/capability transport out of public client APIs and out of
developer-authored `flarex/` functions.

Known cleanup:

- The generated artifact uses a simple bearer token check. The hosted runtime
  should eventually receive the capability through deployment/runtime secret
  configuration, not through app-facing config.
- Session-scoped syscall authorization is still a separate backend/runtime
  contract.

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - backend runner constructs executor requests with auth and callback token
    material.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Backend Artifact Runtime Boundary Update

Previous completed checkpoint: `804a055` Add backend artifact storage binding.

`flarex-backend` now owns the first hosted execution artifact runtime
interface:

- `BackendExecutionArtifactRuntime`
- `ServiceBindingExecutionArtifactRuntime`
- `ExecutionArtifactInvokePayload`

This keeps hosted invoke orchestration out of `flarex-dev`. `flarex-dev` still
owns local Miniflare runtime simulation, while `flarex-backend` owns hosted
runtime service binding orchestration.

Current split:

- `flarex-backend/src/artifactStore.ts`
  - durable package storage lookup.
- `flarex-backend/src/artifactRuntime.ts`
  - hosted runtime invoke payload and service-binding dispatch.
- `flarex-dev/src/executionArtifact.ts`
  - local Miniflare analyzer/runtime simulation.

Known cleanup:

- Local and hosted runtime payloads should converge into one shared contract
  once the Dynamic Worker adapter is real.
- Runtime authorization belongs in the backend/runtime contract, not in
  `flarex-dev`.

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - backend runner owns source-package resolution and executor request
    construction.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Analyzer Diagnostics Boundary Update

Previous completed checkpoint: `0a57edd` Analyze push source through backend
binding.

The analyzer boundary now carries structured diagnostics as well as deployment
analysis:

```ts
type BackendSourceAnalysisResult = {
  analysis: DeploymentAnalysis;
  diagnostics?: AnalyzerDiagnostic[];
};
```

Package responsibilities remain:

- `flarex-dev` owns the local analyzer implementation and Miniflare execution
  artifact diagnostics capture.
- `flarex-backend` owns the source-only push route, analyzer service binding,
  durable push state, and diagnostics persistence.
- future hosted runtime code should replace the local analyzer service with the
  Dynamic Worker analyzer service while preserving the same response shape.

Convex reference:

- `crates/isolate/src/environment/analyze.rs`
  - backend-controlled analysis owns import-time log collection and failure
    reporting.

Cloudflare difference: diagnostics are structured and explicitly forwarded
across the service binding. Convex's current implementation appends collected
logs into the analysis error text inside the backend isolate.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Execution Artifact Runtime Package Boundary Update

Previous completed checkpoint: `d5e13dd` Store active execution artifact
reference.

The invoke-side execution artifact runtime boundary lives in `flarex-dev` for
now:

- `flarex-backend` owns active deployment metadata and execution sessions.
- `flarex-dev` owns the local Miniflare execution artifact runtime adapter.
- generated app code owns `/__flarex_internal/invoke`, the internal artifact
  entrypoint.

`flarex-dev` deliberately defines a narrow local active-deployment response
type instead of importing `flarex-backend/types`, because the backend type file
also contains Cloudflare Worker binding globals (`DurableObjectNamespace`,
`Fetcher`) that should not leak into the dev package's type environment.

Convex reference:

- `crates/model/src/source_packages/mod.rs`
  - source package identity is a model boundary.
- `crates/application/src/application_function_runner/mod.rs`
  - execution runner code consumes package identity without exposing storage
    internals to user code.

Future package cleanup: a shared runtime-neutral package should own
`ExecutionArtifactRef`, analyzed deployment metadata, and validator JSON types
so backend/dev/sdk packages do not duplicate small structural types.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Shared Artifact Reference Helper Update

Previous completed checkpoint: `363d7e0` Add local execution artifact runtime
invoke.

Execution artifact reference types and hash helpers moved into the
runtime-neutral `flarex/artifacts` subpath.

Package responsibilities now are:

- `flarex/artifacts`: structural source package manifest hashing and
  `ExecutionArtifactRef` validation.
- `flarex-backend`: active deployment state and execution-session ownership.
- `flarex-dev`: local in-memory artifact store and local Miniflare runtime
  adapter.

`flarex-backend` now depends on `flarex` for this shared helper. The workspace
install was refreshed so local package links include that dependency.

Convex reference:

- `crates/model/src/source_packages/mod.rs`
  - source package identity is shared model state used by deployment and
    execution code.
- `crates/model/src/modules/types.rs`
  - module hashes are part of the shared module/source-package contract.

Known follow-up: a future `flarex-core` package may be cleaner than using the
public `flarex` package for backend-facing artifact types. For now the
`flarex/artifacts` subpath is narrow and runtime-neutral.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## R2 Artifact Store Adapter Boundary Update

Previous completed checkpoint: `bccc7cd` Add execution artifact store
boundary.

The Cloudflare-oriented artifact store adapter currently lives in `flarex-dev`
because it is still a development/runtime-contract proof, not a deployed
backend service.

Package responsibilities remain:

- `flarex/artifacts` owns artifact refs and manifest hashing.
- `flarex-dev` owns local and R2-shaped artifact store adapters.
- `flarex-backend` owns active deployment metadata, but is not yet wired to an
  artifact bucket binding.

Convex reference:

- `crates/model/src/source_packages/types.rs`
  - the model stores source package storage key and package hash as metadata.

Known follow-up: when hosted backend bindings are added, move Cloudflare
artifact storage behind a backend/runtime package boundary so `flarex-dev`
does not own hosted infrastructure code.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Architecture Terminology Cleanup

Previous completed checkpoint: `da42b4a` Add analysis import phase prelude.

Updated package-boundary wording so hosted analysis is described as a Dynamic
Worker analyzer service for uploaded source packages, not an external platform
dispatch path. `flarex-dev` remains responsible for the local Miniflare
analyzer implementation; `flarex-backend` remains responsible for the
source-only push API and durable candidate state.

Convex reference:

- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - source/config inputs cross the push boundary; analyzed metadata is produced
    by the backend side of that boundary.

Verification:

```sh
git diff --check
```

## Cold-Isolate Consistency Boundary Update

Previous completed checkpoint: `d1b83a9` Clarify Dynamic Worker source package
architecture.

`LocalExecutionArtifactBackendAnalyzer` now owns the cold-isolate consistency
gate. It runs the local execution-artifact adapter twice and compares the
deployment analysis before the analyzer service returns metadata to the
backend.

Package responsibilities remain:

- `flarex-dev` owns the local double-run analyzer gate.
- `flarex-backend` keeps the source-only push route and durable candidate
  state.
- the hosted Dynamic Worker analyzer service should implement the same
  stability contract before activation.

Convex reference:

- `crates/isolate/src/environment/analyze.rs`
  - stable analysis comes from a controlled import-time environment.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Source Position Metadata Boundary Update

Previous completed checkpoint: `c471b67` Gate analysis on cold isolate
consistency.

Source-position metadata now crosses the analyzer/backend boundary as part of
analyzed function metadata. `flarex-dev` produces the best-effort position from
source-package source maps, `flarex-backend` validates and persists it, and
generated metadata preserves it for runtime/dev tooling.

Convex reference:

- `crates/model/src/modules/module_versions.rs`
  - `AnalyzedFunction` owns optional source position metadata.

Package responsibility:

- `flarex-dev` owns local source-map position extraction.
- `flarex-backend` owns validation and durable persistence.
- a future shared/core package should define the common analyzed-function
  metadata shape so backend and dev packages do not duplicate the type.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Analyzer Service Binding Update

Previous completed checkpoint: `c563d88` Make push start source-only.

The backend analyzer boundary now has two concrete pieces:

- `flarex-backend` exposes a `FLAREX_ANALYZER` service binding in `Env` and
  calls it from public `push/start`.
- `flarex-dev` provides `createLocalAnalyzerService()` for local Miniflare,
  backed by `LocalExecutionArtifactBackendAnalyzer`.

This keeps the package roles aligned:

- `flarex-backend` owns the source-only push API and candidate activation.
- `flarex-dev` owns the local implementation of the analyzer service.
- hosted Flarex can later replace the local analyzer service with the Dynamic
  Worker analyzer service without changing the public push request shape.

Convex reference:

- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - source/config request and backend-produced analysis response are distinct.

Cloudflare difference: the analyzer is a service binding in local dev because
the backend Worker cannot create execution artifacts directly yet.

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
