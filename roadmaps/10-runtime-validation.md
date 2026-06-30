# Runtime Validation

## Invoke Query Planning Typed Failure Boundary

Previous completed checkpoint: this commit, `Type invoke query planning`.

What changed:

- Invoke query planning now emits typed failures for missing `withIndex`,
  unknown indexes, invalid index range expressions, and non-unique `unique()`
  results.
- Named Effect helpers back index requirement, index metadata resolution,
  bounds derivation, and unique-result validation.
- Direct tests cover typed query planning failure channels before adapter
  mapping.

Why it changed:

Function, document, placement, and partition validation were typed, but query
planning still threw adapter-shaped HTTP errors from the backend query API.
This checkpoint keeps deterministic query planning failures typed while leaving
actual index page execution unchanged.

Known limitations:

- Mutation commit and PartitionDO request failures still use the existing
  compatibility paths.
- Public Worker invoke routing and artifact-runtime routing are unchanged.

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

- Invoke execution-scope resolution now emits typed partition validation
  failures for missing metadata, route conflicts, table placement mismatches,
  field/selector mismatches, invalid args, partitionKey mismatches, invalid
  create-root preallocated ids, and caller-supplied create-root partition keys.
- Named Effect helpers back function scope resolution, create-root resolution,
  partition policy validation, and partition key extraction from args.
- Direct tests cover typed partition failure channels before adapter mapping.

Why it changed:

Document and function validation were typed, but partition scope validation
still threw `HttpError` from domain logic. This checkpoint keeps those
deterministic invoke validation failures typed while preserving the existing
sync wrapper used by direct invoke and `ExecutionDO`.

Known limitations:

- Query/index planning is a separate follow-up completed by the next
  checkpoint; mutation commit and PartitionDO request failures still use the
  existing compatibility paths.
- Public Worker invoke routing and artifact-runtime routing are unchanged.

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

- Invoke table lookup, document id parsing, document table lookup, document id
  table validation, document validator failures, document placement failures,
  query placement failures, and missing patch targets now have typed failure
  classes.
- `invoke.ts` exposes named Effect helpers for those validation branches while
  the existing DB-facing Promise API maps typed failures to the same
  `HttpError` compatibility shape.
- Direct invoke tests cover typed document/table/placement failure channels
  before adapter mapping.

Why it changed:

The previous invoke checkpoint typed function, argument, and return validation,
but document and placement checks still threw HTTP adapter errors from the
backend invoke service. This checkpoint keeps those validation decisions typed
without changing transaction or PartitionDO behavior.

Known limitations:

- Partition scope validation is a separate follow-up completed by the next
  checkpoint; query/index planning, mutation commit, and PartitionDO request
  failures still use the existing compatibility paths.
- Public Worker invoke routing and artifact-runtime routing are unchanged.

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

- Top-level invoke function resolution now emits typed failures for active
  metadata lookup, function lookup, unsupported function kind, metadata/handler
  kind mismatch, request kind mismatch, and argument validation.
- Return validation now has a typed `validateReturnEffect(...)` path used by
  `executeInvoke(...)` before the Promise adapter maps failures to `HttpError`.
- Direct invoke tests cover the typed Effect failure channels before adapter
  mapping.

Why it changed:

`executeInvoke(...)` had moved behind typed public request decoders, but its
core validation path still threw adapter-shaped `HttpError` values for domain
validation. This checkpoint makes the invoke validation service boundary typed
while preserving the existing Promise API and HTTP response envelope.

Known limitations:

- Query planning, transaction commit, and PartitionDO request failures still
  use the existing compatibility paths.
- Public Worker invoke routing and artifact-runtime routing are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Executor HTTP Live Query Body Effect Decoders

Previous completed checkpoint: `8d99add` Decode executor invoke bodies with
Effect.

What changed:

- Executor HTTP live-query and maintenance POST bodies now have exported
  Effect-returning decoders.
- All remaining live-query executor HTTP handlers now use the decoder-based
  Effect adapter instead of passing parser unions directly to the route
  adapter.
- Direct decoder tests cover typed success and typed validation failure
  channels before HTTP adapter mapping.

Why it changed:

This completes the executor-http request-body decoder migration begun by the
invoke lifecycle checkpoint. The trusted executor adapter now has typed JSON
read, typed body validation, typed executor operation failures, and one HTTP
mapping edge for all POST body routes.

Known limitations:

- Successful executor-http payload validation still uses the existing
  compatibility parser logic behind the Effect decoder boundary rather than
  Effect Schema.
- Backend Worker/DO route-service hotspots remain separate follow-up work.
- PartitionDO SQL/OCC behavior and `ValidatorJson` are untouched.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test -- --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Executor HTTP Invoke Body Effect Decoders

Previous completed checkpoint: `3675397` Name generated worker JSON failures.

What changed:

- Executor HTTP invoke lifecycle POST bodies now have exported
  Effect-returning body decoders.
- Invoke prepare, start, syscall, finish, abort, abort-stale, and
  invoke-session maintenance handlers use the decoder-based Effect adapter.
- Direct decoder tests now cover typed success and typed validation failure
  channels before the adapter maps failures back to existing HTTP responses.

Why it changed:

This moves the migration back from generated-worker compatibility cleanup to a
true route/service Effect boundary. The request JSON read was already typed;
this checkpoint moves a coherent group of route body validation into typed
Effect decoder channels while preserving the executor HTTP adapter edge.

Known limitations:

- The remaining executor HTTP live-query and maintenance POST routes still use
  the parser-backed compatibility adapter.
- This does not introduce Effect Schema for executor HTTP payloads yet.
- PartitionDO SQL/OCC behavior and `ValidatorJson` are untouched.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test -- --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/executor-http build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Deployment Artifact Ref Effect Boundary

Previous completed checkpoint: `8990f06` Share dev response JSON reads.

What changed:

- Execution-artifact ref generation now emits typed
  `DeploymentArtifactRefError` failures.
- `DeploymentArtifacts` now uses `Effect.tryPromise(...)` at the async
  artifact-ref boundary.
- Deployment finish HTTP mapping preserves the adapter edge by converting this
  typed service failure to a deployment storage-class response.

Why it changed:

Deployment finish was still running artifact ref generation through an
untyped promise boundary. This checkpoint keeps finish-push validation and
storage behavior intact while making the remaining backend runtime async
failure explicit in the Effect channel.

Known limitations:

- Generated worker source still uses plain JavaScript helpers.
- PartitionDO SQL/OCC behavior remains untouched.
- Artifact ref payload validation remains owned by `flarex/artifacts`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Flarex Dev Response JSON Shared Boundary

Previous completed checkpoint: `8e89a84` Type backend response JSON reads.

What changed:

- `flarex-dev` response body reads now share
  `readDevResponseJsonEffect(...)` and
  `readDevResponseJsonOrNullEffect(...)`.
- Malformed dev/runtime response JSON now has a typed
  `DevResponseJsonError` source before compatibility fallback.
- Backend push/analyzer/finish, execution artifact, and materialized artifact
  response decoders all use the shared boundary.

Why it changed:

The backend response-read checkpoint removed duplicated fallbacks from
`flarex-backend`. The dev package still had the same fallback pattern in its
Effect response decoders. This keeps validation moving across package
boundaries without changing generated workers or PartitionDO correctness
logic.

Known limitations:

- Successful response payloads still use existing compatibility parsers/casts.
- Generated worker source still uses plain JavaScript helpers.
- PartitionDO SQL/OCC behavior remains untouched.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-dev/vitest.config.ts packages/flarex-dev/test/responseJson.test.ts packages/flarex-dev/test/backendPush.test.ts packages/flarex-dev/test/executionArtifact.test.ts packages/flarex-dev/test/runtimeMaterializer.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Backend Response JSON Effect Boundary

Previous completed checkpoint: `47af99a` Type SchedulerDO route operation
failures.

What changed:

- Backend HTTP response body reads now share
  `readResponseJsonEffect(...)` and `readResponseJsonOrNullEffect(...)` from
  `http.ts`.
- Malformed backend response JSON now has a typed `ResponseJsonError` source
  before compatibility fallback.
- Analyzer, artifact runtime service-binding, live-query delivery, scheduler
  response, and partition transaction response decoders all use the same
  boundary.

Why it changed:

Several migrated response decoders still used anonymous
`Effect.promise(() => response.json().catch(() => null))` helpers. This
checkpoint keeps the old `null` fallback behavior for malformed error bodies,
but moves the actual response JSON read into a typed Effect boundary that later
slices can decide to handle more strictly.

Known limitations:

- Successful response payloads still use existing compatibility casts/parsers.
- PartitionDO SQL/OCC behavior and transaction correctness logic are not
  changed.
- Deployment runtime artifact-ref generation and flarex-dev response readers
  remain separate follow-up surfaces.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/httpResponseJson.test.ts packages/flarex-backend/test/push.test.ts packages/flarex-backend/test/artifactRuntime.test.ts packages/flarex-backend/test/liveQueryDelivery.test.ts packages/flarex-backend/test/schedulerResponses.test.ts packages/flarex-backend/test/transaction.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## SchedulerDO Route Operation Effect Boundary

Previous completed checkpoint: `4f2a30d` Type ExecutionDO route operation
failures.

What changed:

- `SchedulerDO` route operations now emit typed
  `SchedulerRouteOperationError` failures after request decoding succeeds.
- Reconcile, cleanup, rerun, dead-letter, and continuation routes now run one
  Effect pipeline per route and map typed request and operation failures at the
  Durable Object adapter edge.
- Post-decode route work now uses `Effect.tryPromise(...)` instead of untyped
  `Effect.promise(...)`.

Why it changed:

The scheduler route bodies already decoded through typed Effect boundaries, but
the route helpers still converted decode failures into `Response` values inside
the pipeline and ran orchestration work through an untyped promise wrapper.
This keeps HTTP response conversion at one adapter edge while preserving
scheduler continuation and retry behavior.

Known limitations:

- Scheduler internals still use existing `HttpError` compatibility failures for
  executor/service response parsing and stored continuation validation.
- Alarm execution is a background-event boundary and remains separate from the
  HTTP route adapter.
- PartitionDO SQL/OCC behavior remains a separate migration surface.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/schedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## ExecutionDO Route Operation Effect Boundary

Previous completed checkpoint: `49cfca6` Type DeliveryDO route operation
failures.

What changed:

- `ExecutionDO` start, syscall, and finish route operations now emit typed
  `ExecutionRouteOperationError` failures after request decoding succeeds.
- `/start`, `/syscall`, and `/finish` now run one Effect pipeline per route and
  map typed request, protocol, and operation failures at the Durable Object
  adapter edge.
- Post-decode route work now uses `Effect.tryPromise(...)` instead of untyped
  `Effect.promise(...)`.

Why it changed:

The execution route bodies already decoded through typed Effect boundaries,
but the route helpers still converted those failures to `HttpError` inside the
pipeline and ran execution work through an untyped promise adapter. This keeps
the existing `invokeErrorResponse(...)` public shape while making the route
failure channel typed until the adapter edge.

Known limitations:

- Execution start/syscall/finish internals still use existing `HttpError`
  compatibility failures inside `ExecutionDO`.
- Partition request failures from transaction calls still preserve their
  structured status/body through the existing `invokeErrorResponse(...)`
  mapping.
- Abort remains a bodyless route and is not converted in this checkpoint.
- PartitionDO SQL/OCC behavior remains a separate migration surface.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionSyscallRouteBoundary.test.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts packages/flarex-backend/test/executionRouteOperationError.test.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/transaction.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## DeliveryDO Route Operation Effect Boundary

Previous completed checkpoint: `ef864c0` Type ConnectionDO route operation
failures.

What changed:

- `DeliveryDO` wake and pending-drain continuation route operations now emit
  typed `DeliveryRouteOperationError` failures for post-decode defects.
- `/wake` and `/continue` now run one Effect pipeline per route and map typed
  request, operation, and structured drain failures at the Durable Object
  adapter edge.
- Post-decode route work now uses `Effect.tryPromise(...)` instead of untyped
  `Effect.promise(...)`.

Why it changed:

The delivery wake body already decoded through a typed Effect boundary, but the
drain execution still ran through an untyped promise adapter with local catch
logic. This keeps the existing drain workflow intact while moving HTTP response
conversion to one route adapter edge.

Known limitations:

- Delivery claim, fanout, ack, retry, and alarm internals remain the existing
  `DeliveryDO` workflow.
- PartitionDO SQL/OCC behavior and ExecutionDO route execution remain separate
  migration surfaces.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deliveryRouteBoundary.test.ts packages/flarex-backend/test/publicDeliveryWakeRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## ConnectionDO Route Operation Effect Boundary

Previous completed checkpoint: `395d1d9` Type Worker pass-through dispatch
failures.

What changed:

- `ConnectionDO` invalidation and live-query delivery route operations now emit
  typed `ConnectionRouteOperationError` failures.
- `/invalidate` and `/deliver/live-query` now run one Effect pipeline per route
  and map typed request/operation failures at the Durable Object adapter edge.
- Post-decode route work now uses `Effect.tryPromise(...)` instead of untyped
  `Effect.promise(...)`.

Why it changed:

The connection route bodies already decoded through typed Effect boundaries,
but the route helpers still converted validation failures inside the pipeline
and ran stateful route work as untyped promises. This moves the HTTP response
conversion to one adapter edge for the route while preserving the existing
ConnectionDO session and WebSocket behavior.

Known limitations:

- WebSocket message handling, heartbeat, force-reconnect, executor calls, and
  partition subscription fetches remain separate migration surfaces.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/connectionRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Worker Pass-Through Dispatch Effect Boundary

Previous completed checkpoint: `de9e3ee` Type public invoke and partition
dispatch failures.

What changed:

- Top-level Worker pass-through routes now emit `PublicWorkerDispatchError`
  for registry deployments, active deployment reads, connection sync
  forwarding, and deployment scheduler forwarding.
- Those routes now use named `Effect.fn` helpers with `Effect.tryPromise(...)`
  instead of returning direct Durable Object `fetch(...)` promises.
- The Worker adapter maps dispatch failures back to the existing HTTP behavior.

Why it changed:

After public invoke, partition, scheduler, deployment push, delivery, and
execution routes moved to typed dispatch boundaries, these direct pass-through
routes were the remaining Worker route handoffs that could defect outside the
typed error channel. This closes the Worker adapter dispatch gap before moving
back to deeper route/service conversions.

Known limitations:

- Scheduled event `ctx.waitUntil(...)` fanout remains a background-event
  boundary, not an HTTP route response boundary.
- RegistryDO, DeploymentDO, ConnectionDO, and SchedulerDO internals remain
  separate migration surfaces.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts packages/flarex-backend/test/registryDO.test.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/sync.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Public Invoke And Partition Dispatch Effect Boundary

Previous completed checkpoint: `0a9faee` Type public deployment push dispatch
failures.

What changed:

- Public invoke execution dispatch now emits `PublicWorkerDispatchError` for
  invoke runtime forwarding failures after JSON/protocol decoding and
  deployment-id resolution.
- Public partition begin, document read, and index read forwarding now run
  through named `Effect.fn` helpers instead of returning direct
  `partition.fetch(...)` promises.
- The Worker invoke and partition adapter edges map those dispatch failures
  back to the existing HTTP behavior.

Why it changed:

The public Worker route groups had already moved their body-decoding branches
to typed Effect boundaries, but invoke execution and partition read/begin
forwarding were still untyped async handoffs. This checkpoint closes that
remaining Worker dispatch gap without changing runtime or PartitionDO logic.

Known limitations:

- Invoke runtime errors still map through the existing `invokeErrorResponse`.
- PartitionDO SQL/OCC behavior and document/index response validation remain
  separate migration surfaces.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts packages/flarex-backend/test/partitionRouteBoundary.test.ts packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/transaction.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Public Deployment Push Dispatch Effect Boundary

Previous completed checkpoint: `2871d1d` Type public scheduler dispatch
failures.

What changed:

- Public deployment push forwarding routes now emit
  `PublicWorkerDispatchError` for downstream Deployment DO, analyzer, and
  artifact-storage failures.
- Push status reads, source-only start analysis, analyzed artifact persistence,
  finish artifact verification, and start/start-analyzed/finish/abandon
  forwarding now use `Effect.tryPromise(...)` instead of untyped
  `Effect.promise(...)` or direct Worker `fetch(...)`.
- The Worker deployment-push adapter maps typed dispatch failures back to the
  existing HTTP behavior while preserving protocol validation pass-through.

Why it changed:

Deployment push request bodies were already on typed Effect decoders, but the
public route still had untyped async forwarding defects after decoding. This
keeps the full public push route family in the typed route error channel and
keeps HTTP conversion at the Worker adapter edge.

Known limitations:

- DeploymentDO push state transitions and analyzer response decoding are still
  separate boundaries.
- Missing analyzer configuration intentionally remains the existing `501`
  response rather than a dispatch failure.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Public Scheduler Dispatch Effect Boundary

Previous completed checkpoint: `f38ff04` Type live query delivery
authorization.

What changed:

- Public scheduler forwarding routes now emit `PublicWorkerDispatchError` for
  downstream scheduler service-binding failures.
- Delivery reconcile, connection reconcile, dead-letter delivery, cleanup
  connections, rerun subscriptions, and trigger subscriptions helpers now use
  `Effect.tryPromise(...)` instead of untyped `Effect.promise(...)`.
- The Worker scheduler adapter maps the typed dispatch failure back to the
  existing HTTP behavior.

Why it changed:

After authorization and body decoding moved into typed Effect route helpers,
scheduler forwarding remained the last untyped failure point in that route
group. Typed dispatch failures keep service-binding failures explicit and keep
HTTP conversion at the Worker adapter edge.

Known limitations:

- SchedulerDO internals and scheduler response parsing remain their existing
  separate boundaries.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts packages/flarex-backend/test/publicSchedulerRouteBoundary.test.ts packages/flarex-backend/test/sync.test.ts -t "public Worker route dispatch errors|public scheduler route boundary|unauthorized live query|live query delivery reconcile|live query connection cleanup|live query subscriptions" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Public Live Query Authorization Effect Boundary

Previous completed checkpoint: `8491c10` Type public Worker dispatch failures.

What changed:

- Public live-query delivery authorization now flows through
  `PublicLiveQueryDeliveryAuthorizationError`.
- Public scheduler control routes, public live-query delivery, and public
  DeliveryDO wake route helpers yield the typed authorization check before body
  decoding.
- Existing `401` responses are preserved by mapping the typed authorization
  error at the Worker adapter edge.

Why it changed:

The migrated public route helpers should own their boundary checks in the
Effect pipeline. Authorization was still a throwing `HttpError` helper outside
those routes, which meant unauthorized failures skipped the typed route error
channel. This checkpoint keeps authorization-before-parse semantics while
moving the failure into a typed boundary.

Known limitations:

- This does not introduce a broader authentication service or Layer.
- Downstream dispatch and runtime internals remain separate typed/compatibility
  boundaries.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicLiveQueryDeliveryAuthorization.test.ts packages/flarex-backend/test/sync.test.ts -t "public live query delivery authorization|unauthorized public live query delivery|unauthorized public DeliveryDO wake|unauthorized live query" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Public Worker Typed Dispatch Failures

Previous completed checkpoint: `a079a26` Type public invoke deployment errors.

What changed:

- Public Worker downstream dispatch failures now flow through
  `PublicWorkerDispatchError`.
- The shared error preserves downstream `HttpError` status/message values and
  maps non-HTTP dispatch failures to the existing `500` adapter behavior.
- Focused tests cover the direct dispatch error mapping plus the route
  boundaries that continue to own request validation.

Why it changed:

Migrated public Worker routes should keep HTTP conversion at the adapter edge.
This checkpoint removes repeated `HttpError` construction from downstream
dispatch catch branches across execution, partition, delivery, and live-query
public routes.

Known limitations:

- Downstream runtime and Durable Object internals still have their own
  compatibility error handling.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/transaction.test.ts packages/flarex-backend/test/publicLiveQueryDeliveryRouteBoundary.test.ts packages/flarex-backend/test/publicDeliveryWakeRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Public Invoke Typed Missing-Deployment Failure

Previous completed checkpoint: `c5133c6` Name generated runtime JSON
boundaries.

What changed:

- Missing deployment id on public Worker invoke now flows through
  `MissingInvokeDeploymentError`.
- `publicInvokeRouteErrorToHttpError(...)` maps that typed route failure to the
  unchanged `400` response at the adapter edge.
- Route-boundary tests cover the typed error-to-HTTP mapping, while Worker
  invoke coverage still proves the public response envelope.

Why it changed:

Runtime validation should not introduce `HttpError` in the middle of a migrated
Effect route. This checkpoint moves the leftover public invoke route validation
failure into the typed boundary module and keeps HTTP conversion at the Worker
edge.

Known limitations:

- Invoke runtime execution failures are still handled by the existing
  compatibility response adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts packages/flarex-backend/test/invoke.test.ts -t "public invoke route boundary|decodes public Worker invoke bodies"
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Generated Runtime Worker JSON Boundaries

Previous completed checkpoint: `5dd89f8` Type deployment artifact ref
failures.

What changed:

- Generated local runtime worker request body reads for invoke and
  query-session routes now pass through named boundary helpers with stable
  malformed-JSON errors.
- Generated backend response JSON reads now pass through explicit try/catch
  boundary helpers before the existing status/message mapping.

Why it changed:

The runtime-validation migration has typed several adapter response boundaries,
but generated worker templates still carried anonymous JSON parse sites. This
checkpoint makes those remaining generated boundaries visible and keeps behavior
stable before moving back to typed Effect route/service validation.

Known limitations:

- This checkpoint does not add Effect Schema validation to generated worker
  request payloads.
- The emitted workers remain plain generated Worker source and do not import
  Effect; this is a compatibility cleanup before the next route/service Effect
  slice.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-dev/vitest.config.ts packages/flarex-dev/test/runtimeMaterializer.test.ts packages/flarex-dev/test/generate.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-dev test -- --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Scheduler Response Effect Decoders

Previous completed checkpoint: `1fb88f8` Type live query delivery responses
with Effect.

What changed:

- Added named Effect decoders for SchedulerDO executor-maintenance and internal
  DO JSON responses.
- Added direct tests for typed scheduler response success, typed failure, and
  adapter mapping back to `HttpError(502, ...)`.
- SchedulerDO now reads successful JSON bodies through these decoders before
  running existing result parsers.

Why it changed:

SchedulerDO response reads are runtime JSON boundaries. The migration now
captures non-OK executor-maintenance responses as typed failures before the
adapter maps them, matching the rest of the backend response migration.

Known limitations:

- Successful scheduler payload schemas are still validated by existing parsers.
- Non-OK delivery wake and force-reconnect text handling intentionally remains
  outside the JSON response decoder.

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

## Live Query Delivery Response Effect Decoders

Previous completed checkpoint: `fb563e3` Type backend internal responses with
Effect.

What changed:

- Added named Effect decoders for live-query delivery claim, ack, and
  connection fanout responses.
- Added direct runtime tests for typed success and typed failure channels, plus
  adapter mapping back to `HttpError(502, ...)`.
- DeliveryDO and connection fanout now read JSON responses through those
  decoders before running the existing payload validators.

Why it changed:

Live-query delivery response reads are runtime JSON boundaries. Keeping
non-OK downstream responses typed before adapter mapping makes claim, ack, and
fanout failures consistent with the backend internal response migration.

Known limitations:

- Successful claim/ack/fanout payload validation still uses the existing
  handwritten parsers.
- SchedulerDO executor-maintenance response reads remain for a later slice.

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

## Backend Internal Response Effect Decoders

Previous completed checkpoint: `e726ae8` Type dev backend responses with
Effect.

What changed:

- Added named Effect decoders for backend analyzer responses, artifact runtime
  service-binding responses, and partition transaction responses.
- Added direct typed success/failure tests for analyzer and partition response
  decoders, plus typed failure and adapter mapping coverage for artifact
  runtime responses.
- Existing push, transaction, and runtime adapters still expose the same public
  error shapes after mapping.

Why it changed:

These backend response reads are runtime JSON boundaries. The migration now
captures malformed/non-OK downstream responses as typed Effect failures before
the adapter decides whether to create `HttpError`, `PartitionRequestError`, or
failed push status payloads.

Known limitations:

- Successful response payloads still rely on existing parser/domain paths.
- Delivery, scheduler, live-query delivery, generated worker source, and
  executor-http response boundaries remain separate follow-up slices.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntime.test.ts packages/flarex-backend/test/transaction.test.ts packages/flarex-backend/test/push.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Dev Response Effect Decoders

Previous completed checkpoint: `77c921a` Type materialized artifact responses
with Effect.

What changed:

- Added named Effect decoders for `flarex-dev` backend analyzer, push, finish,
  local finish, execution artifact analysis, and execution artifact invoke
  response bodies.
- Transport failures now produce typed Effect errors before adapter mapping to
  the existing public error classes/messages.
- Added runtime validation coverage for non-JSON analyzer, push, finish, and
  execution artifact invoke failures.

Why it changed:

These are runtime JSON boundaries where malformed or non-JSON bodies are
expected compatibility cases. Capturing the fallback behavior in tests makes
the Effect migration less likely to accidentally change local developer error
semantics.

Known limitations:

- This checkpoint does not replace successful response payload parsers with
  Effect Schema.
- It does not change generated runtime-worker source parsing.

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

## Materialized Artifact Response Effect Decoder

Previous completed checkpoint: `92df423` Route generated HttpApi requests
through Effect.

What changed:

- Added `decodeMaterializedArtifactResponse(...)`, a named Effect decoder for
  local materialized artifact HTTP responses.
- Non-OK responses now use typed `MaterializedArtifactResponseError` before
  being mapped to the existing status-bearing public Error.
- Added tests for success, structured error JSON, and malformed error-body
  JSON.

Why it changed:

The local artifact adapter is a runtime JSON boundary. Keeping response
decoding in one typed Effect helper reduces duplicated unchecked parsing and
keeps integration failures explicit.

Convex references inspected:

- None in this checkpoint. This is local Flarex runtime adapter behavior.

Known limitations:

- Successful response payloads are still trusted as the existing runtime
  contract; this checkpoint only typed the integration failure boundary.

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

## Generated HttpApi Request Builder Effect Boundary

Previous completed checkpoint: `425de44` Route flarex dev bodies through
Effect.

What changed:

- Registry and deployment generated HttpApi request builders now expose named
  Effect entrypoints.
- Mutation request bodies still use the existing typed JSON/protocol decoders,
  but RegistryDO and DeploymentDO now run the full request-builder Effect at
  their fetch adapters.
- Direct route-boundary tests cover the full Effect request-builder success and
  typed failure paths, not only the lower body decoders.

Why it changed:

The backend generated HttpApi routes already had typed body decoders, but their
Durable Object adapters still entered through Promise compatibility request
builders. This checkpoint moves the full adapter decision to the same
one-runtime-boundary Effect shape used by the other backend route adapters.

Convex references inspected:

- None in this checkpoint. This is Flarex adapter validation wiring, not a
  Convex semantic change.

Known limitations:

- Promise compatibility functions remain for existing tests and callers.
- Generated runtime-worker source body reads are still a separate migration
  target.

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

## Flarex Dev Local Route Effect Decoders

Previous completed checkpoint: `4aa94cb` Route partition fetch edges through
Effect.

What changed:

- Added package-local Effect decoders for `flarex-dev` local invoke proxy
  bodies and local analyzer requests.
- `/__flarex_dev/invoke` now normalizes request JSON through
  `decodeDevInvokeBody(...)` before forwarding to the backend invoke route.
- `createLocalAnalyzerService(...)` now reads analyzer request bodies through
  `decodeLocalAnalyzerRequest(...)` before calling the analyzer.
- Added direct tests for typed success and failure channels, including
  malformed JSON, missing function paths, and missing analyzer
  `sourcePackage`.

Why it changed:

After the backend Worker and Durable Object route edges moved to Effect
decoders, the remaining normal TypeScript HTTP body reads were in the local
dev package. This keeps validation-boundary migration moving beyond
compatibility wrappers without touching generated runtime-worker source in the
same checkpoint.

Convex references inspected:

- None in this checkpoint. This is a local Flarex adapter-boundary migration,
  not a Convex semantics change.

Flarex differences:

- The local dev adapter remains Flarex-specific because it proxies generated
  local invoke requests and analyzer service binding calls. Convex does not
  expose this Cloudflare/Miniflare adapter shape.

Known limitations:

- The generated runtime worker source still contains internal
  `request.json()` reads because that source is emitted as a standalone worker
  string and cannot import `effect` like normal package TypeScript. Migrate it
  separately with generated-code parity coverage.

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

## Service-Binding Runtime Invoke Effect Boundary

Previous completed checkpoint: this commit, `Type service-binding runtime
invoke failures`.

What changed:

- The backend service-binding artifact runtime client now builds invoke
  payloads, fetches the runtime binding, and decodes responses through the
  exported `ServiceBindingExecutionArtifactRuntime.invoke` `Effect.fn`.
- Source-package load failures and runtime binding fetch failures are typed as
  `ExecutionArtifactRuntimeOperationError` before adapter mapping.
- Focused tests cover typed load/fetch failures directly and the preserved
  `HttpError` mapping from the Promise-facing adapter.

Validation boundary:

This is an integration/runtime boundary change only. It does not change invoke
request validation, artifact materialization, generated worker behavior,
runtime-store mode, or any PartitionDO SQL/OCC path.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntime.test.ts packages/flarex-backend/test/artifactRuntimeRouteBoundary.test.ts
corepack pnpm --filter flarex-backend build
git diff --check
```

## Deployment HttpApi Direct Failure Response Mapping

Previous completed checkpoint: this commit, `Map deployment handler failures
directly`.

What changed:

- Generated Deployment HttpApi handler failures now map from typed deployment
  failures straight to declared response classes.
- Direct response helpers cover read, start, finish, and abandon service
  failures without recreating `HttpError` in the generated handler flow.
- Preserved `deploymentHttpErrorTo*Response(...)` helpers still verify explicit
  status-to-response compatibility for adapter-shaped HTTP errors.

Runtime boundary:

The generated handler is now a typed Effect service boundary followed by
protocol response conversion. `HttpError` remains for HTTP adapters, not for the
normal typed deployment service-failure path.

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

- Deployment generated-handler service failure mapping no longer accepts
  arbitrary `HttpError` as a service failure.
- Start-analyzed handler input decoding maps protocol validation into
  `DeploymentValidationError`; deployment-domain validation already stays
  typed.
- Finish-push activation storage now preserves `DeploymentValidationError`
  directly and treats other unexpected transaction failures as
  `DeploymentSqlError`.

Runtime boundary:

The generated Deployment HttpApi adapter still converts typed failures to the
same response classes and HTTP status/body behavior. This checkpoint narrows
the service failure channel; it does not change runtime routes or stored SQL
state.

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

- Shared backend validator metadata parsing now has a non-throwing
  `parseValidatorJson(...)` result helper.
- `assertValidatorJson(...)` remains available for existing runtime validation
  compatibility and preserves the same thrown `BackendValidationError`
  messages.
- Deployment metadata validation uses the result helper directly so validator
  metadata failures stay in the typed deployment validation channel.

Runtime boundary:

This is not a runtime value-validation rewrite. `validateJsonValue(...)` and
runtime user data validation still use `BackendValidationError`; this checkpoint
only changes metadata parsing used by deployment validation.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/validation.test.ts packages/flarex-backend/test/deploymentValidation.test.ts
corepack pnpm --filter flarex-backend build
git diff --check
```

## Artifact Runtime Service Effect Adapter

Previous completed checkpoint: `c0f92c8` Type partition route bodies with Effect.

What changed:

- `artifactRuntime/RouteBoundary.ts` now normalizes invoke payload shape checks
  through a typed validation result helper before exposing the compatibility
  throwing parser and Effect parser.
- The artifact invoke route error mapper is exported so the runtime service
  adapter can reuse the same `RequestJsonError` and payload-shape HTTP mapping.
- `createExecutionArtifactRuntimeService(...)` now routes `/invoke` through the
  named `ExecutionArtifactRuntime.routeInvoke` `Effect.fn`.
- Runtime source-package and operation failures are now tagged runtime errors
  and mapped once at the fetch adapter edge.

Why it changed:

The artifact runtime route body was already typed, but the runtime service still
used one broad async `try/catch` around request normalization, payload parsing,
source-package loading, materializer lookup, and invocation. This checkpoint
moves that adapter toward the same Effect shape as public Worker routes while
keeping runtime behavior stable.

Preserved behavior:

- `404 Not found.`, unauthorized runtime requests, artifact header mismatches,
  malformed JSON, invalid payloads, missing source packages, runtime-store
  source-package loading, materializer cache reuse/disposal, and invoke failure
  status preservation keep the same response semantics.
- Public invoke routes, deployment routes, scheduler routes, execution routes,
  partition routes, delivery routes, protocol schemas, executor-http routes, and
  `ValidatorJson` are unchanged.

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

## Execution Syscall Effect Decoder

Previous completed checkpoint: `ea19fc9` Add typed execution finish decoder.

What changed:

- Added `decodeExecutionSyscallRouteRequest(...)` and
  `parseExecutionSyscallRouteRequestEffect(...)` to
  `packages/flarex-backend/src/execution/SyscallRouteBoundary.ts`.
- `readExecutionSyscallRequest(...)` remains the ExecutionDO-facing
  compatibility wrapper and now maps typed JSON and protocol failures back to
  the existing `HttpError(400, ...)` responses.
- `parseExecutionSyscallRouteRequest(...)` remains the direct throwing
  compatibility parser for public execution action forwarding and tests.
- Malformed JSON still returns `Request body must be JSON.`, and syscall
  protocol validation still returns
  `Execution syscall request must be a valid get, query, insert, patch, replace, or delete operation.`.
- ExecutionDO syscall routing, public execution action forwarding, execution
  session state changes, start/finish routes, public invoke routes, deployment
  push routes, scheduler routes, partition routes, executor-http routes, and
  `ValidatorJson` are unchanged.

Why it changed:

Execution syscall was still reading JSON through the throwing compatibility
helper and converting protocol failures directly to `HttpError`. This
checkpoint exposes typed Effect success/failure channels while preserving the
existing ExecutionDO and public action adapter responses.

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

- Added `decodeExecutionFinishRouteRequest(...)` and
  `parseExecutionFinishRouteRequestEffect(...)` to
  `packages/flarex-backend/src/execution/FinishRouteBoundary.ts`.
- `readExecutionFinishRequest(...)` remains the ExecutionDO-facing
  compatibility wrapper and now maps typed JSON and protocol failures back to
  the existing `HttpError(400, ...)` responses.
- `parseExecutionFinishRouteRequest(...)` remains the direct throwing
  compatibility parser for public execution action forwarding and tests.
- Malformed JSON still returns `Request body must be JSON.`, and finish
  protocol validation still returns
  `Execution finish request must include JSON value.`.
- ExecutionDO finish routing, public execution action forwarding, execution
  session state changes, syscall/start routes, public invoke routes, deployment
  push routes, scheduler routes, partition routes, executor-http routes, and
  `ValidatorJson` are unchanged.

Why it changed:

Execution finish was still reading JSON through the throwing compatibility
helper and converting protocol failures directly to `HttpError`. This
checkpoint exposes typed Effect success/failure channels while preserving the
existing ExecutionDO and public action adapter responses.

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

- Added `decodePublicInvokeRouteRequest(...)` and
  `parsePublicInvokeRouteRequestEffect(...)` to
  `packages/flarex-backend/src/invoke/PublicInvokeRouteBoundary.ts`.
- `readPublicInvokeRequest(...)` remains the Worker-facing compatibility
  wrapper and now maps typed JSON and protocol failures back to the existing
  `HttpError(400, ...)` responses.
- `parsePublicInvokeRouteRequest(...)` remains the direct throwing
  compatibility parser for existing callers and tests.
- Omitted `args` behavior for Worker invoke defaulting is unchanged.
- Public `/invoke`, deployment-scoped `/invoke`, route/header defaulting,
  invoke dispatch, artifact runtime routing, deployment push routes, scheduler
  routes, partition routes, executor-http routes, and `ValidatorJson` are
  unchanged.

Why it changed:

Public invoke was still reading JSON through the throwing compatibility helper
and mapping protocol failures directly to `HttpError`. This checkpoint exposes
typed Effect success/failure channels while preserving the current Worker
adapter responses and invoke defaulting behavior.

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

- Added `ExecutionArtifactInvokePayloadError`,
  `decodeExecutionArtifactInvokePayload(...)`, and
  `parseExecutionArtifactInvokePayloadEffect(...)` to
  `packages/flarex-backend/src/artifactRuntime/RouteBoundary.ts`.
- `readExecutionArtifactInvokePayload(...)` remains the runtime-facing
  compatibility wrapper and now maps typed JSON and payload-shape failures back
  to the existing `HttpError(400, ...)` responses.
- `parseExecutionArtifactInvokePayload(...)` remains the direct throwing
  compatibility parser for existing callers and tests.
- Malformed JSON still returns `Request body must be JSON.`, and invalid
  payload shape still returns `Invalid execution artifact invoke payload.`.
- Artifact runtime authorization, source-package loading, materializer cache
  behavior, invoke request dispatch, invoke failure status mapping, public
  invoke routes, deployment push routes, scheduler routes, partition routes,
  executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

The artifact runtime invoke boundary was still reading JSON through the
throwing compatibility helper and emitting `HttpError` directly for invalid
payload shape. This checkpoint exposes typed Effect success/failure channels
while preserving the existing runtime adapter responses.

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

- Added `decodePublicStartPushRequest(...)` and
  `parsePublicStartPushRequestEffect(...)` to
  `packages/flarex-backend/src/deployment/PublicPushRouteBoundary.ts`.
- `readPublicStartPushRequest(...)` is available as a compatibility wrapper
  around the full typed decoder for direct callers and future consolidation.
- `readPublicStartPushJson(...)` remains the Worker-facing JSON-only wrapper
  and now uses `readJsonEffect(...)`, preserving malformed JSON as the shared
  `400` before the no-analyzer branch.
- `parsePublicStartPushRequest(...)` remains the Worker-facing protocol parser
  that runs only after analyzer availability has been checked.
- Public Worker route paths, Worker forwarding, analyzer request/response
  behavior, analyzed package persistence, DeploymentDO generated-handler
  routing, deployment push finish/analyzed-start/abandon behavior, SQL
  statements, response bodies, request validation messages, protocol schemas,
  and `ValidatorJson` are unchanged.

Why it changed:

The source-only public push route was the remaining public deployment push body
boundary without typed Effect JSON/protocol helpers. This checkpoint adds those
helpers while preserving the current runtime order: malformed JSON still fails
before the analyzer check, but schema-invalid source-only bodies still return
the existing no-analyzer `501` when `FLAREX_ANALYZER` is absent.

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

- Added `decodePublicFinishPushRequest(...)` and
  `parsePublicFinishPushRequestEffect(...)` to
  `packages/flarex-backend/src/deployment/PublicPushRouteBoundary.ts`.
- `readPublicFinishPushRequest(...)` remains a compatibility wrapper around
  the full typed decoder for direct callers.
- `readPublicFinishPushJson(...)` remains the Worker-facing JSON-only wrapper
  and now uses `readJsonEffect(...)`, preserving malformed JSON as the shared
  `400` before artifact preflight.
- `parsePublicFinishPushRequest(...)` remains the Worker-facing post-preflight
  protocol parser, with an Effect-typed companion for typed failure-channel
  tests and future consolidation.
- Public Worker route paths, Worker forwarding, DeploymentDO generated-handler
  routing, `DeploymentApiHandlers.finishPush`, `DeploymentService.finishPush`,
  artifact reference computation, SQL statements, response bodies, request
  validation messages, protocol schemas, source-only analyzer routing,
  analyzed-start, abandon, and `ValidatorJson` are unchanged.

Why it changed:

Finish-push is the last public deployment push mutation still using a plain
public body parser boundary. This checkpoint gives it typed JSON and protocol
Effect channels while preserving its special runtime ordering: malformed JSON
is checked before artifact preflight, but missing artifact can still return the
existing `409` before finish protocol validation.

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

- Added `decodePublicAnalyzedStartPushRequest(...)` and
  `parsePublicAnalyzedStartPushRequestEffect(...)` to
  `packages/flarex-backend/src/deployment/PublicPushRouteBoundary.ts`.
- `readPublicAnalyzedStartPushRequest(...)` remains the Worker-facing
  compatibility wrapper and now runs the typed Effect decoder before mapping
  malformed JSON back to the existing shared `400` response.
- Added shared public deployment route decoder helpers used by analyzed-start
  and abandon so protocol parser failures remain
  `DeploymentProtocolValidationError` and JSON failures map only at the
  adapter edge.
- Public Worker forwarding, DeploymentDO generated-handler routing,
  `DeploymentApiHandlers.startAnalyzedPush`, `DeploymentService.startAnalyzedPush`,
  source-only analyzer routing, finish artifact preflight ordering, SQL
  statements, response bodies, request validation messages, protocol schemas,
  and `ValidatorJson` are unchanged.

Why it changed:

Public abandon-push now exposes typed Effect request decoding. This checkpoint
applies the same boundary shape to public analyzed-start, which has a simple
read/decode/forward flow and does not carry finish-push's artifact preflight
ordering constraint.

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

- Added `decodePublicAbandonPushRequest(...)` and
  `parsePublicAbandonPushRequestEffect(...)` to
  `packages/flarex-backend/src/deployment/PublicPushRouteBoundary.ts`.
- `readPublicAbandonPushRequest(...)` remains the Worker-facing compatibility
  wrapper and now runs the typed Effect decoder before mapping malformed JSON
  back to the existing shared `400` response.
- Protocol validation failures still surface as
  `DeploymentProtocolValidationError`, preserving the existing
  `deploymentProtocolValidationErrorResponse(...)` 400 envelope.
- `DeploymentService.abandonPush(...)` remains the owner of push lookup, typed
  not-found/invalid-state checks, controlled timestamp use, and reason
  defaulting/truncation.
- Worker forwarding, DeploymentDO internal routes, generated HttpApi handler
  behavior, SQL statements, response bodies, request validation messages,
  service/store orchestration, protocol schemas, and `ValidatorJson` are
  unchanged.

Why it changed:

The abandon-push orchestration already lives in `DeploymentService`. This
checkpoint moves the remaining public abandon request-body boundary from
`readJson(...)` plus a throwing parser to an Effect-typed decoder while keeping
the public Worker adapter and service-owned normalization behavior stable.

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

- Added `decodeRegistryCreateDeploymentRouteRequest(...)` and
  `parseRegistryCreateDeploymentRouteRequestEffect(...)` to
  `packages/flarex-backend/src/registry/HttpApiRouteBoundary.ts`.
- `registryApiRequestForRoute(...)` now delegates `POST /deployments` body
  parsing through the Effect decoder before rebuilding the canonical
  generated-handler request.
- `readRegistryCreateDeploymentRouteRequest(...)` and
  `parseRegistryCreateDeploymentRouteRequest(...)` remain compatibility
  wrappers for the existing async adapter and direct parser callers.
- Malformed create-deployment JSON flows through the typed `RequestJsonError`
  channel before mapping back to the existing `Request body must be JSON.`
  `400` compatibility response.
- Registry read routes still pass through unchanged, and protocol validation
  failures still surface as `ProtocolValidationError`.
- `RegistryDO.fetch()`, `RegistryApiHandlers`, `RegistryService`,
  `RegistryStore`, deployment records, scheduler routes, execution routes,
  deployment push routes, executor-http routes, and `ValidatorJson` are
  unchanged.

Why it changed:

Deployment HttpApi mutation bodies now use typed route decoders. This
checkpoint applies the same transport boundary to registry create-deployment
so the registry HttpApi proof moves beyond plain parser helpers while keeping
the generated handler flow and current HTTP responses stable.

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

- Added local shared helpers in
  `packages/flarex-backend/src/deployment/HttpApiRouteBoundary.ts` for:
  `runDeploymentRouteRequest(...)`, `decodeDeploymentRouteRequest(...)`, and
  `parseDeploymentProtocolRequestEffect(...)`.
- Start-analyzed, finish, and abandon route-specific decoders now share the
  same typed JSON read, protocol parser composition, and compatibility adapter
  mapping.
- Exported route-specific decoder names, compatibility wrappers, and generated
  handler request reconstruction are unchanged.
- Deployment read routes still pass through unchanged, malformed JSON still
  maps through the shared `Request body must be JSON.` boundary, and protocol
  validation failures still surface as `DeploymentProtocolValidationError`.
- `DeploymentDO.fetch()`, `DeploymentApiHandlers`, `DeploymentService`,
  `DeploymentPushStore`, public Worker push routes, scheduler routes,
  execution routes, executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

After start-analyzed, finish, and abandon all moved to typed decoders, the
route boundary had three copies of the same Effect adapter logic. This
checkpoint keeps the typed route-specific APIs while making the shared
transport boundary shape explicit and harder to drift.

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

- Added `decodeDeploymentAnalyzedStartPushRouteRequest(...)` and
  `parseDeploymentAnalyzedStartPushRouteRequestEffect(...)` to
  `packages/flarex-backend/src/deployment/HttpApiRouteBoundary.ts`.
- Added `readDeploymentAnalyzedStartPushRouteRequest(...)` and
  `parseDeploymentAnalyzedStartPushRouteRequest(...)` as compatibility
  wrappers for existing async route-adapter and direct parser callers.
- `deploymentApiRequestForRoute(...)` now delegates `POST /push/start-analyzed`
  body parsing through the Effect decoder before rebuilding the canonical
  generated-handler request.
- Malformed start-analyzed JSON flows through the typed `RequestJsonError`
  channel before mapping back to the existing `Request body must be JSON.`
  `400` compatibility response.
- Deployment read routes still pass through unchanged, and protocol validation
  failures still surface as `DeploymentProtocolValidationError`.
- `DeploymentDO.fetch()`, `DeploymentApiHandlers`,
  `DeploymentService.startAnalyzedPush`, `DeploymentPushStore`,
  finish/abandon routes, public Worker push routes, scheduler routes,
  execution routes, executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

Finish and abandon now use typed transport decoders. This checkpoint applies
the same Effect-typed boundary to start-analyzed so all backend deployment
HttpApi mutation bodies expose typed success/failure channels while preserving
generated handler flow and existing HTTP responses.

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

- Added `decodeDeploymentAbandonPushRouteRequest(...)` and
  `parseDeploymentAbandonPushRouteRequestEffect(...)` to
  `packages/flarex-backend/src/deployment/HttpApiRouteBoundary.ts`.
- `deploymentApiRequestForRoute(...)` now delegates
  `POST /push/:pushId/abandon` body parsing through the Effect decoder before
  rebuilding the canonical generated-handler request.
- `readDeploymentAbandonPushRouteRequest(...)` and
  `parseDeploymentAbandonPushRouteRequest(...)` remain compatibility wrappers
  for the existing async adapter and direct parser callers.
- Malformed abandon JSON now flows through the typed `RequestJsonError`
  channel before mapping back to the existing `Request body must be JSON.`
  `400` compatibility response.
- Deployment read routes still pass through unchanged, and protocol validation
  failures still surface as `DeploymentProtocolValidationError`.
- `DeploymentDO.fetch()`, `DeploymentApiHandlers`,
  `DeploymentService.abandonPush`, `DeploymentPushStore`, finish/start push
  routes, public Worker push routes, scheduler routes, execution routes,
  executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

The finish route introduced the typed request-body boundary. This checkpoint
applies the same Effect-typed transport shape to abandon-push so both backend
push mutation routes expose typed success/failure channels while preserving
the generated HttpApi handler flow and existing HTTP responses.

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

## Effect-Typed Route Boundary Quality Bar

Current parser-extraction checkpoints are useful compatibility work, but they
are not the final Effect migration shape. The next runtime-validation phase
should prove route boundaries through typed Effect channels instead of only
through thrown parser errors.

Runtime validation target:

- Add a typed request-body read boundary, for example `readJsonEffect(...)`
  returning a tagged `RequestJsonError` instead of throwing `HttpError`.
- Add route-specific Effect decoders that compose JSON reading and protocol
  schema validation into
  `Effect.Effect<Request, RequestJsonError | ProtocolValidationError>`.
- Keep synchronous `parseX(...)` wrappers only for compatibility callers while
  migrated runtime paths use Effect decoders.
- Convert typed request/protocol failures to the existing HTTP status and body
  at a single Worker/DO/HttpApi adapter edge.
- Add tests that assert both typed failures before HTTP mapping and preserved
  HTTP responses after adapter mapping.

First proof checkpoint:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts -t "deploymentApiRequestForRoute|handles finish-push mutations through the Worker-compatible web handler"
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend exec vitest run --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Deployment HttpApi Finish Push Route Boundary

Previous completed checkpoint: `c0537a6` Extract deployment abandon route parser.

What changed:

- Added a shared `readJsonEffect(...)` helper with tagged `RequestJsonError`
  in `packages/flarex-backend/src/http.ts`.
- Added `decodeDeploymentFinishPushRouteRequest(...)` and
  `parseDeploymentFinishPushRouteRequestEffect(...)` to
  `packages/flarex-backend/src/deployment/HttpApiRouteBoundary.ts`.
- `deploymentApiRequestForRoute(...)` now delegates
  `POST /push/:pushId/finish` body parsing through the Effect decoder before
  rebuilding the canonical generated-handler request.
- `readDeploymentFinishPushRouteRequest(...)` and
  `parseDeploymentFinishPushRouteRequest(...)` remain compatibility wrappers
  for the existing async adapter and direct parser callers.
- Deployment read routes still pass through unchanged, malformed JSON still
  maps through the shared `Request body must be JSON.` boundary, and protocol
  validation failures still surface as `DeploymentProtocolValidationError`.
- `DeploymentDO.fetch()`, `DeploymentApiHandlers`,
  `DeploymentService.finishPush`, `DeploymentPushStore`, abandon/start push
  routes, public Worker push routes, scheduler routes, execution routes,
  executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

The backend deployment HttpApi bridge still had finish-push JSON reading,
protocol parsing, and generated-handler request reconstruction as a throwing
branch. Finish activation already lives in `DeploymentService.finishPush`; this
checkpoint makes the remaining transport parse boundary Effect-typed without
changing service behavior or HTTP response compatibility.

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

- Added `readDeploymentAbandonPushRouteRequest(...)` and
  `parseDeploymentAbandonPushRouteRequest(...)` to
  `packages/flarex-backend/src/deployment/HttpApiRouteBoundary.ts`.
- `deploymentApiRequestForRoute(...)` now delegates
  `POST /push/:pushId/abandon` body parsing to those helpers before rebuilding
  the canonical generated-handler request.
- Deployment read routes still pass through unchanged, malformed JSON still
  maps through the shared `Request body must be JSON.` boundary, and protocol
  validation failures still surface as `DeploymentProtocolValidationError`.
- `DeploymentDO.fetch()`, `DeploymentApiHandlers`,
  `DeploymentService.abandonPush`, `DeploymentPushStore`, finish/start push
  routes, public Worker push routes, scheduler routes, execution routes,
  executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

The backend deployment HttpApi bridge still had abandon-push route matching,
JSON reading, protocol parsing, and generated-handler request reconstruction
in one branch. Abandon orchestration already lives in
`DeploymentService.abandonPush`; this checkpoint names the remaining transport
parse boundary without changing service behavior.

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

- Added `readRegistryCreateDeploymentRouteRequest(...)` and
  `parseRegistryCreateDeploymentRouteRequest(...)` to
  `packages/flarex-backend/src/registry/HttpApiRouteBoundary.ts`.
- `registryApiRequestForRoute(...)` now delegates `POST /deployments` body
  parsing to those helpers before rebuilding the canonical generated-handler
  request.
- Registry read routes still pass through unchanged, malformed JSON still maps
  through the shared `Request body must be JSON.` boundary, and protocol
  validation failures still surface as `ProtocolValidationError`.
- `RegistryDO.fetch()`, `RegistryApiHandlers`, `RegistryService`,
  `RegistryStore`, deployment records, scheduler routes, execution routes,
  deployment push routes, executor-http routes, and `ValidatorJson` are
  unchanged.

Why it changed:

The registry HttpApi route bridge had route matching, JSON reading, protocol
parsing, and generated-handler request reconstruction in one branch. This
checkpoint names the create-deployment parse boundary without changing the
generated HttpApi handler flow.

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

## Public Execution Action Normalization Boundary

Previous completed checkpoint: `6397855` Extract public execution start parser.

What changed:

- `packages/flarex-backend/src/execution/ActionRouteBoundary.ts` now exposes a
  named public execution action parser for Worker route normalization.
- Public execution action routes still read JSON through the shared backend
  `readJson(...)` boundary, then dispatch by action to the existing syscall or
  finish parser, or forward abort JSON unchanged.
- Malformed JSON mapping and action-specific protocol failure mapping are
  unchanged.
- `ExecutionDO.fetch()`, `ExecutionDO.syscall(...)`, `ExecutionDO.finish(...)`,
  abort behavior, session lifecycle, PartitionDO, artifact runtime,
  executor-http, and `ValidatorJson` are unchanged.

Why it changed:

Public execution actions have a Worker transport rule that differs per action.
This checkpoint gives that rule a named parser and direct tests while keeping
the Durable Object runtime behavior outside the slice.

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

## Public Execution Start Normalization Boundary

Previous completed checkpoint: `ccf823f` Normalize artifact runtime JSON boundary.

What changed:

- `packages/flarex-backend/src/execution/StartRouteBoundary.ts` now exposes a
  named public execution start parser for Worker route normalization.
- Public execution start still reads JSON through the shared backend
  `readJson(...)` boundary, then applies the route deployment id before the
  execution protocol parser validates the request.
- Route deployment id precedence, malformed JSON mapping, and protocol failure
  mapping are unchanged.
- Internal execution start parsing, `ExecutionDO.fetch()`, syscall, finish,
  abort routing, session lifecycle, PartitionDO, artifact runtime,
  executor-http, and `ValidatorJson` are unchanged.

Why it changed:

The public execution start boundary had route-specific body normalization
embedded inside the async JSON reader. Naming the parser makes the transport
rule visible and directly testable while keeping the runtime session behavior
outside this slice.

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

## Artifact Runtime Malformed JSON Boundary

Previous completed checkpoint: `db496b5` Remove generic scheduler request forwarder.

What changed:

- `packages/flarex-backend/src/artifactRuntime/RouteBoundary.ts` now reads
  runtime `/invoke` JSON through the shared backend `readJson(...)` boundary.
- Malformed artifact-runtime invoke JSON now returns JSON `400` with
  `Request body must be JSON.`, matching other backend route boundaries.
- Shape-invalid artifact-runtime invoke payloads still return JSON `400` with
  `Invalid execution artifact invoke payload.`.
- Runtime authorization, artifact header mismatch checks, runtime-store
  source-package loading, materializer cache behavior, invoke failure status
  preservation, Worker routing, DeliveryDO, PartitionDO, executor-http, and
  `ValidatorJson` are unchanged.

Why it changed:

The artifact runtime invoke boundary previously used
`request.json().catch(() => null)`, which made malformed JSON look identical to
a structurally invalid payload. The rest of the backend route-boundary helpers
now use the shared JSON reader, so this checkpoint aligns malformed JSON
handling while preserving the local artifact invoke payload guard.

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

## Public Scheduler Forwarding Cleanup

Previous completed checkpoint: `71c187b` Move finish push JSON read into boundary.

What changed:

- Removed the unused `forwardLiveQuerySchedulerRequest(...)` helper from
  `packages/flarex-backend/src/worker.ts`.
- Removed the last direct `readJson` import from `worker.ts`.
- Public Worker scheduler routes now read JSON through explicit route-boundary
  helpers before calling `forwardLiveQuerySchedulerBody(...)`.
- Public scheduler route paths, authorization ordering, parsed-body forwarding,
  SchedulerDO execution, delivery fanout, continuation behavior, deployment push
  routes, partition routes, delivery routes, executor-http routes, and
  `ValidatorJson` are unchanged.

Why it changed:

The generic scheduler forwarding helper was useful while some public scheduler
routes still accepted raw forwarded JSON. After delivery reconcile, connection
reconcile, dead-letter, cleanup, rerun, and trigger all moved behind explicit
public boundary readers, the helper only preserved a stale unchecked path in
`worker.ts`.

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

## Public Scheduler Subscription Trigger Boundary

Previous completed checkpoint: `df60d8b` Decode public scheduler rerun bodies.

What changed:

- Extended `packages/flarex-backend/src/scheduler/PublicRouteBoundary.ts` to
  own the public Worker subscription trigger scheduler body read.
- `POST /scheduler/live-query-subscriptions/trigger` now decodes request JSON
  through the shared scheduler subscription rerun parser before forwarding to
  `SchedulerDO`.
- The public Worker reserializes the parsed trigger request before forwarding
  to SchedulerDO's existing rerun path, so ignored fields are dropped at the
  public edge.
- Authorization remains before body parsing.
- SchedulerDO rerun execution, stale subscription scans, DeliveryDO wake fanout,
  continuation behavior, the `/scheduler/live-query-subscriptions/rerun` route,
  delivery reconcile, connection reconcile, dead-letter, cleanup routes,
  partition routes, delivery routes, executor-http routes, and `ValidatorJson`
  are unchanged.

Why it changed:

After the explicit rerun route moved behind a public scheduler boundary, the
trigger route was the last subscription scheduler forwarding route still
accepting arbitrary JSON before SchedulerDO. This checkpoint narrows `/trigger`
while keeping its existing implementation as a hint that forwards to the same
durable rerun path.

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

## Public Scheduler Subscription Rerun Boundary

Previous completed checkpoint: `c90500c` Decode public scheduler cleanup bodies.

What changed:

- Extended `packages/flarex-backend/src/scheduler/PublicRouteBoundary.ts` to
  own the public Worker subscription rerun scheduler body read.
- `POST /scheduler/live-query-subscriptions/rerun` now decodes request JSON
  through the shared scheduler route-boundary parser before forwarding to
  `SchedulerDO`.
- The public Worker reserializes the parsed rerun request before forwarding, so
  ignored fields are dropped at the public edge.
- Authorization remains before body parsing.
- SchedulerDO rerun execution, stale subscription scans, DeliveryDO wake fanout,
  continuation behavior, the `/scheduler/live-query-subscriptions/trigger`
  route, delivery reconcile, connection reconcile, dead-letter, cleanup routes,
  partition routes, delivery routes, executor-http routes, and `ValidatorJson`
  are unchanged.

Why it changed:

After connection cleanup moved behind a public scheduler boundary, subscription
rerun was the next public scheduler forwarding route still accepting arbitrary
JSON before SchedulerDO. This checkpoint narrows `/rerun` only and leaves
`/trigger` for a later slice.

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

## Public Scheduler Connection Cleanup Boundary

Previous completed checkpoint: `ca4fca6` Decode public scheduler dead-letter bodies.

What changed:

- Extended `packages/flarex-backend/src/scheduler/PublicRouteBoundary.ts` to
  own the public Worker connection cleanup scheduler body read.
- `POST /scheduler/live-query-connections/cleanup` now decodes request JSON
  through the shared scheduler route-boundary parser before forwarding to
  `SchedulerDO`.
- The public Worker applies the existing `projectId` request-or-env fallback and
  reserializes the parsed cleanup request before forwarding, so ignored fields
  are dropped and `expiredAt` is normalized at the public edge.
- Authorization remains before body parsing.
- SchedulerDO cleanup execution, executor cleanup calls, delivery reconcile,
  connection reconcile, dead-letter, rerun routes, partition routes, delivery
  routes, executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

After dead-letter moved behind a public scheduler boundary, connection cleanup
was the next public scheduler forwarding route still accepting arbitrary JSON
before SchedulerDO. This checkpoint narrows that transport edge without moving
SchedulerDO cleanup execution or executor cleanup calls.

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

## Public Scheduler Dead-Letter Boundary

Previous completed checkpoint: `abaec65` Decode public scheduler connection reconcile bodies.

What changed:

- Extended `packages/flarex-backend/src/scheduler/PublicRouteBoundary.ts` to
  own the public Worker delivery dead-letter scheduler body read.
- `POST /scheduler/live-query-deliveries/dead-letter` now decodes request JSON
  through the shared scheduler route-boundary parser before forwarding to
  `SchedulerDO`.
- The public Worker reserializes the parsed dead-letter request before
  forwarding, so ignored fields are dropped, dates are normalized, and default
  dead-letter parameters are applied at the public edge.
- Authorization remains before body parsing.
- SchedulerDO dead-letter execution, reconnect fanout, executor dead-letter
  scans, delivery reconcile, connection reconcile, rerun, cleanup routes,
  partition routes, delivery routes, executor-http routes, and `ValidatorJson`
  are unchanged.

Why it changed:

After both scheduler reconcile endpoints moved behind public scheduler
boundaries, dead-letter delivery was the next public scheduler forwarding route
still accepting arbitrary JSON before SchedulerDO. This checkpoint narrows that
transport edge without moving SchedulerDO dead-letter orchestration.

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

## Public Scheduler Connection Reconcile Boundary

Previous completed checkpoint: `64a086a` Decode public scheduler delivery reconcile bodies.

What changed:

- Extended `packages/flarex-backend/src/scheduler/PublicRouteBoundary.ts` to
  own the public Worker connection reconcile scheduler body read.
- `POST /scheduler/live-query-connections/reconcile` now decodes request JSON
  through the shared scheduler route-boundary parser before forwarding to
  `SchedulerDO`.
- The public Worker reserializes the parsed connection reconcile request before
  forwarding, so ignored fields are dropped and cursor dates are normalized at
  the public edge.
- Authorization remains before body parsing.
- SchedulerDO connection cleanup reconcile execution, continuation/coalescing,
  executor expired-connection scans, cleanup fanout, delivery reconcile,
  dead-letter, rerun, cleanup routes, partition routes, delivery routes,
  executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

After delivery reconcile moved behind a public scheduler boundary, connection
reconcile was the adjacent public scheduler forwarding route still reading
arbitrary JSON before SchedulerDO. This checkpoint narrows that transport edge
without moving SchedulerDO cleanup reconciliation behavior.

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

## Public Scheduler Delivery Reconcile Boundary

Previous completed checkpoint: `4211274` Decode public partition schema-cache bodies.

What changed:

- Added `packages/flarex-backend/src/scheduler/PublicRouteBoundary.ts` to own
  the public Worker delivery reconcile scheduler body read.
- `POST /scheduler/live-query-deliveries/reconcile` now decodes request JSON
  through the shared scheduler route-boundary parser before forwarding to
  `SchedulerDO`.
- The public Worker reserializes the parsed delivery reconcile request before
  forwarding, so ignored fields are dropped and cursor dates are normalized at
  the public edge.
- Authorization remains before body parsing.
- SchedulerDO delivery reconcile execution, continuation/coalescing, DeliveryDO
  wake fanout, executor pending-deployment scans, connection cleanup,
  dead-letter, rerun, cleanup routes, partition routes, delivery routes,
  executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

The public scheduler forwarding helper still read arbitrary JSON before
forwarding to `SchedulerDO`. This checkpoint narrows the delivery reconcile
endpoint first, without changing SchedulerDO's internal reconcile ownership or
the other scheduler public endpoints.

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

## Public Partition Schema Cache Boundary

Previous completed checkpoint: `c930cf0` Decode public delivery wake bodies.

What changed:

- Added `packages/flarex-backend/src/partition/PublicSchemaCacheRouteBoundary.ts`
  to own the public Worker partition schema-cache body read.
- `PUT /deployments/:deploymentId/partitions/:partitionKey/schema-cache` now
  decodes request JSON through the shared `readJson` boundary before forwarding
  to `PartitionDO`.
- The boundary validates only that the public schema-cache body is a JSON object,
  appends the route `partitionKey`, keeps the route partition key authoritative,
  and reuses the existing partition schema-cache parser.
- Schema semantic validation, table/index persistence, schema-version metadata
  writes, transaction ownership, commit/OCC behavior, subscription routes,
  document/index reads, scheduler routes, delivery routes, executor-http routes,
  and `ValidatorJson` are unchanged.

Why it changed:

The public Worker partition schema-cache route was still reading raw JSON and
wrapping it before forwarding to `PartitionDO`. This checkpoint moves that
transport envelope into a named boundary while leaving schema interpretation
and storage in the Durable Object.

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

## Public Delivery Wake Boundary

Previous completed checkpoint: `c1c104d` Decode public live query delivery bodies.

What changed:

- Added `packages/flarex-backend/src/delivery/PublicWakeRouteBoundary.ts` to
  own the public Worker `wake-delivery` body read.
- `POST /deployments/:deploymentId/sync/wake-delivery` now decodes request JSON
  through the shared `readJson` boundary before forwarding to `DeliveryDO`.
- The boundary appends the route `deploymentId`, keeps the route deployment id
  authoritative over any body value, and reuses the existing `DeliveryDO` wake
  parser for `limit`, `maxBatches`, and `leaseDurationMs`.
- Authorization order, `DeliveryDO` wake/drain behavior, claim/fanout/ack
  semantics, scheduler routes, live-query delivery fanout, partition routes,
  executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

After the public live-query delivery callback moved behind a named route
boundary, the public wake callback remained a direct JSON read in the Worker.
This checkpoint narrows that transport edge while leaving delivery draining and
acknowledgement ownership inside `DeliveryDO`.

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

## Public Live Query Delivery Boundary

Previous completed checkpoint: `ac853a0` Decode partition commit bodies.

What changed:

- Added `packages/flarex-backend/src/liveQueryDelivery/RouteBoundary.ts` to own
  the public Worker live-query delivery body read.
- `POST /deployments/:deploymentId/sync/deliver-live-query` now decodes request
  JSON through the shared `readJson` boundary before connection fanout.
- The boundary keeps the existing delivery envelope parser and maps parser
  errors to JSON `400 { error }` responses.
- Authorization order, deployment target validation, connection fanout,
  `ConnectionDO` delivery routing, skip accounting, `DeliveryDO` wake/drain
  behavior, scheduler routes, partition routes, executor-http routes, and
  `ValidatorJson` are unchanged.

Why it changed:

After the connection-side delivery boundary existed, the public Worker callback
route still read raw JSON directly before grouping deliveries by connection.
This checkpoint narrows only that public transport edge while keeping delivery
semantics and fanout ownership unchanged.

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

## Partition Commit Boundary

Previous completed checkpoint: `a9d1e67` Decode partition subscription bodies.

What changed:

- Extended `packages/flarex-backend/src/partition/RouteBoundary.ts` to own
  `PartitionDO` commit body reads.
- `POST /commit` now decodes request JSON through the shared `readJson`
  boundary before commit/OCC execution runs.
- The public Worker partition commit forwarding route now uses the same commit
  boundary before forwarding to `PartitionDO`.
- The request envelope keeps the current required integer `beginTs`, optional
  integer `schemaVersion`, optional string `source`, optional string
  `idempotencyKey`, optional object `readSet` with document/table/index read
  arrays, and required `writes` array with integer `tableId`, optional
  non-empty `id`, and JSON `value`.
- Idempotency lookup, schema-version mismatch behavior, generated IDs for
  missing write IDs, write validation, table/placement/schema checks,
  transaction ownership, OCC conflict detection, write-log persistence,
  invalidation notification, document/index reads, schema-cache, subscription
  routes, and `ValidatorJson` are unchanged.

Why it changed:

After schema-cache and subscription requests moved behind named partition
route-boundary helpers, commit remained the last direct body read in
`PartitionDO`. Because commit owns correctness-sensitive transaction and OCC
behavior, this checkpoint only validates the transport envelope and leaves
commit execution in the Durable Object.

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

## Partition Subscription Boundary

Previous completed checkpoint: `afe8390` Decode partition schema-cache bodies.

What changed:

- Extended `packages/flarex-backend/src/partition/RouteBoundary.ts` to own
  `PartitionDO` subscription body reads.
- `POST /subscriptions/register`, `POST /subscriptions/unregister`, and
  `POST /subscriptions/unregister-connection` now decode request JSON through
  the shared `readJson` boundary before subscription table mutations run.
- Registration keeps the current required non-empty `connectionName`, integer
  `queryId`, and object `readSet`; unregister keeps required non-empty
  `connectionName` and integer `queryId`; unregister-connection keeps required
  non-empty `connectionName`.
- Existing validation messages for `connectionName`, `queryId`, `readSet`, and
  malformed JSON are preserved.
- SQL insert/delete ownership, invalidation scanning, commit/OCC behavior,
  schema-cache, document/index reads, ConnectionDO callers, public Worker
  forwarding, and `ValidatorJson` are unchanged.

Why it changed:

After the schema-cache body moved behind the partition route boundary, the
subscription routes were the next small direct JSON reads in `PartitionDO`.
This checkpoint moves only those transport envelopes and leaves the
subscription table mutations and invalidation logic in the Durable Object.

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

## Partition Schema Cache Boundary

Previous completed checkpoint: `8de16fb` Decode scheduler cleanup bodies.

What changed:

- Added `packages/flarex-backend/src/partition/RouteBoundary.ts` to own the
  `PartitionDO` schema-cache body read.
- `PUT /schema-cache` now decodes request JSON through the shared `readJson`
  boundary before schema-cache validation and storage writes run.
- The boundary accepts only JSON object envelopes while preserving both current
  wrapped `{ partitionKey, schema }` bodies and legacy flat
  `{ partitionKey, version, tables, indexes }` bodies for
  `PartitionDO.putSchemaCache(...)`.
- Schema semantic validation, partition-key validation, table/index
  persistence, schema-version metadata writes, transaction ownership,
  commit/OCC behavior, subscription routes, document/index reads, public Worker
  forwarding, and `ValidatorJson` are unchanged.
- Malformed JSON and non-object schema-cache envelopes return JSON `400`
  responses before schema-cache validation or storage work.

Why it changed:

After the smaller connection, delivery, execution, deployment, registry, and
scheduler route boundaries moved behind named helpers, `PartitionDO
/schema-cache` remained a direct body read on a correctness-sensitive object.
This checkpoint moves only the transport envelope and deliberately leaves
schema-cache semantics and commit logic inside `PartitionDO`.

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

## Scheduler Connection Cleanup Boundary

Previous completed checkpoint: `6634f8f` Decode scheduler dead-letter bodies.

What changed:

- Extended `packages/flarex-backend/src/scheduler/RouteBoundary.ts` to own
  `SchedulerDO` live-query connection cleanup body reads.
- `POST /cleanup/live-query-connections` now decodes request JSON through the
  shared `readJson` boundary before executor cleanup calls run.
- The request envelope keeps the current required non-empty `deploymentId`,
  `projectId` from request or configured environment fallback, and optional ISO
  `expiredAt`; extra fields are ignored.
- Existing `projectId` compatibility is preserved: explicit non-empty request
  value wins, invalid explicit value returns `400`, missing value uses
  `FLAREX_PROJECT_ID`, and missing both returns the existing JSON `400`.
- Malformed JSON and invalid cleanup request fields return JSON `400`
  responses before executor calls are made.
- SchedulerDO delivery reconcile, connection cleanup reconcile, rerun,
  dead-letter, continuation routes, DeliveryDO, ConnectionDO, PartitionDO,
  executor-http, and `ValidatorJson` are unchanged.

Why it changed:

After reconcile, rerun, and dead-letter routes moved behind the scheduler route
boundary, the direct live-query connection cleanup route remained the next
SchedulerDO path reading raw JSON before entering executor maintenance. This
checkpoint keeps cleanup execution in SchedulerDO while making the transport
envelope explicit.

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

## Scheduler Dead Letter Delivery Boundary

Previous completed checkpoint: `e75622d` Decode scheduler rerun bodies.

What changed:

- Extended `packages/flarex-backend/src/scheduler/RouteBoundary.ts` to own
  `SchedulerDO` live-query delivery dead-letter body reads.
- `POST /dead-letter/live-query-deliveries` now decodes request JSON through
  the shared `readJson` boundary before executor dead-letter scans and
  reconnect fanout run.
- The request envelope keeps the current optional non-empty `deploymentId`,
  optional ISO `olderThan`, optional positive integer `stuckAfterMs` only when
  `olderThan` is absent, optional positive integer `minAttempts`, `limit`, and
  `maxBatches`, optional passthrough `cursor`, optional non-empty `reason`, and
  optional ISO `deadLetteredAt`; extra fields are ignored.
- Existing defaults and precedence behavior for `olderThan`, `stuckAfterMs`,
  `minAttempts`, `limit`, `reason`, `deadLetteredAt`, and `maxBatches` are
  preserved.
- Malformed JSON and invalid dead-letter request fields return JSON `400`
  responses before executor calls are made.
- SchedulerDO delivery reconcile, connection cleanup reconcile, rerun,
  cleanup, continuation routes, DeliveryDO, ConnectionDO, PartitionDO,
  executor-http, and `ValidatorJson` are unchanged.

Why it changed:

After reconcile and rerun routes moved behind the scheduler route boundary, the
dead-letter route remained a SchedulerDO path reading raw JSON before entering
executor dead-letter scans and force-reconnect fanout. This checkpoint keeps
that operational behavior in SchedulerDO while making the transport envelope
explicit.

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

## Scheduler Live Query Rerun Boundary

Previous completed checkpoint: `4864cd5` Decode scheduler connection reconcile
bodies.

What changed:

- Extended `packages/flarex-backend/src/scheduler/RouteBoundary.ts` to own
  `SchedulerDO` live-query subscription rerun body reads.
- `POST /rerun/live-query-subscriptions` now decodes request JSON through the
  shared `readJson` boundary before pending rerun state is constructed.
- The request envelope keeps the current required non-empty `deploymentId`,
  optional non-empty `projectId`, and optional positive integer `limit`,
  `deliveryLimit`, and `maxBatches`; extra fields are ignored.
- Malformed JSON and invalid rerun request fields return JSON `400` responses
  before executor calls are made.
- SchedulerDO delivery reconcile, connection cleanup reconcile, dead-letter,
  cleanup, continuation routes, DeliveryDO, ConnectionDO, PartitionDO,
  executor-http, and `ValidatorJson` are unchanged.

Why it changed:

After the delivery and connection cleanup reconcile routes moved behind the
scheduler route boundary, live-query subscription rerun remained the next
SchedulerDO route reading raw JSON before entering pending rerun persistence,
executor rerun calls, delivery wake fanout, and retry behavior. This
checkpoint keeps that stateful orchestration in SchedulerDO while making the
transport envelope explicit.

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

## Scheduler Connection Cleanup Reconcile Boundary

Previous completed checkpoint: `46d1782` Decode scheduler delivery reconcile
bodies.

What changed:

- Extended `packages/flarex-backend/src/scheduler/RouteBoundary.ts` to own
  `SchedulerDO` live-query connection cleanup reconcile body reads.
- `POST /reconcile/live-query-connections` now decodes request JSON through the
  shared `readJson` boundary before durable cleanup continuation and
  fresh-request coalescing logic runs.
- The request envelope keeps the current optional ISO `expiredAt`, positive
  integer `limit`, and optional cursor with ISO `oldestExpiredAt` and non-empty
  `deploymentId`; extra fields are ignored.
- Malformed JSON and invalid connection cleanup reconcile cursors return JSON
  `400` responses before executor calls are made.
- SchedulerDO delivery reconcile, dead-letter, cleanup, rerun routes,
  DeliveryDO, ConnectionDO, PartitionDO, executor-http, and `ValidatorJson` are
  unchanged.

Why it changed:

After delivery reconcile moved behind a scheduler route boundary, the live-query
connection cleanup reconcile route remained the next SchedulerDO path reading a
raw body before entering durable continuation and coalescing behavior. This
checkpoint keeps cleanup state ownership in SchedulerDO while making the
transport envelope explicit.

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

## Scheduler Delivery Reconcile Boundary

Previous completed checkpoint: `28a783e` Decode artifact runtime invoke bodies.

What changed:

- Added `packages/flarex-backend/src/scheduler/RouteBoundary.ts` to own
  `SchedulerDO` live-query delivery reconcile body reads.
- `POST /reconcile/live-query-deliveries` now decodes request JSON through the
  shared `readJson` boundary before durable continuation and keyed coalescing
  logic runs.
- The request envelope keeps the current optional positive integer `limit`,
  `deliveryLimit`, and `maxBatches` fields plus the optional cursor with ISO
  `oldestCreatedAt` and non-empty `deploymentId`; extra fields are ignored.
- Malformed JSON and invalid delivery-reconcile cursors return JSON `400`
  responses before executor calls are made.
- SchedulerDO connection cleanup, rerun, dead-letter, cleanup routes,
  DeliveryDO, ConnectionDO, PartitionDO, executor-http, and `ValidatorJson` are
  unchanged.

Why it changed:

SchedulerDO still had several internal POST routes reading raw JSON bodies.
This checkpoint starts with the delivery reconcile route because it owns the
durable continuation/coalescing path that has the most scheduler-specific risk,
while keeping that stateful logic outside the body parser.

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

## Artifact Runtime Invoke Boundary

Previous completed checkpoint: `c6bb370` Decode delivery wake bodies.

What changed:

- Added `packages/flarex-backend/src/artifactRuntime/RouteBoundary.ts` to own
  execution artifact runtime `/invoke` body reads.
- `createExecutionArtifactRuntimeService(...)` now decodes the invoke payload
  before artifact header validation, source-package resolution, materializer
  cache lookup, or artifact invocation.
- Malformed JSON and shape-invalid payloads keep the existing runtime-service
  compatibility response: JSON `400` with
  `Invalid execution artifact invoke payload.`.
- Authorization, artifact header mismatch checks, runtime-store
  source-package loading, materializer cache behavior, invoke failure status
  preservation, Worker routing, DeliveryDO, PartitionDO, executor-http, and
  `ValidatorJson` are unchanged.

Why it changed:

The artifact runtime service was the remaining small backend body boundary that
used inline `request.json().catch(() => null)` plus a local payload guard. This
checkpoint moves that transport edge into a named boundary without changing the
runtime materialization or invocation semantics.

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

## Delivery Wake Boundary

Previous completed checkpoint: `2c7f8c6` Decode connection invalidation bodies.

What changed:

- Added `packages/flarex-backend/src/delivery/RouteBoundary.ts` to own
  `DeliveryDO` wake body reads.
- `POST /wake` now decodes request JSON through the shared `readJson`
  boundary and validates the wake envelope before drain work starts.
- The wake envelope keeps the current required `deploymentId` plus optional
  positive integer `limit`, `maxBatches`, and `leaseDurationMs` fields; extra
  fields are ignored.
- Malformed JSON and invalid wake envelopes now return JSON `400` responses
  from the delivery route.
- Delivery defaults, claim-owner creation, continuation persistence,
  claim/fanout/ack behavior, failure summaries, SchedulerDO, Worker public wake
  forwarding, PartitionDO, executor-http, and `ValidatorJson` are unchanged.

Why it changed:

After connection delivery and invalidation routes moved behind named
boundaries, `DeliveryDO /wake` remained a small internal route using a typed
`readJson<DeliveryWakeRequest>` cast. This checkpoint moves that HTTP/JSON edge
into a delivery boundary while leaving drain orchestration in `DeliveryDO`.

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

## Connection Invalidation Boundary

Previous completed checkpoint: `025481f` Decode connection delivery bodies.

What changed:

- Extended `packages/flarex-backend/src/connection/RouteBoundary.ts` to own
  `ConnectionDO` invalidation body reads.
- `POST /invalidate` now decodes request JSON through the shared `readJson`
  boundary and accepts the existing object envelope with integer `queryId`.
- Extra invalidation fields such as `invalidatedTs` remain ignored for
  compatibility with current partition notification callers.
- Malformed JSON and invalid invalidation envelopes now return JSON `400`
  responses from the connection route before rerun state is touched.
- Invalidation rerun orchestration, query registration, transition emission,
  live-query delivery, DeliveryDO, PartitionDO, executor-http, and
  `ValidatorJson` are unchanged.

Why it changed:

`ConnectionDO /invalidate` was the remaining small direct JSON body read in the
connection object after live-query delivery moved behind a route boundary. This
checkpoint moves only the invalidation transport edge into the same boundary
module while preserving existing query rerun behavior.

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

## Connection Live Query Delivery Boundary

Previous completed checkpoint: `94e9d0c` Decode public execution action bodies.

What changed:

- Added `packages/flarex-backend/src/connection/RouteBoundary.ts` to own
  `ConnectionDO` live-query delivery body reads.
- `POST /deliver/live-query` now decodes request JSON through the shared
  `readJson` boundary, then validates the delivery envelope through the
  existing live-query delivery parser.
- Invalid delivery envelopes and malformed JSON now return JSON `400` responses
  from the connection route instead of escaping as unhandled Durable Object
  failures.
- `ConnectionDO.deliverLiveQueryChanges(...)` now receives decoded
  `LiveQueryDeliveryChange[]` values and remains responsible for socket fanout,
  stale-skip accounting, and transition emission.
- `/invalidate`, WebSocket setup, heartbeat, force-reconnect, DeliveryDO,
  PartitionDO, executor-http, and `ValidatorJson` are unchanged.

Why it changed:

After execution start/syscall/finish/action forwarding moved behind explicit
route boundaries, `ConnectionDO /deliver/live-query` remained a small unchecked
internal body read. This checkpoint moves the delivery JSON edge into a named
boundary without changing live-query delivery semantics.

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

## Public Execution Action Forwarding Boundary

Previous completed checkpoint: `f21421f` Document execution abort boundary.

What changed:

- Added `packages/flarex-backend/src/execution/ActionRouteBoundary.ts` to own
  public Worker forwarding reads for execution `syscall`, `finish`, and
  `abort` actions.
- Public `syscall` bodies now decode through the existing execution syscall
  route-boundary parser before Worker forwarding reaches `ExecutionDO`.
- Public `finish` bodies now decode through the existing execution finish
  route-boundary parser before Worker forwarding reaches `ExecutionDO`.
- Public `abort` keeps the bodyless decision from the previous checkpoint:
  malformed JSON is rejected, while any well-formed JSON is forwarded to the
  bodyless Durable Object action.
- `ExecutionDO`, transaction behavior, PartitionDO, artifact runtime, and
  executor-http are unchanged.

Why it changed:

After start/syscall/finish/abort were audited at the Durable Object boundary,
the remaining public Worker execution forwarding path still used a generic
`readJson` for all actions. This checkpoint moves public forwarding to an
explicit action boundary without changing the runtime execution semantics.

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

## Execution Abort Boundary Decision

Previous completed checkpoint: `7316794` Decode execution finish bodies.

What changed:

- Audited the Cloudflare execution abort path and kept it bodyless at the
  `ExecutionDO` action boundary.
- Generated Cloudflare execution callers send `{}` to the public abort route
  because the Worker currently forwards execution actions by reading JSON once;
  extra well-formed JSON is currently ignored by the bodyless action.
- No Effect protocol parser was added for abort: there is no domain payload to
  validate inside `ExecutionDO`.
- Added route coverage proving abort clears the active session, staged writes
  are not committed, post-abort syscalls fail as no-session, generated `{}` and
  extra well-formed JSON both reach the bodyless action, and malformed public
  abort JSON still returns the shared `400 Request body must be JSON.` error.

Why it changed:

Start, syscall, and finish all carry domain data and now have schema-first
boundaries. Abort only signals cancellation. Adding a schema at the Durable
Object layer would manufacture a data contract for an intentionally ignored
body, so the migration records the boundary decision and locks current
compatibility behavior instead.

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

## Execution Finish Worker And DO Boundary

Previous completed checkpoint: `e77e2eb` Add execution finish protocol body.

What changed:

- Added `packages/flarex-backend/src/execution/FinishRouteBoundary.ts` to
  read finish JSON, decode through `flarex-protocol/execution`, map protocol
  validation failures to `HttpError(400, ...)`, and adapt protocol JSON into
  backend runtime `Json`.
- `ExecutionDO.fetch()` now uses the helper for internal `POST /finish`.
- `ExecutionDO.finish(...)`, return validation, query read-set response,
  mutation commit behavior, and `finally` session cleanup are unchanged.
- Execution start, syscall, abort, PartitionDO, artifact runtime, and
  executor-http are unchanged.

Why it changed:

The previous checkpoint introduced the shared finish request protocol shape.
This checkpoint removes unchecked `request.json<ExecutionFinishRequest>()`
from the Durable Object finish boundary without changing transaction
completion behavior.

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

## Execution Finish Request Protocol Boundary

Previous completed checkpoint: `652936f` Decode execution syscall bodies.

What changed:

- Added `ExecutionFinishRequestSchema` and `parseExecutionFinishRequest(...)`
  to `flarex-protocol/execution` for execution-session finish bodies.
- The protocol shape covers the current `{ value }` body accepted by
  `ExecutionDO.finish(...)`.
- Return values reuse the shared strict JSON transport validator.
- Worker routing, `ExecutionDO.fetch()`, `ExecutionDO.finish(...)`, start,
  syscall, abort, PartitionDO, artifact runtime, and executor-http are
  unchanged.

Why it changed:

Finish requests are the last unchecked execution-session body after start and
syscall. This checkpoint records the transport shape first, before replacing
the live `request.json()` parsing in `ExecutionDO`.

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

## Execution Syscall Worker And DO Boundary

Previous completed checkpoint: `f766101` Add execution syscall protocol bodies.

What changed:

- Added `packages/flarex-backend/src/execution/SyscallRouteBoundary.ts` to
  read syscall JSON, decode through `flarex-protocol/execution`, map protocol
  validation failures to `HttpError(400, ...)`, and adapt protocol JSON into
  backend runtime `Json`.
- `ExecutionDO.fetch()` now uses the helper for internal `POST /syscall`.
- The existing execution start boundary shares the same JSON adapter.
- `ExecutionDO.syscall(...)`, session lookup, transaction reads/writes,
  finish/abort, PartitionDO, artifact runtime, and executor-http are
  unchanged.

Why it changed:

The previous checkpoint introduced the shared syscall request protocol shape.
This checkpoint removes unchecked `request.json<ExecutionSyscallRequest>()`
from the Durable Object boundary without changing transaction behavior.

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

## Execution Syscall Request Protocol Boundary

Previous completed checkpoint: `7f6ec53` Decode execution start bodies.

What changed:

- Added `ExecutionSyscallRequestSchema` and `parseExecutionSyscallRequest(...)`
  to `flarex-protocol/execution` for the syscall bodies used by execution
  sessions.
- The protocol shape covers the current `get`, `query`, `insert`, `patch`,
  `replace`, and `delete` operations sent to `ExecutionDO.syscall`.
- Query range expression values and mutation payloads reuse the shared strict
  JSON transport validator, while `patch.value` is constrained to a JSON
  record.
- Worker routing, `ExecutionDO.fetch()`, `ExecutionDO.syscall`, finish/abort,
  PartitionDO, artifact runtime, and executor-http are unchanged.

Why it changed:

Execution syscalls are behavior-sensitive because they bridge generated user
code into the transaction runtime. This checkpoint records the protocol shape
first, before replacing any live `request.json()` parsing in `ExecutionDO`.

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

## Execution Start Worker And DO Boundary

Previous completed checkpoint: `d8b82fc` Add execution start protocol body.

What changed:

- Added `packages/flarex-backend/src/execution/StartRouteBoundary.ts` to read
  execution start JSON, decode through `flarex-protocol/execution`, map
  protocol validation failures to `HttpError(400, ...)`, and adapt protocol
  JSON into the backend runtime `Json` type.
- Public Worker `POST /deployments/:deploymentId/executions/start` now uses
  the helper and still injects the route deployment id over any body
  `deploymentId`.
- `ExecutionDO.fetch()` now uses the same helper for internal `POST /start`.
- `ExecutionDO.start(...)`, session lifecycle, syscalls, finish, abort, and
  transaction behavior are unchanged.

Why it changed:

The previous checkpoint introduced the execution start protocol schema. This
checkpoint removes unchecked start-body parsing from the live Worker/DO start
boundary without broadening into syscall or finish contracts.

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

## Execution Start Request Protocol Boundary

Previous completed checkpoint: `67689e2` Decode public invoke bodies.

What changed:

- Added `flarex-protocol/execution` with a schema-first
  `ExecutionStartRequestSchema` and `parseExecutionStartRequest(...)` parser
  for execution-session start bodies.
- The start contract requires string `deploymentId`, string `path`, and JSON
  `args`, with optional `partitionKey`, `projectId`, `idempotencyKey`, and
  `query` or `mutation` kind.
- Added a shared strict `JsonValue` schema helper in `flarex-protocol/json`
  and reused it from the public invoke protocol body parser.
- Worker execution routing and `ExecutionDO.fetch()` are unchanged in this
  checkpoint.

Why it changed:

Execution sessions are the next unchecked runtime boundary after public invoke.
This checkpoint records the transport shape first, before mixing schema
introduction with live Worker or Durable Object behavior changes.

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

## Public Invoke Worker Protocol Boundary

Previous completed checkpoint: `95cc914` Add public invoke protocol body.

What changed:

- Public Worker `POST /invoke` and
  `POST /deployments/:deploymentId/invoke` now decode request bodies through
  the shared `flarex-protocol/invoke` parser.
- Protocol validation failures become the existing backend `{ error: string }`
  400 envelope through the Worker `HttpError` boundary.
- Malformed JSON still returns `400 { error: "Request body must be JSON." }`.
- The invoke execution path is unchanged after decoding: route/header
  deployment resolution, required function path checks, kind parsing, artifact
  runtime dispatch, fallback `executeInvoke`, and `args ?? null` defaulting stay
  in `routeInvoke`.

Why it changed:

The previous checkpoint introduced the protocol-only public invoke body shape.
This checkpoint removes the unchecked Worker body casts without changing the
runtime execution/session model.

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

## Public Invoke Request Protocol Boundary

Previous completed checkpoint: `be053f6` Decode public source push bodies.

What changed:

- Added `flarex-protocol/invoke` with a schema-first
  `PublicInvokeRequestBodySchema` and `parsePublicInvokeRequestBody(...)`
  parser for the current public invoke body fields.
- The parser accepts optional `deploymentId`, `path`, `partitionKey`, `kind`,
  `idempotencyKey`, and JSON `args`.
- `args` is validated as actual JSON: primitives, arrays, and plain records
  only. Non-finite numbers, functions, non-plain objects, and symbol-keyed
  records are rejected.
- The Worker invoke routes are unchanged in this checkpoint.

Why it changed:

Public `/invoke` is the next unchecked transport boundary after deployment
push bodies. This checkpoint records the shared protocol shape first so a later
Worker adapter can replace casts without mixing parser introduction with live
invoke behavior changes.

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

- Added a `StartPushRequest` protocol schema/parser for the public
  source-only `{ sourcePackage }` push request.
- Public Worker `/push/start` now reads raw JSON first, preserves the existing
  analyzer-not-configured `501` response, then protocol-decodes the request
  only when analyzer forwarding will run.
- The backend public push boundary normalizes the protocol-decoded source
  package back into the existing backend `StartPushRequest` shape before
  calling the analyzer.
- Malformed JSON remains the shared `400 Request body must be JSON.`
  boundary.

Why it changed:

The previous checkpoint removed unchecked casts from public analyzed-start,
finish, and abandon push bodies. Source-only push was the remaining public
deployment-push body cast, but it has a compatibility-sensitive analyzer
configuration branch. This slice makes that boundary schema-first without
changing the no-analyzer response contract.

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

- Public Worker deployment-push forwarding now decodes `POST /push/start-analyzed`,
  `POST /push/:pushId/finish`, and `POST /push/:pushId/abandon` bodies through
  the existing deployment protocol parsers before forwarding to DeploymentDO.
- `DeploymentProtocolValidationError` is mapped at the public Worker edge to
  the existing `{ error: string }` 400 envelope.
- Malformed JSON still comes from the shared `readJson` helper, preserving
  `Request body must be JSON.`
- Source-only push analysis, artifact preflight, DeploymentDO generated-handler
  routing, deep deployment semantic validation, route paths, and response bodies
  are unchanged.

Why it changed:

DeploymentDO is now generated-HttpApi backed, but public Worker forwarding still
had unchecked `readJson<T>` casts for deployment mutation bodies. This moves the
next stable transport boundary to schema-first parsing without expanding the
slice into analyzer or PartitionDO behavior.

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

## Registry Generated HttpApi Boundary

Previous completed checkpoint: `14930c4` Extract deployment HttpApi route
boundary.

What changed:

- RegistryDO now owns a per-instance generated Registry HttpApi web handler
  built from its object-local SQL-backed registry layer.
- `GET /health`, `GET /deployments`, and `POST /deployments` flow through the
  generated handler after a compatibility helper accepts the route.
- `POST /deployments` still uses `readJson` plus
  `parseCreateDeploymentRequest` before generated-handler execution, preserving
  invalid JSON and schema-invalid response messages at the DO boundary.
- Non-GET `/health`, unknown routes, SQL initialization, service/store logic,
  and protocol schemas are unchanged.

Why it changed:

Registry is the smallest complete Durable Object API in the backend. Routing it
through HttpApi proves the generated handler lifecycle on real DO state before
attempting larger PartitionDO or public worker conversions.

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

## Deployment Finish Response HTTP Status Boundary

Previous completed checkpoint: `78f0661` Add finish push request protocol
parser.

What changed:

- Added `finishPushHttpStatus(response)` to the deployment HTTP-boundary helper.
- Replaced route-local finish response status selection with the helper.
- Added direct tests for activated and rejected finish response status mapping.

Why it changed:

Finish-push status selection is HTTP-boundary behavior, not service
orchestration. Moving it beside deployment failure mapping keeps
`DeploymentDO.fetch()` focused on routing, parsing, and response construction
while preserving the same runtime boundary.

Convex references inspected:

- No new Convex source files were required. This checkpoint is a Flarex
  response-boundary cleanup.

Cloudflare differences:

- Durable Object runtime behavior is unchanged. `DeploymentDO.runDeployment()`
  remains the only `ManagedRuntime.runPromise` boundary.

Known limitations:

- This is not an HttpApi migration.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentStorageSchema.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Finish Request Protocol Boundary

Previous completed checkpoint: `817f1f3` Extract deployment storage schema
initialization.

What changed:

- Added `FinishPushRequest` and `parseFinishPushRequest` to
  `flarex-protocol/deployment`.
- Replaced the unchecked `readJson<FinishPushRequest>` cast in
  `DeploymentDO.fetch()` with the protocol parser.
- Added protocol and route tests for finish request body validation.

Why it changed:

The finish route was the remaining deployment push route with a manually cast
request body. Making that boundary protocol-owned gives the later router or
HttpApi spike a precise contract without moving service orchestration.

Convex references inspected:

- No new Convex source files were required. This checkpoint is a Flarex
  request-boundary cleanup.

Cloudflare differences:

- Durable Object runtime behavior is unchanged after parsing. The finish body
  still does not affect `DeploymentService.finishPush`.
- Invalid JSON still comes from the shared `readJson` boundary before protocol
  parsing.

Known limitations:

- `activate` is accepted as an optional protocol field but remains unused by
  the current service.
- This is not an HttpApi migration.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-protocol typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentStorageSchema.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-protocol test -- test/deployment.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Storage Schema Initialization

Previous completed checkpoint: `884741d` Centralize deployment service route
use.

What changed:

- Added `deployment/StorageSchema.ts` with `initializeDeploymentStorage(sql)`.
- Moved deployment table creation, additive column guards, and initial
  `schema_version` seeding out of `DeploymentDO`.
- Added direct tests for creation/migration ordering and for continuing when
  additive column migrations fail because the column already exists.

Why it changed:

`DeploymentDO` should own the Durable Object SQL handle and runtime boundary,
but the schema bootstrap details are storage infrastructure. Extracting them
keeps the constructor focused on object setup while preserving the current
plain Durable Object initialization model.

Convex references inspected:

- No new Convex source files were required. This checkpoint is a Flarex
  Durable Object storage-initialization cleanup.

Cloudflare differences:

- Durable Object SQLite remains the storage engine.
- Initialization still runs synchronously from the Durable Object constructor.
- Additive migrations still swallow `ADD COLUMN` failures because Durable
  Object SQLite has no `ADD COLUMN IF NOT EXISTS`.

Known limitations:

- Storage initialization is still not an Effect layer concern.
- `HttpApiBuilder` remains a later RegistryDO spike, not part of this
  checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentStorageSchema.test.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Service Use Route Helper

Previous completed checkpoint: `169abc9` Extract deployment HTTP failure
boundary.

What changed:

- Added a private `DeploymentDO.runDeploymentService()` helper that wraps
  `DeploymentService.use(...)`.
- Replaced repeated route-branch `this.runDeployment(DeploymentService.use(...))`
  calls with the helper.
- Kept `DeploymentDO.runDeployment()` as the single `ManagedRuntime.runPromise`
  boundary.

Why it changed:

The route branches should show HTTP work: route matching, JSON reading,
protocol parsing, request adaptation, and response status choices. The repeated
service-use wrapper was Effect plumbing, so centralizing it narrows the route
surface without hiding the runtime boundary.

Convex references inspected:

- No new Convex source files were required. This checkpoint is a Flarex
  Durable Object route-boundary cleanup.

Cloudflare differences:

- Durable Object runtime behavior is unchanged. The same ManagedRuntime bridge,
  deployment layer, storage handle, route paths, and response bodies are used.

Known limitations:

- `DeploymentDO` still owns storage schema initialization and migration guards.
- `HttpApiBuilder` remains a later RegistryDO spike, not part of this
  checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Service Failure HTTP Boundary

Previous completed checkpoint: `a1f4eb4` Lock deployment deep request
boundary.

What changed:

- Added a deployment HTTP-boundary helper for mapping typed service failures to
  the existing `HttpError` status/message results.
- Kept `DeploymentDO.runDeployment()` as the single ManagedRuntime boundary and
  moved only the post-Effect failure mapping into the helper.
- Added direct tests for active-not-found, push-not-found, abandon
  invalid-state, `HttpError` passthrough, and storage-error mapping.

Why it changed:

The deployment runtime boundary already converts typed Effect failures into
HTTP responses. Extracting the mapping makes the boundary explicit and directly
tested without hiding route parsing or introducing a nested runtime.

Convex references inspected:

- No new Convex source files were required. This checkpoint is a Flarex
  runtime-boundary cleanup.

Cloudflare differences:

- Durable Object runtime behavior is unchanged. `DeploymentDO` still owns SQL
  initialization, HTTP routing, JSON/protocol parsing, and the single
  `runDeployment` bridge.

Known limitations:

- `DeploymentDO.fetch()` remains a plain router with explicit
  `DeploymentService.use(...)` calls.
- `HttpApiBuilder` remains a later RegistryDO spike, not part of this
  checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentHttpBoundary.test.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Deep Request Boundary

Previous completed checkpoint: `7baf8e0` Inline deployment route service
bridges.

What changed:

- Locked the current analyzed-push request boundary with tests: the protocol
  parser validates only the envelope, and backend validation owns deep
  deployment analysis/codegen semantics.
- Preserved the existing single `DeploymentDO.runDeployment` runtime boundary
  and did not introduce a new Effect runtime bridge.

Why it changed:

The route currently needs backend-owned `HttpError(400, ...)` messages for
malformed deployment analysis payloads. Deep protocol request decoding would
change the runtime boundary behavior by failing before backend validation.

Convex references inspected:

- No new Convex source files were required. This checkpoint is a
  Flarex-internal runtime boundary guard.

Cloudflare differences:

- Durable Object runtime behavior is unchanged. The route still parses JSON in
  `fetch()`, adapts the request through backend validation, and crosses Effect
  once through `runDeployment`.

Known limitations:

- `DeploymentDO.fetch()` remains a plain router.
- Future HttpApi or route-helper work must preserve exact validation behavior
  before moving the boundary.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/push.test.ts
corepack pnpm --filter flarex-protocol test -- test/deployment.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment Route Runtime Bridge Cleanup

Previous completed checkpoint: `31971a4` Inline deployment start push route
bridge.

What changed:

- Inlined the remaining thin deployment route bridge methods into
  `DeploymentDO.fetch()`.
- Kept `DeploymentDO.runDeployment` as the ManagedRuntime boundary.
- Preserved finish-push JSON body parsing even though the body is not used by
  the service layer.
- Removed now-unused route bridge type imports from `DeploymentDO`.

Why it changed:

After deployment behavior moved behind services, the private route bridge
methods only delegated to `runDeployment`. Inlining them keeps the route flow
and runtime boundary visible in one place.

Convex references inspected:

- No new Convex source files were required. This checkpoint remains a
  Flarex-internal Durable Object cleanup.

Cloudflare differences:

- Durable Object runtime behavior is unchanged. The same ManagedRuntime bridge
  is still used through `DeploymentDO.runDeployment`.

Known limitations:

- Deep protocol decoding of `analysis` and `codegenAnalysis` remains separate
  from backend validation.
- `DeploymentDO.fetch()` now contains all deployment route-to-service calls
  directly.

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

## Deployment Start Push Runtime Bridge Cleanup

Previous completed checkpoint: `c053c93` Extract deployment start push input
validation.

What changed:

- Inlined the thin `DeploymentDO.startPush` private method into the
  `POST /push/start-analyzed` fetch branch.
- Kept `DeploymentDO.runDeployment` as the ManagedRuntime boundary.
- Kept protocol wrapper parsing and backend request adaptation in the fetch
  branch.
- Removed the unused `AnalyzedStartPushRequest` import from `DeploymentDO`.

Why it changed:

After start-push normalization moved into `deployment/Validation.ts`, the
private method only delegated to `runDeployment`. Inlining it keeps the runtime
boundary visible and removes a no-longer-useful method hop.

Convex references inspected:

- No new Convex source files were required. This checkpoint remains a
  Flarex-internal Durable Object cleanup.

Cloudflare differences:

- Durable Object runtime behavior is unchanged. The same ManagedRuntime bridge
  is still used through `DeploymentDO.runDeployment`.

Known limitations:

- Deep protocol decoding of `analysis` and `codegenAnalysis` remains separate
  from backend validation.
- Other deployment fetch branches still use small private methods.

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

## Deployment Start Push Service Input Validation

Previous completed checkpoint: `5e74840` Move deployment metadata access into
store.

What changed:

- Added `startAnalyzedPushInput` in `deployment/Validation.ts`.
- Moved backend analyzed start-push request normalization out of
  `DeploymentDO.startPush`.
- Kept `DeploymentDO.fetch()` responsible for HTTP routing, JSON reading, and
  protocol wrapper parsing.
- Added direct validation tests for generated codegen fallback, explicit
  codegen preservation, failed push input, and exact defensive validation
  errors.

Why it changed:

The deployment store boundary is now narrow enough that the remaining start
push work in the Durable Object is request normalization. Moving that pure
normalization beside the rest of deployment validation keeps the DO focused on
HTTP and runtime bridging.

Convex references inspected:

- No new Convex source files were required. This checkpoint remains a
  Flarex-internal validation boundary cleanup.

Cloudflare differences:

- Durable Object runtime behavior is unchanged. The runtime boundary remains
  `DeploymentDO.runDeployment`.

Known limitations:

- Deep protocol decoding of `analysis` and `codegenAnalysis` remains separate
  from backend validation.
- `DeploymentDO.fetch()` still calls a private `startPush` method for the
  service runtime bridge.

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

## Deployment Store Metadata Access

Previous completed checkpoint: `2d6c9c4` Move deployment schema application
into store.

What changed:

- Moved deployment metadata reads and writes into `DeploymentPushStore`.
- Removed `setMeta` and `getMeta` callbacks from `DeploymentPushStore.layer`
  and `makeDeploymentLayer`.
- Kept `DeploymentDO` responsible for SQL handle ownership, HTTP routing,
  runtime construction, table creation, migrations, and initial
  `schema_version` bootstrap.
- Updated direct store tests to exercise metadata reads and writes through
  fake SQL.

Why it changed:

The store now owns push reads and activation writes. Moving metadata access
behind the same store boundary removes the last deployment metadata callbacks
without changing the Durable Object runtime boundary.

Convex references inspected:

- No new Convex source files were required. This checkpoint remains a
  Flarex-internal store boundary cleanup.

Cloudflare differences:

- Durable Object SQLite storage remains the underlying database. The store
  reads and writes the `meta` table using the SQL handle passed into its layer.

Known limitations:

- `DeploymentDO` still owns schema creation, migration guards, and initial
  metadata bootstrap.
- Deep protocol decoding remains intentionally separate from backend
  validation.

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

## Deployment Store Schema Function Application

Previous completed checkpoint: `e739957` Move deployment push reads into
store.

What changed:

- Moved deployment schema and function application SQL writes into
  `DeploymentPushStore`.
- Removed `applySchema` and `applyFunctions` callbacks from
  `DeploymentPushStore.layer` and `makeDeploymentLayer`.
- Kept `DeploymentDO` responsible for SQL handle ownership, HTTP routing,
  runtime construction, and metadata callbacks.
- Updated direct store tests so finish-push validation failures occur through
  the store-owned application path.

Why it changed:

Push reads already moved into the store. The matching activation writes belong
at the same storage boundary so finish-push transaction behavior is owned in
one place while the Durable Object remains the host/runtime boundary.

Convex references inspected:

- No new Convex source files were required. This checkpoint remains a
  Flarex-internal store boundary cleanup.

Cloudflare differences:

- Durable Object SQLite storage is still the underlying database. The store
  performs the activation writes through the SQL handle passed into its layer.

Known limitations:

- Metadata access still uses callbacks supplied by `DeploymentDO`.
- Deep protocol decoding remains intentionally separate from backend
  validation.

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

## Deployment Store Push Read Validation

Previous completed checkpoint: `ce58f78` Extract deployment push row
normalization.

What changed:

- Moved the push-row SQL lookup into `DeploymentPushStore`.
- Removed the `readPush` callback from `DeploymentPushStore.layer` and
  `makeDeploymentLayer`.
- Kept `DeploymentDO` responsible for route handling, SQL ownership,
  schema/function application callbacks, and metadata callbacks.
- Updated direct store tests to provide fake SQL rows and exercise the
  store-owned read path.

Why it changed:

After row normalization moved into the validation module, the store can own the
actual push-row read without calling back into the Durable Object. This keeps
the typed storage error boundary closer to the SQL operation.

Convex references inspected:

- No new Convex source files were required. This checkpoint remains a
  Flarex-internal store boundary cleanup.

Cloudflare differences:

- Durable Object SQLite storage is still the underlying database. The store
  now performs the read using the SQL handle passed into its layer.

Known limitations:

- Schema/function application and metadata access still use callbacks supplied
  by `DeploymentDO`.
- Deep protocol decoding remains intentionally separate from backend
  validation.

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

## Deployment Push Row Validation

Previous completed checkpoint: `a5ff90c` Extract analyzed push adapter.

What changed:

- Moved push row normalization into `deployment/Validation.ts`.
- Moved generated codegen fallback construction beside the analysis/codegen
  validators.
- Kept `DeploymentDO.getPush` responsible for SQL row lookup.
- Added direct tests for generated codegen fallback, stored diagnostics
  preservation, and unknown stored push state errors.

Why it changed:

The previous slices moved request and deployment metadata validation out of the
Durable Object. Push row normalization is the matching read-side validation
piece and can move without changing storage ownership.

Convex references inspected:

- No new Convex source files were required. This checkpoint remains a
  Flarex-internal validation/read-normalization boundary cleanup.

Cloudflare differences:

- Durable Object SQLite reads are unchanged. Only the pure row-to-status
  conversion moved.

Known limitations:

- `DeploymentPushStore` still receives a `readPush` callback from
  `DeploymentDO`.
- Deep protocol decoding remains intentionally separate from backend
  validation.

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

## Deployment Start Push Adapter Validation

Previous completed checkpoint: `2e5f3dd` Extract deployment analysis
validators.

What changed:

- Moved `analyzedStartPushRequest` into `deployment/Validation.ts`.
- Kept `parseAnalyzedStartPushRequest` in `DeploymentDO.fetch()` as the
  HTTP/protocol boundary.
- Preserved source package normalization, diagnostics normalization,
  success/failure backend request shapes, optional `codegenAnalysis` handling,
  and the defensive missing-error branch.
- Added direct adapter tests alongside the existing route-level push tests.

Why it changed:

The adapter is pure protocol-to-backend normalization and already depends on
the deployment validators. Moving it beside those validators keeps
`DeploymentDO` focused on routing and service orchestration without changing
shared protocol decoding.

Convex references inspected:

- No new Convex source files were required. This checkpoint remains a
  Flarex-internal validation/adapter boundary cleanup.

Cloudflare differences:

- Durable Object routing and storage ownership are unchanged. The DO still
  catches protocol validation errors at the HTTP boundary.

Known limitations:

- Deep protocol decoding remains intentionally separate from this backend
  adapter.
- Row normalization still lives in `DeploymentDO`.

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

## Deployment Analysis Codegen Validation Module

Previous completed checkpoint: `eb0dcc2` Extract deployment schema
validators.

What changed:

- Moved `validateAnalysis`, `validateCodegenAnalysis`, and codegen metadata
  matching helpers into `deployment/Validation.ts`.
- Kept `DeploymentDO` responsible for HTTP handling, request routing, SQL
  writes, row normalization, and service orchestration.
- Reduced the temporary low-level helper exports introduced by the schema
  validator checkpoint.
- Added direct validator tests for analysis/codegen normalization and exact
  HTTP 400 message preservation.

Why it changed:

The validation module now owns the full backend deployment metadata validation
stack. `DeploymentDO` can call high-level validation entrypoints instead of
carrying the cross-field analysis/codegen implementation.

Convex references inspected:

- No new Convex source files were required. This checkpoint remains a
  Flarex-internal validation boundary cleanup.

Cloudflare differences:

- Durable Object routing and storage ownership are unchanged. The validation
  module still throws backend `HttpError` values consumed by the existing DO
  boundary.

Known limitations:

- `parseAnalyzedStartPushRequest` still decodes only the wrapper-level
  protocol shape.
- `analyzedStartPushRequest` remains the protocol-to-backend adapter in
  `DeploymentDO`.

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

## Deployment Schema Function Validation Module

Previous completed checkpoint: `3a257f3` Extract deployment request
validators.

What changed:

- Moved schema and function validation primitives into
  `deployment/Validation.ts`.
- Extracted `validateSchema`, `validateFunctions`,
  `validateFunctionPartitions`, `safeValidator`, and helper parsers from
  `DeploymentDO`.
- Kept `DeploymentDO` responsible for HTTP handling, SQL writes, row
  normalization, and deep analysis/codegen orchestration.
- Added direct validator tests for schema/function normalization and exact
  HTTP 400 message preservation.

Why it changed:

The previous slice created the validation module with source-package and
diagnostics helpers. This checkpoint moves the next pure validation layer
without changing route behavior or the deep deployment analysis/codegen flow.

Convex references inspected:

- No new Convex source files were required. This checkpoint remains a
  Flarex-internal validation boundary cleanup.

Cloudflare differences:

- Durable Object routing and storage ownership are unchanged. The validation
  module still throws backend `HttpError` values consumed by the existing DO
  boundary.

Known limitations:

- `validateAnalysis` and `validateCodegenAnalysis` still live in
  `DeploymentDO`.
- `parseAnalyzedStartPushRequest` still decodes only the wrapper-level
  protocol shape.

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

## Deployment Source Package Validation Module

Previous completed checkpoint: `64f1e75` Extract deployment error types.

What changed:

- Added `deployment/Validation.ts` for source-package and diagnostics
  validation helpers.
- Moved `validateSourcePackage` and `validateDiagnostics` out of
  `DeploymentDO`.
- Kept source package module/function normalization and diagnostics truncation
  behavior unchanged.
- Added direct validator tests for normalization and exact HTTP 400 message
  preservation, while retaining route-level push validation coverage.

Why it changed:

These helpers are the smallest start-push validators that can be extracted
without touching deep deployment analysis or codegen cross-field checks. This
creates the validation module boundary before the higher-risk semantic
validators move.

Convex references inspected:

- No new Convex source files were required. This checkpoint continues Flarex's
  deployment migration around the current Durable Object push boundary.

Cloudflare differences:

- `DeploymentDO` still owns HTTP request handling, response mapping, and
  Durable Object SQLite state. The validation module is backend-local.

Known limitations:

- Deep `validateAnalysis`, `validateCodegenAnalysis`, schema/function
  validators, and `safeValidator` remain in `DeploymentDO`.
- `parseAnalyzedStartPushRequest` still decodes only the wrapper-level
  protocol shape.

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

## Deployment Error Module Validation

Previous completed checkpoint: `566ddfa` Extract deployment push read service.

What changed:

- Moved deployment service tagged errors into `deployment/Errors.ts`.
- Kept `DeploymentPushNotFoundError`, `DeploymentPushInvalidStateError`, and
  `DeploymentActiveDeploymentNotFoundError` names, fields, and constructors
  unchanged.
- Updated `DeploymentService`, `DeploymentDO`, and deployment service tests to
  import typed errors from the dedicated error module.
- Preserved `DeploymentDO.runDeployment` HTTP mapping for no active deployment,
  unknown push, and invalid abandon state.

Why it changed:

The deployment service now owns several read/write branches. Pulling typed
errors into a small module keeps the Effect error boundary reusable before
semantic validator extraction starts.

Convex references inspected:

- No new Convex source files were required. This is a Flarex-internal module
  boundary cleanup around the existing deployment state machine.

Cloudflare differences:

- Durable Object routing and SQLite ownership are unchanged. The split only
  changes where typed Effect error classes live.

Known limitations:

- Deep deployment analysis/codegen request validation remains in
  `DeploymentDO`.
- No new protocol schemas or router abstraction were introduced.

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

## Deployment Push Read Service Validation

Previous completed checkpoint: `a93b051` Extract active deployment service
read.

What changed:

- Added `DeploymentService.getPush` for single-push status read orchestration.
- Kept `DeploymentDO.fetch()` as the `GET /push/:id` HTTP route boundary.
- Reused typed `DeploymentPushNotFoundError` and mapped it through
  `DeploymentDO.runDeployment` to the existing
  `404 Unknown push: <id>` response.
- Kept row lookup and row-to-status normalization behind the existing
  `DeploymentPushStore.getPush` port.
- Added service tests for successful push reads, typed not-found, and typed
  storage failure propagation.

Why it changed:

Push lifecycle writes and active deployment reads are already behind the
deployment service. Moving single-push reads completes the current push-state
route surface before deeper validator or router work.

Convex references inspected:

- No new Convex source files were required. This checkpoint continues the
  Flarex Durable Object push-state service extraction already tracked in the
  deployment roadmap.

Cloudflare differences:

- The Durable Object still owns HTTP routing and SQLite storage. The service
  reads through the per-DO store port so lifecycle ownership remains local.

Known limitations:

- Deep deployment analysis/codegen request validation remains in
  `DeploymentDO`.
- Push row normalization still goes through the existing `readPush` callback.

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

## Deployment Active Read Service Validation

Previous completed checkpoint: `b8c25b9` Extract deployment abandon service.

What changed:

- Added `DeploymentService.getActiveDeployment` for active deployment read
  orchestration.
- Kept `DeploymentDO.fetch()` as the `GET /deployment` HTTP route boundary.
- Added typed `DeploymentActiveDeploymentNotFoundError` and mapped it at
  `DeploymentDO.runDeployment` to the existing `404 No active deployment.`
  response.
- Moved active metadata reads, active push lookup, analyzed metadata checks,
  execution artifact reference validation, schema version extraction, and
  active response construction behind
  `DeploymentPushStore.getActiveDeployment`.
- Preserved corrupt-active-state `HttpError` passthrough so missing active
  push metadata does not collapse into a generic storage error.

Why it changed:

Push lifecycle writes are now behind the deployment service. Active deployment
reads are the next narrow route because they consume the same activation
metadata while leaving request validation and deployment analysis semantics
unchanged.

Convex references inspected:

- No new Convex source files were required. This checkpoint continues the
  Flarex Durable Object active-deployment metadata extraction already tracked
  in the deployment roadmap.

Cloudflare differences:

- The Durable Object still owns HTTP routing and the SQLite/metadata storage
  instance. The Effect store receives callbacks for metadata and push-row
  reads to keep DO lifecycle ownership local.

Known limitations:

- Single-push `GET /push/:id` reads still live in `DeploymentDO`.
- Deep deployment analysis/codegen request validation remains in
  `DeploymentDO`.
- Push row normalization still goes through the existing `readPush` callback.

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

## Deployment Abandon Service Validation

Previous completed checkpoint: `42cccd5` Extract deployment finish service.

What changed:

- Added `DeploymentService.abandonPush` for abandon-push orchestration.
- Kept `DeploymentDO.fetch()` and `parseAbandonPushRequest` as the HTTP/body
  validation boundary.
- Added typed service errors for unknown pushes and invalid abandon states,
  then mapped them at `DeploymentDO.runDeployment` to the existing 404 and
  409 HTTP messages.
- Moved timestamp acquisition, default/truncated reason normalization,
  transaction-level state guarding, the SQL abandoned-state update, and
  abandoned push read behind
  `DeploymentPushStore.abandonPush`.
- Added service tests for controlled clock/reason writes, default/truncated
  reason handling, typed not-found, typed invalid-state, and typed abandon
  storage failures, plus store-level `HttpError` passthrough.

Why it changed:

Push-start and finish-push are now behind the deployment service. Abandon-push
is the remaining push lifecycle write path that can move without changing deep
deployment analysis validation or active deployment reads.

Convex references inspected:

- No new Convex source files were required. This checkpoint continues the
  Flarex Durable Object state-machine extraction already captured in the
  deployment roadmap.

Cloudflare differences:

- The Durable Object still owns HTTP routing, body decoding, SQLite storage,
  and push row normalization. The Effect service is per Durable Object
  instance and keeps Cloudflare lifecycle ownership local.

Known limitations:

- Active deployment reads still live in `DeploymentDO`.
- Deep deployment analysis/codegen request validation remains in
  `DeploymentDO`.
- Store row normalization still goes through the existing `readPush` callback.

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

## Deployment Finish Service Validation

Previous completed checkpoint: `224f097` Extract deployment push-start
service.

What changed:

- Added `DeploymentService.finishPush` for finish-push orchestration with
  typed `DeploymentPushNotFoundError` and existing `DeploymentSqlError`
  propagation.
- Added `DeploymentArtifacts` as an Effect runtime dependency so artifact ref
  creation is tested as a service dependency instead of hidden in
  `DeploymentDO.finishPush`.
- Moved analyzed-push preflight, controlled timestamp acquisition, activation
  transaction, schema/function application, active metadata writes, and
  activated response construction behind `DeploymentPushStore.finishPush`.
- Kept `DeploymentDO.fetch()` responsible for HTTP routing, 404 mapping for
  unknown pushes, storage-error 500 mapping, and rejected finish response 409
  mapping.
- Preserved activation validation `HttpError` status/message passthrough so
  schema/function validation failures do not collapse into storage errors.

Why it changed:

Push-start proved the deployment service/store/runtime shape. Finish-push is
the next correctness-sensitive write path, so this slice moves orchestration
behind Effect while preserving the existing activation behavior and response
surface.

Convex references inspected:

- No new Convex source files were required. This checkpoint continues the
  repo-local Cloudflare Durable Object extraction while preserving the
  documented deployment activation direction.

Cloudflare differences:

- The Durable Object still owns the SQLite instance, schema/function in-memory
  mutation helpers, and HTTP lifecycle. The service is composed per Durable
  Object instance and does not become a global deployment singleton.

Known limitations:

- Finish-push request parsing remains unchanged because the request currently
  carries no behavior-driving fields.
- Abandon-push and active deployment reads still live in `DeploymentDO`.
- Schema/function semantic validators remain outside the Effect service until
  exact HTTP message parity can be preserved.

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

## Deployment Push Start Service Validation

Previous completed checkpoint: `bbdbec2` Add deployment analysis protocol
schemas.

What changed:

- Added a narrow Effect-backed `DeploymentService.startAnalyzedPush` path for
  analyzed push-start persistence.
- Kept request parsing and semantic validation in `DeploymentDO`, including
  the existing source package, diagnostics, deployment analysis, and codegen
  validation messages.
- Added service-level tests with controlled clock/id services and typed
  `DeploymentSqlError` propagation.
- Kept focused push lifecycle tests covering the real Durable Object route.

Why it changed:

The protocol schemas now cover the response surface. This checkpoint starts
the real Effect transformation at the smallest write path that can be proven
without changing HTTP behavior.

Convex references inspected:

- No new Convex source files were required. This slice follows the existing
  repo-local Registry Effect service pattern while preserving the documented
  Convex-style deployment metadata direction.

Cloudflare differences:

- The Durable Object still owns the HTTP request boundary, validation helpers,
  and SQLite instance. The Effect service is scoped to per-DO runtime
  composition and the push-start transaction.

Known limitations:

- Finish-push, abandon-push, active deployment reads, and deep request decoding
  remain in `DeploymentDO`.
- Storage failures are mapped to typed `DeploymentSqlError` and returned as a
  generic deployment storage HTTP 500 from the DO boundary.

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

## Deployment Analysis Response Protocol Validation

Previous completed checkpoint: `bc2d552` Add deployment push-start protocol
schema.

What changed:

- `flarex-protocol/deployment` now contains structural Effect Schema contracts
  for `ValidatorJson`, deployment schema tables/indexes, function metadata,
  deployment analysis, codegen analysis, active deployment status, and
  finish-push responses.
- `parsePushStatus` now validates deep `analysis` and `codegenAnalysis`
  response payloads instead of leaving them as `unknown`.
- Backend push tests now parse successful push status, active deployment, and
  activated finish response bodies through the shared protocol parsers.
- Focused protocol tests cover valid deep deployment/codegen analysis payloads,
  push/finish response parsing, and malformed deep codegen rejection.

Why it changed:

Goal 5 proved the analyzed push-start wrapper boundary. The next safe step is
to make response parsing validate the deep deployment payloads before moving
those checks into write-route request handling.

Convex references inspected:

- No new Convex source files were required. This checkpoint mirrors Flarex's
  current backend-owned deployment metadata shape; Convex deployment analysis
  references remain tracked in the deployment roadmap.

Cloudflare differences:

- The runtime still validates writes inside the Cloudflare Durable Object. The
  new schemas are shared response/parser contracts and do not replace
  `DeploymentDO` semantic validators.

Known limitations:

- `parseAnalyzedStartPushRequest` still keeps `analysis`, `codegenAnalysis`,
  source package semantics, and diagnostics item validation with
  `DeploymentDO` helpers so existing HTTP 400 messages remain stable.
- Structural schemas do not yet encode cross-field semantics such as partition
  metadata matching table placement or codegen functions covering every
  deployment function.

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

## Deployment Push Start Protocol Validation

Previous completed checkpoint: `6d026a9` Add deployment abandon protocol
schema.

What changed:

- DeploymentDO analyzed push-start bodies now decode through
  `flarex-protocol/deployment`.
- The protocol layer validates source package presence, diagnostics array
  shape, the failed-analysis `error` requirement, and success/failure mutual
  exclusion before `startPush` runs.
- Existing DeploymentDO validators still validate source package semantics,
  diagnostics items, deployment analysis, codegen analysis, schema, functions,
  validators, and partition metadata.
- Focused push tests now cover invalid JSON, preserved source package
  validation, invalid diagnostics wrapper, mixed success/failure wrappers,
  valid analyzed push response parsing, and failed analysis push response
  parsing.

Why it changed:

This moves the next stable transport contract into the protocol package while
keeping the correctness-sensitive deployment metadata validation path
unchanged.

Convex references inspected:

- No new Convex source files were required. The same deploy-analysis direction
  remains documented in the deployment roadmap.

Cloudflare differences:

- Validation still occurs inside a Cloudflare Durable Object `fetch()` handler,
  with `DeploymentProtocolValidationError` mapped to HTTP 400 before the
  existing error helper.

Known limitations:

- Deep `sourcePackage`, diagnostics item, `analysis`, and `codegenAnalysis`
  schemas are intentionally deferred for the start-analyzed route so existing
  DeploymentDO validation messages stay stable.
- Finish-push still uses its existing request and response handling.

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

## Deployment Abandon Protocol Validation

Previous completed checkpoint: `90f4383` Test registry Effect service.

What changed:

- DeploymentDO abandon-push request bodies now decode through
  `flarex-protocol/deployment`.
- Invalid JSON still fails at the shared HTTP JSON boundary with the existing
  `Request body must be JSON.` response.
- Schema-invalid abandon bodies keep the existing HTTP 400 messages for null
  bodies and non-string `reason` fields.
- Successful abandon responses are parsed in the focused push lifecycle test
  with `parsePushStatus`.

Why it changed:

The Effect migration needs to prove that protocol schemas can be introduced
into a larger Durable Object without changing its SQL or state-machine
behavior. Abandon-push is the smallest useful DeploymentDO route for that
proof.

Convex references inspected:

- No new Convex source files were required. The semantic behavior of push
  abandonment is unchanged; this is a transport validation boundary.

Cloudflare differences:

- Validation still happens inside a Durable Object `fetch()` handler. The
  handler maps `DeploymentProtocolValidationError` to HTTP 400 before falling
  back to the existing error response helper.

Known limitations:

- This slice does not schema-validate the full deployment analysis or codegen
  analysis payloads inside `PushStatus`; those remain future protocol modules.
- Finish-push and start-analyzed still use their existing manual validators.

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

## Registry Service Test Coverage

Previous completed checkpoint: `1a7112a` Refactor registry behind Effect
service.

What changed:

- Added focused runtime tests for `RegistryService` using controlled Effect
  test layers.
- The tests verify explicit deployment ID handling, generated deployment ID
  handling, controlled timestamp use, list response wrapping, and typed
  `RegistrySqlError` propagation from the store boundary.
- `RegistryService.listDeployments` is now a named `Effect.fn` method so both
  registry service operations share the same reusable-function shape.

Why it changed:

The previous checkpoint moved Registry behavior behind Effect services. This
checkpoint proves the validation/runtime behavior at the service layer without
requiring HTTP routing or Durable Object SQL setup.

Convex references inspected:

- No new Convex source files were required. The target remains backend-side
  validation before mutation; this slice verifies the Flarex service boundary
  that now sits after protocol decoding.

Cloudflare differences:

- These tests bypass Cloudflare Durable Object storage by replacing
  `RegistryStore` with a test layer. Route-level Miniflare coverage remains in
  `registryDO.test.ts`.

Known limitations:

- The tests assert typed error propagation from `RegistryService`, not the
  private `RegistryDO.runRegistryResponse` HTTP mapping directly.
- More service tests will be needed before migrating DeploymentDO or
  PartitionDO, where storage and OCC semantics are more complex.

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

## Registry Effect Service Validation Boundary

Previous completed checkpoint: `9a66f62` Add registry protocol schema proof.

What changed:

- RegistryDO request decoding still happens through `flarex-protocol/registry`
  at the HTTP boundary.
- Registry creation/listing now runs through `RegistryService`, which depends
  on an Effect `RegistryStore`, `RegistryClock`, and `RegistryIds`.
- SQL failures are represented as typed `RegistrySqlError` values at the store
  boundary before the DO host maps them to a stable HTTP 500 JSON response at
  the Effect runtime boundary.
- Current time now comes from Effect `DateTime.now` through the registry clock
  service, making the service layer testable without hiding `Date.now()` in
  domain logic.

Why it changed:

The first schema proof validated transport input. This checkpoint starts moving
post-validation behavior into Effect services so runtime validation,
persistence, and typed error handling can be composed and tested without a
Cloudflare `fetch()` router owning all behavior.

Convex references inspected:

- No new Convex source files were required for this RegistryDO validation
  boundary. The semantic target remains backend-side validation before state
  mutation.

Cloudflare differences:

- The Durable Object `fetch()` method remains the public entrypoint and creates
  one Effect runtime execution boundary per route branch. Typed registry store
  failures are matched before leaving that boundary.
- Durable Object SQL storage is still synchronous Cloudflare storage, wrapped
  by `Effect.try` rather than replaced with a new database abstraction.

Known limitations:

- `ProtocolValidationError` remains thrown by sync schema helpers and caught at
  the DO HTTP boundary. A later HttpApi or effectful decoder slice can move
  protocol validation into the Effect error channel.
- Field-level parse diagnostics and shared error-to-response mapping remain
  future work.

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

## Registry Protocol Schema Boundary

Previous completed checkpoint: `27afbea` Add Effect migration reviewer.

What changed:

- RegistryDO create-deployment requests now decode through
  `flarex-protocol/registry` before persistence.
- Invalid JSON still fails at the existing HTTP JSON boundary.
- Schema-invalid create-deployment bodies now fail with a typed
  `ProtocolValidationError` mapped to HTTP 400.
- Added focused Miniflare coverage for create/list deployment, invalid JSON,
  schema-invalid body, and duplicate deployment-id update behavior.

Why it changed:

This is the first small Effect Schema proof for backend runtime validation. It
keeps the existing fetch router and SQL transaction behavior intact while
proving that an internal protocol package can own runtime request contracts.

Convex references inspected:

- No new Convex source files were required for this RegistryDO boundary proof.
- The semantic target remains Convex-style backend validation before state
  mutation, but this specific slice is about Flarex transport shape rather than
  user function or document validation.

Cloudflare differences:

- The validation runs inside a Durable Object `fetch()` handler and maps typed
  protocol validation failures to ordinary JSON HTTP responses.
- HttpApi is intentionally not introduced yet; that remains a later spike once
  the schema/package boundary is proven.

Known limitations:

- The error message is intentionally coarse for this first boundary. Field-path
  parse diagnostics can be improved when shared protocol error formatting is
  introduced.
- RegistryDO still uses direct `Date.now()` and `crypto.randomUUID()` because
  this checkpoint does not yet introduce Effect services or Clock/Ids layers.

Verification:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/registryDO.test.ts
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Goal

Flarex validators must be executable runtime contracts, not only TypeScript
types and schema metadata. Invalid function arguments must be rejected before
user code runs, and invalid documents must never enter authoritative shard
storage.

## Implemented

- Added strict recursive validator execution for:
  - IDs
  - null, finite numbers, booleans, strings, bigint, and bytes
  - literals
  - arrays
  - strict objects with required and optional fields
  - records
  - unions
  - `any`
- Added path-aware `ValidationError` messages in `flarex/values`.
- Added `validateFunctionArgs` and `validateValue` for generated runtimes.
- The authoritative `/invoke` path validates declared arguments before loading
  schema, beginning a transaction, or running user code.
- Insert and replace validate full documents.
- Patch reads and validates the resulting full document, not the partial patch.
- `PartitionDO.commit` revalidates every non-delete write against its cached
  deployed table validator. This is the authoritative protection for future
  syscall and internal commit callers.
- The generated Worker validates function arguments and returns locally before
  calling the backend, while the backend validates deployed args at
  `/executions/start`, return values at `/executions/:sessionId/finish`, and
  document writes at syscall/commit boundaries.
- Deployment function metadata is persisted in `DeploymentDO` and `/invoke`
  prefers that metadata for kind and argument validation.
- Deployment-time validator-shape checks reject malformed table, argument, and
  return validators before they are stored.
- Return validators are now enforced after handler execution and before query
  response or mutation commit.
- Mutation writes are not committed when return validation fails.
- SDK function builders now use the `returns` validator to constrain handler
  return types at compile time.
- `v.id("table")` validators now check the referenced table, not only that the
  value is a string.
- The authoritative backend validates ID table mappings in arguments,
  documents, return values, and direct partition commits.
- The generated Worker validates ID table mappings with the same canonical
  numeric ID format as the authoritative backend.

## Why This Shape

Validation at invoke time gives fast errors and ensures invalid arguments never
reach user code. Validation at commit time is still required because the shard
database is the trust boundary. A future Dynamic Worker syscall path must not
be able to bypass the deployed schema by constructing writes directly.

Patch validation applies to the merged final document. Validating only the
partial patch would incorrectly reject omitted required fields and would allow
a patch to leave an invalid final document.

## Convex References

- `crates/udf/src/validation.rs`
  - `ValidatedPathAndArgs` validates args before UDF execution.
- `crates/model/src/modules/function_validators.rs`
  - args validators must be object validators or unvalidated `any`.
  - return validation is a separate boundary.
- `crates/common/src/schemas/validator.rs`
  - recursive value checks, strict object fields, optional fields, records,
    unions, and ID table checks.
  - `Validator::Id` decodes a developer document ID and compares the resolved
    table name against the validator table.
- `crates/isolate/src/ops/validate_args.rs`
- `crates/isolate/src/ops/validate_returns.rs`

## Cloudflare Differences

- Flarex currently runs a TypeScript validator in the generated Worker and a
  small backend-local equivalent in the authoritative backend. Convex uses its
  Rust value and schema validator implementation as the central backend
  contract.
- `PartitionDO` validates against its local deployed-schema cache because it is
  the single-shard commit owner. Schema version zero remains an explicit
  low-level bootstrap/test mode without document validation.
- Flarex IDs currently use a simple numeric table prefix (`1:document-id`) and
  validate that prefix against table metadata.
- The authoritative backend resolves table IDs from `DeploymentSchema.tables`.
  The generated Worker derives a deterministic table-id map from sorted schema
  table names for local fast validation, but data writes now route through the
  authoritative syscall and OCC engine.
- TypeScript checks catch normal handler/return-validator mismatches, but they
  cannot replace runtime validation because user code can still use `any`,
  assertions, or generated/remote code paths.

## Known Limitations

- Authoritative HTTP JSON transport does not support bigint or bytes yet.
- Backend and SDK validator implementations are intentionally small duplicates
  for now and must be consolidated into a runtime-neutral shared package.
- Generated Worker writes now use the authoritative single-shard syscall/OCC
  path, but the execution session itself is not yet restart durable.
- The handler registry is still local/in-memory for tests and prototypes.
  Deployment metadata owns the contract, but the Dynamic Worker executor is not
  connected yet.

## Next Work

1. Add Convex-compatible value transport for bigint and bytes.
2. Move the validator engine into a shared runtime-neutral package used by the
   SDK, backend, generator, and future Dynamic Worker syscall host.
3. Port Convex-style runtime marker and validator-export analysis so deployed
   argument and return validators come from authoritative backend analysis.
4. Add return validation for future actions and workflow mutations once those
   execution paths exist.
5. Move the duplicated SDK/backend ID codec into the future runtime-neutral
   shared package.

## Authoritative Analysis Direction

Convex function registration exports validators through runtime functions.
During deployment analysis, the backend isolate calls those exporter functions,
parses the validator JSON, and persists it as part of `AnalyzedFunction`.
Invocation resolves the analyzed function and validates visibility, function
kind, argument shape, argument size, and return values from that authoritative
metadata.

Flarex should copy this model:

```txt
SDK registration
  -> strict validator exporters
  -> backend-controlled dynamic execution isolate analysis
  -> persisted analyzed function metadata
  -> invocation and return validation
```

The generated execution artifact may validate locally for faster failure, but
the backend must validate from active authoritative analyzed metadata before
execution and commit.

Convex references:

- `npm-packages/convex/src/server/impl/registration_impl.ts`
- `crates/isolate/src/environment/analyze.rs`
- `crates/model/src/modules/function_validators.rs`
- `crates/udf/src/validation.rs`

Detailed push and analysis design:
`roadmaps/17-deployment-analysis-and-push.md`.

## Registration Exporter Update

The public SDK now exposes Convex-style `exportArgs()` and `exportReturns()`
runtime functions on every registered Flarex function. Missing argument
validation exports `v.any()` JSON, missing return validation exports `null`,
and undefined validators fail during strict serialization.

Validation helpers now also accept a root argument validator so the existing
generated Worker and metadata generator remain compatible with the wider
registration contract. Authoritative analysis still needs to enforce Convex's
backend rule that function argument validation must resolve to an object
validator or unvalidated `any`.

## Analysis Validator Parsing Update

Added `assertValidatorJson` to the shared Flarex validation layer. Local module
analysis now parses and structurally validates `exportArgs()` and
`exportReturns()` output before returning analyzed function metadata.

Argument analysis now enforces Convex's object-validator-or-unvalidated-`any`
rule. Return analysis accepts any valid validator or `null` for an unvalidated
return. Malformed nested object, array, record, union, ID, literal, and scalar
validator shapes fail before deployment metadata can be produced.

This parser lives in the zero-runtime-dependency `flarex/validator-json`
subpath so Vite config loading and Node development analysis do not import the
broader SDK graph or Cloudflare-only backend types. The backend still has its
own equivalent parser; moving it to consume this runtime-neutral parser remains
follow-up work.

Convex references:

- `npm-packages/convex/src/server/impl/registration_impl.ts`
- `crates/isolate/src/environment/analyze.rs`
- `crates/model/src/modules/function_validators.rs`

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
```

## Active Deployment Validation Update

Previous completed checkpoint: `b08269e` Record active deployment pointer on
finish.

Backend execution-session validation now consumes active deployment analysis
instead of the mutable function metadata table. `ExecutionDO.start` loads the
active deployment, finds the requested function in
`analysis.functions.functions`, and validates arguments against that
function's analyzed validator before any syscall session can run.

Direct `executeInvoke` also prefers active analysis when one exists. It keeps a
temporary no-active fallback for low-level backend transaction tests, but if an
active deployment exists and the requested path is not in that active analysis,
the invoke fails before user handler execution.

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - `ValidatedPathAndArgs` and return validators are resolved before query or
    mutation execution.
- `crates/model/src/modules/function_validators.rs`
  - function validators are stored deployment metadata, not handler-local
    choices.

Cloudflare difference: Flarex validates in TypeScript at the Durable Object
boundary for now. Convex validates in Rust against its central module and
schema models. The semantic target is the same: active analyzed metadata is
the authoritative validation contract.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Verification

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check -- custom/cloudflare-executor
```

## Internal Runtime Authorization Update

Previous completed checkpoint: `c623476` Route invoke through artifact
runtime.

Generated execution artifacts now enforce optional authorization for internal
runtime routes:

- `/__flarex_internal/invoke`
- `/__flarex_internal/metadata`

When `FLAREX_INTERNAL_TOKEN` is configured, those routes require
`Authorization: Bearer <token>`. The backend sends the matching token through
`FLAREX_ARTIFACT_RUNTIME_TOKEN` when calling `FLAREX_ARTIFACT_RUNTIME`.

This is not a user authentication feature. It is a backend/runtime capability
guard so managed execution artifact routes are not accidentally exposed as
public app APIs.

Convex reference:

- `crates/node_executor/src/executor.rs`
  - executor requests include backend callback/auth material separate from user
    function arguments.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```
