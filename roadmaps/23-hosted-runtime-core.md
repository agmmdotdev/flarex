# Hosted Runtime Core

## Dynamic Worker Loader Materializer

Previous completed checkpoint: `2ad4d47` (`Add hosted artifact runtime wrapper`).

What changed:

- Replaced the artifact-runtime deployable placeholder with a default
  `HostedDynamicWorkerExecutionArtifactMaterializer`.
- Added the `LOADER` Worker Loader binding to
  `apps/artifact-runtime/wrangler.jsonc`.
- The default materializer now:
  - loads source packages from `ARTIFACTS` as before,
  - builds a Worker Loader module map from the stored source package,
  - rejects duplicate source module paths and the reserved
    `flarex-runtime-worker.js` entrypoint path before the loader runs,
  - uses `LOADER.get(...)` with artifact ID, source package hash,
    compatibility date, and internal-auth identity so Cloudflare can reuse warm
    Dynamic Workers only when the loaded code/env identity still matches,
  - sets `globalOutbound: null` to block ambient network access,
  - optionally passes `FLAREX_INTERNAL_TOKEN` into the generated Dynamic Worker
    wrapper and uses it for host-to-Dynamic-Worker internal calls,
  - supports `FLAREX_INTERNAL_TOKEN_VERSION` as the non-secret cache identity
    to bump when rotating `FLAREX_INTERNAL_TOKEN`,
  - invokes the generated Dynamic Worker entrypoint through
    `/__flarex_internal/invoke`,
  - decodes successful Dynamic Worker JSON through the existing
    `InvokeResponseSchema` boundary instead of trusting arbitrary 200 JSON.
- Added app-local coverage for:
  - default Worker Loader materialization from a ref-only runtime request,
  - generated module map shape, cache ID, internal token env, and
    `globalOutbound: null`,
  - cache ID variation across compatibility date and internal auth version,
  - fail-closed behavior when `LOADER` is missing,
  - invalid successful Dynamic Worker JSON failing at the schema boundary,
  - source-package modules without source text, reserved paths, and duplicate
    paths failing before the loader runs.

Cloudflare references verified:

- Dynamic Workers overview:
  `https://developers.cloudflare.com/dynamic-workers/`
- Worker Loader binding and `LOADER.get(...)`/`LOADER.load(...)`:
  `https://developers.cloudflare.com/dynamic-workers/getting-started/`
- Capability bindings and custom binding model:
  `https://developers.cloudflare.com/dynamic-workers/usage/bindings/`
- Egress control and `globalOutbound: null`:
  `https://developers.cloudflare.com/dynamic-workers/usage/egress-control/`
- Worker Loader API reference:
  `https://developers.cloudflare.com/dynamic-workers/api-reference/`

Known limitations:

- The generated Dynamic Worker wrapper can resolve and invoke loaded
  query/mutation handlers, but its `ctx.db`, `ctx.runQuery`, and
  `ctx.runMutation` capabilities intentionally fail with a clear
  not-implemented error. The generated context also stubs `ctx.auth`,
  `ctx.scheduler`, and `ctx.storage` to the same explicit limitation. The next
  core slice should move the mature Postgres/syscall bridge from the local
  Miniflare materializer into this generated Dynamic Worker wrapper.
- The artifact-runtime app still does not declare a `FLAREX_EXECUTOR` service
  binding. That should land with the db/syscall bridge so the Dynamic Worker
  receives only the narrow executor capability it needs.
- This checkpoint proves Worker Loader composition through local fakes and
  Wrangler dry-run. It does not execute Cloudflare's production Worker Loader
  inside Vitest.

Verification:

```sh
corepack pnpm --filter @flarex/artifact-runtime test
corepack pnpm --filter @flarex/artifact-runtime typecheck
corepack pnpm --filter @flarex/artifact-runtime build
corepack pnpm --filter @flarex/artifact-runtime deploy:dry-run
git diff --check
```

## Artifact Runtime Wrapper

Previous completed checkpoint: `3d0a85b` (`Wire hosted runtime core bindings`).

What changed:

- Added `apps/artifact-runtime` as the deployable Worker wrapper for the
  artifact runtime service binding target.
- Declared the production binding shape in `apps/artifact-runtime/wrangler.jsonc`:
  - `ARTIFACTS` R2 bucket for durable execution source packages.
  - `FLAREX_ARTIFACT_RUNTIME_TOKEN` as a Wrangler secret, not checked-in vars.
- Wired the wrapper to `createExecutionArtifactRuntimeService(...)` with
  `R2BackendExecutionArtifactStore`, so backend ref-only invokes can be resolved
  inside the artifact runtime Worker.
- Kept materialization injected behind `ExecutionArtifactMaterializer`; the
  follow-up checkpoint replaced the default placeholder with the Worker
  Loader-backed materializer above.
- Added app-local coverage proving:
  - service-binding auth is enforced at the wrapper edge,
  - missing `FLAREX_ARTIFACT_RUNTIME_TOKEN` fails closed instead of disabling
    auth,
  - a ref-only invoke loads its source package from R2 before materialization,
  - repeated invokes in one Worker env reuse the runtime service/materializer
    cache,
  - the deployable default fails explicitly instead of pretending Dynamic Worker
    materialization exists.

Why it changed:

The backend wrapper already sends ref-only payloads when
`FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE=true`. This checkpoint gives that service
binding a real deployable Worker shape with the same R2 bucket and token
contract, while keeping the still-missing Dynamic Worker loader isolated behind
one materializer port.

Known limitations:

- The artifact runtime wrapper is deployable-shaped and R2-backed. The
  follow-up Worker Loader checkpoint above now supplies the default
  Dynamic Worker-backed `ExecutionArtifactMaterializer`.
- The wrapper currently caches runtime services per Worker env object. That
  preserves artifact cache reuse in one isolate; production cache lifecycle
  tuning belongs with the real materializer.
- Analyzer and executor deployable apps still need their own wrappers.

Verification:

```sh
corepack pnpm --filter @flarex/artifact-runtime test
corepack pnpm --filter @flarex/artifact-runtime typecheck
corepack pnpm --filter @flarex/artifact-runtime build
corepack pnpm --filter @flarex/artifact-runtime deploy:dry-run
git diff --check
```

## Backend Wrapper Binding Shape

Previous completed checkpoint: none.

What changed:

- Added the first hosted runtime core roadmap after the Effect migration exit.
- Wired the deployable backend wrapper with the binding shape that
  `flarex-backend` already consumes:
  - `ARTIFACTS` R2 bucket for execution artifact source packages.
  - `FLAREX_ANALYZER` service binding for backend-controlled source analysis.
  - `FLAREX_EXECUTOR` service binding for the trusted Postgres executor.
  - `FLAREX_ARTIFACT_RUNTIME` service binding for managed execution artifact
    invocation.
  - `FLAREX_PROJECT_ID` as the initial single-project executor default.
  - `FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE=true`, so runtime invokes carry the
    artifact reference and the runtime service is responsible for loading the
    source package from durable artifact storage.
- Added hosted-shaped backend integration coverage for source-only push through
  analyzer service binding, automatic R2 artifact persistence, finish
  activation, and public invoke through the artifact runtime service binding
  with a ref-only payload.

Why it changed:

The Effect migration is complete, but the core production platform is not. The
next runtime blocker is no longer typed route boundaries; it is proving that
the deployable backend shape can connect the analyzer, durable artifact store,
artifact runtime, and executor-facing hosted bindings. This checkpoint turns
the existing package-level optional bindings into an explicit app wrapper
contract and verifies the end-to-end hosted-shaped path with fake local
bindings.

Convex sources inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - backend-owned function execution resolves deployment/package metadata
    before invoking user code.
- `crates/model/src/source_packages/mod.rs`
  - source package metadata is durable deployment state.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - deployment push separates source upload/analysis from final activation.

Cloudflare difference:

Convex can run analysis, source package storage, function execution, and
transaction coordination inside one hosted backend. Flarex has to split those
responsibilities across Cloudflare Workers bindings:

```txt
public backend Worker
  -> analyzer service binding
  -> R2 artifact store
  -> artifact runtime service binding loads artifact by ref
  -> trusted executor service binding
```

The test uses Miniflare fake bindings, but the app wrapper now declares the
same production binding names.

Known limitations:

- The service targets in `apps/backend/wrangler.jsonc` are the intended worker
  names; the analyzer, executor, and artifact-runtime deployable apps still
  need their own wrappers.
- `FLAREX_PROJECT_ID` is a single-project default. A hosted multi-tenant
  control plane still needs explicit project routing and ownership checks.
- The backend wrapper and artifact runtime wrapper must agree on artifact store
  access. This checkpoint configures the backend to send ref-only runtime
  payloads; the artifact runtime deployable wrapper still needs its own R2
  binding before that shape is production-complete.
- Capability tokens are intentionally not stored in `wrangler.jsonc`; configure
  `FLAREX_EXECUTOR_TOKEN` and `FLAREX_ARTIFACT_RUNTIME_TOKEN` as Wrangler
  secrets when enabling protected downstream services.
- This checkpoint proves hosted-shaped binding flow, not real Cloudflare
  Dynamic Worker upload/loading.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/hostedRuntimeCore.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```
