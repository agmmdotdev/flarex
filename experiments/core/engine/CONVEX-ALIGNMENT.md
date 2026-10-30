# Convex alignment findings

Status: **Source comparison supporting the accepted Convex core/physical-schema
translation target; connected implementation and performance acceptance open**.
These findings support the existing
[refactor direction](./REFACTOR.md) and [goal](./GOAL.md). Accepted architecture,
individual divergence records and the [question queue](./OPEN-QUESTIONS.md)
retain their authority. Recording a recommendation does not settle an unresolved
guarantee or replace the required pre-slice challenge. The
[translation plan](./REFACTOR.md#core-and-physical-schema-translation-plan)
now fixes the target: translate the pin into the current TypeScript core,
including physical persistence, departing only for DO/runtime constraints or
required native behavior.

## Source boundary

The comparison inspected both local repositories on 2026-10-30: Convex at
`84fbb0e70b4e857913673871cb847ad11a55f3d5`, and Flarex at `0d7f85662` plus its
current shared-worktree changes. The [reference map](../REFERENCES.md) owns the
Convex pin. Four independent investigations covered OCC/commit, schema/storage,
runtime/cache and native framework requirements, then exchanged challenges.
Working-tree observations below are not claims of a committed or deployed cutover.
Recheck the actual callers when selecting implementation.

The central finding is to translate Convex's core mechanisms closely while
keeping necessary framework and host adaptations narrow. Native behavior does
not require a separate database, migration, recovery or per-call journal engine
for each consumer. Preserve guarantees rather than old internal choreography.

## Shared foundations

Both systems use snapshots, private pending writes, tracked read dependencies,
conflict validation and atomic persistence. Both also use logical tables over
shared physical storage. Convex's PostgreSQL adapter stores document and index
history in generic `documents` and `indexes` families; it does not create a SQL
table for each application table. PostgreSQL itself is therefore not the main
mechanism difference.

Flarex's generic row, index, unique and relation families extend that model for
its admitted framework profiles. `fx_app_row_current` points into authoritative
revision history; it is not a duplicate document-body store. Current pointers,
hashes and codec/layout choices remain replaceable mechanisms, but their presence
or SQL-table count does not establish a bottleneck.

## Necessary requirements and replaceable implementations

| Preserve | Why | What need not be preserved |
| --- | --- | --- |
| Portable TypeScript core, Drizzle/PostgreSQL persistence and Cloudflare adapters | These are current project requirements. PostgreSQL alone owns durable application outcomes. | Rust collection types, runtime/file layout, an RPC per module, or existing factory and connection choreography. |
| Native Payload access, validation, hooks and population; Medusa business rules, events, workflow grouping and compensation | Removing these changes observable behavior. Independent native steps do not become one atomic mutation implicitly. | Current adapter tokens, manager internals, repeated admission, separate SQL ownership or framework-specific storage engines. |
| Explicit whole-command replay eligibility | Hooks/effects may repeat on retry. Automatic native replay initially remains refused until the whole command is proved safe. | A permanent assumption that native commands can never retry, or durable per-syscall machinery merely to enforce this policy. |
| Supported uniqueness, relation integrity, soft-delete policies and exact numeric semantics | Native definitions require more than document shape validation. Convex `v.id` checks ID/table compatibility, not endpoint existence; `.unique()` checks results rather than declaring a unique constraint. | Separate enforcement engines or the exact current claim/edge table layouts. Use shared owners. |
| Scope isolation, durable fencing, authentication/revocation and exact read dependencies | Cached data does not independently prove authority or validity. | Rebuilding immutable definitions or repeating the same physical check at every layer. Ordinary permission reads and engine-grant revocation remain distinct. |
| Request correlation, existing busy/claim behavior, original signed-program retry and atomic outcomes | Flarex distinguishes an already-running request and must not execute newer code under an older grant. Lost acknowledgement does not authorize another body. | Every old session/journal transition. Preserve a compact root lifecycle through the actual outcome owner. |
| Uncertain-outcome recovery | A thrown handler does not establish that PostgreSQL rolled back. Fence old work, reconcile durable outcomes and rebuild before unsafe execution resumes. | Convex's process-crash implementation literally; translate recovery to the app/host boundary. PostgreSQL fencing remains required. |

Convex itself uses durable persistence leases and a final shared lease-row lock.
Its OCC design is not a promise that the engine or SQL adapter contains no locks.
The request/claim and original-program row above describes current contract
preservation during migration. Those policies are not unavoidable DO/native
requirements; their disposition is separated below.

## Replacement priorities

### 1. Finish finite execution and retire displaced durable operations

Convex keeps transaction reads and pending writes in local transaction state.
The current Flarex Standard caller already selects `finiteRoot`; known-point
operations and receipts can be local, and finite state freezes for settlement.
It is inaccurate to say all current Standard syscalls are durably journaled or
that this migration has not started. Full migration, retained-attempt disposition,
connected validation and cutover remain open.

Finish that path and retire displaced new-request durable machinery after its
consumers move. Preserve actual stored requests and reconcile their outcomes
under the [retirement policy](./05-stored-attempt-disposition.md). Do not create
another replacement engine or remove root claims/outcomes with the old journals.

### 2. Replace repeated read SQL with a versioned snapshot/catalog owner

Convex constructs transactions from a long-lived snapshot manager and cached
registries, while recording precise metadata dependencies. Flarex's bounded
Application query path still validates active selection and history before
cache lookup; indexed reads also check eligibility/coverage.

Replace repeated physical work with protected snapshot/catalog ownership,
retention and exact dependencies. Preserve fresh duties at the correct boundary
until all relevant writers and revocation paths participate. Existing native
selected-demand readiness and prepared-catalog reuse already exist; extend them
rather than proposing them as missing or repeating old source-wide scans.

### 3. Apply publication changes locally instead of routinely rehydrating them

Convex fast-forwards eligible caches from its retained in-memory write log.
Flarex's bounded bridge loads durable feed facts, then the old and new revisions
for each changed row. This is safe reconstruction scaffolding, not an unavoidable
cost of using PostgreSQL.

Connect timestamped local changes to the real publication owner; reconstruct from
PostgreSQL after restart or when required evidence is unavailable. Preserve
continuity, old snapshots, same-key body changes, cache/history bounds and writer
coverage. Keep the existing interval-cache algorithm: a cache miss or incomplete
range is not an empty result. Exclusive cache transfer and successful-invocation
completion protect mutable ownership; they are not dispensable bureaucracy.
The current single idle handoff is adapted from Convex's sequential scheduler,
not a complete general shared-page cache.

### 4. Separate commit ordering from waiting for independent saves

Convex validates against both committed and accepted pending writes, overlaps
persistence through `FuturesOrdered`, then publishes and acknowledges in order.
Current Flarex finite publication holds the scope-clock lock across metadata/OCC
checks and materialization, coupling independent saves through SQL serialization.

Follow the [accepted commit contract](./01-commit-coordination.md): one logical
acceptance order, bounded overlapping eligible saves, ordered normal publication
and uncertainty recovery. Replace coordination and durable interlocks together;
dropping the clock lock alone is not the replacement. The full app DO coordinator
remains unimplemented. A single JavaScript thread also does not establish the
whole-engine CPU capacity of Convex's multithreaded runtime.

### 5. Consolidate schema lifecycle and retire physical framework installation

Keep native schema producers and move remaining consumers onto shared logical
rows/indexes/constraints/relations. Remove displaced deployment-specific DDL,
physical-name assignment and structural installation paths after caller migration
and retained-data disposition. Generic platform SQL upgrades remain necessary.
The [shared schema lifecycle](../../../design-notes/flarexdb-shared-schema-lifecycle.md)
owns this direction; no parallel framework or Task migration engine is required.

Private system schemas should share these owners without fabricated Application
analysis or lifetime coupling to app code deployment. The current working tree
already introduces explicit Application/system roots and initial system
installation; these are in progress, not wholly absent or completed.

## Physical-schema and engine translation findings

### Current-core destination versus the retained experiment

The refactor changes the existing core in `packages/` and `apps/`. The older
`experiments/core/src` candidate and its Drizzle schema remain isolated runnable
comparison material. Current runtime-source inspection found no imports of that
folder or `@flarex/experimental-core` in those packages/apps. Its own test and
benchmark setup may still execute it independently; it has not been deleted.

The newer interval cache, root evaluator and query DO live in existing package/app
owners. The interval cache closely translates Convex coverage/cut rules. The
older candidate still uses current JSONB documents plus history and separate
numeric/equality membership versions; point/range operations reload snapshot
authority through SQL. Neither that layout nor wrapping its API in a DO is the
target engine. Reuse its behavioral witnesses and sound pieces after audit.

### Physical representation and the translated persistence contract

Convex finalizes an operation into tracked reads and coalesced writes. The engine
then derives `DocumentLogEntry { ts, id, value, prev_ts }` and
`PersistenceIndexEntry { ts, index_id, key, value }`. Its PostgreSQL adapter
writes document/index batches in one fenced SQL transaction. A close Drizzle
mapping is the [plan's versioned log shape](./REFACTOR.md#physical-persistence-is-in-scope),
with scope adapted from the persistence instance identity.

| Area | Current Flarex difference | Translation disposition |
| --- | --- | --- |
| Document revisions | Separate schema version, creation time, codec/hash and write epoch evidence on each revision. | Map real duties to versioned metadata, document serialization, trusted system fields and the persistence/fencing owner. Exact current columns are not inherent OCC requirements. Preserve integrity and history guarantees through replacement. |
| Ordinary index revisions | Encoded key plus separate row-ID ordering; membership sequence can differ from body revision; per-entry codec/spec evidence. | Default to pinned key ordering and same-timestamp index/body hydration. Translate PostgreSQL long-key handling and native exact-value extensions explicitly. |
| Current projections | Current-row/current-index pointer families support existing readers and constraints. | They are not part of the minimum Convex version-log design. Retain only for a justified DO/native requirement, with safe-prefix visibility, rebuildability and overlapping-save proof. |
| Engine catalogs | Normalized control families plus JSON/canonical bytes/digests for definitions. | Default engine meaning to private logical system records and versioned registries. Keep external deployment/artifact and cross-trust authority at its actual owner; do not collapse genuine split-placement boundaries. |
| Executing operations and change directories | Session/attempt profiles, transient journals, commit headers/facts and outcome machinery. | Keep transient read/write state in the translated transaction. Preserve atomic durable outcomes, native events and recovery; replace duplicate journal/feed machinery only after common-log reconstruction and retained-data disposition. |

These are connected replacement targets. Deleting a verified column or index
without replacing its readers, writers, cache, builds, retention and recovery
would not implement the translation. Drizzle itself imposes none of these
current representation choices.

### Same-timestamp index hydration versus independent membership

Convex's `IndexRegistry::index_updates` emits a final live ordinary-index entry
even when its key is unchanged. Its PostgreSQL range scan joins the document
revision at the index entry's exact timestamp. Flarex currently versions
membership independently and authenticates membership heads before omitting an
unchanged write.

For a description-only Product patch at commit 42, with category unchanged:

- Convex writes document 42 and live category-index entry 42. Hydration uses
  their shared timestamp.
- Flarex may retain category membership 17 while writing document 42. It must
  resolve independent body history and prove the skipped membership update.

The accepted translation default follows Convex here. More index writes are the
tradeoff for simpler update interpretation/hydration, not a measured win. Migrate
maintenance, read hydration, cache changes, OCC, backfill and retention together;
do not preserve no-op membership proofs solely because they already exist.

### Pending indexes and observable Application policies

Convex `TransactionIndex` eagerly maintains old/new private key deltas and
tombstones; `Writes` separately preserves first-original/final state and per-call
accounting. Our selected adaptation lazily updates chosen indexes and suppresses
snapshot rows by written ID. Its fallible decimal/key-limit lowering and error
timing are explicit in the [pending-index divergence](./divergences/incremental-pending-indexes.md).
This is not forced by TypeScript or DO. Establish which supported native behavior
really requires it before retaining a departure from the eager mechanism.

| Existing Application policy | Convex comparison | Required disposition |
| --- | --- | --- |
| A durable claim suppresses duplicate bodies and returns `inProgress`. | Eligible pure duplicates may execute; tracked request absence and an atomic stored outcome select one committed success. | Keep durable outcome identity/fencing; decide duplicate-execution policy separately from the shared engine. |
| Retry uses the originally signed program/schema. | A fresh transaction validates current function metadata. | Resolve grant authority explicitly before changing retry resolution; an older grant must not silently authorize newer code. |
| A caught admitted child failure poisons the root. | Nested handler-error rollback restores checkpointed writes/index/metadata state, with specific retained reads/accounting. | Translate the actual checkpoint/error distinction if selected; do not implement generic undo-all or apply Application semantics to native hooks implicitly. |

These are chosen observable contracts, not DO necessities. The translation target
does not silently decide all three. Q06 in the [question queue](./OPEN-QUESTIONS.md#q06---pending-state-framework-visibility-and-replay)
owns their resolution alongside required native replay/visibility policy.

## Source map for the findings

Links target local executing owners and symbols; line numbers can drift with
shared work. Inspect callers and tests again for an implementation slice.

| Responsibility | Convex owner | Flarex owner |
| --- | --- | --- |
| Acceptance, pending conflicts, overlapping saves and ordered publication | [committer.rs](../../../../../crates/database/src/committer.rs), `validate_commit`, `commit_has_conflict`, `persistence_writes`, `publish_commit` | [finitePublication.ts](../../../packages/persistence-postgres/src/commit/point/finitePublication.ts), scope-clock locking and final settlement; [runtime adaptation](./divergences/app-owner-runtime.md) |
| Point/range dependencies and pending state | [reads.rs](../../../../../crates/database/src/reads.rs), [writes.rs](../../../../../crates/database/src/writes.rs) | [finiteRoot.ts](../../../packages/persistence-postgres/src/execution/journal/finiteRoot.ts), [pointOperations.ts](../../../packages/persistence-postgres/src/execution/journal/pointOperations.ts), [OCC](../../../packages/persistence-postgres/src/commit/point/occ.ts) |
| Actual Standard finite entry and retry | [mutation runner](../../../../../crates/application/src/application_function_runner/mod.rs), `_retry_mutation` | [ApplicationMutationSystem.ts](../../../packages/standard-application-invocation/src/ApplicationMutationSystem.ts), [finite execution](../../../packages/executor/src/mutation/execution/finitePointMutationExecution.ts) |
| Snapshot and schema reuse | [database.rs](../../../../../crates/database/src/database.rs), [schema_registry.rs](../../../../../crates/database/src/schema_registry.rs), `get_by_state` | [applicationQuerySnapshot.ts](../../../packages/persistence-postgres/src/application/applicationQuerySnapshot.ts), [selected readiness](../../../packages/persistence-postgres/src/storage/catalog/logicalStorageReadiness.ts), [source admission](../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/sourceAdmission.ts) |
| Cache refresh and ownership | [write_log.rs](../../../../../crates/database/src/write_log.rs), [scheduler](../../../../../crates/application/src/scheduled_jobs/mod.rs) | [cache refresh](../../../packages/persistence-postgres/src/application/applicationQueryCacheRefresh.ts), [cache handoff](../../../packages/persistence-postgres/src/application/applicationQueryDataCache.ts), [transfer divergence](./divergences/query-cache-transfer.md) |
| Logical versus physical storage | [PostgreSQL SQL](../../../../../crates/postgres/src/sql.rs) | [row revisions/current pointers](../../../packages/persistence-postgres/src/database/schema/documents.ts), [physical schema naming](../../../packages/persistence-postgres/src/storage/relationalSchema/physical/canonical.ts), [storage completion owner](../../../roadmaps/shared-logical-storage/03-completion-plan.md) |
| ID validation versus native constraints | [validator.rs](../../../../../crates/common/src/schemas/validator.rs), [query implementation](../../../../../npm-packages/convex/src/server/impl/query_impl.ts), `unique` | [logical schema sources](../../../packages/flarex-protocol/src/logical-schema-candidate.ts), [shared definitions](../../../packages/persistence-postgres/src/storage/catalog/logicalStorageDefinitions.ts) |
| Borrowed native lifetime and finite workflows | [transaction.rs](../../../../../crates/database/src/transaction.rs), nested working state | [borrowed Payload attempt](../../../packages/persistence-postgres/src/frameworks/cmsTransaction/borrowedLogicalAttempt.ts), [Medusa repository context](../../../packages/medusa-adapter/src/repository/context.ts), [finite atomic child](../../../packages/medusa-workflows-sdk/src/durable/engine/finite-atomic-child.ts) |
| Same-timestamp ordinary-index hydration | [index_registry.rs](../../../../../crates/indexing/src/index_registry.rs), `index_updates`; [PostgreSQL scan](../../../../../crates/postgres/src/sql.rs), `D.ts = A.ts` | [independent membership schema](../../../packages/persistence-postgres/src/database/schema/documentIndexes.ts), [membership-head proofs](../../../packages/persistence-postgres/src/storage/indexes/appIndexEntries.ts) |
| Persistence batch and transaction finalization | [persistence contracts](../../../../../crates/common/src/persistence.rs), [PostgreSQL writer](../../../../../crates/postgres/src/lib.rs), [transaction finalization](../../../../../crates/database/src/transaction.rs) | [older candidate schema](../src/schema.ts), [candidate storage](../src/application-storage.ts), [actual query DO](../../../apps/executor/src/applicationQueryDO.ts) |
| Pending and nested state | [TransactionIndex](../../../../../crates/database/src/transaction_index.rs), [nested syscall](../../../../../crates/isolate/src/environment/udf/async_syscall.rs) | [root evaluator](../../../packages/persistence-postgres/src/storage/documents/logicalDocuments/rootEvaluator.ts), [nested-failure policy](./divergences/application-nested-failure.md) |

## Performance limits and next selection

Repeated SQL, history rehydration and scope-wide save serialization are
source-visible cost candidates, not fresh causal attribution of the current
bottleneck. The operation cache, refresh and bounded query DO records explicitly
leave complete-request performance unmeasured. Do not present older 63/65-query
read traces as today's baseline.

The existing [isolated compact-OCC results](../../../work/validation/shared-execution-evidence/occ-vector-compact-isolated/results.md)
record 60 exchanges and 41 checkouts for the mixed workflow, with complete
performance gates unmet. That exact cohort excludes active shared-worktree
changes and is not a Convex benchmark. Smaller SQL text, fewer tables, sampled
library frames or structural similarity do not establish an end-to-end gain.
Existing metadata-key and fixed demand-vector work must not be proposed again
as absent; broad pure-preparation cleanup was already rejected as the next
performance implementation in the [cost inventory](../../../packages/medusa-adapter/benchmarks/core-performance/native-business/cost-inventory-proposal.md).

The [connected translation plan](./REFACTOR.md#connected-implementation-sequence-and-conformance)
owns next selection: complete or safely hand off in-flight finite/retirement work,
define transaction and physical persistence together, then connect snapshot,
transaction, commit and recovery owners. Schema retirement follows its consumers.
Use the existing question and divergence owners for unresolved protocols. Each
runtime slice still needs its independent challenge, exact writer coverage,
relevant PGlite/ordinary-role PostgreSQL and host validation, and complete-request
measurements before claiming that a bottleneck or the full goal is resolved.
