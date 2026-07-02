# Effect Migration Checklist

This is the concrete source of truth for the remaining Effect v4 migration.
Update this file every Effect migration turn:

- move the active checkpoint marker to the current slice
- tick completed items only after code, focused tests, broad validation, and the
  EffectTS quality checker pass
- record the previous completed commit in the next repository-changing turn
- keep `ValidatorJson` as Flarex user validation semantics; migrate transport,
  route, service, and persistence boundaries around it

Current baseline:

- Previous completed checkpoint: C-1d Remaining protocol contract cleanup in this
  checkpoint commit.
- Effect version: workspace catalog `effect@4.0.0-beta.90`.
- Reviewer: only `.codex/agents/effect-ts-quality-checker.toml` for Effect
  migration checkpoints.
- Required final gates for backend Effect checkpoints:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
git diff --check
```

Add focused test files listed on each checkpoint. Add package-specific gates
when a checkpoint touches `flarex-protocol`, `@flarex/executor-http`, or app
wrappers.

## Audit Evidence

The remaining work below was derived from this repo state after `2aa931c`.

- Manual JSON/request boundaries remain in:
  `packages/flarex-backend/src/*/RouteBoundary.ts`,
  `packages/flarex-backend/src/http.ts`,
  `packages/executor-http/src/index.ts`, and selected storage/runtime helpers.
- `readJsonEffect(...)` call sites remain in connection, execution, invoke,
  live query delivery, partition, scheduler, registry, deployment public push,
  delivery, and artifact runtime route boundaries.
- `Effect.runPromise(...)` runtime edges remain in Worker/DO adapters,
  executor-http, artifact runtime, invoke, live query delivery, scheduler,
  delivery, connection, partition, transaction, registry, and deployment
  adapters.
- Manual `JSON.parse(...)` casts remain most heavily in `partitionDO.ts`, plus
  deployment store/validation, scheduler delivery wake, and connection message
  parsing.
- `HttpError` remains an adapter compatibility type across Worker routes,
  internal DO boundaries, scheduler/delivery/connection route mappers, and
  public route dispatch errors.

## Migration Done Means

The Effect migration is complete only when all of these are true:

- [ ] All public Worker routes enter through typed Effect route decoders and
  have one HTTP response mapper at the Worker adapter edge.
- [ ] All Durable Object fetch routes enter through typed Effect route decoders
  and have one response mapper at the DO adapter edge.
- [ ] Shared protocol packages expose schema-first Effect decoders for
  transport contracts; throwing `parseX(...)` functions are compatibility
  wrappers only.
- [ ] Service/domain code emits tagged errors at the source boundary and does
  not depend on `HttpError`.
- [ ] Reusable Effect functions are named with `Effect.fn("qualified.name")`.
- [ ] `Effect.runPromise(...)` is confined to Worker, DO, test, and explicitly
  documented runtime bridge edges.
- [ ] Manual `request.json()` and untyped `JSON.parse(...)` casts are either
  replaced by schema-backed Effect decoders or documented as runtime bridge
  exceptions with tests.
- [ ] `executor-http` uses the same typed Effect route/body/error pattern as
  the backend, even if Elysia remains the HTTP adapter.
- [ ] Tests assert typed success/failure channels separately from HTTP response
  mapping for each migrated family.
- [ ] `ValidatorJson` remains intact and is not replaced by Effect Schema for
  user function/document validation.

## Checkpoint Plan

### Phase 1: Finish DeploymentDO Direct Dispatch

- [x] D-1. Add typed `DeploymentApiRouteInput` and decode DeploymentDO API
  route requests before compatibility dispatch.
  - Completed by: `203ca2f` Type deployment route input boundary.
  - Focus tests: `test/deploymentHttpApiRouteBoundary.test.ts`.
- [x] D-2. Isolate generated HttpApi request rebuilding behind
  `dispatchDeploymentApiRouteInputViaRequestCompatibility(...)`.
  - Completed by: `a5843f5` Type deployment route compatibility dispatch.
  - Focus tests: `test/deploymentHttpApiRouteBoundary.test.ts`.
- [x] D-3. Add direct generated-handler dispatch for DeploymentDO mutation
  route inputs without wiring production requests yet.
  - Completed by: `2aa931c` Type deployment direct mutation dispatch.
  - Focus tests: `test/deploymentHttpApiRouteBoundary.test.ts`.
- [x] D-4. Wire `routeDeploymentDurableObject(...)` mutation routes
  `start/finish/abandon` to `dispatchDeploymentApiMutationRouteInputDirect(...)`
  and keep read routes on the compatibility bridge.
  - Completed by: `c4404be` Wire deployment mutation direct dispatch.
  - Files:
    `packages/flarex-backend/src/deployment/InternalRouteBoundary.ts`,
    `packages/flarex-backend/src/deploymentDO.ts`,
    `packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts`,
    `packages/flarex-backend/test/push.test.ts`.
  - Must preserve: existing status/body behavior for start, finish activated,
    finish rejected `409`, abandon success, conflict/not-found/storage errors,
    health, and not-found.
  - Focus tests:
    `test/deploymentHttpApiRouteBoundary.test.ts`,
    `test/deploymentHttpApiHandlers.test.ts`,
    `test/push.test.ts`.
- [x] D-5. Add direct read response mapping for DeploymentDO read routes
  `GET /deployment` and `GET /push/:pushId`, then remove read-route dependence on
  generated web-handler request rebuilding.
  - Completed by: `34a6022` Map deployment reads directly.
  - Files:
    `packages/flarex-backend/src/deployment/InternalRouteBoundary.ts`,
    `packages/flarex-backend/src/deployment/HttpApiRouteBoundary.ts`,
    `packages/flarex-backend/src/deployment/HttpApiHandlers.ts`,
    `packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts`,
    `packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts`.
  - Must preserve: active deployment success, active not-found, push success,
    push not-found, storage failure mapping.
- [x] D-6. Delete or demote `dispatchDeploymentApiRouteInputViaRequestCompatibility(...)`
  after all DeploymentDO API routes dispatch directly.
  - Completed by: `3095319` Remove deployment request bridge.
  - Files:
    `packages/flarex-backend/src/deployment/InternalRouteBoundary.ts`,
    `packages/flarex-backend/src/deployment/HttpApiWebHandler.ts`,
    `packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts`.
  - Must preserve: generated handler tests until direct adapter tests provide
    equal coverage.

### Phase 2: Public Deployment Push Worker Routes

- [x] P-1. Replace public deployment start/finish/abandon body compatibility
  wrappers with typed Effect route-input objects.
  - Completed by: `d4d1fc7` Type public push route inputs.
  - Files:
    `packages/flarex-backend/src/deployment/PublicPushRouteBoundary.ts`,
    `packages/flarex-backend/src/deployment/PublicPushDispatchBoundary.ts`,
    `packages/flarex-backend/src/worker.ts`.
  - Focus tests:
    `test/publicDeploymentPushRouteBoundary.test.ts`,
    `test/publicDeploymentPushDispatchBoundary.test.ts`,
    `test/push.test.ts`.
- [x] P-2. Move public deployment Worker HTTP response mapping to one adapter
  edge and stop exposing `HttpError` from public deployment dispatch logic.
  - Completed by: `656d1ea` Map public deployment errors at adapter.
  - Files:
    `packages/flarex-backend/src/worker.ts`,
    `packages/flarex-backend/src/deployment/PublicPushDispatchBoundary.ts`,
    `packages/flarex-backend/src/worker/PublicRouteDispatchError.ts`.
  - Must preserve: start pending, analyzed start, read push, finish, abandon,
    scheduler handoff, deployment id/path errors.
- [x] P-3. Schema-check public start artifact and finish artifact service
  boundary responses through typed Effect decoders.
  - Completed by: `a1c1871` Validate public artifact boundaries.
  - Files:
    `packages/flarex-backend/src/deployment/PublicStartArtifactBoundary.ts`,
    `packages/flarex-backend/src/deployment/PublicFinishArtifactBoundary.ts`,
    `packages/flarex-backend/src/backendAnalyzerResponse.ts`.
  - Focus tests:
    `test/publicStartArtifactBoundary.test.ts`,
    `test/publicFinishArtifactBoundary.test.ts`,
    `test/deploymentValidation.test.ts`,
    `test/push.test.ts`.

### Phase 3: Worker Route Error Model

- [x] W-1. Replace `type PublicWorkerRouteError = HttpError` with a tagged
  Worker route error union and one Worker-level response adapter.
  - Completed by: `8312909` Tag public worker route errors.
  - Files:
    `packages/flarex-backend/src/worker.ts`,
    `packages/flarex-backend/src/worker/PublicRouteDispatchError.ts`,
    `packages/flarex-backend/src/worker/PublicRoutePathBoundary.ts`.
  - Focus tests:
    `test/publicWorkerRouteDispatchError.test.ts`,
    `test/publicWorkerRoutePathBoundary.test.ts`,
    `test/publicPassThroughDispatchBoundary.test.ts`,
    `test/publicDeploymentPushRouteBoundary.test.ts`,
    `test/publicDeploymentPushDispatchBoundary.test.ts`,
    `test/push.test.ts`.
- [x] W-2. Convert deployment, scheduler, invoke, execution, partition,
  live-query, delivery-wake branches in `routePublicWorker(...)` to return
  typed route errors until the Worker adapter edge.
  - Completed by: `33054dd` Propagate public worker route errors.
  - Files:
    `packages/flarex-backend/src/worker.ts` and the route boundary files listed
    by each branch.
  - Must preserve: route precedence and all current status/body shapes.
  - Focus tests:
    `test/publicWorkerRouteDispatchError.test.ts`,
    `test/publicWorkerRoutePathBoundary.test.ts`,
    `test/publicPassThroughDispatchBoundary.test.ts`,
    `test/publicDeploymentPushRouteBoundary.test.ts`,
    `test/publicDeploymentPushDispatchBoundary.test.ts`,
    `test/publicSchedulerRouteBoundary.test.ts`,
    `test/publicSchedulerDispatchBoundary.test.ts`,
    `test/publicInvokeRouteBoundary.test.ts`,
    `test/invoke.test.ts`,
    `test/push.test.ts`.
- [x] W-3. Convert `project.ts` required parameter helpers from throwing
  `HttpError` to typed Effect path/precondition errors.
  - Completed by: `7737cd0` Type project required parameters.
  - Files:
    `packages/flarex-backend/src/project.ts`,
    ConnectionDO executor calls, and scheduler cleanup request decoding.
  - Focus tests:
    `test/project.test.ts`,
    `test/schedulerRouteBoundary.test.ts`,
    `test/publicSchedulerRouteBoundary.test.ts`,
    `test/sync.test.ts`.

### Phase 4: Route Boundary Families

- [x] R-1. Execution route boundaries:
  `StartRouteBoundary.ts`, `ActionRouteBoundary.ts`,
  `FinishRouteBoundary.ts`, `SyscallRouteBoundary.ts`.
  - Completed by: `4f36d96` Type execution route boundaries.
  - Goal: typed route-input decoders and adapter-only `HttpError`.
  - Focus tests:
    `test/executionStartRouteBoundary.test.ts`,
    `test/executionActionRouteBoundary.test.ts`,
    `test/executionFinishRouteBoundary.test.ts`,
    `test/executionSyscallRouteBoundary.test.ts`,
    `test/executionDO.test.ts`.
- [x] R-2. Invoke route boundary:
  `invoke/PublicInvokeRouteBoundary.ts` and `invoke.ts`.
  - Completed by: `737e075` Type public invoke boundary.
  - Goal: typed public invoke route input, active deployment load failures as
    tagged errors, one response adapter.
  - Focus tests:
    `test/publicInvokeRouteBoundary.test.ts`,
    `test/invokeRequests.test.ts`,
    `test/invoke.test.ts`.
- [x] R-3. Partition route boundaries:
  `partition/RouteBoundary.ts`,
  `partition/PublicSchemaCacheRouteBoundary.ts`,
  `partition/PublicDispatchBoundary.ts`.
  - Completed by: this R-3 checkpoint commit.
  - Goal: typed begin/commit/read/index/schema-cache route inputs and no
    untyped body casts at the route boundary; Worker and PartitionDO own the
    HTTP response adapter mapping.
  - Focus tests:
    `test/partitionRouteBoundary.test.ts`,
    `test/publicPartitionSchemaCacheRouteBoundary.test.ts`,
    `test/publicPartitionDispatchBoundary.test.ts`,
    `test/partitionFlow.test.ts`,
    `test/occ.test.ts`,
    `test/transaction.test.ts`.
- [x] R-4. Scheduler route boundaries:
  `scheduler/RouteBoundary.ts`, `scheduler/PublicRouteBoundary.ts`,
  `scheduler/InternalRouteBoundary.ts`.
  - Completed by: this R-4 checkpoint commit.
  - Goal: typed scheduler route inputs and one internal/public response
    adapter.
  - Focus tests:
    `test/schedulerRouteBoundary.test.ts`,
    `test/publicSchedulerRouteBoundary.test.ts`,
    `test/publicSchedulerDispatchBoundary.test.ts`.
- [x] R-5. Delivery and live-query route boundaries:
  `delivery/RouteBoundary.ts`, `delivery/PublicWakeRouteBoundary.ts`,
  `liveQueryDelivery/RouteBoundary.ts`, and their dispatch boundaries.
  - Completed by: this R-5 checkpoint commit.
  - Goal: typed wake/change-delivery inputs and adapter-only HTTP mapping.
  - Focus tests:
    `test/deliveryRouteBoundary.test.ts`,
    `test/publicDeliveryWakeRouteBoundary.test.ts`,
    `test/publicLiveQueryDeliveryRouteBoundary.test.ts`,
    `test/publicDeliveryWakeDispatchBoundary.test.ts`,
    `test/publicLiveQueryDeliveryDispatchBoundary.test.ts`,
    selected `test/sync.test.ts` Worker/DeliveryDO route-boundary cases.
- [x] R-6. Connection and artifact runtime route boundaries:
  `connection/RouteBoundary.ts`, `connectionDO.ts`,
  `artifactRuntime/RouteBoundary.ts`, `artifactRuntime/RuntimeRoute.ts`,
  `artifactRuntime.ts`.
  - Completed by: this R-6 checkpoint commit.
  - Goal: typed connection sync/change payloads, artifact invoke route inputs,
    and one response mapper per adapter.
  - Focus tests:
    `test/connectionRouteBoundary.test.ts`,
    `test/connectionRouteDispatchBoundary.test.ts`,
    `test/artifactRuntimeRouteBoundary.test.ts`,
    `test/artifactRuntimeRoute.test.ts`,
    `test/artifactRuntimeRequests.test.ts`,
    `test/artifactRuntime.test.ts`.

### Phase 5: Durable Object Runtime Boundaries

- [x] O-1. ConnectionDO: keep WebSocket upgrade custom, but schema-check
  message JSON and route requests with typed Effect errors.
  - Completed by: this O-1 checkpoint commit.
  - Files:
    `packages/flarex-backend/src/connectionDO.ts`,
    `packages/flarex-backend/src/connection/MessageBoundary.ts`,
    `packages/flarex-backend/src/connection/*`.
  - Focus tests:
    `test/connectionMessageBoundary.test.ts`,
    `test/connectionRouteBoundary.test.ts`,
    `test/connectionRouteDispatchBoundary.test.ts`,
    selected `test/sync.test.ts` websocket message boundary cases.
- [x] O-2. ExecutionDO: keep one `runPromise` in fetch, move session/action
  failures to tagged errors, and keep invoke response mapping at the DO edge.
  - Completed by: this O-2 checkpoint commit.
  - Files:
    `packages/flarex-backend/src/executionDO.ts`,
    `packages/flarex-backend/src/execution/*`,
    `packages/flarex-backend/src/invoke.ts`.
  - Focus tests:
    `test/executionDO.test.ts`,
    `test/executionSessionError.test.ts`,
    `test/invoke.test.ts`.
- [x] O-3. DeliveryDO and SchedulerDO: keep alarm/waitUntil bridge effects
  documented, move pending-state and remote-call failures to typed errors.
  - Completed by: this O-3 checkpoint commit.
  - Files:
    `packages/flarex-backend/src/deliveryDO.ts`,
    `packages/flarex-backend/src/schedulerDO.ts`,
    `packages/flarex-backend/src/delivery/*`,
    `packages/flarex-backend/src/scheduler/*`.
  - Focus tests:
    `test/deliveryDO.test.ts`,
    `test/schedulerRouteBoundary.test.ts`,
    `test/schedulerMaintenanceBoundary.test.ts`,
    `test/schedulerDeliveryWakeBoundary.test.ts`,
    `test/schedulerForceReconnectBoundary.test.ts`,
    selected `test/sync.test.ts` alarm continuation cases.
- [x] O-4. RegistryDO: confirm registry direct handlers no longer depend on
  request compatibility and update docs/tests if already complete.
  - Completed by: this O-4 checkpoint commit.
  - Files:
    `packages/flarex-backend/src/registryDO.ts`,
    `packages/flarex-backend/src/registry/*`.
  - Focus tests:
    `test/registryDO.test.ts`,
    `test/registryHttpApiRouteBoundary.test.ts`,
    `test/registryHttpApiHandlers.test.ts`.

### Phase 6: Storage And Persistence JSON Decoding

- [x] S-1. PartitionDO storage rows: replace untyped `JSON.parse(...) as ...`
  casts for read sets, writes, indexes, documents, placement, and schema cache
  with schema-backed Effect decoders.
  - Completed by: this S-1 checkpoint commit.
  - Files:
    `packages/flarex-backend/src/partitionDO.ts`,
    `packages/flarex-backend/src/partition/StorageRows.ts`,
    `packages/flarex-backend/src/partition/Requests.ts`,
    `packages/flarex-backend/src/types.ts`.
  - Focus tests:
    `test/partitionStorageRows.test.ts`,
    `test/partitionFlow.test.ts`,
    `test/transaction.test.ts`,
    `test/sync.test.ts`,
    `test/occ.test.ts`.
- [x] S-2. Deployment store/storage rows: schema-check execution artifact refs,
  deployment analysis, push status, and storage schema boundaries.
  - Completed by: this S-2 checkpoint commit.
  - Files:
    `packages/flarex-backend/src/deployment/Store.ts`,
    `packages/flarex-backend/src/deployment/StorageRows.ts`,
    `packages/flarex-backend/src/deployment/StorageSchema.ts`,
    `packages/flarex-backend/src/deployment/Validation.ts`.
  - Focus tests:
    `test/deploymentStorageRows.test.ts`,
    `test/deploymentStorageSchema.test.ts`,
    `test/deploymentService.test.ts`,
    `test/deploymentValidation.test.ts`.
- [x] S-3. Scheduler/connection JSON bridge helpers: convert message/body
  parsing to typed decoder functions with boundary tests.
  - Completed by: this S-3 checkpoint commit.
  - Files:
    `packages/flarex-backend/src/scheduler/DeliveryWakeBoundary.ts`,
    `packages/flarex-backend/src/connectionDO.ts`,
    `packages/flarex-backend/src/connection/Requests.ts`.
  - Focus tests:
    `test/schedulerDeliveryWakeBoundary.test.ts`,
    `test/connectionMessageBoundary.test.ts`,
    `test/connectionRouteBoundary.test.ts`,
    `test/connectionRequests.test.ts`.

### Phase 7: Executor HTTP Adapter

- [x] E-1. Split `packages/executor-http/src/index.ts` into route registration,
  request decoders, route effects, error mapping, and response helpers without
  changing public routes.
  - Completed by: this E-1 checkpoint commit.
  - Files:
    `packages/executor-http/src/index.ts`,
    `packages/executor-http/src/config.ts`,
    `packages/executor-http/src/routes.ts`,
    `packages/executor-http/src/routeEffects.ts`,
    `packages/executor-http/src/requestDecoders.ts`,
    `packages/executor-http/src/responses.ts`,
    `packages/executor-http/src/errors.ts`.
  - Focus tests: `packages/executor-http/test/http.test.ts`.
  - Gate:
    `corepack pnpm --filter @flarex/executor-http typecheck`.
- [x] E-2. Replace local parse-result body validators with reusable Effect
  decoders and tagged validation errors.
  - Completed by: this E-2 checkpoint commit.
  - Files:
    `packages/executor-http/src/requestDecoders.ts`.
  - Must preserve: all current bad request response bodies.
- [x] E-3. Move live-query delivery HTTP helper runtime bridges to one adapter
  edge and typed fetch/response errors.
  - Completed by: this E-3 checkpoint commit.
  - Files:
    `packages/executor-http/src/liveQueryDelivery.ts`.
  - Tests:
    `packages/executor-http/test/http.test.ts` backend live-query helper
    cases.
- [x] E-4. Decide whether Elysia remains as the adapter or is replaced after
  behavior is locked. Do not replace it before E-1 through E-3 are complete.
  - Completed by: this E-4 checkpoint commit.
  - Decision: keep Elysia as the `@flarex/executor-http` adapter for now; do
    not replace it until shared protocol decoders or generated route contracts
    prove the adapter is blocking the target shape.
  - Files:
    `packages/executor-http/src/routes.ts`,
    `packages/executor-http/src/routeEffects.ts`,
    `packages/executor-http/src/requestDecoders.ts`,
    `packages/executor-http/src/responses.ts`,
    `packages/executor-http/src/liveQueryDelivery.ts`.
  - Tests:
    `packages/executor-http/test/http.test.ts`.

### Phase 8: Protocol Package Cleanup

- [ ] C-1. Ensure `flarex-protocol` exports Effect decoders for every
  transport contract used by migrated backend/executor routes.
  - Files:
    `packages/flarex-protocol/src/*.ts`.
  - Gate:
    `corepack pnpm --filter flarex-protocol typecheck`.
  - [x] C-1a. Export backend live-query callback transport decoders for
    delivery fanout bodies and DeliveryDO wake bodies.
    - Completed by: `a6551ad` Export live query callback protocol decoders.
    - Files:
      `packages/flarex-protocol/src/live-query.ts`,
      `packages/flarex-protocol/test/live-query.test.ts`,
      `packages/flarex-backend/src/liveQueryDelivery.ts`,
      `packages/flarex-backend/src/delivery/WakeRequest.ts`.
    - Tests:
      `packages/flarex-protocol/test/live-query.test.ts`,
      `packages/flarex-backend/test/liveQueryDelivery.test.ts`,
      `packages/flarex-backend/test/publicLiveQueryDeliveryRouteBoundary.test.ts`,
      `packages/flarex-backend/test/deliveryRouteBoundary.test.ts`,
      `packages/flarex-backend/test/publicDeliveryWakeRouteBoundary.test.ts`.
  - [x] C-1b. Export scheduler route transport decoders for migrated
    scheduler public/internal route request bodies.
    - Completed by: `74d05a3` Export scheduler protocol decoders.
    - Files:
      `packages/flarex-protocol/src/scheduler.ts`,
      `packages/flarex-protocol/test/scheduler.test.ts`,
      `packages/flarex-backend/src/scheduler/Requests.ts`,
      `packages/flarex-protocol/src/index.ts`,
      `packages/flarex-protocol/package.json`.
    - Tests:
      `packages/flarex-protocol/test/scheduler.test.ts`,
      `packages/flarex-backend/test/schedulerRouteBoundary.test.ts`,
      `packages/flarex-backend/test/publicSchedulerRouteBoundary.test.ts`,
      `packages/flarex-backend/test/publicSchedulerDispatchBoundary.test.ts`,
      `packages/flarex-backend/test/schedulerResponses.test.ts`.
  - [x] C-1c. Export connection message, invalidation, and connection delivery
    transport decoders used by migrated ConnectionDO routes.
    - Completed by: `88dbc91` Export connection protocol decoders.
    - Files:
      `packages/flarex-protocol/src/connection.ts`,
      `packages/flarex-protocol/test/connection.test.ts`,
      `packages/flarex-backend/src/connection/MessageBoundary.ts`,
      `packages/flarex-backend/src/connection/Requests.ts`,
      `packages/flarex-protocol/src/index.ts`,
      `packages/flarex-protocol/package.json`.
    - Tests:
      `packages/flarex-protocol/test/connection.test.ts`,
      `packages/flarex-backend/test/connectionRequests.test.ts`,
      `packages/flarex-backend/test/connectionMessageBoundary.test.ts`,
      `packages/flarex-backend/test/connectionRouteBoundary.test.ts`,
      `packages/flarex-backend/test/connectionRouteDispatchBoundary.test.ts`.
  - [x] C-1d. Export remaining partition, artifact runtime, and executor HTTP
    body transport decoders or document why a contract must stay package-local.
    - Completed by: `c314a78` Export remaining protocol decoders.
    - Files:
      `packages/flarex-protocol/src/partition.ts`,
      `packages/flarex-protocol/test/partition.test.ts`,
      `packages/flarex-protocol/src/artifact-runtime.ts`,
      `packages/flarex-protocol/test/artifact-runtime.test.ts`,
      `packages/flarex-backend/src/partition/Requests.ts`,
      `packages/flarex-backend/src/artifactRuntime/Requests.ts`,
      `packages/flarex-protocol/src/index.ts`,
      `packages/flarex-protocol/package.json`,
      `roadmaps/16-package-boundaries.md`.
    - Decision:
      `@flarex/executor-http` request body decoders remain package-local for
      now because they validate adapter input ports owned by `@flarex/executor`
      and preserve route-local bad-request envelopes.
    - Tests:
      `packages/flarex-protocol/test/partition.test.ts`,
      `packages/flarex-protocol/test/artifact-runtime.test.ts`,
      `packages/flarex-backend/test/partitionRouteBoundary.test.ts`,
      `packages/flarex-backend/test/publicPartitionSchemaCacheRouteBoundary.test.ts`,
      `packages/flarex-backend/test/artifactRuntimeRequests.test.ts`,
      `packages/flarex-backend/test/artifactRuntimeRouteBoundary.test.ts`,
      `packages/flarex-backend/test/artifactRuntimeRoute.test.ts`,
      `packages/executor-http/test/http.test.ts`.
- [x] C-2. Keep throwing `parseX(...)` APIs as compatibility wrappers over
  hoisted schema decoders.
  - Completed by: this C-2 checkpoint commit.
  - Files:
    `packages/flarex-protocol/src/deployment.ts`,
    `packages/flarex-protocol/test/deployment.test.ts`,
    `effect-ts-migration-draft/your-proposal.md`,
    `roadmaps/22-effect-migration-checklist.md`,
    `roadmaps/16-package-boundaries.md`.
  - Decision:
    Deployment deep payload parsers (`parsePushSourcePackage(...)`,
    `parseDeploymentAnalysis(...)`, and
    `parseDeploymentCodegenAnalysis(...)`) remain throwing compatibility APIs,
    but now delegate to exported Effect decoders with
    `DeploymentProtocolValidationError` typed failure channels.
  - Tests:
    `packages/flarex-protocol/test/deployment.test.ts`,
    `packages/flarex-protocol/test/*.test.ts`.
- [x] C-3. Hoist all reusable Schema decoder/encoder compiler calls to module
  scope; do not compile schemas inside hot request handlers.
  - Completed by: this C-3 checkpoint commit.
  - Files:
    `packages/flarex-backend/src/invoke.ts`,
    `packages/flarex-backend/src/deployment/PublicFinishArtifactBoundary.ts`,
    `effect-ts-migration-draft/your-proposal.md`,
    `roadmaps/22-effect-migration-checklist.md`,
    `roadmaps/16-package-boundaries.md`.
  - Decision:
    Backend helpers now reuse protocol-owned Effect decoders for active
    deployment, push status, and source package payloads instead of compiling
    schemas inline inside hot helper functions. Existing backend adapter error
    channels and HTTP behavior remain unchanged.
  - Tests:
    `packages/flarex-backend/test/invoke.test.ts`,
    `packages/flarex-backend/test/publicFinishArtifactBoundary.test.ts`.

### Phase 9: Final Migration Exit

- [x] F-1. Run a repo-wide audit for remaining `readJson<...>`,
  `request.json() as`, `JSON.parse(...) as`, domain `throw new HttpError`,
  and non-adapter `Effect.runPromise(...)`.
  - Completed by: this F-1 checkpoint commit.
  - Audit commands:
    `rg -n "readJson<" packages -g "**/src/**/*.ts"`,
    `rg -n "request\.json\(\)\s+as" packages -g "**/src/**/*.ts"`,
    `rg -n "JSON\.parse\([^\n]*\)\s+as" packages -g "**/src/**/*.ts"`,
    `rg -n "throw new HttpError" packages -g "**/src/**/*.ts"`,
    `rg -n "Effect\.runPromise\(" packages -g "**/src/**/*.ts"`.
  - Result:
    no remaining `readJson<T>(...)` call sites; only the unused compatibility
    helper declaration remains in `packages/flarex-backend/src/http.ts`.
    Production source still has three `request.json() as Promise<unknown>`
    adapter JSON helpers, eight `JSON.parse(...) as` parser/storage sites,
    thirteen direct `throw new HttpError` sites plus one unused helper-local
    `HttpError` throw, and thirty-five `Effect.runPromise(...)` runtime
    bridges.
  - F-2 migration-required targets:
    `packages/flarex-backend/src/partitionDO.ts` direct domain
    `HttpError` throws, especially schema-cache validation, write table
    validation, document validation, partition-owner uniqueness, and placement
    validation;
    `packages/flarex-backend/src/http.ts` dead compatibility helpers
    `readJson<T>(...)` and `required(...)`;
    nested invoke operation promise bridges in
    `packages/flarex-backend/src/invoke.ts` around database operations and
    user-function execution.
  - F-2 deliberate-bridge candidates:
    `request.json() as Promise<unknown>` in backend, executor-http, and dev
    route-boundary JSON helpers; typed `JSON.parse(...) as unknown` storage or
    protocol bridges in protocol connection message decode, backend deployment
    storage rows, backend partition storage rows, scheduler wake failure body
    fallback, and `flarex-dev` source-map parsing; Worker/DO/executor/dev
    runtime `Effect.runPromise(...)` adapter edges.
  - Test-only and non-production noise:
    plain Vitest `Effect.runPromise(...)`, test request body inspection, and
    test `JSON.parse(...)` calls are intentionally out of F-2 production
    migration scope.
- [ ] F-2. For every remaining occurrence, either migrate it or add a short
  code comment explaining why it is a deliberate runtime bridge exception.
  - [x] F-2a. Remove unused backend compatibility helpers and convert
    PartitionDO domain `HttpError` throws to typed domain validation errors
    mapped at the route adapter edge.
    - Completed by: this F-2a checkpoint commit.
    - Files:
      `packages/flarex-backend/src/http.ts`,
      `packages/flarex-backend/src/partitionDO.ts`,
      `effect-ts-migration-draft/your-proposal.md`,
      `roadmaps/22-effect-migration-checklist.md`,
      `roadmaps/16-package-boundaries.md`.
    - Decision:
      `PartitionDomainValidationError` now owns schema-cache, document
      validation, partition-owner uniqueness, and placement validation failures
      inside PartitionDO. The route-operation adapter maps it back to the same
      HTTP status and body as before.
    - Tests:
      `packages/flarex-backend/test/transaction.test.ts`,
      `packages/flarex-backend/test/partitionRouteBoundary.test.ts`.
  - [ ] F-2b. Address nested invoke operation `Effect.runPromise(...)` bridges
    without changing user-function execution or HTTP behavior.
  - [ ] F-2c. Add short code comments for deliberate runtime bridge exceptions:
    route-boundary JSON helpers, typed storage/protocol `JSON.parse(...)`
    bridges including `flarex-dev` source maps, and Worker/DO/executor/dev
    `Effect.runPromise(...)` adapter edges.
- [ ] F-3. Run package and workspace gates:

```sh
corepack pnpm --filter flarex-protocol typecheck
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/executor-http test
corepack pnpm --filter @flarex/executor-http build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

- [ ] F-4. Run the EffectTS quality checker on the final migration diff and
  resolve all findings.
- [ ] F-5. Mark this file complete only when all earlier checkboxes are done
  or intentionally documented as out of scope.

## Next Active Checkpoint

Continue with F-2b:

Address nested invoke operation `Effect.runPromise(...)` bridges without
changing user-function execution or HTTP behavior. Then finish F-2c by adding
short code comments for deliberate runtime bridge exceptions: route-boundary
JSON helpers, typed storage/protocol `JSON.parse(...)` bridges including
`flarex-dev` source maps, and Worker/DO/executor/dev `Effect.runPromise(...)`
adapter edges.
