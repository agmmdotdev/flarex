# Medusa Cloudflare Port Refactor Plan

For domain-specific records of fork changes and verified behavior, see
[`fork-changes/README.md`](./fork-changes/README.md).

## Goal

Refactor the Medusa fork into a Cloudflare-native commerce framework while
preserving Medusa's domain models, module contracts, workflows, API behavior,
provider contracts, and useful tests.

This is a bottom-up runtime refactor. We will make foundational packages
portable before building the final Nitro and Cloudflare application runtime.

For the later hosted programmable platform direction, see
[`roadmaps/hosted-programmable-medusa.md`](./roadmaps/hosted-programmable-medusa.md).
That roadmap is intentionally future-facing. It must not displace the current
first milestone: preserving Medusa core behavior while making persistence and
runtime infrastructure Cloudflare-compatible.

## Core Decision

Do not begin with a Nitro application that imports the existing
`@medusajs/framework` root barrel.

The current framework barrel exports Node-oriented database, HTTP, job,
telemetry, CLI, and filesystem behavior. A Cloudflare application importing it
would fail before runtime adapters could help.

Instead:

1. Establish portable package boundaries.
2. Make Medusa DML compile to Drizzle.
3. Replace MikroORM-specific DAL contracts.
4. Migrate modules individually.
5. Replace runtime infrastructure such as discovery, workflows, events, locks,
   and HTTP after the core becomes Worker-importable.

## What We Preserve

- `model.define()` and Medusa DML authoring.
- Domain and module service contracts where practical.
- Core commerce flows and compensation semantics.
- Store and Admin API behavior.
- Provider contracts.
- Existing behavioral and integration tests.

## Target Dependency Direction

```text
portable domain and workflow packages
              |
              v
portable DML, DAL, context, and service contracts
              |
              v
runtime implementations
  - Drizzle/D1
  - Cloudflare Workflows
  - Cloudflare Queues
  - Durable Objects
  - Nitro/H3
```

Portable packages must not import broad runtime barrels.

Preferred:

```ts
import type { IEventBusModuleService } from "@medusajs/types"
import { model } from "@medusajs/dml"
import { createWorkflow } from "@medusajs/workflows-sdk"
```

Avoid:

```ts
import { ... } from "@medusajs/framework"
```

## Proposed Package Direction

Package names remain provisional and should be validated during implementation.

```text
packages/core/
  types/                 portable types
  dml/                   model.define and DmlEntity
  dal/                   portable repository and database contracts
  runtime/               portable container and execution context
  workflows-sdk/         portable workflow definitions

packages/database/
  drizzle/
    schema-compiler/
    repository/
    migrations/
    d1/
    postgres/

packages/platform/
  cloudflare/
    event-bus/
    workflow-engine/
    locking/
    queue-consumer/

packages/framework/
  node/                   transitional Node runtime
  cloudflare/             Cloudflare runtime composition

apps/
  medusa-cloudflare/      final Nitro/Cloudflare application
```

Do not create every package in advance. Add packages only when a concrete
implementation slice requires them.

## Phase 1: Portable Import Boundary

Create an automated Worker portability check.

Portable packages must fail validation when their runtime dependency graph
includes:

- `node:*` imports.
- Express.
- MikroORM.
- PostgreSQL clients.
- Filesystem APIs.
- CLI packages.
- Node-only telemetry.
- `require.resolve`.
- Process and cluster behavior.

Split the current framework exports so portable code can import precise,
Worker-compatible entrypoints without loading Node runtime modules.

Deliverable:

- A small portable package can be bundled for workerd without Node shims.

## Phase 2: DML to Drizzle Compiler

Keep `model.define()` and `DmlEntity` as the source model.

Current path:

```text
model.define
  -> DmlEntity
  -> toMikroORMEntity
  -> MikroORM repository
```

Target transitional path:

```text
model.define
  -> DmlEntity
  -> persistence compiler
       -> Drizzle SQLite schema
       -> MikroORM entity during migration
```

Implement a Drizzle SQLite/D1 compiler that handles:

- Tables and columns.
- Primary keys.
- Nullable and default values.
- Relationships and foreign keys.
- Unique constraints.
- Indexes.
- Check constraints where supported.
- Migration metadata.

Deliverable:

- Representative Medusa DML models compile into valid Drizzle SQLite schemas.

## Phase 3: Portable DAL and Execution Context

Remove MikroORM concepts from portable service and repository contracts.

Current contexts expose concepts such as:

- `manager`.
- `transactionManager`.
- MikroORM `EntityManager`.

Replace them with a portable database session:

```ts
interface DatabaseSession {
  dialect: "sqlite" | "postgres"

  transaction<T>(
    operation: (transaction: DatabaseSession) => Promise<T>
  ): Promise<T>
}
```

Implement Drizzle-backed versions of:

- Base repository behavior.
- Internal service behavior.
- Filters and query translation.
- Pagination.
- Serialization.
- Transactions.
- Soft deletion.

Keep MikroORM implementations available during the transition.

Deliverable:

- One module passes the same repository and service contracts through both
  MikroORM and Drizzle implementations.

## Phase 4: Module-by-Module Migration

Do not replace MikroORM across the entire repository in one change.

Suggested migration order:

1. Store.
2. Currency.
3. Region.
4. Sales Channel.
5. Customer.
6. Product.
7. Pricing.
8. Inventory.
9. Cart.
10. Payment and Order.

For every module:

```text
DML models
  -> Drizzle schema
  -> Drizzle repository
  -> service contract tests
  -> workflow tests
  -> D1 worker-pool tests
  -> remove module MikroORM imports
```

Product should not be the first migration because it contains custom
repositories, significant relationships, event subscribers, and
MikroORM-specific behavior.

Current commerce module status:

- Currency, Cart, Store, Sales Channel, Region, Customer, Product, Stock
  Location, Inventory, Pricing, Tax, and Payment are already composed into the
  Worker commerce module set.
- Pricing passes its unchanged integration suites through Drizzle/SQLite,
  including the existing price calculation assertions.
- Pricing also has a module-owned static manifest and a real price-set plus
  calculation proof inside the Durable Object SQLite Worker module set.
- Tax passes its unchanged integration suites through Drizzle/SQLite and has a
  module-owned static manifest plus a tax-region/default-rate proof inside the
  Durable Object SQLite Worker module set.
- Payment passes its existing integration assertions through Drizzle/SQLite and
  has a module-owned static manifest plus a system-provider payment
  collection/session/authorize/capture proof inside the Durable Object SQLite
  Worker module set.

Next module step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  gate passes.

## Phase 5: Static Registration and Bootstrap

Add explicit static registration or generated build manifests as an
alternative resource resolver for the existing Medusa bootstrap.

Do not remove Node filesystem discovery from the Node runtime. Refactor
`MedusaApp`, `MedusaModule`, and their loaders so Node filesystem resolution
and Worker static manifests feed the same bootstrap and registration logic.

The Worker static resolver must avoid runtime dependencies on:

- Directory scanning.
- Dynamic route and module discovery.
- `__dirname`.
- Process lifecycle.
- Cluster and worker modes.
- HMR loaders.

Deliverable:

- Selected modules and workflows bootstrap inside workerd from a static
  manifest through the shared Medusa bootstrap.
- The Cloudflare app does not manually construct module services,
  repositories, or container registrations.

## Phase 6: Cloudflare Runtime Implementations

Use Medusa's existing service interfaces where possible.

### Event Bus

Implement `IEventBusModuleService` using:

- Transactional outbox records.
- Cloudflare Queues for delivery.
- Idempotent consumers.
- Durable Objects only where ordered or serialized coordination is required.

### Workflow Engine

Implement `IWorkflowEngineService` using Cloudflare Workflows.

Map Medusa workflow semantics to:

- Durable steps.
- Retries and timeouts.
- Stored outputs.
- Native rollback handlers.
- Workflow events.
- Inspection and cancellation.

### Locking

Implement `ILockingModule` using Durable Objects where serialized ownership is
required.

### Jobs

Compile scheduled jobs into Cron Triggers or scheduled Cloudflare Workflows.

## Phase 7: HTTP and Nitro

Add Nitro/H3 for the Worker runtime only after portable imports, persistence,
and runtime services are proven. Preserve Express as the Node HTTP adapter
until a deliberate Node-runtime replacement is separately accepted.

Separate route discovery, middleware composition, route ordering, handler
execution semantics, and error handling from concrete Express registration.
Preserve existing Medusa route handlers and middleware behavior, but do not
make Express middleware itself the portable primitive.

The portable unit is the Medusa HTTP resource model:

- route descriptors;
- middleware descriptors;
- route sorting and matching;
- body-parser intent;
- auth, CORS, publishable-key, locale, policy, and validation intent;
- request context creation;
- response and error semantics.

Concrete runtimes consume that model through adapters:

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

The Express adapter owns:

- Express app registration;
- Express `req`, `res`, and `next`;
- Express body parser middleware;
- Express error middleware;
- session, cookie, logging, and static-file middleware.

Use the Cloudflare adapter for:

- Worker HTTP entrypoints.
- Request context creation.
- Store and Admin routing.
- Validation and response handling.
- Build integration.

Preserve API behavior and migrate handlers progressively. Do not rewrite Store
and Admin handlers into Cloudflare-specific handlers when the HTTP adapter can
run them unchanged. Express remains the Node adapter until equivalent API
assertions pass through the Cloudflare adapter.

HTTP integration validation must reuse the existing integration runners rather
than introducing a parallel Cloudflare-only API suite. Runtime selection belongs
under `@medusajs/test-utils` so existing `integration-tests/http` assertions can
run through either the Express runtime or the Cloudflare-compatible Fetch
runtime. The initial selector is `MEDUSA_TEST_HTTP_RUNTIME`, with Express as
the default.

The current Cloudflare HTTP integration runtime may temporarily use a generated
static HTTP manifest and proof request scope to validate route-by-route Fetch
adapter behavior. That proof scope is not the final runtime. The selector must
converge toward a real Cloudflare Medusa bootstrap that consumes static module,
HTTP, workflow, subscriber, job, provider, and link manifests and resolves real
Medusa services from the Worker container. Keep the package scripts and
existing assertions stable while replacing the implementation behind the
Cloudflare runtime branch.

First HTTP slice:

1. Extract the current `ApiLoader` route/middleware registration behavior into
   a small `HttpRuntimeAdapter` contract.
2. Move the existing Express calls into an `ExpressHttpAdapter`.
3. Keep filesystem discovery and existing Medusa route files unchanged.
4. Verify existing Express API behavior still passes before adding static
   manifests or Cloudflare/Hono/Nitro execution.

## First Implementation Slice

The first implementation work should focus on foundations, not Nitro.

1. Create the portable import guard.
2. Isolate DML exports from MikroORM exports.
3. Implement `DmlEntity -> Drizzle SQLite schema`.
4. Add compiler tests for representative fields, indexes, and relationships.
5. Select the smallest suitable module for the first Drizzle repository and
   service contract migration.

The repository has completed the portable-import portion for the actual
Currency service. The immediate implementation priority is now the Drizzle
Currency persistence path, not further general import-graph cleanup.

Full `Module()` composition and static discovery remain required before the
Drizzle path can run inside workerd/D1, but they must not delay running the
unchanged Currency assertions against Drizzle in Node-based SQLite tests.

## Completion Criteria for the First Module

- The module models compile into Drizzle SQLite tables.
- The module runs against D1 or a D1-compatible test runtime.
- Existing service behavior remains intact.
- Repository and service contract tests pass.
- No MikroORM imports enter the Cloudflare bundle.
- No Node APIs enter the Cloudflare bundle.
- The existing Node/MikroORM implementation remains usable until replacement is
  intentionally completed.

## Working Rules

- Keep the repository working after each migration slice.
- Preserve interfaces before replacing implementations.
- Do not add abstractions without a concrete migration need.
- Do not hide Cloudflare primitives behind incompatible generic APIs.
- Prefer real workerd tests for Cloudflare-specific behavior.
- Use fast fake or SQLite-backed tests for ordinary domain behavior.
- Measure Worker bundle size and startup behavior continuously.
- Remove old implementations only after replacement behavior is covered.

## Current Implementation Status

The repository contains experimental portable DML, DAL, and Drizzle
implementations. These experiments proved that Medusa DML can produce
Drizzle-compatible metadata and that Worker-importable persistence code is
feasible.

- `@medusajs/dml` provides Worker-importable model metadata.
- `@medusajs/dal` provides portable repository, session, mutation, and generated
  internal-service behavior.
- `@medusajs/drizzle` compiles DML models to Drizzle SQLite tables and implements
  the portable repository contract.
- The parallel portable Currency service has been removed.
- `apps/medusa-cloudflare` runs the actual Currency service in workerd/D1
  without Node or MikroORM dependencies.

The removed parallel portable Currency service was not the intended migration
architecture. It risked becoming a second commerce framework whose behavior
would gradually diverge from Medusa. New module migrations must use Medusa's
actual module services and existing test suites.

## Architecture Decision: Refactor Medusa In Place

### Decision

Preserve Medusa's actual module services, DML models, public contracts,
workflows, APIs, and behavioral test suites. Refactor the persistence and
runtime infrastructure underneath them so the same modules can run through
MikroORM or Drizzle adapters.

Do not create side-by-side portable module services as the migration strategy.

The target dependency flow is:

```text
existing Medusa module service
        |
        v
existing MedusaService-generated methods
        |
        v
portable internal-service and repository contracts
        |
        +-- MikroORM adapter
        |
        +-- Drizzle adapter
```

MikroORM remains the default implementation while the refactor is underway.
Each change must preserve the existing MikroORM test path.

### Why

- Existing Medusa behavior and tests remain the specification.
- Reusing actual module services avoids rewriting commerce behavior from
  scratch.
- Running the same assertions against both adapters reveals compatibility gaps.
- Incremental adapter selection keeps the repository usable throughout the
  migration.
- A parallel service hierarchy would be easier initially but would likely
  diverge in behavior, workflows, fixes, and future module development.

### Refactor Boundaries

Business module services should remain unchanged wherever practical. The first
infrastructure boundaries to make adapter-driven are:

- DML model compilation: existing `DmlEntity` to MikroORM entity or Drizzle
  schema.
- Container loading: select repository and connection implementations by
  persistence adapter.
- Generated internal services: remove direct assumptions about MikroORM entity
  managers and event subscribers.
- Repository and transaction context: expose portable sessions rather than
  MikroORM managers.
- Module test runner: initialize, reset, and tear down either MikroORM/Postgres
  or Drizzle/SQLite/D1.

Do not attempt to modularize persistence, events, workflows, HTTP, discovery,
and Cloudflare bootstrap in one change. Complete and validate one vertical
slice at a time.

### Shared Test Requirement

The existing module integration assertions must run unchanged against both
backends. Adapter selection belongs in the runner or test matrix, not inside
duplicated module test suites.

Conceptually:

```ts
moduleIntegrationTestRunner({
  moduleName: Modules.CURRENCY,
  databaseAdapter: "mikroorm",
  testSuite,
})

moduleIntegrationTestRunner({
  moduleName: Modules.CURRENCY,
  databaseAdapter: "drizzle",
  testSuite,
})
```

Adapter-specific tests are still required for behavior outside the shared
module contract, including:

- Drizzle query translation.
- D1 transaction limitations.
- Relationship loading.
- Soft deletion.
- Migration generation.
- workerd import and runtime compatibility.

### First Vertical Slice: Currency

Currency is the first proof because its existing service already consumes
repository and generated internal-service contracts while having a small,
passing integration suite.

Implementation sequence:

1. Treat the experimental parallel Currency service as temporary and stop
   expanding it.
2. Keep `CurrencyModuleService` and its public interface unchanged.
3. Reuse the existing Currency DML model and Drizzle schema compiler.
4. Implement the smallest Drizzle `ModulePersistenceAdapter` needed by the
   standard module loader. Completed for Currency-required behavior.
5. Refactor the existing `MedusaInternalService` persistence operations behind
   the selected adapter only where Currency requires it. Completed for
   Currency-required behavior.
6. Implement a Drizzle/SQLite `ModuleTestPersistenceAdapter`. Completed using
   isolated `node:sqlite` test composition.
7. Parameterize `moduleIntegrationTestRunner` so the unchanged Currency
   assertions run against MikroORM/Postgres and Drizzle/SQLite. Completed:
   both paths pass all 13 unchanged assertions.
8. Separate full module composition from filesystem discovery and verify the
   complete Currency module import graph. Completed as an application-root
   proof; it must now move into the shared static bootstrap.
9. Run the Drizzle-backed Currency module inside workerd/D1. Completed for the
   actual Currency read path.
10. Remove the temporary parallel Currency service after the actual module path
    replaces its proof-of-concept role. Completed in `8a3a0528dc`.

### Immediate Work Order

The first Currency vertical-slice acceptance gate is complete. The next
implementation slice is deliberately narrow:

1. Create a typed, module-owned static Currency manifest. Completed in
   `ed17630e14`. The temporary generated metadata path from `b29b448142` was
   replaced in `fa0d7413c7`: Currency now reuses the precise portable
   `ModulesDefinition` and Medusa joiner-config builder at runtime. Explicit
   resource imports remain module-owned so the Worker graph stays auditable.
2. Make the normal `MedusaModule`/application bootstrap consume the static
   manifest. Completed in `ed17630e14`; the Cloudflare app no longer calls the
   shared static loader directly.
3. Generate D1 migrations from DML instead of hand-authoring the Currency
   schema. Completed in `aa62992840`. The current generator owns a deterministic
   baseline. In `b7f8ead739`, migration selection became adapter-driven and
   Currency became the owner of its Drizzle SQLite baseline while the
   Cloudflare app aggregates it for Wrangler. Schema-diff generation and
   target-specific Drizzle runners remain required before deployed upgrades.
4. Add real D1 mutation and transaction coverage required by the next unchanged
   Medusa assertions. Read/create/update and explicit transaction capabilities
   are covered in `c3a0cc5052`. Delete and adapter-driven manual mutation event
   dispatch are covered in `3d28423c76`. Relationless soft delete and restore
   are covered in `60111e27db`. Portable relationship and cascade metadata is
   preserved by the Drizzle compiler in `5d7b24f84e`. Physical single-column
   foreign-key schema generation is covered in `454485fce7`. Top-level
   FK-backed `belongsTo`, `hasOneWithFK`, and `hasMany` relationship loading is
   covered in `05c71d50cd`. Recursive FK-backed soft-delete and restore
   cascades are covered in `98630cf21c`. Nested FK-backed populate paths are
   covered in `7982edd95f`. Explicit pivotEntity-backed many-to-many loading
   is covered in `bd97a1111b`. Implicit pivotTable generation/loading is
   covered in `fd2ce8dc15`. Root-model composite primary-key rendering and
   repository mutations are covered in `841eee6eb6`. Composite foreign-key
   schema generation is covered in `2f280945ec`. Composite-key relationship
   loading and soft-delete/restore cascades are covered in `de4a59e938`.
   Composite implicit and explicit many-to-many pivot schema/loading is covered
   in `e61c6ff640`. Flat root create/partial update and existing-target implicit
   many-to-many attach/replace/detach through `upsertWithReplace` are covered
   in `84a70461c7`. FK-backed one-to-many creation, reassignment, replacement,
   and deletion through `upsertWithReplace` are covered in `09fcf66af5`.
   Existing-target explicit pivot-entity attach/replace/detach through
   `upsertWithReplace` is covered in `2d7d98d157`.
   Deeper nested relation replacement, implicit many-to-many nested target
   creation, ORM-managed mutation-event parity, schema-diff upgrade migrations,
   and D1 multi-statement atomicity still need implementation.
5. Prove the authoritative Durable Object SQLite topology before expanding
   relational edge-case parity or selecting another module. Completed for the
   prototype:
   - `@medusajs/drizzle-cloudflare` adapts `DurableObjectStorage.sql` without
     adding Cloudflare imports to shared portable barrels.
   - The existing Currency DML schema compiler and Drizzle repository execute
     inside a real SQLite-backed Durable Object.
   - The focused workerd proof confirms repository create/read behavior,
     read-your-own-writes, nested manager callbacks, and multi-write rollback.
   - The root manager runs the existing async Medusa transaction callback
     inside `DurableObjectStorage.transaction`. Drizzle batch execution still
     uses `transactionSync`.
   - The earlier `object-serialized` result was caused by not using the async
     Durable Object storage transaction API. A staged statement executor is
     not required for the current repository contract.
6. Run the actual Currency module service through the atomic DO manager.
   Completed:
   - D1 and Durable Object compositions reuse the same manager-driven static
     `MedusaModule.bootstrap` helper.
   - `CurrencyProofDO` no longer constructs or calls a repository directly.
   - The focused workerd proof performs service-level create/list/delete,
     transaction-context propagation, nested callbacks, and rollback.
7. Keep the atomic manager generic and validate shared Drizzle behavior through
   the unchanged Cart module integration suite. In the first Cart compatibility
   slice, BigNumber persistence, FK-safe test cleanup, and direct/nested
   owner-side `belongsTo` filters improved the unchanged suite from 2/63 to
   54/63 passing assertions.
8. Complete the remaining Cart compatibility slices before adding Cart-specific
   Durable Object composition. Required DML property validation with existing
   Medusa error semantics improved the unchanged Cart suite from 54/63 to
   57/63 passing assertions. Owner-side singular relation creation then made
   nested billing and shipping addresses pass, bringing the suite to 58/63.
   DML check-constraint rendering and check-failure error naming brought the
   suite to 59/63. Sparse upsert owner-FK preservation fixed adjustment and
   tax-line replacement, bringing the suite to 62/63. Explicit empty field
   selection now preserves primary-key identity without leaking unrelated
   scalar columns, so Cart totals parity passes and the unchanged Cart suite is
   63/63 through Drizzle/SQLite.
9. After the shared unchanged Cart suite passes, use the atomic DO SQLite
   manager for the first real aggregate vertical slice. Keep D1 as
   projection/query storage rather than authoritative active-cart storage.
   Completed:
   - `CartProofDO` compiles the real Cart DML models into Durable Object
     SQLite and bootstraps the actual Cart module service through the shared
     Drizzle manager path.
   - The proof creates a cart, line item, and shipping method, retrieves totals,
     and verifies atomic rollback through Cart service transaction context.
   - Cart's package-local aliases were made relative so Cart can coexist with
     Currency in the same Worker bundle.
   - The proof uses an app-local framework utility shim. Its minimal totals
     decorator is intentionally not the final shared totals portability answer.
10. Remove the proof-only totals limitation by making the shared Medusa totals
    helper portable. Completed in
    `bfb62a9791 feat: make Cart totals portable in Worker`:
    - The app-local Cart totals decorator has been removed from
      `apps/medusa-cloudflare`.
    - `CartProofDO` now imports real `decorateCartTotals` and
      `createRawPropertiesFromBigNumber` behavior through portable
      `@medusajs/utils/totals/*` entry points.
    - Shared totals files use type-only DTO imports and leaf common utility
      imports to avoid dragging broad utility barrels into the Worker graph.
    - Expand the Cart DO proof only with a future operation that adds new
      evidence beyond the unchanged Cart suite.
11. Reduce the app-local `@medusajs/framework/utils` proof shim by moving
    already-portable helpers back to shared leaf entry points. Completed in
    `b4a47bb899 refactor: shrink Cloudflare framework utility shim`:
    - Common helpers, ID generation, and module-sdk context/transaction
      decorators are now re-exported from precise `@medusajs/utils` subpaths.
    - `generateEntityId` no longer imports `ulid` because that package pulls
      Node `crypto` into the Worker bundle; the shared helper now uses Web
      Crypto directly.
    - Keep the no-op `EmitEvents` boundary local until the event aggregator and
      event bus path are intentionally ported. The decorator itself is proven
      portable in step 15; event bus service composition remains a later slice.
    - Keep `ModulesSdkUtils` local until its real package entry point has a
      proven Worker-safe import graph. The full upstream namespace is not
      Worker-safe, so a portable subset is moved in step 13.
12. Move the app-local `MedusaError` copy back to the real shared Medusa error
    implementation. Completed in
    `da024ab2a3 refactor: use shared Medusa error in Worker`:
    - `@medusajs/utils/common/errors` is now a precise Worker-safe package
      export.
    - The app-local framework utility shim re-exports `MedusaError`,
      `MedusaErrorTypes`, and `MedusaErrorCodes` from that shared leaf.
    - The remaining shim surface is `ModulesSdkUtils` and no-op `EmitEvents`.
13. Move the app-local `ModulesSdkUtils` subset to a shared Worker-safe module
    SDK leaf. Completed in
    `dfd4636e30 refactor: move ModulesSdkUtils to portable leaf`:
    - `@medusajs/utils/modules-sdk/portable` exports the current proven
      `ModulesSdkUtils.MedusaService` surface without importing the full
      `modules-sdk` barrel.
    - The full upstream `ModulesSdkUtils` namespace remains Node-oriented and
      must not enter the Worker import graph.
    - The only remaining app-local framework utility behavior is no-op
      `EmitEvents`.
14. Rename the portable module SDK subset to the stable additive portable
    entrypoint and guard it directly. Completed in
    `42589ca0d3 refactor: rename module sdk portable entrypoint`:
    - `@medusajs/utils/modules-sdk/portable` replaces the temporary
      `portable-utils` name.
    - `medusa-cloudflare check:portable-entrypoints` bundles portable
      entrypoints directly and rejects broad barrels or Node-only imports.
    - Do not change root barrels yet; add portable surfaces only as each
      implementation slice proves them.
15. Move the app-local no-op `EmitEvents` boundary to the real shared Medusa
    decorator. Completed in
    `54d675300c refactor: use shared EmitEvents in Worker`:
    - `@medusajs/utils/modules-sdk/decorators/emit-events` is now a precise
      package export and direct portable-entrypoint guard target.
    - The Cloudflare framework utility shim re-exports the real decorator.
    - The shim now has no local runtime implementation; it is only a
      composition alias for shared leaves.
    - Event bus service composition is still not solved here. The inherited
      `emitEvents_` path returns when no event bus module service is configured.
16. Expand the Cart Durable Object SQLite proof with one deeper aggregate
    mutation path. Completed in
    `2e5ede30d2 test: expand Cart DO aggregate proof`:
    - `CartProofDO` now sets line item adjustments, line item tax lines,
      shipping method adjustments, and shipping method tax lines through the
      actual Cart service.
    - The proof checks discount-before-tax totals semantics in workerd with a
      final total of `319`.
    - Atomic rollback remains part of the same Cart service proof.
17. Deduplicate the current app-local static module runtime composition.
    Completed in
    `2c3633e5c8 refactor: share static module runtime composition`:
    - Currency and Cart proof modules now share one app-local
      `createStaticModuleRuntime` helper for logger/container setup, Drizzle
      adapter injection, and `MedusaModule.bootstrap`.
    - The helper is not the final platform runtime; it only keeps the current
      Worker proof thin while the shared Medusa bootstrap/static manifest path
      continues to mature.
    - Module services, DML models, repositories, routes, events, and workflows
      remain unchanged.
18. Move reusable static manifest application bootstrap into modules-sdk.
    Completed in
    `0f57972467 refactor: add shared static app loader`:
    - `@medusajs/modules-sdk/static-app` exposes `loadStaticModule`, a precise
      Worker-safe entrypoint that creates or reuses a shared container,
      registers a logger, assembles the internal declaration, and calls the
      existing `MedusaModule.bootstrap` path with explicit static resources.
    - The Cloudflare app still selects the concrete Drizzle adapter and
      manager at the root. The shared entrypoint does not import Drizzle,
      MikroORM, PostgreSQL, filesystem discovery, Express, or the
      Node-oriented modules-sdk root.
    - Currency and Cart proof modules continue to use the actual module
      services and static manifests; no module behavior changed.
19. Add a static module set loader for commerce-module manifest aggregation.
    Completed in `0207511790 refactor: load static module sets`:
    - `@medusajs/modules-sdk/static-app` now exposes `loadStaticModules`,
      which loads multiple explicit static manifests through
      `MedusaModule.bootstrapAll` into one shared container.
    - This is the foundation for all commerce modules to be selected as a
      static manifest set by the Worker app while shared Medusa packages own
      bootstrap and service resolution.
    - The dynamic service map is intentionally keyed by module key until a
      generated manifest type can provide stronger compile-time service
      mapping.
20. Add the first app-level static commerce module set. Completed in
    `8083f796f4 refactor: compose commerce module set in Cart proof`:
    - `apps/medusa-cloudflare/src/commerce-modules.ts` defines a Currency +
      Cart static manifest set and loads it through `loadStaticModules`.
    - `CartProofDO` now compiles the combined Currency + Cart DML schema and
      uses the Cart service returned by the commerce module set runtime.
    - This proves the Worker app can select a module set while shared
      modules-sdk bootstrap owns module registration and service resolution.
21. Prepare Store for static composition. Completed in
    `34d8e1ce9d feat: add Store static manifest`:
    - `@medusajs/store/static-manifest` now exposes Store's module definition,
      service, DML models, and portable joiner config.
22. Validate Store through the shared Drizzle repository path. Completed in
    `baddfc312a fix: handle generated root ids in Drizzle replace upsert`:
    - The unchanged Store integration suite passes 12/12 through
      Drizzle/SQLite.
    - The shared Drizzle `upsertWithReplace` path now handles generated root
      IDs before replacing FK-backed child relations.
    - Store module services, DML models, public contracts, and integration
      assertions remain unchanged.
23. Add Store to the Worker commerce module set. Completed in
    `ca26a59e7f feat: compose Store in Worker commerce module set`:
    - Currency, Cart, and Store static manifests are composed through the
      shared static module set loader.
    - The combined DML schema is initialized in the Durable Object SQLite
      proof.
    - The proof creates and lists a real Store with supported currencies and
      locales, then runs the existing Cart aggregate totals and rollback
      checks from the same module set.
    - Store services, DML models, public contracts, workflows, and app-local
      behavior remain unchanged.
24. Select the next commerce module only after its unchanged integration suite
    passes through Drizzle/SQLite. Completed for Sales Channel in
    `e8d7010cd9 feat: compose Sales Channel in Worker module set`:
    - Sales Channel's unchanged integration suite passes 14/14 through
      Drizzle/SQLite.
    - `@medusajs/sales-channel/static-manifest` exposes its module definition,
      service, DML model, and DML-derived portable joiner config.
    - Currency, Cart, Store, and Sales Channel static manifests are composed
      through the shared static module set loader.
    - The Durable Object SQLite proof creates and lists a Sales Channel before
      running the Store and Cart checks from the same module set.
    - Sales Channel services, DML models, public contracts, workflows, and
      app-local behavior remain unchanged.
25. Add Region to the Worker commerce module set. Completed in
    `38d364dc12 feat: compose Region in Worker module set`:
    - Region's unchanged integration suite passes 18/18 through
      Drizzle/SQLite.
    - `@medusajs/region/static-manifest` exposes its module definition,
      service, DML models, real default country loader, and DML-derived
      portable joiner config.
    - Currency, Cart, Store, Sales Channel, and Region static manifests are
      composed through the shared static module set loader.
    - The Durable Object SQLite proof runs Region's default country loader and
      creates/lists a Region with a country before running the Sales Channel,
      Store, and Cart checks from the same module set.
    - Region services, DML models, public contracts, workflows, and app-local
      behavior remain unchanged.
26. Add Customer to the Worker commerce module set. Completed in
    `5952a88a43 feat: compose Customer in Worker module set`:
    - Customer's unchanged integration suite passes 47/47 through
      Drizzle/SQLite.
    - The shared Drizzle repository now handles Customer-required partial
      unique-index duplicate messages, direct many-to-many filters, and
      hard-delete detach cleanup through compiled DML metadata.
    - `@medusajs/customer/static-manifest` exposes its module definition,
      service, DML models, and DML-derived portable joiner config.
    - Currency, Cart, Store, Sales Channel, Region, and Customer static
      manifests are composed through the shared static module set loader.
    - The Durable Object SQLite proof creates a Customer, address, and Customer
      group, lists by group relation, and then runs the Region, Sales Channel,
      Store, and Cart checks from the same module set.
    - Customer services, DML models, public contracts, workflows, and
      app-local behavior remain unchanged.
27. Validate Product through the shared Drizzle repository path. Completed in
    `d0c28904e7 feat: pass Product module Drizzle gate`:
    - The Product integration slice passes 205 existing assertions through
      Drizzle/SQLite, with the same 1 skipped assertion as the original suite.
    - The shared Drizzle repository now covers Product-required nested
      replace-upsert behavior, relation wildcard population, has-many relation
      filters, free-text filters, relation ordering, nullable to-one relation
      materialization, and Medusa-style missing-relationship messages.
    - Product's module service keeps the real service path and uses the
      existing DML/repository boundary; no app-local Product service or
      replacement assertion suite was introduced.
28. Add Product to the Worker commerce module set. Completed in
    `dc9d40d051 feat: compose Product in Worker module set`:
    - `@medusajs/product/static-manifest` exposes Product's module
      definition, service, DML models, and explicit portable joiner config.
    - Currency, Cart, Store, Sales Channel, Region, Customer, and Product
      static manifests are composed through the shared static module set
      loader.
    - The Durable Object SQLite proof creates and lists a real Product before
      running the Customer, Region, Sales Channel, Store, Cart totals, and
      rollback checks from the same module set.
    - Product's Worker graph required narrowing package-local aliases and
      type-only imports in the actual Product service path; no app-local
      Product service was introduced.
    - Cart totals now explicitly request relation scalar fields needed by the
      Drizzle projection path before decorating totals.
29. Select the next commerce module only after its unchanged integration suite
    passes through Drizzle/SQLite. Completed for Stock Location in
    `fa67290f87 feat: compose Stock Location in Worker module set`:
    - Stock Location's unchanged integration suite passes 8/8 through
      Drizzle/SQLite.
    - The shared Drizzle repository now handles owner-side nullable to-one
      relation creation during update.
    - `@medusajs/stock-location/static-manifest` exposes Stock Location's
      module definition, service, DML models, and portable joiner config.
    - Currency, Cart, Store, Sales Channel, Region, Customer, Product, and
      Stock Location static manifests are composed through the shared static
      module set loader.
    - The Durable Object SQLite proof creates and lists a Stock Location with
      an address before running the Product, Customer, Region, Sales Channel,
      Store, and Cart checks from the same module set.
    - Stock Location services, DML models, public contracts, workflows, and
      app-local behavior remain unchanged.
30. Select the next commerce module only after its unchanged integration suite
    passes through Drizzle/SQLite. Completed for Inventory in the current
    Inventory Drizzle gate change set:
    - Inventory's unchanged integration suite passes 35/35 through
      Drizzle/SQLite.
    - The shared Drizzle repository now covers Inventory computed quantity
      projections, InventoryLevel aggregate repository methods, Inventory
      reservation-item event source fallback, and primary-key `$or` selector
      order preservation for bulk update behavior.
    - Inventory services, DML models, public contracts, workflows, and
      app-local behavior remain unchanged.
31. Add Inventory to the Worker commerce module set. Completed in
    `0820f155ff feat: compose Inventory in Worker module set`:
    - `@medusajs/inventory/static-manifest` exposes the actual Inventory
      module definition, service, DML models, and portable joiner config.
    - Inventory's real service path is composed through the shared static
      module set loader with Currency, Cart, Store, Sales Channel, Region,
      Customer, Product, and Stock Location.
    - Import-graph blockers were limited to package-local import narrowing,
      isolating MikroORM hook application behind a Node-only optional require,
      and exposing the existing `MedusaInternalService` and `MathBN` helpers
      through precise portable utility entrypoints.
    - The Durable Object SQLite proof creates and lists a real Inventory item
      and Inventory level before running Cart totals and rollback checks from
      the same module set.
32. Select the next commerce module only after its unchanged integration suite
    passes through Drizzle/SQLite. Completed for Pricing in
    `9b50b20223 feat: pass Pricing module Drizzle gate`:
    - Pricing's unchanged integration suites pass 126/126 through
      Drizzle/SQLite, including the existing price calculation assertions.
    - The shared Drizzle adapter supplies the existing named
      `pricingRepository` contract without replacing `PricingModuleService`.
    - Pricing services, DML models, public contracts, workflows, and app-local
      behavior remain unchanged.
33. Add Pricing to the Worker commerce module set. Completed in
    `4c28877ab5 feat: compose Pricing in Worker module set`:
    - `@medusajs/pricing/static-manifest` exposes Pricing's module
      definition, service, DML models, placeholder custom repository
      registration, and portable joiner config.
    - Pricing's real service path is composed through the shared static module
      set loader with Currency, Cart, Store, Sales Channel, Region, Customer,
      Product, Stock Location, and Inventory.
    - The Durable Object SQLite proof creates a real price set and calculates
      a USD price before running Cart totals and rollback checks from the same
      module set.
34. Select the next commerce module only after its unchanged integration suite
    passes through Drizzle/SQLite. Completed for Tax in
    `eea4119aaa feat: pass Tax module Drizzle gate`:
    - Tax's unchanged integration suites pass 35/35 through Drizzle/SQLite.
    - The shared Drizzle SQLite table builder now preserves partial index
      predicates for runtime tables, and the unique-index prevalidation parser
      handles boolean predicates with whitespace such as
      `is_default = true`.
    - `TaxModuleService.createTaxRegions_` now marks its shared context
      parameter with `@MedusaContext`, matching the transaction decorator
      contract.
    - Tax services, DML models, public contracts, workflows, and app-local
      behavior remain unchanged.
35. Add Tax to the Worker commerce module set. Completed in
    `ccdeb4a6e1 feat: compose Tax in Worker module set`:
    - `@medusajs/tax/static-manifest` exposes Tax's module definition,
      service, DML models, `TaxProviderService`, and portable joiner config.
    - Tax's real service path is composed through the shared static module set
      loader with Currency, Cart, Store, Sales Channel, Region, Customer,
      Product, Stock Location, Inventory, and Pricing.
    - The provider loader remains out of the Worker manifest for now because
      provider discovery is a separate portability boundary.
    - The Durable Object SQLite proof creates a real Tax region with a default
      tax rate before running Cart totals and rollback checks from the same
      module set.
36. Add Payment to the Worker commerce module set. Completed in
    `229151bd4e feat: compose Payment in Worker module set`:
    - `@medusajs/payment/static-manifest` exposes Payment's module definition,
      service, DML models, `PaymentProviderService`, and original joiner config
      with explicit models.
    - Payment's real service path is composed through the shared static module
      set loader with Currency, Cart, Store, Sales Channel, Region, Customer,
      Product, Stock Location, Inventory, Pricing, and Tax.
    - The Worker static manifest registers only the built-in
      `pp_system_default` provider. External provider and cloud provider
      discovery remain a separate portability boundary.
    - The Durable Object SQLite proof creates a payment collection, creates
      and authorizes a session, captures the payment, and then runs Cart totals
      and rollback checks from the same module set.
37. Validate Order through the shared Drizzle repository path. Completed in
    the current uncommitted change set:
    - The unchanged `order-items-shipping.spec.ts` suite passes 56/56
      through Drizzle/SQLite with the real Order module services.
    - The unchanged `order-return.spec.ts` suite passes 2/2 through
      Drizzle/SQLite with the real Order module services.
    - The unchanged `order-exchange.spec.ts` suite passes 1/1 through
      Drizzle/SQLite with the real Order module services.
    - The unchanged `order-claim.spec.ts` suite passes 1/1 through
      Drizzle/SQLite with the real Order module services.
    - `create-order.spec.ts` and `delete-order.spec.ts` no longer request
      `MikroOrmWrapper`; their setup checks use the existing Order service and
      generated list APIs.
    - The full existing Order integration suite passes 9 suites and 77 tests
      through Drizzle/SQLite.
    - The shared Drizzle adapter now covers the Order-required create graph,
      wrapper relation, owned relation, context inheritance, delete cleanup,
      default ordering, field-derived relation loading, terminal relation row
      projection, versioned Order has-many behavior, related-entity
      versioned shipping-method filtering, virtual `detail`
      filtering/population, and Order display-id ordering compatibility.
    - Do not add Order to the Worker commerce module set until its static
      manifest and package import graph are audited for Node-only dependencies.
38. Add Order to the Worker commerce module set. Completed in the current
    uncommitted change set:
    - `@medusajs/order/static-manifest` exposes Order's module definition,
      service, DML models, custom `OrderService`, and portable joiner config.
    - Order's real service path is composed through the shared static module
      set loader with Currency, Cart, Store, Sales Channel, Region, Customer,
      Product, Stock Location, Inventory, Pricing, Tax, and Payment.
    - Order's MikroORM lifecycle hook registration is isolated behind an
      optional Node-only loader, so the Worker import graph does not statically
      include MikroORM.
    - Order source files entering the Worker graph now avoid unscoped local
      aliases and type-only framework imports at runtime.
    - The Durable Object SQLite proof creates and retrieves an Order with
      addresses, one item, one shipping method, and one transaction before
      running Cart totals and rollback checks from the same module set.
    - Validation passed: Order build, Order static manifest test, full Order
      Drizzle integration suite, Cloudflare app typecheck, import guard with
      587 bundled inputs, portable entrypoint guard, production Worker build,
      and the Order-inclusive workerd Durable Object SQLite proof.
39. Validate API Key through the shared Drizzle repository path. Completed in
    the current uncommitted change set:
    - The unchanged API Key integration suite passes 25/25 through
      Drizzle/SQLite with the real API Key module service.
    - The shared Drizzle adapter now covers API Key's null equality and
      inequality filters with SQL `IS NULL`/`IS NOT NULL`, including inside
      `$or` filters.
    - The shared Drizzle adapter now coerces custom date-like filter fields
      such as `revoked_at`, preserving revoke/authenticate query behavior.
    - API Key's create/update return shaping was adjusted only where needed to
      preserve the existing public response assertions on the Drizzle path.
    - API Key services, DML model, public contracts, and app-local behavior
      remain unchanged.
40. Add API Key to the Worker commerce module set. Completed in the current
    uncommitted change set:
    - `@medusajs/api-key/static-manifest` exposes API Key's module definition,
      service, DML model, and portable joiner config.
    - API Key's real service path is composed through the shared static module
      set loader with Currency, Cart, Store, Sales Channel, Region, Customer,
      Product, Stock Location, Inventory, Pricing, Tax, Payment, and Order.
    - Node crypto and util static imports were removed from the Worker graph.
      Node still uses Node crypto for existing secret-key scrypt behavior,
      while Worker publishable-key generation uses Web Crypto random bytes.
    - Secret API key generation/authentication remains a future Worker crypto
      adapter or versioned KDF boundary; this proof validates publishable keys.
    - The Durable Object SQLite proof creates and lists a publishable API key
      before running the existing commerce module-set proof.
    - Validation passed: API Key build, API Key static manifest test, API Key
      Drizzle integration suite, Cloudflare app typecheck, import guard with
      595 bundled inputs, portable entrypoint guard, production Worker build,
      app tests, and the API Key-inclusive workerd Durable Object SQLite proof.
41. Validate Fulfillment through the shared Drizzle repository path. Completed
    in the current uncommitted change set:
    - The unchanged Fulfillment integration suite passes 75/75 through
      Drizzle/SQLite with the real Fulfillment module service.
    - The shared portable DAL now generates Medusa-style prefix plus
      ULID-shaped ids instead of UUID-shaped ids for DML id defaults.
    - The shared Drizzle adapter now covers Fulfillment-required owned to-one
      create events, FK-backed `hasMany` replacement during plain update,
      collection-only update event parity, retained-child no-op handling, and
      Fulfillment-owned fallback event names.
    - `FulfillmentModuleService.updateShippingOptionTypes_` now propagates the
      Medusa shared context through its transaction decorator.
    - `fulfillment-module-service/index.spec.ts` no longer requests
      `MikroOrmWrapper` during Drizzle suite setup.
    - Fulfillment services, DML models, provider contracts, public contracts,
      workflows, and app-local behavior remain unchanged.
42. Add Fulfillment to the Worker commerce module set. Completed in the
    current uncommitted change set:
    - `@medusajs/fulfillment/static-manifest` exposes Fulfillment's module
      definition, service, DML models, `FulfillmentProviderService`, and
      original joiner config.
    - Fulfillment's real service path is composed through the shared static
      module set loader with Currency, Cart, Store, Sales Channel, Region,
      Customer, Product, Stock Location, Inventory, Pricing, Tax, Payment,
      Order, and API Key.
    - Fulfillment's dynamic provider loader remains out of the Worker manifest
      for now because external provider discovery and provider action
      execution are separate portability boundaries.
    - Fulfillment source files entering the Worker graph now avoid unscoped
      local aliases and type-only framework imports at runtime.
    - The Worker-safe utility path avoids the broad Fulfillment event import
      graph and the `node:util` dependency from `deepCopy`.
    - The Durable Object SQLite proof creates a Fulfillment provider row,
      fulfillment set, service zone, geo zone, shipping profile, and shipping
      option before running Cart totals and rollback checks from the same
      module set.
    - Validation passed: utils build, Fulfillment build, Fulfillment static
      manifest test, Fulfillment Drizzle integration suite, Cloudflare app
      typecheck, import guard with 623 bundled inputs, portable entrypoint
      guard, production Worker build, app tests, and the Fulfillment-inclusive
      workerd Durable Object SQLite proof.
43. Pick the next commerce module by first running its unchanged integration
    suite through Drizzle/SQLite, then add Worker composition only after that
    gate passes.
44. Validate Promotion through the shared Drizzle repository path. Completed in
    the current uncommitted change set:
    - The existing Promotion integration suite passes 178/178 through
      Drizzle/SQLite with the real Promotion module service.
    - Promotion test setup no longer depends on `MikroOrmWrapper` when running
      the Drizzle persistence adapter; setup uses the real service APIs.
    - Promotion DML now explicitly names application-method rule pivot columns
      to match the original MikroORM migration schema.
    - Promotion preserves the original default relation behavior for
      `application_method` and campaign `budget` while still respecting
      explicit field projections.
    - The compute-action prefilter no longer assumes a MikroORM
      `manager.getKnex()` boundary when running on Drizzle.
    - The shared Drizzle adapter now handles Promotion-required raw filter
      keys, reverse-owned `hasOne` hydration, restore-time unique validation,
      and existence-checked keyed nested `hasMany` linking.
    - Validation passed: Drizzle build, Promotion build, focused Drizzle
      Medusa repository spec with 44 passing, and the existing Promotion
      integration suite with 6 suites and 178 passing.
45. Add Promotion to the Worker commerce module set. Completed in the current
    uncommitted change set:
    - `@medusajs/promotion/static-manifest` exposes Promotion's module
      definition, service, DML models, and portable joiner config.
    - Promotion's real service path is composed through the shared static
      module set loader with Currency, Cart, Store, Sales Channel, Region,
      Customer, Product, Stock Location, Inventory, Pricing, Tax, Payment,
      Order, API Key, and Fulfillment.
    - Promotion source files that enter the Worker graph now use relative
      imports instead of package-local aliases.
    - The Worker app aliases the MikroORM `raw()` helper used by Promotion's
      prefilter to a narrow raw-filter shim. This keeps the existing raw filter
      SQL key shape for the Drizzle repository without bundling MikroORM.
    - The Durable Object SQLite proof creates and lists a real Promotion with
      an application method before running Cart totals and rollback checks
      from the same module set.
    - Validation passed: Promotion build, Promotion static manifest test,
      Promotion Drizzle integration suite with 6 suites and 178 tests,
      Cloudflare app typecheck, import guard with 655 bundled inputs,
      portable entrypoint guard, production Worker build at 1,361.70 kB,
      Cloudflare app tests with 2 passing, and the Promotion-inclusive workerd
      Durable Object SQLite proof.
46. Pick the next commerce module by first running its unchanged integration
    suite through Drizzle/SQLite, then add Worker composition only after that
    gate passes.
47. Validate User through the shared Drizzle repository path. Completed in the
    current uncommitted change set:
    - The existing User integration suite passes 28/28 through Drizzle/SQLite
      with the real User module service.
    - The shared Drizzle mutation event mapper preserves Medusa's original
      User module event source for Invite mutations by emitting Invite events
      under the `user` source.
    - User invite-token creation and validation no longer statically import
      `jsonwebtoken` or Node crypto in the Worker-entered source path. The
      module uses a small Web Crypto JWT helper for HS256/HS384/HS512 signing
      and verification while preserving the existing service contract.
    - User services, DML models, public contracts, and module integration
      assertions remain unchanged as the behavioral specification.
    - Validation passed: Drizzle build, User build, and the existing User
      integration suite with 2 suites and 28 passing tests.
48. Add User to the Worker commerce module set. Completed in the current
    uncommitted change set:
    - `@medusajs/user/static-manifest` exposes User's module definition,
      service, DML models, and portable joiner config.
    - User's real service path is composed through the shared static module set
      loader with Currency, Cart, Store, Sales Channel, Region, Customer,
      Product, Stock Location, Inventory, Pricing, Tax, Payment, Order, API
      Key, Fulfillment, and Promotion.
    - Static module loading now preserves per-module `moduleOptions` while
      adding the shared Drizzle manager, so modules such as User keep Medusa's
      existing runtime option semantics.
    - User source files entering the Worker graph avoid package-local aliases
      and mark framework type imports as type-only to keep type barrels out of
      the production bundle.
    - The Durable Object SQLite proof creates a User, creates an Invite, and
      validates the invite token before running Cart totals and rollback
      checks from the same module set.
    - Validation passed: User build, User static manifest test, User Drizzle
      integration suite, Cloudflare app typecheck, import guard with 664
      bundled inputs, portable entrypoint guard, production Worker build at
      1,377.88 kB, Cloudflare app tests with 2 passing, and the
      User-inclusive workerd Durable Object SQLite proof.
49. Pick the next commerce module by first running its unchanged integration
    suite through Drizzle/SQLite, then add Worker composition only after that
    gate passes.
50. Validate Auth through the shared Drizzle repository path. Completed in
    `488e502b79 Add Auth to Cloudflare commerce module set`:
    - The existing Auth integration suite passes 36/36 through Drizzle/SQLite
      with the real Auth module service.
    - Auth source files entering the Worker graph now avoid package-local
      aliases and mark framework type imports as type-only.
    - Auth services, DML models, public contracts, and module integration
      assertions remain unchanged as the behavioral specification.
    - Validation passed: Auth build and the existing Auth integration suite
      with 3 suites and 36 passing tests.
51. Add Auth to the Worker commerce module set. Completed in
    `488e502b79 Add Auth to Cloudflare commerce module set`:
    - `@medusajs/auth/static-manifest` exposes Auth's module definition,
      service, DML models, internal `AuthProviderService`, and original joiner
      config.
    - Auth's real service path is composed through the shared static module set
      loader with Currency, Cart, Store, Sales Channel, Region, Customer,
      Product, Stock Location, Inventory, Pricing, Tax, Payment, Order, API
      Key, Fulfillment, Promotion, and User.
    - The static Auth manifest intentionally omits dynamic provider loaders.
      Provider discovery and provider execution remain a later runtime
      boundary.
    - The Durable Object SQLite proof creates an Auth identity with a provider
      identity and lists it with the provider relation before running Cart
      totals and rollback checks from the same module set.
    - Validation passed: Auth build, Auth static manifest test, Auth Drizzle
      integration suite, Cloudflare app typecheck, import guard with 673
      bundled inputs, portable entrypoint guard, production Worker build at
      1,388.74 kB, Cloudflare app tests with 2 passing, and the
      Auth-inclusive workerd Durable Object SQLite proof.
52. Pick the next commerce module by first running its unchanged integration
    suite through Drizzle/SQLite, then add Worker composition only after that
    gate passes.
53. Validate File through the shared module-test path. Completed in
    `47f566f9db Add File to Cloudflare commerce module set`:
    - The existing File integration suite passes 4/4 through Drizzle/SQLite
      with the real File module service and provider-backed behavior.
    - File source files entering the Worker graph now avoid package-local
      aliases and mark framework type imports as type-only.
    - File services, provider service, public contracts, and module
      integration assertions remain unchanged as the behavioral specification.
    - Validation passed: File build, File package/static-manifest tests, and
      the existing File integration suite with 1 suite and 4 passing tests.
54. Add File to the Worker commerce module set. Completed in
    `47f566f9db Add File to Cloudflare commerce module set`:
    - `@medusajs/file/static-manifest` exposes File's module definition,
      service, provider dispatch service, original joiner config, and a
      Worker-safe static provider loader.
    - The normal Node File module entry still uses the original dynamic
      provider loader. The Worker static manifest uses the static provider
      loader because filesystem provider resolution is not portable.
    - File's real service path is composed through the shared static module set
      loader with Currency, Cart, Store, Sales Channel, Region, Customer,
      Product, Stock Location, Inventory, Pricing, Tax, Payment, Order, API
      Key, Fulfillment, Promotion, User, and Auth.
    - The Cloudflare app supplies an in-memory File provider as deployment
      composition. This proves service/provider wiring only; production
      storage adapters such as R2 remain separate runtime work.
    - The Durable Object SQLite proof creates a file, retrieves it, lists it by
      id, and generates a presigned upload URL before running Cart totals and
      rollback checks from the same module set.
    - Validation passed: File build, File static manifest/package tests, File
      Drizzle integration suite, Cloudflare app typecheck, import guard with
      681 bundled inputs, portable entrypoint guard, production Worker build at
      1,397.58 kB, Cloudflare app tests with 2 passing, and the File-inclusive
      workerd Durable Object SQLite proof.
55. Pick the next commerce module by first running its unchanged integration
    suite through Drizzle/SQLite, then add Worker composition only after that
    gate passes.
56. Validate Notification through the shared module-test path. Completed in
    `2169c97ce5 Add Notification to Cloudflare commerce module set`:
    - The existing Notification integration suite passes 11/11 through
      Drizzle/SQLite with the real Notification module service and provider
      service.
    - Drizzle SQLite now stores DML `array` columns as JSON-backed text, which
      preserves Notification provider `channels` through upsert conflict
      updates.
    - Notification source files entering the Worker graph now avoid
      package-local aliases and mark framework type imports as type-only where
      possible.
    - Notification services, DML models, public contracts, provider sync
      behavior, and module integration assertions remain unchanged as the
      behavioral specification.
    - Validation passed: Drizzle build, focused Drizzle array upsert
      regression, Notification build, Notification static manifest test, and
      the existing Notification integration suite with 2 suites and 11 passing
      tests.
57. Add Notification to the Worker commerce module set. Completed in
    `2169c97ce5 Add Notification to Cloudflare commerce module set`:
    - `@medusajs/notification/static-manifest` exposes Notification's module
      definition, service, provider service, DML models, portable joiner
      config, and a Worker-safe static provider loader.
    - The normal Node Notification module entry still uses the original
      dynamic provider loader. The Worker static manifest uses the static
      provider loader because filesystem provider resolution is not portable.
    - Notification's real service path is composed through the shared static
      module set loader with Currency, Cart, Store, Sales Channel, Region,
      Customer, Product, Stock Location, Inventory, Pricing, Tax, Payment,
      Order, API Key, Fulfillment, Promotion, User, Auth, and File.
    - The Cloudflare app supplies an in-memory Notification provider as
      deployment composition. Production notification transports remain later
      adapter work.
    - The Durable Object SQLite proof creates and retrieves a notification,
      verifies the provider id and external id, then runs Cart totals and
      rollback checks from the same module set.
    - Validation passed: Cloudflare app typecheck, import guard with 692
      bundled inputs, portable entrypoint guard, production Worker build at
      1,411.29 kB, Cloudflare app tests with 2 passing, and the
      Notification-inclusive workerd Durable Object SQLite proof.
58. Pick the next commerce module by first running its unchanged integration
    suite through Drizzle/SQLite, then add Worker composition only after that
    gate passes.
59. Validate RBAC through the shared module-test path. Completed in
    `6f7b30e5e5 Add RBAC to Cloudflare commerce module set`:
    - The existing RBAC integration suite passes through Drizzle/SQLite with
      the real RBAC module service and unchanged assertions: 1 suite, 6
      passing tests, and 1 skipped existing linkable-config test.
    - The Drizzle persistence adapter now replaces RBAC's MikroORM custom
      repository with a Drizzle RBAC custom repository selected by the same
      `rbacRepository` registration name.
    - RBAC source files entering the Worker graph now avoid package-local
      aliases and mark framework/type imports as type-only where possible.
    - RBAC services, DML models, public contracts, initial data loader, custom
      repository contract, and module integration assertions remain the
      behavioral specification.
    - Validation passed: Drizzle build, Utils build, Modules SDK build, RBAC
      build, RBAC static manifest test, and the existing RBAC integration
      suite through Drizzle/SQLite.
60. Add RBAC to the Worker commerce module set. Completed in
    `6f7b30e5e5 Add RBAC to Cloudflare commerce module set`:
    - `@medusajs/rbac/static-manifest` exposes RBAC's module definition,
      service, DML models, initial data loader, portable joiner config, and a
      Worker-safe repository placeholder.
    - The normal Node RBAC module entry still uses the original MikroORM
      repository. The Worker static manifest uses the placeholder because
      importing the original repository would statically include MikroORM.
    - RBAC's real service path is composed through the shared static module
      set loader with Currency, Cart, Store, Sales Channel, Region, Customer,
      Product, Stock Location, Inventory, Pricing, Tax, Payment, Order, API
      Key, Fulfillment, Promotion, User, Auth, File, and Notification.
    - `@medusajs/utils/modules-sdk/policy-registry` splits the policy globals
      from Node-only `definePolicies` caller-file behavior, keeping Worker
      imports portable.
    - The Durable Object SQLite proof creates an RBAC role, policy, and
      role-policy link, then verifies policy listing through both custom
      repository-backed paths before running Cart totals and rollback checks
      from the same module set.
    - Validation passed: Cloudflare app typecheck, import guard with 704
      bundled inputs, portable entrypoint guard, production Worker build at
      1,431.62 kB, Cloudflare app tests with 2 passing, and the RBAC-inclusive
      workerd Durable Object SQLite proof.
61. Pick the next commerce module by first running its unchanged integration
    suite through Drizzle/SQLite, then add Worker composition only after that
    gate passes.
62. Validate Settings through the shared module-test path. Completed in
    `181d023304 Add Settings to Cloudflare commerce module set`:
    - The existing Settings integration suite passes 11/11 through
      Drizzle/SQLite with the real Settings module service.
    - Settings uses the generic Drizzle DML repository path; no custom
      Settings repository was needed.
    - Settings source files entering the Worker graph now avoid package-local
      aliases and mark framework type imports as type-only where possible.
    - Settings services, DML models, public contracts, JSON replacement
      behavior, and module integration assertions remain unchanged as the
      behavioral specification.
    - Validation passed: Settings build, Settings static manifest test, and
      the existing Settings integration suite with 1 suite and 11 passing
      tests.
63. Add Settings to the Worker commerce module set. Completed in
    `181d023304 Add Settings to Cloudflare commerce module set`:
    - `@medusajs/settings/static-manifest` exposes Settings' module
      definition, service, DML models, and portable joiner config.
    - Settings' real service path is composed through the shared static module
      set loader with Currency, Cart, Store, Sales Channel, Region, Customer,
      Product, Stock Location, Inventory, Pricing, Tax, Payment, Order, API
      Key, Fulfillment, Promotion, User, Auth, File, Notification, and RBAC.
    - The Durable Object SQLite proof creates and updates a view
      configuration, verifies empty-filter JSON replacement and null sorting,
      stores an active-view preference, then runs Cart totals and rollback
      checks from the same module set.
    - Validation passed: Cloudflare app typecheck, import guard with 710
      bundled inputs, portable entrypoint guard, production Worker build at
      1,443.39 kB, Cloudflare app tests with 2 passing, and the
      Settings-inclusive workerd Durable Object SQLite proof.
64. Pick the next commerce module by first running its unchanged integration
    suite through Drizzle/SQLite, then add Worker composition only after that
    gate passes.
65. Validate Translation through the shared module-test path. Completed in
    `b779457284 Add Translation to Cloudflare commerce module set`:
    - The existing Translation integration suite passes 60/60 through
      Drizzle/SQLite with the real Translation module service.
    - Translation no longer uses Postgres-only raw SQL for `q` JSON search or
      statistics aggregation in the Worker-entered service path.
    - `q` search is performed over serialized translation JSON, with
      pagination applied after filtering to preserve filter-before-page
      semantics.
    - A focused regression in
      `d7dee077be Cover Translation query pagination` now covers `q` plus
      `skip`/`take`, verifying the count covers all matches while the returned
      rows honor the requested page.
    - Translation source files entering the Worker graph now avoid
      package-local aliases and mark framework type imports as type-only where
      possible.
    - Translation services, DML models, default-locale loader, public
      contracts, field filtering, statistics behavior, and module integration
      assertions remain the behavioral specification.
    - Validation passed: Translation build, Translation static manifest test,
      and the existing Translation integration suite with 1 suite and 60
      passing tests.
66. Add Translation to the Worker commerce module set. Completed in
    `b779457284 Add Translation to Cloudflare commerce module set`:
    - `@medusajs/translation/static-manifest` exposes Translation's module
      definition, service, default-locale loader, DML models, and portable
      joiner config.
    - Translation's real service path is composed through the shared static
      module set loader with Currency, Cart, Store, Sales Channel, Region,
      Customer, Product, Stock Location, Inventory, Pricing, Tax, Payment,
      Order, API Key, Fulfillment, Promotion, User, Auth, File, Notification,
      RBAC, and Settings.
    - The Durable Object SQLite proof verifies the default locale loader,
      product translation creation, JSON `q` search, field filtering, and
      statistics before running Cart totals and rollback checks from the same
      module set.
    - Validation passed: Cloudflare app typecheck, import guard with 720
      bundled inputs, portable entrypoint guard, production Worker build at
      1,474.11 kB, Cloudflare app tests with 2 passing, and the
      Translation-inclusive workerd Durable Object SQLite proof.
67. Pick the next commerce module by first running its unchanged integration
    suite through Drizzle/SQLite, then add Worker composition only after that
    gate passes.
68. Validate Analytics through the shared module-test path. Completed in
    `9dfa3d2f22 Add Analytics to Cloudflare commerce module set`:
    - The existing Analytics integration suite passes 3/3 through
      Drizzle/SQLite with the real Analytics module service and provider
      service.
    - Analytics source now has a module-owned static manifest and a
      Worker-safe static provider loader. The normal Node module entry keeps
      the original dynamic provider loader.
    - Provider registration and service error handling were tightened to avoid
      unnecessary implicit `any` and unchecked caught errors.
    - Analytics services, provider contracts, public API, and module
      integration assertions remain the behavioral specification.
    - Validation passed: Modules SDK build, Analytics build, Analytics static
      manifest test, and the existing Analytics integration suite with 1 suite
      and 3 passing tests.
69. Add Analytics to the Worker commerce module set. Completed in
    `9dfa3d2f22 Add Analytics to Cloudflare commerce module set`:
    - `@medusajs/analytics/static-manifest` exposes Analytics' module
      definition, service, provider service, and static provider loader.
    - Analytics' real service path is composed through the shared static
      module set loader with Currency, Cart, Store, Sales Channel, Region,
      Customer, Product, Stock Location, Inventory, Pricing, Tax, Payment,
      Order, API Key, Fulfillment, Promotion, User, Auth, File, Notification,
      RBAC, Settings, and Translation.
    - The Cloudflare app supplies an in-memory Analytics provider as
      deployment composition and the Durable Object SQLite proof verifies
      `track` and `identify` before running Cart totals and rollback checks
      from the same module set.
    - Validation passed: Cloudflare app typecheck, import guard with 725
      bundled inputs, portable entrypoint guard, production Worker build at
      1,480.18 kB, Cloudflare app tests with 2 passing, and the
      Analytics-inclusive workerd Durable Object SQLite proof.
70. Move from commerce-module composition to runtime/infrastructure slices.
    Remaining packages such as caching/cache providers, event bus, locking,
    workflow engines, index, and link modules should be handled as explicit
    runtime-adapter work, not as ordinary commerce persistence modules.
71. Add Caching to the Worker runtime module set. Completed in
    `ab4b977c82 Add Caching to Cloudflare runtime module set`:
    - `@medusajs/caching/static-manifest` exposes the real
      `CachingModuleService`, provider service, hash loader, and static
      provider loader.
    - The normal Node Caching entry keeps dynamic provider loading and the
      built-in Node memory provider; the Worker graph uses an imported
      Worker memory provider and does not import `node-cache`.
    - Caching source files entering the Worker graph now avoid package-local
      `@types`/`@services` aliases.
    - The Cloudflare app adds narrow framework shims for the Caching
      lifecycle helpers instead of widening back to Node-heavy barrels.
    - Validation passed: Caching build, Caching unit/static-manifest tests
      with 17 passing, unchanged non-Redis Caching integration suite with 3
      suites and 28 passing, Cloudflare app typecheck, import guard with 868
      bundled inputs, portable entrypoint guard, production Worker build at
      1,776.00 kB, and the Caching-inclusive workerd Durable Object SQLite
      proof.
    - `medusa-cloudflare` Vitest remains blocked by the Vite/Rolldown
      optimizer error `Missing field tsconfigPaths on
      BindingViteResolvePluginConfig.resolveOptions`; production build and
      workerd proof pass.
72. Add Event Bus Local to the Worker runtime module set. Completed in
    `3653f4bd4a Add Event Bus Local to Cloudflare runtime set`:
    - `@medusajs/event-bus-local/static-manifest` exposes the real local Event
      Bus service, loader, module definition, and static resources for Worker
      composition.
    - `LocalEventBusService` no longer imports Node's `events` module or
      `timers/promises`; the same service path now uses a local emitter and
      `globalThis.setTimeout`.
    - The Cloudflare app uses a narrow `AbstractEventBusModuleService` shim so
      the Worker graph does not import the current Node-heavy event-bus utils
      barrel and its `ulid`/Node crypto dependency.
    - The framework-utils GraphQL merge shim now uses `@graphql-tools/merge`
      before `buildSchema`, allowing Caching lifecycle registration to start
      under the composed module set.
    - Validation passed: Event Bus Local build, Event Bus Local
      unit/static-manifest tests with 12 passing, unchanged Event Bus Local
      integration suite with 4 passing, Cloudflare app typecheck, import guard
      with 955 bundled inputs, portable entrypoint guard, production Worker
      build at 1,853.22 kB, and the Event Bus Local-inclusive workerd Durable
      Object SQLite proof with Caching invalidation driven by
      `product.updated`.
    - `medusa-cloudflare` Vitest remains blocked by the Vite/Rolldown
      optimizer error `Missing field tsconfigPaths on
      BindingViteResolvePluginConfig.resolveOptions`; production build and
      workerd proof pass.
73. Add Locking to the Worker runtime module set. Completed in
    `a7c26835f7 Add Locking to Cloudflare runtime set`:
    - `@medusajs/locking/static-manifest` exposes the real
      `LockingModuleService`, provider service, static provider loader, module
      definition, and static resources for Worker composition.
    - The normal Node Locking entry keeps dynamic provider loading; the Worker
      graph uses the static loader and default in-memory provider without
      importing `moduleProviderLoader`.
    - `InMemoryLockingProvider` now uses `globalThis.setTimeout` and narrows
      optional timer `unref()` before calling it, so the same provider can run
      in workerd.
    - The package export map includes explicit `node`, `require`, `import`,
      and `default` targets so the existing Medusa Node integration wrapper
      keeps resolving `@medusajs/locking`.
    - Validation passed: Locking build, Locking unit/static-manifest test with
      1 passing, unchanged Locking integration suite with 6 passing,
      Cloudflare app typecheck, import guard with 962 bundled inputs, portable
      entrypoint guard, production Worker build at 1,862.83 kB, and the
      Locking-inclusive workerd Durable Object SQLite proof with serialized
      critical-section execution.
    - `medusa-cloudflare` Vitest remains blocked by the Vite/Rolldown
      optimizer error `Missing field tsconfigPaths on
      BindingViteResolvePluginConfig.resolveOptions`; production build and
      workerd proof pass.
74. Add a Cloudflare Durable Object-backed Locking provider. Completed in
    `bc4711409d Add Cloudflare Durable Object locking provider`:
    - `@medusajs/locking-cloudflare` is a separate provider package, keeping
      Cloudflare-specific infrastructure out of the shared Locking module
      service.
    - The Worker app imports the provider from the dedicated Worker-safe
      `@medusajs/locking-cloudflare/provider` entry and configures it through
      the existing Locking module static provider loader.
    - `MedusaLockingDO` stores locks in Durable Object storage and supports
      acquire, release, and release-all.
    - The provider uses one named coordinator DO instance per configured scope
      for this first gate so Medusa's `releaseAll` contract remains valid.
    - The Cart Durable Object proof requires the `MEDUSA_LOCKING` binding and
      verifies serialized stock-consuming jobs through the existing
      `runtime.locking.service.execute` API.
    - Validation passed: `@medusajs/locking-cloudflare` build and unit test,
      Locking unit/static-manifest test, unchanged Locking integration suite
      with 6 passing, Cloudflare app typecheck, import guard with 965 bundled
      inputs, portable entrypoint guard, production Worker build at
      1,871.73 kB, and the Durable Object Locking-inclusive workerd Durable
      Object SQLite proof.
    - `medusa-cloudflare` Vitest remains blocked by the Vite/Rolldown
      optimizer error `Missing field tsconfigPaths on
      BindingViteResolvePluginConfig.resolveOptions`; production build and
      workerd proof pass.
75. Add a Cloudflare Queue-backed Event Bus module. Completed in
    `189aeb2ac5 Add Cloudflare Queue event bus module`:
    - `@medusajs/event-bus-cloudflare` is a separate Event Bus module
      implementation for the same `IEventBusModuleService` boundary. This is a
      module swap, not a parallel commerce event API.
    - The Worker app selects the Cloudflare Event Bus module at the
      application root and provides the `MEDUSA_EVENTS` Queue binding through
      module options. Shared commerce services still resolve the normal Event
      Bus module service.
    - The first Queue slice enqueues events to Cloudflare Queues and keeps
      local subscriber dispatch enabled so existing in-runtime lifecycle hooks,
      including Caching invalidation, continue to run in the current Durable
      Object proof.
    - The Cloudflare app aliases the new package to source for Vite/workerd
      and import-guard validation, avoiding CommonJS package output in the
      Worker dev graph.
    - Validation passed: Event Bus Cloudflare build and focused unit tests,
      Cloudflare app typecheck, import guard with 964 bundled inputs, portable
      entrypoint guard, production Worker build at 1,872.13 kB, and the
      Queue-backed Event Bus-inclusive workerd Durable Object SQLite proof.
    - `medusa-cloudflare` Vitest remains blocked by the Vite/Rolldown
      optimizer error `Missing field tsconfigPaths on
      BindingViteResolvePluginConfig.resolveOptions`; production build and
      workerd proof pass.
76. Add Cloudflare Queue consumer dispatch. Completed in
    `b44605b3d2 Add Cloudflare Queue consumer dispatch`:
    - `@medusajs/event-bus-cloudflare` now exposes a consumer-side dispatch
      path that validates queued messages at the Worker boundary, dispatches
      to registered subscribers without re-enqueueing, and rejects when a
      subscriber fails so Cloudflare Queues can retry.
    - `apps/medusa-cloudflare` now exports a Queue consumer handler for
      `medusa-events`, configures `max_retries`, and declares
      `medusa-events-dlq` as the dead-letter queue.
    - The workerd proof includes a small `EventConsumerProofDO`: the Worker
      route sends a proof event to `MEDUSA_EVENTS`, the Queue consumer
      dispatches it through the Event Bus service, and a subscriber records
      delivery in the proof DO.
    - Validation passed: Event Bus Cloudflare build and 5 focused tests,
      Cloudflare app typecheck, import guard with 967 bundled inputs,
      portable entrypoint guard, production Worker build at 1,877.93 kB, and
      workerd Durable Object SQLite proof including Queue consumer dispatch.
    - `medusa-cloudflare` Vitest remains blocked by the Vite/Rolldown
      optimizer error `Missing field tsconfigPaths on
      BindingViteResolvePluginConfig.resolveOptions`; production build and
      workerd proof pass.
77. Continue runtime/infrastructure modules one at a time. The next Event Bus
    boundary is cross-partition routing and durable subscriber state. Do not
    encode tenant or module-per-DO topology into this runtime proof.
78. Add the in-memory Workflow Engine to the Worker composition. Completed in
    `71301590d5 Add Worker-composable workflow engine slice`:
    - `@medusajs/workflow-engine-inmemory` now has a static manifest and is
      composed by the Cloudflare app as the real Medusa Workflow Engine module,
      not as an app-local workflow rewrite.
    - Core orchestration and workflows SDK now expose portable subpaths and use
      Worker-compatible replacements for Node EventEmitter, sleep, `global`,
      and ID generation on the Worker import path.
    - Validation passed for the relevant package builds, Workflow Engine
      manifest test, Cloudflare app typecheck, production Worker build, import
      guard, and portable entrypoint guard.
    - The workerd Durable Object proof was initially blocked before server
      health by a Cloudflare Vite dev-runner `ReferenceError: exports is not
      defined` evaluation error. Production build and import guard remained
      clean.
79. Close the Workflow Engine workerd dev-runner blocker. Completed in
    `76daad2355 Fix Worker workflow dev-runner path`:
    - The Cloudflare app aliases `@medusajs/framework/awilix` to browser
      awilix and the import guard mirrors the alias.
    - Workflow Engine static composition now includes a generated joiner config
      for `WorkflowExecution`, preserving queryable behavior.
    - Workflow subscriber notification scheduling uses Worker-compatible
      `queueMicrotask`.
    - TranslationSettings read/create methods are explicit on the Translation
      service for the static Drizzle runtime.
    - Worker proof-path CJS dependencies from `pluralize` and
      `fast-json-stable-stringify` were removed.
    - Validation passed: changed package builds, focused static manifest tests,
      Cloudflare app typecheck, import guard with 1015 bundled inputs,
      production Worker build at 2,043.24 kB, and the full Durable Object
      SQLite workerd proof with Workflow Engine enabled.
80. Next runtime step: continue durable workflow/provider boundaries only after
    the commerce module-set proof remains green. Keep Workflow Engine logic in
    the real Medusa module service; do not rebuild it in the Cloudflare app.
81. Make initial scheduled workflow timers Worker-compatible. Completed in
    `74175878ad Make workflow scheduler timers Worker-safe`:
    - Initial Workflow Engine scheduler timers now use the managed timer path
      and call `unref()` only when the runtime exposes it.
    - Focused scheduler storage coverage simulates Worker-style timer handles
      without Node `unref`.
    - Validation passed: Workflow Engine scheduler storage test,
      `@medusajs/workflow-engine-inmemory` build, Cloudflare app typecheck,
      import guard with 1015 bundled inputs, production Worker build at
      2,043.26 kB, and the full Durable Object SQLite workerd proof.
82. Next runtime step: add a real scheduled workflow adapter boundary for
    persisted schedules and DO-alarm-native scheduling, or continue to the next
    provider boundary. Do not move workflow execution logic into the
    Cloudflare app.
83. Add the Workflow Scheduler adapter boundary. Completed in
    `eed9c8252d Add workflow scheduler adapter boundary`:
    - `InMemoryDistributedTransactionStorage` now uses an injected
      `WorkflowSchedulerAdapter` for timer creation, clearing, optional
      `unref`, and optional schedule expression parsing.
    - The Workflow Engine loader registers the default adapter only when the
      container has not already provided `workflowSchedulerAdapter`.
    - Cron-string schedules still fail by default on the Cloudflare path. The
      Cloudflare direction is DO-alarm-native scheduling, not bundling a Worker
      cron parser.
    - Validation passed: focused scheduler storage tests, Workflow Engine
      build, Cloudflare app typecheck, import guard with 1015 bundled inputs,
      production Worker build at 2,044.40 kB, and the full Durable Object
      SQLite workerd proof.
84. Next runtime step: use the scheduler adapter boundary for durable
    scheduled workflow state or a DO-alarm-native schedule provider. Keep
    Workflow Engine behavior in the module service.
85. Add the Workflow Schedule Store boundary. Completed in
    `88f14d8bb3 Add workflow schedule store boundary`:
    - Scheduled workflow runtime state now uses a `WorkflowScheduleStore`
      contract instead of a private `Map` inside
      `InMemoryDistributedTransactionStorage`.
    - The default `InMemoryWorkflowScheduleStore` preserves existing in-memory
      behavior.
    - The Workflow Engine loader registers `workflowScheduleStore` only when
      the container has not already provided one.
    - Validation passed: focused scheduler storage tests, Workflow Engine
      build, Cloudflare app typecheck, import guard with 1015 bundled inputs,
      production Worker build at 2,045.08 kB, and the full Durable Object
      SQLite workerd proof.
86. Next runtime step: implement a durable schedule store behind the new
    boundary, likely backed by the same Durable Object SQLite partition used by
    the module-set proof. Keep timers and schedule interpretation behind
    `WorkflowSchedulerAdapter`.
87. Add the Durable Object Workflow Schedule Store proof. Completed in
    `21a56ce4e6 Add DO workflow schedule store proof`:
    - `apps/medusa-cloudflare` now provides a DO SQLite-backed
      `workflowScheduleStore` to the real Workflow Engine module.
    - The Cloudflare app registers the store in the shared static module
      container and declares `workflowScheduleStore` as a Workflow Engine
      dependency only when the app provides the store. The default in-memory
      module path remains unchanged.
    - The cart Durable Object proof now schedules a real workflow through
      Medusa's `WorkflowScheduler`, verifies persisted schedule state, clears
      it through the scheduler, and verifies persisted/runtime cleanup.
    - Validation passed: Cloudflare app typecheck, import guard with 1016
      bundled inputs, production Worker build at 2,052.58 kB, and the full
      Durable Object SQLite workerd proof with Workflow schedule persistence.
88. Next runtime step: choose between Cloudflare Alarm-backed schedule recovery
    and the next workflow provider boundary. Do not turn the app proof into a
    replacement Workflow Engine implementation; keep behavior in the Medusa
    module and extend only adapter/store boundaries.
89. Add Durable Object alarm-backed schedule recovery. Completed in
    `0d5cb30757 Add DO alarm workflow schedule recovery`:
    - `DurableObjectWorkflowScheduleStore` now persists `next_execution_at`
      and keeps the DO alarm scheduled for the earliest persisted schedule.
    - The cart Durable Object implements `alarm()` and recovers due persisted
      schedules through the real Workflow Engine service when runtime timers
      are missing.
    - Alarm recovery skips schedules that still have active runtime timers, so
      alarms are a lost-timer recovery path rather than a duplicate executor.
    - The workerd proof simulates isolate timer loss, verifies alarm recovery
      executes the persisted workflow, verifies execution count persistence,
      and verifies cleanup.
    - Validation passed: Cloudflare app typecheck, import guard with 1016
      bundled inputs, production Worker build at 2,059.30 kB, and the full
      Durable Object SQLite workerd proof with schedule alarm recovery.
90. Add the shared Workflow Engine schedule recovery API. Completed in
    `ef5b8f5cf8 Add workflow schedule recovery API`:
    - The Workflow Engine module service now exposes `recoverDueSchedules`.
    - `WorkflowOrchestratorService` delegates recovery to
      `InMemoryDistributedTransactionStorage`, which calls a recoverable
      schedule store with a typed Workflow Engine-owned `runWorkflow` callback.
    - The default in-memory schedule store returns an empty recovery result,
      preserving Node/default behavior.
    - The Cloudflare cart Durable Object `alarm()` now calls the real Workflow
      Engine service API instead of owning the recovery run loop.
    - Validation passed: focused Workflow Engine scheduler storage test,
      `@medusajs/types` build, `@medusajs/workflow-engine-inmemory` build,
      Cloudflare app typecheck, import guard with 1016 bundled inputs,
      production Worker build at 2,059.82 kB, and the full Durable Object
      SQLite workerd proof with schedule alarm recovery.
91. Next runtime step: continue with DO-alarm-native scheduling semantics or
    move to the next workflow provider boundary. Do not add Worker cron-parser
    dependencies to the Cloudflare path.
92. Extract the Cloudflare Workflow schedule store package. Completed in
    `eba3d38bb2 Extract Cloudflare workflow schedule store`:
    - `DurableObjectWorkflowScheduleStore` moved from the app into
      `@medusajs/workflow-engine-cloudflare/schedule-store`.
    - The package uses an isolated subpath; its root index does not re-export
      the backend-specific store.
    - The app imports and aliases only the Cloudflare schedule-store subpath
      and remains the thin composition and proof root.
    - Validation passed: package build, app typecheck, import guard with 1016
      bundled inputs, production Worker build at 2,059.88 kB, and the full DO
      SQLite workerd proof.
93. Next runtime step: continue DO-alarm-native scheduling semantics or move to
    the next workflow provider boundary. Do not add Worker cron-parser
    dependencies.
94. Reject cron persistence in the Cloudflare Workflow schedule store.
    Completed in
    `07f9cad320 Reject cron in Cloudflare workflow schedule store`:
    - `@medusajs/workflow-engine-cloudflare/schedule-store` now rejects cron
      schedules before writing runtime or Durable Object SQLite state.
    - Interval schedules remain the validated DO-alarm-native schedule path.
    - The provider constructor depends on the small Durable Object storage
      surface it uses, while real `DurableObjectStorage` remains structurally
      compatible.
    - Focused provider Jest coverage was added and test sources are excluded
      from provider package builds.
    - Validation passed: provider Jest suite, provider build, app typecheck,
      import guard with 1016 bundled inputs, production Worker build at
      2,059.68 kB, and the full DO SQLite workerd proof.
95. Next runtime step: continue with a real DO-alarm-native schedule format if
    calendar-style scheduling is required, or move to the next workflow
    provider boundary. Do not add Worker cron-parser dependencies.
96. Add the Cloudflare Workflow scheduler adapter package subpath. Completed in
    `952e372f05 Add Cloudflare workflow scheduler adapter`:
    - `@medusajs/workflow-engine-cloudflare/scheduler-adapter` delegates to
      Worker-compatible global timer APIs.
    - The adapter intentionally does not provide a cron parser, keeping cron
      parser code out of the Cloudflare Worker graph.
    - `apps/medusa-cloudflare` now explicitly registers
      `workflowSchedulerAdapter` and `workflowScheduleStore` at the app root
      before loading the existing Workflow Engine module.
    - The Workflow Engine module declaration receives the adapter/store
      dependencies only when the app selects them, preserving the default
      Node/in-memory path.
    - Validation passed: provider Jest suite, provider build, app typecheck,
      import guard with 1017 bundled inputs, production Worker build at
      2,060.64 kB, and the full DO SQLite workerd proof.
97. Next runtime step: continue with a real DO-alarm-native schedule format if
    calendar-style scheduling is required, or move to the next Workflow Engine
    provider boundary. Keep scheduler behavior adapter-driven and keep cron
    parser code out of the Worker import graph.
98. Add the Workflow Execution Store boundary. Completed in
    `10efd04622 Add workflow execution store boundary`:
    - `InMemoryDistributedTransactionStorage` now persists checkpoints through
      a `WorkflowExecutionStore` contract instead of calling the Medusa
      internal Workflow Execution service directly.
    - `InternalServiceWorkflowExecutionStore` preserves the original behavior
      by delegating save, delete, lookup, expiry listing, and expiry deletion
      to the existing internal service.
    - The Workflow Engine loader registers the default execution store when no
      `workflowExecutionStore` is provided by the app/container.
    - Existing Workflow Engine public service APIs and module models remain
      unchanged; this is a persistence seam for future Cloudflare execution
      storage, not a replacement Workflow Engine.
    - Validation passed: focused Workflow Engine storage Jest suite, Workflow
      Engine build, app typecheck, import guard with 1017 bundled inputs,
      production Worker build at 2,061.95 kB, and the full DO SQLite workerd
      proof.
99. Next runtime step: add a Cloudflare provider implementation of
    `WorkflowExecutionStore`, backed by DO SQLite/Drizzle, and wire it at the
    app root while keeping existing Workflow Engine service APIs unchanged.
100. Add the Cloudflare Workflow execution store provider. Completed in
     `51cb681121 Add Cloudflare workflow execution store`:
     - `@medusajs/workflow-engine-cloudflare/execution-store` implements the
       Workflow Engine execution store boundary for Durable Object SQLite.
     - The store writes to the existing `workflow_execution` table so existing
       Workflow Engine public APIs continue to read the same persisted rows.
     - The store supports checkpoint save, latest lookup, soft delete by run
       id, expirable finished execution listing, and soft delete by id.
     - `apps/medusa-cloudflare` registers the execution store alongside the
       Cloudflare scheduler adapter and schedule store before loading the
       existing Workflow Engine module.
     - The workerd cart proof now asserts retained workflow execution
       persistence through the Cloudflare execution store with state `done`.
     - Validation passed: provider Jest suite, provider build, Workflow Engine
       build, app typecheck, import guard with 1018 bundled inputs, production
       Worker build at 2,071.09 kB, and the full DO SQLite workerd proof with
       execution persistence, schedule persistence, and alarm recovery.
101. Next runtime step: continue reducing Workflow Engine app-owned proof logic
     by moving any remaining Cloudflare-specific Workflow Engine storage
     behavior into provider subpaths, or move to the next runtime boundary once
     Workflow Engine storage durability is sufficiently proven.
102. Add Cloudflare Workflow execution API proof coverage. Completed in
     `8314038784 Validate workflow execution APIs on Cloudflare runtime`:
     - The Cloudflare HTTP proof setup resource now covers the Admin workflow
       execution API paths exercised by the original module integration spec:
       list, retrieve by id, retrieve by workflow/transaction id, run,
       success, and failure.
     - The setup path allowlist now forwards workflow execution retrieve, run,
       and success URLs to the proof handler instead of returning 404 before
       handler dispatch.
     - Workflow execution proof rows now include id, execution, context, and
       deleted_at fields required by the original Admin workflow execution
       assertions.
     - Validation passed: production Worker build and the existing
       `integration-tests-modules test:integration` runner for
       `workflow-engine/admin/workflow-executions.spec.ts` and
       `workflow-engine/workflow-engine.spec.ts` with
       `MEDUSA_TEST_HTTP_RUNTIME=cloudflare`.
103. Complete the Cloudflare module integration runner proof. Completed in
     `c9f435162b Prove module runner on Cloudflare runtime`:
     - The existing `integration-tests-modules` package runner completed
       through the Cloudflare HTTP runtime with unchanged module assertions.
     - The passing full proof used
       `NODE_OPTIONS=--max-old-space-size=8192 MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-modules test:integration --runInBand`.
     - Result: 101 suites passed, 1 existing upstream-skipped suite, 352 tests
       passed, and 5 existing skipped tests.
     - The skipped suite is the existing skipped
       `price-lists/store/get-product.ts`.
     - The proof hardened the Cloudflare cart completion bridge, index waits,
       large index-search timeout, and Cloudflare dev-runtime health wait
       without replacing module assertions.
104. Change the active runtime direction from route-by-route proof expansion to
     HTTP manifest convergence:
     - Treat the module lane as proven for the current Cloudflare HTTP runtime.
     - Do not keep expanding static proof resources unless a touched boundary
       requires it.
     - Move the existing Medusa HTTP route and middleware discovery output into
       package-owned static manifests that can feed both Express and Fetch
       adapters.
     - Keep the hosted programmable framework API deferred until this core HTTP
       manifest and adapter boundary is stable.
105. Add a Medusa-owned static HTTP Currency manifest. Completed in the current
     change set:
     - `packages/medusa/scripts/generate-static-http-manifest.mjs` generates a
       package-owned manifest for the proven Admin and Store Currency HTTP
       boundary.
     - `packages/medusa/src/static/http-currency-manifest.ts` imports the real
       Currency route and middleware modules and satisfies
       `StaticHttpResourceManifest`.
     - The manifest is exposed through the narrow
       `@medusajs/medusa/static/http-currency-manifest` package subpath.
     - `@medusajs/medusa` now exposes `generate:static-http-manifest` and
       `check:static-http-manifest`.
     - This does not change the default Express filesystem path. It creates the
       first Medusa-owned static descriptor artifact that can later be consumed
       by the existing `StaticHttpManifestResolver`.
     - Validation passed: Medusa static HTTP manifest generation and drift
       check.
106. Add an opt-in Express static-manifest smoke path using the Medusa-owned
     Currency manifest. Completed in `48029b09cc`:
     - `packages/medusa/src/loaders/api.ts` accepts an optional
       `HttpResourceResolver` and still defaults to filesystem discovery.
     - `packages/medusa/src/loaders/index.ts` forwards an optional
       `apiResourceResolver` through the normal Express entrypoint loading
       boundary.
     - `packages/medusa/src/loaders/__tests__/api-static-http-manifest.spec.ts`
       proves the generated Currency manifest registers through Express and
       serves `GET /store/currencies` with Store global middleware and the real
       route handler.
     - Validation passed: focused Medusa package smoke test, static manifest
       drift check, Medusa package build, and composed Worker import guard.
107. Move static HTTP manifest generation to an explicit build-time route list.
     Completed in `dd67dccf30`:
     - `packages/medusa/static-http-manifests/currency.json` is the Medusa-owned
       Store/Admin Currency route and middleware input.
     - `packages/medusa/scripts/generate-static-http-manifest.mjs` reads that
       input, validates listed files exist, and renders the generated manifest
       through the shared framework build tool.
     - The generated `http-currency-manifest.ts` route and middleware imports
       remain unchanged; only the generated header now points at the route-list
       input.
     - Validation passed: manifest generation and drift check, focused Express
       static-manifest smoke test, Medusa package build, composed Worker import
       guard, and `git diff --check`.
108. Add Store product-tags to the package-owned static HTTP manifest input.
     Completed in `1b27116222`:
     - `packages/medusa/static-http-manifests/currency.json` now also lists
       `packages/medusa/src/api/store/product-tags/route.ts`,
       `packages/medusa/src/api/store/product-tags/[id]/route.ts`, and
       `packages/medusa/src/api/store/product-tags/middlewares.ts`.
     - The generated manifest imports the real Store product-tags route modules
       and `storeProductTagRoutesMiddlewares`.
     - The focused Express static-manifest smoke now calls both
       `GET /store/currencies` and `GET /store/product-tags` through the same
       generated manifest and Medusa API loader path.
     - Validation passed: manifest generation and drift check, focused Express
       static-manifest smoke test, Medusa package build, composed Worker import
       guard, and `git diff --check`.
109. Rename the package-owned static HTTP manifest to a general Store/Admin
     artifact. Completed in `ba72811dcf`:
     - `packages/medusa/static-http-manifests/store-admin.json` replaces the
       Currency-named route-list input.
     - `packages/medusa/src/static/http-manifest.ts` exports
       `medusaStaticHttpManifest` as the primary generated manifest artifact.
     - `@medusajs/medusa/static/http-manifest` is the primary package subpath.
     - `packages/medusa/src/static/http-currency-manifest.ts` remains as a
       compatibility alias and re-exports the general manifest as
       `medusaCurrencyStaticHttpManifest`.
     - Validation passed: manifest drift check, focused Express
       static-manifest smoke test, Medusa package build, composed Worker import
       guard, both package subpath resolution checks, and `git diff --check`.
110. Add Store product-types to the package-owned static HTTP manifest input.
     Completed in `5e9832e146`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       `packages/medusa/src/api/store/product-types/route.ts`,
       `packages/medusa/src/api/store/product-types/[id]/route.ts`, and
       `packages/medusa/src/api/store/product-types/middlewares.ts`.
     - The generated manifest imports the real Store product-types route
       modules and `storeProductTypeRoutesMiddlewares`.
     - The focused Express static-manifest smoke now calls
       `GET /store/currencies`, `GET /store/product-tags`, and
       `GET /store/product-types` through the same generated manifest and
       Medusa API loader path.
     - Validation passed: manifest generation and drift check, focused Express
       static-manifest smoke test, Medusa package build, composed Worker import
       guard, and `git diff --check`.
111. Add Store collections to the package-owned static HTTP manifest input.
     Completed in `877aaaba66`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       `packages/medusa/src/api/store/collections/route.ts`,
       `packages/medusa/src/api/store/collections/[id]/route.ts`, and
       `packages/medusa/src/api/store/collections/middlewares.ts`.
     - The generated manifest imports the real Store collections route modules
       and `storeCollectionRoutesMiddlewares`.
     - The focused Express static-manifest smoke now calls
       `GET /store/currencies`, `GET /store/product-tags`,
       `GET /store/product-types`, and `GET /store/collections` through the
       same generated manifest and Medusa API loader path.
     - Store locales was deferred because it is gated by the translation
       feature flag; collections is the lower-noise read-route proof.
     - Validation passed: manifest generation and drift check, focused Express
       static-manifest smoke test, Medusa package build, composed Worker import
       guard, and `git diff --check`.
112. Add Store regions to the package-owned static HTTP manifest input.
     Completed in `4fc76f1142`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       `packages/medusa/src/api/store/regions/route.ts`,
       `packages/medusa/src/api/store/regions/[id]/route.ts`, and
       `packages/medusa/src/api/store/regions/middlewares.ts`.
     - The generated manifest imports the real Store regions route modules and
       `storeRegionRoutesMiddlewares`.
     - The focused Express static-manifest smoke now calls
       `GET /store/currencies`, `GET /store/product-tags`,
       `GET /store/product-types`, `GET /store/collections`, and
       `GET /store/regions` through the same generated manifest and Medusa API
       loader path.
     - Store payment-providers was deferred because it requires a `region_id`
       filter and touches checkout/provider response shape.
     - Validation passed: manifest generation and drift check, focused Express
       static-manifest smoke test, Medusa package build, composed Worker import
       guard, and `git diff --check`. Yarn gates were rerun with
       `NODE_OPTIONS=--max-old-space-size=8192` after an initial Yarn plugin
       allocation failure before command execution.
113. Add Store payment-providers to the package-owned static HTTP manifest
     input. Completed in `6322c01c37`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       `packages/medusa/src/api/store/payment-providers/route.ts` and
       `packages/medusa/src/api/store/payment-providers/middlewares.ts`.
     - The generated manifest imports the real Store payment-providers route
       module and `storePaymentProvidersMiddlewares`.
     - The focused Express static-manifest smoke now calls
       `GET /store/payment-providers?region_id=reg_test` through the same
       generated manifest and Medusa API loader path.
     - Workflow-backed Store customers, carts, and shipping options remain
       outside this manifest expansion slice.
     - Validation passed: manifest generation and drift check, focused Express
       static-manifest smoke test, Medusa package build, composed Worker import
       guard, and `git diff --check`.
114. Wire `medusaStaticHttpManifest` into the Cloudflare app proof path.
     Completed in `720dbe05af`:
     - `apps/medusa-cloudflare/src/http-proof/manifest.ts` now imports the
       package-owned `medusaStaticHttpManifest` and merges it with the broader
       generated proof manifest.
     - Shared route entries are keyed by `relativePath`; shared middleware
       entries are keyed by `source`.
     - The broad app-owned proof manifest remains in place for route groups
       that are not yet part of the package-owned manifest.
     - The workerd HTTP proof fixture now seeds the route prerequisites needed
       by the real Store currency, cart, promotion, shipping, tax, completion,
       and product checks.
     - Validation passed: `medusa-cloudflare` typecheck, composed Worker import
       guard, `test:cart-do-sqlite`, and `git diff --check`.
115. Shrink the app-owned proof manifest generator for route groups already
     covered by `medusaStaticHttpManifest`. Completed in `2f315dacde`:
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer scans admin currencies, Store currencies, Store regions, Store
       payment-providers, Store collections, Store product-tags, or Store
       product-types.
     - Generated `packages/medusa/src/static/http-proof-manifest.ts` drops
       duplicate imports, route entries, and middleware entries for those
       groups.
     - The Worker proof still receives those routes and middleware through the
       package-owned `medusaStaticHttpManifest` merge.
     - Validation passed: proof-manifest drift check, `medusa-cloudflare`
       typecheck, composed Worker import guard, `test:cart-do-sqlite`, and
       `git diff --check`.
116. Add Store products to the package-owned static HTTP manifest and remove
     duplicate Store products generation from the app-owned proof manifest.
     Completed in `41a7d9e3df`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Store products list/retrieve routes and `storeProductRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Store product routes and middleware.
     - The focused Express static-manifest smoke now calls
       `GET /store/products` through the generated manifest, publishable-key
       middleware, sales-channel filtering, product middleware, and real route.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer scans Store products, and the generated proof manifest drops
       duplicate Store product imports/routes/middleware.
     - `packages/medusa/jest.config.js` maps framework subpaths for the
       focused Jest smoke so product middleware runtime helpers resolve.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, `test:cart-do-sqlite`, and `git diff --check`.
117. Add Store product variants to the package-owned static HTTP manifest and
     remove duplicate Store product-variant generation from the app-owned proof
     manifest. Completed in `a4f0c863dc`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Store product-variant list/retrieve routes and
       `storeProductVariantRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Store product-variant routes and middleware.
     - The focused Express static-manifest smoke now calls
       `GET /store/product-variants` through the generated manifest,
       publishable-key middleware, sales-channel filtering,
       product-variant middleware, and real route.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer scans Store product variants, and the generated proof manifest
       drops duplicate Store product-variant imports/routes/middleware.
     - `packages/medusa/jest.config.js` maps the framework namespace to source
       with an `awilix` dependency-wrapper exception so Jest resolves the real
       middleware runtime helpers with one framework instance.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, `test:cart-do-sqlite`, and `git diff --check`.
118. Add Store locales to the package-owned static HTTP manifest and remove
     duplicate Store locales generation from the app-owned proof manifest.
     Completed in `320e061ae8`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Store locales and `storeLocalesRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real feature-flagged Store locales route and middleware.
     - The focused Express static-manifest smoke enables the translation flag
       during route registration and calls `GET /store/locales` through the
       generated manifest, publishable-key middleware, and real query-backed
       route.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer scans Store locales, and the generated proof manifest drops
       duplicate Store locales imports/routes/middleware.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
119. Next runtime step: evaluate Store shipping options as a workflow-engine
     route proof before moving more workflow-backed Store routes into the
     package-owned static manifest.
120. Add Store shipping options to the package-owned static HTTP manifest and
     remove duplicate Store shipping-options generation from the app-owned
     proof manifest. Completed in `0f1f2a6c6b`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Store shipping-options list/calculate routes and
       `storeShippingOptionRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real workflow-backed Store shipping-options routes and middleware.
     - The focused Express static-manifest smoke now calls
       `GET /store/shipping-options` through the generated manifest,
       publishable-key middleware, route-local query validation, workflow
       engine resolution, and real route.
     - The smoke records the current Medusa list behavior that the workflow
       receives `fields: []` when no explicit fields query is provided.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer scans Store shipping options, and the generated proof manifest
       drops duplicate Store shipping-options imports/routes/middleware.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
121. Next runtime step: either continue reducing the app-owned proof manifest
     with another narrow route group or switch back to the HTTP adapter/runtime
     boundary now that a workflow-backed Store route is package-owned.
122. Track the remaining HTTP static manifest migration as an explicit goal in
     `plan/fork-changes/http-static-manifest-migration-goal.md`. Completed in
     `113d1993ec`:
     - The goal records the stop condition: every app-owned route group must
       be either moved into a package-owned Medusa static manifest and
       validated, or explicitly deferred with a reason.
     - Current count is 11 package-owned groups moved and 27 app-owned route
       groups still pending.
     - Future route-moving turns must update the touched checklist rows,
       implementation commit, relevant domain record, and validation evidence.
123. Add Admin plugins and Admin feature-flags to the package-owned static HTTP
     manifest and remove duplicate app-owned proof generation for those admin
     utility routes. Completed in `75a4675c6d`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       `packages/medusa/src/api/admin/plugins/route.ts` and
       `packages/medusa/src/api/admin/feature-flags/route.ts`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin plugins route, which remains protected by Admin auth, and
       the real Admin feature-flags route, which still exports
       `AUTHENTICATE = false`.
     - The focused Express static-manifest smoke now calls
       `GET /admin/plugins` with a session `auth_context` and
       `GET /admin/feature-flags` with the real feature-flag router registered
       in scope.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer scans Admin plugins or Admin feature-flags, and the generated
       proof manifest drops duplicate imports/routes for that group.
     - The HTTP static manifest migration checklist now has 12 moved or
       already package-owned groups and 26 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
124. Next route-ownership step: continue with another small admin route group
     from `plan/fork-changes/http-static-manifest-migration-goal.md`, likely
     Admin stores or Admin product tags.
125. Add Admin stores to the package-owned static HTTP manifest and remove
     duplicate app-owned proof generation for that route group. Completed in
     `2bb555b8df`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin stores list/retrieve routes and `adminStoreRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin stores list, retrieve, and update handlers plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/stores` through Admin session auth, route-local query
       validation, and the real remote-query-backed route.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer lists Admin stores routes or scans their middleware, and the
       generated proof manifest drops duplicate Admin stores entries.
     - The HTTP static manifest migration checklist now has 13 moved or
       already package-owned groups and 25 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite` after rerunning a
       transient Vite Worker harness network failure.
126. Next route-ownership step: continue with Admin product tags or another
     small admin route group before workflow-heavy/auth-sensitive groups.
127. Add Admin product tags to the package-owned static HTTP manifest and
     remove duplicate app-owned proof generation for that route group.
     Completed in `bdf646dd8b`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin product-tags route and `adminProductTagRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin product-tags list/create handler module plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/product-tags` through Admin session auth, route-local query
       validation, and the real `refetchEntities` query-backed route.
     - The smoke records that Admin refetch currently calls `query.graph`
       without a locale options object, unlike Store localized routes.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer lists Admin product-tags routes or scans their middleware, and
       the generated proof manifest drops duplicate Admin product-tags entries.
     - The HTTP static manifest migration checklist now has 14 moved or
       already package-owned groups and 24 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
128. Next route-ownership step: continue with Admin product types or another
     small admin metadata route group before workflow-heavy/auth-sensitive
     groups.
129. Add Admin product types to the package-owned static HTTP manifest and
     remove duplicate app-owned proof generation for that route group.
     Completed in `1928a2252f`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin product-types list/retrieve routes and
       `adminProductTypeRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin product-types list/create and retrieve/update/delete handler
       modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/product-types` through Admin session auth, route-local query
       validation, and the real remote-query-backed list route.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer scans Admin product types routes or middleware, and the generated
       proof manifest drops duplicate Admin product-types entries.
     - The HTTP static manifest migration checklist now has 15 moved or
       already package-owned groups and 23 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
130. Next route-ownership step: continue with a small or medium admin route
     group such as Admin collections, Admin regions, or Admin sales channels.
131. Add Admin regions to the package-owned static HTTP manifest and remove
     duplicate app-owned proof generation for that route group. Completed in
     `87704c1440`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin regions list/retrieve routes and `adminRegionRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin regions list/create and retrieve/update/delete handler
       modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/regions` through Admin session auth, route-local query
       validation, and the real remote-query-backed list route.
     - The smoke records the current loader-path behavior that
       `GET /admin/regions` returns `limit: 50` from generated remote-query
       metadata in the test harness.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer scans Admin regions routes or middleware, and the generated
       proof manifest drops duplicate Admin regions entries.
     - The HTTP static manifest migration checklist now has 16 moved or
       already package-owned groups and 22 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
132. Next route-ownership step: continue with Admin collections or Admin sales
     channels before workflow-heavy/auth-sensitive groups.
133. Add Admin sales channels to the package-owned static HTTP manifest and
     remove duplicate app-owned proof generation for that route group.
     Completed in `67d45fd3b4`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin sales-channel list/retrieve/product-link routes and
       `adminSalesChannelRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin sales-channel list/create, retrieve/update/delete, and
       product-link handler modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/sales-channels` through Admin session auth, route-local
       query validation, link-filter middleware, and the real
       remote-query-backed list route.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer lists Admin sales-channel routes or scans their middleware, and
       the generated proof manifest drops duplicate Admin sales-channel
       entries.
     - The HTTP static manifest migration checklist now has 17 moved or
       already package-owned groups and 21 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
134. Next route-ownership step: continue with Admin collections or another
     medium admin metadata route group before workflow-heavy/auth-sensitive
     groups.
135. Add Admin collections to the package-owned static HTTP manifest and
     remove duplicate app-owned proof generation for that route group.
     Completed in `6377bb0add`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin collection list/retrieve/product-link routes and
       `adminCollectionRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin collection list/create, retrieve/update/delete, and
       product-link handler modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/collections` through Admin session auth, route-local query
       validation, and the real remote-query-backed list route.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer lists Admin collection routes or scans their middleware, and the
       generated proof manifest drops duplicate Admin collection entries.
     - The HTTP static manifest migration checklist now has 18 moved or
       already package-owned groups and 20 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
136. Next route-ownership step: continue with Admin price preferences or
     Admin refund reasons before workflow-heavy/auth-sensitive groups.
137. Add Admin price preferences to the package-owned static HTTP manifest and
     remove duplicate app-owned proof generation for that route group.
     Completed in `a58462ad86`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin price-preference list/retrieve routes and
       `adminPricePreferencesRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin price-preference list/create and retrieve/update/delete
       handler modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/price-preferences` through Admin session auth, route-local
       query validation, and the real `refetchEntities` query-backed list
       route. The smoke records the current route behavior of `limit: 300`.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer lists Admin price-preference routes or scans their middleware,
       and the generated proof manifest drops duplicate Admin price-preference
       entries.
     - The HTTP static manifest migration checklist now has 19 moved or
       already package-owned groups and 19 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
138. Next route-ownership step: continue with Admin refund reasons or Admin
     fulfillment providers before workflow-heavy/auth-sensitive groups.
139. Add Admin refund reasons to the package-owned static HTTP manifest and
     remove duplicate app-owned proof generation for that route group.
     Completed in `69e1cfa9ee`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin refund-reason list/retrieve routes and
       `adminRefundReasonsRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin refund-reason list/create and retrieve/update/delete handler
       modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/refund-reasons` through Admin session auth, route-local
       query validation, and the real `refetchEntities` query-backed list
       route. The smoke records the current route behavior of `limit: 15`.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer scans Admin refund-reason routes or middleware, and the generated
       proof manifest drops duplicate Admin refund-reason entries.
     - The HTTP static manifest migration checklist now has 20 moved or
       already package-owned groups and 18 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
140. Next route-ownership step: continue with Admin fulfillment providers or
     Admin shipping profiles before workflow-heavy/auth-sensitive groups.
141. Add Admin fulfillment providers to the package-owned static HTTP manifest
     and remove duplicate app-owned proof generation for that route group.
     Completed in `8f20d3d8ff`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists the
       Admin fulfillment-provider list route and
       `adminFulfillmentProvidersRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin fulfillment-provider list handler module plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/fulfillment-providers` through Admin session auth,
       route-local query validation, link-filter middleware, and the real
       remote-query-backed list route.
     - The existing
       `packages/medusa/src/api/admin/fulfillment-providers/[id]/options/route.ts`
       remains out of this slice because the app proof generator did not
       previously own it.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer lists Admin fulfillment-provider routes or scans their
       middleware, and the generated proof manifest drops duplicate Admin
       fulfillment-provider entries.
     - The HTTP static manifest migration checklist now has 21 moved or
       already package-owned groups and 17 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
142. Next route-ownership step: continue with Admin shipping profiles or Admin
     shipping option types before workflow-heavy/auth-sensitive groups.
143. Add Admin shipping profiles to the package-owned static HTTP manifest and
     remove duplicate app-owned proof generation for that route group.
     Completed in `8cddeab413`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin shipping-profile list/retrieve routes and
       `adminShippingProfilesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin shipping-profile list/create and retrieve/update/delete
       handler modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/shipping-profiles` through Admin session auth,
       route-local query validation, and the real remote-query-backed list
       route.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer scans Admin shipping-profile routes or middleware, and the
       generated proof manifest drops duplicate Admin shipping-profile entries.
     - The HTTP static manifest migration checklist now has 22 moved or
       already package-owned groups and 16 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
144. Next route-ownership step: continue with Admin shipping option types or
     Admin tax regions before workflow-heavy/auth-sensitive groups.
145. Add Admin shipping option types to the package-owned static HTTP manifest
     and remove duplicate app-owned proof generation for that route group.
     Completed in `445ee5c0b6`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin shipping-option-type list/retrieve routes and
       `adminShippingOptionTypeRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin shipping-option-type list/create and retrieve/update/delete
       handler modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/shipping-option-types` through Admin session auth,
       route-local query validation, and the real `query.graph`-backed list
       route.
     - The smoke records that this handler calls `query.graph(...)` with a
       single argument, not an explicit second `undefined` options argument.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer scans Admin shipping-option-type routes or middleware, and the
       generated proof manifest drops duplicate Admin shipping-option-type
       entries.
     - The HTTP static manifest migration checklist now has 23 moved or
       already package-owned groups and 15 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
146. Next route-ownership step: continue with Admin tax regions or Admin
     fulfillment sets before workflow-heavy/auth-sensitive groups.
147. Add Admin tax regions to the package-owned static HTTP manifest and remove
     duplicate app-owned proof generation for that route group. Completed in
     `d94b84148e`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin tax-region list/retrieve routes and
       `adminTaxRegionRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin tax-region list/create and retrieve/update/delete handler
       modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/tax-regions` through Admin session auth, route-local query
       validation, and the real remote-query-backed list route.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer scans Admin tax-region routes or middleware, and the generated
       proof manifest drops duplicate Admin tax-region entries.
     - The HTTP static manifest migration checklist now has 24 moved or
       already package-owned groups and 14 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite` after rerunning a
       transient Vite Worker harness network failure.
148. Next route-ownership step: continue with Admin fulfillment sets or Admin
     product categories before workflow-heavy/auth-sensitive groups.
149. Add Admin fulfillment sets to the package-owned static HTTP manifest and
     remove duplicate app-owned proof generation for that route group.
     Completed in `b9778a542d`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin fulfillment-set delete, service-zone create, and service-zone
       retrieve/update/delete routes plus `adminFulfillmentSetsRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin fulfillment-set and nested service-zone handler modules plus
       middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/fulfillment-sets/:id/service-zones/:zone_id` through Admin
       session auth, nested service-zone middleware registration, route-local
       query validation, and the real remote-query-backed retrieve route.
     - The smoke records that nested `*geo_zones` compiles into scalar
       `service_zones.fields` plus nested `service_zones.geo_zones.fields`.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer scans Admin fulfillment-set routes or middleware, and the
       generated proof manifest drops duplicate Admin fulfillment-set entries.
     - The HTTP static manifest migration checklist now has 25 moved or
       already package-owned groups and 13 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
150. Next route-ownership step: continue with Admin product categories or
     Admin stock locations before workflow-heavy/auth-sensitive groups.
151. Add Admin product categories to the package-owned static HTTP manifest
     and remove duplicate app-owned proof generation for that route group.
     Completed in `720ef3f74b`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin product-category list/retrieve/product-link routes and
       `adminProductCategoryRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin product-category list/create, retrieve/update/delete, and
       product-link handler modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/product-categories` through Admin session auth, route-local
       query validation, and the real `query.graph`-backed list route.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer scans Admin product-category routes or middleware, and the
       generated proof manifest drops duplicate Admin product-category entries.
     - The HTTP static manifest migration checklist now has 26 moved or
       already package-owned groups and 12 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
152. Next route-ownership step: continue with Admin stock locations or Admin
     API keys before the larger workflow-heavy route groups.
153. Add Admin stock locations to the package-owned static HTTP manifest and
     remove duplicate app-owned proof generation for that route group.
     Completed in `a0b0d3bd90`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin stock-location list/retrieve/link routes and
       `adminStockLocationRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin stock-location list/create, retrieve/update/delete,
       sales-channel link, fulfillment-set create, and fulfillment-provider
       link handler modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/stock-locations` through Admin session auth, route-local
       query validation, link-filter middleware registration, and the real
       remote-query-backed list route.
     - The smoke records that nested address fields compile into scalar
       `stock_locations.fields` plus nested `stock_locations.address.fields`.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer lists Admin stock-location routes or scans their middleware, and
       the generated proof manifest drops duplicate Admin stock-location
       entries.
     - The HTTP static manifest migration checklist now has 27 moved or
       already package-owned groups and 11 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
154. Next route-ownership step: continue with Admin API keys or Admin
     inventory before the larger workflow-heavy route groups.
155. Add Admin API keys to the package-owned static HTTP manifest and remove
     duplicate app-owned proof generation for that route group. Completed in
     `8c940d966c`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin API-key list/retrieve/revoke/sales-channel routes and
       `adminApiKeyRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin API-key list/create, retrieve/update/delete, revoke, and
       sales-channel link handler modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/api-keys` through Admin session auth, route-local query
       validation, and the real remote-query-backed list route.
     - The smoke records that nested sales-channel fields compile into scalar
       `api_key.fields` plus nested `api_key.sales_channels.fields`.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer lists Admin API-key routes or scans their middleware, and the
       generated proof manifest drops duplicate Admin API-key entries.
     - The HTTP static manifest migration checklist now has 28 moved or
       already package-owned groups and 10 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
156. Next route-ownership step: continue with Admin inventory or Admin
     reservations before the larger workflow-heavy route groups.
157. Add Admin inventory to the package-owned static HTTP manifest and remove
     duplicate app-owned proof generation for that route group. Completed in
     `37339eedad`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin inventory item list/retrieve and per-item location-level routes
       plus `adminInventoryRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin inventory item list/create, retrieve/update/delete, and
       per-item location-level list/create handler modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/inventory-items` through Admin session auth, route-local
       query validation, and the real remote-query-backed list route.
     - The smoke records that nested location-level fields compile into scalar
       `inventory_items.fields` plus nested
       `inventory_items.location_levels.fields`.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer lists Admin inventory routes or scans their middleware, and the
       generated proof manifest drops duplicate Admin inventory entries.
     - The broader inventory batch and location-level detail subroutes remain
       out of this slice because the app proof generator did not previously
       own them.
     - The HTTP static manifest migration checklist now has 29 moved or
       already package-owned groups and 9 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite` after rerunning a
       transient Vite Worker harness network failure.
158. Next route-ownership step: continue with Admin reservations or Admin
     locales before the larger workflow-heavy route groups.
159. Add Admin reservations to the package-owned static HTTP manifest and
     remove duplicate app-owned proof generation for that route group.
     Completed in `7e00e5a719`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin reservation list/retrieve routes plus
       `adminReservationRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin reservation list/create and retrieve/update/delete handler
       modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/reservations` through Admin session auth, route-local query
       validation, and the real remote-query-backed list route.
     - The smoke records that nested inventory-item fields compile into scalar
       `reservation.fields` plus nested `reservation.inventory_item.fields`.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer lists Admin reservation routes or scans their middleware, and
       the generated proof manifest drops duplicate Admin reservation entries.
     - The HTTP static manifest migration checklist now has 30 moved or
       already package-owned groups and 8 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
160. Next route-ownership step: continue with Admin locales or Admin
     translations before the larger workflow-heavy route groups.
161. Add Admin locales to the package-owned static HTTP manifest and remove
     duplicate app-owned proof generation for that feature-flagged route group.
     Completed in `8e43da3078`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin locale list/retrieve routes plus `adminLocalesRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real feature-flagged Admin locale list and retrieve handler modules
       plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /admin/locales` through translation-feature-enabled route
       registration, Admin session auth, route-local query validation, and the
       real cached `query.graph` locale list route.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer lists Admin locale routes or scans their middleware, and the
       generated proof manifest drops duplicate Admin locale entries.
     - The HTTP static manifest migration checklist now has 31 moved or
       already package-owned groups and 7 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
162. Next route-ownership step: continue with Admin translations batch or
     Store customers before the larger workflow-heavy route groups.
163. Add Admin translations batch to the package-owned static HTTP manifest
     and remove duplicate app-owned proof generation for that feature-flagged
     workflow route group.
     Completed in `2111498a2e`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists the
       Admin translations batch route plus `adminTranslationsRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real feature-flagged Admin translations batch handler module plus
       middleware.
     - The focused Express static-manifest smoke now calls
       `POST /admin/translations/batch` through translation-feature-enabled
       route registration, Admin session auth, route-local body validation,
       the real `batch-translations` workflow call, and `query.graph`
       translation refetch.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer lists the Admin translations batch route or scans translations
       middleware, and the generated proof manifest drops duplicate Admin
       translations entries.
     - Other Admin translations routes remain outside this slice because the
       app proof generator did not previously own them.
     - The HTTP static manifest migration checklist now has 32 moved or
       already package-owned groups and 6 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
164. Next route-ownership step: continue with Store customers or Auth before
     the larger workflow-heavy route groups.
165. Add Store customers to the package-owned static HTTP manifest and remove
     duplicate app-owned proof generation for that auth-sensitive route group.
     Completed in `7bd87d25a7`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Store customer account routes plus `storeCustomerRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Store customer account handler modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /store/customers/me` through publishable-key store middleware,
       customer session authentication, route-local query validation, and the
       real customer `remoteQuery` refetch helper.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer lists Store customer routes or scans their middleware, and the
       generated proof manifest drops duplicate Store customer entries.
     - The HTTP static manifest migration checklist now has 33 moved or
       already package-owned groups and 5 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite` after rerunning a
       workerd-backed Vite server startup timeout.
166. Next route-ownership step: continue with Auth before the larger
     workflow-heavy route groups.
167. Add Auth provider routes to the package-owned static HTTP manifest and
     remove duplicate app-owned proof generation for that auth route group.
     Completed in `13ea2356fe`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists the
       dynamic Auth provider route files plus `authRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Auth provider handler modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `GET /auth/customer/emailpass` through route params, configured
       actor/provider association middleware, and the real Auth service
       `authenticate` call.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer lists dynamic Auth provider routes or scans Auth middleware, and
       the generated proof manifest drops duplicate Auth entries.
     - Auth session, token refresh, and callback route files remain outside
       this slice because the app proof generator did not previously own those
       route files.
     - The HTTP static manifest migration checklist now has 34 moved or
       already package-owned groups and 4 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite` after rerunning Vite
       workerd startup and network-disconnect harness failures.
168. Next route-ownership step: continue with one of the four remaining
     workflow-heavy groups: Admin promotions, Admin shipping options, Admin
     products, or Store carts.
169. Add Admin promotions to the package-owned static HTTP manifest and remove
     duplicate app-owned proof generation for that workflow-backed route
     group.
     Completed in `88b8bb97e5`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin promotion list/create route plus
       `adminPromotionRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin promotion handler module plus middleware.
     - The focused Express static-manifest smoke now calls
       `POST /admin/promotions` through Admin session auth, route-local body
       and query validation, the real `create-promotions` workflow call, and
       the real promotion `remoteQuery` refetch helper.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer lists the Admin promotion route or scans promotion middleware,
       and the generated proof manifest drops duplicate Admin promotion
       entries.
     - Admin promotion detail, rule batch, and rule option subroutes remain
       outside this slice because the app proof generator did not previously
       own those route files.
     - The HTTP static manifest migration checklist now has 35 moved or
       already package-owned groups and 3 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite` after rerunning a
       workerd-backed Vite server startup timeout.
170. Next route-ownership step: continue with one of the three remaining
     workflow-heavy groups: Admin shipping options, Admin products, or Store
     carts.
171. Add Admin shipping options to the package-owned static HTTP manifest and
     remove duplicate app-owned proof generation for that folder-scanned route
     group.
     Completed in `e0bd3015a5`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists
       Admin shipping option list/create, retrieve/update/delete, and rules
       batch route files plus `adminShippingOptionRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin shipping option handler modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `POST /admin/shipping-options` through Admin session auth,
       route-local body and query validation, the real
       `create-shipping-options-workflow` call, and the real shipping option
       `query.graph` refetch helper.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer scans Admin shipping option routes or middleware, and the
       generated proof manifest drops duplicate Admin shipping option entries.
     - This removes the last app-owned route folder scan; the remaining
       app-owned route groups are explicit file lists.
     - The HTTP static manifest migration checklist now has 36 moved or
       already package-owned groups and 2 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite`.
172. Next route-ownership step: continue with Admin products or Store carts,
     the two remaining app-owned route groups.
173. Add Admin products to the package-owned static HTTP manifest and remove
     duplicate app-owned proof generation for that explicit route-file group.
     Completed in `b9bb22f9fc`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists the
       Admin product list/create, batch, retrieve/update/delete, variant,
       variant batch, image variant batch, and option route files plus
       `adminProductRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Admin product handler modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `POST /admin/products` through Admin session auth, route-local body and
       query validation, the real `create-products` workflow call, and the
       real product `query.graph` refetch helper.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` no
       longer lists Admin product routes or scans product middleware, and the
       generated proof manifest drops duplicate Admin product entries.
     - Product import/export and variant inventory-item subroutes remain
       outside this slice because the app proof generator did not previously
       own those route files.
     - The HTTP static manifest migration checklist now has 37 moved or
       already package-owned groups and 1 app-owned group still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite` after rerunning a
       workerd-backed Vite server startup timeout.
174. Next route-ownership step: move Store carts, the final remaining
     app-owned route group, then stop route-list migration and switch to the
     HTTP adapter/runtime boundary.
175. Add Store carts to the package-owned static HTTP manifest and remove the
     final app-owned Medusa route list from the Cloudflare proof generator.
     Completed in `b8a38b2dcd`:
     - `packages/medusa/static-http-manifests/store-admin.json` now lists the
       Store cart create/retrieve/update, line-item, promotion,
       shipping-method, taxes, customer, and complete route files plus
       `storeCartRoutesMiddlewares`.
     - Generated `packages/medusa/src/static/http-manifest.ts` imports the
       real Store cart handler modules plus middleware.
     - The focused Express static-manifest smoke now calls
       `POST /store/carts` through Store request handling, route-local body
       and query validation, the real `create-cart` workflow call, and the
       real cart `remoteQuery` refetch helper.
     - `apps/medusa-cloudflare/scripts/generate-http-proof-manifest.mjs` now
       emits an empty Medusa proof manifest. The Cloudflare app merges
       package-owned Medusa routes and keeps only proof-only routes at the app
       layer.
     - The HTTP static manifest migration checklist now has 38 moved or
       already package-owned groups and 0 app-owned groups still pending.
     - Validation passed: manifest generation and drift checks, focused
       Express static-manifest smoke, Medusa package build, Worker
       proof-manifest drift check, `medusa-cloudflare` typecheck, composed
       Worker import guard, and `test:cart-do-sqlite` after rerunning a
       workerd-backed Vite server startup timeout.
176. Route-list migration is complete. Continue with the shared HTTP
     adapter/runtime boundary and stop adding Medusa route ownership to the
     Cloudflare app.
177. Move static HTTP manifest merge behavior from the Cloudflare proof app
     into the framework static HTTP utilities.
     Completed in `cc981688ef`:
     - `@medusajs/framework/http/static` now exports
       `mergeStaticHttpResourceManifests`.
     - The helper merges routes by `relativePath` and middleware by `source`,
       with later manifests replacing earlier keyed entries while preserving
       ordering.
     - `apps/medusa-cloudflare/src/http-proof/manifest.ts` no longer contains
       local Medusa manifest merge logic; it imports the shared helper and
       composes package-owned Medusa routes with proof-only app routes.
     - Validation passed: focused framework static HTTP tests, framework
       build, `medusa-cloudflare` typecheck, composed Worker import guard,
       focused Medusa static-manifest smoke, `test:cart-do-sqlite` after
       rerunning a workerd-backed Vite server startup timeout, and
       `git diff --check`.
178. Next HTTP runtime-boundary step: move reusable Fetch runtime composition
     helpers out of `apps/medusa-cloudflare/src/static-http-proof.ts` while
     keeping proof-only services and setup routes app-owned.
179. Move reusable Fetch static handler composition from the Cloudflare proof
     app into the framework Fetch HTTP subpath.
     Completed in `68e80fd0ee`:
     - `@medusajs/framework/http/fetch` now exports
       `createFetchHttpStaticHandler`.
     - The helper owns static-manifest path matching, setup-path matching,
       optional setup request interception, lazy `FetchHttpAdapter`
       construction, and request delegation.
     - `apps/medusa-cloudflare/src/static-http-proof.ts` now passes app-owned
       proof resources, proof manifest, setup hooks, request-scope creation,
       and request preparation into the framework helper.
     - Proof-only fake services remain app-owned.
     - Validation passed: focused Fetch adapter/subpath tests, framework
       build, `medusa-cloudflare` typecheck, composed Worker import guard,
       focused Medusa static-manifest smoke, `test:cart-do-sqlite`, and
       `git diff --check`.
180. Next HTTP runtime-boundary step: inspect
     `apps/medusa-cloudflare/src/http-proof/resources.ts` for reusable
     request-scope or proof-resource assembly boundaries that can move into
     package code without moving proof-only fake services.
181. Move reusable static HTTP resource-set composition from the Cloudflare
     proof app into the framework static HTTP utilities.
     Completed in `1b56da771d`:
     - `@medusajs/framework/http/static` now exports
       `composeStaticHttpResourceSets`.
     - The helper concatenates routes, middlewares, body-parser config routes,
       and additional-data validator routes in caller order, with later error
       handlers replacing earlier ones.
     - `apps/medusa-cloudflare/src/http-proof/resources.ts` now uses the
       helper to layer proof global middlewares, package-owned Medusa manifest
       resources, and proof tail middlewares/error handling.
     - Proof-only fake services, setup routes, and request preparation remain
       app-owned.
     - Validation passed: focused static HTTP resource/subpath tests,
       framework build, `medusa-cloudflare` typecheck, composed Worker import
       guard, focused Medusa static-manifest smoke, `test:cart-do-sqlite`, and
       `git diff --check`.
182. Next HTTP runtime-boundary step: inspect the remaining request-scope and
     request-preparation code in
     `apps/medusa-cloudflare/src/http-proof/resources.ts`. Move only reusable
     Fetch/Medusa request lifecycle helpers into framework; leave proof-only
     auth headers, fake services, and setup state in the app.
183. Move reusable request auth and publishable-key context access into
     framework HTTP utilities.
     Completed in `350cee1310`:
     - Framework HTTP entrypoints now export
       `getMedusaRequestAuthContext`, `setMedusaRequestAuthContext`,
       `getMedusaRequestPublishableKeyContext`, and
       `setMedusaRequestPublishableKeyContext`.
     - The helpers centralize request context assertions and can persist auth
       context into `req.session.auth_context` when session-aware middleware
       needs it.
     - Framework `authenticate`, publishable-key middleware, Fetch policy
       checks, Fetch adapter tests, and the Cloudflare proof request
       preparation now use the shared helpers.
     - Proof-only header decoding, fake services, setup routes, and setup
       state remain app-owned.
     - Validation passed: focused request-context/Fetch adapter/subpath tests,
       framework build, `medusa-cloudflare` typecheck, composed Worker import
       guard, focused Medusa static-manifest smoke, `test:cart-do-sqlite`, and
       `git diff --check`.
184. Next HTTP runtime-boundary step: inspect the remaining proof setup-path
     handler and request setup state in
     `apps/medusa-cloudflare/src/http-proof/resources.ts`. Only extract a
     shared framework boundary if it is generic HTTP lifecycle behavior;
     proof-only setup state and fake service data stay in the app.
185. Move reusable static setup-path pattern matching into framework static
     HTTP utilities.
     Completed in `33028a356f`:
     - `@medusajs/framework/http/static` now exports
       `createStaticHttpPathPatternMatcher` and
       `matchStaticHttpPathPattern`.
     - The helper matches exact string paths and regular expression patterns,
       resetting regular expression state before each match.
     - `apps/medusa-cloudflare/src/http-proof/resources.ts` now keeps the
       proof-owned setup path list as data and delegates matching to the
       framework helper.
     - Proof-only setup responses, fake service state, and setup request
       routing remain app-owned.
     - Validation passed: focused static path matcher/subpath tests,
       framework build, `medusa-cloudflare` typecheck, composed Worker import
       guard, focused Medusa static-manifest smoke, `test:cart-do-sqlite`, and
       `git diff --check`.
186. Next HTTP runtime-boundary step: stop extracting from proof setup
     responses unless a real generic framework boundary appears. The remaining
     `handleStaticHttpProofSetupRequest` body is mostly proof-owned fake data
     routing, so choose the next practical HTTP-runtime step from package
     bootstrap or test-runner integration rather than moving fake setup
     handlers.
187. Move the Cloudflare Worker dev-server launcher out of the generic
     `startApp` bootstrap into a dedicated `@medusajs/test-utils` helper.
     Completed in `421621cc39`:
     - `bootstrap-app.ts` still owns `MEDUSA_TEST_HTTP_RUNTIME` selection and
       Medusa container bootstrap.
     - Worker process spawning, output capture, health polling, health timeout
       resolution, and process-tree shutdown now live in
       `cloudflare-worker-process.ts`.
     - The existing integration-test package scripts and runtime selector are
       unchanged.
     - Validation passed: `@medusajs/test-utils` focused tests and build,
       focused Admin currency Cloudflare HTTP integration through the existing
       runner, composed Worker import guard, and `git diff --check`.
188. Next HTTP runtime-boundary step: continue package bootstrap/test-runner
     cleanup only where it isolates Cloudflare-specific runtime mechanics
     behind narrow helpers. Do not move proof-owned fake setup handlers out of
     the Cloudflare app unless a real shared framework boundary appears.
189. Move Cloudflare Worker workspace-root lookup into the Worker process
     helper.
     Completed in `9102e3a96e`:
     - `cloudflare-worker-process.ts` now locates the Yarn workspace root from
       the supplied `cwd` before spawning the `medusa-cloudflare` dev server.
     - `bootstrap-app.ts` no longer imports filesystem traversal helpers for
       the Cloudflare Worker process path.
     - Focused tests cover successful lookup from a child directory and the
       missing-Yarn-release error case.
     - Validation passed: `@medusajs/test-utils` focused tests and build,
       focused Admin currency Cloudflare HTTP integration through the existing
       runner, composed Worker import guard, and `git diff --check`.
190. Next HTTP runtime-boundary step: inspect the remaining `bootstrap-app.ts`
     branches for another real runtime boundary. Stop if the next extraction
     would only move code for aesthetics.
191. Type the HTTP test bootstrap graceful Express server and pause bootstrap
     cleanup.
     Completed in `fe3dd40a43`:
     - `bootstrap-app.ts` now types the wrapped Express server as
       `Server & GracefulShutdownServer` instead of `any`.
     - No runtime selection behavior changed.
     - Inspection found no remaining useful bootstrap extraction boundary; the
       file now owns shared Medusa loader bootstrap, runtime selection, and the
       small Express server branch.
     - Validation passed: `@medusajs/test-utils` focused tests and build,
       composed Worker import guard, no remaining `any` in `bootstrap-app.ts`,
       and `git diff --check`.
192. Next HTTP runtime-boundary step: stop bootstrap cleanup for now. Return to
     real Cloudflare HTTP runtime convergence or the next unverified existing
     HTTP integration spec.
193. Align Cloudflare Queue Event Bus provider queue filtering with Redis
     worker-mode behavior.
     Completed in `4fc344b18d`:
     - `@medusajs/event-bus-cloudflare` now sends events to Cloudflare Queue
       only when a concrete event subscriber or wildcard subscriber is
       registered.
     - Interceptor execution is still preserved before the no-subscriber skip.
     - Grouped event release uses the same subscriber-aware queueing path.
     - The Redis-backed HTTP integration spec remains unchanged and locally
       blocked until a Redis-compatible service is available.
     - Validation passed: `@medusajs/event-bus-cloudflare` focused tests and
       build, composed Worker import guard, and `git diff --check`.
194. Next Event Bus step: continue provider-owned Cloudflare Queue parity or
     Worker queue-consumer proofs. Retry
     `event-bus/subscriber-registration.spec.ts` only when Redis is available;
     do not fake Redis or rewrite the unchanged assertion.
195. Fix Cloudflare Event Bus local unsubscribe parity.
     Completed in `81700a0b74`:
     - `@medusajs/event-bus-cloudflare` now tracks wrapped local subscribers
       by original subscriber function per event.
     - `unsubscribe(event, subscriber)` without context removes the wrapped
       local handler, matching the shared Event Bus API contract.
     - Unsubscribe by `subscriberId` remains supported for concrete and
       wildcard subscribers.
     - Validation passed: `@medusajs/event-bus-cloudflare` focused tests and
       build, composed Worker import guard, `medusa-cloudflare` typecheck, and
       `git diff --check`.
196. Next Event Bus step: add Worker queue-consumer proof coverage for
     subscriber lifecycle behavior, or rerun the unchanged Redis-backed HTTP
     spec only after Redis is available.
197. Add Worker queue-consumer proof coverage for Cloudflare Event Bus.
     Completed in `af1ae39809`:
     - `apps/medusa-cloudflare` now validates the Worker `queue` entrypoint for
       invalid message ack, valid subscriber dispatch plus ack, and subscriber
       failure retry.
     - `EVENT_CONSUMER_PROOFS` is narrowed to the proof stub shape needed by
       the Worker instead of the full Durable Object namespace.
     - The app Vite config now exports a shared alias/define/optimizeDeps
       fragment consumed by a Vitest-only config, keeping the Cloudflare Vite
       plugin out of Vitest dependency optimization.
     - The Store remote-query Worker proof now supplies the static publishable
       API key and asserts the richer response produced by the real middleware
       path.
     - Validation passed: `medusa-cloudflare` typecheck, Worker Vitest suite,
       composed Worker import guard, and `git diff --check`.
198. Next Event Bus step: continue package-owned Cloudflare subscriber parity
     or move to the next runtime-boundary slice. Retry the unchanged
     Redis-backed HTTP integration spec only when Redis is available.
199. Add package-owned queued subscriber lifecycle coverage for Cloudflare
     Event Bus.
     Completed in `a8fd279d3a`:
     - `@medusajs/event-bus-cloudflare` now validates that queued dispatch
       respects concrete unsubscribe without `subscriberId`.
     - The provider suite also validates wildcard unsubscribe by
       `subscriberId` for queued dispatch.
     - Queued events with no remaining subscribers are asserted as a no-op that
       does not re-enqueue or log processing.
     - Validation passed: `@medusajs/event-bus-cloudflare` focused tests and
       build, composed Worker import guard, and `git diff --check`.
200. Next runtime step: stop Event Bus proof expansion unless a concrete
     provider behavior gap is found. Move back to the broader runtime-boundary
     plan, or retry the unchanged Redis-backed HTTP integration spec only when
     Redis is available.
201. Re-check the HTTP runtime boundary after Event Bus proof work.
     Completed in this commit:
     - The HTTP static route-ownership goal is already complete: 38 tracked
       logical route groups moved or already package-owned, 0 pending.
     - The HTTP integration runner record already covers every unchanged HTTP
       spec with a current Cloudflare validation record except the Redis-backed
       Event Bus spec, which remains externally blocked by missing Redis.
     - `apps/medusa-cloudflare/src/static-http-proof.ts` is already a thin
       caller of `createFetchHttpStaticHandler`.
     - The remaining large app-owned HTTP proof file mostly owns fake proof
       services and fixture setup state. Do not move that into framework or
       package code; replace it later with the real Worker bootstrap.
     - Validation passed: repo inspection and `git diff --check`.
202. Next migration step: return to the first persistence/runtime milestone.
     Focus on unchanged Currency module service and unchanged Currency
     integration assertions passing across MikroORM/Postgres,
     Drizzle/SQLite or D1, and the Drizzle path inside workerd without Node or
     MikroORM imports.
203. Record that the Cloudflare app Vitest gate is recovered.
     Completed in this commit:
     - `yarn workspace medusa-cloudflare test` now passes again through the
       app-local Vitest config split.
     - Older Vite/Rolldown blocker notes remain historical; they should not be
       treated as current blockers for new Worker-entrypoint slices.
     - Validation passed: Worker Vitest suite, 1 file and 9 tests.
204. Next implementation step: continue the persistence/runtime milestone from
     the module-first lane. Use unchanged module integration suites through
     Drizzle/SQLite before expanding Worker composition or proof assertions.
205. Add the first portable Index provider boundary.
     Completed in this commit:
     - `IndexModuleService` no longer owns the Postgres/MikroORM reset-table
       truncate implementation directly.
     - The default Node loader registers a Postgres reset handler beside the
       existing Postgres storage provider, preserving normal Medusa behavior.
     - A new portable Index entry and loader require an explicit storage
       provider adapter from the application root and avoid importing the
       default Postgres provider.
     - Validation passed: `@medusajs/index` unit tests, `@medusajs/index`
       build, and the portable-entry import-boundary regression test.
     - The unchanged Index integration suite remains a Postgres-provider gate
       and was locally blocked by missing/unknown PostgreSQL credentials:
       5 suites failed while creating Postgres databases, and the non-DB
       orchestrator suite passed.
206. Next Index persistence step: add a minimal SQLite/D1 storage provider
     adapter behind the portable Index entry and run the existing Index
     integration assertions through that provider. Do not add a parallel
     Index service or app-local fake.
207. Add SQLite Index storage mutation provider.
     Completed in this commit:
     - `@medusajs/index/src/portable` now exports
       `SqliteIndexStorageProvider`.
     - The provider uses an injected SQL executor and owns SQLite DDL for
       `index_data` and `index_relation`.
     - Create, update, delete, attach, detach, and event rehydration paths are
       implemented against SQLite SQL mutations.
     - Query support intentionally fails loudly until a SQLite Index query
       builder is added.
     - Validation passed: `@medusajs/index` focused tests, `@medusajs/index`
       build, portable import-boundary regression, and `git diff --check`.
208. Next Index persistence step: implement the SQLite Index query builder
     required by the unchanged Index query integration assertions, then wire it
     into `SqliteIndexStorageProvider.query`.
209. Add SQLite Index root query support.
     Completed in this commit:
     - Added a portable SQLite query builder that does not import the
       Postgres/Knex query builder.
     - `SqliteIndexStorageProvider.query` now supports root `index_data`
       selection, direct JSON field filters, direct ordering, pagination
       metadata, and `idsOnly` responses.
     - Validation passed: `@medusajs/index` focused tests,
       `@medusajs/index` build, portable import-boundary regression, and
       `git diff --check`.
210. Next Index persistence step: implement SQLite relation traversal through
     `index_relation` for the product -> variant -> price-set -> price query
     path covered by the unchanged Index query integration assertions.
211. Add SQLite Index relation traversal.
     Completed in this commit:
     - The portable SQLite query plan now derives a relation tree from nested
       requested field paths.
     - `SqliteIndexStorageProvider.query` walks `index_relation`
       breadth-first and loads nested target rows from `index_data`.
     - The traversal covers the Product -> ProductVariant ->
       ProductVariantPriceSet -> PriceSet -> Price path and attaches nested
       `variants` and `prices` arrays.
     - Validation passed: `@medusajs/index` focused tests,
       `@medusajs/index` build, portable import graph check, and
       `git diff --check`.
212. Next Index persistence step: add SQLite nested filter/order support for
     variant SKU and price amount so more unchanged Index query assertions can
     run through the portable provider.
213. Add SQLite Index nested filter and order support.
     Completed in this commit:
     - Post-hydration nested filters now prune child arrays and remove parent
       rows with no matching nested children.
     - Join filters prune child arrays without removing otherwise matching
       parents.
     - Nested ordering now sorts child arrays by scalar or descendant aggregate
       values, covering variant SKU and price amount ordering in the
       Product/Variant/Price path.
     - Direct root filters remain SQL-owned to avoid double-filtering projected
       or `idsOnly` rows.
     - Validation passed: `@medusajs/index` focused tests,
       `@medusajs/index` build, portable import graph check, and
       `git diff --check`.
214. Next Index persistence step: add a SQLite-backed Index query assertion
     harness that seeds the existing Product/Variant/Price fixture shape and
     starts running unchanged Index query expectations against the portable
     provider.
215. Add SQLite-backed Index query harness.
     Completed in this commit:
     - The Index provider test suite now includes a typed `node:sqlite`
       executor.
     - The harness creates provider tables via `onApplicationStart`, seeds the
       existing Product/Variant/Price `index_data` and `index_relation`
       fixture shape, and runs the portable provider against real SQLite.
     - The first SQLite-backed assertion covers the nested product -> variant
       -> price response for the variant SKU filter case.
     - Validation passed: `@medusajs/index` focused tests,
       `@medusajs/index` build, portable import graph check, and
       `git diff --check`.
216. Next Index persistence step: expand the SQLite-backed harness with more
     unchanged Index query expectations and fix provider parity gaps only when
     those assertions expose them.
217. Expand SQLite-backed Index query harness.
     Completed in this commit:
     - Added real SQLite assertions for variant SKU descending order, price
       amount ascending/descending order, and `idsOnly` ordering by an
       unselected nested relation path.
     - Fixed the provider to hydrate relation paths required for filtering or
       ordering even when those paths are not selected in `fields`.
     - Split hydration relation trees from output relation trees so unselected
       nested relations can be used for sort/filter without appearing in the
       public response.
     - Validation passed: `@medusajs/index` focused tests,
       `@medusajs/index` build, portable import graph check, and
       `git diff --check`.
218. Next Index persistence step: continue harness expansion with root logical
     filters and combined nested filters from the unchanged Index query
     assertions.
219. Expand SQLite-backed Index logical filter harness.
     Completed in this commit:
     - Added real SQLite assertions for root `$not`, `$and`, `$like`, and
       `$ilike` filters.
     - Added real SQLite assertions for nested price amount filters and
       combined root title plus nested variant SKU filters.
     - Fixed SQLite planning so logical root filter keys are evaluated after
       load instead of being passed to scalar SQL value normalization.
     - Fixed nested negative-only filter semantics for parents with no
       relation children.
     - Added selected root scalar projection for cases such as `product.id`
       and `product.title`.
     - Validation passed: `@medusajs/index` focused tests,
       `@medusajs/index` build, portable import graph check, and
       `git diff --check`.
220. Next Index persistence step: continue expanding the SQLite-backed harness
     with the remaining projection-specific and duplicate filter/order cases
     from the unchanged Index query assertions.
221. Expand SQLite-backed Index projection and null-filter harness coverage.
     Completed in this commit:
     - Added real SQLite assertions for nested variant SKU `$ne: null`,
       `$not: { $eq: null }`, and `$eq: null`.
     - Added real SQLite assertions for nested price ordering when price rows
       are required for sorting but not selected in `fields`.
     - Added real SQLite assertions for the duplicate variant SKU `$in` plus
       nested price-order case from the unchanged Index query spec.
     - Narrowed empty relation filter semantics so only `$nin` can pass because
       a child relation is absent; `$ne: null` and `$not: { $eq: null }` now
       require an existing matching child row.
     - Validation passed: `@medusajs/index` focused tests,
       `@medusajs/index` build, portable import graph check, and
       `git diff --check`.
222. Next Index persistence step: continue expanding the SQLite-backed harness
     with full-result, pagination, and deep nested root JSON filter
     expectations from the unchanged Index query assertions.
223. Expand SQLite-backed Index full-result and pagination harness coverage.
     Completed in this commit:
     - Added real SQLite assertions for the full Product/Variant/Price result
       shape without filters or pagination.
     - Added real SQLite assertions for direct root `id` ordered pagination.
     - Added real SQLite assertions for deep root JSON filtering through
       `product.deep.obj.b`.
     - Added deferred pagination in the SQLite query plan when filters or
       ordering require post-load evaluation, while keeping SQL pagination for
       direct root-only plans.
     - Validation passed: `@medusajs/index` focused tests,
       `@medusajs/index` build, portable import graph check, and
       `git diff --check`.
224. Next Index persistence step: continue expanding the SQLite-backed harness
     with the remaining root `$not` and `$nin` expectations from the unchanged
     Index query assertions, then reassess what is still missing before
     attempting a broader Index runner path.
225. Complete SQLite-backed Index query assertion coverage.
     Completed in this commit:
     - Added real SQLite assertions for root product `$nin` filtering.
     - Added real SQLite assertions for variant SKU filtering with
       `joinFilters` price amount pruning.
     - Added real SQLite assertions for SKU descending ordering with specific
       nested field paths.
     - No production provider behavior changed; the existing SQLite provider
       path already satisfied these remaining expectation shapes.
     - Validation passed: `@medusajs/index` focused tests,
       `@medusajs/index` build, portable import graph check, and
       `git diff --check`.
226. Next Index persistence step: build a selectable Index integration runner
     path that can execute the original query-builder expectations against the
     portable SQLite provider, reusing the same fixture shape instead of adding
     more provider-only duplicate assertions.
227. Add SQLite Index service-level query runner.
     Completed in this commit:
     - Added a typed SQLite integration fixture that constructs the real
       `IndexModuleService` with `SqliteIndexStorageProvider`.
     - Registered Product, Pricing, and ProductVariant/PriceSet link joiner
       configs so the real Index schema builder resolves the original
       query-builder fixture schema.
     - Added `query-builder-sqlite.spec.ts`, proving representative original
       nested filter, nested order, pagination metadata, and root `$nin`
       expectations through `module.query`.
     - Kept the existing Postgres-backed query-builder spec unchanged.
     - Validation passed: direct SQLite service integration spec, focused Index
       unit tests, `@medusajs/index` build, portable import graph check, and
       `git diff --check`.
228. Next Index persistence step: extract the original query-builder
     expectations into a shared runner so the same assertions can execute
     against both the existing Postgres setup and the SQLite service harness
     without duplicating every test body.
229. Run shared Index query-builder assertions on SQLite.
     Completed in this commit:
     - Extracted the existing query-builder assertion bodies into
       `query-builder-shared.ts`.
     - Updated the Postgres-backed query-builder spec to keep its setup and
       delegate to the shared runner.
     - Updated the SQLite service query-builder spec to run all 19 shared
       assertions through the real `IndexModuleService.query` method.
     - Fixed SQLite relation-tree planning so generated refs for non-module
       nested JSON object types, such as `product.deep`, are not treated as
       relation hydration paths.
     - Validation passed: full SQLite service query-builder spec, focused
       Index unit tests, `@medusajs/index` build, portable import graph check,
       and `git diff --check`.
230. Next Index persistence step: add a package-owned SQLite integration
     command or runner selector for the Index query-builder service path, then
     continue toward Worker/D1 execution of the SQLite provider.
231. Add package-owned SQLite Index integration command.
     Completed in this commit:
     - Added `test:integration:sqlite` to `@medusajs/index`.
     - The command runs `query-builder-sqlite.spec.ts`, which executes the
       shared query-builder assertions through the real `IndexModuleService`
       and `SqliteIndexStorageProvider`.
     - Kept the existing all-spec `test:integration` command unchanged for the
       Postgres-backed Index integration suite.
     - Validation passed: `yarn workspace @medusajs/index
       test:integration:sqlite`, focused Index unit tests, `@medusajs/index`
       build, portable import graph check, and `git diff --check`.
232. Next Index persistence step: add a workerd/D1-facing executor or Worker
     proof for the SQLite Index provider, starting with the shared
     query-builder service path.
233. Add workerd Durable Object SQLite proof for the Index provider.
     Completed in this commit:
     - Made Index service startup injectable for the Node filesystem type
       generator and configuration checker so portable service composition does
       not statically import Node-only typegen code.
     - Added a focused `IndexProofDO` and isolated proof Worker that compose
       the real `IndexModuleService` with `SqliteIndexStorageProvider`.
     - Seeded the Product -> Variant -> Price Set -> Price graph into Durable
       Object SQLite and proved the existing `module.query` relation path in
       workerd.
     - Added `test:index-do-sqlite` to run the workerd proof and an isolated
       Vite/Wrangler entry for import-graph validation.
     - Validation passed: `@medusajs/index test:integration:sqlite`,
       `@medusajs/index build`, `medusa-cloudflare typecheck`, isolated Index
       proof Worker build, Index DO SQLite workerd proof, import guard, and
       `git diff --check`.
234. Next Index persistence step: either fold the isolated proof boundary back
     into reusable Worker composition or add a D1-facing executor abstraction.
     Do not expand Index relation edge cases until another unchanged assertion
     requires it.
235. Add Cloudflare SQLite executor boundary for Index.
     Completed in this commit:
     - Extracted the Durable Object SQLite executor out of `IndexProofDO` into
       a reusable Cloudflare Index executor adapter.
     - Added a D1-backed `SqliteIndexExecutor` implementation for the same
       provider contract.
     - Refactored the Index relation proof into a shared helper so Durable
       Object SQLite and D1 execute the same real `IndexModuleService` query
       path.
     - Added a focused D1 proof route to the isolated Index proof Worker and
       renamed the proof command to `test:index-sqlite`, keeping
       `test:index-do-sqlite` as a compatibility alias.
     - Validation passed: `medusa-cloudflare typecheck`, isolated Index proof
       Worker build, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, import guard, and
       `git diff --check`.
236. Next Index persistence step: reduce the isolated proof-only framework shim
     by moving the minimum adapter-safe Index composition exports into a
     reusable Worker composition entry, while keeping the full app bundle
     cleanup separate from Index provider behavior.
237. Add package-owned portable framework utils for Index.
     Completed in this commit:
     - Added `@medusajs/framework/utils/portable` as a narrow shared
       framework entry for Worker-safe Index composition.
     - Moved the portable Index service, SQLite provider, schema builder,
       default schema, and portable module entry to that subpath.
     - Removed the app-local `index-proof-framework-utils` shim from the
       isolated Index proof.
     - Added the small missing `@medusajs/utils` subpath exports needed by the
       portable framework entry without importing the broad utils barrel.
     - Changed the isolated proof runner to build the proof Worker and serve
       the built output through Wrangler, avoiding the Cloudflare Vite dev
       optimizer's CJS prebundle path.
     - Validation passed: `@medusajs/framework build`, `@medusajs/index
       build`, `@medusajs/index test:integration:sqlite`,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, import guard, and
       `git diff --check`.
238. Next Index persistence step: move the remaining app-local Index proof
     service composition helpers toward a reusable Index Worker composition
     module, then decide whether that module belongs in `@medusajs/index` or a
     Cloudflare provider package.
239. Move Index Worker composition into the Index package.
     Completed in this commit:
     - Added `@medusajs/index/worker-composition` with the SQLite Index
       service construction helper and relation-query proof fixture.
     - Slimmed `IndexProofDO` down to the Cloudflare Durable Object request
       wrapper plus executor selection.
     - Updated the isolated proof Worker to import the shared composition
       helper for D1 as well as Durable Object SQLite.
     - Exported `worker-composition`, `portable`, and the service subpaths
       from `@medusajs/index`.
     - Added Cloudflare app aliases for the shared composition entry in both
       proof and main Vite configs.
     - Validation passed: `@medusajs/index build`,
       `@medusajs/index test:integration:sqlite`,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, import guard, and
       `git diff --check`.
240. Next Index persistence step: replace the package-owned proof fixture
     joiner configs with reusable static joiner config inputs where possible,
     starting with Product and Pricing, so the Worker composition moves closer
     to real module manifests instead of embedded proof-only joiner shapes.
241. Reuse real Product and Pricing joiner configs in Index Worker
     composition.
     Completed in this commit:
     - Exported `@medusajs/product/joiner-config` and
       `@medusajs/pricing/joiner-config` as narrow package subpaths.
     - Extended `@medusajs/framework/utils/portable` with the DML model builder
       and enum helpers needed by Product/Pricing DML models.
     - Retargeted Product and Pricing model imports from the broad
       `@medusajs/framework/utils` barrel to
       `@medusajs/framework/utils/portable` for the joiner-config graph.
     - Replaced the proof-only Product and Pricing joiner config creators in
       `@medusajs/index/worker-composition` with the real module joiner
       configs.
     - Kept the ProductVariant/PriceSet link joiner config local to the Index
       proof until a reusable static link manifest is available.
     - Validation passed: `@medusajs/framework build`,
       `@medusajs/product build`, `@medusajs/pricing build`,
       `@medusajs/index build`, `@medusajs/index test:integration:sqlite`,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Node-only import guards, and
       `git diff --check`.
242. Next Index persistence step: replace the remaining local
     ProductVariant/PriceSet link joiner fixture with a reusable static link
     manifest shape, then prove the same Index relation query still passes in
     workerd.
243. Reuse the real ProductVariant/PriceSet link definition in Index Worker
     composition.
     Completed in this commit:
     - Exported `@medusajs/link-modules/definitions` and
       `@medusajs/link-modules/definitions/product-variant-price-set` as
       narrow package subpaths.
     - Added `LINKS` to `@medusajs/framework/utils/portable` and exported
       `@medusajs/utils/link/links`.
     - Narrowed `compose-link-name` so the link utility imports only the
       string helpers it needs instead of the broad common barrel.
     - Retargeted the real ProductVariant/PriceSet link definition to
       `@medusajs/framework/utils/portable`.
     - Replaced the local Index `ProductVariantPriceSetLink` proof config with
       the real `ProductVariantPriceSet` definition from link-modules.
     - Updated the proof seed data to use Medusa's real
       `LinkProductVariantPriceSet`, `variant_id`, and `price_set_id` link
       entity shape.
     - Validation passed: `@medusajs/utils build`, `@medusajs/framework build`,
       `@medusajs/link-modules build`, `@medusajs/index build`,
       `@medusajs/index test:integration:sqlite`, `medusa-cloudflare
       typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, and Node-only import guard.
     - Note: `@medusajs/link-modules build` must run after
       `@medusajs/framework build`; running them in parallel can fail while
       framework `dist` is being recreated.
244. Next Index persistence step: remove the remaining proof-only seed/schema
     duplication where possible by sharing Index SQLite relation proof fixtures
     between the Worker composition and the unchanged SQLite integration
     harness, then verify the same assertions still run in both Node and
     workerd.
245. Share the Index SQLite relation proof fixture between Node and Worker
     proof paths.
     Completed in this commit:
     - Added `packages/modules/index/src/relation-query-proof-fixture.ts` with
       the shared relation-query schema, real Product/Pricing/link joiner
       registration, table reset helper, and seed data.
     - Updated `@medusajs/index/worker-composition` to consume the shared
       fixture instead of owning local schema, joiner registration, and seed
       helpers.
     - Updated the Node SQLite integration harness to consume the same shared
       fixture and real link definition instead of the old
       `ProductVariantPriceSetLink` test-only config.
     - Verified the old proof-only link names are gone from the SQLite harness
       and Worker composition source paths.
     - Left the older integration `schema.ts` fixture in place because it is
       still used by the broader Index integration config tests and
       `medusa-config.js`.
     - Validation passed: `@medusajs/index build`,
       `@medusajs/index test:integration:sqlite`, `medusa-cloudflare
       typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, and Node-only import guard.
246. Next Index persistence step: reduce remaining Worker composition
     scaffolding by moving the generic test/proof service-construction helpers
     behind a reusable SQLite composition helper, while keeping the Node-only
     SQLite executor in the integration fixture.
247. Share SQLite Index service construction between Worker proof and Node
     integration harness.
     Completed in this commit:
     - Added `packages/modules/index/src/sqlite-index-service-composition.ts`
       with the shared `IndexModuleService` construction path for SQLite
       executors.
     - Moved generic logger, unused dependency guards, remote query double,
       base repository guard, module declaration, and SQLite storage provider
       wiring into the shared helper.
     - Updated `@medusajs/index/worker-composition` to focus on proof query
       execution and result extraction.
     - Updated the Node SQLite integration harness to keep only the
       `node:sqlite` executor and close behavior while using the same service
       construction helper as the Worker proof.
     - Validation passed: `@medusajs/index build`,
       `@medusajs/index test:integration:sqlite`, `medusa-cloudflare
       typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, stale service-construction
       scan, and Node-only import guard.
248. Next Index persistence step: decide whether the remaining
     `worker-composition` proof query/result extraction belongs in a
     package-owned proof runner entry or should stay as the thin proof API
     until more Index runtime behavior needs to share it.
249. Move Index relation query proof execution into a package-owned proof
     runner.
     Completed in this commit:
     - Added `packages/modules/index/src/relation-query-proof-runner.ts` for
       relation proof query execution, proof result extraction, and the
       proof-specific SQLite service wrapper.
     - Reduced `@medusajs/index/worker-composition` to a compatibility
       re-export of the proof runner API.
     - Exported `@medusajs/index/relation-query-proof-runner` and
       `@medusajs/index/sqlite-index-service-composition` as narrow package
       subpaths.
     - Kept the Cloudflare app imports unchanged so existing proof wiring still
       uses `@medusajs/index/worker-composition`.
     - Validation passed: `@medusajs/index build`,
       `@medusajs/index test:integration:sqlite`, `medusa-cloudflare
       typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, and Node-only import guard.
250. Next Index persistence step: audit whether the isolated Index proof now
     has enough package-owned composition to move from refactoring helpers to
     the next behavior gap, such as broader SQLite provider coverage or
     production app import-graph cleanup.
251. Point the Cloudflare Index proof app at the package-owned relation proof
     runner export.
     Completed in this commit:
     - Updated `IndexProofDO` and the D1 proof route to import
       `@medusajs/index/relation-query-proof-runner` directly.
     - Removed app-local Vite and TypeScript aliases for
       `@medusajs/index/worker-composition`.
     - Kept `@medusajs/index/worker-composition` as a compatibility export in
       the Index package, but the Cloudflare proof app no longer depends on
       it.
     - Validation passed: `@medusajs/index build`,
       `@medusajs/index test:integration:sqlite`, `medusa-cloudflare
       typecheck` after the Index build, `medusa-cloudflare
       test:index-sqlite`, `medusa-cloudflare test:index-do-sqlite`, stale
       app import scan, Node-only import guard, and `git diff --check`.
252. Next Index persistence step: move from proof helper cleanup back to
     behavior coverage. The likely next slice is broader SQLite provider
     coverage against unchanged Index assertions before production app
     import-graph cleanup.
253. Add SQLite Index service event-ingestion coverage.
     Completed in this commit:
     - Added `index-engine-module-sqlite.spec.ts` as a SQLite sibling for the
       original Index engine event-ingestion behavior.
     - Expanded the SQLite service harness so it can compose the real
       `IndexModuleService` in worker mode with an injected event bus and
       remote query double.
     - Proved real listener registration plus `product.created` and
       `variant.created` event consumption through `SqliteIndexStorageProvider`.
     - Extended `@medusajs/index test:integration:sqlite` to run both the
       shared query-builder SQLite spec and the new event-ingestion SQLite spec.
     - Validation passed: `@medusajs/index build`, `@medusajs/index test`,
       `@medusajs/index test:integration:sqlite` with 20 tests,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Node-only import guard, and
       `git diff --check`.
254. Next Index persistence step: expand SQLite event-ingestion coverage to
     link attach/detach and update/delete paths from the original
     `index-engine-module.spec.ts`, then reassess whether sync metadata should
     move next.
255. Expand SQLite Index event-ingestion coverage to link and mutation events.
     Completed in this commit:
     - Extended `index-engine-module-sqlite.spec.ts` to emit the original-style
       `pricing.price-set.created`, `price.created`,
       `LinkProductVariantPriceSet.attached`, and
       `LinkProductVariantPriceSet.detached` events through the real registered
       listeners.
     - Verified SQLite `index_data` and `index_relation` rows for the full
       Product -> ProductVariant -> LinkProductVariantPriceSet -> PriceSet ->
       Price graph.
     - Added service-level update and delete event coverage for Product and
       ProductVariant rows.
     - Validation passed: `@medusajs/index test:integration:sqlite` with 23
       tests, `@medusajs/index build`, `@medusajs/index test`,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Node-only import guard, and
       `git diff --check`.
256. Next Index persistence step: move to SQLite sync/config metadata behavior
     from `index-engine-module-sync.spec.ts`, `config-sync.spec.ts`, or
     `data-synchronizer.spec.ts`. Prefer a narrow service-level sync metadata
     slice before broadening the full sync subsystem.
257. Add SQLite Index `getInfo` sync metadata coverage.
     Completed in this commit:
     - Added `index-engine-module-sync-sqlite.spec.ts` as the SQLite sibling
       for the original sync-management `getInfo` assertions.
     - Extended the SQLite service composition helper with optional
       `indexMetadataService` and `indexSyncService` injection points.
     - Added list-only in-memory internal-service fixtures for SQLite
       integration tests, keeping the real `IndexModuleService.getInfo` path.
     - Extended `@medusajs/index test:integration:sqlite` to run the new sync
       metadata SQLite spec alongside query-builder and event-ingestion specs.
     - Validation passed: `@medusajs/index test:integration:sqlite` with 26
       tests, `@medusajs/index build`, `@medusajs/index test`,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Node-only import guard, and
       `git diff --check`.
258. Next Index persistence step: expand from read-only sync metadata to a
     narrow SQLite `sync()` behavior slice, starting with server-mode event
     emission/reset semantics or worker-mode configuration checker behavior.
259. Add SQLite Index server-mode `sync()` strategy coverage.
     Completed in this commit:
     - Extended the SQLite service composition helper with optional
       `baseRepository` and `indexResetHandler` injection points.
     - Expanded the SQLite integration fixture from list-only internal services
       to mutable list/update services for the selector shapes used by
       `IndexModuleService.sync()`.
     - Added SQLite coverage for server-mode continue, full, and reset sync
       strategies through the real `IndexModuleService.sync()` method.
     - Verified metadata status resets, sync cursor resets, reset handler
       transaction-manager forwarding, and emitted internal sync events.
     - Validation passed: `@medusajs/index test:integration:sqlite` with 29
       tests, `@medusajs/index build`, `@medusajs/index test`,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Node-only import guard, and
       `git diff --check`.
260. Next Index persistence step: move from server-mode sync strategy coverage
     to worker-mode configuration checker behavior or a narrow
     `DataSynchronizer.syncEntity` SQLite slice.
261. Add SQLite `DataSynchronizer.syncEntity` coverage.
     Completed in this commit:
     - Extended the SQLite service composition helper with an optional
       `dataSynchronizer` injection point.
     - Updated the SQLite integration harness to create and return the real
       `DataSynchronizer` wired to the same remote query used by the SQLite
       provider.
     - Added SQLite integration coverage that syncs Product and ProductVariant
       pages through `DataSynchronizer.syncEntity`, then verifies `index_data`
       and `index_relation` rows written by the real SQLite storage provider.
     - Validation passed: `@medusajs/index test:integration:sqlite` with 30
       tests, `@medusajs/index build`, `@medusajs/index test`,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite` after rerunning a transient
       Yarn startup failure, Node-only import guard, and `git diff --check`.
262. Next Index persistence step: move to worker-mode configuration checker
     behavior or full `DataSynchronizer.syncEntities` orchestration with
     metadata status/cursor updates and stale row cleanup.
263. Add SQLite Index worker-mode configuration checker coverage.
     Completed in this commit:
     - Extended the package-owned SQLite service composition helper with an
       optional `indexConfigurationCheckerFactory` injection point.
     - Expanded the SQLite integration harness from sync metadata mutation
       helpers to the `create`, filtered `list`, batch `update`, `delete`, and
       `upsert` internal-service methods used by the real `Configuration`
       checker.
     - Added worker-mode SQLite coverage that injects the real
       `Configuration` factory and proves startup detects schema metadata
       changes, creates metadata and sync rows, and requests worker sync
       through `DataSynchronizer.syncEntities`.
     - Validation passed: `@medusajs/index test:integration:sqlite` with 31
       tests, `@medusajs/index build`, `@medusajs/index test`,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`
       after rerunning a transient Yarn startup failure, `medusa-cloudflare
       test:index-do-sqlite`, Node-only import guard, and `git diff --check`.
264. Next Index persistence step: move to full `DataSynchronizer.syncEntities`
     orchestration with locking, metadata status updates, cursor updates, and
     stale row cleanup. Configuration removal/update edge cases can follow as
     a separate slice if the orchestration path does not require them first.
265. Add SQLite `DataSynchronizer.syncEntities` orchestration coverage.
     Completed in this commit:
     - Extended the SQLite integration harness `DataSynchronizer` container
       with a typed in-memory locking module, metadata/sync services, logger,
       and a SQLite manager adapter for the existing stale-row SQL emitted by
       `DataSynchronizer`.
     - Added worker-mode SQLite coverage that calls the real
       `DataSynchronizer.syncEntities` method for Product and ProductVariant.
     - Verified lock acquire/release, metadata status transitions to `done`,
       sync cursor advancement, `index_data` and `index_relation` writes, and
       stale Product row cleanup.
     - Validation passed: `@medusajs/index test:integration:sqlite` with 32
       tests, `@medusajs/index build`, `@medusajs/index test`,
       `medusa-cloudflare typecheck` after the Index build, `medusa-cloudflare
       test:index-sqlite`, `medusa-cloudflare test:index-do-sqlite`,
       Node-only import guard, and `git diff --check`.
266. Next Index persistence step: cover SQLite configuration update/removal
     edge cases from the original `config-sync.spec.ts`, then reassess whether
     any remaining Index sync behavior blocks the Worker composition milestone.
267. Add SQLite Index configuration update/removal coverage.
     Completed in this commit:
     - Extended the package-owned SQLite service composition helper with an
       optional schema override so config-sync tests can run the same service
       against updated schemas without mutating private module state.
     - Added a SQLite harness pre-start hook so tests can spy on the real
       `DataSynchronizer` before worker startup invokes the configuration
       checker.
     - Mirrored the original `config-sync.spec.ts` update case: Product and
       Price field changes are detected, marked pending, sync cursors are reset,
       and sync is scheduled.
     - Mirrored the original removal case: deleted metadata is removed,
       `removeEntities` is called for stale entities, Product remains done, and
       ProductVariant becomes pending after its field change.
     - Validation passed: `@medusajs/index test:integration:sqlite` with 34
       tests, `@medusajs/index build`, `@medusajs/index test`,
       `medusa-cloudflare typecheck` after the Index build, `medusa-cloudflare
       test:index-sqlite`, `medusa-cloudflare test:index-do-sqlite` after
       rerunning the alias serially because the parallel build hit a Windows
       `.wrangler` cleanup race, Node-only import guard, and
       `git diff --check`.
268. Next Index persistence step: audit remaining Index-specific SQLite gaps
     against the original integration/unit suites. Do not expand into HTTP,
     events, workflows, or production app import-graph work until the remaining
     Index behavior gap is named and recorded.
269. Add SQLite Index reset truncation coverage.
     Completed in this commit:
     - Audited the original Index integration suite against the SQLite runner
       and identified reset-strategy truncation as the remaining sync-management
       behavior gap.
     - Added a default SQLite `IndexResetHandler` to the SQLite integration
       harness. It clears `index_data`, `index_relation`, metadata rows, and
       sync cursor rows while preserving explicit custom reset-handler
       injection for existing tests.
     - Added SQLite coverage mirroring the original reset strategy assertions:
       populated index tables/metadata are truncated before `index.reset-sync`
       is emitted, and empty tables reset without throwing.
     - Validation passed: `@medusajs/index test:integration:sqlite` with 36
       tests, `@medusajs/index build`, `@medusajs/index test`,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Node-only import guard, and
       `git diff --check`.
270. Next Index persistence step: run a concise remaining-gap audit over the
     Index package after reset coverage. If no original-suite behavior gap is
     left for the SQLite runner, record the Index milestone status and move to
     the next Worker composition/import-graph boundary as a separate slice.
271. Close final SQLite Index runner gaps from the original suite audit.
     Completed in this commit:
     - Re-ran the remaining-gap audit over original Index integration/unit
       coverage versus the SQLite runner.
     - Added SQLite coverage for unordered created/attached event ingestion,
       matching the original `index-engine-module.spec.ts` unordered event
       case.
     - Added SQLite coverage for `sync({ strategy: undefined })`, matching the
       original sync strategy parameter validation case.
     - Confirmed the SQLite runner now covers the original Index behavior
       categories that were in scope for the SQLite provider: query builder
       shared assertions, event ingestion, sync metadata/strategies,
       configuration changes, and data synchronization.
     - Validation passed: `@medusajs/index test:integration:sqlite` with 38
       tests, `@medusajs/index build`, `@medusajs/index test`,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Node-only import guard, and
       `git diff --check`.
272. Next Index persistence step: move from SQLite runner behavior coverage to
     the Worker composition/import-graph boundary. The next slice should prove
     that the Worker-facing Index composition imports only portable Index
     entrypoints and does not rely on test-only harness support.
273. Prove Index Worker composition through package exports.
     Completed in this commit:
     - Removed the Cloudflare app's Vite and TypeScript aliases for
       `@medusajs/index` source subpaths used by the Index proof.
     - The isolated Worker proof now resolves
       `@medusajs/index/relation-query-proof-runner`,
       `@medusajs/index/sqlite-index-service-composition`, and related
       provider types through the built package export surface.
     - This keeps `apps/medusa-cloudflare` as the thin composition/proof root
       and prevents source-only or test-harness import paths from becoming the
       Worker contract.
     - Validation passed: `@medusajs/index build`, `@medusajs/index test`,
       `@medusajs/index test:integration:sqlite` with 38 tests,
       `medusa-cloudflare typecheck`, `medusa-cloudflare build:index-proof`,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, Index alias guard,
       and `git diff --check`.
274. Next Index persistence step: replace the proof-runner dependency with a
     production Worker Index composition boundary that accepts Cloudflare SQL
     executors and runtime services without seeding proof fixtures.
275. Split Index Worker composition from proof fixture defaults.
     Completed in this commit:
     - `@medusajs/index/worker-composition` now exports the SQLite Index
       service creator and SQLite executor value types directly from the
       production composition boundary.
     - The SQLite service composition requires an explicit schema and optional
       joiner-config registration callback instead of importing the relation
       query proof schema as a default.
     - The relation query proof runner and SQLite integration harness now
       opt into the proof schema and proof joiner config registration
       explicitly.
     - Added an Index portable-entry regression that prevents the production
       Worker composition files from importing the proof runner or proof
       fixture graph.
     - Validation passed: `@medusajs/index test` with 32 tests,
       `@medusajs/index build`, `@medusajs/index test:integration:sqlite`
       with 38 tests, `medusa-cloudflare typecheck`,
       `medusa-cloudflare build:index-proof`,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, production
       composition proof-isolation guard, Index alias guard, and
       `git diff --check`.
276. Next Index persistence step: add the first non-proof Worker Index
     composition usage in `apps/medusa-cloudflare` or a package-level
     workerd-facing test that constructs the Index service from
     `@medusajs/index/worker-composition` with an explicit schema and no proof
     fixture seeding.
277. Add no-seed Index Worker composition usage in workerd.
     Completed in this commit:
     - Added an app-local `runIndexWorkerCompositionCheck` that imports
       `createSqliteIndexService` and SQLite executor types from
       `@medusajs/index/worker-composition`.
     - The check passes an explicit synthetic Index schema and a minimal
       synthetic joiner config registration, then queries a unique
       `WorkerCompositionProduct` root without inserting proof fixture rows.
     - Added D1 and Durable Object SQLite `/composition-check` routes beside
       the existing seeded relation-query proof routes.
     - Extended the workerd proof script to assert both the original seeded
       relation query proof and the no-seed composition check for D1 and DO
       SQLite.
     - Moved the Cloudflare SQLite executor type import from the storage
       provider subpath to `@medusajs/index/worker-composition`.
     - Validation passed: `@medusajs/index test` with 32 tests,
       `@medusajs/index build`, `@medusajs/index test:integration:sqlite`
       with 38 tests, `medusa-cloudflare typecheck`,
       `medusa-cloudflare build:index-proof`,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, production
       composition proof-isolation guard, Index app subpath guard, and
       `git diff --check`.
278. Next Index persistence step: move from proof endpoints toward a real
     reusable Worker Index runtime composition object that can be initialized
     once per Worker/DO lifecycle and reused by future HTTP/event paths instead
     of constructing a service per proof request.
279. Add reusable Index Worker runtime composition for the proof app.
     Completed in this commit:
     - Replaced the request-local no-seed composition helper with an
       `IndexWorkerRuntime` class that lazily initializes the real Index
       service once and reuses the service promise for later calls.
     - The Durable Object proof stores `IndexWorkerRuntime` as instance state,
       matching DO lifecycle reuse.
     - The D1 proof stores `IndexWorkerRuntime` in a `WeakMap` keyed by the D1
       binding object, avoiding one hard global binding assumption while still
       reusing the runtime for repeated Worker requests.
     - The workerd proof script now calls each composition route twice and
       asserts a stable runtime instance id plus a single service
       initialization for both Durable Object SQLite and D1.
     - Validation passed: `@medusajs/index test` with 32 tests,
       `@medusajs/index build`, `@medusajs/index test:integration:sqlite`
       with 38 tests, `medusa-cloudflare typecheck`,
       `medusa-cloudflare build:index-proof`,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, production
       composition proof-isolation guard, Index app subpath guard, and
       `git diff --check`.
280. Next Index persistence step: move the reusable runtime composition shape
     out of the proof-only route helper and toward a package-owned Worker
     runtime factory that can accept real module schemas/joiner registrations
     and be reused by future HTTP/event composition.
281. Move reusable SQLite Index Worker runtime into the Index package.
     Completed in this commit:
     - Added `SqliteIndexWorkerRuntime` and
       `createSqliteIndexWorkerRuntime` under the package-owned
       `@medusajs/index/worker-composition` entrypoint.
     - The runtime accepts the same explicit SQLite Index composition options,
       lazily initializes the real Index service once, exposes the service for
       future runtime paths, and forwards typed Index queries.
     - The Cloudflare proof app now keeps only proof-specific schema, joiner
       config, and runtime-id reporting. Service lifecycle reuse comes from
       the package runtime factory.
     - Extended the Index portable-entry regression so the package-owned
       runtime stays out of the Postgres/MikroORM and proof-fixture import
       graphs.
     - Validation passed: `@medusajs/index test` with 32 tests,
       `@medusajs/index build`, `@medusajs/index test:integration:sqlite`
       with 38 tests, `medusa-cloudflare typecheck`,
       `medusa-cloudflare build:index-proof`,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, production
       composition proof-isolation guard, Index app subpath guard, and
       `git diff --check`.
282. Next Index persistence step: replace the proof-only synthetic schema usage
     with a real package/module schema input path for Worker runtime
     composition, so future HTTP/event handlers can compose Index for actual
     Medusa modules instead of proof-only entities.
283. Add real module joiner-config input for SQLite Index Worker composition.
     Completed in this commit:
     - `createSqliteIndexService` now accepts explicit `joinerConfigs` and
       registers them before the Index service builds its schema object
       representation.
     - The Cloudflare composition check no longer defines a synthetic module
       joiner config in the proof app.
     - The check now uses the real Product module joiner config from
       `@medusajs/product/joiner-config` and an Index schema for the actual
       `ProductCategory` entity.
     - The workerd proof asserts the real module entity and root alias
       (`ProductCategory` / `product_category`) so the check cannot silently
       drift back to a proof-only synthetic entity.
     - Validation passed: `@medusajs/index test` with 32 tests,
       `@medusajs/index build`, `@medusajs/index test:integration:sqlite`
       with 38 tests, `medusa-cloudflare typecheck`,
       `medusa-cloudflare build:index-proof`,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, production
       composition proof-isolation guard, Index app subpath guard, and
       `git diff --check`.
284. Next Index persistence step: broaden the real module Worker composition
     proof from a read-only empty ProductCategory query to a real module event
     ingestion path that writes through the SQLite provider without using the
     relation-query proof fixture seeding helper.
285. Add real module event-ingestion proof for SQLite Index Worker composition.
     Completed in this commit:
     - The Cloudflare Index proof runtime now starts the package-owned Index
       Worker runtime in worker mode with a real event bus and Remote Query
       boundary for ProductCategory.
     - Added D1 and Durable Object SQLite `/event-ingestion-check` routes that
       emit `product-category.created`, let the registered Index listener call
       the SQLite provider, and then query `product_category` through the
       package runtime.
     - The proof writes and verifies `pcat_worker_index_event` /
       `Worker Index Event Category` without calling the relation-query proof
       fixture seeding helper or inserting index rows directly.
     - The workerd proof script now asserts seeded relation queries, no-seed
       runtime composition reuse, and real event-ingestion writes for both DO
       SQLite and D1.
     - Validation passed: `@medusajs/index test` with 32 tests,
       `@medusajs/index build`, `@medusajs/index test:integration:sqlite`
       with 38 tests, `medusa-cloudflare typecheck`,
       `medusa-cloudflare build:index-proof`,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, production
       composition proof-isolation guard, Index app subpath guard, and
       `git diff --check`.
286. Next Index persistence step: move event-bus and Remote Query runtime
     dependencies out of the proof helper toward explicit Worker composition
     dependency injection, so future HTTP/event runtime code can provide real
     platform services instead of proof-local shims.
287. Make Index Worker runtime platform dependencies explicit.
     Completed in this commit:
     - `IndexWorkerRuntime` no longer constructs its own proof event bus or
       Remote Query implementation.
     - Added an app-local proof dependency provider that supplies the event
       bus, Remote Query, and target ProductCategory record as explicit runtime
       dependencies.
     - The D1 Worker and Durable Object composition roots now inject those
       dependencies when constructing the Index runtime.
     - The existing workerd proof still exercises seeded relation queries,
       no-seed runtime reuse, and real ProductCategory event ingestion for both
       DO SQLite and D1.
     - Validation passed: `medusa-cloudflare typecheck`,
       `@medusajs/index test` with 32 tests, `@medusajs/index build`,
       `@medusajs/index test:integration:sqlite` with 38 tests,
       `medusa-cloudflare build:index-proof`,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, production
       composition proof-isolation guard, Index app subpath guard, and
       `git diff --check`.
288. Next Index persistence step: move from proof-local dependency providers to
     a reusable Worker Index composition dependency contract that real
     platform code can implement for event bus, Remote Query, schema, and
     joiner config inputs.
289. Add a package-owned SQLite Index Worker dependency contract.
     Completed in this commit:
     - `@medusajs/index/worker-composition` now exports
       `SqliteIndexWorkerRuntimeDependencies`.
     - The package Worker runtime requires explicit executor, event bus,
       Remote Query, schema, and joiner config inputs, while the lower-level
       SQLite service composition remains flexible for package tests and
       harnesses.
     - The Cloudflare proof dependency provider now types its event bus and
       Remote Query shim against the package-owned dependency contract.
     - Validation passed: `@medusajs/index build`,
       `medusa-cloudflare typecheck`, `@medusajs/index test` with 32 tests,
       `@medusajs/index test:integration:sqlite` with 38 tests,
       `medusa-cloudflare build:index-proof`,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, production
       composition proof-isolation guard, Index app subpath guard, and
       `git diff --check`.
290. Next Index persistence step: move ProductCategory schema and joiner config
     assembly toward a manifest-derived Worker Index input so the app
     composition root supplies generated module metadata instead of
     hand-authored schema strings.
291. Derive SQLite Index Worker schema input from static module metadata.
     Completed in this commit:
     - Added `createSqliteIndexWorkerStaticModuleInput` to
       `@medusajs/index/worker-composition`.
     - The helper derives Index schema input from module joiner schemas,
       injects `@Listeners` directives with real Medusa module event names,
       and returns the joiner configs required by the package Worker runtime.
     - The Cloudflare ProductCategory proof no longer hand-authors its Index
       schema string and now emits `product.product-category.created`.
     - Added a lightweight
       `@medusajs/product/index-worker-static-manifest` entrypoint so the
       isolated Index Worker proof can consume Product module metadata without
       importing Product's full static manifest or service graph.
     - Validation passed: `@medusajs/product build`,
       `@medusajs/index test` with 34 tests, `@medusajs/index build`,
       `medusa-cloudflare typecheck`,
       `@medusajs/index test:integration:sqlite` with 38 tests,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, production
       composition proof-isolation guard, Index proof Product service leakage
       guard, and `git diff --check`.
292. Next Index persistence step: add a reusable static Index resource
     manifest shape so modules can declare indexed entities and fields without
     the Cloudflare proof app selecting them inline.
293. Move Index Worker entity selection into module-owned manifests.
     Completed in this commit:
     - `createSqliteIndexWorkerStaticModuleInput` now reads
       `resources.indexEntities` from static module manifests by default.
     - Product's lightweight `index-worker-static-manifest` declares
       ProductCategory with `id` and `name` as its current Index Worker fields.
     - The Cloudflare proof app no longer selects ProductCategory or field
       names inline; it passes the Product Index Worker manifest to the Index
       helper.
     - Explicit entity input remains available for tests and generated tooling,
       but runtime composition now has a module-owned declaration path.
     - Validation passed: `@medusajs/index test` with 35 tests,
       `@medusajs/product build`, `@medusajs/index build` after a sequential
       rerun following a parallel dist-clean race, `medusa-cloudflare
       typecheck`, `@medusajs/index test:integration:sqlite` with 38 tests,
       `medusa-cloudflare build:index-proof`,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, production
       composition proof-isolation guard, Index proof Product service leakage
       guard, Index app subpath guard, and `git diff --check`.
294. Next Index persistence step: add a Product-owned static manifest
     regression proving its Index Worker entity declaration references fields
     that exist in the Product joiner schema, then expand the manifest shape
     only when another real Index entity requires it.
295. Add a Product-owned Index Worker manifest regression.
     Completed in this commit:
     - Product's static manifest test now validates the lightweight
       Product Index Worker manifest.
     - The regression confirms the manifest targets the Product module, has a
       joiner schema, and declares ProductCategory fields that exist in that
       schema.
     - Validation passed: focused Product static manifest suite with 2 tests,
       `@medusajs/product build`, and `git diff --check`.
296. Next Index persistence step: move from single-module manifest consumption
     toward a small static Index manifest aggregation helper that can merge
     multiple module-owned Index declarations without the Cloudflare app
     manually assembling them.
297. Add static Index Worker manifest aggregation.
     Completed in this commit:
     - `@medusajs/index/worker-composition` now exports
       `SqliteIndexWorkerStaticManifest` and
       `createSqliteIndexWorkerStaticManifest`.
     - The aggregate manifest validates duplicate module keys and can hold
       multiple module-owned Index Worker declarations before deriving runtime
       schema input.
     - The Cloudflare proof app now has a single `indexWorkerStaticManifest`
       composition point, and ProductCategory input consumes that aggregate
       instead of receiving raw module manifest arrays.
     - Validation passed: `@medusajs/index test` with 36 tests,
       `@medusajs/index build`, `medusa-cloudflare typecheck`,
       `@medusajs/index test:integration:sqlite` with 38 tests,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, production
       composition proof-isolation guard, Index proof Product service leakage
       guard, and `git diff --check`.
298. Next Index persistence step: expand the aggregate only when a second real
     module/entity is required by the Worker composition proof; otherwise move
     next to reducing the remaining proof-local shims around event bus or
     Remote Query.
299. Move the Worker Index event bus utility into the Index package.
     Completed in this commit:
     - `@medusajs/index/worker-composition` now exports
       `SqliteIndexWorkerEventBus` and `createSqliteIndexWorkerEventBus`.
     - The Cloudflare Index proof dependency provider now imports the package
       event bus instead of defining an app-local copy.
     - The package event bus has focused tests for publish/subscribe,
       unsubscribe behavior, and event option stripping before subscriber
       delivery.
     - Validation passed: `@medusajs/index test` with 38 tests,
       `@medusajs/index build`, `medusa-cloudflare typecheck`,
       `@medusajs/index test:integration:sqlite` with 38 tests,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, production
       composition proof-isolation guard, and `git diff --check`.
300. Next Index persistence step: reduce the remaining proof-local Remote Query
     shim by moving it toward a package-owned proof helper or explicit runtime
     dependency utility, while keeping real platform Remote Query ownership at
     the Worker/app composition boundary.
301. Move the Worker Index Remote Query proof helper into the Index package.
     Completed in this commit:
     - `@medusajs/index/worker-composition` now exports
       `createSqliteIndexWorkerRemoteQuery` and related typed input shapes.
     - The Cloudflare Index proof dependency provider no longer imports
       Remote Query types or constructs an overloaded `RemoteQueryFunction`
       directly.
     - The package helper supports the narrow in-memory `graph()` behavior
       needed by Worker Index event rehydration and keeps proof data supplied
       explicitly by the app.
     - Validation passed: `@medusajs/index test` with 42 tests,
       `@medusajs/index build`, `medusa-cloudflare typecheck`,
       `@medusajs/index test:integration:sqlite` with 38 tests,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, production
       composition proof-isolation guard, and `git diff --check`.
302. Next Index persistence step: move the remaining Worker Index dependency
     assembly toward a package-owned helper so the Cloudflare proof app only
     supplies executor bindings, static module manifests, and proof data while
     production platform code still owns real Remote Query/event services.
303. Move Worker Index proof dependency assembly into the Index package.
     Completed in this commit:
     - `@medusajs/index/worker-composition` now exports
       `createSqliteIndexWorkerProofDependencies`.
     - The helper pairs the package-owned Worker proof event bus and Worker
       proof Remote Query from explicit proof records.
     - The Cloudflare proof app now supplies ProductCategory data and executor
       bindings, but no longer assembles the event/query proof dependency pair.
     - Validation passed: `@medusajs/index test` with 44 tests,
       `@medusajs/index build`, `medusa-cloudflare typecheck`,
       `@medusajs/index test:integration:sqlite` with 38 tests,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, production
       composition proof-isolation guard, and `git diff --check`.
304. Next Index persistence step: move generic Worker runtime/check ownership
     toward the Index package while keeping ProductCategory-specific proof
     expectations in the Cloudflare proof app.
305. Move Worker Index proof runtime mechanics into the Index package.
     Completed in this commit:
     - `@medusajs/index/worker-composition` now exports
       `SqliteIndexWorkerProofRuntime` and
       `createSqliteIndexWorkerProofRuntime`.
     - The package proof runtime wraps the real `SqliteIndexWorkerRuntime` and
       provides stable runtime instance IDs, service initialization counts,
       query results with runtime stats, and emit-then-query behavior.
     - The Cloudflare proof app now keeps only ProductCategory-specific query
       inputs and response assertions.
     - Validation passed: `@medusajs/index test` with 45 tests,
       `@medusajs/index build`, `medusa-cloudflare typecheck`,
       `@medusajs/index test:integration:sqlite` with 38 tests,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, production
       composition proof-isolation guard, and `git diff --check`.
306. Next Index persistence step: review the remaining ProductCategory proof
     adapter and either keep it app-owned as the module-specific assertion
     layer or extract only another generic assertion helper if it removes real
     duplication without hiding module semantics.
307. Move generic Worker Index proof checks into the Index package.
     Completed in this commit:
     - `@medusajs/index/worker-composition` now exports
       `runSqliteIndexWorkerEmptyQueryCheck`,
       `runSqliteIndexWorkerEventIngestionStringCheck`, and
       `findSqliteIndexWorkerObservedStringField`.
     - The package helpers own empty-query validation, event-ingestion
       string-field comparison, observed field lookup, and runtime stat
       propagation.
     - The Cloudflare proof app still owns ProductCategory entity/root alias,
       event, query, expected `id`/`name`, and response shape.
     - Validation passed: `@medusajs/index test` with 47 tests,
       `@medusajs/index build`, `medusa-cloudflare typecheck`,
       `@medusajs/index test:integration:sqlite` with 38 tests,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, production
       composition proof-isolation guard, and `git diff --check`.
308. Next Index persistence step: stop reducing the ProductCategory proof
     adapter unless another clearly generic behavior appears; inspect the
     remaining Index Worker composition gaps and choose the next real
     portability slice.
309. Preserve support joiner configs in Index Worker static manifests.
     Completed in this commit:
     - `createSqliteIndexWorkerStaticModuleInput` now returns support joiner
       configs even when a manifest does not contribute indexed schema types.
     - `@medusajs/link-modules/index-worker-static-manifest` exports the
       real `ProductVariantPriceSet` link joiner config as a lightweight Worker
       manifest.
     - The Cloudflare Index Worker static manifest aggregate includes the
       ProductVariantPriceSet support manifest alongside Product.
     - Validation passed: `@medusajs/index test` with 48 tests,
       `@medusajs/index build`, `@medusajs/index test:integration:sqlite`
       with 38 tests, focused link-modules manifest test,
       `@medusajs/link-modules build`, `medusa-cloudflare typecheck`,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, production
       composition proof-isolation guard, and `git diff --check`.
310. Next Index persistence step: add module-owned Product/Pricing
     relation-query entity declarations and handle link-extended fields such
     as `ProductVariant.prices` without reintroducing hand-authored app
     schemas.
311. Add module-owned Product/Pricing Index relation-query declarations.
     Completed in this commit:
     - Product's Index Worker manifest now declares `Product`,
       `ProductVariant`, and `ProductCategory` as package-owned indexed
       entities.
     - Pricing now exposes
       `@medusajs/pricing/index-worker-static-manifest` with a package-owned
       `Price` indexed entity declaration.
     - `createSqliteIndexWorkerStaticModuleInput` derives requested
       link-extended fields from support joiner config metadata. The concrete
       ProductVariantPriceSet path now supplies `ProductVariant.prices` from
       `price_set_link.price_set.prices` without an app-authored schema.
     - The relation-query proof fixture now uses Product, Pricing, and link
       static manifests for schema/joiner config construction. It keeps only
       proof-local legacy listener names so unchanged SQLite integration event
       assertions remain valid.
     - The Cloudflare Index Worker aggregate includes Product, Pricing, and
       ProductVariantPriceSet manifests together.
     - Validation passed: focused Product/Pricing/link manifest tests,
       `@medusajs/index test` with 49 tests, `@medusajs/index build`,
       `@medusajs/index test:integration:sqlite` with 38 tests, affected
       Product/Pricing/link builds, `medusa-cloudflare typecheck`,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, and production
       composition proof-isolation guard.
312. Next Index persistence step: remove the remaining ProductCategory-only
     proof naming from the Cloudflare app input, or add the next module-owned
     manifest declarations needed by a real HTTP/API route, but do not expand
     into events/workflows/HTTP outside the Index milestone.
313. Move generic Index Worker listener lookup out of the Cloudflare proof app.
     Completed in this commit:
     - `@medusajs/index/worker-composition` now exports
       `getSqliteIndexWorkerRequiredEntityListener`.
     - The Cloudflare proof app input module was renamed from
       `index-worker-product-category-input.ts` to `index-worker-input.ts`.
     - ProductCategory semantics remain in the app's proof check and response
       shape, but static input construction and required listener lookup are
       generic package-owned behavior.
     - Validation passed: focused Index static input and portable-entry tests,
       `@medusajs/index build`, `medusa-cloudflare typecheck`,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, and production
       composition proof-isolation guard.
314. Next Index persistence step: inspect real HTTP/API consumers of Product
     relation data and add only the next package-owned Index manifest/runtime
     declaration needed by that consumer, or continue removing generic proof
     plumbing from the Cloudflare app when it is clearly reusable.
315. Add Pricing `PriceRule` declarations for Admin product Index queries.
     Completed in this commit:
     - The real Admin product list route uses `query.index` when the Index
       feature flag is enabled and its default fields include
       `variants.prices.price_rules.value` and
       `variants.prices.price_rules.attribute`.
     - `@medusajs/pricing/index-worker-static-manifest` now declares the
       `Price.price_rules` relation fields needed by Admin product responses
       and a package-owned `PriceRule` indexed entity.
     - The Index relation-query proof fixture now seeds a PriceRule row and
       relation edge under Price.
     - The Worker relation proof now queries
       `product.variants.prices.price_rules.*` and asserts the nested rule
       attribute/value for both Durable Object SQLite and D1.
     - Validation passed: Pricing static manifest test, focused Index static
       input/storage-provider tests, full `@medusajs/index test` with 51
       tests, `@medusajs/index build`, `@medusajs/index
       test:integration:sqlite` with 38 tests, `@medusajs/pricing build`,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, Worker proof source/test leakage guard, and production
       composition proof-isolation guard.
316. Next Index persistence step: inspect the Store product list calculated
     price path. Do not fake calculated prices in the app; derive the next
     package-owned Index schema/runtime support from the real
     ProductVariantPriceSet `calculated_price` field alias or decide that
     calculated prices must remain Remote Query/hydration-owned.
317. Keep Store calculated prices hydration-owned for now and fail unresolved
     static Index aliases loudly. Completed in this commit:
     - The real Store product list path was inspected. It adds
       `variants.calculated_price` through `QueryContext(req.pricingContext)`,
       and Pricing computes `PriceSet.calculated_price` dynamically as a
       virtual relation.
     - The SQLite Index Worker static input builder now throws when a selected
       link-extended field alias cannot resolve to an actual joiner schema
       field or relationship.
     - A regression test covers the
       `ProductVariant -> price_set_link.price_set.calculated_price` alias when
       `PriceSet.calculated_price` is not a schema field.
     - Validation passed: focused static module input test, full
       `@medusajs/index test` with 52 tests, `@medusajs/index build`,
       `@medusajs/index test:integration:sqlite` with 38 tests,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, portable entrypoint guard, and real module import audit.
318. Next Index persistence step: continue from a real API consumer or remove
     another generic proof-app composition helper. Do not project Store
     `calculated_price` as static Index data until a package-owned dynamic
     pricing hydration path is designed and proven.
319. Switch the Index Worker event-ingestion proof from ProductCategory to
     Product. Completed in this commit:
     - The Cloudflare Index Worker proof now resolves the Product created
       listener from the static module input.
     - Product event ingestion is verified through both Durable Object SQLite
       and D1 using the Product root alias.
     - The no-seed composition check now queries Product with a missing Product
       ID filter, so it remains valid after the relation-query proof has seeded
       Product rows in the same executor.
     - Validation passed: `medusa-cloudflare typecheck`,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, portable entrypoint guard, and real module import audit.
320. Next Index persistence step: continue reducing generic proof-app
     composition only where the behavior is reusable, or add the next
     package-owned Index capability required by real Store/Admin product
     Index usage. Keep Store `calculated_price` out of static projection until
     dynamic pricing hydration is designed.
321. Expand Product Index Worker scalar manifest coverage for real Store/Admin
     product defaults. Completed in this commit:
     - Product's static Index Worker manifest now declares Product and
       ProductVariant scalar fields requested by Store/Admin product default
       field lists.
     - Product static manifest tests now guard those scalar fields.
     - The Worker Product event-ingestion proof verifies extra Product string
       scalars (`handle` and `external_id`) through both Durable Object SQLite
       and D1.
     - The shared relation-query fixture was left unchanged so existing
       query-builder integration assertions continue to pass.
     - Validation passed: Product static manifest test, focused Index tests,
       full `@medusajs/index test`, `@medusajs/index
       test:integration:sqlite`, Product build, Index build,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, portable entrypoint guard, and real module import audit.
322. Next Index persistence step: continue Product route coverage with the
     next package-owned relation manifest/runtime slice for Store/Admin product
     defaults (`type`, `collection`, `options`, `tags`, `images`, or
     `variants.options`). Keep Store `calculated_price` separate because it is
     dynamic pricing hydration, not static projection.
323. Add Product type/collection Index relation support. Completed in this
     commit:
     - Product's Worker-facing Index static manifest now declares the
       `collection` and `type` Product fields plus `ProductCollection` and
       `ProductType` indexed entities.
     - SQLite relation planning now preserves `isList` metadata, and SQLite
       relation hydration/projection returns singular relations as objects.
     - The Worker relation proof seeds ProductCollection/ProductType rows only
       for the Worker proof path and asserts Product collection title/handle
       plus Product type value for both Durable Object SQLite and D1.
     - Validation passed: Product static manifest test, focused Index tests,
       full Index unit suite in-band with 53 tests, Index SQLite integration
       suite with 38 tests, Product build, Index build,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, portable entrypoint guard, and real module import audit.
324. Next Index persistence step: continue Product relation coverage with
     package-owned support for `options`/`options.values`, `tags`, `images`, or
     `variants.options`. Keep Store `calculated_price` deferred to dynamic
     pricing hydration.
325. Add Product option/value Index relation support. Completed in this commit:
     - Product's Worker-facing Index static manifest now declares
       `options` on Product and ProductVariant plus `ProductOption` and
       `ProductOptionValue` indexed entities.
     - The Worker relation proof seeds ProductOption/ProductOptionValue rows
       only for the Worker proof path and asserts Product option title,
       Product option value, and Variant option value for both Durable Object
       SQLite and D1.
     - Validation passed: Product static manifest test, focused Index tests,
       full Index unit suite in-band with 53 tests, Index SQLite integration
       suite with 38 tests, Product build, Index build,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, portable entrypoint guard, and real module import audit.
326. Next Index persistence step: continue Product relation coverage with
     package-owned support for `tags` or `images`. Keep Store
     `calculated_price` deferred to dynamic pricing hydration.
327. Add Product tag Index relation support. Completed in this commit:
     - Product's Worker-facing Index static manifest now declares `tags` on
       Product plus a `ProductTag` indexed entity.
     - The Worker relation proof seeds a ProductTag row only for the Worker
       proof path and asserts Product tag value for both Durable Object SQLite
       and D1.
     - Validation passed: Product static manifest test, focused Index tests,
       full Index unit suite in-band with 53 tests, Index SQLite integration
       suite with 38 tests, Product build, Index build,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, portable entrypoint guard, and real module import audit.
328. Next Index persistence step: continue Product relation coverage with
     package-owned support for `images`. Keep Store `calculated_price`
     deferred to dynamic pricing hydration.
329. Add Product image Index relation support. Completed in this commit:
     - Product's Worker-facing Index static manifest now declares `images` on
       Product and ProductVariant plus a `ProductImage` indexed entity.
     - The Worker relation proof seeds ProductImage rows only for the Worker
       proof path and asserts Product image URL/rank plus direct Variant image
       URL for both Durable Object SQLite and D1.
     - Validation passed: Product static manifest test, focused Index tests,
       full Index unit suite in-band with 53 tests, Index SQLite integration
       suite with 38 tests, Product build, Index build,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, portable entrypoint guard, and real module import audit.
330. Next Index persistence step: audit remaining Product Index route defaults
     after the Product relation slices. Keep Store `calculated_price` outside
     static projection unless a package-owned dynamic pricing hydration path is
     designed and proven.
331. Add Product sales channel Index relation support. Completed in this
     commit:
     - Product route default audit found `*sales_channels` as the remaining
       static Admin product default.
     - Sales Channel now exposes a Worker-facing Index static manifest for
       `SalesChannel`.
     - Link Modules now exposes ProductSalesChannel as a Worker-facing support
       joiner manifest and the link definition uses the portable utils
       entrypoint plus an explicit `LinkProductSalesChannel` alias entity.
     - Product's Worker-facing Index static manifest now declares
       `sales_channels` on Product.
     - The Worker relation proof seeds ProductSalesChannel/SalesChannel rows
       only for the Worker proof path and asserts Product sales channel name
       for both Durable Object SQLite and D1.
     - Validation passed: Product, Sales Channel, and Link Modules manifest
       tests; focused Index tests; full Index unit suite in-band with 53
       tests; Index SQLite integration suite with 38 tests; Product, Sales
       Channel, Link Modules, and Index builds; `medusa-cloudflare typecheck`;
       `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite`; Worker bundle Node-only
       import guard; portable entrypoint guard; and real module import audit.
332. Next Index persistence step: audit and document the remaining Product
     Index boundary around Store `variants.calculated_price` and dynamic
     pricing hydration. Product tag/category filters still intentionally fall
     back from Index in Store/Admin product routes.
333. Add Product static route defaults Index audit. Completed in this commit:
     - The Index unit suite now builds an aggregate schema from the real
       Product, Pricing, Sales Channel, ProductVariantPriceSet, and
       ProductSalesChannel Worker static manifests for the current static
       Store/Admin product route default fields.
     - The audit verifies Product, ProductVariant, ProductCollection,
       ProductType, ProductOption, ProductOptionValue, ProductTag,
       ProductImage, Price, PriceRule, and SalesChannel coverage without
       importing the Medusa API package into the Index module test graph.
     - The audit explicitly verifies that `ProductVariant.calculated_price`
       still fails static schema construction because it is a Pricing service
       virtual relation hydrated from request pricing context.
     - Validation passed: full Index unit suite in-band with 55 tests; Index
       build; `medusa-cloudflare typecheck`; Worker bundle Node-only import
       guard; portable entrypoint guard; real module import audit;
       `medusa-cloudflare test:index-sqlite`; and
       `medusa-cloudflare test:index-do-sqlite`.
334. Next Index persistence step: choose the next package-owned Product route
     boundary. Either design dynamic pricing hydration for Worker query
     execution, or move to the next static Product route/filter capability
     while keeping `calculated_price` out of static projection.
335. Add Product category Index relation and tag/category filter support.
     Completed in this commit:
     - Product's Worker-facing Index static manifest now declares
       `categories` on Product plus schema-backed ProductCategory fields.
     - The Product route aggregate static input audit now includes
       ProductCategory and `Product.categories`.
     - The Worker relation proof now seeds ProductCategory rows, asserts
       category traversal, and verifies nested category and tag filters through
       both Durable Object SQLite and D1.
     - Store/Admin Product list routes no longer fall back to graph mode only
       because tag/category filters are present when the Index feature flag is
       enabled.
     - Validation passed: Product static manifest test; full Index unit suite
       in-band with 55 tests; Index SQLite integration suite with 38 tests;
       Product, Index, and Medusa builds; `medusa-cloudflare typecheck`;
       `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite`; Worker bundle Node-only
       import guard; portable entrypoint guard; and real module import audit.
336. Next Index persistence step: audit the next Product route gap beyond
     static relation traversal and tag/category filters. Keep
     `variants.calculated_price` separate until a real dynamic pricing
     hydration path is designed and proven.
337. Add SQLite Worker Product `q` search support. Completed in this commit:
     - SQLite query planning now treats root `q` filters as post-load search,
       not scalar JSON equality.
     - SQLite storage applies `q` against root row string fields before nested
       filters and deferred pagination.
     - The Worker proof now verifies Product `q` search through both Durable
       Object SQLite and D1.
     - Validation passed: full Index unit suite in-band with 55 tests; Index
       SQLite integration suite with 38 tests; Index build;
       `medusa-cloudflare typecheck`; `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite` after sequential rerun due to
       the shared Wrangler proof port; Worker bundle Node-only import guard;
       portable entrypoint guard; and real module import audit.
338. Next Index persistence step: continue Product route parity audit after
     static relation filters and root `q` search. Keep
     `variants.calculated_price` separate until a real dynamic pricing
     hydration path is designed and proven.
339. Use Index for unfiltered Admin Product list route. Completed in this
     commit:
     - Admin Product list now calls `query.index` whenever the Index feature
       flag is enabled instead of falling back to graph/refetch mode for empty
       filters.
     - SQLite Worker Index query planning now emits count SQL whenever
       pagination `take` is present, so default list metadata does not require
       callers to pass `skip: 0`.
     - The Worker proof verifies unfiltered Product list results and
       `estimate_count` through both Durable Object SQLite and D1.
     - Validation passed: full Index unit suite in-band with 55 tests; Index
       SQLite integration suite with 38 tests; Index and Medusa builds;
       `medusa-cloudflare typecheck`; `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite`; Worker bundle Node-only
       import guard; portable entrypoint guard; and real module import audit.
340. Next Index persistence step: audit Admin Product `price_list_id` parity
     next. The current middleware rewrites `price_list_id` into `variants.id`,
     so verify that the rewritten filter path works through SQLite Index before
     considering direct Pricing manifest changes. Keep
     `variants.calculated_price` separate until dynamic pricing hydration has a
     package-owned design.
341. Support SQLite Index nested variant-id filters for Admin Product
     `price_list_id` parity. Completed in this commit:
     - The existing Admin Product price-list middleware remains the owner of
       price-list resolution and still rewrites `price_list_id` into
       `variants.id`.
     - SQLite Worker Index nested filter evaluation now treats plain scalars
       as equality filters and arrays as `$in`, so the rewritten
       `product.variants.id = ["var_1"]` path is honored.
     - The shared SQLite query-builder integration suite covers variant-id
       array filtering, and the Worker proof verifies the same path through
       Durable Object SQLite and D1.
     - Validation passed: full Index unit suite in-band with 55 tests; Index
       SQLite integration suite with 39 tests; Index and Medusa builds;
       `medusa-cloudflare typecheck`; `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite`; Worker bundle Node-only
       import guard; portable entrypoint guard; and real module import audit.
342. Next Index persistence step: audit the remaining Product Index boundary
     around pricing context and `variants.calculated_price`. Keep calculated
     price out of static projection until there is a package-owned dynamic
     pricing hydration design with route and Worker proof coverage.
343. Guard `query.index` calculated-price hydration. Completed in this commit:
     - No production behavior changed.
     - A modules-sdk regression test proves `query.index` calls the Index
       module only for an ID lookup, then passes requested
       `variants.calculated_price` fields and `QueryContext` to `query.graph`
       for graph/pricing hydration.
     - This confirms the accepted boundary: calculated price remains dynamic
       Pricing/Remote Query hydration after Index lookup, not static Index
       projection data.
     - Validation passed: focused modules-sdk `Query.index` test,
       modules-sdk build, `medusa-cloudflare typecheck`,
       `medusa-cloudflare test:index-sqlite`,
       `medusa-cloudflare test:index-do-sqlite`, Worker bundle Node-only
       import guard, portable entrypoint guard, and real module import audit.
     - Broader `medusa-cloudflare test:cart-do-sqlite` was attempted but
       failed before Worker startup in the Cloudflare Vite plugin fallback for
       `packages/core/framework/dist/utils/portable.js`.
344. Next Index persistence step: audit remaining Product route fields and
     filters against the static Index lookup plus graph hydration split. Keep
     `variants.calculated_price` out of static projection.
345. Support SQLite Index direct Product root array filters. Completed in this
     commit:
     - Direct root array filters now compile to SQLite `IN` predicates instead
       of scalar equality, matching Product route filter shapes like
       `product.id = ["prod_1"]` and the Admin-style root array pattern.
     - Empty `$in` and `$nin` arrays are handled explicitly instead of emitting
       invalid `IN ()` SQL.
     - The shared SQLite query-builder integration suite covers product-id
       array filtering, and the Worker proof verifies the same path through
       Durable Object SQLite and D1.
     - Validation passed: full Index unit suite in-band with 55 tests; Index
       SQLite integration suite with 40 tests; Index build;
       `medusa-cloudflare typecheck`; `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite`; Worker bundle Node-only
       import guard; portable entrypoint guard; and real module import audit.
346. Next Index persistence step: continue Product route parity by auditing
     remaining root direct filters that need seeded coverage, especially Admin
     `status` and other scalar fields, without moving dynamic calculated-price
     hydration into static Index projection.
347. Prove SQLite Index Admin Product `status` filter parity. Completed in
     this commit:
     - Product status is now included in the relation proof static Product
       input, matching the package-owned Product Index Worker static manifest.
     - A focused SQLite integration test seeds `published` and `draft` Product
       statuses and verifies `product.status = ["published"]`.
     - The Worker proof verifies the same Admin-style root status array filter
       through Durable Object SQLite and D1.
     - Validation passed: full Index unit suite in-band with 55 tests; Index
       SQLite integration suite with 41 tests; Index build;
       `medusa-cloudflare typecheck`; `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite`; Worker bundle Node-only
       import guard; portable entrypoint guard; and real module import audit.
348. Next Index persistence step: continue Product route parity with
     transformed relation filters such as `collection_id`, `type_id`,
     `tag_id`, `category_id`, and `sales_channel_id`, keeping calculated price
     out of static Index projection.
349. Prove SQLite Index Product transformed relation-filter parity. Completed
     in this commit:
     - A focused SQLite integration test seeds Product category, tag, and sales
       channel relations and verifies a combined relation filter matching the
       post-route shapes for `category_id`, `tag_id`, and `sales_channel_id`.
     - The Worker proof verifies the same route-shaped relation filters through
       Durable Object SQLite and D1.
     - Existing relation projection behavior is preserved: selecting a relation
       scalar still returns the hydrated related row, matching existing
       `product.variants.id` expectations.
     - Validation passed: full Index unit suite in-band with 55 tests; Index
       SQLite integration suite with 42 tests; Index build;
       `medusa-cloudflare typecheck`; `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite`; Worker bundle Node-only
       import guard; portable entrypoint guard; and real module import audit.
350. Next Index persistence step: prove direct Product `collection_id` and
     `type_id` filters using seeded Product root fields, keeping calculated
     price out of static Index projection.
351. Prove SQLite Index direct Product `collection_id` and `type_id` filter
     parity. Completed in this commit:
     - The Product type/collection proof seed now stores `collection_id` and
       `type_id` on the Product root row while preserving the Product status
       proof data.
     - A focused SQLite integration test verifies direct root filters
       `product.collection_id = ["pcol_1"]` and
       `product.type_id = ["ptyp_1"]`.
     - The Worker proof verifies the same direct Product filter shape through
       Durable Object SQLite and D1.
     - Validation passed: full Index unit suite in-band with 55 tests; Index
       SQLite integration suite with 43 tests; Index build;
       `medusa-cloudflare typecheck`; `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite`; Worker bundle Node-only
       import guard; portable entrypoint guard; and real module import audit.
352. Next Index persistence step: audit remaining Product route filters and
     defaults against the current proof matrix before moving beyond Product
     route parity.
353. Prove SQLite Index direct Product scalar/operator filter parity.
     Completed in this commit:
     - The Product relation proof static input now includes route scalar fields
       `handle`, `is_giftcard`, `external_id`, `collection_id`, `type_id`,
       `created_at`, `updated_at`, and `deleted_at`.
     - A focused SQLite integration test verifies direct scalar filters for
       handle, external id, boolean gift-card state, and timestamp range
       operators.
     - The Worker proof verifies the same scalar/operator filter shape through
       Durable Object SQLite and D1.
     - SQLite sync metadata assertions now track the expanded Product static
       field set.
     - Validation passed: full Index unit suite in-band with 55 tests; Index
       SQLite integration suite with 44 tests; Index build;
       `medusa-cloudflare typecheck`; `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite`; Worker bundle Node-only
       import guard; portable entrypoint guard; and real module import audit.
354. Next Index persistence step: re-audit Product route parity. If the proof
     matrix now covers the concrete Product route behaviors, move to the next
     Index-owned boundary rather than adding duplicate Product tests.
355. Prove SQLite Index Product nested variant route-filter parity. Completed
     in this commit:
     - The ProductVariant relation proof static input now includes
       `created_at`, `updated_at`, and `deleted_at`.
     - A focused SQLite integration test verifies a nested variant route filter
       combining a timestamp range with `variants.options.value` and
       `variants.options.option_id`.
     - The Worker proof verifies the same nested variant filter through Durable
       Object SQLite and D1.
     - SQLite sync metadata assertions now track the expanded ProductVariant
       static field set.
     - Validation passed: full Index unit suite in-band with 55 tests; Index
       SQLite integration suite with 45 tests; Index build;
       `medusa-cloudflare typecheck`; `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite`; Worker bundle Node-only
       import guard; portable entrypoint guard; and real module import audit.
356. Next Index persistence step: re-audit Product route parity. If no
     concrete Product route behavior gap remains, move to the next Index-owned
     boundary rather than adding duplicate Product tests.
357. Prove SQLite Index Worker Product event lifecycle. Completed in this
     commit:
     - The Worker proof now resolves Product `created`, `updated`, and
       `deleted` listeners from the existing static manifest.
     - A shared Index package helper emits create/update/delete through the
       actual worker event bus and checks the SQLite persisted state after each
       phase.
     - The proof remote query supports a mutable record source so the update
       and delete phases still exercise `query.graph` from the real
       `consumeEvent` path.
     - Both Durable Object SQLite and D1 workerd proofs assert Product create,
       update, and delete event behavior.
     - Validation passed: full Index unit suite in-band with 58 tests; Index
       SQLite integration suite with 45 tests; Index build;
       `medusa-cloudflare typecheck`; `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite`; Worker bundle Node-only
       import guard; portable entrypoint guard; and real module import audit.
358. Next Index persistence step: re-audit remaining Index-owned gaps after
     Product route parity and Product event lifecycle proof. Do not add
     duplicate Product tests unless a touched path needs them.
359. Prove SQLite Index Worker ProductVariantPriceSet attach/detach events.
     Completed in this commit:
     - The proof now emits `LinkProductVariantPriceSet.attached` through the
       actual Worker event bus and verifies that Product -> Variant -> Price
       traversal becomes queryable.
     - The proof then emits `LinkProductVariantPriceSet.detached` and verifies
       the same nested Product/Variant/Price filter returns no rows.
     - Package-owned proof fixtures seed only the non-link support rows needed
       for the attach event to become visible through existing relation
       traversal.
     - Both Durable Object SQLite and D1 workerd proofs assert the link
       attach/detach path.
     - Validation passed: full Index unit suite in-band with 59 tests; Index
       SQLite integration suite with 45 tests; Index build;
       `medusa-cloudflare typecheck`; `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite`; Worker bundle Node-only
       import guard; portable entrypoint guard; and real module import audit.
360. Next Index persistence step: re-audit Index completion against the proof
     matrix and continue only with concrete unproved Index behavior.
361. Fix SQLite Index post-load count metadata. Completed in this commit:
     - SQLite Index now reports pagination `estimate_count` from the
       post-load filtered root set when pagination is deferred for `q`,
       logical/deep root filters, nested relation filters, or nested ordering.
     - Direct SQL-filter paths continue using SQL `COUNT(*)`.
     - Existing SQLite provider assertions were updated from the old raw-root
       count to the final filtered root count.
     - The ProductVariantPriceSet attach/detach workerd proof keeps pagination
       on its detached nested relation query and asserts `estimate_count: 0`.
     - Validation passed: full Index unit suite in-band with 59 tests; Index
       SQLite integration suite with 45 tests; Index build;
       `medusa-cloudflare typecheck`; `medusa-cloudflare test:index-sqlite`;
       Worker bundle Node-only import guard; portable entrypoint guard; and
       real module import audit.
362. Next Index persistence step: re-audit Index completion after the
     count-metadata fix and continue only with a concrete unproved Index
     behavior or a proof-local shim that blocks treating Index as finished.
363. Move Product/link Worker proof runtime into the Index package. Completed
     in this commit:
     - `@medusajs/index/worker-composition` now exports
       `SqliteIndexWorkerProductProofRuntime` plus Product and
       ProductVariantPriceSet proof result/target types.
     - The Cloudflare app no longer owns the Product lifecycle and
       ProductVariantPriceSet attach/detach proof runtime class.
     - The app wrapper supplies only static input, event names, executor
       bindings, and proof record state.
     - Validation passed: full Index unit suite in-band with 59 tests; Index
       SQLite integration suite with 45 tests; Index build;
       `medusa-cloudflare typecheck`; `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite`; Worker bundle Node-only
       import guard; portable entrypoint guard; real module import audit; and
       `git diff --check`.
364. Next Index persistence step: re-audit Index completion after moving the
     Product/link proof runtime into the package. Continue only with a
     concrete unproved behavior or a remaining proof shim that prevents the app
     from staying a thin composition root.
365. Move Product/link Worker proof event resolution into the Index package.
     Completed in this commit:
     - `@medusajs/index/worker-composition` now exports
       `createSqliteIndexWorkerProductProofEvents`.
     - `SqliteIndexWorkerProductProofRuntime` derives Product
       created/updated/deleted and ProductVariantPriceSet attached/detached
       proof event names from the static input by default.
     - The Cloudflare app no longer imports
       `getSqliteIndexWorkerRequiredEntityListener` or hardcodes Product/link
       proof events in `index-worker-input.ts`.
     - Validation passed: full Index unit suite in-band with 61 tests; Index
       SQLite integration suite with 45 tests; Index build;
       `medusa-cloudflare typecheck`; `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite`; Worker bundle Node-only
       import guard; portable entrypoint guard; real module import audit; and
       `git diff --check`.
366. Next Index persistence step: re-audit Index completion after moving
     Product/link proof event resolution into the package. Continue only with
     a concrete unproved behavior or a remaining app-local proof shim.
367. Move Product/link Worker proof dependency ownership into the Index
     package. Completed in this commit:
     - `@medusajs/index/worker-composition` now exports
       `createSqliteIndexWorkerProductProofDependencies` plus the default
       Product and ProductVariantPriceSet proof targets.
     - The Cloudflare app no longer owns Product/link proof fixtures or
       mutable proof remote-query/event-bus dependency assembly.
     - The app `index-worker-proof-dependencies.ts` remains only as a
       compatibility alias layer for current app call sites.
     - Validation passed: full Index unit suite in-band with 62 tests; Index
       SQLite integration suite with 45 tests; Index build;
       `medusa-cloudflare typecheck`; `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite`; Worker bundle Node-only
       import guard; portable entrypoint guard; real module import audit; and
       `git diff --check`.
368. Next Index persistence step: re-audit Index completion after moving
     Product/link proof dependency ownership into the package. Continue only
     with a concrete unproved behavior or a remaining app-local proof shim
     that prevents the app from staying a thin composition root.
369. Remove the remaining app-local Product/link proof wrappers. Completed in
     this commit:
     - The Cloudflare Index proof app now instantiates
       `SqliteIndexWorkerProductProofRuntime` directly from
       `@medusajs/index/worker-composition`.
     - The app-local `IndexWorkerRuntime` subclass and Product/link proof
       dependency alias file were deleted.
     - The app continues to own only Cloudflare endpoint routing, D1/DO
       executor bindings, and static manifest/input selection for this proof.
     - Validation passed: `medusa-cloudflare typecheck`;
       `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite`; Worker bundle Node-only
       import guard; portable entrypoint guard; and real module import audit.
370. Next Index persistence step: perform an Index completion audit against
     current evidence before adding more behavior. If no concrete unproved
     behavior remains, record the Index milestone status instead of adding
     duplicate Product/link tests.
371. Record the SQLite Index milestone completion audit. Completed in this
     commit:
     - The accepted SQLite Index persistence and Worker proof matrix has no
       remaining concrete unproved Index behavior.
     - Validation passed: full Index unit suite in-band with 62 tests; Index
       build; SQLite Index integration suite with 45 tests;
       `medusa-cloudflare typecheck`; `medusa-cloudflare test:index-sqlite`;
       `medusa-cloudflare test:index-do-sqlite`; Worker bundle Node-only
       import guard; portable entrypoint guard; and real module import audit.
     - Product route/static Index parity is covered by route defaults, root
       array filters, `q` search, status, transformed relation filters,
       direct collection/type filters, scalar/operator filters, nested variant
       filters, Product event lifecycle, and ProductVariantPriceSet
       attach/detach events.
     - `variants.calculated_price` remains intentionally outside static Index
       projection and is handled by graph/pricing hydration after Index lookup.
     - The remaining Cloudflare app Index files are endpoint routing,
       executor adapters, and manifest selection, which are app-root
       responsibilities.
372. Next Cloudflare port step: leave the Index workstream and choose the next
     non-Index boundary from the roadmap. Do not add more Index tests unless a
     future change touches Index behavior or reveals a concrete route gap.
373. Add the Cloudflare tenant runtime foundation. Completed in this commit:
     - `@medusajs/cloudflare-runtime` now provides Worker-safe tenant runtime
       context validation, Durable Object partition addressing, and projection
       scope key helpers.
     - `apps/medusa-cloudflare` resolves tenant context from request
       headers/environment defaults at the application root.
     - The existing Index workerd proof now validates that tenant A and tenant
       B produce distinct cart partition names and catalog projection keys, and
       that invalid delimiter-bearing tenant IDs are rejected.
     - No Medusa module service, DML model, repository, workflow, Index
       behavior, or HTTP handler behavior changed.
     - Validation passed: `@medusajs/cloudflare-runtime` test/build,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       Worker bundle Node-only import guard, portable entrypoint guard, and
       real module import audit.
374. Next Cloudflare port step: use this tenant runtime context when a real
     DO/D1/projection storage boundary is touched. Do not expand it into a
     deployment registry or hosted user-code runtime before the next concrete
     vertical slice needs that boundary.
375. Scope the existing Index proof Durable Object route by tenant context.
     Completed in this commit:
     - `/do-index/:aggregateId/*` now resolves `TenantRuntimeContext` at the
       Worker app root and selects `INDEX_PROOFS.getByName` with
       `partition:{tenantId}:{deploymentId}:{environment}:{deploymentVersion}:index:{aggregateId}`.
     - `IndexProofDO` and the Index service remain unchanged; the platform
       address selection stays outside module behavior.
     - The workerd proof verifies that the same aggregate key under tenant A
       and tenant B maps to different Durable Object partition names, and that
       invalid tenant IDs are rejected before the namespace lookup.
     - Validation passed: `medusa-cloudflare typecheck`,
       `medusa-cloudflare test:index-sqlite`, Worker bundle Node-only import
       guard, portable entrypoint guard, and real module import audit.
376. Next Cloudflare port step: thread tenant runtime context into the next
     real storage boundary we touch, likely D1 projection scoping or a
     Cart-oriented DO proof. Do not build the hosted deployment registry yet.
377. Scope the existing Index proof D1 projection route by tenant context.
     Completed in this commit:
     - `@medusajs/cloudflare-runtime` now exposes
       `createProjectionDatabaseAddress`.
     - The Cloudflare app root resolves Index projection storage to a physical
       D1 binding from `TenantRuntimeContext`, using `INDEX_DB_TENANT_A` and
       `INDEX_DB_TENANT_B` in the local proof while preserving `INDEX_DB` as a
       default fallback.
     - This records the intended production direction: tenant/deployment
       context selects the D1 database namespace first; row-level tenant
       columns are not the primary isolation boundary for hosted Medusa
       projections.
     - The workerd proof verifies tenant A and tenant B run the same Index D1
       query proof against different D1 bindings, with invalid tenant IDs
       rejected before D1 selection.
     - Validation passed: `@medusajs/cloudflare-runtime` test/build,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:index-sqlite`,
       Worker bundle Node-only import guard, portable entrypoint guard, and
       real module import audit.
378. Next Cloudflare port step: continue foundation work only at real storage
     boundaries. A Cart-oriented DO proof is now a better next candidate than
     expanding the D1 resolver into a hosted registry.
379. Scope the existing Cart proof Durable Object route by tenant context.
     Completed in this commit:
     - `/do-cart/:aggregateId/*` now resolves `TenantRuntimeContext` at the
       Worker app root and selects `CART_PROOFS.getByName` with
       `partition:{tenantId}:{deploymentId}:{environment}:{deploymentVersion}:cart:{aggregateId}`.
     - `CartProofDO` and the Cart module services remain unchanged; the
       platform address selection stays outside commerce behavior.
     - The built workerd proof verifies that the same aggregate key under
       tenant A and tenant B maps to different Durable Object partition names,
       and that invalid tenant IDs are rejected before namespace lookup.
     - The Cart proof runner now validates the built Worker through Wrangler
       instead of Vite dev fallback, exposing and fixing Worker startup issues
       around optional Node hooks, global-scope random IDs, Web Crypto token
       generation, and alias precedence.
     - The Cart scenario now records Cloudflare Queue invalidation as
       asynchronous relative to the DO response; queue dispatch remains
       validated by the dedicated queue-consumer proof.
     - Validation passed: `medusa-cloudflare typecheck`,
       `medusa-cloudflare test:cart-do-sqlite`, `@medusajs/utils build`,
       Worker bundle Node-only import guard, portable entrypoint guard, and
       real module import audit.
380. Next Cloudflare port step: continue foundation work at another real
     storage/runtime boundary. Prefer either moving the next write-heavy proof
     through tenant-scoped DO addressing or resolving the existing module
     package build-graph blockers that prevent direct package builds for
     `api-key`, `inventory`, and `order`.
381. Resolve the module package build-graph blockers exposed by the Cart proof
     validation.
     Completed in this commit:
     - `@medusajs/utils` now exposes existing declaration files through its
       package export map for the root utility surface and the module-sdk
       static-manifest subpaths used by `api-key`, `inventory`, and `order`.
     - This keeps the fix in shared package metadata instead of adding local
       path aliases to individual commerce modules.
     - No runtime utility implementation, module service, DML model,
       repository, workflow, HTTP handler, or Worker behavior changed.
     - Validation passed: `@medusajs/api-key build`,
       `@medusajs/inventory build`, `@medusajs/order build`,
       `medusa-cloudflare typecheck`, `medusa-cloudflare test:cart-do-sqlite`,
       Worker bundle Node-only import guard, portable entrypoint guard, and
       real module import audit.
382. Next Cloudflare port step: continue with another narrow foundation slice
     only after choosing a real boundary. Good candidates are the next
     write-heavy DO proof adopting tenant-scoped addressing, or another direct
     package-build blocker if it prevents validating a touched commerce module.
383. Scope the existing Currency proof Durable Object route by tenant context.
     Completed in this commit:
     - `/do-currency/:aggregateId/*` now resolves `TenantRuntimeContext` at
       the Worker app root and selects `CURRENCY_PROOFS.getByName` with
       `partition:{tenantId}:{deploymentId}:{environment}:{deploymentVersion}:currency:{aggregateId}`.
     - `CurrencyProofDO` and the actual Currency module service remain
       unchanged from a behavior perspective; platform address selection stays
       outside module behavior.
     - `CurrencyProofDO` now creates its module runtime lazily so tenant
       capability checks across multiple DO instances do not eagerly initialize
       service runtimes against separate DO storage handles in one isolate.
     - The Currency DO proof runner now validates the built Worker through
       Wrangler instead of Vite dev fallback.
     - Validation passed: `medusa-cloudflare test:do-sqlite`,
       `medusa-cloudflare test:cart-do-sqlite`, `medusa-cloudflare typecheck`,
       `@medusajs/currency build`, Worker bundle Node-only import guard,
       portable entrypoint guard, and real module import audit.
384. Next Cloudflare port step: avoid spending more slices on disposable proof
     DO topology unless a real validation gap appears. Prefer the next module
     persistence/package-build blocker that keeps unchanged Medusa module
     services in the loop, or a real write-heavy commerce boundary beyond the
     existing Currency/Cart proof routes.
385. Record the commerce module-set completion audit. Completed in this commit:
     - The current Worker commerce/runtime module set passed the built
       Wrangler Durable Object SQLite proof through real services for
       Analytics, API Key, Auth, Cart, Caching, Currency, Customer, Event Bus,
       File, Fulfillment, Inventory, Locking, Notification, Order, Payment,
       Pricing, Product, Promotion, RBAC, Region, Sales Channel, Settings,
       Stock Location, Store, Tax, Translation, User, and Workflow Engine.
     - The proof also validated Cart totals, Queue dispatch, Durable Object
       locking, Workflow execution persistence, Workflow schedule persistence,
       alarm recovery, and atomic rollback.
     - Product's current Drizzle selector was rechecked through the unchanged
       module-test runner and all Product integration specs passed under
       Drizzle/SQLite: 10 suites, 205 passing, 1 skipped.
     - Validation passed: `medusa-cloudflare test:cart-do-sqlite`,
       `medusa-cloudflare typecheck`, Worker bundle Node-only import guard,
       portable entrypoint guard, and real module import audit.
386. Next Cloudflare port step: leave the broad commerce module-set sweep.
     Continue only when a real module change or missing unchanged integration
     suite creates a concrete gate. Otherwise move to the next runtime
     boundary that preserves Medusa services and handlers in place, likely
     production HTTP bootstrap, production Remote Query/Event Bus composition,
     or hosted platform routing.
387. Add a Fetch adapter streaming response bridge. Completed in this commit:
     - `FetchHttpAdapter` now supports the Express-style `writeHead`, `write`,
       and `end` response helpers used by unchanged Medusa workflow
       subscription routes.
     - `req.on("close", ...)` now maps to the Fetch request abort signal so
       existing cleanup hooks remain at the adapter boundary.
     - Normal `status/json/send/sendStatus` behavior remains unchanged.
     - Focused framework tests prove asynchronous stream writes after the
       route handler returns and request-close cleanup.
     - Validation passed: focused `fetch-http-adapter.spec.ts`,
       `@medusajs/framework build`, `medusa-cloudflare typecheck`, Worker
       bundle Node-only import guard, portable entrypoint guard, real module
       import audit, and `medusa-cloudflare test:cart-do-sqlite`.
388. Next Cloudflare port step: finish Worker proof/import validation for the
     Fetch adapter change, then continue production HTTP bootstrap only from a
     real missing runtime surface proven by unchanged Medusa handlers or
     integration assertions.
389. Move workflow subscription HTTP routes into the package-owned static
     manifest. Completed in this commit:
     - Added the two admin workflow subscription routes to the generated
       Medusa static HTTP manifest.
     - Kept the existing handlers and middleware, but changed workflow
       execution middleware to import from the Worker-safe HTTP subpath instead
       of the broad framework barrel.
     - Tightened subscription route typing to remove local `any` usage now
       that the handlers are in the Worker graph.
     - Added a Cloudflare proof workflow `subscribe`/`unsubscribe` fixture and
       an app Worker unit test that reads the first SSE event through the Fetch
       adapter.
     - Added idempotent Fetch stream cancel/close handling for SSE client
       cancellation.
     - Validation passed: static manifest generation/check, Medusa static API
       loader test, focused Fetch adapter test, `medusa-cloudflare test`,
       `medusa-cloudflare typecheck`, `@medusajs/framework build`,
       `@medusajs/medusa build`, HTTP proof manifest check, Worker import
       guard, portable entrypoint guard, real module import audit, and
       `medusa-cloudflare test:cart-do-sqlite`.
390. Next Cloudflare port step: keep HTTP bootstrap work tied to unchanged
     route-handler gaps. Good candidates are remaining handlers that require a
     missing Fetch request/response method or a package-owned manifest entry;
     avoid moving proof-only setup endpoints just to increase route count.
391. Move Admin Index HTTP routes into the package-owned static manifest.
     Completed in this commit:
     - Added `GET /admin/index/details`, `POST /admin/index/sync`, and the
       Admin Index middleware descriptor to the generated Medusa static HTTP
       manifest.
     - Kept the unchanged Admin Index handlers and real middleware, including
       the Index feature-flag guard and authentication middleware.
     - Narrowed Admin Index route and middleware imports to Worker-safe
       framework subpaths.
     - Updated the Cloudflare proof request preparation to persist admin proof
       auth through the real session path used by `authenticate()`.
     - Added a proof Index service and `query.index()` product branch so
       enabling the real Index feature flag does not break existing Store
       Product route proof coverage.
     - Validation passed: static manifest generation/check, Medusa static API
       loader test, `medusa-cloudflare test`, `medusa-cloudflare typecheck`,
       HTTP proof manifest check, Worker import guard, `@medusajs/framework`
       build, `@medusajs/medusa` build, portable entrypoint guard, real module
       import audit, and `medusa-cloudflare test:cart-do-sqlite`.
392. Next Cloudflare port step: continue only from real unchanged-handler
     pressure. Do not extract proof-only fixtures into shared packages; move
     route groups or adapter behavior when a real package handler requires it
     and can be validated through the unchanged manifest/runtime gates.
393. Move Fetch static HTTP manifest/resource composition into the shared
     framework helper. Completed in this commit:
     - `createFetchHttpStaticHandler` now accepts one manifest or a list of
       manifests.
     - The helper builds manifest resources when a prebuilt resource set is
       not supplied and can compose app-local resources before and after those
       generated manifest resources.
     - The Cloudflare app proof manifest now contains only app-local proof
       routes and feature-flag fixture middleware.
     - The Cloudflare app passes the app proof manifest plus Medusa package
       manifests directly to the shared Fetch helper.
     - Proof-only fake services and setup state remain app-owned.
     - Validation passed: focused Fetch adapter tests, Fetch/static subpath
       composition test, `@medusajs/framework` build, `medusa-cloudflare`
       typecheck/test, HTTP proof manifest check, Worker import guard,
       portable entrypoint guard, real module import audit, and
       `medusa-cloudflare test:cart-do-sqlite`.
394. Next Cloudflare port step: continue shared bootstrap extraction only
     where the boundary is reusable by a real Worker runtime. Do not move
     proof-only fixture services into framework or package code.
395. Replace Cloudflare app source-relative Medusa static manifest imports
     with package subpath imports. Completed in this commit:
     - Added `@medusajs/medusa/static/http-proof-manifest` to the Medusa
       package export surface.
     - Updated the Cloudflare app HTTP proof composition to import both
       Medusa static HTTP manifests from `@medusajs/medusa/static/*`.
     - Added TS, Vite, and import-guard aliases so local Worker validation
       resolves those package subpaths to source, matching the existing module
       static-manifest alias pattern.
     - Proved the built package exports with a direct Node import of both
       Medusa static manifest subpaths.
     - Validation passed: `medusa-cloudflare` typecheck/test, HTTP proof
       manifest check, Worker import guard, framework build, Medusa build,
       direct package-export import check, portable entrypoint guard, real
       module import audit, and `medusa-cloudflare test:cart-do-sqlite`.
396. Next Cloudflare port step: continue removing source-relative app imports
     only where the replacement package/static entrypoint is Worker-safe and
     validated by the import guard. Avoid widening package barrels that would
     drag Node-only code into the Worker graph.
397. Replace remaining direct `packages/core/utils/src` imports in the
     Cloudflare framework-utils shim with narrow package subpaths. Completed
     in this commit:
     - Added `@medusajs/utils` exports for
       `common/get-caller-file-path`,
       `common/get-selects-and-relations-from-object-array`,
       `common/remote-query-object-from-string`, `common/to-camel-case`, and
       `core-flows/events`.
     - Updated `apps/medusa-cloudflare/src/medusa-framework-utils.ts` to use
       those package subpaths instead of source-relative imports.
     - Added TS, Vite, and Worker import-guard aliases for the new subpaths.
     - Proved the built package subpaths with a direct Node import.
     - Validation passed: `@medusajs/utils` build, direct package import
       check, `@medusajs/framework` build, `medusa-cloudflare`
       typecheck/test, HTTP proof manifest check, Worker import guard,
       portable entrypoint guard, real module import audit, and
       `medusa-cloudflare test:cart-do-sqlite`.
398. Next Cloudflare port step: keep this cleanup incremental. Add package
     subpaths only for narrow Worker-safe modules, not broad barrels, and keep
     every replacement covered by the Worker import guard.
399. Add a Worker runtime source import guard. Completed in this commit:
     - Added `medusa-cloudflare check:runtime-source-imports`.
     - The guard scans `apps/medusa-cloudflare/src` and fails on direct
       `packages/*/src` imports.
     - Validation/build scripts may still use source aliases for proof wiring;
       the restriction is intentionally scoped to runtime app source.
     - Validation passed: `medusa-cloudflare check:runtime-source-imports`,
       Worker import guard, portable entrypoint guard, typecheck,
       `medusa-cloudflare test`, and `git diff --check`.
400. Next Cloudflare port step: stop the source-import cleanup lane unless a
     new runtime source reach-in appears. Continue with real Worker bootstrap
     gaps, unchanged route-handler pressure, or storage/runtime boundaries.
401. Add `FetchHttpStaticHandler.tryHandle()` for Worker-style HTTP
     composition. Completed in this commit:
     - The shared Fetch static handler can now return `undefined` for requests
       outside its manifest/setup path coverage.
     - Covered paths reuse the same handler path as `handle()`, so setup
       interception, request preparation, scope creation, middleware, and
       unchanged route handlers stay in one implementation.
     - `apps/medusa-cloudflare/src/worker.ts` now composes the static HTTP
       proof handler through `tryHandleStaticHttpProof(request)` instead of
       duplicating manifest path dispatch in the Worker entry.
     - Focused validation passed: direct Jest run of
       `packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts`,
       `@medusajs/framework build`, `medusa-cloudflare typecheck/test`,
       runtime source import guard, HTTP proof manifest check, Worker import
       guard, portable entrypoint guard, real module import audit,
       `medusa-cloudflare test:cart-do-sqlite`, and `git diff --check`.
     - Note: an attempted package-script focused framework test widened to
       unrelated HTTP tests because the script already sets
       `--testPathPattern=src`; it hit pre-existing Windows path snapshot
       differences in `routes-loader.spec.ts`.
     - Note: an initial parallel framework build plus app typecheck failed
       because the build temporarily removed framework `dist`; rerunning
       typecheck after the build completed passed.
402. Next Cloudflare port step: continue shared Worker HTTP composition only
     where the boundary belongs in the Fetch adapter. Do not move proof-only
     setup services, fake containers, or fixture state into framework code.
403. Prove Store Collections routes through workerd. Completed in this commit:
     - Added `/http-proof/collections` seed support to the app-local proof
       state service.
     - Seeded a product collection in the workerd proof and linked the proof
       product to it through `collection_id`.
     - Validated unchanged `GET /store/collections` and
       `GET /store/collections/:id` handlers through the static HTTP manifest
       and Fetch adapter in workerd.
     - Validated publishable-key middleware, locale middleware,
       unauthenticated store auth context, query pagination metadata, and
       missing collection 404 behavior.
     - Validation passed: `medusa-cloudflare typecheck`,
       `medusa-cloudflare test:cart-do-sqlite`, HTTP proof manifest check,
       Worker import guard, runtime source import guard,
       `medusa-cloudflare test`, portable entrypoint guard, real module import
       audit, and `git diff --check`.
     - Note: an initial parallel app test plus HTTP proof manifest check failed
       while the manifest check rebuilt framework `dist`; rerunning the app
       test after the build completed passed.
404. Next Cloudflare port step: continue route coverage one small unchanged
     group at a time. Prefer read-heavy catalog routes with existing narrow
     proof fixtures before moving to mutation-heavy admin routes.
405. Prove Store Product Tags routes through workerd. Completed in this
     commit:
     - Added `/http-proof/product-tags` seed support to the app-local proof
       state service.
     - Seeded a product tag in the workerd proof and linked the proof product
       to it through inline product tags.
     - Validated unchanged `GET /store/product-tags` and
       `GET /store/product-tags/:id` handlers through the static HTTP manifest
       and Fetch adapter in workerd.
     - Validated publishable-key middleware, locale middleware,
       unauthenticated store auth context, query pagination metadata, and
       missing product tag 404 behavior.
     - Validation passed: `medusa-cloudflare typecheck`,
       `medusa-cloudflare test:cart-do-sqlite`, HTTP proof manifest check,
       Worker import guard, runtime source import guard,
       `medusa-cloudflare test`, portable entrypoint guard, real module import
       audit, and `git diff --check`.
     - Note: an initial parallel app test plus HTTP proof manifest check failed
       while the manifest check rebuilt framework `dist`; rerunning the app
       test after the build completed passed.
406. Next Cloudflare port step: add the adjacent Store Product Types proof
     before expanding to larger admin mutation route groups.
407. Prove Store Product Types routes through workerd. Completed in this
     commit:
     - Added `/http-proof/product-types` seed support to the app-local proof
       state service.
     - Seeded a product type in the workerd proof and linked the proof product
       to it through `type_id`.
     - Validated unchanged `GET /store/product-types` and
       `GET /store/product-types/:id` handlers through the static HTTP
       manifest and Fetch adapter in workerd.
     - Validated publishable-key middleware, locale middleware,
       unauthenticated store auth context, query pagination metadata, and
       missing product type 404 behavior.
     - Validation passed: `medusa-cloudflare typecheck`,
       `medusa-cloudflare test:cart-do-sqlite`, HTTP proof manifest check,
       Worker import guard, runtime source import guard,
       `medusa-cloudflare test`, portable entrypoint guard, real module import
       audit, and `git diff --check`.
408. Next Cloudflare port step: continue read-heavy route proofs only when
     fixture state stays narrow. Otherwise pivot back to a real
     adapter/runtime gap.
409. Add Fetch request `protocol` compatibility. Completed in this commit:
     - Static manifest auth routes use `req.protocol` when building auth
       provider input.
     - Added `protocol` to the Fetch adapter request shim, derived from the
       Fetch request URL scheme.
     - Added focused Fetch adapter coverage for `req.protocol`, `req.url`, and
       `req.originalUrl`.
     - Validation passed: direct Jest run of
       `packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts`
       `@medusajs/framework build`, `medusa-cloudflare typecheck`, Worker
       import guard, runtime source import guard, portable entrypoint guard,
       HTTP proof manifest check, real module import audit,
       `medusa-cloudflare test`, `medusa-cloudflare test:cart-do-sqlite`, and
       `git diff --check`.
     - Note: an initial parallel app test plus HTTP proof manifest check failed
       while the manifest check rebuilt framework `dist`; rerunning the app
       test after the build completed passed.
410. Next Cloudflare port step: continue with adapter/runtime compatibility
     gaps discovered from unchanged manifest-included route handlers, not
     route-count expansion for its own sake.
411. Add Fetch raw-body preservation. Completed in this commit:
     - Static body parser routes can request `preserveRawBody`; original
       Medusa implements that through Express JSON parser `verify`.
     - The Fetch adapter now preserves raw JSON request bytes on `req.rawBody`
       while still exposing parsed `req.body`.
     - This supports unchanged webhook handlers such as
       `/hooks/payment/:provider`, which forwards `req.rawBody` to payment
       webhook processing.
     - The Worker path uses `Uint8Array` for the raw body instead of importing
       Node `Buffer`.
     - Validation passed: direct Jest run of
       `packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts`,
       `@medusajs/framework build`, `medusa-cloudflare typecheck`, Worker
       import guard, runtime source import guard, portable entrypoint guard,
       HTTP proof manifest check, real module import audit,
       `medusa-cloudflare test`, `medusa-cloudflare test:cart-do-sqlite`, and
       `git diff --check`.
412. Next Cloudflare port step: continue adapter/runtime compatibility work
     from unchanged handler pressure. Prefer missing request metadata or
     response helper compatibility over expanding route count alone.
413. Add Fetch numeric status response compatibility. Completed in this
     commit:
     - Original Medusa runs on Express 4, where `res.send(200)` sends status
       `200` with body `OK`.
     - The unchanged Admin Index sync route uses `res.send(200)`.
     - The Fetch response shim now treats numeric `res.send(status)` and
       `res.sendStatus(status)` as Express status-message responses.
     - Updated the app Worker test and workerd proof script to assert `OK`
       for `/admin/index/sync`, replacing the old Fetch-specific body `200`
       assertion.
     - Validation passed: direct Jest run of
       `packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts`,
       `@medusajs/framework build`, `medusa-cloudflare typecheck`, Worker
       import guard, runtime source import guard, portable entrypoint guard,
       HTTP proof manifest check, real module import audit,
       `medusa-cloudflare test`, `medusa-cloudflare test:cart-do-sqlite`, and
       `git diff --check`.
414. Next Cloudflare port step: continue adapter/runtime compatibility work
     from unchanged handler pressure. Avoid route proof expansion unless it
     exposes a concrete mismatch.
415. Prove the real payment webhook route through workerd. Completed in this
     commit:
     - Added `/hooks/payment/:provider` and `hooksRoutesMiddlewares` to the
       generated Medusa HTTP proof manifest.
     - Executed the unchanged webhook handler through the Fetch adapter in
       Vitest and workerd.
     - Captured the emitted `payment.webhook_received` event in the static
       proof event bus and asserted provider params, parsed body, raw body
       text, request headers, and webhook delay/retry options.
     - Added the missing Worker-safe `PaymentWebhookEvents` export to the
       `@medusajs/framework/utils` shim.
     - Narrowed the webhook route catch error before reading `.message`, which
       keeps the route strict-type-safe when imported into the Worker graph.
     - Validation passed: focused webhook Worker test,
       `@medusajs/framework build`, `medusa-cloudflare typecheck`, Worker
       import guard, runtime source import guard, portable entrypoint guard,
       HTTP proof manifest check, real module import audit,
       `medusa-cloudflare test`, `medusa-cloudflare test:cart-do-sqlite`, and
       `git diff --check`.
416. Next Cloudflare port step: continue adapter/runtime compatibility from
     real route pressure. Prefer importing another unchanged route group that
     is likely to expose missing Fetch request/response compatibility.
417. Extract Medusa-owned Fetch HTTP handler factory. Completed in this
     commit:
     - Added `@medusajs/medusa/static/fetch-http-handler` with
       `createMedusaFetchHttpHandler`.
     - The factory always includes the generated Medusa static HTTP manifest
       and delegates to the shared framework Fetch adapter.
     - The Cloudflare app now passes only proof-specific manifests/resources
       and request hooks, instead of directly importing the generic Fetch
       factory and primary Medusa HTTP manifest.
     - Added package export and app build/typecheck/import-guard aliases for
       the new Medusa static runtime entrypoint.
     - Validation passed: `@medusajs/medusa build`,
       `medusa-cloudflare typecheck`, Worker import guard, runtime source
       import guard, portable entrypoint guard, HTTP proof manifest check, real
       module import audit, `medusa-cloudflare test`,
       `medusa-cloudflare test:cart-do-sqlite`, and `git diff --check`.
418. Next Cloudflare port step: continue extracting runtime-neutral HTTP
     assembly only when it removes real app-owned glue. Keep Cloudflare
     bindings and proof state in the app until the production runtime boundary
     is clearer.
419. Formalize the Medusa Fetch runtime options contract. Completed in
     `a4326fa500`:
     - Added `MedusaFetchHttpRuntimeOptions` and
       `MedusaFetchHttpAdditionalManifestInput` to
       `@medusajs/medusa/static/fetch-http-handler`.
     - Kept `createMedusaFetchHttpHandler` as the Medusa-owned static Fetch
       composition factory that injects the generated Medusa HTTP manifest.
     - Updated the Cloudflare proof runtime to define its handler options as a
       `satisfies MedusaFetchHttpRuntimeOptions` object, so app-owned proof
       hooks are checked against the package boundary without widening their
       types.
     - Validation passed: `@medusajs/medusa build`,
       `medusa-cloudflare typecheck`, Worker import guard, runtime source
       import guard, portable entrypoint guard, HTTP proof manifest check, real
       module import audit, `medusa-cloudflare test`,
       `medusa-cloudflare test:cart-do-sqlite`, and `git diff --check`.
420. Next Cloudflare port step: use the Medusa-owned Fetch runtime boundary as
     the stable composition point for the next real runtime gap. Do not move
     tenant registries, proof stores, or Cloudflare deployment concerns into
     `@medusajs/medusa` until a real storage or bootstrap boundary requires it.
421. Add a Medusa Fetch runtime definition helper. Completed in `1cb22e4a9c`:
     - Added `defineMedusaFetchHttpRuntime(...)` to
       `@medusajs/medusa/static/fetch-http-handler`.
     - Added named Medusa Fetch runtime hook aliases for request-scope
       creation, request preparation, setup handling, setup-path matching, and
       the runtime hook object.
     - Updated the Cloudflare proof runtime to define its static Fetch options
       through the Medusa helper instead of directly shaping generic framework
       handler options.
     - Kept proof resources, Cloudflare bindings, tenant routing, and
       deployment registry concerns in the Cloudflare app.
     - Validation passed: `@medusajs/medusa build`,
       `medusa-cloudflare typecheck`, Worker import guard, runtime source
       import guard, portable entrypoint guard, HTTP proof manifest check, real
       module import audit, `medusa-cloudflare test`,
       `medusa-cloudflare test:cart-do-sqlite`, and `git diff --check`.
422. Next Cloudflare port step: continue from real unchanged route pressure to
     find the next Fetch adapter or request-scope gap. Do not move more proof
     state into Medusa until shared bootstrap can construct real module request
     scopes.
423. Prove real Auth login and register routes through workerd. Completed in
     `7d6e50445d`:
     - Removed the proof setup intercepts for
       `POST /auth/:actor_type/:auth_provider` and
       `POST /auth/:actor_type/:auth_provider/register`.
     - The real Auth route handlers now execute through the package-owned
       static HTTP manifest and Fetch adapter in Vitest and workerd.
     - The proof asserts parsed JSON body, dynamic route params, auth module
       service, config module, protocol-compatible request shape, and
       Worker-safe JWT payload generation.
     - Session, token refresh, update, and reset-password remain proof/setup
       owned until cookie/session or workflow requirements are moved behind
       shared runtime contracts.
     - Validation passed: focused Auth worker test,
       `@medusajs/medusa build`, `medusa-cloudflare typecheck`, Worker import
       guard, runtime source import guard, portable entrypoint guard, real
       module import audit, HTTP proof manifest check,
       `medusa-cloudflare test`, `medusa-cloudflare test:cart-do-sqlite`, and
       `git diff --check`.
424. Next Cloudflare port step: continue removing proof setup interception only
     where it proves a real runtime boundary. For Auth, the remaining setup
     routes need shared cookie/session or workflow support before moving to
     real handlers.
425. Add Fetch session hooks and prove real Auth session routes through
     workerd. Completed in `69921ef7b2`:
     - Added Fetch adapter `createSession` and `commitSession` runtime hooks
       so non-Express runtimes can attach `req.session` and persist session
       mutations after unchanged route handlers execute.
     - Exposed the session hook surface through the Medusa-owned static Fetch
       runtime contract and definition helper.
     - Allowed Auth middleware to consume an upstream runtime-authenticated
       `AuthContext` before falling back to session or JWT verification.
     - Added `packages/medusa/src/api/auth/session/route.ts` to the generated
       Medusa static HTTP manifest.
     - Removed `/auth/session` from proof setup ownership and validated real
       `POST /auth/session` plus `DELETE /auth/session` in Vitest and workerd.
     - Validation passed: focused Fetch adapter Jest test,
       `@medusajs/framework build`, Medusa static manifest generation/check,
       `@medusajs/medusa build`, `medusa-cloudflare typecheck`, Worker import
       guard, runtime source import guard, portable entrypoint guard, real
       module import audit, HTTP proof manifest check,
       `medusa-cloudflare test`, `medusa-cloudflare test:cart-do-sqlite`, and
       `git diff --check`.
426. Next Cloudflare port step: continue from real unchanged route pressure.
     Auth token refresh and update are reasonable candidates if the shared
     session/auth hooks are enough; reset-password should wait until it proves
     a useful workflow/runtime dependency.
427. Prove the real Auth token refresh route through workerd. Completed in
     `4538e68cbc`:
     - Added `packages/medusa/src/api/auth/token/refresh/route.ts` to the
       generated Medusa static HTTP manifest.
     - Removed `/auth/token/refresh` from proof setup ownership and deleted
       the proof-only token refresh responder.
     - Reused the upstream runtime-authenticated AuthContext path from the
       Fetch auth/session slice so the unchanged route can run without pulling
       Node-only JWT verification into Worker middleware.
     - Validated that the unchanged route resolves the Auth service, retrieves
       the AuthIdentity, resolves config, and emits a refreshed JWT through
       Medusa's existing helper.
     - The proof now asserts the real Medusa refresh contract, including empty
       `user_metadata` when the route calls the JWT helper without an
       `authProvider`.
428. Next Cloudflare port step: handle Auth update separately. It uses
     `validateToken()` and calls `getAuthContextFromJwtToken` directly, so it
     needs an adapter-safe token validation boundary instead of relying on the
     generic Auth middleware's upstream AuthContext path.
429. Prove the real Auth provider update route through workerd. Completed in
     `74b7cccce6`:
     - Added a shared HTTP request-context slot for pre-validated token
       payloads through `setMedusaRequestValidatedTokenPayload` and
       `getMedusaRequestValidatedTokenPayload`.
     - Updated Auth `validateToken()` to prefer the pre-validated payload while
       keeping the original Node JWT verifier path as the fallback.
     - Removed the proof setup intercept for
       `POST /auth/:actor_type/:auth_provider/update`.
     - The Cloudflare proof runtime now verifies the update token during
       `prepareRequest`, narrows the payload, and lets unchanged Medusa
       middleware and route code update the provider through the Auth module.
     - Vitest and workerd now assert update route execution with no proof
       response header and then prove the provider state changed by logging in
       with the updated password.
430. Next Cloudflare port step: leave reset-password as its own slice because
     it exercises workflow runtime dependencies, not just HTTP/Auth
     request-context portability.
431. Prove grouped workflow Event Bus release through reset-password in
     workerd. Completed in `ce01178067`:
     - Added provider-level coverage for `clearGroupedEvents(eventGroupId, {
       eventNames })` before release in `@medusajs/event-bus-cloudflare`.
     - Aligned the Worker static proof Event Bus with Medusa's grouped workflow
       event lifecycle: staged grouped emits, released grouped events after
       workflow completion, and selective grouped-event clearing.
     - Removed reset-password as merely a proof/setup blind spot by validating
       the real unchanged `/auth/:actor_type/:auth_provider/reset-password`
       route through the Fetch adapter.
     - Vitest and workerd now assert the released `auth.password_reset` event,
       original metadata payload, and reset token payload.
     - Validation passed: `@medusajs/event-bus-cloudflare` Jest suite and
       build, `medusa-cloudflare typecheck`, Worker import guard, runtime
       source import guard, portable entrypoint guard, real module import
       audit, HTTP proof manifest check, `medusa-cloudflare test`,
       `medusa-cloudflare test:cart-do-sqlite`, and `git diff --check`.
432. Next Cloudflare port step: lift workflow execution and schedule
     persistence behind shared package-owned runtime contracts before expanding
     app-owned proof behavior. Event Bus queue dispatch is now sufficient for
     the reset-password workflow proof; the next workflow pressure should not
     become another app-local shim.
433. Extract the Workflow Engine delayed-action store contract. Completed in
     `a1c57bf46c`:
     - Added `WorkflowDelayedActionStore` and delayed-action record types to
       the existing `workflow-engine-inmemory` utility boundary.
     - Added `InMemoryWorkflowDelayedActionStore`, preserving default
       timer-backed behavior through the injected `WorkflowSchedulerAdapter`.
     - Registered `workflowDelayedActionStore` in the Workflow Engine loader
       when no deployment-specific store is provided.
     - Threaded the store into `InMemoryDistributedTransactionStorage` and
       cleared it on application shutdown.
     - Retry and timeout paths are intentionally not moved in this slice; the
       next slice routes `scheduleRetry`, `scheduleStepTimeout`, and
       `scheduleTransactionTimeout` through the contract.
     - Validation passed: focused Workflow Engine storage Jest suite,
       `@medusajs/workflow-engine-inmemory build`, `medusa-cloudflare
       typecheck`, composed Worker import guard, and runtime source import
       guard.
434. Next Cloudflare port step: route retry, step-timeout, and
     transaction-timeout scheduling through `WorkflowDelayedActionStore` while
     preserving the default Node timer-backed behavior.
435. Route Workflow Engine retry and timeout scheduling through the delayed
     action store. Completed in `1550196c85`:
     - Tightened `WorkflowDelayedActionStore` so the public contract exposes
       delayed-action records only. Timer handles are private to the default
       in-memory implementation.
     - Routed `scheduleRetry`, `scheduleStepTimeout`, and
       `scheduleTransactionTimeout` through the injected delayed-action store.
     - Routed `clearRetry`, `clearStepTimeout`, and
       `clearTransactionTimeout` through delayed-action cancellation.
     - Preserved default Node behavior with `InMemoryWorkflowDelayedActionStore`
       and the injected `WorkflowSchedulerAdapter`.
     - Delayed-action records now capture action kind, workflow id,
       transaction id, optional step id, due timestamp, and a narrowed workflow
       run context.
     - Validation passed: focused Workflow Engine storage Jest suite,
       `@medusajs/workflow-engine-inmemory build`, `medusa-cloudflare
       typecheck`, Worker import guard, runtime source import guard, portable
       entrypoint guard, real module import audit, `medusa-cloudflare test`,
       `medusa-cloudflare test:cart-do-sqlite`, and `git diff --check`.
     - The package integration runner was attempted but blocked by local
       PostgreSQL credentials before workflow behavior executed:
       `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`.
436. Add the Cloudflare Workflow Engine delayed-action store provider.
     Completed in `2efb4ae5c1`:
     - Added `@medusajs/workflow-engine-cloudflare/delayed-action-store` as an
       isolated provider subpath. The provider package root still exports
       nothing.
     - Persisted Workflow Engine internal delayed actions in Durable Object
       SQLite with action kind, workflow id, transaction id, optional step id,
       due timestamp, context JSON, handled timestamp, and cancellation
       timestamp.
     - Kept the Durable Object alarm pointed at the earliest pending delayed
       action.
     - Added provider-owned recovery primitives for due action listing,
       callback execution, handled-state recording, failed-action preservation,
       and alarm rescheduling.
     - Kept `apps/medusa-cloudflare` unchanged in this slice. Wiring waits for
       a package-owned Workflow Engine delayed-action recovery API.
     - Validation passed: `@medusajs/workflow-engine-cloudflare` Jest suite,
       provider build, `medusa-cloudflare typecheck`, Worker import guard,
       runtime source import guard, portable entrypoint guard, real module
       import audit, `medusa-cloudflare test`, and
       `medusa-cloudflare test:cart-do-sqlite`.
437. Next Cloudflare port step: add the package-owned Workflow Engine recovery
     API for due delayed actions. The Cloudflare Durable Object alarm should
     call Workflow Engine service recovery in the later wiring slice, not own
     retry or timeout execution logic in `apps/medusa-cloudflare`.
438. Add the package-owned Workflow Engine delayed-action recovery API.
     Completed in `1e7df9bd9e`:
     - Added `RecoverableWorkflowDelayedActionStore` and
       `WorkflowDelayedActionRecoveryResult` to the existing delayed-action
       boundary.
     - Added `recoverDueDelayedActions(now?)` through
       `InMemoryDistributedTransactionStorage`, `WorkflowOrchestratorService`,
       `WorkflowsModuleService`, and `IWorkflowEngineService`.
     - Recovery delegates due action execution to the same
       `runDelayedWorkflowAction(...)` path used by timer-backed retry and
       timeout callbacks.
     - Default Node/in-memory stores that do not implement durable recovery
       return an empty recovery result.
     - Validation passed: focused Workflow Engine storage Jest suite,
       `@medusajs/types build`, `@medusajs/workflow-engine-inmemory build`,
       `medusa-cloudflare typecheck`, Worker import guard, runtime source
       import guard, portable entrypoint guard, real module import audit,
       `medusa-cloudflare test`, and `medusa-cloudflare test:cart-do-sqlite`.
     - Existing package integration was attempted but blocked before workflow
       behavior by local PostgreSQL auth:
       `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`.
       PostgreSQL tools for an isolated temp cluster were not available on
       PATH.
439. Next Cloudflare port step: wire
     `@medusajs/workflow-engine-cloudflare/delayed-action-store` into
     `apps/medusa-cloudflare` composition and have `CartProofDO.alarm()` call
     the Workflow Engine service's `recoverDueDelayedActions(...)` API
     alongside scheduled workflow recovery.
440. Wire Cloudflare delayed-action store into the Durable Object runtime and
     alarm path. Completed in `3acf03429c`:
     - `CartProofDO` now constructs `DurableObjectWorkflowDelayedActionStore`
       from the Durable Object storage binding.
     - `createCommerceModulesRuntimeWithManager(...)` registers
       `workflowDelayedActionStore` and declares it as a Workflow Engine
       dependency only when the app root supplies one.
     - `CartProofDO.alarm()` now calls both package-owned recovery APIs:
       `recoverDueSchedules()` and `recoverDueDelayedActions()`.
     - The Cart DO workerd proof now creates a real retrying workflow,
       persists its retry delayed action in Durable Object SQLite, clears
       runtime handlers, and verifies the workflow completes through delayed
       action recovery.
     - The validated workerd run recovered through the automatic Durable Object
       alarm before the explicit service fallback call, proving the app alarm
       path is active.
     - `DurableObjectWorkflowDelayedActionStore` now marks a recovered action
       handled even if the resumed workflow clears the same retry action during
       normal cleanup.
     - Validation passed: `@medusajs/workflow-engine-cloudflare` Jest suite,
       provider build, `medusa-cloudflare typecheck`, Worker import guard,
       runtime source import guard, portable entrypoint guard, real module
       import audit, `medusa-cloudflare test`, and
       `medusa-cloudflare test:cart-do-sqlite`.
441. Next Cloudflare port step: broaden real workflow proof coverage for
     delayed actions. Prefer existing Workflow Engine retry/timeout assertions
     where practical, and keep app code as composition/proof only.
442. Prove step-timeout delayed-action recovery in the Cloudflare workerd
     runtime. Completed in `bd5df21e4f`:
     - Added a proof-only `step-timeout-alarm-proof` route to `CartProofDO`.
     - The proof uses a real async Workflow Engine step with `timeout: 0.1`,
       matching the existing Medusa async step-timeout integration pattern.
     - First run persists a `step-timeout` delayed action in Durable Object
       SQLite.
     - Runtime delayed-action handlers are cleared before recovery.
     - Recovery happens through the automatic Durable Object alarm path or the
       package-owned `recoverDueDelayedActions(...)` fallback.
     - The workerd proof verifies final `reverted` transaction state,
       `TransactionStepTimeoutError`, handled delayed-action state, and no
       pending delayed actions after cleanup.
     - Validation passed: focused `@medusajs/workflow-engine-inmemory` Jest
       storage suite, `medusa-cloudflare typecheck`, Worker import guard,
       runtime source import guard, portable entrypoint guard, real module
       import audit, `medusa-cloudflare test`, and
       `medusa-cloudflare test:cart-do-sqlite`.
443. Next Cloudflare port step: prove transaction-timeout delayed-action
     recovery in workerd using the existing Workflow Engine service and
     Cloudflare delayed-action store.
444. Prove transaction-timeout delayed-action recovery in the Cloudflare
     workerd runtime. Completed in `72ca5aca12`:
     - Added a proof-only `transaction-timeout-alarm-proof` route to
       `CartProofDO`.
     - The proof uses a real workflow-level `timeout: 0.1` and async Workflow
       Engine step, matching the existing Medusa async transaction-timeout
       fixture pattern.
     - First run persists a `transaction-timeout` delayed action in Durable
       Object SQLite.
     - Runtime delayed-action handlers are cleared before recovery.
     - Recovery happens through the automatic Durable Object alarm path or the
       package-owned `recoverDueDelayedActions(...)` fallback.
     - The workerd proof verifies final `reverted` transaction state,
       `TransactionTimeoutError`, handled delayed-action state, and no pending
       delayed actions after cleanup.
     - Validation passed: focused `@medusajs/workflow-engine-inmemory` Jest
       storage suite, `medusa-cloudflare typecheck`, Worker import guard,
       runtime source import guard, portable entrypoint guard, real module
       import audit, `medusa-cloudflare test`, and
       `medusa-cloudflare test:cart-do-sqlite`.
445. The delayed-action runtime goal now has durable Cloudflare proof coverage
     for retry, step-timeout, and transaction-timeout delayed actions through
     the existing Workflow Engine service. A focused unchanged integration
     selector was attempted and remains blocked by local PostgreSQL auth before
     workflow behavior executes:
     `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`.
446. Add a repeatable temp PostgreSQL runner for
     `@medusajs/workflow-engine-inmemory` integration tests. Completed in
     `eb92c01de0`:
     - Added `test:integration:temp-postgres`, which initializes an isolated
       PostgreSQL cluster using `PG_BIN` or the local Windows PostgreSQL
       install under `C:\Program Files\PostgreSQL`.
     - The runner injects DB credentials only into the child Jest process and
       stops/removes the temp cluster afterward.
     - Focused existing integration selectors for retry, step timeout, and
       transaction timeout now pass through the temp runner.
     - The dedicated retry-interval integration file also passes through the
       temp runner.
     - The full Workflow Engine integration suite now reaches behavior instead
       of failing at PostgreSQL auth, but still has separate failures in cron
       scheduling, parallel async error reporting, and cleaner deletion.
447. Next Workflow Engine test-lane step: restore Node/default integration
     behavior without adding cron parsing to the Worker bundle. Start with a
     Node-only cron parser adapter boundary for scheduled workflow tests.
448. Restore Node cron scheduling for the Workflow Engine integration lane
     without adding cron parsing to the Worker bundle. Completed in `cb8e52bea1`:
     - Added `@medusajs/workflow-engine-inmemory/node-scheduler-adapter` as an
       isolated Node-only subpath that imports `cron-parser`.
     - Left the default Worker-compatible scheduler adapter cron-parser-free.
     - Injected the Node scheduler adapter into the existing Workflow Engine
       integration spec and declared `workflowSchedulerAdapter` as a module
       dependency so it reaches the module-local container.
     - Focused unchanged scheduled workflow integration selector now passes
       through the temp PostgreSQL runner.
     - Worker import, runtime source import, and portable entrypoint guards
       still pass.
     - A broader temp-postgres index run now passes cron scheduling and the
       parallel async error assertion. The remaining observed index failure is
       cleaner deletion by id through the internal workflow execution service.
449. Next Workflow Engine test-lane step: fix the cleaner job deletion path in
     `@medusajs/workflow-engine-inmemory` so the unchanged cleaner integration
     assertion passes.
450. Fix Workflow Engine cleaner deletion and stabilize the temp PostgreSQL
     integration lane. Completed in `1b90a01e6f`:
     - Expirable Workflow Engine executions are now deleted by the
       `WorkflowExecution` composite primary key:
       `workflow_id`, `transaction_id`, and `run_id`.
     - The generated `id` column remains indexed but is no longer used as the
       delete identifier for the generated internal service.
     - The temp PostgreSQL runner now starts the isolated server with UTC
       settings and passes `TZ=UTC`/`PGTZ=UTC` into Jest so retention-time
       comparisons use the same time basis as `Date.now()`.
     - The runner's default package integration files now run `--runInBand`,
       matching the deterministic command path used for focused workflow
       integration validation.
     - Focused cleaner integration selector passes.
     - Full `@medusajs/workflow-engine-inmemory test:integration:temp-postgres`
       now passes all package integration files: index, race, subscribe, and
       retry-interval.
     - Worker import, runtime source import, and portable entrypoint guards
       still pass.
451. Next Workflow Engine step: move back to Cloudflare/workerd provider
     coverage or the next selected runtime boundary. The Node temp-postgres
     Workflow Engine package integration lane is green.
452. Adopt the colocated Workflow Execution DO proof plan before implementing
     the next Workflow Engine Cloudflare provider slice:
     - New roadmap:
       `plan/roadmaps/workflow-execution-colocated-do-goal.md`.
     - New tracker:
       `plan/roadmaps/workflow-execution-colocated-do-turn-tracker.md`.
     - The next proof should persist Workflow Engine execution rows inside the
       current Cart-oriented DO SQLite partition, selected by tenant and
       deployment scope at the app root.
     - This is a proof of transaction-boundary colocation, not a final
       tenant-wide or module-wide Durable Object topology.
     - Cloudflare Workflows remains out of scope as a Medusa Workflow Engine
       replacement for this goal.
453. Align the Cloudflare Workflow Execution store provider with the current
     composite-key cleaner contract. Completed in `5cd566ee57`:
     - Confirmed the Cart proof DO already selects
       `DurableObjectWorkflowExecutionStore` at the app composition root.
     - Updated the provider to list and delete expirable finished executions
       by `workflow_id`, `transaction_id`, and `run_id`, matching the
       `WorkflowExecution` model primary key used by the Node store.
     - Kept the provider isolated behind the Cloudflare backend-specific
       subpath.
     - Provider tests and build pass.
     - `medusa-cloudflare` typecheck and `test:cart-do-sqlite` pass.
     - Worker import, runtime source import, and portable entrypoint guards
       pass.
454. Next colocated Workflow Execution DO proof step: add a Cart proof DO
     cleaner assertion that expires and deletes finished workflow executions
     through the same DO SQLite execution-store provider.
455. Add the colocated Workflow Execution cleaner proof. Completed in
     `118a553f9f`:
     - Exposed `clearExpiredExecutions()` on `IWorkflowEngineService`.
     - Delegated the new service method through both the in-memory and Redis
       Workflow Engine service implementations to their existing storage
       cleaners.
     - Added `POST /do-cart/:scope/execution-cleaner-proof` to seed expired
       finished, not-yet-expired finished, and expired running workflow
       executions in the Cart proof DO SQLite execution store.
     - Extended `medusa-cloudflare test:cart-do-sqlite` so workerd proves only
       expired finished executions are deleted.
     - `medusa-cloudflare` typecheck, Cart DO SQLite proof, Worker import
       guard, runtime source import guard, and portable entrypoint guard pass.
     - Full `@medusajs/workflow-engine-inmemory test:integration:temp-postgres`
       remains green.
456. The colocated Workflow Execution DO proof goal is now ready for final
     checkpoint commit and completion audit. Do not expand this proof into a
     final tenant partition topology yet.
457. Move the lazy static Fetch handler wrapper into the Medusa-owned runtime
     helper boundary. Completed in `c01cbea4c1`:
     - Added `createLazyMedusaFetchHttpHandler(...)` to
       `@medusajs/medusa/static/fetch-http-handler`.
     - Switched `apps/medusa-cloudflare/src/static-http-proof.ts` to define
       runtime hooks/manifests and consume the Medusa-owned lazy handler
       wrapper instead of owning the local singleton `FetchHttpStaticHandler`
       wiring.
     - Added focused Medusa static Fetch helper coverage.
     - Validation passed: focused Medusa Jest test, framework build,
       `@medusajs/medusa build`, `medusa-cloudflare` typecheck, Worker import
       guard, runtime source import guard, portable entrypoint guard, real
       module import audit, HTTP proof manifest check, app Vitest suite, Cart
       DO SQLite workerd proof, and `git diff --check`.
458. Next HTTP/runtime step: continue extracting app-owned bootstrap only when
     the target is a runtime-neutral Medusa helper, or use unchanged route
     pressure to expose the next concrete Fetch adapter/request-scope gap. Do
     not move tenant topology, proof stores, or Cloudflare deployment registry
     concerns into `@medusajs/medusa`.
459. Move Admin workflow execution read routes into the package-owned Medusa
     static HTTP manifest. Completed in `ec9d2c37d9`:
     - Added the list, retrieve-by-id, and retrieve-by-workflow/transaction
       handlers to `packages/medusa/static-http-manifests/store-admin.json`.
     - Regenerated the Medusa static HTTP manifest.
     - Removed only the read-route proof setup intercepts; workflow execution
       mutation setup endpoints remain app-owned.
     - Extended the Worker and workerd proofs so the real unchanged handlers
       read seeded workflow execution state through the Fetch adapter with no
       `x-medusa-http-proof` setup response header.
     - Validation passed: Medusa static manifest check, HTTP proof manifest
       check, `medusa-cloudflare` typecheck, focused Worker workflow execution
       spec, Worker import guard, runtime source import guard, portable
       entrypoint guard, real module import audit, and Cart DO SQLite workerd
       proof.
460. Next HTTP/runtime step: do not move workflow execution mutation routes
     until the Worker-safe Workflow Engine write/execution boundary is chosen.
     Prefer the next slice that exposes a concrete adapter/request-scope gap
     without rebuilding Medusa behavior in the Cloudflare app.
461. Move the Admin workflow execution run route into the package-owned Medusa
     static HTTP manifest. Completed in `c37f2cb984`:
     - Added `POST /admin/workflows-executions/:workflow_id/run` to
       `packages/medusa/static-http-manifests/store-admin.json`.
     - Regenerated the Medusa static HTTP manifest.
     - Removed the app-owned proof setup intercept for the run route.
     - Extended the Worker-safe proof `IWorkflowEngineService.run(...)` so
       proof workflow ids return the real Medusa acknowledgement shape and
       create workflow execution rows consumed by the real read handlers.
     - Validation passed: Medusa static manifest check, HTTP proof manifest
       check, `medusa-cloudflare` typecheck, focused Worker workflow execution
       spec, Worker import guard, runtime source import guard, portable
       entrypoint guard, real module import audit, and Cart DO SQLite workerd
       proof.
462. Next workflow execution mutation route step: add
     `setStepSuccess(...)` support to the Worker-safe proof Workflow Engine
     service, then move only
     `POST /admin/workflows-executions/:workflow_id/steps/success` into the
     package-owned manifest. Keep failure separate.
463. Move the Admin workflow execution step-success route into the
     package-owned Medusa static HTTP manifest. Completed in `16018e93c9`:
     - Added `POST /admin/workflows-executions/:workflow_id/steps/success` to
       `packages/medusa/static-http-manifests/store-admin.json`.
     - Regenerated the Medusa static HTTP manifest.
     - Removed the app-owned proof setup intercept for the success route.
     - Extended the Worker-safe proof `IWorkflowEngineService` with
       `setStepSuccess(...)` so the unchanged route can mark an execution as
       `done`, clear waiting-step state, and persist the step output.
     - Validation passed: Medusa static manifest check, HTTP proof manifest
       check, focused Worker workflow execution spec, `medusa-cloudflare`
       typecheck, Worker import guard, runtime source import guard, portable
       entrypoint guard, real module import audit, and Cart DO SQLite workerd
       proof.
464. Next workflow execution mutation route step: add
     `setStepFailure(...)` support to the Worker-safe proof Workflow Engine
     service, then move
     `POST /admin/workflows-executions/:workflow_id/steps/failure` into the
     package-owned manifest.
465. Move the Admin workflow execution step-failure route into the
     package-owned Medusa static HTTP manifest. Completed in `c606fe1dfa`:
     - Added `POST /admin/workflows-executions/:workflow_id/steps/failure` to
       `packages/medusa/static-http-manifests/store-admin.json`.
     - Regenerated the Medusa static HTTP manifest.
     - Removed the app-owned proof setup intercept for the failure route.
     - Extended the Worker-safe proof `IWorkflowEngineService` with
       `setStepFailure(...)` so the unchanged route can mark an execution as
       `reverted`, set failed/reverted flags, clear waiting-step state, and
       persist the step output.
     - Validation passed: Medusa static manifest check, HTTP proof manifest
       check, `medusa-cloudflare` typecheck, focused Worker workflow execution
       spec, Worker import guard, runtime source import guard, portable
       entrypoint guard, real module import audit, and Cart DO SQLite workerd
       proof.
466. Next HTTP/runtime step: the Admin workflow execution route group is now
     fully package-owned for the current proof surface. Continue only with a
     route group or runtime helper that exposes a real adapter gap, not another
     proof-only HTTP shortcut.
467. Move the Admin Users read routes into the package-owned Medusa static HTTP
     manifest. Completed in `e921934cbe`:
     - Added `GET /admin/users` and `GET /admin/users/me` plus Admin Users
       middleware to `packages/medusa/static-http-manifests/store-admin.json`.
     - Regenerated the Medusa static HTTP manifest.
     - Removed only the app-owned proof setup intercepts for the two read
       routes; retrieve-by-id, mutations, and role paths remain proof-owned.
     - Added a Worker-safe `REMOTE_QUERY` fixture for the `user` entry point.
     - Seeded a deterministic static user for the authenticated admin actor
       during proof request preparation so `/admin/users/me` resolves through
       the real `req.auth_context.actor_id` path.
     - Fixed a real portability gap by changing Admin Users middleware imports
       from the broad `@medusajs/framework` barrel to
       `@medusajs/framework/http`, removing Node/MikroORM edges from the
       Worker graph.
     - Validation passed: Medusa static manifest check, HTTP proof manifest
       check, `medusa-cloudflare` typecheck, focused Worker Admin Users spec,
       Worker import guard, runtime source import guard, portable entrypoint
       guard, real module import audit, and Cart DO SQLite workerd proof.
468. Next HTTP/runtime step: continue with a small route that pressures the
     same real Admin Users path, likely `GET /admin/users/:id`, then keep
     update/delete/roles separate because they add mutation and RBAC behavior.
469. Move the Admin Users retrieve-by-id route into the package-owned Medusa
     static HTTP manifest. Completed in `84d9e35197`:
     - Split the existing retrieve handler into
       `packages/medusa/src/api/admin/users/[id]/get-route.ts`.
     - Kept the normal `route.ts` as the Node/Express route module exporting
       all methods, including mutation handlers.
     - Added an explicit `/admin/users/:id` static manifest entry pointing at
       the GET-only helper so the Worker graph does not import
       mutation-only `@medusajs/core-flows`.
     - Removed only the app-owned proof setup intercept for
       `GET /admin/users/:id`; update/delete and role paths remain app-owned.
     - Extended Worker and workerd proofs so current-user, list, and retrieve
       all execute through the real Fetch/static Medusa route path.
     - Fixed the already moved workflow step routes to import `StepResponse`
       from `@medusajs/workflows-sdk` directly instead of the broad framework
       re-export, keeping framework container/MikroORM edges out of the Worker
       graph.
     - Validation passed: Medusa static manifest check, HTTP proof manifest
       check, `medusa-cloudflare` typecheck, focused Worker Admin Users spec,
       Worker import guard, runtime source import guard, portable entrypoint
       guard, real module import audit, and Cart DO SQLite workerd proof.
470. Next HTTP/runtime step: keep Admin Users mutation and role routes separate.
     Move the next route only when its workflow or RBAC dependencies can be
     made Worker-safe at the package boundary, not by adding app-owned
     reimplementations.
471. Move the Admin Users roles read route into the package-owned Medusa
     static HTTP manifest. Completed in `357f927abe`:
     - Split the existing roles list handler into
       `packages/medusa/src/api/admin/users/[id]/roles/get-route.ts`.
     - Kept the normal roles `route.ts` as the Node/Express route module
       exporting all methods, including role assignment/removal mutations.
     - Added an explicit `/admin/users/:id/roles` static manifest entry
       pointing at the GET-only helper so the Worker graph does not import
       role mutation workflows from `@medusajs/core-flows`.
     - Added a Worker-safe static `QUERY.graph` fixture for `user_rbac_role`
       rows with nested `rbac_role` data.
     - Removed only the app-owned proof setup intercept for
       `GET /admin/users/:id/roles`; role assign/remove paths remain
       app-owned.
     - Extended Worker and workerd proofs so current-user, list, retrieve, and
       roles read all execute through the real Fetch/static Medusa route path.
     - Validation passed: Medusa static manifest check, HTTP proof manifest
       check, `medusa-cloudflare` typecheck, focused Worker Admin Users spec,
       Worker import guard, runtime source import guard, portable entrypoint
       guard, real module import audit, and Cart DO SQLite workerd proof.
472. Next HTTP/runtime step: Admin Users remaining routes are mutation/RBAC
     workflow paths. Do not move them until the role/user workflow dependencies
     are Worker-safe at the package boundary.
473. Move the Admin Users role-assignment route into the package-owned Medusa
     static HTTP manifest. Completed in `4c200ba1a4`:
     - Added a method-specific `POST /admin/users/:id/roles` helper and static
       manifest entry.
     - Preserved the real Medusa role-assignment workflow call and response
       contract, passing the request container through workflow run options for
       the Worker proof runtime.
     - Added portable user-role workflow subpath exports and changed the
       touched workflow imports to use `@medusajs/workflows-sdk` directly.
     - Extended the proof runtime with minimal RBAC, link, user, and user-role
       fixtures required by the existing workflow.
     - Validation passed: core-flows build, Medusa static manifest generation
       and check, HTTP proof manifest check, `medusa-cloudflare` typecheck,
       focused Worker Admin Users spec, Worker import guard, runtime source
       import guard, portable entrypoint guard, real module import audit, and
       Cart DO SQLite workerd proof.
474. Move the Admin Users role-removal routes into the package-owned Medusa
     static HTTP manifest. Completed in `23a55a2127`:
     - Added method-specific helpers and static manifest entries for
       `DELETE /admin/users/:id/roles` and
       `DELETE /admin/users/:id/roles/:role_id`.
     - Preserved the real Medusa role-removal workflow calls and response
       contracts, passing the request container through workflow run options
       for the Worker proof runtime.
     - Removed app-owned proof setup handling for both role-removal paths.
     - Replaced runtime `@medusajs/framework/modules-sdk` imports in the common
       remote-link workflow steps with narrow structural link service types and
       `@medusajs/types` `LinkDefinition`.
     - Validation passed: core-flows build, Medusa static manifest generation
       and check, HTTP proof manifest check, `medusa-cloudflare` typecheck,
       focused Worker Admin Users spec, Worker import guard, runtime source
       import guard, portable entrypoint guard, real module import audit, and
       Cart DO SQLite workerd proof.
475. Move the Admin Users update route into the package-owned Medusa static
     HTTP manifest. Completed in `3b4b5af33f`:
     - Added a method-specific `POST /admin/users/:id` helper and static
       manifest entry.
     - Preserved the real Medusa user-update workflow, refetch, and response
       contract, passing the request container through workflow run options for
       Worker execution.
     - Added the user update workflow package subpath, switched the touched
       workflow path to portable workflow SDK/type/event imports, and added the
       Cloudflare Vite source alias for that subpath.
     - The proof runtime now supplies a Worker-safe `Modules.USER` service and
       no longer intercepts the user update path.
     - Validation passed: Medusa static manifest check, HTTP proof manifest
       check, `medusa-cloudflare` typecheck, focused Worker Admin Users spec,
       Worker import guard, runtime source import guard, portable entrypoint
       guard, real module import audit, and Cart DO SQLite workerd proof.
476. Move the Admin Users delete route into the package-owned Medusa static
     HTTP manifest. Completed in `71aafe9079`:
     - Added a method-specific `DELETE /admin/users/:id` helper and static
       manifest entry.
     - Preserved the real Medusa self-delete guard,
       `removeUserAccountWorkflow`, and response contract, passing the request
       container through workflow run options for Worker execution.
     - Added the remove-user-account workflow package subpath, switched the
       touched delete workflow path to portable workflow SDK/type/event
       imports, and added the Cloudflare Vite/import-guard source aliases for
       that subpath.
     - Replaced the touched remote-link delete workflow dependency on
       `@medusajs/framework/modules-sdk` with a narrow structural link service
       type.
     - The proof runtime now supplies Worker-safe user soft-delete/restore,
       auth identity metadata update, link cascade delete/restore, and
       `auth_identity` remote-query fixtures, and no longer intercepts the
       user delete path.
     - Validation passed: Medusa static manifest generation and check, HTTP
       proof manifest check with larger Node heap on rerun,
       `medusa-cloudflare` typecheck, focused Worker Admin Users spec, Worker
       import guard, runtime source import guard, portable entrypoint guard,
       real module import audit, and Cart DO SQLite workerd proof.
477. Reduce the app-local framework utility shim dependency for the proven
     Admin Users delete workflow path. Completed in `55bc41c10a`:
     - Switched the Worker-facing user delete workflow path from
       `@medusajs/framework/utils` imports to direct portable
       `@medusajs/utils/*` subpaths for `Modules`,
       `ContainerRegistrationKeys`, and `remoteQueryObjectFromString`.
     - Touched only the workflow helpers already proven by
       `DELETE /admin/users/:id`: `deleteUsersWorkflow`, `deleteUsersStep`,
       `setAuthAppMetadataStep`, `emitEventStep`, `removeRemoteLinkStep`, and
       `useRemoteQueryStep`.
     - Validation passed: `medusa-cloudflare` typecheck, focused Worker Admin
       Users spec, Worker import guard, runtime source import guard, portable
       entrypoint guard, real module import audit, and Cart DO SQLite workerd
       proof. One workerd run timed out waiting for local health after build;
       the immediate rerun passed.
478. Reduce the app-local framework utility shim dependency for the proven
     Admin Users update workflow path. Completed in `dd304d0bbc`:
     - Switched `updateUsersStep` from `@medusajs/framework/utils` to the
       direct portable `@medusajs/utils/modules-sdk/definition` subpath for
       `Modules`.
     - Touched only the step already proven by `POST /admin/users/:id`.
     - Validation passed: `medusa-cloudflare` typecheck, focused Worker Admin
       Users spec, Worker import guard, runtime source import guard, portable
       entrypoint guard, real module import audit, Cart DO SQLite workerd proof,
       and `git diff --check`.
479. Reduce the app-local framework utility shim dependency for the proven
     Admin Users list route. Completed in `8206e97f3e`:
     - Switched `GET /admin/users` from `@medusajs/framework/utils` to direct
       portable `@medusajs/utils/common/container` and
       `@medusajs/utils/common/remote-query-object-from-string` imports.
     - Touched only the package-owned route already proven by the Admin Users
       Worker spec and static HTTP manifest.
     - Validation passed: `medusa-cloudflare` typecheck, focused Worker Admin
       Users spec, Worker import guard, runtime source import guard, portable
       entrypoint guard, real module import audit, Cart DO SQLite workerd proof,
       and `git diff --check`.
480. Reduce the app-local framework utility shim dependency for the proven
     Admin Users current-user route. Completed in `2633b7303f`:
     - Switched `GET /admin/users/me` from `@medusajs/framework/utils` to
       direct portable `@medusajs/utils/common/container`,
       `@medusajs/utils/common/errors`, and
       `@medusajs/utils/common/remote-query-object-from-string` imports.
     - Touched only the package-owned route already proven by the Admin Users
       Worker spec and static HTTP manifest.
     - Validation passed: `medusa-cloudflare` typecheck, focused Worker Admin
       Users spec, Worker import guard, runtime source import guard, portable
       entrypoint guard, real module import audit, Cart DO SQLite workerd proof,
       and `git diff --check`.
481. Reduce the app-local framework utility shim dependency for the proven
     Admin Users retrieve route. Completed in `97bd44901b`:
     - Switched `GET /admin/users/:id` from `@medusajs/framework/utils` to
       direct portable `@medusajs/utils/common/container`,
       `@medusajs/utils/common/errors`, and
       `@medusajs/utils/common/remote-query-object-from-string` imports.
     - Touched only the package-owned route already proven by the Admin Users
       Worker spec and static HTTP manifest.
     - Validation passed: `medusa-cloudflare` typecheck, focused Worker Admin
       Users spec, Worker import guard, runtime source import guard, portable
       entrypoint guard, real module import audit, Cart DO SQLite workerd proof,
       and `git diff --check`.
482. Reduce the app-local framework utility shim dependency for the proven
     Admin Users delete route. Completed in `fa74885692`:
     - Switched `DELETE /admin/users/:id` from `@medusajs/framework/utils` to
       direct portable `@medusajs/utils/common/errors` for `MedusaError`.
     - Touched only the package-owned route already proven by the Admin Users
       Worker spec and static HTTP manifest.
     - Validation passed: `medusa-cloudflare` typecheck, focused Worker Admin
       Users spec, Worker import guard, runtime source import guard, portable
       entrypoint guard, real module import audit, Cart DO SQLite workerd proof,
       and `git diff --check`.
483. Reduce the app-local framework utility shim dependency for the proven
     Admin Users roles list route. Completed in `0562b082b6`:
     - Switched `GET /admin/users/:id/roles` from
       `@medusajs/framework/utils` to direct portable
       `@medusajs/utils/common/container` for `ContainerRegistrationKeys`.
     - Touched only the package-owned route already proven by the Admin Users
       Worker spec and static HTTP manifest.
     - Validation passed: `medusa-cloudflare` typecheck, focused Worker Admin
       Users spec, Worker import guard, runtime source import guard, portable
       entrypoint guard, real module import audit, Cart DO SQLite workerd proof,
       and `git diff --check`.
484. Reduce the app-local framework utility shim dependency for the proven
     Admin Users roles assignment route. Completed in `a43f038146`:
     - Switched `POST /admin/users/:id/roles` from
       `@medusajs/framework/utils` to direct portable
       `@medusajs/utils/common/container` and
       `@medusajs/utils/common/errors`.
     - Touched only the package-owned route already proven by the Admin Users
       Worker spec and static HTTP manifest.
     - Validation passed: `medusa-cloudflare` typecheck, focused Worker Admin
       Users spec, Worker import guard, runtime source import guard, portable
       entrypoint guard, real module import audit, Cart DO SQLite workerd proof,
       and `git diff --check`.
485. Reduce the app-local framework utility shim dependency for the proven
     Admin Users roles removal route. Completed in `2c4e83d2e5`:
     - Switched `DELETE /admin/users/:id/roles` from
       `@medusajs/framework/utils` to direct portable
       `@medusajs/utils/common/container` and
       `@medusajs/utils/common/errors`.
     - Touched only the package-owned route already proven by the Admin Users
       Worker spec and static HTTP manifest.
     - Validation passed: `medusa-cloudflare` typecheck, focused Worker Admin
       Users spec, Worker import guard, runtime source import guard, portable
       entrypoint guard, real module import audit, Cart DO SQLite workerd proof,
       and `git diff --check`.
486. Next HTTP/runtime step: continue reducing the app-local framework utility
     shim only along already proven Worker-facing paths, or move to a real
     shared Fetch/runtime helper if the next adapter gap is concrete. Do not
     add app-owned replacement route behavior to keep proving easy paths.
487. Add a Worker-side production HTTP module runtime source. Completed in this
     slice:
     - Added `createMedusaCloudflareHttpModuleRuntimeSource(...)` in
       `apps/medusa-cloudflare`.
     - The source lazily creates a module runtime from an explicitly selected
       Drizzle manager and Cloudflare module runtime options, then derives
       Fetch HTTP runtime options from the shared Medusa container.
     - Tenant/storage binding selection remains outside the request-scope hook.
       The Worker default still uses proof HTTP options, so route behavior is
       unchanged.
     - Validation passed: `medusa-cloudflare` typecheck, Worker/request-scope
       Vitest suite, Worker import guard, runtime source import guard, portable
       entrypoint guard, real module import audit, Cart DO SQLite workerd
       proof, and `git diff --check`.
488. Prove the production HTTP source against explicit Cart DO storage.
     Completed in this slice:
     - Added `/do-cart/:id/http-production-options-proof`.
     - The proof builds production Fetch HTTP options through the Worker-side
       module runtime source using the Cart DO SQLite manager, workflow stores,
       locking binding, and queue binding.
     - The proof verifies `/admin/plugins` is present in the Fetch static
       handler and the production request scope resolves the real Cart module
       service from the DO-backed commerce runtime.
     - The Worker default still uses proof HTTP options; no route behavior,
       session/auth behavior, or Remote Query behavior changed.
     - Validation passed: `medusa-cloudflare` typecheck, focused
       Worker/request-scope Vitest selector, Worker import guard, runtime
       source import guard, portable entrypoint guard, real module import audit,
       and Cart DO SQLite workerd proof.
489. Extract shared HTTP request setup from the Express loader. Completed in
     this slice:
     - Added runtime-neutral helpers in `@medusajs/framework/http` for
       request-scope creation, request id assignment, and request context
       merging.
     - Updated the Express loader to use the shared helper while preserving
       Express middleware ordering and behavior.
     - Updated the Cloudflare request-scope factory to call the same scope
       helper instead of directly calling `container.createScope()`.
     - Validation passed: framework build, focused framework request-context
       Jest file, `medusa-cloudflare` typecheck, focused Worker/request-scope
       Vitest selector, `@medusajs/medusa` build, Worker import guard, runtime
       source import guard, portable entrypoint guard, real module import
       audit, Cart DO SQLite workerd proof, and `git diff --check`.
490. Next HTTP/runtime step: extract the next shared bootstrap primitive only
     when both Express and Fetch need it. The next likely candidate is
     request/session/auth or Remote Query binding over the production HTTP
     source. Do not move app-owned proof glue into shared packages unless it is
     replacing an existing Medusa bootstrap behavior.
491. Extract shared Fetch auth session hooks. Completed in this slice:
     - Added portable cookie-backed Fetch auth-session hooks in
       `@medusajs/framework/http`.
     - The helper creates request sessions, loads `auth_context` from an
       injected store, commits session cookies, destroys sessions, and parses
       named Fetch cookies without depending on Express or Node APIs.
     - Updated the Cloudflare proof runtime to keep its in-memory proof store
       app-local while delegating reusable cookie/session mechanics to the
       shared framework helper.
     - Validation passed: focused framework Fetch session Jest file, framework
       build, `medusa-cloudflare` typecheck, focused Worker auth/session
       Vitest selector, `@medusajs/medusa` build, Worker import guard, runtime
       source import guard, portable entrypoint guard, real module import
       audit, Cart DO SQLite workerd proof, and `git diff --check`.
492. Next HTTP/runtime step: wire the shared Fetch auth-session hooks into the
     production HTTP source only when a real durable/session store boundary is
     introduced. Do not promote the proof in-memory store into shared Medusa
     code.
493. Prove production Fetch sessions with Durable Object SQLite storage.
     Completed in this slice:
     - Added an app-level `DurableObjectSqliteFetchAuthSessionStore` that
       implements the shared Fetch auth-session store contract.
     - Wired the Cart DO production HTTP source to pass durable
       `createSession` and `commitSession` hooks into
       `createMedusaCloudflareHttpModuleRuntimeSource`.
     - Extended the Cart DO production-options proof to create, read, and
       destroy a Fetch session through the real handler and assert the session
       row is removed from DO SQLite after destroy.
     - The default Worker HTTP handler still uses proof runtime options; this
       does not switch global HTTP behavior.
     - Validation passed: `medusa-cloudflare` typecheck, focused
       Worker/request-scope Vitest selector, Cart DO SQLite workerd proof,
       `@medusajs/medusa` build, Worker import guard, runtime source import
       guard, portable entrypoint guard, real module import audit, and
       `git diff --check`.
494. Next HTTP/runtime step: add the next missing production HTTP source
     boundary before switching the default Worker handler. Prefer a real route
     proof that exposes either request/auth preparation or Remote Query binding
     instead of adding more app-local proof-only behavior.
495. Prove a real production Remote Query route through the Cart DO HTTP
     source. Completed in this slice:
     - Added Worker-safe direct-entrypoint Remote Query registration to
       `@medusajs/modules-sdk/static-app`, using static module joiner aliases
       and loaded module services instead of importing the full Node-oriented
       Remote Query planner.
     - Wired the Cloudflare commerce module runtime to register that Remote
       Query function from the same static manifests used to load modules.
     - Extended the Cart DO production-options proof so the real
       `GET /store/currencies` Medusa route runs through the Fetch handler,
       query validation middleware, and `remoteQueryObjectFromString` against
       the DO SQLite-backed module runtime.
     - The direct-entrypoint helper intentionally does not implement relation
       traversal, `QUERY.graph`, or index hydration yet. Unsupported query
       shapes fail loudly.
     - Validation passed: modules-sdk build, `medusa-cloudflare` typecheck,
       Cart DO SQLite workerd proof, Worker import guard, runtime source
       import guard, portable entrypoint guard, real module import audit,
       `@medusajs/medusa` build, and `git diff --check`.
496. Prove a real production `QUERY.graph` route through the Cart DO HTTP
     source. Completed in this slice:
     - Added minimal Worker-safe direct-entrypoint `QUERY.graph` registration
       to `@medusajs/modules-sdk/static-app`, reusing static module joiner
       aliases and loaded module services.
     - Extended the Cart DO scenario to seed a Product Type through the
       unchanged Product module service.
     - Extended the production-options proof so the real
       `GET /store/product-types` Medusa route runs through the Fetch handler,
       query validation middleware, and `QUERY.graph` against the DO
       SQLite-backed module runtime.
     - The direct graph helper intentionally does not implement relation
       traversal, `query.index(...)`, `query.gql(...)`, or multi-service graph
       hydration yet. Unsupported graph shapes remain outside this proof.
     - Validation passed: modules-sdk build, `medusa-cloudflare` typecheck,
       Cart DO SQLite workerd proof, Worker import guard, runtime source
       import guard, portable entrypoint guard, real module import audit,
       `@medusajs/medusa` build, and `git diff --check`.
497. Next HTTP/runtime step: choose the next production HTTP source route proof
     based on the missing boundary it exposes. Prefer either request/auth
     preparation on a protected route or graph behavior beyond direct module
     entrypoints before switching the default Worker handler away from proof
     HTTP options.
498. Start replacing the temporary static Query bridge with shared Query
     runtime pieces. Turn 1 completed in this slice:
     - Added `normalizeQueryConfig(...)` under the existing
       `@medusajs/modules-sdk` remote-query boundary.
     - Updated the real `Query` class to delegate input normalization to that
       helper while leaving execution, Remote Query, Index hydration,
       translation, caching, and Node `MedusaApp` behavior unchanged.
     - Recorded the turn-by-turn portable Query runtime goal in
       `plan/roadmaps/portable-query-runtime-goal.md`.
     - Validation passed: focused Remote Query Jest files, modules-sdk build,
       `@medusajs/medusa` build, and portable entrypoint guard.
499. Extract the direct-entrypoint executor from `static-app.ts` into shared
     Query runtime code. Completed in this slice:
     - Added `executeDirectEntrypointQuery(...)` under
       `@medusajs/modules-sdk` remote-query code.
     - Moved direct service lookup, `listAndCount*` method dispatch, selected
       fields, filters, and pagination metadata out of `static-app.ts`.
     - Kept static manifest entrypoint derivation and current
       `REMOTE_QUERY`/`QUERY.graph(...)` registrations behaviorally unchanged.
     - Validation passed: modules-sdk build, `medusa-cloudflare` typecheck,
       Cart DO SQLite workerd proof, Worker import guard, runtime source
       import guard, portable entrypoint guard, real module import audit,
       `@medusajs/medusa` build, and `git diff --check`.
500. Introduce a shared portable Query registration factory. Completed in this
     slice:
     - Added `createPortableQueryRuntime(...)` under
       `@medusajs/modules-sdk` remote-query code.
     - The shared factory now returns both direct `remoteQuery(...)` and
       direct `query.graph(...)` runtime objects.
     - Moved direct query input validation, graph input validation, execution
       dispatch, and graph result shaping out of `static-app.ts`.
     - Reduced `registerStaticRemoteQuery(...)` to a static-manifest wrapper
       that derives joiner-alias entrypoints and registers the shared runtime
       outputs.
     - Validation passed: modules-sdk build, `medusa-cloudflare` typecheck,
       Cart DO SQLite workerd proof, Worker import guard, runtime source
       import guard, portable entrypoint guard, real module import audit, and
       `@medusajs/medusa` build.
501. Split Node Query runtime entrypoints from portable Query runtime
     entrypoints. Completed in this slice:
     - Added `@medusajs/modules-sdk/remote-query/portable` for Worker-safe
       direct-entrypoint Query runtime exports.
     - Added `@medusajs/modules-sdk/remote-query/node` for explicit
       Node-oriented `Query` and `RemoteQuery` exports.
     - Kept `@medusajs/modules-sdk/remote-query` as a compatibility barrel.
     - Updated `static-app.ts` to import Query runtime pieces through the
       portable entrypoint.
     - Extended the portable entrypoint guard to bundle and validate
       `@medusajs/modules-sdk/remote-query/portable`; it passed with 4 bundled
       inputs.
     - Validation passed: modules-sdk build, focused Node Query tests,
       `@medusajs/medusa` build, `medusa-cloudflare` typecheck, Cart DO SQLite
       workerd proof, Worker import guard, runtime source import guard,
       portable entrypoint guard, and real module import audit.
502. Extract Remote Query service fetching into an adapter-safe helper shared
     by the Node `RemoteQuery` path and the portable direct-entrypoint
     runtime. Completed in this slice:
     - Added `remote-fetch-data.ts` under `@medusajs/modules-sdk`
       remote-query code.
     - Moved method suffix normalization, `list` versus `listAndCount`
       selection, method validation, tracing hook execution, empty-id
       behavior, pagination result shaping, and batching into the shared
       helper.
     - Updated Node `RemoteQuery` to delegate service fetch mechanics to the
       helper while keeping RemoteJoiner planning and module lookup in the
       Node runtime.
     - Updated the portable direct-entrypoint executor to call the same shared
       service method helper for direct `listAndCount*` execution.
     - Added focused helper tests for method suffixes, pagination, empty ids,
       batching, and tracing.
     - Validation passed: modules-sdk build, focused Query/fetch-helper tests,
       `@medusajs/medusa` build, `medusa-cloudflare` typecheck, Cart DO SQLite
       workerd proof, Worker import guard, runtime source import guard,
       portable entrypoint guard, and real module import audit.
503. Prove the first bounded portable Query relation traversal through a real
     Medusa route. Completed in this slice:
     - Picked `GET /store/collections/:id` as the smallest route target
       because it uses the unchanged Store Collection route and the
       already-loaded Product module service.
     - Added first-level relation derivation to the shared portable
       direct-entrypoint executor: dotted fields such as `products.id` now
       derive `relations: ["products"]` before the real module service call.
     - Extended the Cart DO SQLite production HTTP proof to seed a product
       collection through the real Product module service and assert that
       `fields=id,title,products.id,products.title` returns the related
       product through the unchanged route.
     - Kept full RemoteJoiner parity, link traversal, multi-service joins, and
       `query.index(...)` outside this slice.
     - Added explicit `medusa-cloudflare` tsconfig path mappings for local
       modules-sdk declarations needed by the app typecheck.
     - Validation passed: modules-sdk relation helper test, modules-sdk build,
       `@medusajs/medusa` build, `medusa-cloudflare` typecheck, Cart DO SQLite
       workerd proof, Worker import guard, runtime source import guard,
       portable entrypoint guard, real module import audit, and
       `git diff --check`.
504. Decide the `query.index(...)` boundary. Completed in this slice:
     - Audited real direct `query.index(...)` route usage. The only direct
       package route callers are `GET /store/products` and
       `GET /admin/products`.
     - Confirmed both product-list Index paths are behind the Index Engine
       feature flag.
     - Preserved Node `Query.index(...)` behavior unchanged.
     - Added an explicit `index(...)` method to the portable Worker Query
       service with an optional portable Index handler.
     - Without a handler, portable `query.index(...)` now fails with a clear
       Worker-safe adapter-boundary error rather than a generic missing-method
       failure.
     - Kept production HTTP Index hydration deferred. The existing Worker Index
       proof remains separate and passed for Durable Object SQLite and D1.
     - Validation passed: focused portable Query and Node Query.index tests,
       modules-sdk build, `@medusajs/medusa` build, `medusa-cloudflare`
       typecheck, Worker import guard, runtime source import guard, portable
       entrypoint guard, real module import audit, Worker Index proof, and
       `git diff --check`.
505. Reduce the remaining static bridge registration shape. Completed in this
     slice:
     - Moved static joiner-config alias parsing and direct entrypoint map
       construction out of `static-app.ts`.
     - Added shared portable Query helpers:
       `createDirectEntrypointQueryEntriesFromJoinerConfigs(...)` and
       `createPortableQueryRuntimeFromJoinerConfigs(...)`.
     - Left `static-app.ts` responsible only for static module loading, loaded
       service collection, and container registration of `REMOTE_QUERY` and
       `QUERY`.
     - Route behavior and container keys remain unchanged.
     - Validation passed: focused portable Query tests, modules-sdk build,
       `@medusajs/medusa` build, `medusa-cloudflare` typecheck, Worker import
       guard, runtime source import guard, portable entrypoint guard, real
       module import audit, Cart DO SQLite workerd proof, and
       `git diff --check`.
506. Evaluate whether the default Worker HTTP handler can move one step away
     from proof runtime options. Completed in this slice:
     - Confirmed the default top-level Worker HTTP handler still uses
       `staticHttpProofRuntimeOptions`.
     - Confirmed the production module-backed HTTP runtime is currently proven
       inside `CartProofDO`, not at the top-level Worker boundary.
     - Recorded the blocker: the default Worker needs an explicit commerce
       partition selection boundary before it can create module-backed HTTP
       runtime options.
     - Added `GET /medusa-http-runtime/status` to expose the current default
       runtime mode and exact production-runtime blocker as JSON.
     - Validation passed: focused Worker runtime status test,
       `medusa-cloudflare` typecheck, Worker import guard, runtime source
       import guard, portable entrypoint guard, real module import audit, Cart
       DO SQLite workerd proof, `@medusajs/medusa` build, and
       `git diff --check`.
507. Next Query runtime step: introduce a non-default top-level Worker route
     that explicitly selects a commerce partition and delegates Medusa HTTP
     handling to the proven module-backed runtime inside that partition.
508. Add the non-default production HTTP partition route. Completed in this
     slice:
     - Added `GET /medusa-http-runtime/partitions/:partition/*` at the
       top-level Worker boundary.
     - The route resolves tenant runtime context, derives the existing cart
       Durable Object partition name, rewrites the request to the DO `http/*`
       path, and forwards the original request.
     - Added a generic `http/*` branch in `CartProofDO` that delegates to the
       existing production Fetch HTTP handler built from the DO-backed commerce
       module runtime source.
     - The default Worker HTTP handler still uses proof runtime options; this
       is an intentional non-default production route.
     - Validation passed: `medusa-cloudflare` typecheck, Worker Vitest suite
       with HTTP runtime status and partition route coverage, and Cart DO
       SQLite workerd proof verifying `store/currencies` through the top-level
       partition route.
509. Next Query/runtime step: keep the default Worker handler unchanged until
     the remaining blockers are removed. Prefer extracting reusable
     partition-selection composition or adding one more real route through the
     same non-default partition path only if it exposes a new missing runtime
     boundary.
510. Complete the portable Query runtime roadmap audit. Completed in this
     slice:
     - Confirmed `static-app.ts` now only wraps static module joiner configs
       and loaded services before registering the shared portable Query runtime
       outputs.
     - Confirmed `REMOTE_QUERY` and `QUERY` registration is supplied by
       `createPortableQueryRuntimeFromJoinerConfigs(...)`.
     - Revalidated Node Query/Remote Query tests, modules-sdk build, Medusa
       build, Worker import guards, and the Cart DO workerd proof.
     - The portable Query runtime goal is now closed. Remaining default Worker
       proof-option usage belongs to the HTTP/runtime bootstrap track, not this
       Query roadmap.
511. Next runtime step: continue the HTTP/runtime bootstrap blocker by
     extracting or hardening the production partition-selection composition
     needed before the default Worker handler can stop using proof HTTP
     options.
512. Extract the production HTTP partition routing helper. Completed in this
     slice:
     - Added `cloudflare-http-partition-routing.ts` as the app-root helper for
       parsing the non-default production HTTP partition route, resolving
       tenant runtime context, deriving the partition address, forwarding to
       the selected Durable Object, and annotating responses with
       `x-medusa-partition-name`.
     - Updated `worker.ts` so the non-default production HTTP route supplies
       only the Cart DO binding, partition family, binding error message, and
       route rewrite function.
     - Preserved validation order: malformed partition routes return `400`
       before missing bindings return `503`.
     - Validation passed: `medusa-cloudflare` typecheck, Worker Vitest route
       coverage, Worker import guards, Cart DO SQLite workerd proof, and
       `@medusajs/medusa` build.
513. Next runtime step: decide whether a bounded default-handler route group
     can use production partition selection without proof HTTP options, or
     identify the next missing production runtime binding that blocks that
     switch.
514. Add a bounded default-route production partition opt-in. Completed in
     this slice:
     - Added `x-medusa-partition-key` as an explicit opt-in header for
       production partition handling on bounded default route candidates.
     - Started with `/store/currencies`, which was already proven through the
       production Cart DO HTTP runtime.
     - When the header is present, the Worker forwards `/store/currencies` to
       the selected Cart DO production HTTP runtime before the proof handler.
     - When the header is absent, `/store/currencies` keeps using the existing
       proof HTTP handler.
     - Validation passed: `medusa-cloudflare` typecheck, Worker Vitest route
       coverage, Worker import guards, Cart DO SQLite workerd proof, and
       `@medusajs/medusa` build.
515. Next runtime step: either extend the bounded default production route
     group to another already-proven route or identify the next binding that
     prevents removing proof HTTP options entirely.
516. Extend the bounded default production route group to Store Product Types.
     Completed in this slice:
     - Add `/store/product-types` as a bounded default-route candidate for
       `x-medusa-partition-key` partition selection.
     - Keep the route behavior owned by the unchanged Medusa package route and
       the existing Cart DO production HTTP runtime.
     - Validate with Worker route tests plus the Cart DO SQLite workerd smoke
       proof, proving the default URL can execute real product type route data
       from the selected DO-backed production HTTP runtime.
     - The global default Worker handler still uses proof HTTP options for
       routes without the explicit partition header.
517. Next runtime step: continue widening only where there is already a
     proven production route/runtime boundary, or identify the next missing
     production binding that blocks replacing proof HTTP options for the
     default Worker handler.
518. Extend the bounded default production route group to Store Collections.
     Completed in this slice:
     - Add `/store/collections` and `/store/collections/:id` as bounded
       default-route candidates for `x-medusa-partition-key` partition
       selection.
     - Keep route behavior owned by the unchanged Medusa package routes and
       the existing Cart DO production HTTP runtime.
     - Validate `/store/collections/:id` with related product fields through
       the Cart DO SQLite workerd smoke proof because that path is already
       proven inside the production runtime source.
     - The global default Worker handler still uses proof HTTP options for
       routes without the explicit partition header.
519. Next runtime step: either add one more already-proven route family, such
     as Product Tags, through the same bounded partition opt-in, or stop
     widening read routes and identify the production binding that blocks
     removing proof HTTP options globally.
520. Extend the bounded default production route group to Store Product Tags.
     Completed in this slice:
     - Add `/store/product-tags` and `/store/product-tags/:id` as bounded
       default-route candidates for `x-medusa-partition-key` partition
       selection.
     - Seed Product Tag data through the real Product module service in the
       Cart DO production scenario.
     - Keep route behavior owned by unchanged Medusa package routes and the
       existing Cart DO production HTTP runtime.
     - Validate the route through the Cart DO SQLite workerd smoke proof before
       committing.
     - The global default Worker handler still uses proof HTTP options for
       routes without the explicit partition header.
521. Next runtime step: stop adding more bounded read routes unless they expose
     a missing production runtime boundary. Revisit the default Worker runtime
     blocker and identify which production binding must move out of proof HTTP
     options next.
522. Extract the bounded production route policy and audit runtime status.
     Completed in this slice:
     - Move bounded Store read route matching out of `worker.ts` into an
       app-root production route policy.
     - Keep the policy limited to partition selection and DO request rewriting;
       do not move Medusa route behavior or commerce logic into the app.
     - Update `/medusa-http-runtime/status` so already-proven Cart DO
       production bindings are not listed as missing default Worker blockers.
     - Record the remaining blocker as automatic/default partition selection
       for requests without `x-medusa-partition-key`.
     - Validation passed: `medusa-cloudflare` typecheck, focused Worker tests,
       Worker import guards, Cart DO SQLite workerd proof, Medusa build, and
       `git diff --check`.
523. Next runtime step: do not widen bounded read routes by default. Choose
     either a non-header partition-selection policy for one route group or a
     protected/Admin route that exposes any still-missing production auth or
     session binding at the default Worker boundary.

Architecture warning:

- `CurrencyProofDO` and the expected Cart DO slice are disposable persistence
  proofs, not the final platform tenancy or partition topology.
- Continue refactoring the existing Medusa services and Drizzle persistence
  boundary now. Do not introduce tenant routing, deployment registries, or a
  generic `MedusaPartitionDO` during this milestone.
- Do not encode module-per-DO, record-per-DO, or Cart-per-DO assumptions into
  shared Medusa or Drizzle contracts.
- The future hosted platform will resolve tenant, deployment, environment, and
  a useful business transaction partition at the Worker/platform boundary.
  Multiple Medusa modules may execute inside one partition.
- The later generic partition runtime should reuse the atomic persistence
  manager proven by this milestone; it should not require another rewrite of
  module services or repositories.

Do not solve events, workflows, or HTTP during this slice. Do not add a
Cloudflare-specific bootstrap, replacement Currency service, or duplicate
assertions.

The first vertical slice is complete only when:

> The unchanged Currency module service and unchanged Currency integration
> assertions pass with both MikroORM/Postgres and Drizzle/SQLite, and the
> Drizzle path runs inside workerd without Node or MikroORM imports.
