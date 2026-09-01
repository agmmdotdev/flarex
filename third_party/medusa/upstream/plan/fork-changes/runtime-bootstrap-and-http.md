# Runtime Bootstrap And HTTP Direction

## Decision

Decision recorded in:

- `5c4648c34d docs: align runtime bootstrap and nitro direction`

The Cloudflare application must remain a thin deployment and composition root.
It selects bindings, adapters, and a generated or explicit static manifest. It
must not manually reconstruct Medusa module bootstrap, repository registration,
module services, routes, middleware, events, or workflows.

The current manual Currency composition and `/currencies` Worker route are
proof-of-concept code. They prove workerd compatibility but are not the pattern
for migrating the rest of Medusa.

## Shared Bootstrap Target

Refactor the existing bootstrap path in `@medusajs/modules-sdk`,
`@medusajs/framework`, and `@medusajs/medusa` so the same Medusa application
logic can consume different resource resolvers:

```text
existing MedusaApp and MedusaModule bootstrap
                    |
          resource resolution contract
                    |
       +------------+------------+
       |                         |
Node filesystem resolver   static manifest resolver
```

The Node resolver preserves current filesystem discovery, dynamic package
resolution, HMR, and CLI behavior. The static resolver consumes imported
module exports, routes, middleware, workflows, subscribers, and loaders without
using filesystem APIs or `require.resolve` at Worker runtime.

Static discovery is an alternative input to the existing Medusa bootstrap. It
is not a separate Cloudflare bootstrap implementation.

## HTTP Target

Preserve existing Medusa route handlers and middleware behavior, but do not
treat Express middleware as the runtime-neutral primitive. The portable unit is
the Medusa HTTP resource model: route descriptors, middleware descriptors,
route ordering, matcher behavior, body-parser intent, auth/CORS intent,
request-context creation, validation, and error semantics.

Separate HTTP resource discovery and route execution from concrete Express
registration:

```text
filesystem or static resource discovery
                  |
     Medusa HTTP resource descriptors
                  |
       HTTP runtime adapter contract
                  |
       +----------+-----------+
       |                      |
 Express adapter       Cloudflare adapter
                         Hono/Nitro/H3
```

The Express adapter owns Express-specific registration and execution:

- `app.use`, `app.get`, `app.post`, and other Express registration calls.
- Express `req`, `res`, and `next` execution.
- Express body parser middleware.
- Express error middleware.
- Express session, cookie, static-file, and logging middleware.

The Cloudflare adapter must consume the same Medusa HTTP descriptors, but it
does not make Express middleware the portable contract. It may temporarily
adapt existing Medusa middleware semantics, but the target boundary is a
runtime-neutral Medusa request context and response result.

Express remains the Node adapter until the Cloudflare path passes the same API
assertions.

Do not rewrite Store and Admin handlers into Cloudflare-specific handlers when
an adapter can preserve their behavior.

## Application Root Responsibility

The final `apps/medusa-cloudflare` entrypoint should own only:

- Cloudflare bindings.
- Runtime adapter selection.
- Static manifest import.
- Worker and Nitro entrypoint configuration.

Reusable module construction, container registration, routing, middleware
ordering, validation, authentication, and response behavior belong in shared
Medusa packages.

## HTTP Integration Runtime Convergence

The current Cloudflare HTTP integration runner is intentionally transitional.
It proves that existing Medusa route handlers, middleware descriptors, route
ordering, validation, auth metadata, query parsing, and response/error
semantics can execute through the Fetch HTTP adapter and a generated static
HTTP manifest.

It is not the final Cloudflare bootstrap.

Current integration-test shape:

```text
Jest/Node integration process
        |
        | database setup, migrations, fixtures, admin user, publishable key
        v
Node Medusa test container
        |
        | api.get/api.post
        v
Cloudflare Worker HTTP runtime
        |
        v
FetchHttpAdapter + generated static HTTP manifest
        |
        v
static HTTP proof request scope and proof services
```

This keeps the existing `integration-tests/http` assertions in the loop while
the Worker-safe route graph, static manifest, and Fetch adapter mature. The
static proof services are temporary compatibility scaffolding; they must not
become a parallel Medusa runtime or a second commerce framework.

Target integration-test shape:

```text
Jest/Node integration process
        |
        | database setup and fixture orchestration
        v
Cloudflare Worker Medusa runtime
        |
        v
shared Medusa bootstrap fed by static manifests
        |
        v
real modules, links, workflows, event bus, jobs, providers, and request scope
```

The external test command and assertions should remain unchanged:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-http test:integration
```

What changes over time is the implementation behind that runtime selector:
the Worker branch should move from `staticHttpProofResources` toward a real
Cloudflare Medusa bootstrap that consumes the same static module, HTTP,
workflow, subscriber, job, and link manifests as the application runtime.

Until that bootstrap exists, route-by-route HTTP gates may use narrow proof
services to expose adapter and import-graph problems. Each such proof service
should be treated as temporary and removed or replaced once the corresponding
real bootstrapped module/runtime service can satisfy the same unchanged
integration assertion.

## Acceptance

The bootstrap migration is accepted only when:

- The actual Currency module loads through shared `MedusaApp`/`MedusaModule`
  bootstrap using a static resolver.
- Node filesystem discovery continues to pass its existing tests.
- The Cloudflare app no longer manually constructs the Currency service and
  repositories.
- The workerd import guard remains free of Node and MikroORM imports.

The first HTTP migration is accepted only when:

- the existing Express API behavior still passes through an Express adapter;
- the existing `ApiLoader` no longer registers directly on an Express app;
- one existing Medusa API handler and its required middleware execute through a
  Cloudflare-compatible adapter without rewriting the handler;
- the equivalent Express behavior remains passing.

The first slice should therefore extract the current `ApiLoader` registration
path into an adapter contract and an `ExpressHttpAdapter`. Static manifests and
Cloudflare execution should build on that resource model after the Express path
is behaviorally unchanged.

## Express HTTP Adapter Boundary

Implementation commit:

- `71509a8b6b refactor: HTTP registration behind Express adapter`

The first HTTP adapter slice moved concrete Express route registration out of
`ApiLoader` and into `ExpressHttpAdapter`.

Differences from original Medusa:

- `ApiLoader` still performs the same filesystem route discovery,
  middleware-file discovery, CORS/auth/body-parser setup, route sorting, and
  error handler selection.
- `ApiLoader` no longer owns direct `app.use`, `app.get`, `app.post`, or
  `_router.stack` mutation. It delegates those operations through a
  `HttpRuntimeAdapter`.
- `ExpressHttpAdapter` owns the current Express-specific behavior:
  restricted-field middleware registration, global middleware registration,
  route and route-middleware registration, policy wrapping, handler wrapping,
  error-handler registration, and HMR resource clearing.
- The unavoidable Express request-handler assertions are isolated inside the
  Express adapter boundary.
- The adapter contract uses Medusa HTTP types and does not import Express for
  error-handler typing.
- Duplicate route-parameter diagnostics now normalize the displayed route path
  to forward slashes, matching existing test expectations on Windows.

Affected boundary:

- `packages/core/framework/src/http/router.ts`
- `packages/core/framework/src/http/adapters/*`
- `packages/core/framework/src/http/routes-loader.ts`

Validation:

- Framework TypeScript build passed with
  `yarn run -T tsc --build` from `packages/core/framework`.
- Focused HTTP route/middleware suite passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/index.spec.ts`
  with 23 passing and 1 existing skipped test.
- Focused duplicate-parameter route-loader assertion passed as part of the
  HTTP route/middleware suite.
- Full `routes-loader.spec.ts` was checked and still has Windows inline
  snapshot drift for absolute/relative path separators and filesystem ordering;
  those snapshots were not updated in this slice because the adapter change
  does not depend on snapshot churn.

## Explicit HTTP Resource Set

Implementation commit:

- `078806dabf refactor: extract HTTP resource set registration`

The HTTP loader now names the discovery output as `HttpResourceSet` and splits
registration into a dedicated `#registerHttpResources(...)` helper.

Differences from original Medusa:

- Original `ApiLoader.load()` discovered filesystem resources and registered
  them in one inline method body.
- The loader now keeps discovery output explicit with routes, middlewares,
  body-parser config routes, additional-data validator routes, and optional
  error handler.
- Registration still runs through the same Express adapter and preserves the
  same ordering for body parsing, additional-data validator assignment, CORS,
  auth, publishable key, locale, sorted route middleware, routes, and final
  error handler.
- No static manifest or Cloudflare/Hono/Nitro execution path was added in this
  slice.

Affected boundary:

- `packages/core/framework/src/http/router.ts`

Validation:

- Framework TypeScript build passed with
  `yarn run -T tsc --build` from `packages/core/framework`.
- Focused HTTP route/middleware suite passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/index.spec.ts`
  with 23 passing and 1 existing skipped test.

## Filesystem HTTP Resource Resolver

Implementation commit:

- `3424a8eb39 refactor: extract filesystem HTTP resource resolver`

The current filesystem discovery path now implements the `HttpResourceResolver`
contract through `FilesystemHttpResourceResolver`.

Differences from original Medusa:

- Original `ApiLoader` constructed `RoutesLoader` and `MiddlewareFileLoader`
  directly.
- `ApiLoader` now depends on an HTTP resource resolver and receives the same
  `HttpResourceSet` shape before registration.
- `FilesystemHttpResourceResolver` is the only resolver implementation in this
  slice. It preserves the existing filesystem scan behavior and middleware
  discovery behavior.
- No static manifest resolver was added yet.
- Express registration remains behind `ExpressHttpAdapter`.

Affected boundary:

- `packages/core/framework/src/http/router.ts`
- `packages/core/framework/src/http/resolvers/*`

Validation:

- Framework TypeScript build passed with
  `yarn run -T tsc --build` from `packages/core/framework`.
- Focused HTTP route/middleware suite passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/index.spec.ts`
  with 23 passing and 1 existing skipped test.

## Static HTTP Resource Resolver

Implementation commit:

- `8cb90953de feat: add static HTTP resource resolver`

The framework HTTP layer now has a static resolver implementation that accepts
already-imported HTTP descriptors and normalizes them into `HttpResourceSet`.

Differences from original Medusa:

- Original Medusa only supports filesystem route and middleware discovery in
  this path.
- `StaticHttpResourceResolver` accepts explicit route descriptors, middleware
  descriptors, body-parser config routes, additional-data validator routes, and
  an optional error handler.
- Missing descriptor arrays normalize to empty arrays.
- Descriptor arrays are shallow-copied on resolve so resolver callers do not
  share mutable array instances with the normalized resource set.
- `ApiLoader` now accepts an optional `resourceResolver`; existing callers that
  pass `sourceDir` still use `FilesystemHttpResourceResolver`.
- No manifest generator, static route-file importer, or Cloudflare adapter was
  added in this slice.

Affected boundary:

- `packages/core/framework/src/http/router.ts`
- `packages/core/framework/src/http/resolvers/*`

Validation:

- Framework TypeScript build passed with
  `yarn run -T tsc --build` from `packages/core/framework`.
- Static resolver test passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-http-resource-resolver.spec.ts`
  with 3 passing tests.
- Focused HTTP route/middleware suite passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/index.spec.ts`
  with 23 passing and 1 existing skipped test.

## Static Resources Through ApiLoader

Implementation commit:

- `67e869f184 test: prove ApiLoader static HTTP resources`

`ApiLoader` now has focused coverage proving that a `StaticHttpResourceResolver`
can supply already-imported descriptors and still execute through the existing
Express adapter.

Differences from original Medusa:

- Original Medusa always discovers HTTP route and middleware resources from the
  filesystem in this path.
- The test fixture server can now inject an `HttpResourceResolver` while
  preserving the existing filesystem default.
- A static route descriptor can execute through `ApiLoader` and
  `ExpressHttpAdapter` without filesystem scanning.
- A static middleware descriptor can execute before a static route descriptor
  through the same sorted registration path.
- This remains a test-level proof. No production static manifest or generator
  was added in this slice.

Affected boundary:

- `packages/core/framework/src/http/__fixtures__/server/index.ts`
- `packages/core/framework/src/http/__tests__/static-http-resource-api-loader.spec.ts`

Validation:

- Framework TypeScript build passed with
  `yarn run -T tsc --build` from `packages/core/framework`.
- Static ApiLoader proof passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-http-resource-api-loader.spec.ts`
  with 2 passing tests.
- Focused HTTP route/middleware suite passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/index.spec.ts`
  with 23 passing and 1 existing skipped test.

## Static Route Module Descriptor Builder

Implementation commit:

- `4bf4fa0b3a Build static route descriptors from modules`

The HTTP layer now has a shared builder that converts an already-imported route
module export bag into `RouteDescriptor[]`.

Differences from original Medusa:

- Original Medusa parsed route-file exports only inside the filesystem
  `RoutesLoader`.
- `buildStaticRouteDescriptors` now owns the shared semantics for HTTP method
  exports, `AUTHENTICATE`, `CORS`, skipped route files, and admin/store/auth
  CORS flags.
- `RoutesLoader` still performs Node filesystem discovery, dynamic import,
  dynamic segment path creation, HMR reload handling, and filesystem metadata
  ownership, but delegates route export parsing to the shared builder.
- Static HTTP tests can import a route module directly, convert it into route
  descriptors, feed those descriptors into `StaticHttpResourceResolver`, and
  execute them through the existing `ApiLoader` plus `ExpressHttpAdapter`.
- No filesystem manifest generator, production static API route manifest, or
  Cloudflare HTTP adapter was added in this slice.

Affected boundary:

- `packages/core/framework/src/http/routes-loader.ts`
- `packages/core/framework/src/http/utils/static-route-descriptors.ts`
- `packages/core/framework/src/http/__tests__/static-route-descriptors.spec.ts`

Validation:

- Framework TypeScript build passed with
  `yarn run -T tsc --build` from `packages/core/framework`.
- Static route descriptor proof passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-route-descriptors.spec.ts`
  with 2 passing tests.
- Static ApiLoader proof passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-http-resource-api-loader.spec.ts`
  with 2 passing tests.
- Static resolver test passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-http-resource-resolver.spec.ts`
  with 3 passing tests.
- Focused HTTP route/middleware suite passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/index.spec.ts`
  with 23 passing and 1 existing skipped test.
- Full `routes-loader.spec.ts` was checked and still has Windows inline
  snapshot drift for absolute/relative path separators and filesystem
  enumeration order. The snapshots were not updated here because this slice
  intentionally does not change route precedence or filesystem ordering.

## Static Middleware Module Resource Builder

Implementation commit:

- `dab95d4d41 Build static middleware resources from modules`

The HTTP layer now has a shared builder that converts an already-imported
middleware module export bag into the middleware portion of `HttpResourceSet`.

Differences from original Medusa:

- Original Medusa parsed `defineMiddlewares(...)` output only inside
  `MiddlewareFileLoader` after filesystem discovery and dynamic import.
- `buildStaticMiddlewareResources` now owns the shared semantics for skipped
  middleware files, invalid or missing default exports, route matcher
  validation, body-parser route config, additional-data validators, middleware
  descriptors, policies, and optional error handlers.
- `MiddlewareFileLoader` still owns Node filesystem lookup and dynamic import,
  but delegates the imported module conversion to the shared builder.
- Static HTTP tests can import a middleware module directly, convert it into
  middleware resources, feed those resources into `StaticHttpResourceResolver`,
  and execute them through the existing `ApiLoader` plus
  `ExpressHttpAdapter`.
- No filesystem manifest generator, production static middleware manifest, or
  Cloudflare HTTP adapter was added in this slice.

Affected boundary:

- `packages/core/framework/src/http/middleware-file-loader.ts`
- `packages/core/framework/src/http/utils/static-middleware-resources.ts`
- `packages/core/framework/src/http/__tests__/static-middleware-resources.spec.ts`

Validation:

- Framework TypeScript build passed with
  `yarn run -T tsc --build` from `packages/core/framework`.
- Static middleware resource proof passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-middleware-resources.spec.ts`
  with 2 passing tests.
- Existing middleware filesystem loader test passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/middleware-file-loader.spec.ts`
  with 1 passing test and 2 passing snapshots.
- Focused HTTP route/middleware suite passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/index.spec.ts`
  with 23 passing and 1 existing skipped test.
- Static ApiLoader proof passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-http-resource-api-loader.spec.ts`
  with 2 passing tests.
- Static route descriptor proof passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-route-descriptors.spec.ts`
  with 2 passing tests.
- `git diff --check` passed.

## Static HTTP Resource Manifest Builder

Implementation commit:

- `ea5f0911d3 Build static HTTP resources from module manifest`

The HTTP layer now has a small manifest helper that composes already-imported
route modules and middleware modules into one `HttpResourceSet`.

Differences from original Medusa:

- Original Medusa still relies on filesystem lookup plus dynamic imports for
  route and middleware discovery.
- `buildStaticHttpResources` accepts explicit imported route module resources
  and imported middleware module resources, then delegates conversion to
  `buildStaticRouteDescriptors` and `buildStaticMiddlewareResources`.
- Static route modules and static middleware modules now have one shared
  composition point before being passed into `StaticHttpResourceResolver`.
- Multiple static middleware modules preserve the filesystem loader's error
  handler behavior: the later error handler wins.
- No generator, production route manifest, production middleware manifest, or
  Cloudflare HTTP adapter was added in this slice.

Affected boundary:

- `packages/core/framework/src/http/utils/static-http-resources.ts`
- `packages/core/framework/src/http/__tests__/static-http-resources.spec.ts`

Validation:

- Framework TypeScript build passed with
  `yarn run -T tsc --build` from `packages/core/framework`.
- Static HTTP resource manifest proof passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-http-resources.spec.ts`
  with 3 passing tests.
- Adjacent static route, static middleware, static resolver, static ApiLoader,
  middleware filesystem loader, and focused HTTP route/middleware tests passed
  before the final error-handler ordering adjustment.
- `git diff --check` passed.

## Static HTTP Manifest Resolver

Implementation commit:

- `f5b9659a1c Add static HTTP manifest resolver`

The HTTP resolver layer now has a `StaticHttpManifestResolver` that accepts
the imported-module manifest shape and resolves it into the same
`HttpResourceSet` consumed by `ApiLoader`.

Differences from original Medusa:

- Original Medusa only has filesystem route and middleware discovery in this
  path.
- `StaticHttpResourceResolver` still accepts already-normalized descriptors.
- `StaticHttpManifestResolver` accepts static route module resources and
  static middleware module resources, then delegates to
  `buildStaticHttpResources`.
- `ApiLoader` can now consume a manifest-shaped static resolver without
  changing its HTTP registration behavior or the Express adapter.
- No manifest generator, production API manifest, real Medusa route import, or
  Cloudflare HTTP adapter was added in this slice.

Affected boundary:

- `packages/core/framework/src/http/resolvers/static-manifest.ts`
- `packages/core/framework/src/http/__tests__/static-http-manifest-resolver.spec.ts`

Validation:

- Framework TypeScript build passed with
  `yarn run -T tsc --build` from `packages/core/framework`.
- Static HTTP manifest resolver proof passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-http-manifest-resolver.spec.ts`
  with 2 passing tests.
- Static HTTP resource manifest proof passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-http-resources.spec.ts`
  with 3 passing tests.
- Static resolver and static ApiLoader proofs passed.
- Focused HTTP route/middleware suite passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/index.spec.ts`
  with 23 passing and 1 existing skipped test.
- `git diff --check` passed.

## Existing API Fixtures Through Static HTTP Manifest

Implementation commit:

- `7841df8047 Prove static manifest with existing HTTP fixtures`
- `cd005fc163 Prove static manifest dynamic route params`
- `9923c9a456 Derive static HTTP routes from relative paths`
- `1279ce430c Add static HTTP manifest fixture`
- `101acdcfb7 Add package-style static HTTP manifest export`
- `dc4c63df2f Guard static HTTP manifest import graph`
- `b0475a6642 Make static HTTP manifest fixture Worker-clean`

The static HTTP manifest path now has coverage using existing Medusa-style
route and middleware fixture modules instead of only purpose-built static
fixtures.

Differences from original Medusa:

- Original Medusa discovers these route and middleware modules by scanning
  `routers-middleware` from the filesystem.
- The proof imports the existing `customers/route.ts`,
  `webhooks/payment/route.ts`, and `middlewares.ts` modules directly and feeds
  them into `StaticHttpManifestResolver`.
- The proof also imports the existing dynamic route fixture
  `store/products/[id]/sync/route.ts` and represents the filesystem-derived
  matcher explicitly as `/store/products/:id/sync` in the static manifest.
- A hand-authored `routersMiddlewareStaticHttpManifest` fixture now owns those
  imports and exports one typed `StaticHttpResourceManifest` object. The proof
  consumes that single manifest export.
- An isolated `static-http-manifest` fixture entrypoint now exports the
  standard `staticHttpManifest` name. The proof imports that entrypoint,
  matching the package subpath shape expected for future app/runtime manifests.
- A focused esbuild metafile guard now bundles only that isolated manifest
  entrypoint and asserts it does not pull in `RoutesLoader`,
  `MiddlewareFileLoader`, or the filesystem HTTP resolver.
- The package-style static manifest now uses a Worker-clean middleware fixture
  and no longer imports the filesystem `routers-middleware/middlewares.ts`
  fixture that depends on `express.raw`.
- The import guard is now stricter: it rejects filesystem discovery, Express,
  and Node built-ins in the package-style static manifest graph.
- Static route manifest entries can now provide a filesystem-style
  `relativePath` such as `/store/products/[id]/sync/route.ts`; the shared
  route path helper derives `/store/products/:id/sync`.
- The same route handlers execute through `ApiLoader` and
  `ExpressHttpAdapter` without filesystem discovery.
- Existing `defineMiddlewares` behavior is preserved for global middleware,
  method-specific middleware, and additional-data validator assignment in the
  Worker-clean package-style manifest.
- Raw webhook body parsing remains covered by the filesystem fixture and core
  HTTP route/middleware suite because it currently depends on Express raw
  middleware.
- Dynamic route parameters are populated from the explicit static matcher, and
  store namespace middleware still applies to the dynamic route.
- The filesystem `RoutesLoader` and static manifest helper now share
  `createRoutePathFromRelativePath` for bracket-param conversion and duplicate
  parameter diagnostics.
- No production manifest generator or Cloudflare HTTP adapter was added in
  this slice.

Affected boundary:

- `packages/core/framework/src/http/__tests__/static-http-existing-fixtures.spec.ts`
- `packages/core/framework/src/http/__fixtures__/static-http-manifests/routers-middleware-manifest.ts`
- `packages/core/framework/src/http/__fixtures__/static-http-package/static-http-manifest.ts`
- `packages/core/framework/src/http/__fixtures__/static-http-package/middlewares.ts`
- `packages/core/framework/src/http/__tests__/static-http-manifest-import-guard.spec.ts`
- `packages/core/framework/src/http/utils/route-path.ts`
- `packages/core/framework/src/http/utils/static-http-resources.ts`
- `packages/core/framework/src/http/routes-loader.ts`

Validation:

- Framework TypeScript build passed with
  `yarn run -T tsc --build` from `packages/core/framework`.
- Existing API fixture static manifest proof passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-http-existing-fixtures.spec.ts`
  with 1 passing test.
- The proof now consumes the hand-authored static HTTP manifest fixture export
  instead of constructing the manifest inline.
- The proof now imports a package-style `staticHttpManifest` export from an
  isolated static-manifest entrypoint.
- Static HTTP manifest import guard passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-http-manifest-import-guard.spec.ts`
  with 1 passing test. The guard now rejects Express and Node built-ins for
  the package-style manifest entrypoint.
- The same proof now covers route params derived from static `relativePath`
  metadata and store namespace middleware.
- Route path utility proof passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/route-path.spec.ts`
  with 2 passing tests.
- Static HTTP manifest resolver proof passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-http-manifest-resolver.spec.ts`
  with 2 passing tests.
- Static HTTP resource manifest proof passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-http-resources.spec.ts`
  with 4 passing tests.
- Existing middleware filesystem loader test passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/middleware-file-loader.spec.ts`
  with 1 passing test and 2 passing snapshots.
- Focused HTTP route/middleware suite passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/index.spec.ts`
  with 23 passing and 1 existing skipped test.
- Full `routes-loader.spec.ts` was checked. The duplicate-param assertion
  passed, and the remaining failures are the pre-existing Windows inline
  snapshot drift for path separators and filesystem enumeration order.
- `git diff --check` passed.

## Fetch HTTP Adapter Proof

Implementation commit:

- `732dfe2f82 Add minimal Fetch HTTP adapter proof`
- `f082aedaaa Run static middleware in Fetch HTTP adapter`
- `3646baff74 Parse JSON bodies in Fetch HTTP adapter`
- `9dae1b3ae5 Handle static errors in Fetch HTTP adapter`
- `f5d83724dd Sort resources in Fetch HTTP adapter`
- `47da1d92f8 Guard Fetch HTTP adapter import graph`
- `988e8afc00 Expose Fetch HTTP framework subpath`
- `deb846911b Expose Worker-safe static HTTP subpath`
- `10f22c9594 Prove Fetch and static HTTP subpath composition`

The HTTP layer now has a minimal `FetchHttpAdapter` that executes existing
`RouteDescriptor` handlers from a resolved `HttpResourceSet` through Fetch
`Request` and `Response` objects.

Differences from original Medusa:

- Original Medusa executes route descriptors by registering them on Express.
- This fork can now execute a route descriptor directly from a static HTTP
  manifest through a Fetch-style `handle(request)` method.
- Existing Medusa route handlers are still reused unchanged. The adapter owns
  the temporary structural bridge from Fetch request/response state to the
  current Express-typed `MedusaRequest` and `MedusaResponse` boundary.
- Dynamic `:param` route segments are matched and passed to existing handlers
  through `req.params`.
- Matching static middleware descriptors now execute before the route handler.
  This covers global middleware, method-specific middleware, and wildcard
  namespace middleware for the existing static fixture routes.
- Additional-data validator routes are applied to the request shim before
  method-specific middleware executes, preserving the existing
  `req.additionalDataValidator` behavior covered by the fixture middleware.
- Middleware that does not call `next()` is treated as having handled the
  response, matching the basic Express short-circuit shape.
- JSON request bodies are parsed before middleware and route handlers when the
  request has an `application/json` content type. Parsed data is assigned to
  `req.body`.
- Matching `bodyParser: false` config routes skip JSON parsing, preserving the
  current raw-route opt-out intent at the Fetch adapter boundary.
- Thrown route errors, thrown middleware errors, and middleware `next(error)`
  now flow through the resolved static `HttpResourceSet.errorHandler` when one
  is present.
- If no static error handler is present, the Fetch adapter rethrows the error
  instead of hiding it behind a generic response.
- Route and middleware resources are sorted with the shared `RoutesSorter`
  before Fetch matching, preserving the current static-before-param route
  precedence and wildcard-before-static middleware order.
- Body-parser config routes and additional-data validator routes use the same
  `RoutesSorter` override order as `ApiLoader`: static, params, regex,
  wildcard, then global.
- Param extraction remains local to the Fetch adapter because the existing
  `RoutesFinder` can identify a matching descriptor but does not expose
  extracted params.
- A focused browser-bundle import guard now covers `FetchHttpAdapter` directly.
  It rejects Express, Express adapter registration, `ApiLoader`/router,
  filesystem route and middleware discovery, Express body-parser middleware,
  and Node built-ins in the Fetch adapter graph.
- `@medusajs/framework/http/fetch` is now a precise Worker-safe package
  subpath. It exports `FetchHttpAdapter` plus type-only HTTP resource and
  descriptor contracts without going through the broad `@medusajs/framework/http`
  barrel.
- `@medusajs/framework/http/fetch` remains adapter and type-contract focused;
  static manifest builders are exposed through a separate subpath instead of
  widening the Fetch adapter entrypoint.
- `@medusajs/framework/http/static` is now a precise Worker-safe package
  subpath for static HTTP manifest and resource builders. It exports the
  static manifest resolver, static resource resolver, static route and
  middleware builders, route-path conversion, `defineMiddlewares`, and the
  relevant type-only HTTP contracts without going through the broad HTTP
  barrel.
- Static HTTP builders no longer import the framework logger or the broad
  `@medusajs/utils` root. They use an injected `StaticHttpBuilderLogger` with a
  no-op default for Worker imports.
- Node filesystem loaders pass the existing framework logger into the shared
  static builders, preserving Node discovery diagnostics while keeping the
  shared builder import graph Worker-clean.
- The Medusa skip-file behavior is preserved through a local
  `Symbol.for("__MEDUSA_SKIP_FILE__")` helper in the HTTP static-builder
  boundary, avoiding the broad utils import that pulled Node-only utility code
  into browser bundles.
- The two precise subpaths now have a combined Worker-style composition proof:
  static resources are resolved through the static HTTP subpath and executed
  through the Fetch HTTP subpath against existing route and middleware
  fixtures.
- A package-subpath-shaped bundle guard imports
  `@medusajs/framework/http/static` and `@medusajs/framework/http/fetch`
  together, aliases only those exact subpaths to source for the test, and
  rejects the logger, `@medusajs/cli`, Express, filesystem HTTP discovery, and
  Node built-ins.
- This is only the first Cloudflare-compatible execution proof. It does not
  yet implement text or urlencoded body parsers, raw body preservation,
  size-limit enforcement, auth, CORS, publishable-key, locale, policy wrapping,
  default framework error handler parity, or streaming semantics.
- `ApiLoader` and `ExpressHttpAdapter` behavior are unchanged.

Affected boundary:

- `packages/core/framework/src/http/adapters/fetch.ts`
- `packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts`
- `packages/core/framework/src/http/index.ts`

Validation:

- Framework TypeScript build passed with
  `yarn run -T tsc --build` from `packages/core/framework`.
- Fetch HTTP adapter proof passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/fetch-http-adapter.spec.ts`
  with 6 passing tests, covering GET route execution, POST method middleware,
  additional-data validator assignment, JSON body parsing, `bodyParser: false`
  JSON parse opt-out, wildcard store middleware, dynamic route params, and 404
  behavior. After the error-handler slice, the same suite passed with 8 tests,
  adding thrown route error handling and middleware `next(error)` handling
  through a static error handler. After the sorter slice, the same suite
  passed with 10 tests, adding static-over-param route precedence and
  wildcard-before-static middleware ordering coverage.
- Existing static API fixture proof through `ApiLoader` and
  `ExpressHttpAdapter` still passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-http-existing-fixtures.spec.ts`
  with 1 passing test.
- Static HTTP manifest import guard still passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-http-manifest-import-guard.spec.ts`
  with 1 passing test.
- Fetch HTTP adapter import guard passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/fetch-http-adapter-import-guard.spec.ts`
  with 2 passing tests after the subpath slice. The guard bundles the
  Worker-safe `src/http/fetch.ts` entrypoint and verifies the
  `./http/fetch` package export map entry.
- Static HTTP builder import guard passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/static-http-builder-import-guard.spec.ts`
  with 2 passing tests. The guard bundles the Worker-safe `src/http/static.ts`
  entrypoint, verifies the `./http/static` package export map entry, and
  rejects the framework logger, `@medusajs/cli`, Express, filesystem HTTP
  discovery, and Node built-ins.
- Static route and middleware builder tests now cover modules marked with the
  Medusa skip-file symbol.
- Fetch plus static subpath composition proof passed:
  `jest --bail --forceExit --testPathPattern=src/http/__tests__/fetch-static-subpath-composition.spec.ts`
  with 2 passing tests.
- `git diff --check` passed.

## Worker Fetch HTTP Route Proof

Implementation commit:

- `1acab1e1fd Add Worker Fetch HTTP proof route`
- `7a703e45f3 Run real Medusa route through Fetch adapter`
- `64405725d3 Add Fetch HTTP request scope hook`
- `51414d15bb Add real store route Fetch proof`
- `7f7a786b22 Run store currency middleware in Fetch proof`
- `2765d11bd2 Run Store locale middleware in Fetch proof`
- `4549b15008 Run Store publishable key middleware in Fetch proof`
- `ac30e37ae1 Run optional Store auth middleware in Fetch proof`
- `85c994fb51 Run Store products route in Fetch proof`
- `259d12641a Run Store product retrieve route in Fetch proof`
- `56333a73df Prove Store product not-found in Fetch proof`
- `61c5492315 Prove Store product pricing context in Fetch proof`
- `4652bf1101 Prove Store product tax context in Fetch proof`
- `a2fc45dfb8 Prove Store product inventory in Fetch proof`
- `82fe4bce0f Prove Store product variant routes in Fetch proof`
- `182064bffb Prove Store product variant not-found in Fetch proof`
- `6ea5e871d1 Use static HTTP builder in Fetch proof`
- `2f18e83b85 Extract static HTTP proof manifest`
- `a5c09e7d5c Generate static HTTP proof manifest`
- `767734ae8e Share static HTTP manifest renderer`
- `b78d0e57e7 Generate static HTTP manifest from file list`
- `f10807b4a8 Scan selected HTTP route folders at build time`
- `df38789155 Scan HTTP middleware files at build time`

The Cloudflare Worker app now has a tiny `/http-proof/:proofId` route that
executes through the shared `FetchHttpAdapter`.

Differences from original Medusa:

- Original Medusa still executes API routes by registering handlers and
  middleware on Express.
- The Worker app now selects the Fetch adapter at the application root for one
  proof endpoint, while the handler and middleware remain normal Medusa HTTP
  descriptors.
- The proof uses an explicit, already-normalized `HttpResourceSet` in the app
  instead of importing the broad static manifest builder. This keeps the Worker
  dev graph out of the builder's eager additional-data validator/Zod path while
  still proving Fetch execution of static route and middleware descriptors.
- The app aliases only `@medusajs/framework/http/fetch` to framework source
  for Vite and the composed Worker import guard.
- The Worker proof now also imports the real
  `packages/medusa/src/api/admin/plugins/route.ts` route module and executes
  `GET /admin/plugins` through the same `FetchHttpAdapter`.
- The real route receives a Medusa container scope from route middleware with a
  configured `CONFIG_MODULE`, matching the route's existing dependency access
  pattern instead of rewriting the handler.
- The `admin/plugins` route was changed to use type-only framework HTTP and
  HTTP type imports so the Worker graph does not pull the broad
  `@medusajs/framework/http` runtime barrel through a type-only dependency.
- `FetchHttpAdapter` now accepts a typed `createRequestScope` option and
  assigns `req.scope` before middleware and route handlers execute.
- The Worker proof now supplies the configured Medusa container through the
  Fetch adapter option instead of using route-specific app middleware to attach
  `req.scope`.
- `FetchHttpAdapter` now accepts a typed `prepareRequest` option. The adapter
  calls it after body parsing and additional-data validator assignment, and
  before middleware and route handler execution. This is the runtime-neutral
  hook for request metadata normally prepared by Medusa HTTP middleware.
- The Worker proof now imports the real
  `packages/medusa/src/api/store/currencies/route.ts` route module and
  executes `GET /store/currencies` through the same Fetch adapter.
- The Store currencies route receives prepared `queryConfig`,
  `remoteQueryConfig`, `filterableFields`, locale/context fields, and a
  configured `REMOTE_QUERY` registration from the adapter-created request
  scope.
- `remoteQueryObjectFromString` now uses typed internal node records instead
  of indexing an untyped object. This keeps the app's source alias for
  `@medusajs/framework/utils` type-checkable without importing compiled
  CommonJS output into the Worker graph.
- `FetchHttpAdapter` now initializes the baseline Medusa request shape before
  middleware execution: allowed properties, errors, filterable fields, list and
  retrieve configs, query config, remote query config, and context.
- The Worker proof no longer parses Store currencies request metadata in the
  app. It imports the real Store currencies middleware declarations and builds
  their `validateAndTransformQuery` middleware through the shared static
  middleware resource builder.
- The Store currencies middleware now imports `validateAndTransformQuery` from
  `@medusajs/framework/http`, keeping the route-local middleware on the HTTP
  boundary instead of the broad framework barrel.
- The Worker app aliases `@medusajs/framework/http` to a narrow HTTP shim that
  exports the query middleware and HTTP types. The dedicated
  `@medusajs/framework/http/fetch` subpath remains adapter-only and continues
  to pass its import guard.
- HTTP query middleware and adjacent RBAC/feature-flag helpers now use precise
  utility subpaths for the Worker graph. The permission helper preserves its
  role-policy cache behavior through a local, precise-import cache helper.
- `@medusajs/deps/zod` is aliased to Zod's ESM entrypoint in the Worker app so
  Vite's workerd dev runner does not evaluate the CommonJS Medusa dependency
  re-export.
- The Worker proof now runs the real framework `applyLocale` middleware for
  `/store` before the Store currencies route-local middleware. A proof-only
  observer middleware writes the resolved locale to a response header so
  workerd validation can assert the Store global middleware ran without
  changing the Store currencies handler.
- `FetchHttpAdapter` now exposes an Express-compatible `req.get(name)` header
  accessor backed by the Fetch `Request.headers` API, which is required by
  framework middleware such as `applyLocale`.
- `applyLocale` now imports `normalizeLocale` from a precise
  `@medusajs/utils/common/normalize-locale` subpath instead of the broad utils
  barrel, and that subpath is exported from `@medusajs/utils`.
- The Worker proof now runs the real framework
  `ensurePublishableApiKeyMiddleware` for `/store` before locale and
  route-local Store currencies middleware. A typed proof query facade is
  registered as `ContainerRegistrationKeys.QUERY`, so the middleware executes
  its normal `query.graph(...)` lookup and sets `req.publishable_key_context`
  without rewriting middleware behavior.
- A proof-only observer middleware writes the publishable key context to
  response headers so workerd validation can assert the global Store
  publishable-key middleware ran before the Store currencies handler.
- `ensurePublishableApiKeyMiddleware` now imports API key constants,
  container keys, and `MedusaError` from precise utility subpaths instead of
  the broad utils barrel. Its query result is typed at the middleware boundary,
  and the publishable-key header is narrowed with an explicit string check.
- `@medusajs/framework/http/fetch` now exports the existing
  `PublishableKeyContext` type for Fetch adapter tests and Worker proof code.
- `@medusajs/utils` now exposes the `./api-key/api-key-type` package subpath
  used by Worker-safe HTTP middleware.
- The Worker proof now runs the real framework
  `authenticate("customer", ["session", "bearer"], ...)` middleware for
  `/store` with `allowUnauthenticated: true` after publishable-key and locale
  middleware and before route-local Store currencies middleware. This proves
  the optional Store auth pass-through path under the Fetch adapter without
  rewriting auth behavior in the app.
- A proof-only observer middleware writes the optional auth outcome to a
  response header so workerd validation can assert the Store auth middleware
  ran and allowed an unauthenticated public Store request.
- `authenticate-middleware` no longer statically imports Express,
  `jsonwebtoken`, the broad utils barrel, or the framework config module. It
  uses type-only Express/JWT imports, precise utility subpaths, a narrow local
  auth config shape, and a late CommonJS `module.require` loader for Node JWT
  verification. Existing Express bearer-auth behavior remains covered by the
  HTTP route/middleware suite, while the Worker graph no longer includes
  `jsonwebtoken`.
- `@medusajs/framework/http/fetch` now exports the existing `AuthContext` type
  for Fetch adapter tests and Worker proof code.
- The Worker proof now imports the real
  `packages/medusa/src/api/store/products/route.ts` route module and its real
  `storeProductRoutesMiddlewares`, builds the middleware through
  `buildStaticMiddlewareResources`, and executes `GET /store/products` through
  the same Fetch adapter after Store global publishable-key, locale, and
  optional auth middleware.
- The Store products proof uses a typed proof query facade for the product and
  sales-channel query calls needed by the route-local middleware and handler.
  The request intentionally asks for plain product fields so the proof validates
  routing, Store global middleware, product query validation, sales-channel
  filtering, and the real product handler without expanding into pricing, tax,
  or inventory calculation branches in the same slice.
- Store product route and helper middleware imports were tightened for Worker
  composition: `validateAndTransformQuery` now comes from the HTTP boundary,
  HTTP and Express-only types are type-only, and product route query/context
  shapes are locally typed instead of relying on broad `any`.
- Shared HTTP helpers used by product middleware now use precise utility
  subpaths and typed nested filter objects. The Worker utility shim and import
  guard aliases now expose only the additional product/query/tax/translation
  leaves required by the imported product route graph.
- The Worker proof now imports the real
  `packages/medusa/src/api/store/products/[id]/route.ts` route module and
  executes `GET /store/products/:id` through the same Fetch adapter and Store
  product middleware stack. This proves dynamic Store route params, route-local
  `applyParamsAsFilters`, publishable-key, locale, and optional Store auth
  metadata reach the existing retrieve handler without a Cloudflare-specific
  handler rewrite.
- The Store product retrieve handler now keeps framework HTTP/type imports
  type-only, uses a typed product query service boundary, and defaults missing
  query data to an empty list before throwing the existing Medusa not-found
  error. This removes broad untyped query access while preserving the original
  route behavior.
- The Worker proof now includes Medusa's default HTTP error handler in the
  static resource set and verifies the missing `GET /store/products/:id` path
  returns the existing Medusa `not_found` JSON shape through the Fetch adapter.
- The default framework HTTP error handler and exception formatter now use
  type-only Express imports and precise utility subpaths, so using the real
  error handler does not pull Express or the broad utils barrel into the Worker
  graph.
- The Store product retrieve middleware now uses the existing retrieve product
  validator instead of the list product validator. The retrieve handler also
  makes the path param authoritative over query-derived filters, preventing an
  empty list-filter `id` from masking the route param.
- The Worker proof now exercises the first Store product pricing-context
  branch by requesting `variants.calculated_price` fields with a region id.
  The proof query facade supplies the region data used by the real
  `normalizeDataForContext`, `setPricingContext`, and `setTaxContext`
  middleware, keeps automatic taxes disabled, and verifies the existing product
  handler receives a `QueryContext` for `variants.calculated_price`.
- This pricing-context proof intentionally stops before real calculated price
  expansion, inventory quantity, or tax-line calculation. Those remain separate
  route behavior slices.
- The Worker proof now exercises the Store product tax-context branch by
  requesting calculated price fields with `region_id` and `country_code`.
  The proof container registers a small service at Medusa's normal `tax`
  module key, so the existing `setTaxContext` middleware and
  `wrapProductsWithTaxPrices` helper run through the Fetch adapter and mutate
  calculated-price tax fields on the returned variant.
- This tax proof still stops before real pricing-module calculated-price
  expansion. The proof tax service is scoped to the HTTP adapter route proof
  and does not replace the actual Tax module used by the Durable Object
  commerce module set.
- The Worker proof now exercises the Store product inventory-quantity branch
  by requesting `variants.inventory_quantity`. The proof query facade supplies
  the real `getVariantAvailability` helper's `product_variant_inventory_items`
  and `sales_channel_locations` graph responses, so the existing Store product
  route removes `variants.inventory_quantity` from `queryConfig.fields` and
  the existing middleware writes `inventory_quantity` onto the managed variant.
  This proves the publishable-key-derived sales-channel path and the
  channel-location inventory calculation through the Fetch adapter.
- This inventory proof is still scoped to the HTTP adapter route proof. It does
  not replace the actual Inventory module used by the Durable Object commerce
  module set.
- The Worker proof now imports the real Store product-variant list and retrieve
  route modules plus their real route-local middleware. `/store/product-variants`
  and `/store/product-variants/:id` execute through the same Fetch adapter,
  Store global publishable-key, locale, optional auth middleware, route-local
  sales-channel filtering, product-sales-channel link filtering, default product
  status filters, and the existing variant handlers.
- The product-variant retrieve proof requests `inventory_quantity`, so the
  existing handler removes the field from the query fields and the existing
  inventory middleware computes the managed variant quantity through
  `getVariantAvailability`.
- The product-variant middleware now imports `validateAndTransformQuery` from
  the HTTP boundary instead of the broad framework root, matching the existing
  Worker-safe Store product middleware direction.
- The Worker proof now verifies a missing
  `/store/product-variants/:id` request returns Medusa's existing `not_found`
  JSON shape through the Fetch adapter error handler. No handler rewrite was
  needed; the existing retrieve handler already throws `MedusaError` when the
  variant query returns no rows.
- The Worker proof now builds its imported Medusa route modules and
  route-local middleware modules with the shared `buildStaticHttpResources`
  helper instead of hand-authoring route descriptors in the app. The app still
  owns only proof-global Store middleware, request-scope composition, the proof
  query facade, and the default error handler.
- The current Store route-local middleware files export named middleware
  arrays, so the proof manifest adapts those named arrays into the default
  middleware-module shape consumed by `buildStaticMiddlewareResources`. This is
  a transitional static manifest shape, not a replacement middleware system.
- The Cloudflare app TypeScript config now maps
  `@medusajs/framework/http/static` to framework source, matching the existing
  Vite alias and preventing mixed source/dist HTTP type identities in the
  Worker proof.
- The app-local static HTTP proof manifest data now lives in
  `apps/medusa-cloudflare/src/http-proof/manifest.ts`. `resources.ts` imports
  that manifest and keeps only the proof container, proof query facade,
  proof-global middleware, and error handler composition. This makes a future
  generated static manifest a mechanical replacement for one app-local module
  instead of another `HttpResourceSet` refactor.
- The app-local proof manifest now has a deterministic generator:
  `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs`. The
  generator still consumes an explicit route and middleware list; it does not
  scan the filesystem or run in the Worker. `check:http-proof-manifest` verifies
  the checked-in manifest is in sync with that build-time generator.
- The manifest rendering logic now lives in the shared framework build-tools
  boundary as `@medusajs/framework/build-tools/static-http-manifest`. The
  Cloudflare app still owns the explicit proof route/middleware input list, but
  it no longer owns the TypeScript module rendering rules. This keeps the
  current manifest build-time-only while moving the reusable generation
  mechanics toward the shared Medusa HTTP bootstrap path.
- The shared build-tools boundary now converts a build-time source file list
  into static HTTP manifest inputs. It derives route matchers from route file
  paths after stripping the configured API root, derives generated import paths
  relative to the generated manifest file, and derives stable local import
  bindings. The proof generator therefore lists selected Store/Admin route files
  and route-local middleware files instead of hand-authoring route objects.
- The build-tools boundary now also exposes a Node-only build-time route
  folder scanner. The Cloudflare proof generator scans only the already-covered
  `admin/plugins`, `store/currencies`, `store/products`, and
  `store/product-variants` route folders, then merges the proof-local route
  file. This keeps filesystem discovery in the build step while allowing
  validated dynamic Store route files into the Worker proof manifest.
- The build-tools boundary now also scans selected middleware folders for
  `middlewares.ts` files and reads the single exported `MiddlewareRoute[]`
  symbol from each file. The Cloudflare proof generator no longer hand-lists
  `storeCurrencyRoutesMiddlewares`, `storeProductRoutesMiddlewares`, or
  `storeProductVariantRoutesMiddlewares`; those names are discovered during the
  build step and rendered into the same checked-in static manifest.
- Commit `59a164f244` extends the proof to the real
  `packages/medusa/src/api/store/currencies/[code]/route.ts` handler. The
  generated manifest now imports `/store/currencies/:code`, the Worker path
  gate forwards the dynamic currency route to the Fetch adapter, the proof
  remote-query facade supports the retrieve route's array response shape, and
  the route's framework imports are type-only so the Worker graph does not pull
  the broad HTTP/types barrels at runtime.
- Commit `5fc691db8d` removes the duplicated hardcoded proof path list from
  the Worker gate. `isStaticHttpProofPath(...)` now derives its path matchers
  from the checked-in static HTTP proof manifest, so adding a route to the
  generated manifest is enough for the Worker to forward that route into the
  Fetch adapter.
- Commit `abb5ab3cb7` moves the manifest path matcher into the shared
  `@medusajs/framework/http/static` subpath. The Worker app now delegates route
  path matching to the framework static HTTP utility layer instead of owning an
  app-local copy of the matcher.
- Commit `a5450e7087` makes the Fetch adapter and the manifest forwarding gate
  share the same static HTTP path matching primitive. `matchStaticHttpPath(...)`
  now owns exact, dynamic-parameter, wildcard, and partial prefix matching for
  both adapter execution and Worker proof forwarding.
- Commit `d3ee4c0f3e` extends the generated HTTP proof manifest to the existing
  Store regions routes. The build-time scanner now includes
  `packages/medusa/src/api/store/regions`, the region route-local middleware
  imports the Worker-safe HTTP subpath, and the proof `REMOTE_QUERY` facade
  supports the real `/store/regions` and `/store/regions/:id` handlers.
- Commit `266aceaada` extends the generated HTTP proof manifest to the existing
  Store payment-providers route. The build-time scanner now includes
  `packages/medusa/src/api/store/payment-providers`, the route-local middleware
  imports the Worker-safe HTTP subpath, and the proof `REMOTE_QUERY` facade
  supports the real `region_payment_provider` relation query used by
  `/store/payment-providers`.
- Commit `6e3a39f7b1` moves the generated Medusa HTTP proof manifest into
  `packages/medusa/src/static/http-proof-manifest.ts`. The Cloudflare app
  keeps only a small composition manifest that imports the Medusa-owned static
  manifest and adds the app-local `/http-proof/:proofId` proof route. This
  removes Medusa Store/Admin route and middleware imports from generated app
  source while keeping the Worker app as the temporary generator host.
- Commit `4f85f63af6` extends the Medusa-owned HTTP proof manifest to the real
  Store cart retrieve route, `GET /store/carts/:id`. The manifest generator
  adds only `packages/medusa/src/api/store/carts/[id]/route.ts` instead of the
  full cart route tree so cart mutation workflows are not pulled into the
  read-only Worker proof. The existing cart route keeps its `POST` behavior but
  localizes the workflow id string to avoid a static `@medusajs/core-flows`
  import when the route module is imported for `GET`.
- The static middleware resource builder now honors both Medusa middleware
  config shapes: modern `methods` and deprecated `method`. This is required
  for Store cart's direct middleware array export; otherwise POST cart body
  middleware runs on GET requests in the static Fetch path.
- Store cart publishable-key helper imports were tightened at the existing
  Medusa middleware boundary: Express `NextFunction` is type-only via
  `MedusaNextFunction`, the broad framework middleware import moved to the
  HTTP boundary, and publishable API key scopes are narrowed from `unknown`
  instead of using `any`.
- Commit `0225af0da1` proves the existing `POST /store/carts/:id` handler
  through the Fetch adapter. The route still calls `Modules.WORKFLOW_ENGINE`
  and then `refetchCart`; the Cloudflare app registers only a typed proof
  workflow-engine boundary for `run("update-cart", ...)` so the app does not
  rewrite the cart route or mutation handler. The proof facade updates the
  same cart row returned by the existing `REMOTE_QUERY` facade.
- Commit `37378e2f4a` extends the proof to the existing
  `POST /store/carts/:id/line-items` handler. The generated Medusa-owned
  manifest now imports the line-item route module, the route localizes the
  `add-to-cart` workflow id instead of statically importing core flows, and
  the proof workflow-engine boundary handles `run("add-to-cart", ...)` before
  the normal cart refetch path returns the added item.
- The Fetch adapter now supports explicit HTTP resource `pathMatching` modes.
  App/global middleware such as `/store` uses prefix matching, while
  method-scoped static route middleware and validators are exact by default
  unless their matcher is wildcard/global. This prevents
  `POST /store/carts/:id` body validation from also matching
  `POST /store/carts/:id/line-items` in the static Fetch path.
- Commit `78b3427e48` extends the proof to the existing
  `POST /store/carts/:id/line-items/:line_id` handler. The generated
  Medusa-owned manifest now imports the nested line-item route module, the
  route localizes the update/delete workflow ids instead of statically
  importing core flows, and the proof workflow-engine boundary handles
  `run("update-line-item-in-cart", ...)` before the normal cart refetch path
  returns the updated item.
- Commit `b3f3506dd6` proves the existing
  `DELETE /store/carts/:id/line-items/:line_id` handler through the same
  nested line-item route module. The proof workflow-engine boundary handles
  `run("delete-line-items", ...)`, removes the item from the refetched cart
  facade, and verifies Medusa's line-item delete response shape.
- Commit `44c2749e2c` extends the proof to the existing
  `POST /store/carts/:id/promotions` handler. The generated Medusa-owned
  manifest now imports the cart promotions route module, the route localizes
  the `update-cart-promotions` workflow id and promotion action literals for
  the Worker graph, and the proof workflow-engine boundary handles
  `run("update-cart-promotions", ...)` before the normal cart refetch path
  returns the applied promotion.
- Commit `5ad1f18b7f` proves the existing
  `DELETE /store/carts/:id/promotions` handler through the same cart
  promotions route module. The existing proof workflow-engine boundary handles
  the `remove` action and the workerd proof verifies that the refetched cart
  returns an empty promotions array.
- Commit `c137cbbbd5` extends the proof to the existing
  `POST /store/carts/:id/shipping-methods` handler. The generated
  Medusa-owned manifest now imports the cart shipping-methods route module,
  the route uses the shared Workflow Engine module boundary with a localized
  `add-shipping-method-to-cart` workflow id instead of statically importing
  the core-flow factory, and the proof workflow facade returns the added
  shipping method through the normal cart refetch path.
- Commit `4eb0f9172e` extends the proof to the existing
  `POST /store/carts/:id/taxes` handler. The generated Medusa-owned manifest
  now imports the cart taxes route module, the route uses the shared Workflow
  Engine module boundary with a localized `update-tax-lines` workflow id
  instead of statically importing the core-flow factory, and the proof workflow
  facade returns a recalculated `tax_total` through the normal cart refetch
  path.
- This remains a thin route proof. It does not expose Store/Admin API routes,
  authenticated bearer/session Store requests, CORS, policies, or the final
  generated static route manifest.

Affected boundary:

- `apps/medusa-cloudflare/src/http-proof/*`
- `apps/medusa-cloudflare/src/static-http-proof.ts`
- `apps/medusa-cloudflare/src/worker.ts`
- `apps/medusa-cloudflare/scripts/check-portable-imports.mjs`
- `apps/medusa-cloudflare/scripts/check-workerd-cart-do-sqlite.mjs`
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs`
- `apps/medusa-cloudflare/vite.config.ts`
- `packages/medusa/src/static/http-proof-manifest.ts`
- `packages/core/framework/src/build-tools/static-http-manifest.ts`
- `packages/core/framework/src/build-tools/__tests__/static-http-manifest.spec.ts`
- `packages/core/framework/src/http/utils/static-http-path-matcher.ts`
- `packages/core/framework/src/http/__tests__/static-http-path-matcher.spec.ts`
- `packages/core/framework/src/http/__tests__/static-middleware-resources.spec.ts`
- `packages/core/framework/src/http/static.ts`
- `packages/core/framework/src/http/types.ts`
- `packages/core/framework/src/http/fetch.ts`
- `packages/core/framework/src/http/utils/static-middleware-resources.ts`
- `packages/core/framework/package.json`
- `packages/medusa/src/api/admin/plugins/route.ts`
- `packages/medusa/src/api/store/carts/[id]/route.ts`
- `packages/medusa/src/api/store/carts/[id]/line-items/route.ts`
- `packages/medusa/src/api/store/carts/[id]/line-items/[line_id]/route.ts`
- `packages/medusa/src/api/store/carts/[id]/promotions/route.ts`
- `packages/medusa/src/api/store/carts/[id]/shipping-methods/route.ts`
- `packages/medusa/src/api/store/carts/[id]/taxes/route.ts`
- `packages/medusa/src/api/store/carts/middlewares.ts`
- `packages/medusa/src/api/store/carts/helpers.ts`
- `packages/medusa/src/api/utils/middlewares/common/ensure-pub-key-sales-channel-match.ts`
- `packages/medusa/src/api/utils/middlewares/common/maybe-attach-pub-key-scopes.ts`
- `packages/medusa/src/api/store/currencies/route.ts`
- `packages/medusa/src/api/store/currencies/[code]/route.ts`
- `packages/medusa/src/api/store/regions/route.ts`
- `packages/medusa/src/api/store/regions/[id]/route.ts`
- `packages/medusa/src/api/store/regions/middlewares.ts`
- `packages/medusa/src/api/store/payment-providers/route.ts`
- `packages/medusa/src/api/store/payment-providers/middlewares.ts`
- `packages/medusa/src/api/store/products/route.ts`
- `packages/medusa/src/api/store/products/[id]/route.ts`
- `packages/medusa/src/api/store/products/middlewares.ts`
- `packages/medusa/src/api/utils/middlewares/products/*`
- `packages/core/framework/src/http/adapters/fetch.ts`
- `packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts`
- `packages/core/framework/src/http/fetch.ts`
- `packages/core/framework/src/http/middlewares/authenticate-middleware.ts`
- `packages/core/framework/src/http/middlewares/apply-locale.ts`
- `packages/core/framework/src/http/middlewares/apply-default-filters.ts`
- `packages/core/framework/src/http/middlewares/ensure-publishable-api-key.ts`
- `packages/core/framework/src/http/middlewares/error-handler.ts`
- `packages/core/framework/src/http/middlewares/exception-formatter.ts`
- `packages/core/framework/src/http/utils/maybe-apply-link-filter.ts`
- `packages/core/framework/src/http/utils/refetch-entities.ts`
- `packages/core/framework/src/http/utils/validate-query.ts`
- `packages/core/framework/src/http/utils/get-query-config.ts`
- `packages/core/framework/src/http/utils/field-filtering/*`
- `packages/core/framework/src/http/utils/policies/*`
- `packages/core/framework/src/policies/has-permission.ts`
- `packages/core/framework/src/zod/*`
- `packages/core/utils/src/common/remote-query-object-from-string.ts`
- `packages/core/utils/src/feature-flags/flag-router.ts`
- `packages/core/utils/src/modules-sdk/query-context.ts`
- `packages/core/utils/src/product/get-variant-availability.ts`
- `packages/core/utils/src/totals/tax/*`
- `packages/core/utils/src/translations/apply-translations-to-tax-lines.ts`
- `packages/core/utils/package.json`
- `packages/medusa/src/api/store/currencies/middlewares.ts`
- `packages/medusa/src/api/utils/common-validators/common.ts`

Validation:

- After the Store product retrieve route slice, framework TypeScript build
  passed.
- Cloudflare app typecheck passed.
- Fetch adapter test passed with 16 passing tests.
- Fetch adapter import guard passed with 2 passing tests.
- Static HTTP builder import guard passed with 2 passing tests.
- Composed Worker import guard passed with 1099 bundled inputs.
- Production Worker build passed: 2,273.47 kB, gzip 419.91 kB.
- Existing Express HTTP route/middleware suite passed with 23 passing and 1
  skipped test.
- Full Durable Object SQLite workerd proof passed and now verifies
  `/store/products/:id` with Store global publishable-key, locale, and optional
  auth middleware before the commerce module scenario.
- After the Store product not-found slice, framework TypeScript build passed.
- Cloudflare app typecheck passed.
- Fetch adapter test passed with 16 passing tests.
- Fetch adapter import guard passed with 2 passing tests.
- Static HTTP builder import guard passed with 2 passing tests.
- Composed Worker import guard passed with 1102 bundled inputs.
- Production Worker build passed: 2,282.32 kB, gzip 422.33 kB.
- Existing Express HTTP route/middleware suite passed with 23 passing and 1
  skipped test.
- Full Durable Object SQLite workerd proof passed and now verifies the missing
  `/store/products/:id` path returns Medusa's `not_found` JSON through the
  Fetch adapter error handler before the commerce module scenario.
- After the Store product pricing-context slice, framework TypeScript build
  passed.
- Cloudflare app typecheck passed.
- Fetch adapter test passed with 16 passing tests.
- Fetch adapter import guard passed with 2 passing tests.
- Static HTTP builder import guard passed with 2 passing tests.
- Composed Worker import guard passed with 1102 bundled inputs.
- Production Worker build passed: 2,283.22 kB, gzip 422.45 kB.
- Existing Express HTTP route/middleware suite passed with 23 passing and 1
  skipped test.
- Full Durable Object SQLite workerd proof passed and now verifies
  `/store/products` with `variants.calculated_price` and `region_id` populates
  the Store product pricing context through the real middleware stack before
  the commerce module scenario.
- After the Store product tax-context slice, framework TypeScript build
  passed.
- Cloudflare app typecheck passed.
- Fetch adapter test passed with 16 passing tests.
- Fetch adapter import guard passed with 2 passing tests.
- Static HTTP builder import guard passed with 2 passing tests.
- Composed Worker import guard passed with 1102 bundled inputs.
- Production Worker build passed: 2,283.85 kB, gzip 422.63 kB.
- Existing Express HTTP route/middleware suite passed with 23 passing and 1
  skipped test.
- Full Durable Object SQLite workerd proof passed and now verifies
  `/store/products` with `variants.calculated_price`, `region_id`, and
  `country_code` applies Store product tax context and tax-adjusted calculated
  price fields through the real middleware/helper path before the commerce
  module scenario.
- After the Store product inventory-quantity slice, framework TypeScript build
  passed.
- Cloudflare app typecheck passed.
- Fetch adapter test passed with 16 passing tests.
- Fetch adapter import guard passed with 2 passing tests.
- Static HTTP builder import guard passed with 2 passing tests.
- Composed Worker import guard passed with 1102 bundled inputs.
- Production Worker build passed: 2,284.88 kB, gzip 422.83 kB.
- Existing Express HTTP route/middleware suite passed with 23 passing and 1
  skipped test.
- Full Durable Object SQLite workerd proof passed and now verifies
  `/store/products` with `variants.inventory_quantity` computes managed variant
  inventory through the real Store product middleware and
  `getVariantAvailability` helper before the commerce module scenario.
- After the Store product-variant route slice, framework TypeScript build
  passed.
- Cloudflare app typecheck passed.
- Fetch adapter test passed with 16 passing tests.
- Fetch adapter import guard passed with 2 passing tests.
- Static HTTP builder import guard passed with 2 passing tests.
- Composed Worker import guard passed with 1108 bundled inputs.
- Production Worker build passed: 2,295.37 kB, gzip 423.77 kB.
- Existing Express HTTP route/middleware suite passed with 23 passing and 1
  skipped test.
- Full Durable Object SQLite workerd proof passed and now verifies
  `/store/product-variants` list behavior plus `/store/product-variants/:id`
  inventory computation through the real Store product-variant middleware and
  handlers before the commerce module scenario.
- After the Store product-variant not-found slice, Cloudflare app typecheck
  passed.
- Composed Worker import guard passed with 1108 bundled inputs.
- Production Worker build passed: 2,295.37 kB, gzip 423.77 kB.
- Full Durable Object SQLite workerd proof passed and now verifies the missing
  `/store/product-variants/:id` path returns Medusa's `not_found` JSON through
  the Fetch adapter error handler before the commerce module scenario.
- After the static HTTP builder proof slice, framework TypeScript build passed.
- Static HTTP resource builder test passed with 4 passing tests.
- Cloudflare app typecheck passed.
- Fetch adapter test passed with 16 passing tests.
- Fetch adapter import guard passed with 2 passing tests.
- Static HTTP builder import guard passed with 2 passing tests.
- Composed Worker import guard passed with 1108 bundled inputs.
- Production Worker build passed: 2,298.08 kB, gzip 424.80 kB.
- Existing Express HTTP route/middleware suite passed with 23 passing and 1
  skipped test.
- Full Durable Object SQLite workerd proof passed with the Fetch proof's real
  Medusa route modules and route-local middleware resources built through
  `buildStaticHttpResources`.
- After the app-local static HTTP proof manifest extraction, Cloudflare app
  typecheck passed.
- Static HTTP resource builder test passed with 4 passing tests.
- Fetch adapter test passed with 16 passing tests.
- Fetch adapter import guard passed with 2 passing tests.
- Static HTTP builder import guard passed with 2 passing tests.
- Existing Express HTTP route/middleware suite passed with 23 passing and 1
  skipped test.
- Composed Worker import guard passed with 1109 bundled inputs.
- Production Worker build passed: 2,298.18 kB, gzip 424.81 kB.
- Full Durable Object SQLite workerd proof passed with unchanged route behavior
  after moving the proof manifest data into its own app-local module.
- After the static HTTP proof manifest generator slice,
  `check:http-proof-manifest` passed.
- Cloudflare app typecheck passed.
- Static HTTP resource builder test passed with 4 passing tests.
- Fetch adapter test passed with 16 passing tests.
- Fetch adapter import guard passed with 2 passing tests.
- Static HTTP builder import guard passed with 2 passing tests.
- Existing Express HTTP route/middleware suite passed with 23 passing and 1
  skipped test.
- Composed Worker import guard passed with 1109 bundled inputs.
- Production Worker build passed: 2,298.18 kB, gzip 424.75 kB.
- Full Durable Object SQLite workerd proof passed with unchanged route behavior
  after regenerating the manifest from the explicit build-time route list.
- After the shared static HTTP manifest renderer slice, framework build
  passed.
- Shared static HTTP manifest renderer test passed with 2 passing tests.
- `generate:http-proof-manifest` and `check:http-proof-manifest` passed through
  the new `@medusajs/framework/build-tools/static-http-manifest` subpath.
- Cloudflare app typecheck passed.
- Fetch adapter test passed with 16 passing tests.
- Fetch adapter import guard passed with 2 passing tests.
- Static HTTP builder import guard passed with 2 passing tests.
- Composed Worker import guard passed with 1109 bundled inputs.
- Production Worker build passed: 2,298.18 kB, gzip 424.75 kB.
- Full Durable Object SQLite workerd proof passed with unchanged route behavior
  after moving manifest rendering into framework build tools.
- After the build-time file-list static HTTP manifest slice, framework build
  passed.
- Shared static HTTP manifest build-tools test passed with 3 passing tests.
- `generate:http-proof-manifest` and `check:http-proof-manifest` passed with
  route paths, import paths, and import bindings derived from the selected
  Store/Admin route file list.
- Cloudflare app typecheck passed.
- Fetch adapter test passed with 16 passing tests.
- Fetch adapter import guard passed with 2 passing tests.
- Static HTTP builder import guard passed with 2 passing tests.
- Composed Worker import guard passed with 1109 bundled inputs.
- Production Worker build passed: 2,298.18 kB, gzip 424.75 kB.
- Full Durable Object SQLite workerd proof passed with unchanged route behavior
  after switching the proof generator from hand-authored route objects to a
  build-time file list.
- After the build-time route folder scanner slice, framework build passed.
- Shared static HTTP manifest build-tools test passed with 4 passing tests.
- `generate:http-proof-manifest` and `check:http-proof-manifest` passed while
  scanning the selected covered API route folders at build time.
- The generated HTTP proof manifest had no content diff after the scanner was
  ordered to preserve the existing selected route set.
- Cloudflare app typecheck passed.
- Fetch adapter test passed with 16 passing tests.
- Fetch adapter import guard passed with 2 passing tests.
- Static HTTP builder import guard passed with 2 passing tests.
- Composed Worker import guard passed with 1109 bundled inputs.
- Production Worker build passed: 2,298.18 kB, gzip 424.75 kB.
- Full Durable Object SQLite workerd proof passed with unchanged route behavior
  after moving selected route discovery into the build-time scanner.
- After the build-time middleware scanner slice, framework build passed.
- Shared static HTTP manifest build-tools test passed with 6 passing tests.
- `generate:http-proof-manifest` and `check:http-proof-manifest` passed while
  scanning selected middleware folders and discovering their exported
  `MiddlewareRoute[]` names at build time.
- The generated HTTP proof manifest had no content diff after replacing the
  app-owned middleware export list with the scanner.
- Cloudflare app typecheck passed.
- Fetch adapter test passed with 16 passing tests.
- Fetch adapter import guard passed with 2 passing tests.
- Static HTTP builder import guard passed with 2 passing tests.
- Composed Worker import guard passed with 1109 bundled inputs.
- Production Worker build passed: 2,298.18 kB, gzip 424.75 kB.
- Full Durable Object SQLite workerd proof passed with unchanged route behavior
  after moving selected middleware discovery into the build-time scanner.
- After the Store currency retrieve route slice in `59a164f244`,
  `generate:http-proof-manifest` and `check:http-proof-manifest` passed with
  the build-time scanner deriving `/store/currencies/:code` from
  `store/currencies/[code]/route.ts`.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1110 bundled inputs.
- Production Worker build passed: 2,299.24 kB, gzip 424.94 kB.
- Full Durable Object SQLite workerd proof passed and now verifies
  `/store/currencies/usd` plus the missing `/store/currencies/eur` not-found
  path through the real Medusa Store currency retrieve route, Store global
  publishable-key, locale, optional auth middleware, and Fetch adapter error
  handler before the commerce module scenario.
- After the manifest-driven Worker path gate slice in `5fc691db8d`,
  `check:http-proof-manifest` passed.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1110 bundled inputs.
- Production Worker build passed: 2,299.59 kB, gzip 425.05 kB.
- Full Durable Object SQLite workerd proof passed with the same real Store
  currency, product, and product-variant route behavior while the Worker gate
  derived handled paths from the static HTTP proof manifest.
- After the shared static HTTP manifest path matcher slice in `abb5ab3cb7`,
  the focused static path matcher Jest suite passed with 3 tests.
- Framework TypeScript build passed.
- Static HTTP builder import guard passed with 2 tests.
- Fetch/static subpath composition import guard passed with 2 tests.
- Cloudflare app typecheck passed.
- `check:http-proof-manifest` passed.
- Composed Worker import guard passed with 1111 bundled inputs.
- Production Worker build passed: 2,300.22 kB, gzip 425.18 kB.
- Full Durable Object SQLite workerd proof passed with the Worker gate using
  the shared static HTTP manifest path matcher.
- After the Fetch/static path matcher unification in `a5450e7087`, the
  focused static path matcher Jest suite passed with 5 tests.
- Focused Fetch HTTP adapter suite passed with 16 tests.
- Framework TypeScript build passed.
- Static HTTP builder import guard passed with 2 tests.
- Fetch/static subpath composition import guard passed with 2 tests.
- Cloudflare app typecheck passed.
- `check:http-proof-manifest` passed.
- Composed Worker import guard passed with 1111 bundled inputs.
- Production Worker build passed: 2,299.85 kB, gzip 425.12 kB.
- Full Durable Object SQLite workerd proof passed with the Fetch adapter and
  Worker gate sharing the same static HTTP matcher.
- After the Store regions route slice in `d3ee4c0f3e`,
  `generate:http-proof-manifest` and `check:http-proof-manifest` passed with
  the build-time scanner deriving `/store/regions` and `/store/regions/:id`.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1116 bundled inputs.
- Production Worker build passed: 2,303.98 kB, gzip 425.65 kB.
- Full Durable Object SQLite workerd proof passed and now verifies
  `/store/regions`, `/store/regions/:id`, and the missing
  `/store/regions/:id` not-found path through the real Medusa Store region
  routes, Store global publishable-key, locale, optional auth middleware, and
  Fetch adapter error handler before the commerce module scenario.
- After the Store payment-providers route slice in `266aceaada`,
  `generate:http-proof-manifest` and `check:http-proof-manifest` passed with
  the build-time scanner deriving `/store/payment-providers`.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1120 bundled inputs.
- Production Worker build passed: 2,306.42 kB, gzip 425.99 kB.
- Full Durable Object SQLite workerd proof passed and now verifies
  `/store/payment-providers` through the real Medusa Store payment-provider
  route, Store global publishable-key, locale, optional auth middleware, and
  the `region_payment_provider` remote-query relation facade before the
  commerce module scenario.
- After the Medusa-owned HTTP proof manifest slice,
  `generate:http-proof-manifest` and `check:http-proof-manifest` passed with
  the generated artifact written to
  `packages/medusa/src/static/http-proof-manifest.ts`.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1121 bundled inputs.
- Production Worker build passed: 2,306.66 kB, gzip 426.04 kB.
- Full Durable Object SQLite workerd proof passed with unchanged Store/Admin
  HTTP proof behavior after the app manifest became a small composition wrapper
  over the Medusa-owned generated manifest.
- After the Store cart retrieve route slice in `4f85f63af6`,
  `generate:http-proof-manifest` and `check:http-proof-manifest` passed with
  the build-time scanner deriving `/store/carts/:id` from
  `store/carts/[id]/route.ts`.
- Focused static middleware resource builder test passed with 4 tests,
  including deprecated `method` support for direct middleware route configs.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1131 bundled inputs.
- Production Worker build passed: 2,322.61 kB, gzip 428.69 kB.
- Full Durable Object SQLite workerd proof passed and now verifies
  `/store/carts/:id` plus the missing `/store/carts/:id` not-found path through
  the real Medusa Store cart retrieve route, Store global publishable-key,
  locale, optional auth middleware, and Fetch adapter error handler before the
  commerce module scenario.
- After the Store cart update route slice in `0225af0da1`,
  `check:http-proof-manifest` passed without changing the generated route
  manifest because the cart route module was already imported for
  `/store/carts/:id`.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1131 bundled inputs.
- Production Worker build passed: 2,323.20 kB, gzip 428.88 kB.
- Full Durable Object SQLite workerd proof passed and now verifies
  `POST /store/carts/:id` through the real Store cart update handler, Store
  global publishable-key, locale, optional auth middleware, route-local body and
  query validation, `Modules.WORKFLOW_ENGINE.run("update-cart", ...)`, and the
  existing cart refetch path before the commerce module scenario.
- After the Store cart line-item route slice in `37378e2f4a`,
  `generate:http-proof-manifest` and `check:http-proof-manifest` passed with
  the build-time scanner deriving `/store/carts/:id/line-items`.
- Framework TypeScript build passed.
- Focused Fetch HTTP adapter suite passed with 18 tests, including exact
  method-scoped middleware matching for nested routes and explicit prefix
  matching for global middleware.
- Focused static middleware resource builder suite passed with 4 tests,
  including generated `pathMatching` metadata for middleware, body-parser
  config, and additional-data validator routes.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1132 bundled inputs.
- Production Worker build passed: 2,325.16 kB, gzip 429.23 kB.
- Full Durable Object SQLite workerd proof passed and now verifies
  `POST /store/carts/:id/line-items` through the real Store cart line-item
  handler, Store global publishable-key, locale, optional auth middleware,
  exact route-local validation, `Modules.WORKFLOW_ENGINE.run("add-to-cart",
  ...)`, and the existing cart refetch path before the commerce module
  scenario.
- After the Store cart line-item update route slice in `78b3427e48`,
  `generate:http-proof-manifest` and `check:http-proof-manifest` passed with
  the build-time scanner deriving `/store/carts/:id/line-items/:line_id`.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1133 bundled inputs.
- Production Worker build passed: 2,327.03 kB, gzip 429.54 kB.
- Full Durable Object SQLite workerd proof passed and now verifies
  `POST /store/carts/:id/line-items/:line_id` through the real Store cart
  line-item update handler, Store global publishable-key, locale, optional
  auth middleware, exact route-local validation,
  `Modules.WORKFLOW_ENGINE.run("update-line-item-in-cart", ...)`, and the
  existing cart refetch path before the commerce module scenario.
- After the Store cart line-item delete route slice in `b3f3506dd6`,
  `check:http-proof-manifest` passed with the existing nested line-item route
  manifest entry.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1133 bundled inputs.
- Production Worker build passed: 2,327.42 kB, gzip 429.60 kB.
- Full Durable Object SQLite workerd proof passed and now verifies
  `DELETE /store/carts/:id/line-items/:line_id` through the real Store cart
  line-item delete handler, Store global publishable-key, locale, optional auth
  middleware, exact route-local query validation,
  `Modules.WORKFLOW_ENGINE.run("delete-line-items", ...)`, Medusa's delete
  response shape, and the existing cart refetch path before the commerce
  module scenario.
- After the Store cart promotion add route slice in `44c2749e2c`,
  `generate:http-proof-manifest` and `check:http-proof-manifest` passed with
  the build-time scanner deriving `/store/carts/:id/promotions`.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1134 bundled inputs.
- Production Worker build passed: 2,329.95 kB, gzip 430.03 kB.
- Full Durable Object SQLite workerd proof passed and now verifies
  `POST /store/carts/:id/promotions` through the real Store cart promotions
  handler, Store global publishable-key, locale, optional auth middleware,
  exact route-local body/query validation,
  `Modules.WORKFLOW_ENGINE.run("update-cart-promotions", ...)`, and the
  existing cart refetch path before the commerce module scenario.
- After the Store cart promotion delete route slice in `5ad1f18b7f`,
  `check:http-proof-manifest` passed with the existing cart promotions route
  manifest entry.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1134 bundled inputs.
- Production Worker build passed: 2,329.95 kB, gzip 430.03 kB.
- Full Durable Object SQLite workerd proof passed and now verifies
  `DELETE /store/carts/:id/promotions` through the real Store cart promotions
  handler, Store global publishable-key, locale, optional auth middleware,
  exact route-local body/query validation,
  `Modules.WORKFLOW_ENGINE.run("update-cart-promotions", ...)`, and the
  existing cart refetch path before the commerce module scenario.
- After the Store cart shipping-method route slice in `c137cbbbd5`,
  `generate:http-proof-manifest` and `check:http-proof-manifest` passed with
  the build-time scanner deriving `/store/carts/:id/shipping-methods`.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1135 bundled inputs.
- Production Worker build passed: 2,331.56 kB, gzip 430.28 kB.
- Full Durable Object SQLite workerd proof passed and now verifies
  `POST /store/carts/:id/shipping-methods` through the real Store cart
  shipping-method handler, Store global publishable-key, locale, optional auth
  middleware, exact route-local body/query validation,
  `Modules.WORKFLOW_ENGINE.run("add-shipping-method-to-cart", ...)`, and the
  existing cart refetch path before the commerce module scenario.
- After the Store cart taxes route slice in `4eb0f9172e`,
  `generate:http-proof-manifest` and `check:http-proof-manifest` passed with
  the build-time scanner deriving `/store/carts/:id/taxes`.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1136 bundled inputs.
- Production Worker build passed: 2,332.59 kB, gzip 430.40 kB.
- Full Durable Object SQLite workerd proof passed and now verifies
  `POST /store/carts/:id/taxes` through the real Store cart taxes handler,
  Store global publishable-key, locale, optional auth middleware, exact
  route-local body/query validation,
  `Modules.WORKFLOW_ENGINE.run("update-tax-lines", ...)`, and the existing
  cart refetch path before the commerce module scenario.
- Existing static HTTP resource builder test currently executes the pure builder
  assertions but its `ApiLoader` fixture case is blocked by the existing
  unbuilt `@medusajs/medusa/event-bus-local` default-package path.
- `yarn workspace @medusajs/medusa build` remains blocked by the existing
  declaration conflicts in `src/types/policies.ts` for `PolicyResource`,
  `PolicyOperation`, and `Policy`.
- `git diff --check` passed.
- `yarn workspace medusa-cloudflare test` remains blocked by the existing
  Cloudflare Vite/Rolldown optimizer error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.
- After the real route slice, Cloudflare app typecheck passed, the composed
  Worker import guard passed with 1025 bundled inputs, production Worker build
  passed at 2,084.90 kB, gzip 381.35 kB, and the full Durable Object SQLite
  workerd proof passed while verifying both `/http-proof/workerd?source=workerd`
  and `/admin/plugins`.
- `yarn workspace @medusajs/medusa build` is currently blocked by existing
  declaration conflicts in `src/types/policies.ts` for `PolicyResource`,
  `PolicyOperation`, and `Policy`; the failure is outside the changed
  `admin/plugins` route.
- After the request-scope hook slice, framework TypeScript build passed.
- Focused Fetch HTTP adapter suite passed with 11 tests, including request
  scope assignment before middleware and route handler execution.
- Fetch HTTP adapter import guard passed.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1025 bundled inputs.
- Production Worker build passed: 2,085.03 kB, gzip 381.37 kB.
- Full Durable Object SQLite workerd proof passed and still verifies
  `/admin/plugins`.
- `yarn workspace medusa-cloudflare test` remains blocked by the existing
  Cloudflare Vite/Rolldown optimizer error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.
- After the Store currencies route slice, framework TypeScript build passed.
- Focused Fetch HTTP adapter suite passed with 12 tests, including request
  scope assignment and request metadata preparation before middleware and
  route handler execution.
- Fetch HTTP adapter import guard passed with 2 tests.
- Focused `remoteQueryObjectFromString` utility test passed with 2 tests.
- `@medusajs/utils` TypeScript build passed.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1027 bundled inputs.
- Production Worker build passed: 2,091.64 kB, gzip 383.06 kB.
- Full Durable Object SQLite workerd proof passed and now verifies
  `/store/currencies?fields=code,symbol,name&code=usd&limit=5&offset=1`
  through the real Medusa Store currencies route before the commerce module
  scenario.
- The broad utils package test command still hits existing Windows path
  expectation drift in `get-resolved-plugins.spec.ts` when run with the
  package's default `--testPathPattern=src`.
- The broad framework package test command still hits existing Windows
  snapshot drift in `routes-loader.spec.ts` when run with the package's default
  `--testPathPattern=src`.
- `yarn workspace medusa-cloudflare test` remains blocked by the existing
  Cloudflare Vite/Rolldown optimizer error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.
- After the Store currencies middleware slice, framework TypeScript build
  passed.
- `@medusajs/utils` TypeScript build passed.
- Focused Fetch HTTP adapter suite passed with 13 tests, including baseline
  Medusa request default initialization.
- Fetch HTTP adapter import guard passed with 2 tests and the adapter-only
  `@medusajs/framework/http/fetch` subpath stayed free of query middleware
  dependencies.
- Static HTTP builder import guard passed with 2 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1071 bundled inputs.
- Production Worker build passed: 2,230.23 kB, gzip 410.45 kB.
- Full Durable Object SQLite workerd proof passed and verifies the real Store
  currencies route through the real Store currencies query middleware before
  the commerce module scenario.
- `yarn workspace medusa-cloudflare test` remains blocked by the existing
  Cloudflare Vite/Rolldown optimizer error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.
- After the Store locale middleware slice, framework TypeScript build passed.
- `@medusajs/utils` TypeScript build passed.
- Focused Fetch HTTP adapter suite passed with 14 tests, including real
  `applyLocale` execution through `req.get(...)` on the Fetch adapter.
- Fetch HTTP adapter import guard passed with 2 tests.
- Static HTTP builder import guard passed with 2 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1072 bundled inputs.
- Production Worker build passed: 2,231.24 kB, gzip 410.59 kB.
- Full Durable Object SQLite workerd proof passed and now verifies
  `/store/currencies` with `locale=en-us`, asserting the resolved
  `x-medusa-locale-proof: en-US` header before the commerce module scenario.
- `yarn workspace medusa-cloudflare test` remains blocked by the existing
  Cloudflare Vite/Rolldown optimizer error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.
- After the Store publishable-key middleware slice, framework TypeScript build
  passed.
- `@medusajs/utils` TypeScript build passed.
- Focused Fetch HTTP adapter suite passed with 15 tests, including real
  `ensurePublishableApiKeyMiddleware` execution through the Fetch adapter,
  `req.get(...)`, and an adapter-created request scope.
- Fetch HTTP adapter import guard passed with 2 tests.
- Static HTTP builder import guard passed with 2 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1073 bundled inputs.
- Production Worker build passed: 2,233.76 kB, gzip 411.34 kB.
- Full Durable Object SQLite workerd proof passed and now verifies
  `/store/currencies` with `x-publishable-api-key: pk_worker_http_proof`,
  asserting `x-medusa-publishable-key-proof: pk_worker_http_proof` and
  `x-medusa-publishable-sales-channel-count: 1` before the commerce module
  scenario.
- `yarn workspace medusa-cloudflare test` remains blocked by the existing
  Cloudflare Vite/Rolldown optimizer error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.
- After the optional Store auth middleware slice, framework TypeScript build
  passed.
- Focused Fetch HTTP adapter suite passed with 16 tests, including real
  optional customer `authenticate(...)` execution through the Fetch adapter and
  adapter-created request scope.
- Existing Express HTTP route/middleware suite passed with 23 passing and 1
  skipped test, preserving Node bearer JWT auth behavior after the late JWT
  loader refactor.
- Fetch HTTP adapter import guard passed with 2 tests.
- Static HTTP builder import guard passed with 2 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1074 bundled inputs.
- Production Worker build passed: 2,238.57 kB, gzip 412.59 kB.
- Full Durable Object SQLite workerd proof passed and now verifies
  `/store/currencies` with optional Store auth middleware, asserting
  `x-medusa-auth-proof: unauthenticated` before the commerce module scenario.
- `yarn workspace medusa-cloudflare test` remains blocked by the existing
  Cloudflare Vite/Rolldown optimizer error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.
- After the Store products route slice, framework TypeScript build passed.
- `@medusajs/utils` TypeScript build passed.
- Cloudflare app typecheck passed.
- Focused Fetch HTTP adapter suite passed with 16 tests.
- Existing Express HTTP route/middleware suite passed with 23 passing and 1
  skipped test.
- Fetch HTTP adapter import guard passed with 2 tests.
- Static HTTP builder import guard passed with 2 tests.
- Composed Worker import guard passed with 1098 bundled inputs.
- Production Worker build passed: 2,271.21 kB, gzip 419.60 kB.
- Full Durable Object SQLite workerd proof passed and now verifies
  `/store/products` with Store global publishable-key, locale, and optional
  auth middleware plus product route-local query middleware before the commerce
  module scenario.
- `yarn workspace medusa-cloudflare test` remains blocked by the existing
  Cloudflare Vite/Rolldown optimizer error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.

## Shared Static Module Loader Milestone

Implementation commit:

- `0ea9e4dde5 refactor: add shared static module bootstrap`

The existing module-loader path is now split by responsibility:

- `staticModuleLoader` contains the shared module composition behavior and
  accepts typed, pre-imported module resources plus an injected persistence
  adapter.
- The existing `moduleLoader` remains the Node composition wrapper. It injects
  dynamic package loading, filesystem resource discovery, and the MikroORM
  default before delegating to `staticModuleLoader`.
- Filesystem resource discovery and Node-only migration loading are isolated
  from the portable loader import graph.
- `MedusaModule` can propagate static resources and an explicitly selected
  persistence adapter without changing the existing Node default path.

The Cloudflare Currency app now calls the shared static loader. It no longer
constructs connection loaders, container loaders, generated internal services,
or repositories itself.

This is an intermediate milestone, not the final bootstrap target. The
Cloudflare app still owns a hand-authored Currency module manifest and calls
`staticModuleLoader` directly. The next bootstrap step is to generate that
manifest and make the normal `MedusaModule`/application composition path
consume it.

This intermediate limitation was resolved in `ed17630e14`; see the
`MedusaModule Static Bootstrap Milestone` section below.

Validation:

- Full `@medusajs/modules-sdk` suite: 75 passing.
- Existing Currency suite through Drizzle/SQLite: 13 passing unchanged.
- Existing Currency suite through MikroORM/Postgres: 13 passing unchanged.
- Actual Currency module runs through D1 inside workerd.
- Composed Worker import guard: 203 bundled inputs, no Node or MikroORM
  blockers.
- Strict actual Currency service audit: 66 bundled inputs, no Worker blockers.

## MedusaModule Static Bootstrap Milestone

Implementation commit:

- `ed17630e14 refactor: bootstrap static modules through MedusaModule`

The Cloudflare app now loads Currency through the existing
`MedusaModule.bootstrap` API. It no longer imports or calls
`staticModuleLoader` directly.

The same `MedusaModule` class now selects infrastructure through explicit
composition:

- The precise `@medusajs/modules-sdk/medusa-module` entrypoint defaults to
  portable static registration and loading.
- The Node-oriented package root configures the original filesystem module
  registration, dynamic import, MikroORM persistence adapter, resource
  discovery, and migration loader.
- Static resources can include a precomputed joiner config so queryable modules
  do not execute the filesystem-aware `Module(...)` wrapper in workerd.
- `globalThis` replaces the Node-only `global` reference in the shared class.

Currency owns a typed `static-manifest` export containing its definition,
module service, DML models, loaders, and joiner config. A focused test compares
the static manifest against Currency's normal Node module export to prevent
behavioral drift.

This manual metadata limitation was first resolved with generation in
`b29b448142`, then replaced with runtime reuse of Medusa's portable metadata
logic in `fa0d7413c7`; see the section below.

Validation:

- Full `@medusajs/modules-sdk` suite: 75 passing.
- Currency static-manifest drift test: passing.
- Existing Currency suite through Drizzle/SQLite: 13 passing unchanged.
- Existing Currency suite through MikroORM/Postgres: 13 passing unchanged.
- Actual Currency module runs through `MedusaModule` and D1 inside workerd.
- Composed Worker import guard: 208 bundled inputs, no Node or MikroORM
  blockers.
- Strict actual Currency service audit: 66 bundled inputs, no Worker blockers.

## Runtime-Reused Static Manifest Metadata

Implementation commit:

- `fa0d7413c7 refactor: reuse portable Medusa joiner config`

The temporary generated metadata artifact and generator from `b29b448142` were
removed. Currency's static manifest now reuses Medusa's actual metadata logic
at Worker runtime:

- The module definition comes directly from a precise portable
  `ModulesDefinition` entrypoint.
- The joiner config is derived from the explicit Currency DML model by the same
  Medusa builder logic used by the Node entrypoint.
- The existing `defineJoinerConfig` entrypoint remains the Node wrapper that
  preserves implicit filesystem model discovery.
- `defineJoinerConfigFromModels` is the portable explicit-model entrypoint.
- A focused test proves the portable and Node entrypoints produce equivalent
  output when given the same models.

The portable split also required precise imports in the existing DML GraphQL
schema builder. This removes broad common and entity-builder barrels from the
explicit-model joiner-config graph without replacing Medusa's schema logic.

Models, module services, repositories, and portable loaders remain explicit
imports in Currency's module-owned `static-manifest.ts`. This is intentional:
those static imports replace filesystem discovery and make the Worker bundle
graph auditable.

Validation:

- Focused joiner-config suite: 12 passing.
- Full `@medusajs/modules-sdk` suite: 75 passing.
- Currency package build and 2 package tests pass.
- Customer implicit filesystem joiner discovery still produces its schema and
  4 aliases.
- Existing Currency suite through Drizzle/SQLite: 13 passing unchanged.
- Existing Currency suite through MikroORM/Postgres: 13 passing unchanged,
  using an isolated temporary PostgreSQL cluster.
- Actual Currency module runs through `MedusaModule` and D1 inside workerd.
- Composed Worker import guard: 216 bundled inputs, no Node or MikroORM
  blockers.
- Strict actual Currency service audit: 66 bundled inputs, no Worker blockers.
- Production Worker build: 222 transformed modules, 385.69 kB.

## Actual Currency Module Service In Durable Object SQLite

Commit:

- `ba74b53d24 feat: run Currency service in Durable Object`

The Cloudflare application's existing static Currency module composition now
accepts an injected Drizzle manager. Both D1 and the disposable Durable Object
proof reuse the same `MedusaModule.bootstrap` path and actual
`CurrencyModuleService`.

`CurrencyProofDO` no longer constructs or calls a Drizzle repository directly.
Its create, list, delete, transaction-context propagation, nested transaction,
read-your-own-writes, and rollback checks all execute through the normal
Currency module service surface.

This remains a thin application-root acceptance fixture. It does not add a
Cloudflare-specific module bootstrap or define the future tenant partition
topology.

Validation:

- Actual Currency module service DO SQLite workerd proof passed.
- Existing Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 229 transformed modules, 445.23 kB.
- Composed Worker guard: 333 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.

## App Framework Utility Shim Reduction

Commit:

- `b4a47bb899 refactor: shrink Cloudflare framework utility shim`

The Cloudflare app's `@medusajs/framework/utils` alias now re-exports more of
the real shared Medusa utility surface instead of carrying app-local
implementations. The app-local shim still exists as a proof boundary, but it no
longer owns common helpers, generated IDs, context decorators, manager
injection decorators, or transaction-manager injection decorators.

Differences from original Medusa:

- `deduplicate`, `isObject`, `isString`, `promiseAll`, and
  `generateEntityId` are imported from precise `@medusajs/utils/common/*`
  entry points.
- `MedusaContext`, `InjectManager`, and `InjectTransactionManager` are imported
  from precise `@medusajs/utils/modules-sdk/decorators/*` entry points.
- `generateEntityId` no longer imports the `ulid` package. It now creates a
  ULID-shaped identifier with Web Crypto so the shared helper can run in both
  Node and Workers without pulling Node `crypto` into the bundle.
- The app-local shim keeps only the deliberate proof boundaries:
  `ModulesSdkUtils`, `MedusaError`, and no-op `EmitEvents`.

Affected boundary:

- Cloudflare Worker composition for `@medusajs/framework/utils`.
- Shared `@medusajs/utils` common helper and module-sdk decorator entry points.
- Cart and Currency module service execution through the current Worker proof
  app.

Validation:

- `@medusajs/utils` build passed.
- Focused `promiseAll` and module-sdk decorator tests: 6 passing.
- Existing Cart integration suite through Drizzle/SQLite: 63 passing.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Cloudflare app type-check and 2 tests passed.
- Composed Worker import guard passed with 368 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed.
- Cart Durable Object SQLite workerd proof passed.
- Production Worker build passed: 549.57 kB, gzip 116.22 kB.

## Shared Medusa Error In Worker

Commit:

- `da024ab2a3 refactor: use shared Medusa error in Worker`

The Cloudflare app-local `@medusajs/framework/utils` shim no longer defines its
own `MedusaError`, `MedusaErrorTypes`, or error code constants. It now
re-exports the real shared implementation from a precise
`@medusajs/utils/common/errors` entry point.

Differences from original Medusa:

- `@medusajs/utils/common/errors` is now an explicit package export and Worker
  composition leaf.
- The shared `MedusaError` implementation remains the Medusa implementation,
  including `Types`, `Codes`, `type`, `code`, `date`, and `isMedusaError`.
- The touched implementation removes broad `any` from constructor forwarding
  and `isMedusaError` narrowing.
- The app-local shim now keeps only `ModulesSdkUtils` and no-op `EmitEvents` as
  deliberate proof boundaries.

Affected boundary:

- Error construction and error type constants used by module services and
  workflow/core-flow code imported through `@medusajs/framework/utils`.
- Cloudflare Worker composition for the current Cart and Currency proof app.

Validation:

- `@medusajs/utils` build passed.
- Existing Cart integration suite through Drizzle/SQLite: 63 passing.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Cloudflare app type-check and 2 tests passed.
- Composed Worker import guard passed with 368 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed.
- Cart Durable Object SQLite workerd proof passed.
- Production Worker build passed: 549.10 kB, gzip 115.99 kB.

## Portable ModulesSdkUtils Leaf In Worker

Commit:

- `dfd4636e30 refactor: move ModulesSdkUtils to portable leaf`

The Cloudflare app-local `@medusajs/framework/utils` shim no longer defines its
own `ModulesSdkUtils` object. The current Worker-safe subset now lives in
`@medusajs/utils/modules-sdk/portable` and is re-exported by the app shim.

Differences from original Medusa:

- The upstream `ModulesSdkUtils` namespace remains the full
  `@medusajs/utils/modules-sdk` barrel and is not imported by the Worker proof,
  because that barrel includes Node-oriented loader, migration, MikroORM, and
  PostgreSQL paths.
- The new portable leaf intentionally exposes only the currently proven
  `ModulesSdkUtils.MedusaService` surface needed by Cart.
- The app-local shim now keeps only no-op `EmitEvents` as the deliberate proof
  boundary.

Affected boundary:

- Cart module service base-class construction through
  `ModulesSdkUtils.MedusaService`.
- Cloudflare Worker composition for `@medusajs/framework/utils`.
- Shared `@medusajs/utils` module-sdk package subpaths.

Validation:

- `@medusajs/utils` build passed.
- Existing Cart integration suite through Drizzle/SQLite: 63 passing.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Cloudflare app type-check and 2 tests passed.
- Composed Worker import guard passed with 369 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed. The script logged a Wrangler
  local D1 migration cleanup timeout after the runtime assertion and exited 0.
- Cart Durable Object SQLite workerd proof passed.
- Production Worker build passed: 549.19 kB, gzip 116.01 kB.

## Portable Module SDK Entrypoint Naming And Guard

Commit:

- `42589ca0d3 refactor: rename module sdk portable entrypoint`

The temporary `@medusajs/utils/modules-sdk/portable-utils` subpath was renamed
to `@medusajs/utils/modules-sdk/portable`. This keeps the new API aligned with
the longer-term direction: additive portable entrypoints that can grow one
proven surface at a time, while the existing root and Node-compatible barrels
remain unchanged.

Differences from original Medusa:

- `@medusajs/utils/modules-sdk/portable` is an additive package export.
- The Cloudflare app imports the portable module SDK subset through that
  subpath.
- `medusa-cloudflare` now has `check:portable-entrypoints`, which bundles the
  portable entrypoint directly and fails if it reaches broad barrels or
  Node-only infrastructure.

Validation:

- `@medusajs/utils` build passed.
- Portable entrypoint guard passed: 38 bundled inputs.
- Cloudflare app type-check and 2 tests passed.
- Composed Worker import guard passed with 369 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Cart Durable Object SQLite workerd proof passed.
- Production Worker build passed: 549.18 kB, gzip 116.01 kB.

## Shared EmitEvents In Worker

Commit:

- `54d675300c refactor: use shared EmitEvents in Worker`

The Cloudflare app-local `@medusajs/framework/utils` shim no longer defines a
no-op `EmitEvents`. It now re-exports the real Medusa module-sdk
`EmitEvents` decorator from `@medusajs/utils/modules-sdk/decorators/emit-events`.

Differences from original Medusa:

- `EmitEvents` is now an explicit package export and direct portable
  entrypoint guard target.
- The real decorator keeps the Medusa in-memory message aggregation behavior.
- In the current Worker proof, inherited `emitEvents_` returns when no event
  bus module service is configured, so mutation behavior remains unchanged
  while the event aggregation boundary is no longer app-local.
- The app-local framework utility shim now contains no local runtime behavior;
  it is only a composition alias of proven shared leaves.

Affected boundary:

- Explicit `@EmitEvents()` decorators in Cart module service methods.
- Module-sdk context injection for message aggregation.
- Cloudflare Worker composition for `@medusajs/framework/utils`.

Validation:

- `@medusajs/utils` build passed.
- Focused module-sdk `EmitEvents` tests: 2 passing.
- Existing Cart integration suite through Drizzle/SQLite: 63 passing.
- Cloudflare app type-check and 2 tests passed.
- Portable entrypoint guard passed for `emit-events`: 5 bundled inputs.
- Portable entrypoint guard passed for `modules-sdk/portable`: 38 bundled
  inputs.
- Composed Worker import guard passed with 369 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Cart Durable Object SQLite workerd proof passed.
- Production Worker build passed: 549.70 kB, gzip 116.05 kB.

## Shared Static Module Runtime Composition In Worker

Commit:

- `2c3633e5c8 refactor: share static module runtime composition`

The Cloudflare app now shares the small runtime composition wrapper used by
the Currency and Cart proof modules. The new app-local
`static-module-runtime.ts` owns the Drizzle persistence adapter selection,
minimal logger registration, Medusa container creation, and
`MedusaModule.bootstrap` call.

Differences from original Medusa:

- This is a Worker proof composition helper; original Medusa does not have an
  app-local Drizzle/static module runtime wrapper.
- Currency and Cart keep module-specific files only for their static manifest,
  service type, and manager entrypoint.
- The helper still bootstraps the actual Medusa module services through
  `MedusaModule.bootstrap`; it does not introduce parallel services,
  repositories, routes, events, or workflows.

Affected boundary:

- Cloudflare Worker proof composition for static Currency and Cart modules.
- The current manager-driven Drizzle runtime path for D1 and Durable Object
  SQLite.

Validation:

- Cloudflare app type-check passed.
- Cloudflare app tests passed: 2 tests.
- Composed Worker import guard passed with 370 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed. The script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Cart Durable Object SQLite workerd proof passed.
- Production Worker build passed: 549.89 kB, gzip 116.26 kB.

## Shared Static App Loader Entrypoint

Commit:

- `0f57972467 refactor: add shared static app loader`

The static manifest bootstrap boundary moved one step out of the Cloudflare
app and into `@medusajs/modules-sdk/static-app`. The new precise entrypoint
owns the reusable static module application mechanics:

- logger registration;
- shared container creation or reuse;
- internal module declaration assembly;
- `MedusaModule.bootstrap` invocation with explicit module definition,
  module exports, static resources, and persistence adapter.

Differences from original Medusa:

- `@medusajs/modules-sdk/static-app` is an additive Worker-safe subpath. The
  existing `@medusajs/modules-sdk` root remains Node-oriented and still applies
  Node defaults through `node-defaults`.
- The Cloudflare app no longer owns generic static module container/logger
  bootstrap. Its app-local `static-module-runtime.ts` selects the concrete
  Drizzle adapter and manager, then delegates shared bootstrap to
  `loadStaticModule`.
- The shared loader imports only contracts and precise shared leaves. It does
  not import Drizzle, MikroORM, PostgreSQL, filesystem discovery, Express, or
  the Node package root barrel.

Affected boundary:

- Shared modules-sdk static manifest application bootstrap.
- Cloudflare Currency and Cart proof module composition.
- Portable entrypoint guard coverage.

Validation:

- `@medusajs/modules-sdk` build passed.
- Full `@medusajs/modules-sdk` suite passed: 77 tests.
- Cloudflare app type-check passed.
- Cloudflare app tests passed: 2 tests.
- Portable entrypoint guard passed for `@medusajs/modules-sdk/static-app`:
  42 bundled inputs.
- Composed Worker import guard passed with 372 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed. The script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Cart Durable Object SQLite workerd proof passed.
- Production Worker build passed: 550.53 kB, gzip 116.39 kB.

## Static Module Set Loader

Commit:

- `0207511790 refactor: load static module sets`

`@medusajs/modules-sdk/static-app` now supports loading a set of static module
manifests into one shared container with `loadStaticModules`. This is the
application-level shape needed before the Cloudflare app can select a commerce
module manifest set instead of composing each module one by one.

Differences from original Medusa:

- Original Medusa module loading is configured from Node app configuration and
  filesystem/package resolution. The new static set loader accepts already
  imported module definitions, exports, and resources.
- The static set loader still delegates module behavior to
  `MedusaModule.bootstrapAll`; it does not create a replacement module loader,
  service layer, route layer, event bus, or workflow engine.
- The single-module `loadStaticModule` path remains available for focused
  proofs and typed service wrappers.

Affected boundary:

- Shared modules-sdk static application bootstrap.
- Future Cloudflare manifest aggregation for all commerce modules.
- Current Currency and Cart proof validation through the same static app
  entrypoint bundle.

Validation:

- `@medusajs/modules-sdk` build passed.
- Focused static app tests passed: 2 tests.
- Full `@medusajs/modules-sdk` suite passed: 78 tests.
- Cloudflare app type-check passed.
- Cloudflare app tests passed: 2 tests.
- Portable entrypoint guard passed for `@medusajs/modules-sdk/static-app`:
  42 bundled inputs.
- Composed Worker import guard passed with 372 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed. The script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Cart Durable Object SQLite workerd proof passed.
- Production Worker build passed: 550.89 kB, gzip 116.44 kB.

## Commerce Module Set Proof

Commit:

- `8083f796f4 refactor: compose commerce module set in Cart proof`

The Cloudflare app now has a first explicit commerce module set in
`apps/medusa-cloudflare/src/commerce-modules.ts`. The set imports Currency and
Cart static manifests, selects the Drizzle persistence adapter at the
application boundary, and loads both modules through
`loadStaticModules`.

Differences from original Medusa:

- Original Medusa still discovers and loads configured modules through the
  Node app configuration path. This proof uses an explicit Worker-safe
  Currency + Cart manifest set.
- `CartProofDO` now compiles the combined Currency + Cart DML schema and
  obtains the Cart service from the commerce module set runtime.
- The proof still runs the actual Cart and Currency module services. It does
  not add replacement commerce services or final tenant partition routing.

Affected boundary:

- Cloudflare Cart Durable Object proof composition.
- First app-level static commerce manifest set.
- Shared `loadStaticModules` integration with real module manifests.

Validation:

- Cloudflare app type-check passed.
- Cloudflare app tests passed: 2 tests.
- Focused static app tests passed: 2 tests.
- Portable entrypoint guard passed for `@medusajs/modules-sdk/static-app`:
  42 bundled inputs.
- Composed Worker import guard passed with 372 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed. The script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Cart Durable Object SQLite workerd proof passed through the commerce module
  set.
- Production Worker build passed: 553.24 kB, gzip 116.84 kB.

## Store Static Manifest

Commit:

- `34d8e1ce9d feat: add Store static manifest`

The Store module now owns a typed `static-manifest` export with its module
definition, module service, DML models, empty loader list, and portable joiner
config. This gives Store the same manifest surface already used by Currency
and Cart before it is added to the Worker commerce module set.

Differences from original Medusa:

- Original Store uses the normal `Module(Modules.STORE, ...)` export and Node
  discovery path. The new manifest provides explicit resources for static
  Worker composition.
- `@medusajs/store` now exposes package subpaths for root, models, services,
  and `./static-manifest`.
- Store is not yet added to `apps/medusa-cloudflare` runtime composition; that
  waits until its Drizzle compatibility path is proven with the existing Store
  assertions.

Affected boundary:

- Store module package metadata.
- Store static resource discovery replacement path.
- Future commerce module set expansion.

Validation:

- `@medusajs/store` build passed.
- Store static manifest drift test passed.
- Existing Store package test command passed: 2 tests.

## Store In Worker Commerce Module Set

Commit:

- `ca26a59e7f feat: compose Store in Worker commerce module set`

The Cloudflare app now composes Store with Currency and Cart in the explicit
Worker-safe commerce module set. Store is loaded through its module-owned
static manifest and the shared `loadStaticModules` path; the application root
still only selects manifests, the Drizzle adapter, and the concrete manager.

Differences from original Medusa:

- Original Medusa still loads Store through Node module configuration and
  filesystem/package discovery. The Worker app imports Store's static manifest
  explicitly.
- The combined Durable Object SQLite schema now includes Store, Currency, and
  Cart DML models.
- `CartProofDO` exercises Store by creating and listing a real Store with
  supported currencies and locales before running the existing Cart aggregate
  proof.
- Store package-local runtime imports were made relative and framework type
  imports were made type-only so Store can share a Worker bundle with other
  modules without global alias collisions or runtime type-barrel imports.
- The app utility shim gained only precise shared leaf re-exports required by
  Store: `getDuplicates`, `removeUndefined`, and named `MedusaService`.

Affected boundary:

- Cloudflare static commerce module set composition.
- Store module source import portability.
- Precise `@medusajs/utils` common leaf exports used by Worker composition.

Validation:

- `@medusajs/utils` build passed.
- `@medusajs/store` build passed.
- Existing Store integration suite through Drizzle/SQLite passed: 12 tests.
- Cloudflare app type-check passed.
- Cloudflare app tests passed: 2 tests.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Composed Worker import guard passed with 381 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed. The script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Store + Cart Durable Object SQLite workerd proof passed through the commerce
  module set.
- Production Worker build passed: 562.51 kB, gzip 118.44 kB.
- `git diff --check` passed.

## Sales Channel In Worker Commerce Module Set

Commit:

- `e8d7010cd9 feat: compose Sales Channel in Worker module set`

Sales Channel now follows the same static composition path as Currency, Cart,
and Store. The module owns a `static-manifest` export and the Cloudflare app
adds it to the explicit commerce module set loaded through
`loadStaticModules`.

Differences from original Medusa:

- Original Sales Channel is loaded through Node module configuration and
  package/filesystem discovery. The Worker app imports its static manifest
  explicitly.
- Sales Channel now exports package subpaths for root, models, services, and
  `./static-manifest`.
- The module's joiner config now uses the same DML-derived portable joiner
  builder as its static manifest.
- The combined Durable Object SQLite schema now includes Sales Channel, Store,
  Currency, and Cart DML models.
- `CartProofDO` creates and lists a real Sales Channel before running the
  Store and Cart aggregate proof from the same module set.

Affected boundary:

- Sales Channel static resource discovery replacement path.
- Cloudflare static commerce module set composition.
- Durable Object SQLite module-set proof.

Validation:

- `@medusajs/sales-channel` build passed.
- Sales Channel package tests passed: 2 tests.
- Existing Sales Channel integration suite through Drizzle/SQLite passed: 14
  tests.
- Cloudflare app type-check passed.
- Cloudflare app tests passed: 2 tests.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Composed Worker import guard passed with 387 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed. The script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Sales Channel + Store + Cart Durable Object SQLite workerd proof passed
  through the commerce module set.
- Production Worker build passed: 568.67 kB, gzip 118.96 kB.
- `git diff --check` passed.

## Region In Worker Commerce Module Set

Commit:

- `38d364dc12 feat: compose Region in Worker module set`

Region now follows the same static composition path as Currency, Cart, Store,
and Sales Channel. The module owns a `static-manifest` export and the
Cloudflare app adds it to the explicit commerce module set loaded through
`loadStaticModules`.

Differences from original Medusa:

- Original Region is loaded through Node module configuration and
  package/filesystem discovery. The Worker app imports Region's static
  manifest explicitly.
- Region now exports package subpaths for root, models, services, and
  `./static-manifest`.
- The static manifest includes Region's real default country loader, so the
  Worker proof uses the same country seed path as the module runtime.
- The app utility shim gained only precise shared leaf re-exports required by
  Region: `arrayDifference`, `ContainerRegistrationKeys`, and country
  defaults.
- The combined Durable Object SQLite schema now includes Region, Sales
  Channel, Store, Currency, and Cart DML models.
- `CartProofDO` creates and lists a real Region with a loaded country before
  running the Store, Sales Channel, and Cart checks from the same module set.

Affected boundary:

- Region static resource discovery replacement path.
- Cloudflare static commerce module set composition.
- Durable Object SQLite module-set proof.
- Precise `@medusajs/utils` common/defaults leaf exports used by Worker
  composition.

Validation:

- `@medusajs/region` build passed.
- Region package static-manifest test passed: 1 test.
- Existing Region integration suite through Drizzle/SQLite passed: 18 tests.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 tests.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Composed Worker import guard passed with 396 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed; the script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Region + Sales Channel + Store + Cart Durable Object SQLite workerd proof
  passed through the commerce module set.
- Fresh local D1 migration check passed.
- Production Worker build passed: 600.87 kB, gzip 125.15 kB.
- `git diff --check` passed.

## Customer In Worker Commerce Module Set

Commit:

- `5952a88a43 feat: compose Customer in Worker module set`

Customer now follows the same static composition path as Currency, Cart, Store,
Sales Channel, and Region. The module owns a `static-manifest` export and the
Cloudflare app adds it to the explicit commerce module set loaded through
`loadStaticModules`.

Differences from original Medusa:

- Original Customer is loaded through Node module configuration and
  package/filesystem discovery. The Worker app imports Customer's static
  manifest explicitly.
- Customer now exports package subpaths for root, models, services, and
  `./static-manifest`.
- Customer's static manifest includes Customer, CustomerAddress,
  CustomerGroup, and CustomerGroupCustomer DML models plus a DML-derived
  portable joiner config.
- The combined Durable Object SQLite schema now includes Customer, Region,
  Sales Channel, Store, Currency, and Cart DML models.
- `CartProofDO` creates a real Customer with an address, creates a Customer
  group, adds the customer to the group, and lists customers through the
  many-to-many group filter before running the Region, Sales Channel, Store,
  and Cart checks from the same module set.

Affected boundary:

- Customer static resource discovery replacement path.
- Cloudflare static commerce module set composition.
- Durable Object SQLite module-set proof.
- Shared Drizzle relation filtering, partial unique-index validation, and
  hard-delete detach behavior used by Worker composition.

Validation:

- `@medusajs/drizzle` build passed.
- Drizzle package tests passed: 36 tests.
- `@medusajs/customer` build passed.
- Customer package static-manifest test passed: 1 test.
- Existing Customer integration suite through Drizzle/SQLite passed: 47 tests.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 tests.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Composed Worker import guard passed with 405 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed; the script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Customer + Region + Sales Channel + Store + Cart Durable Object SQLite
  workerd proof passed through the commerce module set.
- Fresh local D1 migration check passed.
- Production Worker build passed: 623.26 kB, gzip 128.14 kB.
- `git diff --check` passed.

## Product In Worker Commerce Module Set

Commit:

- `dc9d40d051 feat: compose Product in Worker module set`

Product now follows the same static composition path as Currency, Cart, Store,
Sales Channel, Region, and Customer. The module owns a `static-manifest`
export and the Cloudflare app adds it to the explicit commerce module set
loaded through `loadStaticModules`.

Differences from original Medusa:

- Original Product is loaded through Node module configuration and
  package/filesystem discovery. The Worker app imports Product's static
  manifest explicitly.
- Product now exports package subpaths for root, models, services, and
  `./static-manifest`.
- Product's static manifest includes all Product DML models for schema
  compilation and preserves Product's existing explicit joiner metadata for
  `variant_id`, `id`/`handle` primary keys, aliases, and GraphQL schema.
- Product's Worker graph no longer depends on package-local `@models` aliases
  or value imports for MikroORM-only repository types in the static path.
- The Worker framework-utils shim exposes only the Product utilities needed by
  the actual Product service path, including a MikroORM-free event-subscriber
  constructor for non-Mikro runtimes.
- The combined Durable Object SQLite schema now includes Product, Customer,
  Region, Sales Channel, Store, Currency, and Cart DML models.
- `CartProofDO` creates and lists a real Product before running the Customer,
  Region, Sales Channel, Store, and Cart checks from the same module set.

Affected boundary:

- Product static resource discovery replacement path.
- Cloudflare static commerce module set composition.
- Durable Object SQLite module-set proof.
- Worker-safe utility shim exports needed by Product composition.
- Cart totals projection fields needed by the Drizzle relation loader.

Validation:

- `@medusajs/utils` build passed.
- `@medusajs/cart` build passed.
- `@medusajs/product` build passed.
- Product package static-manifest test passed: 1 test.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 tests.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Composed Worker import guard passed with 425 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Product + Customer + Region + Sales Channel + Store + Cart Durable Object
  SQLite workerd proof passed through the commerce module set.
- Production Worker build passed: 724.53 kB, gzip 144.04 kB.
- `git diff --check` passed.

## Store Cart Customer Fetch Proof

Implementation commit:

- `138d9d0222 Prove Store cart customer route in Fetch proof`

The Fetch HTTP adapter proof now executes the real
`POST /store/carts/:id/customer` Store API route through the generated static
HTTP manifest in workerd.

Differences from original Medusa:

- Original Medusa discovers and registers this route through filesystem
  discovery and Express. The Worker proof imports the route through the
  generated static manifest and executes it through `FetchHttpAdapter`.
- The route keeps Medusa's mandatory customer authentication contract. The
  proof adapter prepares a request session from `x-medusa-customer-id-proof`
  so the existing `authenticate("customer", ["session", "bearer"])`
  middleware path can run without pulling the Worker-unsafe JWT/CommonJS
  verifier into the proof bundle.
- The route-local workflow id is localized to the route file as
  `"transfer-cart-customer"` to avoid importing the broad `@medusajs/core-flows`
  runtime graph into the Worker proof.
- Source-level TypeScript resolution for the Cloudflare app now maps
  `@medusajs/framework/zod` to the framework source wrapper and maps
  `@medusajs/framework/feature-flags` to a type-only Worker shim for
  `FlagSettings`. The zod wrapper now re-exports the zod types used by Medusa
  validators when the app type-checks against source.

Affected boundary:

- `packages/medusa/src/api/store/carts/[id]/customer/route.ts`
- `packages/medusa/src/static/http-proof-manifest.ts`
- `apps/medusa-cloudflare/src/static-http-proof.ts`
- `apps/medusa-cloudflare/src/http-proof/resources.ts`
- `apps/medusa-cloudflare/src/medusa-framework-feature-flags.ts`
- `apps/medusa-cloudflare/tsconfig.json`
- `packages/core/framework/src/zod/index.ts`

Validation:

- Static HTTP proof manifest generation passed.
- Static HTTP proof manifest drift check passed.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1137 bundled inputs.
- Full Cart Durable Object SQLite workerd proof passed and verifies
  `POST /store/carts/:id/customer` with Store global publishable-key
  middleware, locale middleware, mandatory customer session auth, route-local
  body/query validation, `Modules.WORKFLOW_ENGINE.run("transfer-cart-customer",
  ...)`, and existing cart refetch behavior.
- Production Worker build passed: 2,334.14 kB, gzip 430.65 kB.
- `git diff --check` passed.

## Store Cart Complete Fetch Proof

Implementation commit:

- `9ecfb46ae1 Prove Store cart complete route in Fetch proof`

The Fetch HTTP adapter proof now executes the real
`POST /store/carts/:id/complete` Store API route through the generated static
HTTP manifest in workerd.

Differences from original Medusa:

- Original Medusa discovers and registers this route through filesystem
  discovery and Express. The Worker proof imports the route through the
  generated static manifest and executes it through `FetchHttpAdapter`.
- The route-local workflow id is localized to the route file as
  `"complete-cart"` to avoid importing the broad `@medusajs/core-flows`
  runtime graph into the Worker proof.
- The route now imports `prepareRetrieveQuery` from
  `@medusajs/framework/http`, which is the precise HTTP boundary that already
  exports query preparation. The Cloudflare app's HTTP shim exposes that leaf
  instead of aliasing the broad `@medusajs/framework` package root.
- The proof workflow engine returns the `transaction.hasFinished()` shape
  required by the real complete route and returns an order id for the route's
  final `query.graph({ entity: "order" })` lookup.

Affected boundary:

- `packages/medusa/src/api/store/carts/[id]/complete/route.ts`
- `packages/medusa/src/static/http-proof-manifest.ts`
- `apps/medusa-cloudflare/src/medusa-framework-http.ts`
- `apps/medusa-cloudflare/src/http-proof/resources.ts`
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs`
- `apps/medusa-cloudflare/scripts/check-workerd-cart-do-sqlite.mjs`

Validation:

- Static HTTP proof manifest generation passed.
- Static HTTP proof manifest drift check passed.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1138 bundled inputs.
- Full Cart Durable Object SQLite workerd proof passed and verifies
  `POST /store/carts/:id/complete` with Store global publishable-key
  middleware, locale middleware, unauthenticated Store auth observation,
  route-local order query validation, `Modules.WORKFLOW_ENGINE.run("complete-cart",
  ...)`, `transaction.hasFinished()`, and final `query.graph` order lookup.
- Production Worker build passed: 2,336.86 kB, gzip 431.29 kB.
- `git diff --check` passed.

## Portable HTTP Entry Point

Implementation commit:

- `d98c019a2e Move Fetch HTTP shim to framework portable entrypoint`

The Worker-safe HTTP exports previously owned by the Cloudflare app now live in
`@medusajs/framework/http/portable`.

Differences from original Medusa:

- Original Medusa exposes `@medusajs/framework/http` as the broad HTTP barrel,
  which includes Express registration, filesystem discovery, and Node runtime
  behavior.
- The fork now adds `packages/core/framework/src/http/portable.ts` as a narrow
  shared framework entrypoint for HTTP middleware, validation, refetch, query
  preparation, and HTTP types already proven in the Fetch adapter path.
- The Cloudflare app still maps route imports of `@medusajs/framework/http` to
  a Worker-safe target, but that target is now a shared framework file instead
  of `apps/medusa-cloudflare/src/medusa-framework-http.ts`.
- The default Node package export for `@medusajs/framework/http` is unchanged,
  preserving the existing Express path. The new package subpath is additive:
  `@medusajs/framework/http/portable`.

Affected boundary:

- `packages/core/framework/src/http/portable.ts`
- `packages/core/framework/package.json`
- `apps/medusa-cloudflare/vite.config.ts`
- `apps/medusa-cloudflare/tsconfig.json`
- `apps/medusa-cloudflare/scripts/check-portable-imports.mjs`

Validation:

- `@medusajs/framework` build passed.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 1138 bundled inputs.
- Static HTTP proof manifest drift check passed.
- Full Cart Durable Object SQLite workerd proof passed with the shared portable
  HTTP entrypoint.
- Production Worker build passed: 2,336.86 kB, gzip 431.29 kB.
- `git diff --check` passed.

## Admin Currency Fetch Adapter Proof

Implementation commit:

- `3e36bfa9be Add Admin currency Worker HTTP proof`

Differences from original Medusa:

- The static HTTP proof manifest now includes the existing Admin currency
  handlers:
  - `packages/medusa/src/api/admin/currencies/route.ts`
  - `packages/medusa/src/api/admin/currencies/[code]/route.ts`
  - `packages/medusa/src/api/admin/currencies/middlewares.ts`
- The Admin currency middleware now imports `validateAndTransformQuery` from
  the portable `@medusajs/framework/http` entrypoint instead of the root
  `@medusajs/framework` barrel.
- `FetchHttpAdapter` now applies middleware policy metadata when RBAC is
  enabled, matching the Express adapter behavior, without importing the broad
  `check-permissions` helper or the broad `@medusajs/utils` barrel into the
  Worker graph.
- The Cloudflare static HTTP proof currency data now reuses Medusa's default
  currency catalog, preserving the 123-row baseline expected by the existing
  Admin currency integration assertions.
- `apps/medusa-cloudflare` aliases
  `@medusajs/utils/defaults/currencies` to the TypeScript source so the Worker
  does not execute the package's CommonJS build output.

Affected boundary:

- `packages/core/framework/src/http/adapters/fetch.ts`
- `packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts`
- `packages/medusa/src/api/admin/currencies/middlewares.ts`
- `packages/medusa/src/static/http-proof-manifest.ts`
- `apps/medusa-cloudflare/src/http-proof/resources.ts`
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs`
- `apps/medusa-cloudflare/scripts/check-workerd-cart-do-sqlite.mjs`
- `apps/medusa-cloudflare/vite.config.ts`

Validation:

- `@medusajs/framework` build passed.
- Focused `FetchHttpAdapter` Jest file passed: 19 tests.
- Static HTTP proof manifest drift check passed.
- Portable entrypoint check passed.
- Composed Worker import guard passed: 1144 bundled inputs.
- `medusa-cloudflare test:cart-do-sqlite` passed and now asserts the real
  Admin currency route through workerd.

Known validation gap:

- `medusa-cloudflare test` still fails before executing tests with Vite's
  dependency optimizer error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.
  The workerd proof and import guard are the current reliable Worker gates for
  this slice.

## Medusa-Owned Static HTTP Currency Manifest

Implementation commit:

- `48029b09cc Prove Medusa static manifest through Express`

The static HTTP manifest path is no longer only an app-local Cloudflare proof
mechanism. The Medusa package now owns a small generated Currency HTTP manifest
that imports the real Admin and Store Currency route and middleware modules and
types them as `StaticHttpResourceManifest`.

Differences from original Medusa:

- Original Medusa discovers these route and middleware files at runtime through
  filesystem scanning and registers them onto Express.
- This fork now adds a Medusa-owned build-time manifest generator for the
  proven Currency HTTP boundary:
  `packages/medusa/scripts/generate-static-http-manifest.mjs`.
- The generated manifest is checked in at
  `packages/medusa/src/static/http-currency-manifest.ts`.
- The generated manifest is exposed through the narrow package subpath
  `@medusajs/medusa/static/http-currency-manifest`.
- The package has explicit generation and drift-check scripts:
  `generate:static-http-manifest` and `check:static-http-manifest`.
- The existing Express/filesystem path is unchanged. This slice only creates a
  package-owned static descriptor artifact that can later feed the same
  `StaticHttpManifestResolver` used by Fetch and Express adapter tests.

Affected boundary:

- Medusa package HTTP static manifest generation.
- Medusa package static HTTP manifest export surface.
- Admin Currency and Store Currency route and middleware descriptor ownership.
- Future HTTP bootstrap convergence between filesystem discovery, Express, and
  Fetch/Worker adapters.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace @medusajs/medusa build
node node_modules/jest/bin/jest.js --runInBand packages/core/framework/src/build-tools/__tests__/static-http-manifest.spec.ts
node -e "console.log(require.resolve('@medusajs/medusa/static/http-currency-manifest'))"
yarn workspace medusa-cloudflare check:imports
```

Result: all passed. The package export resolved to
`packages/medusa/dist/static/http-currency-manifest.js`, and the composed
Worker import guard remained clean with 1380 bundled inputs.

Validation note:

- A broader direct Jest invocation of existing `ApiLoader` static HTTP tests
  was not used as a gate in this slice because the direct command path failed
  during fixture bootstrap with a default event-bus package resolution error,
  before exercising this generated manifest. The focused build-tool manifest
  test and Medusa package build/drift/export checks are the relevant gates for
  this slice.

Next step:

- Add an opt-in Express static-manifest smoke path using this Medusa-owned
  manifest. The goal is to prove that the manifest is a shared Medusa HTTP
  resource boundary, not a Cloudflare-only proof artifact.

## Opt-In Express Static Manifest Smoke

Implementation commit:

- `dd67dccf30 Generate Medusa HTTP manifest from route list`

The Medusa package API loader now exposes the existing `ApiLoader`
`HttpResourceResolver` hook at the Medusa loader boundary, allowing an
application or test to opt into static HTTP resources while preserving the
default filesystem discovery path.

Differences from original Medusa:

- Original Medusa's package API loader always builds source paths and lets
  `ApiLoader` discover route and middleware files from the filesystem.
- This fork keeps that default path unchanged, but adds an optional
  `resourceResolver` to `packages/medusa/src/loaders/api.ts`.
- The top-level Medusa loader now forwards an optional `apiResourceResolver`
  into entrypoint loading, so the normal Express bootstrap boundary can consume
  a static manifest without rebuilding route registration in an app.
- A Medusa package smoke test registers the generated Currency manifest through
  the real Express loader path and calls `GET /store/currencies`.
- The smoke test exercises Store global publishable-key middleware, locale/auth
  global middleware ordering, Currency route query validation, and the real
  Currency route handler's remote-query call.

Affected boundary:

- Medusa package API entrypoint loading.
- Express consumption of Medusa-owned static HTTP manifests.
- Store Currency route and middleware registration through
  `StaticHttpManifestResolver`.

Validation:

```bash
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace @medusajs/medusa build
yarn workspace medusa-cloudflare check:imports
```

Result: all passed. The composed Worker import guard remained clean with 1380
bundled inputs.

Validation note:

- `yarn workspace @medusajs/medusa test --runInBand --testPathPattern=api-static-http-manifest`
  also ran and the new smoke test passed, but the package script already
  hardcodes `--testPathPattern=src`, so Jest also executed unrelated Medusa
  package tests. The unrelated instrumentation fixture failed during module
  bootstrap with `No service found in module Analytics` before exercising this
  slice. The exact-file Jest command above is the reliable focused gate.

Next step:

- Move the generated manifest input beyond the hardcoded Currency file list:
  generate a small real Store/Admin manifest from a build-time route list while
  keeping runtime filesystem discovery out of the Worker graph.

## Build-Time Route List Static Manifest Input

Implementation commit:

- `1b27116222 Add product tags to Medusa static HTTP manifest`

The Medusa-owned Currency static HTTP manifest is now generated from an
explicit build-time route-list file instead of route and middleware folder
scans embedded in the generator script.

Differences from original Medusa:

- Original Medusa discovers API route and middleware files at runtime through
  filesystem scanning.
- Earlier fork work moved the Currency HTTP boundary into a generated Medusa
  package manifest, but the generator still scanned selected Currency folders
  at build time.
- This slice adds
  `packages/medusa/static-http-manifests/currency.json` as the explicit
  Store/Admin route and middleware input for the generated Currency manifest.
- `packages/medusa/scripts/generate-static-http-manifest.mjs` now reads that
  route-list file, validates that every listed source file exists, and renders
  the same `StaticHttpResourceManifest` module through the shared framework
  build tool.
- The generated manifest output remains a static TypeScript module. Runtime
  Express and Worker paths do not scan the filesystem.

Affected boundary:

- Medusa package static HTTP manifest generation input.
- Store/Admin Currency route and middleware descriptor ownership.
- Future expansion path for package-owned static HTTP manifests.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace @medusajs/medusa check:static-http-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace medusa-cloudflare check:imports
yarn workspace @medusajs/medusa build
git diff --check
```

Result: all passed. The generated manifest's route and middleware imports were
unchanged apart from the generated header pointing at the new input file. The
composed Worker import guard remained clean with 1380 bundled inputs.

Next step:

- Expand the package-owned static HTTP manifest input by one additional
  already-proven Store/Admin route group and keep the same Express static
  manifest smoke gate passing before touching broader HTTP bootstrap.

## Store Product Tags In Static HTTP Manifest

Implementation commit:

- `ba72811dcf Rename Medusa static HTTP manifest`

The Medusa-owned static HTTP manifest input now includes the Store product-tags
route group in addition to the initial Admin/Store Currency route group.

Differences from original Medusa:

- Original Medusa discovers Store product-tags routes and middleware at
  runtime through filesystem scanning.
- This fork now lists the Store product-tags route files and middleware file in
  the explicit build-time static HTTP manifest input:
  `packages/medusa/static-http-manifests/currency.json`.
- The generated manifest imports the real Store product-tags route modules and
  `storeProductTagRoutesMiddlewares`.
- The focused Express smoke now proves both `GET /store/currencies` and
  `GET /store/product-tags` execute through the same generated manifest,
  Store global middleware stack, route-local validation middleware, and real
  route handlers.
- No workflow-backed Admin write routes were added in this slice. The chosen
  expansion is a small read-only Store route group to keep import-graph risk
  bounded.

Affected boundary:

- Medusa package static HTTP manifest input.
- Store product-tags HTTP route and middleware descriptor ownership.
- Express static-manifest consumption through the Medusa API loader.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:imports
yarn workspace @medusajs/medusa build
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1380
bundled inputs.

Next step:

- Rename or introduce a general package-owned static HTTP manifest name before
  adding more non-Currency route groups, so the artifact name matches its
  broader Store/Admin scope.

## General Medusa Static HTTP Manifest Name

Implementation commit:

- `5e9832e146 Add product types to Medusa static HTTP manifest`

The package-owned generated HTTP manifest now uses a general Store/Admin scope
name instead of the initial Currency-only artifact name.

Differences from original Medusa:

- Original Medusa has no package-owned static HTTP manifest; it discovers route
  and middleware files from the filesystem at runtime.
- Earlier fork slices introduced the generated manifest as
  `http-currency-manifest` because Currency was the first route group.
- The generated manifest now lives at
  `packages/medusa/src/static/http-manifest.ts` and exports
  `medusaStaticHttpManifest`.
- The explicit build-time input is now
  `packages/medusa/static-http-manifests/store-admin.json`.
- `@medusajs/medusa/static/http-manifest` is the primary package subpath.
- `@medusajs/medusa/static/http-currency-manifest` remains as a compatibility
  subpath and re-exports `medusaStaticHttpManifest` as
  `medusaCurrencyStaticHttpManifest`, so existing callers can migrate
  incrementally.
- The focused Express smoke now imports the general manifest name.

Affected boundary:

- Medusa package static HTTP manifest export surface.
- Generated static HTTP manifest input and output naming.
- Compatibility path for existing Currency-manifest imports.

Validation:

```bash
yarn workspace @medusajs/medusa check:static-http-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace medusa-cloudflare check:imports
yarn workspace @medusajs/medusa build
node -e "console.log(require.resolve('@medusajs/medusa/static/http-manifest'))"
node -e "console.log(require.resolve('@medusajs/medusa/static/http-currency-manifest'))"
git diff --check
```

Result: all passed. The new package subpath resolved to
`packages/medusa/dist/static/http-manifest.js`, and the compatibility subpath
resolved to `packages/medusa/dist/static/http-currency-manifest.js`. The
composed Worker import guard remained clean with 1380 bundled inputs.

Next step:

- Continue route-group expansion against the general
  `medusaStaticHttpManifest` artifact, one already-proven read route group at a
  time.

## Store Product Types In Static HTTP Manifest

Implementation commit:

- `877aaaba66 Add collections to Medusa static HTTP manifest`

The general Medusa static HTTP manifest now includes the Store product-types
route group.

Differences from original Medusa:

- Original Medusa discovers Store product-types route and middleware files from
  the filesystem at runtime.
- This fork now lists the Store product-types list and retrieve route files,
  plus `storeProductTypeRoutesMiddlewares`, in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Store product-types
  route modules and middleware.
- The focused Express smoke now proves `GET /store/currencies`,
  `GET /store/product-tags`, and `GET /store/product-types` execute through the
  same generated manifest, Store global middleware stack, route-local
  validation middleware, and real route handlers.
- No workflow-backed routes were added in this slice.

Affected boundary:

- Medusa package static HTTP manifest input.
- Store product-types HTTP route and middleware descriptor ownership.
- Express static-manifest consumption through the Medusa API loader.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:imports
yarn workspace @medusajs/medusa build
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1380
bundled inputs.

Next step:

- Continue with another already-proven read route group, likely Store
  collections or Store locales, after checking import/runtime risk.

## Store Collections In Static HTTP Manifest

Implementation commit:

- `4fc76f1142 Add regions to Medusa static HTTP manifest`

The general Medusa static HTTP manifest now includes the Store collections
route group.

Differences from original Medusa:

- Original Medusa discovers Store collections route and middleware files from
  the filesystem at runtime.
- This fork now lists the Store collections list and retrieve route files,
  plus `storeCollectionRoutesMiddlewares`, in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Store collections
  route modules and middleware.
- The focused Express smoke now proves `GET /store/currencies`,
  `GET /store/product-tags`, `GET /store/product-types`, and
  `GET /store/collections` execute through the same generated manifest, Store
  global middleware stack, route-local validation middleware, and real route
  handlers.
- Store locales was not chosen for this slice because its route is gated by
  the translation feature flag. Collections is the lower-noise read-route proof.

Affected boundary:

- Medusa package static HTTP manifest input.
- Store collections HTTP route and middleware descriptor ownership.
- Express static-manifest consumption through the Medusa API loader.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:imports
yarn workspace @medusajs/medusa build
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1380
bundled inputs.

Next step:

- Continue with another already-proven read route group that does not require
  feature-flag setup or workflow-backed writes.

## Workflow Subscription Static HTTP Routes

Implementation commit:

- `69921ef7b2 Add Fetch session hooks for Auth session route`

The Medusa admin workflow subscription routes now execute through the generated
static HTTP manifest and the Fetch adapter.

Differences from original Medusa:

- Original Medusa discovers these route files from the filesystem and runs
  their Server-Sent Events response through Express/Node HTTP.
- This fork now lists the two workflow subscription route files in
  `packages/medusa/static-http-manifests/store-admin.json` and regenerates
  `packages/medusa/src/static/http-manifest.ts`.
- The existing workflow execution middleware now imports validation helpers
  from `@medusajs/framework/http` instead of the broad
  `@medusajs/framework` barrel, keeping the Worker bundle graph portable.
- The unchanged subscription handlers were tightened to remove local `any`
  usage now that the routes are part of the Worker graph.
- The Cloudflare proof workflow service now implements typed
  `subscribe`/`unsubscribe` methods only for the proof fixture, so the real
  handlers can stream a deterministic SSE event in the app-level Worker test.
- The proof setup matcher no longer claims
  `/admin/workflows-executions/:workflow_id/subscribe`, allowing the real
  static route to run.
- `FetchHttpAdapter` now treats response-stream cancellation as an idempotent
  close path. This is required when a client cancels an SSE reader and the
  existing handler also calls `res.end()` from its close hook.

Affected boundary:

- Medusa static HTTP manifest input and generated manifest.
- Admin workflow execution subscription HTTP routes and middleware import
  boundary.
- Framework Fetch adapter streaming close/cancel behavior.
- Cloudflare app proof workflow service fixture and Worker unit coverage.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa check:static-http-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
node node_modules/jest/bin/jest.js --config packages/core/framework/jest.config.js --runInBand packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/framework build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:portable-entrypoints
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:real-module-imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: passed. The composed Worker import guard remained clean with 1537
bundled inputs. The broad Wrangler Cart proof intentionally does not open the
long-lived SSE route because Wrangler local treats the open subscription as a
hung request during shutdown; the app-level Worker unit test covers the route
stream and cancellation path directly.

Next step:

- Continue production HTTP bootstrap only where another unchanged Medusa
  handler exposes a missing Fetch/runtime surface. Do not move proof-only
  setup endpoints into package manifests unless the real route can run against
  shared services or a documented proof fixture.

## Fetch Adapter Streaming Response Bridge

Implementation commit:

- `69921ef7b2 Add Fetch session hooks for Auth session route`

The Fetch HTTP adapter now supports the small Express response/request surface
used by the existing Medusa workflow subscription handlers.

Differences from original Medusa:

- Original Medusa runs these handlers through Express and Node's HTTP response
  stream.
- This fork keeps the unchanged handlers and adds the equivalent runtime bridge
  at the Fetch adapter boundary.
- `FetchHttpAdapter` now supports `res.writeHead(...)`, `res.write(...)`, and
  `res.end(...)` with a `ReadableStream` response body.
- `req.on("close", ...)` is mapped to the Fetch request abort signal so
  existing cleanup hooks can run when the request is cancelled.
- This is intentionally not app-owned proof scaffolding. It is shared adapter
  behavior needed before production Fetch bootstrap can execute more unchanged
  Medusa HTTP handlers.

Affected boundary:

- Framework Fetch HTTP adapter.
- Existing Medusa workflow subscription HTTP routes that depend on
  Express-style streaming helpers.
- Worker-compatible HTTP runtime surface for unchanged Medusa handlers.

Validation:

```bash
node node_modules/jest/bin/jest.js --config packages/core/framework/jest.config.js --runInBand packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/framework build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:portable-entrypoints
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:real-module-imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: passed. The composed Worker import guard remained clean with 1532
bundled inputs.

Next step:

- Run the Worker HTTP proof/import gates for this adapter change, then continue
  toward production HTTP bootstrap only where the next missing runtime surface
  is proven by an unchanged Medusa handler or integration assertion.

## Static HTTP Resource Set Composition In Framework

Implementation commit:

- `1b56da771d Move static resource composition into framework`

The reusable HTTP resource-set composition previously open-coded in the
Cloudflare proof app now lives in the framework static HTTP utilities.

Differences from original Medusa:

- Original Medusa assembles route and middleware resources through the
  Express/filesystem loader path and does not need a static resource-set
  composition helper.
- This fork now exposes `composeStaticHttpResourceSets` from
  `@medusajs/framework/http/static`.
- The helper concatenates static route descriptors, middleware descriptors,
  body-parser config routes, and additional-data validator routes in caller
  order, with later error handlers replacing earlier ones.
- `apps/medusa-cloudflare/src/http-proof/resources.ts` now layers proof global
  middlewares, package-owned Medusa manifest resources, and proof tail
  middlewares/error handling through the shared helper.
- Proof-only fake services, setup routes, and request preparation remain
  app-owned. This slice does not introduce a replacement Medusa bootstrap.

Affected boundary:

- Framework static HTTP resource utilities and public static HTTP entrypoint.
- Cloudflare proof resource assembly.
- Worker import graph for the composed Fetch/static HTTP runtime.

Validation:

```bash
node node_modules/jest/bin/jest.js --config packages/core/framework/jest.config.js --runInBand packages/core/framework/src/http/__tests__/static-http-resources.spec.ts packages/core/framework/src/http/__tests__/fetch-static-subpath-composition.spec.ts
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/framework build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Inspect the remaining request-scope and request-preparation code in
  `apps/medusa-cloudflare/src/http-proof/resources.ts`. Move only reusable
  Fetch/Medusa request lifecycle helpers into framework; leave proof-only
  auth headers, fake services, and setup state in the app.

## Request Context Helpers In Framework

Implementation commit:

- `350cee1310 Move request context helpers into framework`

The reusable request auth and publishable-key context access previously
repeated in the Cloudflare proof app and framework Fetch tests now lives in
framework HTTP utilities.

Differences from original Medusa:

- Original Medusa writes request auth context directly inside Express-oriented
  middleware and route flows.
- This fork now exposes request context helpers from the HTTP entrypoints:
  `getMedusaRequestAuthContext`, `setMedusaRequestAuthContext`,
  `getMedusaRequestPublishableKeyContext`, and
  `setMedusaRequestPublishableKeyContext`.
- The helpers centralize the only assertions needed to attach or read
  `auth_context` and `publishable_key_context` on `MedusaRequest`.
- `setMedusaRequestAuthContext` can also persist the auth context into
  `req.session.auth_context`, which the Fetch proof uses to run unchanged
  session-aware Store auth middleware.
- Framework `authenticate`, publishable-key middleware, Fetch policy checks,
  Fetch adapter tests, and the Cloudflare proof request preparation now use
  the shared helpers.
- Proof-only fake services, setup routes, and proof-specific header decoding
  remain app-owned.

Affected boundary:

- Framework HTTP request lifecycle utilities and public HTTP entrypoints.
- Existing framework auth and publishable-key middleware.
- Fetch adapter policy context reads.
- Cloudflare proof request preparation and auth-context middleware probes.

Validation:

```bash
node node_modules/jest/bin/jest.js --config packages/core/framework/jest.config.js --runInBand packages/core/framework/src/http/__tests__/request-context.spec.ts packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts packages/core/framework/src/http/__tests__/fetch-static-subpath-composition.spec.ts
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/framework build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The composed Worker import guard remained clean with 1382
bundled inputs.

Next step:

- Inspect the remaining proof setup-path handler and request setup state in
  `apps/medusa-cloudflare/src/http-proof/resources.ts`. Only extract a shared
  framework boundary if it is generic HTTP lifecycle behavior; proof-only
  setup state and fake service data stay in the app.

## Static HTTP Path Pattern Matcher In Framework

Implementation commit:

- `33028a356f Move setup path matching into framework`

The reusable setup-path matching primitive used by the Cloudflare proof app now
lives in the framework static HTTP path matcher utilities.

Differences from original Medusa:

- Original Medusa does not need a setup-path matcher because filesystem
  discovered routes are registered directly into Express.
- This fork now exposes `createStaticHttpPathPatternMatcher` and
  `matchStaticHttpPathPattern` from `@medusajs/framework/http/static`.
- The helper matches exact string paths and regular expression patterns and
  resets regular expression state before each match, so global regex patterns
  are safe to reuse.
- `apps/medusa-cloudflare/src/http-proof/resources.ts` now keeps the
  proof-owned setup path list as data and delegates matching to the framework
  helper.
- Proof-only setup responses, fake service state, and setup request routing
  remain app-owned.

Affected boundary:

- Framework static HTTP path matcher utilities and public static HTTP
  entrypoint.
- Cloudflare proof setup-path matching.
- Worker import graph for the composed Fetch/static HTTP runtime.

Validation:

```bash
node node_modules/jest/bin/jest.js --config packages/core/framework/jest.config.js --runInBand packages/core/framework/src/http/__tests__/static-http-path-matcher.spec.ts packages/core/framework/src/http/__tests__/fetch-static-subpath-composition.spec.ts
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/framework build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The composed Worker import guard remained clean with 1382
bundled inputs.

Next step:

- Stop extracting from proof setup responses unless a real generic framework
  boundary appears. The remaining `handleStaticHttpProofSetupRequest` body is
  mostly proof-owned fake data routing, so the next practical HTTP-runtime
  step should be chosen from package bootstrap or test-runner integration
  rather than moving fake setup handlers.

## Store Payment Providers In Static HTTP Manifest

Implementation commit:

- `6322c01c37 Add payment providers to Medusa static HTTP manifest`

The general Medusa static HTTP manifest now includes the Store payment
providers route group.

Differences from original Medusa:

- Original Medusa discovers Store payment-provider route and middleware files
  from the filesystem at runtime.
- This fork now lists the Store payment-provider route file and
  `storePaymentProvidersMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Store payment
  providers route module and middleware.
- The focused Express smoke now proves `GET /store/payment-providers` executes
  through the same generated manifest, Store global middleware stack,
  route-local validation middleware, and real route handler.
- The smoke explicitly passes `region_id`, preserving the route's required
  filter contract.
- Workflow-backed Store customers, carts, and shipping options remain outside
  this manifest expansion slice.

Affected boundary:

- Medusa package static HTTP manifest input.
- Store payment-providers HTTP route and middleware descriptor ownership.
- Express static-manifest consumption through the Medusa API loader.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa check:static-http-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1380
bundled inputs.

Next step:

- Wire the package-owned general manifest into the Cloudflare app proof path.

## Cloudflare Proof Consumes Package Static HTTP Manifest

Implementation commit:

- `720dbe05af Consume Medusa static HTTP manifest in Worker proof`

The Cloudflare HTTP proof composition now imports the package-owned
`medusaStaticHttpManifest` and merges it with the broader app-owned proof
manifest.

Differences from original Medusa:

- Original Medusa discovers HTTP routes and middleware from the filesystem at
  startup.
- Earlier fork slices introduced a package-owned generated manifest for a
  focused Store/Admin subset.
- This slice makes the Cloudflare proof app consume that package-owned
  manifest at composition time, while keeping the broader generated proof
  manifest for routes that are not yet part of the package-owned artifact.
- Shared entries are keyed by route `relativePath` and middleware `source`, so
  package-owned entries can replace matching proof entries without duplicate
  registration.
- The workerd proof fixture now has the minimum state required for the existing
  real routes it exercises: currency filter echo, initial cart email,
  promotion seed, shipping option fulfillment graph, tax country, aggregate tax
  projection, payment collection provider, and product list pagination aligned
  with sliced query behavior.

Affected boundary:

- `apps/medusa-cloudflare` static HTTP proof composition.
- Package-owned Medusa static HTTP manifest consumption in the Worker import
  graph.
- Workerd HTTP proof fixture data for existing Store cart, currency, product,
  promotion, shipping, tax, and completion route checks.

Validation:

```bash
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Start shrinking the app-owned proof manifest generator only where the
  package-owned manifest already covers the route group, then move the next
  route group into the package-owned manifest when the proof composition stays
  clean.

## App Proof Manifest Drops Package-Owned Route Groups

Implementation commit:

- `2f315dacde Shrink Worker proof manifest to package-owned routes`

The app-owned Cloudflare proof manifest generator no longer emits route and
middleware entries already covered by package-owned `medusaStaticHttpManifest`.

Differences from original Medusa:

- Original Medusa performs filesystem route and middleware discovery at
  runtime.
- This fork now has two build-time manifest layers during migration:
  package-owned `medusaStaticHttpManifest` for route groups already moved into
  Medusa package ownership, and app-owned `medusaStaticHttpProofManifest` for
  the broader Cloudflare proof surface.
- This slice removes duplicated app-proof generation for admin currencies,
  Store currencies, Store regions, Store payment-providers, Store collections,
  Store product-tags, and Store product-types.
- The Cloudflare proof composition still receives those routes and middleware
  through `medusaStaticHttpManifest`, so the app proof remains thin and does
  not retain duplicate imports for already-migrated groups.

Affected boundary:

- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs`.
- Generated `packages/medusa/src/static/http-proof-manifest.ts`.
- Cloudflare proof manifest ownership split between package-owned and
  app-owned generated manifests.

Validation:

```bash
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Move the next useful real route group into the package-owned static manifest,
  then repeat the proof-generator shrink only after the Worker proof stays
  clean.

## Store Products In Package Static HTTP Manifest

Implementation commit:

- `41a7d9e3df Move Store products into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Store products
route group, and the app-owned Worker proof manifest no longer generates
duplicate Store product entries.

Differences from original Medusa:

- Original Medusa discovers Store product route and middleware files from the
  filesystem at runtime.
- This fork now lists `packages/medusa/src/api/store/products/route.ts`,
  `packages/medusa/src/api/store/products/[id]/route.ts`, and
  `storeProductRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Store product list
  and retrieve handlers plus their real middleware stack.
- The focused Express smoke now proves `GET /store/products` executes through
  the package-owned manifest, publishable API-key middleware, sales-channel
  filtering, product query middleware, and the real route handler.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  scans Store products, so the Worker proof receives that group through
  `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Store products HTTP route and middleware descriptor ownership.
- Express static-manifest smoke coverage.
- Cloudflare app proof manifest generator and generated proof manifest.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Move Store product variants into the package-owned static manifest if the
  focused Express smoke can cover it without adding workflow-backed setup.

## Store Product Variants In Package Static HTTP Manifest

Implementation commit:

- `a4f0c863dc Move Store product variants into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Store product
variants route group, and the app-owned Worker proof manifest no longer
generates duplicate Store product-variant entries.

Differences from original Medusa:

- Original Medusa discovers Store product-variant route and middleware files
  from the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/store/product-variants/route.ts`,
  `packages/medusa/src/api/store/product-variants/[id]/route.ts`, and
  `storeProductVariantRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Store product
  variant list and retrieve handlers plus their real middleware stack.
- The focused Express smoke now proves `GET /store/product-variants` executes
  through the package-owned manifest, publishable API-key middleware,
  sales-channel filtering, product-variant middleware, and the real route
  handler.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  scans Store product variants, so the Worker proof receives that group
  through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Store product variants HTTP route and middleware descriptor ownership.
- Express static-manifest smoke coverage.
- Cloudflare app proof manifest generator and generated proof manifest.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Evaluate Store shipping options or Store locales for the package-owned static
  manifest, choosing the one that can be covered with the least extra setup.

## Store Locales In Package Static HTTP Manifest

Implementation commit:

- `320e061ae8 Move Store locales into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the feature-flagged
Store locales route, and the app-owned Worker proof manifest no longer
generates duplicate Store locales entries.

Differences from original Medusa:

- Original Medusa discovers the Store locales route and middleware files from
  the filesystem at runtime, and skips the route when the translation feature
  flag is disabled.
- This fork now lists
  `packages/medusa/src/api/store/locales/route.ts` and
  `storeLocalesRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Store locales
  handler and middleware while preserving the existing `defineFileConfig`
  feature-flag gate through the static route builder's disabled-file check.
- The focused Express smoke now enables the translation feature flag during
  static resource registration and proves `GET /store/locales` executes
  through the package-owned manifest, publishable API-key middleware, and the
  real query-backed route handler.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  scans Store locales, so the Worker proof receives that route through
  `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Feature-flagged Store locales HTTP route and middleware descriptor ownership.
- Express static-manifest smoke coverage.
- Cloudflare app proof manifest generator and generated proof manifest.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Evaluate Store shipping options as a separate workflow-engine route proof
  before moving more workflow-backed Store routes into the package manifest.

## Store Shipping Options In Package Static HTTP Manifest

Implementation commit:

- `0f1f2a6c6b Move Store shipping options into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the workflow-backed
Store shipping-options route group, and the app-owned Worker proof manifest no
longer generates duplicate Store shipping-options entries.

Differences from original Medusa:

- Original Medusa discovers Store shipping-options route and middleware files
  from the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/store/shipping-options/route.ts`,
  `packages/medusa/src/api/store/shipping-options/[id]/calculate/route.ts`,
  and `storeShippingOptionRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Store shipping
  option list and calculate handlers plus their real middleware stack.
- The focused Express smoke now proves `GET /store/shipping-options` executes
  through the package-owned manifest, publishable API-key middleware,
  route-local query validation, workflow-engine resolution, and the real route
  handler.
- The smoke records the current Medusa list behavior: without an explicit
  `fields` query parameter, the list workflow receives `fields: []`.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  scans Store shipping options, so the Worker proof receives that group
  through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Workflow-backed Store shipping-options HTTP route and middleware descriptor
  ownership.
- Express static-manifest smoke coverage.
- Cloudflare app proof manifest generator and generated proof manifest.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue reducing the app-owned proof manifest with another narrow route
  group, or switch back to the HTTP adapter/runtime boundary now that a
  workflow-backed Store route is package-owned.

## Admin Plugins And Feature Flags In Package Static HTTP Manifest

Implementation commit:

- `75a4675c6d Move admin utility routes into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin plugins
and Admin feature-flags route group, and the app-owned Worker proof manifest no
longer generates duplicate entries for those admin utility routes.

Differences from original Medusa:

- Original Medusa discovers Admin plugins and Admin feature-flags route files
  from the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/plugins/route.ts` and
  `packages/medusa/src/api/admin/feature-flags/route.ts` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin plugins
  handler, which still uses the normal Admin auth middleware, and the real
  Admin feature-flags handler, which still opts out of auth via
  `AUTHENTICATE = false`.
- The focused Express smoke now proves `GET /admin/plugins` executes through
  the package-owned manifest with a session `auth_context`, and
  `GET /admin/feature-flags` executes through the package-owned manifest with
  the real feature-flag router registered in the request scope.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  scans Admin plugins and Admin feature-flags, so the Worker proof receives
  those routes through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin utility route descriptor ownership.
- Express static-manifest smoke coverage for Admin auth and unauthenticated
  Admin route opt-out behavior.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another small admin route group from the static manifest
  migration checklist, likely Admin stores or Admin product tags.

## Admin Stores In Package Static HTTP Manifest

Implementation commit:

- `2bb555b8df Move admin stores into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin stores
route group, and the app-owned Worker proof manifest no longer generates
duplicate entries for Admin stores.

Differences from original Medusa:

- Original Medusa discovers Admin stores route and middleware files from the
  filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/stores/route.ts`,
  `packages/medusa/src/api/admin/stores/[id]/route.ts`, and
  `adminStoreRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin stores list,
  retrieve, and update handlers plus their real middleware stack.
- The focused Express smoke now proves `GET /admin/stores` executes through
  the package-owned manifest with Admin session auth, route-local query
  validation, and the real remote-query-backed route handler.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  lists Admin stores routes or scans their middleware, so the Worker proof
  receives that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin stores route and middleware descriptor ownership.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  store remote query.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The first `test:cart-do-sqlite` run hit a transient Vite
Worker harness `Network connection lost` error that returned HTML to the JSON
client; rerunning the same command passed. The composed Worker import guard
remained clean with 1381 bundled inputs.

Next step:

- Continue with another small admin route group from the static manifest
  migration checklist, likely Admin product tags.

## Admin Product Tags In Package Static HTTP Manifest

Implementation commit:

- `bdf646dd8b Move admin product tags into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin product
tags route group, and the app-owned Worker proof manifest no longer generates
duplicate entries for Admin product tags.

Differences from original Medusa:

- Original Medusa discovers Admin product-tags route and middleware files from
  the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/product-tags/route.ts` and
  `adminProductTagRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin product-tags
  list/create handler module plus its real middleware stack.
- The focused Express smoke now proves `GET /admin/product-tags` executes
  through the package-owned manifest with Admin session auth, route-local query
  validation, and the real `refetchEntities` query-backed route handler.
- The smoke records the current Admin refetch behavior: the helper calls
  `query.graph` without a locale options object, unlike Store localized routes.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  lists Admin product-tags routes or scans their middleware, so the Worker
  proof receives that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin product-tags route and middleware descriptor ownership.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  product-tag query refetch.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another small admin metadata route group from the static
  manifest migration checklist, likely Admin product types.

## Admin Product Types In Package Static HTTP Manifest

Implementation commit:

- `1928a2252f Move admin product types into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin product
types route group, and the app-owned Worker proof manifest no longer generates
duplicate entries for Admin product types.

Differences from original Medusa:

- Original Medusa discovers Admin product-types route and middleware files from
  the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/product-types/route.ts`,
  `packages/medusa/src/api/admin/product-types/[id]/route.ts`, and
  `adminProductTypeRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin product-types
  list/create and retrieve/update/delete handler modules plus their real
  middleware stack.
- The focused Express smoke now proves `GET /admin/product-types` executes
  through the package-owned manifest with Admin session auth, route-local query
  validation, and the real remote-query-backed list route handler.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  scans Admin product types routes or middleware, so the Worker proof receives
  that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin product-types route and middleware descriptor ownership.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  product-type remote query.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another small or medium admin route group from the static
  manifest migration checklist, likely Admin collections, regions, or sales
  channels.

## Admin Regions In Package Static HTTP Manifest

Implementation commit:

- `87704c1440 Move admin regions into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin regions
route group, and the app-owned Worker proof manifest no longer generates
duplicate entries for Admin regions.

Differences from original Medusa:

- Original Medusa discovers Admin regions route and middleware files from the
  filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/regions/route.ts`,
  `packages/medusa/src/api/admin/regions/[id]/route.ts`, and
  `adminRegionRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin regions
  list/create and retrieve/update/delete handler modules plus their real
  middleware stack.
- The focused Express smoke now proves `GET /admin/regions` executes through
  the package-owned manifest with Admin session auth, route-local query
  validation, and the real remote-query-backed list route handler.
- The smoke records the current loader-path behavior: `GET /admin/regions`
  returns `limit: 50` from the generated remote-query metadata in this test
  harness.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  lists Admin regions routes or scans their middleware, so the Worker proof
  receives that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin regions route and middleware descriptor ownership.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  region remote query.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another medium admin route group from the static manifest
  migration checklist, likely Admin collections or Admin sales channels.

## Admin Sales Channels In Package Static HTTP Manifest

Implementation commit:

- `67d45fd3b4 Move admin sales channels into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin sales
channels route group, and the app-owned Worker proof manifest no longer
generates duplicate entries for Admin sales channels.

Differences from original Medusa:

- Original Medusa discovers Admin sales-channel route and middleware files from
  the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/sales-channels/route.ts`,
  `packages/medusa/src/api/admin/sales-channels/[id]/route.ts`,
  `packages/medusa/src/api/admin/sales-channels/[id]/products/route.ts`, and
  `adminSalesChannelRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin sales-channel
  list/create, retrieve/update/delete, and product-link handler modules plus
  their real middleware stack.
- The focused Express smoke now proves `GET /admin/sales-channels` executes
  through the package-owned manifest with Admin session auth, route-local query
  validation, link-filter middleware, and the real remote-query-backed list
  route handler.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  lists Admin sales-channel routes or scans their middleware, so the Worker
  proof receives that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin sales-channel route and middleware descriptor ownership.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  sales-channel remote query.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another medium admin route group from the static manifest
  migration checklist, likely Admin collections or Admin price preferences.

## Admin Collections In Package Static HTTP Manifest

Implementation commit:

- `6377bb0add Move admin collections into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin
collections route group, and the app-owned Worker proof manifest no longer
generates duplicate entries for Admin collections.

Differences from original Medusa:

- Original Medusa discovers Admin collection route and middleware files from
  the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/collections/route.ts`,
  `packages/medusa/src/api/admin/collections/[id]/route.ts`,
  `packages/medusa/src/api/admin/collections/[id]/products/route.ts`, and
  `adminCollectionRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin collection
  list/create, retrieve/update/delete, and product-link handler modules plus
  their real middleware stack.
- The focused Express smoke now proves `GET /admin/collections` executes
  through the package-owned manifest with Admin session auth, route-local query
  validation, and the real remote-query-backed list route handler.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  lists Admin collection routes or scans their middleware, so the Worker proof
  receives that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin collection route and middleware descriptor ownership.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  collection remote query.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another medium admin route group from the static manifest
  migration checklist, likely Admin price preferences or Admin refund reasons.

## Admin Price Preferences In Package Static HTTP Manifest

Implementation commit:

- `a58462ad86 Move admin price preferences into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin price
preferences route group, and the app-owned Worker proof manifest no longer
generates duplicate entries for Admin price preferences.

Differences from original Medusa:

- Original Medusa discovers Admin price-preference route and middleware files
  from the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/price-preferences/route.ts`,
  `packages/medusa/src/api/admin/price-preferences/[id]/route.ts`, and
  `adminPricePreferencesRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin
  price-preference list/create and retrieve/update/delete handler modules plus
  their real middleware stack.
- The focused Express smoke now proves `GET /admin/price-preferences` executes
  through the package-owned manifest with Admin session auth, route-local query
  validation, and the real `refetchEntities` query-backed list route handler.
- The smoke records the current route behavior: `GET /admin/price-preferences`
  returns `limit: 300` from the generated query pagination metadata in this
  test harness.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  lists Admin price-preference routes or scans their middleware, so the Worker
  proof receives that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin price-preference route and middleware descriptor ownership.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  price-preference query graph execution.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another medium admin route group from the static manifest
  migration checklist, likely Admin refund reasons or Admin fulfillment
  providers.

## Admin Refund Reasons In Package Static HTTP Manifest

Implementation commit:

- `69e1cfa9ee Move admin refund reasons into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin refund
reasons route group, and the app-owned Worker proof manifest no longer
generates duplicate entries for Admin refund reasons.

Differences from original Medusa:

- Original Medusa discovers Admin refund-reason route and middleware files
  from the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/refund-reasons/route.ts`,
  `packages/medusa/src/api/admin/refund-reasons/[id]/route.ts`, and
  `adminRefundReasonsRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin
  refund-reason list/create and retrieve/update/delete handler modules plus
  their real middleware stack.
- The focused Express smoke now proves `GET /admin/refund-reasons` executes
  through the package-owned manifest with Admin session auth, route-local query
  validation, and the real `refetchEntities` query-backed list route handler.
- The smoke records the current route behavior: `GET /admin/refund-reasons`
  returns `limit: 15`, driven by `AdminGetRefundReasonsParams`.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  scans Admin refund-reason routes or middleware, so the Worker proof receives
  that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin refund-reason route and middleware descriptor ownership.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  refund-reason query graph execution.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another admin support route group from the static manifest
  migration checklist, likely Admin fulfillment providers or Admin shipping
  profiles.

## Admin Fulfillment Providers In Package Static HTTP Manifest

Implementation commit:

- `8f20d3d8ff Move admin fulfillment providers into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin
fulfillment providers list route, and the app-owned Worker proof manifest no
longer generates duplicate entries for that route group.

Differences from original Medusa:

- Original Medusa discovers Admin fulfillment-provider route and middleware
  files from the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/fulfillment-providers/route.ts` and
  `adminFulfillmentProvidersRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin
  fulfillment-provider list handler module plus its real middleware stack.
- The focused Express smoke now proves `GET /admin/fulfillment-providers`
  executes through the package-owned manifest with Admin session auth,
  route-local query validation, link-filter middleware, and the real
  remote-query-backed list route handler.
- The route file
  `packages/medusa/src/api/admin/fulfillment-providers/[id]/options/route.ts`
  remains out of this slice because the app proof generator did not previously
  own it. This move preserves the existing Worker proof surface instead of
  expanding it.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  lists Admin fulfillment-provider routes or scans their middleware, so the
  Worker proof receives that list route group through
  `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin fulfillment-provider list route and middleware descriptor ownership.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  fulfillment-provider remote query.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another admin support route group from the static manifest
  migration checklist, likely Admin shipping profiles or Admin shipping option
  types.

## Admin Shipping Profiles In Package Static HTTP Manifest

Implementation commit:

- `8cddeab413 Move admin shipping profiles into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin shipping
profiles route group, and the app-owned Worker proof manifest no longer
generates duplicate entries for Admin shipping profiles.

Differences from original Medusa:

- Original Medusa discovers Admin shipping-profile route and middleware files
  from the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/shipping-profiles/route.ts`,
  `packages/medusa/src/api/admin/shipping-profiles/[id]/route.ts`, and
  `adminShippingProfilesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin
  shipping-profile list/create and retrieve/update/delete handler modules plus
  their real middleware stack.
- The focused Express smoke now proves `GET /admin/shipping-profiles` executes
  through the package-owned manifest with Admin session auth, route-local query
  validation, and the real remote-query-backed list route handler.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  scans Admin shipping-profile routes or middleware, so the Worker proof
  receives that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin shipping-profile route and middleware descriptor ownership.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  shipping-profile remote query.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another admin support route group from the static manifest
  migration checklist, likely Admin shipping option types or Admin tax regions.

## Admin Shipping Option Types In Package Static HTTP Manifest

Implementation commit:

- `445ee5c0b6 Move admin shipping option types into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin shipping
option types route group, and the app-owned Worker proof manifest no longer
generates duplicate entries for Admin shipping option types.

Differences from original Medusa:

- Original Medusa discovers Admin shipping-option-type route and middleware
  files from the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/shipping-option-types/route.ts`,
  `packages/medusa/src/api/admin/shipping-option-types/[id]/route.ts`, and
  `adminShippingOptionTypeRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin
  shipping-option-type list/create and retrieve/update/delete handler modules
  plus their real middleware stack.
- The focused Express smoke now proves `GET /admin/shipping-option-types`
  executes through the package-owned manifest with Admin session auth,
  route-local query validation, and the real `query.graph`-backed list route
  handler.
- The smoke records the current handler call shape: this route calls
  `query.graph(...)` with a single argument, not an explicit second
  `undefined` options argument.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  scans Admin shipping-option-type routes or middleware, so the Worker proof
  receives that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin shipping-option-type route and middleware descriptor ownership.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  shipping-option-type query graph execution.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another admin support route group from the static manifest
  migration checklist, likely Admin tax regions or Admin fulfillment sets.

## Admin Tax Regions In Package Static HTTP Manifest

Implementation commit:

- `d94b84148e Move admin tax regions into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin tax
regions route group, and the app-owned Worker proof manifest no longer
generates duplicate entries for Admin tax regions.

Differences from original Medusa:

- Original Medusa discovers Admin tax-region route and middleware files from
  the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/tax-regions/route.ts`,
  `packages/medusa/src/api/admin/tax-regions/[id]/route.ts`, and
  `adminTaxRegionRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin tax-region
  list/create and retrieve/update/delete handler modules plus their real
  middleware stack.
- The focused Express smoke now proves `GET /admin/tax-regions` executes
  through the package-owned manifest with Admin session auth, route-local query
  validation, and the real remote-query-backed list route handler.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  scans Admin tax-region routes or middleware, so the Worker proof receives
  that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin tax-region route and middleware descriptor ownership.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  tax-region remote query.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The first `test:cart-do-sqlite` attempt hit a transient
Vite Worker harness `Network connection lost` response before test assertions;
rerunning the same command passed. The composed Worker import guard remained
clean with 1381 bundled inputs.

Next step:

- Continue with another admin support route group from the static manifest
  migration checklist, likely Admin fulfillment sets or Admin product
  categories.

## Admin Fulfillment Sets In Package Static HTTP Manifest

Implementation commit:

- `b9778a542d Move admin fulfillment sets into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin
fulfillment sets route group, and the app-owned Worker proof manifest no longer
generates duplicate entries for Admin fulfillment sets.

Differences from original Medusa:

- Original Medusa discovers Admin fulfillment-set route and middleware files
  from the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/fulfillment-sets/[id]/route.ts`,
  `packages/medusa/src/api/admin/fulfillment-sets/[id]/service-zones/route.ts`,
  `packages/medusa/src/api/admin/fulfillment-sets/[id]/service-zones/[zone_id]/route.ts`,
  and `adminFulfillmentSetsRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin
  fulfillment-set delete handler, service-zone create handler, and service-zone
  retrieve/update/delete handler modules plus their real middleware stack.
- The focused Express smoke now proves
  `GET /admin/fulfillment-sets/:id/service-zones/:zone_id` executes through
  the package-owned manifest with Admin session auth, nested service-zone
  policy/middleware registration, route-local query validation, and the real
  remote-query-backed service-zone retrieve handler.
- The smoke records the generated remote-query shape for nested
  `*geo_zones`: the route descriptor emits `service_zones.fields` for scalar
  fields and a nested `service_zones.geo_zones.fields` selector.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  scans Admin fulfillment-set routes or middleware, so the Worker proof
  receives that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin fulfillment-set route and middleware descriptor ownership.
- Express static-manifest smoke coverage for nested service-zone route
  registration and remote query.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another admin route group from the static manifest migration
  checklist, likely Admin product categories or Admin stock locations.

## Admin Product Categories In Package Static HTTP Manifest

Implementation commit:

- `720ef3f74b Move admin product categories into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin product
categories route group, and the app-owned Worker proof manifest no longer
generates duplicate entries for Admin product categories.

Differences from original Medusa:

- Original Medusa discovers Admin product-category route and middleware files
  from the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/product-categories/route.ts`,
  `packages/medusa/src/api/admin/product-categories/[id]/route.ts`,
  `packages/medusa/src/api/admin/product-categories/[id]/products/route.ts`,
  and `adminProductCategoryRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin
  product-category list/create, retrieve/update/delete, and product-link
  handler modules plus their real middleware stack.
- The focused Express smoke now proves `GET /admin/product-categories`
  executes through the package-owned manifest with Admin session auth,
  route-local query validation, and the real `query.graph`-backed list route.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  scans Admin product-category routes or middleware, so the Worker proof
  receives that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin product-category route and middleware descriptor ownership.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  product-category query graph execution.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another admin route group from the static manifest migration
  checklist, likely Admin stock locations or Admin API keys before the larger
  workflow-heavy route groups.

## Admin Stock Locations In Package Static HTTP Manifest

Implementation commit:

- `a0b0d3bd90 Move admin stock locations into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin stock
locations route group, and the app-owned Worker proof manifest no longer
generates duplicate entries for Admin stock locations.

Differences from original Medusa:

- Original Medusa discovers Admin stock-location route and middleware files
  from the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/stock-locations/route.ts`,
  `packages/medusa/src/api/admin/stock-locations/[id]/route.ts`,
  `packages/medusa/src/api/admin/stock-locations/[id]/sales-channels/route.ts`,
  `packages/medusa/src/api/admin/stock-locations/[id]/fulfillment-sets/route.ts`,
  `packages/medusa/src/api/admin/stock-locations/[id]/fulfillment-providers/route.ts`,
  and `adminStockLocationRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin
  stock-location list/create, retrieve/update/delete, sales-channel link,
  fulfillment-set create, and fulfillment-provider link handler modules plus
  their real middleware stack.
- The focused Express smoke now proves `GET /admin/stock-locations` executes
  through the package-owned manifest with Admin session auth, route-local
  query validation, link-filter middleware registration, and the real
  remote-query-backed list route.
- The smoke records the generated remote-query shape for nested address
  fields: scalar fields remain in `stock_locations.fields`, while address
  fields are emitted as nested `stock_locations.address.fields`.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  lists Admin stock-location routes or scans their middleware, so the Worker
  proof receives that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin stock-location route and middleware descriptor ownership.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  stock-location remote query execution.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another admin route group from the static manifest migration
  checklist, likely Admin API keys or Admin inventory before the larger
  workflow-heavy route groups.

## Admin API Keys In Package Static HTTP Manifest

Implementation commit:

- `8c940d966c Move admin API keys into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin API keys
route group, and the app-owned Worker proof manifest no longer generates
duplicate entries for Admin API keys.

Differences from original Medusa:

- Original Medusa discovers Admin API-key route and middleware files from the
  filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/api-keys/route.ts`,
  `packages/medusa/src/api/admin/api-keys/[id]/route.ts`,
  `packages/medusa/src/api/admin/api-keys/[id]/revoke/route.ts`,
  `packages/medusa/src/api/admin/api-keys/[id]/sales-channels/route.ts`, and
  `adminApiKeyRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin API-key
  list/create, retrieve/update/delete, revoke, and sales-channel link handler
  modules plus their real middleware stack.
- The focused Express smoke now proves `GET /admin/api-keys` executes through
  the package-owned manifest with Admin session auth, route-local query
  validation, and the real remote-query-backed list route.
- The smoke records the generated remote-query shape for nested sales-channel
  fields: scalar fields remain in `api_key.fields`, while sales-channel fields
  are emitted as nested `api_key.sales_channels.fields`.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  lists Admin API-key routes or scans their middleware, so the Worker proof
  receives that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin API-key route and middleware descriptor ownership.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  API-key remote query execution.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another route group from the static manifest migration
  checklist, likely Admin inventory or Admin reservations before the larger
  workflow-heavy route groups.

## Admin Inventory In Package Static HTTP Manifest

Implementation commit:

- `37339eedad Move admin inventory into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin inventory
route group previously owned by the Worker proof generator, and the app-owned
Worker proof manifest no longer generates duplicate entries for Admin
inventory.

Differences from original Medusa:

- Original Medusa discovers Admin inventory route and middleware files from
  the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/inventory-items/route.ts`,
  `packages/medusa/src/api/admin/inventory-items/[id]/route.ts`,
  `packages/medusa/src/api/admin/inventory-items/[id]/location-levels/route.ts`,
  and `adminInventoryRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin inventory
  item list/create, retrieve/update/delete, and per-item location-level
  list/create handler modules plus their real middleware stack.
- The focused Express smoke now proves `GET /admin/inventory-items` executes
  through the package-owned manifest with Admin session auth, route-local
  query validation, and the real remote-query-backed inventory list route.
- The smoke records the generated remote-query shape for nested location-level
  fields: scalar fields remain in `inventory_items.fields`, while wildcard
  location-level fields are emitted as nested
  `inventory_items.location_levels.fields`.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  lists Admin inventory routes or scans their middleware, so the Worker proof
  receives that route group through `medusaStaticHttpManifest`.
- The broader inventory batch and location-level detail subroutes remain out
  of this slice because the app proof generator did not previously own them.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin inventory route and middleware descriptor ownership.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  inventory remote query execution.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The first `test:cart-do-sqlite` attempt hit a transient
Vite Worker harness `Network connection lost` startup failure before test
assertions; rerunning the same command passed. The composed Worker import
guard remained clean with 1381 bundled inputs.

Next step:

- Continue with another route group from the static manifest migration
  checklist, likely Admin reservations or Admin locales before the larger
  workflow-heavy route groups.

## Admin Reservations In Package Static HTTP Manifest

Implementation commit:

- `7e00e5a719 Move admin reservations into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin
reservations route group, and the app-owned Worker proof manifest no longer
generates duplicate entries for Admin reservations.

Differences from original Medusa:

- Original Medusa discovers Admin reservation route and middleware files from
  the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/reservations/route.ts`,
  `packages/medusa/src/api/admin/reservations/[id]/route.ts`, and
  `adminReservationRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin reservation
  list/create and retrieve/update/delete handler modules plus their real
  middleware stack.
- The focused Express smoke now proves `GET /admin/reservations` executes
  through the package-owned manifest with Admin session auth, route-local
  query validation, and the real remote-query-backed reservation list route.
- The smoke records the generated remote-query shape for nested inventory-item
  fields: scalar fields remain in `reservation.fields`, while inventory-item
  fields are emitted as nested `reservation.inventory_item.fields`.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  lists Admin reservation routes or scans their middleware, so the Worker
  proof receives that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin reservation route and middleware descriptor ownership.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  reservation remote query execution.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another route group from the static manifest migration
  checklist, likely Admin locales or Admin translations before the larger
  workflow-heavy route groups.

## Admin Locales In Package Static HTTP Manifest

Implementation commit:

- `8e43da3078 Move admin locales into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the feature-flagged
Admin locales route group, and the app-owned Worker proof manifest no longer
generates duplicate entries for Admin locales.

Differences from original Medusa:

- Original Medusa discovers Admin locale route and middleware files from the
  filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/locales/route.ts`,
  `packages/medusa/src/api/admin/locales/[code]/route.ts`, and
  `adminLocalesRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real feature-flagged
  Admin locale list and retrieve handler modules plus their real middleware
  stack.
- The focused Express smoke now proves `GET /admin/locales` executes through
  the package-owned manifest with the translation feature flag enabled during
  static route registration, Admin session auth, route-local query validation,
  and the real cached `query.graph` locale list route.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  lists Admin locale routes or scans their middleware, so the Worker proof
  receives that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin locale route and middleware descriptor ownership.
- Feature-flagged static route registration through the Express loader.
- Express static-manifest smoke coverage for Admin session auth plus Admin
  locale `query.graph` execution.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another route group from the static manifest migration
  checklist, likely Admin translations batch or Store customers before the
  larger workflow-heavy route groups.

## Admin Translations Batch In Package Static HTTP Manifest

Implementation commit:

- `2111498a2e Move admin translations batch into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the feature-flagged
Admin translations batch route, and the app-owned Worker proof manifest no
longer generates duplicate entries for that route group.

Differences from original Medusa:

- Original Medusa discovers Admin translations route and middleware files from
  the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/translations/batch/route.ts` and
  `adminTranslationsRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real feature-flagged
  Admin translations batch handler module plus its real middleware stack.
- The focused Express smoke now proves `POST /admin/translations/batch`
  executes through the package-owned manifest with the translations feature
  flag enabled during static route registration, Admin session auth,
  route-local body validation, the real `batch-translations` workflow call,
  and the real `query.graph` translation refetch.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  lists the Admin translations batch route or scans translations middleware, so
  the Worker proof receives that route group through
  `medusaStaticHttpManifest`.
- Other Admin translations routes remain outside this slice because the app
  proof generator did not previously own them.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin translations batch route and middleware descriptor ownership.
- Feature-flagged static route registration through the Express loader.
- Express static-manifest smoke coverage for Admin session auth, route-local
  body validation, workflow execution, and translation query refetch.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with another route group from the static manifest migration
  checklist, likely Store customers or Auth before the larger workflow-heavy
  route groups.

## Store Customers In Package Static HTTP Manifest

Implementation commit:

- `7bd87d25a7 Move store customers into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Store customer
account route group, and the app-owned Worker proof manifest no longer
generates duplicate entries for Store customers.

Differences from original Medusa:

- Original Medusa discovers Store customer route and middleware files from the
  filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/store/customers/route.ts`,
  `packages/medusa/src/api/store/customers/me/route.ts`,
  `packages/medusa/src/api/store/customers/me/addresses/route.ts`,
  `packages/medusa/src/api/store/customers/me/addresses/[address_id]/route.ts`,
  and `storeCustomerRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Store customer
  account handlers plus their real middleware stack.
- The focused Express smoke now proves `GET /store/customers/me` executes
  through the package-owned manifest with publishable-key store middleware,
  customer session authentication, route-local query validation, and the real
  customer `remoteQuery` refetch helper.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  lists Store customer routes or scans their middleware, so the Worker proof
  receives that route group through `medusaStaticHttpManifest`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Store customer route and middleware descriptor ownership.
- Store customer session authentication through the Express loader.
- Express static-manifest smoke coverage for customer auth context,
  publishable-key store middleware, and customer remote-query refetch.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The first `test:cart-do-sqlite` attempt timed out waiting for
the workerd-backed Vite server; no leftover workerd check process was found,
and the immediate rerun passed. The composed Worker import guard remained clean
with 1381 bundled inputs.

Next step:

- Continue with Auth before the larger workflow-heavy route groups, unless a
  smaller blocker appears in the remaining proof generator.

## Auth Provider Routes In Package Static HTTP Manifest

Implementation commit:

- `13ea2356fe Move auth routes into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Auth provider
route group that was previously owned by the app proof manifest, and the
app-owned Worker proof manifest no longer generates duplicate entries for
those Auth routes.

Differences from original Medusa:

- Original Medusa discovers Auth route and middleware files from the
  filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/auth/[actor_type]/[auth_provider]/route.ts`,
  `packages/medusa/src/api/auth/[actor_type]/[auth_provider]/register/route.ts`,
  `packages/medusa/src/api/auth/[actor_type]/[auth_provider]/reset-password/route.ts`,
  `packages/medusa/src/api/auth/[actor_type]/[auth_provider]/update/route.ts`,
  and `authRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Auth provider
  handler modules plus their real middleware stack.
- The focused Express smoke now proves `GET /auth/customer/emailpass`
  executes through the package-owned manifest with route params, configured
  actor/provider association middleware, and the real Auth service
  `authenticate` call.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  lists dynamic Auth provider routes or scans Auth middleware, so the Worker
  proof receives that route group through `medusaStaticHttpManifest`.
- Auth session, token refresh, and callback route files remain outside this
  slice because the app proof generator did not previously own those route
  files.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Auth provider route and middleware descriptor ownership.
- Auth scope/provider association middleware through the Express loader.
- Express static-manifest smoke coverage for Auth route params and Auth
  service invocation.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The first `test:cart-do-sqlite` attempt timed out waiting for
the workerd-backed Vite server, and the second reached the server but hit a
transient Vite/workerd network disconnect. No leftover effect-cf-workflows
workerd process was found, and the third run passed. The composed Worker import
guard remained clean with 1381 bundled inputs.

Next step:

- Continue with one of the four remaining workflow-heavy groups: Admin
  promotions, Admin shipping options, Admin products, or Store carts.

## Admin Promotions In Package Static HTTP Manifest

Implementation commit:

- `88b8bb97e5 Move admin promotions into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin promotion
route file that was previously owned by the app proof manifest, and the
app-owned Worker proof manifest no longer generates duplicate entries for the
Admin promotions group.

Differences from original Medusa:

- Original Medusa discovers Admin promotion route and middleware files from the
  filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/promotions/route.ts` and
  `adminPromotionRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin promotion
  list/create handler module plus its real middleware stack.
- The focused Express smoke now proves `POST /admin/promotions` executes
  through the package-owned manifest with Admin session auth, route-local body
  and query validation, the real `create-promotions` workflow call, and the
  real promotion `remoteQuery` refetch helper.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  lists the Admin promotion route or scans promotion middleware, so the Worker
  proof receives that route group through `medusaStaticHttpManifest`.
- Admin promotion detail, rule batch, and rule option subroutes remain outside
  this slice because the app proof generator did not previously own those
  route files.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin promotion route and middleware descriptor ownership.
- Admin promotion create workflow execution through the Express loader.
- Express static-manifest smoke coverage for Admin auth, route-local
  validation, workflow execution, and promotion remote-query refetch.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The first `test:cart-do-sqlite` attempt timed out waiting for
the workerd-backed Vite server; no leftover effect-cf-workflows process was
found, and the immediate rerun passed. The composed Worker import guard
remained clean with 1381 bundled inputs.

Next step:

- Continue with one of the three remaining workflow-heavy groups: Admin
  shipping options, Admin products, or Store carts.

## Admin Shipping Options In Package Static HTTP Manifest

Implementation commit:

- `e0bd3015a5 Move admin shipping options into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin shipping
option route files that were previously discovered by the app proof manifest's
folder scanner, and the app-owned Worker proof manifest no longer generates
duplicate entries for that group.

Differences from original Medusa:

- Original Medusa discovers Admin shipping option route and middleware files
  from the filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/shipping-options/route.ts`,
  `packages/medusa/src/api/admin/shipping-options/[id]/route.ts`,
  `packages/medusa/src/api/admin/shipping-options/[id]/rules/batch/route.ts`,
  and `adminShippingOptionRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin shipping
  option handlers plus their real middleware stack.
- The focused Express smoke now proves `POST /admin/shipping-options`
  executes through the package-owned manifest with Admin session auth,
  route-local body and query validation, the real
  `create-shipping-options-workflow` call, and the real shipping option
  `query.graph` refetch helper.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  scans Admin shipping option route or middleware folders, so the Worker proof
  receives that route group through `medusaStaticHttpManifest`.
- This removes the last app-owned route folder scan; the remaining app-owned
  route groups are explicit file lists.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin shipping option route and middleware descriptor ownership.
- Admin shipping option create workflow execution through the Express loader.
- Express static-manifest smoke coverage for Admin auth, route-local
  validation, workflow execution, and shipping option query refetch.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: all passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue with Admin products or Store carts, the two remaining app-owned
  route groups.

## Admin Products In Package Static HTTP Manifest

Implementation commit:

- `b9bb22f9fc Move admin products into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Admin product
route files that were previously owned by the app proof manifest's explicit
file list, and the app-owned Worker proof manifest no longer generates
duplicate entries for that group.

Differences from original Medusa:

- Original Medusa discovers Admin product route and middleware files from the
  filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/admin/products/route.ts`,
  `packages/medusa/src/api/admin/products/batch/route.ts`,
  `packages/medusa/src/api/admin/products/[id]/route.ts`,
  `packages/medusa/src/api/admin/products/[id]/variants/route.ts`,
  `packages/medusa/src/api/admin/products/[id]/variants/batch/route.ts`,
  `packages/medusa/src/api/admin/products/[id]/variants/[variant_id]/route.ts`,
  `packages/medusa/src/api/admin/products/[id]/images/[image_id]/variants/batch/route.ts`,
  `packages/medusa/src/api/admin/products/[id]/variants/[variant_id]/images/batch/route.ts`,
  `packages/medusa/src/api/admin/products/[id]/options/route.ts`,
  `packages/medusa/src/api/admin/products/[id]/options/[option_id]/route.ts`,
  and `adminProductRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Admin product
  handler modules plus their real middleware stack.
- The focused Express smoke now proves `POST /admin/products` executes
  through the package-owned manifest with Admin session auth, route-local body
  and query validation, the real `create-products` workflow call, and the real
  product `query.graph` refetch helper.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no longer
  lists Admin product route files or scans Admin product middleware, so the
  Worker proof receives that route group through `medusaStaticHttpManifest`.
- Admin product import/export and variant inventory-item subroutes remain
  outside this slice because the app proof generator did not previously own
  those route files.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin product route and middleware descriptor ownership.
- Admin product create workflow execution through the Express loader.
- Express static-manifest smoke coverage for Admin auth, route-local
  validation, workflow execution, and product query refetch.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The first `test:cart-do-sqlite` attempt timed out waiting for
the workerd-backed Vite server; the immediate rerun passed. The composed
Worker import guard remained clean with 1381 bundled inputs.

Next step:

- Move Store carts, the final remaining app-owned route group in this
  route-ownership goal.

## Store Carts In Package Static HTTP Manifest

Implementation commit:

- `b8a38b2dcd Move store carts into Medusa static manifest`

The package-owned Medusa static HTTP manifest now includes the Store cart
route files that were previously owned by the app proof manifest's explicit
file list, and the app-owned Worker proof manifest no longer generates any
Medusa route or middleware entries.

Differences from original Medusa:

- Original Medusa discovers Store cart route and middleware files from the
  filesystem at runtime.
- This fork now lists
  `packages/medusa/src/api/store/carts/route.ts`,
  `packages/medusa/src/api/store/carts/[id]/route.ts`,
  `packages/medusa/src/api/store/carts/[id]/line-items/route.ts`,
  `packages/medusa/src/api/store/carts/[id]/line-items/[line_id]/route.ts`,
  `packages/medusa/src/api/store/carts/[id]/promotions/route.ts`,
  `packages/medusa/src/api/store/carts/[id]/shipping-methods/route.ts`,
  `packages/medusa/src/api/store/carts/[id]/taxes/route.ts`,
  `packages/medusa/src/api/store/carts/[id]/customer/route.ts`,
  `packages/medusa/src/api/store/carts/[id]/complete/route.ts`, and
  `storeCartRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Store cart handler
  modules plus their real middleware stack.
- The focused Express smoke now proves `POST /store/carts` executes through
  the package-owned manifest with Store request handling, route-local body and
  query validation, the real `create-cart` workflow call, and the real cart
  `remoteQuery` refetch helper.
- `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` now emits
  an empty `medusaStaticHttpProofManifest`; the Cloudflare proof app receives
  Medusa routes from `medusaStaticHttpManifest` and keeps only proof-only
  routes in the app layer.
- This closes the HTTP static manifest migration checklist at 38 moved or
  already package-owned groups and 0 app-owned groups still pending.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Store cart route and middleware descriptor ownership.
- Store cart create workflow execution through the Express loader.
- Express static-manifest smoke coverage for Store cart body/query validation,
  workflow execution, and cart remote-query refetch.
- Cloudflare app proof manifest generator and generated proof manifest.
- HTTP static manifest migration goal checklist.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace medusa-cloudflare generate:http-proof-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The first `test:cart-do-sqlite` attempt timed out waiting for
the workerd-backed Vite server; the immediate rerun passed. The composed
Worker import guard remained clean with 1381 bundled inputs.

Next step:

- Stop route-list migration and continue with the shared HTTP
  adapter/runtime boundary.

## Static HTTP Manifest Merge In Framework

Implementation commit:

- `cc981688ef Move static HTTP manifest merge into framework`

The static HTTP manifest merge behavior used by the Cloudflare proof app now
lives in the framework static HTTP utilities instead of being implemented in
the app.

Differences from original Medusa:

- Original Medusa does not need to merge package-owned static manifests because
  it discovers HTTP resources from the filesystem at runtime.
- This fork now exposes `mergeStaticHttpResourceManifests` from
  `@medusajs/framework/http/static`.
- The helper merges route entries by `relativePath` and middleware entries by
  `source`. Later manifests replace earlier entries with the same key while
  preserving the first keyed position and retaining keyless entries.
- `apps/medusa-cloudflare/src/http-proof/manifest.ts` now imports that helper
  and uses it to merge the empty proof manifest with the package-owned Medusa
  manifest.
- The Cloudflare app no longer owns custom static manifest merge logic for
  Medusa route or middleware resources; app code only composes proof-only
  routes with the framework-provided merge result.

Affected boundary:

- Framework static HTTP resource utilities and public static HTTP entrypoint.
- Cloudflare proof manifest composition.
- Worker import graph for package-owned Medusa HTTP manifests.

Validation:

```bash
node node_modules/jest/bin/jest.js --config packages/core/framework/jest.config.js --runInBand packages/core/framework/src/http/__tests__/static-http-resources.spec.ts packages/core/framework/src/http/__tests__/static-http-path-matcher.spec.ts
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/framework build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The first `test:cart-do-sqlite` attempt timed out waiting for
the workerd-backed Vite server; the immediate rerun passed. The composed
Worker import guard remained clean with 1381 bundled inputs.

Next step:

- Continue reducing app-owned HTTP proof scaffolding by moving reusable Fetch
  runtime composition helpers into framework/package code while keeping
  proof-only services in the app.

## Fetch Static Handler Factory In Framework

Implementation commit:

- `68e80fd0ee Move Fetch static handler composition into framework`

The reusable Fetch runtime composition used by the Cloudflare proof app now
lives in the framework Fetch HTTP subpath instead of being open-coded in the
app entrypoint.

Differences from original Medusa:

- Original Medusa registers HTTP resources through Express and does not need a
  Fetch runtime helper.
- This fork now exposes `createFetchHttpStaticHandler` from
  `@medusajs/framework/http/fetch`.
- The helper owns reusable Fetch runtime lifecycle behavior:
  static-manifest path matching, optional setup-path matching, optional setup
  request interception, lazy `FetchHttpAdapter` construction, and request
  delegation to the adapter.
- `apps/medusa-cloudflare/src/static-http-proof.ts` now supplies only
  app-owned proof hooks: proof resources, proof manifest, setup-path handling,
  request-scope creation, and request preparation.
- Proof-only setup services remain app-owned. This slice does not move fake
  proof services into framework and does not introduce a replacement Medusa
  bootstrap.

Affected boundary:

- Framework Fetch HTTP subpath and `FetchHttpAdapter` helper exports.
- Cloudflare proof Fetch runtime composition.
- Worker import graph for the composed Fetch/static HTTP runtime.

Validation:

```bash
node node_modules/jest/bin/jest.js --config packages/core/framework/jest.config.js --runInBand packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts packages/core/framework/src/http/__tests__/fetch-static-subpath-composition.spec.ts
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/framework build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The composed Worker import guard remained clean with 1381
bundled inputs.

Next step:

- Continue reducing `apps/medusa-cloudflare/src/http-proof/resources.ts` by
  identifying reusable request-scope or proof-resource assembly boundaries
  that can move into package code without moving proof-only fake services.

## HTTP Runtime Boundary Checkpoint

Implementation commit:

- `4c200ba1a4 Move Admin Users role assignment to Fetch manifest`

The HTTP runtime lane was re-checked after the Event Bus proof work to choose
the next non-Event-Bus slice.

Differences from original Medusa:

- No runtime behavior changed in this checkpoint.
- The route-ownership migration is already complete: all tracked app-owned
  route groups have moved into package-owned static HTTP manifests.
- `apps/medusa-cloudflare/src/static-http-proof.ts` is already a thin caller of
  `createFetchHttpStaticHandler` from `@medusajs/framework/http/fetch`.
- The remaining large app-owned HTTP proof surface is
  `apps/medusa-cloudflare/src/http-proof/resources.ts`, which mostly contains
  proof-only fake services, setup state, and fixture behavior needed while the
  real Worker bootstrap is incomplete.
- Moving those fake proof services into framework or package code would blur
  the intended boundary. Framework should own runtime-neutral adapters and
  manifest/resource utilities; the app may temporarily own proof fixtures until
  the real Worker bootstrap replaces them.
- The HTTP integration runner record already audits all HTTP spec files:
  every unchanged HTTP spec has a current Cloudflare validation record except
  the Redis-backed Event Bus spec, which remains blocked by missing Redis.

Affected boundary:

- HTTP runtime planning and ownership boundary only.
- No source code changed.

Validation:

- Inspection of `apps/medusa-cloudflare/src/static-http-proof.ts`.
- Inspection of `packages/core/framework/src/http/adapters/fetch.ts`.
- Inspection of `packages/core/framework/src/http/fetch.ts` and
  `packages/core/framework/src/http/static.ts`.
- Inspection of `plan/fork-changes/http-static-manifest-migration-goal.md` and
  `plan/fork-changes/api-integration-test-runner.md`.
- `git diff --check` passed.

Next step:

- Stop HTTP proof-scaffolding extraction unless a real shared runtime boundary
  appears. Return to the first migration milestone: unchanged Currency service
  and integration assertions passing across MikroORM/Postgres,
  Drizzle/SQLite or D1, and the Drizzle path inside workerd without Node or
  MikroORM imports.

## Store Regions In Static HTTP Manifest

Implementation commit:

- `4c200ba1a4 Move Admin Users role assignment to Fetch manifest`

The general Medusa static HTTP manifest now includes the Store regions route
group.

Differences from original Medusa:

- Original Medusa discovers Store regions route and middleware files from the
  filesystem at runtime.
- This fork now lists the Store regions list and retrieve route files, plus
  `storeRegionRoutesMiddlewares`, in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the real Store regions route
  modules and middleware.
- The focused Express smoke now proves `GET /store/currencies`,
  `GET /store/product-tags`, `GET /store/product-types`,
  `GET /store/collections`, and `GET /store/regions` execute through the same
  generated manifest, Store global middleware stack, route-local validation
  middleware, and real route handlers.
- Store payment-providers was not chosen for this slice because it requires a
  `region_id` filter and touches checkout/provider response shape. Regions is
  the lower-risk read-route proof.

Affected boundary:

- Medusa package static HTTP manifest input.
- Store regions HTTP route and middleware descriptor ownership.
- Express static-manifest consumption through the Medusa API loader.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare check:imports
yarn workspace @medusajs/medusa build
git diff --check
```

Result: all passed. The first Yarn drift/import guard attempt hit a transient
Yarn plugin `Array buffer allocation failed` error before running the commands;
rerunning those Yarn gates with `NODE_OPTIONS=--max-old-space-size=8192`
passed. The composed Worker import guard remained clean with 1380 bundled
inputs.

Next step:

- Continue with another already-proven read route group that does not require
  feature-flag setup or workflow-backed writes.

## Admin Index In Static HTTP Manifest

Implementation commit:

- `4c200ba1a4 Move Admin Users role assignment to Fetch manifest`

The Admin Index details and sync route group now runs through the
package-owned Medusa static HTTP manifest.

Differences from original Medusa:

- Original Medusa discovers the Admin Index route and middleware files from
  the filesystem at runtime.
- This fork now lists `GET /admin/index/details`,
  `POST /admin/index/sync`, and `adminIndexRoutesMiddlewares` in
  `packages/medusa/static-http-manifests/store-admin.json`.
- The generated `medusaStaticHttpManifest` imports the unchanged Admin Index
  route handlers and middleware.
- The Admin Index route and middleware imports were narrowed from the broad
  framework barrel to Worker-safe framework subpaths where needed.
- The Cloudflare proof runtime now registers a small proof implementation of
  the Index service and enables the real Index feature flag so the unchanged
  `isIndexEnabledMiddleware` runs.
- Enabling the Index feature flag also exercises the Store Products
  index-engine branch. The proof query service now exposes an `index()`
  method for product reads, backed by the same static product graph rows with
  index-style metadata.
- Admin proof authentication now persists the proof user context into
  `req.session.auth_context`, matching the real `authenticate()` middleware's
  session path instead of relying only on `req.auth_context`.

Affected boundary:

- Medusa package static HTTP manifest input and generated manifest.
- Admin Index route and middleware ownership.
- Cloudflare proof request preparation and proof query service behavior for
  the Index feature flag.
- Worker import graph for the composed Fetch/static HTTP runtime.

Validation:

```bash
yarn workspace @medusajs/medusa generate:static-http-manifest
node node_modules/jest/bin/jest.js --config packages/medusa/jest.config.js --runInBand packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa check:static-http-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/framework build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:portable-entrypoints
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:real-module-imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The composed Worker import guard remained clean with 1541
bundled inputs. The first parallel `@medusajs/medusa build` attempt failed
with framework package resolution errors while `@medusajs/framework build`
was still running; rerunning the Medusa build after the framework build
completed passed.

Next step:

- Continue HTTP bootstrap only from real unchanged-handler gaps. The next
  useful candidates are remaining package route groups that expose a missing
  Fetch adapter method, auth/session behavior, feature-flag behavior, or
  static manifest ownership gap.

## Fetch Static Handler Manifest Composition

Implementation commit:

- `23a55a2127 Move Admin Users role removal to Fetch manifest`

The shared Fetch static HTTP helper now owns manifest merging and generated
resource insertion for Worker-style static HTTP bootstraps.

Differences from original Medusa:

- Original Medusa still discovers routes and middleware from the filesystem at
  startup for the Node/Express runtime.
- This fork already supports package-owned static manifests as the Worker-safe
  alternative. This slice moves the manifest merge/build glue into
  `createFetchHttpStaticHandler`.
- `createFetchHttpStaticHandler` now accepts either one manifest or a list of
  manifests, builds manifest resources when a prebuilt resource set is not
  provided, and composes optional resources before and after the generated
  manifest resources.
- `apps/medusa-cloudflare/src/http-proof/manifest.ts` now describes only
  app-local proof routes and middleware.
- `apps/medusa-cloudflare/src/static-http-proof.ts` passes the app proof
  manifest plus Medusa package manifests directly to the framework helper.
- `apps/medusa-cloudflare/src/http-proof/resources.ts` no longer builds the
  merged manifest resources itself; it exports proof-only before/after
  resource sets around the package manifest resources.
- This does not move fake proof services into framework or Medusa packages.
  The app still owns proof fixtures and setup state.

Affected boundary:

- Framework Fetch static HTTP bootstrap helper.
- Cloudflare proof HTTP composition root.
- Worker import graph for merged static manifests and generated resources.

Validation:

```bash
node node_modules/jest/bin/jest.js --config packages/core/framework/jest.config.js --runInBand packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts
node node_modules/jest/bin/jest.js --config packages/core/framework/jest.config.js --runInBand packages/core/framework/src/http/__tests__/fetch-static-subpath-composition.spec.ts
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/framework build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:portable-entrypoints
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:real-module-imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The composed Worker import guard remained clean with 1541
bundled inputs.

Next step:

- Continue reducing app-owned HTTP bootstrap only at shared composition
  boundaries like manifest/resource assembly. Leave proof-only fixture
  services and setup endpoints in the app until the real Worker bootstrap no
  longer needs them.

## Medusa Static Manifest Package Exports

Implementation commit:

- This commit.

The Cloudflare app now imports Medusa static HTTP manifests through package
subpaths instead of source-relative paths into `packages/medusa/src`.

Differences from original Medusa:

- Original Medusa does not expose static HTTP manifests for Worker bootstrap.
- This fork already exposed `@medusajs/medusa/static/http-manifest`; this
  slice adds `@medusajs/medusa/static/http-proof-manifest` for the proof
  manifest generated by the Cloudflare HTTP proof runner.
- `apps/medusa-cloudflare/src/static-http-proof.ts` now imports both Medusa
  manifests through `@medusajs/medusa/static/*` package subpaths.
- Local Cloudflare app TS, Vite, and import-guard aliases map those package
  subpaths to source files during development, matching the existing workspace
  alias pattern used for module static manifests.
- Production package resolution uses the package `exports` entry and built
  `dist/static/http-proof-manifest.js`.

Affected boundary:

- Medusa package export surface for static HTTP manifests.
- Cloudflare proof HTTP composition imports.
- Local Worker validation alias tables for app typecheck, Vite, and import
  guard.

Validation:

```bash
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/framework build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/medusa build
node -e "Promise.all([import('@medusajs/medusa/static/http-manifest'), import('@medusajs/medusa/static/http-proof-manifest')]).then(([a,b]) => { if (!a.medusaStaticHttpManifest || !b.medusaStaticHttpProofManifest) throw new Error('missing export'); console.log('medusa static manifest exports resolved') })"
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:portable-entrypoints
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:real-module-imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The composed Worker import guard remained clean with 1541
bundled inputs. The first parallel Medusa build attempt failed while another
command rebuilt framework and temporarily removed framework `dist`; rerunning
framework then Medusa builds sequentially passed.

Next step:

- Continue replacing source-relative app imports with package/static
  entrypoints only where those entrypoints are Worker-safe and already
  validated by the import guard.

## Worker Utility Subpath Exports

Implementation commit:

- This commit.

The Cloudflare app's framework-utils shim now imports the remaining
Worker-safe utility helpers through `@medusajs/utils` package subpaths instead
of direct source-relative paths into `packages/core/utils/src`.

Differences from original Medusa:

- Original Medusa's Node package consumers can use broad utility barrels and
  runtime filesystem discovery.
- This fork needs narrow, Worker-safe package subpaths so the Worker bundle can
  avoid broad barrels that may pull Node-only code.
- `@medusajs/utils` now exports these precise subpaths:
  `common/get-caller-file-path`,
  `common/get-selects-and-relations-from-object-array`,
  `common/remote-query-object-from-string`, `common/to-camel-case`, and
  `core-flows/events`.
- `apps/medusa-cloudflare/src/medusa-framework-utils.ts` now imports those
  helpers from package subpaths instead of `../../../packages/core/utils/src`.
- Local TS, Vite, and import-guard aliases map those package subpaths to
  source files during Worker development and validation.

Affected boundary:

- `@medusajs/utils` package export surface.
- Cloudflare app's Worker-safe framework utils shim.
- Worker import guard alias table.

Validation:

```bash
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/utils build
node -e "Promise.all([import('@medusajs/utils/common/get-caller-file-path'), import('@medusajs/utils/common/get-selects-and-relations-from-object-array'), import('@medusajs/utils/common/remote-query-object-from-string'), import('@medusajs/utils/common/to-camel-case'), import('@medusajs/utils/core-flows/events')]).then(() => console.log('utils package subpath exports resolved'))"
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace @medusajs/framework build
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare typecheck
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:http-proof-manifest
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:portable-entrypoints
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare check:real-module-imports
NODE_OPTIONS=--max-old-space-size=8192 yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The composed Worker import guard remained clean with 1541
bundled inputs. The first app-test attempt failed while package builds were
refreshing `dist`; rerunning after `@medusajs/utils` and
`@medusajs/framework` builds completed passed.

Next step:

- Continue replacing direct source imports with package subpaths only when
  the subpath is narrow, Worker-safe, and backed by package-export validation.

## Worker Runtime Source Import Guard

Implementation commit:

- This commit.

The Cloudflare app now has a focused runtime-source import guard for
`apps/medusa-cloudflare/src`.

Differences from original Medusa:

- Original Medusa's Node bootstrap can reach local source files through
  runtime filesystem and package internals.
- This fork requires the Worker runtime app source to import Medusa through
  package subpaths, static manifests, or app-local composition files.
- `check:runtime-source-imports` fails if `apps/medusa-cloudflare/src`
  directly imports `packages/*/src`.
- Validation and build scripts may still maintain source aliases because they
  are proof wiring, not Worker runtime app source.

Affected boundary:

- Cloudflare app runtime source import policy.
- Worker HTTP/static bootstrap cleanup guard.

Validation:

```bash
yarn workspace medusa-cloudflare check:runtime-source-imports
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:portable-entrypoints
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare test
git diff --check
```

Result: passed. No direct `packages/*/src` imports remain in the
Cloudflare app runtime source, and the composed Worker import guard remained
clean with 1541 bundled inputs.

Next step:

- Stop the source-import cleanup lane unless a new app runtime source reach-in
  appears. Continue with real Worker bootstrap/runtime gaps instead.

## Fetch Static Handler Try-Handle API

Implementation commit:

- This commit.

The shared Fetch static HTTP handler now exposes a `tryHandle(request)` API for
Worker-style composition.

Differences from original Medusa:

- Original Medusa registers routes into Express and lets Express own request
  dispatch.
- This fork needs a Fetch-compatible composition point where the Worker can
  ask the Medusa HTTP handler whether a request belongs to the static manifest
  before falling through to other Worker branches.
- `FetchHttpStaticHandler.tryHandle()` returns `undefined` when the request
  pathname is not covered by the static manifest or setup-path predicate.
- When the path is covered, it reuses the same handler path as
  `FetchHttpStaticHandler.handle()`, including setup interception, request
  preparation, request scope creation, middleware, and unchanged route
  handlers.
- `apps/medusa-cloudflare/src/worker.ts` now composes the HTTP proof handler
  through `tryHandleStaticHttpProof(request)` instead of duplicating path
  dispatch in the Worker entry.

Affected boundary:

- Shared Fetch HTTP static handler API.
- Cloudflare Worker HTTP composition branch.

Validation:

```bash
node_modules\.bin\jest packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts --runInBand --forceExit
yarn workspace @medusajs/framework build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare test
yarn workspace medusa-cloudflare check:runtime-source-imports
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:portable-entrypoints
yarn workspace medusa-cloudflare check:real-module-imports
yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The broader `yarn workspace @medusajs/framework test
--runInBand src/http/__tests__/fetch-http-adapter.spec.ts` command was not a
valid focused invocation because the package script already sets
`--testPathPattern=src`; it widened to unrelated framework HTTP tests and hit
pre-existing Windows path snapshot differences in `routes-loader.spec.ts`.
An initial parallel `@medusajs/framework build` and `medusa-cloudflare
typecheck` run also failed because the build temporarily removed framework
`dist`; rerunning typecheck after the build completed passed.

Next step:

- Continue replacing app-owned Worker dispatch only where the shared Fetch
  HTTP handler can own the boundary without moving proof-only fixtures into
  framework code.

## Store Collections HTTP Workerd Proof

Implementation commit:

- This commit.

The workerd proof now validates the unchanged Store Collections route group
through the shared Fetch HTTP adapter.

Differences from original Medusa:

- Original Medusa executes `GET /store/collections` and
  `GET /store/collections/:id` through Express and filesystem-discovered
  route registration.
- This fork executes the same unchanged route handlers and middleware through
  the static HTTP manifest and Fetch adapter inside workerd.
- The app proof state can now seed product collections through
  `/http-proof/collections`; this remains proof-only fixture state and is not a
  replacement Medusa service.
- The workerd proof asserts Store Collections list, retrieve, publishable-key
  middleware, locale middleware, unauthenticated store auth context, query
  pagination metadata, and not-found error behavior.

Affected boundary:

- Static HTTP proof fixture state.
- Store Collections unchanged route execution through Fetch/workerd.

Validation:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare test:cart-do-sqlite
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:runtime-source-imports
yarn workspace medusa-cloudflare test
yarn workspace medusa-cloudflare check:portable-entrypoints
yarn workspace medusa-cloudflare check:real-module-imports
git diff --check
```

Result: passed. The workerd proof now includes `GET /store/collections`,
`GET /store/collections/:id`, and the missing collection 404 path.
An initial parallel run of `medusa-cloudflare test` with
`check:http-proof-manifest` failed while the manifest check rebuilt framework
`dist`; rerunning the app test after the build completed passed.

Next step:

- Continue adding unchanged route proof coverage only when the required fixture
  state is narrow and keeps real Medusa handlers as the behavioral contract.

## Store Product Tags HTTP Workerd Proof

Implementation commit:

- This commit.

The workerd proof now validates the unchanged Store Product Tags route group
through the shared Fetch HTTP adapter.

Differences from original Medusa:

- Original Medusa executes `GET /store/product-tags` and
  `GET /store/product-tags/:id` through Express and filesystem-discovered
  route registration.
- This fork executes the same unchanged route handlers and middleware through
  the static HTTP manifest and Fetch adapter inside workerd.
- The app proof state can now seed product tags through
  `/http-proof/product-tags`; this remains proof-only fixture state and is not
  a replacement Medusa service.
- The workerd proof asserts Store Product Tags list, retrieve,
  publishable-key middleware, locale middleware, unauthenticated store auth
  context, query pagination metadata, and not-found error behavior.

Affected boundary:

- Static HTTP proof fixture state.
- Store Product Tags unchanged route execution through Fetch/workerd.

Validation:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare test:cart-do-sqlite
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:runtime-source-imports
yarn workspace medusa-cloudflare test
yarn workspace medusa-cloudflare check:portable-entrypoints
yarn workspace medusa-cloudflare check:real-module-imports
git diff --check
```

Result: passed. The workerd proof now includes `GET /store/product-tags`,
`GET /store/product-tags/:id`, and the missing product tag 404 path.
An initial parallel run of `medusa-cloudflare test` with
`check:http-proof-manifest` failed while the manifest check rebuilt framework
`dist`; rerunning the app test after the build completed passed.

Next step:

- Continue with the neighboring Store Product Types route group because it has
  the same narrow fixture shape and remains read-heavy catalog coverage.

## Store Product Types HTTP Workerd Proof

Implementation commit:

- This commit.

The workerd proof now validates the unchanged Store Product Types route group
through the shared Fetch HTTP adapter.

Differences from original Medusa:

- Original Medusa executes `GET /store/product-types` and
  `GET /store/product-types/:id` through Express and filesystem-discovered
  route registration.
- This fork executes the same unchanged route handlers and middleware through
  the static HTTP manifest and Fetch adapter inside workerd.
- The app proof state can now seed product types through
  `/http-proof/product-types`; this remains proof-only fixture state and is not
  a replacement Medusa service.
- The workerd proof asserts Store Product Types list, retrieve,
  publishable-key middleware, locale middleware, unauthenticated store auth
  context, query pagination metadata, and not-found error behavior.

Affected boundary:

- Static HTTP proof fixture state.
- Store Product Types unchanged route execution through Fetch/workerd.

Validation:

```bash
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare test:cart-do-sqlite
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:runtime-source-imports
yarn workspace medusa-cloudflare test
yarn workspace medusa-cloudflare check:portable-entrypoints
yarn workspace medusa-cloudflare check:real-module-imports
git diff --check
```

Result: passed. The workerd proof now includes `GET /store/product-types`,
`GET /store/product-types/:id`, and the missing product type 404 path.

Next step:

- Continue read-heavy catalog route proof coverage only where the fixture
  state stays narrow; otherwise pivot back to adapter/runtime gaps.

## Fetch Request Protocol Compatibility

Implementation commit:

- This commit.

The Fetch HTTP adapter now provides `req.protocol` on the Express-compatible
request shim.

Differences from original Medusa:

- Original Medusa receives `req.protocol` from Express.
- This fork executes unchanged handlers through the Fetch adapter, so the
  adapter must supply the same request field where existing Medusa handlers
  read it.
- Static manifest auth routes such as `/auth/:actor_type/:auth_provider` and
  `/auth/:actor_type/:auth_provider/register` build auth provider input with
  `req.protocol`.
- `FetchHttpAdapter` now derives `req.protocol` from the Fetch request URL
  scheme without the trailing colon.

Affected boundary:

- Fetch adapter Express-compatible request shim.
- Static auth route compatibility.

Validation:

```bash
node_modules\.bin\jest packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts --runInBand --forceExit
yarn workspace @medusajs/framework build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:runtime-source-imports
yarn workspace medusa-cloudflare check:portable-entrypoints
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare check:real-module-imports
yarn workspace medusa-cloudflare test
yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The focused Fetch adapter test now asserts `req.protocol`,
`req.url`, and `req.originalUrl` behavior from a Fetch request URL.
An initial parallel app test plus HTTP proof manifest check failed while the
manifest check rebuilt framework `dist`; rerunning the app test after the
build completed passed.

Next step:

- Continue adapter gap work from unchanged handler pressure, especially fields
  used by manifest-included routes and middleware.

## Fetch Raw Body Preservation

Implementation commit:

- This commit.

The Fetch HTTP adapter now honors static body parser routes configured with
`preserveRawBody` for JSON requests.

Differences from original Medusa:

- Original Medusa relies on Express JSON parser `verify` support to attach a
  raw `Buffer` to `req.rawBody` when a route config sets
  `bodyParser.preserveRawBody`.
- This fork executes unchanged handlers through the Fetch adapter, so the
  adapter must preserve the request bytes before parsing JSON.
- The payment webhook route at `/hooks/payment/:provider` reads
  `req.rawBody` and forwards it to the payment module event payload.
- `FetchHttpAdapter` now attaches a `Uint8Array` raw body and still parses
  `req.body` when a matching body parser config sets `preserveRawBody: true`.
  This avoids importing Node `Buffer` into the Worker runtime.

Affected boundary:

- Fetch adapter JSON body parsing.
- Static body parser route compatibility.
- Payment webhook handler compatibility.

Validation:

```bash
node_modules\.bin\jest packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts --runInBand --forceExit
yarn workspace @medusajs/framework build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:runtime-source-imports
yarn workspace medusa-cloudflare check:portable-entrypoints
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare check:real-module-imports
yarn workspace medusa-cloudflare test
yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The focused Fetch adapter test now asserts that a JSON request
with `preserveRawBody` keeps the parsed body and exposes the original raw bytes
without adding Node `Buffer` to the Worker import graph.

Next step:

- Continue adapter gap work from unchanged handler pressure. Remaining likely
  candidates include request metadata and response helpers used by routes that
  are not yet exercised through the Fetch adapter.

## Fetch Numeric Status Response Compatibility

Implementation commit:

- This commit.

The Fetch HTTP adapter now treats numeric `res.send(status)` and
`res.sendStatus(status)` like Express status responses.

Differences from original Medusa:

- Original Medusa runs on Express 4, where `res.send(200)` sets status `200`
  and sends the status message body `OK`.
- This fork previously serialized numeric `res.send(200)` through the generic
  Fetch body path, producing body `200`.
- The unchanged Admin Index sync route calls `res.send(200)`, so the Fetch
  adapter now maps numeric send values to HTTP status text responses.
- `res.sendStatus(201)` now returns `Created`, matching Express status-message
  behavior.

Affected boundary:

- Fetch adapter Express-compatible response shim.
- Admin Index sync route compatibility.
- Worker HTTP proof assertions for `/admin/index/sync`.

Validation:

```bash
node_modules\.bin\jest packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts --runInBand --forceExit
yarn workspace @medusajs/framework build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:runtime-source-imports
yarn workspace medusa-cloudflare check:portable-entrypoints
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare check:real-module-imports
yarn workspace medusa-cloudflare test
yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The app Worker test and the workerd proof script now assert
the Express-compatible `OK` body from the unchanged `res.send(200)` Admin Index
sync route.

Next step:

- Continue adapter gap work from unchanged handler pressure. Avoid expanding
  route proof count unless it exposes a concrete runtime mismatch.

## Payment Webhook Raw Body Workerd Proof

Implementation commit:

- This commit.

The unchanged Medusa payment webhook route now runs through the static HTTP
manifest and Fetch adapter inside workerd.

Differences from original Medusa:

- Original Medusa discovers `/hooks/payment/:provider` from the filesystem and
  runs it through Express with `bodyParser.preserveRawBody`.
- This fork adds the hook route and `hooksRoutesMiddlewares` to the generated
  HTTP proof manifest so the same route executes through static manifest
  registration.
- The static proof container now registers a minimal `Modules.PAYMENT` options
  service and captures `Modules.EVENT_BUS.emit` calls for assertion.
- The proof serializes Worker `Uint8Array` raw bodies to a JSON-safe proof
  shape with `type`, `length`, and `text`.
- The Worker-safe `@medusajs/framework/utils` shim now re-exports
  `PaymentWebhookEvents`, which the unchanged route imports.
- The webhook route catch block now narrows caught `unknown` errors before
  reading `.message`, preserving TypeScript strictness when the route is pulled
  into the Worker graph.

Affected boundary:

- Generated Medusa HTTP proof manifest.
- Fetch adapter raw-body behavior through an unchanged real route.
- Worker-safe framework utils shim.
- Static proof request scope and app/workerd assertions.

Validation:

```bash
yarn workspace medusa-cloudflare test -- --testNamePattern "payment webhook"
yarn workspace @medusajs/framework build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:runtime-source-imports
yarn workspace medusa-cloudflare check:portable-entrypoints
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare check:real-module-imports
yarn workspace medusa-cloudflare test
yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The workerd proof now asserts the unchanged
`POST /hooks/payment/:provider` route emits `payment.webhook_received` with
the provider param, parsed JSON body, raw JSON text, request headers, and
Medusa's default webhook delay/retry options.

Next step:

- Continue adapter/runtime compatibility from real route pressure. The next
  useful candidates are request/response helpers found by importing additional
  unchanged route groups, not app-local replacement logic.

## Medusa Fetch HTTP Handler Factory

Implementation commit:

- This commit.

The Medusa package now owns a small Fetch HTTP handler factory for static
manifest composition.

Differences from original Medusa:

- Original Medusa assembles HTTP routes through Express and runtime filesystem
  discovery.
- This fork now exposes `createMedusaFetchHttpHandler` from
  `@medusajs/medusa/static/fetch-http-handler`.
- The factory always includes the generated Medusa static HTTP manifest and
  delegates to the shared framework Fetch adapter.
- Cloudflare-specific proof manifests and proof resources remain supplied by
  the Cloudflare app as `additionalManifests`, setup handlers, request-scope
  hooks, and resource sets.
- `apps/medusa-cloudflare` no longer directly imports the generic Fetch static
  handler factory or the primary Medusa HTTP manifest for its proof runtime
  composition.

Affected boundary:

- Medusa static HTTP runtime composition.
- Cloudflare app HTTP proof composition root.
- Package exports and Worker build/import aliases.

Validation:

```bash
yarn workspace @medusajs/medusa build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:runtime-source-imports
yarn workspace medusa-cloudflare check:portable-entrypoints
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare check:real-module-imports
yarn workspace medusa-cloudflare test
yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The app still supplies Cloudflare/proof bindings, but Medusa
now owns the first reusable Fetch HTTP runtime assembly point for static
manifest routes.

Next step:

- Continue moving runtime-neutral HTTP assembly into Medusa-owned package
  entrypoints only when it removes app-owned glue. Keep proof state and
  Cloudflare bindings in the app until the production runtime boundary is
  clear.

## Medusa Fetch Runtime Options Contract

Implementation commit:

- `a4326fa500 Formalize Medusa Fetch runtime options`

The Medusa package now exposes an explicit Fetch runtime options contract for
static HTTP composition.

Differences from original Medusa:

- Original Medusa does not expose a Fetch runtime composition contract because
  Express plus filesystem discovery owns HTTP assembly.
- This fork now names `MedusaFetchHttpRuntimeOptions` and
  `MedusaFetchHttpAdditionalManifestInput` from
  `@medusajs/medusa/static/fetch-http-handler`.
- `createMedusaFetchHttpHandler` consumes that Medusa-owned runtime options
  contract and still injects the generated Medusa static HTTP manifest.
- `apps/medusa-cloudflare` defines its proof runtime options with
  `satisfies MedusaFetchHttpRuntimeOptions`, preserving narrow app inference
  while checking the package-owned boundary.
- No proof state, Cloudflare binding, or deployment registry logic moved into
  Medusa in this slice.

Affected boundary:

- Medusa static Fetch HTTP runtime contract.
- Cloudflare app proof runtime composition.

Validation:

```bash
yarn workspace @medusajs/medusa build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:runtime-source-imports
yarn workspace medusa-cloudflare check:portable-entrypoints
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare check:real-module-imports
yarn workspace medusa-cloudflare test
yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The app-side runtime configuration is now checked against a
Medusa-owned package contract without changing route behavior or expanding the
app-owned proof runtime.

Next step:

- Use the Medusa-owned Fetch runtime boundary as the stable composition point
  for the next real runtime gap. Do not move tenant registries, proof stores,
  or Cloudflare deployment concerns into the package until a real storage or
  bootstrap boundary requires it.

## Medusa Fetch Runtime Definition Helper

Implementation commit:

- `1cb22e4a9c Define Medusa Fetch runtime options`

The Medusa package now exposes a small definition helper and named hook aliases
for static Fetch runtime composition.

Differences from original Medusa:

- Original Medusa does not need a Fetch runtime definition helper because
  Express registration and runtime filesystem discovery own HTTP assembly.
- This fork now exposes `defineMedusaFetchHttpRuntime(...)` from
  `@medusajs/medusa/static/fetch-http-handler`.
- The helper validates an options object against
  `MedusaFetchHttpRuntimeOptions` while preserving the object's inferred type
  for app-local proof hooks.
- The package also names the Fetch runtime hook surface as
  `MedusaFetchHttpRuntimeHooks`, `MedusaFetchHttpCreateRequestScope`,
  `MedusaFetchHttpPrepareRequest`, `MedusaFetchHttpHandleSetupRequest`, and
  `MedusaFetchHttpIsSetupPath`.
- `apps/medusa-cloudflare` now defines its proof runtime through the Medusa
  helper instead of shaping raw framework handler options directly.
- Proof resources, Cloudflare bindings, tenant routing, and deployment
  registries remain app-owned.

Affected boundary:

- Medusa static Fetch HTTP runtime definition API.
- Cloudflare app proof runtime composition.

Validation:

```bash
yarn workspace @medusajs/medusa build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:runtime-source-imports
yarn workspace medusa-cloudflare check:portable-entrypoints
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare check:real-module-imports
yarn workspace medusa-cloudflare test
yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The Cloudflare app still owns proof state and bindings, but
the static Fetch runtime option object is now declared through a Medusa-owned
definition API.

Next step:

- Continue using real unchanged route pressure to find the next Fetch adapter
  or request-scope gap. Avoid moving more proof state into Medusa until the
  shared bootstrap can construct real module request scopes.

## Auth Login And Register HTTP Workerd Proof

Implementation commit:

- `7d6e50445d Prove Auth routes through Fetch adapter`

The unchanged Auth login and register route handlers now execute through the
static HTTP manifest and Fetch adapter inside the Cloudflare proof runtime.

Differences from original Medusa:

- Original Medusa executes `POST /auth/:actor_type/:auth_provider` and
  `POST /auth/:actor_type/:auth_provider/register` through Express and
  filesystem-discovered route registration.
- Earlier Cloudflare proof code intercepted these two paths in
  `handleSetupRequest` and returned app-owned proof responses.
- This slice removes those two setup-path intercepts so the real Medusa route
  handlers, auth middleware, request params, parsed JSON body, protocol field,
  auth module service, config module, and JWT helper execute through the Fetch
  adapter.
- The proof app still owns the minimal auth service fixture and Worker-safe
  JWT utility shim. Session, token refresh, update, and reset-password remain
  proof/setup-owned until their cookie/session/workflow requirements are moved
  behind shared runtime contracts.

Affected boundary:

- Fetch adapter execution of dynamic Auth routes.
- Static proof setup path ownership.
- Worker-safe auth/JWT import graph.

Validation:

```bash
yarn workspace medusa-cloudflare test -- --testNamePattern "Auth login and register"
yarn workspace @medusajs/medusa build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:runtime-source-imports
yarn workspace medusa-cloudflare check:portable-entrypoints
yarn workspace medusa-cloudflare check:real-module-imports
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare test
yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The app and workerd proofs now assert that register and login
return Worker-safe JWT payloads from the real handlers and do not include the
proof setup response header.

Next step:

- Continue route-pressure work only where removing proof setup interception
  proves a real runtime boundary. The remaining Auth setup routes need
  cookie/session or workflow support before they should move to real handlers.

## Fetch Session Hooks And Auth Session Workerd Proof

Implementation commit:

- `69921ef7b2 Add Fetch session hooks for Auth session route`

The Fetch adapter now exposes session lifecycle hooks, and the unchanged Auth
session route executes through the static HTTP manifest inside the Cloudflare
proof runtime.

Differences from original Medusa:

- Original Medusa relies on Express session middleware to attach `req.session`
  and persist cookie-backed auth context.
- This fork adds Fetch adapter hooks for `createSession` and `commitSession`
  so runtimes can attach and persist a Medusa-compatible session object without
  importing Express.
- Auth middleware can now consume an upstream runtime-authenticated
  `AuthContext` before falling back to session or JWT verification. This lets a
  Worker runtime validate bearer input at the boundary and still run unchanged
  Medusa auth middleware and handlers.
- `POST /auth/session` is now included in the generated Medusa static HTTP
  manifest, instead of being handled by proof setup code.
- The Cloudflare proof app supplies a minimal in-memory `connect.sid` session
  hook only for the proof runtime. The real production storage decision remains
  outside `@medusajs/medusa`.
- `DELETE /auth/session` now executes the unchanged handler and commits the
  session destroy result through the Fetch hook.

Affected boundary:

- Fetch adapter request/session lifecycle.
- Medusa static Fetch runtime hook contract.
- Auth middleware context resolution.
- Generated Medusa static HTTP manifest.
- Cloudflare proof runtime session fixture.

Validation:

```bash
node_modules/.bin/jest packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts --runInBand --forceExit
yarn workspace @medusajs/framework build
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace @medusajs/medusa build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:runtime-source-imports
yarn workspace medusa-cloudflare check:portable-entrypoints
yarn workspace medusa-cloudflare check:real-module-imports
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare test
yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The app and workerd proofs now assert real
`POST /auth/session` and `DELETE /auth/session` execution with cookie commit
and destroy behavior, and no proof setup response header.

Next step:

- Continue using unchanged route pressure to identify the next concrete Fetch
  adapter/runtime gap. Auth token refresh and update can move next if their
  session/JWT requirements are covered by the shared hooks; reset-password
  should wait until the workflow dependency is useful to prove.

## Auth Token Refresh HTTP Workerd Proof

Implementation commit:

- `4538e68cbc Prove Auth token refresh through Fetch adapter`

The unchanged Auth token refresh route now executes through the generated
Medusa static HTTP manifest inside the Cloudflare proof runtime.

Differences from original Medusa:

- Original Medusa registers `POST /auth/token/refresh` through Express and
  filesystem-discovered route registration.
- Earlier Cloudflare proof code intercepted `/auth/token/refresh` in
  `handleSetupRequest` and returned an app-owned proof response.
- This fork now includes `packages/medusa/src/api/auth/token/refresh/route.ts`
  in the package-owned generated static HTTP manifest.
- The proof app no longer owns a token-refresh setup response. The unchanged
  route resolves the Auth module service, retrieves the AuthIdentity, resolves
  config, and calls Medusa's JWT helper.
- The proof runtime still pre-attaches an upstream AuthContext for bearer
  requests so the Worker path avoids the Node-only `jsonwebtoken` verifier in
  middleware. A production JWT verifier remains a separate runtime boundary.

Affected boundary:

- Generated Medusa static HTTP manifest.
- Static proof setup path ownership.
- Auth middleware upstream context path.
- Worker-safe Auth service fixture used by unchanged route handlers.

Validation:

```bash
yarn workspace medusa-cloudflare test -- --testNamePattern "Auth login, register, token refresh, and update"
yarn workspace @medusajs/medusa generate:static-http-manifest
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace @medusajs/medusa build
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:runtime-source-imports
yarn workspace medusa-cloudflare check:portable-entrypoints
yarn workspace medusa-cloudflare check:real-module-imports
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare test
yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The app and workerd proofs now assert real
`POST /auth/token/refresh` execution with no proof setup response header.
The refreshed token follows the unchanged Medusa route contract, including
empty `user_metadata` when the route calls the JWT helper without an
`authProvider`.

Next step:

- Treat Auth update as a separate slice because it uses `validateToken()` and
  `getAuthContextFromJwtToken` directly, not the generic Auth middleware's
  upstream context path. That should be solved as an adapter-safe token
  validation boundary instead of hidden inside proof setup.

## Auth Update Token Validation Workerd Proof

Implementation commit:

- `74b7cccce6 Prove Auth update through validated token payloads`

The unchanged Auth provider update route now executes through the generated
Medusa static HTTP manifest inside the Cloudflare proof runtime.

Differences from original Medusa:

- Original Medusa validates Auth provider update tokens by calling
  `getAuthContextFromJwtToken` directly from `validateToken()`, which expects
  the Node `jsonwebtoken` verifier.
- This fork adds a request-context slot for a pre-validated token payload:
  `setMedusaRequestValidatedTokenPayload` and
  `getMedusaRequestValidatedTokenPayload`.
- `validateToken()` now prefers that pre-validated payload and keeps the
  original Node JWT verification path as the fallback.
- The Cloudflare proof runtime verifies the update token with its Worker-safe
  proof verifier during `prepareRequest`, narrows the payload, and attaches the
  validated token payload before Medusa middleware executes.
- The proof setup no longer intercepts
  `POST /auth/:actor_type/:auth_provider/update`; the unchanged route and
  middleware now update the Auth provider state through the static Auth module
  service fixture.

Affected boundary:

- Shared HTTP request context.
- Medusa Auth provider update token middleware.
- Cloudflare proof request preparation.
- Static proof setup path ownership.

Validation:

```bash
node_modules/.bin/jest packages/core/framework/src/http/__tests__/request-context.spec.ts --runInBand --forceExit
yarn workspace medusa-cloudflare test -- --testNamePattern "Auth login, register, and token refresh"
yarn workspace @medusajs/framework build
yarn workspace @medusajs/medusa build
yarn workspace @medusajs/medusa check:static-http-manifest
yarn workspace medusa-cloudflare typecheck
yarn workspace medusa-cloudflare check:imports
yarn workspace medusa-cloudflare check:runtime-source-imports
yarn workspace medusa-cloudflare check:portable-entrypoints
yarn workspace medusa-cloudflare check:real-module-imports
yarn workspace medusa-cloudflare check:http-proof-manifest
yarn workspace medusa-cloudflare test
yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The app and workerd proofs now assert real
`POST /auth/:actor_type/:auth_provider/update` execution with no proof setup
response header, followed by a successful login using the updated password.

Next step:

- Reset-password was completed later in `ce01178067` as the workflow-backed
  Auth route pressure slice. Do not repeat that work; continue from the latest
  Workflow Engine and HTTP runtime records when choosing the next boundary.

## Lazy Medusa Static Fetch Handler Helper

Implementation commit:

- `c01cbea4c1 Add lazy Medusa Fetch HTTP handler`

The Medusa static Fetch runtime boundary now owns the lazy handler wrapper used
by Worker composition roots.

Differences from original Medusa:

- Original Medusa does not have a Fetch/static HTTP runtime composition helper;
  Express bootstrap owns route registration and request handling.
- Earlier Cloudflare proof code owned a local singleton
  `FetchHttpStaticHandler` wrapper in `apps/medusa-cloudflare`.
- This fork adds `createLazyMedusaFetchHttpHandler(...)` to
  `@medusajs/medusa/static/fetch-http-handler`, alongside the existing
  `defineMedusaFetchHttpRuntime(...)` and `createMedusaFetchHttpHandler(...)`
  helpers.
- The Cloudflare proof app now defines runtime hooks and manifests, then uses
  the Medusa-owned lazy wrapper for `handle`, `tryHandle`, and
  `isPathHandled`.
- The helper remains runtime-neutral; it does not know about Cloudflare
  bindings, tenants, proof resources, Durable Objects, D1, or deployment
  registries.

Affected boundary:

- Medusa static Fetch HTTP runtime helper.
- Cloudflare proof HTTP composition root.

Validation:

```bash
node_modules\.bin\jest packages/medusa/src/static/__tests__/fetch-http-handler.spec.ts --config packages/medusa/jest.config.js --runInBand --forceExit
cmd /c yarn workspace @medusajs/framework build
cmd /c yarn workspace @medusajs/medusa build
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare check:http-proof-manifest
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Auth login, register"
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed.

Next step:

- Continue reducing app-owned HTTP bootstrap only where the extraction is a
  runtime-neutral Medusa helper or where unchanged route pressure exposes a
  concrete Fetch adapter/request-scope gap.

## Admin Workflow Execution Read Routes Fetch Proof

Implementation commit:

- `ec9d2c37d9 Move workflow execution reads to Fetch manifest`

The unchanged Admin workflow execution read routes now execute through the
generated Medusa static HTTP manifest inside the Cloudflare proof runtime.

Differences from original Medusa:

- Original Medusa discovers and registers these Admin routes through the Node
  filesystem and Express bootstrap.
- This fork lists the three read handlers in the package-owned static HTTP
  manifest:
  `GET /admin/workflows-executions`,
  `GET /admin/workflows-executions/:id`, and
  `GET /admin/workflows-executions/:workflow_id/:transaction_id`.
- The app-owned proof setup no longer intercepts those read routes. It still
  owns the workflow execution mutation setup endpoints until the Workflow
  Engine runtime boundary is ready for those writes.
- The Cloudflare proof runtime supplies `REMOTE_QUERY` rows for
  `workflow_execution`, so the existing Medusa handlers, query middleware, and
  response contracts remain the code path under test.

Affected boundary:

- Medusa static HTTP manifest.
- Cloudflare proof setup path ownership.
- Workflow execution remote-query proof fixture.
- Worker and workerd Fetch route validation.

Validation:

```bash
cmd /c yarn workspace @medusajs/medusa generate:static-http-manifest
cmd /c yarn workspace @medusajs/medusa check:static-http-manifest
cmd /c yarn workspace medusa-cloudflare check:http-proof-manifest
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "workflow execution"
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: passed. The app and workerd proofs now assert that the three Admin
workflow execution read routes return data through the real Fetch/static
Medusa route path with no `x-medusa-http-proof` setup response header.

Next step:

- Continue with Workflow Engine mutation route pressure only after deciding the
  Worker-safe write/execution boundary. Do not move workflow execution writes
  by hiding them behind more proof-only glue.

## Admin Workflow Execution Run Route Fetch Proof

Implementation commit:

- `c37f2cb984 Move workflow execution run to Fetch manifest`

The unchanged Admin workflow execution run route now executes through the
generated Medusa static HTTP manifest inside the Cloudflare proof runtime.

Differences from original Medusa:

- Original Medusa discovers and registers
  `POST /admin/workflows-executions/:workflow_id/run` through the Node
  filesystem and Express bootstrap.
- This fork lists the run handler in the package-owned static HTTP manifest.
- The app-owned proof setup no longer intercepts the run route.
- The proof runtime now satisfies the existing route by registering a
  Worker-safe `IWorkflowEngineService.run(...)` implementation for proof
  workflow ids. That service method creates the same workflow execution rows
  consumed by the already-real read routes and returns the Medusa
  `acknowledgement` shape expected by the unchanged handler.
- `steps/success` and `steps/failure` remain app-owned setup routes until the
  proof Workflow Engine service supports `setStepSuccess` and
  `setStepFailure`.

Affected boundary:

- Medusa static HTTP manifest.
- Cloudflare proof setup path ownership.
- Worker-safe proof `IWorkflowEngineService.run(...)` contract.
- Worker and workerd Fetch route validation.

Validation:

```bash
cmd /c yarn workspace @medusajs/medusa generate:static-http-manifest
cmd /c yarn workspace @medusajs/medusa check:static-http-manifest
cmd /c yarn workspace medusa-cloudflare check:http-proof-manifest
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "workflow execution"
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: passed. The app and workerd proofs now assert that the Admin workflow
execution run route returns the real handler acknowledgement through the Fetch
adapter with no `x-medusa-http-proof` setup response header, and that the
created execution is readable through the real list/retrieve routes.

Next step:

- Add `setStepSuccess` support to the Worker-safe proof Workflow Engine
  service, then move only
  `POST /admin/workflows-executions/:workflow_id/steps/success`.

## Admin Workflow Execution Step Success Route Fetch Proof

Implementation commit:

- `16018e93c9 Move workflow step success to Fetch manifest`

The unchanged Admin workflow execution step-success route now executes through
the generated Medusa static HTTP manifest inside the Cloudflare proof runtime.

Differences from original Medusa:

- Original Medusa discovers and registers
  `POST /admin/workflows-executions/:workflow_id/steps/success` through the
  Node filesystem and Express bootstrap.
- This fork lists the success handler in the package-owned static HTTP
  manifest.
- The app-owned proof setup no longer intercepts the success route.
- The proof runtime now satisfies the existing route by registering
  `IWorkflowEngineService.setStepSuccess(...)` on the Worker-safe proof
  Workflow Engine service.
- The proof service reads the real handler's idempotency key parts and
  `StepResponse` payload, marks the stored workflow execution as `done`, clears
  waiting-step state, and records the step output and compensation input in the
  execution context that the real read routes return.
- `steps/failure` remains app-owned setup until `setStepFailure(...)` is
  supported separately.

Affected boundary:

- Medusa static HTTP manifest.
- Cloudflare proof setup path ownership.
- Worker-safe proof `IWorkflowEngineService.setStepSuccess(...)` contract.
- Worker and workerd Fetch route validation.

Validation:

```bash
cmd /c yarn workspace @medusajs/medusa generate:static-http-manifest
cmd /c yarn workspace @medusajs/medusa check:static-http-manifest
cmd /c yarn workspace medusa-cloudflare check:http-proof-manifest
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "workflow execution"
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: passed. The app and workerd proofs now assert that the Admin workflow
execution step-success route returns `{ success: true }` through the Fetch
adapter with no `x-medusa-http-proof` setup response header, and that the
execution is then readable as `done` through the real retrieve route.

Next step:

- Add `setStepFailure(...)` support to the Worker-safe proof Workflow Engine
  service, then move
  `POST /admin/workflows-executions/:workflow_id/steps/failure`.

## Admin Workflow Execution Step Failure Route Fetch Proof

Implementation commit:

- `c606fe1dfa Move workflow step failure to Fetch manifest`

The unchanged Admin workflow execution step-failure route now executes through
the generated Medusa static HTTP manifest inside the Cloudflare proof runtime.

Differences from original Medusa:

- Original Medusa discovers and registers
  `POST /admin/workflows-executions/:workflow_id/steps/failure` through the
  Node filesystem and Express bootstrap.
- This fork lists the failure handler in the package-owned static HTTP
  manifest.
- The app-owned proof setup no longer intercepts the failure route.
- The proof runtime now satisfies the existing route by registering
  `IWorkflowEngineService.setStepFailure(...)` on the Worker-safe proof
  Workflow Engine service.
- The proof service reads the real handler's idempotency key parts and
  `StepResponse` payload, marks the stored workflow execution as `reverted`,
  sets failed/reverted flags, clears waiting-step state, and records the step
  output and compensation input in the execution context that the real read
  routes return.

Affected boundary:

- Medusa static HTTP manifest.
- Cloudflare proof setup path ownership.
- Worker-safe proof `IWorkflowEngineService.setStepFailure(...)` contract.
- Worker and workerd Fetch route validation.

Validation:

```bash
cmd /c yarn workspace @medusajs/medusa generate:static-http-manifest
cmd /c yarn workspace @medusajs/medusa check:static-http-manifest
cmd /c yarn workspace medusa-cloudflare check:http-proof-manifest
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "workflow execution"
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: passed. The app and workerd proofs now assert that the Admin workflow
execution step-failure route returns `{ success: true }` through the Fetch
adapter with no `x-medusa-http-proof` setup response header, and that the
execution is then readable as `reverted` through the real retrieve route.

Next step:

- The Admin workflow execution read, run, step-success, and step-failure
  routes are now package-owned static manifest routes. Continue with the next
  HTTP/runtime boundary only where it exposes a real adapter gap; do not add
  more app-owned proof HTTP behavior for this route group.

## Admin Users Read Routes Fetch Proof

Implementation commit:

- `e921934cbe Move Admin Users reads to Fetch manifest`

The unchanged Admin Users read routes now execute through the generated Medusa
static HTTP manifest inside the Cloudflare proof runtime.

Differences from original Medusa:

- Original Medusa discovers and registers `GET /admin/users` and
  `GET /admin/users/me` through the Node filesystem and Express bootstrap.
- This fork lists the two read handlers and the Admin Users middleware file in
  the package-owned static HTTP manifest.
- The app-owned proof setup no longer intercepts those two read routes. It
  still owns the remaining Admin Users mutation, retrieve-by-id, and role proof
  paths until those are moved separately.
- The proof runtime now supplies `REMOTE_QUERY` rows for the `user` entry
  point, so the existing Medusa handlers, query middleware, auth context, and
  response contracts remain the code path under test.
- The proof request preparation now creates a deterministic static user for the
  authenticated admin actor when needed, allowing `/admin/users/me` to resolve
  through `req.auth_context.actor_id`.
- The Admin Users middleware import was changed from the broad
  `@medusajs/framework` barrel to `@medusajs/framework/http`, matching other
  portable middleware files and keeping Node/MikroORM code out of the Worker
  bundle graph.

Affected boundary:

- Medusa static HTTP manifest.
- Admin Users middleware import boundary.
- Cloudflare proof setup path ownership.
- User remote-query proof fixture.
- Worker and workerd Fetch route validation.

Validation:

```bash
cmd /c yarn workspace @medusajs/medusa generate:static-http-manifest
cmd /c yarn workspace @medusajs/medusa check:static-http-manifest
cmd /c yarn workspace medusa-cloudflare check:http-proof-manifest
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: passed. The app and workerd proofs now assert that `GET
/admin/users/me` and `GET /admin/users` return data through the real
Fetch/static Medusa route path with no `x-medusa-http-proof` setup response
header.

Next step:

- Continue with the next small Admin Users route only if it exposes a real
  adapter boundary. A likely candidate is `GET /admin/users/:id`, followed by
  mutations/roles separately.

## Admin Users Retrieve Route Fetch Proof

Implementation commit:

- `84d9e35197 Move Admin Users retrieve to Fetch manifest`

The unchanged Admin Users retrieve-by-id behavior now executes through the
generated Medusa static HTTP manifest inside the Cloudflare proof runtime.

Differences from original Medusa:

- Original Medusa discovers and registers `GET /admin/users/:id` from
  `packages/medusa/src/api/admin/users/[id]/route.ts` through the Node
  filesystem and Express bootstrap.
- That original route file also owns `POST` and `DELETE`, which import
  mutation workflows from `@medusajs/core-flows`.
- This fork keeps the normal `route.ts` as the Node/Express route module, but
  splits the retrieve handler into
  `packages/medusa/src/api/admin/users/[id]/get-route.ts`.
- The package-owned static manifest points `/admin/users/:id` at the GET-only
  helper with an explicit route path. This keeps mutation-only core-flows and
  their Node/MikroORM edges physically out of the Worker import graph while
  preserving the same handler logic and response contract.
- The app-owned proof setup no longer intercepts `GET /admin/users/:id`. It
  still owns Admin Users update/delete and role proof paths until those are
  moved separately.
- The existing `REMOTE_QUERY` user fixture now satisfies list, current-user,
  and retrieve-by-id through the same package-owned route path.

Affected boundary:

- Medusa static HTTP manifest.
- Admin Users route-file method split for Worker-safe static bootstrap.
- Cloudflare proof setup path ownership.
- User remote-query proof fixture.
- Worker and workerd Fetch route validation.

Validation:

```bash
cmd /c yarn workspace @medusajs/medusa generate:static-http-manifest
cmd /c yarn workspace @medusajs/medusa check:static-http-manifest
cmd /c yarn workspace medusa-cloudflare check:http-proof-manifest
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: passed. The app and workerd proofs now assert that `GET
/admin/users/me`, `GET /admin/users`, and `GET /admin/users/:id` return data
through the real Fetch/static Medusa route path with no `x-medusa-http-proof`
setup response header.

Next step:

- Keep Admin Users mutations and roles separate. The next route should be moved
  only when its workflow/RBAC boundary can be made Worker-safe without
  reimplementing Medusa behavior in the Cloudflare app.

## Admin Users Roles Read Route Fetch Proof

Implementation commit:

- `357f927abe Move Admin Users roles read to Fetch manifest`

The unchanged Admin Users role-list behavior now executes through the generated
Medusa static HTTP manifest inside the Cloudflare proof runtime.

Differences from original Medusa:

- Original Medusa discovers and registers `GET /admin/users/:id/roles` from
  `packages/medusa/src/api/admin/users/[id]/roles/route.ts` through the Node
  filesystem and Express bootstrap.
- That original route file also owns role assignment/removal mutations, which
  import `assignUserRolesWorkflow` and `removeUserRolesWorkflow` from
  `@medusajs/core-flows`.
- This fork keeps the normal roles `route.ts` as the Node/Express route module,
  but splits the role-list handler into
  `packages/medusa/src/api/admin/users/[id]/roles/get-route.ts`.
- The package-owned static manifest points `/admin/users/:id/roles` at the
  GET-only helper with an explicit route path. This keeps mutation-only role
  workflows and their Node/MikroORM edges out of the Worker import graph while
  preserving the same handler logic and response contract.
- The proof `QUERY.graph` service now supports the `user_rbac_role` entity
  used by the real handler and returns rows with nested `rbac_role` data from
  the existing static RBAC fixtures.
- The app-owned proof setup no longer intercepts `GET /admin/users/:id/roles`.
  It still owns Admin Users role assignment/removal paths until those are moved
  separately.

Affected boundary:

- Medusa static HTTP manifest.
- Admin Users roles route-file method split for Worker-safe static bootstrap.
- Cloudflare proof setup path ownership.
- Static `QUERY.graph` proof fixture for `user_rbac_role`.
- Worker and workerd Fetch route validation.

Validation:

```bash
cmd /c yarn workspace @medusajs/medusa generate:static-http-manifest
cmd /c yarn workspace @medusajs/medusa check:static-http-manifest
cmd /c yarn workspace medusa-cloudflare check:http-proof-manifest
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: passed. The app and workerd proofs now assert that current-user, list,
retrieve-by-id, and role-list Admin Users GET routes return data through the
real Fetch/static Medusa route path with no `x-medusa-http-proof` setup
response header.

Next step:

- Keep Admin Users role assignment/removal and user update/delete mutations
  separate. Move them only after their workflow/RBAC dependencies can run in
  the Worker graph without app-side reimplementation.

## Admin Users Role Assignment Route Fetch Proof

Implementation commit:

- This commit.

The unchanged Admin Users role-assignment behavior now executes through the
generated Medusa static HTTP manifest inside the Cloudflare proof runtime.

Differences from original Medusa:

- Original Medusa discovers and registers `POST /admin/users/:id/roles` from
  `packages/medusa/src/api/admin/users/[id]/roles/route.ts` through the Node
  filesystem and Express bootstrap.
- This fork splits the POST implementation into
  `packages/medusa/src/api/admin/users/[id]/roles/post-route.ts` and lists
  that method-specific helper in the package-owned static HTTP manifest. The
  normal `route.ts` still exports `GET`, `POST`, and `DELETE` for Node/Express.
- The POST helper preserves the real Medusa validation, query, workflow, and
  response contract. It passes `req.scope` through workflow run options instead
  of binding the container during workflow construction, avoiding a Worker proof
  container-copy edge while still running the existing workflow.
- The app-owned proof setup no longer intercepts
  `POST /admin/users/:id/roles`. It still owns role-removal paths until those
  are moved separately.
- The proof runtime now supplies the minimal RBAC module service, link service,
  and `QUERY.graph` fixtures needed by the existing role-assignment workflow.
- The proof request scope now follows the normal Medusa bootstrap shape by
  creating a scoped container per request.

Affected boundary:

- Medusa static HTTP manifest.
- Admin Users roles route-file method split for Worker-safe static bootstrap.
- User role workflow import and workflow-run container boundary.
- Cloudflare proof setup path ownership.
- Static RBAC, link, user, and user-role proof fixtures.
- Worker and workerd Fetch route validation.

Validation:

```bash
cmd /c yarn workspace @medusajs/core-flows build
cmd /c yarn workspace @medusajs/medusa generate:static-http-manifest
cmd /c yarn workspace @medusajs/medusa check:static-http-manifest
cmd /c yarn workspace medusa-cloudflare check:http-proof-manifest
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: passed. The app and workerd proofs now assert that current-user, list,
retrieve-by-id, role-list, and role-assignment Admin Users routes execute
through the real Fetch/static Medusa route path with no
`x-medusa-http-proof` setup response header.

Next step:

- Move Admin Users role removal next, using the same method-specific route
  split and direct workflow subpath import pattern. Do not move user
  update/delete until their separate workflow dependencies are made
  Worker-safe.

## Admin Users Role Removal Routes Fetch Proof

Implementation commit:

- This commit.

The unchanged Admin Users role-removal behavior now executes through the
generated Medusa static HTTP manifest inside the Cloudflare proof runtime.

Differences from original Medusa:

- Original Medusa discovers and registers `DELETE /admin/users/:id/roles` from
  `packages/medusa/src/api/admin/users/[id]/roles/route.ts` and
  `DELETE /admin/users/:id/roles/:role_id` from
  `packages/medusa/src/api/admin/users/[id]/roles/[role_id]/route.ts` through
  the Node filesystem and Express bootstrap.
- This fork splits the collection DELETE implementation into
  `packages/medusa/src/api/admin/users/[id]/roles/delete-route.ts` and the
  per-role DELETE implementation into
  `packages/medusa/src/api/admin/users/[id]/roles/[role_id]/delete-route.ts`.
  The normal route files still re-export those methods for Node/Express.
- Both DELETE helpers preserve the real Medusa validation, workflow, and
  response contracts. They pass `req.scope` through workflow run options so the
  Worker proof runtime executes the existing role-removal workflow without an
  app-owned replacement route.
- The app-owned proof setup no longer intercepts either role-removal path and
  now lets those requests fall through before setup-body parsing.
- The shared remote-link workflow steps now resolve a narrow structural link
  service type and import `LinkDefinition` from `@medusajs/types`, avoiding a
  runtime import of `@medusajs/framework/modules-sdk` from Worker-facing
  workflow paths.

Affected boundary:

- Medusa static HTTP manifest.
- Admin Users roles route-file method split for Worker-safe static bootstrap.
- User role-removal workflow import and workflow-run container boundary.
- Common remote-link workflow step type boundary.
- Cloudflare proof setup path ownership.
- Worker and workerd Fetch route validation.

Validation:

```bash
cmd /c yarn workspace @medusajs/core-flows build
cmd /c yarn workspace @medusajs/medusa generate:static-http-manifest
cmd /c yarn workspace @medusajs/medusa check:static-http-manifest
cmd /c yarn workspace medusa-cloudflare check:http-proof-manifest
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: passed. The app and workerd proofs now assert that current-user, list,
retrieve-by-id, role-list, role-assignment, collection role-removal, and
per-role role-removal Admin Users routes execute through the real Fetch/static
Medusa route path with no `x-medusa-http-proof` setup response header.

Next step:

- Keep Admin Users update and delete separate. Move the update route only after
  its user workflow dependencies are Worker-safe through package-owned
  entrypoints.

## Admin Users Update Route Fetch Proof

Implementation commit:

- `3b4b5af33f Move Admin Users update to Fetch manifest`

The unchanged Admin Users update behavior now executes through the generated
Medusa static HTTP manifest inside the Cloudflare proof runtime.

Differences from original Medusa:

- Original Medusa discovers and registers `POST /admin/users/:id` from
  `packages/medusa/src/api/admin/users/[id]/route.ts` through the Node
  filesystem and Express bootstrap.
- This fork splits the POST implementation into
  `packages/medusa/src/api/admin/users/[id]/post-route.ts` and lists that
  method-specific helper in the package-owned static HTTP manifest. The normal
  `route.ts` still exports `GET`, `POST`, and `DELETE` for Node/Express.
- The POST helper preserves the real Medusa validation, user-update workflow,
  refetch, and response contract. It passes `req.scope` through workflow run
  options so the Worker proof runtime executes the existing workflow without an
  app-owned replacement route.
- The app-owned proof setup no longer intercepts `POST /admin/users/:id`.
  User delete remains app-owned until moved separately.
- The proof runtime now supplies a Worker-safe `Modules.USER` service for the
  existing update workflow and accepts the additional `user.updated` event in
  later event-bus proof assertions.

Affected boundary:

- Medusa static HTTP manifest.
- Admin Users route-file method split for Worker-safe static bootstrap.
- User update workflow import and workflow-run container boundary.
- Cloudflare proof setup path ownership.
- Static user module proof fixture.
- Worker and workerd Fetch route validation.

Validation:

```bash
cmd /c yarn workspace @medusajs/medusa check:static-http-manifest
cmd /c yarn workspace medusa-cloudflare check:http-proof-manifest
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c git diff --check
```

Result: passed. The app and workerd proofs now assert that current-user, list,
retrieve-by-id, role-list, role-assignment, role-removal, and user-update Admin
Users routes execute through the real Fetch/static Medusa route path with no
`x-medusa-http-proof` setup response header.

Note:

- `cmd /c yarn workspace @medusajs/core-flows build` was checked and still
  fails across many pre-existing broad `@medusajs/framework/*` imports in
  untouched workflow files. The touched user update workflow path is validated
  through the Worker typecheck, import guards, focused Admin Users route test,
  and workerd proof.

Next step:

- Move Admin Users delete only after `removeUserAccountWorkflow` and its delete
  dependencies have package-owned portable entrypoints. Keep it separate from
  the update route.

## Admin Users Delete Route Fetch Proof

Implementation commit:

- `71aafe9079 Move Admin Users delete to Fetch manifest`

The unchanged Admin Users delete behavior now executes through the generated
Medusa static HTTP manifest inside the Cloudflare proof runtime.

Differences from original Medusa:

- Original Medusa discovers and registers `DELETE /admin/users/:id` from
  `packages/medusa/src/api/admin/users/[id]/route.ts` through the Node
  filesystem and Express bootstrap.
- This fork splits the DELETE implementation into
  `packages/medusa/src/api/admin/users/[id]/delete-route.ts` and lists that
  method-specific helper in the package-owned static HTTP manifest. The normal
  `route.ts` still exports `GET`, `POST`, and `DELETE` for Node/Express.
- The DELETE helper preserves the real Medusa self-delete guard,
  `removeUserAccountWorkflow`, and response contract. It passes `req.scope`
  through workflow run options so the Worker proof runtime executes the
  existing workflow without an app-owned replacement route.
- The app-owned proof setup no longer intercepts `DELETE /admin/users/:id`.
- The proof runtime now supports the workflow path by adding Worker-safe user
  `softDeleteUsers`/`restoreUsers`, auth `updateAuthIdentities`, link
  `delete`/`restore`, `auth_identity` remote-query rows, and remote-query
  config-input normalization.

Affected boundary:

- Medusa static HTTP manifest.
- Admin Users route-file method split for Worker-safe static bootstrap.
- Remove-user-account workflow import and workflow-run container boundary.
- Cloudflare proof setup path ownership.
- Static user, auth, link, and remote-query proof fixtures.
- Worker and workerd Fetch route validation.

Validation:

```bash
cmd /c yarn workspace @medusajs/medusa generate:static-http-manifest
cmd /c yarn workspace @medusajs/medusa check:static-http-manifest
cmd /c "set NODE_OPTIONS=--max-old-space-size=4096&& yarn workspace medusa-cloudflare check:http-proof-manifest"
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The app and workerd proofs now assert that current-user, list,
retrieve-by-id, role-list, role-assignment, role-removal, user-update, and
user-delete Admin Users routes execute through the real Fetch/static Medusa
route path with no `x-medusa-http-proof` setup response header.

Note:

- `check:http-proof-manifest` passed normally before the final cleanup and
  needed a larger Node heap on rerun in this large worker graph.

Next step:

- The current Admin Users proof surface is package-owned. Continue with the
  next route or runtime helper only when it exposes a real adapter gap; avoid
  adding app-owned replacement route behavior.

## Admin Users List Route Direct Utility Imports

Implementation commit:

- `8206e97f3e Use portable utility imports in admin users list route`

The package-owned `GET /admin/users` route now avoids the broad framework
utility barrel for Worker-facing helper imports.

Differences from original Medusa:

- Original Medusa imports `ContainerRegistrationKeys` and
  `remoteQueryObjectFromString` through `@medusajs/framework/utils` in
  `packages/medusa/src/api/admin/users/route.ts`.
- This fork imports those helpers from direct portable `@medusajs/utils`
  subpaths:
  `@medusajs/utils/common/container` and
  `@medusajs/utils/common/remote-query-object-from-string`.
- Route behavior, request/response contracts, query shape, and static manifest
  ownership are unchanged.

Affected boundary:

- `packages/medusa/src/api/admin/users/route.ts`
- Worker import graph for `GET /admin/users`

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The Cart DO SQLite smoke gate logs expected timeout proof
errors for workflow recovery scenarios while still exiting successfully.

## Bounded Auth Session Production Route Opt-In

Implementation commit:

- This commit (`Prove bounded auth session production route`)

The top-level Worker can now route the real `/auth/session` Medusa route into
the selected Cart DO production HTTP runtime when the request includes the
explicit `x-medusa-partition-key` opt-in header.

Differences from original Medusa:

- Original Medusa runs `/auth/session` through the Node/Express HTTP runtime
  and its Node request scope.
- This fork keeps the unchanged Medusa `/auth/session` route and auth
  middleware, but the Cloudflare production request scope now registers a
  typed `configModule` value required by auth middleware.
- The Cart DO production HTTP runtime now uses Medusa's existing upstream
  auth-context hook to prepare proof auth context from
  `x-medusa-access-token`. This is a Worker-runtime proof hook, not a route
  rewrite or a replacement auth service.
- The route remains bounded and non-default. Without `x-medusa-partition-key`,
  the default Worker still falls back to the static proof HTTP runtime.

Affected boundary:

- `apps/medusa-cloudflare/src/cloudflare-http-request-scope.ts`
- `apps/medusa-cloudflare/src/cart-proof-do.ts`
- `apps/medusa-cloudflare/src/cloudflare-http-production-route-policy.ts`
- Top-level Worker forwarding for `/auth/session` with explicit partition
  selection.

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "auth session routes|HTTP runtime status|bounded default route|empty partition|production HTTP route|tenant partition"
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace @medusajs/medusa build
git diff --check
```

Result: passed. The workerd proof verifies POST and DELETE `/auth/session`
with `x-medusa-partition-key` create and clear DO-backed session state through
the selected Cart DO production HTTP runtime.

## Bounded Auth Session Bearer Proof Preparation

Implementation commit:

- This commit (`Use bearer auth context for production session proof`)

The Cart DO production HTTP runtime no longer prepares auth context from the
custom `x-medusa-access-token` proof header. It now uses a small
Worker-compatible bearer-token auth-context preparer for the bounded
`/auth/session` production route proof.

Differences from original Medusa:

- Original Medusa verifies bearer JWTs through the Node `jsonwebtoken`
  runtime from auth middleware.
- This fork keeps the unchanged Medusa auth middleware and `/auth/session`
  route, but the Cloudflare proof runtime prepares a Medusa `AuthContext` from
  the standard `Authorization: Bearer ...` header before middleware runs.
- The current preparer accepts the proof JWT shape emitted by the Worker
  utility shim. It is not the final cryptographic JWT verifier.
- The previous custom `x-medusa-access-token` proof input is no longer used by
  the bounded production `/auth/session` proof.

Affected boundary:

- `apps/medusa-cloudflare/src/cloudflare-http-auth-context.ts`
- `apps/medusa-cloudflare/src/cart-proof-do.ts`
- Top-level Worker and workerd proof inputs for bounded `/auth/session`
  production routing.

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test src/cloudflare-http-auth-context.spec.ts
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "auth session routes|HTTP runtime status|bounded default route|empty partition|production HTTP route|tenant partition"
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace @medusajs/medusa build
git diff --check
```

Result: passed. The workerd proof verifies POST and DELETE `/auth/session`
with `Authorization: Bearer ...` and `x-medusa-partition-key` create and clear
DO-backed session state through the selected Cart DO production HTTP runtime.

## Shared Bearer Auth Context Preparation Boundary

Implementation commit:

- This commit (`Move bearer auth context preparation into framework HTTP`)

The temporary Cloudflare app-local bearer auth-context parser has been removed.
The production Cart DO HTTP runtime now imports bearer auth-context preparation
from Medusa's shared Fetch HTTP entrypoint.

Differences from original Medusa:

- Original Medusa keeps bearer JWT verification inside auth middleware through
  the Node `jsonwebtoken` runtime.
- This fork adds a shared Fetch HTTP helper:
  `createBearerAuthContextPrepareRequest(...)`.
- The helper accepts an injected bearer-token verifier. Node behavior is
  unchanged, and Cloudflare composition can inject the current proof decoder
  without app-local auth parsing.
- The current Cloudflare proof still uses
  `decodeUnverifiedJwtBearerAuthContext(...)`, which is explicitly not the
  final cryptographic verifier. The final Worker runtime should replace that
  injected function with a WebCrypto verifier.

Affected boundary:

- `packages/core/framework/src/http/utils/bearer-auth-context.ts`
- `packages/core/framework/src/http/fetch.ts`
- `packages/core/framework/src/http/portable.ts`
- `apps/medusa-cloudflare/src/cart-proof-do.ts`

Validation:

```bash
cmd /c .\node_modules\.bin\jest packages/core/framework/src/http/__tests__/bearer-auth-context.spec.ts --runInBand --forceExit
cmd /c yarn workspace @medusajs/framework build
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "auth session routes|HTTP runtime status|bounded default route|empty partition|production HTTP route|tenant partition"
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace @medusajs/medusa build
git diff --check
```

Result: passed. A first broad framework test attempt also ran the new spec
successfully but failed unrelated static HTTP builder assertions because the
package script's existing `--testPathPattern=src` caused unrelated suites to
run.

## Default Worker HTTP Runtime Blocker

Implementation commit:

- This commit (`Record default Worker HTTP runtime blocker`)

Turn 9 evaluated whether the default Worker HTTP handler can move away from
proof runtime options.

Differences from original Medusa:

- Original Medusa owns HTTP runtime creation in the Node server process.
- This fork's default Worker path still uses `staticHttpProofRuntimeOptions`
  for the top-level Fetch HTTP handler.
- The production module-backed HTTP runtime is currently proven inside
  `CartProofDO`, where a Durable Object partition supplies the storage and
  runtime bindings that the top-level Worker lacks.
- Added `GET /medusa-http-runtime/status` to expose the current default mode
  and exact production-runtime blocker as JSON.

Affected boundary:

- `apps/medusa-cloudflare/src/cloudflare-http-runtime.ts`
- `apps/medusa-cloudflare/src/worker.ts`
- Default Worker Fetch HTTP routing before the static proof handler

Current blocker:

- Default Worker production HTTP runtime still needs an explicit commerce
  partition selection boundary before it can construct module-backed runtime
  options.
- The proven production path currently requires:
  - Durable Object SQLite manager for commerce persistence;
  - Durable Object-backed HTTP auth session store;
  - workflow execution, schedule, and delayed-action stores;
  - Cloudflare locking namespace and queue bindings wired into module options;
  - default Worker route for selecting a commerce partition before creating
    HTTP runtime options.

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "HTTP runtime status|Cloudflare Worker runtime"
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace @medusajs/medusa build
git diff --check
```

Result: passed. The Cart DO SQLite smoke gate logs expected timeout proof
errors for workflow recovery scenarios while still exiting successfully.

## Non-Default Production HTTP Partition Route

Implementation commit:

- This commit (`Add production HTTP partition route`)

Turn 10 added an intentional top-level Worker path for the production
module-backed HTTP runtime without changing the default Worker handler.

Differences from original Medusa:

- Original Medusa does not select a Durable Object commerce partition before
  running HTTP routes; the Node server owns one process-local runtime.
- This fork now exposes
  `GET /medusa-http-runtime/partitions/:partition/*` as a non-default Worker
  route that selects a tenant-scoped cart partition and forwards the request to
  that Durable Object.
- `CartProofDO` now has a generic `http/*` branch that delegates to the
  existing production Fetch HTTP handler built from the DO-backed commerce
  module runtime source.
- The route does not reimplement Medusa route handlers, middleware, Remote
  Query, sessions, workflows, locking, or queue behavior. It only composes the
  top-level Worker partition address with the existing module-backed Fetch
  handler in the selected DO.
- The default Worker HTTP handler still uses `staticHttpProofRuntimeOptions`.

Affected boundary:

- `apps/medusa-cloudflare/src/worker.ts`
- `apps/medusa-cloudflare/src/cart-proof-do.ts`
- `apps/medusa-cloudflare/scripts/check-workerd-cart-do-sqlite.mjs`
- Top-level Worker to Durable Object production HTTP routing

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "production HTTP route|HTTP runtime status"
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: passed. The workerd Cart DO gate verified
`GET /medusa-http-runtime/partitions/:partition/store/currencies` returns real
route data from the selected DO-backed production HTTP runtime.

## Production HTTP Partition Routing Helper

Implementation commit:

- This commit (`Extract HTTP partition routing helper`)

The top-level Worker to Durable Object partition forwarding logic is now a
dedicated app-root helper instead of inline `worker.ts` control flow.

Differences from original Medusa:

- Original Medusa does not resolve tenant runtime context or Durable Object
  partition addresses before HTTP execution.
- This fork now has
  `apps/medusa-cloudflare/src/cloudflare-http-partition-routing.ts` as the
  Worker app-root boundary for:
  - parsing `/medusa-http-runtime/partitions/:partition/*`;
  - validating malformed partition route requests before binding checks;
  - resolving tenant runtime headers and environment defaults;
  - deriving the Durable Object partition name;
  - forwarding the rewritten request to the selected partition;
  - adding `x-medusa-partition-name` to the response.
- `worker.ts` now delegates the non-default production HTTP partition route to
  that helper and only supplies the Cart DO binding, partition family, missing
  binding message, and route rewrite function.
- This remains app-root composition. It does not change Medusa route handlers,
  middleware, module services, Query runtime, session stores, workflows,
  locking, queues, or the default proof HTTP handler.

Affected boundary:

- `apps/medusa-cloudflare/src/cloudflare-http-partition-routing.ts`
- `apps/medusa-cloudflare/src/worker.ts`
- `apps/medusa-cloudflare/src/worker.spec.ts`
- Top-level Worker partition selection before production HTTP delegation

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "production HTTP route|tenant partition|HTTP runtime status"
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace @medusajs/medusa build
```

Result: passed. The Worker test command executed the Worker and request-scope
files with 23 passing tests. The Cart DO SQLite smoke gate logs expected
timeout proof errors for workflow recovery scenarios while still exiting
successfully.

## Bounded Default Route Production Partition Opt-In

Implementation commit:

- This commit (`Add bounded production partition route opt-in`)

The default `/store/currencies` URL can now opt into the production
module-backed HTTP runtime by sending an explicit partition key header.

Differences from original Medusa:

- Original Medusa does not use a Worker header to select a Durable Object
  partition before route execution.
- This fork now recognizes `x-medusa-partition-key` only for a bounded
  production-candidate route group. In this slice the only candidate is
  `GET /store/currencies`.
- When the header is present and non-empty, the Worker resolves tenant runtime
  context, computes the cart partition address, rewrites the request to the
  existing Cart DO `http/*` path, and executes the unchanged Medusa route
  through the DO-backed production Fetch HTTP runtime.
- When the header is absent, `/store/currencies` continues through the
  existing default proof HTTP handler. This slice does not switch all default
  HTTP behavior.
- Unsupported routes with the header still fall through to their existing
  behavior.

Affected boundary:

- `apps/medusa-cloudflare/src/cloudflare-http-partition-routing.ts`
- `apps/medusa-cloudflare/src/worker.ts`
- `apps/medusa-cloudflare/src/worker.spec.ts`
- `apps/medusa-cloudflare/scripts/check-workerd-cart-do-sqlite.mjs`
- Default Worker route selection before the proof HTTP handler

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "bounded default route|empty partition|production HTTP route|tenant partition|HTTP runtime status"
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace @medusajs/medusa build
```

Result: passed. The Worker test command executed the Worker and request-scope
files with 25 passing tests. The Cart DO SQLite smoke gate verified
`/store/currencies` with `x-medusa-partition-key` returns real route data from
the selected DO-backed production HTTP runtime.

## Bounded Product Types Production Partition Opt-In

Implementation commit:

- This commit (`Extend bounded production routes to product types`)

The default `/store/product-types` URL can now use the same explicit
partition-key opt-in as `/store/currencies`.

Differences from original Medusa:

- Original Medusa does not route Store Product Type requests through a Worker
  partition-selection boundary before handler execution.
- This fork now recognizes `x-medusa-partition-key` for the bounded
  production-candidate route group containing `/store/currencies` and
  `/store/product-types`.
- When the header is present and non-empty, `/store/product-types` is routed to
  the selected Cart DO production HTTP runtime and executes the unchanged
  package-owned Medusa route through the Fetch HTTP adapter and production
  `QUERY.graph` binding.
- When the header is absent, `/store/product-types` continues through the
  existing proof/default HTTP path. This still does not switch the global
  default Worker handler away from proof HTTP options.

Affected boundary:

- `apps/medusa-cloudflare/src/worker.ts`
- `apps/medusa-cloudflare/src/worker.spec.ts`
- `apps/medusa-cloudflare/scripts/check-workerd-cart-do-sqlite.mjs`
- Bounded default Worker route selection before the proof HTTP handler

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "product type|bounded default route|empty partition|production HTTP route|tenant partition|HTTP runtime status"
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace @medusajs/medusa build
git diff --check
```

Result: passed. The Worker test command executed the Worker and request-scope
files with 26 passing tests. The Cart DO SQLite smoke gate verified
`/store/product-types` with `x-medusa-partition-key` returns real route data
from the selected DO-backed production HTTP runtime.

## Bounded Collections Production Partition Opt-In

Implementation commit:

- This commit (`Extend bounded production routes to collections`)

The default `/store/collections` route family can now use the same explicit
partition-key opt-in as the previously proven Currency and Product Type
routes.

Differences from original Medusa:

- Original Medusa does not route Store Collection requests through a Worker
  partition-selection boundary before handler execution.
- This fork now recognizes `x-medusa-partition-key` for
  `/store/collections` and `/store/collections/:id` as part of the bounded
  production-candidate route group.
- When the header is present and non-empty, the Worker resolves tenant runtime
  context, computes the selected Cart DO partition, preserves the Store
  Collection request path/query, and executes the unchanged Medusa route
  through the DO-backed production Fetch HTTP runtime.
- The workerd proof covers `/store/collections/:id` with
  `products.id,products.title` fields, proving relation traversal through the
  same production Query binding used inside the Cart DO runtime.
- When the header is absent, Store Collection routes continue through the
  existing proof/default HTTP path. This still does not switch the global
  default Worker handler away from proof HTTP options.

Affected boundary:

- `apps/medusa-cloudflare/src/worker.ts`
- `apps/medusa-cloudflare/src/worker.spec.ts`
- `apps/medusa-cloudflare/scripts/check-workerd-cart-do-sqlite.mjs`
- Bounded default Worker route selection before the proof HTTP handler

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "collection route|product type|bounded default route|empty partition|production HTTP route|tenant partition|HTTP runtime status"
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace @medusajs/medusa build
git diff --check
```

Result: passed. The Worker test command executed the Worker and request-scope
files with 27 passing tests. The Cart DO SQLite smoke gate verified
`/store/collections/:id` with `x-medusa-partition-key` returns real collection
and related product data from the selected DO-backed production HTTP runtime.

## Bounded Product Tags Production Partition Opt-In

Implementation commit:

- This commit (`Extend bounded production routes to product tags`)

The default `/store/product-tags` route family can now use the same explicit
partition-key opt-in as the previously proven Store read routes.

Differences from original Medusa:

- Original Medusa does not route Store Product Tag requests through a Worker
  partition-selection boundary before handler execution.
- This fork now recognizes `x-medusa-partition-key` for
  `/store/product-tags` and `/store/product-tags/:id` as part of the bounded
  production-candidate route group.
- The Cart DO production scenario now seeds a Product Tag through the real
  Product module service so the production Fetch HTTP runtime can prove the
  unchanged Store Product Tag route against real module data.
- When the header is present and non-empty, the Worker resolves tenant runtime
  context, computes the selected Cart DO partition, preserves the Store
  Product Tag request path/query, and executes the unchanged Medusa route
  through the DO-backed production Fetch HTTP runtime.
- When the header is absent, Store Product Tag routes continue through the
  existing proof/default HTTP path. This still does not switch the global
  default Worker handler away from proof HTTP options.

Affected boundary:

- `apps/medusa-cloudflare/src/cart-proof-do.ts`
- `apps/medusa-cloudflare/src/worker.ts`
- `apps/medusa-cloudflare/src/worker.spec.ts`
- `apps/medusa-cloudflare/scripts/check-workerd-cart-do-sqlite.mjs`
- Bounded default Worker route selection before the proof HTTP handler

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "product tag|collection route|product type|bounded default route|empty partition|production HTTP route|tenant partition|HTTP runtime status"
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace @medusajs/medusa build
git diff --check
```

Result: passed. The Worker test command executed the Worker and request-scope
files with 28 passing tests. The Cart DO SQLite smoke gate verified
`/store/product-tags` with `x-medusa-partition-key` returns real Product Tag
data from the selected DO-backed production HTTP runtime.

## Bounded Production Route Policy And Runtime Status Audit

Implementation commit:

- This commit (`Extract bounded production route policy`)

The Worker now has a small app-root policy object for bounded production HTTP
route opt-in, and the runtime status endpoint reports the current blocker more
accurately.

Differences from original Medusa:

- Original Medusa does not expose a Cloudflare Worker runtime status endpoint
  or a Worker partition-selection route policy.
- This fork now keeps the bounded production route list in
  `cloudflare-http-production-route-policy.ts` instead of hardcoding the route
  predicate directly in `worker.ts`.
- The policy is still app-root composition: it names bounded Store read routes,
  the Cart partition family, and the DO rewrite target. It does not move
  commerce behavior into the app or change Medusa route handlers.
- `GET /medusa-http-runtime/status` now distinguishes proven production
  bindings from the remaining default Worker blocker. DO SQLite persistence,
  durable Fetch sessions, Remote Query/`QUERY.graph`, workflow stores,
  locking, queue bindings, and explicit tenant-scoped partition routing are
  recorded as proven inside the Cart DO production HTTP path.
- The remaining blocker is narrower: default Worker requests without
  `x-medusa-partition-key` still need a production partition-selection policy
  before proof HTTP options can be removed globally.

Affected boundary:

- `apps/medusa-cloudflare/src/cloudflare-http-production-route-policy.ts`
- `apps/medusa-cloudflare/src/cloudflare-http-runtime.ts`
- `apps/medusa-cloudflare/src/worker.ts`
- `apps/medusa-cloudflare/src/worker.spec.ts`
- Worker runtime status and bounded default production route selection

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "HTTP runtime status|bounded default route|product type|collection route|product tag|empty partition|production HTTP route|tenant partition"
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace @medusajs/medusa build
git diff --check
```

Result: passed. The Worker test command executed the Worker and request-scope
files with 28 passing tests. The composed Worker import guard passed with 1594
bundled inputs and 0 blockers. The Cart DO SQLite smoke gate still verifies
the bounded default production route opt-in through the same production Cart DO
runtime.

## Portable Query Index Boundary

Implementation commit:

- This commit (`Define portable Query index boundary`)

The portable Worker Query service now has an explicit `query.index(...)`
boundary.

Differences from original Medusa:

- Original Medusa's Node `Query.index(...)` requires the Index module, queries
  ids through that module, then hydrates records through `query.graph(...)`.
- This fork's portable Worker Query runtime does not yet connect production
  HTTP routes to the Worker Index service.
- Instead, the portable Query runtime exposes `index(...)` and accepts an
  optional portable Index handler. Without that handler, it throws a clear
  adapter-boundary error.
- This prevents Index Engine feature-flagged product routes from failing with
  a generic missing-method error while keeping the production Index hydration
  decision explicit.

Affected boundary:

- `packages/core/modules-sdk/src/remote-query/portable-query-runtime.ts`
- `@medusajs/modules-sdk/remote-query/portable`
- Worker HTTP request scopes that resolve `ContainerRegistrationKeys.QUERY`

Route audit:

- Direct production package callers of `query.index(...)`:
  - `packages/medusa/src/api/store/products/route.ts`
  - `packages/medusa/src/api/admin/products/route.ts`
- Both callers are behind the Index Engine feature flag.

Validation:

```bash
cmd /c yarn workspace @medusajs/modules-sdk test src/remote-query/__tests__/portable-query-runtime.spec.ts src/remote-query/__tests__/query-index.spec.ts --runInBand
cmd /c yarn workspace @medusajs/modules-sdk build
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace @medusajs/medusa build
cmd /c yarn workspace medusa-cloudflare test:index-sqlite
git diff --check
```

Result: passed. The existing Worker Index proof remains separate and passes
for Durable Object SQLite and D1.

## Static Query Bridge Registration Reduction

Implementation commit:

- This commit (`Move static Query entry mapping into portable runtime`)

The static module app bridge no longer owns joiner-alias parsing for Query
entrypoint registration.

Differences from original Medusa:

- Original Medusa constructs Query and Remote Query through the Node
  `MedusaApp` path and full RemoteJoiner.
- This fork's Worker static module path still registers portable Query runtime
  outputs under the normal container keys, but the joiner-config to direct
  entrypoint mapping now lives in shared portable Query runtime code.
- `static-app.ts` is reduced to static module loading, service collection, and
  container registration.
- Route behavior and registered container keys remain unchanged.

Affected boundary:

- `packages/core/modules-sdk/src/static-app.ts`
- `packages/core/modules-sdk/src/remote-query/portable-query-runtime.ts`
- `@medusajs/modules-sdk/static-app`
- `@medusajs/modules-sdk/remote-query/portable`

Validation:

```bash
cmd /c yarn workspace @medusajs/modules-sdk test src/remote-query/__tests__/portable-query-runtime.spec.ts --runInBand
cmd /c yarn workspace @medusajs/modules-sdk build
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace @medusajs/medusa build
cmd /c yarn workspace @medusajs/modules-sdk test src/remote-query/__tests__/portable-query-runtime.spec.ts src/remote-query/__tests__/remote-fetch-data.spec.ts --runInBand
git diff --check
```

Result: passed. The Cart DO SQLite smoke gate logs expected timeout proof
errors for workflow recovery scenarios while still exiting successfully.

## Portable Query Store Collection Relation Proof

Implementation commit:

- This commit (`Prove portable Query relation traversal`)

The production HTTP proof now exercises a real relation traversal through the
unchanged Store Collection route.

Differences from original Medusa:

- Original Medusa uses the full Node `Query`/`RemoteQuery`/RemoteJoiner stack
  for graph traversal.
- This fork's Worker portable direct-entrypoint runtime now derives
  first-level relations from dotted direct-entrypoint fields and passes those
  relations to the unchanged module service call.
- The proof uses `GET /store/collections/:id` with
  `fields=id,title,products.id,products.title`; the route implementation,
  request contract, response contract, Product DML relationship, and Product
  module service remain unchanged.
- This is not full link traversal or RemoteJoiner parity. It is the first
  bounded relation traversal required to reduce the temporary static Query
  bridge without app-local route behavior.

Affected boundary:

- `packages/core/modules-sdk/src/remote-query/direct-entrypoint-query.ts`
- `packages/core/modules-sdk/src/remote-query/remote-fetch-data.ts`
- `apps/medusa-cloudflare/src/cart-proof-do.ts`
- `apps/medusa-cloudflare/scripts/check-workerd-cart-do-sqlite.mjs`
- Worker production HTTP options proof for Store Collection relation loading

Validation:

```bash
cmd /c yarn workspace @medusajs/modules-sdk test src/remote-query/__tests__/remote-fetch-data.spec.ts --runInBand
cmd /c yarn workspace @medusajs/modules-sdk build
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace @medusajs/medusa build
git diff --check
```

Result: passed. The Cart DO SQLite smoke gate logs expected timeout proof
errors for workflow recovery scenarios while still exiting successfully.

## Portable Query Entrypoint Split

Implementation commit:

- This commit (`Split portable Query runtime entrypoint`)

Differences from original Medusa:

- Original Medusa exposes Query and Remote Query through the Node-oriented
  modules-sdk barrel.
- This fork now exposes a dedicated portable Query runtime entrypoint at
  `@medusajs/modules-sdk/remote-query/portable`.
- The portable entrypoint exports only the Worker-safe direct-entrypoint
  executor and portable Query runtime factory.
- Node `Query` and `RemoteQuery` remain available through
  `@medusajs/modules-sdk/remote-query/node` and the compatibility
  `@medusajs/modules-sdk/remote-query` barrel.
- `static-app.ts` now consumes the portable entrypoint, so Worker-safe code no
  longer needs to import implementation files or the Node-oriented
  RemoteJoiner graph.

Affected boundary:

- `packages/core/modules-sdk/package.json`
- `packages/core/modules-sdk/src/remote-query/portable.ts`
- `packages/core/modules-sdk/src/remote-query/node.ts`
- `packages/core/modules-sdk/src/remote-query/index.ts`
- `packages/core/modules-sdk/src/static-app.ts`
- `apps/medusa-cloudflare/scripts/check-portable-entrypoints.mjs`

Validation:

```bash
cmd /c yarn workspace @medusajs/modules-sdk build
cmd /c yarn workspace @medusajs/modules-sdk test src/__tests__/remote-query.spec.ts src/remote-query/__tests__/to-remote-query.ts src/remote-query/__tests__/query-index.spec.ts --runInBand
cmd /c yarn workspace @medusajs/medusa build
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: passed. The portable Query entrypoint bundled with 4 inputs, and the
Cart DO SQLite smoke gate logs expected timeout proof errors for workflow
recovery scenarios while still exiting successfully.

## Shared Remote Query Fetch Helper

Implementation commit:

- This commit (`Extract shared Remote Query fetch helper`)

Differences from original Medusa:

- Original Medusa keeps Remote Query service fetch mechanics inside the
  Node-oriented `RemoteQuery` class.
- This fork now has a shared remote-query fetch helper that is portable enough
  for Worker bundles and reusable by the Node `RemoteQuery` class.
- The helper owns method suffix normalization, method-name selection,
  `list`/`listAndCount` service dispatch, tracing hook execution, empty-id
  behavior, pagination result shaping, and batching.
- `RemoteQuery` still owns RemoteJoiner planning and module-service lookup.
  This slice does not make full RemoteJoiner portable yet.
- The portable direct-entrypoint runtime now shares the same service method
  call path for direct `listAndCount*` queries.

Affected boundary:

- `packages/core/modules-sdk/src/remote-query/remote-fetch-data.ts`
- `packages/core/modules-sdk/src/remote-query/remote-query.ts`
- `packages/core/modules-sdk/src/remote-query/direct-entrypoint-query.ts`
- `packages/core/modules-sdk/src/remote-query/portable.ts`
- `packages/core/modules-sdk/src/remote-query/__tests__/remote-fetch-data.spec.ts`

Validation:

```bash
cmd /c yarn workspace @medusajs/modules-sdk build
cmd /c yarn workspace @medusajs/modules-sdk test src/__tests__/remote-query.spec.ts src/remote-query/__tests__/to-remote-query.ts src/remote-query/__tests__/query-index.spec.ts src/remote-query/__tests__/remote-fetch-data.spec.ts --runInBand
cmd /c yarn workspace @medusajs/medusa build
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: passed. The portable Query entrypoint bundled with 5 inputs, and the
Cart DO SQLite smoke gate logs expected timeout proof errors for workflow
recovery scenarios while still exiting successfully.

## Portable Query Runtime Factory

Implementation commit:

- This commit (`Add portable Query runtime factory`)

Differences from original Medusa:

- Original Medusa constructs Query and Remote Query through the Node-oriented
  `MedusaApp` path and full RemoteJoiner runtime.
- This fork now has a portable direct-entrypoint Query runtime factory in
  `@medusajs/modules-sdk` remote-query code.
- The factory returns both a direct `REMOTE_QUERY` function and a direct
  `QUERY.graph(...)` service for Worker-safe production source proofs.
- `static-app.ts` is reduced to static-manifest wrapping for this boundary:
  it derives entrypoint metadata from static joiner aliases and registers the
  shared runtime outputs in the Medusa container.
- This keeps the Cloudflare app thin and continues to reuse unchanged module
  services loaded through static Medusa module bootstrap.

Affected boundary:

- `packages/core/modules-sdk/src/remote-query/portable-query-runtime.ts`
- `packages/core/modules-sdk/src/static-app.ts`
- Worker-facing `ContainerRegistrationKeys.REMOTE_QUERY` and
  `ContainerRegistrationKeys.QUERY` registration through static module
  bootstrap

Validation:

```bash
cmd /c yarn workspace @medusajs/modules-sdk build
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace @medusajs/medusa build
```

Result: passed. The Cart DO SQLite smoke gate logs expected timeout proof
errors for workflow recovery scenarios while still exiting successfully.

## Direct Query Entrypoint Executor Extraction

Implementation commit:

- This commit (`Extract direct Query entrypoint executor`)

Differences from original Medusa:

- Original Medusa executes Remote Query through the Node-oriented
  Query/Remote Query stack and full RemoteJoiner path.
- This fork now has a portable direct-entrypoint executor in
  `@medusajs/modules-sdk` remote-query code that can run in Worker bundles
  without importing the full Node Query graph.
- The static app bridge still supplies static joiner aliases and loaded module
  services, but direct `listAndCount*` dispatch is no longer app/static-bridge
  owned.
- This is not a new commerce service layer. It reuses unchanged module
  services loaded through the static Medusa module bootstrap.
- The executor remains limited to direct entrypoints. Relation traversal,
  links, `query.index(...)`, and full RemoteJoiner parity are still tracked in
  the portable Query runtime roadmap.

Affected boundary:

- `packages/core/modules-sdk/src/remote-query/direct-entrypoint-query.ts`
- `packages/core/modules-sdk/src/static-app.ts`
- Worker-facing `REMOTE_QUERY` and `QUERY.graph(...)` registration through
  static module bootstrap

Validation:

```bash
cmd /c yarn workspace @medusajs/modules-sdk build
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace @medusajs/medusa build
```

Result: passed. The Cart DO SQLite smoke gate logs expected timeout proof
errors for workflow recovery scenarios while still exiting successfully.

## Static Remote Query Direct Entrypoint Proof

Implementation commit:

- This commit (`Prove production Remote Query route`)

The static module bootstrap now exposes a Worker-safe direct-entrypoint Remote
Query registration path for production Fetch HTTP options.

Differences from original Medusa:

- Original Medusa registers Remote Query through the Node/MedusaApp bootstrap.
  That path still imports the full relation-aware planner and is not yet
  Worker-portable.
- The new `registerStaticRemoteQuery(...)` helper derives direct entrypoint
  names and `listAndCount*` method suffixes from module static joiner configs,
  then resolves the loaded module service from the shared static module
  container.
- The helper intentionally supports only one direct entrypoint query in this
  slice. Relation traversal, graph hydration, `QUERY.graph`, and index
  hydration remain future work; unsupported shapes fail loudly.
- The Cart Durable Object production HTTP proof now executes the real
  `GET /store/currencies` Medusa route through the Fetch handler, including
  query validation middleware and `remoteQueryObjectFromString`, backed by the
  DO SQLite commerce module runtime.
- The default Worker HTTP handler still uses proof runtime options. This slice
  proves a production source boundary; it does not switch global HTTP behavior.

Affected boundary:

- `packages/core/modules-sdk/src/static-app.ts`
- `apps/medusa-cloudflare/src/commerce-modules.ts`
- `apps/medusa-cloudflare/src/cart-proof-do.ts`
- `apps/medusa-cloudflare/scripts/check-workerd-cart-do-sqlite.mjs`

Validation:

```bash
cmd /c yarn workspace @medusajs/modules-sdk build
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace @medusajs/medusa build
git diff --check
```

Result: passed. The Cart DO SQLite smoke gate logs expected timeout proof
errors for workflow recovery scenarios while still exiting successfully.

Next implementation step:

- Choose the next production HTTP source route proof based on the missing
  boundary it exposes: request/auth preparation, broader Remote Query graph
  behavior, or the minimal remaining pieces needed before switching the
  default Worker handler away from proof HTTP options.

## Static Query Graph Direct Entrypoint Proof

Implementation commit:

- This commit (`Prove production Query graph route`)

The static module bootstrap now registers a minimal Worker-safe `QUERY.graph`
implementation alongside the direct-entrypoint Remote Query function.

Differences from original Medusa:

- Original Medusa registers the full `Query` service through the Node/MedusaApp
  bootstrap. That service wraps the full Remote Query planner and Index
  hydration path, which is not yet Worker-portable.
- The static bootstrap now registers `ContainerRegistrationKeys.QUERY` with a
  direct-entrypoint `graph(...)` implementation derived from module static
  joiner configs and loaded module services.
- This slice intentionally supports only direct entity graph queries that map
  to one module service `listAndCount*` method. Nested relations, Index
  hydration, `query.index(...)`, `query.gql(...)`, and multi-service graph
  traversal remain unsupported and fail at the static bootstrap boundary.
- The Cart Durable Object production HTTP proof now executes the real
  `GET /store/product-types` Medusa route through the Fetch handler, including
  query validation middleware and `QUERY.graph`, backed by the DO SQLite
  commerce module runtime.
- The default Worker HTTP handler still uses proof runtime options. This slice
  expands the production source proof; it does not switch global HTTP behavior.

Affected boundary:

- `packages/core/modules-sdk/src/static-app.ts`
- `apps/medusa-cloudflare/src/cart-proof-do.ts`
- `apps/medusa-cloudflare/scripts/check-workerd-cart-do-sqlite.mjs`

Validation:

```bash
cmd /c yarn workspace @medusajs/modules-sdk build
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace @medusajs/medusa build
git diff --check
```

Result: passed. The Cart DO SQLite smoke gate logs expected timeout proof
errors for workflow recovery scenarios while still exiting successfully.

Next implementation step:

- Continue toward switching the default Worker handler by proving either
  request/auth preparation on a protected route or the next required graph
  behavior beyond direct module entrypoints.

## Query Input Normalization Extraction

Implementation commit:

- This commit (`Extract Query input normalization`)

The actual Medusa `Query` class now delegates input normalization to a shared
helper instead of owning that logic privately.

Differences from original Medusa:

- Original Medusa normalized `RemoteQueryObjectFromStringResult`,
  `RemoteQueryObjectConfig`, `RemoteJoinerQuery`, and `RemoteQueryInput` inside
  the private `Query.#unwrapQueryConfig(...)` method.
- This fork extracts that pure normalization step into
  `packages/core/modules-sdk/src/remote-query/normalize-query-config.ts`.
- Query execution, Remote Query execution, Index hydration, translations,
  caching behavior, and Node `MedusaApp` registration are unchanged.
- The runtime-supported `service` input shape remains isolated in the helper
  because the existing public type still primarily models `entryPoint`.

Affected boundary:

- `packages/core/modules-sdk/src/remote-query/query.ts`
- `packages/core/modules-sdk/src/remote-query/normalize-query-config.ts`
- `packages/core/modules-sdk/src/remote-query/index.ts`

Validation:

```bash
cmd /c node ..\..\..\node_modules\jest\bin\jest.js --runTestsByPath src\__tests__\remote-query.spec.ts src\remote-query\__tests__\to-remote-query.ts src\remote-query\__tests__\query-index.spec.ts --runInBand
cmd /c yarn workspace @medusajs/modules-sdk build
cmd /c yarn workspace @medusajs/medusa build
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
```

Result: passed.

Next implementation step:

- Extract the direct-entrypoint executor from `static-app.ts` into shared Query
  runtime code, then keep the existing Cart DO production HTTP proofs passing.

## Durable Object Fetch Auth Session Store Proof

Implementation commit:

- This commit (`Prove production Fetch sessions with DO storage`)

The production HTTP source can now be composed with a Durable Object SQLite
auth-session store through the shared Fetch auth-session hooks.

Differences from original Medusa:

- Original Medusa keeps server-side sessions behind `express-session` and its
  configured Node stores.
- This fork keeps the Express path unchanged for Node.
- The Cloudflare production HTTP source can receive `createSession` and
  `commitSession` hooks backed by a Worker runtime store.
- `apps/medusa-cloudflare` now has an app-level
  `DurableObjectSqliteFetchAuthSessionStore` that persists `auth_context` by
  session id in Durable Object SQLite.
- The Cart DO production-options proof creates, reads, and destroys a session
  through the real Fetch handler and asserts the persisted session row is
  removed after destroy.

Affected boundary:

- `apps/medusa-cloudflare/src/cloudflare-http-session-store.ts`
- `apps/medusa-cloudflare/src/cart-proof-do.ts`
- `apps/medusa-cloudflare/scripts/check-workerd-cart-do-sqlite.mjs`

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "module runtime source|request scope"
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace @medusajs/medusa build
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
git diff --check
```

Result: passed. The default Worker HTTP handler still uses the proof runtime
options; this slice only proves that production HTTP options can carry durable
Fetch session hooks over a DO-backed module runtime.

## Shared HTTP Request Setup Core

Implementation commit:

- This commit (`Share HTTP request setup core`)

Request scope, request id, and request context setup now live behind shared
HTTP helpers in `@medusajs/framework/http`.

Differences from original Medusa:

- Original Medusa creates `req.scope`, assigns `req.requestId`, and writes
  `request_context.ip_address` directly inside Express loader middleware.
- This fork keeps the Express middleware path, but delegates those assignments
  to `setupMedusaHttpRequest(...)` and `setMedusaRequestContext(...)`.
- The Cloudflare request-scope factory now uses the same
  `createMedusaRequestScope(...)` helper instead of directly calling
  `container.createScope()`.
- Route behavior, middleware ordering, request id semantics, request IP
  semantics, and Express registration remain unchanged.

Affected boundary:

- `packages/core/framework/src/http/utils/request-context.ts`
- `packages/medusa/src/loaders/index.ts`
- `apps/medusa-cloudflare/src/cloudflare-http-request-scope.ts`
- Portable HTTP entrypoints exported from `@medusajs/framework/http/fetch` and
  `@medusajs/framework/http/portable`

Validation:

```bash
cmd /c yarn workspace @medusajs/framework build
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "request scope|module runtime source|executes static HTTP resources|executes a real Medusa route"
cmd /c node ..\..\..\node_modules\jest\bin\jest.js --runTestsByPath src\http\__tests__\request-context.spec.ts --runInBand
cmd /c yarn workspace @medusajs/medusa build
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The broader framework package Jest script widens
`--testPathPattern` to existing route-loader tests and still hits an unrelated
Windows snapshot path difference; the focused request-context Jest file passed
directly.

## Shared Fetch Auth Session Hooks

Implementation commit:

- This commit (`Share Fetch auth session hooks`)

Fetch cookie-backed auth session mechanics now live behind a shared
Worker-safe HTTP helper in `@medusajs/framework/http`.

Differences from original Medusa:

- Original Medusa uses `express-session` inside the Express loader.
- This fork preserves the Express session path for Node.
- The Fetch runtime now has a portable
  `createCookieBackedFetchAuthSessionHooks(...)` helper for creating request
  sessions, loading `auth_context` from an injected store, committing session
  cookies, and destroying sessions.
- The Cloudflare proof app keeps its current in-memory proof session store,
  but delegates cookie parsing, auth-context validation, session commit, and
  destroy-cookie behavior to the shared helper.

Affected boundary:

- `packages/core/framework/src/http/utils/fetch-session.ts`
- Portable HTTP entrypoints exported from `@medusajs/framework/http/fetch` and
  `@medusajs/framework/http/portable`
- `apps/medusa-cloudflare/src/http-proof/resources.ts`

Validation:

```bash
cmd /c node ..\..\..\node_modules\jest\bin\jest.js --runTestsByPath src\http\__tests__\fetch-session.spec.ts --runInBand
cmd /c yarn workspace @medusajs/framework build
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Auth session|auth|request scope"
cmd /c yarn workspace @medusajs/medusa build
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The Cart DO SQLite smoke gate logs expected timeout proof
errors for workflow recovery scenarios while still exiting successfully.

## Cloudflare HTTP Production Source DO Proof

Implementation commit:

- This commit (`Prove HTTP production source in Cart DO`)

The Cart Durable Object proof now exposes a non-default production HTTP
composition check at `/do-cart/:id/http-production-options-proof`.

Differences from original Medusa:

- Original Medusa has no Cloudflare Worker Fetch runtime or Durable Object
  storage composition proof.
- This fork now proves that production Fetch HTTP options can be built from the
  Worker-side module runtime source using the Cart DO's explicit SQLite
  manager, workflow stores, locking binding, and queue binding.
- The proof creates a Fetch static handler and verifies that the package-owned
  `/admin/plugins` route is present in the static manifest.
- The proof creates a request scope through production options and verifies it
  resolves the real Cart module service from the DO-backed commerce runtime.
- The default Worker HTTP handler still uses proof HTTP options. No request,
  route, session, auth, or Remote Query behavior changed.

Affected boundary:

- `apps/medusa-cloudflare/src/cart-proof-do.ts`
- `apps/medusa-cloudflare/scripts/check-workerd-cart-do-sqlite.mjs`
- Non-default Cloudflare HTTP production composition proof

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "module runtime source|executes static HTTP resources|executes a real Medusa route"
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result: passed. The Cart DO SQLite smoke gate now calls
`/do-cart/:id/http-production-options-proof` and still logs expected timeout
proof errors for workflow recovery scenarios while exiting successfully.

Next step:

- Fill the next missing production HTTP binding explicitly, starting with
  request/session/auth or Remote Query composition, before making the
  production source the default Worker HTTP handler.

## Cloudflare HTTP Worker Module Runtime Source

Implementation commit:

- This commit (`Add HTTP Worker module runtime source`)

The Cloudflare HTTP production path now has a Worker-side module runtime source
that lazily creates a real module runtime and derives Fetch HTTP options from
its shared Medusa container.

Differences from original Medusa:

- Original Medusa does not have a Cloudflare Fetch HTTP runtime source; it
  starts through the Node/Express bootstrap path.
- This fork now exposes
  `createMedusaCloudflareHttpModuleRuntimeSource(...)` from the Worker HTTP
  runtime boundary.
- The source accepts the already selected Drizzle manager and Cloudflare module
  runtime options explicitly. It does not resolve tenant, storage, or platform
  bindings inside the request-scope hook.
- The Worker still uses proof HTTP options by default. Route behavior and proof
  manifests are unchanged in this slice.

Affected boundary:

- `apps/medusa-cloudflare/src/cloudflare-http-module-runtime-source.ts`
- `apps/medusa-cloudflare/src/cloudflare-http-runtime.ts`
- Cloudflare HTTP production composition over real module runtime containers

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "request scope|production HTTP options|module runtime source"
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The Cart DO SQLite smoke gate logs expected timeout proof
errors for workflow recovery scenarios while still exiting successfully.

Next step:

- Wire the production source into a non-default Worker HTTP composition proof
  path once a concrete storage binding is selected for that path. Keep the
  current proof HTTP options as the default until request/session/auth and
  Remote Query bindings are production-ready.

## Cloudflare HTTP Runtime Entrypoint

Implementation commit:

- This commit (`Start production HTTP runtime entrypoint`)

Difference from original Medusa:

- Original Medusa starts HTTP through the Node/Express bootstrap path and
  filesystem route discovery.
- This fork already has package-owned static manifests and a shared
  `@medusajs/medusa/static/fetch-http-handler` entrypoint for the Fetch HTTP
  adapter.
- The Cloudflare Worker now calls a neutral
  `apps/medusa-cloudflare/src/cloudflare-http-runtime.ts` entrypoint instead
  of calling `static-http-proof.ts` directly.
- `static-http-proof.ts` remains as a compatibility alias for existing proof
  imports, but it no longer owns handler construction.
- Route handlers, middleware behavior, request/session hooks, static manifest
  inputs, and proof resources are unchanged in this slice.

Affected boundary:

- `apps/medusa-cloudflare/src/cloudflare-http-runtime.ts`
- `apps/medusa-cloudflare/src/static-http-proof.ts`
- `apps/medusa-cloudflare/src/worker.ts`
- Worker import graph for package-owned static Fetch HTTP routes

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "executes static HTTP resources|executes a real Medusa route"
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
```

Result: passed. The Worker test command executed the full
`apps/medusa-cloudflare/src/worker.spec.ts` file and passed all 16 tests.

Next implementation step:

- Move another production HTTP bootstrap concern out of proof naming without
  changing route behavior: split proof-only fixture routes/resources from the
  reusable Cloudflare HTTP runtime options, or introduce a package-owned runtime
  composition helper if the next app-owned hook can be generalized safely.

## Cloudflare HTTP Proof Runtime Options Split

Implementation commit:

- This commit (`Split HTTP proof runtime options`)

Difference from original Medusa:

- Original Medusa does not have a Cloudflare Fetch runtime path; it uses the
  Node/Express bootstrap.
- This fork now separates the Worker-facing Cloudflare HTTP runtime factory
  from proof-only fixture option assembly.
- `apps/medusa-cloudflare/src/cloudflare-http-runtime.ts` now exports
  `createMedusaCloudflareHttpRuntime(options)` as the reusable handler factory.
- Proof-only manifests, resource sets, setup/reset hooks, request-scope hooks,
  and session hooks are grouped in
  `apps/medusa-cloudflare/src/http-proof/runtime-options.ts`.
- The current Worker still uses the proof options because the production
  Remote Query/session/auth composition is not implemented yet. The proof
  dependency is now explicit and replaceable instead of being mixed directly
  into the Worker-facing runtime entrypoint.

Affected boundary:

- `apps/medusa-cloudflare/src/cloudflare-http-runtime.ts`
- `apps/medusa-cloudflare/src/http-proof/runtime-options.ts`
- Worker import graph for package-owned static Fetch HTTP routes

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "executes static HTTP resources|executes a real Medusa route"
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
```

Result: passed. The Worker test command executed the full
`apps/medusa-cloudflare/src/worker.spec.ts` file and passed all 16 tests.

Next implementation step:

- Add a production-oriented Cloudflare HTTP composition option path that can
  eventually replace `staticHttpProofRuntimeOptions` with real request-scope,
  session/auth, Remote Query, and module-runtime bindings.

## Cloudflare HTTP Production Options Boundary

Implementation commit:

- This commit (`Add Cloudflare HTTP production options boundary`)

Difference from original Medusa:

- Original Medusa does not expose a Cloudflare Worker HTTP runtime composition
  boundary; Node/Express bootstrap owns request scope, sessions, middleware,
  and route registration.
- This fork now has a production-oriented Cloudflare HTTP options builder at
  `apps/medusa-cloudflare/src/cloudflare-http-options.ts`.
- The builder requires `createRequestScope` even though the lower-level Fetch
  adapter accepts it as optional. Production Cloudflare HTTP must not silently
  run Medusa handlers without an explicit request scope boundary.
- The production options type intentionally does not include proof setup hooks
  such as `handleSetupRequest` or `isSetupPath`; those remain isolated in
  `http-proof/runtime-options.ts`.
- The Worker still uses `staticHttpProofRuntimeOptions` in this slice. The new
  production path is a typed composition boundary for replacing proof fixtures
  with real request-scope, session/auth, Remote Query, and module runtime
  bindings one piece at a time.

Affected boundary:

- `apps/medusa-cloudflare/src/cloudflare-http-options.ts`
- `apps/medusa-cloudflare/src/cloudflare-http-runtime.ts`
- Worker-facing HTTP runtime composition types

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "executes static HTTP resources|executes a real Medusa route"
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
```

Result: passed. The Worker test command executed the full
`apps/medusa-cloudflare/src/worker.spec.ts` file and passed all 16 tests.

Next implementation step:

- Implement the first real production option hook behind this boundary,
  starting with request-scope composition over the existing Cloudflare module
  runtime rather than copying proof fixture services.

## Cloudflare HTTP Request Scope Factory

Implementation commit:

- This commit (`Add Cloudflare HTTP request scope factory`)

Difference from original Medusa:

- Original Medusa assigns request scopes through the Node/Express bootstrap.
- This fork now has a Worker-compatible request-scope factory at
  `apps/medusa-cloudflare/src/cloudflare-http-request-scope.ts`.
- The factory creates per-request Medusa scopes from a shared Medusa container,
  which is the same boundary the Fetch HTTP adapter expects through
  `createRequestScope`.
- The real Cloudflare commerce module runtime now exposes the shared Medusa
  container it creates during static module loading, so future production HTTP
  options can build request scopes from real module registrations instead of
  the proof fixture container.
- The Worker still uses proof HTTP options in this slice. Route behavior and
  proof resources are unchanged.

Affected boundary:

- `apps/medusa-cloudflare/src/cloudflare-http-request-scope.ts`
- `apps/medusa-cloudflare/src/cloudflare-http-request-scope.spec.ts`
- `apps/medusa-cloudflare/src/cloudflare-http-runtime.ts`
- `apps/medusa-cloudflare/src/commerce-modules.ts`
- `apps/medusa-cloudflare/package.json`
- Cloudflare HTTP runtime request-scope composition

Validation:

```bash
cmd /c yarn workspace @medusajs/framework build
cmd /c yarn workspace @medusajs/types build
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "createMedusaCloudflareRequestScopeFactory|executes static HTTP resources|executes a real Medusa route"
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
```

Result: passed. The Worker test command now runs both
`worker.spec.ts` and `cloudflare-http-request-scope.spec.ts`, with 17 tests
passing.

Next implementation step:

- Wire this request-scope factory into a production HTTP options instance once
  the Cloudflare HTTP runtime has a real module-runtime source for the target
  Worker request path.

## Cloudflare HTTP Module Runtime Options Source

Implementation commit:

- This commit (`Add HTTP module runtime options source`)

Difference from original Medusa:

- Original Medusa does not have a Cloudflare Worker HTTP runtime options
  source; Node/Express bootstrap owns the server container and request scope.
- This fork now exposes
  `createMedusaCloudflareHttpRuntimeOptionsFromModuleRuntime(...)`, which
  builds production-oriented Fetch HTTP options from a real Cloudflare commerce
  module runtime container.
- The helper intentionally accepts an already-created module runtime source.
  The Fetch adapter's `createRequestScope` hook is synchronous, so this slice
  does not pretend to create the async module runtime inside that hook.
- The Worker still uses proof HTTP options. This slice only creates the typed
  production path that can be used once the Worker request path has a real
  module runtime source.

Affected boundary:

- `apps/medusa-cloudflare/src/cloudflare-http-options.ts`
- `apps/medusa-cloudflare/src/cloudflare-http-runtime.ts`
- `apps/medusa-cloudflare/src/cloudflare-http-request-scope.spec.ts`
- Cloudflare HTTP runtime options composition over module runtime containers

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "createMedusaCloudflareRequestScopeFactory|production HTTP options|executes static HTTP resources|executes a real Medusa route"
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare test
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
```

Result: passed. The full `medusa-cloudflare test` script now passes 18 tests
across the Worker spec and Cloudflare HTTP request-scope spec.

Next implementation step:

- Add the first Worker-side module runtime source for HTTP requests, keeping it
  explicit about whether storage is D1, Durable Object SQLite, or another
  tenant-scoped binding.

## Admin Users Retrieve Route Direct Utility Imports

Implementation commit:

- `97bd44901b Use portable utility imports in admin user retrieve route`

The package-owned `GET /admin/users/:id` route now avoids the broad framework
utility barrel for Worker-facing helper imports.

Differences from original Medusa:

- Original Medusa imports `ContainerRegistrationKeys`, `MedusaError`, and
  `remoteQueryObjectFromString` through `@medusajs/framework/utils` in
  `packages/medusa/src/api/admin/users/[id]/get-route.ts`.
- This fork imports those helpers from direct portable `@medusajs/utils`
  subpaths:
  `@medusajs/utils/common/container`,
  `@medusajs/utils/common/errors`, and
  `@medusajs/utils/common/remote-query-object-from-string`.
- Route behavior, request/response contracts, query shape, and static manifest
  ownership are unchanged.

Affected boundary:

- `packages/medusa/src/api/admin/users/[id]/get-route.ts`
- Worker import graph for `GET /admin/users/:id`

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The Cart DO SQLite smoke gate logs expected timeout proof
errors for workflow recovery scenarios while still exiting successfully.

## Admin Users Roles Remove Route Direct Utility Imports

Implementation commit:

- `2c4e83d2e5 Use portable utility imports in admin user roles remove route`

The package-owned `DELETE /admin/users/:id/roles` route now avoids the broad
framework utility barrel for Worker-facing helper imports.

Differences from original Medusa:

- Original Medusa imports `ContainerRegistrationKeys` and `MedusaError`
  through `@medusajs/framework/utils` in
  `packages/medusa/src/api/admin/users/[id]/roles/delete-route.ts`.
- This fork imports those helpers from direct portable `@medusajs/utils`
  subpaths:
  `@medusajs/utils/common/container` and
  `@medusajs/utils/common/errors`.
- Route behavior, user existence validation, workflow invocation, response
  contract, and static manifest ownership are unchanged.

Affected boundary:

- `packages/medusa/src/api/admin/users/[id]/roles/delete-route.ts`
- Worker import graph for `DELETE /admin/users/:id/roles`

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The Cart DO SQLite smoke gate logs expected timeout proof
errors for workflow recovery scenarios while still exiting successfully.

## Admin Users Roles Assign Route Direct Utility Imports

Implementation commit:

- `a43f038146 Use portable utility imports in admin user roles assign route`

The package-owned `POST /admin/users/:id/roles` route now avoids the broad
framework utility barrel for Worker-facing helper imports.

Differences from original Medusa:

- Original Medusa imports `ContainerRegistrationKeys` and `MedusaError`
  through `@medusajs/framework/utils` in
  `packages/medusa/src/api/admin/users/[id]/roles/post-route.ts`.
- This fork imports those helpers from direct portable `@medusajs/utils`
  subpaths:
  `@medusajs/utils/common/container` and
  `@medusajs/utils/common/errors`.
- Route behavior, user existence validation, workflow invocation, response
  contract, and static manifest ownership are unchanged.

Affected boundary:

- `packages/medusa/src/api/admin/users/[id]/roles/post-route.ts`
- Worker import graph for `POST /admin/users/:id/roles`

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The Cart DO SQLite smoke gate logs expected timeout proof
errors for workflow recovery scenarios while still exiting successfully.

## Admin Users Roles List Route Direct Container Import

Implementation commit:

- `0562b082b6 Use portable container import in admin user roles list route`

The package-owned `GET /admin/users/:id/roles` route now avoids the broad
framework utility barrel for its container registration key import.

Differences from original Medusa:

- Original Medusa imports `ContainerRegistrationKeys` through
  `@medusajs/framework/utils` in
  `packages/medusa/src/api/admin/users/[id]/roles/get-route.ts`.
- This fork imports `ContainerRegistrationKeys` from the direct portable
  `@medusajs/utils/common/container` subpath.
- Route behavior, query graph usage, response contract, pagination metadata,
  and static manifest ownership are unchanged.

Affected boundary:

- `packages/medusa/src/api/admin/users/[id]/roles/get-route.ts`
- Worker import graph for `GET /admin/users/:id/roles`

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The Cart DO SQLite smoke gate logs expected timeout proof
errors for workflow recovery scenarios while still exiting successfully.

## Admin Users Delete Route Direct Error Import

Implementation commit:

- `fa74885692 Use portable error import in admin user delete route`

The package-owned `DELETE /admin/users/:id` route now avoids the broad
framework utility barrel for its error helper import.

Differences from original Medusa:

- Original Medusa imports `MedusaError` through `@medusajs/framework/utils` in
  `packages/medusa/src/api/admin/users/[id]/delete-route.ts`.
- This fork imports `MedusaError` from the direct portable
  `@medusajs/utils/common/errors` subpath.
- Route behavior, self-delete guard, workflow invocation, response contract,
  and static manifest ownership are unchanged.

Affected boundary:

- `packages/medusa/src/api/admin/users/[id]/delete-route.ts`
- Worker import graph for `DELETE /admin/users/:id`

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The Cart DO SQLite smoke gate logs expected timeout proof
errors for workflow recovery scenarios while still exiting successfully.

## Admin Users Current User Route Direct Utility Imports

Implementation commit:

- `2633b7303f Use portable utility imports in current admin user route`

The package-owned `GET /admin/users/me` route now avoids the broad framework
utility barrel for Worker-facing helper imports.

Differences from original Medusa:

- Original Medusa imports `ContainerRegistrationKeys`, `MedusaError`, and
  `remoteQueryObjectFromString` through `@medusajs/framework/utils` in
  `packages/medusa/src/api/admin/users/me/route.ts`.
- This fork imports those helpers from direct portable `@medusajs/utils`
  subpaths:
  `@medusajs/utils/common/container`,
  `@medusajs/utils/common/errors`, and
  `@medusajs/utils/common/remote-query-object-from-string`.
- Route behavior, request/response contracts, query shape, and static manifest
  ownership are unchanged.

Affected boundary:

- `packages/medusa/src/api/admin/users/me/route.ts`
- Worker import graph for `GET /admin/users/me`

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Admin Users"
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
git diff --check
```

Result: passed. The Cart DO SQLite smoke gate logs expected timeout proof
errors for workflow recovery scenarios while still exiting successfully.

## Shared Worker-Safe Bearer JWT Verifier

Implementation commit:

- This commit (`Use Worker-safe bearer JWT verifier`)

The Cart DO production HTTP auth preparation path now verifies bearer tokens
with a shared framework HTTP HS256 verifier before setting Medusa's request
auth context.

Differences from original Medusa:

- Original Medusa verifies bearer JWTs through the Node `jsonwebtoken`
  runtime inside the Express-oriented auth middleware.
- This fork adds a portable Fetch HTTP verifier boundary that uses WebCrypto
  HMAC SHA-256 verification, rejects tampered signatures, and honors `exp` and
  `nbf` claims before narrowing the payload into `AuthContext`.
- The Cart DO production HTTP composition now injects that verifier through
  `createBearerAuthContextPrepareRequest(...)` instead of the previous
  `decodeUnverifiedJwtBearerAuthContext(...)` proof decoder.
- The proof-only unverified decoder remains exported for narrow transitional
  callers and tests, but it is no longer used by the bounded Cart DO production
  `/auth/session` path.
- This is still not the complete Medusa auth subsystem migration. Token
  issuance through the broader Medusa utility surface and production secret
  management remain separate boundaries.

Affected boundary:

- `packages/core/framework/src/http/utils/bearer-auth-context.ts`
- `packages/core/framework/src/http/fetch.ts`
- `packages/core/framework/src/http/portable.ts`
- `apps/medusa-cloudflare/src/cart-proof-do.ts`
- `apps/medusa-cloudflare/src/cloudflare-http-request-scope.ts`
- Cart DO production HTTP route handling for bounded `/auth/session`

Validation:

```bash
cmd /c .\node_modules\.bin\jest packages/core/framework/src/http/__tests__/bearer-auth-context.spec.ts --runInBand --forceExit
cmd /c yarn workspace @medusajs/framework build
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "auth session routes|HTTP runtime status|bounded default route|empty partition|production HTTP route|tenant partition"
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace @medusajs/medusa build
git diff --check
```

Result: passed. The Cart DO SQLite smoke gate verifies bounded
`/auth/session` with a signed bearer token through the selected production
HTTP runtime and still logs expected timeout proof errors for workflow recovery
scenarios while exiting successfully.

## URL-Derived Cart Retrieve Partition Selection

Implementation commit:

- This commit (`Derive Cart retrieve partition from route`)

The Worker can now route `GET /store/carts/:id` to the Cart Durable Object
production HTTP runtime without the internal `x-medusa-partition-key` header.

Differences from original Medusa:

- Original Medusa has no Cloudflare Worker partition selection.
- This fork now derives the Cart partition key from the URL for the narrow
  cart-owned retrieve route:

```text
GET /store/carts/:id -> partition:{tenant}:{deployment}:{env}:{version}:cart:{id}
```

- The existing header opt-in policy remains in place for broader bounded proof
  routes such as `/store/currencies`, `/store/product-types`, and
  `/auth/session`.
- The route still executes the unchanged package-owned Medusa
  `GET /store/carts/:id` handler through the Fetch HTTP adapter inside the
  selected Cart DO. The Worker app root owns only route matching, tenant
  context resolution, and partition address selection.
- The workerd proof creates the cart through the existing Cart DO scenario and
  then reads that same cart through the top-level headerless Store route. It
  intentionally avoids initializing a separate Cart DO runtime before the main
  module scenario.

Affected boundary:

- `apps/medusa-cloudflare/src/cloudflare-http-production-route-policy.ts`
- `apps/medusa-cloudflare/src/cloudflare-http-partition-routing.ts`
- `apps/medusa-cloudflare/src/worker.ts`
- Cart DO production HTTP routing for `GET /store/carts/:id`

Current limitations:

- Only `GET /store/carts/:id` has URL-derived partition selection.
- Cart mutations, cart completion, auth/session, and catalog routes still need
  separate partition policies before the static proof HTTP runtime can be
  replaced globally.

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "HTTP runtime status|bounded default route|store cart routes|Cart production partition|tenant partition"
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace @medusajs/medusa build
git diff --check
```

Result: passed. The Cart DO SQLite smoke gate verifies the scenario cart can
be read through top-level `GET /store/carts/:id` without
`x-medusa-partition-key`; the route is served by the selected Cart DO
production HTTP runtime.

## Static Fetch Default Error Handling

Implementation commit:

- This commit (`Isolate Cart DO module runtimes`)

Static Fetch HTTP handlers now apply the same default Medusa error handler that
the Medusa router applies during Express registration when no static middleware
manifest provides a custom error handler.

Differences from original Medusa:

- Original Medusa's Express `ApiLoader` registers the default `errorHandler()`
  after route and middleware registration.
- This fork's static Fetch handler now mirrors that default so unchanged Medusa
  route handlers that throw `MedusaError` return the expected JSON error
  envelope in Worker runtimes.
- The lower-level `FetchHttpAdapter` still requires an explicit error handler
  when used directly; the default is applied at static handler composition,
  which is the static equivalent of Medusa router registration.

Affected boundary:

- `packages/core/framework/src/http/adapters/fetch.ts`
- Static Fetch HTTP composition used by `packages/medusa/src/static/fetch-http-handler.ts`
- Cart DO production HTTP handling for URL-derived Store cart retrieval

Validation:

```bash
cmd /c yarn jest packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts --runInBand
cmd /c yarn workspace @medusajs/framework build
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "HTTP runtime status|bounded default route|store cart routes|Cart production partition|tenant partition"
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints
cmd /c yarn workspace medusa-cloudflare check:imports
cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports
cmd /c yarn workspace medusa-cloudflare check:real-module-imports
cmd /c yarn workspace @medusajs/medusa build
git diff --check
```

Result: passed. The workerd proof now verifies a missing
`GET /store/carts/:id` in a fresh URL-derived Cart partition returns Medusa's
JSON `not_found` response instead of a raw Worker or Drizzle error response.

## Cart Mutation Route Workflow Blocker

Commit:

- This commit (`Record cart mutation workflow blocker`)

Status:

- `POST /store/carts/:id` is not ready to move into URL-derived production
  partition routing.

Finding:

- The route-level partition key is straightforward:

```text
POST /store/carts/:id -> partition:{tenant}:{deployment}:{env}:{version}:cart:{id}
```

- The blocker is not routing. The unchanged Medusa route calls the real
  Workflow Engine with workflow id `update-cart`.
- The current Worker Cart DO production runtime does not statically register
  the `update-cart` core-flow workflow, so the unchanged route returns
  `Workflow with id "update-cart" not found`.
- A narrow static import of `update-cart` proved this is a larger workflow
  portability boundary: the workflow imports cart refresh, shipping,
  fulfillment, payment, tax, locking, and translation workflow paths. That
  graph still reaches Node-only utilities and broad framework barrels, causing
  the workerd production build to fail with Node import blockers such as
  `timers/promises`, `fs`, `path`, `crypto`, MikroORM, `pg`, and Knex edges.

Decision:

- Keep URL-derived production routing limited to `GET /store/carts/:id` until
  the real cart workflow graph has package-owned Worker-safe entrypoints.
- Do not add an app-local fake `update-cart` workflow and do not route POST
  cart mutations through the production Cart DO runtime until the unchanged
  Medusa workflow can be registered without Node-only imports.

Affected boundary:

- `packages/medusa/src/api/store/carts/[id]/route.ts`
- `packages/core/core-flows/src/cart/workflows/update-cart.ts`
- Cart workflow static registration and Worker import graph
- `apps/medusa-cloudflare` production Cart DO HTTP routing policy

Validation:

```bash
cmd /c yarn workspace medusa-cloudflare typecheck
cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "HTTP runtime status|store cart routes|Cart production partition|bounded default route|tenant partition"
cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite
```

Result:

- Current proven GET-only Cart route behavior remains green after backing out
  the unproven POST routing attempt.
