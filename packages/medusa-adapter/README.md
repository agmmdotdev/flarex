# Private Currency compatibility

This package translates the pinned fork's actual Currency DML into Flarex's
existing relational schema value contract. It does not install or serve Currency
through Flarex, confer transaction authority, or publish commerce changes.

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
```

The PostgreSQL command requires `FLAREX_POSTGRES_DATABASE_URL` for a database
where the test role can create its own schema. Tests use generated schema names
and remove their resources through Effect Scope. PGlite uses one in-memory
connection per fixture. The thirteen unchanged read assertions share one seed;
the separate isolation test requires two independent fixtures. These are original
comparison repositories, not Flarex persistence implementations.

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

The next owner is the Currency commerce-host capability: exact installation and
provenance, bounded query/seed policy, transaction propagation, and typed outer
publication. Product and stored Module Links follow that service proof.
