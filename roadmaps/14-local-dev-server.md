# Local Dev Server

## Dry-Run Write Foundation For Local Codegen

Previous completed checkpoint: `f6a1984` Add codegen typecheck modes.

What changed:

- Final generated write output can now be computed through
  `finalGeneratedFiles(...)` without writing files.
- Local dev and CLI codegen still call `finalCodegen(...)`, but that writer now
  consumes the same write plan a future dry-run command can print.

Why it changed:

Local command behavior should move toward Convex's `codegen --dry-run` without
inventing a second generator path. A shared final write plan lets future local
CLI dry-run output and normal codegen stay aligned.

Convex references inspected:

- `npm-packages/convex/src/cli/codegen.ts`
  - Convex exposes `--dry-run` for generated configuration output.
- `npm-packages/convex/src/cli/dev.ts`
  - local workflows depend on generated code staying consistent.

Flarex differences:

- Flarex has only the write planning foundation; no local dry-run command
  exists yet.
- Initial bootstrap generation still writes to disk for local analysis.

Known limitations:

- No `flarex dev` command uses this yet.
- Dry-run output format and stale deletion planning are not designed yet.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "plans final generated output" --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example generate
git diff --check
```

## Codegen Typecheck Mode For Local Commands

Previous completed checkpoint: `7eeb277` Add source CLI entrypoint.

What changed:

- Local command help now exposes `--typecheck <mode>` for codegen.
- The example generated-output command uses `--typecheck enable`.
- The source CLI runner supports `try` mode for best-effort generated-output
  validation.

Why it changed:

Local workflows need the same shape as the eventual CLI. Convex exposes
typecheck policy as a codegen mode, which lets CI fail strictly while local/dev
flows can choose best-effort behavior.

Convex references inspected:

- `npm-packages/convex/src/cli/codegen.ts`
  - `--typecheck <mode>` supports explicit codegen typecheck policy.
- `npm-packages/convex/src/cli/dev.ts`
  - local workflow readiness is tied to generated code and typechecking.

Flarex differences:

- Flarex defaults to no generated-output typecheck unless a mode is provided.
- `try` mode emits a plain stderr warning instead of Convex's richer CLI
  diagnostics.

Known limitations:

- No `flarex dev` command uses these modes yet.
- No global CLI binary exists yet.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev cli -- codegen --help
corepack pnpm --filter @flarex/example typecheck:generated
corepack pnpm --filter @flarex/example generate
corepack pnpm --filter @flarex/example typecheck
git diff --check
```

## Source CLI Entrypoint For Local Workflow

Previous completed checkpoint: `24fcc04` Route example generate through CLI
runner.

What changed:

- `flarex-dev` now has a source-mode `cli` package script backed by
  `packages/flarex-dev/src/bin.ts`.
- The CLI runner accepts package-script invocation with a leading `--`, so
  local commands can be exercised as process commands instead of only direct
  function calls.
- The example app still uses its app-local wrappers, but the underlying
  command runner now has its own process entrypoint for local validation.

Why it changed:

Local development needs a command process boundary before a full `flarex dev`
or installed binary exists. This mirrors Convex's split between a source
development entrypoint and a packaged CLI entrypoint while staying honest about
Flarex's current source-only package shape.

Convex references inspected:

- `npm-packages/convex/bin/main-dev`
  - development CLI entrypoint runs from source.
- `npm-packages/convex/bin/main.js`
  - packaged CLI entrypoint runs built output.
- `npm-packages/convex/src/cli/program.ts`
  - command registration is centralized.

Flarex differences:

- This is a package script, not a published `bin`.
- No `flarex dev` command exists yet.
- The source entrypoint is only for local/dev validation while packages remain
  `noEmit`.

Known limitations:

- A real installed CLI still requires a build/output strategy.
- The local dev runtime is still invoked through Vite/dev APIs, not a CLI
  `dev` command.

Verification:

```sh
corepack pnpm --filter flarex-dev cli -- codegen --help
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example generate
corepack pnpm --filter @flarex/example typecheck:generated
corepack pnpm --filter @flarex/example typecheck
git diff --check
```

## Example App Generation Uses Command Boundary

Previous completed checkpoint: `5efa1f7` Default codegen CLI root to project.

What changed:

- `apps/example/scripts/generate.ts` now delegates to `flarex-dev/cli`.
- The example app's `generate`, `typecheck`, `build`, and `test` scripts now
  reach codegen through the CLI runner because they all depend on `pnpm
  generate`.
- The separate generated-output typecheck command already uses the same runner.

Why it changed:

Local app scripts should model the future user workflow. Using the command
runner for normal generation keeps the example aligned with the Convex-style
project command direction instead of preserving an app-local helper shortcut.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - local workflows compose project commands around generated state.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - codegen is command workflow logic.

Flarex differences:

- This is still not a `flarex dev` process.
- The app still invokes the source runner through `tsx`, not an installed
  executable.

Known limitations:

- No watch mode is attached to the CLI runner.
- No published binary installation path exists yet.

Verification:

```sh
corepack pnpm --filter @flarex/example generate
corepack pnpm --filter @flarex/example typecheck:generated
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example typecheck
git diff --check
```

## Project-Root CLI Script Shape

Previous completed checkpoint: `1ae9066` Add source CLI runner for codegen.

What changed:

- The example app's generated-output command now invokes `codegen --typecheck`
  without `--root`.
- `runFlarexDevCli(...)` uses the current project directory as the default app
  root, with explicit `--root` still available as an override.
- Help text now describes `--root` as optional.

Why it changed:

The local development script should look like a command run from an app, not a
wrapper around an internal helper. This is closer to Convex's `npx convex ...`
style where the project directory is implicit.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - local dev workflow runs from project context.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - codegen is part of the command workflow.

Flarex differences:

- The command is still invoked through an app-local `tsx` script because no
  emitted CLI binary exists.
- The script still passes workspace-specific typecheck path mappings.

Known limitations:

- No `flarex dev` command exists yet.
- No published binary installation path is tested yet.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example typecheck:generated
git diff --check
```

## CLI Runner Boundary For Generated Codegen

Previous completed checkpoint: `1a19708` Add example generated output
typecheck.

What changed:

- `flarex-dev/cli` now exports `runFlarexDevCli(...)`.
- The example app's `typecheck:generated` command uses the CLI runner to call
  `codegen --typecheck`, so local app validation no longer composes the
  lower-level helper directly.
- The runner remains source-level and directly testable while the local dev
  server and Vite plugin continue to use their existing lifecycle hooks.

Why it changed:

Local dev needs a command-shaped boundary that can later become the Convex-like
CLI entrypoint. Keeping the runner separate from Vite avoids making the plugin
the only way to validate generated output.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - local dev is orchestrated through CLI/dev workflow state.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - codegen is a reusable command concern.

Flarex differences:

- Flarex still has no process-level CLI binary in this package.
- The local dev runtime and Vite plugin still call shared package helpers
  directly; the runner is for command-style app/CI use.

Known limitations:

- No watch mode is attached to the CLI runner.
- No full `flarex dev` command exists yet.

Verification:

```sh
corepack pnpm --filter @flarex/example typecheck:generated
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Optional Generated Output Typecheck In Dev Flow

Previous completed checkpoint: `7380900` Expose generated output typecheck.

What changed:

- `createFlarexDevRuntime(...)` now accepts
  `typecheckGeneratedOutput?: false | FlarexGeneratedOutputTypecheckConfig`.
- The dev runtime runs generated-output typecheck after authoritative final
  codegen and before executor package activation or app replacement.
- The Vite plugin accepts the same option and runs it after plugin-driven
  `generateFlarex(...)` calls.
- The Vite plugin passes the option into the local dev runtime so reloads can
  enforce the same generated-output gate.
- `dev.test.ts` now creates both legacy and Postgres dev runtimes with
  generated-output typechecking enabled.
- Dev runtime reload/typecheck startup failures now dispose local Miniflare
  resources before rethrowing.
- Reload/typecheck startup-failure cleanup is best-effort for each runtime
  resource, preserves the primary startup error, and removes the default
  `.flarex/dev` persist directory after disposals settle.
- Public `dispose()` still reports cleanup failures, aggregating multiple
  resource-disposal errors instead of silently swallowing them.
- Added a dispose regression proving default persist cleanup failures are
  reported during normal user-initiated shutdown.
- The Vite plugin skips plugin-owned codegen/typecheck during normal dev
  startup when the dev runtime will own authoritative final codegen.
- The Vite plugin also avoids a second plugin-owned codegen/typecheck pass when
  `dev: false` serve startup already ran one.
- Added failure coverage proving dev runtime startup and Vite build codegen
  reject when the generated-output typecheck command fails.
- Added cleanup coverage proving the default dev persist directory is removed
  when startup fails during generated-output typecheck.
- Added Vite serve coverage proving `dev: false` startup does not rerun the
  plugin-owned generated-output gate.
- Added default Vite dev coverage proving `typecheckGeneratedOutput` is
  forwarded into the dev runtime.
- `dev: false` watcher generated-output failures are caught and reported
  through the Vite logger instead of escaping the watcher callback.
- Minimal Flarex test-project setup for lifecycle tests now lives in
  `packages/flarex-dev/test/fixtures.ts`.

Why it changed:

The previous checkpoint exposed the typecheck helper but did not use it in the
actual local dev lifecycle. Convex's dev flow treats generated code as a real
developer-facing contract. Flarex should fail before activation when final
codegen emits broken generated TypeScript, instead of letting the app continue
with invalid local imports.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Convex codegen participates in typecheck-aware dev workflows.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - local dev orchestration owns push/codegen readiness before serving a
    deployment.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - generated TypeScript is a first-class local import surface.

Flarex differences:

- Flarex keeps generated-output typecheck opt-in for now because workspace and
  app package resolution can differ, especially in examples and tests.
- The gate compiles `_generated/**/*.ts`, not the entire app's TypeScript
  program.

Known limitations:

- Vite production builds and `dev: false` still run plugin-owned codegen and
  optional generated-output typecheck.
- No CLI command or diagnostic UI exists yet; errors surface as thrown
  TypeScript stdout/stderr.
- Backend construction failures before the dev runtime object exists are not
  covered by this cleanup path yet.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generatedTypecheck.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/devDispose.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/dev.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/vite.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "typechecks generated output" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev build
```

## Generated Output Typecheck Building Block

Previous completed checkpoint: `f7634e1` Typecheck generated output tree.

What changed:

- Added an exported `typecheckGeneratedOutput(...)` API in `flarex-dev`.
- The API can be called by future Vite plugin, dev runtime, or CLI flows after
  codegen completes.
- The helper supports custom `typescriptCliPath`, `cwd`, ambient `types`,
  `typeRoots`, and `paths` so local dev can use normal app resolution while
  tests can resolve workspace source packages.
- By default the helper writes its config to a temporary directory and cleans
  it up after TypeScript exits.

Why it changed:

Local development should eventually follow the Convex-style sequence:
generate, analyze/push, final codegen, then typecheck generated output before
activating or serving a broken app. This checkpoint creates the reusable
primitive without changing dev-server activation behavior yet.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Convex's dev/push/codegen workflow owns generated-code correctness checks.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - generated files are local developer imports and should be verified before
    use.

Flarex differences:

- This slice does not yet call the helper from the Vite plugin or dev runtime.
- The helper compiles only `_generated/**/*.ts`, not the whole application.

Known limitations:

- Dev-server push/codegen can still complete without invoking generated output
  typecheck.
- No surfaced diagnostic formatting beyond TypeScript stdout/stderr wrapping
  exists yet.

Verification:

```sh
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "typechecks generated output" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev build
```

## Vite Config Load Boundary

Previous completed checkpoint: `df4e8ad` Serialize Postgres commit timestamps.

What changed:

- Changed the Vite plugin so `createFlarexDevRuntime(...)` is imported lazily
  inside `configureServer(...)` instead of at plugin module load.
- This keeps `vite.config.ts` loading from eagerly importing local dev
  executor dependencies such as PGlite/Postgres when the app is doing a
  production worker build.

Why it changed:

The executor retry checkpoint added broader validation with `corepack pnpm
build`. That surfaced a local-dev plugin boundary issue: the example app build
only needs generation and worker bundling, but Vite config loading pulled in
the Node-local executor runtime and hit package-source ESM resolution for
`@flarex/persistence-postgres/pglite`.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - dev-only orchestration stays in the dev command path.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generation can run without starting the local backend runtime.

Flarex differences:

- Flarex currently exposes dev orchestration as a Vite plugin, so the module
  loaded by `vite.config.ts` must be careful about runtime-only imports.
- Convex has a CLI process boundary; Flarex's Vite plugin needs lazy imports to
  recreate that separation.

Known limitations:

- This does not change the local dev runtime itself. It only prevents
  production build config loading from pulling the local executor path.
- A later package boundary pass should make the local dev runtime split more
  explicit so config-time codegen and server-time orchestration are separate
  modules.

Verification:

```sh
corepack pnpm build
```

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
GET  /__flarex_dev/sync
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

- The local dev runtime uses Vite bundling on reload. It does not yet implement
  Convex's full module analysis pipeline or streamed logs.
- WebSocket upgrade handling is not implemented in the Vite middleware yet.
  Programmatic dev/runtime tests can use `createFlarexDevRuntime` and
  `flarex-test` WebSocket support today; Vite's HTTP middleware still needs
  explicit upgrade handling for browser dev servers.
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
  -> source package
  -> local start_push
  -> candidate Miniflare execution artifact
  -> authoritative candidate analysis
  -> final codegen from analysis response
  -> typecheck
  -> local finish_push
  -> active candidate serves invoke requests
```

Miniflare is the local implementation of the execution-artifact adapter. The
hosted implementation is the Flarex-managed Dynamic Worker runtime for the
uploaded `flarex/` source package. The push state machine, analysis contract,
final codegen input, and activation semantics must be shared.

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
move analysis into an execution-artifact adapter so local Miniflare and the
hosted Dynamic Worker runtime share the same analyzer boundary.

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

## Postgres Executor HTTP Local Runtime

Previous completed checkpoint: `3f441a8` Add local live query execution host.

What changed:

- Added `createLocalExecutorHttpRuntime(...)` in `flarex-dev`.
- This is a forward-path local runtime for the Postgres executor HTTP adapter,
  separate from the older Miniflare Durable Object dev backend.
- It wires live-query rerun maintenance to materialized user query execution:
  `/maintenance/live-queries/rerun` can now run stored query code locally and
  route its `ctx.db` reads through `/invoke/syscall`.

Why it changed:

The Vite/DO dev runtime is still useful for legacy examples, but the forward
architecture is the trusted Postgres executor plus managed source-package
execution. Local tests and future dev middleware need a reusable assembly point
for that path without booting Nitro or a hosted platform service.

Convex references:

- `npm-packages/convex/src/cli/lib/localDeployment/run.ts`
  - local dev runs a backend service and points SDK traffic at that local URL.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - local dev orchestrates codegen, push, backend state, and runtime behavior.
- `crates/sync/src/worker.rs`
  - live-query rerun behavior belongs to backend/sync orchestration.

Flarex differences:

- Convex's local backend is one binary. Flarex local forward path composes an
  executor core, HTTP adapter, and Miniflare source-package artifact.
- This helper does not replace the Vite plugin yet; it gives the Postgres
  executor path a testable local runtime first.

Known limitations:

- Vite middleware is not yet switched to this Postgres executor runtime.
- There is still no browser WebSocket dev route for the Postgres sync path.
- The helper requires local package metadata with module source text.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- executorHttpRuntime.test.ts
git diff --check
```

## PGlite Local Executor Runtime Test

Previous completed checkpoint: `3efd2a0` Wire local executor live query
reruns.

What changed:

- Added PGlite-backed coverage for `createLocalExecutorHttpRuntime(...)`.
- The test uses a real `FlarexExecutor`, real package registration/activation,
  real invoke-session writes, durable freshness projection, and the local HTTP
  maintenance route.

Why it changed:

The local Postgres executor runtime should be reusable for examples and future
dev tooling without starting Nitro or relying on fake callback behavior. This
test makes that local runtime concrete against the PGlite lane.

Convex references:

- `npm-packages/convex/src/cli/lib/localDeployment/run.ts`
  - local dev provides a real backend target.
- `crates/sync/src/worker.rs`
  - local backend behavior should still exercise live-query reruns.

Flarex differences:

- Convex local dev starts a local backend binary. Flarex composes executor core,
  PGlite persistence, an HTTP adapter, and a Miniflare source-package artifact.

Known limitations:

- This is test/runtime infrastructure only; the Vite plugin is not yet using
  this path.
- The test currently covers HTTP rerun behavior, not browser WebSocket sync.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- executorHttpRuntime.test.ts
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
hosted replacement should be a backend-owned Dynamic Worker analyzer service
for the uploaded source package.

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
should replace that analyzer with the Dynamic Worker analyzer service.

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
service, not the hosted Dynamic Worker analyzer service. It is the adapter
boundary for the hosted implementation.

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

## Analyzer Diagnostics Update

Previous completed checkpoint: `0a57edd` Analyze push source through backend
binding.

Local dev's analyzer service now preserves import-time diagnostics from the
execution artifact.

The local analyzer path is:

```txt
FLAREX_ANALYZER service binding
  -> LocalExecutionArtifactBackendAnalyzer
  -> LocalMiniflareExecutionArtifactAdapter.analyzeWithDiagnostics()
  -> { analysis, diagnostics } or { error, diagnostics }
```

The execution artifact installs a console capture wrapper before dynamically
importing the generated execution entrypoint and schema entrypoint. That makes
top-level developer module output available to the backend push response,
including failed analysis candidates.

Convex reference:

- `crates/isolate/src/environment/analyze.rs`
  - analysis captures import-time logs for push failure reporting with a
    100-entry bound.

Cloudflare difference: Flarex local dev captures logs in Miniflare by
dynamically importing the source package after installing the console wrapper.
Hosted Flarex must preserve the same contract inside the dynamic execution
isolate rather than in the Node-side dev package.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Hosted Store Format Update

Previous completed checkpoint: `bccc7cd` Add execution artifact store
boundary.

Local development still uses `LocalInMemoryExecutionArtifactStore`, but
`flarex-dev` now also defines the hosted object-store shape with
`R2ExecutionArtifactStore`.

The serialized hosted format is:

```txt
artifacts/{artifactId}/manifest.json
artifacts/{artifactId}/source-package.json
```

This lets local tests verify the hosted storage contract before local dev is
changed to use R2 persistence.

Convex reference:

- `crates/model/src/source_packages/mod.rs`
  - source packages are retrieved by durable package identity.

Cloudflare difference: local dev does not use this adapter by default yet; the
adapter is present for the upcoming hosted/runtime path and for contract tests.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Local Artifact Store Update

Previous completed checkpoint: `363d7e0` Add local execution artifact runtime
invoke.

Local dev now stores the bundled source package in a local
`ExecutionArtifactStore` before activating the push. During
`/__flarex_dev/invoke`, local dev resolves the active deployment and verifies
the active `executionArtifactRef` is present in the store before dispatching
to the generated internal invoke route.

This keeps the local path close to the hosted shape:

```txt
bundle flarex/ source package
  -> artifactStore.put(sourcePackage)
  -> finish_push activates executionArtifactRef
  -> dev invoke artifactStore.get(executionArtifactRef)
  -> LocalMiniflareExecutionArtifactRuntime.invoke
```

Convex reference:

- `crates/model/src/source_packages/mod.rs`
  - source packages are stored and retrieved through a model boundary, not
    passed around as ad hoc request state.

Cloudflare difference: the store is process-local memory for development. It
does not survive process restart and does not represent hosted R2/KV storage.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Local Invoke Runtime Adapter Update

Previous completed checkpoint: `d5e13dd` Store active execution artifact
reference.

Local dev invoke now uses the same shape as the intended hosted runtime:

```txt
/__flarex_dev/invoke
  -> backend /deployments/:deploymentId/deployment
  -> active executionArtifactRef
  -> LocalMiniflareExecutionArtifactRuntime.invoke(...)
  -> generated /__flarex_internal/invoke
  -> backend execution session syscalls
```

`/__flarex_dev/deployment` was added as a development inspection endpoint so
tests and tooling can see the active deployment record, including
`executionArtifactRef`.

The generated app Worker still supports `/invoke` for compatibility and direct
local forwarding, but the dev server's preferred invoke path now exercises the
execution artifact runtime adapter.

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - function execution goes through a backend-owned runner boundary with source
    package identity rather than directly exposing database state to user code.

Cloudflare difference: local dev uses a Miniflare app Worker as the execution
artifact. Hosted Flarex should replace only the runtime adapter with the
Flarex-managed Dynamic Worker runtime.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Stored Source Package Invoke Update

Previous completed checkpoint: `0447832` Add artifact runtime materializer
cache.

Added a local materializer that executes the stored source package itself,
rather than relying on a generated app Worker file as the invoke artifact.

For local proof, the materializer uses Miniflare:

```txt
source package from active deployment storage
  -> LocalMiniflareExecutionArtifactMaterializer
  -> internal runtime wrapper imports _flarex/execution.js
  -> function handler receives syscall-backed ctx.db
  -> backend execution session owns validation and commit
```

This keeps local development aligned with the hosted target: the source package
is the durable input, and the execution artifact is Flarex-managed.

Convex reference:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - local dev coordinates source push and backend execution instead of asking
    the application server to own database execution.
- `crates/application/src/application_function_runner/mod.rs`
  - runtime execution is reached through a backend-owned runner boundary.

Cloudflare difference: Miniflare is still the development implementation of
the execution-artifact loader. Hosted Flarex should replace this with the
Dynamic Worker runtime without changing the source-package push contract.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts
```

## Local Dev Backend Artifact Runtime Update

Previous completed checkpoint: `c8c16bb` Materialize stored source packages
locally.

Local dev now invokes through the same backend-owned hosted shape instead of
calling the generated app Worker as the normal execution artifact.

Current `/__flarex_dev/invoke` flow:

```txt
Vite /__flarex_dev/invoke
  -> backend /deployments/:deploymentId/invoke
  -> active deployment metadata
  -> backend R2 ARTIFACTS source package
  -> FLAREX_ARTIFACT_RUNTIME service binding
  -> LocalMiniflareExecutionArtifactMaterializer
  -> backend execution sessions and PartitionDO commit
```

The generated app Worker remains available for health checks, direct
compatibility routes, and future `/sync`, but it is no longer the normal local
dev invoke runtime.

Convex reference:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - local dev pushes source to a backend deployment boundary and then invokes
    against the local backend.
- `crates/application/src/application_function_runner/mod.rs`
  - execution resolves active deployment and package metadata before calling
    the executor.

Cloudflare difference: Flarex local dev uses Miniflare R2 plus a service
binding to emulate hosted artifact storage and the Dynamic Worker runtime. The
hosted runtime should replace the materializer implementation, not the public
dev/deploy contract.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- dev.test.ts
```

## Runtime-Store Dev Invoke Update

Previous completed checkpoint: `ef50030` Use artifact runtime for local dev
invoke.

Local dev now sets:

```txt
FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE=true
```

on the backend runtime and gives the local artifact runtime service a lazy R2
store backed by the same `ARTIFACTS` bucket. This means `/__flarex_dev/invoke`
does not move source-package JSON across the backend-to-runtime service call.
The runtime service loads the source package by `executionArtifactRef`.

Updated local path:

```txt
Vite /__flarex_dev/invoke
  -> backend /deployments/:deploymentId/invoke
  -> runtime service receives ref + request
  -> runtime service loads source package from ARTIFACTS
  -> LocalMiniflareExecutionArtifactMaterializer
```

Convex reference:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - dev uses the same backend deployment and execution loop as hosted
    semantics.
- `crates/model/src/source_packages/mod.rs`
  - source packages are retrieved through durable storage identity.

Cloudflare difference: the local store is Miniflare R2. The hosted store can
use the same service contract with platform R2 or another internal artifact
registry.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts dev.test.ts
```

## Local Dev Artifact Cleanup Update

Previous completed checkpoint: `e1ccf14` Let artifact runtime load source
packages.

Local dev now explicitly disposes the artifact runtime service before
disposing the backend Miniflare runtime. This gives cached materialized
artifacts a chance to dispose their nested Miniflare execution artifacts.

The local dev cleanup order is now:

```txt
wait for reload chain
  -> dispose generated app Worker
  -> dispose artifact runtime cached materializations
  -> dispose backend Worker/DO runtime
  -> remove temporary dev persistence when appropriate
```

Convex reference:

- `npm-packages/convex/src/cli/lib/localDeployment/run.ts`
  - local dev owns backend process lifecycle and cleanup.

Cloudflare difference: Flarex local dev owns multiple Miniflare runtimes
inside one process, including nested materialized execution artifacts. Hosted
Flarex should expose the same lifecycle at the Dynamic Worker runtime boundary.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- dev.test.ts runtimeMaterializer.test.ts
```

## Import-Phase Prelude Update

Previous completed checkpoint: `b3e17bb` Preserve analyzer diagnostics in push
state.

Local execution-artifact analysis now installs a Convex-inspired import-phase
prelude before dynamically importing developer modules.

The prelude provides deterministic local-dev analysis behavior for:

- `Date.now()`,
- zero-argument `new Date()`,
- `Math.random()`.

It rejects these import-time APIs with structured diagnostics:

- `fetch()`,
- `crypto.randomUUID()`,
- `crypto.getRandomValues()`,
- `performance.now()`.

Convex reference:

- `crates/isolate/src/environment/analyze.rs`
  - analysis uses a configured import timestamp and seeded RNG, while rejecting
    crypto randomness and Performance APIs during import.

Cloudflare difference: this is implemented as a generated Worker prelude in
local Miniflare analysis. Hosted analysis must enforce the same behavior in
the Flarex-managed Dynamic Worker runtime and verify that global patching is
portable across cold analysis isolates.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Architecture Terminology Cleanup

Previous completed checkpoint: `da42b4a` Add analysis import phase prelude.

Updated local-dev wording so the local Miniflare execution-artifact adapter is
described as the development implementation of the same source-package
analysis boundary used by the hosted Dynamic Worker runtime. Normalized the
deployment input term to `source package`.

Convex reference:

- `npm-packages/convex/src/cli/lib/components.ts`
  - local dev pushes backend modules and receives backend analysis; it does not
    bundle the developer's whole app into the backend runtime.

Verification:

```sh
git diff --check
```

## Cold-Isolate Consistency Update

Previous completed checkpoint: `d1b83a9` Clarify Dynamic Worker source package
architecture.

Local backend analysis now runs the same source package through the
execution-artifact adapter twice before returning metadata to `push/start`.
If the two analyses differ, local dev receives a failed analyzer response with:

```txt
Flarex analysis is nondeterministic across cold isolates.
```

Diagnostics from both runs are preserved so import-time logs remain visible.
This is a local-dev compatibility gate for the same stability guarantee the
hosted Dynamic Worker analyzer must eventually enforce.

Convex reference:

- `crates/isolate/src/environment/analyze.rs`
  - Convex controls import-time timestamp, RNG, unsupported APIs, syscalls, and
    logs inside `AnalyzeEnvironment`.

Cloudflare difference: Flarex uses a double-run local Miniflare gate while the
hosted Dynamic Worker runtime is still being proven.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Source Position Metadata Update

Previous completed checkpoint: `c471b67` Gate analysis on cold isolate
consistency.

Local analysis now includes best-effort source positions for analyzed
functions. The local execution-artifact analyzer embeds function module source
maps into its analysis wrapper and scans original `sourcesContent` for exported
registered function declarations.

The position metadata flows through local push responses and final codegen so
generated `functionMetadata.ts` can include:

```ts
position?: {
  path: string;
  startLine: number;
  startColumn: number;
};
```

Convex reference:

- `crates/isolate/src/environment/analyze.rs`
  - analysis maps function origins back through source maps.
- `crates/model/src/modules/module_versions.rs`
  - analyzed functions store optional source positions.

Cloudflare difference: this local slice uses source-map contents and source
text scanning. Hosted Dynamic Worker analysis should eventually resolve actual
handler origins when the runtime can expose enough origin information.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Local Sync Forwarding Update

Previous completed checkpoint: `be78189` Add Convex-style sync client slice.

`createFlarexDevRuntime` now handles:

```txt
GET /__flarex_dev/sync
  -> backend /deployments/:deploymentId/sync
  -> ConnectionDO
  -> active execution artifact
```

The sync route deliberately targets the backend deployment sync endpoint instead
of forwarding to the generated app Worker's compatibility `/sync` route. This
keeps local dev and tests on the same backend-owned path as hosted Flarex:
query-set state and mutation queues live in `ConnectionDO`, and function
execution resolves through the active backend deployment/artifact runtime.

Convex reference:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - local dev exposes a running backend URL used by clients.
- `crates/local_backend/src/subs/mod.rs`
  - WebSocket upgrades route into the backend sync socket worker.

Cloudflare difference: this route works inside the programmatic Miniflare dev
runtime and `flarex-test`. Vite middleware still needs explicit WebSocket
upgrade handling before a browser app can use `/__flarex_dev/sync` through the
Vite dev server itself.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter @flarex/example test
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

## Optional Partition Dev Invoke Forwarding

Previous completed checkpoint: `10c02a4` Run create-root execution sessions.

The local dev invoke proxy now forwards `partitionKey` only when the request or
`x-flarex-partition` header supplies one. This matches hosted behavior for
create-root functions: local dev must let the backend inspect active function
metadata before deciding whether a partition key is required.

Convex reference:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - local dev routes client calls to a backend-owned runtime.
- `crates/local_backend/src/lib.rs`
  - local backend execution uses the same semantic boundary as hosted
    execution.

Cloudflare difference: this is still a Vite/Miniflare proxy shape, but it now
preserves the important backend-owned root id preallocation boundary.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --maxWorkers=1
corepack pnpm --filter flarex-dev build
```
## Local PGlite Executor Runtime Trigger Wiring

Previous completed checkpoint: `730d284` Trigger live query invalidation after
commit.

What changed:

- Added `createLocalPGliteExecutorHttpRuntime(...)` in `flarex-dev`.
- The helper creates/migrates PGlite persistence, creates a durable
  Postgres/PGlite freshness mirror, constructs `createFlarexExecutor(...)` with
  `liveQueryInvalidation`, and injects the Cloudflare trigger notifier.
- Exported the helper from `flarex-dev`.
- Added a local runtime test that drives real executor HTTP routes:
  `/invoke/start`, `/invoke/syscall`, and `/invoke/finish`.
- The test proves a mutation commit updates freshness and posts
  `/scheduler/live-query-subscriptions/trigger` without manually calling the
  scheduler route.
- Moved `@flarex/freshness` and `@flarex/persistence-postgres` from
  `flarex-dev` dev dependencies to runtime dependencies because this helper is
  exported from `src`.

Why it changed:

The previous checkpoint added the post-commit hook but left host construction
manual. Local dev and tests need a reusable factory that wires the same pieces
the hosted executor will use: durable persistence, freshness store, and the
Cloudflare trigger notifier.

Convex references inspected:

- `crates/database/src/committer.rs`
  - commit publication is the only correct point to trigger invalidation.
- `crates/sync/src/worker.rs`
  - sync scheduling follows backend invalidation work.
- `crates/sync/src/state.rs`
  - clients see transitions after backend rerun/dedupe, not after raw writes.

Flarex differences:

- Convex dev runs against an integrated backend. Flarex local dev composes a
  PGlite-backed trusted executor with a Cloudflare-style backend trigger route.
- The helper is local/dev-oriented. Real hosted Nitro/Vercel deployment still
  needs production persistence and real backend URL configuration.

Known limitations:

- This helper proves trigger notification through executor HTTP finish, but it
  does not yet run a full app WebSocket mutation through Dynamic Worker user
  code into this hosted executor path.
- Trigger notification is still best-effort after commit; durable retry remains
  future work.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/executorHttpRuntime.test.ts
```

## Local Dev Postgres Executor Sync Path

Previous completed checkpoint: `09eb59c` feat: enhance live query subscription
handling and executor integration.

What changed:

- Recorded the new opt-in `createFlarexDevRuntime({ executorTransport:
  "postgres" })` path introduced in `09eb59c`.
- Local dev can now compose three runtimes: backend Miniflare, generated app
  Miniflare, and a PGlite-backed executor HTTP runtime.
- Reload registers and activates the pushed source package in the local
  executor so materialized Dynamic Worker code can run against
  `/invoke/start`, `/invoke/syscall`, and `/invoke/finish`.
- The dev test opens `/__flarex_dev/sync`, subscribes to a generated query,
  sends a generated mutation, and observes both the mutation response and the
  live-query transition without manually calling scheduler routes.

Why it changed:

The prior helper proved executor HTTP trigger wiring in isolation, but local
dev still needed the actual app/backend/executor composition that developers
will use. This moves the dev server closer to Convex's single local backend
mental model while preserving Flarex's split runtime.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - local dev routes client calls through backend-owned dev services.
- `crates/local_backend/src/lib.rs`
  - local backend execution uses the same semantic boundary as hosted
    execution.
- `crates/sync/src/worker.rs`
  - live query updates are backend-driven, not client-polled.

Flarex differences:

- Convex local dev runs in one integrated Rust backend. Flarex local dev
  composes Miniflare Workers/DOs with a local PGlite executor HTTP runtime.
- Developers still do not write Worker code or Wrangler config; this is an
  internal dev-runtime composition owned by Flarex tooling.

Known limitations:

- At this checkpoint the opt-in local Postgres path was tested through
  table-read freshness only. Index/range freshness was still a separate
  executor/freshness task.
- The test asserts Convex-style ordering: the mutation response arrives before
  the later live-query transition.

Verification:

```sh
pnpm --filter flarex-dev typecheck
pnpm --filter flarex-dev test -- dev.test.ts
```

## Local Dev Indexed Sync Update

Previous completed checkpoint: `ccc5dea` Harden executor sync integration.

What changed:

- Removed the temporary `lessons:allProgress` table-scan helper from the
  example app.
- Updated the local Postgres `/__flarex_dev/sync` integration to subscribe to
  the real generated `lessons:list` query, which uses
  `.withIndex("by_user", ...)`.
- Kept the same end-to-end proof: WebSocket subscribe, mutation through local
  Postgres executor transport, mutation response, and live-query transition.

Why it changed:

The table-scan helper was only a workaround while index/range freshness was
unsupported. Local dev should prove the normal Convex-style app path developers
will write, not a special test-only query.

Convex references inspected:

- `crates/sync/src/state.rs`
  - query subscriptions rerun after invalidation and dedupe unchanged results.
- `crates/database/src/query/index_range.rs`
  - indexed query execution records index intervals as read dependencies.

Flarex differences:

- Convex local dev runs through one integrated backend process. Flarex local
  dev composes the app worker, backend worker, and PGlite-backed executor HTTP
  runtime.
- The app developer still writes only `flarex/` modules; the generated
  Miniflare and executor composition remains tooling-owned.

Known limitations:

- The local sync test proves one indexed equality range. Compound ranges,
  pagination invalidation, and search/vector queries need separate coverage.
- Delivery still uses the current local trigger/fanout path, not a production
  queue or hosted DeliveryDO deployment.

Verification:

```sh
corepack pnpm --filter flarex-dev exec vitest run test/dev.test.ts --testTimeout=30000
```
