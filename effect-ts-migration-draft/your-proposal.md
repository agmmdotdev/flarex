## Living status

Current migration state:

- Previous completed checkpoint: Deployment route adapter HTTP error boundary.
- Active checkpoint: choose the next backend Worker/DO route/service group that can move a full route or service path to typed Effect service/domain errors and one adapter HTTP mapping edge.
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
10. Test runner exception: until the workspace catalogs `@effect/vitest`,
    Effect boundary tests may use the repo's existing plain Vitest style with
    `Effect.runPromise(...)`. Do not add the dependency as incidental churn
    inside a backend migration slice.

Next recommended checkpoint after the deployment route adapter HTTP error boundary:

1. Prefer DeploymentDO push lifecycle service extraction now that deployment
   request, domain validation, generated HttpApi response, and public/DO route
   adapter error boundaries have typed Effect decoders and one HTTP conversion
   edge.
2. Keep each public Worker or Durable Object entrypoint at one
   `Effect.runPromise` edge and one HTTP mapper.
3. Preserve the existing HTTP response body/status exactly through adapter
   mapping tests.
4. Continue avoiding PartitionDO SQL/OCC rewrites until schema wrapping and
   service extraction are separated from logic changes.

Completed Goal 274 slice:

1. Close the deployment public push and generated DeploymentDO route adapter
   leak where `publicDeploymentRouteErrorToHttpError(...)` and
   `deploymentRouteErrorToHttpError(...)` could return a protocol validation
   error instead of an adapter `HttpError`.
2. Keep direct Effect decoder functions returning typed
   `DeploymentProtocolValidationError`, while promise compatibility helpers
   and Worker/DO route adapters now convert route JSON/protocol failures to
   400 `HttpError` at the adapter edge.
3. Remove the separate public
   `deploymentProtocolValidationErrorResponse(...)` helper and simplify the
   Worker/internal deployment route mappers so HTTP conversion happens in the
   route error mapper.
4. Preserve public deployment push routing, generated DeploymentApi request
   forwarding, DeploymentDO fallback health/not-found behavior, deployment
   service/store behavior, push lifecycle, PartitionDO SQL/OCC, executor-http,
   and `ValidatorJson` unchanged.
5. Update public and generated deployment route-boundary tests to distinguish
   typed Effect decoder failures from adapter-level `HttpError` compatibility
   failures.

Completed Goal 273 slice:

1. Move deployment generated HttpApi response validation for active
   deployment, push-status, and finish-push responses off the backend-local
   `Schema.decodeUnknownEffect(...)` cast and onto protocol-owned Effect
   response decoders.
2. Add protocol-owned Effect decoders for deployment health responses,
   deployment error responses, active deployment status, push status, and
   finish-push response envelopes, while keeping the existing throwing
   `parse...(...)` compatibility wrappers.
3. Add `mapDeploymentProtocolResponseFailure(...)` as the generated Deployment
   HttpApi adapter edge that maps typed `DeploymentProtocolValidationError`
   response failures to the declared `DeploymentStorageErrorResponse`.
4. Preserve generated Deployment HttpApi route behavior, response status/body
   mapping, Deployment service/store behavior, DeploymentDO push lifecycle,
   public finish artifact preflight, PartitionDO SQL/OCC, executor-http, and
   `ValidatorJson` unchanged.
5. Add direct protocol coverage for typed response decoder success/failure
   channels and backend handler coverage for typed protocol response failure
   mapping.

Completed Goal 272 slice:

1. Move `RegistryApiHandlers` response validation from throwing protocol
   parser wrappers inside `Effect.try(...)` to protocol-owned Effect response
   decoders for deployment records and list deployment responses.
2. Add `mapRegistryProtocolResponseFailure(...)` as the registry HttpApi
   adapter edge that maps typed `ProtocolValidationError` response failures to
   the declared `RegistryStorageErrorResponse`.
3. Preserve existing `RegistrySqlError` to `RegistryStorageErrorResponse`
   mapping and generated HttpApi success/error response bodies.
4. Add direct handler coverage for typed protocol response failure mapping and
   malformed list response payloads in addition to existing malformed create
   response coverage.
5. Leave registry request decoding, Registry service/store behavior,
   RegistryDO route matching, DeploymentDO, invoke/execution runtime behavior,
   scheduler, delivery, PartitionDO SQL/OCC, executor-http, and
   `ValidatorJson` unchanged.

Completed Goal 271 slice:

1. Add protocol-owned Effect decoders for registry create-deployment requests,
   health responses, storage-error responses, deployment records, and list
   deployment responses in `flarex-protocol/registry`.
2. Keep the existing registry `parse...(...)` functions as throwing
   compatibility wrappers over those Effect decoders.
3. Move backend `registry/Requests.ts` create-deployment decoding off the local
   try/catch-wrapped protocol parser and onto the protocol Effect decoder
   directly.
4. Preserve RegistryDO route matching, Registry service/store behavior,
   create/list response bodies, malformed JSON handling, generated HttpApi
   handler behavior, and registry route HTTP mapping.
5. Add direct protocol tests for typed Effect request and response failure
   channels before compatibility parsing, while keeping backend registry
   request, route-boundary, and HttpApi handler tests as the adapter mapping
   proof.
6. Leave DeploymentDO, invoke/execution runtime behavior, scheduler, delivery,
   PartitionDO SQL/OCC, executor-http, and `ValidatorJson` unchanged.

Completed Goal 270 slice:

1. Add protocol-owned Effect decoders for deployment start, analyzed-start,
   finish, and abandon request payloads in `flarex-protocol/deployment`.
2. Keep `parseStartPushRequest(...)`, `parseAnalyzedStartPushRequest(...)`,
   `parseFinishPushRequest(...)`, and `parseAbandonPushRequest(...)` as
   throwing compatibility wrappers over those Effect decoders.
3. Move backend `deployment/Requests.ts` decode helpers off the local
   try/catch-wrapped protocol parsers and onto the protocol Effect decoders
   directly.
4. Preserve analyzed-start source-package presence checks, diagnostics array
   checks, success/failure mutual-exclusion checks, public start source-package
   normalization, malformed JSON handling, and DeploymentDO/public deployment
   route HTTP mapping.
5. Add direct protocol tests for typed Effect failure channels before
   compatibility parsing, while keeping backend deployment request and route
   tests as the normalization and adapter mapping proof.
6. Leave DeploymentDO push lifecycle, deployment validation internals,
   analyzer behavior, artifact storage, public invoke/execution dispatch,
   scheduler, delivery, PartitionDO SQL/OCC, executor-http, and
   `ValidatorJson` unchanged.

Completed Goal 269 slice:

1. Add a protocol-owned Effect decoder for public invoke request payloads in
   `flarex-protocol/invoke`.
2. Keep `parsePublicInvokeRequestBody(...)` as the throwing compatibility
   wrapper over the Effect decoder.
3. Move backend `invoke/Requests.ts` decode helpers off the local
   try/catch-wrapped protocol parser and onto the protocol Effect decoder
   directly.
4. Preserve route/body deployment-id selection, path and partition-key domain
   validation, omitted-args defaulting to `null` at the backend invoke request
   boundary, malformed JSON handling, and public invoke route HTTP mapping.
5. Add direct protocol tests for typed Effect failure channels before
   compatibility parsing, while keeping backend invoke request and route tests
   as the normalization and adapter mapping proof.
6. Leave invoke execution, active-deployment loading, artifact runtime
   dispatch, deployment, execution sessions, scheduler, delivery, PartitionDO
   SQL/OCC, executor-http, and `ValidatorJson` unchanged.

Completed Goal 268 slice:

1. Add protocol-owned Effect decoders for execution start, syscall, and finish
   request payloads in `flarex-protocol/execution`.
2. Keep `parseExecutionStartRequest(...)`,
   `parseExecutionSyscallRequest(...)`, and
   `parseExecutionFinishRequest(...)` as throwing compatibility wrappers over
   the Effect decoders.
3. Move backend `execution/Requests.ts` decode helpers off local
   try/catch-wrapped protocol parsers and onto the protocol Effect decoders
   directly.
4. Preserve public execution start route deployment-id overlay behavior,
   public action syscall/finish validation, abort JSON forwarding, malformed
   JSON handling, and route adapter HTTP mapping.
5. Add direct protocol tests for typed Effect failure channels before
   compatibility parsing, while keeping backend route-boundary tests as the
   HTTP adapter mapping proof.
6. Leave ExecutionDO session lifecycle, transaction setup, syscall semantics,
   public invoke, deployment, scheduler, delivery, PartitionDO SQL/OCC,
   executor-http, and `ValidatorJson` unchanged.

Completed Goal 267 slice:

1. Add `InvokeResponseSchema` to `flarex-protocol/invoke` for the backend
   invoke response envelope returned by direct and artifact-runtime execution.
2. Decode successful service-binding artifact runtime `/invoke` responses
   through `decodeServiceBindingExecutionArtifactRuntimeInvokeResponse(...)`
   instead of trusting a raw `body as InvokeResponse` cast.
3. Keep non-OK runtime responses and semantically invalid successful runtime
   payloads in `ServiceBindingExecutionArtifactRuntimeResponseError` until the
   service-binding runtime adapter maps to the existing `HttpError` shape.
4. Preserve public Worker invoke routing, active-deployment loading, artifact
   runtime fetch behavior, source-package loading, materializer cache behavior,
   PartitionDO SQL/OCC logic, executor-http, and `ValidatorJson` semantics.
5. Add direct protocol schema coverage for query and mutation invoke responses,
   direct backend typed success/failure coverage for service-binding invoke
   responses, and adapter-edge `HttpError` mapping coverage for invalid
   runtime invoke responses.

Completed Goal 266 slice:

1. Add Effect-native transaction operation helpers to `SingleShardTransaction`
   for begin, schema sync, document reads, indexed queries, staged writes,
   patch/delete, and commit while preserving the existing promise methods as
   compatibility adapters.
2. Move `executeInvokeEffect(...)` ensure-schema, begin, commit, and
   handler database transaction internals onto those typed transaction helpers,
   keeping partition response and transaction invariant failures typed until
   the invoke operation/adapter mapping edge.
3. Keep handler-facing `readerFor(...)` and `writerFor(...)` promise-based for
   backend author compatibility while widening the shared invoke transaction
   runner to accept Effect-native transaction operations.
4. Preserve synchronous handler throw capture in `invokeExecutionOperation(...)`
   while allowing the same operation wrapper to run Effect-native transaction
   operations.
5. Teach ExecutionDO syscall transaction adapters to accept the widened invoke
   transaction runner and move ExecutionDO start/finish transaction work to
   Effect-native helpers, preserving typed partition response failures through
   route operation adapter mapping.
6. Add direct typed coverage for transaction invariant failures, invoke
   commit/OCC partition failures, and handler staging failures before adapter
   mapping, plus compatibility assertions for the preserved promise adapter
   behavior.
7. Name the reusable transaction Effect operations with
   `Effect.fn("SingleShardTransaction.*")` so trace labels match the migration
   quality bar.
8. Leave public invoke request decoding, PartitionDO SQL/OCC logic,
   deployment storage, executor-http, and
   `ValidatorJson` semantics unchanged.

Completed Goal 265 slice:

1. Convert invoke active-deployment response loading to named Effect helpers:
   `readActiveDeploymentResponseJson(...)` for response-body JSON and
   `decodeActiveDeploymentResponse(...)` for protocol schema validation.
2. Keep non-OK active deployment responses, malformed response JSON, and
   protocol-invalid active deployment payloads in
   `InvokeActiveDeploymentLoadError` until the invoke adapter mapping edge.
3. Preserve `loadActiveDeployment(...)` as the promise compatibility wrapper
   that maps typed active-deployment load failures to the existing `HttpError`
   shape.
4. Add direct tests for active-deployment response decoder success, malformed
   JSON failure, and semantic payload failure before adapter mapping.
5. Leave public invoke request decoding, handler execution, PartitionDO
   SQL/OCC, deployment storage, executor-http, and `ValidatorJson` semantics
   unchanged.

Completed Goal 264 slice:

1. Convert generated Deployment HttpApi response validation for active
   deployment reads, push-status reads, and finish-push responses from
   throwing protocol parsers inside `Effect.try(...)` to direct Effect Schema
   decoders.
2. Convert public finish-push artifact preflight response handling into typed
   Effect steps: one decoder for the DeploymentDO push-status JSON response and
   one Effect Schema decoder for the push-status payload.
3. Keep malformed push-status JSON and semantic push-status response failures
   in the `PublicWorkerDispatchError` channel at the preflight source.
4. Preserve existing generated HttpApi storage-error response mapping and the
   public missing-artifact finish rejection response body/status.
5. Leave DeploymentDO SQL schema, push lifecycle state transitions, public
   route path matching, analyzer behavior, public invoke/execution dispatch,
   PartitionDO SQL/OCC, executor-http, and `ValidatorJson` semantics unchanged.

Completed Goal 263 slice:

1. Convert deployment schema, function metadata, deployment-analysis, and
   codegen-analysis validation to direct Effect pipelines through
   `decodeSchema(...)`, `decodeFunctions(...)`, `decodeAnalysis(...)`, and
   `decodeCodegenAnalysis(...)`.
2. Move shared leaf validation for table/index state, source positions,
   route/partition policy, placement, function kind/visibility, JSON values,
   validators, and partition/schema consistency behind Effect-backed helpers.
3. Keep `DeploymentValidationResult` compatibility helpers by delegating them
   to the new typed Effect decoders, so existing synchronous callers share the
   same validation source without running inside migrated Effect flows.
4. Preserve `ValidatorJson` parsing as the user document/function validator
   authority and only use Effect for transport/domain metadata validation.
5. Leave DeploymentDO SQL schema, push lifecycle state transitions, route
   contracts, public invoke/execution dispatch, PartitionDO SQL/OCC, protocol
   schemas, executor-http, and `ValidatorJson` semantics unchanged.

Completed Goal 262 slice:

1. Convert deployment start-push ingress validation to direct Effect pipelines
   for `decodeSourcePackage(...)`, `decodeDiagnostics(...)`,
   `decodeAnalyzedStartPushRequest(...)`, and
   `decodeStartAnalyzedPushInput(...)`.
2. Keep the throwing compatibility helpers `validateSourcePackage(...)`,
   `validateDiagnostics(...)`, `analyzedStartPushRequest(...)`, and
   `startAnalyzedPushInput(...)` by running the typed decoders at the
   compatibility edge.
3. Preserve protocol-to-domain normalization for analyzed and failed
   start-push requests, including generated codegen fallback in the service
   input decoder.
4. Add direct typed failure coverage for malformed protocol source packages
   and codegen analysis mismatches.
5. Leave DeploymentDO SQL schema, push lifecycle state transitions, stored row
   decoding, deployment route contracts, public invoke/execution dispatch,
   PartitionDO SQL/OCC, protocol schemas, executor-http, and `ValidatorJson`
   semantics unchanged.

Completed Goal 261 slice:

1. Convert stored deployment push-row decoding to a real
   `decodePushStatusFromRow(...)` Effect pipeline for stored state,
   source-package JSON, diagnostics JSON, stored analysis JSON, and optional
   codegen-analysis JSON.
2. Keep `pushStatusFromRow(...)` and `parsePushStatusFromRow(...)` as
   compatibility wrappers over the Effect decoder for synchronous callers and
   transaction preflight code.
3. Preserve `DeploymentPushStore` behavior because it already consumes
   `decodePushStatusFromRow(...)`, so corrupt stored push rows now flow through
   one typed `DeploymentValidationError` channel from storage reads.
4. Add direct validation coverage for invalid stored `schema_json` and
   `codegen_analysis_json` branches in addition to existing source package,
   diagnostics, and partial-analysis failures.
5. Leave DeploymentDO SQL schema, push lifecycle state transitions,
   deployment route contracts, public invoke/execution dispatch, PartitionDO
   SQL/OCC, protocol schemas, executor-http, and `ValidatorJson` semantics
   unchanged.

Completed Goal 260 slice:

1. Move public invoke handler database reads, indexed query planning, uniqueness
   checks, and writer mutations onto the shared invoke Effect validation
   helpers.
2. Keep `readerFor(...)` and `writerFor(...)` as promise-based compatibility
   APIs for handler authors while making their validation failures reject with
   typed invoke errors internally.
3. Teach `invokeExecutionOperation(...)` to propagate known invoke validation
   errors unchanged instead of wrapping them as generic handler operation
   failures.
4. Keep actual transaction IO failures in `InvokeExecutionOperationError` and
   keep user-thrown handler defects mapped as handler operation failures.
5. Add direct `executeInvokeEffect(...)` coverage for handler document
   validation and query planning failures before adapter mapping, while
   preserving existing public invoke compatibility tests.
6. Leave artifact-runtime invoke dispatch, ExecutionDO sessions, PartitionDO
   SQL/OCC, protocol schemas, executor-http, deployment/registry behavior, and
   `ValidatorJson` semantics unchanged.

Completed Goal 259 slice:

1. Add `executeInvokeEffect(...)` as the typed service boundary for the legacy
   public invoke runtime path.
2. Keep `executeInvoke(...)` as the promise compatibility adapter that maps
   typed invoke runtime, validation, and operation failures to the existing
   adapter errors.
3. Add `InvokeExecutionOperationError` for ensure-schema, begin, handler, and
   commit operation failures, preserving `PartitionRequestError` causes for
   Worker adapter responses.
4. Move the non-artifact Worker `/invoke` path to call `executeInvokeEffect(...)`
   directly and map `InvokeExecutionError` at the Worker HTTP adapter edge.
5. Preserve existing public `/invoke` response bodies for unknown functions and
   compatibility wrapper failures.
6. Leave artifact-runtime invoke dispatch, ExecutionDO sessions, PartitionDO
   SQL/OCC, protocol schemas, executor-http, deployment/registry behavior, and
   `ValidatorJson` semantics unchanged.

Completed Goal 258 slice:

1. Add `queryDocumentsEffect(...)` as the shared invoke Effect helper for
   execution indexed query syscalls.
2. Move `ExecutionDO.syscall` query table lookup, required index validation,
   index metadata lookup, range-bound planning, query placement checks, and
   returned document placement checks into typed invoke validation channels.
3. Keep actual `SingleShardTransaction.queryIndexPage(...)` calls inside
   `ExecutionRouteOperationError` by passing the ExecutionDO operation runner
   into the invoke helper.
4. Preserve collect-style query response shape for non-paginated syscalls and
   paginated response shape for limit/cursor syscalls.
5. Preserve HTTP response bodies for missing indexes, unknown indexes, invalid
   ranges, and missing placement filters through the internal route adapter
   edge.
6. Leave ExecutionDO start/finish/abort, document syscalls, public execution
   dispatch, PartitionDO SQL/OCC, protocol schemas, executor-http,
   deployment/registry behavior, and `ValidatorJson` semantics unchanged.

Completed Goal 257 slice:

1. Add shared invoke Effect helpers for execution document syscalls:
   `getDocumentEffect(...)`, `insertDocumentEffect(...)`,
   `patchDocumentEffect(...)`, `replaceDocumentEffect(...)`, and
   `deleteDocumentEffect(...)`.
2. Move `ExecutionDO.syscall` get/insert/patch/replace/delete validation for
   document ids, table names, document validators, placement, and missing patch
   targets into typed invoke error channels.
3. Keep actual transaction reads/writes inside `ExecutionRouteOperationError`
   by passing the ExecutionDO operation runner into the invoke helpers.
4. Preserve HTTP response bodies for malformed ids, validator failures, missing
   documents, and placement failures through the internal route adapter edge.
5. Leave indexed query syscall planning, ExecutionDO start/finish/abort, public
   execution dispatch, PartitionDO SQL/OCC, protocol schemas, executor-http,
   deployment/registry behavior, and `ValidatorJson` semantics unchanged.

Completed Goal 256 slice:

1. Move the remaining `ExecutionDO.start` invoke-domain checks for request
   kind mismatch, argument validation, unsupported active function kinds, and
   create-root root table lookup onto shared invoke Effect boundaries.
2. Add `InvokeArgumentValidationError`, `InvokeRequestKindMismatchError`, and
   `InvokeUnsupportedFunctionKindError` to the ExecutionDO service error
   channel, while keeping session lifecycle failures in `ExecutionSessionError`.
3. Preserve `/executions/start` HTTP response bodies for bad arguments,
   request/function kind mismatch, and unsupported action metadata through the
   internal route adapter edge.
4. Keep SingleShardTransaction schema setup and transaction begin failures in
   `ExecutionRouteOperationError`, and leave ExecutionDO syscall/finish/abort,
   public execution dispatch, PartitionDO SQL/OCC, protocol schemas,
   executor-http, deployment/registry behavior, and `ValidatorJson` semantics
   unchanged.

Completed Goal 255 slice:

1. Move `ExecutionDO.start` active deployment/function metadata loading from
   the compatibility throwing `loadActiveFunctionMetadata(...)` wrapper inside
   `routeExecutionOperation("start", ...)` to
   `loadActiveFunctionMetadataEffect(...)`.
2. Add `InvokeActiveDeploymentLoadError` and
   `InvokeActiveFunctionMetadataNotFoundError` to the ExecutionDO service error
   channel and map them once at the internal route adapter edge through the
   existing invoke runtime/validation HTTP mappers.
3. Preserve the public `/executions/start` response bodies for both missing
   active deployments and missing active function metadata, while keeping
   SingleShardTransaction schema setup and begin failures in
   `ExecutionRouteOperationError`.
4. Preserve ExecutionDO syscall/finish/abort behavior, public execution
   dispatch, PartitionDO SQL/OCC, protocol schemas, executor-http,
   deployment/registry behavior, and `ValidatorJson` semantics unchanged.

Completed Goal 254 slice:

1. Move ExecutionDO start partition/scope resolution from a synchronous
   `Effect.try(...)` wrapper that converted failures to
   `ExecutionRouteOperationError` into the typed
   `resolveFunctionExecutionScopeEffect(...)` invoke-domain boundary.
2. Add `InvokePartitionValidationError` and `InvokeTableNotFoundError` to the
   ExecutionDO service error channel and map them at the internal route adapter
   edge through the existing invoke validation HTTP mapper.
3. Preserve existing public response bodies for missing partition metadata,
   partition-key mismatches, and table lookup failures while keeping actual
   SingleShardTransaction setup/begin failures in `ExecutionRouteOperationError`.
4. Preserve ExecutionDO syscall/finish/abort behavior, public execution
   dispatch, PartitionDO SQL/OCC, protocol schemas, executor-http,
   deployment/registry behavior, and `ValidatorJson` semantics unchanged.

Completed Goal 253 slice:

1. Move ExecutionDO finish return validation from the
   `routeExecutionOperation("finish", Effect.tryPromise(...))` operation
   wrapper to the typed `validateReturnEffect(...)` domain boundary.
2. Add `InvokeReturnValidationError` to the ExecutionDO service error channel
   and map it at the internal route adapter edge through the existing invoke
   validation HTTP mapper.
3. Preserve the existing finish cleanup invariant with `Effect.ensuring(...)`,
   so failed return validation and commit failures still clear the active
   execution session.
4. Keep transaction commit failures as `ExecutionRouteOperationError`, while
   return validation failures now remain typed domain validation failures until
   adapter response mapping.
5. Preserve ExecutionDO start/syscall/abort behavior, public execution dispatch,
   PartitionDO SQL/OCC, protocol schemas, executor-http, deployment/registry
   behavior, and `ValidatorJson` semantics unchanged.

Completed Goal 252 slice:

1. Expose `parsePushStatusFromRow(...)` from `deployment/Validation.ts` as a
   non-throwing `DeploymentValidationResult<PushStatus>` boundary while keeping
   `pushStatusFromRow(...)` as the compatibility throwing wrapper.
2. Move DeploymentPushStore start, finish, and abandon validation preflights
   through typed push-row decoding before transaction writes, so malformed
   push metadata fails as `DeploymentValidationError` without being thrown
   through the `Effect.tryPromise(...)` SQL boundary.
3. Keep transaction aborts for write invariants that still require rollback,
   including missing stored start rows and missing activated finish rows, while
   avoiding deployment-domain validation parsing after mutation.
4. Preserve DeploymentDO service semantics, public deployment push routing,
   artifact persistence, protocol schemas, executor-http, PartitionDO SQL/OCC,
   and `ValidatorJson` behavior unchanged.
5. Extend focused deployment validation/store tests so the new non-throwing row
   parser is covered directly and missing prevalidated finish/abandon failures
   are asserted before transaction writes.

Completed Goal 251 slice:

1. Replace the public finish-push artifact preflight's remaining untyped
   `Effect.promise(...)` lookup with `Effect.tryPromise(...)` mapped to
   `PublicWorkerDispatchError`.
2. Preserve the existing public behavior by recovering artifact lookup failures
   to the same `missing_artifact` rejected finish response instead of treating
   them as Worker dispatch failures.
3. Preserve malformed push-status JSON failures, artifact-ref generation
   failures, generated DeploymentApi finish forwarding, DeploymentDO service
   behavior, artifact persistence, PartitionDO SQL/OCC, protocol schemas,
   executor-http, and `ValidatorJson` behavior unchanged.
4. Extend direct finish-artifact boundary coverage so synchronous artifact
   store lookup failures are handled by the typed Effect boundary and still
   produce the existing `409` rejected finish response.

Completed Goal 250 slice:

1. Add decode-named Effect route payload boundaries for internal PartitionDO
   schema-cache, commit, subscription registration, subscription target, and
   connection unregister payloads, plus the public partition schema-cache
   payload wrapper.
2. Move migrated partition request decoders to call those
   `decode*RoutePayload(...)` functions directly after the shared JSON body
   Effect boundary while retaining parse-named Effect wrappers only as
   compatibility APIs.
3. Preserve PartitionDO SQL/OCC, idempotency replay, schema-cache persistence,
   subscription registration/unregistration behavior, public Worker partition
   routing, protocol schemas, executor-http, and `ValidatorJson` behavior
   unchanged.
4. Extend focused partition route-boundary tests so typed success and typed
   failure assertions exercise the decode-named Effect boundaries while
   compatibility wrappers remain covered.

Completed Goal 249 slice:

1. Add decode-named Effect route payload boundaries for scheduler delivery
   reconcile, connection reconcile, rerun subscriptions, dead-letter
   deliveries, and cleanup connections payloads.
2. Move SchedulerDO and public scheduler request decoders to call those
   `decode*RoutePayload(...)` functions directly after the shared JSON body
   Effect boundary while retaining parse-named Effect wrappers only as
   compatibility APIs.
3. Preserve SchedulerDO maintenance behavior, public scheduler routing,
   cleanup project ID fallback, pending-state continuation behavior,
   DeliveryDO/ConnectionDO fanout, PartitionDO SQL/OCC, protocol schemas,
   executor-http, and `ValidatorJson` behavior unchanged.
4. Extend focused scheduler route-boundary tests so typed success and typed
   failure assertions exercise the decode-named Effect boundaries while
   compatibility wrappers remain covered.

Completed Goal 248 slice:

1. Add decode-named Effect route payload boundaries for DeliveryDO wake,
   public wake-delivery, public live-query delivery, ConnectionDO invalidation,
   and ConnectionDO live-query delivery payloads.
2. Move those migrated request decoders to call the `decode*RoutePayload(...)`
   functions directly while retaining parse-named Effect wrappers only as
   compatibility APIs.
3. Preserve DeliveryDO wake behavior, public Worker sync callbacks,
   ConnectionDO invalidation/live-query delivery behavior, request JSON failure
   mapping, route adapter HTTP mapping, Scheduler/Delivery continuation logic,
   PartitionDO SQL/OCC, protocol schemas, executor-http, and `ValidatorJson`
   behavior unchanged.
4. Extend focused delivery, public wake, public live-query delivery, and
   connection route-boundary tests so typed success and typed failure
   assertions exercise the decode-named Effect boundaries while compatibility
   wrappers remain covered.

Completed Goal 247 slice:

1. Add decode-named Effect route payload boundaries for public invoke payloads
   and artifact runtime invoke payloads.
2. Move migrated public invoke and artifact runtime request decoders to call
   those `decode*RoutePayload(...)` functions directly while retaining
   parse-named Effect wrappers only as compatibility APIs.
3. Preserve public Worker invoke routing, artifact runtime fetch behavior,
   request JSON failure mapping, protocol/payload validation mapping,
   active-deployment/invoke request construction, PartitionDO SQL/OCC,
   protocol schemas, executor-http, and `ValidatorJson` behavior unchanged.
4. Extend focused invoke and artifact runtime route-boundary tests so typed
   success and typed failure assertions exercise the decode-named Effect
   boundaries while compatibility wrappers remain covered.

Completed Goal 246 slice:

1. Add decode-named Effect route payload boundaries for execution start,
   public execution start, public execution action, syscall, and finish
   payloads.
2. Move migrated execution request decoders to call those
   `decode*RoutePayload(...)` functions directly while retaining parse-named
   Effect wrappers only as compatibility APIs.
3. Preserve internal ExecutionDO, public Worker execution routing, request JSON
   failure mapping, protocol validation mapping, route path mapping,
   session/operation behavior, PartitionDO SQL/OCC, protocol schemas,
   executor-http, and `ValidatorJson` behavior unchanged.
4. Extend focused execution route-boundary tests so typed success and typed
   failure assertions exercise the decode-named Effect boundaries while
   compatibility wrappers remain covered.

Completed Goal 245 slice:

1. Route public Worker deployment protocol failures through the Worker
   deployment adapter mapping path instead of a top-level `fetch(...)` special
   case.
2. Narrow the top-level public Worker Effect error channel back to `HttpError`
   so route-specific protocol failures do not leak beyond `routePublicWorker`.
3. Move source-only start-push and finish-push delayed validation to the
   decode-named public deployment route payload boundaries while preserving
   analyzer-configuration and artifact-preflight ordering.
4. Preserve existing public Worker response status/body behavior for malformed
   JSON, invalid deployment protocol payloads, analyzer-disabled start pushes,
   artifact preflight failures, finish/abandon flows, DeploymentService/Store,
   SQL/OCC, protocol schemas, executor-http, and `ValidatorJson`.
5. Validate the public deployment push lifecycle and route-boundary coverage.

Completed Goal 244 slice:

1. Add decode-named Effect payload boundaries for DeploymentDO HttpApi route
   payloads and public deployment push route payloads.
2. Move migrated request decoders to call those `decode*RoutePayload(...)`
   functions directly while retaining parse-named Effect wrappers only as
   compatibility APIs.
3. Reuse the shared deployment protocol decoder in the generated HttpApi
   analyzed-start handler instead of keeping a local parser `try/catch`.
4. Preserve existing request JSON, protocol validation, generated handler,
   public Worker, DeploymentService/Store, SQL/OCC, executor-http, and
   `ValidatorJson` behavior unchanged.
5. Extend route-boundary tests so typed success and failure assertions exercise
   the decode-named Effect boundaries while compatibility wrappers remain
   covered.

Completed Goal 243 slice:

1. Add shared `validateJsonValueEffect(...)` in `validation.ts` so
   `ValidatorJson` value validation can expose typed `BackendValidationError`
   failures through an Effect boundary.
2. Migrate invoke argument, document, and return validation to the shared
   Effect boundary while preserving their existing `Invoke*ValidationError`
   domain errors.
3. Migrate ExecutionDO start argument validation to the shared Effect boundary
   while preserving existing `ExecutionSessionError` argument-validation
   behavior.
4. Keep `validateJsonValue(...)`, `BackendValidationError`, parser
   compatibility wrappers, PartitionDO SQL/OCC validation, protocol schemas,
   executor-http, and `ValidatorJson` semantics unchanged.
5. Add direct Effect-boundary coverage for JSON value validation failures and
   validate focused validation/invoke/execution coverage plus broad gates.

Completed Goal 242 slice:

1. Route PartitionDO internal route adapter recovery through
   `Effect.catchTags(...)` instead of broad catch-all recovery.
2. Keep partition request JSON and partition payload failures typed as
   `RequestJsonError | PartitionRoutePayloadError` until the PartitionDO
   adapter response edge.
3. Wrap PartitionDO route handler failures once as tagged
   `PartitionRouteOperationError`, preserving existing `HttpError` status/body
   mapping and existing OCC conflict `409` JSON response behavior.
4. Move document/index read handlers through the same route operation boundary
   while leaving their query parameter validation responses unchanged.
5. Keep PartitionDO SQL/OCC logic, document validation, schema-cache behavior,
   transaction semantics, protocol schemas, public Worker routing,
   executor-http, and `ValidatorJson` unchanged.
6. Validate focused partition route, transaction, public partition dispatch,
   and OCC coverage plus broad backend/protocol gates.

Completed Goal 241 slice:

1. Route the in-process execution artifact runtime fetch adapter through
   `Effect.catchTags(...)` instead of broad catch-all recovery.
2. Route the service-binding artifact runtime `invoke(...)` adapter through
   explicit tag-specific recovery to `HttpError` compatibility failures.
3. Keep request JSON, artifact invoke payload, runtime route, authorization,
   header, missing source-package, runtime operation, and service-binding
   response failures typed until the relevant artifact runtime adapter edge.
4. Preserve existing artifact runtime HTTP response status/body behavior,
   service-binding `HttpError` rejection behavior, materializer cache behavior,
   artifact source-package loading, public Worker invoke routing, protocol
   schemas, PartitionDO SQL/OCC, executor-http, and `ValidatorJson`.
5. Validate focused artifact runtime route/service coverage and broad backend
   plus protocol gates.

Completed Goal 240 slice:

1. Route SchedulerDO and DeliveryDO internal route adapter recovery through
   `Effect.catchTags(...)` instead of broad catch-all recovery.
2. Keep scheduler request JSON, scheduler payload, pending-state, response,
   runtime, maintenance, delivery-wake, force-reconnect, and route-operation
   failures typed until the SchedulerDO adapter response edge.
3. Convert DeliveryDO drain failures into a tagged `DeliveryDrainFailureError`
   while preserving the existing failure result payload and HTTP `500`
   response behavior.
4. Keep DeliveryDO alarm retry behavior, SchedulerDO alarm continuation
   behavior, delivery claim/fanout/ack logic, scheduler maintenance logic,
   PartitionDO SQL/OCC, protocol schemas, executor-http, and `ValidatorJson`
   unchanged.
5. Validate focused Scheduler/Delivery route coverage and broad backend plus
   protocol gates.

Completed Goal 239 slice:

1. Route ExecutionDO and ConnectionDO internal route adapter recovery through
   `Effect.catchTags(...)` instead of broad catch-all recovery.
2. Keep request JSON, execution protocol, execution session,
   execution/connection operation, connection validation, and live-query
   delivery payload failures typed until the Durable Object adapter response
   edge.
3. Preserve existing invoke error response mapping for ExecutionDO and existing
   `errorResponse(...)` mapping for ConnectionDO.
4. Keep ExecutionDO session lifecycle/syscalls, ConnectionDO WebSocket/session
   behavior, PartitionDO SQL/OCC, Scheduler/Delivery, protocol schemas,
   executor-http, and `ValidatorJson` unchanged.
5. Validate focused execution/connection route coverage and broad backend plus
   protocol gates.

Completed Goal 238 slice:

1. Route RegistryDO and DeploymentDO generated HttpApi internal route adapter
   recovery through `Effect.catchTags(...)` instead of broad catch-all
   recovery.
2. Keep request JSON failures, protocol validation failures, and generated
   handler operation failures typed until the Durable Object adapter response
   edge.
3. Preserve malformed JSON `400`, protocol validation `400`, generated handler
   operation failure status/message, health, and not-found responses.
4. Keep generated Registry/Deployment HttpApi handlers, services/stores, SQL
   behavior, public Worker routes, protocol schemas, PartitionDO,
   executor-http, and `ValidatorJson` unchanged.
5. Reuse existing route-boundary coverage for the preserved adapter response
   behavior while typecheck proves tag-specific recovery coverage.

Completed Goal 237 slice:

1. Route generated Deployment HttpApi read, start, finish, and abandon handler
   service-failure recovery through `Effect.catchTags(...)` instead of broad
   catch-all recovery.
2. Keep typed deployment/protocol/storage/domain errors emitted at their
   source boundaries and map them only to declared generated-handler response
   classes at the HttpApi adapter edge.
3. Preserve `DeploymentBadRequestErrorResponse`,
   `DeploymentNotFoundErrorResponse`, `DeploymentConflictErrorResponse`, and
   `DeploymentStorageErrorResponse` status/body behavior.
4. Keep DeploymentService/Store orchestration, SQL behavior, request payload
   decoders, public Worker routes, protocol schemas, PartitionDO,
   executor-http, and `ValidatorJson` unchanged.
5. Add direct failure-channel coverage for tag-specific generated-handler
   recovery, alongside existing pure response-helper and web-handler coverage.

Completed Goal 236 slice:

1. Move RegistryDO create-deployment payload validation into the shared
   `registry/Requests.ts` source boundary.
2. Keep `registry/HttpApiRouteBoundary.ts` as the JSON-read,
   generated-handler request reconstruction, and HTTP-mapping adapter.
3. Preserve malformed JSON as `RequestJsonError`, invalid create-deployment
   bodies as `ProtocolValidationError`, and existing 400 compatibility mapping
   at the Durable Object route edge.
4. Keep registry generated HttpApi handlers, RegistryService/Store SQL
   behavior, route fallback behavior, executor-http, protocol schemas, and
   `ValidatorJson` unchanged.
5. Add direct source decoder coverage for create-deployment payload success and
   typed protocol failures, plus route boundary coverage for preserved adapter
   behavior.

Completed Goal 235 slice:

1. Move execution artifact runtime invoke payload validation into the shared
   `artifactRuntime/Requests.ts` source boundary with
   `ExecutionArtifactInvokePayloadError`.
2. Keep `artifactRuntime/RouteBoundary.ts` as the JSON-read, compatibility
   parse/read, and HTTP-mapping adapter with stable exports for existing
   callers/tests.
3. Preserve malformed JSON as `RequestJsonError`, invalid invoke payloads as
   typed payload failures before HTTP mapping, and existing 400 compatibility
   mapping at the adapter edge.
4. Keep artifact runtime route path matching, authorization, artifact header
   validation, source-package lookup, materialization, invoke dispatch,
   public Worker artifact routing, executor-http, protocol schemas, and
   `ValidatorJson` unchanged.
5. Add direct source decoder coverage for artifact invoke payload success and
   typed payload failures, plus route/runtime coverage for preserved adapter
   behavior.

Completed Goal 234 slice:

1. Move ConnectionDO invalidation request payload validation into the shared
   `connection/Requests.ts` source boundary with
   `ConnectionRouteValidationError`.
2. Route ConnectionDO live-query delivery request payload decoding through the
   same source boundary while preserving the existing shared
   `LiveQueryDeliveryChangePayloadError` source from `liveQueryDelivery.ts`.
3. Keep `connection/RouteBoundary.ts` as the JSON-read, compatibility
   parse/read, and HTTP-mapping adapter with stable exports for existing
   callers/tests.
4. Preserve malformed JSON as `RequestJsonError`, invalid invalidation bodies
   as typed connection validation failures before HTTP mapping, and live-query
   delivery payload failures as typed live-query payload failures.
5. Keep ConnectionDO WebSocket/session behavior, dispatch operation failures,
   public live-query delivery route behavior, delivery fanout, scheduler,
   executor-http, protocol schemas, and `ValidatorJson` unchanged.
6. Add direct source decoder coverage for invalidation and connection
   live-query delivery payloads, plus route/public delivery boundary coverage
   for preserved adapter behavior.

Completed Goal 233 slice:

1. Move internal DeploymentDO analyzed-start, finish, and abandon push payload
   decoding into the shared `deployment/Requests.ts` source boundary.
2. Move public Worker source-only start, analyzed-start, finish, and abandon
   push payload decoding into the same source boundary, including backend
   `StartPushRequest` source-package normalization.
3. Keep deployment protocol parser failures typed as
   `DeploymentProtocolValidationError` until the route/Worker adapter maps
   them to the existing response behavior.
4. Preserve public Worker preflight ordering for source-only start and finish:
   raw JSON is still read before analyzer/artifact preflight, and protocol
   parsing still happens only after those checks.
5. Keep `HttpApiRouteBoundary.ts` and `PublicPushRouteBoundary.ts` as
   compatibility adapters with stable read/parse exports and route error
   mappers.
6. Keep deployment service/store behavior, artifact persistence/preflight,
   DeploymentDO generated handler routing, public Worker dispatch, executor-http,
   protocol schemas, and `ValidatorJson` unchanged.
7. Add direct shared decoder coverage for internal/public push payloads,
   backend source-package normalization, and typed protocol failures before
   HTTP mapping.

Completed Goal 232 slice:

1. Move public invoke body decoding, route/body deployment id selection, and
   backend `InvokeRequest` normalization into the shared
   `invoke/Requests.ts` source boundary.
2. Keep invoke protocol parser failures typed as
   `InvokeProtocolValidationError` until the route adapter maps them to the
   existing HTTP 400 compatibility error.
3. Keep missing deployment id, missing function path, and empty partition key
   as typed source-boundary failures that are converted to HTTP only at the
   public invoke adapter edge.
4. Preserve public Worker behavior where route deployment id wins over body
   deployment id, omitted args default to `null` only for backend invoke
   execution, and malformed JSON stays `RequestJsonError`.
5. Keep `PublicInvokeRouteBoundary.ts` as a compatibility adapter with stable
   read/parse exports and route error mapping.
6. Keep invoke execution, active deployment loading, artifact runtime dispatch,
   PartitionDO SQL/OCC, execution routes, executor-http, protocol schemas, and
   `ValidatorJson` unchanged.
7. Add direct shared decoder coverage for public invoke payloads, deployment
   id selection, backend invoke request normalization, and typed source
   failures before HTTP mapping.

Completed Goal 231 slice:

1. Move execution start, public start, syscall, finish, and public action
   request payload decoding into the shared `execution/Requests.ts` source
   boundary.
2. Keep protocol parser failures typed as
   `ExecutionProtocolValidationError` until the route adapter maps them to the
   existing HTTP 400 compatibility error.
3. Preserve malformed JSON as `RequestJsonError` at the route boundary and
   preserve public `abort` as well-formed JSON forwarding only.
4. Keep `StartRouteBoundary.ts`, `SyscallRouteBoundary.ts`,
   `FinishRouteBoundary.ts`, and `ActionRouteBoundary.ts` as compatibility
   adapters with stable read/parse exports and route error mappers.
5. Keep ExecutionDO session lifecycle, transaction setup, syscall semantics,
   finish commit/return behavior, public Worker dispatch, PartitionDO
   SQL/OCC, executor-http, protocol schemas, and `ValidatorJson` unchanged.
6. Add direct shared decoder coverage for start/public-start, syscall,
   finish, public action, abort forwarding, and typed protocol failures before
   HTTP mapping.
7. Validate focused execution source/route tests, representative ExecutionDO
   behavior tests, backend typecheck/build, protocol build/test, and only the
   EffectTS quality checker reviewer.

Completed Goal 230 slice:

1. Move Partition route request payload validation into the shared
   `partition/Requests.ts` source boundary with `PartitionRoutePayloadError`.
2. Cover schema-cache, public schema-cache wrapping, commit, subscription
   registration, subscription target, and connection unregister request shapes
   with named Effect decoders at the payload source.
3. Keep internal PartitionDO routes and public Worker schema-cache routes on the
   same shared payload decoders while preserving malformed JSON as
   `RequestJsonError`.
4. Preserve adapter-edge HTTP 400 mapping through
   `partitionRouteErrorToHttpError(...)` and
   `publicPartitionSchemaCacheRouteErrorToHttpError(...)`.
5. Keep PartitionDO SQL/OCC, idempotency, schema-cache persistence, document
   writes, index reads, subscription invalidation, executor-http, protocol
   schemas, and `ValidatorJson` unchanged.
6. Add direct shared decoder coverage plus internal and public route-boundary
   coverage for typed payload failures and preserved HTTP mapping.
7. Validate focused partition route/source tests, PartitionDO/transaction
   behavior tests, backend typecheck/build, protocol build/test, and only the
   EffectTS quality checker reviewer.

Completed Goal 229 slice:

1. Move scheduler maintenance request payload validation into the shared
   `scheduler/Requests.ts` source boundary with
   `SchedulerRoutePayloadError`.
2. Cover delivery reconcile, connection reconcile, rerun/trigger
   subscriptions, dead-letter deliveries, and cleanup connections with
   named Effect decoders at the payload source.
3. Keep internal SchedulerDO routes and public Worker scheduler routes on the
   same shared payload decoders while preserving malformed JSON as
   `RequestJsonError`.
4. Replace the cleanup route's project ID fallback from a throwing
   `HttpError` helper with typed payload failure emission at the source.
5. Preserve adapter-edge HTTP 400 mapping through
   `schedulerRouteErrorToHttpError(...)` and
   `publicSchedulerRouteErrorToHttpError(...)`.
6. Keep SchedulerDO maintenance behavior, continuation state, DeliveryDO,
   ConnectionDO/live-query fanout, PartitionDO SQL/OCC, executor-http,
   protocol schemas, and `ValidatorJson` unchanged.
7. Add direct shared decoder coverage plus internal and public route-boundary
   coverage for typed payload failures and preserved HTTP mapping.
8. Validate focused scheduler route/source tests, selected sync scheduler
   tests, backend typecheck/build, protocol build/test, and only the EffectTS
   quality checker reviewer.

Completed Goal 228 slice:

1. Move DeliveryDO wake request payload validation into the shared
   `delivery/WakeRequest.ts` source boundary with
   `decodeDeliveryWakePayload(...)`, `decodePublicDeliveryWakePayload(...)`,
   and `DeliveryWakePayloadError`.
2. Have internal DeliveryDO wake routes and public Worker wake-delivery routes
   propagate the shared payload error instead of keeping a route-local
   validation tag.
3. Keep the public route deployment ID override behavior while preserving
   malformed JSON as `RequestJsonError`.
4. Preserve adapter-edge HTTP 400 mapping through
   `deliveryWakeRouteErrorToHttpError(...)` and
   `publicDeliveryWakeRouteErrorToHttpError(...)`.
5. Keep DeliveryDO drain semantics, pending drain state, SchedulerDO wake
   behavior, ConnectionDO/live-query fanout, PartitionDO SQL/OCC,
   executor-http, protocol schemas, and `ValidatorJson` unchanged.
6. Add direct shared decoder coverage plus internal and public route-boundary
   coverage for typed payload failures and preserved HTTP mapping.
7. Validate focused delivery wake route/source tests, selected sync delivery
   tests, backend typecheck/build, protocol build/test, and only the EffectTS
   quality checker reviewer.

Completed Goal 227 slice:

1. Move live-query delivery request body validation into the shared
   `decodeLiveQueryDeliveryChangesFromBody(...)` boundary and
   `LiveQueryDeliveryChangePayloadError` in `liveQueryDelivery.ts`.
2. Have public Worker live-query delivery routes and ConnectionDO live-query
   delivery routes propagate the shared payload error instead of wrapping the
   same parser failures into separate route-local validation errors.
3. Keep invalidation-specific query ID validation in
   `ConnectionRouteValidationError`; keep malformed JSON as `RequestJsonError`.
4. Preserve adapter-edge HTTP 400 mapping through
   `publicLiveQueryDeliveryRouteErrorToHttpError(...)` and
   `connectionRouteErrorToHttpError(...)`.
5. Keep live-query delivery fanout semantics, ConnectionDO state,
   SchedulerDO/DeliveryDO behavior, PartitionDO SQL/OCC, executor-http,
   protocol schemas, and `ValidatorJson` unchanged.
6. Add direct shared decoder coverage plus public and ConnectionDO
   route-boundary coverage for typed payload failures and preserved HTTP
   mapping.
7. Validate focused live-query delivery route/core tests, selected sync tests,
   backend typecheck/build, protocol build/test, and only the EffectTS quality
   checker reviewer.

Completed Goal 226 slice:

1. Extract ConnectionDO invalidation and live-query delivery route operation
   calls into `dispatchConnectionInvalidationEffect(...)` and
   `dispatchConnectionLiveQueryDeliveryEffect(...)` under
   `connection/RouteDispatchBoundary.ts`.
2. Keep ConnectionDO route selection and request body decoding in
   `connectionDO.ts` and `connection/RouteBoundary.ts`, while moving
   Promise-to-Effect operation failure mapping out of inline route handlers.
3. Preserve operation failures as `ConnectionRouteOperationError` values from
   `invalidate` and `deliver-live-query`.
4. Preserve the single ConnectionDO route adapter edge that maps body-decoding
   and operation failures to HTTP responses.
5. Keep sync protocol behavior, live query delivery payload semantics,
   ConnectionDO state, scheduler/delivery behavior, PartitionDO SQL/OCC,
   executor-http routes, protocol schemas, and `ValidatorJson` unchanged.
6. Add direct Effect boundary coverage for both connection dispatch success
   paths and typed operation failure mappings.
7. Validate focused connection route/dispatch coverage, sync route behavior,
   backend typecheck/build, protocol build/test, and only the EffectTS quality
   checker reviewer.

Completed Goal 225 slice:

1. Remove redundant `validateSchema(...)` and `validateFunctions(...)`
   compatibility-wrapper calls from `DeploymentPushStore.finishPush(...)`
   activation writes.
2. Keep activation writes on the already decoded `PushStatus.analysis` metadata
   produced by the stored-push row boundary, so schema/function metadata is
   validated once through `decodePushStatusFromRow(...)` before table/function
   rows are written.
3. Preserve transaction-local stored-row rechecks and rollback behavior for
   missing or corrupt push rows; the remaining compatibility wrapper is the
   transaction abort boundary, not duplicate activation metadata validation.
4. Keep SQL table/function row shapes, active deployment metadata, finish
   rejection responses, service behavior, public Worker forwarding, protocol
   schemas, executor-http routes, and `ValidatorJson` unchanged.
5. Validate focused deployment store/service validation coverage, activation
   route behavior, backend typecheck/build, protocol build/test, and only the
   EffectTS quality checker reviewer.

Completed Goal 224 slice:

1. Keep analyzed-start DeploymentDO HttpApi protocol parser failures as
   `DeploymentProtocolValidationError` values through
   `decodeStartAnalyzedPushHandlerInput(...)` instead of remapping them to
   `DeploymentValidationError`.
2. Extend `mapDeploymentStartFailure(...)` and
   `deploymentStartFailureToResponse(...)` so protocol payload failures and
   deployment-domain validation failures both map to declared 400
   `DeploymentBadRequestErrorResponse` values at the HttpApi adapter edge.
3. Preserve domain validation failures from `decodeAnalyzedStartPushRequest(...)`
   and `decodeStartAnalyzedPushInput(...)` as `DeploymentValidationError`
   values emitted by `deployment/Validation.ts`.
4. Keep the compatibility helper
   `startAnalyzedPushHandlerInputFromPayload(...)` aligned with the same
   source-error split while preserving the public bad-request response bodies.
5. Keep DeploymentDO service/store behavior, SQL writes, analyzer behavior,
   artifact persistence, public Worker forwarding, protocol schemas,
   executor-http routes, and `ValidatorJson` unchanged.
6. Add focused handler coverage proving protocol payload errors remain
   `DeploymentProtocolValidationError`, domain validation errors remain
   `DeploymentValidationError`, and both map to the declared 400 response at
   the adapter boundary.
7. Validate focused DeploymentDO HttpApi handler/validation coverage, backend
   typecheck/build, protocol build/test, and only the EffectTS quality checker
   reviewer.

Completed Goal 223 slice:

1. Extract public deployment push Worker forwarding into
   `readDeploymentPushEffect(...)`,
   `readDeploymentPushForFinishArtifactEffect(...)`,
   `abandonDeploymentPushEffect(...)`, `finishDeploymentPushEffect(...)`,
   `startDeploymentPushEffect(...)`, and
   `startAnalyzedDeploymentPushEffect(...)`, named Effect boundaries under
   `deployment/PublicPushDispatchBoundary.ts`.
2. Keep route/path parsing, request decoders, source-only analyzer work,
   artifact persistence, finish artifact preflight, and HTTP adapter mapping in
   their existing boundaries while moving DeploymentDO fetch forwarding out of
   `worker.ts`.
3. Preserve dispatch failures as `PublicWorkerDispatchError` values from
   `deployment-read-push`, `deployment-finish-push-artifact`,
   `deployment-abandon-push`, `deployment-finish-push`,
   `deployment-start-push`, and `deployment-start-analyzed-push`.
4. Preserve exact internal URLs, push id encoding, HTTP methods, JSON content
   headers, and forwarded payloads for public push read, finish-artifact
   preflight read, abandon, finish, source-only start, and analyzed-start.
5. Keep DeploymentDO service/store behavior, analyzer response handling,
   artifact persistence and availability semantics, protocol schemas, public
   response bodies, and `ValidatorJson` unchanged.
6. Add direct Effect boundary coverage for public deployment push forwarding
   success paths and typed failure mappings, plus artifact-preflight coverage
   for the new Effect-shaped read dependency.
7. Validate focused deployment-push-dispatch/public-push coverage, backend
   typecheck/build, protocol build/test, and only the EffectTS quality checker
   reviewer.

Completed Goal 222 slice:

1. Extract top-level public Worker pass-through dispatch into
   `dispatchRegistryDeploymentsEffect(...)`,
   `readDeploymentActiveEffect(...)`, `syncPublicConnectionEffect(...)`, and
   `dispatchDeploymentSchedulerEffect(...)`, named Effect boundaries under
   `worker/PublicPassThroughDispatchBoundary.ts`.
2. Keep route selection and Durable Object name selection in `worker.ts`, while
   moving RegistryDO, DeploymentDO active-read, ConnectionDO sync, and
   deployment SchedulerDO fetch dispatch out of inline Worker helpers.
3. Preserve pass-through dispatch failures as `PublicWorkerDispatchError`
   values from `registry-deployments`, `deployment-active-read`,
   `connection-sync`, and `deployment-scheduler`.
4. Preserve exact request forwarding for registry and deployment scheduler,
   exact active deployment internal URL, and connection sync header injection
   for `x-flarex-deployment` and `x-flarex-connection`.
5. Keep RegistryDO, DeploymentDO, ConnectionDO, SchedulerDO, protocol schemas,
   public response bodies, live sync behavior, and `ValidatorJson` unchanged.
6. Add direct Effect boundary coverage for all four pass-through dispatch
   success paths and typed failure mappings.
7. Validate focused pass-through/registry/active-deployment/sync coverage,
   backend typecheck/build, protocol build/test, and only the EffectTS quality
   checker reviewer.

Completed Goal 221 slice:

1. Extract public scheduler Worker dispatch into
   `reconcilePublicSchedulerDeliveriesEffect(...)`,
   `reconcilePublicSchedulerConnectionsEffect(...)`,
   `deadLetterPublicSchedulerDeliveriesEffect(...)`,
   `cleanupPublicSchedulerConnectionsEffect(...)`,
   `rerunPublicSchedulerSubscriptionsEffect(...)`, and
   `triggerPublicSchedulerSubscriptionsEffect(...)`, named Effect boundaries
   under `scheduler/PublicDispatchBoundary.ts`.
2. Keep public scheduler authorization and request decoding in the existing
   Worker route and typed route boundaries, while moving SchedulerDO fetch
   dispatch out of `worker.ts`.
3. Preserve scheduler dispatch failures as `PublicWorkerDispatchError` values
   from `scheduler-delivery-reconcile`, `scheduler-connection-reconcile`,
   `scheduler-dead-letter-deliveries`, `scheduler-cleanup-connections`,
   `scheduler-rerun-subscriptions`, and `scheduler-trigger-subscriptions`.
4. Preserve exact internal URLs, HTTP methods, JSON content type headers, and
   forwarded payloads for all six public scheduler operations, including the
   compatibility behavior where public trigger forwards to the internal rerun
   subscriptions route.
5. Keep SchedulerDO maintenance behavior, live-query scheduler semantics,
   public scheduler authorization, route validation, protocol schemas, public
   response bodies, and `ValidatorJson` unchanged.
6. Add direct Effect boundary coverage for all public scheduler dispatch
   success paths and typed failure mappings.
7. Validate focused scheduler-dispatch/public-scheduler/sync boundary
   coverage, backend typecheck/build, protocol build/test, and only the
   EffectTS quality checker reviewer.

Completed Goal 220 slice:

1. Extract public partition Worker dispatch into
   `beginPublicPartitionEffect(...)`, `commitPublicPartitionEffect(...)`,
   `cachePublicPartitionSchemaEffect(...)`,
   `readPublicPartitionDocumentEffect(...)`, and
   `readPublicPartitionIndexEffect(...)`, named Effect boundaries under
   `partition/PublicDispatchBoundary.ts`.
2. Keep public partition commit/schema-cache request decoding in the existing
   typed route boundaries, while moving PartitionDO fetch dispatch out of
   `worker.ts`.
3. Preserve partition dispatch failures as `PublicWorkerDispatchError` values
   from `partition-begin`, `partition-commit`, `partition-schema-cache`,
   `partition-document-read`, and `partition-index-read`.
4. Preserve exact internal URLs, HTTP methods, JSON content type headers, and
   forwarded payloads for begin, commit, schema-cache, document read, and index
   read routes.
5. Keep PartitionDO SQL/OCC behavior, transaction semantics, route validation,
   protocol schemas, public response bodies, and `ValidatorJson` unchanged.
6. Add direct Effect boundary coverage for all public partition dispatch
   success paths and typed failure mappings.
7. Validate focused partition-dispatch/transaction/flow coverage, backend
   typecheck/build, protocol build/test, and only the EffectTS quality checker
   reviewer.

Completed Goal 219 slice:

1. Extract public execution Worker dispatch into
   `startPublicExecutionEffect(...)` and
   `dispatchPublicExecutionActionEffect(...)`, named Effect boundaries under
   `execution/PublicDispatchBoundary.ts`.
2. Keep public execution start/action request decoding in the existing typed
   route boundaries, while moving DO fetch dispatch and successful start
   response JSON wrapping out of `worker.ts`.
3. Preserve execution start dispatch failures as `PublicWorkerDispatchError`
   from `execution-start`, successful-start response JSON failures from
   `execution-start-response`, and public action dispatch failures from
   `execution-action`.
4. Preserve compatibility behavior where non-ok execution start responses are
   returned unchanged and successful start responses receive the public
   `sessionId` wrapper.
5. Keep ExecutionDO behavior, session SQL/OCC logic, invoke execution, public
   execution route path parsing, protocol schemas, response bodies, and
   `ValidatorJson` unchanged.
6. Add direct Effect boundary coverage for public start dispatch, non-ok start
   pass-through, start dispatch/response JSON failures, and action dispatch
   failures.
7. Validate focused execution-dispatch/execution-route coverage, backend
   typecheck/build, protocol build/test, and only the EffectTS quality checker
   reviewer.

Completed Goal 218 slice:

1. Extract public source-only start-push artifact persistence into
   `persistAnalyzedSourcePackageEffect(...)`, a named Effect boundary under
   `deployment/PublicStartArtifactBoundary.ts`.
2. Keep successful analyzer results persisted through the configured durable
   artifact store before forwarding to DeploymentDO, while keeping no-store and
   failed analyzer results as explicit no-op branches.
3. Preserve artifact store failures in the typed `PublicWorkerDispatchError`
   channel for `deployment-start-push-store-artifact`.
4. Keep analyzer request/response decoding, generated DeploymentDO forwarding,
   finish artifact preflight, DeploymentDO/service/store behavior, SQL
   statements, protocol schemas, public response bodies, and `ValidatorJson`
   unchanged.
5. Add direct Effect boundary coverage for no artifact store, failed analyzer
   result skip, successful persistence, and dispatch failure mapping.
6. Validate focused start-artifact-boundary/public-push coverage, backend
   typecheck/build, protocol build/test, and only the EffectTS quality checker
   reviewer.

Completed Goal 217 slice:

1. Extract public finish-push durable artifact preflight into
   `verifyStoredPushArtifactEffect(...)`, a named Effect boundary under
   `deployment/PublicFinishArtifactBoundary.ts`.
2. Keep DeploymentDO push-status fetch failures, malformed push-status JSON,
   and artifact-ref computation failures in the typed `PublicWorkerDispatchError`
   channel for `deployment-finish-push-artifact`.
3. Preserve the compatibility behavior where a missing durable artifact returns
   the existing `409` rejected finish-push response before finish body protocol
   validation.
4. Keep finish-push request JSON ordering, generated DeploymentDO forwarding,
   `DeploymentApiHandlers.finishPush`, `DeploymentService.finishPush`,
   source-only analyzer routing, artifact persistence, SQL statements,
   protocol schemas, public response bodies, and `ValidatorJson` unchanged.
5. Add direct Effect boundary coverage for no artifact store, skipped preflight,
   missing-artifact rejection, and dispatch failures.
6. Validate focused artifact-boundary/public-push coverage, backend
   typecheck/build, protocol build/test, and only the EffectTS quality checker
   reviewer.

Completed Goal 216 slice:

1. Move public source-only deployment push analyzer forwarding into
   `analyzeSourcePackageEffect(...)`, a named Effect boundary in
   `backendAnalyzerResponse.ts`.
2. Remove the internal `Effect.runPromise(...)` bridge from the Worker analyzer
   path so analyzer request forwarding, analyzer response decoding, and
   failed analyzed-push payload construction stay inside the Worker route
   Effect pipeline.
3. Preserve analyzer fetch failures as `PublicWorkerDispatchError` from
   `deployment-start-push-analyze`, while preserving analyzer response failures
   as failed analyzed-push payloads with normalized diagnostics.
4. Keep malformed source-only request JSON ordering, analyzer-not-configured
   `501`, analyzer request shape, analyzed artifact persistence, generated
   DeploymentDO forwarding, deployment service/store behavior, SQL statements,
   protocol schemas, public response bodies, and `ValidatorJson` unchanged.
5. Add direct analyzer Effect helper coverage for success, analyzer response
   failure-as-payload, and analyzer fetch dispatch failure, plus keep public
   push parity coverage.
6. Validate focused analyzer/push coverage, backend typecheck/build, protocol
   build, and only the EffectTS quality checker reviewer.

Completed Goal 215 slice:

1. Add `DeploymentStoredPushMissingError` for deployment store transaction
   paths where a post-write row read unexpectedly returns no push.
2. Change start-push, finish-push, and abandon-push store writes to reject the
   transaction callback with typed missing-row errors, then preserve those
   errors through the `Effect.tryPromise(...)` catch path instead of throwing
   plain `Error`.
3. Thread the typed store-write failure through `DeploymentPushStore`,
   `DeploymentService`, generated deployment HttpApi handlers, and the
   compatibility HTTP mapper while preserving the existing external
   `Deployment storage error.` response shape.
4. Add focused store coverage for missing start writes, prevalidated finish
   reads, activated finish reads, and abandon writes.
5. Keep DeploymentDO routing, public Worker forwarding, SQL statement shapes,
   deployment validation, protocol schemas, `ValidatorJson`, and PartitionDO
   SQL/OCC unchanged.
6. Validate deployment service/store coverage, backend typecheck/build,
   protocol build, and only the EffectTS quality checker reviewer.

Completed Goal 214 slice:

1. Move executor-http capability authorization into the named
   `Effect.fn("ExecutorHttp.routeDecodedBody")` route boundary.
2. Add typed executor HTTP authorization and route-precondition failures so
   unauthorized requests, not-configured live-query rerun, and not-configured
   live-query delivery stay in the Effect error channel until the Elysia adapter
   writes status/body responses.
3. Preserve authorization-before-JSON ordering, live-query maintenance
   not-configured responses, malformed JSON responses, typed body validation,
   executor operation error mapping, route paths, Elysia app shape, backend
   live-query callback helpers, protocol schemas, and `ValidatorJson`
   unchanged.
4. Keep executor core semantics, Postgres runtime behavior, backend Worker/DO
   routes, PartitionDO SQL/OCC, scheduler/delivery/connection behavior, and
   deployment HttpApi routes unchanged.
5. Validate direct executor-http auth/config/body coverage, full executor-http
   typecheck/build/test gates, backend typecheck/build, protocol build, and
   only the EffectTS quality checker reviewer.

Completed Goal 213 slice:

1. Convert PartitionDO's route dispatch to a named
   `Effect.fn("PartitionDO.route")` boundary.
2. Route health, schema-cache, begin, commit, subscription register,
   subscription unregister, connection unregister, document read, index read,
   and not-found responses through one Durable Object dispatcher and one
   partition route adapter runner.
3. Preserve typed schema-cache, commit, and subscription body decoders,
   existing `HttpError` adapter mapping, OCC conflict mapping, commit replay
   status behavior, document/index query validation responses, health response
   body, and not-found response body.
4. Keep PartitionDO SQL table layout, OCC validation, idempotency replay,
   document/index persistence, owner-field validation, subscription
   invalidation, public Worker partition routing, scheduler/sync/execution
   routes, executor-http, protocol schemas, and `ValidatorJson` unchanged.
5. Validate direct partition route-boundary coverage, representative
   transaction/OCC behavior, backend typecheck/build, protocol build, and only
   the EffectTS quality checker reviewer.

Completed Goal 212 slice:

1. Convert SchedulerDO's live-query maintenance route dispatch to a named
   `Effect.fn("SchedulerDO.route")` boundary.
2. Route delivery reconcile, connection reconcile, dead-letter deliveries,
   cleanup connections, rerun subscriptions, continue deliveries, continue
   reruns, and continue connection cleanup through one typed Durable Object
   dispatcher and the existing scheduler adapter runner.
3. Preserve typed request decoders, pending-state decode failures, executor
   maintenance failures, delivery wake failures, force-reconnect failures,
   runtime consistency failures, route-operation mapping, continuation
   response bodies, and health response behavior.
4. Keep SchedulerDO scans, retry/alarm scheduling, in-flight coalescing,
   continuation storage, DeliveryDO, ConnectionDO, PartitionDO SQL/OCC, public
   Worker scheduler routing, executor-http, protocol schemas, and
   `ValidatorJson` unchanged.
5. Validate direct scheduler route-boundary coverage, representative sync
   scheduler maintenance behavior, backend typecheck/build, protocol build, and
   only the EffectTS quality checker reviewer.

Completed Goal 211 slice:

1. Convert ExecutionDO's JSON route dispatch to a named
   `Effect.fn("ExecutionDO.route")` boundary.
2. Route `/start`, `/syscall`, `/finish`, and `/abort` through one typed
   Durable Object route dispatcher and the existing adapter runner.
3. Preserve the typed start/syscall/finish body decoders, request JSON failure
   mapping, protocol validation mapping, session error mapping, route-operation
   failure mapping, abort response body, and unknown-route 404 behavior.
4. Keep ExecutionDO session lifecycle, transaction setup, syscall execution,
   commit/return validation, PartitionDO SQL/OCC, public Worker execution
   routing, DeploymentDO, SchedulerDO, DeliveryDO, ConnectionDO,
   executor-http, protocol schemas, and `ValidatorJson` unchanged.
5. Validate direct execution route-boundary coverage, representative ExecutionDO
   session behavior, backend typecheck/build, protocol build, and only the
   EffectTS quality checker reviewer.

Completed Goal 210 slice:

1. Convert DeliveryDO's JSON route dispatch to a named
   `Effect.fn("DeliveryDO.route")` boundary.
2. Route `/wake` and `/continue` through the existing typed wake decoder,
   pending-drain state decoder, drain failure mapping, and operation-failure
   mapper behind one adapter runner for DeliveryDO JSON routes.
3. Preserve malformed JSON, invalid wake validation, wake drain response
   bodies, structured continue failures, claim/fanout/ack failure envelopes,
   retry/continuation behavior, and health response behavior.
4. Keep DeliveryDO alarm handling, drain concurrency, executor claim/ack
   protocol, ConnectionDO fanout, SchedulerDO, PartitionDO SQL/OCC, public
   Worker routing, executor-http, protocol schemas, and `ValidatorJson`
   unchanged.
5. Validate direct delivery route/executor boundary coverage, representative
   sync delivery behavior, backend typecheck/build, protocol build, and only
   the EffectTS quality checker reviewer.

Completed Goal 209 slice:

1. Convert ConnectionDO's JSON internal route dispatch to a named
   `Effect.fn("ConnectionDO.route")` boundary.
2. Route `/invalidate` and `/deliver/live-query` through the existing typed
   request decoders and operation-failure mapper behind one adapter runner for
   ConnectionDO JSON routes.
3. Preserve malformed JSON, invalid body validation, operation failure mapping,
   delivered live-query response bodies, and invalidation response bodies.
4. Keep WebSocket upgrade, heartbeat lease refresh, force-reconnect behavior,
   executor subscription cleanup, DeliveryDO, SchedulerDO, PartitionDO SQL/OCC,
   public Worker routing, executor-http, protocol schemas, and `ValidatorJson`
   unchanged.
5. Validate direct connection route-boundary coverage, representative sync
   behavior, backend typecheck/build, protocol build, and only the EffectTS
   quality checker reviewer.

Completed Goal 208 slice:

1. Move `DeploymentPushStore.getPush(...)` and active deployment metadata
   reads onto the typed deployment validation path for stored push rows.
2. Decode stored push rows with `decodePushStatusFromRow(...)` in the store
   Effect channel, preserving `DeploymentValidationError` separately from
   `DeploymentSqlError`.
3. Decode active execution artifact refs through a named
   `Effect.fn("DeploymentPushStore.parseExecutionArtifactRef")` helper and
   keep malformed active metadata as typed
   `DeploymentActiveDeploymentInvalidError`.
4. Keep transaction-local push rechecks, schema/function activation writes,
   SQL query/update shapes, DeploymentDO generated HttpApi routes, public
   Worker forwarding, protocol schemas, and `ValidatorJson` unchanged.
5. Validate direct deployment validation/service coverage, active metadata
   failure coverage, backend typecheck/build, protocol build, and only the
   EffectTS quality checker reviewer.

Completed Goal 207 slice:

1. Convert the top-level backend Worker router to a named
   `Effect.fn("Worker.routePublicWorker")` orchestration boundary.
2. Keep `/health`, top-level `/invoke`, registry `/deployments`, public
   scheduler routes, and deployment-scoped routes behind one
   `Effect.runPromise(...)` adapter edge instead of separate branch runtime
   boundaries.
3. Preserve the existing public invoke response mapping, registry dispatch
   failure mapping, public scheduler authorization/body/dispatch mapping,
   deployment-scoped route mapping, not-found behavior, protocol schemas, and
   `ValidatorJson` unchanged.
4. Keep the source-package analyzer compatibility decode, Worker scheduled
   handler, DeploymentDO, ExecutionDO, PartitionDO SQL/OCC, ConnectionDO,
   DeliveryDO, SchedulerDO, executor-http, and generated HttpApi routes
   unchanged.
5. Validate public Worker route dispatch coverage plus representative invoke,
   registry, scheduler, deployment, backend typecheck/build, protocol build,
   and only the EffectTS quality checker reviewer.

Completed Goal 206 slice:

1. Convert the deployment-scoped public Worker dispatcher to a named
   `Effect.fn("Worker.routeDeployment")` orchestration boundary.
2. Route deployment id parsing, active deployment reads, scoped invoke,
   deployment push, execution, partition, sync, and deployment scheduler
   branches through existing Effect-returning helpers without nested
   `Effect.runPromise(...)` calls inside the deployment dispatcher.
3. Preserve top-level `/deployments` registry behavior, missing deployment id
   and partition key mapping, scoped invoke response mapping, deployment
   protocol validation passthrough, public push/execution/partition/sync
   branch behavior, response bodies/statuses, protocol schemas, and
   `ValidatorJson` unchanged.
4. Keep DeploymentDO, ExecutionDO, PartitionDO SQL/OCC, ConnectionDO,
   DeliveryDO, SchedulerDO, public top-level invoke, public scheduler,
   executor-http, and generated HttpApi routes unchanged.
5. Validate public route path mapping plus representative push, invoke,
   execution, partition, sync, dispatch-source, backend typecheck/build,
   protocol build, and only the EffectTS quality checker reviewer.

Completed Goal 205 slice:

1. Convert the deployment-scoped public sync router to a named
   `Effect.fn("Worker.routeDeploymentSync")` orchestration boundary.
2. Route `deliver-live-query`, `wake-delivery`, and default connection sync
   fallback branches through the existing Effect-returning helpers without
   nested `Effect.runPromise(...)` calls inside the sync router.
3. Preserve branch priority, path/method behavior, `x-flarex-session`
   handling, generated connection names, live-query delivery authorization,
   typed request body decoders, malformed JSON, delivery target validation,
   downstream dispatch failures, response bodies/statuses, protocol schemas,
   and `ValidatorJson` unchanged.
4. Keep ConnectionDO, DeliveryDO, SchedulerDO, PartitionDO SQL/OCC, public
   deployment push, public invoke, execution routes, public partition routes,
   public scheduler routes, executor-http, and generated HttpApi routes
   unchanged.
5. Validate public live-query delivery, public delivery wake, sync route
   behavior, sync dispatch source coverage, backend typecheck/build, protocol
   build, and only the EffectTS quality checker reviewer.

Completed Goal 204 slice:

1. Convert the public Worker scheduler router to a named
   `Effect.fn("Worker.routePublicScheduler")` orchestration boundary.
2. Route delivery reconcile, connection reconcile, dead-letter deliveries,
   connection cleanup, subscription rerun, and subscription trigger branches
   through the existing Effect-returning scheduler helpers without nested
   `Effect.runPromise(...)` calls in the top-level Worker router.
3. Preserve the exact public scheduler path/method matching, authorization,
   typed request body decoders, malformed JSON, route validation failures,
   downstream scheduler dispatch failures, response bodies/statuses, protocol
   schemas, and `ValidatorJson` unchanged.
4. Keep SchedulerDO maintenance internals, pending continuation state,
   DeliveryDO/ConnectionDO behavior, PartitionDO SQL/OCC, public deployment
   push, public invoke, execution routes, public partition routes,
   executor-http, and generated HttpApi routes unchanged.
5. Validate public scheduler route-boundary tests, scheduler authorization,
   scheduler dispatch source coverage, representative sync public scheduler
   behavior, backend typecheck/build, protocol build, and only the EffectTS
   quality checker reviewer.

Completed Goal 203 slice:

1. Convert the public Worker partition router to a named
   `Effect.fn("Worker.routePartition")` orchestration boundary.
2. Route begin, commit, schema-cache, document-read, and index-read branches
   through the existing Effect-returning forwarding helpers without nested
   `Effect.runPromise(...)` calls inside the partition router.
3. Preserve partition key routing from the public path boundary, commit and
   schema-cache typed body decoders, malformed JSON, invalid commit/schema
   cache envelopes, downstream dispatch failures, unknown partition actions,
   response bodies/statuses, protocol schemas, and `ValidatorJson` unchanged.
4. Keep PartitionDO SQL/OCC logic, transaction semantics, public deployment
   push, public invoke, execution routes, scheduler, sync, delivery,
   executor-http, and generated HttpApi routes unchanged.
5. Validate partition route-boundary tests, public schema-cache route-boundary
   tests, public partition transaction behavior, backend typecheck/build,
   protocol build, and only the EffectTS quality checker reviewer.

Completed Goal 202 slice:

1. Convert the public Worker execution router to a named
   `Effect.fn("Worker.routeExecution")` orchestration boundary.
2. Route start, syscall, finish, and abort branches through the existing
   Effect-returning start/action helpers without nested `Effect.runPromise(...)`
   calls inside the execution router.
3. Preserve execution session id generation, ExecutionDO session naming,
   start-response decoration, missing session id, missing action, unknown
   action, malformed JSON, protocol validation, dispatch failures,
   response bodies/statuses, protocol schemas, and `ValidatorJson` unchanged.
4. Keep ExecutionDO session lifecycle, transaction behavior, PartitionDO
   SQL/OCC, public deployment push, public invoke, scheduler, sync, delivery,
   executor-http, and generated HttpApi routes unchanged.
5. Validate execution route-boundary tests, representative ExecutionDO public
   start/syscall/finish/abort behavior, backend typecheck/build, protocol
   build, and only the EffectTS quality checker reviewer.

Completed Goal 201 slice:

1. Convert the public Worker deployment push router to a named
   `Effect.fn("Worker.routeDeploymentPush")` orchestration boundary.
2. Route start, analyzed-start, read, finish, and abandon push branches through
   the existing Effect-returning subroute helpers without nested
   `Effect.runPromise(...)` calls inside the push router.
3. Preserve missing push id, unknown push action, malformed JSON, deployment
   protocol validation, missing-artifact preflight, analyzer-unconfigured,
   analyzer failure, generated DeploymentDO forwarding, public response
   bodies/statuses, executor-http routes, protocol schemas, and
   `ValidatorJson` unchanged.
4. Keep the public Worker top-level dispatch and other route families
   unchanged; this slice only removes the nested runtime boundaries from the
   deployment push route group.
5. Validate public route path parsing, public deployment push route boundaries,
   representative push lifecycle/error paths, backend typecheck/build,
   protocol build, and only the EffectTS quality checker reviewer.

Completed Goal 200 slice:

1. Add typed internal route adapters for the generated RegistryDO and
   DeploymentDO HttpApi entrypoints.
2. Route both Durable Object `fetch()` methods through named `Effect.fn`
   route services and a single `run*DurableObjectRoute(...)` adapter instead
   of mapping route decode failures through `Effect.runPromise(...).catch`.
3. Keep existing generated HttpApi handlers, registry/deployment service
   layers, storage behavior, route-boundary request builders, malformed JSON
   mapping, protocol validation mapping, fallback health/not-found responses,
   public Worker routes, executor-http routes, protocol schemas, and
   `ValidatorJson` unchanged.
4. Preserve generated handler failures as adapter-level 500 JSON responses
   with the same message text.
5. Validate direct RegistryDO/DeploymentDO adapter mappings plus focused
   generated HttpApi handler coverage, backend typecheck/build, protocol build,
   and only the EffectTS quality checker reviewer.

Completed Goal 199 slice:

1. Extend the typed Scheduler maintenance boundary to cover executor
   dead-letter stuck delivery scans.
2. Add a typed `scheduler/ForceReconnectBoundary.ts` for SchedulerDO to
   ConnectionDO force-reconnect calls, preserving non-OK reconnect responses
   as per-connection failed results while keeping invalid connection targets,
   request failures, and malformed successful payloads typed until the adapter
   edge.
3. Route SchedulerDO dead-letter delivery handling through an Effect-returning
   service instead of a Promise route callback.
4. Keep dead-letter pagination, reconnect deduplication, scanned/dead-lettered
   aggregation, reconnect failure aggregation, public response bodies/statuses,
   delivery reconcile, connection cleanup, rerun, PartitionDO SQL/OCC behavior,
   executor-http, protocol schemas, and `ValidatorJson` unchanged.
5. Validate typed dead-letter maintenance and force-reconnect boundary
   successes/failures directly, then preserve focused SchedulerDO route and
   sync dead-letter coverage plus backend typecheck/build as practical.

Completed Goal 198 slice:

1. Extend the typed Scheduler maintenance boundary to cover stale live-query
   subscription rerun executor calls.
2. Route SchedulerDO rerun-subscriptions and continue-reruns through
   Effect-returning services instead of Promise route callbacks.
3. Decode pending rerun continuation state in the typed Effect channel and keep
   executor rerun failures, invalid rerun payloads, DeliveryDO wake failures,
   storage operation failures, retry scheduling, alarm refresh, and global
   rerun in-flight coalescing typed until the SchedulerDO adapter edge.
4. Preserve existing rerun response bodies/statuses, no-change rerun behavior,
   DeliveryDO wake result envelopes, continuation persistence, retry behavior,
   delivery reconcile, connection cleanup, dead-letter, PartitionDO SQL/OCC
   behavior, executor-http, protocol schemas, and `ValidatorJson` unchanged.
5. Validate typed rerun maintenance boundary successes/failures directly, then
   preserve focused SchedulerDO route and sync rerun coverage plus backend
   typecheck/build as practical.

Completed Goal 197 slice:

1. Extend the typed Scheduler maintenance boundary to cover pending deployment
   scans used by delivery reconcile.
2. Add a typed `scheduler/DeliveryWakeBoundary.ts` for SchedulerDO to
   DeliveryDO wake calls, preserving the existing non-OK delivery drain
   failure envelope as a result and keeping request/response failures typed.
3. Route SchedulerDO delivery reconcile and continue-deliveries through
   Effect-returning services instead of Promise route callbacks.
4. Decode pending delivery continuation state in the typed Effect channel and
   keep pending scan failures, wake request failures, continuation cursor
   failures, storage operation failures, retry scheduling, alarm refresh, and
   in-flight coalescing typed until the SchedulerDO adapter edge.
5. Preserve existing delivery reconcile response bodies/statuses, delivery
   wake failure summaries, continuation persistence, rerun compatibility,
   dead-letter, connection cleanup, PartitionDO SQL/OCC behavior,
   executor-http, protocol schemas, and `ValidatorJson` unchanged.
6. Validate typed pending deployment and DeliveryDO wake boundary
   successes/failures directly, then preserve focused SchedulerDO route and
   sync coverage plus backend typecheck/build as practical.

Completed Goal 196 slice:

1. Add a typed `scheduler/MaintenanceBoundary.ts` for SchedulerDO expired
   connection deployment scans and expired connection cleanup executor calls.
2. Route SchedulerDO connection reconcile, cleanup-connections, and
   continue-connection-cleanup handlers through Effect-returning services
   instead of Promise route callbacks.
3. Decode pending connection-cleanup continuation state in the typed Effect
   channel and keep executor request failures, non-OK maintenance responses,
   invalid maintenance payloads, continuation cursor failures, and storage
   operation failures typed until the SchedulerDO adapter edge.
4. Preserve existing connection cleanup response bodies/statuses, in-flight
   coalescing, continuation persistence, retry scheduling, alarm refresh,
   delivery reconcile, rerun, dead-letter, PartitionDO SQL/OCC behavior,
   executor-http, protocol schemas, and `ValidatorJson` unchanged.
5. Validate typed maintenance boundary successes/failures directly, then
   preserve focused SchedulerDO route and sync coverage plus backend
   typecheck/build as practical.

Completed Goal 195 slice:

1. Add a typed `delivery/ExecutorBoundary.ts` for DeliveryDO claim and ack
   calls into executor maintenance routes.
2. Route DeliveryDO claim/ack through named Effect helpers that preserve
   executor request failures, non-OK claim/ack responses, and invalid payloads
   as typed failures until adapter mapping.
3. Convert the DeliveryDO claim/fanout/ack drain loop to keep those failures
   in the Effect channel until the route adapter maps the final drain failure
   envelope.
4. Preserve the existing DeliveryDO drain failure envelope, failure status
   mapping, retry/continuation behavior, claim owner generation, fanout
   behavior, ack accounting, SchedulerDO, ConnectionDO, PartitionDO SQL/OCC
   behavior, executor-http, protocol schemas, and `ValidatorJson` unchanged.
5. Validate typed executor boundary successes and failures directly, then
   preserve focused DeliveryDO route and live-query response coverage plus
   backend typecheck/build as practical.

Completed Goal 194 slice:

1. Add typed backend live-query integration failures for executor-http delivery,
   wake, and trigger helper calls into the backend Worker/Scheduler routes.
2. Add Effect-returning helpers for backend live-query delivery, wake, and
   trigger operations that map failed fetches and non-OK responses at the
   integration boundary.
3. Keep existing `createFlarexBackendLiveQueryDelivery(...)`,
   `createFlarexBackendLiveQueryWakeNotifier(...)`, and
   `createFlarexBackendLiveQueryTriggerNotifier(...)` promise APIs as
   compatibility wrappers that reject with the same message strings.
4. Preserve executor-http route body decoders, Elysia route registration,
   executor method mappings, backend Worker routes, SchedulerDO, DeliveryDO,
   ConnectionDO, PartitionDO SQL/OCC behavior, protocol schemas, and
   `ValidatorJson` unchanged.
5. Validate typed Effect failures directly and prove compatibility wrappers
   preserve current delivery/trigger rejection messages.

Completed Goal 193 slice:

1. Convert artifact-runtime route-local not-found, authorization, header
   mismatch, and missing source-package failures into typed Effect errors.
2. Keep internal `routeExecutionArtifactRuntimeInvoke(...)` as the named
   Effect-returning route service and make `createExecutionArtifactRuntimeService(...)`
   the public adapter that maps route/runtime failures to HTTP JSON responses.
3. Preserve malformed JSON and invalid payload failures as existing
   `RequestJsonError` / `ExecutionArtifactInvokePayloadError` route-boundary
   failures.
4. Preserve service-binding runtime fetch/load/response failures and materializer
   invocation failures as existing typed runtime operation failures.
5. Keep deployment invoke lookup, Worker public invoke routing, deployment push
   routes, ExecutionDO, ConnectionDO, SchedulerDO, PartitionDO SQL/OCC behavior,
   executor-http, protocol schemas, and `ValidatorJson` unchanged.
6. Validate typed route failures directly and prove the runtime service adapter
   still returns the same `404`, `401`, and `400` JSON responses.

Completed Goal 192 slice:

1. Add typed `InvokeActiveDeploymentLoadError` and
   `InvokeKindValidationError` failures for remaining invoke runtime lookup
   and kind parsing failures.
2. Add `loadActiveDeploymentEffect(...)`,
   `loadActiveFunctionMetadataEffect(...)`, and `parseInvokeKindEffect(...)`
   so active deployment, active metadata, and kind parsing failures are
   available as typed Effect channels.
3. Keep `loadActiveDeployment(...)`, `loadActiveFunctionMetadata(...)`, and
   `parseInvokeKind(...)` as compatibility wrappers that map typed failures to
   the same `HttpError` status/message behavior.
4. Route the public Worker artifact-runtime invoke branch through the typed
   active-deployment load helper instead of throwing `HttpError` from the
   lookup source.
5. Keep direct invoke execution, ExecutionDO session behavior, ConnectionDO
   sync behavior, PartitionDO SQL/OCC behavior, executor-http, protocol
   schemas, and `ValidatorJson` untouched.
6. Validate typed invoke runtime lookup failures directly and prove the
   compatibility wrappers preserve existing adapter responses.

Completed Goal 191 slice:

1. Add typed `LiveQueryDeliveryTargetError` failures for post-decode live-query
   delivery deployment/connection target validation.
2. Route shared delivery fanout target grouping through a named
   Effect-returning boundary instead of throwing `HttpError` from
   `liveQueryDelivery.ts`.
3. Preserve public Worker delivery callback behavior by mapping target
   validation failures to the same `400` response at the Worker adapter edge.
4. Preserve DeliveryDO wake/continue fanout failure behavior by keeping the
   route-level drain failure envelope and carrying the target validation status
   as the existing fanout failure detail.
5. Keep delivery request body decoders, ConnectionDO fanout handling,
   delivery response payload decoders, SchedulerDO, PartitionDO SQL/OCC
   behavior, executor-http, protocol schemas, and `ValidatorJson` untouched.
6. Validate typed target failures directly and prove both public Worker and
   DeliveryDO adapter behavior remain compatible.

Completed Goal 190 slice:

1. Add `scheduler/RuntimeError.ts` with typed
   `SchedulerContinuationCursorError` and
   `SchedulerConnectionTargetError` failures for SchedulerDO runtime
   consistency checks.
2. Route delivery scan continuation cursor mismatches, expired connection scan
   continuation cursor mismatches, and invalid dead-letter reconnect targets
   through typed scheduler runtime failures instead of raw `HttpError` throws
   inside service logic.
3. Map those runtime failures only at the SchedulerDO adapter edge while
   preserving the existing `502` status and JSON error bodies.
4. Keep scheduler request decoders, pending-state decoders, executor response
   decoders, retry/alarm scheduling, DeliveryDO, ConnectionDO, PartitionDO
   SQL/OCC behavior, executor-http, protocol schemas, and `ValidatorJson`
   untouched.
5. Validate typed runtime-error mapping directly and prove all three public
   scheduler paths preserve their existing 502 response bodies.

Completed Goal 189 slice:

1. Preserve typed `SchedulerResponseError` and
   `SchedulerResponsePayloadError` failures through SchedulerDO executor
   response service helpers instead of mapping them to `HttpError` inside the
   helpers.
2. Route SchedulerDO internal route execution through one adapter mapper that
   now handles route validation, pending-state validation, executor response
   failures, payload validation failures, and route operation failures.
3. Keep per-deployment delivery reconcile and connection cleanup failure
   summaries compatible by deriving the same 502-style status/message from
   typed scheduler response failures.
4. Preserve scheduler request decoders, pending continuation state, retry/alarm
   scheduling, DeliveryDO, ConnectionDO, PartitionDO SQL/OCC behavior,
   executor-http, protocol schemas, and `ValidatorJson`.
5. Validate typed response/payload boundaries directly and prove malformed
   executor cleanup payloads still surface through SchedulerDO as the preserved
   `502` adapter response.

Completed Goal 188 slice:

1. Add `scheduler/PendingState.ts` with typed
   `SchedulerPendingStateError` and Effect-returning decoders for persisted
   SchedulerDO delivery-reconcile, connection-cleanup, and rerun continuation
   state.
2. Route SchedulerDO persisted continuation reads through the same typed
   pending-state boundary instead of throwing `HttpError` from local storage
   helper functions.
3. Map pending-state failures only at the SchedulerDO adapter edge while
   preserving scheduler route validation errors and scheduler route operation
   failures.
4. Preserve delivery reconcile, connection cleanup, rerun continuation,
   retry/alarm scheduling, executor response payload decoders, DeliveryDO,
   ConnectionDO, PartitionDO SQL/OCC behavior, executor-http, protocol schemas,
   and `ValidatorJson`.
5. Validate typed pending-state success/failure channels directly and keep
   focused scheduler route-boundary coverage passing.

Completed Goal 187 slice:

1. Add `delivery/PendingDrainState.ts` with typed
   `DeliveryPendingDrainStateError` and
   `decodePendingDeliveryDrainFromStorage(...)` for persisted DeliveryDO
   continuation state.
2. Route DeliveryDO `/continue` pending-state validation through the same
   typed pending-state boundary instead of throwing `HttpError` from storage
   helper functions.
3. Map pending-state failures only at the DeliveryDO adapter edge while
   preserving `DeliveryDrainFailureError` structured claim/fanout/ack failures
   and `DeliveryRouteOperationError` runtime failures.
4. Preserve wake body decoders, delivery claim/fanout/ack behavior,
   retry/alarm scheduling, SchedulerDO and ConnectionDO behavior,
   PartitionDO SQL/OCC behavior, executor-http, protocol schemas, and
   `ValidatorJson`.
5. Validate typed pending-state success/failure channels directly and keep
   focused DeliveryDO continuation runtime coverage passing.

Completed Goal 186 slice:

1. Add an Effect-returning `decodePushStatusFromRow(...)` boundary for stored
   deployment push rows.
2. Route stored push state, source package JSON, analysis JSON,
   codegen-analysis JSON, and diagnostics JSON validation through
   `DeploymentValidationError` instead of raw JSON parser defects or untyped
   stored-state errors.
3. Widen `DeploymentPushStore` and `DeploymentService` read/start/abandon
   paths so stored-row validation failures propagate as typed deployment
   validation failures instead of `DeploymentSqlError`.
4. Keep HttpApi read/abandon adapter response shapes storage-class for
   corrupted stored rows while preserving start/finish validation mapping,
   protocol schemas, executor-http, PartitionDO SQL/OCC behavior, and
   `ValidatorJson`.
5. Validate the typed stored-row decoder directly and prove
   `DeploymentPushStore.getPush(...)` preserves `DeploymentValidationError`
   from corrupted persisted rows.

Completed Goal 185 slice:

1. Add typed `ExecutionSessionError` failures for `ExecutionDO` session
   lifecycle and domain validation failures.
2. Convert `ExecutionDO.start(...)`, `ExecutionDO.syscall(...)`, and
   `ExecutionDO.finish(...)` to Effect-returning service methods so decoded
   route bodies flow into typed service/domain failures instead of direct
   `HttpError` throws.
3. Keep asynchronous active-function lookup, transaction setup, storage
   syscalls, and finish commit/return validation behind
   `ExecutionRouteOperationError`, preserving the existing operation-failure
   adapter behavior.
4. Map session errors only at the `ExecutionDO.fetch()` adapter edge while
   preserving one `Effect.runPromise` route boundary, request body decoders,
   abort behavior, PartitionDO SQL/OCC behavior, executor-http, protocol
   schemas, and `ValidatorJson`.
5. Validate typed session error mapping directly and preserve existing
   execution session behavior with focused ExecutionDO route/session tests.

Completed Goal 184 slice:

1. Add typed ConnectionDO live-query fanout result payload failures through
   `LiveQueryDeliveryResultPayloadError`.
2. Route `deliverLiveQueryChangesToConnections(...)` through the typed payload
   decoder after the existing response-status decoder, preserving one
   `Effect.runPromise` edge per ConnectionDO fanout call.
3. Keep `liveQueryDeliveryResultFromUnknown(...)` as a compatibility wrapper
   that maps typed payload failures back to the existing `HttpError(502, ...)`
   shape for direct parser callers.
4. Preserve delivery target validation, skip-reason normalization,
   staleSkipped compatibility, DeliveryDO claim/ack behavior, SchedulerDO
   workflows, PartitionDO SQL/OCC behavior, executor-http, protocol schemas,
   and `ValidatorJson`.
5. Validate typed fanout payload success/failure channels directly and preserve
   existing adapter mapping with focused live-query delivery tests.

Completed Goal 183 slice:

1. Extend the live-query delivery response boundary with typed claim and ack
   payload decoders backed by `LiveQueryDeliveryResponsePayloadError`.
2. Extend the scheduler response boundary with typed payload decoders for
   pending deployment scans, rerun responses, expired connection scans,
   dead-letter scans, force reconnect responses, and connection cleanup
   summaries.
3. Route `DeliveryDO` and `SchedulerDO` response handling through one
   `Effect.runPromise` edge per service call, mapping payload failures back to
   the existing `HttpError(502, ...)` adapter shape.
4. Remove the old throw-based successful payload parsers for these foreign
   response contracts while preserving DeliveryDO retry/ack/fanout state,
   SchedulerDO continuation/alarm workflows, ConnectionDO force reconnect
   behavior, PartitionDO SQL/OCC behavior, executor-http, protocol schemas, and
   `ValidatorJson`.
5. Validate typed payload success/failure channels directly and preserve
   existing adapter mapping with focused live-query delivery and scheduler
   response tests.

Completed Goal 182 slice:

1. Add typed public Worker path failures for missing deployment id, missing
   partition key, and missing deployment push id.
2. Add named Worker path helpers for deployment id extraction, partition key
   extraction, and deployment push path classification.
3. Route deployment, push, and partition Worker path parsing through typed
   Effect helpers instead of `required(...)` throws, while preserving
   `/deployments` registry listing, treating only `POST /push/start` and
   `POST /push/start-analyzed` as push actions, unknown push actions as
   `404 Push route not found.`, and unknown partition actions as
   `404 Partition route not found.`.
4. Preserve public push start/start-analyzed/read/finish/abandon behavior,
   public partition begin/commit/schema-cache/document/index behavior,
   DeploymentDO behavior, PartitionDO SQL/OCC behavior, executor-http,
   protocol schemas, and `ValidatorJson` semantics.
5. Validate typed path failure channels directly, then preserve Worker HTTP
   adapter mapping with focused route tests.

Completed Goal 181 slice:

1. Add typed public execution route path failures for missing session id and
   missing execution action, while preserving unknown actions as the existing
   `404 Execution route not found.` response.
2. Add a named `publicExecutionRoutePathFromPartsEffect(...)` helper so Worker
   execution path parsing runs through a typed Effect boundary instead of
   `required(...)` throws.
3. Route public execution start response JSON reads through the shared
   `readResponseJsonEffect(...)` boundary and map malformed response JSON as a
   typed `PublicWorkerDispatchError`.
4. Preserve execution start/syscall/finish/abort request body decoding,
   session creation, session forwarding, unknown-session behavior, public route
   response bodies, ExecutionDO behavior, PartitionDO SQL/OCC behavior,
   executor-http, protocol schemas, and `ValidatorJson` semantics.
5. Validate typed path failure channels directly, then preserve public Worker
   HTTP adapter mapping with focused execution route tests.

Completed Goal 180 slice:

1. Add typed public invoke request-shaping failures for missing function path
   and empty partition key after the protocol body decoder has accepted the
   transport shape.
2. Add a named `invokeRequestFromPublicInvokeBodyEffect(...)` helper so the
   Worker route builds backend `InvokeRequest` values through a typed Effect
   boundary instead of `required(...)` throws.
3. Convert the public Worker invoke execution helper to a typed Effect pipeline
   that routes active-deployment loading, artifact-runtime invocation, and
   direct `executeInvoke(...)` failures through `PublicWorkerDispatchError`.
4. Preserve top-level `/invoke`, scoped `/deployments/:id/invoke`, deployment
   header precedence, malformed JSON/protocol validation responses, unknown
   function responses, artifact runtime routing, direct invoke behavior,
   PartitionDO SQL/OCC behavior, executor-http, protocol schemas, and
   `ValidatorJson` semantics.
5. Validate typed request-shaping channels directly, then preserve HTTP adapter
   mapping with focused public Worker invoke tests.

Completed Goal 179 slice:

1. Add typed invoke query planning failures for missing `withIndex`, unknown
   indexes, invalid index ranges, and non-unique `unique()` results.
2. Add named Effect helpers for requiring an index, resolving active index
   metadata, deriving index bounds, and validating unique query result count.
3. Keep the existing query Promise API as the compatibility adapter mapping
   typed query planning failures to the same `HttpError` statuses and messages.
4. Preserve SingleShardTransaction, PartitionDO SQL/OCC behavior,
   `tx.queryIndexPage(...)`, document placement validation, mutation commit
   behavior, public Worker route decoding, artifact runtime routing, execution
   sessions, deployment routes, protocol schemas, and `ValidatorJson`
   semantics.
5. Validate typed query planning failure channels directly, then preserve
   existing invoke runtime behavior with focused tests.

Completed Goal 178 slice:

1. Add typed invoke partition validation for missing partition metadata,
   create-root route conflicts, partition table placement mismatches,
   partition field/selector mismatches, invalid partition arguments,
   partitionKey mismatches, invalid create-root preallocated ids, and
   create-root caller-supplied partition keys.
2. Add named Effect helpers for function execution-scope resolution,
   create-root scope resolution, partition policy validation, and partition key
   extraction from args.
3. Keep `resolveFunctionExecutionScope(...)` and existing direct invoke /
   `ExecutionDO` callers as compatibility adapters mapping typed failures to
   the same `HttpError` statuses and messages.
4. Preserve SingleShardTransaction, PartitionDO SQL/OCC behavior, query/index
   execution, mutation commit behavior, public Worker route decoding, artifact
   runtime routing, execution sessions, deployment routes, protocol schemas,
   and `ValidatorJson` semantics.
5. Validate typed partition failure channels directly, then preserve existing
   direct invoke and `ExecutionDO` behavior with focused tests.

Completed Goal 177 slice:

1. Add typed invoke document validation failures for table lookup, document id
   parsing, document table lookup, document id/table mismatch, document
   validator failures, document placement failures, query placement failures,
   and missing patch targets.
2. Add named Effect helpers for `tableForName`, `tableFromDocumentId`,
   document id/table validation, document validator checks, document placement
   checks, and query placement checks.
3. Keep the existing backend DB Promise API as the compatibility adapter that
   maps typed failures to the same `HttpError` statuses and messages.
4. Preserve `ValidatorJson` semantics, SingleShardTransaction, PartitionDO
   SQL/OCC behavior, query execution, mutation commit behavior, public Worker
   route decoding, artifact runtime routing, and execution sessions.
5. Validate typed document/table/placement failure channels directly, then
   preserve existing invoke runtime behavior with focused invoke tests.

Completed Goal 176 slice:

1. Add typed invoke validation failures for active metadata lookup, function
   lookup, unsupported function kind, metadata/handler kind mismatch, request
   kind mismatch, argument validation, and return validation.
2. Add `resolveInvokeFunctionForRequest(...)`, `validateInvokeArgumentsEffect(...)`,
   and `validateReturnEffect(...)` as named Effect helpers for the top-level
   invoke validation service boundary.
3. Keep `executeInvoke(...)` and `validateReturn(...)` as Promise/throwing
   compatibility adapters that map typed invoke failures to the same
   `HttpError` statuses and messages.
4. Preserve SingleShardTransaction, PartitionDO SQL/OCC behavior, function
   handler execution, public Worker route decoding, artifact runtime routing,
   execution sessions, protocol schemas, deployment routes, and
   `ValidatorJson` semantics.
5. Validate typed invoke failure channels directly, then preserve public
   invoke route and legacy Promise adapter behavior with focused tests.

Completed Goal 175 slice:

1. Route generated Deployment HttpApi read, start, finish, and abandon handler
   service-failure mapping through typed deployment failure response helpers
   instead of `deploymentFailureToHttpError(...)`.
2. Keep `deploymentHttpErrorTo*Response(...)` helpers for preserved HTTP
   adapter compatibility, but stop using them as the normal generated handler
   service-failure path.
3. Preserve not-found, bad-request, conflict, artifact/storage failure, and
   active-deployment storage response classes and body messages.
4. Keep DeploymentService/Store orchestration, SQL behavior, public Worker
   forwarding, protocol schemas, PartitionDO, executor-http, and
   `ValidatorJson` unchanged.
5. Validate direct typed failure mapping separately from preserved explicit
   `HttpError` status-to-response compatibility.

Completed Goal 174 slice:

1. Remove `HttpError` from the deployment generated-handler service failure
   union so `deploymentFailureToHttpError(...)` maps only typed deployment
   service/domain/storage failures.
2. Remove the legacy `HttpError(400)` compatibility catches from
   `decodeStartAnalyzedPushHandlerInput(...)`,
   `startAnalyzedPushHandlerInputFromPayload(...)`, and
   `DeploymentPushStore.finishPush(...)`.
3. Keep the generated Deployment HttpApi response helpers as the adapter HTTP
   mapping edge; they still convert produced `HttpError` values into protocol
   error response classes.
4. Preserve start-analyzed, finish, abandon, read-route, storage-failure, and
   validation-failure HTTP response bodies/statuses.
5. Keep DeploymentService orchestration, SQL behavior, public Worker routes,
   protocol schemas, PartitionDO, executor-http, and `ValidatorJson`
   unchanged.
6. Validate with focused deployment HTTP-boundary, generated-handler, and
   service tests plus backend/protocol gates and only the EffectTS quality
   checker reviewer.

Completed Goal 173 slice:

1. Add a shared non-throwing `parseValidatorJson(...)` result helper beside the
   compatibility `assertValidatorJson(...)` API.
2. Route `deployment/Validation.ts` validator metadata normalization through
   `parseValidatorJson(...)` so schema, function, and codegen validator
   metadata failures become `DeploymentValidationError` without catching a
   thrown `BackendValidationError`.
3. Preserve `assertValidatorJson(...)` throwing behavior for existing runtime
   validation callers and keep all validator metadata error messages unchanged.
4. Preserve `ValidatorJson` as the user document/function validation
   representation; do not replace it with Effect Schema.
5. Keep deployment route behavior, generated Deployment HttpApi handlers,
   DeploymentService/Store orchestration, SQL behavior, protocol schemas,
   PartitionDO, executor-http, and public Worker routes unchanged.
6. Add direct shared validation coverage for the result helper and compatibility
   wrapper plus focused deployment validation coverage.

Completed Goal 172 slice:

1. Add exported `ServiceBindingExecutionArtifactRuntime.invoke` Effect helper
   for backend-to-artifact-runtime invocation.
2. Route service-binding source-package loading, runtime `fetch(...)`, and
   response decoding through one typed Effect pipeline before the public
   Promise method maps failures at the adapter edge.
3. Model source-package load and runtime fetch failures as
   `ExecutionArtifactRuntimeOperationError` values while preserving runtime
   response failures as `ServiceBindingExecutionArtifactRuntimeResponseError`.
4. Preserve the existing `BackendExecutionArtifactRuntime.invoke(...)`
   Promise API, request URL, headers, source-package embedding toggle,
   response status/message mapping, artifact runtime service route behavior,
   public invoke routes, SchedulerDO, DeliveryDO, ConnectionDO, PartitionDO,
   executor-http, protocol schemas, and `ValidatorJson` unchanged.
5. Add direct typed failure-channel coverage for source-package load and
   runtime fetch failures, plus adapter-edge `HttpError` mapping coverage.

Completed Goal 171 slice:

1. Add exported Effect-returning decoders for the remaining executor-http
   live-query and maintenance POST bodies.
2. Route live-query rerun/delivery maintenance, subscription record/remove,
   connection touch/remove/cleanup, delivery claim/ack/failure/dead-letter,
   pending deployments, expired connection deployments, and stuck delivery
   scans through the decoder-based Effect adapter.
3. Keep the parser functions as compatibility internals while removing all
   route-handler use of the parser-backed adapter path.
4. Preserve authorization ordering, not-configured maintenance responses,
   malformed JSON `400`, validation `400`, executor operation error mapping,
   route paths, Elysia app shape, protocol schemas, and `ValidatorJson`
   unchanged.
5. Validate typed decoder success/failure channels directly, then preserve HTTP
   adapter mapping through the existing executor-http route tests.

Completed Goal 170 slice:

1. Add exported Effect-returning decoders for executor-http invoke lifecycle
   bodies: prepare, begin session, syscall, finish, abort, abort stale, and
   invoke-session maintenance.
2. Route those handlers through a decoder-based Effect adapter while keeping
   the parser-backed adapter path for routes outside this slice.
3. Preserve malformed JSON `400`, validation `400`, authorization ordering,
   executor operation error mapping, route paths, Elysia app shape, live-query
   routes, protocol schemas, and `ValidatorJson` unchanged.
4. Validate typed decoder success/failure channels directly, then preserve HTTP
   adapter mapping through the existing executor-http route tests.
5. Validate with `@flarex/executor-http` typecheck/test/build, backend/protocol
   compatibility gates as practical, and only the EffectTS quality checker
   reviewer.

Completed Goal 169 slice:

1. Replace generated application-worker invoke request JSON direct reads with a
   named `InvokeRequestJsonError` boundary.
2. Replace generated materializer internal request JSON direct reads with a
   named `InternalRequestJsonError` boundary.
3. Replace generated worker backend `response.json().catch(() => null)`
   fallbacks with explicit `readBackendResponseJson(...)` try/catch helpers
   while preserving the compatibility `null` fallback.
4. Preserve generated worker request payload contracts, backend response
   status/message mapping, artifact runtime invocation, PartitionDO SQL/OCC
   behavior, executor-http, protocol schemas, and `ValidatorJson` unchanged.
5. Validate with generated worker source/runtime coverage, materializer
   coverage, `flarex-dev` typecheck/build/tests, backend/protocol compatibility
   gates, and only the EffectTS quality checker reviewer.

Completed Goal 168 slice:

1. Add typed `DeploymentArtifactRefError` for execution-artifact ref
   generation failures.
2. Convert `DeploymentArtifacts.executionArtifactRefForSourcePackage(...)`
   from untyped `Effect.promise(...)` to `Effect.tryPromise(...)` with a
   source-owned tagged failure.
3. Propagate that failure through `DeploymentService.finishPush(...)` and map
   it at the deployment HTTP adapter edge as a storage-class `500` response.
4. Preserve push preflight lookup, finish storage behavior, rejected finish
   responses, generated worker source, PartitionDO SQL/OCC behavior,
   executor-http, protocol schemas, and `ValidatorJson` unchanged.
5. Validate with direct service failure coverage, HTTP mapping coverage,
   backend typecheck/build, protocol gates, focused deployment tests, and only
   the EffectTS quality checker reviewer.

Completed Goal 167 slice:

1. Add shared typed `DevResponseJsonError`,
   `readDevResponseJsonEffect(...)`, and
   `readDevResponseJsonOrNullEffect(...)` in `flarex-dev`.
2. Route HTTP backend push/analyzer/finish, execution artifact analysis/invoke,
   and local materialized artifact response body reads through the shared dev
   response boundary.
3. Preserve malformed response bodies as `null` for existing non-JSON failure
   behavior, status fallback messages, diagnostics extraction, local finish
   response mapping, execution artifact response mapping, and materialized
   artifact response mapping.
4. Preserve backend runtime response boundaries, generated worker source,
   deployment runtime artifact-ref generation, PartitionDO SQL/OCC behavior,
   executor-http, protocol schemas, and `ValidatorJson` unchanged.
5. Validate with shared dev response-boundary tests, focused `flarex-dev`
   response decoder coverage, backend/protocol compatibility gates as
   practical, and only the EffectTS quality checker reviewer.

Completed Goal 166 slice:

1. Add shared typed `ResponseJsonError`, `readResponseJsonEffect(...)`, and
   `readResponseJsonOrNullEffect(...)` in the backend HTTP boundary module.
2. Route backend analyzer, artifact runtime service-binding, live-query
   delivery, scheduler response, and partition transaction response body reads
   through the shared boundary.
3. Preserve malformed response bodies as `null` for existing error-body
   behavior, non-OK status/message mapping, Scheduler/Delivery/Partition
   response error shapes, and artifact runtime response mapping.
4. Preserve PartitionDO route execution, deployment runtime artifact-ref
   generation, flarex-dev local runtime response readers, executor-http,
   protocol schemas, and `ValidatorJson` unchanged.
5. Validate with shared response-boundary tests, focused response decoder
   coverage, backend typecheck/build, broad protocol/backend gates as
   practical, and only the EffectTS quality checker reviewer.

Completed Goal 165 slice:

1. Add typed `SchedulerRouteOperationError` failures for `SchedulerDO`
   delivery reconcile, connection reconcile, dead-letter deliveries, cleanup
   connections, rerun subscriptions, and the three continuation routes.
2. Convert `SchedulerDO.fetch()` scheduler route handlers to run one Effect
   pipeline per route and map typed request and operation failures at the
   Durable Object adapter edge.
3. Convert post-decode scheduler route work from `Effect.promise(...)` to
   `Effect.tryPromise(...)` operation failures while preserving malformed JSON
   `400`, scheduler route validation `400`, successful reconcile/cleanup/rerun
   response bodies, continuation `{ skipped: true }` responses, retry alarm
   behavior, DeliveryDO wake fanout, ConnectionDO force-reconnect behavior, and
   scheduler response decoder behavior.
4. Preserve Worker public scheduler forwarding, DeliveryDO, ConnectionDO,
   ExecutionDO, PartitionDO, executor-http, protocol schemas, and
   `ValidatorJson` unchanged.
5. Validate with direct operation-error tests, focused scheduler route-boundary
   and sync coverage, backend typecheck/build, broad protocol/backend gates as
   practical, and only the EffectTS quality checker reviewer.

Completed Goal 164 slice:

1. Add typed `ExecutionRouteOperationError` failures for `ExecutionDO` start,
   syscall, and finish route operations.
2. Convert `ExecutionDO.fetch()` `/start`, `/syscall`, and `/finish` handlers
   to run one Effect pipeline per route and map typed request, protocol, and
   operation failures at the Durable Object adapter edge.
3. Convert post-decode start/syscall/finish route work from
   `Effect.promise(...)` to `Effect.tryPromise(...)` operation failures while
   preserving malformed JSON `400`, execution protocol validation `400`,
   active-session `409`, unknown-session `409`, transaction/session behavior,
   structured partition/OCC response bodies, and `invokeErrorResponse(...)`
   JSON response bodies.
4. Preserve public Worker forwarding, generated execution artifacts,
   PartitionDO, DeliveryDO, SchedulerDO, executor-http, protocol schemas, and
   `ValidatorJson` unchanged.
5. Validate with direct operation-error tests, focused execution
   route-boundary and invoke/transaction coverage, backend typecheck/build,
   broad protocol/backend gates as practical, and only the EffectTS quality
   checker reviewer.

Completed Goal 163 slice:

1. Add typed `DeliveryRouteOperationError` failures for `DeliveryDO` wake and
   pending-drain continuation route operations.
2. Convert `DeliveryDO.fetch()` `/wake` and `/continue` handlers to run one
   Effect pipeline per route and map typed request, operation, and structured
   drain failures at the Durable Object adapter edge.
3. Convert post-decode wake and continue route work from `Effect.promise(...)`
   to `Effect.tryPromise(...)` operation failures while preserving malformed
   JSON `400`, invalid envelope `400`, successful drain responses, structured
   `DeliveryDrainFailureError` JSON `500` bodies, retry alarm behavior, claim
   fanout and ack behavior.
4. Preserve ConnectionDO, SchedulerDO, PartitionDO, Worker routes,
   executor-http, protocol schemas, and `ValidatorJson` unchanged.
5. Validate with direct operation-error tests, focused delivery route-boundary
   and sync coverage, backend typecheck/build, broad protocol/backend gates as
   practical, and only the EffectTS quality checker reviewer.

Completed Goal 162 slice:

1. Add typed `ConnectionRouteOperationError` failures for `ConnectionDO`
   invalidation and live-query delivery route operations.
2. Convert `ConnectionDO.fetch()` `/invalidate` and `/deliver/live-query`
   handlers to run one Effect pipeline per route and map all typed failures at
   the Durable Object adapter edge.
3. Convert the post-decode invalidation and live-query delivery calls from
   `Effect.promise(...)` to `Effect.tryPromise(...)` operation failures while
   preserving request decoding, malformed JSON `400`, invalid envelope `400`,
   successful invalidation responses, live-query delivery skip accounting, and
   WebSocket transition behavior.
4. Preserve WebSocket upgrade, heartbeat, force-reconnect, executor
   subscription calls, DeliveryDO, SchedulerDO, PartitionDO, Worker routes,
   executor-http, protocol schemas, and `ValidatorJson` unchanged.
5. Validate with direct operation-error tests, focused connection route-boundary
   and sync coverage, backend typecheck/build, broad protocol/backend gates as
   practical, and only the EffectTS quality checker reviewer.

Completed Goal 161 slice:

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
