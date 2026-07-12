# Local Development Runtime

## Status And Scope

**Status:** Active domain authority with an implemented programmatic Miniflare
runtime, Vite integration, a legacy Durable Object compatibility mode, and an
opt-in PGlite/Postgres executor mode. The accepted destination is the
Postgres-authoritative mode; browser WebSocket proxying and atomic reload
cutover remain incomplete.

This roadmap owns:

- developer-process composition of backend, application, artifact, and local
  executor runtimes;
- startup, reload serialization, file watching, health, inspection, cleanup,
  and local persistence behavior;
- the Vite `/__flarex_dev/*` middleware boundary;
- selection between legacy compatibility and forward Postgres execution; and
- local-only diagnostics and lifecycle guarantees across those components.

It does not own:

- SDK, CLI, codegen, or package publication contracts, covered by
  [`09-sdk-and-cli-fork.md`](./09-sdk-and-cli-fork.md);
- source-package analysis and push authority, covered by
  [`17-deployment-analysis-and-push.md`](./17-deployment-analysis-and-push.md);
- execution-artifact sandbox and materialization semantics, covered by
  [`06-dynamic-worker-execution.md`](./06-dynamic-worker-execution.md);
- trusted transaction, storage-generation, OCC, or Postgres semantics, covered
  by [`20-postgres-executor.md`](./20-postgres-executor.md) and the
  [FlarexDB foundation](./flarexdb-foundation/README.md);
- sync, freshness, invalidation, fanout, or delivery correctness, covered by
  [`21-cloudflare-freshness-cache.md`](./21-cloudflare-freshness-cache.md); or
- test-harness convenience APIs, covered by
  [`15-test-sdk.md`](./15-test-sdk.md).

Developers write ordinary TypeScript under `flarex/`. They do not create
Worker entrypoints, Wrangler configuration, Miniflare instances, PGlite
connections, service bindings, or executor tokens.

## Current Sources Of Truth

Use these authorities in order when they disagree:

1. [`../AGENTS.md`](../AGENTS.md) and its accepted-design precedence;
2. [`../design-notes/flarex-db-accepted-design.md`](../design-notes/flarex-db-accepted-design.md)
   for Postgres authority and the hosted Worker topology;
3. the active domain roadmaps linked above for their owned semantics;
4. this roadmap for local composition and lifecycle;
5. current source and tests for exact implemented behavior; and
6. older checkpoints only as compatibility and provenance evidence.

Current implementation anchors are:

- [`packages/flarex-dev/src/dev.ts`](../packages/flarex-dev/src/dev.ts) for the
  programmatic runtime, reload order, request surface, persistence, and cleanup;
- [`packages/flarex-dev/src/vite.ts`](../packages/flarex-dev/src/vite.ts) for
  Vite startup, middleware, watching, debounce, and shutdown integration;
- [`packages/flarex-dev/src/executorHttpRuntime.ts`](../packages/flarex-dev/src/executorHttpRuntime.ts)
  for the PGlite-backed executor, scope-authority provisioning, freshness, and
  trigger composition;
- [`packages/flarex-dev/src/backendPush.ts`](../packages/flarex-dev/src/backendPush.ts)
  for local backend push/analyzer adapters;
- [`packages/flarex-dev/src/runtimeMaterializer.ts`](../packages/flarex-dev/src/runtimeMaterializer.ts)
  and [`executionArtifact.ts`](../packages/flarex-dev/src/executionArtifact.ts)
  for the local Miniflare materialization and analysis adapters;
- [`packages/flarex-dev/test/dev.test.ts`](../packages/flarex-dev/test/dev.test.ts),
  [`devDispose.test.ts`](../packages/flarex-dev/test/devDispose.test.ts),
  [`vite.test.ts`](../packages/flarex-dev/test/vite.test.ts), and
  [`executorHttpRuntime.test.ts`](../packages/flarex-dev/test/executorHttpRuntime.test.ts)
  for lifecycle and composition evidence; and
- [`packages/flarex-dev/test/backendSyncRuntime.test.ts`](../packages/flarex-dev/test/backendSyncRuntime.test.ts)
  and [`artifactLifecycleParity.test.ts`](../packages/flarex-dev/test/artifactLifecycleParity.test.ts)
  for Postgres-backed sync and local/hosted artifact-contract evidence.

## Current Architecture

### Entry Points

`createFlarexDevRuntime(options)` is the programmatic composition boundary. It
returns:

```ts
type FlarexDevRuntime = {
  deploymentId: string;
  reload(): Promise<void>;
  fetch(request: Request): Promise<Response>;
  dispose(): Promise<void>;
};
```

The `flarex-dev/vite` plugin creates this runtime during Vite serve unless
`dev: false`. Build and `dev: false` serve perform codegen without starting the
runtime. Public command behavior remains owned by roadmap 09; there is no
standalone long-running `flarex dev` command today.

### Runtime Composition

Every dev runtime creates a backend Miniflare Worker containing the current
backend Worker, deployment registry, push routes, artifact R2 bucket, artifact
runtime service, sync actors, and compatibility actors. It also creates a
generated application Miniflare Worker used for health and compatibility
forwarding.

Execution is selectable:

| Mode | Current status | Authoritative app writes | Intended use |
| --- | --- | --- | --- |
| `legacy` | Default compatibility baseline | Legacy backend Durable Object path | Preserve prototype examples and regression coverage only |
| `postgres` | Opt-in forward path | Trusted executor over PGlite | Local development and fast correctness evidence for the accepted architecture |

The Postgres mode additionally creates `createLocalPGliteExecutorHttpRuntime`:

```text
backend Miniflare
  -> artifact-runtime service
  -> Miniflare materialized source package
  -> restricted invoke Fetch protocol
  -> local executor HTTP adapter
  -> PGlite persistence
```

It migrates PGlite unless disabled by a trusted caller, provisions the fixed
local shared-scope physical locator `primary/public`, wraps persistence with
ready-deployment authority, creates the freshness mirror, and wires the
post-commit Cloudflare-style trigger notifier back to the backend runtime.
Split physical topologies are not a public local-dev option.

The deterministic development tokens used between these in-process runtimes
are capabilities for local adapter wiring, not production authentication
evidence.

### Startup And Reload

Startup performs one reload before returning a ready runtime. Reloads are
serialized through a promise chain so two deployments cannot mutate the local
composition concurrently.

The implemented reload is:

```text
initial codegen
  -> bundle immutable source package
  -> backend push start and backend-returned analysis
  -> final codegen from that analysis
  -> optional generated-output typecheck
  -> in Postgres mode, register and activate executor package
  -> build next generated app Worker
  -> finish backend push
  -> swap next app Worker into service
  -> dispose previous app Worker
```

If initial codegen, analysis, final codegen, typecheck, or app construction
fails, startup fails or the previous application Worker remains selected. If
backend finish rejects, the newly created app Worker is disposed and the prior
one remains selected. Backend rejection diagnostics are preserved in the
developer-facing error.

This is not yet a fully atomic reload across all local authorities. In
Postgres mode the executor package is activated before backend push finish and
before the application Worker swap. A later failure can therefore leave the
executor package ahead of the backend/app selection. Failed analyzed pushes
are also not automatically abandoned by `createFlarexDevRuntime`.

### Vite Watch Loop

The Vite plugin:

- watches `flarex/**/*.ts`;
- ignores changes inside the generated directory;
- debounces handled `change` events by 500 ms;
- calls the runtime reload chain, or codegen-only flow when `dev: false`;
- logs reload failures without tearing down the previous running app; and
- starts runtime disposal when the Vite HTTP server closes.

Only the Chokidar `change` event is currently handled. Creation, deletion, and
rename of developer modules are not explicit reload triggers.

### Request Surface

Vite forwards HTTP requests beginning with `/__flarex_dev` into the
programmatic runtime. The current explicit routes are:

| Route | Behavior |
| --- | --- |
| `GET /__flarex_dev/health` | Combines backend and generated-app health into `ok` or `degraded` status |
| `GET /__flarex_dev/push` | Returns the last activated local push or `null` |
| `GET /__flarex_dev/deployment` | Returns active backend deployment metadata, including artifact identity |
| `POST /__flarex_dev/invoke` | Validates the dev request body and invokes through the backend-owned active artifact path |
| `GET /__flarex_dev/sync` | Forwards the WebSocket-capable request to the backend deployment sync route |
| Other `/__flarex_dev/*` | Strips the prefix and forwards to the generated app Worker compatibility surface |

Programmatic Miniflare consumers and `flarex-test` can use the sync WebSocket
response. Vite currently installs only HTTP middleware and does not bridge the
Node HTTP upgrade event, so browser WebSocket sync through the Vite server is
not implemented.

### Persistence And Cleanup

Runtime persistence is divided under the resolved dev directory:

```text
.flarex/dev/
  backend/
  app/
  executor/
```

`persistDir: false` disables persistence. An explicit `persistDir` is retained
after disposal. The default `.flarex/dev` directory is removed on normal
dispose and on failed startup; a crash can leave it behind for the next run.
Test reset helpers may delete only an explicitly configured path beneath the
project's `.flarex/` directory and reject roots or paths outside that boundary.

Disposal waits for the reload chain, then attempts to dispose the application
Worker, PGlite executor runtime, cached artifact materializations, and backend
Miniflare runtime. Cleanup uses all-settled semantics so one failure does not
prevent remaining resources from being released; normal disposal reports one
failure directly or several through `AggregateError`.

## Invariants And Trust Boundaries

1. **Postgres/PGlite is the forward local write authority.** Legacy Durable
   Object storage is compatibility scaffolding, not the target architecture.
2. **Developer code never receives storage authority.** It receives only the
   restricted generated context and executor syscall surface.
3. **Source is pushed to a backend boundary.** Final codegen consumes the
   backend-returned analysis; local filesystem rescanning cannot silently
   replace it after push start.
4. **Analysis and invocation use separate runtime roles.** Local Miniflare is
   an adapter for the same source-package contracts used by hosted analysis and
   managed execution, not authority to invent different semantics.
5. **Reloads are serialized and preserve the last usable app when possible.**
   A failed candidate must not replace the selected application Worker.
6. **Local mode cannot weaken activation prerequisites.** Schema readiness,
   storage generation, scope authority, artifact identity, and execution
   metadata must obey the same accepted contracts as hosted mode.
7. **PGlite proves portability, not production database semantics.** Locks,
   isolation, query plans, migrations, and outbox correctness still require
   focused real-Postgres evidence.
8. **Sync remains backend-owned.** Clients connect to the deployment sync
   boundary; query state, mutation queues, freshness, and delivery do not move
   into Vite or the application Worker.
9. **Internal tokens stay internal.** Hard-coded development capabilities must
   never be reused as hosted secrets or accepted as an authentication proof.
10. **Cleanup is part of correctness.** Reload and shutdown must release nested
    Miniflare, artifact-cache, executor, database, timer, and filesystem state.
11. **Generated app/runtime Workers are tooling-owned.** Their compatibility
    routes do not make developer-authored Workers part of the public contract.
12. **Roadmap ownership stays narrow.** Local dev composes adjacent domains but
    does not redefine their push, execution, transaction, or sync semantics.

## Decisions And Rationale

### Preserve The Convex Local-Backend Mental Model

Developers should see one local Flarex endpoint and one watch/reload loop even
though Cloudflare requires several internal runtimes. Exposing Miniflare,
PGlite, Workers, or service-binding topology would turn platform internals into
application configuration.

### Compose Real Boundaries Instead Of A Separate Fake Backend

The local lane reuses the backend Worker, push lifecycle, source-package
artifact runtime, executor Fetch protocol, PGlite persistence, and sync actors.
This catches contract drift that an in-memory fake would hide and lets
`flarex-test` exercise the same composition.

### Keep Legacy Mode Only As A Named Compatibility Path

The legacy Durable Object path remains useful for regression coverage while
replacement gates are incomplete. It must not influence new schema, OCC,
freshness, or transaction design, and it should cease being the default after
the Postgres local path passes the declared cutover gates.

### Use Vite As The Current Host, Not The Domain Contract

Vite supplies filesystem watching and an HTTP development server today. The
programmatic `FlarexDevRuntime` is the durable composition boundary; a future
CLI host can own the same runtime without changing backend semantics.

### Fail Before Selecting A Broken App

Final codegen and optional typecheck occur before the new app is selected.
Backend finish must accept the candidate before the application Worker swap.
This preserves a usable prior runtime during common developer errors, while the
remaining multi-authority activation gap is tracked explicitly below.

## Convex Compatibility And Flarex Divergences

The local workflow follows these Convex patterns:

- `npm-packages/convex/src/cli/lib/dev.ts` for a long-running watch, codegen,
  push, backend coordination, and last-good deployment loop;
- `npm-packages/convex/src/cli/lib/localDeployment/run.ts` for owning local
  backend lifecycle, persistence, health, and cleanup;
- `npm-packages/convex/src/cli/lib/codegen.ts` for initial/final generated
  output around backend analysis;
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts` and
  `crates/application/src/deploy_config.rs` for source push, analyzed candidate,
  and finish/activation sequencing; and
- `crates/local_backend/src/subs` and `crates/sync/src` for clients targeting a
  backend-owned local sync service.

Named Flarex divergences are:

- Convex starts an integrated native local backend; Flarex composes Miniflare
  Workers, Durable Objects, a managed source-package runtime, and optionally a
  PGlite executor in one developer process.
- Flarex user modules run in a generated Worker-shaped sandbox and reach data
  through the private invoke protocol; they do not execute inside the backend.
- Cloudflare WebSockets and service bindings require explicit adapter behavior;
  Vite HTTP middleware cannot transparently stand in for a Worker upgrade.
- PGlite is the fast local adapter for the accepted Postgres authority, while
  real Postgres remains a separate correctness lane.
- The current local backend still contains legacy Durable Object actors and a
  generated app Worker for compatibility during replacement migration.

## Implemented Capabilities

- Programmatic startup, serialized reload, Fetch dispatch, and disposal.
- Vite codegen/runtime startup, 500 ms TypeScript-change debounce, generated
  directory exclusion, middleware proxying, and close-triggered cleanup.
- Backend source-only push, backend-returned codegen analysis, final codegen,
  optional generated-output typecheck, and last-app preservation on common
  failures.
- Local Miniflare analysis with bounded diagnostics, import-phase restrictions,
  cold-isolate consistency checks, and best-effort source positions.
- R2-shaped local artifact storage, backend-owned active artifact resolution,
  cached Miniflare materialization, and nested materialization cleanup.
- Legacy and opt-in PGlite/Postgres execution modes.
- PGlite migrations, shared-scope authority provisioning, package
  registration/activation, executor HTTP routes, freshness mirror, and
  post-commit trigger wiring.
- Health, push, deployment, invoke, sync, and compatibility request routes.
- Programmatic WebSocket sync proving indexed query subscription, mutation
  response ordering, invalidation, rerun, and transition delivery.
- Typed request/response JSON boundaries in normal TypeScript adapters, with
  named generated-JavaScript parsing errors at generated Worker edges.
- Safe reset-path validation and all-settled multi-runtime disposal.

## Known Gaps And Limitations

- `legacy` remains the default `executorTransport`, contrary to the accepted
  Postgres-authoritative direction.
- The Vite plugin does not expose `executorTransport`, project identity, or
  executor/delivery configuration, so its normal dev path cannot select the
  implemented Postgres mode.
- Browser WebSocket upgrades through Vite are not wired. Programmatic runtime
  and test SDK WebSockets do not prove browser dev-server behavior.
- Postgres reload activation is not atomic across the executor package,
  backend push, and application Worker. Executor activation currently happens
  before backend finish and app swap.
- Reload failures do not automatically abandon analyzed backend candidates;
  failed final codegen/typecheck/build can leave candidate state behind.
- Final generated files are written before complete activation. A failed later
  gate can leave disk output ahead of the last active runtime.
- The watcher handles only `change`, not explicit add/unlink/rename events, and
  provides no surfaced reload state beyond logs and the last push route.
- Vite shutdown initiates async disposal from the close callback but does not
  provide a Vite-level awaited shutdown receipt.
- The default persistence directory is deleted only during cooperative cleanup;
  crashes can leave partial state. There is no startup recovery/validation or
  user-facing reset command in the local host.
- Local PGlite uses one fixed shared-database locator. Split topology, storage
  generation selection, backfill/compare/cutover, and rollback are foundation
  responsibilities and are not locally selectable.
- PGlite and Miniflare do not prove real-Postgres isolation/locks/query plans or
  hosted Worker/Hyperdrive lifecycle.
- Post-commit sync trigger notification is best effort; durable retry and
  recovery remain owned by roadmap 21.
- Local development has no streamed function logs, backend-change watch,
  structured status channel, interactive recovery, or standalone `dev` CLI.
- Generated app Worker compatibility routes and legacy actors remain in the
  composition, increasing the risk of testing a path that is not the accepted
  hosted authority unless tests select Postgres explicitly.
- Deterministic local capability tokens and in-process service bindings do not
  exercise hosted authentication, authorization, or secret rotation.

## Target Direction

Local development should present one Convex-shaped endpoint while exercising
the accepted Flarex runtime boundaries:

```text
file or config change
  -> serialized source-package candidate
  -> backend-controlled analysis
  -> final codegen and mandatory local validation policy
  -> atomically activate backend metadata + executor package + app view
  -> backend-owned invoke and WebSocket sync endpoint
  -> managed Miniflare user-code artifact
  -> trusted PGlite executor
  -> observable reload status and recoverable persistence
```

The same source package, analysis response, artifact identity, invoke protocol,
scope authority, and sync semantics should carry to hosted Cloudflare. Only the
adapters change: Miniflare to Dynamic Workers, PGlite to Postgres through
cache-disabled Hyperdrive, and local in-process capabilities to deployed
service bindings.

## Next Correctness Gates

1. **Make reload cutover coherent.** Define one local activation transaction or
   compensating protocol across executor registration/activation, backend push
   finish, generated output, and app swap. Prove every injected failure retains
   one consistent previous generation and abandons or cleans the candidate.
2. **Promote Postgres mode into Vite.** Expose the forward local composition,
   make it the default after compatibility tests pass, and require an explicit
   legacy opt-in. Prove ordinary Vite invoke and sync avoid authoritative
   PartitionDO writes.
3. **Wire browser WebSocket upgrades.** Bridge the Vite HTTP server upgrade to
   the backend-owned `/sync` route and prove a browser-style client receives an
   initial indexed query, mutation response, and later transition.
4. **Complete watch and recovery behavior.** Handle add/unlink/rename, coalesce
   changes during active reload, expose analyzing/failed/active status, and
   prove recovery after syntax, analysis, typecheck, and backend failures.
5. **Harden local persistence lifecycle.** Validate or repair leftover state on
   startup, add a safe explicit reset surface, await host shutdown, and prove
   no Miniflare, artifact, PGlite, timer, or filesystem handles leak.
6. **Align replacement-generation gates.** Register and activate only exact
   immutable schema/package generations that passed foundation readiness and
   scope-authority provisioning; keep rollback selection until the declared
   migration gates pass.
7. **Add parity evidence without widening authority.** Compare the local
   Postgres mode with focused real-Postgres and hosted Worker lanes for the same
   invoke, failure, identity, and sync cases. Keep platform provisioning outside
   ordinary local tests.
8. **Improve developer operability.** Add a standalone long-running dev host,
   structured diagnostics/log streaming, clear remediation for failed pushes,
   and machine-readable health/reload state only after correctness gates 1-5.

## Current Checkpoint Record

- **What changed:** replaced accumulated local-dev checkpoint narration with
  the living composition, lifecycle, invariants, current gaps, and ordered
  correctness gates above; promoted this file in the roadmap index.
- **Why:** Git owns chronology. This roadmap must explain what local dev owns
  today without duplicating analysis, runtime, executor, sync, or SDK authority.
- **Previous completed domain checkpoint:** `a4c290f Fence executor deployment
  creation`.
- **Convex sources inspected:** the portable local-dev, codegen, push, backend,
  and sync sources named in the compatibility section were retained from the
  verified checkpoint evidence; no new behavior was designed in this docs-only
  compaction.
- **Flarex difference from Convex:** unchanged. Flarex composes Cloudflare-shaped
  runtimes and a PGlite executor instead of starting one native backend binary.
- **Known limitations/follow-up:** the gaps and gates above remain open; no code
  behavior changed in this checkpoint.
- **Verification:** repository-relative Markdown links, `git diff --check`, and
  roadmap index classification were checked. No runtime command was required
  for a docs-only rewrite grounded in current source and decisive tests.
