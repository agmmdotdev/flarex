# Private Currency compatibility

This private adapter translates the pinned fork's actual Currency DML and runs
its unchanged service through Flarex-owned installation, initialization,
transactions and shared relational publication. Core metadata is reusable;
Currency fields, query grammar and the 123-row default dataset belong here.

The promoted private `@medusajs/*` packages preserve selected fork semantics at
version 2.13.4. Their `source` export condition supports the portable graph;
default exports select local checked Node builds for the comparison lane. Broad
root framework/utils imports and runtime source-island aliases are absent.

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

The original Currency tests also receive a separate compatibility typecheck using
Vitest's module-resolution model. Unchanged Product test sources are runtime-tested
and excluded from compilation; their authored adapters, boundary checks and
configurations remain typechecked. Record 37 documents the original Type test
diagnostics that prevent extending the Currency compiler lane to that file. New adapter/harness code keeps the strict Flarex compiler
profile. Preserved fork code keeps its original compiler policy. The relocated
Currency/CMS/Application composite fixture retains its original persistence
test compiler settings in `tsconfig.composite.json`; build and typecheck run
that project alongside the adapter production and original-test projects.

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
root. It uses the explicit private Product scale profile and runs 151 exact
original cases from eight unchanged files, including the 1000-image ordering case.
Only the original upstream performance skip remains. Set `FLAREX_TEST_DRIVER=postgres` and
`FLAREX_POSTGRES_DATABASE_URL` for the same ordinary-role PostgreSQL proof.
All eight files share one installed fixture per driver and clear business rows
between cases. The case inventory and records 29-42 in the framework-integration
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
checks. Original assertions stay byte-identical under the existing compiler
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
owns the exact scope and final receipts. Original tests retain the established
runtime/source-hash compiler policy; authored support code is strict-compiled.

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
for final validation and source provenance. The remaining 54 declarations are in
the two internal Product/Category files. Workflow, Module Link, durable events,
public serving, broader Payload and production retain their independent gates.
