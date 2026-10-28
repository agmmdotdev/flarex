# Concept 02: timestamped snapshots

Status: **Accepted read contract; implementation not started**. Each admitted
query or atomic operation reads committed data at one safe published timestamp,
including cache misses. Snapshot lifetime, local history representation and
retention policy remain open. Replication is **open and explicitly deferred**.

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
   a later operation may select the newer published timestamp. A normal read
   admitted after acknowledged mutation success must be able to include that
   mutation. Client freshness tokens and cross-request pagination lifetimes still
   need their own contracts.
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
query before every cache hit. Snapshot validity is separate from current
authorization, revocation and readiness; their required enforcement cannot be
removed merely because a timestamp is cached.

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
durable B based on a guess about A. Read availability during recovery remains
part of the unresolved recovery protocol.

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
- Application, Medusa and Payload have distinct atomic lifetimes and replay
  rules. Map the snapshot unit to each actual profile; a workflow with independent
  commits or remote effects is not automatically one snapshot or one retryable
  mutation. Convex's function boundary cannot silently redefine native behavior.

Record each concrete divergence and its evidence under the
[source and divergence rules](../REFERENCES.md#source-and-divergence-rules).
No Rust source is copied and no representation or performance parity is claimed.

## Next decision and proof boundary

The next focused question is [snapshot lifetime](./OPEN-QUESTIONS.md#next-question-snapshot-lifetime):
how long may an operation retain its timestamp, and what happens when its required
history expires? Local version retention, cache coverage, authorization and
fencing remain in the canonical queue; replication stays deferred.

Before implementation can replace current reads, proof must cover B saved before
A, misses while B is hidden, publication between two reads, an older snapshot
encountering a newer cache entry, historical inserts/deletes and empty ranges,
count/population agreement, concurrent cache population, and history expiry.
Preserve pending read-your-writes and current authorization separately. Later
storage proof requires both PGlite and ordinary-role PostgreSQL, followed by the
actual host's eviction/recovery cases and complete-operation cost measurements.
No runtime checks, schema changes or benchmarks are performed by this decision.
