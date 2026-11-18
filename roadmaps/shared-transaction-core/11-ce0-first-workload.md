# CE0 First Workload And Measurement Boundary

Status: private native publication instrumentation and a repeated local baseline
are implemented, with a deterministic same-index contention witness. Complete
request attribution, an equivalent reference and capacity acceptance remain
pending. [Native persistence lifecycle attribution and a bounded row-store
reference](./12-ce0-native-lifecycle-and-reference.md) extend this first slice;
neither constitutes a complete request/reference comparison. This is the first bounded measurement slice from the
[execution redesign](./10-core-execution-redesign.md), not CE0 completion.

## Selected Path

Start with the existing private native point publisher and its actual
[PostgreSQL witnesses](../../packages/persistence-postgres/test/commit/pointCommitTransaction.postgres.test.ts).
It calls the shared materializer and publisher. Do not label this final-commit
kernel as complete user-code execution or charge its native journal to Medusa.
Candidate compilation/admission is a separate control-plane workload and is
not included in these timings. Native journal construction, sealing and index
installation are also outside this publication interval. Current generated commerce-table execution is
regression evidence, not the generic target benchmark.

| Workload | Existing witness and required next measurement |
| --- | --- |
| Material row scaling | `keeps the exact material-row ceiling operable and rejects plus one` exercises 1/8/32/64/127/128 rows, intrinsic indexes, real publication/COMMIT and the over-limit refusal. Retain durable family/sequence assertions. |
| Non-key update | `retains both index tuples on a body update and conflicts through the returned-row dependency` protects unchanged memberships plus changed-body OCC. Measure actual writes, not just callback count. |
| Indexed key movement | `maintains developer-index key moves and rolls both entry changes back` protects old/new entries and rollback. Count materialization statements and encoded parameters. |
| Shared enabled-index contention | The CE0 witness holds one writer after its intrinsic-index lock, identifies the second disjoint writer's actual backend as blocked by the first at the scope clock, and commits a different scope before releasing the barrier. Dense heads and both index entries survive settlement. This proves current serialization, not independent same-scope overlap or the absence of a later index-state bottleneck. |

The initial native stored-attempt check uses the C04A-VAL-001 regression entry
point in the [commit-compiler roadmap](../flarexdb-foundation/03-commit-compiler.md).
That owner now retires the stale blocker with the full ordered PGlite lane and
focused PostgreSQL publication/corruption/rollback evidence. This does not
establish the historical failure's cause or complete native execution acceptance.

## Observation Owners And Limits

The test-only [pool observer](../../packages/persistence-postgres/test/performance/postgresExecutionObservation.ts)
instruments each actual checkout of an exclusively owned, idle pool and restores
its query method at release. It covers publication metadata reads as well as
the transaction, including BEGIN/COMMIT and materializer work absent from the
publisher's query hook. It preserves pg's original overloads, return identity,
callbacks and errors; no production source or global prototype changes.

Counters record driver query calls, UTF-8 SQL-text byte lengths and socket
`bytesWritten` deltas. Transmitted bytes include PostgreSQL protocol framing and
parameters; they are not parameter-only, response, WAL, disk or network-packet
measurements. Query-call counts do not parse multi-statement SQL. Family counters
count queries mentioning selected code-defined tables, not affected rows. No SQL
text, parameters or result values are retained. Unsupported query/transport forms,
overlapping observation or incomplete checkout/release evidence invalidate the
measurement. The caller retains all resource and settlement ownership.

The observer also reports the top-level command for statements mentioning each
family, including unique builds and claims. `WITH` stays distinct from direct
DML; these are statement-mention counters, not a SQL parser or affected-row
counts. The [active CMS workload](./27-ce2-active-request-measurement.md) pairs
them with unchanged build tuples and complete durable-state assertions. Its
whole-request boundary includes preparation transactions and cannot be compared
directly with this primitive publication interval.

`afterTransactionStep` groups counters by the most recently completed proof
step. These are observational intervals, not exact logical-operation attribution:
loops revisit steps and the final interval can include post-COMMIT reads.
Explicit lifecycle markers and phase elapsed totals support the later native
persistence workload; query/byte totals retain the same observation boundary.

Existing `clockLocked` to `beforeCommit` measurements cover client-observed work
inside protection. `clockLocked` to publication return additionally includes
settlement/acknowledgement. Neither is a direct measurement of server lock hold.
Preserve these names and report acquisition, execution, COMMIT acknowledgement
and cleanup separately when their boundaries are observable.

Preparation, data installation and index build are outside steady-state timing;
benchmark lifecycle races separately. Use an ordinary role, disposable schemas,
recorded PostgreSQL/driver/durability configuration and real COMMIT. Stop owned
resources afterward. A single profile run is a diagnostic, not a distribution,
capacity claim or before/after improvement.

## Bounded Baseline And Cleanup Contract

The publication workload uses fresh scopes with one enabled intrinsic index and
1/8/32/128 inserted rows. Each size has one warm-up pair and five measured pairs,
alternating normal/instrumented order at offered concurrency one. Both modes use
the real publisher and check the same durable families, dense commit head and
exact index identities. Scopes start empty but share growing physical tables
within the file fixture; this is not a large preloaded-catalog experiment.
This pair measures observer overhead, not Flarex versus
an independent reference. Five pairs are diagnostic evidence, not tail-latency
or production capacity proof. A provisional 5% median paired overhead tolerance
controls whether instrumented timings can be treated as approximately neutral;
otherwise use normal timings and report the overhead limitation explicitly.

The optional `FLAREX_CE0_REPORT_PATH` writes raw samples, database durability
settings, runtime/driver versions, source revision, tracked-diff hash and harness hashes. Run the
`CE0` cases in `pointCommitTransaction.postgres.test.ts` and
`postgresExecutionObservation.postgres.test.ts` through the package's Vitest
command with `FLAREX_POSTGRES_DATABASE_URL` set to an ordinary-role database.
Keep local reports outside tracked roadmaps. Do not run concurrent builds or
other workloads while collecting the final timing sample.

The old single-sample material-row console profile is removed; its exact-limit,
overflow, durable-state and index assertions remain. No transaction, public API,
schema or migration contract changes in this slice. Existing production owners
are retained because these tests exercise them; their replacement/removal gates
remain CE1/CE2/CE3. No alternative production engine or compatibility wrapper is
introduced. Advanced framework evolution remains outside this work.

## Reference And Acceptance Handoff

First compare the same generic physical layout, affected values, maintained
history/index/unique state, dependency validation, publication and idempotent
outcome. The reference stays test-only. A second relational representation may
be measured separately; it cannot stand in for orchestration overhead.

Before collecting paired results, define workload-specific numerical targets,
sample size/warm-up policy, offered concurrency and acceptable instrumentation
overhead. Establish normal versus instrumented paired overhead first. Do not
invent an improvement target from a single diagnostic profile. Require exact
success/refusal/rollback agreement before comparing throughput, latency, SQL
counts, encoded bytes, WAL, lock waits or memory.

CE1 replaces per-action application at its existing owner; CE2 replaces enabled
index lifecycle coordination only with reader/build/retention proofs. Neither
requires another metadata engine. Exact decimal access paths, indexed Payload
Local API behavior, conditional Product uniqueness and explicit relation policy
remain the connected GLS2/GLS3 gates. Live-query session state stays outside this
database-core work; its certified snapshots and history needs remain constraints.
