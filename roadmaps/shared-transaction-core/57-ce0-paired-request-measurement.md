# Paired Scalar Request Measurement

Status: bounded paired scalar request measurement implemented; broader CE0
acceptance and coordinated runtime changes remain open.

## Selected Equivalence Gate

Admit diagnostic paired timing for the scalar generated first-insert command
(zero/one/eight/thirty-two rows), its exact replay, and standalone point reads
(zero/one/eight/thirty-two rows). This is a bounded complete-request comparison;
full CE0 and native/framework/capacity acceptance remain open.

| Required evidence | Current witness |
| --- | --- |
| Exact rows, two indexes, unique claims, publication and cross replay | `ce0FirstInsertReferenceScenario.ts` and zero-row reference scenario |
| Pending/committed duplicates, first failure and request identity | `ce0CmsPendingUniqueScenario.ts` |
| Cumulative bounds and cached-read accounting | `ce0CmsRequestBudgetScenario.ts` |
| Current authority before execution/replay | `ce0CmsAuthorityBoundaryScenario.ts` |
| Snapshot overlap, scoped absence, interruption and read uncertainty | `ce0CmsReadReference.postgres.test.ts` and shared scenario |
| Atomic failure, true contention, scope separation and uncertain mutation COMMIT | `ce0CmsMutationSettlement.postgres.test.ts` and first-insert regressions |

These witnesses authorize only their admitted operation/configuration. Invalid
inputs outside the reference profile, updates/swaps/relations, native OCC,
arbitrary lifecycle races and framework lifecycle behavior are not compared.
Their outstanding gates are not silently treated as passing.

## Boundary And Matched Work

Use the current real CMS host and independent read/mutation references over the
same physical families, schema, index/claim semantics, driver, pool and durable
PostgreSQL configuration. One offered request at a time. Two isolated scopes
carry matching logical contents and progress equally before each candidate pair.
Alternate candidate order per pair and observation order per two-pair block.
Assert both candidate orders within each mode and all four joint starting
combinations against the actual recorded samples. Generated IDs, scope identities
and live creation times differ; compare actual outputs to each scope's expected
data and compare matching logical titles/cardinality. Preserve live clocks and
randomness rather than freeze request deadlines for bit-identical fixtures.

Construction, seed setup, key generation, readback/assertions and report writing
stay outside timing for both. Admission, validation, codecs, bounded readers,
lifetime and physical settlement/recovery remain common timed owners. Independent
request orchestration, first-insert working state/materialization and publication
are the candidate-specific owners. No independent admission-cost claim follows.

Reuse the existing pool observer and environment recorder. Report normal and
instrumented raw samples separately, including replay. Whole-request wall time
includes observer setup/cleanup when instrumented. SQL/socket observations are
diagnostics; they are not server CPU, lock-hold, buffer, WAL or received-byte
measurements. Process CPU/RSS include runtime noise and do not prove allocation
or server resource use. Source hashes include the reference and new harness.

## Predeclared Numerical Targets

- Two warm-up pairs followed by five measured pairs for each candidate/mode.
- Normal core/reference median paired latency ratio at most 1.25, with at least
  four of five normal paired ratios at most 1.50. This is a local diagnostic
  optimization target, not a production latency SLA.
- Per-candidate median instrumented/normal paired latency ratio within 5% of
  one, using the existing observer tolerance. A miss prevents treating observed
  latency as neutral; normal samples and exact SQL counts remain separately
  reportable. Never change the threshold after seeing results.
- No request errors, silent retries or assertion failures in sampled work.
  Report raw samples and min/median/max, not a reliable p95 from five samples.

Run measurement alone with one test worker after correctness verification. A
target miss is recorded evidence for selecting the next owner correction; do
not make a benchmark pass by relaxing semantics, deleting costs or raising limits.

## Current Interpretation

Acceptance requires measurement with independently balanced candidate/mode order.
An order-confounded report cannot support relative-latency or observer claims.
The balanced diagnostic profile meets its normal relative-latency targets.
Observer calibration misses the declared tolerance for reference replay after
eight/thirty-two-row mutations; instrumented latency is not accepted as neutral
for those cases. Preserve the normal samples and exact SQL counts separately.
Reads and replay retain the same observed query counts across candidates;
nonempty core insertion retains additional fixed per-request SQL and transported
bytes. Common admission/readiness work remains substantial even at zero rows.
Attribute those statements to their actual owners before selecting another
runtime change. Similar total latency does not establish that shared work is
minimal, or that same-scope serialization is acceptable under load.

Five pairs give a local diagnostic distribution, not a stable tail estimate.
Normal/instrumented calls also run at nearby rather than identical growth points;
calibration includes that small-catalog progression and ordinary system noise.
Preserve raw reports and environment/source provenance; refresh them after
implementation or configuration changes. Capacity, server resource attribution,
protected readiness roots and coordinated CE3 concurrency remain separate gates.

## Cleanup And Completion

No production contract, schema or durable-data migration changes. Retain the
existing real-host observer baseline as calibration history, with the new paired
comparison owning its own report. Add no runtime selector or production import.
Run affected types/lint and both read-only reviews; reconcile bounded acceptance
and limitations, stop owned resources, and commit. Numerical receipts belong in
the report/commit, while roadmaps retain durable conclusions and remaining gates.
