# Concept 02: ordinary database index readiness

Status: **Accepted design direction; no implementation**. Follow Convex's
backfilling, backfilled and enabled lifecycle for ordinary application database
indexes. Required builds gate deployment activation; queries use only indexes
enabled in their own metadata snapshot. Backfill/checkpoint/recovery mechanisms
remain open. Replication is **open and explicitly deferred**.

This refines [timestamped snapshots](./02-timestamped-snapshots.md) and
[read admission](./02-read-after-write.md). Full-text/vector indexes, uniqueness
and other constraint-readiness protocols are not selected by this decision.

## Accepted lifecycle and deployment boundary

| State | Required meaning | Available to ordinary queries? |
| --- | --- | --- |
| Backfilling | Existing documents are being indexed; concurrent inserts, updates and deletes must also be covered | No |
| Backfilled | Durable completeness has been established for the supported view, but the index has not been enabled | No |
| Enabled | The activation is committed and published, and the index is available in eligible snapshots | Yes |

Backfilled is a completeness claim, not merely a cursor reaching the last scanned
document. Its proof must account for concurrent writes, history and any outstanding
work before the index is eligible for activation. Exact checkpoint, catch-up and
terminality representation remains open; these state names alone provide no proof.

Normal deployment waits for its required non-staged indexes before exposing the
new functions or native binding definitions that require them. The current app
continues serving its supported active definition while preparation proceeds.
Enablement is a committed metadata change coordinated with app-definition
activation so the published deployment cannot require an unavailable index.
Concrete activation transactions and definition-version handoff remain open.

Follow Convex's staged-index direction for advance preparation: build without
making the index queryable, then enable it through a later deployment after the
build completes. The public syntax and orchestration API are not selected here.
This is not permission to expose new code that already requires the staged index.

If an ordinary query explicitly requires an index unavailable in its snapshot,
return a clear readiness/not-found error as appropriate. Do not wait inside that
query for the index to become ready, read a partial index or silently substitute
a full-table scan. Waiting belongs to deployment preparation. Existing explicitly
supported scans remain their own operation; no implicit fallback is introduced.

## Accepted metadata and cache rules

The app owner keeps index definitions/readiness in its versioned metadata view.
Each operation resolves the index using the same timestamp as its data reads and
records the required metadata dependency. Publication updates the shared registry;
an operation does not switch to newer metadata midway through execution.

If enablement is published at `150`, an operation pinned to `149` keeps its earlier
index view. New eligible operations at `150` or later can resolve the enabled
index. An older operation that requires the unavailable new index fails under its
own view rather than adopting `150`. Existing valid earlier definitions remain
subject to the separate retention and replacement protocols.

Index readiness and local cache coverage are different properties. PostgreSQL
owns durable index entries and authoritative metadata. The DO may cache only
selected ranges; an enabled index can serve a cold-cache query through timestamped
PostgreSQL reads. A partial local range must never imply complete results or absence.
Local metadata lookup need not add a PostgreSQL round trip for every row, provided
ownership, version eligibility and dependency tracking are proved.

A durable SQLite file, cached enabled flag or old build cursor cannot establish
readiness after restart. Apply the accepted owner recovery gate and reconstruct
authoritative metadata before admitting ordinary queries. No current readiness
check is removed before replacement enforcement and relevant writers are proved.

## Cart example

1. The active app serves carts using its existing supported definition.
2. Prepare `carts.by_customer` in Backfilling state. Build entries for existing
   carts while concurrent cart creation, edits and deletion remain covered.
3. Mark it Backfilled only when the required completeness proof holds. A staged
   index stays unavailable even after this step.
4. Commit and publish enablement with the compatible deployment state. Only then
   expose the new query that requires `carts.by_customer`.
5. An eligible query can use the index even if the DO has cached none of its pages;
   missing ranges come from PostgreSQL at the operation's selected snapshot.

This is an admission/lifecycle contract, not a completed backfill algorithm.
Resuming batches after crashes and proving ongoing-write coverage are the next
focused design work; native business hooks must not be rerun to rebuild an index.

## Pinned sources and necessary differences

Convex reference: `84fbb0e70b4e857913673871cb847ad11a55f3d5`; the
[source map and hashes](../REFERENCES.md#source-and-divergence-rules) anchor this
inspection. No source translation or runtime change is authorized by the note.

| Reference | Mechanism and limit |
| --- | --- |
| [DatabaseIndexState](../../../../../crates/common/src/bootstrap_model/index/database_index/index_state.rs) | Explicit Backfilling, Backfilled and Enabled states; new writes maintain a building index. This note covers ordinary application indexes, not special system-index shortcuts. |
| [IndexRegistry::require_enabled](../../../../../crates/indexing/src/index_registry.rs) | Enabled lookup succeeds; pending staged/backfilling and absent indexes produce errors. Enabled and pending generations can coexist by name. |
| [TransactionIndex::require_enabled and record_interval](../../../../../crates/database/src/transaction_index.rs) | Successful resolution records the index metadata dependency in the operation's read set. This alone does not prove caching of readiness errors is safe. |
| [IndexModel::enable_index and commit_indexes_for_schema](../../../../../crates/database/src/bootstrap_model/index.rs) | Enabling requires backfilled state; schema commit coordinates the selected index changes. |
| [database index worker](../../../../../crates/database/src/database_index_workers/mod.rs), [IndexWriter::backfill_from_ts](../../../../../crates/database/src/database_index_workers/index_writer.rs) | Build an eligible snapshot and account for later writes; persist completion through metadata transactions. Detailed retention, checkpoints and crash interleavings still require a focused inspection before adaptation. |
| [Deployment schema status and finish_push](../../../../../crates/application/src/deploy_config.rs) | Required non-staged index progress gates deployment readiness; staged builds are excluded from that waiting set. |
| [Index deployment documentation](https://docs.convex.dev/database/reading-data/indexes/#defining-indexes), [staged indexes](https://docs.convex.dev/database/reading-data/indexes/#staged-indexes) | Deployment completes backfills before registering dependent functions; staged indexes cannot be queried until subsequently enabled. |

Preserve these externally visible lifecycle and query rules. The necessary
adaptation is portable TypeScript owners with PostgreSQL durable entries/progress
and injected Cloudflare hosting, instead of relying on a resident Rust runtime.
The DO coordinator must publish the same coherent metadata/data view. The host
for bounded build work, its scheduling and recovery are not selected by naming
the states. Native binding activation must preserve actual framework semantics;
it cannot repair missing engine readiness with private scans or maps.

## Remaining decisions and proof

The next question is [resumable index backfill](./OPEN-QUESTIONS.md#next-question-resumable-index-backfill)
under concept 07. Checkpoint atomicity, concurrent-write capture, durable
completion proof, cancellation/removal/replacement, activation races and build
budgets remain open. Local cache coverage is still Q05; replication stays deferred.

Required later witnesses include queries against absent/building/staged indexes,
completion before enablement, concurrent inserts/updates/deletes, publication
racing an old snapshot, same-name index replacement, stale negative readiness
results, cold caches after enablement and restart with incomplete local state.
Preserve metadata dependencies, native semantics and the database/host gates in
[VALIDATION.md](../VALIDATION.md); no implementation or performance claim follows.
