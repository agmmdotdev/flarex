# Source and evidence map

## Convex source identity

Active design/development pin: `db914cf06e2b06ee985646611b9e12ed7a770318` (upstream main inspected on 2026-10-30).
The enclosing local `convex-backend` checkout is at this exact revision. Do not
follow a moving branch implicitly. A future pin change requires a source/contract
audit and updated comparisons/hashes together. The [upgrade assessment](./engine/CONVEX-REFERENCE-UPGRADE.md)
records changes from `84fbb0e70b4e857913673871cb847ad11a55f3d5` and the required port gates.

The [historical source map](./REFERENCES-84fbb0e.md) preserves the old observations
and hashes. Existing slice/divergence records retain their inspected revision;
they are not silently re-certified by this upgrade. Source links below navigate
the current checkout; use `git show <pin>:<path>` for immutable inspection.

## Engine mechanism reference map

| Responsibility | Current pinned owners | Mechanism / limit |
| --- | --- | --- |
| Database and snapshots | [crates/database/src/database.rs](../../../../crates/database/src/database.rs); [crates/database/src/snapshot_manager.rs](../../../../crates/database/src/snapshot_manager.rs) | Safe published snapshots, versioned registries/TableCounts, exact historical misses and retained-view eligibility. |
| Transaction state | [crates/database/src/transaction.rs](../../../../crates/database/src/transaction.rs); [crates/database/src/reads.rs](../../../../crates/database/src/reads.rs); [crates/database/src/writes.rs](../../../../crates/database/src/writes.rs); [crates/database/src/transaction_index.rs](../../../../crates/database/src/transaction_index.rs) | Tracked dependencies, first-original/final writes, nested checkpoints/accounting, unresolved commit timestamps and cursor-bounded pending-page merge. |
| Validation, ordering and batching | [crates/database/src/committer.rs](../../../../crates/database/src/committer.rs); [crates/database/src/write_batcher.rs](../../../../crates/database/src/write_batcher.rs) | pre_validate_batch/validated_through, bounded inflight stages, final published suffix plus accepted pending checks, track_and_write_to_persistence, group commit and ordered publication. |
| Conflict history | [crates/database/src/write_log.rs](../../../../crates/database/src/write_log.rs) | WriteLogSnapshot and immutable per-index batches; PendingWrites FIFO plus PendingKeysInIndex interval overlap. Text-search fallback remains distinct. |
| Index reads and caches | [crates/indexing/src/database_index_snapshot.rs](../../../../crates/indexing/src/database_index_snapshot.rs); [crates/indexing/src/in_memory_indexes.rs](../../../../crates/indexing/src/in_memory_indexes.rs); [crates/indexing/src/index_reader.rs](../../../../crates/indexing/src/index_reader.rs); [crates/indexing/src/index_cache/mod.rs](../../../../crates/indexing/src/index_cache/mod.rs) | Separate selected resident indexes, transaction interval cache and read-through page reader. Validate fills against row and index-metadata writes. |
| Identity, values and ordinary keys | [v6 IDs](../../../../crates/value/src/id_v6.rs), [base32](../../../../crates/value/src/base32.rs), [sort keys](../../../../crates/value/src/sorting.rs), [value JSON](../../../../npm-packages/convex/src/values/value.ts), [index composition](../../../../crates/common/src/index.rs) | Canonical public IDs, full internal JSON documents and self-delimiting field plus developer-ID keys; preserve current value/collection limits and ownership. |
| Persistence contract | [crates/common/src/persistence/mod.rs](../../../../crates/common/src/persistence/mod.rs); [crates/common/src/types/index.rs](../../../../crates/common/src/types/index.rs) | DocumentLogEntry, PersistenceIndexEntry with IndexRef/write mode/predecessor; exact snapshot identity and idempotent backfill/reconciliation. |
| PostgreSQL adapter | [crates/postgres/src/sql.rs](../../../../crates/postgres/src/sql.rs); [crates/postgres/src/lib.rs](../../../../crates/postgres/src/lib.rs) | Five-table row-version layout, same-timestamp hydration, fenced atomic batches and read-only-aware lease acquisition. |
| Index lifecycle and retention | [crates/indexing/src/index_registry.rs](../../../../crates/indexing/src/index_registry.rs); [crates/common/src/bootstrap_model/index/database_index/index_state.rs](../../../../crates/common/src/bootstrap_model/index/database_index/index_state.rs); [crates/common/src/persistence/row_index_retention.rs](../../../../crates/common/src/persistence/row_index_retention.rs); [crates/database/src/retention.rs](../../../../crates/database/src/retention.rs) | Index predecessor evidence, backfill modes/reconciliation and storage-owned history reclamation constrained by safe snapshot floors. |
| Application index installation | [crates/application/src/lib.rs](../../../../crates/application/src/lib.rs), _validate_user_defined_index_fields | Validate developer fields, append _creationTime, then the ordinary key encoder appends the developer ID. CoreIndexDefinition.fields stores the normalized installed fields. |
| Packed private payloads | [session outcomes](../../../../crates/model/src/session_requests/types.rs), [schema metadata](../../../../crates/common/src/bootstrap_model/schema_metadata.rs), [analyzed function metadata](../../../../crates/model/src/modules/module_versions.rs) | Serialized value/schema payloads prevent metadata/outcome wrappers from consuming the admitted payload nesting budget; strict reconstruction keeps full-document depth limits. |
| Schema metadata | [crates/database/src/bootstrap_model/schema/mod.rs](../../../../crates/database/src/bootstrap_model/schema/mod.rs); [crates/database/src/bootstrap_model/next_persistence_index_id/mod.rs](../../../../crates/database/src/bootstrap_model/next_persistence_index_id/mod.rs) | Private staged schema validation and persistence-index identity; copy the current transactional lifecycle, not only state names. |
| Retry, nesting and deterministic time | [crates/application/src/application_function_runner/mod.rs](../../../../crates/application/src/application_function_runner/mod.rs); [crates/isolate/src/environment/udf/async_syscall.rs](../../../../crates/isolate/src/environment/udf/async_syscall.rs); [crates/common/src/document.rs](../../../../crates/common/src/document.rs) | Permit-before-snapshot ordering, outcome-before-new-body, handler-error rollback and snapshot-derived time. Optional capabilities require explicit admission. |
| Alternative upstream storage | [crates/mysql/src/v6/sql.rs](../../../../crates/mysql/src/v6/sql.rs) | Selectable MySQL V6 latest/backfill-delete/bucketed history exists. It is not the selected PostgreSQL layout or a deployment-status claim. |

These are executing source responsibilities, not a requirement for one package,
service or RPC per owner. DO scheduling and native behavior adaptations remain
explicit. Source inspection does not establish measured Flarex performance.

## Current source hashes

SHA-256 below hashes raw Git blob bytes at the active pin, not CRLF-converted
working files. These identities cover the source audit, not executed tests.

```text
crates/database/src/database.rs 5ce4d8b0349be8cbb0c471a69d2be16005ef7950d2585068b44e183d1ed46ad5
crates/database/src/transaction.rs cb8344b8afee46cce3922eedf79e5b862c39f5d190044e741e03b5ee6dbef768
crates/database/src/reads.rs 68e13325ff0c717398b75bdc951b282e5cd30acc7eec4a93155bf9b107eae9e6
crates/database/src/writes.rs 8ab17d2e6ca0806dd2ba6631579c81e4d6cda05ec36d60d1f446e57c68228ba4
crates/database/src/transaction_index.rs 635232bdcc183379825cbfcc1eb9e7eb00e7a6cf388825d89e74867839094c5b
crates/database/src/committer.rs dd0738938fa0d8905fc9a4da4560ca6436398cd968ffc090bd8ada4f2aa503a4
crates/database/src/write_batcher.rs e2a8289a22c9a1413e85cce2e1f25a4fa19be493a6cde7bc7c4dcb02f87c9e38
crates/database/src/snapshot_manager.rs c2fb30e5e41a2d4890754921dfc793e4ddbf95705f98a64f93e57ed77b545992
crates/database/src/write_log.rs dfd4973f355cee8b76840d31bbc5116a97b2a691f44428ecbebfbb348dff026b
crates/database/src/retention.rs ccf87f11c53ea4fc5f2740cee9c3500d1fb3f9d13b50249754fa17af78de6a21
crates/indexing/src/database_index_snapshot.rs 256cf0eeaf7140922caffee5d53b55958a8f5b4b5d93a8f7c7ae00866c33fd1f
crates/indexing/src/in_memory_indexes.rs 9b4856f36d940b6df725d20f619020a4495d4f02fbeb07fae7ba920fea3f0f34
crates/indexing/src/index_reader.rs 102c654555e3a214529ff17c1ed298242532d52d034f9f8f0062d1a2a8658739
crates/indexing/src/index_cache/mod.rs 200c6c177f6371d1d07770ff80e4289d14cf41b96c4ef6539e9385f07f531e1c
crates/indexing/src/index_registry.rs 52d19610e4fa97cb17dcf088dca2cf105887e7512ec9e96101aeb61727228f95
crates/common/src/persistence/mod.rs 9705c428143051fde48ade138795d68a9760ad0293c4ea6d6494f23b568457be
crates/common/src/persistence/row_index_retention.rs 894b27093293825b3687b166baa1893df910ef6adf14cdac3d7b0f412ffef306
crates/common/src/types/index.rs 8ba7c4e60cb74f7bdfd7c63638e4752c8433300cfb6dcff13a5feb1cd44e69b9
crates/common/src/knobs.rs 86a109c1d70445510e595ee889648547fef2b82b1877fec686bb11f8aabe56ba
crates/common/src/document.rs bd2244455df8103aa864af0e617b92acd436d2bf52bb745626409db70c73d585
crates/common/src/bootstrap_model/index/database_index/index_state.rs 82427966b374c3d23f600bb48359c239bb531416e10c85e320b22c709f1662ee
crates/database/src/bootstrap_model/schema/mod.rs 0026e220fe2920c559fa4101049c0e9b1770518308a4c60025ae7a7b081a9563
crates/database/src/bootstrap_model/next_persistence_index_id/mod.rs 63cf3c4343fe10df42ebdd3d72af4927f36b6a4e5df3e11c7b7b7b93039a1b0f
crates/postgres/src/sql.rs 5a781f86f8f72f0d24721a7aafe72f73e7b19b90a4c1d62d038c985bbfe8a58e
crates/postgres/src/lib.rs cb3f328a734d616b1401fc58903e758763d68486e720560aa308a347e7c12dc5
crates/mysql/src/v6/sql.rs 5115b47be29558e711ed9561b03fc4c356a6ce4df176ac0489ff9e578a92ddc5
crates/application/src/application_function_runner/mod.rs d4550703580c85437bc299d4f3d00210dab27967f4b6d954272f5a6dff18cfd5
crates/isolate/src/environment/udf/async_syscall.rs d7b6da4e8abe86558ee1bc79e62764abb65ba345357caba00873ec1bbc1d379a
crates/value/src/id_v6.rs b5c85ea1fe5339c56b342ad4be44e7b3741193c81a397eed5496021b30fc4064
crates/value/src/base32.rs 5927e05a2814dd7b2f2af155c584e0aaff2e5004e3d968861aebc03c1f9e9afa
crates/value/src/sorting.rs 623870d85b8483983427baf71b1650f27f4c12a8180e4335969b8e8107afc639
crates/value/src/size.rs bc0fe7baa30f8e8c42af073d052b05a28e91235cae9daea5365fe9cd6a7ed2d4
crates/value/src/array.rs a7b13e3f10890e5816830392cf46b1fa5a9e7d89c04a279be9b4936675f9e14c
crates/value/src/object.rs ebbbf7f9bbf671c0e1017fa88a9b8fec4fa5b33eaa390ac7c91998e0cec0ca9c
npm-packages/convex/src/values/value.ts f483f659860f24d37c279d3a0314675be0a7a8b3f9f3ed73e16413704ab867e9
crates/common/src/index.rs 74f10b8a13f765e524a79d1eb4ea2273647aa657cb13e8cdd934798fec07aaeb
crates/application/src/lib.rs 455ce28470dd4fbbc312be1dbcff1a1e3e79486a586fd989adfb6d7d82368835
crates/model/src/session_requests/types.rs 5bac8b67ae07c442e6252a37d798d656b77bbf823f45189df7bd8fe185cb0c71
crates/common/src/bootstrap_model/schema_metadata.rs 4e5d827e79084cdcb20d500c88058fb807c0879677be70ed8dcec423a1fcfe46
crates/model/src/modules/module_versions.rs acac5f1a5fe3caf20273b2fe59b4d95d66caaa3735c25adbfcf5f3cc77d37680
```

## Source and divergence rules

Translate the pinned algorithm, ordering, dependency/accounting, storage and
failure/recovery mechanisms as closely as possible into the existing TypeScript
core. Only demonstrated DO/runtime constraints or required native behavior justify
a mechanism divergence. Existing private APIs, layouts and product policies do
not automatically qualify. Follow the [replacement workflow](./engine/REFACTOR.md#convex-guided-replacement-workflow),
[goal](./engine/GOAL.md) and [divergence records](./engine/divergences/README.md).

Before each runtime slice, independently inspect current Flarex callers, the
accepted target and current pinned Convex owners/tests, then exchange challenges.
Revalidate affected old-pin contracts, including connected slice 06, before runtime
dispatch. Preserve historical evidence and unrelated work; do not relabel prior
passing witnesses as new-pin conformance. A missing upstream test must be reported
and replaced by a meaningful translated witness, not presumed to have passed.

## Cache and retention reference defaults

At this pin the shared page reader can return cached pages, but persistence
verification defaults to 100 percent (`INDEX_CACHE_VERIFY_PERCENT`). It therefore
does not establish default SQL read avoidance. Transaction cache capacity is
separately 16 MiB (`MAX_TRANSACTION_CACHE_SIZE_BYTES`). Snapshot window 10 seconds,
index retention delay four minutes, document retention delay fourteen days and
shared page capacity 512 MiB remain configurable source defaults. None selects
our per-DO budgets, retention settings or verification policy. See
[crates/common/src/knobs.rs](../../../../crates/common/src/knobs.rs) and the [snapshot decision](./engine/02-timestamped-snapshots.md).

### Index readiness sources

Current persistence includes backfill write modes, reconciliation and history
reclamation. Use the current owners above plus `database_index_workers` and
deployment activation callers for each concrete builder slice. Required enabled
metadata remains snapshot-specific; backfill progress alone is not serving readiness.

## Transferable ideas and explicit divergences

Use [the current translation plan](./engine/REFACTOR.md#core-and-physical-schema-translation-plan).
The five-table physical baseline refers specifically to the PostgreSQL adapter.
MySQL V6 is comparison evidence; current-index projections are not universally
absent upstream. Any additional PostgreSQL family still needs its DO/native
justification and connected read/write/retention/recovery proof.

## Flarex source and prior experiments

The [supported-profile baseline](./engine/baseline/README.md), [alignment findings](./engine/CONVEX-ALIGNMENT.md)
and actual executing callers own existing consumer evidence. The initial
`experiments/core/src` implementation is retained comparison material, not the
runtime engine or its physical-schema template.

## Concrete redesign evidence

Earlier workload/cost investigations remain in the [historical source map](./REFERENCES-84fbb0e.md#concrete-redesign-evidence).
Their exact cohorts are not current performance results or removable-cost estimates.

## PostgreSQL and hosted execution references

Inspect current fenced batch persistence and host resource adapters together.
PostgreSQL owns durable application truth. No database transaction spans untrusted
execution, remote effects or workflow suspension; a DO restart alone is not
uncertain-outcome recovery. Earlier host evidence is retained in the
[historical map](./REFERENCES-84fbb0e.md#postgresql-and-hosted-execution-references).

## Standalone Application construction references

Use current Application invocation/runtime and installed source-selection owners
with the [operation-lifetime](./engine/02-operation-lifetime.md) and
[authorization](./engine/02-read-authorization.md) decisions. Earlier construction
references are [historical evidence](./REFERENCES-84fbb0e.md#standalone-application-construction-references),
not permission to retain the old engine choreography.
