# Dynamic Worker Execution

## Execution Finish Return Validation Boundary

Previous completed checkpoint: `776a65d` Preflight deployment store validation.

What changed:

- ExecutionDO finish now validates function return values through
  `validateReturnEffect(...)` before transaction commit work enters
  `routeExecutionOperation("finish", ...)`.
- `InvokeReturnValidationError` is part of the ExecutionDO service error
  channel and maps to the existing invoke validation HTTP response at the
  internal route adapter edge.
- Finish session cleanup now uses `Effect.ensuring(...)`, preserving the
  existing behavior where failed return validation or commit failures clear the
  active session.

Why it changed:

Return validation is domain validation, not a transaction operation failure.
Keeping it inside the finish `tryPromise` boundary converted it through
`ExecutionRouteOperationError`. This checkpoint keeps return validation typed
until the adapter response mapping edge while leaving actual transaction commit
failures in the route-operation channel.

Known limitations:

- Execution start, syscall, abort, public execution dispatch, PartitionDO
  SQL/OCC, protocol schemas, executor-http, DeploymentDO, SchedulerDO,
  DeliveryDO, ConnectionDO, and `ValidatorJson` behavior are unchanged.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts packages/flarex-backend/test/executionRouteOperationError.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Invoke Route Decoder Ownership

Previous completed checkpoint: `0620909 Own execution route decoders`.

What changed:

- Public invoke route payloads now expose a decode-named Effect boundary.
- Artifact runtime invoke route payloads now expose a decode-named Effect
  boundary.
- Migrated request decoders call `decode*RoutePayload(...)` functions directly
  instead of parse-named Effect wrappers.
- Parse-named throwing helpers and parse-named Effect wrappers remain as
  compatibility APIs for older callers and direct compatibility tests.
- Focused route-boundary tests now exercise the decode-named Effect payload
  boundaries for success and typed protocol/payload failure channels.

Why it changed:

Public invoke and artifact-runtime invoke are the two dynamic-worker entry
points that hand user/runtime request bodies into the execution path. The
Effect migration quality bar asks migrated transport boundaries to prefer
decode-named Effect APIs and keep parser wrappers behind compatibility
surfaces. This checkpoint makes that ownership explicit before deeper invoke
service/domain conversion.

Known limitations:

- Invoke execution, active deployment lookup, artifact materialization, service
  binding runtime behavior, transaction/session behavior, and PartitionDO
  SQL/OCC are unchanged.
- Protocol schemas, executor-http, DeploymentDO, SchedulerDO, DeliveryDO,
  ConnectionDO, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts packages/flarex-backend/test/artifactRuntimeRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Execution Route Decoder Ownership

Previous completed checkpoint: `a6cc8c6 Map public deployment errors at worker edge`.

What changed:

- Execution start, public execution start, public execution action, syscall,
  and finish route payloads now expose decode-named Effect boundaries.
- Migrated request decoders call `decode*RoutePayload(...)` functions directly
  instead of parse-named Effect wrappers.
- Parse-named throwing helpers and parse-named Effect wrappers remain as
  compatibility APIs for older callers and direct compatibility tests.
- Focused route-boundary tests now exercise the decode-named Effect payload
  boundaries for success and typed protocol failure channels.

Why it changed:

The Effect migration quality bar asks migrated transport boundaries to prefer
decode-named Effect APIs and keep parser wrappers behind compatibility
surfaces. Execution route boundaries already had typed JSON and protocol
failure channels; this checkpoint makes ownership explicit across internal
ExecutionDO and public Worker execution routes before the next deeper
route/service conversion.

Known limitations:

- ExecutionDO session lifecycle, transaction setup, syscall execution,
  commit/return validation, abort behavior, and PartitionDO SQL/OCC behavior
  are unchanged.
- Public Worker execution routing still uses the current dispatch/service
  boundary shape.
- Protocol schemas, executor-http, DeploymentDO, SchedulerDO, DeliveryDO,
  ConnectionDO, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/executionSyscallRouteBoundary.test.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## ExecutionDO JSON Route Effect Boundary

Previous completed checkpoint: `8cafec1` Type delivery JSON route boundary.

What changed:

- ExecutionDO now routes its JSON endpoints through
  `Effect.fn("ExecutionDO.route")`.
- `/start`, `/syscall`, `/finish`, and `/abort` share one Durable Object route
  dispatcher and the existing `runExecutionRoute(...)` adapter edge.
- Start, syscall, and finish continue to use their typed body decoders and
  typed session/operation failure mapping; abort remains a bodyless control
  message that clears the in-memory session and returns `{ aborted: true }`.

Why it changed:

ExecutionDO already had typed request decoders and typed post-decode session
errors, but `fetch()` still selected each internal route separately. This
checkpoint makes the Durable Object entrypoint match the current Effect route
shape while leaving execution session semantics and transaction behavior
unchanged.

Known limitations:

- ExecutionDO session lifecycle, transaction setup, syscall execution,
  commit/return validation, and abort semantics are unchanged.
- PartitionDO SQL/OCC behavior, public Worker execution routing, DeploymentDO,
  SchedulerDO, DeliveryDO, ConnectionDO, executor-http, protocol schemas, and
  `ValidatorJson` are unchanged.
- This checkpoint does not persist ExecutionDO session state or replace the
  Worker public execution router.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionSyscallRouteBoundary.test.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts packages/flarex-backend/test/executionSessionError.test.ts packages/flarex-backend/test/executionRouteOperationError.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts -t "commits mutation syscalls only after finish|validates returns before committing mutation syscalls|aborts execution sessions without committing staged syscalls|decodes public execution start bodies before creating a session|decodes execution syscall bodies before session dispatch|decodes execution finish bodies before session dispatch|keeps execution abort as a bodyless control message" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Public Worker Execution Route Effect Boundary

Previous completed checkpoint: `59d6f74 Type public deployment push route`.

What changed:

- Public Worker execution routing now runs through
  `Effect.fn("Worker.routeExecution")` with a single `Effect.runPromise(...)`
  adapter edge.
- Start, syscall, finish, and abort branches reuse the existing typed
  start/action decoders and Worker dispatch errors without nested runtime
  boundaries inside the execution router.
- Missing execution session ids, missing actions, malformed JSON, protocol
  validation, dispatch failures, and unknown-action 404 responses keep their
  existing HTTP response shapes.

Why it changed:

The public execution route already had typed request/path boundaries, but the
router still ran path/start/action branches through separate runtime edges.
This checkpoint makes execution routing match the current migration shape:
typed failures flow through one route service and one adapter-level HTTP mapper.

Known limitations:

- ExecutionDO session lifecycle, transaction behavior, and PartitionDO SQL/OCC
  are unchanged.
- This checkpoint does not convert executor-http execution routes or the
  internal ExecutionDO fetch adapter.
- Public deployment push, invoke, scheduler, sync, delivery, generated HttpApi
  routes, protocol schemas, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts -t "execution start boundary|execution syscall bodies|execution finish bodies" --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts -t "keeps execution abort as a bodyless control message" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Artifact Runtime Invoke Route Edge

Previous completed checkpoint: `551a8b3 Type invoke runtime lookups`.

What changed:

- Artifact runtime route guards now emit typed errors for non-`POST /invoke`
  requests, unauthorized requests, and artifact header mismatches.
- The route service continues to decode payloads, resolve source packages,
  materialize artifacts, and invoke artifacts through typed Effect boundaries.
- Runtime service `fetch(...)` remains the HTTP adapter that converts typed
  route/runtime failures to the preserved JSON response shapes.

Why it changed:

Dynamic worker execution should keep runtime authorization and artifact
identity checks in the same typed route pipeline as payload decoding and
materialization. Returning `Response` from those guards hid route failures
inside business flow instead of leaving conversion to the adapter edge.

Known limitations:

- Artifact materialization still delegates to promise-based runtime
  implementations.
- This checkpoint does not change service-binding payload construction or
  Worker public invoke dispatch.
- PartitionDO SQL/OCC behavior is unchanged.

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

- Added typed invoke runtime lookup failures for active deployment loading and
  active function metadata misses.
- Added an Effect-returning invoke kind parser while preserving the old
  `parseInvokeKind(...)` compatibility behavior.
- Public Worker artifact-runtime invoke dispatch now uses the typed active
  deployment lookup helper.

Why it changed:

The invoke runtime already had typed validation for most post-decode function
execution checks. Active deployment lookup, active metadata lookup, and invoke
kind parsing were the remaining non-Partition invoke failures still emitted as
`HttpError` at the source.

Known limitations:

- This checkpoint does not convert the full `executeInvoke(...)` transaction
  flow to Effect.
- PartitionDO SQL/OCC behavior is unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/invoke.test.ts -t "active deployment load|active function metadata|invalid invoke kind" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## ExecutionDO Session Effect Boundary

Previous completed checkpoint: `8447a2f Type connection fanout payloads`.

What changed:

- ExecutionDO start, syscall, and finish service methods now return typed
  Effects after the route body decoders succeed.
- Session lifecycle and domain validation failures now use
  `ExecutionSessionError` until the `ExecutionDO.fetch()` adapter maps them to
  the preserved HTTP response shape.
- Route-operation failures for active metadata lookup, transaction setup,
  storage syscalls, commit, and return validation remain in
  `ExecutionRouteOperationError`.

Why it changed:

Public and internal execution routes already had typed request-boundary
coverage. The next runtime step is moving post-decode session validation out of
direct `HttpError` throws while keeping transaction/session behavior identical.

Known limitations:

- This does not persist ExecutionDO session state or change abort semantics.
- PartitionDO SQL/OCC behavior, generated execution artifacts, executor-http,
  protocol schemas, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionDO.test.ts packages/flarex-backend/test/executionSessionError.test.ts packages/flarex-backend/test/executionRouteOperationError.test.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionSyscallRouteBoundary.test.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Public Worker Deployment Path Boundary

Previous completed checkpoint: `735fbff Type public execution routing`.

What changed:

- Public Worker path parsing now has typed failures for missing deployment id,
  missing partition key, and missing deployment push id.
- Deployment push path classification now distinguishes method-sensitive
  `POST /push/start`, `POST /push/start-analyzed`, push-id reads, finish,
  abandon, and unknown push actions through a named Effect helper.
- Public partition routing now gets partition keys through a typed helper
  before forwarding to PartitionDO.

Why it changed:

The public invoke and execution routes now use typed request/path boundaries.
This checkpoint applies the same route-shaping pattern to the remaining
deployment/push/partition path segments without changing Durable Object
storage or runtime execution semantics.

Known limitations:

- `/deployments` remains the registry list/create route and is intentionally
  not treated as a missing deployment id.
- DeploymentDO, PartitionDO SQL/OCC, public scheduler/sync/delivery routes,
  executor-http, and `ValidatorJson` are unchanged.

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

- Public Worker execution path parsing now has typed failures for missing
  session id and missing execution action.
- Invalid execution actions still return the existing
  `404 Execution route not found.` response.
- Public execution start response JSON reads now use the shared typed response
  JSON boundary before mapping malformed response JSON as a typed Worker
  dispatch failure.

Why it changed:

The public invoke route now has typed request shaping and adapter-edge response
mapping. This checkpoint applies the same boundary shape to public execution
session routes without changing session semantics or ExecutionDO internals.

Known limitations:

- ExecutionDO route operation logic, session state, transaction behavior, and
  PartitionDO SQL/OCC are unchanged.
- Public deployment, partition, scheduler, sync, and delivery Worker routes
  still have their own remaining route-boundary cleanup opportunities.

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

- The public Worker invoke route now builds backend `InvokeRequest` values
  through a named Effect helper instead of `required(...)` throws.
- Missing function path and empty partition key failures now stay typed until
  the public invoke route adapter maps them to the preserved HTTP responses.
- Public invoke execution now runs as a typed Effect pipeline for direct
  `executeInvoke(...)`, active-deployment loading, and artifact-runtime
  invocation failures.

Why it changed:

The previous invoke checkpoints typed the backend validation and query-planning
domain boundaries. This checkpoint moves the public Worker route closer to the
same target shape: typed request/body decoding, typed request shaping, and one
adapter mapping edge before HTTP JSON responses.

Known limitations:

- `loadActiveDeployment(...)` and direct invoke execution remain existing
  Promise APIs behind the Worker route operation wrapper.
- PartitionDO SQL/OCC, execution sessions, artifact runtime service-binding
  internals, executor-http, and `ValidatorJson` are unchanged.

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

- Backend invoke query planning now has typed failures for missing
  `withIndex`, unknown index metadata, invalid range expressions, and
  non-unique `unique()` results.
- The generated/user-facing query API remains Promise based, but its
  deterministic planning failures flow through named Effect helpers before the
  existing adapter mapping.
- Direct tests cover typed query planning failures before adapter mapping.

Why it changed:

Dynamic-worker handlers depend on backend query planning before hitting the
partition query API. Typing those checks completes the invoke validation batch
around user-code query setup without changing `tx.queryIndexPage(...)`,
transaction sessions, or Durable Object storage behavior.

Known limitations:

- Mutation commit, session behavior, and PartitionDO SQL/OCC are unchanged.
- Artifact runtime service-binding invocation and public route decoding are
  unchanged.

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

- Backend invoke execution-scope planning now has typed partition validation
  failures for missing metadata, route conflicts, table/field/selector
  mismatches, bad partition args, partitionKey mismatches, and create-root
  preallocation failures.
- `resolveFunctionExecutionScope(...)` remains the sync compatibility wrapper
  for direct invoke and `ExecutionDO`, while `resolveFunctionExecutionScopeEffect(...)`
  owns the typed service boundary.
- Direct tests cover typed partition failures before adapter mapping and focused
  invoke/ExecutionDO tests preserve behavior.

Why it changed:

Dynamic-worker invoke execution depends on partition scope planning before a
transaction begins. Keeping those checks typed makes the service boundary more
consistent without changing transaction/session execution or Durable Object
storage behavior.

Known limitations:

- Query/index planning is a separate follow-up completed by the next
  checkpoint. Mutation commit, session behavior, and PartitionDO SQL/OCC are
  unchanged.
- Artifact runtime service-binding invocation and public route decoding are
  unchanged.

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

- Backend invoke table/document lookup, document validator checks, document
  placement checks, query placement checks, and missing patch targets now
  produce typed invoke validation failures before compatibility mapping.
- The user-facing DB API returned to generated/user handlers remains Promise
  based, but its validation helpers are Effect-backed and map to the existing
  `HttpError`/`invokeErrorResponse(...)` adapter shape.
- Direct tests cover typed document validator, placement, table lookup, and
  document-id failures before adapter mapping.

Why it changed:

Generated and dynamic-worker invoke handlers call into the backend DB API.
Keeping those document and placement failures as raw HTTP errors inside
`invoke.ts` made the service boundary less typed than the public route boundary
that feeds it.

Known limitations:

- Partition scope validation is a separate follow-up completed by the next
  checkpoint. Query/index planning, transaction commit, session behavior, and
  PartitionDO SQL/OCC are unchanged.
- Artifact runtime service-binding invocation and public route decoding are
  unchanged.

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

- `executeInvoke(...)` now resolves active deployment function metadata,
  registered handlers, invoke kind compatibility, argument validation, and
  return validation through named Effect helpers.
- Invoke validation failures stay typed until the compatibility adapter maps
  them to the existing `invokeErrorResponse(...)`/`HttpError` response shape.
- Direct tests cover typed argument, return, and unknown-function failures
  before adapter mapping.

Why it changed:

Public Worker invoke request bodies were already decoded through typed Effect
boundaries, but the direct backend invoke service still threw `HttpError` for
its own validation decisions. This checkpoint moves that top-level service
validation path toward the Effect target shape without changing execution or
transaction semantics.

Known limitations:

- Query/index planning, mutation commit, and transaction/session behavior remain
  in the existing compatibility flow.
- Artifact runtime service-binding invocation and public route decoding are
  unchanged.

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

- Deployment finish now receives typed artifact-ref generation failures from
  `DeploymentArtifacts`.
- Artifact-ref generation uses `Effect.tryPromise(...)`, preserving cause data
  in `DeploymentArtifactRefError`.
- Deployment HTTP mapping converts the typed runtime failure at the adapter
  edge without changing artifact runtime invocation or generated workers.

Why it changed:

Dynamic-worker activation depends on creating an execution artifact reference.
That bridge is part of the deployment-to-runtime handoff, so it should fail as
a typed deployment runtime error rather than an untyped Effect promise defect.

Known limitations:

- Generated execution artifact workers and local generated response helpers
  remain plain emitted code.
- PartitionDO and artifact runtime invocation behavior are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Flarex Dev Response JSON Shared Boundary

Previous completed checkpoint: `8e89a84` Type backend response JSON reads.

What changed:

- Local execution artifact analysis/invoke response decoding now reads JSON
  through the shared `flarex-dev` response boundary.
- Local materialized artifact response decoding now shares the same typed
  malformed-JSON source error before compatibility fallback.
- Existing execution artifact diagnostics, materialized artifact status
  mapping, and successful response casts are unchanged.

Why it changed:

Dynamic-worker local development uses several internal service-style response
decoders. This checkpoint removes duplicated response JSON read fallbacks from
those TypeScript Effect decoders while keeping generated worker code and
runtime behavior stable.

Known limitations:

- Generated worker source still owns plain JavaScript backend response helpers.
- Deployment runtime artifact-ref generation and backend `DeploymentArtifacts`
  service conversion remain separate follow-up work.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-dev/vitest.config.ts packages/flarex-dev/test/responseJson.test.ts packages/flarex-dev/test/executionArtifact.test.ts packages/flarex-dev/test/runtimeMaterializer.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Backend Response JSON Effect Boundary

Previous completed checkpoint: `47af99a` Type SchedulerDO route operation
failures.

What changed:

- Artifact runtime service-binding response decoding and backend analyzer
  response decoding now read JSON through the shared backend response boundary.
- Malformed response JSON is represented by `ResponseJsonError` at the read
  source before the compatibility `null` fallback.
- Existing analyzer diagnostics, artifact runtime status/message mapping, and
  successful response casts are unchanged.

Why it changed:

Dynamic execution paths depend on several internal service responses. Moving
their low-level JSON reads to the shared Effect boundary reduces duplicated
transport logic while keeping the execution/runtime workflows stable for later
service-level conversion.

Known limitations:

- Generated execution artifact code and deployment runtime artifact-ref
  generation remain separate migration surfaces.
- Successful artifact runtime and analyzer response payloads still use the
  existing compatibility validation path.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/httpResponseJson.test.ts packages/flarex-backend/test/push.test.ts packages/flarex-backend/test/artifactRuntime.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## ExecutionDO Route Operation Effect Boundary

Previous completed checkpoint: `49cfca6` Type DeliveryDO route operation
failures.

What changed:

- `ExecutionDO` start, syscall, and finish route operations now emit typed
  `ExecutionRouteOperationError` failures for post-decode execution defects.
- Internal `/start`, `/syscall`, and `/finish` now run one Effect pipeline per
  route and map typed request/protocol/operation failures at the Durable Object
  adapter edge.
- Post-decode route work now uses `Effect.tryPromise(...)` instead of untyped
  `Effect.promise(...)`.

Why it changed:

ExecutionDO request bodies already decoded through typed Effect boundaries,
but route helpers still converted decoder failures to `HttpError` inside the
pipeline and ran session work as an untyped promise. This checkpoint keeps the
existing execution session workflow intact while moving route failures into the
typed channel until the `invokeErrorResponse(...)` adapter edge.

Known limitations:

- Execution session lifecycle, active deployment metadata lookup, transaction
  ownership, syscall read/write behavior, return validation, commit behavior,
  and abort remain in `ExecutionDO`.
- Structured `PartitionRequestError` bodies from transaction calls still pass
  through `invokeErrorResponse(...)` unchanged at the adapter edge.
- Generated execution artifacts, public Worker execution forwarding, and
  PartitionDO SQL/OCC behavior remain separate migration surfaces.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionSyscallRouteBoundary.test.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts packages/flarex-backend/test/executionRouteOperationError.test.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/invoke.test.ts packages/flarex-backend/test/transaction.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Public Worker Typed Dispatch Failures

Previous completed checkpoint: `a079a26` Type public invoke deployment errors.

What changed:

- Added `PublicWorkerDispatchError` for public Worker routes that forward
  already-decoded requests to ExecutionDO, PartitionDO, DeliveryDO, or
  live-query delivery helpers.
- Public execution start/action, partition commit/schema-cache, public
  live-query delivery, and delivery wake routes now emit that typed failure
  from downstream dispatch catch branches.
- Route-specific HTTP mappers still preserve the existing response behavior at
  the adapter edge.

Why it changed:

These route groups had already moved request decoding into typed Effect
boundaries, but downstream dispatch failures still put `HttpError` directly in
the migrated route error channel. The shared typed dispatch failure keeps
public Worker forwarding failures explicit while preserving the old HTTP
status/message contract.

Known limitations:

- This checkpoint does not convert the downstream DO/runtime services
  themselves to typed Effect services.
- Authorization failures for live-query delivery still use the existing
  pre-route `HttpError` compatibility path.

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

- The public invoke route boundary now owns `MissingInvokeDeploymentError` as a
  typed route failure.
- Worker public invoke routing fails with that typed route error when neither
  the route/header nor request body supplies a deployment id.
- The existing HTTP response is preserved by mapping the typed failure at the
  Worker adapter edge.

Why it changed:

The public invoke route already used an Effect request decoder, but the Worker
pipeline still introduced `HttpError` directly for missing deployment ids. This
checkpoint keeps the route/service path closer to the Effect quality bar:
domain-like route failures remain typed until the adapter maps them to the
public HTTP envelope.

Known limitations:

- `routeInvoke(...)` still owns execution/runtime failures through the existing
  `invokeErrorResponse(...)` compatibility path.
- Argument, document, and return validation still use existing invoke runtime
  logic rather than typed service-layer Effect errors.

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

- Local materialized Dynamic Worker source now names the internal request JSON
  read boundary before invoking generated user functions or query sessions, and
  returns a stable malformed internal request JSON message.
- Local materialized Dynamic Worker backend calls now name the JSON response
  read boundary with explicit try/catch fallback before preserving the existing
  backend error-code/message mapping.
- Generated application Worker source now mirrors that shape for public/internal
  invoke request reads and backend response reads.

Why it changed:

Dynamic Worker execution still depends on emitted Worker source. Naming these
generated request/response boundaries closes the remaining anonymous JSON reads
in the materialized execution path without changing lifecycle, retry, syscall,
or executor transport behavior.

Known limitations:

- The generated worker source remains a compatibility checkpoint, not a true
  Effect service migration.
- Generated request body shapes are still trusted by the existing runtime
  handlers.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-dev/vitest.config.ts packages/flarex-dev/test/runtimeMaterializer.test.ts packages/flarex-dev/test/generate.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-dev test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Service-Binding Runtime Invoke Effect Boundary

Previous completed checkpoint: this commit, `Type service-binding runtime
invoke failures`.

What changed:

- `ServiceBindingExecutionArtifactRuntime.invoke(...)` now delegates to the
  exported `ServiceBindingExecutionArtifactRuntime.invoke` `Effect.fn`.
- Service-binding source-package loading and runtime `fetch(...)` failures now
  become typed `ExecutionArtifactRuntimeOperationError` values before the
  Promise API maps them to `HttpError`.
- Service-binding runtime response failures still use
  `ServiceBindingExecutionArtifactRuntimeResponseError`.

Why it changed:

The response body decode was already typed, but the service-binding invoke path
still hid store and runtime binding failures inside an `async` method. This
keeps the public runtime interface stable while making the integration failure
channel reviewable and testable.

Preserved behavior:

- The request URL, headers, capability token, source-package embedding toggle,
  and response status/message mapping stay unchanged.
- The hosted artifact runtime service route, materializer cache, public invoke
  routes, PartitionDO behavior, executor-http, protocol schemas, and
  `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntime.test.ts packages/flarex-backend/test/artifactRuntimeRouteBoundary.test.ts
corepack pnpm --filter flarex-backend build
git diff --check
```

## Backend Artifact Runtime Service Response Boundary

Previous completed checkpoint: `e726ae8` Type dev backend responses with
Effect.

What changed:

- `ServiceBindingExecutionArtifactRuntime.invoke(...)` now reads service-binding
  runtime responses through a named Effect decoder.
- Non-OK service-binding responses become typed
  `ServiceBindingExecutionArtifactRuntimeResponseError` values before the
  adapter maps them to the existing `HttpError`.
- Added direct typed failure coverage and adapter-edge `HttpError` mapping
  coverage.

Why it changed:

The backend artifact runtime is an internal Dynamic Worker execution boundary.
Its response parsing should expose typed integration failures before the Worker
adapter converts them into HTTP-shaped errors.

Known limitations:

- The runtime invoke success payload is still trusted as the existing
  `InvokeResponse` contract.
- Materialization, source-package loading, cache invalidation, and generated
  worker execution logic are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntime.test.ts packages/flarex-backend/test/transaction.test.ts packages/flarex-backend/test/push.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Execution Artifact Response Effect Boundaries

Previous completed checkpoint: `77c921a` Type materialized artifact responses
with Effect.

What changed:

- `LocalMiniflareExecutionArtifactAdapter.analyzeWithDiagnostics(...)` now
  reads execution artifact analysis responses through a named Effect decoder.
- `LocalMiniflareExecutionArtifactRuntime.invoke(...)` now reads invoke
  responses through a named Effect decoder.
- Analysis failures still map to `ExecutionArtifactAnalysisError` with
  diagnostics, and invoke failures still map to plain `Error` with the same
  message precedence.

Why it changed:

Dynamic-worker execution uses Miniflare artifacts as a local runtime boundary.
Response parsing at that boundary now has typed Effect failures before the
legacy public adapter mapping.

Known limitations:

- Generated worker source request parsing remains unchanged.
- Successful invoke values are still returned as the existing unknown JSON
  contract.

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

## Materialized Artifact Response Effect Boundary

Previous completed checkpoint: `92df423` Route generated HttpApi requests
through Effect.

What changed:

- The local Miniflare materialized execution artifact client now parses invoke
  and query-session responses through one named Effect decoder.
- Artifact response failures are represented as typed
  `MaterializedArtifactResponseError` values at the integration boundary.
- The public local artifact methods still throw the same status-bearing Error
  shape after adapter conversion.

Why it changed:

Dynamic Worker execution uses materialized artifacts as the local stand-in for
deployed execution artifacts. Response parsing is an integration boundary, so
it should emit a typed Effect failure before local API compatibility mapping.

Convex references inspected:

- None in this checkpoint. The materialized Dynamic Worker artifact flow is a
  Cloudflare-specific execution boundary.

Known limitations:

- This does not change generated worker source request parsing, function
  execution, retry behavior, or backend session semantics.

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

## ExecutionDO Effect Route Adapters

Previous completed checkpoint: `0974955` Route scheduler fetch edges through
Effect.

What changed:

- `ExecutionDO.fetch()` now routes internal `/start`, `/syscall`, and
  `/finish` POST routes through named `Effect.fn` helpers.
- Those helpers consume the existing typed execution route decoders directly
  instead of the Promise compatibility readers.
- The syscall and finish route error mappers are exported so the live
  `ExecutionDO` adapter uses the same JSON/protocol-to-HTTP conversion as the
  compatibility readers.

Boundary decision:

This checkpoint converts only the `ExecutionDO` fetch adapter edge. Execution
session lifecycle, active metadata lookup, `SingleShardTransaction` ownership,
syscall read/write semantics, return validation, commit behavior, and abort
behavior remain in `ExecutionDO`.

Preserved behavior:

- Malformed JSON and execution protocol validation failures still map through
  the existing `invokeErrorResponse(...)` response shape.
- Public Worker execution forwarding, generated execution artifacts,
  `PartitionDO`, protocol schemas, executor-http routes, and `ValidatorJson`
  are unchanged.
- Execution operation failures still flow through the existing fetch-level
  `invokeErrorResponse(...)` adapter.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm exec vitest run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionSyscallRouteBoundary.test.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/executionDO.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
git diff --check
```

## Execution Route Effect Boundary

Current Effect migration checkpoint: execution start and public execution
action route bodies are moving from Promise/throw readers to typed Effect
decoders.

What is changing:

- `packages/flarex-backend/src/execution/StartRouteBoundary.ts` now exposes
  Effect-returning internal and public start decoders.
- Public execution starts still take the authoritative `deploymentId` from the
  route before using the shared execution protocol parser.
- `packages/flarex-backend/src/execution/ActionRouteBoundary.ts` now exposes
  an Effect-returning public action decoder for `syscall`, `finish`, and
  `abort`.
- Public `syscall` and `finish` reuse the existing typed syscall/finish parser
  effects; public `abort` still forwards any well-formed JSON body.
- `packages/flarex-backend/src/worker.ts` routes public execution start and
  public execution actions through `Effect.fn` helpers before forwarding to
  `ExecutionDO`.

Why it is changing:

Execution start/action routes were already normalized by named parser helpers,
but public Worker routing still crossed through Promise/throw compatibility
readers. This checkpoint moves the execution session ingress to the same typed
transport-boundary shape as deployment, invoke, scheduler, and delivery routes.

Preserved behavior:

- Malformed JSON still maps to `400` with the shared JSON-body message.
- Execution protocol validation failures still map to `400`.
- Public start still uses the route deployment id over any body deployment id.
- Start still creates an execution session id and returns it with a successful
  `ExecutionDO` start response.
- Public action forwarding still targets `/syscall`, `/finish`, and `/abort`
  on the selected `ExecutionDO`.

Verification plan:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm exec vitest run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/executionStartRouteBoundary.test.ts packages/flarex-backend/test/executionActionRouteBoundary.test.ts packages/flarex-backend/test/executionFinishRouteBoundary.test.ts packages/flarex-backend/test/executionSyscallRouteBoundary.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
git diff --check
```

## Public Invoke Worker Effect Boundary

Previous completed checkpoint: `3440a4f` Normalize deployment validation results.

What changed:

- Top-level `/invoke` and deployment-scoped `/deployments/:deploymentId/invoke`
  now share one Worker `Effect.fn` route helper.
- The helper decodes request bodies with `decodePublicInvokeRouteRequest(...)`,
  preserves route/header/body deployment-id precedence, and delegates to the
  existing invoke runtime.
- Public invoke compatibility parsing remains available through
  `readPublicInvokeRequest(...)` for existing callers and tests.

Why it changed:

The public invoke route boundary already exposed typed Effect decoders, but the
Worker still crossed through the Promise/throw compatibility reader. This
checkpoint moves invoke routing to the same typed boundary shape as the
deployment push routes.

Known limitations and follow-up work:

- `routeInvoke(...)` still catches execution/runtime failures internally and
  returns `invokeErrorResponse(...)`; a later service-layer migration should
  model those failures as typed invoke/domain errors before HTTP conversion.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicInvokeRouteBoundary.test.ts packages/flarex-backend/test/invoke.test.ts -t "public invoke route boundary|Worker invoke route|decodes public Worker invoke bodies"
git diff --check
```

## Public Execution Action Route Normalization

Previous completed checkpoint: `6397855` Extract public execution start parser.

What changed:

- Added `parsePublicExecutionActionRequest(...)` to
  `packages/flarex-backend/src/execution/ActionRouteBoundary.ts`.
- Public execution action JSON reading now delegates action-specific
  normalization to that named parser.
- Syscall bodies still use the syscall route parser, finish bodies still use the
  finish route parser, and abort still forwards any well-formed JSON body.
- `ExecutionDO.fetch()`, `ExecutionDO.syscall(...)`, `ExecutionDO.finish(...)`,
  abort behavior, session lifecycle, PartitionDO, artifact runtime,
  executor-http, and `ValidatorJson` are unchanged.

Why it changed:

The public execution action boundary had action dispatch embedded inside the
async JSON reader. Naming the parser keeps JSON reading, action-specific
transport validation, and Durable Object runtime behavior separated without
changing generated execution action semantics.

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

## Public Execution Start Route Normalization

Previous completed checkpoint: `ccf823f` Normalize artifact runtime JSON boundary.

What changed:

- Added `parsePublicExecutionStartRouteRequest(...)` to
  `packages/flarex-backend/src/execution/StartRouteBoundary.ts`.
- Public execution start JSON reading now delegates body normalization to that
  named parser before using the existing execution start protocol parser.
- The route deployment id remains authoritative over any body `deploymentId`.
- Non-object public bodies still flow through the same backend protocol error
  boundary after the route deployment id is applied.
- Internal execution start parsing, `ExecutionDO.fetch()`, syscall, finish,
  abort routing, session lifecycle, PartitionDO, artifact runtime,
  executor-http, and `ValidatorJson` are unchanged.

Why it changed:

Public execution start has a small Worker-specific normalization step: the
deployment id comes from the route, not the JSON body. This checkpoint gives
that rule a named parser and direct tests without changing execution session
behavior or the shared execution protocol parser.

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

## Public Execution Action Decode Boundary

Previous completed checkpoint: `f21421f` Document execution abort boundary.

What changed:

- Public Worker forwarding for execution `syscall`, `finish`, and `abort`
  actions now passes through an explicit execution action boundary helper.
- Public `syscall` and `finish` bodies are decoded before Durable Object
  dispatch using the same backend route-boundary adapters as the internal
  `ExecutionDO` handlers.
- Public `abort` still forwards any well-formed JSON to the bodyless abort
  action and rejects malformed JSON before dispatch.
- `ExecutionDO`, generated execution artifacts, transaction behavior,
  PartitionDO, artifact runtime, and executor-http are unchanged.

Why it changed:

Generated execution Workers call public execution action routes. With the
Durable Object action bodies already migrated, the public forwarding boundary
should also stop treating all actions as untyped JSON. This keeps validation
close to the Worker edge while preserving existing runtime behavior.

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

- Kept `POST /deployments/:deploymentId/executions/:sessionId/abort` as a
  generated empty-object public envelope and bodyless `ExecutionDO` action.
- Generated Cloudflare execution callers already send `{}` for abort; extra
  well-formed JSON is ignored by the bodyless action.
- `ExecutionDO` still clears the active session and returns `{ aborted: true }`
  without reading a domain payload.
- Added coverage that staged mutation writes are not committed after abort and
  that post-abort syscalls fail with the existing no-session error.

Why it changed:

Abort completes the execution action audit after start, syscall, and finish.
Unlike those routes, abort has no request data to decode at the Durable Object
boundary. The migration therefore records the generated-client convention plus
bodyless runtime semantics instead of inventing an Effect schema for ignored
data.

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

## Execution Finish Decode Boundary

Previous completed checkpoint: `e77e2eb` Add execution finish protocol body.

What changed:

- `ExecutionDO.fetch()` now decodes `POST /finish` bodies through the shared
  execution finish protocol parser before dispatching to
  `ExecutionDO.finish(...)`.
- Protocol-invalid finish bodies become the existing backend `{ error }` 400
  response envelope through `HttpError`.
- Schema-valid unknown-session finish bodies still reach the unchanged session
  guard and return `409 Execution session has not started.`
- Return validation, query read-set responses, mutation commits, session
  cleanup, start/syscall, abort, PartitionDO behavior, and executor-http are
  unchanged.

Why it changed:

This is the live Durable Object follow-up to the protocol-only finish body
checkpoint. It makes the transaction completion boundary schema-first without
changing commit or cleanup semantics.

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

## Execution Finish Protocol Shape

Previous completed checkpoint: `652936f` Decode execution syscall bodies.

What changed:

- Added the shared execution finish request contract in
  `flarex-protocol/execution`.
- The contract covers the current `{ value }` body used when generated
  execution artifacts finish a query or mutation session.
- Finish values use the shared strict JSON validator.
- Generated execution artifacts, Worker forwarding, `ExecutionDO.fetch()`,
  `ExecutionDO.finish(...)`, transaction commit, return validation, abort, and
  PartitionDO behavior are unchanged.

Why it changed:

Finish parsing sits at the transaction completion boundary, where queries
return read sets and mutations commit writes. The safe order is protocol first,
then a separate `ExecutionDO.fetch()` wiring checkpoint with route-level parity
tests for invalid JSON, invalid values, return validation, and session cleanup.

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

## Execution Syscall Decode Boundary

Previous completed checkpoint: `f766101` Add execution syscall protocol bodies.

What changed:

- `ExecutionDO.fetch()` now decodes `POST /syscall` bodies through the shared
  execution syscall protocol parser before dispatching to `ExecutionDO.syscall`.
- Protocol-invalid syscall bodies become the existing backend `{ error }` 400
  response envelope through `HttpError`.
- Schema-valid unknown-session syscalls still reach the unchanged session
  guard and return `409 Execution session has not started.`
- Generated execution artifacts, Worker route matching, transaction logic,
  finish/abort, PartitionDO behavior, and executor-http are unchanged.

Why it changed:

This is the live Durable Object follow-up to the protocol-only syscall body
checkpoint. It makes the dynamic execution loop schema-first at the syscall
boundary without changing the transaction runtime.

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

## Execution Syscall Protocol Shape

Previous completed checkpoint: `7f6ec53` Decode execution start bodies.

What changed:

- Added the shared execution syscall request contract in
  `flarex-protocol/execution`.
- The contract covers `get`, `query`, `insert`, `patch`, `replace`, and
  `delete`, including query range expressions and optional cursor/order/limit
  fields.
- Syscall JSON payloads use the shared strict JSON validator; patch payloads
  must be JSON records.
- Generated execution artifacts, Worker forwarding, `ExecutionDO.syscall`,
  transaction execution, finish/abort, and PartitionDO behavior are unchanged.

Why it changed:

Syscall parsing sits directly in the dynamic execution loop, so the safe order
is protocol first, then a separate `ExecutionDO.fetch()` wiring checkpoint with
route-level parity tests.

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

## Execution Start Decode Boundary

Previous completed checkpoint: `d8b82fc` Add execution start protocol body.

What changed:

- Public execution start requests now decode through the shared
  `flarex-protocol/execution` start parser before a session id is returned.
- The Worker still allocates the session id and injects the route deployment id.
- `ExecutionDO` decodes its internal `/start` body through the same backend
  helper before calling unchanged session orchestration.
- Syscalls, finish, abort, `SingleShardTransaction`, generated execution
  artifacts, and PartitionDO behavior are unchanged.

Why it changed:

Dynamic Worker execution spans multiple requests, so only the start transport
boundary is wired in this checkpoint. The remaining syscall and finish bodies
should be migrated separately with their own parity tests.

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

## Execution Start Protocol Shape

Previous completed checkpoint: `67689e2` Decode public invoke bodies.

What changed:

- Added the shared execution-session start body contract in
  `flarex-protocol/execution`.
- The contract covers the fields currently sent to `ExecutionDO.start`:
  deployment id, function path, JSON args, optional partition key, optional
  project id, optional caller kind, and optional idempotency key.
- Shared strict JSON validation now lives in `flarex-protocol/json` and is used
  by both public invoke and execution start request bodies.
- Generated execution artifacts, Worker execution forwarding, `ExecutionDO`
  session lifecycle, syscalls, finish, abort, and PartitionDO transaction logic
  are unchanged.

Why it changed:

Execution sessions are behavior-sensitive because user code spans start,
syscall, and finish requests. The safe migration order is to establish the
shared start-request schema first, then wire Worker/ExecutionDO parsing in a
separate parity-tested checkpoint.

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

## Public Invoke Worker Decode Boundary

Previous completed checkpoint: `95cc914` Add public invoke protocol body.

What changed:

- Public Worker invoke routes now pass through the shared invoke protocol
  parser before `routeInvoke` builds the runtime `InvokeRequest`.
- Omitted `args` remains a Worker/runtime compatibility concern and still
  reaches artifact runtime invocation as `args: null`.
- Artifact runtime dispatch, generated execution artifacts, executor sessions,
  and PartitionDO transaction execution are unchanged.

Why it changed:

This is the live Worker follow-up to the protocol-only public invoke body
checkpoint. It gives generated/runtime invoke callers a schema-first public
boundary without changing dynamic execution behavior.

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

## Public Invoke Body Protocol Shape

Previous completed checkpoint: `be053f6` Decode public source push bodies.

What changed:

- Added the shared public invoke body contract in `flarex-protocol/invoke`.
- The contract covers the fields currently read by the public Worker invoke
  route: deployment identity, function path, optional JSON args, partition key,
  caller kind, and idempotency key.
- Omitted `args` stays omitted at the protocol layer so the later Worker
  adapter can preserve its existing `args ?? null` runtime default.
- No generated Worker, artifact runtime, executor session, or PartitionDO code
  changed in this checkpoint.

Why it changed:

Dynamic Worker execution already has behavior-sensitive invoke/session paths.
The safe migration order is to establish the shared request schema first, then
wire the public Worker boundary in a separate parity-tested checkpoint.

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

## Generated Output Typecheck Gate

Previous completed checkpoint: `53eda56` Typecheck generated Worker output.

What changed:

- The generated-source typecheck test now compiles every emitted
  `flarex/_generated/**/*.ts` file instead of only
  `flarex/_generated/worker.ts`.
- The temporary app config was renamed from worker-only scope to generated
  output scope.
- This extends coverage to the Dynamic Worker entrypoint plus its generated
  registry, metadata, deployment schema, server, data model, and API imports.

Why it changed:

The previous checkpoint proved the generated Worker template, but the Worker
depends on adjacent generated modules. A broken generated registry, metadata,
server, data model, or API file would still be developer-facing generated
source. Compiling the entire generated directory matches the Convex-first rule:
generated TypeScript is part of the runtime contract, not inert text.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Convex ties generated code and function source into explicit typecheck
    flows.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - generated TypeScript templates are maintained as developer-facing API
    surfaces.

Flarex differences:

- Flarex still keeps this as Vitest coverage rather than a public CLI
  typecheck command.
- The generated directory glob is enough for the test lane because TypeScript
  follows imports into the app's `flarex/functions` and `flarex/schema.ts`
  files.

Known limitations:

- This validates final generated output for one representative app fixture,
  not every possible schema/function shape.
- A future CLI/dev-server slice should expose this generated-output typecheck
  as an explicit developer command.

Verification:

```sh
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "typechecks generated output" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev build
```

## Generated Worker Typecheck Gate

Previous completed checkpoint: `90df37a` Guard nested function execution.

What changed:

- Generator tests now typecheck the emitted `flarex/_generated/worker.ts`
  with a temporary strict `tsconfig.generated-worker.json`.
- The typecheck maps `flarex` and `flarex/*` imports back to workspace source
  files and resolves Cloudflare Worker types from the workspace
  `node_modules`.
- This catches generated Worker template type holes that package-level
  `flarex-dev` typecheck cannot see because the template lives inside a
  string.

Why it changed:

The nested-call guardrail checkpoint introduced `nestedCallDepth` inside the
generated Worker template. Reviewers correctly caught that ordinary
`flarex-dev` typecheck does not validate emitted Worker source. Generated
runtime source should be treated as first-class code, because it is what app
developers will actually run and typecheck.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Convex codegen is tied into an explicit typecheck mode for generated and
    function code.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
  - Convex keeps generated API code as TypeScript templates that must remain
    valid generated output.

Flarex differences:

- Flarex currently adds this as a focused generator test instead of a full
  CLI-level typecheck command.
- The temp config uses explicit workspace path mappings because test projects
  are created outside the workspace package tree.

Known limitations:

- Only the generated Worker is typechecked by this helper today. Future slices
  should extend the same pattern to generated API/server/dataModel files when
  their template contracts become more complex.
- The helper is test-only; the CLI/dev plugin does not yet expose a user-facing
  `flarex typecheck-generated` command.

Verification:

```sh
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "typechecks generated Worker output" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev build
```

## Nested Call Guardrails

Previous completed checkpoint: `185775f` Execute same-artifact nested
functions.

What changed:

- Generated Worker execution and local materialized execution artifacts now
  track nested function call depth.
- Same-artifact nested calls fail with a Flarex-specific error before
  recursive `ctx.runQuery` / `ctx.runMutation` calls can overflow the runtime
  stack.
- The depth limit is `8`, matching Convex's default
  `MAX_REACTOR_CALL_DEPTH`.
- Query contexts still reject nested mutations before resolving or executing
  the mutation in both generated Worker and materialized runtime paths.
- Added generated Worker coverage for recursive nested calls.
- Added generated Worker and materialized runtime coverage for recursive
  nested calls and query-to-mutation nested calls.

Why it changed:

The previous checkpoint made same-artifact nested execution work, but recursive
function references could still fail as generic runtime recursion. Convex has
an explicit reactor call-depth guard for the same class of user-code bug.
Flarex should fail clearly and keep the active backend session bounded.

Convex references inspected:

- `crates/common/src/knobs.rs`
  - defines `MAX_REACTOR_CALL_DEPTH` with default `8`.
- `crates/isolate/src/environment/udf/async_syscall.rs`
  - checks reactor depth before nested query/mutation execution and reports a
    user-facing maximum-depth error.

Flarex differences:

- Convex enforces the depth inside the integrated Rust isolate/reactor path.
  Flarex enforces it inside the generated/materialized execution artifact
  before same-artifact dispatch.
- Flarex's current guard covers same-artifact nested query/mutation calls only.
  Future cross-artifact or host-owned nested calls must carry the same depth
  field through their protocol.

Known limitations:

- No nested `ctx.runAction` support.
- No cross-artifact nested function calls yet.
- The depth limit is a constant in generated/materialized runtimes; it is not
  configurable through deployment metadata yet.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "nested server-side|derives Postgres invoke visibility" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts -t "nested|Postgres executor invoke routes" --testTimeout=30000 --hookTimeout=30000
```

## Same-Artifact Nested Function Calls

Previous completed checkpoint: `4428c8d` Add fail-closed server context calls.

What changed:

- Generated Worker execution now implements `ctx.runQuery` and
  `ctx.runMutation` for functions bundled in the same Flarex execution
  artifact.
- Local materialized execution artifacts implement the same nested-call path.
- Nested calls reuse the active backend invoke session and the existing
  `/invoke/syscall` bridge. They do not call `/invoke/start`,
  `/invoke/finish`, or `/invoke/abort` for the nested function.
- Nested queries execute with a read-only DB facade, even when called from a
  mutation. Nested mutations are only allowed from mutation execution.
- Generated Worker nested calls validate nested args and returns against the
  generated analysis metadata.
- Runtime tests now prove:
  - generated nested internal query calls finish through the outer session,
  - generated nested internal mutation calls write through the outer session,
  - materialized nested query calls reuse the outer query session,
  - materialized nested mutation calls reuse the outer mutation session, and
  - live-query reruns execute nested queries with only `/invoke/syscall`.

Why it changed:

The previous checkpoint exposed the Convex-style API but deliberately failed
closed. This checkpoint makes the common same-bundle case work without
changing the trusted executor transaction boundary: user code still cannot see
raw DB connections, and all reads/writes still go through backend-owned
syscalls for the active session.

Convex references inspected:

- `npm-packages/convex/src/server/registration.ts`
  - `ctx.runQuery` and `ctx.runMutation` are server-side calls available from
    Convex function contexts.
- `npm-packages/convex/src/server/api.ts`
  - function references carry path, kind, args, and return type information at
    the SDK boundary.
- `crates/function_runner/src/lib.rs`
  - Convex executes nested calls inside the integrated runner. Flarex mirrors
    the developer mental model but routes DB effects through the active
    backend invoke session.

Flarex differences:

- This is same-artifact nested execution only. It does not yet support calling
  functions from another deployment/package artifact.
- There is no independent nested transaction or nested retry loop. Nested
  reads and writes are part of the outer invoke session and commit together
  with the outer mutation.
- Local materialized runtime does not have generated validator metadata, so it
  can check function kind but not nested args/returns yet. Generated Worker
  output does validate nested args/returns and uses the SDK `getFunctionName`
  helper; the materialized runtime keeps a local resolver because its Worker
  source is assembled directly for Miniflare without bundling `flarex/server`.

Known limitations:

- No nested `ctx.runAction` support.
- No backend route exists for a host-owned nested call. The current path is an
  in-artifact dispatch.
- Nested mutations rely on the outer mutation session. Calling a mutation from
  a query fails at runtime and is blocked by TypeScript.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "nested server-side|derives Postgres invoke visibility" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts -t "nested|Postgres executor invoke routes" --testTimeout=30000 --hookTimeout=30000
```

## Fail-Closed Nested Function Calls

Previous completed checkpoint: `0fef4db` Guard public client visibility
types.

What changed:

- Generated Worker execution contexts now include `ctx.runQuery` and
  `ctx.runMutation` stubs alongside `ctx.db`.
- Local materialized execution artifacts use the same fail-closed context
  shape for top-level invoke execution and live-query query-session reruns.
- Unsupported nested server-side calls throw a Flarex-specific error explaining
  that nested execution sessions are not implemented yet.
- Added generated-worker and materialized-runtime tests proving nested calls
  abort the active session instead of failing with an undefined method.
- Added materialized-runtime coverage for `ctx.runMutation` and for
  live-query reruns, where no new backend session is started.

Why it changed:

The SDK now exposes Convex-style server-side internal reference types. Runtime
execution must therefore fail clearly until the trusted executor has a real
nested same-session execution protocol. A clear stub is safer than letting user
code discover `ctx.runQuery` as `undefined` at runtime.

Convex references inspected:

- `npm-packages/convex/src/server/registration.ts`
  - documents `ctx.runQuery` and `ctx.runMutation` as same-transaction
    server-side calls.
- `crates/function_runner/src/lib.rs`
  - Convex owns function execution inside an integrated runner; Flarex
    deliberately keeps the executor/session boundary explicit.

Flarex differences:

- Convex supports nested function execution. Flarex currently starts one
  executor session per top-level query/mutation, so nested function calls need
  a future backend protocol before they can be safe.
- The stub exists in generated/runtime execution only; public clients remain
  blocked from internal references by TypeScript and backend visibility checks.

Known limitations:

- No nested read-set/write-set merging is implemented.
- No nested mutation sub-transaction rollback is implemented.
- `ctx.runQuery`/`ctx.runMutation` are currently developer-facing errors, not
  working nested execution.

Verification:

```sh
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "nested server-side|derives Postgres invoke visibility" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts -t "nested|Postgres executor invoke routes" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev build
git diff --check
```

## Current Decision

Developer modules should run in Flarex-managed dynamic execution isolates and
receive only restricted syscall APIs. Developers write ordinary TypeScript
functions under `flarex/`, not Worker entrypoints. Flarex converts the uploaded
source package into an internal execution artifact. Developer code must not
receive raw Durable Object stubs, SQLite handles, or environment bindings.

## Intended Flow

```txt
Worker router
  -> resolve deployment and partition
  -> begin transaction in PartitionDO
  -> load active Flarex-managed execution artifact
  -> run developer function in dynamic execution isolate
  -> syscalls collect reads and staged writes
  -> commit through PartitionDO
```

## Implemented So Far

`apps/backend/src/transaction.ts` defines `SingleShardTransaction`, the first
backend syscall-facing transaction layer. It is not a Dynamic Worker executor
yet, but it is the object the executor should use to service future `ctx.db`
syscalls:

- `get(tableId, id)`
- `queryIndex({ indexId, lower, upper, limit })`
- `insert(tableId, value, id?)`
- `replace(tableId, id, value)`
- `patch(tableId, id, value)`
- `delete(tableId, id)`
- `commit({ source, idempotencyKey })`

The Dynamic Worker should receive a restricted API backed by this wrapper, not
raw Durable Object bindings, raw SQLite handles, or the Cloudflare `env`.

`apps/backend/src/invoke.ts` defines the first backend invoke boundary:

- `executeInvoke(env, deploymentId, request, functions)`
- `BackendFunctionRegistry`
- query and mutation contexts backed by `SingleShardTransaction`
- table-name resolution through `DeploymentDO` for
  `ctx.db.insert("tableName", value)`
- per-invoke schema cache sync from `DeploymentDO` to target `PartitionDO`
  before transaction begin
- `ctx.db.get(id)` returns a developer-facing document value with `_id`
- `/deployments/:deploymentId/invoke`
- top-level `/invoke` with `deploymentId` in the body or
  `x-flarex-deployment` header

The Worker route currently uses an empty backend function registry. This is
intentional until the Dynamic Worker bridge or deployed function registry is
implemented.

`apps/backend/src/executionDO.ts` adds the first backend execution-session
syscall protocol:

- `POST /deployments/:deploymentId/executions/start`
- `POST /deployments/:deploymentId/executions/:sessionId/syscall`
- `POST /deployments/:deploymentId/executions/:sessionId/finish`
- `POST /deployments/:deploymentId/executions/:sessionId/abort`

`ExecutionDO` owns one active `SingleShardTransaction` session. It validates
deployed function args at `/start`, services restricted `ctx.db` operations
through `/syscall`, validates returns at `/finish`, and only then commits
mutations through `PartitionDO`.

The generated Worker now runs user handlers with a scoped syscall-backed
`ctx.db` client. It no longer stores documents in its own generated
`PartitionDO`; it calls the authoritative backend service binding instead.

## Convex References

- `crates/isolate/src/environment/udf/syscall.rs`
  Inspiration for syscall boundary.
- `crates/function_runner/src/lib.rs`
  `FunctionFinalTransaction`, `FunctionReads`, and `FunctionWrites`.
- `crates/function_runner/src/server.rs`
  Function runner interface.
- `crates/application/src/application_function_runner/mod.rs`
  Application-level function execution and transaction merge.

## Terminology And Cloudflare Difference

Convex isolates user code with its own Rust/V8 infrastructure. Flarex should
use Cloudflare runtime isolation, but must still enforce the same architectural
boundary: user code sees `ctx.db`, not storage.

Cloudflare calls dynamically dispatched scripts "User Workers." In Flarex,
those scripts are internal execution artifacts generated and managed by Flarex.
The developer does not write Worker code, a `fetch` handler, Wrangler
configuration, or bindings.

See `roadmaps/17-deployment-analysis-and-push.md` for the source-bundle,
analysis, candidate push, and activation lifecycle.

## Generated Postgres Invoke Optional Fields

Previous completed checkpoint: `5526aa2` Add outbox dispatcher core.

What changed:

- Updated generated Worker codegen and the local runtime materializer template
  to omit optional Postgres executor fields when they are `undefined`.
- The affected fields are `projectId`, `executorToken`, `partitionKey`, and
  `idempotencyKey` on `/invoke/start`, `/invoke/finish`, and `/invoke/abort`
  helper calls.
- This keeps generated artifacts compatible with
  `exactOptionalPropertyTypes`.

Why it changed:

The workspace typecheck runs `apps/example` generation before TypeScript
validation. Generated invoke code was passing optional fields as explicit
`undefined`, which is invalid for helper input types declared with optional
properties. The runtime behavior was unchanged, but the generated TypeScript
gate failed.

Convex references:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated artifacts should typecheck as first-class source.
- `npm-packages/convex/src/cli/codegen_templates`
  - optional generated runtime fields should preserve TypeScript semantics.

Flarex differences:

- Convex generated workers do not carry Flarex's executor transport fields.
  Flarex must handle these optional hosted/local executor fields explicitly.

Known limitations:

- This only fixes optional property emission. It does not remove legacy
  `partitionKey` transport fields from generated artifacts.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm typecheck
git diff --check
```

## Known Limitations

- The Dynamic Worker path is still generated Worker code, not Cloudflare's
  production Dynamic Worker upload/deployment flow.
- Execution sessions currently keep transaction state in one `ExecutionDO`
  instance's memory. If a session DO is evicted mid-execution, the session is
  lost and must be retried by a future executor layer.
- The production Worker route has no deployed function registry yet, so it
  reports unknown functions until the Dynamic Worker bridge is connected.
- There is no executor retry loop around `OCC_CONFLICT` yet.
- Index reads through the wrapper do not yet overlay staged writes.
- Cross-shard calls remain intentionally out of scope for normal mutations.

## Local Live-Query Execution Host

Previous completed checkpoint: `92c38cf` Wire live query rerun route to invoke
bridge.

What changed:

- Added an optional `executeQuerySession(...)` method to materialized execution
  artifacts.
- Added a local Miniflare internal route:
  `/__flarex_internal/query-session`.
- Added `createMaterializedArtifactLiveQueryExecutionHost(...)` in
  `flarex-dev`.
- The helper adapts the executor's
  `RunLiveQuerySubscriptionWithInvokeInput["executeQuery"]` callback to a
  materialized user-code artifact.
- Query reruns now execute user query code against an existing backend-owned
  Postgres invoke session. The artifact calls `/invoke/syscall`; it does not
  call `/invoke/start`, `/invoke/finish`, or `/invoke/abort`.

Why it changed:

Live-query reruns need the same Convex-style boundary as normal invokes:
trusted backend creates the transaction/session, user code runs in an isolate,
and all `ctx.db.*` operations go back through restricted syscalls. The previous
HTTP maintenance route accepted an `executeQuery` callback, but there was no
concrete local execution host to run the stored query function.

Convex references:

- `crates/isolate/src/environment/udf/syscall.rs`
  - user code reaches storage through a syscall boundary.
- `crates/application/src/application_function_runner/mod.rs`
  - backend application execution owns function/session coordination.
- `crates/sync/src/worker.rs`
  - sync workers rerun subscribed queries and publish transitions.

Flarex differences:

- Convex reruns queries inside its integrated backend runtime. Flarex's current
  local path materializes the uploaded `flarex/` source package into Miniflare
  and talks to the trusted Postgres executor over internal HTTP-style syscalls.
- This is a local/dev host over materialized artifacts. The production
  Cloudflare Dynamic Worker artifact loader is still future work.
- The query-session route only supports the Postgres executor transport because
  the legacy Durable Object execution path owns its own session lifecycle.

Known limitations:

- The executor HTTP maintenance route still needs to be wired to this helper by
  the dev/server adapter.
- Hosted Dynamic Worker artifact loading is not implemented.
- Query-session execution currently returns only the user query value; the
  executor remains responsible for finishing the session and collecting the
  final read set.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts
corepack pnpm --filter flarex-backend typecheck
```

## Local Executor HTTP Runtime

Previous completed checkpoint: `3f441a8` Add local live query execution host.

What changed:

- Added a local executor HTTP runtime factory in `flarex-dev`.
- The factory assembles:
  - `@flarex/executor-http`,
  - a cached execution-artifact materializer,
  - `LocalMiniflareExecutionArtifactMaterializer`, and
  - the live-query rerun query-session bridge.
- Materialized query artifacts call back into the same HTTP handler for
  `/invoke/syscall`, preserving the backend-owned transaction/session boundary.

Why it changed:

The previous checkpoint added the artifact-side query-session route, but the
executor HTTP maintenance route still needed a concrete callback. This
checkpoint connects those pieces for local/dev and tests without changing the
core HTTP adapter API.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - function execution runs under backend coordination.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user code is isolated from direct database access.
- `crates/sync/src/worker.rs`
  - query reruns are part of sync worker behavior.

Flarex differences:

- Convex has no Miniflare/materialized artifact loop. Flarex uses one locally
  because hosted Flarex will run uploaded source packages in managed Cloudflare
  runtime artifacts.
- This helper targets the forward Postgres executor path, not the legacy
  Durable Object backend runtime used by older local dev routes.

Known limitations:

- Hosted Dynamic Worker loading remains future work.
- The helper currently materializes from active package metadata and therefore
  requires stored module source text in local/test packages.
- It does not yet integrate with the Vite plugin's legacy DO dev backend.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- executorHttpRuntime.test.ts
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor typecheck
git diff --check
```

## Postgres Executor Transport Bridge

Previous completed checkpoint: `6c7c80a` Harden generated indexed query API.

What changed:

- Generated execution Workers now support an explicit executor transport:
  - `legacy` keeps the existing `/deployments/:id/executions/*` route shape.
  - `postgres` calls the new trusted executor routes:
    `/invoke/start`, `/invoke/syscall`, and `/invoke/finish`.
- The generated Worker accepts `FLAREX_EXECUTOR_TRANSPORT`,
  `x-flarex-executor-transport`, `FLAREX_PROJECT_ID`, `x-flarex-project`, and
  `projectId` for the Postgres executor route.
- The local Miniflare execution-artifact materializer has the same transport
  bindings so dev/runtime tests can execute the hosted-shape contract.
- Postgres syscall responses are unwrapped from `{ value, readSet? }` before
  being returned to user `ctx.db` helpers.
- Postgres start responses can return the function kind as
  `function.kind`; legacy start responses can still return top-level `kind`.
- The legacy transport remains the default until the public backend path is
  fully migrated off the Durable Object execution session prototype.

Why it changed:

The Postgres executor now owns the forward authoritative transaction protocol,
but generated/materialized user-code artifacts still spoke only to the older
Cloudflare Durable Object execution-session routes. This bridge lets the same
restricted `ctx.db` user-code runtime target the new executor without changing
developer function code.

Convex references:

- `crates/function_runner/src/lib.rs`
  - user function execution talks to a backend-owned transaction context.
- `crates/isolate/src/environment/udf/syscall.rs`
  - isolate code reaches storage through a syscall boundary.
- `crates/application/src/application_function_runner/mod.rs`
  - application execution resolves deployment/function metadata before running
    user code.

Flarex differences:

- Convex's runner and database transaction engine are inside the same backend
  system. Flarex runs user code in a managed Cloudflare runtime and calls a
  trusted executor over a transport boundary.
- The legacy DO route remains as a compatibility/default path while the
  Postgres executor matures. The Postgres route requires `projectId` because
  the new executor is explicitly multitenant at the platform/project level.

Known limitations:

- This is an opt-in transport bridge, not a full migration of backend public
  invoke to the Postgres executor.
- Runtime authorization between Cloudflare execution artifacts and the trusted
  Postgres executor still needs a capability-token design.
- The generated public `/invoke` path still exists; hosted Flarex should route
  real platform invocations through managed execution artifacts.
- The Postgres executor must still gain live sync/outbox integration before it
  replaces the DO prototype end to end.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-backend typecheck
git diff --check
```

## Materialized Artifact To Postgres Executor Integration

Previous completed checkpoint: `3e705f4` Add postgres executor transport
bridge.

What changed:

- Added an integration test where a local Miniflare execution artifact runs
  real user-code handlers through the Postgres executor transport.
- The test registers and activates a deployment package in
  `@flarex/executor`, backed by PGlite persistence.
- The materialized artifact calls:
  - `/invoke/start`,
  - `/invoke/syscall`,
  - `/invoke/finish`.
- The mutation handler uses `ctx.db.insert(...)`; the query handler uses the
  Convex-style `ctx.db.query(...).withIndex(...).collect()` API.
- The test verifies committed document writes and indexed query read-set
  output from the trusted executor.

Why it changed:

The previous bridge proved the materialized runtime could call the Postgres
route shape with a fake backend. This checkpoint proves the actual forward
architecture works through real layers:

```txt
materialized execution artifact
  -> restricted ctx.db syscall client
  -> @flarex/executor-nitro HTTP adapter
  -> @flarex/executor session/syscall/finish methods
  -> @flarex/persistence-postgres PGlite transaction path
```

Convex references:

- `crates/isolate/src/environment/udf/syscall.rs`
  - user code talks to storage through syscalls, not direct database handles.
- `crates/function_runner/src/lib.rs`
  - function execution receives a backend-owned transaction context.
- `crates/application/src/application_function_runner/mod.rs`
  - application execution combines active deployment metadata with executor
    invocation.

Flarex differences:

- Convex runs the function runner near its database engine. Flarex's target
  keeps the user-code runtime in Cloudflare and the trusted transaction
  executor near Postgres.
- This integration uses local Miniflare and PGlite. Production still needs the
  hosted Dynamic Worker materializer and real Postgres lane.
- Legacy DO execution remains available as the default compatibility transport;
  this test explicitly selects `postgres`.

Known limitations:

- The local dev server still uses the legacy backend for push/artifact storage
  and public invoke routing.
- The test covers mutation insert and indexed query, but not patch/delete,
  actions, sync fanout, or retry-on-OCC-conflict behavior through user code.

Verification:

```sh
corepack pnpm test:integration
corepack pnpm --filter flarex-dev typecheck
git diff --check
```

## Postgres Executor Capability Token Bridge

Previous completed checkpoint: `1a58000` Test execution artifacts against
postgres executor.

What changed:

- Generated execution Workers now accept `FLAREX_EXECUTOR_TOKEN`.
- Local materialized execution artifacts accept `executorToken` and bind it as
  `FLAREX_EXECUTOR_TOKEN`.
- When `executorTransport` is `postgres`, generated/materialized artifacts add
  `Authorization: Bearer <token>` to `/invoke/start`, `/invoke/syscall`, and
  `/invoke/finish`.
- Legacy execution-session routes do not receive this executor token.
- Runtime materializer tests now assert the Authorization header on all three
  Postgres executor calls.
- The real execution-artifact-to-Postgres integration now runs with a protected
  executor route.

Why it changed:

The user-code runtime is an internal Flarex-managed artifact. Once it calls the
trusted Postgres executor over HTTP, that route needs an explicit capability
boundary. This mirrors the existing artifact-runtime internal token pattern
while keeping the developer-facing API unchanged.

Convex references:

- `crates/node_executor/src/executor.rs`
  - executor requests carry backend-controlled callback/auth material.
- `crates/application/src/application_function_runner/mod.rs`
  - application code execution is initiated by the backend, not by arbitrary
    public callers.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user code can only perform storage work through the authorized syscall
    channel.

Flarex differences:

- Convex does not need a separate HTTP bearer token between Cloudflare user
  code and a Nitro/Postgres executor. Flarex does because those are separate
  deployment/runtime boundaries.
- This is a shared capability token for the executor route. Per-session syscall
  tokens and token rotation are still future work.

Known limitations:

- Token generation, rotation, and tenant/project-specific secret management
  are not implemented.
- No per-session syscall capability is enforced yet; the token protects the
  executor route as a whole.
- The local dev server still defaults to the legacy execution route.

Verification:

```sh
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm test:integration
git diff --check
```

## Postgres Executor Abort Bridge

Previous completed checkpoint: `34cae26` Protect postgres executor invoke
routes.

What changed:

- Generated execution Workers now call `POST /invoke/abort` for the Postgres
  transport when user code or local return validation throws after session
  start.
- Local Miniflare materialized execution artifacts use the same abort route.
- Legacy transport still calls the existing
  `/deployments/:id/executions/:sessionId/abort` route.
- Abort calls include the same `Authorization: Bearer <executorToken>` header
  as start/syscall/finish.
- Added materializer coverage proving a failing user-code handler sends
  `/invoke/abort` with `deploymentId`, `projectId`, and `sessionId`.

Why it changed:

The Postgres transport previously skipped abort because the executor had no
abort endpoint. That left failed user-code sessions active in the trusted
executor. Convex-style execution needs an explicit terminal path for failed
function execution, even when no commit happens.

Convex references:

- `crates/function_runner/src/lib.rs`
  - user execution has a final transaction outcome; failed execution does not
    publish staged writes.
- `crates/application/src/application_function_runner/mod.rs`
  - function execution result handling is backend-owned.
- `crates/isolate/src/environment/udf/syscall.rs`
  - storage effects remain behind the backend syscall/session boundary.

Flarex differences:

- Convex failure cleanup is internal to its backend/executor process. Flarex
  must represent failure over an HTTP transport between Cloudflare user-code
  artifacts and the trusted Postgres executor.
- Abort currently marks the session terminal and prevents further syscalls or
  finish. It does not yet delete staged reads/writes or run retention cleanup.

Known limitations:

- Abort is best-effort from generated/materialized artifacts; if the runtime is
  killed before the abort request, a future session TTL/reaper is still needed.
- There is no per-session capability token yet.
- Abort does not publish sync invalidations, because no commit happened.

Verification:

```sh
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm test:integration
git diff --check
```

## Real Artifact Abort After Staged Write

Previous completed checkpoint: `ae4575d` Add postgres invoke abort sessions.

What changed:

- Extended the real execution-artifact-to-Postgres integration test.
- The materialized user-code artifact now includes a mutation that:
  1. calls `ctx.db.insert("messages", ...)`,
  2. throws an error before returning.
- The test verifies:
  - the artifact invoke rejects with the user-code error,
  - the trusted executor session is marked `aborted`,
  - the staged write is not committed to PGlite,
  - the previously committed document remains the only visible row.

Why it changed:

The previous abort slice proved the raw executor abort route and a fake
materializer abort call. This checkpoint proves the actual combined runtime
behavior we care about: Convex-style user code can stage writes through
`ctx.db`, fail, and the Postgres executor will not publish those writes.

Convex references:

- `crates/function_runner/src/lib.rs`
  - failed function execution must not publish a transaction.
- `crates/database/src/transaction.rs`
  - writes are staged until successful commit.
- `crates/application/src/application_function_runner/mod.rs`
  - backend-owned execution result controls final transaction outcome.

Flarex differences:

- Flarex represents the failed outcome through `/invoke/abort` over the
  Cloudflare-to-executor transport. Convex handles this inside its backend
  runtime boundary.

Known limitations:

- This still uses local Miniflare and PGlite, not hosted Dynamic Workers and
  real Postgres.
- There is still no retry loop around OCC conflicts from user-code execution.
- A session sweeper is still needed for runtime crashes that happen before the
  abort request reaches the executor.

Verification:

```sh
corepack pnpm test:integration
corepack pnpm --filter flarex-dev typecheck
git diff --check
```

## Partition Scope Runtime Update

## Required Partition Scope Update

Checkpoint title: `Require partition metadata for execution`

Previous completed checkpoint: `7673d45` Bind execution sessions to partition
metadata.

`ExecutionDO` sessions now require partition metadata before user-code syscalls
can run.

What changed:

- Removed the route-only and explicit `partitionKey` fallback execution scopes.
- `ExecutionDO.start()` fails with `PartitionValidationError` if the active
  function metadata has no `partition`.
- Session tests now declare `partition: users.byId("userId")` and pass the
  owner argument, matching the future generated handler model.

Convex references:

- `crates/isolate/src/environment/udf/syscall.rs`
  - user code gets syscalls after the backend establishes its execution
    context.
- `crates/function_runner/src/server.rs`
  - execution is created by the backend runner, not by user-selected storage.
- `crates/application/src/application_function_runner/mod.rs`
  - active deployment metadata is part of the execution boundary.

Cloudflare difference:

- The dynamic execution session must know the exact `PartitionDO` before any
  syscall can touch storage. Raw client-provided partition keys are transport
  data only.

Remaining limitations:

- Generated Worker transport still includes `partitionKey`; the backend now
  verifies it from partition metadata.
- There is no explicit non-partition execution policy yet for future global,
  projection, or workflow functions.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Partition Scope Runtime Update

Bound `ExecutionDO` sessions to function partition metadata before user-code
syscalls can run.

Checkpoint title: `Bind execution sessions to partition metadata`

Previous completed checkpoint: `231447a` Preserve partition selector metadata.

What changed:

- `ExecutionDO.start()` now resolves a `FunctionExecutionScope` from active
  deployment metadata.
- Partition metadata is preferred over route metadata and must match the
  request args and supplied partition key before a `SingleShardTransaction`
  begins.
- The active execution session stores the resolved scope alongside metadata,
  schema, and transaction state.
- Added an execution-session regression test where
  `partition: model.teams.bySlug("teamSlug")` rejects `partitionKey: "wrong"`
  before any syscalls run.

Convex references:

- `crates/isolate/src/environment/udf/syscall.rs`
  - syscalls run after the backend creates the function execution context.
- `crates/function_runner/src/server.rs`
  - the function runner receives a backend-controlled transaction context.
- `crates/application/src/application_function_runner/mod.rs`
  - deployment metadata and function runner state are joined by the backend.

Cloudflare difference:

- Flarex's execution session must hold a concrete `PartitionDO` key because
  Durable Object routing is outside the isolate. Convex's function runner does
  not expose that shard selection problem to user code.

Remaining limitations:

- The generated Worker still sends a `partitionKey` transport field; the
  backend now validates it, but the client transport has not been simplified.
- The scope is runtime metadata only. It does not yet narrow generated handler
  `ctx.db` types.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Last Update

Added the backend invoke boundary on top of `SingleShardTransaction`.
`executeInvoke` executes registered query or mutation handlers against a safe
`ctx.db` wrapper, commits mutations through `PartitionDO`, returns read sets for
queries, and maps partition commit errors back to HTTP responses. It now loads
schema from `DeploymentDO`, syncs the target partition cache before begin,
resolves table names for inserts, and returns developer-facing documents with
`_id` from `ctx.db.get`. The Worker has `/deployments/:deploymentId/invoke` and
top-level `/invoke` routes.

Convex inspiration:

- `crates/isolate/src/environment/udf/syscall.rs`
- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`
- `crates/application/src/api.rs`

Cloudflare difference: Convex's syscall machinery is inside its V8/Rust
function runner and is reached through `ApplicationApi`. Flarex starts with a
TypeScript invoke executor that calls a tenant-scoped `PartitionDO`; the Dynamic
Worker bridge still needs to provide the actual deployed function registry.

Verified with:

```sh
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend test
corepack pnpm --filter @flarex/backend build
```

## Execution Session Update

Added the first backend syscall session bridge. The generated Worker now:

1. Validates local function args with generated metadata.
2. Calls backend `/executions/start` with deployment, partition, path, kind,
   args, and idempotency key.
3. Builds `ctx.db` as a scoped syscall client.
4. Sends each `ctx.db.get/query/insert/patch/delete` to backend `/syscall`.
5. Validates the return locally for fast failure.
6. Calls backend `/finish`; backend validates the return again and commits
   mutations through `PartitionDO`.
7. Calls `/abort` if user code or local validation fails.

Convex inspiration:

- `crates/isolate/src/environment/udf/syscall.rs`
- `crates/function_runner/src/lib.rs`
- `crates/udf/src/validation.rs`
- `crates/application/src/application_function_runner/mod.rs`

Cloudflare difference: Convex keeps the function runner and transaction
machinery inside Rust/V8 process boundaries. Flarex uses a Worker service
binding and a per-session Durable Object to preserve the same separation while
letting user code run in Cloudflare's runtime.

Verified with:

```sh
corepack pnpm typecheck
corepack pnpm test
```

## Generated Worker E2E Update

Added an end-to-end generated Worker test in the example app. The test runs:

```txt
generated app Worker /invoke
  -> FLAREX_BACKEND service binding
  -> backend /executions/start
  -> backend /executions/:sessionId/syscall
  -> backend /executions/:sessionId/finish
  -> PartitionDO commit
```

The test deploys schema and generated function metadata to the backend harness,
invokes `lessons:complete`, then invokes `lessons:list` through the generated
Worker and verifies the write is read back through the backend index path.

Fixed the query syscall result contract while adding this test. Query syscalls
now return the SDK runtime envelope:

```ts
{ page, isDone, continueCursor }
```

instead of a raw document array. This matches `createQueryInitializer`, whose
`collect`, `paginate`, `first`, and `unique` helpers expect a paginated result
shape.

Convex inspiration remains the syscall boundary in:

- `crates/isolate/src/environment/udf/syscall.rs`
- `crates/function_runner/src/lib.rs`

Cloudflare difference: this test uses a Miniflare service binding function to
connect the generated Worker harness to the backend harness. Production should
use the real Worker service binding configured in generated Wrangler output.

Verified with:

```sh
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
```

## Implementation Checkpoints

### Architecture Terminology Cleanup

Previous completed checkpoint: `da42b4a` Add analysis import phase prelude.

Updated the Dynamic Worker roadmap to say Flarex loads the uploaded `flarex/`
source package through a Flarex-managed execution artifact. The developer does
not write Worker code, and Flarex does not bundle the developer's whole app.

Convex reference: Convex executes uploaded backend function modules behind its
own function runner boundary, while clients and application hosting remain
separate.

Verification:

```sh
git diff --check
```

### `a973c3a` Add backend execution sessions

Added backend-owned execution sessions and syscall routing so generated user
code can access scoped `ctx.db` operations without receiving database
connections or storage bindings.

### `36b021e` Test generated Worker backend invoke path

Added an end-to-end test proving that generated execution code invokes the
backend session and syscall path.

## Immutable Execution Artifact Input Update

Flarex development tooling now produces a self-contained internal execution
entrypoint inside a deterministic source package. Local analysis executes that
entrypoint directly.

This is not a deployed Dynamic Worker yet. It establishes the immutable input
that future local Miniflare and hosted Dynamic Worker adapters must consume,
without giving either adapter access to the developer filesystem.

## Local Execution Artifact Analysis Update

Previous completed checkpoint: `7abaa43` Use backend push lifecycle in local
dev.

Added `LocalMiniflareExecutionArtifactAdapter` as the first concrete
execution-artifact boundary. It takes the immutable `SourcePackage`, creates a
temporary Miniflare module graph, imports the bundled execution and schema
entrypoints inside that Worker-shaped isolate, and returns
`DeploymentAnalysis`.

This moves local analysis away from direct Node dynamic import for the normal
generation and dev paths. The developer still writes ordinary Flarex
TypeScript modules; the Worker entrypoint is generated internally by Flarex.

Convex inspiration:

- `crates/isolate/src/environment/analyze.rs`
  - authoritative metadata comes from evaluating runtime module exports.
- `crates/application/src/deploy_config.rs`
  - analysis is a deployment step that precedes activation.

Cloudflare difference: this is a local Miniflare execution artifact, not the
hosted Flarex Dynamic Worker runtime. Hosted source-package loading,
import-phase restrictions, and backend-owned analysis remain future work.

Verified with:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

## Active Deployment Session Start Update

Previous completed checkpoint: `b08269e` Record active deployment pointer on
finish.

Backend execution sessions now start from active deployment metadata.
`ExecutionDO.start` calls `loadActiveFunctionMetadata`, receives the active
deployment schema and function metadata from `DeploymentDO`, validates
arguments from that active analysis, syncs the partition schema cache, and only
then begins the shard transaction.

This keeps the generated Worker syscall path aligned with the hosted Dynamic
Worker target:

```txt
generated execution artifact /invoke
  -> backend /executions/start
  -> active deployment analysis lookup
  -> active schema and function validators
  -> backend-owned transaction session
```

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - query and mutation execution receives validated path/argument metadata
    before isolate execution.
- `crates/application/src/lib.rs`
  - functions are executed through the application runner after module
    metadata has been analyzed and stored.

Cloudflare difference: Flarex's execution session is still a Durable Object
memory session backed by syscalls. Convex keeps the transaction and function
runner inside its backend runtime. The important matching behavior is that
user code does not choose its own schema or validator metadata at invocation
time.

Tests now activate execution-session metadata through the push lifecycle and
prove a stale mutable `/functions` table entry cannot start a session when it
is not part of active analysis.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Materialized Artifact OCC Retry

Current checkpoint: pending commit for artifact/executor retry.

What changed:

- The materialized execution artifact now owns retry at the real transport
  boundary for Postgres mutation invocations.
- `/invoke/finish` responses from the trusted executor keep status and error
  code metadata inside the artifact runtime, so retryable OCC conflicts can be
  distinguished from user errors, validation failures, and non-retryable
  executor failures.
- On retry, the artifact starts a new backend invoke session and reruns the
  user handler. It does not replay a pre-collected operation list.
- The local materializer exposes an `invokeMaxAttempts` test/dev binding that
  maps to `FLAREX_INVOKE_MAX_ATTEMPTS`; exhausted OCC retries throw
  `InvokeRetryExhaustedError`.

Why this matters:

Flarex user code can interleave reads, writes, branching, and return
validation just like Convex-style mutations. The only safe retry unit is the
whole handler attempt with a fresh transaction session.

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - backend execution owns the attempt lifecycle around user code.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user code receives a scoped storage capability rather than a direct DB
    connection.
- `crates/database/src/committer.rs`
  - commit-time OCC decides whether an attempt can publish writes.

Cloudflare difference:

Convex keeps the isolate and committer in the backend process. Flarex's
artifact runs in Miniflare/Dynamic Worker form and reaches the trusted
executor over internal fetches, so retry must preserve HTTP error metadata and
rerun the artifact handler.

Verification:

```sh
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/execution-artifact-postgres.integration.test.ts
corepack pnpm --filter flarex-dev typecheck
```

## Postgres Transport Materialized Execution In Local Dev

Previous completed checkpoint: `09eb59c` feat: enhance live query subscription
handling and executor integration.

What changed:

- Recorded the `09eb59c` materialized execution changes that let local Dynamic
  Worker artifacts use the Postgres executor transport.
- Generated workers and materialized runtime workers normalize `undefined`
  handler returns to JSON `null` before `/invoke/finish`, matching mutation
  handlers that intentionally return nothing.
- Local dev now registers the pushed source package in the PGlite executor so
  scheduler reruns can materialize and execute the same source package through
  the executor session API.
- The local `/__flarex_dev/sync` test proves generated user code executes
  through the Postgres executor boundary and produces a live query update.

Why it changed:

Dynamic Worker execution must not receive a raw database handle. User code
should run against a scoped syscall client, and the trusted executor should own
session state, OCC, validation, persistence, freshness, and commit hooks.

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - function execution is mediated by backend runner infrastructure.
- `crates/isolate/src/lib.rs`
  - user code runs in an isolated execution boundary.
- `crates/database/src/committer.rs`
  - the database commit path owns validation and publication.

Flarex differences:

- Convex colocates isolate execution and database commit work in the backend.
  Flarex local dev materializes user modules in Miniflare and sends syscalls to
  a PGlite-backed executor HTTP runtime.
- `undefined` returns must cross an HTTP JSON boundary, so Flarex normalizes
  them to `null` before finish.

Known limitations:

- This is still local/test Dynamic Worker materialization, not hosted
  Cloudflare Dynamic Worker deployment.
- Query rerun freshness currently proves table reads; index/range read
  precision remains future work.

Verification:

```sh
pnpm --filter flarex-dev typecheck
pnpm --filter flarex-dev test -- dev.test.ts
```

## Runtime `ctx.db.replace` Syscall

Previous completed checkpoint: `0e3b118` Add invoke replace syscall.

What changed:

- The generated Worker runtime and local execution artifact materializer now
  expose `ctx.db.replace(id, value)`.
- Materialized mutation artifacts emit backend syscalls shaped as
  `{ op: "replace", id, value }`.
- The full stored-source-package runtime test now performs
  `insert -> patch -> replace` in user code and verifies the committed final
  document.
- The legacy `ExecutionDO` syscall route now accepts `replace` so the retained
  DO prototype does not break while Postgres remains the forward path.

Convex references:

- `npm-packages/convex/src/server/impl/database_impl.ts`
  - Convex's user-code writer forwards `replace` to the backend syscall layer.
- `crates/isolate/src/environment/udf/syscall.rs`
  - storage operations remain behind a controlled syscall boundary.

Flarex differences:

- Convex executes this syscall inside its backend isolate/runtime stack.
  Flarex emits it from Cloudflare-hosted user code to either the legacy
  `ExecutionDO` route or the trusted Postgres executor route.
- The DO route is compatibility scaffolding. The Postgres executor remains the
  target authoritative path.

Known limitations:

- The generated runtime still has no table-scoped writer object.
- Per-session syscall capability tokens remain future hardening.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
git diff --check
```

## Maintenance Policy Boundary

Previous completed checkpoint: `5358924` Add invoke session maintenance route.

What changed:

- Added the executor maintenance API for invoke sessions.
- Added `POST /maintenance/invoke-sessions` as the route a scheduler should
  call instead of manually calculating `olderThan`.
- Added optional `maxSessions` and `hasMore` so the scheduler can process stale
  sessions in bounded batches.
- Kept the operation outside generated user code and outside Dynamic Worker
  execution modules.

Why it matters:

The Dynamic Worker should run user functions and call executor syscalls. It
should not own platform maintenance policy. The trusted executor now has the
small policy wrapper needed for a future Vercel/Nitro cron job:

```txt
scheduled job
  -> /maintenance/invoke-sessions { staleAfterMs, maxSessions }
  -> executor computes olderThan
  -> abort oldest stale active session batch
  -> repeat while hasMore
```

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - backend-side orchestration owns execution lifecycle decisions.
- `crates/database/src/transaction.rs`
  - abandoned transaction work remains unpublished.

Flarex differences:

- Flarex exposes an explicit maintenance route because the executor is
  framework-neutral and can be hosted behind Nitro/Vercel.
- This is a hosted-platform operation, not a Convex-style user function.
- The batch loop belongs to platform scheduling, not user code or generated
  Dynamic Worker modules.

Known limitations:

- Cron wiring is still pending.
- Per-deployment TTL configuration is still pending.
- Batched stale abort is implemented; batched retention deletion of old aborted
  session rows is still pending.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Maintenance Deployment Discovery

Previous completed checkpoint: `69b1d73` Batch invoke session maintenance.

What changed:

- Added platform-wide deployment listing to the trusted executor core.
- Listing is cursor based and stable across deployments with equal timestamps.
- No generated user code or Dynamic Worker module changed.

Why it matters:

A future scheduled job needs two loops:

```txt
list deployment batch
  -> for each deployment, run invoke-session maintenance batch
  -> repeat by deployment cursor
```

The Dynamic Worker should not discover deployments or own platform maintenance.
That belongs to the trusted executor side.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - backend orchestration owns runtime lifecycle decisions.

Flarex differences:

- Flarex needs explicit deployment discovery because the scheduler will live in
  the Nitro/Vercel executor side, not inside Cloudflare user-code execution.
- This is executor-core only; no HTTP route or cron binding is added yet.

Known limitations:

- Cron wiring is still pending.
- No project-level filter exists yet.
- Per-deployment TTL policy is still pending.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Maintenance Sweep Core Loop

Previous completed checkpoint: `a0ac1fe` List deployments for maintenance.

What changed:

- Added the trusted executor core sweep that combines deployment discovery with
  per-deployment invoke-session maintenance.
- The sweep returns both deployment pagination state and per-deployment
  `hasMoreSessions` state.
- No generated user code, Dynamic Worker module, HTTP route, or cron binding
  changed.

Why it matters:

The future scheduler shape is now a single core call:

```txt
runMaintenanceSweep
  -> list one deployment page
  -> abort one stale session batch per deployment
  -> return deployment cursor and hot deployment flags
```

This keeps platform maintenance outside Cloudflare user execution and makes the
Nitro/Vercel cron adapter a thin host integration.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - backend orchestration owns runtime lifecycle decisions.

Flarex differences:

- Flarex needs this explicit core loop because the trusted executor may run as
  a Nitro/Vercel service while user code runs elsewhere.
- Convex keeps equivalent lifecycle behavior internal to the backend service.

Known limitations:

- Cron wiring is still pending.
- Hot deployments are reported but not looped until drained in one call.
- Per-deployment TTL policy is still pending.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Runtime Failure Cleanup Boundary

Previous completed checkpoint: `a08eddd` Verify artifact abort after staged
writes.

What changed:

- Recorded and implemented the executor-side stale invoke-session cleanup path.
- `POST /invoke/abort-stale` is now available through the shared HTTP adapter
  and therefore through the Nitro adapter.
- The operation is intentionally not part of generated user modules. It is a
  trusted backend/scheduler operation that marks old active sessions aborted.

Why it matters for Dynamic Worker execution:

The Flarex runtime split is:

```txt
Cloudflare Dynamic Worker user code
  -> executor invoke session
  -> syscalls staged in Postgres
  -> finish commits, abort abandons
```

Generated runtime abort is necessary but not sufficient. A Dynamic Worker can
fail before it sends `/invoke/abort`. The backend must be able to recover those
sessions later so staged writes remain non-published and active-session tables
do not grow forever.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - the backend owns execution coordination.
- `crates/database/src/transaction.rs`
  - uncommitted transaction state is not visible as committed database state.

Flarex differences:

- Convex does not need an HTTP stale-abort route between a Dynamic Worker and
  transaction executor. Flarex does because runtime execution and trusted
  transaction ownership are separate deployable units.
- This is cleanup, not retry. It never commits user writes.

Known limitations:

- No actual scheduled sweeper is configured yet.
- No deployment-level TTL configuration yet.
- No cleanup of abandoned read/write rows yet.

Verification:

```sh
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/persistence-postgres test
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor test
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm --filter @flarex/executor-nitro test
git diff --check
```

## Active Deployment Required For Invoke

Previous completed checkpoint: `63637f9` Harden create-root sync docs and
tests.

Backend invoke no longer falls back to directly replaced schema/function
metadata when no active deployment exists. The execution boundary now starts
from active push analysis:

```txt
/invoke or /deployments/:id/invoke
  -> load active deployment
  -> validate active function metadata
  -> artifact runtime or backend execution session
```

This aligns the dynamic-worker plan with the source-package bundle model: user
code is not a Worker app and runtime metadata comes from the pushed `flarex/`
package analysis.

Convex references:

- `crates/application/src/application_function_runner/mod.rs`
  - execution resolves deployment/package metadata before invoking user code.
- `crates/model/src/source_packages/mod.rs`
  - code identity is durable source-package metadata.

Cloudflare difference: Flarex may still run direct in-memory handlers in unit
tests, but those handlers now require an active deployment schema created by
push activation. The public runtime path no longer has direct schema/functions
metadata replacement routes.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/invoke.test.ts test/executionDO.test.ts --maxWorkers=1
```

## Generated Create-Root Artifact Execution

Previous completed checkpoint: `10c02a4` Run create-root execution sessions.

The generated and materialized execution workers now start backend execution
sessions with optional partition keys. This lets create-root functions execute
through the same syscall path as existing-root functions:

```txt
generated/artifact worker invoke
  -> start execution session without partitionKey
  -> backend active metadata says partitionCreateRoot
  -> ExecutionDO preallocates root id
  -> ctx.db.insert(rootTable, value) syscall returns that id
  -> finish commits staged writes
```

The integration test now materializes a stored source package containing:

```ts
export const create = mutation({
  partition: model.users,
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await ctx.db.insert("users", { name: args.name });
    const profileId = await ctx.db.insert("profiles", { userId, bio: "Hello" });
    return { userId, profileId };
  },
});
```

Convex references:

- `crates/function_runner/src/lib.rs`
  - user function execution is mediated by the backend runner.
- `crates/isolate/src/environment/udf/syscall.rs`
  - storage access crosses the syscall boundary.
- `crates/database/src/transaction.rs`
  - generated ids are transaction-local state until commit.

Cloudflare difference: Flarex's materialized source-package runtime runs in
Miniflare/Dynamic Worker style and calls the backend over internal fetch. It
does not own transaction state; `ExecutionDO` and `PartitionDO` do.

Verification:

```sh
corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/executionDO.test.ts --maxWorkers=1
```

## Create-Root Execution Sessions

Previous completed checkpoint: `2e6dc68` Consume preallocated root ids.

Execution sessions can now run create-root mutations through backend-owned
syscalls. `ExecutionDO.start` accepts active function metadata with
`partitionCreateRoot`, preallocates the root document id during partition
resolution, begins `SingleShardTransaction` with the create-root context, and
keeps that context in the session transaction.

Runtime shape:

```txt
/deployments/:deploymentId/executions/start
  -> active function metadata
  -> partitionCreateRoot preallocates root id
  -> ExecutionDO owns SingleShardTransaction(partitionKey = root id)
  -> generated worker calls /syscall insert(root table)
  -> transaction returns the preallocated id
  -> /finish validates return and commits
```

The generated user-code worker still does not receive a raw database
connection. It only talks to the backend session through syscalls, which keeps
commit authority inside the backend `PartitionDO` path.

Convex references:

- `crates/function_runner/src/lib.rs`
  - function execution gets a backend-controlled context instead of direct
    database access.
- `crates/isolate/src/environment/udf/syscall.rs`
  - isolate code reaches storage through syscalls.
- `crates/database/src/transaction.rs`
  - generated ids and staged writes are transaction state.
- `crates/database/src/committer.rs`
  - invalid mutation state is rejected before/during commit.

Cloudflare difference: Flarex must choose a `PartitionDO` before user code
runs. For create-root functions, the backend preallocates the `_id` partition
key first, then `ctx.db.insert(rootTable, value)` consumes that same id through
the syscall path. Convex does not expose this routing concern because its
runtime presents one logical transactional database.

Remaining limitations:

- Final generated code still rejects create-root declarations, so this is a
  backend capability but not yet a supported app-authoring flow.
- Public `/invoke` request construction still expects caller-supplied partition
  keys; hosted artifact execution should move create-root app calls through
  execution sessions instead.
- Cross-shard mutation semantics are unchanged; this only hardens single-shard
  root creation.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- --runInBand
```

## Runtime Materializer Cache Update

Previous completed checkpoint: `f88296c` Authorize artifact runtime calls.

The artifact runtime service now has a reusable materialization/cache boundary:

- `ExecutionArtifactMaterializer`
- `MaterializedExecutionArtifact`
- `CachedExecutionArtifactMaterializer`
- `createExecutionArtifactRuntimeService()`

The runtime service:

- authorizes `/invoke` with the internal capability token when configured,
- validates `x-flarex-artifact-id` and `x-flarex-source-package-hash` against
  the invoke payload,
- materializes an artifact on first use,
- reuses the cached artifact for later invokes with the same `artifactId` and
  full source package hash,
- rematerializes if an artifact ID is reused with a different hash.

This is still not the real Cloudflare Dynamic Worker loader. It is the runtime
service contract the loader should implement.

Convex references inspected:

- `crates/application/src/module_cache/mod.rs`
  - module cache keys include module path and sha256.
- `crates/application/src/application_function_runner/mod.rs`
  - execution resolves source package storage metadata before executor invoke.
- `crates/node_executor/src/executor.rs`
  - executor responses track download and import timing, reflecting the
    package materialization/import boundary.

Cloudflare difference: Flarex caches a materialized artifact object by
`artifactId` plus full source package hash. Convex caches module source by
module path and sha256 and delegates Node package loading/import to its
executor path.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Local Source Package Materializer Update

Previous completed checkpoint: `0447832` Add artifact runtime materializer cache.

Added the first concrete execution artifact materializer for development:
`LocalMiniflareExecutionArtifactMaterializer`.

It consumes the stored `flarex/` source package, builds a Worker-shaped module
graph in Miniflare, generates a small internal runtime wrapper, imports the
package's `_flarex/execution.js` entrypoint, resolves `module:export`
functions, and runs query/mutation handlers with only a syscall-backed
`ctx.db`.

The materialized runtime calls:

```txt
developer function
  -> ctx.db syscall client
  -> backend /executions/:sessionId/syscall
  -> backend /executions/:sessionId/finish
  -> PartitionDO commit for mutations
```

The developer still uploads only the `flarex/` source package. This is not a
developer Worker and not a whole-app bundle.

Convex references inspected:

- `crates/application/src/module_cache/mod.rs`
  - module cache identity includes module path and sha256.
- `crates/application/src/application_function_runner/mod.rs`
  - execution resolves source package identity before invoking an executor.
- `crates/node_executor/src/executor.rs`
  - executor requests carry source package identity/hash and report import
    timing.

Cloudflare difference: Convex materializes modules inside its Rust/V8 or Node
executor path. Flarex currently materializes the source package in a local
Miniflare isolate; the hosted replacement should be the Flarex-managed Dynamic
Worker loader with the same `ExecutionArtifactMaterializer` contract.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- artifactRuntimeRoute.test.ts
```

## Dev Invoke Uses Materialized Source Package Update

Previous completed checkpoint: `c8c16bb` Materialize stored source packages
locally.

Local dev now exercises the backend artifact runtime path for normal invoke.
`/__flarex_dev/invoke` no longer reads an in-memory local artifact store and no
longer calls the generated app Worker as the execution artifact. It forwards to
backend `/deployments/:deploymentId/invoke`, which loads the active source
package from R2 and invokes the materialized artifact runtime.

This keeps the execution boundary aligned with the target architecture:

```txt
active deployment
  -> stored source package
  -> materialized execution artifact
  -> restricted ctx.db syscalls
  -> backend-owned transaction session
```

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - function execution is rooted in active deployment metadata and package
    identity.

Cloudflare difference: the local materializer is Miniflare. Hosted Flarex
still needs the real Cloudflare Dynamic Worker loader, but the call contract is
now the same in local dev.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- dev.test.ts
```

## Runtime Store Loading Update

Previous completed checkpoint: `ef50030` Use artifact runtime for local dev
invoke.

The execution artifact runtime no longer has to receive raw source package JSON
from backend invoke. In runtime-store mode, the backend sends only:

```txt
deploymentId
executionArtifactRef
invoke request
```

The runtime service loads the source package from its own artifact store before
materializing. Materializers still receive a fully resolved source package, so
the sandbox/runtime implementation stays simple while the transport contract
moves closer to the hosted Dynamic Worker target.

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - function execution carries source-package identity to the executor
    boundary.
- `crates/model/src/source_packages/mod.rs`
  - source-package bytes are loaded through backend-owned storage metadata.

Cloudflare difference: local dev uses Miniflare R2 and a service binding as
the runtime store. Hosted Flarex should make the Dynamic Worker runtime load
the artifact from the platform-owned store.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- artifactRuntime.test.ts
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts dev.test.ts
```

## Materialized Artifact Disposal Update

Previous completed checkpoint: `e1ccf14` Let artifact runtime load source
packages.

The artifact runtime cache now owns the lifecycle of materialized execution
artifacts:

- replacing an artifact with the same `artifactId` but a different
  `sourcePackageHash` disposes the old artifact,
- `delete(artifactId)` removes and disposes one artifact,
- `clear()` disposes all cached artifacts,
- `createExecutionArtifactRuntimeService()` exposes `dispose()` and
  `cacheSize()` for local-dev/test cleanup.

This matters for the Dynamic Worker target because materialized artifacts may
own nested Worker isolates, module caches, timers, or future runtime resources.
Dropping references without disposal is not an acceptable long-running runtime
contract.

Convex reference:

- `crates/application/src/module_cache/mod.rs`
  - cached module state has explicit runtime ownership and identity.
- `crates/node_executor/src/executor.rs`
  - executor/module loading is a long-lived runtime boundary that must be
    managed separately from request execution.

Cloudflare difference: local dev currently disposes nested Miniflare
materializations. Hosted Flarex should map the same lifecycle contract to
Dynamic Worker eviction or artifact runtime teardown.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- artifactRuntime.test.ts
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- dev.test.ts runtimeMaterializer.test.ts
```

## Runtime Capability Authorization Update

Previous completed checkpoint: `c623476` Route invoke through artifact
runtime.

Generated execution artifacts now support optional internal-route
authorization:

- `FLAREX_INTERNAL_TOKEN` on the generated artifact side.
- `FLAREX_ARTIFACT_RUNTIME_TOKEN` on the backend side.
- backend artifact runtime calls include `Authorization: Bearer <token>`.
- generated `/__flarex_internal/invoke` and `/__flarex_internal/metadata`
  reject unauthorized calls when a token is configured.

This protects the future managed Dynamic Worker internal routes from becoming
public application API surfaces. Public `/invoke` remains separate; internal
routes become guarded once the managed runtime is configured with a token.

Still not implemented:

- real Dynamic Worker materialization/cache,
- token rotation,
- per-session syscall capability tokens,
- runtime-side validation that artifact headers match the loaded artifact.

Convex reference:

- `crates/node_executor/src/executor.rs`
  - executor requests carry backend callback/auth material alongside source
    package identity.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Backend Artifact Runtime Invoke Update

Previous completed checkpoint: `804a055` Add backend artifact storage binding.

The backend now has the first invoke-side hosted artifact runtime boundary.
When both `ARTIFACTS` and `FLAREX_ARTIFACT_RUNTIME` are configured, public
backend invoke loads the active source package from R2 and forwards an
`ExecutionArtifactInvokePayload` to the runtime service binding.

This is the first backend-hosted equivalent of the local dev flow:

```txt
active deployment
  -> executionArtifactRef
  -> artifact store get(ref)
  -> execution artifact runtime invoke
  -> generated internal invoke route
  -> execution session syscalls
```

Still not implemented:

- actual Cloudflare Dynamic Worker upload/loading,
- runtime-side materialization from R2 without the backend passing source JSON,
- capability-token authorization for internal runtime calls,
- runtime cache/eviction keyed by `artifactId`,
- hosted source-map/runtime diagnostics.

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - executor requests are built after resolving source package storage identity
    and package hashes from backend state.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Backend Artifact Storage Binding Update

Previous completed checkpoint: `873fee7` Add R2 execution artifact store
adapter.

The hosted backend now has an optional R2-backed artifact store binding:
`Env.ARTIFACTS`. Public push start stores successfully analyzed source packages
through `R2BackendExecutionArtifactStore`, and public push finish verifies the
stored manifest/source package before activation.

This moves the hosted path from "active deployment has an artifact pointer" to
"active deployment can only be publicly finished after the artifact pointer is
backed by durable storage" when R2 is configured.

Still not implemented:

- hosted Dynamic Worker artifact materialization,
- internal Dynamic Worker `/__flarex_internal/invoke` loading from R2,
- runtime authorization between backend and the managed execution artifact,
- GC for old `artifacts/{artifactId}` objects.

Convex reference:

- `crates/application/src/deploy_config.rs`
  - `finish_push` validates and downloads package storage before committing the
    deployment.
- `crates/application/src/application_function_runner/mod.rs`
  - executor requests carry package storage identity/hash when code runs
    outside the main backend process.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Local Execution Artifact Runtime Boundary Update

Previous completed checkpoint: `d5e13dd` Store active execution artifact
reference.

`flarex-dev` now has the first invoke-side execution artifact runtime
boundary:

```ts
interface ExecutionArtifactRuntime {
  invoke(ref: ExecutionArtifactRef, request: ExecutionArtifactInvokeRequest): Promise<unknown>;
}
```

`LocalMiniflareExecutionArtifactRuntime` calls:

```txt
POST /__flarex_internal/invoke
```

on the generated execution artifact and sends artifact identity headers:

```txt
x-flarex-artifact-id
x-flarex-source-package-hash
```

The generated Worker now serves `/__flarex_internal/invoke` with the same
backend execution-session/syscall behavior as `/invoke`. Local dev resolves
the active deployment through the backend, reads `executionArtifactRef`, and
invokes through the runtime adapter.

This creates the contract needed for the hosted path:

```txt
active deployment
  -> executionArtifactRef
  -> ExecutionArtifactRuntime.invoke
  -> internal execution artifact invoke
  -> backend execution sessions/syscalls
```

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - executor requests carry source package identity/hash information when code
    is loaded outside the main runtime.
- `crates/model/src/source_packages/mod.rs`
  - source packages are durable metadata looked up by ID before execution.

Cloudflare difference: this checkpoint is still local Miniflare execution
artifact plumbing. The hosted Dynamic Worker runtime adapter, artifact upload,
and runtime authorization are not implemented yet.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Execution Artifact Store Boundary Update

Previous completed checkpoint: `363d7e0` Add local execution artifact runtime
invoke.

Added the first source-package store boundary for execution artifacts.

New shared runtime-neutral helpers live in `flarex/artifacts`:

```ts
executionArtifactRefForSourcePackage(sourcePackage)
stableSourcePackageManifest(sourcePackage)
validateExecutionArtifactRef(value)
```

`flarex-dev` now exposes:

```ts
interface ExecutionArtifactStore {
  put(sourcePackage): Promise<ExecutionArtifactRef>;
  get(ref): Promise<SourcePackage>;
}
```

with `LocalInMemoryExecutionArtifactStore` as the local implementation. Local
dev stores the bundled source package before finishing a push, then validates
that the active `executionArtifactRef` can retrieve an artifact before invoking
through `LocalMiniflareExecutionArtifactRuntime`.

Convex references inspected:

- `crates/model/src/source_packages/mod.rs`
  - `SourcePackageModel::put` and `get` are the durable source package store
    boundary.
- `crates/model/src/modules/types.rs`
  - module metadata links active analyzed modules to source package identity
    and module `sha256`.
- `crates/application/src/application_function_runner/mod.rs`
  - execution can retrieve source package metadata before calling an executor.

Cloudflare difference: this checkpoint stores packages in local memory only.
The hosted Dynamic Worker runtime still needs an R2/KV-backed store and a
loader that materializes an internal execution artifact from the stored source
package.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Hosted Artifact Store Contract Update

Previous completed checkpoint: `bccc7cd` Add execution artifact store
boundary.

Added the first Cloudflare-oriented artifact store contract without wiring it
to production runtime yet.

`flarex-dev` now exposes:

```ts
interface DurableExecutionArtifactStore {
  put(ref, sourcePackage): Promise<void>;
  get(ref): Promise<SourcePackage>;
  delete(ref): Promise<void>;
}
```

and `R2ExecutionArtifactStore`, which stores:

```txt
artifacts/{artifactId}/manifest.json
artifacts/{artifactId}/source-package.json
```

`get(ref)` loads the manifest and source package, validates that the manifest
matches the requested ref, then recomputes the source package ref before
returning the package.

Convex references inspected:

- `crates/model/src/source_packages/mod.rs`
  - `SourcePackageModel::put` and `get` define the durable package store
    boundary.
- `crates/model/src/source_packages/types.rs`
  - source package metadata carries `storage_key` and `sha256`.
- `crates/application/src/application_function_runner/mod.rs`
  - execution resolves source package storage metadata before invoking an
    executor.

Cloudflare difference: this is an R2-shaped adapter tested with a fake bucket.
It is not yet bound to a Worker environment and does not yet create/load the
hosted Dynamic Worker artifact.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Active Execution Artifact Pointer Update

Previous completed checkpoint: `4a6e66f` Resolve execution sessions from active
deployment.

The active deployment record now exposes `executionArtifactRef`, a deterministic
pointer for the Flarex-managed Dynamic Worker runtime to load later.

Current flow:

```txt
finish_push
  -> compute source package manifest hash
  -> store active_execution_artifact_ref
  -> /deployment returns executionArtifactRef
```

Target hosted invoke flow:

```txt
active deployment
  -> executionArtifactRef
  -> Flarex-managed Dynamic Worker runtime
  -> internal execution artifact invoke
  -> backend execution session syscalls
```

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - executor requests can carry source package identity and package hashes
    when code is loaded outside the main Rust runtime.
- `crates/model/src/source_packages/mod.rs`
  - source package metadata is durable and retrieved by ID.

Cloudflare difference: this is still only a pointer. The hosted Dynamic Worker
adapter, artifact upload/storage, and internal `/__flarex_internal/invoke`
loader are not implemented yet.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```
