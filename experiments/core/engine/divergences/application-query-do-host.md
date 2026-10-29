# Read-only Application query host in a Durable Object

Design status: **Accepted bounded host adaptation within the authorized goal**.
Implementation status: **Unstarted**. Measurement status: **Unmeasured**.
Owner: [third slice](../slices/03-application-query-do-host.md).
This refines the accepted [runtime adaptation](./app-owner-runtime.md); it does
not select durable coordinator fencing or general app routing.

## Pinned mechanism

At Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`,
[Database::load](../../../../../../crates/database/src/database.rs) holds the
persistence lease before obtaining a repeatable bootstrap timestamp, loading
metadata and constructing snapshots, write log, retention and committer.
[SnapshotManager](../../../../../../crates/database/src/snapshot_manager.rs)
admits proven published timestamps and rejects future/expired views.
[begin_with_repeatable_ts](../../../../../../crates/database/src/database.rs)
creates independent transaction state. The
[committer](../../../../../../crates/database/src/committer.rs) checks published
and pending writes, then publishes in order before normal acknowledgement.
[PostgreSQL Lease::transact](../../../../../../crates/postgres/src/lib.rs) and
[lease_precond](../../../../../../crates/postgres/src/sql.rs) enforce ownership
atomically with durable writes. Lease loss requires reacquisition and resync.

These inspected owners and production guards are source evidence. The independent
audit found no executable lease/snapshot/committer race tests in the inspected
database/PostgreSQL crate tree; it does not label test-facing hooks as passing
upstream tests.

## Why and how this bounded host differs

The selected initial host is Cloudflare, while the current supported query
composition still runs its core callbacks in Node-based consumer tests. Prove
the real core inside a DO before moving durable ownership or weakening PostgreSQL
gates. Copying full `Database::load` without its lease/recovery owners would
falsely promote physical object identity into durable authority.

The new private executor composition injects the existing query owners. It
retains only stable runtime/configuration/source/execution bindings and the
pure handoff between invocations. A persistence-owned connected-client factory
constructs authentic request ports using established issuers and transactions.
No raw database capability reaches untrusted code or becomes host-owned SQL.

Trusted authored references exist locally inside the DO. Ordinary trusted
dispatch calls public `runQuery`, preserving its local result contract and
completion owner. An arbitrary wire path/validator cannot recreate a private
reference, active selection or authority. The factory binds the exact declared
deployment/scope/physical locator; generic production app routing remains open.

Acquire database resources from the factory-backed query service inside the
invocation-owned scope. Reuse Standard construction rather than copying invoke
logic. Snapshot release stages eligible data, client cleanup then settles, and
the existing completion owner publishes only after success. An adapter-side
completion buffer or clearing cache after premature publication is not selected.

Keep all current live admission/read/history/index gates and serialized
PostgreSQL publication. This host has no commit, lease, retention or safe-frontier
authority. RAM is an optional cache; boot starts cold from PostgreSQL. No SQLite
data/cache persistence or lower-roundtrip guarantee is inferred.

## Consumers, removal and proof

The affected consumer is the bounded trusted Application query dispatch through
the actual executor adapter. Existing Medusa/Payload profiles and mutation
settlement owners remain unchanged. Production entrypoints stay unrouted and
unbound. No durable format, table, data reset or compatibility obligation changes.

Replace duplicated Standard API construction with one owner shared by static
and request-factory composition. Reuse existing PostgreSQL transaction and
request resource owners; remove only construction superseded in this scope.
Do not relabel the old SQLite-authoritative `PartitionDO` or retain a parallel
query algorithm in the test host.

The owning slice requires actual DO/Worker/PostgreSQL execution, failed cleanup,
concurrent cache ownership, authority refusal, isolation and cold restart proofs.
PGlite and Node evidence retain their stated scopes; local workerd is not hosted
Hyperdrive or managed-eviction evidence. Exact executing symbols, final status
and Git validation evidence are filled after implementation. Full coordinator
fencing/recovery, native hosting, production activation and performance remain
separate goal gates. Replication stays deferred.
