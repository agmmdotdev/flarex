# Test SDK

## Status And Scope

**Status:** Active domain authority with an implemented asynchronous
`flarexTest()` harness backed by the real local Miniflare runtime. Typed query,
mutation, raw invocation, client/WebSocket, fetch, reload, reset, and disposal
are implemented. The exposed `action()` method is not executable end to end,
the default execution mode is still legacy, and identity/scheduler/trusted
test-transaction helpers are absent.

This roadmap owns:

- the public `flarex-test` harness API and TypeScript contract;
- harness lifecycle, reset, disposal, and failure-state behavior;
- mapping generated function references into local runtime calls;
- the browser-shaped WebSocket adapter and `FlarexClient` construction;
- temporary test-harness execution-mode selection while replacement callers
  are moved, plus removal of the prototype mode; and
- the boundary between ergonomic helpers and privileged test authority.

It does not own:

- the workspace-internal Standard Application APIs, covered by
  [`42-standard-application-apis.md`](./42-standard-application-apis.md);
- the internal corpus, workload policy, or private real-system harness,
  covered by
  [`41-private-standard-application-composition-and-real-system-harness.md`](./41-private-standard-application-composition-and-real-system-harness.md);
- local runtime composition or persistence implementation, covered by
  [`14-local-dev-server.md`](./14-local-dev-server.md);
- repository-wide evidence lanes, covered by
  [`11-testing-and-simulation-strategy.md`](./11-testing-and-simulation-strategy.md);
- SDK client/sync semantics or package distribution, covered by
  [`09-sdk-and-cli-fork.md`](./09-sdk-and-cli-fork.md);
- trusted executor, transaction, OCC, or storage-generation behavior, covered
  by [`20-postgres-executor.md`](./20-postgres-executor.md) and the
  [FlarexDB foundation](./flarexdb-foundation/README.md);
- portable query-sync/delivery semantics, covered by
  [`query-sync-engine/`](./query-sync-engine/README.md), and concrete Flarex
  Postgres/Cloudflare composition, covered by
  [`21-cloudflare-freshness-cache.md`](./21-cloudflare-freshness-cache.md); or
- action and scheduler runtime implementation, which must exist in their owning
  domains before the test SDK can claim them.

The test SDK is a convenience boundary over production domain paths. It must
not become a second backend, transaction engine, sync implementation, or raw
database escape hatch.

Valid private simulations should use the Standard-compatible typed validator,
function-contract, module, and function-reference values owned by roadmap 42.
Raw `unknown` arguments remain available only through a visibly unsafe
negative-test boundary. The later public test SDK may wrap those primitives but
must not fork their wire lowering or runtime validation semantics.

## Current Sources Of Truth

Use these authorities in order when they disagree:

1. [`../AGENTS.md`](../AGENTS.md) for Postgres authority, Convex-first design,
   least authority, and roadmap precedence;
2. accepted design and active domain roadmaps for the semantics exercised by
   the harness;
3. this roadmap for public test-harness behavior and direction;
4. current source and decisive consumer tests for exact implementation; and
5. older checkpoint text and Git only as provenance.

Current implementation anchors are:

- [`packages/flarex-test/src/index.ts`](../packages/flarex-test/src/index.ts)
  for the complete public harness implementation;
- [`packages/flarex-test/package.json`](../packages/flarex-test/package.json)
  for its source-only package/export boundary;
- [`packages/flarex-dev/src/dev.ts`](../packages/flarex-dev/src/dev.ts) for the
  real local runtime the harness owns and recreates;
- [`packages/flarex/src/client.ts`](../packages/flarex/src/client.ts) and
  [`packages/flarex/src/sync/baseClient.ts`](../packages/flarex/src/sync/baseClient.ts)
  for client and WebSocket contracts;
- [`apps/example/flarex/invoke-e2e.test.ts`](../apps/example/flarex/invoke-e2e.test.ts)
  for generated-reference invocation, raw results, validation, reset, and
  lifecycle serialization;
- [`apps/example/flarex/sync-e2e.test.ts`](../apps/example/flarex/sync-e2e.test.ts)
  for legacy and Postgres live-query behavior through the public client; and
- [`integration/fresh-consumer-pack.integration.test.ts`](../integration/fresh-consumer-pack.integration.test.ts)
  for installed-tarball query, mutation, invoke, reset, and legacy/Postgres
  subscription evidence.

The `flarex-test` package currently has no package-local test files; its test
script uses `--passWithNoTests`. Consumer and integration tests are therefore
the decisive runtime evidence today.

## Current Architecture

### Harness Construction

`flarexTest(options)` is asynchronous because it creates the same generated,
backend, artifact, and optional executor runtimes used by local development.

Supported options are a narrow subset of `FlarexDevRuntimeOptions`:

```ts
type FlarexTestOptions = {
  root?: string;
  appDir?: string;
  generatedDir?: string;
  deploymentId?: string;
  executorTransport?: "legacy" | "postgres";
  persistDir?: string | false;
};
```

The harness defaults `root` to `process.cwd()` and forces `persistDir: false`
unless the caller supplies an explicit path. It forwards no raw persistence,
executor, backend, Miniflare, token, clock, ID, or service-binding handles.

Omitting `executorTransport` inherits the local runtime's current `legacy`
default. `postgres` selects the PGlite-backed trusted executor host, but that
host currently registers only the initial `legacy_v1` app-data engine; it does
not select `flarexdb_v1`. This option is a temporary internal replacement seam,
not a supported data-compatibility contract and not permission for tests to
define two different application semantics.

### Public API

The implemented surface is:

| Member | Current behavior |
| --- | --- |
| `query(reference, args, options?)` | Invokes a typed query through `/__flarex_dev/invoke` and returns its `value` |
| `mutation(reference, args, options?)` | Invokes a typed mutation through the same backend-owned artifact path |
| `action(reference, args, options?)` | Present in types and forwards like an invoke, but actions are not implemented end to end |
| `invokeRaw(reference, args, options?)` | Returns the local invoke envelope including optional value/read set/commit timestamp/writes |
| `client()` | Creates a new public `FlarexClient` using the harness WebSocket constructor |
| `webSocketConstructor` | Browser-shaped constructor backed by programmatic Miniflare WebSocket upgrade responses |
| `fetch(path, init?)` | Prefixes non-dev paths with `/__flarex_dev` and dispatches through the runtime |
| `reload()` | Serializes a local runtime reload with lifecycle operations |
| `reset()` | Disposes, safely removes explicit test persistence when configured, and creates a fresh runtime |
| `dispose()` | Serializes shutdown and is idempotent after successful disposal |

Invocation options currently support `partitionKey` and `idempotencyKey`.
Generated function metadata can infer partition keys through
`resolvePartitionKey`; an explicit mismatch is rejected by the runtime rather
than trusted by the harness.

`invokeRaw` is intentionally an integration/debugging API. Its `readSet`,
`writes`, and other envelope fields are `unknown` or optional because the
public function return type does not own executor-internal receipt shapes.

### Invocation And Error Boundary

The harness derives the function path from the generated reference, resolves
the partition key, serializes arguments and optional idempotency key, and sends
a JSON request to the dev invoke route:

```text
typed generated reference
  -> flarex-test invoke request
  -> local backend active deployment
  -> active source-package artifact
  -> generated managed runtime
  -> restricted executor/session protocol
  -> legacy prototype or initial PGlite/Postgres prototype authority
```

Non-success responses become `FlarexTestInvocationError` with the HTTP status
and decoded response body. Successful envelopes are currently trusted through
a TypeScript assertion after JSON parsing; there is no runtime decoder for the
test result envelope.

Static query/mutation/action signatures restrict normal calls to matching
reference kinds, but `invokeRaw` accepts any function reference. Runtime
metadata and validators remain authoritative for kind, visibility, arguments,
returns, partition policy, and execution support.

### Client And WebSocket Bridge

`client()` creates a normal `FlarexClient` pointed at
`http://flarex.test/__flarex_dev`. Its injected WebSocket constructor converts
`ws:`/`wss:` to an HTTP request carrying `Upgrade: websocket`, obtains the
Miniflare `101` response, accepts the returned socket, and maps open/message/
error/close events into the browser-shaped interface expected by the SDK.

This proves the programmatic backend sync path. It does not traverse Vite's
Node HTTP upgrade handling or a real browser/network stack.

Each `client()` call creates an independently owned client. The harness does
not track or close those clients during `reset()` or `dispose()`; callers must
unsubscribe and call `client.close()` themselves.

### Lifecycle State Machine

Lifecycle-changing operations share one promise chain:

```text
active
  -> reload -> active or last-good runtime
  -> reset -> dispose old -> clear explicit persistence -> create new -> active
  -> dispose -> disposed

reset failure -> failed -> dispose may still clean remaining runtime
```

Calls after disposal fail, except repeated `dispose()` which succeeds. A reset
failure marks the harness unusable and preserves the original cause. Concurrent
reset/dispose/reload requests are ordered by the lifecycle chain instead of
racing runtime ownership.

With default in-memory persistence, reset gets isolation by disposing and
recreating the complete runtime. With an explicit persistent path, deletion is
allowed only through the local runtime's safe reset-path policy beneath the
application's `.flarex/` directory.

## Invariants And Trust Boundaries

1. **The harness reuses the real runtime.** Query, mutation, sync, validation,
   artifact, executor, and persistence semantics cannot be reimplemented in
   `flarex-test`.
2. **Accepted FlarexDB semantics are the forward authority.** Legacy mode and
   the initial Postgres engine are prototype evidence. Neither may define new
   test SDK behavior merely because it is currently executable.
3. **Generated references are the normal API.** Function paths, arguments,
   return types, visibility, and partition inference follow the SDK/codegen
   contracts rather than untyped string helpers.
4. **Runtime validation remains authoritative.** TypeScript convenience cannot
   bypass deployed metadata, validators, identity, visibility, or executor
   checks.
5. **No raw storage handles.** Test code cannot receive PGlite, Postgres,
   Drizzle, Durable Object storage, executor persistence, or transaction
   handles from the public harness.
6. **Privileged helpers need an explicit trusted boundary.** A future
   Convex-style `run(fn)` must use an executor-owned test transaction/context,
   not direct persistence access or a parallel in-memory database.
7. **Lifecycle operations are serialized.** Reset, reload, and disposal cannot
   concurrently own or delete the same runtime resources.
8. **Reset is scope-safe.** Filesystem deletion is disabled by default and,
   when explicit, is constrained beneath the app's `.flarex/` directory.
9. **Resource ownership is explicit.** The harness owns its runtime; clients,
   subscriptions, and sockets must either be caller-owned or tracked and
   disposed by a future harness contract, never leaked ambiguously.
10. **Unsupported capabilities fail honestly.** A typed method cannot imply
    action, scheduler, identity, storage, or hosted behavior that the current
    runtime cannot execute.
11. **Test-only identity cannot weaken hosted auth.** Identity helpers must
    enter through an explicit trusted dev/test resolver and remain unavailable
    on public hosted routes without the matching capability.
12. **Installed consumers matter.** Workspace typechecks and example tests do
    not replace tarball/fresh-consumer evidence for this published package.

## Decisions And Rationale

### Copy Convex Ergonomics, Not Its Mock Engine

Convex's `convex-test` offers a compact typed harness with query, mutation,
action, fetch, identity, controlled data access, and scheduler helpers. That is
the right developer mental model.

Flarex should not make a pure JavaScript mock its primary test engine. A mock
would hide the platform boundaries most likely to drift: source-package
analysis, managed Worker execution, service-binding syscalls, backend-owned
sessions, Postgres authority, and Cloudflare-shaped sync. Fast pure/model tests
still belong below the harness as described by roadmap 11.

### Keep The Harness Thin

`flarex-test` delegates runtime construction to `flarex-dev` and client behavior
to `flarex`. This makes the package an ergonomic owner/lifecycle adapter rather
than a semantic implementation. New helpers should continue to route through
owned domain interfaces.

### Standard APIs And The Private Harness Come First

The shared definition, analysis, registration, and invocation stage APIs are
owned by
[`42-standard-application-apis.md`](./42-standard-application-apis.md).
The internal corpus, deterministic workload policy, and private real-system
harness are separately owned by
[`41-private-standard-application-composition-and-real-system-harness.md`](./41-private-standard-application-composition-and-real-system-harness.md).
Both layers exist below this public ergonomic boundary and must prove the
replacement application path before `flarex-test` adopts it.

Roadmap 41's `SAC01-F1` now supplies the first such lower-layer PGlite proof: a
private test-owned Effect operation drives one relation-free cooking revision
through definition, analysis, registration, readiness, activation, point
mutation, exact replay, and point-query readback. `SAC01-G` now places that
operation in private `@flarex/system-test`, a development/test dependency leaf
with intentional versioned subpaths and no production consumers. It is not a
`flarex-test` export, public package-adoption decision,
generic fixture API, controlled database escape hatch, or deterministic model
simulator. Its matching genuine-PostgreSQL lane remains an explicit acceptance
gate rather than an inferred property of the PGlite result.

`SAC01-F2a` now factors that exact lifecycle/invocation composition into one
test-owned runner and proves the same relation-free public mutation/query
surface with independent cooking and English-learning definitions. The runner
now lives in `@flarex/system-test`; every application is authored through the
private `defineStandardApplicationSimulationV1` config, while the database lane
remains an explicit runner input rather than application configuration. This is
not a public or serializable workload language. It does not authorize `flarex-test`
adoption, identity, actions, scheduling, or a deterministic model simulator.
Its two genuine-PostgreSQL cases remain explicit open acceptance evidence.

`SAC01-F2b` adds lower-layer controlled setup and inspection without adopting a
public Test SDK. Setup is mutation-only and delegates to the existing Standard
point-mutation owner. Inspection is an immutable, scope-filtered logical
receipt over authoritative row identities and commit/feed/outbox/runtime
evidence; it exposes no SQL, database handle, transaction capability, physical
locator, or document value. Callers continue to read document values through
the Standard query API. Separate managed setup and workload scopes prevent
escaped capabilities or detached invocations from surviving their phase. This
closes the first lower-layer setup/inspection prerequisite while leaving SDK
ergonomics, serializable scenarios, model scheduling, identity, and public
adoption separately gated.

Roadmap 41's completed `SAC01-P` preflight accepts a first pure definition and
corpus seed local to backend tests only. That test fixture is not a stable
package API, live harness, or adoption surface for `flarex-test`.

`flarex-test` must not become the first owner of canonical schema, function,
trigger, artifact, analyzer, registration, runtime, executor, or workload
semantics. It may later adapt generated references and developer-friendly
options into stable Standard contracts and private harness capabilities after
those lower layers exist.
Unsupported capabilities stay absent from the public type surface; a public
method must not be added merely because the canonical definition can describe
that function kind.

Durable Tasks follow the same rule. Roadmap 42's `SAP08-A` must first establish
the shared private Standard Task reference and run-creation/replay contract,
and roadmap 41's `SAC01-F2t` must then prove the unified internal system-test
producer over DTE06-F2 fresh-host recovery. Only after those gates and the
public developer Task-reference contract exist may `flarex-test` consider a
Task helper. The public test surface must not expose harness fault injection,
delivery controls, lifecycle stores, attempt fences, provider handles, R2
bindings, database locators, or scheduler authority, and the current
specialized Task harness is not a public compatibility commitment.

The private real-system harness is also not a reusable implementation hidden
inside `flarex-test`. Package dependency points from `flarex-test` toward
approved stable private or production-domain APIs only after a separate
adoption preflight. Production packages and the private composition root never
depend on `flarex-test`.

### Prefer Fresh Runtime Isolation Before Snapshot Tricks

Disposing and recreating the local runtime is slower than clearing a mock map,
but it exercises real startup, push, schema, artifact, executor, and sync
boundaries. Snapshot/restore or seeded fixtures should be added only through a
versioned executor-owned test facility with clear schema/generation semantics.

### Do Not Port `run(fn)` As Raw Database Access

Convex's mock can safely provide a mock database context directly. Flarex's
accepted architecture forbids exposing database authority to user code. The
portable API goal is controlled test setup/inspection, not the mock's physical
implementation. The accepted private lower-layer seam performs setup through
the existing Standard mutation owner and reads scope-filtered logical evidence
without granting a transaction or physical database capability. A future
public helper may adapt that seam only after its own API gate; it must preserve
validation, scope, generation, and commit rules.

## Convex Compatibility And Flarex Divergences

Portable Convex references include:

- [`../../../npm-packages/docs/docs/testing/convex-test.mdx`](../../../npm-packages/docs/docs/testing/convex-test.mdx)
  for `convexTest`, typed function calls, `run`, inline helpers, fetch,
  scheduling, and `withIdentity` ergonomics;
- [`../../../npm-packages/convex/src/browser/sync/client_node_test_helpers.ts`](../../../npm-packages/convex/src/browser/sync/client_node_test_helpers.ts)
  for injecting a browser-shaped WebSocket into Node tests; and
- [`../../../npm-packages/convex/custom-vitest-environment.ts`](../../../npm-packages/convex/custom-vitest-environment.ts)
  for test-environment integration around the client surface.

Named Flarex divergences are:

- `flarexTest()` is asynchronous and starts real local runtime components;
- Miniflare Workers, service bindings, artifacts, sync actors, and PGlite are
  exercised instead of one pure JavaScript mock backend;
- the replacement effort currently exposes explicit legacy/Postgres prototype
  mode selection;
- WebSockets are bridged directly to the programmatic Miniflare runtime rather
  than a standalone Node `ws` server;
- safe reset recreates runtime state instead of clearing a mock database; and
- direct data/scheduler/identity helpers remain unavailable until their trusted
  runtime boundaries exist.

These differences justify adapter behavior, not weaker validation, transaction,
identity, or generated-reference semantics.

## Implemented Capabilities

- Source-only `flarex-test` package with one public export and only `flarex`
  plus `flarex-dev` runtime dependencies.
- Asynchronous real-runtime construction with in-memory isolation by default.
- Typed generated-reference query and mutation helpers.
- Raw invoke envelopes, typed invocation errors, partition inference/override,
  and idempotency-key forwarding.
- Raw dev/runtime fetch for HTTP and negative integration cases.
- Browser-shaped WebSocket constructor and ordinary `FlarexClient` creation.
- Legacy and opt-in PGlite/Postgres live-query subscriptions through generated
  APIs, including mutation-response then query-transition ordering.
- Serialized reload, full reset/recreation, failed-state protection, and
  idempotent successful disposal.
- Safe explicit persistence deletion beneath `.flarex/`.
- Example-app evidence for validation, partition mismatch, reset, lifecycle,
  invoke receipt, and sync behavior.
- Packed fresh-consumer evidence for installation, runtime import, query,
  mutation, invoke, reset, and legacy/Postgres subscription behavior.

## Known Gaps And Limitations

- `action()` is exposed as if supported but the managed runtime does not execute
  actions end to end. This is misleading public surface area.
- The harness defaults to legacy Durable Object execution instead of the
  accepted PGlite/Postgres path.
- There are no `withIdentity`, bearer-auth, trusted test identity, role/claim,
  or anonymous/authenticated variant helpers.
- There is no public `flarex-test` `run`, inline query/mutation/action, seed,
  fixture, snapshot, or authoritative state-inspection API. The private F2b
  harness capability is deliberately narrower and remains test-owner local.
- Scheduler controls, fake time, pending-job inspection, and finish-in-progress/
  finish-all helpers are absent because scheduler semantics are incomplete.
- `client()` resources are not tracked by the harness. Reset/dispose can leave
  caller-forgotten clients, subscriptions, or sockets alive against an old
  runtime.
- Successful raw invoke envelopes are asserted rather than decoded at runtime;
  malformed success payloads can be trusted until consumer code fails later.
- `FlarexTestRawResult` exposes loosely typed internal receipt fields without a
  stable protocol-owned receipt contract.
- The harness cannot inject deterministic clock/IDs, persistence fixtures,
  executor hooks, failure points, or a real-Postgres adapter.
- Generated-output typecheck policy is not exposed through `FlarexTestOptions`.
- `fetch()` is intentionally broad and can reach dev inspection/compatibility
  routes; there is no narrower typed HTTP-action surface because HTTP actions
  are not implemented.
- Reset always reconstructs the full runtime and source push. There is no cheap
  per-test transaction rollback or schema-versioned snapshot restore.
- Package-local tests are absent; `flarex-test test` succeeds with no tests, so
  lifecycle and public API regressions depend on example/integration consumers.
- The WebSocket bridge does not exercise Vite's HTTP upgrade path, browser
  implementations, reconnect/network loss, auth refresh, or hosted delivery.
- Source packages ship TypeScript rather than compiled JS/declarations; registry
  publication, semver compatibility, and version-skew behavior remain unproven.
- Legacy partition routing remains visible in options while target callers are
  incomplete; it is not a supported persistence contract and must be removed
  after target-only harness proof.

## Target Direction

The target remains a compact Convex-shaped harness over the accepted Flarex
runtime:

```text
generated API reference + test identity/fixture intent
  -> flarex-test ergonomic/lifecycle boundary
  -> proven Standard Application definition and invocation APIs
  -> private real-system harness composition
  -> backend-controlled active source package and analysis
  -> managed Miniflare user-code artifact
  -> trusted PGlite executor transaction
  -> backend-owned WebSocket sync and observable result
```

The ordinary path should default to accepted FlarexDB semantics over PGlite,
isolate each test
without leaking resources, and make unsupported capabilities absent from the
type surface. Faster model/pure tests and slower real-Postgres/hosted proofs are
separate evidence lanes, not alternate test SDK semantics.

## Next Correctness Gates

1. **Keep the replacement dependency direction explicit.** Do not design new
   public schema, query, mutation, action, internal-function, scheduling, seed,
   or snapshot ergonomics ahead of roadmap 42's corresponding Standard
   capability and roadmap 41's corresponding private harness capability.
   Existing public compatibility corrections may continue without widening
   that replacement surface.
2. **Make the public surface truthful.** Remove or explicitly experimentalize
   `action()` until actions execute end to end; add runtime decoding for success
   envelopes and negative tests for kind/visibility/malformed responses.
3. **Default to the accepted runtime and remove the prototype selector.** Make
   the FlarexDB PGlite/Postgres composition the ordinary harness path after
   target-only local gates pass, port intended generated-reference semantics,
   and delete legacy mode rather than retaining an explicit opt-in.
4. **Create package-local contract tests.** Cover option forwarding, query/
   mutation/raw errors, lifecycle ordering, reset failure, disposal, safe paths,
   client ownership, and unsupported operations directly in `flarex-test`.
5. **Own client resources.** Track clients/sockets created by the harness or
   return an explicit child-resource scope; close them deterministically before
   reset and disposal and prove no stale client can target a replaced runtime.
6. **Add identity ergonomics through a trusted seam.** Implement Convex-shaped
   identity variants only through the backend's explicit dev/test identity
   resolver and test anonymous, valid, malformed, expired, and unauthorized
   cases without weakening hosted auth.
7. **Adapt controlled setup/inspection deliberately.** The private F2b seam is
   complete: setup reuses Standard mutation authority and inspection returns
   logical evidence only. Before any public `run(fn)`, seed, or snapshot
   helper, design the `flarex-test` capability and lifecycle surface without
   exposing a transaction or physical database handle.
8. **Add scheduling only after runtime semantics exist.** Then port controlled
   time, in-progress/all scheduled function helpers, retry/failure inspection,
   and recursive scheduling tests against the real scheduler boundary.
9. **Expand consumer evidence deliberately.** Add compiled/registry package,
   version skew, browser WebSocket/reconnect, and real-Postgres harness lanes as
   those product boundaries become supported.
