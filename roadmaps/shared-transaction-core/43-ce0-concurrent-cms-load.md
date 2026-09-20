# Concurrent CMS Core Request Baseline

Status: implemented bounded load baseline. Colocated admission no longer requires
nested pool acquisitions, but zero-refusal behavior is not established across
overload runs and sustained capacity remains unproved.

## Decision And Boundary

Measure complete active CMS core insert requests through the existing host,
admission, materializer, publication and physical settlement. Existing barriers
prove that disjoint same-scope callbacks overlap, final publication waits on the
scope clock and another scope can settle. They do not quantify complete requests under offered concurrent work.
The recent row-store improvement does not answer that question either.

Use the existing active fixture and generic physical families. Compare a hot
scope with four scopes in one database/pool, at one, four and twelve concurrent
request slots. Each finite burst offers 24 requests of eight rows; three measured
bursts share the fixture's control and application-data pool. Separate production
control/target placement and transport are not measured. The three measured
bursts follow one warm-up request per scope. Rotate configuration order between
runs when repeating the diagnostic. Record starting row counts for every burst;
setup, key generation, assertions, readback and replay are outside timing.

All requests enter the bounded test queue at burst start. Report queue delay,
host execution time and total response time separately, with raw samples,
offered/completed/failure counts and burst throughput. Sample pool waiters and
occupancy through a scoped observer; its interval is a sampling resolution,
not an exact wait-time or peak guarantee. Aggregate existing SQL/transport
observation over the burst, not per interleaved request. Label all PostgreSQL
load samples instrumented; do not infer neutral latency from serial calibration.

This is finite local Node/PostgreSQL load, not sustained capacity, a production
SLO, Payload Local API, native mixed traffic, hosted execution or the independent
complete-request reference. It informs the coordinated CE3 decision; it does
not justify moving sequence-consuming DML before canonical sequence allocation.

## Correctness, Ownership And Cleanup

Extend the existing fixture's insert assertion to a set of completed requests;
single-request checks delegate to it. Verify exact returned documents/readback,
row/index/unique/fact counts, dense commit/outcome/wake sequences, request-key
correlation and unchanged build/session state per scope. Duplicate replay must
not execute commands or alter any inventory. Same natural keys in different
scopes remain isolated. Failures are collected through Effect Exit so one refusal
does not hide other admitted settlements. Unexpected failure, defect or
interruption fails the baseline. Precisely classified admission deadlines require
zero callback executions; publication deadlines require exactly one. Both require
no durable effects. Untimed explicit retries of this transactional-insert fixture
then prove one new execution, successful publication and replay without another
execution. They do not count toward burst throughput or authorize arbitrary
framework-hook retries.

Use scoped Effect concurrency and drain all owned work. No production API,
schema, lock protocol, retry wrapper, policy, durable format or reset changes.
No alternate engine or production telemetry. Reuse the existing physical and
fixture cleanup owners; stop owned PostgreSQL after validation.

The shared relation fixture must give every fixture its own UUID namespace.
Replace its modulo-ten prefix with the captured full fixture ordinal; load
setup exposes collisions when more than ten scopes share the physical schema.
This changes only disposable fixture identities, not production ID generation.

## Completion Gates

The numerical performance target remains every offered request succeeding with
zero refusals. The [colocated catalog correction](./44-ce3-colocated-admission-catalog.md)
removes nested acquisitions during prepared admission. Concurrent command
execution still encounters deadlines at final publication. Record
`zeroRefusalTargetMet` and failure counts in the report; do not raise limits or
turn a passing burst into a capacity claim. This is an open CE3 limitation, not a settlement failure
merely because requests were refused. Correctness requires every offered request
to settle, successful requests to publish exactly once, and refused requests to
leave no durable effects with exact boundary-specific callback counts. No replay execution, state leakage
or remaining borrowed clients is permitted. Require a typed scope-clock failure
with `invalidAuthority`/`lockForSnapshotRead` at admission or
`statementFailure`/`lockForOrdinaryWrite` at publication, and SQLSTATE `55P03` or
`57014` on every failure reason. Only accompanying typed deadline cleanup failures
are permitted; a SQLSTATE without that primary owner never establishes the boundary.
Defects, interruption, uncertain decisions, unrelated operations or SQL states
remain test failures. The statement-deadline case is demonstrated by PostgreSQL
errors on the clock acquisition; a lock deadline is not its only possible result.
Continue distinguishing preparation, concurrent callbacks and serialized publication.
Pool pressure and timeout observations alone do not establish every cause of
throughput loss; retain the witness before selecting further core corrections.
Concurrency never exceeds the selected slots. Timing is diagnostic without a
predeclared production speedup: preserve all samples and report dispersion and
the limits of three short bursts. Do not extrapolate p99 or thousands of shops.

Run the shared workload checks in the serial PGlite lane and distinct-connection
ordinary-role PostgreSQL configurations, plus existing CMS correctness and
deterministic concurrency witnesses. Validate affected types, lint and both
project reviews. Reconcile the owning roadmap and commit one complete slice.
