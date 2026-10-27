# Observation cost attribution and replacement

Status: implemented and measured; retain bounded compiled plans, with performance
promotion closed. All 338 distinct correctness cases pass. Quiet latency improves,
but every request still misses the 5 ms added-median allowance. Active Medusa and
production core files are untouched. This follows the earlier
[combined guard](./READ-OBSERVATIONS.md), which reduced exchanges without proving
a latency win in that cohort.

## Replacement and preserved ownership

`read-guards.ts` owns combined guard construction and bounded client-bound Drizzle
prepared plans. `persistence.ts` retains opaque issuance, fresh verdicts, error
order and deadline/fence/selection validation. `session.ts` retains one Drizzle
facade per exclusively checked-out PoolClient. Each guard kind keeps at most 32
selected table/version plans per facade; FIFO eviction recompiles. Scope, command
and expiry are execution parameters. Empty statement names preserve PostgreSQL's
unnamed protocol; there is no server prepared-statement or Hyperdrive affinity
claim. PGlite retains transaction-local facades and identical fresh checks.

Every execution still issues the locking CTE and subsequent fresh data statement.
No authority/definition/clock/command result, snapshot eligibility, dependency or
returned row is cached. Failed clients still retire. No physical transaction
spans native/authored callbacks. Accepting scope-clock locks, post-clock checks,
materialization, publication and recovery remain unchanged. Drizzle schemas and
query builders remain the database interface.

Actual plan reuse, new parameter values, bounded eviction, client replacement,
revocation, selected-definition retirement, command/snapshot deadlines after real
lock waits, fresh update/delete visibility and all connected consumers pass.
Mechanical transports establish compilation behavior; real PGlite and ordinary-role
PostgreSQL witnesses establish database behavior.

## Matched campaigns

Final connected reports use `FLAREX_EXPERIMENT_MEASURE_LABEL=observation-control`
and `observation-after`. Controls replay exact pre-cache `persistence.ts` and
`session.ts` bytes from `d3c8997dab2aacefe79bac9a7adb9d7364686b4c` with the same
final harness. Saved compiled-runtime bytes are restored and hash-checked after
control runs. This is temporary experimental replay, not a runtime switch or
compatibility path. Scaling labels are `observation-control-scaling` and
`observation-after-scaling`; the default remains `scaling`.

Connected inventories contain 85,968 paths and scaling inventories 85,881. Every
control/compiled comparison differs only in those two runtime files, with no
removed path. `read-guards.ts` is present in both conservative inventories and
imported only by the compiled runtime. Node, installed/native compiled dependencies,
framework and active-core bytes remain unchanged across the matched comparisons.
Every campaign passes its own source checks. The coordinating checkout chat held
source changes/heavy work and stopped its PostgreSQL server. This reservation
covers that chat, not globally observable host exclusivity.

Complete Payload CRUD/preferences, native Product scalar update/retrieve/list,
and Application/Product/Payload mixed requests retain native operations, complete
result assertions and independent committed readbacks. Quiet latency and CPU use
five warmups and thirty alternating native/candidate pairs per workload. SQL uses
two diagnostic pairs after five warmups; profile uses five diagnostic pairs after
five warmups. All eight campaigns pass source, output, durability, ordinary-role,
observation and cleanup checks. PostgreSQL retains fsync, synchronous commit and
full-page writes. No active Flarex speedup or equivalent native atomic mixed
execution is claimed.

## Complete-request results

Milliseconds. Added percentiles come from paired differences. Implementation
cohorts are sequential, not interleaved implementations or exclusive-cause proof.

| Request | Control native median / P95 | Control candidate median / P95 | Compiled native median / P95 | Compiled candidate median / P95 | Added control → compiled median / P95 |
| --- | --- | --- | --- | --- | --- |
| Payload CRUD | 4.410 / 5.070 | 36.498 / 40.491 | 4.407 / 4.933 | 30.255 / 36.016 | **31.810 / 35.465 → 25.668 / 31.828** |
| Product | 10.008 / 11.586 | 19.329 / 22.067 | 9.706 / 11.924 | 15.796 / 18.836 | **9.608 / 11.986 → 5.859 / 9.033** |
| Mixed | 23.311 / 25.909 | 35.594 / 40.646 | 21.358 / 24.165 | 28.477 / 32.144 | **12.258 / 16.701 → 6.714 / 10.707** |

Product meets the 10 ms added-P95 allowance. All three miss the 5 ms added-median
allowance; Payload and mixed also miss P95. The mixed reference uses the same
standalone candidate Application owner plus independently committed native
frameworks, so its Application portion also benefits from this replacement.

Full SQL diagnostics classify every dispatch with zero unknown/lost/dropped
observations. Both pairs agree: exchanges remain **88 / 37 / 59** and transactions
and checkouts **12 / 5 / 10** for CRUD/Product/mixed, matching control-profile
counts. Native Payload retains 15 exchanges; Product submits 10 Knex queries
(a different metric). This replacement removes compilation work, not checks or
exchanges.

Separate CPU measurement reports added root-thread median/P95 of **15 / 32 ms**
for CRUD, **0 / 16 ms** for Product and **1 / 17 ms** for mixed. Windows counters
resolve roughly 15–16 ms. Zero/sub-resolution medians do not mean zero cost or
establish exclusive CPU savings. The 154.246 ms candidate CRUD outlier and all
negative paired differences remain in the CPU report.

## Attribution and limits

Profile mode reuses the bounded Node CPU collector and analysis in
`packages/executor/test/performance/measurement/`, with allocation sampling off.
These Node/Effect diagnostic imports bring no active admission, readiness,
database or settlement owner. The collector owns inspector startup/stop/disconnect,
complete frame identity, bounds, GC/counters and conservative request-window
alignment. Its requested sampling interval stays 1000 microseconds; raw reports
retain actual sampling deltas. There is no second raw-profile codec or lifecycle.

The profile adds the existing resource-only checkout/query/transaction observer
and duration logging in its own disposable PostgreSQL cluster. It omits SQL
structure, source-stack fingerprints and result sizing; full SQL mode retains
those obligations. CPU capture and independent server evidence survive one
another's diagnostic failures, with original causes and descriptor-safe encoding.

Control profiles show Drizzle entity inspection, select/query construction and
SQL lowering alongside database/control waits. Sampled Drizzle self elapsed-weight
medians are 6.186 / 2.027 / 3.148 ms before and 5.033 / 0 / 1.570 ms after, across
five candidate profiles per workload. Samples are sparse; zero means no such self
sample, not zero work. Mechanical and real database witnesses establish actual
compilation reuse more directly than these weights.

Control-profile median driver-awaited union is 29.912 / 12.886 / 22.842 ms;
BEGIN/COMMIT sums are 5.198 / 2.520 / 4.360 ms; checkout union is
0.322 / 0.129 / 0.260 ms. Logged server protocol-duration sums are
14.110 / 6.163 / 12.138 ms. These intervals overlap, include waits and cannot be
added or subtracted to infer exclusive costs. Parse/Bind/Execute duration entries
remain separate unlabeled records with backend IDs. Server timing is not CPU or
separately attributed planning. Exact validation/encoding, planning/CPU,
allocations and scope-lock hold/wait remain unresolved.

Profiling perturbs execution: compiled CRUD observed P95 is 110.437 ms, with
92.589 ms driver union and 69.386 ms control waits in the slowest capture. Retain
these as diagnostic evidence, not quiet acceptance samples or proof of a delay's
cause. Inclusive stack totals overlap; self weights are sampled elapsed spacing.

## Batch and contention results

Both scaling campaigns retain sizes 1/16/64, five warmups and five quiet batch
samples per cell, plus separate SQL observations. The complete 64-row cells:

| Operation | Control median / P95 ms | Compiled median / P95 ms | Exchanges, unchanged |
| --- | --- | --- | --- |
| Insert | 118.093 / 123.902 | 89.939 / 95.707 | 279 |
| Pending overlay | 174.995 / 321.208 | 128.770 / 131.655 | 428 |
| Indexed edit | 119.834 / 267.931 | 93.702 / 96.102 | 282 |
| Nonindexed edit | 121.023 / 267.732 | 91.315 / 103.580 | 282 |

Every batch exchange count is unchanged. Insert-64 still has 64 historical point
reads and 67 short transactions; physical materialization is already batched.
The earlier 409-exchange cohort predates combined guards: its reduction to 279
does not belong to this compiled-plan slice. At size 16, nonindexed edit P95
worsens from 35.605 to 183.322 ms; that outlier is retained too.

Each contention cell runs 128 independent one-row commands through a four-client
pool without automatic retries. All 768 commands in each campaign succeed on
their first attempt and pass committed readbacks.

| Concurrency / scopes | Throughput control → compiled, requests/s | P95 control → compiled, ms |
| --- | --- | --- |
| 1 / same | 126.693 → 124.292 | 8.991 → 8.422 |
| 1 / different | 108.268 → 148.253 | 9.533 → 7.711 |
| 4 / same | 177.073 → 170.041 | 26.211 → 61.966 |
| 4 / different | 168.555 → 196.838 | 26.401 → 22.602 |
| 8 / same | 192.217 → 244.553 | 47.514 → 37.719 |
| 8 / different | 213.691 → 205.753 | 42.058 → 198.194 |

Both concurrency-four cells pass the predeclared local diagnostic target of
100 successful requests/s, P95 below 100 ms and no failures. Gains are mixed:
same-scope concurrency-four throughput falls slightly and its tail worsens;
different-scope concurrency-eight P95 also worsens. No general throughput,
scope-lock or capacity improvement follows. Unrelated-definition cells retain
27 exchanges with 0 versus 64 extra definitions/256 unrelated rows; flat exchanges
do not establish constant physical work.

## Correctness, harness and earlier evidence

The [validation receipt](./validation/observation-validation.json) covers 149
PGlite cases, three additional PGlite corpus cases, 163 ordinary-role PostgreSQL
cases, 20 unit/boundary cases and three native controller-process cases. Fourteen
distinct driver-specific skips are expected. Repeated guard smokes are deduplicated.

The private bootstrap replaces inherited controller pipes with file-backed
output. PostgreSQL was ready and `pg_ctl` had exited while Node still waited for
its 60-second pipe timer. The process timeout stays unchanged. Startup now
requires an owned stop before directory deletion even when controller or output
disposal fails; failed stop retains the directory and reports its path. A real
daemon/disposal-failure witness checks shutdown before removal, with containment
and fallback cleanup. All fresh fixtures are removed. This setup improvement is
outside request timers and is not a core latency result.

The initial `observation-before-profile.json` pilot used a subsequently removed
100-microsecond raw-inspector helper. Its summaries merged some same-line frames
and include inspector startup; they are not final attribution. Raw profiles and
the earlier quiet baseline remain intact. One unimported persistence-test file
was added during that pilot, absent from its retained path inventory and present
at all three earlier quiet-baseline boundaries. No executing runtime changed;
the inventory addition is explicitly disclosed. Corrected matched control/after
campaigns above own the final conclusions.

The first seven-file correctness attempt exceeded its coordinated slot and was
cancelled without a completed reporter result; it earns no validation credit.
Its [receipt](./validation/observation-correctness-cancelled.json) records stopped
processes and the stopped partial fixture whose deletion was rejected by automatic
approval review with “blocked by policy.” It was left untouched. Later completed
smaller cohorts own all passing counts.

## Disposition and next gate

Retain bounded compiled plans: the module replacement preserves owner/consumer
behavior and matched quiet latency improves. Keep performance promotion closed:
complete-request allowances remain missed, contention gains are mixed and per-row
observations/transactions remain. No production routing or durable-data cutover
follows from these bounded Node/PostgreSQL results.

Next investigate complete bounded observation operations at the persistence/session
owner using the attribution and retained traces. Name required fresh checks,
invalidating writers, exact snapshot/absence/conflict evidence, lock order and
failure-order witnesses. Preserve fresh visibility after lock waits and no
transaction across callbacks. Accepting changes need their own concurrency proof.
Concentrate replacement in the owner and necessary explicit handoffs, then rerun
the same owner, consumers and complete measurements.

The [representative-flow gate](./VALIDATION.md#representative-flow-and-replacement-gate)
still requires real Product relations and native Payload lifecycle work before
substantial integration expansion. All-five-graph, general Application/reactivity,
replacement and private Worker/Hyperdrive gates remain open. Active Medusa work
stays outside the experiment.

Full evidence: [comparison](./validation/observation-comparison.json),
[validation](./validation/observation-validation.json),
[control latency](./validation/observation-control-latency.json),
[compiled latency](./validation/observation-after-latency.json),
[control profile](./validation/observation-control-profile.json),
[compiled profile](./validation/observation-after-profile.json),
[compiled CPU](./validation/observation-after-cpu.json),
[compiled SQL](./validation/observation-after-sql.json),
[control scaling](./validation/observation-control-scaling.json) and
[compiled scaling](./validation/observation-after-scaling.json).

Primary references: [PostgreSQL duration logging](https://www.postgresql.org/docs/18/runtime-config-logging.html),
[controller lifecycle](https://www.postgresql.org/docs/18/app-pg-ctl.html) and
[Node inspector](https://nodejs.org/docs/latest-v24.x/api/inspector.html).
