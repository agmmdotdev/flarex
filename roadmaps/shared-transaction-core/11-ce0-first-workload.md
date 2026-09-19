# CE0 First Workload And Measurement Boundary

Status: initial path inventory and selected correctness baseline; complete SQL
instrumentation, paired reference and repeatable performance baseline remain
pending. This is the first bounded handoff from the
[execution redesign](./10-core-execution-redesign.md), not CE0 completion.

## Selected Path

Start with the existing private native point publisher and its actual
[PostgreSQL witnesses](../../packages/persistence-postgres/test/pointCommitTransaction.postgres.test.ts).
It calls the shared materializer and publisher. Do not label this final-commit
kernel as complete user-code execution or charge its native journal to Medusa.
Candidate compilation/admission is a separate control-plane workload and is
not included in these timings. Current generated commerce-table execution is
regression evidence, not the generic target benchmark.

| Workload | Existing witness and required next measurement |
| --- | --- |
| Material row scaling | `keeps the exact material-row ceiling operable and rejects plus one` exercises 1/8/32/64/127/128 rows, intrinsic indexes, real publication/COMMIT and the over-limit refusal. Retain durable family/sequence assertions. |
| Non-key update | `retains both index tuples on a body update and conflicts through the returned-row dependency` protects unchanged memberships plus changed-body OCC. Measure actual writes, not just callback count. |
| Indexed key movement | `maintains developer-index key moves and rolls both entry changes back` protects old/new entries and rollback. Count materialization statements and encoded parameters. |
| Shared enabled-index contention | Add distinct-connection barriers for disjoint records sharing one enabled index in one scope, alongside same-record conflict and different-scope controls. Existing same-scope serialization is a safety baseline, not independent overlap. |

The initial native stored-attempt check is the exact C04A-VAL-001 reproduction
listed in the [commit-compiler roadmap](../flarexdb-foundation/03-commit-compiler.md).
A successful selected rerun does not establish the historical failure's cause,
close its other cases, or establish the full stored-attempt lane.

## Observation Owners And Limits

Reuse `afterTransactionStep` at the point publisher for phase boundaries and its
bounded query observer where available. The materializer calls additional SQL
owners; that observer is not a complete statement counter. A later harness must
count all statements through the actual checked-out driver connection, including
BEGIN/COMMIT and SQL outside the observer. Do not instrument global prototypes,
log parameter values, or introduce production dispatch to a reference engine.

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
