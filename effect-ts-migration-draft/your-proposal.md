## Living status

Current migration state:

- Previous completed checkpoint: `a1f4eb4` Lock deployment deep request boundary.
- Active checkpoint: extract deployment service failure HTTP mapping into a tested boundary helper while keeping `DeploymentDO.runDeployment()` as the runtime boundary.
- Effect version: use the workspace catalog `effect@4.0.0-beta.90`. Treat "Effect v4" in this repo as the current v4 beta line until a stable v4 exists.
- Reviewer rule: Effect migration checkpoints use only `.codex/agents/effect-ts-quality-checker.toml`; do not also run the legacy TypeScript/code-quality reviewers for the same checkpoint.
- Long-running goal rule: continue in commit-sized Effect migration checkpoints, update this proposal plus the relevant roadmaps each turn, validate, run the EffectTS quality checker, apply findings, and commit before choosing the next checkpoint.

Current Goal 25 slice:

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

Next checkpoint after Goal 25 should be one of:

- Review whether `DeploymentDO.fetch()` has any remaining deployment-state branches that should cross the service boundary before semantic validator extraction.
- Review whether the direct `DeploymentService.use(...)` calls should remain explicit or be grouped only after the deep protocol-decoding decision.
- Decide whether to keep direct `DeploymentService.use(...)` calls explicit or add a tiny call helper that does not hide HTTP/body parsing.
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
