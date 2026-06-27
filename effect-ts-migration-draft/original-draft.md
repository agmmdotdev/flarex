Yes — **direct access is the better path** for this refactor. The repos are not code-search indexed, but I can still read concrete files, and for this work we mostly need deterministic file-by-file inspection rather than fuzzy search.

My blunt take: this should **not** be a cosmetic refactor. Flarex backend currently has too much protocol, validation, routing, storage, and orchestration mixed together. The right refactor is to make **schemas and APIs the source of truth**, then build Worker/DO/executor implementations around those contracts using Effect services and Layers.

## Current state I see

`apps/backend` is only a thin Cloudflare Worker wrapper. Its `package.json` depends on `flarex-backend`, and its worker entry just re-exports `ConnectionDO`, `DeliveryDO`, `DeploymentDO`, `ExecutionDO`, `PartitionDO`, `RegistryDO`, `SchedulerDO`, and default from `flarex-backend/worker`.

The current `wrangler.jsonc` manually defines the Worker, DO bindings, SQLite DO migrations, cron trigger, and observability. The DOs are `REGISTRY`, `DEPLOYMENTS`, `PARTITIONS`, `EXECUTIONS`, `CONNECTIONS`, `DELIVERIES`, and `SCHEDULERS`.

`packages/flarex-backend` is already the real backend package. It exports the worker, artifact runtime/store, types, test harness, and sync protocol.  But the main worker is a large hand-written router that parses path segments, reads JSON manually, forwards raw requests to DO stubs, and catches errors with custom helpers.

The current HTTP layer is very small: `HttpError`, `json`, `errorResponse`, `readJson`, and `required`. There is no schema-driven request/response validation here.  The shared backend model is also mostly TypeScript types in `types.ts`, not runtime schemas: `Json`, `ValidatorJson`, `Env`, deployment schema, commits, push protocol, invoke protocol, execution protocol, etc.

The backend DOs are currently Cloudflare `DurableObject` classes with hand-written `fetch()` routers. For example, `DeploymentDO` creates SQL tables in the constructor, routes `/deployment` and `/push/...`, then performs manual validation and state changes.  `PartitionDO` owns transactional document/index/write-log state and also has a hand-written router for `/schema-cache`, `/begin`, `/commit`, `/document`, `/index`, and subscription endpoints.  `ExecutionDO` manages a mutable in-memory session and validates args/returns by calling custom validators from `invoke`/`validation`.

`executor`, `executor-http`, and `freshness` are separate packages already. That is good. But `executor` exposes a plain object factory, `executor-http` uses Elysia and manual request parsing/error mapping, and `freshness` is interface/class/function based rather than Effect service/layer based.

The testing package wraps `flarex-dev` and exposes a friendly imperative testing API. That API can remain, but the internals should move to Effect runtimes/layers.

## Refactor target

The target should be:

```txt
apps/backend
  alchemy.run.ts
  alchemy.stack.ts
  src/
    worker.ts
    resources/
      BackendWorker.ts
      RegistryObject.ts
      DeploymentObject.ts
      PartitionObject.ts
      ExecutionObject.ts
      ConnectionObject.ts
      DeliveryObject.ts
      SchedulerObject.ts

packages/flarex-protocol
  src/
    json/
    validator/
    deployment/
    invoke/
    execution/
    partition/
    sync/
    scheduler/
    errors/
    api/

packages/flarex-backend
  src/
    shared/
      CloudflareEnv.ts
      DoNames.ts
      HttpRuntime.ts
      Json.ts
      Layer.ts
    worker/
      Api.ts
      Handler.ts
      Layer.ts
      index.ts
    registry/
      Api.ts
      Schema.ts
      Service.ts
      Store.ts
      Do.ts
      Client.ts
      Layer.ts
      index.ts
    deployment/
      Api.ts
      Schema.ts
      PushService.ts
      Store.ts
      Do.ts
      Client.ts
      Layer.ts
      index.ts
    partition/
      Api.ts
      Schema.ts
      CommitService.ts
      Store.ts
      Do.ts
      Client.ts
      Layer.ts
      index.ts
    execution/
      Api.ts
      Schema.ts
      SessionService.ts
      Do.ts
      Client.ts
      Layer.ts
      index.ts
    connection/
      Schema.ts
      SyncProtocol.ts
      Service.ts
      Do.ts
      Layer.ts
      index.ts
    delivery/
      Api.ts
      Schema.ts
      Service.ts
      Do.ts
      Client.ts
      Layer.ts
      index.ts
    scheduler/
      Api.ts
      Schema.ts
      ReconcileDeliveries.ts
      ReconcileConnections.ts
      RerunSubscriptions.ts
      DeadLetter.ts
      Do.ts
      Layer.ts
      index.ts
    artifact/
      Store.ts
      Runtime.ts
      Layer.ts
      index.ts
    invoke/
      Service.ts
      Routing.ts
      Validation.ts
      Layer.ts
      index.ts
```

This mirrors the style you like from `t3code`: module folders instead of giant technical buckets. `t3code` already has a monorepo layout with `apps/*`, `packages/*`, and shared catalog versions for Effect 4 beta packages, so it is a good structural reference.

## High-level plan

### 1. Create a schema-first internal protocol package

Do this before moving DOs.

Create `packages/flarex-protocol` or `packages/flarex-internal-protocol`. I prefer `flarex-protocol` because it clearly means “wire protocol,” not “frontend SDK.”

This package owns:

```txt
Json
ValidatorJson
DeploymentSchema
DeploymentAnalysis
DeploymentCodegenAnalysis
PushSourcePackage
PushStatus
InvokeRequest
InvokeResponse
ExecutionStartRequest
ExecutionSyscallRequest
ExecutionFinishRequest
CommitRequest
CommitResponse
ReadSet
StoredDocument
SyncProtocol messages
Scheduler maintenance requests/results
Tagged domain errors
HttpApi definitions
```

Use Effect Schema classes and tagged errors:

```ts
import { Schema } from "effect"

export class DeploymentNotFound extends Schema.TaggedErrorClass<DeploymentNotFound>()(
  "DeploymentNotFound",
  { deploymentId: Schema.String },
) {}

export class InvokeRequest extends Schema.Class<InvokeRequest>("InvokeRequest")({
  path: Schema.String,
  args: Json,
  partitionKey: Schema.optional(Schema.String),
  kind: Schema.optional(BackendFunctionKind),
  idempotencyKey: Schema.optional(Schema.String),
}) {}
```

Effect-smol’s own docs explicitly recommend `Schema.TaggedErrorClass` for custom errors, `Effect.gen` / `Effect.fn`, and service-oriented structure with `Context.Service` + `Layer`.

Important distinction: **do not immediately replace your user-facing `ValidatorJson` DSL**. That DSL is product/domain semantics. Use Effect Schema for transport, service input/output, internal errors, and API contracts. Keep `ValidatorJson` as a schema-encoded value until you intentionally redesign document validation.

### 2. Replace `types.ts` gradually, not in one PR

Right now `types.ts` holds everything: env, schema metadata, deployment records, commits, pushes, invoke, execution, stored docs.

Refactor it into protocol modules:

```txt
flarex-protocol/src/json/Json.ts
flarex-protocol/src/validator/ValidatorJson.ts
flarex-protocol/src/deployment/Schema.ts
flarex-protocol/src/deployment/Push.ts
flarex-protocol/src/invoke/Invoke.ts
flarex-protocol/src/execution/Execution.ts
flarex-protocol/src/partition/Commit.ts
flarex-protocol/src/sync/Protocol.ts
```

Then keep `packages/flarex-backend/src/types.ts` temporarily as a compatibility re-export:

```ts
export * from "flarex-protocol/deployment"
export * from "flarex-protocol/invoke"
export * from "flarex-protocol/partition"
```

That makes the migration incremental.

### 3. Move from hand-written HTTP to Effect HttpApi

Alchemy’s Effect HTTP API docs recommend keeping schemas/API specs outside the Worker so they can be imported by server and typed client, then constructing handlers in Worker init and returning `{ fetch }` as an `HttpEffect`. ([alchemy][1])

For Flarex, define APIs like:

```txt
BackendApi
  HealthGroup
  DeploymentsGroup
  PushGroup
  InvokeGroup
  ExecutionGroup
  PartitionGroup
  SyncGroup
  SchedulerGroup

DeploymentDOApi
  DeploymentGroup
  PushGroup

PartitionDOApi
  PartitionGroup
  SubscriptionGroup

ExecutionDOApi
  ExecutionGroup

SchedulerDOApi
  SchedulerGroup
```

Use `HttpApiEndpoint` for every route, with `payload`, `path`, `urlParams`, `success`, and `error` schemas. The Alchemy docs show this pattern with `HttpApi`, `HttpApiEndpoint`, `HttpApiGroup`, and Effect Schema. ([alchemy][1])

The end state: no route should call `await request.json()` and cast. Schema decoding should happen at the HTTP boundary.

### 4. Use Effect services and Layers as the main backend composition model

Each backend module should have a service class:

```ts
export class DeploymentService extends Context.Service<DeploymentService, {
  startPush(input: StartPushInput): Effect.Effect<PushStatus, DeploymentError>
  finishPush(input: FinishPushInput): Effect.Effect<FinishPushResponse, DeploymentError>
  getActive(input: GetActiveDeploymentInput): Effect.Effect<ActiveDeploymentStatus, DeploymentError>
}>()("flarex-backend/deployment/DeploymentService") {}
```

Each implementation should be supplied by a Layer:

```ts
export const DeploymentServiceLive = Layer.effect(
  DeploymentService,
  Effect.gen(function* () {
    const store = yield* DeploymentStore
    const artifacts = yield* ArtifactStore
    const clock = yield* Clock

    return DeploymentService.of({
      startPush: Effect.fn("DeploymentService.startPush")(function* (input) {
        // ...
      }),
      finishPush: Effect.fn("DeploymentService.finishPush")(function* (input) {
        // ...
      }),
      getActive: Effect.fn("DeploymentService.getActive")(function* (input) {
        // ...
      }),
    })
  }),
)
```

This is exactly the model effect-smol docs recommend for modular/testable code.

## Alchemy plan for `apps/backend`

You are right: **Alchemy belongs in `apps/backend`, not inside `packages/flarex-backend`**. The backend package should remain reusable runtime code. The app package should own deployment resources.

Alchemy v2 uses `alchemy@next` with Effect 4-compatible packages, and its docs show `Alchemy.Stack(...)` with Cloudflare providers/state. ([alchemy][2]) The docs also show deployment through `alchemy deploy`. ([alchemy][2]) Local dev uses `alchemy dev`, and the same stack is used for dev and deploy. ([alchemy][3])

Suggested `apps/backend` layout:

```txt
apps/backend/
  package.json
  alchemy.run.ts
  alchemy.stack.ts
  src/
    worker.ts
    resources/
      BackendWorker.ts
      RegistryObject.ts
      DeploymentObject.ts
      PartitionObject.ts
      ExecutionObject.ts
      ConnectionObject.ts
      DeliveryObject.ts
      SchedulerObject.ts
```

Suggested scripts:

```json
{
  "scripts": {
    "dev": "alchemy dev",
    "deploy": "alchemy deploy",
    "destroy": "alchemy destroy",
    "typecheck": "tsc -p tsconfig.json"
  }
}
```

Keep `wrangler.jsonc` only during transition or for comparison. Once the Alchemy stack is stable, remove or mark it legacy, because two sources of infrastructure truth will bite you later.

Alchemy’s provider docs list Cloudflare Workers resources including `Worker`, `DurableObjectNamespace`, `RpcDurableObjectNamespace`, and `cron`, so the current wrangler concepts map cleanly into Alchemy resources. ([alchemy][2])

## Durable Object strategy

Alchemy’s DO pattern is important: a Durable Object has an outer init Effect and an inner per-instance Effect. The inner instance can return `{ fetch }`, and Effect HTTP can produce that fetch via `HttpApiBuilder.layer(...).pipe(..., HttpRouter.toHttpEffect)`. ([alchemy][4]) ([alchemy][4]) ([alchemy][1])

For Flarex, each DO should follow this shape:

```ts
export default class DeploymentObject extends Cloudflare.DurableObjectNamespace<DeploymentObject>()(
  "DeploymentObject",
  Effect.gen(function* () {
    return Effect.gen(function* () {
      const state = yield* Cloudflare.DurableObjectState

      const storeLayer = DeploymentSqlStore.layer(state.storage.sql)
      const serviceLayer = DeploymentServiceLive.pipe(
        Layer.provide(storeLayer),
        Layer.provide(ArtifactLayer),
        Layer.provide(ClockLayer),
      )

      const handlers = DeploymentHttp.handlers

      return {
        fetch: HttpApiBuilder.layer(DeploymentDOApi).pipe(
          Layer.provide(handlers),
          Layer.provide(serviceLayer),
          HttpRouter.toHttpEffect,
        ),
      }
    })
  }),
) {}
```

Do **not** build DO state layers globally. A DO’s `DurableObjectState`, SQL storage, alarms, and WebSocket state are per-object-instance. Build those layers inside the inner DO init.

Alchemy also supports wrapping a DO stub as an `HttpClient` with `Cloudflare.toHttpClient(stub)`, then using `HttpApiClient.makeWith(...)` so Worker-to-DO calls stay typed instead of raw `stub.fetch(...)`. ([alchemy][1]) That should replace the current raw forwarding in `worker.ts`.

## Module-by-module plan

### `shared`

Create shared infrastructure, not business logic.

Own:

```txt
DoNames.ts          // current routing.ts
CloudflareEnv.ts   // Env schema/bindings
HttpRuntime.ts     // HttpApi -> Response helpers
ErrorMapping.ts
Json.ts
Clock.ts
Ids.ts
```

Move `routing.ts` into `shared/DoNames.ts`; current object naming is good and reusable.

### `worker`

Current `worker.ts` should become a thin composition module. It should no longer contain deployment push logic, analyzer logic, partition routing, scheduler routing, live query delivery auth, or invoke execution.

Responsibilities after refactor:

```txt
worker/Api.ts       // public HTTP API
worker/Handler.ts   // handlers that call services / DO typed clients
worker/Layer.ts     // Worker dependencies
worker/index.ts
```

Replace routes like `/deployments/:id/push/start`, `/deployments/:id/executions/start`, `/deployments/:id/partitions/:key/commit`, etc. with `HttpApiEndpoint` declarations. The old raw router currently branches over these paths directly.

### `registry`

This is the easiest first DO migration.

Current state: `RegistryDO` has a small SQL table and only supports creating/listing deployments.

Target files:

```txt
registry/Schema.ts
registry/Api.ts
registry/Store.ts
registry/Service.ts
registry/Do.ts
registry/Client.ts
registry/Layer.ts
```

Plan:

1. Define `CreateDeploymentRequest`, `DeploymentRecord`, `ListDeploymentsResponse` as Schema classes.
2. Move SQL access into `RegistryStore`.
3. Move business logic into `RegistryService`.
4. Implement `RegistryDOApi`.
5. Replace public Worker forwarding with typed client call to `RegistryDOApi`.

### `deployment`

This is high-value and medium-risk.

Current state: `DeploymentDO` owns deployment SQL schema, push state, active deployment metadata, schema application, function metadata application, validation, and artifact reference checks.

Target files:

```txt
deployment/Schema.ts
deployment/Api.ts
deployment/PushService.ts
deployment/DeploymentStore.ts
deployment/FunctionMetadata.ts
deployment/SchemaValidation.ts
deployment/ArtifactActivation.ts
deployment/Do.ts
deployment/Client.ts
deployment/Layer.ts
```

Plan:

1. Convert `PushSourcePackage`, `DeploymentAnalysis`, `DeploymentCodegenAnalysis`, `PushStatus`, `FinishPushResponse` to Effect Schema.
2. Move `validateAnalysis`, `validateCodegenAnalysis`, `validateSchema`, `validateFunctions`, and push-state parsing out of the DO class.
3. Move SQL persistence into `DeploymentStore`.
4. Keep activation transaction semantics identical.
5. Make `DeploymentService.finishPush` return typed success or typed rejection instead of throwing generic `HttpError`.
6. Add tests for failed/analyzed/activated/superseded/abandoned transitions before changing behavior.

### `partition`

This is the hardest DO because it owns the real transactional data model.

Current state: `PartitionDO` stores schema cache, documents, indexes, partition owners, write log, idempotency keys, and sync subscriptions, then validates and commits writes transactionally.

Target files:

```txt
partition/Schema.ts
partition/Api.ts
partition/PartitionStore.ts
partition/CommitService.ts
partition/ReadService.ts
partition/IndexService.ts
partition/SubscriptionService.ts
partition/PlacementValidation.ts
partition/Do.ts
partition/Client.ts
partition/Layer.ts
```

Plan:

1. First only wrap the existing commit/read logic with schemas. Do not rewrite SQL and OCC logic at the same time.
2. Extract store methods:

   * `getCurrentTs`
   * `getSchemaVersion`
   * `putSchemaCache`
   * `readDocument`
   * `readIndex`
   * `commit`
   * `registerSubscription`
   * `unregisterSubscription`
3. Extract validation:

   * document validator
   * placement validator
   * ID validator
   * partition owner validator
4. Keep `ctx.storage.transaction` at the service/store boundary.
5. Make OCC conflicts tagged errors instead of special-cased raw objects.
6. Add property-style tests around idempotency, write ordering, index entries, partition owner uniqueness, and stale read-set conflict detection.

### `execution`

Current state: `ExecutionDO` stores one active session in memory, validates function args/returns, starts a `SingleShardTransaction`, handles syscalls, then commits or returns read sets.

Target files:

```txt
execution/Schema.ts
execution/Api.ts
execution/SessionState.ts
execution/SessionService.ts
execution/SyscallService.ts
execution/Do.ts
execution/Client.ts
execution/Layer.ts
```

Plan:

1. Make execution protocol schema-first: start/syscall/finish/abort.
2. Keep the mutable session, but isolate it in `SessionState`.
3. Make syscalls typed and tagged.
4. Inject transaction creation through a service, not direct static calls.
5. Eventually make `ExecutionDO` a small host around `SessionService`.

### `invoke`

The invoke module should become pure orchestration.

Own:

```txt
invoke/FunctionMetadata.ts
invoke/PartitionRouting.ts
invoke/Validation.ts
invoke/LocalRuntime.ts
invoke/ArtifactRuntime.ts
invoke/Service.ts
```

Plan:

1. Keep current local `executeInvoke` path.
2. Keep artifact-runtime invocation path.
3. Hide both behind `InvokeService`.
4. Worker handlers should call `InvokeService.invoke(...)`, not know whether execution is local, artifact runtime, executor service, or DO session.
5. Use Effect Layers to select implementation:

   * `InvokeServiceLocal`
   * `InvokeServiceArtifactRuntime`
   * `InvokeServiceExecutorHttp`
   * `InvokeServiceTest`

### `connection`

Do not try to force the WebSocket upgrade itself into Effect HttpApi. That would be the wrong abstraction. Keep a custom fetch branch for `Upgrade: websocket`.

But internal routes should become schema-validated:

```txt
/invalidate
/deliver/live-query
/force-reconnect
/heartbeat
```

Current `ConnectionDO` handles WebSocket state, query-set modifications, mutation execution, live-query delivery, and heartbeat lease management.

Target files:

```txt
connection/Schema.ts
connection/SyncProtocol.ts
connection/ConnectionState.ts
connection/ConnectionService.ts
connection/LiveQueryService.ts
connection/Do.ts
connection/Layer.ts
```

Plan:

1. Convert `syncProtocol` messages to Effect Schema.
2. Keep WebSocket event handlers in the DO host.
3. Move message handling into `ConnectionService`.
4. Move live-query rerun/delivery logic into `LiveQueryService`.
5. Validate inbound client messages with Schema before switching on `message.type`.

### `delivery`

The delivery module should own delivery queues/draining/wake/dead-letter behavior. It should not leak scheduler implementation details.

Target:

```txt
delivery/Schema.ts
delivery/Api.ts
delivery/DeliveryService.ts
delivery/DrainService.ts
delivery/Do.ts
delivery/Client.ts
```

Use tagged errors for:

```txt
DeliveryClaimError
DeliveryAckError
DeliveryDeadLetterError
DeliveryWakeError
```

### `scheduler`

Current `SchedulerDO` is large and mixes request parsing, pending continuation state, retry policy, alarm orchestration, executor calls, and delivery/connection cleanup.

Target files:

```txt
scheduler/Schema.ts
scheduler/Api.ts
scheduler/ReconcileDeliveries.ts
scheduler/ReconcileConnections.ts
scheduler/RerunSubscriptions.ts
scheduler/DeadLetterDeliveries.ts
scheduler/AlarmService.ts
scheduler/PendingStateStore.ts
scheduler/Do.ts
scheduler/Layer.ts
```

Plan:

1. Define all scheduler request/result schemas.
2. Extract pending continuation storage.
3. Extract retry/backoff policy.
4. Use `Clock` instead of `Date.now()` where possible.
5. Keep DO alarms, but make the alarm handler call services.
6. Make scheduler service independent from the DO host so it can be unit tested.

Effect-smol docs specifically recommend Effect DateTime/Clock-oriented code for testable current time instead of direct `Date` / `Date.now`.

### `artifact`

Current worker constructs artifact store/runtime from Env directly.

Target:

```txt
artifact/ArtifactStore.ts
artifact/ArtifactRuntime.ts
artifact/AnalyzerClient.ts
artifact/Layer.ts
```

Plan:

1. Make `ArtifactStore` a service.
2. Make `AnalyzerClient` a service.
3. Make `ArtifactRuntime` a service.
4. Worker/deployment logic should depend on services, not raw env.

### `executor`

Current `createFlarexExecutor(config)` returns a large object delegating to functions over `persistence`, `clock`, `ids`, and `liveQueryInvalidation`.

Target:

```txt
packages/executor/src/
  Executor.ts
  ExecutorLayer.ts
  Persistence.ts
  Clock.ts
  Ids.ts
  deployments/
  functions/
  invoke/
  sessions/
  live-query/
  outbox/
  maintenance/
  retry/
```

Plan:

1. Define `Executor` as `Context.Service`.
2. Preserve `createFlarexExecutor(config)` as a compatibility facade.
3. Internally implement executor methods with `Effect.fn`.
4. Wrap existing promise-based persistence with `Effect.promise` first.
5. Later migrate persistence interfaces to return `Effect` directly.

This gives you the new architecture without breaking current callers.

### `executor-http`

This should move from Elysia to Effect HttpApi.

Current `executor-http` depends on Elysia and manually registers many POST routes.   It also repeats JSON parsing and bad-request handling in each handler.

Target:

```txt
packages/executor-http/src/
  Api.ts
  Schema.ts
  ErrorMapping.ts
  Handler.ts
  Layer.ts
  index.ts
```

Plan:

1. Define `ExecutorHttpApi`.
2. Define all endpoint schemas:

   * `/health`
   * `/invoke/prepare`
   * `/invoke/start`
   * `/invoke/syscall`
   * `/invoke/finish`
   * `/invoke/abort`
   * `/invoke/abort-stale`
   * maintenance routes
   * live-query routes
3. Implement handlers with `HttpApiBuilder.group`.
4. Keep `createFlarexHttpHandler(config)` returning `(request) => Promise<Response>` for compatibility.
5. Remove Elysia after parity tests pass.

### `freshness`

Current `freshness` has a good conceptual boundary: outbox events, mirror store, read-set freshness checks, memory store, durable persistence adapter.

Target:

```txt
packages/freshness/src/
  Schema.ts
  FreshnessStore.ts
  FreshnessService.ts
  MemoryLayer.ts
  PersistenceLayer.ts
  Errors.ts
  index.ts
```

Plan:

1. Convert event keys, freshness versions, read sets, status, stale/unsupported dependencies to Schema.
2. Make `FreshnessStore` an Effect service.
3. Make `MemoryFreshnessMirrorStore` a Layer.
4. Make durable/postgres freshness store a Layer.
5. Keep promise facade exports for compatibility.

### `flarex-test`

Current `flarex-test` is useful and should not be thrown away. It creates a dev runtime, exposes query/mutation/action helpers, fetch, reload/reset/dispose, and a WebSocket constructor.

Refactor target:

```txt
packages/flarex-test/src/
  TestRuntime.ts
  TestLayer.ts
  TestClient.ts
  WebSocket.ts
  Errors.ts
  index.ts
```

Plan:

1. Keep public API compatible.
2. Internally create an Effect `ManagedRuntime`.
3. Provide `TestClock`, `TestIds`, `TestExecutor`, `TestBackend`, `TestFreshness`.
4. Add `@effect/vitest` tests for services, not only integration.
5. Add Alchemy test mode later for `apps/backend` resource-level tests. Alchemy docs show a dev test harness pattern where `Test.make({ providers, state, dev: true })` runs workers locally with workerd. ([alchemy][3])

## Step-by-step implementation order

### Phase 0 — lock behavior with tests

Before refactoring:

1. Add backend golden tests for:

   * `/health`
   * create/list deployment
   * push start-analyzed
   * push finish
   * active deployment read
   * partition schema-cache
   * partition begin/commit/document/index
   * execution start/syscall/finish
   * scheduler reconcile routes
   * connection heartbeat/internal delivery routes

2. Add executor-http parity tests:

   * valid request
   * invalid JSON
   * schema-invalid body
   * unauthorized capability token
   * known executor errors
   * unknown errors

3. Add freshness tests:

   * idempotent event processing
   * stale document
   * stale table
   * unsupported index freshness

Do not start the structural refactor until these pass.

### Phase 1 — introduce `flarex-protocol`

Add schemas and re-export old types from schemas:

```ts
export type InvokeRequest = Schema.Schema.Type<typeof InvokeRequest>
```

Keep old imports working. Start converting only boundary parsing to schemas.

### Phase 2 — add Effect services beside existing code

Do not move files yet. Add services next to current modules:

```txt
deploymentService.ts
partitionService.ts
executionService.ts
registryService.ts
schedulerService.ts
```

Initially they can call existing functions/methods. The goal is to create the service boundaries first.

### Phase 3 — module folder move

Move files into module folders without changing behavior. This is mostly import churn.

Example:

```txt
deploymentDO.ts -> deployment/Do.ts
partitionDO.ts  -> partition/Do.ts
routing.ts      -> shared/DoNames.ts
http.ts         -> shared/Http.ts
```

Keep public package exports stable.

### Phase 4 — convert public Worker to HttpApi

Replace the giant `route()` function with `BackendApi`.

The Worker should become:

```ts
fetch: HttpApiBuilder.layer(BackendApi).pipe(
  Layer.provide(backendHandlers),
  Layer.provide(AppLayer),
  Layer.provide(HttpPlatform.layer),
  HttpRouter.toHttpEffect,
)
```

The handler should call typed DO clients, not raw `stub.fetch(...)`.

### Phase 5 — convert DOs one at a time

Order:

1. `RegistryDO`
2. `DeploymentDO`
3. `ExecutionDO`
4. `PartitionDO`
5. `DeliveryDO`
6. `SchedulerDO`
7. `ConnectionDO`

`ConnectionDO` last because WebSockets make it special.

### Phase 6 — refactor executor and freshness

Convert `freshness` first because it is smaller and mostly pure.

Then convert `executor` to services/layers but preserve `createFlarexExecutor(config)`.

Then convert `executor-http` from Elysia to Effect HttpApi.

### Phase 7 — add Alchemy stack in `apps/backend`

Create:

```txt
apps/backend/alchemy.run.ts
apps/backend/alchemy.stack.ts
apps/backend/src/resources/*.ts
```

Map current `wrangler.jsonc` resources:

```txt
Worker              -> Cloudflare.Worker
REGISTRY            -> DurableObjectNamespace / resource class
DEPLOYMENTS         -> DurableObjectNamespace / resource class
PARTITIONS          -> DurableObjectNamespace / resource class
EXECUTIONS          -> DurableObjectNamespace / resource class
CONNECTIONS         -> DurableObjectNamespace / resource class
DELIVERIES          -> DurableObjectNamespace / resource class
SCHEDULERS          -> DurableObjectNamespace / resource class
ARTIFACTS           -> R2 bucket if needed
cron */1 * * * *    -> Cloudflare Worker cron resource/config
observability       -> Worker observability config
```

Do this after the Worker/DO resource classes exist. Do not put Alchemy stack code into backend packages.

### Phase 8 — remove legacy helpers

After everything routes through schemas:

Remove or shrink:

```txt
http.ts
types.ts
manual parse* functions in executor-http
ad-hoc HttpError usage
raw DO fetch client helpers
```

Keep small compatibility exports only where external packages depend on them.

## Reusability rules

### Shared schemas

One schema should be used for:

```txt
HTTP body validation
DO internal calls
executor-http routes
tests
typed clients
OpenAPI generation later
```

Do not duplicate request/response interfaces in `backend`, `executor-http`, and `test`.

### Shared DO clients

For every DO API, create a client factory:

```ts
DeploymentClient.forStub(stub)
PartitionClient.forStub(stub)
ExecutionClient.forStub(stub)
SchedulerClient.forStub(stub)
```

Internally use `Cloudflare.toHttpClient(stub)` + `HttpApiClient.makeWith(...)`. Alchemy documents this exact Worker-to-DO typed-client bridge. ([alchemy][1])

### Shared errors

Use tagged errors:

```txt
BadRequest
Unauthorized
NotFound
Conflict
OccConflict
ValidationError
DeploymentNotFound
PushInvalidState
ExecutionSessionAlreadyActive
ExecutionSessionNotStarted
PartitionPlacementError
```

Then map errors to HTTP status once.

### Shared services

Use these cross-cutting services:

```txt
Clock
Ids
Logger/Telemetry
CloudflareBindings
DoNamespaces
ArtifactStore
ArtifactRuntime
AnalyzerClient
ExecutorClient
FreshnessStore
LiveQueryDeliveryNotifier
```

This avoids passing `env`, `Date.now`, `crypto.randomUUID`, and raw stubs everywhere.

## Design cautions

Do **not** convert the frontend SDK during this refactor. Keep `packages/flarex` stable. If it needs new protocol schemas later, expose them deliberately, not by leaking backend internals.

Do **not** put Alchemy stack/resource code inside `packages/flarex-backend`. That package should be runtime/library code. `apps/backend` should be the only infrastructure app.

Do **not** rewrite `PartitionDO` SQL and switch to Effect HttpApi in the same step. That is too risky. First wrap with schemas, then extract services, then improve internals.

Do **not** pretend WebSockets are normal HTTP. Keep the WebSocket upgrade path custom, but validate the sync messages with Effect Schema.

Do **not** duplicate `ValidatorJson` and Effect Schema responsibilities. Effect Schema validates Flarex transport/contracts. `ValidatorJson` validates user documents/functions unless you intentionally redesign that DSL.

## Suggested PR breakdown

1. `protocol: add schema-first internal contracts`
2. `backend: add shared effect services and compatibility re-exports`
3. `backend: move modules into feature folders`
4. `backend: convert registry api/do to Effect HttpApi`
5. `backend: convert deployment api/do to Effect HttpApi`
6. `backend: convert worker public api to Effect HttpApi`
7. `backend: convert execution api/do to Effect HttpApi`
8. `backend: convert partition api/do boundary to Effect HttpApi`
9. `freshness: convert to Effect service/layers`
10. `executor: add Effect Executor service and compatibility facade`
11. `executor-http: replace Elysia with Effect HttpApi`
12. `test: refactor flarex-test runtime around Effect layers`
13. `apps/backend: add Alchemy stack/resources/dev`
14. `cleanup: remove legacy http/types/manual parsers`

My recommendation: start with `RegistryDO` and `executor-http` schemas as proof-of-pattern. `RegistryDO` is small enough to validate the DO architecture. `executor-http` gives immediate payoff because it currently repeats manual JSON parsing/error handling across many routes.

[1]: https://v2.alchemy.run/guides/effect-http-api/ "Effect HTTP API | alchemy"
[2]: https://v2.alchemy.run/getting-started/ "Getting Started | alchemy"
[3]: https://v2.alchemy.run/tutorial/part-4 "Part 4: Local Dev | alchemy"
[4]: https://v2.alchemy.run/tutorial/cloudflare/durable-objects/ "Add a Durable Object | alchemy"
