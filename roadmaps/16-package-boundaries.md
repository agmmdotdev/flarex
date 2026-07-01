# Package Boundaries

## Executor HTTP Adapter Decision

Previous completed checkpoint: `72127aa` Centralize executor live query helper
bridge.

What changed:

- Audited the E-1 through E-3 `@flarex/executor-http` adapter shape after the
  route module split, typed body decoder migration, and live-query helper bridge
  migration.
- Decided to keep Elysia as the HTTP adapter for now instead of replacing it in
  the Effect migration.
- Kept the next implementation work pointed at protocol contracts rather than a
  router-library rewrite.

Boundary decision:

Elysia remains a package-local adapter detail in
`packages/executor-http/src/routes.ts`. The important Effect migration boundary
is already below it: `routeEffects.ts` owns authorization, configuration
preflight, JSON body reads, executor calls, and the single route error mapping
edge through `responses.ts`; `requestDecoders.ts` owns typed body validation
failures; `liveQueryDelivery.ts` owns backend callback helper runtime bridging.
Replacing Elysia now would mostly rewrite route registration, 405 bodies, and
404 behavior without moving service/domain code further away from `HttpError`
or closer to shared schema-first contracts.

Convex comparison:

- `crates/local_backend/src/router.rs` keeps router registration as an adapter
  layer around focused route modules.
- `crates/local_backend/src/public_api.rs` uses request extractors, typed
  request structs, parse helpers, and response conversion at the HTTP boundary.
- `crates/application/src/application_function_runner/http_routing.rs` keeps
  HTTP action routing separate from the lower execution path.

Flarex differs because the executor HTTP package is a TypeScript Cloudflare
adapter around `@flarex/executor`, so Elysia fills the same thin adapter role as
Convex's Axum router rather than becoming the domain boundary.

Known limitations:

- This does not make Elysia permanent. Revisit replacement only if C-1 through
  C-3 show that shared protocol decoders or generated route contracts need a
  different adapter surface.
- Method-not-allowed and not-found responses remain hand-registered in
  `routes.ts`.
- Field-level body validators still preserve compatibility messages until the
  protocol cleanup phase can decide which contracts move to `flarex-protocol`.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http test -- --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http build
git diff --check
```

## Executor HTTP Live Query Helper Boundary

Previous completed checkpoint: `9c25517` Type executor HTTP body validation.

What changed:

- Kept backend live-query delivery, wake, and trigger helper ownership in
  `packages/executor-http/src/liveQueryDelivery.ts`.
- Centralized the Promise compatibility runtime bridge in
  `runFlarexBackendLiveQueryPromise(...)`.
- Kept the reusable Effect entrypoints and typed backend fetch/response errors
  inside `@flarex/executor-http`.

Boundary decision:

Backend live-query callback HTTP helpers are adapter code, not executor core.
`@flarex/executor` still owns live-query delivery records and policy behavior;
`@flarex/executor-http` owns how those records notify Flarex backend HTTP
routes and how typed helper failures are mapped to Promise rejections for
legacy callback interfaces.

Convex comparison:

Convex keeps sync protocol types and JSON conversion in
`crates/convex/sync_types/src/types/mod.rs` and
`crates/convex/sync_types/src/types/json.rs`, with local/backend routing
separate in `crates/local_backend/src/router.rs`. Flarex mirrors the boundary
by keeping HTTP callback transport in the executor HTTP adapter package.

Known limitations:

- This checkpoint does not move callback route contracts to `flarex-protocol`.
- This checkpoint does not change backend Worker/DO callback handlers,
  scheduler delivery behavior, public SDK packages, or `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts -t "backend live query|live query delivery callbacks|live query trigger notifications|compatibility wrapper fetch rejection|fails live query" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http test -- --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http build
git diff --check
```

## Executor HTTP Body Decoder Boundary

Previous completed checkpoint: `91c0d67` Split executor HTTP adapter modules.

What changed:

- Kept executor HTTP body validation inside
  `packages/executor-http/src/requestDecoders.ts`.
- Route-facing decoders now return typed Effect failures with
  `ExecutorHttpBodyValidationError`.
- Narrow body-only types for live-query maintenance routes stay local to
  `@flarex/executor-http` because they describe HTTP adapter payloads, not
  framework-neutral executor service inputs.

Boundary decision:

Executor HTTP body decoders remain in `@flarex/executor-http`. The
framework-neutral `@flarex/executor` package still receives fully assembled
executor inputs, while the HTTP adapter owns JSON body shape checks,
authorization order, configuration preflight, and HTTP error mapping.

Convex comparison:

Convex keeps HTTP request extraction in local backend route modules such as
`crates/local_backend/src/public_api.rs`, request structs in
`crates/local_backend/src/args_structs.rs`, and narrow parse helpers in
`crates/local_backend/src/parse.rs`. Flarex mirrors the separation by keeping
adapter body validation out of executor core.

Known limitations:

- The private `*Result` helpers remain as a compatibility layer for legacy
  message preservation.
- This checkpoint does not move executor HTTP contracts to `flarex-protocol`
  or replace body checks with Effect Schema.
- `liveQueryDelivery.ts`, backend Worker/DO packages, public SDK packages, and
  `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http test -- --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http build
git diff --check
```

## Executor HTTP Adapter Package Boundary

Previous completed checkpoint: `63d9429` Type scheduler connection JSON
bridges.

What changed:

- Split `@flarex/executor-http` adapter ownership into focused source files:
  `config.ts`, `routes.ts`, `routeEffects.ts`, `requestDecoders.ts`,
  `responses.ts`, and `errors.ts`.
- Kept `src/index.ts` as the only package export target and public barrel.
- Kept `liveQueryDelivery.ts` unchanged and re-exported from the same public
  entrypoint.

Boundary decision:

`@flarex/executor-http` remains the Elysia HTTP adapter package around the
framework-neutral `@flarex/executor` core. Route registration belongs in
`routes.ts`; request decoding stays in `requestDecoders.ts`; Effect route
orchestration stays in `routeEffects.ts`; and HTTP response mapping stays in
`responses.ts`. None of these adapter concerns move into
`@flarex/executor`, `flarex-protocol`, Nitro, or backend Durable Object code in
this checkpoint.

Convex comparison:

Convex keeps local backend HTTP route registration in
`crates/local_backend/src/router.rs`, separates execution/application behavior
behind `crates/application/src/api.rs`, and routes HTTP actions through
`crates/application/src/application_function_runner/http_routing.rs`. Flarex
uses TypeScript packages and Elysia, so the package boundary is an adapter
module split rather than a Rust trait/router split.

Known limitations:

- The local parse-result validators remain in `requestDecoders.ts` until E-2.
- Backend live-query fetch/response helpers remain in `liveQueryDelivery.ts`
  until E-3.
- This checkpoint does not change public SDK packages, protocol exports,
  backend Worker/DO packages, or `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http build
```

## Scheduler And Connection Bridge Decoder Boundary

Previous completed checkpoint: `09529e6` Decode deployment storage rows with
Effect.

What changed:

- Added the scheduler wake failure-body decoder in
  `packages/flarex-backend/src/scheduler/DeliveryWakeBoundary.ts`.
- Replaced the local connection invalidation payload shape check in
  `packages/flarex-backend/src/connection/Requests.ts` with a hoisted Effect
  Schema decoder.
- Left `connectionDO.ts` as the Durable Object adapter and kept connection
  WebSocket/route parsing delegated to backend-local boundary modules.

Boundary decision:

These decoders stay in `flarex-backend`, not `flarex-protocol`, because they
describe backend Durable Object adapter bridge behavior. The scheduler failure
body accepts arbitrary remote response text, and the connection invalidation
payload is an internal route payload for backend live-query coordination rather
than a public SDK transport contract.

Convex comparison:

Convex sync protocol types live in `crates/convex/sync_types/src/types/mod.rs`
and JSON conversion lives in `crates/convex/sync_types/src/types/json.rs`, with
the browser sync protocol mirrored in
`npm-packages/convex/src/browser/sync/protocol.ts`. Scheduled-job metadata is
serialized through typed model structures in
`crates/model/src/scheduled_jobs/types.rs`. Flarex keeps this checkpoint
backend-local because Cloudflare DO route and WebSocket adapters are the
current bridge boundary.

Known limitations:

- No new shared protocol exports were added.
- This checkpoint does not change executor-http package boundaries, public SDK
  contracts, or `ValidatorJson`.
- `connection/MessageBoundary.ts` still preserves a legacy compatibility parser
  after schema decode for exact validation text.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/schedulerDeliveryWakeBoundary.test.ts test/connectionMessageBoundary.test.ts test/connectionRouteBoundary.test.ts test/connectionRequests.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

Full backend test note: `corepack pnpm --filter flarex-backend test` timed out
after 304 seconds without returning output; the leftover validation processes
were stopped after confirming their command lines.

## Deployment Storage Row Decoder Boundary

Previous completed checkpoint: `91ebf29` Decode PartitionDO storage rows with
Effect.

What changed:

- Added `packages/flarex-backend/src/deployment/StorageRows.ts` as the backend
  package boundary for deployment-owned persisted JSON rows.
- `deployment/Validation.ts` now hydrates stored push row JSON through
  storage decoders before running deployment semantic validation.
- `deployment/Store.ts` now delegates active execution artifact ref JSON
  decoding to the deployment storage boundary.
- Added `test/deploymentStorageRows.test.ts` for direct decoder coverage.

Boundary decision:

Deployment storage row formats stay in `flarex-backend` because they describe
Durable Object SQLite columns, not public protocol contracts. The row schemas
check persisted family shape, while public transport schemas and detailed
deployment semantics remain in their existing protocol and backend validation
modules.

Convex comparison:

Convex keeps schema metadata, analyzed functions, module paths, function names,
and validator JSON behind typed model objects in
`crates/common/src/bootstrap_model/schema_metadata.rs`,
`crates/model/src/modules/module_versions.rs`, and
`crates/convex/sync_types/src/udf_path.rs`. Flarex's Cloudflare backend uses
SQLite JSON columns for equivalent deployment push state, so the package
boundary is backend-local row hydration.

Known limitations:

- This checkpoint does not add new `flarex-protocol` exports.
- This checkpoint does not alter deployment DDL, deployment route boundaries,
  executor-http, or artifact runtime package boundaries.
- `ValidatorJson` remains parsed by the backend validation module after row
  hydration; Effect Schema is not replacing user validator semantics here.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentStorageRows.test.ts test/deploymentStorageSchema.test.ts test/deploymentService.test.ts test/deploymentValidation.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## PartitionDO Storage Row Decoder Boundary

Previous completed checkpoint: `564a342` Dispatch registry routes directly.

What changed:

- Added `packages/flarex-backend/src/partition/StorageRows.ts` as the backend
  package boundary for PartitionDO-owned persisted JSON rows.
- `partitionDO.ts` now calls storage decoder wrappers for idempotency results,
  subscription read sets, table placement, table validators, write-log writes,
  write-log index writes, document JSON values, and index fields.
- Direct tests in `test/partitionStorageRows.test.ts` cover the reusable
  Effect decoders separately from PartitionDO HTTP behavior.

Boundary decision:

Partition storage row validation belongs in `flarex-backend` because these
SQLite row shapes are Durable Object persistence details, not public protocol
contracts. Reusing protocol schemas is appropriate for shared JSON,
`TablePlacement`, and `ValidatorJson` shapes, but this checkpoint does not move
PartitionDO row formats into `flarex-protocol`.

Convex comparison:

Convex keeps read sets and write logs typed around
`crates/database/src/reads.rs`, `crates/database/src/write_log.rs`, and
`crates/database/src/committer.rs`. The Cloudflare backend persists equivalent
runtime state as JSON blobs in DO SQLite, so the package boundary is a typed
hydration module inside the backend package.

Known limitations:

- The sync wrappers remain because the current Durable Object SQLite read path
  is synchronous. The Effect-returning decoders are the reusable boundary; the
  wrappers are adapter compatibility.
- This checkpoint does not change `types.ts`, protocol package exports,
  deployment storage, executor-http, or `ValidatorJson` validation semantics.
- One full `test/sync.test.ts` run hit Miniflare/undici `ECONNRESET` timeouts
  in the two pending-delivery coalescing tests; the exact failed tests passed
  on targeted rerun.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/partitionStorageRows.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/partitionFlow.test.ts test/transaction.test.ts test/occ.test.ts test/partitionStorageRows.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testNamePattern "coalesces concurrent fresh pending delivery reconciles|does not coalesce concurrent pending delivery reconciles with different parameters" --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## RegistryDO Direct Dispatch Runtime Boundary

Previous completed checkpoint: `e900024` Type delivery scheduler alarm
bridges.

What changed:

- `RegistryDO` now owns only Durable Object lifecycle concerns, storage
  initialization, per-instance registry layer construction, and the fetch
  runtime edge.
- `registry/HttpApiRouteBoundary.ts` is a typed route-input decoder boundary;
  it no longer returns original read requests or synthetic JSON requests for
  generated web-handler compatibility.
- `registry/HttpApiHandlers.ts` exposes reusable registry health, list, and
  create handler effects that both the generated handler integration and the
  DO direct dispatcher can call.
- `registry/InternalRouteBoundary.ts` owns direct response mapping for
  registry generated success/error values.

Boundary decision:

RegistryDO production routing should not depend on `HttpRouter.toWebHandler`
request compatibility. Generated Registry HttpApi remains useful as protocol
and handler integration coverage, but the Durable Object adapter now routes
typed inputs directly to service-backed Effect handlers.

Known limitations:

- This checkpoint does not remove `registry/HttpApiWebHandler.ts`; it remains
  covered by `registryHttpApiHandlers.test.ts`.
- This checkpoint does not change `RegistryService`, `RegistryStore`,
  registry SQL schema initialization, deployment record semantics, Worker
  registry routing, executor-http, PartitionDO storage decoding, or
  `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/registryDO.test.ts test/registryHttpApiRouteBoundary.test.ts test/registryHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Delivery And Scheduler Alarm Runtime Bridges

Previous completed checkpoint: `79767e3` Type execution session failures.

What changed:

- `DeliveryDO` owns a named alarm continuation bridge that calls the existing
  typed pending-drain continuation effect and recovers at the alarm edge.
- `SchedulerDO` owns a named alarm continuation bridge that runs delivery
  reconcile, rerun, and connection-cleanup continuation effects with
  branch-local recovery.
- `SchedulerDO.fetch(...)` relies on `scheduler/InternalRouteBoundary.ts` for
  route-error response mapping instead of broad `errorResponse(...)` fallback.
- `delivery/PendingDrainState.ts`, `scheduler/PendingState.ts`,
  `scheduler/MaintenanceBoundary.ts`, `scheduler/DeliveryWakeBoundary.ts`, and
  `scheduler/ForceReconnectBoundary.ts` remain the source modules for typed
  pending-state and remote-call failures.

Boundary decision:

Durable Object alarm methods are runtime bridge edges. The bridge should
document and localize best-effort failure swallowing, while pending-state,
executor maintenance, delivery wake, and force-reconnect failures stay typed in
their boundary modules and map to HTTP only at the DO route adapters.

Known limitations:

- This checkpoint does not change delivery drain semantics, scheduler
  continuation algorithms, retry delay policy, executor response schemas,
  PartitionDO SQL/OCC, deployment storage, executor-http, or `ValidatorJson`.
- Delivery failure reporting remains a diagnostic best-effort path that logs
  report failures and does not affect drain retry semantics.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deliveryDO.test.ts test/schedulerRouteBoundary.test.ts test/schedulerMaintenanceBoundary.test.ts test/schedulerDeliveryWakeBoundary.test.ts test/schedulerForceReconnectBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testNamePattern "continues DeliveryDO draining from pending alarm state|continues pending live query delivery scans from alarms|continues stale live query reruns from pending alarm state|continues expired live query connection cleanup scans from stored cursors" --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## ExecutionDO Session Runtime Boundary

Previous completed checkpoint: `0817c0f` Type connection websocket messages.

What changed:

- `execution/SessionError.ts` now owns the supported execution function-kind
  precondition for ExecutionDO sessions.
- `ExecutionDO.start(...)` maps action/workflow functions and request/function
  kind mismatches to `ExecutionSessionError` at the session boundary.
- `ExecutionDO.fetch(...)` keeps route recovery in the Effect runtime boundary
  instead of a broad adapter `try/catch`.
- `invoke.ts` keeps its separate `/invoke` validation errors; ExecutionDO no
  longer imports invoke unsupported-kind or request-kind mismatch errors.

Boundary decision:

ExecutionDO session preconditions belong in `execution/SessionError.ts`.
Invoke-level function resolution and validation remain in `invoke.ts` for the
public invoke path. ExecutionDO remains the adapter edge that converts typed
route, session, validation, and transaction operation errors to HTTP responses.

Known limitations:

- This checkpoint does not convert transaction internals, invoke validation
  internals, PartitionDO SQL/OCC, executor-http, scheduler/delivery runtime
  loops, deployment storage, or `ValidatorJson`.
- Query/syscall/finish runtime preconditions that already flow through typed
  session, invoke, or route-operation errors are left in place.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/executionSessionError.test.ts test/executionDO.test.ts test/invoke.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## ConnectionDO WebSocket Message Boundary

Previous completed checkpoint: `8bace85` Type connection route boundaries.

What changed:

- `connection/MessageBoundary.ts` owns schema-backed typed websocket client
  message decoding for ConnectionDO.
- `ConnectionDO.webSocketMessage(...)` now runs a named
  `ConnectionDO.routeWebSocketMessage` Effect boundary before existing sync
  message handling.
- `syncProtocol.ts` keeps the throwing `parseClientMessage(...)`
  compatibility parser, but ConnectionDO no longer calls it directly from an
  untyped `JSON.parse(...)` path; schema failures use it only to preserve
  existing `FatalError` text.
- The ConnectionDO websocket adapter remains the only place that converts
  typed message or handler failures into `FatalError` websocket responses.

Boundary decision:

Connection message transport decoding belongs in `connection/MessageBoundary.ts`
as hoisted Effect Schema transport contracts.
ConnectionDO remains the runtime owner for websocket upgrade, session state,
identity/query-set versions, active query registration, mutation queueing,
force-reconnect, heartbeat, and transition emission. This keeps the sync
protocol parser reusable while making the DO runtime boundary typed.

Known limitations:

- ConnectionDO still has sync runtime precondition throws inside message
  handling, query execution, and mutation execution. O-1 wraps those at the
  websocket adapter edge as typed handler failures but does not convert each
  runtime precondition into separate domain errors.
- Storage row decoding, executor-http, PartitionDO SQL/OCC, deployment storage,
  scheduler/delivery runtime loops, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/connectionMessageBoundary.test.ts test/connectionRouteBoundary.test.ts test/connectionRouteDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testNamePattern "invalid websocket client messages|stale query-set base versions" --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Delivery And Live-Query Route Adapter Split

Previous completed checkpoint: `5d8a317` Type scheduler route boundaries.

What changed:

- `delivery/RouteBoundary.ts` owns typed DeliveryDO wake request decoding only;
  it no longer exports `HttpError` mapping helpers.
- `delivery/PublicWakeRouteBoundary.ts` owns typed public delivery wake request
  decoding only; it no longer exports public HTTP mapping helpers.
- `liveQueryDelivery/RouteBoundary.ts` owns typed public live-query delivery
  request decoding only; it no longer exports public HTTP mapping helpers.
- `delivery/InternalRouteBoundary.ts` remains the DeliveryDO internal adapter
  edge for typed wake, pending-drain, operation, and drain-failure responses.
- `worker.ts` remains the public delivery wake and live-query delivery adapter
  edge for route, authorization, target, and dispatch failures.

Boundary decision:

Delivery and live-query route boundary modules are transport-input boundaries.
Worker is the public delivery/live-query adapter edge, and DeliveryDO's
internal route boundary is the internal delivery adapter edge. Delivery drain
state, fanout, executor responses, connection delivery, and scheduler wake
behavior remain separate typed runtime/service boundaries.

Known limitations:

- `liveQueryDelivery.ts` still keeps lower-level payload compatibility helpers
  and fanout mapping helpers. Those are not route decoder ownership and remain
  for later service/runtime cleanup phases.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deliveryRouteBoundary.test.ts test/publicDeliveryWakeRouteBoundary.test.ts test/publicLiveQueryDeliveryRouteBoundary.test.ts test/publicDeliveryWakeDispatchBoundary.test.ts test/publicLiveQueryDeliveryDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testNamePattern "malformed public live query delivery JSON|invalid public live query delivery envelopes|malformed DeliveryDO wake JSON|invalid DeliveryDO wake envelopes|malformed public DeliveryDO wake JSON|invalid public DeliveryDO wake envelopes" --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Scheduler Route Adapter Split

Previous completed checkpoint: `94d07b3` Type partition route boundaries.

What changed:

- `scheduler/RouteBoundary.ts` owns typed scheduler request decoding only; it
  no longer exports `HttpError` mapping helpers.
- `scheduler/PublicRouteBoundary.ts` wraps the shared scheduler decoders as
  named public route boundaries without owning HTTP response conversion.
- `scheduler/InternalRouteBoundary.ts` remains the SchedulerDO internal adapter
  edge for typed scheduler route/runtime/pending-state failures.
- `worker.ts` remains the public scheduler adapter edge and maps public
  scheduler route, authorization, and dispatch failures to preserved HTTP
  responses.

Boundary decision:

Scheduler route boundary modules are transport-input boundaries. Worker is the
public scheduler adapter edge, and SchedulerDO's internal route boundary is the
internal scheduler adapter edge. Scheduler maintenance, delivery wake,
force-reconnect, pending state, and response decoding remain separate typed
service/runtime boundaries.

Known limitations:

- Scheduler service helpers still expose several boundary-specific
  `*ToHttpError` functions for runtime, pending-state, maintenance, delivery
  wake, force-reconnect, and executor-response failures. Those remain adapter
  compatibility helpers for SchedulerDO and are not route decoder ownership.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/schedulerRouteBoundary.test.ts test/publicSchedulerRouteBoundary.test.ts test/publicSchedulerDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Partition Route Adapter Split

Previous completed checkpoint: `737e075` Type public invoke boundary.

What changed:

- `partition/RouteBoundary.ts` owns typed partition request and query-param
  decoding only; it no longer exports `HttpError` mapping helpers.
- `partition/PublicSchemaCacheRouteBoundary.ts` no longer re-exports partition
  HTTP mapping.
- `partition/PublicDispatchBoundary.ts` accepts typed document/index read
  inputs instead of raw `URLSearchParams`.
- Worker and PartitionDO keep partition route error to response conversion at
  their adapter edges.

Boundary decision:

Partition route boundary modules are transport-input boundaries. Worker is the
public partition adapter edge, and PartitionDO is the internal partition adapter
edge. PartitionDO storage, SQL, OCC, and row decoding remain outside this R-3
route-input slice.

Known limitations:

- PartitionDO still contains domain/storage `HttpError` throws and row-level
  JSON casts. Those are reserved for object/storage phases such as O-2/S-1 and
  are not part of this route-boundary checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/partitionRouteBoundary.test.ts test/publicPartitionSchemaCacheRouteBoundary.test.ts test/publicPartitionDispatchBoundary.test.ts test/partitionFlow.test.ts test/occ.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Invoke Route Adapter Split

Previous completed checkpoint: `4f36d96` Type execution route boundaries.

What changed:

- `invoke/PublicInvokeRouteBoundary.ts` owns typed public invoke request/payload
  decoding only; it no longer exports `HttpError` mapping helpers.
- `worker.ts` owns public invoke route decode and missing-input mapping to the
  preserved `HttpError` compatibility response.
- `invoke.ts` keeps active deployment loading as a typed Effect integration
  boundary via `InvokeActiveDeploymentLoadError`.
- Existing `executeInvokeEffect(...)` and `loadActiveDeploymentEffect(...)`
  typed failure channels remain unchanged for service/runtime behavior.

Boundary decision:

Public invoke route boundary modules are transport-input boundaries, not HTTP
response adapters. Worker is the public invoke adapter edge. `invoke.ts` owns
typed invoke runtime and validation failures; compatibility conversion remains
outside the route decoder.

Known limitations:

- `invoke.ts` still exports compatibility Promise helpers and adapter mappers
  for legacy callers. Final migration phases own reducing those remaining
  compatibility surfaces.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicInvokeRouteBoundary.test.ts test/invokeRequests.test.ts test/invoke.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Execution Route Adapter Split

Previous completed checkpoint: `7737cd0` Type project required parameters.

What changed:

- Worker public execution routing and ExecutionDO internal routing now own
  execution decode/path error to `HttpError` compatibility mapping locally at
  their adapter edges.
- Execution start, public action, finish, and syscall boundary modules now own
  typed request/payload decoders only.
- Worker public execution routing no longer imports execution HTTP mapping
  from route boundary modules.
- ExecutionDO internal route mapping keeps decode and service/domain failures
  in the existing DO response mapper.

Boundary decision:

Execution route boundary modules are now transport-input boundaries, not HTTP
response adapters. Worker and ExecutionDO are the only execution adapter edges
that convert typed execution route failures to the preserved HTTP response
contract.

Known limitations:

- Execution service/session failures still map through the existing ExecutionDO
  response adapter. Later object/service phases own deeper session failure
  cleanup.
- Public Worker deployment route mapping still contains compatibility branches
  for other route families until their R-phase checkpoints move those families
  to the same adapter-only shape.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/executionStartRouteBoundary.test.ts test/executionActionRouteBoundary.test.ts test/executionFinishRouteBoundary.test.ts test/executionSyscallRouteBoundary.test.ts test/executionDO.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Project Required Parameter Effects

Previous completed checkpoint: `33054dd` Propagate public worker route errors.

What changed:

- `project.ts` now owns `ProjectRequiredParameterError`,
  `requireProjectIdEffect(...)`, and `projectIdFromRequestOrEnvEffect(...)`.
- `projectRequiredParameterErrorToHttpError(...)` is the compatibility adapter
  for HTTP status/message preservation.
- Scheduler cleanup payload decoding imports the shared project helper instead
  of carrying a local request-or-env implementation.
- ConnectionDO executor paths call the typed project helper before posting to
  the executor service.
- `W-3` is ticked in `roadmaps/22-effect-migration-checklist.md`; `R-1` is the
  next active checkpoint.

Boundary decision:

Project id presence/shape is now a typed shared precondition. Scheduler keeps
its public route payload error type by mapping project precondition failures at
the scheduler route boundary.

Known limitations:

- ConnectionDO still has other sync protocol precondition throws outside the
  project-id boundary. Later route-family phases own those.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/project.test.ts test/schedulerRouteBoundary.test.ts test/publicSchedulerRouteBoundary.test.ts test/sync.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Worker Route Family Error Propagation

Previous completed checkpoint: `8312909` Tag public worker route errors.

What changed:

- `worker.ts` now owns the full public Worker route error union:
  adapter errors, dispatch errors, invoke route errors, scheduler route errors,
  and deployment route errors.
- Public Worker branch routing no longer performs branch-local catches for
  invoke, registry, scheduler, or deployment paths.
- `worker/PublicRouteDispatchError.ts` now names its helper union
  `PublicWorkerAdapterRouteError`, making adapter-route errors distinct from
  the full Worker route-family error union.
- `W-2` is ticked in `roadmaps/22-effect-migration-checklist.md`; `W-3` is the
  next active checkpoint.

Boundary decision:

Route-family modules still own their typed route errors and compatibility HTTP
mapping helpers. The top-level Worker now owns deciding which route-family
mapper applies and converting the result to a response at one adapter edge.

Known limitations:

- This slice does not rewrite route-family internals, `project.ts`, storage,
  PartitionDO SQL/OCC, executor-http, or `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicWorkerRouteDispatchError.test.ts test/publicWorkerRoutePathBoundary.test.ts test/publicPassThroughDispatchBoundary.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/publicDeploymentPushDispatchBoundary.test.ts test/publicSchedulerRouteBoundary.test.ts test/publicSchedulerDispatchBoundary.test.ts test/publicInvokeRouteBoundary.test.ts test/invoke.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Worker Route Error Adapter

Previous completed checkpoint: `a1c1871` Validate public artifact boundaries.

What changed:

- `worker/PublicRouteDispatchError.ts` now owns tagged Worker route adapter
  errors for standard JSON responses and invoke-specific responses.
- `worker.ts` routes public branch failures into those tagged adapter errors
  and converts them to HTTP responses at one Worker-level adapter.
- Direct tests cover both standard `{ error }` response mapping and preserved
  invoke partition response bodies.
- `W-1` is ticked in `roadmaps/22-effect-migration-checklist.md`; `W-2` is the
  next active checkpoint.

Boundary decision:

`HttpError` remains an adapter compatibility value carried inside the tagged
Worker route error. It is no longer the public Worker route effect error type.
Invoke keeps its separate response mapping because partition failures must
preserve their structured response bodies.

Known limitations:

- This slice does not rewrite each route family's native error union. W-2 owns
  moving deployment, scheduler, invoke, execution, partition, live-query, and
  delivery-wake branches to the Worker adapter edge.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicWorkerRouteDispatchError.test.ts test/publicWorkerRoutePathBoundary.test.ts test/publicPassThroughDispatchBoundary.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/publicDeploymentPushDispatchBoundary.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Artifact Boundary Validation

Previous completed checkpoint: `656d1ea` Map public deployment errors at adapter.

What changed:

- `backendAnalyzerResponse.ts` now validates assembled analyzer start-push
  responses through the protocol analyzed-start decoder and backend deployment
  validation decoder.
- `deployment/PublicStartArtifactBoundary.ts` validates artifact refs returned
  from public start artifact writes.
- `deployment/PublicFinishArtifactBoundary.ts` validates source packages read
  during finish artifact availability checks.
- `P-3` is ticked in `roadmaps/22-effect-migration-checklist.md`; `W-1` is the
  next active checkpoint.

Boundary decision:

Analyzer and artifact store responses are now checked at the public deployment
service boundary before downstream route/dispatch code trusts them. Existing
artifact store failures remain in the public worker dispatch error channel.

Known limitations:

- This slice does not change storage implementation, artifact materialization,
  generated handlers, DeploymentService lifecycle, Worker route error unions,
  PartitionDO SQL/OCC, executor-http, or `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicStartArtifactBoundary.test.ts test/publicFinishArtifactBoundary.test.ts test/deploymentValidation.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Deployment Response Adapter

Previous completed checkpoint: `d4d1fc7` Type public push route inputs.

What changed:

- `worker.ts` converts typed public deployment route failures to `Response`
  inside `publicWorkerDeploymentRouteErrorToResponseEffect(...)`.
- `worker.ts` no longer routes deployment non-invoke failures through a
  `HttpError`-failing intermediate effect.
- The public deployment non-invoke error union no longer includes `HttpError`.
- `worker/PublicRouteDispatchError.ts` remains typed/error-only for this slice.
- `P-2` is ticked in `roadmaps/22-effect-migration-checklist.md`; `P-3` is the
  next active checkpoint.

Boundary decision:

Public deployment dispatch and route logic emit typed failures. The public
deployment Worker branch owns conversion to HTTP responses at its adapter edge.
`PublicRouteDispatchError.ts` stays free of HTTP `Response` construction. Other
Worker route families keep their existing `HttpError` compatibility helpers
until their own phases.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's public deployment Worker adapter boundary.

How Flarex differs:

- Flarex has multiple public route families in one Worker. This checkpoint only
  moves the deployment branch; global Worker route error cleanup remains later
  in the checklist.

Known limitations:

- `PublicPushDispatchBoundary.ts` already returned typed dispatch failures and
  did not need a source change in this slice. Public start/finish artifact
  service response schemas, generated handler logic, service/store lifecycle
  logic, artifact runtime/cache behavior, source-package analysis behavior,
  PartitionDO SQL/OCC behavior, executor-http, protocol parser compatibility,
  and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicWorkerRouteDispatchError.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/publicDeploymentPushDispatchBoundary.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/publicPassThroughDispatchBoundary.test.ts test/publicWorkerRoutePathBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Deployment Push Route Inputs

Previous completed checkpoint: `3095319` Remove deployment request bridge.

What changed:

- `deployment/PublicPushRouteBoundary.ts` now exports tagged public deployment
  push route-input types and decoders for read, source-only start, analyzed
  start, finish, and abandon routes.
- `deployment/PublicPushDispatchBoundary.ts` now accepts typed route inputs for
  public push dispatch instead of separate `pushId` and body arguments.
- `worker.ts` now bridges public push route inputs to analyzer, artifact, and
  dispatch effects explicitly.
- `P-1` is ticked in `roadmaps/22-effect-migration-checklist.md`; `P-2` is the
  next active checkpoint.

Boundary decision:

The public Worker owns public path matching and runtime sequencing, while
`PublicPushRouteBoundary` owns request body decoding into typed route inputs and
`PublicPushDispatchBoundary` owns forwarding those typed inputs to the
DeploymentDO.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's public deployment push route boundary.

How Flarex differs:

- Flarex has public analyzer/artifact service boundaries before forwarding to
  the DeploymentDO. The route-input boundary keeps those service steps explicit
  while avoiding unstructured push body dispatch.

Known limitations:

- Public Worker deployment error mapping still keeps the current `HttpError`
  adapter compatibility path. Generated handler logic, service/store lifecycle
  logic, artifact runtime/cache behavior, source-package analysis behavior,
  PartitionDO SQL/OCC behavior, executor-http, protocol parser compatibility,
  and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicDeploymentPushRouteBoundary.test.ts test/publicDeploymentPushDispatchBoundary.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentValidation.test.ts test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/publicDeploymentPushDispatchBoundary.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## DeploymentDO Request Bridge Demotion

Previous completed checkpoint: `34a6022` Map deployment reads directly.

What changed:

- `deployment/InternalRouteBoundary.ts` no longer exports or uses the
  generated request compatibility dispatcher.
- `deployment/HttpApiRouteBoundary.ts` now owns typed route-input decoding only;
  generated request rebuild helpers were removed.
- `deploymentDO.ts` no longer stores a generated web handler for production API
  routing.
- `deployment/HttpApiWebHandler.ts` is kept as a generated-handler integration
  test bridge, not a DeploymentDO production dependency.
- `D-6` is ticked in `roadmaps/22-effect-migration-checklist.md`; `P-1` is the
  next active checkpoint.

Boundary decision:

DeploymentDO production API routes now cross from decoded route input to
generated handler effects directly. The package boundary no longer exposes a
request-rebuild compatibility route for DeploymentDO dispatch.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's DeploymentDO adapter boundary.

How Flarex differs:

- Flarex still uses generated handler effects for protocol-level handler tests.
  The Durable Object boundary itself now avoids the generated web-handler bridge.

Known limitations:

- Public Worker deployment push routes still use their existing compatibility
  wrappers. Generated handler logic, service/store lifecycle logic, artifact
  runtime/cache, source-package analysis, PartitionDO SQL/OCC behavior,
  executor-http, protocol parser compatibility, and `ValidatorJson` are
  unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiRouteBoundary.test.ts test/deploymentHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentValidation.test.ts test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## DeploymentDO Read Direct Mapping

Previous completed checkpoint: `c4404be` Wire deployment mutation direct
dispatch.

What changed:

- `deployment/HttpApiRouteBoundary.ts` now exposes explicit read route input
  tags for health, active deployment, and get-push.
- `deployment/InternalRouteBoundary.ts` now dispatches read route inputs
  directly through generated handler effects with a local HTTP response mapper.
- DeploymentDO no longer depends on generated HttpApi request rebuilding for
  any API route in production routing.
- `D-5` is ticked in `roadmaps/22-effect-migration-checklist.md`.

Boundary decision:

Generated handlers remain reusable Effect functions. The generated web-handler
request bridge is no longer part of DeploymentDO production API dispatch and is
ready for the D-6 demotion/removal decision.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's DeploymentDO adapter boundary.

How Flarex differs:

- Convex does not require an HttpApi web-handler bridge inside Durable Objects.
  Flarex now matches that shape more closely at the DO adapter while retaining
  generated handler tests.

Known limitations:

- Compatibility adapter cleanup, generated handler logic, service/store
  lifecycle logic, public Worker dispatch, artifact runtime/cache,
  source-package analysis, PartitionDO SQL/OCC behavior, executor-http,
  protocol parser compatibility, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiRouteBoundary.test.ts test/deploymentHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentValidation.test.ts test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## DeploymentDO Mutation Direct Wiring

Previous completed checkpoint: `55f0739` Plan concrete Effect migration
checklist.

What changed:

- `deployment/InternalRouteBoundary.ts` now consumes `DeploymentService` for
  typed mutation route inputs and leaves read route inputs on the compatibility
  bridge.
- `deploymentDO.ts` provides the existing deployment layer at the DO fetch
  runtime boundary.
- The `D-4` checklist item is ticked in
  `roadmaps/22-effect-migration-checklist.md`.

Boundary decision:

Mutation route dispatch now crosses directly from decoded route input to
generated handler effects through `DeploymentService`. The generated web-handler
bridge remains an explicit read-route compatibility boundary until `D-5`.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's DeploymentDO Effect boundary.

How Flarex differs:

- Convex does not have this generated HttpApi bridge. Flarex is migrating away
  from it incrementally so behavior remains locked by tests at each boundary.

Known limitations:

- Direct read mapping, generated handler logic, service/store lifecycle logic,
  public Worker dispatch, artifact runtime/cache, source-package analysis,
  PartitionDO SQL/OCC behavior, executor-http, protocol parser compatibility,
  and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiRouteBoundary.test.ts test/deploymentHttpApiHandlers.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentValidation.test.ts test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Direct DeploymentDO Mutation Route Input Dispatch

Previous completed checkpoint: `a5843f5` Type deployment route compatibility
dispatch.

What changed:

- `deployment/InternalRouteBoundary.ts` now exposes
  `dispatchDeploymentApiMutationRouteInputDirect(...)`.
- Direct mutation dispatch consumes typed route input plus
  `DeploymentServiceApi`, avoiding generated HttpApi request rebuilding for
  the tested start/finish/abandon dispatch path.
- HTTP response mapping for generated handler success and declared error
  values is isolated in the internal route boundary.
- The existing Durable Object route wiring remains on the compatibility bridge
  until direct read or split mutation/read routing is selected.

Boundary decision:

Typed mutation route input can now be dispatched directly through generated
handler effects. The DO runtime wiring stays unchanged for this checkpoint so
the service/layer lifecycle is not mixed into the direct-dispatch proof.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's direct DeploymentDO mutation dispatch boundary.

How Flarex differs:

- Convex does not have this generated HttpApi bridge. Flarex is keeping the
  bridge wired while proving an equivalent direct mutation adapter that can
  replace it later.

Known limitations:

- No `routeDeploymentDurableObject(...)` wiring, direct read dispatch,
  generated handler logic, DeploymentService/store lifecycle logic, public
  Worker deployment dispatch, artifact materializer/cache, source-package
  analyzer semantics, PartitionDO SQL/OCC behavior, executor-http route,
  protocol parser compatibility wrapper, or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentValidation.test.ts test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## DeploymentDO Route Input Compatibility Dispatch

Previous completed checkpoint: `203ca2f` Type deployment route input boundary.

What changed:

- `deployment/InternalRouteBoundary.ts` now routes through typed
  `DeploymentApiRouteInput` values instead of immediately rebuilding generated
  HttpApi requests.
- `dispatchDeploymentApiRouteInputViaRequestCompatibility(...)` owns the
  generated HttpApi request bridge and generated handler failure mapping.
- `deployment/HttpApiRouteBoundary.ts` remains the owner of route matching and
  body decoding.
- Tests exercise the compatibility adapter directly instead of proving it only
  through the full DO route wrapper.

Boundary decision:

DeploymentDO internal routing should consume typed route inputs. The generated
HttpApi web handler remains a compatibility layer, but request rebuilding is
now isolated to one named adapter rather than being baked into route matching.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's DeploymentDO route compatibility boundary.

How Flarex differs:

- Convex does not have this generated DeploymentDO HttpApi request bridge.
  Flarex keeps it temporarily while making the bridge explicit enough to
  remove or replace in a later direct-dispatch slice.

Known limitations:

- No direct generated handler dispatch, generated handler logic,
  DeploymentService/store lifecycle logic, public Worker deployment dispatch,
  artifact materializer/cache, source-package analyzer semantics, PartitionDO
  SQL/OCC behavior, executor-http route, protocol parser compatibility wrapper,
  or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentValidation.test.ts test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Typed DeploymentDO API Route Input

Previous completed checkpoint: `c5df8a2` Type deployment start response
adapter.

What changed:

- `deployment/HttpApiRouteBoundary.ts` now exposes typed decoded
  `DeploymentApiRouteInput` values before rebuilding generated HttpApi
  requests.
- Read routes are represented as pass-through route inputs.
- Start, finish, and abandon mutation routes are represented with decoded
  protocol body values and finish/abandon push ids.
- The existing `decodeDeploymentApiRequestForRoute(...)` API remains as a
  compatibility wrapper for `HttpApiWebHandler`.

Boundary decision:

DeploymentDO route matching and request-body validation belong at the
DeploymentDO route boundary. The generated HttpApi web handler remains the
runtime compatibility layer for now, but callers can now reason about the
decoded route input without parsing a rebuilt `Request`.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's DeploymentDO route input boundary.

How Flarex differs:

- Convex does not have this generated DeploymentDO HttpApi request adapter.
  Flarex currently keeps it for generated route compatibility while introducing
  typed route inputs for the next dispatch migration decision.

Known limitations:

- No generated handler logic, DeploymentService/store lifecycle logic, public
  Worker deployment dispatch, artifact materializer/cache, source-package
  analyzer semantics, PartitionDO SQL/OCC behavior, executor-http route,
  protocol parser compatibility wrapper, or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentValidation.test.ts test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Generated Deployment HttpApi Start Response Adapter Effects

Previous completed checkpoint: `23a2cb3` Type deployment finish abandon
adapters.

What changed:

- `deployment/HttpApiHandlers.ts` now has a named analyzed start-push response
  adapter beside the read, finish, and abandon response adapters.
- The start handler keeps generated-handler input validation separate from the
  service-response adapter.
- Input protocol/domain failures are still mapped to declared generated HttpApi
  error responses before the service call.
- Tests exercise the start response adapter directly for success, service
  failures, and malformed service responses.

Boundary decision:

Generated analyzed start-push input validation belongs at the generated handler
entry boundary. Service execution, typed service failure mapping, and response
protocol validation belong in the generated HttpApi response adapter. Keeping
those steps separate makes the remaining DeploymentDO route decoding decision
easier to evaluate without duplicating protocol checks.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's generated Deployment HttpApi start response boundary.

How Flarex differs:

- Convex does not have this generated DeploymentDO HttpApi adapter. Flarex uses
  it to bridge analyzed deployment metadata into service input and then return
  validated push status responses through Effect HttpApi.

Known limitations:

- No DeploymentDO route decoding, public Worker deployment dispatch,
  DeploymentService/store lifecycle logic, artifact materializer/cache,
  source-package analyzer semantics, PartitionDO SQL/OCC behavior,
  executor-http route, protocol parser compatibility wrapper, or
  `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentValidation.test.ts test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Generated Deployment HttpApi Finish And Abandon Adapter Effects

Previous completed checkpoint: `f49d45d` Type deployment handler input
guard.

What changed:

- `deployment/HttpApiHandlers.ts` now has named finish and abandon response
  adapters beside the existing read response adapters.
- Finish-push handler wrappers no longer inline service failure mapping plus
  protocol response decoding.
- Abandon-push handler wrappers no longer inline service failure mapping plus
  push-status response decoding.
- Tests exercise those adapter boundaries directly, including service failures
  and malformed service responses.

Boundary decision:

Generated HttpApi handlers should compose service effects, typed failure
mapping, and protocol response validation at one adapter boundary. Service and
store code remain responsible for domain lifecycle behavior; the generated
handler layer is responsible for converting those results into declared HttpApi
success or failure channels.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's generated Deployment HttpApi response boundary.

How Flarex differs:

- Convex does not have this generated DeploymentDO HttpApi adapter. Flarex uses
  it to expose deployment mutation responses through Effect HttpApi while the
  service layer owns push lifecycle state transitions.

Known limitations:

- No generated start-push service-response behavior, DeploymentDO route
  decoding, public Worker deployment dispatch, DeploymentService/store
  lifecycle logic, artifact materializer/cache, source-package analyzer
  semantics, PartitionDO SQL/OCC behavior, executor-http route, protocol
  parser compatibility wrapper, or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentValidation.test.ts test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Generated Deployment HttpApi Handler Input Effects

Previous completed checkpoint: `456e952` Type public deployment route
adapter.

What changed:

- `deployment/HttpApiHandlers.ts` now separates generated-handler protocol
  cross-field checks from backend domain validation.
- `decodeStartAnalyzedPushHandlerProtocolInput(...)` emits
  `DeploymentProtocolValidationError` for analyzed start-push shape invariants
  that belong to the transport/API contract.
- `decodeStartAnalyzedPushHandlerInput(...)` delegates once to
  `decodeStartAnalyzedPushInput(...)` for backend metadata validation instead
  of re-decoding the full protocol payload.
- `decodeStartAnalyzedPushInput(...)` accepts the structural payload boundary
  it validates, so generated handlers do not need casts to enter domain
  validation.

Boundary decision:

Generated HttpApi payload decoding belongs to the transport/API contract.
Backend source package, analysis, partition, and codegen checks belong to the
deployment validation layer. The generated handler adapter is the boundary that
composes those two typed checks for service input construction.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's Deployment HttpApi handler-input boundary.

How Flarex differs:

- Convex does not have this generated DeploymentDO HttpApi adapter. Flarex uses
  it to bridge generated route payloads into backend deployment service input.

Known limitations:

- No DeploymentDO route decoding, public Worker deployment dispatch,
  DeploymentService/store lifecycle logic, artifact materializer/cache,
  source-package analyzer semantics, PartitionDO SQL/OCC behavior,
  executor-http route, protocol parser compatibility wrapper, or
  `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiHandlers.test.ts test/deploymentValidation.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentValidation.test.ts test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Worker Deployment Route Adapter Effects

Previous completed checkpoint: `39e4aaa` Type start abandon store write plans.

What changed:

- `worker.ts` now routes public deployment branch failures through a named
  Effect response adapter instead of inline branch-local matching.
- `publicWorkerDeploymentRouteErrorToHttpErrorEffect(...)` centralizes
  Worker-level HTTP conversion for non-invoke deployment route failures.
- Deployment route request/protocol errors continue to be owned by
  `deployment/PublicPushRouteBoundary.ts`; Worker dispatch errors continue to
  be owned by `worker/PublicRouteDispatchError.ts`.

Boundary decision:

Typed request decoding belongs in deployment route boundary modules. The public
Worker owns only the final adapter mapping from the union of public deployment
route failures to HTTP responses.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's public Worker package boundary around deployment route adapter
  mapping.

How Flarex differs:

- Convex does not have Flarex's public Worker fan-out over multiple Durable
  Object route families. Flarex keeps that fan-out adapter in the Worker while
  preserving module-owned typed errors below it.

Known limitations:

- No DeploymentDO generated handler behavior, DeploymentService/store
  lifecycle logic, artifact materializer/cache, source-package analyzer
  semantics, PartitionDO SQL/OCC behavior, executor-http route, protocol parser
  compatibility, or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicDeploymentPushRouteBoundary.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Start And Abandon Store Write Planning Effects

Previous completed checkpoint: `c7efab5` Type finish activation metadata
writes.

What changed:

- `deployment/Store.ts` now exports
  `deploymentStartPushApplicationPlan(...)` for analyzed/failed start push row
  values.
- `deployment/Store.ts` now exports
  `deploymentAbandonPushApplicationPlan(...)` for abandon push update values.
- `DeploymentPushStore` applies those plans inside the store-owned Durable
  Object SQL write transactions.

Boundary decision:

Lifecycle write planning belongs in `DeploymentPushStore` because start and
abandon own Durable Object SQL push state. Service preflight still builds
validated store inputs, and generated API layers still only map typed
service/store results to response classes.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's deployment store package boundary around push lifecycle writes.

How Flarex differs:

- Convex does not have Flarex's DeploymentDO push lifecycle table. Flarex keeps
  push row value construction and SQL writes inside the store package.

Known limitations:

- No DeploymentDO routing, generated DeploymentApi response mapping, public
  Worker deployment dispatch, service preflight, finish activation, active
  metadata parsing, artifact store implementation, PartitionDO SQL/OCC
  behavior, executor-http route, protocol parser compatibility, or
  `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentHttpApiHandlers.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Finish Activation Metadata Write Planning Effects

Previous completed checkpoint: `8b90fff` Type finish activation application
plans.

What changed:

- `deployment/Store.ts` now exports
  `deploymentActiveMetadataApplicationPlan(...)` for active deployment meta
  rows written during finish activation.
- `finishPushActivationApplication(...)` now includes `activeMetadata` beside
  schema and function application plans.
- `DeploymentPushStore.runFinishPushTransaction(...)` applies the prebuilt
  active metadata plan through the store-owned meta writer.

Boundary decision:

Active metadata write planning belongs in `DeploymentPushStore` because finish
activation owns Durable Object SQL metadata. The generated API layer still only
maps typed store/service results to response classes.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's deployment store package boundary around active metadata writes.

How Flarex differs:

- Convex does not have Flarex's DeploymentDO `meta` rows. Flarex keeps active
  metadata value construction and SQL writes inside the store package.

Known limitations:

- No DeploymentDO routing, generated DeploymentApi response mapping, public
  Worker deployment dispatch, service preflight, active metadata read parsing,
  schema/function application rows, artifact store implementation, PartitionDO
  SQL/OCC behavior, executor-http route, protocol parser compatibility, or
  `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentHttpApiHandlers.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Finish Activation Application Planning Effects

Previous completed checkpoint: `3c1179d` Type active deployment metadata
parsing.

What changed:

- `deployment/Store.ts` now exports `deploymentSchemaApplicationPlan(...)` for
  finish activation schema SQL application rows.
- `deployment/Store.ts` now exports `deploymentFunctionsApplicationPlan(...)`
  for finish activation function SQL application rows.
- `deployment/Store.ts` now exports `finishPushActivationApplication(...)` to
  combine both plans before `DeploymentPushStore.finishPush(...)` enters the
  write transaction.

Boundary decision:

Schema/function application planning belongs in `DeploymentPushStore` because
finish activation owns the Durable Object SQL writes. The plan helpers remain
Effect code outside the transaction callback, while the transaction applies the
prebuilt rows.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's deployment store package boundary around finish activation.

How Flarex differs:

- Convex does not have Flarex's generated DeploymentDO plus Durable Object SQL
  activation path. Flarex keeps activation planning and SQL writes in the store
  package, away from generated HTTP adapters.

Known limitations:

- No DeploymentDO routing, generated DeploymentApi response mapping, public
  Worker deployment dispatch, service preflight, active metadata read parsing,
  artifact store implementation, PartitionDO SQL/OCC behavior, executor-http
  route, protocol parser compatibility, or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentHttpApiHandlers.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Active Deployment Metadata Parsing Effects

Previous completed checkpoint: `4ab505a` Type deployment store finish
decisions.

What changed:

- `deployment/Store.ts` now exports
  `activeDeploymentExecutionArtifactRefFromMeta(...)` for raw active artifact
  ref metadata decoding.
- `deployment/Store.ts` now exports
  `activeDeploymentActivatedAtFromMeta(...)` for raw activation-time metadata
  conversion.
- `DeploymentPushStore.getActiveDeployment(...)` now routes metadata reads
  through those helpers before assembling `ActiveDeploymentStatus`.

Boundary decision:

Raw active deployment metadata parsing belongs in `DeploymentPushStore`,
because the values come from Durable Object storage. Generated response-class
validation remains in `DeploymentApiHandlers`; service not-found conversion
remains in `DeploymentService`.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's store/service/API package boundary around active deployment
  metadata.

How Flarex differs:

- Convex does not expose Flarex's Durable Object `meta` table split. Flarex
  keeps raw metadata parsing inside the store package and HTTP response mapping
  outside it.

Known limitations:

- No DeploymentDO routing, generated DeploymentApi response mapping, public
  Worker deployment dispatch, service preflight, transaction SQL, artifact
  store implementation, PartitionDO SQL/OCC behavior, executor-http route,
  protocol parser compatibility, or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentHttpApiHandlers.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Deployment Store Finish Decision Effects

Previous completed checkpoint: `9c2902a` Type deployment read response
adapters.

What changed:

- `deployment/Store.ts` now exports
  `deploymentFinishPushStoreDecision(...)` for finish-push activation versus
  rejection classification.
- `deployment/Store.ts` now exports
  `activeDeploymentStatusFromStoreParts(...)` for active deployment response
  assembly after source metadata reads.
- `DeploymentPushStore.finishPush(...)` and
  `DeploymentPushStore.getActiveDeployment(...)` delegate to those helpers.

Boundary decision:

Finish activation/rejection decisions belong in `DeploymentPushStore` because
they depend on stored push state. Generated response-class mapping belongs in
`DeploymentApiHandlers`; service preflight belongs in `DeploymentService`.
This checkpoint keeps those boundaries explicit.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's deployment store/service/API package boundary.

How Flarex differs:

- Convex does not have Flarex's DeploymentDO push lifecycle with generated
  Effect HttpApi adapters. Flarex keeps lifecycle rejection responses as store
  results and HTTP mapping as an adapter concern.

Known limitations:

- No DeploymentDO routing, generated DeploymentApi response mapping, public
  Worker deployment dispatch, service preflight, artifact store implementation,
  PartitionDO SQL/OCC behavior, executor-http route, protocol parser
  compatibility, or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentHttpApiHandlers.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Deployment Read Service HttpApi Response Effects

Previous completed checkpoint: `693c172` Type deployment start abandon
service inputs.

What changed:

- `deployment/Service.ts` now exports `requireActiveDeployment(...)` for
  active deployment nullable-read preflight.
- `deployment/HttpApiHandlers.ts` now exports
  `deploymentActiveDeploymentResponseForHttpApi(...)` and
  `deploymentPushStatusResponseForHttpApi(...)` for generated read response
  mapping.
- `deploymentGetActiveDeploymentHandler(...)` and
  `deploymentGetPushHandler(...)` delegate to the named read response adapters.

Boundary decision:

Active deployment not-found belongs in `DeploymentService`; storage/validation
failures remain sourced by `DeploymentPushStore`; generated response class and
protocol response validation mapping belongs in `DeploymentApiHandlers`.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's deployment service/generated-API package boundary.

How Flarex differs:

- Convex does not have this Cloudflare DeploymentDO plus generated Effect
  HttpApi response-class adapter split. Flarex keeps the adapter edge explicit
  so service code stays free of HTTP response classes.

Known limitations:

- No DeploymentDO routing, public Worker deployment dispatch, push write/state
  behavior, artifact store implementation, PartitionDO SQL/OCC behavior,
  executor-http route, protocol parser compatibility, or `ValidatorJson`
  boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentHttpApiHandlers.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Deployment Start And Abandon Service Input Effects

Previous completed checkpoint: `df0eb71` Type deployment finish service
preflight.

What changed:

- `deployment/Service.ts` now exports
  `startAnalyzedDeploymentPushStoreInput(...)` for start-push store input
  construction.
- `deployment/Service.ts` now exports `abandonDeploymentPushStoreInput(...)`
  for abandon-push preflight and store input construction.
- `DeploymentService.startAnalyzedPush(...)` and
  `DeploymentService.abandonPush(...)` delegate to those helpers and keep
  store write behavior in `DeploymentPushStore`.

Boundary decision:

Deployment lifecycle service preflight belongs in `DeploymentService`; write
transactions and state transitions belong in `DeploymentPushStore`; HTTP
response mapping belongs in generated DeploymentApi handlers. This checkpoint
makes that split consistent across start, finish, and abandon operations.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's deployment service/store package boundary.

How Flarex differs:

- Convex does not have this Cloudflare DeploymentDO plus generated Effect
  HttpApi handler split. Flarex keeps service-controlled IDs/clocks in the
  service layer and state mutation in the Durable Object store.

Known limitations:

- No DeploymentDO routing, generated DeploymentApi response mapping, public
  Worker deployment dispatch, artifact store implementation,
  DeploymentPushStore write/state behavior, PartitionDO SQL/OCC behavior,
  executor-http route, protocol parser compatibility, or `ValidatorJson`
  boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentHttpApiHandlers.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Deployment Finish Service Preflight Effects

Previous completed checkpoint: `8638044` Type public finish artifact sources.

What changed:

- `deployment/Service.ts` now exports
  `finishDeploymentPushStoreInput(...)` as the named service preflight helper
  for finish-push store input construction.
- `DeploymentService.finishPush(...)` delegates preflight input construction
  to that helper and keeps store activation/rejection behavior in
  `DeploymentPushStore`.
- The service boundary exposes typed Effect failures rather than adapter-level
  `HttpError` or generated response types.

Boundary decision:

Finish-push service preflight belongs in `DeploymentService`; final
activation/rejection semantics belong in `DeploymentPushStore`; HTTP response
mapping belongs in generated DeploymentApi handlers. This checkpoint makes
those package boundaries explicit without changing behavior.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's deployment service/store boundary around finish-push preflight.

How Flarex differs:

- Convex does not have this Cloudflare DeploymentDO plus generated Effect
  HttpApi handler split. Flarex keeps artifact-ref derivation in service
  preflight and state mutation in the Durable Object store.

Known limitations:

- No DeploymentDO routing, generated DeploymentApi response mapping, public
  Worker deployment dispatch, artifact store implementation,
  DeploymentPushStore finish activation/rejection behavior, PartitionDO
  SQL/OCC behavior, executor-http route, protocol parser compatibility, or
  `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentHttpApiHandlers.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Finish Artifact Source Effects

Previous completed checkpoint: `3b9faab` Type deployment store write
transactions.

What changed:

- `deployment/PublicFinishArtifactBoundary.ts` now exports named Effect
  helpers for finish artifact reference derivation and artifact availability
  reads.
- `verifyStoredPushArtifactEffect(...)` remains the route policy owner for the
  existing missing-artifact finish response.
- Artifact-store failures do not leak as generic errors; they become typed
  `PublicWorkerDispatchError` values before route policy mapping.

Boundary decision:

Source-package artifact reference derivation and artifact store reads belong in
`deployment/PublicFinishArtifactBoundary.ts` because they are public Worker
finish preflight behavior. DeploymentDO generated handlers and
DeploymentService still own push activation state transitions.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's public deployment finish package boundary around artifact
  preflight sources.

How Flarex differs:

- Convex does not expose this Cloudflare Worker plus R2 artifact preflight
  split. Flarex keeps artifact availability as a Worker preflight while
  preserving DeploymentDO activation semantics.

Known limitations:

- No public Worker route selection, DeploymentDO generated handler response
  mapping, DeploymentService finish-push behavior, artifact store
  implementation, PartitionDO SQL/OCC behavior, executor-http route, protocol
  parser compatibility, or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicFinishArtifactBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/publicFinishArtifactBoundary.test.ts test/publicDeploymentPushDispatchBoundary.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Deployment Store Write Transaction Effects

Previous completed checkpoint: `317db9c` Type partition route request
boundary.

What changed:

- `deployment/Store.ts` now centralizes start-push, finish-push, and
  abandon-push transaction execution in one named Effect helper.
- `DeploymentStoredPushMissingError` remains the exported missing-write
  failure, but the transaction rollback implementation uses an internal
  package-local signal.
- `DeploymentSqlError` remains the store source-boundary failure for SQL and
  storage defects.

Boundary decision:

Deployment write rollback mechanics belong inside `DeploymentPushStore`.
Exported store/service callers should receive typed deployment failures, not a
thrown transaction sentinel or generic `Error`. HTTP conversion remains in the
generated DeploymentApi handler mappers.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's deployment package boundary around Durable Object transaction
  rollback mechanics.

How Flarex differs:

- Convex does not expose this exact Cloudflare Durable Object storage
  transaction boundary. Flarex keeps the rollback implementation local to the
  deployment store package while preserving Effect-returning service/store
  APIs.

Known limitations:

- No DeploymentDO route behavior, generated DeploymentApi response mapping,
  public Worker deployment dispatch, artifact storage/materialization,
  PartitionDO SQL/OCC behavior, executor-http route, protocol parser
  compatibility, or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts test/deploymentHttpApiHandlers.test.ts test/push.test.ts -t "start|finish|abandon|DeploymentService|DeploymentPushStore" --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Partition Route Request Effects

Previous completed checkpoint: `e752f33` Type registry create request boundary.

What changed:

- `partition/RouteBoundary.ts` no longer exports Promise-returning `read*`
  request wrappers for schema-cache, commit, subscription registration,
  subscription target, or connection unregister bodies.
- `partition/RouteBoundary.ts` no longer exports throwing `parse*`
  compatibility wrappers or forwarding `parse*Effect` aliases for those
  payloads.
- `partition/PublicSchemaCacheRouteBoundary.ts` no longer exports public
  schema-cache `read*` or throwing `parse*` compatibility wrappers.
- The package boundary now exposes Effect-returning request and route payload
  decoders plus explicit HTTP adapter mappers.

Boundary decision:

Partition route payload validation belongs in `partition/Requests.ts`.
PartitionDO route JSON decoding belongs in `partition/RouteBoundary.ts`.
Public Worker schema-cache forwarding belongs in
`partition/PublicSchemaCacheRouteBoundary.ts`. HTTP conversion remains at the
Durable Object or Worker adapter edge through the route error mappers.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's partition package boundary around existing typed route decoders.

How Flarex differs:

- Convex does not have this exact Cloudflare Durable Object route-boundary
  split. Flarex keeps the split explicit while avoiding Promise/throwing
  compatibility exports inside the partition package.

Known limitations:

- No PartitionDO SQL/OCC behavior, public Worker partition dispatch,
  transaction response shape, DeploymentDO, RegistryDO, executor-http route,
  protocol package parser compatibility, or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/partitionRouteBoundary.test.ts test/publicPartitionSchemaCacheRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/partitionRouteBoundary.test.ts test/publicPartitionSchemaCacheRouteBoundary.test.ts test/transaction.test.ts test/sync.test.ts -t "schema-cache|commit|subscription|connection unregister|PartitionDO" --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Registry Create Request Effects

Previous completed checkpoint: `9f81903` Type public invoke request boundary.

What changed:

- `registry/Requests.ts` no longer exports throwing
  `parseRegistryCreateDeploymentPayload(...)`.
- `registry/HttpApiRouteBoundary.ts` no longer exports the Promise-returning
  `registryApiRequestForRoute(...)` or
  `readRegistryCreateDeploymentRouteRequest(...)` compatibility helpers.
- The registry create request source and route boundaries now expose
  Effect-returning decoders.

Boundary decision:

Registry create payload validation belongs in `registry/Requests.ts` as an
Effect-returning decoder. RegistryDO route JSON decoding and generated-handler
request construction remain in `registry/HttpApiRouteBoundary.ts`; HTTP
conversion remains in `registry/InternalRouteBoundary.ts` and the existing
route error mapper.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's RegistryDO request boundary around existing protocol decoders.

How Flarex differs:

- Convex does not have this exact Cloudflare RegistryDO plus generated Effect
  HttpApi adapter split. Flarex keeps the split explicit while sharing typed
  registry payload decoders.

Known limitations:

- No RegistryService, RegistryStore, RegistryDO generated web handler behavior,
  DeploymentDO, PartitionDO SQL/OCC behavior, executor-http route, protocol
  package parser compatibility, or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/registryRequests.test.ts test/registryHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/registryRequests.test.ts test/registryHttpApiRouteBoundary.test.ts test/registryHttpApiHandlers.test.ts test/registryService.test.ts test/registryDO.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Invoke Request Effects

Previous completed checkpoint: `670517c` Remove registry HttpError adapter
bridge.

What changed:

- `invoke/Requests.ts` no longer exports throwing
  `parsePublicInvokePayload(...)`.
- The backend invoke request source boundary now exposes Effect-returning
  decoding plus typed public invoke request construction helpers.
- Tests now exercise the typed decoder channels directly and leave HTTP
  mapping assertions in public invoke route/Worker boundary tests.

Boundary decision:

Public invoke payload validation belongs to the protocol decoder consumed
through `invoke/Requests.ts`. Public Worker route JSON decoding remains in
`invoke/PublicInvokeRouteBoundary.ts`; deployment id selection and backend
invoke request construction remain typed helpers in `invoke/Requests.ts`.
HTTP conversion remains at the public Worker route adapter.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's public invoke request boundary around existing protocol decoders.

How Flarex differs:

- Convex does not have this exact public Worker invoke adapter plus artifact
  runtime/direct execution split. Flarex keeps that split explicit while
  sharing typed public invoke payload decoding.

Known limitations:

- No public invoke Worker routing, artifact runtime dispatch, direct invoke
  execution, active deployment loading, PartitionDO SQL/OCC behavior,
  executor-http route, protocol package parser compatibility, or
  `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/invokeRequests.test.ts test/publicInvokeRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/invokeRequests.test.ts test/publicInvokeRouteBoundary.test.ts test/invoke.test.ts test/publicWorkerRouteDispatchError.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Registry Adapter Response Effects

Previous completed checkpoint: `a72b6f2` Remove deployment HttpError adapter
bridge.

What changed:

- Removed `registry/HttpBoundary.ts` as a legacy Registry `HttpError` adapter
  module.
- Removed `registryFailureToHttpError(...)` and the compatibility-only
  registry HTTP boundary test.
- The RegistryApi generated handler boundary now relies on typed storage and
  protocol response mappers.

Boundary decision:

Registry store failures stay as `RegistrySqlError` until generated Registry
HttpApi handlers convert them to declared `RegistryStorageErrorResponse`
values. Generic `HttpError` is no longer a registry service failure adapter;
RegistryDO route JSON/protocol errors continue to map through the route
boundary adapters.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's registry package boundary around generated HttpApi response mapping.

How Flarex differs:

- Convex does not use this Cloudflare RegistryDO plus generated Effect HttpApi
  adapter split. Flarex keeps the split explicit while avoiding a parallel
  registry-specific `HttpError` response path.

Known limitations:

- No RegistryService, RegistryStore, RegistryDO routing, generated Registry
  HttpApi web handler behavior, DeploymentDO, PartitionDO SQL/OCC behavior,
  executor-http route, or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/registryHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/registryHttpApiHandlers.test.ts test/registryHttpApiRouteBoundary.test.ts test/registryService.test.ts test/registryDO.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Deployment Adapter Response Effects

Previous completed checkpoint: `213dce6` Type delivery wake request boundary.

What changed:

- Removed `deployment/HttpBoundary.ts` as a legacy Deployment `HttpError`
  adapter module.
- Removed `deploymentFailureToHttpError(...)`, `finishPushHttpStatus(...)`,
  and the `deploymentHttpErrorTo*Response(...)` compatibility helpers.
- Removed the matching compatibility-only deployment HTTP boundary test.
- The DeploymentApi generated handler boundary now relies on typed response
  mappers and named Effect adapter wrappers.

Boundary decision:

Deployment service/domain failures stay in deployment error types until the
generated HttpApi handler adapter converts them to declared DeploymentApi
response classes. Generic `HttpError` is no longer a deployment service failure
adapter; DeploymentDO route JSON/protocol errors continue to map through the
route boundary adapters.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's deployment package boundary around generated HttpApi response
  mapping.

How Flarex differs:

- Convex does not use this Cloudflare DeploymentDO plus generated Effect HttpApi
  adapter split. Flarex keeps the split explicit while avoiding a parallel
  deployment-specific `HttpError` response path.

Known limitations:

- No DeploymentService, DeploymentPushStore, DeploymentDO routing, public
  deployment push dispatch, artifact storage/materialization, PartitionDO
  SQL/OCC behavior, executor-http route, or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts test/deploymentService.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/publicDeploymentPushDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Delivery Wake Request Effects

Previous completed checkpoint: `54144cd` Type execution request payload
boundary.

What changed:

- `delivery/RouteBoundary.ts` no longer exports the Promise-returning
  `readDeliveryWakeRequest(...)` wrapper.
- `delivery/RouteBoundary.ts` no longer exports the throwing
  `parseDeliveryWakeRequest(...)` wrapper or
  `parseDeliveryWakeRequestEffect(...)` forwarding alias.
- The delivery wake route source boundary now exposes Effect-returning decoders
  for request and route payload validation.
- Tests now exercise the typed decoder channels directly and leave HTTP
  mapping assertions in route adapter tests.

Boundary decision:

Delivery wake payload validation belongs in `delivery/WakeRequest.ts`.
Internal DeliveryDO route JSON decoding remains in `delivery/RouteBoundary.ts`;
public Worker wake JSON decoding remains in `delivery/PublicWakeRouteBoundary.ts`.
HTTP response conversion remains in `delivery/InternalRouteBoundary.ts`, the
public Worker route adapter, and the existing wake route HTTP mappers.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's Cloudflare delivery wake request boundary around existing decoders.

How Flarex differs:

- Convex does not have this exact Cloudflare public Worker plus DeliveryDO
  wake route split. Flarex keeps the split explicit while sharing typed wake
  payload decoders.

Known limitations:

- No DeliveryDO drain/coalescing/alarm behavior, public wake dispatch,
  SchedulerDO wake behavior, live-query fanout/claim/ack semantics,
  PartitionDO SQL/OCC behavior, executor-http route, or `ValidatorJson`
  boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deliveryRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deliveryRouteBoundary.test.ts test/publicDeliveryWakeRouteBoundary.test.ts test/publicDeliveryWakeDispatchBoundary.test.ts test/schedulerDeliveryWakeBoundary.test.ts test/deliveryDO.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Execution Request Payload Effects

Previous completed checkpoint: `9931afa` Type deployment push payload
boundary.

What changed:

- `execution/Requests.ts` no longer exports throwing
  `parseExecution*Payload(...)` wrappers.
- `execution/Requests.ts` no longer exports throwing
  `parsePublicExecution*Payload(...)` wrappers.
- The execution request source boundary now exposes only Effect-returning
  decoders for those payloads.
- Tests now exercise the typed decoder channels directly and leave HTTP
  mapping assertions in the route/dispatch boundary tests.

Boundary decision:

Execution payload validation belongs in `execution/Requests.ts` as
Effect-returning decoders. Internal ExecutionDO route decoding remains in
`execution/StartRouteBoundary.ts`, `execution/SyscallRouteBoundary.ts`, and
`execution/FinishRouteBoundary.ts`; public Worker action route decoding remains
in `execution/ActionRouteBoundary.ts`.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's execution request source boundary around existing protocol decoders.

How Flarex differs:

- Convex does not have this exact Cloudflare public Worker plus ExecutionDO
  session route split. Flarex keeps the split explicit while sharing typed
  execution payload decoders.

Known limitations:

- No ExecutionDO routing/session lifecycle, public Worker execution dispatch,
  syscall/finish semantics, direct invoke, artifact runtime dispatch,
  PartitionDO SQL/OCC behavior, executor-http route, or `ValidatorJson`
  boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/executionRequests.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/executionRequests.test.ts test/executionStartRouteBoundary.test.ts test/executionSyscallRouteBoundary.test.ts test/executionFinishRouteBoundary.test.ts test/executionActionRouteBoundary.test.ts test/publicExecutionDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Deployment Push Request Payload Effects

Previous completed checkpoint: `ad6f9df` Type scheduler maintenance route
boundary.

What changed:

- `deployment/Requests.ts` no longer exports throwing
  `parseDeployment*PushPayload(...)` wrappers.
- `deployment/Requests.ts` no longer exports throwing
  `parsePublic*PushPayload(...)` wrappers.
- The deployment push request source boundary now exposes only
  Effect-returning decoders for those payloads.
- Tests now exercise the typed decoder channels directly and leave HTTP
  mapping assertions in the route/handler boundary tests.

Boundary decision:

Deployment push payload validation belongs in `deployment/Requests.ts` as
Effect-returning decoders. Internal DeploymentDO route decoding remains in
`deployment/HttpApiRouteBoundary.ts`, public Worker route decoding remains in
`deployment/PublicPushRouteBoundary.ts`, and HttpApi/service response mapping
remains in `deployment/HttpApiHandlers.ts`.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's deployment push request source boundary around existing protocol
  decoders.

How Flarex differs:

- Convex does not have this exact Cloudflare DeploymentDO plus public Worker
  push forwarding split. Flarex keeps the split explicit while sharing typed
  push payload decoders.

Known limitations:

- No DeploymentDO routing, HttpApi handler behavior, DeploymentService,
  DeploymentPushStore, artifact storage/materialization, public Worker
  dispatch, executor-http route, PartitionDO SQL/OCC behavior, or
  `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentRequests.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentRequests.test.ts test/deploymentHttpApiRouteBoundary.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/deploymentHttpApiHandlers.test.ts test/publicDeploymentPushDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Scheduler Maintenance JSON Route Boundary Effects

Previous completed checkpoint: `86cac22` Type connection JSON route boundary.

What changed:

- `scheduler/RouteBoundary.ts` no longer exports Promise-returning
  `readScheduler*Request(...)` wrappers for the five maintenance routes.
- `scheduler/RouteBoundary.ts` no longer exports public throwing
  `parseScheduler*Request(...)` compatibility wrappers or
  `parseScheduler*RequestEffect(...)` aliases for those routes.
- The private `runSchedulerRouteEffect(...)` compatibility runner was removed.
- The scheduler maintenance route boundary now exposes Effect-returning
  request decoders, payload decoders, and named HTTP adapters.
- Tests now exercise typed scheduler request/body decoder channels directly
  and keep HTTP mapping assertions at the named adapter edges.

Boundary decision:

Scheduler maintenance request decoding belongs in `scheduler/RouteBoundary.ts`
and `scheduler/Requests.ts` as Effect-returning decoders. SchedulerDO remains
the runtime owner for route selection, pending-state storage, reconciliation
loops, alarm behavior, and operation dispatch. HTTP conversion for request
decode failures now belongs to `scheduler/InternalRouteBoundary.ts`; operation,
pending-state, and runtime failures remain mapped by the existing scheduler
internal adapters.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's SchedulerDO maintenance adapter boundary around existing scheduler
  request decoders.

How Flarex differs:

- Convex does not have this exact Cloudflare Durable Object maintenance JSON
  route split. Flarex keeps that split explicit while keeping request/body
  validation typed until the adapter edge.

Known limitations:

- No SchedulerDO alarm behavior, pending-state storage, runtime reconciliation
  loops, public Worker dispatch, ConnectionDO, DeliveryDO, PartitionDO SQL/OCC
  behavior, executor-http route, protocol schemas, or `ValidatorJson` boundary
  changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/schedulerRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/schedulerRouteBoundary.test.ts test/publicSchedulerRouteBoundary.test.ts test/publicSchedulerDispatchBoundary.test.ts test/schedulerResponses.test.ts test/liveQueryDelivery.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Connection JSON Route Boundary Effects

Previous completed checkpoint: `e3e4f79` Type artifact runtime invoke
boundary.

What changed:

- `connection/RouteBoundary.ts` no longer exports
  `readConnectionInvalidationRequest(...)`,
  `readConnectionLiveQueryDeliveryRequest(...)`,
  `parseConnectionInvalidationRequest(...)`,
  `parseConnectionLiveQueryDeliveryRequest(...)`,
  `parseConnectionInvalidationRequestEffect(...)`, or
  `parseConnectionLiveQueryDeliveryRequestEffect(...)`.
- `connection/Requests.ts` no longer exports the throwing
  `parseConnectionInvalidationPayload(...)` compatibility wrapper.
- The connection JSON route boundary now exposes Effect-returning request
  decoders, payload decoders, and named HTTP adapters.
- Tests now exercise typed request/body decoder channels directly and keep
  HTTP mapping assertions at the named adapter edges.

Boundary decision:

Connection invalidation and live-query delivery request decoding belongs in
`connection/RouteBoundary.ts` and `connection/Requests.ts` as Effect-returning
decoders. ConnectionDO remains the runtime owner for route selection, query
reruns, websocket state, and dispatch into invalidation/live-query handlers.
HTTP conversion for request decode failures remains at the ConnectionDO adapter
edge; operation failures remain at
`connectionRouteOperationErrorToHttpError(...)` /
`connectionRouteOperationErrorToHttpErrorEffect(...)`.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's ConnectionDO JSON adapter boundary around existing sync/live-query
  decoders.

How Flarex differs:

- Convex does not have this exact Cloudflare Durable Object internal JSON route
  split for invalidation and live-query delivery. Flarex keeps that split
  explicit while keeping request/body validation typed until the adapter edge.

Known limitations:

- No websocket sync semantics, query rerun behavior, executor subscription
  writes, live-query delivery fanout, public Worker dispatch, DeliveryDO,
  SchedulerDO, PartitionDO SQL/OCC behavior, executor-http route, protocol
  schemas, or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/connectionRequests.test.ts test/connectionRouteBoundary.test.ts test/connectionRouteDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/connectionRequests.test.ts test/connectionRouteBoundary.test.ts test/connectionRouteDispatchBoundary.test.ts test/liveQueryDelivery.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Artifact Runtime Invoke Route Boundary Effects

Previous completed checkpoint: `58ec773` Type internal execution route
boundaries.

What changed:

- `artifactRuntime/RouteBoundary.ts` no longer exports
  `readExecutionArtifactInvokePayload(...)`,
  `parseExecutionArtifactInvokePayload(...)`, or
  `parseExecutionArtifactInvokePayloadEffect(...)`.
- `artifactRuntime/Requests.ts` no longer exports the throwing
  `parseExecutionArtifactInvokePayloadBody(...)` compatibility wrapper.
- The artifact runtime invoke boundary now exposes Effect-returning request
  and payload decoders; the artifact runtime adapter owns HTTP mapping.
- Tests now exercise `RequestJsonError` and
  `ExecutionArtifactInvokePayloadError` channels directly before the adapter
  mapping assertions.

Boundary decision:

Artifact runtime invoke request decoding belongs in
`artifactRuntime/RouteBoundary.ts` and `artifactRuntime/Requests.ts` as
Effect-returning decoders. Runtime route orchestration remains in
`artifactRuntime/RuntimeRoute.ts`, including authorization, header validation,
source-package resolution, materializer/cache calls, and artifact invocation.
HTTP conversion for invoke request decode failures remains at the artifact
runtime adapter edge.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's artifact runtime invoke adapter boundary around existing runtime
  decoders.

How Flarex differs:

- Convex does not have this exact Cloudflare artifact materialization and
  runtime invoke route shape. Flarex keeps that runtime orchestration explicit
  while keeping request/body validation typed until the adapter edge.

Known limitations:

- No runtime request authorization, artifact header validation, source-package
  resolution, materializer/cache behavior, artifact invoke execution,
  deployment artifact behavior, public Worker dispatch, executor-http route,
  PartitionDO SQL/OCC behavior, or `ValidatorJson` boundary changed.
- Lower-level artifact runtime service/operation errors remain available for
  later route/service migration slices.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/artifactRuntimeRequests.test.ts test/artifactRuntimeRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/artifactRuntimeRequests.test.ts test/artifactRuntimeRouteBoundary.test.ts test/artifactRuntimeRoute.test.ts test/artifactRuntime.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Internal Execution Route Boundary Effects

Previous completed checkpoint: `5fc55a7` Type deployment HttpApi route
boundary.

What changed:

- `execution/StartRouteBoundary.ts` no longer exports
  `readExecutionStartRequest(...)`, `parseExecutionStartRouteRequest(...)`, or
  `parseExecutionStartRouteRequestEffect(...)`.
- `execution/SyscallRouteBoundary.ts` no longer exports
  `readExecutionSyscallRequest(...)`,
  `parseExecutionSyscallRouteRequest(...)`, or
  `parseExecutionSyscallRouteRequestEffect(...)`.
- `execution/FinishRouteBoundary.ts` no longer exports
  `readExecutionFinishRequest(...)`, `parseExecutionFinishRouteRequest(...)`,
  or `parseExecutionFinishRouteRequestEffect(...)`.
- The internal execution route boundary now exposes Effect-returning request
  decoders, payload decoders, and named route HTTP adapters.
- Tests now exercise typed decoder success/failure channels directly and keep
  HTTP mapping assertions at the named adapter edges.

Boundary decision:

Internal ExecutionDO request decoding belongs in the execution route-boundary
modules as Effect-returning decoders. ExecutionDO remains the runtime owner for
session routing, start/syscall/finish orchestration, and response envelopes.
HTTP conversion for route decode failures remains at
`executionStartRouteErrorToHttpErrorEffect(...)`,
`executionSyscallRouteErrorToHttpErrorEffect(...)`, and
`executionFinishRouteErrorToHttpErrorEffect(...)`.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's ExecutionDO adapter boundary around existing execution protocol
  decoders.

How Flarex differs:

- Convex does not have this exact Cloudflare Durable Object execution session
  route split. Flarex keeps that split explicit while keeping request/body
  validation typed until the adapter edge.

Known limitations:

- No ExecutionDO session routing/runtime behavior, syscall handling, finish
  semantics, public execution dispatch, PartitionDO SQL/OCC behavior,
  executor-http route, deployment behavior, or `ValidatorJson` boundary
  changed.
- Lower-level execution payload parser compatibility wrappers remain for now.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/executionStartRouteBoundary.test.ts test/executionSyscallRouteBoundary.test.ts test/executionFinishRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/executionStartRouteBoundary.test.ts test/executionSyscallRouteBoundary.test.ts test/executionFinishRouteBoundary.test.ts test/executionRequests.test.ts test/executionDO.test.ts test/executionRouteOperationError.test.ts test/executionSessionError.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Deployment HttpApi Route Boundary Effects

Previous completed checkpoint: `4ad8613` Type deployment validation surface.

What changed:

- `deployment/HttpApiRouteBoundary.ts` no longer exports
  `deploymentApiRequestForRoute(...)`.
- The same module no longer exports Promise-returning `readDeployment*`
  request wrappers.
- The same module no longer exports public throwing
  `parseDeployment*RouteRequest(...)` or
  `parseDeployment*RouteRequestEffect(...)` compatibility wrappers.
- The deployment HttpApi route boundary now exposes Effect-returning route
  request decoders, route payload decoders, and the route HTTP error adapter.
- Tests now exercise the typed decoder channels directly and keep response
  mapping assertions at the DeploymentDO/internal adapter edges.

Boundary decision:

Deployment HttpApi request canonicalization belongs in
`deployment/HttpApiRouteBoundary.ts` as Effect-returning decoders. Durable
Object request routing belongs in `deployment/InternalRouteBoundary.ts`, which
continues to call `decodeDeploymentApiRequestForRoute(...)`. Generated HttpApi
handler behavior remains in `deployment/HttpApiHandlers.ts`. HTTP conversion
for route decode failures remains at `deploymentRouteErrorToHttpError(...)` /
`deploymentRouteErrorToHttpErrorEffect(...)` and the DeploymentDO response
adapter.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's DeploymentDO/HttpApi adapter boundary around existing request
  decoders.

How Flarex differs:

- Convex does not have this exact Cloudflare Durable Object to generated
  HttpApi bridge. Flarex keeps the bridge explicit while ensuring request/body
  validation remains typed until the adapter response edge.

Known limitations:

- No DeploymentDO routing semantics, generated HttpApi handler behavior,
  deployment store/service behavior, artifact materialization/ref validation,
  public deployment dispatch, executor-http route, PartitionDO SQL/OCC
  behavior, or `ValidatorJson` boundary changed.
- Deployment service/store failure modeling remains available for later
  route/service migration slices.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiRouteBoundary.test.ts test/deploymentHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiRouteBoundary.test.ts test/deploymentHttpApiHandlers.test.ts test/deploymentValidation.test.ts test/deploymentStore.test.ts test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Deployment Validation Domain Effects

Previous completed checkpoint: `8258d38` Type public scheduler route
boundary.

What changed:

- `deployment/Validation.ts` no longer exports throwing validation wrappers
  such as `validateSourcePackage(...)`, `validateAnalysis(...)`, or
  `pushStatusFromRow(...)`.
- `deployment/Validation.ts` no longer exports `DeploymentValidationResult` or
  `parsePushStatusFromRow(...)`.
- The deployment validation boundary now exposes Effect-returning decoders for
  validation paths that can fail with `DeploymentValidationError`.
- `codegenAnalysisFromDeploymentAnalysis(...)` remains exported as a pure
  transformation helper.
- `deploymentValidation.test.ts` uses local sync helpers only for fixture
  setup; the removed wrappers are no longer production APIs.

Boundary decision:

Deployment domain validation belongs in `deployment/Validation.ts` as
Effect-returning decoders. Deployment store reads/writes remain in
`deployment/Store.ts`, HttpApi request/response handling remains in
`deployment/HttpApiHandlers.ts` and route-boundary modules, and HTTP response
mapping remains at the deployment handler/adapter edges. Validation failures
should stay as `DeploymentValidationError` until those adapter edges map them
to protocol responses.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's deployment validation package boundary around existing domain
  decoders.

How Flarex differs:

- Flarex's deployment validation normalizes source packages, analyzed function
  metadata, generated codegen metadata, and stored push rows before Durable
  Object storage and HttpApi handlers use them. This checkpoint does not change
  the deployment runtime topology; it only removes exported throwing/result
  compatibility APIs.

Known limitations:

- No deployment store transaction behavior, DeploymentDO/HttpApi routing,
  artifact materialization/ref validation, public deployment dispatch,
  executor-http route, PartitionDO SQL/OCC behavior, source-package persistence
  behavior, or `ValidatorJson` boundary changed.
- Further deployment service/store migration work can still reduce direct
  adapter response mapping in later slices.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentValidation.test.ts test/deploymentHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentValidation.test.ts test/deploymentHttpApiHandlers.test.ts test/deploymentStore.test.ts test/deploymentHttpApiRouteBoundary.test.ts test/publicDeploymentPushRouteBoundary.test.ts test/publicDeploymentPushDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Scheduler Route Boundary Effects

Previous completed checkpoint: `e509217` Type public invoke delivery route
boundaries.

What changed:

- `scheduler/PublicRouteBoundary.ts` no longer exports public
  Promise-returning scheduler maintenance request wrappers.
- `scheduler/PublicRouteBoundary.ts` no longer exports public throwing
  `parsePublicScheduler*Request(...)` compatibility wrappers.
- The public scheduler boundary now exposes only Effect-returning public
  scheduler request decoders.
- Trigger subscription request decoding remains an alias to the rerun
  subscription decoder.
- Tests now exercise scheduler request decoder success/failure channels
  directly and keep HTTP mapping assertions at the named adapter edge.

Boundary decision:

Public scheduler route request decoding belongs in
`scheduler/PublicRouteBoundary.ts`. Public Worker orchestration and dispatch
remain in `worker.ts` and `scheduler/PublicDispatchBoundary.ts`. Internal
SchedulerDO maintenance route decoding remains in the internal scheduler route
boundary. Public scheduler HTTP conversion now belongs to the Worker adapter,
not per-wrapper Promise helpers or throwing parser wrappers.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's Cloudflare Worker maintenance scheduler adapter surface around
  existing scheduler request decoders.

How Flarex differs:

- Convex does not have these exact Cloudflare Worker maintenance scheduler
  adapters. Flarex keeps Worker route splitting, scheduler dispatch, and
  Durable Object maintenance behavior in their existing modules while
  preserving typed validation before HTTP response mapping.

Known limitations:

- No scheduler dispatch/runtime/persistence behavior, DeliveryDO behavior,
  ConnectionDO behavior, live-query behavior, executor-http route, PartitionDO
  SQL/OCC behavior, deployment route, or `ValidatorJson` boundary changed.
- Internal scheduler route compatibility wrappers remain for now.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicSchedulerRouteBoundary.test.ts test/publicSchedulerDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/publicSchedulerRouteBoundary.test.ts test/publicSchedulerDispatchBoundary.test.ts test/schedulerRouteBoundary.test.ts test/schedulerDelivery.test.ts test/schedulerConnections.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Invoke/Delivery Route Boundary Effects

Previous completed checkpoint: `faec11b` Type public execution route
boundaries.

What changed:

- `invoke/PublicInvokeRouteBoundary.ts` no longer exports public
  Promise-returning or throwing route request wrappers.
- `delivery/PublicWakeRouteBoundary.ts` no longer exports public
  Promise-returning or throwing route request wrappers.
- `liveQueryDelivery/RouteBoundary.ts` no longer exports public
  Promise-returning or throwing route request wrappers.
- Tests now exercise invoke, delivery wake, and live query delivery route
  decoder success/failure channels directly and keep HTTP mapping assertions at
  the named adapter edges.

Boundary decision:

Public invoke route decoding belongs in `invoke/PublicInvokeRouteBoundary.ts`.
Public delivery wake decoding belongs in `delivery/PublicWakeRouteBoundary.ts`.
Public live query delivery decoding belongs in
`liveQueryDelivery/RouteBoundary.ts`. Public Worker orchestration and Durable
Object dispatch remain in `worker.ts` and the existing dispatch boundary
modules. HTTP conversion for these public routes belongs to the Worker adapter
edge.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's Cloudflare Worker adapter surface around existing request decoders.

How Flarex differs:

- Convex does not have these exact Cloudflare Worker public route adapters.
  Flarex keeps Worker route splitting and Durable Object/service dispatch in
  the public Worker layer while preserving typed validation before HTTP
  response mapping.

Known limitations:

- No public dispatch behavior, DeliveryDO behavior, live query delivery
  application behavior, invoke execution dispatch, PartitionDO SQL/OCC
  behavior, executor-http route, deployment route, or `ValidatorJson` boundary
  changed.
- Lower-level payload parser compatibility wrappers remain for now.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicInvokeRouteBoundary.test.ts test/publicDeliveryWakeRouteBoundary.test.ts test/publicLiveQueryDeliveryRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/publicInvokeRouteBoundary.test.ts test/publicDeliveryWakeRouteBoundary.test.ts test/publicLiveQueryDeliveryRouteBoundary.test.ts test/invokeRequests.test.ts test/publicDeliveryWakeDispatchBoundary.test.ts test/publicLiveQueryDeliveryDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Execution Route Boundary Effects

Previous completed checkpoint: `f6f5fa0` Type public deployment push route
boundary.

What changed:

- `execution/StartRouteBoundary.ts` no longer exports the public
  Promise-returning `readPublicExecutionStartRequest(...)` wrapper.
- `execution/StartRouteBoundary.ts` no longer exports public throwing
  `parsePublicExecutionStartRouteRequest(...)` compatibility wrappers.
- `execution/ActionRouteBoundary.ts` no longer exports the public
  Promise-returning `readPublicExecutionActionRequest(...)` wrapper.
- `execution/ActionRouteBoundary.ts` no longer exports public throwing
  `parsePublicExecutionActionRequest(...)` compatibility wrappers.
- Tests now exercise public execution route decoder success/failure channels
  directly and keep HTTP mapping assertions at the named adapter edges.

Boundary decision:

Public execution route request decoding belongs to the Effect decoders in
`execution/StartRouteBoundary.ts` and `execution/ActionRouteBoundary.ts`.
Public Worker orchestration remains in `worker.ts`, and forwarding remains in
`execution/PublicDispatchBoundary.ts`. HTTP conversion remains in
`executionStartRouteErrorToHttpError(...)`,
`publicExecutionActionRouteErrorToHttpError(...)`, and the public execution
path adapter mapping in `worker.ts`. Internal execution start wrappers remain
for the separate ExecutionDO/internal route boundary.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint narrows
  Flarex's Cloudflare Worker adapter surface around existing execution
  protocol decoders.

How Flarex differs:

- Convex does not have this exact Cloudflare Worker public execution adapter.
  Flarex keeps Cloudflare Worker path parsing and Durable Object dispatch in
  the public Worker layer while preserving typed protocol validation before
  HTTP response mapping.

Known limitations:

- No public execution dispatch behavior, ExecutionDO behavior, PartitionDO
  SQL/OCC behavior, executor-http route, deployment route, or `ValidatorJson`
  boundary changed.
- Lower-level execution request payload parser compatibility wrappers remain
  for now.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/executionStartRouteBoundary.test.ts test/executionActionRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/executionStartRouteBoundary.test.ts test/executionActionRouteBoundary.test.ts test/executionRequests.test.ts test/publicExecutionDispatchBoundary.test.ts test/publicWorkerRouteDispatchError.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Deployment Push Route Boundary Effects

Previous completed checkpoint: `67ab41f` Type deployment start input handler.

What changed:

- `deployment/PublicPushRouteBoundary.ts` now exposes only Effect-returning
  public deployment push decoders and the route-level HTTP adapter.
- Unused Promise wrappers that mapped route failures to `HttpError` were
  removed.
- Unused throwing route-level `parsePublic*PushRequest(...)` wrappers and
  their `parsePublic*PushRequestEffect(...)` aliases were removed.
- The redundant JSON-only adapter effect was removed in favor of
  `publicDeploymentRouteErrorToHttpErrorEffect(...)`.
- Tests now exercise typed route decoder success/failure channels directly and
  keep HTTP mapping assertions at the named route adapter edge.

Boundary decision:

Public deployment push route decoding belongs in
`deployment/PublicPushRouteBoundary.ts`. Public Worker orchestration remains in
`worker.ts`, including analyzer availability checks and artifact preflight.
Forwarding to DeploymentDO remains in `deployment/PublicPushDispatchBoundary.ts`.
The only HTTP adapter for public deployment push route decoding is now
`publicDeploymentRouteErrorToHttpError(...)` /
`publicDeploymentRouteErrorToHttpErrorEffect(...)`, not per-wrapper Promise
helpers or throwing parser wrappers.

Convex references:

- No Convex source files were inspected for this slice. This checkpoint only
  narrows Flarex's Cloudflare Worker adapter surface around existing protocol
  decoders.

How Flarex differs:

- Convex does not have this exact Cloudflare Worker/Durable Object public push
  adapter boundary. Flarex keeps the Cloudflare-specific route splitting,
  analyzer service binding, artifact store preflight, and DO dispatch in the
  Worker layer while keeping protocol validation typed at the boundary.

Known limitations:

- No analyzer behavior, artifact persistence/preflight, public dispatch
  behavior, DeploymentDO/DeploymentService/store behavior, executor-http
  route, PartitionDO SQL/OCC behavior, or `ValidatorJson` boundary changed.
- Lower-level deployment request payload parser compatibility wrappers remain
  for now.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicDeploymentPushRouteBoundary.test.ts test/publicDeploymentPushDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/publicDeploymentPushRouteBoundary.test.ts test/publicDeploymentPushDispatchBoundary.test.ts test/publicStartArtifactBoundary.test.ts test/publicFinishArtifactBoundary.test.ts test/deploymentRequests.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Deployment Start Input Handler Effects

Previous completed checkpoint: `3f831f0` Type artifact runtime route adapters.

What changed:

- `deployment/HttpApiHandlers.ts` no longer exports the synchronous
  `startAnalyzedPushHandlerInputFromPayload(...)` helper.
- `decodeStartAnalyzedPushHandlerInput(...)` remains the single
  handler-owned route from `flarex-protocol` payload validation through
  backend deployment validation into `StartAnalyzedPushInput`.
- The HTTP API handler tests now validate bad start payloads by flipping the
  typed Effect failure channel and then using the existing deployment start
  response adapter.

Boundary decision:

Protocol shape validation remains in `flarex-protocol/deployment` and
`deployment/Requests.ts`. Backend semantic validation remains in
`deployment/Validation.ts`. The HTTP API handler owns composition of those
two validation steps before calling `DeploymentService.startAnalyzedPush`.
HTTP response conversion remains in `deploymentStartFailureToResponse(...)`;
this checkpoint removes a duplicate synchronous handler adapter rather than
moving validation into DeploymentDO, DeploymentService, public Worker dispatch,
executor-http, or `ValidatorJson`.

Known limitations:

- No DeploymentService/store behavior, DeploymentDO route behavior, public
  deployment push dispatch, executor-http route, artifact runtime behavior,
  PartitionDO SQL/OCC behavior, or `ValidatorJson` boundary changed.
- Legacy synchronous parser wrappers remain where they are still explicit
  compatibility surfaces.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiHandlers.test.ts test/deploymentValidation.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiHandlers.test.ts test/deploymentValidation.test.ts test/deploymentHttpApiRouteBoundary.test.ts test/deploymentRequests.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Execution Artifact Runtime Route Adapter Effects

Previous completed checkpoint: `6f130f1` Type delivery route adapters.

What changed:

- `createExecutionArtifactRuntimeService(...)` now routes runtime route
  failures through the named
  `executionArtifactRuntimeRouteErrorToResponseEffect(...)` adapter.
- The old private tag-table recovery wrapper was removed from
  `artifactRuntime.ts`.
- Tests continue to assert typed runtime route failures and response mapping
  at the runtime service edge.

Boundary decision:

Runtime route decoding and authorization remain in
`artifactRuntime/RuntimeRoute.ts`. Runtime request payload decoding remains in
`artifactRuntime/RouteBoundary.ts` and `artifactRuntime/Requests.ts`.
Materializer/cache behavior and service-binding runtime client behavior remain
in `artifactRuntime.ts`. HTTP response conversion for the in-process execution
artifact runtime service belongs to the named runtime route adapter edge, not
DeploymentDO, ExecutionDO, public Worker routing, executor-http, or
`ValidatorJson`.

Known limitations:

- No materializer cache behavior, runtime-store source-package loading,
  service-binding runtime client behavior, public Worker route, DeploymentDO or
  ExecutionDO behavior, executor-http route, PartitionDO SQL/OCC behavior, or
  `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/artifactRuntime.test.ts test/artifactRuntimeRequests.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/artifactRuntime.test.ts test/artifactRuntimeRequests.test.ts test/artifactRuntimeRoute.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## DeliveryDO Internal Route Adapter Effects

Previous completed checkpoint: `f020e80` Type scheduler route adapters.

What changed:

- `delivery/InternalRouteBoundary.ts` now owns DeliveryDO internal route
  HTTP/response adapter mapping without importing Cloudflare runtime globals.
- `deliveryDO.ts` now routes `runDeliveryRoute(...)` recovery through the
  named response adapter.
- Tests assert the named internal route HTTP and response adapters directly
  while preserving DeliveryDO route behavior through Miniflare.

Boundary decision:

Delivery wake request decoding remains in `delivery/RouteBoundary.ts`.
Pending-drain state validation remains in `delivery/PendingDrainState.ts`.
Delivery operation failures remain in `delivery/RouteOperationError.ts`.
Drain orchestration, persistence, alarm retry, and the concrete
`DeliveryDrainFailureError` remain in `deliveryDO.ts`. HTTP response conversion
for internal DeliveryDO route failures belongs to
`delivery/InternalRouteBoundary.ts`, not the drain scheduler, public Worker
wake dispatch, SchedulerDO, executor-http, or `ValidatorJson`.

Known limitations:

- No DeliveryDO claim/fanout/ack scheduling, pending-drain storage,
  alarm/retry behavior, public Worker wake dispatch, service binding
  configuration, SchedulerDO behavior, executor-http route, PartitionDO
  SQL/OCC behavior, or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deliveryRouteBoundary.test.ts test/deliveryDO.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deliveryRouteBoundary.test.ts test/deliveryDO.test.ts test/schedulerDeliveryWakeBoundary.test.ts test/liveQueryDelivery.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Scheduler Response/Internal Route Adapter Effects

Previous completed checkpoint: `d0094a8` Type live query fanout adapters.

What changed:

- `scheduler/Responses.ts` now exposes named HTTP adapter effects for
  downstream scheduler response and response-payload failures.
- `scheduler/InternalRouteBoundary.ts` now exposes named internal route
  HTTP/response adapter effects and routes `runSchedulerRoute(...)` through the
  named response adapter.
- Tests assert those adapter effects directly while preserving the existing
  scheduler route response behavior.

Boundary decision:

Scheduler request decoding remains in `scheduler/RouteBoundary.ts`.
Downstream executor/DO response decoding remains in `scheduler/Responses.ts`.
Scheduler maintenance, wake, reconnect, pending state, and runtime behavior
remain in their existing scheduler modules. HTTP response conversion for
internal scheduler route failures belongs to `scheduler/InternalRouteBoundary.ts`,
not the runtime helpers, public Worker scheduler dispatch, DeliveryDO,
ConnectionDO, executor-http, or `ValidatorJson`.

Known limitations:

- No SchedulerDO maintenance/runtime behavior, pending state persistence,
  public Worker scheduler dispatch, service binding configuration,
  DeliveryDO/ConnectionDO behavior, executor-http route, PartitionDO SQL/OCC
  behavior, or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/schedulerResponses.test.ts test/schedulerRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/schedulerResponses.test.ts test/schedulerRouteBoundary.test.ts test/schedulerMaintenanceBoundary.test.ts test/schedulerDeliveryWakeBoundary.test.ts test/schedulerForceReconnectBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Live-Query Delivery Fanout Adapter Effects

Previous completed checkpoint: `9942f6b` Type partition route adapters.

What changed:

- `liveQueryDeliveryResponses.ts` now exposes named HTTP adapter effects for
  downstream live-query response and response-payload failures.
- `liveQueryDelivery.ts` now represents ConnectionDO service-binding fetch
  failures as typed `LiveQueryDeliveryConnectionFetchError` and keeps
  downstream fanout response/result failures typed until the fanout adapter
  edge.
- `liveQueryDelivery/PublicDispatchBoundary.ts` maps non-target fanout
  failures through the fanout adapter before wrapping them as public Worker
  dispatch failures.
- `deliveryDO.ts` uses the fanout adapter for drain failure status mapping so
  typed fanout failures preserve existing response status behavior.

Boundary decision:

Connection fanout grouping and downstream ConnectionDO response/result
validation belong to `liveQueryDelivery.ts` and `liveQueryDeliveryResponses.ts`.
Public Worker dispatch wrapping belongs to
`liveQueryDelivery/PublicDispatchBoundary.ts`. Delivery drain result shaping and
failure summaries remain in `deliveryDO.ts`. HTTP conversion for fanout
failures belongs at the fanout/public-dispatch/drain adapter edges, not inside
the fanout service effect, ConnectionDO, public Worker route matching,
executor-http, or `ValidatorJson`.

Known limitations:

- No ConnectionDO delivery logic, DeliveryDO claim/ack scheduling, public
  Worker route matching, service binding configuration, executor-http route,
  PartitionDO SQL/OCC behavior, or `ValidatorJson` boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/liveQueryDelivery.test.ts test/liveQueryDeliveryResponses.test.ts test/publicLiveQueryDeliveryDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/liveQueryDelivery.test.ts test/liveQueryDeliveryResponses.test.ts test/publicLiveQueryDeliveryDispatchBoundary.test.ts test/deliveryDO.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Partition Route Adapter Effects

Previous completed checkpoint: `28aa766` Type deployment HttpApi route
adapters.

What changed:

- `partition/RouteBoundary.ts` now exposes a named route-to-`HttpError`
  adapter effect for PartitionDO JSON and payload failures.
- `partition/PublicSchemaCacheRouteBoundary.ts` now exposes a named public
  schema-cache route adapter effect for Worker-facing schema-cache forwarding.
- `partitionDO.ts` now routes internal recovery through a named response
  adapter effect for typed route and operation failures.
- Tests assert the named route adapter effects directly while broader
  partition tests continue covering request and transaction behavior.

Boundary decision:

Partition request decoding belongs to `partition/RouteBoundary.ts` and
`partition/PublicSchemaCacheRouteBoundary.ts`. PartitionDO SQL/OCC,
schema-cache persistence, subscription state, document/index reads, and
idempotency replay remain in `partitionDO.ts`. HTTP response conversion for
PartitionDO route, payload, and operation failures belongs at the PartitionDO
response adapter edge, not the request decoders, public Worker routing,
executor-http, or `ValidatorJson`.

Known limitations:

- No SQL table layout, OCC validation, idempotency behavior, schema-cache
  persistence, subscription mutation, public Worker route matching, service
  binding configuration, executor-http route, or `ValidatorJson` boundary
  changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/partitionRouteBoundary.test.ts test/publicPartitionSchemaCacheRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/partitionRouteBoundary.test.ts test/publicPartitionSchemaCacheRouteBoundary.test.ts test/transaction.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Deployment HttpApi Route-Service Adapter Effects

Previous completed checkpoint: `3a0cb19` Type registry route adapters.

What changed:

- `deployment/HttpApiRouteBoundary.ts` now exposes an explicit route error
  alias and named route-to-`HttpError` adapter effect.
- `deployment/InternalRouteBoundary.ts` now exposes a named response adapter
  effect for DeploymentDO route, protocol, and generated-handler operation
  failures.
- Tests assert those adapter effects directly while preserving existing
  generated Deployment HttpApi and DeploymentDO route behavior.

Boundary decision:

Deployment request decoding belongs to `deployment/HttpApiRouteBoundary.ts`.
Generated endpoint orchestration remains in `deployment/HttpApiHandlers.ts`.
Deployment service and storage behavior remain behind `DeploymentService` and
`DeploymentPushStore`. HTTP response conversion for DeploymentDO fallback and
generated-handler failures belongs to `deployment/InternalRouteBoundary.ts`,
not protocol schemas, store code, public Worker routing, PartitionDO,
executor-http, or `ValidatorJson`.

Known limitations:

- No generated Deployment HttpApi handler, DeploymentService/store, active
  deployment metadata, push lifecycle write, public Worker route, service
  binding configuration, executor-http, or SQL/OCC boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiRouteBoundary.test.ts test/deploymentHttpApiHandlers.test.ts test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiRouteBoundary.test.ts test/deploymentHttpApiHandlers.test.ts test/deploymentService.test.ts test/deploymentValidation.test.ts test/push.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Registry Route-Service Adapter Effects

Previous completed checkpoint: `ae593cd` Type internal execution route
adapters.

What changed:

- `registry/HttpApiRouteBoundary.ts` now exposes a named route adapter effect
  for Registry JSON/protocol failures.
- `registry/InternalRouteBoundary.ts` now exposes a named response adapter
  effect for RegistryDO route, protocol, and generated-handler operation
  failures.
- Tests assert those adapter effects directly while preserving existing
  RegistryDO and generated HttpApi behavior.

Boundary decision:

Registry request decoding belongs to `registry/HttpApiRouteBoundary.ts`.
Generated HttpApi response shaping remains in `registry/HttpApiHandlers.ts`.
Registry service behavior remains behind `RegistryService` and `RegistryStore`.
HTTP response conversion for RegistryDO fallback and generated-handler failures
belongs to `registry/InternalRouteBoundary.ts`, not protocol schemas, store
code, deployment code, PartitionDO, executor-http, or `ValidatorJson`.

Known limitations:

- No generated Registry HttpApi handler, RegistryService/store, SQL schema,
  public Worker pass-through route, service binding configuration,
  executor-http, or SQL/OCC boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/registryHttpApiRouteBoundary.test.ts test/registryHttpApiHandlers.test.ts test/registryService.test.ts test/registryDO.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/registryHttpApiRouteBoundary.test.ts test/registryHttpApiHandlers.test.ts test/registryHttpBoundary.test.ts test/registryRequests.test.ts test/registryService.test.ts test/registryDO.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Internal Execution Route-Service Adapter Effects

Previous completed checkpoint: `268ba42` Type artifact runtime route adapters.

What changed:

- Internal execution start, syscall, and finish request compatibility readers
  now use named route adapter effects before throwing `HttpError`.
- `ExecutionDO` internal route recovery now uses a named response adapter
  effect for typed route/service failures.
- Tests assert syscall and finish adapter effects directly and keep the
  broader ExecutionDO route response contract covered through Miniflare.

Boundary decision:

Execution request decoding belongs to `execution/StartRouteBoundary.ts`,
`execution/SyscallRouteBoundary.ts`, and `execution/FinishRouteBoundary.ts`.
Execution session lifecycle and transaction orchestration remain in
`ExecutionDO`. HTTP response conversion for internal execution routes belongs
at the Durable Object adapter edge, not in protocol schemas, transaction code,
PartitionDO, or `ValidatorJson`.

Known limitations:

- No execution session lifecycle, syscall behavior, transaction/OCC behavior,
  public Worker execution dispatch, artifact runtime, service binding
  configuration, executor-http, or SQL/OCC boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/executionStartRouteBoundary.test.ts test/executionSyscallRouteBoundary.test.ts test/executionFinishRouteBoundary.test.ts test/executionDO.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/executionStartRouteBoundary.test.ts test/executionSyscallRouteBoundary.test.ts test/executionFinishRouteBoundary.test.ts test/executionActionRouteBoundary.test.ts test/publicExecutionDispatchBoundary.test.ts test/executionDO.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Artifact Runtime Route-Service Adapter Effects

Previous completed checkpoint: `6e9fe45` Type active deployment store reads.

What changed:

- `artifactRuntime/RouteBoundary.ts` now exposes named Effect decoders for
  runtime invoke request compatibility callers.
- `artifactRuntime.ts` now exposes named adapter effects for service-binding
  runtime failures and internal runtime route response conversion.
- Tests assert typed route request failures before HTTP mapping and assert the
  named adapter effects directly.

Boundary decision:

Runtime invoke request decoding belongs to `artifactRuntime/RouteBoundary.ts`.
Materializer/cache/source-package execution remains in
`artifactRuntime/RuntimeRoute.ts` and `artifactRuntime.ts`. HTTP conversion for
runtime-service failures belongs at the runtime service or runtime fetch adapter
edge, so `HttpError` and `Response` mapping stay out of protocol schemas,
DeploymentService/store code, and `ValidatorJson`.

Known limitations:

- No materializer cache behavior, source-package loading, runtime fetch
  payload, artifact header validation, execution response decoding,
  public Worker routing, service binding configuration, executor-http, or
  SQL/OCC boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/artifactRuntimeRequests.test.ts test/artifactRuntime.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/artifactRuntimeRequests.test.ts test/artifactRuntime.test.ts test/publicInvokeRouteBoundary.test.ts test/invokeRequests.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Active Deployment Store Source Effects

Previous completed checkpoint: `b7cc704` Prune deployment validation result
wrappers.

What changed:

- Active deployment metadata and row reads now live behind named local Effect
  helpers inside `DeploymentPushStore.layer(...)`.
- Active deployment row loading no longer depends on the generic `readPush(...)`
  helper and downstream SQL-error remapping.
- Existing typed validation and active-deployment invalid-state failures remain
  in the store boundary.

Boundary decision:

Generic push reads still belong to the `getPush`/`readPush` store path.
Active deployment loading now owns its own source-specific store helpers
because the SQL operation, invalid active metadata cases, and active response
assembly are a separate store boundary. The helpers remain local because they
close over Durable Object SQL and storage capabilities.

Known limitations:

- No SQL query shape, metadata key/value, active deployment response shape,
  push lifecycle write, generated DeploymentDO HttpApi handler, public Worker
  routing, service binding configuration, executor-http, or SQL/OCC boundary
  changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentValidation.test.ts test/deploymentService.test.ts test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Deployment Validation Effect-Only Helper Cleanup

Previous completed checkpoint: `d81f6a3` Type public invoke route adapters.

What changed:

- `deployment/Validation.ts` no longer carries unused private
  `DeploymentValidationResult` adapters for internal schema/function/analysis
  validation helpers.
- Active deployment validation internals now flow through named Effect decoders
  only, with compatibility wrappers left only where callers still use them.
- Store/service validation errors continue to propagate as typed
  `DeploymentValidationError` failures.

Boundary decision:

Deployment validation source logic belongs to `deployment/Validation.ts` as
typed Effect decoders. Public compatibility wrappers remain in that module for
existing route/store callers, but internal domain validation should not keep a
parallel result-style helper layer. `ValidatorJson` remains the validator
metadata source of truth and is not replaced by Effect Schema.

Known limitations:

- No deployment SQL writes, active deployment metadata, push lifecycle service
  behavior, generated DeploymentDO HttpApi handlers, public Worker routing,
  service binding configuration, executor-http, or SQL/OCC boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentValidation.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deploymentValidation.test.ts test/deploymentService.test.ts test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Invoke And Pass-Through Route Adapter Effects

Previous completed checkpoint: `7c0f0b0` Type public live query delivery
boundary.

What changed:

- Public invoke route boundaries now expose a named HTTP adapter effect for
  typed request JSON, protocol validation, and missing-field failures.
- Public Worker dispatch failures now expose a reusable named HTTP adapter
  effect for pass-through route mapping.
- Top-level Worker `/invoke`, registry deployments, and public scheduler
  route adapters now recover through named Effect adapter helpers.

Boundary decision:

Public invoke request decoding belongs to `invoke/PublicInvokeRouteBoundary.ts`;
public Worker dispatch failures belong to `worker/PublicRouteDispatchError.ts`;
top-level route response conversion remains in `worker.ts`. `HttpError` stays
at compatibility adapter edges, while invoke execution, artifact runtime
dispatch, scheduler dispatch, and registry dispatch remain typed behind their
existing service boundaries.

Known limitations:

- No invoke execution internals, artifact runtime invoke dispatch,
  deployment-scoped invoke response compatibility, SchedulerDO maintenance,
  RegistryDO behavior, service binding configuration, executor-http, or SQL/OCC
  boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicInvokeRouteBoundary.test.ts test/invokeRequests.test.ts test/publicWorkerRouteDispatchError.test.ts test/publicPassThroughDispatchBoundary.test.ts test/publicSchedulerRouteBoundary.test.ts test/publicSchedulerDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/publicInvokeRouteBoundary.test.ts test/invoke.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Connection Live-Query Route-Service Boundary Effects

Previous completed checkpoint: `69f1c03` Type public delivery wake route
boundary.

What changed:

- Connection route boundaries now expose named HTTP adapter effects for typed
  request JSON, invalidation payload, live-query delivery payload, and route
  operation failures.
- Public live-query delivery route boundaries expose a named HTTP adapter
  effect for typed request failures.
- Public live-query fanout dispatch now lives behind
  `liveQueryDelivery/PublicDispatchBoundary.ts`.

Boundary decision:

ConnectionDO request decoding belongs to `connection/RouteBoundary.ts`;
ConnectionDO operation dispatch belongs to `connection/RouteDispatchBoundary.ts`;
public Worker fanout dispatch belongs to
`liveQueryDelivery/PublicDispatchBoundary.ts`; public Worker response
conversion remains at the outer sync route edge. `HttpError` stays at adapter
compatibility edges and dispatch failures stay typed as
`PublicWorkerDispatchError`.

Known limitations:

- No websocket sync semantics, query rerun behavior, executor subscription
  writes, DeliveryDO/SchedulerDO internals, package metadata, service binding
  configuration, or SQL/OCC boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/connectionRouteBoundary.test.ts test/connectionRouteDispatchBoundary.test.ts test/publicLiveQueryDeliveryRouteBoundary.test.ts test/publicLiveQueryDeliveryAuthorization.test.ts test/publicLiveQueryDeliveryDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/connectionRouteBoundary.test.ts test/connectionRouteDispatchBoundary.test.ts test/publicLiveQueryDeliveryRouteBoundary.test.ts test/publicLiveQueryDeliveryDispatchBoundary.test.ts test/liveQueryDelivery.test.ts test/publicDeliveryWakeRouteBoundary.test.ts test/publicDeliveryWakeDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Delivery Wake Route-Service Boundary Effects

Previous completed checkpoint: `d3eefa5` Type public scheduler route boundary.

What changed:

- Delivery wake route boundaries now expose named HTTP adapter effects for
  typed request JSON and wake payload failures.
- Public DeliveryDO wake forwarding now lives behind a named dispatch helper
  while preserving the `delivery-wake` dispatch source.
- Tests cover route adapter-effect failure channels and dispatch helper
  behavior directly.

Boundary decision:

Wake request decoding belongs to `delivery/RouteBoundary.ts` and
`delivery/PublicWakeRouteBoundary.ts`; public DeliveryDO service-binding
dispatch belongs to `delivery/PublicWakeDispatchBoundary.ts`; public Worker
response conversion remains at the outer sync route edge. `HttpError` stays at
compatibility adapter edges and dispatch failures stay typed as
`PublicWorkerDispatchError`.

Known limitations:

- No public Worker route matching, DeliveryDO internals, SchedulerDO wake
  scheduling, ConnectionDO fanout, package metadata, service binding
  configuration, or SQL/OCC boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deliveryRouteBoundary.test.ts test/publicDeliveryWakeRouteBoundary.test.ts test/publicDeliveryWakeDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/deliveryRouteBoundary.test.ts test/publicDeliveryWakeRouteBoundary.test.ts test/publicDeliveryWakeDispatchBoundary.test.ts test/publicSchedulerRouteBoundary.test.ts test/publicSchedulerDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Scheduler Route-Service Boundary Effects

Previous completed checkpoint: `1ce303d` Type public execution route boundary.

What changed:

- Scheduler route boundaries now expose named HTTP adapter effects for typed
  request JSON and scheduler payload failures.
- Public scheduler dispatch calls share a named service-binding helper while
  preserving operation-specific dispatch sources.
- Tests cover route adapter-effect failure channels and shared dispatch helper
  behavior directly.

Boundary decision:

Scheduler request decoding belongs to `scheduler/RouteBoundary.ts` and
`scheduler/PublicRouteBoundary.ts`; service-binding dispatch belongs to
`scheduler/PublicDispatchBoundary.ts`; public Worker response conversion
remains at the outer scheduler route edge. `HttpError` stays at compatibility
adapter edges and dispatch failures stay typed as `PublicWorkerDispatchError`.

Known limitations:

- No public Worker route matching, SchedulerDO internals, delivery/connection
  maintenance behavior, package metadata, service binding configuration, or
  SQL/OCC boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicSchedulerRouteBoundary.test.ts test/publicSchedulerDispatchBoundary.test.ts test/schedulerRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/publicSchedulerRouteBoundary.test.ts test/publicSchedulerDispatchBoundary.test.ts test/schedulerRouteBoundary.test.ts test/publicExecutionDispatchBoundary.test.ts test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Execution Route-Service Boundary Effects

Previous completed checkpoint: `8b73137` Type public deployment push route
boundary.

What changed:

- Execution start/action route boundaries now expose named HTTP adapter
  effects for typed request/protocol/path failures.
- Public execution dispatch calls share a named service-binding helper while
  preserving operation-specific dispatch sources.
- Tests cover route adapter-effect failure channels and shared dispatch helper
  behavior directly.

Boundary decision:

Execution request decoding and path validation belong to the execution route
boundary modules; service-binding dispatch belongs to
`PublicDispatchBoundary.ts`; public Worker response conversion remains at the
outer route edge. `HttpError` stays at compatibility adapter edges and dispatch
failures stay typed as `PublicWorkerDispatchError`.

Known limitations:

- No public Worker route matching, ExecutionDO internals, execution session
  behavior, package metadata, service binding configuration, or SQL/OCC
  boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/executionStartRouteBoundary.test.ts test/executionActionRouteBoundary.test.ts test/publicExecutionDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/executionStartRouteBoundary.test.ts test/executionActionRouteBoundary.test.ts test/publicExecutionDispatchBoundary.test.ts test/executionRequests.test.ts test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Deployment Push Route-Service Boundary Effects

Previous completed checkpoint: `eca0ecf` Name remaining deployment adapter
effects.

What changed:

- Public deployment push request failures are named as route/json boundary
  aliases in `PublicPushRouteBoundary.ts`.
- Compatibility promise readers use named Effect adapter helpers to convert
  typed request/protocol failures to `HttpError`.
- Public deployment push dispatch calls share a named service-binding helper
  while preserving operation-specific dispatch sources.

Boundary decision:

Transport request decoding belongs to `PublicPushRouteBoundary.ts`; service
binding dispatch belongs to `PublicPushDispatchBoundary.ts`; the public Worker
keeps the single outer HTTP response mapper. This keeps `HttpError` at adapter
compatibility edges and keeps dispatch failures typed as
`PublicWorkerDispatchError`.

Known limitations:

- No generated DeploymentDO route wiring, DeploymentService/store, public
  Worker route matching, package metadata, service binding configuration, or
  SQL/OCC boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicDeploymentPushRouteBoundary.test.ts test/publicDeploymentPushDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/publicDeploymentPushRouteBoundary.test.ts test/publicDeploymentPushDispatchBoundary.test.ts test/publicFinishArtifactBoundary.test.ts test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Generated Read Start And Protocol Adapter Failure Effects

Previous completed checkpoint: `1e37836` Name finish abandon adapter effects.

What changed:

- Generated DeploymentApi read, start, and protocol response failure mapping
  now uses explicit failure aliases and named adapter `Effect.fn(...)` helpers.
- `mapDeploymentReadFailure(...)`, `mapDeploymentStartFailure(...)`, and
  `mapDeploymentProtocolResponseFailure(...)` remain the adapter entrypoints,
  but their tag branches delegate to named response effects.
- Tests cover the response-effect failure channels directly.

Boundary decision:

Read/start service and protocol functions should continue to emit typed domain
or protocol failures. The generated HttpApi adapter owns conversion to declared
response classes, so these named adapter effects live in `HttpApiHandlers.ts`
rather than the service, store, validation, or protocol modules.

Known limitations:

- No route registration, Durable Object routing, DeploymentService/store,
  public Worker, package metadata, service binding, or SQL/OCC boundary
  changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Generated Finish And Abandon Adapter Failure Effects

Previous completed checkpoint: `8253465` Name generated deployment response
validators.

What changed:

- Generated DeploymentApi finish and abandon failure mapping now uses explicit
  failure union types and named adapter `Effect.fn(...)` helpers.
- `mapDeploymentFinishFailure(...)` and `mapDeploymentAbandonFailure(...)`
  remain the adapter entrypoints, but their tag branches delegate to named
  response effects.
- Tests cover the response-effect failure channels directly.

Boundary decision:

Finish and abandon service methods should continue to emit deployment domain
failures. The generated HttpApi adapter owns conversion to declared response
classes, so these named adapter effects live in `HttpApiHandlers.ts` rather
than the service/store modules.

Known limitations:

- No route registration, Durable Object routing, DeploymentService/store,
  public Worker, package metadata, service binding, or SQL/OCC boundary
  changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Generated DeploymentApi Response Validation Effects

Previous completed checkpoint: `a053f26` Extract generated deployment endpoint
effects.

What changed:

- `DeploymentApiHandlers` now exposes named response validation effects for
  active deployment status, push status, and finish-push responses.
- Endpoint helpers remain the boundary between generated routes and deployment
  service/domain logic, but response protocol validation is now a separate
  named adapter helper instead of anonymous local lambdas.
- Tests cover the direct response-validator failure channel.

Boundary decision:

Generated response validation belongs to the HttpApi adapter layer, not the
deployment service/store domain. Naming the validators makes that adapter
boundary explicit while keeping service methods typed in domain terms.

Known limitations:

- No Durable Object routing, generated route registration, DeploymentService,
  store, package metadata, public Worker routing, or SQL/OCC boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Generated DeploymentApi Endpoint Handler Extraction

Previous completed checkpoint: `f8c929d` Move deployment invoke mapping to
route edge.

What changed:

- `DeploymentApiHandlers` now delegates every generated endpoint body to a
  named endpoint effect.
- The generated `HttpApiBuilder.group(...)` layer remains responsible for
  schema route registration, while endpoint helpers own typed request/service
  orchestration and protocol response decoding.
- Direct handler tests now cover named endpoint success and failure channels
  without depending only on web-handler integration.

Boundary decision:

The generated HttpApi layer should be route wiring. Endpoint helpers are the
boundary between schema-first generated routes and deployment service/domain
logic. They can now be evolved independently toward richer typed service
errors and response validation without moving Durable Object routing or SQL
ownership.

Known limitations:

- `DeploymentDO.fetch()`, `InternalRouteBoundary`, `HttpApiWebHandler`,
  DeploymentService/store behavior, public Worker routing, package metadata,
  service bindings, and Durable Object SQL/OCC are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/deploymentHttpApiHandlers.test.ts test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Deployment-Scoped Invoke Route Adapter Edge

Previous completed checkpoint: `03cd604` Route execution partition errors at
deployment edge.

What changed:

- `Worker.routeDeployment` now carries deployment-scoped invoke failures to the
  public Worker deployment route adapter.
- `PublicWorkerDeploymentRouteError` is split into invoke and non-invoke route
  failures so invoke-only execution/runtime errors are converted through
  `invokeErrorResponse(...)` while non-invoke route failures continue through
  the deployment `HttpError` mapper.
- The deployment route adapter owns the response conversion for all
  `/deployments/:id/...` route families.

Boundary decision:

Invoke's response shape is different from ordinary Worker route errors because
it may preserve partition error bodies. The boundary still belongs at the
Worker deployment route adapter; the adapter chooses invoke response mapping
only for invoke failures and keeps the non-invoke HTTP mapper narrow.

Known limitations:

- Top-level `/invoke` still has its own Worker adapter branch.
- Invoke service/domain internals, generated DeploymentDO handlers, package
  metadata, service bindings, and Durable Object SQL/OCC are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/invoke.test.ts test/publicWorkerRoutePathBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Worker Execution And Partition Route Edge

Previous completed checkpoint: `8c94424` Keep deployment dispatch errors typed
to route edge.

What changed:

- `Worker.routeDeployment` now carries execution and partition route errors to
  the public Worker deployment route mapper instead of converting them inside
  the `executions` and `partitions` branches.
- The outer deployment route mapper owns shared `RequestJsonError`,
  execution protocol error, public execution path error, and partition payload
  error conversion.
- Execution and partition dispatch helpers continue to report typed failures
  from their own route/dispatch packages.

Boundary decision:

The public Worker deployment route is now the adapter boundary for deployment
subroutes that return `HttpError`. Route families emit typed errors; the
Worker route adapter decides public status/body mapping once.

Known limitations:

- Public invoke remains a compatibility branch that directly turns invoke
  failures into a response because invoke has a separate adapter-error shape.
- No Durable Object SQL/OCC, generated API, package metadata, or service
  binding boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicWorkerRoutePathBoundary.test.ts test/executionDO.test.ts test/transaction.test.ts test/publicPartitionSchemaCacheRouteBoundary.test.ts test/partitionFlow.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```

## Public Worker Deployment Dispatch Route Boundary

Previous completed checkpoint: `039bb9c` Extract deployment store transaction
effects.

What changed:

- `Worker.routeDeployment` now carries public deployment dispatch, push route,
  and sync route failures as typed Effect errors until the public Worker
  deployment route adapter maps them to `HttpError`.
- `PublicPassThroughDispatchBoundary` remains responsible only for wrapping
  service-binding fetch failures as `PublicWorkerDispatchError`.
- The public Worker deployment route mapper now owns the HTTP conversion for
  dispatch errors, path errors, push payload/protocol errors, and sync delivery
  route errors.

Boundary decision:

The package boundary is the Worker route adapter, not each branch inside
`routeDeployment`. Pass-through dispatch helpers should report typed operation
failures; route adapters should decide HTTP status/body mapping once.

Known limitations:

- Execution, invoke, and partition route branches still have existing local
  adapter mapping and should be migrated in a later, coherent batch.
- No package metadata, service binding, Durable Object class, or generated
  code boundary changed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicWorkerRoutePathBoundary.test.ts test/publicPassThroughDispatchBoundary.test.ts test/publicDeploymentPushDispatchBoundary.test.ts test/publicLiveQueryDeliveryRouteBoundary.test.ts test/publicDeliveryWakeRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Deployment Store Transaction Helper Extraction

Previous completed checkpoint: `9346eb4` Extract deployment service preflight effects.

What changed:

- `DeploymentPushStore.layer(...)` now contains named transaction helpers for
  start-analyzed, finish, and abandon writes.
- The helpers stay local to the store layer because they close over Durable
  Object SQL/storage functions, `setMeta(...)`, `readPushRow(...)`,
  `applySchema(...)`, and `applyFunctions(...)`.
- Store write error mapping is centralized inside the store package boundary
  instead of being repeated in each public store method.

Boundary decision:

DeploymentService owns orchestration preflight. DeploymentPushStore owns
transaction writes, SQL state materialization, and storage failure mapping.
Route/HttpApi adapters own HTTP conversion. No SQL helper was promoted outside
the store boundary because that would leak Durable Object storage internals.

Known limitations:

- This checkpoint does not change the DeploymentService public API, route
  boundaries, generated HttpApi handler mapping, storage schema, PartitionDO
  SQL/OCC, executor-http, or `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
```

## Deployment Service Push Preflight Extraction

Previous completed checkpoint: `c308fe3` Map deployment route validation at adapter edge.

What changed:

- `deployment/Service.ts` now separates service-facing push preflight helpers
  from public `DeploymentService` method assembly.
- Finish artifact-ref resolution depends on an explicit
  `DeploymentArtifactResolver` interface, and push existence preflight depends
  on an explicit `DeploymentPushReader` interface.
- Abandon state eligibility and reason normalization are service/domain
  helpers, not Worker, generated handler, or storage concerns.

Boundary decision:

Deployment route modules own request decoding and HTTP conversion. The
Deployment service owns push lifecycle orchestration and typed domain
preflights. DeploymentPushStore owns transaction writes and SQL state
materialization. Artifact resolution remains behind the DeploymentArtifacts
service.

Known limitations:

- This checkpoint does not change DeploymentPushStore transaction internals,
  storage schema, generated HttpApi handler mapping, public Worker route
  dispatch, PartitionDO SQL/OCC, executor-http, or `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
```

## Deployment Route Adapter HTTP Error Boundary

Previous completed checkpoint: `d497276` Validate deployment HttpApi responses with protocol effects.

What changed:

- `deployment/PublicPushRouteBoundary.ts` and
  `deployment/HttpApiRouteBoundary.ts` now keep typed Effect decoder exports
  separate from adapter-level `HttpError` compatibility helpers.
- Public Worker deployment route mapping no longer needs to special-case
  `DeploymentProtocolValidationError` after calling
  `publicDeploymentRouteErrorToHttpError(...)`.
- DeploymentDO internal route response mapping now delegates protocol and JSON
  request failures to `deploymentRouteErrorToHttpError(...)` for one HTTP
  conversion path.

Boundary decision:

Protocol packages own deployment transport validation and emit
`DeploymentProtocolValidationError`. Route boundary modules own request JSON
reading and compatibility HTTP conversion. Worker and Durable Object adapters
own the single runtime edge and response emission.

Known limitations:

- This checkpoint does not change deployment protocol schemas, DeploymentDO
  lifecycle logic, deployment storage, push service behavior, PartitionDO
  SQL/OCC, executor-http, or `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
```

## Deployment HttpApi Response Protocol Effect Boundary

Previous completed checkpoint: `a661a14` Validate registry HttpApi responses with Effect.

What changed:

- `flarex-protocol/deployment` owns Effect response decoders for generated
  Deployment HttpApi success/error envelopes.
- `DeploymentApiHandlers` consumes those decoders for active deployment,
  push-status, and finish-push success responses and no longer imports Effect
  Schema directly for response validation.
- Deployment protocol response validation failures stay typed as
  `DeploymentProtocolValidationError` until the generated HttpApi handler maps
  them to the declared storage-error response.

Boundary decision:

The protocol package owns deployment transport response shape. The Deployment
service owns push lifecycle and response production. The generated HttpApi
handler owns only final conversion from typed service/protocol failures to
declared HttpApi response classes.

Known limitations:

- This checkpoint does not change DeploymentDO lifecycle, deployment storage,
  public deployment route boundary code, PartitionDO SQL/OCC, executor-http, or
  `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
```

## Registry HttpApi Response Effect Boundary

Previous completed checkpoint: `414c09f` Add registry protocol effect decoders.

What changed:

- `RegistryApiHandlers` consumes protocol Effect decoders for deployment record
  and list response validation.
- Registry protocol response validation failures stay typed as
  `ProtocolValidationError` until the HttpApi handler maps them to the
  declared storage-error response.
- Registry service/store modules still own domain behavior and SQL failures;
  the handler owns only generated HttpApi response mapping.

Boundary decision:

The protocol package owns response shape. The Registry service owns deployment
record production. The generated HttpApi handler owns the final conversion
from typed storage/protocol response failures to `RegistryStorageErrorResponse`.

Known limitations:

- This checkpoint does not change RegistryDO route matching, registry storage,
  deployment runtime behavior, PartitionDO SQL/OCC, executor-http, or
  `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/registryHttpApiHandlers.test.ts packages/flarex-backend/test/registryHttpApiRouteBoundary.test.ts packages/flarex-backend/test/registryRequests.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
```

## Registry Protocol Request And Response Effect Decoders

Previous completed checkpoint: `1ac3bd4` Add deployment protocol effect decoders.

What changed:

- `flarex-protocol/registry` owns Effect-returning decoders for
  create-deployment requests, health responses, storage-error responses,
  deployment records, and list responses.
- Backend `registry/Requests.ts` owns only backend create-deployment request
  normalization after protocol validation succeeds.
- Throwing registry protocol parsers remain compatibility adapters, not the
  source API used by migrated Effect decode paths.

Boundary decision:

The protocol package owns registry transport shape and emits
`ProtocolValidationError` at the first failing boundary. The backend registry
request layer owns the service-facing request payload. Route boundary modules
own request-body JSON reading and final HTTP/error-response conversion.
Registry service/store modules own database behavior.

Known limitations:

- This checkpoint does not change Registry service/store behavior, RegistryDO
  routing, DeploymentDO, PartitionDO SQL/OCC, executor-http, or
  `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/registryRequests.test.ts packages/flarex-backend/test/registryHttpApiRouteBoundary.test.ts packages/flarex-backend/test/registryHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000
```

## Deployment Protocol Request Effect Decoders

Previous completed checkpoint: `ede61de` Add public invoke protocol effect decoder.

What changed:

- `flarex-protocol/deployment` owns Effect-returning decoders for deployment
  start, analyzed-start, finish, and abandon request payloads.
- Backend `deployment/Requests.ts` owns conversion from protocol request
  shapes to backend request shapes after protocol validation succeeds.
- Throwing deployment request parsers remain compatibility adapters, not the
  source API used by migrated Effect decode paths.

Boundary decision:

The protocol package owns transport request shape and emits
`DeploymentProtocolValidationError` at the first failing boundary. The backend
deployment request layer owns backend source-package normalization. Route
boundary modules own request-body JSON reading and final HTTP/error-response
conversion. DeploymentDO and deployment services own push lifecycle behavior.

Known limitations:

- This checkpoint does not move DeploymentDO lifecycle logic, deployment
  validation internals, storage operations, artifact behavior, PartitionDO
  SQL/OCC, executor-http, or `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/deploymentRequests.test.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
```

## Public Invoke Protocol Request Effect Decoder

Previous completed checkpoint: `7e3dd43` Add execution protocol effect decoders.

What changed:

- `flarex-protocol/invoke` owns the Effect-returning public invoke request
  decoder.
- Backend `invoke/Requests.ts` owns conversion from the protocol body to the
  backend invoke request, including missing deployment/path/partition-key
  domain failures and omitted-args defaulting.
- Throwing public invoke protocol parsing remains a compatibility adapter, not
  the source API used by migrated Effect decode paths.

Boundary decision:

The protocol package owns transport request shape and emits
`InvokeProtocolValidationError` at the first failing boundary. The backend
invoke request layer owns route/body deployment id selection and backend
request normalization. The public invoke route boundary owns request-body JSON
reading and final HTTP conversion. Invoke execution owns runtime behavior.

Known limitations:

- This checkpoint does not change invoke execution services, active deployment
  loading, artifact runtime dispatch, PartitionDO SQL/OCC, executor-http, or
  `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/invokeRequests.test.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
```

## Execution Protocol Request Effect Decoders

Previous completed checkpoint: `8b4346f` Validate artifact runtime invoke responses.

What changed:

- `flarex-protocol/execution` owns Effect-returning request decoders for
  execution start, syscall, and finish payloads.
- Backend `execution/Requests.ts` owns conversion from protocol request shapes
  to backend request shapes after protocol validation succeeds.
- Throwing execution protocol parsers remain compatibility adapters, not the
  source API used by migrated Effect decode paths.

Boundary decision:

The protocol package owns transport request shape and emits
`ExecutionProtocolValidationError` at the first failing boundary. The backend
execution request layer owns backend type normalization. Route boundary modules
own request-body JSON reading and final HTTP conversion. ExecutionDO owns
session lifecycle and transaction behavior.

Known limitations:

- This checkpoint does not move ExecutionDO session methods into a new service
  layer and does not change PartitionDO SQL/OCC, executor-http, or
  `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/executionRequests.test.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/executionSyscallRouteBoundary.test.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
```

## Artifact Runtime Invoke Response Schema Boundary

Previous completed checkpoint: `8e169d5` Type transaction operation effects.

What changed:

- `flarex-protocol/invoke` now owns the shared invoke response schema.
- `artifactRuntime.ts` owns service-binding runtime response JSON/status
  handling and protocol response decoding before returning to the public Worker
  invoke path.
- The service-binding `BackendExecutionArtifactRuntime.invoke(...)`
  compatibility method still maps typed runtime failures to `HttpError` at its
  adapter edge.

Boundary decision:

The protocol package owns transport envelope shape. The artifact runtime
service-binding adapter owns response body/status decoding from the runtime
Fetcher. Worker public invoke owns final route response mapping. User
document/function validation remains under `ValidatorJson` and is not part of
this transport response schema.

Known limitations:

- This checkpoint does not change artifact runtime request routing, source
  package loading, runtime materialization, direct invoke execution,
  PartitionDO SQL/OCC, executor-http, or `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-protocol test -- test/invoke.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/artifactRuntime.test.ts --testTimeout=120000 --hookTimeout=120000
```

## Invoke Transaction Operation Effect Boundary

Previous completed checkpoint: `eaf6596` Type invoke active deployment response.

What changed:

- The transaction package now owns Effect-native operation helpers and keeps
  its legacy promise methods as adapters.
- Invoke owns the mapping from typed transaction operation failures into
  `InvokeExecutionOperationError`, then the existing invoke adapter owns final
  HTTP/partition request mapping.
- Handler-facing database APIs remain a promise boundary for backend function
  authors, while shared invoke/ExecutionDO validation helpers accept
  Effect-native transaction operations internally.
- ExecutionDO owns start/syscall/finish operation classification over
  Effect-native transaction calls, rather than crossing transaction promise
  compatibility wrappers before route error mapping.

Boundary decision:

`SingleShardTransaction` owns partition fetch/response decoding and local
transaction invariants. Invoke owns execution operation classification
(`ensure-schema`, `begin`, `handler`, `commit`). ExecutionDO owns syscall route
operation classification. Worker and compatibility adapters own the final
conversion to `HttpError` or `PartitionRequestError`.

Known limitations:

- This checkpoint does not migrate handler author APIs to Effect services.
- Public invoke request decoding, ExecutionDO sessions, PartitionDO SQL/OCC
  logic, deployment storage, executor-http, and `ValidatorJson` are unchanged.

Verification:

```sh
node --max-old-space-size=4096 ../../node_modules/vitest/vitest.mjs run test/transaction.test.ts --testTimeout=120000 --hookTimeout=120000
node --max-old-space-size=4096 ../../node_modules/vitest/vitest.mjs run test/invoke.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
```

## Invoke Active Deployment Response Decoder Boundary

Previous completed checkpoint: `c1a75bd` Type deployment response decoders.

What changed:

- The invoke package now owns named Effect helpers for active deployment
  response JSON reading and protocol response validation.
- `loadActiveDeploymentEffect(...)` no longer trusts a raw `response.json()`
  cast for successful DeploymentDO active-deployment responses.
- `loadActiveDeployment(...)` remains the compatibility promise boundary that
  maps typed invoke load failures to the existing adapter-shaped `HttpError`.

Boundary decision:

Invoke owns active deployment metadata loading because it resolves function
metadata and runtime validators from that payload. DeploymentDO owns the
response source, and the Worker/execution adapters own final HTTP mapping.

Known limitations:

- This checkpoint does not change public invoke request decoding, handler
  execution, PartitionDO SQL/OCC, deployment storage, executor-http, or
  `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/invoke.test.ts -t "active deployment|active function metadata|executeInvoke validation" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Deployment Response Decoder Boundary

Previous completed checkpoint: `301924c` Type deployment metadata validation.

What changed:

- The deployment package now owns Effect Schema response decoders for generated
  HttpApi active-deployment, push-status, and finish-push responses.
- The public finish-push artifact preflight now has named Effect helpers for
  DeploymentDO push-status response JSON and push-status schema decoding.
- Public Worker dispatch failures remain the package boundary for artifact
  preflight response read/decode failures.

Boundary decision:

Generated HttpApi handlers own protocol response validation before returning to
the generated adapter. Public finish-push artifact preflight owns its read of
DeploymentDO push status before checking durable artifact availability. Final
HTTP mapping remains at the existing generated/public adapter edges.

Known limitations:

- This checkpoint does not change DeploymentDO storage layout, push lifecycle
  semantics, public route path matching, analyzer behavior, public
  execution/invoke dispatch, PartitionDO SQL/OCC, executor-http, or
  `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/publicFinishArtifactBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts -t "public deployment push route boundary|requires durable artifact storage before public finish|rejects malformed finish request bodies" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Deployment Schema/Function Analysis Validation Boundary

Previous completed checkpoint: `7539fa3` Type deployment start push ingress validation.

What changed:

- The deployment package now owns direct Effect decoders for schema, function
  metadata, combined deployment-analysis validation, and codegen-analysis
  validation.
- Shared metadata leaf validation delegates through Effect-backed helpers,
  including placement, partition policy, source position, JSON validator, and
  partition/schema consistency checks.
- Result-style compatibility helpers remain only as package-boundary shims for
  callers that have not yet moved to Effect-returning decoders, and migrated
  Effect flows call the direct decoders without crossing those sync shims.

Boundary decision:

`deployment/Validation` owns metadata shape and consistency checks. Deployment
routes and services own request orchestration and final adapter mapping.
`ValidatorJson` remains the user document/function validator contract and is
not replaced by Effect Schema.

Known limitations:

- This checkpoint does not change DeploymentDO storage layout, push lifecycle
  semantics, public route request schemas, public execution/invoke dispatch,
  PartitionDO SQL/OCC, protocol schemas, executor-http, or `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Deployment Start-Push Ingress Validation Boundary

Previous completed checkpoint: `1fd4cea` Type deployment stored push row validation.

What changed:

- The deployment package now owns direct Effect decoders for source-package,
  diagnostics, analyzed start-push protocol, and start-analyzed service-input
  validation.
- Compatibility helpers keep their existing synchronous API shape by running
  those decoders only at the compatibility edge.
- Deployment service and route callers continue receiving the same domain
  structures and typed `DeploymentValidationError` failures.

Boundary decision:

Protocol payload conversion and deployment service-input normalization belong
in `deployment/Validation`. Deployment routes and service handlers own final
adapter mapping. The validation boundary does not depend on `HttpError` and
does not mutate DeploymentDO storage.

Known limitations:

- This checkpoint does not change DeploymentDO storage layout, push lifecycle
  semantics, public route request schemas, stored row decoding, public
  execution/invoke dispatch, PartitionDO SQL/OCC, or `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Deployment Stored Push-Row Validation Boundary

Previous completed checkpoint: `a4c0f74` Type public invoke handler db validation.

What changed:

- The deployment package now owns a typed Effect decoder for stored push-row
  materialization through `decodePushStatusFromRow(...)`.
- The deployment store keeps SQL reads in `DeploymentSqlError` and stored-row
  shape/content failures in `DeploymentValidationError`.
- Sync compatibility helpers for push-row parsing now delegate to the Effect
  decoder instead of owning a separate validation implementation.

Boundary decision:

`DeploymentPushStore` owns SQL access and row retrieval. `deployment/Validation`
owns conversion from stored row fields into deployment domain objects. Route
and service adapters own final HTTP mapping; SQL row validation does not depend
on `HttpError`.

Known limitations:

- This checkpoint does not change DeploymentDO storage layout, push lifecycle
  semantics, public route request schemas, public execution/invoke dispatch,
  PartitionDO SQL/OCC, or `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Public Invoke Handler DB Validation Boundary

Previous completed checkpoint: `3096a64` Type public invoke execution boundary.

What changed:

- Invoke now owns typed validation for the handler database compatibility APIs,
  reusing the same document and query helpers used by ExecutionDO syscalls.
- Handler-facing `readerFor(...)` and `writerFor(...)` keep their existing
  promise API shape, while their validation failures remain tagged invoke
  errors until the public invoke adapter boundary.
- Worker and `executeInvoke(...)` continue to own final HTTP compatibility
  mapping.

Boundary decision:

Invoke owns handler database validation and operation error classification.
Backend handlers keep the public promise-shaped DB API. Transaction IO remains
owned by `SingleShardTransaction`, and HTTP response conversion remains at the
invoke adapter edge.

Known limitations:

- This checkpoint does not change artifact-runtime invoke dispatch, public
  execution dispatch, request protocol schemas, executor-http, PartitionDO
  SQL/OCC, or `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Public Invoke Execution Boundary

Previous completed checkpoint: `d9f1e5b` Type execution query syscalls.

What changed:

- Invoke now owns `executeInvokeEffect(...)` as the typed runtime service
  boundary for the legacy public invoke path.
- Worker owns the final HTTP mapping for `InvokeExecutionError` on the
  non-artifact `/invoke` path.
- `executeInvoke(...)` remains a compatibility wrapper for promise-based
  callers and maps typed errors back to adapter errors.

Boundary decision:

Invoke owns active deployment lookup, function resolution, partition/scope
resolution, return validation, and operation error classification for legacy
public invoke execution. Worker owns route body decoding, deployment id
selection, artifact-runtime dispatch selection, and HTTP response conversion.

Known limitations:

- Handler database APIs still use the existing promise compatibility surfaces.
- This checkpoint does not change artifact-runtime invoke dispatch, public
  execution dispatch, request protocol schemas, executor-http, PartitionDO
  SQL/OCC, or `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Execution Syscall Query Planning Boundary

Previous completed checkpoint: `37b6ab6` Type execution document syscalls.

What changed:

- Invoke now owns a reusable Effect helper for indexed query syscall planning
  and placement validation.
- ExecutionDO owns the transaction operation runner passed into that helper,
  keeping index read IO failures in the execution operation channel.
- ExecutionDO's internal route adapter owns HTTP response conversion for typed
  invoke query planning/placement failures and transaction operation failures.

Boundary decision:

Invoke validation owns table lookup, index lookup, query range planning, query
placement rules, and returned document placement validation. ExecutionDO owns
session lifecycle, syscall dispatch, and transaction execution. The internal
route adapter owns the final HTTP mapping.

Known limitations:

- This checkpoint does not change public execution dispatch, request protocol
  schemas, executor-http, PartitionDO SQL/OCC, or `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/executionSessionError.test.ts packages/flarex-backend/test/executionRouteOperationError.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Execution Syscall Document Validation Boundary

Previous completed checkpoint: `e048f7f` Type execution start domain validation.

What changed:

- Invoke now owns reusable Effect helpers for document syscall validation:
  get, insert, patch, replace, and delete.
- ExecutionDO owns the transaction operation runner passed into those helpers,
  keeping transaction IO failures in the execution operation channel.
- ExecutionDO's internal route adapter owns HTTP response conversion for typed
  invoke document failures and transaction operation failures.

Boundary decision:

Invoke validation owns document id parsing, table lookup, document validators,
placement rules, and missing document failures. ExecutionDO owns session
lifecycle, mutation/query permission checks, and transaction execution. The
internal route adapter owns the final HTTP mapping.

Known limitations:

- Indexed query syscall planning remains on the older reader/query path.
- This checkpoint does not change public execution dispatch, request protocol
  schemas, executor-http, PartitionDO SQL/OCC, or `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/executionSessionError.test.ts packages/flarex-backend/test/executionRouteOperationError.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Execution Start Domain Validation Boundary

Previous completed checkpoint: `9ee13b8` Type execution metadata load boundary.

What changed:

- ExecutionDO start now consumes shared invoke boundaries for argument
  validation, request/function kind mismatch, unsupported active function
  kinds, and create-root root table lookup.
- Invoke-domain failures stay in the execution service/domain error channel
  until the ExecutionDO route adapter maps them to the preserved HTTP response
  contract.
- Session lifecycle failures remain owned by `ExecutionSessionError`, and
  transaction setup/begin failures remain owned by
  `ExecutionRouteOperationError`.

Boundary decision:

Invoke validation owns user argument, function kind, and schema table lookup
semantics. ExecutionDO owns session lifecycle and transaction setup. The
internal route adapter owns HTTP response conversion for typed invoke,
session, and operation failures.

Known limitations:

- This checkpoint does not change public execution dispatch, request protocol
  schemas, executor-http, PartitionDO SQL/OCC, or `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/executionSessionError.test.ts packages/flarex-backend/test/executionRouteOperationError.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Execution Active Metadata Load Boundary

Previous completed checkpoint: `50a23a4` Type execution start scope validation.

What changed:

- ExecutionDO start now consumes the shared invoke
  `loadActiveFunctionMetadataEffect(...)` boundary directly.
- `InvokeActiveDeploymentLoadError` and
  `InvokeActiveFunctionMetadataNotFoundError` stay in the execution
  service/domain error channel until the ExecutionDO route adapter maps them to
  existing invoke HTTP responses.
- Transaction setup/begin failures remain owned by
  `ExecutionRouteOperationError`.

Boundary decision:

Invoke runtime/validation owns active deployment and function metadata lookup
semantics. ExecutionDO owns session lifecycle and transaction setup. The
internal route adapter owns HTTP response conversion for typed runtime,
validation, and operation failures.

Known limitations:

- This checkpoint does not change public execution dispatch, request protocol
  schemas, executor-http, PartitionDO SQL/OCC, or `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/executionRouteOperationError.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Execution Start Scope Validation Boundary

Previous completed checkpoint: `c25d975` Type execution finish return validation.

What changed:

- ExecutionDO start now consumes the shared invoke
  `resolveFunctionExecutionScopeEffect(...)` boundary directly.
- `InvokePartitionValidationError` and `InvokeTableNotFoundError` stay in the
  execution service/domain error channel until the ExecutionDO route adapter
  maps them to the existing invoke validation HTTP responses.
- Transaction setup/begin failures remain owned by
  `ExecutionRouteOperationError`.

Boundary decision:

Invoke validation owns partition scope resolution semantics. ExecutionDO owns
session lifecycle and transaction setup. The internal route adapter owns HTTP
response conversion for typed validation and operation failures.

Known limitations:

- This checkpoint does not change public execution dispatch, request protocol
  schemas, executor-http, PartitionDO SQL/OCC, or `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/executionRouteOperationError.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Execution Finish Return Validation Boundary

Previous completed checkpoint: `776a65d` Preflight deployment store validation.

What changed:

- ExecutionDO finish now consumes the shared invoke `validateReturnEffect(...)`
  boundary directly.
- `InvokeReturnValidationError` stays in the execution service/domain error
  channel until the ExecutionDO route adapter maps it to the existing invoke
  validation HTTP response.
- Commit failures remain owned by `ExecutionRouteOperationError`; return
  validation is no longer thrown through that async operation wrapper.

Boundary decision:

Invoke validation owns return-value validation semantics. ExecutionDO owns
session lifecycle and transaction commit. The internal route adapter owns the
HTTP response conversion for both typed validation and operation failures.

Known limitations:

- This checkpoint does not change public execution dispatch, request protocol
  schemas, executor-http, PartitionDO SQL/OCC, or `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts packages/flarex-backend/test/executionRouteOperationError.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Deployment Store Validation Preflight Boundary

Previous completed checkpoint: `93250ea` Type public finish artifact lookup.

What changed:

- Deployment push-row normalization now has a non-throwing
  `parsePushStatusFromRow(...)` result boundary in `deployment/Validation.ts`.
- DeploymentPushStore start, finish, and abandon operations decode push rows
  before write transactions, keeping deployment validation failures typed as
  `DeploymentValidationError` instead of routing them through the SQL
  `tryPromise` catch path.
- Transaction aborts remain reserved for storage consistency cases that need
  rollback, such as missing just-written or just-activated rows.

Boundary decision:

`deployment/Validation.ts` owns deployment metadata validation and typed
validation results. `deployment/Store.ts` owns SQL transaction consistency and
maps SQL failures separately, without treating deployment-domain validation as
a SQL defect.

Known limitations:

- Compatibility throwing validation helpers remain available.
- This checkpoint does not change protocol schemas, executor-http,
  public Worker routing, DeploymentDO service behavior, PartitionDO SQL/OCC,
  or `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Shared ValidatorJson Effect Boundary

Previous completed checkpoint: `e1c52d8` Use typed partition route recovery.

What changed:

- `validation.ts` now exposes `validateJsonValueEffect(...)`, a shared
  Effect boundary for `ValidatorJson` value validation failures.
- Invoke argument, document, and return validation now use the shared Effect
  boundary and preserve their existing `Invoke*ValidationError` domain errors.
- ExecutionDO start argument validation now uses the shared Effect boundary
  and preserves existing `ExecutionSessionError` argument-validation behavior.

Boundary decision:

`ValidatorJson` remains the source of truth for user document/function
validation. The new Effect helper wraps that existing validator once and lets
callers map `BackendValidationError` into their local domain errors without
duplicating try/catch blocks.

Known limitations:

- This checkpoint does not replace `ValidatorJson`, change validation
  semantics, migrate PartitionDO SQL/OCC validation, alter protocol schemas, or
  change executor-http behavior.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/validation.test.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/executionDO.test.ts packages/flarex-backend/test/executionSessionError.test.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## PartitionDO Route Adapter Typed Recovery

Previous completed checkpoint: `1d81071` Use tagged artifact runtime recovery.

What changed:

- PartitionDO internal route adapters now keep request JSON and payload
  failures typed as `RequestJsonError | PartitionRoutePayloadError` until the
  Durable Object adapter response edge.
- PartitionDO route handler failures are wrapped once as tagged
  `PartitionRouteOperationError` values and recovered through
  `Effect.catchTags(...)`.
- Document and index read handlers now pass through the same route operation
  boundary while preserving their existing query parameter validation
  responses.

Boundary decision:

PartitionDO owns the HTTP response conversion for internal route request
decoding and route operation failures. Existing SQL/OCC, schema-cache,
document-validation, subscription, document-read, and index-read logic remains
inside PartitionDO and is not refactored in this checkpoint.

Known limitations:

- This checkpoint does not migrate PartitionDO SQL/OCC internals,
  document-validation helpers, schema-cache transaction logic, public Worker
  routing, protocol schemas, executor-http, or `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts packages/flarex-backend/test/partitionFlow.test.ts packages/flarex-backend/test/publicPartitionDispatchBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Artifact Runtime Adapter Tagged Recovery

Previous completed checkpoint: `fd1e5b8` Use tagged scheduler delivery recovery.

What changed:

- The in-process execution artifact runtime fetch adapter now uses
  `Effect.catchTags(...)` instead of broad catch-all recovery.
- The service-binding artifact runtime `invoke(...)` adapter now maps typed
  runtime failures to compatibility `HttpError` failures through explicit
  tag-specific recovery.
- Request JSON, artifact invoke payload, runtime route, authorization, header,
  missing source-package, runtime operation, and service-binding response
  failures remain typed until the relevant artifact runtime adapter edge.

Boundary decision:

The artifact runtime fetch adapter owns HTTP response conversion for the
in-process runtime service. `ServiceBindingExecutionArtifactRuntime.invoke(...)`
owns compatibility `HttpError` conversion for callers that still expect promise
rejections. Runtime route, request boundary, source-package loading,
materializer cache, and artifact invocation continue to emit typed failures.

Known limitations:

- This checkpoint does not change materializer cache behavior, artifact
  source-package loading, runtime route authorization/header validation,
  public Worker invoke routing, protocol schemas, PartitionDO SQL/OCC,
  executor-http, or `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntime.test.ts packages/flarex-backend/test/artifactRuntimeRoute.test.ts packages/flarex-backend/test/artifactRuntimeRouteBoundary.test.ts packages/flarex-backend/test/artifactRuntimeRequests.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Scheduler And Delivery Internal Route Tagged Recovery

Previous completed checkpoint: `ed635ad` Use tagged execution connection recovery.

What changed:

- SchedulerDO and DeliveryDO internal route adapters now use
  `Effect.catchTags(...)` instead of broad catch-all recovery.
- Scheduler request JSON, scheduler payload, pending-state, response, runtime,
  maintenance, delivery-wake, force-reconnect, and route-operation failures
  remain typed until the Durable Object adapter maps them to the existing HTTP
  response behavior.
- DeliveryDO drain failures are now emitted as tagged
  `DeliveryDrainFailureError` values while preserving the existing failure
  result payload and HTTP `500` response shape.

Boundary decision:

SchedulerDO and DeliveryDO own the runtime recovery edge for their internal
JSON routes. Scheduler maintenance/delivery/reconnect helpers, delivery
claim/fanout/ack logic, and pending-state decoders continue to emit typed
failures and do not introduce new domain dependencies on `HttpError`.

Known limitations:

- This checkpoint does not change DeliveryDO alarm retry behavior, SchedulerDO
  alarm continuation behavior, delivery claim/fanout/ack logic, scheduler
  maintenance logic, PartitionDO SQL/OCC, protocol schemas, executor-http, or
  `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deliveryDO.test.ts packages/flarex-backend/test/deliveryRouteBoundary.test.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/schedulerMaintenanceBoundary.test.ts packages/flarex-backend/test/schedulerDeliveryWakeBoundary.test.ts packages/flarex-backend/test/schedulerForceReconnectBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Execution And Connection Internal Route Tagged Recovery

Previous completed checkpoint: `2c8803a` Use tagged generated route recovery.

What changed:

- ExecutionDO and ConnectionDO internal route adapters now use
  `Effect.catchTags(...)` instead of broad catch-all recovery.
- Request JSON, execution protocol, execution session, route operation,
  connection validation, and live-query delivery payload failures remain typed
  until the Durable Object adapter maps them to the existing HTTP response
  behavior.

Boundary decision:

ExecutionDO and ConnectionDO now own a tag-specific runtime recovery edge for
their internal JSON routes. Execution/session helpers, connection dispatch, and
shared request/payload decoders continue to emit typed failures and do not take
new dependencies on `HttpError` beyond the existing adapter mapping layer.

Known limitations:

- This checkpoint does not change ExecutionDO session lifecycle/syscalls,
  ConnectionDO WebSocket/session behavior, PartitionDO SQL/OCC,
  Scheduler/Delivery, protocol schemas, executor-http, or `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionSyscallRouteBoundary.test.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/connectionRouteBoundary.test.ts packages/flarex-backend/test/connectionRouteDispatchBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Generated HttpApi Durable Object Tagged Route Recovery

Previous completed checkpoint: `419cef3` Use tagged deployment handler recovery.

What changed:

- RegistryDO and DeploymentDO generated HttpApi internal route adapters now use
  `Effect.catchTags(...)` instead of broad catch-all recovery.
- Request JSON failures, protocol validation failures, and generated-handler
  operation failures remain typed until the Durable Object adapter maps them to
  the existing HTTP response behavior.

Boundary decision:

The generated HttpApi Durable Object adapters own the runtime recovery edge for
route decoding and generated handler forwarding. Registry and Deployment
service/store modules continue to emit typed failures and do not depend on
`HttpError`.

Known limitations:

- This checkpoint does not change generated Registry/Deployment HttpApi
  handlers, services/stores, SQL behavior, public Worker routes, protocol
  schemas, PartitionDO, executor-http, or `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryHttpApiRouteBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts packages/flarex-backend/test/registryHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Registry Request Payload Source Boundary

Previous completed checkpoint: `f35ae8d` Share artifact runtime request validation.

What changed:

- `packages/flarex-backend/src/registry/Requests.ts` now owns RegistryDO
  create-deployment payload validation using the shared registry protocol
  schema and typed `ProtocolValidationError`.
- `registry/HttpApiRouteBoundary.ts` delegates create-deployment payload
  validation to the shared source boundary while keeping JSON reading,
  generated-handler request reconstruction, and adapter-level HTTP mapping.
- Tests cover source decoder success and typed protocol failures directly
  before HTTP mapping.

Boundary decision:

Registry create-deployment payload validation is now source-owned by
`registry/Requests.ts`. The route boundary owns request JSON reading,
canonical generated-handler request reconstruction, read-route forwarding, and
HTTP conversion. Registry generated handlers, RegistryService, and RegistryStore
still own health/list/create behavior and SQLite persistence.

Known limitations:

- This checkpoint does not change registry generated HttpApi handlers,
  RegistryService/Store SQL behavior, Durable Object fallback route behavior,
  executor-http, protocol schemas, or `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryRequests.test.ts packages/flarex-backend/test/registryHttpApiRouteBoundary.test.ts packages/flarex-backend/test/registryHttpApiHandlers.test.ts packages/flarex-backend/test/registryService.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryDO.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Artifact Runtime Request Payload Source Boundary

Previous completed checkpoint: `6e4119b` Share connection request validation.

What changed:

- `packages/flarex-backend/src/artifactRuntime/Requests.ts` now owns execution
  artifact runtime invoke payload validation with typed
  `ExecutionArtifactInvokePayloadError`.
- `artifactRuntime/RouteBoundary.ts` delegates payload validation to the shared
  source boundary while keeping JSON reading, compatibility read/parse wrappers,
  and adapter-level HTTP mapping.
- Tests cover source decoder success and typed payload failures directly before
  HTTP mapping.

Boundary decision:

Artifact runtime invoke payload validation is now source-owned by
`artifactRuntime/Requests.ts`. The route boundary owns request JSON reading and
HTTP conversion. Runtime route matching, capability authorization, artifact
header validation, source-package lookup, materialization, and invocation remain
owned by `artifactRuntime/RuntimeRoute.ts`.

Known limitations:

- This checkpoint does not change artifact materialization/cache behavior,
  service-binding dispatch, public Worker artifact routing, executor-http,
  protocol schemas, or `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntimeRequests.test.ts packages/flarex-backend/test/artifactRuntimeRouteBoundary.test.ts packages/flarex-backend/test/artifactRuntimeRoute.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntime.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Connection Request Payload Source Boundary

Previous completed checkpoint: `a9cdba8` Share deployment push request validation.

What changed:

- `packages/flarex-backend/src/connection/Requests.ts` now owns ConnectionDO
  invalidation payload validation with typed `ConnectionRouteValidationError`.
- Connection live-query delivery payload decoding now flows through the same
  source boundary while continuing to use the shared
  `LiveQueryDeliveryChangePayloadError` emitted by `liveQueryDelivery.ts`.
- `connection/RouteBoundary.ts` keeps JSON reading, compatibility read/parse
  wrappers, and adapter-level HTTP mapping.
- Tests cover source decoder successes and typed failures directly before HTTP
  mapping.

Boundary decision:

Connection request payload validation is now source-owned by
`connection/Requests.ts`. Connection route adapters own request JSON reading and
HTTP conversion. Live-query delivery change validation remains source-owned by
the existing `liveQueryDelivery.ts` decoder because both ConnectionDO and public
Worker delivery routes share that payload contract.

Known limitations:

- ConnectionDO WebSocket/session lifecycle, route dispatch operation failures,
  public live-query delivery dispatch, scheduler delivery fanout, executor-http,
  protocol schemas, and `ValidatorJson` are unchanged.
- The public live-query delivery route already consumed the shared live-query
  payload decoder, so this checkpoint does not add a new public route module.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/connectionRequests.test.ts packages/flarex-backend/test/connectionRouteBoundary.test.ts packages/flarex-backend/test/publicLiveQueryDeliveryRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/connectionRouteDispatchBoundary.test.ts packages/flarex-backend/test/liveQueryDelivery.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Deployment Push Request Payload Source Boundary

Previous completed checkpoint: `55c5287` Share public invoke request validation.

What changed:

- `packages/flarex-backend/src/deployment/Requests.ts` now owns internal
  DeploymentDO analyzed-start, finish, and abandon push payload decoding.
- The same source boundary owns public Worker source-only start,
  analyzed-start, finish, and abandon push payload decoding, including backend
  `StartPushRequest` source-package normalization.
- `HttpApiRouteBoundary.ts` and `PublicPushRouteBoundary.ts` delegate protocol
  parsing to the shared source boundary while keeping compatibility read/parse
  exports and adapter-level HTTP mapping.
- Tests cover the source decoders directly, including typed
  `DeploymentProtocolValidationError` failures before HTTP mapping.

Boundary decision:

Deployment push payload shape validation is now source-owned by
`deployment/Requests.ts`. Route boundary modules own JSON body reading,
compatibility throwing wrappers, route matching/reconstruction, and adapter
mapping. Deployment services and stores still own push orchestration,
persistence, activation, abandon behavior, artifact preflight, and validation
beyond the protocol payload shape.

Known limitations:

- Public source-only start and finish routes intentionally keep raw JSON reads
  in `PublicPushRouteBoundary.ts` because the Worker must run analyzer/artifact
  preflight before protocol parsing in those paths.
- Deployment service/store errors, artifact runtime dispatch, executor-http,
  protocol schemas, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentRequests.test.ts packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/push.test.ts -t "rejects malformed source-only push bodies when analyzer forwarding is configured|rejects malformed finish request bodies|requires durable artifact storage before public finish" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Public Invoke Request Payload Source Boundary

Previous completed checkpoint: `5d4192e` Share execution route payload validation.

What changed:

- `packages/flarex-backend/src/invoke/Requests.ts` now owns public invoke body
  decoding, route/body deployment id selection, and backend
  `InvokeRequest` normalization.
- `PublicInvokeRouteBoundary.ts` delegates source validation to the shared
  invoke request boundary while keeping compatibility read/parse exports and
  adapter-level HTTP mapping.
- The public Worker now calls the source-owned deployment id resolver before
  dispatching invoke execution.
- Tests cover typed source successes and failures directly before HTTP mapping.

Boundary decision:

Public invoke request validation is now source-owned by `invoke/Requests.ts`.
The route boundary owns JSON body reading, compatibility throwing wrappers, and
HTTP mapping. The Worker still owns public dispatch, active deployment loading,
artifact-runtime routing, and invoke execution response mapping.

Known limitations:

- Invoke execution failures and active deployment load failures remain in their
  existing Worker/invoke boundaries.
- Artifact runtime dispatch, PartitionDO SQL/OCC behavior, execution routes,
  executor-http, protocol schemas, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/invokeRequests.test.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/invoke.test.ts -t "Worker invoke route|public Worker invoke bodies" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Execution Request Payload Source Boundary

Previous completed checkpoint: `be9974b` Share partition route payload validation.

What changed:

- `packages/flarex-backend/src/execution/Requests.ts` now owns shared
  payload-source decoding for execution start, public start, syscall, finish,
  and public action forwarding.
- Start, syscall, finish, and public action route-boundary modules now delegate
  protocol-to-backend request normalization to the shared source boundary while
  keeping their existing compatibility read/parse exports.
- Public action forwarding still validates `syscall` and `finish` payloads
  before dispatch and keeps `abort` as well-formed JSON forwarding only.
- Tests cover the source decoders directly, including typed
  `ExecutionProtocolValidationError` failures before HTTP mapping.

Boundary decision:

Execution payload shape validation is now source-owned by
`execution/Requests.ts`. Route boundary modules own only JSON body reading,
compatibility throwing wrappers, and adapter-level HTTP mapping. ExecutionDO
still owns session lifecycle, transaction setup, syscall semantics, finish
commit/return behavior, and abort control flow.

Known limitations:

- The backend JSON normalizers still live in `JsonRouteBoundary.ts`; this
  checkpoint reuses them to avoid mixing a JSON module move into execution
  request ownership.
- ExecutionDO route operation failures, public Worker dispatch failures,
  PartitionDO SQL/OCC behavior, executor-http, protocol schemas, and
  `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionRequests.test.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionSyscallRouteBoundary.test.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts -t "execution start boundary|execution syscall bodies|execution finish bodies|keeps execution abort as a bodyless control message" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Public Worker Top-Level Effect Boundary

Previous completed checkpoint: `e9dfb06` Type public deployment dispatcher
boundary.

What changed:

- The top-level backend Worker router now runs through
  `Effect.fn("Worker.routePublicWorker")` with one `Effect.runPromise(...)`
  adapter edge for the Worker `fetch()` path.
- `/health`, top-level `/invoke`, registry `/deployments`, public scheduler
  routes, and deployment-scoped routes delegate to their existing branch
  helpers from that single route effect.
- The top-level router now maps branch-specific typed failures inside the
  Worker adapter effect, preserving public invoke's existing response-envelope
  mapping while still letting `HttpError` and deployment protocol validation
  failures reach the existing Worker `fetch()` catch path.

Convex reference:

- No new Convex source file was needed for this checkpoint. This is Cloudflare
  Worker adapter wiring around already-modeled route/service boundaries, not a
  change to Convex semantics, transaction behavior, sync behavior, or
  validator semantics.

How Flarex differs from Convex here:

- Flarex's public Worker must explicitly dispatch Cloudflare Durable Object
  bindings and generated internal routes. The route effect centralizes that
  adapter dispatch without pretending this Worker shape exists in Convex.

Known limitations:

- Source-package analyzer response decoding still uses an internal
  `Effect.runPromise(...)` compatibility decode.
- Durable Object internals, generated HttpApi routes, executor-http, and
  scheduled Worker behavior are unchanged.
- This does not yet convert remaining DO entrypoints such as ConnectionDO,
  DeliveryDO, SchedulerDO, or PartitionDO to a single fetch adapter edge.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicWorkerRoutePathBoundary.test.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/invoke.test.ts -t "Worker invoke route|public Worker invoke bodies" --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryDO.test.ts -t "creates and lists deployments|rejects invalid JSON before schema decoding|rejects schema-invalid create deployment bodies|updates an existing deployment id without duplicating list entries" --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicSchedulerRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/publicDeploymentPushDispatchSource.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "executes Add query modifications and emits Convex-style transitions|routes backend live query delivery callbacks to named connections|rejects malformed public live query delivery JSON at the Worker boundary|rejects unauthorized public live query delivery before parsing JSON|rejects invalid public live query delivery envelopes at the Worker boundary|rejects public live query deliveries whose target does not match the route deployment|rejects malformed public DeliveryDO wake JSON at the Worker boundary|rejects unauthorized public DeliveryDO wake before parsing JSON|rejects invalid public DeliveryDO wake envelopes at the Worker boundary" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Public Worker Deployment Dispatcher Effect Boundary

Previous completed checkpoint: `a4625c8` Type public deployment sync route
boundary.

What changed:

- The deployment-scoped public Worker subtree now runs through
  `Effect.fn("Worker.routeDeployment")` with one `Effect.runPromise(...)`
  adapter edge for `/deployments/:deploymentId/*`.
- Deployment id parsing, active deployment reads, scoped invoke, public push,
  execution, partition, sync, and deployment scheduler branches reuse their
  existing Effect-returning helpers instead of running separate runtime edges
  in the top-level dispatcher.
- The old async wrapper functions for deployment push, execution, and
  partition routing were removed; the dispatcher now calls their Effect route
  services directly.

Boundary decision:

This is a Worker adapter boundary, not a domain move. Branch-specific route
services still own request decoding, authorization, target validation, and
forwarding behavior. The dispatcher only chooses the deployment-scoped branch
and maps typed branch failures at the public Worker edge.

Known limitations:

- Top-level `/invoke`, `/deployments` registry, and public scheduler routes
  still have their own top-level runtime edges.
- Analyzer response decoding still uses an internal `Effect.runPromise(...)`
  as part of source-package analysis compatibility behavior.
- DeploymentDO, ExecutionDO, PartitionDO SQL/OCC, ConnectionDO, DeliveryDO,
  SchedulerDO, executor-http, generated HttpApi routes, protocol schemas, and
  `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicWorkerRoutePathBoundary.test.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/invoke.test.ts -t "Worker invoke route|public Worker invoke bodies" --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts -t "execution start boundary|execution syscall bodies|execution finish bodies" --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts -t "keeps execution abort as a bodyless control message" --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts -t "public partition|commit requests|schema-cache|commits through the public partition route boundary" --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "executes Add query modifications and emits Convex-style transitions|routes backend live query delivery callbacks to named connections|rejects malformed public live query delivery JSON at the Worker boundary|rejects unauthorized public live query delivery before parsing JSON|rejects invalid public live query delivery envelopes at the Worker boundary|rejects public live query deliveries whose target does not match the route deployment|rejects malformed public DeliveryDO wake JSON at the Worker boundary|rejects unauthorized public DeliveryDO wake before parsing JSON|rejects invalid public DeliveryDO wake envelopes at the Worker boundary" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Executor HTTP Backend Live Query Integration Boundary

Previous completed checkpoint: `6250aa2 Type artifact runtime route edge`.

What changed:

- `packages/executor-http/src/liveQueryDelivery.ts` now owns typed backend
  live-query integration errors for delivery, wake, and trigger helper calls.
- The public executor-http package exports the typed Effect helpers and error
  classes while preserving the existing callback factory APIs.
- Compatibility wrappers map typed integration failures back to plain
  `Error` values with the same message strings expected by existing executor
  callbacks.

Boundary decision:

These failures belong in `@flarex/executor-http`, not backend Worker route
modules, because they describe the executor adapter's outbound callback to a
Flarex backend deployment/scheduler endpoint. The backend remains responsible
for its own route response shape; executor-http owns the integration failure
seen by executor runtime callers.

Convex source files inspected:

- None for this checkpoint. This is Flarex executor adapter integration
  plumbing.

How Flarex differs from Convex:

- Flarex can run executor logic outside the backend Worker and callback into
  Cloudflare Worker/DO routes for live-query delivery and scheduling. That
  boundary needs typed integration errors before preserving the callback
  factory promise API.

Known limitations:

- The Elysia route registration remains in place.
- Backend Worker delivery/scheduler routes, PartitionDO SQL/OCC behavior,
  protocol packages, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
node ./node_modules/vitest/vitest.mjs run packages/executor-http/test/http.test.ts -t "backend live query|live query delivery callbacks|live query trigger notifications" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Artifact Runtime Invoke Route Edge

Previous completed checkpoint: `551a8b3 Type invoke runtime lookups`.

What changed:

- `packages/flarex-backend/src/artifactRuntime/RuntimeRoute.ts` now owns
  typed route errors for runtime not-found, authorization, and artifact header
  mismatch failures without exporting them through `flarex-backend/artifact-runtime`.
- The artifact runtime route boundary still owns malformed JSON and invoke
  payload validation through `artifactRuntime/RouteBoundary.ts`.
- `createExecutionArtifactRuntimeService(...)` is the adapter that maps both
  route-boundary and runtime service failures to HTTP JSON responses.

Boundary decision:

Runtime capability-token and artifact-header checks belong to the artifact
runtime service boundary. They are not public invoke protocol fields and should
not leak into deployment or Worker routing modules.

Convex source files inspected:

- None for this checkpoint. This boundary is specific to Flarex's
  Cloudflare-compatible dynamic artifact runtime.

How Flarex differs from Convex:

- Flarex can load and execute deployment artifacts through a runtime service
  that may receive source packages inline or fetch them from backend storage.
  The route boundary therefore protects artifact identity before materializer
  execution.

Known limitations:

- Full materializer dependency layering is still future work.
- Worker public invoke routing, deployment storage, executor-http, protocol
  packages, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntime.test.ts packages/flarex-backend/test/artifactRuntimeRouteBoundary.test.ts packages/flarex-backend/test/artifactRuntimeRoute.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Invoke Runtime Lookup Boundary

Previous completed checkpoint: `ddc6b56 Type live query delivery targets`.

What changed:

- `packages/flarex-backend/src/invoke.ts` now owns typed active deployment
  load, active metadata lookup, and invoke kind parsing helpers.
- Compatibility wrappers remain in `invoke.ts`, but the source failures are
  available as typed Effect errors before HTTP conversion.
- Worker artifact-runtime invoke routing consumes the typed active deployment
  lookup boundary directly.

Boundary decision:

Active deployment lookup is an invoke runtime boundary, not a public invoke
request schema and not a deployment service/storage concern. Keeping the typed
lookup helpers in `invoke.ts` matches the existing invoke validation errors
for function metadata, arguments, returns, documents, partitions, and query
planning.

Convex source files inspected:

- None for this checkpoint. This boundary is specific to Flarex's
  Cloudflare-backed active deployment lookup.

How Flarex differs from Convex:

- Flarex dispatches invoke work from Worker/ConnectionDO/ExecutionDO surfaces
  and loads deployment metadata over Durable Object/Worker boundaries. The
  typed helper keeps that lookup error local to backend runtime code instead
  of leaking it into protocol packages.

Known limitations:

- Full `executeInvoke(...)` Effect service extraction is still future work.
- PartitionDO SQL/OCC behavior, executor-http, protocol packages, and
  `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/invoke.test.ts -t "active deployment load|active function metadata|invalid invoke kind" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Live Query Delivery Target Boundary

Previous completed checkpoint: `2165c08 Type scheduler runtime failures`.

What changed:

- `packages/flarex-backend/src/liveQueryDelivery.ts` now owns typed target
  validation for deployment and connection scope mismatches.
- Public Worker routing maps `LiveQueryDeliveryTargetError` at the Worker edge
  instead of treating it as a generic dispatch failure.
- DeliveryDO keeps its existing drain failure envelope while using the typed
  target error to preserve the fanout failure status detail.

Boundary decision:

Delivery target validation belongs with shared live-query delivery fanout. It
is not a public request schema and not a ConnectionDO response schema; it
guards the runtime handoff from executor delivery rows to Cloudflare
connection Durable Objects.

Convex source files inspected:

- None for this checkpoint. This boundary is specific to Flarex's
  Durable-Object-based live-query delivery fanout.

How Flarex differs from Convex:

- Flarex routes delivery rows through backend Worker and DeliveryDO adapters
  before ConnectionDO fanout. Keeping target validation in the backend
  live-query delivery module avoids leaking Cloudflare connection naming rules
  into public protocol packages.

Known limitations:

- DeliveryDO service extraction is still future work.
- PartitionDO SQL/OCC behavior, executor-http, protocol packages, and
  `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/liveQueryDelivery.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "target does not match|fanout target validation" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Scheduler Runtime Error Boundary

Previous completed checkpoint: `9f8e11a Type scheduler response failures`.

What changed:

- `packages/flarex-backend/src/scheduler/RuntimeError.ts` now owns typed
  SchedulerDO runtime consistency failures.
- Continuation cursor mismatches and invalid force-reconnect target ids no
  longer depend on `HttpError` in SchedulerDO service logic.
- `SchedulerDO` remains the adapter that maps those typed runtime failures to
  the existing HTTP response contract.

Boundary decision:

Scheduler runtime consistency checks are backend runtime concerns, not public
protocol contracts and not executor response payload contracts. Keeping them in
the backend scheduler package preserves the Cloudflare-specific ownership while
removing adapter-shaped errors from the orchestration path.

Convex source files inspected:

- None for this checkpoint. The boundary is specific to Flarex's SchedulerDO
  continuation and connection-target model.

How Flarex differs from Convex:

- Flarex uses Durable Object names for live-query connection fanout and stores
  scheduler continuation cursors in DO storage, so these checks sit at the
  scheduler runtime boundary.

Known limitations:

- Full SchedulerDO service extraction is still future work.
- PartitionDO SQL/OCC behavior, executor-http, protocol packages, and
  `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "continuation cursor inconsistencies|invalid live query dead-letter reconnect targets" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Scheduler Executor Response Boundary

Previous completed checkpoint: `7c66a94 Type scheduler pending state`.

What changed:

- `packages/flarex-backend/src/scheduler/Responses.ts` remains the owner of
  executor maintenance response validation through typed
  `SchedulerResponseError` and `SchedulerResponsePayloadError` failures.
- `SchedulerDO` now propagates those typed failures from executor-call helpers
  instead of converting them to `HttpError` before the route adapter.
- `SchedulerDO` still owns live-query maintenance orchestration, failure
  aggregation, retry scheduling, alarm refresh, and final HTTP mapping.

Boundary decision:

Executor response shape validation belongs in the scheduler response module.
SchedulerDO should consume typed response failures as service failures and map
them only where it is actually adapting to HTTP.

Convex source files inspected:

- None for this checkpoint. The boundary is specific to Flarex's
  Cloudflare-to-executor maintenance HTTP calls.

How Flarex differs from Convex:

- Flarex has an explicit internal HTTP/service-binding hop between SchedulerDO
  and executor maintenance APIs. Keeping that hop typed in
  `scheduler/Responses.ts` prevents executor payload validation from becoming
  part of the DO orchestration code.

Known limitations:

- A later service extraction can move more SchedulerDO orchestration into
  Effect-native helpers once the remaining scheduler adapter-shaped failures
  are typed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/schedulerResponses.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "reports malformed executor cleanup payloads|reports executor failures during expired live query connection cleanup|reconciles expired live query connection deployment scans through SchedulerDO" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Scheduler Pending Continuation State Boundary

Previous completed checkpoint: `62988f1 Type delivery pending drain state`.

What changed:

- `packages/flarex-backend/src/scheduler/PendingState.ts` now owns persisted
  SchedulerDO continuation state validation for delivery reconcile, connection
  cleanup, and live-query rerun state.
- `SchedulerDO` still owns continuation orchestration, retry scheduling, alarm
  refresh, executor calls, and route handling, but no longer owns the
  field-by-field stored-state throwing helpers.
- Route adapter mapping remains in `SchedulerDO`, where
  `SchedulerPendingStateError` becomes the preserved HTTP `500` response.

Boundary decision:

Scheduler continuation state is backend runtime state, not protocol state.
Keeping the decoders beside scheduler route/response modules avoids leaking
internal DO alarm payloads into `flarex-protocol` while removing storage-state
validation from the main `SchedulerDO` orchestration file.

Convex source files inspected:

- None for this checkpoint. This boundary is specific to Flarex's Cloudflare
  Durable Object alarm continuation model.

How Flarex differs from Convex:

- Flarex resumes batched live-query maintenance through Durable Object storage
  and alarms. The package boundary keeps that Cloudflare-specific state in the
  backend package rather than pretending it is a public API contract.

Known limitations:

- SchedulerDO response parsing and operation failures remain separate boundary
  modules.
- Full scheduler service extraction is still future work; this checkpoint only
  extracts persisted pending-state validation.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Delivery Pending Drain State Boundary

Previous completed checkpoint: `df1e0fc Type stored push row validation`.

What changed:

- `packages/flarex-backend/src/delivery/PendingDrainState.ts` now owns
  persisted DeliveryDO pending drain state validation.
- `DeliveryDO` still owns continuation orchestration, retry scheduling, and
  drain execution, but no longer owns field-by-field stored-state throwing
  helpers.
- Route adapter mapping remains in `DeliveryDO`, where
  `DeliveryPendingDrainStateError` becomes the preserved HTTP `500` response.

Boundary decision:

Pending drain state is DeliveryDO runtime state. Keeping its decoder beside the
delivery route modules keeps storage-state validation out of claim/fanout/ack
workflow code while avoiding protocol-package ownership for internal persisted
state.

Known limitations:

- SchedulerDO continuation state needs its own equivalent boundary later.
- Delivery wake body validation, response payload validation, executor calls,
  PartitionDO, protocol packages, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deliveryRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/sync.test.ts -t "continues DeliveryDO" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Deployment Stored Push Row Boundary

Previous completed checkpoint: `af87f30 Type execution session errors`.

What changed:

- Stored deployment push row normalization now belongs to
  `packages/flarex-backend/src/deployment/Validation.ts` through
  `decodePushStatusFromRow(...)`.
- `DeploymentPushStore` continues to own SQL reads and writes, but it no longer
  classifies row-shape and stored JSON validation as SQL failures.
- `DeploymentService` propagates stored-row validation failures in the typed
  service error channel.

Boundary decision:

Persisted row shape is deployment domain data, not a SQL transport failure.
SQL statement failures remain `DeploymentSqlError`; decoded stored data
failures are `DeploymentValidationError`.

Known limitations:

- Generated HttpApi read/abandon handlers still map corrupted stored rows to
  storage-class responses to preserve their route contract.
- Protocol packages, executor-http, PartitionDO, and `ValidatorJson` are
  unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Execution Session Boundary

Previous completed checkpoint: `8447a2f Type connection fanout payloads`.

What changed:

- `packages/flarex-backend/src/execution/SessionError.ts` now owns typed
  session lifecycle/domain failures for ExecutionDO.
- `ExecutionDO` service methods return typed Effects and no longer throw
  `HttpError` for active-session, missing-session, kind mismatch, unsupported
  syscall, or mutation-only syscall validation.
- The DO route adapter remains the only place that maps those session failures
  to the legacy HTTP response shape.

Boundary decision:

Session lifecycle validation belongs to the ExecutionDO runtime service
boundary, not to protocol body decoders or PartitionDO. Async storage and
transaction failures stay in the existing route-operation boundary because they
represent execution operations after session validation.

Known limitations:

- Request body schemas remain in the execution route-boundary modules.
- PartitionDO SQL/OCC behavior, executor-http, protocol packages, and
  `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts packages/flarex-backend/test/executionSessionError.test.ts packages/flarex-backend/test/executionRouteOperationError.test.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionSyscallRouteBoundary.test.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Connection Fanout Result Boundary

Previous completed checkpoint: `401a08d` Type delivery scheduler payloads.

What changed:

- ConnectionDO fanout result payload validation now belongs to the
  `liveQueryDelivery.ts` delivery service boundary as an Effect decoder.
- `deliverLiveQueryChangesToConnections(...)` consumes that decoder instead of
  calling the compatibility parser directly after response-status decoding.
- The compatibility parser stays exported for direct parser tests and callers,
  but it delegates to the typed decoder before mapping to `HttpError`.

Boundary decision:

ConnectionDO fanout result shape is a delivery service contract. Keeping it in
`liveQueryDelivery.ts` preserves the existing skip-reason model while removing
throwing payload validation from the hot delivery workflow.

Known limitations:

- The lower-level response-status decoder remains in
  `liveQueryDeliveryResponses.ts`.
- Delivery request body parsing and target validation remain separate
  migration surfaces.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/liveQueryDelivery.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Response Payload Boundary Modules

Previous completed checkpoint: `6e0450a` Type public worker paths.

What changed:

- Live-query delivery response payload types and decoders now live beside the
  existing live-query response-status decoder in
  `packages/flarex-backend/src/liveQueryDeliveryResponses.ts`.
- Scheduler response payload types and decoders now live beside the existing
  scheduler response-status decoder in
  `packages/flarex-backend/src/scheduler/Responses.ts`.
- `DeliveryDO` and `SchedulerDO` consume those modules instead of owning
  successful foreign-response payload parsing inline.

Boundary decision:

Foreign response payload contracts belong at the response-boundary module, not
inside Durable Object workflow code. The DOs still own orchestration, retry,
alarm, and route adapter behavior.

Known limitations:

- Stored continuation-state parsing remains in the Durable Objects because it
  validates DO-owned persisted state, not a foreign response contract.
- PartitionDO, executor-http, protocol packages, and `ValidatorJson` are
  unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/liveQueryDeliveryResponses.test.ts packages/flarex-backend/test/schedulerResponses.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Public Worker Deployment Path Boundary

Previous completed checkpoint: `735fbff Type public execution routing`.

What changed:

- `packages/flarex-backend/src/worker/PublicRoutePathBoundary.ts` now owns
  public Worker path-segment parsing for deployment id, partition key, and
  deployment push paths.
- `packages/flarex-backend/src/worker.ts` delegates deployment, push, and
  partition path validation to that backend-only boundary before forwarding to
  DeploymentDO or PartitionDO, while preserving method-sensitive push route
  interpretation.
- Existing protocol packages continue to own body schemas; the new helper does
  not move route path concerns into `flarex-protocol`.

Boundary decision:

URL path segments are Worker adapter concerns. DeploymentDO and PartitionDO own
their internal route behavior and storage. Protocol packages own JSON request
contracts. This checkpoint keeps those responsibilities separate while typing
the Worker path boundary.

Known limitations:

- Future slices can apply the same pattern to public scheduler, sync, delivery,
  and deployment-scheduler route path details.
- DeploymentDO, PartitionDO, executor-http, protocol schemas, and
  `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicWorkerRoutePathBoundary.test.ts packages/flarex-backend/test/push.test.ts packages/flarex-backend/test/transaction.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Public Execution Route Typed Path Boundary

Previous completed checkpoint: `06af891 Type public invoke routing`.

What changed:

- `packages/flarex-backend/src/execution/ActionRouteBoundary.ts` now owns
  public execution route path parsing for session/action forwarding.
- `packages/flarex-backend/src/worker.ts` delegates execution action path
  validation to the typed boundary and uses the shared backend response JSON
  reader for execution-start response enrichment.
- Tests cover typed path failures directly and preserved Worker HTTP responses
  for missing session/action and unknown actions.

Boundary decision:

Execution protocol packages still own JSON body shape. Backend execution
route-boundary code owns Worker path segment shaping. Worker dispatch owns
forwarding to ExecutionDO and adapter response mapping.

Known limitations:

- A future slice can decide whether public execution dispatch should move out
  of `worker.ts` into a dedicated service module after the route boundary is
  fully typed.
- ExecutionDO, PartitionDO, protocol schemas, executor-http, and `ValidatorJson`
  are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Public Invoke Route Typed Execution Boundary

Previous completed checkpoint: `095ff56 Type invoke query planning`.

What changed:

- `packages/flarex-backend/src/invoke/PublicInvokeRouteBoundary.ts` now owns
  public invoke request shaping into backend `InvokeRequest` values through a
  typed Effect helper.
- `packages/flarex-backend/src/worker.ts` now treats public invoke dispatch as
  a typed Worker route operation instead of using an inner catch-all
  `invokeErrorResponse(...)` wrapper.
- Existing public invoke protocol schemas stay in `flarex-protocol/invoke`,
  while backend-only request shaping and dispatch mapping stay in
  `flarex-backend`.

Boundary decision:

Protocol packages validate the transport envelope. Backend route-boundary code
translates that envelope into backend runtime requests, and Worker code owns
dispatch to direct invoke or artifact runtime execution. Partition storage,
artifact runtime implementation details, and user `ValidatorJson` semantics
remain separate.

Known limitations:

- Active-deployment loading and direct invoke execution are still Promise
  compatibility APIs behind the public Worker route operation.
- A future service slice should decide whether public invoke dispatch deserves
  a dedicated service module instead of remaining in `worker.ts`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts packages/flarex-backend/test/artifactRuntimeRoute.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Invoke Query Planning Typed Failure Boundary

Previous completed checkpoint: this commit, `Type invoke query planning`.

What changed:

- `packages/flarex-backend/src/invoke.ts` now owns typed query planning
  failures for missing `withIndex`, unknown indexes, invalid index ranges, and
  non-unique `unique()` results.
- Effect helpers back query index requirement, metadata lookup, range-bound
  derivation, and unique-result validation.
- Existing query APIs map those typed failures to the same adapter-shaped
  `HttpError` responses for Worker, ConnectionDO, and ExecutionDO callers.

Boundary decision:

Query planning is invoke service/domain behavior. Partition query execution and
SQL/OCC remain below this boundary in `SingleShardTransaction` and PartitionDO.

Known limitations:

- Mutation commit, execution sessions, artifact runtime routing, and PartitionDO
  SQL/OCC are separate follow-up surfaces.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Invoke Partition Validation Typed Failure Boundary

Previous completed checkpoint: this commit, `Type invoke partition validation`.

What changed:

- `packages/flarex-backend/src/invoke.ts` now owns typed partition validation
  failures for execution-scope planning and create-root planning.
- Effect helpers back scope resolution, create-root validation, partition
  policy validation, and partition-key extraction.
- Existing sync callers keep using `resolveFunctionExecutionScope(...)`, which
  maps typed failures to the same `HttpError` adapter shape.

Boundary decision:

Partition metadata validation is invoke service/domain behavior. This
checkpoint keeps the typed failure source in `flarex-backend` while preserving
`ExecutionDO` and direct invoke compatibility at the adapter wrapper.

Known limitations:

- Query/index planning is a separate follow-up completed by the next
  checkpoint. Transaction commit, execution sessions, artifact runtime routing,
  and PartitionDO SQL/OCC are separate follow-up surfaces.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/executionDO.test.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Invoke Document Validation Typed Failure Boundary

Previous completed checkpoint: this commit, `Type invoke document validation`.

What changed:

- `packages/flarex-backend/src/invoke.ts` now owns typed document/table and
  placement validation errors in addition to the prior function/argument/return
  validation failures.
- Effect helpers back table lookup, document-id parsing, document-id table
  checks, document validator checks, document placement, and query placement.
- Existing Promise-based DB APIs map those typed failures to the same
  adapter-shaped `HttpError` responses for Worker, ConnectionDO, and
  ExecutionDO callers.

Boundary decision:

`ValidatorJson` remains the validation representation for user documents and
function values. This checkpoint changes the invoke error boundary shape, not
the validator contract or generated handler API.

Known limitations:

- Partition metadata validation is a separate follow-up completed by the next
  checkpoint. Query/index planning, transaction commit, execution sessions,
  artifact runtime routing, and PartitionDO SQL/OCC are separate follow-up
  surfaces.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Invoke Validation Typed Failure Boundary

Previous completed checkpoint: this commit, `Type invoke validation failures`.

What changed:

- `packages/flarex-backend/src/invoke.ts` now owns typed invoke validation
  errors for function metadata lookup, handler lookup, function kind checks,
  argument validation, and return validation.
- The legacy `executeInvoke(...)` Promise API and `validateReturn(...)`
  compatibility helper map those typed failures to the same `HttpError`
  adapter shape.
- Tests distinguish direct typed Effect failures from adapter response mapping.

Boundary decision:

Invoke validation is backend service/domain behavior, so it should not depend
on `HttpError`. The adapter-shaped error remains at the Promise/HTTP boundary
for existing Worker, ConnectionDO, and ExecutionDO callers.

Known limitations:

- PartitionDO SQL/OCC, transaction read/write validation, execution sessions,
  and artifact runtime routing are separate follow-up surfaces.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Deployment Artifact Ref Effect Boundary

Previous completed checkpoint: `8990f06` Share dev response JSON reads.

What changed:

- `deployment/Errors.ts` now owns `DeploymentArtifactRefError` for
  artifact-ref generation failures.
- `deployment/Runtime.ts` maps the `flarex/artifacts` async boundary into that
  typed error.
- `deployment/Service.ts` and `deployment/HttpBoundary.ts` keep the failure
  typed until the deployment HTTP adapter maps it.

Boundary decision:

Artifact-ref generation is a deployment runtime service boundary, not a
storage failure and not a Worker route failure. The deployment service
propagates the source-owned error, while HTTP classes still only appear at the
adapter edge.

Known limitations:

- This does not extract the artifact hashing implementation from
  `flarex/artifacts`.
- Generated worker source and PartitionDO remain separate package boundaries.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Flarex Dev Response JSON Shared Boundary

Previous completed checkpoint: `8e89a84` Type backend response JSON reads.

What changed:

- Added `flarex-dev/src/responseJson.ts` for shared dev response JSON read
  failures through `DevResponseJsonError`.
- `backendPush.ts`, `executionArtifact.ts`, and `runtimeMaterializer.ts` use
  `readDevResponseJsonOrNullEffect(...)` instead of local anonymous JSON-read
  promises.
- The shared boundary covers local backend push/analyzer/finish, execution
  artifact analysis/invoke, and materialized artifact response decoders.

Boundary decision:

`flarex-dev` has its own request route boundary and local runtime adapter
package surface, so its response body parsing stays inside `flarex-dev` rather
than importing the backend `http.ts` helper. Higher-level dev decoders still
own their operation-specific status/message/diagnostics error shapes.

Known limitations:

- The helper intentionally preserves the existing malformed-body `null`
  compatibility fallback for current callers.
- Generated worker source remains plain emitted Worker code and is not moved
  to this TypeScript Effect helper.
- This checkpoint does not introduce Effect Schema validation for successful
  dev response payloads.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-dev/vitest.config.ts packages/flarex-dev/test/responseJson.test.ts packages/flarex-dev/test/backendPush.test.ts packages/flarex-dev/test/executionArtifact.test.ts packages/flarex-dev/test/runtimeMaterializer.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Backend Response JSON Effect Boundary

Previous completed checkpoint: `47af99a` Type SchedulerDO route operation
failures.

What changed:

- `http.ts` now owns shared response JSON read failures through
  `ResponseJsonError`.
- Backend response modules use `readResponseJsonOrNullEffect(...)` instead of
  local anonymous JSON-read promises.
- The shared boundary covers backend analyzer, artifact runtime
  service-binding, live-query delivery, scheduler, and partition transaction
  response decoders.

Boundary decision:

HTTP response body parsing is a transport boundary and belongs beside the
request JSON boundary in `http.ts`. Higher-level response decoders still own
their operation-specific status/message/body error shapes, but no longer own
the low-level JSON read failure.

Known limitations:

- The helper intentionally preserves the existing malformed-body `null`
  compatibility fallback for these callers.
- This checkpoint does not introduce Effect Schema validation for successful
  response payloads.
- PartitionDO remains a correctness-sensitive follow-up and is not converted
  beyond the existing transaction response decoder call site.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/httpResponseJson.test.ts packages/flarex-backend/test/push.test.ts packages/flarex-backend/test/artifactRuntime.test.ts packages/flarex-backend/test/liveQueryDelivery.test.ts packages/flarex-backend/test/schedulerResponses.test.ts packages/flarex-backend/test/transaction.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## SchedulerDO Route Operation Effect Boundary

Previous completed checkpoint: `4f2a30d` Type ExecutionDO route operation
failures.

What changed:

- Added `scheduler/RouteOperationError.ts` for typed SchedulerDO route
  operation failures after request decoding succeeds.
- `scheduler/RouteBoundary.ts` still owns scheduler request JSON and envelope
  validation.
- `SchedulerDO.fetch()` now maps route-boundary and route-operation failures
  through one adapter helper for reconcile, cleanup, rerun, dead-letter, and
  continuation routes.

Boundary decision:

Scheduler request JSON and envelope errors stay in `scheduler/RouteBoundary.ts`.
Post-decode scheduler orchestration failures belong to the SchedulerDO route
operation boundary because they happen while reconciling live-query deliveries,
cleaning expired connections, rerunning subscriptions, dead-lettering stuck
deliveries, or resuming stored continuation state.

Known limitations:

- This checkpoint does not extract SchedulerDO reconciliation or continuation
  workflows into reusable services.
- Scheduler executor response parsing remains in the existing response boundary
  modules and compatibility parsers.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## ExecutionDO Route Operation Effect Boundary

Previous completed checkpoint: `49cfca6` Type DeliveryDO route operation
failures.

What changed:

- Added `execution/RouteOperationError.ts` for typed ExecutionDO route
  operation failures after request decoding succeeds.
- `execution/StartRouteBoundary.ts`, `execution/SyscallRouteBoundary.ts`, and
  `execution/FinishRouteBoundary.ts` still own request JSON and execution
  protocol validation.
- `ExecutionDO.fetch()` now maps route-boundary and route-operation failures
  through one adapter helper for `/start`, `/syscall`, and `/finish`.

Boundary decision:

Request JSON and execution protocol errors stay in the execution route
boundary modules. Stateful session start, syscall, and finish failures belong
to the ExecutionDO route operation boundary because they happen after decoding
while reading active deployment metadata, using transaction state, validating
returns, or committing writes.
Partition request failures remain source-owned by `transaction.ts`; the
ExecutionDO operation boundary preserves those causes so the invoke adapter can
return the original structured status/body.

Known limitations:

- This checkpoint does not extract ExecutionDO session lifecycle or transaction
  behavior into reusable services.
- Public Worker execution forwarding and generated execution artifacts remain
  separate package boundaries.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionSyscallRouteBoundary.test.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts packages/flarex-backend/test/executionRouteOperationError.test.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/transaction.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## DeliveryDO Route Operation Effect Boundary

Previous completed checkpoint: `ef864c0` Type ConnectionDO route operation
failures.

What changed:

- Added `delivery/RouteOperationError.ts` for typed DeliveryDO route operation
  failures after request decoding succeeds.
- `delivery/RouteBoundary.ts` still owns wake request JSON and envelope
  validation.
- `DeliveryDO.fetch()` now maps route-boundary, route-operation, and
  structured drain failures through one adapter helper for `/wake` and
  `/continue`.

Boundary decision:

Wake request JSON and envelope errors stay in `delivery/RouteBoundary.ts`.
Post-decode wake and pending-drain continuation failures belong to the
DeliveryDO route operation boundary because they happen while running the live
query delivery drain. `DeliveryDrainFailureError` remains its own structured
route failure so existing public failure summaries are preserved exactly.

Known limitations:

- This checkpoint does not move DeliveryDO claim/fanout/ack or retry alarm
  internals into reusable services.
- Executor response decoding stays in the existing live-query delivery response
  boundary modules.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deliveryRouteBoundary.test.ts packages/flarex-backend/test/publicDeliveryWakeRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## ConnectionDO Route Operation Effect Boundary

Previous completed checkpoint: `395d1d9` Type Worker pass-through dispatch
failures.

What changed:

- Added `connection/RouteOperationError.ts` for typed ConnectionDO route
  operation failures after request decoding succeeds.
- `connection/RouteBoundary.ts` still owns JSON and request-shape validation.
- `ConnectionDO.fetch()` now maps route-boundary and route-operation failures
  through one adapter helper for `/invalidate` and `/deliver/live-query`.

Boundary decision:

Request JSON and envelope errors stay in `connection/RouteBoundary.ts`.
Stateful invalidation and delivery failures belong to the ConnectionDO route
operation boundary because they happen after decoding while mutating live query
state and sending WebSocket transitions.

Known limitations:

- This checkpoint does not move ConnectionDO WebSocket message handling or
  executor/partition subscription calls into reusable services.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/connectionRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Worker Pass-Through Dispatch Effect Boundary

Previous completed checkpoint: `de9e3ee` Type public invoke and partition
dispatch failures.

What changed:

- `worker/PublicRouteDispatchError.ts` now covers the remaining Worker
  pass-through route sources: registry deployments, active deployment reads,
  connection sync forwarding, and deployment scheduler forwarding.
- `worker.ts` routes those pass-throughs through named Worker adapter helpers
  before final HTTP mapping.
- The owning Durable Objects still own their request validation, service logic,
  and response bodies.

Boundary decision:

These failures are Worker adapter dispatch failures because they occur while
forwarding already-matched public Worker routes to Durable Object bindings.
They are not Registry, Deployment, Connection, or Scheduler domain errors.

Known limitations:

- Scheduled event fanout is intentionally not folded into this HTTP route
  boundary.
- The next migration slice should return to deeper route/service Effect work
  now that Worker route dispatch handoffs are typed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts packages/flarex-backend/test/registryDO.test.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/sync.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Public Invoke And Partition Dispatch Effect Boundary

Previous completed checkpoint: `0a9faee` Type public deployment push dispatch
failures.

What changed:

- `worker/PublicRouteDispatchError.ts` now covers public invoke execution and
  public partition begin/document/index forwarding sources.
- `invoke/PublicInvokeRouteBoundary.ts`, `partition/RouteBoundary.ts`, and
  `partition/PublicSchemaCacheRouteBoundary.ts` still own request validation.
- `worker.ts` composes those route validation failures with shared Worker
  dispatch failures before final HTTP mapping.

Boundary decision:

These failures belong under `worker/` because they happen after public route
validation while the Worker adapter forwards to invoke runtime logic or
PartitionDO bindings. They are not protocol validation failures and not
PartitionDO SQL/OCC domain errors.

Known limitations:

- This checkpoint does not introduce an invoke service Layer or partition read
  response decoders.
- Registry and internal scheduler service-binding pass-through remain separate
  Worker-level surfaces.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/transaction.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Public Deployment Push Dispatch Effect Boundary

Previous completed checkpoint: `2871d1d` Type public scheduler dispatch
failures.

What changed:

- `worker/PublicRouteDispatchError.ts` now covers public deployment push
  forwarding, analyzer, and artifact-storage sources.
- `deployment/PublicPushRouteBoundary.ts` still owns request JSON and protocol
  validation failures.
- `worker.ts` composes deployment-push validation failures with shared Worker
  dispatch failures before final HTTP mapping.

Boundary decision:

Deployment push dispatch failures belong under `worker/` because they happen
after route bodies have decoded and while the public Worker adapter is
forwarding to analyzer, artifact storage, or Deployment DO bindings. They are
not deployment protocol validation errors and not DeploymentDO state-machine
errors.

Known limitations:

- The artifact check still returns the existing rejected finish response when
  durable storage is configured but the analyzed source artifact is missing.
- This checkpoint does not introduce a deployment-push service Layer.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Public Scheduler Dispatch Effect Boundary

Previous completed checkpoint: `f38ff04` Type live query delivery
authorization.

What changed:

- `worker/PublicRouteDispatchError.ts` now covers public scheduler forwarding
  sources.
- Scheduler route-boundary modules still own request validation and the Worker
  authorization boundary still owns token checks.
- `worker.ts` now composes scheduler validation, live-query delivery
  authorization, and scheduler forwarding failures through typed route errors
  before HTTP mapping.

Boundary decision:

Scheduler forwarding failures are Worker adapter failures because they happen
while forwarding already-decoded public requests to the scheduler binding. They
do not belong in scheduler request-body validation or SchedulerDO internals.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts packages/flarex-backend/test/publicSchedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "public Worker route dispatch errors|public scheduler route boundary|unauthorized live query|live query delivery reconcile|live query connection cleanup|live query subscriptions" --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Public Live Query Authorization Effect Boundary

Previous completed checkpoint: `8491c10` Type public Worker dispatch failures.

What changed:

- Added `worker/PublicLiveQueryDeliveryAuthorization.ts` as the Worker-owned
  authorization boundary for public live-query delivery control routes.
- Scheduler, live-query delivery, and delivery wake route-boundary modules
  continue to own request shape validation.
- Worker route helpers now compose authorization, route validation, and
  dispatch failures through typed channels before HTTP mapping.

Boundary decision:

Authorization stays under `worker/` because it is driven by Worker environment
bindings and applies across multiple route families. It is not part of the
scheduler, delivery, or protocol request body contracts.

Known limitations:

- The authorization helper is still environment-value based; no Effect Layer is
  introduced in this checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicLiveQueryDeliveryAuthorization.test.ts packages/flarex-backend/test/sync.test.ts -t "public live query delivery authorization|unauthorized public live query delivery|unauthorized public DeliveryDO wake|unauthorized live query" --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Public Worker Typed Dispatch Failures

Previous completed checkpoint: `a079a26` Type public invoke deployment errors.

What changed:

- Added `worker/PublicRouteDispatchError.ts` as the Worker-owned package
  boundary for downstream dispatch failures.
- Public route-boundary modules still own JSON/protocol validation failures.
- `worker.ts` composes those route-specific validation failures with the shared
  Worker dispatch failure before final HTTP mapping.

Boundary decision:

The dispatch error belongs under `worker/` because it is not a protocol error
and not owned by ExecutionDO, PartitionDO, DeliveryDO, or live-query delivery
domain logic. It describes the public Worker adapter failing to forward an
already-decoded request or parse the downstream response.

Known limitations:

- This does not move downstream service internals into reusable Effect services.
- Scheduler and live-query authorization compatibility paths are separate
  follow-up candidates.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts packages/flarex-backend/test/publicLiveQueryDeliveryRouteBoundary.test.ts packages/flarex-backend/test/publicDeliveryWakeRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Public Invoke Typed Missing-Deployment Failure

Previous completed checkpoint: `c5133c6` Name generated runtime JSON
boundaries.

What changed:

- `invoke/PublicInvokeRouteBoundary.ts` now owns the missing-deployment route
  error alongside JSON and invoke-protocol route failures.
- `worker.ts` no longer needs a public-invoke-specific `HttpError` branch for
  the missing deployment-id case.

Boundary decision:

Deployment-id precedence remains Worker-owned because it combines route,
header, and body sources. The failure type still lives in the public invoke
route-boundary module because it is part of the public invoke route contract and
HTTP mapping.

Known limitations:

- Broader invoke runtime errors remain in `invoke.ts` and are not converted to
  typed service/domain failures in this checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts packages/flarex-backend/test/invoke.test.ts -t "public invoke route boundary|decodes public Worker invoke bodies"
git diff --check
```

## Scheduler Response Decoder Ownership

Previous completed checkpoint: `1fb88f8` Type live query delivery responses
with Effect.

What changed:

- Scheduler response decoding now lives in
  `packages/flarex-backend/src/scheduler/Responses.ts`.
- SchedulerDO consumes that module for executor-maintenance and internal DO
  JSON responses while keeping result parsing and orchestration in
  `schedulerDO.ts`.
- Typed scheduler response failures map back to the existing backend
  `HttpError` adapter shape.

Boundary decision:

The decoder belongs under `scheduler/` because it is specific to SchedulerDO's
maintenance workflow and not a public protocol contract. It is testable without
importing `cloudflare:workers` Durable Object classes.

Known limitations:

- This does not promote scheduler maintenance response schemas into
  `flarex-protocol`.
- Generated runtime-worker and executor-http boundaries remain separate.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerResponses.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Live Query Delivery Response Decoder Ownership

Previous completed checkpoint: `fb563e3` Type backend internal responses with
Effect.

What changed:

- Live-query delivery response decoding now lives in
  `packages/flarex-backend/src/liveQueryDeliveryResponses.ts`.
- `DeliveryDO` and `liveQueryDelivery.ts` both consume the shared decoder module
  so claim, ack, and connection fanout response failures share one typed
  failure shape.
- The module maps typed failures to the existing backend `HttpError` adapter
  shape without importing Durable Object classes.

Boundary decision:

This is backend workflow adapter behavior rather than a public protocol
contract. The shared module belongs in `flarex-backend` because it coordinates
DeliveryDO and ConnectionDO fanout response handling without crossing into
`flarex-protocol`.

Known limitations:

- SchedulerDO maintenance response decoding still needs a separate ownership
  decision.
- The successful payload schemas are not promoted to protocol schemas in this
  checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/liveQueryDelivery.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Backend Internal Response Decoder Ownership

Previous completed checkpoint: `e726ae8` Type dev backend responses with
Effect.

What changed:

- Backend analyzer response decoding now lives in
  `packages/flarex-backend/src/backendAnalyzerResponse.ts` so it can be tested
  without importing the Worker entrypoint and its Cloudflare-only module graph.
- Artifact runtime service-binding response decoding remains in
  `artifactRuntime.ts` because it is specific to the backend runtime adapter.
- Partition response decoding remains in `transaction.ts` because it is
  specific to `SingleShardTransaction`'s PartitionDO integration.

Boundary decision:

These decoders are backend adapter boundaries, not reusable public protocol
contracts. They therefore stay in `flarex-backend` and map into existing
backend error/public shapes at the adapter edge.

Known limitations:

- Shared protocol schemas are not introduced for these successful payloads in
  this checkpoint.
- Delivery and scheduler response boundaries still need their own ownership
  decisions.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntime.test.ts packages/flarex-backend/test/transaction.test.ts packages/flarex-backend/test/push.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Flarex Dev Backend Response Boundaries

Previous completed checkpoint: `77c921a` Type materialized artifact responses
with Effect.

What changed:

- Backend analyzer/push response decoders live in `packages/flarex-dev` because
  they adapt local development HTTP/backend bindings to the existing dev API.
- Execution artifact response decoders also live in `packages/flarex-dev`
  because they are specific to local Miniflare execution artifact adapters.
- Typed Effect failures are converted back to existing public
  `ExecutionArtifactAnalysisError` or plain `Error` shapes at the adapter edge.

Boundary decision:

This checkpoint does not move transport contracts into `flarex-protocol`
because the successful response payloads are still dev-adapter compatibility
contracts, not reusable public protocol surfaces. Backend push services and
generated runtime-worker code keep their package ownership.

Convex references inspected:

- None in this checkpoint. This is Flarex dev adapter ownership.

Known limitations:

- Some successful payload parsers are still handwritten compatibility parsers.
  Future protocol promotion should happen only when the same contract is shared
  across backend/dev/runtime package boundaries.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-dev/vitest.config.ts packages/flarex-dev/test/backendPush.test.ts packages/flarex-dev/test/executionArtifact.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-dev typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-dev/vitest.config.ts packages/flarex-dev/test/runtimeMaterializer.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-dev/vitest.config.ts packages/flarex-dev/test/analyze.test.ts packages/flarex-dev/test/generate.test.ts packages/flarex-dev/test/generatedTypecheck.test.ts packages/flarex-dev/test/sourcePackage.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-dev/vitest.config.ts packages/flarex-dev/test/cli.test.ts packages/flarex-dev/test/dev.test.ts packages/flarex-dev/test/devDispose.test.ts packages/flarex-dev/test/index.test.ts packages/flarex-dev/test/routeBoundary.test.ts packages/flarex-dev/test/vite.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-dev/vitest.config.ts packages/flarex-dev/test/backendSyncRuntime.test.ts packages/flarex-dev/test/executorHttpRuntime.test.ts packages/flarex-dev/test/executionArtifactStore.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Materialized Artifact Response Boundary

Previous completed checkpoint: `92df423` Route generated HttpApi requests
through Effect.

What changed:

- `flarex-dev` now exposes a package-local typed Effect decoder for
  materialized execution artifact responses.
- `LocalMiniflareMaterializedExecutionArtifact` uses that decoder for invoke
  and query-session responses, then maps typed failures back to the legacy
  status-bearing Error shape expected by callers.

Boundary decision:

The response decoder belongs in `flarex-dev` because it is specific to the
local Miniflare artifact adapter. Backend artifact runtime contracts and
generated execution worker source remain in `flarex-backend` and generated
worker code respectively.

Convex references inspected:

- None in this checkpoint. This is Flarex local artifact adapter wiring.

Known limitations:

- This does not validate successful artifact response payload schemas yet.
  It preserves existing casts and only types the integration failure channel.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-dev/vitest.config.ts packages/flarex-dev/test/runtimeMaterializer.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-dev/vitest.config.ts packages/flarex-dev/test/runtimeMaterializer.test.ts packages/flarex-dev/test/generate.test.ts packages/flarex-dev/test/executionArtifact.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-dev test -- --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Generated HttpApi Effect Request Builders

Previous completed checkpoint: `425de44` Route flarex dev bodies through
Effect.

What changed:

- Added named Effect request builders for RegistryDO and DeploymentDO generated
  HttpApi routes.
- Registry and deployment Durable Object fetch handlers now run those builders
  at the adapter edge before dispatching to the generated HttpApi web handler.
- Promise compatibility wrappers remain for existing tests and callers, but
  now route through the same Effect request-builder implementation.

Boundary decision:

This is an adapter-edge migration only. Registry and deployment route-boundary
modules own JSON/protocol decoding and canonical generated-handler requests.
Generated HttpApi handlers still own request dispatch into the service layers,
and the registry/deployment service and storage layers are unchanged.

Convex references inspected:

- None in this checkpoint. The touched path is Flarex's generated HttpApi
  adapter wiring around existing route contracts.

Known limitations:

- The generated runtime-worker source still has its own direct body reads and
  needs a separate generated-source checkpoint.
- This does not extract RegistryDO or DeploymentDO service logic further; it
  only moves request-builder composition to the Effect adapter shape.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryHttpApiRouteBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend test
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

## Flarex Dev Effect Route Boundaries

Previous completed checkpoint: `4aa94cb` Route partition fetch edges through
Effect.

What changed:

- `flarex-dev` now depends on the workspace Effect v4 catalog entry.
- Local dev invoke and local analyzer request-body validation lives in
  `packages/flarex-dev/src/routeBoundary.ts`.
- The dev runtime and backend-push analyzer service consume the package-local
  decoders at their HTTP adapter edges.

Boundary decision:

`flarex-dev` owns local development adapter request normalization. Backend
protocol and Durable Object behavior remain in `flarex-backend`; executor
transaction semantics remain in executor packages. The generated runtime worker
string remains a separate generated-artifact boundary rather than importing
package-level dependencies.

Convex references inspected:

- None in this checkpoint. The touched code is Flarex local adapter plumbing,
  not a Convex API or storage semantic.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-dev/vitest.config.ts packages/flarex-dev/test/routeBoundary.test.ts packages/flarex-dev/test/backendPush.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
git diff --check
```

## PartitionDO Effect Route Adapters

Previous completed checkpoint: `e014550` Route execution fetch edges through
Effect.

What changed:

- `PartitionDO` now uses named `Effect.fn` route helpers for schema-cache,
  commit, subscription registration, subscription unregister, and connection
  unregister POST/PUT routes.
- Body-reading partition routes consume typed route-boundary decoders directly
  at the fetch edge instead of using Promise compatibility readers.
- Commit response mapping keeps the existing `201` for new commits and `200`
  for replayed idempotency-key commits.

Boundary decision:

This is an adapter-edge migration only. The partition route-boundary module
owns typed request decode and HTTP error mapping. `PartitionDO` still owns SQL
schema, schema-cache persistence, write-log/idempotency behavior, OCC
validation, partition-owner validation, and subscription state.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts packages/flarex-backend/test/sync.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
git diff --check
```

## ExecutionDO Effect Route Adapters

Previous completed checkpoint: `0974955` Route scheduler fetch edges through
Effect.

What changed:

- `ExecutionDO` now uses named `Effect.fn` route helpers for internal start,
  syscall, and finish POST routes.
- Body-reading execution routes consume typed route-boundary decoders directly
  at the fetch edge instead of using Promise compatibility readers.
- Execution syscall and finish route error mappers are exported for adapter
  reuse.

Boundary decision:

This is an adapter-edge migration only. The execution route-boundary modules
own typed request decode and HTTP error mapping. `ExecutionDO` still owns
session lifecycle, active function metadata lookup, transaction state,
syscall semantics, return validation, and commit/abort behavior.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm exec vitest run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionSyscallRouteBoundary.test.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/executionDO.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
git diff --check
```

## SchedulerDO Effect Route Adapters

Previous completed checkpoint: `678cc30` Route sync DO fetch edges through
Effect.

What changed:

- `SchedulerDO` now uses named `Effect.fn` route helpers for its scheduler
  maintenance POST routes and continuation POST routes.
- Body-reading scheduler routes consume typed route-boundary decoders directly
  at the fetch edge instead of using Promise compatibility readers.
- Continuation routes share the same named JSON response helper while leaving
  stored-state parsing and retry behavior in `SchedulerDO`.

Boundary decision:

This is an adapter-edge migration only. The scheduler route-boundary module
owns typed request decode and HTTP error mapping. `SchedulerDO` still owns
reconcile/rerun/dead-letter orchestration, durable continuation state, and
executor maintenance calls.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm exec vitest run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
git diff --check
```

## Connection And Delivery DO Effect Route Adapters

Previous completed checkpoint: `66139fe` Route executor HTTP bodies through
Effect.

What changed:

- `ConnectionDO` now uses named `Effect.fn` route helpers for its internal
  invalidation and live-query delivery POST routes.
- `DeliveryDO` now uses named `Effect.fn` route helpers for wake and continue
  drain endpoints.
- Both Durable Objects consume their existing typed route-boundary decoders
  directly at the fetch edge instead of going through Promise compatibility
  readers.

Boundary decision:

This is an adapter-edge migration only. `ConnectionDO` keeps WebSocket/session
state ownership, and `DeliveryDO` keeps delivery drain ownership. The route
boundary modules own typed request decode and HTTP error mapping; the DOs own
stateful operation execution.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm exec vitest run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/connectionRouteBoundary.test.ts packages/flarex-backend/test/deliveryRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
git diff --check
```

## Executor HTTP Effect Body Adapter

Previous completed checkpoint: `1e98c94` Route artifact runtime through Effect.

What changed:

- `@flarex/executor-http` now depends on `effect` and uses a shared
  `ExecutorHttp.routeBody` `Effect.fn` for all POST body routes.
- The Elysia adapter now models malformed JSON, body validation failures, and
  executor operation failures as typed adapter errors before mapping them back
  to the existing HTTP response bodies.
- Invoke/session, live-query subscription, live-query connection, and
  maintenance handlers no longer each own a separate `request.json()` and
  executor `try/catch` block.

Boundary decision:

`@flarex/executor-http` remains the framework-neutral HTTP adapter over
`@flarex/executor`. Endpoint parser functions stay local to the adapter, and
executor core behavior stays in `@flarex/executor`. This checkpoint does not
move parser contracts into `flarex-protocol`, change Elysia route registration,
or alter Nitro inheritance of the shared HTTP adapter.

Preserved behavior:

- Capability-token authorization still runs before body parsing.
- Optional maintenance configurations still return their existing `501`
  responses before body parsing.
- Existing parser error messages and executor error status/body mappings are
  preserved by tests.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-http build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Service-Binding Runtime Invoke Effect Boundary

Previous completed checkpoint: this commit, `Type service-binding runtime
invoke failures`.

What changed:

- `artifactRuntime.ts` now exports a service-binding invoke `Effect.fn` for the
  backend-to-artifact-runtime integration path.
- The class-owned Promise API remains the package boundary for
  `BackendExecutionArtifactRuntime`, but its internal failure channel is now
  typed for source-package load, runtime binding fetch, and runtime response
  failures.

Boundary decision:

This remains backend-owned runtime adapter code. `ExecutionArtifactInvokePayload`
and the service-binding runtime failure types stay in `flarex-backend`; this
checkpoint does not promote artifact runtime internals into `flarex-protocol`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntime.test.ts packages/flarex-backend/test/artifactRuntimeRouteBoundary.test.ts
corepack pnpm --filter flarex-backend build
git diff --check
```

## Artifact Runtime Service Effect Adapter

Previous completed checkpoint: `c0f92c8` Type partition route bodies with Effect.

What changed:

- `artifactRuntime/RouteBoundary.ts` still owns execution artifact invoke body
  shape validation, now through a typed validation result helper and exported
  route error mapper.
- `artifactRuntime.ts` now owns runtime adapter orchestration through the named
  `ExecutionArtifactRuntime.routeInvoke` `Effect.fn` instead of a broad async
  `try/catch`.
- Missing source-package cases and runtime operations now have tagged runtime
  errors before the fetch adapter maps them to the existing JSON error
  responses.

Boundary decision:

The route-boundary module owns JSON/body decoding. The runtime service owns
authorization, artifact header checks, source-package resolution, materializer
cache lifecycle, and artifact invocation. This checkpoint does not move
`ExecutionArtifactInvokePayload` into `flarex-protocol`, and it does not change
the runtime materializer/store package contracts.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntimeRouteBoundary.test.ts packages/flarex-backend/test/artifactRuntime.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntimeRouteBoundary.test.ts packages/flarex-backend/test/artifactRuntime.test.ts packages/flarex-backend/test/artifactRuntimeRoute.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Public Invoke Worker Effect Boundary

Previous completed checkpoint: `3440a4f` Normalize deployment validation results.

What changed:

- The public invoke route-boundary module now exports its typed route error
  mapper for Worker adapter reuse.
- Both public Worker invoke entrypoints now compose the module-owned typed
  decoder through one `Effect.fn` helper instead of calling the compatibility
  Promise reader directly.
- Package ownership remains unchanged: invoke protocol parsing stays in
  `flarex-protocol`, public invoke body decoding stays in
  `invoke/PublicInvokeRouteBoundary.ts`, and execution dispatch stays in
  `worker.ts` / `invoke.ts`.

Boundary decision:

The Worker remains the adapter edge for deployment-id precedence and invoke
dispatch. JSON and invoke protocol failures stay typed until the Worker maps
them to the existing public HTTP response envelope.

Known limitations and follow-up work:

- Scheduler, execution, partition, delivery, and live-query public Worker route
  groups still have compatibility reader paths to migrate.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts packages/flarex-backend/test/invoke.test.ts -t "public invoke route boundary|Worker invoke route|decodes public Worker invoke bodies"
git diff --check
```

## Public Start Push Worker Effect Boundaries

Previous completed checkpoint: `187392e` Route public finish push through Effect.

What changed:

- Public source-only start-push raw JSON reading now has an exported
  Effect-returning decoder, with the Promise wrapper kept for compatibility.
- Worker source-only start and analyzed-start forwarding now compose
  module-owned typed route decoders inside `Effect.fn` adapter helpers.
- Package ownership remains unchanged: protocol parsing stays in
  `flarex-protocol`, public route decoding stays in
  `deployment/PublicPushRouteBoundary.ts`, analyzer orchestration and artifact
  persistence stay in the Worker adapter, and deployment persistence still
  belongs to `DeploymentDO` / `DeploymentService`.

Boundary decision:

The public Worker remains the adapter edge for analyzer availability and
forwarding. Typed request JSON and deployment protocol errors stay in the Effect
error channel until the Worker maps them to existing public HTTP responses.

Known limitations and follow-up work:

- Other public Worker route groups outside deployment push still need the same
  typed Effect route-boundary treatment.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts -t "public deployment push route boundary|keeps public start source-only|rejects malformed analyzed push request bodies|rejects malformed source-only push bodies|preserves analyzer codegen"
git diff --check
```

## Public Finish Push Worker Effect Boundary

Previous completed checkpoint: `36cc6fb` Route public abandon push through Effect.

What changed:

- Public finish-push raw JSON reading now has an exported Effect-returning
  decoder, with the Promise wrapper kept for compatibility.
- Worker finish-push forwarding now composes the public deployment route-boundary
  decoder, artifact preflight, protocol parser, and generated DeploymentApi
  forwarding in one `Effect.fn` adapter helper.
- Package ownership remains unchanged: protocol parsing stays in
  `flarex-protocol`, public route decoding stays in
  `deployment/PublicPushRouteBoundary.ts`, artifact preflight stays in the
  Worker adapter, and deployment activation still belongs to `DeploymentDO` /
  `DeploymentService`.

Boundary decision:

The missing-artifact check is Worker adapter behavior because it validates
public durable artifact availability before forwarding activation. The route
still keeps typed JSON/protocol failures until the Worker adapter mapping.

Known limitations and follow-up work:

- Public start-push and analyzed-start Worker forwarding are still candidates
  for the same typed Effect route-boundary treatment.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts -t "public deployment push route boundary|requires durable artifact storage|rejects malformed finish request bodies|does not activate failed or unknown pushes"
git diff --check
```

## Public Abandon Push Worker Effect Boundary

Previous completed checkpoint: `bfb948b` Type deployment validation boundary batch.

What changed:

- The public Worker abandon-push route now consumes the module-owned typed
  deployment route decoder instead of the compatibility Promise/throw wrapper.
- `publicDeploymentRouteErrorToHttpError(...)` is exported from the public
  deployment route-boundary module so Worker adapter mapping can reuse the same
  route-boundary policy as compatibility readers.
- Package ownership remains unchanged: protocol parsing stays in
  `flarex-protocol`, public route decoding stays in
  `deployment/PublicPushRouteBoundary.ts`, and Worker forwarding stays in
  `worker.ts`.

Boundary decision:

The public Worker is an adapter edge. It may map typed request JSON failures to
`HttpError` for the existing response envelope, but deployment protocol and
service/domain validation stay typed until their adapter mapping points.

Known limitations and follow-up work:

- Finish-push needs a larger follow-up because artifact availability preflight
  currently depends on reading raw JSON before protocol parsing.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts -t "public deployment push route boundary|rejects malformed abandon request bodies|abandons analyzed pushes without activating them|normalizes abandon reasons|does not abandon activated or unknown pushes"
git diff --check
```

## Deployment HttpApi Direct Failure Response Mapping

Previous completed checkpoint: this commit, `Map deployment handler failures
directly`.

What changed:

- Generated Deployment HttpApi handler mapping now branches on typed deployment
  failures directly and returns declared protocol response classes.
- `deploymentFailureToHttpError(...)` remains the HTTP boundary adapter for
  Worker/DO compatibility, but it is no longer the generated handler's normal
  service-failure bridge.
- Handler tests now cover direct typed failure mapping separately from
  preserved explicit `HttpError` response-class mapping.

Boundary decision:

`flarex-backend` owns the generated handler service boundary and can see typed
deployment service failures. `HttpError` stays at HTTP adapter compatibility
edges instead of being recreated inside the handler service pipeline.

Preserved behavior:

- Generated Deployment HttpApi route statuses and response bodies are
  unchanged.
- Public Worker routes, SQL schema, protocol schemas, PartitionDO,
  executor-http, and `ValidatorJson` remain in their existing owners.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts packages/flarex-backend/test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-backend build
git diff --check
```

## Deployment Service HttpError Fallback Removal

Previous completed checkpoint: this commit, `Remove deployment service
HttpError fallback`.

What changed:

- Removed `HttpError` from the deployment service failure boundary.
- Removed legacy `HttpError(400)` validation fallback catches from
  start-analyzed handler input decoding and finish-push activation storage.
- Kept generated Deployment HttpApi response helpers as the HTTP adapter edge
  that maps produced `HttpError` values into protocol response classes.

Boundary decision:

Deployment service, store, and validation code now report typed deployment
failures. Adapter-shaped `HttpError` remains only at HTTP conversion helpers,
not in `DeploymentServiceFailure`.

Preserved behavior:

- Generated Deployment HttpApi route behavior and response bodies are
  unchanged.
- Public Worker routes, SQL schema, protocol schemas, PartitionDO,
  executor-http, and `ValidatorJson` remain in their existing owners.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
git diff --check
```

## Validator Metadata Result Boundary

Previous completed checkpoint: this commit, `Parse validator metadata without
throws`.

What changed:

- Added shared `parseValidatorJson(...)` as a non-throwing result helper beside
  the compatibility `assertValidatorJson(...)` wrapper.
- `deployment/Validation.ts` now consumes validator metadata parse results
  directly, so schema, function, and codegen validator metadata failures become
  `DeploymentValidationError` without catching thrown `BackendValidationError`.
- Direct shared validation tests cover both the result helper and the preserved
  throwing wrapper behavior.

Boundary decision:

`ValidatorJson` remains the backend representation for user document/function
validation. This checkpoint changes the error boundary shape, not the validator
contract or protocol ownership.

Preserved behavior:

- Existing validator metadata messages are unchanged.
- Runtime value validation, PartitionDO, generated Deployment HttpApi handlers,
  DeploymentService/Store, SQL behavior, protocol schemas, executor-http, and
  public Worker routes are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/validation.test.ts packages/flarex-backend/test/deploymentValidation.test.ts
corepack pnpm --filter flarex-backend build
git diff --check
```

## Deployment Validation Module Typed Error Batch

Previous completed checkpoint: `1a11e50` Type deployment schema validation failures.

What changed:

- Finished the remaining `deployment/Validation.ts` domain-validation
  `HttpError(400)` branches by routing function metadata shape, schema state,
  schema placement, source position, route policy, partition policy, function
  kind/visibility, validator metadata, JSON-value validation failures, and
  failed start-push shape failures through `DeploymentValidationError`.
- Generated start-analyzed handler behavior is preserved: newly typed
  validation failures still map to start-route `400` responses with the same
  messages through `deploymentFailureToHttpError(...)`.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored deployment validation so corrupt
  stored metadata remains a finish validation failure rather than a storage
  failure.
- This checkpoint adopts the larger-slice alignment: validation migrations now
  move by coherent local boundary batches instead of one-branch commits, before
  returning to fuller route/service Effect conversions.

Boundary decision:

`deployment/Validation.ts` is a deployment-domain validation module. It should
not depend on adapter-shaped `HttpError`; HTTP status/body conversion belongs at
the generated handler adapter.

Convex source files inspected or used:

- None in this checkpoint. This is an internal Effect error-boundary cleanup
  preserving the existing Flarex validation messages and contracts.

Known limitations and follow-up work:

- The next migration slice should return to fuller route/service Effect work:
  typed request/body decoding, protocol decode failures, service failures, and
  one adapter HTTP mapping edge for a complete route path.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "deployment schema validation|deployment function validation|invalid analyzed start-push|typed analyzed start-push|maps service failures|activation validation failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Schema Shape Validation Typed Error

Previous completed checkpoint: `7a580ee` Type function partition validation failures.

What changed:

- `validateSchema(...)` now emits `DeploymentValidationError` instead of raw
  `HttpError(400)` for deployment schema shape validation failures.
- Generated start-analyzed handler behavior is preserved: non-object schemas,
  invalid versions, non-array tables/indexes, invalid table/index entries,
  duplicate ids, unknown index table references, invalid names, and invalid
  index fields still map to start-route `400` responses with the same messages
  through `deploymentFailureToHttpError(...)`.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored schema validation so corrupt stored
  schema metadata still follows the existing finish validation failure path.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis object validation, function partition
  validation, codegen object validation, codegen schema-mismatch validation,
  codegen functions-array validation, codegen module object validation, codegen
  moduleName validation, codegen module functions-array validation, duplicate
  codegen module validation, codegen function object validation, codegen
  function moduleName validation, codegen function exportName validation,
  missing codegen function metadata validation, duplicate codegen function
  validation, codegen function required-args validation, codegen coverage
  validation, codegen function metadata-match validation, function metadata
  shape validation, remaining schema/detail validation, abandon/active-deployment
  behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi
  routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol
  schemas, scheduler routes, execution routes, executor-http routes, and
  `ValidatorJson` remain unchanged.

Boundary decision:

Schema shape validation is deployment-domain validation. It now uses
`DeploymentValidationError`; HTTP status/body conversion remains at the
generated handler adapter.

Convex source files inspected or used:

- None in this checkpoint. This preserves the existing Flarex schema contract
  while removing another adapter error dependency from deployment validation.

Known limitations and follow-up work:

- Schema state, schema placement, schema validator metadata, function metadata
  shape, source-position, route-policy, partition-policy, kind/visibility, and
  validator metadata branches still need typed validation conversion.
- Future route-boundary work should continue moving toward Effect-returning
  decoders and typed body-read failures under the updated Effect migration
  quality bar.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "deployment schema validation|invalid analyzed start-push|typed analyzed start-push|maps service failures|activation validation failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Function Partition Validation Typed Error

Previous completed checkpoint: `641a567` Type codegen metadata match validation failures.

What changed:

- `validateFunctionPartitions(...)` now emits `DeploymentValidationError`
  instead of raw `HttpError(400)` for deployment function partition/schema
  semantic mismatches.
- Generated start-analyzed handler behavior is preserved: unknown partition
  tables, non-partitioned target tables, create-root mismatches, selector
  mismatches, missing required partition args, and route/partition argument
  mismatches still map to start-route `400` responses with the same messages
  through `deploymentFailureToHttpError(...)`.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored deployment analysis validation so
  corrupt stored partition metadata still follows the existing finish
  validation failure path.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis object validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  codegen module object validation, codegen moduleName validation, codegen
  module functions-array validation, duplicate codegen module validation,
  codegen function object validation, codegen function moduleName validation,
  codegen function exportName validation, missing codegen function metadata
  validation, duplicate codegen function validation, codegen function
  required-args validation, codegen coverage validation, codegen function
  metadata-match validation, schema, function metadata shape validation,
  remaining codegen detail validation, abandon/active-deployment behavior,
  route-boundary JSON/protocol decoders, generated Deployment HttpApi routing,
  public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas,
  scheduler routes, execution routes, executor-http routes, and `ValidatorJson`
  remain unchanged.

Boundary decision:

Function partition/schema compatibility is deployment-domain validation. It now
uses `DeploymentValidationError`; HTTP status/body conversion remains at the
generated handler adapter.

Convex source files inspected or used:

- None in this checkpoint. This preserves the existing Flarex function
  partition contract while removing another adapter error dependency from
  deployment validation.

Known limitations and follow-up work:

- Schema shape, function metadata shape, source-position, route-policy,
  partition-policy, placement, kind/visibility, and validator metadata branches
  still need typed validation conversion.
- Future route-boundary work should continue moving toward Effect-returning
  decoders and typed body-read failures under the updated Effect migration
  quality bar.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "deployment analysis validation|invalid analyzed start-push|typed analyzed start-push|maps service failures|activation validation failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Codegen Function Metadata Match Validation Typed Error

Previous completed checkpoint: `9138c4e` Type codegen coverage validation failures.

What changed:

- `validateCodegenAnalysis(...)` now emits `DeploymentValidationError` instead
  of raw `HttpError(400)` when a codegen function differs from its deployment
  function metadata.
- Generated start-analyzed handler behavior is preserved: codegen metadata
  mismatches still map to a start-route `400` response with the same message
  through `deploymentFailureToHttpError(...)`.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen still follows the existing finish validation failure path.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  codegen module object validation, codegen moduleName validation, codegen
  module functions-array validation, duplicate codegen module validation,
  codegen function object validation, codegen function moduleName validation,
  codegen function exportName validation, missing codegen function metadata
  validation, duplicate codegen function validation, codegen function
  required-args validation, codegen coverage validation, schema, function
  metadata, remaining codegen detail validation, abandon/active-deployment
  behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi
  routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol
  schemas, scheduler routes, execution routes, executor-http routes, and
  `ValidatorJson` remain unchanged.

Boundary decision:

Codegen/deployment metadata equality is deployment-domain validation. It now
uses `DeploymentValidationError`; HTTP status/body conversion remains at the
generated handler adapter.

Convex source files inspected or used:

- None in this checkpoint. This is an internal package-boundary cleanup that
  preserves the already-established deployment analysis contract.

Known limitations and follow-up work:

- Some schema, function metadata, and lower-level codegen detail validation
  branches still throw adapter-shaped `HttpError(400)` and should continue
  moving to typed deployment validation failures under the updated Effect
  migration quality bar.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "codegen analysis validation|invalid analyzed start-push|typed analyzed start-push|maps service failures|activation validation failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Codegen Coverage Validation Typed Error

Previous completed checkpoint: `47a8724` Type codegen function args validation failures.

What changed:

- `validateCodegenAnalysis(...)` now emits `DeploymentValidationError` instead
  of raw `HttpError(400)` when codegen analysis does not cover every deployment
  function.
- Generated start-analyzed handler behavior is preserved: incomplete codegen
  function coverage still maps to a start-route `400` response with the same
  message through `deploymentFailureToHttpError(...)`.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen still follows the existing finish validation failure path.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  codegen module object validation, codegen moduleName validation, codegen
  module functions-array validation, duplicate codegen module validation,
  codegen function object validation, codegen function moduleName validation,
  codegen function exportName validation, missing codegen function metadata
  validation, duplicate codegen function validation, codegen function
  required-args validation, schema, function metadata, remaining codegen detail
  validation, abandon/active-deployment behavior, route-boundary JSON/protocol
  decoders, generated Deployment HttpApi routing, public Worker routes,
  `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes,
  execution routes, executor-http routes, and `ValidatorJson` remain unchanged.

Boundary decision:

Codegen coverage is deployment-domain validation. It now uses
`DeploymentValidationError`; HTTP status/body conversion remains at the
generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "codegen analysis validation|invalid analyzed start-push|typed analyzed start-push|maps service failures|activation validation failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Codegen Function Required Args Validation Typed Error

Previous completed checkpoint: `8835cf0` Type duplicate codegen function validation failures.

What changed:

- `validateCodegenAnalysis(...)` now emits `DeploymentValidationError` instead
  of raw `HttpError(400)` when a codegen function is missing its required args
  validator.
- Generated start-analyzed handler behavior is preserved: missing codegen
  function args validators still map to a start-route `400` response with the
  same message through `deploymentFailureToHttpError(...)`.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen still follows the existing finish validation failure path.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  codegen module object validation, codegen moduleName validation, codegen
  module functions-array validation, duplicate codegen module validation,
  codegen function object validation, codegen function moduleName validation,
  codegen function exportName validation, missing codegen function metadata
  validation, duplicate codegen function validation, schema, function metadata,
  remaining codegen detail validation, abandon/active-deployment behavior,
  route-boundary JSON/protocol decoders, generated Deployment HttpApi routing,
  public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas,
  scheduler routes, execution routes, executor-http routes, and `ValidatorJson`
  remain unchanged.

Boundary decision:

Codegen function required-args validation is deployment-domain validation. It
now uses `DeploymentValidationError`; HTTP status/body conversion remains at
the generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "codegen analysis validation|invalid analyzed start-push|typed analyzed start-push|maps service failures|activation validation failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Duplicate Codegen Function Validation Typed Error

Previous completed checkpoint: `2b1f3e4` Type codegen function metadata validation failures.

What changed:

- `validateCodegenAnalysis(...)` now emits `DeploymentValidationError` instead
  of raw `HttpError(400)` when codegen analysis repeats a function metadata
  path.
- Generated start-analyzed handler behavior is preserved: duplicate codegen
  function metadata paths still map to a start-route `400` response with the
  same message through `deploymentFailureToHttpError(...)`.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen still follows the existing finish validation failure path.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  codegen module object validation, codegen moduleName validation, codegen
  module functions-array validation, duplicate codegen module validation,
  codegen function object validation, codegen function moduleName validation,
  codegen function exportName validation, missing codegen function metadata
  validation, schema, function metadata, remaining codegen detail validation,
  abandon/active-deployment behavior, route-boundary JSON/protocol decoders,
  generated Deployment HttpApi routing, public Worker routes, `DeploymentDO`
  routing, SQL schema, protocol schemas, scheduler routes, execution routes,
  executor-http routes, and `ValidatorJson` remain unchanged.

Boundary decision:

Duplicate codegen function path detection is deployment-domain validation. It
now uses `DeploymentValidationError`; HTTP status/body conversion remains at
the generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "codegen analysis validation|invalid analyzed start-push|typed analyzed start-push|maps service failures|activation validation failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Codegen Function Missing Metadata Validation Typed Error

Previous completed checkpoint: `59bb8cf` Type codegen function export validation failures.

What changed:

- `validateCodegenAnalysis(...)` now emits `DeploymentValidationError` instead
  of raw `HttpError(400)` when a codegen function path has no matching
  deployment function metadata.
- Generated start-analyzed handler behavior is preserved: codegen functions
  without deployment metadata still map to a start-route `400` response with
  the same message through `deploymentFailureToHttpError(...)`.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen still follows the existing finish validation failure path.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  codegen module object validation, codegen moduleName validation, codegen
  module functions-array validation, duplicate codegen module validation,
  codegen function object validation, codegen function moduleName validation,
  codegen function exportName validation, schema, function metadata, remaining
  codegen detail validation, abandon/active-deployment behavior, route-boundary
  JSON/protocol decoders, generated Deployment HttpApi routing, public Worker
  routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler
  routes, execution routes, executor-http routes, and `ValidatorJson` remain
  unchanged.

Boundary decision:

Codegen-to-deployment metadata consistency is deployment-domain validation. It
now uses `DeploymentValidationError`; HTTP status/body conversion remains at
the generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "codegen analysis validation|invalid analyzed start-push|typed analyzed start-push|maps service failures|activation validation failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Codegen Function ExportName Validation Typed Error

Previous completed checkpoint: `4c47ad0` Type codegen function module validation failures.

What changed:

- `validateCodegenAnalysis(...)` now emits `DeploymentValidationError` instead
  of raw `HttpError(400)` when a codegen function entry has an invalid
  `exportName`.
- Generated start-analyzed handler behavior is preserved: invalid codegen
  function export names still map to a start-route `400` response with the same
  message through `deploymentFailureToHttpError(...)`.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen still follows the existing finish validation failure path.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  codegen module object validation, codegen moduleName validation, codegen
  module functions-array validation, duplicate codegen module validation,
  codegen function object validation, codegen function moduleName validation,
  schema, function metadata, remaining codegen detail validation,
  abandon/active-deployment behavior, route-boundary JSON/protocol decoders,
  generated Deployment HttpApi routing, public Worker routes, `DeploymentDO`
  routing, SQL schema, protocol schemas, scheduler routes, execution routes,
  executor-http routes, and `ValidatorJson` remain unchanged.

Boundary decision:

Codegen function export-name validation is deployment-domain validation. It now
uses `DeploymentValidationError`; HTTP status/body conversion remains at the
generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "codegen analysis validation|invalid analyzed start-push|typed analyzed start-push|maps service failures|activation validation failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Codegen Function ModuleName Validation Typed Error

Previous completed checkpoint: `5bede60` Type codegen function object validation failures.

What changed:

- `validateCodegenAnalysis(...)` now emits `DeploymentValidationError` instead
  of raw `HttpError(400)` when a codegen function entry has a `moduleName` that
  does not match its containing module.
- Generated start-analyzed handler behavior is preserved: mismatched codegen
  function module names still map to a start-route `400` response with the same
  message through `deploymentFailureToHttpError(...)`.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen still follows the existing finish validation failure path.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  codegen module object validation, codegen moduleName validation, codegen
  module functions-array validation, duplicate codegen module validation,
  codegen function object validation, schema, function metadata, remaining
  codegen detail validation, abandon/active-deployment behavior, route-boundary
  JSON/protocol decoders, generated Deployment HttpApi routing, public Worker
  routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler
  routes, execution routes, executor-http routes, and `ValidatorJson` remain
  unchanged.

Boundary decision:

Codegen function module-name consistency is deployment-domain validation. It
now uses `DeploymentValidationError`; HTTP status/body conversion remains at
the generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "codegen analysis validation|invalid analyzed start-push|typed analyzed start-push|maps service failures|activation validation failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Codegen Function Object Validation Typed Error

Previous completed checkpoint: `fdf975c` Type duplicate codegen module validation failures.

What changed:

- `validateCodegenAnalysis(...)` now emits `DeploymentValidationError` instead
  of raw `HttpError(400)` when a codegen function entry is not an object.
- Generated start-analyzed handler behavior is preserved: non-object codegen
  functions still map to a start-route `400` response with the same message
  through `deploymentFailureToHttpError(...)`.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen still follows the existing finish validation failure path.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  codegen module object validation, codegen moduleName validation, codegen
  module functions-array validation, duplicate codegen module validation,
  schema, function metadata, remaining codegen detail validation,
  abandon/active-deployment behavior, route-boundary JSON/protocol decoders,
  generated Deployment HttpApi routing, public Worker routes, `DeploymentDO`
  routing, SQL schema, protocol schemas, scheduler routes, execution routes,
  executor-http routes, and `ValidatorJson` remain unchanged.

Boundary decision:

Codegen function entry shape is deployment-domain validation. It now uses
`DeploymentValidationError`; HTTP status/body conversion remains at the
generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "codegen analysis validation|invalid analyzed start-push|typed analyzed start-push|maps service failures|activation validation failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Duplicate Codegen Module Validation Typed Error

Previous completed checkpoint: `8cfa494` Type codegen module functions validation failures.

What changed:

- `validateCodegenAnalysis(...)` now emits `DeploymentValidationError` instead
  of raw `HttpError(400)` when codegen analysis repeats a module name.
- Generated start-analyzed handler behavior is preserved: duplicate codegen
  modules still map to a start-route `400` response with the same message
  through `deploymentFailureToHttpError(...)`.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen still follows the existing finish validation failure path.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  codegen module object validation, codegen moduleName validation, codegen
  module functions-array validation, schema, function metadata, remaining
  codegen detail validation, abandon/active-deployment behavior,
  route-boundary JSON/protocol decoders, generated Deployment HttpApi routing,
  public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas,
  scheduler routes, execution routes, executor-http routes, and `ValidatorJson`
  remain unchanged.

Boundary decision:

Duplicate codegen module detection is deployment-domain validation. It now uses
`DeploymentValidationError`; HTTP status/body conversion remains at the
generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "codegen analysis validation|invalid analyzed start-push|typed analyzed start-push|maps service failures|activation validation failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Codegen Module Functions Array Validation Typed Error

Previous completed checkpoint: `d21e660` Type codegen module name validation failures.

What changed:

- `validateCodegenAnalysis(...)` now emits `DeploymentValidationError` instead
  of raw `HttpError(400)` when a codegen module `functions` field is not an
  array.
- Generated start-analyzed handler behavior is preserved: non-array codegen
  module functions still map to a start-route `400` response with the same
  message through `deploymentFailureToHttpError(...)`.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen still follows the existing finish validation failure path.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  codegen module object validation, codegen moduleName validation, schema,
  function metadata, remaining codegen detail validation,
  abandon/active-deployment behavior, route-boundary JSON/protocol decoders,
  generated Deployment HttpApi routing, public Worker routes, `DeploymentDO`
  routing, SQL schema, protocol schemas, scheduler routes, execution routes,
  executor-http routes, and `ValidatorJson` remain unchanged.

Boundary decision:

Codegen module functions shape is deployment-domain validation. It now uses
`DeploymentValidationError`; HTTP status/body conversion remains at the
generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "codegen analysis validation|invalid analyzed start-push|typed analyzed start-push|maps service failures|activation validation failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Codegen ModuleName Validation Typed Error

Previous completed checkpoint: `a038c96` Type codegen module validation failures.

What changed:

- `validateCodegenAnalysis(...)` now emits `DeploymentValidationError` instead
  of raw `HttpError(400)` when a codegen module entry has an invalid
  `moduleName`.
- Generated start-analyzed handler behavior is preserved: invalid codegen
  module names still map to a start-route `400` response with the same message
  through `deploymentFailureToHttpError(...)`.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen still follows the existing finish validation failure path.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  codegen module object validation, schema, function metadata, remaining
  codegen detail validation, abandon/active-deployment behavior,
  route-boundary JSON/protocol decoders, generated Deployment HttpApi routing,
  public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas,
  scheduler routes, execution routes, executor-http routes, and `ValidatorJson`
  remain unchanged.

Boundary decision:

Codegen module-name shape is deployment-domain validation. It now uses
`DeploymentValidationError`; HTTP status/body conversion remains at the
generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "codegen analysis validation|invalid analyzed start-push|typed analyzed start-push|maps service failures|activation validation failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Codegen Module Object Validation Typed Error

Previous completed checkpoint: `bad1db8` Type codegen schema validation failures.

What changed:

- `validateCodegenAnalysis(...)` now emits `DeploymentValidationError` instead
  of raw `HttpError(400)` when a codegen module entry is not an object.
- Generated start-analyzed handler behavior is preserved: non-object codegen
  modules still map to a start-route `400` response with the same message
  through `deploymentFailureToHttpError(...)`.
- `DeploymentPushStore.finishPush(...)` preserves already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen still follows the existing finish validation failure path.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  schema, function metadata, remaining codegen detail validation,
  abandon/active-deployment behavior, route-boundary JSON/protocol decoders,
  generated Deployment HttpApi routing, public Worker routes, `DeploymentDO`
  routing, SQL schema, protocol schemas, scheduler routes, execution routes,
  executor-http routes, and `ValidatorJson` remain unchanged.

Boundary decision:

Codegen module entry shape is deployment-domain validation. It now uses
`DeploymentValidationError`; HTTP status/body conversion remains at the
generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "codegen analysis validation|invalid analyzed start-push|typed analyzed start-push|maps service failures|activation validation failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Codegen Schema Mismatch Validation Typed Error

Previous completed checkpoint: `510f891` Type codegen functions validation failures.

What changed:

- `validateCodegenAnalysis(...)` now emits `DeploymentValidationError` instead
  of raw `HttpError(400)` when the codegen analysis schema does not match the
  deployment analysis schema.
- Generated start-analyzed handler behavior is preserved: mismatched codegen
  schema still maps to a start-route `400` response with the same message
  through `deploymentFailureToHttpError(...)`.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen functions-array validation, schema, function metadata, remaining
  codegen detail validation, finish/abandon/active-deployment behavior,
  route-boundary JSON/protocol decoders, generated Deployment HttpApi routing,
  public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas,
  scheduler routes, execution routes, executor-http routes, and `ValidatorJson`
  remain unchanged.

Boundary decision:

Codegen schema compatibility is deployment-domain validation. It now uses
`DeploymentValidationError`; HTTP status/body conversion remains at the
generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "codegen analysis validation|invalid analyzed start-push|typed analyzed start-push|maps service failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Codegen Functions Array Validation Typed Error

Previous completed checkpoint: `9bbf0a7` Type codegen analysis validation failures.

What changed:

- `validateCodegenAnalysis(...)` now emits `DeploymentValidationError` instead
  of raw `HttpError(400)` when `codegenAnalysis.functions` is not an array.
- Generated start-analyzed handler behavior is preserved: non-array codegen
  functions still map to a start-route `400` response with the same message
  through `deploymentFailureToHttpError(...)`.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation, schema,
  function metadata, remaining codegen detail validation,
  finish/abandon/active-deployment behavior, route-boundary JSON/protocol
  decoders, generated Deployment HttpApi routing, public Worker routes,
  `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes,
  execution routes, executor-http routes, and `ValidatorJson` remain unchanged.

Boundary decision:

The top-level codegen-functions shape check is deployment-domain validation. It
now uses `DeploymentValidationError`; HTTP status/body conversion remains at the
generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "codegen analysis validation|invalid analyzed start-push|typed analyzed start-push|maps service failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Codegen Analysis Object Validation Typed Error

Previous completed checkpoint: `4363eea` Type deployment analysis validation failures.

What changed:

- `validateCodegenAnalysis(...)` now emits `DeploymentValidationError` instead
  of raw `HttpError(400)` when codegen analysis is not an object.
- Generated start-analyzed handler behavior is preserved: non-object codegen
  analysis still maps to a start-route `400` response with the same message
  through `deploymentFailureToHttpError(...)`.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, schema, function metadata,
  codegen detail validation, finish/abandon/active-deployment behavior,
  route-boundary JSON/protocol decoders, generated Deployment HttpApi routing,
  public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas,
  scheduler routes, execution routes, executor-http routes, and `ValidatorJson`
  remain unchanged.

Boundary decision:

The top-level codegen-analysis shape check is deployment-domain validation. It
now uses `DeploymentValidationError`; HTTP status/body conversion remains at the
generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "codegen analysis validation|invalid analyzed start-push|typed analyzed start-push|maps service failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Analysis Object Validation Typed Error

Previous completed checkpoint: `4aa2aa9` Type failed start validation failures.

What changed:

- `validateAnalysis(...)` now emits `DeploymentValidationError` instead of raw
  `HttpError(400)` when deployment analysis is not an object.
- Generated start-analyzed handler behavior is preserved: non-object deployment
  analysis still maps to a start-route `400` response with the same message
  through `deploymentFailureToHttpError(...)`.
- Source-package validation, diagnostics validation, failed start-input
  validation, schema, function metadata, codegen validation,
  finish/abandon/active-deployment behavior, route-boundary JSON/protocol
  decoders, generated Deployment HttpApi routing, public Worker routes,
  `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes,
  execution routes, executor-http routes, and `ValidatorJson` remain unchanged.

Boundary decision:

The top-level deployment-analysis shape check is deployment-domain validation.
It now uses `DeploymentValidationError`; HTTP status/body conversion remains at
the generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "deployment analysis validation|invalid analyzed start-push|typed analyzed start-push|maps service failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Failed Start Input Validation Typed Error

Previous completed checkpoint: `ac6665f` Type diagnostics validation failures.

What changed:

- `startAnalyzedPushInput(...)` now emits `DeploymentValidationError` instead
  of raw `HttpError(400)` when a failed start-push input omits its required
  error message.
- Generated start-analyzed handler behavior is preserved: the missing-error
  branch still maps to a start-route `400` response with the same message
  through `deploymentFailureToHttpError(...)`.
- Source-package validation, diagnostics validation, analysis, codegen, schema,
  function metadata validation, finish/abandon/active-deployment behavior,
  route-boundary JSON/protocol decoders, generated Deployment HttpApi routing,
  public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas,
  scheduler routes, execution routes, executor-http routes, and `ValidatorJson`
  remain unchanged.

Boundary decision:

The failed-push missing-error check is deployment-domain validation. It now uses
`DeploymentValidationError`; HTTP status/body conversion remains at the
generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "start-push service input|invalid analyzed start-push|typed analyzed start-push|maps service failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Diagnostics Validation Typed Error

Previous completed checkpoint: `c6ec92c` Type source package validation failures.

What changed:

- Added an Effect-returning diagnostics validation helper that exposes
  `DeploymentValidationError` directly for typed success/failure channel tests.
- `validateDiagnostics(...)` now emits `DeploymentValidationError` instead of
  raw `HttpError(400)` for diagnostics validation failures while retaining its
  synchronous compatibility shape for existing callers.
- Generated start-analyzed handler behavior is preserved: invalid diagnostics
  still map to start-route `400` responses with the same messages through
  `deploymentFailureToHttpError(...)`.
- Source-package validation, analysis, codegen, schema, function metadata
  validation, finish/abandon/active-deployment behavior, route-boundary
  JSON/protocol decoders, generated Deployment HttpApi routing, public Worker
  routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler
  routes, execution routes, executor-http routes, and `ValidatorJson` remain
  unchanged.

Boundary decision:

Diagnostics validation is deployment-domain validation. The validation boundary
now uses `DeploymentValidationError`; HTTP status/body conversion remains at the
generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "diagnostics|typed diagnostics|invalid analyzed start-push|typed analyzed start-push|maps service failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Source Package Validation Typed Error

Previous completed checkpoint: `b10123e` Type start analyzed handler validation failures.

What changed:

- Added an Effect-returning source-package validation helper that exposes
  `DeploymentValidationError` directly for typed success/failure channel tests.
- `validateSourcePackage(...)` now emits `DeploymentValidationError` instead of
  raw `HttpError(400)` for source-package domain validation failures while
  retaining its synchronous compatibility shape for existing callers.
- Generated start-analyzed handler behavior is preserved: invalid source
  packages still map to start-route `400` responses with the same messages
  through `deploymentFailureToHttpError(...)`.
- Diagnostics, analysis, codegen, schema, function metadata validation,
  finish/abandon/active-deployment behavior, route-boundary JSON/protocol
  decoders, generated Deployment HttpApi routing, public Worker routes,
  `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes,
  execution routes, executor-http routes, and `ValidatorJson` remain unchanged.

Boundary decision:

Source-package validation is deployment-domain validation, not an HTTP adapter
decision. The validation boundary now uses `DeploymentValidationError`; HTTP
status/body conversion remains at the generated handler adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "source package|typed source package|invalid analyzed start-push|typed analyzed start-push|maps service failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Start Handler Validation Typed Error

Previous completed checkpoint: `85e0262` Type finish activation validation failures.

What changed:

- Reused `DeploymentValidationError` for generated Deployment HttpApi
  start-analyzed handler-input validation failures.
- `decodeStartAnalyzedPushHandlerInput(...)` and
  `startAnalyzedPushHandlerInputFromPayload(...)` now convert protocol and
  deployment validation failures to `DeploymentValidationError` instead of raw
  `HttpError(400)`.
- `mapDeploymentStartFailure(...)` keeps start validation typed until
  `deploymentFailureToHttpError(...)`.
- Start-route HTTP behavior is preserved: invalid analyzed-start payloads still
  map to `400` with the same message, and generic storage failures still map to
  `500 Deployment storage error.`.
- Finish/abandon/active-deployment behavior, route-boundary JSON/protocol
  decoders, generated Deployment HttpApi routing, public Worker routes,
  `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes,
  execution routes, executor-http routes, and `ValidatorJson` remain in their
  existing owners.

Boundary decision:

Generated Deployment HttpApi start payload normalization now emits a typed
deployment validation failure. HTTP response conversion remains centralized in
`deploymentFailureToHttpError(...)` and the generated handler response adapters.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts -t "start-push|invalid analyzed start-push|maps service failures|preserved HttpError statuses"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Finish Validation Typed Error

Previous completed checkpoint: `397938f` Type active deployment metadata failures.

What changed:

- Added `DeploymentValidationError` for deployment validation failures that
  still map to preserved HTTP 400 responses at adapter edges.
- `DeploymentPushStore.finishPush(...)` now maps activation validation failures
  from schema/function application to `DeploymentValidationError` instead of
  leaking raw `HttpError(400)`.
- `DeploymentService.finishPush(...)`, `DeploymentPushStore.finishPush(...)`,
  and `mapDeploymentFinishFailure(...)` keep finish validation typed until
  `deploymentFailureToHttpError(...)`.
- Finish-route HTTP behavior is preserved: validation failures still map to
  `400` with the same message, missing pushes still map through
  `DeploymentPushNotFoundError`, rejected finish responses remain
  `FinishPushResponse` values, and generic storage failures remain
  `500 Deployment storage error.`.
- Start/abandon/active-deployment behavior, generated Deployment HttpApi
  handlers, public Worker routes, `DeploymentDO` routing, SQL schema, protocol
  schemas, scheduler routes, execution routes, executor-http routes, and
  `ValidatorJson` remain in their existing owners.

Boundary decision:

Finish activation validation is now represented as a deployment typed failure
inside service/store code. HTTP response conversion remains centralized in
`deploymentFailureToHttpError(...)` and the generated handler response adapters.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts -t "activation validation|typed service failures|maps service failures|preserved HttpError statuses|finish-push"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Active Metadata Typed Error

Previous completed checkpoint: `7b54f17` Treat missing finish rows as storage failures.

What changed:

- Added `DeploymentActiveDeploymentInvalidError` for corrupt or incomplete
  active-deployment metadata.
- `DeploymentPushStore.getActiveDeployment(...)` now emits that typed error
  for missing active push rows, missing analyzed deployment metadata, missing
  execution artifact refs, and invalid stored artifact refs.
- `DeploymentService.getActiveDeployment(...)` and
  `mapDeploymentReadFailure(...)` keep active metadata failures typed until
  adapter-level HTTP conversion.
- `deploymentFailureToHttpError(...)` preserves the existing HTTP behavior:
  missing active deployments return `404 No active deployment.`, invalid active
  metadata returns the same `500` message, and storage failures return
  `500 Deployment storage error.`.
- Finish/start/abandon behavior, generated Deployment HttpApi handlers, public
  Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas,
  scheduler routes, execution routes, executor-http routes, and `ValidatorJson`
  remain in their existing owners.

Boundary decision:

The store owns detection of invalid persisted active-deployment metadata and
emits a typed failure. The service propagates that failure without remapping.
HTTP response conversion remains at `deploymentFailureToHttpError(...)` and
the generated handler response adapters.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts -t "active deployment|typed service failures|maps service failures"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Finish Prevalidated Missing Error

Previous completed checkpoint: `0008080` Keep abandon failures in deployment service.

What changed:

- `DeploymentService.finishPush(...)` remains the boundary for public
  missing-push decisions and returns `DeploymentPushNotFoundError` before
  artifact lookup or persistence.
- `DeploymentPushStore.finishPush(...)` now treats a missing row during a
  prevalidated finish transaction as `DeploymentSqlError`, not `HttpError(404)`.
- Finish invalid-state and missing-analysis outcomes remain protocol response
  values owned by the finish persistence flow.
- Activation schema/function validation still preserves existing
  `HttpError(400, ...)` behavior until a later typed validation-error
  extraction checkpoint.
- Generated Deployment HttpApi handlers, public Worker finish forwarding,
  `DeploymentDO` routing, SQL schema, start/abandon behavior, protocol schemas,
  scheduler routes, execution routes, executor-http routes, and `ValidatorJson`
  remain in their existing owners.

Boundary decision:

`DeploymentService.finishPush(...)` owns public preflight and artifact-ref
lookup. `DeploymentPushStore.finishPush(...)` owns activation persistence and
protocol rejection responses for stored push state. A missing prevalidated row
inside storage is an internal storage invariant failure, while HTTP response
mapping remains at the adapter edge.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/push.test.ts -t "finishes analyzed pushes with controlled clock and artifact refs|preserves finish rejection responses from the store|returns a typed not-found error before artifact or finish work|preserves typed DeploymentSqlError failures from finish storage|reports missing prevalidated finish writes as storage failures|preserves activation HttpError failures from the finish transaction|handles finish-push mutations through the Worker-compatible web handler|does not finish failed or unknown pushes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment Abandon Service Error Ownership

Previous completed checkpoint: `9bcedd2` Add typed execution syscall decoder.

What changed:

- `packages/flarex-backend/src/deployment/Service.ts` now keeps
  `DeploymentService.abandonPush(...)` typed to deployment domain/storage
  failures, without `HttpError`.
- `packages/flarex-backend/src/deployment/Store.ts` now treats abandon as a
  prevalidated persistence write and reports only `DeploymentSqlError` from
  `DeploymentPushStore.abandonPush(...)`.
- `packages/flarex-backend/src/deployment/HttpApiHandlers.ts` still maps
  service-level typed abandon failures through `deploymentFailureToHttpError`.
- Public Worker abandon forwarding, `DeploymentDO` routing, protocol schemas,
  SQL schema, scheduler routes, execution routes, executor-http routes, and
  `ValidatorJson` remain in their existing owners.

Boundary decision:

`DeploymentService.abandonPush(...)` owns abandon orchestration: push lookup,
typed not-found/invalid-state checks, controlled timestamp use, and reason
normalization. `DeploymentPushStore.abandonPush(...)` owns the persistence write
only. HTTP response status/body conversion remains at the adapter edge.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/push.test.ts -t "abandons eligible pushes with controlled clock and normalized reasons|returns a typed not-found error before abandon storage work|returns a typed invalid-state error before abandon storage work|preserves typed DeploymentSqlError failures from abandon storage|persists prevalidated abandon writes through the store|handles abandon-push mutations through the Worker-compatible web handler|normalizes abandon reasons through the deployment service from public routes|does not abandon activated or unknown pushes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Execution Syscall Effect Decoder

Previous completed checkpoint: `ea19fc9` Add typed execution finish decoder.

What changed:

- `packages/flarex-backend/src/execution/SyscallRouteBoundary.ts` now exposes
  an Effect-typed execution syscall decoder.
- `readExecutionSyscallRequest(...)` keeps the ExecutionDO adapter stable while
  mapping typed `RequestJsonError` and `ExecutionProtocolValidationError`
  failures back to compatibility `HttpError` values.
- `parseExecutionSyscallRouteRequest(...)` remains a direct throwing parser for
  compatibility, while `parseExecutionSyscallRouteRequestEffect(...)` exposes
  the typed protocol validation channel.
- ExecutionDO syscall routing, public execution action forwarding, execution
  session state changes, start/finish routes, public invoke routes, deployment
  push routes, scheduler routes, partition routes, executor-http routes, and
  `ValidatorJson` remain in their existing owners.

Boundary decision:

The execution syscall route-boundary module owns JSON reading, protocol parsing,
backend JSON conversion, typed protocol errors, and compatibility `HttpError`
mapping. ExecutionDO and public action routing continue to call the existing
compatibility wrappers without owning syscall body validation.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionSyscallRouteBoundary.test.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/executionDO.test.ts -t "execution syscall route boundary|decodes public syscall bodies before forwarding|execution syscall"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Execution Finish Effect Decoder

Previous completed checkpoint: `c2d8a0b` Add typed public invoke decoder.

What changed:

- `packages/flarex-backend/src/execution/FinishRouteBoundary.ts` now exposes
  an Effect-typed execution finish decoder.
- `readExecutionFinishRequest(...)` keeps the ExecutionDO adapter stable while
  mapping typed `RequestJsonError` and `ExecutionProtocolValidationError`
  failures back to compatibility `HttpError` values.
- `parseExecutionFinishRouteRequest(...)` remains a direct throwing parser for
  compatibility, while `parseExecutionFinishRouteRequestEffect(...)` exposes
  the typed protocol validation channel.
- ExecutionDO finish routing, public execution action forwarding, execution
  session state changes, syscall/start routes, public invoke routes, deployment
  push routes, scheduler routes, partition routes, executor-http routes, and
  `ValidatorJson` remain in their existing owners.

Boundary decision:

The execution finish route-boundary module owns JSON reading, protocol parsing,
backend JSON conversion, typed protocol errors, and compatibility `HttpError`
mapping. ExecutionDO and public action routing continue to call the existing
compatibility wrappers without owning finish body validation.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/executionDO.test.ts -t "execution finish route boundary|decodes public finish bodies before forwarding|execution finish"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Public Invoke Effect Decoder

Previous completed checkpoint: `ae1d38c` Add typed artifact invoke decoder.

What changed:

- `packages/flarex-backend/src/invoke/PublicInvokeRouteBoundary.ts` now exposes
  an Effect-typed public invoke decoder.
- `readPublicInvokeRequest(...)` keeps the Worker-facing adapter stable while
  mapping typed `RequestJsonError` and `InvokeProtocolValidationError`
  failures back to compatibility `HttpError` values.
- `parsePublicInvokeRouteRequest(...)` remains a direct throwing parser for
  compatibility, while `parsePublicInvokeRouteRequestEffect(...)` exposes the
  typed protocol validation channel.
- Public `/invoke`, deployment-scoped `/invoke`, route/header defaulting,
  invoke dispatch, artifact runtime routing, deployment push routes, scheduler
  routes, partition routes, executor-http routes, and `ValidatorJson` remain in
  their existing owners.

Boundary decision:

The public invoke route-boundary module owns JSON reading, protocol parsing,
typed protocol errors, and compatibility `HttpError` mapping. The Worker still
owns route matching and defaulting from route/header context, while the invoke
module owns execution dispatch.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts packages/flarex-backend/test/invoke.test.ts -t "public invoke route boundary|rejects malformed invoke requests at the route boundary|routes deployment scoped invoke"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Artifact Runtime Invoke Effect Decoder

Previous completed checkpoint: `2112975` Add typed public source push decoder.

What changed:

- `packages/flarex-backend/src/artifactRuntime/RouteBoundary.ts` now exposes
  an Effect-typed runtime invoke decoder and a typed
  `ExecutionArtifactInvokePayloadError`.
- `readExecutionArtifactInvokePayload(...)` keeps the runtime-facing adapter
  stable while mapping only typed boundary failures back to compatibility
  `HttpError` values.
- `parseExecutionArtifactInvokePayload(...)` remains a direct throwing parser
  for compatibility, while `parseExecutionArtifactInvokePayloadEffect(...)`
  exposes the typed invalid-payload channel.
- Artifact runtime authorization, source-package loading, materializer cache
  behavior, invoke request dispatch, invoke failure status mapping, public
  invoke routes, deployment push routes, scheduler routes, partition routes,
  executor-http routes, and `ValidatorJson` remain in their existing owners.

Boundary decision:

The artifact runtime route-boundary module owns JSON reading, invoke payload
shape validation, typed payload-boundary errors, and compatibility `HttpError`
mapping. The artifact runtime service still owns authorization, source-package
resolution, module loading, materializer lifecycle, and invoke dispatch.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntimeRouteBoundary.test.ts packages/flarex-backend/test/artifactRuntime.test.ts -t "artifact runtime route boundary|rejects malformed or invalid runtime invoke payloads at the route boundary"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Public Source Push Effect Decoder

Previous completed checkpoint: `bbc9578` Add typed public finish decoder.

What changed:

- `packages/flarex-backend/src/deployment/PublicPushRouteBoundary.ts` now
  exposes an Effect-typed public source-only push decoder separate from the
  Worker-facing JSON-only helper.
- `readPublicStartPushJson(...)` keeps ownership of the public source-only
  JSON read step and maps only `RequestJsonError` back to the shared
  compatibility `HttpError`.
- `parsePublicStartPushRequest(...)` remains the post-analyzer-availability
  protocol parser, with `parsePublicStartPushRequestEffect(...)` exposing the
  typed `DeploymentProtocolValidationError` channel.
- Public Worker route paths, Worker forwarding, analyzer request/response
  behavior, analyzed package persistence, DeploymentDO generated-handler
  routing, deployment push finish/analyzed-start/abandon behavior, SQL
  statements, response bodies, request validation messages, protocol schemas,
  and `ValidatorJson` remain in their existing owners.

Boundary decision:

The public route-boundary module owns typed source-only JSON and protocol
parsing helpers. The Worker still owns analyzer binding checks and preserves
the current order: read JSON first, return no-analyzer `501` second when the
binding is absent, then parse the source-only protocol body only when analysis
can proceed.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts -t "public deployment push route boundary|keeps public start source-only|rejects malformed source-only push bodies when analyzer forwarding is configured"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Public Finish Push Effect Decoder

Previous completed checkpoint: `67bba2f` Add typed public analyzed start decoder.

What changed:

- `packages/flarex-backend/src/deployment/PublicPushRouteBoundary.ts` now
  exposes an Effect-typed public finish-push decoder separate from the
  Worker-facing JSON-only preflight helper.
- `readPublicFinishPushJson(...)` keeps ownership of the public finish JSON
  read step and maps only `RequestJsonError` back to the shared compatibility
  `HttpError`.
- `parsePublicFinishPushRequest(...)` remains the post-artifact-preflight
  protocol parser, with `parsePublicFinishPushRequestEffect(...)` exposing the
  typed `DeploymentProtocolValidationError` channel.
- Public Worker route paths, Worker forwarding, DeploymentDO generated-handler
  routing, `DeploymentApiHandlers.finishPush`, `DeploymentService.finishPush`,
  artifact reference computation, SQL statements, response bodies, request
  validation messages, protocol schemas, source-only analyzer routing,
  analyzed-start, abandon, and `ValidatorJson` remain in their existing owners.

Boundary decision:

The public route-boundary module owns typed JSON and protocol parsing helpers.
The Worker still owns the finish-specific ordering: read JSON first, run
artifact preflight second, then parse the finish protocol body only if preflight
allows forwarding. DeploymentDO owns internal generated-handler routing, and
DeploymentService owns finish orchestration.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts -t "public deployment push route boundary|requires durable artifact storage before public finish|rejects malformed finish request bodies"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Public Analyzed Start Push Effect Decoder

Previous completed checkpoint: `db370ea` Add typed public abandon decoder.

What changed:

- `packages/flarex-backend/src/deployment/PublicPushRouteBoundary.ts` now
  exposes an Effect-typed public analyzed-start decoder separate from the
  Worker-facing compatibility wrapper.
- Analyzed-start and abandon share public deployment route decoder helpers, so
  JSON reading and protocol parsing use the same typed boundary shape.
- `DeploymentProtocolValidationError` remains the protocol-boundary failure
  for invalid analyzed-start bodies; only `RequestJsonError` maps back to the
  shared compatibility `HttpError`.
- Public Worker forwarding, DeploymentDO generated-handler routing,
  `DeploymentApiHandlers.startAnalyzedPush`, `DeploymentService.startAnalyzedPush`,
  source-only analyzer routing, finish artifact preflight ordering, SQL
  statements, response bodies, request validation messages, protocol schemas,
  and `ValidatorJson` remain in their existing owners.

Boundary decision:

The public route-boundary module owns public analyzed-start body decoding and
compatibility mapping. The Worker owns public route matching and forwarding.
DeploymentDO owns internal generated-handler routing. DeploymentService owns
start-push orchestration. Public finish-push typed decoding remains a separate
checkpoint because its route intentionally separates JSON reading from protocol
validation around the artifact preflight.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts -t "public deployment push route boundary|rejects malformed analyzed start push bodies|keeps public start source-only"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Public Abandon Push Effect Decoder

Previous completed checkpoint: `4f4bb5d` Add typed registry create decoder.

What changed:

- `packages/flarex-backend/src/deployment/PublicPushRouteBoundary.ts` now
  exposes an Effect-typed public abandon-push decoder separate from the
  Worker-facing compatibility wrapper.
- `readPublicAbandonPushRequest(...)` keeps the public Worker boundary stable
  while delegating malformed JSON and protocol parsing through typed Effect
  channels.
- `DeploymentProtocolValidationError` remains the protocol-boundary failure
  for invalid abandon bodies; only `RequestJsonError` maps back to the shared
  compatibility `HttpError`.
- `DeploymentService.abandonPush(...)` continues to own abandon orchestration:
  push lookup, typed state checks, timestamp selection, and reason
  normalization.

Boundary decision:

The public route-boundary module owns public request-body decoding and
compatibility mapping. The Worker owns public route matching and forwarding.
DeploymentDO owns internal generated-handler routing. DeploymentService owns
abandon-push orchestration. DeploymentPushStore remains the SQL transaction
boundary and keeps its transactional guards.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts -t "public deployment push route boundary|normalizes abandon reasons|rejects malformed abandon request bodies|does not abandon activated or unknown pushes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Registry HttpApi Create Deployment Effect Decoder

Previous completed checkpoint: `43940c4` Share deployment route decoder adapter.

What changed:

- `packages/flarex-backend/src/registry/HttpApiRouteBoundary.ts` now exposes
  an Effect-typed create-deployment decoder separate from route matching and
  request reconstruction.
- `POST /deployments` uses the typed decoder before constructing the canonical
  generated-handler request.
- Plain create-deployment read/parse helpers remain compatibility wrappers
  around the Effect decoder or protocol parser.
- Registry read routes, malformed JSON handling, protocol validation failures,
  `RegistryDO.fetch()`, `RegistryApiHandlers`, `RegistryService`,
  `RegistryStore`, deployment records, scheduler routes, execution routes,
  deployment push routes, executor-http routes, and `ValidatorJson` remain in
  their existing owners.

Boundary decision:

The registry Durable Object still owns storage initialization and generated
HttpApi handler execution. The route-boundary module owns transport matching,
typed JSON decoding, protocol parsing, compatibility mapping, and
generated-handler request reconstruction.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryHttpApiRouteBoundary.test.ts packages/flarex-backend/test/registryDO.test.ts -t "registry HttpApi route boundary|creates and lists deployments"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment HttpApi Typed Decoder Adapter

Previous completed checkpoint: `0108eca` Add typed start route decoder.

What changed:

- `packages/flarex-backend/src/deployment/HttpApiRouteBoundary.ts` now has one
  local typed adapter path for deployment HttpApi mutation body decoding.
- Start-analyzed, finish, and abandon route-specific exports still define the
  route contract surface, while local helpers own JSON Effect composition,
  parser failure conversion, and compatibility adapter mapping.
- Deployment read routes, malformed JSON handling, protocol validation
  failures, `DeploymentDO.fetch()`, `DeploymentApiHandlers`,
  `DeploymentService`, `DeploymentPushStore`, public Worker push routes,
  scheduler routes, execution routes, executor-http routes, and
  `ValidatorJson` remain in their existing owners.

Boundary decision:

The route-boundary module owns typed transport decoding and generated-handler
request reconstruction. Route-specific exported helpers remain the public
backend boundary, while local generic helpers prevent the adapter mechanics
from forking across start, finish, and abandon.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts -t "deploymentApiRequestForRoute|handles analyzed start-push mutations through the Worker-compatible web handler|handles finish-push mutations through the Worker-compatible web handler|handles abandon-push mutations through the Worker-compatible web handler"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment HttpApi Start Analyzed Effect Decoder

Previous completed checkpoint: `aeae978` Add typed abandon route decoder.

What changed:

- `packages/flarex-backend/src/deployment/HttpApiRouteBoundary.ts` now
  exposes an Effect-typed start-analyzed decoder separate from route matching
  and request reconstruction.
- `POST /push/start-analyzed` uses the typed decoder before constructing the
  canonical generated-handler request.
- Plain start-analyzed read/parse helpers remain compatibility wrappers around
  the Effect decoder or protocol parser.
- Deployment read routes, malformed JSON handling, protocol validation
  failures, `DeploymentDO.fetch()`, `DeploymentApiHandlers`,
  `DeploymentService.startAnalyzedPush`, `DeploymentPushStore`,
  finish/abandon routes, public Worker push routes, scheduler routes,
  execution routes, executor-http routes, and `ValidatorJson` remain in their
  existing owners.

Boundary decision:

The deployment Durable Object still owns storage initialization and generated
HttpApi handler execution. `DeploymentService.startAnalyzedPush` owns
start-push orchestration. The route-boundary module owns transport matching,
typed JSON decoding, protocol parsing, compatibility mapping, and
generated-handler request reconstruction.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts -t "deploymentApiRequestForRoute|handles analyzed start-push mutations through the Worker-compatible web handler"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment HttpApi Abandon Push Effect Decoder

Previous completed checkpoint: `4080592` Add typed finish route decoder.

What changed:

- `packages/flarex-backend/src/deployment/HttpApiRouteBoundary.ts` now
  exposes an Effect-typed abandon-push decoder separate from route matching
  and request reconstruction.
- `POST /push/:pushId/abandon` uses the typed decoder before constructing the
  canonical generated-handler request.
- Plain abandon read/parse helpers remain compatibility wrappers around the
  Effect decoder or protocol parser.
- Deployment read routes, malformed JSON handling, protocol validation
  failures, `DeploymentDO.fetch()`, `DeploymentApiHandlers`,
  `DeploymentService.abandonPush`, `DeploymentPushStore`, finish/start push
  routes, public Worker push routes, scheduler routes, execution routes,
  executor-http routes, and `ValidatorJson` remain in their existing owners.

Boundary decision:

The deployment Durable Object still owns storage initialization and generated
HttpApi handler execution. `DeploymentService.abandonPush` owns abandon
orchestration. The route-boundary module owns transport matching, typed JSON
decoding, protocol parsing, compatibility mapping, and generated-handler
request reconstruction.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts -t "deploymentApiRequestForRoute|handles abandon-push mutations through the Worker-compatible web handler"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Effect-Typed Boundary Ownership

The migration target is not just smaller plain functions. Package boundaries
should make the Effect ownership model explicit.

Boundary rules for the next phase:

- Shared protocol packages own Effect Schema contracts and protocol validation
  errors. They may keep throwing `parseX(...)` compatibility wrappers, but
  migrated backend paths should call Effect-returning decoders.
- Backend route-boundary modules own transport matching, typed JSON reads, and
  route-specific request reconstruction. They should return typed Effect
  failures until the adapter edge maps them to HTTP.
- Durable Objects and generated HttpApi handlers own runtime adapter execution
  and HTTP response compatibility, not domain validation or parser throwing.
- Services own orchestration and domain decisions through `Effect.fn(...)`,
  `Context.Service`, and Layers. They should not depend on `HttpError` for
  normal domain flow.
- `HttpError` is allowed as an adapter compatibility bridge only. New domain,
  protocol, and service code should introduce tagged errors instead.
- `ValidatorJson` remains user data validation and should not be replaced by
  Effect Schema during transport/API cleanup.

Recommended package-boundary proof:

1. Add a typed backend request JSON error in the backend package.
2. Add an Effect decoder for one deployment HttpApi mutation route.
3. Keep the protocol package free of backend-only HTTP response code.
4. Keep the Durable Object as the single runtime boundary that maps typed
   route/protocol failures back to the existing responses.

## Deployment HttpApi Finish Push Route Boundary

Previous completed checkpoint: `c0537a6` Extract deployment abandon route parser.

What changed:

- `packages/flarex-backend/src/deployment/HttpApiRouteBoundary.ts` now
  exposes an Effect-typed finish-push decoder separate from route matching and
  request reconstruction.
- `packages/flarex-backend/src/http.ts` now exposes `readJsonEffect(...)` with
  tagged `RequestJsonError` for migrated route bodies.
- `POST /push/:pushId/finish` uses the typed decoder before constructing the
  canonical generated-handler request.
- Plain finish read/parse helpers remain compatibility wrappers around the
  Effect decoder or protocol parser.
- Deployment read routes, malformed JSON handling, protocol validation
  failures, `DeploymentDO.fetch()`, `DeploymentApiHandlers`,
  `DeploymentService.finishPush`, `DeploymentPushStore`, abandon/start push
  routes, public Worker push routes, scheduler routes, execution routes,
  executor-http routes, and `ValidatorJson` remain in their existing owners.

Boundary decision:

The deployment Durable Object still owns storage initialization and generated
HttpApi handler execution. `DeploymentService.finishPush` owns finish
activation orchestration. The route-boundary module owns only transport
matching, typed JSON decoding, protocol parsing, compatibility mapping, and
generated-handler request reconstruction.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts -t "deploymentApiRequestForRoute|handles finish-push mutations through the Worker-compatible web handler"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment HttpApi Abandon Push Route Boundary

Previous completed checkpoint: `e619b57` Extract registry create route parser.

What changed:

- `packages/flarex-backend/src/deployment/HttpApiRouteBoundary.ts` now
  separates abandon-push body parsing from route matching and request
  reconstruction.
- `POST /push/:pushId/abandon` uses named read/parse helpers before
  constructing the canonical generated-handler request.
- Deployment read routes, malformed JSON handling, protocol validation
  failures, `DeploymentDO.fetch()`, `DeploymentApiHandlers`,
  `DeploymentService.abandonPush`, `DeploymentPushStore`, finish/start push
  routes, public Worker push routes, scheduler routes, execution routes,
  executor-http routes, and `ValidatorJson` remain in their existing owners.

Boundary decision:

The deployment Durable Object still owns storage initialization and generated
HttpApi handler execution. `DeploymentService.abandonPush` owns abandon
orchestration. The route-boundary module owns only transport matching, JSON
decoding, protocol parsing, and generated-handler request reconstruction.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts -t "deploymentApiRequestForRoute|handles abandon-push mutations through the Worker-compatible web handler"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Registry HttpApi Create Deployment Route Boundary

Previous completed checkpoint: `1bf9355` Extract public execution action parser.

What changed:

- `packages/flarex-backend/src/registry/HttpApiRouteBoundary.ts` now separates
  create-deployment body parsing from route matching and request
  reconstruction.
- `POST /deployments` uses named read/parse helpers before constructing the
  canonical generated-handler request.
- Registry read routes, malformed JSON handling, protocol validation failures,
  `RegistryDO.fetch()`, `RegistryApiHandlers`, `RegistryService`,
  `RegistryStore`, deployment records, scheduler routes, execution routes,
  deployment push routes, executor-http routes, and `ValidatorJson` remain in
  their existing owners.

Boundary decision:

The registry Durable Object still owns persistence and generated HttpApi
handler execution. The route-boundary module owns only transport matching,
JSON decoding, protocol parsing, and generated-handler request reconstruction.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryHttpApiRouteBoundary.test.ts packages/flarex-backend/test/registryDO.test.ts -t "registry HttpApi route boundary|creates and lists deployments"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Public Execution Action Route Normalization Boundary

Previous completed checkpoint: `6397855` Extract public execution start parser.

What changed:

- `packages/flarex-backend/src/execution/ActionRouteBoundary.ts` now separates
  public execution action route normalization from JSON reading.
- Public Worker execution actions use `parsePublicExecutionActionRequest(...)`
  to dispatch syscall, finish, and abort action envelopes before forwarding to
  `ExecutionDO`.
- `ExecutionDO.fetch()`, `ExecutionDO.syscall(...)`, `ExecutionDO.finish(...)`,
  abort behavior, session lifecycle, PartitionDO, artifact runtime,
  executor-http, and `ValidatorJson` remain in their existing owners.

Boundary decision:

The Worker owns public execution action transport routing. The action-specific
route parsers own syscall and finish payload validation, while abort remains a
bodyless Durable Object action that accepts any well-formed public JSON
envelope. This checkpoint makes that split explicit without changing runtime
session ownership.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/executionDO.test.ts -t "public execution action route boundary|decodes execution syscall bodies before session dispatch|decodes execution finish bodies before session dispatch|keeps execution abort as a bodyless control message"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Public Execution Start Route Normalization Boundary

Previous completed checkpoint: `ccf823f` Normalize artifact runtime JSON boundary.

What changed:

- `packages/flarex-backend/src/execution/StartRouteBoundary.ts` now separates
  public execution start route normalization from JSON reading.
- Public Worker execution start uses `parsePublicExecutionStartRouteRequest(...)`
  to make the route deployment id authoritative before the shared execution
  protocol parser runs.
- Internal execution start parsing, `ExecutionDO.fetch()`, syscall, finish,
  abort routing, session lifecycle, PartitionDO, artifact runtime,
  executor-http, and `ValidatorJson` remain in their existing owners.

Boundary decision:

The Worker owns route-derived deployment identity. The execution protocol owns
the start request envelope. This checkpoint keeps that split explicit by moving
the route-derived merge into a named boundary parser without changing
ExecutionDO runtime ownership.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionDO.test.ts -t "execution start route boundary|decodes public execution start bodies before creating a session"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Artifact Runtime Malformed JSON Route Boundary

Previous completed checkpoint: `db496b5` Remove generic scheduler request forwarder.

What changed:

- `packages/flarex-backend/src/artifactRuntime/RouteBoundary.ts` now uses the
  shared backend `readJson(...)` helper for execution artifact runtime `/invoke`
  request bodies.
- Malformed JSON now maps to the same `Request body must be JSON.` response as
  other backend route boundaries.
- Invalid object payloads still map to
  `Invalid execution artifact invoke payload.`.
- Runtime authorization, artifact header checks, runtime-store source-package
  loading, materializer cache behavior, invoke response/error conversion, Worker
  routing, DeliveryDO, PartitionDO, executor-http, and `ValidatorJson` remain in
  their existing owners.

Boundary decision:

The artifact runtime service remains a backend runtime adapter, not shared
protocol. This checkpoint normalizes only the raw JSON read at that route
boundary. It does not move `ExecutionArtifactInvokePayload` into
`flarex-protocol`, replace the local payload guard with Effect Schema, or alter
materializer/cache ownership.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntimeRouteBoundary.test.ts packages/flarex-backend/test/artifactRuntime.test.ts -t "artifact runtime route boundary|rejects malformed or invalid runtime invoke payloads at the route boundary"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Public Scheduler Forwarding Helper Cleanup

Previous completed checkpoint: `71c187b` Move finish push JSON read into boundary.

What changed:

- Removed the unused `forwardLiveQuerySchedulerRequest(...)` helper from
  `packages/flarex-backend/src/worker.ts`.
- `worker.ts` no longer imports `readJson` directly.
- Public Worker scheduler request-body ownership now sits in
  `packages/flarex-backend/src/scheduler/PublicRouteBoundary.ts` and the shared
  scheduler route-boundary parser, not in a generic Worker forwarding helper.
- Public scheduler route paths, authorization ordering, parsed-body forwarding,
  SchedulerDO execution, delivery fanout, continuation behavior, deployment push
  routes, partition routes, delivery routes, executor-http routes, and
  `ValidatorJson` remain in their existing owners.

Boundary decision:

The Worker still owns public scheduler routing and authorization. The route
boundary modules own JSON decoding and request normalization. Removing the
generic raw request forwarder keeps that ownership visible and prevents future
public scheduler routes from bypassing the typed boundary by accident.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicSchedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "public scheduler route boundary|rejects malformed live query subscription trigger JSON|rejects malformed live query subscription rerun JSON|triggers stale live query reruns"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Public Deployment Finish Push Raw Body Boundary

Previous completed checkpoint: `6644926` Decode public scheduler trigger bodies.

What changed:

- `packages/flarex-backend/src/deployment/PublicPushRouteBoundary.ts` now owns
  the public Worker finish-push raw JSON read.
- `POST /deployments/:deploymentId/push/:pushId/finish` calls that boundary
  helper before running the existing stored artifact preflight.
- The Worker still parses the finish protocol request after the artifact
  preflight, preserving the current malformed JSON, missing-artifact, and
  invalid-envelope response ordering.
- `DeploymentService.finishPush`, DeploymentDO HTTP behavior, artifact
  reference computation, active-push activation semantics, source-only push
  analysis, start-analyzed, abandon, scheduler routes, partition routes,
  delivery routes, executor-http routes, and `ValidatorJson` remain in their
  existing owners.

Boundary decision:

The public finish-push route is a Worker transport boundary with one extra
preflight: durable artifact availability is checked before protocol validation
once the request body is valid JSON. This checkpoint moves JSON ownership out of
`worker.ts` while keeping that preflight and DeploymentDO activation ownership
unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts -t "public deployment push route boundary|rejects malformed finish request bodies|requires durable artifact storage before public finish when R2 is configured"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Public Scheduler Subscription Trigger Route Boundary

Previous completed checkpoint: `df60d8b` Decode public scheduler rerun bodies.

What changed:

- `packages/flarex-backend/src/scheduler/PublicRouteBoundary.ts` now also owns
  the public Worker subscription trigger scheduler request-body boundary.
- `POST /scheduler/live-query-subscriptions/trigger` decodes through the shared
  scheduler subscription rerun parser before the Worker forwards to
  `SchedulerDO`.
- The Worker forwards the parsed trigger request body, preserving the existing
  deployment id, optional project id, limit, deliveryLimit, and maxBatches fields
  while dropping ignored fields at the public edge.
- Authorization, SchedulerDO rerun execution, stale subscription scans,
  DeliveryDO wake fanout, continuation behavior, the
  `/scheduler/live-query-subscriptions/rerun` route, delivery reconcile,
  connection reconcile, dead-letter, cleanup routes, partition routes, delivery
  routes, executor-http routes, and `ValidatorJson` remain in their existing
  owners.

Boundary decision:

The public scheduler subscription trigger route is a Worker transport boundary.
This checkpoint validates and normalizes that request before forwarding, while
keeping SchedulerDO responsible for stale subscription scans, rerun execution,
delivery wake fanout, continuation, and response mapping. The trigger route
continues to forward into the same internal rerun scheduler path.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicSchedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "public scheduler route boundary|rejects malformed live query subscription trigger JSON|rejects unauthorized live query subscription trigger before parsing JSON|rejects invalid live query subscription trigger envelopes|triggers stale live query reruns"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Scheduler Subscription Rerun Route Boundary

Previous completed checkpoint: `c90500c` Decode public scheduler cleanup bodies.

What changed:

- `packages/flarex-backend/src/scheduler/PublicRouteBoundary.ts` now also owns
  the public Worker subscription rerun scheduler request-body boundary.
- `POST /scheduler/live-query-subscriptions/rerun` decodes through the shared
  scheduler route-boundary parser before the Worker forwards to `SchedulerDO`.
- The Worker forwards the parsed rerun request body, preserving the existing
  deployment id, optional project id, limit, deliveryLimit, and maxBatches fields
  while dropping ignored fields at the public edge.
- Authorization, SchedulerDO rerun execution, stale subscription scans,
  DeliveryDO wake fanout, continuation behavior, the
  `/scheduler/live-query-subscriptions/trigger` route, delivery reconcile,
  connection reconcile, dead-letter, cleanup routes, partition routes, delivery
  routes, executor-http routes, and `ValidatorJson` remain in their existing
  owners.

Boundary decision:

The public scheduler subscription rerun route is a Worker transport boundary.
This checkpoint validates and normalizes that request before forwarding, while
keeping SchedulerDO responsible for stale subscription scans, rerun execution,
delivery wake fanout, continuation, and response mapping. The trigger route
remains a separate public route boundary for a later checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicSchedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "public scheduler route boundary|rejects malformed live query subscription rerun JSON|rejects unauthorized live query subscription rerun before parsing JSON|rejects invalid live query subscription rerun envelopes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Scheduler Connection Cleanup Route Boundary

Previous completed checkpoint: `ca4fca6` Decode public scheduler dead-letter bodies.

What changed:

- `packages/flarex-backend/src/scheduler/PublicRouteBoundary.ts` now also owns
  the public Worker connection cleanup scheduler request-body boundary.
- `POST /scheduler/live-query-connections/cleanup` decodes through the shared
  scheduler route-boundary parser before the Worker forwards to `SchedulerDO`.
- The Worker forwards the parsed cleanup request body, preserving the existing
  deployment id, project id, and optional `expiredAt` fields while dropping
  ignored fields and applying the request-or-env `projectId` fallback at the
  public edge.
- Authorization, SchedulerDO cleanup execution, executor cleanup calls,
  delivery reconcile, connection reconcile, dead-letter, rerun routes,
  partition routes, delivery routes, executor-http routes, and `ValidatorJson`
  remain in their existing owners.

Boundary decision:

The public scheduler connection cleanup route is a Worker transport boundary.
This checkpoint validates and normalizes that request before forwarding, while
keeping SchedulerDO responsible for cleanup execution, executor calls, and
response mapping.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicSchedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "public scheduler route boundary|rejects malformed live query connection cleanup JSON|rejects unauthorized live query connection cleanup before parsing JSON|rejects invalid live query connection cleanup fields"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Scheduler Dead-Letter Route Boundary

Previous completed checkpoint: `abaec65` Decode public scheduler connection reconcile bodies.

What changed:

- `packages/flarex-backend/src/scheduler/PublicRouteBoundary.ts` now also owns
  the public Worker delivery dead-letter scheduler request-body boundary.
- `POST /scheduler/live-query-deliveries/dead-letter` decodes through the
  shared scheduler route-boundary parser before the Worker forwards to
  `SchedulerDO`.
- The Worker forwards the parsed dead-letter request body, preserving the
  existing deployment filter, cursor, limits, reason, and date fields while
  dropping ignored fields and applying defaults at the public edge.
- Authorization, SchedulerDO dead-letter execution, reconnect fanout, executor
  dead-letter scans, delivery reconcile, connection reconcile, rerun, cleanup
  routes, partition routes, delivery routes, executor-http routes, and
  `ValidatorJson` remain in their existing owners.

Boundary decision:

The public scheduler dead-letter route is a Worker transport boundary. This
checkpoint validates and normalizes that request before forwarding, while
keeping SchedulerDO responsible for dead-letter scanning, reconnect fanout,
pagination, and result aggregation.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicSchedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "public scheduler route boundary|rejects malformed live query dead-letter JSON|rejects unauthorized live query dead-letter before parsing JSON|rejects invalid live query dead-letter envelopes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Scheduler Connection Reconcile Route Boundary

Previous completed checkpoint: `64a086a` Decode public scheduler delivery reconcile bodies.

What changed:

- `packages/flarex-backend/src/scheduler/PublicRouteBoundary.ts` now also owns
  the public Worker connection reconcile scheduler request-body boundary.
- `POST /scheduler/live-query-connections/reconcile` decodes through the shared
  scheduler route-boundary parser before the Worker forwards to `SchedulerDO`.
- The Worker forwards the parsed connection reconcile request body, preserving
  the existing `expiredAt`, `limit`, and cursor envelope while dropping ignored
  fields at the public edge.
- Authorization, SchedulerDO connection cleanup reconcile execution,
  continuation/coalescing, executor expired-connection scans, cleanup fanout,
  delivery reconcile, dead-letter, rerun, cleanup routes, partition routes,
  delivery routes, executor-http routes, and `ValidatorJson` remain in their
  existing owners.

Boundary decision:

The public scheduler connection reconcile route is a Worker transport boundary.
This checkpoint validates and normalizes that request before forwarding, while
keeping SchedulerDO responsible for cleanup reconcile state, coalescing,
continuation, and executor cleanup orchestration.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicSchedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "public scheduler route boundary|rejects unauthorized live query connection reconcile before parsing JSON|rejects invalid live query connection reconcile envelopes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Scheduler Delivery Reconcile Route Boundary

Previous completed checkpoint: `4211274` Decode public partition schema-cache bodies.

What changed:

- `packages/flarex-backend/src/scheduler/PublicRouteBoundary.ts` now owns the
  public Worker delivery reconcile scheduler request-body boundary.
- `POST /scheduler/live-query-deliveries/reconcile` decodes through the shared
  scheduler route-boundary parser before the Worker forwards to `SchedulerDO`.
- The Worker forwards the parsed delivery reconcile request body, preserving the
  existing `limit`, `deliveryLimit`, `maxBatches`, and cursor envelope while
  dropping ignored fields at the public edge.
- Authorization, SchedulerDO delivery reconcile execution,
  continuation/coalescing, DeliveryDO wake fanout, executor pending-deployment
  scans, connection cleanup, dead-letter, rerun, cleanup routes, partition
  routes, delivery routes, executor-http routes, and `ValidatorJson` remain in
  their existing owners.

Boundary decision:

The public scheduler delivery reconcile route is a Worker transport boundary.
This checkpoint validates and normalizes that request before forwarding, while
keeping SchedulerDO responsible for reconcile state, coalescing, continuation,
and delivery wake orchestration.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicSchedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "public scheduler route boundary|rejects malformed live query delivery reconcile JSON|rejects unauthorized live query delivery reconcile before parsing JSON|rejects invalid live query delivery reconcile envelopes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Partition Schema Cache Route Boundary

Previous completed checkpoint: `c930cf0` Decode public delivery wake bodies.

What changed:

- `packages/flarex-backend/src/partition/PublicSchemaCacheRouteBoundary.ts`
  now owns the public Worker partition schema-cache request-body boundary.
- `PUT /deployments/:deploymentId/partitions/:partitionKey/schema-cache`
  decodes through the shared `readJson` boundary before the Worker forwards to
  `PartitionDO`.
- The boundary appends the route partition key, keeps it authoritative over any
  request-body field, and reuses the existing partition schema-cache parser for
  object-envelope validation.
- Schema semantic validation, table/index persistence, schema-version metadata
  writes, transaction ownership, commit/OCC behavior, subscription routes,
  document/index reads, scheduler routes, delivery routes, executor-http routes,
  and `ValidatorJson` remain in their existing owners.

Boundary decision:

The public schema-cache route is a Worker transport boundary. This checkpoint
validates the public envelope and route partition key before forwarding, while
keeping schema validation, persistence, and transaction-facing state inside
`PartitionDO`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts -t "public partition schema-cache route boundary|rejects malformed public partition schema-cache JSON|rejects non-object public partition schema-cache JSON"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Delivery Wake Route Boundary

Previous completed checkpoint: `c1c104d` Decode public live query delivery bodies.

What changed:

- `packages/flarex-backend/src/delivery/PublicWakeRouteBoundary.ts` now owns
  the public Worker `wake-delivery` request-body boundary.
- `POST /deployments/:deploymentId/sync/wake-delivery` decodes through the
  shared `readJson` boundary before the Worker forwards to `DeliveryDO`.
- The boundary appends the route deployment id, keeps it authoritative over
  any request-body `deploymentId`, and reuses the existing `DeliveryDO` wake
  parser for the optional drain controls.
- Authorization, `DeliveryDO` wake/drain behavior, claim/fanout/ack semantics,
  scheduler routes, live-query delivery fanout, partition routes,
  executor-http routes, and `ValidatorJson` remain in their existing owners.

Boundary decision:

The public wake callback is a Worker transport boundary, but delivery draining
is Durable Object behavior. This checkpoint validates the forwarded wake
request at the public edge without moving claim, fanout, acknowledgement, retry,
or pending-drain state logic out of `DeliveryDO`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeliveryWakeRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "public delivery wake route boundary|rejects malformed public DeliveryDO wake JSON|rejects invalid public DeliveryDO wake envelopes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Live Query Delivery Route Boundary

Previous completed checkpoint: `ac853a0` Decode partition commit bodies.

What changed:

- `packages/flarex-backend/src/liveQueryDelivery/RouteBoundary.ts` now owns the
  public Worker live-query delivery request-body boundary.
- `POST /deployments/:deploymentId/sync/deliver-live-query` decodes through the
  shared `readJson` boundary before `deliverLiveQueryChangesToConnections(...)`
  groups deliveries and calls `ConnectionDO`.
- The boundary extracts only the existing delivery transport envelope and keeps
  the existing delivery parser messages.
- Authorization, deployment scoping, fanout, `ConnectionDO` delivery behavior,
  skip accounting, `DeliveryDO`, scheduler routes, partition routes,
  executor-http routes, and `ValidatorJson` remain in their existing owners.

Boundary decision:

The public Worker delivery callback is a transport boundary, but delivery
fanout remains backend runtime behavior. This checkpoint gives the route a
named decoder without moving connection fanout or Durable Object state logic.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicLiveQueryDeliveryRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "public live query delivery route boundary|rejects malformed public live query delivery JSON|rejects invalid public live query delivery envelopes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Partition Commit Route Boundary

Previous completed checkpoint: `a9d1e67` Decode partition subscription bodies.

What changed:

- `packages/flarex-backend/src/partition/RouteBoundary.ts` now owns the
  `PartitionDO` commit request-body boundary.
- `POST /commit` decodes through the shared `readJson` boundary at both the
  public Worker partition forwarding edge and the Durable Object edge.
- The boundary extracts only the commit request envelope: required integer
  `beginTs`, optional integer `schemaVersion`, optional string `source`,
  optional string `idempotencyKey`, optional object `readSet` with
  document/table/index read arrays, and required `writes` array with integer
  `tableId`, optional non-empty `id`, and JSON `value`.
- Idempotency lookup, schema-version mismatch behavior, generated IDs for
  missing write IDs, write validation, table/placement/schema checks,
  transaction ownership, OCC conflict detection, write-log persistence,
  invalidation notification, document/index reads, schema-cache, subscription
  routes, and `ValidatorJson` remain in their existing owners.

Boundary decision:

Partition commit is the correctness-sensitive shard write path. This checkpoint
narrows the HTTP transport edge without moving commit execution, OCC conflict
detection, SQL writes, or invalidation behavior out of `PartitionDO`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts -t "partition route boundary|rejects malformed partition commit JSON|rejects invalid public partition commit envelopes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Partition Subscription Route Boundary

Previous completed checkpoint: `afe8390` Decode partition schema-cache bodies.

What changed:

- `packages/flarex-backend/src/partition/RouteBoundary.ts` now owns the
  `PartitionDO` subscription request-body boundaries.
- `POST /subscriptions/register`, `POST /subscriptions/unregister`, and
  `POST /subscriptions/unregister-connection` decode through the shared
  `readJson` boundary.
- The boundary extracts only the subscription request envelopes:
  registration requires non-empty `connectionName`, integer `queryId`, and
  object `readSet`; unregister requires non-empty `connectionName` and integer
  `queryId`; unregister-connection requires non-empty `connectionName`.
- Subscription SQL insert/delete ownership, invalidation scanning, commit/OCC
  behavior, schema-cache, document/index reads, ConnectionDO callers, Worker
  forwarding, and `ValidatorJson` remain unchanged.

Boundary decision:

Partition subscription routes cross an HTTP/JSON boundary before mutating
`sync_subscriptions`. Moving the request parsers into a backend route-boundary
helper narrows the transport edge while keeping subscription state ownership
and invalidation behavior inside `PartitionDO`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts -t "partition route boundary|rejects malformed partition subscription registration JSON|rejects invalid partition subscription unregister-connection envelopes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Partition Schema Cache Route Boundary

Previous completed checkpoint: `8de16fb` Decode scheduler cleanup bodies.

What changed:

- `packages/flarex-backend/src/partition/RouteBoundary.ts` now owns the
  `PartitionDO` schema-cache request-body boundary.
- `PUT /schema-cache` decodes through the shared `readJson` boundary and
  accepts JSON object envelopes, preserving both wrapped `{ partitionKey,
  schema }` bodies and legacy flat `{ partitionKey, version, tables, indexes }`
  bodies.
- The boundary extracts only the transport envelope and leaves schema semantic
  validation, partition-key checks, table/index persistence, transaction
  ownership, and schema-version metadata writes in `PartitionDO`.
- Commit/OCC behavior, subscription routes, document/index reads, Worker
  forwarding, and `ValidatorJson` remain unchanged.

Boundary decision:

Partition schema-cache crosses an HTTP/JSON boundary before it enters
PartitionDO's schema metadata update path. Decoding that envelope in a small
backend helper narrows the route edge without pulling correctness-sensitive
commit or SQL behavior out of the Durable Object.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts -t "partition route boundary|rejects malformed partition schema-cache JSON"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Scheduler Connection Cleanup Route Boundary

Previous completed checkpoint: `6634f8f` Decode scheduler dead-letter bodies.

What changed:

- `packages/flarex-backend/src/scheduler/RouteBoundary.ts` now owns the
  live-query connection cleanup request-body boundary.
- `POST /cleanup/live-query-connections` decodes through the shared `readJson`
  boundary and accepts required non-empty `deploymentId`, `projectId` from
  request or configured environment fallback, and optional ISO `expiredAt`;
  extra fields remain ignored.
- The boundary extracts only the cleanup request envelope and leaves executor
  cleanup calls and response validation in `SchedulerDO`.
- Other SchedulerDO route execution and continuation behavior remains in place.

Boundary decision:

Scheduler connection cleanup crosses an HTTP/JSON boundary before it enters
executor maintenance. Decoding the request at the route edge makes the
transport contract explicit without moving SchedulerDO's cleanup workflow or
mixing executor-side cleanup behavior into the route parser.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "scheduler route boundary|rejects malformed live query connection cleanup JSON|rejects invalid live query connection cleanup fields"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Scheduler Dead Letter Delivery Route Boundary

Previous completed checkpoint: `e75622d` Decode scheduler rerun bodies.

What changed:

- `packages/flarex-backend/src/scheduler/RouteBoundary.ts` now owns the
  live-query delivery dead-letter request-body boundary.
- `POST /dead-letter/live-query-deliveries` decodes through the shared
  `readJson` boundary and accepts optional non-empty `deploymentId`, optional
  ISO `olderThan`, optional positive integer `stuckAfterMs` only when
  `olderThan` is absent, optional positive integer `minAttempts`, `limit`, and
  `maxBatches`, optional passthrough `cursor`, optional non-empty `reason`, and
  optional ISO `deadLetteredAt`; extra fields remain ignored.
- The boundary extracts only the dead-letter request envelope and leaves
  executor dead-letter scans, force-reconnect fanout, pagination, and result
  aggregation in `SchedulerDO`.
- Other SchedulerDO routes remain on their existing parsers for later slices.

Boundary decision:

Scheduler dead-letter delivery crosses an HTTP/JSON boundary before it enters
executor maintenance and connection reconnect behavior. Decoding the request at
the route edge makes that transport contract explicit without moving
SchedulerDO's operational dead-letter workflow.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "scheduler route boundary|rejects malformed live query dead-letter JSON"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Scheduler Live Query Rerun Route Boundary

Previous completed checkpoint: `4864cd5` Decode scheduler connection reconcile
bodies.

What changed:

- `packages/flarex-backend/src/scheduler/RouteBoundary.ts` now owns the
  live-query subscription rerun request-body boundary.
- `POST /rerun/live-query-subscriptions` decodes through the shared `readJson`
  boundary and accepts required non-empty `deploymentId`, optional non-empty
  `projectId`, and optional positive integer `limit`, `deliveryLimit`, and
  `maxBatches`; extra fields remain ignored.
- The boundary extracts only the rerun request envelope and leaves pending
  rerun construction, executor rerun calls, delivery wake fanout, in-flight
  coalescing, retry scheduling, and persistence in `SchedulerDO`.
- Other SchedulerDO routes remain on their existing parsers for later slices.

Boundary decision:

Scheduler live-query rerun crosses an HTTP/JSON boundary before it enters
durable rerun state and executor/delivery fanout behavior. Decoding the request
at the route edge makes that transport contract explicit without moving
SchedulerDO's rerun state machine or mixing it with executor-side subscription
evaluation.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "scheduler route boundary|rejects malformed live query subscription rerun JSON"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Scheduler Connection Cleanup Reconcile Route Boundary

Previous completed checkpoint: `46d1782` Decode scheduler delivery reconcile
bodies.

What changed:

- `packages/flarex-backend/src/scheduler/RouteBoundary.ts` now owns the
  live-query connection cleanup reconcile request-body boundary.
- `POST /reconcile/live-query-connections` decodes through the shared
  `readJson` boundary and accepts optional ISO `expiredAt`, optional positive
  integer `limit`, and an optional cursor with ISO `oldestExpiredAt` and
  non-empty `deploymentId`; extra fields remain ignored.
- The boundary extracts only the cleanup reconcile request envelope and leaves
  durable cleanup continuation, fresh-request coalescing, retry scheduling, and
  persistence in `SchedulerDO`.
- Other SchedulerDO routes remain on their existing parsers for later slices.

Boundary decision:

Scheduler connection cleanup reconcile crosses an HTTP/JSON boundary before it
enters durable cleanup state and continuation behavior. Decoding the request at
the route edge makes that transport contract explicit without moving the
scheduler's cleanup state machine or mixing it with executor-side deployment
scan behavior.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "scheduler route boundary|rejects malformed live query connection cleanup reconcile JSON|rejects malformed live query connection cleanup reconcile cursors"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Scheduler Delivery Reconcile Route Boundary

Previous completed checkpoint: `28a783e` Decode artifact runtime invoke bodies.

What changed:

- `packages/flarex-backend/src/scheduler/RouteBoundary.ts` now owns the
  live-query delivery reconcile request-body boundary.
- The boundary extracts only the delivery reconcile request envelope and leaves
  durable continuation state, keyed in-flight coalescing, wake fanout, retry
  scheduling, and persistence in `SchedulerDO`.
- Other SchedulerDO routes remain on their existing parsers for later slices.

Boundary decision:

Scheduler delivery reconcile crosses an HTTP/JSON boundary before it enters
stateful Durable Object scheduling behavior. Decoding the request at the route
edge makes that transport contract explicit without moving the scheduler's
durable state machine or mixing it with delivery drain execution.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "scheduler route boundary|rejects malformed live query delivery reconcile JSON|rejects malformed live query delivery deployment scan cursors"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Artifact Runtime Invoke Route Boundary

Previous completed checkpoint: `c6bb370` Decode delivery wake bodies.

What changed:

- `packages/flarex-backend/src/artifactRuntime/RouteBoundary.ts` now owns the
  execution artifact runtime invoke request-body boundary.
- The boundary parses the existing backend `ExecutionArtifactInvokePayload`
  shape and preserves the runtime service's invalid-payload error envelope for
  both malformed JSON and invalid object shapes.
- `artifactRuntime.ts` still owns runtime authorization, artifact header
  checks, runtime-store source-package loading, materializer cache behavior,
  and invoke response/error conversion.

Boundary decision:

The artifact runtime service is a runtime adapter, not shared protocol. Its
body parser should be explicit and testable, but this slice should not move the
payload into `flarex-protocol` or alter materializer/cache ownership. A future
protocol slice can replace the local guard with an Effect Schema contract when
the artifact invocation DTO is stable enough to share.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntimeRouteBoundary.test.ts packages/flarex-backend/test/artifactRuntime.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Delivery Wake Route Boundary

Previous completed checkpoint: `2c7f8c6` Decode connection invalidation bodies.

What changed:

- `packages/flarex-backend/src/delivery/RouteBoundary.ts` now owns the
  `DeliveryDO` wake request-body boundary.
- The boundary extracts a required `deploymentId` and optional positive
  integer delivery limits, ignoring extra compatibility fields.
- `DeliveryDO` still owns route matching, drain coalescing, defaults,
  claim-owner creation, persisted continuation state, delivery fanout, acking,
  and structured delivery failure summaries.

Boundary decision:

`DeliveryDO /wake` is an internal route, but it crosses an HTTP/JSON boundary
from Worker and SchedulerDO callers into delivery drain state. The route should
decode the wake envelope before starting drain work, while claim/fanout/ack
failures should continue through the existing delivery failure summary path
rather than the decode error response path.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deliveryRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "delivery route boundary|rejects malformed DeliveryDO wake JSON|rejects invalid DeliveryDO wake envelopes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Connection Invalidation Route Boundary

Previous completed checkpoint: `025481f` Decode connection delivery bodies.

What changed:

- `packages/flarex-backend/src/connection/RouteBoundary.ts` now owns the
  `ConnectionDO` invalidation request-body boundary.
- The boundary accepts the current invalidation envelope shape by extracting an
  integer `queryId` and ignoring extra compatibility fields such as
  `invalidatedTs`.
- `ConnectionDO` still owns route matching, active query state, rerun
  coalescing, subscription refills, and WebSocket transition emission.

Boundary decision:

`ConnectionDO /invalidate` is internal, but it crosses an HTTP/JSON boundary
from partition notification code into mutable connection state. The route
should decode the transport envelope before invoking rerun orchestration, while
runtime rerun failures should keep their existing behavior and not be folded
into the decode error response path.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/connectionRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "connection route boundary|rejects malformed invalidation JSON|rejects invalid invalidation envelopes"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Connection Live Query Delivery Route Boundary

Previous completed checkpoint: `94e9d0c` Decode public execution action bodies.

What changed:

- `packages/flarex-backend/src/connection/RouteBoundary.ts` now owns the
  `ConnectionDO` live-query delivery request-body boundary.
- The boundary delegates delivery-envelope validation to the existing
  `liveQueryDeliveryChangesFromBody(...)` parser and maps invalid delivery
  requests to the shared `HttpError(400, ...)` response path.
- `ConnectionDO` still owns route matching, live WebSocket state, delivery
  skip reasons, and transition emission.

Boundary decision:

`ConnectionDO /deliver/live-query` is an internal fanout endpoint, but it is
still a transport boundary. Body reads should be centralized in a route helper
before delivery arrays reach mutable connection state. The existing
live-query delivery parser remains the single shape checker for this slice
until a future protocol package contract replaces it.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/connectionRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "connection route boundary|rejects malformed live query delivery JSON"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Execution Action Route Boundary

Previous completed checkpoint: `f21421f` Document execution abort boundary.

What changed:

- `packages/flarex-backend/src/execution/ActionRouteBoundary.ts` now owns the
  public Worker's execution action forwarding body read.
- The helper delegates `syscall` and `finish` to the existing backend
  execution route-boundary parsers, keeping protocol parsing and backend JSON
  adaptation in one execution boundary package area.
- The helper keeps `abort` as well-formed JSON forwarding only, matching the
  bodyless Durable Object action decision.
- `worker.ts` still owns public route matching, session id routing, and
  Durable Object dispatch.

Boundary decision:

The public Worker should no longer use a generic JSON read for execution
actions that already have protocol-backed route-boundary parsers. It should
delegate to the execution boundary helper, while `ExecutionDO` remains the
owner of session and transaction behavior.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/executionDO.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Execution Abort Bodyless Boundary

Previous completed checkpoint: `7316794` Decode execution finish bodies.

What changed:

- Recorded execution abort as a bodyless Durable Object action rather than a
  protocol-owned request body.
- The public Worker still accepts the generated runtime's `{}` JSON envelope
  before forwarding to `ExecutionDO`; extra well-formed JSON is ignored by the
  bodyless action, and malformed JSON remains a Worker compatibility error.
- `flarex-protocol/execution` remains focused on execution bodies with domain
  data: start, syscall, and finish.

Boundary decision:

The backend route layer owns the public JSON forwarding compatibility for
abort. `ExecutionDO` owns the cancellation side effect and should not receive a
protocol DTO for a body it ignores. A future change can introduce an abort
request schema only if abort starts enforcing body fields such as reason,
actor, or idempotency metadata.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Execution Finish Backend Route Boundary

Previous completed checkpoint: `e77e2eb` Add execution finish protocol body.

What changed:

- `packages/flarex-backend/src/execution/FinishRouteBoundary.ts` owns
  Durable Object finish JSON reading, protocol parsing,
  protocol-error-to-HTTP mapping, and protocol JSON to backend JSON adaptation.
- `ExecutionDO` still owns route matching, session state, return validation,
  transaction completion, and cleanup.
- `flarex-protocol/execution` remains transport-contract-only.

Boundary decision:

The protocol package validates the finish body shape. The backend route
boundary adapts that shape to mutable runtime types and compatibility errors.
`ExecutionDO.finish(...)` should continue to receive backend-native request
types and own return validation, commit behavior, and cleanup.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts packages/flarex-backend/test/executionDO.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Execution Finish Protocol Package Boundary

Previous completed checkpoint: `652936f` Decode execution syscall bodies.

What changed:

- `flarex-protocol/execution` now owns the execution finish request schema and
  parser for the `{ value }` body currently accepted by `ExecutionDO.finish`.
- The schema validates the returned value as strict transport JSON without
  importing backend validator or transaction types.
- The protocol package remains transport-contract-only; backend Worker,
  Durable Object, transaction, return validation, and commit code are
  unchanged.

Boundary decision:

The protocol package should describe the finish body before backend code adapts
it to runtime validation and commit behavior. The backend should continue to
own return validator checks, query read-set response construction, mutation
commit behavior, and session cleanup.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
node ./node_modules/vitest/vitest.mjs run packages/flarex-protocol/test/execution.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Execution Syscall Backend Route Boundary

Previous completed checkpoint: `f766101` Add execution syscall protocol bodies.

What changed:

- `packages/flarex-backend/src/execution/SyscallRouteBoundary.ts` owns
  Durable Object syscall JSON reading, protocol parsing,
  protocol-error-to-HTTP mapping, and protocol JSON to backend JSON adaptation.
- `packages/flarex-backend/src/execution/JsonRouteBoundary.ts` centralizes
  the JSON adapter shared by execution start and syscall boundaries.
- `ExecutionDO` still owns route matching, session state, and transaction
  orchestration; `flarex-protocol/execution` remains transport-contract-only.

Boundary decision:

The protocol package validates the syscall body shape. The backend route
boundary adapts that shape to mutable runtime types and compatibility errors.
`ExecutionDO.syscall(...)` should continue to receive backend-native request
types and own session/transaction semantics.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionSyscallRouteBoundary.test.ts packages/flarex-backend/test/executionDO.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Execution Syscall Protocol Package Boundary

Previous completed checkpoint: `7f6ec53` Decode execution start bodies.

What changed:

- `flarex-protocol/execution` now owns the execution syscall request union and
  parser for the operation bodies currently accepted by `ExecutionDO.syscall`.
- The schema validates query selectors, optional paging/order fields, mutation
  JSON payloads, and JSON-record patch payloads without importing backend
  transaction types.
- The protocol package remains transport-contract-only; backend Worker,
  Durable Object, transaction, and PartitionDO code are unchanged.

Boundary decision:

The protocol package should describe syscall request bodies before the backend
adapts them into runtime transaction calls. The backend should continue to own
session lookup, transaction state, Durable Object lifecycle, and compatibility
HTTP errors when the parser is wired later.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
node ./node_modules/vitest/vitest.mjs run packages/flarex-protocol/test/execution.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Execution Start Backend Route Boundary

Previous completed checkpoint: `d8b82fc` Add execution start protocol body.

What changed:

- `packages/flarex-backend/src/execution/StartRouteBoundary.ts` owns backend
  JSON reading, protocol parsing, protocol-error-to-HTTP mapping, route
  deployment id injection, and protocol JSON to backend JSON adaptation for
  execution start requests.
- `worker.ts` still owns public route matching and session id allocation.
- `ExecutionDO` still owns session lifecycle and transaction orchestration.
- `flarex-protocol/execution` remains transport-contract-only.

Boundary decision:

The protocol package validates the shared start-body shape. The backend route
boundary adapts that shape to the backend runtime types and compatibility
rules. This keeps readonly protocol JSON from leaking into mutable backend
runtime APIs.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionDO.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Execution Start Protocol Package Boundary

Previous completed checkpoint: `67689e2` Decode public invoke bodies.

What changed:

- `flarex-protocol/execution` now owns the execution-session start request
  schema and parser.
- `flarex-protocol/json` exposes `JsonValue`, a shared strict JSON transport
  schema, so invoke and execution contracts validate the same JSON subset.
- The package export map exposes `./execution` for future backend boundary
  wiring.
- Backend Worker routing and `ExecutionDO` still own session behavior and HTTP
  compatibility.

Boundary decision:

The protocol package should describe execution-session transport bodies before
backend code adapts public Worker requests into Durable Object requests. The
backend package should continue to own malformed JSON handling, route-scoped
deployment id injection, and session lifecycle behavior.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
node ./node_modules/vitest/vitest.mjs run packages/flarex-protocol/test/execution.test.ts packages/flarex-protocol/test/invoke.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Invoke Worker Route Boundary

Previous completed checkpoint: `95cc914` Add public invoke protocol body.

What changed:

- `packages/flarex-backend/src/invoke/PublicInvokeRouteBoundary.ts` now owns
  Worker-edge public invoke JSON reading and protocol parser adaptation.
- `worker.ts` delegates both public invoke body reads to that helper while
  keeping deployment id resolution and invoke execution orchestration local.
- `flarex-protocol/invoke` remains the shared transport contract; backend code
  only adapts protocol failures into backend HTTP errors.

Boundary decision:

The protocol package owns the request shape. The backend package owns public
Worker compatibility: malformed JSON handling, `{ error }` envelopes, route
deployment resolution, and `args ?? null` runtime defaulting.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/artifactRuntimeRoute.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Invoke Protocol Package Boundary

Previous completed checkpoint: `be053f6` Decode public source push bodies.

What changed:

- `flarex-protocol/invoke` now owns the public invoke request body schema and
  parser.
- The package export map exposes `./invoke` for future backend and generated
  runtime consumers.
- Backend Worker routing still owns request reading, deployment lookup,
  artifact execution, session behavior, and response mapping.

Boundary decision:

The protocol package should describe the public transport body before backend
code adapts that body to runtime defaults such as `args ?? null`. Keeping this
slice protocol-only avoids coupling shared schema introduction to the live
Worker invoke path.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
node ./node_modules/vitest/vitest.mjs run packages/flarex-protocol/test/invoke.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Source-Only Push Protocol Boundary

Previous completed checkpoint: `65dd151` Decode public deployment push bodies.

What changed:

- `flarex-protocol/deployment` now owns the source-only `StartPushRequest`
  schema and parser.
- `packages/flarex-backend/src/deployment/PublicPushRouteBoundary.ts` adapts
  the protocol-decoded source package back into the backend's existing mutable
  `StartPushRequest` shape for analyzer code.
- `worker.ts` still owns the analyzer configuration branch, analyzer service
  call, artifact persistence, and Durable Object forwarding.

Boundary decision:

The protocol package should describe the public transport body, but it should
not force readonly schema-class DTOs through backend analyzer code that already
uses mutable local request types. The public boundary is the right place to
decode and adapt between those shapes.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts packages/flarex-protocol/test/deployment.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Public Deployment Push Protocol Boundary

Previous completed checkpoint: `e81a139` Route registry through HttpApi.

What changed:

- `packages/flarex-backend/src/deployment/PublicPushRouteBoundary.ts` owns
  public Worker body decoding for deployment push mutation forwarding.
- The helper uses `flarex-protocol/deployment` parsers for `start-analyzed`,
  `finish`, and `abandon` bodies, keeping the schema contract in the protocol
  package and the Worker forwarding policy in the backend package.
- `worker.ts` still owns public route matching, analyzer integration, artifact
  preflight, and Durable Object stub forwarding.
- DeploymentDO still owns its generated internal HttpApi handler and per-object
  runtime layer.

Boundary decision:

The public Worker should not cast request JSON to deployment body types before
forwarding. It should decode at the public edge with protocol parsers, then let
DeploymentDO repeat its internal compatibility parse as the object-local trust
boundary.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts packages/flarex-protocol/test/deployment.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Registry Durable Object HttpApi Host

Previous completed checkpoint: `14930c4` Extract deployment HttpApi route
boundary.

What changed:

- `flarex-protocol/registry` remains the shared schema-first contract for the
  RegistryDO route paths and request/response bodies.
- `packages/flarex-backend/src/registry/HttpApiWebHandler.ts` now composes that
  protocol contract with backend handlers and the object-local registry layer.
- `RegistryDO` owns the per-instance generated web handler and delegates current
  RegistryApi routes to it after a backend compatibility boundary accepts the
  route and normalizes create-deployment JSON.
- `RegistryDO` still owns Durable Object lifecycle concerns: SQL schema
  initialization, fallback route responses, and object-local layer construction.

Boundary decision:

The generated handler belongs in `flarex-backend`, not `flarex-protocol`,
because it needs backend services and object-local SQL state. The protocol
package stays transport-contract-only.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryHttpApiRouteBoundary.test.ts packages/flarex-backend/test/registryHttpApiHandlers.test.ts packages/flarex-backend/test/registryDO.test.ts packages/flarex-protocol/test/registry.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Route Bridge Boundary

Previous completed checkpoint: `31971a4` Inline deployment start push route
bridge.

What changed:

- Removed the remaining thin private deployment route bridge methods from
  `DeploymentDO`.
- The active deployment, push status, finish-push, and abandon-push route
  branches now call `runDeployment` directly.
- Kept `DeploymentService`, `deployment/Validation.ts`, `DeploymentPushStore`,
  and `flarex-protocol` unchanged.

Why it changed:

The meaningful package boundaries are now the HTTP route, the `runDeployment`
runtime bridge, and the deployment service/store modules. The removed methods
no longer represented separate ownership.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- This is not a protocol, SDK, service, or store move. It only removes
  backend-local method hops.

Known limitations:

- Direct service calls in `DeploymentDO.fetch()` may be revisited after the
  deep protocol-decoding decision.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Start Push Route Bridge Boundary

Previous completed checkpoint: `c053c93` Extract deployment start push input
validation.

What changed:

- Removed the thin private `DeploymentDO.startPush` route bridge.
- The `POST /push/start-analyzed` branch now directly adapts the parsed body
  and calls `DeploymentDO.runDeployment`.
- Kept `DeploymentService` and `deployment/Validation.ts` ownership unchanged.
- Kept `flarex-protocol` unchanged.

Why it changed:

With start-push validation externalized, the extra method no longer owned a
meaningful package boundary. The fetch branch remains the HTTP boundary, and
`runDeployment` remains the runtime boundary.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- This is not a protocol or SDK move. It only removes a backend-local method
  hop.

Known limitations:

- Other deployment branches still use private methods for the service bridge.
- A later slice can decide whether those should stay for readability.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Start Push Validation Boundary

Previous completed checkpoint: `5e74840` Move deployment metadata access into
store.

What changed:

- Moved analyzed start-push backend request normalization into
  `deployment/Validation.ts`.
- Reused the validation module for source package, diagnostics, analysis, and
  codegen normalization before calling `DeploymentService.startAnalyzedPush`.
- Kept `DeploymentDO` as the HTTP route and Effect runtime boundary.
- Kept `flarex-protocol` as the wrapper schema package; no shared protocol
  contract changed.

Why it changed:

Backend deployment validation now owns the pure request-to-service input
adapter. That keeps package boundaries narrow: protocol parses the wrapper,
backend validation normalizes service input, and the service/store layer owns
runtime orchestration.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- This is not an SDK or protocol move. It is backend-local validation that
  preserves existing HTTP messages.

Known limitations:

- Deep `analysis` and `codegenAnalysis` payloads are still decoded by backend
  validation rather than by `flarex-protocol`.
- A later slice can decide whether that should change.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Store Metadata Boundary

Previous completed checkpoint: `2d6c9c4` Move deployment schema application
into store.

What changed:

- Moved active deployment metadata reads and writes into
  `DeploymentPushStore`.
- Removed metadata callbacks from the deployment layer constructor surface.
- Kept `DeploymentDO` as the owner of the SQL handle, route/runtime boundary,
  table creation, migrations, and initial `schema_version` bootstrap.
- Updated direct store tests to model the `meta` table in fake SQL.

Why it changed:

Deployment activation metadata is part of the store-owned activation/read
boundary. Keeping it in the store narrows the Durable Object surface to hosting
and schema lifecycle work.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- This does not introduce a global repository abstraction. Metadata reads and
  writes still execute against the current Durable Object SQLite handle.

Known limitations:

- `DeploymentDO` still creates and migrates the deployment tables.
- A later slice can evaluate remaining request validation and protocol
  boundary placement.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Store Activation Write Boundary

Previous completed checkpoint: `e739957` Move deployment push reads into
store.

What changed:

- Moved schema table/index writes and function metadata writes into
  `DeploymentPushStore`.
- Removed schema/function application callbacks from the deployment layer
  constructor surface.
- Kept `DeploymentDO` as the owner of the SQL handle, route/runtime boundary,
  and deployment metadata callbacks.
- Updated direct store tests to prove store-owned activation application still
  preserves `HttpError` passthrough.

Why it changed:

The store should own the storage operations that activate a deployment push.
This reduces callback surface while keeping route behavior and service
orchestration unchanged.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- This does not introduce a global repository abstraction. Activation writes
  still execute against the current Durable Object SQLite handle.

Known limitations:

- Metadata access remains callback-based for this slice.
- A later slice can evaluate whether metadata helpers should move into the
  store.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Store Push Read Boundary

Previous completed checkpoint: `ce58f78` Extract deployment push row
normalization.

What changed:

- Moved push-row SQL reads into `DeploymentPushStore`.
- Removed `readPush` from the deployment layer constructor surface.
- Kept `DeploymentDO` as the owner of the SQL handle and route/runtime
  boundary.
- Updated direct store tests to use fake SQL instead of a push-read callback.

Why it changed:

The store should own storage operations that produce deployment push state.
With row normalization already extracted, the store can read and normalize
push rows directly while preserving typed `DeploymentSqlError` mapping.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- This is not a global repository abstraction. Reads still happen against the
  per-Durable Object SQLite handle.

Known limitations:

- Schema/function application and metadata access are still callback-based.
- A later slice can evaluate those callbacks separately.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Push Row Normalization Boundary

Previous completed checkpoint: `a5ff90c` Extract analyzed push adapter.

What changed:

- Added `DeploymentPushStatusRow` and `pushStatusFromRow` to
  `packages/flarex-backend/src/deployment/Validation.ts`.
- Moved generated codegen fallback construction into the validation module.
- Kept SQL row lookup in `DeploymentDO`.
- Added direct tests for the moved read-normalization helpers.

Why it changed:

The deployment validation module now owns backend request validation and
deployment metadata validation. Stored push row normalization is pure
conversion at the same boundary, while SQL access remains a Durable
Object/store concern.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- The validation module is backend-local. It does not become a protocol or SDK
  contract.

Known limitations:

- `DeploymentPushStore` still depends on a `readPush` callback supplied by
  `DeploymentDO`.
- The next store-boundary slice can decide whether that callback should move
  behind the store directly.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Start Push Adapter Boundary

Previous completed checkpoint: `2e5f3dd` Extract deployment analysis
validators.

What changed:

- Moved the analyzed start-push protocol-to-backend adapter into
  `packages/flarex-backend/src/deployment/Validation.ts`.
- Kept `DeploymentDO.fetch()` responsible for HTTP routing and
  `parseAnalyzedStartPushRequest` protocol parsing.
- Added direct tests for adapter success/failure normalization.

Why it changed:

The adapter belongs with backend deployment validation because it normalizes
protocol wrapper output into the backend `AnalyzedStartPushRequest` shape. The
Durable Object should call the adapter, not own its field-level normalization.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- The adapter is backend-local. Shared transport schemas still belong in
  `flarex-protocol`.

Known limitations:

- Deep protocol decoding remains a future decision.
- Row/status normalization still lives in `DeploymentDO`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Analysis Codegen Validation Boundary

Previous completed checkpoint: `eb0dcc2` Extract deployment schema
validators.

What changed:

- Moved analysis/codegen validation orchestration into
  `packages/flarex-backend/src/deployment/Validation.ts`.
- Removed temporary low-level codegen helper imports from `DeploymentDO`.
- Kept high-level validator entrypoints as the boundary between the Durable
  Object and backend deployment metadata validation.
- Extended direct unit tests for analysis/codegen behavior.

Why it changed:

After schema/function primitives moved, analysis/codegen validation could move
as a unit. This keeps `DeploymentDO` focused on orchestration and prevents
low-level parser helpers from becoming a de facto public module surface.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- The validation module remains backend-local. Shared transport schemas still
  belong in `flarex-protocol`, and `ValidatorJson` remains the user
  document/function validator representation.

Known limitations:

- The protocol-to-backend adapter `analyzedStartPushRequest` still lives in
  `DeploymentDO`.
- Deep protocol decoding remains intentionally separate from this backend
  validation module.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Schema Function Validation Boundary

Previous completed checkpoint: `3a257f3` Extract deployment request
validators.

What changed:

- Expanded `packages/flarex-backend/src/deployment/Validation.ts` with
  schema/function validation primitives.
- Moved reusable validator helpers out of `DeploymentDO` while keeping the DO
  as the caller for route, SQL, and service boundaries.
- Exported only the helpers still needed by local analysis/codegen
  orchestration in `DeploymentDO`.
- Extended direct validator tests for schema/function behavior.

Why it changed:

Schema/function validation belongs beside the other deployment validation
helpers. Moving it narrows `DeploymentDO` toward orchestration while keeping
transport schemas in `flarex-protocol` and backend-specific validator logic in
`flarex-backend`.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex package
  boundary refinement.

Flarex differences:

- The validation module is backend-local, not a public SDK or protocol
  surface. `ValidatorJson` validation remains the backend representation for
  user document/function validators.

Known limitations:

- Deep `validateAnalysis` and `validateCodegenAnalysis` orchestration remains
  in `DeploymentDO`.
- A later slice should reduce the number of helper exports once codegen
  validation moves as a unit.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Validation Module Boundary

Previous completed checkpoint: `64f1e75` Extract deployment error types.

What changed:

- Added `packages/flarex-backend/src/deployment/Validation.ts`.
- Moved source-package and diagnostics helpers behind that deployment module
  boundary.
- Kept `DeploymentDO` as the caller for start-push validation and service
  orchestration.
- Added direct unit tests for the extracted helpers.

Why it changed:

The deployment package now has service, store, runtime, layer, and error
modules. A validation module lets pure request/domain validation move out of
the Durable Object incrementally without pulling route or SQL ownership with
it.

Convex references inspected:

- No new Convex source files were required. This is a Flarex package boundary
  cleanup before deeper validator extraction.

Flarex differences:

- The validation module is not a public protocol package. Shared transport
  schemas still belong in `flarex-protocol`.

Known limitations:

- Deep schema/function/codegen validators remain in `DeploymentDO`.
- `safeValidator` still depends on backend `ValidatorJson` validation and has
  not moved.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Error Module Boundary

Previous completed checkpoint: `566ddfa` Extract deployment push read service.

What changed:

- Added `packages/flarex-backend/src/deployment/Errors.ts` for deployment
  service tagged errors.
- Kept service implementation in `DeploymentService` and HTTP mapping in
  `DeploymentDO`.
- Updated tests to assert the same typed error classes from the dedicated
  module.

Why it changed:

As deployment orchestration moves behind Effect services, typed domain errors
should be importable without pulling the service implementation itself into
every boundary or test.

Convex references inspected:

- No new Convex source files were required. This checkpoint only clarifies the
  current Flarex package boundary.

Flarex differences:

- Flarex still maps errors at the Durable Object HTTP boundary. The error
  module is not a public SDK contract.

Known limitations:

- Protocol/parser errors remain in `flarex-protocol/deployment`.
- Semantic validators are still local to `DeploymentDO`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Push Read Service Boundary

Previous completed checkpoint: `a93b051` Extract active deployment service
read.

What changed:

- Extended the deployment Effect service boundary to single-push status reads.
- Added `DeploymentService.getPush` over the existing `DeploymentPushStore`
  read port.
- Kept `DeploymentDO.fetch()` responsible for route matching, push ID
  decoding, and HTTP response conversion.
- Reused `DeploymentPushNotFoundError` for missing push status reads.

Why it changed:

After moving push writes and active deployment reads behind the service,
single-push reads were the remaining deployment push-state route branch still
calling `DeploymentDO.getPush` directly.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex
  Cloudflare-specific service boundary over the current Durable Object state
  model.

Flarex differences:

- Flarex still stores and normalizes push rows inside the Durable Object. The
  Effect service does not introduce a global push repository.

Known limitations:

- The store still receives `readPush` for row-to-status normalization.
- Semantic validator extraction remains a future checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Active Read Service Boundary

Previous completed checkpoint: `b8c25b9` Extract deployment abandon service.

What changed:

- Extended the deployment Effect service boundary to active deployment reads.
- Added `DeploymentActiveDeploymentNotFoundError` for the no-active-deployment
  case, preserving route-level 404 behavior without direct reads in
  `DeploymentDO.fetch`.
- Expanded the deployment store port with `getActiveDeployment` so active
  metadata assembly lives beside the push lifecycle operations.
- Passed a `getMeta` callback into the deployment store layer while keeping
  metadata ownership in the Durable Object instance.
- Kept corrupt active metadata errors as `HttpError` passthrough.

Why it changed:

Active deployment reads consume the metadata written by finish-push. Moving
that read behind the same service/store boundary keeps active deployment state
coherent without moving HTTP routing or Durable Object lifecycle ownership.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex
  Cloudflare-specific boundary around the existing active deployment metadata
  model.

Flarex differences:

- Flarex still resolves active deployment state from Durable Object SQLite and
  metadata. The Effect service remains per DO instance and callback-based for
  this slice.

Known limitations:

- Single-push reads still go directly through `DeploymentDO.getPush`.
- The store still receives `readPush` for row-to-status normalization.
- Semantic validator extraction remains a future checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Abandon Service Boundary

Previous completed checkpoint: `42cccd5` Extract deployment finish service.

What changed:

- Extended the deployment Effect service boundary to abandon-push.
- Added `DeploymentPushInvalidStateError` for terminal-state abandon attempts,
  keeping state-machine rejection explicit instead of throwing directly from
  the Durable Object route.
- Expanded the deployment store port with `abandonPush` so the SQL update and
  post-update push read live with the other deployment write operations.
- Preserved transaction-level `HttpError` passthrough so store guards for
  unknown or terminal pushes do not become storage failures.
- Kept the Durable Object boundary responsible for route parsing, request body
  decoding, and HTTP conversion of typed service errors.

Why it changed:

Abandon-push is a state-machine write path with stable behavior and narrow
inputs. Moving it behind the service completes the main push lifecycle write
surface before taking on active deployment reads or deeper validation moves.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex
  Cloudflare-specific package boundary around the existing push state model.

Flarex differences:

- Flarex still stores deployment push state in Durable Object SQLite and
  composes the Effect service per DO instance. This slice does not introduce a
  global deployment service.

Known limitations:

- The store still receives `readPush` as a callback for row-to-status
  normalization.
- Active deployment reads and semantic validator extraction remain future
  checkpoints.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Finish Service Boundary

Previous completed checkpoint: `224f097` Extract deployment push-start
service.

What changed:

- Extended the deployment Effect service boundary from push-start into
  finish-push activation.
- Added an artifact runtime port next to the existing clock/id ports, keeping
  execution artifact lookup injectable and testable.
- Expanded the deployment store port with `getPush` and `finishPush` so the
  service can preflight unknown pushes and then delegate activation to the
  Durable Object-owned storage transaction.
- Kept the Durable Object boundary responsible for HTTP status mapping,
  route parsing, and the in-memory schema/function application callbacks used
  by activation.
- Kept activation validation `HttpError` failures separate from
  `DeploymentSqlError` so HTTP 400 validation behavior remains unchanged.

Why it changed:

Finish-push combines artifact lookup, state-machine checks, SQL updates,
schema/function application, and active deployment metadata. Moving that
orchestration behind a typed service boundary makes the deployment package
more coherent without moving Durable Object lifecycle ownership.

Convex references inspected:

- No new Convex source files were required. The boundary remains a Flarex
  Cloudflare implementation detail around the existing deploy-state model.

Flarex differences:

- Flarex still applies schemas and functions inside a Cloudflare Durable
  Object instance. The Effect service receives callbacks into that instance
  rather than owning global process state.

Known limitations:

- The store still uses callbacks such as `readPush`, `applySchema`,
  `applyFunctions`, and `setMeta` to preserve current Durable Object behavior.
  A broader deployment repository abstraction can wait until all write paths
  are behind the service.
- Abandon-push and active deployment reads have not crossed this boundary yet.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Service Push Start Boundary

Previous completed checkpoint: `bbdbec2` Add deployment analysis protocol
schemas.

What changed:

- Added `packages/flarex-backend/src/deployment/Runtime.ts`,
  `Store.ts`, `Service.ts`, and `Layer.ts` for the first deployment Effect
  service slice.
- `DeploymentDO` now hosts a per-instance `ManagedRuntime` for the deployment
  service, mirroring the existing Registry service pattern.
- The service owns push ID/time acquisition and delegates the push-start row
  transaction through a typed store port.
- `DeploymentDO` still owns HTTP routing, request parsing, semantic validators,
  and final error-to-response mapping.

Why it changed:

This creates a real service/package boundary for deployment push-start without
moving the entire Durable Object router or changing its behavior.

Convex references inspected:

- No new Convex source files were required. The boundary follows the repo's
  current Effect service pattern while keeping Flarex's Cloudflare Durable
  Object deployment state owner intact.

Flarex differences:

- Convex deploy services are not Durable Object instances. Flarex composes the
  service per Durable Object instance so SQLite storage and lifecycle stay
  tenant/deployment scoped.

Known limitations:

- The service currently covers only analyzed push-start persistence. Finish,
  abandon, active deployment, and metadata application remain in
  `DeploymentDO`.
- The store uses a `readPush` callback to preserve the existing row-to-status
  normalization before a broader deployment store extraction.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "coalesces concurrent fresh pending delivery reconciles"
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "does not coalesce concurrent pending delivery reconciles with different parameters"
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Analysis Protocol Boundary

Previous completed checkpoint: `bc2d552` Add deployment push-start protocol
schema.

What changed:

- `flarex-protocol/deployment` now exports deep deployment metadata schemas:
  `ValidatorJson`, placement/schema/function metadata, deployment analysis,
  codegen analysis, active deployment status, and finish-push response
  contracts.
- `PushStatus` response parsing now depends on those deep schemas for
  `analysis` and `codegenAnalysis`.
- Backend tests consume the new parser exports at JSON boundaries for push
  status, active deployment status, and activated finish responses.
- The protocol package has its own focused deployment schema tests.

Why it changed:

This keeps shared transport contracts in the protocol package and gives the
next service-extraction slice a typed response surface without moving
Durable Object write semantics yet.

Convex references inspected:

- No new Convex source files were required. The shape is Flarex's current
  backend analysis contract, which remains the Cloudflare-side analogue to
  backend-authoritative deployment metadata.

Flarex differences:

- Flarex is extracting these contracts from a Durable Object implementation.
  Convex already has mature deploy API/service boundaries, while Flarex is
  proving the protocol package incrementally.

Known limitations:

- Deep request decoding for `/push/start-analyzed` is intentionally deferred.
  `DeploymentDO` still owns semantic checks and exact validation messages.
- `ValidatorJson` is represented structurally for transport parsing only; user
  document/function validation still uses the existing validator runtime.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

## Deployment Push Start Protocol Boundary

Previous completed checkpoint: `6d026a9` Add deployment abandon protocol
schema.

What changed:

- Extended `flarex-protocol/deployment` with source package and analyzed
  push-start wrapper schemas:
  `PushSourceModule`, `PushSourcePackage`, `PushDiagnostic`, and
  `AnalyzedStartPushRequest`.
- DeploymentDO now decodes `POST /push/start-analyzed` bodies with
  `parseAnalyzedStartPushRequest`.
- DeploymentDO normalizes the protocol class output into its existing backend
  `AnalyzedStartPushRequest` shape before calling the unchanged `startPush`
  implementation, including explicit success/failure mutual-exclusion checks.
- Focused push lifecycle tests now parse successful analyzed push responses
  through `parsePushStatus` and cover invalid JSON, preserved source package
  validation, preserved diagnostics item validation, invalid diagnostics
  wrappers, and mixed success/failure wrappers.

Why it changed:

The abandon-push slice proved the deployment protocol subpath on a tiny route.
Push start is the next useful boundary because it validates input before any
push row is written while still allowing the deeper deployment analysis
validators to remain local.

Convex references inspected:

- No new Convex source files were required. This is still an incremental
  TypeScript protocol-boundary migration, not a redesign of deploy analysis or
  activation semantics.

Flarex differences:

- Convex deploy APIs have mature backend service contracts. Flarex is
  extracting those contracts gradually from a Cloudflare Durable Object router.

Known limitations:

- `sourcePackage`, diagnostics items, `analysis`, and `codegenAnalysis` remain
  deep-validated by DeploymentDO helpers. The protocol exports source package
  and diagnostic schemas for response parsing, but
  `parseAnalyzedStartPushRequest` only owns the push-start wrapper contract
  until those validators can be migrated without changing error semantics.
- Public source-only `/push/start` remains unchanged.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "skips stale failed live query deliveries after a newer result is active"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

## Deployment Abandon Protocol Boundary

Previous completed checkpoint: `90f4383` Test registry Effect service.

What changed:

- Added `flarex-protocol/deployment` as the second protocol subpath.
- The new protocol module owns the narrow DeploymentDO abandon-push boundary:
  `AbandonPushRequest`, `PushStatus`, and
  `DeploymentProtocolValidationError`.
- `packages/flarex-backend/src/deploymentDO.ts` now decodes
  `POST /push/:id/abandon` request bodies through the protocol parser.
- `packages/flarex-backend/test/push.test.ts` parses successful abandon
  responses through `parsePushStatus`.

Why it changed:

Registry proved the protocol package pattern on a tiny object. DeploymentDO is
larger and correctness-sensitive, so the next package-boundary proof should be
the smallest stable route that exercises real deployment metadata behavior
without touching activation SQL.

Convex references inspected:

- No new Convex source files were required for this slice. It preserves the
  existing deployment push state machine and only changes the TypeScript
  transport contract for abandon-push.

Flarex differences:

- Convex deployment APIs are backend-owned service contracts. Flarex is
  introducing the same idea incrementally as Effect Schema modules because the
  current Cloudflare Durable Object router is hand-written.

Known limitations:

- `PushStatus` validates the stable push envelope and source package shape, but
  keeps deep `analysis` and `codegenAnalysis` payloads as unknown for this
  narrow boundary. Full deployment analysis/codegen schemas belong in a later
  push-start or active-deployment slice.
- DeploymentDO still uses a plain fetch router and backend-local validation for
  the larger push start/finish surfaces.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "pending delivery reconciles"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

## Registry Effect Service Test Boundary

Previous completed checkpoint: `1a7112a` Refactor registry behind Effect
service.

What changed:

- Added focused `RegistryService` tests that run against controlled Effect test
  layers instead of Miniflare.
- The tests provide `RegistryStore`, `RegistryClock`, and `RegistryIds` with
  deterministic implementations.
- `RegistryService.listDeployments` is now an explicit service method backed
  by named `Effect.fn`, matching the reusable-function pattern already used by
  `createDeployment`.

Why it changed:

The Registry service extraction should be testable without constructing a
Cloudflare Durable Object. This checkpoint proves the service package boundary
before the same pattern is copied into larger backend modules.

Convex references inspected:

- No new Convex source files were required. This is an Effect service testing
  boundary around existing RegistryDO behavior, not a Convex semantic port.

Flarex differences:

- Convex does not expose this TypeScript service/layer boundary. Flarex needs
  it because backend behavior is being incrementally lifted out of Cloudflare
  `fetch()` hosts into reusable Effect runtime code.

Known limitations:

- The tests use plain Vitest plus `ManagedRuntime` and test layers. The repo
  does not yet add `@effect/vitest`; that can be revisited if more service
  tests need shared layer lifecycle helpers.
- RegistryDO remains the only backend module with this service-level test
  shape.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryService.test.ts packages/flarex-backend/test/registryDO.test.ts
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

## Registry Effect Service Boundary

Previous completed checkpoint: `9a66f62` Add registry protocol schema proof.

What changed:

- `flarex-backend` now depends on the workspace Effect v4 beta catalog entry
  directly because backend runtime code owns Effect services and Layers, not
  only protocol schemas.
- Added `packages/flarex-backend/src/registry/` as a narrow module folder for
  RegistryDO internals without moving the Durable Object host file yet.
- `registry/Store.ts` owns Durable Object SQLite access and emits typed
  `RegistrySqlError` failures at the SQL boundary.
- `registry/Runtime.ts` owns clock/id services so service logic does not hide
  direct `Date.now()` or `crypto.randomUUID()` calls.
- `registry/Service.ts` owns registry behavior behind `Context.Service`,
  `Layer`, and named `Effect.fn` service methods.
- `registry/Layer.ts` composes the per-DO runtime layer from the DO's own SQL
  storage instance.

Why it changed:

The previous checkpoint proved the protocol package boundary. This checkpoint
proves the next backend package boundary: existing DO hosts can remain small
Cloudflare adapters while reusable runtime behavior moves behind Effect
services and layers.

Convex references inspected:

- No new Convex source files were required for this package-boundary slice.
- The Convex-first constraint still applies to backend semantics; this
  checkpoint only changes local Flarex composition boundaries around an
  existing RegistryDO behavior proof.

Flarex differences:

- Convex does not need a TypeScript `ManagedRuntime` bridge at its Rust
  backend boundaries. Flarex does because Durable Object `fetch()` handlers are
  non-Effect Cloudflare entrypoints.
- The DO SQL storage layer is per Durable Object instance, not global. The
  layer factory therefore accepts `ctx.storage.sql` from the DO instance.

Known limitations:

- Only RegistryDO internals use the Effect service boundary. Worker routing,
  DeploymentDO, PartitionDO, executor-http, and freshness remain unchanged.
- The RegistryDO host still uses a plain hand-written fetch router. HttpApi is
  intentionally deferred until service extraction has a reviewed proof.
- Effect service unit tests are not added yet; current coverage remains the
  focused Miniflare route tests from the previous checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryDO.test.ts
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

## Schema-First Protocol Package Boundary

Previous completed checkpoint: `27afbea` Add Effect migration reviewer.

What changed:

- Added `packages/flarex-protocol` as the first schema-first internal protocol
  package.
- The package currently owns only the narrow RegistryDO proof surface:
  `Json`, `CreateDeploymentRequest`, `DeploymentRecord`,
  `ListDeploymentsResponse`, and `ProtocolValidationError`.
- `flarex-backend` now depends on `flarex-protocol` and consumes
  `CreateDeploymentRequest` decoding for `RegistryDO` create-deployment
  requests.
- `flarex-backend/src/types.ts` re-exports `DeploymentRecord` from
  `flarex-protocol` while keeping the existing backend-local mutable `Json`
  alias in place to avoid a broad cross-package type churn in this first
  checkpoint.

Why it changed:

The Effect migration needs a proven contract boundary before moving DOs,
introducing HttpApi, or reorganizing modules. Starting with RegistryDO creates
a small package-boundary proof while leaving Worker routing and Durable Object
SQL behavior unchanged.

Convex references inspected:

- No new Convex source files were required for this package-boundary slice.
- The existing Convex-first direction still applies: public SDK compatibility
  remains in `packages/flarex`, while backend protocol contracts move behind a
  runtime-neutral internal package.

Flarex differences:

- This is an Effect Schema package boundary, not a Convex port. Convex's
  backend model is Rust-owned; Flarex needs TypeScript runtime schemas for
  Cloudflare Worker and DO boundaries.
- `ValidatorJson` remains separate from Effect Schema. The new package
  validates transport/service contracts, not user document or function
  validators.

Known limitations:

- Only RegistryDO contracts are present. Deployment, partition, execution,
  scheduler, sync, and executor contracts remain in their existing packages.
- The workspace uses the Effect v4 beta line (`effect@4.0.0-beta.90`) so the
  protocol package can follow the local `effect-smol` API style, including
  `Schema.TaggedErrorClass`.
- Built-output package publishing remains future work; packages still expose
  TypeScript source.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Packed Test SDK Reset Boundary

Previous completed checkpoint: `d94ef92` Cover packed test SDK Postgres
subscriptions.

What changed:

- Added `reset()` to the `flarex-test` public package surface.
- The packed fresh-consumer fixture now imports the installed tarball and proves
  reset clears state after live-query flows for both default and Postgres
  transports.
- The Postgres packed reset path uses a string `persistDir`, so the packed
  package graph proves persisted local state cleanup through the public helper.
- Unsafe reset deletion paths are rejected by the shared `flarex-dev` resolver
  before `flarex-test` calls recursive filesystem cleanup.
- `flarex-test` precomputes the resettable path at harness creation, so invalid
  public options fail before any runtime teardown.
- The public `reset`, `reload`, and `dispose` methods run through a serialized
  lifecycle queue.

Why it changed:

Package-boundary tests should prove test helpers app developers rely on from a
clean install. Reset is a public harness contract, so it must work through the
packed dependency graph, not only in workspace source tests.

Convex references inspected:

- `npm-packages/convex/package.json`
  - package exports are the consumer boundary.
- Convex test helper ergonomics recorded in the Test SDK roadmap.

Flarex differences:

- Flarex validates reset by recreating the local runtime because Cloudflare
  Durable Objects and the Postgres/PGlite executor state are part of the tested
  behavior.
- `flarex-test` reuses the `flarex-dev` persistence resolver, keeping package
  boundary behavior aligned with the dev runtime.
- The reset deletion policy is intentionally narrower than arbitrary dev
  runtime persistence paths because it performs destructive cleanup.
- The resolver option type is derived from `FlarexDevRuntimeOptions`, keeping
  the exported package boundary tied to the dev-runtime contract.
- The package still ships source-mode exports; built NodeNext artifact
  validation remains a future package-output checkpoint.

Known limitations:

- Identity/seed helper package boundaries remain future work.
- No published package artifact format is finalized yet.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- dev.test.ts
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-test typecheck
corepack pnpm --filter flarex-test build
corepack pnpm --dir apps/example exec vitest run flarex/invoke-e2e.test.ts --hookTimeout=60000 --testTimeout=60000
corepack pnpm --filter @flarex/example typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Test SDK Postgres Subscription Boundary

Previous completed checkpoint: `9b0486f` Cover packed test SDK Postgres invoke
flow.

What changed:

- Extended the fresh packed-consumer Postgres script to use the installed
  `flarex-test` package's `client()` helper.
- Added a generated shared live-query assertion helper so the legacy and
  Postgres packed scripts validate the same subscription contract.
- The clean installed package graph now proves Postgres-backed live query
  subscription, sync mutation, delivery, and callback update behavior through
  public package exports and generated app files.

Why it changed:

Direct Postgres invoke coverage proved that the packed test SDK can reach the
trusted executor. The package boundary still needed to prove the app-facing
sync surface, because a consumer can successfully invoke mutations while still
failing to receive live-query updates from the installed package graph.

Convex references inspected:

- `npm-packages/convex/src/browser/sync/client.ts`
  - Convex's installed client package owns live-query subscription behavior.
- `npm-packages/convex/package.json`
  - installed package exports are the consumer boundary.

Flarex differences:

- Flarex validates this through the local Postgres/PGlite executor transport
  and Miniflare WebSocket bridge. Convex does not expose the transport split.
- Built NodeNext artifact validation remains separate from this source-mode
  packed consumer gate.

Known limitations:

- This proves local PGlite-backed Postgres delivery, not a deployed
  Nitro/Vercel executor plus Cloudflare Worker WebSocket deployment.
- Identity/reset helper package boundaries remain future work.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Test SDK Postgres Transport Boundary

Previous completed checkpoint: `d133982` Cover packed test SDK live query
flow.

What changed:

- Added a second packed consumer `flarex-test` runtime script for the
  Postgres/PGlite transport.
- The fresh install now proves the installed package graph can resolve
  `flarex-test -> flarex-dev -> @flarex/executor -> @flarex/persistence-postgres`
  and execute generated app functions through that graph.
- The smoke uses only public package exports and generated app files from the
  temp consumer.

Why it changed:

The Postgres executor is the forward authoritative path. Package-boundary tests
should prove that path in a clean consumer install, not only through workspace
tests where source imports and dependency resolution are more forgiving.

Convex references inspected:

- `npm-packages/convex/package.json`
  - installed package exports are the consumer boundary.
- Convex's generated-reference test ergonomics remain the model for the
  `flarex-test` consumer surface.

Flarex differences:

- Convex does not expose a second transport selector to app tests. Flarex does
  while the legacy Durable Object prototype and Postgres executor coexist.
- The packed consumer validates source-mode package exports with linked
  external dependencies; final built-output package validation remains separate.

Known limitations:

- Packed Postgres live-query delivery is still not covered here.
- This does not prove Nitro/Vercel deployment behavior; it proves the installed
  local test SDK package boundary.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Test SDK Subscription Boundary

Previous completed checkpoint: `a738186` Cover packed test SDK mutation flow.

What changed:

- Extended the packed consumer test SDK smoke to use the installed
  `flarex-test` package's `client()` helper.
- The temp consumer now exercises a live query subscription and a client-side
  mutation over the sync path, then verifies the subscription receives the
  updated query result with an order-insensitive exact message-set assertion.

Why it changed:

The test SDK package boundary should cover the app-facing sync surface as well
as direct invoke helpers. A package can import and run direct mutations but
still fail to expose a usable WebSocket-backed client from a clean consumer.

Convex references inspected:

- `npm-packages/convex/src/browser/sync/client.ts`
  - Convex's installed client package owns live query subscription behavior.
- `npm-packages/convex/package.json`
  - installed package exports are the consumer boundary.

Flarex differences:

- Flarex validates this through a source-mode packed consumer and the test
  SDK's Miniflare WebSocket bridge. Convex validates against its hosted sync
  service/runtime.

Known limitations:

- This proves legacy/local dev sync behavior from a packed consumer. The
  Postgres executor delivery path remains covered by example E2E, not by a
  packed `flarex-test` consumer yet.
- Built NodeNext artifact validation remains future work.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Test SDK Mutation Boundary

Previous completed checkpoint: `5cb7dee` Run packed test SDK against
generated app.

What changed:

- Added a generated `messages.send` mutation to the packed fresh-consumer
  fixture.
- The packed consumer now invokes both generated query and mutation references
  through the installed `flarex-test` package.
- The mutation result and the follow-up query prove the write path persists
  data through the packed consumer runtime, including matching the returned id
  to the queried document `_id`.

Why it changed:

Package boundaries for test helpers should prove the app-facing behavior that
developers rely on. A read-only query smoke did not prove that the installed
test SDK can drive mutation sessions and observe committed writes through the
same generated app API.

Convex references inspected:

- `npm-packages/convex/package.json`
  - installed package exports are the consumer boundary.
- Convex test-helper ergonomics remain the model for invoking generated app
  functions through a compact test harness.

Flarex differences:

- Flarex validates this through a temp source-mode package consumer and local
  Miniflare/dev runtime. Convex publishes built artifacts and targets its own
  backend/test runtime.

Known limitations:

- This proves a single-partition write in the packed consumer. Subscription was
  added in the next checkpoint; identity, reset, and Postgres-transport
  consumer gates remain future work.
- Built NodeNext artifact validation remains future work.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Test SDK Invocation Boundary

Previous completed checkpoint: `44878a0` Add packed consumer smokes for test
and Nitro packages.

What changed:

- Added a packed-consumer `flarexTest()` invocation script to
  `integration/fresh-consumer-pack.integration.test.ts`.
- The fresh consumer now generates `_generated/api`, imports it from the temp
  app, boots the installed packed `flarex-test` runtime, invokes
  `api.messages.list`, and disposes the harness.
- The invocation uses the installed SDK's `encodeFlarexId` helper so the packed
  package graph proves branded ID construction as well as function invocation.
- The packed script reads the generated `deploymentSchema` table metadata for
  the table id instead of hard-coding the analyzer's current numeric table
  assignment.
- The table name is checked against generated `TableNames` before constructing
  the ID, keeping source package, generated metadata, and public ID helper
  usage in one consumer path.
- The packed consumer declares `tsx` directly for runtime smokes instead of
  relying on transitive dev-tool availability.

Why it changed:

Package boundaries should prove more than importability for app-facing helper
packages. `flarex-test` is intended to be used from application test code, so a
clean consumer must be able to run the harness against generated Flarex app
code.

Convex references inspected:

- `npm-packages/convex/package.json`
  - installed SDK exports are the consumer boundary.
- Convex test-helper ergonomics remain the mental model for a compact app test
  harness.

Flarex differences:

- Flarex validates the source-mode package through a temp consumer and local
  Miniflare/dev runtime. Convex publishes built artifacts and targets its own
  backend environment.

Known limitations:

- This proves a read-only query invocation from a packed app. Mutation,
  subscription, and identity helper coverage remain future package-boundary
  gates.
- Built NodeNext artifact validation remains future work.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Test SDK And Nitro Fresh-Consumer Boundary

Previous completed checkpoint: `fad789f` Add test SDK and Nitro package
boundaries.

What changed:

- Extended the packed fresh-consumer install gate to include:
  - `flarex-test`,
  - `@flarex/executor-nitro`.
- The temp consumer now installs both packages from local tarballs alongside
  the existing Flarex package graph.
- The fixture override matrix now maps every packed internal package, including
  transitive dependencies such as `flarex-test -> flarex-dev`, to the local
  tarball produced during the test.
- Shared internal package metadata now lives in `packabilityHelpers.ts` so the
  tarball-shape test and the fresh-consumer test do not maintain divergent
  package name/root/tarball lists.
- Added a consumer smoke file that imports the Nitro adapter factory and the
  test SDK public factory/error/type surface from the installed packages, then
  runs both `tsc` and `tsx` from the fresh consumer.

Why it changed:

The previous checkpoint proved tarball shape only. Package boundaries are more
useful when the package can also be installed and resolved from a clean app
graph, because source-mode exports can hide missing dependency or TypeScript
resolution problems until consumed outside the workspace.

Convex references inspected:

- `npm-packages/convex/package.json`
  - Convex package metadata treats exports and installable contents as the SDK
    boundary.
- Convex's npm package flow remains the model: the consumer should import the
  public package, not workspace source paths.

Flarex differences:

- Flarex still validates TypeScript-source tarballs. Convex publishes built SDK
  artifacts.
- `@flarex/executor-nitro` is a Flarex host adapter; Convex does not expose a
  Nitro/Vercel adapter package.

Known limitations:

- The smoke imports `flarex-test` and `@flarex/executor-nitro`, but it does not
  run a complete packed-app invocation through `flarex-test` yet.
- The Nitro adapter smoke proves import/runtime resolution, not an end-to-end
  Nitro server deployment.
- The consumer typecheck uses Flarex's current Vite/Bundler-style source
  package resolution. Built NodeNext artifact validation remains future work.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/internal-packages-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/internal-packages-pack.integration.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Test SDK And Nitro Adapter Tarball Boundaries

Previous completed checkpoint: `339e671` Add packed consumer generated
typecheck gate.

What changed:

- Added explicit package `files` boundaries for:
  - `flarex-test`: `src`,
  - `@flarex/executor-nitro`: `src`.
- Extended `integration/internal-packages-pack.integration.test.ts` to include
  both packages.
- The shared packability gate now proves these tarballs include only their
  exported source entrypoint, exclude tests/config, and avoid local-only
  dependency protocols in packed manifests.

Boundary rule:

Every source-mode package should have an explicit npm `files` surface before it
is used as a dependency in examples, tests, or adapters. Tests and TypeScript
config are repo development surface, not runtime package surface.

Convex references inspected:

- `npm-packages/convex/package.json`
  - Convex controls installable package contents through explicit package
    metadata and exports.

Flarex differences:

- Flarex still publishes TypeScript source in this prototype. Convex publishes
  built artifacts.
- `@flarex/executor-nitro` is a Flarex-specific host adapter; Convex does not
  need a Nitro adapter for its hosted backend.

Known limitations:

- This is tarball-shape coverage only. It does not yet install `flarex-test` or
  `@flarex/executor-nitro` in a fresh consumer fixture.
- Built `dist` package output remains a future boundary.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/internal-packages-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/internal-packages-pack.integration.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Packed Consumer Typecheck Boundary

Previous completed checkpoint: `395ac9f` Add packed consumer codegen smoke.

What changed:

- The packed consumer command gate now proves normal codegen and generated
  output typechecking, not only dry-run reporting.
- The consumer directly provides packed `flarex`, packed `flarex-dev`, linked
  `typescript`, and linked `@cloudflare/workers-types`.

Boundary rule:

Consumer package graph tests should include the packages that user source and
generated output actually depend on. A passing installed CLI smoke is not enough
if generated output cannot typecheck from the same consumer graph.

Convex references inspected:

- `npm-packages/convex/package.json`
  - package exports and type surfaces are part of the installed SDK contract.
- `packages/flarex-dev/src/generatedTypecheck.ts`
  - Flarex's generated-output typecheck requirements.

Flarex differences:

- This still validates source-mode packages with local dependency links.
  Convex publishes built package artifacts.

Known limitations:

- Deploy/backend push remains a future packed-consumer boundary.
- `flarex-test` and `@flarex/executor-nitro` remain outside this package graph
  gate until their own packed-consumer tests are added.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Consumer Command Boundary

Previous completed checkpoint: `982396a` Add fresh consumer package install
gate.

What changed:

- The fresh-consumer package graph gate now executes a real installed CLI
  command, not just `--help`.
- The packed `flarex-dev` tarball must be able to analyze a minimal consumer
  `flarex/` source tree and produce dry-run generated file output.
- The consumer also installs packed `flarex` directly, so the source/runtime SDK
  boundary used by `flarex/server` and `flarex/values` is represented explicitly.

Boundary rule:

Package graph gates should prove two things:

- the package manager can install the packed graph outside the monorepo, and
- the installed CLI can execute meaningful user-facing commands from that
  consumer context.

Convex references inspected:

- `npm-packages/convex/package.json`
  - Convex's npm package boundary includes executable SDK/CLI behavior from the
    installed artifact.
- `packages/flarex-dev/test/fixtures.ts`
  - minimal Flarex project shape reused for command execution.

Flarex differences:

- Flarex source-mode packages still require local public dependency links in
  the packed consumer fixture; Convex publishes built artifacts.

Known limitations:

- Dry-run codegen is covered, but generated-output typecheck and deploy are
  still separate future package-boundary gates.
- The test does not yet cover `flarex-test` or `@flarex/executor-nitro`.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Fresh Consumer Package Graph Boundary

Previous completed checkpoint: `85faa2d` Add remaining package packability
gates.

What changed:

- Added a fresh-consumer install gate that packs the SDK/dev/runtime Flarex
  packages required by `flarex-dev`, installs `flarex-dev` into a temporary
  project, and verifies the installed CLI starts.
- Internal Flarex packages are consumed as tarballs, not workspace links.
- External public runtime dependencies are linked from the local workspace so
  the gate isolates package graph correctness from registry/network behavior.
- The install uses a temp pnpm store in offline mode so only explicit tarball
  and link dependencies are available.

Boundary rule:

Package boundary tests now have two layers:

- Tarball shape: each package exposes only intended files and exports.
- Consumer graph: `flarex-dev` can install from packed Flarex tarballs and run
  outside the monorepo.

Convex references inspected:

- `npm-packages/convex/package.json`
  - packages SDK surface through explicit exports and npm-installable artifact
    layout.

Flarex differences:

- Convex's registry package resolves through published packages. Flarex's local
  test must use tarball overrides until the internal packages are actually
  published.
- `flarex-test` and `@flarex/executor-nitro` are excluded for now because they
  are not part of the `flarex-dev` packed runtime graph.

Known limitations:

- The graph gate does not yet verify built output because Flarex packages still
  publish TypeScript source.
- The gate does not prove external package registry availability.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Remaining Source Package Tarball Boundaries

Previous completed checkpoint: `e07b1e5` Add internal package packability
gates.

What changed:

- Added explicit package `files` boundaries for:
  - `@flarex/persistence-postgres`: `drizzle` and `src`,
  - `@flarex/freshness`: `src`,
  - `@flarex/executor`: `src`,
  - `@flarex/executor-http`: `src`.
- Extended packability coverage to prove those tarballs contain public export
  targets, exclude development-only entries, and avoid local-only dependency
  protocols in packed manifests.
- The persistence boundary is journal-driven: every Drizzle migration SQL file
  and snapshot listed by `drizzle/meta/_journal.json` must be present in the
  tarball.

Boundary rule:

Internal source-mode packages should publish only their runtime source and
explicit runtime assets. Test files, Vitest config, and TypeScript config are
not package runtime surface. Migration assets are allowed only for persistence
packages whose runtime migration helpers resolve them.

Packability tests enforce this boundary by rejecting test/spec files,
`test`/`tests`/`__tests__` directories, fixture directories, and nested
Vite/Vitest/TypeScript config files unless a package case explicitly allows a
runtime test harness entry.

Convex references inspected:

- `npm-packages/convex/package.json`
  - controls npm package boundaries with explicit `files`.

Flarex differences:

- Flarex persistence currently ships Drizzle SQL migration assets directly in
  the source tarball. Convex publishes a built package surface instead.

Known limitations:

- This does not verify install-time behavior in a fresh consumer yet.
- Future built packages may replace source-mode `files` boundaries with `dist`
  boundaries.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/cli-pack.integration.test.ts integration/internal-packages-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/cli-pack.integration.test.ts integration/internal-packages-pack.integration.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm --filter @flarex/freshness build
corepack pnpm --filter @flarex/executor build
corepack pnpm --filter @flarex/executor-http build
corepack pnpm --filter @flarex/persistence-postgres pack --dry-run
corepack pnpm --filter @flarex/freshness pack --dry-run
corepack pnpm --filter @flarex/executor pack --dry-run
corepack pnpm --filter @flarex/executor-http pack --dry-run
git diff --check
```

## Source Package Tarball Boundaries

Previous completed checkpoint: `000379c` Add flarex-dev packability gate.

What changed:

- Added explicit package `files` boundaries for:
  - `flarex`: `LICENSE.convex` and `src`,
  - `flarex-backend`: `src` and `test/backendHarness.ts`.
- Added optional peer dependencies for `miniflare` and `vite` because the
  public `flarex-backend/test/backendHarness` export imports those packages.
- Added packability coverage proving those peers are marked optional in the
  packed manifest.
- Added integration coverage proving those tarballs contain their public export
  targets and exclude broad test/config files.

Boundary rule:

Published source-mode packages should expose only the files referenced by their
public package surface. Tests, Vitest config, and TypeScript project config are
not package runtime surface. Existing exported test helpers and test-namespaced
exports must be named and allowed explicitly instead of leaking whole `test/`
directories. If a public test helper imports test/runtime packages, those
packages must be declared as dependencies or peers instead of staying only in
`devDependencies`.

Convex references inspected:

- `npm-packages/convex/package.json`
  - uses explicit `files` to control the npm package boundary.

Flarex differences:

- Flarex still ships TypeScript source in these packages; Convex ships built
  artifacts.
- `flarex-backend` still has public `./test/backendHarness` and
  `./test/sync-protocol` exports. This checkpoint preserves the existing
  exports and limits the package to the exact test helper file plus source
  targets.

Known limitations:

- This does not decide whether `./test/backendHarness` or `./test/sync-protocol`
  should remain public long-term.
- Other internal packages still need the same boundary hardening.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/cli-pack.integration.test.ts integration/internal-packages-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/cli-pack.integration.test.ts integration/internal-packages-pack.integration.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex pack --dry-run
corepack pnpm --filter flarex-backend pack --dry-run
git diff --check
```

## DeliveryDO Executor Injection Implementation

Previous completed checkpoint: `f12a7d2` Add live query delivery claim ack
APIs.

What changed:

- Implemented `DeliveryDO` in `packages/flarex-backend` without importing
  executor internals.
- `DeliveryDO` calls executor claim/ack through injected env config:
  - `FLAREX_EXECUTOR` service binding, or
  - `FLAREX_EXECUTOR_URL` external endpoint,
  - `FLAREX_EXECUTOR_TOKEN` optional bearer token.
- Added `DELIVERIES` to backend Miniflare and Wrangler Durable Object bindings.
- Re-exported `DeliveryDO` from the deployable backend wrapper.

Boundary rule preserved:

Cloudflare owns fanout. The executor owns durable delivery-row state. The only
runtime contract between them is HTTP claim/ack.

Convex references inspected:

- `crates/sync/src/state.rs`
- `crates/sync/src/worker.rs`

Known limitations:

- No shared typed HTTP client package exists yet; `DeliveryDO` currently owns
  minimal response parsing.
- No queue/alarm continuation boundary yet.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter flarex-dev typecheck
```

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

## Live-Query Trigger Notifier Boundary

Previous completed checkpoint: `5437ca8` Document live query route ownership.

What changed:

- `@flarex/executor` owns the post-commit live-query invalidation hook shape.
- `@flarex/executor-http` owns
  `createFlarexBackendLiveQueryTriggerNotifier(...)`, the HTTP helper that
  calls Cloudflare's scheduler trigger route.
- Executor core still does not import Cloudflare backend code, Worker types, or
  Nitro route code.

Why it changed:

The trusted executor must know when a mutation has committed, but the method
for waking Cloudflare is host-specific. Keeping the notifier injected preserves
the package boundary while letting Nitro/Vercel deployments call the
Cloudflare scheduler.

Convex reference:

- `crates/database/src/committer.rs`
  - commit publication is backend-owned.
- `crates/sync/src/worker.rs`
  - sync scheduling is backend-owned but internal in Convex.

Flarex difference:

- Convex does not need an exported notifier helper. Flarex needs one because
  executor hosting and WebSocket/scheduler hosting are separate.

Known limitations:

- The deployable host still needs to construct the executor with a durable
  freshness store and this trigger notifier.
- Durable retry for failed trigger notification remains future work.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http exec vitest run test/http.test.ts
corepack pnpm --filter @flarex/executor-http typecheck
```

## Local PGlite Executor Host Composition

Previous completed checkpoint: `730d284` Trigger live query invalidation after
commit.

What changed:

- Added `createLocalPGliteExecutorHttpRuntime(...)` in `flarex-dev`.
- Kept `@flarex/executor` framework-neutral.
- Kept HTTP trigger construction in `@flarex/executor-http`.
- Made `flarex-dev` the local composition layer that imports PGlite,
  freshness, executor, and executor HTTP helpers.

Why it changed:

The platform needs one place that assembles the real local/test host without
turning executor core into a Cloudflare or Nitro package. `flarex-dev` is the
right layer for local composition because it already owns local runtime
orchestration and test/dev helpers.

Convex references:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - Convex local dev owns orchestration around the backend, not the database
    core itself.
- `crates/database/src/committer.rs`
  - commit remains backend-owned.
- `crates/sync/src/worker.rs`
  - sync scheduling remains backend-owned.

Flarex differences:

- Convex does not split a local PGlite executor from a Cloudflare scheduler.
  Flarex local composition must wire those boundaries explicitly.

Known limitations:

- Production Nitro/Vercel host construction still needs its own equivalent
  factory/config using real Postgres.
- Durable retry for failed post-commit trigger notification remains future
  work.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/executorHttpRuntime.test.ts
```

## Stale Rerun Fanout Boundary

Previous completed checkpoint: `0139e0d` Wire live query dead-letter
reconnects.

What changed:

- `@flarex/executor` remains the owner of stale subscription rerun and durable
  live-query delivery-row creation.
- `packages/flarex-backend` now owns the Cloudflare consumer:
  `SchedulerDO` calls executor `/maintenance/live-queries/rerun` and wakes the
  deployment `DeliveryDO` only when changed subscriptions are reported.
- The Worker route
  `POST /scheduler/live-query-subscriptions/rerun` is a Cloudflare backend
  maintenance route, not a new executor-core API.

Why it changed:

- This preserves the platform split: trusted Postgres/executor logic decides
  what changed and persists delivery rows; Cloudflare DOs handle connection
  fanout and WebSocket state.

Convex references:

- `crates/sync/src/worker.rs`
  - Convex keeps sync-session update scheduling and transition production
    inside one backend worker.
- `crates/sync/src/state.rs`
  - query-set state owns active query subscriptions and result hashes.
- `npm-packages/convex/src/browser/sync/client.ts`
  - client-side sync consumes transitions and updates local query observers.

Flarex differences:

- Convex does not expose an executor/backend fanout boundary. Flarex must,
  because the executor can run on Nitro/Vercel while WebSockets and `DeliveryDO`
  live in Cloudflare.
- The Cloudflare backend does not inspect or construct changed query payloads;
  it drains durable delivery rows through the existing delivery claim/ack API.

Known limitations:

- Other adapters need their own equivalent rerun consumer if they do not use
  Cloudflare Durable Objects.
- Automatic scheduler continuation for `hasMoreStale` remains future work.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "reruns stale live query subscriptions"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Scheduler Rerun Continuation Boundary

Previous completed checkpoint: `0386055` Fan out stale live query reruns.

What changed:

- `packages/flarex-backend` now persists pending stale-rerun continuation state
  inside `SchedulerDO` storage.
- Continuation remains Cloudflare-specific and does not add new executor-core
  APIs.
- Executor remains responsible for stale scan, rerun execution, durable
  delivery-row creation, and the existing claim/ack API.

Why it changed:

- The scheduler needs to continue bounded work when the executor reports
  `hasMoreStale`, but that continuation is runtime orchestration, not
  persistence or transaction semantics.

Convex references:

- `crates/sync/src/worker.rs`
  - sync worker owns update scheduling and retry inside Convex's backend
    runtime.
- `crates/sync/src/state.rs`
  - sync state tracks invalidated queries and subscription refills.

Flarex differences:

- Flarex persists continuation in `SchedulerDO` because execution may be split
  across Cloudflare and Nitro/Vercel. Convex does not expose this boundary.
- The internal `/continue-live-query-reruns` route is a Cloudflare testing and
  alarm hook, not a public executor route.

Known limitations:

- The current scheduler instance stores a single pending rerun job. If future
  trigger routing uses one scheduler DO for many deployments, this must become
  a queue or deterministic per-deployment scheduler naming.
- Retry observability is still only implicit in Durable Object alarm state.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "continues stale live query reruns"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Live-Query Trigger Route Boundary

Previous completed checkpoint: `986442c` Continue stale live query reruns.

What changed:

- `packages/flarex-backend` now exposes
  `POST /scheduler/live-query-subscriptions/trigger`.
- The route is a Cloudflare backend boundary that forwards to `SchedulerDO`'s
  existing bounded stale-rerun flow.
- No executor-core API changed.

Why it changed:

- Future freshness projection or commit outbox workers need a stable runtime
  boundary to wake live-query reruns without knowing executor internals or
  `DeliveryDO` mechanics.

Convex references:

- `crates/sync/src/worker.rs`
  - update scheduling is internal to Convex's sync backend.
- `crates/sync/src/state.rs`
  - sync state owns query invalidation and subscription refill.

Flarex differences:

- Flarex has an explicit trigger boundary because the producer may live in
  Cloudflare while stale scan/rerun/delivery-row creation remain executor
  owned.
- The trigger route is an alias into the Cloudflare scheduler flow, not a
  duplicate delivery mechanism.

Known limitations:

- The actual producer hook is still future work.
- The trigger route currently uses the same live-query delivery capability
  token as delivery maintenance routes.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "triggers stale live query reruns"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Dead-Letter Reconnect Boundary

Previous completed checkpoint: `038649e` Add live query delivery dead
lettering.

What changed:

- The executor remains responsible for the durable stuck-delivery policy:
  selecting stuck rows, marking them dead-lettered, and returning
  `reconnectConnectionIds`.
- `packages/flarex-backend` now owns the Cloudflare-specific consumer:
  `SchedulerDO` calls the executor maintenance endpoint and then calls
  `ConnectionDO /force-reconnect` for each returned connection name.
- The worker route
  `POST /scheduler/live-query-deliveries/dead-letter` is an authenticated
  Cloudflare backend route, not a new executor-core API.

Why it changed:

- Reconnect fanout is runtime-specific. Keeping it in `flarex-backend` preserves
  the framework-neutral executor boundary while still letting the Cloudflare
  runtime recover stuck sync sessions.

Convex references:

- `npm-packages/convex/src/browser/sync/web_socket_manager.ts`
  - reconnect is driven by WebSocket lifecycle state.
- `npm-packages/convex/src/browser/sync/client.ts`
  - reconnect reissues active query and request state.
- `crates/sync/src/worker.rs`
  - server-side sync session ownership is a backend runtime concern.

Flarex differences:

- Convex has one integrated backend sync runtime. Flarex splits policy
  (`@flarex/executor`) from Cloudflare connection fanout
  (`packages/flarex-backend`).
- The executor does not import Durable Object types or know how to reach a
  `ConnectionDO`.

Known limitations:

- Other hosting adapters still need their own consumer if they support live
  sync without Cloudflare Durable Objects.
- Automatic stuck-delivery scheduling is intentionally not in executor core.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "dead-letters stuck live query deliveries"
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Delivery Failure Boundary

Previous completed checkpoint: `d1bc1fe` Add live query delivery reconciler.

Boundary decision:

- `@flarex/persistence-postgres` owns the delivery-row failure columns and
  low-level update operation.
- `@flarex/executor` owns validation and the framework-neutral
  `recordLiveQueryDeliveryFailure(...)` API.
- `@flarex/executor-http` exposes the maintenance route for deployed executor
  hosts.
- `packages/flarex-backend` calls that route from `DeliveryDO` when fanout or
  ack fails.

This keeps Cloudflare Durable Objects from owning durable failure history while
still letting them report runtime failures at the correct boundary.

Convex difference:

- Convex does this work inside one backend sync runtime. Flarex preserves the
  same durable-before-deliver principle with explicit executor/edge handoff
  APIs.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter flarex-backend typecheck
```

## Stuck Delivery Read Boundary

Previous completed checkpoint: `b35e2ca` Record live query delivery failures.

Boundary decision:

- `@flarex/persistence-postgres` owns the query over delivery failure columns.
- `@flarex/executor` owns validation/defaulting for `limit` and `minAttempts`.
- `@flarex/executor-http` exposes
  `/maintenance/live-queries/stuck-deliveries`.
- Cloudflare runtime does not own this state; it may call the endpoint later
  for operator tooling or dead-letter policy, but persistence stays executor
  owned.

Convex difference:

- Convex has no equivalent public split because sync workers and durable
  backend state are colocated. Flarex exposes the boundary to preserve the same
  durable-before-deliver principle across runtimes.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
```

## Dead-Letter Policy Boundary

Previous completed checkpoint: `14925e0` List stuck live query deliveries.

Boundary decision:

- `@flarex/persistence-postgres` owns the row mutation that marks live-query
  deliveries dead-lettered.
- `@flarex/executor` owns the policy that consumes stuck candidates and
  decides which rows to dead-letter.
- `@flarex/executor-http` exposes maintenance routes for hosted executor
  deployments.
- `packages/flarex-backend` remains unchanged in this checkpoint; a future
  Cloudflare scheduler/connection consumer can use the returned
  `reconnectConnectionIds`.

Convex files inspected:

- `crates/sync/src/worker.rs`
- `npm-packages/convex/src/browser/sync/web_socket_manager.ts`

Flarex difference:

- Convex's sync worker and client websocket manager own retry/reconnect
  behavior without a split maintenance API.
- Flarex must make the executor/Cloudflare boundary explicit because the
  scheduler may run in Cloudflare while the delivery rows live in Postgres.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
```

## Executor HTTP Wake Notifier Boundary

Previous completed checkpoint: `bd74849` Add DeliveryDO live query fanout.

What changed:

- `@flarex/executor-http` now owns the reusable backend wake notifier helper.
- `@flarex/executor-nitro` re-exports that helper for Nitro/Vercel hosts.
- Executor core remains Cloudflare-agnostic; it only returns rerun results and
  persists delivery rows through the persistence interface.
- Cloudflare-specific DeliveryDO behavior remains in `flarex-backend`.

Boundary rule:

```txt
@flarex/executor
  owns durable rerun and delivery-row semantics
@flarex/executor-http
  owns HTTP adapter callbacks/notifiers
@flarex/executor-nitro
  re-exports adapter helpers for Nitro deployment
flarex-backend
  owns Durable Object fanout
```

Convex reference:

- `crates/sync/src/worker.rs`
  - one backend component owns rerun and send work in Convex.

Flarex difference:

- Flarex must expose an adapter-level wake contract because the executor and
  Cloudflare fanout runtime are separate deployable units.

Known limitations:

- The direct delivery callback helper still lives beside the preferred wake
  notifier until examples/tests fully migrate.
- No shared package owns delivery route constants yet.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## DeliveryDO Alarm Boundary

Previous completed checkpoint: `9c160d8` Notify DeliveryDO after live query
reruns.

What changed:

- Alarm continuation is implemented entirely in `flarex-backend`'s
  `DeliveryDO`.
- Executor and executor-http package boundaries did not change.
- `DeliveryDO` stores pending drain metadata in Durable Object storage and
  keeps executor access behind the injected claim/ack HTTP/service-binding
  boundary.

Boundary rule:

```txt
Nitro/executor host
  -> notify wake route once
DeliveryDO
  -> repeat bounded claim/fanout/ack through alarms until no rows remain
executor core
  -> persists and acknowledges durable rows only
```

Convex reference:

- `crates/sync/src/worker.rs`
  - sync worker owns ongoing delivery work in Convex.

Flarex difference:

- Flarex moves repeated fanout work to Cloudflare DO alarms because the trusted
  executor can run on serverless Nitro/Vercel and should not keep a loop alive.

Known limitations:

- No shared observability surface exists yet for pending alarm retry state.
- No Cloudflare Queue abstraction is wired yet; alarms are the first
  per-deployment continuation primitive.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/sync.test.ts -t "continues DeliveryDO"
git diff --check
```

## SchedulerDO Reconciler Boundary

Previous completed checkpoint: `c8f2f93` Continue DeliveryDO drains with
alarms.

What changed:

- `@flarex/persistence-postgres` owns the SQL/PGlite pending-deployment scan.
- `@flarex/executor` exposes the scan as platform behavior.
- `@flarex/executor-http` exposes the authenticated maintenance route.
- `flarex-backend` owns SchedulerDO, cron wiring, and DeliveryDO wake fanout.

Boundary rule:

```txt
executor packages:
  find deployments with durable pending rows
SchedulerDO:
  wake DeliveryDOs only
DeliveryDO:
  claim, fanout, ack
ConnectionDO:
  client socket transition delivery
```

Convex reference:

- `crates/sync/src/worker.rs`
  - one internal worker owns rerun and send work in Convex.

Flarex difference:

- Flarex deliberately keeps the executor framework-neutral and moves repeated
  wake/fanout recovery to Cloudflare Durable Objects.

Known limitations:

- Route constants are still duplicated string literals across packages.
- SchedulerDO has bounded one-page scans; cursor persistence is future work.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter flarex-backend typecheck
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
