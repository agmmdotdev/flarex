# Validation And Redesign Completion

## Status And Scope

Record 36 has focused preservation proof for the completed extraction. This
plan defines the broader evidence required by the ownership audit and any
subsequent replacements. It does not assert that representative throughput,
contention or production behavior has already been measured.

## Conformance Obligations

Select tests from the changed call graph and admitted profiles. Preserve
original framework assertions and source/title guards. Representative existing
evidence includes:

- [Native PostgreSQL commit tests](../../packages/persistence-postgres/test/pointCommitTransaction.postgres.test.ts):
  OCC, publication, constraints and transaction failure behavior.
- [CMS scenario](../../packages/persistence-postgres/test/cmsHostScenario.ts) and
  [preference publication](../../packages/persistence-postgres/test/payloadPreferencePublicationScenario.ts):
  pending state, native materialization, exact facts and atomic rollback.
- [Commerce publication](../../packages/persistence-postgres/test/commercePublicationScenario.ts):
  initialization, complete relational facts, replay and failure checkpoints.
- [Recovery routing](../../packages/persistence-postgres/test/requestRecovery.test.ts):
  one recovery-only lookup, complete causes and participant cleanup ordering.
- [Physical PostgreSQL transactions](../../packages/persistence-postgres/test/relationalTransaction.postgres.test.ts):
  locks, cancellation, settlement and resource lifetime.
- [Product conformance](../../packages/medusa-adapter/test/product-local.test.ts)
  and the existing original-test lanes: lifecycle, exact events, ambiguous
  acknowledgement, competing requests and no replay delivery.

Extend coverage where a selected replacement changes ownership or semantics;
do not replace decisive framework scenarios with helper-only unit tests.
Keep supported native row/index/relation history and all admitted fact families
consistent. A late failure must leave no partial business state, result or wake.

## Performance Gate

Before claiming the redesign is performance-ready, agree explicit acceptance
criteria for representative native, CMS, small commerce and nested Product
commands. Record the source/resource profile and database/environment settings.
Do not choose thresholds after seeing a preferred result.

Measure setup separately from command execution. Capture SQL and transaction
counts, admitted operation counts, input/result/fact/event bytes, command
duration, scope-lock hold and wait time, pool occupancy, tail latency and
throughput. Exercise independent scopes, hot keys and simultaneous native and
framework load; include the native range validator's bounded commit window.

Use comparable workloads, constraints, outputs and environment settings for
before/after measurements. Preserve existing deadlines and limits unless a
separate measured resource/transaction decision changes them. Distinguish
fixture or machine contention from a reproducible command defect. Successful
reruns and failed attempts belong in the validation report, with their limits;
neither SQL equivalence nor a few faster suite runs proves throughput.

Use PGlite for focused functional checks and ordinary-role real PostgreSQL for
concurrency, locks, isolation, recovery and query-plan claims. Run expensive
fixture setup and regression suites serially when required by the environment;
controlled concurrency tests still exercise the declared concurrent workload.
Deployed Worker/Hyperdrive and production serving need separate evidence.

## Per-Slice Completion

Require affected strict typechecks, focused failure/concurrency tests, unchanged
admitted framework cases, relevant source/package/browser boundaries, and
repository lint/review rules for significant implementation changes. Verify
the exact intended consumer switch and deletion set. Documentation-only status
work needs link/claim and diff checks, not unrelated database reruns.

The current accepted profile can remain complete while a separately owned
capability is deferred. For example, Product scale remains in
[record 35](../flarexdb-framework-integration/preflight/35-medusa-product-scale.md).
Do not expand a consolidation slice merely to clear an unrelated exclusion.

## Overall Redesign Exit

Close the redesign reconciliation only when:

- Every responsibility in the ownership audit has an evidence-backed disposition.
- Required ownership replacements are implemented and all affected consumers
  use their intended owners without competing settlement/publication authority.
- Each retained adapter or bridge has a justified semantic or compatibility
  boundary, and every selected retirement is complete.
- Affected conformance and recovery invariants pass, with the broader measured
  performance criteria satisfied or an explicit accepted limitation recorded.
- Public APIs, named atomic composition, general mixed OCC, workflow/durable
  events and production activation have an explicit independent disposition;
  they are neither silently admitted nor misreported as implemented.

Update durable status in the [domain index](./README.md#next-correctness-gates).
Keep benchmark/test receipts and commit history in task reports and Git.
