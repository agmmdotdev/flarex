# Shared Artifact Runtime Host Kit

## H-2 Shared Source Package Module-Map Validation

Completed checkpoint: `0a6cb36` (`Share artifact worker module validation`).

Previous completed checkpoint: `87b33a8` (`Mark shared runtime source profiles complete`).

What changed:

- Added `executionArtifactWorkerModules(...)` to
  `packages/flarex-backend/src/artifactRuntime/HostKit.ts`.
- Added shared host-kit errors for missing source modules, reserved runtime
  module paths, and duplicate source package module paths.
- Re-exported the shared module-map helper and errors from
  `flarex-backend/artifact-runtime`.
- Updated `packages/flarex-dev/src/runtimeMaterializer.ts` so local Miniflare
  modules are built from the shared module map.
- Updated `apps/artifact-runtime/src/worker.ts` so hosted Dynamic Worker
  modules are built from the same shared module map.
- Added direct HostKit validation tests and local materializer validation
  coverage.
- Built the shared module map from entries so special paths such as
  `__proto__` remain own enumerable module entries instead of mutating object
  prototype behavior.

Why it changed:

Local and hosted materialization should accept the same source package module
shape before diverging into Miniflare versus Dynamic Worker mechanics. This
slice moves the source-package module-map contract into the shared host kit
without moving host-specific loading, caching, bindings, or network isolation.

Cloudflare difference:

- Local runtime still converts the shared module map into Miniflare ES module
  entries.
- Hosted runtime still passes the shared module map to Worker Loader Dynamic
  Worker code.
- Hosted still owns Worker Loader cache identity and `globalOutbound: null`.

Known limitations:

- Generated worker env construction is still split between local and hosted
  adapters. That is the next checklist item, `H-3`.
- Internal invoke request and response decoding are still split. That remains
  `H-4`.
- Hosted-only Dynamic Worker ID assembly and auth/executor identity helpers
  remain in the hosted adapter until `H-5`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter @flarex/artifact-runtime typecheck
corepack pnpm --filter flarex-backend exec vitest run test/artifactRuntime.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter @flarex/artifact-runtime exec vitest run test/worker.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```

## H-1 Shared Runtime Worker Source Profiles

Completed checkpoint: `737fcab` (`Add shared runtime source profiles`).

Previous completed checkpoint: `93b408d` (`Add shared host kit goal checklist`).

What changed:

- Added `packages/flarex-backend/src/artifactRuntime/HostKit.ts`.
- Added `executionArtifactRuntimeWorkerSource(...)` with two explicit profiles:
  - local Miniflare execution artifact runtime;
  - hosted Dynamic Worker execution artifact runtime.
- Re-exported the host-kit profile helper from `flarex-backend/artifact-runtime`.
- Updated `packages/flarex-dev/src/runtimeMaterializer.ts` so its local
  generated runtime worker source comes from the host-kit local profile.
- Updated `apps/artifact-runtime/src/worker.ts` so its hosted Dynamic Worker
  runtime source comes from the host-kit hosted profile.
- Derived the private host-kit profile option type from
  `GeneratedExecutionWorkerSourceOptions` so the wrapper tracks the generator
  contract.

Why it changed:

This is the first implementation slice of the shared host-kit plan. It creates
the shared SDK surface for generated runtime worker source profiles without
changing Miniflare construction, Worker Loader behavior, source-package module
validation, env binding construction, request construction, or response
decoding.

Convex sources inspected:

- None in this implementation slice. The Convex runner/source-package
  rationale is recorded in the research checkpoint below; this slice only
  moves Flarex host-profile constants behind one helper.

Cloudflare difference:

- Local runtime still uses Miniflare.
- Hosted runtime still uses Worker Loader and Dynamic Workers.
- The shared helper does not hide hosted `globalOutbound: null` or Worker
  Loader cache identity; those remain hosted-adapter responsibilities for later
  checklist items.

Known limitations:

- Source package module-map validation is still split between local and hosted
  adapters. That is the next checklist item, `H-2`.
- Generated worker env construction is still split between local and hosted
  adapters. That remains `H-3`.
- Internal invoke request and response decoding are still split. That remains
  `H-4`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev build
corepack pnpm --filter @flarex/artifact-runtime test
corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```

## Research And Implementation Plan

Previous completed checkpoint: `d576f98` (`Extract generated executor protocol fragments`).

What changed:

- Added this concrete roadmap for replacing the current dev/prod materializer
  split with a shared artifact runtime host kit.
- Audited the current local-dev and hosted artifact-runtime paths:
  - `packages/flarex-dev/src/runtimeMaterializer.ts`
  - `packages/flarex-dev/src/dev.ts`
  - `apps/artifact-runtime/src/worker.ts`
  - `packages/flarex-backend/src/artifactRuntime.ts`
  - `packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts`
  - `packages/flarex-backend/src/worker.ts`
  - `packages/flarex-backend/src/connectionDO.ts`
- Verified current Cloudflare Dynamic Workers constraints:
  - Worker Loader binding is required to create Dynamic Workers.
  - `load(code)` creates one-time workers and `get(id, callback)` reuses a
    cached worker by ID.
  - Dynamic Worker code is composed from `mainModule`, `modules`, `env`, and
    `globalOutbound`.
  - Dynamic Worker `env` is explicitly provided by the parent Worker and may
    contain service bindings/custom bindings.
  - `globalOutbound: null` is the right hosted default for blocking ambient
    network access from user code.

Current diagnosis:

We do not have one standard dev/prod runtime host SDK yet.

What is already shared:

- `createExecutionArtifactRuntimeService(...)` owns the backend artifact
  runtime route service and cache.
- `ServiceBindingExecutionArtifactRuntime` owns backend-to-artifact-runtime
  invocation.
- `generatedExecutionWorkerSource(...)` emits the internal execution Worker
  used by both local Miniflare materialization and hosted Dynamic Workers.
- `generatedProjectWorkerExecutorBridgeSource(...)` emits the typed generated
  project worker bridge.
- `GeneratedWorkerSource.ts` now centralizes executor protocol fragments,
  retry constants, backend error classes, syscall plumbing, and start response
  guards for generated workers.

What is still split:

- Dev owns `LocalMiniflareExecutionArtifactMaterializer`.
- Hosted runtime owns `HostedDynamicWorkerExecutionArtifactMaterializer`.
- Both paths separately know how to:
  - turn a `PushSourcePackage` into a runtime module map,
  - reject missing source modules,
  - reject duplicate module paths,
  - reserve the generated runtime entrypoint path,
  - build generated worker env bindings,
  - construct internal invoke requests,
  - add internal authorization headers,
  - decode materialized artifact responses,
  - normalize executor transport/project/auth/invoke-attempt configuration.
- Hosted additionally owns Worker Loader cache identity, Worker Loader
  binding checks, and `globalOutbound: null`.
- Dev additionally owns Miniflare module objects, local backend dispatch,
  optional local PGlite executor wiring, and the local-only
  `/__flarex_internal/query-session` route.

Convex sources inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - Convex keeps function execution backend-owned and routes user functions
    through a central runner with deployment/module metadata.
- `crates/model/src/source_packages/mod.rs`
  - Convex persists source package metadata as backend-owned state.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - Convex separates source upload/analysis inputs from activation responses.

Cloudflare difference:

Convex can keep source package storage, execution isolation, and backend runner
coordination behind one hosted backend. Flarex cannot use one concrete runtime
host implementation because Cloudflare dev and production hosts are different:

- local dev/test uses Miniflare and in-process service bindings;
- production uses Worker Loader and Dynamic Workers;
- the hosted path must preserve Worker Loader cache identity and
  `globalOutbound: null`;
- generated user code must only see narrow executor/internal bindings.

So the right abstraction is not "one materializer class for dev and prod." The
right abstraction is a shared host kit plus thin host adapters.

## Target Boundary

Initial home:

- `packages/flarex-backend/src/artifactRuntime/HostKit.ts`
- exported from `flarex-backend/artifact-runtime`

Why this package:

- `flarex-dev` already depends on `flarex-backend/artifact-runtime`.
- `apps/artifact-runtime` already imports hosted runtime primitives from the
  same package.
- The kit needs backend runtime types such as `PushSourcePackage`,
  `MaterializedExecutionArtifactPayload`, `InvokeResponse`, and `Json`.
- `flarex-protocol` should stay focused on stable wire schemas, not runtime
  host composition.

Future package split:

- Only split this into a separate package if non-backend consumers need it.
  Until then, keeping it inside `flarex-backend/artifact-runtime` avoids a
  premature package boundary.

## Proposed Shared Kit API

The names below are implementation targets, not final public API promises.

```ts
export type ExecutionArtifactHostMode = "local-miniflare" | "hosted-dynamic-worker";

export type ExecutionArtifactWorkerRuntimeOptions = {
  readonly mode: ExecutionArtifactHostMode;
  readonly executionModule: string;
  readonly backendBinding: string;
  readonly backendBaseUrl: string;
  readonly missingBackendBindingMessage: string;
  readonly includeQuerySessionRoute?: boolean;
  readonly includeUnsupportedCapabilities?: boolean;
};

export type ExecutionArtifactExecutorConfig = {
  readonly executorTransport?: "legacy" | "postgres";
  readonly projectId?: string;
  readonly executorToken?: string;
  readonly executorTokenVersion?: string;
  readonly invokeMaxAttempts?: string;
  readonly internalToken?: string;
  readonly internalTokenVersion?: string;
};

export type ExecutionArtifactModuleMap = {
  readonly mainModule: string;
  readonly modules: Readonly<Record<string, string>>;
};
```

Shared helpers:

- `executionArtifactRuntimeWorkerSource(options)`
  - wraps `generatedExecutionWorkerSource(...)` with named local/hosted
    profiles.
- `executionArtifactWorkerModules(sourcePackage, options)`
  - builds the generated runtime entrypoint plus source package modules.
  - rejects missing source, duplicate module paths, and reserved main module
    paths.
- `executionArtifactWorkerEnv(options)`
  - builds the generated worker env object for local and hosted adapters.
  - keeps binding names configurable (`FLAREX_BACKEND` locally,
    `FLAREX_EXECUTOR` hosted).
- `executionArtifactInternalRequest(payload, options)`
  - constructs the internal invoke `Request` once for both adapters.
- `executionArtifactInternalHeaders(payload, internalToken)`
  - owns `x-flarex-artifact-id`, `x-flarex-source-package-hash`, and optional
    internal authorization.
- `decodeExecutionArtifactInvokeResponse(response, fallbackMessage)`
  - reuses `decodeServiceBindingExecutionArtifactRuntimeInvokeResponse(...)`.
- `decodeExecutionArtifactJsonResponse(response, fallbackMessage)`
  - shared non-invoke JSON response decode for query-session/local paths.
- `executorIdentity(config)` and `internalAuthIdentity(config)`
  - shared string identity helpers for Worker Loader cache keys and tests.

Host adapters that remain separate:

- `LocalMiniflareExecutionArtifactMaterializer`
  - owns Miniflare construction, module-array conversion, local service binding
    dispatch, and local query-session support.
- `HostedDynamicWorkerExecutionArtifactMaterializer`
  - owns `LOADER.get(...)`, Worker Loader cache IDs, Worker Loader binding
    errors, and `globalOutbound: null`.

## Concrete Implementation Checklist

- [ ] H-1. Shared runtime worker source profiles
  - Add `HostKit.ts`.
  - Move `runtimeWorkerSource(...)` and `dynamicWorkerRuntimeSource(...)` into
    `executionArtifactRuntimeWorkerSource(...)`.
  - Keep profile options explicit:
    - local: `FLAREX_BACKEND`, `https://flarex-backend.internal`,
      `includeQuerySessionRoute: true`;
    - hosted: `FLAREX_EXECUTOR`, `https://flarex-executor.internal`,
      `includeUnsupportedCapabilities: true`.
  - Validation:
    - `corepack pnpm --filter flarex-backend typecheck`
    - `corepack pnpm --filter flarex-dev typecheck`
    - `corepack pnpm --filter @flarex/artifact-runtime test`
    - `corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1`

- [ ] H-2. Shared source package module-map validation
  - Move duplicate source-module validation into
    `executionArtifactWorkerModules(...)`.
  - Return `Record<string, string>` plus `mainModule` for Worker Loader.
  - Add a small local adapter helper to convert module records into Miniflare
    module objects without duplicating validation.
  - Preserve hosted errors or introduce shared errors with hosted/local
    adapters mapping them to their current messages.
  - Validation:
    - existing hosted Worker Loader module-shape tests;
    - local runtime materializer missing-source tests;
    - `git diff --check`.

- [ ] H-3. Shared generated-worker env construction
  - Move executor transport/project/token/invoke-attempt/internal-token env
    construction into `executionArtifactWorkerEnv(...)`.
  - Keep binding object injection host-specific:
    - local passes `FLAREX_BACKEND: Fetcher`;
    - hosted passes `FLAREX_EXECUTOR: Fetcher`.
  - Normalize `invokeMaxAttempts` to string at the boundary.
  - Keep hosted `parseHostedExecutorTransport(...)` error behavior for invalid
    configured transport.
  - Validation:
    - hosted env/cache identity tests;
    - local executor transport tests.

- [ ] H-4. Shared internal invoke request and response decode
  - Move internal request construction from
    `LocalMiniflareMaterializedExecutionArtifact.invoke(...)` and
    `HostedDynamicWorkerMaterializedExecutionArtifact.invoke(...)` into a
    shared helper.
  - Move response decoding into shared `decodeExecutionArtifactInvokeResponse`.
  - Keep local query-session decoding as a shared generic JSON decode helper,
    but keep query-session support local-only until hosted has an explicit
    feature decision.
  - Validation:
    - `packages/flarex-backend/test/artifactRuntime.test.ts`
    - `packages/flarex-dev/test/runtimeMaterializer.test.ts`
    - `apps/artifact-runtime/test/worker.test.ts`

- [ ] H-5. Shared identity helpers
  - Move `executorIdentity(...)` and `internalAuthIdentity(...)` into the host
    kit.
  - Use them from hosted Worker Loader cache ID construction.
  - Add direct unit tests for identity stability.
  - Keep the final Dynamic Worker ID construction hosted-only because it is a
    Worker Loader concern.

- [ ] H-6. Adapter simplification pass
  - Reduce `packages/flarex-dev/src/runtimeMaterializer.ts` to:
    - Miniflare construction;
    - local backend service binding;
    - local query-session dispatch;
    - disposal.
  - Reduce `apps/artifact-runtime/src/worker.ts` to:
    - env validation;
    - Worker Loader `get(...)`;
    - Dynamic Worker dispatch;
    - hosted fail-closed errors.
  - Do not change public behavior in this slice.
  - Validation:
    - `corepack pnpm --filter flarex-backend typecheck`
    - `corepack pnpm --filter flarex-backend build`
    - `corepack pnpm --filter flarex-dev typecheck`
    - `corepack pnpm --filter flarex-dev build`
    - `corepack pnpm --filter @flarex/artifact-runtime test`
    - `corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1`
    - `git diff --check`

## Things Not To Do

- Do not move Worker Loader-specific behavior into `flarex-dev`.
- Do not move Miniflare construction into `apps/artifact-runtime`.
- Do not put host composition helpers in `flarex-protocol`; this is not a
  stable wire schema boundary.
- Do not hide `globalOutbound: null` behind a default that hosted callers can
  accidentally skip.
- Do not give user Dynamic Worker code raw storage or database bindings. The
  generated worker should keep using the narrow executor syscall API.
- Do not make hosted query-session support appear complete until the product
  decision is explicit and tested.

## Open Decisions

- Should shared host-kit errors be new backend errors, or should adapters map
  shared error objects back to existing hosted/local error classes?
  - Preferred first slice: shared errors for internal helpers, adapter mapping
    where existing tests assert hosted error names/messages.
- Should local query-session remain a profile option or be a separate local
  adapter feature?
  - Preferred first slice: profile option in the shared source builder, but
    execution host method remains local-only.
- Should Worker Loader `tails` be reserved in the shared kit now?
  - Preferred first slice: no. Leave tail-worker observability for a later
    hosted-runtime observability checkpoint.

## Expected End State

```txt
packages/flarex-backend/artifact-runtime
  createExecutionArtifactRuntimeService
  ServiceBindingExecutionArtifactRuntime
  GeneratedWorkerSource
  HostKit
    source profile
    module map validation
    env construction
    internal invoke request
    response decode
    identity helpers

packages/flarex-dev
  LocalMiniflareExecutionArtifactMaterializer
    Miniflare adapter only

apps/artifact-runtime
  HostedDynamicWorkerExecutionArtifactMaterializer
    Worker Loader adapter only
```

Success criteria:

- Local and hosted execution artifact materializers use the same source package
  module validation.
- Local and hosted internal invoke requests are constructed by the same helper.
- Local and hosted invoke response decoding uses the same schema boundary.
- Executor env construction and identity strings have direct unit coverage.
- Hosted still fails closed when `LOADER`, `FLAREX_EXECUTOR`, or capability
  token bindings are missing.
- Local dev still supports query-session execution for live-query tests.
- Existing generated execution behavior remains unchanged.

## Sources Verified

- Cloudflare Dynamic Workers overview/getting started:
  `https://developers.cloudflare.com/dynamic-workers/getting-started/`
- Cloudflare Dynamic Workers API reference:
  `https://developers.cloudflare.com/dynamic-workers/api-reference/`
- Cloudflare Dynamic Workers bindings and capability model:
  `https://developers.cloudflare.com/dynamic-workers/usage/bindings/`

Verification for this planning checkpoint:

```sh
git diff --check
```
