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
Native claim acquisition shares its file fixture across ordinary cases,
including independent-scope progress. Its cancellable deadline and started
operations drain before reset; installed finite corruption keeps its own fixture.

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

## Task Fixture Boundaries

Task lifecycle, creation, read and compute-delivery owner tests use current
scope authority and the existing legacy-definition Task rows. Native fixtures
reuse the same scope and Task seed owners as PGlite; they do not run historical
Application analysis or import another test suite. Directory/resolver fixtures
also seed their deployment/scope metadata.

The native read suite reuses the existing file-scoped persistence fixture and
bulk-seeds its representative query-plan population. Paired PGlite read,
creation and lifecycle suites restore isolated migrated images with automatic
cleanup. Native delivery tests keep their distinct pools and deadline policies
because connection replacement and lock settlement are part of the contract.

Historical 0046 schema and 0053 pending-backfill proofs use bounded journals and
the shared Task migration parent with foreign keys enabled. They do not execute
current scope or registration logic. Current Application Task admission and
execution-principal tests retain their separate current-authority fixtures.

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
| `pnpm test` / `pnpm test:pglite` | Local correctness, including migrations; native PostgreSQL, Workerd and the retained relation comparison excluded |
| `pnpm test:postgres` | Curated ordinary-role PostgreSQL correctness sweep, not every native suite |
| `pnpm test:workerd` | Four consumer API Worker boundary suites |
| `pnpm test:measure:publication` | Opt-in publication measurement campaign, outside correctness/release selections |
| `pnpm test:r01-p:pglite` / `pnpm test:r01-p:postgres` | Opt-in retained relation snapshot-support comparison and physical reassessment |
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
Migration-copy fixtures, including historical verifier setup, share
`src/testing/systemTestMigrationFiles` to retain SQL and the journal without
copying generator snapshots.
`support/migrationFixtureSupport` owns temporary folders, journal trimming,
failure injection and restoration. The 0117/0118 scenarios retain their exact
predecessor bounds and target-journal restoration callbacks through that owner.
Refusal checks retain the original SQL message and SQLSTATE inside the public
typed installation failure; later migrations stay outside these exact cutovers.
Native S09 idempotency cases share one serial current-schema fixture; the
0029-to-0030 upgrade and rollback proof keeps its own non-public schema. Its
query-plan settings stay local to the existing checked-out-client transaction.

The completed R01-P comparison lives under `performance/relations`. It retains
both the rejected edge-history candidate and the selected adjacency-version
candidate for the roadmap's explicit reassessment gates. Default correctness
selection excludes `test/performance/relations/**`; `vitest.relation-snapshot.config.ts` and the
named R01-P commands opt in. Current relation paging, definition isolation,
rollback and read-conflict regressions remain with `storage/relations` and
`application/relations`.

The base Vitest configuration keeps transformed modules on disk between runs
with `fsModuleCache`. This caches compilation, not test results or mutable
databases; the migration image is still built afresh for each PGlite invocation.
Use `--fsModuleCache=false` when comparing cold compilation costs.

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

Document revision and relation-edge storage suites use the same lifecycle with
`useFileScopedPGliteStoragePersistence`. Its reset atomically deletes only row,
edge and scope-clock/authority state, preserving foreign keys, deferred pairing
checks and system seeds. Each case still commits and rolls back through the real
transaction owners. Persistent trigger/constraint corruption cases keep separate
backends. Row-only scope-clock cases borrow this same lifecycle; their two
constraint-corruption cases retain independent backends. Other catalog and commit
suites restore fresh databases from the shared
image through `createMigratedPGlitePersistence`; they retain foreign-database
identity witnesses and register runtime/database cleanup rather than migrating
or leaving a backend open for each case.
Current feed and wake schema cases use `useFileScopedPGliteCommitSchemaPersistence`
to share one backend per file. Its transaction deletes wake and feed children,
headers, then the existing storage rows and paired scope authority/clock state.
Unexpected dependants still fail reset and require a rebuild; migration seeds
remain intact. Historical feed and wake cutovers keep independent databases.
The migration suite owns fresh-install replay; feed inventory and floor-default
assertions remain with the feed schema suite.
Control-only scope receipt and metadata cases use `useFileScopedPGliteControlScopePersistence`.
Its transaction deletes provisioning receipts, control scopes, then deployments,
without cascading into other families or changing migration seeds. Unexpected
dependants require a rebuild. Protocol-constraint corruption keeps a separate
database; system authority/clock provisioning uses its own fixture contract.
Shared-scope provisioning and bootstrap cases use
`useFileScopedPGliteScopeAuthorityPersistence`. It composes the existing
authority/clock and control-row deletion operations in one transaction, preserving
deferred pairing and restrictive foreign keys. Generation-constraint corruption
keeps independent databases. Application storage and catalog families stay
outside this fixture's reset policy.
Native receipt reservation and ready-CAS cases keep independent file fixtures,
so migration setup precedes their existing deadlines and the readiness trigger
cannot affect another witness.
Coordinator target/collision and physical-name assignment cases use
`useFileScopedFrameworkCoordinatorPersistence` for their three-table graph.
Reset reuses administrative guard validation and restoration in one transaction,
deletes children before parents and preserves restrictive foreign keys and seeds.
Further graph dependants refuse reset and require a rebuild. Independent
rollback, cross-database identity and persistent constraint-corruption witnesses
keep separate databases; concurrent ensures drain before returning the borrow.
The full coordinator graph profile, `useFileScopedFrameworkCoordinatorGraphPersistence`,
uses that same lifecycle and guard owner for plan/admission/attempt/receipt,
installation/readiness/availability and head/event metadata. Its child-first
deletions keep identity sequences and foreign keys intact. Additive plan-base
sidecars disappear before their referenced readiness and installation rows.
The 17 history-table guards are restored; both mutable CAS heads are deleted
in that same transaction. Row-corruption segments reset only after their
non-healing assertions finish; colliding-ID,
private cross-store authority and persistent constraint-drop witnesses retain
independent databases. The same reset policy is exercised under an ordinary
PostgreSQL schema owner.
Publication preparation, table-only artifact compatibility and table/app-schema
binding cases share one serial file-owned migrated backend, with distinct deployments
and deployment-local allocation frontiers. The table-wide RETURNING-corruption
trigger and suspended table-artifact/combined-plan owners keep independent backends.
The native-time and historical-read logical working-set scenarios retain separate
scope/deployment identities within one file-owned backend. Their budget cases
keep independent backends for suspended driver calls. Transaction observations,
spies and host lifetimes still settle inside each case.
Settled authorization-epoch target failure cases borrow the existing storage
fixture in their own suite. Provisioning, corruption and unmigrated-admission
cases retain independent backends. Raw admission/interruption cases register
backend closure, and interruption releases and drains its pending transaction
before closure.

Scope, catalog and index fixtures use the migrated image. Schema-artifact and
index-definition database cases each share a file-owned backend with distinct
deployment identities and serial execution. Their pure token/driver-fault cases
need no database; the artifact table-drop witness keeps its own backend.
Native immutable index-definition cases share their existing file fixture and
drain contending writes before reset. The TOAST witness owns a temporary table
inside its checked-out client's transaction and rolls it back before release.
Application schema authority, publication and unique-definition suites also
share one serial image-backed database per file. Deployments remain distinct,
aggregate catalog observations select their deployment, and the manifest
corruption witness changes only its own deployment's row.
Stable-table and creation-time definition cases use the same file lifetime;
allocator fault inspection is deployment-qualified. Candidate-validation cases
share their distinct deployment/scope fixtures; the foreign-control identity
witness retains a separate database, and retained hosts close with their test.
Application analysis/relation/task-binding repositories use the same owner,
including automatic cleanup. Instrumented task-binding drivers restore the
image through their existing raw-driver owner. Retained-history suites keep
their original file lifetime and register closure with `afterAll`.
Retained-floor observation and publication cases share their staged commit
seeder, retention policy and lease duration in `retainedHistoryFloorLeaseScenario`.
Classification timestamps and live leases have margins beyond the test budgets;
explicit expired leases and future-commit corruption still use database time.
Application publication also shares one serial image-backed database, with
distinct scope/epoch and analysis identities and scope-qualified observations.
Its concurrent replay work drains before results are inspected.
Constraint-corruption cases retain separate backends rather than sharing rows.
Framework artifact admission, read, list and corruption suites restore one
independent image per case, including cases that drop constraints or tables.
They use the shared fixture directly instead of local construction wrappers.
The allocating Application native-mutation PGlite fixture restores independent
control and target stores and registers cleanup with the current test. Its
PGlite fixture dependency loads only in that allocating path; caller-supplied,
mixed and native fixtures retain their own resource owners.
Point finishing, replacement and relation suites retain their file lifetime
and register the migrated fixture disposer with a static `afterAll` hook.
Commit-feed row cases share one serial image-backed database with distinct
scopes; its two constraint-removal witnesses keep independent backends.
Wake-outbox cases share one database with distinct live scope identities.
Index reconciliation cases share one serial database with distinct canonical
scope identities, including locator-identity cases. Build-state row cases share
one database; constraint and table corruption witnesses keep separate backends.
Developer ordered-index cases also share distinct canonical scopes and scope
their sidecar reads; the SQL-trigger rejection witness retains its own backend.
Their row seeds acquire genuine installation admission before appending.
Metadata-epoch contract cases reuse the image; their fresh-install and predecessor upgrade/failure cases still execute
the original migration chain from their own empty databases.
Bootstrap and split-provisioning PGlite cases use the same fixture and registered
cleanup, retaining independent databases for stored-authority corruption,
orphan-clock proofs and control/target separation.
Recovery discovery and current idempotency/claim boundary cases also restore
independent images with automatic cleanup. Their table-drop witnesses remain
isolated; fresh-install and populated predecessor-upgrade proofs still migrate
their own databases.
Suite setup prepares the baseline before the first case even on direct runs.
Relation build/readiness fixtures also keep independent image restores. Row
seeding acquires installation admission before the scope clock and closes that
admission with its transaction. The Application readiness fixture restores its
owned control, target and foreign-control databases from the image. Supplied
instrumented targets arrive migrated, and callers register their raw-driver
cleanup before wrapping them for faults or observation.
Readiness input-error labels are checked in the existing selected-row scenario
before row corruption, reusing its control and target fixtures.
Journal/session fixtures with raw-driver fault injection pass
`loadDataDir: await migratedPGliteDataDir()` to their existing driver owner and
retain its cleanup. Empty-schema admission witnesses and historical migration
fixtures still start empty and execute their original migrations.

Retained historical verifier repository cases use `legacy/historicalVerifierFixture`:
one image of the copied journal before migration 0064, then an independent
database per PGlite case. Native cases use the existing historical schema option.
They reuse the transaction owner's READ COMMITTED settlement mechanics without
current installation or execution authority. Current runners retain mandatory
admission. The obsolete backend composition case is removed in favor of the
current analyzer composition proofs; lease contention and query ordering share
the existing lease lifecycle case. The connected Client serialization witness
lives in `database/postgresClient.test.ts` with its current installed fixture.
Historical runtime/registration fixtures have a separate schema/runtime gap;
these repository fixtures do not establish their acceptance. The unused verifier
derivation producer and its isolated suite are removed; retained repository,
registration and SHA-adapter proofs keep their separate obligations.
Inert candidate repository cases use this same historical owner. Hash/input
refusal and injected uncertain settlement use only their transaction capability;
they do not allocate a database. Candidate byte ownership, budgets, corruption,
foreign keys and native convergence retain real independent historical stores.
The earlier V1-retirement migration proof uses the journal through 0044 and
retains its fresh-install and nine-table refusal witnesses. Migration 0064
separately proves removal of the later V2 graph.

Single-database redelivery scheduler cases use
`useFileScopedPGliteRedeliverySchedulerPersistence`. Reset restores the exact
singleton captured from the migration image, including timestamps, in one real
transaction. Multi-database and persistent constraint-corruption cases retain
independent backends. Scheduler policy/defaults remain owned by migrations and
production code rather than being reimplemented by fixture reset.
Task compute-delivery fixtures restore the same image through their existing
raw-driver owner and close each borrow immediately. Constraint and evidence
corruption cases retain independent databases.
Task directory, resolver and partition suites follow that same ownership.
Trusted-workflow Task, subject, callback and continuation fixtures also restore
that image through their existing raw-driver owners. Lifecycle-gateway and
compatibility-vector cases do the same. Setup prepares the image before test
budgets begin; deadline targets, native pools and independent stores retain
their own lifetimes.
Repair-scheduler shape refusals share one isolated backend because each rejected
autocommit statement rolls back itself; the fresh migration/idempotency witness
still starts empty. Metadata frame goldens belong in the framing suite; the
SHA adapter retains its known vector and separate boundary/failure coverage.

Ordinary PostgreSQL suites reuse `useFileScopedPostgresPersistence` where row
reset preserves the required baseline. It drains an outstanding callback and
its reset before another borrow or test, including after caller timeout. Keep
the scope-provisioning project-lock trigger and existing-deployment convergence
in separate single-case fixtures. Other row-only scope-provisioning cases
share one migrated schema. Keep
separate fixtures for migrations,
persistent DDL or session settings. Row-only redelivery and retained-history
scheduler suites use `useFileScopedPostgresSchedulerPersistence`, which wraps
the same owner and restores both exact migration singleton rows after reset.
Capture retains timestamps and future columns; the fixture does not recreate
scheduler defaults. Concurrent acquisitions drain before reset, and failed
callbacks or resets retain the shared lifecycle's full rebuild behavior.
Native bootstrap cases share the existing file fixture. Their temporary insert
gates release advisory locks, drain pending work and remove their exact triggers
and functions before returning the borrow; removal failure requires a rebuild.
Native split provisioning borrows two independent instances of that fixture,
resetting target rows before control rows. Its target insert gate follows the
same cleanup contract, destroying the lock-holding session on failure before
draining blocked reconcilers.
Application readiness and relation build/readiness suites also borrow independent
control/target file fixtures. Their concurrent writers and lock witnesses drain
before reset, and failed callbacks rebuild both stores. Gate waits race unexpected
operation settlement so a setup failure can release and drain the other work.
Native activation borrows separate control/target file owners. Its scope-clock
blocker always releases before activation/read drainage; its read timer closes
with the race. Unique-definition, unique-key and intrinsic creation-time build
cases also borrow the existing file owner, draining concurrent builders before
reset. Intrinsic row seeding acquires genuine installation admission in both
drivers and closes that admission with its transaction.
Retained-history maintenance, index-history compaction and session-schema cases
also borrow the native file owner. Their parallel work drains before reset;
session lookup-plan probes use the scoped planner-setting helper.
Native relation serialization and bounded adjacency publication share that
owner. Relation and retained-floor barriers race unexpected early completion,
release before operation drainage, and finish drainage before fixture reset.
Developer ordered-index and recovery discovery cases borrow that file owner.
The gated builder releases its clock gate and drains started work before reset;
duplicate discovery scans also settle before returning the borrow. Populated
query-plan witnesses retain their full row populations and original budgets.
Row-only native artifact admission/listing, journal validation and schema-artifact
replay/size-gate cases reuse the same file owner. Dedicated backend, DDL, deadline,
uncertain COMMIT and session-configuration witnesses keep separate fixtures.
Native journal race and seal cases also borrow that owner: gates release before
work drains, digest spies restore, and seal triggers/functions disappear before
reset. The 0028 rollback/recovery witness uses the existing copied-migration
fixture capped at 0028; current journal tables are checked in a current fixture.
Session activation shares its file owner and cancels the independent-scope timer.
Artifact timezone probes keep their dedicated clients and drain before reuse.
Reservation replay includes durable receipt/missing-clock checks; real target
failure and recovery remain in the split-provisioning suites.
Legacy OCC and delivery-claim concurrency cases borrow the native file owner;
lock holders release before pending claims and commits drain and rows reset.
Framework artifact lock-order and dependency-insert rollback cases borrow their
existing file owner after removing temporary barriers and rejection triggers.
Deadline, abandoned-backend and uncertain-settlement cases retain independent
fixtures.
Plan probes use `withPostgresSequentialScansDisabled` to bind `SET LOCAL` and
EXPLAIN to one client and roll back the setting before reuse.
Validate converted suites as whole files, including failure-triggered rebuilds.
Finite direct authority/claim refusal cases borrow one file fixture with the
existing `finiteCapture` transport and its statement budget. Installed, lease,
DDL and session-state witnesses keep their existing owners.
Consumed-metadata OCC scenarios borrow one ordinary native file fixture and
drain both parallel validations before reset or projection disposal.
Finite terminalization barriers borrow that same lifecycle with the existing
`finiteCapture` transport; the paused-scope witness uses its ordinary file owner,
releases its gate, drains both operations and cancels its losing timer before
reuse. App-row plan probes use the existing scoped
planner-setting helper so pooled sessions return with their original settings.
Native row-batch and snapshot-resolution cases borrow the existing file owner.
Unique-workspace reclamation borrows separate control/target file owners and
resets target rows before control rows. Scheduler checkpoint cases retain
independent fixtures because the ordinary row reset does not restore their
migration-created singleton.
Native Task creation and attempt lifecycle cases share the existing file owner. Their row
and advisory blockers release before writer drainage; temporary barrier and
effect-rejection triggers/functions are removed before the borrow returns.
Task external-effect races reuse separate control/target file owners; their
bounded authority pool still has its own lifetime and closes before reset.
`database/postgresRuntime.postgres.test.ts` keeps real installation admission
on its test-owned connection while injecting only transaction-command failures.

API export exclusions, constructor surface guards and published type aliases
belong in `api/publicApi.test.ts`. Coordinator installation, readiness and
availability privacy checks use its shared current-subtree guard and runtime
symbol list. Installation and relational physical-value suites retain their
type privacy checks; the API guard owns their current package subtrees.
Domain suites retain their operation-specific
Effect contracts. Prefer assertions in
existing consumer scenarios over separate tests of fixed fixture contents or
helper allocation details. Preserve behavioral, durable-data, rollback and
compatibility witnesses; an old checkpoint label alone does not make one obsolete.
Value-evidence and ordered-key codec probes use the shared raw PGlite factory,
register backend closure, and keep their genuine JSONB/byte-order SQL checks
without constructing a persistence runtime or installing application tables.
Idempotency schema suites retain migration, constraint, uniqueness, plan and
size-limit proofs. The fresh-install fixture starts its empty PGlite engine in
setup; the case still executes and asserts both fresh migration and replay. Outcome classification and compaction races exercise the real
committed-outcome resolver; there is no test-owned classification algorithm.
Malformed-outcome input uses the official Drizzle mock; forged unique tokens
use a real unconnected physical-session transaction. Both refuse unexpected
query access without starting a database. SQL and closed-driver witnesses
retain authentic backends.
Native resolver cases share the existing row-reset fixture, release statement
gates and drain pending resolvers before reset.

Coordinator driver-error mapping assertions run beside their existing authentic
parent/read/replay scenarios and share the repository fault helper. Root-selection
predicates stay with each repository; matching faults reject at `limit`, while
prerequisite queries use the genuine transaction and builder. Two-argument fault
calls retain their unconditional SELECT rejection. Graph-pass
policy and lifetime cases share one file-owned database without row changes;
the cross-transaction witness retains its second independent database. Typed
maintenance converter cases restore independent control/target images before
constructing their private predecessor representation, then execute the actual
conversion, rollback, final attestation and reopen paths.

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
