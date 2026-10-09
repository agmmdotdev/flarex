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
| `database/` | Driver resources, physical sessions, Drizzle execution, SQL transaction profiles and table definitions | [relationalTransaction/session.ts](src/database/relationalTransaction/session.ts), [schema.ts](src/database/schema.ts) |
| `scope/` | Authentic deployment/scope selection, authorization epochs, fencing and scope clocks | [scopeAuthorityResolution.ts](src/scope/scopeAuthorityResolution.ts), [execution/ScopeExecution.ts](src/scope/execution/ScopeExecution.ts) |
| `installation/` | Protected structure, maintenance interlock, installed definitions, framework schemas and migration coordination | [installationLifecycle.ts](src/installation/installationLifecycle.ts), [frameworkSchema/](src/installation/frameworkSchema/) |
| `application/` | Analysis, active bindings, schema authority, readiness, revisions, relation serving and write ownership | [applicationActivation.ts](src/application/applicationActivation.ts), [applicationReadiness.ts](src/application/applicationReadiness.ts) |
| `storage/` | Documents, relational values, pending working sets, indexes, uniqueness, relations, search, catalog and history | [documents/logicalDocuments/workingSet.ts](src/storage/documents/logicalDocuments/workingSet.ts), [catalog/logicalStorageDefinitions.ts](src/storage/catalog/logicalStorageDefinitions.ts) |
| `execution/` | Prepared lifetimes, attempt/session state, journal, finite capture, claims, OCC evidence and persistence recovery | [sessionJournalStore.ts](src/execution/sessionJournalStore.ts), [transactionSessionActivation.ts](src/execution/transactionSessionActivation.ts) |
| `commit/` | Conflict-checked atomic publication, durable outcomes, commit facts, event intents and feed | [pointCommitTransaction.ts](src/commit/pointCommitTransaction.ts), [publication/publication.ts](src/commit/publication/publication.ts) |
| `frameworks/` | Restricted CMS/Commerce direct and borrowed execution, finite atomic Commerce, and cross-domain commands | [cmsTransaction/cmsAdapter.ts](src/frameworks/cmsTransaction/cmsAdapter.ts), [commerceTransaction/commerceAdapter.ts](src/frameworks/commerceTransaction/commerceAdapter.ts) |
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

## Remaining Structural Work

The source and test hierarchy makes current ownership visible. The
[construction plan](../../roadmaps/execution-architecture/03-consumer-construction-and-domain-apis.md)
still owns replacement of persistence-shaped Payload binding inputs and repeated
serving graph assembly. Large existing implementation bodies such as the journal
store and database schema retain their behavior here; splitting them requires
their actual internal responsibilities and consumers to migrate together.

The root `index.ts` retains the existing persistence contracts. Internal contract
ownership and export reduction remain part of the construction/API audit, not a
new umbrella facade. Legacy consumers and durable formats retain their recorded
retirement gates. This organization establishes no new hosted capability or
native-relative performance result.
