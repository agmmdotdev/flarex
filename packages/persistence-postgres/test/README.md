# Persistence Tests

Tests are grouped by the owner whose contract they verify, following the
[source map](../README.md#source-ownership). Find the responsible source folder
first, then use the corresponding test folder.

| Test folder | Coverage |
| --- | --- |
| `database/` | Drivers, physical session behavior, relational transaction profiles and migration resource loading |
| `scope/` | Scope provisioning, authentic resolution, authorization epochs, clock and fencing |
| `installation/` | Protected structure, installation lifecycle, maintenance, framework schema/binding and migration recovery |
| `application/` | Analysis, activation/admission, readiness, relation serving, revisions and write ownership |
| `storage/` | Documents, pending reads, indexes, uniqueness, relation edges, catalog, search and retained history |
| `execution/` | Preparation lifetimes, journal, finite capture, claims, session activation, OCC and recovery evidence |
| `commit/` | Atomic publication, durable outcome resolution, commit feed, event evidence and publication coverage |
| `frameworks/` | CMS and Commerce host contracts, atomic workflow boundaries and supported cross-domain execution |
| `integration/payload/` | Native Payload collection/query/relationship/population behavior against persistence |
| `tasks/`, `sync/` | Their distinct durable run/delivery and change-source contracts |
| `legacy/` | Retained legacy engine/format and migration witnesses |
| `values/`, `api/` | Capture/encoding helpers and public capability refusal |
| `support/` | Shared PGlite/Postgres/runtime fixtures and Worker stubs |
| `performance/` | Measurement probes, attribution support and comparison references |

Owner-specific `*Scenario`, `*Fixture` and `*TestSupport` files stay with that
owner. Import them when needed; do not copy their algorithms into another test
package. Cross-owner fixture dependencies are explicit imports, not production
construction APIs. Historical accepted reports remain under the benchmark owner.

## Driver And Runtime Lanes

An unsuffixed `*.test.ts` may execute PGlite. It is not automatically a unit test.
`*.postgres.test.ts` requires the configured real PostgreSQL endpoint and ordinary
runtime role; a skipped test is not PostgreSQL validation. Explicit
`*.pglite.test.ts` retains the same driver meaning. Restart Worker companions live
with the tests that launch them.

Use the existing [test lane manifest](../../../test-lanes.json) for named
connected lanes and exact selectors. List available lanes from the repository:

```sh
pnpm test:lane:list
pnpm check:test-lanes
```

Run a focused owner from this package, for example:

```sh
pnpm exec vitest run test/execution/preparation --maxWorkers=1 --no-file-parallelism
pnpm exec vitest run test/frameworks/cmsTransaction/cmsHost.test.ts --maxWorkers=1 --no-file-parallelism
```

Use the paired PostgreSQL entry when the claim concerns database transactions,
locking, installation or query plans. Package `test:*` commands and the lane
manifest point to the current paths. Do not run measurement campaigns as ordinary
correctness tests; the [performance roadmap](../../../roadmaps/core-performance/README.md)
owns their scope and interpretation.
