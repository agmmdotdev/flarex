# Runtime Validation

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
