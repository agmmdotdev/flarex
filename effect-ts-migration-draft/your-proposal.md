## Living status

Current migration state:

- Previous completed checkpoint: `8de16fb` Decode scheduler cleanup bodies.
- Active checkpoint: decode PartitionDO schema-cache bodies at a partition route boundary before schema-cache validation and SQL writes run.
- Effect version: use the workspace catalog `effect@4.0.0-beta.90`. Treat "Effect v4" in this repo as the current v4 beta line until a stable v4 exists.
- Reviewer rule: Effect migration checkpoints use only `.codex/agents/effect-ts-quality-checker.toml`; do not also run the legacy TypeScript/code-quality reviewers for the same checkpoint.
- Long-running goal rule: continue in commit-sized Effect migration checkpoints, update this proposal plus the relevant roadmaps each turn, validate, run the EffectTS quality checker, apply findings, and commit before choosing the next checkpoint.

Current Goal 71 slice:

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
