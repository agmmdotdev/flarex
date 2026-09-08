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

The original tests also receive a separate compatibility typecheck using Vitest's
module-resolution model. New adapter/harness code keeps the strict Flarex compiler
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
Product deletion. General category trees remain unadmitted.
Business events use the authenticated in-memory test buffer after
acknowledged commit; no durable provider or query sync is activated.

Run `pnpm --filter @flarex/medusa-adapter test:product:upstream` from the workspace
root. It uses the explicit private Product scale profile and runs 56 exact
original cases from two unchanged files, including the 1000-image ordering case.
Only the original upstream performance skip remains. Set `FLAREX_TEST_DRIVER=postgres` and
`FLAREX_POSTGRES_DATABASE_URL` for the same ordinary-role PostgreSQL proof.
Both files share one installed fixture per driver and clear business rows
between cases. The case inventory and records 29-35 in the framework-integration
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
