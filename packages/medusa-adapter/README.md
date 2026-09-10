# Private Currency compatibility

This private adapter translates the pinned fork's actual Currency DML and runs
its unchanged service through Flarex-owned installation, initialization,
transactions and shared relational publication. Core metadata is reusable;
Currency fields, query grammar and the 123-row default dataset belong here.

The promoted private `@medusajs/*` packages preserve selected fork semantics at
version 2.13.4. Their `source` export condition supports the portable graph;
default exports select local checked Node builds for the comparison lane. Broad
root framework/utils imports and runtime source-island aliases are absent.

Private workflow composition also supports named conditions, stable renamed
step instances and a shared checked graph step. The
[Variant Image workflow](../../roadmaps/workflow-foundations/14-conditional-variant-image-workflow.md)
executes add, remove and any thumbnail update in one existing transaction.
Association results describe requested IDs; only an actual thumbnail update
emits its internal module event. Durable suspension and parallel execution
retain separate preflights.

From the workspace root:

```sh
pnpm medusa:currency:build
pnpm medusa:currency:typecheck
pnpm medusa:currency:test:guards
pnpm medusa:currency:verify
pnpm medusa:currency:test:pglite
pnpm medusa:currency:test:postgres
pnpm medusa:currency:test:live:pglite
pnpm medusa:currency:test:live:postgres
```

The PostgreSQL command requires `FLAREX_POSTGRES_DATABASE_URL` for a database
where the test role can create its own schema. Tests use generated schema names
and remove their resources through Effect Scope. PGlite uses one in-memory
connection per fixture. The commands without `live` use the original comparison
repositories. Live commands run all thirteen unchanged service assertions and
private write, replay, failure, cancellation and retention scenarios through
Flarex. They share one seeded target per suite; PGlite keeps a separate control
instance because control and target transactions require independent leases.

The promotion manifest in `roadmaps/flarexdb-framework-integration/preflight/`
enumerates source hashes, reviewed transformations, licenses, dependencies,
exports, the exact legacy test alias, and generated JavaScript/declaration/map
hashes. A build uses deterministic LF output. Available outputs are verified;
their absence is permitted for source-only admission. After changing an admitted
input, review its transformation and update its exact target/build hashes. New
paths or exports require explicit manifest admission; do not expand a wildcard
or copy a new framework barrel to make a missing dependency resolve.

All thirteen promoted Currency/Product test files now import Vitest explicitly.
Their package-local test configurations enable strict checking, checked indexing
and exact optional properties, and include all six Product fixture files. The
adapter compiler also includes the Product wrapper files. `build` and `typecheck`
run the adapter, Currency compatibility, composite and Product test projects.
The Currency/CMS/Application composite fixture retains its existing persistence
test compiler settings in `tsconfig.composite.json`.

The pinned source island remains unchanged. Runnable copies are maintained test
ports: the promotion guard compares their executable structure after type
erasure, preserving fixture calls, assertions, case names and skips. It permits
explicit Vitest imports, the exact Currency timeout relocation to configuration,
the exact Currency static-export import relocations, and local unused-result
markers. The Jest runtime shim and legacy ambient declarations are removed.
[Record 48](../../roadmaps/flarexdb-framework-integration/preflight/48-medusa-test-promotion-cleanup.md)
owns the complete file inventory and validation receipts. Historical records of
byte-identical runnable copies describe their earlier checkpoints.

The live profile is deliberately bounded: one table, one text primary key,
256 catalog rows, selected Currency queries and no domain-event family. Native
contention uses distinct connections; the PGlite publication barrier is a
separate cancellation proof. Product has its own profile below; stored Module
Links, arbitrary module queries and public/production adapters remain gated.

## Private Product compatibility

Product now uses its complete ten-model/thirteen-table DML installation and a
bounded local create/read, related-entity and graph-mutation profile. The
unchanged service supports standalone options/values/variants, images, root
categories, existing associations and checked relation filters/population
through shared Flarex transactions. Keyed updates, upserts and graph replacement
preserve retained identities, metadata merging and operation-authenticated events.

Record 34 adds physical root deletion, Product soft deletion/restoration and
deleted-row visibility. Managed lifecycle requires explicit core admission;
the adapter selects cascades from actual DML while core owns timestamps and
complete row facts. Shared references survive. Deleting a referenced type or
collection clears the Product reference; root category deletion reranks siblings.
An explicit variant-image assignment retains its physical FK refusal during
Product deletion. The bounded Category tree profile is admitted by Record 42.
Business events use the authenticated in-memory test buffer after
acknowledged commit; no durable provider or query sync is activated.

Run `pnpm --filter @flarex/medusa-adapter test:product:upstream` from the workspace
root. It uses the explicit private Product scale profile and runs 205 original
cases from ten pinned integration files, including the 1000-image ordering case.
Only the original upstream performance skip remains. Set `FLAREX_TEST_DRIVER=postgres` and
`FLAREX_POSTGRES_DATABASE_URL` for the same ordinary-role PostgreSQL proof.
All ten files share one installed fixture per driver and clear business rows
between cases. The case inventory and records 29-46 in the framework-integration
roadmap distinguish current coverage from the remaining module capabilities.

Record 35 keeps the original profile and its hashes unchanged. Its explicit scale
contract admits 2048 catalog/query rows and transaction facts, 256 rows per
insert/update statement, 1024 local messages, 2048 calls, 4 MiB retained bytes
and 32768 foreign-value nodes. The original 64 SQL statement ceiling, row size,
filter complexity, and command/statement deadlines remain unchanged. Delete and
lifecycle operation inputs and predicate operand sets remain bounded at 256;
this does not admit arbitrary operations over every graph that fits the catalog.

The focused `vitest.product-scale.config.ts` lane combines the unchanged scale
case with complete facts/events/replay, write-boundary, late-failure,
cancellation, and oversized-value checks using one installed fixture. Its
telemetry observes the real request owner and awaited Drizzle queries.

Record 37 adds complete Product Types compatibility: authenticated list, count
and retrieve commands, scalar value filtering, and Type primary-key retention
when projecting selected fields. The unchanged 13-case file covers reads,
pagination/count, not-found errors, creation, updates and deletion.
Run `pnpm --filter @flarex/medusa-adapter exec vitest run --config vitest.product-types.config.ts`
for those 13 originals plus two focused scope-isolation and input-refusal checks.
The same driver environment selects PostgreSQL.

Record 38 adds complete Product Tags compatibility. It admits bounded Tag ID
references on Product creation, Tag list/count/retrieve and scalar value queries,
and inverse Products reads with optional Collection population. Selected fields,
primary keys, Collection foreign keys and null/empty relations follow the pinned
service. Other relation paths remain unadmitted.
Run `pnpm --filter @flarex/medusa-adapter exec vitest run --config vitest.product-tags.config.ts`
for 15 unchanged originals plus three scope, input and rollback checks.
Tag upserts may echo a complete created_at/updated_at/deleted_at trio only when
it exactly matches the existing scoped row; the adapter removes those echoes
before the service call. Stale/forged/new-row echoes are refused and managed
columns remain non-writable. This is a bounded compatibility policy, not general
Tag DTO or query parity. Record 39 continues with Collections.

Record 39 adds the complete 18-case Product Collections suite. Collection reads
admit ID, title and handle equality filters and a bounded Products projection.
Creation attaches existing scoped Products; updates retain Medusa's own
association/dissociation sequence. The private Collection composition reads the
complete resource-bounded Product catalog for internal membership selectors.
Omitting product_ids preserves membership; an empty array clears it. A Product
can move between Collections without deleting its row. Missing creation
references fail; update selectors preserve Medusa's behavior of ignoring absent
IDs. Repeated Product references in one create batch and overlapping Product
update pairs in one upsert batch remain outside this bounded profile.

Run `pnpm --filter @flarex/medusa-adapter exec vitest run --config vitest.product-collections.config.ts`
for all 18 original cases plus four scope, rollback, membership and publication
checks. At that checkpoint, original files stayed byte-identical under the then-current compiler
policy. The Collections checkpoint brought the combined gate to 102 original
passes plus one retained upstream skip. The following Options slice is recorded
below. See
[Record 39](../../roadmaps/flarexdb-framework-integration/preflight/39-medusa-product-collections.md).

Record 40 adds the complete 13-case Product Options suite: list/count/retrieve,
bounded ID/title/product_id filters, selected Product projections and standalone
Option deletion. Checked DML supplies parent keys and deletion dependencies.
Products and Variants survive Option deletion; dependent Values and pivots have
complete deletion facts, while Medusa emits only the root Option deletion event.
Creation, value normalization and updates continue through the existing service.

Run `pnpm --filter @flarex/medusa-adapter exec vitest run --config vitest.product-options.config.ts`
for 13 originals and four scope, cascade/rollback, replay and input-refusal checks.
At the Options checkpoint, the combined gate covered 115 originals plus its
retained upstream skip. Record 41 continues with Variants.
[Record 40](../../roadmaps/flarexdb-framework-integration/preflight/40-medusa-product-options.md)
owns the exact scope and final receipts. Record 48 supersedes that checkpoint's
runtime/source-hash compiler policy with strict maintained test ports.

Record 41 adds the complete 15-case Product Variants suite, including scoped
parent projection and title filtering, Medusa-owned image selection, exact
image-assignment removal and Variant soft deletion. Assignment removal preserves
images and emits relational facts without business events. Soft deletion preserves
shared Option Values and pivots and emits the authenticated Variant event.
The focused gate includes four additional boundary checks for scope, rollback,
replay, dependency survival and refusal without publication.

Run `pnpm --filter @flarex/medusa-adapter exec vitest run --config vitest.product-variants.config.ts`.
Both drivers pass the 19-check focused gate and the seven-file combined gate of
130 originals plus one upstream skip. Final receipts are tracked in Record 41. After Variants, 75
unregistered declarations remain across three files; the following public Categories slice is recorded below. Workflow, Module Link, durable events, public serving, broader Payload
integration and production activation retain their separate gates.

Record 42 adds the complete 21-case public Product Categories file. The promoted
portable Category service owns tree hydration, ranks, parent moves, descendant
paths and leaf deletion. Its adapter provides scoped repository operations and
reference-only Product membership. Category commands reject forged paths, cycles,
ambiguous dotted IDs and the source service's reserved `__root__` rank key.
Category soft deletion and restore remain unadmitted.

Run `pnpm --filter @flarex/medusa-adapter exec vitest run --config vitest.product-categories.config.ts`.
The focused lane adds scope, late rollback, membership survival, batch maintenance,
replay and input-refusal checks. Category read DTOs use a private representation
codec to preserve recorded own undefined properties across the JSON host boundary.
The codec does not infer tree values. Shared core transaction/publication owners
are unchanged. See
[Record 42](../../roadmaps/flarexdb-framework-integration/preflight/42-medusa-product-categories.md)
for validation and source provenance. The two internal Product/Category files
are also complete; [Record 46](../../roadmaps/flarexdb-framework-integration/preflight/46-commerce-command-registration-bound.md)
owns the complete compatibility baseline. Workflow, Module Link, durable events,
public serving, broader Payload and production retain their independent gates.

The [shared persistence adapter preflight](../../roadmaps/flarexdb-framework-integration/preflight/47-medusa-shared-persistence-adapter.md)
now supplies shared read capability across Currency and Product. The internal
`src/query/` owner captures immutable checked metadata, compiles predicates and
projections, and executes reads on the existing scoped manager. Module read
profiles retain admission, projection and ordering differences; Category and
Collection membership use pure domain selection over complete bounded catalogs.
The old Product parent/inverse planners are removed. Both modules also consume
the pure `src/schema/` compiler for checked DML columns/defaults, keys, indexes,
foreign keys and persistence capabilities. Closed module admission and source
provenance remain explicit; canonical schema artifacts are unchanged. Exact
numeric companions carry explicit field and capability identities. This internal
compiler does not admit another module or install a schema. The shared
`src/write/keyed.ts` compiler now assembles admitted single-text-key update
pairs for both modules. Profiles retain decoding order, key and duplicate
policy, field admission and later scalar conversion. It does not acquire a
store or settle a transaction. Metadata-field JSON decoders share
`commerceRowDecoder`. Product creation and replacement now use the internal
`src/write/create.ts` and `src/write/replace.ts` graph owners, with checked key
metadata and explicit `product-graph-profile.ts` traversal, ownership,
membership and projection policies. Shared plans retain the existing scoped
manager and produce results/actions from actual storage receipts. Renamed
Volume/Edition/Label fixtures exercise reuse without admitting another module.
`commerce-mutation-events.ts` now owns request-local subscriber tracking and
the Effect boundary around pinned Medusa dispatch. Product retains event
admission, lifecycle payloads and authenticated local-event policy; Currency
keeps its existing event-free service path. Numeric representation, stored
metadata merging retain their respective owners. `commerce-module.ts` now binds
both modules to the pinned model-preparation and repository-constructor contract.
The private registration admits exact model identities and preserves DML objects;
constructors borrow existing request-owned repositories. Product retains its
specialized Category service and restricted image-product alias. Connection
loaders and custom-repository discovery refuse; Flarex still owns installation.
This is per-module request composition, not a combined module-set bootstrap.

## Prepared module composition

`src/module-definition.ts` provides the private `defineCommerceModule` factory.
It returns an Effect `Result` containing a prepared definition or a
`CommerceModuleDefinitionError` with the module, reason and diagnostic detail.
Preparation captures the model set, profile name/capabilities, extension
declarations and factory callback selection. Method callbacks retain their
original receivers; arbitrary receiver or closure state is not snapshotted.
Preparation constructs no repository or live service.

The integration supplies one profile that binds its existing admitted repository
implementation to a command. Default internal services are derived from the DML
model names using the pinned Medusa naming convention. The main service factory
receives their inferred types and supplies the existing Medusa business service.
Applications do not assemble repositories or select internal profiles from input.
Literal model tuples infer required service keys. Dynamic arrays and
union-selected entries expose potentially absent services as optional.

```ts
const prepared = defineCommerceModule({
  name: "library",
  models: [Volume],
  profile: libraryProfile,
  extensions: {},
  service: ({ baseRepository, services, context }) => ({
    service: new LibraryService({ baseRepository, ...services }),
    context,
  }),
});
// At setup: enter the Effect error channel with Effect.fromResult(prepared).
// Inside an already-authorized command:
// module.use(ctx, ({ service, context }) => service.listVolumes({}, {}, context));
```

Named extensions explicitly `add` a service or `replace` one generated service.
Their record accepts only own enumerable string data properties; symbol,
non-enumerable, accessor and inherited declarations refuse during preparation.
Preparation rejects accidental collisions, missing replacement targets, duplicate
models/naming collisions, and missing declared profile capabilities. Extensions
are independent constructors: they receive the command's binding, persistence
adapter and Promise owner, not other extensions or a general service locator.
Their declared order is construction order. They cannot silently override one
another. Capability declarations describe implemented adapter features; they do
not grant schema, table, transaction or publication authority.

`description` is an immutable diagnostic snapshot of models, generated names,
profile capabilities and extension choices. `use` delegates to the existing
service bridge, creates fresh command-owned services, and closes them on exit.
Escaped DAL calls still fail through the Promise owner. Medusa's native context
argument remains explicit in this private callback; the existing public Currency
facade retains its own context-free host boundary.

`src/product-module.ts` owns Product's Category mutation-interceptor cycle, local
event adapter and explicit image-service alias. Ordinary Product services and
repositories need no repeated registration list. Read profiles, codecs, commands,
schema admission and business behavior retain their existing owners. Inference
preserves declared model names and native service/extension types; this factory
does not infer finer query projections from runtime string catalogs or create a
new public module API. The alias lists every allowed DAL method explicitly, so
additional repository methods cannot acquire permission through object spreading.
