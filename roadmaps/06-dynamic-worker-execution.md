# Dynamic Worker Execution

## Status And Scope

**Status:** Active domain authority with implemented local Miniflare and hosted
Worker Loader execution paths. Production activation remains gated on live
Cloudflare/Hyperdrive/Postgres proof and replacement-generation routing.

This roadmap owns:

- the Flarex-managed execution-artifact runtime contract;
- local Miniflare and hosted Dynamic Worker materialization;
- source-package loading and artifact caching;
- restricted developer execution contexts and syscall transport;
- host-to-artifact and artifact-to-executor authorization;
- retry, abort, nested-call, and materialization lifecycle behavior; and
- the supported/unsupported runtime capability boundary.

It does not own:

- source-package analysis or push activation, covered by
  [`17-deployment-analysis-and-push.md`](./17-deployment-analysis-and-push.md);
- package dependency direction, covered by
  [`16-package-boundaries.md`](./16-package-boundaries.md);
- trusted transaction, OCC, storage-generation, and Postgres semantics, covered
  by [`20-postgres-executor.md`](./20-postgres-executor.md) and the
  [FlarexDB foundation](./flarexdb-foundation/README.md); or
- sync delivery and freshness behavior, covered by
  [`21-cloudflare-freshness-cache.md`](./21-cloudflare-freshness-cache.md).

Developers do not write Dynamic Worker entrypoints. The runtime shell described
here is generated and managed entirely by Flarex.

## Current Sources Of Truth

Use these sources in order when they disagree:

1. [`../AGENTS.md`](../AGENTS.md) and its accepted design precedence;
2. [`../design-notes/flarex-db-accepted-design.md`](../design-notes/flarex-db-accepted-design.md)
   for the hosted Worker -> Dynamic Worker -> private executor -> Postgres
   topology;
3. [`17-deployment-analysis-and-push.md`](./17-deployment-analysis-and-push.md)
   for source-package and active-artifact authority;
4. this roadmap for runtime materialization and sandbox execution;
5. current source, configuration, bundle output, and tests for exact behavior;
   and
6. older roadmap checkpoints only as compatibility/provenance evidence.

Current implementation anchors include:

- [`packages/flarex-backend/src/artifactRuntime/HostKit.ts`](../packages/flarex-backend/src/artifactRuntime/HostKit.ts)
  for shared local/hosted Worker definitions, module validation, environment
  construction, identities, and internal requests;
- [`packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts`](../packages/flarex-backend/src/artifactRuntime/GeneratedWorkerSource.ts)
  for the generated runtime shell and syscall client;
- [`packages/flarex-backend/src/artifactRuntime.ts`](../packages/flarex-backend/src/artifactRuntime.ts)
  and [`artifactRuntime`](../packages/flarex-backend/src/artifactRuntime) for the
  runtime service, cache, route, decoding, and error boundaries;
- [`packages/flarex-backend/src/artifactStore.ts`](../packages/flarex-backend/src/artifactStore.ts)
  for R2 source-package storage;
- [`apps/artifact-runtime/src/worker.ts`](../apps/artifact-runtime/src/worker.ts)
  and [`wrangler.jsonc`](../apps/artifact-runtime/wrangler.jsonc) for the
  deployable hosted adapter;
- [`packages/flarex-dev/src/runtimeMaterializer.ts`](../packages/flarex-dev/src/runtimeMaterializer.ts)
  for local Miniflare materialization;
- [`packages/flarex-dev/src/executionArtifact.ts`](../packages/flarex-dev/src/executionArtifact.ts)
  for the separate local analysis adapter; and
- [`apps/artifact-runtime/test/worker.test.ts`](../apps/artifact-runtime/test/worker.test.ts),
  [`packages/flarex-backend/test/artifactRuntime.test.ts`](../packages/flarex-backend/test/artifactRuntime.test.ts),
  [`packages/flarex-backend/test/hostedRuntimeCore.test.ts`](../packages/flarex-backend/test/hostedRuntimeCore.test.ts),
  and [`packages/flarex-dev/test/runtimeMaterializer.test.ts`](../packages/flarex-dev/test/runtimeMaterializer.test.ts)
  for decisive runtime evidence.

The completed
[`24-shared-artifact-runtime-host-kit.md`](./24-shared-artifact-runtime-host-kit.md)
and [`26-execution-artifact-lifecycle-parity.md`](./26-execution-artifact-lifecycle-parity.md)
are useful closeout evidence, but this file owns the continuing runtime truth.

## Current Architecture

### Hosted Invocation Flow

```text
public backend Worker
  -> resolve active deployment and executionArtifactRef
  -> artifact-runtime service binding with exact ref + execution identity
     and, in the current compatibility mode, possibly the source package
  -> artifact-runtime Worker authenticates request
  -> load exact source package from R2 when payload is ref-only
  -> validate ref/header/source-package agreement
  -> materialize or reuse Dynamic Worker through Worker Loader
  -> authenticated /__flarex_internal/invoke
  -> generated runtime resolves registered function
  -> private FLAREX_EXECUTOR binding
  -> begin trusted invoke session
  -> restricted ctx syscalls stage reads/writes
  -> finish, OCC retry, or abort
```

The accepted hosted configuration uses:

- `ARTIFACTS` for durable R2 source packages;
- `LOADER` for Cloudflare Worker Loader materialization;
- `FLAREX_EXECUTOR` for the private executor service binding;
- `FLAREX_ARTIFACT_RUNTIME_TOKEN` for backend-to-runtime authorization;
- `FLAREX_EXECUTOR_TOKEN` for Dynamic Worker-to-executor authorization;
- optional `FLAREX_INTERNAL_TOKEN` for runtime-to-Dynamic-Worker authorization;
- `postgres` executor transport and a project identity; and
- `globalOutbound: null` on generated Dynamic Workers to deny direct outbound
  network access.

The deployable wrapper fails closed when its runtime capability token, Worker
Loader, executor binding, or configured executor transport is invalid/missing.

### Conditional Facet-Backed Invocation Sessions

The currently implemented hosted path above remains the first-host baseline.
If the post-`C07` journal measurement gate selects Durable Object placement,
the accepted refinement is one server-issued supervisor Durable Object per
top-level query or mutation and one dynamically loaded invocation facet per
attempt fence. Exact class names remain implementation details. It is not one
actor per scope or deployment.

The supervisor loads the same exact content-addressed source package selected
by trusted deployment/session authority. R2 and the active execution artifact
reference remain code authority; neither supervisor nor facet SQLite stores an
independent authoritative package copy. The generated facet shell receives
only a session-scoped executor syscall capability, keeps bounded logical
dependencies/writes and the read-your-writes overlay in its isolated SQLite,
and exposes a platform-owned method that returns a sealed journal/result
envelope after handler completion.

Cloudflare isolates supervisor and facet SQLite. The supervisor therefore
cannot read the journal database directly; it obtains the envelope only by
calling the exact current facet through RPC or `fetch`. It then forwards the
envelope to trusted executor finish. A facet crash during handler execution is
not resumable: the attempt is fenced, its partial journal is discarded, and a
fresh facet reruns deterministic code at a new exact snapshot. Hibernated
sealed state may be read again for finish replay, while authoritative
lost-response recovery still comes from Postgres.

### Local Invocation Flow

```text
active local deployment
  -> deterministic executionArtifactRef
  -> source package from local/R2-shaped store
  -> shared worker definition with local-miniflare profile
  -> Miniflare materialized artifact
  -> /__flarex_internal/invoke or /__flarex_internal/query-session
  -> local backend or PGlite executor HTTP adapter
  -> same session/syscall protocol
```

Local and hosted paths share source-package identity, module validation,
generated runtime code, internal request shape, response decoding, executor
transport protocol, and artifact lifecycle interfaces. They differ only in host
capabilities: Miniflare/backend dispatch locally, Worker Loader/R2/service
bindings in hosted execution.

### Artifact Identity And Loading

An execution artifact reference is deterministically derived from the source
package. The current runtime request contract carries:

- `artifactId`;
- `sourcePackageHash`;
- deployment ID;
- authenticated execution identity;
- function path, arguments, and optional idempotency/partition data; and
- the source package itself or a ref-only request resolved by the runtime store.

The hosted adapter supports both forms. The public backend sends the source
package unless `FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE` is exactly `"true"`; in
that configured ref-only mode, the artifact-runtime Worker loads the exact
package from R2. Runtime route headers must match the payload reference, and the
R2 adapter verifies stored manifest/package identity before returning source.
This is current compatibility behavior, not the optimized production target.

Source-package modules are rejected before Worker Loader materialization if a
module is missing source, duplicates another path, or collides with the reserved
generated runtime module.

### Materialization And Caching

The shared runtime service caches materialized artifacts by `artifactId` plus
`sourcePackageHash`. A repeated exact reference reuses the materialization. If
an artifact ID appears with a different hash, the old artifact is disposed
before replacement.

The current route resolves or receives the complete source package before it
asks that cache for a materialized artifact. Consequently, source-forwarding
mode can serialize the complete package for a cache hit, while ref-only mode
can read and decode R2 before discovering the same hit. The cache therefore
avoids repeated Worker construction but does not yet provide a cache-before-
artifact-load hot path.

The hosted Worker Loader identity additionally includes:

- source artifact ID and hash;
- Dynamic Worker compatibility date;
- executor transport, project, retry configuration, and credential version;
  and
- internal authorization credential version.

This prevents token/configuration rotation from silently reusing a Worker
created with older capabilities. The runtime service itself is cached per
Worker environment. Local materializations expose explicit disposal; hosted
Worker Loader lifecycle remains platform-managed beyond the service cache.

### Generated Runtime Shell

The generated shell imports only the source package's declared execution
module and exposes internal runtime routes. For normal invocation it:

1. authorizes the internal route when an internal token is configured;
2. resolves the requested registered export;
3. accepts only query or mutation execution;
4. derives function kind and visibility from runtime registration metadata;
5. begins an executor-owned session with identity and expected metadata;
6. builds a restricted `ctx` around syscall requests;
7. executes the handler;
8. finishes and returns the trusted result; or
9. best-effort aborts on failure and retries only retryable Postgres mutation
   OCC conflicts.

The default maximum mutation attempt count is eight and may be configured by
the host as a positive integer. Queries and legacy transport do not use the
same mutation OCC retry behavior.

### Developer Capabilities

Implemented query/mutation contexts expose:

- `ctx.auth.getUserIdentity()` from the verified execution identity;
- `ctx.db.get`;
- indexed/table query operations supported by the syscall facade;
- mutation writes including insert, patch, replace, and delete;
- `ctx.runQuery`; and
- `ctx.runMutation` from an outer mutation.

The database facade contains no SQL client, Hyperdrive binding, Durable Object
stub, storage handle, service-binding namespace, or transaction object. All
database effects cross the active session syscall boundary.

Same-artifact nested queries and mutations reuse the outer executor session and
therefore the same atomic transaction/read-write set. Nested mutations from a
query fail. Nested calls are limited to depth eight and cannot target another
artifact/deployment.

### Analysis Is A Separate Runtime Concern

The local analysis adapter also uses Miniflare, but it is not the invoke
materializer. It installs deterministic import-time controls, captures bounded
diagnostics, loads the source modules, and delegates portable semantics to
`@flarex/analysis`.

The hosted artifact-runtime Worker currently materializes invocation workers;
it does not implement the `FLAREX_ANALYZER` service expected by source-only
push. Hosted analysis remains a separate missing capability recorded in
roadmap 17.

## Invariants And Trust Boundaries

1. **Developer code never receives infrastructure authority.** No raw database,
   storage, Worker Loader, R2, service-binding, or Durable Object capability may
   enter `ctx`.
2. **Only active artifacts execute.** The public backend resolves the active
   deployment reference; candidates and abandoned/rejected pushes are not
   invokable.
3. **Reference and package stay joined.** Artifact ID, source hash, headers,
   stored manifest, loaded source package, and materialization identity must
   agree.
4. **Runtime modules are Flarex-owned.** A source package cannot overwrite the
   generated main module or provide duplicate/missing module source.
5. **Outbound access is denied by default.** Hosted Dynamic Workers use
   `globalOutbound: null`; external effects require an explicitly designed
   capability rather than ambient `fetch`.
6. **Backend and executor bindings are private.** Developer modules see only
   generated context methods, never the service binding itself.
7. **Every hop authenticates at its authority boundary.** Public backend to
   artifact runtime and Dynamic Worker to executor require explicit capability
   configuration in hosted production. Runtime to Dynamic Worker should use an
   internal token and versioned identity.
8. **Identity is preserved, not re-authenticated by user code.** Verified
   execution identity flows through payload, executor start, session, and
   `ctx.auth` without trusting caller-defined identity fields.
9. **Transactions belong to the executor.** The artifact runs untrusted code
   outside any open Postgres transaction and accesses session state only by
   explicit syscalls.
10. **Abort is mandatory on failed attempts.** Handler, validation, transport,
    and finish failures trigger best-effort abort before retry or propagation.
11. **Retries are bounded and typed.** Only recognized retryable mutation/OCC
    conflicts retry; arbitrary user or transport failures do not.
12. **Nested calls stay in the outer session.** They do not start independent
    transactions or hide cross-artifact work.
13. **Host profiles may differ only at adapters.** Local and hosted runtimes
    cannot fork developer semantics, syscall contracts, identity, or artifact
    derivation.
14. **Malformed responses fail closed.** Runtime, Dynamic Worker, and executor
    success bodies pass protocol decoders before use.
15. **Legacy execution is removable prototype code.** ExecutionDO/PartitionDO
    and the `legacy` transport cannot become the target authority because their
    code is already integrated. Port intended semantics, move callers, and then
    delete the path; do not add features or treat it as a shipped contract.
16. **Facet placement remains per session and per attempt.** A session actor
    cannot serialize an entire scope, and a retry cannot reuse the prior
    attempt's facet identity or private state.
17. **Facet storage is journal storage, not code or commit authority.** The
    content-addressed artifact store remains authoritative for code, and the
    trusted executor/Postgres remain authoritative for outcomes and commits.

## Decisions And Rationale

### Generate A Managed Runtime Shell

Cloudflare Workers cannot safely evaluate arbitrary uploaded code with
`eval()` or `new Function()`. Flarex assembles verified portable JavaScript
module source with a generated main module and passes those modules to Worker
Loader or Miniflare. Worker Loader owns engine-specific parsing, compilation,
and isolate materialization inside Cloudflare. Flarex does not create, trust,
transport, or persist caller-supplied V8 bytecode, Cloudflare bytecode, or
isolate state; none is portable Flarex artifact identity. This keeps the
developer experience module-based while making the sandbox and capabilities
platform-controlled.

### Keep The Artifact Runtime Separate From The Trusted Executor

The Dynamic Worker owns untrusted handler execution; the executor owns session,
OCC, persistence, and commit authority. Separating them prevents user code from
sharing a process-level database capability and lets the executor validate
function kind, visibility, arguments, identity, and results independently.

### Use Ref-Only Hosted Invocation

The hosted artifact-runtime owns R2 loading so source packages are not copied
through every backend invocation. The active reference remains small and
content-bound, while R2 verification and materialization remain behind a
private capability. The production form of this decision is stricter than the
current compatibility switch:

- the backend sends only the active runtime-projection reference, invocation,
  and execution identity;
- the artifact runtime checks its exact materialization-identity cache before
  any R2 read or deployment-artifact reconstruction;
- one process-local singleflight owns a cold load/materialization for a given
  materialization identity, while concurrent callers await that result;
- a miss loads only the immutable runtime projection, not the canonical
  deployment package; and
- a warm hit performs no Source Artifact, Semantic Artifact, canonical package,
  or R2 read.

That materialization identity includes the projection digest, compatibility
date, generated runtime-shell identity, executor transport/configuration, and
authorization credential versions. Correctness never depends on a process
cache, singleflight, Worker Loader reuse, or a warm isolate. Cache loss must
reconstruct the same runtime projection from the active immutable reference and
current host-owned materialization configuration. Platform cache loss or isolate
eviction may therefore repeat Worker Loader compilation from the same immutable
runtime projection.

### Share Host Construction Without Hiding Differences

The host kit shares module maps, generated runtime code, environment mapping,
identities, and requests. Local Miniflare still owns query-session support and
explicit disposal; hosted Worker Loader owns platform materialization and
egress denial. These differences are named profiles rather than conditionals
spread across duplicated generated shells.

### Reuse Sessions For Same-Artifact Nested Calls

Convex-style nested `runQuery`/`runMutation` should participate in the caller's
transaction. In-artifact dispatch reuses the outer session, preserves atomicity,
and avoids a second commit boundary. Cross-artifact calls require a future
host/executor protocol and are not simulated as local calls.

## Convex Compatibility And Flarex Divergences

Flarex follows Convex's core execution model:

- user functions run in an isolated environment;
- the runtime exposes restricted syscalls rather than storage handles;
- backend-owned metadata controls function existence, kind, visibility, and
  validation;
- reads/writes are collected under one trusted transaction/session;
- failed execution aborts without publishing staged writes; and
- nested query/mutation calls participate in the outer function transaction.

Primary Convex reference areas:

- `crates/isolate/src/environment/udf/syscall.rs` for syscall isolation;
- `crates/function_runner/src/lib.rs` and `server.rs` for execution, reads,
  writes, and runner interfaces;
- `crates/application/src/application_function_runner/mod.rs` for application
  metadata resolution and transaction integration;
- `crates/model/src/source_packages` for durable package identity/loading; and
- `npm-packages/convex/src/server` for function contexts and nested calls.

Named Flarex divergences:

- Cloudflare Worker Loader and Dynamic Workers replace Convex's owned Rust/V8
  isolate runner;
- R2 stores source packages and service bindings split runtime from executor;
- PGlite/Miniflare provide the local parity lane;
- `workflowMutation` exists in registration metadata but is not executable by
  the current artifact invoke route;
- hosted outbound networking is disabled with `globalOutbound: null`; and
- current prototype routes can use legacy ExecutionDO/PartitionDO transport
  while the accepted production target is the private Postgres executor Worker;
  those routes are removal inputs, not a long-term compatibility promise.

These are adapter/runtime differences, not permission to weaken function
metadata validation, session atomicity, or least-authority contexts.

## Implemented Capabilities

- Shared host-kit construction for local Miniflare and hosted Dynamic Workers.
- Deterministic artifact references, R2 storage validation, and ref-only hosted
  loading.
- Deployable artifact-runtime Worker with Worker Loader, R2, private executor
  binding, required outer capability token, and disabled global outbound.
- Cache reuse by artifact/hash and rematerialization on hash/config/auth identity
  changes.
- Internal invoke authorization when configured and exact artifact header
  validation at the runtime boundary.
- Query/mutation execution through legacy or Postgres session protocols.
- Developer `ctx.auth`, syscall-backed `ctx.db`, same-artifact `runQuery`, and
  mutation-only `runMutation`.
- Argument/kind/visibility enforcement across runtime and executor boundaries,
  with return validation before commit.
- Postgres mutation OCC retries, exhaustion reporting, and abort on failed
  attempts.
- Local query-session execution for live-query reruns without creating a new
  top-level session.
- Local materialization disposal and shared runtime cache disposal APIs.
- Tests covering Worker Loader materialization, R2 loading, cache identity,
  token failures, missing bindings, malformed responses, module collisions,
  query/mutation syscalls, nested calls, OCC retry/abort, identity, and
  local/hosted payload parity.

## Known Gaps And Limitations

- The Worker Loader/R2/executor implementation is covered by unit/Miniflare and
  dry-run evidence, but the accepted live hosted proof with real Cloudflare,
  cache-disabled Hyperdrive, and real Postgres is not complete. Production
  replacement-generation routing remains gated.
- The deployable hosted artifact runtime does not implement source-package
  analysis. The configured `flarex-analyzer` service has no deployable owner in
  this workspace.
- `FLAREX_INTERNAL_TOKEN` is optional. The outer artifact-runtime token is
  required, but the inner runtime-to-Dynamic-Worker route becomes permissive
  when no internal token is configured. Hosted production should require and
  rotate it rather than relying only on Worker Loader reachability.
- The Dynamic Worker receives the executor capability as an environment value.
  Credential version changes affect Worker identity, but revocation, overlap,
  rotation procedures, and per-artifact/per-session attenuation are not fully
  implemented.
- Hosted code accepts an absent executor transport and then uses the legacy
  default. Wrangler config chooses `postgres`, but production should fail closed
  against accidental legacy fallback before target activation.
- Queries and mutations are executable; actions and `workflowMutation` are not.
  `ctx.runAction`, cross-artifact nested calls, and separately hosted action
  environments are absent.
- Hosted materialization does not expose the local query-session route, so
  hosted live-query rerun execution lacks the same artifact-host capability.
- Inner generated routes carry artifact headers but do not independently
  compare them to runtime identity; the outer artifact-runtime validates the
  reference before selecting/materializing the Worker.
- Cache size has no explicit application-level eviction policy. Worker instance
  lifetime and Worker Loader behavior bound it operationally, but high artifact
  churn needs measurement and deliberate reclamation/GC.
- The current request/cache ordering is not a true warm-path cache: source-
  forwarding mode may serialize the complete source package on every invoke,
  and ref-only mode resolves R2 source before checking the materialization
  cache. There is no per-reference singleflight for concurrent cold misses.
- Current Worker definitions copy every source-package module in addition to
  the generated runtime shell. Analysis-only modules, schema/auth inputs,
  source maps, and duplicated execution material are not yet excluded through
  a verified minimal runtime projection. This inflates transfer,
  materialization, compilation, and cold-start work.
- R2 source-package garbage collection for abandoned, superseded, or unreferenced
  artifacts is not implemented as a proven hosted policy.
- The conditional facet-backed invocation path is not implemented or measured.
  A prototype must compare a narrow session-scoped Dynamic Worker binding with
  the supervisor/facet path, prove exact artifact and attempt pinning, avoid a
  reentrant callback from a facet into its currently awaiting supervisor, and
  cover hibernation, eviction, cleanup, retries, and lost responses before
  `C07A` may select it.
- Runtime errors are normalized for protocol safety, but hosted source-map stack
  remapping, structured logs, CPU/subrequest accounting, and operational
  correlation remain incomplete.
- Legacy partition keys and transport fields remain in prototype request
  shapes; preserve only still-intended developer semantics, then remove their
  physical routing role. They are not accepted public routing authority.

## Target Direction

Keep the production path narrow and explicit:

```text
active Postgres-backed deployment/package generation
  -> exact active runtime-projection manifest and group reference
  -> authenticated artifact-runtime Worker
  -> cache by exact materialization identity before artifact loading
  -> on miss only: singleflight verified R2 runtime-projection load
  -> identity/version-keyed Dynamic Worker baseline
     or a separately measured per-session supervisor + per-attempt facet
  -> mandatory authenticated internal invoke
  -> egress-denied developer runtime
  -> private authenticated executor binding
  -> exact-snapshot session and atomic Postgres commit
```

The required steady-state warm path is:

```text
coherent active-manifest read
  -> reference-only artifact-runtime request
  -> exact-materialization-identity Worker cache hit
  -> cached WorkerStub invoke
  -> executor session
```

It contains no source-package transfer, R2 artifact read, Source Artifact V2
read, Semantic Artifact V1 read, semantic decode, Worker definition rebuild, or
Worker Loader callback. The required cold path loads one minimal immutable
runtime projection, verifies its digest and active-manifest pins, and
materializes it once for concurrent callers. Deployment-time cold
materialization and startup within policy proves readiness. It does not promise
a later regional cache hit, persistent isolate, or globally prewarmed
deployment.

Local Miniflare should remain a fast conformance adapter for the same source,
context, syscall, identity, retry, and response contracts. Legacy
ExecutionDO/PartitionDO execution may remain only until the accepted target,
local/test callers, and target-only recovery pass their declared gates. Then
remove its routes, bindings, and storage without comparison/rollback machinery
unless shipped-state evidence appears.

The completed `runtime-topology-probe` remains experimental evidence for the
accepted placement and Postgres boundaries; it is not a production component
or a second runtime to maintain. The replacement acceptance test must compose
the actual backend, readiness-selected immutable runtime projection,
artifact-runtime Worker Loader/Dynamic Worker, private executor binding, and
real Postgres authority. It may reuse probe assertions and failure scenarios,
but not probe-owned commit, metadata, routing, or storage implementations.
Declarative V2 supplies deployment/runtime selection only and does not create
an OCC or committer variant. A green real-system proof leads to a separate
replacement-only cutover decision with no dual write or silent legacy fallback.

## Next Correctness Gates

1. **Complete the live hosted proof.** Demonstrate ref-only R2 loading, Worker
   Loader materialization, mandatory runtime/executor credentials, denied
   outbound access, request cleanup, cache-disabled Hyperdrive, and real
   Postgres query/mutation/OCC behavior with redacted durable evidence.
2. **Require the production Postgres capability set.** Reject missing/legacy
   hosted transport, missing internal Dynamic Worker token, missing executor
   token, or unversioned rotation configuration in the production profile while
   preserving explicit local prototype modes only until their callers move.
3. **Connect production generation routing.** Resolve the accepted active
   storage generation/fence and package artifact before invocation; fail closed
   rather than falling back to a prototype engine. Use bounded source/deployment
   activation rollback, not a dual-storage comparison gate.
4. **Optimize the execution-artifact handoff before Declarative V2 cutover.**
   Define the immutable minimal runtime-projection and function-to-group
   manifest owned by roadmap 17; make hosted invocation reference-only; check
   the full materialization-identity cache before R2 loading; singleflight
   concurrent misses under that same identity;
   exclude analysis, semantic, schema/auth, source-map, provenance, and rollback
   material unless it is a proven transitive runtime dependency; and pin
   cache-hit, cache-miss, allocation, failure, cancellation, and retry behavior
   with focused tests. Benchmark warm and cold P50/P95/P99 separately, including
   backend-to-runtime dispatch, R2 load, definition construction, Worker Loader
   callback, isolate initialization, handler time, executor transport, and
   Postgres time. Compare current full-package forwarding, current ref-only
   loading, and the optimized projection path before considering service
   collapse or Workers RPC.
5. **Provide the hosted analysis runtime.** Reuse the managed source-package
   isolate boundary with analysis-specific globals, no executor binding, bounded
   diagnostics/time, and separate cold-isolate determinism proof.
6. **Close runtime capability gaps deliberately.** Specify and test actions,
   workflow mutations, hosted live-query query sessions, and cross-artifact
   nested calls before exposing them; keep unsupported capabilities fail-closed.
7. **Add lifecycle and operability controls.** Define cache limits/eviction,
   R2 artifact retention and GC, token rotation/revocation, structured error
   correlation, and source-mapped hosted diagnostics.
8. **Run the first real-system application acceptance proof.** Compose the
   completed metadata/readiness, `C07`, redelivery, and `C06-B` gates through
   the production backend, artifact runtime, Dynamic Worker, executor, and
   Postgres packages. Prove success, existing OCC rerun, lost-response replay,
   restart/redelivery, and terminal cleanup without importing a probe-owned
   runtime path. Only then propose removal of the old application and analyzer
   paths as one explicit cutover.
