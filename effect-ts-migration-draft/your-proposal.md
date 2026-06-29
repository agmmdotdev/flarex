## Living status

Current migration state:

- Previous completed checkpoint: `de9e3ee` Type public invoke and partition dispatch failures.
- Active checkpoint: route the remaining top-level Worker pass-through fetches through typed dispatch helpers instead of leaving registry, active deployment, connection sync, and deployment scheduler forwarding as direct `fetch(...)` returns.
- Effect version: use the workspace catalog `effect@4.0.0-beta.90`. Treat "Effect v4" in this repo as the current v4 beta line until a stable v4 exists.
- Reviewer rule: Effect migration checkpoints use only `.codex/agents/effect-ts-quality-checker.toml`; do not also run the legacy TypeScript/code-quality reviewers for the same checkpoint.
- Long-running goal rule: continue in commit-sized Effect migration checkpoints, update this proposal plus the relevant roadmaps each turn, validate, run the EffectTS quality checker, apply findings, and commit before choosing the next checkpoint.
- Larger-slice alignment: avoid one-branch validation commits. Group related validation-boundary conversions into coherent batches, then return to fuller route/service Effect conversions with typed body decoders and one adapter HTTP mapping edge.

## Effect migration quality bar

The migration should now move beyond naming plain parser helpers. Naming a
throwing parser or moving `readJson(...)` into a smaller function is acceptable
only as a temporary compatibility checkpoint. New migration slices should make
the target Effect shape more true.

Required direction for the next phase:

1. Transport boundaries should expose Effect-returning decoders, for example
   `decodeDeploymentFinishPushRouteRequest(...)` returning
   `Effect.Effect<FinishPushRequest, RequestJsonError | DeploymentProtocolValidationError>`.
2. Plain `parseX(...)` functions that throw may remain for compatibility, but
   newly migrated route paths should prefer Effect decoders and keep throwing
   parsers behind compatibility wrappers.
3. HTTP body reads in migrated paths should use a typed Effect boundary instead
   of throwing `HttpError` directly from `readJson(...)`.
4. HTTP response conversion should happen at one adapter edge. Domain,
   protocol, and service code should return typed failures, not `HttpError`.
5. Protocol validation failures should be emitted at the protocol boundary and
   propagated unchanged; downstream code should not remap already-tagged
   protocol or domain errors.
6. `HttpError` remains an adapter-level compatibility type until all affected
   routes have typed Effect error mapping. Do not introduce new domain logic
   that depends on `HttpError`.
7. Effect Schema remains the source of truth for transport/API/service
   contracts. `ValidatorJson` remains the source of truth for user
   document/function validation and must not be replaced accidentally.
8. New service/domain functions should be named `Effect.fn("module.name")`
   where reusable, depend on services/layers instead of ad hoc injection, and
   keep one runtime boundary per Worker/DO/HTTP adapter.
9. Tests for newly migrated Effect boundaries should cover the typed success
   and typed failure channels directly, then separately assert the preserved
   HTTP response mapping at the adapter edge.

Next recommended checkpoint after the current Worker pass-through dispatch checkpoint:

1. Audit remaining compatibility JSON readers and choose the next coherent
   backend route/service group rather than one branch at a time.
2. Keep each public Worker or Durable Object entrypoint at one `Effect.runPromise`
   edge and one HTTP mapper.
3. Preserve the existing HTTP response body/status exactly through adapter
   mapping tests.
4. Return to true Effect route/service conversion after this compatibility
   checkpoint: typed request/body decoders, typed domain failures, and one
   adapter HTTP mapping edge.

Current Goal 161 slice:

1. Extend `PublicWorkerDispatchError` sources to cover the remaining top-level
   Worker route pass-throughs: registry deployments, active deployment reads,
   connection sync forwarding, and deployment scheduler forwarding.
2. Convert those direct `fetch(...)` returns to named `Effect.fn` helpers with
   typed `Effect.tryPromise(...)` dispatch failures.
3. Map those dispatch failures at the Worker adapter edge while preserving
   downstream response bodies/statuses, non-HTTP `500` behavior, and existing
   route matching.
4. Preserve RegistryDO, DeploymentDO, ConnectionDO, SchedulerDO, public
   scheduler control routes, invoke routes, partition routes, deployment push
   routes, executor-http, protocol schemas, and `ValidatorJson` unchanged.
5. Validate with direct dispatch-error tests, focused registry/sync/invoke
   route coverage, backend typecheck/build, broad protocol/backend gates as
   practical, and only the EffectTS quality checker reviewer.

Completed Goal 160 slice:

1. Extend `PublicWorkerDispatchError` sources to cover public invoke execution
   dispatch and public partition begin/document/index forwarding.
2. Convert public invoke execution from `Effect.promise(...)` to
   `Effect.tryPromise(...)` with a typed dispatch failure after request-body
   decoding and deployment-id resolution.
3. Convert public partition begin, document read, and index read forwarding
   from direct `partition.fetch(...)` returns to named `Effect.fn` helpers with
   typed dispatch failures.
4. Map those dispatch failures through the existing public invoke and
   partition Worker adapter edges while preserving JSON/protocol validation,
   missing-deployment `400`, partition commit/schema-cache validation,
   downstream `HttpError` status/message values, and non-HTTP `500` behavior.
5. Preserve invoke runtime semantics, artifact runtime routing, PartitionDO
   SQL/OCC behavior, partition document/index response shapes, deployment push
   routes, scheduler/live-query routes, executor-http, protocol schemas, and
   `ValidatorJson` unchanged.
6. Validate with direct dispatch-error tests, focused public invoke and
   partition route coverage, backend typecheck/build, broad protocol/backend
   gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 159 slice:

1. Extend `PublicWorkerDispatchError` sources to cover the public deployment
   push route family.
2. Convert public push status reads, source-only start analysis, analyzed
   artifact persistence, Deployment DO start/start-analyzed/finish/abandon
   forwarding, and finish artifact verification from `Effect.promise(...)` or
   direct `fetch(...)` to typed `Effect.tryPromise(...)` dispatch failures.
3. Map deployment push dispatch failures through the Worker deployment-push
   adapter edge while preserving request JSON errors, protocol validation
   errors, missing analyzer `501`, missing artifact `409`, downstream
   `HttpError` status/message values, and non-HTTP `500` behavior.
4. Preserve deployment push request decoding, analyzer response decoding,
   DeploymentDO push state behavior, generated workers, executor-http,
   scheduler/live-query routes, and `ValidatorJson` unchanged.
5. Validate with direct dispatch-error tests, focused public deployment push
   route boundary coverage, push lifecycle coverage, backend typecheck/build,
   broad protocol/backend gates as practical, and only the EffectTS quality
   checker reviewer.

Completed Goal 158 slice:

1. Extend `PublicWorkerDispatchError` sources to cover public scheduler
   forwarding routes.
2. Convert public scheduler delivery reconcile, connection reconcile,
   dead-letter delivery, cleanup connections, rerun subscriptions, and trigger
   subscriptions helpers from `Effect.promise(...)` to `Effect.tryPromise(...)`
   with typed dispatch failures.
3. Map scheduler dispatch failures through the Worker scheduler adapter edge
   while preserving downstream `HttpError` status/message values and non-HTTP
   `500` behavior.
4. Preserve scheduler request decoding, typed live-query delivery
   authorization, scheduler route validation, internal scheduler paths,
   delivery/live-query runtime behavior, generated workers, executor-http, and
   `ValidatorJson` unchanged.
5. Validate with direct dispatch-error tests, focused public scheduler route
   coverage, backend typecheck/build, broad protocol/backend gates as
   practical, and only the EffectTS quality checker reviewer.

Completed Goal 157 slice:

1. Add `PublicLiveQueryDeliveryAuthorizationError` and
   `authorizePublicLiveQueryDeliveryRequest(...)` as the Worker-owned typed
   authorization boundary for public live-query delivery control routes.
2. Move authorization for public scheduler reconcile/cleanup/rerun/trigger,
   public live-query delivery, and public DeliveryDO wake routes into the
   relevant `Effect.fn` route helpers before request-body decoding.
3. Map the typed authorization failure at each Worker adapter edge back to the
   unchanged `401 { error: "Unauthorized live query delivery request." }`
   response.
4. Preserve behavior: no-token environments stay open, valid bearer tokens pass,
   unauthorized requests still fail before malformed JSON is parsed, route
   validation failures keep their existing typed errors, and downstream
   dispatch failures keep `PublicWorkerDispatchError`.
5. Validate with direct authorization tests, focused scheduler/delivery/wake
   authorization-before-parse integration tests, backend typecheck/build, broad
   protocol/backend gates as practical, and only the EffectTS quality checker
   reviewer.

Completed Goal 156 slice:

1. Add a shared `PublicWorkerDispatchError` for public Worker routes that
   forward decoded requests to Durable Objects, live-query delivery helpers, or
   downstream JSON response parsing.
2. Convert public execution start/action, partition commit/schema-cache,
   public live-query delivery, and delivery wake route helpers to emit that
   typed dispatch failure instead of `HttpError` from `Effect.tryPromise`
   catch branches.
3. Keep each route-specific adapter mapper responsible for converting
   `PublicWorkerDispatchError` back to the existing `HttpError` response shape.
4. Preserve public behavior: downstream `HttpError` status/message values still
   pass through, non-HTTP dispatch failures still map to `500`, validation
   failures still use their route-specific typed errors, and public invoke,
   scheduler, deployment push, generated workers, executor-http, and
   `ValidatorJson` stay unchanged.
5. Validate with direct dispatch-error tests, focused public execution,
   partition, delivery, and live-query route tests, backend typecheck/build,
   broad protocol/backend gates as practical, and only the EffectTS quality
   checker reviewer.

Completed Goal 155 slice:

1. Add fieldless `MissingInvokeDeploymentError` to the public invoke route
   boundary and include it in the route error union mapped by
   `publicInvokeRouteErrorToHttpError(...)`.
2. Route Worker public invoke missing-deployment failures through that typed
   error instead of failing the route pipeline with `HttpError`.
3. Preserve public response semantics: missing top-level deployment id still
   returns `400 { error: "Missing deployment id." }`, malformed JSON and
   protocol validation still map to existing `400` responses, unknown functions
   still return `404`, and route-scoped deployment ids remain authoritative.
4. Keep `routeInvoke(...)`, artifact runtime dispatch, active deployment
   loading, invoke argument/return validation, deployment push routes,
   scheduler routes, execution routes, partition routes, executor-http routes,
   generated workers, and `ValidatorJson` unchanged.
5. Validate with focused public invoke route-boundary and Worker invoke tests,
   backend typecheck/build, broad protocol/backend gates as practical, and only
   the EffectTS quality checker reviewer.

Completed Goal 154 slice:

1. Route generated runtime worker internal request JSON reads through named
   `readInternalRequestJson(...)` and `readInvokeRequestJson(...)` helpers in
   emitted local materializer and application worker source.
2. Route generated runtime worker backend response JSON reads through a named
   `readBackendResponseJson(...)` helper in both local materializer and
   generated application worker source.
3. Preserve generated behavior: malformed internal request JSON still maps to
   the existing `400 { error }`, non-OK backend responses keep the same code and
   message precedence, and successful backend responses still return parsed
   JSON.
4. Keep Effect route decoders, backend services, deployment validation,
   generated API shape, materialized artifact public adapter mapping, and
   `ValidatorJson` unchanged.
5. Validate with focused `flarex-dev` generation/runtime materializer tests,
   package typecheck/build, backend/protocol gates as practical, and only the
   EffectTS quality checker reviewer.

Completed Goal 153 slice:

1. Add named Effect response decoders for SchedulerDO executor-maintenance responses: rerun, connection cleanup, expired connection deployment scans, dead-letter scans, pending deployment scans, plus successful delivery wake and force-reconnect JSON responses.
2. Route the remaining SchedulerDO `response.json().catch(() => null)` sites through those decoders before existing payload parsing.
3. Preserve adapter behavior: non-OK executor-maintenance responses still map to `HttpError` status `502` with the same message text, delivery wake non-OK text/body handling remains unchanged, and force-reconnect non-OK text handling remains unchanged.
4. Keep SchedulerDO route decoders, continuation storage, alarms, delivery wake orchestration, dead-letter/reconnect orchestration, and executor persistence contracts unchanged.
5. Validate with focused scheduler response tests, backend typecheck/build, backend/protocol gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 152 slice:

1. Add named Effect response decoders for live-query delivery claim, ack, and ConnectionDO fanout responses.
2. Route `DeliveryDO` claim/ack and `deliverLiveQueryChangesToConnections(...)` through those decoders before existing payload parsing.
3. Preserve adapter behavior: non-OK claim, ack, and connection responses still map to `HttpError` status `502` with the same message text that includes the downstream response status.
4. Keep claim/ack/result payload parsers, DeliveryDO retry state, fanout behavior, scheduler orchestration, and live-query persistence unchanged.
5. Validate with focused live-query delivery response tests, backend typecheck/build, backend/protocol gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 151 slice:

1. Add typed Effect response decoders for backend service-binding/internal response reads: execution artifact runtime invoke responses, analyzer service responses used by push start, and partition responses used by `SingleShardTransaction`.
2. Preserve adapter behavior: artifact runtime failures still map to `HttpError`, analyzer failures still become failed analyzed-push status payloads with diagnostics, and partition failures still map to `PartitionRequestError`.
3. Keep successful payload validation in the existing parser/domain paths; this checkpoint types the integration response boundary and does not change deployment validation, OCC, SQL, artifact materialization, or public Worker route dispatch.
4. Add direct typed success/failure tests for the new decoders and adapter-preservation tests for artifact runtime and transaction/push paths.
5. Validate with focused backend artifact runtime, transaction, and push tests, broad backend/protocol gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 150 slice:

1. Add typed Effect response decoders for `flarex-dev` HTTP backend analyzer, push, finish, local finish, execution artifact analysis, and execution artifact invoke responses.
2. Preserve public behavior: non-JSON failures still fall back to the existing status messages, backend diagnostics still travel with `ExecutionArtifactAnalysisError`, local finish transport failures still use the legacy plain `Error` message, and successful payload parsers stay unchanged.
3. Keep Effect at the integration boundary only; deployment analysis shape validation, push state parsing, analyzer diagnostics normalization, generated runtime-worker source, and backend services remain unchanged.
4. Add regression tests for non-JSON analyzer, push, finish, and artifact invoke failures, alongside existing success and structured-error coverage.
5. Validate with focused backend push/execution artifact coverage, broad `flarex-dev` gates, backend/protocol gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 149 slice:

1. Add a typed `MaterializedArtifactResponseError` and named Effect decoder for materialized execution artifact HTTP responses in `flarex-dev`.
2. Route both `LocalMiniflareMaterializedExecutionArtifact.invoke(...)` and `executeQuerySession(...)` through that decoder instead of duplicating `response.json().catch(() => null)` and ad hoc status error construction.
3. Preserve public behavior: successful responses still return parsed JSON, non-OK responses still throw `Error & { status }` with the same message precedence, and generated runtime-worker source remains unchanged.
4. Add direct typed decoder tests for successful JSON, structured error JSON, and non-JSON error responses.
5. Validate with focused runtime materializer coverage, `flarex-dev` typecheck/test/build, backend/protocol gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 148 slice:

1. Add named Effect request builders for `RegistryDO` and `DeploymentDO` generated HttpApi routes so read routes pass through unchanged and mutation routes decode/canonicalize bodies through existing typed route decoders.
2. Convert `RegistryDO.fetch()` and `DeploymentDO.fetch()` to run those builders at the Durable Object adapter edge instead of calling Promise compatibility request builders.
3. Preserve generated `HttpApi` handlers, registry/deployment service layers, storage behavior, malformed JSON mapping, protocol validation mapping, fallback health/not-found behavior, public Worker routes, executor-http routes, and `ValidatorJson` unchanged.
4. Keep Promise compatibility wrappers for existing tests/callers while routing them through the same named Effect builders.
5. Validate with focused registry/deployment HttpApi route-boundary tests, backend typecheck/build, broader protocol/backend gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 147 slice:

1. Add `effect` to `flarex-dev` and introduce package-local typed Effect decoders for local dev invoke bodies and local analyzer requests.
2. Convert the `/__flarex_dev/invoke` proxy and `createLocalAnalyzerService(...)` to run those decoders at the adapter edge instead of calling `request.json()` directly.
3. Preserve existing HTTP mapping: invalid local dev invoke and analyzer bodies still return `400 { error }`, analyzer failures still include diagnostics, and generated runtime worker source remains unchanged.
4. Add direct typed boundary tests for success, validation failures, malformed JSON, and analyzer `sourcePackage` requirements.
5. Validate with focused `flarex-dev` typecheck/tests, broad package gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 146 slice:

1. Convert `PartitionDO.fetch()` `/schema-cache`, `/commit`, `/subscriptions/register`, `/subscriptions/unregister`, and `/subscriptions/unregister-connection` branches to named `Effect.fn` helpers that use the existing typed partition route decoders directly instead of compatibility Promise readers.
2. Preserve `/commit` replay status mapping: new commits still return `201`, replayed idempotency-key commits still return `200`, and OCC conflicts still map through the fetch-level `409` adapter.
3. Preserve PartitionDO SQL schema, schema-cache persistence, begin/document/index reads, subscription state, write log/idempotency behavior, partition-owner validation, OCC validation, public Worker partition forwarding, executor-http routes, protocol schemas, and `ValidatorJson` unchanged.
4. Preserve operation failure behavior: typed body failures map through the existing `errorResponse(...)` adapter, and commit/schema/subscription operation failures still flow to the same fetch-level adapter.
5. Validate with focused partition route-boundary and transaction/sync coverage, backend typecheck/build, broad protocol gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 145 slice:

1. Convert `ExecutionDO.fetch()` `/start`, `/syscall`, and `/finish` branches to named `Effect.fn` helpers that use the existing typed execution route decoders directly instead of compatibility Promise readers.
2. Export the syscall and finish route error mappers so `ExecutionDO` uses the same `RequestJsonError` and execution protocol failure-to-HTTP conversion as the compatibility readers.
3. Preserve execution session lifecycle, transaction begin/commit behavior, syscall read/write semantics, return validation, abort behavior, public Worker execution forwarding, partition behavior, executor-http routes, protocol schemas, and `ValidatorJson` unchanged.
4. Preserve operation failure behavior: typed body failures map through the existing `invokeErrorResponse(...)` adapter, and execution operation failures still flow to the same fetch-level adapter.
5. Validate with focused execution route-boundary and execution session coverage, backend typecheck/build, broad protocol/backend gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 144 slice:

1. Convert `SchedulerDO.fetch()` delivery reconcile, connection reconcile, dead-letter deliveries, cleanup connections, and rerun subscriptions branches to named `Effect.fn` helpers that use the existing typed scheduler route decoders directly instead of compatibility Promise readers.
2. Convert the three scheduler continuation POST branches to named `Effect.fn` helpers with the same JSON response behavior, while keeping continuation storage parsing and retry/alarm behavior inside `SchedulerDO`.
3. Preserve public Worker scheduler routes, authorization ordering, scheduler route-boundary decoders, executor maintenance request/response contracts, delivery wake fanout, connection cleanup, rerun/dead-letter behavior, continuation persistence, alarm scheduling, executor-http routes, protocol schemas, and `ValidatorJson` unchanged.
4. Preserve operation failure behavior: typed body failures map to the existing `errorResponse(...)` JSON bodies, and scheduler operation failures still flow to the existing fetch-level `errorResponse(...)` adapter.
5. Validate with focused scheduler route-boundary and sync coverage, backend typecheck/build, broad protocol/backend gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 143 slice:

1. Convert `ConnectionDO.fetch()` `/invalidate` and `/deliver/live-query` branches to named `Effect.fn` helpers that use the existing typed connection route decoders directly instead of compatibility Promise readers.
2. Convert `DeliveryDO.fetch()` `/wake` and `/continue` branches to named `Effect.fn` helpers, keeping typed wake decode failures at the route adapter edge and preserving structured drain failure responses.
3. Preserve WebSocket upgrade behavior, heartbeat/force-reconnect routes, `ConnectionDO` active query state transitions, `DeliveryDO` claim/fanout/ack/drain internals, retry alarm behavior, scheduler/public Worker routes, executor-http routes, protocol schemas, and `ValidatorJson` unchanged.
4. Preserve operation failure behavior: typed body failures map to the existing `errorResponse(...)` JSON bodies, delivery drain failures still return structured `500` JSON, and other operation failures keep propagating as before.
5. Validate with focused connection/delivery route-boundary and sync coverage, backend typecheck/build, broad protocol/backend gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 142 slice:

1. Add `effect` to `@flarex/executor-http` and introduce typed adapter errors for malformed JSON, body validation failures, and executor operation failures.
2. Add shared `ExecutorHttp.routeBody`, a named `Effect.fn` that reads JSON, applies the existing endpoint parser, invokes the selected executor method, and maps executor failures to the existing status/body contract.
3. Convert all executor-http POST body handlers, including invoke/session, live-query subscription, live-query connection, and maintenance routes, to use the shared Effect adapter instead of repeated `request.json()` and executor `try/catch` blocks.
4. Preserve authorization-before-body parsing, `501` not-configured responses before body parsing, all existing parser messages, all executor error mappings, Elysia route registration, executor core behavior, Nitro inheritance, backend Worker routes, protocol schemas, and `ValidatorJson` unchanged.
5. Validate with `@flarex/executor-http` typecheck/test/build, broader workspace gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 141 slice:

1. Keep `artifactRuntime/RouteBoundary.ts` Effect-first by normalizing invoke payload validation through a typed result helper and exporting the route error mapper for runtime adapter reuse.
2. Replace the broad async `try/catch` inside `createExecutionArtifactRuntimeService(...)` with `ExecutionArtifactRuntime.routeInvoke`, a named `Effect.fn` that owns request normalization, authorization ordering, typed payload decode, header validation, source-package resolution, materializer cache lookup, and invoke dispatch.
3. Model missing source packages and runtime operations as tagged runtime errors, preserving existing JSON error bodies and status codes through one fetch adapter mapping edge.
4. Preserve runtime authorization, header mismatch behavior, source-package store mode, materializer cache/disposal behavior, public invoke routes, deployment routes, scheduler routes, execution routes, partition routes, delivery routes, protocol schemas, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused artifact runtime route-boundary/runtime tests, artifact runtime route integration coverage, backend typecheck/build, broad protocol/backend gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 140 slice:

1. Convert `partition/RouteBoundary.ts` to expose Effect-returning decoders for schema-cache, commit, subscription registration, subscription target, and connection unregister bodies.
2. Model route-body validation failures as `PartitionRouteValidationError` and keep malformed JSON as the shared `RequestJsonError`.
3. Keep throwing `parse*` and Promise `read*` compatibility functions, but route them through the typed Effect/result implementation and a single `partitionRouteErrorToHttpError(...)` adapter.
4. Convert `partition/PublicSchemaCacheRouteBoundary.ts` to expose public Effect decoders that keep the route `partitionKey` authoritative over the body.
5. Route public Worker partition `commit` and `schema-cache` forwarding through `Effect.fn` helpers with one adapter mapping edge for typed route errors and downstream `HttpError` failures.
6. Preserve PartitionDO SQL/OCC behavior, schema-cache persistence, subscription behavior, document/index reads, deployment routes, invoke routes, scheduler routes, execution routes, delivery routes, protocol schemas, executor-http routes, and `ValidatorJson` unchanged.
7. Validate with focused partition/public schema-cache route-boundary tests, partition/transaction regression coverage, backend typecheck/build, broad protocol/backend gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 139 slice:

1. Add Effect-returning internal and public execution start decoders that keep route `deploymentId` authoritative for public starts and preserve compatibility `readExecutionStartRequest(...)` readers.
2. Add Effect-returning public execution action decoders for syscall, finish, and abort, reusing the existing typed syscall/finish parsers and preserving abort's well-formed JSON forwarding behavior.
3. Route public Worker execution start and action forwarding through `Effect.fn` helpers with one adapter mapping edge for `RequestJsonError`, `ExecutionProtocolValidationError`, and downstream `HttpError` failures.
4. Preserve malformed JSON as shared `RequestJsonError`, invalid execution protocol bodies as `400`, generated ExecutionDO start/syscall/finish behavior, deployment routes, invoke routes, scheduler routes, partition routes, delivery routes, SQL schema, protocol schemas, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused execution start/action/finish/syscall route-boundary tests, execution/session regression coverage as practical, backend typecheck/build, broad protocol/backend gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 138 slice:

1. Add Effect-returning delivery wake decoders with `DeliveryWakeRouteValidationError`, preserving internal `DeliveryDO` wake body validation and compatibility `readDeliveryWakeRequest(...)`.
2. Add public wake-delivery Effect decoders that override any body deployment id with the route deployment id before forwarding to `DeliveryDO`.
3. Add Effect-returning public live-query delivery decoders with `LiveQueryDeliveryRouteValidationError`, and route Worker public delivery fanout through `Effect.fn` while preserving downstream `HttpError` fanout validation at the Worker adapter edge.
4. Add Effect-returning `ConnectionDO` invalidation and live-query delivery decoders with `ConnectionRouteValidationError`, preserving compatibility `readConnection*` readers.
5. Preserve malformed JSON as shared `RequestJsonError`, invalid delivery/wake bodies as `400`, unauthorized delivery requests before body parsing, scheduler routes, deployment routes, execution routes, partition routes, SQL schema, protocol schemas, executor-http routes, and `ValidatorJson` unchanged.
6. Validate with focused delivery/public-delivery/connection route-boundary tests, delivery/sync regression coverage as practical, backend typecheck/build, broad protocol/backend gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 137 slice:

1. Treat the deployment validation grouping from `3440a4f` as the larger-slice validation checkpoint to audit rather than splitting the remaining validation branches back into one-branch commits.
2. Verify `deployment/Validation.ts` uses `DeploymentValidationResult<A>` and `DeploymentValidationError` for the remaining domain validation branches named in the migration goal, leaving `HttpError` conversion at deployment HTTP/Worker adapter edges.
3. Verify direct deployment validation tests cover typed Effect failures for schema state/placement, function metadata shape, source position, route policy, partition policy, function kind/visibility, validator metadata, and JSON-value validation.
4. Verify representative generated start-handler tests still map typed validation failures to `400` responses through `deploymentFailureToHttpError(...)`.
5. Verify stored finish propagation keeps typed `DeploymentValidationError` from stored validation instead of wrapping it as `DeploymentSqlError`.
6. Keep route-boundary behavior, public Worker routes, scheduler routes, execution routes, partition routes, delivery routes, SQL schema, protocol schemas, executor-http routes, and `ValidatorJson` unchanged.
7. Validate with focused deployment validation/generated-handler/service gates, backend typecheck/build, broad protocol/backend gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 136 slice:

1. Add Effect-returning scheduler route decoders for delivery reconciliation, connection reconciliation, dead-letter delivery maintenance, connection cleanup, rerun subscriptions, and trigger subscriptions while keeping existing throwing parsers and `read*` Promise wrappers for compatibility.
2. Model scheduler request-shape failures as `SchedulerRouteValidationError` and keep malformed JSON as the shared `RequestJsonError`.
3. Export public scheduler Effect decoders and route all public Worker scheduler maintenance endpoints through `Effect.fn` helpers that decode, then forward the normalized body to `SchedulerDO`.
4. Preserve public response semantics: malformed JSON and invalid scheduler bodies still map to `400`, cleanup requests still resolve `projectId` from request or `FLAREX_PROJECT_ID`, and scheduler trigger remains an alias for the rerun internal path.
5. Keep deployment push routes, public invoke behavior, execution routes, partition routes, delivery routes, artifact runtime routes, deployment service/store behavior, SQL schema, protocol schemas, executor-http routes, and `ValidatorJson` unchanged.
6. Validate with focused scheduler/public scheduler route-boundary tests, Worker scheduler forwarding coverage as available, backend typecheck/build, broad protocol/backend gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 135 slice:

1. Export the public invoke route error mapper so Worker adapter code can reuse the same JSON/protocol-to-HTTP conversion as the compatibility reader.
2. Route both public invoke entrypoints (`/invoke` and `/deployments/:deploymentId/invoke`) through one `Effect.fn` helper that decodes with `decodePublicInvokeRouteRequest(...)`, resolves deployment id from route/header/body in the existing precedence order, and delegates to the existing invoke runtime.
3. Preserve public response semantics: malformed JSON and invoke protocol failures still return `400`, missing top-level deployment id still returns `400`, unknown functions still return `404`, and route-scoped deployment ids remain authoritative over body deployment ids.
4. Keep deployment push routes, execution routes, scheduler routes, partition routes, delivery routes, artifact runtime routes, deployment service/store behavior, SQL schema, protocol schemas, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused public invoke route-boundary and Worker invoke tests, backend typecheck/build, broad protocol/backend gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 134 slice:

1. Replace deployment validation helper-specific result shapes with one typed `DeploymentValidationResult<A>` helper carrying either a normalized value or a `DeploymentValidationError`.
2. Route existing throwing compatibility validators through `unwrapDeploymentValidation(...)` and Effect decoders through `deploymentValidationResultToEffect(...)` so both paths preserve one typed failure source.
3. Export typed Effect decoders for schema, function metadata, deployment analysis, and codegen analysis alongside the existing source-package, diagnostics, and start-push decoders.
4. Add direct typed decoder coverage for schema state/placement, function metadata shape, source position, route policy, partition policy, function kind/visibility, validator metadata, JSON-value validation, analysis partition validation, and codegen metadata validation.
5. Add representative generated start-handler HTTP mapping coverage and stored finish propagation coverage for grouped schema validation failures. Stored JSON rows cannot preserve JavaScript `undefined`, so the stored validator case proves the serialized validator-metadata branch while direct validation proves the JSON-value branch.
6. Keep public Worker deployment push routes, public invoke routes, `DeploymentDO` routing, generated Deployment HttpApi routing, deployment service/store behavior, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` semantics unchanged.
7. Validate with focused deployment validation, generated handler, and deployment service tests, backend typecheck/build, broad protocol/backend gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 133 slice:

1. Add a raw JSON Effect decoder for public source-only start-push bodies and keep `readPublicStartPushJson(...)` as the compatibility Promise wrapper.
2. Route public source-only start-push through an `Effect.fn` helper that reads raw JSON, preserves the analyzer-configuration `501` response before protocol parsing, parses with `parsePublicStartPushRequestEffect(...)` only when an analyzer exists, persists analyzed artifacts, and forwards to the generated DeploymentApi analyzed-start route.
3. Route public analyzed-start through an `Effect.fn` helper using `decodePublicAnalyzedStartPushRequest(...)` before forwarding to the generated DeploymentApi route.
4. Keep finish-push, abandon-push, `DeploymentDO` routing, generated Deployment HttpApi routing, deployment service/store behavior, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused public deployment route-boundary and push tests, backend typecheck/build, broad protocol/backend gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 132 slice:

1. Add a raw JSON Effect decoder for public finish-push bodies and keep `readPublicFinishPushJson(...)` as the compatibility Promise wrapper.
2. Route the public Worker finish-push path through an `Effect.fn` helper that reads raw JSON, runs the missing-artifact preflight before protocol parsing, parses with `parsePublicFinishPushRequestEffect(...)`, and forwards the normalized body to the generated DeploymentApi route.
3. Preserve public response semantics: malformed JSON returns `400`, missing artifacts return the existing `409` rejection even when the body has invalid protocol fields, and protocol validation errors still map through the Worker adapter.
4. Keep start-push, analyzed start-push, abandon-push, `DeploymentDO` routing, generated Deployment HttpApi routing, deployment service/store behavior, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused public deployment route-boundary and push tests, backend typecheck/build, broad protocol/backend gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 131 slice:

1. Route the public Worker abandon-push path through an Effect-returning helper that composes `decodePublicAbandonPushRequest(...)` and forwards the normalized body to the generated DeploymentApi route.
2. Export and reuse the public deployment route error mapper so `RequestJsonError` still becomes the existing `400` JSON-body response while `DeploymentProtocolValidationError` remains available to the Worker adapter response mapping.
3. Keep `readPublicAbandonPushRequest(...)` as a compatibility wrapper with preserved thrown behavior for existing callers and tests.
4. Keep start-push, analyzed start-push, finish-push artifact preflight behavior, `DeploymentDO` routing, generated Deployment HttpApi routing, deployment service/store behavior, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused public deployment route-boundary and push tests, backend typecheck/build, broad protocol/backend gates as practical, and only the EffectTS quality checker reviewer.

Completed Goal 130 slice:

1. Add `deployment/Validation.ts` Effect-returning decoders for analyzed start-push request normalization and start-push service input validation.
2. Switch the generated Deployment HttpApi analyzed-start handler to compose those decoders so the route path uses typed `DeploymentValidationError` instead of try/catch control flow.
3. Keep `startAnalyzedPushHandlerInputFromPayload(...)` as a compatibility wrapper with preserved thrown `DeploymentValidationError` behavior and unchanged response messages.
4. Keep source-package validation, diagnostics validation, deployment analysis/codegen validation behavior, finish/abandon routes, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation and generated handler tests, broad backend/protocol gates, and only the EffectTS quality checker reviewer.

Completed Goal 129 slice:

1. Finish the remaining `deployment/Validation.ts` domain-validation `HttpError(400)` branches by using `DeploymentValidationError` for function metadata shape, schema state, schema placement, source position, route policy, partition policy, function kind/visibility, validator metadata, JSON-value validation, and failed start-push shape failures.
2. Preserve generated start-analyzed handler mapping: newly typed validation failures still become start-route `400` responses with the same messages through `deploymentFailureToHttpError(...)`.
3. Preserve finish transaction behavior by propagating typed `DeploymentValidationError` from stored deployment validation instead of wrapping it as `DeploymentSqlError`.
4. Keep source-package validation, diagnostics validation, deployment analysis object validation, schema shape validation, function partition validation, codegen validation, abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation/start handler/service/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 128 slice:

1. Change `validateSchema(...)` so deployment schema shape guards throw `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: non-object schemas, invalid versions, non-array tables/indexes, invalid table/index entries, duplicate ids, unknown index table references, invalid names, and invalid index fields still become start-route `400` responses with the same messages through `deploymentFailureToHttpError(...)`.
3. Preserve finish transaction behavior by propagating typed `DeploymentValidationError` from stored deployment schema shape validation instead of wrapping it as `DeploymentSqlError`.
4. Keep source-package validation, diagnostics validation, failed start-input validation, deployment analysis object validation, function partition validation, codegen object validation, codegen schema-mismatch validation, codegen functions-array validation, codegen module object validation, codegen moduleName validation, codegen module functions-array validation, duplicate codegen module validation, codegen function object validation, codegen function moduleName validation, codegen function exportName validation, missing codegen function metadata validation, duplicate codegen function validation, codegen function required-args validation, codegen coverage validation, codegen function metadata-match validation, function metadata shape validation, remaining schema/detail validation, abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation/start handler/service/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 127 slice:

1. Change `validateFunctionPartitions(...)` so deployment function partition/schema semantic guards throw `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: invalid partition table references, non-partitioned target tables, create-root partition mismatches, selector mismatches, missing required partition args, and route/partition argument mismatches still become start-route `400` responses with the same messages through `deploymentFailureToHttpError(...)`.
3. Preserve finish transaction behavior by propagating typed `DeploymentValidationError` from stored deployment analysis partition validation instead of wrapping it as `DeploymentSqlError`.
4. Keep source-package validation, diagnostics validation, failed start-input validation, deployment analysis object validation, codegen object validation, codegen schema-mismatch validation, codegen functions-array validation, codegen module object validation, codegen moduleName validation, codegen module functions-array validation, duplicate codegen module validation, codegen function object validation, codegen function moduleName validation, codegen function exportName validation, missing codegen function metadata validation, duplicate codegen function validation, codegen function required-args validation, codegen coverage validation, codegen function metadata-match validation, schema, function metadata shape validation, remaining codegen detail validation, abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation/start handler/service/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 126 slice:

1. Change `validateCodegenAnalysis(...)` so the codegen function metadata-match guard throws `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: codegen functions that differ from deployment function metadata still become a start-route `400` response with the same message through `deploymentFailureToHttpError(...)`.
3. Preserve finish transaction behavior by propagating typed `DeploymentValidationError` from stored codegen function metadata-match validation instead of wrapping it as `DeploymentSqlError`.
4. Keep source-package validation, diagnostics validation, failed start-input validation, deployment analysis validation, codegen object validation, codegen schema-mismatch validation, codegen functions-array validation, codegen module object validation, codegen moduleName validation, codegen module functions-array validation, duplicate codegen module validation, codegen function object validation, codegen function moduleName validation, codegen function exportName validation, missing codegen function metadata validation, duplicate codegen function validation, codegen function required-args validation, codegen coverage validation, schema, function metadata, remaining codegen detail validation, abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation/start handler/service/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 125 slice:

1. Change `validateCodegenAnalysis(...)` so the codegen coverage guard throws `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: incomplete codegen function coverage still becomes a start-route `400` response with the same message through `deploymentFailureToHttpError(...)`.
3. Preserve finish transaction behavior by propagating typed `DeploymentValidationError` from stored codegen coverage validation instead of wrapping it as `DeploymentSqlError`.
4. Keep source-package validation, diagnostics validation, failed start-input validation, deployment analysis validation, codegen object validation, codegen schema-mismatch validation, codegen functions-array validation, codegen module object validation, codegen moduleName validation, codegen module functions-array validation, duplicate codegen module validation, codegen function object validation, codegen function moduleName validation, codegen function exportName validation, missing codegen function metadata validation, duplicate codegen function validation, codegen function required-args validation, schema, function metadata, remaining codegen detail validation, abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation/start handler/service/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 124 slice:

1. Change `validateCodegenAnalysis(...)` so the codegen function required-args guard throws `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: missing codegen function args validators still become a start-route `400` response with the same message through `deploymentFailureToHttpError(...)`.
3. Preserve finish transaction behavior by propagating typed `DeploymentValidationError` from stored codegen function required-args validation instead of wrapping it as `DeploymentSqlError`.
4. Keep source-package validation, diagnostics validation, failed start-input validation, deployment analysis validation, codegen object validation, codegen schema-mismatch validation, codegen functions-array validation, codegen module object validation, codegen moduleName validation, codegen module functions-array validation, duplicate codegen module validation, codegen function object validation, codegen function moduleName validation, codegen function exportName validation, missing codegen function metadata validation, duplicate codegen function validation, schema, function metadata, remaining codegen detail validation, abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation/start handler/service/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 123 slice:

1. Change `validateCodegenAnalysis(...)` so the duplicate codegen function metadata path guard throws `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: duplicate codegen function metadata paths still become a start-route `400` response with the same message through `deploymentFailureToHttpError(...)`.
3. Preserve finish transaction behavior by propagating typed `DeploymentValidationError` from stored duplicate-codegen-function validation instead of wrapping it as `DeploymentSqlError`.
4. Keep source-package validation, diagnostics validation, failed start-input validation, deployment analysis validation, codegen object validation, codegen schema-mismatch validation, codegen functions-array validation, codegen module object validation, codegen moduleName validation, codegen module functions-array validation, duplicate codegen module validation, codegen function object validation, codegen function moduleName validation, codegen function exportName validation, missing codegen function metadata validation, schema, function metadata, remaining codegen detail validation, abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation/start handler/service/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 122 slice:

1. Change `validateCodegenAnalysis(...)` so the missing deployment function metadata guard throws `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: codegen functions without deployment metadata still become a start-route `400` response with the same message through `deploymentFailureToHttpError(...)`.
3. Preserve finish transaction behavior by propagating typed `DeploymentValidationError` from stored codegen missing-metadata validation instead of wrapping it as `DeploymentSqlError`.
4. Keep source-package validation, diagnostics validation, failed start-input validation, deployment analysis validation, codegen object validation, codegen schema-mismatch validation, codegen functions-array validation, codegen module object validation, codegen moduleName validation, codegen module functions-array validation, duplicate codegen module validation, codegen function object validation, codegen function moduleName validation, codegen function exportName validation, schema, function metadata, remaining codegen detail validation, abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation/start handler/service/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 121 slice:

1. Change `validateCodegenAnalysis(...)` so the codegen function `exportName` guard throws `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: invalid codegen function export names still become a start-route `400` response with the same message through `deploymentFailureToHttpError(...)`.
3. Preserve finish transaction behavior by propagating typed `DeploymentValidationError` from stored codegen function-export-name validation instead of wrapping it as `DeploymentSqlError`.
4. Keep source-package validation, diagnostics validation, failed start-input validation, deployment analysis validation, codegen object validation, codegen schema-mismatch validation, codegen functions-array validation, codegen module object validation, codegen moduleName validation, codegen module functions-array validation, duplicate codegen module validation, codegen function object validation, codegen function moduleName validation, schema, function metadata, remaining codegen detail validation, abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation/start handler/service/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 120 slice:

1. Change `validateCodegenAnalysis(...)` so the codegen function `moduleName` mismatch guard throws `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: mismatched codegen function module names still become a start-route `400` response with the same message through `deploymentFailureToHttpError(...)`.
3. Preserve finish transaction behavior by propagating typed `DeploymentValidationError` from stored codegen function-module-name validation instead of wrapping it as `DeploymentSqlError`.
4. Keep source-package validation, diagnostics validation, failed start-input validation, deployment analysis validation, codegen object validation, codegen schema-mismatch validation, codegen functions-array validation, codegen module object validation, codegen moduleName validation, codegen module functions-array validation, duplicate codegen module validation, codegen function object validation, schema, function metadata, remaining codegen detail validation, abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation/start handler/service/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 119 slice:

1. Change `validateCodegenAnalysis(...)` so the codegen function object guard throws `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: non-object codegen functions still become a start-route `400` response with the same message through `deploymentFailureToHttpError(...)`.
3. Preserve finish transaction behavior by propagating the typed `DeploymentValidationError` from stored codegen function-object validation instead of wrapping it as `DeploymentSqlError`.
4. Keep source-package validation, diagnostics validation, failed start-input validation, deployment analysis validation, codegen object validation, codegen schema-mismatch validation, codegen functions-array validation, codegen module object validation, codegen moduleName validation, codegen module functions-array validation, duplicate codegen module validation, schema, function metadata, remaining codegen detail validation, abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation/start handler/service/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 118 slice:

1. Change `validateCodegenAnalysis(...)` so the duplicate codegen module guard throws `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: duplicate codegen modules still become a start-route `400` response with the same message through `deploymentFailureToHttpError(...)`.
3. Preserve finish transaction behavior by propagating the typed `DeploymentValidationError` from stored duplicate-codegen-module validation instead of wrapping it as `DeploymentSqlError`.
4. Keep source-package validation, diagnostics validation, failed start-input validation, deployment analysis validation, codegen object validation, codegen schema-mismatch validation, codegen functions-array validation, codegen module object validation, codegen moduleName validation, codegen module functions-array validation, schema, function metadata, remaining codegen detail validation, abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation/start handler/service/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 117 slice:

1. Change `validateCodegenAnalysis(...)` so the codegen module functions-array guard throws `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: non-array codegen module functions still become a start-route `400` response with the same message through `deploymentFailureToHttpError(...)`.
3. Preserve finish transaction behavior by propagating the typed `DeploymentValidationError` from stored codegen module-functions validation instead of wrapping it as `DeploymentSqlError`.
4. Keep source-package validation, diagnostics validation, failed start-input validation, deployment analysis validation, codegen object validation, codegen schema-mismatch validation, codegen functions-array validation, codegen module object validation, codegen moduleName validation, schema, function metadata, remaining codegen detail validation, abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation/start handler/service/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 116 slice:

1. Change `validateCodegenAnalysis(...)` so the codegen module `moduleName` guard throws `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: invalid codegen module names still become a start-route `400` response with the same message through `deploymentFailureToHttpError(...)`.
3. Preserve finish transaction behavior by propagating the typed `DeploymentValidationError` from stored codegen module-name validation instead of wrapping it as `DeploymentSqlError`.
4. Keep source-package validation, diagnostics validation, failed start-input validation, deployment analysis validation, codegen object validation, codegen schema-mismatch validation, codegen functions-array validation, codegen module object validation, schema, function metadata, remaining codegen detail validation, abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation/start handler/service/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 115 slice:

1. Change `validateCodegenAnalysis(...)` so the codegen module object guard throws `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: non-object codegen modules still become a start-route `400` response with the same message through `deploymentFailureToHttpError(...)`.
3. Preserve finish transaction behavior by propagating already-typed `DeploymentValidationError` from stored codegen validation instead of wrapping it as `DeploymentSqlError`.
4. Keep source-package validation, diagnostics validation, failed start-input validation, deployment analysis validation, codegen object validation, codegen schema-mismatch validation, codegen functions-array validation, schema, function metadata, remaining codegen detail validation, abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation/start handler/service/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 114 slice:

1. Change `validateCodegenAnalysis(...)` so the codegen-analysis schema-mismatch guard throws `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: mismatched codegen schema still becomes a start-route `400` response with the same message through `deploymentFailureToHttpError(...)`.
3. Keep source-package validation, diagnostics validation, failed start-input validation, deployment analysis validation, codegen object validation, codegen functions-array validation, schema, function metadata, remaining codegen detail validation, finish/abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
4. Validate with focused deployment validation/start handler/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 113 slice:

1. Change `validateCodegenAnalysis(...)` so the top-level codegen-analysis functions-array guard throws `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: non-array codegen functions still becomes a start-route `400` response with the same message through `deploymentFailureToHttpError(...)`.
3. Keep source-package validation, diagnostics validation, failed start-input validation, deployment analysis validation, codegen object validation, schema, function metadata, remaining codegen detail validation, finish/abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
4. Validate with focused deployment validation/start handler/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 112 slice:

1. Change `validateCodegenAnalysis(...)` so the top-level codegen-analysis object guard throws `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: non-object codegen analysis still becomes a start-route `400` response with the same message through `deploymentFailureToHttpError(...)`.
3. Keep source-package validation, diagnostics validation, failed start-input validation, deployment analysis validation, schema, function metadata, codegen detail validation, finish/abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
4. Validate with focused deployment validation/start handler/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 111 slice:

1. Change `validateAnalysis(...)` so the top-level deployment-analysis object guard throws `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: non-object deployment analysis still becomes a start-route `400` response with the same message through `deploymentFailureToHttpError(...)`.
3. Keep source-package validation, diagnostics validation, failed start-input validation, schema, function metadata, codegen validation, finish/abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
4. Validate with focused deployment validation/start handler/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 110 slice:

1. Change `startAnalyzedPushInput(...)` so the failed-push missing-error validation branch throws `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
2. Preserve generated start-analyzed handler mapping: missing failed-push error still becomes a start-route `400` response with the same message through `deploymentFailureToHttpError(...)`.
3. Keep source-package validation, diagnostics validation, analysis, codegen, schema, function metadata validation, finish/abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
4. Validate with focused deployment validation/start handler/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 109 slice:

1. Add an Effect-returning diagnostics validation helper that exposes `DeploymentValidationError` directly for typed success/failure channel tests.
2. Change `validateDiagnostics(...)` so diagnostics domain validation failures throw `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
3. Preserve generated start-analyzed handler mapping: invalid diagnostics still become start-route `400` responses with the same messages through `deploymentFailureToHttpError(...)`.
4. Keep source-package validation, analysis, codegen, schema, function metadata validation, finish/abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation/start handler/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 108 slice:

1. Add an Effect-returning source-package validation helper that exposes `DeploymentValidationError` directly for typed success/failure channel tests.
2. Change `validateSourcePackage(...)` so source-package domain validation failures throw `DeploymentValidationError` instead of raw `HttpError(400)` for compatibility callers.
3. Preserve generated start-analyzed handler mapping: invalid source packages still become start-route `400` responses with the same messages through `deploymentFailureToHttpError(...)`.
4. Keep diagnostics, analysis, codegen, schema, function metadata validation, finish/abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
5. Validate with focused deployment validation/start handler/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 107 slice:

1. Reuse `DeploymentValidationError` for generated Deployment HttpApi start-analyzed handler-input validation failures.
2. Change `decodeStartAnalyzedPushHandlerInput(...)` and `startAnalyzedPushHandlerInputFromPayload(...)` so protocol and deployment validation failures become `DeploymentValidationError` instead of raw `HttpError(400)`.
3. Narrow `mapDeploymentStartFailure(...)` so start validation stays typed until `deploymentFailureToHttpError(...)`.
4. Preserve start-route HTTP behavior: invalid analyzed start payloads still map to `400` with the same message, and generic storage failures still map to `500 Deployment storage error.`.
5. Keep finish/abandon/active-deployment behavior, route-boundary JSON/protocol decoders, generated Deployment HttpApi routing, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
6. Validate with focused start-analyzed handler/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 106 slice:

1. Add `DeploymentValidationError` for deployment validation failures that still need preserved HTTP 400 behavior at adapter edges.
2. Change `DeploymentPushStore.finishPush(...)` so activation validation failures from schema/function application become `DeploymentValidationError` instead of raw `HttpError(400)`.
3. Narrow `DeploymentService.finishPush(...)`, `DeploymentPushStore.finishPush(...)`, and `mapDeploymentFinishFailure(...)` so finish validation stays typed until `deploymentFailureToHttpError(...)`.
4. Preserve finish-route HTTP behavior: validation failures still map to `400` with the same message, missing pushes still map through `DeploymentPushNotFoundError`, rejected finish responses remain `FinishPushResponse` values, and generic storage failures remain `500 Deployment storage error.`.
5. Keep start/abandon/active-deployment behavior, generated Deployment HttpApi handlers, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
6. Validate with focused finish validation service/store/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 105 slice:

1. Add `DeploymentActiveDeploymentInvalidError` for active-deployment metadata corruption or missing internal metadata.
2. Change `DeploymentPushStore.getActiveDeployment(...)` so missing active push rows, missing analyzed metadata, missing execution artifact refs, and invalid stored artifact refs fail through `DeploymentActiveDeploymentInvalidError` instead of raw `HttpError(500)`.
3. Narrow `DeploymentService.getActiveDeployment(...)` and `mapDeploymentReadFailure(...)` so active-deployment metadata failures are typed until the HTTP adapter boundary.
4. Preserve HTTP read-route behavior through `deploymentFailureToHttpError(...)`: missing active deployment still returns `404 No active deployment.`, invalid active metadata still returns the existing `500` message, and storage failures still return `500 Deployment storage error.`.
5. Keep finish/start/abandon behavior, generated Deployment HttpApi handlers, public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
6. Validate with focused active-deployment service/store/HTTP-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 104 slice:

1. Keep `DeploymentService.finishPush(...)` as the owner of public missing-push preflight with `DeploymentPushNotFoundError` before artifact lookup and persistence.
2. Change `DeploymentPushStore.finishPush(...)` so a missing row during the prevalidated persistence transaction is treated as an internal storage/invariant failure (`DeploymentSqlError`) instead of `HttpError(404)`.
3. Preserve existing finish rejection responses for invalid state and missing analysis as `FinishPushResponse` values, not typed failures.
4. Preserve activation validation `HttpError(400, ...)` behavior for schema/function validation failures until a later validation-error extraction checkpoint.
5. Keep generated Deployment HttpApi handlers, public Worker finish forwarding, `DeploymentDO` routing, SQL schema, start/abandon behavior, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
6. Validate with focused deployment service/handler/push tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 103 slice:

1. Narrow `DeploymentService.abandonPush(...)` so its failure channel is `DeploymentPushNotFoundError | DeploymentPushInvalidStateError | DeploymentSqlError`, without `HttpError`.
2. Narrow `DeploymentPushStore.abandonPush(...)` so persistence reports `DeploymentSqlError` only and no longer throws `HttpError(404/409)` for abandon not-found or invalid-state business decisions.
3. Keep `DeploymentService.abandonPush(...)` as the owner of push lookup, typed not-found/invalid-state checks, controlled timestamp use, and reason defaulting/truncation before storage.
4. Keep HTTP response behavior unchanged through `deploymentFailureToHttpError(...)`, `mapDeploymentAbandonFailure(...)`, generated Deployment HttpApi handlers, public Worker abandon forwarding, and `DeploymentDO` routing.
5. Preserve SQL schema, finish/start behavior, public deployment route paths, protocol schemas, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` unchanged.
6. Validate with focused deployment service/handler/push tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 102 slice:

1. Add `decodeExecutionSyscallRouteRequest(...)` and `parseExecutionSyscallRouteRequestEffect(...)` to `execution/SyscallRouteBoundary.ts` so execution syscall body parsing exposes `Effect.Effect<ExecutionSyscallRequest, RequestJsonError | ExecutionProtocolValidationError>`.
2. Keep `readExecutionSyscallRequest(...)` as the ExecutionDO-facing compatibility wrapper that maps malformed JSON and execution protocol failures back to the existing `HttpError(400, ...)` responses.
3. Keep `parseExecutionSyscallRouteRequest(...)` as the direct throwing compatibility parser for public execution action forwarding and existing tests.
4. Preserve malformed JSON as `Request body must be JSON.` and syscall protocol validation as `Execution syscall request must be a valid get, query, insert, patch, replace, or delete operation.`.
5. Keep ExecutionDO syscall routing, public execution action forwarding, execution session state changes, start/finish routes, public invoke routes, deployment push routes, scheduler routes, partition routes, executor-http routes, and `ValidatorJson` unchanged.
6. Validate with focused execution syscall route-boundary tests, focused execution action/ExecutionDO behavior tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 101 slice:

1. Add `decodeExecutionFinishRouteRequest(...)` and `parseExecutionFinishRouteRequestEffect(...)` to `execution/FinishRouteBoundary.ts` so execution finish body parsing exposes `Effect.Effect<ExecutionFinishRequest, RequestJsonError | ExecutionProtocolValidationError>`.
2. Keep `readExecutionFinishRequest(...)` as the ExecutionDO-facing compatibility wrapper that maps malformed JSON and execution protocol failures back to the existing `HttpError(400, ...)` responses.
3. Keep `parseExecutionFinishRouteRequest(...)` as the direct throwing compatibility parser for public execution action forwarding and existing tests.
4. Preserve malformed JSON as `Request body must be JSON.` and finish protocol validation as `Execution finish request must include JSON value.`.
5. Keep ExecutionDO finish routing, public execution action forwarding, execution session state changes, syscall/start routes, public invoke routes, deployment push routes, scheduler routes, partition routes, executor-http routes, and `ValidatorJson` unchanged.
6. Validate with focused execution finish route-boundary tests, focused execution action/ExecutionDO behavior tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 100 slice:

1. Add `decodePublicInvokeRouteRequest(...)` and `parsePublicInvokeRouteRequestEffect(...)` to `invoke/PublicInvokeRouteBoundary.ts` so public invoke body parsing exposes `Effect.Effect<PublicInvokeRequestBody, RequestJsonError | InvokeProtocolValidationError>`.
2. Keep `readPublicInvokeRequest(...)` as the Worker-facing compatibility wrapper that maps malformed JSON and protocol validation failures back to the existing `HttpError(400, ...)` responses.
3. Keep `parsePublicInvokeRouteRequest(...)` as the direct throwing compatibility parser for existing callers and tests.
4. Preserve omitted `args` behavior for Worker invoke defaulting and preserve current malformed JSON/protocol validation response text.
5. Keep public `/invoke`, deployment-scoped `/invoke`, route/header defaulting, invoke dispatch, artifact runtime routing, deployment push routes, scheduler routes, partition routes, executor-http routes, and `ValidatorJson` unchanged.
6. Validate with focused public invoke route-boundary tests, focused invoke behavior tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 99 slice:

1. Add `ExecutionArtifactInvokePayloadError`, `decodeExecutionArtifactInvokePayload(...)`, and `parseExecutionArtifactInvokePayloadEffect(...)` to `artifactRuntime/RouteBoundary.ts` so artifact runtime invoke body parsing exposes `Effect.Effect<ExecutionArtifactInvokePayload, RequestJsonError | ExecutionArtifactInvokePayloadError>`.
2. Keep `readExecutionArtifactInvokePayload(...)` as the runtime-facing compatibility wrapper that maps malformed JSON and invalid payload shape back to the existing `HttpError(400, ...)` responses.
3. Keep `parseExecutionArtifactInvokePayload(...)` as the direct throwing compatibility parser for existing callers and tests.
4. Preserve malformed JSON as `Request body must be JSON.` and invalid shape as `Invalid execution artifact invoke payload.`.
5. Keep artifact runtime authorization, source-package loading, materializer cache behavior, invoke request dispatch, invoke failure status mapping, public invoke routes, deployment push routes, scheduler routes, partition routes, executor-http routes, and `ValidatorJson` unchanged.
6. Validate with focused artifact runtime route-boundary tests, focused artifact runtime behavior tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 98 slice:

1. Add `decodePublicStartPushRequest(...)` and `parsePublicStartPushRequestEffect(...)` to `deployment/PublicPushRouteBoundary.ts` so public source-only push body parsing exposes `Effect.Effect<StartPushRequest, RequestJsonError | DeploymentProtocolValidationError>`.
2. Keep `readPublicStartPushRequest(...)` as a compatibility wrapper around the full typed decoder for direct callers and future consolidation.
3. Keep `readPublicStartPushJson(...)` as the Worker-facing JSON-only compatibility wrapper, backed by `readJsonEffect(...)`, so malformed JSON still returns the shared `HttpError(400, "Request body must be JSON.")` before the no-analyzer branch.
4. Keep `parsePublicStartPushRequest(...)` as the Worker-facing post-analyzer-availability protocol parser and add `parsePublicStartPushRequestEffect(...)` for typed protocol-channel tests.
5. Preserve current public source-only ordering: malformed JSON is checked before the `FLAREX_ANALYZER` binding check, but schema-invalid source-only bodies still return the existing no-analyzer `501` when no analyzer is configured.
6. Keep public Worker route paths, Worker forwarding, analyzer request/response behavior, analyzed package persistence, `DeploymentDO` generated-handler routing, deployment push finish/analyzed-start/abandon behavior, SQL statements, response bodies, request validation messages, protocol schemas, and `ValidatorJson` unchanged.
7. Validate with focused public source-only route-boundary tests, focused public push parity tests proving no-analyzer and analyzer-configured ordering, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 97 slice:

1. Add `decodePublicFinishPushRequest(...)` and `parsePublicFinishPushRequestEffect(...)` to `deployment/PublicPushRouteBoundary.ts` so public finish-push body parsing exposes `Effect.Effect<FinishPushRequest, RequestJsonError | DeploymentProtocolValidationError>`.
2. Keep `readPublicFinishPushRequest(...)` as a compatibility wrapper around the full typed decoder for direct callers.
3. Keep `readPublicFinishPushJson(...)` as the Worker-facing JSON-only compatibility wrapper, backed by `readJsonEffect(...)`, so malformed JSON still returns the shared `HttpError(400, "Request body must be JSON.")` before artifact preflight.
4. Keep `parsePublicFinishPushRequest(...)` as the Worker-facing post-preflight protocol parser and add `parsePublicFinishPushRequestEffect(...)` for typed protocol-channel tests and future consolidation.
5. Preserve the current public finish ordering: malformed JSON is checked before `verifyStoredPushArtifact(...)`, missing artifact can still return the existing `409` before finish protocol validation, and protocol validation still maps through the existing `DeploymentProtocolValidationError` 400 envelope only after artifact preflight allows forwarding.
6. Keep public Worker route paths, Worker forwarding, `DeploymentDO` generated-handler routing, `DeploymentApiHandlers.finishPush`, `DeploymentService.finishPush`, artifact reference computation, SQL statements, response bodies, request validation messages, protocol schemas, source-only analyzer routing, analyzed-start, abandon, and `ValidatorJson` unchanged.
7. Validate with focused public finish route-boundary tests, focused public push parity tests proving artifact-preflight ordering, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 96 slice:

1. Add `decodePublicAnalyzedStartPushRequest(...)` and `parsePublicAnalyzedStartPushRequestEffect(...)` to `deployment/PublicPushRouteBoundary.ts` so public analyzed-start body parsing exposes `Effect.Effect<AnalyzedStartPushRequest, RequestJsonError | DeploymentProtocolValidationError>`.
2. Keep `readPublicAnalyzedStartPushRequest(...)` as the Worker-facing compatibility wrapper that maps malformed JSON back to the existing shared `HttpError(400, "Request body must be JSON.")`.
3. Keep `parsePublicAnalyzedStartPushRequest(...)` as a direct parser compatibility helper for tests and future route-boundary consolidation.
4. Reuse the public deployment typed decoder helpers for analyzed-start and abandon so protocol failures are emitted once as `DeploymentProtocolValidationError` and JSON failures are mapped only at the adapter edge.
5. Keep public Worker forwarding, `DeploymentDO` generated-handler routing, `DeploymentApiHandlers.startAnalyzedPush`, `DeploymentService.startAnalyzedPush`, source-only analyzer routing, finish artifact preflight ordering, SQL statements, response bodies, request validation messages, protocol schemas, and `ValidatorJson` unchanged.
6. Defer public finish-push typed decoding to a separate checkpoint because finish intentionally reads malformed JSON before artifact preflight but applies protocol validation after artifact preflight.
7. Validate with focused public analyzed-start route-boundary tests, focused public push parity tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 95 slice:

1. Add `decodePublicAbandonPushRequest(...)` and `parsePublicAbandonPushRequestEffect(...)` to `deployment/PublicPushRouteBoundary.ts` so public abandon-push body parsing exposes `Effect.Effect<AbandonPushRequest, RequestJsonError | DeploymentProtocolValidationError>`.
2. Keep `readPublicAbandonPushRequest(...)` as the Worker-facing compatibility wrapper that maps malformed JSON back to the existing shared `HttpError(400, "Request body must be JSON.")`.
3. Keep `parsePublicAbandonPushRequest(...)` as a direct parser compatibility helper for tests and future route-boundary consolidation.
4. Preserve protocol validation failures as `DeploymentProtocolValidationError` so `deploymentProtocolValidationErrorResponse(...)` keeps the existing `{ error: string }` 400 envelope.
5. Keep `DeploymentService.abandonPush(...)` as the owner of push lookup, typed not-found/invalid-state checks, controlled timestamp use, and reason defaulting/truncation.
6. Do not change Worker route paths, Worker forwarding, DeploymentDO internal routes, generated HttpApi handler behavior, SQL statements, response bodies, request validation messages, service/store orchestration, protocol schemas, or `ValidatorJson`.
7. Validate with focused public abandon route-boundary tests, focused public push parity tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 94 slice:

1. Add `decodeRegistryCreateDeploymentRouteRequest(...)` and `parseRegistryCreateDeploymentRouteRequestEffect(...)` to `registry/HttpApiRouteBoundary.ts` so registry create-deployment body parsing exposes `Effect.Effect<CreateDeploymentRequest, RequestJsonError | ProtocolValidationError>`.
2. Keep `readRegistryCreateDeploymentRouteRequest(...)` and `parseRegistryCreateDeploymentRouteRequest(...)` as compatibility wrappers for the existing async route adapter and direct parser callers.
3. Reuse the typed `RequestJsonError` to HTTP compatibility mapping introduced in the shared backend HTTP boundary.
4. Keep registry HttpApi behavior unchanged: read routes pass through unchanged, `POST /deployments` still rebuilds a canonical JSON request for the generated handler, malformed JSON keeps the shared `400`, and registry protocol failures still surface as `ProtocolValidationError`.
5. Keep `RegistryDO.fetch()`, `RegistryApiHandlers`, `RegistryService`, `RegistryStore`, deployment records, scheduler routes, execution routes, deployment push routes, executor-http routes, and `ValidatorJson` untouched.
6. Add focused route-boundary tests for typed Effect success/failure channels and preserved HTTP adapter mapping.
7. Validate with focused registry HttpApi route-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer under the updated quality bar.

Completed Goal 93 slice:

1. Add local shared helpers in `deployment/HttpApiRouteBoundary.ts` for running typed route decoders through the existing Promise adapter, composing `readJsonEffect(...)` with protocol parsers, and converting throwing protocol parsers into typed `Effect` failures.
2. Keep the exported start-analyzed, finish, and abandon typed decoder names and compatibility wrappers unchanged.
3. Keep deployment HttpApi behavior unchanged: read routes pass through unchanged, mutation routes still rebuild canonical JSON requests for the generated handler, malformed JSON keeps the shared `400`, and deployment protocol failures still surface as `DeploymentProtocolValidationError`.
4. Keep `DeploymentDO.fetch()`, `DeploymentApiHandlers`, `DeploymentService`, `DeploymentPushStore`, public Worker push routes, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` untouched.
5. Validate that focused start/finish/abandon route-boundary and handler coverage still proves typed success/failure channels and preserved HTTP adapter mapping.
6. Validate with focused deployment HttpApi route-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer under the updated quality bar.

Completed Goal 92 slice:

1. Add `decodeDeploymentAnalyzedStartPushRouteRequest(...)` and `parseDeploymentAnalyzedStartPushRouteRequestEffect(...)` to `deployment/HttpApiRouteBoundary.ts` so backend start-analyzed body parsing exposes `Effect.Effect<AnalyzedStartPushRequest, RequestJsonError | DeploymentProtocolValidationError>`.
2. Add `readDeploymentAnalyzedStartPushRouteRequest(...)` and `parseDeploymentAnalyzedStartPushRouteRequest(...)` as compatibility wrappers for the existing async route adapter and direct parser callers.
3. Reuse the typed `RequestJsonError` to HTTP compatibility mapping already used by finish/abandon.
4. Keep deployment HttpApi behavior unchanged: read routes pass through unchanged, `POST /push/start-analyzed` still rebuilds a canonical JSON request for the generated handler, malformed JSON keeps the shared `400`, and deployment protocol failures still surface as `DeploymentProtocolValidationError`.
5. Keep `DeploymentDO.fetch()`, `DeploymentApiHandlers`, `DeploymentService.startAnalyzedPush`, `DeploymentPushStore`, finish/abandon routes, public Worker push routes, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` untouched.
6. Add focused route-boundary tests for typed Effect success/failure channels and preserved HTTP adapter mapping.
7. Validate with focused deployment HttpApi route-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer under the updated quality bar.

Completed Goal 91 slice:

1. Add `decodeDeploymentAbandonPushRouteRequest(...)` and `parseDeploymentAbandonPushRouteRequestEffect(...)` to `deployment/HttpApiRouteBoundary.ts` so backend abandon-push body parsing exposes `Effect.Effect<AbandonPushRequest, RequestJsonError | DeploymentProtocolValidationError>`.
2. Keep `readDeploymentAbandonPushRouteRequest(...)` and `parseDeploymentAbandonPushRouteRequest(...)` only as compatibility wrappers for the existing async route adapter.
3. Reuse the typed `RequestJsonError` to HTTP compatibility mapping introduced for the finish route.
4. Keep deployment HttpApi behavior unchanged: read routes pass through unchanged, `POST /push/:pushId/abandon` still rebuilds a canonical JSON request for the generated handler, malformed JSON keeps the shared `400`, and deployment protocol failures still surface as `DeploymentProtocolValidationError`.
5. Keep `DeploymentDO.fetch()`, `DeploymentApiHandlers`, `DeploymentService.abandonPush`, `DeploymentPushStore`, finish/start push routes, public Worker push routes, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` untouched.
6. Add focused route-boundary tests for typed Effect success/failure channels and preserved HTTP adapter mapping.
7. Validate with focused deployment HttpApi route-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer under the updated quality bar.

Completed Goal 90 slice:

1. Add a shared backend `readJsonEffect(...)` boundary with tagged `RequestJsonError` while keeping existing `readJson(...)` behavior as a compatibility adapter.
2. Add `decodeDeploymentFinishPushRouteRequest(...)` and `parseDeploymentFinishPushRouteRequestEffect(...)` to `deployment/HttpApiRouteBoundary.ts` so backend finish-push body parsing exposes `Effect.Effect<FinishPushRequest, RequestJsonError | DeploymentProtocolValidationError>`.
3. Keep `readDeploymentFinishPushRouteRequest(...)` and `parseDeploymentFinishPushRouteRequest(...)` only as compatibility wrappers for the existing async route adapter.
4. Keep deployment HttpApi behavior unchanged: read routes pass through unchanged, `POST /push/:pushId/finish` still rebuilds a canonical JSON request for the generated handler, malformed JSON keeps the shared `400`, and deployment protocol failures still surface as `DeploymentProtocolValidationError`.
5. Keep `DeploymentDO.fetch()`, `DeploymentApiHandlers`, `DeploymentService.finishPush`, `DeploymentPushStore`, abandon/start push routes, public Worker push routes, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` untouched.
6. Add focused route-boundary tests for typed Effect success/failure channels and preserved HTTP adapter mapping.
7. Validate with focused deployment HttpApi route-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer under the updated quality bar.

Completed Goal 89 slice:

1. Add `readDeploymentAbandonPushRouteRequest(...)` and `parseDeploymentAbandonPushRouteRequest(...)` to `deployment/HttpApiRouteBoundary.ts` so backend abandon-push body parsing is testable separately from route matching.
2. Keep deployment HttpApi behavior unchanged: read routes pass through unchanged, `POST /push/:pushId/abandon` still rebuilds a canonical JSON request for the generated handler, malformed JSON keeps the shared `400`, and deployment protocol failures still surface as `DeploymentProtocolValidationError`.
3. Keep `DeploymentDO.fetch()`, `DeploymentApiHandlers`, `DeploymentService.abandonPush`, `DeploymentPushStore`, finish/start push routes, public Worker push routes, scheduler routes, execution routes, executor-http routes, and `ValidatorJson` untouched.
4. Add focused route-boundary tests for the new abandon read/parse helpers while preserving existing forwarding and fallback coverage.
5. Validate with focused deployment HttpApi route-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 88 slice:

1. Add `readRegistryCreateDeploymentRouteRequest(...)` and `parseRegistryCreateDeploymentRouteRequest(...)` to `registry/HttpApiRouteBoundary.ts` so create-deployment body parsing is testable separately from route matching.
2. Keep registry HttpApi behavior unchanged: read routes pass through unchanged, `POST /deployments` still rebuilds a canonical JSON request for the generated handler, malformed JSON keeps the shared `400`, and registry protocol failures still surface as `ProtocolValidationError`.
3. Keep `RegistryDO.fetch()`, `RegistryApiHandlers`, `RegistryService`, `RegistryStore`, deployment records, scheduler routes, execution routes, deployment push routes, executor-http routes, and `ValidatorJson` untouched.
4. Add focused route-boundary tests for the new read/parse helpers while preserving existing forwarding and fallback coverage.
5. Validate with focused registry HttpApi route-boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 87 slice:

1. Add `parsePublicExecutionActionRequest(...)` to `execution/ActionRouteBoundary.ts` so public execution action normalization is testable separately from JSON reading.
2. Keep public execution action behavior unchanged: syscall bodies use the syscall route parser, finish bodies use the finish route parser, abort forwards any well-formed JSON body, and malformed JSON still uses the shared JSON error.
3. Keep `ExecutionDO.fetch()`, `ExecutionDO.syscall(...)`, `ExecutionDO.finish(...)`, abort behavior, session lifecycle, PartitionDO, artifact runtime, executor-http, and `ValidatorJson` untouched.
4. Add focused parser tests for syscall, finish, and abort action dispatch plus existing malformed JSON coverage.
5. Validate with focused execution action boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 86 slice:

1. Add `parsePublicExecutionStartRouteRequest(...)` to `execution/StartRouteBoundary.ts` so public route deployment-id normalization is testable separately from JSON reading.
2. Keep public `POST /deployments/:deploymentId/executions/start` behavior unchanged: route deployment id overrides any body deployment id, malformed JSON uses the shared JSON error, and protocol failures still map to backend `400` errors.
3. Keep internal execution start parsing, `ExecutionDO.fetch()`, syscall/finish/abort routing, session lifecycle, PartitionDO, artifact runtime, executor-http, and `ValidatorJson` untouched.
4. Add focused tests for route deployment-id precedence through the new parser and non-object public bodies flowing through the existing protocol error boundary.
5. Validate with focused execution start boundary tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 85 slice:

1. Change `artifactRuntime/RouteBoundary.ts` to read runtime `/invoke` JSON through the shared backend `readJson` boundary instead of local `request.json().catch(() => null)`.
2. Preserve shape-invalid payload mapping as `HttpError(400, "Invalid execution artifact invoke payload.")`.
3. Intentionally align malformed JSON with other backend route boundaries as `HttpError(400, "Request body must be JSON.")`.
4. Keep runtime authorization, artifact header mismatch checks, runtime-store source-package loading, materializer cache behavior, invoke failure status preservation, Worker routing, DeliveryDO, PartitionDO, executor-http, and `ValidatorJson` untouched.
5. Update focused artifact runtime boundary/service tests for the shared malformed JSON error and validate with full protocol/backend gates plus only the EffectTS quality checker reviewer.

Completed Goal 84 slice:

1. Remove the unused `forwardLiveQuerySchedulerRequest(...)` helper from `worker.ts`.
2. Remove the last direct `readJson` import from `worker.ts`; public Worker scheduler JSON reads now live in route-boundary modules.
3. Keep all public scheduler route paths, authorization ordering, parsed-body forwarding, SchedulerDO execution, delivery fanout, continuation behavior, deployment push routes, partition routes, delivery routes, executor-http routes, and `ValidatorJson` untouched.
4. Validate with focused public scheduler route tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 83 slice:

1. Extend `deployment/PublicPushRouteBoundary.ts` with a raw finish-push JSON reader so `worker.ts` no longer owns direct `readJson` parsing for the public finish route.
2. Keep the existing public `POST /deployments/:deploymentId/push/:pushId/finish` response order: malformed JSON returns `400`, missing stored execution artifacts can still return the existing `409` before finish-push protocol validation, and valid bodies are parsed before forwarding to DeploymentDO.
3. Keep `DeploymentService.finishPush`, `DeploymentDO` HTTP behavior, artifact reference computation, active-push activation semantics, source-only push analysis, start-analyzed, abandon, scheduler routes, partition routes, delivery routes, executor-http routes, and `ValidatorJson` untouched.
4. Add focused route-boundary coverage proving the raw finish JSON read is owned by the public deployment boundary.
5. Validate with focused public deployment push boundary and push lifecycle tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 82 slice:

1. Extend the backend-only `scheduler/PublicRouteBoundary.ts` helper to read public live-query subscription trigger scheduler JSON once through the shared scheduler rerun parser.
2. Decode only `POST /scheduler/live-query-subscriptions/trigger` at the public Worker edge, then reserialize the parsed request before forwarding to SchedulerDO's existing rerun path.
3. Keep authorization before body parsing for the public scheduler route.
4. Keep SchedulerDO rerun execution, stale subscription scans, DeliveryDO wake fanout, continuation behavior, rerun route, delivery reconcile, connection reconcile, dead-letter, cleanup routes, partition routes, delivery routes, executor-http routes, and `ValidatorJson` untouched.
5. Add focused helper tests for successful decode, invalid deliveryLimit mapping, malformed JSON, and public Worker route tests proving malformed/invalid trigger JSON returns `400 { error }` before executor work while unauthorized malformed requests return `401`.
6. Validate with focused public scheduler/sync tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 81 slice:

1. Extend the backend-only `scheduler/PublicRouteBoundary.ts` helper to read public live-query subscription rerun scheduler JSON once through the shared scheduler route-boundary parser.
2. Decode only `POST /scheduler/live-query-subscriptions/rerun` at the public Worker edge, then reserialize the parsed request before forwarding to SchedulerDO.
3. Keep authorization before body parsing for the public scheduler route.
4. Keep SchedulerDO rerun execution, stale subscription scans, DeliveryDO wake fanout, continuation behavior, trigger route, delivery reconcile, connection reconcile, dead-letter, cleanup routes, partition routes, delivery routes, executor-http routes, and `ValidatorJson` untouched.
5. Add focused helper tests for successful decode, invalid deploymentId mapping, malformed JSON, and public Worker route tests proving malformed/invalid rerun JSON returns `400 { error }` before executor work while unauthorized malformed requests return `401`.
6. Validate with focused public scheduler/sync tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 80 slice:

1. Extend the backend-only `scheduler/PublicRouteBoundary.ts` helper to read public connection cleanup scheduler JSON once through the shared scheduler route-boundary parser.
2. Decode only `POST /scheduler/live-query-connections/cleanup` at the public Worker edge, including the existing `projectId` request-or-env fallback, then reserialize the parsed request before forwarding to SchedulerDO.
3. Keep authorization before body parsing for the public scheduler route.
4. Keep SchedulerDO cleanup execution, executor cleanup calls, delivery reconcile, connection reconcile, dead-letter, rerun routes, partition routes, delivery routes, executor-http routes, and `ValidatorJson` untouched.
5. Add focused helper tests for successful decode, env fallback, invalid date mapping, malformed JSON, and public Worker route tests proving malformed/invalid cleanup JSON returns `400 { error }` before executor work while unauthorized malformed requests return `401`.
6. Validate with focused public scheduler/sync tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 79 slice:

1. Extend the backend-only `scheduler/PublicRouteBoundary.ts` helper to read public dead-letter delivery scheduler JSON once through the shared scheduler route-boundary parser.
2. Decode only `POST /scheduler/live-query-deliveries/dead-letter` at the public Worker edge, then reserialize the parsed request before forwarding to SchedulerDO.
3. Keep authorization before body parsing for the public scheduler route.
4. Keep SchedulerDO dead-letter execution, reconnect fanout, executor dead-letter scans, delivery reconcile, connection reconcile, rerun, cleanup routes, partition routes, delivery routes, executor-http routes, and `ValidatorJson` untouched.
5. Add focused helper tests for successful decode, invalid date mapping, malformed JSON, and public Worker route tests proving malformed/invalid dead-letter JSON returns `400 { error }` before executor work while unauthorized malformed requests return `401`.
6. Validate with focused public scheduler/sync tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 78 slice:

1. Extend the backend-only `scheduler/PublicRouteBoundary.ts` helper to read public connection reconcile scheduler JSON once through the shared scheduler route-boundary parser.
2. Decode only `POST /scheduler/live-query-connections/reconcile` at the public Worker edge, then reserialize the parsed request before forwarding to SchedulerDO.
3. Keep authorization before body parsing for the public scheduler route.
4. Keep SchedulerDO connection cleanup reconcile execution, continuation/coalescing, executor expired-connection scans, cleanup fanout, delivery reconcile, dead-letter, rerun, cleanup routes, partition routes, delivery routes, executor-http routes, and `ValidatorJson` untouched.
5. Add focused helper tests for successful decode, invalid cursor mapping, malformed JSON, and public Worker route tests proving invalid connection reconcile JSON returns `400 { error }` before executor work while unauthorized malformed requests return `401`.
6. Validate with focused public scheduler/sync tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 77 slice:

1. Add a backend-only `scheduler/PublicRouteBoundary.ts` helper that reads public delivery reconcile scheduler JSON once through the shared scheduler route-boundary parser.
2. Decode only `POST /scheduler/live-query-deliveries/reconcile` at the public Worker edge, then reserialize the parsed request before forwarding to SchedulerDO.
3. Keep authorization before body parsing for the public scheduler route.
4. Keep SchedulerDO delivery reconcile execution, continuation/coalescing, DeliveryDO wake fanout, executor pending-deployment scans, connection cleanup, dead-letter, rerun, cleanup routes, partition routes, delivery routes, executor-http routes, and `ValidatorJson` untouched.
5. Add focused helper tests for successful decode, invalid cursor mapping, malformed JSON, and public Worker route tests proving malformed/invalid delivery reconcile JSON returns `400 { error }` before executor work while unauthorized malformed requests return `401`.
6. Validate with focused public scheduler/sync tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 76 slice:

1. Add a backend-only `partition/PublicSchemaCacheRouteBoundary.ts` helper that reads public `PUT /schema-cache` JSON once through the shared `readJson` boundary.
2. Decode only the public transport envelope as a JSON object, append the route `partitionKey`, and keep the route partition key authoritative over any body field.
3. Reuse the existing partition schema-cache parser for object-envelope validation before forwarding to `PartitionDO`.
4. Keep schema semantic validation, table/index persistence, schema-version metadata writes, transaction ownership, commit/OCC behavior, subscription routes, document/index reads, scheduler routes, delivery routes, executor-http routes, and `ValidatorJson` untouched.
5. Add focused helper tests for successful wrap, route partition-key precedence, invalid envelope mapping, malformed JSON handling, and public Worker route tests proving malformed/non-object schema-cache JSON returns `400 { error }` before forwarding.
6. Validate with focused schema-cache boundary/transaction tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 75 slice:

1. Add a backend-only `delivery/PublicWakeRouteBoundary.ts` helper that reads public `wake-delivery` JSON once through the shared `readJson` boundary.
2. Decode the public wake envelope by appending the route `deploymentId`, keeping the route deployment id authoritative over any body field, and reusing the existing `DeliveryDO` wake parser.
3. Use the decoded wake request in `routeWakeDelivery(...)` before forwarding to `DeliveryDO`.
4. Keep authorization order, `DeliveryDO` wake/drain behavior, claim/fanout/ack semantics, scheduler routes, live-query delivery fanout, partition routes, executor-http routes, and `ValidatorJson` untouched.
5. Add focused helper tests for valid decode, invalid optional wake fields, malformed JSON, route deployment-id precedence, and public Worker route tests proving malformed/invalid wake JSON returns `400 { error }` before forwarding.
6. Validate with focused wake boundary/sync tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 74 slice:

1. Add a backend-only `liveQueryDelivery/RouteBoundary.ts` helper that reads public live-query delivery JSON once through the shared `readJson` boundary.
2. Decode the existing public delivery envelope through `liveQueryDeliveryChangesFromBody(...)` and map parser errors to JSON `400 { error }` responses.
3. Use the decoded deliveries in `routeLiveQueryDelivery(...)` before calling `deliverLiveQueryChangesToConnections(...)`.
4. Keep authorization order, deployment target validation, connection fanout, `ConnectionDO` delivery routing, skip accounting, `DeliveryDO` wake/drain behavior, scheduler routes, partition routes, executor-http routes, and `ValidatorJson` untouched.
5. Add focused helper tests for valid updated/failed deliveries, invalid envelopes, malformed JSON, and public Worker route tests proving malformed/invalid delivery JSON returns `400 { error }` before fanout.
6. Validate with focused delivery boundary/sync tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 73 slice:

1. Extend the backend-only `partition/RouteBoundary.ts` helper to read `POST /commit` JSON once through the shared `readJson` boundary.
2. Decode only the commit request transport envelope: required integer `beginTs`, optional integer `schemaVersion`, optional string `source`, optional string `idempotencyKey`, optional object `readSet` with document/table/index read arrays, and required `writes` array with integer `tableId`, optional non-empty `id`, and JSON `value`.
3. Use the same commit boundary in the public Worker partition commit forwarding route so public and Durable Object edges share one parser.
4. Keep idempotency lookup, schema-version mismatch behavior, generated IDs for missing write IDs, write validation, table/placement/schema checks, transaction ownership, OCC conflict detection, write-log persistence, invalidation notification, document/index reads, schema-cache, subscription routes, and `ValidatorJson` untouched.
5. Add focused boundary tests for successful commit decode, invalid read-set mapping, invalid write mapping, invalid JSON value mapping, malformed JSON handling, and direct route tests proving malformed/invalid commit JSON returns `400 { error }` before commit execution.
6. Validate with focused partition boundary/transaction tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 72 slice:

1. Extend the backend-only `partition/RouteBoundary.ts` helper to read `POST /subscriptions/register`, `POST /subscriptions/unregister`, and `POST /subscriptions/unregister-connection` JSON once through the shared `readJson` boundary.
2. Move only the subscription request-envelope parsers into that helper: registration requires non-empty `connectionName`, integer `queryId`, and object `readSet`; unregister requires non-empty `connectionName` and integer `queryId`; unregister-connection requires non-empty `connectionName`.
3. Preserve existing validation messages for `connectionName`, `queryId`, `readSet`, and malformed JSON.
4. Use the decoded subscription requests in `PartitionDO.fetch()` while keeping SQL insert/delete ownership, invalidation scanning, commit/OCC behavior, schema-cache, document/index reads, ConnectionDO callers, public Worker forwarding, and `ValidatorJson` untouched.
5. Add focused boundary tests for successful registration, target unregister, connection unregister, invalid field mapping, malformed JSON handling, and direct PartitionDO route tests proving malformed/invalid subscription JSON returns `400 { error }`.
6. Validate with focused partition boundary/transaction tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 71 slice:

1. Add a backend-only `partition/RouteBoundary.ts` helper that reads `PUT /schema-cache` JSON once through the shared `readJson` boundary.
2. Decode only the schema-cache transport envelope as a JSON object, preserving both current wrapped `{ partitionKey, schema }` bodies and legacy flat `{ partitionKey, version, tables, indexes }` bodies for `PartitionDO.putSchemaCache(...)`.
3. Keep schema semantic validation, partition-key validation, table/index persistence, schema-version metadata writes, transaction ownership, commit/OCC behavior, subscription routes, document/index reads, public Worker forwarding, and `ValidatorJson` untouched.
4. Use the decoded schema-cache request in `PartitionDO.fetch()` so malformed JSON and non-object envelopes are stopped before schema-cache validation and storage work.
5. Add focused boundary tests for wrapped body decode, legacy flat body compatibility, invalid envelope mapping, malformed JSON handling, and a direct PartitionDO route test proving malformed schema-cache JSON returns `400 { error }`.
6. Validate with focused partition boundary/transaction tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 70 slice:

1. Extend the backend-only `scheduler/RouteBoundary.ts` helper to read `POST /cleanup/live-query-connections` JSON once through the shared `readJson` boundary.
2. Move only the live-query connection cleanup request-envelope parser into that helper: required non-empty `deploymentId`, `projectId` from request or configured environment fallback, optional ISO `expiredAt`, and ignored extra fields.
3. Preserve the current `projectId` compatibility behavior: explicit non-empty request value wins, invalid explicit value returns `400`, missing value uses `FLAREX_PROJECT_ID`, and missing both returns the existing JSON `400`.
4. Use the decoded cleanup request in `SchedulerDO.cleanupLiveQueryConnections(...)` so the route boundary is separated from executor cleanup calls and response validation.
5. Keep SchedulerDO delivery reconcile, connection cleanup reconcile, rerun, dead-letter, continuation routes, DeliveryDO, ConnectionDO, PartitionDO, executor-http, and `ValidatorJson` untouched.
6. Add focused boundary tests for successful decode, env fallback, invalid field mapping, missing project id mapping, malformed JSON handling, and route-level sync tests proving malformed/invalid cleanup JSON returns `400 { error }` without touching the executor.
7. Validate with focused scheduler boundary/sync tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 69 slice:

1. Extend the backend-only `scheduler/RouteBoundary.ts` helper to read `POST /dead-letter/live-query-deliveries` JSON once through the shared `readJson` boundary.
2. Move only the live-query delivery dead-letter request-envelope parser into that helper: optional non-empty `deploymentId`, optional ISO `olderThan`, optional positive integer `stuckAfterMs` only when `olderThan` is absent, optional positive integer `minAttempts`, `limit`, and `maxBatches`, optional passthrough `cursor`, optional non-empty `reason`, optional ISO `deadLetteredAt`, and ignored extra fields.
3. Preserve existing default and precedence behavior for `olderThan`, `stuckAfterMs`, `minAttempts`, `limit`, `reason`, `deadLetteredAt`, and `maxBatches`.
4. Use the decoded dead-letter request in `SchedulerDO.deadLetterLiveQueryDeliveries(...)` so the route boundary is separated from executor dead-letter scans, force-reconnect fanout, pagination, and result aggregation.
5. Keep SchedulerDO delivery reconcile, connection cleanup reconcile, rerun, cleanup, continuation routes, DeliveryDO, ConnectionDO, PartitionDO, executor-http, and `ValidatorJson` untouched.
6. Add focused boundary tests for successful decode, ignored extra fields/defaults, invalid field mapping, malformed JSON handling, and a route-level sync test proving malformed dead-letter JSON returns `400 { error }` without touching the executor.
7. Validate with focused scheduler boundary/sync tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 68 slice:

1. Extend the backend-only `scheduler/RouteBoundary.ts` helper to read `POST /rerun/live-query-subscriptions` JSON once through the shared `readJson` boundary.
2. Move only the live-query subscription rerun request-envelope parser into that helper: required non-empty `deploymentId`, optional non-empty `projectId`, optional positive integer `limit`, `deliveryLimit`, and `maxBatches`, and ignored extra fields.
3. Use the decoded rerun request in `SchedulerDO.rerunLiveQuerySubscriptions(...)` so the route boundary is separated from pending rerun construction, in-flight coalescing, executor rerun calls, delivery wake fanout, retry scheduling, and persistence.
4. Keep SchedulerDO delivery reconcile, connection cleanup reconcile, dead-letter, cleanup, continuation routes, DeliveryDO, ConnectionDO, PartitionDO, executor-http, and `ValidatorJson` untouched.
5. Add focused boundary tests for successful decode, ignored extra fields, invalid field mapping, malformed JSON handling, and a route-level sync test proving malformed rerun JSON returns `400 { error }` without touching the executor.
6. Validate with focused scheduler boundary/sync tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 67 slice:

1. Extend the backend-only `scheduler/RouteBoundary.ts` helper to read `POST /reconcile/live-query-connections` JSON once through the shared `readJson` boundary.
2. Move only the live-query connection cleanup reconcile request-envelope parser into that helper: optional ISO `expiredAt`, optional positive integer `limit`, optional cursor with ISO `oldestExpiredAt` and non-empty `deploymentId`, and ignored extra fields.
3. Use the decoded connection cleanup reconcile request in `SchedulerDO.reconcileLiveQueryConnections(...)` so the route boundary is separated from durable continuation, fresh-request coalescing, retry scheduling, and persistence.
4. Keep SchedulerDO delivery reconcile, dead-letter, cleanup, rerun routes, DeliveryDO, ConnectionDO, PartitionDO, executor-http, and `ValidatorJson` untouched.
5. Add focused boundary tests for successful decode, ignored extra fields, invalid cursor mapping, malformed JSON handling, and a route-level sync test proving malformed connection cleanup reconcile JSON returns `400 { error }` without touching the executor.
6. Validate with focused scheduler boundary/sync tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 66 slice:

1. Add a backend-only `scheduler/RouteBoundary.ts` helper that reads `POST /reconcile/live-query-deliveries` JSON once through the shared `readJson` boundary.
2. Move only the live-query delivery reconcile request-envelope parser into that helper: optional positive integer `limit`, `deliveryLimit`, `maxBatches`, optional cursor with ISO `oldestCreatedAt` and non-empty `deploymentId`, and ignored extra fields.
3. Use the decoded delivery reconcile request in `SchedulerDO.reconcileLiveQueryDeliveries(...)` so the route boundary is separated from durable continuation, keyed coalescing, wake fanout, retry scheduling, and persistence.
4. Keep SchedulerDO connection cleanup, rerun, dead-letter, cleanup routes, DeliveryDO, ConnectionDO, PartitionDO, executor-http, and `ValidatorJson` untouched.
5. Add focused boundary tests for successful decode, ignored extra fields, invalid cursor mapping, malformed JSON handling, and a route-level sync test proving malformed delivery reconcile JSON returns `400 { error }` without touching the executor.
6. Validate with focused scheduler boundary/sync tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 65 slice:

1. Add a backend-only `artifactRuntime/RouteBoundary.ts` helper that reads runtime `/invoke` JSON once and parses the existing `ExecutionArtifactInvokePayload` shape.
2. Preserve current compatibility: malformed JSON and shape-invalid payloads both map to `HttpError(400, "Invalid execution artifact invoke payload.")`.
3. Use the decoded payload in `createExecutionArtifactRuntimeService(...)` before artifact header validation, source-package resolution, materializer cache lookup, or artifact invocation.
4. Keep authorization, artifact header mismatch checks, runtime-store source-package loading, materializer cache behavior, invoke failure status preservation, Worker routing, DeliveryDO, PartitionDO, executor-http, and `ValidatorJson` untouched.
5. Add focused boundary tests for successful decode, invalid payload mapping, malformed JSON handling, and a runtime-service test proving malformed and invalid invoke payloads return the existing JSON 400 envelope without running the materializer.
6. Validate with focused artifact runtime tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 64 slice:

1. Add a backend-only `delivery/RouteBoundary.ts` helper that reads `/wake` JSON once through the shared `readJson` boundary.
2. Decode the current wake envelope as an object with required string `deploymentId` and optional positive integer `limit`, `maxBatches`, and `leaseDurationMs`.
3. Preserve wake compatibility by ignoring extra fields and leaving delivery defaults, claim-owner creation, continuation persistence, claim/fanout/ack behavior, and failure summaries inside `DeliveryDO`.
4. Scope `errorResponse(...)` handling to wake body decoding so malformed JSON and invalid envelopes return JSON 400s without normalizing delivery drain failures.
5. Keep SchedulerDO, Worker public wake forwarding, ConnectionDO, PartitionDO, executor-http, execution sessions, and `ValidatorJson` untouched.
6. Add focused boundary tests for successful wake decode, ignored extra fields, invalid field mapping, malformed JSON handling, and route-level sync tests proving malformed and invalid wake JSON return `400 { error }`.
7. Validate with focused delivery boundary/sync tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 63 slice:

1. Extend the backend-only `connection/RouteBoundary.ts` helper to read `/invalidate` JSON once through the shared `readJson` boundary.
2. Decode the current invalidation envelope as an object with integer `queryId`, preserving compatibility with ignored extra fields such as `invalidatedTs`.
3. Use the decoded `QueryId` in `ConnectionDO.invalidate(...)` so body parsing is separated from rerun orchestration and WebSocket transition emission.
4. Scope `errorResponse(...)` handling to invalidation body decoding so malformed JSON and invalid envelopes return JSON 400s without normalizing rerun, registration, or WebSocket send failures.
5. Keep live-query delivery, WebSocket setup, heartbeat, force-reconnect, DeliveryDO, PartitionDO, executor-http, execution sessions, and `ValidatorJson` untouched.
6. Add focused boundary tests for successful invalidation decode, ignored extra fields, invalid envelope mapping, malformed JSON handling, and route-level sync tests proving malformed and invalid invalidation JSON return `400 { error }`.
7. Validate with focused connection boundary/sync tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 62 slice:

1. Add a backend-only `connection/RouteBoundary.ts` helper that reads `/deliver/live-query` JSON once through the shared `readJson` boundary.
2. Decode the delivery envelope through the existing `liveQueryDeliveryChangesFromBody(...)` parser and map invalid delivery bodies to `HttpError(400, ...)`.
3. Use the decoded `LiveQueryDeliveryChange[]` in `ConnectionDO.deliverLiveQueryChanges(...)` so that route parsing is separated from socket fanout and skip accounting.
4. Scope `errorResponse(...)` handling to the live-query delivery route so malformed JSON and invalid delivery envelopes return JSON 400s without changing `/invalidate`, WebSocket setup, heartbeat, or force-reconnect behavior.
5. Keep `DeliveryDO`, Worker public routes, PartitionDO, executor-http, execution sessions, and `ValidatorJson` untouched.
6. Add focused boundary tests for successful decode, invalid envelope mapping, malformed JSON handling, and route-level sync tests proving malformed and invalid delivery JSON return `400 { error }`.
7. Validate with focused connection boundary/sync tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 61 slice:

1. Add a backend-only public execution action route-boundary helper that reads JSON once for `syscall`, `finish`, and `abort` forwarding.
2. Decode public `syscall` bodies through the existing `parseExecutionSyscallRouteRequest` adapter before forwarding to `ExecutionDO`.
3. Decode public `finish` bodies through the existing `parseExecutionFinishRouteRequest` adapter before forwarding to `ExecutionDO`.
4. Preserve the Goal 60 abort decision: malformed abort JSON still returns `400 { error: "Request body must be JSON." }`, while any well-formed JSON, including generated `{}`, is forwarded to the bodyless `ExecutionDO` abort action.
5. Keep `ExecutionDO.fetch()`, `ExecutionDO.syscall(...)`, `ExecutionDO.finish(...)`, abort behavior, PartitionDO, artifact runtime, executor-http, and `ValidatorJson` untouched.
6. Add focused helper tests proving public syscall/finish decode and protocol-error mapping, abort well-formed JSON forwarding, and malformed JSON handling.
7. Validate with focused action boundary/session tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 60 slice:

1. Audit execution abort callers and confirm generated Cloudflare execution code sends `{}` to `POST /deployments/:deploymentId/executions/:sessionId/abort`.
2. Do not add an Effect protocol parser for `ExecutionDO` abort in this slice: the Durable Object action has no domain body, and adding a schema would create a contract for data that is intentionally ignored.
3. Preserve the current public Worker forwarding behavior: malformed abort JSON returns `400 { error: "Request body must be JSON." }`, while any well-formed JSON, including the generated `{}` envelope, reaches `ExecutionDO`.
4. Preserve `ExecutionDO` abort behavior: clear the active session, return `{ aborted: true }`, and do not commit staged transaction writes.
5. Keep Worker route matching, start, syscall, finish, PartitionDO, artifact runtime, executor-http, and `ValidatorJson` untouched.
6. Add focused route tests proving abort clears active sessions without committing staged writes, post-abort syscalls fail as no-session, generated `{}` and extra well-formed JSON both reach the bodyless action, and malformed public abort JSON is rejected before Durable Object dispatch.
7. Validate with focused execution session tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 59 slice:

1. Add a backend-only execution finish route-boundary helper that reads JSON once, decodes through `parseExecutionFinishRequest`, maps `ExecutionProtocolValidationError` to `HttpError(400, ...)`, and adapts protocol `Json` to the backend mutable `Json` type.
2. Use the finish helper in `ExecutionDO.fetch()` for internal `POST /finish`, leaving `ExecutionDO.finish(...)` return validation, query read-set response, mutation commit, and `finally` session cleanup unchanged.
3. Preserve malformed public JSON behavior through the public Worker forwarding boundary: `400 { error: "Request body must be JSON." }`.
4. Preserve valid unknown-session behavior: schema-valid finish bodies still reach `ExecutionDO.finish(...)` and return `409 { error: "Execution session has not started." }`.
5. Preserve return-validation failure behavior and session cleanup after failed finish attempts.
6. Do not touch Worker route matching, execution start, syscall, abort, PartitionDO, artifact runtime, executor-http, or `ValidatorJson` in this slice.
7. Add focused helper and route tests proving successful decode/adaptation, protocol-invalid body mapping, malformed JSON mapping, invalid finish decode before session dispatch, valid unknown-session behavior, return-validation behavior, and cleanup after failed finish.
8. Validate with focused finish boundary/session tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 58 slice:

1. Add `ExecutionFinishRequest`, `ExecutionFinishRequestSchema`, and `parseExecutionFinishRequest` to `flarex-protocol/execution`.
2. Model the current execution finish body as an object with required JSON `value`.
3. Reuse the shared strict `JsonValue` contract so finish return values reject non-finite numbers, functions, non-plain objects, and symbol-keyed records.
4. Keep Worker routing, `ExecutionDO.fetch()`, `ExecutionDO.finish(...)`, start, syscall, abort, PartitionDO, artifact runtime, executor-http, and `ValidatorJson` untouched.
5. Add focused protocol tests for object, array, primitive, and null return values plus invalid non-object bodies, missing `value`, and invalid JSON values.
6. Validate with focused execution protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 57 slice:

1. Add a backend-only execution syscall route-boundary helper that reads JSON once, decodes through `parseExecutionSyscallRequest`, maps `ExecutionProtocolValidationError` to `HttpError(400, ...)`, and adapts protocol `Json` to the backend mutable `Json` type.
2. Share the execution boundary JSON adapter with the existing execution start route-boundary helper.
3. Use the syscall helper in `ExecutionDO.fetch()` for internal `POST /syscall`, leaving `ExecutionDO.syscall(...)` session and transaction behavior unchanged.
4. Preserve malformed public JSON behavior through the public Worker forwarding boundary: `400 { error: "Request body must be JSON." }`.
5. Preserve valid unknown-session behavior: schema-valid syscall bodies still reach `ExecutionDO.syscall(...)` and return `409 { error: "Execution session has not started." }`.
6. Do not touch Worker route matching, execution start, finish, abort, PartitionDO, artifact runtime, executor-http, or `ValidatorJson` in this slice.
7. Add focused helper and route tests proving successful decode/adaptation, protocol-invalid body mapping, malformed JSON mapping, invalid syscall decode before session dispatch, and valid unknown-session behavior.
8. Validate with focused syscall boundary/session tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 56 slice:

1. Add `ExecutionIndexRangeExpression`, `ExecutionSyscallRequest`, `ExecutionIndexRangeExpressionSchema`, `ExecutionSyscallRequestSchema`, and `parseExecutionSyscallRequest` to `flarex-protocol/execution`.
2. Cover the current `ExecutionDO.syscall` operation shapes: `get`, `query`, `insert`, `patch`, `replace`, and `delete`.
3. Reuse the shared strict `JsonValue` contract for syscall JSON values and query range expression values.
4. Keep `patch.value` constrained to JSON records, matching the current partial-update runtime expectation.
5. Keep Worker routing, `ExecutionDO.fetch()`, `ExecutionDO.syscall`, finish/abort, `StartRouteBoundary`, PartitionDO, artifact runtime, executor-http, and `ValidatorJson` untouched.
6. Add focused protocol tests for every valid syscall operation and invalid non-object bodies, unknown operations, missing required fields, invalid query order, invalid JSON values, and non-record patch values.
7. Validate with focused execution protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 55 slice:

1. Add a backend-only execution start route-boundary helper that reads JSON once, decodes through `parseExecutionStartRequest`, maps `ExecutionProtocolValidationError` to `HttpError(400, ...)`, and adapts protocol `Json` to the backend mutable `Json` type.
2. Use that helper in the public Worker `POST /deployments/:deploymentId/executions/start` branch, preserving route-scoped deployment id precedence over any body `deploymentId`.
3. Use the same helper in `ExecutionDO.fetch()` for internal `POST /start`, leaving `ExecutionDO.start(...)` session orchestration unchanged.
4. Preserve malformed public JSON behavior: `400 { error: "Request body must be JSON." }`.
5. Preserve successful session start response shape: `{ sessionId, beginTs, schemaVersion, kind }`.
6. Do not touch execution syscall, finish, abort, PartitionDO, artifact runtime, public invoke, executor-http, or `ValidatorJson` in this slice.
7. Add focused helper and execution route tests proving successful decode, route deployment id override, protocol-invalid body mapping, malformed JSON mapping, and normal session start behavior.
8. Validate with focused execution start boundary/session tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 54 slice:

1. Add a shared strict JSON schema helper in `flarex-protocol/json` so transport contracts can validate finite-number/plain-record JSON without duplicating guards.
2. Refactor `flarex-protocol/invoke` to use that shared JSON schema while preserving the existing public invoke parser behavior.
3. Add a protocol-only `flarex-protocol/execution` module with `ExecutionStartRequestSchema`, `ExecutionStartRequest`, `parseExecutionStartRequest`, and `ExecutionProtocolValidationError`.
4. Model the current execution-session start body: required string `deploymentId`, required string `path`, required JSON `args`, and optional string `partitionKey`, `projectId`, `idempotencyKey`, plus optional `query` or `mutation` kind.
5. Export `./execution` from `flarex-protocol` for future Worker and ExecutionDO boundary slices.
6. Keep Worker `/executions/start`, `ExecutionDO.fetch()`, session lifecycle, syscall/finish/abort bodies, PartitionDO, executor-http, and artifact runtime untouched in this slice.
7. Add focused protocol tests proving successful execution start parsing, required fields, invalid kind rejection, invalid JSON args rejection, and continued invoke JSON behavior.
8. Validate with focused protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 53 slice:

1. Add a backend-only public invoke route-boundary helper that reads JSON once and decodes through `parsePublicInvokeRequestBody`.
2. Map `InvokeProtocolValidationError` at the Worker edge to the existing `{ error: string }` 400 response envelope via `HttpError`.
3. Replace unchecked public Worker invoke body reads on both `POST /invoke` and `POST /deployments/:deploymentId/invoke` with the helper.
4. Preserve existing malformed JSON behavior from `readJson`: `400 { error: "Request body must be JSON." }`.
5. Preserve existing invoke construction semantics after decoding: top-level header deployment id still takes precedence, route-scoped deployment id still comes from the URL, omitted `args` still becomes `null`, and `routeInvoke` continues to own required path, kind parsing, artifact runtime dispatch, and fallback `executeInvoke`.
6. Do not touch artifact runtime protocol, execution sessions, PartitionDO, executor-http, connection sync invoke execution, public deployment push routing, or `ValidatorJson`.
7. Add focused helper and Worker route tests proving successful decode, invalid protocol body mapping, malformed JSON mapping, top-level invoke behavior, deployment-scoped invoke behavior, and omitted-args artifact runtime forwarding.
8. Validate with focused invoke boundary/invoke/artifact-runtime tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 52 slice:

1. Add a protocol-only `flarex-protocol/invoke` module with `PublicInvokeRequestBodySchema`, `PublicInvokeRequestBody`, `parsePublicInvokeRequestBody`, and `InvokeProtocolValidationError`.
2. Export `./invoke` from `flarex-protocol` so future backend and generated-runtime slices can share the same public invoke body contract.
3. Keep Worker `/invoke` and `/deployments/:deploymentId/invoke` routing unchanged in this slice; no live invoke behavior changes.
4. Preserve the current future adapter compatibility: omitted `args` remains omitted so the Worker route can keep its existing `args ?? null` defaulting when it is wired later.
5. Validate `args` as real JSON only: primitives, arrays, and plain records. Reject functions, non-finite numbers, non-plain objects, and symbol-keyed records before any Worker adapter uses the parser.
6. Do not touch `routeInvoke`, artifact runtime execution, execution sessions, PartitionDO, executor-http, source/deployment push routing, or `ValidatorJson`.
7. Add focused protocol tests for valid invoke bodies, omitted `args`, invalid field shapes, and invalid JSON `args`.
8. Validate with focused protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 51 slice:

1. Add a `StartPushRequest` schema and `parseStartPushRequest` parser to `flarex-protocol/deployment`, covering the public source-only `{ sourcePackage }` push request.
2. Extend the backend public deployment push route boundary with a raw JSON reader and a `parsePublicStartPushRequest(...)` adapter that decodes through the protocol parser and returns the existing backend `StartPushRequest` shape.
3. Preserve existing public `/push/start` ordering: malformed JSON still returns `400 Request body must be JSON.`, but schema-invalid JSON still returns the analyzer-not-configured `501` when `FLAREX_ANALYZER` is absent.
4. When `FLAREX_ANALYZER` is configured, reject schema-invalid source-only push bodies at the public Worker edge with the existing `{ error: string }` 400 envelope.
5. Do not change analyzer request/response behavior, artifact persistence, DeploymentDO internal routing, analyzed-start behavior, route paths, response bodies, deep deployment semantic validation, or `ValidatorJson`.
6. Add focused protocol/helper/public route tests proving source-only parsing, no-analyzer ordering, analyzer-configured invalid-body behavior, and invalid JSON behavior.
7. Validate with focused public deployment-push boundary/push/protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 50 slice:

1. Add a backend-only public deployment push route-boundary helper that reads JSON once and decodes public `start-analyzed`, `finish`, and `abandon` bodies with the existing `flarex-protocol/deployment` parsers.
2. Map `DeploymentProtocolValidationError` at the public Worker edge to the existing `{ error: string }` 400 response envelope.
3. Replace unchecked `readJson<AnalyzedStartPushRequest>`, `readJson<FinishPushRequest>`, and `readJson<AbandonPushRequest>` casts in `worker.ts` public deployment-push forwarding with the helper.
4. Preserve malformed JSON behavior from `readJson`, DeploymentDO generated-handler routing, artifact preflight before finish forwarding, source-only analyzer behavior, route paths, response bodies, and validation messages.
5. Do not move source-only push analysis, deep deployment semantic validation, PartitionDO, executor-http, worker scheduler routes, or public invoke routes in this slice.
6. Add focused helper tests proving successful decode, protocol parser failures, invalid JSON behavior, and Worker-edge protocol error mapping.
7. Validate with focused public deployment-push boundary/push/protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 49 slice:

1. Add a backend-only `registry/HttpApiWebHandler.ts` factory that combines `HttpApiBuilder.layer(RegistryApi)`, `RegistryApiHandlers`, a provided `RegistryService` layer, `HttpServer.layerServices`, and `HttpRouter.toWebHandler(...)`.
2. Add a small `registry/HttpApiRouteBoundary.ts` helper that forwards generated-handler-compatible registry routes and pre-parses `POST /deployments` bodies with `readJson` plus `parseCreateDeploymentRequest`.
3. Route `GET /health`, `GET /deployments`, and `POST /deployments` through the `RegistryDO`-owned generated Registry HttpApi web handler after the compatibility boundary accepts the request.
4. Keep `RegistryDO.fetch()` as the Durable Object owner for SQL initialization, per-instance layer/handler ownership, non-GET `/health` fallback, generic 404 fallback, and error response wrapping.
5. Preserve existing malformed JSON and schema-invalid create-deployment messages before requests enter the generated handler.
6. Remove the manual `ManagedRuntime` service runner from `RegistryDO` once all RegistryApi routes use the generated handler.
7. Add focused generated-handler and route-boundary tests proving health/create/list behavior and fallback compatibility.
8. Do not change route paths, response bodies, request validation messages, SQL statements, registry service/store orchestration, worker forwarding, protocol schemas, or `ValidatorJson`.
9. Validate with focused registry route-boundary/handler/DO/protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 48 slice:

1. Extract the remaining DeploymentDO route matching and mutation body compatibility pre-parse into a small backend helper that returns either a generated-handler request or `null`.
2. Keep `DeploymentDO.fetch()` as the Durable Object owner for SQL initialization, per-instance layer/handler ownership, non-GET `/health` fallback, generic 404 fallback, and error response wrapping.
3. Preserve compatibility body parsing for analyzed start-push, finish-push, and abandon-push: malformed JSON and protocol parser messages remain unchanged before requests enter the generated handler.
4. Add focused route inventory tests proving the helper forwards every DeploymentApi route to the generated handler with canonical JSON where needed and leaves non-API or fallback routes alone.
5. Do not change route paths, response bodies, request validation messages, SQL statements, service/store orchestration, worker forwarding, protocol schemas, or `ValidatorJson`.
6. Validate with focused route-boundary/handler/protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 47 slice:

1. Route `POST /push/start-analyzed` through the `DeploymentDO`-owned generated Deployment HttpApi web handler after preserving the existing body boundary.
2. Keep `DeploymentDO.fetch()` responsible for malformed JSON and `parseAnalyzedStartPushRequest` wrapper compatibility so existing invalid-body messages remain unchanged.
3. Rebuild a canonical JSON request for the generated handler after the compatibility parse succeeds, allowing `DeploymentApiHandlers.startAnalyzedPush` to own backend validation adaptation, service call, typed error mapping, and response protocol parsing.
4. Remove the now-unused manual `ManagedRuntime` deployment service boundary from `DeploymentDO` once all DeploymentApi routes use the generated handler.
5. Keep the current method-insensitive non-GET `/health` fallback and 404 behavior unchanged.
6. Add focused generated-handler coverage for successful analyzed start-push behavior, alongside the existing invalid-start coverage.
7. Do not change route paths, response bodies, request validation messages, SQL statements, service/store orchestration, worker forwarding, protocol schemas, or `ValidatorJson`.
8. Validate with focused start/handler/protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 46 slice:

1. Route `POST /push/:pushId/finish` through the `DeploymentDO`-owned generated Deployment HttpApi web handler after preserving the existing body boundary.
2. Keep `DeploymentDO.fetch()` responsible for malformed JSON and `parseFinishPushRequest` compatibility so existing invalid-body messages remain unchanged.
3. Keep public worker artifact availability preflight outside `DeploymentDO` unchanged; the generated handler only runs after public preflight has allowed the internal finish request.
4. Rebuild a canonical JSON request for the generated handler after the compatibility parse succeeds, allowing `DeploymentApiHandlers.finishPush` to own the service call, typed error mapping, response protocol parsing, and 200/409 success status encoding.
5. Keep read routes and abandon-push on the generated handler from Goals 44 and 45.
6. Keep analyzed start-push on the existing plain router; do not change its request parsing, validation messages, or response semantics in this slice.
7. Add focused generated-handler coverage for activated finish and rejected finish status/body behavior.
8. Do not change route paths, response bodies, request validation messages, artifact preflight, SQL statements, service/store orchestration, worker forwarding, protocol schemas, or `ValidatorJson`.
9. Validate with focused finish/handler/protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 45 slice:

1. Route `POST /push/:pushId/abandon` through the `DeploymentDO`-owned generated Deployment HttpApi web handler after preserving the existing body boundary.
2. Keep `DeploymentDO.fetch()` responsible for malformed JSON and `parseAbandonPushRequest` compatibility so existing invalid-body messages remain unchanged.
3. Rebuild a canonical JSON request for the generated handler after the compatibility parse succeeds, allowing `DeploymentApiHandlers.abandonPush` to own the service call, typed error mapping, and response protocol parsing.
4. Keep read routes on the generated handler from Goal 44.
5. Keep analyzed start-push and finish-push on the existing plain router; do not change their request parsing, status mapping, artifact preflight, or response semantics in this slice.
6. Add focused route coverage proving successful abandon, malformed abandon bodies, terminal-state 409, and unknown-push 404 remain unchanged with the generated handler in the success/error path.
7. Do not change route paths, response bodies, request validation messages, SQL statements, service/store orchestration, worker forwarding, protocol schemas, or `ValidatorJson`.
8. Validate with focused abandon/handler/protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 44 slice:

1. Add a `DeploymentDO`-owned generated Deployment HttpApi web handler by composing `makeDeploymentApiWebHandler(makeDeploymentLayer(this.ctx.storage, this.sql))` per Durable Object instance.
2. Route only the current read-safe internal paths through that generated handler in this slice: `GET /health`, `GET /deployment`, and `GET /push/:pushId`.
3. Keep non-GET `/health` behavior on the existing plain response path, preserving the current method-insensitive health behavior.
4. Keep mutation routes on the existing plain router: analyzed start-push, finish-push, and abandon-push keep their current protocol/body parsing, status mapping, request validation messages, and worker forwarding behavior.
5. Add focused public-route parity coverage proving active deployment and push status reads still return the same protocol-parsed bodies after the Durable Object read routes use the generated handler.
6. Do not change service/store orchestration, SQL behavior, response bodies, route paths, mutation behavior, worker forwarding, protocol schemas, or `ValidatorJson`.
7. Validate with focused deployment read/push/protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 43 slice:

1. Confirm the abandon-push orchestration already lives in `DeploymentService.abandonPush(...)`: push lookup, typed not-found/invalid-state checks, controlled timestamp use, reason defaulting/truncation, and store delegation.
2. Keep `DeploymentDO.fetch()` responsible only for route matching, JSON reading, protocol parsing with `parseAbandonPushRequest`, and HTTP response wrapping.
3. Pass the parsed `AbandonPushRequest` directly from `DeploymentDO.fetch()` into `DeploymentService.abandonPush(...)` instead of re-adapting the optional reason field in the route layer.
4. Pass the HttpApi handler payload directly into `DeploymentService.abandonPush(...)` for the same reason, preserving the typed error mapping and response parser path.
5. Add route-level coverage for default and truncated abandon reasons so the service-owned normalization is locked from the public HTTP boundary before generated handler wiring.
6. Do not change abandon route paths, response bodies, request validation messages, SQL statements, runtime boundaries, store state guards, worker forwarding, protocol schemas, or `ValidatorJson`.
7. Validate with focused abandon/service/handler/protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 42 slice:

1. Add a backend-only `deployment/HttpApiWebHandler.ts` factory that combines `HttpApiBuilder.layer(DeploymentApi)`, `DeploymentApiHandlers`, a provided `DeploymentService` layer, `HttpServer.layerServices`, and `HttpRouter.toWebHandler(...)`.
2. Keep the factory injectable so a future Durable Object can provide its per-instance `makeDeploymentLayer(...)` without capturing DO state in a global singleton.
3. Convert Deployment service success DTOs through the shared protocol response parsers inside `DeploymentApiHandlers` so HttpApi response encoding receives protocol schema class values.
4. Map response protocol mismatches to the declared storage-error body instead of leaving them as implicit, unobserved defects.
5. Keep the generated web handler's default boundary logging enabled while this remains a spike toward Durable Object integration.
6. Add focused tests that invoke the generated web handler with real `Request` objects for health, push status, invalid analyzed start-push payload behavior, and malformed service success responses.
7. Preserve current `DeploymentDO.fetch()` and worker forwarding entirely; do not route live Durable Object traffic through the web handler in this slice.
8. Do not change service/store orchestration, response bodies, finish-push rejected success semantics, SQL behavior, protocol route paths, or `ValidatorJson`.
9. Validate with focused deployment web-handler/protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 41 slice:

1. Add a backend-only `deployment/HttpApiHandlers.ts` layer with `HttpApiBuilder.group(DeploymentApi, "deployment", ...)`.
2. Implement handlers for health, active deployment, push status, analyzed start-push, finish-push, and abandon-push by delegating to `DeploymentService`.
3. Preserve the existing DeploymentDO behavior by keeping `DeploymentDO.fetch()` on the current plain router; do not add `HttpApiBuilder.layer`, `HttpRouter.toWebHandler`, or route these handlers into the Durable Object yet.
4. Refine deployment error response schemas to status-specific response classes that still encode as the existing `{ error: string }` envelope, so handler failures can map to declared 400/404/409/500 bodies without changing wire responses.
5. Run the existing deployment protocol semantic parser inside the analyzed start-push handler before backend validation so malformed wrapper combinations remain 400s.
6. Use per-endpoint failure mappers so each handler's typed error channel stays aligned with the statuses declared by the schema-first `DeploymentApi`.
7. Keep unexpected decoder/validation defects out of typed API response bodies; only known protocol and `HttpError` validation failures are converted to declared errors.
8. Add focused handler tests proving all DeploymentApi endpoints are registered, typed service/validation/storage failures map to the declared response classes and bodies, and invalid analyzed start-push wrapper combinations stay bad requests.
9. Do not change worker forwarding, DeploymentDO routing, service/store orchestration, request parsing behavior, response bodies, finish-push rejected success semantics, SQL behavior, or `ValidatorJson`.
10. Validate with focused deployment handler/protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 40 slice:

1. Add a generic `DeploymentErrorResponse` schema for the existing deployment `{ error: string }` HTTP error envelope.
2. Add status-tagged `DeploymentBadRequestError`, `DeploymentNotFoundError`, `DeploymentConflictError`, and `DeploymentStorageError` schemas using `HttpApiSchema.status(...)`.
3. Add a status-tagged `RejectedFinishPushSuccess` schema so rejected finish-push responses remain the existing 409 success body shape, not a `{ error: string }` conflict envelope.
4. Attach error schemas to the existing protocol-only `DeploymentApi` endpoints according to current live response semantics: 400 validation/passthrough errors, 404 missing deployment/push errors, 409 abandon conflicts, and 500 storage/corrupt-state errors.
5. Add protocol tests that lock exact endpoint error status metadata, finish-push success status metadata, status annotations, and deployment error response parsing.
6. Do not add backend `HttpApiBuilder` handlers, change DeploymentDO routing, change worker forwarding, change service/store orchestration, change response bodies, or alter request validation messages in this slice.
7. Validate with focused deployment protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 39 slice:

1. Add mutation endpoint metadata to the protocol-only Deployment HttpApi contract for analyzed start-push, finish-push, and abandon-push.
2. Use `DeploymentApiPath` plus `DeploymentPushParams` for the `:pushId` mutation paths.
3. Keep the API definition protocol-only: no `HttpApiBuilder`, no `HttpRouter.toWebHandler`, no backend handler layer, and no Durable Object server wiring yet.
4. Add protocol tests that lock mutation endpoint path/method metadata, path params, and payload presence.
5. Do not add typed error response schemas, change DeploymentDO routing, change worker forwarding, change service/store orchestration, change response bodies, or alter request validation messages in this slice.
6. Validate with focused deployment protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 38 slice:

1. Add `DeploymentHealthResponse`, `DeploymentApiPath`, `DeploymentApiReadGroup`, and `DeploymentApi` to `flarex-protocol/deployment` using `effect/unstable/httpapi`.
2. Describe only the current read routes in this slice: `GET /health`, `GET /deployment`, and `GET /push/:pushId`.
3. Keep the API definition protocol-only: no `HttpApiBuilder`, no `HttpRouter.toWebHandler`, no backend handler layer, and no Durable Object server wiring yet.
4. Add protocol tests that lock read endpoint path/method metadata, path params, and health response parsing.
5. Do not add mutation endpoints, typed error response schemas, change DeploymentDO routing, change worker forwarding, change service/store orchestration, change response bodies, or alter request validation messages in this slice.
6. Validate with focused deployment protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 37 slice:

1. Export stable `DeploymentRoute` and `DeploymentPushAction` constants from `flarex-protocol/deployment`.
2. Use those constants in `DeploymentDO.fetch()` for health, active deployment, analyzed start-push, finish, abandon, and push route matching.
3. Use the same constants in `worker.ts` when forwarding public deployment push routes to DeploymentDO internal paths.
4. Add protocol tests that lock the internal DeploymentDO route/action strings before introducing a Deployment HttpApi contract.
5. Do not introduce `HttpApiBuilder`, change public route paths, change request parsing, change response bodies, change service/store orchestration, or move storage initialization in this slice.
6. Validate with focused deployment protocol/push tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 36 slice:

1. Audit the current abandon-push path and confirm `DeploymentDO.fetch()` only owns route matching, JSON reading, protocol parsing, and HTTP response wrapping.
2. Keep `DeploymentService.abandonPush(...)` as the orchestration boundary for push lookup, typed not-found/invalid-state checks, controlled timestamp use, and reason normalization.
3. Keep `DeploymentPushStore.abandonPush(...)` as the SQL transaction boundary for state guards, update writes, and post-update reads.
4. Add direct `flarex-protocol/deployment` coverage for `parseAbandonPushRequest` so the shared parser used by `DeploymentDO` is locked independently from route tests.
5. Do not change abandon route behavior, response bodies, request validation messages, SQL statements, runtime boundaries, service/store orchestration, or `ValidatorJson`.
6. Validate with focused deployment protocol/service/push tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 35 slice:

1. Add a backend-only `registry/HttpApiHandlers.ts` layer with `HttpApiBuilder.group(RegistryApi, "registry", ...)`.
2. Implement handlers for `health`, `listDeployments`, and `createDeployment` by delegating to `RegistryService`.
3. Add a `RegistryStorageErrorResponse` 500 schema to the protocol contract and map `RegistrySqlError` to that declared HttpApi error body in the handler layer.
4. Do not route `RegistryDO.fetch()` through `HttpApiBuilder`, `HttpRouter.toWebHandler`, or a new runtime yet.
5. Do not change live route behavior, SQL initialization, service/store orchestration, response bodies, runtime boundaries, or validation messages.
6. Add focused tests proving the handler layer registers all RegistryApi endpoints and preserves the declared storage-error body.
7. Validate with focused registry HttpApi handler tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 34 slice:

1. Add `RegistryHealthResponse`, `RegistryApiGroup`, and `RegistryApi` to `flarex-protocol/registry` using `effect/unstable/httpapi`.
2. Keep the API definition protocol-only: no `HttpApiBuilder`, no `HttpRouter.toWebHandler`, no new platform dependencies, and no Durable Object server wiring yet.
3. Describe the existing `GET /health`, `GET /deployments`, and `POST /deployments` routes with the existing request/response schemas.
4. Add protocol tests that lock the runtime HttpApi metadata and the health/deployment body schemas used by the contract.
5. Do not change RegistryDO routing, service/store orchestration, SQL initialization, response bodies, runtime boundaries, or validation messages.
6. Validate with focused registry protocol tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 33 slice:

1. Export stable `RegistryRoute` path constants from `flarex-protocol/registry`.
2. Use those constants in `RegistryDO.fetch()` for current plain-router matching.
3. Use the same constants in RegistryDO route tests so the public path contract is exercised from the shared protocol package.
4. Add a small registry protocol test locking the health and deployments route paths.
5. Do not introduce `HttpApiBuilder`, new platform dependencies, or HttpApi server wiring in this slice.
6. Do not change protocol schemas, SQL initialization, service/store orchestration, response bodies, runtime boundaries, or validation messages.
7. Validate with focused registry protocol/backend tests, full protocol/backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 32 slice:

1. Export a narrow `RegistryServiceApi` interface from `registry/Service.ts`, matching the deployment service pattern.
2. Add a private `RegistryDO.runRegistryService()` helper that wraps `RegistryService.use(...)`.
3. Keep `RegistryDO.fetch()` responsible for route matching, JSON reading, protocol parsing, and success response mapping.
4. Keep `RegistryDO.runRegistryResponse()` as the single `ManagedRuntime.runPromise` boundary and preserve typed failure-to-HTTP mapping in the registry HTTP-boundary helper.
5. Do not change protocol schemas, SQL initialization, service/store orchestration, response bodies, route paths, runtime boundaries, or validation messages.
6. Validate with focused registry service/DO tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 31 slice:

1. Add `registry/StorageSchema.ts` with `initializeRegistryStorage(sql)`.
2. Move the registry deployments table and slug index creation out of `RegistryDO`.
3. Keep `RegistryDO` responsible for owning the Durable Object SQL handle and invoking initialization in the constructor.
4. Preserve exact SQL initialization text, route behavior, service/store orchestration, response bodies, runtime boundaries, protocol schemas, and validation messages.
5. Add direct storage-schema coverage for deployment table and slug index creation.
6. Validate with focused registry storage/boundary/service/DO tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 30 slice:

1. Add a small registry HTTP-boundary helper that converts typed `RegistryService` failures into the existing generic `HttpError(500, "Registry storage error.")` response.
2. Keep `RegistryDO.runRegistryResponse()` as the single `ManagedRuntime.runPromise` boundary and use the helper only after the Effect exits.
3. Preserve `ProtocolValidationError`, invalid JSON, route matching, SQL initialization, response bodies, and service/store orchestration.
4. Add direct HTTP-boundary coverage for `RegistrySqlError` mapping.
5. Do not introduce `HttpApiBuilder` until the dependency and Durable Object lifecycle spike is explicit.
6. Validate with focused registry boundary/service/DO tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 29 slice:

1. Add `finishPushHttpStatus(response)` to the deployment HTTP-boundary helper.
2. Move `FinishPushResponse` status selection out of `DeploymentDO.fetch()` and into that helper.
3. Preserve `200` for activated finish responses and `409` for rejected finish responses.
4. Add direct HTTP-boundary tests for activated and rejected finish status mapping.
5. Do not change finish response bodies, finish service orchestration, protocol schemas, request parsing, SQL behavior, runtime boundaries, deep request decoding, or `ValidatorJson`.
6. Validate with focused deployment boundary/service/validation/push tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 28 slice:

1. Add `FinishPushRequest` and `parseFinishPushRequest` to `flarex-protocol/deployment`.
2. Convert the `POST /push/:id/finish` body boundary from an unchecked `readJson<FinishPushRequest>` cast to the shared protocol parser.
3. Keep finish-push service orchestration unchanged; the request body is still only a protocol/body validation boundary and is not used by `DeploymentService.finishPush`.
4. Preserve the shared invalid-JSON `Request body must be JSON.` behavior from `readJson`.
5. Add protocol parser tests for empty body, optional `activate`, non-object rejection, and invalid activate rejection.
6. Add route tests for malformed finish JSON and malformed finish request shape.
7. Do not change response parsing, SQL behavior, service/store orchestration, runtime boundaries, deep analysis/codegen request decoding, `ValidatorJson`, or finish response status mapping.
8. Validate with focused protocol/backend tests, full backend gates, protocol gates, and only the EffectTS quality checker reviewer.

Completed Goal 27 slice:

1. Add `deployment/StorageSchema.ts` with `initializeDeploymentStorage(sql)`.
2. Move deployment table creation, additive `ALTER TABLE ... ADD COLUMN` guards, and initial `schema_version` seeding out of `DeploymentDO`.
3. Keep `DeploymentDO` responsible for owning the Durable Object SQL handle and invoking initialization in the constructor.
4. Preserve the existing behavior of swallowing additive migration failures because Durable Object SQLite has no `ADD COLUMN IF NOT EXISTS`.
5. Add direct storage-schema tests for table creation, migration order, seed write, and continued initialization when migration columns already exist.
6. Do not change route behavior, protocol schemas, service/store orchestration, SQL statement text, response bodies, runtime boundaries, or validation messages.
7. Validate with focused storage-schema/deployment boundary/service/validation/push tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 26 slice:

1. Add a private `DeploymentDO.runDeploymentService()` helper that wraps `DeploymentService.use(...)`.
2. Keep `DeploymentDO.fetch()` responsible for route matching, JSON reading, protocol parsing, request adaptation, and response status choices.
3. Keep `DeploymentDO.runDeployment()` as the single `ManagedRuntime.runPromise` boundary and keep typed failure-to-HTTP mapping in the Goal 25 helper.
4. Replace repeated route-branch `this.runDeployment(DeploymentService.use(...))` calls with `this.runDeploymentService(...)`.
5. Do not change protocol schemas, deep request decoding, service/store orchestration, SQL behavior, route paths, response bodies, or validation messages.
6. Validate with focused deployment boundary/service/validation/push tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 25 slice:

1. Add a small deployment HTTP-boundary helper that converts typed `DeploymentService` failures into the existing `HttpError` status/message results.
2. Keep `DeploymentDO.runDeployment()` as the single ManagedRuntime boundary and use the helper only after the Effect exits.
3. Preserve `HttpError` passthrough for backend validation/storage-corruption failures.
4. Preserve the generic `500 Deployment storage error.` mapping for `DeploymentSqlError`.
5. Add direct tests for active-not-found, push-not-found, abandon invalid-state, `HttpError` passthrough, and storage error mapping.
6. Do not change route parsing, protocol schemas, service/store orchestration, SQL behavior, response bodies, or deep request decoding.
7. Validate with focused deployment boundary/service/validation/push tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 24 slice:

1. Keep `parseAnalyzedStartPushRequest` wrapper-oriented for `POST /push/start-analyzed`; it validates object shape, `sourcePackage` presence, diagnostics wrapper shape, and success/failure mutual exclusion only.
2. Do not deep-decode request `analysis` or `codegenAnalysis` with protocol schemas yet, because backend validators own exact user-facing `HttpError(400, ...)` messages and cross-field semantic checks.
3. Add protocol regression coverage showing deep request payloads remain unknown at this boundary.
4. Add backend route regression coverage showing malformed direct request `analysis` and `codegenAnalysis` still return backend validation messages.
5. Preserve response-side deep protocol parsing from Goal 6; successful push, finish, and active deployment responses continue to validate deep payloads through `flarex-protocol`.
6. Do not change SQL behavior, service/store orchestration, runtime boundaries, request route shape, or `ValidatorJson` ownership.
7. Validate with focused protocol/backend tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 23 slice:

1. Inline `DeploymentDO.activeDeployment`, `pushStatus`, `finishPush`, and `abandonPush` into their fetch route branches.
2. Keep `DeploymentDO.fetch()` responsible for HTTP routing, JSON reading, protocol parsing, and calling `runDeployment`.
3. Keep `DeploymentDO.runDeployment` as the single ManagedRuntime boundary for deployment service effects.
4. Preserve finish-push JSON body parsing even though the request body is currently unused by the service.
5. Remove now-unused route bridge type imports from `DeploymentDO`.
6. Preserve route behavior, protocol schemas, validation messages, service orchestration, SQL behavior, and row normalization.
7. Validate with focused deployment service/validation/push tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 22 slice:

1. Inline the private `DeploymentDO.startPush` method into the `POST /push/start-analyzed` fetch branch.
2. Keep `DeploymentDO.fetch()` responsible for HTTP routing, JSON reading, `parseAnalyzedStartPushRequest`, backend request adaptation, and calling `runDeployment`.
3. Keep `DeploymentDO.runDeployment` as the single ManagedRuntime boundary for deployment service effects.
4. Remove the now-unused `AnalyzedStartPushRequest` import from `DeploymentDO`.
5. Preserve route behavior, protocol schemas, validation messages, service orchestration, SQL behavior, and row normalization.
6. Validate with focused deployment service/validation/push tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 21 slice:

1. Add a `startAnalyzedPushInput` helper in `deployment/Validation.ts` that converts backend `AnalyzedStartPushRequest` values into the `DeploymentService.startAnalyzedPush` input shape.
2. Move source package validation, diagnostics normalization, analysis validation, generated codegen fallback, explicit codegen validation, and missing-error validation out of `DeploymentDO.startPush`.
3. Keep `DeploymentDO.fetch()` responsible for HTTP routing, JSON reading, and `parseAnalyzedStartPushRequest`.
4. Preserve every existing HTTP 400 validation message for analyzed start-push requests.
5. Add direct validation tests for generated codegen fallback, explicit codegen preservation, failed push input, and exact defensive validation errors.
6. Do not change route behavior, protocol schemas, service orchestration, SQL behavior, row normalization, or deep protocol decoding in this slice.
7. Validate with focused deployment service/validation/push tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 20 slice:

1. Move deployment metadata SQL reads/writes (`active_push_id`, `active_activated_at`, `active_execution_artifact_ref`, and `schema_version`) into `DeploymentPushStore`.
2. Remove `setMeta` and `getMeta` callbacks from `makeDeploymentLayer` and `DeploymentPushStore.layer`.
3. Keep `DeploymentDO` responsible for SQL handle ownership, HTTP routing, runtime construction, table creation, migrations, and initial `schema_version` bootstrap.
4. Preserve active deployment `HttpError` passthrough and `DeploymentSqlError` mapping for non-HTTP metadata read/write failures.
5. Update direct store tests to exercise store-owned metadata reads and writes through fake SQL.
6. Do not change route behavior, protocol schemas, row normalization, service orchestration, metadata key names, metadata values, or deployment SQL schema in this slice.
7. Validate with focused deployment service/validation/push tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 19 slice:

1. Move schema/function application SQL writes from `DeploymentDO` callbacks into `DeploymentPushStore`.
2. Remove `applySchema` and `applyFunctions` from `makeDeploymentLayer` and `DeploymentPushStore.layer`.
3. Keep `DeploymentDO` responsible for SQL handle ownership, HTTP routing, runtime construction, and metadata callbacks.
4. Preserve schema/function validation `HttpError` passthrough and `DeploymentSqlError` mapping for non-HTTP finish transaction failures.
5. Update direct store tests to exercise the store-owned schema/function application path.
6. Do not change route behavior, protocol schemas, row normalization, service orchestration, metadata semantics, or deployment SQL schema in this slice.
7. Validate with focused deployment service/validation/push tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 18 slice:

1. Move the `SELECT push_id, ... FROM pushes WHERE push_id = ?` read into `DeploymentPushStore`.
2. Remove the `readPush` callback from `makeDeploymentLayer` and `DeploymentPushStore.layer`.
3. Keep `DeploymentDO` responsible for SQL ownership, route handling, schema/function application callbacks, and metadata callbacks.
4. Preserve `DeploymentSqlError` mapping for push read failures and preserve existing `HttpError` behavior for active/finish/abandon branches.
5. Update direct store tests to exercise the real store-owned SQL read through fake SQL rows.
6. Do not change SQL query shape, row normalization, service orchestration, route behavior, protocol schemas, or deep protocol decoding in this slice.
7. Validate with focused deployment service/validation/push tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 17 slice:

1. Move `pushStatusFromRow`, stored push state parsing, `codegenAnalysisFromDeploymentAnalysis`, and function path splitting from `DeploymentDO` into `deployment/Validation.ts`.
2. Keep `DeploymentDO.getPush` responsible for the SQL query and row selection.
3. Preserve stored row JSON parsing, push state normalization, generated codegen fallback ordering, diagnostics handling, error field handling, and every existing thrown error message.
4. Add direct row normalization tests for generated codegen fallback, diagnostics preservation, and unknown stored push state behavior while keeping route-level push tests unchanged.
5. Do not change SQL queries, store/service orchestration, route behavior, protocol schemas, or deep protocol decoding in this slice.
6. Validate with focused validation/push tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 16 slice:

1. Move `analyzedStartPushRequest` from `DeploymentDO` into `deployment/Validation.ts`.
2. Keep `parseAnalyzedStartPushRequest` in `DeploymentDO.fetch()` as the HTTP/protocol boundary.
3. Preserve source package normalization, diagnostics normalization, success/failure backend request shapes, optional `codegenAnalysis` handling, and the defensive missing-error branch.
4. Add direct adapter tests for success, failure, diagnostics, and defensive error behavior while keeping route-level push tests unchanged.
5. Do not change SQL writes, row normalization, service orchestration, protocol schemas, or deep protocol decoding behavior in this slice.
6. Validate with focused validation/push tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 15 slice:

1. Move `validateAnalysis`, `validateCodegenAnalysis`, codegen metadata matching, and codegen function path helpers from `DeploymentDO` into `deployment/Validation.ts`.
2. Keep `DeploymentDO` as the HTTP/Durable Object boundary and keep `parseAnalyzedStartPushRequest` wrapper-oriented in this slice.
3. Preserve analysis object checks, schema/function cross-validation, codegen schema matching, module/function metadata validation, canonical comparison behavior, and every existing `HttpError(400, ...)` message for the moved logic.
4. Reduce the temporary helper export surface from Goal 14 so `DeploymentDO` imports high-level validation entrypoints instead of low-level codegen helpers.
5. Extend direct validator tests for analysis/codegen normalization and exact message preservation, while keeping route-level push tests unchanged.
6. Do not change SQL writes, row normalization, service orchestration, protocol schemas, or request route behavior in this slice.
7. Validate with focused validation/push tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 14 slice:

1. Move `validateSchema`, `validateFunctions`, `validateFunctionPartitions`, `safeValidator`, and their helper parsers from `DeploymentDO` into `deployment/Validation.ts`.
2. Keep `DeploymentDO` as the HTTP/Durable Object boundary and keep `validateAnalysis`/`validateCodegenAnalysis` orchestration local for this slice.
3. Preserve table/index/function normalization defaults, partition validation, validator metadata errors, canonical JSON comparison support, and every existing `HttpError(400, ...)` message for the moved helpers.
4. Extend direct validator tests for schema/function normalization and exact message preservation, while keeping route-level push tests unchanged.
5. Do not change SQL writes, row normalization, service orchestration, protocol schemas, or deep analysis/codegen request decoding in this slice.
6. Validate with focused validation/push tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 13 slice:

1. Add `deployment/Validation.ts` with `validateSourcePackage` and `validateDiagnostics`.
2. Keep `DeploymentDO` as the HTTP boundary and keep `parseAnalyzedStartPushRequest` wrapper-oriented.
3. Preserve source-package module/function normalization, diagnostics truncation, and every existing `HttpError(400, ...)` message for these helpers.
4. Add direct validator tests for normalization and exact message preservation, while keeping route-level push tests unchanged.
5. Do not move deep `validateAnalysis`, `validateCodegenAnalysis`, schema/function validators, SQL behavior, or service orchestration in this slice.
6. Validate with focused validation/push tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 12 slice:

1. Move `DeploymentPushNotFoundError`, `DeploymentPushInvalidStateError`, and `DeploymentActiveDeploymentNotFoundError` from `DeploymentService` to `deployment/Errors.ts`.
2. Keep tagged error names, fields, and constructors unchanged so `Effect.catchTag`, `instanceof`, and route mapping keep working.
3. Keep `DeploymentService`, `DeploymentDO.runDeployment`, and service tests using the same typed error channels.
4. Do not change route matching, SQL behavior, protocol schemas, request validation, response messages, or deep analysis/codegen validation.
5. Validate with focused deployment service/push tests, full backend gates, and only the EffectTS quality checker reviewer.

Completed Goal 11 slice:

1. Add `DeploymentService.getPush(pushId)` for single-push status read orchestration.
2. Keep `DeploymentDO.fetch()` as the HTTP route boundary and preserve `GET /push/:id` response shape and decoded push ID behavior.
3. Reuse typed `DeploymentPushNotFoundError` for missing pushes and map it in `DeploymentDO.runDeployment` to the existing `404 Unknown push: <id>` response.
4. Keep row lookup and row-to-status normalization behind the existing `DeploymentPushStore.getPush` port.
5. Add service tests for successful push reads, typed not-found, and typed storage failure propagation.
6. Do not change push response schemas, request parsing, active deployment reads, or deep deployment analysis validation.

Completed Goal 10 slice:

1. Add `DeploymentService.getActiveDeployment()` for active deployment read orchestration.
2. Keep `DeploymentDO.fetch()` as the HTTP route boundary and preserve `GET /deployment` response shape and `404 No active deployment.` behavior.
3. Add typed `DeploymentActiveDeploymentNotFoundError` for the missing-active-deployment case and map it in `DeploymentDO.runDeployment`.
4. Move active metadata reads, active push lookup, analyzed metadata checks, execution artifact ref validation, schema version extraction, and active response construction behind `DeploymentPushStore.getActiveDeployment`.
5. Preserve corrupt active deployment failures as `HttpError` passthrough instead of collapsing them into generic storage errors.
6. Add service/store tests for successful active reads, typed not-found, typed storage failure propagation, and active metadata `HttpError` passthrough.

Completed Goal 9 slice:

1. Add `DeploymentService.abandonPush(pushId, request)` for abandon-push orchestration.
2. Keep `DeploymentDO.fetch()` and `parseAbandonPushRequest` as the HTTP/body boundary; do not change abandon request schema behavior.
3. Model unknown pushes as `DeploymentPushNotFoundError` and terminal-state abandons as typed `DeploymentPushInvalidStateError`, then map them at `DeploymentDO.runDeployment` to the existing 404/409 messages.
4. Move controlled timestamp acquisition, default/truncated reason normalization, SQL update, transaction-level state guard, and abandoned push read behind `DeploymentPushStore.abandonPush`.
5. Preserve existing behavior for analyzed/pending abandon success, terminal push rejection, unknown push rejection, encoded push IDs, and malformed abandon request bodies.
6. Add service/store tests for controlled clock/reason writes, default/truncated reason handling, typed not-found, typed invalid-state, typed storage failure propagation, and transaction `HttpError` passthrough.

Completed Goal 8 slice:

1. Add `DeploymentArtifacts` as an Effect runtime dependency for execution artifact lookup instead of letting `DeploymentDO.finishPush` call artifact code directly.
2. Add `DeploymentService.finishPush(pushId)` with typed `DeploymentPushNotFoundError` and existing `DeploymentSqlError` storage failure propagation.
3. Keep `DeploymentDO.fetch()` and `DeploymentDO.runDeployment()` as the single HTTP/Durable Object boundary for finish-push status mapping.
4. Move analyzed-state preflight, artifact-ref creation, controlled timestamp access, schema/function application transaction, active push metadata writes, and activated response construction behind `DeploymentPushStore.finishPush`.
5. Preserve existing rejected finish-push response codes/messages, the HTTP 409 mapping for rejected finish responses, and activation validation `HttpError` status/message behavior.
6. Add service-level tests for controlled clock/artifact/store behavior, preserved rejection responses, typed not-found preflight, typed finish storage failure propagation, and activation `HttpError` passthrough.

Completed Goal 7 slice:

1. Add `packages/flarex-backend/src/deployment/` with `Runtime`, `Store`, `Service`, and `Layer` files following the Registry service pattern.
2. Keep `DeploymentDO.fetch()` as the HTTP/Durable Object boundary and keep `parseAnalyzedStartPushRequest` wrapper-oriented.
3. Keep existing `validateSourcePackage`, `validateDiagnostics`, `validateAnalysis`, `validateCodegenAnalysis`, and all current HTTP 400 validation messages in `DeploymentDO`.
4. Move push ID generation, timestamp acquisition, superseding existing pending/analyzed pushes, push row insertion, and post-insert push read behind `DeploymentService.startAnalyzedPush`.
5. Model push-start storage failures as typed `DeploymentSqlError` and map them at the Durable Object boundary.
6. Add service-level tests for controlled clock/id behavior and typed storage failure propagation, plus keep focused push lifecycle coverage.

Completed Goal 6 slice:

1. Add `ValidatorJson`, deployment schema/table/index placement, function metadata, deployment analysis, codegen analysis, active deployment, and finish-push response schemas to `flarex-protocol/deployment`.
2. Keep `parseAnalyzedStartPushRequest` wrapper-oriented; do not decode deep `analysis` or `codegenAnalysis` at the request boundary yet.
3. Tighten `parsePushStatus` so successful response parsing validates deep `analysis` and `codegenAnalysis` payloads.
4. Add parser exports for deployment analysis, codegen analysis, active deployment status, and finish-push responses.
5. Update backend tests to parse push, active deployment, and activated finish responses through the shared protocol parsers.
6. Add focused protocol tests for deep analysis/codegen payload parsing and malformed deep codegen rejection.

Completed Goal 5 slice:

1. Add `PushSourceModule`, `PushSourcePackage`, `PushDiagnostic`, and `AnalyzedStartPushRequest` schemas to `flarex-protocol/deployment`.
2. Convert only `POST /push/start-analyzed` body decoding to `parseAnalyzedStartPushRequest`.
3. Normalize protocol class output back into the existing backend `AnalyzedStartPushRequest` exact optional shape before calling `DeploymentDO.startPush`, including explicit success/failure mutual-exclusion checks.
4. Keep existing `validateSourcePackage`, `validateDiagnostics`, `validateAnalysis`, `validateCodegenAnalysis`, SQL writes, and push state transitions unchanged.
5. Add focused tests for valid analyzed push response parsing, failed-analysis push response parsing, invalid JSON, preserved source package validation, invalid diagnostics wrapper and item validation, and mixed success/failure wrappers.

Completed Goal 4 slice:

1. Add `flarex-protocol/deployment` for the narrow `POST /push/:id/abandon` boundary.
2. Define `AbandonPushRequest`, `PushStatus`, and `DeploymentProtocolValidationError` with Effect Schema.
3. Convert only DeploymentDO abandon body decoding to the protocol parser; keep SQL, push state transitions, and route shape unchanged.
4. Parse successful abandon responses in focused backend tests through `parsePushStatus`.
5. Keep deep deployment `analysis` and `codegenAnalysis` payload schemas for a later deployment-analysis slice; this checkpoint validates the stable PushStatus envelope and abandon request.

Completed Goal 3 slice:

1. Add service-level tests for `RegistryService` without Miniflare.
2. Provide `RegistryStore`, `RegistryClock`, and `RegistryIds` through test layers.
3. Prove explicit deployment IDs, generated deployment IDs, controlled timestamps, list response wrapping, and typed `RegistrySqlError` propagation.
4. Keep `RegistryDO.fetch()` route behavior unchanged.
5. Keep reusable Registry service methods as named `Effect.fn` functions.

Completed Goal 2 slice:

1. Keep `flarex-protocol` as the narrow schema-first Registry contract package from the previous checkpoint.
2. Add `packages/flarex-backend/src/registry/` with:
   - `Store.ts` for Durable Object SQLite access and typed `RegistrySqlError`.
   - `Runtime.ts` for Effect-backed clock/id services instead of hidden `Date.now()` and `crypto.randomUUID()` in domain logic.
   - `Service.ts` for registry behavior implemented with `Context.Service`, `Layer`, and reusable `Effect.fn` methods.
   - `Layer.ts` for per-DO layer composition.
3. Keep `RegistryDO.fetch()` as the non-Effect HTTP host for now, with one `ManagedRuntime.runPromise(...)` boundary per handler branch.
4. Do not introduce `HttpApiBuilder`, Alchemy, executor-http replacement, or a large module move in this slice.
5. Preserve the existing route behavior and validate with focused RegistryDO tests plus backend typecheck/build/test gates.

Next checkpoint after Goal 38 should be one of:

- Review whether `DeploymentDO.fetch()` has any remaining deployment-state branches that should cross the service boundary before semantic validator extraction.
- Review whether deployment storage initialization should become an Effect layer concern later, after HTTP and store boundaries are stable.
- Spike `HttpApiBuilder` for RegistryDO only if the current plain-router + Effect-service split remains clean.

My take: yes, this is the right **roadmap direction**, but I would not execute it as written. It is too large to be an implementation plan.

The diagnosis is accurate. `packages/flarex-backend/src/worker.ts` has a large manual router starting at [worker.ts](C:/Users/Admin/Documents/github/convex-backend/custom/cloudflare-executor/packages/flarex-backend/src/worker.ts:102), with repeated `readJson` boundary casts throughout. The shared HTTP layer is tiny and unchecked at runtime: [http.ts](C:/Users/Admin/Documents/github/convex-backend/custom/cloudflare-executor/packages/flarex-backend/src/http.ts:27). `executor-http` also repeats Elysia route registration and manual `request.json()` parsing: [index.ts](C:/Users/Admin/Documents/github/convex-backend/custom/cloudflare-executor/packages/executor-http/src/index.ts:209). So schema-first contracts and typed error mapping would be a real improvement, not cosmetic cleanup.

The best parts of the plan:

- Keep `apps/backend` as infrastructure/deployment ownership and keep `packages/flarex-backend` reusable runtime code.
- Do not convert the frontend SDK during this refactor.
- Do not replace `ValidatorJson` with Effect Schema. Use Effect Schema for transport/API/service contracts; keep `ValidatorJson` for user document/function validation.
- Convert `PartitionDO` last or late. It owns correctness-sensitive OCC/SQL behavior, so schema wrapping and service extraction must be separate from logic changes.
- Start with `RegistryDO`. It is small enough to prove the pattern: [registryDO.ts](C:/Users/Admin/Documents/github/convex-backend/custom/cloudflare-executor/packages/flarex-backend/src/registryDO.ts:27).

What I would change:

- Do **not** start with Alchemy. Keep `wrangler.jsonc` as the source of truth until Worker/DO class boundaries are stable. Alchemy can be a later app-level deployment slice.
- Do **not** replace Elysia in `executor-http` as an early proof. First extract schemas and parity tests; replace the router only after behavior is locked.
- Do **not** do a huge module-folder move before proving the Effect pattern. File moves make review noisy and hide behavior changes.
- Treat `HttpApi` inside Durable Objects as a spike, not a given. If it compiles cleanly and keeps DO instance lifecycle sane, good. If it adds too much ceremony, use Effect Schema at the boundary while keeping plain `fetch` routers for a while.

The first real slice I'd do:

1. Add a tiny `flarex-protocol` package with only `Json`, `CreateDeploymentRequest`, `DeploymentRecord`, and registry response schemas.
2. Convert `RegistryDO` to decode with those schemas, but keep its current routes and SQL behavior.
3. Add/extend Miniflare tests for create/list deployment, invalid JSON, invalid body, duplicate/update behavior.
4. Run `pnpm --filter flarex-backend typecheck` and focused backend tests.
5. Only then decide whether to introduce `HttpApiBuilder` for `RegistryDO`.

So: approve the direction, but downgrade the pasted plan to a roadmap. The immediate implementation plan should be "protocol schemas plus RegistryDO proof," not "Effect/Alchemy/module-layout migration."

Alchemy references to verify during the later spike: [Effect HTTP API](https://v2.alchemy.run/guides/effect-http-api/) and [Durable Objects](https://v2.alchemy.run/tutorial/cloudflare/durable-objects/).
