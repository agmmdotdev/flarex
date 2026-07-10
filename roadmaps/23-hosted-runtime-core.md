# Hosted Runtime Core

## Add The Private Executor Worker Boundary

Previous completed checkpoint: `402eef7` (`Add Worker-safe Postgres client
persistence`).

What changed:

- Added the Fetch-only `apps/executor` Worker named `flarex-executor`. Its
  Wrangler configuration enables `nodejs_compat` and smart placement, disables
  workers.dev and preview URLs, declares no route, and binds
  `HYPERDRIVE_CACHE_DISABLED` without placing the executor capability in
  plaintext vars.
- Added a request-lifecycle boundary that requires a non-empty
  `FLAREX_EXECUTOR_TOKEN`, validates the exact bearer capability before
  inspecting Hyperdrive or allocating a client, then creates and connects one
  client for that Fetch and always attempts `end()` in `finally`.
- Preserved the primary connect/handler error when cleanup also fails. A
  resolved non-2xx protocol response is also primary and remains authoritative
  if cleanup fails. A cleanup-only failure remains visible, while synchronous
  or asynchronous cleanup reporting is awaited best-effort and cannot mask the
  primary outcome.
- Composed the production request handler from `pg.Client`, H02's
  `/postgres-client` persistence and shared-authority factories,
  `withReadyDeploymentAuthority`, the framework-neutral executor, and the
  existing Web Fetch adapter. The inner HTTP adapter retains its own bearer
  check as defense in depth.
- Added 34 strict lifecycle, adversarial bundle-gate, production-wrapper, and
  Wrangler-policy tests. The
  emitted Wrangler metafile contains 717 inputs and proves the real graph has
  the executor, Fetch adapter, connected-client persistence, and node-postgres
  while excluding PGlite, ElectricSQL, Drizzle migrators, the pooled
  `postgres.ts` adapter, and its persistence-owned filesystem helpers.

Why it changed:

H02 supplied a Worker-safe database seam but no production host. H03 makes the
dedicated private Worker and its exact import graph real before the local
multi-Worker/PostgreSQL proof, without changing executor or FlarexDB semantics.

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
- `crates/function_runner/src/lib.rs`
- `crates/isolate/src/environment/udf/syscall.rs`

How Flarex differs:

- Convex's application runner passes the isolate's final reads and writes back
  into its owned transaction directly. Flarex keeps the same trusted
  executor/transaction ownership but reaches that executor through a private
  Fetch service because user functions run in a separate Dynamic Worker.
- The Cloudflare host owns only capability checks, per-request connection
  lifecycle, and dependency composition. It does not reinterpret syscalls or
  move commit logic into the Worker adapter.

Known limitations:

- The Hyperdrive ID is an explicit dry-run placeholder. Its binding name says
  what H05 must provision; it is not evidence that a deployed Hyperdrive has
  caching disabled.
- H03 proves configuration, lifecycle, and the emitted import graph. H04 must
  run this emitted Worker behind a real named workerd service binding against
  PostgreSQL, and H05 must capture the hosted activation receipt.
- The shared physical locator remains `primary/public` for this proof. H04 can
  isolate it with a disposable database; split-locator runtime routing remains
  outside this goal.
- Runtime generation routing, sequence allocation, new OCC, commit compiler,
  sync, Payload, Medusa, adapter retirement, and Workers RPC remain excluded.
- The workspace build passed H03 and every library, then retained the existing
  example-app failure resolving extensionless `../http` from
  `packages/flarex-backend/src/artifactRuntime/RouteBoundary.ts`.
- The workspace test passed its script, protocol, SDK, analysis, persistence,
  and freshness lanes, then reproduced the existing three untouched
  `flarex-backend` delivery-decoder expectation failures: decoded values now
  include `identityFingerprint`, while the older expected shapes do not.

Verification:

```sh
corepack pnpm --filter @flarex/executor-worker typecheck
corepack pnpm --filter @flarex/executor-worker test
corepack pnpm --filter @flarex/executor-worker check:bundle
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http test
corepack pnpm typecheck
corepack pnpm check:effect-boundaries
corepack pnpm build # existing example-app extensionless-import failure
corepack pnpm test # existing three-test identityFingerprint expectation drift
git diff --check
```

## Complete The H02 Persistence Boundary

Previous completed checkpoint: `3155884` (`Define hosted executor proof
gates`).

What changed:

- Completed H02 by adding the Worker-safe connected-`pg.Client` persistence
  subpath and retaining Pool/migration/PGlite ownership outside it.
- Kept connection creation and cleanup out of persistence. H03's Fetch handler
  must validate its capability token first, create and connect exactly one
  client from `HYPERDRIVE_CACHE_DISABLED.connectionString`, inject this
  adapter, and attempt `client.end()` in `finally`.
- Made a client-taking shared-scope authority helper available without
  importing the Node `/postgres` entrypoint or exposing Drizzle/`$client`, so
  H03 can compose `withReadyDeploymentAuthority(...)` from the safe graph.
- Proved the client adapter against PostgreSQL 18 without introducing the
  deployable Worker, runtime generation routing, or new FlarexDB behavior.

Why it changed:

H03 cannot honestly prove its Worker bundle while the only concrete Postgres
composition imports filesystem migrations and `pg.Pool`. H02 removes that
dependency edge first and leaves Worker hosting as the next independent turn.

Convex references inspected:

- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`
- `crates/isolate/src/environment/udf/syscall.rs`

How Flarex differs:

- Convex owns the function runner and database runtime in one backend process.
  Flarex still keeps the trusted executor and persistence in-process with each
  other, but Cloudflare invocation lifecycle belongs to a thin Worker adapter.

Known limitations:

- `apps/executor` still does not exist. H03 remains the next checkpoint.
- H02 does not prove `nodejs_compat`, a Wrangler bundle, private reachability,
  capability rejection, Hyperdrive configuration, or per-Fetch cleanup.
- H04 and H05 remain required before S02-D; no status beyond H02 is implied.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/persistence-postgres test:postgres
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm typecheck
corepack pnpm check:effect-boundaries
git diff --check
```

## Freeze The Hosted Executor Proof Gate

Previous completed checkpoint: `0f4874d` (`Complete split scope authority
reconciliation`).

What changed:

- Split the prerequisite before S02-D into five checkpoint-sized turns:
  - H01 freezes this proof contract;
  - H02 adds the Worker-safe request-scoped Postgres persistence seam;
  - H03 adds the private executor Worker and bundle/import-graph gate;
  - H04 proves a named local service binding against real PostgreSQL;
  - H05 records the hosted cache-disabled Hyperdrive activation receipt.
- Fixed the host contract as a Fetch-only `apps/executor` Worker named
  `flarex-executor` with `nodejs_compat`, `placement.mode = "smart"`, no routes,
  `workers_dev = false`, preview URLs disabled, and a mandatory
  `FLAREX_EXECUTOR_TOKEN`. Only a caller holding the `FLAREX_EXECUTOR` service
  binding and matching bearer capability may invoke `/invoke/*`.
- Fixed the database lifecycle as one `pg.Client` created inside each Fetch
  invocation from `HYPERDRIVE_CACHE_DISABLED.connectionString`, with no
  module-scope client or `pg.Pool`. Flarex keeps a best-effort explicit
  `client.end()` in `finally` for deterministic direct-Postgres test cleanup,
  even though Cloudflare now documents invocation cleanup as automatic.
- Separated local proof from hosted proof. A Wrangler dry-run/metafile and a
  named multi-Worker workerd test may prove bundle safety, real SQL, service
  dispatch, OCC behavior, and Flarex-owned cleanup. A local Hyperdrive
  `localConnectionString` connects directly to PostgreSQL and therefore cannot
  prove Hyperdrive pooling or cache configuration.
- Made H05 the production-activation receipt: capture the deployed Hyperdrive
  configuration created or updated with `--caching-disabled`, deploy the
  executor before its caller, invoke the executor only through the caller's
  service binding, and verify the committed PostgreSQL result plus the stale
  attempt/conflict/fresh-attempt convergence case. S02-D remains blocked until
  that receipt exists.

Why it changed:

The earlier roadmap named a Worker/Hyperdrive spike but did not define which
evidence was local, which evidence required Cloudflare, or how small each turn
should be. Without those boundaries, a local direct-Postgres smoke could be
misreported as hosted Hyperdrive proof or the prerequisite could expand into
S02-D and the FlarexDB redesign itself.

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
- `crates/function_runner/src/lib.rs`
- `crates/isolate/src/environment/udf/syscall.rs`

Cloudflare references inspected:

- [Connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/)
- [Postgres drivers and Hyperdrive](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/)
- [Local Hyperdrive development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/)
- [Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)
- [Workers service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Workers placement](https://developers.cloudflare.com/workers/configuration/placement/)

How Flarex differs:

- Convex returns a final transaction/read set from its owned function runner
  and mediates syscalls inside its hosted backend. Flarex preserves that
  trusted execution/commit boundary across a Dynamic Worker and a private
  service-bound executor Worker.
- Cloudflare automatically tears down invocation-scoped Hyperdrive clients.
  Flarex additionally attempts explicit client cleanup because the same host
  seam is exercised with a direct PostgreSQL connection locally.

Known limitations:

- H01 changes no runtime code and proves no Worker bundle or database behavior.
- H04 is not evidence that Hyperdrive caching is disabled: local Hyperdrive
  bindings bypass Hyperdrive. Only H05 may close that hosted claim.
- The H04 OCC case reuses the current legacy-generation behavior: two sessions
  observe the same row, one commits, the stale finish conflicts, and a fresh
  attempt rereads and converges. It does not add the future FlarexDB OCC model.
- Runtime generation routing, sequence allocation, new OCC, commit compiler,
  sync, Payload, Medusa, compatibility-adapter retirement, and Workers RPC are
  excluded from H01 through H05.

Verification:

```sh
rg -n "FunctionRunner|Transaction|syscall|run_function|execute" ../../crates/application/src/application_function_runner/mod.rs ../../crates/function_runner/src/lib.rs ../../crates/isolate/src/environment/udf/syscall.rs
corepack pnpm --filter @flarex/backend exec wrangler hyperdrive get --help
corepack pnpm --filter @flarex/backend exec wrangler deploy --help
git diff --check
```

## Target A Private Worker-Native Executor Host

Previous completed checkpoint: `b581f1a` Add the FlarexDB scope locator.

What changed:

- Selected a dedicated private Cloudflare Worker named `flarex-executor` as
  the hosted executor composition point.
- Preserved `FLAREX_EXECUTOR` as the generated Dynamic Worker shell's only
  database capability and retained the stable `/invoke/*` Fetch protocol for
  the first host.
- Required the executor Worker alone to own the cache-disabled Hyperdrive
  binding. Developer modules receive `ctx.db`, never the binding or a raw
  executor/persistence object.
- Put a Worker bundle plus real-Postgres proof before S02-D runtime routing;
  S02-B and S02-C remain host-neutral database work.

Why it changed:

The checked-in backend and artifact-runtime Wrangler files already bind to a
service named `flarex-executor`, but the repository has no matching deployable
Worker. Making that implicit hop concrete removes the planned Node/Nitro
deployment without weakening sandbox isolation.

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
- `crates/function_runner/src/lib.rs`
- `crates/isolate/src/environment/udf/syscall.rs`

How Flarex differs:

- Convex can mediate syscalls inside one hosted backend. Flarex uses a private
  Worker service binding because its developer function isolate is a separate
  Dynamic Worker.

Known limitations:

- The executor Worker, Hyperdrive binding, request-scoped Postgres adapter,
  placement policy, and deployed service-binding test do not exist yet.
- Keeping Fetch first does not reject Workers RPC. RPC remains an independent
  later transport decision after endpoint and failure semantics are stable.
- Capability-token and named-entrypoint hardening must be audited during the
  host spike; the Worker must not expose a public executor surface by default.

Verification:

```sh
rg -n "FLAREX_EXECUTOR|/invoke/|Hyperdrive|Nitro|Vercel" AGENTS.md design-notes roadmaps apps packages
git diff --check
```

## Generated Protocol Fragment Helpers

Previous completed checkpoint: `d9242ec` (`Extract generated project worker bridge`).

What changed:

- Extracted generated executor protocol fragments inside
  `packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts`:
  - transport and project routing,
  - execution start/kind/retry/finish/abort helpers,
  - database syscall plumbing,
  - executor headers, backend response parsing, and generated error helpers.
- Updated both generated-source builders to splice the shared fragments:
  - `generatedExecutionWorkerSource(...)` for hosted Dynamic Worker and local
    runtime materializer JavaScript modules,
  - `generatedProjectWorkerExecutorBridgeSource(...)` for typed generated
    project workers.
- Added a typed generated project-worker guard for malformed execution start
  responses so missing `sessionId` is rejected before finish/abort paths can
  use it.
- Kept the two emitted language variants explicit. The JavaScript output stays
  valid for Worker Loader/Miniflare module execution; the TypeScript output
  keeps generated project-worker types and validator integration.

Why it changed:

The previous checkpoint removed the third executor-loop copy by moving the
typed project worker bridge into the backend source-builder module. Review then
flagged that the two sibling builders still owned local copies of the same
executor protocol pieces. This checkpoint centralizes those fragments so future
transport/session/retry/syscall changes have one editing surface inside
`GeneratedWorkerSource.ts`.

Known limitations:

- The fragment helpers still emit separate JavaScript and TypeScript variants
  where the output language requires different annotations or return casts.
  That is intentional; the shared boundary is the fragment helper, not one
  single emitted source string for both runtimes.
- The generated-source helpers remain string-template based. The emitted-worker
  test suites execute the generated output, but direct source snapshot or parse
  checks can still be added later if the generated-source surface grows again.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev build
corepack pnpm --filter @flarex/artifact-runtime test
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```

## Typed Generated Project Worker Bridge

Previous completed checkpoint: `f02e156` (`Extract generated executor bridge`).

What changed:

- Added `generatedProjectWorkerExecutorBridgeSource(...)` in
  `packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts` as the
  typed project-worker sibling to `generatedExecutionWorkerSource(...)`.
- Re-exported the new builder from `flarex-backend/artifact-runtime`.
- Replaced the inlined executor bridge in
  `packages/flarex-dev/src/generate.ts` with the shared builder while keeping
  the project-worker-specific metadata validation, table ID validation,
  generated `ConnectionDO`, and request route code local to the generated
  project worker.
- Parameterized the backend base URL in the emitted bridge instead of keeping a
  hardcoded `https://flarex-backend.internal` literal inside the shared source.

Why it changed:

The previous checkpoint removed drift between the hosted artifact-runtime
Dynamic Worker template and the local runtime materializer. The generated
project worker still carried the same executor/session/retry/syscall loop in a
third place because it needs analyzed function metadata and validator imports.
This checkpoint keeps those typed project-worker concerns in the generator but
moves the duplicated executor bridge source into the same shared backend
source-builder module.

Known limitations:

- The typed project-worker builder is a sibling to
  `generatedExecutionWorkerSource(...)`, not the same helper. The project-worker
  source still needs TypeScript-only emitted code for analyzed metadata,
  validator return checks, `DatabaseWriter`, and generated `ConnectionDO`.
- The follow-up checkpoint above extracted the shared executor protocol
  fragments inside `GeneratedWorkerSource.ts`.
- The generated-source helpers remain string-template based. The focused
  generator tests execute the emitted worker, but a future hardening slice can
  add direct source snapshot or parse checks for the helper output.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```

## Shared Generated Executor Bridge

Previous completed checkpoint: `0781656` (`Bridge artifact runtime to executor`).

What changed:

- Extracted the generated executor bridge source into
  `packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts`.
- Exported `generatedExecutionWorkerSource(...)` from
  `flarex-backend/artifact-runtime` so deployable hosted runtime code and local
  dev materialization share one generated runtime contract.
- Replaced the hosted artifact-runtime Dynamic Worker template with a
  parameterized builder call for:
  - `FLAREX_EXECUTOR`,
  - `https://flarex-executor.internal`,
  - hosted fail-closed unsupported capability stubs.
- Replaced the local Miniflare materializer template with the same builder for:
  - `FLAREX_BACKEND`,
  - `https://flarex-backend.internal`,
  - the local-only `/__flarex_internal/query-session` route.
- Kept the generated worker self-contained: the builder emits plain JavaScript
  modules for Cloudflare Worker Loader and Miniflare module execution, rather
  than making generated workers import repo internals at runtime.

Why it changed:

The prior hosted executor bridge intentionally copied the mature local
materializer loop to move quickly, but reviewers correctly flagged drift risk.
This checkpoint removes that duplication while preserving the separate hosted
and local binding names/origins.

Known limitations:

- The typed generated project worker now uses the sibling
  `generatedProjectWorkerExecutorBridgeSource(...)` helper described above. It
  does not use `generatedExecutionWorkerSource(...)` directly because it still
  embeds analyzed metadata, validators, schema table IDs, and connection DO
  code.
- The shared builder is string-template based. A future hardening slice can add
  direct unit tests for generated source snapshots or parse checks, but the
  current safety net executes the emitted source through artifact-runtime and
  local Miniflare materializer tests.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter @flarex/artifact-runtime test
corepack pnpm --filter @flarex/artifact-runtime typecheck
corepack pnpm --filter @flarex/artifact-runtime build
corepack pnpm --filter @flarex/artifact-runtime deploy:dry-run
git diff --check
```

## Dynamic Worker Executor Bridge

Previous completed checkpoint: `b3d90e9` (`Wire artifact runtime Worker Loader`).

What changed:

- Added the `FLAREX_EXECUTOR` service binding to
  `apps/artifact-runtime/wrangler.jsonc`.
- Added hosted Dynamic Worker executor configuration to the artifact-runtime
  binding contract:
  - `FLAREX_EXECUTOR_TRANSPORT=postgres` as the hosted default,
  - `FLAREX_PROJECT_ID=default` as the initial single-project executor scope,
  - optional `FLAREX_EXECUTOR_TOKEN` secret forwarding,
  - `FLAREX_EXECUTOR_TOKEN_VERSION` as the non-secret Worker Loader cache
    identity for executor token rotation,
  - optional `FLAREX_INVOKE_MAX_ATTEMPTS` for Postgres mutation OCC retries.
- The default Worker Loader materializer now fails closed when either `LOADER`
  or `FLAREX_EXECUTOR` is missing.
- The generated Dynamic Worker wrapper now mirrors the mature local
  materializer execution loop:
  - starts query/mutation sessions through the executor binding,
  - forwards `ctx.db` operations through `/invoke/syscall`,
  - finishes sessions through `/invoke/finish`,
  - aborts failed sessions through `/invoke/abort`,
  - retries Postgres mutation attempts for known OCC conflict codes,
  - supports nested `ctx.runQuery` and same-mutation `ctx.runMutation` calls,
  - keeps unsupported `ctx.auth`, `ctx.scheduler`, and `ctx.storage`
    capabilities as explicit fail-closed errors.
- Worker Loader identity now includes executor transport, project ID, invoke
  attempts, and executor auth identity, so cached Dynamic Workers are reused
  only across matching executor configuration.

Known limitations:

- App-local tests prove the generated source, env wiring, fail-closed binding
  checks, and cache identity. They still use a fake Worker Loader rather than
  executing Cloudflare's production Dynamic Worker runtime in Vitest.
- The hosted artifact runtime still relies on the executor service binding to
  implement the validated `/invoke/start`, `/invoke/syscall`, `/invoke/finish`,
  and `/invoke/abort` routes. This checkpoint wires the Dynamic Worker to that
  contract; it does not change executor route semantics.

Verification:

```sh
corepack pnpm --filter @flarex/artifact-runtime test
corepack pnpm --filter @flarex/artifact-runtime typecheck
corepack pnpm --filter @flarex/artifact-runtime build
corepack pnpm --filter @flarex/artifact-runtime deploy:dry-run
git diff --check
```

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
