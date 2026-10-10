# Postgres Persistence

Postgres is Flarex's authoritative committed store. This package implements
database operations, admission, logical storage and atomic settlement. Framework
adapters own native business behavior; the Application executor owns Application
orchestration. A direct framework operation calls its persistence facade directly.

Start with the [complete execution map](../../roadmaps/execution-architecture/architecture.md)
and the [test guide](test/README.md). The package export map in
[package.json](package.json) identifies callable boundaries; a folder does not
grant a new capability.

## Source Ownership

| Folder | Owns | Useful entry point |
| --- | --- | --- |
| `database/` | Driver resources, physical sessions, Drizzle execution, SQL transaction profiles and domain-owned table definitions | [relationalTransaction/session.ts](src/database/relationalTransaction/session.ts), [schema guide](src/database/schema/README.md) |
| `scope/` | Authentic deployment/scope selection, authorization epochs, fencing and scope clocks | [scopeAuthorityResolution.ts](src/scope/scopeAuthorityResolution.ts), [execution/ScopeExecution.ts](src/scope/execution/ScopeExecution.ts) |
| `installation/` | Protected structure, maintenance interlock, installed definitions, framework schemas and migration coordination | [installationLifecycle.ts](src/installation/installationLifecycle.ts), [frameworkSchema/](src/installation/frameworkSchema/) |
| `application/` | Analysis, serving construction, active bindings, schema authority, readiness, revisions, relations and write ownership | [Application guide](src/application/README.md), [applicationServing.ts](src/application/applicationServing.ts), [activation/repository.ts](src/application/activation/repository.ts), [readiness/repository.ts](src/application/readiness/repository.ts) |
| `storage/` | Documents, relational values, pending working sets, indexes, uniqueness, relations, search, catalog and history | [documents/logicalDocuments/workingSet.ts](src/storage/documents/logicalDocuments/workingSet.ts), [catalog/logicalStorageDefinitions.ts](src/storage/catalog/logicalStorageDefinitions.ts) |
| `execution/` | Prepared lifetimes, attempt/session state, journal, finite capture, claims, OCC evidence and persistence recovery | [Session guide](src/execution/session/README.md), [journal/api.ts](src/execution/journal/api.ts), [sessionJournalStore.ts](src/execution/sessionJournalStore.ts) |
| `commit/` | Conflict-checked atomic publication, durable outcomes, commit facts, event intents and feed | [point guide](src/commit/point/README.md), [point/construction.ts](src/commit/point/construction.ts), [publication/publication.ts](src/commit/publication/publication.ts) |
| `frameworks/` | Restricted CMS/Commerce direct and borrowed execution, finite atomic Commerce, and cross-domain commands | [cmsTransaction/construction.ts](src/frameworks/cmsTransaction/construction.ts), [cmsTransaction/api.ts](src/frameworks/cmsTransaction/api.ts), [commerceTransaction/commerceAdapter.ts](src/frameworks/commerceTransaction/commerceAdapter.ts) |
| `tasks/` | Durable task run/attempt records, compute delivery, external-effect authority, wake and repair scheduling | [taskAttemptLifecycleGateway.ts](src/tasks/taskAttemptLifecycleGateway.ts) |
| `sync/` | Live query records and freshness/change observations | [scopeSyncChangeSourceReadV1.ts](src/sync/scopeSyncChangeSourceReadV1.ts) |
| `values/` | Persistence-owned JSON capture, exact-key checks and encoding helpers | [privateJsonData.ts](src/values/privateJsonData.ts) |
| `legacy/` | Retained displaced engine/protocol implementations and their named consumers | [legacyV1AppDataEngine.ts](src/legacy/legacyV1AppDataEngine.ts) |
| `testing/` | Existing explicit test-only capabilities | [systemTestApplicationRevisionTargetsV1.ts](src/testing/systemTestApplicationRevisionTargetsV1.ts) |

There is no generic framework transaction. CMS, Commerce and Application attempts
retain their own execution profiles. They reuse authoritative storage and
publication where their contracts permit it. A borrower contributes pending
changes to an outer attempt; it cannot independently commit.

## Checks In Execution Order

1. **Preparation** captures reusable definitions and construction dependencies
   under an explicit lifetime. It does not freeze live authorization indefinitely.
2. **Admission** selects authentic current scope/application/source authority and
   checks that the requested execution is permitted.
3. **Readiness** establishes the structures actually needed by the operation.
   Installation integrity and mutable serving/build readiness have distinct owners.
4. **Execution** runs native behavior or Application work with the admitted
   snapshot, bounded lifetime and pending visibility.
5. **Publication** validates the outer owner's required evidence and atomically
   writes committed data, history, facts and supported durable outcome/event intent.
6. **Recovery** resolves durable outcomes after uncertainty. Missing evidence is
   not blanket permission to replay framework hooks.

These are responsibilities, not six services that every call must construct or
six mandatory SQL round trips. See the concrete direct and composed flows in the
execution map.

## Construction And Remaining Structural Work

The source and test hierarchy makes current ownership visible. Application owns
construction of the serving graph; its read serving factory constructs only
protected read selection. CMS issues scoped read/command bindings from those
owners and trusted source/policy selection. Payload binds native operations to
these capabilities. The [construction plan](../../roadmaps/execution-architecture/03-consumer-construction-and-domain-apis.md)
owns that connected cutover and the named test-only raw construction witnesses.
Journal consumers use `internal/session-journal` for operation contracts, error
classes and read-only frozen values. `internal/session-journal-construction`
belongs to trusted graph construction. The concrete store assembles distinct
operation, evidence, persistence, finite-root and seal owners. One per-store
attempt owner retains issued identities, exact claims and reservations. Follow
their operation order in the [journal guide](src/execution/journal/README.md).
The [schema guide](src/database/schema/README.md) distinguishes table declarations,
driver query composition and migration generation, with their actual dependencies.
Point publication has distinct contract, preparation, acceptance, settlement,
replacement and recovery owners. Consumers load the lightweight
`point-commit-transaction` API; trusted composition and readiness use the
separate internal construction and eligibility routes. Lower error families and
materialization evidence have their actual domain owners. Follow their ordering
in the [point guide](src/commit/point/README.md). Activation and readiness have
distinct contracts, private identities, preparation, acceptance, persistence and
ordered repository assembly. Follow setup, activation and business-request use
in the [Application guide](src/application/README.md). Remaining session and
consumer cohesion work is owned by the
[file cohesion plan](../../roadmaps/execution-architecture/05-file-cohesion-and-readable-flows.md).

The root `index.ts` retains the existing persistence contracts. Internal contract
ownership and export reduction remain part of the construction/API audit, not a
new umbrella facade. Legacy consumers and durable formats retain their recorded
retirement gates. This organization establishes no new hosted capability or
native-relative performance result.
