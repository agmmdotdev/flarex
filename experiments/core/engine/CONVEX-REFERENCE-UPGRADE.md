# Convex reference upgrade to db914cf06

Status: **Accepted source baseline and refactor-plan update; runtime conformance
and performance remain unproved**. Active pin:
`db914cf06e2b06ee985646611b9e12ed7a770318` (upstream main inspected 2026-10-30).
This upgrades the former local reference `84fbb0e70b4e857913673871cb847ad11a55f3d5`.
The [current map and raw-blob hashes](../REFERENCES.md) own source identity;
the [historical map](../REFERENCES-84fbb0e.md) preserves previous observations.
The latter links to byte-identical published sources at the old upstream ancestor,
not to an assumed published version of the local reviewer-configuration commit.

## What remains accepted

Translate Convex core algorithms and the selected PostgreSQL physical schema into
TypeScript/Drizzle in existing package owners. This is a total rewrite of internal
interfaces, with supported native behavior and named durable-data obligations
preserved. DO/runtime constraints and required native behavior are the grounds
for mechanism divergence. PostgreSQL alone owns committed truth. Payload,
Medusa and Task consume the shared engine/lifecycle rather than creating their
own database, schema installer, recovery or publisher.

The selected physical baseline remains the PostgreSQL adapter's five core tables:
`documents`, `indexes`, `leases`, `read_only`, `persistence_globals`.
Document/index columns, keys and same-timestamp ordinary-index hydration survive
the upgrade. This does not certify migration-ready DDL or current Flarex parity.

## Mechanisms that change the translation plan

| Area | Current pinned mechanism | Required translation consequence |
| --- | --- | --- |
| Commit pipeline | [committer.rs](../../../../../crates/database/src/committer.rs): `pre_validate_batch`, `validated_through`, `validate_commit`, `track_and_write_to_persistence`, `publish_commit`; [write_batcher.rs](../../../../../crates/database/src/write_batcher.rs) | Preserve bounded stages, historical prevalidation and final residual published-suffix plus all accepted pending-write checks. Translate bounded row/byte/delay/concurrency group commit as well as ordered publication. A SQL batch can contain several logical timestamps/outcomes. |
| Pending conflicts | [write_log.rs](../../../../../crates/database/src/write_log.rs): `WriteLogSnapshot`, `PendingKeysInIndex`, `PendingWrites` | Preserve immutable per-index committed history, ordered pending-key/range overlap and FIFO removal; text-search fallback remains separate. Repeated full pending scans are not a faithful default. |
| Persistence contract | [persistence/mod.rs](../../../../../crates/common/src/persistence/mod.rs), [types/index.rs](../../../../../crates/common/src/types/index.rs) | Carry `IndexRef`, `IndexWriteMode` and predecessor evidence in `PersistenceIndexEntry`. Resolve physical index identity at the same metadata revision. Translate idempotent backfill, reconciliation before `ScanComplete` and storage-owned `reclaim_index_history`. |
| Retention | [row_index_retention.rs](../../../../../crates/common/src/persistence/row_index_retention.rs), [retention.rs](../../../../../crates/database/src/retention.rs) | Derive row-index reclamation from document revision pairs and safe floors; do not port the removed index-table scan/delete interface. Keep snapshot, index and document retention distinct. |
| Index/cache owners | [database_index_snapshot.rs](../../../../../crates/indexing/src/database_index_snapshot.rs), [in_memory_indexes.rs](../../../../../crates/indexing/src/in_memory_indexes.rs), [index_reader.rs](../../../../../crates/indexing/src/index_reader.rs) | The old `backend_in_memory_indexes.rs` owner has split. Current shared-page reads return eligible cached pages, with optional persistence verification. Validate fills against row writes and `_index.by_id` metadata changes; evict modified-index coverage. |
| Private schema state | [schema model](../../../../../crates/database/src/bootstrap_model/schema/mod.rs), [persistence-index allocator](../../../../../crates/database/src/bootstrap_model/next_persistence_index_id/mod.rs) | Map `_schema_validations` and `_next_persistence_index_id` to private logical metadata. A write can transactionally fail staged validation while remaining valid under the active schema; do not universally reject it. |
| PostgreSQL lease | [sql.rs](../../../../../crates/postgres/src/sql.rs), [lib.rs](../../../../../crates/postgres/src/lib.rs) | Preserve the read-only-aware conditional lease acquisition and acquire-before-freshness order. A separate read-only precheck does not close the acquisition race. |

Rust background threads and concurrent data structures are implementation tools.
DO JavaScript scheduling does not create CPU parallelism by using promises.
Choose and document host scheduling/data structures while retaining validation,
visibility and recovery semantics. Do not substitute an unbounded JS scan or
invent new SQL round trips merely to mimic module names. Numerical batch/queue
limits and placement need the affected slice's proof and divergence where required.

A read-only commit bypass applies to a finalized empty write set. A mutation that
must persist an outcome or required system state is not read-only merely because
its user document writes are empty. Every member of a grouped SQL save must keep
its logical timestamp, conflict checks, atomic required outcomes and ordered
publication; a lost COMMIT response requires whole-batch reconciliation before
unsafe replay. Existing idempotency obligations remain with their owning profile.

## PostgreSQL baseline and alternative upstream storage

The selected PostgreSQL adapter still uses five tables. However, upstream also
has selectable [MySQL V6 storage](../../../../../crates/mysql/src/v6/sql.rs):
`indexes_latest`, `indexes_backfill_deletes` and ten-minute `indexes_log_*`
buckets. Source selection is not a claim about Convex Cloud deployment status.
Do not claim that Convex universally has no current-index projection or use that
claim alone to delete Flarex heads. Our accepted baseline remains PostgreSQL;
a retained extra family still requires the established DO/native justification,
safe-prefix visibility, rebuildability and connected reader/writer proof.

The engine's richer index contract does not require adopting the MySQL tables.
The selected PostgreSQL persistence owner must implement its meaning using the
chosen five-table layout or record a necessary divergence. Payload/Medusa data,
private catalogs, install/build/activation progress and migration state remain
logical records above that layout. Platform physical upgrades remain distinct.

## Updated correctness cases and implementation gates

Before resuming an affected runtime slice, independently challenge current
Flarex, accepted direction and this exact Convex pin, then coordinate workers
with explicit ownership under [REFACTOR.md](./REFACTOR.md#pre-slice-challenge-and-agent-coordination).
Existing checkpoints remain evidence for their original pin, not new conformance.
Reassess each affected divergence against the new owner/callers before relying on it.
The connected [persistence slice](./slices/06-convex-persistence-translation.md)
and Task's translated-core integration must refresh their source challenge;
this update does not silently replace their original findings or close their gates.

Add the following source-derived traces to the owning slice where applicable:

- A published write arrives between prevalidation and final acceptance; an
  accepted pending write conflicts before its persistence completes. Both must
  be detected. Bound queued work and retain FIFO pending cleanup/publication.
- Several logical commits share one SQL batch: success, fencing loss, partial
  response loss and unknown COMMIT outcome preserve per-operation identities and
  batch recovery. An empty user write set cannot bypass required outcome writes.
- Short snapshot pages mixed with pending inserts/deletes/key moves, ascending
  and descending, including `take(n)`: merge only through the consumed snapshot
  cursor, with no duplicate, skipped key or overclaimed dependency interval
  (upstream change `30710594e`).
- Repeatable-timestamp bump re-arms its race state (`c04e2f75f`); nested rollback
  restores TableCounts deltas (`aad76a42a`) alongside the actual checkpointed
  state, with native/Application policy differences resolved at their owners.
- Mutations acquire the execution permit before selecting the snapshot
  (`d328f85e0`); committed-outcome replay still precedes a fresh body. Keep
  deterministic UDF time tied to the admitted snapshot-derived floor
  (`3f327b5ab`) and resolve commit-timestamp placeholders only after assignment.
- Schema/index metadata changes race a cache fill; historical `IndexRef`
  identity, backfill modes/predecessors, reconciliation and retention stay coherent.
  Exercise staged-validation failure without rejecting an active-schema-valid write.
- Read-only transition races lease acquisition; owner replacement and cold
  recovery cannot publish saved future data before the safe prefix.

If a slice admits additional upstream capabilities, such as mutation file-upload
state, include their finalization/checkpoint behavior. This does not authorize
new feature coverage implicitly; unsupported capabilities continue to fail closed.

## Evidence limits and source-link disposition

This is a local source-diff audit, not a benchmark or executed database/host proof.
Some upstream changes describe tests absent from this public checkout; derive
cases from executing code and identify test availability honestly. No Rust,
PGlite, real PostgreSQL or actual-host conformance result is established here.
Use the goal's existing owner/consumer, database, DO and performance gates.

Source defaults include 10-second recent snapshot lookup, 4-minute index history,
14-day document history, 512 MiB shared page cache and a separate 16 MiB
transaction cache. `INDEX_CACHE_VERIFY_PERCENT` defaults to 100: the shared
page path serves the cached result but verifies it against persistence by default.
Neither an automatic SQL reduction nor those values as DO budgets is established.

Historical notes keep their old pins and hash evidence. Links to removed source
owners in touched historical records are frozen to byte-identical old upstream
blobs. Active plan links use the split/new owners. Every later source upgrade
must repeat the audit and update active contracts and source hashes together.
