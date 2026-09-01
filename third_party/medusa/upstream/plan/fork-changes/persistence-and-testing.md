# Persistence And Testing Changes

## Currency Discovery Fix

Commit:

- `50466367e5 fix: preserve currency module discovery`

The experimental portable Currency model originally lived under
`packages/modules/currency/src/models`. Medusa filesystem discovery loaded it
as an additional MikroORM entity named `Currency`, causing duplicate entity
metadata.

The portable model moved to:

```text
packages/modules/currency/src/portable/currency.ts
```

Cloudflare aliases and package exports were updated accordingly. The existing
Currency integration suite then passed unchanged.

## Adapter-Driven Module Test Runner

Commit:

- `d1a4bbe9a7 refactor: make module test persistence adapter-driven`

`@medusajs/test-utils` now exposes `ModuleTestPersistenceAdapter`.

The module integration test runner delegates these responsibilities to the
selected adapter:

- Database configuration creation.
- Model discovery and persistence-specific model preparation.
- Connection creation and cleanup.
- Shared persistence dependency injection.
- Module database options.
- Test database setup and reset.

`mikroOrmModuleTestPersistenceAdapter` remains the default, preserving original
Medusa behavior. Existing test suites can still access `MikroOrmWrapper`, while
new backend-neutral tests should use `database`.

This is the first real in-place persistence refactor boundary. A future Drizzle
test adapter must plug into this runner and execute the existing Currency
assertions.

## Adapter-Driven Runtime Repository Registration

Commit:

- `b390531939 refactor: make module repositories adapter-driven`

The real standard module container loader no longer directly constructs
`MikroOrmBaseRepository` or calls `mikroOrmBaseRepositoryFactory`.

The fork adds a portable `ModulePersistenceAdapter` contract to
`@medusajs/types`. The contract creates:

- The shared base repository constructor.
- A default repository constructor for each discovered module model.

`mikroOrmModulePersistenceAdapter` remains the default implementation in
`@medusajs/utils`. A module can select another adapter through module
initialization options without replacing the standard repository registration
flow.

The standard loader still preserves:

- Explicit custom repositories.
- Repositories shipped by the module.
- Generated default repositories.
- Existing generated internal services.
- Existing dependency-injection registration names.

The adapter contract lives in `@medusajs/types`, not `@medusajs/utils`, so a
future Drizzle implementation does not need to depend on the MikroORM-heavy
utils runtime merely to implement the contract.

Validation:

- `@medusajs/types` build passed.
- `@medusajs/utils` build passed.
- `@medusajs/modules-sdk` build passed.
- `@medusajs/framework` build passed.
- Currency build passed.
- Focused selected-adapter loader test: 1 passing.
- Existing Currency integration suite: 13 passing unchanged.

## Adapter-Driven MedusaService Mutation Subscribers

Commit:

- `539bd8b9c1 refactor: add precise currency runtime entrypoints`

The shared `MedusaService` implementation no longer statically imports the
MikroORM event-subscriber factory.

The selected `ModulePersistenceAdapter` can now provide
`createEventSubscriber`. The module container loader registers the selected
adapter, and the existing `MedusaService` uses it when attaching mutation
subscribers to generated internal services.

The lightweight internal-service marker and predicate moved out of the
MikroORM-coupled `MedusaInternalService` implementation. Their existing public
exports remain available for compatibility.

The MikroORM adapter preserves the original subscriber behavior. No parallel
Currency or module service was introduced.

Validation:

- Affected core and Currency builds passed.
- Focused utils and modules-sdk tests: 35 passing.
- Existing Currency integration suite: 13 passing unchanged.

The broader utils test command also encountered an unrelated existing Windows
path-separator failure in `get-resolved-plugins.spec.ts`. The focused loader
test and affected builds pass.

## Adapter-Driven Module Discovery And Connection Loading

Commit:

- `7d32b9c646 refactor: make module discovery persistence adapter-driven`

Automatic module resource discovery no longer converts every discovered DML
model to a MikroORM entity directly. The selected `ModulePersistenceAdapter`
now owns:

- Preparing discovered models for its persistence backend.
- Creating the automatic connection loader.
- Creating the shared base repository constructor.
- Creating generated model repository constructors.

`mikroOrmModulePersistenceAdapter` remains the default and preserves the
original DML-to-MikroORM conversion and MikroORM connection loader.

The selected adapter is read from module options during discovery and captured
by the generated container loader. This keeps connection loading, prepared
models, and repository registration on the same selected backend.

The adapter deliberately does not create or replace `MedusaInternalService`.
Generated services continue to use the existing shared Medusa implementation,
preventing a Drizzle adapter from becoming a parallel service hierarchy.

Validation:

- `@medusajs/types` build passed.
- `@medusajs/utils` build passed.
- `@medusajs/modules-sdk` build passed.
- `@medusajs/framework` build passed.
- Currency build passed.
- Focused container-loader adapter test: 1 passing.
- Focused module discovery tests: 10 passing.
- Existing Currency integration suite: 13 passing unchanged.

## Shared Test Requirement

The existing Currency integration assertions must run unchanged against both
MikroORM and Drizzle. Do not duplicate or replace those assertions with a
parallel portable-service suite.

Adapter-specific tests are still required for behavior outside the shared
module contract, including:

- Drizzle query translation.
- D1 transaction limitations.
- Relationship loading.
- Soft deletion.
- Migration generation.
- workerd compatibility.

## PGlite Fast-Lane Preparation

Commit:

- This commit (`test: stabilize integration-test compatibility fixes`)

The fork is preparing a PGlite-backed fast integration-test lane, but PGlite is
not treated as a full replacement for the authoritative PostgreSQL gate.

Before adding PGlite, the repo removed the failed external temporary-PostgreSQL
runner approach and kept only small compatibility fixes that are independent of
PGlite:

- Utils PostgreSQL and DML integration helpers now propagate `DB_PORT` into
  connection strings, `pg-god`, and MikroORM configs instead of silently using
  port `5432`.
- API-key random token generation prefers Node crypto when Node `require` is
  available, preserving existing Node test mocks while still falling back to Web
  Crypto in Worker-like runtimes.
- Pricing integration expectations include the exported `PriceRule` model in
  linkable configuration.

Affected boundary:

- Integration-test database environment handling.
- API-key crypto source selection in Node versus Worker-like runtimes.
- Pricing module linkable test expectations.

Validation:

- `pnpm --filter @medusajs/utils build`
- `pnpm --filter @medusajs/framework build`
- `pnpm --filter @medusajs/api-key build`
- `pnpm --filter @medusajs/pricing build`
- `pnpm --filter @medusajs/api-key test`
- `pnpm --filter @medusajs/pricing test`
- `pnpm --filter @medusajs/utils test`

The DB-port fixes were not fully integration-tested in this slice because no
new external PostgreSQL process should be spawned on this Windows machine. They
must be covered by the next safe database lane.

## PGlite Adapter Selection Boundary

Commit:

- This commit (`test: add PGlite persistence selection boundary`)

The module integration runner now treats `pglite` as an explicit reserved value
for `MEDUSA_MODULE_TEST_PERSISTENCE`.

Differences from original Medusa:

- `@medusajs/test-utils` declares `@electric-sql/pglite@0.5.4` as a test
  infrastructure development dependency.
- `MEDUSA_MODULE_TEST_PERSISTENCE=mikroorm` explicitly selects the existing
  MikroORM/Postgres adapter.
- `MEDUSA_MODULE_TEST_PERSISTENCE=pglite` fails loudly until the PGlite adapter
  is implemented, instead of silently falling back to MikroORM/Postgres.
- Unknown persistence values now fail loudly.

The default remains unchanged: without `MEDUSA_MODULE_TEST_PERSISTENCE`, module
integration tests use MikroORM/Postgres.

`@electric-sql/pglite-socket` is intentionally not added in this slice. Its
current package metadata declares several extension peer dependencies. The
adapter implementation must first prove whether a socket bridge is required or
whether direct PGlite APIs can satisfy the first fast-lane proof.

Validation:

- `pnpm install --lockfile-only --frozen-lockfile --offline --trust-lockfile --ignore-scripts`
- `pnpm --filter @medusajs/test-utils exec jest src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`
- `pnpm --filter @medusajs/test-utils build`

## PGlite Adapter Skeleton

Commit:

- This commit (`test: add PGlite adapter lifecycle skeleton`)

The module integration runner can now select a real PGlite adapter with
`MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- `@medusajs/test-utils` exposes `pgliteModuleTestPersistenceAdapter`.
- The adapter starts an in-process `memory://` PGlite database and never spawns
  `postgres.exe`, `cmd.exe`, or a detached database process.
- Adapter lifecycle currently covers connection creation, schema create/drop,
  and cleanup.
- Module model schema preparation is intentionally not implemented yet and
  fails loudly.
- PGlite lifecycle tests are opt-in with `MEDUSA_PGLITE_TESTS=1` because
  PGlite requires `NODE_OPTIONS=--experimental-vm-modules` under Jest.

The default module integration runner behavior remains unchanged:
MikroORM/Postgres is still selected unless `MEDUSA_MODULE_TEST_PERSISTENCE` is
set.

Validation:

- `pnpm install --prefer-offline --trust-lockfile --ignore-scripts --fetch-timeout 900000`
- `pnpm --filter @medusajs/test-utils exec node -e "const { PGlite } = require('@electric-sql/pglite'); console.log(typeof PGlite)"`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts --runInBand --forceExit`
- `pnpm --filter @medusajs/test-utils exec jest src/__tests__/module-test-persistence-selection.spec.ts src/__tests__/pglite-module-test-persistence-adapter.spec.ts --runInBand --forceExit`
- `pnpm --filter @medusajs/test-utils build`
- `pnpm install --lockfile-only --frozen-lockfile --offline --trust-lockfile --ignore-scripts`

## PGlite DML Schema Preparation

Commit:

- This commit (`test: add PGlite DML schema preparation`)

The PGlite module-test adapter now renders a first small subset of DML portable
entity metadata into PostgreSQL-compatible DDL for in-process PGlite tests.

Differences from original Medusa:

- `pgliteModuleTestPersistenceAdapter.prepareDatabase` accepts DML portable
  entities and creates schema-qualified PGlite tables before test execution.
- The first supported DML surface covers scalar columns, primary keys, nullable
  flags, scalar defaults, field indexes, and entity indexes.
- Schema reset drops and recreates the selected schema inside the same PGlite
  database instead of spawning or resetting an external PostgreSQL service.
- Non-DML models and DML relationships still fail loudly. They are not silently
  converted or partially ignored.

The default module integration runner behavior remains unchanged:
MikroORM/Postgres is still selected unless `MEDUSA_MODULE_TEST_PERSISTENCE` is
set. This is not yet a Currency-module fast lane; it is only the adapter-level
proof that DML metadata can create real PGlite tables.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- Opt-in PGlite adapter lifecycle tests.

Validation:

- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts --runInBand --forceExit`
- `pnpm --filter @medusajs/test-utils exec jest src/__tests__/module-test-persistence-selection.spec.ts src/__tests__/pglite-module-test-persistence-adapter.spec.ts --runInBand --forceExit`
- `pnpm --filter @medusajs/test-utils build`
- `pnpm install --lockfile-only --frozen-lockfile --offline --trust-lockfile --ignore-scripts`

## Currency PGlite Fast Lane

Commit:

- This commit (`test: run Currency module through PGlite`)

The unchanged Currency integration suite can now run through the module-test
runner with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- `pgliteModuleTestPersistenceAdapter` discovers module DML models from the
  package `dist/models` or `models` folder, matching the existing module-test
  runner discovery behavior.
- The PGlite test adapter now passes a PGlite manager and
  `pgliteModulePersistenceAdapter` through module options, so Medusa's standard
  module loader registers repositories without falling back to MikroORM.
- The PGlite manager keeps the heavy PGlite client and discovered model list
  non-enumerable so Medusa module hashing and error formatting do not walk into
  PGlite runtime internals.
- `pgliteModulePersistenceAdapter` implements a scalar DML repository surface
  for the first fast-lane proof: `upsert`, `find`, and `findAndCount`.
- The scalar repository supports the Currency suite's required behavior:
  primary-key conflict upsert, default timestamps, BigNumber raw-field pairing,
  simple filters, `$and`/`$or`, `IN`, comparison operators, ordering, selected
  fields, pagination, count, and default `deleted_at IS NULL` filtering.

The default module integration runner behavior remains unchanged:
MikroORM/Postgres is still selected unless `MEDUSA_MODULE_TEST_PERSISTENCE` is
set. PGlite is still a fast-lane test backend, not the authoritative database
gate.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- PGlite runtime persistence adapter used only by the module-test runner.
- Unchanged Currency integration assertions under the PGlite fast lane.

Validation:

- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/currency test:integration --runInBand --testPathPattern="integration-tests/__tests__/currency-module-service.spec.ts"`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts --runInBand --forceExit`
- `pnpm --filter @medusajs/test-utils exec jest src/__tests__/module-test-persistence-selection.spec.ts src/__tests__/pglite-module-test-persistence-adapter.spec.ts --runInBand --forceExit`
- `pnpm --filter @medusajs/test-utils build`
- `pnpm --filter @medusajs/currency build`

Limitations at this point in the sequence:

- PGlite repository `create`, `update`, `delete`, `softDelete`, `restore`, and
  `upsertWithReplace` are explicit unsupported operations.
- DML relationships remain unsupported in the PGlite schema renderer and
  repository.
- PGlite does not replace the MikroORM/Postgres authoritative gate.

## API Key PGlite Scalar Mutations

Commit:

- This commit (`test: add API Key PGlite scalar mutations`)

The unchanged API Key integration suite can now run through the module-test
runner with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- `pgliteModulePersistenceAdapter` now supports scalar DML `create`, `update`,
  and hard `delete` operations for module-test repositories.
- `create` fills DML id fields with ULIDs, preserving configured id prefixes,
  and only applies automatic `dateTime` defaults to non-nullable timestamp
  columns.
- `update` applies scalar column updates and preserves the existing Medusa
  internal-service rule that primary keys are selected from the matched entity.
- `delete` accepts the existing Medusa repository selector shape, deletes
  matching scalar rows, and returns deleted primary keys for the internal
  service event path.
- `$eq: null` and `$ne: null` filters render as `IS NULL` and `IS NOT NULL`.
  This is required for API Key revoke/authentication semantics.

The default module integration runner behavior remains unchanged:
MikroORM/Postgres is still selected unless `MEDUSA_MODULE_TEST_PERSISTENCE` is
set. PGlite is still a fast-lane test backend, not the authoritative database
gate.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- PGlite runtime persistence adapter used only by the module-test runner.
- Unchanged API Key integration assertions under the PGlite fast lane.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/api-key test:integration --runInBand --testPathPattern="integration-tests/__tests__/api-key-module-service.spec.ts"`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts --runInBand --forceExit`
- `pnpm --filter @medusajs/test-utils exec jest src/__tests__/module-test-persistence-selection.spec.ts src/__tests__/pglite-module-test-persistence-adapter.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/currency test:integration --runInBand --testPathPattern="integration-tests/__tests__/currency-module-service.spec.ts"`
- `pnpm --filter @medusajs/api-key build`

Limitations at this point in the sequence:

- PGlite repository `softDelete`, `restore`, and `upsertWithReplace` are still
  explicit unsupported operations.
- DML relationships remain unsupported in the PGlite schema renderer and
  repository.
- PGlite does not replace the MikroORM/Postgres authoritative gate.

## Translation PGlite Soft Delete And Restore

Commit:

- This commit (`test: add Translation PGlite soft delete restore`)

The unchanged Translation integration suite can now run through the module-test
runner with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- `pgliteModulePersistenceAdapter` now supports scalar repository
  `softDelete` and `restore` for module-test repositories with a `deleted_at`
  column.
- Repository filters accepted by scalar mutation paths now match the Medusa
  internal-service shapes used by the suite: string id, string id array,
  selector object, and selector object array.
- `softDelete` updates `deleted_at`, preserves the normal list/retrieve rule
  that excludes deleted rows, and returns the updated scalar rows with an empty
  cascade map.
- `restore` clears `deleted_at` while explicitly matching with deleted rows,
  then returns the restored scalar rows with an empty cascade map.

The PGlite fast lane still does not implement relationship cascades. This slice
only proves scalar soft-delete/restore behavior for Translation locales and
translations.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- PGlite runtime persistence adapter used only by the module-test runner.
- Unchanged Translation integration assertions under the PGlite fast lane.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/translation test:integration --runInBand --testPathPattern="integration-tests/__tests__/translation-module-service.spec.ts"`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts --runInBand --forceExit`
- `pnpm --filter @medusajs/test-utils exec jest src/__tests__/module-test-persistence-selection.spec.ts src/__tests__/pglite-module-test-persistence-adapter.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/api-key test:integration --runInBand --testPathPattern="integration-tests/__tests__/api-key-module-service.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/currency test:integration --runInBand --testPathPattern="integration-tests/__tests__/currency-module-service.spec.ts"`
- `pnpm --filter @medusajs/translation build`

Limitations at this point in the sequence:

- PGlite repository `upsertWithReplace` is still an explicit unsupported
  operation.
- DML relationships and relationship cascades remain unsupported in the PGlite
  schema renderer and repository.
- PGlite does not replace the MikroORM/Postgres authoritative gate.

## Settings PGlite Scalar Upsert With Replace

Commit:

- This commit (`test: add Settings PGlite upsert replace`)

The unchanged Settings integration suite can now run through the module-test
runner with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- `pgliteModulePersistenceAdapter` now supports scalar repository
  `upsertWithReplace` when `relations` is empty.
- The PGlite implementation detects existing rows by primary key, performs
  scalar updates for existing rows, creates rows for new data, and returns the
  Medusa `performedActions` shape used by the internal-service event dispatch
  path.
- JSON fields are replaced through the scalar update path instead of merged.
  This is required by Settings view-configuration updates where empty filter
  objects and null sorting values must overwrite previous JSON content.
- Relation replacement remains explicit unsupported behavior in this adapter.
  Calls with non-empty `relations` still fail loudly.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- PGlite runtime persistence adapter used only by the module-test runner.
- Unchanged Settings integration assertions under the PGlite fast lane.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/settings test:integration --runInBand --testPathPattern="integration-tests/__tests__/settings-module.spec.ts"`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts --runInBand --forceExit`
- `pnpm --filter @medusajs/test-utils exec jest src/__tests__/module-test-persistence-selection.spec.ts src/__tests__/pglite-module-test-persistence-adapter.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/api-key test:integration --runInBand --testPathPattern="integration-tests/__tests__/api-key-module-service.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/translation test:integration --runInBand --testPathPattern="integration-tests/__tests__/translation-module-service.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/currency test:integration --runInBand --testPathPattern="integration-tests/__tests__/currency-module-service.spec.ts"`
- `pnpm --filter @medusajs/settings build`

Limitations at this point in the sequence:

- PGlite `upsertWithReplace` supports only scalar rows with empty
  `relations`.
- DML relationships and relationship cascades remain unsupported in the PGlite
  schema renderer and repository.
- PGlite does not replace the MikroORM/Postgres authoritative gate.

## Store PGlite HasMany Replacement

Commit:

- This commit (`test: add Store PGlite hasMany replacement`)

The unchanged Store integration suite can now run through the module-test
runner with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- The PGlite DML schema renderer now accepts a narrow relationship subset used
  by Store:
  - inverse `hasMany` fields are recorded as relationship metadata and do not
    create scalar columns on the parent table;
  - owning `belongsTo` fields create a nullable text foreign-key column using
    the existing DML naming convention, for example `store_id`.
- PGlite `upsertWithReplace` now supports configured `hasMany` relation
  payloads for single-primary-key parent rows. Existing child rows for that
  parent foreign key are hard-deleted, incoming child objects are inserted with
  the parent key, and the returned parent entity receives the replaced relation
  arrays.
- The implementation returns `performedActions` for created and deleted child
  rows so the existing Medusa internal-service event dispatch path keeps the
  expected shape.

This is still a fast-lane module-test implementation, not a full relational
database abstraction. It does not add database-enforced foreign keys or general
relationship query hydration.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- PGlite runtime persistence adapter used only by the module-test runner.
- Unchanged Store integration assertions under the PGlite fast lane.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/store test:integration --runInBand --testPathPattern="integration-tests/__tests__/store-module-service.spec.ts"`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts --runInBand --forceExit`
- `pnpm --filter @medusajs/test-utils exec jest src/__tests__/module-test-persistence-selection.spec.ts src/__tests__/pglite-module-test-persistence-adapter.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/settings test:integration --runInBand --testPathPattern="integration-tests/__tests__/settings-module.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/api-key test:integration --runInBand --testPathPattern="integration-tests/__tests__/api-key-module-service.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/translation test:integration --runInBand --testPathPattern="integration-tests/__tests__/translation-module-service.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/currency test:integration --runInBand --testPathPattern="integration-tests/__tests__/currency-module-service.spec.ts"`
- `pnpm --filter @medusajs/store build`

Current limitations:

- PGlite relationship support is limited to `belongsTo` storage columns,
  `hasMany` replacement payloads, and the read-side relationship subset added
  by later Auth coverage.
- PGlite does not support many-to-many relationships, has-one relationships,
  database-level foreign-key enforcement, or recursive cascade semantics.
- PGlite does not replace the MikroORM/Postgres authoritative gate.

## Auth PGlite Relationship Reads

Commit:

- This commit (`test: add Auth PGlite relationship reads`)

The unchanged Auth identity integration spec can now run through the
module-test runner with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- The PGlite repository now handles present `hasMany` relation payloads during
  ordinary `create` and scalar `upsert`, not only during `upsertWithReplace`.
  This is required by Auth identity creation, where provider identities are
  nested under the auth identity payload.
- PGlite `find` now hydrates requested `hasMany` relations from Medusa's
  built query shape, where service-level `relations` become DAL
  `options.populate`.
- PGlite filters now support the tested `hasMany` relation subset by rendering
  an `EXISTS` subquery against the child table. Auth uses this for filters such
  as `provider_identities.provider`.
- JSON object filters on `jsonb` columns now use containment semantics for the
  tested metadata case instead of treating object keys as comparison
  operators.

This is still a fast-lane module-test implementation, not a full relational
ORM. The implementation intentionally covers the Auth identity relationship
shape before expanding to more relationship kinds.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- PGlite runtime persistence adapter used only by the module-test runner.
- Unchanged Auth identity integration assertions under the PGlite fast lane.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- `pnpm --filter @medusajs/auth build`
- `pnpm --filter @medusajs/test-utils test --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/auth exec jest integration-tests/__tests__/auth-module-service/auth-identity.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/store test:integration --runInBand --testPathPattern="integration-tests/__tests__/store-module-service.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/settings test:integration --runInBand --testPathPattern="integration-tests/__tests__/settings-module.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/api-key test:integration --runInBand --testPathPattern="integration-tests/__tests__/api-key-module-service.spec.ts"`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`

Current limitations:

- PGlite relationship reads support the tested single-primary-key `hasMany`
  subset only, including child-owned `belongsTo` relationships that identify
  the parent field through `mappedBy`.
- Child relation replacement hard-deletes rows for the parent key and does not
  implement database-enforced foreign keys.
- PGlite does not support many-to-many relationships, has-one relationships,
  recursive relation hydration, recursive cascade semantics, or broad SQL
  operator coverage.
- PGlite does not replace the MikroORM/Postgres authoritative gate.

## Region PGlite Country Assignment

Commit:

- This commit (`test: add Region PGlite country assignment`)

The unchanged Region integration suite can now run through the module-test
runner with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- The PGlite relationship compiler now infers a parent `hasMany` foreign key
  from the target model's owning `belongsTo` field when the parent side does
  not declare `mappedBy`. Region uses this shape: `Region.countries` maps to
  `Country.region`, so the child storage column is `region_id`, not
  `countries_id`.
- PGlite SELECT and COUNT queries now honor Medusa's
  `softDeletable.withDeleted` DAL filter. Normal reads still exclude
  `deleted_at` rows, while `config.withDeleted` can retrieve soft-deleted
  Region rows.

This preserves Region's existing module service behavior. Country existence,
country uniqueness, country reassignment, soft-delete cleanup, and relation
hydration remain asserted by the original Region test file.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- PGlite runtime persistence adapter used only by the module-test runner.
- Unchanged Region integration assertions under the PGlite fast lane.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- `pnpm --filter @medusajs/region build`
- `pnpm --filter @medusajs/test-utils test --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/region test:integration --runInBand --testPathPattern="integration-tests/__tests__/region-module.spec.ts"`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/auth exec jest integration-tests/__tests__/auth-module-service/auth-identity.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/store test:integration --runInBand --testPathPattern="integration-tests/__tests__/store-module-service.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/translation test:integration --runInBand --testPathPattern="integration-tests/__tests__/translation-module-service.spec.ts"`

Current limitations:

- PGlite relationship support remains limited to the tested `belongsTo` and
  `hasMany` subset. It does not implement database-enforced foreign keys or
  recursive relation traversal.
- Region country assignment is validated through Medusa service logic and
  repository updates, not through PGlite foreign-key constraints.
- PGlite does not support many-to-many relationships, has-one relationships,
  recursive cascade semantics, or broad SQL operator coverage.
- PGlite does not replace the MikroORM/Postgres authoritative gate.

## RBAC PGlite Raw Policy Queries

Commit:

- This commit (`test: add RBAC PGlite raw policy queries`)

The unchanged RBAC integration suite can now run through the module-test
runner with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- The PGlite module-test connection now exposes a narrow `getKnex().raw(...)`
  compatibility surface for package repositories that still call
  `MikroOrmBase.getActiveManager(...).getKnex().raw(...)`.
- The shim only translates positional `?` placeholders into PostgreSQL-style
  `$1`, `$2`, ... placeholders and delegates execution to the existing PGlite
  client. It is intentionally not a full Knex query builder.

This preserves the RBAC service and repository source behavior while allowing
its existing recursive policy queries to run in the in-process PGlite fast
lane.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- PGlite runtime persistence adapter used only by the module-test runner.
- Unchanged RBAC integration assertions under the PGlite fast lane.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- `pnpm --filter @medusajs/rbac build`
- `pnpm --filter @medusajs/test-utils test --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/rbac test:integration --runInBand --testPathPattern="integration-tests/__tests__/rbac.spec.ts"`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/region test:integration --runInBand --testPathPattern="integration-tests/__tests__/region-module.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/auth exec jest integration-tests/__tests__/auth-module-service/auth-identity.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/store test:integration --runInBand --testPathPattern="integration-tests/__tests__/store-module-service.spec.ts"`

Current limitations:

- The PGlite `getKnex()` surface only supports `raw(query, params)` and only
  placeholder translation required by current RBAC queries.
- It does not support fluent Knex query builders, schema builders,
  transactions outside the existing PGlite transaction wrapper, or driver
  methods beyond `raw`.
- PGlite does not replace the MikroORM/Postgres authoritative gate.

## User PGlite Mutation Events

Commit:

- This commit (`test: add User PGlite mutation events`)

The unchanged User module integration suite can now run through the
module-test runner with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- The PGlite persistence adapter now creates, registers, and dispatches Medusa
  module persistence event subscribers for repository create and update paths.
- PGlite repository `create` emits `afterCreate`, and repository `update`
  emits `afterUpdate`, allowing Medusa's existing `@EmitEvents()` service
  boundary to produce User and Invite events.
- PGlite repository `upsert` emits `afterCreate` or `afterUpdate` when it can
  determine primary-key existence before the write.
- `upsertWithReplace` suppresses the inner create/update dispatch and keeps
  using the existing performed-actions dispatch path, so relation replacement
  does not double-emit mutation events.

This preserves User's existing service behavior. Invite token generation,
invite refresh, user updates, and event assertions remain owned by the
unchanged User integration specs.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- PGlite runtime persistence adapter used only by the module-test runner.
- Unchanged User and Invite integration assertions under the PGlite fast lane.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- `pnpm --filter @medusajs/user build`
- `pnpm --filter @medusajs/test-utils test --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/user test:integration --runInBand`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/rbac test:integration --runInBand --testPathPattern="integration-tests/__tests__/rbac.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/store test:integration --runInBand --testPathPattern="integration-tests/__tests__/store-module-service.spec.ts"`

Current limitations:

- PGlite mutation events cover repository create/update and primary-key-known
  upsert paths used by the current module-test lane.
- PGlite does not implement MikroORM's event manager. It implements the Medusa
  module persistence subscriber contract directly for the test adapter.
- PGlite does not replace the MikroORM/Postgres authoritative gate.

## Sales Channel PGlite Scalar Proof

Commit:

- This commit (`test: document Sales Channel PGlite proof`)

The unchanged Sales Channel integration suite can now run through the
module-test runner with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- No Sales Channel service, model, repository, or runtime behavior changed.
- This slice proves the existing PGlite scalar repository surface covers a
  package that imports its DML model through the portable framework path,
  including create, retrieve, update, list, list-and-count, selected fields,
  pagination, boolean filters, and delete.

Affected boundary:

- Unchanged Sales Channel integration assertions under the PGlite fast lane.
- Existing `@medusajs/test-utils` PGlite module-test persistence adapter.

Validation:

- `pnpm --filter @medusajs/sales-channel build`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/sales-channel test:integration --runInBand --testPathPattern="integration-tests/__tests__/services/sales-channel-module.spec.ts"`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`

Current limitations:

- This is a scalar module proof. It does not expand PGlite relationship,
  custom repository, or transaction semantics.
- PGlite does not replace the MikroORM/Postgres authoritative gate.

## Customer PGlite Relationship Proof

Commit:

- This commit (`test: add Customer PGlite relationship proof`)

The unchanged Customer integration suite can now run through the module-test
runner with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- No Customer service, DML model, public API, or integration assertion changed.
- The PGlite module-test adapter now supports the Customer suite's explicit
  many-to-many pivot shape by resolving `pivotEntity` metadata and traversing
  the pivot model's `belongsTo` foreign-key columns for relation hydration and
  relation filters.
- The PGlite adapter now maps PGlite duplicate-key errors into Medusa's existing
  unique-constraint message shape, matching the MikroORM/Postgres module-test
  behavior asserted by Customer.
- PGlite hard deletes now remove incoming `belongsTo` rows in the same in-memory
  test schema, covering Customer address and customer-group pivot cleanup
  without requiring a spawned PostgreSQL process.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- Unchanged Customer integration assertions under the PGlite fast lane.
- Previously enabled PGlite fast-lane module slices that share scalar,
  has-many, raw-query, and mutation-event adapter behavior.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/customer test:integration --runInBand --testPathPattern="integration-tests/__tests__/services/customer-module/index.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/region test:integration --runInBand --testPathPattern="integration-tests/__tests__/region-module.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/user test:integration --runInBand --testPathPattern="integration-tests/__tests__/user.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/auth test:integration --runInBand --testPathPattern="integration-tests/__tests__/auth-module-service/index.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/sales-channel test:integration --runInBand --testPathPattern="integration-tests/__tests__/services/sales-channel-module.spec.ts"`

Current limitations:

- PGlite many-to-many support is limited to the tested explicit `pivotEntity`
  shape with single-column primary keys and pivot `belongsTo` relationships.
- PGlite hard-delete cleanup is a test-adapter cascade approximation over
  module-local DML metadata, not a replacement for production database foreign
  keys or the MikroORM/Postgres authoritative gate.
- PGlite remains a fast integration-test lane. Redis-backed suites and the
  full Postgres gate are still separate validation lanes.

## Analytics PGlite Provider Proof

Commit:

- This commit (`test: add Analytics PGlite provider proof`)

The unchanged Analytics integration suite can now run through the module-test
runner with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- No Analytics service, provider contract, module options, runtime behavior, or
  integration assertion changed.
- This slice proves the PGlite module-test runner can execute provider-only
  modules that do not need module-local DML tables.
- The Analytics test still loads the existing fixture provider through the
  normal module options path and asserts `track` and `identify` calls through
  the real module service.

Affected boundary:

- Unchanged Analytics integration assertions under the PGlite fast lane.
- Existing `@medusajs/test-utils` PGlite module-test persistence adapter and
  module-test runner selection path.

Validation:

- `pnpm --filter @medusajs/analytics build`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/analytics test:integration --runInBand --testPathPattern="integration-tests/__tests__/module.spec.ts"`

Current limitations:

- This is a provider/no-model module proof. It does not expand PGlite scalar,
  relationship, custom repository, or transaction semantics.
- PGlite remains a fast integration-test lane. Redis-backed suites and the
  full Postgres gate are still separate validation lanes.

## File PGlite Provider Proof

Commit:

- This commit (`test: add File PGlite provider proof`)

The unchanged File integration suite can now run through the module-test runner
with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- No File service, provider contract, module options, runtime behavior, or
  integration assertion changed.
- This slice proves the PGlite module-test runner can execute File's
  provider-backed module service without module-local DML tables.
- The File test still loads the existing fixture provider through the normal
  module options path and asserts upload, retrieval, presigned upload URL, and
  validation behavior through the real module service.

Affected boundary:

- Unchanged File integration assertions under the PGlite fast lane.
- Existing `@medusajs/test-utils` PGlite module-test persistence adapter and
  module-test runner selection path.

Validation:

- `pnpm --filter @medusajs/file build`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/file test:integration --runInBand --testPathPattern="integration-tests/__tests__/module.spec.ts"`

Current limitations:

- This is a provider/no-model module proof. It does not expand PGlite scalar,
  relationship, custom repository, or transaction semantics.
- PGlite remains a fast integration-test lane. Redis-backed suites and the
  full Postgres gate are still separate validation lanes.

## Stock Location PGlite BelongsTo Replacement

Commit:

- This commit (`test: add Stock Location PGlite belongsTo proof`)

The unchanged Stock Location integration suite can now run through the
module-test runner with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- No Stock Location service, DML model, public API, or integration assertion
  changed.
- The PGlite module-test adapter now supports the tested single-object
  `belongsTo` payload replacement shape. When a source row receives a relation
  object, the adapter creates or reuses the target row, writes the source
  foreign-key column, and returns the hydrated relation object.
- PGlite relation hydration now covers requested `belongsTo` relations for
  single-primary-key DML models.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- Unchanged Stock Location integration assertions under the PGlite fast lane.
- Previously enabled PGlite relationship slices that share has-many and
  many-to-many replacement/hydration behavior.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`
- `pnpm --filter @medusajs/stock-location build`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/stock-location test:integration --runInBand --testPathPattern="integration-tests/__tests__/stock-location-module-service.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/customer test:integration --runInBand --testPathPattern="integration-tests/__tests__/services/customer-module/index.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/store test:integration --runInBand --testPathPattern="integration-tests/__tests__/store-module-service.spec.ts"`

Current limitations:

- PGlite `belongsTo` replacement is limited to the tested single-object,
  single-primary-key shape. It does not implement full MikroORM identity-map,
  orphan-removal, or database foreign-key semantics.
- PGlite remains a fast integration-test lane. Redis-backed suites and the
  full Postgres gate are still separate validation lanes.

## Inventory PGlite Custom Repository Proof

Commit:

- This commit (`test: add Inventory PGlite custom repository proof`)

The unchanged Inventory integration suite can now run through the module-test
runner with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- No Inventory service, DML model, public API, or integration assertion
  changed.
- The PGlite module-test adapter now replaces Inventory's
  `InventoryLevelRepository` with a PGlite-backed custom repository for the
  existing aggregate methods: `getReservedQuantity`, `getAvailableQuantity`,
  and `getStockedQuantity`.
- The adapter now hydrates the Inventory computed fields that the unchanged
  service assertions rely on: `InventoryLevel.available_quantity` and explicit
  `InventoryItem.stocked_quantity` / `InventoryItem.reserved_quantity`
  selections.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- Unchanged Inventory integration assertions under the PGlite fast lane.
- Previously enabled PGlite relationship slices that share relation
  replacement and hydration behavior.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`
- `pnpm --filter @medusajs/inventory build`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/inventory test:integration --runInBand --testPathPattern="integration-tests/__tests__/inventory-module-service.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/stock-location test:integration --runInBand --testPathPattern="integration-tests/__tests__/stock-location-module-service.spec.ts"`

Current limitations:

- The PGlite custom repository support is hard-scoped to InventoryLevel's
  aggregate quantity methods. It does not implement a general MikroORM custom
  repository or Knex compatibility layer.
- Inventory computed-field hydration is adapter-local fast-lane support. It
  does not replace the authoritative MikroORM/Postgres behavior.
- PGlite remains a fast integration-test lane. Redis-backed suites and the
  full Postgres gate are still separate validation lanes.

## Tax PGlite Cascade And Float Proof

Commit:

- This commit (`test: add Tax PGlite cascade proof`)

The unchanged Tax integration suite can now run through the module-test runner
with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- No Tax service, DML model, public API, provider, or integration assertion
  changed.
- The PGlite module-test adapter now normalizes DML `float` columns back to
  JavaScript numbers when reading PGlite `numeric` values.
- PGlite relation filters now support `belongsTo` aliases such as
  `{ tax_rate: selector }` by translating them to foreign-key subqueries.
- PGlite soft-delete and restore now apply declared DML `cascades.delete` over
  tested `hasMany` relations, including Tax Region -> Tax Rate -> Tax Rate Rule
  and parent Tax Region -> child Tax Region.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- Unchanged Tax integration assertions under the PGlite fast lane.
- Previously enabled PGlite modules that share relationship filters, hard
  cascades, and Inventory computed-field behavior.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- `pnpm --filter @medusajs/tax build`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/tax test:integration --runInBand`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/inventory test:integration --runInBand --testPathPattern="integration-tests/__tests__/inventory-module-service.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/customer test:integration --runInBand --testPathPattern="integration-tests/__tests__/services/customer-module/index.spec.ts"`

Current limitations:

- PGlite soft-delete cascade support is limited to declared `hasMany`
  `cascades.delete` relationships with single-primary-key models. It does not
  implement full MikroORM unit-of-work, orphan-removal, or database foreign-key
  cascade semantics.
- PGlite `belongsTo` relation filters are translated through simple
  foreign-key subqueries and are not a general ORM query planner.
- PGlite remains a fast integration-test lane. Redis-backed suites and the
  full Postgres gate are still separate validation lanes.

## Payment PGlite Relation Hydration Proof

Commit:

- This commit (`test: add Payment PGlite relation hydration proof`)

The unchanged Payment integration suite can now run through the module-test
runner with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- No Payment service, DML model, provider, public API, or integration assertion
  changed.
- The PGlite module-test adapter now resolves `belongsTo` relation payloads
  into foreign-key columns before insert/upsert. This covers both object and
  primary-key string relation payloads, such as Payment's
  `payment_session: "..."` fixture shape.
- PGlite relation hydration now supports tested inverse `hasOne` relations and
  nested relation paths, including selected field paths such as
  `payments.captures.amount`.
- PGlite create/upsert return rows now initialize empty `hasMany` and
  `manyToMany` relation arrays when no related rows are present, matching the
  returned Medusa module DTO shape expected by the Payment assertions.
- PGlite BigNumber raw-value preparation now keeps compact raw values while
  still storing numeric columns for PGlite queries.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- Unchanged Payment integration assertions under the PGlite fast lane.
- Previously enabled PGlite modules that share relationship replacement,
  nested hydration, BigNumber, and cascade behavior.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- `pnpm --filter @medusajs/payment build`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/payment test:integration --runInBand`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/tax test:integration --runInBand`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/inventory test:integration --runInBand --testPathPattern="integration-tests/__tests__/inventory-module-service.spec.ts"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/customer test:integration --runInBand --testPathPattern="integration-tests/__tests__/services/customer-module/index.spec.ts"`

Current limitations:

- PGlite `hasOne` hydration is limited to inverse relations backed by a target
  foreign-key column and single-primary-key models.
- Nested relation hydration covers the tested module-service read paths. It is
  not a general MikroORM populate planner.
- PGlite BigNumber support remains a test-adapter approximation over numeric
  and raw JSON columns. It does not replace the authoritative
  MikroORM/Postgres behavior.
- PGlite remains a fast integration-test lane. Redis-backed suites and the
  full Postgres gate are still separate validation lanes.

## Notification PGlite Array Proof

Commit:

- This commit (`test: add Notification PGlite array proof`)

The unchanged Notification integration suite can now run through the
module-test runner with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.

Differences from original Medusa:

- No Notification service, DML model, provider, public API, or integration
  assertion changed.
- The PGlite module-test adapter now stores DML `array` fields as JSONB and
  decodes them back to JavaScript arrays when reading rows.
- This covers Notification Provider `channels`, which the existing provider
  selection service expects to be an array.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- Unchanged Notification integration assertions under the PGlite fast lane.
- Previously enabled PGlite modules that share JSON, relation, BigNumber, and
  cascade behavior.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- `pnpm --filter @medusajs/notification build`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/notification test:integration --runInBand`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/payment test:integration --runInBand`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/tax test:integration --runInBand`

Current limitations:

- PGlite array support stores DML arrays as JSONB for the test adapter. It
  does not imply parity with every PostgreSQL native array operator or index
  behavior.
- PGlite remains a fast integration-test lane. Redis-backed suites and the
  full Postgres gate are still separate validation lanes.

## Fulfillment PGlite JSON Scalar And Named FK Groundwork

Commit:

- This commit (`test: add Fulfillment PGlite JSON groundwork`)

The first Fulfillment PGlite run exposed adapter gaps before the unchanged
Fulfillment suite can become a full fast-lane proof.

Differences from original Medusa:

- No Fulfillment service, DML model, provider, public API, or integration
  assertion changed.
- The PGlite module-test adapter now serializes DML `json` and `array` values
  consistently when binding query parameters.
- JSON and array comparison placeholders are explicitly cast to `jsonb`, so
  scalar strings such as Fulfillment shipping option rule values can be used
  in repository filters without invalid JSON input errors.
- PGlite row normalization now preserves returned JSON scalar strings while
  still decoding returned JSON arrays and objects.
- The PGlite DML relationship compiler now honors explicit
  `foreignKeyName` metadata for `belongsTo` relationships, covering
  Fulfillment's `shipping_option_type_id` relationship.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- Adapter-level PGlite regression tests for JSON scalar filters and explicit
  DML relationship foreign-key names.
- The first Fulfillment PGlite probe, which now progresses past the initial
  JSON input and named foreign-key failures but is not yet a full module pass.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/notification test:integration --runInBand`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/payment test:integration --runInBand`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/tax test:integration --runInBand`

Current limitations:

- The unchanged Fulfillment integration suite is still not a completed PGlite
  proof. At the end of this slice, remaining failures included child relation
  mutation event accounting, shipping option type replacement behavior,
  geo-zone relation filtering, and an `initModules` bootstrap path that still
  falls back to the default MikroORM/Postgres loader.
- PGlite remains a fast integration-test lane. Redis-backed suites and the
  full Postgres gate are still separate validation lanes.

## Fulfillment PGlite HasMany Action Proof

Commit:

- This commit (`test: add Fulfillment PGlite relation action proof`)

The Fulfillment PGlite probe now covers another adapter-owned behavior needed
by the unchanged suite: relation replacement action accounting.

Differences from original Medusa:

- No Fulfillment service, DML model, provider, public API, or integration
  assertion changed.
- PGlite `hasMany` replacement now preserves retained children, updates
  retained children only when incoming scalar fields actually changed, creates
  new children, and deletes omitted children.
- Normal PGlite repository `create`, `update`, and `upsert` paths now dispatch
  performed child relation actions after the parent mutation, matching the
  event accounting that MikroORM subscribers provide for nested writes.
- PGlite `upsertWithReplace` still returns `performedActions` for Medusa's
  existing internal service to dispatch manually. The existing suppression flag
  prevents double emission on that path.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- Adapter-level PGlite regression coverage for `hasMany` replacement
  create/update/delete action maps.
- Focused Fulfillment service-zone update/upsert assertions that exercise
  retained, updated, created, and deleted `geo_zones`.
- Focused Fulfillment shipping-option create assertions that exercise nested
  `type` and `rules` event emission.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/fulfillment exec jest integration-tests/__tests__/fulfillment-module-service/service-zone.spec.ts --runInBand --forceExit --testNamePattern="should update an existing service zone|should upsert a collection of service zones"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/fulfillment exec jest integration-tests/__tests__/fulfillment-module-service/shipping-option.spec.ts --runInBand --forceExit`
  progressed to 13 passing and 14 failing tests. The create nested-relation
  event assertions now pass; remaining failures are listed below.
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/notification test:integration --runInBand`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/payment test:integration --runInBand`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/tax test:integration --runInBand`

Current limitations:

- The unchanged Fulfillment integration suite is still not a completed PGlite
  proof.
- At the end of this slice, remaining focused shipping-option failures were
  concentrated in shipping option type replacement behavior and geo-zone
  relation filtering.
- The full Fulfillment suite also still has an `initModules` bootstrap path
  that falls back to the default MikroORM/Postgres loader.
- PGlite remains a fast integration-test lane. Redis-backed suites and the
  full Postgres gate are still separate validation lanes.

## Fulfillment PGlite BelongsTo Replacement Proof

Commit:

- This commit (`test: add Fulfillment PGlite belongsTo replacement proof`)

The focused Fulfillment shipping-option update assertions now pass under the
PGlite fast lane.

Differences from original Medusa:

- No Fulfillment service, DML model, provider, public API, or integration
  assertion changed.
- PGlite `belongsTo` object handling now distinguishes create-time foreign-key
  preparation from update-time replacement.
- On create/upsert paths that already prepared a target row to satisfy the
  parent foreign key, relation replacement reuses that prepared target instead
  of inserting a duplicate orphan row.
- On update paths with a new related object that has no primary key, relation
  replacement creates a new target row and repoints the parent foreign key
  instead of mutating the previously related target.
- This matches the Fulfillment shipping option type behavior expected by the
  unchanged integration assertions.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- Adapter-level PGlite regression coverage for `belongsTo` object target reuse
  during create and replacement during update.
- Focused Fulfillment shipping-option update assertions that exercise
  `ShippingOption.type` replacement and retained type rows.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/fulfillment exec jest integration-tests/__tests__/fulfillment-module-service/shipping-option.spec.ts --runInBand --forceExit --testNamePattern="should update a shipping option$|should update a shipping option without updating the rules or the type|should update a collection of shipping options"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/fulfillment exec jest integration-tests/__tests__/fulfillment-module-service/service-zone.spec.ts --runInBand --forceExit --testNamePattern="should update an existing service zone|should upsert a collection of service zones"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/fulfillment exec jest integration-tests/__tests__/fulfillment-module-service/shipping-option.spec.ts --runInBand --forceExit`
  progressed to 16 passing and 11 failing tests. The remaining failures are
  listed below.
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/notification test:integration --runInBand`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/payment test:integration --runInBand`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/tax test:integration --runInBand`

Current limitations:

- The unchanged Fulfillment integration suite is still not a completed PGlite
  proof.
- At the end of this slice, remaining focused shipping-option failures were
  concentrated in address/geo-zone relation filtering.
- The full Fulfillment suite also still has an `initModules` bootstrap path
  that falls back to the default MikroORM/Postgres loader.
- PGlite remains a fast integration-test lane. Redis-backed suites and the
  full Postgres gate are still separate validation lanes.

## Fulfillment PGlite Nested Relation Proof

Commit:

- This commit (`test: add Fulfillment PGlite nested relation proof`)

The full Fulfillment `shipping-option.spec.ts` file now passes under the PGlite
fast lane. This includes the previously failing address/geo-zone relation
filter assertions.

Differences from original Medusa:

- No Fulfillment service, DML model, provider, public API, or integration
  assertion changed.
- PGlite `hasMany` relation replacement now recurses into relationship fields
  that are present on each child input.
- This lets nested create/update shapes such as fulfillment set -> service
  zones -> geo zones persist the second-level relation rows before later
  shipping-option filters traverse `service_zone.geo_zones`.
- The recursion remains input-driven. Missing child relation fields are not
  treated as replacement requests.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- Adapter-level PGlite regression coverage for nested `hasMany` creation plus
  nested `belongsTo`/`hasMany` relation filters.
- Fulfillment shipping-option, fulfillment-set, and service-zone module-service
  assertions under the PGlite lane.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/fulfillment exec jest integration-tests/__tests__/fulfillment-module-service/shipping-option.spec.ts --runInBand --forceExit --testNamePattern="specific address|buildGeoZoneConstraintsFromAddress"`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/fulfillment exec jest integration-tests/__tests__/fulfillment-module-service/shipping-option.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/fulfillment exec jest integration-tests/__tests__/fulfillment-module-service/service-zone.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/fulfillment exec jest integration-tests/__tests__/fulfillment-module-service/fulfillment-set.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/fulfillment exec jest integration-tests/__tests__/fulfillment-module-service --runInBand --forceExit`
  progressed to 5 passing files and 2 failing files. The passing files were
  `shipping-option.spec.ts`, `service-zone.spec.ts`,
  `fulfillment-set.spec.ts`, `shipping-profile.spec.ts`, and
  `geo-zone.spec.ts`.
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/notification test:integration --runInBand`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/payment test:integration --runInBand`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/tax test:integration --runInBand`

Current limitations:

- The unchanged Fulfillment integration suite is still not a completed PGlite
  proof.
- At the end of this slice, `fulfillment.spec.ts` exposed the next adapter gap:
  PGlite relation replacement did not yet support `hasOne` inputs such as
  fulfillment delivery addresses.
- `index.spec.ts` still has an `initModules` bootstrap path that falls back to
  the default MikroORM/Postgres loader.
- PGlite remains a fast integration-test lane. Redis-backed suites and the
  full Postgres gate are still separate validation lanes.

## Fulfillment PGlite HasOne Relation Proof

Commit:

- This commit (`test: add Fulfillment PGlite hasOne proof`)

The full Fulfillment `fulfillment.spec.ts` file now passes under the PGlite
fast lane. Six of seven Fulfillment module-service files pass under PGlite;
the remaining file is the known `initModules` bootstrap fallback.

Differences from original Medusa:

- No Fulfillment service, DML model, provider, public API, or integration
  assertion changed.
- PGlite now treats DML `hasOneWithFK` relationships as source-owned foreign
  key relations, matching `hasOne(..., { foreignKey: true })` models such as
  `Fulfillment.delivery_address` and `Fulfillment.provider`.
- PGlite table compilation now creates the source FK column for
  `hasOneWithFK` relationships, and relation hydration/filtering/replacement
  share the same owner-side FK path as `belongsTo`.
- Direct repository updates with an empty `hasMany` relation array now leave
  existing children unchanged. Non-empty direct updates still replace children
  by retained IDs, matching the Fulfillment label update assertions.
- Relation-only direct updates no longer synthesize a parent `updated_at`
  mutation event.

Affected boundary:

- `@medusajs/test-utils` PGlite module-test persistence adapter.
- Adapter-level PGlite regression coverage for source-owned `hasOne` creation,
  FK column generation, hydration, empty direct-update `hasMany` no-ops, and
  non-empty direct-update child replacement.
- Fulfillment `fulfillment.spec.ts` assertions for fulfillment creation,
  return fulfillment creation, label updates, cancellation, and deletion under
  the PGlite lane.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/test-utils exec jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/fulfillment exec jest integration-tests/__tests__/fulfillment-module-service/fulfillment.spec.ts --runInBand --forceExit`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/fulfillment exec jest integration-tests/__tests__/fulfillment-module-service --runInBand --forceExit`
  progressed to 6 passing files and 1 failing file. The passing files were
  `shipping-option.spec.ts`, `fulfillment.spec.ts`,
  `fulfillment-set.spec.ts`, `geo-zone.spec.ts`,
  `shipping-profile.spec.ts`, and `service-zone.spec.ts`. The remaining
  failing file is `index.spec.ts`.
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/notification test:integration --runInBand`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/payment test:integration --runInBand`
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/tax test:integration --runInBand`

Current limitations:

- At the end of this slice, the unchanged Fulfillment integration suite was
  still not a completed PGlite proof because `index.spec.ts` had an
  `initModules` bootstrap path that fell back to the default MikroORM/Postgres
  loader.
- PGlite remains a fast integration-test lane. Redis-backed suites and the
  full Postgres gate are still separate validation lanes.

## Fulfillment PGlite InitModules Completion

Commit:

- This commit (`test: complete Fulfillment PGlite module-service lane`)

The full Fulfillment module-service integration directory now passes through
the PGlite fast lane. This completes the remaining `index.spec.ts` bootstrap
and soft-delete cascade path without changing Fulfillment services, models,
provider contracts, public APIs, or integration assertions.

Differences from original Medusa:

- Standalone `initModules` now honors `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`
  by routing module bootstrap through the PGlite module-test persistence
  adapter instead of falling back to the default MikroORM/Postgres loader.
- When `moduleIntegrationTestRunner` supplies a PGlite manager, the PGlite
  `initModules` path reuses that manager and registers it for the same
  database config. Standalone `initModules` calls inside the same test then
  share the runner-owned database and runner cleanup remains authoritative.
- Standalone PGlite bootstraps that do not receive a manager still reuse an
  in-memory connection per database config, which preserves rows across the
  multiple bootstrap calls required by the Fulfillment provider enable/disable
  assertion.
- PGlite relation hydration now propagates `withDeleted` to requested
  relations and nested relations. Soft-deleted cascade children are included
  only when the caller requests deleted rows.

Affected boundary:

- `@medusajs/test-utils` standalone `initModules`.
- `@medusajs/test-utils` PGlite module-test persistence adapter.
- Adapter-level PGlite regression coverage for `withDeleted` relation
  hydration.
- Fulfillment module-service bootstrap, provider enable/disable, and
  soft-delete cascade assertions under the PGlite lane.

Validation:

- `pnpm --filter @medusajs/test-utils build`
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; cmd /c ..\..\node_modules\.bin\jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts src/__tests__/module-test-persistence-selection.spec.ts --runInBand --forceExit`
  from `packages/medusa-test-utils`: 2 suites and 14 tests passed.
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; cmd /c ..\..\..\node_modules\.bin\jest integration-tests/__tests__/fulfillment-module-service/index.spec.ts --runInBand --forceExit`
  from `packages/modules/fulfillment`: 1 suite and 3 tests passed.
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; cmd /c ..\..\..\node_modules\.bin\jest integration-tests/__tests__/fulfillment-module-service --runInBand --forceExit`
  from `packages/modules/fulfillment`: 7 suites and 75 tests passed.
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/notification test:integration --runInBand`
  passed: 2 suites and 11 tests.
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/payment test:integration --runInBand`
  passed: 2 suites and 36 tests.
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/tax test:integration --runInBand`
  passed: 2 suites and 35 tests.

Validation note:

- In this continuation, `pnpm --filter <package> exec jest ...` did not add
  the root Jest binary to `PATH`, so focused Jest validations used the local
  root `.bin\jest` command from each package directory.

Current limitations:

- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate.
- Redis-backed suites and the full Postgres gate remain separate validation
  lanes.

## Promotion PGlite Implicit Pivot Foundation

Commit:

- This commit (`test: add PGlite implicit many-to-many pivots`)

The PGlite test adapter now supports DML many-to-many relationships declared
with Medusa's ordinary `pivotTable` metadata, without requiring a parallel
pivot entity. This is an adapter-only extension; Promotion services, models,
fixtures, and original integration assertions are unchanged.

Differences from original Medusa:

- PGlite migration rendering creates configured implicit pivot tables with the
  declared join columns and a composite primary key.
- PGlite many-to-many replacement creates or updates related DML rows,
  replaces pivot rows for the parent, and keeps relation arrays on returned
  entities in sync.
- Relation hydration resolves both the configured owning side and the inverse
  `mappedBy` side of an implicit pivot.

Affected boundary:

- `@medusajs/test-utils` PGlite DML migration renderer and repository relation
  replacement/hydration logic.
- Promotion module service assertions that use Promotion rules and Application
  Method target/buy rules.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- PowerShell:
  `$env:MEDUSA_PGLITE_TESTS='1'; $env:NODE_OPTIONS='--experimental-vm-modules'; cmd /c ..\..\node_modules\.bin\jest src/__tests__/pglite-module-test-persistence-adapter.spec.ts --runInBand --forceExit`
  from `packages/medusa-test-utils`: 1 suite and 11 tests passed, including
  configured pivot schema, replacement, owning-side hydration, and inverse
  hydration.
- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; cmd /c ..\..\..\node_modules\.bin\jest integration-tests/__tests__/services/promotion-module/promotion.spec.ts --runInBand --forceExit`
  from `packages/modules/promotion`: 48 of 53 unchanged assertions passed.

Checkpoint limitations:

- At this checkpoint, the Promotion file was not yet a completed PGlite proof.
  Its five remaining assertions exposed separate adapter gaps: nested
  Campaign-to-Promotion creation, field projection after relation hydration,
  and singular-relation soft-delete/restore cascades.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Promotion PGlite HasMany Reassignment

Commit:

- This commit (`test: support PGlite hasMany reassignment`)

The unchanged Promotion assertion that creates a new Campaign for an existing
Promotion now passes through PGlite. The Campaign service sends an ID-only
Promotion child payload, and the test adapter now reassigns that existing row
instead of attempting to insert an incomplete duplicate.

Differences from original Medusa:

- PGlite `hasMany` replacement looks up a child with a supplied primary key
  outside the current parent relation.
- When that child already exists, the adapter updates its owning foreign key
  and any supplied scalar fields while preserving unspecified required fields.
- The reassignment is reported as an updated child action and nested relation
  replacement still runs against the reassigned row.

Affected boundary:

- `@medusajs/test-utils` PGlite `hasMany` replacement behavior.
- Promotion Campaign creation using an existing Promotion ID.
- Adapter regression coverage for moving an existing child between parents
  from a primary-key-only relation payload.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- PGlite adapter suite: 1 suite and 12 tests passed.
- The focused unchanged Promotion Campaign creation assertion passed.
- The full unchanged Promotion service file reached 49 of 53 passing
  assertions.
- The previously green Fulfillment PGlite module-service lane remained green:
  7 suites and 75 tests passed.

Checkpoint limitations:

- At this checkpoint, Promotion was not yet a completed PGlite module lane.
  The four remaining assertions covered selected-field projection after
  relation hydration and singular-relation soft-delete/restore cascades.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Promotion PGlite Relation Projection

Commit:

- This commit (`test: project PGlite relation fields`)

The unchanged Promotion list-and-count assertions now pass when selecting
dotted relation fields such as `application_method.type`. PGlite also preserves
Medusa's expected `null` value for a loaded nullable source-owned relation even
when that relation was not requested for hydration.

Differences from original Medusa:

- PGlite relation hydration carries each relation's dotted field paths through
  nested hydration.
- Hydrated related rows are projected after nested hydration and retain their
  primary keys plus explicitly selected scalar or nested relation fields.
- A source-owned singular relation is initialized to `null` when its loaded
  foreign-key column is null. If that internal foreign key was not selected,
  the adapter does not invent a relation value.

Affected boundary:

- `@medusajs/test-utils` PGlite repository read shaping and relation hydration.
- Promotion `application_method.type` selection and Campaign `budget.limit`
  selection through unchanged service assertions.
- Adapter regression coverage for nullable singular relations and projected
  inverse `hasOne` rows.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- PGlite adapter suite: 1 suite and 13 tests passed.
- The full unchanged Promotion service file reached 51 of 53 passing
  assertions; only the singular cascade pair remains.
- The unchanged Campaign service file passed its default and dotted relation
  projection assertions and reached 18 of 21 passing assertions. Its three
  remaining failures stop at the same singular cascade guard.
- The Fulfillment PGlite module-service regression lane remained green: 7
  suites and 75 tests passed.

Checkpoint limitations:

- At this checkpoint, Promotion was not yet a completed PGlite module lane.
  Its remaining service failures required soft-delete and restore cascades
  over inverse singular relations such as Promotion-to-ApplicationMethod and
  Campaign-to-Budget.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Promotion PGlite Inverse Singular Cascades

Commit:

- This commit (`test: cascade PGlite inverse hasOne relations`)

The full unchanged `promotion.spec.ts` service file now passes under PGlite.
Promotion soft-delete and restore cascade to the inverse Application Method,
and Campaign soft-delete and restore cascade to the inverse Campaign Budget.
No Promotion or Campaign model, service, fixture, or assertion changed.

Differences from original Medusa:

- PGlite soft-delete and restore cascades now accept inverse `hasOne`
  relationships whose foreign key is stored on the target row.
- The existing target foreign-key update path applies `deleted_at` and
  `updated_at`, returns cascaded child IDs, and recursively processes child
  cascade metadata for both `hasMany` and inverse `hasOne` relations.
- Source-owned `hasOneWithFK` cascades remain outside this implementation and
  still fail loudly instead of using the wrong ownership direction.

Affected boundary:

- `@medusajs/test-utils` PGlite soft-delete and restore cascade traversal.
- Promotion-to-ApplicationMethod and Campaign-to-CampaignBudget cascade
  assertions.
- Adapter regression coverage for inverse singular child deletion, restoration,
  and cascade metadata.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- PGlite adapter suite: 1 suite and 14 tests passed.
- The unchanged Promotion service file passed completely: 1 suite and 53
  tests.
- The unchanged Campaign service file reached 20 of 21 passing tests. Its
  soft-delete and restore assertions now pass; the sole remaining failure is a
  separate partial-unique-index duplicate error translation mismatch.

Checkpoint limitations:

- At this checkpoint, the full Promotion integration directory was not yet a
  completed PGlite lane. Campaign duplicate-key translation and the remaining
  service files still required validation.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Promotion PGlite Restore Conflict Translation

Commit:

- This commit (`test: map PGlite restore conflicts`)

The full unchanged Campaign service file now passes under PGlite. Restoring a
soft-deleted Campaign into a partial unique-index conflict now produces the
same Medusa duplicate-entity message as the default persistence path instead
of leaking PGlite's raw PostgreSQL constraint message.

Differences from original Medusa:

- PGlite soft-delete and restore updates now execute through the repository's
  existing mapped-query boundary.
- Restore-time `23505` errors therefore use the same table, key, and value
  translation already applied to PGlite create and update mutations.
- A failed restore remains atomic: the original row stays soft-deleted when a
  live replacement occupies the partial unique key.

Affected boundary:

- `@medusajs/test-utils` PGlite soft-delete/restore query error handling.
- Campaign partial unique-index restoration behavior.
- Adapter regression coverage for translated restore conflicts and preserved
  deleted state.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- PGlite adapter suite: 1 suite and 15 tests passed.
- The complete unchanged Promotion and Campaign service files passed together:
  2 suites and 74 tests.
- Five of six Promotion module-service files passed together: 5 suites and 92
  tests. The full-directory probe isolated the remaining file to
  `compute-actions.spec.ts`.

Checkpoint limitations:

- At this checkpoint, the Promotion module-service directory was not yet fully
  PGlite-green. `compute-actions.spec.ts` passed Medusa `[raw]` SQL predicates
  containing alias placeholders and subqueries; the PGlite filter renderer
  rejected those as unknown fields.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Promotion PGlite Raw Predicate Boundary

Commit:

- This commit (`test: execute PGlite raw predicates`)

The PGlite repository now accepts the serialized MikroORM raw-predicate shape
used by Promotion rule prefiltering. The unchanged `compute-actions.spec.ts`
file advances past its previous unknown-field failure and reaches nested
relation ordering.

Differences from original Medusa:

- PGlite recognizes filter keys serialized as `[raw]: ... (#N)` and executes a
  truthy predicate inside the normal `WHERE` clause.
- `[::alias::]` placeholders are replaced with the schema-qualified outer
  table name so correlated Promotion subqueries keep their original meaning.
- The boundary rejects non-boolean truthy values, statement separators, and
  unbound `?` or `$N` parameters. False, null, and undefined raw predicates are
  ignored, matching the fork's existing Drizzle behavior.

Affected boundary:

- `@medusajs/test-utils` PGlite filter rendering.
- Promotion rule-prefilter SQL generated by
  `buildPromotionRuleQueryFilterFromContext`.
- Adapter regression coverage for alias-qualified raw predicates, disabled
  predicates, and rejected unbound parameters.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- PGlite adapter suite: 1 suite and 16 tests passed.
- Five non-compute Promotion module-service files remained green together: 5
  suites and 92 tests.
- The full unchanged `compute-actions.spec.ts` probe no longer reports unknown
  raw-filter fields. All 86 assertions now reach the next shared blocker:
  nested ordering by `application_method.value` is rendered as an invalid
  scalar `application_method` column.

Checkpoint limitations:

- At this checkpoint, `compute-actions.spec.ts` remained outside the green
  PGlite lane until the repository could order root rows by a related entity
  field without changing Promotion service behavior.
- The raw predicate boundary intentionally does not support serialized
  parameter arrays because the string key does not carry their values.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Promotion PGlite Module-Service Completion

Commit:

- This commit (`test: order PGlite by singular relations`)

The complete unchanged Promotion module-service integration directory now
passes under PGlite. This includes rule prefiltering, automatic promotions,
item and shipping adjustments, campaign budgets, buy-get behavior, relation
mutation helpers, soft deletion, restoration, and selected relation fields.

Differences from original Medusa:

- PGlite root queries can order by a scalar field on a singular relation such
  as `application_method.value`.
- Singular relation ordering uses a correlated subquery rather than a join, so
  root row cardinality, pagination, and count behavior are not multiplied by
  relation rows.
- Both source-owned singular relations and inverse `hasOne` relations are
  supported. Soft-deleted target rows are excluded from the ordering value.
- Collection ordering and deeper nested relation ordering still fail loudly.

Affected boundary:

- `@medusajs/test-utils` PGlite `ORDER BY` rendering.
- Promotion compute-action ordering by Application Method value.
- Adapter regression coverage for inverse `hasOne` ordering.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- PGlite adapter suite: 1 suite and 17 tests passed.
- The complete unchanged `compute-actions.spec.ts` file passed: 1 suite and 86
  tests.
- The complete unchanged Promotion module-service directory passed: 6 suites
  and 178 tests.

Current limitations:

- PGlite singular ordering intentionally stops at one relation hop. Ordering
  through `hasMany`, `manyToMany`, or a deeper nested relation remains
  unsupported until an unchanged module assertion requires defined semantics.
- Serialized raw predicate parameter arrays remain unsupported because their
  values are not present in the serialized filter key.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Product Types PGlite Primary-Key Projection

Commit:

- This commit (`test: retain PGlite projection primary keys`)

The complete unchanged Product Types module-service file now passes under
PGlite. Product list and list-and-count queries retain the entity primary key
when callers select only another scalar field, matching Medusa repository
projection behavior.

Differences from original Medusa:

- Explicit PGlite field projections now always include all entity primary-key
  columns, regardless of whether relation hydration is requested.
- Existing dotted relation projection behavior remains unchanged; it already
  retained relation target primary keys.

Affected boundary:

- `@medusajs/test-utils` PGlite root-column selection.
- Product Types list and list-and-count scalar projections.
- Adapter regression coverage for scalar projection with implicit primary-key
  retention.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- PGlite adapter suite: 1 suite and 17 tests passed.
- The complete unchanged Product Types file passed: 1 suite and 13 tests.
- The adjacent unchanged Product Tags file reached 14 of 15 passing tests.

Current limitations:

- Product Tags is not yet a completed PGlite file. Its remaining assertion
  selects a nested Product collection relation whose foreign key and relation
  are both null; nested projection currently removes those null fields.
- The broader Product module-service directory remains unvalidated under
  PGlite and will proceed file by file.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Product Tags PGlite Nested Null Relation Projection

Commit:

- This commit (`test: preserve PGlite nested null relations`)

The complete unchanged Product Tags module-service file now passes under
PGlite. A projected Product nested under a Product Tag retains an explicitly
populated nullable collection relation and its source-owned foreign key when
both values are null, matching Medusa repository projection behavior.

Differences from original Medusa:

- PGlite relation projection now retains direct nested relations requested for
  hydration even when the parent relation's scalar field projection does not
  name them.
- When the nested relation owns its source foreign key, that foreign key is
  retained with the relation, including when both values are null.
- Product services, models, and unchanged integration assertions were not
  modified.

Affected boundary:

- `@medusajs/test-utils` PGlite nested relation projection.
- Nullable source-owned `belongsTo` relations inside projected relation rows.
- Product Tag list hydration through `products.collection`.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- PGlite adapter suite: 1 suite and 17 tests passed.
- The complete unchanged Product Tags file passed: 1 suite and 15 tests.
- The adjacent unchanged Product Options file reached 9 of 13 passing tests.

Current limitations:

- Product Options is not yet a completed PGlite file. Its four remaining
  assertions all receive `product: null` because Product Option relation
  ownership is not yet resolved correctly by the PGlite adapter.
- The broader Product module-service directory remains unvalidated under
  PGlite and will proceed file by file.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Product Options PGlite Source-Owned Relation Projection

Commit:

- This commit (`test: retain PGlite root relation foreign keys`)

The complete unchanged Product Options and Product Collections module-service
files now pass under PGlite. Explicit Product Option projections retain the
`product_id` source foreign key needed to hydrate the requested Product
relation, while inverse Product Collection relations continue to behave
unchanged.

Differences from original Medusa:

- PGlite root-column selection now includes source-owned foreign-key columns
  for requested relations when an explicit scalar field projection is active.
- The selection uses compiled relationship metadata, so default and explicitly
  named DML foreign keys follow the same path.
- Product services, models, and unchanged integration assertions were not
  modified.

Affected boundary:

- `@medusajs/test-utils` PGlite root relation column selection.
- Source-owned `belongsTo` and `hasOneWithFK` hydration under explicit field
  projections.
- Product Option `product` projection and Product Collection inverse relation
  validation.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- PGlite adapter suite: 1 suite and 17 tests passed.
- The complete unchanged Product Options file passed: 1 suite and 13 tests.
- The complete unchanged Product Collections file passed: 1 suite and 18
  tests.

Current limitations:

- The remaining Product module-service files have not all been validated under
  PGlite and will continue file by file.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Product Categories PGlite Validation

Commit:

- This commit (`test: validate Product Categories with PGlite`)

The complete unchanged Product Categories module-service file passes under
PGlite without an additional adapter change. This validates Product Category
self-relations, tree traversal, sibling rank updates, delete guards, cascades,
and Product many-to-many links through the existing fast lane.

Differences from original Medusa:

- This commit introduces no Product Category runtime or persistence behavior
  change; it records compatibility of the unchanged Medusa assertions with the
  existing PGlite adapter.
- Product services, models, and integration assertions remain unchanged.

Affected boundary:

- Product Category module-service validation through
  `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`.
- Self-referential `parent_category` and `category_children` relations.
- Product Category rank mutation and Product many-to-many relation behavior.

Validation:

- The complete unchanged Product Categories file passed: 1 suite and 21 tests.
- The adjacent unchanged Product Variants file reached 14 of 15 passing tests.

Current limitations:

- Product Variants is not yet a completed PGlite file. Its remaining image
  assertion retrieves Product images ordered by `images.rank`; PGlite relation
  ordering currently supports singular relations but not collection-valued
  `hasMany` relations.
- The remaining Product module-service files have not all been validated under
  PGlite and will continue file by file.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Product Variants PGlite HasMany Ordering

Commit:

- This commit (`test: order PGlite hasMany relations`)

The complete unchanged Product Variants module-service file now passes under
PGlite. Product retrieval can order through `images.rank`, and the hydrated
Product image collection follows the same scalar ordering requested by the
unchanged Product service.

Differences from original Medusa:

- PGlite root queries now order through a direct `hasMany` relation by using
  the first related scalar value in the requested direction.
- PGlite relation hydration carries the nested order configuration into direct
  `hasMany` queries so each hydrated collection is ordered consistently.
- Product services, models, and unchanged integration assertions were not
  modified.

Affected boundary:

- `@medusajs/test-utils` PGlite root and relation order rendering.
- Direct `hasMany` hydration with scalar order fields.
- Product image ordering used by Product Variant image association behavior.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- PGlite adapter suite: 1 suite and 18 tests passed.
- The complete unchanged Product Variants file passed: 1 suite and 15 tests.
- The adjacent unchanged Product events file reached 19 of 22 passing tests.

Current limitations:

- Product events is not yet a completed PGlite file. Its three remaining
  assertions expose incomplete cascade-delete action reporting and resulting
  event emission for Product relation updates and soft deletes.
- Root ordering through many-to-many relations and ordering through deeper
  nested relation paths remain unsupported by the PGlite adapter.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Product Events PGlite Soft-Delete Dispatch

Commit:

- This commit (`test: dispatch PGlite cascade soft-delete events`)

PGlite repository soft deletes and restores now dispatch mutation events for
the root row and every recursively cascaded row. The unchanged Product deletion
event assertion passes with Product, Variant, Option, Option Value, and Image
delete events emitted through the existing Product event aggregator.

Differences from original Medusa:

- PGlite soft-delete mutations dispatch `afterUpdate` with a `deleted_at`
  change set for both root and cascaded model names.
- PGlite restore mutations dispatch the inverse change set so existing Medusa
  event interception recognizes restored entities.
- Existing soft-delete return payloads remain unchanged; cascade maps still
  contain model names and primary-key values.

Affected boundary:

- `@medusajs/test-utils` PGlite mutation-event dispatch.
- Recursive `hasOne` and `hasMany` soft-delete/restore cascades.
- Product deletion event aggregation through unchanged Medusa services.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- PGlite adapter suite: 1 suite and 18 tests passed.
- The focused unchanged Product deletion event assertion passed.
- The complete unchanged Product events file reached 20 of 22 passing tests.

Current limitations:

- Product relation replacement still omits the nested Product Option Value
  delete action when its parent Product Option is removed.
- Product Category's custom portable delete path does not yet dispatch its
  deletion event, leaving the base-service event assertion at 4 of 5 calls.
- Product events is not yet a completed PGlite file and remains the next active
  Product slice.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Product Category Portable Delete Events

Commit:

- This commit (`fix: dispatch portable Product Category delete events`)

Product Category's custom portable repository delete path now dispatches the
same `afterDelete` mutation event as generated Medusa internal-service delete
methods. The unchanged Product base-delete event assertion now receives all
five Product, Tag, Type, Category, and Collection event batches.

Differences from original Medusa:

- The portable Product Category delete branch dispatches deleted IDs through
  the selected module persistence adapter after its custom child guard and rank
  maintenance complete.
- The event subscriber is created through the selected adapter against the
  existing Product module mutation service, preserving PGlite, Drizzle, and
  MikroORM event boundaries without making repository hard deletes emit twice.
- Product Category public APIs and unchanged integration assertions remain
  unchanged.

Affected boundary:

- Product Category custom portable mutation service.
- Module persistence adapter event-subscriber and `afterDelete` dispatch
  contracts.
- Product base delete event aggregation.

Validation:

- `pnpm --filter @medusajs/product build` passed.
- The complete unchanged Product Categories file passed: 1 suite and 21 tests.
- The focused unchanged five-entity base delete event assertion passed.
- The complete unchanged Product events file reached 21 of 22 passing tests.

Current limitations:

- Product relation replacement still omits the nested Product Option Value
  delete action when its parent Product Option is removed. This is the final
  failing Product events assertion under PGlite.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Product Events PGlite Nested Replacement Cascades

Commit:

- This commit (`test: report PGlite nested replacement cascades`)

The complete unchanged Product events module-service file now passes under
PGlite. When `upsertWithReplace` removes a configured `hasMany` child, PGlite
recursively deletes that child's configured cascade targets and includes every
deleted model ID in `performedActions.deleted` for Medusa event dispatch.

Differences from original Medusa:

- PGlite replacement deletion now traverses configured target-owned `hasOne`
  and `hasMany` hard-delete cascades before deleting the replaced child.
- Nested cascade rows are physically deleted and reported under their compiled
  DML model names, matching Medusa's performed-action event contract.
- Product services, models, and unchanged Product event assertions were not
  modified.

Affected boundary:

- `@medusajs/test-utils` PGlite `upsertWithReplace` relation deletion.
- Recursive configured hard-delete cascade action reporting.
- Product Option and Product Option Value replacement event emission.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- PGlite adapter suite: 1 suite and 18 tests passed.
- The complete unchanged Product events file passed: 1 suite and 22 tests.
- The adjacent unchanged Products file reached 29 passing, 5 failing, and 1
  skipped test.

Current limitations:

- Products has four remaining invalid relationship-ID assertions. Missing Tag
  and Category IDs currently attempt incomplete target creation, while missing
  Collection and Type IDs are accepted instead of raising Medusa's relationship
  error.
- Products also returns an update result without `images` when an empty image
  array removes all images; the unchanged assertion expects `images: []`.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Products PGlite Relationship Existence Validation

Commit:

- This commit (`test: validate PGlite relationship targets`)

The unchanged Products module-service assertions now receive Medusa-compatible
relationship errors when a create or update references a missing Tag, Category,
Collection, or Type ID. PGlite validates source-owned foreign keys and
primary-key-only relation payloads before mutating relation state.

Differences from original Medusa:

- PGlite now requires direct source-owned foreign keys to resolve to an
  existing target row before create or update.
- A primary-key-only belongs-to or many-to-many object is treated as a link to
  an existing entity. Relation objects with additional target fields retain
  nested create and upsert behavior.
- Missing targets use Medusa's relationship error shape:

  ```text
  You tried to set relationship <field>: <value>, but such entity does not exist
  ```

- Product services, models, and the unchanged Products assertions were not
  modified.

Affected boundary:

- `@medusajs/test-utils` PGlite source-owned foreign-key validation.
- PGlite belongs-to replacement and implicit many-to-many target resolution.
- Product Tag, Category, Collection, and Type relationship updates.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The two focused adapter relationship regressions passed.
- PGlite adapter suite: 1 suite and 18 tests passed.
- The four focused unchanged Products relationship assertions passed.
- The complete unchanged Products file reached 33 passing, 1 failing, and 1
  skipped test.

Current limitations:

- Products still omits `images` from wildcard retrieval after an empty image
  array removes all images; the unchanged assertion expects `images: []`.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Products PGlite Wildcard Relation Hydration

Commit:

- This commit (`test: hydrate PGlite wildcard relations`)

The complete unchanged Products module-service file now passes under PGlite.
Repository retrieval expands a wildcard relation request to the current DML
model's compiled relationships, so an explicitly populated collection is
returned as an empty array when no target rows exist.

Differences from original Medusa:

- PGlite now expands `relations: ["*"]` before selecting relation-dependent
  columns and hydrating rows.
- Wildcards are expanded again at each nested model boundary, so requests such
  as `variants.*` resolve against the target model's relationships.
- Empty `hasMany` and `manyToMany` relations retain their hydrated collection
  shape instead of being omitted.
- Product services, models, and the unchanged Products assertions were not
  modified.

Affected boundary:

- `@medusajs/test-utils` PGlite relation-name normalization and hydration.
- Product retrieval after replacing `images` with an empty array.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The focused wildcard empty-collection adapter regression passed after first
  reproducing the missing relation on the previous implementation.
- PGlite adapter suite: 1 suite and 19 tests passed.
- The focused unchanged Product image-deletion assertion passed.
- The complete unchanged Products file passed: 1 suite, 34 tests passed, and 1
  performance test skipped.

Current limitations:

- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Product Category Tree Service PGlite Completion

Commit:

- This commit (`test: validate Product Category service with PGlite`)

The complete unchanged top-level Product Category integration file passes
through the PGlite module-test fast lane. This is distinct from the Product
Categories module-service file validated earlier: it exercises the category
tree service's hierarchy-specific behavior.

Differences from original Medusa:

- No Product Category service, model, integration assertion, or PGlite adapter
  code changed for this boundary.
- The existing PGlite adapter is sufficient for descendant and ancestor tree
  expansion, parent scoping, pagination, rank reordering, materialized-path
  updates, and delete guards.

Affected boundary:

- `@medusajs/product` top-level `product-category.spec.ts` integration file.
- Product Category hierarchy reads and mutations through the PGlite test
  adapter.

Validation:

- The complete unchanged Product Category file passed: 1 suite and 31 tests.
- The command ran with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`, Jest
  `--runInBand`, and no Redis-backed suites.

Current limitations:

- This result covers the top-level Product Category integration file, not every
  remaining repository integration file.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Product Service PGlite Scalar Free-Text Search

Commit:

- This commit (`test: support PGlite scalar free-text search`)

The unchanged top-level Product service free-text assertion now passes under
PGlite. The adapter preserves DML scalar `searchable` metadata and translates
Medusa's model-scoped free-text filter into case-insensitive substring matches
across those columns.

Differences from original Medusa:

- PGlite compiled columns now retain scalar `searchable` metadata from DML.
- PGlite select and count queries apply the matching
  `freeTextSearch_<Model>` filter with an `ILIKE` disjunction across searchable
  scalar columns.
- Non-searchable scalar columns are excluded from free-text matching.
- Product services, models, and unchanged Product assertions were not modified.

Affected boundary:

- `@medusajs/test-utils` PGlite DML metadata compilation.
- PGlite repository select and count query construction.
- Product title, subtitle, and description free-text filtering.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The focused adapter regression first reproduced the unfiltered result and
  then passed for case-insensitive matching, non-searchable exclusion, and
  count parity.
- PGlite adapter suite: 1 suite and 20 tests passed.
- The focused unchanged Product free-text assertion passed.
- The complete unchanged top-level Product file reached 22 passing and 1
  failing test.

Current limitations:

- The remaining top-level Product failure is field projection for a
  category-filtered list result.
- Searchable relationship traversal from MikroORM's free-text filter is not yet
  implemented by the PGlite adapter; this slice covers searchable scalar
  columns.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Product PGlite Partial Upsert Results And Package Completion

Commit:

- This commit (`test: retain PGlite partial upsert fields`)

The final unchanged Product integration assertion now passes under PGlite, and
the complete Product integration directory passes as one in-band package gate.
The apparent category-list projection failure was caused by the preceding
relation-only update returning an incomplete Product entity, not by list field
selection.

Differences from original Medusa:

- The existing-row branch of PGlite `upsertWithReplace` now loads the full
  persisted row instead of checking only whether its primary key exists.
- Incoming scalar fields remain a partial update, while untouched persisted
  scalar fields are retained in the returned entity before configured relation
  replacement.
- Product services, models, list projection, and unchanged integration
  assertions were not modified.

Affected boundary:

- `@medusajs/test-utils` PGlite partial `upsertWithReplace` results.
- Relation-only Product updates, including Product Category assignment.
- The complete `@medusajs/product` integration-test directory under PGlite.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The focused has-many replacement regression first reproduced the missing
  untouched scalar field and then passed.
- PGlite adapter suite: 1 suite and 20 tests passed.
- The focused unchanged Product category-filtered list assertion passed.
- The complete unchanged top-level Product file passed: 1 suite and 23 tests.
- The complete Product integration directory passed in-band: 10 suites, 205
  tests passed, and 1 performance test skipped.

Current limitations:

- Searchable relationship traversal from MikroORM's free-text filter remains
  outside the scalar free-text slice completed immediately before this one.
- Product package completion does not prove every other Medusa module package
  integration file has been migrated or validated under PGlite.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Pricing Price List Rules PGlite Completion

Commit:

- This commit (`test: validate Pricing list rules with PGlite`)

The complete unchanged Pricing Price List Rule integration file passes through
the PGlite module-test fast lane.

Differences from original Medusa:

- No Pricing service, model, integration assertion, or PGlite adapter code
  changed for this boundary.
- The existing adapter covers Price List Rule list and count queries, field
  projection, retrieval errors, deletion, assignment, and removal behavior.

Affected boundary:

- `@medusajs/pricing` Price List Rule service integration file.
- Price List and Price List Rule persistence through the PGlite test adapter.

Validation:

- The complete unchanged Price List Rule file passed: 1 suite and 13 tests.
- The command ran with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`, Jest
  `--runInBand`, and no Redis-backed or external PostgreSQL suites.

Current limitations:

- The remaining Pricing integration files have not all been validated under
  PGlite.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Pricing Price Rules PGlite Completion

Commit:

- This commit (`test: validate Pricing rules with PGlite`)

The complete unchanged Pricing Price Rule integration file passes through the
PGlite module-test fast lane.

Differences from original Medusa:

- No Pricing service, model, integration assertion, or PGlite adapter code
  changed for this boundary.
- The existing adapter covers Price Rule relation loading, field projection,
  list and count pagination, retrieval validation, deletion, update validation,
  and creation behavior.

Affected boundary:

- `@medusajs/pricing` Price Rule service integration file.
- Price Rule and Rule Type persistence through the PGlite test adapter.

Validation:

- The complete unchanged Price Rule file passed: 1 suite and 16 tests.
- The command ran with `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`, Jest
  `--runInBand`, and no Redis-backed or external PostgreSQL suites.

Current limitations:

- Four Pricing integration files remain to be validated under PGlite.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Pricing Price Lists PGlite Root-First Creation Events

Commit:

- This commit (`test: order PGlite root creation events first`)

The complete unchanged Pricing Price List integration file now passes under
PGlite. Prices created with nested Price Rules emit the root Price creation
event before nested Price Rule creation events, matching the existing Medusa
assertion.

Differences from original Medusa:

- PGlite `upsertWithReplace` registers the root model in
  `performedActions.created` before replacing configured nested relations.
- Root rows are still persisted before nested targets. The change only makes
  performed-action and emitted-event order deterministic and root-first.
- Pricing services, models, event composition, and unchanged integration
  assertions were not modified.

Affected boundary:

- `@medusajs/test-utils` PGlite `upsertWithReplace` creation action ordering.
- Pricing Price and nested Price Rule creation events.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The focused adapter regression first reproduced child, grandchild, root
  ordering and then passed with root, child, grandchild ordering.
- PGlite adapter suite: 1 suite and 20 tests passed.
- The focused unchanged nested Price Rule event assertion passed.
- The complete unchanged Price List file passed: 1 suite and 26 tests.

Current limitations:

- Three Pricing integration files remain to be validated under PGlite.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Pricing Price Sets PGlite Has-Many Populate Scopes

Commit:

- This commit (`test: scope PGlite hasMany hydration`)

The complete unchanged Pricing Price Set integration file now passes under
PGlite. Price Set retrieval honors the service's runtime
`populateWhere.prices.price_list_id = null` scope, excluding prices owned by a
Price List while leaving those rows persisted.

Differences from original Medusa:

- PGlite reads the runtime `populateWhere` option at one isolated typed boundary
  because the option is not declared by the public `OptionsQuery` type.
- Has-many hydration translates the relation's populate object through the
  existing parameterized where-condition builder.
- Nested hydration receives the scoped relation object for deeper populate
  constraints.
- Pricing services, models, scopes, and unchanged integration assertions were
  not modified.

Affected boundary:

- `@medusajs/test-utils` PGlite has-many relation hydration.
- Pricing Price Set `prices` population and preservation of Price List-owned
  prices.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The focused adapter regression first reproduced an unscoped child collection
  and then passed with a parameterized score constraint.
- PGlite adapter suite: 1 suite and 20 tests passed.
- The three focused unchanged Price Set scope assertions passed.
- The complete unchanged Price Set file passed: 1 suite and 28 tests.

Current limitations:

- `populateWhere` support for singular and many-to-many hydration is not part of
  this has-many slice.
- The Pricing calculation file and one-test index file remain to be validated
  under PGlite.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Pricing PGlite Default Calculation Foundation

Commit:

- This commit (`test: add PGlite default price calculation`)

The unchanged Pricing calculation service now reaches a PGlite-native named
repository instead of invoking the MikroORM/Knex repository with a PGlite
manager. This first calculation slice covers ordinary prices only and leaves
rule and Price List selection for later validated slices.

Differences from original Medusa:

- The PGlite persistence adapter replaces the named `pricingRepository` at the
  existing module-loader extension point. The Pricing service, models, public
  contract, and integration assertions remain unchanged.
- The native query filters by Price Set, currency, deletion state, quantity
  bounds, zero rules, and absence of a Price List. Results preserve Medusa's
  raw amount shape and deterministic amount ordering.
- PGlite BigNumber writes now send the original raw decimal value to the
  database instead of first coercing it to a JavaScript number. This preserves
  arbitrary-precision Pricing amounts in storage.

Affected boundary:

- `@medusajs/test-utils` PGlite named custom repository selection.
- Rule-free, non-Price-List Pricing calculation through the unchanged
  `PricingModuleService`.
- PGlite BigNumber create and update conversion.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- PGlite adapter suite: 1 suite and 22 tests passed, including named Pricing
  repository selection and exact high-precision decimal storage.
- Unchanged focused Pricing assertions passed for min-only quantity bounds,
  zero amounts, and the high-precision ETH amount.
- The complete unchanged calculation file progressed from 1 passing and 41
  Knex failures to 14 passing and 28 behavioral failures. No Knex error
  remains; the probe completed in about 10 seconds in one Jest process.

Current limitations:

- Price Rule matching, custom operators, Price List rules and active windows,
  Price List precedence, and region-based tax outcomes are not implemented by
  this foundation slice. Those account for the remaining calculation failures.
- The Pricing calculation file is not yet an accepted full PGlite gate. The
  one-test Pricing index file also remains to be validated.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Pricing PGlite Price Rule Calculation

Commit:

- This commit (`test: match PGlite pricing rules`)

The unchanged Pricing calculation service now selects non-Price-List prices
whose Price Rules match the supplied pricing context. This extends the existing
PGlite-native `pricingRepository`; it does not replace or modify the Pricing
service, models, public contract, or integration assertions.

Differences from original Medusa:

- The PGlite Pricing repository loads active `PriceRule` rows for candidate
  prices and matches them against a flattened pricing context.
- Rule matching supports nested context attributes, scalar and array values,
  and the existing numeric `eq`, `gt`, `gte`, `lt`, and `lte` behavior.
- Quantity and currency remain query inputs rather than ordinary Price Rule
  attributes. Matching prices are ordered by rule specificity first and amount
  second, preserving the service's existing fallback behavior.
- Price List prices remain excluded in this slice so Price List rules, active
  windows, and precedence can be added as a separate validated boundary.

Affected boundary:

- `@medusajs/test-utils` PGlite named Pricing repository.
- Non-Price-List Price Rule calculation through the unchanged
  `PricingModuleService`.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The eight previously failing focused Price Rule assertions passed unchanged,
  including multiple contexts, quantity interaction, partial matching,
  specificity fallback, array context, and custom numeric operators.
- The complete direct non-Price-List `calculatePrices` block passed: 20 tests.
- PGlite adapter regression suite passed: 1 suite and 22 tests.
- The complete unchanged calculation file progressed from 14 passing to 28
  passing out of 42 in about 12 seconds. The remaining failures are the 13
  Price List assertions and one tax-inclusivity assertion that depends on
  Price List calculated/original price selection. No Knex error remains.

Current limitations:

- Price List rules, active windows, precedence, and related tax-inclusivity
  output remain for the next Pricing calculation slice.
- The Pricing calculation file is not yet an accepted full PGlite gate. The
  one-test Pricing index file also remains to be validated.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Pricing PGlite Price List Calculation

Commit:

- This commit (`test: add PGlite Price List calculation`)

The complete unchanged Pricing calculation integration file now passes through
the PGlite fast lane. The named PGlite `pricingRepository` selects eligible
Price List prices without changing the Pricing service, DML models, public
contract, or integration assertions.

Differences from original Medusa:

- Candidate Price Lists are loaded from their existing DML tables and must be
  active, not deleted, already started, and not expired.
- Price List JSON rules and price-level rules are matched independently against
  the same flattened pricing context. A Price List price is eligible only when
  both applicable rule sets match.
- Candidate ordering preserves Medusa's contract: Price List prices first,
  combined rule specificity second, and amount third. The unchanged service
  continues to apply `sale` versus `override` selection and original-price
  behavior.
- Price List result rows now preserve their list id and typed `sale` or
  `override` value, allowing the unchanged service to calculate the dependent
  tax-inclusivity output.

Affected boundary:

- `@medusajs/test-utils` PGlite named Pricing repository.
- Price List eligibility, rules, active windows, precedence, and result shaping
  through the unchanged `PricingModuleService`.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The focused unchanged Price List block passed: 18 tests.
- The complete unchanged Pricing calculation file passed: 1 suite and 42
  tests, including all four tax-inclusivity assertions, in about 10 seconds.
- PGlite adapter regression suite passed: 1 suite and 22 tests.
- A standalone load of the built Pricing module reproduced the linkable key
  order `priceSet`, `priceList`, `priceRule`, `price`, `pricePreference` without
  the PGlite runner, confirming the separate index assertion mismatch is not a
  persistence-adapter regression.
- `git diff --check` passed.

Current limitations:

- The separate one-test Pricing linkable file was attempted under PGlite. Its
  persistence setup succeeds, but the assertion expects `price` before
  `priceRule` while the current module emits `priceRule` before `price`. That
  key-order mismatch is a separate module-manifest/test expectation follow-up,
  not a Price List calculation failure.
- The other Pricing service integration files remain to be audited before the
  whole Pricing module can be called a PGlite fast lane.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Pricing Linkable Order Alignment

Commit:

- This commit (`fix: align Pricing linkable model order`)

The Pricing module's generated linkable configuration now uses the same model
order as the fork's explicit portable joiner configuration and static manifest.
This resolves the separate one-test Pricing index failure found after the
calculation file became green.

Differences from original Medusa:

- This fork exposes `PriceRule` as a Pricing linkable in addition to original
  Medusa's Price Set, Price List, Price, and Price Preference linkables.
- The generated service model order preserves the portable manifest order:
  Price Set, Price List, Price, Price Preference, then Price Rule.
- `PriceListRule` remains immediately before `PriceRule` in the underlying
  service model object. Both models use the `prule` id prefix, so the later
  linkable `PriceRule` must win prefix-to-entity resolution.
- The fork-added linkable assertion now checks the same canonical order as the
  portable joiner and static manifest instead of a stale insertion order.

Affected boundary:

- Pricing `Module(...).linkable` generation in the Node module export.
- Pricing portable joiner and static-manifest parity.
- The unchanged module-test runner under PGlite.

Validation:

- `pnpm --filter @medusajs/pricing build` passed.
- A standalone load of the built Pricing module emitted `priceSet`,
  `priceList`, `price`, `pricePreference`, `priceRule`.
- The PGlite Pricing linkable integration file passed: 1 suite and 1 test.
- Pricing static-manifest tests passed: 1 suite and 2 tests, including `prule`
  prefix parity between Node and portable joiner configurations.
- The complete PGlite Pricing calculation file remained green: 1 suite and 42
  tests.

Current limitations:

- The remaining Pricing service integration files still need PGlite audit and
  validation before the whole Pricing module is a fast-lane gate.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Pricing Price Rule PGlite Service Gate

Commit:

- This commit (`test: record PGlite Price Rule service gate`)

The complete unchanged Pricing Price Rule service integration file passes
through the PGlite module-test runner without a Price Rule-specific repository.
The generic PGlite repository behavior implemented by earlier slices already
covers this service boundary.

Affected boundary:

- `@medusajs/pricing` Price Rule service operations through the standard Medusa
  module service and PGlite persistence adapter.
- Generic PGlite scalar mutations, filtering, selected fields, pagination,
  relation hydration, retrieval errors, and soft deletion.

Validation:

- The complete unchanged `price-rule.spec.ts` file passed under
  `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`: 1 suite and 16 tests in about 8
  seconds.
- No Pricing service, model, assertion, or PGlite repository code needed to
  change for this gate.

Current limitations:

- Price List Rule, Price List, Price Set, and the remaining Pricing service
  integration files still need separate PGlite audit and validation.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Pricing Price List Rule PGlite Service Gate

Commit:

- This commit (`test: record PGlite Price List Rule service gate`)

The complete unchanged Pricing Price List Rule integration file passes through
the PGlite module-test runner without a Price List Rule-specific repository.
The generic relation, JSON, mutation, and replacement behavior from earlier
PGlite slices already supports this service boundary.

Affected boundary:

- `@medusajs/pricing` Price List Rule service operations through the standard
  Medusa module service and PGlite persistence adapter.
- JSON rule values, filtering, selected fields, pagination, retrieval errors,
  soft deletion, and the existing set/remove Price List Rule workflows.

Validation:

- The complete unchanged `price-list-rule.spec.ts` file passed under
  `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`: 1 suite and 13 tests in about 7
  seconds.
- No Pricing service, model, assertion, or PGlite repository code needed to
  change for this gate.

Current limitations:

- Price List, Price Set, and the remaining Pricing service integration files
  still need separate PGlite audit and validation.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Pricing Price List PGlite Service Gate

Commit:

- This commit (`test: record PGlite Price List service gate`)

The complete unchanged Pricing Price List integration file passes through the
PGlite module-test runner without a Price List-specific service repository. The
generic PGlite nested mutation and relation behavior already supports this
larger Pricing boundary.

Affected boundary:

- `@medusajs/pricing` Price List service operations through the standard Medusa
  module service and PGlite persistence adapter.
- Date normalization and validation, nested prices and JSON rules, duplicate
  price replacement, selected fields, pagination, relation hydration, soft
  deletion, and add/update/remove Price List price workflows.

Validation:

- The complete unchanged `price-list.spec.ts` file passed under
  `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`: 1 suite and 26 tests in about 8
  seconds.
- No Pricing service, model, assertion, or PGlite repository code needed to
  change for this gate.

Current limitations:

- Price Set and the remaining Pricing service integration files still need
  separate PGlite audit and validation.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Pricing Price Set PGlite Service Gate

Commit:

- This commit (`test: record PGlite Price Set service gate`)

The complete unchanged Pricing Price Set integration file passes through the
PGlite module-test runner without a Price Set-specific repository. The generic
PGlite relation scoping and nested replacement behavior already supports this
final named Pricing service file.

Affected boundary:

- `@medusajs/pricing` Price Set service operations through the standard Medusa
  module service and PGlite persistence adapter.
- Scoped Price Set price hydration, preservation of Price List-owned prices,
  selected fields, pagination, retrieval errors, soft deletion, nested
  create/update/delete, rule operators, equivalent-price replacement, and
  multi-Price-Set additions.

Validation:

- The complete unchanged `price-set.spec.ts` file passed under
  `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`: 1 suite and 28 tests in about 8
  seconds.
- No Pricing service, model, assertion, or PGlite repository code needed to
  change for this gate.

Current limitations:

- All six Pricing integration files have now passed individually under PGlite,
  but they still need one combined package-level run before Pricing can be
  recorded as a complete fast-lane gate.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Complete Pricing PGlite Fast-Lane Gate

Commit:

- This commit (`test: record complete Pricing PGlite gate`)

All unchanged Pricing module integration files now pass together through the
PGlite module-test runner in one serial Jest process. This combined run proves
module reinitialization, schema cleanup, and isolation across the complete
Pricing integration directory rather than relying only on individually green
files.

Accepted Pricing scope:

- Calculation, Price Rules, Price List Rules, Price Lists, Price Sets, and the
  module linkable export.
- Price and Price List rule matching, numeric operators, quantity bounds,
  active windows, sale/override precedence, tax inclusivity, nested mutations,
  scoped relation hydration, soft deletion, selected fields, and pagination.
- The unchanged Pricing service, DML models, public contracts, and integration
  assertions remain the behavioral specification.

Validation:

- PowerShell:
  `$env:MEDUSA_MODULE_TEST_PERSISTENCE='pglite'; $env:NODE_OPTIONS='--experimental-vm-modules'; pnpm --filter @medusajs/pricing test:integration --runInBand`
  passed: 6 suites and 126 tests in about 32 seconds.
- `pnpm --filter @medusajs/pricing build` passed.
- The PGlite adapter regression suite passed: 1 suite and 22 tests.
- The combined run used one Jest process and did not start PostgreSQL, Redis,
  detached shells, or terminal windows.

Current limitations:

- This accepts Pricing as a complete PGlite fast-lane module, not the entire
  Medusa repository. Other modules and cross-module suites retain their own
  recorded gates and limitations.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Cart PGlite Sparse Upsert Owner Fields

Commit:

- This commit (`test: preserve PGlite sparse upsert owner fields`)

The generic PGlite repository now preserves persisted required columns when an
upsert identifies an existing row by primary key but supplies only changed
fields. This supports Cart's unchanged sparse replacement operations without
adding Cart-specific repository or service behavior.

Differences from original Medusa:

- Before preparing an `INSERT ... ON CONFLICT` upsert, the PGlite repository
  loads an existing primary-key row when present.
- Omitted non-null columns are copied from persisted state so owner foreign
  keys such as `shipping_method_id` and `item_id` survive sparse updates.
- `updated_at` is intentionally not copied, allowing the existing mutation
  preparation path to generate the new update timestamp.
- Cart services, models, public contracts, and unchanged integration
  assertions were not modified.

Affected boundary:

- Generic PGlite repository primary-key upsert behavior.
- Cart shipping-method adjustments, line-item tax lines, and shipping-method
  tax lines updated through existing set/replace service methods.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The three focused previously failing Cart sparse-upsert assertions passed.
- The complete unchanged Cart file progressed from 58 passing and 5 failing to
  61 passing and 2 failing out of 63 tests in about 10 seconds.
- The PGlite adapter regression suite passed: 1 suite and 22 tests.

Current limitations:

- Cart still has two independent PGlite failures: negative shipping amounts do
  not yet map to Medusa's check-constraint exception, and the Cart totals result
  still receives projected nested relation rows instead of complete DTO fields.
- Cart is not yet an accepted complete PGlite fast-lane module.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Cart PGlite DML Check Constraints

Commit:

- This commit (`test: enforce PGlite DML check constraints`)

The PGlite schema compiler now preserves existing DML check constraints, and
the repository maps PostgreSQL check violations to the exception name expected
by unchanged Medusa assertions. This fixes Cart's negative shipping amount
behavior without importing MikroORM into the PGlite adapter.

Differences from original Medusa:

- Portable entity metadata now carries DML checks into compiled PGlite table
  metadata.
- Callback checks receive quoted physical column names. Named string checks and
  property checks are also rendered as PostgreSQL `CHECK (...)` constraints.
- PGlite/PostgreSQL error code `23514` is mapped to an `Error` named
  `CheckConstraintViolationException`, matching the existing Drizzle adapter
  boundary and the original MikroORM-visible contract.
- Cart services, models, public contracts, and unchanged integration
  assertions were not modified.

Affected boundary:

- PGlite DML-to-PostgreSQL schema rendering.
- PGlite database error translation.
- Cart shipping method amount validation and Tax named checks.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- A focused adapter regression proved valid checked rows are accepted and
  invalid rows map to `CheckConstraintViolationException`.
- The unchanged negative shipping amount Cart assertion passed.
- The complete unchanged Cart file progressed from 61 passing and 2 failing to
  62 passing and 1 failing out of 63 tests in about 10 seconds.
- The complete PGlite adapter suite passed: 1 suite and 23 tests.
- The complete Tax PGlite integration gate remained green: 2 suites and 35
  tests.

Current limitations:

- Cart's totals assertion is the only remaining PGlite failure. Its nested
  items, adjustments, and shipping methods still receive projected relation
  rows instead of complete DTO fields.
- Cart is not yet an accepted complete PGlite fast-lane module.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Complete Cart PGlite Fast-Lane Gate

Commit:

- This commit (`test: complete Cart PGlite fast-lane gate`)

The complete unchanged Cart module integration suite now passes through the
in-process PGlite lane. Cart totals retain the complete populated item,
adjustment, tax-line, shipping-method, and credit-line DTOs expected by the
existing module contract.

Differences from original Medusa:

- Cart's totals query now explicitly selects every required populated relation
  with `relation.*` in addition to the scalar fields used by totals
  calculation.
- This removes a remaining dependency on MikroORM returning unrequested
  relation columns and preserves the same public result through PGlite and
  Drizzle/SQLite.
- The generic PGlite relation projection rules, Cart models, totals
  calculations, public contracts, and integration assertions were not
  changed.

Affected boundary:

- Cart module totals query field selection.
- Complete Cart module-service validation through PGlite and Drizzle/SQLite.

Validation:

- `@medusajs/cart` build passed.
- The focused unchanged Cart totals assertion passed through PGlite.
- The complete unchanged Cart integration suite through PGlite passed: 1
  suite and 63 tests in about 12 seconds.
- The PGlite adapter regression suite passed: 1 suite and 23 tests.
- The Drizzle package suite passed: 5 files and 60 tests.
- The complete unchanged Cart integration suite through Drizzle/SQLite passed:
  1 suite and 63 tests in about 9 seconds.
- The existing Cart Durable Object SQLite workerd module-set, totals, and
  rollback proof passed.
- All commands used one foreground process at a time and started no PostgreSQL,
  Redis, detached shells, or terminal windows.

Current limitations:

- This accepts Cart as a complete PGlite fast-lane module, not the entire
  Medusa repository. Order remains the next unproven core commerce module.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Order PGlite Serial Generation

Commit:

- This commit (`test: generate PGlite serial columns`)

Order's unchanged creation suite now gets past generated `display_id`
persistence. The PGlite compiler and repository honor DML `serial` columns
without requiring callers to provide their values.

Differences from original Medusa:

- PGlite renders DML `serial` columns as PostgreSQL
  `GENERATED BY DEFAULT AS IDENTITY` columns.
- Mutation validation permits omitted non-null serial values so PostgreSQL can
  generate them, while explicit serial values remain supported.
- Adapter coverage verifies Order-style non-primary display IDs and serial
  primary keys. No Order service, model, public contract, or integration
  assertion was changed.

Affected boundary:

- PGlite DML-to-PostgreSQL serial column rendering.
- PGlite required-value validation for generated serial columns.
- Order, Claim, Exchange, Return, and Order Change Action generated numeric
  fields.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The focused serial regression passed for two implicit non-primary values, an
  explicit non-primary value, and two implicit serial primary keys.
- The complete PGlite adapter suite passed: 1 suite and 24 tests.
- The unchanged Order creation file no longer reports six `display_id` required
  value failures. All six tests advance to the next independent relation graph
  boundary.
- Commands used one foreground Jest process and started no PostgreSQL, Redis,
  detached shells, or terminal windows.

Current limitations:

- The Order creation file remains at 0 of 6 passing tests. Its next shared
  failure is graph replacement rejecting the single `summary` object because
  the DML relation is `hasMany` and the generic PGlite path currently requires
  an array.
- Order is not yet an accepted complete PGlite fast-lane module.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Order PGlite Scalar HasMany Creation

Commit:

- This commit (`test: create scalar PGlite hasMany children`)

Order's unchanged creation suite now gets past the single-object `summary`
graph input. The PGlite repository matches the existing Drizzle create-graph
contract by accepting either one child object or an array when an ordinary
`create` call supplies a `hasMany` relation.

Differences from original Medusa:

- PGlite create-graph relation replacement normalizes one `hasMany` child
  object to a one-element child collection.
- The create-only option propagates through nested relation creation.
- Explicit `upsertWithReplace` remains array-only, preserving replacement
  semantics and matching the Drizzle repository boundary.
- No Order service, DML model, public contract, or integration assertion was
  changed.

Affected boundary:

- PGlite ordinary repository create graphs with `hasMany` child input.
- Order summary graph creation.
- Nested create-graph option propagation.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The focused adapter regression created one scalar `hasMany` child and proved
  that `upsertWithReplace` still rejects scalar replacement input.
- The complete PGlite adapter suite passed: 1 suite and 24 tests.
- The unchanged Order creation file no longer reports six scalar `summary`
  relation failures. All six tests advance to the next independent nested
  graph boundary.
- Commands used one foreground Jest process and started no PostgreSQL, Redis,
  detached shells, or terminal windows.

Current limitations:

- The Order creation file remains at 0 of 6 passing tests. Its next shared
  failure is nested `OrderShipping` creation attempting to insert before its
  required source-owned `shipping_method` has-one target has supplied
  `shipping_method_id`.
- Order is not yet an accepted complete PGlite fast-lane module.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Order PGlite Recursive Create Graphs

Commit:

- This commit (`test: prepare nested PGlite create graphs`)

Order's unchanged creation suite now persists nested shipping-method graphs and
advances from write-side creation into read-side Order transformation. Required
source-owned to-one targets are created before their owning child rows, and the
target's own nested relations are then created recursively.

Differences from original Medusa:

- PGlite `hasMany` child creation prepares the child's source-owned `belongsTo`
  and foreign-key-owning `hasOne` relations before inserting the child.
- Prepared relation data, including generated foreign keys, is reused during
  nested relation replacement instead of creating the target twice.
- Source-owned targets recursively create their own nested relations after the
  owning row is linked.
- No Order service, DML model, public contract, or integration assertion was
  changed.

Affected boundary:

- Recursive PGlite ordinary create graphs.
- Required source-owned to-one foreign keys inside `hasMany` children.
- Order shipping methods and their nested adjustment and tax-line relations.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The focused adapter regression passed for a scalar parent child, its required
  source-owned detail, the detail's required source-owned metadata, and the
  detail's nested scalar note.
- The complete PGlite adapter suite passed: 1 suite and 24 tests.
- The unchanged Order creation file no longer reports six missing
  `shipping_method_id` failures. All six tests complete graph persistence and
  advance to Order read transformation.
- Commands used one foreground Jest process and started no PostgreSQL, Redis,
  detached shells, or terminal windows.

Current limitations:

- The Order creation file remains at 0 of 6 passing tests. Its next shared
  failure is read-side Order transformation receiving `items` without each
  `OrderItem.item` source-owned has-one relation hydrated.
- Order is not yet an accepted complete PGlite fast-lane module.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Order PGlite Owned-To-One Hydration

Commit:

- This commit (`test: expand PGlite owned relation hydration`)

Three of the six unchanged Order creation tests now pass through PGlite.
Populating a wrapper collection such as `Order.items` automatically hydrates
the wrapper's singular foreign-key-owning has-one relation, such as
`OrderItem.item`, before Order DTO transformation.

Differences from original Medusa:

- PGlite relation planning now matches the existing Drizzle owned-to-one
  populate expansion for wrapper models with exactly one foreign-key-owning
  has-one relation.
- Nested relation requests that belong to the owned target are remapped through
  that target, such as `items.tax_lines` to `items.item.tax_lines`.
- Direct nested paths and the established virtual `detail` name retain the
  owned relation needed by Order transformation.
- No Order service, DML model, public contract, or integration assertion was
  changed.

Affected boundary:

- PGlite relation-name planning before root selection and hydration.
- Order item and shipping-method wrapper hydration.
- Nested adjustment and tax-line relation paths through owned targets.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The focused adapter regression proved that requesting only a wrapper
  collection also hydrates its singular owned has-one target.
- The complete PGlite adapter suite passed: 1 suite and 24 tests.
- The unchanged Order creation file progressed from 0 passing and 6 failing to
  3 passing and 3 failing out of 6 tests.
- The complete Product PGlite gate remained green: 10 suites and 205 passing
  tests, with 1 existing skipped test.
- Commands used one foreground Jest process and started no PostgreSQL, Redis,
  detached shells, or terminal windows.

Current limitations:

- Order's three remaining creation-file failures are separate read-query
  boundaries: a selected root relation such as `summary` is not inferred from
  a non-dotted field selection; virtual `detail` scalar projections are not yet
  remapped to wrapper columns; and filters through `items.detail` are not yet
  remapped through the owned target.
- Order is not yet an accepted complete PGlite fast-lane module.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Order PGlite Selected Relation Inference

Commit:

- This commit (`test: infer PGlite relations from selected fields`)

Four of the six unchanged Order creation tests now pass through PGlite.
Selecting a DML relation by name in `fields`, such as `summary`, now populates
that relation before Order DTO transformation.

Differences from original Medusa:

- PGlite field planning now traverses leading field-path segments against the
  actual DML relationships instead of assuming that every dotted prefix is a
  relation.
- Root relation fields and nested relation paths are inferred until the first
  scalar or virtual field segment.
- No Order service, DML model, public contract, or integration assertion was
  changed.

Affected boundary:

- PGlite relation-name planning for repository `find` field selections.
- Root and nested relations selected through `FindOptions.options.fields`.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- A focused adapter regression proved that a relation selected only through
  `fields` is hydrated, including its established owned has-one expansion.
- The focused unchanged Order transaction-summary test passed.
- The complete PGlite adapter suite passed: 1 suite and 24 tests.
- The unchanged Order creation file progressed from 3 passing and 3 failing to
  4 passing and 2 failing out of 6 tests.
- The complete Product PGlite gate remained green: 10 suites and 205 passing
  tests, with 1 existing skipped test.
- Commands used one foreground Jest process and started no PostgreSQL, Redis,
  detached shells, or terminal windows.

Current limitations:

- Order's two remaining creation-file failures are separate virtual-relation
  query boundaries: projecting scalar fields through `items.detail` and
  filtering through `items.detail` are not yet remapped through the wrapper's
  owned target.
- Order is not yet an accepted complete PGlite fast-lane module.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Order PGlite Virtual Detail Projection

Commit:

- This commit (`test: project PGlite virtual relation fields`)

Five of the six unchanged Order creation tests now pass through PGlite.
Selected scalar fields beneath Order's virtual `items.detail` path now retain
the corresponding fields from the actual DML relation target before Order DTO
transformation.

Differences from original Medusa:

- PGlite relation projection now matches the existing Drizzle behavior for
  virtual relation paths backed by scalar fields on the populated target.
- A dotted virtual path such as `detail.fulfilled_quantity` retains the real
  `fulfilled_quantity` target column when that column exists in the DML table.
- Selecting the virtual relation itself retains the complete target row, as
  required by Medusa's existing DTO transformation boundary.
- No Order service, DML model, public contract, query mapping, or integration
  assertion was changed.

Affected boundary:

- PGlite post-hydration projection of selected relation fields.
- Virtual relation names that are not DML relationships but whose requested
  scalar fields are stored on the populated target model.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The focused adapter regression failed before the implementation and passed
  afterward for both a virtual scalar path and whole virtual relation selection.
- The focused unchanged Order requested-fields-and-relations test passed.
- The complete PGlite adapter suite passed: 1 suite and 25 tests.
- The unchanged Order creation file progressed from 4 passing and 2 failing to
  5 passing and 1 failing out of 6 tests.
- The complete Product PGlite gate remained green: 10 suites and 205 passing
  tests, with 1 existing skipped test.
- Commands used one foreground Jest process and started no PostgreSQL, Redis,
  detached shells, or terminal windows.

Current limitations:

- Order's remaining creation-file failure is the separate where-clause path:
  filters through `items.detail` are not yet remapped to scalar conditions on
  the actual DML relation target.
- Order is not yet an accepted complete PGlite fast-lane module.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Order PGlite Virtual Detail Filtering

Commit:

- This commit (`test: filter PGlite virtual relation fields`)

All six unchanged Order creation tests now pass through PGlite. Conditions
beneath Order's virtual `items.detail` path are compiled against the scalar
columns of the actual DML relation target.

Differences from original Medusa:

- PGlite where-clause compilation now matches the existing Drizzle behavior
  for object filters beneath the conventional virtual `detail` boundary.
- Flattening applies only when `detail` is neither a real DML column nor a real
  DML relationship, preserving ordinary relation-filter behavior.
- The same recursive compiler continues to handle operators and logical groups
  inside the flattened object.
- No Order service, DML model, public contract, query mapping, or integration
  assertion was changed.

Affected boundary:

- PGlite repository where-clause compilation inside root and relationship
  subqueries.
- Virtual `detail` objects backed by scalar columns on the current DML table.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The focused adapter filter regression failed with the same unknown-field
  error before the implementation and passed afterward for matching and
  non-matching values.
- The focused unchanged Order where-clause transformation test passed.
- The complete unchanged Order creation file passed: 1 suite and 6 tests.
- The complete PGlite adapter suite passed: 1 suite and 25 tests.
- The complete Product PGlite gate remained green: 10 suites and 205 passing
  tests, with 1 existing skipped test.
- The complete Order PGlite discovery gate reached 4 passing suites out of 9
  and 67 passing tests out of 77.
- Commands used one foreground Jest process and started no PostgreSQL, Redis,
  detached shells, or terminal windows.

Current limitations:

- The complete Order module still has 10 failures in two mutation classes:
  eight flows omit the required `OrderChangeAction.order_id` during relation
  replacement, and two deleted-line-item reads hydrate the owned item as null
  before Order DTO transformation.
- Order is not yet an accepted complete PGlite fast-lane module.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Order PGlite Nested Context Inheritance

Commit:

- This commit (`test: inherit PGlite nested context fields`)

PGlite nested has-many creation now carries matching parent context fields
into child rows. This supplies `OrderChangeAction.order_id` and `version` from
the persisted `OrderChange` when unchanged Order flows create nested actions.

Differences from original Medusa:

- PGlite relation replacement now matches the existing Drizzle rule for
  inheriting `version` and fields ending in `_id` into nested create rows.
- Inheritance is limited to fields present on the target DML table, excludes
  target primary keys, and never overwrites an explicit child value.
- The actual relationship foreign key remains assigned from the persisted
  parent primary key after context inheritance.
- No Order-specific hook, Order service, DML model, public contract, or
  integration assertion was changed.

Affected boundary:

- PGlite nested has-many creation during repository `create` and
  `upsertWithReplace` relation replacement.
- Parent context fields shared by nested target models.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The focused adapter regression failed before the implementation because the
  required child `owner_id` was undefined, then passed with inherited
  `owner_id`, `version`, and the explicit parent relationship foreign key.
- The focused unchanged Order edit flow advanced beyond nested
  `OrderChangeAction` creation and failed later on versioned item state.
- The complete PGlite adapter suite passed: 1 suite and 26 tests.
- The complete Product PGlite gate remained green: 10 suites and 205 passing
  tests, with 1 existing skipped test.
- The complete Order PGlite discovery gate improved from 67 to 68 passing
  tests out of 77, with 4 passing suites out of 9. All prior missing
  `OrderChangeAction.order_id` exceptions were eliminated.
- Commands used one foreground Jest process and started no PostgreSQL, Redis,
  detached shells, or terminal windows.

Current limitations:

- The complete Order module has nine remaining failures: seven action flows
  now reach later versioned order-state behavior, while two deleted-line-item
  reads still hydrate the owned item as null before Order DTO transformation.
- Order is not yet an accepted complete PGlite fast-lane module.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Order PGlite Versioned Relation Hydration

Commit:

- This commit (`test: hydrate current PGlite order versions`)

PGlite now hydrates the current version of Medusa's versioned Order has-many
relations instead of returning every historical child row. Order edit, return,
and exchange flows now read the item, shipping-method, summary, and credit-line
state associated with the parent Order version.

Differences from original Medusa:

- PGlite uses the same version-source rules as the existing Drizzle adapter:
  `Order` relations use `version`, while shipping methods beneath
  `OrderExchange`, `Return`, and `OrderClaim` use `order_version`.
- Version filtering applies only to the established Medusa model/relation
  allowlist and only when the target DML table has a `version` column.
- Repository field selection retains the required source version even when a
  caller requests relation fields without explicitly selecting that version.
- No Order service, DML model, public contract, action logic, or integration
  assertion was changed.

Affected boundary:

- PGlite has-many relation hydration for versioned Order-owned state.
- Root field selection required to evaluate the relation version.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The focused adapter regression failed before the implementation by returning
  both version-1 and version-2 items, then passed with only version 2 whether
  the parent version was explicitly selected or omitted.
- The focused unchanged Order edit test passed.
- The complete unchanged Order edit file passed: 1 suite and 5 tests.
- The complete PGlite adapter suite passed: 1 suite and 27 tests.
- The complete Product PGlite gate remained green: 10 suites and 205 passing
  tests, with 1 existing skipped test.
- The complete Order PGlite gate improved from 68 to 74 passing tests out of
  77, and from 4 to 7 passing suites out of 9. The unchanged edit, return, and
  exchange suites are now green.
- Commands used one foreground Jest process and started no PostgreSQL, Redis,
  detached shells, or terminal windows.

Current limitations:

- The complete Order module has three remaining failures: two deleted-line-item
  reads hydrate an owned item as null, and the claim flow does not yet shape
  additional claim items into the expected `additional_items` relation.
- Order is not yet an accepted complete PGlite fast-lane module.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Order PGlite Inbound Owned-To-One Delete Cleanup

Commit:

- This commit (`test: clean PGlite inbound owned relations`)

Hard-deleting an owned target through PGlite now cleans up inbound
`hasOneWithFK` owners before later reads. Deleting an Order line item therefore
removes its required `OrderItem` wrapper instead of leaving a dangling wrapper
whose `item` relation hydrates as null.

Differences from original Medusa:

- PGlite hard-delete cleanup now recognizes inbound `hasOneWithFK` ownership in
  addition to the existing belongs-to cleanup.
- A non-nullable owned relation deletes the owner row, matching the existing
  Drizzle behavior.
- A nullable owned relation clears the owner's foreign key and retains the
  owner row.
- No Order service, DML model, public contract, formatter, or integration
  assertion was changed.

Affected boundary:

- PGlite repository hard deletes and inbound foreign-key cleanup.
- Required and nullable source-owned has-one relationships.

Validation:

- The focused unchanged Order line-item deletion test passed through the
  existing Drizzle lane as the reference behavior.
- The focused adapter regression failed before the implementation because the
  required owner survived target deletion, then passed after cleanup.
- The adapter regression also proved that nullable owners survive with a null
  foreign key.
- `pnpm --filter @medusajs/test-utils build` passed.
- Both focused unchanged Order `deleteLineItems` tests passed through PGlite.
- The complete PGlite adapter suite passed: 1 suite and 27 tests.
- The complete Order item-and-shipping file passed: 1 suite and 56 tests.
- The complete Product PGlite gate remained green: 10 suites and 205 passing
  tests, with 1 existing skipped test.
- The complete Order PGlite gate improved from 74 to 76 passing tests out of
  77, and from 7 to 8 passing suites out of 9.
- Commands used one foreground Jest process and started no PostgreSQL, Redis,
  detached shells, or terminal windows.

Current limitations:

- The complete Order module has one remaining failure: the claim flow does not
  yet shape additional claim items into the expected `additional_items`
  relation.
- Order is not yet an accepted complete PGlite fast-lane module.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## Order PGlite Sibling Has-Many Alias Creation

Commit:

- This commit (`test: preserve PGlite sibling relation creates`)

The complete unchanged Order integration suite now passes through PGlite.
Nested parent creation preserves child rows inserted through multiple has-many
aliases that share the same target foreign key, allowing Order Claim
`additional_items` and `claim_items` to coexist before DTO formatting.

Differences from original Medusa:

- PGlite parent creation appends nested has-many rows instead of treating each
  relation alias as an independent replacement of all rows under the shared
  target foreign key.
- Update and `upsertWithReplace` operations retain their existing replacement
  semantics; the preservation option is enabled only for repository `create`.
- The behavior is schema-driven and contains no Order Claim model names or
  formatter-specific branches.
- No Order service, DML model, public contract, formatter, or integration
  assertion was changed.

Affected boundary:

- PGlite nested has-many relation persistence during parent creation.
- Multiple relation aliases backed by one target table and foreign key.

Validation:

- `pnpm --filter @medusajs/test-utils build` passed.
- The focused adapter regression failed before the implementation with one of
  two sibling-alias children remaining, then passed with both rows persisted.
- The focused unchanged Order Claim suite passed: 1 suite and 1 test.
- The complete PGlite adapter suite passed: 1 suite and 28 tests.
- The complete Product PGlite gate remained green: 10 suites and 205 passing
  tests, with 1 existing skipped test.
- The complete unchanged Order PGlite gate passed: 9 suites and 77 tests.
- Commands used one foreground Jest process and started no PostgreSQL, Redis,
  detached shells, or terminal windows.

Current limitations:

- Order is now an accepted complete PGlite fast-lane module, but completion of
  the broader PGlite migration still requires a repository-wide module and
  gate audit.
- PGlite remains a fast integration-test lane, not a replacement for the
  authoritative MikroORM/Postgres gate. Redis-backed suites remain separate.

## PGlite Aggregate Integration Runner

Commit:

- This commit (`test: add serial PGlite integration runner`)

The repository now has one root command for the accepted PGlite fast-lane
matrix:

- `pnpm test:integration:pglite`

Differences from original Medusa:

- The runner executes the adapter/selection gate followed by 24 documented
  module integration lanes.
- Lanes run sequentially with exactly one child process active. Windows child
  processes use `windowsHide: true`; the runner does not detach processes or
  open terminal windows.
- The runner sets `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`, enables the opt-in
  adapter tests, and adds Jest's experimental VM-modules option while
  preserving existing `NODE_OPTIONS`.
- `--list`, `--only <lane>`, and `--from <lane>` support inspection, focused
  execution, and fail-fast resume.
- Redis modules, PostgreSQL-only compatibility suites, and Index's separate
  SQLite engine are intentionally absent from the static PGlite matrix.

Affected boundary:

- Root integration-test scripts.
- Serial orchestration of the opt-in PGlite module-test lane.

Validation:

- Node syntax validation passed for
  `scripts/run-pglite-integration-tests.mjs`.
- `--list` reported 25 lanes: adapter/selection plus 24 modules.
- Invalid lane and conflicting option checks exited with status 1.
- `--from=cart --list` selected only Cart and Order.
- The adapter lane passed through the new runner: 2 suites and 32 tests.
- The Currency lane passed through the new runner: 1 suite and 13 tests.
- Prettier validation passed for the runner and root `package.json`.
- Validation started no PostgreSQL, Redis, detached shells, or terminal
  windows.

Current limitations:

- The complete 25-lane aggregate command has not yet been executed as one run.
- CI does not yet invoke the PGlite aggregate command.
- PGlite remains a fast subset lane, not a replacement for the authoritative
  MikroORM/Postgres gate. Redis-backed suites remain separate.

## Complete PGlite Aggregate Matrix

Commit:

- This commit (`test: record complete PGlite matrix`)

The serial aggregate runner completed its first uninterrupted repository-wide
PGlite fast-lane run on July 10, 2026.

Validation:

- `pnpm test:integration:pglite` passed all 25 lanes in 8 minutes 25 seconds.
- The run passed 65 suites and 1,158 tests, with 2 existing skipped tests out
  of 1,160 total tests.
- The final Cart lane passed 1 suite and 63 tests.
- The final Order lane passed 9 suites and 77 tests.
- The runner used one foreground child process at a time and completed without
  starting PostgreSQL, Redis, detached shells, or visible terminal windows.

Affected boundary:

- Aggregate validation evidence only. No Medusa runtime, module service, DML
  model, workflow, API, or test assertion changed in this slice.

Current limitations:

- CI does not yet invoke the PGlite aggregate command.
- The matrix intentionally excludes Redis-backed modules, PostgreSQL-only
  compatibility suites, and Index's separate SQLite engine.
- PGlite remains a fast subset lane, not a replacement for the authoritative
  MikroORM/Postgres gate.

## PGlite CI Gate

Commit:

- This commit (`ci: add serial PGlite integration gate`)

The main Medusa pipeline now runs the accepted PGlite matrix as a dedicated,
resource-bounded job.

Differences from original Medusa:

- The job runs `pnpm test:integration:pglite` without a matrix strategy or
  service containers.
- The committed runner keeps all 25 lanes serial inside the job, so only one
  Jest child process is active at a time.
- A 20-minute job timeout bounds stalled-run resource use.
- The job reuses the pipeline's Node 24/pnpm dependency cache and build
  artifacts from the existing `setup` job.

Affected boundary:

- `.github/workflows/action.yml` PGlite fast-lane validation only.

Validation:

- The workflow YAML parsed successfully with the repository's `js-yaml`
  dependency.
- Prettier and `git diff --check` passed for the workflow and documentation.
- The focused adapter/selection lane passed through the root CI entrypoint: 2
  suites and 32 tests.
- The exact CI command passed locally before this wiring change: 25 lanes, 65
  suites, and 1,158 passing tests in 8 minutes 25 seconds.

Current limitations:

- GitHub-hosted execution still requires confirmation from an actual Actions
  run after this commit is pushed.
- The job intentionally excludes Redis-backed modules, PostgreSQL-only
  compatibility suites, and Index's separate SQLite engine.
- PGlite remains a fast subset lane, not a replacement for the authoritative
  MikroORM/Postgres gate.

## Actual Currency Module Through Drizzle

Commit:

- `6db9a8151c refactor: run actual currency module through drizzle`

The unchanged Currency integration suite now runs through the actual
`CurrencyModuleService` and standard Medusa module loader with either:

- MikroORM/Postgres, which remains the default.
- Drizzle/SQLite, selected by `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`.

Differences from original Medusa:

- `MedusaInternalService` accepts the model prepared by the selected
  persistence adapter instead of converting DML models to MikroORM entities.
- DML primary-key metadata is read directly when the prepared model remains a
  DML entity.
- `@medusajs/drizzle/medusa` provides Currency-required generated repository
  behavior for the real Medusa DAL contract.
- `@medusajs/drizzle/medusa-test` provides an isolated Node SQLite test
  composition using `node:sqlite`.
- The module-test persistence adapter receives its connection when preparing
  the database and module options, avoiding backend-global connection state.

The Drizzle backend entrypoints remain separate from the portable Drizzle
barrel so Node test composition does not enter the portable bundle graph.

Validation:

- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing.
- Drizzle package tests: 2 passing.
- Focused module-test runner tests: 4 passing.
- Focused Medusa internal-service and service tests: 33 passing.
- Affected package builds passed.
- Real Currency service audit: 68 bundled inputs and 0 Worker blockers.
- Cloudflare portability import guard: 124 bundled inputs accepted.

Current limitations:

- The Node SQLite test adapter requires a Node version with `node:sqlite`.
- Drizzle soft delete, restore, and `upsertWithReplace` deliberately throw.
- The Drizzle base repository does not yet provide a real transactional
  session.

## Product Category And Variant Drizzle Slice

Commit:

- `c69760d509 feat: advance Product module Drizzle support`

The Product module now has enough Drizzle repository behavior for the unchanged
Product category suite and Product variant suite to pass under the real Product
module services.

Differences from original Medusa:

- The module container loader allows the selected persistence adapter to replace
  a module custom repository constructor. Drizzle uses this to avoid importing
  Product's MikroORM custom repositories while keeping the original service
  registrations.
- The Drizzle Medusa repository supports the tree-repository calling convention,
  nested create graphs, relation reload after create, selected relation fields,
  null filters, raw update payloads, string-array deletes, and invalid-order
  filtering.
- `ProductCategoryService` keeps MikroORM's custom repository path for the
  default backend, but adds a Drizzle-compatible path for category tree
  creation, read projection, rank reordering, parent moves, descendant `mpath`
  rewrites, and delete validation.
- `ProductModuleService` keeps the existing public API while adding missing
  `@MedusaContext` parameters on Product list and type upsert paths that were
  required by adapter-driven transaction propagation.

Affected boundary:

- Shared module repository registration.
- Drizzle's Medusa DAL implementation.
- Product category tree behavior.
- Product nested create and variant option relation behavior.

Validation:

- `yarn workspace @medusajs/product build` passed.
- `yarn workspace @medusajs/drizzle build` passed.
- `yarn workspace @medusajs/drizzle test`: 36 passing.
- Focused container-loader adapter test: 3 passing.
- `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle yarn workspace @medusajs/product test:integration --runInBand --testPathPattern="integration-tests/__tests__/product-category.spec.ts"` reports:
  - `product-category.spec.ts`: passing.
  - `product-module-service/product-variants.spec.ts`: passing.
  - Remaining failures are suites that still access `MikroOrmWrapper` during
    setup and therefore do not yet run against Drizzle.
- `git diff --check` passed.

Current limitations:

- Several Product integration suites still seed through `MikroOrmWrapper`.
  Their assertions have not yet been converted to backend-neutral setup.
- Product still imports MikroORM-specific repository and event types in some
  source files. Those imports must be removed before Product can enter a Worker
  bundle graph.
- The Drizzle Product path is not yet validated in workerd/D1.

## Product Fixture Portability And Relation Projection

Commit:

- `23b80c5f43 test: make more Product suites Drizzle-ready`

More Product integration suites now run their unchanged assertions through
Drizzle by replacing MikroORM-only test setup with public Product module APIs.

Differences from original Medusa:

- `product-types.spec.ts`, `product-tags.spec.ts`, and
  `product-collections.spec.ts` no longer seed through `MikroOrmWrapper`.
  They create fixtures through `IProductModuleService`.
- Drizzle relation loading now projects loaded relation rows according to
  nested Medusa `select` paths.
- Drizzle hard delete detaches non-cascade FK-backed `hasMany` children by
  nulling owner foreign keys before deleting the parent row.

Affected boundary:

- Product integration fixture setup.
- Drizzle relation projection for selected nested relations.
- Drizzle delete behavior for nullable FK-backed `hasMany` relations.

Validation:

- `yarn workspace @medusajs/product build` passed.
- `yarn workspace @medusajs/drizzle build` passed.
- `yarn workspace @medusajs/drizzle test`: 36 passing.
- `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle yarn workspace @medusajs/product test:integration --runInBand --testPathPattern="integration-tests/__tests__/product-category.spec.ts"` reports:
  - `product-category.spec.ts`: passing.
  - `product-module-service/product-variants.spec.ts`: passing.
  - `product-module-service/product-types.spec.ts`: passing.
  - `product-module-service/product-tags.spec.ts`: passing.
  - `product-module-service/product-collections.spec.ts`: passing.
  - Remaining failures are suites that still access `MikroOrmWrapper` during
    setup.
- `git diff --check` passed.

Current limitations:

- `product-options.spec.ts`, `product-categories.spec.ts`, `events.spec.ts`,
  and `products.spec.ts` still request `MikroOrmWrapper` during setup.
- Product is still not Worker-bundle clean because some source files still
  import MikroORM-specific classes and repositories.

## Product Options And Category Fixture Portability

Commit:

- `2ec26fd934 test: make Product category fixtures Drizzle-ready`

The Product options and Product categories module-service suites now use the
real `IProductModuleService` APIs for fixture setup instead of constructing
MikroORM entities directly.

Differences from original Medusa:

- `product-options.spec.ts` creates products and options through the module
  service before running the original assertions.
- `product-categories.spec.ts` creates products and category-product links
  through the module service before running the original assertions.
- `ProductCategoryService` now applies the same default category ordering that
  the MikroORM custom repository provided when the selected backend does not
  use that repository.
- `ProductCategoryService` preserves already-loaded relation roots while
  applying tree transforms, so selected relation fields such as
  `products.title` survive the backend-neutral transform path.
- Filtered-out ancestor categories are represented as `parent_category:
undefined`, matching the existing assertion shape when scoped tree filters
  hide an ancestor.

Affected boundary:

- Product integration fixture setup.
- Product category backend-neutral tree projection and ordering.

Validation:

- `yarn workspace @medusajs/product build` passed.
- `yarn workspace @medusajs/drizzle test`: 36 passing.
- `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle yarn workspace @medusajs/product test:integration --runInBand --testPathPattern="integration-tests/__tests__/product-category.spec.ts"` reports:
  - `product-category.spec.ts`: passing.
  - `product-module-service/product-variants.spec.ts`: passing.
  - `product-module-service/product-types.spec.ts`: passing.
  - `product-module-service/product-tags.spec.ts`: passing.
  - `product-module-service/product-collections.spec.ts`: passing.
  - `product-module-service/product-options.spec.ts`: passing.
  - `product-module-service/product-categories.spec.ts`: passing.
  - Remaining failures are setup-only `MikroOrmWrapper` access in
    `product.spec.ts`, `product-module-service/products.spec.ts`, and
    `product-module-service/events.spec.ts`.
- `git diff --check` passed.

Current limitations:

- The focused default MikroORM Jest command for the two touched Product suites
  timed out locally after three minutes before producing useful output. The
  Product package build passed, but default runtime assertions should be
  rerun with a known-good local PostgreSQL test cluster.
- Product is still not Worker-bundle clean because some source files still
  import MikroORM-specific classes and repositories.

## Actual Currency Service In Workerd/D1

Commit:

- `8614ca9053 feat: run actual currency module in workerd`

The Cloudflare application no longer runs the temporary portable Currency
service. It statically composes the actual `CurrencyModuleService`, generated
`MedusaInternalService`, standard repository registration, and Drizzle Medusa
persistence adapter against a D1 binding.

Differences from original Medusa:

- The Worker application root explicitly supplies the Currency model, module
  service, persistence adapter, and D1 manager instead of using filesystem
  discovery.
- Shared runtime files use precise imports and type-only imports so Node-only
  barrels and MikroORM event constants are absent from the Worker graph.
- Portable filter-key constants are shared by MikroORM and adapter-independent
  query construction.
- The application aliases Awilix to its browser build at Worker composition.
- The Worker app includes a D1 binding, Currency migration, composed import
  guard, and repeatable workerd runtime check.

Validation:

- `yarn workspace medusa-cloudflare test:workerd`: actual Currency service
  returned the seeded USD row from local D1 inside workerd.
- Composed Currency Worker import guard: 199 bundled inputs, no Node or
  MikroORM blockers.
- Production Worker build: 205 transformed modules, 327.37 kB.
- Unchanged Currency suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency suite through MikroORM/Postgres: 13 passing.
- Cloudflare app tests: 2 passing.
- Focused shared loader and Medusa service tests: 35 passing.

Current limitations:

- Static composition bypasses Medusa's filesystem-based `MedusaModule`
  bootstrap and does not yet provide a generated reusable module manifest.
- The original Currency initial-data loader is not composed in workerd; the D1
  migration seeds the runtime proof row.
- The workerd check exercises real read behavior; remaining mutations,
  transactions, soft delete, restore, and replace-upsert still require
  implementation and tests.

## Next Persistence Slice

The first Currency acceptance gate is complete. Before migrating a second
module:

- Add workerd coverage for the next required repository mutations and real D1
  transaction semantics.
- Implement schema-diff migration generation before treating a D1 database as
  an upgradeable deployed environment.

## Generated DML-To-D1 Baseline

Commit:

- `aa62992840 feat: generate D1 migrations from Medusa DML`

The Drizzle package now renders deterministic SQLite/D1 schema SQL from the
existing compiled Medusa DML schema. The Cloudflare app generates and checks
its Currency schema migration from the actual Currency DML model instead of
maintaining a parallel hand-authored table definition.

The Node SQLite module-test adapter uses the same renderer, so the unchanged
Currency assertions and the Worker migration consume one schema boundary.
Currency seed data remains a separate app-owned migration because it is data,
not DML schema metadata.

Validation:

- Drizzle package build and tests: 3 passing.
- Generated migration drift check: passing.
- Generated migrations applied and inspected through Wrangler against a fresh
  local D1 database.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing
  using an isolated temporary PostgreSQL cluster.
- Cloudflare app type-check and tests: 2 passing.
- Actual Currency workerd/D1 runtime check: passing.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.

## Actual Currency Service Through Durable Object SQLite

Commit:

- `ba74b53d24 feat: run Currency service in Durable Object`

The atomic Durable Object manager is now selected beneath the actual
`CurrencyModuleService` through the existing static `MedusaModule.bootstrap`
composition. D1 and DO SQLite reuse one manager-driven Currency runtime helper.

The DO proof no longer reaches directly into the Drizzle repository. Its
service calls prove:

- normal service-level create and list behavior;
- transaction manager propagation through the existing Medusa context;
- nested transaction callback reuse;
- read-your-own-writes through the service;
- multi-write rollback; and
- service-level cleanup.

This validates the intended adapter boundary without adding replacement
services or duplicate module assertions.

Validation:

- `@medusajs/drizzle` build and 26 tests passed.
- `@medusajs/drizzle-cloudflare` build passed.
- Unchanged Currency integration assertions through Drizzle/SQLite: 13
  passing.
- Actual Currency module service DO SQLite workerd proof passed.
- Existing Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 229 transformed modules, 445.23 kB.
- Composed Worker guard: 333 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.

## Durable Object Async Transaction Correction

Commit:

- `5c1910a4ea feat: make Durable Object transactions atomic`

The Cloudflare Drizzle manager now executes the existing async Medusa manager
transaction callback inside `DurableObjectStorage.transaction`. The earlier
prototype used only `transactionSync` for Drizzle batches and incorrectly
reported the manager callback as merely `object-serialized`.

Differences from the initial prototype:

- The Durable Object manager now reports `atomic`.
- The transaction-scoped manager reuses the active storage transaction for
  nested manager callbacks.
- No staged statement executor or replacement repository API was required.
- Shared Drizzle transaction modes return to `atomic | statement`; the
  temporary `object-serialized` mode was removed.

The focused workerd proof now performs two repository writes, including one
through a nested manager transaction callback, reads both writes inside the
active transaction, throws, and confirms both writes were rolled back.

This proves the persistence boundary required for the next module behavior. It
does not define the future hosted platform's tenant or partition topology.

Remaining boundary:

- Durable Object storage transaction callbacks may be retried. Persistence
  operations are safe inside this boundary, but external side effects and
  event publication must remain outside the callback or be idempotent.

Validation:

- `@medusajs/drizzle` build and 26 tests passed.
- `@medusajs/drizzle-cloudflare` build passed.
- Unchanged Currency integration assertions through Drizzle/SQLite: 13
  passing.
- Durable Object SQLite workerd proof passed multi-write read-your-own-writes,
  nested transaction callback, and rollback behavior.
- Existing D1 workerd Currency mutation proof passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 229 transformed modules, 445.19 kB.
- Composed Worker guard: 333 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- Production Worker build: 222 transformed modules, 385.69 kB.

Current limitation:

- This generates a deterministic baseline schema, not diffs between schema
  versions. Existing experimental local D1 databases that already recorded the
  old `0001_currency.sql` must be reset and recreated. Future deployed schema
  changes require a schema-diff migration boundary rather than rewriting an
  applied migration.

## First Cart Drizzle Compatibility Slice

Commit:

- `bda8a75828 feat: add first Cart Drizzle compatibility slice`

The unchanged Cart module integration suite is now the acceptance surface for
the next shared persistence work. This slice audited the full suite and fixed
the first Drizzle-wide blockers without adding a Cart-specific service or
Cloudflare-specific Cart implementation.

Differences from original Medusa:

- The Drizzle Medusa repository now persists DML `bigNumber` fields as both
  their numeric column and Medusa-compatible `raw_<field>` JSON value.
- Drizzle repository filters now translate direct `belongsTo` primary-key
  filters and nested owner-side `belongsTo` filters through the compiled DML
  relationship graph.
- The Drizzle module-test database reset temporarily disables SQLite foreign
  key enforcement while clearing all module tables, so reset behavior does not
  depend on model declaration order.
- Portable Drizzle code imports `trimZeros` and `BigNumber` through precise
  utility entrypoints. The Cloudflare app aliases those same precise
  entrypoints without importing the broad utils barrel.

Measured unchanged Cart suite progress:

- Before this slice: 2 passing, 61 failing.
- After this slice: 54 passing, 9 failing.

The remaining failures define later narrow compatibility slices:

- Required DML property validation and matching Medusa error messages.
- Nested address creation.
- Check-constraint error translation.
- Preservation of existing owner foreign keys during nested replacement.
- Cart totals parity.

Validation:

- `@medusajs/utils` and `@medusajs/drizzle` builds passed.
- Drizzle package tests: 28 passing.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Cart integration suite through Drizzle/SQLite: 54 passing and 9
  failing, with the remaining failures listed above.
- `@medusajs/drizzle-cloudflare` build passed.
- Cloudflare app type-check and 2 tests passed.
- Durable Object SQLite and D1 workerd runtime proofs passed.
- Composed Worker and strict real-module import guards passed.
- Production Worker build passed.

Next persistence slice:

- Implement required DML property validation at the shared Drizzle repository
  boundary and preserve Medusa's existing validation error semantics.

## Drizzle Required DML Property Validation

Commit:

- `eb7207b670 feat: validate required Drizzle DML properties`

The Drizzle Medusa repository now validates required stored DML properties
before executing a write. This preserves the existing Medusa/MikroORM
validation behavior used by unchanged module service assertions.

Differences from original Medusa:

- Required-property validation is derived from portable DML metadata at the
  Drizzle persistence boundary.
- Missing or null non-nullable scalar values fail with the existing Medusa
  message shape, including the DML entity and field name.
- Nullable, computed, defaulted, generated ID, timestamp, and autoincrement
  properties keep their existing behavior.
- Relationships are not treated as stored scalar properties by this
  validation.

Measured unchanged Cart suite progress:

- Before this slice: 54 passing, 9 failing.
- After this slice: 57 passing, 6 failing.

Validation:

- Drizzle package build and tests: 29 passing.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Cart integration suite through Drizzle/SQLite: 57 passing and 6
  failing.
- Cloudflare app type-check and 2 tests passed.
- Durable Object SQLite and D1 workerd runtime proofs passed.
- Composed Worker and strict real-module import guards passed.
- Production Worker build passed.

Next persistence slice:

- Implement nested creation for the Cart billing and shipping address
  relationships through the shared Drizzle `upsertWithReplace` path.

## Drizzle Owner-Side Singular Relation Creation

Commit:

- `73733162fd feat: create Drizzle owner-side singular relations`

The shared Drizzle Medusa repository now creates owner-side singular relation
targets before writing the source row and assigns the created target key to the
source foreign-key columns. This preserves the unchanged Cart service path for
nested billing and shipping address creation.

Differences from original Medusa:

- Standard repository `create` handles nested owner-side `belongsTo` and
  `hasOneWithFK` values using compiled DML relationship metadata.
- `upsertWithReplace` supports the same owner-side singular relation shape,
  including creation, existing-target update, hydration, and performed-action
  reporting.
- Singular relation values remain limited to an object or null. Deeper nested
  relation values are still rejected.
- The target write occurs before the source write. It is atomic when the
  selected manager provides an atomic transaction boundary. D1 statement mode
  cannot roll back a created target if a later source write fails.

Measured unchanged Cart suite progress:

- Before this slice: 57 passing, 6 failing.
- After this slice: 58 passing, 5 failing.

Validation:

- Drizzle package build and tests: 30 passing.
- Focused unchanged Cart nested billing/shipping address assertion passed.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Cart integration suite through Drizzle/SQLite: 58 passing and 5
  failing.
- Cloudflare app type-check and 2 tests passed.
- Durable Object SQLite and D1 workerd runtime proofs passed.
- Composed Worker and strict real-module import guards passed.
- Production Worker build passed.

Next persistence slice:

- Translate SQLite/Drizzle check-constraint failures to the existing Medusa
  error shape expected by the unchanged Cart shipping-method assertion.

## Drizzle DML Check Constraints

Commit:

- `70071e19f7 feat: render Drizzle DML check constraints`

The Drizzle schema compiler and D1 renderer now preserve Medusa DML
`checks()` definitions as named SQLite/D1 `CHECK` constraints. Drizzle
mutation statements also map SQLite check failures to an error named
`CheckConstraintViolationException`, matching the unchanged Cart assertion
without importing MikroORM into the portable Drizzle graph.

Differences from original Medusa:

- DML check callbacks are evaluated against quoted generated SQLite column
  names, including relationship foreign-key columns added by the Drizzle
  compiler.
- The D1 renderer emits table-level named `CHECK` constraints.
- Drizzle mutation error mapping recognizes direct SQLite check failures and
  Drizzle-wrapped failures via a narrowed `cause` boundary.
- Other database errors remain unmapped and continue to surface as their
  underlying SQLite/Drizzle errors for later compatibility slices.

Measured unchanged Cart suite progress:

- Before this slice: 58 passing, 5 failing.
- After this slice: 59 passing, 4 failing.

Remaining unchanged Cart failures:

- Nested replacement must preserve existing owner foreign keys for shipping
  method adjustments.
- Nested replacement must preserve existing owner foreign keys for line item
  tax lines.
- Nested replacement must preserve existing owner foreign keys for shipping
  method tax lines.
- Cart totals parity.

Validation:

- Drizzle package build and tests: 33 passing.
- Focused unchanged Cart negative shipping amount assertion passed.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Cart integration suite through Drizzle/SQLite: 59 passing and 4
  failing.
- Cloudflare app type-check and 2 tests passed.
- Durable Object SQLite and D1 workerd runtime proofs passed.
- Composed Worker and strict real-module import guards passed.
- Production Worker build passed.

Next persistence slice:

- Preserve existing owner foreign keys when nested replacement updates or
  creates rows that belong to an existing parent relation.

## Drizzle Sparse Upsert Owner-FK Preservation

Commit:

- `56c1fd7bca feat: preserve Drizzle sparse upsert owner FKs`

The Drizzle repository now treats `upsert` with a complete primary key as a
partial update when the target row already exists. It reads the existing row,
merges the incoming sparse payload over it, and then executes the existing
upsert write. This preserves generated owner foreign keys such as `item_id`
and `shipping_method_id` when Medusa services update nested adjustment and tax
line rows by id.

Differences from original Medusa:

- MikroORM already preserves existing relation columns when a sparse entity is
  assigned and flushed. Drizzle now reproduces that behavior at the repository
  boundary for existing rows.
- New upserts without an existing row still need their required generated
  owner foreign keys supplied by the caller or relation replacement path.
- The change is shared repository behavior; Cart services and assertions are
  unchanged.

Measured unchanged Cart suite progress:

- Before this slice: 59 passing, 4 failing.
- After this slice: 62 passing, 1 failing.

Remaining unchanged Cart failure:

- Cart totals parity.

Validation:

- Drizzle package build and tests: 33 passing.
- Focused unchanged Cart adjustment and tax-line replacement assertions
  passed.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Cart integration suite through Drizzle/SQLite: 62 passing and 1
  failing.
- Cloudflare app type-check and 2 tests passed.
- Durable Object SQLite and D1 workerd runtime proofs passed.
- Composed Worker and strict real-module import guards passed.
- Production Worker build passed.

Next persistence slice:

- Audit Cart totals parity and decide whether the remaining difference is
  relation hydration, BigNumber serialization, or total calculation inputs.

## Drizzle Explicit Empty Field Selection And Cart Totals Parity

Commit:

- `1282a90858 feat: preserve Drizzle explicit empty field selection`

The Drizzle repository now distinguishes an omitted field selection from an
explicit empty field selection. When Medusa passes no `fields` option, Drizzle
continues to select all scalar columns. When Medusa explicitly passes
`fields: []`, Drizzle selects only the model primary keys so relation loading
still has identity columns but unrelated scalar properties do not leak into the
returned entity.

This matches the Cart totals path. `CartModuleService` removes requested
calculated totals from `select`, adds the relations needed to compute totals,
and then decorates the returned object. The previous Drizzle fallback converted
that explicit empty scalar selection into `select *`, so calculated-total
responses included persisted Cart base columns that MikroORM did not return.

Differences from original Medusa:

- MikroORM already preserves this shape when a calculated-field request leaves
  only populated relations plus identity. Drizzle now reproduces that shape at
  the repository boundary.
- A missing `fields` option still means all scalar fields, preserving the
  default repository behavior.
- Cart services, totals logic, and integration assertions are unchanged.

Measured unchanged Cart suite progress:

- Before this slice: 62 passing, 1 failing.
- After this slice: 63 passing, 0 failing.

Validation:

- Drizzle package build and tests: 33 passing.
- Focused unchanged Cart totals assertion passed.
- Unchanged Cart integration suite through Drizzle/SQLite: 63 passing.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Cloudflare app type-check and 2 tests passed.
- Durable Object SQLite and D1 workerd runtime proofs passed.
- Composed Worker and strict real-module import guards passed.
- Production Worker build passed.

Next persistence slice:

- Use the green unchanged Cart suite as the baseline before adding the first
  Cart-oriented Durable Object SQLite vertical slice.

## Cart Durable Object SQLite Proof Slice

Commit:

- `cf859c5c37 feat: add Cart DO SQLite proof`

The Cloudflare app now includes a `CartProofDO` alongside the existing
`CurrencyProofDO`. The Cart proof compiles the real Cart DML models into a
Durable Object SQLite schema, bootstraps the actual Cart module service through
`MedusaModule.bootstrap`, and uses the shared Drizzle manager path. The proof
creates a cart, adds a line item and shipping method, retrieves calculated
totals, and verifies atomic rollback through the Cart service using
transaction context propagation.

Differences from original Medusa:

- Cart now has a static module manifest so the Cloudflare composition can
  bootstrap it without filesystem discovery.
- Cart service module-local aliases were changed from `@models` and `@types`
  to relative imports so multiple Medusa modules can coexist in one Worker
  bundle without alias collisions.
- The Cloudflare app has an app-local `@medusajs/framework/utils` shim for the
  narrow portable utility surface needed by Cart. This is a proof boundary, not
  the final shared framework runtime.
- The shim contains a minimal Cart totals decorator for the proof scenario
  only. Full Medusa totals portability remains a follow-up; the unchanged Cart
  module suite still validates the real totals implementation through the
  package path.

Validation:

- Cart package build passed.
- Drizzle package build and tests: 33 passing.
- Unchanged Cart integration suite through Drizzle/SQLite: 63 passing.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Cloudflare app type-check and 2 tests passed.
- Composed Worker import guard passed with 356 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed.
- New Cart Durable Object SQLite workerd proof passed for totals and atomic
  rollback.
- Production Worker build passed: 508.24 kB, gzip 108.00 kB.

Next persistence slice:

- Replace the app-local proof-only Cart totals shim with a portable shared
  totals path, or expand the Cart DO proof to the next real Cart operation
  after deciding the minimum non-duplicative acceptance surface.

## Portable Shared Cart Totals In Worker

Commit:

- `bfb62a9791 feat: make Cart totals portable in Worker`

The Cart Durable Object proof now imports the real shared Medusa totals helpers
from `@medusajs/utils` instead of using an app-local minimal totals decorator.
The changed totals files use type-only DTO imports and leaf `common/*` utility
imports so the Worker bundle can include `decorateCartTotals` and
`createRawPropertiesFromBigNumber` without pulling broad Node-oriented utility
barrels into the Cloudflare import graph.

Differences from original Medusa:

- The shared totals implementation remains Medusa's real totals logic; only its
  import graph was narrowed for Worker portability.
- `apps/medusa-cloudflare` no longer carries the proof-only Cart totals shim.
- `@medusajs/utils/totals/cart` and
  `@medusajs/utils/totals/create-raw-properties-from-bignumber` are the Worker
  composition points for Cart totals in the proof app.

Affected boundary:

- Cart service totals behavior.
- Shared `@medusajs/utils` totals helper import graph.
- Cloudflare Worker bundle portability for the Cart DO proof.

Validation:

- Focused `@medusajs/utils` totals tests: 21 passing.
- `@medusajs/utils` build passed.
- Drizzle package build and tests: 33 passing.
- Unchanged Cart integration suite through Drizzle/SQLite: 63 passing.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Cloudflare app type-check and 2 tests passed.
- Composed Worker import guard passed with 367 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed.
- Cart DO SQLite workerd proof passed with the real shared totals helpers.
- Production Worker build passed: 551.81 kB, gzip 116.73 kB.

## Cart Durable Object Adjustments And Tax Lines

Commit:

- `2e5ede30d2 test: expand Cart DO aggregate proof`

The Cart Durable Object proof now exercises a deeper Cart aggregate mutation
path through the actual Cart module service. The scenario still creates a cart,
line item, and shipping method, then also sets line item adjustments, line item
tax lines, shipping method adjustments, and shipping method tax lines before
retrieving totals.

Differences from original Medusa:

- No Cart service logic was replaced. The proof calls the existing Cart module
  service methods inside workerd using DO-local SQLite.
- The proof now verifies discount-before-tax totals semantics in the Worker:
  item total `300 - 30 + 10% = 297`, shipping total `25 - 5 + 10% = 22`, grand
  total `319`.
- The rollback proof remains unchanged and still verifies atomic rollback
  through the Cart service transaction context.

Affected boundary:

- Cart DO-local SQLite aggregate proof.
- Cart adjustment and tax-line persistence through the Drizzle manager.
- Real Cart totals after adjustment and tax-line relations are written in
  workerd.

Validation:

- Existing Cart integration suite through Drizzle/SQLite: 63 passing.
- Cloudflare app type-check and 2 tests passed.
- Composed Worker import guard passed with 369 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Cart DO SQLite workerd proof passed for adjustments, tax lines, totals, and
  atomic rollback.
- Production Worker build passed: 550.60 kB, gzip 116.20 kB.

## Explicit Transaction Semantics And D1 Mutations

Commit:

- `c3a0cc5052 feat: validate D1 mutations and transaction semantics`

The Drizzle Medusa manager now owns and declares its transaction behavior.
`DrizzleMedusaBaseRepository.transaction` delegates to that selected manager
instead of silently invoking the callback without a transaction boundary.

The two current compositions deliberately differ:

- The Node SQLite module-test manager declares `atomic` semantics and uses real
  SQLite transactions and nested savepoints.
- The D1 manager declares `statement` semantics because D1 rejects interactive
  SQL `BEGIN`, `COMMIT`, and `SAVEPOINT` transactions. Individual statements
  are atomic, but a Medusa callback containing multiple statements is not.

The workerd proof now calls the actual generated Currency service to read,
create, and update D1 rows. The Worker also exposes the selected transaction
mode so the limitation is visible to composition and tests.

Validation:

- Drizzle package build and tests: 4 passing, including rollback, commit, and
  nested-savepoint rollback coverage.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing
  using an isolated temporary PostgreSQL cluster.
- Actual Currency service read/create/update through workerd/D1: passing.
- Cloudflare app type-check and tests: 2 passing.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- Production Worker build: 222 transformed modules, 387.47 kB.

Current limitations:

- D1 statement mode does not provide atomic rollback for arbitrary Medusa
  transaction callbacks. Multi-statement operations must be redesigned around
  supported D1 batch operations, Durable Object transaction boundaries, or
  explicit compensation.
- The generated delete path still directly dispatches through a MikroORM event
  manager and is the next mutation portability blocker.

## Adapter-Driven Module Migrations

Commit:

- `b7f8ead739 refactor: make module migrations adapter-driven`

The shared Medusa module migration loader no longer directly chooses MikroORM
migration script builders. Application or module composition can now select a
`ModuleMigrationAdapter` independently from its `ModulePersistenceAdapter`.

The MikroORM migration adapter remains the Node default and wraps the original
Medusa migration generation, run, and revert scripts. Existing module
MikroORM/Postgres migration histories remain unchanged.

The Drizzle package now provides a Node-only SQLite baseline migration adapter.
Currency owns its checked-in Drizzle SQLite baseline at:

```text
packages/modules/currency/src/migrations/drizzle-sqlite/0001_currency.sql
```

Currency's build copies the SQL history into `dist/migrations`. The Cloudflare
app verifies the module-owned baseline against Currency DML and aggregates the
same file into Wrangler's flat application migration directory. App seed data
remains app-owned.

Support matrix:

- MikroORM/Postgres migration generation, run, and revert: supported through
  the preserved original adapter.
- Drizzle SQLite baseline generation and module-owned packaging: supported.
- D1 application aggregation and Wrangler execution: supported.
- Drizzle SQLite migration execution through `MedusaModule.migrateUp`: not yet
  implemented; it fails loudly without a target-specific runner.
- Drizzle Postgres schema rendering, repositories, and migrations: not yet
  implemented.
- Historical schema-diff generation after the baseline: not yet implemented.

Validation:

- `@medusajs/types`, `@medusajs/utils`, `@medusajs/modules-sdk`, Drizzle, and
  Currency builds passed.
- Full modules-sdk suite: 76 passing, including selected migration adapter and
  static-resource migration-path coverage.
- Drizzle package tests: 5 passing.
- Currency build packages the module-owned Drizzle SQLite SQL history.
- Generated migration drift check and fresh Wrangler local D1 migration test
  pass.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing
  using an isolated temporary PostgreSQL cluster.
- Actual Currency workerd/D1 runtime, import guards, and production build pass.

## Adapter-Driven Mutation Event Dispatch

Commit:

- `3d28423c76 refactor: make mutation event dispatch adapter-driven`

`MedusaInternalService` no longer imports or calls MikroORM event-manager APIs
when registering subscribers or manually dispatching mutation events. The
selected `ModulePersistenceAdapter` now owns:

- Creating mutation subscribers.
- Registering subscribers with its backend when required.
- Manually dispatching mutation events for direct repository delete and
  `upsertWithReplace` operations.

The MikroORM adapter preserves event-manager registration and dispatch. Its
unavoidable event-shape assertions are isolated inside the concrete MikroORM
helper. The Drizzle adapter uses a portable subscriber and directly forwards
manual mutation events to the existing Medusa module service.

Actual Currency delete now runs through the unchanged generated Medusa service
inside workerd/D1.

Validation:

- Focused Medusa internal-service tests: 20 passing.
- Focused Medusa service tests: 14 passing.
- Full modules-sdk suite: 76 passing.
- Drizzle package tests: 5 passing.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing
  using an isolated temporary PostgreSQL cluster.
- Actual Currency read/create/update/delete through workerd/D1: passing.
- Cloudflare app type-check and tests: 2 passing.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- Production Worker build: 222 transformed modules, 388.67 kB.

Current limitation:

- Drizzle `upsertWithReplace` remains unimplemented. Drizzle soft-delete and
  restore are implemented for relationless models, but relation cascade
  traversal and ORM-managed mutation-event emission still require a portable
  design.

## Drizzle Soft Delete And Restore

Commit:

- `60111e27db feat: add Drizzle soft delete and restore`

The generated Drizzle Medusa repository now implements the existing
`RepositoryService.softDelete` and `RepositoryService.restore` contracts for
relationless DML models such as Currency.

Differences from original Medusa:

- String primary keys and object filters are normalized into the same
  primary-key-aware `$or` shape used by the MikroORM repository.
- Soft delete updates `deleted_at` and `updated_at`, excludes already deleted
  rows, and returns the affected entities plus the Medusa model-name map.
- Restore clears `deleted_at`, updates `updated_at`, and returns the same
  affected-model map.
- The Cloudflare proof app exposes the existing generated
  `softDeleteCurrencies` and `restoreCurrencies` methods only for runtime
  verification. No parallel Currency service was added.

Validation:

- Drizzle package build and tests: 6 passing.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing
  using an isolated temporary PostgreSQL cluster.
- Actual Currency read/create/update/soft-delete/restore/delete through
  workerd/D1: passing.
- Cloudflare app type-check and tests: 2 passing.
- Generated migration drift check and fresh local D1 migration test: passing.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- Production Worker build: 222 transformed modules, 390.51 kB.

Current limitations:

- MikroORM recursively follows relationships configured with `soft-remove`.
  Drizzle currently updates only the selected root model and therefore is not
  yet valid for relation-cascading modules.
- Drizzle create, update, soft-delete, and restore do not yet reproduce
  MikroORM's ORM-managed subscriber emission. Direct delete manual dispatch
  remains supported.
- D1 remains in explicit non-atomic `statement` transaction mode.

- Drizzle `upsertWithReplace` remains unimplemented.

## Portable DML Relationship Metadata

Commit:

- `5d7b24f84e feat: preserve DML relationship metadata for Drizzle`

The portable DML structural contract and Drizzle schema compiler now accept
actual Medusa DML relationship members instead of assuming every schema member
is a scalar property.

Differences from original Medusa:

- The portable DML contract represents relationship metadata and entity-level
  `delete` and `detach` cascade declarations without importing MikroORM.
- The Drizzle compiler excludes relationship members from physical columns and
  emits deterministic relationship records containing:
  - Relationship type, target model, and snake-case target table.
  - `mappedBy`, nullability, and whether the relation is in the model's delete
    cascade.
  - Custom foreign-key name.
  - Pivot model/table and join-column metadata where configured.
- Executable DML callbacks are resolved at compilation and are not retained in
  the compiled schema.
- Physical table names use the same camel-to-snake naming behavior required by
  actual Medusa models such as `Store`, `StoreCurrency`, and `StoreLocale`.

Validation:

- Portable DML and Drizzle package builds passed.
- Drizzle package tests: 7 passing, including a real Medusa DML parent/child
  relationship graph.
- Actual Store model graph compiled with `supported_currencies` and
  `supported_locales` mapped as delete cascades to `store_currency` and
  `store_locale`.
- Store package build passed.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing
  using an isolated temporary PostgreSQL cluster.
- Actual Currency workerd/D1 mutation runtime passed.
- Generated Currency migration drift and fresh D1 migration checks passed.
- Cloudflare Worker import guards and production build passed.

Current limitations:

- Compiled single-column relationship ownership is rendered as foreign-key
  columns and constraints in Drizzle SQLite/D1 schemas as of `454485fce7`.
- Drizzle repositories do not yet load relationships or recursively apply
  soft-delete/restore cascades.
- Many-to-many detach behavior is metadata-only.

## Drizzle Relationship Foreign Keys

Commit:

- `454485fce7 feat: generate Drizzle relationship foreign keys`

The Drizzle schema compiler now turns ownership-safe relationship metadata into
physical SQLite/D1 schema shape.

Differences from original Medusa:

- `belongsTo` and `hasOneWithFK` relationships generate a concrete foreign-key
  column on the owning table.
- Custom `foreignKeyName` values are respected; otherwise the compiler uses
  Medusa's `{relationship_name}_id` naming style.
- The generated column uses the referenced primary-key column's portable type
  and the relationship's nullability.
- A non-unique index is generated for the foreign-key column.
- D1 migrations render table-level foreign-key constraints.
- If the inverse parent relation is configured in the model's delete cascade,
  the generated constraint includes `ON DELETE CASCADE`.
- The actual Store graph now compiles `store_currency.store_id` and
  `store_locale.store_id` with cascade constraints to `store.id`.

Validation:

- Drizzle package build and tests: 8 passing.
- Actual Store graph produced generated `store_id` columns and cascade
  constraints for both Store child models.
- Store package build passed.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing
  using an isolated temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check, tests, import guards, and production build passed.

Current limitations:

- Composite foreign keys and many-to-many pivot schema generation remain
  incomplete.
- Drizzle repositories still do not load relationships or recursively apply
  soft-delete/restore cascades.
- D1 remains in explicit non-atomic `statement` transaction mode.

## Drizzle Composite Foreign-Key Schema

Commit:

- `2f280945ec feat: generate Drizzle composite foreign keys`

The Drizzle DML schema compiler now generates SQLite/D1 foreign-key schema for
an owning relationship whose target model has a composite primary key.

Differences from original Medusa:

- For an owning relationship without a custom `foreignKeyName`, the compiler
  generates one owner column per target primary-key column using
  `<relationship>_<target-primary-key-column>` names.
- The compiled relationship records the ordered generated columns in
  `foreignKeyNames`.
- The compiler creates one ordered composite index and one ordered composite
  foreign-key constraint, preserving inverse cascade-delete metadata.
- A singular custom `foreignKeyName` is rejected for composite targets because
  the existing DML option cannot express an unambiguous per-column mapping.
- Existing DML model definitions, Medusa services, and the MikroORM default
  path remain unchanged.

Validation:

- Drizzle package build and tests: 18 passing, including compiler metadata and
  executable SQLite enforcement/cascade coverage for a composite relationship
  foreign key.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 416.35 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

Current limitations:

- Composite-key relationship loading, cascade traversal, and mutation behavior
  remain incomplete because repository relation descriptors still expose a
  singular owner foreign key.
- The existing DML relationship API has no per-column custom foreign-key-name
  option for composite targets.
- Implicit many-to-many pivot tables still require single-column primary keys
  on both related tables.
- Many-to-many mutation/detach behavior, ORM-managed mutation-event parity,
  `upsertWithReplace`, and D1 multi-statement atomicity remain open.

## Drizzle Composite Relationship Loading And Cascades

Commit:

- `de4a59e938 feat: load Drizzle composite relations`

The generated Drizzle Medusa repository now loads and recursively applies
soft-delete/restore cascades across FK-backed relationships whose referenced
model has a composite primary key.

Differences from original Medusa:

- Relation descriptors preserve ordered owner foreign-key columns rather than
  collapsing relationship ownership to one column.
- `belongsTo`, `hasOneWithFK`, and `hasMany` populate use ordered tuple
  predicates and tuple identity keys.
- Cascade traversal uses the same ordered tuple mapping for soft delete and
  restore.
- Tuple predicates match complete key pairs, preventing cross-matches when
  different entities share one composite-key component.
- Existing Medusa DML definitions, module services, public contracts, and the
  MikroORM default path remain unchanged.

Validation:

- Drizzle package build and tests: 19 passing, including bidirectional
  composite relationship populate, cross-match prevention, soft-delete
  cascade, and restore cascade.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 416.89 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

Current limitations:

- Implicit many-to-many pivot tables still require single-column primary keys
  on both related models.
- Relationship attach/detach and replacement mutations remain incomplete.
- The existing DML relationship API has no per-column custom foreign-key-name
  option for composite targets.
- ORM-managed mutation-event parity, `upsertWithReplace`, schema-diff upgrade
  migrations, and D1 multi-statement atomicity remain open.

## Drizzle Composite Many-To-Many Pivots

Commit:

- `e61c6ff640 feat: support Drizzle composite pivots`

The Drizzle schema compiler and generated Medusa repository now support
many-to-many relationships when either or both related models use composite
primary keys.

Differences from original Medusa:

- Implicit pivot-table generation creates one ordered pivot column per related
  primary-key column.
- Generated pivot tables contain ordered composite foreign keys, composite
  source/target indexes, and one uniqueness constraint across the complete
  relationship tuple.
- Existing DML `joinColumn` and `inverseJoinColumn` arrays are preserved and
  validated against the referenced primary-key arity.
- Missing custom pivot columns receive deterministic
  `<table>_<primary-key-column>` names for composite keys, while existing
  single-key naming remains unchanged.
- Many-to-many loading preserves all source and target pivot FK columns for
  both implicit pivot tables and explicit `pivotEntity` models.
- Existing Medusa DML definitions, services, public contracts, and the
  MikroORM default path remain unchanged.

Validation:

- Drizzle package build and tests: 23 passing.
- Schema tests cover composite implicit pivot columns, indexes, foreign keys,
  uniqueness, inverse metadata, and rejection of incomplete custom pivot
  column mappings.
- Repository tests cover bidirectional implicit-pivot and explicit-pivotEntity
  composite relationship loading without cross-matching shared key
  components.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 417.86 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

Current limitations:

- Relationship attach/detach and replacement mutation behavior remains
  incomplete.
- The existing DML relationship API has no per-column custom foreign-key-name
  option for non-pivot composite relationships.
- ORM-managed mutation-event parity, `upsertWithReplace`, schema-diff upgrade
  migrations, and D1 multi-statement atomicity remain open.

## Drizzle Implicit Many-To-Many Replacement

Commit:

- `84a70461c7 feat: replace Drizzle implicit relations`

The generated Drizzle Medusa repository now implements the first
`upsertWithReplace` compatibility slice: flat root create/partial update and
replacement of existing targets on implicit many-to-many relationships.

Differences from original Medusa:

- Root entities are classified as created or updated before mutation, and the
  repository returns Medusa `PerformedActions` for service-level event
  dispatch.
- Omitted scalar fields are preserved during updates instead of becoming
  `NULL` through a SQL insert-on-conflict path.
- Configured implicit many-to-many relations replace their complete pivot set.
  Passing an empty array detaches every existing relationship without deleting
  target entities.
- Replacement supports single and composite source/target primary keys through
  the existing ordered tuple metadata.
- Target shape and existence are validated before old pivot rows are deleted.
- Unconfigured relationship fields are ignored, matching Medusa's
  `config.relations` boundary.

Validation:

- Drizzle package build and tests: 24 passing.
- Repository coverage proves root creation/action reporting, partial update,
  composite-key attach, replacement, detach-all, hydrated response data, and
  rejection of missing targets without removing the existing relationship.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 422.66 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

Current limitations:

- Nested target creation, one-to-many replacement, and explicit pivot-entity
  mutation through `upsertWithReplace` remain unsupported and fail loudly.
- Relation replacement is multi-statement; D1 statement mode cannot guarantee
  atomic replacement without a higher-level atomic adapter.
- ORM-managed mutation-event parity, schema-diff upgrade migrations, and
  complete `upsertWithReplace` parity remain open.

## Drizzle FK-Backed HasMany Replacement

Commit:

- `09fcf66af5 feat: replace Drizzle hasMany relations`

The generated Drizzle Medusa repository now reconciles configured FK-backed
`hasMany` collections through the existing `upsertWithReplace` contract.

Differences from original Medusa:

- Child rows without primary keys are created using the target DML model's
  defaults and ID generation.
- Existing children supplied by primary key are updated or reassigned while
  preserving omitted stored fields.
- Omitted current children are physically deleted, and an empty array removes
  the complete collection, matching Medusa's one-to-many replacement behavior.
- Ordered parent primary-key values are assigned to the child's generated
  foreign-key columns, including composite ownership tuples.
- Created, updated, and deleted children are included in Medusa
  `PerformedActions`, and the returned parent entities contain hydrated child
  collections.
- Duplicate child primary keys and deeper nested child relation values are
  rejected before collection rows are deleted.

Validation:

- Drizzle package build and tests: 25 passing.
- Repository coverage proves generated child IDs, composite parent ownership,
  existing-child association without overwriting omitted fields, child
  creation/update/deletion, detach-all, performed actions, hydrated results,
  and non-destructive duplicate-key rejection.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 426.80 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

Current limitations:

- Deeper nested relation replacement, explicit pivot-entity mutation, and
  implicit many-to-many nested target creation remain unsupported.
- Relation replacement is multi-statement; D1 statement mode cannot guarantee
  atomic replacement without a higher-level atomic adapter.
- ORM-managed mutation-event parity, schema-diff upgrade migrations, and
  complete `upsertWithReplace` parity remain open.

## Drizzle FK-Backed Relationship Loading

Commit:

- `05c71d50cd feat: load Drizzle FK-backed relations`

The generated Drizzle Medusa repository now uses compiled DML relationship and
foreign-key metadata to resolve top-level `options.populate` entries for
single-column FK-backed relationships.

Differences from original Medusa:

- `belongsTo` and `hasOneWithFK` populate queries load the referenced row from
  the related table and assign `null` when the FK is absent.
- `hasMany` populate queries load child rows through the generated FK column
  and attach an array to each parent row.
- Relationship loading reuses Medusa DML target callbacks and the Drizzle
  compiler output; it does not introduce a parallel relation mapping format.
- Shared DAL default and primary-key helpers now ignore relationship metadata
  when applying scalar defaults or finding primary keys.

Validation:

- `@medusajs/dal` build passed.
- Drizzle package build and tests: 9 passing, including an actual Medusa DML
  parent/child graph with `hasMany` and `belongsTo` populate.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check, tests, import guards, and production build passed.
- `git diff --check` passed.

Current limitations:

- Only top-level populate entries are handled; nested populate paths are
  ignored.
- Composite foreign keys and many-to-many pivot loading remain incomplete.
- Recursive soft-delete/restore cascade traversal is still not implemented.
- D1 remains in explicit non-atomic `statement` transaction mode.

## Drizzle Recursive Soft Delete And Restore Cascades

Commit:

- `98630cf21c feat: cascade Drizzle soft delete and restore`

The generated Drizzle Medusa repository now follows compiled DML
`cascadeDelete` relationship metadata when applying `softDelete` and `restore`.

Differences from original Medusa:

- The Drizzle repository compiles the reachable DML relationship graph for a
  model, not just direct targets, so cascade traversal can continue through
  child models.
- `softDelete` and `restore` update root rows and then recursively update
  FK-backed related rows for relationships declared in `.cascades({ delete })`.
- Cascaded result maps include the root model and each affected child model,
  matching the existing Medusa repository/service return shape.
- A visited-row guard prevents repeated updates when a graph points back to an
  already processed model row.

Validation:

- Drizzle package build and tests: 10 passing, including a real Medusa DML
  parent -> child -> grandchild recursive cascade graph.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check, tests, import guards, and production build passed.
- `git diff --check` passed.

Current limitations:

- Cascade traversal is implemented for single-column FK-backed relationships.
- Nested populate paths, composite keys, and many-to-many pivot loading remain
  incomplete.
- Drizzle create, update, soft-delete, and restore still do not reproduce
  MikroORM's ORM-managed subscriber emission.
- D1 remains in explicit non-atomic `statement` transaction mode.

## Drizzle Nested Relationship Loading

Commit:

- `7982edd95f feat: load nested Drizzle relations`

The generated Drizzle Medusa repository now resolves nested FK-backed
`options.populate` paths by walking a populate tree over the compiled DML
relationship graph.

Differences from original Medusa:

- `children.grandchildren` loads the intermediate `children` relation and then
  recursively loads `grandchildren` from the child model's descriptors.
- Relation loaders now return the related rows they fetched so nested loading
  recurses over the actual result set rather than rebuilding module services or
  repositories.
- The same compiled DML relationship graph is used for top-level loading,
  nested loading, and recursive soft-delete/restore cascades.

Validation:

- Drizzle package build and tests: 10 passing, including a real Medusa DML
  parent -> child -> grandchild nested populate graph.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check, tests, import guards, and production build passed.
- `git diff --check` passed.

Current limitations:

- Nested populate support is still limited to single-column FK-backed
  relationships.
- Composite keys and many-to-many pivot loading remain incomplete.
- Drizzle create, update, soft-delete, and restore still do not reproduce
  MikroORM's ORM-managed subscriber emission.
- D1 remains in explicit non-atomic `statement` transaction mode.

## Drizzle PivotEntity Many-To-Many Loading

Commit:

- `bd97a1111b feat: load Drizzle pivotEntity relations`

The generated Drizzle Medusa repository now resolves explicit
`pivotEntity`-backed `manyToMany` relations through compiled DML relationship
metadata.

Differences from original Medusa:

- The repository relationship graph includes pivot entities referenced by
  `relationship.options.pivotEntity`, so join models such as
  `ProductVariantProductImage` and `CustomerGroupCustomer` can be compiled
  without app-local duplicate registration.
- `manyToMany` relation descriptors locate the pivot table and its foreign
  keys back to the source and target tables.
- `options.populate` loads target rows through pivot rows and attaches arrays
  on both sides of an explicit pivotEntity relationship.
- The implementation stays inside the Drizzle repository adapter; shared
  Medusa services, DML model definitions, and public module contracts remain
  unchanged.

Validation:

- Drizzle package build and tests: 11 passing, including bidirectional
  explicit pivotEntity many-to-many populate.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 409.35 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

Current limitations:

- This covers explicit `pivotEntity` relations only. Implicit `pivotTable`
  schema generation and loading remain incomplete.
- Composite keys and many-to-many mutation/detach behavior remain incomplete.
- Drizzle create, update, soft-delete, and restore still do not reproduce
  MikroORM's ORM-managed subscriber emission.
- D1 remains in explicit non-atomic `statement` transaction mode.

## Drizzle Implicit PivotTable Generation And Loading

Commit:

- `fd2ce8dc15 feat: generate Drizzle implicit pivot tables`

The Drizzle DML schema compiler now creates physical SQLite/D1 join tables for
`manyToMany` relationships that use an implicit `pivotTable` rather than an
explicit `pivotEntity`.

Differences from original Medusa:

- The Drizzle compiler normalizes implicit many-to-many metadata onto both
  sides of the relationship, including pivot table name, join column, and
  inverse join column.
- When no explicit pivot table name is supplied, the compiler follows the
  existing Medusa naming shape: sorted table names with the second name
  pluralized.
- Generated implicit pivot tables contain source and target ID columns,
  indexes, a unique pair index, and cascading foreign keys back to the related
  model tables.
- The existing Drizzle many-to-many repository loader now works for both
  explicit `pivotEntity` tables and compiler-generated implicit `pivotTable`
  tables.
- No Cloudflare app-local join-table definitions or parallel module services
  were added.

Validation:

- Drizzle package build and tests: 13 passing, including generated implicit
  pivot schema and bidirectional implicit pivotTable populate.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 415.78 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

Current limitations:

- Implicit pivot generation currently supports single-column primary keys.
- Composite keys and many-to-many mutation/detach behavior remain incomplete.
- Drizzle create, update, soft-delete, and restore still do not reproduce
  MikroORM's ORM-managed subscriber emission.
- D1 remains in explicit non-atomic `statement` transaction mode.

## Drizzle Composite Primary-Key Baseline

Commit:

- `841eee6eb6 feat: render Drizzle composite primary keys`

The Drizzle D1 migration renderer now supports DML models with multiple
primary-key fields, such as workflow execution and index data style models.

Differences from original Medusa:

- Single-column primary keys continue to render inline on the column.
- Composite primary keys render as a table-level `PRIMARY KEY (...)`
  constraint instead of invalid per-column primary-key declarations.
- Autoincrement columns are rejected when used inside a composite D1 primary
  key because SQLite/D1 only supports autoincrement on a single integer primary
  key.
- The generated Drizzle repository already had enough primary-key-aware
  mutation behavior for root composite-key models; focused coverage now proves
  create, find, update, upsert, and delete through the existing repository
  contract.

Validation:

- Drizzle package build and tests: 15 passing, including executable composite
  primary-key migration SQL and composite-key repository mutations.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 415.78 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

Current limitations:

- Composite foreign keys and relationship loading across composite keys remain
  incomplete.
- Implicit many-to-many pivot tables still require single-column primary keys
  on both related tables.
- Many-to-many mutation/detach behavior remains incomplete.
- Drizzle create, update, soft-delete, and restore still do not reproduce
  MikroORM's ORM-managed subscriber emission.
- D1 remains in explicit non-atomic `statement` transaction mode.

## Parallel Currency Service Removal

Commit:

- `8a3a0528dc refactor: remove parallel portable currency service`

The temporary portable Currency model and service were removed after the
actual `CurrencyModuleService` passed the same acceptance paths. Currency now
imports the existing precise `@medusajs/utils` model and service factories
directly. No replacement module service or duplicate assertions were added.

Validation:

- Clean `@medusajs/utils`, `@medusajs/framework`, and `@medusajs/currency`
  builds passed.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Unchanged Currency integration suite through MikroORM/Postgres: 13 passing.
- Actual Currency workerd/D1 runtime check passed.
- Composed Worker guard: 197 bundled inputs and no blockers.
- Real Currency service audit: 66 bundled inputs and no blockers.

## Node Persistence Composition Boundary

Commit:

- `c946ed072a refactor: isolate node persistence composition`

Shared module discovery and container repository registration no longer import
or silently select the MikroORM persistence adapter.

The boundary now behaves as follows:

- `loadResources` requires a valid persistence adapter in module options.
- `moduleContainerLoaderFactory` requires an adapter from its configured or
  runtime options.
- The Node-only `moduleLoader` composes
  `mikroOrmModulePersistenceAdapter` by default, preserving existing Medusa
  behavior.
- Applications can pass another adapter to `moduleLoader`.
- The MikroORM adapter is no longer exported from the shared modules-sdk utils
  barrel. Node composition imports it through
  `@medusajs/utils/modules-sdk/persistence/mikro-orm`.

This separates shared adapter dispatch from the Node default without forcing
existing Node applications to configure MikroORM for every module.

Validation:

- `@medusajs/utils` build passed.
- `@medusajs/modules-sdk` build passed.
- `@medusajs/framework` build passed.
- Currency build passed.
- Focused shared loader and Node composition tests: 21 passing.
- Existing Currency integration suite: 13 passing unchanged.

## Drizzle Explicit Pivot-Entity Replacement

Commit:

- `2d7d98d157 feat: replace Drizzle explicit pivot relations`

The Drizzle repository can now replace many-to-many relations backed by an
explicit DML pivot entity through `upsertWithReplace`.

Differences from original Medusa:

- Explicit pivot-entity relations are no longer rejected by the Drizzle
  `upsertWithReplace` path.
- Replacement creates missing pivot-entity rows for existing targets, removes
  stale pivot-entity rows, and detaches all links when the relation array is
  empty.
- The focused Drizzle path still requires target entities to already exist.
  Nested target creation remains a separate open parity item.
- Pivot-entity rows are used as relationship infrastructure here; full
  ORM-managed mutation-event parity remains open.

Validation:

- Drizzle package tests: 26 passing, including explicit pivotEntity
  attach/replace/detach, hydrated responses, non-destructive missing-target
  rejection, and target preservation.
- Drizzle package build passed.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 430.76 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

Current limitations:

- Deeper nested relation replacement and implicit many-to-many nested target
  creation remain unsupported.
- ORM-managed mutation-event parity, schema-diff upgrade migrations, and D1
  multi-statement atomicity remain open.

## Next Persistence Slice: Durable Object SQLite Manager

Decision:

- Stop expanding Drizzle relational edge cases by default now that the
  repository supports the relationship behavior needed to prove an
  authoritative aggregate topology.
- Implement a Cloudflare-specific Drizzle manager backed by
  `DurableObjectStorage.sql` before selecting another Medusa module.
- Keep the existing shared Drizzle schema compiler and repository logic.
- Keep Durable Object bindings, Cloudflare runtime types, and Wrangler
  configuration outside shared portable Drizzle barrels and Medusa modules.

Required proof:

- Generated DML schema can initialize a SQLite-backed Durable Object instance.
- Existing Drizzle repository create/read/update/delete behavior runs through
  the Durable Object SQL adapter.
- Focused workerd tests prove the actual multi-statement rollback and atomicity
  behavior.
- The prototype determines whether the current async Drizzle proxy can preserve
  a Durable Object transaction boundary.
- If async repository execution cannot remain inside `transactionSync`, add a
  staged statement executor instead of rewriting Medusa module services.

After this proof, use DO-local SQLite for an authoritative Cart aggregate
vertical slice. D1 remains projection/query storage and must not become the
authoritative active-cart store.

## Durable Object SQLite Manager Prototype

Commit:

- `0d367310ed feat: prove Durable Object SQLite manager`

The fork now has an isolated Cloudflare persistence package,
`@medusajs/drizzle-cloudflare`, that adapts `DurableObjectStorage.sql` to the
existing Drizzle Medusa manager and repository contracts. The Cloudflare app
composes a named SQLite-backed Durable Object and initializes its schema from
the existing Currency DML model and Drizzle schema compiler.

Differences from original Medusa:

- Durable Object SQLite is available as an application-selected Drizzle
  manager without adding Cloudflare imports to shared Medusa or portable
  Drizzle barrels.
- The existing Drizzle repository executes create and read behavior inside a
  real workerd Durable Object.
- The manager reports `object-serialized` transaction semantics. Durable
  Object request serialization is preserved, but the current async repository
  transaction callback is not a multi-statement SQLite transaction.
- The workerd rollback proof intentionally confirms that a write completed
  before an async transaction callback throws remains persisted.

Required follow-up:

- Add a staged statement executor or another explicit synchronous command
  boundary that can execute the complete write set inside
  `DurableObjectStorage.transactionSync`.
- Do not treat the current manager as atomic or use it as authoritative Cart
  storage until that boundary passes a real rollback proof.

This initial conclusion is superseded by the async transaction correction
below.

Validation:

- `@medusajs/drizzle` build and 26 tests passed.
- `@medusajs/drizzle-cloudflare` build passed.
- Unchanged Currency integration assertions through Drizzle/SQLite: 13
  passing.
- Durable Object SQLite workerd repository and rollback proof passed.
- Existing D1 workerd Currency mutation proof passed.
- Generated Currency migration drift and fresh local D1 migration checks
  passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 229 transformed modules, 444.42 kB.
- Composed Worker guard: 333 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.

## Store Drizzle Generated Root Upsert

Commit:

- `baddfc312a fix: handle generated root ids in Drizzle replace upsert`

The unchanged Store integration suite now passes through the shared Drizzle
repository path. The blocking behavior was in `upsertWithReplace`: when a root
entity had a generated primary key and was being created with replacement
relations, the Drizzle repository tried to look up an existing root row before
the generated ID existed.

Differences from original Medusa:

- The Drizzle repository now mirrors the existing sparse `upsert` guard and
  only queries for an existing root row when all root primary-key fields are
  present.
- Generated-ID create paths go directly to create, then relationship
  replacement uses the created root ID to assign FK-backed children.
- Focused Drizzle regression coverage creates a generated-ID parent with
  `hasMany` children through `upsertWithReplace`, verifies default child
  values, returned parent IDs, performed actions, and persisted FK links.
- No Store module service, DML model, loader, public contract, or integration
  assertion was changed.

Validation:

- `@medusajs/drizzle` build passed.
- Drizzle package tests: 34 passing.
- Unchanged Store integration suite through Drizzle/SQLite: 12 passing.
- Unchanged Cart integration suite through Drizzle/SQLite: 63 passing.
- Unchanged Currency integration suite through Drizzle/SQLite: 13 passing.
- Cloudflare app typecheck, tests, import guards, and production build passed.
- Existing Currency Durable Object SQLite proof passed.
- Existing Currency D1 workerd proof passed; the script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Existing Cart Durable Object SQLite proof passed.
- `git diff --check` passed.

Current limitation:

- Store still is not part of the Worker commerce module set. The next slice is
  to add Store to the static commerce module set and prove the module set in
  workerd without broadening shared runtime code.

## Sales Channel Drizzle Compatibility

Commit:

- `e8d7010cd9 feat: compose Sales Channel in Worker module set`

The unchanged Sales Channel integration suite now passes through
Drizzle/SQLite using the same module-test runner path as Currency, Cart, and
Store.

Differences from original Medusa:

- `updateSalesChannels_` now marks its shared context parameter with
  `@MedusaContext`, matching the `@InjectTransactionManager` contract already
  expected by the decorator.
- Sales Channel source imports that were package-local aliases are now relative
  where they enter runtime code, so the module can share a Worker bundle with
  other modules without app-global alias collisions.
- Sales Channel's joiner config is derived from the DML model through the
  portable joiner-config builder, matching the static manifest path.
- No Sales Channel service behavior, public API, DML model, or integration
  assertion was replaced.

Validation:

- `@medusajs/sales-channel` build passed.
- Sales Channel package tests passed: 2 tests.
- Unchanged Sales Channel integration suite through Drizzle/SQLite passed: 14
  tests.
- Cloudflare app typecheck, tests, import guards, and production build passed.
- Existing Currency Durable Object SQLite proof passed.
- Existing Currency D1 workerd proof passed; the script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Sales Channel + Store + Cart Durable Object SQLite proof passed through the
  commerce module set.
- `git diff --check` passed.

## Region Drizzle Compatibility

Commit:

- `38d364dc12 feat: compose Region in Worker module set`

The unchanged Region integration suite now passes through Drizzle/SQLite using
the same module-test runner path as Currency, Cart, Store, and Sales Channel.

Differences from original Medusa:

- Region's runtime imports that used package-local aliases are now relative,
  so Region can share a Worker bundle with other modules without app-global
  alias collisions.
- Region's loader uses type-only framework type imports and narrows caught
  values before logging.
- Region hard delete now detaches countries before deleting the Region row,
  matching the existing soft-delete behavior and avoiding SQLite foreign-key
  violations on the Drizzle path.
- Region create returns an empty `countries` collection for create calls that
  do not include countries, preserving the existing unchanged module assertion.
- Region's internal service dependencies are typed to the actual DML models
  instead of broad `any`.
- No replacement Region service, public API, DML model, or integration
  assertion was introduced.

Validation:

- `@medusajs/region` build passed.
- Region package static-manifest test passed: 1 test.
- Existing Region integration suite through Drizzle/SQLite passed: 18 tests.
- Cloudflare app typecheck, tests, import guards, and production build passed.
- Existing Currency Durable Object SQLite proof passed.
- Existing Currency D1 workerd proof passed; the script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Region + Sales Channel + Store + Cart Durable Object SQLite proof passed
  through the commerce module set.
- Fresh local D1 migration check passed.
- `git diff --check` passed.

## Customer Drizzle Compatibility

Commit:

- `5952a88a43 feat: compose Customer in Worker module set`

The unchanged Customer integration suite now passes through Drizzle/SQLite
using the same module-test runner path as Currency, Cart, Store, Sales Channel,
and Region.

Differences from original Medusa:

- The Drizzle repository now prevalidates DML unique indexes, including partial
  SQLite indexes such as `deleted_at IS NULL` and default-address predicates,
  and returns Medusa-style duplicate messages.
- The Drizzle repository translates direct many-to-many relation filters, such
  as `{ groups: groupId }`, through the compiled pivot-entity metadata.
- The Drizzle repository detaches many-to-many pivot rows before hard-deleting
  entities whose DML model declares `cascades({ detach: [...] })`.
- The Drizzle schema compiler now preserves `cascadeDetach` on compiled
  relationship metadata.
- Customer's package-local runtime imports are now relative, and its joiner
  config is derived from explicit DML models through the portable joiner-config
  builder.
- Customer's internal service dependencies are typed to actual DML model
  entity types instead of broad `any`.
- No replacement Customer service, public API, DML model, or integration
  assertion was introduced.

Validation:

- `@medusajs/drizzle` build passed.
- Drizzle package tests passed: 36 tests.
- `@medusajs/customer` build passed.
- Customer package static-manifest test passed: 1 test.
- Existing Customer integration suite through Drizzle/SQLite passed: 47 tests.
- Cloudflare app typecheck, tests, import guards, and production build passed.
- Existing Currency Durable Object SQLite proof passed.
- Existing Currency D1 workerd proof passed; the script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Customer + Region + Sales Channel + Store + Cart Durable Object SQLite proof
  passed through the commerce module set.
- Fresh local D1 migration check passed.
- `git diff --check` passed.

## Product Drizzle Compatibility

Commit:

- `d0c28904e7 feat: pass Product module Drizzle gate`

The Product module integration slice now passes through Drizzle/SQLite using
the same module-test runner path as the earlier commerce modules.

Differences from original Medusa:

- The shared Drizzle repository now supports Product-required nested
  `upsertWithReplace` behavior for has-many and many-to-many relations,
  including nested relation payloads, owned-row cleanup, and no-op child update
  suppression.
- The shared Drizzle repository now dispatches mutation events through a
  persistence event subscriber boundary so Product's existing module service
  can emit the same create/update/delete events without MikroORM's event
  manager.
- The shared Drizzle relation loader now supports wildcard population,
  deterministic relation ordering, nullable to-one relation materialization,
  has-many relation filters, free-text filters, and Medusa-style missing
  relationship messages.
- Product update handling keeps the real Product module service path and uses
  `upsertWithReplace` as the Drizzle fallback where the MikroORM custom
  repository previously handled deep updates.
- Product integration fixtures that previously wrote directly through MikroORM
  now use the real module service APIs so the same tests can run against both
  persistence adapters.
- No replacement Product service, public API, DML model, workflow, or app-local
  assertion suite was introduced.

Validation:

- `@medusajs/drizzle` tests passed: 36 tests.
- `@medusajs/drizzle` build passed.
- `@medusajs/product` build passed.
- Existing Product integration slice through Drizzle/SQLite passed: 205 tests
  passed, 1 skipped.
- `git diff --check` passed.

## Cart Totals Drizzle Projection Fields

Commit:

- `dc9d40d051 feat: compose Product in Worker module set`

Cart totals now explicitly request the scalar relation fields required by the
Drizzle projection path before calling the existing totals decorator.

Differences from original Medusa:

- Original Cart totals relied on the MikroORM relation load path returning the
  scalar fields needed by `decorateCartTotals`.
- The Drizzle path now adds the required scalar fields for line items,
  shipping methods, adjustments, and tax lines when a totals field is selected.
- No Cart totals algorithm, public API, or replacement Cart service was
  introduced.

Validation:

- `@medusajs/cart` build passed.
- Product + Customer + Region + Sales Channel + Store + Cart Durable Object
  SQLite workerd proof passed with Cart total `319` and raw total `"319"`.
- `git diff --check` passed.

## Drizzle Medusa Adapter Helper Split

Commit:

- `209c1203df refactor: split Drizzle Medusa adapter helpers`

The Drizzle Medusa adapter was split into smaller domain files before the next
commerce-module compatibility slice. This is a maintenance refactor only: the
same `ModulePersistenceAdapter` remains the public boundary and the original
Medusa module services continue to call the same adapter methods.

Differences from original Medusa:

- Drizzle-specific mutation event dispatch now lives in
  `packages/database/drizzle/src/mutation-events.ts`.
- Drizzle relationship metadata traversal now lives in
  `packages/database/drizzle/src/relation-metadata.ts`.
- Drizzle unique-index validation and SQLite constraint error mapping now live
  in `packages/database/drizzle/src/constraints.ts`.
- No service behavior, DML model, module API, workflow, or app-local parallel
  implementation was introduced.

Validation:

- `@medusajs/drizzle` tests passed: 36 tests.
- `@medusajs/drizzle` build passed.
- Composed Worker import guard passed with 428 bundled inputs.
- `git diff --check` passed.

## Stock Location Drizzle And Worker Composition

Commit:

- `fa67290f87 feat: compose Stock Location in Worker module set`

The unchanged Stock Location module service now passes through the Drizzle
module-test path and is composed into the Worker commerce module set.

Differences from original Medusa:

- The shared Drizzle repository `update` path now handles owner-side nullable
  to-one relation payloads, creates or updates the target row, writes the owner
  foreign key, and returns the requested relation populated.
- `@medusajs/stock-location/static-manifest` exposes Stock Location's module
  definition, service, DML models, and portable joiner config.
- Stock Location's joiner config now uses the portable DML-derived builder.
- Stock Location's package-local `@models` import and broad runtime
  framework-types import were narrowed so the actual service path can bundle in
  the Worker graph.
- Currency, Cart, Store, Sales Channel, Region, Customer, Product, and Stock
  Location static manifests are composed through the shared static module set
  loader.
- No replacement Stock Location service, public API, DML model, workflow, or
  app-local assertion suite was introduced.

Validation:

- `@medusajs/drizzle` tests passed: 36 tests.
- `@medusajs/stock-location` build passed.
- Stock Location package tests passed: 2 tests.
- Existing Stock Location integration suite through Drizzle/SQLite passed:
  8 tests.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 tests.
- Composed Worker import guard passed with 436 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 737.19 kB, gzip 145.29 kB.
- Product + Customer + Stock Location + Region + Sales Channel + Store + Cart
  Durable Object SQLite workerd proof passed through the commerce module set.
- Fresh local D1 migration check passed.
- `git diff --check` passed.

## Inventory Drizzle Module Gate

Commit:

- Current Inventory Drizzle gate change set.

The unchanged Inventory module integration suite now passes through the
Drizzle/SQLite module-test path.

Differences from original Medusa:

- Original Inventory relies on MikroORM hooks/formulas for
  `InventoryLevel.available_quantity` and `InventoryItem` stocked/reserved
  quantity projections.
- The Drizzle persistence adapter now computes those observed Inventory
  quantities at the repository boundary while preserving the original
  Inventory DML models and module services.
- The Drizzle `InventoryLevel` repository now provides the aggregate methods
  expected by the existing `InventoryLevelService`:
  `getStockedQuantity`, `getReservedQuantity`, and `getAvailableQuantity`.
- Inventory-specific Drizzle repository and computed-field helpers live in
  `packages/database/drizzle/src/inventory.ts` instead of expanding the central
  `medusa.ts` adapter file.
- Drizzle mutation-event fallback now maps `reservation_item` events to the
  Inventory module source to match Medusa's established event contract.
- Drizzle find results preserve primary-key `$or` selector order when the only
  ordering is the default primary-key ascending order, which keeps bulk update
  return order aligned with Medusa's service behavior.
- No replacement Inventory service, public API, DML model, workflow, or
  app-local assertion suite was introduced.

Affected boundary:

- `packages/database/drizzle` shared Medusa persistence adapter.
- Existing `@medusajs/inventory` module services and integration assertions.

Validation:

- `@medusajs/drizzle` tests passed: 39 tests.
- `@medusajs/drizzle` build passed.
- Existing Inventory integration suite through Drizzle/SQLite passed:
  35 tests.

## Inventory Static Manifest And Worker Composition

Commit:

- `0820f155ff feat: compose Inventory in Worker module set`

Inventory is now composed into the Worker commerce module set after the
unchanged Inventory integration suite passed through Drizzle/SQLite.

Differences from original Medusa:

- `@medusajs/inventory/static-manifest` exposes Inventory's module
  definition, module exports, DML models, module service, and portable joiner
  config for explicit Worker composition.
- Inventory's joiner config is derived from explicit DML models through the
  portable joiner-config builder, matching the static manifest path.
- Inventory package-local runtime imports were narrowed to relative imports so
  the actual Inventory service path can share the Worker graph with the other
  commerce modules.
- Inventory's MikroORM formula/hook application was isolated behind an
  optional Node `require` wrapper, keeping the hook implementation out of the
  Worker import graph while preserving the Node/MikroORM hook file.
- `ModulesSdkUtils.MedusaInternalService` is now part of the guarded portable
  module-sdk subset because Inventory's real service path requires generated
  internal services through that namespace.
- `@medusajs/utils/totals/math` is exported as a precise utility subpath so
  Inventory can reuse the existing `MathBN` helper without importing broad
  barrels.
- The Cloudflare commerce module set now includes Currency, Cart, Store,
  Sales Channel, Region, Customer, Product, Stock Location, and Inventory.
- The Durable Object SQLite proof creates and lists a real Inventory item and
  Inventory level against the existing Stock Location before running the Cart
  totals and rollback proof.
- No replacement Inventory service, public API, DML model, workflow, or
  app-local assertion suite was introduced.

Affected boundary:

- `packages/modules/inventory` static manifest and import graph.
- `packages/core/utils` portable module-sdk and totals leaf exports.
- `apps/medusa-cloudflare` static commerce module composition and DO proof.

Validation:

- `@medusajs/inventory` build passed.
- Inventory package tests passed: 2 tests.
- Existing Inventory integration suite through Drizzle/SQLite passed:
  35 tests.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 tests.
- Composed Worker import guard passed with 449 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 783.99 kB, gzip 151.86 kB.
- Product + Inventory + Customer + Stock Location + Region + Sales Channel +
  Store + Cart Durable Object SQLite workerd proof passed through the commerce
  module set.

## Pricing Drizzle Module Gate

Commit:

- `9b50b20223 feat: pass Pricing module Drizzle gate`

The Pricing module integration slice now runs the unchanged Pricing service
suites, including price calculation, through Drizzle/SQLite.

Differences from original Medusa:

- Pricing integration fixture setup for `price-set`, `price-rule`,
  `price-list-rule`, `price-list`, and `calculate-price` no longer writes
  through `MikroOrmWrapper`; it seeds through the real `IPricingModuleService`
  APIs.
- The module container loader lets a selected persistence adapter replace
  named module custom repositories that are not tied to a single DML model.
  Drizzle uses this to replace `pricingRepository` while leaving the original
  MikroORM/Knex `PricingRepository` as the Node default.
- `packages/database/drizzle/src/pricing.ts` implements the Pricing
  calculation repository for SQLite/D1 using the compiled DML tables and the
  existing `PricingRepositoryService` contract. `PricingModuleService` still
  calls the same `calculatePrices` method and no replacement service was
  introduced.
- The Drizzle DML schema compiler materializes generated `raw_*` JSON columns
  for `bigNumber` fields only when the DML model does not already declare the
  raw field, preserving Pricing raw amount assertions without duplicating
  explicit raw columns.
- The shared Drizzle adapter now supports relation-level `populateWhere`
  filters, deterministic `PriceRule.priority` ordering, and DML `dateTime`
  string coercion before SQLite persistence.
- Pricing mutation-event fallback names now map price-related models to the
  established `pricing.*` event source.
- `PricingModuleService` no longer requires a MikroORM `Collection` for
  price-list rule replacement paths; relation lists can be either plain arrays
  or MikroORM collections.
- `updatePriceLists_` now passes the active shared context into
  `upsertWithReplace`, avoiding nested SQLite transactions on the Drizzle
  path.
- No replacement Pricing service, DML model, public API, workflow, or app-local
  assertion suite was introduced.

Affected boundary:

- `packages/database/drizzle` shared Medusa persistence adapter.
- `packages/core/types` persistence adapter contract.
- `packages/core/utils` module repository loader.
- Existing `@medusajs/pricing` module service and integration fixture setup.

Validation:

- `@medusajs/drizzle` build passed.
- `@medusajs/drizzle` tests passed: 41 tests.
- `@medusajs/types` build passed.
- `@medusajs/utils` build passed.
- `@medusajs/modules-sdk` build passed.
- `@medusajs/pricing` build passed.
- Focused module loader test passed: 4 tests.
- Pricing Drizzle integration command passed all original Pricing service
  suites selected by the package integration script: 126 tests.

## Pricing Static Manifest And Worker Composition

Commit:

- `4c28877ab5 feat: compose Pricing in Worker module set`

Pricing is now composed into the Worker commerce module set after the
unchanged Pricing integration suites passed through Drizzle/SQLite.

Differences from original Medusa:

- `@medusajs/pricing/static-manifest` exposes Pricing's module definition,
  module exports, DML models, module service, and portable joiner config for
  explicit Worker composition.
- The manifest preserves the legacy named `pricingRepository` registration
  using a placeholder constructor that must be replaced by the selected
  persistence adapter before instantiation. This keeps the Worker graph free of
  the original MikroORM/Knex Pricing repository while preserving the existing
  service dependency name.
- Pricing's joiner config now uses explicit DML models through the portable
  joiner-config builder, matching the static manifest path.
- Pricing package-local runtime imports were narrowed to relative imports so
  the actual Pricing service path can share the Worker graph with the other
  commerce modules.
- Precise portable utility entrypoints were added for Pricing-required common
  and pricing helpers, including date validation, price-list enums, grouping,
  and nullish removal.
- The Cloudflare commerce module set now includes Currency, Cart, Store,
  Sales Channel, Region, Customer, Product, Stock Location, Inventory, and
  Pricing.
- The Durable Object SQLite proof creates a real Pricing price set and
  calculates a USD price before running the existing Cart totals and rollback
  proof.
- No replacement Pricing service, public API, DML model, workflow, or
  app-local assertion suite was introduced.

Affected boundary:

- `packages/modules/pricing` static manifest and import graph.
- `packages/core/utils` portable utility leaf exports used by Pricing.
- `apps/medusa-cloudflare` static commerce module composition and DO proof.

Validation:

- `@medusajs/utils` build passed.
- `@medusajs/framework` build passed.
- `@medusajs/pricing` build passed.
- Pricing package static-manifest test passed: 2 package tests total.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 tests.
- Composed Worker import guard passed with 472 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 854.13 kB, gzip 162.89 kB.
- Pricing + Product + Inventory + Customer + Stock Location + Region + Sales
  Channel + Store + Cart Durable Object SQLite workerd proof passed through
  the commerce module set.
- `git diff --check` passed.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  gate passes.

## Payment Static Manifest And Worker Composition

Commit:

- `229151bd4e feat: compose Payment in Worker module set`

Payment is now composed into the Worker commerce module set after the
unchanged Payment integration assertions passed through Drizzle/SQLite in
`db949a780d`.

Differences from original Medusa:

- `@medusajs/payment/static-manifest` exposes Payment's module definition,
  module exports, DML models, module service, `PaymentProviderService`, and
  original joiner config for explicit Worker composition.
- The Payment static manifest registers only the built-in
  `pp_system_default` system provider. The normal Node provider loader remains
  the default Payment module loader and still owns external provider and cloud
  provider discovery outside this Worker slice.
- Payment's joiner config now passes explicit models to avoid filesystem model
  discovery in the Worker graph.
- Payment package-local imports touched by the Worker graph were narrowed to
  relative imports, and framework type imports in Payment services/providers
  are now type-only so type barrels do not enter the Worker runtime graph.
- `SystemPaymentProvider` now uses `globalThis.crypto.randomUUID()` instead of
  importing Node `crypto`.
- The Cloudflare commerce module set now includes Currency, Cart, Store,
  Sales Channel, Region, Customer, Product, Stock Location, Inventory,
  Pricing, Tax, and Payment.
- The Durable Object SQLite proof seeds the system provider through the
  Payment static manifest, creates a real payment collection/session,
  authorizes the session, captures the payment, and then continues through the
  existing Cart totals and rollback proof.
- No replacement Payment service, public API, DML model, provider contract,
  workflow, or app-local assertion suite was introduced.

Affected boundary:

- `packages/modules/payment` static manifest, provider registration subset,
  joiner config, and Worker import graph.
- `apps/medusa-cloudflare` static commerce module composition, framework
  utility shim, import guard aliases, and DO proof.

Validation:

- `@medusajs/payment` focused package tests passed.
- `@medusajs/payment` build passed.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 tests.
- Composed Worker import guard passed with 500 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 927.55 kB, gzip 175.13 kB.
- Tax + Pricing + Payment + Product + Inventory + Customer + Stock Location +
  Region + Sales Channel + Store + Cart Durable Object SQLite workerd proof
  passed through the commerce module set.
- `git diff --check` passed.

Current limitation:

- External Payment provider and cloud provider discovery are not solved in this
  slice. The Worker manifest registers only the built-in system provider so the
  real Payment service path can be proven without dragging the provider-loader
  discovery graph into workerd.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  gate passes.

## Payment Drizzle Module Gate

Commit:

- `db949a780d feat: pass Payment module Drizzle gate`

The existing Payment module integration assertions now pass through the
Drizzle/SQLite module-test path.

Differences from original Medusa:

- Payment integration fixtures no longer seed through `MikroOrmWrapper`.
  They use the real module service surface and the generated MedusaService
  CRUD methods needed for deterministic Payment fixture IDs.
- `PaymentModuleService.maybeUpdatePaymentCollection_` now marks its shared
  context parameter with `@MedusaContext`, matching the
  `@InjectManager` contract.
- Payment collection total calculation now explicitly requests
  `payment_sessions.status`, removing a MikroORM-specific reliance on relation
  fields being present despite a narrower relation projection.
- Payment capture and auto-capture paths now refresh the returned Payment after
  related Capture rows and `captured_at` are written. This preserves the
  existing public return shape when the persistence backend returns plain rows
  instead of live ORM entities.
- The Drizzle repository now accepts scalar primary-key values for owned
  to-one relation assignment, matching existing Medusa service code such as
  `payment_session: session.id`.
- The Drizzle repository now keeps numeric BigNumber fields when a nested
  relation projection asks for `raw_*`, derives nested scalar field projections
  from relation paths, and fills empty to-many relation arrays on created rows
  to match existing module assertions.
- The Node SQLite Drizzle module-test connection serializes root transactions
  so concurrent module tests do not attempt overlapping `BEGIN` statements on
  the single in-memory SQLite connection.
- No replacement Payment service, public API, DML model, provider contract,
  workflow, or app-local assertion suite was introduced.

Affected boundary:

- `packages/database/drizzle` repository relation assignment, projection,
  create-result relation defaults, and test transaction scheduling.
- Existing `@medusajs/payment` module service return-shape and context
  handling.
- Existing Payment module integration fixtures.

Validation:

- `@medusajs/drizzle` tests passed: 41 tests.
- `@medusajs/drizzle` build passed.
- `@medusajs/payment` build passed.
- Existing Payment integration suite through Drizzle/SQLite passed: 36 tests.
- `git diff --check` passed.

Local limitation:

- The default MikroORM/Postgres Payment integration command was attempted, but
  local PostgreSQL authentication failed before assertions with
  `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`.
  The failure is an environment credential issue, not a Payment assertion
  result.

Next implementation step:

- Add Payment to the Worker commerce module set only after creating a
  module-owned static manifest and auditing provider-loader portability.

## Tax Drizzle Module Gate

Commit:

- `eea4119aaa feat: pass Tax module Drizzle gate`

The unchanged Tax module integration suites now pass through the
Drizzle/SQLite module-test path.

Differences from original Medusa:

- The Drizzle SQLite runtime table builder now preserves partial index
  predicates when creating Drizzle table metadata, instead of only preserving
  them in generated D1 SQL.
- The Drizzle unique-index prevalidation parser now handles boolean predicates
  with whitespace, such as `is_default = true`, without capturing a trailing
  space in the column name.
- The Drizzle partial unique-index regression test now proves duplicate rows
  outside the partial predicate can coexist while matching rows still produce
  the Medusa duplicate-message shape.
- `TaxModuleService.createTaxRegions_` now marks its shared context parameter
  with `@MedusaContext`, matching the `@InjectTransactionManager` contract
  already expected by the decorator.
- No replacement Tax service, public API, DML model, provider contract,
  workflow, or app-local assertion suite was introduced.

Affected boundary:

- `packages/database/drizzle` SQLite table construction and unique-index
  prevalidation.
- Existing `@medusajs/tax` module service transaction context handling.

Validation:

- `@medusajs/drizzle` build passed.
- `@medusajs/drizzle` tests passed: 41 tests.
- `@medusajs/tax` build passed.
- Existing Tax integration suite through Drizzle/SQLite passed: 35 tests.
- Composed Worker import guard passed with 472 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- `git diff --check` passed.

## Tax Static Manifest And Worker Composition

Commit:

- `ccdeb4a6e1 feat: compose Tax in Worker module set`

Tax is now composed into the Worker commerce module set after the unchanged Tax
integration suites passed through Drizzle/SQLite.

Differences from original Medusa:

- `@medusajs/tax/static-manifest` exposes Tax's module definition, module
  exports, DML models, module service, custom `TaxProviderService`, and
  portable joiner config for explicit Worker composition.
- The static manifest intentionally omits Tax's provider loader for this
  slice. Provider discovery and external provider registration still pull
  broader framework/Awilix surfaces and remain a separate portability boundary.
- Tax package-local runtime imports were narrowed to relative imports, and
  framework type imports in Tax services are now type-only so type barrels do
  not enter the Worker runtime graph.
- The Cloudflare commerce module set now includes Currency, Cart, Store,
  Sales Channel, Region, Customer, Product, Stock Location, Inventory,
  Pricing, and Tax.
- The Durable Object SQLite proof creates a real Tax region with a default tax
  rate and reads back the generated tax rate before running the existing Cart
  totals and rollback proof.
- No replacement Tax service, public API, DML model, provider contract,
  workflow, or app-local assertion suite was introduced.

Affected boundary:

- `packages/modules/tax` static manifest and import graph.
- `apps/medusa-cloudflare` static commerce module composition and DO proof.

Validation:

- `@medusajs/tax` package tests passed: 2 tests.
- `@medusajs/tax` build passed.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 tests.
- Composed Worker import guard passed with 481 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 875.68 kB, gzip 166.61 kB.
- Tax + Pricing + Product + Inventory + Customer + Stock Location + Region +
  Sales Channel + Store + Cart Durable Object SQLite workerd proof passed
  through the commerce module set.
- `git diff --check` passed.

Current limitation:

- Tax provider loader portability is not solved in this slice. A future Tax
  provider slice should move provider registration through a Worker-safe
  module-provider boundary before proving `getTaxLines` with a registered
  provider in workerd.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  gate passes.

## Order Drizzle Module Gate

Commit:

- 741dd3d0f1 (`Port commerce modules to Cloudflare static runtime`)

The Order module Drizzle gate now passes through the real Order module services
on the Drizzle/SQLite module-test path.

Differences from original Medusa:

- The shared Drizzle repository now generates missing non-primary
  `autoincrement`/serial values, matching Order's `display_id` behavior.
- FK-backed `hasMany` create accepts a single nested object in addition to an
  array, matching existing Order service create payloads.
- Wrapper relations such as `Order.items` and `Order.shipping_methods` can
  auto-expand through their owned `hasOne` target for populate paths like
  `items.adjustments` and `shipping_methods.tax_lines`.
- Required inbound wrapper rows are deleted before deleting their owned
  `hasOne` target rows, allowing Order line-item deletion to satisfy SQLite
  foreign-key constraints.
- Repository graph compilation now uses the prepared module model set so a
  repository can see inbound sibling descriptors inside the same module.
- Nested create under owned `hasOne` targets now recurses through the same
  create graph, allowing owned targets to create their nested relations.
- Nested `hasMany` create rows inherit matching parent context fields for
  `_id` fields and `version` when the child omits them, matching Order's
  MikroORM lifecycle hook behavior for `OrderChangeAction`.
- Default Drizzle read ordering now preserves Medusa-observed creation order
  with `display_id` when present and SQLite `rowid` otherwise, while preserving
  explicit rank and `PriceRule.priority` ordering.
- Drizzle maps the generated default `Order.id ASC` ordering to
  `Order.display_id ASC`, preserving Order list behavior for tests that create
  several orders and then list them without an explicit order.
- No replacement Order service, DML model, workflow, public API, or app-local
  assertion suite was introduced.

Affected boundary:

- `packages/database/drizzle` shared Medusa persistence adapter.
- Existing `@medusajs/order` module service behavior exercised through the
  unchanged integration assertions.

Additional differences from original Medusa in this change set:

- Drizzle now derives relation loads from selected field paths, so Medusa
  query shapes such as `items.detail` hydrate the relation graph even when the
  relation is not repeated in `relations`.
- Drizzle now applies direct relation ordering from Medusa's nested `order`
  config, such as `actions.ordering ASC`, when loading populated relations.
- Explicitly populated relations now preserve their wrapper row scalar fields
  when nested relations are also populated. This matches Order's use of
  wrapper rows such as `Return.items` and `Order.items`.
- Order has-many relations with versioned target rows are filtered to the
  parent order version for `items`, `shipping_methods`, `summary`, and
  `credit_lines`, preserving Order's versioned read semantics on Drizzle.
- Drizzle fetches hidden parent version fields needed for versioned relation
  filtering even when callers request relation fields like `items.detail`
  without explicitly selecting `version`.
- Related entity shipping-method projections for `Return`, `OrderExchange`,
  and `OrderClaim` are filtered to the related entity's `order_version`, so
  response shaping does not expose duplicate versioned shipping rows.
- Order return, exchange, and claim action helpers no longer create transient
  MikroORM entities with `transactionManager.create(...)` or
  `toMikroORMEntity(...)`. They build plain DTO objects with generated ids and
  persist through the existing module services.
- Return shipping creation now persists the return row before creating an
  `OrderShipping` row that references `return_id`, matching SQLite foreign-key
  enforcement.
- Array-overload calls to `createOrderShippingMethods` in return, exchange,
  and claim helpers now pass `sharedContext` in the third argument slot so
  nested calls keep the active transaction manager.
- `receiveReturn` retrieves the parent order graph before formatting so return
  items receive the same `detail` projection as the MikroORM path.
- `createExchange` and `createClaim` retrieve the parent order graph before
  formatting so additional items and related return items receive the expected
  `detail` projection.
- `SHIPPING_REMOVE` now accepts either the public shipping method id or the
  wrapper detail id when removing a shipping method from the calculated order.
- `SHIPPING_REMOVE` also matches by `return_id`, `claim_id`, or `exchange_id`
  for versioned related-entity shipping methods whose wrapper id changes
  between order versions.
- `create-order.spec.ts` and `delete-order.spec.ts` no longer request
  `MikroOrmWrapper`; their setup and fixture assertions use the existing Order
  service and generated list APIs instead.
- Drizzle unwraps virtual `detail` filters to the current wrapper row when the
  DML relation uses `detail` as a DTO projection rather than a physical
  column, covering filters such as `items.detail.shipped_quantity`.
- Drizzle expands virtual `detail` populate paths through owned `hasOne`
  relations so `items.detail` also hydrates the owned item row required by the
  existing Order DTO formatter.

Validation:

- `@medusajs/drizzle` tests passed: 40 tests.
- `@medusajs/drizzle` build passed.
- `@medusajs/order` build passed.
- Focused existing Order items/shipping integration suite through
  Drizzle/SQLite passed: 56 tests.
- Existing Order return integration suite through Drizzle/SQLite passed:
  2 tests.
- Existing Order exchange integration suite through Drizzle/SQLite passed:
  1 test.
- Existing Order claim integration suite through Drizzle/SQLite passed:
  1 test.
- Focused combined Order gate through Drizzle/SQLite passed: 4 suites,
  60 tests.
- Former setup-only blocker specs passed through Drizzle/SQLite:
  `create-order.spec.ts` and `delete-order.spec.ts`, 2 suites and 9 tests.
- Full existing Order integration suite through Drizzle/SQLite passed:
  9 suites and 77 tests.

Current limitations:

- Worker composition is tracked in the following Order Worker module-set
  record.

Next implementation step:

- Validate Order in the Worker commerce module set through the static manifest,
  import guard, production build, and workerd Durable Object SQLite proof.

## Order In Worker Commerce Module Set

Commit:

- 741dd3d0f1 (`Port commerce modules to Cloudflare static runtime`)

Order is now part of the Worker commerce module set through the same static
module loader used by Cart, Store, Sales Channel, Region, Customer, Product,
Stock Location, Inventory, Pricing, Tax, and Payment.

Differences from original Medusa:

- `@medusajs/order/static-manifest` exposes Order's module definition, module
  service, DML models, custom `OrderService`, and portable joiner config.
- The Cloudflare app composes the real Order module service through
  `createCommerceModulesRuntimeWithManager`; no Worker-local Order service or
  duplicate assertion path was introduced.
- Order's MikroORM lifecycle hook registration moved behind an optional
  Node-only `require` boundary, matching the existing Inventory pattern. The
  real Node/MikroORM path can still apply hooks, while Worker imports do not
  statically pull `@medusajs/framework/mikro-orm/*`.
- Order source files that enter the Worker graph now use relative local imports
  instead of unscoped package-local aliases such as `@models` and `@types`.
  This avoids Vite alias contamination between source-composed modules.
- Order framework type imports are marked `import type`, so production Worker
  bundling does not require runtime exports from `@medusajs/framework/types`.
- The Worker-safe `@medusajs/framework/utils` facade now exposes the exact
  Order utility enums and totals helpers used by the Order module.
- The Durable Object SQLite proof now creates and retrieves an Order with
  addresses, line items, shipping methods, and transactions from the composed
  module set.

Affected boundary:

- `packages/modules/order` static manifest, service portability, and source
  import hygiene.
- `apps/medusa-cloudflare` commerce module composition, Worker facade aliases,
  import guard aliases, and DO SQLite proof.

Validation:

- `@medusajs/order` build passed.
- Order static manifest test passed: 1 test.
- Full existing Order integration suite through Drizzle/SQLite passed:
  9 suites and 77 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 587 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,150.80 kB, gzip 202.75 kB.
- Order + Tax + Pricing + Payment + Product + Inventory + Customer + Stock
  Location + Region + Sales Channel + Store + Cart Durable Object SQLite
  workerd proof passed through the commerce module set.

Current limitations:

- This proof composes Order's module service and persistence path only. It does
  not solve HTTP route exposure, workflows, events, or external provider
  discovery.
- The Order Worker proof is intentionally narrow. The unchanged Order module
  integration suite remains the broader behavioral gate for repository
  semantics.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  module gate passes.

## Cloudflare Queue Event Bus Runtime Module Gate

Commit:

- `189aeb2ac5 Add Cloudflare Queue event bus module`

The Cloudflare runtime now has a Queue-backed Event Bus module implementation
for the existing Medusa Event Bus module boundary.

Differences from original Medusa:

- `@medusajs/event-bus-cloudflare` provides a Cloudflare-specific Event Bus
  module service with a module-owned static manifest.
- The Cloudflare app replaces Event Bus Local with the Queue-backed module in
  the Worker commerce runtime and requires a `MEDUSA_EVENTS` Queue producer
  binding.
- Events are enqueued to the configured Queue. Local subscriber dispatch stays
  enabled for this first runtime gate so existing lifecycle subscribers still
  run inside the current Durable Object composition.
- The app Vite config and import guard alias the Cloudflare Event Bus package
  to source, keeping the Worker graph auditable and avoiding CommonJS package
  output in workerd.
- No commerce module service, DML model, workflow, API handler, or app-local
  event abstraction was replaced.

Affected boundary:

- New `packages/modules/event-bus-cloudflare` module package.
- `apps/medusa-cloudflare` static module composition, Queue binding config,
  import guard aliases, and Cart Durable Object proof.

Validation:

- `@medusajs/event-bus-cloudflare` build passed.
- Focused Cloudflare Event Bus tests passed: 2 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 964 bundled inputs.
- Portable entrypoint guard passed.
- Production Worker build passed at 1,872.13 kB, gzip 340.90 kB.
- Durable Object SQLite workerd proof passed and asserts
  `eventBusProvider: "cloudflare-queue"`.

Current limitations:

- Queue consumer dispatch, retries, dead-letter handling, and cross-partition
  routing are not implemented yet.
- Local subscriber dispatch means this slice proves Queue producer wiring and
  current lifecycle compatibility, not fully asynchronous Event Bus semantics.
- `medusa-cloudflare` Vitest remains blocked by the existing Vite/Rolldown
  optimizer issue; production build and workerd proof pass.

## Cloudflare Queue Consumer Runtime Gate

Commit:

- `b44605b3d2 Add Cloudflare Queue consumer dispatch`

The Cloudflare runtime now dispatches Cloudflare Queue messages through the
existing Event Bus module service boundary.

Differences from original Medusa:

- `@medusajs/event-bus-cloudflare` exposes `dispatchQueuedEvent` for Queue
  consumer delivery. This path dispatches to registered subscribers without
  calling `queue.send` again.
- Queue message validation is explicit and typed. The Worker queue handler
  treats bodies as `unknown`, narrows them, skips invalid poison messages, and
  retries subscriber failures.
- `apps/medusa-cloudflare` declares the `medusa-events` consumer, retry count,
  and dead-letter queue in Wrangler config.
- `EventConsumerProofDO` is an app-local proof fixture only. It records that a
  proof event was delivered by the Worker Queue consumer; it is not a Medusa
  domain service or final partition topology.
- No commerce module service, DML model, workflow, API handler, or app-local
  replacement event system was introduced.

Affected boundary:

- `packages/modules/event-bus-cloudflare` consumer dispatch and validation.
- `apps/medusa-cloudflare` Worker Queue handler, Wrangler queue consumer
  config, Queue proof Durable Object, type declaration paths, and workerd
  proof script.

Validation:

- `@medusajs/event-bus-cloudflare` build passed.
- Focused Cloudflare Event Bus tests passed: 5 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 967 bundled inputs.
- Portable entrypoint guard passed.
- Production Worker build passed at 1,877.93 kB, gzip 342.18 kB.
- Durable Object SQLite workerd proof passed and verifies Queue consumer
  dispatch through `EventConsumerProofDO`.

Current limitations:

- Cross-partition routing and tenant/deployment runtime lookup are not solved.
- Subscriber progress persistence, idempotency, delayed scheduling parity, and
  dead-letter recovery handling remain later Event Bus runtime work.
- `medusa-cloudflare` Vitest remains blocked by the existing Vite/Rolldown
  optimizer issue; production build and workerd proof pass.

## Caching Runtime Module Gate

Commit:

- ab4b977c82 (`Add Caching to Cloudflare runtime module set`)

The Caching module is the first post-commerce runtime/infrastructure slice.
It now has an explicit static composition path while preserving the normal
Node module entry and unchanged integration assertions.

Differences from original Medusa:

- `@medusajs/caching/static-manifest` exposes the real
  `CachingModuleService`, `CachingProviderService`, hash loader, and a
  Worker-safe static provider loader for explicit static composition.
- The normal Caching module entry keeps the original dynamic provider loader
  and built-in Node memory provider. The Worker path does not import
  `node-cache`, `moduleProviderLoader`, or filesystem provider discovery.
- The Cloudflare app supplies a small in-memory Caching provider at the
  deployment root. This is adapter composition, not a replacement
  `CachingModuleService`.
- Caching source files that enter the Worker graph now use relative local
  imports instead of package-local `@types`/`@services` aliases.
- The Worker `@medusajs/framework/utils` shim now exposes only the Caching
  lifecycle helpers needed by this slice: a local GraphQL schema cleaner,
  `graphql`'s `buildSchema`, `toCamelCase`, and `upperCaseFirst`. It does not
  widen back to the Node-heavy utils barrel.
- The Worker `@medusajs/framework/modules-sdk` shim exposes `MedusaModule`
  through the existing portable modules-sdk entry instead of importing the
  framework/modules-sdk dist barrel.

Affected boundary:

- `packages/modules/caching` static manifest, static provider loading, package
  exports, and local import hygiene.
- `apps/medusa-cloudflare` runtime module composition, Worker memory caching
  provider, framework shims, import guard aliases, and DO SQLite proof.

Validation:

- `@medusajs/caching` build passed.
- Caching unit/static-manifest tests passed: 17 tests.
- Existing non-Redis Caching integration suite passed unchanged:
  3 suites and 28 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 868 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,776.00 kB, gzip 320.85 kB.
- Analytics + Caching + API Key + Auth + RBAC + Settings + Translation + File
  - Notification + Fulfillment + Order + Promotion + Tax + Pricing + Payment
  - Product + Inventory + Customer + Stock Location + Region + Sales Channel
  - Store + User + Cart Durable Object SQLite workerd proof passed through the
    composed module set.

Validation limitations:

- The Redis-specific Caching integration spec was not run because it requires
  an external Redis service.
- `yarn workspace medusa-cloudflare test` is currently blocked by a
  Vite/Rolldown dependency optimizer error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.
  The production build and actual workerd DO proof both pass.

Next implementation step:

- Continue runtime/infrastructure slices with the same pattern: preserve the
  real module service, isolate provider/runtime adapters behind static
  manifests, and validate the Worker graph with the import guard plus workerd
  proof.

## Event Bus Local Runtime Module Gate

Commit:

- 3653f4bd4a (`Add Event Bus Local to Cloudflare runtime set`)

Event Bus Local is now part of the Worker runtime module set. This slice keeps
the existing `LocalEventBusService` and makes the local in-process event
dispatch path portable enough for workerd composition.

Differences from original Medusa:

- `@medusajs/event-bus-local/static-manifest` exposes the Event Bus module
  definition, real `LocalEventBus` service, loader, and explicit static
  resources for Worker composition.
- `LocalEventBusService` no longer imports Node's `events` module or
  `timers/promises`. It uses a small local emitter and `globalThis.setTimeout`
  so the same service path can run in workerd.
- The normal module package export remains available for Node. The Worker app
  selects the static manifest at the application root.
- The Cloudflare app provides a narrow `AbstractEventBusModuleService` shim in
  its framework-utils compatibility file. This avoids importing the current
  Node-heavy event-bus utils barrel, which pulls `ulid` and Node crypto into
  the Worker graph.
- The framework-utils GraphQL type merge shim now uses
  `@graphql-tools/merge` before `buildSchema`, matching Medusa's duplicated
  scalar/directive/type-extension behavior closely enough for the composed
  Caching lifecycle to start.
- The Durable Object SQLite proof emits `product.updated` through the real
  Event Bus service and verifies the Caching module's lifecycle subscriber
  invalidates the cached product key.

Affected boundary:

- `packages/modules/event-bus-local` static manifest, package exports, local
  event emitter, and Node timer/event dependency removal.
- `apps/medusa-cloudflare` static runtime composition, framework utils shim,
  import guard aliases, and DO SQLite proof.

Validation:

- Event Bus Local unit/static-manifest tests passed: 12 tests.
- Existing Event Bus Local integration suite passed unchanged: 4 tests.
- `@medusajs/event-bus-local` build passed.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 955 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,853.22 kB, gzip 337.56 kB.
- Event Bus Local + Analytics + Caching + API Key + Auth + RBAC + Settings +
  Translation + File + Notification + Fulfillment + Order + Promotion + Tax +
  Pricing + Payment + Product + Inventory + Customer + Stock Location + Region
  - Sales Channel + Store + User + Cart Durable Object SQLite workerd proof
    passed through the composed module set, including cache invalidation through
    an emitted `product.updated` event.

Validation limitations:

- This is the local in-process Event Bus path only. It does not yet implement
  Cloudflare Queues, Durable Object fan-out, retries, or cross-partition
  delivery semantics.
- `yarn workspace medusa-cloudflare test` remains blocked by the same
  Vite/Rolldown dependency optimizer error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.
  The production build and actual workerd DO proof both pass.

Next implementation step:

- Continue runtime/infrastructure slices one boundary at a time. Locking is a
  good next target because it gives checkout and future queue processing a
  Worker-safe serialized coordination primitive.

## Locking Runtime Module Gate

Commit:

- a7c26835f7 (`Add Locking to Cloudflare runtime set`)

Locking is now part of the Worker runtime module set. This slice keeps the
existing `LockingModuleService` and default in-memory provider semantics while
making the static composition path Worker-safe.

Differences from original Medusa:

- `@medusajs/locking/static-manifest` exposes the Locking module definition,
  real `LockingModuleService`, provider service, static provider loader, and
  explicit static resources for Worker composition.
- The normal Node Locking module entry keeps the original dynamic provider
  loader. The Worker graph uses the static loader and does not import
  `moduleProviderLoader` through the Locking package.
- `InMemoryLockingProvider` no longer depends on Node-only timer `unref()` being
  present. It uses `globalThis.setTimeout` and narrows the optional `unref`
  method before calling it.
- Locking source files touched by this slice now use type-only framework
  imports where possible and avoid package-local `@types` imports in the
  Worker-entered service path.
- Provider identifier lookup and caught-error handling in
  `LockingProviderService` no longer rely on unchecked `any` access.
- The package export map includes explicit `node`, `require`, `import`, and
  `default` entries so the existing Medusa Node integration wrapper continues
  to resolve `@medusajs/locking`.
- The Durable Object SQLite proof runs concurrent stock-consuming jobs through
  the real Locking module `execute` method and verifies the critical section is
  serialized.

Affected boundary:

- `packages/modules/locking` static manifest, package exports, static provider
  loading, default in-memory provider timer portability, and provider-service
  type narrowing.
- `apps/medusa-cloudflare` runtime module composition, import guard aliases,
  type paths, and DO SQLite proof.

Validation:

- `@medusajs/locking` build passed.
- Locking unit/static-manifest test passed: 1 test.
- Existing Locking integration suite passed unchanged: 6 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 962 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,862.83 kB, gzip 339.10 kB.
- Locking + Event Bus Local + Analytics + Caching + API Key + Auth + RBAC +
  Settings + Translation + File + Notification + Fulfillment + Order +
  Promotion + Tax + Pricing + Payment + Product + Inventory + Customer + Stock
  Location + Region + Sales Channel + Store + User + Cart Durable Object SQLite
  workerd proof passed through the composed module set, including serialized
  locking, cache invalidation, cart totals, and atomic rollback.

Validation limitations:

- This slice proves the default in-memory Locking provider in a single Worker
  isolate and Durable Object instance. It does not yet implement a
  cross-isolate or cross-partition Durable Object locking provider.
- Redis and Postgres locking providers remain Node infrastructure providers and
  were not pulled into the Worker graph.
- `yarn workspace medusa-cloudflare test` remains blocked by the same
  Vite/Rolldown dependency optimizer error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.
  The production build and actual workerd DO proof both pass.

Next implementation step:

- Continue runtime/infrastructure slices one boundary at a time. The next
  strongest target is a real Cloudflare Durable Object locking provider or the
  queue-backed Event Bus provider, depending on whether checkout coordination
  or asynchronous delivery should be proven first.

## Cloudflare Durable Object Locking Provider Gate

Commit:

- bc4711409d (`Add Cloudflare Durable Object locking provider`)

The Worker runtime now uses a real Cloudflare Durable Object-backed Locking
provider through the existing `LockingModuleService` provider boundary.

Differences from original Medusa:

- Added `@medusajs/locking-cloudflare` as a separate Locking provider package.
  This keeps Cloudflare-specific infrastructure out of the shared Locking
  module service.
- The provider exports `lockingCloudflareProvider` from a Worker-safe
  `./provider` entry. The Cloudflare app imports that dedicated provider entry,
  not the package default `ModuleProvider` entry.
- Added `MedusaLockingDO` to `apps/medusa-cloudflare`. It stores locks in
  Durable Object storage and supports acquire, release, and release-all.
- The provider uses one named coordinator DO instance per configured scope.
  That preserves Medusa's `releaseAll` provider contract for this first
  Cloudflare provider gate.
- The Cloudflare app configures the existing Locking module's static provider
  loader with the Durable Object provider when the `MEDUSA_LOCKING` binding is
  present.
- The Cart Durable Object proof now requires `MEDUSA_LOCKING`; it fails rather
  than silently falling back to the in-memory provider.
- The proof still calls `runtime.locking.service.execute`, so the public
  Locking module API and service path remain unchanged.

Affected boundary:

- New `packages/modules/providers/locking-cloudflare` provider package.
- `apps/medusa-cloudflare` Durable Object bindings, Worker export surface,
  Locking provider composition, import guard aliases, and DO SQLite proof.
- `yarn.lock` workspace metadata for the new provider package.

Validation:

- `@medusajs/locking-cloudflare` build passed.
- `@medusajs/locking-cloudflare` unit test passed: 1 test.
- Locking unit/static-manifest test passed: 1 test.
- Existing Locking integration suite passed unchanged: 6 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 965 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,871.73 kB, gzip 340.81 kB.
- Durable Object Locking + Event Bus Local + Analytics + Caching + API Key +
  Auth + RBAC + Settings + Translation + File + Notification + Fulfillment +
  Order + Promotion + Tax + Pricing + Payment + Product + Inventory + Customer
  - Stock Location + Region + Sales Channel + Store + User + Cart Durable
    Object SQLite workerd proof passed, including DO-backed serialized locking,
    cache invalidation, cart totals, and atomic rollback.

Validation limitations:

- This provider uses one named coordinator DO instance for the configured
  scope. It is correct for the current proof and preserves `releaseAll`, but it
  is not the final high-throughput sharded locking topology.
- The next evolution should introduce explicit lock-scope partitioning once the
  platform tenant/environment/deployment partition model is in place.
- `yarn workspace medusa-cloudflare test` remains blocked by the same
  Vite/Rolldown dependency optimizer error:
  `Missing field tsconfigPaths on BindingViteResolvePluginConfig.resolveOptions`.
  The production build and actual workerd DO proof both pass.

Next implementation step:

- Continue runtime/infrastructure slices one boundary at a time. The next
  strongest target is a queue-backed Event Bus provider, because local event
  dispatch and DO-backed locking are now both proven in the Worker module set.

## Translation Drizzle Module Gate

Commit:

- b779457284 (`Add Translation to Cloudflare commerce module set`)
- d7dee077be (`Cover Translation query pagination`)

The Translation module Drizzle gate now passes through the real Translation
module service on the Drizzle/SQLite module-test path.

Differences from original Medusa:

- Translation no longer uses the Postgres-only MikroORM raw filter
  `translations::text ILIKE ?` in the shared module service. The service
  removes `q` from repository filters, searches serialized translation JSON in
  TypeScript, and reapplies `skip`/`take` after filtering so `q` pagination and
  counts remain aligned with the original filter-before-page intent.
- A focused unchanged-suite regression now locks the `q` plus `skip`/`take`
  behavior: matching rows are counted before pagination, and only the requested
  page of matches is returned.
- `getStatistics` no longer requires a MikroORM/Postgres
  `manager.getKnex()` boundary. It uses the existing internal
  `translationService_.list` path and aggregates `translated_field_count` in
  TypeScript.
- Translation source files that enter the Worker graph now use relative local
  imports instead of package-local aliases such as `@models`, `@services`, and
  `@utils`.
- Translation framework/type imports are marked type-only where possible, and
  the default-locale loader now narrows caught errors before reading the
  message.
- `ModulesDefinition` now includes `Modules.TRANSLATION` so static bootstrap
  can load Translation through the same module-definition path as the other
  composed modules.
- No replacement Translation service, DML model, public API, or app-local
  assertion suite was introduced.

Affected boundary:

- `packages/modules/translation` service portability, import hygiene, static
  manifest, and default-locale loader typing.
- `packages/core/modules-sdk` portable module definition table.
- Existing Translation module service behavior through the shared Drizzle
  repository path.

Validation:

- `@medusajs/translation` build passed.
- Translation static manifest test passed: 1 test.
- Existing Translation integration suite through Drizzle/SQLite passed:
  1 suite and 60 tests.

Current limitations:

- The portable `q` search is intentionally service-level JSON matching. It
  preserves current assertions and avoids a Postgres-only SQL dependency, but a
  backend-specific indexed JSON search adapter can still be added later for
  large translation tables.

## Analytics Drizzle Module Gate

Commit:

- 9dfa3d2f22 (`Add Analytics to Cloudflare commerce module set`)

The Analytics module Drizzle gate now passes through the real Analytics module
service on the Drizzle/SQLite module-test path.

Differences from original Medusa:

- Analytics now has a module-owned static manifest for explicit Worker
  composition.
- A Worker-safe static provider loader was added. It accepts already imported
  provider exports and rejects filesystem provider paths. The normal Node
  module entry keeps the original dynamic provider loader and filesystem
  provider discovery behavior.
- Analytics provider registration types are narrowed so provider constructors
  do not rely on implicit `any`, and Analytics service error handling now
  narrows caught errors before reading messages.
- `ModulesDefinition` now includes `Modules.ANALYTICS` so static bootstrap can
  load Analytics through the same module-definition path as other composed
  modules.
- No replacement Analytics service, provider contract, public API, or
  app-local assertion suite was introduced.

Affected boundary:

- `packages/modules/analytics` provider loader typing, static manifest, and
  static provider loading.
- `packages/core/modules-sdk` portable module definition table.
- Existing Analytics module service behavior through the shared module-test
  path.

Validation:

- `@medusajs/modules-sdk` build passed.
- `@medusajs/analytics` build passed.
- Analytics static manifest test passed: 1 test.
- Existing Analytics integration suite through Drizzle/SQLite passed:
  1 suite and 3 tests.

## Settings Drizzle Module Gate

Commit:

- 181d023304 (`Add Settings to Cloudflare commerce module set`)

Settings now passes the unchanged module integration assertions through the
shared Drizzle repository path.

Differences from original Medusa:

- No Settings-specific Drizzle repository was required. The existing Settings
  module service runs through the generic Drizzle DML repository and internal
  service path.
- Settings source files that enter the Worker graph now use relative local
  imports instead of package-local aliases such as `@/models` and
  `@/services`.
- Settings framework type imports are marked `import type` where possible, so
  production Worker bundling does not require runtime exports from
  `@medusajs/framework/types`.
- `@medusajs/settings/static-manifest` exposes Settings' module definition,
  real module service, DML models, and portable joiner config for explicit
  Worker composition.

Affected boundary:

- `packages/modules/settings` import hygiene, package export, static manifest,
  and static manifest drift test.
- Existing Drizzle `upsertWithReplace` JSON replacement behavior as exercised
  by Settings view-configuration updates.

Validation:

- `@medusajs/settings` build passed.
- Settings static manifest test passed: 1 test.
- Existing Settings integration suite through Drizzle/SQLite passed:
  1 suite and 11 tests.

## RBAC Drizzle Module Gate

Commit:

- 6f7b30e5e5 (`Add RBAC to Cloudflare commerce module set`)

RBAC now passes the unchanged module integration assertions through the shared
Drizzle repository path.

Differences from original Medusa:

- The Drizzle persistence adapter now provides an RBAC custom repository when
  the module requests `rbacRepository`. The original RBAC module service still
  depends on the same repository name and the same public service methods.
- The Drizzle RBAC repository replaces the original MikroORM/Knex/Postgres
  recursive SQL with SQLite/D1-compatible hierarchy traversal over the same
  DML tables: roles, role parents, role policies, and policies.
- The original Node RBAC repository remains unchanged for the MikroORM/Postgres
  path.
- RBAC source files that enter the Worker graph now use relative local imports
  instead of package-local aliases such as `@models`, `@services`, and
  `@repositories`.
- RBAC framework and Medusa type imports are marked `import type` where
  possible, so production Worker bundling does not require runtime exports from
  type-only packages.

Affected boundary:

- `packages/database/drizzle` custom repository selection and RBAC hierarchy
  query behavior.
- `packages/modules/rbac` import hygiene, static manifest, and static manifest
  drift test.

Validation:

- `@medusajs/drizzle` build passed.
- `@medusajs/utils` build passed after extracting the portable policy
  registry.
- `@medusajs/modules-sdk` build passed after adding RBAC to the shared module
  definition map.
- `@medusajs/rbac` build passed.
- RBAC static manifest test passed: 1 test.
- Existing RBAC integration suite through Drizzle/SQLite passed:
  1 suite, 6 tests passing, and 1 skipped existing linkable-config test.

## Notification Drizzle Module Gate

Commit:

- 2169c97ce5 (`Add Notification to Cloudflare commerce module set`)

Notification now passes the unchanged module integration assertions through the
shared Drizzle repository path.

Differences from original Medusa:

- Drizzle SQLite maps DML `array` columns to JSON-backed `text` columns, the
  same storage mode already used for DML `json` columns. Notification provider
  synchronization requires this because provider `channels` are arrays and are
  written through upsert conflict updates.
- A focused Drizzle regression test now covers array-column serialization
  across insert and conflict-update upsert paths.
- Notification source files that enter the Worker graph now use relative local
  imports instead of package-local aliases such as `@models`, `@services`, and
  `@types`.
- Notification framework type imports are marked `import type` where possible,
  so Worker bundling does not require runtime exports from
  `@medusajs/framework/types`.
- A Worker-safe static provider loader was added for explicit provider
  composition. The normal Node module entry keeps the original dynamic
  provider loader and filesystem provider discovery behavior.

Affected boundary:

- `packages/database/drizzle` SQLite DML column mapping and repository upsert
  behavior.
- `packages/modules/notification` import hygiene, static manifest, and static
  provider loader.

Validation:

- `@medusajs/drizzle` build passed.
- Focused Drizzle array upsert regression passed: 1 test.
- `@medusajs/notification` build passed.
- Notification static manifest test passed: 1 test.
- Existing Notification integration suite through Drizzle/SQLite passed:
  2 suites and 11 tests.

## User Drizzle Module Gate

Commit:

- 741dd3d0f1 (`Port commerce modules to Cloudflare static runtime`)

The User module Drizzle gate now passes through the real User module service on
the Drizzle/SQLite module-test path.

Differences from original Medusa:

- The shared Drizzle mutation event mapper now preserves Medusa's original
  User module event source for Invite mutations. Invite create/update/delete
  events are emitted under the `user` source instead of a conventional
  `invite` source.
- User invite token creation and validation no longer statically import
  `jsonwebtoken` or Node crypto in the source path that enters the Worker
  graph. A small Web Crypto JWT helper signs and verifies HS256/HS384/HS512
  tokens while preserving the existing invite-token service contract.
- The existing User module service, DML models, public service methods, and
  integration assertions remain the behavioral specification. No replacement
  User service or app-local assertion path was introduced.

Affected boundary:

- `packages/database/drizzle` mutation event naming.
- `packages/modules/user` invite token helper and import hygiene for the
  Worker-safe source graph.

Validation:

- `@medusajs/drizzle` build passed.
- `@medusajs/user` build passed.
- Existing User integration suite through Drizzle/SQLite passed: 28 tests.

Current limitations:

- This slice validates User service persistence and invite-token behavior. It
  does not expose User HTTP routes, auth middleware, workflow usage, or a full
  Cloudflare auth/session boundary.

## Auth Drizzle Module Gate

Commit:

- 488e502b79 (`Add Auth to Cloudflare commerce module set`)

The Auth module Drizzle gate now passes through the real Auth module service on
the Drizzle/SQLite module-test path.

Differences from original Medusa:

- Auth source files that enter the Worker graph now use relative local imports
  instead of package-local aliases such as `@services`, `@models`, and
  `@types`.
- Framework type imports in Worker-entered Auth files are marked type-only so
  production Worker bundling does not require runtime exports from
  `@medusajs/framework/types`.
- No replacement Auth service, DML model, public API, or app-local assertion
  suite was introduced.

Affected boundary:

- `packages/modules/auth` import hygiene and package export surface.
- Existing Auth module service persistence through the shared Drizzle
  repository path.

Validation:

- `@medusajs/auth` build passed.
- Existing Auth integration suite through Drizzle/SQLite passed: 36 tests.

Current limitations:

- This slice validates Auth identity and provider-identity persistence. Dynamic
  provider discovery, Medusa Cloud OAuth execution, HTTP auth routes, sessions,
  and auth middleware are separate runtime boundaries.

## File Drizzle Module Gate

Commit:

- 47f566f9db (`Add File to Cloudflare commerce module set`)

The File module Drizzle gate now passes through the real File module service on
the Drizzle/SQLite module-test path.

Differences from original Medusa:

- File source files that enter the Worker graph now use relative local imports
  instead of package-local aliases such as `@services` and `@types`.
- Framework type imports in Worker-entered File files are marked type-only so
  production Worker bundling does not require runtime exports from
  `@medusajs/framework/types`.
- File now has a static manifest for explicit Worker composition. The normal
  Node module entry still uses the original dynamic provider loader.
- The static manifest uses a narrow static provider loader that accepts already
  imported provider exports only. It does not resolve providers from filesystem
  paths and does not import the Node dynamic-import provider-loader path.
- No replacement File service, public API, or app-local assertion suite was
  introduced.

Affected boundary:

- `packages/modules/file` import hygiene, static manifest, and static provider
  loader.
- Existing File module service provider-backed behavior through the shared
  module-test path.

Validation:

- `@medusajs/file` build passed.
- File static manifest/package tests passed: 2 tests.
- Existing File integration suite through Drizzle/SQLite passed: 4 tests.

Current limitations:

- This slice validates File service composition and a Worker in-memory provider
  proof. Durable object-backed blob storage, R2/S3 adapters, stream APIs,
  buffer APIs, HTTP upload routes, and production provider configuration remain
  separate runtime boundaries.

## Promotion Drizzle Module Gate

Commit:

- 741dd3d0f1 (`Port commerce modules to Cloudflare static runtime`)

The real Promotion module service now passes its existing integration suite
through the shared Drizzle/SQLite module-test persistence path.

Differences from original Medusa:

- Promotion's Drizzle path now uses service-backed integration fixtures instead
  of direct MikroORM fixture writes where the Drizzle test runner does not
  expose `MikroOrmWrapper`.
- Promotion's DML metadata explicitly names legacy pivot columns for
  application-method rule pivots, matching the original MikroORM migration
  schema (`application_method_id`, `promotion_rule_id`).
- Promotion's list wrappers preserve original module behavior that returns
  `application_method` and campaign `budget` by default when callers are not
  using explicit field projections.
- Promotion's compute-action prefilter keeps the MikroORM Knex optimization
  when a Knex-backed manager is present, and skips that optimization under
  Drizzle instead of assuming `manager.getKnex()`.
- The shared Drizzle adapter now supports Promotion-required raw filter keys,
  reverse-owned `hasOne` hydration, restore-time unique validation, and
  existing-target detection before treating keyed nested `hasMany` values as
  relation links.

Affected boundary:

- `packages/modules/promotion` service defaults, test fixtures, DML pivot
  metadata, and compute-action query-filter utility.
- `packages/database/drizzle` Medusa repository relation loading, raw filter
  handling, restore validation, and generic repository raw-filter handling.

Validation:

- `@medusajs/drizzle` build passed.
- `@medusajs/promotion` build passed.
- Focused Drizzle Medusa repository spec passed: 44 tests.
- Existing Promotion integration suite through Drizzle/SQLite passed: 6
  suites, 178 tests.

Current limitations:

- Promotion is not yet added to the Worker commerce module set in this record.
- The Promotion raw filter path is accepted for Medusa's existing raw SQL
  filter keys; it is not a general-purpose SQL interpolation API.

Next implementation step:

- Add Promotion to the Worker commerce module set only after creating a static
  manifest and validating the Cloudflare app import guard, build, app tests,
  and workerd Durable Object SQLite proof.

## Fulfillment Drizzle Module Gate

Commit:

- 741dd3d0f1 (`Port commerce modules to Cloudflare static runtime`)

The Fulfillment module Drizzle gate now passes through the real Fulfillment
module service on the Drizzle/SQLite module-test path.

Differences from original Medusa:

- Portable DAL id defaults now use Medusa's prefix plus ULID-style id shape
  instead of UUID-shaped ids. This preserves default id ordering assumptions in
  existing module assertions.
- The shared Drizzle repository now supports plain `update` of FK-backed
  `hasMany` collections, including create, update, delete, retained-child
  no-op handling, and nested child relation replacement.
- Plain Drizzle `update` now strips primary keys from the update payload and
  skips parent-row mutation events when only child collections changed.
- Plain Drizzle `update` ignores empty collection arrays, matching the
  Fulfillment provider callback path where `labels: []` must not delete
  already-created labels.
- Nested owned to-one create targets now emit created mutation events.
- Fulfillment-owned nested model fallback events now use the `fulfillment`
  source for models such as service zones, geo zones, shipping options,
  fulfillment items, labels, and addresses.
- `FulfillmentModuleService.updateShippingOptionTypes_` now marks its shared
  context parameter with `@MedusaContext`, matching the transaction decorator
  contract.
- `fulfillment-module-service/index.spec.ts` no longer destructures
  `MikroOrmWrapper` during suite setup. The provider assertion uses the real
  module service for Drizzle and keeps the fresh bootstrap provider-toggle
  assertion on MikroORM until nested `initModules` exposes adapter composition.
- No replacement Fulfillment service, DML model, provider contract, public API,
  or app-local assertion suite was introduced.

Affected boundary:

- `@medusajs/dal` portable model defaulting.
- `packages/database/drizzle` shared Medusa persistence adapter and fallback
  mutation-event naming.
- Existing `@medusajs/fulfillment` module service transaction context and
  integration fixture setup.

Validation:

- `@medusajs/dal` build passed.
- `@medusajs/drizzle` build passed.
- Drizzle focused Medusa repository tests passed: 44 tests.
- `@medusajs/fulfillment` build passed.
- Existing Fulfillment integration suite through Drizzle/SQLite passed:
  75 tests.

Next implementation step:

- Add Fulfillment to the Worker commerce module set only after creating a
  module-owned static manifest and auditing provider-loader portability.

## Fulfillment In Worker Commerce Module Set

Commit:

- 741dd3d0f1 (`Port commerce modules to Cloudflare static runtime`)

Fulfillment is now part of the Worker commerce module set through the same
static module loader used by the other composed commerce modules.

Differences from original Medusa:

- `@medusajs/fulfillment/static-manifest` exposes Fulfillment's module
  definition, module service, DML models, provider service, and original
  joiner config for explicit Worker composition.
- The Cloudflare app composes the real Fulfillment module service through
  `createCommerceModulesRuntimeWithManager`; no Worker-local Fulfillment
  service or duplicate assertion path was introduced.
- The Worker manifest intentionally omits Fulfillment's dynamic provider
  loader. Provider discovery remains a separate portability boundary; this
  proof creates the provider row needed by the existing service path.
- Fulfillment source files that enter the Worker graph now use relative local
  imports instead of unscoped package-local aliases such as `@models` and
  `@utils`.
- Fulfillment framework type imports are marked `import type`, so production
  Worker bundling does not require runtime exports from
  `@medusajs/framework/types`.
- Fulfillment utility imports were narrowed so `fulfillment/events` uses the
  portable event-bus and module-definition leaves instead of broad utils
  barrels.
- `deepCopy` no longer statically imports `node:util`; Worker composition no
  longer pulls Node util only to detect proxies.
- The Durable Object SQLite proof now creates a Fulfillment provider row,
  fulfillment set, service zone, geo zone, shipping profile, and shipping
  option from the composed module set before running the existing commerce
  proof.

Affected boundary:

- `packages/modules/fulfillment` static manifest, package export, and source
  import hygiene.
- `packages/core/utils` portable utility import graph for Fulfillment events
  and deep copy.
- `apps/medusa-cloudflare` commerce module composition, Worker facade aliases,
  import guard aliases, and DO SQLite proof.

Validation:

- `@medusajs/utils` build passed.
- `@medusajs/fulfillment` build passed.
- Fulfillment static manifest test passed: 1 test. The package test command
  also ran the existing utils suite, for 23 total passing tests.
- Existing Fulfillment integration suite through Drizzle/SQLite passed:
  75 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 623 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,250.79 kB, gzip 218.23 kB.
- Cloudflare app tests passed: 2 tests.
- API Key + Fulfillment + Order + Tax + Pricing + Payment + Product +
  Inventory + Customer + Stock Location + Region + Sales Channel + Store +
  Cart Durable Object SQLite workerd proof passed through the commerce module
  set.
- `git diff --check` passed.

Current limitations:

- This proof composes Fulfillment's module service and persistence path only.
  It does not solve external provider discovery, provider action execution,
  HTTP route exposure, events, or workflows.
- The Worker proof validates static Fulfillment data creation and retrieval.
  The unchanged Fulfillment module integration suite remains the broader
  behavioral gate for provider callback and repository semantics.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  module gate passes.

## API Key Drizzle Module Gate

Commit:

- 741dd3d0f1 (`Port commerce modules to Cloudflare static runtime`)

The API Key module Drizzle gate now passes through the real API Key module
service on the Drizzle/SQLite module-test path.

Differences from original Medusa:

- The shared Drizzle repository now treats `$eq: null` as SQL `IS NULL` and
  `$ne: null` as SQL `IS NOT NULL`, including when those operators appear
  inside `$or` filters.
- The Drizzle repository now coerces string filter values for custom date-like
  fields ending in `_at` or `_date`, covering API Key's `revoked_at` filter
  behavior.
- `ApiKeyModuleService.createApiKeys` reloads persisted rows before public
  serialization so the Drizzle path returns database-shaped timestamps while
  preserving the one-time raw token response.
- `ApiKeyModuleService.updateApiKeys_` skips no-op title updates and returns
  existing rows in request order, matching the unchanged integration
  assertions for no-op updates.
- Public create/update API Key responses preserve `salt: undefined` while the
  database row keeps the required salt field.
- No replacement API Key service, DML model, public API, or app-local
  assertion suite was introduced.

Affected boundary:

- `packages/database/drizzle` filter translation and date filter coercion.
- Existing `@medusajs/api-key` module service result shaping for the Drizzle
  persistence path.

Validation:

- Drizzle focused Medusa repository tests passed: 41 tests.
- `@medusajs/drizzle` build passed.
- `@medusajs/api-key` build passed.
- Existing API Key integration suite through Drizzle/SQLite passed: 25 tests.

## API Key In Worker Commerce Module Set

Commit:

- 741dd3d0f1 (`Port commerce modules to Cloudflare static runtime`)

API Key is now part of the Worker commerce module set through the same static
module loader used by the other composed commerce modules.

Differences from original Medusa:

- `@medusajs/api-key/static-manifest` exposes API Key's module definition,
  module service, DML model, and portable joiner config for explicit Worker
  composition.
- The Cloudflare app composes the real API Key module service through
  `createCommerceModulesRuntimeWithManager`; no Worker-local API Key service
  or duplicate assertion path was introduced.
- API Key source files that enter the Worker graph now use relative local
  imports instead of unscoped package-local aliases such as `@models` and
  `@types`.
- API Key framework type imports are marked `import type`, so production
  Worker bundling does not require runtime exports from
  `@medusajs/framework/types`.
- API Key random byte generation moved behind a small runtime helper. Node
  keeps using Node crypto, preserving the existing integration tests and
  secret-key scrypt hashing. Worker publishable-key generation uses
  `globalThis.crypto.getRandomValues`.
- Secret API key generation and authentication still require a scrypt-capable
  crypto adapter in Worker. This slice intentionally proves publishable API
  keys only; it does not silently switch Medusa secret keys to a different KDF.
- The Durable Object SQLite proof now creates and lists a publishable API key
  from the composed module set before running the existing commerce proof.

Affected boundary:

- `packages/modules/api-key` static manifest, crypto portability, and source
  import hygiene.
- `apps/medusa-cloudflare` commerce module composition, Worker facade aliases,
  import guard aliases, and DO SQLite proof.

Validation:

- `@medusajs/api-key` build passed.
- API Key static manifest test passed: 1 test.
- Existing API Key integration suite through Drizzle/SQLite passed: 25 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 595 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,168.77 kB, gzip 205.93 kB.
- Cloudflare app tests passed: 2 tests.
- API Key + Order + Tax + Pricing + Payment + Product + Inventory + Customer +
  Stock Location + Region + Sales Channel + Store + Cart Durable Object SQLite
  workerd proof passed through the commerce module set.

Current limitations:

- Secret API key hashing still needs a deliberate Worker-safe scrypt adapter or
  versioned KDF migration plan before secret key creation/authentication can be
  considered Worker-complete.
- This proof composes API Key's module service and persistence path only. It
  does not solve HTTP route exposure, auth middleware, events, or workflows.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  module gate passes.

## Index Portable Storage Provider Boundary

Commit:

- This commit (`Add portable Index storage provider boundary`)

The Index module is not a normal DML module gate. It already has a storage
provider abstraction, but the default module entry and reset path were coupled
to the Postgres/MikroORM provider. This slice starts the Worker path by making
the shared Index service depend on provider contracts while keeping the default
Node/Postgres module behavior unchanged.

Differences from original Medusa:

- `IndexModuleService` no longer imports `@medusajs/framework/mikro-orm`,
  `MikroOrmBaseRepository`, `toMikroORMEntity`, or the Index data/relation
  models only to truncate Postgres tables.
- The Postgres table truncate behavior moved to
  `PostgresIndexResetHandler`, which the default Node loader registers
  alongside `PostgresProvider`.
- `@medusajs/index/src/portable` exposes a separate portable module entry that
  uses a portable loader and requires the application root to provide a storage
  provider adapter explicitly.
- The portable loader accepts the existing custom-adapter shape as well as an
  explicit `storageProvider` or `storageProviderCtr` option. It does not import
  the default Postgres provider.
- No replacement Index service, query engine, HTTP route, or app-local fake was
  introduced.

Affected boundary:

- `packages/modules/index` service/provider composition.
- The future Worker composition root can target the portable Index entry
  instead of importing the default Node/Postgres module entry.

Validation:

- `@medusajs/index` unit tests passed: 4 suites, 13 tests.
- `@medusajs/index` build passed.
- A new portable-entry regression test asserts that the portable entry,
  portable loader, and shared Index service do not statically import the
  Postgres provider, MikroORM, `MikroOrmBaseRepository`, or
  `toMikroORMEntity`.

Current limitations:

- The unchanged `@medusajs/index` integration suite still runs through the
  Postgres provider and was locally blocked by unknown PostgreSQL credentials:
  `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`.
  Re-running
  `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle yarn workspace @medusajs/index test:integration --runInBand`
  after this slice produced the same credential blocker: 5 suites failed while
  creating Postgres databases, and the non-DB orchestrator suite passed.
- There is not yet a SQLite/D1 Index storage provider. The portable entry is
  only the boundary that lets us add one without pulling Postgres into the
  Worker import graph.

Next implementation step:

- Add a minimal SQLite/D1 Index storage provider adapter behind the portable
  entry, then run the existing Index integration assertions against that
  provider instead of creating parallel contract tests.

## Index SQLite Storage Provider Mutation Slice

Commit:

- This commit (`Add SQLite Index storage mutation provider`)

The portable Index entry now exposes the first SQLite/D1-compatible storage
provider implementation. This slice covers schema creation and event-driven
Index storage mutations; it intentionally does not claim query parity yet.

Differences from original Medusa:

- Added `SqliteIndexStorageProvider` behind `@medusajs/index/src/portable`.
- The provider uses an injected `SqliteIndexExecutor` contract instead of
  MikroORM repositories, Knex, `pg`, or Node-specific database APIs.
- The provider creates `index_data` and `index_relation` tables using SQLite
  DDL.
- Create/update/delete/attach/detach event paths now have SQLite SQL
  mutations that preserve the same Index storage semantics as the Postgres
  provider for entity rows and relation rows.
- `consumeEvent` reuses the Medusa Index contract: events rehydrate entity
  data through `query.graph` before applying storage mutations.
- `query` currently fails loudly because SQLite query parity requires a
  dedicated SQLite Index query builder rather than silently reusing the
  Postgres/Knex query builder.
- No replacement Index service, route, app-local fake, or parallel assertion
  suite was introduced.

Affected boundary:

- `packages/modules/index` portable storage provider adapter surface.
- Future Worker composition can provide a D1 or Durable Object SQLite executor
  to this provider through the portable loader.

Validation:

- `@medusajs/index` focused unit tests passed: 5 suites, 19 tests.
- `@medusajs/index` build passed.
- Portable-entry regression test now covers the SQLite provider and confirms
  the portable import graph does not statically import the Postgres provider,
  MikroORM, `MikroOrmBaseRepository`, or `toMikroORMEntity`.
- `git diff --check` passed.

Current limitations:

- The SQLite provider does not implement Index `query` yet.
- Existing Index integration assertions cannot pass through SQLite/D1 until the
  SQLite query builder is implemented and wired into the provider.

Next implementation step:

- Add the SQLite Index query-builder slice for the subset covered by the
  existing Index query integration assertions, then run those assertions
  against the portable provider.

## Index SQLite Root Query Slice

Commit:

- This commit (`Add SQLite Index root query support`)

The SQLite Index provider now supports direct root-entity queries. This is the
first query-builder slice behind the portable provider; relation joins remain
separate work.

Differences from original Medusa:

- Added a portable `sqlite-query-builder` that does not import Knex, MikroORM,
  or the Postgres query builder.
- `SqliteIndexStorageProvider.query` now builds and executes SQLite SQL for
  root-entity `index_data` rows.
- Supported query behavior in this slice:
  - root entry resolution from fields, filters, or order.
  - direct JSON field filters using `$eq`, `$ne`, `$like`, `$ilike`, `$in`,
    `$nin`, `$gt`, `$gte`, `$lt`, and `$lte`.
  - direct JSON field ordering.
  - `take`/`skip` pagination metadata with count queries.
  - `idsOnly` root-row responses.
- Unsupported relation joins still fail by omission rather than pretending to
  match the Postgres/Knex query builder.
- No replacement Index service, route, app-local fake, or parallel integration
  suite was introduced.

Affected boundary:

- `packages/modules/index` portable SQLite query adapter.

Validation:

- `@medusajs/index` focused unit tests passed: 5 suites, 21 tests.
- `@medusajs/index` build passed.
- Portable-entry regression test now covers the SQLite query builder and
  confirms the portable import graph does not statically import the Postgres
  provider, MikroORM, `MikroOrmBaseRepository`, or `toMikroORMEntity`.
- `git diff --check` passed.

Current limitations:

- Relation traversal through `index_relation` is not implemented yet, so the
  existing Product/Variant/Price Index integration assertions are not expected
  to pass through SQLite/D1 yet.

Next implementation step:

- Add the relation-join SQLite query slice for the product -> variant ->
  price-set -> price path covered by the unchanged Index query integration
  assertions.

## Index SQLite Relation Traversal Slice

Commit:

- This commit (`Add SQLite Index relation traversal`)

The SQLite Index provider now hydrates requested nested fields through
`index_relation`. This makes the portable provider able to return nested
commerce read models such as product variants and prices instead of only root
`index_data` rows.

Differences from original Medusa:

- The portable SQLite query plan now records a relation tree from requested
  field paths such as `product.variants.*` and
  `product.variants.prices.*`.
- `SqliteIndexStorageProvider.query` walks `index_relation` breadth-first from
  the current parent entity to the requested target entity, then loads matching
  target rows from `index_data`.
- The traversal supports intermediate link entities, covering the existing
  Product -> ProductVariant -> ProductVariantPriceSet -> PriceSet -> Price
  path without importing the Postgres/Knex query builder.
- Nested rows are attached to the parent response under the requested field
  segment, e.g. `variants` and `prices`.
- The same hydration path respects `idsOnly` for nested rows.
- No replacement Index service, route, app-local fake, or parallel integration
  suite was introduced.

Affected boundary:

- `packages/modules/index` portable SQLite query adapter and provider
  relation hydration.

Validation:

- `@medusajs/index` focused unit tests passed: 5 suites, 22 tests.
- `@medusajs/index` build passed.
- Portable import graph check passed for the portable Index entry, portable
  loader, shared service, SQLite provider, and SQLite query builder.
- `git diff --check` passed.

Current limitations:

- Nested relation filters and nested relation ordering are not implemented yet.
  Existing Index query assertions that filter/order by variant SKU or price
  amount still require another SQLite query slice.

Next implementation step:

- Add SQLite nested filter/order support for the variant SKU and price amount
  cases from the unchanged Index query integration assertions.

## Index SQLite Nested Filter And Order Slice

Commit:

- This commit (`Add SQLite Index nested filter and order support`)

The SQLite Index provider now evaluates nested relation filters and nested
relation ordering after relation hydration. This moves the portable provider
closer to the unchanged Index query assertions that filter by variant SKU and
sort by price amount.

Differences from original Medusa:

- `SqliteIndexStorageProvider.query` now applies nested filters after
  hydration instead of only filtering direct root rows in SQL.
- Nested array filters prune child arrays and remove parent rows with no
  matching child rows, covering cases such as
  `product.variants.sku LIKE 'aaa%'`.
- Join filters prune child arrays without removing otherwise matching parents,
  matching the Index distinction between `filters` and `joinFilters`.
- Nested ordering sorts child arrays by scalar child values and by descendant
  aggregate values, covering variant SKU ordering and price amount ordering in
  the current product/variant/price path.
- Direct root filters remain SQL-owned; post-hydration filtering intentionally
  skips direct root scalar predicates so `idsOnly` and projected rows are not
  double-filtered.
- No replacement Index service, route, app-local fake, or parallel integration
  suite was introduced.

Affected boundary:

- `packages/modules/index` portable SQLite provider query behavior.

Validation:

- `@medusajs/index` focused unit tests passed: 5 suites, 24 tests.
- `@medusajs/index` build passed.
- Portable import graph check passed for the portable Index entry, portable
  loader, shared service, SQLite provider, and SQLite query builder.
- `git diff --check` passed.

Current limitations:

- Nested filter/order is currently evaluated after hydration. That is correct
  for the focused provider behavior but may need SQL pushdown before large D1
  product-listing workloads.
- Logical root-filter parity is still incomplete for the full Postgres Index
  query surface.

Next implementation step:

- Build a SQLite-backed Index query integration harness or adapter-specific
  test that seeds `index_data` and `index_relation` with the existing
  Product/Variant/Price fixture shape, then start running the unchanged Index
  query assertions against the portable provider.

## Index SQLite Query Harness Slice

Commit:

- This commit (`Add SQLite Index query harness`)

The Index SQLite provider now has a real SQLite-backed query harness using the
same built-in `node:sqlite` runtime already used by the Drizzle module test
adapter. This moves validation beyond mocked executor calls.

Differences from original Medusa:

- Added a typed `node:sqlite` executor in the Index provider test suite.
- The harness creates the provider's SQLite tables through
  `SqliteIndexStorageProvider.onApplicationStart`.
- The harness seeds `index_data` and `index_relation` with the existing
  Product/Variant/Price fixture shape from the Index query integration suite.
- The harness runs a real SQLite query through the portable provider and
  asserts the same nested product -> variant -> price response shape for the
  variant SKU filter case.
- No production runtime behavior changed in this slice.
- No replacement Index service, route, app-local fake, or parallel integration
  suite was introduced.

Affected boundary:

- `packages/modules/index` adapter-specific SQLite query validation.

Validation:

- `@medusajs/index` focused unit tests passed: 5 suites, 25 tests.
- `@medusajs/index` build passed.
- Portable import graph check passed for the portable Index entry, portable
  loader, shared service, SQLite provider, and SQLite query builder.
- `git diff --check` passed.

Current limitations:

- This harness currently covers one unchanged query expectation shape. The full
  unchanged Index query integration suite is not yet running through the
  portable provider.

Next implementation step:

- Expand the SQLite-backed harness case-by-case with unchanged Index query
  expectations, fixing provider parity gaps only when a real assertion exposes
  them.

## Index SQLite Query Harness Expansion

Commit:

- This commit (`Expand SQLite Index query harness`)

The SQLite-backed Index query harness now covers additional unchanged query
expectations for nested ordering and `idsOnly` projection.

Differences from original Medusa:

- Added real SQLite assertions for variant SKU descending order and price
  amount ascending/descending order using the existing Product/Variant/Price
  fixture shape.
- Added a real SQLite assertion for `idsOnly` responses ordered by an
  unselected nested relation path.
- The harness exposed and fixed a provider parity gap: relation paths required
  for filtering or ordering are now included in the hydration tree even when
  they are not selected in `fields`.
- The provider now keeps full rows internally until filtering and ordering are
  complete, then projects the response through a separate output relation tree.
  This preserves sort/filter correctness while avoiding unrequested nested
  relations in the public result.
- No replacement Index service, route, app-local fake, or parallel integration
  suite was introduced.

Affected boundary:

- `packages/modules/index` SQLite query planning, provider projection, and
  adapter-specific SQLite query validation.

Validation:

- `@medusajs/index` focused unit tests passed: 5 suites, 27 tests.
- `@medusajs/index` build passed.
- Portable import graph check passed for the portable Index entry, portable
  loader, shared service, SQLite provider, and SQLite query builder.
- `git diff --check` passed.

Current limitations:

- The full unchanged Index query integration suite is not yet running through
  the portable provider.
- Root logical filters and broader nested query operators still need
  case-by-case parity validation against real assertions.

Next implementation step:

- Continue expanding the SQLite-backed harness with unchanged Index query
  expectations, starting with root logical filters and combined nested filters.

## Index SQLite Logical Filter Harness Expansion

Commit:

- This commit (`Expand SQLite Index logical filter harness`)

The SQLite-backed Index query harness now covers root logical filters and
combined root-plus-nested filters from the unchanged Index query assertions.

Differences from original Medusa:

- Added real SQLite assertions for root `$not`, `$and`, `$like`, and `$ilike`
  filters.
- Added real SQLite assertions for nested price amount filters and combined
  root title plus nested variant SKU filters.
- The harness exposed and fixed SQL planning for root logical operators:
  direct root SQL filtering now skips logical keys and leaves them for
  post-load object evaluation.
- The provider now evaluates full root filters after hydration, while still
  allowing direct scalar SQL predicates to reduce the row set first.
- Nested negative-only filters such as `$nin` no longer remove a parent row
  merely because it has no children on that relation path, matching the
  existing Index expectation for a root row with no variants.
- Root scalar projection now honors selected scalar fields such as
  `product.id` and `product.title`.
- No replacement Index service, route, app-local fake, or parallel integration
  suite was introduced.

Affected boundary:

- `packages/modules/index` SQLite query planning, provider filter evaluation,
  projection, and adapter-specific SQLite query validation.

Validation:

- `@medusajs/index` focused unit tests passed: 5 suites, 29 tests.
- `@medusajs/index` build passed.
- Portable import graph check passed for the portable Index entry, portable
  loader, shared service, SQLite provider, and SQLite query builder.
- `git diff --check` passed.

Current limitations:

- The full unchanged Index query integration suite is not yet running through
  the portable provider.
- Broader GraphQL field projection semantics and remaining edge-case filters
  still need case-by-case parity validation.

Next implementation step:

- Continue expanding the SQLite-backed harness with the remaining unchanged
  Index query expectations, especially projection-specific and duplicate
  filter/order cases.

## Index SQLite Projection And Null Filter Harness Expansion

Commit:

- This commit (`Expand SQLite Index projection harness`)

The SQLite-backed Index query harness now covers more of the unchanged Index
query assertions around nested null filters and projection-specific ordering.

Differences from original Medusa:

- Added real SQLite assertions for nested variant SKU `$ne: null`,
  `$not: { $eq: null }`, and `$eq: null` filters using the existing
  Product/Variant/Price fixture shape.
- Added real SQLite assertions for ordering by nested price amount when the
  price relation is not selected in `fields`.
- Added real SQLite assertions for the duplicated `$in` variant SKU filter plus
  nested price amount ordering case from the original Index query spec.
- The harness exposed and fixed an over-broad empty relation rule. A parent
  with no child rows now passes an absent relation filter only for `$nin`
  semantics; `$ne: null` and `$not: { $eq: null }` require an existing matching
  child row.
- No replacement Index service, route, app-local fake, or parallel integration
  suite was introduced.

Affected boundary:

- `packages/modules/index` SQLite provider nested filter semantics and
  adapter-specific SQLite query validation.

Validation:

- `@medusajs/index` focused unit tests passed: 5 suites, 30 tests.

Current limitations:

- The full unchanged Index query integration suite is not yet running through
  the portable provider.
- Full result projection, pagination, and deep nested JSON root filters still
  need case-by-case parity validation.

Next implementation step:

- Continue expanding the SQLite-backed harness with full-result, pagination,
  and deep nested root JSON filter expectations from the unchanged Index query
  assertions.

## Index SQLite Full Result And Deferred Pagination Harness Expansion

Commit:

- This commit (`Expand SQLite Index pagination harness`)

The SQLite-backed Index query harness now covers full result shape, direct
root pagination, and deep root JSON filters from the unchanged Index query
assertions.

Differences from original Medusa:

- Added real SQLite assertions for the full Product/Variant/Price result shape
  without filters or pagination.
- Added real SQLite assertions for root `id` ordered pagination with nested
  relations hydrated after the selected root page is loaded.
- Added real SQLite assertions for filtering by deep root JSON object fields
  such as `product.deep.obj.b`.
- The harness exposed a pagination timing gap. The SQLite query planner now
  defers `LIMIT/OFFSET` when filters or ordering require post-load evaluation,
  so deep JSON filters are applied before the page is selected.
- Direct root filters and direct root ordering still use SQL pagination when no
  post-load filter or order is required.
- No replacement Index service, route, app-local fake, or parallel integration
  suite was introduced.

Affected boundary:

- `packages/modules/index` SQLite query planning, provider pagination, and
  adapter-specific SQLite query validation.

Validation:

- `@medusajs/index` focused unit tests passed: 5 suites, 31 tests.

Current limitations:

- The full unchanged Index query integration suite is not yet running through
  the portable provider.
- Remaining root `$nin` and direct `$not` expectation cases still need
  case-by-case parity validation.

Next implementation step:

- Continue expanding the SQLite-backed harness with the remaining root `$not`
  and `$nin` expectations from the unchanged Index query assertions, then
  reassess what is still missing before attempting a broader Index runner
  path.

## Index SQLite Query Assertion Coverage Completion

Commit:

- This commit (`Complete SQLite Index query harness coverage`)

The SQLite-backed Index query harness now mirrors the remaining expectation
shapes from the unchanged Index `query-builder.spec.ts` file.

Differences from original Medusa:

- Added real SQLite assertions for the original root `$nin` product filter
  expectation.
- Added real SQLite assertions for the original variant SKU filter plus
  `joinFilters` price amount pruning case.
- Added real SQLite assertions for SKU descending ordering with specific
  nested field paths such as `product.variants.sku` and
  `product.variants.prices.amount`.
- No production provider behavior changed in this slice; the existing SQLite
  provider behavior already satisfied these remaining query expectations.
- No replacement Index service, route, app-local fake, or parallel integration
  suite was introduced.

Affected boundary:

- `packages/modules/index` adapter-specific SQLite query validation.

Validation:

- `@medusajs/index` focused unit tests passed: 5 suites, 31 tests.

Current limitations:

- These assertions still run through a provider-level SQLite harness, not the
  original Index integration runner.
- The unchanged Index integration suite still uses the Postgres provider path
  by default and is locally blocked by unknown PostgreSQL credentials.

Next implementation step:

- Build a selectable Index integration runner path that can execute the
  original query-builder expectations against the portable SQLite provider,
  reusing the same fixture shape instead of adding more provider-only
  duplicate assertions.

## Index SQLite Service-Level Query Runner

Commit:

- This commit (`Add SQLite Index service query runner`)

The Index query validation now has a service-level SQLite integration path.
This moves beyond the provider-only harness by constructing the real
`IndexModuleService`, selecting `SqliteIndexStorageProvider`, seeding SQLite
storage, and executing representative original query-builder expectations
through `module.query`.

Differences from original Medusa:

- Added `integration-tests/__fixtures__/sqlite-index-service.ts`, a typed
  SQLite service harness for the Index integration tests.
- The harness registers the existing Product and Pricing static joiner configs
  plus a minimal ProductVariant/PriceSet link joiner config so the real Index
  schema builder can resolve the original query-builder fixture schema.
- The harness uses the portable SQLite provider under the unchanged
  `IndexModuleService.query` method; it does not call the provider directly.
- Added `query-builder-sqlite.spec.ts`, which validates representative nested
  filter, nested order, pagination metadata, and root `$nin` expectations
  through the service path.
- The existing Postgres-backed `query-builder.spec.ts` remains unchanged.
- No replacement Index service, route, app-local fake, or parallel production
  query engine was introduced.

Affected boundary:

- `packages/modules/index` integration test composition for the portable
  SQLite storage provider path.

Validation:

- Direct SQLite service integration spec passed:
  `../../../node_modules/.bin/jest --config jest.config.js --runInBand integration-tests/__tests__/query-builder-sqlite.spec.ts`.
- `@medusajs/index` focused unit tests passed: 5 suites, 31 tests.
- `@medusajs/index` build passed.
- Portable import graph check passed for the portable Index entry, portable
  loader, shared service, SQLite provider, and SQLite query builder.
- `git diff --check` passed.

Current limitations:

- The new SQLite service runner covers representative original query-builder
  expectations, not the full original query-builder file yet.
- The package `test:integration` script still selects all Index integration
  specs, so the existing Postgres specs remain locally blocked by unknown
  PostgreSQL credentials.

Next implementation step:

- Extract the original query-builder expectations into a shared runner so the
  same assertions can execute against both the existing Postgres setup and the
  SQLite service harness without duplicating every test body.

## Index Shared Query-Builder Runner

Commit:

- This commit (`Run shared Index query assertions on SQLite`)

The original Index query-builder assertions now run through a shared runner
that is used by both the existing Postgres-backed spec and the SQLite service
runner.

Differences from original Medusa:

- Extracted the existing `query-builder.spec.ts` assertion bodies into
  `query-builder-shared.ts`.
- The existing Postgres-backed `query-builder.spec.ts` still owns the original
  Medusa app/Postgres setup and now delegates its assertions to the shared
  runner.
- `query-builder-sqlite.spec.ts` now delegates to the same shared runner,
  executing all 19 current query-builder assertions through the real
  `IndexModuleService.query` method and the SQLite storage provider.
- The service-path shared runner exposed a planner gap: generated Index schema
  refs for non-module nested JSON object types, such as `product.deep`, must
  not be treated as relation hydration paths. The SQLite query planner now only
  hydrates schema refs backed by a module config.
- No replacement Index service, route, app-local fake, or parallel production
  query engine was introduced.

Affected boundary:

- `packages/modules/index` query-builder integration test composition and
  SQLite relation-tree planning.

Validation:

- Full SQLite service query-builder spec passed: 19 tests.
- `@medusajs/index` focused unit tests passed: 5 suites, 31 tests.
- `@medusajs/index` build passed.
- Portable import graph check passed for the portable Index entry, portable
  loader, shared service, SQLite provider, and SQLite query builder.
- `git diff --check` passed.

Current limitations:

- The Postgres-backed query-builder spec still requires valid PostgreSQL
  credentials locally. It was not rerun in this slice because the known local
  blocker is `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a
string`.
- The Index package integration script still runs all Index integration specs;
  a convenient SQLite-only package script or runner selector is still missing.

Next implementation step:

- Add a package-owned SQLite integration command or runner selector for the
  Index query-builder service path, then continue toward Worker/D1 execution
  of the SQLite provider.

## Index SQLite Integration Command

Commit:

- This commit (`Add SQLite Index integration script`)

The Index package now has a package-owned SQLite integration command for the
portable query-builder service path.

Differences from original Medusa:

- Added `test:integration:sqlite` to `@medusajs/index`.
- The command runs `query-builder-sqlite.spec.ts`, which executes the shared
  query-builder assertions through the real `IndexModuleService.query` method
  and `SqliteIndexStorageProvider`.
- The existing `test:integration` command remains unchanged and still targets
  all original Postgres-backed Index integration specs.
- No production provider behavior changed in this slice.

Affected boundary:

- `packages/modules/index` integration test command surface.

Validation:

- `yarn workspace @medusajs/index test:integration:sqlite` passed: 19 tests.
- `@medusajs/index` focused unit tests passed: 5 suites, 31 tests.
- `@medusajs/index` build passed.
- Portable import graph check passed for the portable Index entry, portable
  loader, shared service, SQLite provider, and SQLite query builder.
- `git diff --check` passed.

Current limitations:

- The command targets Node SQLite, not D1/workerd yet.
- The original all-spec `test:integration` command remains locally blocked by
  PostgreSQL credentials for the Postgres-backed specs.

Next implementation step:

- Add a workerd/D1-facing executor or Worker proof for the SQLite Index
  provider, starting with the shared query-builder service path.

## Index Durable Object SQLite Proof

Commit:

- This commit (`Add Index Durable Object SQLite proof`)

The portable Index path now has a workerd proof that runs the real
`IndexModuleService` and `SqliteIndexStorageProvider` inside a Durable Object
backed by Cloudflare SQLite storage.

Differences from original Medusa:

- `IndexModuleService` no longer statically imports the Node filesystem type
  generator. The Node loader injects the original type generator and
  configuration checker factory, while portable composition can omit those
  Node-only services.
- Index service, loader, portable entry, and config helpers now avoid
  package-local alias imports on the portable path so the Worker proof can
  bundle the service source directly.
- Added an app-level `IndexProofDO` that seeds the Product -> Variant ->
  Price Set -> Price graph into `index_data` and `index_relation`, then runs
  `module.query` through the real service path.
- Added an isolated `index-proof-worker` entry, Wrangler config, Vite config,
  and `test:index-do-sqlite` script so this proof can validate the Index
  import graph without pulling the broader Cloudflare app's unfinished runtime
  imports.
- Added a narrow app-only framework-utils shim for this proof. It exists to
  keep the isolated proof graph focused on Index service behavior; it is not a
  replacement Medusa framework API.

Affected boundary:

- `packages/modules/index` portable service composition.
- `apps/medusa-cloudflare` workerd proof composition for the Index storage
  provider.

Validation:

- `yarn workspace @medusajs/index test:integration:sqlite` passed: 19 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index package
  build completed.
- `vite --config vite.index-proof.config.ts build` passed for the isolated
  Index proof Worker.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed and verified
  a Product/Variant/Price relation query inside workerd Durable Object SQLite.
- Import guard passed for the isolated Index proof bundle and portable Index
  source paths: no `@mikro-orm`, `knex`, Postgres provider, or MikroORM
  repository imports were present.
- `git diff --check` passed with line-ending warnings only.

Current limitations:

- This proof runs through a focused Index proof Worker, not the full
  `medusa-cloudflare` production Worker bundle.
- The broader Cloudflare app build still pulls unrelated Node/CJS/MikroORM
  edges from unfinished proof/runtime imports and remains a separate
  portability task.
- The workerd proof uses Durable Object SQLite storage. D1-specific execution
  and migration packaging are still future slices.

Next implementation step:

- Fold the isolated proof lessons back into the reusable Worker composition
  boundary or add the D1-facing executor abstraction, without expanding
  relation edge cases until another unchanged Index assertion requires it.

## Index Cloudflare SQLite Executor Boundary

Commit:

- This commit (`Add Index Cloudflare SQLite executor boundary`)

The Index SQLite provider now has a Cloudflare adapter boundary shared by
Durable Object SQLite and D1. Both adapters implement the existing
`SqliteIndexExecutor` contract consumed by `SqliteIndexStorageProvider`.

Differences from original Medusa:

- Added `index-cloudflare-sqlite-executor.ts` in the Cloudflare app with
  `DurableObjectSqliteIndexExecutor` and `D1SqliteIndexExecutor`.
- Moved Durable Object SQLite row normalization and statement execution out of
  the proof Durable Object.
- Refactored the relation query proof into a shared helper so both Cloudflare
  SQLite backends seed the same Index rows and execute the same real
  `IndexModuleService.query` path.
- Added a focused D1 proof route in the isolated Index proof Worker.
- Renamed the proof command to `test:index-sqlite`; the previous
  `test:index-do-sqlite` command remains as an alias.

Affected boundary:

- `apps/medusa-cloudflare` Index proof composition and Cloudflare SQL adapter
  selection.

Validation:

- `yarn workspace medusa-cloudflare typecheck` passed.
- `vite --config vite.index-proof.config.ts build` passed for the isolated
  Index proof Worker.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 through the real Index service query path.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Import guard passed for the isolated Index proof bundle and portable Index
  source paths.
- `git diff --check` passed with line-ending warnings only.

Current limitations:

- D1 is proven in the isolated Index proof Worker only.
- The full `medusa-cloudflare` production app bundle still has unrelated
  unfinished Node/CJS import edges.

Next implementation step:

- Reduce the proof-only framework shim by moving the minimum adapter-safe
  Index composition exports into a reusable Worker composition entry.

## Index Portable Framework Utils Boundary

Commit:

- This commit (`Add Index portable framework utils boundary`)

The portable Index path now imports Worker-safe framework utilities from a
package-owned subpath: `@medusajs/framework/utils/portable`.

Differences from original Medusa:

- Added `packages/core/framework/src/utils/portable.ts` with the minimum
  framework utility surface required by the portable Index service path.
- Added missing `@medusajs/utils` subpath exports for the narrow utility
  modules consumed by the framework portable entry.
- Moved the portable Index module entry, Index service, SQLite provider,
  schema builder, and default schema to `@medusajs/framework/utils/portable`.
- Removed the app-local `index-proof-framework-utils` shim from the isolated
  Index proof.
- The portable `Module`, `InjectManager`, `MedusaContext`, and
  `ModulesSdkUtils.MedusaService` implementations are intentionally minimal
  in this subpath so they do not pull Node-backed joiner config, MikroORM, or
  filesystem discovery into the Worker proof graph.

Affected boundary:

- `@medusajs/framework` portable utility surface.
- `packages/modules/index` portable service and SQLite provider import graph.

Validation:

- `yarn workspace @medusajs/framework build` passed.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 19 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 through the real Index service query path.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Import guard passed for the isolated Index proof bundle and portable Index
  source paths.
- `git diff --check` passed with line-ending warnings only.

Current limitations:

- The portable framework utility subpath is intentionally limited to the Index
  composition surface proven by this slice. It is not a general replacement
  for the full `@medusajs/framework/utils` barrel.
- The remaining Index proof service composition helpers still live in the
  Cloudflare app and should move toward a reusable Index Worker composition
  module next.

Next implementation step:

- Move the remaining app-local Index service composition helpers toward a
  reusable Index Worker composition module.

## Index Worker Composition Module

Commit:

- This commit (`Move Index Worker composition into package`)

The Index package now owns the Worker-facing SQLite service composition helper
used by the Cloudflare proof.

Differences from original Medusa:

- Added `packages/modules/index/src/worker-composition.ts`.
- Exported `@medusajs/index/worker-composition` from the Index package.
- Moved SQLite Index service construction, the relation-query proof fixture,
  and the minimal Product/Pricing/link joiner configs out of
  `apps/medusa-cloudflare/src/index-proof-do.ts`.
- `IndexProofDO` is now only a Cloudflare Durable Object request wrapper that
  selects the Durable Object SQLite executor.
- The D1 proof route also imports the same package-owned composition helper.

Affected boundary:

- `packages/modules/index` portable Worker composition.
- `apps/medusa-cloudflare` isolated Index proof wrapper.

Validation:

- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 19 tests.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index build
  completed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 through the shared Index composition helper.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Import guard passed for the isolated Index proof bundle and portable Index
  source paths.
- `git diff --check` passed with line-ending warnings only.

Current limitations:

- The worker-composition entry still contains proof fixture joiner configs for
  Product, Pricing, and ProductVariant/PriceSet link. Those are now
  package-owned, but the next step is to replace them with reusable static
  joiner config inputs where possible.
- The full production Cloudflare app bundle remains a separate cleanup task.

Next implementation step:

- Replace proof fixture joiner configs with reusable Product/Pricing static
  joiner config inputs where possible.

## Index Uses Real Product And Pricing Joiner Configs

Commit:

- This commit (`Reuse Product and Pricing joiner configs in Index proof`)

The Index Worker composition no longer embeds proof-only Product and Pricing
joiner config creators. It imports the real module joiner configs through
narrow package subpaths.

Differences from original Medusa:

- Added `@medusajs/product/joiner-config` and
  `@medusajs/pricing/joiner-config` exports.
- Extended `@medusajs/framework/utils/portable` with the DML model builder and
  enum helpers required by Product/Pricing DML models.
- Retargeted Product and Pricing model imports from the broad framework utils
  barrel to `@medusajs/framework/utils/portable`.
- Updated `@medusajs/index/worker-composition` to register the real Product
  and Pricing module joiner configs.
- Kept the ProductVariant/PriceSet link joiner config local because the fork
  does not yet have a reusable static link manifest input for that link module.

Affected boundary:

- Product and Pricing DML model import boundary.
- Product and Pricing package exports.
- Index Worker composition and isolated Cloudflare Index proof bundle.

Validation:

- `yarn workspace @medusajs/framework build` passed.
- `yarn workspace @medusajs/product build` passed.
- `yarn workspace @medusajs/pricing build` passed.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 19 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 through the real Product/Pricing joiner config
  graph.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and the
  Product/Pricing/Index portable source paths.

Current limitations:

- The ProductVariant/PriceSet link joiner config remains a local proof fixture.
- The full production Cloudflare app bundle remains a separate cleanup task.

Next implementation step:

- Replace the remaining local link joiner fixture with a reusable static link
  manifest shape.

## Index Uses Real ProductVariant/PriceSet Link Definition

Commit:

- This commit (`Reuse ProductVariant PriceSet link definition in Index proof`)

The Index Worker composition no longer embeds a local
`ProductVariantPriceSetLink` joiner config. It imports Medusa's real
ProductVariant/PriceSet link definition from the link-modules package.

Differences from original Medusa:

- Added package exports for `@medusajs/link-modules/definitions` and
  `@medusajs/link-modules/definitions/product-variant-price-set`.
- Added `LINKS` to `@medusajs/framework/utils/portable`.
- Added the `@medusajs/utils/link/links` package export used by the portable
  framework utility boundary.
- Narrowed `compose-link-name` to import direct string helper subpaths instead
  of the broad common barrel.
- Retargeted the ProductVariant/PriceSet link definition to
  `@medusajs/framework/utils/portable`.
- Updated the Index Worker proof seed to use the real link entity name and
  fields: `LinkProductVariantPriceSet`, `variant_id`, and `price_set_id`.

Affected boundary:

- Link-modules static definition exports.
- Portable framework utility exports.
- Index Worker composition and isolated Cloudflare Index proof bundle.

Validation:

- `yarn workspace @medusajs/utils build` passed.
- `yarn workspace @medusajs/framework build` passed.
- `yarn workspace @medusajs/link-modules build` passed after framework build
  completed.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 19 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 through the real Product/Pricing/link joiner
  graph.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and the
  portable Index/link source paths.

Current limitations:

- The Worker composition still owns proof seed data and the small proof schema.
- The full production Cloudflare app bundle remains a separate cleanup task.

Next implementation step:

- Share the Index SQLite relation proof fixture data between the Worker
  composition and the SQLite integration harness where possible.

## Index Shares SQLite Relation Proof Fixture

Commit:

- This commit (`Share Index SQLite relation proof fixture`)

The Index Worker proof and the Node SQLite integration harness now use the
same package-owned relation-query fixture for schema, joiner registration, and
seed data.

Differences from original Medusa:

- Added `packages/modules/index/src/relation-query-proof-fixture.ts`.
- Moved relation-query proof schema, Product/Pricing/link joiner registration,
  table reset, and seed helpers into that shared fixture.
- Updated `@medusajs/index/worker-composition` to import the shared fixture.
- Updated `integration-tests/__fixtures__/sqlite-index-service.ts` to import
  the same shared fixture instead of maintaining a local
  `ProductVariantPriceSetLink` joiner config and seed copy.
- The shared fixture uses Medusa's real `LinkProductVariantPriceSet`,
  `variant_id`, and `price_set_id` link shape.

Affected boundary:

- Index SQLite query integration harness.
- Index Worker composition and isolated Cloudflare Index proof bundle.

Validation:

- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 19 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 through the shared fixture.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- A stale-name scan found no `ProductVariantPriceSetLink` or
  `product_variant_price_set_link` references in the SQLite harness,
  Worker composition, or shared fixture.

Current limitations:

- The broader Index integration `schema.ts` fixture remains because other
  integration tests and `medusa-config.js` still use it.
- Worker composition still owns a small amount of service-construction
  scaffolding.

Next implementation step:

- Move generic SQLite service-construction scaffolding behind a reusable helper
  while keeping runtime-specific executors separate.

## Index Shares SQLite Service Composition

Commit:

- This commit (`Share Index SQLite service composition`)

The Worker proof and Node SQLite integration harness now share one
package-owned SQLite `IndexModuleService` construction helper.

Differences from original Medusa:

- Added `packages/modules/index/src/sqlite-index-service-composition.ts`.
- Moved generic SQLite service construction into that helper: module
  declaration, storage provider wiring, logger, remote query double, unused
  dependency guards, and base repository guard.
- Kept runtime-specific executors separate:
  `node:sqlite` remains in the integration harness, while Durable Object and
  D1 executors remain in the Cloudflare app.
- Reduced `@medusajs/index/worker-composition` to proof query execution,
  fixture reset/seed calls, and result extraction.

Affected boundary:

- Index SQLite query integration harness.
- Index Worker composition and isolated Cloudflare Index proof bundle.

Validation:

- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 19 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 through the shared composition helper.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- A stale service-construction scan found construction helpers only in
  `sqlite-index-service-composition.ts`.

Current limitations:

- `worker-composition` still owns the proof query shape and result extraction.
- The broader production Cloudflare app bundle remains a separate cleanup task.

Next implementation step:

- Decide whether the remaining proof query/result extraction should be a
  reusable package proof runner or stay as the thin proof API until more Index
  runtime behavior needs it.

## Index Relation Proof Runner

Commit:

- This commit (`Move Index relation proof into runner`)

The relation proof query and result extraction now live in a dedicated
package-owned proof runner. The old `worker-composition` entry remains as a
compatibility export.

Differences from original Medusa:

- Added `packages/modules/index/src/relation-query-proof-runner.ts`.
- Exported `@medusajs/index/relation-query-proof-runner`.
- Exported `@medusajs/index/sqlite-index-service-composition`.
- Reduced `@medusajs/index/worker-composition` to a compatibility re-export
  of the proof runner API.

Affected boundary:

- Index Worker proof API surface.
- Isolated Cloudflare Index proof bundle.

Validation:

- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 19 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 through the compatibility entry.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.

Current limitations:

- The Cloudflare app still imports `@medusajs/index/worker-composition` for
  compatibility. It can move to the proof runner export in a later cleanup.
- The broader production Cloudflare app bundle remains a separate cleanup task.

Next implementation step:

- Audit whether the isolated Index proof now has enough package-owned
  composition to move from helper refactoring to the next Index behavior gap.

## Index Proof Runner App Import

Commit:

- This commit (`Point Index proof app at relation runner`)

The Cloudflare Index proof app now imports the package-owned relation proof
runner directly instead of going through the compatibility
`worker-composition` entry.

Differences from original Medusa:

- Updated the Cloudflare proof app to import
  `@medusajs/index/relation-query-proof-runner`.
- Removed app-local aliases and TypeScript paths for
  `@medusajs/index/worker-composition`.
- Kept `@medusajs/index/worker-composition` as a compatibility re-export in
  the Index package, so this cleanup does not break existing callers.

Affected boundary:

- Isolated Cloudflare Index proof bundle.
- Index Worker proof API import surface.

Validation:

- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 19 tests.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index package
  build completed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 through the direct proof runner import.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- A stale app import scan found no remaining
  `@medusajs/index/worker-composition` imports in `apps/medusa-cloudflare`.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.

Current limitations:

- This removes a proof-app compatibility import only. It does not expand Index
  query behavior coverage.
- The broader production Cloudflare app bundle remains a separate cleanup task.

Next implementation step:

- Move from proof helper cleanup back to broader SQLite provider coverage
  against unchanged Index assertions.

## Index SQLite Event Ingestion Service Runner

Commit:

- This commit (`Add SQLite Index event ingestion coverage`)

The SQLite Index integration gate now covers a service-level event-ingestion
path, not only query-builder reads. The new spec composes the real
`IndexModuleService` with `SqliteIndexStorageProvider` in worker mode, lets the
service register listeners on the injected event bus, emits original-style
`product.created` and `variant.created` events, and verifies the resulting
`index_data` and `index_relation` rows through SQLite.

Differences from original Medusa:

- Added `integration-tests/__tests__/index-engine-module-sqlite.spec.ts` as a
  SQLite sibling for the event-ingestion behavior from the original
  `index-engine-module.spec.ts`.
- Expanded the package-owned SQLite service composition helper to accept an
  injected event bus, remote query function, and worker mode.
- Added a no-op configuration checker and no-op data synchronizer for the
  SQLite worker-mode composition. This keeps startup in the same service path
  while avoiding the full sync subsystem for this event-ingestion slice.
- Extended `test:integration:sqlite` to run both SQLite integration specs.

Affected boundary:

- Index SQLite service composition.
- Index SQLite integration test harness.
- SQLite provider event ingestion through real Index service listener
  registration.

Validation:

- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test` passed: 5 suites and 31 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed:
  2 suites and 20 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 relation query proofs still work.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- The new SQLite event-ingestion spec covers Product and ProductVariant create
  events plus their parent relation. It does not yet cover link attach/detach,
  update, delete, or sync metadata paths from the original Index integration
  suite.
- The no-op data synchronizer is intentionally limited to this worker-mode
  service composition test path. Full sync behavior still needs its own
  SQLite-backed slice.

Next implementation step:

- Expand the SQLite event-ingestion runner to cover link attach/detach and
  update/delete behavior from the original Index engine module spec.

## Index SQLite Link And Mutation Event Ingestion

Commit:

- This commit (`Expand SQLite Index event ingestion coverage`)

The SQLite Index event-ingestion runner now covers the remaining event kinds
from the original Index engine module create/update/delete flow that do not
require the sync subsystem. The spec still composes the real
`IndexModuleService` in worker mode, lets it register listeners on the injected
event bus, and verifies the SQLite provider output rows directly.

Differences from original Medusa:

- Extended `integration-tests/__tests__/index-engine-module-sqlite.spec.ts`
  instead of creating a parallel portable service.
- Added coverage for real listener handling of:
  `pricing.price-set.created`, `price.created`,
  `LinkProductVariantPriceSet.attached`,
  `LinkProductVariantPriceSet.detached`, `product.updated`,
  `variant.updated`, `product.deleted`, and `variant.deleted`.
- The SQLite runner now verifies the full Product -> ProductVariant ->
  LinkProductVariantPriceSet -> PriceSet -> Price relation graph written
  through event ingestion.

Affected boundary:

- Index SQLite integration test harness.
- SQLite provider event ingestion through real Index service listener
  registration.

Validation:

- `yarn workspace @medusajs/index test:integration:sqlite` passed:
  2 suites and 23 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test` passed: 5 suites and 31 tests.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index package
  build completed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 relation query proofs still work.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- Sync/config metadata behavior is still not covered by the SQLite integration
  runner.
- Full data-synchronizer behavior still needs a separate SQLite-backed slice.

Next implementation step:

- Move to a narrow SQLite sync/config metadata slice from
  `index-engine-module-sync.spec.ts`, `config-sync.spec.ts`, or
  `data-synchronizer.spec.ts`.

## Index SQLite Sync Metadata GetInfo

Commit:

- This commit (`Add SQLite Index sync metadata coverage`)

The SQLite Index integration gate now covers the read-only sync metadata API
from the original `index-engine-module-sync.spec.ts`. The new SQLite spec calls
the real `IndexModuleService.getInfo()` method with injected metadata and sync
internal services.

Differences from original Medusa:

- Added `integration-tests/__tests__/index-engine-module-sync-sqlite.spec.ts`.
- Extended the package-owned SQLite service composition helper with optional
  `indexMetadataService` and `indexSyncService` injection points.
- Added list-only in-memory internal-service fixtures for SQLite integration
  tests. They implement only the `list` behavior touched by `getInfo()`.
- Extended `test:integration:sqlite` to run the new sync metadata SQLite spec.

Affected boundary:

- Index SQLite service composition.
- Index SQLite integration test harness.
- `IndexModuleService.getInfo()` sync metadata API.

Validation:

- `yarn workspace @medusajs/index test:integration:sqlite` passed:
  3 suites and 26 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test` passed: 5 suites and 31 tests.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index package
  build completed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 relation query proofs still work.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- This slice covers read-only `getInfo()` metadata behavior only.
- `sync()` strategy behavior, configuration change detection, and full
  `DataSynchronizer` behavior still need separate SQLite-backed slices.

Next implementation step:

- Expand from read-only sync metadata to a narrow SQLite `sync()` behavior
  slice, starting with server-mode event emission/reset semantics or worker-mode
  configuration checker behavior.

## Index SQLite Server Sync Strategies

Commit:

- This commit (`Add SQLite Index sync strategy coverage`)

The SQLite Index integration runner now covers server-mode `sync()` strategy
behavior from the original sync-management API. The new assertions call the
real `IndexModuleService.sync()` method and verify the metadata services,
transaction wrapper, reset handler, and event bus interactions behind the same
SQLite service composition.

Differences from original Medusa:

- Extended the package-owned SQLite service composition helper with optional
  `baseRepository` and `indexResetHandler` injection points.
- Expanded the SQLite integration fixture from list-only internal services to
  mutable list/update services for the selector shapes used by
  `IndexModuleService.sync()`.
- Added SQLite coverage for continue, full, and reset sync strategies in
  `index-engine-module-sync-sqlite.spec.ts`.

Affected boundary:

- Index SQLite service composition.
- Index SQLite integration test harness.
- `IndexModuleService.sync()` server-mode metadata and event behavior.

Validation:

- `yarn workspace @medusajs/index test:integration:sqlite` passed:
  3 suites and 29 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test` passed: 5 suites and 31 tests.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index package
  build completed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 relation query proofs still work.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- Worker-mode configuration checker behavior is still not covered by the
  SQLite integration runner.
- Full `DataSynchronizer.syncEntity` behavior still needs a separate
  SQLite-backed slice.

Next implementation step:

- Move to worker-mode configuration checker behavior or a narrow
  `DataSynchronizer.syncEntity` SQLite slice.

## Index SQLite DataSynchronizer SyncEntity

Commit:

- This commit (`Add SQLite Index DataSynchronizer coverage`)

The SQLite Index integration runner now covers the real
`DataSynchronizer.syncEntity` path. The test composes the real
`IndexModuleService` in worker mode, lets it initialize the real
`DataSynchronizer` with the SQLite storage provider, then syncs Product and
ProductVariant pages into SQLite.

Differences from original Medusa:

- Extended the package-owned SQLite service composition helper with an
  optional `dataSynchronizer` injection point.
- Updated the SQLite integration harness to create and return the real
  `DataSynchronizer` wired to the same remote query used by the SQLite storage
  provider.
- Added SQLite coverage for paginated Product and ProductVariant
  `syncEntity` calls, including ProductVariant parent relation rows.

Affected boundary:

- Index SQLite service composition.
- Index SQLite integration test harness.
- `DataSynchronizer.syncEntity` with `SqliteIndexStorageProvider`.

Validation:

- `yarn workspace @medusajs/index test:integration:sqlite` passed:
  3 suites and 30 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test` passed: 5 suites and 31 tests.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index package
  build completed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 relation query proofs still work.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed after
  rerunning a transient Yarn plugin allocation failure.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- This slice covers direct `syncEntity` only. The broader `syncEntities`
  orchestration path, including locking, metadata status updates, cursor
  updates, and stale row cleanup, still needs its own SQLite-backed slice.
- Worker-mode configuration checker behavior is still not covered by the
  SQLite integration runner.

Next implementation step:

- Move to worker-mode configuration checker behavior or full
  `DataSynchronizer.syncEntities` orchestration.

## Index SQLite Worker Configuration Checker

Commit:

- This commit (`Add SQLite Index configuration checker coverage`)

The SQLite Index integration runner now covers the worker-mode startup
configuration checker path. The test composes the real `IndexModuleService` in
worker mode, injects the real `Configuration` factory, and verifies that
startup detects schema metadata changes before requesting worker sync.

Differences from original Medusa:

- Extended the package-owned SQLite service composition helper with an
  optional `indexConfigurationCheckerFactory` injection point.
- Expanded the SQLite integration harness internal-service double to support
  the `create`, filtered `list`, batch `update`, `delete`, and `upsert` methods
  used by `Configuration.checkChanges()`.
- Added SQLite worker-mode startup coverage for schema-derived metadata rows,
  sync cursor rows, and the resulting `DataSynchronizer.syncEntities` call.

Affected boundary:

- Index SQLite service composition.
- Index SQLite integration test harness.
- Worker-mode `IndexModuleService.onApplicationStart_()` configuration-checker
  path.
- `Configuration.checkChanges()` with SQLite-backed test services.

Validation:

- `yarn workspace @medusajs/index test:integration:sqlite` passed:
  3 suites and 31 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test` passed: 5 suites and 31 tests.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index package
  build completed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed after rerunning a
  transient Yarn plugin allocation failure, proving both Durable Object SQLite
  and D1 relation query proofs still work.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- This slice proves configuration-change detection and sync scheduling at
  worker startup, but it mocks `DataSynchronizer.syncEntities` to keep the test
  scoped to the checker boundary.
- Full `DataSynchronizer.syncEntities` orchestration, including locking,
  metadata status updates, cursor updates, and stale row cleanup, still needs
  its own SQLite-backed slice.

Next implementation step:

- Move to full `DataSynchronizer.syncEntities` orchestration.

## Index SQLite DataSynchronizer SyncEntities

Commit:

- This commit (`Add SQLite Index syncEntities orchestration coverage`)

The SQLite Index integration runner now covers the full
`DataSynchronizer.syncEntities` orchestration path. Unlike the direct
`syncEntity` slice, this test exercises the real orchestrator wrapper around
entity sync, including locking, metadata status transitions, cursor updates,
and stale-row cleanup.

Differences from original Medusa:

- Extended the SQLite integration harness `DataSynchronizer` container with a
  typed in-memory locking module, metadata/sync internal services, logger, and
  a SQLite manager adapter.
- The manager adapter preserves the current `DataSynchronizer` SQL call sites
  while translating the stale-row update/delete operations to SQLite-compatible
  executor calls inside the test harness.
- Added SQLite worker-mode coverage for `syncEntities` over Product and
  ProductVariant metadata.

Affected boundary:

- Index SQLite integration test harness.
- `DataSynchronizer.syncEntities` and `Orchestrator` execution against SQLite.
- Metadata status and sync cursor internal-service interactions.
- SQLite stale-row cleanup path.

Validation:

- `yarn workspace @medusajs/index test:integration:sqlite` passed:
  3 suites and 32 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test` passed: 5 suites and 31 tests.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index package
  build completed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 relation query proofs still work.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- Configuration update/removal edge cases from the original
  `config-sync.spec.ts` are still not mirrored by the SQLite integration
  runner.
- The SQLite manager adapter is test-harness support for the existing
  `DataSynchronizer` SQL call sites. A production SQLite/D1 manager boundary
  still needs to be designed before this path is used outside tests.

Next implementation step:

- Cover SQLite configuration update/removal edge cases from the original
  `config-sync.spec.ts`.

## Index SQLite Configuration Update And Removal

Commit:

- This commit (`Add SQLite Index configuration update coverage`)

The SQLite Index integration runner now mirrors the update/removal portions of
the original `config-sync.spec.ts`. The tests run through worker-mode startup
with the real `Configuration` checker instead of mutating private
`IndexModuleService` fields.

Differences from original Medusa:

- Extended the SQLite service composition helper with an optional schema
  override. The default schema remains unchanged for existing SQLite proof
  tests.
- Added a SQLite harness pre-start hook so tests can spy on the real
  `DataSynchronizer` before `onApplicationStart` runs the worker configuration
  checker.
- Added metadata fixtures with real `simpleHash` values so unchanged entities
  are not falsely marked pending.
- Added SQLite coverage for the updated schema case and the removed schema
  case from the original config-sync test.

Affected boundary:

- Index SQLite service composition.
- Index SQLite integration test harness.
- Worker-mode `Configuration.checkChanges()` update/removal behavior.
- Metadata status, sync cursor reset, `removeEntities`, and sync scheduling
  behavior for schema changes.

Validation:

- `yarn workspace @medusajs/index test:integration:sqlite` passed:
  3 suites and 34 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test` passed: 5 suites and 31 tests.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index package
  build completed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 relation query proofs still work.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed after
  rerunning it serially. The parallel run raced with `test:index-sqlite` over
  the shared `.wrangler` output directory on Windows.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- This slice covers the config-sync update/removal behavior that was still
  missing from the SQLite runner.
- Remaining Index work should now start with an audit against the original
  Index suites to name the next concrete gap before adding more behavior.

Next implementation step:

- Audit remaining Index SQLite gaps against the original Index
  integration/unit suites.

## Index SQLite Reset Strategy Truncation

Commit:

- This commit (`Add SQLite Index reset truncation coverage`)

The SQLite Index integration runner now covers the reset-strategy truncation
behavior from the original `index-engine-module-sync.spec.ts`. Before this
slice, SQLite tests only proved that a custom reset handler was invoked.

Differences from original Medusa:

- Added a default SQLite `IndexResetHandler` to the SQLite integration harness.
- The handler clears SQLite `index_data` and `index_relation` tables through
  the existing SQLite executor and clears the in-memory metadata/sync services
  used by the harness.
- Preserved explicit custom `indexResetHandler` injection for tests that need
  to verify transaction-manager forwarding.
- Added SQLite reset coverage for populated tables and empty tables.

Affected boundary:

- Index SQLite integration test harness.
- `IndexModuleService.sync({ strategy: "reset" })` in server mode.
- SQLite `index_data` / `index_relation` reset behavior.
- Metadata and sync cursor reset behavior for the SQLite test composition.

Validation:

- `yarn workspace @medusajs/index test:integration:sqlite` passed:
  3 suites and 36 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test` passed: 5 suites and 31 tests.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index package
  build completed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 relation query proofs still work.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- This closes the reset-strategy behavior gap identified in the remaining-gap
  audit.
- A short final audit should confirm whether any original Index integration or
  unit behavior remains unmirrored before moving to the next Worker composition
  boundary.

Next implementation step:

- Run the final remaining-gap audit for the Index SQLite runner.

## Index SQLite Final Runner Gap Closure

Commit:

- This commit (`Close SQLite Index runner gaps`)

The final remaining-gap audit compared the original Index integration/unit
suites with the SQLite runner after reset truncation coverage. Two narrow
original-suite cases were still missing and are now covered.

Differences from original Medusa:

- Added SQLite coverage for unordered created/attached event ingestion from
  the original `index-engine-module.spec.ts` unordered event case.
- Added SQLite coverage for `sync({ strategy: undefined })` from the original
  sync strategy parameter validation case.
- No new runtime abstraction was added. These are test-runner coverage
  additions against the existing SQLite service composition.

Affected boundary:

- Index SQLite event-ingestion integration runner.
- Index SQLite sync-management integration runner.
- Final SQLite behavior coverage audit for the Index module.

Validation:

- `yarn workspace @medusajs/index test:integration:sqlite` passed:
  3 suites and 38 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test` passed: 5 suites and 31 tests.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index package
  build completed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 relation query proofs still work.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- No remaining original-suite behavior gap was identified for the SQLite Index
  runner after this slice.
- The production Worker composition still must be audited separately. The
  SQLite integration harness contains test-only support that should not become
  the production composition contract.

Next implementation step:

- Move to the Worker composition/import-graph boundary for Index.

## Index Worker Package Export Composition

Commit:

- This commit (`Use package exports for Index worker proof`)

Differences from original Medusa:

- Removed the Cloudflare app's source-level Vite aliases and TypeScript path
  mappings for the Index proof subpaths.
- The Worker proof now consumes the built `@medusajs/index` package export
  surface for the relation proof runner, SQLite service composition, and SQLite
  provider types instead of resolving package source files directly from the
  app.
- No Index module behavior changed. This is an import-graph/composition
  boundary proof after the SQLite runner reached behavior parity for the
  in-scope original Index assertions.

Affected boundary:

- `apps/medusa-cloudflare` Index proof Vite config.
- `apps/medusa-cloudflare` TypeScript resolution for Index proof imports.
- Worker-facing Index composition/import graph.

Validation:

- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test` passed: 5 suites and 31 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare build:index-proof` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 relation query proofs still work.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Cloudflare Index alias guard passed.
- `git diff --check` passed.

Current limitations:

- The proof runner still seeds proof fixtures. It is acceptable for validation,
  but it is not the final production Worker composition boundary.
- The next slice should move from proof-runner composition to a production
  Worker Index composition API that accepts Cloudflare SQL executors and runtime
  services without app-local source aliases or proof fixture seeding.

## Index Worker Composition Proof Isolation

Commit:

- This commit (`Split Index worker composition from proof fixtures`)

Differences from original Medusa:

- `@medusajs/index/worker-composition` now exposes the SQLite Index service
  composition boundary directly instead of re-exporting the relation query proof
  runner.
- `createSqliteIndexService` requires an explicit Index schema and accepts an
  optional joiner-config registration callback. It no longer imports the
  relation query proof schema or registers proof joiner configs by default.
- The relation query proof runner and SQLite integration harness now opt into
  the proof schema explicitly, keeping proof fixture behavior isolated from the
  production Worker composition API.
- Added a portable-entry regression that guards the production Worker
  composition files against importing proof fixtures or the proof runner.

Affected boundary:

- Index package Worker composition entrypoint.
- Index SQLite service composition API.
- Index relation query proof runner.
- SQLite Index integration harness fixture.
- Index portable import-boundary regression tests.

Validation:

- `yarn workspace @medusajs/index test` passed: 5 suites and 32 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare build:index-proof` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving both
  Durable Object SQLite and D1 relation query proofs still work.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed for source and built
  files.
- Cloudflare Index alias guard passed.
- `git diff --check` passed.

Current limitations:

- The Cloudflare proof endpoints still intentionally use the proof runner for
  seeded relation-query validation.
- The next slice should add a non-proof Worker composition usage that constructs
  the Index service from `@medusajs/index/worker-composition` with an explicit
  schema and no proof fixture seeding.

## Index Worker No-Seed Composition Check

Commit:

- This commit (`Add Index worker no-seed composition check`)

Differences from original Medusa:

- Added a Cloudflare Worker no-seed Index composition check that constructs the
  real Index service from `@medusajs/index/worker-composition`.
- The check supplies an explicit synthetic Index schema and a minimal synthetic
  joiner config registration for `WorkerCompositionProduct`; it does not import
  the relation-query proof fixture or seed proof data.
- Added D1 and Durable Object SQLite `/composition-check` routes beside the
  existing seeded relation-query proof routes.
- Extended the workerd proof script so the Cloudflare proof now asserts both
  seeded relation-query behavior and no-seed Worker composition startup/query
  behavior.
- Moved the Cloudflare SQLite executor type import from the Index storage
  provider service subpath to `@medusajs/index/worker-composition`.

Affected boundary:

- Cloudflare Index proof Worker routes.
- Cloudflare Index Durable Object proof routes.
- Cloudflare SQL executor type boundary.
- Workerd Index proof validation script.
- Worker-facing Index package composition entrypoint.

Validation:

- `yarn workspace @medusajs/index test` passed: 5 suites and 32 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare build:index-proof` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving Durable
  Object SQLite and D1 relation query proofs plus no-seed composition checks.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index app subpath guard passed.
- `git diff --check` passed.

Current limitations:

- The no-seed composition check still constructs the service per proof request.
- The next slice should introduce a reusable Worker/DO runtime composition
  object so future HTTP/event paths can initialize Index once per lifecycle
  instead of treating composition as a request-local proof helper.

## Index Worker Reusable Runtime Composition

Commit:

- This commit (`Reuse Index worker runtime composition`)

Differences from original Medusa:

- Added an `IndexWorkerRuntime` wrapper around the Worker-facing SQLite Index
  composition path. It lazily initializes the real Index service once and
  reuses the service promise for later calls.
- The Durable Object proof now keeps `IndexWorkerRuntime` as instance state,
  matching Durable Object lifecycle reuse.
- The D1 proof now caches `IndexWorkerRuntime` in a `WeakMap` keyed by the D1
  binding object instead of constructing a service per request.
- The workerd proof script now calls each composition route twice and asserts a
  stable runtime instance id plus a single service initialization for Durable
  Object SQLite and D1.

Affected boundary:

- Cloudflare Index proof Worker routes.
- Cloudflare Index Durable Object proof routes.
- App-local Worker Index runtime composition helper.
- Workerd Index proof validation script.

Validation:

- `yarn workspace @medusajs/index test` passed: 5 suites and 32 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare build:index-proof` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving seeded
  relation-query proofs and repeated no-seed composition runtime reuse for
  Durable Object SQLite and D1.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index app subpath guard passed.
- `git diff --check` passed.

Current limitations:

- The reusable runtime wrapper still lives in the Cloudflare proof app because
  it uses the synthetic proof schema and app-local joiner config.
- The next slice should move the reusable runtime shape toward a package-owned
  Worker runtime factory that accepts real schemas, joiner registrations, and
  runtime services for future HTTP/event composition.

## Index Package-Owned Worker Runtime Factory

Commit:

- This commit (`Add Index package worker runtime factory`)

Differences from original Medusa:

- Added `SqliteIndexWorkerRuntime` and `createSqliteIndexWorkerRuntime` to the
  package-owned `@medusajs/index/worker-composition` entrypoint.
- The runtime accepts explicit SQLite Index composition options, lazily
  initializes the real Index service once, exposes `getService()`, and forwards
  typed Index queries.
- The Cloudflare proof app no longer owns the reusable service lifecycle logic.
  It now delegates lifecycle reuse to the package runtime factory and keeps
  only proof-specific schema, joiner config, and runtime-id reporting.
- Extended the Index portable-entry regression so the package runtime remains
  outside Postgres/MikroORM and proof-fixture import graphs.

Affected boundary:

- Index package Worker composition entrypoint.
- SQLite Index package runtime factory.
- Cloudflare Index proof composition helper.
- Index portable import-boundary regression tests.

Validation:

- `yarn workspace @medusajs/index test` passed: 5 suites and 32 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare build:index-proof` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving seeded
  relation-query proofs and repeated no-seed runtime reuse checks through the
  package runtime factory for Durable Object SQLite and D1.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index app subpath guard passed.
- `git diff --check` passed.

Current limitations:

- The package runtime factory accepts explicit schemas and joiner registration,
  but the current app proof still supplies a synthetic proof schema.
- The next slice should introduce a real package/module schema input path so
  Worker runtime composition can initialize Index for actual Medusa modules
  instead of proof-only entities.

## Index Worker Real Module Joiner Config Input

Commit:

- This commit (`Use real module joiner config for Index worker proof`)

Differences from original Medusa:

- `createSqliteIndexService` now accepts explicit `joinerConfigs` and registers
  them before Index builds its schema object representation.
- The Cloudflare no-seed composition check no longer defines a synthetic module
  joiner config in the proof app.
- The check now uses the real Product module joiner config from
  `@medusajs/product/joiner-config` and an Index schema for the actual
  `ProductCategory` entity.
- The workerd proof asserts `ProductCategory` and `product_category` in the
  response so the Worker composition path is pinned to real module metadata.

Affected boundary:

- Index SQLite service composition options.
- Package-owned Worker runtime composition input path.
- Cloudflare Index proof composition helper.
- Workerd Index proof validation script.

Validation:

- `yarn workspace @medusajs/index test` passed: 5 suites and 32 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare build:index-proof` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving the
  seeded relation-query proof plus the real Product module joiner-config
  composition check for Durable Object SQLite and D1.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index app subpath guard passed.
- `git diff --check` passed.

Current limitations:

- The real module composition proof is still read-only and asserts an empty
  `ProductCategory` query.
- The next slice should prove a real module event-ingestion path that writes
  through the SQLite provider without using the relation-query proof fixture
  seeding helper.

## Index Worker Real Module Event Ingestion

Commit:

- This commit (`Add Index worker event ingestion proof`)

Differences from original Medusa:

- The Cloudflare Index proof runtime now starts the package-owned Index Worker
  runtime in worker mode with a proof-local event bus and Remote Query boundary
  for the real Product module `ProductCategory` entity.
- Added D1 and Durable Object SQLite `/event-ingestion-check` routes that emit
  `product-category.created`, exercise the registered Index listener, and let
  `SqliteIndexStorageProvider.consumeEvent` write `index_data`.
- The proof verifies the written `ProductCategory` through the package runtime
  query path. It does not use the relation-query proof fixture seeding helper
  and does not insert index rows directly.
- The workerd proof script now asserts seeded relation queries, no-seed runtime
  composition reuse, and real module event-ingestion writes for both Durable
  Object SQLite and D1.

Affected boundary:

- Cloudflare Index proof Worker routes.
- Cloudflare Index Durable Object proof routes.
- App-local proof event bus and Remote Query shims.
- Package-owned Index Worker runtime consumption path.
- SQLite Index storage provider event-ingestion behavior in workerd.

Validation:

- `yarn workspace @medusajs/index test` passed: 5 suites and 32 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare build:index-proof` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving seeded
  relation-query proofs, no-seed composition reuse, and event-ingestion writes
  for Durable Object SQLite and D1.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index app subpath guard passed.
- `git diff --check` passed.

Current limitations:

- The event bus and Remote Query dependencies are proof-local shims.
- The next slice should move those dependencies toward explicit Worker
  composition dependency injection that future HTTP/event runtime code can
  provide from real platform services.

## Index Worker Explicit Runtime Dependencies

Commit:

- This commit (`Inject Index worker runtime dependencies`)

Differences from original Medusa:

- `IndexWorkerRuntime` no longer creates the proof event bus or Remote Query
  implementation internally.
- Added a proof dependency provider that supplies event bus, Remote Query, and
  target ProductCategory data as explicit runtime dependencies.
- D1 Worker and Durable Object composition roots now inject those dependencies
  when constructing the Index runtime.
- This preserves the existing workerd event-ingestion proof while making the
  runtime boundary closer to the final platform composition shape, where real
  platform services will provide event bus and Remote Query.

Affected boundary:

- Cloudflare Index proof runtime helper.
- Cloudflare Index proof dependency provider.
- D1 Worker and Durable Object Index composition roots.
- Workerd Index proof validation.

Validation:

- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace @medusajs/index test` passed: 5 suites and 32 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare build:index-proof` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving seeded
  relation-query proofs, no-seed composition reuse, and event-ingestion writes
  for Durable Object SQLite and D1 through injected dependencies.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index app subpath guard passed.
- `git diff --check` passed.

Current limitations:

- The dependency provider is still proof-local.
- The next slice should introduce a reusable Worker Index dependency contract
  that real platform code can implement for event bus, Remote Query, schema,
  and joiner config inputs.

## Index Worker Dependency Contract

Commit:

- This commit (`Add Index worker dependency contract`)

Differences from original Medusa:

- `@medusajs/index/worker-composition` now exports a typed
  `SqliteIndexWorkerRuntimeDependencies` contract for Worker composition.
- The package-owned Worker runtime now requires explicit executor, event bus,
  Remote Query, schema, and joiner config inputs instead of accepting the full
  low-level service options shape directly.
- The lower-level SQLite service composition remains flexible for package
  tests and harnesses, but Worker runtime composition can no longer silently
  omit platform dependencies and fall back to no-op service defaults.
- The Cloudflare proof dependency provider now types its event bus and Remote
  Query shim against the package-owned Worker dependency contract.

Affected boundary:

- Index package Worker composition entrypoint.
- SQLite Index package runtime factory options.
- Cloudflare Index proof dependency provider.
- Cloudflare Index proof runtime helper.

Validation:

- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace @medusajs/index test` passed: 5 suites and 32 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare build:index-proof` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index app subpath guard passed.
- `git diff --check` passed.

Current limitations:

- The schema and joiner config are now required by the Worker runtime contract,
  but the current proof still supplies the ProductCategory schema inline.
- The next slice should move schema and joiner config assembly toward a static
  manifest-derived input so the app does not hand-author Index schemas for
  real module entities.

## Index Worker Manifest-Derived Schema Input

Commit:

- This commit (`Derive Index worker schema from static manifests`)

Differences from original Medusa:

- `@medusajs/index/worker-composition` now exports
  `createSqliteIndexWorkerStaticModuleInput`, which derives Worker Index
  schema input and joiner configs from static module manifest metadata.
- The helper reads requested entity fields from module joiner schemas and adds
  Index `@Listeners` directives using conventional Medusa module event names.
- The Cloudflare ProductCategory proof no longer hand-authors a GraphQL schema
  string in the app runtime. It derives ProductCategory `id` and `name` from
  Product module metadata and emits the real
  `product.product-category.created` event.
- Product now exposes a lightweight `@medusajs/product/index-worker-static-manifest`
  entrypoint containing only the module definition and joiner config needed by
  Index Worker composition. The full Product static manifest still exists for
  static module bootstrap, but it must not be imported by the isolated Index
  Worker proof because it pulls the Product service graph.

Affected boundary:

- Index package Worker composition entrypoint.
- Static module metadata to Index schema input derivation.
- Product Worker-facing metadata export surface.
- Cloudflare Index proof composition input.

Validation:

- `yarn workspace @medusajs/product build` passed.
- `yarn workspace @medusajs/index test` passed: 6 suites and 34 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index proof guard confirmed the isolated proof does not import Product's full
  static manifest, Product services, or `moduleEventBuilderFactory`.
- `git diff --check` passed.

Current limitations:

- The manifest-derived input is still selected by the proof app for a single
  ProductCategory entity and explicit `id`/`name` fields.
- The next slice should move this from proof-local selection toward a reusable
  static Index manifest or generated Index-resource manifest that can list
  indexed entities and fields per module.

## Index Worker Module-Owned Entity Selection

Commit:

- This commit (`Move Index worker entity selection into module manifests`)

Differences from original Medusa:

- `createSqliteIndexWorkerStaticModuleInput` can now read indexed entities
  from static module manifest resources via `indexEntities`.
- Product's lightweight `index-worker-static-manifest` declares its
  ProductCategory Index resource itself:
  - entity: `ProductCategory`
  - fields: `id`, `name`
- The Cloudflare proof app no longer selects ProductCategory or its indexed
  fields inline. It only passes the Product Index Worker manifest to the Index
  helper.
- Explicit `entities` input remains available as an override for tests and
  future generated tooling, but module-owned manifest resources are now the
  default composition path.

Affected boundary:

- Index package static module to Worker input helper.
- Product lightweight Index Worker manifest.
- Cloudflare Index proof composition input.

Validation:

- `yarn workspace @medusajs/index test` passed: 6 suites and 35 tests.
- `yarn workspace @medusajs/product build` passed.
- `yarn workspace @medusajs/index build` passed after rerunning sequentially
  because a parallel Product build cleaned dist while Index was resolving
  Product's joiner-config export.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare build:index-proof` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index proof guard confirmed the isolated proof does not import Product's full
  static manifest, Product services, or `moduleEventBuilderFactory`.
- Index app subpath guard passed.
- `git diff --check` passed.

Current limitations:

- Only ProductCategory is declared in the Product Index Worker manifest.
- The next slice should add a package-level or module-level regression that
  proves Product's Index Worker manifest remains equivalent to the Product
  joiner schema for its declared indexed fields.

## Product Index Worker Manifest Regression

Commit:

- This commit (`Add Product Index worker manifest regression`)

Differences from original Medusa:

- Product's static manifest test now also validates its lightweight Index
  Worker manifest.
- The regression proves Product's Index Worker manifest:
  - targets the Product module definition;
  - has a joiner schema; and
  - declares indexed entities and fields that exist in the Product joiner
    schema.
- This keeps the module-owned Index Worker manifest from drifting away from
  Product's real static module metadata while preserving the lightweight export
  boundary used by the isolated Worker proof.

Affected boundary:

- Product static manifest tests.
- Product lightweight Index Worker manifest safety net.

Validation:

- `yarn workspace @medusajs/product test --runTestsByPath src/__tests__/static-manifest.spec.ts`
  passed: 1 suite and 2 tests.
- `yarn workspace @medusajs/product build` passed.
- `git diff --check` passed.

Current limitations:

- The regression covers Product's current ProductCategory Index Worker
  declaration only.
- The next slice should either add a second real module/entity declaration when
  required by Index runtime composition, or move the ProductCategory Worker
  proof closer to a shared static Index manifest aggregation helper.

## Index Worker Static Manifest Aggregation

Commit:

- This commit (`Aggregate Index worker static manifests`)

Differences from original Medusa:

- `@medusajs/index/worker-composition` now exports a
  `SqliteIndexWorkerStaticManifest` aggregation shape and
  `createSqliteIndexWorkerStaticManifest`.
- The aggregate manifest validates duplicate module keys and can merge multiple
  module-owned Index Worker declarations before deriving the Worker runtime
  schema input.
- `createSqliteIndexWorkerStaticModuleInput` now accepts either the aggregate
  manifest or direct manifests for tests/generated tooling.
- The Cloudflare proof app now owns a single `indexWorkerStaticManifest`
  composition file and the ProductCategory input consumes that aggregate,
  rather than passing raw module manifests directly at the runtime input site.

Affected boundary:

- Index package Worker composition entrypoint.
- Static Index manifest aggregation contract.
- Cloudflare Index proof composition input.

Validation:

- `yarn workspace @medusajs/index test` passed: 6 suites and 36 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index proof guard confirmed the isolated proof does not import Product's full
  static manifest, Product services, or `moduleEventBuilderFactory`.
- `git diff --check` passed.

Current limitations:

- The aggregate currently contains only Product's ProductCategory declaration.
- The next slice should expand the aggregate only when a second real Index
  entity is needed by the Worker composition proof or by unchanged Index
  behavior.

## Index Worker Package Event Bus Utility

Commit:

- This commit (`Move Index worker event bus into package`)

Differences from original Medusa:

- `@medusajs/index/worker-composition` now exports
  `SqliteIndexWorkerEventBus` and `createSqliteIndexWorkerEventBus`.
- The Cloudflare Index proof app no longer owns the in-memory event bus used
  by the Worker Index runtime.
- The event bus remains a lightweight Worker composition utility, not a
  replacement for Medusa's production event-bus modules.
- The app proof still owns the Remote Query shim and ProductCategory fixture
  data, but event delivery for the Worker Index runtime now lives at the
  package boundary where future platform composition can reuse it.

Affected boundary:

- Index package Worker composition entrypoint.
- Worker-safe in-memory event-bus dependency for Index event ingestion.
- Cloudflare Index proof dependency provider.
- Index portable import-boundary regression tests.

Validation:

- `yarn workspace @medusajs/index test` passed: 7 suites and 38 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving seeded
  relation-query proofs, no-seed composition reuse, and event-ingestion writes
  for Durable Object SQLite and D1.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- `git diff --check` passed.

Current limitations:

- The utility is intentionally in-memory and process-local; it is only suitable
  for Worker composition wiring and tests.
- The Remote Query dependency remains proof-local.
- The next slice should reduce the remaining proof-local Remote Query shim or
  introduce a package-owned proof Remote Query factory.

## Index Worker Package Remote Query Utility

Commit:

- This commit (`Move Index worker Remote Query helper into package`)

Differences from original Medusa:

- `@medusajs/index/worker-composition` now exports
  `createSqliteIndexWorkerRemoteQuery`.
- The Cloudflare Index proof app no longer builds its own
  `RemoteQueryFunction` callable or owns the overloaded-callable assertion.
- The app still supplies proof-owned ProductCategory target data explicitly;
  the package utility only adapts records into the narrow `graph()` behavior
  needed by the Worker Index event-ingestion proof.
- The unavoidable `RemoteQueryFunction` assertion is isolated in one package
  helper with focused tests instead of living in the app proof.

Affected boundary:

- Index package Worker composition entrypoint.
- Worker-safe in-memory Remote Query proof dependency.
- Cloudflare Index proof dependency provider.
- Index portable import-boundary regression tests.

Validation:

- `yarn workspace @medusajs/index test` passed: 8 suites and 42 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving seeded
  relation-query proofs, no-seed composition reuse, and event-ingestion writes
  for Durable Object SQLite and D1.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- `git diff --check` passed.

Current limitations:

- The utility is an in-memory proof helper, not a production Remote Query
  implementation.
- Real platform composition must still provide its own Remote Query service at
  the Worker/app boundary.
- The next slice should move the Index Worker dependency assembly toward a
  package-owned helper so the app proof only supplies executor and module
  manifest/data inputs.

## Index Worker Package Proof Dependency Helper

Commit:

- This commit (`Move Index worker proof dependency assembly into package`)

Differences from original Medusa:

- `@medusajs/index/worker-composition` now exports
  `createSqliteIndexWorkerProofDependencies`.
- The helper creates the package-owned in-memory event bus and in-memory Remote
  Query pair from explicit proof records.
- The Cloudflare Index proof app no longer assembles those package utilities
  itself. It still owns the executor binding, ProductCategory proof data, and
  the app-specific event-ingestion assertion target.
- This keeps production platform responsibility clear: real Worker apps must
  still provide their own event bus and Remote Query services instead of using
  this proof helper.

Affected boundary:

- Index package Worker composition entrypoint.
- Worker-safe proof dependency helper.
- Cloudflare Index proof dependency provider.
- Index portable import-boundary regression tests.

Validation:

- `yarn workspace @medusajs/index test` passed: 9 suites and 44 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving seeded
  relation-query proofs, no-seed composition reuse, and event-ingestion writes
  for Durable Object SQLite and D1.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- `git diff --check` passed.

Current limitations:

- The helper is proof-only and should not be used as a production event or
  Remote Query service.
- The app still owns the ProductCategory-specific runtime check class and
  response assertions.
- The next slice should move generic Worker runtime/check behavior toward the
  Index package without baking ProductCategory proof semantics into shared
  production code.

## Index Worker Package Proof Runtime

Commit:

- This commit (`Move Index worker proof runtime into package`)

Differences from original Medusa:

- `@medusajs/index/worker-composition` now exports
  `SqliteIndexWorkerProofRuntime` and
  `createSqliteIndexWorkerProofRuntime`.
- The package proof runtime wraps the real `SqliteIndexWorkerRuntime` with
  reusable proof mechanics:
  - stable runtime instance IDs;
  - service initialization counts;
  - query results annotated with runtime stats; and
  - event emission followed by Index query.
- The Cloudflare proof app no longer owns those generic runtime/check
  mechanics. It still owns ProductCategory-specific query fields, filters, and
  response assertions.
- The helper remains a proof/composition utility, not a production runtime
  abstraction for event delivery or Remote Query.

Affected boundary:

- Index package Worker composition entrypoint.
- Worker proof runtime lifecycle and stats helper.
- Cloudflare ProductCategory Index proof runtime adapter.
- Index portable import-boundary regression tests.

Validation:

- `yarn workspace @medusajs/index test` passed: 10 suites and 45 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving seeded
  relation-query proofs, no-seed composition reuse, and event-ingestion writes
  for Durable Object SQLite and D1.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- `git diff --check` passed.

Current limitations:

- ProductCategory-specific proof response shaping still lives in the
  Cloudflare app.
- The package proof runtime is still proof-oriented; production Worker
  composition must use real platform event and Remote Query services.
- The next slice should decide whether the remaining ProductCategory adapter is
  useful enough to keep app-owned, or whether a package-owned generic
  event-ingestion assertion helper can remove more app proof code without
  hiding module-specific expectations.

## Index Worker Package Proof Check Helpers

Commit:

- This commit (`Move Index worker proof checks into package`)

Differences from original Medusa:

- `@medusajs/index/worker-composition` now exports generic proof-check helpers:
  - `runSqliteIndexWorkerEmptyQueryCheck`;
  - `runSqliteIndexWorkerEventIngestionStringCheck`; and
  - `findSqliteIndexWorkerObservedStringField`.
- The package helpers evaluate reusable proof behavior:
  - empty query results with runtime stats;
  - event ingestion followed by string-field comparison; and
  - observed field lookup.
- The Cloudflare ProductCategory proof app now supplies the module-specific
  entity, root alias, event, query, and expected `id`/`name` values, then maps
  generic package check results into its app response shape.
- ProductCategory semantics remain app-owned; the package only owns reusable
  proof checking mechanics.

Affected boundary:

- Index package Worker composition entrypoint.
- Worker proof check helpers.
- Cloudflare ProductCategory Index proof adapter.
- Index portable import-boundary regression tests.

Validation:

- `yarn workspace @medusajs/index test` passed: 11 suites and 47 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving seeded
  relation-query proofs, no-seed composition reuse, and event-ingestion writes
  for Durable Object SQLite and D1.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- `git diff --check` passed.

Current limitations:

- ProductCategory response shape and expected fields remain in the Cloudflare
  proof app.
- These helpers are proof utilities, not production validation or observability
  APIs.
- The next slice should stop reducing the ProductCategory proof adapter unless
  another clearly generic behavior appears; otherwise move to the next Index
  Worker composition gap.

## Index Worker Support Joiner Manifests

Commit:

- This commit (`Preserve Index worker support joiner manifests`)

Differences from original Medusa:

- `createSqliteIndexWorkerStaticModuleInput` now returns all static manifest
  joiner configs, including support joiner configs that do not contribute an
  indexed GraphQL schema type.
- `@medusajs/link-modules/index-worker-static-manifest` now exports
  `linkModulesIndexWorkerStaticManifest`, a lightweight manifest for the real
  `ProductVariantPriceSet` link joiner config.
- The Cloudflare Index Worker static manifest aggregate includes Product's
  manifest plus the link-module support manifest.
- This is a prerequisite for replacing the synthetic seeded relation-query
  proof schema with manifest-derived Product/Pricing schemas plus real link
  joiner configs.

Affected boundary:

- Index package static manifest to Worker input helper.
- Link modules Worker-facing metadata export surface.
- Cloudflare Index Worker static manifest aggregate.
- Worker bundle import guards.

Validation:

- `yarn workspace @medusajs/index test` passed: 11 suites and 48 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace @medusajs/link-modules test --runTestsByPath src/__tests__/index-worker-static-manifest.spec.ts`
  passed.
- `yarn workspace @medusajs/link-modules build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving seeded
  relation-query proofs, no-seed composition reuse, and event-ingestion writes
  for Durable Object SQLite and D1 with the support joiner manifest included.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed as the
  compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- `git diff --check` passed.

Current limitations:

- Product/Pricing relation-query entities are not yet declared in module-owned
  Index Worker manifests.
- `ProductVariant.prices` is an extended field from the
  `ProductVariantPriceSet` link config and is not yet derived into the Index
  schema from joiner metadata.
- The seeded relation-query proof still uses its synthetic proof schema until
  extended-field schema derivation is handled deliberately.

## Index Worker Product/Pricing Relation Manifests

Commit:

- This commit (`Derive Index relation manifests from Product and Pricing`)

Differences from original Medusa:

- Product's Index Worker static manifest now declares package-owned
  `Product`, `ProductVariant`, and `ProductCategory` indexed entities.
- Pricing now exposes
  `@medusajs/pricing/index-worker-static-manifest` with a package-owned `Price`
  indexed entity declaration.
- `createSqliteIndexWorkerStaticModuleInput` now derives requested
  link-extended fields from support joiner configs. The current concrete path
  derives `ProductVariant.prices` from the real ProductVariantPriceSet
  `fieldAlias` path `price_set_link.price_set.prices`.
- The relation-query proof fixture no longer carries a hand-authored
  Product/Pricing schema or manual joiner-config registration. It constructs
  its schema and joiner config list from Product, Pricing, and link static
  manifests.
- The proof fixture keeps only legacy proof listener names
  (`product.created`, `variant.created`, `price.created`) so the unchanged
  SQLite integration event assertions remain the behavioral gate.
- The Cloudflare Index Worker static manifest aggregate now includes Product,
  Pricing, and ProductVariantPriceSet manifests together.

Affected boundary:

- Index package static manifest to schema input helper.
- Product and Pricing module Worker-facing manifest entrypoints.
- Link-extended relation-query schema derivation.
- Index relation-query proof fixture.
- Cloudflare Index Worker static manifest aggregate.
- Worker bundle import guards.

Validation:

- Focused Index static input and storage-provider tests passed: 2 suites and
  24 tests.
- Product static manifest test passed.
- Pricing static manifest test passed.
- Link modules Index Worker manifest test passed.
- `yarn workspace @medusajs/product build` passed.
- `yarn workspace @medusajs/pricing build` passed.
- `yarn workspace @medusajs/link-modules build` passed.
- `yarn workspace @medusajs/index test` passed: 11 suites and 49 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving Durable
  Object SQLite and D1 relation-query, no-seed composition reuse, and event
  ingestion checks with the Product/Pricing/link manifest aggregate.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed when rerun
  sequentially. The first parallel run collided on the shared Vite output
  directory and failed with a Windows `EPERM` cleanup error, not an Index
  runtime failure.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.

Current limitations:

- The proof fixture still carries legacy event names as proof-local overrides.
  Package-owned Product/Pricing manifests use the static helper's default
  module event name generation.
- ProductVariantPriceSet link object schema is still synthesized indirectly by
  existing Index build-config link handling; this slice only derives the
  query-facing alias field needed for `ProductVariant.prices`.
- The Cloudflare proof app still uses ProductCategory-specific naming in its
  proof input and response adapter.

## Index Worker Generic Proof Input Listener Lookup

Commit:

- This commit (`Move Index worker proof input lookup into package`)

Differences from original Medusa:

- `@medusajs/index/worker-composition` now exports
  `getSqliteIndexWorkerRequiredEntityListener`, a generic helper for resolving
  a required entity listener from static module input.
- The Cloudflare proof app no longer owns a local listener lookup helper.
- The Cloudflare proof input module is now named `index-worker-input.ts`
  instead of `index-worker-product-category-input.ts`.
- ProductCategory remains app-owned proof semantics: the app still chooses the
  ProductCategory entity, root alias, expected fields, and response shape.

Affected boundary:

- Index package Worker composition entrypoint.
- Static module input helper API.
- Cloudflare Index Worker proof input composition.
- Worker bundle import guards.

Validation:

- Focused Index static input and portable-entry tests passed: 2 suites and
  10 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.

Current limitations:

- ProductCategory proof semantics still live in the Cloudflare app by design.
- This helper is a static-input utility, not a general event subscription or
  production observability API.

## Index Worker Pricing PriceRule Relation Manifest

Commit:

- This commit (`Add Index pricing price rule relation manifest`)

Differences from original Medusa:

- The real Admin product list route uses `query.index` when the Index feature
  flag is enabled. Its default fields include
  `variants.prices.price_rules.value` and
  `variants.prices.price_rules.attribute`.
- `@medusajs/pricing/index-worker-static-manifest` now declares the
  `Price.price_rules` relation field and the `PriceRule` indexed entity needed
  by that Admin product response path.
- The Index relation-query proof fixture now seeds a `PriceRule` row plus the
  `Price -> PriceRule` relation edge.
- The Worker relation proof now queries
  `product.variants.prices.price_rules.*` and asserts the nested price-rule
  attribute/value for Durable Object SQLite and D1.

Affected boundary:

- Pricing module Worker-facing manifest entrypoint.
- Index relation-query proof fixture and runner.
- Cloudflare Index Worker proof script assertions.
- Worker bundle import guards.

Validation:

- Pricing static manifest test passed.
- Focused Index static input and storage-provider tests passed: 2 suites and
  26 tests.
- `yarn workspace @medusajs/index test` passed: 11 suites and 51 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace @medusajs/pricing build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving Durable
  Object SQLite and D1 relation-query traversal through
  `Product -> ProductVariant -> Price -> PriceRule`.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.

Current limitations:

- Store product list uses pricing context and `variants.calculated_price`.
  This slice deliberately does not fake calculated prices in the app or Index
  proof.
- The next Store product movement needs either package-owned support for the
  ProductVariantPriceSet `calculated_price` field alias or a clear decision
  that calculated prices remain Remote Query/hydration-owned.

## Index Worker Calculated Price Alias Boundary

Commit:

- This commit (`Fail unresolved Index extended field aliases`)

Differences from original Medusa:

- Original Medusa's Store product list can request
  `variants.calculated_price` through Remote Query context. The Store route
  passes `QueryContext(req.pricingContext)` and the Pricing service calculates
  `PriceSet.calculated_price` dynamically when the virtual relation is
  requested.
- The SQLite Index Worker static manifest builder now fails loudly when a
  selected link-extended field alias cannot be resolved to a real joiner schema
  field or relationship.
- This prevents a Store product manifest from silently dropping
  `ProductVariant.calculated_price` or faking it inside the Cloudflare app.

Affected boundary:

- Index package static module input construction.
- ProductVariantPriceSet link field-alias handling for Worker-facing static
  manifests.
- Store product calculated-price planning boundary.

Validation:

- Focused static module input test passed: 1 suite and 9 tests.
- `yarn workspace @medusajs/index test` passed: 11 suites and 52 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index package
  build.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Store product calculated-price data is still not Index-projected. It remains
  Remote Query/pricing-service hydration-owned until a package-owned dynamic
  pricing path is designed and proven.
- The first attempted parallel Worker proof run collided on the shared Vite
  output directory and failed with a Windows `EPERM` cleanup error. Sequential
  reruns passed.

## Index Worker Product Event Ingestion Proof

Commit:

- This commit (`Switch Index proof event target to Product`)

Differences from original Medusa:

- The Cloudflare Index Worker proof app no longer uses ProductCategory as its
  event-ingestion proof target.
- The proof resolves the package-owned Product created listener from the static
  Index Worker input and emits a Product event through the Worker event bus.
- The no-seed composition check now queries the Product root alias with a
  missing Product ID filter. This keeps the check valid even though the
  relation-query proof seeds Product rows earlier in the same executor.

Affected boundary:

- Cloudflare Index Worker proof runtime.
- Static Index Worker input listener resolution.
- Durable Object SQLite and D1 event-ingestion proof assertions.

Validation:

- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed, proving Product
  event ingestion and Product empty-query composition checks for both Durable
  Object SQLite and D1.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- The Cloudflare proof app still owns the proof response shape and target
  Product fixture. That is app-owned proof semantics, not reusable Medusa
  runtime behavior.

## Product Index Worker Scalar Manifest Coverage

Commit:

- This commit (`Expand Product Index scalar manifest fields`)

Differences from original Medusa:

- Product's Worker-facing Index static manifest now includes the Product and
  ProductVariant scalar fields requested by the real Store/Admin product
  defaults instead of only the earlier proof subset.
- The Worker Product event-ingestion proof now verifies additional Product
  scalar fields (`handle` and `external_id`) through both Durable Object SQLite
  and D1.
- The shared relation-query fixture was intentionally left unchanged after a
  validation run showed that adding new seeded values there changes existing
  `product.*` query-builder assertions.

Affected boundary:

- Product module Worker-facing Index manifest.
- Product static manifest tests.
- Cloudflare Index Worker event-ingestion proof assertions.

Validation:

- Product static manifest test passed.
- Focused Index static input, storage-provider, and proof-runtime tests passed:
  3 suites and 28 tests.
- Full Index unit suite passed: 11 suites and 52 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace @medusajs/product build` passed.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Product relation defaults such as `type`, `collection`, `options`, `tags`,
  `images`, and `variants.options` are not completed by this scalar slice.
- Product enum projection for `status` was not asserted in the Worker proof;
  the event-ingestion proof keeps this slice to string scalar fields.

## Product Type And Collection Index Relations

Commit:

- This commit (`Add Product type collection Index relations`)

Differences from original Medusa:

- Product's Worker-facing Index static manifest now declares the
  `Product.collection` and `Product.type` first-level relations plus
  package-owned `ProductCollection` and `ProductType` indexed entities.
- The SQLite Index relation tree now preserves list-vs-singular relation
  metadata from the schema representation.
- The SQLite storage provider now hydrates/projects singular relations as a
  single object instead of always returning relation arrays. This matches the
  Store/Admin Product response shape for `type` and `collection`.
- The Worker relation proof seeds ProductCollection/ProductType rows only in
  the Worker proof path. The shared query-builder fixture stays unchanged, so
  existing SQLite integration assertions remain stable.

Affected boundary:

- Product module Worker-facing Index manifest.
- Index SQLite query planner relation metadata.
- Index SQLite storage provider relation hydration/projection.
- Cloudflare Index Worker relation-query proof assertions.

Validation:

- Product static manifest test passed.
- Focused Index static input, storage-provider, and proof-runtime tests passed:
  3 suites and 29 tests.
- Full Index unit suite passed in-band: 11 suites and 53 tests. The default
  parallel Jest run exhausted local disk/memory resources on this machine.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace @medusajs/product build` passed.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Product relation defaults for `options`, `options.values`, `tags`, `images`,
  and `variants.options` still need separate package-owned slices.
- Store `variants.calculated_price` remains dynamic pricing hydration work, not
  static Index projection.

## Product Option And Option Value Index Relations

Commit:

- This commit (`Add Product option value Index relations`)

Differences from original Medusa:

- Product's Worker-facing Index static manifest now declares
  `Product.options`, `ProductVariant.options`, `ProductOption`, and
  `ProductOptionValue`.
- The Worker relation proof now derives Product option/value and Variant option
  value traversal from the Product module's real joiner schema instead of an
  app-authored proof schema.
- The proof fixture seeds option and option-value index rows only in the Worker
  proof path. Existing SQLite integration query-builder fixtures remain stable.

Affected boundary:

- Product module Worker-facing Index manifest.
- Index relation-query proof fixture and runner.
- Cloudflare Index Worker relation-query proof assertions.

Validation:

- Product static manifest test passed.
- Focused Index static input, storage-provider, and proof-runtime tests passed:
  3 suites and 29 tests.
- Full Index unit suite passed in-band: 11 suites and 53 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace @medusajs/product build` passed.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Product relation defaults for `tags` and `images` still need separate
  package-owned slices.
- Store `variants.calculated_price` remains dynamic pricing hydration work, not
  static Index projection.

## Product Tag Index Relations

Commit:

- This commit (`Add Product tag Index relations`)

Differences from original Medusa:

- Product's Worker-facing Index static manifest now declares `Product.tags` and
  package-owned `ProductTag`.
- The Worker relation proof now derives Product tag traversal from the Product
  module's real joiner schema instead of an app-authored proof schema.
- The proof fixture seeds tag index rows only in the Worker proof path. Existing
  SQLite integration query-builder fixtures remain stable.

Affected boundary:

- Product module Worker-facing Index manifest.
- Index relation-query proof fixture and runner.
- Cloudflare Index Worker relation-query proof assertions.

Validation:

- Product static manifest test passed.
- Focused Index static input, storage-provider, and proof-runtime tests passed:
  3 suites and 29 tests.
- Full Index unit suite passed in-band: 11 suites and 53 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace @medusajs/product build` passed.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Product image relations still need a package-owned slice.
- Store `variants.calculated_price` remains dynamic pricing hydration work, not
  static Index projection.

## Product Image Index Relations

Commit:

- This commit (`Add Product image Index relations`)

Differences from original Medusa:

- Product's Worker-facing Index static manifest now declares `Product.images`,
  `ProductVariant.images`, and package-owned `ProductImage`.
- The Worker relation proof now derives Product image and direct Variant image
  traversal from the Product module's real joiner schema instead of an
  app-authored proof schema.
- The proof fixture seeds image index rows only in the Worker proof path.
  Existing SQLite integration query-builder fixtures remain stable.
- This slice does not move Product service's variant-image enrichment behavior
  into Index. Static Index relation traversal returns direct image relations;
  Product service post-processing remains service-owned.

Affected boundary:

- Product module Worker-facing Index manifest.
- Index relation-query proof fixture and runner.
- Cloudflare Index Worker relation-query proof assertions.

Validation:

- Product static manifest test passed.
- Focused Index static input, storage-provider, and proof-runtime tests passed:
  3 suites and 29 tests.
- Full Index unit suite passed in-band: 11 suites and 53 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace @medusajs/product build` passed.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Store `variants.calculated_price` remains dynamic pricing hydration work, not
  static Index projection.
- The next Product Index step should audit remaining Store/Admin Product
  defaults and explicitly separate static Index projection from dynamic
  pricing/service hydration.

## Product Sales Channel Index Relations

Commit:

- This commit (`Add Product sales channel Index relations`)

Differences from original Medusa:

- The Product Index route default audit found one remaining static Admin
  product default: `*sales_channels`.
- Sales Channel now exposes a Worker-facing Index static manifest for the real
  `SalesChannel` joiner schema and fields.
- Link Modules now exposes a Worker-facing ProductSalesChannel support joiner
  manifest alongside the existing ProductVariantPriceSet support manifest.
- `ProductSalesChannel` now uses the portable utils entrypoint and has an
  explicit `LinkProductSalesChannel` alias entity so static extended-field
  resolution can derive `Product.sales_channels`.
- Product's Worker-facing Index static manifest now declares
  `Product.sales_channels`.
- The Worker relation proof seeds ProductSalesChannel/SalesChannel rows only in
  the Worker proof path and asserts Product sales channel traversal through
  both Durable Object SQLite and D1.

Affected boundary:

- Product module Worker-facing Index manifest.
- Sales Channel module Worker-facing Index manifest.
- Link Modules Worker-facing support joiner manifests.
- Index relation-query proof fixture and runner.
- Cloudflare Index Worker manifest aggregate and proof assertions.

Validation:

- Product static manifest test passed.
- Sales Channel static manifest test passed.
- Link Modules Index Worker static manifest test passed.
- Focused Index static input, storage-provider, and proof-runtime tests passed:
  3 suites and 29 tests.
- Full Index unit suite passed in-band: 11 suites and 53 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace @medusajs/product build` passed.
- `yarn workspace @medusajs/sales-channel build` passed.
- `yarn workspace @medusajs/link-modules build` passed.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Store `variants.calculated_price` remains dynamic pricing hydration work, not
  static Index projection.
- Product tags/categories filters still intentionally fall back from Index in
  the Store/Admin product routes.

## Product Route Static Index Defaults Audit

Commit:

- This commit (`Guard Product static Index route defaults`)

Differences from original Medusa:

- The Index module now has an executable audit for the current static portions
  of the Store/Admin product route defaults using the real Product, Pricing,
  Sales Channel, ProductVariantPriceSet, and ProductSalesChannel Worker static
  manifests.
- The audit proves the aggregate static schema can represent Product,
  ProductVariant, ProductCollection, ProductType, ProductOption,
  ProductOptionValue, ProductTag, ProductImage, Price, PriceRule, and
  SalesChannel fields needed by the migrated Product route default slices.
- The audit also proves `ProductVariant.calculated_price` remains rejected by
  static Index projection because the ProductVariantPriceSet alias points to
  `PriceSet.calculated_price`, which is a Pricing service virtual relation
  computed from request pricing context.

Affected boundary:

- Index Worker static module input tests.
- Product route Index migration status.

Validation:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.

Current limitations:

- Store `variants.calculated_price` still requires a package-owned dynamic
  pricing hydration path before it can be supported through the Worker runtime.

## Product Category Index Relations And Filters

Commit:

- This commit (`Add Product category Index filters`)

Differences from original Medusa:

- Product's Worker-facing Index static manifest now declares
  `Product.categories` and schema-backed ProductCategory fields required for
  Product route category filters.
- The Product route aggregate static input audit now includes ProductCategory
  and `Product.categories`.
- The Worker relation proof now seeds ProductCategory rows only in the Worker
  proof path, asserts category traversal through Durable Object SQLite and D1,
  and verifies nested Product category and tag filters.
- Store and Admin product list routes no longer fall back to graph mode only
  because `tags` or `categories` filters are present. The existing filter
  normalization remains route-owned; Index now handles the nested relation
  filtering underneath it.
- Admin product Index route filter rewriting now avoids `any` and narrows the
  sales channel relation filter through a local record helper.

Affected boundary:

- Product module Worker-facing Index manifest.
- Index Worker static input audit.
- Index relation-query proof fixture and runner.
- Store/Admin Product Index route fallback logic.
- Cloudflare Index Worker proof assertion script.

Validation:

- Product static manifest test passed.
- Full Index unit suite passed in-band: 11 suites and 55 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace @medusajs/product build` passed.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/medusa build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Store `variants.calculated_price` still requires a package-owned dynamic
  pricing hydration path before it can be supported through the Worker runtime.
- ProductCategory `mpath` is not included in the Worker-facing Index manifest
  because it is not present in the current Product joiner schema.

## Product SQLite Index Search Filter

Commit:

- This commit (`Add SQLite Product Index search filter`)

Differences from original Medusa:

- SQLite Worker Index query planning now treats root `q` filters as post-load
  text search instead of scalar JSON equality.
- SQLite Worker Index storage now applies `q` against root row string fields
  before nested filters and deferred pagination.
- The Worker relation proof now verifies Product `q` search through both
  Durable Object SQLite and D1.

Affected boundary:

- SQLite Index Worker query planner.
- SQLite Index storage provider.
- Index Worker relation-query proof runner.
- Cloudflare Index Worker proof assertion script.

Validation:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed after
  rerunning sequentially because the two proof scripts share a fixed Wrangler
  port.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- SQLite `q` search is root-row string search. It is not yet a full
  PostgreSQL `document_tsv` equivalent across joined entities.
- Store `variants.calculated_price` still requires a package-owned dynamic
  pricing hydration path before it can be supported through the Worker runtime.

## Admin Product Unfiltered Index Route

Commit:

- This commit (`Use Index for unfiltered Admin products`)

Differences from original Medusa:

- The Admin Product list route now uses `query.index` whenever the Index
  feature flag is enabled, including the empty-filter list case that previously
  fell back to graph/refetch mode.
- SQLite Worker Index query planning now emits `countSql` whenever pagination
  `take` is present, not only when callers explicitly pass `skip`. This keeps
  route metadata usable for default list calls where `skip` may be omitted.
- The Worker relation proof now verifies an unfiltered Product list query
  through both Durable Object SQLite and D1, including returned product order
  and `estimate_count`.

Affected boundary:

- Admin Product list route Index fallback logic.
- SQLite Index Worker query planner.
- Index Worker relation-query proof runner.
- Cloudflare Index Worker proof assertion script.

Validation:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 38 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/medusa build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- SQLite `estimate_count` remains an estimate for post-load nested filters,
  search filters, and nested ordering. It counts the direct root SQL candidate
  set, matching the current lightweight Worker planner behavior.
- Store `variants.calculated_price` still requires a package-owned dynamic
  pricing hydration path before it can be supported through the Worker runtime.

## Admin Product Price List Index Filter

Commit:

- This commit (`Support SQLite Index variant id filters`)

Differences from original Medusa:

- The existing Admin Product `price_list_id` middleware still owns price-list
  resolution and rewrites matching prices into `filterableFields.variants.id`.
  This fork now makes the SQLite Worker Index path honor that rewritten nested
  filter shape.
- SQLite nested filter evaluation now treats plain scalar values as equality
  filters and arrays as `$in` filters. Before this, nested scalar/array filters
  were ignored unless they were wrapped in an operator object.
- The shared SQLite query-builder integration suite now covers
  `product.variants.id = ["var_1"]`.
- The Worker relation proof now verifies the same variant-id filter through
  both Durable Object SQLite and D1.

Affected boundary:

- SQLite Index storage provider nested filter evaluation.
- Index query-builder shared SQLite integration assertions.
- Index Worker relation-query proof runner.
- Cloudflare Index Worker proof assertion script.

Validation:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 39 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/medusa build` passed after a sequential rerun
  because the first parallel build started before Index declarations were
  available.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- This proves the Index side of Admin Product `price_list_id` parity after the
  route middleware has resolved variant ids. It does not move price-list
  resolution itself into the Worker Index provider.
- Store `variants.calculated_price` still requires a package-owned dynamic
  pricing hydration path before it can be supported through the Worker runtime.

## Query Index Calculated Price Hydration Guard

Commit:

- This commit (`Guard Query Index calculated price hydration`)

Differences from original Medusa:

- No production behavior changed in this slice. The existing Medusa
  `query.index` design is now guarded for the calculated-price boundary.
- A new `@medusajs/modules-sdk` regression test proves `query.index` uses the
  Index module only for an ID lookup and then delegates requested
  `variants.calculated_price` fields plus `QueryContext` to `query.graph`.
- This records calculated price as dynamic graph/pricing hydration after Index
  lookup, not static Index projection data.

Affected boundary:

- `@medusajs/modules-sdk` Remote Query `Query.index` behavior.
- Store Product calculated-price Index boundary.

Validation:

- Focused modules-sdk test passed:
  `yarn workspace @medusajs/modules-sdk test --runTestsByPath
src/remote-query/__tests__/query-index.spec.ts --runInBand`.
- `yarn workspace @medusajs/modules-sdk build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Validation limitation:

- `yarn workspace medusa-cloudflare test:cart-do-sqlite` was attempted after
  rebuilding `@medusajs/framework`, but the Cloudflare Vite plugin failed
  before Worker startup while resolving
  `file:///.../packages/core/framework/dist/utils/portable.js`. This did not
  reach the Store Product route or calculated-price assertions.

Current limitations:

- This slice proves `Query.index` preserves the graph hydration boundary. It
  does not implement a new Pricing service Worker adapter or move calculated
  price calculation into the Index provider.
- Store `variants.calculated_price` remains dynamic pricing hydration, not
  static Index data.

## Product Root Array Index Filters

Commit:

- This commit (`Support SQLite Index root array filters`)

Differences from original Medusa:

- The original route validators allow direct Product filters such as
  `id: string[]` and Admin `status: ProductStatus[]`. This fork now maps direct
  root array filters in the SQLite Worker Index query planner to SQL `IN`
  predicates instead of scalar equality.
- Empty direct `$in` and `$nin` arrays are handled without emitting invalid
  SQLite `IN ()` SQL.
- The shared SQLite query-builder integration suite now covers
  `product.id = ["prod_1"]`.
- The Worker relation proof now verifies the same root product-id array filter
  through both Durable Object SQLite and D1.

Affected boundary:

- SQLite Index direct-root SQL filter planning.
- Index query-builder shared SQLite integration assertions.
- Index Worker relation-query proof runner.
- Cloudflare Index Worker proof assertion script.

Validation:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 40 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index build.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Validation note:

- A parallel first run of `medusa-cloudflare typecheck` raced the Index build
  and failed on missing freshly built `@medusajs/index` entry declarations. The
  sequential rerun after `@medusajs/index build` passed.

Current limitations:

- This only expands direct root array filters. Dynamic pricing fields such as
  `variants.calculated_price` remain graph/pricing hydration after Index lookup.

## Admin Product Status Index Filter

Commit:

- This commit (`Prove SQLite Index product status filters`)

Differences from original Medusa:

- Original Medusa Admin Product list accepts `status: ProductStatus[]` as a
  direct root Product filter. This fork now has seeded SQLite Worker Index
  coverage proving that filter shape against static Product status data.
- The Product relation proof static input now includes `status`, matching the
  package-owned Product Index Worker static manifest and the Store/Admin
  product route static-default audit.
- A focused SQLite integration test seeds `published` and `draft` statuses and
  verifies `product.status = ["published"]`.
- The Worker relation proof verifies the same Admin-style status filter through
  both Durable Object SQLite and D1.

Affected boundary:

- Index relation-query proof fixture and static Product input.
- SQLite Index query-builder integration assertions.
- Index Worker relation-query proof runner.
- Cloudflare Index Worker proof assertion script.

Validation:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 41 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index build.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Validation note:

- A parallel first run of `medusa-cloudflare typecheck` raced the Index build
  and failed on missing freshly built `@medusajs/index` entry declarations. The
  sequential rerun after `@medusajs/index build` passed.

Current limitations:

- This proves Admin `status` root array filtering. It does not add separate
  seeded coverage for every other Product root scalar field.
- Store `variants.calculated_price` remains dynamic graph/pricing hydration,
  not static Index data.

## Product Transformed Relation Index Filters

Commit:

- This commit (`Prove SQLite Index product relation filters`)

Differences from original Medusa:

- Original Medusa Product route validation and Index routes rewrite several
  HTTP filter names before `query.index` runs:
  - `tag_id` becomes `tags.id`.
  - `category_id` becomes `categories.id`, with Store default category filters
    adding active/internal constraints.
  - `sales_channel_id` becomes `sales_channels.id` inside the Store/Admin
    Index route handlers.
- This fork now has seeded SQLite Worker Index coverage proving those
  relation-filter shapes with array ids.
- The focused SQLite integration test seeds Product category, tag, and sales
  channel relations and verifies a combined route-shaped relation filter.
- The Worker relation proof verifies the same combined relation filter through
  both Durable Object SQLite and D1.

Affected boundary:

- SQLite Index relation filter traversal and relation pruning behavior.
- Index query-builder SQLite integration assertions.
- Index Worker relation-query proof runner.
- Cloudflare Index Worker proof assertion script.

Validation:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 42 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index build.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Validation note:

- A parallel first run of `medusa-cloudflare typecheck` raced the Index build
  and failed on missing freshly built `@medusajs/index` entry declarations. The
  sequential rerun after `@medusajs/index build` passed.

Current limitations:

- Relation scalar field selection still returns the hydrated related row, which
  matches existing Index behavior such as `product.variants.id` returning
  variant `sku`.
- Direct Product `collection_id` and `type_id` filters still need separate
  seeded proof because they are direct Product fields, not transformed relation
  filters.

## Product Direct Type And Collection Index Filters

Commit:

- This commit (`Prove SQLite Index product type collection filters`)

Differences from original Medusa:

- Original Medusa Product routes expose `collection_id` and `type_id` as direct
  Product filters. Unlike `tag_id`, `category_id`, and `sales_channel_id`, they
  are not rewritten into relation filters before `query.index` runs.
- This fork now has seeded SQLite Worker Index coverage proving direct root
  `collection_id` and `type_id` array filters against Product root fields.
- The type/collection proof seed now stores `collection_id` and `type_id` on
  the Product row while preserving the status field required by the Admin
  status filter proof.
- The Worker relation proof verifies the same direct filter shape through both
  Durable Object SQLite and D1.

Affected boundary:

- Index relation-query proof fixture Product root data.
- SQLite Index direct root filter integration assertions.
- Index Worker relation-query proof runner.
- Cloudflare Index Worker proof assertion script.

Validation:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 43 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index build.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Validation note:

- A parallel first run of `medusa-cloudflare typecheck` raced the Index build
  and failed on missing freshly built `@medusajs/index` entry declarations. The
  sequential rerun after `@medusajs/index build` passed.

Current limitations:

- This proves the direct Product `collection_id` and `type_id` array-filter
  path. Other scalar Product filters still share the same root planner behavior
  but may not all have separate seeded tests.
- Store `variants.calculated_price` remains dynamic graph/pricing hydration,
  not static Index data.

## Product Direct Scalar And Operator Index Filters

Commit:

- This commit (`Prove SQLite Index product scalar filters`)

Differences from original Medusa:

- Original Medusa Product routes expose direct scalar filters such as
  `handle`, `external_id`, `is_giftcard`, `created_at`, `updated_at`, and
  `deleted_at`. This fork now seeds those fields in the SQLite Worker Index
  Product proof input instead of relying only on `id`, `title`, and `status`.
- A focused SQLite integration test verifies direct route scalar filters for
  handle, external id, boolean gift-card state, and timestamp range operators.
- The Worker relation proof verifies the same scalar/operator filter shape
  through both Durable Object SQLite and D1.
- The SQLite sync metadata assertion now records the expanded Product static
  field set.

Affected boundary:

- Index relation-query proof fixture Product root field set.
- SQLite Index direct scalar and operator filter integration assertions.
- SQLite Index sync metadata expectations.
- Index Worker relation-query proof runner.
- Cloudflare Index Worker proof assertion script.

Validation:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 44 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index build.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Validation notes:

- A parallel first run of `medusa-cloudflare typecheck` raced the Index build
  and failed on missing freshly built `@medusajs/index` entry declarations. The
  sequential rerun after `@medusajs/index build` passed.
- The first workerd proof run exposed that `q: "Product 1"` searches all string
  root fields. The second product timestamp seed was adjusted to avoid an
  accidental match while preserving broad search behavior.

Current limitations:

- This proves the remaining direct scalar/operator Product route filter group.
- Store `variants.calculated_price` remains dynamic graph/pricing hydration,
  not static Index data.

## Product Variant Route Index Filters

Commit:

- This commit (`Prove SQLite Index product variant route filters`)

Differences from original Medusa:

- Original Medusa Store/Admin Product routes accept nested variant filters for
  `variants.id`, `variants.sku`, `variants.options.value`,
  `variants.options.option_id`, and variant timestamp operator fields.
- This fork already covered variant `id` and `sku`; it now seeds variant
  `created_at`, `updated_at`, and `deleted_at` in the SQLite Worker Index
  ProductVariant proof input.
- A focused SQLite integration test verifies a route-shaped nested variant
  filter combining a variant timestamp range with `variants.options.value` and
  `variants.options.option_id`.
- The Worker relation proof verifies the same nested variant route filter
  through both Durable Object SQLite and D1.
- The SQLite sync metadata assertion now records the expanded ProductVariant
  static field set.

Affected boundary:

- Index relation-query proof fixture ProductVariant field set.
- SQLite Index nested variant scalar/operator and option relation filters.
- SQLite Index sync metadata expectations.
- Index Worker relation-query proof runner.
- Cloudflare Index Worker proof assertion script.

Validation:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 45 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Store `variants.calculated_price` remains dynamic graph/pricing hydration,
  not static Index data.

## Index Worker Event Lifecycle Proof

Commit:

- This commit (`Prove SQLite Index worker event lifecycle`)

Differences from original Medusa:

- Original Medusa Index worker mode registers create/update/delete listeners
  from the schema `@Listeners` metadata and consumes those events through the
  storage provider.
- This fork already proved Worker event ingestion for a Product create event.
  It now proves the full Product create/update/delete lifecycle through the
  same static manifest listener resolution.
- The shared Index package owns the lifecycle proof helper. The Cloudflare app
  remains a thin composition root that supplies the Product fixture, mutable
  proof query state, and DO/D1 executors.
- The proof remote query can now read records lazily from a mutable record
  source so update/delete events still exercise `query.graph` through the real
  `consumeEvent` path.

Affected boundary:

- Index Worker proof dependency factory and remote-query proof fixture.
- Index Worker proof-check helper API.
- `@medusajs/index/worker-composition` export surface.
- Cloudflare Index Worker DO and D1 event-ingestion proof response.
- Cloudflare workerd assertion script.

Validation:

- Full Index unit suite passed in-band: 11 suites and 58 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 45 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed with 1527 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

Validation note:

- The first import-guard attempt used stale script names
  `test:portable-imports` and `test:index-imports`. The current app guard
  scripts are `check:imports`, `check:portable-entrypoints`, and
  `check:real-module-imports`; all passed.

Current limitations:

- This proves Product entity create/update/delete lifecycle events. Relation
  attach/detach event proof remains a separate Index-owned boundary if a later
  route or module slice needs it.

## Index Worker Link Attach Detach Proof

Commit:

- This commit (`Prove SQLite Index worker link attach detach`)

Differences from original Medusa:

- Original Medusa Index worker mode registers link object listeners such as
  `LinkProductVariantPriceSet.attached` and `.detached` from the schema object
  representation built with link joiner configs.
- This fork now proves that the static Worker Index composition registers
  those link listeners and consumes attach/detach events through the real
  storage-provider subscriber path.
- A package-owned support seed creates the Product, ProductVariant, PriceSet,
  Price, and non-link relations required for the attach event to become visible
  through `product.variants.prices`.
- The workerd proof emits a link attach event, verifies that a nested
  Product -> Variant -> Price query matches, then emits detach and verifies the
  same nested filter returns no rows.

Affected boundary:

- Index Worker proof-check helper API for attach/detach relation events.
- Index relation proof fixture support seed for link attach visibility.
- `@medusajs/index/worker-composition` and relation proof subpath exports.
- Cloudflare Index Worker DO and D1 proof endpoints.
- Cloudflare workerd assertion script.

Validation:

- Full Index unit suite passed in-band: 11 suites and 59 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 45 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed after the
  package build completed.
- Worker bundle Node-only import guard passed with 1527 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

Validation notes:

- The first link detach proof used pagination and exposed that SQLite count
  metadata is computed before deferred nested relation filters. The proof now
  omits pagination and asserts the authoritative detached result data instead.
- A parallel first run of `medusa-cloudflare test:index-do-sqlite` raced
  `@medusajs/index build` and failed while the package `dist` subpath was
  temporarily missing. The sequential rerun passed.

Current limitations:

- This proves ProductVariantPriceSet attach/detach through nested price
  traversal. Other link modules can reuse the same proof shape when their
  route or module behavior becomes the active Index slice.

## SQLite Index Post-Load Count Metadata

Commit:

- This commit (`Fix SQLite Index post-load count metadata`)

Differences from original Medusa:

- Original Index query behavior expects pagination metadata to describe the
  final filtered root result set.
- The SQLite provider previously used SQL `COUNT(*)` even when pagination had
  to be deferred for post-load filtering such as `q`, nested object filters,
  logical root filters, or nested relation filters. That could report rows
  later removed by in-memory pruning.
- The SQLite provider now reports `estimate_count` from the post-load
  `filteredData.length` whenever pagination is deferred, while direct SQL
  filter paths continue using SQL count.
- The ProductVariantPriceSet attach/detach workerd proof keeps pagination on
  its detached nested relation query and asserts `estimate_count: 0`.

Affected boundary:

- SQLite Index storage provider pagination metadata.
- SQLite provider unit assertions for `q`, deep root filters, nested relation
  filters, and nested price filters.
- Cloudflare ProductVariantPriceSet attach/detach workerd proof.

Validation:

- Full Index unit suite passed in-band: 11 suites and 59 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 45 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- Worker bundle Node-only import guard passed with 1527 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

Current limitations:

- Direct SQL-filter count still uses SQLite `COUNT(*)`, as before.
- Join filters prune nested relation arrays but do not remove root rows; this
  slice preserves that behavior.

## Index Worker Product Proof Runtime Ownership

Commit:

- This commit (`Move Index worker product proof runtime into package`)

Differences from original Medusa:

- The Cloudflare app previously owned the Product/link Worker proof runtime
  class that assembled the Index worker runtime, emitted Product lifecycle
  events, emitted ProductVariantPriceSet attach/detach events, and shaped proof
  responses.
- That reusable proof runtime now lives in `@medusajs/index/worker-composition`
  as `SqliteIndexWorkerProductProofRuntime`.
- The Cloudflare app now only supplies the executor binding, static module
  input, generated event names, and explicit proof records.
- Product/link proof behavior stays package-owned alongside the SQLite Index
  provider, relation proof fixtures, and Worker proof helpers.

Affected boundary:

- Index package Worker composition export surface.
- Product/link Worker proof runtime ownership.
- Cloudflare Index proof app composition root.
- Proof target types for Product and ProductVariantPriceSet link records.

Validation:

- Full Index unit suite passed in-band: 11 suites and 59 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 45 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed with 1528 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.
- `git diff --check` passed.

Current limitations:

- The runtime remains a proof/composition utility, not a production Remote
  Query or Event Bus implementation.
- The app still owns HTTP endpoints and Cloudflare executor bindings, which is
  the intended app-root responsibility.

## Index Worker Product Proof Event Resolution

Commit:

- This commit (`Move Index worker product proof events into package`)

Differences from original Medusa:

- The Cloudflare app previously resolved Product created/updated/deleted event
  names and hardcoded ProductVariantPriceSet attached/detached event names.
- `@medusajs/index/worker-composition` now exports
  `createSqliteIndexWorkerProductProofEvents`.
- `SqliteIndexWorkerProductProofRuntime` derives its default Product/link
  proof events from the static input, so the app no longer owns proof event
  resolution.
- `apps/medusa-cloudflare/src/index-worker-input.ts` now only builds the
  static module input from the app-selected manifest.

Affected boundary:

- Index package Worker composition event resolution.
- Cloudflare Index proof app wrapper.
- Product/link Worker proof runtime defaults.

Validation:

- Full Index unit suite passed in-band: 12 suites and 61 tests.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 45 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed after the Index package
  build completed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed with 1528 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.
- `git diff --check` passed.

Validation note:

- A parallel first run of `medusa-cloudflare typecheck` raced
  `@medusajs/index build` and saw missing package `dist` subpaths. The
  sequential rerun after the build passed.

Current limitations:

- ProductVariantPriceSet link proof event names are package-owned proof
  defaults. They are still proof-specific and do not imply a production Event
  Bus naming abstraction.

## Index Worker Product Proof Dependency Ownership

Commit:

- This commit (`Move Index worker proof dependencies into package`)

Differences from original Medusa:

- The Product/link Worker proof fixtures and mutable proof dependency factory
  have moved from `apps/medusa-cloudflare` into
  `@medusajs/index/worker-composition`.
- `@medusajs/index/worker-composition` now exports the default Product proof
  target, updated Product proof target, ProductVariantPriceSet link target,
  and `createSqliteIndexWorkerProductProofDependencies`.
- The Cloudflare app keeps only compatibility aliases for its existing proof
  dependency names. It no longer owns Product/link proof records or the remote
  query/event bus proof dependency assembly.

Affected boundary:

- Index package Worker composition export surface.
- Product/link Worker proof fixture ownership.
- Cloudflare Index proof app dependency shim.

Validation:

- Full Index unit suite passed in-band: 12 suites and 62 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 45 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed with 1528 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.
- `git diff --check` passed.

Current limitations:

- These helpers remain proof/composition utilities. Production Worker
  deployments still supply real Remote Query and Event Bus services from the
  application/platform root.

## Index Worker Proof App Shim Removal

Commit:

- This commit (`Compose Index worker proof runtime directly`)

Differences from original Medusa:

- `apps/medusa-cloudflare` no longer has an `IndexWorkerRuntime` subclass or
  a Product/link proof dependency alias file.
- The Durable Object and D1 Worker proof entrypoints now instantiate
  `SqliteIndexWorkerProductProofRuntime` directly from
  `@medusajs/index/worker-composition`.
- The app still supplies the Cloudflare SQLite executor binding and selected
  static Index input, which remain application-root responsibilities.

Affected boundary:

- Cloudflare Index proof app composition root.
- Index package Worker proof runtime consumption.
- Worker bundle import graph for the Index proof.

Validation:

- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed with 1526 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

Current limitations:

- The app still owns proof HTTP endpoints, Durable Object binding selection,
  D1 binding selection, and the static manifest selection. These are intended
  app-root responsibilities and are not package-owned proof logic.

## SQLite Index Milestone Completion Audit

Commit:

- This commit (`Record SQLite Index completion audit`)

Differences from original Medusa:

- This fork now has a SQLite/D1-compatible Index persistence path and
  Worker-compatible proof composition for the Product/Pricing route slice.
- Original Medusa's MikroORM/Postgres Index path remains separate. The
  Cloudflare path uses the package-owned SQLite storage provider, static
  module manifests, and explicit Worker composition helpers.
- The Cloudflare app no longer owns duplicated Index proof runtime logic; it
  owns only Cloudflare routing, bindings, executor adapters, and manifest
  selection.

Completion evidence:

- SQLite Index package unit suite passed in-band: 12 suites and 62 tests.
- `yarn workspace @medusajs/index build` passed.
- `yarn workspace @medusajs/index test:integration:sqlite` passed: 3 suites
  and 45 tests.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed.
- `yarn workspace medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed with 1526 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

Accepted boundary:

- Product route/static Index behavior is covered by the current proof matrix.
- `ProductVariant.calculated_price` is not static Index data; it remains
  dynamic graph/pricing hydration after Index lookup.
- Durable Object SQLite and D1 both execute the same relation query,
  composition, Product event lifecycle, and ProductVariantPriceSet
  attach/detach checks.

Current limitations:

- This is not a production Cloudflare platform runtime by itself. HTTP
  bootstrap, production Event Bus, production Remote Query, and broader
  platform composition remain separate milestones.
- Do not expand Index tests now unless a future change touches Index behavior
  or identifies a concrete route gap.

## Commerce Module Persistence Completion Audit

Commit:

- This commit (`Record commerce module set completion audit`)

Differences from original Medusa:

- This fork now has a Drizzle/SQLite-compatible path and Worker static
  composition proof for the current commerce/runtime module set used by
  `apps/medusa-cloudflare`.
- Original Medusa still defaults to MikroORM/Postgres and filesystem/runtime
  discovery. This fork keeps that path while proving the Cloudflare path
  through static manifests, Drizzle managers, Durable Object SQLite, D1/SQLite
  Index executors, Queue Event Bus, Durable Object Locking, and Workflow
  storage adapters.
- The module migration strategy remains in-place. No app-local replacement
  module services were added.

Completion evidence:

- The built Worker Cart DO SQLite proof passed through real services for
  Analytics, API Key, Auth, Cart, Caching, Currency, Customer, Event Bus, File,
  Fulfillment, Inventory, Locking, Notification, Order, Payment, Pricing,
  Product, Promotion, RBAC, Region, Sales Channel, Settings, Stock Location,
  Store, Tax, Translation, User, and Workflow Engine.
- The proof also validated Cart totals, Queue dispatch, Durable Object
  locking, Workflow execution persistence, Workflow schedule persistence,
  alarm recovery, and atomic rollback.
- Cloudflare app typecheck passed.
- Worker bundle Node-only import guard passed with 1532 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.
- Product's current Drizzle selector was rechecked and all Product integration
  specs passed under the unchanged module-test runner: 10 suites, 205 passing,
  1 skipped.

Accepted boundary:

- The current commerce module-set persistence milestone is complete enough to
  stop choosing the next task by rerunning already-covered module gates.
- Future module work should start only when a real module is touched, a missing
  unchanged integration suite is identified, or a production runtime boundary
  exposes a concrete module behavior gap.

Current limitations:

- This is not production HTTP/bootstrap completion.
- Provider discovery, hosted tenant routing, production Remote Query, and
  production Event Bus deployment semantics remain separate milestones.
- The Worker proof validates representative service behavior, not every
  HTTP/workflow path that Medusa exposes.

## PGlite Jest-Vitest Integration Foundation

Commit:

- `f8444e6f69` (`test: add Vitest integration foundation`)

Date verified: 2026-07-11.

Differences from original Medusa:

- The PGlite integration orchestrator now accepts `--runner jest|vitest` while
  preserving Jest as the default and preserving the existing CI invocation.
- Vitest is supported only for the `@medusajs/test-utils` adapter/foundation
  lane. All 24 production module lanes remain Jest-only and fail closed when
  requested through the Vitest selector.
- A serial Vitest integration profile composes the existing environment setup
  and runner-compatibility foundation without changing persistence production
  code.
- A two-test contract outside the package unit-test tree exercises the real
  PGlite module-test adapter and built fixture through create, prepare, setup,
  clear, module initialization, shutdown, and closed-client cleanup.

Affected boundary:

- root PGlite integration-lane selection and environment construction;
- shared Vitest integration configuration;
- `@medusajs/test-utils` module-runner/PGlite test coverage only.

Validation:

- the pre-change PGlite adapter baseline passed two files and 32 tests under
  Jest;
- default Jest and Vitest adapter commands each passed the accepted three-file,
  34-test, zero-snapshot foundation, while explicit-Jest option forms passed the
  selector/planning contract;
- normalized Jest/Vitest files, test names, statuses, counts, and snapshots were
  exact;
- Vitest exited naturally after PGlite cleanup; Jest retained its existing
  force-exit rollback behavior;
- the selector retained the exact 25-lane default order and rejected
  unsupported Vitest lane, list, and full-matrix requests before spawning;
- package build/unit tests, strict runner-tooling checks, shared runner parity,
  workspace policy, remaining-Jest inventory, and Cloudflare type/import gates
  passed.
- the remaining-Jest inventory now explicitly tracks both direct
  Jest-executing parity verifiers, including this integration foundation, so a
  later zero-Jest gate cannot overlook the CI proof itself.

Current limitations:

- No Currency or other production module assertion ran under Vitest in this
  turn.
- PostgreSQL, Redis, HTTP, workerd, D1, and the remaining PGlite module lanes
  are not part of this parity claim.
- The lifecycle contract proves explicit timeout wiring, not timeout failure or
  cancellation behavior.
- The module runner's duplicate signal-handler installation and broad listener
  cleanup are pre-existing concerns retained for a separate focused change.

## Currency Integration Persistence Parity Under Jest And Vitest

Commit:

- `dca870fee4` (`test: shadow Currency integration with Vitest`)

Date verified: 2026-07-11.

Differences from original Medusa:

- The unchanged Currency module-service integration assertion now has an
  opt-in Vitest shadow while its existing Jest integration command remains the
  authoritative package default.
- The proof treats MikroORM/PostgreSQL, PGlite, and Drizzle/SQLite as three
  distinct persistence backends. PGlite uses the test-utils custom
  `pgliteModulePersistenceAdapter` and `@electric-sql/pglite` at `memory://`;
  it is not the Drizzle backend.
- Drizzle selects the existing `@medusajs/drizzle/medusa-test` adapter and
  Node's `node:sqlite` `:memory:` database. It is neither PGlite nor D1/workerd.
  PostgreSQL retains the original MikroORM module path.
- No persistence implementation, DML model, module service, assertion, expected
  value, database migration, or production composition changed.

Affected boundary:

- the Currency package's manual Vitest integration command and exact-file
  configuration;
- Currency selection in the serial PGlite orchestrator;
- a typed verifier that compares all three backends under Jest and Vitest;
- a focused PostgreSQL-backed CI shadow job.

Validation:

- pre-edit Jest baselines passed the unchanged one-file/13-test specification
  separately on PostgreSQL, PGlite, and Drizzle/SQLite;
- the final verifier passed all six runner/backend quadrants at one file, 13
  tests, and zero failures, skips, todos, or snapshots, with exact normalized
  full-name/status parity;
- the real default-Jest and explicit-Vitest Currency PGlite selectors both
  passed one lane and 13 tests;
- local PostgreSQL proof used a temporary isolated PostgreSQL 18 cluster on
  `127.0.0.1:55433` without changing the machine's configured service;
- the package builds and Currency unit default/rollback passed;
- D1 workerd and Durable Object SQLite Currency service/rollback proofs passed;
- Cloudflare typecheck, app tests, production build, composed import guard,
  runtime-source guard, portable-entrypoint guards, and real Currency import
  audit passed.

Accepted boundary:

- The normalized-LF assertion-source digest is
  `73b9ff980e9e4431fa18e3f4ed87f13dfed35e6f3e02b1388be6a439027d754f`;
  the file still contains 13 tests and 18 assertions with no skip, todo, or
  snapshot ownership.
- This proves the Node module-test runner on three persistence backends. The
  Cloudflare validations are regressions around the production bundle and
  Currency service adapters, not execution of the Node integration spec inside
  workerd.
- Redis-backed suites, HTTP behavior, other production module lanes, and the
  integration-default switch remain separate.
- Hosted execution of the focused CI job is pending until publication. The
  later test-runner deferral policy permits the locally proven Currency
  cut-over without changing or broadening this persistence evidence. Any
  future hosted failure must still be resolved before claiming hosted support.

## Currency Integration Vitest Default Persistence Proof

Commit:

- `9e3da4fa6e` (`test: switch Currency integration to Vitest`)

Date verified: 2026-07-11.

Differences from original Medusa:

- Currency's unchanged module-service integration specification now runs under
  Vitest by default, with the exact former Jest command retained as
  `test:integration:jest`.
- Persistence selection and implementation are unchanged. MikroORM uses real
  PostgreSQL, PGlite uses the custom `pgliteModulePersistenceAdapter` at
  `memory://`, and Drizzle uses `@medusajs/drizzle/medusa-test` with
  `node:sqlite` `:memory:`.
- The global serial PGlite matrix still defaults to Jest. Currency's selector
  explicitly uses the rollback for Jest and the package default for Vitest.
- No model, service, repository, migration, assertion, expected value,
  transaction implementation, or production composition changed.

Validation:

- fresh pre-edit and post-edit results were exact across all six
  Jest/Vitest x PostgreSQL/PGlite/Drizzle quadrants: one file, 13 passed tests,
  zero failures/skips/todos, and zero snapshots;
- every normalized file and full test-name/status set matched across runners
  and all three backends;
- the assertion source remained byte-for-byte unchanged at normalized-LF
  SHA-256
  `73b9ff980e9e4431fa18e3f4ed87f13dfed35e6f3e02b1388be6a439027d754f`;
- an isolated PostgreSQL 18 cluster on `127.0.0.1:55434` supplied local server
  semantics without changing the machine's configured service;
- both real Currency PGlite selectors, package builds/unit rollback, shared
  runner foundation, workspace policy, and inventory passed;
- D1 workerd and Durable Object SQLite Currency service/rollback proofs passed;
- Cloudflare typecheck, app tests, Vite production build, composed import
  guard, runtime-source guard, portable-entrypoint guards, and real Currency
  import audit passed.

Accepted boundary:

- This is the Currency Node integration-default cut-over, not a persistence
  implementation change.
- The generic three-way package shard cannot represent a one-file Vitest suite;
  the dedicated unsharded Currency job owns that CI proof without narrowing the
  three persistence backends. The stable package aggregate requires both the
  generic matrix and dedicated Currency result.
- Cloudflare validations are separate regressions. They do not claim the Node
  integration specification ran in workerd, D1, or Durable Object SQLite.
- Redis-backed suites, HTTP behavior, the other 23 module lanes, and hosted
  execution remain separate; hosted status is deferred, not passing.

## API Key Integration Persistence Parity Under Jest And Vitest

Commit:

- `8e299ab14b` (`test: add API Key integration Vitest shadow`)

Date verified: 2026-07-14.

Differences from original Medusa:

- The unchanged API Key module-service integration specification now has an
  opt-in Vitest shadow. Its existing Jest integration command remains the
  authoritative package default.
- The proof keeps three persistence implementations distinct:
  MikroORM/PostgreSQL uses the original module path; PGlite uses the existing
  test-utils `pgliteModulePersistenceAdapter` at `memory://`; Drizzle uses
  `@medusajs/drizzle/medusa-test` with Node `node:sqlite` `:memory:`.
- PGlite is not Drizzle, and Drizzle/SQLite is not D1 or workerd. No persistence
  adapter, DML model, module service, repository, migration, assertion, fixture,
  expected value, transaction behavior, or production composition changed.

Affected boundary:

- the API Key package's manual Vitest integration command and exact-file serial
  configuration;
- the typed legacy Jest bridge's narrow fake-time surface;
- explicit API Key Vitest selection in the serial PGlite orchestrator;
- local runner/backend parity evidence only.

Validation:

- pre-edit Jest baselines passed one file and all 25 tests separately on
  PostgreSQL, PGlite, and Drizzle/SQLite;
- post-edit Jest and Vitest each passed the same one file and 25 tests on all
  three backends, for six green quadrants with zero failures, skips, todos, or
  snapshots;
- ten exact machine-readable comparisons preserve every repository-relative
  file, full test name, status, count, and zero-snapshot state across runners,
  backends, and pre/post Jest results;
- both real serial selectors pass all 25 tests:
  `pnpm test:integration:pglite --only=api-key` and
  `pnpm test:integration:pglite --runner=vitest --only=api-key`;
- the unqualified 25-lane PGlite matrix remains Jest-default. Adapter, Currency,
  and API Key accept explicit Vitest; Translation is first unsupported and
  selection still fails closed before spawning;
- local PostgreSQL proof used an isolated PostgreSQL 18 cluster on
  `127.0.0.1:55435` with trust authentication. The machine's configured
  PostgreSQL service and credentials were not read or changed;
- after all PostgreSQL validation completed, the temporary cluster was stopped,
  `pg_isready` confirmed no response, and the verified `C:\tmp` data directory
  and log were safely removed;
- API Key build/unit default/unit rollback, strict runner tooling, workspace
  policy, remaining-Jest inventory, and all Cloudflare type/import gates passed.

Accepted boundary:

- The normalized-LF assertion-source and fixture digests remain
  `5d8cddfb7adc1be6187cd9a75e816d22e268d4dd3dfd4d1799c26715568797e2`
  and `d58ffcbac802bccc5b3263575dce2aa71973c84218d400eec1d780999bedde37`.
  The source still contains 25 tests and 46 textual assertions with no skip,
  todo, or snapshot ownership.
- This proves the Node module-test runner against three persistence backends.
  The Cloudflare gates are regressions around the portable production graph;
  they do not claim the Node integration spec ran inside workerd, D1, or Durable
  Object SQLite.
- The one-file Vitest suite cannot join the generic three-way integration shard.
  This opt-in shadow therefore has no CI owner. Default cut-over, dedicated
  unsharded job ownership, rollback retention, and hosted execution remain the
  next separate boundary.
- Redis-backed suites, HTTP behavior, other production modules, persistence
  replacement, and runtime deployment behavior remain outside this proof.

## API Key Integration Vitest Default Persistence Proof

Commit:

- `62c89b3ad6` (`test: switch API Key integration to Vitest`)

Date verified: 2026-07-14.

Differences from original Medusa:

- The unchanged API Key module-service integration specification now runs under
  Vitest by default, with the exact former Jest command retained as
  `test:integration:jest`.
- Persistence selection and implementation remain unchanged. MikroORM uses real
  PostgreSQL, PGlite uses the existing test-utils
  `pgliteModulePersistenceAdapter` at `memory://`, and Drizzle uses
  `@medusajs/drizzle/medusa-test` with Node `node:sqlite` `:memory:`.
- The global serial PGlite matrix remains Jest-default. Its API Key Jest lane
  explicitly selects the rollback command, while explicit Vitest selection uses
  the package default.
- No adapter, DML model, module service, repository, migration, assertion,
  fixture, expected value, transaction behavior, or production composition
  changed.

Affected boundary:

- the API Key package integration default and exact Jest rollback;
- the PGlite runner-to-script mapping for API Key;
- the generic fast integration graph, which excludes the one-file API Key suite
  because Vitest cannot represent it in a three-way shard;
- a dedicated runner-neutral, unsharded PostgreSQL CI job and the stable package
  aggregate that now requires its result.

Validation:

- fresh pre-cutover and post-cutover reports covered all six
  Jest/Vitest x PostgreSQL/PGlite/Drizzle quadrants, producing 12 reports total;
- every report passed the same one file and 25 tests with zero failures, skips,
  todos, or snapshots, and all 12 normalized exactly to the same
  repository-relative file, full test-name/status set, counts, and snapshot
  state;
- both real serial selectors passed all 25 tests:
  `pnpm test:integration:pglite --only=api-key` exercised the Jest rollback and
  `pnpm test:integration:pglite --runner=vitest --only=api-key` exercised the
  Vitest default;
- local PostgreSQL proof used an isolated PostgreSQL 18.3 cluster on
  `127.0.0.1:55436`. The machine's configured PostgreSQL service and credentials
  were not read or changed;
- after validation, the temporary cluster was stopped, `pg_isready` confirmed
  no response, and the verified `C:\tmp` data directory and log were safely
  removed;
- API Key build, Vitest unit default, Jest unit rollback, shared runner
  foundation, workspace dependency policy, frozen offline install, remaining-
  Jest inventory, all package graphs, workflow parsing, and Cloudflare
  type/import gates passed.

Accepted boundary:

- The normalized-LF assertion-source and fixture digests remain
  `5d8cddfb7adc1be6187cd9a75e816d22e268d4dd3dfd4d1799c26715568797e2`
  and `d58ffcbac802bccc5b3263575dce2aa71973c84218d400eec1d780999bedde37`.
  The source still contains 25 tests and 46 textual assertions with no skip,
  todo, or snapshot ownership.
- This proves the unchanged Node module-test runner against three persistence
  backends. The dedicated CI job proves the Vitest default against PostgreSQL
  only; the six-quadrant backend parity remains a local acceptance gate.
- Cloudflare validations are separate production-graph regressions. They do not
  claim the Node integration specification ran inside workerd, D1, or Durable
  Object SQLite.
- Hosted CI execution remains deferred until this commit is pushed. Redis-
  backed suites, HTTP behavior, Translation and other production modules,
  persistence replacement, and runtime deployment behavior remain separate.

## Translation Integration Persistence Parity Under Jest And Vitest

Commit:

- `e07b25bebc` (`test: add Translation integration Vitest shadow`)

Date verified: 2026-07-30.

Differences from original Medusa:

- The unchanged Translation module-service integration specification now has
  an opt-in Vitest shadow. Jest remains the authoritative package integration
  runner.
- Persistence selection and implementation remain unchanged. MikroORM uses
  real PostgreSQL, PGlite uses the existing module-test
  `pgliteModulePersistenceAdapter` at `memory://`, and Drizzle uses
  `@medusajs/drizzle/medusa-test` with Node SQLite `:memory:`.
- PGlite is not Drizzle, and Drizzle/SQLite is not D1 or workerd. No adapter,
  DML model, service, repository, migration, transaction implementation,
  assertion, fixture, expected value, or production composition changed.

Affected boundary:

- Translation's manual Vitest integration command and sole-file profile;
- explicit Translation Vitest selection in the serial PGlite orchestrator;
- local runner/backend parity evidence only.

Validation:

- pre-edit Jest passed one file and all 60 tests separately on PostgreSQL,
  PGlite, and Drizzle/SQLite;
- post-edit Jest and Vitest each passed the same one file and 60 tests on all
  three backends;
- all nine normalized pre/post runner/backend reports preserve every
  repository-relative file, full test name, status, count, and zero-snapshot
  state at digest
  `8025698d0223bf2025a09234db22efbb35795bea399ad5f86b2d9b81cf53ea90`;
- both real serial selectors pass all 60 tests, while the unqualified 25-lane
  PGlite matrix remains Jest-default and Settings becomes the first unsupported
  Vitest lane;
- the isolated PostgreSQL 18 cluster on `127.0.0.1:55440` supplied local
  server semantics without reading or changing the machine service
  configuration. After validation it was stopped, the port had no listener,
  and the verified temp data directory and log were removed;
- Translation build/unit lanes, strict runner tooling, full runner foundation,
  workspace policy, frozen offline install, exact inventory, and all
  Cloudflare portability/workerd gates passed.

Accepted boundary:

- The normalized-LF assertion-source and fixture digests remain
  `82c07ea1896c5b10f09616d708b0ecbff5f80645d5404f832c62c199016b4822`
  and `b9fc360f33e2488ac15487b999dee2663fb736178d508e545894b914952a2ee6`.
  The source still owns 60 tests, 104 textual assertions, and zero skips,
  todos, or snapshots.
- This proves the unchanged Node module-test runner against three persistence
  backends. Cloudflare gates are production-graph regressions; they do not
  claim this Node integration spec ran inside workerd, D1, or Durable Object
  SQLite.
- A real Vitest `/3` run exits 1 because the suite has one file. This opt-in
  shadow therefore has no CI owner. Default cut-over, dedicated unsharded
  PostgreSQL ownership, rollback retention, and hosted execution remain the
  next separate boundary.
- Redis-backed suites, HTTP behavior, other production modules, persistence
  replacement, and deployment behavior remain outside this proof.

## Translation Integration Vitest Default Persistence Proof

Commit:

- `0eeb819d16` (`test: switch Translation integration to Vitest`)

Date verified: 2026-07-30.

Differences from original Medusa:

- The unchanged Translation module-service integration specification now runs
  under Vitest by default, with the exact former Jest command retained as
  `test:integration:jest`.
- Persistence selection and implementation remain unchanged: MikroORM uses
  PostgreSQL, PGlite uses the module-test `pgliteModulePersistenceAdapter`, and
  Drizzle uses Node SQLite `:memory:`.
- The global PGlite matrix remains Jest-default. Translation's Jest selector
  invokes the rollback; explicit Vitest selection invokes the package default.
- No adapter, DML model, service, repository, migration, transaction,
  assertion, fixture, expected value, or production composition changed.

Affected boundary:

- Translation's integration default and exact Jest rollback;
- its PGlite runner-to-script mapping;
- the generic fast graph, which excludes the one-file Vitest suite;
- a dedicated runner-neutral, unsharded PostgreSQL job and the stable aggregate
  that now requires it.

Validation:

- fresh pre-cut-over and post-cut-over reports covered all 12
  runner/backend/ownership states across PostgreSQL, PGlite, and
  Drizzle/SQLite;
- every report passed the same one file and 60 tests and normalized to the
  exact same file, full names/statuses, counts, zero-snapshot state, and digest
  `8025698d0223bf2025a09234db22efbb35795bea399ad5f86b2d9b81cf53ea90`;
- both real serial selectors passed all 60 tests after the ownership swap;
- the dedicated job's exact default command passed against isolated PostgreSQL
  18 on `127.0.0.1:55441`;
- package build/unit lanes, strict tooling, full runner foundation, workspace
  policy, frozen install, exact inventory, task graphs, and all Cloudflare
  portability/workerd gates passed.

Accepted boundary:

- Assertion-source and fixture digests remain
  `82c07ea1896c5b10f09616d708b0ecbff5f80645d5404f832c62c199016b4822`
  and `b9fc360f33e2488ac15487b999dee2663fb736178d508e545894b914952a2ee6`.
  The source still owns 60 tests, 104 textual assertions, and zero
  skips/todos/snapshots.
- This proves the unchanged Node module-test runner against three persistence
  backends. The dedicated CI job proves the Vitest default against PostgreSQL
  only; local PGlite/Drizzle/Jest rollback parity is separate acceptance
  evidence.
- Cloudflare validations remain production-graph regressions and do not claim
  this Node integration spec ran inside workerd, D1, or Durable Object SQLite.
- The parsed workflow shape and local command do not establish a hosted Actions
  result. Redis-backed suites, HTTP behavior, other production modules,
  persistence replacement, and deployment behavior remain separate.

## Settings Integration Persistence Parity Under Jest And Vitest

Commit:

- `bc15396832` (`test: add Settings integration Vitest shadow`)

Date verified: 2026-07-30.

Differences from original Medusa:

- The unchanged Settings module-service integration specification now has an
  opt-in Vitest shadow. Jest remains the authoritative integration runner.
- Persistence selection and implementation remain unchanged. MikroORM uses
  real PostgreSQL, PGlite uses the existing module-test
  `pgliteModulePersistenceAdapter` at `memory://`, and Drizzle uses
  `@medusajs/drizzle/medusa-test` with Node SQLite `:memory:`.
- PGlite is not Drizzle, and Drizzle/SQLite is not D1 or workerd. No adapter,
  model, service, repository, migration, transaction, assertion, expected
  value, or production composition changed.

Affected boundary:

- Settings' manual Vitest integration command and exact-file serial profile;
- explicit Settings Vitest selection in the PGlite orchestrator;
- local runner/backend parity evidence only.

Validation:

- pre-edit Jest passed one file and all 11 tests separately on PostgreSQL,
  PGlite, and Drizzle/SQLite;
- post-edit Jest and Vitest each passed the same file and 11 tests on all three
  backends;
- all nine normalized reports preserve every repository-relative file, full
  test name, status, count, and zero-snapshot state at digest
  `1131bec9188e368dec5fd14f0dcf36849957697d7b2b21316fbca10854df5a6b`;
- both real serial PGlite selectors pass all 11 tests, the global matrix stays
  Jest-default, and Store becomes the first unsupported Vitest lane;
- all three authentic Vitest `/3` invocations exit 1 before importing the sole
  file, so this shadow has no sharded CI owner;
- an isolated PostgreSQL 18 cluster on `127.0.0.1:55442` supplied real server
  semantics without reading or changing the machine service configuration.
  It was stopped, the port was verified closed, and its data/log artifacts
  were removed after parity completed;
- Settings build/unit lanes, strict tooling, frozen offline install, exact
  workspace policy and inventory, all task graphs, the 268.8-second foundation,
  and all Cloudflare portability/workerd gates passed.

Accepted boundary:

- The normalized-LF assertion-source digest remains
  `672ffc69ac91c98fc19ab19ccd1490f4f18157a66b8246bb3b71615aed9e9df5`.
  The source still owns 11 async tests, 29 textual assertions, one
  `jest.setTimeout(30000)` bridge call, and zero skips, todos, or snapshots.
- This proves the unchanged Node module-test runner against three persistence
  backends. Cloudflare gates are production-graph regressions; they do not
  claim this Node integration spec ran inside workerd, D1, or Durable Object
  SQLite.
- Default cut-over, dedicated unsharded PostgreSQL ownership, exact Jest
  rollback retention, and hosted execution remain Turn 57 boundaries.
- Redis-backed suites, HTTP behavior, other production modules, persistence
  replacement, and deployment behavior remain outside this proof.

## Settings Integration Vitest Default Persistence Proof

Commit:

- `118ff23c15` (`test: switch Settings integration to Vitest`)

Date verified: 2026-07-30.

Differences from original Medusa:

- The unchanged Settings module-service integration specification now runs
  under Vitest by default, with the exact former Jest command retained as
  `test:integration:jest`.
- Persistence selection and implementation remain unchanged. MikroORM uses
  PostgreSQL, PGlite uses the existing module-test PGlite adapter at
  `memory://`, and Drizzle uses Node SQLite `:memory:`.
- The global PGlite matrix remains Jest-default. Settings' Jest selector
  invokes the rollback; explicit Vitest selection invokes the package default.
- No adapter, DML model, service, repository, migration, transaction,
  assertion, fixture, expected value, or production composition changed.

Affected boundary:

- Settings' integration default and exact Jest rollback;
- its PGlite runner-to-script mapping;
- the generic fast graph, which excludes the one-file Vitest suite;
- a dedicated runner-neutral, unsharded PostgreSQL job and the stable aggregate
  that now requires it.

Validation:

- fresh pre-cut-over and post-cut-over reports covered all 12
  runner/backend/ownership states across PostgreSQL, PGlite, and
  Drizzle/SQLite;
- every report passed the same one file and 11 tests and normalized to the
  exact same file, full names/statuses, counts, zero-snapshot state, and digest
  `1131bec9188e368dec5fd14f0dcf36849957697d7b2b21316fbca10854df5a6b`;
- both real serial selectors passed all 11 tests after the ownership swap;
- the dedicated job's exact default command passed against isolated PostgreSQL
  18 on `127.0.0.1:55443`;
- Store still fails closed for explicit Vitest selection;
- package build/unit lanes, strict tooling, the 295.8-second full foundation,
  workspace policy, frozen install, exact inventory, task graphs, and all
  Cloudflare portability/workerd gates passed;
- the isolated PostgreSQL cluster was stopped, ports `55443` and `8791` were
  verified closed, no scoped Vite/Wrangler/workerd process remained, and all
  temporary cluster/report artifacts were removed.

Accepted boundary:

- The normalized-LF assertion-source digest remains
  `672ffc69ac91c98fc19ab19ccd1490f4f18157a66b8246bb3b71615aed9e9df5`.
  The source still owns 11 async tests, 29 textual assertions, one
  `jest.setTimeout(30000)` compatibility call, and zero skips, todos, or
  snapshots.
- This proves the unchanged Node module-test runner against three distinct
  persistence backends. PGlite is not Drizzle/SQLite, and neither local adapter
  is D1 or Durable Object SQLite.
- The dedicated CI job proves the Vitest default against PostgreSQL only.
  Local PGlite/Drizzle/Jest rollback parity is separate acceptance evidence.
- Cloudflare validations are production-graph regressions and do not claim the
  Settings Node integration specification ran inside workerd, D1, or Durable
  Object SQLite.
- The parsed workflow shape and local command do not establish a hosted
  Actions result. Redis-backed suites, HTTP behavior, other production modules,
  persistence replacement, and deployment behavior remain separate.

## Store Integration Persistence Parity Under Jest And Vitest

Commit:

- `c292d65a57` (`test: add Store integration Vitest shadow`)

Date verified: 2026-07-30.

Differences from original Medusa:

- The unchanged Store module-service integration specification now has an
  opt-in Vitest shadow. Jest remains the authoritative integration runner.
- Persistence selection and implementation remain unchanged. MikroORM uses
  isolated PostgreSQL 18, PGlite uses the existing module-test adapter at
  `memory://`, and Drizzle uses Node SQLite `:memory:`.
- PGlite is not Drizzle/SQLite, and neither adapter is D1 or Durable Object
  SQLite. No adapter, model, service, repository, migration, transaction,
  assertion, fixture, expected value, or production composition changed.

Affected boundary:

- Store's manual Vitest integration command and exact-file serial profile;
- explicit Store Vitest selection in the PGlite orchestrator;
- local runner/backend parity evidence only.

Validation:

- pre-edit Jest passed one file and all 12 tests separately on PostgreSQL,
  PGlite, and Drizzle/SQLite;
- post-edit Jest and Vitest each passed the same one file and 12 tests on all
  three backends;
- all nine normalized reports preserve every repository-relative file, full
  test name, status, count, and zero-snapshot state at digest
  `19726c857ba3909d0e724c0d90e365b22c19378e5fe9d966fdf2313f2a22866b`;
- both real serial PGlite selectors pass all 12 tests, the global matrix stays
  Jest-default, and Auth becomes the first unsupported Vitest lane;
- all three authentic Vitest `/3` invocations exit 1 before importing the sole
  file, so this shadow has no sharded CI owner;
- an isolated PostgreSQL 18 cluster on `127.0.0.1:55444` supplied real server
  semantics without reading or changing the machine service configuration. It
  was stopped, the port was verified closed, and its data/log artifacts were
  removed after parity;
- Store build/unit lanes, strict tooling, frozen offline install, exact
  workspace policy and inventory, all task graphs, the 332.2-second
  foundation, and all Cloudflare portability/workerd gates passed.

Accepted boundary:

- The normalized-LF assertion-source and fixture digests remain
  `0ab033fde113a47dd26cf93144b35622e3e2ef94f01d0a7b5fd72b939ae2088c`
  and
  `759ef4e1e67efe309e30c77aae52bfa0bbd5da94754423cc6a8623a1672553df`.
  The source still owns 12 async tests, 15 textual assertions, one
  `jest.setTimeout(100000)` compatibility call, and zero skips, todos, or
  snapshots.
- This proves the unchanged Node module-test runner against three distinct
  persistence backends. Cloudflare gates are production-graph regressions;
  they do not claim this Node integration spec ran inside workerd, D1, or
  Durable Object SQLite.
- Default cut-over, dedicated unsharded PostgreSQL ownership, exact Jest
  rollback retention, and hosted execution remain Turn 61 boundaries.
- Redis-backed suites, HTTP behavior, other production modules, persistence
  replacement, and deployment behavior remain outside this proof.

## Store Integration Vitest Default Persistence Proof

Commit:

- `57b24eaddd` (`test: switch Store integration to Vitest`)

Date verified: 2026-07-30.

Differences from original Medusa:

- Store's unchanged module-service integration specification now runs under
  Vitest by default, with its exact former Jest command retained at
  `test:integration:jest`.
- Persistence selection and implementation remain unchanged. MikroORM uses
  PostgreSQL, PGlite uses the existing module-test adapter at `memory://`, and
  Drizzle uses Node SQLite `:memory:`.
- The global PGlite matrix remains Jest-default. Store's Jest selector invokes
  the rollback; explicit Vitest selection invokes the package default.
- No adapter, DML model, service, repository, migration, transaction,
  assertion, fixture, expected value, or production composition changed.

Affected boundary:

- Store's integration default and exact Jest rollback;
- its PGlite runner-to-script mapping;
- the generic fast graph, which excludes the one-file Vitest suite;
- a dedicated runner-neutral, unsharded PostgreSQL job and the stable aggregate
  that now requires it.

Validation:

- fresh pre-cut-over and post-cut-over reports covered all 12
  runner/backend/ownership states across PostgreSQL, PGlite, and
  Drizzle/SQLite;
- every report passed the same one file and 12 tests and normalized to the
  exact same file, full names/statuses, counts, zero-snapshot state, and digest
  `19726c857ba3909d0e724c0d90e365b22c19378e5fe9d966fdf2313f2a22866b`;
- both real serial PGlite selectors passed all 12 tests, while Auth remained
  fail-closed for explicit Vitest selection;
- all three `/3` probes rejected before import, and the dedicated job's exact
  default command passed against isolated PostgreSQL 18 on
  `127.0.0.1:55445`;
- Store build/unit lanes, strict tooling, the 360.6-second full foundation,
  frozen install, workspace policy, exact inventory, task graphs, and all
  Cloudflare portability/workerd gates passed;
- the isolated PostgreSQL cluster was stopped, ports `55445` and `8791` were
  verified closed, no scoped runtime process remained, and all temporary
  cluster/report artifacts were removed.

Accepted boundary:

- The normalized-LF assertion-source and fixture digests remain
  `0ab033fde113a47dd26cf93144b35622e3e2ef94f01d0a7b5fd72b939ae2088c`
  and
  `759ef4e1e67efe309e30c77aae52bfa0bbd5da94754423cc6a8623a1672553df`.
  The source still owns 12 async tests, 15 textual assertions, one
  `jest.setTimeout(100000)` compatibility call, and zero skips, todos, or
  snapshots.
- This proves the unchanged Node module-test runner against three distinct
  persistence backends. PGlite is not Drizzle/SQLite, and neither local adapter
  is D1 or Durable Object SQLite.
- The dedicated CI job proves the Vitest default against PostgreSQL only.
  Local PGlite/Drizzle/Jest rollback parity is separate acceptance evidence.
- Cloudflare validations are production-graph regressions and do not claim the
  Store Node integration specification ran inside workerd, D1, or Durable
  Object SQLite.
- The parsed workflow shape and local command do not establish a hosted
  Actions result. Redis-backed suites, HTTP behavior, other production modules,
  persistence replacement, and deployment behavior remain separate.

## Auth Unit Vitest Shadow Persistence Boundary

Commit:

- `e7ff8ccb61` (`test: shadow Auth unit lane with Vitest`)

Date verified: 2026-07-30.

Auth's source-only unit shadow changes no persistence behavior. The package's
three database-backed integration specifications, authoritative integration
Jest command, PGlite routing, MikroORM/PostgreSQL behavior, adapters,
transactions, migrations, models, services, fixtures, and production
composition are unchanged and unclaimed by this proof.

Fresh pre/post Jest and Vitest unit evidence preserves the same one file, one
test, ten assertions, zero skips/todos/snapshots, and digest
`4d55bc4e4dd8e8e6ad3741be3946df33f51a32f8c0f494370284025420f007d8`.
The explicit Auth PGlite Vitest integration selector continues to fail closed
before spawning. Cloudflare portability/workerd gates pass as production-graph
regressions; they do not claim the Auth unit or integration specification ran
against D1 or Durable Object SQLite.

## Auth Unit Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Auth unit lane to Vitest`)

Date verified: 2026-07-30.

Auth's unit default changes to Vitest with exact Jest rollback, but persistence
behavior remains unchanged. The three integration specifications still use the
authoritative Jest command. The global PGlite selector passes all 36 tests on
that unchanged lane, while explicit Vitest integration selection fails closed
before spawning.

No adapter, transaction, migration, model, service, fixture, expected value,
MikroORM/PostgreSQL path, PGlite implementation, Drizzle implementation, or
production composition changed. Cloudflare portability/workerd gates remain
production-graph regressions and do not claim Auth integration parity on D1 or
Durable Object SQLite.

## Auth Integration Vitest Shadow Persistence Proof

Commit:

- This commit (`test: shadow Auth integration lane with Vitest`)

Date verified: 2026-07-31.

Differences from original Medusa:

- Auth's unchanged integration assertions remain Jest-authoritative and gain
  an opt-in Vitest runner.
- The global PGlite matrix remains Jest-default. Explicit Auth Vitest
  selection is now supported, and Region becomes the next fail-closed lane.
- The test-only provider fixture changes from raw TypeScript to one checked
  CommonJS JavaScript implementation so the existing built Medusa loader can
  resolve and dynamically load it under every supported Node engine. Both
  runners use the same fixture path.

Affected boundary:

- Auth integration runner discovery and compatibility only;
- test-only provider fixture module format and explicit invariant narrowing;
- PGlite runner-to-script capability mapping;
- strict test-runner tooling and exact ownership inventory.

Validation:

- pre-edit Jest and post-edit Jest/Vitest each pass the same three files and 36
  tests on isolated MikroORM/PostgreSQL 18, PGlite, and Drizzle/SQLite;
- all six canonical comparisons preserve every full test name/status, zero
  failures/skips/todos/snapshots, and normalized digest
  `f6f80d32667d147070651243e02b4a4e29c037dc86f9fd56a0eb7314e2422eff`;
- both real PGlite selectors pass all 36 tests;
- real Vitest `/3` shards pass 11/5/20 tests and real Jest `/3` shards pass
  20/11/5, with exact three-file/36-test aggregate coverage;
- Auth build and unit default/rollback, strict fixture/config typing, frozen
  install, workspace policy, all seven task graphs, exact inventory, and the
  complete 285.5-second foundation pass;
- Cloudflare typecheck, 30 Vitest tests, production build, import/entrypoint/
  runtime-source audits, generated D1 migrations, Currency D1/workerd,
  Currency and Index Durable Object SQLite, and the full Cart/module-set
  Durable Object proof pass;
- PostgreSQL reported zero remaining test connections; the isolated cluster
  was stopped and removed, and ports 55446/8791/8792/8793/8794 are closed.

Accepted boundary:

- PostgreSQL, PGlite, and Drizzle/SQLite are three distinct Node module-test
  persistence paths. PGlite is not a substitute for canonical PostgreSQL
  semantics, and neither local in-process path is Cloudflare D1 or Durable
  Object SQLite.
- Cloudflare gates are production-graph regressions; they do not claim that
  these Auth Node integration specifications ran inside workerd.
- No persistence adapter, connection/transaction behavior, migration, model,
  service, repository, production module composition, or Cloudflare runtime
  behavior changed.
- Integration default cut-over, exact Jest rollback ownership, and hosted CI
  execution remain Turn 65 boundaries.

## Auth Integration Vitest Default Persistence Proof

Commit:

- This commit (`test: switch Auth integration lane to Vitest`)

Date verified: 2026-07-31.

Differences from original Medusa:

- Auth's unchanged three integration specifications now run under Vitest by
  default.
- The exact former Jest command remains available at
  `test:integration:jest`.
- The PGlite orchestrator routes default Jest selection to the rollback and
  explicit Vitest selection to the package default.

Validation:

- fresh pre-cut-over default-Jest/shadow-Vitest and post-cut-over
  rollback-Jest/default-Vitest reports pass on isolated
  MikroORM/PostgreSQL 18, PGlite, and Drizzle/SQLite;
- all 12 canonical comparisons preserve the same three files, 36 passed
  tests, every full name/status, zero failures/skips/todos/snapshots, and
  normalized digest
  `f6f80d32667d147070651243e02b4a4e29c037dc86f9fd56a0eb7314e2422eff`;
- both real PGlite selectors pass all 36 tests;
- the Vitest default `/3` shards pass 11/5/20 and the Jest rollback shards
  pass 20/11/5, each covering all three files and 36 tests exactly once;
- Auth build and both unit runners, frozen install, workspace policy, strict
  tooling, exact inventory, all seven graphs, and the complete 291.4-second
  foundation pass;
- Cloudflare typecheck, 30 Vitest tests, Vite 8.2.0 build, the 1,593-input
  import guard, portable/real/runtime-source audits, D1 migrations, and the
  Currency/Index/Cart workerd proofs pass.

Accepted boundary:

- PostgreSQL, PGlite, and Drizzle/SQLite remain distinct Node module-test
  persistence paths; none substitutes for another.
- The Cloudflare checks are separate production-graph regressions. They do
  not claim these Auth Node integration specs ran on D1 or Durable Object
  SQLite.
- No adapter, connection or transaction behavior, migration, model, service,
  repository, assertion, fixture, expected value, production composition, or
  Cloudflare runtime behavior changed.
- No hosted GitHub Actions result is claimed. PostgreSQL reached zero scoped
  test connections, the isolated cluster was stopped and removed, and ports
  55447/8791/8792/8793/8794 are closed.

## Region Unit Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Region unit lane with Vitest`)

Date verified: 2026-07-31.

Region's source-only static-manifest specification gains an opt-in Vitest
runner. The source and its ten textual expectation sites are unchanged.
Fresh pre/post Jest and Vitest reports preserve the same one file, one passed
test, zero failures/skips/todos/snapshots, and normalized digest
`ab01db67f70a6857632ed929df6a9a9a72c523052e475f8a4f1274844af59410`.

The unchanged Region integration suite remains Jest-authoritative and passes
one file and 18 tests through the PGlite fast lane. Explicit Region Vitest
integration selection still fails closed before process spawn. This shadow
therefore makes no PostgreSQL, PGlite, Drizzle/SQLite, D1, or Durable Object
integration-parity claim.

No adapter, connection, transaction, migration, model, service, repository,
fixture, expected value, production composition, or Cloudflare runtime
behavior changed. The Cloudflare typecheck, 30 Vitest tests, Vite build,
1,593-input import guard, portable/real/runtime-source audits, D1 migrations,
and Currency/Index/Cart workerd proofs pass only as production-graph
regressions. Ports 8791/8792/8793/8794 are closed. No hosted GitHub Actions
result is claimed.

## Region Unit Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Region unit lane to Vitest`)

Date verified: 2026-07-31.

Region's source-only static-manifest specification now defaults to Vitest with
the exact former Jest command retained at `test:jest`. All four pre/post runner
comparisons preserve one file, one passed test, unchanged full name/status,
zero failures/skips/todos/snapshots, and digest
`ab01db67f70a6857632ed929df6a9a9a72c523052e475f8a4f1274844af59410`.

The unit runner change makes no persistence claim. The unchanged Region
integration suite remains Jest-authoritative and passes one file and 18 tests
through PGlite before and after the cut-over. Explicit Region Vitest
integration selection still fails closed before process spawn.

No adapter, connection, transaction, migration, model, service, repository,
fixture, expected value, production composition, or Cloudflare runtime
behavior changed. Cloudflare typecheck, 30 Vitest tests, Vite 8.2.0 build,
1,593-input import guard, portable/real/runtime-source audits, D1 migrations,
and Currency/Index/Cart workerd proofs pass only as production-graph
regressions. Ports 8791/8792/8793/8794 are closed. No hosted GitHub Actions
result is claimed.

## Region Integration Vitest Shadow Persistence Proof

Commit:

- This commit (`test: shadow Region integration lane with Vitest`)

Date verified: 2026-07-31.

Differences from original Medusa:

- Region's unchanged one-file integration suite gains an opt-in Vitest runner.
- The original Jest integration command remains authoritative.
- The PGlite orchestrator supports both the default Jest selector and explicit
  Vitest selector for Region.

Validation:

- fresh pre-edit Jest, post-edit Jest, and Vitest reports pass on isolated
  MikroORM/PostgreSQL 18, PGlite, and Drizzle/SQLite;
- all nine same-backend runner/time comparisons and three pre-edit
  cross-backend Jest comparisons preserve one file, 18 passed tests, every
  full name/status, zero failures/skips/todos/snapshots, and normalized digest
  `aebfb5091728f37e059beeb845e462cd78f03dd4c9fcaabbb871bfd093a59e13`;
- both real PGlite Region selectors pass all 18 tests, while unsupported RBAC
  Vitest selection fails before process spawn;
- all authentic Vitest `/3` probes fail because one file cannot fill three
  shards, while the retained Jest default aggregates to 18/0/0;
- Region build and both unit runners, frozen install, workspace policy, strict
  tooling, exact inventory, all seven graphs, and the complete 303.2-second
  foundation pass;
- Cloudflare typecheck, 30 Vitest tests, Vite 8.2.0 build, the 1,593-input
  composed import guard, portable/real/runtime-source audits, D1 migrations,
  and Currency/Index/Cart workerd proofs pass.

Accepted boundary:

- PostgreSQL, PGlite, and Drizzle/SQLite remain separate Node module-test
  persistence paths; none substitutes for another.
- The Cloudflare checks are separate production-graph regressions. They do
  not claim that Region integration ran in workerd, D1, or Durable Object
  SQLite.
- No adapter, connection or transaction behavior, migration, model, service,
  repository, assertion, fixture, expected value, production composition, or
  Cloudflare runtime behavior changed.
- No workflow or hosted GitHub Actions result is claimed. The isolated
  PostgreSQL cluster reached zero scoped test connections, was stopped and
  removed, and ports 55448/8791/8792/8793/8794 are closed.

## Region Integration Vitest Default Persistence Proof

Commit:

- This commit (`test: switch Region integration lane to Vitest`)

Date verified: 2026-07-31.

Differences from original Medusa:

- Region's unchanged integration specification now runs under Vitest by
  default.
- The exact former Jest command remains at `test:integration:jest`.
- PGlite routes default Jest selection to the rollback and explicit Vitest
  selection to the package default.
- A dedicated runner-neutral, unsharded PostgreSQL workflow job replaces
  Region's generic fast-shard ownership.

Validation:

- fresh pre/post default and rollback reports pass on isolated
  MikroORM/PostgreSQL 18, PGlite, and Drizzle/SQLite;
- all 12 canonical per-backend comparisons and every pre/post cross-backend
  runner pair preserve one file, 18 passed tests, every full name/status, zero
  failures/skips/todos/snapshots, and normalized digest
  `aebfb5091728f37e059beeb845e462cd78f03dd4c9fcaabbb871bfd093a59e13`;
- both PGlite selectors pass all 18 tests and RBAC remains fail-closed before
  spawn;
- all three Vitest `/3` probes reject the one-file lane, while Jest rollback
  shards aggregate to 18/0/0;
- the direct workflow command passes against isolated PostgreSQL, and the
  parsed typed workflow contract proves service, steps, unsharded ownership,
  runner-neutral naming, and aggregate terminal-state propagation;
- Region build and both unit runners, frozen install, workspace policy, strict
  tooling, exact inventory, all seven graphs, and the complete 322.9-second
  foundation pass;
- all 13 Cloudflare production-graph gates pass in 118.9 seconds.

Accepted boundary:

- PostgreSQL, PGlite, and Drizzle/SQLite remain distinct Node module-test
  persistence paths; none substitutes for another.
- The Cloudflare checks are separate production-graph regressions. They do not
  claim that this Region integration specification ran in workerd, D1, or
  Durable Object SQLite.
- No adapter, connection or transaction behavior, migration, model, service,
  repository, assertion, fixture, expected value, production composition, or
  Cloudflare runtime behavior changed.
- The isolated PostgreSQL cluster reached zero scoped test connections, was
  stopped and removed, and ports 55449/8791/8792/8793/8794 are closed.
- The workflow contract and direct command pass locally; the first hosted
  GitHub Actions result remains deferred.

## RBAC Unit Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow RBAC unit lane with Vitest`)

Date verified: 2026-07-31.

RBAC's source-only static-manifest specification gains an opt-in Vitest
runner. The source, its ten expectation sites, and its zero Jest API/snapshot
state are unchanged. Four canonical reports preserve one file, one passed
test, every full name/status, zero failures/skips/todos/snapshots, and digest
`06a1fff8f4c84d800d3f759bc2997d7f661380675dd92c563a300f26dd4f8a0a`.
Both runners' `/4` matrices cover the file exactly once.

The unchanged RBAC integration suite remains Jest-authoritative. Its PGlite
selector passes six tests with one existing skip before and after
the unit shadow. Explicit RBAC Vitest integration selection remains
unsupported and fails before process spawn. This unit shadow therefore makes
no PostgreSQL, PGlite, Drizzle/SQLite, D1, or Durable Object integration-parity
claim.

No adapter, connection, transaction, migration, model, service, repository,
fixture, expected value, production composition, or Cloudflare runtime
behavior changed. All 13 Cloudflare gates pass only as production-graph
regressions; they do not claim this RBAC Node integration suite ran in workerd.
Ports 8791/8792/8793/8794 are closed. No hosted GitHub Actions result is
claimed.

## RBAC Unit Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch RBAC unit lane to Vitest`)

Date verified: 2026-07-31.

RBAC's unchanged source-only static-manifest specification now defaults to
Vitest and retains its exact Jest rollback. Five reports preserve one file,
one passed test, every full name/status, zero
failures/skips/todos/snapshots, and digest
`06a1fff8f4c84d800d3f759bc2997d7f661380675dd92c563a300f26dd4f8a0a`.
Both runners' `/4` matrices cover the file exactly once.

The database-backed RBAC integration suite remains Jest-authoritative. Its
PGlite selector passes six tests with one existing skip before and after the
unit cut-over, while explicit Vitest selection fails before process spawn.
No adapter, connection, transaction, migration, model, service, repository,
fixture, or expected value changed.

The 13 Cloudflare gates pass as independent production-graph regressions,
including D1 and Durable Object SQLite proofs. They do not claim RBAC's Node
integration specification ran through Vitest, in workerd, or against those
Cloudflare persistence backends. PostgreSQL, PGlite, Drizzle/SQLite, D1, and
Durable Object SQLite remain distinct acceptance lanes. No hosted GitHub
Actions result is claimed.

## RBAC Integration Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow RBAC integration lane with Vitest`)

Date verified: 2026-07-31.

RBAC's unchanged database-backed integration specification now has an opt-in
Vitest shadow while Jest remains authoritative. Fresh pre/post reports prove
the same one file, six passed/one skipped test, names/statuses, zero
failures/todos/snapshots, and normalized digest
`b4454deb8f38de5e2de90ee7d15dcd595e191c25e582753cc3e56662c9553655`
through each distinct Node persistence path:

- MikroORM/PostgreSQL 18 in an isolated temporary cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle/SQLite through the existing RBAC custom repository path.

Both real PGlite selectors pass. The narrow Vitest compatibility bridge
preserves the source's existing `jest.setTimeout`; no assertion or test source
changed. Unsharded discovery lists all six active signatures and execution
reports retain the existing skipped declaration.

The one integration file lands wholly on shard 1 for both runners; shards 2/3
pass only because `--passWithNoTests` is enabled. This is not three-way
coverage and is the reason cutover must add a dedicated unsharded PostgreSQL
job instead of inheriting generic fast sharding.

No adapter, query, connection, transaction, migration, model, service,
repository, fixture, expected value, production composition, or Cloudflare
runtime behavior changed. The 13 Cloudflare gates pass only as independent
production-graph regressions and do not claim this Node integration suite ran
in workerd, D1, or Durable Object SQLite. The isolated PostgreSQL cluster
reached zero scoped connections/databases, was stopped and removed, and ports
55450/8791/8792/8793/8794 are closed. No hosted GitHub Actions result is
claimed.

## RBAC Integration Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch RBAC integration lane to Vitest`)

Date verified: 2026-07-31.

RBAC's unchanged database-backed integration specification now defaults to
Vitest and retains the exact Jest rollback. Fresh pre/post default and rollback
reports prove one file, six passed/one skipped test, every name/status, zero
failures/todos/snapshots, and normalized digest
`b4454deb8f38de5e2de90ee7d15dcd595e191c25e582753cc3e56662c9553655`
through each distinct Node path:

- MikroORM/PostgreSQL 18 in an isolated temporary cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle/SQLite through the existing RBAC custom repository path.

Both PGlite selectors and the exact unsharded workflow command pass. The one
file still lands wholly on shard 1 under `/3`, with shards 2/3 empty. RBAC is
therefore excluded from generic fast sharding and owned by a dedicated
unsharded PostgreSQL workflow job whose service, command, and aggregate
terminal states are locally contract-tested.

No adapter, query, connection, transaction, migration, model, service,
repository, assertion, fixture, expected value, production composition, or
Cloudflare runtime behavior changed. The 13 Cloudflare gates pass only as
independent production-graph regressions and do not claim this Node
integration suite ran in workerd, D1, or Durable Object SQLite.

The isolated PostgreSQL cluster reached zero scoped connections/databases, was
stopped and removed, and ports 55451/8791/8792/8793/8794 are closed. The
workflow contract and exact command pass locally; the first hosted GitHub
Actions result remains deferred.

## User Unit Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow User unit lane with Vitest`)

Date verified: 2026-07-31.

User's unchanged source-only static-manifest specification gains an opt-in
Vitest shadow. It performs no database I/O. All five canonical reports preserve
one passed file/test, exact name/status, zero failures/skips/todos/snapshots,
and digest
`8bafc05bff8d1b2a7107cf1a86564afa3997360751d7272675e0f938ce511ead`.

The database-backed User integration suite remains Jest-authoritative. Its
unchanged PGlite selector passes two files/28 tests before and after the unit
shadow, while explicit Vitest selection fails before process spawn. No
adapter, query, connection, transaction, migration, model, service,
repository, assertion, fixture, or expected value changed.

The 13 Cloudflare commands pass as independent production-graph regressions,
including D1 and Durable Object SQLite proofs. They do not claim User's Node
integration suite ran through Vitest or in workerd. PostgreSQL, PGlite,
Drizzle/SQLite, D1, and Durable Object SQLite remain separate acceptance
lanes. Ports 8791/8792/8793/8794 are closed, and no hosted GitHub Actions
result is claimed.

## User Unit Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch User unit lane to Vitest`)

Date verified: 2026-07-31.

User's unchanged source-only static-manifest specification now defaults to
Vitest with the exact Jest rollback retained. It performs no database I/O.
Fresh pre/post and post-build reports preserve one passed file/test, exact
name/status, zero failures/skips/todos/snapshots, and digest
`8bafc05bff8d1b2a7107cf1a86564afa3997360751d7272675e0f938ce511ead`.

The database-backed User integration suite remains Jest-authoritative. Its
unchanged PGlite selector passes two files/28 tests before and after cut-over,
while explicit Vitest selection still fails before process spawn. No adapter,
query, connection, transaction, migration, model, service, repository,
assertion, fixture, or expected value changed.

The 13 Cloudflare commands pass as independent production-graph regressions,
including D1 and Durable Object SQLite proofs. They do not claim User's Node
integration suite ran through Vitest or in workerd. PostgreSQL, PGlite,
Drizzle/SQLite, D1, and Durable Object SQLite remain distinct acceptance
lanes. Ports 8791/8792/8793/8794 are closed, and no hosted GitHub Actions
result is claimed.

## User Integration Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow User integration lane with Vitest`)

Date verified: 2026-07-31.

User's unchanged database-backed integration suite gains an opt-in Vitest
shadow while Jest remains authoritative. Fresh Jest and Vitest reports
preserve two passed files/28 tests, every name/status, zero
failures/skips/todos/snapshots, and normalized digest
`2c413d71bd1c98f181215ded94940e420e868ac52426e57a487e76af47c6867d`
through each distinct Node path:

- MikroORM/PostgreSQL 18 in an isolated temporary cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle/SQLite through the existing User custom repository path.

Both PGlite selectors pass, and all pre/post same-backend and cross-backend
comparisons are exact. Both runners' `/3` aggregates pass at 14/14/0 tests, so
the later default can remain in generic fast sharding without a dedicated
PostgreSQL workflow job.

No adapter, query, connection, transaction, migration, model, service,
repository, assertion, fixture, expected value, production composition, or
Cloudflare runtime behavior changed. The 13 Cloudflare gates pass only as
independent production-graph regressions and do not claim this Node
integration suite ran in workerd, D1, or Durable Object SQLite. The isolated
PostgreSQL cluster had zero active client connections before it was stopped
and removed. No hosted GitHub Actions result is claimed.

## Customer Source-Unit Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Customer unit lane with Vitest`)

Date verified: 2026-07-31.

Customer's one source-unit file gains an opt-in Vitest shadow while Jest
remains authoritative for both unit and integration execution. Five fresh
reports and all 10 pairwise comparisons preserve its one test and zero
snapshots before and after package build. Jest and Vitest `/4` distributions
are both 1/0/0/0.

The unchanged Customer PGlite integration lane still passes one file/47 tests
through Jest. Explicit Vitest integration selection rejects before process
spawn, so this turn does not claim integration-runner or backend parity for
Vitest.

No adapter, query, connection, transaction, migration, model, service,
repository, integration assertion, fixture, expected value, workflow,
production composition, D1, Durable Object SQLite, or Cloudflare runtime
behavior changed. The 13 Cloudflare gates pass only as independent
production-graph regressions and do not claim this source-unit suite ran in
workerd. PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite
remain distinct acceptance lanes. No hosted GitHub Actions result is claimed.

## Customer Integration Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Customer integration lane with Vitest`)

Date verified: 2026-07-31.

Customer's unchanged database-backed integration suite gains an opt-in Vitest
shadow while Jest remains authoritative. Nine fresh pre/post reports preserve
one passed file/47 tests, every name/status, zero
failures/skips/todos/snapshots, and normalized digest
`6f5d4ea25436106c87939ea69fbf8d217c7189eb8aa89ff7f7bd94a4de1a7c9a`
through each distinct Node path:

- MikroORM/PostgreSQL 18 in an isolated temporary cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle/SQLite through the shared DML compiler and repository adapter.

All 36 report pairs and both real PGlite selectors pass. Both runners'
sharded PGlite aggregates are 47/0/0, so the later default can stay in the
generic fast graph.

No adapter, query, connection, transaction, migration, model, service,
repository, assertion, fixture, expected value, production composition, or
Cloudflare runtime behavior changed. The 13 Cloudflare gates pass only as
independent production-graph regressions and do not claim this Node
integration suite ran in workerd, D1, or Durable Object SQLite.

The isolated PostgreSQL cluster reached zero other client backends before it
stopped and port 55456 closed. PostgreSQL, PGlite, Drizzle/SQLite, D1, and
Durable Object SQLite remain distinct acceptance lanes. No hosted GitHub
Actions result is claimed.

## Customer Integration Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Customer integration lane to Vitest`)

Date verified: 2026-07-31.

Customer's unchanged database-backed integration suite now defaults to Vitest
and retains the exact Jest rollback. Twelve fresh pre/post reports and all 66
pairwise comparisons preserve one passed file/47 tests, every name/status,
zero failures/skips/todos/snapshots, and normalized digest
`6f5d4ea25436106c87939ea69fbf8d217c7189eb8aa89ff7f7bd94a4de1a7c9a`
through:

- MikroORM/PostgreSQL 18 in an isolated temporary cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle/SQLite through the shared DML compiler and repository adapter.

Both real PGlite selectors pass 47/47. Both runners' `/3` distributions remain
47/0/0 with every shard successful, so the Vitest default stays in the generic
fast graph without a dedicated PostgreSQL workflow job.

No adapter, query, connection, transaction, migration, model, service,
repository, assertion, fixture, expected value, production composition, or
Cloudflare runtime behavior changed. The 13 Cloudflare gates pass only as
independent production-graph regressions and do not claim this Node
integration suite ran in workerd, D1, or Durable Object SQLite.

The isolated PostgreSQL cluster reached zero other client backends before it
stopped and port 55457 closed. PostgreSQL, PGlite, Drizzle/SQLite, D1, and
Durable Object SQLite remain distinct acceptance lanes. No hosted GitHub
Actions result is claimed.

## Customer Source-Unit Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Customer unit lane to Vitest`)

Date verified: 2026-07-31.

Customer's one source-unit file now defaults to Vitest with the exact Jest
rollback. Six fresh reports and all 15 pairwise comparisons preserve its one
test and zero snapshots before and after package build. Both runners retain
1/0/0/0 `/4` distribution.

The unchanged Customer PGlite integration lane passes one file/47 tests
through Jest both before and after the unit cut-over. Explicit Vitest
integration selection continues to reject before process spawn, so this turn
does not claim integration-runner or backend parity for Vitest.

No adapter, query, connection, transaction, migration, model, service,
repository, integration assertion, fixture, expected value, workflow,
production composition, D1, Durable Object SQLite, or Cloudflare runtime
behavior changed. The 13 Cloudflare gates pass only as independent
production-graph regressions and do not claim this source-unit suite ran in
workerd. PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite
remain distinct acceptance lanes. No hosted GitHub Actions result is claimed.

## Sales Channel Unit Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Sales Channel unit lane with Vitest`)

Date verified: 2026-07-31.

Sales Channel's unchanged source-only static-manifest specification and
existing noop test gain an opt-in Vitest shadow. They perform no database I/O.
Fresh pre/post and post-build reports preserve two passed files/three tests,
every full name/status, zero failures/skips/todos/snapshots, and digest
`e9f67ef782e472c2ecad05d59fd2c3430a1afa761896ce6316d9261c8c63567c`.

The database-backed Sales Channel integration suite remains
Jest-authoritative. Its unchanged PGlite selector passes one file/14 tests,
while explicit Vitest selection fails before process spawn. No adapter, query,
connection, transaction, migration, model, service, repository, assertion,
fixture, or expected value changed.

The 13 Cloudflare commands pass as independent production-graph regressions,
including D1 and Durable Object SQLite proofs. They do not claim Sales
Channel's Node integration suite ran through Vitest or in workerd. PostgreSQL,
PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain distinct
acceptance lanes. No hosted GitHub Actions result is claimed.

## Sales Channel Unit Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Sales Channel unit lane to Vitest`)

Date verified: 2026-07-31.

Sales Channel's unchanged source-only static-manifest specification and noop
test now default to Vitest with the exact Jest rollback retained. They perform
no database I/O. Fresh pre/post and post-build reports preserve two passed
files/three tests, every full name/status, zero
failures/skips/todos/snapshots, and digest
`e9f67ef782e472c2ecad05d59fd2c3430a1afa761896ce6316d9261c8c63567c`.

The database-backed Sales Channel integration suite remains
Jest-authoritative. Its unchanged PGlite selector passes one file/14 tests
before and after cut-over, while explicit Vitest selection still exits before
process spawn. No adapter, query, connection, transaction, migration, model,
service, repository, assertion, fixture, or expected value changed.

The 13 Cloudflare commands pass as independent production-graph regressions,
including D1 and Durable Object SQLite proofs. They do not claim Sales
Channel's Node integration suite ran through Vitest or in workerd. PostgreSQL,
PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain distinct
acceptance lanes. No hosted GitHub Actions result is claimed.

## Sales Channel Integration Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Sales Channel integration lane with Vitest`)

Date verified: 2026-07-31.

Sales Channel's unchanged database-backed integration suite gains an opt-in
Vitest shadow while Jest remains authoritative. All nine fresh pre/post reports
preserve one passed file/14 tests, every name/status, zero
failures/skips/todos/snapshots, and normalized digest
`2abda1932abcd108e0a006b536978950c2486113c1221477c497c14caa0ed1b2`
through each distinct Node path:

- MikroORM/PostgreSQL 18 in an isolated temporary cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle/SQLite through the shared DML compiler and repository adapter.

All 18 Cartesian pre/post runner/backend comparisons and both PGlite selectors
pass. Customer is the next fail-closed Vitest lane. The one-file Vitest shadow
rejects every `/3` command and therefore has no sharded CI owner.

No adapter, query, connection, transaction, migration, model, service,
repository, assertion, fixture, expected value, production composition, or
Cloudflare runtime behavior changed. The 13 Cloudflare gates pass only as
independent production-graph regressions and do not claim this Node
integration suite ran in workerd, D1, or Durable Object SQLite.

The isolated PostgreSQL cluster reached zero active scoped clients before it
stopped, and its data/log/report paths were removed. PostgreSQL, PGlite,
Drizzle/SQLite, D1, and Durable Object SQLite remain distinct acceptance lanes.
No hosted GitHub Actions result is claimed.

## Sales Channel Integration Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Sales Channel integration lane to Vitest`)

Date verified: 2026-07-31.

Sales Channel's unchanged database-backed integration suite now defaults to
Vitest and retains the exact Jest rollback. Twelve fresh pre/post reports and
all 66 pairwise comparisons preserve one passed file/14 tests, every
name/status, zero failures/skips/todos/snapshots, and normalized digest
`2abda1932abcd108e0a006b536978950c2486113c1221477c497c14caa0ed1b2`
through:

- MikroORM/PostgreSQL 18 in an isolated temporary cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle/SQLite through the shared DML compiler and repository adapter.

Both real PGlite selectors pass 14/14. The one-file default rejects every `/3`
command, so the generic fast job no longer owns it; one unsharded PostgreSQL
workflow job now owns the canonical server-backed run.

No adapter, query, connection, transaction, migration, model, service,
repository, assertion, fixture, expected value, production composition, or
Cloudflare runtime behavior changed. The 13 Cloudflare gates pass only as
independent production-graph regressions and do not claim this Node
integration suite ran in workerd, D1, or Durable Object SQLite.

The isolated PostgreSQL cluster reached zero other client backends before it
stopped, and its data/log/report paths were removed. PostgreSQL, PGlite,
Drizzle/SQLite, D1, and Durable Object SQLite remain distinct acceptance lanes.
No hosted GitHub Actions result is claimed.

## User Integration Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch User integration lane to Vitest`)

Date verified: 2026-07-31.

User's unchanged database-backed integration suite now defaults to Vitest and
retains the exact Jest rollback. Fresh pre/post default and rollback reports
preserve two passed files/28 tests, every name/status, zero
failures/skips/todos/snapshots, and normalized digest
`2c413d71bd1c98f181215ded94940e420e868ac52426e57a487e76af47c6867d`
through each distinct Node path:

- MikroORM/PostgreSQL 18 in an isolated temporary cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle/SQLite through the existing User custom repository path.

Both PGlite selectors and all pre/post same-backend and cross-backend
comparisons pass. Both runners' `/3` aggregates remain 14/14/0 tests, so the
Vitest default stays in generic fast sharding without a dedicated PostgreSQL
workflow job.

No adapter, query, connection, transaction, migration, model, service,
repository, assertion, fixture, expected value, production composition, or
Cloudflare runtime behavior changed. The 13 Cloudflare gates pass only as
independent production-graph regressions and do not claim this Node
integration suite ran in workerd, D1, or Durable Object SQLite. The isolated
PostgreSQL cluster had zero active client connections before it was stopped
and removed. No hosted GitHub Actions result is claimed.

## Analytics Source-Unit Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Analytics unit lane with Vitest`)

Date verified: 2026-07-31.

Analytics gains an opt-in source-unit Vitest shadow while both Jest defaults
remain authoritative. Five fresh pre/post/post-build reports and all 10
pairwise comparisons preserve the one source file/one test, every
name/status, zero failures/skips/todos/snapshots, and normalized digest
`c06d35fca0798b76dab6056cb66022e1e8aae94981e31782dee46bedecaddc4a`.
Both runners retain 1/0/0/0 `/4` distribution.

The database-backed integration suite remains a separate Jest-only boundary.
Its real PGlite selector passes one file/three tests before and after the
source edit, while explicit Vitest selection still fails closed before spawn.
No PostgreSQL or Drizzle execution is claimed for this source-only turn.

No adapter, query, connection, transaction, migration, model, service,
repository, integration assertion, fixture, expected value, production
composition, or Cloudflare runtime behavior changed. The 13 Cloudflare gates
pass only as independent production-graph regressions and do not claim this
source-unit suite ran in workerd. PostgreSQL, PGlite, Drizzle/SQLite, D1, and
Durable Object SQLite remain distinct acceptance lanes. No hosted GitHub
Actions result is claimed.

## Analytics Source-Unit Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Analytics unit lane to Vitest`)

Date verified: 2026-07-31.

Analytics's unchanged source-only specification now defaults to Vitest with
the exact Jest rollback retained. Six fresh pre/post/post-build reports and all
15 pairwise comparisons preserve one file/one test, every name/status, zero
failures/skips/todos/snapshots, and normalized digest
`c06d35fca0798b76dab6056cb66022e1e8aae94981e31782dee46bedecaddc4a`.
Both runners retain 1/0/0/0 `/4` distribution through direct and corrected
root argument boundaries.

The database-backed integration suite remains a separate Jest-only boundary.
Its real PGlite selector passes one file/three tests before and after cut-over,
while explicit Vitest selection still fails closed before spawn. No
PostgreSQL or Drizzle execution is claimed for this source-only turn.

The unit workflow receives only a pnpm/Turbo argument-separator correction; no
integration workflow, persistence adapter, query, connection, transaction,
migration, model, service, repository, assertion, fixture, expected value, or
production composition changes. The 13 Cloudflare gates pass only as
independent production-graph regressions and do not claim this source-unit
suite ran in workerd. PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable
Object SQLite remain distinct acceptance lanes. No hosted GitHub Actions
result is claimed.

## Analytics Integration Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Analytics integration lane with Vitest`)

Date verified: 2026-07-31.

Analytics keeps its database-backed integration default on Jest and adds an
opt-in Vitest shadow. Fresh pre-edit Jest, post-edit Jest, and post-edit
Vitest reports preserve one passed file/three tests, every name/status, zero
failures/skips/todos/snapshots, and normalized digest
`689d13219971cc7e1fca75fdfc4fc4c3d99c2da51814a55ebbc4a5646a95f389`
through each distinct Node path:

- MikroORM/PostgreSQL 18 in an isolated temporary cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle/SQLite through the shared DML compiler and repository adapter.

All 36 report comparisons and both real PGlite selectors pass. Both runners'
PostgreSQL `/3` aggregates remain 3/0/0 tests with empty shards explicitly
allowed, so the shadow needs no dedicated workflow owner.

The built Medusa provider loader cannot path-load the original TypeScript
fixture under native Vitest execution. The single fixture is therefore a
strictly checked CommonJS JavaScript boundary, and the test validates the
native-required module before spying on the exact cached constructor. This is
a test-fixture loader compatibility change only: no persistence adapter,
query, connection, transaction, migration, DML model, module service,
repository, assertion, expected value, or production composition changes.

The 13 Cloudflare gates pass only as independent production-graph regressions
and do not claim this Node integration suite ran in workerd, D1, or Durable
Object SQLite. The isolated PostgreSQL cluster reached zero other client
backends before it was stopped and removed. PostgreSQL, PGlite,
Drizzle/SQLite, D1, and Durable Object SQLite remain distinct acceptance
lanes. No hosted GitHub Actions result is claimed.

## Analytics Integration Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Analytics integration lane to Vitest`)

Date verified: 2026-07-31.

Analytics's unchanged database-backed integration suite now defaults to
Vitest with the exact Jest command retained as rollback. Fresh pre-cut-over
Jest/Vitest and post-cut-over Vitest/Jest reports preserve one passed
file/three tests, every name/status, zero failures/skips/todos/snapshots, and
normalized digest
`689d13219971cc7e1fca75fdfc4fc4c3d99c2da51814a55ebbc4a5646a95f389`
through each distinct Node path:

- MikroORM/PostgreSQL 18 in an isolated temporary cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle/SQLite through the shared DML compiler and repository adapter.

All 66 comparisons and both real PGlite selectors pass. Explicit File/Vitest
selection fails closed before spawn. Default Vitest and rollback Jest retain
the PostgreSQL `/3` aggregate 3/0/0 with all six shard commands successful.

This turn changes runner ownership only. No persistence adapter, query,
connection, transaction, migration, DML model, module service, repository,
assertion, expected value, fixture, or production composition changes. The 13
Cloudflare gates pass as independent production-graph regressions and do not
claim this Node integration suite ran in workerd, D1, or Durable Object
SQLite. PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite
remain distinct acceptance lanes. No hosted GitHub Actions result is claimed.

## File Source-Unit Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow File unit lane with Vitest`)

Date verified: 2026-07-31.

File gains an opt-in source-unit Vitest shadow while both Jest defaults remain
authoritative. Five fresh pre/post/post-build reports and all 10 pairwise
comparisons preserve the two source files/two tests, every name/status, zero
failures/skips/todos/snapshots, and normalized digest
`d13d56d514b40ce97e7e19da791470cdc34f95587b1fe48673d88c99cae9a3cf`.
Both runners retain 1/1/0/0 `/4` distribution.

The database-backed integration suite remains a separate Jest-only boundary.
Its real PGlite selector passes one file/four tests before and after the source
edit, while explicit Vitest selection remains fail-closed before spawn. No
PostgreSQL or Drizzle execution is claimed for this source-only turn.

No adapter, query, connection, transaction, migration, model, service,
repository, integration assertion, fixture, expected value, production
composition, or Cloudflare runtime behavior changed. The final complete
13-command Cloudflare rerun passes only as an independent production-graph
regression and does not claim this source-unit suite ran in workerd.
PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted GitHub Actions result is claimed.

## File Integration Native Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow File integration lane with Vitest`)

Date verified: 2026-07-31.

File keeps its database-backed integration default on Jest and adds a native
Vitest shadow without the legacy Jest bridge. The source-level
`jest.setTimeout` call is removed; Jest CLI and Vitest config own matching
100-second timeout boundaries.

Nine reports prove the unchanged one-file/four-test suite, six expectation
sites, every name/status, zero failures/skips/todos/snapshots, and digest
`976233a8271cf7b030f1f3ad625e4135f120c94331e742793ff0f85d1c1252ee`
through each distinct Node path:

- MikroORM/PostgreSQL 18 in an isolated temporary cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle/SQLite through the shared DML compiler and repository adapter.

All 36 report comparisons and both real PGlite selectors pass. Both runners'
PostgreSQL `/3` aggregates remain 4/0/0 with all six commands successful.
Unsupported Vitest ownership advances to Stock Location.

The built Medusa provider loader cannot resolve the original extensionless
TypeScript fixture under native Vitest. The one fixture is therefore checked
CommonJS JavaScript with an explicit `.js` runtime path and provider-contract
string storage. This is a test-fixture loader compatibility change only: no
persistence adapter, query, connection, transaction, migration, DML model,
module service, repository, assertion, or expected value changes.

The temporary PostgreSQL cluster was stopped after proof. The 13 Cloudflare
gates pass only as independent production-graph regressions and do not claim
this Node suite ran in workerd, D1, or Durable Object SQLite. PostgreSQL,
PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain distinct
acceptance lanes. No hosted GitHub Actions result is claimed.

## File Source-Unit Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch File unit lane to Vitest`)

Date verified: 2026-07-31.

File's source-only unit lane now defaults to Vitest with the exact Jest command
retained as rollback. Six pre/post/post-build reports and all 15 comparisons
preserve two files/two tests, every name/status, zero
failures/skips/todos/snapshots, and normalized digest
`d13d56d514b40ce97e7e19da791470cdc34f95587b1fe48673d88c99cae9a3cf`.
All three default/rollback/scoped-root `/4` aggregates remain 1/1/0/0.

The database-backed integration suite remains a separate Jest-only boundary.
Its real PGlite selector passes one file/four tests before and after cut-over,
while explicit Vitest selection remains fail-closed before spawn. The first
pre-cut-over PGlite attempt hit native process memory exhaustion before
assertions; its unchanged retry and the post-cut-over run both pass 4/4. No
PostgreSQL or Drizzle execution is claimed for this source-unit turn.

No adapter, query, connection, transaction, migration, model, service,
repository, integration assertion, fixture, expected value, or production
composition changes. The complete 13-command Cloudflare set passes only as an
independent production-graph regression and does not claim this source-unit
suite ran in workerd. PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable
Object SQLite remain distinct acceptance lanes. No hosted GitHub Actions
result is claimed.

## File Integration Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch File integration lane to Vitest`)

Date verified: 2026-08-01.

File's unchanged database-backed integration suite now defaults to native
Vitest without the legacy Jest bridge. The exact Jest command remains rollback
at `test:integration:jest`, including its 100-second CLI timeout.

Twelve fresh pre/post reports and all 66 comparisons preserve one file/four
tests, every full name/status, six expectation sites, zero
failures/skips/todos/snapshots, and digest
`976233a8271cf7b030f1f3ad625e4135f120c94331e742793ff0f85d1c1252ee`
through each distinct Node path:

- MikroORM/PostgreSQL 18 in an isolated temporary cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle/SQLite through the shared DML compiler and repository adapter.

Both real PGlite selectors pass 4/4. Default Vitest and rollback Jest retain
the PostgreSQL `/3` aggregate at 4/0/0 with all six commands successful. Stock
Location remains the next fail-closed Vitest integration lane.

This turn changes runner ownership only. No persistence adapter, query,
connection, transaction, migration, DML model, module service, repository,
fixture, assertion, expected value, or production composition changes. The
isolated PostgreSQL cluster was stopped after proof. Early native V8 OOMs
under host commit pressure passed on unchanged retries; the final canonical
foundation and all 13 Cloudflare gates pass.

Cloudflare is an independent production-graph regression and does not claim
this Node suite ran in workerd, D1, or Durable Object SQLite. PostgreSQL,
PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain distinct
acceptance lanes. No hosted GitHub Actions result is claimed.

## Stock Location Source-Unit Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Stock Location unit lane with Vitest`)

Date verified: 2026-08-01.

Stock Location's two unchanged source tests now have an opt-in native Vitest
shadow while Jest remains the source default. Five reports and all 10
comparisons preserve two files/two tests, every name/status, zero
failures/skips/todos/snapshots, and normalized digest
`9a8130aa81ad85e8d365607af15e580125a8dc2c8e44cbb90286bc737625264c`.
Direct Jest, direct Vitest, and scoped-root Jest `/4` aggregates all remain
1/1/0/0.

The database-backed integration suite is deliberately separate and unchanged.
Its real PGlite Jest selector passes one file/eight tests before and after the
source edit, while explicit Vitest integration selection rejects before
process spawn. The integration source still owns its single
`jest.setTimeout(100000)` call; this unit turn neither converts nor bridges it.
No PostgreSQL or Drizzle execution is claimed for this source-only turn.

No adapter, query, connection, transaction, migration, model, service,
repository, integration assertion, fixture, expected value, or production
composition changes. All 13 Cloudflare gates pass only as an independent
production-graph regression and do not claim this Node source suite ran in
workerd. PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite
remain distinct acceptance lanes. No hosted GitHub Actions result is claimed.

## Inventory Source-Unit Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Inventory unit lane with Vitest`)

Date verified: 2026-08-01.

Inventory's unchanged two-file/two-test source suite keeps Jest as its default
and adds one opt-in native Vitest shadow without the legacy bridge. Five
reports and all ten comparisons preserve every test name/status, ten
expectation sites, zero failures/skips/todos/snapshots, and normalized digest
`d8c5611e5df9f41668483147d1eb09c6a48dd918db1a17d3596e5e366617a9ce`.

The database-backed integration suite remains a separate Jest-only boundary.
Its real PGlite selector passes one file/35 tests before and after the source
change, while explicit Vitest integration selection rejects before process
spawn both times. No PostgreSQL or Drizzle execution is claimed for this
source-unit shadow.

No persistence adapter, query, connection, transaction, migration, DML model,
module service, repository, integration assertion, fixture, expected value,
or production composition changes. The complete 349.0-second foundation and
all 13 Cloudflare gates pass. The first local `test:workerd` startup timed out;
ports and scoped processes were clean, and the unchanged command passed on
retry before both final SQLite/workerd proofs passed.

Cloudflare remains an independent production-graph regression and does not
claim this Node source suite ran in workerd, D1, or Durable Object SQLite.
PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted GitHub Actions result is claimed.

## Inventory Source-Unit Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Inventory unit lane to Vitest`)

Date verified: 2026-08-01.

Inventory's unchanged two-file/two-test source suite now defaults to native
Vitest, with the exact previous Jest command retained as rollback. Six reports
and all 15 comparisons preserve every test name/status, ten expectation sites,
zero failures/skips/todos/snapshots, and normalized digest
`d8c5611e5df9f41668483147d1eb09c6a48dd918db1a17d3596e5e366617a9ce`.
Default Vitest, Jest rollback, and root-scoped default `/4` aggregates all
remain 1/1/0/0.

The database-backed integration suite remains a separate Jest-only boundary.
Its real PGlite selector passes one file/35 tests before and after cutover,
while explicit Vitest integration selection rejects before process spawn. The
integration file's `jest.setTimeout` and `jest.spyOn` remain unchanged and are
reserved for the separate integration-shadow turn. No PostgreSQL or Drizzle
execution is claimed for this source-unit cutover.

No persistence adapter, query, connection, transaction, migration, DML model,
module service, repository, integration assertion, fixture, expected value,
or production composition changes. The complete 352.6-second foundation and
the uninterrupted 140.2-second 13-command Cloudflare set pass only as
independent production-graph regressions; they do not claim this Node source
suite ran in workerd, D1, or Durable Object SQLite. PostgreSQL, PGlite,
Drizzle/SQLite, D1, and Durable Object SQLite remain distinct acceptance
lanes. No hosted GitHub Actions result is claimed.

## Stock Location Integration Native Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Stock Location integration lane with Vitest`)

Date verified: 2026-08-01.

Stock Location keeps its database-backed integration default on Jest and adds
a native Vitest shadow without the legacy Jest bridge. The source-level
`jest.setTimeout(100000)` call is removed; Jest CLI and Vitest config own
matching 100-second timeout boundaries.

Nine reports prove the unchanged one-file/eight-test suite, nine expectation
sites, every name/status, zero failures/skips/todos/snapshots, and digest
`9cdd60a75316fb7d555d48e0e3456686eaffee0189273a61df9cad0992bae990`
through each distinct Node path:

- MikroORM/PostgreSQL 18 in an isolated temporary cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle/SQLite through the shared DML compiler and repository adapter.

All 36 report comparisons and both real PGlite selectors pass. Jest's
PostgreSQL `/3` aggregate remains 8/0/0 with all three commands successful.
Native Vitest rejects the one-file `/3` request, so cut-over requires a
dedicated runner-neutral unsharded PostgreSQL job. Unsupported Vitest
ownership advances fail-closed to Inventory.

No persistence adapter, query, connection, transaction, migration, DML model,
module service, repository, fixture, assertion, expected value, or production
composition changes. The temporary PostgreSQL cluster is stopped after proof.
The complete 331.7-second foundation and all 13 Cloudflare gates pass; the
Cloudflare set needed one unchanged `test:workerd` retry after local server
startup timed out.

Cloudflare remains an independent production-graph regression and does not
claim this Node suite ran in workerd, D1, or Durable Object SQLite.
PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted GitHub Actions result is claimed.

## Stock Location Integration Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Stock Location integration lane to Vitest`)

Date verified: 2026-08-01.

Stock Location's unchanged database-backed integration suite now defaults to
native Vitest without the legacy Jest bridge. The exact Jest command remains
rollback at `test:integration:jest`, including its 100-second CLI timeout.

Twelve fresh pre/post reports and all 66 comparisons preserve one file/eight
tests, every full name/status, nine expectation sites, zero
failures/skips/todos/snapshots, and digest
`9cdd60a75316fb7d555d48e0e3456686eaffee0189273a61df9cad0992bae990`
through isolated PostgreSQL 18, PGlite, and Drizzle/SQLite. Both real PGlite
selectors pass 8/8.

The exact unsharded PostgreSQL default command passes 8/8. Stock Location is
absent from generic fast `/3`, absent from slow, owned once in unsharded all,
and owned by one dedicated runner-neutral PostgreSQL workflow job. Inventory
remains the next fail-closed Vitest integration lane.

This turn changes runner and CI ownership only. No persistence adapter, query,
connection, transaction, migration, DML model, module service, repository,
fixture, assertion, expected value, or production composition changes. The
isolated PostgreSQL cluster was stopped after backend proof.

The complete 315.4-second foundation and all 13 Cloudflare gates pass. Two
initial workerd startups timed out under local resource pressure while the
isolated PostgreSQL cluster remained active; the unchanged command passed
after that completed cluster was stopped. Cloudflare remains an independent
production-graph regression and does not claim this Node suite ran in workerd,
D1, or Durable Object SQLite. PostgreSQL, PGlite, Drizzle/SQLite, D1, and
Durable Object SQLite remain distinct acceptance lanes. No hosted GitHub
Actions result is claimed.

## Stock Location Source-Unit Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Stock Location unit lane to Vitest`)

Date verified: 2026-08-01.

Stock Location's unchanged two-file/two-test source lane now defaults to
Vitest, with the exact previous Jest command retained as rollback. Six reports
and all 15 comparisons preserve every name/status, zero
failures/skips/todos/snapshots, and normalized digest
`9a8130aa81ad85e8d365607af15e580125a8dc2c8e44cbb90286bc737625264c`.
Default Vitest, Jest rollback, and scoped-root default `/4` aggregates all
remain 1/1/0/0.

The database-backed integration suite remains a separate Jest-only boundary.
Its real PGlite selector passes one file/eight tests before and after cut-over,
while explicit Vitest integration selection rejects before process spawn. The
integration source still owns `jest.setTimeout(100000)` and is reserved for
the next native integration-shadow turn. No PostgreSQL or Drizzle execution is
claimed for this source-unit cut-over.

No adapter, query, connection, transaction, migration, model, service,
repository, integration assertion, fixture, expected value, or production
composition changes. All 13 Cloudflare gates pass only as an independent
production-graph regression and do not claim this Node source suite ran in
workerd. PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite
remain distinct acceptance lanes. No hosted GitHub Actions result is claimed.

## Inventory Integration Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Inventory integration lane with Vitest`)

Date verified: 2026-08-01.

Inventory's unchanged module-service assertions now run through both the Jest
default and an opt-in native/no-bridge Vitest shadow. Both runners pass one
file/35 tests/zero snapshots on an isolated PostgreSQL 18 cluster, PGlite, and
Drizzle/SQLite. Both real PGlite selectors pass 35/35, and unsupported Vitest
selection advances fail-closed to Tax.

This turn changes runner syntax/configuration only: `jest.spyOn` becomes
`vi.spyOn`, and the 100-second suite timeout moves to each runner's config.
No adapter, query, connection, transaction, migration, model, service,
repository, assertion, expected value, or production composition changes.

Jest `/3` remains 35/0/0. Native Vitest rejects all three `/3` requests because
the suite has one file, so the shadow has no sharded CI owner and cannot become
default until Turn 101 adds a dedicated unsharded PostgreSQL job. Cloudflare's
13 gates pass separately in 202.6 seconds; they do not claim this Node suite
ran in workerd, D1, or Durable Object SQLite. No hosted result is claimed.

## Inventory Integration Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Inventory integration lane to Vitest`)

Date verified: 2026-08-01.

Inventory's unchanged one-file/35-test module-service suite now defaults to
native Vitest with exact Jest rollback. Twelve pre/post reports and 13 targeted
comparisons preserve every name/status and zero snapshots across isolated
PostgreSQL 18, PGlite, and Drizzle/SQLite. Both PGlite selectors pass 35/35,
and the exact unsharded PostgreSQL default passes 35/35.

Inventory leaves generic fast `/3` and gains one dedicated unsharded
PostgreSQL workflow owner. This changes runner and CI ownership only: no
adapter, query, connection, transaction, migration, model, service,
repository, assertion, expected value, or production composition changes.

The complete foundation passes in 451.9 seconds after an unchanged focused
adapter recovery from one transient timeout attempt. All 13 Cloudflare gates
pass separately in 212.9 seconds and do not claim this Node suite ran in
workerd, D1, or Durable Object SQLite. No hosted result is claimed.

## Tax Source-Unit Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Tax unit lane with Vitest`)

Date verified: 2026-08-01.

Tax adds only a source-unit native/no-bridge Vitest shadow. Its two source
tests require no persistence service and preserve exact Jest/Vitest parity at
two files/two tests/zero snapshots before and after the package build.

The database-backed integration suite remains a separate Jest-only boundary.
Its exact two-file/35-test PGlite selector passes unchanged, while explicit
Tax/Vitest integration selection rejects before process spawn. No PostgreSQL
or Drizzle execution is claimed for this source-unit shadow, and no Vitest
integration command, config, adapter selection, or persistence route is added.

No adapter, query, connection, transaction, migration, model, service,
repository, integration assertion, fixture, expected value, or production
composition changes. The complete foundation passes in 461.6 seconds. All 13
Cloudflare gates pass separately in 129.2 seconds and do not claim this Node
source suite ran in workerd, D1, or Durable Object SQLite. PostgreSQL, PGlite,
Drizzle/SQLite, D1, and Durable Object SQLite remain distinct acceptance lanes.
No hosted GitHub Actions result is claimed.

## Tax Source-Unit Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Tax unit lane to Vitest`)

Date verified: 2026-08-01.

Tax's unchanged two-file/two-test source lane now defaults to native Vitest,
with the exact previous Jest command retained as rollback. Six reports and all
15 comparisons preserve every name/status, zero
failures/skips/todos/snapshots, and normalized digest
`91fc1cde13d3187d8162b508ce3350cf7c05aae3fe5c0c81fc5613385c74ffe5`.
Default Vitest, Jest rollback, and scoped-root default `/4` aggregates all
remain 1/1/0/0.

The database-backed integration suite remains a separate Jest-only boundary.
Its real PGlite selector passes two files/35 tests before and after cut-over,
while explicit Vitest integration selection rejects before process spawn. The
two integration files still own `jest.setTimeout(30000)` and are reserved for
the next native integration-shadow turn. No PostgreSQL or Drizzle execution is
claimed for this source-unit cut-over.

No adapter, query, connection, transaction, migration, model, service,
repository, integration assertion, fixture, expected value, or production
composition changes. The complete foundation passes in 535.8 seconds. All 13
Cloudflare gates pass separately in 115.1 seconds and do not claim this Node
source suite ran in workerd, D1, or Durable Object SQLite. PostgreSQL, PGlite,
Drizzle/SQLite, D1, and Durable Object SQLite remain distinct acceptance lanes.
No hosted GitHub Actions result is claimed.

## Tax Integration Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Tax integration lane with Vitest`)

Date verified: 2026-08-01.

Tax's unchanged two-file/35-test integration assertions now run through both
the Jest default and an opt-in native/no-bridge Vitest shadow. Nine reports and
all 36 comparisons preserve every full name/status and zero snapshots across
an isolated PostgreSQL 18 cluster, PGlite, and Drizzle/SQLite. Both real PGlite
selectors pass 35/35, and unsupported Vitest selection advances fail-closed to
Payment.

This turn moves only the two `jest.setTimeout(30000)` declarations into runner
configuration. No adapter, query, connection, transaction, migration, DML
model, module service, repository, fixture, assertion, expected value, or
production composition changes.

Jest `/3` remains 34/1/0 before and after. Native Vitest rejects all three
`/3` requests because the shard count exceeds the two discovered files, so the
shadow remains unowned and requires a dedicated unsharded PostgreSQL job before
cut-over. The isolated cluster had zero scoped databases and zero other client
backends, then stopped with its port closed.

The complete 367.0-second foundation and all 13 Cloudflare gates in 172.8
seconds pass separately. Cloudflare does not claim this Node suite ran in
workerd, D1, or Durable Object SQLite. PostgreSQL, PGlite, Drizzle/SQLite, D1,
and Durable Object SQLite remain distinct acceptance lanes. No hosted result is
claimed.

## Tax Integration Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Tax integration lane to Vitest`)

Date verified: 2026-08-01.

Tax's unchanged two-file/35-test integration suite now defaults to native
Vitest, with the exact prior Jest command retained as rollback. Twelve reports
and all 66 comparisons preserve every full name/status and zero failures,
skips, todos, or snapshots across isolated PostgreSQL 18, PGlite, and
Drizzle/SQLite. Both real PGlite selectors and the exact unsharded PostgreSQL
workflow command pass 35/35.

This turn changes runner and CI ownership only. Tax leaves generic fast `/3`
and gains one dedicated unsharded PostgreSQL workflow owner with aggregate
propagation. No adapter, query, connection, transaction, migration, DML model,
module service, repository, fixture, assertion, expected value, or production
composition changes. The isolated cluster reached zero scoped databases and
zero other client backends, then stopped with its port closed.

The complete 359.8-second foundation and all 13 independent Cloudflare gates
pass. The Currency workerd gate required unchanged local cold-start retries
after its known D1 cleanup warning and then passed in 93.1 seconds; no timeout
or runtime workaround was added. Cloudflare does not claim this Node suite ran
in workerd, D1, or Durable Object SQLite. PostgreSQL, PGlite,
Drizzle/SQLite, D1, and Durable Object SQLite remain distinct acceptance lanes.
No hosted result is claimed.

## Payment Source-Unit Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Payment unit lane with Vitest`)

Date verified: 2026-08-01.

Payment adds only a source-unit native/no-bridge Vitest shadow. Its two source
files require no persistence service and preserve exact Jest/Vitest parity at
two files, three tests, and zero snapshots before and after the package build.

The database-backed integration suite remains a separate Jest-only boundary.
Its real PGlite selector passes two files/36 tests unchanged, while explicit
Payment/Vitest integration selection rejects before process spawn before and
after the source shadow. No PostgreSQL or Drizzle execution is claimed for
this source-unit turn, and no Vitest integration command, config, adapter
selection, or persistence route is added.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, integration assertion, fixture, expected value, or
production composition changes. The complete foundation passes in 494.7
seconds after one unchanged focused recovery from a resource-sensitive PGlite
adapter timeout. All 13 Cloudflare gates pass separately in 234.7 seconds and
do not claim this Node source suite ran in workerd, D1, or Durable Object
SQLite. PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite
remain distinct acceptance lanes. No hosted result is claimed.

## Payment Source-Unit Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Payment unit lane to Vitest`)

Date verified: 2026-08-01.

Payment's unchanged two-file/three-test source lane now defaults to native
Vitest, with the exact prior Jest source command retained as rollback. Six
reports and all 15 comparisons preserve every full name/status, zero
failures/skips/todos/snapshots, and normalized digest
`c6e366aa9379fd5e02aef08add09a1f2aee430fa8b731b55203d501e5ca87c72`.
Default Vitest, Jest rollback, and root-scoped default `/4` aggregates preserve
two files and three tests across all 12 valid commands.

The database-backed integration suite remains a separate Jest-only boundary.
Its real PGlite selector passes two files/36 tests, while explicit Vitest
integration selection rejects before process spawn. No PostgreSQL or Drizzle
execution is claimed for this source-unit cut-over, and no integration config,
adapter selection, or persistence route changes.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, integration assertion, fixture, expected value, or
production composition changes. The complete foundation passes in 448.3
seconds after one unchanged focused recovery from a resource-sensitive
lifecycle hook timeout. All 13 Cloudflare gates pass separately in 198.7
seconds and do not claim this Node source suite ran in workerd, D1, or Durable
Object SQLite. PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object
SQLite remain distinct acceptance lanes. No hosted result is claimed.

## Payment Integration Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Payment integration lane with Vitest`)

Date verified: 2026-08-02.

Payment's two-file/36-test integration assertions now run through both the Jest
default and an opt-in native/no-bridge Vitest shadow. Nine reports and all 36
comparisons preserve every full name/status, 56 direct expectation sites, and
zero snapshots across an isolated PostgreSQL 18 cluster, PGlite, and
Drizzle/SQLite. Both real PGlite selectors pass 36/36, and unsupported Vitest
selection advances fail-closed to Notification.

This turn moves the two source-level 30-second timeout calls into runner
configuration and replaces one `jest.clearAllMocks` plus ten `jest.spyOn`
operations with imported `vi` operations. The Jest default sees only a narrow
package-local shim for those two operations. No adapter, query, connection,
transaction, migration, DML model, module service, repository, fixture,
assertion, expected value, or production composition changes.

Jest `/3` remains 31/5/0 before and after. Native Vitest rejects all three `/3`
requests before test import because the shard count exceeds the two discovered
files, so the shadow remains unowned and requires a dedicated unsharded
PostgreSQL job before cut-over. The isolated cluster created only the two scoped
Payment databases, observed zero other database clients, then stopped with port
55451 closed.

The complete 418.2-second foundation and all 13 Cloudflare gates pass
separately. The Currency workerd proof required an unchanged cold-start retry,
then passed in 65.1 seconds; no timeout or runtime workaround was added.
Cloudflare does not claim this Node suite ran in workerd, D1, or Durable Object
SQLite. PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted result is claimed.

## Payment Integration Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Payment integration lane to Vitest`)

Date verified: 2026-08-02.

Payment's unchanged two-file/36-test integration suite now defaults to native
Vitest, with the exact prior Jest command retained as rollback. Twelve reports
and all 66 comparisons preserve every full name/status, 56 direct expectation
sites, and zero failures/skips/todos/snapshots across isolated PostgreSQL 18,
PGlite, and Drizzle/SQLite. Both real PGlite selectors and the exact unsharded
PostgreSQL workflow command pass 36/36.

This turn changes runner and CI ownership only. Payment leaves generic fast
`/3` and gains one dedicated unsharded PostgreSQL workflow owner with aggregate
propagation. No adapter, query, connection, transaction, migration, DML model,
module service, repository, source, config, fixture, assertion, expected value,
or production composition changes. The isolated cluster contained only the two
scoped Payment databases and `postgres`, observed zero other clients, then
stopped with its port closed.

The complete 463.3-second foundation and all 13 Cloudflare gates pass in 191.8
seconds. Cloudflare does not claim this Node suite ran in workerd, D1, or
Durable Object SQLite. PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable
Object SQLite remain distinct acceptance lanes. The new workflow is locally
contract tested; no hosted result is claimed.

## Notification Source-Unit Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Notification unit lane with Vitest`)

Date verified: 2026-08-20.

Notification's unchanged one-file/one-test source lane now has an opt-in
native/no-bridge Vitest shadow while Jest remains authoritative. Five reports
and all ten comparisons preserve every full name/status, nine direct
expectation sites, zero failures/skips/todos/snapshots, and normalized digest
`a2a70662b003f4f7c15f70105721c4e39dc420f8cd9fd523112120a3e2e40f11`.
Direct Jest, direct Vitest, and authentic root-scoped Jest `/4` aggregates
preserve one file and one test across all 12 valid commands.

The database-backed integration suite remains a separate Jest-only boundary.
Its real PGlite selector passes two files/11 tests, while explicit Vitest
integration selection rejects before process spawn. No PostgreSQL or Drizzle
execution is claimed for this source-unit shadow, and no Vitest integration
command, config, adapter selection, or persistence route is added.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, integration assertion, fixture, expected value, or
production composition changes. The complete foundation passes in 294.7
seconds. All 13 Cloudflare gates pass separately in 236.4 seconds and do not
claim this Node source suite ran in workerd, D1, or Durable Object SQLite.
PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted result is claimed.

## Notification Source-Unit Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Notification unit lane to Vitest`)

Date verified: 2026-08-20.

Notification's unchanged one-file/one-test source lane now defaults to native
Vitest, with the exact prior Jest source command retained as rollback. Six
reports and all 15 comparisons preserve every full name/status, nine direct
expectation sites, zero failures/skips/todos/snapshots, and normalized digest
`a2a70662b003f4f7c15f70105721c4e39dc420f8cd9fd523112120a3e2e40f11`.
Default Vitest, Jest rollback, and root-scoped default `/4` aggregates preserve
one file and one test across all 12 valid commands.

The database-backed integration suite remains a separate Jest-only boundary.
Its real PGlite selector passes two files/11 tests, while explicit Vitest
integration selection rejects before process spawn. No PostgreSQL or Drizzle
execution is claimed for this source-unit cut-over, and no integration config,
adapter selection, or persistence route changes.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, integration assertion, fixture, expected value, or
production composition changes. The complete foundation passes in 261.1
seconds. All 13 Cloudflare gates pass separately in 234.7 seconds and do not
claim this Node source suite ran in workerd, D1, or Durable Object SQLite.
PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted result is claimed.

## Notification Integration Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Notification integration lane with Vitest`)

Date verified: 2026-08-20.

Notification's two-file/11-test integration assertions now run through both the
Jest default and an opt-in native/no-bridge Vitest shadow. Six reports and all
15 pairwise comparisons preserve every full name/status, 32 direct expectation
sites, and zero snapshots across an isolated PostgreSQL 18 cluster, PGlite, and
Drizzle/SQLite. Both real PGlite selectors pass 11/11, and unsupported Vitest
selection advances fail-closed to Fulfillment.

This turn moves the two source-level 30-second timeout calls into runner
configuration and replaces four `jest.spyOn` operations with imported `vi`
operations. The Jest default sees only a narrow package-local shim for that
one operation. The path-loaded provider fixture is checked CommonJS JavaScript
with an explicit `.js` runtime path because the built Medusa loader cannot
consume the original raw TypeScript path under Vitest. No adapter, query,
connection, transaction, migration, DML model, module service, repository,
assertion, expected value, or production composition changes.

Jest `/3` is 7/4/0. Native Vitest rejects all three `/3` requests before test
import because the shard count exceeds the two discovered files, so the shadow
remains unowned and requires a dedicated unsharded PostgreSQL job before
cut-over. The isolated cluster created only the two scoped Notification
databases, observed zero other database clients, then stopped with port 55451
closed.

The complete 244.4-second foundation and all 13 Cloudflare gates pass
separately in 140.4 seconds. `test:workerd` started Vite 8.2.0 in 13.1 seconds
and passed; no timeout or runtime workaround was added. Cloudflare does not
claim this Node suite ran in workerd, D1, or Durable Object SQLite.
PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted result is claimed.

## Notification Integration Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Notification integration lane to Vitest`)

Date verified: 2026-08-20.

Notification's unchanged two-file/11-test integration assertions now default to
native Vitest, with the exact prior Jest command retained as rollback. Twelve
reports and all 66 comparisons preserve every full name/status, 32 direct
expectation sites, and zero snapshots across an isolated PostgreSQL 18 cluster,
PGlite, and Drizzle/SQLite. Both post-cut-over PGlite selectors pass 11/11, the
exact unsharded PostgreSQL workflow command passes 11/11, and unsupported
Vitest selection remains fail-closed at Fulfillment.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, assertion, expected value, fixture, or production
composition changes. Notification leaves generic fast `/3` because native
Vitest cannot consume three shards for two files, and the dedicated PostgreSQL
job remains the Node persistence owner. The isolated cluster created only the
two scoped Notification databases plus `postgres`, observed zero other database
clients, then stopped with port 55451 closed.

The complete 251.3-second foundation and all 13 Cloudflare gates pass
separately in 100.2 seconds. `test:workerd` started Vite 8.2.0 in 13.5 seconds
and passed; no timeout or runtime workaround was added. Cloudflare does not
claim this Node suite ran in workerd, D1, or Durable Object SQLite.
PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted result is claimed.

## Fulfillment Source-Unit Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Fulfillment unit lane with Vitest`)

Date verified: 2026-08-20.

Fulfillment's unchanged two-file/23-test source lane retains Jest as default
and adds an opt-in native/no-bridge Vitest shadow. Five reports and all ten
comparisons preserve every full name/status, 33 direct expectation sites, zero
failures/skips/todos/snapshots, and normalized digest
`2942500312a6eb86a6174e41caf2e9c34f107f3a9aff56162696df14d62991b8`.
Direct Jest, Jest `/4`, and Vitest preserve two files and 23 tests across the
valid commands.

The database-backed integration suite remains a separate Jest-only boundary.
Its real PGlite selector passes seven files/75 tests, while explicit Vitest
integration selection rejects before process spawn. No PostgreSQL or Drizzle
execution is claimed for this source-unit shadow, and no integration config,
adapter selection, or persistence route changes.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, integration assertion, fixture, expected value, or
production composition changes. The complete foundation passes in 253.9
seconds. All 13 Cloudflare gates pass separately in 178.1 seconds and do not
claim this Node source suite ran in workerd, D1, or Durable Object SQLite.
PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted result is claimed.

## Fulfillment Source-Unit Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Fulfillment unit lane to Vitest`)

Date verified: 2026-08-20.

Fulfillment's unchanged two-file/23-test source lane now defaults to native
Vitest, with the exact prior Jest source command retained as rollback. Six
reports and all 15 comparisons preserve every full name/status, 33 direct
expectation sites, zero failures/skips/todos/snapshots, and normalized digest
`2942500312a6eb86a6174e41caf2e9c34f107f3a9aff56162696df14d62991b8`.
Default Vitest, Jest rollback, and root-scoped default `/4` aggregates preserve
two files and 23 tests across all 12 valid commands.

The database-backed integration suite remains a separate Jest-only boundary.
Its real PGlite selector passes seven files/75 tests, while explicit Vitest
integration selection rejects before process spawn. No PostgreSQL or Drizzle
execution is claimed for this source-unit cut-over, and no integration config,
adapter selection, or persistence route changes.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, integration assertion, fixture, expected value, or
production composition changes. The complete foundation passes in 271.2
seconds. All 13 Cloudflare gates pass separately in 107.6 seconds and do not
claim this Node source suite ran in workerd, D1, or Durable Object SQLite.
PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted result is claimed.

## Fulfillment Integration Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Fulfillment integration lane with Vitest`)

Date verified: 2026-08-20.

Fulfillment's unchanged seven-file/75-test integration assertions retain Jest
as default and add an opt-in native/no-bridge Vitest shadow. Six reports and
all 15 comparisons preserve every full name/status, 263 expect() sites, and
zero snapshots across an isolated PostgreSQL 18 cluster, PGlite, and
Drizzle/SQLite. Both PGlite selectors pass 7/75, and unsupported Vitest
selection is now fail-closed at Promotion.

`src/joiner-config.ts` now passes the same 12 DML models already listed in the
Fulfillment static manifest. That matches the models Jest loaded through
filesystem `require()` of `.ts` files and is required for Vitest to emit the
same 12 `Module(...).linkable` keys the existing assertion already checks. No
adapter, query, connection, transaction, migration, DML model shape, module
service, repository, assertion, expected value, or fixture return-value
changes.

The isolated cluster created only the two scoped Fulfillment databases plus
`postgres`, observed one proof-client backend, then stopped with port 55451
closed. The complete 276.0-second foundation and all 13 Cloudflare gates pass
separately in 194.7 seconds. `test:workerd` started Vite 8.2.0 in 17.1 seconds
and passed; no timeout or runtime workaround was added. Cloudflare does not
claim this Node suite ran in workerd, D1, or Durable Object SQLite.
PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted result is claimed.

## Fulfillment Integration Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Fulfillment integration lane to Vitest`)

Date verified: 2026-08-20.

Fulfillment's unchanged seven-file/75-test integration assertions now default
to native Vitest, with the exact prior Jest command retained as rollback.
Twelve reports and all 66 comparisons preserve every full name/status, 263
expect() sites, and zero snapshots across an isolated PostgreSQL 18 cluster,
PGlite, and Drizzle/SQLite. Both post-cut-over PGlite selectors pass 7/75, and
unsupported Vitest selection remains fail-closed at Promotion.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, assertion, expected value, fixture, or production
composition changes. Fulfillment stays in generic fast `/3` because seven
files shard; no dedicated PostgreSQL job is added. The isolated cluster
created only the two scoped Fulfillment databases plus `postgres`, observed
one proof-client backend, then stopped with port 55451 closed.

The complete 260.3-second foundation and all 13 Cloudflare gates pass
separately in 179.3 seconds. `test:workerd` started Vite 8.2.0 in 13.3 seconds
and passed; no timeout or runtime workaround was added. Cloudflare does not
claim this Node suite ran in workerd, D1, or Durable Object SQLite.
PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted result is claimed.

## Promotion Source-Unit Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Promotion unit lane with Vitest`)

Date verified: 2026-08-20.

Promotion's unchanged one-file/one-test source lane retains Jest as default
and adds an opt-in native/no-bridge Vitest shadow. Five reports and all ten
comparisons preserve every full name/status, 5 direct expectation sites, zero
failures/skips/todos/snapshots, and normalized digest
`4c9ba44eacff934d2fa46947f9c9ababb43f6499f6c494c2195ce95765969a10`.
Direct Jest, Jest `/4`, and Vitest preserve one file and one test across the
valid commands.

The database-backed integration suite remains a separate Jest-only boundary.
Its real PGlite selector passes six files/178 tests, while explicit Vitest
integration selection rejects before process spawn. No PostgreSQL or Drizzle
execution is claimed for this source-unit shadow, and no integration config,
adapter selection, or persistence route changes.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, integration assertion, fixture, expected value, or
production composition changes. The complete foundation passes in 260.4
seconds. All 13 Cloudflare gates pass separately in 128.2 seconds and do not
claim this Node source suite ran in workerd, D1, or Durable Object SQLite.
PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted result is claimed.

## Promotion Source-Unit Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Promotion unit lane to Vitest`)

Date verified: 2026-08-20.

Promotion's unchanged one-file/one-test source lane now defaults to native
Vitest, with the exact prior Jest source command retained as rollback. Six
reports and all 15 comparisons preserve every full name/status, 5 direct
expectation sites, zero failures/skips/todos/snapshots, and normalized digest
`4c9ba44eacff934d2fa46947f9c9ababb43f6499f6c494c2195ce95765969a10`.
Default Vitest, Jest rollback, and root-scoped default `/4` aggregates preserve
one file and one test across the valid commands.

The database-backed integration suite remains a separate Jest-only boundary.
Its real PGlite selector passes six files/178 tests, while explicit Vitest
integration selection rejects before process spawn. No PostgreSQL or Drizzle
execution is claimed for this source-unit cut-over, and no integration config,
adapter selection, or persistence route changes.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, integration assertion, fixture, expected value, or
production composition changes. The complete foundation passes in 263.6
seconds. All 13 Cloudflare gates pass separately in 125.1 seconds and do not
claim this Node source suite ran in workerd, D1, or Durable Object SQLite.
PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted result is claimed.

## Promotion Integration Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Promotion integration lane with Vitest`)

Date verified: 2026-08-20.

Promotion's unchanged six-file/178-test integration assertions retain Jest as
default and add an opt-in native/no-bridge Vitest shadow. Six reports and all
15 comparisons preserve every full name/status, 239 expect() sites, and zero
snapshots across an isolated PostgreSQL 18 cluster, PGlite, and
Drizzle/SQLite. Both PGlite selectors pass 6/178, and unsupported Vitest
selection is now fail-closed at Product.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, assertion, expected value, or fixture return-value
changes.

The isolated cluster created only the two scoped Promotion databases plus
`postgres`, observed one proof-client backend, then stopped with port 55451
closed. The complete 274.2-second foundation and all 13 Cloudflare gates pass
separately in 193.8 seconds. `test:workerd` started Vite 8.2.0 in 14.6
seconds and passed; no timeout or runtime workaround was added. Cloudflare does
not claim this Node suite ran in workerd, D1, or Durable Object SQLite.
PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted result is claimed.

## Promotion Integration Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Promotion integration lane to Vitest`)

Date verified: 2026-08-20.

Promotion's unchanged six-file/178-test integration assertions now default
to native Vitest, with the exact prior Jest command retained as rollback.
Twelve reports and all 66 comparisons preserve every full name/status, 239
expect() sites, and zero snapshots across an isolated PostgreSQL 18 cluster,
PGlite, and Drizzle/SQLite. Both post-cut-over PGlite selectors pass 6/178, and
unsupported Vitest selection remains fail-closed at Product.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, assertion, expected value, fixture, or production
composition changes. Promotion stays in generic fast `/3` because six files
shard; no dedicated PostgreSQL job is added. The isolated cluster created
only the two scoped Promotion databases plus `postgres`, observed one
proof-client backend, then stopped with port 55451 closed.

The complete 262.7-second foundation and all 13 Cloudflare gates pass
separately in 135.1 seconds. `test:workerd` started Vite 8.2.0 in 14.4 seconds
and passed; no timeout or runtime workaround was added. Cloudflare does not
claim this Node suite ran in workerd, D1, or Durable Object SQLite.
PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted result is claimed.

## Product Source-Unit Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Product unit lane with Vitest`)

Date verified: 2026-08-20.

Product's unchanged two-file/four-test source lane retains Jest as default
and adds an opt-in native/no-bridge Vitest shadow. Five reports and all ten
comparisons preserve every full name/status, 23 direct expectation sites, zero
failures/skips/todos/snapshots, and normalized digest
`5405f6cc036555864b376b686a66e2367641eb780a086caeae6558691e241866`.
Direct Jest and Vitest preserve two files and four tests across the valid
commands.

The database-backed integration suite remains a separate Jest-only boundary.
Its real PGlite selector passes ten files with 205 passed tests and 1 skipped,
while explicit Vitest integration selection rejects before process spawn. No
PostgreSQL or Drizzle execution is claimed for this source-unit shadow, and no
integration config, adapter selection, or persistence route changes.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, integration assertion, fixture, expected value, or
production composition changes. The complete foundation passes in 262.3
seconds. All 13 Cloudflare gates pass separately in 94.8 seconds and do not
claim this Node source suite ran in workerd, D1, or Durable Object SQLite.
PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted result is claimed.

## Product Source-Unit Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Product unit lane to Vitest`)

Date verified: 2026-08-20.

Product's unchanged two-file/four-test source lane now defaults to native
Vitest, with the exact prior Jest source command retained as rollback. Six
reports and all 15 comparisons preserve every full name/status, 23 direct
expectation sites, zero failures/skips/todos/snapshots, and normalized digest
`5405f6cc036555864b376b686a66e2367641eb780a086caeae6558691e241866`.
Default Vitest, Jest rollback, and `/4` aggregates preserve two files and four
tests across the valid commands.

The database-backed integration suite remains a separate Jest-only boundary.
Explicit Vitest integration selection rejects before process spawn. No
PostgreSQL or Drizzle execution is claimed for this source-unit cut-over, and
no integration config, adapter selection, or persistence route changes.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, integration assertion, fixture, expected value, or
production composition changes. The complete foundation passes in 262.0
seconds. All 13 Cloudflare gates pass separately in 94.0 seconds and do not
claim this Node source suite ran in workerd, D1, or Durable Object SQLite.
PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite remain
distinct acceptance lanes. No hosted result is claimed.

## Product Integration Vitest Shadow Persistence Blocker

Date verified: 2026-08-20.

Turn 124 could not freeze a three-backend Product integration Jest baseline on
the isolated PostgreSQL 18 cluster used by prior module turns. The unchanged
Jest `test:integration` command passed PGlite and Drizzle/SQLite at 10 files,
205 passed, and 1 skipped. Isolated PostgreSQL 18 failed in
`product-category.spec.ts` when `include_descendants_tree` is true: descendant
`category_children` came back empty, and later mpath assertions hit
uninitialized MikroORM `Collection<Product>` on category entities. `--bail`
stopped after 15 failed and 50 passed tests in that file.

## Product Integration PostgreSQL Baseline Unblock

Date verified: 2026-08-21.

Isolated PostgreSQL 18, PGlite, and Drizzle/SQLite each now pass the Product
integration Jest suite at 10 files / 205 passed / 1 skipped after fork fixes
in `@medusajs/product`:

- Category tree hydration no longer invents `fields: []` in
  `ProductCategoryRepository.buildFindOptions`, prefers full tree-scoped
  scalars over field-limited MikroORM identity-map rows, uses
  `disableIdentityMap` for the tree reload, and unwraps MikroORM Collections
  when projecting selected relations.
- MikroORM category hard-delete now registers and awaits mutation events
  through `modulePersistenceAdapter` so `product.product-category.deleted`
  emits on PostgreSQL.
- Category create maps `products: [{ id }]` through `manager.getReference`
  so linked products are not treated as incomplete inserts.

No Product integration Vitest shadow was added in this unblock slice. Turn 124
may proceed with an opt-in shadow while Jest remains authoritative.

## Product Integration Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Product integration lane with Vitest`)

Date verified: 2026-08-22.

Product's unchanged ten-file/206-test (205 passed, 1 skipped) integration
assertions retain Jest as default and add an opt-in native/no-bridge Vitest
shadow. The shadow preserves every full name/status across three persistence
backends with identical counts:

- isolated PostgreSQL 18 cluster on 127.0.0.1:55599 (trust auth, UTF8), 10
  files / 205 passed / 1 skipped in 267.91s;
- PGlite through `pnpm test:integration:pglite`, same counts in 153.45s, with
  the Jest lane matching at 62.86s;
- Drizzle/SQLite through `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`, same
  counts in 40.34s.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, assertion, expected value, or fixture return-value
changes. The Jest rollback keeps byte-identical sources through a package-local
`vitest-jest-shim` fixture mapped by the package Jest config only.

The temporary PostgreSQL cluster was created under the OS temp directory,
stopped with `pg_ctl stop -m fast`, and port 55599 confirmed closed; the
machine's existing PostgreSQL service configuration was not touched. Frozen
offline install, Cloudflare gates, and sharding distribution were not rerun in
this slice and remain cut-over-turn requirements. PostgreSQL, PGlite,
Drizzle/SQLite, D1, and Durable Object SQLite remain distinct acceptance
lanes. No hosted result is claimed.

## Product Integration Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Product integration lane to Vitest`)

Date verified: 2026-08-22.

Product integration defaults to the native/no-bridge Vitest config with the
byte-identical Jest command retained at `test:integration:jest`. The
unchanged ten-file/206-test (205 passed, 1 skipped) assertions keep their
Turn 124 three-backend parity; this slice adds fresh post-cut-over PGlite
proof for both selectors:

- default Vitest selection (`test:integration`): 10 files / 205 passed /
  1 skipped in 59.53s;
- Jest rollback selection (`test:integration:jest`): identical counts in
  58.22s;
- authentic Vitest `/3` shards under `--maxWorkers=2` with
  `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`: 4/3/3 files,
  75/(68+1 skipped)/62 tests, every test covered exactly once.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, assertion, expected value, or fixture return-value
changes between shadow and default; PostgreSQL and Drizzle behavior is carried
by the byte-identical Turn 124 shadow reports. Frozen offline install and the
complete Cloudflare gate set pass separately. PostgreSQL, PGlite,
Drizzle/SQLite, D1, and Durable Object SQLite remain distinct acceptance
lanes. No hosted result is claimed.

## Pricing Integration Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Pricing integration lane with Vitest`)

Date verified: 2026-08-22.

Pricing's unchanged six-file/126-test integration assertions retain Jest as
default and add an opt-in native/no-bridge Vitest shadow. The shadow preserves
every full name/status across three persistence backends with identical
counts:

- isolated PostgreSQL 18 cluster on 127.0.0.1:55601 (trust auth, UTF8), 6
  files / 126 passed in 63.67s;
- PGlite through `pnpm test:integration:pglite`, same counts in 28.82s, with
  the Jest lane matching at 27.89s;
- Drizzle/SQLite through `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`, same
  counts in 17.45s.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, assertion, expected value, or fixture return-value
changes. The Jest rollback keeps byte-identical sources through a package-local
`vitest-jest-shim` fixture mapped by the package Jest config only.

The temporary PostgreSQL cluster was created under the OS temp directory,
stopped with `pg_ctl stop -m fast`, and port 55601 confirmed closed; the
machine's existing PostgreSQL service configuration was not touched. Frozen
offline install, Cloudflare gates, and sharding distribution were not rerun in
this slice and remain cut-over-turn requirements. PostgreSQL, PGlite,
Drizzle/SQLite, D1, and Durable Object SQLite remain distinct acceptance
lanes. No hosted result is claimed.

## Pricing Integration Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Pricing integration lane to Vitest`)

Date verified: 2026-08-22.

Pricing integration defaults to the native/no-bridge Vitest config with the
byte-identical Jest command retained at `test:integration:jest`. The
unchanged six-file/126-test assertions keep their Turn 126 three-backend
parity; this slice adds fresh post-cut-over PGlite proof for both selectors:

- default Vitest selection (`test:integration`): 6 files / 126 passed in
  35.34s;
- Jest rollback selection (`test:integration:jest`): identical counts;
- authentic Vitest `/3` shards under `--maxWorkers=2` with
  `MEDUSA_MODULE_TEST_PERSISTENCE=pglite`: 2/2/2 files, 29/27/70 tests,
  every test covered exactly once.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, assertion, expected value, or fixture return-value
changes between shadow and default; PostgreSQL and Drizzle behavior is carried
by the byte-identical Turn 126 shadow reports. Frozen offline install and the
complete Cloudflare gate set pass separately. PostgreSQL, PGlite,
Drizzle/SQLite, D1, and Durable Object SQLite remain distinct acceptance
lanes. No hosted result is claimed.

## Cart Integration Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Cart integration lane with Vitest`)

Date verified: 2026-08-22.

Cart's unchanged one-file/63-test integration assertions retain Jest as
default and add an opt-in native/no-bridge Vitest shadow. The shadow preserves
every full name/status across three persistence backends with identical
counts:

- isolated PostgreSQL 18 cluster on 127.0.0.1:55602 (trust auth, UTF8), 1
  file / 63 passed in 23.49s;
- PGlite through `pnpm test:integration:pglite`, same counts, with the Jest
  lane matching;
- Drizzle/SQLite through `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`, same
  counts in 4.49s.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, assertion, expected value, or fixture return-value
changes. The single source-level `jest.setTimeout` call moves to the runner
CLIs; no `vi` shim is required because the suite uses no spy or mock APIs.

The temporary PostgreSQL cluster was created under the OS temp directory,
stopped with `pg_ctl stop -m fast`, and port 55602 confirmed closed; the
machine's existing PostgreSQL service configuration was not touched. Frozen
offline install, Cloudflare gates, and sharding distribution were not rerun in
this slice and remain cut-over-turn requirements. PostgreSQL, PGlite,
Drizzle/SQLite, D1, and Durable Object SQLite remain distinct acceptance
lanes. No hosted result is claimed.

## Cart Integration Vitest Default Persistence Boundary

Commit:

- This commit (`test: switch Cart integration lane to Vitest`)

Date verified: 2026-08-22.

Cart integration defaults to the native/no-bridge Vitest config with the
byte-identical Jest command retained at `test:integration:jest`. The
unchanged one-file/63-test assertions keep their Turn 128 three-backend
parity; this slice adds fresh post-cut-over PGlite proof for both selectors:

- default Vitest selection (`test:integration`): 1 file / 63 passed;
- Jest rollback selection (`test:integration:jest`): identical counts.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, assertion, expected value, or fixture return-value
changes between shadow and default; PostgreSQL and Drizzle behavior is carried
by the byte-identical Turn 128 shadow reports. Frozen offline install and the
complete Cloudflare gate set pass separately. The one-file lane fails closed
under `/3` sharding, matching Currency precedent. PostgreSQL, PGlite,
Drizzle/SQLite, D1, and Durable Object SQLite remain distinct acceptance
lanes. No hosted result is claimed.

## Order Integration Vitest Shadow Persistence Boundary

Commit:

- This commit (`test: shadow Order integration lane with Vitest`)

Date verified: 2026-08-22.

Order integration retains Jest as default and adds an opt-in native/no-bridge
Vitest shadow. Runner parity is exact on every backend:

- PGlite through `pnpm test:integration:pglite`: 9 files / 77 passed for both
  runners;
- Drizzle/SQLite through `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`: 9 files /
  77 passed in 31.08s;
- isolated PostgreSQL 18 on 127.0.0.1:55603 (trust auth, UTF8): both runners
  fail identically at 74 passed / 3 failed.

No adapter, query, connection, transaction, migration, DML model, module
service, repository, assertion, expected value, or fixture return-value
changes in this slice; the eight source-level `jest.setTimeout` calls move to
the runner CLIs, and no `vi` shim is required.

The three PostgreSQL failures are pre-existing MikroORM-PostgreSQL behavior,
not a runner difference: claim and exchange flows report
"OrderShippingMethod ... was not found" after creation, and the return flow
observes one extra joined row (length 2 expected, 3 received). The fork's
PGlite and Drizzle persistence adapters pass all 77 tests, isolating the gap
to the original ORM path. Fixing it is recorded as its own slice and a hard
prerequisite before Order cut-over, with the unchanged Medusa assertions as
the specification. The temporary cluster was stopped with port confirmed
closed. PostgreSQL, PGlite, Drizzle/SQLite, D1, and Durable Object SQLite
remain distinct acceptance lanes. No hosted result is claimed.

## Order PostgreSQL Shipping Method Persistence Fix

Commit:

- This commit (`fix(order): create claim and exchange shipping methods explicitly`)

Date verified: 2026-08-22.

`createOrderShippingMethodsBulk_` now creates the underlying shipping method
and the versioned order-shipping join row as two explicit queued creates.
Previously the nested new method was never scheduled on the entity manager
(no persist cascade on the relation), so it was invisible to reads inside the
same transaction and only appeared at outer-commit flush; claim and exchange
creation failed with "OrderShippingMethod ... was not found" on
PostgreSQL/MikroORM while PGlite and Drizzle passed.

After the fix, on isolated PostgreSQL 18 (127.0.0.1:55604, stopped with port
confirmed closed): Vitest 74/77 and Jest identically; PGlite and Drizzle/SQLite
remain 77/77 for both runners. No adapter, query, migration, DML model,
assertion, or expected-value changes.

Remaining diagnosed-but-unfixed PostgreSQL gaps (identical for both runners):
claim/exchange responses miss the hydrated `return` because updating
`order_claim.return_id` through the internal service after creation does not
persist (the FKs are circular and upstream relied on deferred commit-time
flush ordering), and the return-cancel flow leaves one extra shipping-method
row visible at the current version. A global `flushMode: "always"` setting was
tested and reverted (no effect on these failures). These are recorded as the
next persistence slice before any Order runner promotion. No hosted result is
claimed.
