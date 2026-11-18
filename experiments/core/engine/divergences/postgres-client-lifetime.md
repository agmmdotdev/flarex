# Invocation-scoped PostgreSQL client lifetime

Design status: **Accepted runtime adaptation within the actual-DO slice**.
Implementation status: **Shared observation and invocation-scoped lifetime implemented**.
Measurement status: **Unmeasured**.
Owner: [actual DO query composition](../slices/03-application-query-do-host.md).

## Pinned mechanism

At Convex `84fbb0e70b4e857913673871cb847ad11a55f3d5`,
[connection.rs](../../../../../../crates/postgres/src/connection.rs) owns the pool
and driver lifecycle. `ConvexPgPool::create_connection` starts the named
`postgres_connection` task polling `conn.poll_message`; an error is reported and
the poller finishes. `get_connection_internal` skips closed clients.
`handle_error` marks closed, unexpected-message and timeout connections poisoned,
and the connection's drop path does not return poisoned connections for reuse.
These are inspected production mechanisms, not an executed upstream fault test.

## Why and how the host differs

The Cloudflare host uses the existing node-postgres driver and request-scoped
clients against injected persistence/Hyperdrive. It does not copy Convex's
process-local pool and Tokio background connection task. Hyperdrive pooling and
the portable engine's transaction owner remain separate responsibilities.

node-postgres can report a disconnected idle connection through an EventEmitter
`error`, outside the query Promise. The existing Flarex pooled path observes
these errors, but its connected-client path did not. Reuse that observation at
the persistence driver owner and connect it to the actual request lifetime.
Install observation before connection, retain it through settled release, latch
the original error and surface it through the owning transaction/resource outcome.
A no-op listener or an adapter catch-and-continue would discard the evidence.

There must remain one connect/end owner and one memoized release operation.
Quarantine and finalization share that operation rather than closing the client
independently. Remove observers only after shutdown has settled; never detach
the handler while a live socket can still report failure. Do not add SQL probes,
new retries, another transaction scope or an unbounded background fiber.

The existing HTTP Promise boundary preserves its primary rejection and reports
secondary cleanup errors. The Effect query scope has the stronger full-Cause
contract: its finalizer calls the same rejecting low-level release directly, so
a body failure and cleanup defect both survive. Keep the old HTTP projection at
that boundary; do not apply its error suppression inside query finalization.
The existing query completion owner remains the sole cache-return gate.

## Consumers, removal and proof

The selected consumer is the actual DO query host's connected PostgreSQL client.
Reuse existing pool observation and connected read-committed settlement semantics;
remove any superseded duplicate observation. The host receives lifecycle
capabilities, not a second event/error algorithm. No application-data format,
schema, grant, lease, publication order or durable outcome changes.

Prove body plus cleanup failure preserves both original reasons and closes once;
disconnect during a real held source/Worker phase becomes an owned failure;
failed checkout cannot publish; and a subsequent request reconnects cold.
Keep existing HTTP primary-error behavior and pooled/connected driver regressions.
Unit EventEmitter witnesses establish listener/latch/disposal behavior; ordinary
PostgreSQL and actual workerd establish the selected real disconnect path.
[`observePostgresClientErrors` and `observePostgresClientLifetime`](../../../../packages/persistence-postgres/src/database/postgresClientLifetime.ts)
own the shared first-error latch and scoped observation. The
[connected and pooled runners](../../../../packages/persistence-postgres/src/database/postgresLocatedReadCommitted.ts)
consume that observation; the
[host client lifetime](../../../../apps/executor/src/requestLifecycle.ts)
owns their shared release. The
historical query-only DO acquisition scope installed observation before connect
and retained the rejecting finalizer outcome through query completion. The
current [app host](../../../../apps/executor/src/applicationDO.ts) owns the pool;
the core PostgreSQL driver owns each checkout's observation and release.
Rejected release retains the observer until an actual terminal driver event;
shutdown is never inferred from rejection alone.

## Shared app pool completion

Slice 06c rechecks this adaptation against Convex
db914cf06e2b06ee985646611b9e12ed7a770318. Its connection poll tasks report errors;
ConvexPgPool::shutdown closes admission, drops idle clients and aborts the idle
worker. It does not join every connection task. Complete Cloudflare socket
shutdown remains this accepted host-resource adaptation, not literal Rust join
parity.

Installed pg-pool 3.14.0 removes a client from its tracked collection before that
client's end callback completes, and resolves pool.end when that collection is
empty. The actual DO witness observed zero completed ends for four connections
after bare pool.end. The physical createApplicationPostgresPool owner therefore
retains each exact native Client.end Promise and drains those operations after
pool.end, preserving rejected outcomes and the callback form. Pool error
observation stays installed through the final drain. One client has one memoized
close, and completed idle clients are released from the retained set.

The core driver explicitly leaves pool lifetime to its caller. This aggregate
barrier belongs to host construction; it adds no SQL probe, transaction,
settlement or recovery path. Individual transport completion remains with the
[socket adaptation](./pg-cloudflare-shutdown.md). Require actual socket counts,
idle failure, cancellation and restart controls before declaring cleanup.

No connection event test alone proves commit uncertainty recovery, fencing or
managed Hyperdrive behavior. Actual local socket and DO scenarios retain only
their declared host and failure guarantees.

## TableIterator timeout classification

The schema/index slice translates the source iterator's narrow retry rule.
Pinned postgres/connection.rs110-136 races the native query future against
POSTGRES_TIMEOUT and emits DatabaseTimeoutError; handle_error208-218 poisons
that connection. Flarex retains its existing settled-query/drain boundary and
server statement_timeout instead of dropping a still-running native Promise.

Classify only an actually settled driver rejection with PostgreSQL57014 AND
message `canceling statement due to statement timeout` as the typed database
timeout equivalent. User-request cancellation, unknown/localized messages and
other unavailable failures stay un-retried. Preserve their raw diagnostic cause
and the existing public unavailable projection. Iterator retry remains bounded
by the source count and obtains a new safe timestamp; it never retries all SQL
errors, interruption, corruption or uncertain writes. Prove timeout versus user
cancellation at the adapter plus ordinary PostgreSQL, and retain native drain
before checkout reuse. This is a necessary consequence of the already accepted
JavaScript/PG lifetime adaptation, not a new generic retry owner.
Exact predecessor batches use one trusted physical read connection, acquired
and drained without BEGIN/COMMIT. The port never spans an untrusted callback or
logical worker lifetime. Native pg queues queries on that connection; preserve
bounded exact-query batches and one checkout rather than adding a database
transaction just to retain a socket. Source Rust pipelining is not claimed
identical to native pg queueing, and latency equivalence needs measurement.