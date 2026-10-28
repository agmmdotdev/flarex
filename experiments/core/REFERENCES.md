# Source and evidence map

Initial inspection: 2026-10-26; shared-engine source map expanded on 2026-10-27;
timestamped reads, cache population/invalidation, retention, read authorization
and read-after-write freshness inspected on 2026-10-28.
References establish mechanisms and prior results, not the feasibility or speed
of the proposed replacement. The [engine discussion](./engine/README.md) owns the
current direction; [OPEN-QUESTIONS.md](./engine/OPEN-QUESTIONS.md) owns the active
and queued questions with their references. The original candidate remains
implementation evidence. [REFACTOR.md](./engine/REFACTOR.md#existing-seams-and-limits)
maps current integration seams and reuse limits; inspect those owners before
replacing their behavior or assuming that their interfaces must be retained.

## Convex source identity

The local Convex checkout is the enclosing `convex-backend` directory, two levels
above the Flarex repository root. Its inspected Git HEAD is
`84fbb0e70b4e857913673871cb847ad11a55f3d5`. This is a local checkout identity,
not a claim that the commit is published upstream. The inspected files were clean
relative to that HEAD. Its `upstream` fetch remote names `get-convex/convex-backend`;
the [official repository](https://github.com/convex/convex-backend) is the current
web destination. Remote HEAD is not the source pin for this analysis.

Local links below depend on this enclosing checkout. If it is unavailable,
obtain a recorded source revision and recheck symbols/hashes; do not silently
substitute current upstream code. Lines can drift; symbols and content hashes
identify what was inspected.

| Source | Symbols / lesson to inspect |
| --- | --- |
| [database.rs](../../../../crates/database/src/database.rs) | `now_ts_for_reads`, `begin_with_usage`, `begin_with_repeatable_ts`, `wait_for_write_ts`, `commit_with_write_source`: safe read timestamps, snapshot-backed transaction construction, write visibility and one committer handoff |
| [transaction.rs](../../../../crates/database/src/transaction.rs) | `Transaction`, `table_mapping`, nested transaction operations: owned identity, metadata, reads, writes and limits |
| [snapshot_manager.rs](../../../../crates/database/src/snapshot_manager.rs) | `SnapshotManager`, `latest`, snapshot retention: immutable versioned metadata/index state and bounded history |
| [reads.rs](../../../../crates/database/src/reads.rs) | `TransactionReadSet`, `record_read_document`, `record_indexed_directly`, `writes_overlap_by_index`: precise dependencies and conflict detection |
| [writes.rs](../../../../crates/database/src/writes.rs) | `Writes::update`, `NestedWrites`, `coalesced_writes`: original/pending consistency, nested writes and final effects |
| [committer.rs](../../../../crates/database/src/committer.rs) | `Committer`, `write_to_persistence`, `publish_commit`: serialized commit ownership, persistence and visibility ordering |
| [application_function_runner/mod.rs](../../../../crates/application/src/application_function_runner/mod.rs) | `retry_mutation`, `_retry_mutation`, `run_mutation_inner`: retries belong to the root and require eligible failures |

Exact SHA-256 values for those local files:

```text
database.rs       662af0b889e9fa557df54e6eb5e97e0efb76fedd39c385b776bcb84c006d2066
transaction.rs    dcbbff39df81e7419e2571a199b72b2d1f0d41e01efea9ee903054e8a75cf1b9
snapshot_manager.rs f1250a25984684f65adc388f231f7077e06c25721d3ab386581c0972160cecee
reads.rs          c946bcefe9466ae81d7cce3b0de69066edd1955c4d6a114eb8e0e2eb000cb4f1
writes.rs         4b823100a68b5337ec4d4ab681f69c75c722bc61f05b81eeb9c74d788bf58ecf
committer.rs      757694be6c9fcac0eb06cc25a9897132a6ae7ae8b364b2fedc7052c22a12fd45
application_function_runner/mod.rs 4c723adb49b632793e6d2507424845bb60218a1ff7d8d2cb4035e7f03607ed33
```

Read the local [LICENSE.md](../../../../LICENSE.md) before considering source
copying; the inspected file identifies FSL-1.1-Apache-2.0. Its SHA-256 is
`cee614f23a461cb4aba2910e7127ae0969bcf42a0a91a38d3e3449d843383086`.
This experiment uses Convex as an architectural reference. It does not assume
permission to transplant source or that every source file has identical terms.

## Source and divergence rules

The design/development reference remains the exact revision above. Do not follow
a moving branch, silently refresh the pin or infer upstream publication from a
local commit ID. A deliberate pin update records changed mechanisms and refreshes
the affected source hashes and design comparisons together.

Before each concept and implementation slice, inspect the pinned owner, its
callers and relevant tests where available. Record the source path and symbols,
required invariants, concurrency/visibility order and failure behavior. Translate
the mechanism into the responsible portable TypeScript owner as closely as the
host and native framework contracts permit. Do not substitute remembered behavior
or a generic Convex-inspired sketch for reading the code.

Each divergence records the reference mechanism, our replacement, the necessary
reason, effects on behavior/cost, affected consumers/data, and correctness and
performance evidence required. Runtime constraints, framework semantics and
product requirements can justify a difference. Retaining old internal plumbing
or implementation convenience alone cannot. Keep a hypothesis marked unproved;
never claim performance equivalence from structural similarity.

Architectural reference and implementation-source reuse are separate. The pinned
license has competing-use restrictions; a language translation is not itself a
reuse-rights determination. Record the applicable revision/license/provenance
disposition before porting source. No source port is authorized by these design
updates. The [commit record](./engine/01-commit-coordination.md#pinned-convex-mechanism-and-necessary-differences)
maps the selected mechanism and the necessary adaptations currently identified.
The [snapshot record](./engine/02-timestamped-snapshots.md#pinned-convex-mechanism)
maps the accepted read contract, persistence fallback and remaining representation
choices against the same pin.
Its [cache and retention evidence](./engine/02-timestamped-snapshots.md#pinned-cache-and-retention-evidence)
separates local caches, snapshot/write-log windows and durable history. Recorded
Convex defaults are reference values, not selected Flarex settings.
The [operation-lifetime record](./engine/02-operation-lifetime.md#pinned-sources-and-necessary-differences)
maps snapshot/attempt ownership, execution budgets and root retry to native
framework boundaries. Its expiry policy is accepted; concrete interlocks and
numerical limits remain open.

The [read-authorization record](./engine/02-read-authorization.md#pinned-sources-and-necessary-differences)
maps identity-aware result reuse and tracked permission reads to the same pin.
It distinguishes snapshot permissions from authentication and Flarex's separate
engine-grant revocation contract; native result caching is not thereby approved.

Additional inspected authorization owners and SHA-256 values:

| Source | Symbols / lesson to inspect |
| --- | --- |
| [application/src/lib.rs](../../../../crates/application/src/lib.rs) | `Application::authenticate`: validated identity construction is separate from query-result reuse |
| [keybroker/src/broker.rs](../../../../crates/keybroker/src/broker.rs) | `Identity::cache_key`: user attributes and administrative operation scope distinguish relevant identities |
| [sync/src/state.rs](../../../../crates/sync/src/state.rs) | `identity`: current identity validity, expiry and revalidation in the sync path |

```text
crates/application/src/lib.rs 8902d84d576e2f56409dbf4f9e81950fbf1453a29674967964c607774872d819
crates/keybroker/src/broker.rs 006c67399271f57035de1080fa68ef6c5b3d07060e0793267a76c4081c00645d
crates/sync/src/state.rs 07b9932d191e6c6544f5d270b6fb95f59e56e6b7331fc22c1a69c01c0440fe6b
```

## Engine mechanism reference map

The [read-after-write record](./engine/02-read-after-write.md#pinned-sources-and-necessary-differences)
maps publication-before-acknowledgement, latest-query admission, lease-protected
startup and reactive-client synchronization. The following additional owners were
inspected at the same pin; the database/committer/persistence hashes are recorded
elsewhere in this map.

| Source | Symbols / lesson to inspect |
| --- | --- |
| [application/src/api.rs](../../../../crates/application/src/api.rs) | `execute_public_query`, `latest_timestamp`: select the latest safe server read view |
| [local_backend/src/public_api.rs](../../../../crates/local_backend/src/public_api.rs) | `public_query_post`: ordinary queries request `ExecuteQueryTimestamp::Latest` |
| [browser/http_client.ts](../../../../npm-packages/convex/src/browser/http_client.ts) | `query`, `queryInner`: ordinary requests do not fetch a timestamp separately; explicit historical calls are distinct |
| [browser/sync/request_manager.ts](../../../../npm-packages/convex/src/browser/sync/request_manager.ts) | `onResponse`, `removeCompleted`: successful mutation promises wait for applied query-state progress |
| [browser/sync/client.ts](../../../../npm-packages/convex/src/browser/sync/client.ts) | Transition handling and `maxObservedTimestamp` reconnect state |
| [sync/src/worker.rs](../../../../crates/sync/src/worker.rs) | `Connect`/`MutationResponse` handling: commit timestamps and backwards-view rejection |

```text
crates/application/src/api.rs 65e06edfc0053c1ab3d685d0b1cd003ed035ecf5ec7275eea336e837224b88f2
crates/local_backend/src/public_api.rs 4b1760a31337f8abad089bfafe429787dc1fa0677aef1620e5f75d81ef4de57d
npm-packages/convex/src/browser/http_client.ts b4fb42567d18b853670950519d8c7c90c83616c77124e9509c495052d08b2ef6
npm-packages/convex/src/browser/sync/request_manager.ts a094d4c15ede3ac0f0b72334324dc54a6deff1cec86e7f8dfe73b2c556eb6bfd
npm-packages/convex/src/browser/sync/client.ts f5b3428b6912320f3220e01a4392cac1061cbd40c7a1677e64257bc13a51f7e9
crates/sync/src/worker.rs 8b197efded7fb43f44c649e4ef00e34c298424ff431fcca71d1b757a5f0ff88d
```

Use these owners together: caches alone do not supply transaction consistency,
commit authority or recovery. All additional local files below were clean at the
same enclosing checkout revision recorded above.

| Mechanism | Pinned source and symbols | What it establishes / limit |
| --- | --- | --- |
| Bootstrap and snapshots | [database.rs](../../../../crates/database/src/database.rs): `Database::load`; [snapshot_manager.rs](../../../../crates/database/src/snapshot_manager.rs): `SnapshotManager`, `Snapshot` | Load persisted state under ownership; retain bounded immutable versions of metadata and index state. A snapshot is not a complete database copied into RAM. |
| Schema and index readiness | [schema_registry.rs](../../../../crates/database/src/schema_registry.rs); [index_registry.rs](../../../../crates/indexing/src/index_registry.rs): `require_enabled`; `Transaction::get_schema_by_state` | Versioned registries and explicit index states; metadata reads can contribute dependencies. This does not establish Flarex's revocation or admission semantics. |
| Selected in-memory indexes | [backend_in_memory_indexes.rs](../../../../crates/indexing/src/backend_in_memory_indexes.rs): `BackendInMemoryIndexes`, `DatabaseIndexMap`, `DatabaseIndexSnapshot` | Ordered persistent maps/sets with keys, timestamps and packed documents, selected index loading and copy-on-write snapshots. Not a separate Redis service or a claim that every index is resident. |
| Cached index pages | [index_cache/mod.rs](../../../../crates/indexing/src/index_cache/mod.rs): `IndexCache::new`, `WriteLogIndexReader`, `get`, `populate`, `apply_writes`, `index_page_at_ts` | Demand-filled ranges have timestamp eligibility, overlapping-write invalidation and weighted capacity eviction; no fixed TTL is configured here. Population registers a not-ready entry, checks intervening writes and only readies that same valid population. Missing write history or invalidation tracking prevents reuse. |
| Fixed-timestamp persistence reads | [common/src/persistence.rs](../../../../crates/common/src/persistence.rs): `RepeatablePersistence::read_snapshot`, `PersistenceSnapshot::index_scan`, `index_get`; [backend_in_memory_indexes.rs](../../../../crates/indexing/src/backend_in_memory_indexes.rs): `range_batch`, `fetch_cache_misses` | Cache misses retain the operation's timestamp through persistence reads. Local absence of an eligible cached version is a miss, not proof of historical absence. This does not require one SQL transaction across the operation. |
| PostgreSQL historical index reads | [postgres/src/sql.rs](../../../../crates/postgres/src/sql.rs): `INDEX_QUERIES`; [postgres/src/lib.rs](../../../../crates/postgres/src/lib.rs): `_index_scan_inner` | Filter index versions at or before the requested timestamp, choose the latest eligible entry per key including deletion markers, and join its matching document revision. Retention is checked before results are yielded; already saved later versions remain excluded. |
| Dependencies and pending state | [reads.rs](../../../../crates/database/src/reads.rs), [writes.rs](../../../../crates/database/src/writes.rs), [transaction.rs](../../../../crates/database/src/transaction.rs) | Exact point/range/absence dependencies, pending changes, original observations and coalesced writes. These are per-transaction state, distinct from shared caches. |
| Conflict order and visibility | [committer.rs](../../../../crates/database/src/committer.rs): `validate_commit`, `commit_has_conflict`, `persistence_writes: FuturesOrdered`, `write_to_persistence`, `publish_commit`; [write_log.rs](../../../../crates/database/src/write_log.rs) | Validate against committed and accepted pending writes; saves may overlap, but normal publication/acknowledgement remains ordered. An escaping persistence error stops the committer and signals shutdown; bootstrap reloads durable state. Classified transient storage retries are a distinct path. |
| PostgreSQL fencing and durability | [postgres/src/lib.rs](../../../../crates/postgres/src/lib.rs): `Lease::transact`; [Postgres/MySQL setup](../../../../self-hosted/advanced/postgres_or_mysql.md) | Documents and index updates still reach durable storage; lease checks fence acceptance. Lost ownership requires resynchronization. Convex's engine does not eliminate all database checks. |
| Bounded resources and history | [execution_size.rs](../../../../crates/database/src/execution_size.rs); [snapshot_manager.rs](../../../../crates/database/src/snapshot_manager.rs): `push`, `snapshot`; [write_log.rs](../../../../crates/database/src/write_log.rs): `enforce_retention_policy`; [retention.rs](../../../../crates/database/src/retention.rs): `candidate_min_snapshot_ts`, `advance_timestamp`, `RetentionValidator` | Snapshot lookup, change-log coverage and durable history have separate bounds. Durable retention boundaries advance before deletion; document cleanup respects index-cleanup progress. Old unsupported snapshots fail explicitly; active operations do not retain all history indefinitely. |
| Cache and retention settings | [common/src/knobs.rs](../../../../crates/common/src/knobs.rs): `MAX_TRANSACTION_WINDOW`, `INDEX_RETENTION_DELAY`, `DOCUMENT_RETENTION_DELAY`, `INDEX_CACHE_SIZE`, `DATABASE_UDF_USER_TIMEOUT`, `DATABASE_UDF_SYSTEM_TIMEOUT` | Overridable source defaults: 10-second snapshot lookup window, 4-minute index-history delay, 14-day document-history delay, 512-MiB shared index-cache budget. User execution and system/syscall timeout knobs are separate from snapshot lookup. These are not selected Flarex limits or confirmed hosted settings; current data does not expire by age. |
| Whole-query result caching | [application/src/cache/mod.rs](../../../../crates/application/src/cache/mod.rs): `validate_cache_result`, `enforce_size_limit`, `MAX_CACHE_AGE` | Validate recorded dependencies and requested timestamp, evict by LRU size limit, and age-check results that observed system time. Separate from index-page caching; no arbitrary native effect/hook memoization follows. |
| Root execution and retry | [application_function_runner/mod.rs](../../../../crates/application/src/application_function_runner/mod.rs): `retry_mutation`, `run_mutation_inner`; [database.rs](../../../../crates/database/src/database.rs): `wait_for_write_ts` | Eligible conflicts use bounded backoff, wait for the conflicting write to become visible when its timestamp is available, then begin a new transaction and rerun the mutation. This is not resubmitting old writes or repairing an arbitrary cache. Native Payload/Medusa hooks need their own explicit replay eligibility. |

Additional SHA-256 values, with paths relative to the enclosing Convex checkout:

```text
crates/indexing/src/backend_in_memory_indexes.rs 13198e2c09b9a5633fe99c2fc57a2af9ec5c479753c6ae6074b6b3fb9ce36539
crates/indexing/src/index_cache/mod.rs f19bcbcb3d0d1e877a39ff5b0d8856e2c58755e5b9f28adba064eea0b97a7310
crates/indexing/src/index_registry.rs 76571a78b7efbcdae017e69d19b04e094fc5a746114fbb909aa81e3da0a853a4
crates/database/src/write_log.rs 8b4b117dbfc2fa75aeb104f858d7dc3fbd3f0845cc8ee42f3d96ee5d8f5319db
crates/database/src/retention.rs 01c18d159e4ae42b505be52f80abb45b3f57e19a760b97270aaaff547eeee46d
crates/postgres/src/lib.rs 68b90055a516b3dfd2ebb31e4387c38dc8aa53ab2e5e6e739d074aad55020caa
crates/postgres/src/sql.rs 7d10a159b7c95e7aeb9435c7a2041cd0175f6268c0fa49ba1add3a9cb55c280d
crates/common/src/persistence.rs d9c7df8f8116b9704cd0bf4141c6bf5388669e713f6469ec806bee93b083bd95
crates/common/src/knobs.rs 4486ec95a28c2a873e6d4ea18542fde2f03fc6b122cdd03226c99d920dfddf77
crates/application/src/cache/mod.rs 2913531f584653cbd3551dc97b98b6c6f5e199a53dd95f4b7d95caa746d6fe0e
crates/database/src/schema_registry.rs f9434e63d1d6c77531fbcd41cc8f00d991e5392d44ec0c8dd496d09202ce0c11
crates/database/src/execution_size.rs a59c0b3b85816f9d751b8ecbff780faffd88157b3196e03041bf456ae2b0eacb
self-hosted/advanced/postgres_or_mysql.md d1ad7e5a7bab27874efddc5ea88a23e50ca7195e8a6ce6ca256dc6bfa875690b
```

The source map identifies mechanisms to discuss, not a file-for-file port plan.
TypeScript needs deliberate choices for ordered structures, structural sharing,
timestamps, key encoding, async scheduling and memory accounting. Neither language
translation nor identical method names proves equivalent behavior or latency.

## Transferable ideas and explicit divergences

Transfer snapshot/version ownership, exact dependency tracking, owned pending
writes and singular commit/retry responsibility. Do not infer that Convex uses
no storage reads, no validation, no internal RPC or no authorization.

Flarex keeps PostgreSQL as committed-data authority, untrusted execution outside
physical SQL transactions, explicit framework profiles and the accepted private
Worker target. Convex's resident Rust engine is not a drop-in Worker implementation.
The new [ownership discussion](./engine/01-ownership-and-lifetime.md) now examines
shared owners and possible hosts. [DO-local execution with OCC replicas](./engine/01-do-execution-and-replicas.md)
is the current experimental proposal, not an accepted replacement for the
production target. A resident service remains a future comparison option.

Official explanations: [How Convex Works](https://stack.convex.dev/how-convex-works),
[OCC and Atomicity](https://docs.convex.dev/database/advanced/occ), and
[Writing Data](https://docs.convex.dev/database/writing-data). These describe
the model; local pinned source anchors exact implementation observations.

[Auth in Functions](https://docs.convex.dev/auth/functions-auth) describes identity
access and authorization in application functions. Permission records read by a
query participate in its snapshot/dependency contract; identity-aware result
reuse is not a universally valid cached permission boolean. Distinguish ordinary
permission-row updates from credential validation and Flarex engine-grant
revocation. Stronger response-time revocation checks require a named obligation;
they are not inferred from Convex caching or the presence of native frameworks.

For code adaptation, record the exact files, revision, applicable license and
intended use. The inspected [license](../../../../LICENSE.md), also available
[upstream](https://github.com/convex/convex-backend/blob/main/LICENSE.md), contains
FSL permitted-purpose restrictions and a future Apache-2.0 grant for each version
after two years. Do not assume the inspected version already has that future
grant or that translating Rust into TypeScript changes the applicable terms.
This discussion adopts no source port and copies no implementation code.

## Flarex source and prior experiments

The initial document inspection used Flarex HEAD
`bfbe463188996932c3392228a7c5f7ab9a259bf9` in a dirty shared checkout. This is
not a clean runnable baseline. Record executing source hashes for future runs.

| Reference | What it establishes |
| --- | --- |
| [Accepted design](../../design-notes/flarex-db-accepted-design.md), [package boundaries](../../roadmaps/16-package-boundaries.md) | Durable authority, profile separation, framework ownership and allowed breaking internal changes |
| [Working set](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts) | Existing pending/observed reuse and relational execution; a new working set alone is not the missing optimization |
| [Finite capture](../../packages/persistence-postgres/src/execution/finiteStorageCapture.ts) | Existing prepared SQL, fresh authority and result acceptance; checks and data already share some queries |
| [Operation CPU](../../work/validation/shared-execution-evidence/full-cpu-differential/operation-results.md) | Historical 138.425 ms Flarex / 27.775 ms native mean thread CPU; admission, selection/capture and publication are separate substantial families |
| [Read repetition](../../work/validation/shared-execution-evidence/full-cpu-differential/read-results.md) | Small measured duplicate pure preparation; no exact repeated input among 26 index and eight row captures |
| [Command investigation](../../work/validation/shared-execution-evidence/full-cpu-differential/candidate-results.md) | Distributed command/candidate cost; no demonstrated dominant safely removable leaf |
| [Rejected replacement](../../roadmaps/mixed-mutation-core/27-shared-execution-evidence-redesign-preflight.md) | Full document-pipeline replacement failed its performance gate; retained runtime must not be described as that candidate |
| [Native business harness](../../packages/medusa-adapter/benchmarks/core-performance/native-business/README.md), [executor harness](../../packages/executor/benchmarks/core-performance/README.md) | Real comparison workloads and measurement entry points |
| [Medusa SOURCE.json](../../third_party/medusa/SOURCE.json), [active adapter manifest](../../packages/medusa-adapter/package.json) | Pinned fork source versus executing promoted packages; inspect both before asserting equivalence |
| [Payload adapter manifest](../../packages/payload-adapter/package.json) | Inspected Payload peer version 3.88.0; verify executing dependency and Local API, not only the manifest |

The cited performance numbers are saved cohorts, not current measurements or
removable-cost estimates. Unrelated integration changes continue. Do not restart
old failed candidates, weaken their witnesses or treat a smaller SQL string as
proof of a faster engine.

## Concrete redesign evidence

The follow-up assessment targeted Flarex
`abb63e1638d0414a01dbdbf6e853f135bfd0c8f2`. The query/unique/predicate findings
below were also checked against the shared checkout. Pin executing files again
before implementation; later dirty adapter changes are not covered by that commit.
These patterns identify work and complexity, not their share of total latency.

| Source / symbol | Finding and experimental consequence |
| --- | --- |
| [Working set](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/workingSet.ts): `readFiniteIndexRows` | Membership capture followed by acquisition of unseen bodies; evaluate a complete bounded operation while preserving real intervening access callbacks. |
| Same owner: relational `count`, `executeRelationalFind`, `readRelationalSelection`; [Payload adapter](../../packages/payload-adapter/src/adapter.ts): `count` | Count takes the find pipeline; Payload requests `limit: 1` but returns the total. Dedicated scalar execution can avoid document-result construction, sorting and projection where semantics permit. |
| Same owner: `withUniqueValidation`, `rows.values()` | Per-change/per-definition traversal and key lowering can produce quadratic local work for growing distinct insert batches. Maintain current key ownership incrementally; preserve required conflict/integrity behavior. |
| Same owner: `evaluateRelationalPredicate`; [PostgreSQL predicates](../../packages/persistence-postgres/src/storage/documents/logicalDocuments/postgresRelationalPredicate.ts) | Captured original/pending documents are encoded and sent to SQL for matching. Evaluate eligible snapshot data near storage and combine relevant deltas without changing value semantics. |
| [Installed gate](../../packages/persistence-postgres/src/installation/scopeExecutionAuthorityInstallation.ts), [finite publication](../../packages/persistence-postgres/src/commit/point/finitePublication.ts) | Identity/freshness synchronization and the serialized accepting section need a complete writer inventory and server/lock measurements, not an assumed cache replacement. |
| [Medusa module construction](../../packages/medusa-adapter/src/module/definition.ts), [read ordering](../../packages/medusa-adapter/src/query/read.ts) | Evaluate root-scoped binding reuse; preserve per-call state and count/population ordering. Savings remain unmeasured. |
| [Settlement planning](../../packages/persistence-postgres/src/storage/materialization/settlementPlan.ts), [materialization](../../packages/persistence-postgres/src/storage/materialization/domainInstallation.ts) | Existing unchanged-membership skipping does not remove all key preparation/predecessor proof work. Measure remaining work before changing integrity enforcement. |
| [Measurement sources](../../packages/executor/test/performance/measurement/source.ts) | Existing package-oriented source fingerprints do not by themselves cover `experiments/core`; the candidate runner must include executing experimental SQL/code/configuration. |
| [Connected-generation results](../../packages/medusa-adapter/benchmarks/core-performance/native-business/connected-generation-results.md), [cost inventory](../../packages/medusa-adapter/benchmarks/core-performance/native-business/cost-inventory-proposal.md) | Historical paired results, capture inventory and materialization barriers. The attachment's archive reconstruction is not independently rerun by this documentation update; retained summaries are not fresh benchmarks. |

## PostgreSQL and hosted execution references

- [Transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html):
  isolation belongs to a physical transaction. Final-transaction `SERIALIZABLE`
  does not retrospectively validate observations from earlier transactions;
  multi-visit logical commands still need their declared dependency protocol.
- [Explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html):
  row/advisory lock lifetimes and conflicts. Row locking can cause disk writes;
  measure WAL and synchronization cost rather than assume nonlocking-read cost.
  An advisory-lock candidate requires every relevant writer to participate.
- [Hyperdrive connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/)
  and [connection pooling](https://developers.cloudflare.com/hyperdrive/concepts/connection-pooling/):
  pooled transactions and Worker connection lifetimes constrain retained physical
  state. Local session reuse is not proof of hosted behavior.
- [Worker limits](https://developers.cloudflare.com/workers/platform/limits/) and
  [Durable Object lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/):
  runtime limits, eviction and reconstruction constrain shared engine memory.
  A named object's ownership model does not make its in-memory state durable or
  establish an atomic commit spanning that object and PostgreSQL.
- [Durable Object model](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
  and [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/):
  each object has single-threaded JavaScript execution and private transactional
  storage. Distinct IDs do not share a SQLite database. Synchronous local queries
  avoid per-query network calls but occupy the execution path; local storage
  durability is distinct from application commit authority in PostgreSQL.

Recheck these primary sources against the exact database/host used for validation.
They explain constraints; they do not predict the candidate's performance.

TypeScript/DO RAM caching is possible; [instance memory](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/)
can retain hot state while resident. Rust's concrete structures and multithreaded
sharing are not directly supplied by that host. Select equivalent version/order
semantics through appropriate libraries, local structures or SQLite, and account
for eviction/reconstruction. Referencing Convex does not require reproducing each
Rust type or copying source before its reuse disposition is established.

## Standalone Application construction references

The [Application slice](./APPLICATION.md) reads the pinned Convex read/write set
and outer function-runner owners above as architectural evidence. Its SDK
counterparts are the pinned checkout's
[database implementation](../../../../npm-packages/convex/src/server/impl/database_impl.ts)
and [registration](../../../../npm-packages/convex/src/server/impl/registration_impl.ts).
`Transaction.next_creation_time` and `CreationTime::increment` establish the
monotonic creation identity obligation; the accepted Flarex design binds it to a
database-seeded binary64 cursor. No Rust or FSL source is copied into this slice.

Narrow executing reuse is explicit:

| Existing owner | Reused responsibility and boundary |
| --- | --- |
| [Flarex server](../../packages/flarex/src/server.ts), [query](../../packages/flarex/src/query.ts) | Actual registered functions, context contracts and native query construction; the experimental bridge supervises exposed Promises and supplies its own executor |
| [Validation](../../packages/flarex/src/validation.ts), [IDs](../../packages/flarex/src/ids.ts) | Native argument/return validation and public identity encoding; they confer no admission or mutation authority |
| [Catalog](../../packages/flarex-protocol/src/catalog.ts), [Application document](../../packages/flarex-protocol/src/app-document.ts), [document ID](../../packages/flarex-protocol/src/app-document-id.ts) | Authoritative table-ID, creation-time and canonical document-ID schemas |
| [JSON](../../packages/flarex-protocol/src/json.ts), [Scope Sync](../../packages/flarex-protocol/src/scope-sync-v1.ts) | Canonical command JSON and dependency-key decoding/normalization; normalization does not create a subscription |
| [Private JSON data](../../packages/persistence-postgres/src/values/privateJsonData.ts) | Descriptor-safe bounded immutable value capture only, importing Effect and protocol JSON; no active admission, sessions or settlement. Strict JSON refusal is distinct from Medusa's omit-undefined capture policy. |
| [Document validation boundary](../../packages/flarex-protocol/src/application-revision-syscall-validation-v1.ts) | Existing recoverable document-validation error name/message |

These owners construct no active execution host, database, readiness graph,
journal, session or committer for the candidate. Current integration sources
remain requirements evidence under the rule in [AGENTS.md](./AGENTS.md), rather
than internal interfaces to preserve. The separate Application storage/root owns
its snapshot, pending state and accepting OCC protocol. PostgreSQL's scalar scope
clock and historical interval layout are explicit candidate mechanisms, not
claims that Convex uses the same storage or that Cloudflare coordination commits
application data.
