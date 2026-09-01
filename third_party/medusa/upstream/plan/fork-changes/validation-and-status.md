# Validation And Current Status

## Verified Behavior

The following validation has passed after the current refactors:

- Full repository Yarn install.
- Immutable Yarn install.
- `@medusajs/test-utils` build.
- `@medusajs/test-utils` tests: 21 passing.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  unchanged assertions.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing,
  unchanged assertions.
- Currency package build and direct type-check.
- Medusa package build and direct type-check.
- Cloudflare application type-check.
- Cloudflare application tests: 2 passing.
- Actual Currency workerd/D1 runtime check: passing.
- Composed Currency Worker import guard: 216 bundled inputs accepted.
- Cloudflare production Worker build: 385.69 kB, without `nodejs_compat`.
- Real Currency service audit: 66 bundled inputs and 0 Worker blockers.
- Real Currency strict service import guard: passing.
- Focused utils module-sdk suites: 27 passing.
- Full modules-sdk suite: 75 passing.
- DML entity-builder suite: 69 passing.

Currency and test-utils integration tests require PostgreSQL. Local verification
used an isolated temporary PostgreSQL cluster so the machine's existing
PostgreSQL configuration was not modified.

## Completed Acceptance Gate

The first migration milestone is complete:

- Unchanged Currency assertions pass through MikroORM/Postgres.
- Unchanged Currency assertions pass through Drizzle/SQLite.
- The actual Currency service runs through Drizzle/D1 inside workerd.
- The composed Worker graph contains no Node or MikroORM blockers.

## Shared Static Module Bootstrap

Commit:

- `0ea9e4dde5 refactor: add shared static module bootstrap`

The Cloudflare Currency runtime now uses shared Medusa module composition from
`staticModuleLoader`. The existing Node `moduleLoader` remains the wrapper that
selects filesystem discovery, dynamic import, and MikroORM defaults.

Validation performed for this milestone:

- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated temporary PostgreSQL cluster.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Full `@medusajs/modules-sdk` suite: 75 passing.
- Cloudflare app type-check and 2 tests pass.
- Actual Currency module runs inside workerd/D1.
- Composed Worker guard: 203 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.

## Actual Currency Service Through Durable Object SQLite

Commit:

- `ba74b53d24 feat: run Currency service in Durable Object`

The disposable DO proof now runs the actual `CurrencyModuleService` through
the shared static Medusa module bootstrap and atomic DO SQLite manager. Direct
repository construction was removed from the app proof.

The real workerd check passes service-level create/list/delete, transaction
context propagation, nested callbacks, read-your-own-writes, and multi-write
rollback. The next persistence slice can audit Cart's unchanged module suite
and implement only the first Drizzle behavior that blocks it.

Validation performed:

- `@medusajs/drizzle` build and 26 tests passed.
- `@medusajs/drizzle-cloudflare` build passed.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing
  unchanged assertions.
- Actual Currency module service DO SQLite workerd proof passed.
- Existing Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 229 transformed modules, 445.23 kB.
- Composed Worker guard: 333 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- Affected package builds and `git diff --check` pass.

## Current Next Step

Finish the Currency migration boundary before selecting a second module:

- Implement Drizzle soft delete and restore semantics and validate them through
  the existing generated Medusa service.
- Decide and implement supported atomic boundaries for multi-statement D1
  operations. D1 statement mode is explicit but is not equivalent to Medusa's
  callback transaction semantics.
- Add schema-diff migration generation and target-specific Drizzle migration
  runners before supporting deployed database upgrades.

## Currency Through MedusaModule

Commit:

- `ed17630e14 refactor: bootstrap static modules through MedusaModule`

Validation performed:

- Full `@medusajs/modules-sdk` suite: 75 passing.
- Currency package tests, including static-manifest drift coverage: 2 passing.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Cloudflare app type-check and 2 tests pass.
- Actual Currency module runs through `MedusaModule` inside workerd/D1.
- Production Worker build: 214 transformed modules, 363.60 kB.
- Composed Worker guard: 208 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- Affected package builds and `git diff --check` pass.

## Runtime-Reused Currency Static Manifest Metadata

Commit:

- `fa0d7413c7 refactor: reuse portable Medusa joiner config`

Validation performed:

- Focused joiner-config suite: 12 passing, including portable/Node equivalence.
- Full `@medusajs/modules-sdk` suite: 75 passing.
- Currency package build and 2 package tests pass.
- Customer's original implicit filesystem joiner discovery produces its schema
  and 4 aliases.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated temporary PostgreSQL cluster.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Cloudflare app type-check and 2 tests pass.
- Actual Currency module runs through `MedusaModule` inside workerd/D1.
- Production Worker build: 222 transformed modules, 385.69 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passes.

## Adapter-Driven Module Migrations

Commit:

- `b7f8ead739 refactor: make module migrations adapter-driven`

Validation performed:

- Affected shared packages and Currency build pass.
- Full modules-sdk suite: 76 passing.
- Drizzle package tests: 5 passing.
- Currency package contains its Drizzle SQLite baseline in `dist/migrations`.
- Generated migration drift check and fresh Wrangler local D1 migration test
  pass.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated temporary PostgreSQL cluster.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Actual Currency workerd/D1 runtime, both import guards, and production Worker
  build pass.

Current support is intentionally asymmetric: MikroORM/Postgres has a complete
Medusa migration runner; Drizzle has SQLite baseline generation plus D1
application aggregation, but not schema diffs, a generic SQLite runner, or
Drizzle Postgres support.

## Adapter-Driven Mutation Events And D1 Delete

Commit:

- `3d28423c76 refactor: make mutation event dispatch adapter-driven`

Validation performed:

- Focused shared Medusa internal-service and service tests: 34 passing.
- Full modules-sdk suite: 76 passing.
- Drizzle package tests: 5 passing.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated temporary PostgreSQL cluster.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Actual Currency read/create/update/delete runs through `MedusaModule` inside
  workerd/D1.
- Cloudflare app type-check and 2 tests pass.
- Production Worker build: 222 transformed modules, 388.67 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passes.

## D1 Mutation And Transaction Semantics

Commit:

- `c3a0cc5052 feat: validate D1 mutations and transaction semantics`

Validation performed:

- Drizzle package build and tests: 4 passing, including atomic rollback,
  commit, and nested-savepoint rollback.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated temporary PostgreSQL cluster.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Actual Currency read/create/update runs through `MedusaModule` in workerd/D1.
- D1 composition reports its non-atomic `statement` transaction mode.
- Cloudflare app type-check and 2 tests pass.
- Production Worker build: 222 transformed modules, 387.47 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passes.

The temporary generated metadata artifact and generator were removed.
Currency now reuses the original module definition and Medusa's real DML
joiner-config derivation at Worker runtime. Explicit resource imports remain
module-owned so the Worker import graph stays deterministic and auditable.

## Generated Currency D1 Baseline

Commit:

- `aa62992840 feat: generate D1 migrations from Medusa DML`

Validation performed:

- Drizzle package build and tests: 3 passing.
- Generated migration drift check and fresh Wrangler local D1 migration test
  pass.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated temporary PostgreSQL cluster.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Cloudflare app type-check and 2 tests pass.
- Actual Currency module runs through `MedusaModule` inside workerd/D1.
- Production Worker build: 222 transformed modules, 385.69 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passes.

The obsolete parallel portable Currency service was removed in
`8a3a0528dc refactor: remove parallel portable currency service`.

Validation after removal:

- Clean affected package builds passed.
- Cloudflare application type-check, production build, and 2 tests passed.
- Actual Currency workerd/D1 runtime check passed.
- Unchanged Currency assertions passed 13/13 through both Drizzle/SQLite and
  MikroORM/Postgres.
- Composed Worker guard passed with 197 inputs.
- Real Currency service audit passed with 66 inputs and zero blockers.

## Product Category And Variant Through Drizzle

Commits:

- `c69760d509 feat: advance Product module Drizzle support`
- `23b80c5f43 test: make more Product suites Drizzle-ready`
- `2ec26fd934 test: make Product category fixtures Drizzle-ready`

Validation performed:

- Product package build passed.
- Drizzle package build passed.
- Drizzle package tests: 36 passing.
- Focused container-loader adapter test: 3 passing.
- `product-category.spec.ts` passes through
  `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`.
- `product-module-service/product-variants.spec.ts` passes through
  `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`.
- `product-module-service/product-types.spec.ts` passes through
  `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`.
- `product-module-service/product-tags.spec.ts` passes through
  `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`.
- `product-module-service/product-collections.spec.ts` passes through
  `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`.
- `product-module-service/product-options.spec.ts` passes through
  `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`.
- `product-module-service/product-categories.spec.ts` passes through
  `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`.
- `git diff --check` passes.

The Product integration command still exits non-zero because several suites
request `MikroOrmWrapper` during setup before their assertions run. This is the
current Product migration blocker and should be fixed by moving those fixtures
to backend-neutral setup through module service APIs or the shared test
database abstraction.

Current next Product step:

- Convert the remaining setup-only Product blockers away from
  `MikroOrmWrapper`, starting with the top-level `product.spec.ts` or
  `product-module-service/products.spec.ts`, while keeping their original
  assertions unchanged.

## Drizzle Soft Delete And Restore

Commit:

- `60111e27db feat: add Drizzle soft delete and restore`

Validation performed:

- Drizzle package build and tests: 6 passing.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated temporary PostgreSQL cluster.
- Actual Currency read/create/update/soft-delete/restore/delete runs through
  `MedusaModule` inside workerd/D1.
- Cloudflare app type-check and 2 tests pass.
- Generated migration drift check and fresh local D1 migration test pass.
- Production Worker build: 222 transformed modules, 390.51 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passes.

The next persistence boundary is relation-aware Drizzle repository behavior.
Before selecting a relation-heavy module, add portable relationship metadata
and test recursive soft-delete/restore cascades through the same repository
contract. `upsertWithReplace`, ORM-managed mutation-event parity, and D1
multi-statement atomicity remain open.

## Portable DML Relationship Metadata

Commit:

- `5d7b24f84e feat: preserve DML relationship metadata for Drizzle`

Validation performed:

- Portable DML and Drizzle package builds passed.
- Drizzle package tests: 7 passing.
- Actual Store graph compiled with both configured delete cascades and correct
  snake-case target tables.
- Store package build passed.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated temporary PostgreSQL cluster.
- Actual Currency workerd/D1 mutation runtime passed.
- Generated migration drift and fresh local D1 migration tests passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 392.77 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

The next step is to compile relationship ownership into physical Drizzle
foreign-key columns and constraints for the smallest parent/child model graph.
Only after that schema path passes should the repository use the compiled
metadata for recursive soft-delete and restore.

## Drizzle Relationship Foreign Keys

Commit:

- `454485fce7 feat: generate Drizzle relationship foreign keys`

Validation performed:

- Drizzle package build and tests: 8 passing.
- Actual Store graph compiled `store_currency.store_id` and
  `store_locale.store_id` as generated nullable ID columns with cascade
  constraints to `store.id`.
- Store package build passed.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 395.20 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

The next persistence boundary is repository behavior over this physical
schema: relationship loading for the smallest parent/child graph, then
recursive soft-delete/restore through the existing repository contract.
Composite keys, many-to-many pivot generation, ORM-managed mutation-event
parity, and D1 multi-statement atomicity remain open.

## Drizzle FK-Backed Relationship Loading

Commit:

- `05c71d50cd feat: load Drizzle FK-backed relations`

Validation performed:

- `@medusajs/dal` build passed.
- Drizzle package build and tests: 9 passing.
- Drizzle repository test covers actual Medusa DML `hasMany` and `belongsTo`
  populate over generated FK-backed SQLite schema.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 401.21 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

The next persistence boundary is recursive relationship behavior: soft-delete
and restore cascades must follow the compiled relationship metadata through
the same repository contract. Nested populate paths, composite keys,
many-to-many pivot loading, ORM-managed mutation-event parity, and D1
multi-statement atomicity remain open.

## Drizzle Recursive Soft Delete And Restore Cascades

Commit:

- `98630cf21c feat: cascade Drizzle soft delete and restore`

Validation performed:

- Drizzle package build and tests: 10 passing.
- Drizzle repository test covers actual Medusa DML parent -> child ->
  grandchild recursive soft-delete and restore cascades over generated
  FK-backed SQLite schema.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 405.09 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

The next persistence boundary is either nested populate support or
many-to-many/composite-key relationship support before moving to a
relationship-heavy module. ORM-managed mutation-event parity,
`upsertWithReplace`, and D1 multi-statement atomicity remain open.

## Drizzle Nested Relationship Loading

Commit:

- `7982edd95f feat: load nested Drizzle relations`

Validation performed:

- Drizzle package build and tests: 10 passing.
- Drizzle repository test covers actual Medusa DML parent -> child ->
  grandchild nested populate over generated FK-backed SQLite schema.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 406.11 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

The next persistence boundary is many-to-many/composite-key relationship
support before moving to a relationship-heavy module. ORM-managed
mutation-event parity, `upsertWithReplace`, and D1 multi-statement atomicity
remain open.

## Drizzle PivotEntity Many-To-Many Loading

Commit:

- `bd97a1111b feat: load Drizzle pivotEntity relations`

Validation performed:

- Drizzle package build and tests: 11 passing.
- Drizzle repository test covers bidirectional actual Medusa DML
  `manyToMany` populate through an explicit pivotEntity over generated
  SQLite schema.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 409.35 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

The next relationship boundary is implicit pivotTable support or composite-key
support before moving to a relationship-heavy module. Many-to-many
mutation/detach behavior, ORM-managed mutation-event parity,
`upsertWithReplace`, and D1 multi-statement atomicity remain open.

## Drizzle Implicit PivotTable Generation And Loading

Commit:

- `fd2ce8dc15 feat: generate Drizzle implicit pivot tables`

Validation performed:

- Drizzle package build and tests: 13 passing.
- Drizzle schema test covers compiler-generated implicit pivot tables with
  join columns, inverse join columns, indexes, and cascading foreign keys.
- Drizzle repository test covers bidirectional actual Medusa DML
  `manyToMany` populate through an implicit pivotTable over generated SQLite
  schema.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 415.78 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

The next relationship boundary is composite-key support before moving to a
relationship-heavy module. Many-to-many mutation/detach behavior,
ORM-managed mutation-event parity, `upsertWithReplace`, and D1
multi-statement atomicity remain open.

## Drizzle Composite Primary-Key Baseline

Commit:

- `841eee6eb6 feat: render Drizzle composite primary keys`

Validation performed:

- Drizzle package build and tests: 15 passing.
- Drizzle D1 renderer test covers executable SQLite/D1 SQL for table-level
  composite primary-key constraints.
- Drizzle repository test covers create, find, update, upsert, and delete for a
  root DML model with a composite primary key.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 415.78 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

The next composite-key boundary is composite foreign keys and relationship
loading. Many-to-many mutation/detach behavior, ORM-managed mutation-event
parity, `upsertWithReplace`, and D1 multi-statement atomicity remain open.

## Drizzle Composite Foreign-Key Schema

Commit:

- `2f280945ec feat: generate Drizzle composite foreign keys`

Validation performed:

- Drizzle package build and tests: 18 passing.
- Drizzle schema tests cover deterministic owner columns, ordered composite
  indexes and foreign keys, inverse cascade metadata, and rejection of an
  ambiguous singular custom `foreignKeyName`.
- Drizzle D1 renderer test executes the generated schema in SQLite and proves
  composite foreign-key enforcement and cascade delete.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 416.35 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

The next composite-key boundary is repository relationship loading and
cascade/mutation behavior across the generated composite foreign key.
Many-to-many mutation/detach behavior, ORM-managed mutation-event parity,
`upsertWithReplace`, and D1 multi-statement atomicity remain open.

## Drizzle Composite Relationship Loading And Cascades

Commit:

- `de4a59e938 feat: load Drizzle composite relations`

Validation performed:

- Drizzle package build and tests: 19 passing.
- Drizzle repository test covers bidirectional populate through an FK-backed
  composite relationship, proves complete tuple matching when one key
  component is shared, and covers soft-delete/restore cascade traversal.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 416.89 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

The next data-model boundary is composite many-to-many pivot schema/loading or
relationship attach/detach mutation behavior. ORM-managed mutation-event
parity, `upsertWithReplace`, schema-diff upgrade migrations, and D1
multi-statement atomicity remain open.

## Drizzle Composite Many-To-Many Pivots

Commit:

- `e61c6ff640 feat: support Drizzle composite pivots`

Validation performed:

- Drizzle package build and tests: 23 passing.
- Drizzle schema tests cover implicit composite pivot generation and custom
  pivot-column arity validation.
- Drizzle repository tests cover bidirectional composite-key loading through
  both compiler-generated implicit pivots and explicit `pivotEntity` models,
  including shared-key-component cross-match prevention.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 417.86 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

The next data-model boundary is relationship attach/detach and replacement
mutation behavior. ORM-managed mutation-event parity, `upsertWithReplace`,
schema-diff upgrade migrations, and D1 multi-statement atomicity remain open.

## Drizzle Implicit Many-To-Many Replacement

Commit:

- `84a70461c7 feat: replace Drizzle implicit relations`

Validation performed:

- Drizzle package build and tests: 24 passing.
- Drizzle repository test covers flat `upsertWithReplace` creation and partial
  update, composite implicit-pivot attach/replace/detach, performed actions,
  hydrated responses, and non-destructive missing-target rejection.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 422.66 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

The next data-model boundary is nested target creation and one-to-many or
explicit pivot-entity replacement through `upsertWithReplace`. ORM-managed
mutation-event parity, schema-diff upgrade migrations, and D1 multi-statement
atomicity remain open.

## Drizzle FK-Backed HasMany Replacement

Commit:

- `09fcf66af5 feat: replace Drizzle hasMany relations`

Validation performed:

- Drizzle package build and tests: 25 passing.
- Drizzle repository test covers FK-backed `hasMany` creation, existing-child
  association and partial update, composite owner keys, physical omission
  deletion, detach-all, hydrated responses, performed actions, and
  non-destructive duplicate-key rejection.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Existing Currency integration suite through MikroORM/Postgres: 13 passing,
  using an isolated UTF-8 temporary PostgreSQL cluster.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 426.80 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

FK-backed one-to-many replacement is now covered. Deeper nested relation
replacement, explicit pivot-entity replacement, implicit many-to-many nested
target creation, ORM-managed mutation-event parity, schema-diff upgrade
migrations, and D1 multi-statement atomicity remain open.

## Drizzle Explicit Pivot-Entity Replacement

Commit:

- `2d7d98d157 feat: replace Drizzle explicit pivot relations`

Validation performed:

- Drizzle package build and tests: 26 passing.
- Drizzle repository test covers explicit `pivotEntity` many-to-many
  attach/replace/detach through `upsertWithReplace`, hydrated responses,
  non-destructive missing-target rejection, and target preservation.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing.
- Generated Currency migration drift and fresh local D1 migration tests passed.
- Actual Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 222 transformed modules, 430.76 kB.
- Composed Worker guard: 216 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.
- `git diff --check` passed.

Existing-target explicit pivot-entity replacement is now covered. Deeper
nested relation replacement, implicit many-to-many nested target creation,
ORM-managed mutation-event parity, schema-diff upgrade migrations, and D1
multi-statement atomicity remain open.

## Adopted Next Slice: Durable Object SQLite Manager

The next implementation slice is no longer additional relational edge-case
parity by default.

Next acceptance target:

- A Cloudflare-specific Drizzle manager executes against
  `DurableObjectStorage.sql`.
- Existing DML schema compilation and Drizzle repository behavior are reused.
- Cloudflare runtime types and bindings stay outside portable shared barrels.
- Workerd tests prove basic repository execution and actual multi-statement
  rollback/atomicity behavior.
- The result determines whether an async Drizzle proxy is viable inside the
  Durable Object transaction boundary or whether a staged statement executor
  is required.

The first real aggregate after this proof is expected to be Cart, using
DO-local SQLite as authoritative storage and D1 only for projections.

## Durable Object SQLite Manager Prototype

Commit:

- `0d367310ed feat: prove Durable Object SQLite manager`

Validation performed:

- `@medusajs/drizzle` build and 26 tests passed.
- `@medusajs/drizzle-cloudflare` build passed.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing
  unchanged assertions.
- Durable Object SQLite workerd proof passed repository create/read behavior.
- The same workerd proof confirmed that the current async manager transaction
  is serialized but non-atomic: a write remains after the callback throws.
- Existing Currency workerd/D1 mutation runtime passed.
- Generated Currency migration drift and fresh local D1 migration checks
  passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 229 transformed modules, 444.42 kB.
- Composed Worker guard: 333 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.

The next implementation step is a staged statement executor or equivalent
explicit synchronous command boundary that can place a complete repository
write set inside `DurableObjectStorage.transactionSync`. Cart must wait until
the real workerd rollback proof reports atomic behavior.

This initial conclusion is superseded by the async transaction correction
below.

## Durable Object Async Transaction Correction

Commit:

- `5c1910a4ea feat: make Durable Object transactions atomic`

The Durable Object SQLite manager now uses
`DurableObjectStorage.transaction(async callback)` for the existing Medusa
manager transaction contract. The real workerd proof confirms:

- transaction mode is `atomic`;
- multiple repository writes are visible inside the active transaction;
- nested manager transaction callbacks reuse the active boundary;
- throwing from the outer callback rolls back every write.

The previously planned staged statement executor is not required for this
contract. The next persistence work can continue through unchanged Medusa
module behavior while the proof DO remains a disposable runtime fixture.

Durable Object storage transaction callbacks may retry. Future event and
external side-effect integration must stay outside this persistence callback
or use idempotency.

Validation performed:

- `@medusajs/drizzle` build and 26 tests passed.
- `@medusajs/drizzle-cloudflare` build passed.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing
  unchanged assertions.
- Durable Object SQLite workerd atomic transaction proof passed.
- Existing Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 229 transformed modules, 445.19 kB.
- Composed Worker guard: 333 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.

## First Cart Drizzle Compatibility Slice

Commit:

- `bda8a75828 feat: add first Cart Drizzle compatibility slice`

The full unchanged Cart integration suite is now being used as the next shared
Medusa compatibility gate. The first audit exposed broad repository blockers
rather than a need for a Cart-specific implementation.

Implemented in this slice:

- Medusa BigNumber numeric and raw-field persistence.
- Direct and nested owner-side `belongsTo` filter translation.
- Foreign-key-safe Drizzle module-test database cleanup.
- Precise portable utility entrypoints for the new repository dependencies.

Validation performed:

- Drizzle package build and 28 tests passed.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing
  unchanged assertions.
- Existing Cart integration suite through Drizzle/SQLite: 54 passing and 9
  failing unchanged assertions, improved from 2 passing and 61 failing.
- Cloudflare app type-check and 2 tests passed.
- Durable Object SQLite and D1 workerd runtime proofs passed.
- Both Cloudflare import guards and the production Worker build passed.

The next narrow compatibility slice is required DML property validation with
the existing Medusa error semantics. Nested address creation, check-constraint
translation, nested replacement foreign-key preservation, and totals parity
remain separate follow-up slices.

## Drizzle Required DML Property Validation

Commit:

- `eb7207b670 feat: validate required Drizzle DML properties`

The shared Drizzle write preparation boundary now rejects missing or null
non-nullable stored DML properties with the existing Medusa validation message
shape. Defaults, generated IDs and timestamps, nullable properties, computed
properties, and autoincrement fields remain valid.

Validation performed:

- Drizzle package build and 29 tests passed.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing
  unchanged assertions.
- Existing Cart integration suite through Drizzle/SQLite: 57 passing and 6
  failing unchanged assertions, improved from 54 passing and 9 failing.
- Cloudflare app type-check and 2 tests passed.
- Durable Object SQLite and D1 workerd runtime proofs passed.
- Both Cloudflare import guards and the production Worker build passed.

The next narrow compatibility slice is nested Cart billing and shipping
address creation through the shared Drizzle relationship replacement path.
Check-constraint translation, nested replacement foreign-key preservation, and
totals parity remain separate follow-ups.

## Drizzle Owner-Side Singular Relation Creation

Commit:

- `73733162fd feat: create Drizzle owner-side singular relations`

The shared Drizzle repository now creates nested owner-side `belongsTo` and
`hasOneWithFK` targets and assigns their primary keys to the source row before
the source write. The unchanged Cart nested billing and shipping address
assertion now passes.

Validation performed:

- Drizzle package build and 30 tests passed.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing
  unchanged assertions.
- Existing Cart integration suite through Drizzle/SQLite: 58 passing and 5
  failing unchanged assertions, improved from 57 passing and 6 failing.
- Cloudflare app type-check and 2 tests passed.
- Durable Object SQLite and D1 workerd runtime proofs passed.
- Both Cloudflare import guards and the production Worker build passed.

The multi-write operation is atomic under the Node SQLite and Durable Object
managers. D1 remains in statement transaction mode and cannot guarantee
rollback if the source write fails after creating the nested target.

The next narrow compatibility slice is check-constraint error translation.
Nested replacement foreign-key preservation and totals parity remain separate
follow-ups.

## Drizzle DML Check Constraints

Commit:

- `70071e19f7 feat: render Drizzle DML check constraints`

Medusa DML `checks()` now compile into named SQLite/D1 `CHECK` constraints in
the Drizzle schema path. Drizzle mutation failures caused by those constraints
surface with the expected `CheckConstraintViolationException` name without
adding a MikroORM import to portable Drizzle code.

Validation performed:

- Drizzle package build and 33 tests passed.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing
  unchanged assertions.
- Existing Cart integration suite through Drizzle/SQLite: 59 passing and 4
  failing unchanged assertions, improved from 58 passing and 5 failing.
- Cloudflare app type-check and 2 tests passed.
- Durable Object SQLite and D1 workerd runtime proofs passed.
- Both Cloudflare import guards and the production Worker build passed.

The next narrow compatibility slice is nested replacement foreign-key
preservation for adjustments and tax lines. Cart totals parity remains a
separate follow-up.

## Drizzle Sparse Upsert Owner-FK Preservation

Commit:

- `56c1fd7bca feat: preserve Drizzle sparse upsert owner FKs`

Drizzle `upsert` now preserves existing generated owner foreign keys when the
incoming payload has a complete primary key and matches an existing row. This
fixes the Cart adjustment and tax-line replacement paths that update sparse
child rows by id.

Validation performed:

- Drizzle package build and 33 tests passed.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing
  unchanged assertions.
- Existing Cart integration suite through Drizzle/SQLite: 62 passing and 1
  failing unchanged assertion, improved from 59 passing and 4 failing.
- Cloudflare app type-check and 2 tests passed.
- Durable Object SQLite and D1 workerd runtime proofs passed.
- Both Cloudflare import guards and the production Worker build passed.

The only remaining unchanged Cart failure is totals parity.

## Drizzle Explicit Empty Field Selection And Cart Totals Parity

Commit:

- `1282a90858 feat: preserve Drizzle explicit empty field selection`

Drizzle now treats `fields: []` as an explicit empty scalar selection and
selects only model primary keys for identity and relation hydration. This
prevents calculated Cart total responses from leaking persisted Cart base
columns while preserving the loaded relations needed by the existing totals
decorator.

Validation performed:

- Drizzle package build and 33 tests passed.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing
  unchanged assertions.
- Focused existing Cart totals assertion passed.
- Existing Cart integration suite through Drizzle/SQLite: 63 passing unchanged
  assertions, improved from 62 passing and 1 failing.
- Cloudflare app type-check and 2 tests passed.
- Durable Object SQLite and D1 workerd runtime proofs passed.
- Both Cloudflare import guards and the production Worker build passed.

The unchanged Cart module integration suite is now green through
Drizzle/SQLite. The next narrow milestone can use that baseline before adding
the first Cart-oriented Durable Object SQLite vertical slice.

## Cart Durable Object SQLite Proof Slice

Commit:

- `cf859c5c37 feat: add Cart DO SQLite proof`

The Cloudflare app now exposes a second Durable Object class, `CartProofDO`.
It uses the actual Cart module service with the shared Drizzle DO SQLite
manager, creates a cart with a line item and shipping method, retrieves totals,
and proves read-your-own-writes plus rollback through the service transaction
context.

Validation performed:

- Cart package build passed.
- Drizzle package build and 33 tests passed.
- Existing Cart integration suite through Drizzle/SQLite: 63 passing unchanged
  assertions.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing
  unchanged assertions.
- Cloudflare app type-check and 2 tests passed.
- Composed Worker import guard passed with 356 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency DO SQLite and D1 workerd proofs passed.
- New Cart DO SQLite workerd proof passed.
- Production Worker build passed at 508.24 kB, gzip 108.00 kB.

Known limitation:

- The Worker uses an app-local framework utility shim with a minimal Cart
  totals decorator for this proof route. The full shared Medusa totals utility
  is not yet portable because its current import graph still reaches broad
  utility barrels. The unchanged Cart integration suite continues to validate
  real totals behavior outside the proof shim.

## Portable Shared Cart Totals In Worker

Commit:

- `bfb62a9791 feat: make Cart totals portable in Worker`

Status:

- The proof-only Cart totals decorator has been removed from the Cloudflare
  app-local framework utility shim.
- `CartProofDO` now reaches Medusa's real shared `decorateCartTotals` and
  `createRawPropertiesFromBigNumber` helpers through portable
  `@medusajs/utils/totals/*` entry points.
- The shared totals files now use type-only DTO imports and leaf `common/*`
  imports where needed, avoiding broad utility barrels in the Worker graph.

Validation performed:

- Focused shared totals tests: 21 passing.
- `@medusajs/utils` build passed.
- Drizzle package build and tests: 33 passing.
- Existing Cart integration suite through Drizzle/SQLite: 63 passing unchanged
  assertions.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing
  unchanged assertions.
- Cloudflare app typecheck and 2 tests passed.
- Composed Worker import guard passed with 367 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency DO SQLite and D1 workerd proofs passed.
- Cart DO SQLite workerd proof passed with the real shared totals helpers.
- Production Worker build passed at 551.81 kB, gzip 116.73 kB.

## Shared Framework Utility Shim Reduction

Commit:

- `b4a47bb899 refactor: shrink Cloudflare framework utility shim`

Status:

- The Cloudflare app-local `@medusajs/framework/utils` shim now delegates
  common helpers, ID generation, and module-sdk context/transaction decorators
  to precise shared `@medusajs/utils` leaf entry points.
- The shared `generateEntityId` helper was made Web Crypto based so importing
  it does not pull Node `crypto` through the `ulid` package.
- The remaining app-local shim surface is limited to the current proof
  boundaries: `ModulesSdkUtils`, `MedusaError`, and no-op `EmitEvents`.

Validation performed:

- `@medusajs/utils` build passed.
- Focused `promiseAll` and module-sdk decorator tests: 6 passing.
- Existing Cart integration suite through Drizzle/SQLite: 63 passing unchanged
  assertions.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing
  unchanged assertions.
- Cloudflare app typecheck and 2 tests passed.
- Composed Worker import guard passed with 368 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency DO SQLite and D1 workerd proofs passed.
- Cart DO SQLite workerd proof passed.
- Production Worker build passed at 549.57 kB, gzip 116.22 kB.

## Shared Medusa Error In Worker

Commit:

- `da024ab2a3 refactor: use shared Medusa error in Worker`

Status:

- The Cloudflare app-local `@medusajs/framework/utils` shim now re-exports
  `MedusaError`, `MedusaErrorTypes`, and `MedusaErrorCodes` from
  `@medusajs/utils/common/errors`.
- The real shared `MedusaError` leaf is Worker-portable and does not import
  broad utility barrels or Node-only modules.
- The remaining app-local shim surface is now limited to `ModulesSdkUtils` and
  no-op `EmitEvents`.

Validation performed:

- `@medusajs/utils` build passed.
- Existing Cart integration suite through Drizzle/SQLite: 63 passing unchanged
  assertions.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing
  unchanged assertions.
- Cloudflare app typecheck and 2 tests passed.
- Composed Worker import guard passed with 368 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency DO SQLite and D1 workerd proofs passed.
- Cart DO SQLite workerd proof passed.
- Production Worker build passed at 549.10 kB, gzip 115.99 kB.

## Portable ModulesSdkUtils Leaf In Worker

Commit:

- `dfd4636e30 refactor: move ModulesSdkUtils to portable leaf`

Status:

- The Cloudflare app-local `@medusajs/framework/utils` shim now re-exports
  `ModulesSdkUtils` from `@medusajs/utils/modules-sdk/portable`.
- The portable shared leaf exposes only `ModulesSdkUtils.MedusaService`.
- The full upstream `ModulesSdkUtils` barrel remains outside the Worker import
  graph because it still includes Node-oriented module-sdk infrastructure.
- The only remaining app-local shim behavior is no-op `EmitEvents`.

Validation performed:

- `@medusajs/utils` build passed.
- Existing Cart integration suite through Drizzle/SQLite: 63 passing unchanged
  assertions.
- Existing Currency integration suite through Drizzle/SQLite: 13 passing
  unchanged assertions.
- Cloudflare app typecheck and 2 tests passed.
- Composed Worker import guard passed with 369 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency DO SQLite proof passed.
- Existing Currency D1 workerd proof passed; the script logged a Wrangler local
  D1 migration cleanup timeout after the runtime assertion and exited 0.
- Cart DO SQLite workerd proof passed.
- Production Worker build passed at 549.19 kB, gzip 116.01 kB.

## Portable Module SDK Entrypoint Naming And Guard

Commit:

- `42589ca0d3 refactor: rename module sdk portable entrypoint`

Status:

- The portable module SDK subset moved from
  `@medusajs/utils/modules-sdk/portable-utils` to
  `@medusajs/utils/modules-sdk/portable`.
- The new `medusa-cloudflare check:portable-entrypoints` guard bundles the
  portable entrypoint directly and rejects broad barrels, Node builtins,
  Express, PostgreSQL, MikroORM, module loaders, and migration scripts.
- Root barrels remain unchanged; portable entrypoints are additive and will
  grow only as each surface is proven.

Validation performed:

- `@medusajs/utils` build passed.
- Portable entrypoint guard passed: 38 bundled inputs.
- Cloudflare app typecheck and 2 tests passed.
- Composed Worker import guard passed with 369 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Cart DO SQLite workerd proof passed.
- Production Worker build passed at 549.18 kB, gzip 116.01 kB.

## Shared EmitEvents In Worker

Commit:

- `54d675300c refactor: use shared EmitEvents in Worker`

Status:

- The Cloudflare app-local `@medusajs/framework/utils` shim now re-exports
  `EmitEvents` from `@medusajs/utils/modules-sdk/decorators/emit-events`.
- The no-op app-local `EmitEvents` implementation was removed.
- The app-local framework utility shim now contains only re-exports of shared
  leaves and no local runtime behavior.

Validation performed:

- `@medusajs/utils` build passed.
- Focused module-sdk `EmitEvents` tests: 2 passing.
- Existing Cart integration suite through Drizzle/SQLite: 63 passing unchanged
  assertions.
- Cloudflare app typecheck and 2 tests passed.
- Portable entrypoint guard passed for `emit-events`: 5 bundled inputs.
- Portable entrypoint guard passed for `modules-sdk/portable`: 38 bundled
  inputs.
- Composed Worker import guard passed with 369 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Cart DO SQLite workerd proof passed.
- Production Worker build passed at 549.70 kB, gzip 116.05 kB.

## Cart Durable Object Adjustments And Tax Lines

Commit:

- `2e5ede30d2 test: expand Cart DO aggregate proof`

Status:

- `CartProofDO` now writes line item adjustments, line item tax lines, shipping
  method adjustments, and shipping method tax lines through the actual Cart
  module service.
- The workerd assertion checks relation counts and total `319`, proving the
  real totals path applies discount-before-tax semantics inside DO SQLite.
- The existing atomic rollback proof remains part of the same Cart DO script.

Validation performed:

- Existing Cart integration suite through Drizzle/SQLite: 63 passing unchanged
  assertions.
- Cloudflare app typecheck and 2 tests passed.
- Composed Worker import guard passed with 369 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Cart DO SQLite workerd proof passed for adjustments, tax lines, totals, and
  atomic rollback.
- Production Worker build passed at 550.60 kB, gzip 116.20 kB.

## Portable Actual Currency Service Graph

Commit:

- `cd479894a8 refactor: make currency service import graph portable`

Validation performed:

- `@medusajs/utils`, `@medusajs/framework`, and `@medusajs/currency` builds.
- Existing Currency integration suite: 13 passing unchanged assertions against
  an isolated temporary PostgreSQL cluster.
- Cloudflare portable import guard: 124 bundled inputs accepted.
- Strict actual Currency service guard: 68 bundled inputs, 0 Worker blockers.
- Focused module-sdk, utils module-sdk, and DML entity-builder suites: 115
  passing tests total.

## Shared Static Module Runtime Composition

Commit:

- `2c3633e5c8 refactor: share static module runtime composition`

Status:

- Currency and Cart proof modules now use the same app-local
  `createStaticModuleRuntime` wrapper for logger/container setup,
  Drizzle adapter injection, and `MedusaModule.bootstrap`.
- Module-specific wrappers still expose the same runtime creation functions and
  return the same typed actual Medusa services.
- No module service, repository, DML model, workflow, or route behavior changed.

Validation performed:

- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 passing.
- Composed Worker import guard passed with 370 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed; the script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Cart Durable Object SQLite workerd proof passed.
- Production Worker build passed at 549.89 kB, gzip 116.26 kB.

## Shared Static App Loader Entrypoint

Commit:

- `0f57972467 refactor: add shared static app loader`

Status:

- `@medusajs/modules-sdk/static-app` now exposes `loadStaticModule` for
  Worker-safe static manifest bootstrap through the existing
  `MedusaModule.bootstrap` path.
- The Cloudflare app-local static runtime helper now only selects the Drizzle
  persistence adapter, passes the concrete manager, and returns the existing
  runtime shape.
- `check:portable-entrypoints` now guards the new modules-sdk static app
  entrypoint.

Validation performed:

- `@medusajs/modules-sdk` build passed.
- Full `@medusajs/modules-sdk` suite passed: 77 passing.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 passing.
- Portable entrypoint guard passed for `@medusajs/modules-sdk/static-app`:
  42 bundled inputs.
- Composed Worker import guard passed with 372 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed; the script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Cart Durable Object SQLite workerd proof passed.
- Production Worker build passed at 550.53 kB, gzip 116.39 kB.

## Static Module Set Loader

Commit:

- `0207511790 refactor: load static module sets`

Status:

- `@medusajs/modules-sdk/static-app` now exposes `loadStaticModules` for
  loading multiple static module manifests into one shared container.
- The loader uses `MedusaModule.bootstrapAll`, preserving the existing Medusa
  module registration and service resolution path.
- The return shape is a dynamic service map keyed by module key. This avoids
  pretending runtime manifest keys are statically known before generated
  manifest typing exists.

Validation performed:

- `@medusajs/modules-sdk` build passed.
- Focused static app tests passed: 2 passing.
- Full `@medusajs/modules-sdk` suite passed: 78 passing.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 passing.
- Portable entrypoint guard passed for `@medusajs/modules-sdk/static-app`:
  42 bundled inputs.
- Composed Worker import guard passed with 372 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed; the script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Cart Durable Object SQLite workerd proof passed.
- Production Worker build passed at 550.89 kB, gzip 116.44 kB.

## Commerce Module Set Proof

Commit:

- `8083f796f4 refactor: compose commerce module set in Cart proof`

Status:

- `apps/medusa-cloudflare/src/commerce-modules.ts` defines the first explicit
  Worker-safe commerce module set: Currency plus Cart.
- `CartProofDO` now loads that module set through `loadStaticModules`, compiles
  the combined DML schema, and runs the existing Cart proof through the Cart
  service returned by the set runtime.
- The proof keeps Drizzle adapter selection at the app boundary and does not
  introduce replacement module services.

Validation performed:

- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 passing.
- Focused static app tests passed: 2 passing.
- Portable entrypoint guard passed for `@medusajs/modules-sdk/static-app`:
  42 bundled inputs.
- Composed Worker import guard passed with 372 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed; the script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Cart Durable Object SQLite workerd proof passed through the commerce module
  set.
- Production Worker build passed at 553.24 kB, gzip 116.84 kB.

## Store Static Manifest

Commit:

- `34d8e1ce9d feat: add Store static manifest`

Status:

- Store now exports a module-owned `static-manifest` containing its definition,
  module exports, DML models, loaders, module service, and portable joiner
  config.
- A focused drift test compares the static manifest against Store's normal
  `Module(Modules.STORE, ...)` export and joiner config.
- Store is prepared for static manifest set composition, but it is not part of
  the Worker commerce module set yet.

Validation performed:

- `@medusajs/store` build passed.
- Store static manifest drift test passed.
- Existing Store package test command passed: 2 passing.

## Store Drizzle Compatibility

Commit:

- `baddfc312a fix: handle generated root ids in Drizzle replace upsert`

Status:

- The unchanged Store integration suite now passes through Drizzle/SQLite.
- The shared Drizzle repository no longer tries to bind an undefined generated
  root ID while creating a root entity with replacement relations.
- Store remains outside the Worker commerce module set until the next runtime
  proof.

Validation performed:

- `@medusajs/drizzle` build passed.
- Drizzle package tests passed: 34 passing.
- Existing Store integration suite through Drizzle/SQLite passed: 12 passing.
- Existing Cart integration suite through Drizzle/SQLite passed: 63 passing.
- Existing Currency integration suite through Drizzle/SQLite passed: 13
  passing.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 passing.
- Composed Worker import guard passed with 372 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed; the script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Existing Cart Durable Object SQLite workerd proof passed.
- Production Worker build passed at 553.29 kB, gzip 116.84 kB.
- `git diff --check` passed.

## Store In Worker Commerce Module Set

Commit:

- `ca26a59e7f feat: compose Store in Worker commerce module set`

Status:

- The Worker commerce module set now contains Currency, Cart, and Store.
- The combined Durable Object SQLite proof creates a Store with supported
  currencies and locales, then runs the existing Cart aggregate totals and
  rollback proof from the same module set.
- No Store module service, public API, DML model, workflow, or replacement app
  service was introduced.

Validation performed:

- `@medusajs/utils` build passed.
- `@medusajs/store` build passed.
- Existing Store integration suite through Drizzle/SQLite passed: 12 passing.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 passing.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Composed Worker import guard passed with 381 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed; the script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Store + Cart Durable Object SQLite workerd proof passed through the commerce
  module set.
- Production Worker build passed at 562.51 kB, gzip 118.44 kB.
- `git diff --check` passed.

## Sales Channel In Worker Commerce Module Set

Commit:

- `e8d7010cd9 feat: compose Sales Channel in Worker module set`

Status:

- The Worker commerce module set now contains Currency, Cart, Store, and Sales
  Channel.
- Sales Channel owns a static manifest and package exports for Worker-safe
  static composition.
- The combined Durable Object SQLite proof creates and lists a Sales Channel,
  creates and lists a Store, then runs Cart totals and rollback checks from the
  same module set.
- No replacement Sales Channel service or app-local module behavior was
  introduced.

Validation performed:

- `@medusajs/sales-channel` build passed.
- Sales Channel package tests passed: 2 passing.
- Existing Sales Channel integration suite through Drizzle/SQLite passed: 14
  passing.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 passing.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Composed Worker import guard passed with 387 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed; the script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Sales Channel + Store + Cart Durable Object SQLite workerd proof passed
  through the commerce module set.
- Production Worker build passed at 568.67 kB, gzip 118.96 kB.
- `git diff --check` passed.

## Region In Worker Commerce Module Set

Commit:

- `38d364dc12 feat: compose Region in Worker module set`

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, and Region.
- Region owns a static manifest, package exports, and a manifest drift test for
  Worker-safe static composition.
- The combined Durable Object SQLite proof runs Region's real default country
  loader, creates a Region with country `us`, lists it with `countries`, and
  then runs the existing Sales Channel, Store, Cart totals, and rollback
  checks from the same module set.
- No replacement Region service or app-local Region behavior was introduced.

Validation performed:

- `@medusajs/region` build passed.
- Region package static-manifest test passed: 1 passing.
- Existing Region integration suite through Drizzle/SQLite passed: 18
  passing.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 passing.
- Composed Worker import guard passed with 396 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 600.87 kB, gzip 125.15 kB.
- Region + Sales Channel + Store + Cart Durable Object SQLite workerd proof
  passed through the commerce module set.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed; the script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Fresh local D1 migration check passed.
- `git diff --check` passed.

## Customer In Worker Commerce Module Set

Commit:

- `5952a88a43 feat: compose Customer in Worker module set`

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, and Customer.
- Customer owns a static manifest, package exports, and a manifest drift test
  for Worker-safe static composition.
- The combined Durable Object SQLite proof creates a Customer with an address,
  creates a Customer group, links the customer to the group, lists by the
  group many-to-many filter, and then runs the existing Region, Sales Channel,
  Store, Cart totals, and rollback checks from the same module set.
- No replacement Customer service or app-local Customer behavior was
  introduced.

Validation performed:

- `@medusajs/drizzle` build passed.
- Drizzle package tests passed: 36 passing.
- `@medusajs/customer` build passed.
- Customer package static-manifest test passed: 1 passing.
- Existing Customer integration suite through Drizzle/SQLite passed: 47
  passing.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 passing.
- Composed Worker import guard passed with 405 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 623.26 kB, gzip 128.14 kB.
- Customer + Region + Sales Channel + Store + Cart Durable Object SQLite
  workerd proof passed through the commerce module set.
- Existing Currency Durable Object SQLite workerd proof passed.
- Existing Currency D1 workerd proof passed; the script logged the known
  Wrangler local D1 migration cleanup timeout after the runtime assertion and
  exited 0.
- Fresh local D1 migration check passed.
- `git diff --check` passed.

## Product Drizzle Module Gate

Commit:

- `d0c28904e7 feat: pass Product module Drizzle gate`

Status:

- Product's existing integration slice now passes through Drizzle/SQLite before
  Worker composition.
- The Worker commerce module set still contains Currency, Cart, Store, Sales
  Channel, Region, and Customer. Product has not yet been added to the Worker
  module set.
- Product remains on the actual module service path. The fork did not add an
  app-local Product service or a parallel portable Product assertion suite.

Validation performed:

- `@medusajs/drizzle` tests passed: 36 passing.
- `@medusajs/drizzle` build passed.
- `@medusajs/product` build passed.
- Existing Product integration slice through Drizzle/SQLite passed: 205
  passing, 1 skipped.
- `git diff --check` passed.

Next implementation step:

- Add Product's static manifest and manifest drift test.
- Compose Product into the Worker commerce module set.
- Extend the Durable Object SQLite proof with a minimal real Product create and
  list check before expanding deeper Product behavior.

## Product In Worker Commerce Module Set

Commit:

- `dc9d40d051 feat: compose Product in Worker module set`

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, Customer, and Product.
- Product owns a static manifest, package exports, and a manifest drift test
  for Worker-safe static composition.
- The combined Durable Object SQLite proof creates and lists a Product, then
  runs the existing Customer, Region, Sales Channel, Store, Cart totals, and
  rollback checks from the same module set.
- No replacement Product service or app-local Product behavior was introduced.
- Cart totals explicitly request the scalar relation fields required by the
  Drizzle projection path before decorating totals.

Validation performed:

- `@medusajs/utils` build passed.
- `@medusajs/cart` build passed.
- `@medusajs/product` build passed.
- Product package static-manifest test passed: 1 passing.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 passing.
- Composed Worker import guard passed with 425 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 724.53 kB, gzip 144.04 kB.
- Product + Customer + Region + Sales Channel + Store + Cart Durable Object
  SQLite workerd proof passed through the commerce module set.
- `git diff --check` passed.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite.
- Add static Worker composition only after the unchanged suite passes.

## Drizzle Adapter File Split

Commit:

- `209c1203df refactor: split Drizzle Medusa adapter helpers`

Status:

- The large Drizzle Medusa adapter file has been reduced from 3845 lines to
  3165 lines by extracting mutation-event dispatch, relationship metadata
  traversal, and constraint/error mapping helpers.
- This did not change the module-test acceptance strategy. The next feature
  milestone is still to pick the next commerce module, run its unchanged
  integration suite through Drizzle/SQLite, then add Worker composition only
  after that gate passes.

Validation performed:

- `@medusajs/drizzle` tests passed: 36 passing.
- `@medusajs/drizzle` build passed.
- Composed Worker import guard passed with 428 bundled inputs.
- `git diff --check` passed.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite.

## Stock Location In Worker Commerce Module Set

Commit:

- `fa67290f87 feat: compose Stock Location in Worker module set`

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, Customer, Product, and Stock Location.
- Stock Location owns a static manifest, package exports, and a manifest drift
  test for Worker-safe static composition.
- The combined Durable Object SQLite proof creates and lists a Stock Location
  with an address, then runs the existing Product, Customer, Region, Sales
  Channel, Store, Cart totals, and rollback checks from the same module set.
- The shared Drizzle repository now supports owner-side nullable to-one
  relation creation during `update`, which is required by Stock Location's
  existing address update assertion.
- No replacement Stock Location service or app-local Stock Location behavior
  was introduced.

Validation performed:

- `@medusajs/drizzle` tests passed: 36 passing.
- `@medusajs/stock-location` build passed.
- Stock Location package tests passed: 2 passing.
- Existing Stock Location integration suite through Drizzle/SQLite passed:
  8 passing.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 passing.
- Composed Worker import guard passed with 436 bundled inputs.
- Strict actual Currency module import guard passed with 0 Worker blockers.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 737.19 kB, gzip 145.29 kB.
- Product + Customer + Stock Location + Region + Sales Channel + Store + Cart
  Durable Object SQLite workerd proof passed through the commerce module set.
- Fresh local D1 migration check passed.
- `git diff --check` passed.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite.

## Inventory Drizzle Module Gate

Commit:

- Current Inventory Drizzle gate change set.

Status:

- The unchanged Inventory integration suite now passes through the
  Drizzle/SQLite module-test path.
- The shared Drizzle adapter now supplies Inventory computed quantity
  projections and the InventoryLevel aggregate repository methods expected by
  the existing Inventory services.
- Reservation item mutation events emitted by the Drizzle fallback now use the
  Inventory source, matching the existing event assertions.
- Bulk update return order now preserves primary-key `$or` selector order when
  the only ordering is the default primary-key ascending order.
- No replacement Inventory service, DML model, workflow, public API, or
  app-local assertion suite was introduced.

Validation performed:

- `@medusajs/drizzle` tests passed: 39 passing.
- `@medusajs/drizzle` build passed.
- Existing Inventory integration suite through Drizzle/SQLite passed:
  35 passing.

Next implementation step:

- Add Inventory to the Worker commerce module set with a static manifest only
  after resolving real service import-graph blockers.

## Inventory In Worker Commerce Module Set

Commit:

- `0820f155ff feat: compose Inventory in Worker module set`

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, Customer, Product, Stock Location, and Inventory.
- Inventory owns a static manifest, package exports, and a manifest drift test
  for Worker-safe static composition.
- Inventory's real service path remains in use. The Cloudflare app selects the
  static manifest and Drizzle manager at the root; it does not rebuild
  Inventory service behavior.
- The combined Durable Object SQLite proof creates an Inventory item and level
  tied to the Stock Location proof data, then runs the existing Cart totals and
  rollback checks from the same module set.

Validation performed:

- `@medusajs/inventory` build passed.
- Inventory package tests passed: 2 passing.
- Existing Inventory integration suite through Drizzle/SQLite passed:
  35 passing.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 passing.
- Composed Worker import guard passed with 449 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 783.99 kB, gzip 151.86 kB.
- Product + Inventory + Customer + Stock Location + Region + Sales Channel +
  Store + Cart Durable Object SQLite workerd proof passed through the commerce
  module set.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  gate passes.

## Index Real Product/Pricing Joiner Config Proof

Commit:

- This commit (`Reuse Product and Pricing joiner configs in Index proof`)

Status:

- Index Worker composition imports real Product and Pricing module joiner
  configs.
- Product and Pricing DML models used by that graph import the portable
  framework utils boundary instead of the broad framework utils barrel.
- The remaining local fixture is the ProductVariant/PriceSet link joiner
  config.

Validation performed:

- `@medusajs/framework` build passed.
- `@medusajs/product` build passed.
- `@medusajs/pricing` build passed.
- `@medusajs/index` build passed.
- Existing Index SQLite integration suite passed: 19 tests.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` compatibility alias passed.
- Node-only import guard passed for the isolated Index proof bundle and
  Product/Pricing/Index portable source paths.

Next implementation step:

- Replace the remaining ProductVariant/PriceSet local link joiner fixture with
  a reusable static link manifest shape.

## Index Real Link Definition Proof

Commit:

- This commit (`Reuse ProductVariant PriceSet link definition in Index proof`)

Status:

- Index Worker composition imports real Product, Pricing, and
  ProductVariant/PriceSet link joiner configs.
- The proof seed now uses the real `LinkProductVariantPriceSet` entity shape.
- The remaining proof-owned pieces are the seed data helper and small proof
  GraphQL schema.

Validation performed:

- `@medusajs/utils` build passed.
- `@medusajs/framework` build passed.
- `@medusajs/link-modules` build passed after framework build completed.
- `@medusajs/index` build passed.
- Existing Index SQLite integration suite passed: 19 tests.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` compatibility alias passed.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.

Next implementation step:

- Share the Index SQLite relation proof fixture data between the Worker
  composition and the SQLite integration harness where possible.

## Index Shared SQLite Relation Fixture Proof

Commit:

- This commit (`Share Index SQLite relation proof fixture`)

Status:

- Index Worker composition and the Node SQLite integration harness share the
  same relation-query schema, joiner registration, and seed data.
- The shared fixture uses the real Product, Pricing, and
  ProductVariant/PriceSet link configs.
- The old `ProductVariantPriceSetLink` fixture names are removed from the
  SQLite harness and Worker proof source paths.

Validation performed:

- `@medusajs/index` build passed.
- Existing Index SQLite integration suite passed: 19 tests.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` compatibility alias passed.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.

Next implementation step:

- Move generic SQLite service-construction scaffolding behind a reusable helper
  while keeping runtime-specific executors separate.

## Index Shared SQLite Service Composition Proof

Commit:

- This commit (`Share Index SQLite service composition`)

Status:

- Index Worker proof and Node SQLite integration harness share the same SQLite
  service-construction helper.
- Runtime-specific executors remain separated by environment.
- The stale service-construction scan shows `worker-composition` and the Node
  harness no longer own `IndexModuleService` construction or remote query
  doubles.

Validation performed:

- `@medusajs/index` build passed.
- Existing Index SQLite integration suite passed: 19 tests.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` compatibility alias passed.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.

Next implementation step:

- Decide whether the remaining proof query/result extraction should be a
  reusable package proof runner or stay as the thin proof API until more Index
  runtime behavior needs it.

## Index Relation Proof Runner Status

Commit:

- This commit (`Move Index relation proof into runner`)

Status:

- Relation proof execution lives in
  `packages/modules/index/src/relation-query-proof-runner.ts`.
- `@medusajs/index/worker-composition` is now a compatibility re-export.
- The isolated Worker proof still passes through the compatibility entry.

Validation performed:

- `@medusajs/index` build passed.
- Existing Index SQLite integration suite passed: 19 tests.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` compatibility alias passed.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.

Next implementation step:

- Audit whether the isolated Index proof now has enough package-owned
  composition to move from helper refactoring to the next Index behavior gap.

## Actual Index Service Through Durable Object SQLite

Commit:

- This commit (`Add Index Durable Object SQLite proof`)

The focused Index proof Worker now runs the actual `IndexModuleService` with
`SqliteIndexStorageProvider` inside a Durable Object using Cloudflare SQLite
storage. The proof seeds Product, Variant, Price Set, and Price Index rows and
verifies the real `module.query` relation path in workerd.

Validation performed:

- `@medusajs/index test:integration:sqlite` passed: 19 tests.
- `@medusajs/index` build passed.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker build passed.
- Actual Index module service DO SQLite workerd proof passed.
- Import guard passed for the isolated Index proof graph and portable Index
  source paths.
- `git diff --check` passed with line-ending warnings only.

Current limitations:

- This validates the isolated Index proof Worker, not the full production
  Cloudflare app bundle.
- The broader app graph still has unrelated unfinished Node/CJS import edges.
- D1-specific execution remains future work.

Next implementation step:

- Fold the isolated proof boundary back into reusable Worker composition or
  add the D1-facing executor abstraction.

## Actual Index Service Through D1 SQLite

Commit:

- This commit (`Add Index Cloudflare SQLite executor boundary`)

The focused Index proof Worker now runs the same real
`IndexModuleService.query` relation proof through Durable Object SQLite and D1.
Both paths use Cloudflare implementations of the existing
`SqliteIndexExecutor` contract.

Validation performed:

- Cloudflare app typecheck passed.
- Isolated Index proof Worker build passed.
- `test:index-sqlite` passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as a compatibility alias.
- Import guard passed for the isolated proof graph and portable Index source
  paths.
- `git diff --check` passed with line-ending warnings only.

Current limitations:

- This validates the isolated Index proof Worker, not the full production
  Cloudflare app bundle.
- The next Index step is to reduce the proof-only framework shim and move the
  minimum safe composition pieces toward reusable Worker composition.

## Index Portable Framework Utils Boundary

Commit:

- This commit (`Add Index portable framework utils boundary`)

The portable Index service path now uses
`@medusajs/framework/utils/portable` instead of an app-local proof shim for the
minimum Worker-safe framework utility surface.

Validation performed:

- `@medusajs/framework` build passed.
- `@medusajs/index` build passed.
- `@medusajs/index test:integration:sqlite` passed: 19 tests.
- Cloudflare app typecheck passed.
- `test:index-sqlite` passed for Durable Object SQLite and D1 using the built
  proof Worker served by Wrangler.
- `test:index-do-sqlite` passed as a compatibility alias.
- Import guard passed for the isolated proof graph and portable Index source
  paths.
- `git diff --check` passed with line-ending warnings only.

Current limitations:

- This validates the isolated Index proof Worker and portable Index source
  graph, not the full production Cloudflare app bundle.
- The next Index step is to move the remaining app-local Index service
  composition helpers toward a reusable Index Worker composition module.

## Index Worker Composition Module

Commit:

- This commit (`Move Index Worker composition into package`)

The Cloudflare proof now uses package-owned Index Worker composition for both
Durable Object SQLite and D1. The app-specific proof code only selects the
Cloudflare executor and forwards HTTP requests.

Validation performed:

- `@medusajs/index` build passed.
- `@medusajs/index test:integration:sqlite` passed: 19 tests.
- Cloudflare app typecheck passed after the Index build completed.
- `test:index-sqlite` passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as a compatibility alias.
- Import guard passed for the isolated proof graph and portable Index source
  paths.
- `git diff --check` passed with line-ending warnings only.

Current limitations:

- The shared composition helper still uses proof fixture joiner configs.
- The next Index step is to replace those fixture configs with reusable
  Product/Pricing static joiner config inputs where possible.

## Cloudflare App Vitest Gate Recovered

Commit:

- This commit.

Status:

- The app-local Worker Vitest gate is no longer blocked by the previous
  Vite/Rolldown dependency optimizer failure.
- The active configuration uses `apps/medusa-cloudflare/vitest.config.ts` for
  tests and keeps the Cloudflare Vite plugin in `vite.config.ts` for the app
  build.
- Older domain records that say `yarn workspace medusa-cloudflare test` was
  blocked are historical notes from before the Vitest config split, not current
  blockers.

Validation performed:

```bash
yarn workspace medusa-cloudflare test
```

Result: 1 file passing, 9 tests passing.

Next implementation step:

- Treat `medusa-cloudflare test` as an active local gate again for future
  Worker-entrypoint slices.

## Cloudflare Queue Event Bus Module

Commit:

- `189aeb2ac5 Add Cloudflare Queue event bus module`

Status:

- `@medusajs/event-bus-cloudflare` is now a separate Event Bus module package
  that implements Medusa's existing `IEventBusModuleService` boundary.
- The Cloudflare app selects the Queue-backed Event Bus at the application
  root and passes the `MEDUSA_EVENTS` Queue binding as module options.
- Commerce modules still consume the normal Event Bus module service; no
  Worker-local event facade or parallel module-service hierarchy was added.
- The current Queue path enqueues emitted events and dispatches local
  subscribers in the same runtime. This preserves existing lifecycle behavior
  such as Caching invalidation while proving the Cloudflare Queue producer
  boundary.
- The real async Queue consumer, retry policy, dead-letter handling, and
  cross-partition fan-out remain open runtime work.

Validation performed:

- `@medusajs/event-bus-cloudflare` build passed.
- Focused Cloudflare Event Bus tests passed: 2 passing.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 964 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,872.13 kB, gzip 340.90 kB.
- Durable Object SQLite workerd proof passed with the Queue-backed Event Bus,
  Durable Object Locking, Caching invalidation, and the composed commerce
  module set.

Known validation blocker:

- `yarn workspace medusa-cloudflare test` still fails in Vite/Rolldown
  dependency optimization with `Missing field tsconfigPaths on
  BindingViteResolvePluginConfig.resolveOptions`. This blocker predates the
  Queue-backed Event Bus slice; production build and workerd proof pass.

Next implementation step:

- Either add Queue consumer dispatch/retry/dead-letter behavior as the next
  infrastructure slice, or defer it until workflow runtime composition needs
  asynchronous event delivery.

## Cloudflare Queue Consumer Dispatch

Commit:

- `b44605b3d2 Add Cloudflare Queue consumer dispatch`

Status:

- The Cloudflare Event Bus module now has a consumer-side dispatch API for
  messages already delivered by Cloudflare Queues.
- Queued message bodies are treated as `unknown` at the Worker boundary and
  narrowed before dispatch.
- Consumer dispatch calls registered Event Bus subscribers without enqueueing
  again.
- Subscriber failures reject the dispatch call, allowing the Worker Queue
  handler to call `message.retry()`.
- The Cloudflare app declares a `medusa-events` consumer with max retries and
  a `medusa-events-dlq` dead-letter queue.
- The workerd proof now sends a proof event through `MEDUSA_EVENTS`, dispatches
  it in the Worker Queue handler, and records delivery in
  `EventConsumerProofDO`.

Validation performed:

- `@medusajs/event-bus-cloudflare` build passed.
- Focused Cloudflare Event Bus tests passed: 5 passing.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 967 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,877.93 kB, gzip 342.18 kB.
- Durable Object SQLite workerd proof passed with Queue consumer dispatch,
  Durable Object Locking, Caching invalidation, and the composed commerce
  module set.

Current limitations:

- This proves a Worker-root Queue consumer and subscriber dispatch. It does not
  yet solve cross-partition routing to tenant/deployment-specific Medusa
  runtimes.
- Durable subscriber progress, idempotency, delayed scheduling parity, and
  operational dead-letter recovery UI are still open.
- `yarn workspace medusa-cloudflare test` still fails in Vite/Rolldown
  dependency optimization with `Missing field tsconfigPaths on
  BindingViteResolvePluginConfig.resolveOptions`; production build and
  workerd proof pass.

Next implementation step:

- Continue with cross-partition Queue routing only when a real workflow or
  tenant runtime boundary requires it; otherwise move to the next runtime or
  commerce module gate.

## Translation In Worker Commerce Module Set

Commit:

- b779457284 (`Add Translation to Cloudflare commerce module set`)
- d7dee077be (`Cover Translation query pagination`)

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, Customer, Product, Stock Location, Inventory, Pricing, Tax,
  Payment, Order, API Key, Fulfillment, Promotion, User, Auth, File,
  Notification, RBAC, Settings, and Translation.
- `@medusajs/translation/static-manifest` exposes Translation's module
  definition, service, default-locale loader, DML models, and portable joiner
  config for explicit Worker composition.
- Translation's real service path is composed through the shared static module
  set loader. The Cloudflare app selects the static manifest and Drizzle
  manager at the root; it does not rebuild Translation service behavior.
- The Cloudflare app's utility facade now exposes the narrow DML and locale
  helpers Translation needs without importing broad Node/MikroORM barrels.
- The Durable Object SQLite proof verifies the default locale loader, creates
  a product translation, searches translation JSON with `q`, checks filtered
  translation fields, and reads Translation statistics before running Cart
  totals and rollback checks from the same module set.
- The Translation integration suite now includes a focused `q` plus
  pagination/count regression to preserve filter-before-page semantics.

Validation performed:

- `@medusajs/translation` build passed.
- Translation static manifest test passed: 1 test.
- Existing Translation integration suite through Drizzle/SQLite passed:
  1 suite and 60 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 720 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,474.11 kB, gzip 257.77 kB.
- Cloudflare app tests passed: 2 tests.
- API Key + Auth + RBAC + Settings + Translation + File + Notification +
  Fulfillment + Order + Promotion + Tax + Pricing + Payment + Product +
  Inventory + Customer + Stock Location + Region + Sales Channel + Store +
  User + Cart Durable Object SQLite workerd proof passed through the commerce
  module set.

Current limitations:

- This proof composes Translation's service and persistence path only. It does
  not solve HTTP route exposure, workflow usage, cross-module translation
  query APIs, or backend-specific indexed JSON search.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  module gate passes.

## Caching In Worker Runtime Module Set

Commit:

- ab4b977c82 (`Add Caching to Cloudflare runtime module set`)

Status:

- Caching is now part of the Worker runtime module set as the first
  infrastructure module after the commerce-module pass.
- The composed Worker still uses the real `CachingModuleService`; the
  Cloudflare app supplies a Worker memory provider through static provider
  composition.
- The normal Node Caching entry remains intact for dynamic provider loading
  and the built-in Node memory provider.
- The Durable Object SQLite proof computes a cache key, writes data with tags,
  reads by key, reads by tag, clears by tag, and verifies the cleared read
  before continuing through the existing commerce proof.

Validation performed:

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
  + Notification + Fulfillment + Order + Promotion + Tax + Pricing + Payment
  + Product + Inventory + Customer + Stock Location + Region + Sales Channel
  + Store + User + Cart Durable Object SQLite workerd proof passed through the
  composed module set.

Current limitations:

- Redis provider behavior remains covered by the Redis-specific integration
  spec, which was not run locally because no Redis service was provisioned.
- Cloudflare app Vitest is blocked by the current Vite/Rolldown dependency
  optimizer error `Missing field tsconfigPaths on
  BindingViteResolvePluginConfig.resolveOptions`. The production Worker build
  and workerd proof pass.

Next implementation step:

- Continue with the next runtime/infrastructure module, likely event bus or
  locking, using static provider composition and import-guard validation.

## Event Bus Local In Worker Runtime Module Set

Commit:

- 3653f4bd4a (`Add Event Bus Local to Cloudflare runtime set`)

Status:

- Event Bus Local is now part of the Worker runtime module set.
- The composed Worker uses the real `LocalEventBusService`; it does not
  introduce a Worker-local replacement event service.
- Event Bus Local owns a static manifest and package export for explicit
  Worker composition.
- The local service no longer depends on Node's `events` module or
  `timers/promises`; those were replaced by a local emitter and
  `globalThis.setTimeout`.
- The Worker framework-utils shim now includes a narrow
  `AbstractEventBusModuleService` implementation so the Worker graph does not
  import the current Node-heavy event-bus utils barrel.
- The Durable Object SQLite proof emits `product.updated` through Event Bus
  Local and verifies Caching's lifecycle subscriber invalidates the cached
  product key before the existing module proof continues.

Validation performed:

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
  + Sales Channel + Store + User + Cart Durable Object SQLite workerd proof
  passed through the composed module set, including Event Bus driven cache
  invalidation.

Current limitations:

- This slice proves the local in-process event bus only. Cloudflare Queues,
  Durable Object fan-out, retries, cross-partition delivery, and durable event
  storage remain future work.
- Cloudflare app Vitest is still blocked by the current Vite/Rolldown
  dependency optimizer error `Missing field tsconfigPaths on
  BindingViteResolvePluginConfig.resolveOptions`. The production Worker build
  and workerd proof pass.

Next implementation step:

- Continue with the next runtime/infrastructure boundary. Locking is the
  strongest next candidate because it will be needed by checkout correctness
  and later queued event processing.

## Locking In Worker Runtime Module Set

Commit:

- a7c26835f7 (`Add Locking to Cloudflare runtime set`)

Status:

- Locking is now part of the Worker runtime module set.
- The composed Worker uses the real `LockingModuleService`; it does not
  introduce a Worker-local replacement locking service.
- Locking owns a static manifest and package export for explicit Worker
  composition.
- The normal Node module entry still uses the original dynamic provider loader.
  The Worker path uses a static provider loader with the default in-memory
  provider.
- The in-memory provider no longer assumes Node timer handles. It uses
  `globalThis.setTimeout` and only calls `unref()` after narrowing that method.
- The Durable Object SQLite proof runs concurrent stock-consuming jobs through
  `runtime.locking.service.execute` and verifies the lock keeps successful
  sales at available stock with no negative stock.

Validation performed:

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
  locking.

Current limitations:

- This slice proves only the default in-memory Locking provider inside the
  current Worker/DO runtime. A true distributed Cloudflare provider should use
  Durable Object partitioning and remains future work.
- Redis and Postgres locking providers are still Node infrastructure providers
  and are intentionally absent from the Worker bundle.
- Cloudflare app Vitest is still blocked by the current Vite/Rolldown
  dependency optimizer error `Missing field tsconfigPaths on
  BindingViteResolvePluginConfig.resolveOptions`. The production Worker build
  and workerd proof pass.

Next implementation step:

- Choose the next infrastructure boundary: a Durable Object locking provider if
  checkout coordination is the priority, or a queue-backed Event Bus provider
  if asynchronous delivery should be proven first.

## Cloudflare Durable Object Locking Provider In Worker Runtime

Commit:

- bc4711409d (`Add Cloudflare Durable Object locking provider`)

Status:

- `@medusajs/locking-cloudflare` now provides a Cloudflare Durable
  Object-backed Locking provider.
- The composed Worker still uses the real `LockingModuleService`; only its
  provider implementation changes through the existing static provider loader.
- `MedusaLockingDO` is exported from the Worker and bound as `MEDUSA_LOCKING`.
- The Cart Durable Object proof requires the `MEDUSA_LOCKING` binding and
  configures the Locking module with `lockingCloudflareProvider`.
- The proof verifies serialized stock-consuming jobs through
  `runtime.locking.service.execute` and marks the provider as
  `cloudflare-durable-object`.

Validation performed:

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
  + Stock Location + Region + Sales Channel + Store + User + Cart Durable
  Object SQLite workerd proof passed through the composed module set.

Current limitations:

- The provider currently uses one named coordinator Durable Object instance per
  configured scope. This preserves `releaseAll` and is enough for the first
  correctness gate, but it is not the final sharded lock topology.
- Redis and Postgres locking providers remain Node infrastructure providers
  and stay absent from the Worker bundle.
- Cloudflare app Vitest is still blocked by the current Vite/Rolldown
  dependency optimizer error `Missing field tsconfigPaths on
  BindingViteResolvePluginConfig.resolveOptions`. The production Worker build
  and workerd proof pass.

Next implementation step:

- Move to a queue-backed Event Bus provider or begin the workflow runtime
  boundary. Queue-backed Event Bus is the narrower next provider slice.

## Analytics In Worker Commerce Module Set

Commit:

- 9dfa3d2f22 (`Add Analytics to Cloudflare commerce module set`)

Status:

- The Worker commerce module set now contains Analytics, Currency, Cart, Store,
  Sales Channel, Region, Customer, Product, Stock Location, Inventory,
  Pricing, Tax, Payment, Order, API Key, Fulfillment, Promotion, User, Auth,
  File, Notification, RBAC, Settings, and Translation.
- `@medusajs/analytics/static-manifest` exposes Analytics' module definition,
  service, provider service, and static provider loader for explicit Worker
  composition.
- Analytics' real service path is composed through the shared static module
  set loader. The Cloudflare app selects the static manifest, provider export,
  and Drizzle manager at the root; it does not rebuild Analytics service
  behavior.
- The Cloudflare app supplies an in-memory Analytics provider as deployment
  composition. This proves provider wiring only; production analytics
  transports remain later provider work.
- The Durable Object SQLite proof calls `track` and `identify` through the
  real Analytics service and verifies the in-memory provider received both
  events before running Cart totals and rollback checks from the same module
  set.

Validation performed:

- `@medusajs/modules-sdk` build passed.
- `@medusajs/analytics` build passed.
- Analytics static manifest test passed: 1 test.
- Existing Analytics integration suite through Drizzle/SQLite passed:
  1 suite and 3 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 725 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,480.18 kB, gzip 259.09 kB.
- Cloudflare app tests passed: 2 tests.
- Analytics + API Key + Auth + RBAC + Settings + Translation + File +
  Notification + Fulfillment + Order + Promotion + Tax + Pricing + Payment +
  Product + Inventory + Customer + Stock Location + Region + Sales Channel +
  Store + User + Cart Durable Object SQLite workerd proof passed through the
  commerce module set.

Current limitations:

- This proof composes Analytics' service and provider dispatch path only. It
  does not solve production analytics providers, HTTP exposure, events, or
  workflow-triggered analytics.

Next implementation step:

- The remaining packages are primarily runtime/infrastructure modules:
  caching/cache providers, event bus, locking, workflow engines, index, and
  link modules. Pick the next one as an explicit runtime slice rather than
  treating it as another ordinary commerce persistence module.

## Settings In Worker Commerce Module Set

Commit:

- 181d023304 (`Add Settings to Cloudflare commerce module set`)

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, Customer, Product, Stock Location, Inventory, Pricing, Tax,
  Payment, Order, API Key, Fulfillment, Promotion, User, Auth, File,
  Notification, RBAC, and Settings.
- Settings owns a static manifest, package export, and manifest drift test for
  Worker-safe static composition.
- Settings' real module service remains in use. The Cloudflare app selects the
  static manifest and Drizzle manager at the root; it does not rebuild Settings
  service behavior.
- The combined Durable Object SQLite proof creates a Settings view
  configuration, replaces its JSON configuration with empty filters and null
  sorting, stores an active-view user preference, and resolves the active view
  through the real Settings service before running Cart totals and rollback
  checks from the same module set.

Validation performed:

- `@medusajs/settings` build passed.
- Settings static manifest test passed: 1 passing.
- Existing Settings integration suite through Drizzle/SQLite passed:
  1 suite and 11 passing tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 710 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,443.39 kB, gzip 251.89 kB.
- Cloudflare app tests passed: 2 tests.
- API Key + Auth + RBAC + Settings + File + Notification + Fulfillment +
  Order + Promotion + Tax + Pricing + Payment + Product + Inventory +
  Customer + Stock Location + Region + Sales Channel + Store + User + Cart
  Durable Object SQLite workerd proof passed through the commerce module set.

Current limitations:

- This proof composes Settings' module service and persistence path only. It
  does not solve HTTP route exposure, admin UI integration, events, workflows,
  or tenant/platform-level preference policy.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  gate passes.

## RBAC In Worker Commerce Module Set

Commit:

- 6f7b30e5e5 (`Add RBAC to Cloudflare commerce module set`)

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, Customer, Product, Stock Location, Inventory, Pricing, Tax,
  Payment, Order, API Key, Fulfillment, Promotion, User, Auth, File,
  Notification, and RBAC.
- RBAC owns a static manifest, package export, static manifest drift test, and
  Worker-safe repository placeholder. The placeholder is selected only by name;
  the Drizzle persistence adapter replaces it with the real Drizzle RBAC custom
  repository before registration.
- RBAC's real module service remains in use. The Cloudflare app selects the
  static manifest and Drizzle manager at the root; it does not rebuild RBAC
  service behavior.
- `@medusajs/utils` now exposes the global RBAC policy registries through a
  portable `policy-registry` module. Node `definePolicies` keeps its existing
  caller-file and disabled-file behavior, while the Worker graph imports only
  the registry data needed by RBAC service startup.
- RBAC was added to the shared `ModulesDefinition` map so static loading uses
  the same module-definition flow as the rest of the composed module set.
- The combined Durable Object SQLite proof creates an RBAC role, policy, and
  role-policy link, then validates both `listPoliciesForRole` and
  `listRbacRoles(..., { relations: ["policies"] })` through the composed
  module set.

Validation performed:

- `@medusajs/drizzle` build passed.
- `@medusajs/utils` build passed.
- `@medusajs/modules-sdk` build passed.
- `@medusajs/rbac` build passed.
- RBAC static manifest test passed: 1 passing.
- Existing RBAC integration suite through Drizzle/SQLite passed:
  1 suite, 6 passing tests, and 1 skipped existing linkable-config test.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 704 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,431.62 kB, gzip 250.21 kB.
- Cloudflare app tests passed: 2 tests.
- API Key + Auth + RBAC + File + Notification + Fulfillment + Order +
  Promotion + Tax + Pricing + Payment + Product + Inventory + Customer +
  Stock Location + Region + Sales Channel + Store + User + Cart Durable Object
  SQLite workerd proof passed through the commerce module set.

Current limitations:

- This proof composes RBAC's module service and custom repository path only. It
  does not solve HTTP route exposure, permission middleware integration,
  workflow exposure, or tenant/platform policy loading.
- The Drizzle RBAC repository currently uses in-process hierarchy traversal
  over active RBAC edges instead of target-specific recursive SQL. That is
  acceptable for the current module gate and small RBAC graph, but should be
  revisited if large role hierarchies become a real workload.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  gate passes.

## Notification In Worker Commerce Module Set

Commit:

- 2169c97ce5 (`Add Notification to Cloudflare commerce module set`)

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, Customer, Product, Stock Location, Inventory, Pricing, Tax,
  Payment, Order, API Key, Fulfillment, Promotion, User, Auth, File, and
  Notification.
- Notification owns a static manifest, package export, static provider loader,
  and manifest drift test for Worker-safe static composition.
- Notification's real module service and provider service remain in use. The
  Cloudflare app selects the static manifest, static provider module, and
  Drizzle manager at the root; it does not rebuild Notification behavior.
- The Cloudflare app supplies an in-memory Notification provider as deployment
  composition. This proves provider dispatch and persistence wiring only;
  production email/SMS/push providers remain later adapter work.
- The combined Durable Object SQLite proof creates a notification through the
  real Notification service, verifies the Worker provider external id, and
  retrieves the persisted notification before running Cart totals and rollback
  checks from the same module set.

Validation performed:

- `@medusajs/drizzle` build passed.
- Focused Drizzle array upsert regression passed: 1 test.
- `@medusajs/notification` build passed.
- Notification static manifest test passed: 1 passing.
- Existing Notification integration suite through Drizzle/SQLite passed:
  2 suites and 11 passing tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 692 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,411.29 kB, gzip 246.61 kB.
- Cloudflare app tests passed: 2 tests.
- API Key + Auth + File + Notification + Fulfillment + Order + Promotion +
  Tax + Pricing + Payment + Product + Inventory + Customer + Stock Location +
  Region + Sales Channel + Store + User + Cart Durable Object SQLite workerd
  proof passed through the commerce module set.

Current limitations:

- This proof composes Notification's module service, provider service, and
  provider dispatch path only. It does not solve HTTP route exposure, events,
  workflows, or production notification transport adapters.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  gate passes.

## User In Worker Commerce Module Set

Commit:

- 741dd3d0f1 (`Port commerce modules to Cloudflare static runtime`)

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, Customer, Product, Stock Location, Inventory, Pricing, Tax,
  Payment, Order, API Key, Fulfillment, Promotion, and User.
- User owns a static manifest, package export, and manifest drift test for
  Worker-safe static composition.
- User's real service path remains in use. The Cloudflare app selects the
  static manifest, Drizzle manager, and User module JWT secret at the root; it
  does not rebuild User service behavior in the app.
- Static module loading now preserves per-module `moduleOptions` while adding
  the shared Drizzle manager. This keeps Medusa's existing module-option
  semantics for modules such as User that read runtime options from the second
  service constructor argument.
- User source files that enter the Worker graph use relative local imports and
  type-only framework imports so production bundling does not require runtime
  exports from `@medusajs/framework/types`.
- The combined Durable Object SQLite proof creates and lists a real User,
  creates an Invite, and validates the invite token before running the existing
  commerce module-set totals and atomic rollback checks.

Validation performed:

- `@medusajs/user` build passed.
- User static manifest test passed: 1 test.
- Existing User integration suite through Drizzle/SQLite passed: 28 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 664 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,377.88 kB, gzip 239.89 kB.
- Cloudflare app tests passed: 2 tests.
- API Key + Fulfillment + Order + Promotion + Tax + Pricing + Payment +
  Product + Inventory + Customer + Stock Location + Region + Sales Channel +
  Store + User + Cart Durable Object SQLite workerd proof passed through the
  commerce module set.

Current limitations:

- This proof composes User's module service and invite-token path only. It does
  not solve HTTP route exposure, auth middleware, events beyond module-service
  mutation emission, workflows, or session handling.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  module gate passes.

## File In Worker Commerce Module Set

Commit:

- 47f566f9db (`Add File to Cloudflare commerce module set`)

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, Customer, Product, Stock Location, Inventory, Pricing, Tax,
  Payment, Order, API Key, Fulfillment, Promotion, User, Auth, and File.
- File owns a static manifest, package export, manifest drift test, and
  Worker-safe static provider loader.
- File's real service path remains in use. The Cloudflare app selects the
  static manifest, provider export, and Drizzle manager at the root; it does
  not rebuild File service behavior in the app.
- The normal Node module entry still uses the original dynamic provider loader.
  The Worker static manifest uses the static provider loader because filesystem
  provider resolution is not portable.
- The Cloudflare app provides a small in-memory File provider as deployment
  composition. It proves service/provider wiring only and is not a production
  storage adapter.
- The combined Durable Object SQLite proof creates a file, retrieves it, lists
  it by id, and generates a presigned upload URL before running the existing
  commerce module-set totals and atomic rollback checks.

Validation performed:

- `@medusajs/file` build passed.
- File static manifest/package tests passed: 2 tests.
- Existing File integration suite through Drizzle/SQLite passed: 4 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 681 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,397.58 kB, gzip 243.67 kB.
- Cloudflare app tests passed: 2 tests.
- API Key + Auth + File + Fulfillment + Order + Promotion + Tax + Pricing +
  Payment + Product + Inventory + Customer + Stock Location + Region + Sales
  Channel + Store + User + Cart Durable Object SQLite workerd proof passed
  through the commerce module set.

Current limitations:

- This proof composes File's module service and provider boundary only. It does
  not solve production storage, R2/S3 providers, stream APIs, buffer APIs, HTTP
  route exposure, upload middleware, events, or workflows.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  module gate passes.

## Auth In Worker Commerce Module Set

Commit:

- 488e502b79 (`Add Auth to Cloudflare commerce module set`)

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, Customer, Product, Stock Location, Inventory, Pricing, Tax,
  Payment, Order, API Key, Fulfillment, Promotion, User, and Auth.
- Auth owns a static manifest, package export, and manifest drift test for
  Worker-safe static composition.
- Auth's real service path remains in use. The Cloudflare app selects the
  static manifest and Drizzle manager at the root; it does not rebuild Auth
  service behavior in the app.
- The static manifest includes Auth's DML models and internal
  `AuthProviderService`, but intentionally omits the dynamic provider loader.
  Provider discovery and provider execution remain a later runtime boundary.
- The combined Durable Object SQLite proof creates an Auth identity with a
  provider identity and lists it with the provider relation before running the
  existing commerce module-set totals and atomic rollback checks.

Validation performed:

- `@medusajs/auth` build passed.
- Auth static manifest test passed: 1 test.
- Existing Auth integration suite through Drizzle/SQLite passed: 36 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 673 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,388.74 kB, gzip 241.61 kB.
- Cloudflare app tests passed: 2 tests.
- API Key + Auth + Fulfillment + Order + Promotion + Tax + Pricing + Payment +
  Product + Inventory + Customer + Stock Location + Region + Sales Channel +
  Store + User + Cart Durable Object SQLite workerd proof passed through the
  commerce module set.

Current limitations:

- This proof composes Auth's module service and identity persistence path only.
  It does not solve dynamic auth provider loading, provider OAuth flows, HTTP
  route exposure, sessions, auth middleware, events, or workflows.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  module gate passes.

## Fulfillment Drizzle Module Gate

Commit:

- 741dd3d0f1 (`Port commerce modules to Cloudflare static runtime`)

Status:

- Fulfillment's existing integration assertions now pass through the
  Drizzle/SQLite module-test path with the real Fulfillment module service.
- The shared Drizzle adapter now covers Fulfillment-required generated id
  ordering compatibility, nested owned to-one create events, FK-backed
  `hasMany` replacement during plain update, collection-only update event
  parity, and Fulfillment-owned fallback event names.
- `fulfillment-module-service/index.spec.ts` no longer requests
  `MikroOrmWrapper` during suite setup on the Drizzle path.
- Fulfillment's real service path remains in use. The fork did not add an
  app-local Fulfillment service or a parallel Fulfillment assertion suite.

Validation performed:

- `@medusajs/dal` build passed.
- `@medusajs/drizzle` build passed.
- `@medusajs/drizzle` focused Medusa repository tests passed: 44 passing.
- `@medusajs/fulfillment` build passed.
- Existing Fulfillment integration suite through Drizzle/SQLite passed:
  75 passing.

Next implementation step:

- Add Fulfillment to the Worker commerce module set only after static manifest
  and provider-loader portability boundaries are handled.

## Fulfillment In Worker Commerce Module Set

Commit:

- 741dd3d0f1 (`Port commerce modules to Cloudflare static runtime`)

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, Customer, Product, Stock Location, Inventory, Pricing, Tax,
  Payment, Order, API Key, and Fulfillment.
- Fulfillment owns a static manifest, package export, and manifest drift test
  for Worker-safe static composition.
- Fulfillment's real service path remains in use. The Cloudflare app selects
  the static manifest and Drizzle manager at the root; it does not rebuild
  Fulfillment service behavior.
- Fulfillment's dynamic provider loader is intentionally not part of the
  Worker manifest yet. External provider discovery and provider action
  execution remain separate portability boundaries.
- Fulfillment source imports that enter the Worker graph no longer depend on
  unscoped `@models` or `@utils` aliases.
- The Worker-safe utility path now avoids broad Fulfillment event imports and
  the `node:util` dependency from `deepCopy`.
- The combined Durable Object SQLite proof creates a Fulfillment provider row,
  fulfillment set, service zone, geo zone, shipping profile, and shipping
  option before running the existing Cart totals and rollback checks from the
  same module set.

Validation performed:

- `@medusajs/utils` build passed.
- `@medusajs/fulfillment` build passed.
- Fulfillment static manifest test passed. The package command also ran the
  existing utils suite, for 23 total passing tests.
- Existing Fulfillment integration suite through Drizzle/SQLite passed:
  75 passing.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 623 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,250.79 kB, gzip 218.23 kB.
- Cloudflare app tests passed: 2 passing.
- API Key + Fulfillment + Order + Tax + Pricing + Payment + Product +
  Inventory + Customer + Stock Location + Region + Sales Channel + Store +
  Cart Durable Object SQLite workerd proof passed through the commerce module
  set.
- `git diff --check` passed.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  gate passes.

## API Key Drizzle Module Gate

Commit:

- 741dd3d0f1 (`Port commerce modules to Cloudflare static runtime`)

Status:

- API Key's existing integration assertions now pass through the
  Drizzle/SQLite module-test path.
- The shared Drizzle repository now handles null equality/inequality with SQL
  `IS NULL`/`IS NOT NULL` and coerces custom date-like filter fields such as
  `revoked_at`.
- API Key's real module service remains in use. The fork did not add an
  app-local API Key service or a parallel portable API Key assertion suite.

Validation performed:

- Drizzle focused Medusa repository tests passed: 41 passing.
- `@medusajs/drizzle` build passed.
- `@medusajs/api-key` build passed.
- Existing API Key integration suite through Drizzle/SQLite passed:
  25 passing.

## API Key In Worker Commerce Module Set

Commit:

- 741dd3d0f1 (`Port commerce modules to Cloudflare static runtime`)

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, Customer, Product, Stock Location, Inventory, Pricing, Tax,
  Payment, Order, and API Key.
- API Key owns a static manifest, package export, and manifest drift test for
  Worker-safe static composition.
- API Key's real service path remains in use. The Cloudflare app selects the
  static manifest and Drizzle manager at the root; it does not rebuild API Key
  service behavior.
- Node crypto imports were removed from the static Worker graph. Node still
  uses Node crypto for random bytes and scrypt hashing; Worker publishable-key
  generation uses Web Crypto random bytes.
- Secret API key generation/authentication remains a separate Worker crypto
  adapter/KDF boundary. This slice proves publishable keys only.
- The combined Durable Object SQLite proof creates and lists a publishable API
  key before running the existing commerce module-set proof.

Validation performed:

- `@medusajs/api-key` build passed.
- API Key static manifest test passed: 1 passing.
- Existing API Key integration suite through Drizzle/SQLite passed:
  25 passing.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 passing.
- Composed Worker import guard passed with 595 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,168.77 kB, gzip 205.93 kB.
- API Key + Order + Tax + Pricing + Payment + Product + Inventory + Customer +
  Stock Location + Region + Sales Channel + Store + Cart Durable Object SQLite
  workerd proof passed through the commerce module set.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  gate passes.

## Payment In Worker Commerce Module Set

Commit:

- `229151bd4e feat: compose Payment in Worker module set`

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, Customer, Product, Stock Location, Inventory, Pricing, Tax,
  and Payment.
- Payment owns a static manifest, package exports, and a manifest drift test
  for Worker-safe static composition.
- Payment's real service path remains in use. The Cloudflare app selects the
  static manifest and Drizzle manager at the root; it does not rebuild Payment
  service behavior.
- The Payment static manifest registers the built-in `pp_system_default`
  provider only. External provider/cloud provider discovery remains outside
  this slice.
- The combined Durable Object SQLite proof creates a payment collection,
  creates and authorizes a session, captures the payment, then runs the Cart
  totals and rollback checks from the same module set.
- Payment's joiner config now supplies explicit models, and the Worker
  framework utility shim uses the portable joiner builder to avoid filesystem
  discovery.

Validation performed:

- `@medusajs/payment` focused package tests passed.
- `@medusajs/payment` build passed.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 passing.
- Composed Worker import guard passed with 500 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 927.55 kB, gzip 175.13 kB.
- Tax + Pricing + Payment + Product + Inventory + Customer + Stock Location +
  Region + Sales Channel + Store + Cart Durable Object SQLite workerd proof
  passed through the commerce module set.
- `git diff --check` passed.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  gate passes.

## Payment Drizzle Module Gate

Commit:

- `db949a780d feat: pass Payment module Drizzle gate`

Status:

- The existing Payment integration assertions now pass through the
  Drizzle/SQLite module-test path.
- Payment fixture seeding is backend-neutral and still uses the real module
  service path, including generated MedusaService CRUD for deterministic
  Payment fixture IDs.
- The Drizzle repository now covers the Payment-required relation and
  projection behavior: scalar to-one relation keys, nested scalar fields inside
  relation paths, paired BigNumber numeric/raw projection, empty to-many arrays
  on created rows, and serialized root transactions for the Node SQLite test
  connection.
- Payment's real module service remains in use. The fork did not add an
  app-local Payment service or a parallel portable Payment assertion suite.

Validation performed:

- `@medusajs/drizzle` tests passed: 41 passing.
- `@medusajs/drizzle` build passed.
- `@medusajs/payment` build passed.
- Existing Payment integration suite through Drizzle/SQLite passed:
  36 passing.
- `git diff --check` passed.

Validation not completed:

- The default MikroORM/Postgres Payment integration suite was attempted, but
  this machine's PostgreSQL authentication failed before assertions with
  `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`.

Next implementation step:

- Add Payment to the Worker commerce module set only after static manifest and
  provider-loader portability boundaries are handled.

## Tax Drizzle Module Gate

Commit:

- `eea4119aaa feat: pass Tax module Drizzle gate`

Status:

- The existing Tax integration suites now pass through the Drizzle/SQLite
  module-test path.
- The Drizzle SQLite runtime table builder now preserves partial index
  predicates, and unique-index prevalidation now handles boolean predicates
  with whitespace.
- Tax's real module service remains in use. The fork did not add an app-local
  Tax service or a parallel portable Tax assertion suite.
- Tax has been added to the Worker commerce module set in
  `ccdeb4a6e1 feat: compose Tax in Worker module set`.

Validation performed:

- `@medusajs/drizzle` build passed.
- `@medusajs/drizzle` tests passed: 41 passing.
- `@medusajs/tax` build passed.
- Existing Tax integration suite through Drizzle/SQLite passed: 35 passing.
- Composed Worker import guard passed with 472 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- `git diff --check` passed.

## Tax In Worker Commerce Module Set

Commit:

- `ccdeb4a6e1 feat: compose Tax in Worker module set`

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, Customer, Product, Stock Location, Inventory, Pricing, and
  Tax.
- Tax owns a static manifest, package exports, and a manifest test for
  Worker-safe static composition.
- Tax's real service path remains in use. The Cloudflare app selects the
  static manifest and Drizzle manager at the root; it does not rebuild Tax
  service behavior.
- The combined Durable Object SQLite proof creates a Tax region with a default
  tax rate, then runs the existing Cart totals and rollback checks from the
  same module set.
- Tax provider loader portability remains a separate boundary; this proof does
  not yet register providers or call `getTaxLines`.

Validation performed:

- `@medusajs/tax` package tests passed: 2 passing.
- `@medusajs/tax` build passed.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 passing.
- Composed Worker import guard passed with 481 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 875.68 kB, gzip 166.61 kB.
- Tax + Pricing + Product + Inventory + Customer + Stock Location + Region +
  Sales Channel + Store + Cart Durable Object SQLite workerd proof passed
  through the commerce module set.
- `git diff --check` passed.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  gate passes.

## Pricing Drizzle Module Gate

Commit:

- `9b50b20223 feat: pass Pricing module Drizzle gate`

Status:

- The existing Pricing service suites, including `calculate-price`, now pass
  through the Drizzle/SQLite module-test path.
- The Drizzle adapter supplies a backend-specific implementation of the
  existing `PricingRepositoryService` for the named `pricingRepository`
  registration. The original MikroORM/Knex repository remains the default
  Node path.
- Pricing was the active next commerce module for Worker composition and is
  now complete in `4c28877ab5 feat: compose Pricing in Worker module set`.

Validation performed:

- `@medusajs/types` build passed.
- `@medusajs/utils` build passed.
- `@medusajs/modules-sdk` build passed.
- `@medusajs/drizzle` build passed.
- `@medusajs/drizzle` tests passed: 41 passing.
- `@medusajs/pricing` build passed.
- Focused module loader test passed: 4 passing.
- Existing Pricing integration suites through Drizzle/SQLite passed:
  126 passing.

## Pricing In Worker Commerce Module Set

Commit:

- `4c28877ab5 feat: compose Pricing in Worker module set`

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, Customer, Product, Stock Location, Inventory, and Pricing.
- Pricing owns a static manifest, package exports, and a manifest drift test
  for Worker-safe static composition.
- Pricing's real service path remains in use. The Cloudflare app selects the
  static manifest and Drizzle manager at the root; it does not rebuild Pricing
  service behavior.
- The combined Durable Object SQLite proof creates a price set and calculates
  a USD price, then runs the existing Cart totals and rollback checks from the
  same module set.

Validation performed:

- `@medusajs/utils` build passed.
- `@medusajs/framework` build passed.
- `@medusajs/pricing` build passed.
- Pricing package tests passed: 2 passing.
- Cloudflare app typecheck passed.
- Cloudflare app tests passed: 2 passing.
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

## Order Drizzle Module Gate

Commit:

- 741dd3d0f1 (`Port commerce modules to Cloudflare static runtime`)

Status:

- Order's Drizzle module gate now passes through Drizzle/SQLite with the real
  Order module services and unchanged assertions.
- The focused existing `order-items-shipping.spec.ts` suite passes through
  Drizzle/SQLite with the real Order module services and unchanged assertions.
- The existing `order-return.spec.ts` suite now passes through Drizzle/SQLite
  with the real Order module services and unchanged assertions.
- The existing `order-exchange.spec.ts` suite now passes through
  Drizzle/SQLite with the real Order module services and unchanged assertions.
- The existing `order-claim.spec.ts` suite now passes through Drizzle/SQLite
  with the real Order module services and unchanged assertions.
- The shared Drizzle adapter now covers Order-required serial generation,
  wrapper relation populate expansion, owned target nested create, inbound
  owned-row delete cleanup, module-wide relation descriptor compilation,
  inherited `_id`/`version` context for nested children, deterministic default
  ordering, field-derived relation loading, terminal relation row projection,
  versioned Order has-many relation filtering, related-entity versioned
  shipping-method filtering, direct relation ordering, hidden parent-version
  field loading, virtual `detail` filtering/population, and Order display-id
  ordering compatibility.
- `create-order.spec.ts` and `delete-order.spec.ts` no longer request
  `MikroOrmWrapper`; setup checks use service-level generated list APIs.
- No replacement Order service or app-local Order assertion suite was added.

Validation performed:

- `@medusajs/drizzle` tests passed: 40 passing.
- `@medusajs/drizzle` build passed.
- `@medusajs/order` build passed.
- Existing Order items/shipping integration suite through Drizzle/SQLite
  passed: 56 passing.
- Existing Order return integration suite through Drizzle/SQLite passed:
  2 passing.
- Existing Order exchange integration suite through Drizzle/SQLite passed:
  1 passing.
- Existing Order claim integration suite through Drizzle/SQLite passed:
  1 passing.
- Focused combined Order gate through Drizzle/SQLite passed: 4 suites,
  60 passing.
- Former setup-only blocker specs passed through Drizzle/SQLite:
  `create-order.spec.ts` and `delete-order.spec.ts`, 2 suites and 9 passing.
- Full existing Order integration suite through Drizzle/SQLite passed:
  9 suites and 77 passing.

Remaining blockers:

- Worker composition is tracked in the following Order Worker module-set
  record.

Next implementation step:

- Validate Order in the Worker commerce module set through the static manifest,
  import guard, production build, and workerd Durable Object SQLite proof.

## Promotion Drizzle Module Gate

Commit:

- 741dd3d0f1 (`Port commerce modules to Cloudflare static runtime`)

Status:

- The existing Promotion integration suite now passes through
  `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`.
- This validates Promotion campaigns, campaign budgets, promotion creation,
  rule evaluation, compute actions, usage registration, and usage reversion
  against the shared Drizzle repository path.
- The shared Drizzle adapter now covers Promotion-required reverse `hasOne`
  hydration (`Promotion.application_method`, `Campaign.budget`), raw filter
  keys generated by Promotion's rule prefilter, restore-time unique-index
  validation, and safer keyed nested `hasMany` creation/linking.
- Promotion is not yet part of the Worker commerce module set.

Validation performed:

- `@medusajs/drizzle` build passed.
- `@medusajs/promotion` build passed.
- `@medusajs/drizzle` focused Medusa repository spec passed: 44 passing.
- Existing Promotion integration suite through Drizzle/SQLite passed: 6
  suites and 178 passing.

Next implementation step:

- Add Promotion to the Worker commerce module set through a static manifest and
  validate the Cloudflare app gates. Completed in the current uncommitted
  change set.

## Promotion In Worker Commerce Module Set

Commit:

- 741dd3d0f1 (`Port commerce modules to Cloudflare static runtime`)

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, Customer, Product, Stock Location, Inventory, Pricing, Tax,
  Payment, Order, API Key, Fulfillment, and Promotion.
- Promotion owns a static manifest, package export, and manifest drift test for
  Worker-safe static composition.
- Promotion's real service path remains in use. The Cloudflare app selects the
  static manifest and Drizzle manager at the root; it does not rebuild
  Promotion service behavior.
- Promotion source files that enter the Worker graph now use relative local
  imports instead of unscoped package-local aliases such as `@models`,
  `@types`, and `@utils`.
- Promotion's MikroORM raw-filter helper remains the Node/Drizzle module-test
  behavior. The Worker app aliases only the `raw()` helper to a small
  `raw-filter-shim` that preserves the raw filter key shape consumed by the
  Drizzle repository, without bundling MikroORM.
- The combined Durable Object SQLite proof creates and lists a real Promotion
  with an application method before running the existing Cart totals and
  rollback checks from the same module set.

Validation performed:

- `@medusajs/promotion` build passed.
- Promotion static manifest test passed: 1 test.
- Existing Promotion integration suite through Drizzle/SQLite passed:
  6 suites and 178 tests.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 655 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,361.70 kB, gzip 236.52 kB.
- Cloudflare app tests passed: 2 tests.
- API Key + Fulfillment + Order + Promotion + Tax + Pricing + Payment +
  Product + Inventory + Customer + Stock Location + Region + Sales Channel +
  Store + Cart Durable Object SQLite workerd proof passed through the commerce
  module set.

Current limitations:

- This proof composes Promotion's module service and persistence path only. It
  does not solve HTTP route exposure, events, workflows, or full cart promotion
  application through checkout workflows.
- The Worker raw-filter shim is intentionally narrow: it only preserves
  MikroORM raw key string shape for the existing Promotion prefilter SQL. It is
  not a general MikroORM compatibility layer.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  module gate passes.

## Order In Worker Commerce Module Set

Commit:

- 741dd3d0f1 (`Port commerce modules to Cloudflare static runtime`)

Status:

- The Worker commerce module set now contains Currency, Cart, Store, Sales
  Channel, Region, Customer, Product, Stock Location, Inventory, Pricing, Tax,
  Payment, and Order.
- Order owns a static manifest, package export, and manifest drift test for
  Worker-safe static composition.
- Order's real service path remains in use. The Cloudflare app selects the
  static manifest and Drizzle manager at the root; it does not rebuild Order
  service behavior.
- Order's MikroORM lifecycle hook registration is isolated behind an optional
  Node-only loader so Worker imports do not statically include MikroORM.
- Order source imports that enter the Worker graph no longer depend on
  unscoped `@models` or `@types` aliases.
- The combined Durable Object SQLite proof creates and retrieves an Order with
  addresses, one item, one shipping method, and one transaction before running
  the existing Cart totals and rollback checks from the same module set.

Validation performed:

- `@medusajs/utils` build passed.
- `@medusajs/order` build passed.
- Order static manifest test passed: 1 passing.
- Existing Order integration suite through Drizzle/SQLite passed:
  77 passing.
- Cloudflare app typecheck passed.
- Composed Worker import guard passed with 587 bundled inputs.
- Portable entrypoint guard passed for `emit-events`,
  `modules-sdk/portable`, and `modules-sdk/static-app`.
- Production Worker build passed at 1,150.80 kB, gzip 202.75 kB.
- Order + Tax + Pricing + Payment + Product + Inventory + Customer + Stock
  Location + Region + Sales Channel + Store + Cart Durable Object SQLite
  workerd proof passed through the commerce module set.

Next implementation step:

- Pick the next commerce module by first running its unchanged integration
  suite through Drizzle/SQLite, then add Worker composition only after that
  gate passes.

## Index Proof Runner App Import Status

Commit:

- This commit (`Point Index proof app at relation runner`)

Status:

- The Cloudflare Index proof app now imports
  `@medusajs/index/relation-query-proof-runner` directly.
- `@medusajs/index/worker-composition` remains available as a package
  compatibility export, but `apps/medusa-cloudflare` no longer aliases or
  imports it.
- Durable Object SQLite and D1 proofs still run the same real
  `IndexModuleService.query` path through the package-owned proof runner.

Validation performed:

- `@medusajs/index` build passed.
- Existing Index SQLite integration suite passed: 19 tests.
- Cloudflare app typecheck passed after the Index build completed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Stale app import scan found no remaining
  `@medusajs/index/worker-composition` imports in `apps/medusa-cloudflare`.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.

Current limitations:

- This was an import-surface cleanup. It does not add new Index assertion
  coverage.
- The production app import graph still needs a separate audit before the full
  Worker composition can depend on Index.

Next implementation step:

- Continue the Index milestone by expanding SQLite provider behavior coverage
  against unchanged Index assertions, then return to production app
  import-graph cleanup when the provider path is stronger.

## Index SQLite Event Ingestion Status

Commit:

- This commit (`Add SQLite Index event ingestion coverage`)

Status:

- The Index SQLite integration command now runs both query-builder coverage and
  a service-level event-ingestion spec.
- The event-ingestion spec composes the real `IndexModuleService` in worker
  mode with the SQLite provider, injected event bus, and injected remote query
  double.
- Real listener registration now consumes `product.created` and
  `variant.created` events and writes Product/ProductVariant rows plus their
  parent relation into SQLite.
- The existing Durable Object SQLite and D1 relation query proofs still pass
  through the same package-owned SQLite service composition helper.

Validation performed:

- `@medusajs/index` build passed.
- Index unit suite passed: 5 suites and 31 tests.
- Expanded Index SQLite integration suite passed: 2 suites and 20 tests.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- Link attach/detach, update, delete, and sync metadata paths are still not
  covered by the SQLite event-ingestion integration runner.
- The production app import graph still needs a later audit before the full
  Worker composition can depend on Index.

Next implementation step:

- Continue the Index milestone by expanding the SQLite event-ingestion runner
  to link attach/detach and update/delete behavior from the original Index
  engine module spec.

## Index SQLite Link And Mutation Event Status

Commit:

- This commit (`Expand SQLite Index event ingestion coverage`)

Status:

- The SQLite event-ingestion runner now covers Product, ProductVariant,
  PriceSet, Price, and ProductVariant/PriceSet link events through the real
  `IndexModuleService` listener registration path.
- Link attach and detach are verified against SQLite `index_data` and
  `index_relation` rows.
- Product and ProductVariant update/delete event behavior is verified through
  the same service-level SQLite runner.
- The existing Durable Object SQLite and D1 relation query proofs still pass
  through the same package-owned SQLite service composition helper.

Validation performed:

- Expanded Index SQLite integration suite passed: 2 suites and 23 tests.
- `@medusajs/index` build passed.
- Index unit suite passed: 5 suites and 31 tests.
- Cloudflare app typecheck passed after the Index build completed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- Sync/config metadata behavior is still not covered by the SQLite integration
  runner.
- The production app import graph still needs a later audit before the full
  Worker composition can depend on Index.

Next implementation step:

- Continue the Index milestone with a narrow SQLite sync/config metadata slice.

## Index SQLite Sync Metadata GetInfo Status

Commit:

- This commit (`Add SQLite Index sync metadata coverage`)

Status:

- The Index SQLite integration command now runs query-builder coverage,
  service-level event-ingestion coverage, and read-only sync metadata coverage.
- The new sync metadata spec calls the real `IndexModuleService.getInfo()`
  method against injected metadata and sync services.
- SQLite integration coverage now includes the original getInfo cases:
  detailed metadata with last synced keys, empty metadata, and metadata without
  a sync record.
- The existing Durable Object SQLite and D1 relation query proofs still pass
  through the same package-owned SQLite service composition helper.

Validation performed:

- Expanded Index SQLite integration suite passed: 3 suites and 26 tests.
- `@medusajs/index` build passed.
- Index unit suite passed: 5 suites and 31 tests.
- Cloudflare app typecheck passed after the Index build completed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- `sync()` strategy behavior, configuration change detection, and full
  `DataSynchronizer` behavior are still not covered by the SQLite integration
  runner.
- The production app import graph still needs a later audit before the full
  Worker composition can depend on Index.

Next implementation step:

- Continue the Index milestone with a narrow SQLite `sync()` behavior slice.

## Index SQLite Server Sync Strategy Status

Commit:

- This commit (`Add SQLite Index sync strategy coverage`)

Status:

- The SQLite sync metadata spec now also covers server-mode
  `IndexModuleService.sync()` behavior.
- Continue sync marks done/error/processing metadata back to pending and emits
  `index.continue-sync`.
- Full sync marks done/error/processing metadata back to pending, clears
  non-null sync cursors, and emits `index.full-sync`.
- Reset sync calls the injected reset handler with the transaction manager and
  emits `index.reset-sync`.
- The existing Durable Object SQLite and D1 relation query proofs still pass
  through the same package-owned SQLite service composition helper.

Validation performed:

- Expanded Index SQLite integration suite passed: 3 suites and 29 tests.
- `@medusajs/index` build passed.
- Index unit suite passed: 5 suites and 31 tests.
- Cloudflare app typecheck passed after the Index build completed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- Worker-mode configuration checker behavior and full
  `DataSynchronizer.syncEntity` behavior are still not covered by the SQLite
  integration runner.
- The production app import graph still needs a later audit before the full
  Worker composition can depend on Index.

Next implementation step:

- Continue the Index milestone with worker-mode configuration checker behavior
  or a narrow `DataSynchronizer.syncEntity` SQLite slice.

## Index SQLite DataSynchronizer SyncEntity Status

Commit:

- This commit (`Add SQLite Index DataSynchronizer coverage`)

Status:

- The SQLite sync metadata spec now covers direct
  `DataSynchronizer.syncEntity` execution with the real SQLite storage
  provider.
- Product and ProductVariant pages are synced through the real synchronizer,
  and SQLite `index_data` plus `index_relation` rows are verified.
- ProductVariant parent relation rows are verified after syncing Product rows
  first, matching the original data-synchronizer integration behavior.
- The existing Durable Object SQLite and D1 relation query proofs still pass
  through the same package-owned SQLite service composition helper.

Validation performed:

- Expanded Index SQLite integration suite passed: 3 suites and 30 tests.
- `@medusajs/index` build passed.
- Index unit suite passed: 5 suites and 31 tests.
- Cloudflare app typecheck passed after the Index build completed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed after rerunning a transient Yarn startup
  failure.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- Full `DataSynchronizer.syncEntities` orchestration and worker-mode
  configuration checker behavior are still not covered by the SQLite
  integration runner.
- The production app import graph still needs a later audit before the full
  Worker composition can depend on Index.

Next implementation step:

- Continue the Index milestone with worker-mode configuration checker behavior
  or full `DataSynchronizer.syncEntities` orchestration.

## Index SQLite Worker Configuration Checker Status

Commit:

- This commit (`Add SQLite Index configuration checker coverage`)

Status:

- The SQLite sync metadata spec now covers worker-mode startup configuration
  checking through the real `IndexModuleService` startup hook.
- The SQLite composition helper can accept the real
  `indexConfigurationCheckerFactory` instead of the no-op checker used by
  proof-only composition.
- The SQLite test harness now supports the internal-service methods used by
  `Configuration.checkChanges()`.
- Startup now proves schema metadata rows and sync cursor rows are created, and
  changed metadata is handed to `DataSynchronizer.syncEntities`.
- The existing Durable Object SQLite and D1 relation query proofs still pass
  through the same package-owned SQLite service composition helper.

Validation performed:

- Expanded Index SQLite integration suite passed: 3 suites and 31 tests.
- `@medusajs/index` build passed.
- Index unit suite passed: 5 suites and 31 tests.
- Cloudflare app typecheck passed after the Index build completed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1 after
  rerunning a transient Yarn startup failure.
- `test:index-do-sqlite` passed as the compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- Full `DataSynchronizer.syncEntities` orchestration is still not covered by
  the SQLite integration runner.
- Configuration update/removal edge cases are not yet mirrored in the SQLite
  runner beyond the initial worker-startup changed-schema path.
- The production app import graph still needs a later audit before the full
  Worker composition can depend on Index.

Next implementation step:

- Continue the Index milestone with full `DataSynchronizer.syncEntities`
  orchestration.

## Index SQLite DataSynchronizer SyncEntities Status

Commit:

- This commit (`Add SQLite Index syncEntities orchestration coverage`)

Status:

- The SQLite sync metadata spec now covers the real
  `DataSynchronizer.syncEntities` orchestration path.
- Product and ProductVariant sync now runs through the orchestrator, typed
  in-memory locking module, metadata status updates, sync cursor updates, and
  SQLite stale-row cleanup.
- The test verifies final `index_data` and `index_relation` rows, lock
  acquire/release calls, `done` metadata states, and final sync cursors.
- The existing Durable Object SQLite and D1 relation query proofs still pass
  through the same package-owned SQLite service composition helper.

Validation performed:

- Expanded Index SQLite integration suite passed: 3 suites and 32 tests.
- `@medusajs/index` build passed.
- Index unit suite passed: 5 suites and 31 tests.
- Cloudflare app typecheck passed after the Index build completed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- Configuration update/removal edge cases are still not covered by the SQLite
  integration runner.
- The production app import graph still needs a later audit before the full
  Worker composition can depend on Index.
- The stale-row SQL translation lives in the SQLite integration harness only;
  a production runtime manager adapter remains a later runtime-boundary slice.

Next implementation step:

- Continue the Index milestone with SQLite configuration update/removal edge
  cases from the original `config-sync.spec.ts`.

## Index SQLite Configuration Update And Removal Status

Commit:

- This commit (`Add SQLite Index configuration update coverage`)

Status:

- The SQLite sync metadata spec now covers the original config-sync update and
  removal cases through worker-mode startup.
- Updated schema coverage verifies Product and Price are marked pending,
  unchanged entities remain done, changed sync cursors are reset, and sync is
  scheduled.
- Removed schema coverage verifies deleted metadata is removed,
  `DataSynchronizer.removeEntities` receives the stale entity set, Product
  remains done, and ProductVariant is marked pending after adding
  `description`.
- The existing Durable Object SQLite and D1 relation query proofs still pass
  through the same package-owned SQLite service composition helper.

Validation performed:

- Expanded Index SQLite integration suite passed: 3 suites and 34 tests.
- `@medusajs/index` build passed.
- Index unit suite passed: 5 suites and 31 tests.
- Cloudflare app typecheck passed after the Index build completed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed after rerunning it serially because the
  parallel proof build hit a Windows `.wrangler` cleanup race.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- The production app import graph still needs a later audit before the full
  Worker composition can depend on Index.
- The next Index item should be chosen from an explicit remaining-gap audit
  against the original Index suites.

Next implementation step:

- Audit remaining Index SQLite gaps against the original Index
  integration/unit suites.

## Index SQLite Reset Strategy Truncation Status

Commit:

- This commit (`Add SQLite Index reset truncation coverage`)

Status:

- The original Index sync suite was audited against current SQLite coverage.
  Reset-strategy table truncation was the concrete remaining sync-management
  gap.
- The SQLite sync metadata spec now covers populated reset and empty reset
  behavior through `IndexModuleService.sync({ strategy: "reset" })`.
- The SQLite integration harness now has a default reset handler that clears
  `index_data`, `index_relation`, metadata rows, and sync cursor rows.
- Custom reset-handler injection remains supported for the existing
  transaction-manager forwarding assertion.
- The existing Durable Object SQLite and D1 relation query proofs still pass
  through the same package-owned SQLite service composition helper.

Validation performed:

- Expanded Index SQLite integration suite passed: 3 suites and 36 tests.
- `@medusajs/index` build passed.
- Index unit suite passed: 5 suites and 31 tests.
- Cloudflare app typecheck passed after the Index build completed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- A final remaining-gap audit is still needed before declaring the Index SQLite
  runner behavior-complete enough to move to Worker composition/import-graph
  work.
- Production runtime reset-handler design remains a later runtime-boundary
  slice; this commit covers the package integration harness behavior.

Next implementation step:

- Run the final remaining-gap audit for the Index SQLite runner.

## Index SQLite Final Runner Gap Closure Status

Commit:

- This commit (`Close SQLite Index runner gaps`)

Status:

- The original Index suite was re-audited against the SQLite runner after reset
  truncation coverage.
- The final two missing original-suite cases are now covered:
  unordered created/attached event ingestion and explicit undefined sync
  strategy fallback.
- The SQLite runner now covers the Index behavior categories in scope for the
  provider: query-builder shared assertions, event ingestion,
  sync-management APIs, config-sync behavior, direct data synchronization, and
  `syncEntities` orchestration.
- The existing Durable Object SQLite and D1 relation query proofs still pass
  through the same package-owned SQLite service composition helper.

Validation performed:

- Expanded Index SQLite integration suite passed: 3 suites and 38 tests.
- `@medusajs/index` build passed.
- Index unit suite passed: 5 suites and 31 tests.
- Cloudflare app typecheck passed after the Index build completed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Node-only import guard passed for the isolated Index proof bundle and
  portable Index/link source paths.
- `git diff --check` passed.

Current limitations:

- The remaining Index risk is no longer a missing SQLite behavior assertion;
  it is the Worker composition/import-graph boundary.
- Test-only SQLite harness helpers must not be treated as production runtime
  adapters without a separate composition design.

Next implementation step:

- Move to the Worker composition/import-graph boundary for Index.

## Index Worker Package Export Composition Status

Commit:

- This commit (`Use package exports for Index worker proof`)

Status:

- The Cloudflare app no longer aliases Index proof imports to
  `packages/modules/index/src`.
- The isolated Worker proof resolves the Index relation proof runner and SQLite
  composition helpers through the built `@medusajs/index` package exports.
- The Worker proof bundle remains free of Node-only and MikroORM/Postgres
  imports after package export resolution.
- No test-only Index source or fixture path leaked into the built Worker proof.

Validation performed:

- `@medusajs/index` build passed.
- Index unit suite passed: 5 suites and 31 tests.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker build passed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Cloudflare Index alias guard passed.
- `git diff --check` passed.

Current limitations:

- The Worker proof still depends on the package-owned proof runner and proof
  fixture seeding. That proves package export resolution and portable bundle
  shape, but it is not yet the production Worker Index composition contract.

Next implementation step:

- Replace the proof-runner dependency with a production Worker Index
  composition boundary that accepts Cloudflare SQL executors and runtime
  services without seeding proof fixtures.

## Index Worker Composition Proof Isolation Status

Commit:

- This commit (`Split Index worker composition from proof fixtures`)

Status:

- The production Index Worker composition entrypoint no longer re-exports the
  relation query proof runner.
- The SQLite Index service composition boundary no longer imports the proof
  schema or proof joiner registration by default.
- Proof-specific schema and joiner registration are explicit in the proof
  runner and SQLite integration harness.
- A package regression now guards `worker-composition.ts` and
  `sqlite-index-service-composition.ts` from importing the proof runner or proof
  fixture graph.
- The existing workerd proof routes still pass for Durable Object SQLite and
  D1 through the same actual Index service.

Validation performed:

- Index unit suite passed: 5 suites and 32 tests.
- `@medusajs/index` build passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker build passed.
- Isolated Index proof Worker passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed for source and built
  files.
- Cloudflare Index alias guard passed.
- `git diff --check` passed.

Current limitations:

- The proof runner remains the seeded validation route for relation-query
  behavior.
- A non-proof Worker composition usage still needs to be added so the
  Cloudflare app or a package-level workerd-facing test constructs the service
  from `@medusajs/index/worker-composition` with an explicit schema and no
  fixture seeding.

Next implementation step:

- Add the first non-proof Worker Index composition usage with an explicit schema
  and no proof fixture seeding.

## Index Worker No-Seed Composition Check Status

Commit:

- This commit (`Add Index worker no-seed composition check`)

Status:

- The Cloudflare Index proof Worker now has non-proof D1 and Durable Object
  SQLite `/composition-check` routes.
- Those routes construct the real Index service through
  `@medusajs/index/worker-composition` with an explicit schema and app-local
  synthetic joiner config registration.
- The no-seed check uses a unique `WorkerCompositionProduct` entity so it is
  independent of the seeded relation-query proof data in the same SQLite
  tables.
- The Cloudflare SQLite executor now imports its Index executor value types from
  `@medusajs/index/worker-composition` instead of the storage-provider service
  subpath.

Validation performed:

- Index unit suite passed: 5 suites and 32 tests.
- `@medusajs/index` build passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker build passed.
- Isolated Index proof Worker passed seeded relation-query proofs and no-seed
  composition checks for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index app subpath guard passed.
- `git diff --check` passed.

Current limitations:

- The no-seed check proves construction/startup/querying, but it still creates
  a fresh service per proof request.
- A reusable Worker/DO runtime composition object is still needed before Index
  can back real HTTP/event paths without proof-route ownership.

Next implementation step:

- Introduce a reusable Worker Index runtime composition object that can be
  initialized once per Worker/DO lifecycle and reused by future routes/events.

## Index Worker Reusable Runtime Composition Status

Commit:

- This commit (`Reuse Index worker runtime composition`)

Status:

- The no-seed Worker composition check now runs through `IndexWorkerRuntime`
  instead of constructing the Index service directly per request.
- `IndexWorkerRuntime` lazily initializes the actual Index service once and
  reuses the service promise for later checks.
- The Durable Object proof stores the runtime on the DO instance.
- The D1 proof stores runtimes in a `WeakMap` keyed by the D1 binding object.
- The workerd validation now proves reuse by calling each composition route
  twice and asserting a stable runtime instance id plus one service
  initialization for Durable Object SQLite and D1.

Validation performed:

- Index unit suite passed: 5 suites and 32 tests.
- `@medusajs/index` build passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker build passed.
- Isolated Index proof Worker passed seeded relation-query proofs and repeated
  no-seed runtime reuse checks for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index app subpath guard passed.
- `git diff --check` passed.

Current limitations:

- The reusable runtime wrapper is still app-local and proof-schema-specific.
- A package-owned Worker runtime factory is still needed before this can back
  real HTTP/event composition outside proof routes.

Next implementation step:

- Move the reusable runtime composition shape toward a package-owned Worker
  runtime factory that accepts explicit schemas, joiner registrations, and
  runtime services.

## Index Package-Owned Worker Runtime Factory Status

Commit:

- This commit (`Add Index package worker runtime factory`)

Status:

- `@medusajs/index/worker-composition` now exports
  `SqliteIndexWorkerRuntime` and `createSqliteIndexWorkerRuntime`.
- The package runtime owns lazy real-service initialization and typed query
  forwarding.
- The Cloudflare proof app consumes the package runtime factory and only owns
  proof-specific schema/joiner config and validation metadata.
- The package runtime is included in the portable-entry regression that guards
  against Postgres/MikroORM and proof-fixture imports.

Validation performed:

- Index unit suite passed: 5 suites and 32 tests.
- `@medusajs/index` build passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker build passed.
- Isolated Index proof Worker passed seeded relation-query proofs and repeated
  no-seed runtime reuse checks through the package runtime factory for Durable
  Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index app subpath guard passed.
- `git diff --check` passed.

Current limitations:

- Runtime composition is package-owned, but the active proof still uses a
  synthetic schema and synthetic joiner config.
- A real package/module schema input path is still needed before Index Worker
  composition can back actual Medusa HTTP/event runtime paths.

Next implementation step:

- Replace the proof-only synthetic schema usage with a real package/module
  schema input path for Worker runtime composition.

## Index Worker Real Module Joiner Config Input Status

Commit:

- This commit (`Use real module joiner config for Index worker proof`)

Status:

- SQLite Index Worker composition can now receive real module joiner configs as
  typed options.
- The Cloudflare composition check uses
  `@medusajs/product/joiner-config` instead of an app-local synthetic module
  config.
- The check composes Index for the actual `ProductCategory` entity and
  `product_category` root alias.
- Workerd validation asserts the entity and alias so this path remains tied to
  real module metadata.

Validation performed:

- Index unit suite passed: 5 suites and 32 tests.
- `@medusajs/index` build passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker build passed.
- Isolated Index proof Worker passed seeded relation-query proofs plus real
  Product module joiner-config composition checks for Durable Object SQLite and
  D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index app subpath guard passed.
- `git diff --check` passed.

Current limitations:

- The real module composition proof is read-only and empty.
- A write path through real module event ingestion still needs to be proven
  without calling the relation-query proof fixture seed helper.

Next implementation step:

- Add a real module event-ingestion proof through the Worker runtime and SQLite
  provider.

## Index Worker Real Module Event Ingestion Status

Commit:

- This commit (`Add Index worker event ingestion proof`)

Status:

- The Cloudflare Index proof now starts the package-owned Index Worker runtime
  in worker mode for the ProductCategory composition path.
- The proof provides a typed event bus and Remote Query boundary, emits
  `product-category.created`, and verifies the SQLite provider writes
  `pcat_worker_index_event`.
- The event-ingestion proof runs for both Durable Object SQLite and D1.
- The route remains independent of relation-query proof fixture seeding and
  direct SQL row insertion.

Validation performed:

- Index unit suite passed: 5 suites and 32 tests.
- `@medusajs/index` build passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker build passed.
- Isolated Index proof Worker passed seeded relation-query proofs, no-seed
  runtime composition reuse checks, and real ProductCategory event-ingestion
  checks for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index app subpath guard passed.
- `git diff --check` passed.

Current limitations:

- Event bus and Remote Query dependencies are still proof-local.
- Worker runtime composition needs explicit dependency injection for real
  platform services before this can back production HTTP/event paths.

Next implementation step:

- Move event-bus and Remote Query runtime dependencies out of the proof helper
  toward explicit Worker composition dependency injection.

## Index Worker Explicit Runtime Dependencies Status

Commit:

- This commit (`Inject Index worker runtime dependencies`)

Status:

- Event bus and Remote Query dependencies are no longer created inside
  `IndexWorkerRuntime`.
- D1 Worker and Durable Object composition roots now inject proof-provided
  dependencies when constructing the Index runtime.
- The proof dependency provider is isolated in its own module, making the
  runtime helper a consumer of explicit platform services.
- Existing workerd proof coverage remains intact for seeded relation queries,
  no-seed composition reuse, and ProductCategory event ingestion.

Validation performed:

- Cloudflare app typecheck passed.
- Index unit suite passed: 5 suites and 32 tests.
- `@medusajs/index` build passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Isolated Index proof Worker build passed.
- Isolated Index proof Worker passed seeded relation-query proofs, no-seed
  runtime composition reuse checks, and real ProductCategory event-ingestion
  checks for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index app subpath guard passed.
- `git diff --check` passed.

Current limitations:

- The injected dependency provider is still proof-local.
- A reusable Worker Index dependency contract is still needed for production
  platform services.

Next implementation step:

- Introduce a reusable Worker Index composition dependency contract for event
  bus, Remote Query, schema, and joiner config inputs.

## Index Worker Dependency Contract Status

Commit:

- This commit (`Add Index worker dependency contract`)

Status:

- `SqliteIndexWorkerRuntimeDependencies` is now exported from
  `@medusajs/index/worker-composition`.
- The package-owned Worker runtime requires explicit executor, event bus,
  Remote Query, schema, and joiner config inputs.
- The Cloudflare proof dependency provider now implements the package-owned
  event bus and Remote Query dependency shape instead of an app-only runtime
  shape.
- The lower-level SQLite service composition still supports test-only optional
  defaults; the Worker runtime contract is stricter because production
  platform composition must provide real services.

Validation performed:

- `@medusajs/index` build passed.
- Cloudflare app typecheck passed.
- Index unit suite passed: 5 suites and 32 tests.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Isolated Index proof Worker build passed.
- Isolated Index proof Worker passed seeded relation-query proofs, no-seed
  runtime composition reuse checks, and real ProductCategory event-ingestion
  checks for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index app subpath guard passed.
- `git diff --check` passed.

Current limitations:

- Schema and joiner config inputs are explicit but still assembled in the
  proof app.
- A static manifest-derived Index schema/joiner input path is the next
  production-composition step.

Next implementation step:

- Move ProductCategory schema and joiner config assembly toward a
  manifest-derived Worker Index input so the app composition root supplies
  generated module metadata rather than hand-authored schema strings.

## Index Worker Manifest-Derived Schema Input Status

Commit:

- This commit (`Derive Index worker schema from static manifests`)

Status:

- The package-owned Worker composition API can now derive Index schema input
  from static module metadata through
  `createSqliteIndexWorkerStaticModuleInput`.
- The helper selects requested entity fields from the module joiner schema and
  injects `@Listeners` directives with real Medusa event names.
- The ProductCategory Worker proof uses Product module metadata for the schema
  and joiner config instead of an app-local schema string.
- Product exposes a lightweight `index-worker-static-manifest` package export
  for Index composition. This avoids importing the full Product static manifest
  into the isolated Index Worker bundle.

Validation performed:

- Product package build passed.
- Index unit suite passed: 6 suites and 34 tests.
- `@medusajs/index` build passed.
- Cloudflare app typecheck passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Isolated Index proof Worker passed seeded relation-query proofs, no-seed
  runtime composition reuse checks, and real ProductCategory event-ingestion
  checks for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index proof guard confirmed no Product full static-manifest/service runtime
  import leaked into the isolated proof.
- `git diff --check` passed.

Current limitations:

- Indexed entity and field selection is still proof-local.
- A module-owned or generated static Index manifest should become the next
  source of truth for indexed entities and fields.

Next implementation step:

- Add a reusable static Index resource manifest shape so modules can declare
  their indexed entities/fields without the Cloudflare proof app selecting them
  inline.

## Index Worker Module-Owned Entity Selection Status

Commit:

- This commit (`Move Index worker entity selection into module manifests`)

Status:

- Static module manifests can now carry Index Worker entity declarations through
  `resources.indexEntities`.
- Product's lightweight Index Worker manifest declares ProductCategory with
  indexed `id` and `name` fields.
- The Cloudflare proof app no longer contains ProductCategory field selection;
  it consumes the Product Index Worker manifest as the module-owned source of
  truth.
- The helper still supports explicit entity overrides for tests and later
  generators, but runtime composition defaults to manifest-owned declarations.

Validation performed:

- Index unit suite passed: 6 suites and 35 tests.
- Product package build passed.
- `@medusajs/index` build passed after rerunning sequentially following a
  parallel dist-clean race.
- Cloudflare app typecheck passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Isolated Index proof Worker build passed.
- Isolated Index proof Worker passed seeded relation-query proofs, no-seed
  runtime composition reuse checks, and real ProductCategory event-ingestion
  checks for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index proof guard confirmed no Product full static-manifest/service runtime
  import leaked into the isolated proof.
- Index app subpath guard passed.
- `git diff --check` passed.

Current limitations:

- ProductCategory is the only module-owned Index Worker entity declaration.
- Declared field equivalence is currently exercised through the Worker proof,
  not through a Product-owned manifest regression.

Next implementation step:

- Add a Product-owned static manifest regression proving its Index Worker
  entity declaration references fields that exist in the Product joiner schema,
  then expand the manifest shape only when another real Index entity requires
  it.

## Product Index Worker Manifest Regression Status

Commit:

- This commit (`Add Product Index worker manifest regression`)

Status:

- Product's static manifest test now validates the lightweight Product Index
  Worker manifest.
- The test confirms ProductCategory and its declared `id`/`name` Index Worker
  fields exist in the Product joiner schema.
- This gives Product ownership over its Index Worker declaration instead of
  relying only on the Cloudflare proof app to catch drift.

Validation performed:

- Focused Product static manifest suite passed: 1 suite and 2 tests.
- Product package build passed.
- `git diff --check` passed.

Current limitations:

- Only the current ProductCategory declaration is covered.
- No new Worker runtime behavior was added in this slice.

Next implementation step:

- Move from single-module manifest consumption toward a small static Index
  manifest aggregation helper that can merge multiple module-owned Index
  declarations without the Cloudflare app manually assembling them.

## Index Worker Static Manifest Aggregation Status

Commit:

- This commit (`Aggregate Index worker static manifests`)

Status:

- Index Worker composition now has a package-owned aggregate static manifest
  type and factory.
- The factory rejects duplicate module keys before schema derivation.
- The Cloudflare proof app has a single `indexWorkerStaticManifest`
  composition point, and ProductCategory input consumes that aggregate.
- Direct manifest input remains available for focused tests and future
  generated tooling.

Validation performed:

- Index unit suite passed: 6 suites and 36 tests.
- `@medusajs/index` build passed.
- Cloudflare app typecheck passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Isolated Index proof Worker passed seeded relation-query proofs, no-seed
  runtime composition reuse checks, and real ProductCategory event-ingestion
  checks for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- Index proof guard confirmed no Product full static-manifest/service runtime
  import leaked into the isolated proof.
- `git diff --check` passed.

Current limitations:

- The aggregate still contains only the Product module's ProductCategory Index
  declaration.

Next implementation step:

- Expand the static Index manifest only when a second real module/entity is
  required by the Worker composition proof; otherwise move next to reducing the
  remaining proof-local shims around event bus or Remote Query.

## Index Worker Package Event Bus Utility Status

Commit:

- This commit (`Move Index worker event bus into package`)

Status:

- The Index package now owns the Worker-safe in-memory event-bus utility used
  by `SqliteIndexWorkerRuntime` event-ingestion proofs.
- `@medusajs/index/worker-composition` exports
  `SqliteIndexWorkerEventBus` and `createSqliteIndexWorkerEventBus`.
- The Cloudflare proof dependency provider consumes the package utility instead
  of defining an app-local event bus.
- The portable-entry regression includes the new utility so it stays outside
  Postgres/MikroORM and proof-fixture import graphs.

Validation performed:

- Index unit suite passed: 7 suites and 38 tests.
- `@medusajs/index` build passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker passed seeded relation-query proofs, no-seed
  runtime composition reuse checks, and real ProductCategory event-ingestion
  checks for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- `git diff --check` passed.

Current limitations:

- The package utility is process-local and does not provide durable or
  distributed event delivery.
- Remote Query remains proof-local.

Next implementation step:

- Move or reduce the remaining Remote Query proof shim by introducing a
  package-owned proof Remote Query factory or a tighter runtime dependency
  helper.

## Index Worker Package Remote Query Utility Status

Commit:

- This commit (`Move Index worker Remote Query helper into package`)

Status:

- The Index package now owns the narrow in-memory Remote Query proof helper
  used by the Worker Index event-ingestion proof.
- `@medusajs/index/worker-composition` exports
  `createSqliteIndexWorkerRemoteQuery` plus its option and record types.
- The Cloudflare proof dependency provider now supplies ProductCategory data to
  the package helper instead of constructing a `RemoteQueryFunction` directly.
- The app no longer contains the double assertion required to satisfy the
  overloaded production Remote Query type.

Validation performed:

- Index unit suite passed: 8 suites and 42 tests.
- `@medusajs/index` build passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Cloudflare app typecheck passed after rerunning sequentially following the
  known package dist-clean race.
- Isolated Index proof Worker passed seeded relation-query proofs, no-seed
  runtime composition reuse checks, and real ProductCategory event-ingestion
  checks for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- `git diff --check` passed.

Current limitations:

- The package helper is intentionally a proof helper and only supports the
  `graph()` behavior needed by Index event rehydration.
- Production platform code must still provide a real Remote Query dependency.

Next implementation step:

- Move the remaining dependency assembly out of the proof app by introducing a
  package-owned Worker proof dependency helper, while keeping executor, module
  manifests, and proof data as explicit app inputs.

## Index Worker Package Proof Dependency Helper Status

Commit:

- This commit (`Move Index worker proof dependency assembly into package`)

Status:

- The Index package now owns the helper that pairs the Worker proof event bus
  and Worker proof Remote Query from explicit records.
- `@medusajs/index/worker-composition` exports
  `createSqliteIndexWorkerProofDependencies` plus its typed input/output
  shapes.
- The Cloudflare proof dependency provider now only supplies
  ProductCategory-specific proof data and carries the app assertion target.
- Executor bindings and static module manifests remain explicit app/platform
  inputs.

Validation performed:

- Index unit suite passed: 9 suites and 44 tests.
- `@medusajs/index` build passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker passed seeded relation-query proofs, no-seed
  runtime composition reuse checks, and real ProductCategory event-ingestion
  checks for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- `git diff --check` passed.

Current limitations:

- The helper is proof-only and intentionally does not represent production
  event delivery or Remote Query.
- ProductCategory-specific check logic remains app-owned.

Next implementation step:

- Move generic Worker runtime/check ownership toward the Index package while
  keeping ProductCategory-specific proof expectations in the app.

## Index Worker Package Proof Runtime Status

Commit:

- This commit (`Move Index worker proof runtime into package`)

Status:

- The Index package now owns generic Worker proof runtime mechanics through
  `SqliteIndexWorkerProofRuntime`.
- The package proof runtime wraps `SqliteIndexWorkerRuntime` and adds runtime
  instance IDs, service initialization counts, query result stats, and
  emit-then-query behavior.
- The Cloudflare proof app now uses the package proof runtime and only keeps
  ProductCategory-specific query inputs and response assertions.
- The portable-entry regression includes the proof runtime so it stays outside
  Node/Postgres/proof-fixture import graphs.

Validation performed:

- Index unit suite passed: 10 suites and 45 tests.
- `@medusajs/index` build passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker passed seeded relation-query proofs, no-seed
  runtime composition reuse checks, and real ProductCategory event-ingestion
  checks for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- `git diff --check` passed.

Current limitations:

- The remaining ProductCategory proof adapter is still app-owned.
- The proof runtime does not replace production platform event bus or Remote
  Query services.

Next implementation step:

- Review the remaining ProductCategory proof adapter and either keep it
  app-owned as the module-specific assertion layer or extract only another
  generic assertion helper if it removes real duplication without hiding module
  semantics.

## Index Worker Package Proof Check Helpers Status

Commit:

- This commit (`Move Index worker proof checks into package`)

Status:

- The Index package now owns generic proof checks for empty query validation
  and event-ingestion string-field validation.
- `@medusajs/index/worker-composition` exports
  `runSqliteIndexWorkerEmptyQueryCheck`,
  `runSqliteIndexWorkerEventIngestionStringCheck`, and
  `findSqliteIndexWorkerObservedStringField`.
- The Cloudflare proof app still owns ProductCategory-specific event/query
  inputs and response fields, but it no longer owns generic field-reading and
  match aggregation logic.
- The portable-entry regression includes the proof-check helper so it stays
  outside Node/Postgres/proof-fixture import graphs.

Validation performed:

- Index unit suite passed: 11 suites and 47 tests.
- `@medusajs/index` build passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker passed seeded relation-query proofs, no-seed
  runtime composition reuse checks, and real ProductCategory event-ingestion
  checks for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- `git diff --check` passed.

Current limitations:

- ProductCategory response shape remains app-owned.
- The helpers are proof utilities only.

Next implementation step:

- Move on from proof-shim reduction unless another generic behavior is
  obvious; next, inspect the remaining Index Worker composition gaps and choose
  the next real portability slice.

## Index Worker Support Joiner Manifests Status

Commit:

- This commit (`Preserve Index worker support joiner manifests`)

Status:

- Static Index Worker input now preserves support joiner configs that do not
  contribute indexed schema types.
- Link modules now expose a lightweight
  `@medusajs/link-modules/index-worker-static-manifest` entrypoint for the real
  `ProductVariantPriceSet` link joiner config.
- The Cloudflare Index Worker static manifest aggregate includes the
  ProductVariantPriceSet support manifest alongside Product.
- The Worker proof still uses ProductCategory as the real module event path,
  but the aggregate now proves support joiner configs can be carried in the
  Worker bundle without Node/MikroORM imports.

Validation performed:

- Index unit suite passed: 11 suites and 48 tests.
- `@medusajs/index` build passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Focused link-modules Index Worker manifest test passed.
- `@medusajs/link-modules` build passed.
- Cloudflare app typecheck passed.
- Isolated Index proof Worker passed seeded relation-query proofs, no-seed
  runtime composition reuse checks, and real ProductCategory event-ingestion
  checks for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as the compatibility alias.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.
- `git diff --check` passed.

Current limitations:

- The relation-query proof still uses the synthetic proof schema.
- Product/Pricing relation-query entities and extended link fields still need a
  manifest-derived schema path.

Next implementation step:

- Add module-owned Product/Pricing Index Worker relation-query entity
  declarations and handle link-extended fields such as ProductVariant prices
  without reintroducing hand-authored app schemas.

## Index Worker Product/Pricing Relation Manifest Status

Commit:

- This commit (`Derive Index relation manifests from Product and Pricing`)

Status:

- Product now declares Product, ProductVariant, and ProductCategory indexed
  entities from its package-owned Index Worker manifest.
- Pricing now exposes a package-owned
  `@medusajs/pricing/index-worker-static-manifest` entrypoint for Price.
- Static Index Worker input derives requested link-extended fields from real
  support joiner configs. `ProductVariant.prices` is now added from the
  ProductVariantPriceSet `fieldAlias` path instead of from a hand-authored app
  schema.
- The relation-query proof fixture now gets its schema and joiner configs from
  Product, Pricing, and link static manifests. It retains only legacy
  proof-local listener names to keep the existing SQLite integration event
  assertions unchanged.
- The Cloudflare Index Worker static manifest aggregate includes Product,
  Pricing, and ProductVariantPriceSet manifests.

Validation performed:

- Focused Index static input and storage-provider tests passed: 2 suites and
  24 tests.
- Product static manifest test passed.
- Pricing static manifest test passed.
- Link modules Index Worker manifest test passed.
- Product, Pricing, Link Modules, and Index builds passed.
- Index unit suite passed: 11 suites and 49 tests.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed when run sequentially.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.

Current limitations:

- The proof fixture still overrides listener names for the legacy event
  assertions. That is proof-local compatibility, not the package manifest
  default.
- The Cloudflare proof app still has ProductCategory-specific naming and
  response shaping.

Next implementation step:

- Either remove the remaining ProductCategory-specific naming from the
  Cloudflare proof input where it is generic, or add the next module-owned
  Index Worker manifest declarations needed by an actual HTTP/API route. Keep
  the slice inside Index persistence/runtime composition.

## Index Worker Generic Proof Input Lookup Status

Commit:

- This commit (`Move Index worker proof input lookup into package`)

Status:

- Required listener lookup for static Index Worker input is now package-owned
  through `getSqliteIndexWorkerRequiredEntityListener`.
- The Cloudflare proof app now imports a generic `indexWorkerInput` from
  `index-worker-input.ts`.
- ProductCategory-specific proof assertions remain in
  `index-worker-composition-check.ts`, where they still belong.

Validation performed:

- Focused Index static input and portable-entry tests passed: 2 suites and
  10 tests.
- Index build passed.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.

Current limitations:

- The Cloudflare proof app still owns ProductCategory-specific response shape.
- The next larger movement should be driven by a real Index consumer, not by
  extracting app semantics into generic package helpers.

Next implementation step:

- Inspect the real HTTP/API Product relation consumer and add only the next
  package-owned Index manifest/runtime declaration it needs, or continue
  removing generic proof plumbing from the Cloudflare app when clearly
  reusable.

## Index Worker Pricing PriceRule Relation Status

Commit:

- This commit (`Add Index pricing price rule relation manifest`)

Status:

- The next real consumer inspected was Admin product list with the Index
  feature flag enabled.
- Pricing's Index Worker manifest now declares `Price.price_rules` plus a
  package-owned `PriceRule` indexed entity.
- The relation-query proof now seeds and queries a nested PriceRule through
  Product, ProductVariant, ProductVariantPriceSet, PriceSet, and Price.
- The Worker proof script now asserts nested price-rule attribute/value for
  both Durable Object SQLite and D1.

Validation performed:

- Pricing static manifest test passed.
- Focused Index static input and storage-provider tests passed: 2 suites and
  26 tests.
- Full Index unit suite passed: 11 suites and 51 tests.
- Index build passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Pricing build passed.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Worker proof source/test leakage guard passed.
- Production composition proof-isolation guard passed.

Current limitations:

- Store product list calculated-price support is not proven by this slice.
- The next Index step should inspect whether calculated prices can be
  represented from ProductVariantPriceSet's `calculated_price` field alias, or
  whether that path must stay outside Index and be hydrated separately.

Next implementation step:

- Inspect Store product calculated-price behavior and decide/implement the
  next package-owned Index support without adding app-local pricing shims.

## Index Worker Calculated Price Alias Boundary Status

Commit:

- This commit (`Fail unresolved Index extended field aliases`)

Status:

- Store product calculated-price behavior was inspected.
- The Store product route uses `query.index` when the Index feature flag is
  enabled, but it adds `variants.calculated_price` through
  `QueryContext(req.pricingContext)`.
- Pricing treats `calculated_price` as a virtual relation: it removes the
  relation from the list config, calculates prices with pricing context, and
  attaches the result to PriceSet DTOs.
- The Index static manifest builder now rejects selected link-extended aliases
  that cannot be resolved to a real schema field or relationship. This makes
  `ProductVariant.calculated_price` an explicit unsupported Index projection
  today instead of a silently omitted field.

Validation performed:

- Focused static module input test passed: 1 suite and 9 tests.
- Full Index unit suite passed: 11 suites and 52 tests.
- Index build passed.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Cloudflare app typecheck passed after the Index package build.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Store product calculated-price support remains hydration-owned and is not
  part of the static Index projection yet.
- A future Store product Index slice must either add a real package-owned
  dynamic pricing hydration path after Index lookup, or route calculated-price
  queries through Remote Query instead of pretending this value is static
  indexed data.

Next implementation step:

- Continue the Index milestone with the next real API consumer or the next
  proof-app cleanup that removes generic composition plumbing from the app.
  Do not add Store calculated-price projection until the dynamic pricing
  boundary is designed.

## Index Worker Product Event Ingestion Status

Commit:

- This commit (`Switch Index proof event target to Product`)

Status:

- The Index Worker event-ingestion proof now uses Product instead of
  ProductCategory.
- The proof resolves the Product created event from static module input, emits
  that event through the Worker event bus, and verifies the indexed Product row
  through the Product root alias.
- The composition no-seed check still proves runtime reuse and no implicit seed
  path, but it now filters Product by a missing ID so it remains empty after
  the relation-query proof has inserted Product rows.

Validation performed:

- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- The proof response shape and target Product fixture remain app-owned proof
  semantics.

Next implementation step:

- Continue reducing generic proof-app composition or pick the next Index
  behavior required by Store/Admin product Index usage. Keep calculated price
  out of static projection until a dynamic pricing hydration design exists.

## Product Index Worker Scalar Manifest Coverage Status

Commit:

- This commit (`Expand Product Index scalar manifest fields`)

Status:

- Product's Index Worker manifest now carries the Product and ProductVariant
  scalar fields requested by Store/Admin product defaults.
- The Product static manifest test now guards those scalar fields against
  accidental regression.
- The Worker Product event-ingestion proof verifies `handle` and `external_id`
  through the Product root alias for both Durable Object SQLite and D1.

Validation performed:

- Product static manifest test passed.
- Focused Index static input, storage-provider, and proof-runtime tests passed:
  3 suites and 28 tests.
- Full Index unit suite passed: 11 suites and 52 tests.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Product build passed.
- Index build passed.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Product relation fields from Store/Admin defaults still need separate
  package-owned manifest/runtime work.
- Product `status` enum projection is not part of this proof slice.

Next implementation step:

- Continue the Product Index route coverage with package-owned relation
  manifest support for the next Store/Admin product default relation, likely
  Product type/collection/options/tags/images before returning to dynamic
  calculated price hydration.

## Product Type And Collection Index Relation Status

Commit:

- This commit (`Add Product type collection Index relations`)

Status:

- Product's Index Worker manifest now includes `collection` and `type` on
  Product, plus `ProductCollection` and `ProductType` indexed entities.
- SQLite relation planning now carries `isList` metadata.
- SQLite relation hydration/projection now returns singular relations as
  objects, which is required for Product `collection` and `type`.
- The Worker relation proof now verifies Product collection title/handle and
  Product type value through both Durable Object SQLite and D1.

Validation performed:

- Product static manifest test passed.
- Focused Index static input, storage-provider, and proof-runtime tests passed:
  3 suites and 29 tests.
- Full Index unit suite passed in-band: 11 suites and 53 tests.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Product build passed.
- Index build passed.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Product options, option values, tags, images, and variant options are still
  not proven in the Worker relation proof.
- Store calculated price remains deferred to dynamic pricing hydration.

Next implementation step:

- Continue Product route relation coverage with `options`/`options.values`,
  `tags`, `images`, or `variants.options`, keeping each slice package-owned
  and backed by the unchanged SQLite integration assertions plus Worker proof.

## Product Option And Option Value Index Relation Status

Commit:

- This commit (`Add Product option value Index relations`)

Status:

- Product's Index Worker manifest now includes `options` on Product and
  ProductVariant, plus package-owned `ProductOption` and `ProductOptionValue`
  indexed entities.
- The Worker relation proof now verifies Product option title, Product option
  value, and Variant option value through both Durable Object SQLite and D1.
- No new app-authored schema was introduced; the static input is still derived
  from the Product module's joiner schema.

Validation performed:

- Product static manifest test passed.
- Focused Index static input, storage-provider, and proof-runtime tests passed:
  3 suites and 29 tests.
- Full Index unit suite passed in-band: 11 suites and 53 tests.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Product build passed.
- Index build passed.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Product tags and images are still not proven in the Worker relation proof.
- Store calculated price remains deferred to dynamic pricing hydration.

Next implementation step:

- Continue Product route relation coverage with `tags` or `images`, keeping the
  slice package-owned and backed by SQLite integration assertions plus Worker
  proof.

## Product Tag Index Relation Status

Commit:

- This commit (`Add Product tag Index relations`)

Status:

- Product's Index Worker manifest now includes `tags` on Product plus a
  package-owned `ProductTag` indexed entity.
- The Worker relation proof now verifies Product tag value through both Durable
  Object SQLite and D1.
- No new app-authored schema was introduced; the static input is still derived
  from the Product module's joiner schema.

Validation performed:

- Product static manifest test passed.
- Focused Index static input, storage-provider, and proof-runtime tests passed:
  3 suites and 29 tests.
- Full Index unit suite passed in-band: 11 suites and 53 tests.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Product build passed.
- Index build passed.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Product images are still not proven in the Worker relation proof.
- Store calculated price remains deferred to dynamic pricing hydration.

Next implementation step:

- Continue Product route relation coverage with `images`, keeping the slice
  package-owned and backed by SQLite integration assertions plus Worker proof.

## Product Image Index Relation Status

Commit:

- This commit (`Add Product image Index relations`)

Status:

- Product's Index Worker manifest now includes `images` on Product and
  ProductVariant, plus a package-owned `ProductImage` indexed entity.
- The Worker relation proof now verifies Product image URL/rank and direct
  Variant image URL through both Durable Object SQLite and D1.
- No new app-authored schema was introduced; the static input is still derived
  from the Product module's joiner schema.

Validation performed:

- Product static manifest test passed.
- Focused Index static input, storage-provider, and proof-runtime tests passed:
  3 suites and 29 tests.
- Full Index unit suite passed in-band: 11 suites and 53 tests.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Product build passed.
- Index build passed.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Store calculated price remains deferred to dynamic pricing hydration.
- Product service's variant-image enrichment remains service-owned; static
  Index relation traversal only proves direct `ProductVariant.images` edges.

Next implementation step:

- Audit the remaining Product Index route defaults after the Product relation
  slices. Keep `variants.calculated_price` outside static projection unless a
  package-owned dynamic pricing hydration path is designed and proven.

## Product Sales Channel Index Relation Status

Commit:

- This commit (`Add Product sales channel Index relations`)

Status:

- Product route default audit found the remaining static Admin product default
  `*sales_channels`.
- Sales Channel now has a Worker-facing Index static manifest with
  `SalesChannel` fields.
- Link Modules now exposes ProductSalesChannel as a support joiner manifest.
- Product's Index Worker manifest now includes `sales_channels` on Product.
- The Worker relation proof now verifies Product sales channel name through
  both Durable Object SQLite and D1.

Validation performed:

- Product static manifest test passed.
- Sales Channel static manifest test passed.
- Link Modules Index Worker static manifest test passed.
- Focused Index static input, storage-provider, and proof-runtime tests passed:
  3 suites and 29 tests.
- Full Index unit suite passed in-band: 11 suites and 53 tests.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Product, Sales Channel, Link Modules, and Index builds passed.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Store calculated price remains deferred to dynamic pricing hydration.
- Product tag/category filters still intentionally fall back from Index in the
  Store/Admin product routes.

Next implementation step:

- Audit and document the remaining Product Index boundary around
  `variants.calculated_price` and dynamic pricing hydration. Do not add static
  calculated-price projection unless a real package-owned hydration path is
  designed and proven.

## Product Static Route Defaults Audit Status

Commit:

- This commit (`Guard Product static Index route defaults`)

Status:

- The Index unit suite now includes a real aggregate-manifest audit for the
  static Store/Admin product route defaults covered so far.
- The audit uses Product, Pricing, Sales Channel, ProductVariantPriceSet, and
  ProductSalesChannel Worker static manifests rather than an app-authored proof
  schema.
- The audit verifies static schema coverage for Product route Product,
  Variant, Collection, Type, Option, Option Value, Tag, Image, Price,
  PriceRule, and SalesChannel fields.
- The audit explicitly verifies that adding `ProductVariant.calculated_price`
  still fails static schema construction. This preserves the Medusa behavior
  where Store routes request `variants.calculated_price` through query context
  and Pricing computes it dynamically.

Validation performed:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- Index build passed.
- Cloudflare app typecheck passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.

Current limitations:

- Store calculated price remains deferred to dynamic pricing hydration.

Next implementation step:

- Continue the Index milestone by choosing the next package-owned Product route
  boundary: either design dynamic pricing hydration for Worker query execution,
  or move to the next static route/filter capability without changing
  `calculated_price` semantics.

## Product Category Index Filter Status

Commit:

- This commit (`Add Product category Index filters`)

Status:

- Product's Index Worker manifest now exposes `categories` on Product and
  schema-backed ProductCategory fields for route filtering.
- The route static defaults audit includes ProductCategory and
  `Product.categories`.
- The Worker proof now verifies Product category traversal and nested Product
  category/tag filters through both Durable Object SQLite and D1.
- Store/Admin Product list routes no longer force graph mode for tag/category
  filters when the Index feature flag is enabled.

Validation performed:

- Product static manifest test passed.
- Full Index unit suite passed in-band: 11 suites and 55 tests.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Product build passed.
- Index build passed.
- Medusa package build passed.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Store calculated price remains deferred to dynamic pricing hydration.
- ProductCategory `mpath` remains outside the Worker-facing Index manifest
  because it is absent from the Product joiner schema.

Next implementation step:

- Continue the Index milestone by auditing the next Product route gap beyond
  static relation traversal and tag/category filters. Keep
  `variants.calculated_price` separate until a real dynamic pricing hydration
  path is designed and proven.

## Product SQLite Index Search Status

Commit:

- This commit (`Add SQLite Product Index search filter`)

Status:

- SQLite Worker Index query planning now recognizes root `q` filters and keeps
  them out of direct JSON scalar SQL predicates.
- SQLite Worker Index storage applies `q` as root-row string search before
  nested filters and deferred pagination.
- The Worker proof now verifies Product `q` search through Durable Object
  SQLite and D1.

Validation performed:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Index build passed.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed after a sequential rerun;
  the first parallel run conflicted on the shared Wrangler port.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- SQLite `q` search is root-row string search, not a full joined-entity
  `document_tsv` equivalent.
- Store calculated price remains deferred to dynamic pricing hydration.

Next implementation step:

- Continue the Product Index parity audit with the next route-level gap after
  static relation filters and root `q` search. Keep calculated price isolated
  until the dynamic pricing hydration path is designed and proven.

## Admin Product Unfiltered Index Status

Commit:

- This commit (`Use Index for unfiltered Admin products`)

Status:

- Admin Product list no longer falls back to graph/refetch mode only because
  the filter object is empty when the Index feature flag is enabled.
- SQLite Worker Index now returns pagination metadata for calls with `take`
  even when `skip` is omitted.
- The Worker proof verifies unfiltered Product list execution and
  `estimate_count` through both Durable Object SQLite and D1.

Validation performed:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- Index SQLite integration suite passed: 3 suites and 38 tests.
- Index build passed.
- Medusa package build passed.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- SQLite `estimate_count` still counts the root SQL candidate set for
  post-load filters and nested ordering, not a full post-hydration result
  count.
- Store calculated price remains deferred to dynamic pricing hydration.

Next implementation step:

- Continue the Product Index parity audit with the next route-level gap after
  unfiltered Admin Product listing. Price-list filtering should be audited next
  because the existing middleware rewrites `price_list_id` to `variants.id`;
  keep calculated price isolated until a separate hydration design is accepted.

## Admin Product Price List Index Status

Commit:

- This commit (`Support SQLite Index variant id filters`)

Status:

- Admin Product `price_list_id` remains route-middleware owned: the middleware
  resolves price-list matches and rewrites the filter to `variants.id`.
- SQLite Worker Index now honors the rewritten nested `variants.id` filter with
  scalar equality and array `$in` semantics.
- The Worker proof verifies the rewritten variant-id filter through both
  Durable Object SQLite and D1.

Validation performed:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- Index SQLite integration suite passed: 3 suites and 39 tests.
- Index build passed.
- Medusa package build passed after sequential rerun.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Price-list resolution still depends on the existing route middleware and
  remote query behavior before Index receives the rewritten variant filter.
- Store calculated price remains deferred to dynamic pricing hydration.

Next implementation step:

- Audit the remaining Product Index route gap around dynamic pricing context
  and `variants.calculated_price`. Do not add static projection for calculated
  price unless a package-owned hydration design is accepted and proven.

## Query Index Calculated Price Hydration Status

Commit:

- This commit (`Guard Query Index calculated price hydration`)

Status:

- `query.index` now has a focused regression guard proving that calculated
  price fields stay out of the Index module lookup and are hydrated by
  `query.graph` with `QueryContext`.
- The guard keeps the adopted boundary explicit: Index returns Product ids,
  Remote Query hydrates Product variants, and Pricing owns
  `calculated_price`.

Validation performed:

- Focused modules-sdk `Query.index` test passed.
- Modules SDK build passed.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Validation limitation:

- The broader `medusa-cloudflare test:cart-do-sqlite` proof was attempted but
  failed before Worker startup in the Cloudflare Vite plugin module fallback for
  `packages/core/framework/dist/utils/portable.js`.

Current limitations:

- Calculated price remains dynamic graph/pricing hydration after Index lookup.
- This does not make `ProductVariant.calculated_price` a static Index
  projection field.

Next implementation step:

- Continue the Index milestone by auditing whether any Product route fields or
  filters remain outside the static Index lookup plus graph hydration split.
  Keep calculated price out of static projection.

## Product Root Array Index Filter Status

Commit:

- This commit (`Support SQLite Index root array filters`)

Status:

- SQLite Worker Index direct root filters now treat plain array values as `IN`
  filters instead of scalar equality.
- Product route shapes such as `product.id = ["prod_1"]` now work through the
  SQLite planner.
- Empty direct `$in` and `$nin` arrays are guarded before SQL generation.
- The Worker proof verifies product-id array filtering through both Durable
  Object SQLite and D1.

Validation performed:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- Index SQLite integration suite passed: 3 suites and 40 tests.
- Index build passed.
- Cloudflare app typecheck passed after the Index build completed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Validation note:

- A parallel first run of Cloudflare app typecheck raced the Index build and
  failed on missing fresh `@medusajs/index` entry declarations. The sequential
  rerun passed.

Current limitations:

- This does not add seeded coverage for every Product root scalar filter. It
  proves the root-array planning path used by those validators.
- Calculated price remains dynamic graph/pricing hydration after Index lookup.

Next implementation step:

- Continue Product route parity with remaining seeded root direct filters,
  especially Admin `status`, while keeping dynamic calculated-price hydration
  outside static Index projection.

## Admin Product Status Index Filter Status

Commit:

- This commit (`Prove SQLite Index product status filters`)

Status:

- Product status is now included in the relation proof static Product input,
  matching the real Product Index Worker static manifest.
- SQLite integration coverage now seeds Product `published` and `draft`
  statuses and verifies the Admin-style `status: ["published"]` filter.
- The Worker proof verifies the same status filter through both Durable Object
  SQLite and D1.

Validation performed:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- Index SQLite integration suite passed: 3 suites and 41 tests.
- Index build passed.
- Cloudflare app typecheck passed after the Index build completed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Validation note:

- A parallel first run of Cloudflare app typecheck raced the Index build and
  failed on missing fresh `@medusajs/index` entry declarations. The sequential
  rerun passed.

Current limitations:

- Other direct Product scalar filters remain covered by the same root direct
  planner but do not all have separate seeded route-shape tests yet.
- Calculated price remains dynamic graph/pricing hydration after Index lookup.

Next implementation step:

- Continue Product route parity with the next filter group that still needs
  seeded proof, likely transformed relation filters such as `collection_id`,
  `type_id`, `tag_id`, `category_id`, and `sales_channel_id`.

## Product Transformed Relation Index Filter Status

Commit:

- This commit (`Prove SQLite Index product relation filters`)

Status:

- SQLite integration coverage now seeds Product category, tag, and sales
  channel relations and verifies a combined relation filter matching
  route-rewritten `category_id`, `tag_id`, and `sales_channel_id` shapes.
- The Worker proof verifies the same relation filter through both Durable
  Object SQLite and D1.
- Existing relation selection behavior is preserved: selecting a relation
  scalar hydrates the related row, matching prior `product.variants.id`
  expectations.

Validation performed:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- Index SQLite integration suite passed: 3 suites and 42 tests.
- Index build passed.
- Cloudflare app typecheck passed after the Index build completed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Validation note:

- A parallel first run of Cloudflare app typecheck raced the Index build and
  failed on missing fresh `@medusajs/index` entry declarations. The sequential
  rerun passed.

Current limitations:

- Direct Product `collection_id` and `type_id` filters remain the next seeded
  proof gap.
- Calculated price remains dynamic graph/pricing hydration after Index lookup.

Next implementation step:

- Prove direct Product `collection_id` and `type_id` filters using seeded root
  fields that match Product route defaults.

## Product Direct Type And Collection Index Filter Status

Commit:

- This commit (`Prove SQLite Index product type collection filters`)

Status:

- SQLite integration coverage now seeds Product root `collection_id` and
  `type_id` values and verifies the direct route filter shape.
- The Product type/collection seed preserves Product `status` so the existing
  Admin status proof remains valid.
- The Worker proof verifies the same direct filters through both Durable Object
  SQLite and D1.

Validation performed:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- Index SQLite integration suite passed: 3 suites and 43 tests.
- Index build passed.
- Cloudflare app typecheck passed after the Index build completed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Validation note:

- A parallel first run of Cloudflare app typecheck raced the Index build and
  failed on missing fresh `@medusajs/index` entry declarations. The sequential
  rerun passed.

Current limitations:

- Other scalar Product filters still share the same direct root planner path
  but do not all have separate seeded route-shape tests.
- Calculated price remains dynamic graph/pricing hydration after Index lookup.

Next implementation step:

- Audit the remaining Product route filter/default set against current proof
  coverage and identify whether another missing concrete Index behavior remains
  before moving beyond Product route parity.

## Product Direct Scalar And Operator Index Filter Status

Commit:

- This commit (`Prove SQLite Index product scalar filters`)

Status:

- Product route scalar fields `handle`, `external_id`, `is_giftcard`,
  `created_at`, `updated_at`, and `deleted_at` are now present in the relation
  proof static Product input.
- SQLite integration coverage verifies direct route scalar filters for handle,
  external id, boolean gift-card state, and timestamp range operators.
- The Worker proof verifies the same scalar/operator filter shape through both
  Durable Object SQLite and D1.
- SQLite sync metadata expectations now track the expanded Product static field
  set.

Validation performed:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- Index SQLite integration suite passed: 3 suites and 44 tests.
- Index build passed.
- Cloudflare app typecheck passed after the Index build completed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Validation notes:

- A parallel first run of Cloudflare app typecheck raced the Index build and
  failed on missing fresh `@medusajs/index` entry declarations. The sequential
  rerun passed.
- The first workerd proof run exposed that Product `q` search uses every string
  root field. The second product timestamp seed was adjusted to avoid an
  accidental `q: "Product 1"` match while preserving current broad search
  behavior.

Current limitations:

- Calculated price remains dynamic graph/pricing hydration after Index lookup.

Next implementation step:

- Re-audit Product route parity now that direct scalar, root array,
  transformed relation, status, type, and collection filters all have SQLite
  and workerd proof coverage. If no Product route behavior gap remains, move to
  the next Index-owned boundary rather than adding duplicate Product tests.

## Product Variant Route Index Filter Status

Commit:

- This commit (`Prove SQLite Index product variant route filters`)

Status:

- ProductVariant route fields `created_at`, `updated_at`, and `deleted_at` are
  now present in the relation proof static ProductVariant input.
- SQLite integration coverage verifies a nested variant filter combining a
  timestamp range with `variants.options.value` and
  `variants.options.option_id`.
- The Worker proof verifies the same nested variant route filter through both
  Durable Object SQLite and D1.
- SQLite sync metadata expectations now track the expanded ProductVariant
  static field set.

Validation performed:

- Full Index unit suite passed in-band: 11 suites and 55 tests.
- Index SQLite integration suite passed: 3 suites and 45 tests.
- Index build passed.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed.
- Portable entrypoint guard passed.
- Real module import audit passed.

Current limitations:

- Calculated price remains dynamic graph/pricing hydration after Index lookup.

Next implementation step:

- Re-audit Product route parity. If no concrete Product route behavior gap
  remains, move to the next Index-owned boundary rather than adding duplicate
  Product tests.

## Index Worker Event Lifecycle Proof Status

Commit:

- This commit (`Prove SQLite Index worker event lifecycle`)

Status:

- The Index Worker proof now resolves Product `created`, `updated`, and
  `deleted` listeners from the existing static manifest.
- Shared package-owned proof logic emits create/update/delete events through
  the actual worker event bus and verifies the SQLite storage provider's
  persisted state after each phase.
- The proof dependency remote query supports a mutable record source so update
  and delete still read through `query.graph` exactly like the worker
  `consumeEvent` path.
- Both Durable Object SQLite and D1 workerd proofs now assert create, update,
  and delete event behavior.

Validation performed:

- Full Index unit suite passed in-band: 11 suites and 58 tests.
- Index SQLite integration suite passed: 3 suites and 45 tests.
- Index build passed.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed with 1527 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

Validation note:

- Stale guard script names `test:portable-imports` and `test:index-imports`
  do not exist in this app. The current guard scripts are `check:imports`,
  `check:portable-entrypoints`, and `check:real-module-imports`.

Current limitations:

- Product route Index parity appears covered by the current proof matrix.
- Attach/detach relation event proof remains outside this slice.

Next implementation step:

- Re-audit Index-owned remaining gaps after Product route parity and worker
  Product event lifecycle proof. Avoid rerunning Product/Cart/Fulfillment or
  other already-covered suites unless a touched code path requires it.

## Index Worker Link Attach Detach Proof Status

Commit:

- This commit (`Prove SQLite Index worker link attach detach`)

Status:

- The workerd Index proof now exercises
  `LinkProductVariantPriceSet.attached` and
  `LinkProductVariantPriceSet.detached` through the actual Worker event bus and
  SQLite storage provider subscriber path.
- The attach phase proves that the link event creates the relation rows needed
  for `product.variants.prices` traversal.
- The detach phase proves the same nested Product/Variant/Price filter returns
  no rows after the link event is consumed.
- The proof runs against both Durable Object SQLite and D1.

Validation performed:

- Full Index unit suite passed in-band: 11 suites and 59 tests.
- Index SQLite integration suite passed: 3 suites and 45 tests.
- Index build passed.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed after the Index build
  completed.
- Worker bundle Node-only import guard passed with 1527 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

Validation notes:

- SQLite nested-filter count metadata is not used for the detach assertion
  because count SQL is computed before deferred nested relation pruning.
- A parallel first run of `medusa-cloudflare test:index-do-sqlite` raced the
  package build and failed on a transient missing
  `@medusajs/index/relation-query-proof-runner` dist subpath. The sequential
  rerun passed.

Current limitations:

- The proved link path is ProductVariantPriceSet. Other link module event
  proofs are not added unless a future Index slice needs them.

Next implementation step:

- Re-audit Index completion against the current proof matrix and identify the
  next concrete unproved Index behavior. Do not add broad duplicate proofs for
  Product route filters, Product lifecycle events, or ProductVariantPriceSet
  attach/detach unless new code touches those paths.

## SQLite Index Post-Load Count Metadata Status

Commit:

- This commit (`Fix SQLite Index post-load count metadata`)

Status:

- SQLite Index pagination metadata now counts the post-load filtered root
  result set when pagination is deferred.
- This fixes inaccurate `estimate_count` values for `q`, deep root filters,
  nested object filters, and nested relation filters.
- Direct SQL-filter paths continue to use SQL count.
- The ProductVariantPriceSet attach/detach workerd proof again uses pagination
  on the detached nested relation query and now asserts `estimate_count: 0`.

Validation performed:

- Full Index unit suite passed in-band: 11 suites and 59 tests.
- Index SQLite integration suite passed: 3 suites and 45 tests.
- Index build passed.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- Worker bundle Node-only import guard passed with 1527 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

Current limitations:

- Join filters still prune joined relation arrays without removing root rows.
  This is unchanged behavior and was not part of this count fix.

Next implementation step:

- Re-audit Index completion after the count-metadata fix. Continue only with a
  concrete unproved Index behavior or a real app-local proof shim that blocks
  treating Index as finished.

## Index Worker Product Proof Runtime Ownership Status

Commit:

- This commit (`Move Index worker product proof runtime into package`)

Status:

- Product lifecycle and ProductVariantPriceSet attach/detach proof runtime
  behavior has moved from `apps/medusa-cloudflare` into
  `@medusajs/index/worker-composition`.
- The app now wraps `SqliteIndexWorkerProductProofRuntime` with its static
  manifest input and generated event names.
- The app proof remains responsible for Cloudflare endpoints and executor
  bindings only.

Validation performed:

- Full Index unit suite passed in-band: 11 suites and 59 tests.
- Index SQLite integration suite passed: 3 suites and 45 tests.
- Index build passed.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed with 1528 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.
- `git diff --check` passed.

Current limitations:

- This does not turn the proof runtime into production infrastructure. Real
  Worker deployments still provide production Event Bus and Remote Query
  services at the application/platform root.

Next implementation step:

- Re-audit Index completion after moving the Product/link proof runtime into
  the package. Continue only with a concrete unproved behavior or a remaining
  proof shim that prevents the app from staying a thin composition root.

## Index Worker Product Proof Event Resolution Status

Commit:

- This commit (`Move Index worker product proof events into package`)

Status:

- Product/link proof event resolution has moved from the Cloudflare app into
  `@medusajs/index/worker-composition`.
- `SqliteIndexWorkerProductProofRuntime` now derives default Product
  created/updated/deleted and ProductVariantPriceSet attached/detached event
  names from the static input.
- The app `index-worker-input.ts` only builds the static module input.

Validation performed:

- Full Index unit suite passed in-band: 12 suites and 61 tests.
- Index SQLite integration suite passed: 3 suites and 45 tests.
- Index build passed.
- Cloudflare app typecheck passed after the Index package build completed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed with 1528 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.
- `git diff --check` passed.

Validation note:

- A parallel first run of Cloudflare app typecheck raced the Index package
  build and failed on transient missing package `dist` subpaths. The
  sequential rerun passed.

Current limitations:

- The package helper is still a proof helper, not a production event naming
  abstraction.

Next implementation step:

- Re-audit Index completion after moving Product/link proof event resolution
  into the package. Continue only with a concrete unproved behavior or a
  remaining app-local proof shim.

## Index Worker Product Proof Dependency Ownership Status

Commit:

- This commit (`Move Index worker proof dependencies into package`)

Status:

- Product/link proof fixtures and mutable proof dependency assembly have moved
  from the Cloudflare app into `@medusajs/index/worker-composition`.
- The package now exports
  `createSqliteIndexWorkerProductProofDependencies` plus the default Product
  and ProductVariantPriceSet proof targets.
- `apps/medusa-cloudflare/src/index-worker-proof-dependencies.ts` is now a
  compatibility alias layer around the package-owned helper.

Validation performed:

- Full Index unit suite passed in-band: 12 suites and 62 tests.
- Index build passed.
- Index SQLite integration suite passed: 3 suites and 45 tests.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed with 1528 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.
- `git diff --check` passed.

Current limitations:

- The package helper is still a proof helper, not production runtime
  dependency injection.

Next implementation step:

- Re-audit Index completion after moving Product/link proof dependencies into
  the package. Continue only with a concrete unproved behavior or a remaining
  app-local proof shim that prevents the app from staying a thin composition
  root.

## Index Worker Proof App Shim Removal Status

Commit:

- This commit (`Compose Index worker proof runtime directly`)

Status:

- The Cloudflare Index proof app now imports
  `SqliteIndexWorkerProductProofRuntime` and
  `createSqliteIndexWorkerProductProofDependencies` directly from
  `@medusajs/index/worker-composition`.
- The app-local `index-worker-composition-check.ts` runtime subclass and
  `index-worker-proof-dependencies.ts` alias file were removed.
- The remaining app-owned Index proof files are limited to Cloudflare endpoint
  routing, executor bindings, and static manifest/input selection.

Validation performed:

- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed with 1526 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

Current limitations:

- This does not make the proof endpoints production runtime infrastructure.
  It only removes proof-local app wrappers that duplicated package ownership.

Next implementation step:

- Perform an Index completion audit against current evidence before adding
  more Index behavior. If no concrete unproved behavior remains, record the
  Index milestone status instead of adding duplicate Product/link tests.

## SQLite Index Milestone Completion Audit

Commit:

- This commit (`Record SQLite Index completion audit`)

Status:

- The current SQLite Index persistence and Worker proof milestone is complete.
- No concrete unproved Index behavior remains in the accepted proof matrix.
- Do not add more Product route, Product lifecycle, or
  ProductVariantPriceSet attach/detach tests unless a later change touches
  those paths or a new real route gap is identified.

Evidence:

- SQLite Index package unit suite passed in-band: 12 suites and 62 tests.
- Index package build passed.
- SQLite Index integration suite passed: 3 suites and 45 tests.
- Cloudflare app typecheck passed.
- `medusa-cloudflare test:index-sqlite` passed.
- `medusa-cloudflare test:index-do-sqlite` passed.
- Worker bundle Node-only import guard passed with 1526 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

Completed Index behavior:

- SQLite storage mutation, relation, query, sync metadata, reset, and
  post-load count behavior are covered by the package unit and SQLite
  integration suites.
- Product route Index parity is covered for route defaults, root array
  filters, `q` search, status, transformed relation filters, direct
  collection/type filters, scalar/operator filters, and nested variant filters.
- Dynamic `variants.calculated_price` remains explicitly outside static Index
  projection and is delegated to graph/pricing hydration after Index lookup.
- Worker proof validates Durable Object SQLite and D1 composition, no-seed
  runtime checks, Product create/update/delete event ingestion, and
  ProductVariantPriceSet attach/detach relation events.
- Product/link proof runtime, event resolution, fixtures, and dependency
  assembly are package-owned under `@medusajs/index/worker-composition`.
- The Cloudflare app owns only proof HTTP routing, Cloudflare executor
  bindings, and static manifest/input selection for this Index proof.

Out of scope for this milestone:

- Production Cloudflare HTTP bootstrap.
- Production Event Bus and Remote Query service implementations.
- Static projection of dynamic Pricing calculated-price fields.
- Expanding Index proof coverage to unrelated modules without a concrete route
  or behavior gap.

Next implementation step:

- Leave the Index milestone and choose the next non-Index Cloudflare port
  boundary from the roadmap. If a later slice changes Index code, rerun the
  relevant Index package suite, workerd proof, and import guards.

## Commerce Module Set Completion Audit

Commit:

- This commit (`Record commerce module set completion audit`)

Status:

- The current Worker commerce/runtime module set is complete for the accepted
  Durable Object SQLite proof matrix.
- The composed runtime includes real module services for Analytics, API Key,
  Auth, Cart, Caching, Currency, Customer, Event Bus, File, Fulfillment,
  Inventory, Locking, Notification, Order, Payment, Pricing, Product,
  Promotion, RBAC, Region, Sales Channel, Settings, Stock Location, Store,
  Tax, Translation, User, and Workflow Engine.
- The proof still runs through a thin Cloudflare application root that selects
  static manifests, bindings, the Drizzle manager, Queue Event Bus, Durable
  Object Locking provider, and Workflow stores. It does not replace Medusa
  module services with app-local services.

Validation performed:

- `yarn workspace medusa-cloudflare test:cart-do-sqlite` passed against the
  built Worker served by Wrangler. The proof executed the full current module
  set, Cart totals, serialized Durable Object locking, Queue dispatch,
  Workflow execution persistence, Workflow schedule persistence, alarm
  recovery, and atomic rollback.
- `yarn workspace medusa-cloudflare typecheck` passed.
- Worker bundle Node-only import guard passed with 1532 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.
- Current Product Drizzle module selector was also rechecked and all Product
  integration specs passed under `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`: 10
  suites, 205 passing, 1 skipped.

Accepted boundary:

- Do not keep looping through completed Product/Cart/Order/Promotion/Index
  module gates unless a later change touches those modules or a concrete
  behavior gap is found.
- The current proof validates module composition and representative service
  behavior. It does not make the Cloudflare app a production platform runtime.

Next implementation step:

- Move to the next non-module-gate Cloudflare runtime boundary: production HTTP
  bootstrap, production Remote Query/Event Bus composition, or hosted
  platform routing. Start with the smallest boundary that can keep existing
  Medusa handlers/services in place.

## Cloudflare HTTP Route Revalidation Completion Audit

Commit:

- This commit (`Record HTTP route revalidation completion audit`)

Status:

- The current route-by-route Cloudflare HTTP revalidation pass is complete for
  the existing `integration-tests/http/__tests__/**/*.spec.ts` tree.
- A current audit compared the HTTP integration spec file tree against recorded
  Cloudflare runtime `testPathPattern` entries and found no obvious unrecorded
  full spec path.
- Completed HTTP route files should not be rerun or expanded again without a
  route-touching code change or concrete uncovered behavior.

Validation performed:

- Current-state spec coverage audit over
  `integration-tests/http/__tests__/**/*.spec.ts` reported no unmatched spec
  paths against `plan/fork-changes/api-integration-test-runner.md`.

Accepted boundary:

- The existing Cloudflare HTTP proof validates the current API route surface
  covered by unchanged integration assertions.
- It does not yet make the Cloudflare app a production HTTP bootstrap.

Next implementation step:

- Start the production HTTP bootstrap milestone with the smallest slice that
  moves proof-only app glue into shared Medusa package composition while
  preserving existing handlers, static manifests, the Fetch adapter, and the
  current integration-test runner.

## Cloudflare HTTP Runtime Entrypoint

Commit:

- This commit (`Start production HTTP runtime entrypoint`)

Status:

- The Cloudflare Worker now routes package-owned static HTTP requests through a
  neutral `cloudflare-http-runtime.ts` entrypoint.
- The old `static-http-proof.ts` module remains only as a compatibility alias.
- Handler construction still uses the shared
  `@medusajs/medusa/static/fetch-http-handler` package entrypoint and existing
  static manifests.
- This is the first production HTTP bootstrap slice after completing
  route-by-route HTTP revalidation.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1582
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "executes static HTTP resources|executes a real Medusa route"`
  passed all 16 Worker tests.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.

Next implementation step:

- Continue reducing proof-only ownership around the Cloudflare HTTP runtime
  while preserving existing Medusa handlers, static manifests, and Fetch
  adapter behavior.

## Cloudflare HTTP Proof Runtime Options Split

Commit:

- This commit (`Split HTTP proof runtime options`)

Status:

- The Cloudflare HTTP runtime entrypoint now exposes a reusable
  `createMedusaCloudflareHttpRuntime(options)` factory.
- Proof-only runtime options now live under
  `apps/medusa-cloudflare/src/http-proof/runtime-options.ts`.
- The current Worker still uses those proof options, but the proof fixture
  bundle is now explicit and replaceable.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1583
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "executes static HTTP resources|executes a real Medusa route"`
  passed all 16 Worker tests.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.

Next implementation step:

- Introduce a production-oriented Cloudflare HTTP composition option path that
  can eventually replace proof options with real request-scope, session/auth,
  Remote Query, and module-runtime bindings.

## Cloudflare HTTP Production Options Boundary

Commit:

- This commit (`Add Cloudflare HTTP production options boundary`)

Status:

- A production-oriented Cloudflare HTTP options builder now exists at
  `apps/medusa-cloudflare/src/cloudflare-http-options.ts`.
- The builder requires `createRequestScope` and excludes proof setup hooks.
- The Worker still uses the isolated proof options, but there is now a typed
  path for replacing them with real runtime hooks incrementally.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1584
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "executes static HTTP resources|executes a real Medusa route"`
  passed all 16 Worker tests.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.

Next implementation step:

- Implement the first real production hook behind this boundary, starting with
  request-scope composition over the existing Cloudflare module runtime.

## Cloudflare HTTP Request Scope Factory

Commit:

- This commit (`Add Cloudflare HTTP request scope factory`)

Status:

- Added a Worker-compatible request-scope factory that creates Medusa request
  scopes from a shared Medusa container.
- The real Cloudflare commerce module runtime now exposes its shared container
  for future HTTP runtime composition.
- The Worker remains on proof HTTP options until a real module-runtime source
  is available for production HTTP requests.

Validation performed:

- `cmd /c yarn workspace @medusajs/framework build` passed.
- `cmd /c yarn workspace @medusajs/types build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1585
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "createMedusaCloudflareRequestScopeFactory|executes static HTTP resources|executes a real Medusa route"`
  passed 17 tests across the Worker spec and request-scope spec.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.

Next implementation step:

- Add a real module-runtime source for production HTTP requests, then use this
  request-scope factory in a production HTTP options instance.

## Cloudflare HTTP Module Runtime Options Source

Commit:

- This commit (`Add HTTP module runtime options source`)

Status:

- Added `createMedusaCloudflareHttpRuntimeOptionsFromModuleRuntime(...)`.
- The production HTTP options path can now consume a real Cloudflare commerce
  module runtime container and derive `createRequestScope` from it.
- The Worker still uses proof HTTP options until a concrete Worker-side module
  runtime source is selected and wired.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- Focused Worker/request-scope test command passed 18 tests.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1585
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare test` passed 18 tests.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.

Next implementation step:

- Add the first Worker-side module runtime source for HTTP requests, with an
  explicit storage/tenant binding decision instead of hiding it inside the
  request-scope hook.

## Cloudflare HTTP Worker Module Runtime Source

Commit:

- This commit (`Add HTTP Worker module runtime source`)

Status:

- Added `createMedusaCloudflareHttpModuleRuntimeSource(...)`.
- The source lazily creates and caches a module runtime from an explicit
  Drizzle manager plus Cloudflare module runtime options.
- Production Fetch HTTP options can now be derived from that runtime's shared
  Medusa container without moving tenant or storage selection into the
  request-scope hook.
- The Worker default remains the proof HTTP options path; route behavior did
  not change.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "request scope|production HTTP options|module runtime source"`
  passed 19 tests across the Worker spec and request-scope spec.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1586
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed. The
  script logged expected timeout proof errors for recovery scenarios while
  exiting successfully.
- `git diff --check` passed.

Next implementation step:

- Add a non-default Worker HTTP composition proof that uses the production
  source with an explicit storage binding, or first fill the missing
  request/session/auth and Remote Query bindings if that proof exposes a
  concrete adapter gap.

## Cloudflare HTTP Production Source DO Proof

Commit:

- This commit (`Prove HTTP production source in Cart DO`)

Status:

- Added `/do-cart/:id/http-production-options-proof` to the Cart DO proof.
- The endpoint builds production Fetch HTTP options through
  `createMedusaCloudflareHttpModuleRuntimeSource(...)` using the Cart DO's
  explicit SQLite manager and Cloudflare runtime bindings.
- The proof verifies the static Fetch handler recognizes `/admin/plugins` and
  the production request scope resolves the real Cart module service from the
  DO-backed commerce runtime.
- The default Worker HTTP handler still uses proof HTTP options. No route
  behavior changed.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "module runtime source|executes static HTTP resources|executes a real Medusa route"`
  passed 19 tests across the Worker spec and request-scope spec.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1586
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed. The
  script now asserts the production source proof endpoint and logs expected
  timeout proof errors for recovery scenarios while exiting successfully.

Next implementation step:

- Add explicit production HTTP request/session/auth or Remote Query bindings
  over this source before switching the Worker default away from proof HTTP
  options.

## Shared HTTP Request Setup Core

Commit:

- This commit (`Share HTTP request setup core`)

Status:

- Added shared HTTP helpers for request-scope creation, request id assignment,
  and request context merging in `@medusajs/framework/http`.
- Updated the Express loader to use the shared helper while preserving existing
  middleware order and behavior.
- Updated the Cloudflare request-scope factory to use the same scope creation
  helper.

Validation performed:

- `cmd /c yarn workspace @medusajs/framework build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "request scope|module runtime source|executes static HTTP resources|executes a real Medusa route"`
  passed 19 tests across the Worker spec and request-scope spec.
- `cmd /c node ..\..\..\node_modules\jest\bin\jest.js --runTestsByPath src\http\__tests__\request-context.spec.ts --runInBand`
  passed the focused framework request-context tests.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1586
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed. The
  script logs expected timeout proof errors for recovery scenarios while
  exiting successfully.
- `git diff --check` passed.

Next implementation step:

- Extract the next concrete HTTP bootstrap primitive only when both Express and
  Fetch paths need it. The next likely candidate is request/session/auth or
  Remote Query binding over the production HTTP source.

## Shared Fetch Auth Session Hooks

Commit:

- This commit (`Share Fetch auth session hooks`)

Status:

- Added `createCookieBackedFetchAuthSessionHooks(...)` and
  `getFetchCookieValue(...)` to the portable framework HTTP Fetch boundary.
- Moved cookie-backed Fetch auth-session creation, commit, destroy-cookie, and
  auth-context validation out of the Cloudflare proof resources.
- The Cloudflare proof app still owns its in-memory proof store. This does not
  introduce durable session storage or switch the default Worker HTTP runtime.

Validation performed:

- `cmd /c node ..\..\..\node_modules\jest\bin\jest.js --runTestsByPath src\http\__tests__\fetch-session.spec.ts --runInBand`
  passed.
- `cmd /c yarn workspace @medusajs/framework build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "Auth session|auth|request scope"`
  passed 19 tests across the Worker spec and request-scope spec.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1587
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed. The
  script logs expected timeout proof errors for recovery scenarios while
  exiting successfully.
- `git diff --check` passed.

Next implementation step:

- Use the shared Fetch auth-session hooks from the production HTTP source when
  a real durable/session store boundary is introduced. Until then, keep the
  proof store app-local and continue extracting only concrete HTTP bootstrap
  behavior needed by both Express and Fetch.

## Durable Object Fetch Auth Session Store Proof

Commit:

- This commit (`Prove production Fetch sessions with DO storage`)

Status:

- Added `DurableObjectSqliteFetchAuthSessionStore` in the Cloudflare app.
- The store implements the shared Fetch auth-session store contract and
  persists `auth_context` rows in Durable Object SQLite.
- The Cart DO production HTTP source now passes durable `createSession` and
  `commitSession` hooks into `createMedusaCloudflareHttpModuleRuntimeSource`.
- The Cart DO production-options proof creates, reads, and destroys a Fetch
  session through the real handler, then asserts the DO SQLite session store is
  empty after destroy.
- The default Worker HTTP handler still uses proof runtime options.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "module runtime source|request scope"`
  passed 19 tests across the Worker spec and request-scope spec.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed. The
  script now asserts the production HTTP source composes with the DO-backed
  session store. It still logs expected timeout proof errors for recovery
  scenarios while exiting successfully.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1588
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `git diff --check` passed.

Next implementation step:

- Add the next missing production HTTP source boundary before switching the
  default Worker handler. The likely candidate is a production-safe request
  preparation/auth bridge or Remote Query binding, depending on which real
  Medusa route is used as the next proof.

## Static Remote Query Direct Entrypoint Proof

Commit:

- This commit (`Prove production Remote Query route`)

Status:

- `@medusajs/modules-sdk/static-app` now registers a Worker-safe direct
  entrypoint Remote Query function from static module joiner configs and loaded
  module services.
- The Cart DO production HTTP options proof now exercises the real
  `GET /store/currencies` Medusa route through the Fetch handler, query
  validation middleware, and `remoteQueryObjectFromString`.
- The proof seeds the required `usd` currency row through the unchanged
  Currency module service in the same DO SQLite-backed commerce runtime.
- The default Worker HTTP handler remains on proof runtime options; this is a
  production-source proof, not a global HTTP switch.

Validation performed:

- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed. The
  script logs expected timeout proof errors for recovery scenarios while
  exiting successfully.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1588
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed,
  including `@medusajs/modules-sdk/static-app` with 42 bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `git diff --check` passed.

Next implementation step:

- Continue the production HTTP source milestone with the next real route proof
  that exposes either request/auth preparation or broader Remote Query graph
  behavior before switching the default Worker handler.

## Static Query Graph Direct Entrypoint Proof

Commit:

- This commit (`Prove production Query graph route`)

Status:

- `@medusajs/modules-sdk/static-app` now registers a minimal Worker-safe
  `ContainerRegistrationKeys.QUERY` service with direct-entrypoint
  `graph(...)` support.
- The implementation reuses static module joiner aliases and loaded module
  services. It does not import the full Node-oriented Query/Remote Query graph.
- The Cart DO production HTTP options proof now exercises the real
  `GET /store/product-types` Medusa route through the Fetch handler, query
  validation middleware, and `QUERY.graph`.
- The proof seeds a Product Type through the unchanged Product module service
  in the same DO SQLite-backed commerce runtime.
- The default Worker HTTP handler remains on proof runtime options; this is a
  production-source proof, not a global HTTP switch.

Validation performed:

- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed. The
  script logs expected timeout proof errors for recovery scenarios while
  exiting successfully.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1588
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed,
  including `@medusajs/modules-sdk/static-app` with 42 bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `git diff --check` passed.

Next implementation step:

- Continue the production HTTP source milestone with either request/auth
  preparation on a protected route or graph behavior beyond direct module
  entrypoints.

## Query Input Normalization Extraction

Commit:

- This commit (`Extract Query input normalization`)

Status:

- Added a shared `normalizeQueryConfig(...)` helper under
  `packages/core/modules-sdk/src/remote-query/`.
- The existing `Query` class now delegates input normalization to that helper.
- Runtime behavior is intentionally unchanged; this is the first slice toward
  replacing the temporary static Query bridge with shared Query runtime code.

Validation performed:

- Focused Remote Query Jest files passed:
  - `src/__tests__/remote-query.spec.ts`
  - `src/remote-query/__tests__/to-remote-query.ts`
  - `src/remote-query/__tests__/query-index.spec.ts`
- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed.

Next implementation step:

- Turn 2 of `plan/roadmaps/portable-query-runtime-goal.md`: move the
  direct-entrypoint executor from `static-app.ts` into shared Query runtime
  code and keep the Cart DO production HTTP proofs passing.

## Direct Query Entrypoint Executor Extraction

Commit:

- This commit (`Extract direct Query entrypoint executor`)

Status:

- Added shared `executeDirectEntrypointQuery(...)` support under
  `packages/core/modules-sdk/src/remote-query/`.
- `static-app.ts` still derives direct entrypoints from static module joiner
  aliases and loaded services, but it no longer owns the direct service method
  execution logic.
- Direct `REMOTE_QUERY` and direct `QUERY.graph(...)` Worker proofs continue
  to use the same static manifests and unchanged module services.
- The implementation remains intentionally limited to direct entrypoints.
  Relation traversal, link traversal, index hydration, and full RemoteJoiner
  behavior are still future Query-runtime turns.

Validation performed:

- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed. The
  script logs expected timeout proof errors for workflow recovery scenarios
  while exiting successfully.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1589
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed,
  including `@medusajs/modules-sdk/static-app` with 43 bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace @medusajs/medusa build` passed.

Next implementation step:

- Turn 3 of `plan/roadmaps/portable-query-runtime-goal.md`: introduce a
  shared portable Query registration factory and reduce
  `registerStaticRemoteQuery(...)` to a static-manifest compatibility wrapper.

## Portable Query Runtime Factory

Commit:

- This commit (`Add portable Query runtime factory`)

Status:

- Added shared `createPortableQueryRuntime(...)` support under
  `packages/core/modules-sdk/src/remote-query/`.
- The shared factory now creates both the direct `remoteQuery(...)` function
  and the direct `query.graph(...)` service used by the Worker production
  source proofs.
- `static-app.ts` no longer owns direct Query runtime construction. It only
  derives entries from static module joiner aliases and registers the shared
  runtime outputs under `REMOTE_QUERY` and `QUERY`.
- The factory remains intentionally limited to direct entrypoints. Relation
  traversal, link traversal, index hydration, and full RemoteJoiner behavior
  remain future portable Query runtime turns.

Validation performed:

- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed. The
  script logs expected timeout proof errors for workflow recovery scenarios
  while exiting successfully.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1590
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed,
  including `@medusajs/modules-sdk/static-app` with 44 bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace @medusajs/medusa build` passed.

Next implementation step:

- Turn 4 of `plan/roadmaps/portable-query-runtime-goal.md`: split Node Query
  runtime entrypoints from portable Query runtime entrypoints, keeping the
  full `RemoteQuery`/RemoteJoiner graph out of Worker-safe imports.

## Portable Query Entrypoint Split

Commit:

- This commit (`Split portable Query runtime entrypoint`)

Status:

- Added explicit package exports for
  `@medusajs/modules-sdk/remote-query/portable`,
  `@medusajs/modules-sdk/remote-query/node`, and the compatibility
  `@medusajs/modules-sdk/remote-query` entrypoint.
- The portable entrypoint exports only the direct-entrypoint executor and
  portable Query runtime factory.
- The node entrypoint keeps the existing `Query` and `RemoteQuery` classes
  available for Node `MedusaApp` usage.
- `static-app.ts` now imports Query runtime pieces through the portable
  entrypoint rather than direct implementation files.
- The portability guard now bundles and checks the portable Query entrypoint
  directly.

Validation performed:

- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- Focused Node Query/Remote Query Jest files passed:
  - `src/__tests__/remote-query.spec.ts`
  - `src/remote-query/__tests__/to-remote-query.ts`
  - `src/remote-query/__tests__/query-index.spec.ts`
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed, including `@medusajs/modules-sdk/remote-query/portable` with 4
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1591
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed. The
  script logs expected timeout proof errors for workflow recovery scenarios
  while exiting successfully.

Next implementation step:

- Turn 5 of `plan/roadmaps/portable-query-runtime-goal.md`: extract Remote
  Query service fetching into an adapter-safe helper shared by Node
  `RemoteQuery` and the portable Worker direct-entrypoint runtime.

## Shared Remote Query Fetch Helper

Commit:

- This commit (`Extract shared Remote Query fetch helper`)

Status:

- Added shared `remote-fetch-data.ts` support under
  `packages/core/modules-sdk/src/remote-query/`.
- The helper owns service method-name construction, `list` versus
  `listAndCount` selection, method validation, tracing, empty id-array
  handling, pagination result shaping, and large id-array batching.
- The Node `RemoteQuery` class now delegates service fetching to the shared
  helper while keeping RemoteJoiner planning in the Node runtime.
- The portable direct-entrypoint executor now uses the same shared method-call
  helper for direct `listAndCount*` execution.
- Added focused tests covering method suffixes, pagination, empty ids,
  batching, and tracing.

Validation performed:

- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- Focused Query and fetch-helper Jest files passed:
  - `src/__tests__/remote-query.spec.ts`
  - `src/remote-query/__tests__/to-remote-query.ts`
  - `src/remote-query/__tests__/query-index.spec.ts`
  - `src/remote-query/__tests__/remote-fetch-data.spec.ts`
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed,
  including `@medusajs/modules-sdk/remote-query/portable` with 5 bundled
  inputs.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1592
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed. The
  script logs expected timeout proof errors for workflow recovery scenarios
  while exiting successfully.

Next implementation step:

- Turn 6 of `plan/roadmaps/portable-query-runtime-goal.md`: choose the
  smallest real Medusa route that requires relation or link traversal and add
  only the portable Query behavior needed for that route.

## Portable Query Relation Traversal Validation

Commit:

- This commit (`Prove portable Query relation traversal`)

Status:

- The shared portable direct-entrypoint Query runtime now derives first-level
  relations from dotted fields before calling real module service methods.
- The workerd Cart DO SQLite production HTTP proof now seeds a product
  collection through the real Product module service, requests
  `GET /store/collections/:id?fields=id,title,products.id,products.title`,
  and asserts the related product is returned.
- The `medusa-cloudflare` app typecheck now has explicit local path mappings
  for `@medusajs/modules-sdk`, `@medusajs/modules-sdk/medusa-module`, and
  `@medusajs/modules-sdk/static-app` so local framework source can resolve
  the shared modules-sdk declarations during validation.

Validation performed:

- `cmd /c yarn workspace @medusajs/modules-sdk test src/remote-query/__tests__/remote-fetch-data.spec.ts --runInBand`
  passed.
- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed. The
  script logs expected timeout proof errors for workflow recovery scenarios
  while exiting successfully.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed,
  including `@medusajs/modules-sdk/remote-query/portable` with 5 bundled
  inputs.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1592
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `git diff --check` passed with only LF-to-CRLF warnings on touched files.

Remaining Query runtime boundary:

- Link traversal, multi-service joins, full RemoteJoiner parity, and
  `query.index(...)` are still not implemented in the portable Worker Query
  runtime. The next planned step is the Index boundary decision in
  `plan/roadmaps/portable-query-runtime-goal.md`.

## Portable Query Index Boundary Validation

Commit:

- This commit (`Define portable Query index boundary`)

Status:

- Real package route audit found two direct `query.index(...)` callers:
  `GET /store/products` and `GET /admin/products`.
- Both calls are behind the Index Engine feature flag.
- The portable Query service now exposes `index(...)` as an explicit adapter
  boundary:
  - if a portable Index handler is registered, `query.index(...)` delegates to
    it;
  - if no handler is registered, `query.index(...)` fails with a clear
    Worker-safe adapter error instead of a generic missing-method failure.
- The existing Worker Index runtime remains separate from the production HTTP
  runtime in this slice.

Validation performed:

- `cmd /c yarn workspace @medusajs/modules-sdk test src/remote-query/__tests__/portable-query-runtime.spec.ts src/remote-query/__tests__/query-index.spec.ts --runInBand`
  passed.
- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed, including the portable Query entrypoint.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1592
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `cmd /c yarn workspace medusa-cloudflare test:index-sqlite` passed,
  including Durable Object SQLite, D1, link attach/detach, event ingestion,
  and tenant runtime scope checks.
- `git diff --check` passed with only LF-to-CRLF warnings on touched files.

Remaining Query runtime boundary:

- The next slice should reduce the remaining static bridge registration shape
  rather than wire production product-list Index hydration immediately. Product
  list Index hydration should wait until we intentionally enable the Index
  Engine route path in the Worker HTTP proof.

## Static Query Bridge Registration Reduction Validation

Commit:

- This commit (`Move static Query entry mapping into portable runtime`)

Status:

- `static-app.ts` no longer owns static joiner alias parsing or direct
  entrypoint map construction.
- Shared portable Query runtime code now exposes:
  - `createDirectEntrypointQueryEntriesFromJoinerConfigs(...)`;
  - `createPortableQueryRuntimeFromJoinerConfigs(...)`.
- The static app bridge remains responsible for loading static modules,
  collecting loaded services, and registering `REMOTE_QUERY` and `QUERY` in the
  container.
- Worker route behavior remains unchanged.

Validation performed:

- `cmd /c yarn workspace @medusajs/modules-sdk test src/remote-query/__tests__/portable-query-runtime.spec.ts --runInBand`
  passed.
- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints` passed,
  including both `@medusajs/modules-sdk/static-app` and
  `@medusajs/modules-sdk/remote-query/portable`.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1592
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed. The
  script logs expected timeout proof errors for workflow recovery scenarios
  while exiting successfully.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `cmd /c yarn workspace @medusajs/modules-sdk test src/remote-query/__tests__/portable-query-runtime.spec.ts src/remote-query/__tests__/remote-fetch-data.spec.ts --runInBand`
  passed.
- `git diff --check` passed with only LF-to-CRLF warnings on touched files.

Next implementation step:

- Turn 9 of `plan/roadmaps/portable-query-runtime-goal.md`: evaluate whether
  the default Worker HTTP handler can move one step away from proof runtime
  options, using current production-source coverage as evidence.

## Default Worker HTTP Runtime Blocker Validation

Commit:

- This commit (`Record default Worker HTTP runtime blocker`)

Status:

- Default Worker HTTP handling remains backed by `staticHttpProofRuntimeOptions`.
- Production module-backed HTTP runtime remains proven inside `CartProofDO`.
- The default Worker cannot safely switch yet because it does not select a
  commerce Durable Object partition before creating production HTTP runtime
  options.
- Added `GET /medusa-http-runtime/status` to make the current mode and blocker
  testable.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "HTTP runtime status|Cloudflare Worker runtime"`
  passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1592
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed. The
  script logs expected timeout proof errors for workflow recovery scenarios
  while exiting successfully.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `git diff --check` passed with only LF-to-CRLF warnings on touched files.

Next implementation step:

- Introduce a non-default top-level Worker route that explicitly selects a
  commerce partition and delegates Medusa HTTP handling to the proven
  module-backed runtime inside that partition.

## Non-Default Production HTTP Partition Route Validation

Commit:

- This commit (`Add production HTTP partition route`)

Status:

- Added `GET /medusa-http-runtime/partitions/:partition/*` as the first
  non-default top-level Worker route that explicitly selects a commerce
  partition before invoking production HTTP handling.
- The route resolves the existing tenant runtime context, derives the cart
  partition Durable Object name, rewrites to the DO `http/*` path, and forwards
  the original request.
- `CartProofDO` now delegates `http/*` requests to the production Fetch HTTP
  handler built from its module runtime source.
- Default Worker HTTP handling remains backed by
  `staticHttpProofRuntimeOptions`; this slice proves the production path behind
  an explicit partition route only.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "production HTTP route|HTTP runtime status"`
  passed; Vitest executed the Worker and request-scope files with 22 passing
  tests.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed and
  verified the top-level partition route returns `store/currencies` data from
  the selected DO-backed module runtime.

Next implementation step:

- Keep the default handler unchanged until remaining blockers are removed.
  Continue by extracting reusable partition-selection composition or by adding
  one more real route through the same non-default path only when it exposes a
  new missing runtime boundary.

## Portable Query Runtime Goal Completion Validation

Commit:

- This commit (`Complete portable Query runtime goal audit`)

Status:

- The portable Query runtime roadmap is complete for its stated acceptance
  criteria.
- `packages/core/modules-sdk/src/static-app.ts` no longer owns Query execution
  behavior. It collects static module joiner configs and loaded services, then
  calls `createPortableQueryRuntimeFromJoinerConfigs(...)`.
- `ContainerRegistrationKeys.REMOTE_QUERY` and
  `ContainerRegistrationKeys.QUERY` are registered from the shared portable
  Query runtime outputs.
- Worker direct `REMOTE_QUERY` behavior, direct `QUERY.graph(...)` behavior,
  relation traversal, and top-level partition delegation into the module-backed
  runtime are all proven in the Cart DO workerd gate.
- Node `Query` and `RemoteQuery` behavior remains covered by the focused
  modules-sdk Query test suite.
- The default top-level Worker HTTP handler still uses proof HTTP options; that
  remains a separate HTTP/runtime bootstrap blocker, not remaining work in this
  portable Query runtime goal.

Validation performed:

- `cmd /c yarn workspace @medusajs/modules-sdk test src/__tests__/remote-query.spec.ts src/remote-query/__tests__/to-remote-query.ts src/remote-query/__tests__/query-index.spec.ts src/remote-query/__tests__/portable-query-runtime.spec.ts src/remote-query/__tests__/remote-fetch-data.spec.ts --runInBand`
  passed.
- `cmd /c yarn workspace @medusajs/modules-sdk build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed after the
  modules-sdk build completed.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1592
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed. The
  script logs expected timeout proof errors for workflow recovery scenarios
  while exiting successfully.
- `cmd /c yarn workspace @medusajs/medusa build` passed.

Next implementation step:

- Move out of the portable Query runtime goal. Continue with the remaining
  HTTP/runtime bootstrap blocker: the default Worker handler still needs a
  production partition-selection/composition boundary before it can stop using
  proof HTTP options.

## Production HTTP Partition Routing Helper Validation

Commit:

- This commit (`Extract HTTP partition routing helper`)

Status:

- Extracted top-level Worker partition forwarding into
  `apps/medusa-cloudflare/src/cloudflare-http-partition-routing.ts`.
- The helper owns partition route parsing, validation order, tenant runtime
  context resolution, partition address creation, request forwarding, and
  `x-medusa-partition-name` response annotation.
- `worker.ts` now supplies only the Cart DO binding, partition family, missing
  binding message, and rewrite function for the non-default production HTTP
  route.
- The helper validates malformed partition routes before checking the DO
  binding, preserving the previous `400` response behavior.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "production HTTP route|tenant partition|HTTP runtime status"`
  passed; Vitest executed the Worker and request-scope files with 23 passing
  tests.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1593
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed. The
  script logs expected timeout proof errors for workflow recovery scenarios
  while exiting successfully.
- `cmd /c yarn workspace @medusajs/medusa build` passed.

Next implementation step:

- Keep shrinking the default Worker HTTP blocker. The next useful step is to
  decide whether the default handler can call a production partition selector
  for a bounded route group without relying on proof HTTP options, or identify
  the next missing production runtime binding that blocks that switch.

## Bounded Default Route Production Partition Opt-In Validation

Commit:

- This commit (`Add bounded production partition route opt-in`)

Status:

- Added `x-medusa-partition-key` as an explicit opt-in header for bounded
  default-route production partition handling.
- The only candidate route in this slice is `/store/currencies`.
- With the header present, `/store/currencies` is forwarded through the same
  tenant-scoped Cart DO production HTTP runtime as the explicit
  `/medusa-http-runtime/partitions/:partition/*` route.
- Without the header, `/store/currencies` continues through the existing proof
  HTTP handler.
- Empty partition headers return `400`; missing Cart DO bindings return `503`
  only after a non-empty partition key is supplied.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "bounded default route|empty partition|production HTTP route|tenant partition|HTTP runtime status"`
  passed; Vitest executed the Worker and request-scope files with 25 passing
  tests.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1593
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed and
  verified `/store/currencies` with `x-medusa-partition-key` returns real route
  data from the selected DO-backed production HTTP runtime. The script logs
  expected timeout proof errors for workflow recovery scenarios while exiting
  successfully.
- `cmd /c yarn workspace @medusajs/medusa build` passed.

Next implementation step:

- Either extend the bounded default production route group to another
  already-proven route or identify the next runtime binding that prevents
  removing proof HTTP options entirely.

## Bounded Product Types Production Partition Opt-In Validation

Commit:

- This commit (`Extend bounded production routes to product types`)

Status:

- Passed.
- `/store/product-types` joins the bounded default production route group that
  uses `x-medusa-partition-key` to select the Cart DO production HTTP runtime.
- The route remains unchanged Medusa package code; the Worker only owns
  partition selection and request forwarding before the proof HTTP fallback.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "product type|bounded default route|empty partition|production HTTP route|tenant partition|HTTP runtime status"`
  passed; Vitest executed the Worker and request-scope files with 26 passing
  tests.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1593
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed and
  verified `/store/product-types` with `x-medusa-partition-key` returns real
  route data from the selected DO-backed production HTTP runtime. The script
  logs expected timeout proof errors for workflow recovery scenarios while
  exiting successfully.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `git diff --check` passed.

Result:

- Passed.

Next implementation step:

- Keep the global default Worker handler on proof HTTP options until a real
  production partition selection boundary is chosen for a wider route group.
  The next useful slice is either another already-proven Store route or the
  next missing production runtime binding that blocks removing proof HTTP
  options entirely.

## Bounded Collections Production Partition Opt-In Validation

Commit:

- This commit (`Extend bounded production routes to collections`)

Status:

- Passed.
- `/store/collections` and `/store/collections/:id` join the bounded default
  production route group that uses `x-medusa-partition-key` to select the Cart
  DO production HTTP runtime.
- The route remains unchanged Medusa package code; the Worker only owns
  partition selection and request forwarding before the proof HTTP fallback.
- The workerd proof targets `/store/collections/:id` with related product
  fields because that route is already proven inside the Cart DO production
  runtime.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "collection route|product type|bounded default route|empty partition|production HTTP route|tenant partition|HTTP runtime status"`
  passed; Vitest executed the Worker and request-scope files with 27 passing
  tests.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1593
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed and
  verified `/store/collections/:id` with `x-medusa-partition-key` returns real
  collection and related product data from the selected DO-backed production
  HTTP runtime. The script logs expected timeout proof errors for workflow
  recovery scenarios while exiting successfully.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `git diff --check` passed.

Result:

- Passed.

Next implementation step:

- Stop widening bounded Store read routes once the next route would require a
  new runtime binding. The useful next decision is whether to add another
  already-proven route family, such as Product Tags, or shift to the missing
  production binding that blocks removing proof HTTP options globally.

## Bounded Product Tags Production Partition Opt-In Validation

Commit:

- This commit (`Extend bounded production routes to product tags`)

Status:

- Passed.
- `/store/product-tags` and `/store/product-tags/:id` join the bounded default
  production route group that uses `x-medusa-partition-key` to select the Cart
  DO production HTTP runtime.
- The Cart DO production scenario now seeds Product Tag data through the real
  Product module service so the unchanged Store Product Tag route can be
  validated against production module runtime data.
- The route remains unchanged Medusa package code; the Worker only owns
  partition selection and request forwarding before the proof HTTP fallback.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "product tag|collection route|product type|bounded default route|empty partition|production HTTP route|tenant partition|HTTP runtime status"`
  passed; Vitest executed the Worker and request-scope files with 28 passing
  tests.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1593
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed and
  verified `/store/product-tags` with `x-medusa-partition-key` returns real
  Product Tag data from the selected DO-backed production HTTP runtime. The
  script logs expected timeout proof errors for workflow recovery scenarios
  while exiting successfully.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `git diff --check` passed.

Result:

- Passed.

Next implementation step:

- Stop widening the bounded read route group unless the next route proves a
  missing production binding. The better next slice is to inspect the default
  Worker runtime blocker and decide which production binding is still required
  before proof HTTP options can be removed globally.

## Bounded Production Route Policy And Runtime Status Audit Validation

Commit:

- This commit (`Extract bounded production route policy`)

Status:

- Passed.
- Bounded production route matching moved from an inline `worker.ts` predicate
  into `cloudflare-http-production-route-policy.ts`.
- The status endpoint now reports:
  - the explicit `x-medusa-partition-key` opt-in header;
  - the bounded route groups proven against the Cart DO production HTTP path;
  - production bindings already proven inside Cart DO;
  - the remaining global blocker: default Worker requests without an explicit
    partition key still need a production partition-selection policy before
    proof HTTP options can be removed globally.
- The app root still only owns runtime composition and partition forwarding.
  Medusa route handlers and module services remain unchanged.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "HTTP runtime status|bounded default route|product type|collection route|product tag|empty partition|production HTTP route|tenant partition"`
  passed; Vitest executed the Worker and request-scope files with 28 passing
  tests.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1594
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed. The
  script logs expected timeout proof errors for workflow recovery scenarios
  while exiting successfully.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `git diff --check` passed.

Result:

- Passed.

Next implementation step:

- Do not add more bounded read routes by default. The next useful slice is to
  design and prove a non-header partition-selection policy for one route group,
  or identify a protected/Admin route whose production auth/session behavior
  exposes a still-missing default Worker binding.

## Bounded Auth Session Production Route Validation

Commit:

- This commit (`Prove bounded auth session production route`)

Status:

- Passed.
- `/auth/session` joins the bounded default production route group that uses
  `x-medusa-partition-key` to select the Cart DO production HTTP runtime.
- The production request scope now registers the typed Medusa `configModule`
  needed by existing auth middleware.
- The Cart DO production HTTP runtime now prepares proof auth context through
  Medusa's existing upstream auth-context hook before the unchanged auth
  middleware runs.
- The Worker still does not switch default requests without
  `x-medusa-partition-key` to the production module runtime.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "auth session routes|HTTP runtime status|bounded default route|empty partition|production HTTP route|tenant partition"`
  passed; Vitest executed the Worker and request-scope files with 29 passing
  tests.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1594
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed and
  verified POST and DELETE `/auth/session` with `x-medusa-partition-key`
  create and clear DO-backed session state through the selected Cart DO
  production HTTP runtime. The script logs expected timeout proof errors for
  workflow recovery scenarios while exiting successfully.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `git diff --check` passed.

Result:

- Passed.

Next implementation step:

- Replace the proof auth-context preparer with the eventual Worker-safe auth
  verifier when that boundary is selected. Until then, the immediate runtime
  blocker remains default partition selection for requests that do not include
  `x-medusa-partition-key`.

## Bounded Auth Session Bearer Proof Validation

Commit:

- This commit (`Use bearer auth context for production session proof`)

Status:

- Passed.
- The Cart DO production HTTP runtime now prepares auth context from
  `Authorization: Bearer ...` instead of the custom
  `x-medusa-access-token` proof header.
- The bounded `/auth/session` production proof still uses the unchanged Medusa
  route and auth middleware.
- This is a proof bearer-token preparer for the current Worker token shape, not
  the final cryptographic JWT verifier.
- The Worker still does not switch default requests without
  `x-medusa-partition-key` to the production module runtime.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test src/cloudflare-http-auth-context.spec.ts`
  passed; Vitest executed the auth-context helper, Worker, and request-scope
  files with 32 passing tests.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "getCloudflareHttpProofBearerAuthContext|auth session routes|HTTP runtime status|bounded default route|empty partition|production HTTP route|tenant partition"`
  passed; Vitest executed the Worker and request-scope files with 29 passing
  tests.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1595
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed and
  verified POST and DELETE `/auth/session` with `Authorization: Bearer ...`
  plus `x-medusa-partition-key` create and clear DO-backed session state
  through the selected Cart DO production HTTP runtime. The script logs
  expected timeout proof errors for workflow recovery scenarios while exiting
  successfully.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `git diff --check` passed.

Result:

- Passed.

Next implementation step:

- Either introduce a real Worker-safe JWT signing/verifying adapter for Medusa
  auth token routes, or return to the remaining default Worker blocker:
  automatic partition selection for requests without `x-medusa-partition-key`.

## Shared Bearer Auth Context Boundary Validation

Commit:

- This commit (`Move bearer auth context preparation into framework HTTP`)

Status:

- Passed.
- The app-local `cloudflare-http-auth-context.ts` helper has been removed.
- Shared framework Fetch HTTP now exports:
  - `createBearerAuthContextPrepareRequest(...)`;
  - `decodeUnverifiedJwtBearerAuthContext(...)`;
  - `getBearerToken(...)`.
- `CartProofDO` composes the shared preparer with the current unverified proof
  decoder.
- Node auth middleware behavior remains unchanged. Full cryptographic
  Worker-safe JWT verification is still a later boundary.

Validation performed:

- `cmd /c .\node_modules\.bin\jest packages/core/framework/src/http/__tests__/bearer-auth-context.spec.ts --runInBand --forceExit`
  passed with 4 assertions.
- `cmd /c yarn workspace @medusajs/framework build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "auth session routes|HTTP runtime status|bounded default route|empty partition|production HTTP route|tenant partition"`
  passed with 29 Worker/request-scope assertions.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1595
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed and
  verified the bounded `/auth/session` proof still creates and clears
  DO-backed session state through the selected Cart DO production HTTP runtime.
  The script logs expected timeout proof errors for workflow recovery
  scenarios while exiting successfully.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `git diff --check` passed.

Result:

- Passed.

Notes:

- A first broad `@medusajs/framework test -- bearer-auth-context` attempt ran
  the new bearer auth-context spec successfully, but also ran unrelated
  framework suites because the package script already includes
  `--testPathPattern=src`. The unrelated static HTTP builder/package-export
  assertions failed there and are not caused by this auth change.

Next implementation step:

- Continue with a real Worker-safe JWT verifier adapter, or return to the
  remaining default Worker blocker: production partition selection for requests
  without `x-medusa-partition-key`.

## Worker-Safe Bearer JWT Verifier Validation

Commit:

- This commit (`Use Worker-safe bearer JWT verifier`)

Status:

- Passed.
- Shared framework Fetch HTTP now exports:
  - `createHs256JwtBearerAuthContextVerifier(...)`;
  - `createHs256Jwt(...)` for tests and proof token fixtures.
- The Cart DO production HTTP auth preparer now verifies HS256 bearer tokens
  with WebCrypto before setting Medusa request auth context.
- The bounded `/auth/session` workerd proof token fixture now signs the bearer
  token with the same proof secret registered in the Cloudflare HTTP
  `configModule`.
- Node auth middleware behavior remains unchanged. Broader Medusa token
  issuance and production secret management are still later boundaries.

Validation performed:

- `cmd /c .\node_modules\.bin\jest packages/core/framework/src/http/__tests__/bearer-auth-context.spec.ts --runInBand --forceExit`
  passed with 6 assertions.
- `cmd /c yarn workspace @medusajs/framework build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "auth session routes|HTTP runtime status|bounded default route|empty partition|production HTTP route|tenant partition"`
  passed with 29 Worker/request-scope assertions.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1595
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed and
  verified bounded `/auth/session` with a signed bearer token through the
  selected Cart DO production HTTP runtime. The script logs expected timeout
  proof errors for workflow recovery scenarios while exiting successfully.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `git diff --check` passed.

Result:

- Passed.

Next implementation step:

- After the full gate passes, return to the remaining default Worker blocker:
  production partition selection for requests without `x-medusa-partition-key`,
  or migrate the next protected route only if it exposes another missing
  Worker-safe auth/session boundary.

## URL-Derived Cart Retrieve Partition Validation

Commit:

- This commit (`Derive Cart retrieve partition from route`)

Status:

- Passed.
- The Worker now treats `GET /store/carts/:id` as a URL-derived production
  partition candidate.
- The derived Cart partition key is the route `:id`; the request is forwarded
  to `/do-cart/:id/http/store/carts/:id` inside the tenant-scoped Cart DO.
- Header opt-in behavior remains unchanged for the existing bounded route
  groups.
- Runtime status now reports the URL-derived route group separately from the
  `x-medusa-partition-key` opt-in route groups.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "HTTP runtime status|bounded default route|store cart routes|Cart production partition|tenant partition"`
  passed with 30 Worker/request-scope assertions.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed and
  verified `GET /store/carts/:id` without `x-medusa-partition-key` reads the
  scenario cart from the selected Cart DO production HTTP runtime. The script
  logs expected timeout proof errors for workflow recovery scenarios while
  exiting successfully.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1595
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `git diff --check` passed.

Result:

- Passed.

Next implementation step:

- After the full gate passes, expand the same URL-derived Cart policy to the
  next cart-owned route only when the partition key can be derived from the
  route or request body without rebuilding handler logic.

## URL-Derived Cart Missing-Entity Validation

Commit:

- This commit (`Isolate Cart DO module runtimes`)

Status:

- Passed.
- Static Fetch HTTP handlers now apply the default Medusa error handler when no
  custom static middleware error handler is present.
- Cart DO commerce module composition now uses runtime-scoped static module
  aliases so multiple Cart Durable Object runtimes in the same Worker isolate
  do not share storage-bound module service instances.
- The workerd Cart DO gate now verifies a fresh URL-derived
  `GET /store/carts/:id` partition returns the unchanged Medusa JSON
  `not_found` response for a missing cart.

Validation performed:

- `cmd /c yarn jest packages/core/framework/src/http/__tests__/fetch-http-adapter.spec.ts --runInBand`
  passed with 32 Fetch adapter assertions.
- `cmd /c yarn workspace @medusajs/framework build` passed.
- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "HTTP runtime status|bounded default route|store cart routes|Cart production partition|tenant partition"`
  passed with 30 Worker/request-scope assertions.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed and
  verified both an existing scenario cart and a missing cart through
  URL-derived Cart partition routing. The script logs expected timeout proof
  errors for workflow recovery scenarios while exiting successfully.
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:imports` passed with 1595
  bundled inputs.
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
  passed.
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports` passed
  with 0 Worker blockers.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `git diff --check` passed.

Result:

- Passed.

Next implementation step:

- Do not continue to `POST /store/carts/:id` until the real `update-cart`
  workflow graph is Worker-portable and statically registered. The route
  partition key is derivable from the URL, but the unchanged Medusa handler
  depends on a cart core-flow graph that currently pulls Node-only imports into
  the workerd build.
