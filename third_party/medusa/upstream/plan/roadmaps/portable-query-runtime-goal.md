# Portable Query Runtime Goal

## Purpose

This roadmap replaces the temporary static `REMOTE_QUERY` and `QUERY.graph`
bridge with the actual Medusa Query/Remote Query runtime made portable for
Cloudflare.

The goal is not to build a second query framework in
`apps/medusa-cloudflare`. The goal is to refactor the existing Query stack so
the same Medusa route handlers can resolve `ContainerRegistrationKeys.QUERY`
and `ContainerRegistrationKeys.REMOTE_QUERY` in both Node and Worker runtimes.

## Current Evidence

The real Query stack is currently centered in:

- `packages/core/modules-sdk/src/remote-query/query.ts`
- `packages/core/modules-sdk/src/remote-query/remote-query.ts`
- `packages/core/modules-sdk/src/remote-query/to-remote-query.ts`
- `packages/core/modules-sdk/src/medusa-app.ts`

The production Worker proof currently registers a limited bridge in:

- `packages/core/modules-sdk/src/static-app.ts`

That bridge supports only:

- direct `REMOTE_QUERY` entrypoint queries such as `currency`;
- direct `QUERY.graph(...)` entity queries such as `product_type`;
- one loaded module service at a time;
- `listAndCount*` service methods via static joiner aliases.

It does not support:

- relation traversal;
- multi-service joins;
- link modules;
- `query.index(...)`;
- `query.gql(...)`;
- translated graph results beyond what the current route needs;
- full Remote Joiner behavior.

## Why The Current Bridge Exists

The current bridge exists because importing the real `RemoteQuery` and `Query`
implementation directly into the Worker bundle pulls a broad graph that is not
yet portable.

Important coupling points:

- `Query` imports `RemoteQuery` directly.
- `Query` imports broad `@medusajs/utils` helpers and decorator-backed caching.
- `RemoteQuery` imports `RemoteJoiner` and `toRemoteJoinerQuery` from
  `@medusajs/orchestration`.
- `RemoteQuery` defaults to `MedusaModule.getLoadedModules()`, which is a
  global Node-style loaded-module registry unless explicitly supplied.
- `RemoteQuery.remoteFetchData(...)` mixes query planning, module service
  resolution, service method naming, pagination, batching, and tracing in one
  class.
- `MedusaApp` constructs the real `RemoteQuery` and `Query` after module
  loading, but the current Worker path uses `loadStaticModules(...)` rather
  than full `MedusaApp`.

The bridge is acceptable only as a proof boundary. It should shrink over time
as real portable Query pieces replace it.

## Target Shape

The target runtime shape is:

```text
static or filesystem module bootstrap
          |
          v
portable query registration contract
          |
          v
portable query planner and direct fetch executor
          |
          +--------------------+
          |                    |
 Node adapter            Worker adapter
 full RemoteJoiner       Worker-safe RemoteJoiner/direct executor
 Index module            Drizzle/D1/DO-backed Index adapter
```

Portable pieces should live in shared packages and import only contracts,
types, and portable utilities. Runtime selection happens at the application
root or bootstrap boundary.

## Non Goals

- Do not expand `apps/medusa-cloudflare` into a parallel query implementation.
- Do not reimplement commerce route behavior in proof resources.
- Do not import the full `@medusajs/framework` or Node barrels into Worker
  entrypoints.
- Do not switch the default Worker HTTP handler until the route proof matrix
  still passes with the real portable Query runtime.
- Do not remove Node/MikroORM behavior while it is still the default upstream
  compatibility path.

## Acceptance Criteria

This goal is complete when:

- `ContainerRegistrationKeys.REMOTE_QUERY` and `ContainerRegistrationKeys.QUERY`
  are registered from shared Query runtime code, not from the temporary
  static bridge in `static-app.ts`.
- Direct `REMOTE_QUERY` and direct `QUERY.graph` route proofs continue to pass
  in workerd.
- At least one relation or link traversal route passes through the real
  portable Query runtime in workerd.
- Worker import guards still show no MikroORM, `pg`, Express, or Node-only
  imports in the Worker bundle graph.
- The Node `MedusaApp` Query behavior remains passing.
- The temporary bridge in `static-app.ts` is either removed or reduced to a
  thin call into the shared portable Query runtime.

## Turn By Turn Plan

### Turn 1: Extract Query Input Normalization

Goal:

- Move Query input normalization out of `Query` into a portable helper.

Work:

- Extract the logic currently in `Query.#unwrapQueryConfig(...)`.
- Keep support for:
  - `RemoteQueryObjectFromStringResult`;
  - `RemoteQueryObjectConfig`;
  - `RemoteJoinerQuery`;
  - `RemoteQueryInput` with `entity`.
- Move only pure normalization. Do not move execution.

Validation:

- Existing `remote-query` unit tests.
- `@medusajs/modules-sdk build`.
- `@medusajs/medusa build`.
- `medusa-cloudflare check:portable-entrypoints`.

Stop condition:

- The helper is shared by the current `Query` class but route behavior is
  unchanged.

### Turn 2: Extract Direct Entrypoint Executor

Goal:

- Move the direct-entrypoint execution logic from `static-app.ts` into shared
  Query runtime code.

Work:

- Create a portable executor that accepts:
  - static or loaded joiner configs;
  - loaded service instances;
  - normalized direct query selection;
  - optional tracing hook.
- Make `static-app.ts` call the shared executor instead of owning the service
  method lookup itself.
- Keep the executor limited to direct entrypoints in this turn.

Validation:

- `@medusajs/modules-sdk build`.
- `medusa-cloudflare typecheck`.
- `medusa-cloudflare test:cart-do-sqlite`.
- Worker import guards.

Stop condition:

- Current `GET /store/currencies` and `GET /store/product-types` production
  proofs pass with the shared executor.

### Turn 3: Add Portable Query Registration Factory

Goal:

- Replace `registerStaticRemoteQuery(...)` with a more accurately named shared
  registration factory.

Work:

- Add a shared factory such as `createPortableQueryRuntime(...)`.
- It should return both:
  - backward-compatible `remoteQuery(...)`;
  - `query.graph(...)` for direct entrypoints.
- Register those under `ContainerRegistrationKeys.REMOTE_QUERY` and
  `ContainerRegistrationKeys.QUERY`.
- Keep `registerStaticRemoteQuery(...)` as a compatibility wrapper only.

Validation:

- Same Cart DO production HTTP proof.
- `@medusajs/medusa build`.
- Import guards.

Stop condition:

- The static bridge no longer owns Query runtime logic; it only supplies
  static manifests and loaded services to the shared factory.

### Turn 4: Split Node Query Runtime From Portable Query Runtime

Goal:

- Make Node-specific full Query/Remote Query construction explicit.

Work:

- Split entrypoints so Worker-safe code can import portable Query types and
  direct executor without importing the full `RemoteJoiner` implementation.
- Keep the existing `RemoteQuery` class available for Node `MedusaApp`.
- Avoid shared barrels that re-export Node-only query classes into Worker
  entrypoints.

Validation:

- `@medusajs/modules-sdk build`.
- Node Query/Remote Query unit tests.
- `@medusajs/medusa build`.
- `medusa-cloudflare check:portable-entrypoints`.
- `medusa-cloudflare check:imports`.

Stop condition:

- Worker entrypoints can import the portable Query factory without pulling the
  full Node Query/Remote Query graph.

### Turn 5: Refactor Remote Fetch Data Into Adapter Contract

Goal:

- Separate `RemoteQuery.remoteFetchData(...)` service fetching from the
  `RemoteQuery` class.

Work:

- Extract a `RemoteDataFetcher` or equivalent contract.
- Move method-name resolution, `list` versus `listAndCount`, pagination,
  batching, and tracing into an adapter-safe helper.
- Use it from both:
  - Node `RemoteQuery`;
  - portable Worker Query runtime.

Validation:

- Existing Remote Query tests.
- Add focused tests for method suffix, pagination, empty id arrays, and
  batching behavior.
- Cart DO production HTTP proof.

Stop condition:

- The Worker direct-entrypoint path and Node RemoteQuery path share the same
  fetch-data behavior.

### Turn 6: Introduce Worker-Safe Relation Traversal Proof

Goal:

- Prove one real Medusa route that requires relation traversal or a link.

Candidate routes:

- `GET /store/collections/:id` if it needs product collection graph behavior.
- `GET /store/products/:id` if the required product graph can be kept bounded.
- A small Admin RBAC/user-role route if it exercises link traversal with less
  product complexity.

Work:

- Pick the smallest route that fails because direct entrypoint graph is not
  enough.
- Implement only the relation/link behavior needed by that route in the
  shared Query runtime.
- Keep data seeded through real module services.

Validation:

- Focused Worker route proof.
- Cart DO production HTTP proof.
- Import guards.

Stop condition:

- One real route proves relation/link traversal through shared Query runtime,
  not app-local proof resources.

### Turn 7: Decide Index Boundary

Goal:

- Decide how `query.index(...)` should work in Worker runtime.

Options:

- Make `query.index(...)` call a Worker-safe Index service backed by the
  existing Drizzle/SQLite Index proof.
- Keep `query.index(...)` unavailable until a route requires it, but fail with
  a clear error.

Work:

- Audit routes using `query.index(...)`.
- Pick the smallest route that truly needs index hydration.
- Document whether this belongs in the Query runtime goal or a separate Index
  runtime goal.

Validation:

- Import guards.
- Existing Index workerd proof, if touched.

Stop condition:

- We have a concrete Index route target or an explicit deferred boundary.

### Turn 8: Replace Static Bridge Registrations

Goal:

- Stop using the temporary direct static bridge as the production registration
  path.

Work:

- Update `static-app.ts` to call the shared portable Query runtime factory.
- Rename compatibility functions if needed.
- Keep old names temporarily only if existing callsites require them.

Validation:

- Cart DO production HTTP proof.
- Worker import guards.
- `@medusajs/medusa build`.
- `git diff --check`.

Stop condition:

- The temporary bridge is no longer the owner of query behavior.

### Turn 9: Switch Default Worker Handler Candidate

Goal:

- Evaluate whether the default Worker HTTP handler can move one step away from
  proof runtime options.

Work:

- Compare production source coverage against proof runtime options:
  - request scope;
  - session/auth;
  - `REMOTE_QUERY`;
  - `QUERY.graph`;
  - route manifest;
  - event/workflow bindings.
- Identify remaining blockers before changing default Worker behavior.

Validation:

- Full `medusa-cloudflare test`.
- Cart DO workerd proof.
- Import guards.

Stop condition:

- Either switch a non-default path to production runtime, or record the exact
  missing blocker before switching.

### Turn 10: Add Non-Default Production HTTP Partition Route

Goal:

- Move one top-level Worker path from proof HTTP options to the proven
  production module-backed HTTP runtime without switching the default handler.

Work:

- Add a Worker route that explicitly selects a commerce partition.
- Forward the request into the Cart Durable Object partition that already owns
  the DO SQLite manager, workflow stores, session store, locking namespace, and
  queue binding.
- Add a generic Cart DO `http/*` path that delegates to the existing
  production Fetch HTTP handler from `createMedusaCloudflareHttpModuleRuntimeSource(...)`.
- Keep the default Worker handler on `staticHttpProofRuntimeOptions`.

Validation:

- Focused Worker route tests.
- Cart DO workerd proof with a real package-owned Medusa route through the
  top-level partition route.
- Worker import guards.

Stop condition:

- `GET /medusa-http-runtime/partitions/:partition/store/currencies` reaches
  the module-backed HTTP runtime inside the selected DO partition and returns
  real route data.

## Review Questions

- Should Turn 6 target a Store product route, or should it target a smaller
  Admin/RBAC link route first?
- Should `query.index(...)` be handled inside this goal, or should it become a
  separate Index runtime goal after direct Query and relation traversal pass?
- Should the shared portable Query runtime live under
  `packages/core/modules-sdk/src/remote-query/portable-*`, or should it get a
  new package/entrypoint name to make bundling boundaries clearer?

## Execution Status

### Turn 1 Completed: Query Input Normalization Extraction

Commit:

- This commit (`Extract Query input normalization`)

Status:

- Added `normalizeQueryConfig(...)` under the existing `remote-query` package
  boundary.
- `Query` now delegates `RemoteQueryObjectFromStringResult`,
  `RemoteQueryObjectConfig`, `RemoteJoinerQuery`, and `RemoteQueryInput`
  normalization to that helper.
- Query execution, `RemoteQuery`, `toRemoteQuery`, `query.graph(...)`,
  `query.index(...)`, and Node `MedusaApp` behavior remain unchanged.
- The existing runtime-supported `service` input shape remains isolated in the
  normalizer because the public `RemoteQueryObjectConfig` type still only
  models `entryPoint`.

Validation:

- Focused Remote Query Jest files passed:
  `src/__tests__/remote-query.spec.ts`,
  `src/remote-query/__tests__/to-remote-query.ts`, and
  `src/remote-query/__tests__/query-index.spec.ts`.
- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed.

Next:

- Turn 2 should extract the direct-entrypoint executor from `static-app.ts`
  into shared Query runtime code.

### Turn 2 Completed: Direct Entrypoint Executor Extraction

Commit:

- This commit (`Extract direct Query entrypoint executor`)

Status:

- Added `executeDirectEntrypointQuery(...)` under the existing `remote-query`
  package boundary.
- The executor owns direct entrypoint service lookup, `listAndCount*` method
  dispatch, selected fields, filters, and pagination metadata.
- `static-app.ts` still owns static manifest-to-entrypoint registration and
  direct input readers, but now delegates execution to shared Query runtime
  code.
- `REMOTE_QUERY` direct entrypoint proofs and direct `QUERY.graph(...)` proofs
  keep using the same loaded module services and static joiner aliases.
- Relation traversal, link traversal, `query.index(...)`, and full
  RemoteJoiner behavior remain outside this turn.

Validation:

- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports`
  passed.
- `cmd /c yarn workspace @medusajs/medusa build` passed.

Next:

- Turn 3 should introduce a shared portable Query registration factory so
  `registerStaticRemoteQuery(...)` becomes a compatibility wrapper instead of
  the owner of Query runtime registration.

### Turn 3 Completed: Portable Query Runtime Factory

Commit:

- This commit (`Add portable Query runtime factory`)

Status:

- Added `createPortableQueryRuntime(...)` under the existing `remote-query`
  package boundary.
- The factory returns the Worker-safe `remoteQuery(...)` function and
  `query.graph(...)` service for direct entrypoints.
- The factory owns direct query input validation, direct `QUERY.graph(...)`
  input validation, direct-entrypoint execution dispatch, and graph result
  shaping.
- `registerStaticRemoteQuery(...)` is now a static-manifest compatibility
  wrapper: it derives entries from static joiner aliases and registers the
  shared runtime outputs under the existing container keys.
- Relation traversal, link traversal, `query.index(...)`, `query.gql(...)`,
  and full RemoteJoiner behavior remain outside this turn.

Validation:

- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports`
  passed.
- `cmd /c yarn workspace @medusajs/medusa build` passed.

Next:

- Turn 4 should split Node Query runtime entrypoints from portable Query
  runtime entrypoints so Worker-safe callers can import the portable factory
  without touching the full `RemoteQuery`/RemoteJoiner graph.

### Turn 4 Completed: Node And Portable Query Entrypoint Split

Commit:

- This commit (`Split portable Query runtime entrypoint`)

Status:

- Added explicit `@medusajs/modules-sdk/remote-query/portable` and
  `@medusajs/modules-sdk/remote-query/node` package entrypoints.
- The portable entrypoint exports only the direct-entrypoint executor and
  portable Query runtime factory.
- The node entrypoint keeps the existing Node-oriented `Query` and
  `RemoteQuery` exports available for `MedusaApp` and existing consumers.
- The backward-compatible `remote-query` barrel remains available, but
  Worker-safe code now has a dedicated portable entrypoint that does not
  import the full `RemoteQuery`/RemoteJoiner graph.
- `static-app.ts` now imports its Query runtime pieces through the portable
  entrypoint.
- The Cloudflare portability guard now validates
  `@medusajs/modules-sdk/remote-query/portable` directly.

Validation:

- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- Focused Node Query/Remote Query Jest files passed:
  `src/__tests__/remote-query.spec.ts`,
  `src/remote-query/__tests__/to-remote-query.ts`, and
  `src/remote-query/__tests__/query-index.spec.ts`.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed, including `@medusajs/modules-sdk/remote-query/portable` with 4
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed.

Next:

- Turn 5 should extract Remote Query service fetching into an adapter-safe
  contract/helper shared by the Node `RemoteQuery` path and the portable
  direct-entrypoint runtime.

### Turn 5 Completed: Shared Remote Fetch Data Helper

Commit:

- This commit (`Extract shared Remote Query fetch helper`)

Status:

- Added `remote-fetch-data.ts` under the existing `remote-query` package
  boundary.
- The helper owns method suffix normalization, `list` versus `listAndCount`
  method-name resolution, service method validation, tracing hook execution,
  empty-id behavior, pagination metadata shaping, and large id-array batching.
- The Node `RemoteQuery` class now delegates its service fetch mechanics to
  the shared helper while keeping RemoteJoiner query planning and module
  service lookup in the Node runtime.
- The portable direct-entrypoint runtime now calls the same shared service
  method helper for direct `listAndCount*` execution.
- Added focused helper coverage for method suffix resolution, pagination,
  empty id arrays, batching, and tracing.
- Relation planning, link traversal, `query.index(...)`, and full portable
  RemoteJoiner behavior remain outside this turn.

Validation:

- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- Focused Query and fetch-helper Jest files passed:
  `src/__tests__/remote-query.spec.ts`,
  `src/remote-query/__tests__/to-remote-query.ts`,
  `src/remote-query/__tests__/query-index.spec.ts`, and
  `src/remote-query/__tests__/remote-fetch-data.spec.ts`.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed.

Next:

- Turn 6 should pick the smallest real route that requires relation or link
  traversal and implement only the portable Query behavior needed for that
  route.

### Turn 6 Completed: Store Collection Relation Traversal Proof

Commit:

- This commit (`Prove portable Query relation traversal`)

Status:

- Picked `GET /store/collections/:id` as the smallest real route proof because
  it uses the unchanged Store Collection route and the already-loaded Product
  module service.
- Added shared portable relation derivation for direct entrypoint fields:
  dotted field paths such as `products.id` now derive first-level
  `relations: ["products"]` before calling the real module service.
- Kept the implementation intentionally bounded to first-level direct
  entrypoint relations. Link traversal, multi-service joins, full RemoteJoiner
  planning, and `query.index(...)` remain outside this turn.
- Extended the Cart DO SQLite production HTTP proof to seed a product
  collection through the real Product module service and request
  `fields=id,title,products.id,products.title` through the real Store
  Collection route.
- Extended the workerd checker so the proof fails unless the collection route
  returns the related product.
- Added explicit `medusa-cloudflare` tsconfig path mappings for local
  `@medusajs/modules-sdk` declarations so the app typecheck can resolve the
  shared package entrypoints used by framework source.

Validation:

- `cmd /c yarn workspace @medusajs/modules-sdk test src/remote-query/__tests__/remote-fetch-data.spec.ts --runInBand`
  passed.
- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed, including `@medusajs/modules-sdk/remote-query/portable` with 5
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `git diff --check` passed with only existing LF-to-CRLF warnings.

Next:

- Turn 7 should decide the `query.index(...)` boundary: either connect it to a
  Worker-safe Index service for the smallest route that requires it, or keep it
  unavailable with a clear portable-runtime error until a route proves the
  need.

### Turn 7 Completed: Portable Query Index Boundary

Commit:

- This commit (`Define portable Query index boundary`)

Status:

- Audited real production `query.index(...)` route usage. The only package
  routes that call it directly are:
  - `GET /store/products`
  - `GET /admin/products`
- Both route paths are behind the Index Engine feature flag.
- Node `Query.index(...)` semantics remain unchanged: the Index module first
  returns matching ids, then `query.graph(...)` hydrates the result.
- The portable Worker Query service now exposes an explicit `index(...)`
  method instead of leaving feature-flagged routes to fail with a generic
  missing-method error.
- `createPortableQueryRuntime(...)` accepts an optional portable Index handler.
  When the handler is present, `query.index(...)` delegates to it. When it is
  absent, `query.index(...)` throws a clear adapter-boundary error telling the
  caller to keep Index Engine disabled or register a Worker-safe Index adapter.
- This turn does not wire the Worker Index proof into the production HTTP
  runtime. The existing Worker Index proof remains separate and passing.

Validation:

- `cmd /c yarn workspace @medusajs/modules-sdk test src/remote-query/__tests__/portable-query-runtime.spec.ts src/remote-query/__tests__/query-index.spec.ts --runInBand`
  passed.
- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `cmd /c yarn workspace medusa-cloudflare test:index-sqlite` passed,
  proving the existing DO SQLite and D1 Index proof runtime still works.
- `git diff --check` passed with only LF-to-CRLF warnings.

Next:

- Turn 8 should reduce the remaining static bridge registration shape. The
  bridge should stay a static-manifest wrapper and should not own Query
  behavior.

### Turn 8 Completed: Static Bridge Registration Reduction

Commit:

- This commit (`Move static Query entry mapping into portable runtime`)

Status:

- Moved static joiner-config alias mapping out of `static-app.ts` and into
  the portable Query runtime package.
- Added `createDirectEntrypointQueryEntriesFromJoinerConfigs(...)` so direct
  entrypoint creation is shared Query runtime behavior.
- Added `createPortableQueryRuntimeFromJoinerConfigs(...)` so static callers
  can construct the portable Query runtime from joiner configs without owning
  alias parsing.
- `static-app.ts` now remains responsible for static module loading, service
  collection, and container registration only.
- Runtime behavior remains unchanged: `ContainerRegistrationKeys.REMOTE_QUERY`
  and `ContainerRegistrationKeys.QUERY` still resolve the shared portable
  runtime outputs.

Validation:

- `cmd /c yarn workspace @medusajs/modules-sdk test src/remote-query/__tests__/portable-query-runtime.spec.ts --runInBand`
  passed.
- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `cmd /c yarn workspace @medusajs/modules-sdk test src/remote-query/__tests__/portable-query-runtime.spec.ts src/remote-query/__tests__/remote-fetch-data.spec.ts --runInBand`
  passed.
- `git diff --check` passed with only LF-to-CRLF warnings.

Next:

- Turn 9 should evaluate whether the default Worker HTTP handler can move one
  step away from proof runtime options by comparing production source coverage
  against the proof runtime options.

### Turn 9 Completed: Default Worker HTTP Runtime Evaluation

Commit:

- This commit (`Record default Worker HTTP runtime blocker`)

Status:

- Compared the default Worker HTTP path with the production module-runtime
  proof path.
- The default Worker still uses `staticHttpProofRuntimeOptions` through the
  singleton handler in `cloudflare-http-runtime.ts`.
- The production module-backed HTTP runtime is proven in `CartProofDO` through
  `createMedusaCloudflareHttpModuleRuntimeSource(...)`, but it depends on a
  commerce Durable Object partition because it needs:
  - Durable Object SQLite manager for commerce persistence;
  - Durable Object-backed HTTP auth session store;
  - workflow execution, schedule, and delayed-action stores;
  - Cloudflare locking namespace and queue bindings wired into module options;
  - a default Worker route for selecting a commerce partition before creating
    HTTP runtime options.
- Added `GET /medusa-http-runtime/status` so the blocker is executable and
  machine-checkable instead of only recorded in docs.
- No default handler switch was made in this turn.

Validation:

- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "HTTP runtime status|Cloudflare Worker runtime"`
  passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `git diff --check` passed with only LF-to-CRLF warnings.

Next:

- The next Query-runtime milestone should introduce an intentional Worker
  production HTTP partition route, or move the proven `CartProofDO` production
  HTTP handler behind a non-default top-level route that selects the partition
  explicitly.

### Turn 10 Completed: Non-Default Production HTTP Partition Route

Commit:

- This commit (`Add production HTTP partition route`)

Status:

- Added the non-default top-level Worker route:
  `GET /medusa-http-runtime/partitions/:partition/*`.
- The route resolves the tenant runtime context, derives the existing cart
  partition address, rewrites the request to the Cart DO `http/*` path, and
  forwards it to the selected Durable Object partition.
- `CartProofDO` now exposes a generic `http/*` branch that delegates to the
  existing production Fetch HTTP handler built from
  `createMedusaCloudflareHttpModuleRuntimeSource(...)`.
- This proves explicit partition selection at the top-level Worker boundary
  while keeping the default Worker HTTP handler on
  `staticHttpProofRuntimeOptions`.
- The default runtime status remains blocked for the final default switch
  because this is an intentional non-default route, not global Worker routing.

Validation:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "production HTTP route|HTTP runtime status"`
  passed; Vitest executed the Worker and request-scope files with 22 passing
  tests.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed and
  verified `GET /medusa-http-runtime/partitions/:partition/store/currencies`
  returns real route data from the selected Cart DO module-backed HTTP runtime.

Next:

- Continue shrinking the remaining default-handler blockers one boundary at a
  time. The next useful boundary is promoting a reusable partition-selection
  helper or adding another real route through the same partition path only if
  it exposes new missing runtime behavior.

## Completion Audit

Status:

- Complete for this roadmap's stated scope.
- The temporary static Query bridge in `static-app.ts` has been reduced to a
  static-module wrapper that creates the shared portable Query runtime from
  joiner configs and registers its outputs in the container.
- `REMOTE_QUERY` and `QUERY` registration now comes from
  `createPortableQueryRuntimeFromJoinerConfigs(...)`, which delegates to shared
  portable Query runtime code.
- Direct `REMOTE_QUERY` route behavior is proven by the Cart DO workerd proof
  through `GET /store/currencies`.
- Direct `QUERY.graph(...)` route behavior is proven by the Cart DO workerd
  proof through `GET /store/product-types`.
- First-level relation traversal is proven by the Cart DO workerd proof through
  `GET /store/collections/:id` with `products.id` and `products.title`.
- The non-default top-level production route proves Worker partition selection
  into the same module-backed HTTP runtime through
  `GET /medusa-http-runtime/partitions/:partition/store/currencies`.
- Node Query and Remote Query behavior remains covered by the focused
  modules-sdk Query test suite.
- The default top-level Worker handler still uses proof HTTP options. That is
  outside this Query runtime roadmap's completion criteria and remains tracked
  as a separate HTTP/runtime bootstrap blocker.

Final validation:

- `cmd /c yarn workspace @medusajs/modules-sdk test src/__tests__/remote-query.spec.ts src/remote-query/__tests__/to-remote-query.ts src/remote-query/__tests__/query-index.spec.ts src/remote-query/__tests__/portable-query-runtime.spec.ts src/remote-query/__tests__/remote-fetch-data.spec.ts --runInBand`
  passed.
- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed after the
  modules-sdk build completed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed, including `@medusajs/modules-sdk/static-app` and
  `@medusajs/modules-sdk/remote-query/portable`.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1592
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
