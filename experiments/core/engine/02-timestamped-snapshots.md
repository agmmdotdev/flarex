# Concept 02: timestamped snapshots

Status: **Accepted read contract and cache/retention direction; no implementation**.
Each admitted query or atomic operation reads committed data at one safe published timestamp,
including cache misses. Follow Convex's demand population, write invalidation,
validated concurrent fills, bounded cache size and bounded historical retention.
The [operation-lifetime decision](./02-operation-lifetime.md) selects one snapshot
and deadline per atomic operation, shared nested work and phase-aware expiry/retry
rules. Numerical budgets, local representation and native conformance remain
open. Replication is **open and explicitly deferred**.

This resolves the published-read-view question in the
[commit contract](./01-commit-coordination.md), under the
[accepted architecture](../../../design-notes/flarex-db-accepted-design.md#portable-core-refactor-direction).
It does not make a complete Medusa workflow one transaction or authorize replay
of framework hooks and external effects. Native profile boundaries still apply.

## Accepted read contract

1. The app owner selects a safe published timestamp `S` when admitting an
   operation. Every committed-data observation in that operation uses `S`, across
   awaits and across RAM, DO SQLite and PostgreSQL. Private pending changes are
   layered over that base according to the operation's execution profile; other
   operations' accepted-but-unpublished changes are not ordinary readable data.
2. The published timestamp is a safe visibility boundary, not the maximum saved
   timestamp. Earlier accepted work must be resolved before advancing past it.
   Once `S` is admitted, later persistence must not change the committed history
   visible at or before `S`. Fencing, recovery and treatment of failed positions
   must establish this invariant; a SQL timestamp filter alone cannot establish it.
3. A cache entry or range is usable only when it proves the requested result at
   `S`. Otherwise it is a cache miss. A missing historical cache entry is not
   proof that the document or matching range was empty at `S`.
4. PostgreSQL fallback reads explicit engine history as of `S`: document versions,
   index membership and deletion history must agree. Never fall back to latest
   rows because the cache missed. Counts, ordering, population and page reads
   within the operation must use the same view; current index membership plus
   historical document bodies is not a coherent snapshot.
5. Publication may advance while an operation runs. That operation retains `S`;
   a new ordinary read uses the ready owner's latest published timestamp and
   includes mutations acknowledged before the call began. Follow the
   [read-after-write policy](./02-read-after-write.md) for recovery gating and
   reactive-client timestamp synchronization. Exact client protocol and
   cross-request pagination lifetimes still need their own contracts.
6. Required history must be available, or the operation must fail explicitly.
   Restart is permitted only under its established replay rules and recomputes
   the operation against a new admitted snapshot. Never silently switch a running
   operation to latest data or retry arbitrary native side effects.

The snapshot owner, cache-validity rules and historical-read contract belong to
portable core owners. Cloudflare adapters supply RAM/SQLite hosting and
PostgreSQL access. PostgreSQL remains committed-data and outcome authority;
SQLite durability does not make the local cache a second commit authority.

The owner can supply the published timestamp locally while its ownership and
recovered state are valid. The contract does not require a PostgreSQL freshness
query before every cache hit. Follow the
[read-authorization split](./02-read-authorization.md): application permission
records use tracked snapshot reads, while authentication, engine-grant revocation
and required readiness retain their separate enforcement. A cached timestamp
does not replace those obligations.

## Two carts and a cache miss

Use small logical timestamps for illustration, not a selected timestamp encoding:

| Position | State |
| --- | --- |
| Published `100` | Alice's cart quantity is `1`; Bob's is `4` |
| Accepted A at `101` | Alice proposes `2`; its save is still pending |
| Accepted B at `102` | Bob proposes `5`; its save has completed, but publication waits for A |

A new query starts at `S = 100` and misses Bob's cart in the cache. PostgreSQL
may already contain Bob's new version at `102`. The fallback selects Bob's last
visible version at or before `100`, returning `4`. It must not return `5` just
because PostgreSQL has saved it. Alice's visible quantity is still `1`.

If A subsequently succeeds and the owner publishes `101` then `102`, a new query
can read Alice `2` and Bob `5`. The already-running query stays at `100`, even
if its next read happens after that publication. A newer cached row is either
accompanied by a valid answer for `100` or treated as a miss for that query.

If A's outcome becomes uncertain, the accepted stop/fence/reconcile/rebuild
protocol applies. This note does not authorize advancing to `102` or discarding
durable B based on a guess about A. The
[read-after-write policy](./02-read-after-write.md#accepted-recovery-and-cold-cache-behavior)
gates new ordinary reads with bounded waits or explicit failure until recovery
establishes a safe view. Concrete interlocks and handling of already-running
operations remain part of the unresolved recovery protocol.

## Pinned Convex mechanism

Reference revision: `84fbb0e70b4e857913673871cb847ad11a55f3d5`. The
[source map and hashes](../REFERENCES.md#engine-mechanism-reference-map) identify
the inspected local files. These are source observations, not measured parity.

| Source and symbols | Mechanism we preserve |
| --- | --- |
| [Database](../../../../../crates/database/src/database.rs): `now_ts_for_reads`, `begin_with_usage`, `begin_with_repeatable_ts`, `wait_for_write_ts` | Choose the snapshot manager's safe timestamp, construct snapshot-backed transaction state and a persistence reader fixed to that timestamp; waiting for a write concerns visibility, not merely its presence in storage. |
| [Snapshot manager](../../../../../crates/database/src/snapshot_manager.rs): `latest`, `latest_ts`; [committer](../../../../../crates/database/src/committer.rs): `publish_commit` | Ordered publication advances the usable engine snapshot. Repeatable timestamps exclude later-arriving writes within the admitted view. |
| [Persistence](../../../../../crates/common/src/persistence.rs): `RepeatablePersistence::read_snapshot`, `PersistenceSnapshot::index_scan`, `index_get` | Retain a fixed `at` timestamp and pass it through persistence reads, with retention validation. This is explicit engine history, not one long SQL transaction. |
| [Index cache](../../../../../crates/indexing/src/index_cache/mod.rs): `get`, `populate`, `apply_writes`, `index_page_at_ts` | Cached ranges have timestamp eligibility and write invalidation. A page newer than the requested timestamp is a miss; population must account for writes racing with its fetch before the page is usable. The cache need not retain every historical page. |
| [In-memory indexes](../../../../../crates/indexing/src/backend_in_memory_indexes.rs): `DatabaseIndexSnapshot::range_batch`, `fetch_cache_misses` | Combine versioned local index state with misses fetched through the snapshot's persistence reader. Cache coverage and historical membership matter as well as row bodies. |
| [PostgreSQL queries](../../../../../crates/postgres/src/sql.rs): `INDEX_QUERIES`; [reader](../../../../../crates/postgres/src/lib.rs): `_index_scan_inner` | Filter index history by the requested timestamp, select the latest eligible entry per key including deletion markers, and join its matching document revision. Validate retention before yielding results. A physically saved future version is excluded. |

Convex's in-memory snapshots and its shared index-page cache are different
mechanisms. The latter can miss for an older timestamp and read history from
persistence. Matching the read contract does not require every DO cache to keep
every revision in RAM or SQLite.

## Accepted cache and retention direction

Follow the inspected Convex mechanisms at the portable core boundary:

- Populate reusable data/index ranges on demand when they miss, with explicit
  timestamp eligibility and completeness. Selected bootstrap metadata/index
  loading is a separate responsibility; this does not select full app residency.
- Coordinate relevant range invalidation with ordered commit publication.
  Unrelated ranges can remain usable. A time-to-live alone cannot establish
  validity or replace write participation and ownership fencing.
- Validate fills against intervening published writes before making the entry
  reusable. If the necessary change history is unavailable, refuse that fill.
  Losing invalidation tracking must turn the entry into a miss.
- Bound retained cache memory/storage and permit eviction of valid entries.
  Eviction changes the read path to historical persistence at the same timestamp;
  it does not change the operation's snapshot or prove document absence.
- Bound authoritative history separately. A running operation does not receive
  indefinite history retention merely because it is still alive. Keep expiry
  explicit and let the native profile's root own any eligible restart.

These are accepted design principles, not a selected TypeScript cache library,
SQLite schema, garbage collector, timeout value or framework replay policy.
PostgreSQL remains durable authority. The core defines validity, coverage and
publication ordering; injected runtime/storage adapters supply their mechanisms.

## Pinned cache and retention evidence

All observations below use the same recorded Convex revision. Distinguish these
stores instead of assigning one expiry policy to everything:

| Store | Pinned source and behavior |
| --- | --- |
| Resident metadata and selected indexes | [Database::load](../../../../../crates/database/src/database.rs) loads bootstrap table/index metadata; [BackendInMemoryIndexes](../../../../../crates/indexing/src/backend_in_memory_indexes.rs) maintains selected loaded indexes. Snapshot structures use immutable/copy-on-write state. This is not proof that all application data is resident. |
| Operation-local document/range cache | [DatabaseIndexSnapshot::range_batch and DatabaseIndexSnapshotCache](../../../../../crates/indexing/src/backend_in_memory_indexes.rs) populate fetched documents and mark complete intervals after their rows are available. Repeated point reads and covered subranges can reuse that operation's observations. |
| Shared index-page cache | [IndexCache::new, get, populate, apply_writes](../../../../../crates/indexing/src/index_cache/mod.rs) use timestamp-aware ranges, publication-driven invalidation and weighted capacity eviction. Its constructor sets no fixed TTL; a tracked unchanged page can remain useful across newer timestamps. |
| Recent snapshot lookup history | [SnapshotManager::push and snapshot](../../../../../crates/database/src/snapshot_manager.rs) retain a bounded window, dropping an old version only when its successor leaves that window. A timestamp older than the retained versions produces `OutOfRetention`. Retaining an existing snapshot object does not pin PostgreSQL history indefinitely. |
| In-memory write history | [WriteLogManager::enforce_retention_policy, WriteLog::is_stale and refresh_token](../../../../../crates/database/src/write_log.rs) bound change history by time and size. Lost history prevents validating an old dependency token or cache fill; it cannot be treated as proof that no write occurred. |
| Durable document/index history | [candidate_min_snapshot_ts, advance_timestamp and RetentionValidator](../../../../../crates/database/src/retention.rs) advance boundaries from safe persisted repeatable progress, then remove obsolete revisions. Publish the boundary to persistence before advancing the in-memory deletion bound. Document cleanup is constrained by index-cleanup progress. Reads outside the supported boundary fail explicitly. |
| Whole-query result cache | [CacheManager::validate_cache_result and Inner::enforce_size_limit](../../../../../crates/application/src/cache/mod.rs) validate dependency tokens, reject results newer than the requested timestamp, and evict least-recently-used results to meet the size limit. Results that observed system time also have an age check. This is separate from the shared index-page cache. |

Whole-query result caching is reference evidence here, not approval to memoize
native Medusa/Payload hooks, access decisions or side effects. Broader reactivity
and query-result reuse remain under the queued concepts and native contracts.

### Cache fill racing a cart update

1. A read at `100` misses and starts fetching cart quantity `1`.
2. A mutation saves quantity `2` at `101`. Its ordered publication appends the
   write log and invalidates overlapping cached ranges before exposing the new
   snapshot. See [Committer::publish_commit](../../../../../crates/database/src/committer.rs).
3. The fetch at `100` finishes. The old result can still answer that operation
   while its history is valid, but must not become an eligible shared answer at
   `101` without checking intervening writes.
4. Convex's `populate` inserts an entry marked not ready, registers its range for
   invalidation, and checks the write log after the fetched timestamp. An overlap
   or unavailable history discards the entry. Only the same validated population
   may be marked ready; concurrent invalidation/replacement cannot certify a
   different entry accidentally.
5. A new read at `101` can fetch quantity `2` and populate a valid page. The read
   at `100` continues to use `100`, through an eligible local answer or history.

Range tracking covers both old and new index keys, including inserts and deletes.
This matters for cached empty ranges, counts and membership changes, not just
updates to a row already present in the cache. Population validation and future
invalidation close different sides of the race. The source calls population
two-phase; this is a local cache protocol, not a distributed database commit.

### Reference defaults, not selected Flarex settings

The pinned [configuration knobs](../../../../../crates/common/src/knobs.rs) define:

| Knob | Source default | Meaning / limitation |
| --- | --- | --- |
| `MAX_TRANSACTION_WINDOW_SECONDS` | 10 seconds | Recent in-memory snapshot lookup window; not an exact request timeout or a TTL on every cached object |
| `INDEX_RETENTION_DELAY` | 4 minutes | Delay behind safe persisted repeatable progress for index-history retention |
| `DOCUMENT_RETENTION_DELAY` | 14 days | Document-revision history delay; does not make arbitrary 14-day-old indexed snapshots available |
| `INDEX_CACHE_SIZE` | 512 MiB | Configurable shared index-page cache capacity; not a per-app/DO allocation or a confirmed Convex Cloud setting |

These values are overridable source defaults, not production observations or
chosen engine limits. Background deletion and safety dependencies can retain data
longer. Retention removes obsolete versions/tombstones when safe, not a current
cart or product simply because it was last changed before the retention window.
Cache eviction, recent snapshot lookup, write-log coverage, durable index history
and durable document history have different purposes and bounds.

The query-result cache's `MAX_CACHE_AGE` is defined separately as the configured
total query timeout plus one second and applies to results that observed time.
It must not be read as a TTL for every data/index cache. No identical numerical
settings or cache algorithms are selected for TypeScript/DO by this record.

## Adaptation and remaining choices

The semantic choice follows Convex: a fixed safe timestamp reaches every read
path. Our runtime and storage representation must differ where necessary:

- Convex uses Rust versioned structures and synchronized shared caches. Our
  portable TypeScript owners must provide equivalent validity and coverage using
  suitable structures and injected SQLite where selected. Representation remains
  unchosen; compare memory, CPU, retention and fallback cost before accepting it.
- Our PostgreSQL history/query layout is redesignable and must be exposed through
  the Drizzle persistence owner. A current-row table or `ts <= S` predicate on an
  incompletely recovered history is insufficient. Named data needs an explicit
  migration/reset disposition when implementation is selected.
- Application, Medusa and Payload retain distinct atomic lifetimes and replay
  rules under the [accepted operation boundary](./02-operation-lifetime.md#accepted-operation-boundary).
  Prove each actual native mapping; a workflow with independent
  commits or remote effects is not automatically one snapshot or one retryable
  mutation. Convex's function boundary cannot silently redefine native behavior.

Record each concrete divergence and its evidence under the
[source and divergence rules](../REFERENCES.md#source-and-divergence-rules).
No Rust source is copied and no representation or performance parity is claimed.

## Next decision and proof boundary

Snapshot ownership, inherited deadlines and expiry policy are accepted in the
[operation-lifetime record](./02-operation-lifetime.md). Numerical limits and
native compatibility still need evidence. The next focused question is
[resumable index backfill](./OPEN-QUESTIONS.md#next-question-resumable-index-backfill).
Local version retention, cache coverage and fencing remain in the canonical
queue; replication stays deferred.

Before implementation can replace current reads, proof must cover B saved before
A, misses while B is hidden, publication between two reads, an older snapshot
encountering a newer cache entry, historical inserts/deletes and empty ranges,
count/population agreement, concurrent cache population, and history expiry.
Include fills invalidated/replaced before becoming ready, lost write-log coverage,
old/new index keys crossing cached intervals, budget eviction, and durable history
cleanup racing a historical read. Current rows must survive historical cleanup.
Preserve pending read-your-writes and current authorization separately. Later
storage proof requires both PGlite and ordinary-role PostgreSQL, followed by the
actual host's eviction/recovery cases and complete-operation cost measurements.
No runtime checks, schema changes or benchmarks are performed by this decision.
