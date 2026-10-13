# CPU cost by executing operation

The [read-family follow-up](./read-results.md) finds five repeated query
preparations and 28 repeated bounds compilations, about 0.3 ms of warm replay CPU.
No exact duplicate appears among its 26 index-page and eight row-read inputs;
the 45 ms family is not established as removable CPU.

The CPU is measurable. Relational read processing plus finite storage captures
is the largest measured combined operation family. Workflow execution and
publication are also substantial. There is no observed single 107 ms stall or
leaf function. Earlier source-owner totals did not prove the proposed document
replacement would remove a large cost; selecting that redesign was premature.

Current checkout base `f4f9cb7f5`; existing complete native/Flarex harness, V8
collector, clock landmarks and Windows thread-cycle reader. No runtime code,
business checks, failure order, SQL or durable behavior changed. No new worktree.
Instrumentation is an opt-in test transform; original business expressions execute.

## Direct counters, profiler disabled

Forty complete alternating pairs, after five warmups per lane: **138.425 ms mean
Flarex thread CPU minus 27.775 ms native = 110.650 ms added CPU**.

The prior untouched 80-pair baseline remains **106.9625 ms** added CPU
(133.5250 ms Flarex, 26.5625 ms native). Its authored-source hash matches all new
captures. The new observed excess is 3.6875 ms higher; between-process variation
and observer effects are not separated. No overhead subtraction or saving is
claimed. These are means, not the historical 125 ms median or 172 ms pricing wait.

| Flarex phase | Mean CPU | Share of thread cycles |
| --- | ---: | ---: |
| Portable business execution | **97.325 ms** | **69.08%** |
| Authoritative publication | **27.875 ms** | **20.04%** |
| Request admission | **9.750 ms** | **8.78%** |
| Finite freeze and validation | 3.100 ms | 1.58% |
| Runtime result validation | 0 observed counter increment | 0.27% |
| Complete-call cleanup | 0 observed counter increment | 0.19% |
| Outside named phases / probe-to-SDK boundaries | 0.375 ms | 0.06% |
| **Total** | **138.425 ms** | **100%** |

Phase increments sum to the measured total, including the explicit boundary
remainder. Native CPU is subtracted once at the complete-root level. These phase
values are **Flarex costs, not native-subtracted excess**. Native was not divided
into the same internal contracts. Counter zero means below the observed update
quantum; cycle readings confirm validation and cleanup still execute.

## Concrete costs without double counting

Each Flarex root has exactly 200 observed intervals, with identical counts in
all 120 diagnostic Flarex roots. Intervals must nest and settle. Subtracting direct
children yields disjoint costs. This table combines selected disjoint residuals
with whole admission/publication; their descendants are not added again.

| Executing work | Calls/workflow | Mean CPU, profiler off | Thread-cycle share |
| --- | ---: | ---: | ---: |
| Relational selection, excluding nested captures | **43** | **23.900 ms** | **17.00%** |
| Finite storage captures across the workflow | **38** | **21.100 ms** | **13.81%** |
| Native Medusa workflow invocation through Flarex, excluding observed nested document operations | 1 | **21.050 ms** | **14.51%** |
| Whole authoritative publication | 1 | **27.875 ms** | **20.04%** |
| Whole request admission | 1 | **9.750 ms** | **8.78%** |
| All remaining work and counter boundaries | — | **34.750 ms** | **25.86%** |
| **Total Flarex** | — | **138.425 ms** | **100%** |

**Read selection plus finite capture costs about 45 ms, or 30.81% of Flarex
thread cycles.** This is accumulated processing over many reads, not one pricing
await. It includes real dependencies, validation and returned-row processing plus
composition. The workflow residual includes unobserved callees and continuations;
it is not pure workflow-engine overhead.

The independent profile processes confirm the cycle ranking:

| Disjoint bucket | Profile A | Profile B | Profiler off |
| --- | ---: | ---: | ---: |
| Relational selection excluding captures | 16.38% | 16.46% | 17.00% |
| Finite captures | 16.46% | 14.29% | 13.81% |
| Workflow residual | 13.95% | 14.38% | 14.51% |
| Whole publication | 20.52% | 21.18% | 20.04% |
| Whole admission | 8.39% | 8.80% | 8.78% |

Whole `medusa.workflow:run` is 52.275 ms / 36.13% of cycles without profiling;
whole Product update is 24.700 ms / 19.95%. These include the table's nested work.
Seven `LogicalDocuments.relationalChange` calls cost 11.750 ms inclusive and
4.300 ms excluding nested validation/captures (2.77% of cycles). These numbers
do not retrospectively price the rejected candidate's internal delta, but show
why a broad document-owner name is insufficient evidence for a large saving.

## Actual work and stack evidence

- `workingSet.ts:1610`, `readRelationalSelection`: query capture and budgets,
  predicate/access preparation, candidate selection, metadata and exact index
  membership, pending/base-row hydration, inspection, ordering and projection.
  Capture children are excluded from its 23.900 ms residual.
- `finiteStorageCapture.ts`, `FiniteStorageCapture.run`: demand/snapshot
  preparation, physical command execution, header/epoch/layout/result acceptance.
  CPU includes client driver/session continuations in that interval. PostgreSQL
  execution and network waiting do not consume these Node thread-cycle counters.
- Workflow stacks show private JSON descriptor/bounds capture, predicate parsing,
  canonical JSON sizing, metadata dependencies, index bounds, iterator advances,
  named-function wrappers and Result/Schema execution. Retained concrete chains:
  `SchemaAST -> SchemaParser -> prepareLogicalRelationalRead -> workingSet`, and
  `SchemaParser -> decodeOrderedIndexRangeFieldV1 -> compileAppOrderedIndexBoundsV1
  -> workingSet`. Generated profiler coordinates are not source-mapped TS lines.
- Publication counter costs: acceptance 6.200 ms, materialization 6.675 ms,
  enclosing publication remainder 15.000 ms. Stacks show Drizzle classification/
  SQL building, bytes/index codecs, returned-row processing and Effect/Schema.
  These are client CPU; earlier server SQL elapsed measurements are separate.

New profiles reproduce the old sampled owner ranking: persistence 32.86 ms,
Effect runtime 31.05 ms, protocol 17.29 ms, Schema 8.35 ms, other Effect/Result
7.45 ms estimated excess. Native Medusa/upstream contributes negative 14.86 ms.
These are statistical allocations by terminal samples, not exact function timers
or additional costs to add to the operation table.

**No single removable function dominates.** The expensive operation families
are directly bounded; their removable fraction is not proved. A removal proposal
must establish repeated equivalent work at the same semantic boundary and its
cost inside these operations. This report selects no further runtime redesign.

## Limits and validation

Three independent processes, 40 pairs each, five warmups, no omitted pairs.
All business/source/database-settings/cleanup gates passed. No competing test,
analysis, lint, typecheck or benchmark ran during capture.

Windows thread CPU updates are roughly 16 ms; short intervals can receive an
adjacent interval's update. Averaging is not a fine stopwatch. Independent thread
cycles support the repeated ranking; cycles are never converted to milliseconds.
Each ledger joins exactly one original SDK root by its monotonic window. Parent
order, containment, sibling disjointness, monotonic counters, complete settlement,
thread identity and exact cycle/CPU conservation are checked. Business, reader
and exact probe/config source inventories agree within and across captures.

V8 alignment reuses the existing six-ms external landmarks and original root
windows. Samples must fit for every allowed clock offset. Coarse business phases
correlate usefully; short nested boundaries are too dense for 1 ms sampling:
5,464 active Flarex samples are marked fine-operation-boundary, rather than
inventing a leaf owner. Counter partitions do not depend on that sample fit.
Inclusive intervals may include unobserved same-thread background continuations.
Strict selected-scope nesting rejects overlap but does not prove semantic
ownership of every continuation or pure interpreter/driver costs.

Profile A/B added means are 121.650 / 115.000 ms; profiler-off is 110.650 ms.
This is not calibrated observer-cost subtraction. The explicit probe has about
0.85 ms estimated self excess, excluding other wrapper/reader/allocation/JIT
effects. The native graph lacks some Flarex OCC/history/authority/atomic-outcome
guarantees: added work is not automatically waste. The pricing-wait cause,
deployed Worker performance, quiet latency, larger workloads and scale remain
outside these claims.

## Artifacts and reproduction

Run IDs: profile A `489cdedd-f854-4a19-924d-a6833ca31a5d`, profile B
`ac599a84-3cde-4bd4-a2cd-53919b88ba88`, profiler-off
`73204d7b-580c-4aef-a0eb-4fbd4eb14b64`. All authored hashes are
`538fc3029841137484c694a534f93ca9e295add368ca4c55681d8713904d0d68`.
Native reader SHA256:
`87aab6b32662ee1cdb18277564f9c406f252a413bb0728cecb21d2a88f973beb`.

`operation-costs.json.gz` retains all 240 roots and individual interval partitions.
`operation-summary.json.gz` retains full stack/category/phase evidence.
`operation-artifacts.json` records raw/gzip sizes and SHA256 for all retained
campaign, operation and marker ledgers. Historical baseline artifacts are reused.

Capture using the existing attribution integration test, existing database URLs,
`FLAREX_MEASUREMENT_SAMPLES=40`, fresh report directory and
`FLAREX_MEASUREMENT_ATTRIBUTION=cpu` or `control`, with
`operation-profile.config.ts`. Reanalyze with:

```powershell
pnpm exec vitest run --config work/validation/shared-execution-evidence/full-cpu-differential/operation-analysis.config.ts
pnpm exec tsc -p work/validation/shared-execution-evidence/full-cpu-differential/tsconfig.json --noEmit
```

The config explicitly selects operation correlation. Both reducers share the
interval validator and prefer retained gzip evidence. Refusal witnesses reject
overlapping siblings and changed instrumentation; existing workload/pair/counter
substitution witnesses remain. Five analysis tests and typecheck passed.
Historical replay's three tests and core/diff lint passed. Both required
read-only reviewers independently verified retained artifact hashes, interval
partitions and report arithmetic; neither reported remaining findings.
The owned PostgreSQL fixture was stopped and stopped status verified.
