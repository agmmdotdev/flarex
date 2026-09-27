# Private mixed mutation performance baseline

This package measures the four private workloads in the [performance baseline preflight](../../../../roadmaps/mixed-mutation-core/04-performance-baseline-preflight.md). That measurement approval did not authorize a runtime optimization; the separately approved [core query cost preflight](../../../../roadmaps/mixed-mutation-core/05-core-query-cost-preflight.md) now owns the in-progress persistence correction and its rerun. Neither package approves a higher limit, public activation, or a native ORM parity claim. This guide retains the original baseline analysis; generated intermediate samples live in the ignored `work/validation/mixed-mutation-performance/` directory.

The corrected persistence path batches authenticated table and search
definition checks and groups bounded working-set reads inside checked short
transactions. Physical search proofs and table frontiers are loaded when an
ordered coverage decision needs them, preserving an earlier refusal. The
complete four-workload, 104-sample ordinary-role PostgreSQL series has no
failed or excluded request; all selected cold workflows completed under the
existing deadline. The original failed cold request remains in its own
historical record, with no proven COMMIT-delay cause.

## Workloads and measurement boundary

| Workload filter | Selected work |
| --- | --- |
| `product` | Application point, native Product update/read, one mixed publication. |
| `productPayload` | Product plus selected Payload `posts` lifecycle and Application result, one mixed publication. |
| `mixedWorkflow` | Ordered Product, Variant, Pricing, Link and Tag workflow, Payload and Application result, one mixed publication. |
| `standaloneWorkflow` | The same selected finite Product/Pricing/Link/Tag business graph under the independently settling native host. |

The standalone run has fewer root obligations: it does not perform the mixed Application, Payload, journal and OCC work. Its latency difference therefore does not isolate framework overhead. Neither run represents an equivalent native Medusa ORM baseline. The mixed path creates, readies, invokes once and disposes a fresh Worker **inside every request interval**; the exact runtime permits one invocation per Worker. Warm requests reuse prepared modules, scope and pools, but use disjoint equivalent business graphs and fresh attempts. Cold samples use separate scopes and module construction. Provisioning, migration, compilation and graph seeding are recorded outside the invocation interval. Starting table cardinality and retained growth matter because warm samples share a scope.

The request interval starts before fresh admission and ends after authoritative publication and retained-outcome resolution. The tracer distinguishes control and target pools, query dispatches, SQL statements, pool checkout, nested phase spans and BEGIN-to-settlement transaction intervals. Driver **awaited SQL time** includes scheduling, transport and database wait; it is not PostgreSQL server execution time. Dispatch count is not automatically a network round-trip count. Nested spans and overlapping waits cannot be summed into wall time. Transaction intervals do not measure scope-clock lock wait or hold. Inner native child, OCC/materialization, server execution, hosted transport and production capacity remain unobserved. A sample with lost trace context, an open transaction or a required phase/route gap is invalid rather than silently partial.

## Original ordinary-PostgreSQL evidence: partial baseline

The corrected 16/16 smoke verified instrumentation and suggested the owners
below. The longer ordinary-role run completed the three mixed workload warm
series, each with three warmups and 20/20 successful measured warm requests.
Its finite-workflow cold series then had one success and one
`deadlineExceeded` failure; the third cold request was not attempted. The
failure remains in the raw record. The separately settling standalone series
completed independently with 20/20 warm and 3/3 cold successes. This is
valuable descriptive evidence, **not a completed accepted mixed baseline**.

| Workload | Warm request median (range), descriptive p95 | Dispatch median | SQL await median | Cold successes / attempted; median request |
| --- | ---: | ---: | ---: | ---: |
| Product | 10.590 s (10.144–12.341), 12.188 s | 14,504 | 7.840 s | 3/3; 9.149 s |
| Product + Payload | 14.873 s (14.617–15.622), 15.309 s | 20,710 | 11.133 s | 3/3; 15.306 s |
| Mixed workflow | 32.294 s (31.464–32.742), 32.664 s | 43,108 | 24.327 s | 1/2; one success at 31.787 s |
| Standalone workflow, separate run | 0.638 s (0.610–0.756), 0.701 s | 861 | 0.388 s | 3/3; 0.664 s |

These are `trace.durationMs` **request spans**, not the outer `wallMs`
envelope. The latter includes trace finalization, whose Product warm median
was **14.9 ms**. The standalone series came from a separate invocation after
the failed mixed run, on the same ordinary-PostgreSQL service; it is not the
missing third mixed cold sample. Each full-series Product warm request issued exactly
**14,504** dispatches; each Product cold request issued **9,420**. Warm Product
and Product-plus-Payload sealed attempts had median canonical journal sizes
of **13,049** and **20,848** bytes respectively. Settled live-journal rows
were removed, so their zero retained-byte growth is a different fact.

The failed mixed cold request reached the existing borrowed deadline. Its
observed Product update phase lasted about **15.5 s** and included **47 target
COMMIT dispatches** with roughly **9.7 s** summed await, compared with earlier
successful cold or late-warm phase observations. The trace records no query
error or lost context. This identifies the phase where time accumulated; it
does **not** establish the cause of the delay or justify a deadline change.

The dominant Product search fingerprint, `3f841da7…460b0e7a29`, is a `fx_system_search_build_state` read with a `pg_catalog` physical search-index identity probe. Its SQL is owned by `LogicalSearchBuild.inspect` in [`logicalSearchBuild.ts`](../../../persistence-postgres/src/logicalSearchBuild.ts). All 20 full-series warm requests record **768** such dispatches each, with **4.891–5.359 s** summed awaited time per request (mean **5.031 s**). There are eight selected search definitions checked in each inspection, so the count indicates **96 readiness inspections** per request. The call path is `LogicalDocumentWorkingSet.runRead` → checked relational admission → `LogicalSourceAdmission.withBinding` → `verifyLogicalSchemaBindingInTransaction` → `LogicalStorageReadiness.inspect` → `LogicalSearchBuild.inspect`. Those checks are part of fresh source authority and readiness, including at historical reads and publication; their repetition is not permission to cache an authorization across transactions.

The other dominant Product fingerprint, `0b20168e…4d1b3147f4`, selects the latest `commit_seq` for one scope/table from `fx_app_row_current`. It has **multiple exact owners**: search-frontier reads in `LogicalSearchBuild.inspect`, and `readAppTableWriteFrontierInTransactionEffect` from [`appRows.ts`](../../../persistence-postgres/src/appRows.ts), called by index coverage in [`indexBuildStates.ts`](../../../persistence-postgres/src/indexBuildStates.ts) and unique-set coverage in [`appUniqueConstraintSetBuildV1.ts`](../../../persistence-postgres/src/appUniqueConstraintSetBuildV1.ts). The normalized fingerprint alone cannot apportion those calls. The first Product warmup and cold each record **4,512 = 47 × 96** such dispatches; each measured warm records **9,600 = 100 × 96**. The warm count rises by **5,088**, while total dispatches rise by **5,084**; four other dispatches disappear. The 96-inspection count stays constant.

The source has covered-snapshot fast paths for index and unique definitions; an uncovered path reads the table frontier. A publication advancing the scope clock plausibly changes which definitions take that path, giving the observed **47 → 100 frontier queries per readiness inspection**. This is an **inference** from the counts and branches, not proof of the individual stored coverage states or the index-versus-unique split: the sanitized trace omits parameter values and row results. Product retained row/index cardinality increases by only one each request, so the abrupt jump is not explained by simple row-count growth. The owner mapping in the generated report often says `unattributed` because reconnaissance stacks stop in Drizzle; the source assignment here comes from the structural SQL and the connected call path, and the frontier fingerprint remains shared.

## Complete corrected series

The retained [corrected report](./optimized/report.md), [raw record](./optimized/raw.json.gz),
[sample index](./optimized/samples.csv), [exclusion record](./optimized/exclusions.json)
and [manifest](./optimized/manifest.json) describe one full ordinary-role
PostgreSQL series. All four workloads completed three warmups, 20 measured
warm requests and three cold requests: **104/104 successful samples**, with
no final exclusions, unobserved dispatches, incomplete spans or open
transactions. This corrected series closes the selected mixed workflow's
cold deadline gate. It does not turn the earlier failed request into a
success or identify the cause of its COMMIT delay.

| Workload | Warm request median, original → corrected | Descriptive warm p95, original → corrected | Dispatch median, original → corrected | SQL await median, original → corrected | Cold success and median, original → corrected |
| --- | ---: | ---: | ---: | ---: | ---: |
| Product | 10.590 → 3.0202 s | 12.188 → 3.2982 s | 14,504 → 4,358 | 7.840 → 1.6234 s | 3/3 at 9.149 s → 3/3 at 3.0629 s |
| Product + Payload | 14.873 → 4.4202 s | 15.309 → 7.8837 s | 20,710 → 6,352 | 11.133 → 2.4029 s | 3/3 at 15.306 s → 3/3 at 4.3682 s |
| Mixed workflow | 32.294 → 10.1082 s | 32.664 → 10.7503 s | 43,108 → 11,442 | 24.327 → 5.9815 s | 1/2 at 31.787 s, third unattempted → 3/3 at 10.1003 s |
| Standalone workflow, separate original run | 0.638 → 0.3621 s | 0.701 → 0.9921 s | 861 → 480 | 0.388 → 0.1714 s | 3/3 at 0.664 s → 3/3 at 0.3599 s |

These are request spans and driver awaited times, with the same selected
business graph and distinct profile obligations described above. The
standalone warm p95 increased even as its median fell, so this is not a
uniform tail-latency improvement. The two original runs and the corrected
run are distinct series rather than paired requests or a native Medusa ORM
comparison. Fresh source readiness and per-row historical SQL within grouped
transactions remain costs; the corrected counts do not justify dropping
those checks or claiming arbitrary framework or hosted performance.

The original Product warm series issued **768** physical search-proof
dispatches and **9,600** scalar table-frontier dispatches per request. The
corrected Product warm median has **90** physical catalog proofs with
**596.9 ms** summed await, **270** batched table-frontier dispatches with
**106.0 ms** summed await, and no scalar frontier dispatches. Historical
`fx_app_row_rev` reads remain at **24** dispatches and **7.7 ms** summed await.
The corrected mixed workflow still has **248** physical catalog proofs with
**3,143.2 ms** summed await, **744** batched frontier dispatches with
**320.8 ms** await, **53** scalar frontier dispatches with **8.3 ms** await,
and **51** historical row reads with **20.7 ms** await. Fresh physical
readiness is the larger remaining measured query cost on that selected path;
further change would require its own plan and correctness proof. These
fingerprint totals are awaited SQL time, not PostgreSQL server execution or
additive request phases.

The corrected [exclusion record](./optimized/exclusions.json) has no excluded,
failed or unattempted final samples. It separately identifies a stopped setup
before sampling and a pre-final diagnostic smoke; the retained
[stopped-attempt note](./optimized/stopped-attempt.md) documents that setup
without adding it to the 104-sample result.

## Original candidate targets and current correction

The following targets came from the original partial record. They remain
hypotheses rather than accepted numerical gates. The approved core correction
in [preflight 05](../../../../roadmaps/mixed-mutation-core/05-core-query-cost-preflight.md)
uses bounded selected-table and definition batches within short checked
transactions. The complete corrected distribution above closes the selected
cold gate; these original proposals are retained for comparison:

1. The original Product shape observed **96 fresh checked inspections** and eight definition-level physical search-identity SQL dispatches per inspection. Its candidate target was **768 → ≤96** dispatches per request, with **≤1.5 s** awaited time for that fingerprint versus the full Product warm-series mean of **5.031 s**. Grouped working-set reads could reduce the inspection count itself, so 96 was an observed baseline, not a required post-correction count. The corrected proof still authenticates all eight selected logical search definitions against their two generic physical GIN kinds and fails closed on a changed index.
2. The provisional Product warm target was **9,600 → ≤2,400** frontier dispatches (100 → ≤25 per inspection), while preserving the observed clock and each definition's coverage decision, without a cross-transaction authority cache or weaker pending-publication checks. The complete corrected series above evaluates that target.
3. The provisional Product request-span median target was **≤6.5 s** versus **10.590 s** in 20 successful warm samples, with no **>10%** median regression in the other three workloads and unchanged publication, conflict, cancellation and recovery proofs. The corrected series evaluates those request distributions; count and awaited-time savings do not add linearly to wall time.

The corrected Product series falls below the provisional Product dispatch,
awaited-time and request-median bounds,
and none of the four workload medians regressed. Those original bounds were
candidate diagnostics, not a production service level or a claim about every
latency tail. The standalone descriptive p95 rose as shown above.

The original cost fingerprints cannot alone prove the corrected distribution
or explain the cold COMMIT delay. Compare the new run separately against these
retained samples. A lower dispatch count is insufficient if it removes
per-source binding checks, exact readiness, root fencing or one-publication
settlement.

## Reproduce and interpret

Use an isolated, ordinary-role real PostgreSQL service. The runner requires `FLAREX_MIXED_PERF=1` and `FLAREX_POSTGRES_DATABASE_URL`; fixture provisioning can also use `FLAREX_POSTGRES_PROVISIONING_DATABASE_URL` when the ordinary role lacks schema setup privileges. Set URLs in the environment outside the command transcript; do not put credentials in generated reports. `FLAREX_MIXED_PERF_REPORT_DIR` selects an ignored output directory. Run sequentially without another database-heavy suite on the same host:

```powershell
cd packages/flarex-backend
$env:FLAREX_MIXED_PERF = "1"
pnpm exec vitest run test/mixedMutationPerformance.postgres.test.ts --no-file-parallelism
```

For a quick instrumentation smoke, also set `FLAREX_MIXED_PERF_SMOKE=1` and optionally `FLAREX_MIXED_PERF_WORKLOAD` to one of the four filter values above. Clear those optional variables for the full run. Smoke plans **1 warmup + 2 measured warm + 1 cold** per workload; full plans **3 warmups + 20 measured warm + 3 cold**. The runner records setup separately, excludes warmups from warm distributions, validates publication/results, and records failures/exclusions. Reported p95 for 20 warm samples is descriptive; no stable p99, throughput or scale claim follows. PGlite remains a correctness lane, not a latency substitute. An earlier smoke with an invalid camelCase handle is excluded from the original analysis; its retained ignored files are diagnostic only. A PGlite finite-workflow test passed after its original setup order was restored. The corrected full series now closes the selected cold gate, while the cause of the original delay remains uncertain.

Canonical run output was generated first in the selected ignored directory.
The retained evidence beside this guide is the [mixed partial raw record](./mixed-partial.raw.json.gz)
and [mixed partial report](./mixed-partial.report.md), the separate
[standalone raw record](./standalone.raw.json.gz) and
[standalone report](./standalone.report.md), [sample index](./samples.csv),
and [exclusion record](./exclusions.json). The mixed run attempted **77 of 104**
planned samples: **76 successes, one failure**. Its missing mixed cold sample
and all 26 standalone samples were unattempted in that run. The independent
standalone filter supplied **26 successful samples** in a separate series.
Together the runs attempted **103 samples: 102 successes and one failed mixed
cold request**. The sample index has 103 rows including that failure. These
datasets must not be presented as one completed 104-sample baseline or as a
single continuous run. The raw records
retain revision/source hashes, environment/profile selection, per-sample
status, scope and data shape, wall and phase spans, dispatch/statement counts,
awaited-time unions, checkout, attribution uncertainty and committed growth.
Sealed-journal bytes were captured at successful seal; settled live-journal
rows were removed, so post-run live-journal bytes are a different measure.
