# CE0 Native Persistence Lifecycle And Row-Store Reference

Status: implemented bounded lifecycle attribution and a first-row storage
reference. Complete native executor/host attribution and an equivalent full
publication reference remain open. This extends the
[first workload](./11-ce0-first-workload.md); it does not complete CE0 or activate
an execution replacement.

## Executing Boundaries

The existing PostgreSQL point-commit fixture now exposes optional test-only
phase markers around its real owners: session activation, journal opening,
table resolution, point operations, seal preparation/canonicalization/storage,
running evidence capture, entering finishing, finishing evidence capture,
command projection and publication. A separate replay observation checks the
same outcome without new writes. It reuses the existing path rather than
reconstructing these operations in another benchmark.

These are native **persistence lifecycle** costs. The fixture supplies trusted
activation evidence and a seeded syscall-validator proof. Hosted admission,
cryptographic request verification, canonical program execution, user-code CPU,
Worker transport, liveness renewals and retry/redelivery scheduling are not
measured. No application throughput or framework overhead claim follows.
Independent framework transactions must not be charged for this native journal.

The observer records elapsed time as well as query/byte counts per explicit
phase. Phase times partition the instrumented interval; repeated phase names
accumulate. Phase boundaries are client observations, not server lock-hold
measurements. Request capture does not alter connection, lease, journal,
transaction or publication ownership. Schema/index installation stays outside
timing. One warm-up and three measured trials at each of 1/8/32/128 rows provide
cost attribution, not capacity or tail-latency evidence. Use normal publication
samples from the first workload for its uninstrumented timing; do not subtract
independently measured percentiles to derive request phases.

## Explicit SQL Reference Profile

The [reference](../../packages/persistence-postgres/test/ce0RowInsertReference.ts)
compares the existing prepared row-append owner with scalar SQL against the same
`fx_app_row_rev`, `fx_app_row_current` and scope-clock tables. Both use the existing
located READ COMMITTED runner for acquisition, settlement and release. Canonical
document construction occurs before either timed interval. The reference reuses
protocol identity projection, byte encoding and the selected error definitions;
it does not call the core row-insertion implementation.

| Dimension | Admitted comparison |
| --- | --- |
| Input | Factory-produced canonical documents, valid typed scalar identities, positive commit sequence, first live revision with no predecessor. Malformed/forged inputs, updates and tombstones are outside this reference. |
| Storage | Same canonical bytes/hash, creation time, epoch provenance, first-identity uniqueness, revision history and current pointer. Fresh scopes share generic physical tables. |
| Failure | Missing scope and duplicate first identity reject; late callback failure rolls back the entire batch; two actual connections competing for one identity produce one winner and one duplicate refusal. |
| Settlement | Same physical runner and real COMMIT; failures preserve its confirmed-rollback envelope. Neither candidate catches row errors and commits partial work. |
| Exclusions | Earlier-read OCC, indexes, uniqueness beyond row identity, relations, semantic write authority, publication/outcomes, uncertain-COMMIT recovery and hosted execution. No whole-request equivalence or overhead ratio is established. |

The common assertions compare every persisted revision field and current
pointer plus returned canonical documents. These admitted failure witnesses run
before the timing case. The concurrent witness holds the first insertion before
COMMIT, verifies that its actual backend PID blocks the second insertion, then
releases and drains both transactions even when the witness fails.
The reference fails closed if a pointer invariant outside
the admitted first-revision profile is encountered; that is a comparison gap,
not a substitute implementation of the core's corruption/recovery behavior.

One warm-up pair and five measured pairs alternate core/reference ordering for
1/8/32/128 rows. Both are instrumented; the existing observer calibration does
not prove identical overhead for their different query forms. Samples are local
diagnostics. Neither mode batches writes, and a difference includes SQL shape,
driver binding, repeated validation, ORM construction and scheduling; do not
attribute the entire difference to one library or advertise a production gain.

## Validation, Reports And Cleanup

Run the `CE0` PostgreSQL cases in `pointCommitTransaction.postgres.test.ts`,
`ce0RowInsertReference.postgres.test.ts` and
`postgresExecutionObservation.postgres.test.ts`. Set an ordinary-role
`FLAREX_POSTGRES_DATABASE_URL`. Optional `FLAREX_CE0_LIFECYCLE_REPORT_PATH` and
`FLAREX_CE0_ROW_REFERENCE_REPORT_PATH` write local JSON samples. The shared
test-environment helper records durability/runtime/driver configuration, source
revision, tracked-diff hash and source hashes. It replaces the inline duplicate
metadata capture; no production export or fallback is added.

Core row-store PGlite witnesses remain the fast semantic lane. The explicit SQL
reference is Node/PostgreSQL-only and must not be reported as PGlite or deployed
Cloudflare validation. Timing runs must be isolated from concurrent builds and
other benchmark workloads. Keep raw receipts outside living roadmaps.

## Next Core Decision

The lifecycle separates native syscall/journal cost from final materialization.
Use both when selecting work: reducing final row writes alone cannot remove
native per-syscall persistence. CE1 can target bounded materialization while CE4
evaluates evidence costs, preserving exact replay, cumulative limits and recovery.
This does not authorize journal coalescing merely because it is expensive.

Before calling a reference equivalent to publication, add the omitted admitted
authority/dependency, index/constraint, publication/replay and failure contracts
to both its implementation and differential witnesses. Broader framework and
hosted workloads retain their existing gates. The scalar reference remains
test-only; each actual replacement must migrate consumers and remove the code
it displaces in the same slice.
