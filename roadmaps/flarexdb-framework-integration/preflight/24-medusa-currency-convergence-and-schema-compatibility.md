# Medusa Currency Convergence And Schema Compatibility

## Decision And Scope

Status: implemented privately. Currency source relocation, actual DML-to-
`RelationalSchema` value compatibility and the unchanged framework baseline are
available after the shared-core, Application and bounded private Payload
prerequisites. This record does not activate a live
Medusa installation, commerce writes or a public adapter.

This is one implementation unit: close the source, type, build and test graphs;
relocate the selected inputs; translate the real Currency model into the existing
value contract; and prove compatibility. Do not turn each dependency, declaration
file or test-harness adjustment into another preflight. Source preservation and
schema translation belong together because a fixture copied from Currency does
not prove that the real framework supplies the same schema.

[Record 25](./25-medusa-currency-host-and-publication.md) now owns the implemented
Flarex-backed Currency service with exact fresh installation, binding,
transaction propagation and shared relational publication. Product relationships and one stored Module Link
follow Currency. General Payload compatibility does not precede these proofs.

The [three-lane plan](./05-core-first-three-lane-readiness.md) owns ordering;
the [fork admission](./04-medusa-fork-source-island-and-package-convergence.md)
owns preservation and promotion policy. The earlier
[capability audit](./06-medusa-package-capability-source-map.md) remains the
semantic source contract. The companion
[runtime inventory](./medusa-currency-runtime-inventory.json) records measured
inputs, hashes and proposed owners; it is explicitly not a complete promotion
manifest or declaration/build closure.

## Source And Current Evidence

The [promotion manifest](./medusa-currency-promotion.json) is the exact active
source/type/build/test map. Seven private `@medusajs/*` packages retain version
`2.13.4`; `@flarex/medusa-adapter` owns the strict, closed Currency translator and
comparison harness. Package barrels expose only selected names. The static
manifest has a source-condition browser graph free of Node, ORM, database and
island runtime imports; default exports select checked local Node build outputs
for comparison tooling. This is bundle evidence, not deployed Worker evidence.

The copied fork compiler profile preserves its original TypeScript 5 defaults
and explicit strict-null/function/this checks. New adapter and harness code uses
the strict Flarex profile. There is no blanket migration of preserved legacy
types. The build map authenticates emitted JavaScript, declarations and maps when
present; source verification also works before dependencies or outputs exist.

The unchanged tests retain their original source bytes. Their test-only runner
alias selects instance-owned composition, the original seed loader and the
original PGlite or MikroORM/PostgreSQL repository semantics. One seed/connection
is shared by the thirteen read assertions in each lane. An additional two-instance
test proves state/container/service isolation. Node comparison entity preparation
retains fork behavior; no global `MedusaModule` registry is activated.

`translateCurrencySchema` consumes every actual property parser and rejects
unadmitted model, property, key, default, index, cascade and capability shapes.
`captureCurrencySchema` reproduces the existing Currency value fixture's canonical
artifact and pinned source provenance. The private persistence value export grants
no live installation, binding, storage or publication authority.

Use fork `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, package baseline `2.13.4`,
under `third_party/medusa/upstream`. Source verification authenticates the entire
island. The original island stays unchanged and excluded from normal root
runtime resolution; active packages must never reach back into it.

The service/model graph has 65 runtime inputs: three Currency sources, 61 mature
utils sources and `bignumber.js`. The static-manifest graph has 76: five Currency
sources, two modules-sdk sources, 68 mature utils sources and that dependency.
These are browser-platform bundle inputs, not package sizes or deployed Worker
proof. The static graph requires the explicit source aliases in the inventory;
allowing installed `dist` resolution instead produces three additional duplicate
utils inputs. Neither measurement includes erased type imports or the complete
bootstrap, repository and compatibility-test graphs.

The unchanged source tests and the thirteen Currency integration assertions run
in the island. PGlite exercises its existing test adapter, not Flarex persistence.
The integration suite establishes linkable metadata, seeded reads, case handling,
selection, pagination/counting and retrieve failures. It contains no create,
update, delete, soft-delete, restore, rollback or Flarex-publication assertions.
Those are covered by the selected Flarex-backed service conformance in record 25;
do not describe these thirteen assertions as complete CRUD coverage.

The exact compatibility sources are:

- `packages/modules/currency/src/__tests__/static-manifest.spec.ts` and the
  retained `src/services/__tests__/noop.ts` source-discovery input;
- `packages/modules/currency/integration-tests/__tests__/currency-module-service.spec.ts`;
- its fixture, normal entry and initial-data loader, plus the test runner and
  selected persistence adapter needed to execute the same assertions;
- the Currency model, module service and static manifest; and
- mature DML helpers, generated-service decorators, DAL contracts and Joiner
  metadata reached by those entries.

Paths in this section are relative to the pinned island. Preserve MIT source
notices and separately inventory third-party versions/licenses. Do not copy the
island's public publish configuration or broad development dependency selectors.

## What The Real Schema Requires

Evaluating `Currency.parse()` and every property parser produces ten fields.
The translation must consume those real values, with explicit source-backed
persistence rules where DML parsing does not contain the physical behavior.

| Input | Required Flarex meaning |
| --- | --- |
| `code` | Non-null text primary key; no invented `id`; searchable marker |
| `symbol`, `symbol_native`, `name` | Non-null text; `name` is also searchable |
| `decimal_digits` | Preserve the accepted PostgreSQL integer lowering and default zero; do not infer arbitrary numeric semantics from the DML `number` label |
| `rounding` | Exact numeric value with zero default and the admitted BigNumber capability |
| `raw_rounding` | Non-null JSONB companion; parsed default is `{ value: "0", precision: 20 }` |
| `created_at`, `updated_at` | Non-null timestamps; PostgreSQL current-time defaults and managed update behavior come from persistence lowering |
| `deleted_at` | Nullable timestamp; active-row index with `deleted_at IS NULL` comes from persistence lowering |
| Searchability | Query capability metadata; never silently manufacture a B-tree search index |

`Currency.parse().indexes` is empty. The translator therefore cannot obtain the
active-row index merely by copying parsed indexes. The accepted lowering evidence
is `utils/src/dml/helpers/entity-builder/define-property.ts`, alongside
`create-default-properties.ts` and `create-big-number-properties.ts`.
Importing MikroORM to obtain these semantics is unnecessary; port their accepted
meaning into the adapter's pure, closed translation and pin it against the
existing `relationalSchema.test.ts` Currency contract.

Completion must prove canonical identity/provenance and deterministic encoding,
exact columns/defaults/nullability/primary key/capabilities, and rejection of
unadmitted models or schema changes. Do not substitute a hand-authored Currency
fixture as the translator's input. Do not claim general DML support from this
one-model translation.

## First Implementation Boundaries

| Owner or source | Disposition and target |
| --- | --- |
| Currency model/service/static manifest | **Keep** semantic behavior in private `packages/medusa-currency` (`@medusajs/currency`); preserve selected compatibility entrypoints |
| Mature utils and type closure | **Port** selected source and required declarations to private `packages/medusa-utils` and `packages/medusa-types`; retain package identity and exact needed exports, not broad root runtime imports |
| Modules-sdk bootstrap and dependency facades | **Port** the necessary definitions/static bootstrap/container contracts to private packages; retain Node-only comparison support behind test entrypoints |
| Framework compatibility imports | **Port** only the named type/default/container/utility facades required by unchanged Currency inputs; do not promote the framework root |
| DML-to-Flarex value translation | **Port** source-backed lowering into a private Medusa adapter owner; Flarex analysis, schema and persistence owners never import Medusa |
| Existing eager Drizzle adapter | **Keep** as island comparison evidence; **rewrite** the selected target persistence seam rather than importing Inventory, Pricing or RBAC into Currency |
| `preparedModuleModels` and global `MedusaModule` maps | **Rewrite** active bootstrap/preparation ownership as instance/module scoped before concurrent target use; preserve isolated Node baseline behavior in its comparison lane |
| Standalone experimental DML/DAL | **Keep** only exact required structural/helpers evidence; do not replace mature DML or service behavior with their reduced implementations |
| Legacy migrations, Node discovery and test database adapters | **Keep** only in isolated comparison tooling where required; no Worker/runtime or Flarex migration authority |
| Existing Flarex schema/coordinator/transaction/finalization owners | **Keep** their current admission rules throughout this first capability |

The runtime inventory is a starting set, not permission to drop type-only
dependencies. Before active imports, complete one exact promotion manifest with
every target file, source hash, dependency/export, declaration/test support file,
license and allowed transformation. Keep target packages private with retained
baseline versions and local workspace edges. Reproduce the existing assertions
through the relocated compatibility harness without a runtime island alias.
Update the root source-island guard only for manifest-admitted target packages;
retain rejection of undeclared Medusa dependencies, cross-workspace source
imports, symlink escapes and kernel-to-framework edges.
Any comparison backend stays test-only and does not become a production fallback.

## Material Boundaries For Flarex-Backed Currency

Current-source checks show why successful relocation cannot be reported as a
working Flarex commerce adapter:

| Current owner | Current rule | Required later capability |
| --- | --- | --- |
| `relationalTransaction/lifetime.ts` | Only one `system` table, text/integer columns, no defaults or additional physical capabilities | Exact Medusa Currency admission and numeric/JSON/timestamp/default/soft-delete behavior |
| `relationalTransaction/model.ts` | One equality predicate, keyset page of at most 32 rows; no count/projection/offset contract | Bounded selected Medusa repository queries with preserved count, projection and ordering semantics |
| `migrationCoordination/canonical.ts` | Non-Payload fresh planning currently requires synthetic artifact provenance | Authenticated live Medusa provenance, exact fresh installation/readiness and binding; never relabel a live model as synthetic |
| `commitPublication/collection.ts` | Any recorded mutation causes `unadmittedFinalization` | Typed commerce row/event participation in the existing outer finalizer, replay and rollback |
| Currency initial-data loader | Warns and continues on seed failure | Explicit installation/seed completion policy before serving; warning-only failure cannot establish readiness |

The existing integration baseline expects 123 seeded currencies, including a
count of 123 and a specific `skip: 5, take: 1` result. Do not shrink that dataset,
change expected counts, copy unbounded scans into the adapter, or raise shared
limits merely to make the suite pass. Define a bounded repository query and seed
policy against the real obligations in the Flarex-backed capability.

Medusa's `InjectTransactionManager` reuses an existing context manager. The
target must authenticate an opaque request-scoped manager and preserve nested
rollback/outer-only settlement; a caller-provided truthy object cannot confer
authority. Generated event aggregation must become admitted event intent under
the outer transaction, with no publication after rollback. Currency lookup
normalization, error messages and result shape remain Medusa-owned.

These are deliberate current capability boundaries, not newly discovered core
defects. They require a commerce-host/finalization preflight before being changed.
The [Currency host and publication proposal](./25-medusa-currency-host-and-publication.md)
now supplies that concrete plan, pending approval. It admits Currency row facts
for bootstrap/private repository writes; the read-only public service requires
no domain events, so nonempty event attempts remain rejected.
No generic relational mutation family, arbitrary SQL port, second commit owner
or automatic cross-framework transaction is proposed.

## Completion And Efficient Validation

The first capability is complete when:

1. The exact relocated source/type/build/test manifest verifies, private package
   builds resolve locally, and root/island boundary checks remain strict.
2. The actual Currency DML drives deterministic Flarex value normalization and
   exact supported/unsupported schema checks, including persistence-derived
   defaults and the active-row index.
3. Unchanged Currency compatibility assertions pass before and after relocation
   on the separately named original persistence lanes. Preserve the original
   MikroORM/PostgreSQL baseline obligation; PGlite is not its substitute.
4. Physical import guards exclude Node/ORM/database dependencies from the selected
   portable semantic graph; no deployed Worker claim follows from bundling alone.
5. Instance/module isolation, unchanged results/errors and the selected bootstrap
   behavior are verified. Broader Query, Link, workflows and event delivery remain
   outside the runtime surface.
6. Focused typecheck, applicable lint and both standing reviewers pass, and the
   source maps/roadmaps describe the resulting executable capability accurately.

Run pure schema/import tests without a database. Share one existing fixture and
runtime per integration lane, preserve the thirteen assertions in one suite,
and run affected driver baselines once after implementation stabilizes. Do not
rerun Application/Payload database suites for source-map or documentation edits;
run them when actual shared behavior changes. Avoid the fork's broad Currency
dependency build selector, which reaches unrelated commerce modules.
