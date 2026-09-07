# Private Currency compatibility

This private adapter translates the pinned fork's actual Currency DML and runs
its unchanged service through Flarex-owned installation, initialization,
transactions and shared relational publication. Core metadata is reusable;
Currency fields, query grammar and the 123-row default dataset belong here.

The seven private `@medusajs/*` packages preserve selected fork semantics at
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
profile. Preserved fork code keeps its original compiler policy.

The live profile is deliberately bounded: one table, one text primary key,
256 catalog rows, selected Currency queries and no domain-event family. Native
contention uses distinct connections; the PGlite publication barrier is a
separate cancellation proof. Product, stored Module Links, arbitrary module
queries and public/production adapters remain subsequent capabilities.
