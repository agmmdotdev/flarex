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
| `execution/journal/` | Paired receipt/replay and multi-source scenarios, finite-entry installation/lifecycle and the actual consumer API Worker boundary |
| `execution/session/`, `execution/claims/` | Session activation, exact attempt loading, finite authority, terminalization and authentic claim acquisition/renewal |
| `commit/` | Atomic publication, durable outcome resolution, commit feed, event evidence and publication coverage |
| `commit/point/` | Point publication, finishing, replacement, relation recovery, full-Cause boundaries and the actual lightweight consumer API in Worker |
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

The journal's PGlite cases follow their concrete owners:

| Suite under `execution/journal/` | Contract |
| --- | --- |
| `pointOperations.test.ts` | Pinned table resolution, document operations and authenticated pending visibility |
| `indexedQueries.test.ts` | Pinned indexes, pages, ranges, bounded materialization and replay |
| `receiptEvidence.test.ts` | Receipt/write evidence, exact replay, corruption and defect classification |
| `operationLimits.test.ts` | Exact cumulative ceilings and sticky refusal without partial writes |
| `seal.test.ts` | Two-phase sealing, lease correlation, rollback, retry and drainage |
| `attemptLifecycle.test.ts` | Claim ownership, per-execution failure state, terminal/expired refusal and cleanup |

`journalFixture.ts` owns database construction, authentic scope/installation
setup, seeding, shared journal queries and closure. Each suite has its own
database lifetime. `journalTestSupport.ts` contains the shared value/evidence
helpers; single-owner faults and seal triggers stay with their suite.
`sessionJournalStore.postgres.test.ts` retains real locking, concurrency,
migration, SQLSTATE and transaction witnesses. Paired scenarios share exact
behavior where appropriate; their driver obligations remain distinct.

Point publication tests follow the settlement responsibilities:

| Suite under `commit/point/` | Contract |
| --- | --- |
| `publication.postgres.test.ts` | Atomic publication and accepting-transaction ordering |
| `publicationConcurrency.postgres.test.ts` | Scope lock waits, authorization changes, OCC and repeated dependencies |
| `sidecarPublication.postgres.test.ts` | Intrinsic/developer index and unique writes, limits and atomic rollback |
| `decisionProvenance.postgres.test.ts` | SQLSTATE, rollback, cleanup and uncertain COMMIT provenance |
| `replacement.test.ts`, `replacement.postgres.test.ts` | Authentic conflict replacement and exact attempt transitions |
| `finishing.test.ts`, `finishing.postgres.test.ts` | Finishing authority, lock order, time and rollback |
| `relations.test.ts`, `relations.postgres.test.ts` | Relation publication, conflicts and recovery |
| `promiseBoundary.test.ts`, `observation.test.ts`, `finitePreparation.test.ts` | Full Cause, passive observers and immutable finite preparation |
| `consumerApi.workerd.test.ts` | Every consumer value export loads without SQL construction; copied authority remains invalid |
| `publicationDiagnostics.postgres.test.ts` | Existing CE0 measurement probes; run deliberately under the performance owner |

Point support keeps the actual responsibilities separate: `commandEvidence`
projects genuine stored evidence, `relations` owns relation fixtures,
`postgresFixture` constructs real scopes/attempts/ports and owns file-scoped
database use, `postgresFaults` owns native faults and blockers, and
`postgresDiagnostics` owns existing trace projections. These support modules do
not publish through a second engine. Vitest's per-file isolation preserves the
file-scoped fixture lifecycle. Measurement probes are separate from correctness
acceptance and carry no new performance result merely because their paths moved.

## Session And Claim Lifecycle Tests

The [Session source guide](../src/execution/session/README.md) distinguishes
consumer contracts, trusted construction and bounded native execution.

| Suite under `execution/` | Contract |
| --- | --- |
| `session/activation.test.ts`, `session/activation.postgres.test.ts` | Captured start evidence, authority and exact activation/replay |
| `claims/acquisition.test.ts`, `claims/acquisition.postgres.test.ts`, `claims/renewal.test.ts` | Authentic execution ownership, acquisition and renewal |
| `claims/renewalProjection.test.ts`, `claims/transactionExecutionClaimLiveness.postgres.test.ts` | Pure deadline/retention verdicts and the distinct native liveness operation |
| `session/attemptLoad.test.ts`, `session/attemptLoad.postgres.test.ts` | Exact attempt loading, current authority and locked structure |
| `session/attemptKernel.test.ts`, `session/attemptKernel.postgres.test.ts` | Native callback lifetime, final authority and private syscall boundary |
| `session/terminalization.test.ts`, `session/terminalization.postgres.test.ts` | Abort/expiry, final guards, rollback and cleanup |
| `session/finiteActivation.test.ts`, `session/finiteSession.test.ts`, `session/finiteSession.postgres.test.ts` | Finite entry, continuation/replacement and real authority barriers |
| `session/attemptFacet.test.ts`, `session/terminalStorage.test.ts`, `session/sessionSchema.test.ts`, `session/sessionSchema.postgres.test.ts` | Pure facet projection, retained storage and driver-specific schema obligations |
| `api/publicApi.test.ts`, `session/consumerApi.workerd.test.ts` | Broad-facade exclusion and actual SQL-free Worker loading with copied recovery refusal |

`session/support/activationEvidence` owns pure evidence, while `attemptFixture`
owns the one authentic test claim map. `authorityClock`, `activationFixture` and
`attemptLoadFixture` retain their concrete fixtures. `postgresFixture`,
`postgresLocks` and `postgresFiniteFixture` own native database resources,
blockers and installed/direct profiles. `sessionStorage` and
`terminalStorageScenario` retain the genuine schema/storage scenarios.

PGlite activation suites explicitly close their owned driver. Ordinary Postgres
suites retain file-scoped reset/rebuild/disposal; finite barrier cases retain
their original temporary installed/direct resources and ordinary/provisioning
role gates. Parameterized profiles, native blockers and cleanup order stay with
the tests that exercise them. Discovery lanes list the concrete suite roots.

## Application Lifecycle Tests

The [Application source guide](../src/application/README.md) follows construction,
readiness, activation, preparation and fresh business-request acceptance.
The former combined readiness cases follow the responsibility they actually prove:

| Suite under `application/` | Contract |
| --- | --- |
| `readiness/settlement.test.ts`, `readiness/settlement.postgres.test.ts` | Ordered readiness refusal, settlement/replay, stored evidence and native SQL classification |
| `readiness/physicalCoverage.test.ts` | Required physical structures and exact coverage/correlation |
| `activation/active.test.ts`, `activation/active.postgres.test.ts` | Atomic activation, CAS/replay, head/history integrity and active reads |
| `activation/bindingPreparation.test.ts`, `activation/bindingPreparation.postgres.test.ts` | Authentic capture, detached evidence and fresh transaction-bound acceptance |
| `activation/finitePreparation.test.ts`, `activation/finitePreparation.postgres.test.ts` | Initial, confirmed replacement and cold-recovery evidence |
| `tasks/selectionAndRun.test.ts`, `tasks/admission.postgres.test.ts` | Task selection and admitted durable run behavior |
| `actions/admissionAndLifecycle.test.ts`, `admission/mutation.test.ts` | Their distinct execution authority and lifecycle |
| `queries/snapshot.test.ts` | Query snapshot, point/index reads and exact budget/dependency behavior |
| `activation/casTokenCapture.test.ts`, `activation/databaseBoundary.test.ts` | Real API malformed-input capture and genuine Drizzle SQLSTATE failures |
| `activation/compositePreparationLifetime.test.ts`, `activation/compositePreparationLifetime.postgres.test.ts` | Request/retained ownership through authentic nested relation and policy preparation |
| `activation/consumerApi.workerd.test.ts` | Actual consumer value exports load in Workerd without database construction; cloned authority still refuses |

`support/readinessFixture.ts` constructs the actual control/target installation
and ports and closes only databases it owns. `readinessPostgresFixture.ts` owns
the real driver fixture; provisioning and ordinary runtime roles remain distinct.
Artifacts, publication, preparation and evidence have separate support modules.
Query snapshots, mutation authority and task selection helpers stay with their
test owner. The support code invokes genuine production operations and does not
implement an alternate orchestration engine.

Existing `applicationCurrentPreparation`, `applicationStandaloneBinding`,
`applicationPreparationCatalogIntegrity`, finite correlation, prepared metadata,
relation and write-ownership suites retain their distinct witnesses. Moving
readiness cases does not replace those consumer and failure proofs.

The [connected current Application scenario](../../system-test/support/application/lifecycleScenario.ts)
adds real source analysis/publication, nonactivating candidate readiness, atomic
activation faults, CAS/replay and uncertain-response recovery on both drivers.
It reuses this package's native fixture and detached inspection rather than
reconstructing persistence behavior. See the [system test guide](../../system-test/README.md)
for the driver entries and the distinct historical proof obligation.

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

Package commands separate iteration costs:

| Command | Selection |
| --- | --- |
| `pnpm test:fast` | Curated contracts without database or Worker startup |
| `pnpm test` / `pnpm test:pglite` | Local correctness, including migrations; native PostgreSQL and Workerd excluded |
| `pnpm test:postgres` | Curated ordinary-role PostgreSQL correctness sweep, not every native suite |
| `pnpm test:workerd` | Four consumer API Worker boundary suites |
| `pnpm test:measure:publication` | Opt-in publication measurement campaign, outside correctness/release selections |
| `pnpm test:pglite:runtime` / `pnpm test:pglite:migrations` | Focused driver runtime / migration suites |

The runner explicitly selects the persistence driver and removes inherited
PostgreSQL activation from local lanes. The repository `fast` selector still
runs broad defaults from other packages; use `fast-persistence` for this package's
bounded contract lane. C08-I1 aliases keep their connected system-test step in
that package rather than referring to removed local files.

The PGlite lane builds a fresh schema-only image once per invocation using
`vitest.pglite.config.ts`. Fresh fixtures restore independent databases;
file-backed Worker restarts reopen their modified data, never the baseline.
Direct focused invocations without that config retain per-file image creation.
Historical/upgrade migration tests still create their own fresh databases.
Migration-copy fixtures retain SQL and the journal, omitting generator snapshots.

The row-only legacy runtime/sync suite uses
`useFileScopedPGliteRuntimePersistence` to retain one backend per file. Each
serialized borrow receives a fresh persistence wrapper and prepared runtime.
Reset clears only its runtime/sync rows and preserves installation, protected
metadata and scheduler seed rows. A failed callback or reset rebuilds the backend
from the immutable image. Modern catalog, migration, DDL, session-configuration
and restart cases keep independent fixtures. The shared
`fileScopedPersistenceFixture` owns queueing, drainage and failure rebuilds for
both drivers; each driver retains its own reset/disposal owner. Their lifecycle
contract scenarios are shared too.

Ordinary PostgreSQL suites reuse `useFileScopedPostgresPersistence` where row
reset preserves the required baseline. It drains an outstanding callback and
its reset before another borrow or test, including after caller timeout. Keep
separate fixtures for migrations,
persistent DDL, session settings, or migration-seeded singleton dependencies.
Plan probes use `withPostgresSequentialScansDisabled` to bind `SET LOCAL` and
EXPLAIN to one client and roll back the setting before reuse.
Validate converted suites as whole files, including failure-triggered rebuilds.
`database/postgresRuntime.postgres.test.ts` keeps real installation admission
on its test-owned connection while injecting only transaction-command failures.

API export exclusions and constructor surface guards belong in
`api/publicApi.test.ts`. Prefer assertions in
existing consumer scenarios over separate tests of fixed fixture contents or
helper allocation details. Preserve behavioral, durable-data, rollback and
compatibility witnesses; an old checkpoint label alone does not make one obsolete.

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
