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

- Previous completed checkpoint: `55f0739` Plan concrete Effect migration
  checklist.
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
  - Completed by: this checkpoint; commit ID is reported in the final response
    and should be carried into this file on the next repository-changing turn.
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
- [ ] D-5. Add direct read response mapping for DeploymentDO read routes
  `GET /active` and `GET /push/:pushId`, then remove read-route dependence on
  generated web-handler request rebuilding.
  - Files:
    `packages/flarex-backend/src/deployment/InternalRouteBoundary.ts`,
    `packages/flarex-backend/src/deployment/HttpApiHandlers.ts`,
    `packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts`,
    `packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts`.
  - Must preserve: active deployment success, active not-found, push success,
    push not-found, storage failure mapping.
- [ ] D-6. Delete or demote `dispatchDeploymentApiRouteInputViaRequestCompatibility(...)`
  after all DeploymentDO API routes dispatch directly.
  - Files:
    `packages/flarex-backend/src/deployment/InternalRouteBoundary.ts`,
    `packages/flarex-backend/src/deployment/HttpApiWebHandler.ts`,
    `packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts`.
  - Must preserve: generated handler tests until direct adapter tests provide
    equal coverage.

### Phase 2: Public Deployment Push Worker Routes

- [ ] P-1. Replace public deployment start/finish/abandon body compatibility
  wrappers with typed Effect route-input objects.
  - Files:
    `packages/flarex-backend/src/deployment/PublicPushRouteBoundary.ts`,
    `packages/flarex-backend/src/deployment/PublicPushDispatchBoundary.ts`,
    `packages/flarex-backend/src/worker.ts`.
  - Focus tests:
    `test/publicDeploymentPushRouteBoundary.test.ts`,
    `test/publicDeploymentPushDispatchBoundary.test.ts`,
    `test/push.test.ts`.
- [ ] P-2. Move public deployment Worker HTTP response mapping to one adapter
  edge and stop exposing `HttpError` from public deployment dispatch logic.
  - Files:
    `packages/flarex-backend/src/worker.ts`,
    `packages/flarex-backend/src/deployment/PublicPushDispatchBoundary.ts`,
    `packages/flarex-backend/src/worker/PublicRouteDispatchError.ts`.
  - Must preserve: start pending, analyzed start, read push, finish, abandon,
    scheduler handoff, deployment id/path errors.
- [ ] P-3. Schema-check public start artifact and finish artifact service
  boundary responses through typed Effect decoders.
  - Files:
    `packages/flarex-backend/src/deployment/PublicStartArtifactBoundary.ts`,
    `packages/flarex-backend/src/deployment/PublicFinishArtifactBoundary.ts`,
    `packages/flarex-backend/src/backendAnalyzerResponse.ts`.
  - Focus tests:
    `test/publicStartArtifactBoundary.test.ts`,
    `test/publicFinishArtifactBoundary.test.ts`,
    `test/deploymentValidation.test.ts`.

### Phase 3: Worker Route Error Model

- [ ] W-1. Replace `type PublicWorkerRouteError = HttpError` with a tagged
  Worker route error union and one Worker-level response adapter.
  - Files:
    `packages/flarex-backend/src/worker.ts`,
    `packages/flarex-backend/src/worker/PublicRouteDispatchError.ts`,
    `packages/flarex-backend/src/worker/PublicRoutePathBoundary.ts`.
  - Focus tests:
    `test/publicWorkerRouteDispatchError.test.ts`,
    `test/publicWorkerRoutePathBoundary.test.ts`,
    affected public route tests.
- [ ] W-2. Convert deployment, scheduler, invoke, execution, partition,
  live-query, delivery-wake branches in `routePublicWorker(...)` to return
  typed route errors until the Worker adapter edge.
  - Files:
    `packages/flarex-backend/src/worker.ts` and the route boundary files listed
    by each branch.
  - Must preserve: route precedence and all current status/body shapes.
- [ ] W-3. Convert `project.ts` required parameter helpers from throwing
  `HttpError` to typed Effect path/precondition errors.
  - Files:
    `packages/flarex-backend/src/project.ts`,
    callers in Worker/invoke/deployment routes.

### Phase 4: Route Boundary Families

- [ ] R-1. Execution route boundaries:
  `StartRouteBoundary.ts`, `ActionRouteBoundary.ts`,
  `FinishRouteBoundary.ts`, `SyscallRouteBoundary.ts`.
  - Goal: typed route-input decoders and adapter-only `HttpError`.
  - Focus tests:
    `test/executionStartRouteBoundary.test.ts`,
    `test/executionActionRouteBoundary.test.ts`,
    `test/executionFinishRouteBoundary.test.ts`,
    `test/executionSyscallRouteBoundary.test.ts`,
    `test/executionDO.test.ts`.
- [ ] R-2. Invoke route boundary:
  `invoke/PublicInvokeRouteBoundary.ts` and `invoke.ts`.
  - Goal: typed public invoke route input, active deployment load failures as
    tagged errors, one response adapter.
  - Focus tests:
    `test/publicInvokeRouteBoundary.test.ts`,
    `test/invokeRequests.test.ts`,
    `test/invoke.test.ts`.
- [ ] R-3. Partition route boundaries:
  `partition/RouteBoundary.ts`,
  `partition/PublicSchemaCacheRouteBoundary.ts`,
  `partition/PublicDispatchBoundary.ts`.
  - Goal: typed begin/commit/read/index/schema-cache route inputs and no
    untyped body casts at the route boundary.
  - Focus tests:
    `test/partitionRouteBoundary.test.ts`,
    `test/publicPartitionSchemaCacheRouteBoundary.test.ts`,
    `test/publicPartitionDispatchBoundary.test.ts`,
    `test/partitionFlow.test.ts`,
    `test/occ.test.ts`.
- [ ] R-4. Scheduler route boundaries:
  `scheduler/RouteBoundary.ts`, `scheduler/PublicRouteBoundary.ts`,
  `scheduler/InternalRouteBoundary.ts`.
  - Goal: typed scheduler route inputs and one internal/public response
    adapter.
  - Focus tests:
    `test/schedulerRouteBoundary.test.ts`,
    `test/publicSchedulerRouteBoundary.test.ts`,
    `test/publicSchedulerDispatchBoundary.test.ts`.
- [ ] R-5. Delivery and live-query route boundaries:
  `delivery/RouteBoundary.ts`, `delivery/PublicWakeRouteBoundary.ts`,
  `liveQueryDelivery/RouteBoundary.ts`, and their dispatch boundaries.
  - Goal: typed wake/change-delivery inputs and adapter-only HTTP mapping.
  - Focus tests:
    `test/deliveryRouteBoundary.test.ts`,
    `test/publicDeliveryWakeRouteBoundary.test.ts`,
    `test/publicLiveQueryDeliveryRouteBoundary.test.ts`,
    related dispatch tests.
- [ ] R-6. Connection and artifact runtime route boundaries:
  `connection/RouteBoundary.ts`, `connectionDO.ts`,
  `artifactRuntime/RouteBoundary.ts`, `artifactRuntime/RuntimeRoute.ts`,
  `artifactRuntime.ts`.
  - Goal: typed connection sync/change payloads, artifact invoke route inputs,
    and one response mapper per adapter.
  - Focus tests:
    `test/connectionRouteBoundary.test.ts`,
    `test/connectionRouteDispatchBoundary.test.ts`,
    `test/artifactRuntimeRouteBoundary.test.ts`,
    `test/artifactRuntimeRoute.test.ts`,
    `test/artifactRuntime.test.ts`.

### Phase 5: Durable Object Runtime Boundaries

- [ ] O-1. ConnectionDO: keep WebSocket upgrade custom, but schema-check
  message JSON and route requests with typed Effect errors.
  - Files:
    `packages/flarex-backend/src/connectionDO.ts`,
    `packages/flarex-backend/src/connection/*`.
  - Focus tests:
    `test/connectionRouteBoundary.test.ts`,
    `test/connectionRouteDispatchBoundary.test.ts`.
- [ ] O-2. ExecutionDO: keep one `runPromise` in fetch, move session/action
  failures to tagged errors, and keep invoke response mapping at the DO edge.
  - Files:
    `packages/flarex-backend/src/executionDO.ts`,
    `packages/flarex-backend/src/execution/*`,
    `packages/flarex-backend/src/invoke.ts`.
  - Focus tests:
    `test/executionDO.test.ts`,
    `test/executionSessionError.test.ts`,
    `test/invoke.test.ts`.
- [ ] O-3. DeliveryDO and SchedulerDO: keep alarm/waitUntil bridge effects
  documented, move pending-state and remote-call failures to typed errors.
  - Files:
    `packages/flarex-backend/src/deliveryDO.ts`,
    `packages/flarex-backend/src/schedulerDO.ts`,
    `packages/flarex-backend/src/delivery/*`,
    `packages/flarex-backend/src/scheduler/*`.
  - Focus tests:
    `test/deliveryDO.test.ts`,
    scheduler boundary/maintenance tests.
- [ ] O-4. RegistryDO: confirm registry direct handlers no longer depend on
  request compatibility and update docs/tests if already complete.
  - Files:
    `packages/flarex-backend/src/registryDO.ts`,
    `packages/flarex-backend/src/registry/*`.
  - Focus tests:
    `test/registryDO.test.ts`,
    `test/registryHttpApiRouteBoundary.test.ts`,
    `test/registryHttpApiHandlers.test.ts`.

### Phase 6: Storage And Persistence JSON Decoding

- [ ] S-1. PartitionDO storage rows: replace untyped `JSON.parse(...) as ...`
  casts for read sets, writes, indexes, documents, placement, and schema cache
  with schema-backed Effect decoders.
  - Files:
    `packages/flarex-backend/src/partitionDO.ts`,
    `packages/flarex-backend/src/partition/Requests.ts`,
    `packages/flarex-backend/src/types.ts`.
  - Focus tests:
    `test/partitionFlow.test.ts`,
    `test/transaction.test.ts`,
    `test/sync.test.ts`,
    `test/occ.test.ts`.
- [ ] S-2. Deployment store/storage rows: schema-check execution artifact refs,
  deployment analysis, push status, and storage schema boundaries.
  - Files:
    `packages/flarex-backend/src/deployment/Store.ts`,
    `packages/flarex-backend/src/deployment/StorageSchema.ts`,
    `packages/flarex-backend/src/deployment/Validation.ts`.
  - Focus tests:
    `test/deploymentStorageSchema.test.ts`,
    `test/deploymentService.test.ts`,
    `test/deploymentValidation.test.ts`.
- [ ] S-3. Scheduler/connection JSON bridge helpers: convert message/body
  parsing to typed decoder functions with boundary tests.
  - Files:
    `packages/flarex-backend/src/scheduler/DeliveryWakeBoundary.ts`,
    `packages/flarex-backend/src/connectionDO.ts`.
  - Focus tests:
    `test/schedulerDeliveryWakeBoundary.test.ts`,
    connection tests.

### Phase 7: Executor HTTP Adapter

- [ ] E-1. Split `packages/executor-http/src/index.ts` into route registration,
  request decoders, route effects, error mapping, and response helpers without
  changing public routes.
  - Focus tests: `packages/executor-http/test/http.test.ts`.
  - Gate:
    `corepack pnpm --filter @flarex/executor-http typecheck`.
- [ ] E-2. Replace local parse-result body validators with reusable Effect
  decoders and tagged validation errors.
  - Files:
    `packages/executor-http/src/index.ts`.
  - Must preserve: all current bad request response bodies.
- [ ] E-3. Move live-query delivery HTTP helper runtime bridges to one adapter
  edge and typed fetch/response errors.
  - Files:
    `packages/executor-http/src/liveQueryDelivery.ts`.
  - Tests:
    extend `packages/executor-http/test/http.test.ts` or add focused helper
    tests.
- [ ] E-4. Decide whether Elysia remains as the adapter or is replaced after
  behavior is locked. Do not replace it before E-1 through E-3 are complete.

### Phase 8: Protocol Package Cleanup

- [ ] C-1. Ensure `flarex-protocol` exports Effect decoders for every
  transport contract used by migrated backend/executor routes.
  - Files:
    `packages/flarex-protocol/src/*.ts`.
  - Gate:
    `corepack pnpm --filter flarex-protocol typecheck`.
- [ ] C-2. Keep throwing `parseX(...)` APIs as compatibility wrappers over
  hoisted schema decoders.
  - Tests:
    `packages/flarex-protocol/test/*.test.ts`.
- [ ] C-3. Hoist all reusable Schema decoder/encoder compiler calls to module
  scope; do not compile schemas inside hot request handlers.

### Phase 9: Final Migration Exit

- [ ] F-1. Run a repo-wide audit for remaining `readJson<...>`,
  `request.json() as`, `JSON.parse(...) as`, domain `throw new HttpError`,
  and non-adapter `Effect.runPromise(...)`.
- [ ] F-2. For every remaining occurrence, either migrate it or add a short
  code comment explaining why it is a deliberate runtime bridge exception.
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

Start with D-5:

Add direct read response mapping for DeploymentDO `GET /active` and
`GET /push/:pushId`, remove read-route dependence on generated web-handler
request rebuilding, preserve all HTTP behavior, update
`effect-ts-migration-draft/your-proposal.md` and relevant roadmaps, validate,
run only the EffectTS quality checker, tick `D-5`, then commit.
