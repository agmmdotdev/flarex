# Medusa Package And Capability Source Map

Status: accepted source audit for the pinned inert fork; private relational
value admission complete, while installation, package promotion, adapter
implementation, runtime imports, writes, and production activation remain
unauthorized

Last reviewed: 2026-09-02

## Decision

Use the mature Medusa DML, generated-service, DAL, static-module, and framework
contracts from the admitted fork as consumer evidence. Do not import Medusa
into Flarex core, do not make the standalone scalar-only `@medusajs/dml`
experiment the schema authority, and do not promote the existing eager
Drizzle adapter as the Currency persistence closure.

The first future promotion unit is a connected Currency semantic and static-
bootstrap closure plus a separately translated persistence seam. It is not the
whole `@medusajs/currency` source tree, the reproducibly measured 65-input
semantic graph copied without classification, or either broader exploratory
static/Drizzle graph snapshot.

This record supplied the source/capability constraints for the now-complete
private value-only `RelationalSchema` slice recorded in
[`08-relational-schema-value-contract.md`](./08-relational-schema-value-contract.md).
It is not the later package-promotion
source map required by
[`04-medusa-fork-source-island-and-package-convergence.md`](./04-medusa-fork-source-island-and-package-convergence.md),
which must additionally freeze every promoted target file, dependency, test,
license obligation, and allowed semantic change after the earlier three-lane
gates pass.

The machine-readable companion is
[`medusa-capability-source-map.json`](./medusa-capability-source-map.json).

## Source Authority And Reproducibility

| Item | Exact value |
| --- | --- |
| Primary repository | `https://github.com/agmmdotdev/medusa-fork.git` |
| Fork commit | `48d5cc675e4e8bc821e22c20c88a751acc66fb5f` |
| Package baseline | `2.13.4` |
| Source root | [`third_party/medusa/upstream`](../../../third_party/medusa/upstream) |
| Source receipt | [`third_party/medusa/SOURCE.json`](../../../third_party/medusa/SOURCE.json) |
| License | MIT, retained at [`third_party/medusa/upstream/LICENSE`](../../../third_party/medusa/upstream/LICENSE) |

Official Medusa `v2.13.4` remains historical provenance and comparison
evidence. The source-island receipt records no proven Git merge base between
that official release and the selected fork. Only the fork pin above defines
the integration behavior audited here.

The following read-only commands passed against the exact island on
2026-09-01:

```text
pnpm medusa:check:real-module-imports
  Real Currency module audit: 65 bundled inputs, 0 Worker blockers

pnpm medusa:check:portable-entrypoints
  emit-events: 5 bundled inputs
  utils modules-sdk portable: 43 bundled inputs
  modules-sdk static-app: 46 bundled inputs
  remote-query portable: 5 bundled inputs
```

These receipts prove only the named physical import graphs. They do not prove
unchanged package relocation, PostgreSQL behavior, Flarex persistence, or
production Worker compatibility.

## Exact Currency-Owned Inputs

| Source | Meaning | Reuse decision |
| --- | --- | --- |
| [`package.json`](../../../third_party/medusa/upstream/packages/modules/currency/package.json) | Package identity and four exports: normal module, models, services, and static manifest | Preserve identity only when the later promotion map requires it; do not copy the current build closure blindly |
| [`models/currency.ts`](../../../third_party/medusa/upstream/packages/modules/currency/src/models/currency.ts) | Six authored fields; text `code` is the primary key, `code` and `name` are searchable, and `rounding` is BigNumber | `unchanged` semantic input |
| [`create-big-number-properties.ts`](../../../third_party/medusa/upstream/packages/core/utils/src/dml/helpers/entity-builder/create-big-number-properties.ts), [`create-default-properties.ts`](../../../third_party/medusa/upstream/packages/core/utils/src/dml/helpers/entity-builder/create-default-properties.ts), and [`define-property.ts`](../../../third_party/medusa/upstream/packages/core/utils/src/dml/helpers/entity-builder/define-property.ts) | `raw_` BigNumber companions, implicit timestamps, database-current-time insert/update behavior, and the active-row `deleted_at IS NULL` index | `unchanged` semantic input; physical lowering remains `adapterTranslated` |
| [`services/currency-module-service.ts`](../../../third_party/medusa/upstream/packages/modules/currency/src/services/currency-module-service.ts) | Generated `MedusaService` surface plus recursive lowercase normalization of `code` filters | `unchanged` control and result behavior |
| [`static-manifest.ts`](../../../third_party/medusa/upstream/packages/modules/currency/src/static-manifest.ts) | Module definition, model, module service, empty loader/repository lists, and model-derived Joiner metadata | `unchanged` manifest; `seamAdapted` bootstrap |
| [`index.ts`](../../../third_party/medusa/upstream/packages/modules/currency/src/index.ts) | Normal module entry including the initial-data loader | Defer activation but preserve as a named compatibility input |
| [`loaders/initial-data.ts`](../../../third_party/medusa/upstream/packages/modules/currency/src/loaders/initial-data.ts) | Lowercases and upserts the default currency dataset, but catches failure and logs a warning | Dataset is `unchanged`; readiness behavior is `adapterTranslated` because warning-only failure cannot establish installation readiness |
| [`InitialSetup20240228133303.ts`](../../../third_party/medusa/upstream/packages/modules/currency/src/migrations/InitialSetup20240228133303.ts) and [`Migration20240624082354.ts`](../../../third_party/medusa/upstream/packages/modules/currency/src/migrations/Migration20240624082354.ts) | Historical MikroORM/PostgreSQL structure | `discarded` as fresh-install execution; retained as semantic evidence |
| [`drizzle-sqlite/0001_currency.sql`](../../../third_party/medusa/upstream/packages/modules/currency/src/migrations/drizzle-sqlite/0001_currency.sql) | Generated SQLite baseline | `discarded` as target DDL; retained as compiler/proof evidence |
| `src/types/index.ts` and `src/services/__tests__/noop.ts` | Compile-only or no-op files | `discarded` unless a later exact consumer appears |

The package TypeScript configuration currently includes all `src`, including
legacy migration classes. A later Worker-facing promotion must therefore use
an explicit source and build map. Copying the package directory or reusing its
current broad compile target would retain an unwanted Node/MikroORM edge.

## Connected Graph Evidence

| Graph | Evidence | Consequence |
| --- | --- | --- |
| Real Currency model/service | Reproducible accepted receipt: 65 inputs comprising 3 Currency files, 61 mature `core/utils` files, and `bignumber.js`; zero checked Worker blockers | This is the minimum measured semantic runtime graph, not a package boundary |
| Currency static manifest | Exploratory audit snapshot observed 76 inputs, but this record has no checked-in command, bundler/version, alias, and externalization policy that reproduces it | Static bootstrap adds a real container/module seam; exact closure size is not accepted evidence and must be regenerated by the later promotion map |
| Existing Drizzle Medusa adapter | Exploratory audit snapshot observed 130 inputs and an eager Inventory/Pricing/RBAC edge, but this record has no complete reproducible measurement policy | Reject unchanged promotion because the eager domain edges are source-observed; the exact closure size/categories are not accepted evidence |

The checked-in real-module audit owns only the first count and Worker exclusions at
[`audit-real-module-imports.mjs`](../../../third_party/medusa/upstream/apps/medusa-cloudflare/scripts/audit-real-module-imports.mjs).
The two broader numbers are retained only as exploratory discovery notes. A
later source refresh or promotion must add a reproducible command and exact
tool, entrypoint, alias, and externalization policy before using either as an
accepted receipt.

## Currency Schema Facts That Constrain `RelationalSchema`

The mature DML adds physical meaning beyond the six authored properties:

- `rounding` creates a `raw_rounding` companion that preserves BigNumber
  configuration;
- every model gains `created_at` and `updated_at` with database-current-time
  insert defaults plus nullable `deleted_at`; repository lowering also refreshes
  `updated_at` on update;
- mature PostgreSQL lowering adds a B-tree active-row index over `deleted_at`
  with the typed predicate `deleted_at IS NULL`; this is distinct from the
  model's searchable markers;
- the authored `code` primary key means a generic `id` column cannot be
  assumed;
- `searchable` is a query capability marker and must not be silently mistaken
  for a normal B-tree index; and
- PostgreSQL numeric/JSONB/timestamp semantics are the target evidence, while
  SQLite REAL/TEXT/integer timestamp spelling remains only a proof dialect.

The first value-only schema fixture therefore needs source provenance for:

```text
table identity: currency
authored fields: code, symbol, symbol_native, name, decimal_digits, rounding
derived field: raw_rounding
implicit fields: created_at, updated_at, deleted_at
primary key: code
nullability and defaults
logical BigNumber expansion
searchable capability markers
managed updated-at behavior
active-row deleted_at partial index
PostgreSQL-oriented numeric, JSON, and timestamp intent
```

No DDL, query implementation, repository, seed execution, or event behavior is
authorized by representing those values.

## Capability Map

`supported` below means source-admitted for the named future private profile,
not implemented Flarex support.

| Capability | Disposition | Reuse classification | Boundary |
| --- | --- | --- | --- |
| Mature `@medusajs/utils/dml/model` grammar | Supported as schema-normalization authority | normalization `unchanged`; physical lowering `adapterTranslated` | Medusa adapter emits value-only `RelationalSchema`; Flarex core never imports DML |
| Standalone `@medusajs/dml` | Rejected as grammar authority | `discarded` except exact structural evidence | Its builder remains scalar-only and cannot replace the mature relationship grammar |
| Currency generated service behavior | Supported for later Currency closure | `unchanged` | Preserve retrieve/list/list-and-count/create/update/delete/soft-delete/restore and filter normalization |
| Mature DAL/repository contracts | Currency subset supported later; graph replacement/custom queries deferred | control `unchanged`; transaction `seamAdapted`; storage `adapterTranslated` | Preserve mature return/error/order behavior behind a narrow Flarex store |
| Portable DAL experiment | Rejected as mature behavior authority | helper evidence retained; simplified service/repository `discarded` | No-op memory transactions and reduced repository behavior cannot establish parity |
| Static manifests and module preparation | Supported for later first closure | manifest `unchanged`; container and preparation `seamAdapted` | Return immutable module-scoped preparation; no process-global mutable prepared models |
| Current global module/model registries | Rejected | `discarded` | Replace `preparedModuleModels` and global `MedusaModule` state before multi-module or multi-scope use |
| `Context.transactionManager` propagation | Contract supported after transaction-owner gate | `seamAdapted` | Reuse nested context with an opaque scoped Flarex manager; never expose the physical session or finalizer |
| D1 statement transaction host | Rejected for atomic claims | `discarded` as target; retained as proof | Statement grouping is not a genuine transaction |
| Durable Object SQLite host | Deferred proof evidence | future storage translation only | Nested reuse/rollback evidence does not replace PostgreSQL proof |
| Module migrations | Deferred | lifecycle `seamAdapted`; execution `adapterTranslated`; legacy mechanics `discarded` | Flarex migration coordinator owns digest, lease, readiness, recovery, and activation |
| Query/RemoteJoiner | Deferred | direct-entry semantics may remain `unchanged`; orchestration `seamAdapted`; queries `adapterTranslated` | The portable runtime proves one direct entrypoint, not full Query parity |
| Currency Joiner metadata | Supported as configuration evidence | `unchanged` | Preserve aliases/linkable keys; it creates no stored Module Link |
| Stored Module Links | Deferred | semantic decisions `seamAdapted`; storage/migrations `adapterTranslated` | First real Link needs both modules, explicit stored identity, lifecycle, and database-enforced cardinality/uniqueness |
| Workflows | Deferred | DSL/control selectively `unchanged`; registries `seamAdapted`; stores/scheduler `adapterTranslated` | Never hold a SQL transaction or commerce lock across pauses or remote effects |
| Locks | Deferred | selection `seamAdapted`; provider mechanics `adapterTranslated`; in-memory production use `discarded` | Exact distributed lock contract and loss/recovery proof require their own gate |
| Idempotency | Deferred; universal store rejected | domain/workflow contracts retained; durable storage `adapterTranslated` | Workflow, payment, and notification identities remain separate owner contracts |
| Events | Deferred until typed commit-owner admission | aggregation/order selectively `unchanged`; storage/delivery `adapterTranslated`; global in-memory transport `discarded` | Commerce event intents must commit with row receipts and the common Flarex outbox wake |

## Exact Source Consequences

### Module state

The current Drizzle adapter stores prepared module models in mutable module-
global state, and `MedusaModule` retains global instances, modules, links, and
Joiner state. Neither structure may cross promotion as scope or tenant
authority. The later seam must produce an immutable `PreparedModulePersistence`
bound to one module set and one host composition.

### Transactions

The mature transaction decorator reuses `Context.transactionManager` when it
exists and otherwise asks the repository to create one. Preserve that nesting
decision. The Flarex adapter later supplies an opaque manager pinned to scope,
owner capability, generation, installation, binding, and transaction lifetime;
it does not hand Medusa a `pg`, Drizzle, raw SQL, commit, feed, or outbox handle.

### Migrations

The source migration loader is lifecycle evidence, but the fork's generated
Drizzle migration object deliberately does not implement executable run/revert
behavior. Historical MikroORM SQL and generated SQLite SQL are neither the
Flarex plan nor startup authority. Fresh installation compiles a baseline;
later semantic transformations remain Medusa-owned plan input executed through
the Flarex migration coordinator.

### Initial data and readiness

The static manifest omits the normal Currency loader, while the retained
Currency integration suite assumes the default 123-currency dataset. A future
installation must admit that dataset/backfill explicitly and make its receipt
part of readiness. The current loader's caught warning is not sufficient.

### Event identity

Generic mutation-event extraction in the generated service path appears to
read `entity.id`, but Currency's primary key is `code`. No Currency event-intent
family is admitted until its exact identity, operation ordering, and retained
tests are frozen in the separate commit-owner preflight.

## Retained Evidence Inventory

- [`static-manifest.spec.ts`](../../../third_party/medusa/upstream/packages/modules/currency/src/__tests__/static-manifest.spec.ts)
  proves static model/service/Joiner parity with the normal module.
- [`currency-module-service.spec.ts`](../../../third_party/medusa/upstream/packages/modules/currency/integration-tests/__tests__/currency-module-service.spec.ts)
  contains 13 unchanged tests for linkability, list/count/paging/selection,
  recursive lowercase filters, retrieval, and failure behavior.
- [`verify-currency-integration-shadow.mts`](../../../third_party/medusa/upstream/scripts/test-runner/verify-currency-integration-shadow.mts)
  pins that suite and expects PostgreSQL, PGlite, and Drizzle parity.
- [`check-workerd-currency.mjs`](../../../third_party/medusa/upstream/apps/medusa-cloudflare/scripts/check-workerd-currency.mjs)
  proves a broader write lifecycle only with D1 statement semantics.
- [`currency-proof-do.ts`](../../../third_party/medusa/upstream/apps/medusa-cloudflare/src/currency-proof-do.ts)
  proves nested read-your-writes and rollback in Durable Object SQLite.

The unchanged 13-test Currency suite is primarily read-oriented. Fork-specific
proofs currently own write and rollback evidence. Genuine PostgreSQL Currency
behavior remains unverified in the admitted receipt because the previous lane
lacked `DB_PASSWORD`; PGlite and SQLite are not substitutes.

## Package Direction

The later active graph may retain Medusa package identities where compatibility
requires them, but it must obey this direction:

```text
promoted Currency semantic/static closure
  -> promoted mature Medusa contract and service slices
  -> Medusa-owned Flarex adapter seam
  -> narrow private Flarex schema/transaction/store/finalization contracts

Flarex core
  -X-> Medusa packages or source island
```

The existing source island stays inert. No active package may import it by
path, workspace alias, package name, generated output, or runtime fallback.

## Stop Conditions

Stop for a new bounded preflight if work would:

- promote Currency before every prerequisite in
  [`05-core-first-three-lane-readiness.md`](./05-core-first-three-lane-readiness.md)
  passes;
- copy the complete Currency package or eager Drizzle graph without an exact
  promotion source map;
- replace mature DML with the standalone portable experiment;
- put Medusa types or semantics inside `RelationalSchema` or Flarex core;
- preserve process-global module/model state as scope authority;
- execute historical migrations or the warning-only seed loader as readiness;
- infer generic `id` event identity for Currency;
- treat D1, DO SQLite, or PGlite as genuine PostgreSQL evidence; or
- activate an adapter, write path, route, public API, hosted path, or production
  binding.

## Next Authorized Slice

This audit, the exact Payload contract audit, and the private value-only
`RelationalSchema` contract are complete. The design-only relational
installation/readiness/availability and structural migration gate is also
accepted in
[`09-relational-installation-and-migration-coordination.md`](./09-relational-installation-and-migration-coordination.md).
Its first pure value checkpoint remains ahead of every DDL, target execution,
binding, transaction, package-promotion, and Medusa adapter/runtime gate in the
order described by
[`05-core-first-three-lane-readiness.md`](./05-core-first-three-lane-readiness.md).
