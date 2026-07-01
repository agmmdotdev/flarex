# Deployment Analysis And Push

## Deployment Route Adapter HTTP Error Boundary

Previous completed checkpoint: `d497276` Validate deployment HttpApi responses with protocol effects.

What changed:

- Public deployment start, analyzed-start, finish, and abandon route
  compatibility helpers now convert protocol validation failures to 400
  `HttpError` values at the route adapter edge.
- Generated DeploymentDO route request forwarding now does the same for
  analyzed-start, finish, and abandon request bodies before passing canonical
  requests to the generated DeploymentApi handler.
- Direct route Effect decoders still expose typed
  `DeploymentProtocolValidationError` for route/service composition and direct
  tests.

Why it changed:

Deployment push route validation should remain typed while composing Effect
pipelines, but public and Durable Object adapters should not leak protocol
errors after invoking an HTTP mapper. This keeps user-visible 400 behavior
stable while making the route adapter boundary explicit.

Known limitations:

- This checkpoint does not alter push state transitions, active deployment
  activation, analyzer behavior, artifact storage, storage schema,
  DeploymentDO service behavior, PartitionDO SQL/OCC, or `ValidatorJson`.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
```

## Deployment HttpApi Response Protocol Effect Boundary

Previous completed checkpoint: `a661a14` Validate registry HttpApi responses with Effect.

What changed:

- Deployment response envelopes now have protocol-owned Effect decoders for
  health, error, active deployment, push status, and finish push responses.
- Generated `DeploymentApiHandlers` validates active deployment, push-status,
  and finish-push service results through the protocol Effect decoders before
  returning generated HttpApi success responses.
- Response shape failures stay typed as `DeploymentProtocolValidationError`
  until the handler maps them to the declared deployment storage-error
  response.

Why it changed:

Deployment push analysis and activation produce protocol-visible response
payloads. Those outputs should be checked at the same reusable protocol
boundary as request payloads, with the handler responsible only for final
HttpApi error conversion.

Known limitations:

- This checkpoint does not alter push state transitions, active deployment
  activation, artifact storage behavior, storage schema, route path matching,
  analyzer behavior, public finish artifact preflight, public invoke/execution
  dispatch, PartitionDO SQL/OCC, or `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
```

## Deployment Protocol Request Effect Decoders

Previous completed checkpoint: `ede61de` Add public invoke protocol effect decoder.

What changed:

- Start, analyzed-start, finish, and abandon deployment request payloads now
  have protocol-owned Effect decoders.
- Backend deployment request helpers use those decoders directly before
  normalizing public start source packages into backend-owned request shapes.
- Analyzed-start request invariants still run at the protocol boundary:
  source-package presence, diagnostics array shape, missing-analysis error
  requirement, no codegen without analysis, and no error with analysis.

Why it changed:

Deployment push ingress is where source packages and analyzer results become
backend runtime state. Request shape and wrapper invariants should fail in a
typed protocol channel before route adapters map them, instead of depending on
throwing parser calls wrapped in backend-local Effect helpers.

Known limitations:

- This checkpoint does not change DeploymentDO push lifecycle, deep deployment
  validation in `deployment/Validation.ts`, analyzer behavior, artifact
  storage, route path matching, public invoke/execution dispatch,
  PartitionDO SQL/OCC, executor-http, or `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/deploymentRequests.test.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
```

## Deployment Response Decoder Boundary

Previous completed checkpoint: `301924c` Type deployment metadata validation.

What changed:

- Generated Deployment HttpApi handler response validation for active
  deployment, push-status, and finish-push responses now uses direct Effect
  Schema decoding.
- Public finish-push artifact preflight now decodes the DeploymentDO
  push-status JSON response and push-status payload through named Effect
  helpers before checking artifact availability.
- Direct tests cover push-status response decoder success and both JSON and
  semantic failure channels.

Why it changed:

Push activation depends on trusted deployment responses: generated HttpApi
handlers must return protocol-valid payloads, and public finish-push preflight
must validate the stored analyzed push before artifact checks. These response
boundaries should fail in typed Effect channels instead of relying on throwing
protocol parser calls inside Effect pipelines.

Known limitations:

- This checkpoint does not alter push state transitions, active deployment
  activation, artifact storage behavior, storage schema, route path matching,
  analyzer behavior, public invoke/execution dispatch, PartitionDO SQL/OCC, or
  `ValidatorJson` semantics.

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

- Deployment schema, function metadata, combined analysis validation, and
  codegen-analysis validation now run through direct Effect decoders in
  `deployment/Validation.ts`.
- Shared leaf checks for table/index states, placement, function metadata,
  partition metadata, source positions, JSON values, validators, and
  partition/schema consistency now emit `DeploymentValidationError` through the
  typed channel.
- Compatibility wrappers remain for synchronous callers, but migrated Effect
  flows call the direct decoders without crossing back through those sync
  shims.

Why it changed:

Analyzer metadata becomes deployment authority for runtime routing, validation,
and push activation. These metadata checks should fail through the same typed
deployment validation channel as protocol and stored-row boundaries rather than
remaining result-first parser internals.

Known limitations:

- This checkpoint does not alter push state transitions, active deployment
  activation, artifact availability checks, storage schema, route contracts,
  analyzer behavior, public invoke/execution dispatch, PartitionDO SQL/OCC, or
  `ValidatorJson` semantics.

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

- Source package, diagnostics, analyzed start-push request, and
  start-analyzed service-input validation now run through direct Effect
  decoder pipelines in `deployment/Validation.ts`.
- Compatibility helpers remain for synchronous callers, but no longer own a
  separate result-first implementation for these ingress paths.
- Typed tests cover malformed protocol source packages and codegen-analysis
  mismatches before adapter mapping.

Why it changed:

The deployment push lifecycle receives protocol payloads and analyzer output
before storing candidate deployment state. That ingress boundary should emit
typed `DeploymentValidationError` failures at source and let route/service
adapters map them, rather than relying on separate sync parser logic.

Known limitations:

- This checkpoint does not alter push state transitions, active deployment
  activation, artifact availability checks, storage schema, route contracts,
  stored push-row decoding, or analyzer behavior.
- Schema, functions, analysis, and codegen-analysis internals still keep
  compatibility normalizers beneath their Effect wrappers while the migration
  continues.

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

- Stored push-row materialization now goes through
  `decodePushStatusFromRow(...)` as a typed Effect pipeline.
- Stored `source_package_json`, `diagnostics_json`, `schema_json`,
  `functions_json`, and optional `codegen_analysis_json` parse failures now
  flow through `DeploymentValidationError` from the deployment validation
  boundary.
- `pushStatusFromRow(...)` and `parsePushStatusFromRow(...)` remain
  compatibility wrappers for synchronous callers and preflight-style result
  checks.

Why it changed:

Deployment analysis state becomes runtime authority only after it is read back
from DeploymentDO storage. The read-back path should preserve the same typed
validation semantics as request and service boundaries instead of relying on a
separate result-first parser implementation.

Known limitations:

- This checkpoint does not alter push state transitions, active deployment
  activation, artifact availability checks, storage schema, route contracts, or
  analyzer behavior.
- Other deployment validation helpers still keep compatibility normalizers
  beneath their Effect wrappers while the migration continues.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Deployment Store Validation Preflight Boundary

Previous completed checkpoint: `93250ea` Type public finish artifact lookup.

What changed:

- `deployment/Validation.ts` now exposes `parsePushStatusFromRow(...)` as a
  non-throwing `DeploymentValidationResult<PushStatus>` boundary while keeping
  `pushStatusFromRow(...)` as the compatibility throwing wrapper.
- DeploymentPushStore start, finish, and abandon writes now decode the push
  metadata before opening the write transaction, so malformed deployment
  metadata fails as `DeploymentValidationError` outside the SQL mutation path.
- Start-push and activated-finish write invariants still abort their
  transaction when the just-written or just-activated row is missing, preserving
  rollback behavior for storage consistency failures.

Why it changed:

Deployment-domain validation should not be thrown through `Effect.tryPromise`
and then reclassified by the SQL catch boundary. This checkpoint keeps
validation failures typed at the deployment validation/store boundary while
leaving true transaction rollback conditions as transaction aborts.

Convex source files inspected:

- None for this checkpoint. This is Flarex's DeploymentDO push-store
  validation and Cloudflare Durable Object SQL transaction boundary.

How Flarex differs from Convex:

- Flarex persists deployment push lifecycle rows in a Durable Object SQL store
  and validates deployment metadata when rows are loaded. Convex's deployment
  pipeline does not use this Cloudflare Durable Object push-store shape.

Known limitations:

- Compatibility throwing validation helpers remain for older call sites and
  tests.
- DeploymentDO service behavior, public deployment push routing, artifact
  persistence, protocol schemas, executor-http, PartitionDO SQL/OCC, and
  `ValidatorJson` behavior are unchanged.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Public Finish Artifact Lookup Effect Boundary

Previous completed checkpoint: `0c596a7` Own partition route decoders.

What changed:

- Public finish-push durable artifact preflight now checks
  `artifactStore.get(ref)` through `Effect.tryPromise(...)` instead of an
  untyped `Effect.promise(...)`.
- Artifact lookup failures are first mapped to `PublicWorkerDispatchError`,
  then intentionally recovered to the existing missing-artifact branch.
- Synchronous artifact-store lookup failures now follow the same typed Effect
  boundary and still produce the existing rejected finish response.

Why it changed:

The public finish-push Worker adapter already owned the artifact preflight, but
its artifact lookup used an untyped promise edge. This checkpoint keeps
artifact availability as Worker adapter behavior while ensuring lookup failures
cannot escape as defects before the existing `missing_artifact` response is
constructed.

Convex source files inspected:

- None for this checkpoint. This is Flarex's Cloudflare public Worker artifact
  durability preflight before DeploymentDO finish forwarding.

How Flarex differs from Convex:

- Flarex can require a generated execution artifact to exist in durable
  Cloudflare storage before public finish-push activation. Convex does not have
  this Worker-side deployment artifact preflight shape.

Known limitations:

- Missing artifact remains a `409` rejected finish response, preserving the
  existing public contract.
- DeploymentDO service/store behavior, artifact persistence, public deployment
  push routing, PartitionDO SQL/OCC, executor-http, protocol schemas, and
  `ValidatorJson` are unchanged.

Verification:

```sh
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicFinishArtifactBoundary.test.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts -t "public finish artifact boundary|requires durable artifact storage before public finish|rejects malformed finish push request bodies" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Public Worker Deployment Adapter Mapping

Previous completed checkpoint: `e809aa1 Own deployment route decoders`.

What changed:

- Public Worker deployment protocol failures now map through the Worker
  deployment adapter path instead of a top-level `fetch(...)` special case.
- The public Worker route Effect boundary now exposes `HttpError` at the
  top-level error channel for deployment route failures.
- Source-only start-push and finish-push delayed validation now call the
  decode-named public deployment route payload boundaries.
- Analyzer-disabled start pushes still return the preserved `501` response
  before validating the source package payload, and finish-push artifact
  preflight still runs before finish payload validation.

Why it changed:

The Effect migration quality bar asks HTTP response conversion to happen at
one adapter edge and migrated route paths to prefer decode-named Effect
boundaries. This checkpoint keeps deployment protocol errors typed inside the
deployment route flow, then converts them to `HttpError` at the public Worker
adapter edge instead of making the global Worker `fetch(...)` catch know about
deployment-specific protocol errors.

Convex source files inspected:

- None for this checkpoint. This is Flarex's Cloudflare public Worker adapter
  for deployment push routes.

How Flarex differs from Convex:

- Flarex has a Cloudflare Worker gateway that routes public deployment push
  requests into DeploymentDO and analyzer/artifact service bindings. Convex
  does not expose this Worker-level deployment adapter shape.

Known limitations:

- Compatibility parse wrappers remain in route-boundary modules for older
  callers and direct compatibility tests.
- DeploymentService/Store behavior, Durable Object SQL/OCC behavior, analyzer
  response semantics, artifact persistence, protocol schemas, executor-http,
  PartitionDO, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/push.test.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Deployment Route Decoder Ownership

Previous completed checkpoint: `fd9498f Share validator effect boundary`.

What changed:

- DeploymentDO HttpApi route payloads now expose decode-named Effect
  boundaries for analyzed-start, finish, and abandon payload validation.
- Public deployment push route payloads now expose decode-named Effect
  boundaries for start, analyzed-start, finish, and abandon payload validation.
- Migrated request decoders call those `decode*RoutePayload(...)` functions
  directly; parse-named Effect wrappers remain only for compatibility.
- The generated Deployment HttpApi analyzed-start handler now reuses the shared
  deployment protocol decoder instead of carrying a local parser `try/catch`.

Why it changed:

The Effect migration quality bar now requires migrated paths to prefer typed
`decode*` Effect boundaries and keep throwing or parse-named helpers behind
compatibility wrappers. This checkpoint removes a duplicated protocol parser
boundary and makes route decoder ownership explicit before the next fuller
route/service conversion.

Convex source files inspected:

- None for this checkpoint. This is Flarex's Cloudflare deployment route
  adapter boundary.

How Flarex differs from Convex:

- Flarex normalizes public Worker and DeploymentDO push requests through
  Cloudflare Request/HttpApi adapters before calling deployment service code.
  Convex does not have this generated HttpApi plus Durable Object forwarding
  shape.

Known limitations:

- Compatibility parse wrappers remain for older call sites and existing tests.
- DeploymentService/Store behavior, SQL/OCC behavior, analyzer behavior,
  artifact persistence, protocol schemas, executor-http, PartitionDO, and
  `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Deployment Generated Handler Tagged Failure Recovery

Previous completed checkpoint: `5446548 Share registry request validation`.

What changed:

- Generated Deployment HttpApi read, start, finish, and abandon handler failure
  recovery now uses `Effect.catchTags(...)` instead of broad catch-all
  recovery.
- The existing typed deployment/protocol/storage/domain errors still map to the
  same declared generated-handler response classes at the HttpApi adapter edge.
- Tests now exercise the Effect failure channel directly for tag-specific
  generated-handler recovery.

Why it changed:

The Effect migration quality bar asks recovery logic to branch on typed tags
where possible. Deployment generated handlers already had typed failure unions;
this checkpoint makes that recovery explicit without changing service/store
behavior or SQL semantics.

Convex source files inspected:

- None for this checkpoint. This is Flarex's generated HttpApi adapter failure
  recovery boundary.

How Flarex differs from Convex:

- Flarex maps typed deployment service failures into Effect HttpApi response
  classes inside the Worker/Durable Object adapter. Convex does not have this
  Cloudflare-specific generated HttpApi adapter layer.

Known limitations:

- The preserved `deploymentHttpErrorTo*Response(...)` compatibility helpers
  remain for legacy explicit `HttpError` status mapping tests.
- DeploymentService/Store orchestration, SQL behavior, request payload
  decoders, public Worker routes, protocol schemas, PartitionDO, executor-http,
  and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Deployment Activation Metadata Write Boundary

Previous completed checkpoint: `43efc4e Preserve deployment HttpApi protocol validation errors`.

What changed:

- `DeploymentPushStore.finishPush(...)` activation writes no longer call
  `validateSchema(...)` or `validateFunctions(...)` before writing schema,
  index, and function rows.
- Activation writes now use the already decoded `PushStatus.analysis` metadata
  from the stored-push row boundary.
- Stored push row corruption still fails through the existing typed
  `DeploymentValidationError` path before activation rows are written.
- The SQL row shapes for tables, indexes, functions, active push metadata, and
  finish responses are unchanged.

Why it changed:

Deployment activation already re-reads the push row and normalizes it through
the stored-push validation boundary before writing active schema and function
metadata. Re-running the schema and function compatibility validators inside
the write helpers was a duplicate throw path. This checkpoint keeps validation
at the row boundary and leaves activation write helpers responsible only for
persisting typed metadata.

Convex source files inspected:

- None for this checkpoint. This is Flarex's Durable Object deployment
  activation write boundary.

How Flarex differs from Convex:

- Flarex activation writes deployment schema/function metadata into Durable
  Object SQLite tables and active metadata records. Convex deployment metadata
  activation is not represented as this Cloudflare-specific SQL write path.

Known limitations:

- Transaction-local stored-row rechecks still use the compatibility
  `pushStatusFromRow(...)` wrapper so the transaction aborts on missing or
  corrupt rows.
- Start, finish, and abandon transaction callbacks still use the current
  Cloudflare Durable Object transaction callback shape.
- Deployment service behavior, SQL schema, analyzer behavior, artifact
  persistence, public Worker forwarding, protocol schemas, executor-http, and
  `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentValidation.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/push.test.ts -t "preserves analyzer codegen analysis through source-only push activation|requires durable artifact storage before public finish|does not activate failed or unknown pushes" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Analyzed Start Push Protocol Validation Boundary

Previous completed checkpoint: `bd51608 Type public deployment push dispatch boundary`.

What changed:

- The DeploymentDO analyzed-start HttpApi handler now preserves
  `DeploymentProtocolValidationError` from the deployment protocol parser
  instead of converting it into `DeploymentValidationError`.
- Deployment metadata validation after protocol parsing still flows through
  `deployment/Validation.ts` and emits `DeploymentValidationError`.
- The start-push HttpApi adapter maps both protocol payload failures and
  deployment-domain validation failures to the same declared 400 response body,
  preserving public behavior while keeping source errors typed internally.
- Handler tests now assert the typed split between protocol payload errors and
  deployment validation errors.

Why it changed:

Analyzed deployment push activation is the handoff from protocol transport
shape into Flarex deployment metadata normalization. Keeping protocol parser
failures tagged at their source makes the Effect migration closer to the target
shape: protocol, domain validation, service, and adapter mapping each own their
own failure boundary.

Convex source files inspected:

- None for this checkpoint. This is Flarex's deployment push analysis boundary
  around backend-controlled analyzer payloads.

How Flarex differs from Convex:

- Flarex receives backend analyzer output through DeploymentDO HttpApi
  analyzed-start routes, then normalizes the metadata before storing the push in
  Durable Object SQLite. This Cloudflare-specific path has no direct Convex
  Durable Object equivalent.

Known limitations:

- Compatibility throwing helpers remain for current tests and older call sites.
- Store transaction callbacks still use compatibility validation wrappers for
  activation writes.
- Deployment service/store behavior, SQL schema, analyzer behavior, artifact
  persistence, public Worker forwarding, protocol schemas, executor-http, and
  `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentValidation.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts -t "DeploymentApiHandlers|deployment HttpApi route boundary|preserves analyzer codegen analysis through source-only push activation|requires durable artifact storage before public finish" --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Deployment Push Store Active Validation Boundary

Previous completed checkpoint: `3f4b4c6` Type public Worker route boundary.

What changed:

- `DeploymentPushStore.getPush(...)` now reads the SQL row separately from
  deployment validation and decodes the stored row through
  `decodePushStatusFromRow(...)` in the Effect channel.
- Active deployment reads now reuse that typed push-row decode path instead
  of catching thrown compatibility validation failures inside one broad SQL
  `try` block.
- Active execution artifact refs now decode through
  `Effect.fn("DeploymentPushStore.parseExecutionArtifactRef")`, preserving
  malformed active metadata as `DeploymentActiveDeploymentInvalidError`.
- Added direct store coverage for malformed active execution artifact refs.

Why it changed:

The deployment validation module already exposes Effect-returning decoders,
but the store read path still mixed SQL access, stored row normalization, and
active metadata parsing inside broad exception mapping. This checkpoint moves
the read/active validation boundary closer to the target Effect shape while
preserving transaction-local compatibility behavior for the SQL mutation
callbacks.

Convex source files inspected:

- None for this checkpoint. This is Flarex deployment push-store boundary
  cleanup around persisted Cloudflare Durable Object metadata.

How Flarex differs from Convex:

- Flarex stores deployment push and active metadata in Durable Object SQLite
  rows plus `meta` records. This checkpoint keeps that Cloudflare-specific
  storage shape but separates stored-data validation failures from SQL
  operation failures.

Known limitations:

- Transaction-local start/finish/abandon row rechecks still use compatibility
  validation wrappers inside the SQL transaction callback.
- Schema/function activation writes still validate through compatibility
  wrappers while the transaction-service extraction remains deferred.
- DeploymentDO generated HttpApi routes, public Worker forwarding,
  protocol schemas, executor-http, PartitionDO SQL/OCC behavior, and
  `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/push.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Public Worker Deployment Push Route Boundary

Previous completed checkpoint: `8b3c939 Type generated HttpApi DO adapters`.

What changed:

- The public Worker deployment push router now runs as a named
  `Effect.fn("Worker.routeDeploymentPush")` route boundary.
- Start, analyzed-start, read, finish, and abandon push branches delegate to
  the existing Effect-returning subroute helpers without nested
  `Effect.runPromise(...)` calls inside the push router.
- Missing push id, malformed JSON, deployment protocol validation, and dispatch
  failures are mapped once at the push-route adapter edge.

Why it changed:

The public deployment push subroutes had already been migrated to typed
Effect-returning helpers, but the wrapper router still ran each branch through
its own `Effect.runPromise(...)`. This checkpoint moves that orchestration into
one route Effect while preserving existing response behavior.

Known limitations:

- The Worker top-level dispatcher still has separate runtime edges for other
  route families.
- Source-package analysis, artifact persistence/preflight, generated
  DeploymentDO forwarding, deployment storage semantics, executor-http,
  PartitionDO SQL/OCC behavior, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicWorkerRoutePathBoundary.test.ts test/publicDeploymentPushRouteBoundary.test.ts
corepack pnpm --filter flarex-backend exec vitest run test/push.test.ts -t "keeps public start source-only|rejects malformed analyzed push request bodies|rejects malformed finish push request bodies|rejects malformed abandon push request bodies|abandons public push routes with encoded push IDs|reads active deployment and push status through public routes"
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Generated HttpApi Durable Object Adapter Boundary

Previous completed checkpoint: `7764fe2 Type scheduler dead-letter reconnect boundary`.

What changed:

- RegistryDO and DeploymentDO now route their generated HttpApi entrypoints
  through named Effect route services and one adapter runner per Durable
  Object.
- Malformed JSON and protocol validation failures stay in the typed route
  boundary channel until the adapter maps them to the existing `400` JSON
  responses.
- Generated HttpApi handler failures are wrapped as typed route operation
  failures and mapped once at the adapter edge.

Why it changed:

Goal 148 added typed request builders for the generated RegistryDO and
DeploymentDO HttpApi routes, but the Durable Object `fetch()` methods still
used local `Effect.runPromise(...).catch` control flow. This checkpoint
completes that adapter shape without changing generated handlers or service
layers.

Known limitations:

- Registry and deployment generated HttpApi handlers still own their declared
  response envelopes.
- Deployment push/storage semantics, public Worker forwarding, executor-http,
  PartitionDO SQL/OCC behavior, and `ValidatorJson` are unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/registryHttpApiRouteBoundary.test.ts test/deploymentHttpApiRouteBoundary.test.ts test/registryHttpApiHandlers.test.ts test/deploymentHttpApiHandlers.test.ts
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Deployment Stored Push Row Validation Boundary

Previous completed checkpoint: `af87f30 Type execution session errors`.

What changed:

- Added `decodePushStatusFromRow(...)` for typed stored push row validation.
- Stored push row state, source package JSON, analysis JSON,
  codegen-analysis JSON, and diagnostics JSON now fail with
  `DeploymentValidationError`.
- `DeploymentPushStore` and `DeploymentService` now preserve those validation
  failures instead of wrapping them as `DeploymentSqlError`.

Why it changed:

`deployment/Validation.ts` already owned deployment analysis normalization, but
stored push row reads still parsed JSON and called compatibility validators
directly. Corrupt persisted rows could therefore defect or be reclassified as
SQL failures. This checkpoint keeps stored deployment data validation in the
deployment validation boundary while leaving SQL operation failures in
`DeploymentSqlError`.

Known limitations:

- HttpApi read and abandon routes still expose storage-class responses for
  corrupt stored rows, preserving their existing response envelope.
- This does not change deployment protocol schemas, executor-http,
  PartitionDO SQL/OCC behavior, or `ValidatorJson`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentService.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
git diff --check
```

## Deployment Artifact Ref Effect Boundary

Previous completed checkpoint: `8990f06` Share dev response JSON reads.

What changed:

- Added typed `DeploymentArtifactRefError` for execution-artifact ref
  generation failures.
- `DeploymentArtifacts.executionArtifactRefForSourcePackage(...)` now uses
  `Effect.tryPromise(...)` instead of untyped `Effect.promise(...)`.
- `DeploymentService.finishPush(...)` propagates artifact-ref failures through
  its typed error channel before the deployment HTTP adapter maps them to a
  storage-class `500` response.

Why it changed:

Finish-push activation depends on creating an execution-artifact reference
after the preflight push lookup and before storage finalization. That async
runtime edge was the last non-Partition backend `Effect.promise(...)` hotspot.
Typing it keeps artifact generation failure source-owned and prevents it from
escaping as an untyped defect inside deployment service flow.

Known limitations:

- The actual artifact ref hashing implementation remains in `flarex/artifacts`.
- Generated worker source and local-dev generated response helpers remain
  separate follow-up surfaces.
- PartitionDO SQL/OCC behavior is unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Public Deployment Push Dispatch Effect Boundary

Previous completed checkpoint: `2871d1d` Type public scheduler dispatch
failures.

What changed:

- Public deployment push reads and mutations now route their downstream async
  edges through typed Worker dispatch failures.
- Source-only start push now types analyzer invocation, analyzed artifact
  persistence, and Deployment DO forwarding separately.
- Finish push now types artifact verification and Deployment DO forwarding
  separately while keeping the existing missing-artifact rejected finish
  response.
- Direct start-analyzed and abandon push forwarding now use typed dispatch
  failures after their existing request decoders.

Why it changed:

The public push route body boundary had already moved to Effect decoders, but
the subsequent service-binding and storage operations still defected on
failure. This checkpoint keeps decoded public deployment push routes in the
Effect error channel through the Worker adapter edge.

Known limitations and follow-up work:

- DeploymentDO push-state internals, generated HttpApi handlers, and analyzer
  response parsing remain separate migration surfaces.
- This does not replace deployment validation or user function validation with
  Effect Schema.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicWorkerRouteDispatchError.test.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Generated Worker Backend Response Boundary

Previous completed checkpoint: `5dd89f8` Type deployment artifact ref
failures.

What changed:

- Generated application worker source now uses named request and response JSON
  helpers before invoking backend functions or mapping backend response
  failures.
- Generated invoke request JSON failures now surface as a stable
  `InvokeRequestJsonError` message through the existing `400 { error }`
  adapter response.
- Generation tests assert the emitted worker includes and uses the helpers, and
  runtime coverage checks malformed invoke JSON.

Why it changed:

Deployment analysis produces generated Worker code that still had an anonymous
backend response JSON read. Naming that boundary keeps generated application
transport handling consistent with the package-local Effect response decoder
work while preserving generated API behavior.

Known limitations:

- Generated worker response payloads are still trusted after parsing.
- The public push/deployment route service migration remains separate.
- The emitted worker remains plain generated Worker code and does not import
  Effect.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-dev/vitest.config.ts packages/flarex-dev/test/generate.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-dev test -- --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Backend Analyzer Response Effect Boundary

Previous completed checkpoint: `e726ae8` Type dev backend responses with
Effect.

What changed:

- Backend analyzer service responses now decode through
  `decodeBackendAnalyzerResponse(...)` before push-start turns them into an
  analyzed push payload.
- Analyzer failures become typed `BackendAnalyzerResponseError` values with
  normalized diagnostics before `analyzeSourcePackage(...)` maps them back to
  the existing failed push status shape.
- Added direct typed success/failure coverage for backend analyzer response
  decoding.

Why it changed:

Source-only push uses a service binding to ask an analyzer for deployment
metadata. That downstream response boundary was still manually reading JSON and
string-building failures inline in the Worker. The new decoder keeps analyzer
transport failures typed while preserving push lifecycle behavior.

Known limitations and follow-up work:

- Deployment validation and analyzed-start storage are unchanged.
- Successful analyzer response payloads still flow through the existing
  deployment validation path after decoding.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/artifactRuntime.test.ts packages/flarex-backend/test/transaction.test.ts packages/flarex-backend/test/push.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
git diff --check
```

## Backend Push Response Effect Boundaries

Previous completed checkpoint: `77c921a` Type materialized artifact responses
with Effect.

What changed:

- `HttpBackendSourceAnalyzer.analyze(...)` now reads backend analyzer responses
  through a named Effect decoder before running the existing codegen-analysis
  parser.
- `HttpBackendPushCoordinator.start(...)`, `finish(...)`, and `abandon(...)`
  now read backend push responses through named Effect decoders before running
  the existing push-status and finish-response parsers.
- `LocalBackendPushCoordinator.finish(...)` now uses a local finish response
  Effect decoder while preserving the legacy plain `Error` transport failure
  message.
- Added non-JSON transport failure tests for analyzer, push, and finish
  responses.

Why it changed:

Deployment analysis and push activation already had local typed parsers for
payload shapes, but the transport response body reads and status checks were
still duplicated around `response.json().catch(() => null)`. This checkpoint
keeps the parser contracts stable while moving response transport failures into
typed Effect boundaries.

Known limitations and follow-up work:

- This does not convert push status or codegen analysis parsing to Effect
  Schema yet.
- Backend deployment services, storage, generated HttpApi handlers, public
  Worker routes, and `ValidatorJson` remain unchanged.

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

## Deployment HttpApi Effect Request Builder

Previous completed checkpoint: `425de44` Route flarex dev bodies through
Effect.

What changed:

- `DeploymentDO.fetch()` now runs a named Effect request builder before
  dispatching to the generated DeploymentApi web handler.
- The request builder preserves read-route pass-through and canonicalizes
  analyzed-start, finish, and abandon push mutation bodies through existing
  typed deployment route decoders.
- Promise compatibility helpers remain available but now share the same
  request-builder path.

Why it changed:

The deployment push route bodies were already typed, but the generated
DeploymentApi adapter still used a Promise compatibility builder at the
Durable Object edge. This moves the full request-builder decision into the
Effect migration path while leaving deployment services and storage untouched.

Convex references inspected:

- None in this checkpoint. This is generated HttpApi adapter wiring around
  existing Flarex deployment push contracts.

Known limitations:

- This does not change backend deployment analysis, activation, storage, or
  public Worker push routes.
- Generated runtime-worker body reads remain separate follow-up work.

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

## Deployment Validation Result Normalization

Previous completed checkpoint: `29bcffb` Route public start push through Effect.

What changed:

- Deployment validation internals now use one typed
  `DeploymentValidationResult<A>` helper instead of several helper-specific
  result shapes and local throw wrappers.
- Throwing compatibility validators unwrap that shared result, while Effect
  decoders convert the same result to typed `DeploymentValidationError`
  failures.
- Added direct typed decoder coverage for schema, functions, analysis,
  codegen, source package, diagnostics, and start-push validation paths.
- Added representative generated start-handler HTTP mapping coverage and stored
  finish propagation coverage for grouped schema validation failures. Stored
  JSON rows cannot preserve JavaScript `undefined`, so stored tests cover the
  serialized validator-metadata branch while direct tests cover the JSON-value
  branch.

Why it changed:

The previous validation batches removed adapter-shaped `HttpError` from
deployment domain validation. This checkpoint continues that direction by
making the normalization helpers share one typed failure source, so Effect
decoders and compatibility wrappers cannot drift.

Known limitations and follow-up work:

- Execution, partition, delivery, and live-query public route groups still have
  compatibility reader paths to migrate. Public invoke and scheduler Worker
  route groups have since moved through typed Effect route boundaries.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-backend/test/deploymentService.test.ts --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Public Start Push Worker Effect Boundaries

Previous completed checkpoint: `187392e` Route public finish push through Effect.

What changed:

- Added a raw JSON Effect decoder for public source-only start-push bodies while
  keeping `readPublicStartPushJson(...)` as the compatibility Promise wrapper.
- Public source-only start-push now runs through an `Effect.fn` helper that
  preserves the existing ordering: read JSON first, return the analyzer
  configuration `501` response before protocol parsing when no analyzer exists,
  parse the protocol body only when an analyzer is configured, persist analyzed
  artifacts, and forward to the generated DeploymentApi analyzed-start route.
- Public analyzed-start forwarding now runs through an `Effect.fn` helper using
  `decodePublicAnalyzedStartPushRequest(...)` before forwarding to the generated
  DeploymentApi route.

Why it changed:

These were the remaining public deployment push entrypoints still crossing
through compatibility Promise wrappers in the Worker. This checkpoint moves
them to the typed Effect route-boundary shape while preserving public response
semantics and analyzer behavior.

Known limitations and follow-up work:

- Other non-deployment public Worker route groups still use compatibility
  readers and can be migrated in later route-boundary batches.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts -t "public deployment push route boundary|keeps public start source-only|rejects malformed analyzed push request bodies|rejects malformed source-only push bodies|preserves analyzer codegen"
git diff --check
```

## Public Finish Push Worker Effect Boundary

Previous completed checkpoint: `36cc6fb` Route public abandon push through Effect.

What changed:

- Added a raw JSON Effect decoder for public finish-push bodies while keeping
  `readPublicFinishPushJson(...)` as the compatibility Promise wrapper.
- The public Worker finish-push route now runs through an `Effect.fn` helper
  that preserves the existing ordering: read JSON first, run missing-artifact
  preflight second, then parse the finish-push protocol body only when the
  preflight allows activation to continue.
- Public HTTP behavior is preserved: malformed JSON still maps to `400`,
  missing artifacts still return the existing `409` rejection even when the body
  has invalid protocol fields, and protocol validation failures still map
  through the Worker adapter response path.

Why it changed:

Finish-push was the remaining deployment push route with a deliberate raw-body
preflight before protocol parsing. This checkpoint moves that path to the
Effect target shape without changing that behavior-sensitive ordering.

Known limitations and follow-up work:

- Public start-push and analyzed-start Worker forwarding still use compatibility
  Promise wrappers and should be migrated in a later grouped route-boundary
  slice.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts -t "public deployment push route boundary|requires durable artifact storage|rejects malformed finish request bodies|does not activate failed or unknown pushes"
git diff --check
```

## Public Abandon Push Worker Effect Boundary

Previous completed checkpoint: `bfb948b` Type deployment validation boundary batch.

What changed:

- The public Worker abandon-push route now uses an explicit Effect boundary that
  decodes `decodePublicAbandonPushRequest(...)`, maps typed route JSON failures
  through the public deployment route mapper, and forwards the normalized body to
  the generated DeploymentApi abandon route.
- The compatibility `readPublicAbandonPushRequest(...)` wrapper remains in place
  for existing callers and tests.
- Public HTTP behavior is preserved: malformed JSON still maps to the existing
  `400` response envelope and deployment protocol validation failures still map
  through the Worker adapter response path.

Why it changed:

The public route boundary already exposed typed decoders, but the Worker
abandon route still crossed through the Promise/throw compatibility wrapper.
This checkpoint moves that route path closer to the Effect target shape while
preserving response semantics.

Known limitations and follow-up work:

- Finish-push still keeps a raw JSON read before protocol parsing because its
  missing-artifact preflight intentionally runs before body protocol validation.
  A later slice should convert that preflight and body parsing together.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/publicDeploymentPushRouteBoundary.test.ts packages/flarex-backend/test/push.test.ts -t "public deployment push route boundary|rejects malformed abandon request bodies|abandons analyzed pushes without activating them|normalizes abandon reasons|does not abandon activated or unknown pushes"
git diff --check
```

## Generated Deployment Handler Input Effect Decoder

Previous completed checkpoint: `ced24a1` Type remaining deployment validation
failures.

What changed:

- Added Effect-returning deployment validation decoders for analyzed start-push
  request normalization and start-push service input validation.
- Switched the generated Deployment HttpApi analyzed-start handler to compose
  those decoders so the migrated route path exposes typed
  `DeploymentValidationError` failures instead of try/catch control flow.
- Kept `startAnalyzedPushHandlerInputFromPayload(...)` as a compatibility
  wrapper for existing callers and tests, preserving thrown
  `DeploymentValidationError` behavior and unchanged HTTP `400` response
  messages.
- This resumes the route/service migration direction after the larger
  validation batch: domain validation exposes Effect channels, while HTTP
  response conversion remains at the generated handler adapter edge.

Why it changed:

The generated analyzed-start route was already an Effect handler, but the input
conversion still crossed a throwing compatibility helper. This checkpoint moves
the handler path to typed Effect validation without changing public route
behavior or the old compatibility helper.

Convex source files inspected or used:

- None in this checkpoint. This preserves Flarex's existing deployment push
  semantics while continuing the typed Effect error migration.

Known limitations and follow-up work:

- The next route/service slices should repeat this pattern for remaining
  public and internal route boundaries that still expose throwing body/request
  parsers, then collapse HTTP response conversion to one adapter edge per route
  group.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run --config packages/flarex-backend/vitest.config.ts packages/flarex-backend/test/deploymentValidation.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Deployment HttpApi Direct Failure Response Mapping

Previous completed checkpoint: this commit, `Map deployment handler failures
directly`.

What changed:

- Generated Deployment HttpApi read, start, finish, and abandon handler
  failure mappers now convert typed deployment failures directly into declared
  protocol response classes.
- The generated handler path no longer converts normal typed service failures
  through `deploymentFailureToHttpError(...)` before choosing a response class.
- Explicit `deploymentHttpErrorTo*Response(...)` helpers remain for preserved
  HTTP adapter compatibility and status-to-response tests.

Why it changed:

The previous checkpoint removed `HttpError` from the deployment service failure
union, but generated handlers still rebuilt one as an intermediate mapping
step. Direct typed mapping keeps deployment service failures process-local and
leaves `HttpError` at actual HTTP adapter compatibility edges.

Preserved behavior:

- Bad-request, not-found, conflict, artifact/storage failure, and active
  deployment storage response classes and body messages are unchanged.
- DeploymentService/Store orchestration, SQL behavior, public Worker
  forwarding, protocol schemas, PartitionDO, executor-http, and
  `ValidatorJson` remain unchanged.

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

- `DeploymentServiceFailure` no longer includes adapter-shaped `HttpError`.
- `deploymentFailureToHttpError(...)` now maps only typed deployment
  service/domain/storage failures.
- Start-analyzed handler input decoding and finish-push activation no longer
  catch `HttpError(400)` as a compatibility validation path.

Why it changed:

The validation batch made deployment validation failures typed. Keeping
`HttpError` in the deployment service failure channel preserved an older adapter
shape inside the route/service path. This narrows the route/service boundary
toward typed failures with HTTP conversion at the generated handler adapter.

Preserved behavior:

- Start-analyzed bad requests, finish validation failures, abandon conflicts,
  not-found responses, and storage failures keep the same HTTP response bodies
  and statuses through generated handler tests.
- DeploymentService orchestration, SQL behavior, public Worker forwarding,
  protocol schemas, PartitionDO, executor-http, and `ValidatorJson` are
  unchanged.

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

- Added `parseValidatorJson(...)` as a result-returning parser for backend
  validator metadata.
- Kept `assertValidatorJson(...)` as the compatibility throwing wrapper, now
  backed by the same parser.
- `deployment/Validation.ts` no longer catches `BackendValidationError` to
  convert validator metadata failures into `DeploymentValidationError`; it
  receives those failures as parser results and maps them at the deployment
  validation boundary.

Why it changed:

The deployment validation module had already moved from adapter-shaped
`HttpError(400)` branches to `DeploymentValidationError`, but validator metadata
still crossed the boundary through a thrown backend validation exception. This
finishes that local domain-validation cleanup while preserving validator
semantics.

Preserved behavior:

- Existing validator metadata error messages and start-analyzed HTTP mappings
  are unchanged.
- DeploymentService/Store orchestration, generated handlers, SQL behavior,
  protocol schemas, public Worker routes, PartitionDO, executor-http, and
  `ValidatorJson` ownership are unchanged.

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
- Generated start-analyzed handler behavior is unchanged: newly typed
  validation failures still return `400` with the same messages.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored deployment validation so corrupt
  stored metadata remains a finish validation failure rather than a storage
  failure.
- This checkpoint adopts the larger-slice alignment requested for the migration:
  finish coherent validation boundaries in larger batches, then return to fuller
  route/service Effect conversions.

Why it changed:

`deployment/Validation.ts` is deployment domain code. Keeping adapter-shaped
`HttpError(400)` branches there forced later Effect pipelines to wrap legacy
throwing behavior. This batch completes the module-level typed validation
boundary while preserving adapter HTTP behavior.

Convex source files inspected or used:

- None in this checkpoint. This preserves Flarex's existing validation messages
  and contracts while continuing the typed Effect error migration.

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
  `HttpError(400)` when deployment schema shape metadata is invalid.
- Generated start-analyzed handler behavior is unchanged: non-object schemas,
  invalid versions, non-array tables/indexes, invalid table/index entries,
  duplicate ids, unknown index table references, invalid names, and invalid
  index fields still return `400` with the same messages.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored schema validation so corrupt stored
  schema metadata remains a finish validation failure rather than a storage
  failure.
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
  `ValidatorJson` are unchanged.

Why it changed:

Schema shape validation is part of deployment domain validation. Keeping it as
`HttpError(400)` made the domain validation layer depend on an adapter-shaped
error. This checkpoint moves those failures to `DeploymentValidationError` and
leaves HTTP conversion at the generated handler boundary.

Convex source files inspected or used:

- None in this checkpoint. This preserves Flarex's existing deployment schema
  semantics while continuing the typed Effect error migration.

Known limitations and follow-up work:

- Remaining schema state, placement, validator metadata, function metadata
  shape, source-position, route-policy, partition-policy, kind/visibility, and
  validator metadata branches still need typed validation conversion.
- The updated Effect migration quality bar also expects future route-boundary
  work to prefer Effect-returning decoders and typed body-read failures at the
  adapter edge.

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
  instead of raw `HttpError(400)` when deployment function partition metadata
  is incompatible with schema placement metadata.
- Generated start-analyzed handler behavior is unchanged: invalid partition
  table references, non-partitioned target tables, create-root partition
  mismatches, selector mismatches, missing required partition args, and
  route/partition argument mismatches still return `400` with the same
  messages.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored deployment analysis validation so
  corrupt stored partition metadata remains a finish validation failure rather
  than a storage failure.
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
  are unchanged.

Why it changed:

Function partition/schema compatibility is part of deployment domain validation.
Keeping it as `HttpError(400)` made the domain validation layer depend on an
adapter-shaped error. This checkpoint moves those failures to
`DeploymentValidationError` and leaves HTTP conversion at the generated handler
boundary.

Convex source files inspected or used:

- None in this checkpoint. This preserves Flarex's existing partition metadata
  semantics while continuing the typed Effect error migration.

Known limitations and follow-up work:

- Remaining schema state, placement, validator metadata, function metadata
  shape, source-position, route-policy, partition-policy, kind/visibility, and
  validator metadata branches still need typed validation conversion.
- The updated Effect migration quality bar also expects future route-boundary
  work to prefer Effect-returning decoders and typed body-read failures at the
  adapter edge.

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
  of raw `HttpError(400)` when a generated codegen function's kind,
  visibility, validators, partition metadata, or source position differ from
  the authoritative deployment function metadata.
- Generated start-analyzed handler behavior is unchanged: codegen metadata
  mismatches still return `400` with the same message.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen remains a finish validation failure rather than a storage failure.
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
  `ValidatorJson` are unchanged.

Why it changed:

Codegen/deployment metadata equality is part of deployment domain validation.
Keeping it as `HttpError(400)` made the domain layer depend on an adapter-shaped
error. This checkpoint moves that failure to `DeploymentValidationError` and
leaves HTTP conversion at the generated handler boundary.

Convex source files inspected or used:

- None in this checkpoint. This preserves the existing Flarex backend analysis
  contract while removing adapter error leakage from another validation branch.

Known limitations and follow-up work:

- Remaining schema, function metadata, source-position, route-policy,
  partition-policy, placement, kind/visibility, and validator metadata
  branches still need typed validation conversion.
- The updated Effect migration quality bar also expects future route-boundary
  work to prefer Effect-returning decoders and typed body-read failures at the
  adapter edge.

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
- Generated start-analyzed handler behavior is unchanged: incomplete codegen
  function coverage still returns `400` with the same message.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen remains a finish validation failure rather than a storage failure.
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
  execution routes, executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

Codegen coverage is part of deployment domain validation. Keeping it as
`HttpError(400)` made the domain layer depend on an adapter-shaped error. This
checkpoint moves that failure to `DeploymentValidationError` and leaves HTTP
conversion at the generated handler boundary.

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
- Generated start-analyzed handler behavior is unchanged: missing codegen
  function args validators still return `400` with the same message.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen remains a finish validation failure rather than a storage failure.
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
  are unchanged.

Why it changed:

Codegen function required-args validation is part of deployment domain
validation. Keeping it as `HttpError(400)` made the domain layer depend on an
adapter-shaped error. This checkpoint moves that failure to
`DeploymentValidationError` and leaves HTTP conversion at the generated handler
boundary.

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
- Generated start-analyzed handler behavior is unchanged: duplicate codegen
  function metadata paths still return `400` with the same message.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen remains a finish validation failure rather than a storage failure.
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
  executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

Duplicate codegen function path detection is part of deployment domain
validation. Keeping it as `HttpError(400)` made the domain layer depend on an
adapter-shaped error. This checkpoint moves that failure to
`DeploymentValidationError` and leaves HTTP conversion at the generated handler
boundary.

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
- Generated start-analyzed handler behavior is unchanged: codegen functions
  without deployment metadata still return `400` with the same message.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen remains a finish validation failure rather than a storage failure.
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
  routes, execution routes, executor-http routes, and `ValidatorJson` are
  unchanged.

Why it changed:

Codegen-to-deployment metadata consistency is part of deployment domain
validation. Keeping it as `HttpError(400)` made the domain layer depend on an
adapter-shaped error. This checkpoint moves that failure to
`DeploymentValidationError` and leaves HTTP conversion at the generated handler
boundary.

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
- Generated start-analyzed handler behavior is unchanged: invalid codegen
  function export names still return `400` with the same message.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen remains a finish validation failure rather than a storage failure.
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
  executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

Codegen function export-name validation is part of deployment domain
validation. Keeping it as `HttpError(400)` made the domain layer depend on an
adapter-shaped error. This checkpoint moves that failure to
`DeploymentValidationError` and leaves HTTP conversion at the generated handler
boundary.

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
- Generated start-analyzed handler behavior is unchanged: mismatched codegen
  function module names still return `400` with the same message.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen remains a finish validation failure rather than a storage failure.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  codegen module object validation, codegen moduleName validation, codegen
  module functions-array validation, duplicate codegen module validation,
  codegen function object validation, schema, function metadata, remaining
  codegen detail validation, abandon/active-deployment behavior, route-boundary
  JSON/protocol decoders, generated Deployment HttpApi routing, public Worker
  routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler
  routes, execution routes, executor-http routes, and `ValidatorJson` are
  unchanged.

Why it changed:

Codegen function module-name consistency is part of deployment domain
validation. Keeping it as `HttpError(400)` made the domain layer depend on an
adapter-shaped error. This checkpoint moves that failure to
`DeploymentValidationError` and leaves HTTP conversion at the generated handler
boundary.

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
- Generated start-analyzed handler behavior is unchanged: non-object codegen
  functions still return `400` with the same message.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen remains a finish validation failure rather than a storage failure.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  codegen module object validation, codegen moduleName validation, codegen
  module functions-array validation, duplicate codegen module validation,
  schema, function metadata, remaining codegen detail validation,
  abandon/active-deployment behavior, route-boundary JSON/protocol decoders,
  generated Deployment HttpApi routing, public Worker routes, `DeploymentDO`
  routing, SQL schema, protocol schemas, scheduler routes, execution routes,
  executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

Codegen function entry shape is part of deployment domain validation. Keeping it
as `HttpError(400)` made the domain layer depend on an adapter-shaped error.
This checkpoint moves that failure to `DeploymentValidationError` and leaves
HTTP conversion at the generated handler boundary.

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
- Generated start-analyzed handler behavior is unchanged: duplicate codegen
  modules still return `400` with the same message.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen remains a finish validation failure rather than a storage failure.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  codegen module object validation, codegen moduleName validation, codegen
  module functions-array validation, schema, function metadata, remaining
  codegen detail validation, abandon/active-deployment behavior,
  route-boundary JSON/protocol decoders, generated Deployment HttpApi routing,
  public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas,
  scheduler routes, execution routes, executor-http routes, and `ValidatorJson`
  are unchanged.

Why it changed:

Duplicate codegen module detection is part of deployment domain validation.
Keeping it as `HttpError(400)` made the domain layer depend on an
adapter-shaped error. This checkpoint moves that failure to
`DeploymentValidationError` and leaves HTTP conversion at the generated handler
boundary.

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
- Generated start-analyzed handler behavior is unchanged: non-array codegen
  module functions still return `400` with the same message.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen remains a finish validation failure rather than a storage failure.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  codegen module object validation, codegen moduleName validation, schema,
  function metadata, remaining codegen detail validation,
  abandon/active-deployment behavior, route-boundary JSON/protocol decoders,
  generated Deployment HttpApi routing, public Worker routes, `DeploymentDO`
  routing, SQL schema, protocol schemas, scheduler routes, execution routes,
  executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

Codegen module functions shape is part of deployment domain validation. Keeping
it as `HttpError(400)` made the domain layer depend on an adapter-shaped error.
This checkpoint moves that failure to `DeploymentValidationError` and leaves
HTTP conversion at the generated handler boundary.

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
- Generated start-analyzed handler behavior is unchanged: invalid codegen
  module names still return `400` with the same message.
- `DeploymentPushStore.finishPush(...)` continues to preserve already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen remains a finish validation failure rather than a storage failure.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  codegen module object validation, schema, function metadata, remaining
  codegen detail validation, abandon/active-deployment behavior,
  route-boundary JSON/protocol decoders, generated Deployment HttpApi routing,
  public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas,
  scheduler routes, execution routes, executor-http routes, and `ValidatorJson`
  are unchanged.

Why it changed:

Codegen module-name shape is part of deployment domain validation. Keeping it
as `HttpError(400)` made the domain layer depend on an adapter-shaped error.
This checkpoint moves that failure to `DeploymentValidationError` and leaves
HTTP conversion at the generated handler boundary.

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
- Generated start-analyzed handler behavior is unchanged: non-object codegen
  modules still return `400` with the same message.
- `DeploymentPushStore.finishPush(...)` preserves already-typed
  `DeploymentValidationError` from stored codegen validation so corrupt stored
  codegen remains a finish validation failure rather than a storage failure.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen schema-mismatch validation, codegen functions-array validation,
  schema, function metadata, remaining codegen detail validation,
  abandon/active-deployment behavior, route-boundary JSON/protocol decoders,
  generated Deployment HttpApi routing, public Worker routes, `DeploymentDO`
  routing, SQL schema, protocol schemas, scheduler routes, execution routes,
  executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

Codegen module entry shape is part of deployment domain validation. Keeping it
as `HttpError(400)` made the domain layer depend on an adapter-shaped error.
This checkpoint moves that failure to `DeploymentValidationError` and leaves
HTTP conversion at the generated handler boundary.

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
- Generated start-analyzed handler behavior is unchanged: mismatched codegen
  schema still returns `400` with the same message.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation,
  codegen functions-array validation, schema, function metadata, remaining
  codegen detail validation, finish/abandon/active-deployment behavior,
  route-boundary JSON/protocol decoders, generated Deployment HttpApi routing,
  public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas,
  scheduler routes, execution routes, executor-http routes, and `ValidatorJson`
  are unchanged.

Why it changed:

Codegen schema compatibility is part of deployment domain validation. Keeping it
as `HttpError(400)` made the domain layer depend on an adapter-shaped error.
This checkpoint moves that failure to `DeploymentValidationError` and leaves
HTTP conversion at the generated handler boundary.

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
- Generated start-analyzed handler behavior is unchanged: non-array codegen
  functions still return `400` with the same message.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, codegen object validation, schema,
  function metadata, remaining codegen detail validation,
  finish/abandon/active-deployment behavior, route-boundary JSON/protocol
  decoders, generated Deployment HttpApi routing, public Worker routes,
  `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes,
  execution routes, executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

The top-level codegen-functions shape check is part of deployment domain
validation. Keeping it as `HttpError(400)` made the domain layer depend on an
adapter-shaped error. This checkpoint moves that failure to
`DeploymentValidationError` and leaves HTTP conversion at the generated handler
boundary.

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
- Generated start-analyzed handler behavior is unchanged: non-object codegen
  analysis still returns `400` with the same message.
- Source-package validation, diagnostics validation, failed start-input
  validation, deployment analysis validation, schema, function metadata,
  codegen detail validation, finish/abandon/active-deployment behavior,
  route-boundary JSON/protocol decoders, generated Deployment HttpApi routing,
  public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas,
  scheduler routes, execution routes, executor-http routes, and `ValidatorJson`
  are unchanged.

Why it changed:

The top-level codegen-analysis shape check is part of deployment domain
validation. Keeping it as `HttpError(400)` made the domain layer depend on an
adapter-shaped error. This checkpoint moves that failure to
`DeploymentValidationError` and leaves HTTP conversion at the generated handler
boundary.

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
- Generated start-analyzed handler behavior is unchanged: non-object deployment
  analysis still returns `400` with the same message.
- Source-package validation, diagnostics validation, failed start-input
  validation, schema, function metadata, codegen validation,
  finish/abandon/active-deployment behavior, route-boundary JSON/protocol
  decoders, generated Deployment HttpApi routing, public Worker routes,
  `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes,
  execution routes, executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

The top-level deployment-analysis shape check is part of deployment domain
validation. Keeping it as `HttpError(400)` made the domain layer depend on an
adapter-shaped error. This checkpoint moves that failure to
`DeploymentValidationError` and leaves HTTP conversion at the generated handler
boundary.

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
- Generated start-analyzed handler behavior is unchanged: the missing-error
  branch still returns `400` with the same message.
- Source-package validation, diagnostics validation, analysis, codegen, schema,
  function metadata validation, finish/abandon/active-deployment behavior,
  route-boundary JSON/protocol decoders, generated Deployment HttpApi routing,
  public Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas,
  scheduler routes, execution routes, executor-http routes, and `ValidatorJson`
  are unchanged.

Why it changed:

The missing-error check is part of deployment start-input validation. Keeping it
as `HttpError(400)` made the domain layer depend on an adapter-shaped error.
This checkpoint moves that failure to `DeploymentValidationError` and leaves
HTTP conversion at the generated handler boundary.

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

- Added an Effect-returning diagnostics validation helper for direct typed
  success/failure channel coverage.
- `validateDiagnostics(...)` now emits `DeploymentValidationError` instead of
  raw `HttpError(400)` for diagnostics validation failures while keeping the
  current synchronous compatibility entrypoint.
- Generated start-analyzed handler behavior is unchanged: invalid diagnostics
  still return `400` with the same message.
- Source-package validation, analysis, codegen, schema, function metadata
  validation, finish/abandon/active-deployment behavior, route-boundary
  JSON/protocol decoders, generated Deployment HttpApi routing, public Worker
  routes, `DeploymentDO` routing, SQL schema, protocol schemas, scheduler
  routes, execution routes, executor-http routes, and `ValidatorJson` are
  unchanged.

Why it changed:

Push diagnostics validation is part of deployment domain validation. Keeping it
as `HttpError(400)` made the domain layer depend on an adapter-shaped error.
This checkpoint moves that failure to `DeploymentValidationError` and leaves
HTTP conversion at the generated handler boundary.

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

- Added an Effect-returning source-package validation helper for direct typed
  success/failure channel coverage.
- `validateSourcePackage(...)` now emits `DeploymentValidationError` instead of
  raw `HttpError(400)` for source-package validation failures while keeping the
  current synchronous compatibility entrypoint.
- Generated start-analyzed handler behavior is unchanged: invalid source
  packages still return `400` with the same message.
- Diagnostics, analysis, codegen, schema, function metadata validation,
  finish/abandon/active-deployment behavior, route-boundary JSON/protocol
  decoders, generated Deployment HttpApi routing, public Worker routes,
  `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes,
  execution routes, executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

Source-package validation is part of deployment domain validation. Keeping it as
`HttpError(400)` made the domain layer depend on an adapter-shaped error. This
checkpoint moves that failure to `DeploymentValidationError` and leaves HTTP
conversion at the generated handler boundary.

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
  `startAnalyzedPushHandlerInputFromPayload(...)` now map protocol and
  deployment validation failures to `DeploymentValidationError` instead of raw
  `HttpError(400)`.
- The Deployment HttpApi start failure mapper keeps validation typed until
  adapter conversion.
- Public start-analyzed behavior is unchanged: invalid payloads still return
  `400` with the same message, and generic storage failures still return
  `Deployment storage error.`.
- Finish/abandon/active-deployment behavior, route-boundary JSON/protocol
  decoders, generated Deployment HttpApi routing, public Worker routes,
  `DeploymentDO` routing, SQL schema, protocol schemas, scheduler routes,
  execution routes, executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

The generated Deployment HttpApi start-analyzed handler still used raw
`HttpError(400)` as an internal validation failure. This checkpoint keeps
handler-input validation in the typed Effect failure channel and leaves HTTP
status/body conversion at the adapter edge.

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

- Added `DeploymentValidationError` for deployment validation failures that are
  still exposed as preserved HTTP 400 responses at adapter edges.
- `DeploymentPushStore.finishPush(...)` now maps schema/function activation
  validation failures to `DeploymentValidationError` instead of raw
  `HttpError(400)`.
- `DeploymentService.finishPush(...)` and the Deployment HttpApi finish failure
  mapper keep validation failures typed until adapter conversion.
- Public finish behavior is unchanged: validation failures remain `400` with
  the same message, missing pushes still use `DeploymentPushNotFoundError`,
  rejected finish responses remain `FinishPushResponse` values, and generic
  storage failures remain `Deployment storage error.`.
- Start/abandon/active-deployment behavior, generated Deployment HttpApi
  handlers, public Worker routes, `DeploymentDO` routing, SQL schema, protocol
  schemas, scheduler routes, execution routes, executor-http routes, and
  `ValidatorJson` are unchanged.

Why it changed:

Finish activation was the remaining deployment service/store path that still
used raw `HttpError(400)` as an internal validation failure. This checkpoint
keeps validation typed in the Effect failure channel and preserves HTTP mapping
at the adapter edge.

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

- Added `DeploymentActiveDeploymentInvalidError` for invalid persisted active
  deployment metadata.
- `DeploymentPushStore.getActiveDeployment(...)` now reports missing active
  push rows, missing analyzed deployment metadata, missing execution artifact
  refs, and invalid stored artifact refs as that typed failure instead of raw
  `HttpError(500)`.
- `DeploymentService.getActiveDeployment(...)` and the Deployment HttpApi read
  failure mapper keep the failure typed until adapter conversion.
- HTTP read-route behavior is preserved through `deploymentFailureToHttpError`:
  no active deployment remains `404`, invalid active metadata keeps its
  specific `500` message, and generic storage failures remain
  `Deployment storage error.`.
- Finish/start/abandon behavior, generated Deployment HttpApi handlers, public
  Worker routes, `DeploymentDO` routing, SQL schema, protocol schemas,
  scheduler routes, execution routes, executor-http routes, and `ValidatorJson`
  are unchanged.

Why it changed:

Active deployment reads still leaked HTTP-shaped internal metadata failures
from the store. This checkpoint keeps persisted metadata validation typed in the
deployment boundary and leaves HTTP status/body conversion at the adapter edge.

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

- `DeploymentService.finishPush(...)` remains the public owner of missing-push
  preflight, returning `DeploymentPushNotFoundError` before artifact lookup or
  persistence.
- `DeploymentPushStore.finishPush(...)` no longer throws `HttpError(404)` when
  a prevalidated finish row disappears inside the persistence transaction.
  That condition is now reported as `DeploymentSqlError`.
- Existing finish rejection responses for invalid state and missing analysis
  remain `FinishPushResponse` values.
- Activation validation still preserves existing `HttpError(400, ...)`
  behavior for schema/function validation failures. Moving those validation
  errors to typed deployment failures is a later checkpoint.
- Generated Deployment HttpApi handlers, public Worker finish forwarding,
  `DeploymentDO` routing, SQL schema, start/abandon behavior, protocol schemas,
  scheduler routes, execution routes, executor-http routes, and `ValidatorJson`
  are unchanged.

Why it changed:

The finish service already performs the public missing-push preflight before
artifact lookup and storage. Keeping a second `HttpError(404)` business branch
inside the persistence transaction blurred service versus store ownership. This
checkpoint keeps the service-level public error typed and treats a missing
prevalidated row during storage as an internal storage invariant failure.

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

- `DeploymentService.abandonPush(...)` now exposes only typed deployment
  failures for abandon business decisions:
  `DeploymentPushNotFoundError`, `DeploymentPushInvalidStateError`, and
  `DeploymentSqlError`.
- `DeploymentPushStore.abandonPush(...)` now reports persistence failures as
  `DeploymentSqlError` only. It no longer throws `HttpError(404/409)` for
  abandon not-found or invalid-state decisions.
- `DeploymentService.abandonPush(...)` remains the owner of push lookup,
  typed not-found/invalid-state checks, controlled timestamp use, and reason
  defaulting/truncation before persistence.
- Generated Deployment HttpApi handlers, public Worker abandon forwarding, and
  `DeploymentDO` routing still map those typed failures to the existing HTTP
  response bodies and statuses.
- SQL schema, finish/start behavior, public deployment route paths, protocol
  schemas, scheduler routes, execution routes, executor-http routes, and
  `ValidatorJson` are unchanged.

Why it changed:

Abandon-push orchestration had already moved into `DeploymentService`, but the
store still carried HTTP-shaped business failures for abandon not-found and
invalid-state cases. This checkpoint finishes that part of the service
extraction by keeping domain decisions typed in the service and leaving HTTP
mapping at the adapter boundary.

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

## Deployment HttpApi Typed Decoder Adapter

Previous completed checkpoint: `0108eca` Add typed start route decoder.

What changed:

- Factored the duplicated typed decoder adapter mechanics for backend
  deployment HttpApi mutation routes into local helpers inside
  `HttpApiRouteBoundary.ts`.
- Start-analyzed, finish, and abandon still expose route-specific typed
  decoders and compatibility wrappers.
- `readJsonEffect(...)`, `RequestJsonError`, and
  `DeploymentProtocolValidationError` remain the typed transport/protocol
  failure channels for these routes.
- `DeploymentService.startAnalyzedPush`, `finishPush`, and `abandonPush`
  orchestration remains unchanged in the service layer.
- `DeploymentDO.fetch()`, DeploymentApi handlers, public Worker push routes,
  scheduler routes, execution routes, executor-http routes, and `ValidatorJson`
  are unchanged.

Why it changed:

The three deployment mutation routes now share the same Effect-typed transport
shape. This checkpoint removes duplicated adapter plumbing so future deployment
route migrations are less likely to diverge while keeping all behavior and
service ownership fixed.

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
  `parseDeploymentAnalyzedStartPushRouteRequestEffect(...)` to the backend
  deployment HttpApi route boundary.
- Added `readDeploymentAnalyzedStartPushRouteRequest(...)` and
  `parseDeploymentAnalyzedStartPushRouteRequest(...)` as compatibility
  wrappers.
- `POST /push/start-analyzed` now parses through the typed Effect decoder
  before constructing the canonical generated-handler request.
- Malformed JSON uses the typed `RequestJsonError` channel before the adapter
  maps it back to the preserved `400` response.
- The already-extracted `DeploymentService.startAnalyzedPush` orchestration
  remains unchanged: controlled clock, generated push id, source package,
  analysis/codegen/diagnostics normalization, and store mutation still live in
  the service/validation/store layer.
- `DeploymentDO.fetch()`, DeploymentApi handlers, finish/abandon routes,
  public Worker push routes, scheduler routes, execution routes, executor-http
  routes, and `ValidatorJson` are unchanged.

Why it changed:

After finish and abandon moved to typed transport decoding, start-analyzed was
the remaining backend deployment HttpApi mutation body using the compatibility
`readJson(...)` path. This checkpoint aligns it with the updated Effect quality
bar without moving start-push orchestration back into `DeploymentDO`.

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
  `parseDeploymentAbandonPushRouteRequestEffect(...)` to the backend
  deployment HttpApi route boundary.
- `POST /push/:pushId/abandon` now parses through the typed Effect decoder
  before constructing the canonical generated-handler request.
- Existing plain abandon read/parse helpers remain compatibility wrappers.
- Malformed JSON uses the typed `RequestJsonError` channel before the adapter
  maps it back to the preserved `400` response.
- The already-extracted `DeploymentService.abandonPush` orchestration remains
  unchanged: push lookup, invalid-state checks, reason normalization,
  timestamp acquisition, and store mutation still live in the service/store
  layer.
- `DeploymentDO.fetch()`, DeploymentApi handlers, finish/start push routes,
  public Worker push routes, scheduler routes, execution routes, executor-http
  routes, and `ValidatorJson` are unchanged.

Why it changed:

After the finish route introduced typed request-body decoding, abandon can use
the same transport boundary pattern. This keeps both backend push mutation
routes aligned with the updated Effect quality bar without moving abandon
orchestration back into `DeploymentDO`.

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

## Effect-Typed Deployment Route Boundary Target

The deployment push migration should now move from named plain parsers toward
Effect-typed transport boundaries.

Target shape:

- `DeploymentService.startAnalyzedPush`, `finishPush`, and `abandonPush` remain
  the orchestration owners.
- Deployment HttpApi route-boundary helpers should read JSON and decode
  protocol bodies through typed Effect errors, not plain `Promise` helpers that
  throw `HttpError` or `DeploymentProtocolValidationError`.
- Existing throwing protocol parsers can remain as compatibility wrappers while
  new migrated route code uses Effect decoders.
- `DeploymentDO.fetch()` or the generated web-handler adapter should perform
  the single conversion from typed Effect failures to the existing HTTP
  responses.
- Tests should verify typed route-boundary failure values and the preserved
  `400`/`409`/`500` HTTP behavior separately.

Next deployment proof slice:

1. Add a typed Effect JSON body reader in the backend package.
2. Convert deployment finish or abandon backend HttpApi route parsing to
   return `Effect.Effect<FinishPushRequest | AbandonPushRequest, ...>`.
3. Preserve generated handler request reconstruction and response compatibility.
4. Keep public Worker finish response-ordering invariants unchanged.

## Deployment HttpApi Finish Push Route Boundary

Previous completed checkpoint: `c0537a6` Extract deployment abandon route parser.

What changed:

- Added `decodeDeploymentFinishPushRouteRequest(...)` and
  `parseDeploymentFinishPushRouteRequestEffect(...)` to the backend deployment
  HttpApi route boundary.
- Added the shared `readJsonEffect(...)` / `RequestJsonError` backend body
  boundary used by the migrated finish route.
- `POST /push/:pushId/finish` now parses through the typed Effect decoder
  before constructing the canonical generated-handler request.
- Existing plain finish read/parse helpers remain compatibility wrappers.
- The already-extracted `DeploymentService.finishPush` orchestration remains
  unchanged: push lookup, execution artifact reference computation, timestamp
  acquisition, and store activation still live in the service/store layer.
- `DeploymentDO.fetch()`, DeploymentApi handlers, abandon/start push routes,
  public Worker push routes, scheduler routes, execution routes, executor-http
  routes, and `ValidatorJson` are unchanged.

Why it changed:

Finish-push activation is already behind `DeploymentService.finishPush`.
This checkpoint continues the migration by making the backend HttpApi
transport parse boundary for finish Effect-typed, matching the updated quality
bar without moving activation logic back into `DeploymentDO`.

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
  `parseDeploymentAbandonPushRouteRequest(...)` to the backend deployment
  HttpApi route boundary.
- `POST /push/:pushId/abandon` now parses through the named helpers before
  constructing the canonical generated-handler request.
- The already-extracted `DeploymentService.abandonPush` orchestration remains
  unchanged: push lookup, invalid-state checks, reason normalization,
  timestamp acquisition, and store mutation still live in the service/store
  layer.
- `DeploymentDO.fetch()`, DeploymentApi handlers, finish/start push routes,
  public Worker push routes, scheduler routes, execution routes, executor-http
  routes, and `ValidatorJson` are unchanged.

Why it changed:

The abandon-push service extraction is already present in the current code.
This checkpoint continues that migration by naming the backend HttpApi
transport parse boundary for abandon, matching the recent registry boundary
cleanup without moving orchestration back into `DeploymentDO`.

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

## Public Finish Push Raw Body Boundary

Previous completed checkpoint: `6644926` Decode public scheduler trigger bodies.

What changed:

- Added `readPublicFinishPushJson(...)` to
  `packages/flarex-backend/src/deployment/PublicPushRouteBoundary.ts`.
- `POST /deployments/:deploymentId/push/:pushId/finish` now reads public finish
  JSON through the deployment push route-boundary module instead of calling
  `readJson(...)` directly in `worker.ts`.
- The Worker still parses the finish protocol body only after the stored
  execution artifact preflight succeeds.
- `DeploymentService.finishPush`, DeploymentDO HTTP behavior, artifact
  reference computation, active-push activation semantics, source-only push
  analysis, start-analyzed, abandon, scheduler routes, partition routes,
  delivery routes, executor-http routes, and `ValidatorJson` are unchanged.

Why it changed:

The public finish route has a response-ordering invariant that differs from a
simple "decode then forward" boundary: malformed JSON must fail immediately,
but an invalid finish envelope can still produce the existing missing-artifact
`409` when the artifact preflight fails before protocol validation. This slice
moves the raw JSON read into the route-boundary owner without changing that
observable ordering.

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

## Public Source-Only Push Body Boundary

Previous completed checkpoint: `65dd151` Decode public deployment push bodies.

What changed:

- Added protocol parsing for the public source-only `POST /push/start` body.
- Kept the route's existing analyzer-not-configured priority: after valid JSON,
  the Worker still returns the explicit `501` before source-package schema
  validation when `FLAREX_ANALYZER` is absent.
- When an analyzer binding is configured, malformed source-only push bodies now
  fail at the public Worker protocol boundary before the analyzer request is
  sent.
- Analyzer response handling, artifact persistence, and internal
  `/push/start-analyzed` forwarding are unchanged.

Why it changed:

The source-only push route was the last public deployment-push mutation still
using an unchecked request-body cast. Adding the parser here completes the
public push body boundary without expanding into analyzer output semantics or
DeploymentDO storage behavior.

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

## Public Deployment Push Body Boundary

Previous completed checkpoint: `e81a139` Route registry through HttpApi.

What changed:

- Added a backend public deployment-push route-boundary helper for Worker
  forwarding.
- Public `start-analyzed`, `finish`, and `abandon` push bodies now decode
  through `flarex-protocol/deployment` parsers before being forwarded to
  DeploymentDO.
- Public Worker handling maps deployment protocol parser failures to the same
  400 `{ error: string }` envelope that DeploymentDO already returns.
- Source-only push analysis, analyzer response handling, artifact preflight,
  DeploymentDO internal generated-handler routing, and push lifecycle storage
  behavior are unchanged.

Why it changed:

DeploymentDO now owns a generated HttpApi handler, but the public Worker still
used unchecked `readJson<T>` casts before forwarding deployment mutation bodies.
This checkpoint makes the public edge schema-first while keeping the object
boundary's existing compatibility parse in place.

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

## Deployment HttpApi Route Boundary Cleanup

Previous completed checkpoint: `029cb28` Route deployment start through
HttpApi.

What changed:

- Extracted the remaining `DeploymentDO` route matching and mutation
  compatibility pre-parse into a backend route-boundary helper.
- Kept `DeploymentDO.fetch()` focused on Durable Object ownership:
  storage/schema initialization, per-instance Effect layer and generated
  handler ownership, non-GET `/health` fallback, generic 404 fallback, and
  error wrapping.
- Preserved mutation body compatibility for analyzed start-push, finish-push,
  and abandon-push before the generated handler runs.
- Added focused route inventory tests for every DeploymentApi route and
  non-API fallback behavior.

Why it changed:

After all DeploymentApi routes moved to the generated handler, the remaining
plain code in `DeploymentDO.fetch()` was only compatibility routing. Extracting
that logic makes the generated-handler boundary explicit and gives the next
checkpoint a stable inventory before removing or changing compatibility parsing.

Convex references inspected:

- No new Convex source files were required. This is a local Flarex
  route-boundary cleanup after the DeploymentDO HttpApi wiring.

Flarex differences:

- Mutation routes still intentionally pre-parse bodies for existing public
  error messages even though the generated handler owns the service path.

Known limitations:

- This checkpoint does not remove compatibility pre-parse behavior.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/deploymentHttpApiRouteBoundary.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-protocol/test/deployment.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment HttpApi Analyzed Start Route Wiring

Previous completed checkpoint: `2d7cdf9` Route deployment finish through
HttpApi.

What changed:

- Routed compatible `POST /push/start-analyzed` traffic through the
  `DeploymentDO`-owned generated Deployment HttpApi web handler.
- Preserved the existing `DeploymentDO` malformed-body compatibility boundary:
  invalid JSON and wrapper-shape errors are still parsed with `readJson` plus
  `parseAnalyzedStartPushRequest` before the generated handler runs.
- Rebuilt a canonical JSON request for the generated handler after successful
  compatibility parsing, so `DeploymentApiHandlers.startAnalyzedPush` owns
  backend validation adaptation, service call, typed error mapping, and response
  protocol parsing.
- Removed the now-unused manual `ManagedRuntime` deployment service boundary
  from `DeploymentDO`.

Why it changed:

This is the last DeploymentDO route backed by the DeploymentApi contract. Moving
it through the generated handler completes the route-by-route DeploymentDO
HttpApi wiring while preserving existing public validation messages.

Convex references inspected:

- No new Convex source files were required. This is local to Flarex's
  DeploymentDO HTTP boundary.

Flarex differences:

- The public source-only start route still belongs to the worker/analyzer path;
  this checkpoint only changes the internal analyzed start route.

Known limitations:

- `DeploymentDO` still keeps a small compatibility pre-parse layer for mutation
  bodies so public error messages remain stable.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/push.test.ts -t "start"
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-protocol/test/deployment.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment HttpApi Finish Route Wiring

Previous completed checkpoint: `59882fb` Route deployment abandon through
HttpApi.

What changed:

- Routed compatible `POST /push/:pushId/finish` traffic through the
  `DeploymentDO`-owned generated Deployment HttpApi web handler.
- Preserved the existing `DeploymentDO` malformed-body compatibility boundary:
  invalid JSON and invalid finish request shapes are still parsed with
  `readJson` plus `parseFinishPushRequest` before the generated handler runs.
- Kept the public worker's execution-artifact availability preflight unchanged;
  only internal finish requests that pass that public preflight enter the
  generated handler.
- Rebuilt a canonical JSON request for the generated handler after successful
  compatibility parsing, so `DeploymentApiHandlers.finishPush` owns the service
  call, typed error mapping, response protocol parsing, and 200/409 success
  status encoding.
- Kept analyzed start-push on the existing plain router.

Why it changed:

Finish-push already has service-owned orchestration, protocol-owned request
shape validation, and a declared 409 success schema for rejected finishes.
Routing it after the compatibility body parse moves another mutation onto
HttpApi without changing public artifact preflight or rejected-response
semantics.

Convex references inspected:

- No new Convex source files were required. This is local to Flarex's
  Durable Object deployment push state machine.

Flarex differences:

- Artifact availability remains a public worker preflight because it depends on
  deployment artifact storage outside the DeploymentDO service layer.

Known limitations:

- Analyzed start-push still uses the plain router.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/push.test.ts -t "finish"
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-protocol/test/deployment.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment HttpApi Abandon Route Wiring

Previous completed checkpoint: `489ae2e` Route deployment read paths through
HttpApi.

What changed:

- Routed compatible `POST /push/:pushId/abandon` traffic through the
  `DeploymentDO`-owned generated Deployment HttpApi web handler.
- Preserved the existing `DeploymentDO` malformed-body compatibility boundary:
  invalid JSON and invalid abandon request shapes are still parsed with
  `readJson` plus `parseAbandonPushRequest` before the generated handler runs.
- Rebuilt a canonical JSON request for the generated handler after successful
  compatibility parsing, so `DeploymentApiHandlers.abandonPush` owns the
  service call, typed error mapping, and response protocol parsing.
- Kept analyzed start-push and finish-push on the existing plain router.

Why it changed:

Abandon-push now has the smallest mutation surface: service orchestration,
typed errors, reason normalization, and route compatibility are already locked.
Routing it through the generated handler moves the migration beyond reads while
avoiding a body-parser behavior change.

Convex references inspected:

- No new Convex source files were required. This remains a Flarex-specific
  Durable Object HTTP boundary migration.

Flarex differences:

- The generated handler does not yet own malformed body parsing for abandon,
  because preserving existing public messages is more important than removing
  the compatibility pre-parse in this slice.

Known limitations:

- Start-push and finish-push mutation routes still use the plain router.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/push.test.ts -t "abandon"
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-protocol/test/deployment.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Deployment HttpApi Read Route Wiring

Previous completed checkpoint: `a6b81ff` Tighten deployment abandon service
boundary.

What changed:

- Added a generated Deployment HttpApi web handler owned by each
  `DeploymentDO` instance.
- Routed only read-safe internal DeploymentDO paths through the generated
  handler in this slice: `GET /health`, `GET /deployment`, and
  `GET /push/:pushId`.
- Left analyzed start-push, finish-push, and abandon-push on the existing
  plain router so their body parsing, validation messages, status mapping, and
  worker forwarding semantics stay unchanged.
- Preserved the current method-insensitive non-GET `/health` behavior by
  keeping it on the plain response path.
- Added public route parity coverage for active deployment and push status
  reads.

Why it changed:

The Deployment HttpApi contract and backend handler layer are now covered by
focused tests. Routing the read paths first moves real Durable Object traffic
onto the generated handler while avoiding a simultaneous mutation/body-parser
semantic change.

Convex references inspected:

- No new Convex source files were required. This is a Flarex-specific
  incremental wiring step for the Cloudflare Durable Object HTTP boundary.

Flarex differences:

- Deployment mutations still use the existing plain router until their
  generated parser and status semantics are proven route by route.

Known limitations:

- This is not full DeploymentDO HttpApi replacement; mutation routes remain on
  the plain router in this checkpoint.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/push.test.ts -t "read"
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-protocol/test/deployment.test.ts
corepack pnpm --filter flarex-protocol build
corepack pnpm --filter flarex-protocol test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex-backend test
git diff --check
```

## Abandon Push Service Boundary Parity

Previous completed checkpoint: `33d23cd` Add deployment HttpApi web handler
factory.

What changed:

- Tightened the abandon-push boundary so `DeploymentDO.fetch()` parses the
  request body with `parseAbandonPushRequest` and passes the parsed request
  directly into `DeploymentService.abandonPush`.
- Kept `DeploymentService.abandonPush` as the owner of push lookup,
  not-found/invalid-state checks, controlled timestamp use, and reason
  defaulting/truncation.
- Kept `DeploymentPushStore.abandonPush` as the transaction-level SQL guard and
  write boundary.
- Mirrored the same direct payload flow in the Deployment HttpApi handler.
- Added route-level coverage for default and truncated abandon reasons.

Why it changed:

The service extraction already existed, but the route and generated handler
still re-shaped the optional reason field. Removing that last adaptation keeps
the HTTP layer smaller before Durable Object HttpApi wiring while preserving the
public behavior.

Convex references inspected:

- No new Convex source files were required. This is a Flarex-specific boundary
  cleanup around the existing Cloudflare deployment push state machine.

Flarex differences:

- Abandonment remains a Durable Object SQLite state transition. The generated
  HttpApi handler is still backend-only and is not yet wired into
  `DeploymentDO.fetch`.

Known limitations:

- This checkpoint does not route live Durable Object traffic through
  `HttpRouter.toWebHandler`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/push.test.ts -t "abandon"
node ./node_modules/vitest/vitest.mjs run packages/flarex-backend/test/deploymentService.test.ts packages/flarex-backend/test/deploymentHttpApiHandlers.test.ts packages/flarex-protocol/test/deployment.test.ts
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

- Moved finish response HTTP status selection into
  `deployment/HttpBoundary.ts`.
- Preserved `200` for activated finish responses and `409` for rejected finish
  responses.
- Added direct tests for the status mapping.

Why it changed:

The finish route now has protocol-owned request parsing and service-owned
activation orchestration. The remaining status mapping is HTTP-boundary logic,
so keeping it in the deployment boundary helper makes the route branch smaller
without changing behavior.

Convex references inspected:

- No new Convex source files were required. This is local to Flarex's
  deployment push HTTP boundary.

Flarex differences:

- This is not a protocol schema change and not a service/store orchestration
  change.
- Request-side deep `analysis` and `codegenAnalysis` decoding remains backend
  validation owned.

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

- Added a schema-first finish-push request contract to
  `flarex-protocol/deployment`.
- Converted `DeploymentDO` finish body parsing to `parseFinishPushRequest`.
- Added protocol and route coverage for malformed finish request bodies.

Why it changed:

Finish-push activation already lives behind `DeploymentService.finishPush`.
The remaining route-local gap was the unchecked request body cast. This keeps
the route HTTP boundary explicit while preserving the service/store behavior.

Convex references inspected:

- No new Convex source files were required. This is local to Flarex's
  deployment push route boundary.

Flarex differences:

- The optional `activate` field is protocol-validated but still ignored by the
  current service.
- Response-side finish parsing remains covered by `parseFinishPushResponse`.
- Request-side deep `analysis` and `codegenAnalysis` decoding remains backend
  validation owned.

Known limitations:

- This is not a service orchestration change and not an HttpApi migration.

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

- Extracted deployment storage bootstrap SQL into
  `deployment/StorageSchema.ts`.
- Removed table creation, migration guard methods, and schema-version seeding
  helpers from `DeploymentDO`.
- Added direct tests covering the storage initializer contract.

Why it changed:

After route and service boundary cleanup, the constructor still carried storage
schema details. Moving those details beside the deployment storage modules makes
the Durable Object boundary smaller without changing push behavior or service
orchestration.

Convex references inspected:

- No new Convex source files were required. This is local to Flarex's
  deployment storage bootstrap path.

Flarex differences:

- `DeploymentDO` still invokes initialization synchronously with its SQL handle.
- The deployment store still owns runtime reads/writes after initialization.
- Request-side deep `analysis` and `codegenAnalysis` decoding remains backend
  validation owned.

Known limitations:

- This is not a protocol schema change and not an HttpApi migration.
- Storage initialization may become layer-owned later, but this checkpoint only
  extracts the existing behavior.

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

- Centralized `DeploymentService.use(...)` in a private `DeploymentDO`
  route helper.
- Left JSON reading, protocol parsing, analyzed start-push request adaptation,
  finish status handling, and abandon body parsing in the route branches.
- Preserved the existing `runDeployment()` runtime boundary and typed
  failure-to-HTTP mapping.

Why it changed:

After the route bridge cleanup and HTTP-boundary extraction, repeated
`DeploymentService.use(...)` calls were the last bit of Effect plumbing mixed
into every deployment route branch. A tiny helper keeps the route code focused
on HTTP behavior while preserving the service boundary explicitly.

Convex references inspected:

- No new Convex source files were required. This is local to Flarex's
  deployment push route boundary.

Flarex differences:

- This is not a protocol schema change and not a service/store orchestration
  change.
- Request-side deep `analysis` and `codegenAnalysis` decoding remains backend
  validation owned.

Known limitations:

- Deployment storage schema initialization still lives in `DeploymentDO`.
- This is not an HttpApi migration.

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

- Extracted deployment service failure mapping from `DeploymentDO.runDeployment`
  into a small tested HTTP-boundary helper.
- Preserved exact active deployment, push-not-found, abandon invalid-state,
  `HttpError` passthrough, and storage failure messages.
- Left protocol request parsing and deep deployment validation untouched.

Why it changed:

The service/store split is now stable enough that the boundary from typed
Effect failures to HTTP errors should be its own narrow, testable contract.
This advances the Effect migration without moving JSON parsing, protocol
decoding, or deployment semantic validation.

Convex references inspected:

- No new Convex source files were required. This checkpoint is local to
  Flarex's deployment push HTTP boundary.

Flarex differences:

- Deployment service failures remain process-local typed failures until
  `DeploymentDO.runDeployment()` converts them to HTTP errors.
- Request-side deep `analysis` and `codegenAnalysis` decoding remains backend
  validation owned.

Known limitations:

- Route branches still call `DeploymentService.use(...)` directly.
- This is not an HttpApi migration and not a protocol schema expansion.

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

## Deep Request Decoding Decision

Previous completed checkpoint: `7baf8e0` Inline deployment route service
bridges.

What changed:

- Added protocol regression coverage proving `parseAnalyzedStartPushRequest`
  remains wrapper-oriented for deep `analysis` and `codegenAnalysis` request
  payloads.
- Added backend route regression coverage proving malformed direct request
  `analysis` and `codegenAnalysis` still return backend validation messages.
- Updated the migration proposal to keep deep request decoding out of the
  protocol parser for now.

Why it changed:

The backend validation layer owns user-facing deployment analysis diagnostics
and semantic cross-checks. Moving deep request decoding into the protocol
parser now would replace those exact `HttpError(400, ...)` messages with
generic protocol errors.

Convex references inspected:

- No new Convex source files were required. This is a Flarex deployment
  boundary decision around the analyzed-push route.

Flarex differences:

- Response parsing still validates deep deployment payloads through
  `flarex-protocol`.
- Request parsing remains split: protocol owns the route envelope, and backend
  validation owns deep deployment semantics.

Known limitations:

- `DeploymentDO.fetch()` still contains explicit deployment route branches.
- A later HttpApi spike must preserve this request/response boundary split or
  intentionally replace the backend messages with reviewed parity coverage.

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

## Deployment Route Bridge Cleanup

Previous completed checkpoint: `31971a4` Inline deployment start push route
bridge.

What changed:

- Inlined active deployment, push status, finish-push, and abandon-push service
  bridge methods into their route branches.
- Preserved the same protocol parsers, service methods, response status logic,
  and `runDeployment` runtime boundary.
- Kept finish-push JSON parsing in place to preserve malformed-body behavior.

Why it changed:

The remaining private route methods were pass-throughs after service/store
extraction. Inlining them keeps deployment route behavior explicit without
changing push semantics.

Convex references inspected:

- No new Convex source files were required. Existing roadmap entries continue
  to track Convex deploy phases; this checkpoint is Flarex's deployment route
  bridge cleanup.

Flarex differences:

- This is not a protocol package change and not a service/store change.

Known limitations:

- Deep protocol decoding of analysis/codegen remains a later decision.

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

## Start Push Route Bridge Cleanup

Previous completed checkpoint: `c053c93` Extract deployment start push input
validation.

What changed:

- Inlined the `DeploymentDO.startPush` method into the start-analyzed route.
- Preserved the same protocol parser, backend adapter, service method, and
  runtime boundary.
- Removed an unused deployment request type import from `DeploymentDO`.

Why it changed:

The method became a pass-through after the service input adapter moved to
`deployment/Validation.ts`. Inlining it keeps the route flow explicit without
changing deployment push behavior.

Convex references inspected:

- No new Convex source files were required. Existing roadmap entries continue
  to track Convex deploy phases; this checkpoint is Flarex's start-push route
  bridge cleanup.

Flarex differences:

- This is not a protocol package change and not a service/store change.

Known limitations:

- Deep protocol decoding of analysis/codegen remains a later decision.
- Other deployment route bridges are still private methods.

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

## Start Push Service Input Adapter

Previous completed checkpoint: `5e74840` Move deployment metadata access into
store.

What changed:

- Added `startAnalyzedPushInput` to normalize backend analyzed start-push
  requests into `DeploymentService.startAnalyzedPush` input.
- Moved source package validation, diagnostics normalization, analysis
  validation, generated codegen fallback, explicit codegen validation, and
  missing-error validation out of `DeploymentDO.startPush`.
- Preserved existing HTTP 400 validation messages and route behavior.
- Added direct tests for success, failure, fallback, and exact error behavior.

Why it changed:

The start-push request adapter is pure deployment validation logic. Keeping it
with the deployment validation module removes another behavioral branch from
the Durable Object while preserving the route and runtime boundary.

Convex references inspected:

- No new Convex source files were required. Existing roadmap entries continue
  to track Convex deploy phases; this checkpoint is Flarex's start-push
  service-input adapter boundary.

Flarex differences:

- This is not a protocol package change. `flarex-protocol` still owns wrapper
  parsing and backend validation still owns deep analysis/codegen checks.

Known limitations:

- Deep protocol decoding of analysis/codegen remains a later decision.
- `DeploymentDO.fetch()` still calls a private method before `runDeployment`.

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

## Store Owned Deployment Metadata

Previous completed checkpoint: `2d6c9c4` Move deployment schema application
into store.

What changed:

- Moved active deployment metadata reads and writes into
  `DeploymentPushStore`.
- Removed `setMeta` and `getMeta` from the deployment layer.
- Preserved metadata key names, serialized values, and active deployment
  response semantics.
- Updated direct store tests to exercise active metadata reads and finish-push
  metadata writes through fake SQL.

Why it changed:

Finish-push activation already owns push state, schema/function application,
and active deployment metadata updates. Keeping metadata SQL in the store
completes that storage boundary without changing HTTP routes or protocol
contracts.

Convex references inspected:

- No new Convex source files were required. Existing roadmap entries continue
  to track Convex deploy phases; this checkpoint is Flarex's store-owned
  deployment metadata boundary.

Flarex differences:

- Metadata reads and writes remain scoped to the current Durable Object SQLite
  instance.

Known limitations:

- `DeploymentDO` still owns deployment table creation and migration guards.
- Deep protocol decoding of analysis/codegen remains a later decision.

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

## Store Owned Activation Application

Previous completed checkpoint: `e739957` Move deployment push reads into
store.

What changed:

- Moved schema table/index application and function metadata application into
  `DeploymentPushStore.finishPush`.
- Removed `applySchema` and `applyFunctions` from the deployment layer.
- Preserved the existing validation helpers and exact activation SQL writes.
- Updated direct store tests to exercise activation application through the
  store-owned path.

Why it changed:

Finish-push activation already owns state transition and active deployment
metadata writes in the store. Moving schema/function application beside that
transaction keeps activation behavior together without changing HTTP routes or
protocol contracts.

Convex references inspected:

- No new Convex source files were required. Existing roadmap entries continue
  to track Convex deploy phases; this checkpoint is Flarex's store-owned
  activation application boundary.

Flarex differences:

- Activation writes remain scoped to the current Durable Object SQLite
  instance.

Known limitations:

- `setMeta` and `getMeta` still originate from `DeploymentDO`.
- Deep protocol decoding of analysis/codegen remains a later decision.

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

## Store Owned Push Reads

Previous completed checkpoint: `ce58f78` Extract deployment push row
normalization.

What changed:

- Moved push status SQL reads into `DeploymentPushStore`.
- Removed the `readPush` callback from the deployment layer.
- Preserved push row normalization through `pushStatusFromRow`.
- Updated direct store tests to exercise fake SQL rows through the real store
  read path.

Why it changed:

Push row normalization now lives outside the Durable Object. Moving the SQL
read into the store completes the narrow push-status read boundary without
changing route behavior or SQL schema.

Convex references inspected:

- No new Convex source files were required. Existing roadmap entries continue
  to track Convex deploy phases; this checkpoint is Flarex's store-owned push
  read boundary.

Flarex differences:

- Reads remain scoped to the current Durable Object SQLite instance.

Known limitations:

- Schema/function application and metadata callbacks still originate from
  `DeploymentDO`.
- Deep protocol decoding of analysis/codegen remains a later decision.

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

## Push Row Normalization

Previous completed checkpoint: `a5ff90c` Extract analyzed push adapter.

What changed:

- Moved stored push row normalization into `deployment/Validation.ts`.
- Moved generated codegen fallback construction out of `DeploymentDO`.
- Preserved push state parsing, source package parsing, analysis/codegen
  validation, diagnostics handling, error field handling, timestamps, and
  generated codegen ordering.
- Added direct tests for row normalization and generated fallback behavior.

Why it changed:

Deployment validation now owns request, metadata, and adapter normalization.
Stored push rows are the remaining pure normalization step before considering a
larger store-boundary change.

Convex references inspected:

- No new Convex source files were required. Existing roadmap entries continue
  to track Convex deploy phases; this checkpoint is Flarex's push-status read
  normalization boundary.

Flarex differences:

- SQL lookup remains in the Durable Object. This checkpoint does not move
  storage ownership.

Known limitations:

- `DeploymentPushStore` still calls back into `DeploymentDO` for push reads.
- Deep protocol decoding of analysis/codegen remains a later decision.

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

## Start Push Adapter

Previous completed checkpoint: `2e5f3dd` Extract deployment analysis
validators.

What changed:

- Moved analyzed start-push protocol-to-backend normalization into
  `deployment/Validation.ts`.
- Preserved valid analyzed push, failed analyzed push, diagnostics, optional
  `codegenAnalysis`, and defensive missing-error behavior.
- Kept `DeploymentDO.fetch()` as the route/protocol parsing boundary.
- Added direct adapter tests.

Why it changed:

The deployment validation module now owns source package, diagnostics,
analysis, and codegen validation. Moving the small adapter beside those
validators removes the last start-push normalization helper from the Durable
Object without changing route behavior.

Convex references inspected:

- No new Convex source files were required. Existing roadmap entries continue
  to track Convex deploy phases; this checkpoint is Flarex's start-push
  adapter boundary.

Flarex differences:

- This is not a protocol package move. `flarex-protocol` still owns wrapper
  schemas and parser errors.

Known limitations:

- Row normalization still lives in `DeploymentDO`.
- Deep protocol decoding of analysis/codegen remains a later decision.

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

## Analysis Codegen Validation

Previous completed checkpoint: `eb0dcc2` Extract deployment schema
validators.

What changed:

- Extracted `validateAnalysis` and `validateCodegenAnalysis` into
  `deployment/Validation.ts`.
- Preserved schema/function cross-validation, codegen schema matching,
  codegen module/function metadata validation, canonical comparison behavior,
  and existing HTTP 400 messages.
- Removed low-level codegen helper imports from `DeploymentDO`.
- Added direct tests for analysis/codegen normalization and exact error
  messages.

Why it changed:

The previous slice moved schema/function primitives. Moving analysis/codegen
validation as a unit completes the backend deployment validation module
without changing the route boundary or shared protocol parser behavior.

Convex references inspected:

- No new Convex source files were required. Existing roadmap entries continue
  to track Convex deploy phases; this checkpoint is Flarex's analysis/codegen
  validation boundary.

Flarex differences:

- Flarex still validates backend deployment metadata with `ValidatorJson`;
  this checkpoint does not replace it with Effect Schema.

Known limitations:

- `analyzedStartPushRequest` remains in `DeploymentDO` as the adapter from
  `flarex-protocol` wrapper classes to backend request shape.
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

## Schema Function Validation

Previous completed checkpoint: `3a257f3` Extract deployment request
validators.

What changed:

- Extracted schema/function validation primitives into
  `deployment/Validation.ts`.
- Preserved schema table/index defaults, function visibility defaults, route
  and partition policy parsing, validator metadata handling, and existing HTTP
  400 messages.
- Left `validateAnalysis` and `validateCodegenAnalysis` in `DeploymentDO` so
  cross-field analysis/codegen behavior stays unchanged.
- Added direct tests for schema/function normalization and exact error
  messages.

Why it changed:

After moving source-package and diagnostics validation, schema/function
validation is the next reusable layer. It shrinks the Durable Object without
mixing this checkpoint with deep codegen consistency checks.

Convex references inspected:

- No new Convex source files were required. Existing roadmap entries continue
  to track Convex deploy phases; this checkpoint is Flarex's schema/function
  validation boundary.

Flarex differences:

- Flarex still validates backend deployment metadata with `ValidatorJson`;
  this checkpoint does not replace it with Effect Schema.

Known limitations:

- `validateAnalysis`, `validateCodegenAnalysis`, and row normalization still
  live in `DeploymentDO`.
- The next validator slice should move analysis/codegen as a unit or reduce
  helper exports after proving exact-message parity.

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

## Source Package And Diagnostics Validation

Previous completed checkpoint: `64f1e75` Extract deployment error types.

What changed:

- Extracted source-package and push diagnostics validation into
  `deployment/Validation.ts`.
- Preserved source module sorting, function sorting, diagnostics truncation to
  the newest 100 entries, and existing HTTP 400 messages.
- Added direct tests for the moved helpers, alongside existing push route
  malformed-body tests.

Why it changed:

Start-push validation is the next area to move after the deployment service
and error boundaries. Source-package and diagnostics helpers are low-risk and
give the migration a validation module before moving analysis/codegen logic.

Convex references inspected:

- No new Convex source files were required. Existing roadmap entries continue
  to track Convex deploy phases; this checkpoint is Flarex's start-push
  validation cleanup.

Flarex differences:

- Deep deployment analysis and codegen checks remain backend implementation
  validation rather than shared protocol decoding.

Known limitations:

- `validateAnalysis`, `validateCodegenAnalysis`, schema/function validators,
  and row normalization still live in `DeploymentDO`.
- The next validator slice needs direct exact-message tests before moving
  cross-field schema/function logic.

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

## Deployment Error Module

Previous completed checkpoint: `566ddfa` Extract deployment push read service.

What changed:

- Extracted deployment push/active tagged errors from `DeploymentService` into
  `deployment/Errors.ts`.
- Preserved unknown-push, invalid-state, and no-active-deployment error tags
  and payload fields.
- Kept `DeploymentDO.runDeployment` responsible for converting those typed
  failures to the existing HTTP responses.

Why it changed:

The push state surface now uses the deployment service for start, finish,
abandon, active read, and single-push read. A dedicated typed error module is
the narrow cleanup needed before moving into validator extraction.

Convex references inspected:

- No new Convex source files were required. Existing roadmap entries continue
  to track Convex deploy phases; this checkpoint is Flarex's internal Effect
  error boundary cleanup.

Flarex differences:

- Error classes remain backend-local implementation types, not protocol
  response schemas.

Known limitations:

- Deeper analysis/codegen validation is intentionally unchanged.
- The next validator slice must preserve exact current failure messages.

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

## Push Status Read Service

Previous completed checkpoint: `a93b051` Extract active deployment service
read.

What changed:

- Extracted single-push status reads into `DeploymentService.getPush`.
- Preserved `GET /push/:id` response shape, decoded push ID handling, and the
  existing `404 Unknown push: <id>` behavior.
- Reused `DeploymentPushNotFoundError` for missing push reads and kept
  storage failures as typed `DeploymentSqlError`.
- Added service tests for successful push reads, typed not-found, and typed
  storage failure propagation.

Why it changed:

This completes the current deployment push-state route surface behind the
Effect service after push-start, finish, abandon, and active deployment reads.
It keeps the migration focused before moving into semantic validator or router
changes.

Convex references inspected:

- No new Convex source files were required. Existing roadmap entries continue
  to track Convex deploy phases; this checkpoint is the Flarex push-status
  read side of the current Cloudflare state machine.

Flarex differences:

- Flarex push status still comes from Durable Object SQLite through the
  existing row normalization callback. No global deployment repository is
  introduced.

Known limitations:

- Push row normalization still uses the existing callback into the Durable
  Object.
- Deeper analysis/codegen validation is intentionally unchanged.

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

## Active Deployment Read Service

Previous completed checkpoint: `b8c25b9` Extract deployment abandon service.

What changed:

- Extracted active deployment reads into
  `DeploymentService.getActiveDeployment`.
- Preserved `GET /deployment` response shape and the existing
  `404 No active deployment.` route behavior.
- Added typed no-active-deployment handling and kept corrupt active metadata
  errors as `HttpError` passthrough.
- Moved active push metadata reads, analyzed metadata checks, execution
  artifact ref validation, schema version extraction, and active response
  construction into the deployment service/store path.
- Added service/store tests for active read success, no-active typed failure,
  storage failure propagation, and corrupt metadata `HttpError` passthrough.

Why it changed:

Finish-push writes active deployment metadata; this slice moves the matching
read path behind the same Effect boundary. It keeps the state machine
incremental and avoids mixing this checkpoint with request validation or
HttpApi/router changes.

Convex references inspected:

- No new Convex source files were required. Existing roadmap entries continue
  to track Convex deploy phases; this checkpoint is the Flarex active
  deployment read side of the current Cloudflare state machine.

Flarex differences:

- Flarex active deployment status still comes from Durable Object SQLite and
  metadata callbacks. No global deployment service or cross-DO state owner is
  introduced.

Known limitations:

- Single-push `GET /push/:id` remains in `DeploymentDO`.
- Push row normalization still uses the existing callback into the Durable
  Object.
- Deeper analysis/codegen validation is intentionally unchanged.

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

## Abandon Push Deployment Service

Previous completed checkpoint: `42cccd5` Extract deployment finish service.

What changed:

- Extracted abandon-push orchestration into `DeploymentService.abandonPush`.
- Preserved the existing abandon route body parsing through
  `parseAbandonPushRequest` in `DeploymentDO.fetch`.
- Added typed not-found and invalid-state service failures, with
  `DeploymentDO.runDeployment` mapping them back to the existing 404/409
  abandon responses.
- Moved reason defaulting/truncation, timestamp acquisition, SQL abandoned
  update, transaction-level state guarding, and post-update push read into the
  deployment service/store path.
- Added service tests for success, reason normalization, not-found,
  invalid-state, abandon storage failure propagation, and store-level
  `HttpError` passthrough.

Why it changed:

Abandon-push is the smallest remaining push lifecycle write after push-start
and finish-push. Moving it now keeps the Effect migration incremental while
making the deployment service the owner of push write orchestration.

Convex references inspected:

- No new Convex source files were required. Existing roadmap entries continue
  to track Convex deploy phases; this checkpoint is a Flarex-specific
  extraction of the current Cloudflare state machine.

Flarex differences:

- Flarex abandonment is still a Durable Object SQLite state transition. The
  Effect service does not own global deployment state or change the public
  route contract.

Known limitations:

- Active deployment reads still live in `DeploymentDO`.
- Push status row normalization still uses the existing callback into the
  Durable Object.
- Deeper analysis/codegen validation is intentionally unchanged.

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

## Finish Push Deployment Service

Previous completed checkpoint: `224f097` Extract deployment push-start
service.

What changed:

- Extracted finish-push orchestration into `DeploymentService.finishPush`.
- Added service dependencies for push lookup, execution artifact ref creation,
  controlled timestamp access, and the activation transaction.
- Preserved `FinishPushResponse` behavior from the existing route: activated
  responses stay 200, rejected responses keep their codes/messages and remain
  409 at the HTTP boundary, and unknown pushes still map to 404.
- Preserved activation validation `HttpError` behavior so schema/function
  validation failures keep their original HTTP status/message instead of
  becoming storage failures.
- Kept schema/function activation and active deployment metadata writes inside
  one storage transaction through the Durable Object-backed store.
- Added service tests for successful activation, preserved rejection payloads,
  not-found preflight, typed finish storage failures, and activation
  `HttpError` passthrough.

Why it changed:

Finish-push is the state-machine step that makes a deployment active. After
push-start moved behind the service, activation is the next narrow slice that
proves Effect can own orchestration while the Durable Object keeps storage and
runtime mutation ownership.

Convex references inspected:

- No new Convex source files were required. Existing roadmap notes continue to
  track the broader deploy-analysis direction; this checkpoint is a Flarex
  service-extraction step over the current Cloudflare state machine.

Flarex differences:

- Flarex activates deployment state in a Cloudflare Durable Object and writes
  active metadata into DO storage. This differs from a central Convex backend
  service, so the Effect service remains per-DO and callback-based for this
  slice.

Known limitations:

- Finish request decoding is still minimal because the current body has no
  semantic fields.
- Abandon-push, active deployment reads, and semantic validator extraction are
  still future slices.
- The store reads the activated push through the existing `readPush` callback;
  row normalization has not yet moved into a standalone repository module.

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

## Push Start Deployment Service

Previous completed checkpoint: `bbdbec2` Add deployment analysis protocol
schemas.

What changed:

- Extracted analyzed push-start persistence into `DeploymentService` with
  `DeploymentClock`, `DeploymentIds`, and `DeploymentPushStore` dependencies.
- `DeploymentDO.startPush` still performs source package, diagnostics,
  deployment analysis, codegen analysis, and failed-push error validation
  before calling the service.
- The store supersedes existing pending/analyzed pushes, inserts the new push
  row, and reads the stored push status inside the existing Durable Object
  transaction.
- Added service tests for successful analyzed pushes, failed pushes, and typed
  storage failure propagation.

Why it changed:

After Goal 6, the deployment protocol response contract is strong enough to
start moving push behavior behind Effect services. Push-start is the smallest
write slice that proves the runtime/store/service pattern without touching
activation correctness.

Convex references inspected:

- No new Convex source files were required. The existing roadmap still tracks
  Convex's backend-authoritative deployment analysis direction; this slice is
  Flarex's Cloudflare-specific service extraction.

Flarex differences:

- Flarex keeps the Durable Object as the deployment-scoped storage owner. The
  Effect service is composed per DO instance and does not introduce a global
  deployment service singleton.

Known limitations:

- Finish-push activation, artifact preflight, schema/function application,
  abandon-push, and active deployment reads remain outside `DeploymentService`.
- Semantic validation still throws existing `HttpError` messages from
  `DeploymentDO`; typed domain validation errors are future work after parity
  is easier to prove.

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

## Deep Analysis Protocol Schemas

Previous completed checkpoint: `bc2d552` Add deployment push-start protocol
schema.

What changed:

- Added Effect Schema contracts for the deep deployment analysis payload:
  schema tables/indexes, placements, function metadata, routes, partition
  metadata, source positions, and `ValidatorJson`.
- Added codegen analysis schemas for module/function metadata used by final
  codegen.
- Added active deployment and finish-push response schemas, then exported
  parser helpers for each new response contract.
- Tightened push status response parsing so `analysis` and `codegenAnalysis`
  are no longer `unknown` at that protocol boundary.
- Added protocol tests for valid deep payloads and malformed codegen payloads;
  backend push tests now parse active deployment and activated finish responses
  through the shared protocol package.

Why it changed:

The push-start wrapper is now stable enough to validate the deep response
payloads that downstream codegen and activation already rely on. Proving the
response contract first keeps this as a parser/test checkpoint rather than a
behavioral rewrite of deployment analysis.

Convex references inspected:

- No new Convex source files were required for this slice. Existing notes in
  this roadmap still track Convex's backend-authoritative deploy analysis and
  final-codegen direction.

Flarex differences:

- Flarex still validates deployment metadata inside `DeploymentDO` and stores
  push state in Durable Object SQLite. The shared protocol package now
  describes the response shape that Convex-like backend services will later
  expose more directly.

Known limitations:

- `DeploymentDO` request validation still owns source package semantics,
  diagnostics item validation, partition/schema consistency, codegen coverage,
  and exact HTTP 400 messages.
- The protocol schemas are structural. They do not yet replace semantic checks
  such as "codegen analysis schema must match deployment analysis schema."

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

## Analyzed Push Start Protocol Boundary

Previous completed checkpoint: `6d026a9` Add deployment abandon protocol
schema.

What changed:

- `POST /push/start-analyzed` now decodes the request body through
  `flarex-protocol/deployment`.
- The new protocol schemas export source packages, diagnostics, and the
  analyzed push-start wrapper. The route parser owns the wrapper contract while
  DeploymentDO keeps source package and diagnostics item validation.
- The actual push-start implementation, SQL transaction, supersede behavior,
  source package validation, analysis validation, and codegen analysis
  validation remain unchanged.
- Push lifecycle tests now include invalid JSON, preserved source package
  validation, preserved diagnostics item validation, invalid diagnostics
  wrapper, mixed success/failure wrappers, and protocol parsing for successful
  start responses.

Why it changed:

Push start is the first write boundary in the deployment state machine. Moving
the wrapper contract into `flarex-protocol` gives the migration a useful
DeploymentDO proof while avoiding a simultaneous rewrite of deployment
analysis semantics.

Convex references inspected:

- No new Convex source files were required for this slice. Existing roadmap
  notes continue to track Convex's deploy API and module-analysis direction.

Flarex differences:

- Flarex still runs push-start inside a Cloudflare Durable Object and validates
  the deep deployment metadata with backend-local TypeScript helpers.

Known limitations:

- Full source package semantic validation, diagnostics item validation,
  deployment schema, function metadata, codegen analysis, active deployment,
  and finish-push schemas remain future slices.

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

## Abandon Push Protocol Boundary

Previous completed checkpoint: `90f4383` Test registry Effect service.

What changed:

- `POST /push/:id/abandon` now uses the deployment protocol package to decode
  its request body.
- The route still performs the same state transition: only pending or analyzed
  pushes can become abandoned, and terminal/unknown pushes keep their existing
  409/404 behavior.
- Focused push lifecycle tests now cover invalid JSON, invalid abandon body,
  and successful abandon response parsing through the protocol schema.

Why it changed:

DeploymentDO owns the risky push activation state machine. The Effect
migration should first wrap a small non-activation route before moving larger
push-start or finish contracts into the protocol package.

Convex references inspected:

- No new Convex source files were required for this route-boundary slice.
- The existing roadmap entries still describe Convex's deploy start/finish
  direction; this checkpoint only changes Flarex transport validation.

Flarex differences:

- Flarex is validating this route inside a Cloudflare Durable Object rather
  than a central Rust/backend deploy service.
- The abandon request is intentionally smaller than Convex's full deployment
  API surface while the protocol package is being proven.

Known limitations:

- Full `AnalyzedStartPushRequest`, `FinishPushResponse`, `ActiveDeployment`,
  deployment analysis, codegen analysis, schema, and function metadata schemas
  are not introduced here.

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

## Deploy Finish Rejections Are Structured For CLI JSON

Previous completed checkpoint: `21b5e38` Add finish rejection remediation
hints.

What changed:

- Added `FlarexDeployFinishRejectedError` at the deploy boundary.
- Rejected finish responses now stay available as structured data when
  `deployFlarex(...)` fails, including the rejected response and remediation
  hint.
- `flarex-dev deploy --json` uses that typed error to report finish rejection
  code, remediation, rejected push, backend error, and diagnostics without
  parsing the human error string.
- JSON finish rejection diagnostics use the same envelope-then-push fallback as
  the human-readable formatter.
- JSON output maps internal push status to a compact DTO so backend analysis and
  codegen metadata stay out of the public CLI output.

Why it changed:

The previous checkpoint gave developers plain-text remediation, but deploy
finish rejection is already a typed backend contract. The CLI should preserve
that structured result for automation and future adapters instead of reducing
it to a string.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - finish-push is a separate activation boundary whose response is parsed
    before deploy reporting.
- `npm-packages/convex/src/cli/lib/deployApi/finishPush.ts`
  - finish-push response shape is a distinct deploy API contract.
- `npm-packages/convex/src/cli/lib/components.ts`
  - structured finish output is passed through deploy orchestration.

Flarex differences:

- Convex's finish output includes richer deployment diff/config data. Flarex's
  structured error object is limited to compact finish rejection metadata.
- The typed error is a dev-package boundary, not a backend protocol change.

Known limitations:

- Generic HTTP/transport errors are represented as generic JSON errors, not
  finish rejection objects.
- No deploy success diff is available yet, only started/finished push metadata.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts test/generate.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Finish Rejection Codes Include Remediation Hints

Previous completed checkpoint: `fe5a981` Surface finish rejection codes in dev
errors.

What changed:

- `devFinishPushErrorMessage(...)` now maps every current
  `FinishPushRejectionCode` to a short developer-facing remediation line.
- The formatter remains centralized, so CLI deploy, programmatic deploy, and
  local dev reload failures all show the same code, remediation, backend error,
  and diagnostics.
- The hint mapping uses an exhaustive TypeScript switch over the backend-owned
  rejection-code union, so future codes require an explicit formatter decision.

Why it changed:

The previous checkpoint surfaced stable rejection codes but still left
developers to infer the next action from the raw code and backend error text.
Convex's deploy path reports structured finish failures at the activation
boundary; Flarex should do the same in its smaller response model by turning
known finish codes into direct operational guidance.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - `finishPush(...)` owns final activation and routes finish errors through
    deploy error handling.
- `npm-packages/convex/src/cli/lib/deployApi/finishPush.ts`
  - finish output is parsed as a structured contract before CLI reporting.
- `npm-packages/convex/src/cli/lib/components.ts`
  - deploy reporting consumes structured finish-push output instead of opaque
    transport text.

Flarex differences:

- Convex's hosted deploy error model is richer and can include deployment diff
  and config details. Flarex still uses compact rejection codes and plain text
  remediation lines.
- The hints are local CLI/dev guidance only; they do not change backend
  response bodies or transport semantics.

Known limitations:

- There is still no structured CLI JSON mode for automation consumers.
- Generic HTTP transport failures remain outside finish-code remediation.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts test/generate.test.ts test/dev.test.ts test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Finish Rejection Codes Are Developer-Facing

Previous completed checkpoint: `31809e0` Add finish rejection codes.

What changed:

- `devFinishPushErrorMessage(...)` now includes the rejected finish response's
  stable `code` in deploy/dev failure text.
- CLI deploy, programmatic `deployFlarex(...)`, and local dev reload failures
  all surface the same `Backend rejection code: ...` line because they already
  share the finish formatter.
- Existing backend error and analyzer diagnostics remain in the output, so the
  code adds a machine-readable class without losing the human-readable failure
  reason.

Why it changed:

The previous checkpoint made finish rejection codes part of the transport
contract, but developer-facing activation failures still only printed the text
error and diagnostics. The code needs to be visible at the command/runtime
boundary so CLI users, tests, and future adapters can branch on or report the
stable failure class.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deployApi/finishPush.ts`
  - Convex parses finish-push responses as structured deployment output.
- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - the deploy boundary owns finish-push response parsing and error surfacing.
- `npm-packages/convex/src/cli/lib/components.ts`
  - structured finish output flows into CLI deploy reporting.

Flarex differences:

- Convex's finish response carries richer diff/config information. Flarex still
  has a compact activation/rejection union, so the CLI line exposes the compact
  `FinishPushRejectionCode` rather than a Convex-style deployment diff.
- The formatter remains plain text for now; it does not yet map codes to
  remediation hints.

Known limitations:

- Stable codes are surfaced in text, not yet as a structured CLI JSON mode.
- The code line is only present for domain finish rejections. Generic HTTP
  transport failures still report the HTTP/API error path.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts test/generate.test.ts test/dev.test.ts test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Finish Rejections Carry Stable Codes

Previous completed checkpoint: `dbbb06f` Return finish rejection for missing
artifacts.

What changed:

- Added backend `FinishPushRejectionCode` with the currently known finish
  rejection cases:
  - `invalid_state`
  - `missing_analysis`
  - `missing_artifact`
- Rejected `FinishPushResponse` bodies now include a required `code` field in
  addition to `error`, `push`, and optional diagnostics.
- `DeploymentDO.finish` now returns `invalid_state` for terminal/non-analyzed
  pushes and `missing_analysis` for analyzed pushes without activation
  metadata.
- The public R2 artifact preflight returns `missing_artifact` when an analyzed
  push's execution artifact is not present in durable storage.
- The dev push parser validates finish rejection codes and rejects unknown
  codes instead of preserving unstructured backend drift.

Why it changed:

The previous checkpoint moved known finish failures into the explicit finish
response shape, but clients still had to inspect text to distinguish failure
classes. Convex's deploy flow parses a structured finish response, so Flarex
should also keep known finish failures machine-readable even while the response
surface remains smaller than Convex hosted deploy metadata.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deployApi/finishPush.ts`
  - defines a parsed finish-push response contract.
- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - parses the finish response at the deploy boundary.
- `npm-packages/convex/src/cli/lib/components.ts`
  - treats finish-push output as structured deploy data.

Flarex differences:

- Convex finish responses include richer diff/config metadata. Flarex uses a
  compact activation/rejection union with stable rejection codes for the known
  Cloudflare/backend failure classes.
- Codes are limited to finish-domain rejections. Generic HTTP boundary errors
  such as malformed JSON or unknown routes still use normal HTTP error bodies.

Known limitations:

- Codes do not yet include remediation hints or a nested structured error
  payload.
- Additional hosted deploy failure classes will need new explicit codes rather
  than overloading `invalid_state`.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/push.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts test/generate.test.ts test/dev.test.ts test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Public Artifact Finish Failures Use Finish Rejections

Previous completed checkpoint: `1684c24` Use dedicated finish push responses.

What changed:

- The public finish route now converts missing durable execution artifacts into
  a `FinishPushResponse` rejection instead of returning a generic `{ error }`
  body before `DeploymentDO.finish`.
- `DeploymentDO.finish` and the public worker route now share the same
  backend-local rejected finish response builder, so diagnostics handling stays
  consistent across finish rejection paths.
- When R2 artifact storage is configured and an analyzed push's source package
  is missing from durable storage, the worker returns HTTP 409 with
  `{ result: "rejected", push, error, diagnostics? }`.
- The existing push status lookup in `verifyStoredPushArtifact(...)` remains
  the source for the rejected `push`, so non-analyzed or unknown pushes still
  fall through to the deployment object for normal finish handling.

Why it changed:

The previous checkpoint made `DeploymentDO.finish` return an explicit finish
success/rejection wrapper, but the public worker could still fail earlier
during artifact verification with a generic HTTP error body. That left one
activation-boundary path outside the new contract.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - deploy treats finish as a dedicated activation phase.
- `npm-packages/convex/src/cli/lib/components.ts`
  - source-package upload, validation, and finish are separate deploy steps.
- `npm-packages/convex/src/cli/lib/deployApi/finishPush.ts`
  - finish-push errors are part of the finish API response surface.

Flarex differences:

- Convex's hosted deploy API owns artifact/package availability inside the
  backend deploy service. Flarex's Cloudflare worker checks R2 before
  forwarding to `DeploymentDO`, so this rejection is produced at the public
  route boundary.
- The response remains Flarex's compact `FinishPushResponse`; it does not yet
  expose Convex-style structured deploy error codes.

Known limitations:

- Finish rejection still does not expose stable machine-readable error codes.
- Generic HTTP errors can still occur for malformed JSON, unknown routes, or
  storage/worker failures that happen before an analyzed push status is known.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/push.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Finish Push Uses A Dedicated Response Shape

Previous completed checkpoint: `51cc7ba` Surface deploy finish diagnostics.

What changed:

- Added a backend `FinishPushResponse` union for activation success and
  rejected finish attempts.
- `DeploymentDO` now returns `{ result: "activated", push }` for successful
  finish and `{ result: "rejected", push, error, diagnostics? }` with HTTP 409
  for rejected finish attempts.
- The dev push coordinators now return `DevFinishPushResponse` from `finish`,
  parse the dedicated response shape, and keep compatibility with legacy raw
  `PushStatus` finish responses.
- `DevFinishPushResponse` now derives its discriminated contract from the
  backend `FinishPushResponse` type and narrows successful pushes to
  `state: "activated"`.
- HTTP and local finish coordinators now treat only HTTP 409 wrapper bodies as
  domain finish rejections; other non-OK wrapper-shaped responses remain
  transport/API failures.
- Rejected finish wrappers must include an explicit `error` string, and legacy
  raw finish compatibility only accepts activated statuses instead of
  synthesizing rejected finish responses from raw failed statuses.
- The dev push-status parser now validates stored backend `analysis` metadata
  instead of preserving it through a direct cast.
- Deploy generation and dev-runtime reload now consume the finish wrapper
  before checking activation state, so finish-stage failures no longer overload
  generic push status as the public contract.

Why it changed:

The previous checkpoint surfaced backend diagnostics but still represented a
failed finish as a generic `PushStatus`. Finish is the activation boundary, so
the API should say whether activation happened and carry the rejected push plus
the finish error explicitly.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - `finishPush` is treated as its own deploy phase.
- `npm-packages/convex/src/cli/lib/components.ts`
  - push orchestration separates start, validation/typecheck, and finish.
- `npm-packages/convex/src/cli/lib/deployApi/finishPush.ts`
  - finish-push response handling is a distinct deployment API contract.

Flarex differences:

- Flarex still has a smaller finish response than Convex's richer hosted
  deployment/config-error model.
- The dev parser intentionally accepts legacy raw `PushStatus` responses so
  local and HTTP callers can move through the transition without breaking
  older backend mocks or temporary adapters.
- Flarex separates domain finish rejection (`409` wrapper) from generic
  transport failures, while Convex's hosted deploy client has a larger
  deployment API/error model.

Known limitations:

- Errors that happen before the request reaches `DeploymentDO.finish`, such as
  artifact storage verification in the public worker route, can still use a
  generic `{ error }` HTTP response.
- Finish rejection does not yet expose stable machine-readable error codes.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev build
git diff --check
```

## Deploy Finish Failures Include Backend Diagnostics

Previous completed checkpoint: `f29a231` Abandon failed deploy pushes.

What changed:

- Added shared `devPushStatusErrorMessage(...)` formatting for backend push
  status failures.
- `deployFlarex(...)` now reports backend `error` and analyzer/runtime
  diagnostics when push finish returns a non-activated state.
- The local dev runtime reload finish path now uses the same formatter, so dev
  reload and CLI deploy failures describe backend finish failures consistently.
- The dev runtime accepts a push-coordinator factory dependency, keeping
  production behavior on the local backend coordinator while allowing tests to
  exercise finish-stage failures without mocking the entire runtime.
- `flarex-dev deploy` stderr now includes backend finish diagnostics surfaced
  from the push status response.

Why it changed:

The previous deploy command only reported `did not activate: failed`, even
when the backend returned a stored error or diagnostics. That hid the useful
backend reason at exactly the activation boundary developers need to debug.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - `finishPush` catches and surfaces backend deployment/push config errors.
- `npm-packages/convex/src/cli/lib/components.ts`
  - push orchestration treats finish as a distinct phase whose diagnostics are
    part of the developer-facing deploy flow.
- `npm-packages/convex/src/cli/lib/deployApi/finishPush.ts`
  - finish-push response metadata is handled separately from start-push.

Flarex differences:

- Flarex currently has a smaller `PushStatus` response instead of Convex's
  richer finish diff/config-error model.
- Diagnostics are formatted from the current backend `error` and `diagnostics`
  fields; future hosted deploy errors can replace this with structured error
  codes without changing the activation boundary.

Known limitations:

- Failed finish responses still use the generic `PushStatus` type rather than
  a dedicated finish error shape.
- The formatter is plain text; CLI output does not yet group diagnostics with
  colors, spans, or remediation hints.
- The push-coordinator factory is a dev-runtime dependency seam, not a hosted
  deployment configuration API.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts test/generate.test.ts test/cli.test.ts test/dev.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Push Abandon Cleans Up Failed Pre-Finish Deploys

Previous completed checkpoint: `3c13655` Add backend push deploy command.

What changed:

- Added terminal push state `abandoned` for analyzed/pending candidates that
  should not activate after local deploy validation fails.
- Added backend `POST /deployments/:deploymentId/push/:pushId/abandon`.
- `DeploymentDO` now marks only `pending` or `analyzed` pushes as abandoned,
  stores a bounded reason in the push error field, and rejects abandon attempts
  for activated, failed, superseded, or unknown pushes.
- Abandon request bodies are validated at the deployment boundary so malformed
  JSON gets a 400 instead of a runtime failure.
- Public push routes decode the push ID once before forwarding to
  `DeploymentDO`, preserving encoded push IDs.
- Abandoned pushes cannot be finished later, so a failed pre-finish deploy
  cannot accidentally become active from a stale retry.
- `BackendPushCoordinator` now exposes optional `abandon(...)`; local and HTTP
  coordinators implement it.
- `deployFlarex(...)` best-effort abandons the started push when its
  pre-finish validation hook fails, then rethrows the original validation
  error so the developer sees the real failure.
- `flarex-dev deploy --typecheck enable` now sends abandon after generated
  output typecheck failure instead of leaving an analyzed candidate behind.

Why it changed:

The previous checkpoint made deploy activation depend on generated-output
validation, but a validation failure left a valid analyzed push stored on the
backend. Flarex persists push candidates before local validation because final
codegen is backend-authoritative, so it needs an explicit cleanup signal when
the client refuses to finish.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/components.ts`
  - Convex's push flow separates start, validation/typecheck, and finish.
- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - `finishPush` is an explicit activation boundary after validation/waiting.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - start-push carries backend analysis metadata.
- `npm-packages/convex/src/cli/lib/deployApi/finishPush.ts`
  - finish-push is the activation API shape Flarex mirrors.

Flarex differences:

- I did not find a portable Convex CLI abandon endpoint. Flarex adds one
  because the current Cloudflare backend stores source-package candidates
  before local generated-output validation completes.
- Abandon is cleanup, not activation rollback. It does not modify active schema,
  active functions, or active execution artifact metadata.
- Abandon is best-effort from the dev CLI because masking the local typecheck
  or validation error would make developer diagnostics worse.

Known limitations:

- Abandon does not delete durable source artifacts from R2 yet.
- Abandon reason is stored in the existing push `error` field; a future push
  event table could separate user-visible diagnostics from lifecycle reasons.
- No hosted auth/project-selection policy exists yet around who may abandon a
  push.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-backend exec vitest run test/push.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts test/generate.test.ts test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
```

## CLI Deploy Finishes Backend Push After Generated Validation

Previous completed checkpoint: `f9d1484` Route codegen through backend push analysis.

What changed:

- Added `deployFlarex(...)` to the dev package as the first full push lifecycle:
  initial local scaffolding, source package bundle, backend push start,
  final codegen from backend `codegenAnalysis`, optional pre-finish validation,
  backend push finish, and activation-state verification.
- Added `flarex-dev deploy` with required `--backend-url` and
  `--deployment-id`, plus repeatable `--backend-header`.
- Deploy now runs generated-output typecheck before calling push finish when
  `--typecheck enable` is used.
- Deploy does not call finish if generated-output validation fails.
- `--typecheck try` records the typecheck failure to stderr but still allows
  push finish, matching the existing codegen try-mode behavior.
- Reused the backend-push analysis guard so deploy refuses pushes that are not
  in `analyzed` state or do not return `codegenAnalysis`.
- Exported state-specific deploy status types so successful deploy results
  expose `started.state === "analyzed"` with `codegenAnalysis` and
  `finished.state === "activated"`.
- Exported deploy options/results from `flarex-dev` so tests and future
  adapters can reuse the same lifecycle instead of duplicating CLI logic.
- Shared CLI helpers now build base generate options, generated-output
  typecheck options, and backend push coordinators for both codegen and deploy
  so flag behavior does not drift between commands.

Why it changed:

Codegen could already consume backend push analysis, but there was no command
that owned the Convex-style "push, codegen from backend analysis, validate,
then finish" lifecycle. This checkpoint makes activation depend on successful
generated output validation instead of treating push start as deployment.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/components.ts`
  - `startComponentsPushAndCodegen` starts a push and performs final codegen
    from backend analysis before downstream completion.
  - `push` coordinates start, generated validation/typecheck, and finish.
- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - `startPush`, validation waiting, and `finishPush` are separate lifecycle
    phases.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - backend start-push is the authoritative analysis boundary.
- `npm-packages/convex/src/cli/lib/deployApi/finishPush.ts`
  - finish is an explicit backend activation step after client-side work.

Flarex differences:

- Flarex currently requires explicit `--backend-url` and `--deployment-id`
  because hosted auth, project selection, and deployment selection do not exist
  yet.
- Flarex deploy only validates generated output locally for now. It does not
  yet wait for schema/index backfill, auth config, environment variable checks,
  component pushes, or hosted deployment state transitions.
- Push finish currently only checks that the returned state is `activated`;
  richer backend finish diagnostics are future work.

Known limitations:

- No hosted deploy/login/project-selection flow exists.
- No schema/index wait phase exists between push start and finish.
- No rollback or abandon endpoint exists for failed local validation after
  push start.
- The temporary analyzer-only codegen route still exists for direct analyzer
  testing.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
```

## CLI Codegen Can Use Backend Push Codegen Analysis

Previous completed checkpoint: `3a27b91` Preserve analyzer codegen analysis in pushes.

What changed:

- Added `HttpBackendPushCoordinator` in `flarex-dev` for the public backend
  source-package push route.
- `generateFlarex(...)` and `dryRunFlarexCodegen(...)` can now use a
  `pushCoordinator` and consume `started.codegenAnalysis` from the backend push
  status as the final generated-file analysis.
- Codegen refuses an analyzed push that does not include `codegenAnalysis`,
  keeping the backend-authoritative generated metadata contract explicit.
- `flarex-dev codegen` now accepts `--backend-url`, `--deployment-id`, and
  repeatable `--backend-header` to start the backend push flow for codegen.
- The older `--analyzer-url` path remains as a temporary analyzer-only seam,
  but CLI rejects using analyzer-only flags and backend push flags together.
- HTTP backend push URLs preserve configured path prefixes so adapters mounted
  below a base route can still receive `/deployments/:id/push/start`.
- `analyzeFlarexSourcePackage(...)` remains tolerant of existing callers that
  pass `undefined` explicitly for the previous optional analyzer parameter.
- HTTP push request bodies are checked against backend `StartPushRequest` and
  `FinishPushRequest` types at the dev boundary.
- Plain codegen does not call `finish`; activation remains a future deploy/push
  command responsibility.

Why it changed:

The previous checkpoint made backend push storage preserve analyzer
`codegenAnalysis`. This checkpoint wires developer codegen to consume that
stored/push-returned metadata directly, which is closer to Convex's model where
generated files are downstream of backend deployment analysis.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - start-push is the deployment metadata boundary used by CLI flows.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final generated files are produced from backend-provided analysis.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - dev/deploy orchestration keeps generated files tied to deployed metadata.

Flarex differences:

- Flarex currently exposes an explicit `--backend-url` because the hosted
  platform deployment-selection/auth flow does not exist yet.
- `HttpBackendPushCoordinator` validates and preserves `codegenAnalysis`, but
  intentionally does not type-claim flattened backend `analysis` until a
  reusable validator exists at this dev boundary.
- Codegen starts but does not finish/activate pushes. Future deploy commands
  should own finish/activation after final generated output and validation.

Known limitations:

- No hosted-auth or project-selection CLI flow exists yet.
- The `--analyzer-url` temporary path still exists for direct analyzer testing.
- HTTP push status parsing does not yet validate or return flattened
  `DeploymentAnalysis`; codegen only requires `codegenAnalysis`.
- This checkpoint does not yet add the deploy command that should finish and
  activate backend pushes.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts test/generate.test.ts test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
git diff --check
```

## Push Stores Analyzer Codegen Analysis

Previous completed checkpoint: `a09a2b8` Wire codegen CLI to HTTP analyzer.

What changed:

- `AnalyzedStartPushRequest` success payloads can carry `codegenAnalysis`.
- The public source-only push route now forwards analyzer `codegenAnalysis`
  into `DeploymentDO` instead of dropping it after analysis.
- `DeploymentDO` stores `codegen_analysis_json` on push rows and returns it
  through push status and active deployment status.
- Existing direct analyzed-push callers remain compatible: if
  `codegenAnalysis` is absent, `DeploymentDO` reconstructs it from flattened
  deployment analysis as a fallback.
- Stored codegen analysis is validated against normalized deployment analysis
  before it is persisted.
- The source-only push route now treats an OK analyzer response without
  `codegenAnalysis` as a failed push, keeping fallback reconstruction limited
  to internal/direct analyzed-push compatibility.
- The source-only push route treats `codegenAnalysis: null` as a failed
  source-only push; fallback is reserved for truly absent codegen metadata on
  internal/direct callers.
- Stored `codegen_analysis_json` is revalidated from unknown JSON when push
  status is read, and schema/function comparisons use canonical JSON so key
  insertion order does not affect equality.
- Analyzer and stored analysis payloads remain `unknown` until `DeploymentDO`
  validates schema/functions metadata, so malformed OK analyzer responses fail
  with explicit validation errors instead of worker/runtime 500s.
- Codegen function metadata must match flattened deployment metadata including
  source position, not only kind/validators/partition metadata.
- Codegen analysis rejects duplicate module entries so the preserved shape
  matches generated API assumptions.

Why it changed:

The analyzer response contract now carries both flattened deployment analysis
and final codegen analysis. Dropping `codegenAnalysis` in the backend push path
would make final deployment status depend on lossy reconstruction, which is the
opposite of the Convex-style rule that backend analysis is authoritative.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - `StartPushResponse` is the backend analysis boundary.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final generated files consume analysis from the backend response.
- `npm-packages/convex/src/cli/lib/components.ts`
  - push/start analysis metadata flows downstream into codegen.

Flarex differences:

- Flarex still keeps flattened `DeploymentAnalysis` for backend invocation and
  runtime metadata, while `DeploymentCodegenAnalysis` is preserved for
  generated files.
- Direct internal `/push/start-analyzed` requests can omit `codegenAnalysis`
  during migration; the fallback reconstruction path remains for prototype
  tests and older callers.
- The schema change is a Durable Object SQLite additive column rather than a
  Postgres migration because this is still the backend DO deployment metadata
  prototype.

Known limitations:

- Stored codegen analysis validation checks consistency with flattened
  deployment metadata, but the hosted Dynamic Worker analyzer service itself is
  still future work.
- Existing push rows without `codegen_analysis_json` still reconstruct codegen
  metadata on read.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/push.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

## CLI Codegen Selects HTTP Analyzer

Previous completed checkpoint: `5aff422` Add HTTP backend source analyzer.

What changed:

- `flarex-dev codegen` can now select the HTTP analyzer via
  `--analyzer-url`, `--deployment-id`, and repeatable `--analyzer-header`.
- Normal codegen and dry-run codegen both pass the selected analyzer through
  the existing `sourceAnalyzer` seam.
- The CLI rejects partial analyzer configuration before bundling source or
  writing generated files.
- Typecheck options are kept separate from analyzer execution options so the
  generated-output typecheck boundary remains filesystem/compiler-only.
- Regression coverage combines analyzer flags with `--typecheck` to prove that
  runtime-only analyzer options do not leak into generated-output typecheck.

Why it changed:

Backend analysis is supposed to be authoritative. The previous checkpoint
implemented the HTTP adapter and response contract; this checkpoint wires that
adapter into the codegen command so local tooling can consume backend-owned
analysis without changing final codegen.

Convex references inspected:

- `npm-packages/convex/src/cli/codegen.ts`
  - Convex codegen can target deployment credentials before running codegen.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated files are downstream of deployment/backend metadata.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - backend analysis response shape is the deployment boundary.

Flarex differences:

- Flarex does not yet have Convex's deployment-selection flow, so this uses
  explicit analyzer flags as a temporary platform seam.
- Analyzer auth is represented by generic headers for now instead of a
  platform admin key or project token.
- The backend push route is not called directly by CLI codegen yet; only the
  analyzer seam is selectable.

Known limitations:

- No hosted analyzer implementation is provided by this slice.
- No deployment config discovery exists yet.
- CLI dry-run can use the remote analyzer, but the remote analyzer must accept
  the temporary source package paths generated by the dry-run temp project.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
```

## HTTP Analyzer Response Carries Codegen Analysis

Previous completed checkpoint: `2560e38` Route codegen through backend analysis seam.

What changed:

- Extended `AnalyzeSourcePackageResponse` so successful analyzer responses must
  include `codegenAnalysis`.
- `createLocalAnalyzerService(...)` now returns both flattened backend
  deployment analysis and the codegen analysis used by final generated files.
- Added `HttpBackendSourceAnalyzer` as a client-side analyzer adapter that
  requires `codegenAnalysis` and preserves analyzer diagnostics on failures.
- The HTTP adapter validates nested codegen schema/module/function metadata at
  the response boundary and reuses the shared analyzer diagnostics normalizer.
- Parser-level validator failures now return the same
  `ExecutionArtifactAnalysisError` shape as other analyzer contract failures,
  so diagnostics are not lost.
- Parser failures now include the invalid `codegenAnalysis` path. This keeps
  missing analysis, malformed schema metadata, malformed validators,
  unsupported route metadata, and impossible success-with-error bodies
  distinguishable.
- Local analyzer service success responses are checked with
  `satisfies AnalyzeSourcePackageResponse` and convert local SDK validators to
  backend-safe validator JSON before returning `codegenAnalysis`.

Why it changed:

Flarex needs one backend-owned analysis result to drive both deployment state
and generated client/server files. The flattened deployment analysis is
sufficient for runtime invocation, but final codegen still needs module names
and export names. Returning `codegenAnalysis` from the analyzer response keeps
that metadata authoritative without reverse-engineering it from flattened
function paths.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/components.ts`
  - backend push response carries the analyzed metadata used downstream.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - defines the backend response boundary for push analysis.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final codegen consumes backend analysis from that response.

Flarex differences:

- Flarex's analyzer endpoint currently returns both backend deployment analysis
  and codegen analysis; Convex's response shape is broader and component-aware.
- The backend Worker still forwards only flattened analysis into
  `/push/start-analyzed`; `DeploymentDO` can reconstruct codegen analysis for
  push status.
- Hosted analyzer authentication and deployment ownership checks are not wired
  in this adapter.
- Non-null `route` metadata is rejected by the HTTP adapter instead of being
  silently erased; Flarex codegen currently treats `partition` as the supported
  routing metadata.
- `DeploymentCodegenFunction` no longer includes `route`, while flattened
  executable `DeploymentFunctionMetadata` still can. That keeps codegen
  metadata aligned with the Convex-style generated API path and leaves legacy
  route compatibility at the backend execution metadata layer.

Known limitations:

- `HttpBackendSourceAnalyzer` is not yet exposed through CLI flags.
- Hosted Dynamic Worker analysis is still future work; this adapter only
  defines the HTTP seam that can consume it.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-backend typecheck
git diff --check
```

## Codegen Uses Backend Source Analyzer Seam

Previous completed checkpoint: `5bdc5d9` Add codegen dry-run.

What changed:

- Codegen orchestration now calls `analyzeFlarexSourcePackage(...)`, which
  accepts a `BackendSourceAnalyzer`.
- The default analyzer is `LocalExecutionArtifactBackendAnalyzer`, matching the
  backend push analysis seam already used by local dev.
- `generateFlarex(...)` and `dryRunFlarexCodegen(...)` accept
  `FlarexCodegenOptions.sourceAnalyzer`, so tests and future hosted flows can
  supply backend-owned analysis without changing final codegen.

Why it changed:

The deployment model requires backend-controlled analysis to be authoritative.
Convex's `startPush` response carries analyzed module/schema metadata into
codegen. Flarex is not yet calling hosted push from CLI codegen, but this
checkpoint removes direct local artifact analysis from generator orchestration
and makes backend source analysis the codegen boundary.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/components.ts`
  - constructs and sends the push/start request with bundled modules.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - defines `StartPushResponse`, the backend analysis response consumed by
    later codegen steps.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final codegen reads analysis from `StartPushResponse`.

Flarex differences:

- The default analyzer is still local and deterministic-checking, not hosted.
- `BackendSourceAnalyzer` currently returns the codegen analysis shape directly;
  hosted deployment metadata persistence remains separate.
- Local dev already uses `LocalBackendPushCoordinator`; this checkpoint brings
  standalone codegen closer to that boundary without requiring a backend server.

Known limitations:

- Hosted `/push/start` is not yet the source of CLI codegen analysis.
- Codegen analysis is not yet reconstructed from persisted active deployment
  metadata for standalone CLI commands.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "injected backend source analysis" --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example generate
git diff --check
```

## Decision

Flarex developers write ordinary TypeScript modules. They do not write or
deploy Cloudflare Worker code.

```txt
application deployment
  frontend, mobile app, Next.js app, or other client
  hosted wherever the developer chooses

Flarex function deployment
  ordinary TypeScript modules under flarex/
  bundled by Flarex tooling
  uploaded to the Flarex backend
  executed by a Flarex-managed dynamic execution isolate
```

Avoid Cloudflare platform terms that suggest the developer writes or deploys
Worker code. Use these terms instead:

- **developer modules**: ordinary files written under `flarex/`
- **source package**: bundled developer modules, source maps, schema, and module
  metadata uploaded to Flarex
- **execution artifact**: internal Flarex runtime wrapper plus the source
  package metadata needed for analysis and execution
- **Dynamic Worker runtime**: Flarex-managed Cloudflare runtime that loads and
  executes only the uploaded `flarex/` source package, not the developer's
  whole application
- **deployment analysis**: authoritative metadata produced by evaluating the
  source package in the backend-controlled execution environment

## Developer Contract

The intended developer API remains Convex-shaped:

```ts
import { mutation, query } from "./_generated/server";
import { v } from "flarex/values";

export const list = query({
  args: {},
  returns: v.array(v.object({ text: v.string() })),
  handler: async ctx => {
    return await ctx.db.query("messages").collect();
  },
});

export const send = mutation({
  args: { text: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", args);
    return null;
  },
});
```

The developer does not provide:

- a Worker `fetch` handler,
- Wrangler configuration,
- Dynamic Worker bindings,
- database connections,
- Durable Object stubs,
- execution or analysis endpoints.

Flarex tooling and the hosted platform own all of those runtime details.

## How Convex Performs Analysis

Convex analysis is runtime module analysis, not source-text scanning.

### 1. Function Registration Adds Runtime Metadata

Convex function builders wrap the developer handler and attach properties used
by the backend isolate:

```txt
isQuery / isMutation / isAction
isPublic / isInternal
exportArgs()
exportReturns()
_handler
```

`exportArgs()` and `exportReturns()` serialize validators to JSON. The strict
JSON replacer rejects undefined validators, including undefined values caused
by circular imports.

Convex references:

- `npm-packages/convex/src/server/impl/registration_impl.ts`
  - `queryGeneric`, `mutationGeneric`, `actionGeneric`, and internal variants
    attach runtime markers, validator exporters, and `_handler`.
  - `exportArgs` defaults missing args to `v.any()` and serializes validators.
  - `exportReturns` serializes a missing returns validator as `null`.
  - `strictReplacer` rejects undefined validator fields.

### 2. CLI Discovers And Bundles Modules

Convex initial codegen writes enough generated code for developer modules to
bundle. The CLI then:

- discovers deployable entry points,
- separates isolate and `"use node"` modules,
- bundles modules with esbuild,
- includes source maps,
- records module path and environment,
- hashes source plus source map,
- uploads changed modules while referencing unchanged module hashes.

The source package contract is conceptually:

```ts
type ModuleConfig = {
  path: string;
  source: string;
  sourceMap?: string;
  environment: "isolate" | "node";
};
```

Convex references:

- `npm-packages/convex/src/bundler/index.ts`
  - `entryPoints`, `entryPointsByEnvironment`, `bundle`, and module hashing.
- `npm-packages/convex/src/cli/lib/components/definition/bundle.ts`
  - `bundleImplementations` bundles schemas and function modules.
- `npm-packages/convex/src/cli/lib/components.ts`
  - `partitionModulesByChanges` sends changed modules and unchanged hashes.
- `npm-packages/convex/src/cli/lib/deployApi/modules.ts`
  - Serialized module and analyzed-module request/response shapes.

### 3. Backend Isolate Evaluates Modules

The Convex backend receives the source package, reconstructs unchanged modules,
and evaluates each non-dependency module in its isolate. It inspects the actual
module namespace after evaluation.

Analysis uses a restricted import-time environment:

- deterministic seeded non-cryptographic RNG,
- fixed import-phase Unix timestamp,
- bounded user-code timeout,
- explicitly supplied environment variables,
- no cryptographic randomness,
- no Performance API,
- no table mapping fetch,
- no database operations,
- no synchronous or asynchronous runtime syscalls,
- import-time logs retained for deployment error reporting.

This matters because module top-level code runs during both analysis and later
execution-isolate startup. Analysis metadata cannot be trusted if top-level
registration can change based on uncontrolled time, randomness, I/O, or
environment state.

For each exported object, Convex:

1. recognizes it only when exactly one function-kind marker is present,
2. checks public/internal visibility markers,
3. calls `exportArgs()` and parses the serialized argument validator,
4. calls `exportReturns()` and parses the serialized return validator,
5. verifies the handler is a function,
6. validates the exported function name,
7. resolves the handler source position through the source map,
8. records the analyzed function.

Exports that are not recognized as registered functions are ignored. An export
with no kind marker or multiple kind markers is skipped. An export marked both
public and internal is skipped with a warning. Once an export is recognized as
a registered function, malformed validator exporters or an invalid handler
fail the push.

Convex's authoritative analyzed shape contains:

```ts
type AnalyzedModule = {
  functions: AnalyzedFunction[];
  httpRoutes?: unknown;
  cronSpecs?: unknown;
  sourceIndex?: number;
};

type AnalyzedFunction = {
  name: string;
  position?: SourcePosition;
  udfType: "Query" | "Mutation" | "Action";
  visibility?: "public" | "internal";
  args: SerializedArgsValidator;
  returns: SerializedReturnsValidator;
};
```

Convex references:

- `crates/isolate/src/environment/analyze.rs`
  - `AnalyzeEnvironment` defines the restricted import-time environment.
  - `udf_analyze`, `parse_args_validator`, and `parse_returns_validator`.
- `crates/model/src/modules/module_versions.rs`
  - Authoritative `AnalyzedModule` and `AnalyzedFunction` models.
- `crates/application/src/lib.rs`
  - `analyze_modules` enforces module limits and converts analysis errors into
    deployment errors.

### 4. Schema Is Evaluated Separately

Convex bundles `schema.ts` separately. The backend isolate evaluates the schema
module, requires a default schema export, calls its runtime `export()` method,
and deserializes the resulting database schema.

Convex references:

- `crates/isolate/src/environment/schema.rs`
  - `SchemaEnvironment::evaluate_schema`.
- `crates/application/src/deploy_config.rs`
  - `evaluate_components` analyzes modules and evaluates schemas before
    constructing the checked deployment.

### 5. Backend Persists Analysis As The Execution Contract

Convex requires every non-dependency module to have an analyzed result.
Execution resolves the deployed analyzed function by module path and function
name before running it.

The authoritative metadata controls:

- whether a function exists,
- function kind,
- public versus internal visibility,
- argument validation,
- return validation,
- scheduled-function validation,
- source positions and operational metadata.

Convex references:

- `crates/model/src/modules/mod.rs`
  - `ModuleModel::apply` requires analyzed metadata for non-dependency modules.
  - `get_analyzed_function` resolves deployed functions from analyzed metadata.
- `crates/udf/src/validation.rs`
  - `ValidatedPathAndArgs` checks existence, visibility, expected function
    kind, argument size, and argument validators before execution.
  - Return validators are carried into post-execution validation.
- `crates/model/src/modules/function_validators.rs`
  - Argument validators must be an object validator or unvalidated `any`.
  - Return validators are independently validated.

## Convex Push Lifecycle

Convex deployment is deliberately split:

```txt
initial codegen
  -> bundle definitions, schema, and implementations
  -> start_push
      upload/reconstruct source packages
      evaluate schemas
      analyze modules
      validate component definitions
      prepare schema/index changes
      return authoritative analysis
  -> final codegen from start_push response
  -> TypeScript typecheck
  -> wait_for_schema
      validate existing documents
      wait for index backfills
      detect overwritten/racing schema changes
  -> finish_push
      recheck race-sensitive state
      atomically apply modules, analysis, schema, indexes, and deployment state
```

Convex references:

- `npm-packages/convex/src/cli/lib/components.ts`
  - Orchestrates initial codegen, bundling, `startPush`, final codegen,
    typecheck, schema wait, and `finishPush`.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - Defines `StartPushRequest`, authoritative analysis response, and schema
    change status.
- `crates/application/src/deploy_config.rs`
  - `start_push`, `evaluate_push_contents`, `wait_for_schema`, and
    `finish_push`.

## Flarex Target Design

Flarex should port the same lifecycle with a Cloudflare-specific execution
artifact boundary.

```txt
flarex dev / flarex deploy
  -> initial codegen
  -> bundle only the flarex/ developer modules, schema, and source maps
  -> POST start_push source package to Flarex backend
  -> Flarex creates an internal candidate execution artifact
  -> backend invokes candidate analysis inside the Dynamic Worker runtime
  -> candidate returns authoritative module and schema analysis
  -> backend validates and stores candidate analysis
  -> CLI performs final codegen from backend response
  -> CLI typechecks
  -> backend validates schema/index changes
  -> finish_push atomically activates candidate deployment version
```

The execution artifact is an internal implementation detail. Conceptually,
Flarex adds a runtime wrapper around the developer bundle:

```ts
import * as module0 from "./messages.js";
import * as module1 from "./users.js";
import schema from "./schema.js";
import { createExecutionArtifact } from "flarex/runtime";

export default createExecutionArtifact({
  modules: { "messages.js": module0, "users.js": module1 },
  schema,
});
```

The developer never writes or sees this entrypoint.

## Current Prototype Gaps

The current implementation proves several pieces, but it is not yet the target
deployment architecture:

- `packages/flarex-dev/src/analyze.ts` bundles modules and imports them inside
  the local Node process.
- Current analysis trusts `__flarexFunction`, `kind`, and `visibility` fields
  and does not produce validators or source positions.
- Generated metadata reads raw runtime validator objects from the generated
  function registry.
- Local dev deploys schema and function metadata through direct backend PUT
  routes.
- `DeploymentDO` destructively replaces active schema and functions.
- The backend has no candidate source package, authoritative analyzed-module
  record, push state machine, or active execution-artifact pointer.

These shortcuts are useful prototype scaffolding. They should be replaced
incrementally by the shared push lifecycle rather than expanded into a second
deployment model.

## Flarex Registration Contract

Flarex should move closer to Convex's runtime registration contract.

Current Flarex registered functions expose raw validator and handler objects:

```txt
__flarexFunction
kind
visibility
args
returns
handler
```

Target contract:

```txt
isQuery / isMutation / isAction / isWorkflowMutation
isPublic / isInternal
exportArgs()
exportReturns()
_handler
```

Recommended approach:

1. Add Convex-compatible marker and exporter properties.
2. Keep current Flarex properties temporarily for migration.
3. Port Convex's strict undefined-validator serialization behavior.
4. Make authoritative analysis call validator exporter functions and parse
   their JSON rather than directly trusting object fields.
5. Eventually remove prototype-only marker fields when generated and runtime
   code no longer depends on them.

`workflowMutation` is an intentional Flarex extension and must be represented
as an additional exclusive function-kind marker.

## Authoritative Analysis Contract

The first Flarex backend analysis response should include:

```ts
type AnalyzedSourcePosition = {
  path: string;
  startLine: number;
  startColumn: number;
};

type AnalyzedFunction = {
  name: string;
  kind: "query" | "mutation" | "action" | "workflowMutation";
  visibility: "public" | "internal";
  args: ValidatorJson;
  returns: ValidatorJson | null;
  position?: AnalyzedSourcePosition;
};

type AnalyzedModule = {
  path: string;
  environment: "isolate";
  functions: AnalyzedFunction[];
  sourceMap?: string;
};

type StartPushResponse = {
  pushId: string;
  bundleHash: string;
  modules: AnalyzedModule[];
  schema: DeploymentSchema;
  schemaChange: SchemaChange;
};
```

Later additions should follow Convex's domains:

- HTTP routes,
- cron specifications,
- environment-variable declarations,
- component definitions,
- external dependencies,
- separate action/runtime environments.

## Validation Layers

Copy Convex's layered validation model:

### During SDK Registration

- Convert argument validator records to object validators.
- Serialize validators with strict undefined rejection.
- Preserve Convex's unvalidated semantics: arguments serialize as `any`, while
  missing return validation serializes as `null`.
- Support the same practical registration forms as Convex: a direct handler or
  an object containing optional `args`, optional `returns`, and `handler`.

### During Bundle Construction

- Apply Convex-compatible function entry-point rules.
- Reject reserved paths.
- Record path, source, source map, environment, and hash.
- Enforce module count and source-size limits.

### During Authoritative Analysis

- Evaluate modules in the dynamic execution isolate.
- Run with a controlled import-phase timestamp and randomness contract.
- Ignore non-function exports.
- Recognize only exports with exactly one function-kind marker.
- Match Convex's compatibility behavior for ambiguous markers: skip exports
  with multiple kinds or both public/internal markers and retain analysis logs.
- Require valid handler functions.
- Parse exported validator JSON.
- Validate function names and module paths.
- Record source positions.
- Evaluate schema separately and validate its exported JSON.
- Disable database syscalls and prevent mutations during import/analysis.
- Disable external I/O, cryptographic randomness, unsupported environment
  access, and asynchronous runtime operations during import/analysis.
- Retain bounded import-time logs and include them in push failures.
- Enforce an analysis CPU/time limit.

### During `start_push`

- Validate the complete analyzed deployment.
- Compute schema and index diffs.
- Reject malformed analysis responses.
- Store candidate metadata without changing active invocation routing.

### During Invocation

- Resolve the function only from active authoritative analyzed metadata.
- Enforce visibility and expected kind before execution.
- Validate arguments before user code.
- Validate return values before mutation commit.
- Treat local execution-artifact validation as fast feedback only; backend
  validation remains authoritative.

### During `finish_push`

- Detect concurrent or superseded pushes.
- Confirm schema validation and required index work completed.
- Atomically activate source package, execution artifact reference, schema, and
  analyzed metadata.

## Cloudflare Adaptation

Cloudflare Workers cannot evaluate arbitrary uploaded JavaScript source with
`eval()` or `new Function()`. Therefore Flarex does not store raw TypeScript and
ask one permanent Worker to evaluate it directly.

Flarex tooling bundles only the developer's `flarex/` folder into a source
package. The backend stores that source package and creates an internal
execution artifact for the Flarex-managed Dynamic Worker runtime. The
developer's frontend, mobile app, Next.js app, or other application deployment
is not bundled into this artifact and is not deployed by Flarex.

This keeps the developer model close to Convex. The developer uploads ordinary
Flarex backend modules to Flarex and uses client APIs from their app wherever
that app is hosted.

### Import-Phase Determinism Risk

Cloudflare provides isolation, but it does not directly expose Convex's
`AnalyzeEnvironment` controls. Flarex must determine and enforce a portable
import-phase contract before claiming equivalent analysis semantics.

The target is:

```txt
execution artifact runtime prelude
  -> install controlled import-phase globals where Cloudflare permits
  -> deny outbound I/O during analysis
  -> expose no database/syscall capability during module import
  -> evaluate developer modules
  -> analyze exports
  -> compare result against the artifact's declared module/hash manifest
```

Where Cloudflare cannot safely patch or control a global used at module import,
Flarex must initially reject that import-time usage with a clear deployment
error. Silent nondeterminism is not acceptable because analysis metadata could
then disagree with the functions available in a later isolate.

Before implementing hosted analysis, create focused probes for:

- whether a generated prelude can reliably control `Date.now()` and
  `Math.random()` before bundled developer module evaluation,
- whether cryptographic randomness and Performance APIs can be denied,
- top-level `fetch` and other outbound I/O behavior,
- environment-variable exposure during module initialization,
- consistency across separate cold isolate starts.

If full control is not portable, Flarex should define a stricter import-time
subset than Convex and enforce it at bundle and runtime boundaries.

Relevant Cloudflare runtime constraint:

- `https://developers.cloudflare.com/workers/runtime-apis/web-standards/`
  - Workers prohibit `eval()` and `new Function()`, so Flarex must analyze and
    execute prepared source packages through its managed runtime boundary.

## Deployment State Model

`DeploymentDO` currently replaces schema and functions directly. The target
model needs candidate and active deployment versions:

```txt
deployment
  activePushId
  activeExecutionArtifact
  activeSchemaVersion

push
  pushId
  state
  bundleHash
  sourcePackageRef
  executionArtifactRef
  analyzedModules
  schema
  schemaChange
  error
  createdAt
```

Suggested push states:

```txt
created
uploaded
analyzing
analyzed
validatingSchema
ready
active
failed
superseded
```

Large source packages and source maps should live outside Durable Object SQLite,
likely in R2. `DeploymentDO` should own authoritative state transitions,
analysis metadata, schema metadata, and the active pointer.

## Proposed Push API

Keep the public shape close to Convex while using deployment-scoped Flarex
routes:

```txt
POST /deployments/:deploymentId/pushes/evaluate
POST /deployments/:deploymentId/pushes/start
POST /deployments/:deploymentId/pushes/:pushId/wait-for-schema
POST /deployments/:deploymentId/pushes/:pushId/finish
GET  /deployments/:deploymentId/pushes/:pushId
```

`evaluate` performs analysis and computes schema/index effects without
activating or beginning long-lived schema work.

`start` creates candidate state, performs authoritative analysis, and begins
schema/index preparation.

`wait-for-schema` long-polls candidate schema validation and index preparation.

`finish` verifies the candidate is still valid and atomically switches the
active deployment pointer.

Internal execution-artifact routes should not be public application APIs:

```txt
POST /__flarex_internal/analyze
POST /__flarex_internal/invoke
```

They are invoked only through the Flarex dispatch/control plane and must require
an unforgeable internal capability scoped to the deployment and candidate push.

## Local Development

Local development must use the same push state machine:

```txt
Vite watcher
  -> initial codegen
  -> source package
  -> local start_push
  -> candidate Miniflare execution artifact
  -> authoritative local analysis
  -> final codegen
  -> local finish_push
```

Miniflare is the local execution-artifact adapter for the same source-package
analysis contract. Local dev must not keep a separate metadata deployment
shortcut.

## Ownership Boundaries

Target responsibilities:

```txt
packages/flarex
  function registration markers
  validator exporters
  developer-facing runtime types

packages/flarex-dev
  initial codegen
  source bundling and hashing
  push client
  final codegen from StartPushResponse
  local dev orchestration

packages/flarex-backend
  push API contracts and validation
  DeploymentDO candidate/active state machine
  authoritative analyzed metadata persistence
  invocation resolution against active metadata

Flarex Dynamic Worker runtime
  load candidate source packages
  run candidate analysis
  run active invocation
  enforce import-time and syscall boundaries
```

The Dynamic Worker runtime/control path should be separated from the public
request/data plane. Public invocation code must not receive raw storage
bindings, database connections, or unrestricted runtime capabilities.

Do not create a new package solely for the adapter until local Miniflare and
the hosted Dynamic Worker runtime create a real shared contract. At that point,
extract the interface and shared push orchestration instead of duplicating the
state machine.

## Implementation Plan

### Phase 1: Port Registration And Analysis Contracts

1. Port Convex-style marker fields, validator exporters, and strict serializer
   into `packages/flarex`.
2. Port Convex-compatible function registration overloads and unvalidated
   args/returns behavior.
3. Expand Flarex analyzed module/function types to include validators and
   source positions.
4. Make the current local analyzer use the same contract and failure behavior
   as the future backend analyzer.
5. Add focused compatibility tests for malformed markers, malformed
   validators, ambiguous visibility, invalid handlers, invalid names, aliases,
   reexports, and source positions.

### Phase 1 Step 1 Implementation Update

Completed the first isolated registration-contract step in `packages/flarex`.
No backend push state, deployment routing, local-dev push flow, or Dynamic
Worker integration changed.

Implemented:

- Convex-style direct handler registration:

  ```ts
  query(async (ctx, args) => ...)
  ```

- Convex-style object registration with optional `args` and `returns`:

  ```ts
  query({ handler })
  query({ args, handler })
  query({ args, returns, handler })
  ```

- runtime registration metadata:

  ```txt
  isFlarexFunction
  isQuery / isMutation / isAction / isWorkflowMutation
  isPublic / isInternal
  exportArgs()
  exportReturns()
  _handler
  ```

- missing args export as `v.any()` JSON,
- missing returns export as `null`,
- strict undefined-validator rejection during `exportArgs()` and
  `exportReturns()`,
- `internalActionGeneric` and `internalAction` registration,
- root argument-validator support in validation helpers,
- exact generated API argument and declared-return type inference.

Temporary compatibility fields remain:

```txt
__flarexFunction
kind
visibility
args
returns
handler
```

They keep the existing local analyzer, metadata generator, and generated Worker
operational until the next step changes analysis to consume Convex-style
markers and validator exporters.

Convex references copied closely:

- `npm-packages/convex/src/server/registration.ts`
  - `DefaultFunctionArgs`, optional-validator builder typing, registered
    function runtime fields, and direct/object registration forms.
- `npm-packages/convex/src/server/impl/registration_impl.ts`
  - function kind/visibility markers, `_handler`, `exportArgs`,
    `exportReturns`, `v.any()` default args, `null` default returns, and strict
    undefined-validator serialization.

Current intentional or temporary differences:

- Flarex uses `isFlarexFunction`, not Convex's `isConvexFunction`.
- `workflowMutation` adds `isWorkflowMutation`.
- Flarex still exposes prototype compatibility fields listed above.
- Flarex execution still calls `handler`; it does not yet use Convex-style
  `invokeQuery`, `invokeMutation`, or `invokeAction` wrappers.
- `internalAction` exists in the public SDK but is not yet emitted by the
  generated `_generated/server.ts` template.
- Convex backend analysis rejects argument validators other than object or
  unvalidated `any`; Flarex authoritative analysis does not enforce that yet.
- Flarex's strict undefined error currently points at the serialized
  `fieldType` property and does not include Convex's documentation URL.

Focused tests cover:

- exclusive kind and visibility markers,
- public and internal registrations,
- direct handlers,
- object definitions without validators,
- root `v.any()` arguments,
- serialized args and returns validators,
- strict undefined-validator failures,
- `_handler` identity,
- existing generated API argument and return inference.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

Next isolated step: update `packages/flarex-dev/src/analyze.ts` to consume these
runtime markers and validator exporters and to return validator metadata. Do
not add backend push state in that step.

### Phase 1 Step 2 Implementation Update

Completed the isolated local-analysis contract step. No backend push state,
deployment activation, Dynamic Worker analysis adapter, or final-codegen
metadata source changed.

The `flarex-dev` analyzer now:

- classifies function exports from exactly one of `isQuery`, `isMutation`,
  `isWorkflowMutation`, or `isAction`,
- classifies visibility from exactly one of `isPublic` or `isInternal`,
- ignores the temporary `__flarexFunction`, `kind`, and `visibility`
  compatibility fields,
- verifies `_handler` is callable,
- calls `exportArgs()` and `exportReturns()` with the registered function as
  `this`,
- requires exporter results to be strings,
- parses and structurally validates the serialized validator JSON through the
  zero-runtime-dependency `flarex/validator-json` subpath,
- enforces that argument validators are object validators or unvalidated
  `v.any()`, and
- returns normalized `args` and `returns` validator metadata in every analyzed
  function record.

Malformed or ambiguous marker exports are skipped. Invalid handlers, exporter
types, exporter return values, JSON, validator shapes, and argument validator
kinds fail analysis with a module/export-qualified error.

Convex references copied closely:

- `crates/isolate/src/environment/analyze.rs`
  - exclusive kind-marker detection,
  - visibility-marker detection,
  - `_handler` validation,
  - `exportArgs()` and `exportReturns()` invocation,
  - exporter string and JSON failure behavior.
- `crates/model/src/modules/module_versions.rs`
  - analyzed functions own validator metadata produced by analysis.

Intentional and temporary differences:

- Flarex adds `isWorkflowMutation`.
- Flarex currently requires exactly one visibility marker and skips exports
  without visibility. Convex can retain an analyzed function with no
  visibility for compatibility; Flarex avoids accidentally defaulting an
  unmarked function to public.
- Flarex local analysis returns normalized validator JSON objects. Convex
  stores serialized validator JSON strings in `AnalyzedFunction`.
- Source positions are not included yet.
- Final generated `functionMetadata.ts` still evaluates the function registry
  instead of consuming analyzed validator metadata. Moving final codegen to
  the analysis response remains a later isolated step.
- Analysis still runs in the trusted local Vite process, not the
  backend-controlled Dynamic Worker boundary.

Focused tests cover:

- marker-based kind and visibility classification,
- ignoring tampered compatibility fields,
- query, mutation, workflow mutation, and internal action analysis,
- parsed argument and return validators,
- ambiguous kind and visibility markers,
- missing visibility,
- malformed exporter types and results,
- invalid JSON and validator shapes,
- invalid argument validator kinds, and
- invalid handlers.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

### Phase 1 Step 3 Implementation Update

Completed the isolated final-codegen authority step. Backend push state,
deployment activation, source bundling, and Dynamic Worker analysis remain
unchanged.

Final codegen now serializes `functionMetadata.ts` directly from
`AnalyzedModule[]`. The generated metadata module is static data and no longer
imports or evaluates `functionRegistry.ts`.

The generated Worker now uses analyzed metadata for:

- function kind checks,
- argument validation,
- backend execution-session start requests, and
- return validation.

`functionRegistry.ts` is now used only to resolve the executable registered
function and call its Convex-style `_handler`. Temporary compatibility fields
such as `kind`, `visibility`, `args`, `returns`, and `handler` can no longer
change generated deployment metadata or invocation validation after analysis.

Convex references copied in principle:

- `npm-packages/convex/src/cli/codegen_templates/component_api.ts`
  - final static codegen derives function references and types from analyzed
    modules rather than re-evaluating developer exports.
- `crates/model/src/modules/module_versions.rs`
  - analyzed function metadata is the durable description of function kind,
    visibility, and validators.

Intentional and temporary differences:

- Flarex emits a generated static runtime metadata module because the current
  generated Worker exposes `/__flarex_internal/metadata`. Convex persists
  analyzed metadata in its backend.
- The executable registry still imports developer modules because Flarex has
  not produced or uploaded a separate execution artifact yet.
- Analysis remains local and trusted. The static metadata is authoritative
  only for this local generation run until backend-controlled analysis and
  push state exist.

Tests prove that mutating legacy runtime compatibility fields after
registration cannot alter generated function kind, visibility, args, returns,
or Worker invocation validation.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

### Phase 2: Produce A Real Source Bundle

1. Separate initial codegen, source bundling, and final codegen APIs.
2. Emit module path, source, source map, environment, and stable hash.
3. Bundle schema separately.
4. Add changed-module and unchanged-hash support after the full-bundle path is
   correct.

### Phase 2 Step 1 Implementation Update

Completed the first immutable source-package step. No backend push API,
candidate deployment state, Miniflare analysis adapter, or hosted Dynamic
Worker upload was added.

The generation pipeline is now explicit:

```txt
initialCodegen()
  -> bundleFlarexSourcePackage()
  -> analyzeSourcePackageLocally()
  -> finalCodegen()
```

`generateFlarex()` remains the convenience orchestration API and calls those
four phases in order.

The serializable source-package contract is:

```ts
type SourceModule = {
  path: string;
  source: string;
  sourceMap?: string;
  environment: "isolate";
  sha256: string;
};

type SourcePackage = {
  modules: SourceModule[];
  functions: string[];
  schema?: string;
  execution: string;
};
```

The package contains:

- one self-contained isolate bundle per developer function entrypoint,
- a separately bundled schema module when `flarex/schema.ts` or
  `flarex/schema.js` exists, and
- a self-contained internal execution entrypoint that exports the function
  module namespaces and is consumed by local analysis.

Modules are sorted by logical path. Source maps are normalized to remove
machine-specific project and SDK paths. Each `sha256` covers:

```txt
source + NUL + normalized source map
```

Local analysis now executes the source package's internal execution entrypoint,
not a transient analyzer-only Vite bundle. This establishes the artifact
contract that a future Miniflare adapter and hosted Dynamic Worker adapter can
both consume.

Convex references copied closely:

- `npm-packages/convex/src/cli/lib/components/definition/bundle.ts`
  - bundles schema separately,
  - bundles isolate function entrypoints with source maps,
  - returns module path, source, source map, and environment.
- `npm-packages/convex/src/cli/lib/deployApi/modules.ts`
  - `ModuleConfig` and `ModuleHashConfig` transport shapes.
- `crates/model/src/config/types.rs`
  - module hash identity covers source plus source map.

Intentional and temporary differences:

- Convex uses esbuild and its backend source-package storage. Flarex currently
  uses Vite/Rollup and returns an in-memory serializable package.
- Flarex adds a duplicated self-contained internal execution entrypoint so a
  Flarex-managed execution artifact can load all registered functions from one
  module. Individual function bundles remain available for Convex-style module
  identity and future changed-module pushes.
- Source maps are preserved and normalized, but analyzed source positions are
  not extracted yet.
- Schema is bundled separately but not yet evaluated from the source package.
- Full packages are always produced; changed-module and unchanged-hash push
  optimization remains follow-up work.

Tests prove:

- identical projects under different machine paths produce identical source
  packages and hashes,
- module ordering is deterministic,
- schema, function, and execution bundles are separate,
- unrelated generated files do not affect package identity,
- changing one function changes its bundle and the execution entrypoint but
  not unrelated function or schema hashes, and
- the execution entrypoint can be analyzed and passed to final codegen.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

### Phase 2 Step 2 Implementation Update

Completed complete local deployment analysis from the immutable source package.
No backend candidate state, push routes, Miniflare adapter, or hosted Dynamic
Worker analysis was added.

`analyzeSourcePackageLocally()` now returns:

```ts
type DeploymentAnalysis = {
  functions: AnalyzedModule[];
  schema: AnalyzedSchema;
};
```

The schema bundle referenced by `SourcePackage.schema` is evaluated directly
from its immutable bundled source. Analysis normalizes:

- stable table IDs assigned by sorted table name,
- table names,
- structurally validated document validators,
- default and explicit placement rules,
- index names and field lists, and
- stable index IDs.

`finalCodegen()` now consumes the complete `DeploymentAnalysis`. Generated
`deploymentSchema.ts` is static analyzed data and does not import
`../schema`. The generated Worker derives table-name and table-ID metadata from
that static deployment schema and also no longer imports `../schema`.

The developer schema remains imported only by generated `dataModel.ts` for
compile-time TypeScript inference. Runtime deployment metadata and invocation
behavior no longer evaluate it after analysis.

Convex references copied in principle:

- `crates/application/src/lib.rs`
  - evaluates the separately bundled schema module before deployment.
- `npm-packages/convex/src/cli/lib/deployApi/componentDefinition.ts`
  - deployment analysis returns both analyzed functions and analyzed schema.
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - final codegen consumes analyzed schema returned by deployment analysis.

Intentional and temporary differences:

- Flarex currently normalizes directly into the existing Durable Object
  `DeploymentSchema` shape. Convex's analyzed database schema contains richer
  schema-validation and index lifecycle metadata.
- Projections remain excluded from authoritative storage schema, matching the
  current backend capability. Projection analysis needs its own later domain
  step.
- Schema version remains prototype constant `1`; push-state activation will
  own real schema version progression.
- Schema import-phase restrictions are not enforced until analysis moves into
  a controlled execution artifact.

Tests prove:

- schema validators, indexes, and placement survive source package bundling and
  analysis,
- final codegen consumes the analyzed schema,
- modifying the developer schema file after analysis cannot change generated
  deployment metadata, and
- generated Worker runtime code no longer imports the developer schema.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

### Phase 3: Add Backend Push State

1. Define `StartPushRequest`, `StartPushResponse`, `PushStatus`, and
   `FinishPushRequest`.
2. Add candidate push state and active deployment pointer to `DeploymentDO`.
3. Store authoritative analysis per candidate push.
4. Keep existing direct schema/functions PUT routes only as temporary test
   helpers, then remove them from normal dev/deploy flow.

### Phase 3 Step 1 Implementation Update

Added the first backend candidate push lifecycle. No Dynamic Worker analysis,
Miniflare analysis adapter, hosted source-package loading, schema diff
validation, or local-dev push orchestration was added.

New backend API types:

- `StartPushRequest`
- `StartPushResponse`
- `FinishPushRequest`
- `PushStatus`
- `PushSourcePackage`
- `DeploymentAnalysis`

New routes:

```txt
POST /deployments/:deploymentId/push/start
GET  /deployments/:deploymentId/push/:pushId
POST /deployments/:deploymentId/push/:pushId/finish
```

For this step, the dev/client side supplies both the source package metadata
and the already-produced deployment analysis. `DeploymentDO` validates and
stores the candidate, but it does not run analysis itself yet.

Candidate push state is stored in `DeploymentDO` with:

- push ID,
- state,
- source package metadata and hashes,
- analyzed schema,
- analyzed functions,
- failure error,
- created/updated timestamps.

Supported states:

```txt
pending
analyzed
failed
activated
superseded
```

Current state behavior:

- A start request with valid analysis stores an `analyzed` candidate.
- A start request without analysis but with an error stores a `failed`
  candidate.
- Starting a new analyzed/failed candidate supersedes previous `pending` or
  `analyzed` candidates.
- Active schema/functions remain unchanged until `finish`.
- `finish` atomically applies candidate schema and function metadata through
  the same validation path used by the legacy direct `PUT /schema` and
  `PUT /functions` routes.
- Failed, superseded, and unknown pushes cannot activate.

Convex references copied in principle:

- `crates/application/src/deploy_config.rs`
  - `start_push` / `finish_push` lifecycle and candidate deployment state.
- `crates/application/src/lib.rs`
  - analyzed modules and schema flow into activation only after validation.
- `crates/model/src/source_packages/types.rs`
  - source package metadata and hashes are part of deployment state.

Intentional and temporary differences:

- Convex backend performs analysis during push. Flarex accepts analysis from
  dev tooling for this step.
- Flarex stores source package contents inline in Durable Object SQLite for the
  prototype. Hosted production should store large immutable artifacts outside
  `DeploymentDO` and keep hashes/references there.
- Historical note: direct schema/functions PUT routes existed at this
  checkpoint for tests and dev runtime. They were later removed from the
  public backend route surface after tests/dev moved to push activation.
- Local dev runtime later moved to `push/start` and `push/finish`.
- No push race token, schema diff, wait-for-schema, index backfill, or
  execution-artifact pointer is enforced yet.

Tests prove:

- start stores an analyzed candidate,
- active deployment is unchanged before finish,
- finish activates schema/functions,
- failed and unknown pushes cannot activate,
- a second push supersedes the previous analyzed candidate, and
- superseded pushes cannot activate.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

### Phase 4: Local Authoritative Push

1. Add an execution-artifact adapter interface.
2. Implement the first adapter with Miniflare.
3. Run candidate analysis through the execution artifact, not through Node
   dynamic import.
4. Change local dev and `flarex-test` to use `start_push` and `finish_push`.
5. Generate final API types from `StartPushResponse`.

### Phase 4 Step 1 Implementation Update

Local dev now uses the backend candidate push lifecycle for reload and
activation. It still uses local Node/Vite analysis; no execution-artifact
adapter was introduced yet.

New reload order:

```txt
initialCodegen()
  -> bundleFlarexSourcePackage()
  -> analyzeSourcePackageLocally()
  -> POST /push/start
  -> finalCodegen()
  -> build app Worker
  -> POST /push/:pushId/finish
```

The push request sends:

- source package metadata and hashes,
- analyzed schema,
- flattened analyzed function metadata.

Final codegen still uses the grouped local analysis result so the generated
function registry can import executable exports by module/export. Backend
activation uses the flattened metadata shape already stored by
`DeploymentDO`.

Intentional and temporary differences:

- Convex backend analysis is authoritative during push. Flarex local dev still
  supplies analysis to the backend.
- Final codegen is not yet driven directly from `StartPushResponse` because the
  backend stores flattened function metadata. Reconstructing or returning a
  codegen-ready analysis tree belongs with the execution-artifact analyzer
  step.
- The generated Worker metadata endpoint remains for compatibility, but local
  dev no longer uses it for deployment.

Tests prove:

- local dev records an activated backend push,
- activated push metadata contains analyzed schema and functions,
- invoke still works through the generated Worker after push activation.

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

### Phase 4 Step 2 Implementation Update

Previous completed checkpoint: `7abaa43` Use backend push lifecycle in local
dev.

Added the first execution-artifact adapter boundary and wired local generation
and local dev reload through it.

New API:

```ts
interface ExecutionArtifactAdapter {
  analyze(sourcePackage: SourcePackage): Promise<DeploymentAnalysis>;
}
```

`LocalMiniflareExecutionArtifactAdapter` now creates a temporary Miniflare
Worker module from the immutable source package, imports the bundled execution
entrypoint and schema entrypoint inside that Worker-shaped isolate, and returns
the same `DeploymentAnalysis` shape used by final codegen and backend
`push/start`.

Normal local dev reload is now:

```txt
initialCodegen()
  -> bundleFlarexSourcePackage()
  -> LocalMiniflareExecutionArtifactAdapter.analyze(sourcePackage)
  -> POST /push/start
  -> finalCodegen()
  -> build generated app Worker
  -> POST /push/:pushId/finish
```

`generateFlarex()` also uses the adapter. The older
`analyzeSourcePackageLocally()` path remains exported as a transition/debug
helper and as a test oracle while the artifact analyzer is still being proven.

Convex references copied in principle:

- `crates/isolate/src/environment/analyze.rs`
  - analysis executes evaluated runtime exports instead of scanning source.
- `crates/application/src/deploy_config.rs`
  - push analysis produces the metadata consumed by final codegen and
    activation.
- `npm-packages/convex/src/cli/lib/components.ts`
  - local dev orchestration treats analysis as a deployment step between
    source bundling and final codegen.

Intentional and temporary differences:

- Convex analyzes in the backend Rust/V8 isolate. This step analyzes in a
  local Miniflare Worker-shaped artifact so the boundary is Cloudflare-shaped
  before the hosted Dynamic Worker runtime is connected.
- The artifact analyzer embeds a small analyzer runtime instead of importing
  `flarex-dev` internals. This keeps the future hosted artifact self-contained,
  but the code should be deduplicated once the runtime package boundary is
  created.
- The backend still receives client-supplied analysis in `push/start`; it does
  not yet create the candidate artifact or call analysis itself.
- Import-phase determinism controls, source positions, logs, module limits,
  source package storage, and hosted Dynamic Worker loading remain future work.

Tests prove:

- the Miniflare execution-artifact analyzer returns the same function and
  schema analysis as the old direct Node analyzer for a source package, and
- final codegen can consume the artifact analysis.

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

### Phase 4 Step 3 Implementation Update

Previous completed checkpoint: `27bb9f5` Analyze source packages in execution
artifact.

Backend push status now returns a codegen-ready grouped analysis response in
addition to the flattened activation metadata:

```ts
type DeploymentCodegenAnalysis = {
  schema: DeploymentSchema;
  functions: Array<{
    moduleName: string;
    functions: Array<{
      moduleName: string;
      exportName: string;
      kind: DeploymentFunctionKind;
      visibility: FunctionVisibility;
      args: ValidatorJson;
      returns: ValidatorJson | null;
    }>;
  }>;
};
```

`DeploymentDO` still stores the existing flattened `DeploymentFunctions`
shape because that is the active runtime validation and invocation metadata.
When returning `push/start`, `push/:id`, or `push/:id/finish`, it reconstructs
the grouped codegen modules from function paths:

```txt
lessons:list -> moduleName "lessons", exportName "list"
lessons      -> moduleName "lessons", exportName "default"
```

Local dev now requires `started.codegenAnalysis` from the backend before
running `finalCodegen()`. The locally produced artifact analysis is still sent
to `push/start` because the backend does not own analysis yet, but final codegen
is now driven by the backend response instead of the pre-push local variable.

Convex references copied in principle:

- `npm-packages/convex/src/cli/lib/components.ts`
  - final codegen consumes the deployment analysis returned from push.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - `startPush` returns analyzed modules and schema information needed by the
    client-side codegen/typecheck phase.
- `crates/model/src/modules/module_versions.rs`
  - active runtime metadata remains the durable backend function contract.

Intentional and temporary differences:

- Convex's backend produces the analysis itself. Flarex still receives local
  artifact analysis in the request and validates/stores it before returning a
  backend-shaped codegen response.
- Flarex reconstructs grouped modules from flattened paths. This is sufficient
  for current generated API output but source positions and richer analyzed
  module records still require backend-owned artifact analysis.
- `codegenAnalysis` is duplicated in the push response and not stored as a
  separate database column. It is deterministic from stored schema/functions.

Tests prove:

- `push/start`, `push/:id`, and `push/:id/finish` return grouped
  `codegenAnalysis`, and
- local dev exposes the backend-returned grouped analysis and can still invoke
  generated functions after activation.

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

### Phase 4 Step 4 Implementation Update

Previous completed checkpoint: `3cbd471` Return codegen analysis from push
start.

Added a local backend push coordinator boundary in `flarex-dev`.

The local dev reload loop now hands only the immutable source package to the
push coordinator:

```txt
initialCodegen()
  -> bundleFlarexSourcePackage()
  -> LocalBackendPushCoordinator.start(sourcePackage)
      -> local execution-artifact analysis
      -> POST /deployments/:deploymentId/push/start with analyzed metadata
  -> finalCodegen(context, started.codegenAnalysis)
  -> build generated app Worker
  -> LocalBackendPushCoordinator.finish(pushId)
```

This removes execution-artifact analysis from the visible local dev reload
path. The coordinator owns the local Miniflare artifact analyzer and the
translation from grouped codegen analysis to flattened backend activation
metadata.

Convex references copied in principle:

- `npm-packages/convex/src/cli/lib/components.ts`
  - the dev/deploy orchestration calls a backend push boundary rather than
    treating analysis as a separate application-level step.
- `crates/application/src/deploy_config.rs`
  - `start_push` owns evaluation/analysis before returning the deployment
    metadata needed by final codegen.

Intentional and temporary differences:

- Hosted Convex analysis happens inside the backend process. Flarex local dev
  cannot literally run Miniflare from inside the backend Worker/Durable Object,
  so the local backend coordinator is a Node-side stand-in for the hosted
  artifact service.
- The backend HTTP/DO API still accepts `analysis` in `StartPushRequest`.
  Removing that field requires a hosted or service-bound analyzer available to
  the backend runtime.
- The coordinator uses the local Miniflare adapter. Production should replace
  this with the hosted Dynamic Worker analysis/invocation adapter.

Tests prove:

- callers pass only `SourcePackage` to `LocalBackendPushCoordinator.start()`,
  and
- the coordinator owns artifact analysis and sends normalized analyzed metadata
  to backend `push/start`.

`flarex-dev` now has a package-level Vitest config with serial file execution,
matching the backend package. The dev tests create Vite/esbuild/Miniflare
runtimes; serial execution avoids Windows workspace-test resource exhaustion
while preserving the same assertions.

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

### Phase 4 Step 5 Implementation Update

Previous completed checkpoint: `67b2e04` Move local analysis behind push
coordinator.

Split the prototype push API into a public source-only request and an internal
analyzed-candidate request.

Public request:

```ts
type StartPushRequest = {
  sourcePackage: PushSourcePackage;
};
```

Internal prototype request:

```ts
type AnalyzedStartPushRequest =
  | { sourcePackage: PushSourcePackage; analysis: DeploymentAnalysis }
  | { sourcePackage: PushSourcePackage; error: string };
```

Backend routes now behave as:

```txt
POST /deployments/:deploymentId/push/start
  source package only
  returns 501 until backend artifact analysis is configured

POST /deployments/:deploymentId/push/start-analyzed
  internal prototype route used by local dev coordinator
  stores analyzed/failed candidate in DeploymentDO
```

`LocalBackendPushCoordinator` now depends on a `BackendSourceAnalyzer`
interface. The local implementation, `LocalExecutionArtifactBackendAnalyzer`,
wraps the Miniflare execution-artifact adapter. The coordinator calls that
backend analyzer and then posts to the internal analyzed route. This keeps
analysis out of `StartPushRequest` while preserving the working local-dev
prototype.

Convex references copied in principle:

- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - the public push request sends source/config material to the backend push
    boundary; analyzed metadata is a backend result, not client-authored
    deployment truth.
- `crates/application/src/deploy_config.rs`
  - `start_push` evaluates and analyzes push contents before candidate
    activation.

Intentional and temporary differences:

- Convex does not need an exposed `start-analyzed` route. Flarex keeps this as
  an internal local-dev bridge until the backend runtime has a hosted Dynamic
  Worker analyzer service.
- `POST /push/start` currently returns 501 instead of analyzing because the
  Worker/Durable Object runtime cannot yet create candidate execution
  artifacts by itself.
- `DeploymentDO` still stores the same validated candidate schema/functions.
  Only the boundary shape changed.

Tests prove:

- public source-only `push/start` rejects with the expected backend-analysis
  not-configured error,
- internal `push/start-analyzed` still stores, supersedes, and activates
  candidates, and
- local dev's coordinator posts analyzed metadata only through the internal
  analyzed route.

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

### Phase 4 Step 6 Implementation Update

Previous completed checkpoint: `c563d88` Make push start source-only.

Connected the public source-only `push/start` route to a backend analyzer
binding.

Backend behavior is now:

```txt
POST /deployments/:deploymentId/push/start
  -> read StartPushRequest { sourcePackage }
  -> call env.FLAREX_ANALYZER /analyze when configured
  -> forward { sourcePackage, analysis } to internal /push/start-analyzed
  -> return DeploymentDO PushStatus
```

If `FLAREX_ANALYZER` is not configured, the route still returns the explicit
501 analysis-not-configured error. That keeps hosted production honest until
the Dynamic Worker analyzer service is implemented.

Local dev configures `FLAREX_ANALYZER` as a Miniflare service binding backed
by `createLocalAnalyzerService()`. That service uses
`LocalExecutionArtifactBackendAnalyzer`, which wraps the local Miniflare
execution artifact adapter. `LocalBackendPushCoordinator` is now source-only
again and posts only to public `push/start`.

Convex references copied in principle:

- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - `StartPushRequest` carries source/config inputs; `StartPushResponse`
    carries backend-produced analysis.
- `npm-packages/convex/src/cli/lib/components.ts`
  - the client pushes source material and final codegen consumes the backend
    push response.
- `crates/application/src/deploy_config.rs`
  - backend `start_push` evaluates and analyzes candidate contents before
    activation.

Intentional and temporary differences:

- Convex performs analysis inside its backend isolate stack. Flarex local dev
  uses a service binding to a Node-side Miniflare analyzer because the hosted
  Dynamic Worker analyzer path is not implemented yet.
- `/push/start-analyzed` remains an internal prototype route behind the
  analyzer binding. It should disappear or become private platform plumbing
  once hosted backend analysis is real.
- Analyzer failures currently become failed push candidates. Later schema and
  module validation should preserve richer analysis logs and source positions.

Tests prove:

- source-only `push/start` still rejects when no analyzer binding exists,
- local dev supplies an analyzer service binding and successfully reloads via
  public `push/start`,
- the local analyzer service returns flattened backend deployment analysis,
  and
- the coordinator no longer sends analysis itself.

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

### Phase 4 Step 7 Implementation Update

Previous completed checkpoint: `0a57edd` Analyze push source through backend
binding.

Added bounded analyzer diagnostics to the push contract and `DeploymentDO`
candidate state.

Backend behavior is now:

```txt
POST /deployments/:deploymentId/push/start
  -> call FLAREX_ANALYZER /analyze
  -> receive { analysis, diagnostics } or { error, diagnostics }
  -> store diagnostics with the analyzed or failed push
  -> return diagnostics from push/start and push/:id
```

`DeploymentDO` stores diagnostics in `pushes.diagnostics_json` and validates
at most the newest 100 entries. This mirrors Convex's bounded analysis log
retention rather than letting import-time output grow unbounded.

Convex references copied in principle:

- `crates/isolate/src/environment/analyze.rs`
  - `AnalyzeEnvironment` has `collected_logs: VecDeque<String>`.
  - analysis keeps a maximum of 100 import-time console log entries.
  - failed analysis appends collected logs to the deployment error message for
    push failure reporting.

Intentional and temporary differences:

- Convex appends collected import-time logs into the JavaScript analysis error
  string. Flarex stores structured `{ level, message }` diagnostics beside the
  error so the push API can later expose logs, warnings, and source-positioned
  diagnostics without reparsing text.
- Convex captures logs inside its Rust/V8 isolate. Flarex currently captures
  logs in the local Miniflare execution artifact and forwards them through the
  analyzer service binding. Hosted Flarex must move the same contract behind
  the Dynamic Worker analyzer runtime.
- Flarex currently captures `console.log`, `console.warn`, and `console.error`
  only. More console methods and source positions remain future work.

Tests prove:

- failed push candidates retain diagnostics when returned from `push/start` and
  later fetched by `push/:id`, and
- local execution-artifact analysis captures import-time console output before
  module analysis.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Runtime Materializer Cache Update

Previous completed checkpoint: `f88296c` Authorize artifact runtime calls.

The hosted runtime service path now has a materializer/cache abstraction. The
backend still sends an `ExecutionArtifactInvokePayload`, but the runtime
service can now materialize once and reuse the artifact for repeated invokes.

Added behavior:

- first invoke for an artifact calls `ExecutionArtifactMaterializer.materialize`,
- repeated invokes with the same `artifactId` and source package hash reuse the
  cached `MaterializedExecutionArtifact`,
- a reused `artifactId` with a different source package hash rematerializes,
- runtime service validates artifact identity headers before materialization.

Convex references inspected:

- `crates/application/src/module_cache/mod.rs`
  - cache key includes sha256 to avoid stale module reuse.
- `crates/node_executor/src/executor.rs`
  - executor request/response model includes source package identity and
    import/download timing.

Cloudflare difference:

- Flarex's cache currently lives in a service helper and is in-memory per
  runtime instance. It is not distributed and has no eviction policy yet.
- The actual materializer still needs to load/build a Cloudflare Dynamic Worker
  artifact from R2.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

### Phase 5 Step 1 Implementation Update

Previous completed checkpoint: `b3e17bb` Preserve analyzer diagnostics in
push state.

Added the first import-phase compatibility prelude to the local execution
artifact analyzer.

Before importing developer modules for analysis, the generated artifact now:

- captures console diagnostics,
- installs a fixed `Date.now()` and zero-argument `new Date()` timestamp,
- installs deterministic `Math.random()`,
- rejects import-time `fetch()`,
- rejects import-time `crypto.randomUUID()`,
- rejects import-time `crypto.getRandomValues()`,
- rejects import-time `performance.now()`.

Rejected import-time APIs throw clear deployment-analysis errors and append an
`error` diagnostic before the import fails. This makes failed analysis useful
to the pusher and keeps the candidate push state compatible with the structured
diagnostics added in the previous checkpoint.

Convex references copied in principle:

- `crates/isolate/src/environment/analyze.rs`
  - `AnalyzeEnvironment` seeds `ChaCha12Rng` from
    `udf_config.import_phase_rng_seed`.
  - `unix_timestamp()` returns `udf_config.import_phase_unix_timestamp`.
  - `crypto_rng()` rejects cryptographic randomness at import time.
  - `performance_now()` and `performance_time_origin()` reject the Performance
    API at import time.
  - `syscall()` and async syscall paths reject database/syscall use at import
    time.

Intentional and temporary differences:

- Convex enforces these rules inside its Rust/V8 isolate environment. Flarex
  currently enforces them in a generated Miniflare analysis prelude by patching
  globals before dynamic imports.
- Convex supports a configured import timestamp and RNG seed per deployment
  config. Flarex currently uses fixed prototype constants and must later make
  them deployment-configurable and persisted.
- This slice does not yet block database/syscall access because user code still
  has no analysis-time `ctx.db` or syscall capability. That must remain true
  when the hosted execution artifact runtime is added.
- Hosted Dynamic Worker analysis still needs probes to verify which globals can
  be patched consistently across cold isolates.

Tests prove:

- two separate local analysis artifacts observe identical import-time
  `Date.now()`, `new Date()`, and `Math.random()` diagnostics, and
- top-level `fetch`, `crypto.randomUUID`, `crypto.getRandomValues`, and
  `performance.now` fail analysis with structured diagnostics.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

### Phase 6 Step 2 Implementation Update

Previous completed checkpoint: `363d7e0` Add local execution artifact runtime
invoke.

Added the first execution artifact store boundary.

`flarex/artifacts` now owns the deterministic source-package manifest hash and
`ExecutionArtifactRef` validation. `DeploymentDO` uses that shared helper
instead of its previous local duplicate.

`flarex-dev` now has `ExecutionArtifactStore` and
`LocalInMemoryExecutionArtifactStore`. Local dev stores the source package
before `finish_push`, then validates the active deployment ref exists in the
store before invoking.

This gives Phase 6 the next missing abstraction:

```txt
sourcePackage
  -> ExecutionArtifactStore.put
  -> ExecutionArtifactRef
  -> finish_push active deployment
  -> ExecutionArtifactStore.get(ref)
  -> ExecutionArtifactRuntime.invoke(ref, request)
```

Convex references inspected:

- `crates/model/src/source_packages/mod.rs`
  - `SourcePackageModel::put` stores packages and returns durable
    `SourcePackageId`; `get` retrieves by ID.
- `crates/model/src/modules/types.rs`
  - module metadata carries `source_package_id`, environment, analyzed module
    metadata, and module `sha256`.
- `crates/application/src/application_function_runner/mod.rs`
  - execution retrieves source package metadata before constructing executor
    requests.

Cloudflare difference:

- Convex stores source packages in system tables backed by its database and
  module storage. Flarex's first implementation is an in-memory dev store.
- Hosted Flarex still needs durable artifact storage, runtime authorization,
  and Dynamic Worker loading from `ExecutionArtifactRef`.

Tests prove:

- identical source package manifests produce identical refs,
- changing a module hash changes the ref,
- local store retrieves the exact source package by ref,
- retrieved packages are cloned, and
- unknown refs fail with a clear error.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Runtime Capability Authorization Update

Previous completed checkpoint: `c623476` Route invoke through artifact
runtime.

The backend-to-execution-artifact runtime path now has an optional internal
capability token.

Added pieces:

- `Env.FLAREX_ARTIFACT_RUNTIME_TOKEN?: string` in `flarex-backend`.
- `ServiceBindingExecutionArtifactRuntime` attaches
  `Authorization: Bearer <token>` when the token is configured.
- generated execution artifacts accept `Env.FLAREX_INTERNAL_TOKEN?: string`.
- generated `/__flarex_internal/*` routes reject with `401` when
  `FLAREX_INTERNAL_TOKEN` is configured and the authorization header is absent
  or wrong.
- local dev remains compatible because the token is optional.

Current internal invoke shape:

```txt
backend Worker
  -> Authorization: Bearer <runtime capability>
  -> FLAREX_ARTIFACT_RUNTIME
  -> generated /__flarex_internal/invoke
```

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - executor requests include `auth_header` and a `callback_token` issued by
    the backend key broker.
- `crates/node_executor/src/executor.rs`
  - serialized executor requests include `backendCallbackToken`,
    `authHeader`, source package identity, and package hashes.

Cloudflare difference:

- Convex has a broader authenticated executor/callback protocol. Flarex now
  has only a narrow internal bearer capability for artifact runtime calls.
- This does not yet authenticate individual syscalls from generated user code.
  Syscalls still go through backend execution sessions and need their own
  session-scoped authorization hardening later.
- Token storage/rotation is not implemented. Hosted deployment should use
  Cloudflare secret bindings or another internal secret source.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

### Phase 6 Step 3 Implementation Update

Previous completed checkpoint: `bccc7cd` Add execution artifact store
boundary.

Added the hosted artifact store contract and R2-shaped adapter.

`R2ExecutionArtifactStore` writes two JSON objects per artifact:

```txt
artifacts/{artifactId}/manifest.json
artifacts/{artifactId}/source-package.json
```

The manifest records:

```ts
{
  version: 1,
  ref: ExecutionArtifactRef,
  sourcePackagePath: string,
}
```

Reads validate:

1. manifest exists,
2. manifest version is supported,
3. manifest ref matches the requested ref,
4. source package object exists, and
5. recomputed source package ref matches the requested ref.

Convex references inspected:

- `crates/model/src/source_packages/mod.rs`
  - source packages have a model-level `put`/`get` boundary.
- `crates/model/src/source_packages/types.rs`
  - package metadata includes storage key and `sha256`.
- `crates/application/src/application_function_runner/mod.rs`
  - executor setup resolves package storage metadata and passes package hash
    information to the executor.

Cloudflare difference:

- Convex stores source package metadata in system tables and packages in module
  storage. Flarex's hosted adapter is R2-shaped and stores a manifest plus the
  normalized source package JSON.
- This checkpoint does not add a real Worker binding, hosted Dynamic Worker
  loader, authorization, or garbage collection.

Tests prove:

- `put` writes source package and manifest JSON objects,
- `get` validates manifest and source package hash before returning,
- unknown artifact refs fail clearly,
- mismatched refs fail clearly, and
- `delete` removes both objects.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

### Architecture Terminology Cleanup

Previous completed checkpoint: `da42b4a` Add analysis import phase prelude.

Cleaned the deployment-analysis roadmap to match the current architecture
decision:

```txt
developer app
  hosted by the developer anywhere
  uses Flarex client APIs

flarex/ source package
  bundled by Flarex tooling
  pushed to the Flarex backend
  analyzed and executed by the Flarex-managed Dynamic Worker runtime
```

Removed stale hosted-platform dispatch wording and standardized the terms
`source package`, `Flarex-managed execution artifact`, and `Dynamic Worker
runtime`.

Convex reference remains the same:

- `npm-packages/convex/src/cli/lib/components.ts`
  - Convex pushes backend function modules, not the developer's whole
    application.
- `crates/application/src/deploy_config.rs`
  - backend deployment analysis and activation operate on uploaded module
    packages.

Cloudflare difference: Flarex still uses Cloudflare runtime isolation, but the
documented target is now specifically the Flarex-managed Dynamic Worker runtime
for the uploaded `flarex/` source package. The developer's application is not
part of that artifact.

Verification:

```sh
git diff --check
```

### Phase 5 Step 2 Implementation Update

Previous completed checkpoint: `d1b83a9` Clarify Dynamic Worker source package
architecture.

Added a cold-isolate consistency gate to the local backend analyzer boundary.

`LocalExecutionArtifactBackendAnalyzer` now analyzes the same source package
twice through the execution-artifact adapter. The two runs are separate
Miniflare execution artifacts when using the default local adapter. The
analyzer compares the returned deployment analysis JSON and rejects the push
candidate if the metadata differs:

```txt
Flarex analysis is nondeterministic across cold isolates.
```

Diagnostics from both analysis runs are preserved. On mismatch, the analyzer
throws `ExecutionArtifactAnalysisError` with both runs' diagnostics plus an
error diagnostic for the nondeterminism failure.

Convex references copied in principle:

- `crates/isolate/src/environment/analyze.rs`
  - `AnalyzeEnvironment` controls import-time timestamp, RNG, crypto,
    Performance API, syscalls, and logs so analysis is stable.
- `crates/application/src/deploy_config.rs`
  - candidate push analysis is a backend-side deployment gate before activation.

Intentional and temporary differences:

- Convex's backend isolate environment is controlled enough that it does not
  need to double-run every module analysis as a normal compatibility check.
  Flarex uses this extra local gate while the hosted Dynamic Worker analyzer
  contract is still being proven.
- The comparison currently uses deterministic JSON for the existing analysis
  shape. Once source positions and richer metadata are added, this comparison
  must either include canonicalization for those fields or explicitly exclude
  fields that are allowed to vary.
- Successful analysis returns diagnostics from both runs, so duplicate
  import-time logs are expected in local dev until diagnostics gain structured
  run/source labels.

Tests prove:

- local backend analysis calls the execution-artifact adapter twice and returns
  combined diagnostics when metadata is stable, and
- divergent metadata across the two runs fails analysis with preserved
  diagnostics.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

### Phase 5 Step 3 Implementation Update

Previous completed checkpoint: `c471b67` Gate analysis on cold isolate
consistency.

Added first-class source-position metadata to analyzed functions.

The Flarex analysis shape now carries:

```ts
type AnalyzedSourcePosition = {
  path: string;
  startLine: number;
  startColumn: number;
};
```

Local source-package analysis and local execution-artifact analysis both derive
positions from source-map `sourcesContent` by finding exported registered
function declarations. The metadata is preserved through:

- `DeploymentAnalysis`,
- analyzer-service flattening,
- `DeploymentDO` candidate push state,
- active `functions` table metadata via `position_json`,
- `codegenAnalysis`,
- generated `functionMetadata.ts`.

Convex references copied in principle:

- `crates/model/src/modules/module_versions.rs`
  - `AnalyzedSourcePosition` stores source path, start line, and start column
    on `AnalyzedFunction`.
- `crates/isolate/src/environment/analyze.rs`
  - Convex reads handler script line/column, resolves it through the module
    source map, and stores the mapped source position when valid.

Intentional and temporary differences:

- Convex resolves the actual handler function origin from V8 and maps that
  token through the source map. Flarex currently scans original source text for
  `export const name =` or `export default` declarations. This is deterministic
  and useful, but less precise for aliases, reexports, and handler properties.
- Flarex exposes `startLine` and `startColumn` as one-based camelCase fields.
  Convex's serialized Rust model uses `start_lineno` and `start_col`.
- Source positions are now part of the cold-isolate comparison. Any future
  richer position metadata must remain canonical or be explicitly excluded.

Tests prove:

- local execution-artifact analysis reports a stable position for an exported
  function in `users.ts`,
- analyzer-service flattening preserves positions, and
- backend push state and reconstructed `codegenAnalysis` preserve positions.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

### Phase 5 Step 4 Implementation Update

Previous completed checkpoint: `6db912b` Preserve analyzed function source
positions.

Added the first active deployment pointer to `DeploymentDO`.

`finish_push` now records:

```txt
meta.active_push_id
meta.active_activated_at
```

and `GET /deployments/:deploymentId/deployment` returns:

```ts
type ActiveDeploymentStatus = {
  activePushId: string;
  activatedAt: number;
  schemaVersion: number;
  sourcePackage: PushSourcePackage;
  analysis: DeploymentAnalysis;
  codegenAnalysis: DeploymentCodegenAnalysis;
};
```

This keeps the active deployment version separate from candidate push state.
Starting a push still stores a candidate and leaves active deployment metadata
unchanged until `finish_push` succeeds.

Convex references copied in principle:

- `crates/application/src/deploy_config.rs`
  - `finish_push` is the activation boundary for checked deployment contents.
- `crates/model/src/modules/mod.rs`
  - active module metadata is applied as durable deployment state and used for
    later function resolution.

Intentional and temporary differences:

- Convex stores richer module/config versions. Flarex currently points to the
  activated push row and keeps the source package inline in Durable Object
  SQLite as prototype storage.
- There is no active Dynamic Worker artifact pointer yet. That field should be
  added when hosted source-package loading is implemented.
- Legacy direct `/schema` and `/functions` PUT routes can still mutate active
  metadata without setting an active push pointer. Those routes remain
  prototype/test helpers and should be removed from normal deployment flow.

Tests prove:

- a candidate push does not create an active deployment before finish,
- finishing a push records the active push, schema version, source package, and
  analyzed metadata, and
- a later failed finish on a superseded push does not move the active pointer.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Create-Root Artifact Invoke Activation

Previous completed checkpoint: `10c02a4` Run create-root execution sessions.

The deployment push and artifact runtime path now allows active
`partitionCreateRoot` metadata to reach execution instead of being stopped by
client/generator request shaping.

Updated flow:

```txt
push/start-analyzed
  -> active metadata includes partitionCreateRoot
public /invoke without partitionKey
  -> active deployment artifact runtime
  -> materialized source package
  -> ExecutionDO.start without partitionKey
  -> backend preallocates root id
```

Convex references:

- `crates/model/src/modules/mod.rs`
  - analyzed function metadata is durable deployment state.
- `crates/application/src/application_function_runner/mod.rs`
  - active deployment metadata drives function execution.
- `crates/model/src/source_packages/mod.rs`
  - source packages are loaded by backend-controlled identity.

Cloudflare difference: Flarex public invoke must allow missing `partitionKey`
for create-root artifact invocations. Existing-root invocations are still
validated by active function partition metadata once `ExecutionDO.start` runs.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/artifactRuntimeRoute.test.ts --maxWorkers=1
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Root Partition Analysis Lowering

Checkpoint: `40b9999` Infer existing root partitions from model table.

Previous completed checkpoint: `3bd5d77` Generate root model objects.

Deployment analysis now accepts the root model marker emitted by
`partition: model.table` and lowers it before metadata leaves analysis. This
keeps the authoritative deployment artifact compatible with the existing
selector-shaped function metadata and backend routing model.

Analysis rule:

- `partition: model.users` is valid only when args contain exactly one required
  `v.id("users")` field.
- The analyzer lowers that declaration to `model.users.byId("fieldName")`
  metadata and fills the route from the same arg when no explicit route exists.
- Multiple required ids for the same root table are rejected as ambiguous.
- No id is rejected. For mutations the error explicitly calls this
  unimplemented create-root mode.
- `model.table` is rejected for non-`_id` partition roots. Those tables must use
  the explicit generated selector.

The same logic was added to:

- `packages/flarex-dev/src/analyze.ts`
- the embedded Miniflare execution-artifact analyzer in
  `packages/flarex-dev/src/executionArtifact.ts`

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - Convex records analyzed module/function metadata as the deployment truth.
- `crates/application/src/application_function_runner/mod.rs`
  - execution consumes backend-owned source package and function metadata.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated code is completed from analysis output, not only local source
    scanning.

Cloudflare difference:

- Convex analysis does not need to derive a `PartitionDO` route. Flarex lowers
  root model declarations to existing selector metadata so hosted push,
  generated API metadata, client inference, and backend invoke all continue to
  agree on one partition key.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter @flarex/example generate
```

## Create-Root Analysis Classification

Checkpoint: `601256a` Classify create-root partition analysis.

Previous completed checkpoint: `14c303e` Prefer root model partitions in
example.

Deployment analysis now distinguishes create-root declarations from invalid
root declarations. For a root table partitioned by `_id`:

- exactly one required `v.id(table)` arg still lowers to selector metadata,
- zero required `v.id(table)` args on `mutation` or `workflowMutation` becomes
  `partitionCreateRoot`,
- zero required root ids on query/action remains invalid, and
- multiple required root ids remain invalid as ambiguous.

The policy shape is:

```ts
{
  type: "partitionCreateRoot",
  table: string,
  partitionField: "_id",
}
```

The embedded Miniflare execution-artifact analyzer returns the same shape, so
backend-style analysis and local direct analysis agree. Final codegen rejects
the policy until root id preallocation and create-root invocation are
implemented.

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - deployment analysis stores function metadata as an explicit model.
- `crates/application/src/application_function_runner/mod.rs`
  - execution reads backend-owned deployment metadata before running user code.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated files should reflect backend analysis and fail early on
    unsupported analyzed metadata.

Cloudflare difference:

- Convex can allocate new document ids inside the same database transaction.
  Flarex cannot choose a root `PartitionDO` for a new root document unless the
  backend allocates the root id before invoking user code.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
```

## Backend Create-Root Metadata Acceptance

Previous completed checkpoint: `601256a` Classify create-root partition
analysis.

Deployment metadata validation now accepts `partitionCreateRoot` as a first
class analyzed partition policy. `DeploymentDO` validates that:

- the target table exists and is active,
- the table is `partitionBy("_id")`, and
- create-root metadata does not also declare route metadata.

This lets backend push state preserve create-root analysis metadata without
pretending generated clients can execute it yet.

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - analyzed module/function metadata is a durable deployment model.
- `crates/application/src/application_function_runner/mod.rs`
  - execution consumes validated deployment metadata.

Cloudflare difference:

- Flarex deployment metadata must carry enough routing intent to choose a
  Durable Object. Convex does not need create-root routing metadata because id
  allocation and commit happen inside one logical database.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Backend Artifact Runtime Invoke Update

Previous completed checkpoint: `804a055` Add backend artifact storage binding.

Public backend invoke can now route through a backend-owned execution artifact
runtime boundary when hosted artifact bindings are configured.

Added backend pieces:

- `packages/flarex-backend/src/artifactRuntime.ts`
  - `BackendExecutionArtifactRuntime`
  - `ServiceBindingExecutionArtifactRuntime`
  - `ExecutionArtifactInvokePayload`
- optional `Env.FLAREX_ARTIFACT_RUNTIME?: Fetcher` binding.
- `/deployments/:deploymentId/invoke` now:
  - parses the normal `InvokeRequest`,
  - loads the active deployment metadata,
  - loads the active source package from `ARTIFACTS` using
    `executionArtifactRef`,
  - forwards a normalized payload to `FLAREX_ARTIFACT_RUNTIME`,
  - falls back to the prototype in-process registry when artifact runtime
    bindings are absent.

Current hosted invoke path:

```txt
POST /deployments/:deploymentId/invoke
  -> load active deployment
  -> active executionArtifactRef
  -> R2BackendExecutionArtifactStore.get(ref)
  -> FLAREX_ARTIFACT_RUNTIME /invoke
  -> generated execution artifact /__flarex_internal/invoke
  -> backend execution session syscalls
```

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - Node execution resolves `SourcePackageModel::get_latest`, signs the stored
    package URL, and sends package key/hash metadata to the executor.
- `crates/model/src/source_packages/mod.rs`
  - source package identity is durable backend model state.
- `crates/model/src/source_packages/types.rs`
  - source packages carry storage key and hash metadata used by execution.

Cloudflare difference:

- Convex sends signed storage URLs and package hashes to a Node executor.
  Flarex currently loads the source package JSON from R2 in the backend Worker
  and sends it to a runtime service binding.
- The real hosted Dynamic Worker loader should eventually materialize the
  internal execution artifact from this package/ref without sending raw source
  through a public API.
- Runtime authorization is still missing. `FLAREX_ARTIFACT_RUNTIME` must become
  an internal-only capability before this path is production safe.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Local Source Package Runtime Materializer Update

Previous completed checkpoint: `0447832` Add artifact runtime materializer cache.

The hosted invoke path now has a concrete local materializer proof. The backend
public invoke route still owns the active deployment lookup and R2 source
package load. The artifact runtime service now can materialize that package
into a Worker-shaped execution artifact and run the active function through
backend execution sessions.

Proven path:

```txt
POST /deployments/:deploymentId/invoke
  -> load active deployment
  -> R2BackendExecutionArtifactStore.get(executionArtifactRef)
  -> FLAREX_ARTIFACT_RUNTIME /invoke
  -> LocalMiniflareExecutionArtifactMaterializer.materialize(sourcePackage)
  -> generated internal /__flarex_internal/invoke wrapper
  -> backend /executions/start + syscalls + finish
```

The new integration test starts an analyzed push, stores the exact source
package in R2, finishes activation, invokes a mutation that performs
`insert()` then `patch()`, invokes a query through an index, and verifies the
artifact is materialized once then reused from the runtime cache.

Convex references copied in principle:

- `crates/application/src/application_function_runner/mod.rs`
  - active deployment execution resolves package identity before executor
    invocation.
- `crates/application/src/module_cache/mod.rs`
  - reusable loaded module state is keyed by package/module identity.
- `crates/node_executor/src/executor.rs`
  - execution is a separate executor boundary reached with package metadata.

Intentional differences:

- Flarex local development uses Miniflare as the concrete materializer instead
  of Convex's Rust/V8 runner or Node executor.
- The runtime wrapper is generated by Flarex around the stored source package.
  The developer still does not write Worker code.
- Hosted Flarex still needs the real Dynamic Worker loader, runtime eviction,
  and source-map diagnostics. The materializer contract is the boundary those
  hosted pieces should implement.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- artifactRuntimeRoute.test.ts
```

## Local Dev Uses Hosted Push/Invoke Shape Update

Previous completed checkpoint: `c8c16bb` Materialize stored source packages
locally.

Local dev now configures the backend Miniflare runtime with:

- `ARTIFACTS` R2 bucket,
- `FLAREX_ARTIFACT_RUNTIME` service binding,
- `FLAREX_ARTIFACT_RUNTIME_TOKEN`,
- `LocalMiniflareExecutionArtifactMaterializer`.

That means public local push and invoke now share the hosted deployment shape:

```txt
push/start
  -> backend analyzer service
  -> backend stores source package in ARTIFACTS
  -> finish activates executionArtifactRef

/__flarex_dev/invoke
  -> backend /deployments/:deploymentId/invoke
  -> active executionArtifactRef
  -> ARTIFACTS get(source package)
  -> artifact runtime service
  -> materialized source package execution
```

Convex references copied in principle:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - local dev uses the deployment push loop rather than a separate app-owned
    execution model.
- `crates/application/src/deploy_config.rs`
  - source packages are part of backend deployment state before activation.
- `crates/application/src/application_function_runner/mod.rs`
  - active deployment metadata controls function execution.

Intentional difference: Flarex still keeps generated app Worker support for
compatibility and future `/sync`, but normal dev invoke now goes through the
backend artifact runtime. Hosted production should keep this route shape and
swap the Miniflare materializer for the Dynamic Worker loader.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- dev.test.ts
```

## Runtime-Owned Source Package Loading Update

Previous completed checkpoint: `ef50030` Use artifact runtime for local dev
invoke.

The artifact runtime service can now own source-package loading. Runtime invoke
payloads may omit `sourcePackage` when the runtime service is configured with a
`BackendExecutionArtifactStore`; the service resolves the active
`executionArtifactRef` from its own store before materializing.

The backend service-binding runtime keeps compatibility mode by default, but
can now be configured with:

```ts
sendSourcePackage: false
```

The backend Worker exposes that through:

```txt
FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE=true
```

Local dev uses this hosted shape:

```txt
backend /deployments/:deploymentId/invoke
  -> send deploymentId + executionArtifactRef + request only
  -> FLAREX_ARTIFACT_RUNTIME
  -> runtime R2 ARTIFACTS get(ref)
  -> materialize source package
  -> execute through backend sessions
```

Convex references copied in principle:

- `crates/application/src/application_function_runner/mod.rs`
  - executor requests carry package identity and hash rather than requiring
    the application invoke path to own module bytes.
- `crates/model/src/source_packages/mod.rs`
  - source packages are durable backend state retrieved by package identity.
- `crates/node_executor/src/executor.rs`
  - execution is a package-loader boundary, not an inline source transport
    boundary.

Cloudflare difference: this is still a Miniflare/R2 local proof. Hosted Flarex
should use the same runtime-store contract with the Dynamic Worker loader.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- artifactRuntime.test.ts
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts dev.test.ts
```

## Artifact Runtime Lifecycle Update

Previous completed checkpoint: `e1ccf14` Let artifact runtime load source
packages.

The execution artifact runtime service now exposes a lifecycle surface:

```ts
dispose(): Promise<void>
cacheSize(): number
```

and cached materialized artifacts may implement:

```ts
dispose?(): Promise<void> | void
```

The runtime cache disposes artifacts when they are evicted, replaced by a new
source hash, or cleared by service disposal.

Convex references copied in principle:

- `crates/application/src/module_cache/mod.rs`
  - loaded module state is cached by identity and owned by the runtime layer.
- `crates/application/src/application_function_runner/mod.rs`
  - execution uses cached runtime state behind an application runner boundary.

Intentional difference: Flarex exposes this lifecycle at the TypeScript
runtime-service boundary because the hosted Dynamic Worker implementation is
still being prototyped. The public developer push/invoke API is unchanged.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test -- artifactRuntime.test.ts
```

### Phase 5 Step 5 Implementation Update

Previous completed checkpoint: `b08269e` Record active deployment pointer on
finish.

Runtime function resolution now prefers the active deployment analysis.

`packages/flarex-backend/src/invoke.ts` added active deployment loaders:

```ts
loadActiveDeployment(env, deploymentId)
loadActiveFunctionMetadata(env, deploymentId, path)
```

`ExecutionDO.start` now resolves:

```txt
DeploymentDO.active_push_id
  -> active push analysis.schema
  -> active push analysis.functions.functions[path]
  -> argument validation
  -> partition schema sync
  -> transaction begin
```

This means a generated execution session cannot start from a stale mutable
`/functions` table entry after a different push is active. The activated push
analysis is the contract used for function kind, argument validator, return
validator, and schema metadata.

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - `ValidatedPathAndArgs` and `FunctionMetadata` are passed into isolate
    execution after backend validation.
  - `run_mutation_inner` resolves validated path/args and return validator
    before executing the mutation and validating the outcome.
- `crates/application/src/lib.rs`
  - deployment/module analysis metadata is written before functions are run
    through the application function runner.

Cloudflare difference:

- Convex runs the analyzed module through its Rust-managed isolate runner.
  Flarex currently runs generated local execution sessions and syscalls, so
  this checkpoint makes the metadata boundary authoritative before the hosted
  Flarex-managed Dynamic Worker runtime exists.
- `executeInvoke` still has a no-active-deployment fallback for low-level
  transaction tests and prototypes. When an active deployment exists, it
  rejects paths missing from active analysis before handler execution.

Known follow-up:

- Add an active execution artifact reference alongside `active_push_id`.
- Route hosted Dynamic Worker invocation through that active artifact reference
  instead of the generated local execution harness.
- Remove normal use of legacy direct `/schema` and `/functions` mutation
  routes from development and deployment flows.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

### Phase 5 Step 6 Implementation Update

Previous completed checkpoint: `4a6e66f` Resolve execution sessions from
active deployment.

Active deployment status now includes a deterministic execution artifact
reference:

```ts
type ExecutionArtifactRef = {
  runtime: "dynamic-worker";
  artifactId: string;
  sourcePackageHash: string;
  executionModule: string;
};
```

`finish_push` computes the reference from a canonical source-package manifest,
stores it in:

```txt
meta.active_execution_artifact_ref
```

and `GET /deployments/:deploymentId/deployment` returns it next to
`activePushId`, source package, schema, function analysis, and codegen
analysis.

The source package hash is based on:

- execution module path,
- schema module path,
- function module paths,
- each module path,
- each module environment, and
- each module `sha256`.

It intentionally does not hash raw source text directly because each module
hash is already the source/source-map identity in the current source package
contract.

Convex references inspected:

- `crates/model/src/source_packages/mod.rs`
  - `SourcePackageModel::put` stores source packages as durable deployment
    metadata and returns a `SourcePackageId`.
- `crates/model/src/modules/types.rs`
  - active module metadata stores `source_package_id`, environment, analyzed
    metadata, and module `sha256`.
- `crates/application/src/application_function_runner/mod.rs`
  - function execution can resolve source package metadata and pass package
    identity/hash information into executor requests.

Cloudflare difference:

- Convex uses database-backed source package documents and module metadata.
  Flarex currently stores a deterministic artifact reference in
  `DeploymentDO` metadata and still keeps the source package JSON inline in
  Durable Object SQLite.
- The reference is not yet backed by R2, KV, or a hosted Dynamic Worker
  artifact registry. It is the stable pointer that the hosted runtime will
  consume later.

Tests prove:

- active deployment returns the expected artifact reference,
- superseded push finish attempts do not move the active artifact reference,
  and
- a later activated push moves both `activePushId` and
  `executionArtifactRef` together.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

### Phase 6 Step 1 Implementation Update

Previous completed checkpoint: `d5e13dd` Store active execution artifact
reference.

Added the first invoke-side execution artifact runtime boundary in local dev.

The active deployment record's `executionArtifactRef` is now consumed by
`createFlarexDevRuntime` when handling:

```txt
POST /__flarex_dev/invoke
```

Local dev resolves the active deployment from the backend, passes its
`executionArtifactRef` to `LocalMiniflareExecutionArtifactRuntime`, and invokes
the generated execution artifact through:

```txt
POST /__flarex_internal/invoke
```

The generated Worker still supports public `/invoke`, but it also exposes the
internal artifact endpoint required by the future hosted Dynamic Worker
adapter.

Convex references inspected:

- `crates/application/src/application_function_runner/mod.rs`
  - source package identity and package hashes are passed into executor
    requests when execution happens outside the main Rust isolate path.
- `crates/model/src/source_packages/mod.rs`
  - source packages are durable deployment metadata looked up for execution.

Cloudflare difference:

- Convex has a mature isolate/node executor selection path. Flarex currently
  models that as an `ExecutionArtifactRuntime` interface and a local Miniflare
  implementation.
- The hosted Dynamic Worker adapter does not exist yet. This checkpoint only
  makes invocation depend on `executionArtifactRef` through a replaceable
  runtime boundary.

Tests prove:

- the local runtime adapter calls `/__flarex_internal/invoke` with artifact
  identity headers,
- generated Worker code includes the internal invoke route, and
- local dev exposes the active deployment `executionArtifactRef` while
  `/__flarex_dev/invoke` still reaches backend execution sessions/syscalls.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

### Phase 5: Import-Phase Compatibility Layer

1. Port Convex's import-phase restrictions into the Flarex execution-artifact
   runtime where Cloudflare permits.
2. Add static bundle checks for import-time capabilities that cannot be safely
   controlled.
3. Add cold-isolate consistency tests for analyzed function metadata.
4. Block hosted activation until candidate analysis satisfies the import-phase
   contract.

### Phase 6: Hosted Dynamic Worker Runtime

1. Store immutable candidate source packages.
2. Build or load internal execution artifacts for those source packages.
3. Invoke internal analysis through the Dynamic Worker analyzer boundary.
4. Apply CPU, subrequest, egress, and import-phase restrictions.
5. Route invocation through the active execution-artifact pointer.
6. Garbage-collect failed and superseded candidates.

### Phase 7: Schema Validation And Activation

1. Port schema diff and push race detection semantics.
2. Validate existing shard documents against candidate schemas.
3. Track index creation/backfill status across relevant partitions.
4. Activate candidate metadata and execution artifact atomically in
   `finish_push`.

## Required Tests

- Registration metadata matches Convex-style markers and validator exporters.
- Undefined validators fail during analysis with useful source context.
- Non-function exports are ignored.
- Invalid registered exports fail the push.
- Import-time database, syscall, crypto-randomness, and external-I/O attempts
  fail analysis.
- Separate cold analysis isolates produce identical authoritative metadata.
- Function name, kind, visibility, args, returns, and source positions survive
  bundle -> analysis -> persistence -> invocation.
- Schema is evaluated independently from function modules.
- Failed candidate analysis leaves the active deployment unchanged.
- Concurrent pushes produce a deterministic race/superseded result.
- Final codegen consumes backend analysis, not local source scanning.
- Local Miniflare and hosted Dynamic Worker adapters pass the same push
  contract suite.
- Runtime invocation resolves only active authoritative metadata.

## Known Intentional Differences

- Flarex adds `workflowMutation`; Convex has query, mutation, and action UDF
  types.
- Flarex uses a Flarex-managed Dynamic Worker runtime instead of Convex's
  Rust/V8 function runner.
- Flarex may initially enforce a stricter import-time API subset where
  Cloudflare cannot reproduce Convex's controlled import environment.
- Flarex schema validation and index preparation must account for partitioned
  Durable Object storage rather than one Convex deployment database.

These differences must remain isolated behind execution-artifact, schema
validation, and partition coordination boundaries. The developer-facing module,
analysis, validation, and push mental model should remain as close to Convex as
possible.

## Verification

Documentation and research only:

```sh
git diff --check
```

## Implementation Checkpoints

### `5b61214` Add Convex-style function registration contract

Added Convex-style function registration forms, runtime markers, validator
exporters, internal actions, strict serialization, tests, and the detailed
deployment-analysis plan in this roadmap.

### `101eb89` Analyze Convex-style function metadata

Changed local analysis to classify functions from Convex-style runtime markers,
call validator exporters, validate their JSON, and return normalized argument
and return metadata.

### `0ff9e46` Generate metadata from analyzed functions

Changed final codegen and generated Worker validation to consume static
analyzed metadata while limiting the runtime registry to executable `_handler`
lookup.

### `9eaf596` Bundle deterministic Flarex source packages

Split generation into explicit phases and added deterministic, source-mapped,
hashed function, schema, and internal execution bundles that local analysis can
consume without developer filesystem access.

### `054a81e` Analyze schema from Flarex source packages

Changed local source-package analysis to return both analyzed functions and
analyzed schema, then made final codegen and generated Worker runtime consume
that complete deployment analysis.

### `e2f28b8` Add backend deployment push lifecycle

Added backend candidate push routes and `DeploymentDO` push state so analyzed
source packages can be started, inspected, superseded, failed, and atomically
activated.

### `7abaa43` Use backend push lifecycle in local dev

Changed local dev reload to start and finish backend candidate pushes instead
of deploying schema/functions through the legacy direct metadata routes that
existed at that checkpoint.

### `27bb9f5` Analyze source packages in execution artifact

Added the local Miniflare execution-artifact analyzer and wired local
generation/dev reload to analyze immutable source packages through that
Cloudflare-shaped boundary.

### `3cbd471` Return codegen analysis from push start

Added `codegenAnalysis` to backend push status and changed local dev final
codegen to consume the backend push response.

### `67b2e04` Move local analysis behind push coordinator

Added `LocalBackendPushCoordinator`, moved local artifact analysis out of the
dev reload loop, and made `flarex-dev` tests run serially for stable
Vite/esbuild/Miniflare execution on Windows.

### `b3e17bb` Preserve analyzer diagnostics in push state

Added structured analyzer diagnostics to the push contract, persisted them in
`DeploymentDO`, and captured import-time console output in the local execution
artifact analyzer.

### `d1b83a9` Clarify Dynamic Worker source package architecture

Cleaned stale hosted-platform dispatch wording and clarified that Flarex
bundles only the uploaded `flarex/` source package for its managed Dynamic
Worker runtime.

### `c471b67` Gate analysis on cold isolate consistency

Added a local analyzer gate that analyzes the same source package twice through
fresh execution artifacts and rejects nondeterministic analyzed metadata before
the backend stores it.

### `6db912b` Preserve analyzed function source positions

Added source-position metadata to analyzed functions and preserved it through
local analysis, backend push state, active function metadata, codegen analysis,
and generated function metadata.

## Partition Metadata Runtime Binding Update

## Root Model Partition Analysis Plan

Checkpoint title: `Plan explicit partition table API`

Previous completed checkpoint: `ff5dae0` Generate partition-scoped mutation
types.

The v1 partition API target changes analysis from selector metadata to root
model metadata:

```ts
partition: model.documents
```

Analysis should resolve that declaration into one of these backend policies:

- existing root partition: exactly one required `v.id("documents")` argument
  exists, so the backend routes from that argument,
- create root partition: mutation has zero required `v.id("documents")`
  arguments, so the backend preallocates a root ID before execution,
- invalid: query has zero root IDs, or query/mutation has multiple required
  root IDs for the same root table.

What changed:

- The roadmap now treats `model.<rootTable>` as the final v1 metadata source.
- `model.<rootTable>.byId("arg")` remains a compatibility shape from the
  previous prototype.
- Backend analysis must own ambiguity rejection. Generated TypeScript may help,
  but deployment analysis is the authority.

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - analyzed function metadata is durable backend state.
- `crates/application/src/application_function_runner/mod.rs`
  - runtime function execution consumes analyzed deployment metadata.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated files are written from analysis results.
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
  - generated server APIs expose app-specific helper objects.

Cloudflare difference:

- Convex does not analyze shard-routing metadata because function execution
  targets one logical deployment database. Flarex analysis must produce a
  concrete root partition policy before invocation can start.

Remaining limitations:

- Current analysis extracts `exportPartition()` selector objects with
  `argField`.
- Active backend metadata has no create-mode partition policy yet.
- Final codegen still emits selector-based model helpers.
- `model.<rootTable>.byId(...)` must stay until active deployment metadata,
  runtime invocation, sync, and generated clients support root-model policies.

Verification:

```sh
Documentation-only change; no runtime validation required.
```

## Root Model Migration Order

Checkpoint title: `Document root model migration order`

Previous completed checkpoint: `fa7bf98` Add explicit schema table
constructors.

What changed:

- Documented that deployment analysis is the blocker for removing
  selector-style model helpers.
- Analysis must eventually convert `partition: model.<rootTable>` into one of:
  - existing-root policy with the inferred root ID argument,
  - create-root policy requiring backend preallocation,
  - analysis error for query create mode or ambiguous multiple root IDs.
- Until those policy shapes are active metadata, `.byId(...)` remains a
  required compatibility helper.

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - analyzed function metadata is the durable deployment contract.
- `crates/application/src/application_function_runner/mod.rs`
  - invocation consumes analyzed metadata, not ad hoc client intent.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - codegen should follow authoritative analysis output.

Cloudflare difference:

- Convex analysis does not need to encode a `PartitionDO` route. Flarex must
  preserve selector metadata until the new root-model policy can drive Durable
  Object selection and root allocation.

Remaining limitations:

- No root-model policy type exists in `DeploymentAnalysis` or active backend
  function metadata yet.
- No create-root preallocation path exists in execution sessions.

Verification:

```sh
Documentation-only change; no runtime validation required.
```

## Required Partition Metadata Runtime Update

Checkpoint title: `Require partition metadata for execution`

Previous completed checkpoint: `7673d45` Bind execution sessions to partition
metadata.

The analyzed `partition` field is now required for normal backend execution.
Route metadata and raw `partitionKey` are no longer accepted as fallback
authority paths.

What changed:

- Backend execution rejects active query/mutation metadata without
  `partition`.
- Route metadata remains stored and propagated for compatibility, but runtime
  scope resolution does not use it unless a partition descriptor is already
  present and needs consistency checking.
- Direct legacy test fixtures were updated to include partition metadata and
  owner tables where colocated tables need a partition root.

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - deployment metadata is the backend-owned function authority.
- `crates/application/src/application_function_runner/mod.rs`
  - active deployment metadata selects the function execution context.
- `crates/function_runner/src/lib.rs`
  - backend-owned transaction state, not client input, determines execution.

Cloudflare difference:

- Flarex's deployment metadata must include enough information to choose a
  concrete `PartitionDO`. Convex does not store this extra partition selector
  because its backend database is logically global.

Remaining limitations:

- The legacy direct `/functions` metadata route can still store functions
  without partition metadata, but those functions cannot execute through
  normal invoke/session paths.
- Future global/projection/workflow metadata should add explicit non-partition
  policies instead of reintroducing raw `partitionKey` authority.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Partition Metadata Runtime Binding Update

Checkpoint title: `Bind execution sessions to partition metadata`

Previous completed checkpoint: `231447a` Preserve partition selector metadata.

The analyzed and stored `partition` metadata now participates in backend
execution, not only in generated files and push validation.

What changed:

- `DeploymentFunctionMetadata.partition` is resolved into a
  `FunctionExecutionScope` at execution start.
- Direct `/invoke` and `ExecutionDO` both prefer stored partition metadata over
  route metadata when validating the target shard.
- The backend rechecks that the partition descriptor still matches the active
  schema before opening a `PartitionDO` transaction. At this checkpoint that
  also protected prototype direct metadata routes; those public routes were
  later removed.
- Added regression coverage for stored metadata in the direct invoke and
  execution-session paths.

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - analyzed function metadata is backend deployment state.
- `crates/application/src/application_function_runner/mod.rs`
  - active deployment metadata selects the function execution context.
- `crates/function_runner/src/lib.rs`
  - execution merges user-code reads and writes into backend-owned transaction
    state.

Cloudflare difference:

- Convex does not have to turn function metadata into a Durable Object name.
  Flarex must resolve `partition.table/selector/argField` into a concrete
  `PartitionDO` key before starting the transaction.

Remaining limitations:

- Runtime binding does not remove the legacy explicit `partitionKey` transport
  field yet; generated clients still send it.
- This does not yet persist execution-session state across `ExecutionDO`
  eviction.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

## Partition Metadata Analysis Update

Checkpoint title: `Preserve partition selector metadata`

Previous completed checkpoint: `63896da` Generate model partition selectors.

Deployment analysis now treats function partition selectors as authoritative
metadata, not just local codegen sugar.

What changed:

- Local source-package analysis reads each function's `exportPartition()`
  marker and returns partition metadata in `DeploymentAnalysis`.
- The embedded execution-artifact analyzer performs the same extraction inside
  the backend-shaped isolate boundary.
- `LocalBackendPushCoordinator` and backend analysis conversion preserve
  partition metadata into the analyzed push request.
- `DeploymentDO` persists `partition_json` on active functions and exposes it
  through `/functions`, active deployment status, and push `codegenAnalysis`.
- Backend validation cross-checks partition metadata against the analyzed
  schema before a candidate push can be stored:
  - target table must exist and be active,
  - target table must use `partitionBy`,
  - selector and partition field must match the schema placement,
  - the referenced argument must be required,
  - explicit `route` metadata must match the partition argument.

Convex references:

- `crates/model/src/modules/module_versions.rs`
  - analyzed function metadata is stored as backend-owned deployment state.
- `npm-packages/convex/src/server/impl/registration_impl.ts`
  - runtime function wrappers export validator metadata for backend analysis.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final codegen is derived from backend/analyzed metadata.

Cloudflare difference:

- Convex analysis validates function/module metadata but does not need to bind
  functions to user-visible shard selectors. Flarex must validate this extra
  partition selector because it determines which `PartitionDO` owns execution
  and OCC.

Remaining limitations:

- Push validation proves the declared route and schema match; it does not yet
  prove every future `ctx.db` access stays inside the scoped placement at the
  TypeScript level.

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
```

## Backend Artifact Storage Binding Update

Previous completed checkpoint: `873fee7` Add R2 execution artifact store
adapter.

`flarex-backend` now owns the first hosted artifact-storage boundary instead
of depending on `flarex-dev` infrastructure code.

Added backend pieces:

- `packages/flarex-backend/src/artifactStore.ts`
  - `BackendExecutionArtifactStore`
  - `R2BackendExecutionArtifactStore`
  - `manifestKey(ref)`
  - `sourcePackageKey(ref)`
- optional `Env.ARTIFACTS?: R2Bucket` binding.
- public `push/start` persists the uploaded source package after successful
  backend analysis when `ARTIFACTS` is configured.
- public `push/:pushId/finish` verifies that the analyzed push's execution
  artifact exists in durable storage before forwarding activation to
  `DeploymentDO`.

Current public hosted path:

```txt
POST /deployments/:deploymentId/push/start
  -> FLAREX_ANALYZER analyzes uploaded flarex/ source package
  -> R2BackendExecutionArtifactStore.put(sourcePackage)
  -> DeploymentDO /push/start-analyzed

POST /deployments/:deploymentId/push/:pushId/finish
  -> load candidate push metadata
  -> recompute executionArtifactRef
  -> verify R2 manifest/source package
  -> DeploymentDO finish_push activates candidate
```

The stored object layout matches the local/dev R2-shaped adapter:

```txt
artifacts/{artifactId}/manifest.json
artifacts/{artifactId}/source-package.json
```

Convex references inspected:

- `crates/model/src/source_packages/mod.rs`
  - `SourcePackageModel::put` and `get` store source package metadata as
    backend-owned durable state.
- `crates/model/src/source_packages/types.rs`
  - `SourcePackage` tracks storage key, package hash, package size, external
    dependency package, and runtime node version metadata.
- `crates/application/src/deploy_config.rs`
  - `finish_push` downloads source packages by storage key and sha256 before
    committing deployment metadata.
- `crates/application/src/application_function_runner/mod.rs`
  - Node execution resolves the latest source package and passes storage
    identity/hash to the executor.

Cloudflare difference:

- Convex stores package metadata in system tables and package bytes in module
  storage. Flarex currently stores the source package JSON directly in R2
  under the deterministic execution artifact ID.
- Convex's `finish_push` receives the original `StartPushResponse` and runs the
  commit in the Rust backend transaction. Flarex public finish now verifies R2
  availability before calling `DeploymentDO`, while `DeploymentDO` still owns
  push state and activation.
- The internal `/push/start-analyzed` route remains a prototype/local-dev escape
  hatch. Hosted production should eventually protect or remove it once backend
  analysis and artifact storage are fully authoritative.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
```

## Remove Direct Metadata Routes

Previous completed checkpoint: `63637f9` Harden create-root sync docs and
tests.

The public legacy metadata mutation routes are removed:

```txt
PUT /deployments/:deploymentId/schema     -> 404
GET /deployments/:deploymentId/schema     -> 404
PUT /deployments/:deploymentId/functions  -> 404
GET /deployments/:deploymentId/functions  -> 404
```

Runtime invocation now requires an active deployment created by the push flow.
`executeInvoke()` loads `/deployment`, uses active analyzed schema, and treats
active function metadata as authoritative when it exists. Tests that used old
schema/function writes now activate analyzed pushes through:

```txt
POST /deployments/:deploymentId/push/start-analyzed
POST /deployments/:deploymentId/push/:pushId/finish
```

What changed:

- Removed public Worker routing for direct schema/functions metadata.
- Removed `DeploymentDO` direct `PUT /schema`, `GET /schema`, `PUT /functions`,
  and `GET /functions` handlers.
- Removed invoke fallback helpers that loaded mutable schema/function metadata
  outside the active deployment record.
- Migrated backend invoke, execution, and push tests to push-activated
  deployment metadata.
- Added a regression that direct schema/functions metadata routes return 404.

Convex references:

- `crates/application/src/deploy_config.rs`
  - deployment changes are applied through push/finish, not arbitrary metadata
    replacement routes.
- `crates/model/src/modules/mod.rs`
  - analyzed module/function metadata is durable deployment state.
- `crates/application/src/application_function_runner/mod.rs`
  - execution resolves the active deployment/package metadata before running
    user code.

Cloudflare difference: Flarex still has `/push/start-analyzed` for local dev
and tests because the hosted Dynamic Worker analyzer is not the only analyzer
yet. The removed routes were more dangerous because they bypassed source
package identity entirely.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/push.test.ts test/invoke.test.ts test/executionDO.test.ts --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run --maxWorkers=1
corepack pnpm --filter flarex-backend build
```

## Typed Codegen To Backend Analysis Conversion

Previous completed checkpoint: `63637f9` Harden create-root sync docs and
tests.

What changed:

- Changed `backendAnalysisFromCodegenAnalysis(...)` in `flarex-dev` to return
  backend `DeploymentAnalysis` directly.
- Converted generated schema validators into backend validator JSON,
  recursively rejecting unsupported BigInt literal validators instead of
  allowing the wider developer-side validator type to leak into backend
  metadata.
- Converted generated function metadata into backend
  `DeploymentFunctionMetadata`, including typed query/mutation args, returns,
  positions, and executable partition metadata.
- Made `partitionRoot` fail at the backend-analysis conversion boundary because
  it is a generated model-table handle, not executable backend function
  metadata. `partition` and `partitionCreateRoot` remain accepted.

Why it changed:

The hosted sync generation test needs the normal generated app analysis to feed
the backend push and executor activation path. A shallow test-local guard would
hide metadata drift. The shared converter is the correct boundary: once codegen
analysis crosses into backend deployment state, TypeScript should treat it as
backend deployment metadata.

Convex references:

- `crates/application/src/deploy_config.rs`
  - deployed config validation turns analyzed modules/schema into authoritative
    backend deployment state.
- `crates/model/src/modules/mod.rs`
  - function metadata is stored in backend-owned deployment records after
    analysis.
- `npm-packages/convex/src/server/registration.ts`
  - developer query/mutation registrations produce metadata that backend
    analysis must normalize before execution.

Flarex differences:

- Convex performs this normalization inside the integrated backend analysis and
  deploy flow. Flarex currently performs local/dev analysis in `flarex-dev`,
  then converts that result to backend metadata before calling the Cloudflare
  backend push routes.
- Flarex has model-table `partitionRoot` handles for developer ergonomics, but
  backend executable metadata currently accepts only routed `partition` and
  root-creating `partitionCreateRoot` functions.

Known limitations:

- The converter is still local/dev TypeScript code. Hosted authoritative
  analysis should eventually run in the backend-controlled execution boundary
  and return backend metadata directly.
- The converter rejects BigInt literal validators because backend JSON metadata
  cannot represent BigInt literals.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendSyncRuntime.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
git diff --check
```
