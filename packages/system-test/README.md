# Connected System Tests

This package proves complete behavior across existing owners. Runtime algorithms,
authority and settlement remain with their production packages; test support
constructs those owners, invokes their real operations and inspects outcomes.
Use the [execution map](../../roadmaps/execution-architecture/architecture.md)
to find the production owner before changing a scenario.

| Folder | Responsibility |
| --- | --- |
| `src/environment/` | Reusable environment contracts and construction |
| `src/inspection/` | Test inspection contracts and operations |
| `src/lanes/` | Lane contracts and execution support |
| `src/simulation/` | Simulation support |
| `support/` | Cross-package scenario composition and actual runtime loaders |
| `test/contracts/` | Behavioral registrations shared by driver adapters |
| `test/integration/` | Connected owner and consumer proofs |
| `test/environment/`, `test/simulation/` | Their environment and simulation proofs |
| `test/support/` | Driver/resource fixtures and test-local adapters |

## Current Application Lifecycle

The current [shared scenario](support/application/lifecycleScenario.ts) follows
real source analysis and publication into readiness, activation and reconstructed
reads. Its [PGlite entry](test/integration/application/lifecycle.test.ts) and
[PostgreSQL entry](test/integration/application/lifecycle.postgres.test.ts) share
the same assertions and use the existing native Application fixture.

The scenario publishes a second revision while the first is serving. It checks
the candidate's initial refusal and validation progress, then verifies that
readiness leaves the active head and history unchanged. It exercises activation
rollback at both publication boundaries, exact CAS and replay, stale and copied
capability refusal, and uncertain response recovery. The persistence-owned
inspection helper returns detached current table snapshots; this package does
not implement another publication engine.

Run the matched entries from this package:

```sh
pnpm test:application-lifecycle:pglite
pnpm test:application-lifecycle:postgres
```

PostgreSQL requires `FLAREX_POSTGRES_DATABASE_URL` and an ordinary runtime role.
The existing temporary-schema fixture owns cleanup. PGlite uses its existing
migrated driver fixture and registered test finalizers. The analysis loader
owns and disposes its actual Worker runtimes.

The native query, mutation, action and connected Task suites verify their
distinct execution consumers. Persistence's [Application test map](../persistence-postgres/test/README.md#application-lifecycle-tests)
owns the detailed activation, readiness, binding and lifetime regressions.

## Historical Proofs

The obsolete FSV04/FSV05 runtime entry suites and proof-only coordinators are
retired. The current lifecycle entries above and persistence readiness/activation
tests own their live behavioral coverage. The two migration-0043 ownership
regressions live with persistence's historical migration tests, share assertions
across drivers, and stop at 0043 rather than replaying unrelated later migrations.

The displaced FSV06/PQV/SAP query, mutation and action runtime entries and their
FSV04/FSV05 preparation chain are retired. Current native consumer suites own
execution coverage. The action authority matrix now uses the current split
Application fixture and canonical execution authority, retaining races, rollback,
recovery, digest capture and transaction cleanup. The current native query suite
retains PostgreSQL snapshot/writer locking and retained-floor checks; the native
mutation suite exercises nested calls through a real Worker and shared journal.

FSV03's standalone analyzer/C07 entries and session-finalizer test still consume
the historical analyzer harness. Their removal gate is disposition against
current Application Analysis and mutation coverage. The separate historical
native Task parent seeds retain their registration/runtime gap. Neither is
current Application acceptance. The
[analysis retirement owner](../../roadmaps/49-application-analysis-migration.md)
owns these remaining gates; do not extend historical schemas or bypass admission.
