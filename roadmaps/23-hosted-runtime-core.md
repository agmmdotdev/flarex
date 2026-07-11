# Hosted Runtime Core

## Emit Run-Scoped Hosted Data-Plane Evidence

Previous completed checkpoint: `708b234` (`Gate hosted executor activation
receipts`).

What changed:

- Changed the disposable probe endpoint from one ambient static path to
  `/__flarex_h05/invoke/{runId}`. The Worker derives that path from its
  validated deployment secret, rejects another run's path, and the final
  receipt now requires the exact same correlation path for the Observability
  query.
- Promoted the proof identity, protocol, probe Worker, receipt contract, shared
  OCC oracle, and hosted PostgreSQL runner into `apps/executor/h05/`. The live
  collector no longer imports a Vitest module; Node assertions enforce the
  reusable proof contract while Vitest wrappers retain test reporting.
- Counted the hosted public boundary rather than inferring it: one unauthorized
  response with no hop, fourteen authenticated responses, fourteen private-hop
  markers, and fifteen `no-store` responses must precede evidence emission.
- Added a canonical `flarex-h05-data-plane-evidence-v1` artifact containing the
  source commit and bounded collection window, run identity, exact
  winner/stale/abort/fresh and SQL evidence, and verified zero retained
  PostgreSQL rows. The shared decoder recomputes both the inner invocation hash
  and an outer hash over the complete payload; the final hosted receipt embeds
  that envelope and binds its source, run, and window to the final proof. Trace
  observations must fall inside the hashed data-plane interval, and final
  teardown must occur after that interval, preventing sequential reuse of one
  run ID from mixing two proof executions.
- Added `collect:h05-data-plane-evidence`. It requires a clean Git worktree,
  refuses output inside that worktree or an existing target, publishes through
  a same-directory temporary hard link, and writes only after proof and scoped
  PostgreSQL cleanup both succeed. It rechecks both `HEAD` and the complete
  worktree immediately before publication.

Why it changed:

The previous receipt gate described the final evidence but the hosted harness
discarded transport counts and cleanup state inside `finally`, and its static
path could overlap ambient requests in a trace window. A run-scoped,
self-verifying data-plane sidecar gives the later Cloudflare collector one
unambiguous input without persisting tokens, database URLs, session IDs, or raw
PostgreSQL origin data.

Convex references inspected:

- `crates/database/src/committer.rs`
- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`

Cloudflare references inspected:

- [Workers tracing](https://developers.cloudflare.com/workers/observability/traces/)
- [Workers Observability query API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/)
- [Workers service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)

How Flarex differs:

- Convex correlates a hosted function run and final transaction inside its
  owned runner/committer. This temporary Flarex compatibility proof spans one
  public probe request per syscall and therefore emits an explicit counted,
  run-scoped artifact before the control-plane and distributed-trace evidence
  can be joined.

Known limitations:

- This checkpoint emits only the data-plane sidecar. The read-only Cloudflare
  control-plane collector, paginated domain/zone-route inventory, invocation
  and trace-summary queries, probe deletion proof, and final receipt compiler
  remain the next H05 work.
- No Cloudflare resource or hosted PostgreSQL row was changed in this turn;
  credentials and a dedicated Internet-reachable staging database remain
  absent. H05 and S02-D remain open.
- The artifact proves only the current legacy point-OCC scenario. It adds no
  new FlarexDB clock, sequence, OCC, compiler, sync, Payload, or Medusa behavior.

Verification:

```sh
corepack pnpm --filter @flarex/executor-worker typecheck # passed
corepack pnpm --filter @flarex/executor-worker test # 8 files, 98 tests passed
corepack pnpm --filter @flarex/executor-worker build # passed
corepack pnpm --filter @flarex/executor-worker check:bundle # passed; production graph remained 401 inputs
corepack pnpm --filter @flarex/executor-worker deploy:h05-probe:dry-run # passed; 7.66 KiB proof Worker
corepack pnpm --filter @flarex/executor-worker collect:h05-data-plane-evidence data-plane.json # expected exit 1; rejected in-worktree output without writing
corepack pnpm check:effect-boundaries # passed
git diff --check # passed
```

## Make The Hosted Activation Receipt Fail Closed

Previous completed checkpoint: `dcf64dc` (`Prepare hosted executor activation
proof`).

What changed:

- Added a strict `flarex-h05-hosted-receipt-v1` decoder and local CLI
  preflight. It rejects unknown keys and requires one clean source commit, a
  bounded UTC collection window, complete names-only binding inventories,
  hashed origin
  and evidence values, exact Worker/deployment/version identities, and a
  run-derived deployment/project pair. Placeholder IDs, incomplete binding
  inventories, and out-of-order proof/cleanup evidence fail closed. It persists
  no database URL, password, bearer capability value, or raw origin. The run
  ID is deliberately included as non-sensitive proof identity; uploading it
  through a Worker secret keeps ephemeral state out of config but does not make
  it an authorization capability.
- Made the JSON representation canonical as well as structurally strict. The
  CLI rejects alternate whitespace/key order and duplicate-key documents, so
  the bytes that are hashed and reviewed have one unambiguous interpretation.
- Made the local preflight independently bind the receipt to the current Git
  `HEAD`, an empty tracked/untracked worktree, and the installed Wrangler
  version. It recomputes the source-evidence hash from that canonical tuple;
  the future collector must keep its candidate receipt outside the worktree
  until this check passes.
- Invoked Wrangler through its resolved JavaScript entrypoint and
  `process.execPath`, matching the existing dry-run wrapper so the same
  preflight works on Windows without spawning a `.cmd` shim. Deployment and
  version IDs are treated as bounded opaque Cloudflare identifiers instead of
  assuming one UUID version/variant encoding.
- Required independent control-plane evidence instead of trusting checked-in
  Wrangler JSON. The executor receipt must bind one active 100% version to the
  cache-disabled Hyperdrive ID, `nodejs_compat`, smart placement, and the exact
  executor secret with a complete binding inventory. Workers Subdomain,
  account domain, and every zone-route
  inventory must jointly show no public executor ingress, and a direct request
  must remain unreachable.
- Required the disposable caller's active version to contain only the named
  executor service binding and the three proof bindings. The caller must use
  its exact `workers.dev` origin, while the executor stays service-binding-only.
- Enabled persisted automatic traces at a 100% head-sampling rate on both
  proof Workers. The receipt requires fifteen version-correlated traces: one
  unauthorized caller-only request plus fourteen authorized traces containing
  the caller-to-executor service-binding path, all within the proof window.
  The Observability query must be complete and report zero truncated traces.
- Made the hosted transport assert `cache-control: no-store` on every public
  proof response. The receipt fixes the exact current H04/H05 oracle: fourteen
  marked service-binding responses, winner/stale-conflict/abort/fresh
  convergence, direct SQL counts and timestamps, zero retained proof rows,
  and an independently verified probe deletion/404. The unauthorized response
  must have no service-binding hop marker.

Why it changed:

Wrangler's deployment, version, Hyperdrive, and secret outputs each prove only
part of H05. They do not prove Worker-subdomain privacy, absence of routes or
custom domains, cross-Worker execution, PostgreSQL state, or teardown. Also,
`observability.enabled` alone left traces disabled in the emitted Worker
settings. A canonical, strict receipt prevents a static config, local
Hyperdrive lane, or incomplete collection from being promoted to hosted proof.

Convex references inspected:

- `crates/database/src/committer.rs`
- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`

Cloudflare references inspected:

- [Hyperdrive query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)
- [Workers versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Workers tracing](https://developers.cloudflare.com/workers/observability/traces/)
- [Workers observability API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/)
- [Workers service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)

How Flarex differs:

- Convex owns one hosted runner/committer boundary and can correlate execution
  internally. Flarex's pre-S02-D compatibility proof crosses two Cloudflare
  Workers and therefore binds control-plane versions, a distributed trace,
  the hop marker, and authoritative PostgreSQL evidence into one receipt.
- The exact fourteen-call oracle describes only the current compatibility
  executor protocol. It is a proof fixture, not the future FlarexDB public API.

Known limitations:

- This checkpoint defines and tests the receipt gate but creates no receipt.
  No Cloudflare account is authenticated here, no hosted Worker or Hyperdrive
  was changed, the executor config still contains its placeholder Hyperdrive
  ID, and H05 remains open.
- A later collector still has to capture and sanitize fresh Wrangler deploy
  sidecars/status/version/secret output, Hyperdrive output, Workers ingress
  APIs, Workers Observability query output, hosted harness evidence, and the
  post-delete negative lookup before invoking the preflight.
- The 100% trace rate is deliberate for this bounded staging proof. A later
  production observability policy must set its own sampling and retention
  budget after H05; lowering it during H05 invalidates the receipt.
- S02-D runtime generation routing, new sequences/OCC/compiler/sync, Payload,
  Medusa, and compatibility-adapter retirement remain excluded.

Verification:

```sh
corepack pnpm --filter @flarex/executor-worker typecheck # passed
corepack pnpm --filter @flarex/executor-worker test # 7 files, 85 tests passed
corepack pnpm --filter @flarex/executor-worker check:bundle # passed; 401-input executor graph remained clean
corepack pnpm --filter @flarex/executor-worker deploy:h05-probe:dry-run # passed; 7.57 KiB proof Worker
corepack pnpm --filter @flarex/executor-worker check:h05-hosted-receipt package.json # expected exit 1; rejected non-receipt JSON
corepack pnpm --filter @flarex/executor-worker exec node --no-warnings node_modules/wrangler/wrangler-dist/cli.js --version # passed on Windows; 4.100.0
corepack pnpm check:effect-boundaries # passed
corepack pnpm typecheck # passed across 15 workspace projects
corepack pnpm test # bounded at 244s in the unrelated flarex-backend Vitest process; verified residual PIDs were stopped
corepack pnpm build # executor built; unrelated apps/example Vite build failed on the existing extensionless flarex-backend/src/http import
git diff --check # passed
```

## Prepare The Hosted Activation Probe

Previous completed checkpoint: `e2921b5` (`Prove executor Worker service
binding`).

What changed:

- Added a dedicated, ephemeral `flarex-executor-h05-probe` Worker. Its only
  platform capability is the named `FLAREX_EXECUTOR -> flarex-executor`
  service binding; it has no Hyperdrive binding, database URL, route, or
  ordinary configuration variables.
- Restricted the authenticated proof endpoint to the four invoke operations
  used by the OCC scenario and to the exact deployment/project derived from
  its configured H05 run ID. The probe creates a new internal request, injects
  the executor capability itself, rejects identical probe/executor secrets,
  compares the public capability through fixed-length digests, forwards no
  caller headers, disables response caching on all replies, marks successful
  hops, and redacts binding failures.
- Added a hosted PostgreSQL runner that receives only the public probe URL,
  probe token, and dedicated staging database URL. It fails closed without an
  explicit mutation opt-in and exact database-name confirmation; requires one
  non-downgradable TLS mode; rejects local, unresolved, unnamed, or default
  databases, PostgreSQL target-override query parameters, and non-origin HTTPS
  probe targets; bounds DNS, connection, SQL, and Fetch waits; and removes only
  its run-owned rows.
- Held one session-level PostgreSQL advisory claim, not a SQL transaction,
  across each hosted run. A concurrent identical run ID now fails before
  mutation, crash release is connection-owned, and PostgreSQL 18 proved one
  claimant excludes another and the claim is reusable after release.
- Made Wrangler dry-runs deterministic on Node 24/Windows by requiring fresh
  bundle/metafile output plus Wrangler's success sentinel, allowing a bounded
  stdout drain after normal exit, then awaiting a retained CLI process exit
  with bounded kill escalation. Both the production executor and the 7.57 KiB
  probe bundle now use that wrapper.

Why it changed:

H05 cannot be executed safely as an improvised public proxy. This checkpoint
prepares the smallest authenticated caller and repeatable OCC/SQL harness so a
later authenticated staging turn can collect the Cloudflare receipt without
expanding into S02-D or runtime generation routing.

Convex references inspected:

- `crates/database/src/committer.rs`
- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`

How Flarex differs:

- Convex returns one `FunctionFinalTransaction` to an in-process committer,
  validates its read set, and retries a mutation around that boundary. Flarex
  preserves trusted validation/commit ownership while journaling the current
  compatibility transaction across private Fetch calls.
- The H05 probe is a disposable Cloudflare verification capability, not a
  developer API or a second executor host.

Known limitations:

- This is H05-A preparation only. No Cloudflare resource was created or
  changed, the executor config still contains its placeholder Hyperdrive ID,
  and H05 remains unchecked until H05-B records live cache-disabled
  Hyperdrive, deployment/version, privacy, service-binding, trace, and SQL
  evidence.
- The current environment is not authenticated to Wrangler and has no
  dedicated Internet-reachable staging PostgreSQL URL. S02-D remains blocked.
- The proof intentionally retains the legacy `primary/public`, millisecond
  timestamp, and session-OCC behavior. It adds no schema, sequence allocator,
  compiler, sync, Payload, Medusa, or adapter-retirement behavior.

Verification:

```sh
corepack pnpm --filter @flarex/executor-worker typecheck
corepack pnpm --filter @flarex/executor-worker test
corepack pnpm --filter @flarex/executor-worker check:bundle
corepack pnpm --filter @flarex/executor-worker deploy:h05-probe:dry-run
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/executor-worker test:service-binding:postgres
corepack pnpm --filter @flarex/executor-worker test:service-binding:hosted:postgres # expected fail-closed without H05 opt-in/config
git diff --check
```

## Prove The Named Executor Service Binding Against PostgreSQL

Previous completed checkpoint: `f0ec41b` (`Add private executor Worker bundle
gate`).

What changed:

- Completed H04 with one Miniflare multi-Worker workerd graph. The caller owns
  only the named `FLAREX_EXECUTOR -> flarex-executor` service binding; the
  executor owns only its bearer token and local
  `HYPERDRIVE_CACHE_DISABLED` binding. Direct executor access is disabled and
  every proof request carries a caller-added hop receipt.
- Loaded the exact H03 `dist/worker.js` bytes, migrated and seeded a disposable
  PostgreSQL database outside workerd, and verified zero target-database
  clients while workerd remained alive. A second zero-client check precedes
  normal fixture-database removal after workerd disposal and SQL assertions.
- Found that H03's unauthorized smoke never constructed Elysia. The first
  authorized request did and failed because workerd forbids Elysia's string
  code generation. Added a direct `@flarex/executor-http/fetch` subpath for
  `GET /health` and the stable `/invoke/*` protocol. The existing root
  Elysia/Nitro compatibility adapter remains intact.
- Strengthened the emitted-bundle gate to require the plain Fetch subpath and
  reject the root HTTP barrel, `routes.ts`, bare or rewritten `elysia`
  specifiers, and installed Elysia package inputs. The resulting production
  graph has 401 inputs and two outputs.
- Proved the current transaction behavior end to end: two sessions read the
  same revision, the first commits, the stale finish returns the exact OCC
  conflict, that session aborts and becomes inactive, and a fresh session
  rereads and converges. Authoritative SQL then showed three terminal sessions,
  three document revisions, two commits, and two outbox rows.

Why it changed:

H03 proved only configuration and static bundling. H04 had to execute the exact
bundle through the actual named service-binding topology. Doing so exposed a
runtime incompatibility hidden behind the outer authorization gate and proved
the replacement Worker edge without changing executor, persistence, or OCC
semantics.

Convex references inspected:

- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`
- `crates/isolate/src/environment/udf/syscall.rs`
- `crates/database/src/committer.rs`

How Flarex differs:

- Convex returns a `FunctionFinalTransaction` from its function runner and its
  committer validates the read set before ordered publication in one backend.
  Flarex keeps the same trusted validation/commit ownership but journals
  syscalls across private service-bound Fetch requests because user code runs
  in a separate Dynamic Worker.
- The Worker-specific Fetch adapter intentionally exposes only health and the
  stable invoke protocol. Maintenance and live-query HTTP routes remain on the
  compatibility adapter until a later host decision gives them a Worker-owned
  ingress.

Known limitations:

- Local Miniflare Hyperdrive connects directly to PostgreSQL; it does not prove
  hosted pooling or disabled query caching. H05 remains the only gate for that
  receipt, and S02-D remains blocked.
- This proof retains `primary/public`, the current legacy generation,
  millisecond `beginTs`, and current session OCC. It adds no new FlarexDB
  schema, clock routing, sequence allocation, compiler, sync, Payload, or
  Medusa behavior.
- The real-PostgreSQL test is excluded from the ordinary unit suite. Its
  explicit command fails when `FLAREX_POSTGRES_DATABASE_URL` is absent; H04 is
  checked only because the PostgreSQL 18 lane ran and passed in this
  checkpoint.
- Workspace build passed every changed package, then retained the existing
  example-app failure resolving extensionless `../http` from
  `artifactRuntime/RouteBoundary.ts`. Workspace and isolated backend tests
  retained only the three existing delivery-decoder expectation failures for
  the now-decoded `identityFingerprint`; 729 of 732 backend tests passed.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-worker typecheck
corepack pnpm --filter @flarex/executor-worker test
corepack pnpm --filter @flarex/executor-worker check:bundle
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/executor-worker test:service-binding:postgres
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor test
corepack pnpm typecheck
corepack pnpm check:effect-boundaries
corepack pnpm build # existing example-app extensionless-import failure
corepack pnpm test # existing three-test identityFingerprint expectation drift
git diff --check
```

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
