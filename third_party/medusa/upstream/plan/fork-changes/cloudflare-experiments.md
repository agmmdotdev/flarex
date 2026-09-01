# Cloudflare Experiments

## Experimental Portable Packages

The following packages and app were added as early portability experiments:

- `packages/core/dml` as `@medusajs/dml`
  - Worker-importable model metadata and model definition experiments.
- `packages/core/dal` as `@medusajs/dal`
  - Portable repository, database session, mutation, and generated
    internal-service experiments.
- `packages/database/drizzle` as `@medusajs/drizzle`
  - Drizzle SQLite schema compiler and repository experiments.
- `apps/medusa-cloudflare`
  - Cloudflare Worker proof application.

These additions proved that a Worker-importable persistence path is feasible.
They are not the final module migration architecture.

## Portability Import Guard

`apps/medusa-cloudflare/scripts/check-portable-imports.mjs` bundles the Worker
entrypoint and rejects imports involving:

- Node built-ins.
- Express.
- MikroORM.
- PostgreSQL clients.
- Broad framework and utils package paths.

The original portable-service guard passed with 124 bundled inputs.

The Worker now composes the actual Currency service. The composed Worker guard
passes with 199 bundled inputs and rejects Node built-ins, MikroORM, PostgreSQL,
and filesystem-based module infrastructure.

## Real Currency Module Import Audit

Commit:

- `c946ed072a refactor: isolate node persistence composition`

`apps/medusa-cloudflare/scripts/audit-real-module-imports.mjs` bundles the
actual `CurrencyModuleService`, rather than the temporary portable Currency
service.

Commands:

- `yarn workspace medusa-cloudflare audit:real-module-imports` reports the
  current blocker baseline without failing.
- `yarn workspace medusa-cloudflare check:real-module-imports` is the strict
  acceptance guard and fails until all Worker blockers are removed.

Baseline after isolating Node persistence composition:

- 2,448 bundled inputs.
- 628 Worker blockers.

After adding precise existing-runtime entrypoints for Currency and removing
the static MikroORM subscriber dependency from `MedusaService`:

- 1,270 bundled inputs.
- 604 Worker blockers.

The audit now also reports direct first-party blocker edges and broad
first-party barrel edges.

After narrowing the actual DML index-query helper and adjacent service imports:

- 68 bundled inputs.
- 0 Worker blockers.
- The strict actual Currency service guard passes.

Commit:

- `cd479894a8 refactor: make currency service import graph portable`

The important difference from original Medusa is import composition, not
Currency behavior:

- Persistence-neutral DML helpers import specific common utilities instead of
  the broad common barrel.
- `MedusaService` imports its linkable-key map helper without importing the
  filesystem-aware joiner config builder.
- The guard rejects concrete Node/MikroORM module-sdk paths instead of treating
  every module-sdk file as non-portable.
- The audit reports inbound persistence edges and shortest paths to broad
  runtime boundaries.

The composed Worker graph is now covered by the passing guard. It uses explicit
application-root composition instead of importing the Node-oriented
`MedusaModule` bootstrap or filesystem discovery.

## Actual Currency Workerd Application

Commit:

- `8614ca9053 feat: run actual currency module in workerd`

`apps/medusa-cloudflare` now uses the actual `CurrencyModuleService`, generated
internal service, standard repository registration, Drizzle Medusa adapter, and
D1. The old portable Currency service is no longer used by the Worker.

Validation:

- `yarn workspace medusa-cloudflare test:workerd` passes against local D1
  inside workerd.
- Production Worker build passes without `nodejs_compat`.
- Composed Worker import guard passes with 199 bundled inputs.
- Worker output is 327.37 kB before gzip and 76.44 kB gzip.

## Precise Actual Currency Runtime Imports

Commits:

- `539bd8b9c1 refactor: add precise currency runtime entrypoints`
- `8a3a0528dc refactor: remove parallel portable currency service`

The actual Currency module imports narrow runtime entrypoints for:

- `model`
- `MedusaService`
- `Module`
- `Modules`
- `ContainerRegistrationKeys`
- `defaultCurrencies`

Currency imports `model` and `MedusaService` directly from precise
`@medusajs/utils` entrypoints. Supporting declaration-only utility subpaths are
exported so clean package builds do not leak unnameable internal paths.

## Removed Temporary Currency Code

Commit:

- `8a3a0528dc refactor: remove parallel portable currency service`

The obsolete parallel portable Currency model, service, package exports,
Currency-specific framework re-export shims, and associated Worker aliases
were removed after the actual Currency service replaced them in workerd.

## Shared Static Module Composition

Commit:

- `0ea9e4dde5 refactor: add shared static module bootstrap`

The Worker app now supplies a typed static Currency manifest to the shared
`@medusajs/modules-sdk/static-module-loader` entrypoint. Shared Medusa loader
logic creates the connection loader, container loader, generated internal
service, repositories, and actual Currency module service.

The Worker graph does not import the Node `moduleLoader`, filesystem resolver,
MikroORM default adapter, or Node migration loader. Node deployments continue
to use those pieces through the existing `moduleLoader` wrapper.

Validation after this change:

- Workerd/D1 Currency runtime check passes.
- Cloudflare app tests: 2 passing.
- Production Worker build: 209 transformed modules, 342.79 kB before gzip.
- Composed Worker import guard: 203 bundled inputs accepted.
- Real Currency module audit: 66 bundled inputs, 0 Worker blockers.

## Currency Through MedusaModule

Commit:

- `ed17630e14 refactor: bootstrap static modules through MedusaModule`

The Worker app imports Currency's module-owned static manifest and calls the
normal `MedusaModule.bootstrap` API. Static registration, loader selection,
service resolution, module resolution tracking, and joiner config handling now
occur inside shared Medusa module bootstrap.

Validation after this change:

- Workerd/D1 returns the seeded Currency row through `MedusaModule`.
- Cloudflare app tests: 2 passing.
- Production Worker build: 214 transformed modules, 363.60 kB before gzip.
- Composed Worker import guard: 208 bundled inputs accepted.
- Real Currency module audit: 66 bundled inputs, 0 Worker blockers.

On this Windows environment, Wrangler 4.100 can report successful local D1
migration status but hang while cleaning up the command process. The workerd
check bounds that cleanup phase on Windows and still requires the real Currency
route assertion to pass.

## Runtime-Reused Currency Manifest Metadata

Commit:

- `fa0d7413c7 refactor: reuse portable Medusa joiner config`

The Worker still imports Currency's explicit module-owned resource graph. Its
definition now comes directly from Medusa's `ModulesDefinition`, and its
joiner config is derived at runtime from the Currency DML model through
Medusa's portable explicit-model builder. The temporary generated metadata
artifact and Node generator were removed.

The import guard now reports shortest paths to broad Node boundaries, making
portable-graph regressions easier to diagnose.

Validation after this change:

- Workerd/D1 Currency runtime check passes.
- Cloudflare app type-check and 2 tests pass.
- Production Worker build: 222 transformed modules, 385.69 kB before gzip.
- Composed Worker import guard: 216 bundled inputs accepted.
- Real Currency module audit: 66 bundled inputs, 0 Worker blockers.

## Generated Currency D1 Baseline

Commit:

- `aa62992840 feat: generate D1 migrations from Medusa DML`

The Cloudflare app now generates `0001_currency.sql` from the actual Currency
DML model through the shared Drizzle D1 SQL renderer. Seed data is isolated in
`0002_currency_seed.sql`.

`test:d1-migrations` creates a fresh temporary Wrangler local D1 database,
applies every app migration, and inspects the resulting Currency schema and
seed row. This catches generated-file drift and validates the real Wrangler D1
migration path without relying on an existing `.wrangler` database.

This is a baseline generator only. Previously migrated experimental databases
must be recreated, and future deployed upgrades still require schema-diff
migration generation.

## Actual D1 Currency Mutations

Commit:

- `c3a0cc5052 feat: validate D1 mutations and transaction semantics`

The workerd runtime check now performs read, create, and update operations
through the actual generated Currency module service. Request payloads are
treated as `unknown` and narrowed at the Worker boundary.

The D1 composition explicitly declares `statement` transaction semantics. This
is intentional: D1 rejects Drizzle's interactive `BEGIN` transaction path.
The proof does not claim multi-statement atomicity; it verifies supported
mutations and keeps the missing transaction guarantee visible.

Validation after this change:

- Actual Currency read/create/update through workerd/D1 passes.
- Cloudflare app type-check and 2 tests pass.
- Production Worker build: 222 transformed modules, 387.47 kB before gzip.
- Composed Worker import guard: 216 bundled inputs accepted.
- Real Currency module audit: 66 bundled inputs, 0 Worker blockers.

## Module-Owned Drizzle Migration Aggregation

Commit:

- `b7f8ead739 refactor: make module migrations adapter-driven`

The Currency module now owns its Drizzle SQLite baseline. The Cloudflare app no
longer acts as the source of truth for Currency schema SQL; its generator
verifies the module migration against DML and copies that exact migration into
Wrangler's application-owned migration directory.

D1 execution remains application-owned through Wrangler. This preserves the
module migration history while respecting D1's deployment-specific migration
runner and flat migration ordering.

## Actual D1 Currency Delete

Commit:

- `3d28423c76 refactor: make mutation event dispatch adapter-driven`

The workerd runtime check now deletes its created Currency row through the
actual generated Medusa service and verifies that the row is absent.

Manual mutation event dispatch no longer enters MikroORM event-manager code in
the shared internal service. The selected persistence adapter owns subscriber
registration and manual dispatch, allowing Drizzle/D1 delete to use the same
Medusa mutation-event contract.

## Actual D1 Currency Soft Delete And Restore

Commit:

- `60111e27db feat: add Drizzle soft delete and restore`

The workerd runtime check now calls the actual generated
`softDeleteCurrencies` and `restoreCurrencies` methods between update and hard
delete. It verifies that D1 hides the soft-deleted Currency row, restores the
same updated row, returns the repository's affected-model maps, and finally
hard-deletes the row.

Validation after this change:

- Actual Currency read/create/update/soft-delete/restore/delete through
  workerd/D1 passes.
- Cloudflare app type-check and 2 tests pass.
- Production Worker build: 222 transformed modules, 390.51 kB before gzip.
- Composed Worker import guard: 216 bundled inputs accepted.
- Real Currency module audit: 66 bundled inputs, 0 Worker blockers.

This proof covers relationless Currency behavior. It does not claim recursive
soft-delete cascades or ORM-managed mutation-event parity for Drizzle.

## SQLite-Backed Durable Object Proof

Commit:

- `0d367310ed feat: prove Durable Object SQLite manager`

The thin Cloudflare application root now binds and exports `CurrencyProofDO`.
The class composes the Cloudflare-specific Drizzle manager and the existing
Currency DML schema/repository; it does not recreate Medusa repository
behavior in the application.

The focused workerd check creates and reads a Currency row through a named
Durable Object, verifies `object-serialized` capabilities, and proves the
current async transaction callback is not atomic by observing that a write
remains after the callback throws. The proof route cleans up its temporary row.

This remains an infrastructure proof, not a replacement Currency API or the
authoritative Cart implementation. The next runtime experiment must make the
rollback proof atomic through a staged synchronous statement boundary.

This initial conclusion is superseded by the atomic transaction proof below.

## Atomic Durable Object Transaction Proof

Commit:

- `5c1910a4ea feat: make Durable Object transactions atomic`

The Cloudflare manager now runs the existing async Medusa transaction callback
through `DurableObjectStorage.transaction`. The workerd proof performs
multiple writes, a nested manager callback, and a read-your-own-writes check
before throwing. Both writes are absent after rollback.

This corrects the initial proof's non-atomic result without adding a staged
statement executor or changing the repository API. `CurrencyProofDO` remains a
disposable acceptance fixture and does not define the final tenant partition
topology.

The proof covers persistence operations only. Durable Object storage
transaction callbacks may retry, so later event publication and external side
effects require an after-commit or idempotent boundary.

## Actual Currency Service In Durable Object SQLite

Commit:

- `ba74b53d24 feat: run Currency service in Durable Object`

The disposable Durable Object proof now composes the actual
`CurrencyModuleService` through the same manager-driven static
`MedusaModule.bootstrap` helper used by the D1 Worker path. The application no
longer constructs a Currency repository for the DO proof.

The workerd test covers service-level create/list/delete and passes transaction
contexts through the actual service for nested writes, read-your-own-writes,
and rollback.

Validation:

- Actual Currency module service DO SQLite workerd proof passed.
- Existing Currency workerd/D1 mutation runtime passed.
- Cloudflare app type-check and 2 tests passed.
- Production Worker build: 229 transformed modules, 445.23 kB.
- Composed Worker guard: 333 bundled inputs accepted.
- Strict actual Currency audit: 66 bundled inputs and 0 Worker blockers.

## Actual Index Service In Durable Object SQLite

Commit:

- This commit (`Add Index Durable Object SQLite proof`)

The Cloudflare app now has a focused Index proof Worker that binds
`IndexProofDO`. The proof composes the real `IndexModuleService` with the
portable `SqliteIndexStorageProvider` and an executor backed by Durable Object
SQLite storage.

This is intentionally an isolated Worker entry. It proves the Index service
and SQLite provider can execute inside workerd without Node or MikroORM imports
while the broader `medusa-cloudflare` app graph is still being cleaned up.

Validation:

- Isolated Index proof Worker build passed.
- Actual Index module service DO SQLite workerd proof passed.
- Cloudflare app typecheck passed.
- Import guard passed for the isolated Index proof graph.

Current limitations:

- This does not make the full Cloudflare app bundle clean yet. The production
  app still has unrelated unfinished Node/CJS import edges that must be
  removed in later runtime slices.
- The proof uses Durable Object SQLite storage, not D1.

## Index Durable Object And D1 SQLite Proofs

Commit:

- This commit (`Add Index Cloudflare SQLite executor boundary`)

The isolated Index proof Worker now proves the same real Index relation query
through both Cloudflare SQLite backends:

- Durable Object SQLite through `DurableObjectSqliteIndexExecutor`.
- D1 through `D1SqliteIndexExecutor`.

Both executors share the existing `SqliteIndexExecutor` contract from the
Index storage provider. The proof helper seeds the same Product, Variant,
Price Set, and Price rows before calling the real `IndexModuleService.query`
path.

Validation:

- Isolated Index proof Worker build passed.
- `test:index-sqlite` passed for Durable Object SQLite and D1.
- The previous `test:index-do-sqlite` command remains available and passed as
  an alias.
- Import guard passed for the isolated proof graph.

Current limitations:

- This remains an isolated proof Worker, not proof that the broad production
  Worker bundle is fully portable.

## Index Proof Uses Package-Owned Portable Utils

Commit:

- This commit (`Add Index portable framework utils boundary`)

The isolated Index proof no longer aliases `@medusajs/framework/utils` to an
app-local proof shim. It now uses the package-owned
`@medusajs/framework/utils/portable` entry that is shared with the portable
Index source path.

The proof runner also changed from Cloudflare Vite dev server to built output
served by Wrangler. The Vite dev optimizer still prebundles CJS packages in
this repo shape, while the built Worker graph is clean and is the graph used
for the import guard.

Validation:

- Isolated Index proof Worker build passed.
- `test:index-sqlite` passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as an alias.
- Import guard passed for the isolated proof graph.

Current limitations:

- The proof Worker remains isolated from the broad production app bundle.
- Remaining proof service composition helpers still live in the Cloudflare app
  until the next Index composition slice.

## Index Proof Uses Package-Owned Composition

Commit:

- This commit (`Move Index Worker composition into package`)

The isolated Index proof Worker now imports
`@medusajs/index/worker-composition` for the real Index service composition and
relation-query proof fixture.

Cloudflare app ownership is reduced to runtime bindings and executor
selection:

- `IndexProofDO` selects the Durable Object SQLite executor and forwards the
  request to package-owned composition.
- `/d1-index/query-proof` selects the D1 executor and uses the same package
  helper.

Validation:

- `test:index-sqlite` passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as an alias.
- Import guard passed for the isolated proof graph.

Current limitations:

- The proof Worker is still isolated from the broad production app bundle.
- Product/Pricing/link joiner configs are still proof fixture inputs, now
  owned by the Index package.

## Index Proof Uses Real Product And Pricing Joiner Configs

Commit:

- This commit (`Reuse Product and Pricing joiner configs in Index proof`)

The isolated Index proof Worker now imports Product and Pricing joiner configs
from their owning module packages instead of using local proof-only Product and
Pricing config objects.

Cloudflare-specific changes:

- Added proof and main Worker Vite aliases for
  `@medusajs/product/joiner-config` and
  `@medusajs/pricing/joiner-config`.
- Added proof aliases for the portable DML model builder and joiner-config
  builder utility subpaths needed by those real configs.
- Kept Cloudflare ownership limited to aliases, runtime executor selection,
  Durable Object binding, and D1 binding.

Validation:

- `test:index-sqlite` passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as an alias.
- Node-only import guard passed for the isolated proof graph.

Current limitations:

- The proof Worker is still isolated from the broad production app bundle.
- The ProductVariant/PriceSet link joiner is still a local proof fixture until
  the fork has a reusable static link manifest input.

## Index Proof Uses Real ProductVariant/PriceSet Link Definition

Commit:

- This commit (`Reuse ProductVariant PriceSet link definition in Index proof`)

The isolated Index proof Worker now imports the real ProductVariant/PriceSet
link definition from `@medusajs/link-modules` instead of carrying a local link
joiner object inside Index Worker composition.

Cloudflare-specific changes:

- Added proof and main Worker aliases for
  `@medusajs/link-modules/definitions/product-variant-price-set`.
- Added aliases for `@medusajs/utils/link/links`, which is used by the
  portable framework utility boundary.
- Kept Cloudflare ownership limited to aliases, runtime executor selection,
  Durable Object binding, and D1 binding.

Validation:

- `test:index-sqlite` passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as an alias.
- Node-only import guard passed for the isolated proof graph.

Current limitations:

- The proof Worker is still isolated from the broad production app bundle.
- The Worker composition still owns proof seed data and the small proof schema.

## Index Proof Shares SQLite Relation Fixture

Commit:

- This commit (`Share Index SQLite relation proof fixture`)

The isolated Index proof Worker and the Node SQLite integration harness now
share the same relation-query fixture from `packages/modules/index/src`.

Cloudflare-specific changes:

- The Worker proof imports schema, joiner registration, reset, and seed helpers
  from `relation-query-proof-fixture`.
- Durable Object SQLite and D1 proof routes continue to use runtime-specific
  executors only.

Validation:

- `test:index-sqlite` passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as an alias.
- Node-only import guard passed for the isolated proof graph.

Current limitations:

- The proof Worker is still isolated from the broad production app bundle.
- Worker composition still owns service construction and proof result
  extraction helpers.

## Index Proof Uses Shared SQLite Service Composition

Commit:

- This commit (`Share Index SQLite service composition`)

The isolated Index proof Worker now uses
`sqlite-index-service-composition.ts` for SQLite `IndexModuleService`
construction. The Cloudflare app still owns only Durable Object/D1 executor
selection and runtime bindings.

Cloudflare-specific changes:

- No new Cloudflare runtime behavior was added.
- Durable Object SQLite and D1 proof routes continue to pass their executor to
  package-owned Index composition.

Validation:

- `test:index-sqlite` passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as an alias.
- Node-only import guard passed for the isolated proof graph.

Current limitations:

- The proof Worker is still isolated from the broad production app bundle.
- Worker composition still owns proof query/result extraction.

## Index Proof Uses Package Proof Runner

Commit:

- This commit (`Move Index relation proof into runner`)

The isolated Index proof Worker still imports
`@medusajs/index/worker-composition`, but that entry now only re-exports the
package-owned relation proof runner.

Cloudflare-specific changes:

- No Cloudflare runtime code changed.
- Durable Object SQLite and D1 proof routes continue to use the same public
  proof API.

Validation:

- `test:index-sqlite` passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as an alias.
- Node-only import guard passed for the isolated proof graph.

Current limitations:

- The proof Worker is still isolated from the broad production app bundle.
- The app import can later move from `worker-composition` to
  `relation-query-proof-runner`.

## Index Proof Imports Relation Runner Directly

Commit:

- This commit (`Point Index proof app at relation runner`)

The isolated Index proof Worker now imports the package-owned relation proof
runner directly from `@medusajs/index/relation-query-proof-runner`.

Cloudflare-specific changes:

- `IndexProofDO` and the D1 proof route no longer import
  `@medusajs/index/worker-composition`.
- App-local Vite and TypeScript aliases for `worker-composition` were removed.
- The Index package still keeps `worker-composition` as a compatibility export
  for callers that have not moved yet.

Validation:

- `test:index-sqlite` passed for Durable Object SQLite and D1.
- `test:index-do-sqlite` passed as an alias.
- A stale app import scan found no remaining
  `@medusajs/index/worker-composition` imports in `apps/medusa-cloudflare`.
- Node-only import guard passed for the isolated proof graph.

Current limitations:

- The proof Worker is still isolated from the broad production app bundle.
- This was an import-surface cleanup, not new Index query behavior.

## Built Cart Durable Object Proof Runner

Commit:

- This commit (`Scope Cart proof DO routing by tenant context`)

The Cart-oriented workerd proof now builds the Worker first and serves
`dist/medusa_cloudflare/wrangler.json` with Wrangler instead of relying on
Vite dev-server fallback behavior.

Cloudflare-specific changes:

- `test:cart-do-sqlite` runs `yarn workspace medusa-cloudflare build` before
  starting Wrangler.
- The proof validates the built Worker graph used by the import guard and
  catches production Worker startup issues that Vite dev mode can hide.
- The shared Vite aliases now resolve
  `@medusajs/framework/utils/portable` before the broader
  `@medusajs/framework/utils` shim so portable subpaths are not rewritten under
  the broad app-local alias.

Worker startup portability fixes:

- Inventory and Order optional MikroORM decorator hooks skip dynamic
  `require(...)` loading when the Worker build define is active.
- API Key random token generation uses Web Crypto before Node crypto, keeping
  publishable-key generation Worker-compatible while leaving Node `scrypt`
  behavior for secret keys unchanged.
- `createPortableId` still prefers cryptographic random IDs, but falls back to
  a process-local counter when a Worker disallows random values during
  global-scope module evaluation.
- Cart proof workflows are created inside request-time proof functions instead
  of at Worker module scope.

Validation:

- `yarn workspace medusa-cloudflare test:cart-do-sqlite` passed against the
  built Worker served by Wrangler.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace @medusajs/utils build` passed.
- Worker bundle Node-only import guard passed with 1532 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

Validation note:

- `@medusajs/api-key`, `@medusajs/inventory`, and `@medusajs/order` package
  builds remain blocked by existing build-graph issues around broad
  `@medusajs/framework/utils` exports and static-manifest subpath resolution.
  Those failures were present at the package build boundary and are separate
  from the Worker proof validation for this slice.

## Built Currency Durable Object Proof Runner

Commit:

- This commit (`Scope Currency proof DO routing by tenant context`)

The Currency DO SQLite proof now validates the built Worker served by Wrangler
instead of Vite dev-server fallback behavior.

Cloudflare-specific changes:

- `test:do-sqlite` runs `yarn workspace medusa-cloudflare build` before
  starting Wrangler with `dist/medusa_cloudflare/wrangler.json`.
- The proof now validates tenant-scoped Currency DO routing before running the
  existing actual Currency module service create/list/rollback checks.
- `CurrencyProofDO` now creates the Currency module runtime lazily. The
  `/capabilities` path still reports the manager transaction mode without
  bootstrapping the full module runtime.

Reason:

- The tenant routing proof touches multiple Currency DO instances in the same
  Worker isolate. Eagerly bootstrapping the full module runtime for simple
  capability checks caused workerd to reject later storage I/O as crossing
  Durable Object instance boundaries. Lazy runtime creation keeps capability
  checks storage-local and initializes the real Currency service only on paths
  that need it.

Validation:

- `yarn workspace medusa-cloudflare test:do-sqlite` passed against the built
  Worker served by Wrangler.
- `yarn workspace medusa-cloudflare test:cart-do-sqlite` passed as a shared
  tenant partition helper regression check.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace @medusajs/currency build` passed when run separately from
  app typecheck.
- Worker bundle Node-only import guard passed with 1532 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

Validation note:

- Do not run package builds that delete `dist` in parallel with app typecheck
  or app builds that consume those `dist` folders. Run the package build first,
  then run the consuming validation.
