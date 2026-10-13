# Document pipeline checkpoints

Completed initial-checkpoint experiment based on `67e89e5bc`. No worktree was created.
Unrelated backend finite-snapshot test edits and `.codex-worktrees/` are outside
this checkpoint. Both runtime candidates were measured separately and rejected.
The original runtime is restored; no production optimization is retained.

## Method

Use the existing complete `mixed-workflow`, `small`, ordinary-role PostgreSQL
root-counter lane. Each process has five warmups followed by 40 alternating
native/Flarex pairs. Do not run tests, typechecks, lint or another campaign during
measurement. Inspector profiles and Effect construction probes are absent.
The existing full-profile evidence owns attribution; these runs measure savings.

`pipeline-analysis.test.ts` reuses `evidence.ts` and the measurement SDK schemas
to check counter identity, pair indices, business gates, cleanup and unchanged
source hashes. `pipeline-summary.json` preserves absolute native/Flarex means,
paired mean/median and consecutive ten-pair block means for both thread and
process CPU. Blocks describe variation; they are not independent causal trials.
Windows counter quantization still prevents sub-millisecond per-call claims.
Root-counter wall times are not quiet-lane latency acceptance.

## Checkpoints

1. Baseline: unchanged runtime, independent A/B processes.
2. Row handoff: carry the existing native projection alongside the bounded
   runtime capture, through insert/write/edit and relational lifecycle/result
   consumers. Keep table acceptance, output charges and byte-integrity checks.
   Activity and root detachment already retain their required projections;
   this checkpoint does not claim to eliminate those existing copies.
3. Execution composition: consolidate bounded synchronous operation segments
   while keeping real storage, callback, next-row and resource cuts.

The representation checkpoint does not seal the entire canonical carrier.
`state.validateDocument` receives it, and existing tests deliberately mutate
issued byte buffers. Removing those checks requires closing that alias boundary
across all consumers; no such proof is inferred from a trusted TypeScript type.

## Baseline

| Cohort | Native thread CPU mean | Flarex thread CPU mean | Added mean | Added median |
| --- | ---: | ---: | ---: | ---: |
| Baseline A | 29.975 ms | 143.800 ms | 113.825 ms | 110 ms |
| Baseline B | 25.350 ms | 135.475 ms | 110.125 ms | 124 ms |

The repeated baseline averages 111.975 ms added thread CPU. The approved
material-progress threshold is a 25% reduction, or 27.994 ms against this
baseline; it is not a forecast. Final complete-workflow CPU/quiet-latency
acceptance remains separate and unmet.

## Correctness witnesses

The shared working-set scenario now distinguishes an earlier validator failure
from a later return-budget failure. It inspects tentative attempts/observations,
remaining bytes, suppression of the next validator and the latched original
Cause. Both PGlite and ordinary PostgreSQL execute that same witness.

## Candidate results and disposition

All values below are mean thread CPU per complete business workflow. Each row
combines two independent processes, 80 matched pairs total; no pair was removed.

| Variant | Native | Flarex | Added CPU | Change in added CPU from previous checkpoint | Change from baseline |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline | 27.663 ms | 139.638 ms | 111.975 ms | — | — |
| Existing row views carried through return | 27.113 ms | 142.588 ms | 115.475 ms | +3.500 ms | +3.500 ms |
| Row views plus local execution composition | 26.575 ms | 139.000 ms | 112.425 ms | -3.050 ms | +0.450 ms |

Individual added means: baseline **113.825 / 110.125 ms**; handoff
**115.800 / 115.150 ms**; combined **115.500 / 109.350 ms**. Individual paired
medians are **110 / 124**, **117.5 / 109**, and **109 / 110 ms**, respectively.
These variable, coarsely quantized runs do not establish a 3.050 ms causal
composition saving, and the combined candidate does not improve on baseline.
No CPU reduction is demonstrated; the 27.994 ms material-progress gate fails.

The first candidate only removes the extra native return wrapper/capture while
carrying existing issued projections through insert/write/edit/lifecycle output.
The second consolidates metadata checks, protected timestamp acceptance, input
capture/charging, insertion bookkeeping, postvalidation mutation/return,
page-member inspection and lifecycle bookkeeping. Per-row traversal, actual
validators/storage operations, named diagnostic events and recursive borrowed
frontiers remain. It does not replace the full interpreter or canonical codec.

This is **not a completed full document-pipeline redesign**, nor evidence that
every larger redesign must fail. The private nonescaping representation is not
implemented: closing all byte/validator aliases would require a wider actual
consumer migration. Existing activity and root handoffs already retain their
projections. These initial results supply no measured basis for retaining the
candidate or continuing isolated helper changes. The previous profile's owner
concentration remains attribution, not an estimate of removable CPU.

Restore disposition: `relationalRows.ts`, `workingSet.ts` and the candidate-only
native-view test return to the exact Git base. The independent behavioral
regression in `logicalWorkingSetReadTransactionsScenario.ts` remains. Preserve
both runtime variants and candidate-only test as lossless `.patch.gz` diagnostics; they are
not loaded by the application. The shared witness patch is also retained for
source-hash reproduction. The harness inventories non-`.test.ts` scenario files,
so the candidate digests include that witness even though it is not executed
inside the measured workflow.

Validation before rejection: persistence typecheck for each candidate;
handoff direct/database suite 66 tests; combined focused suite 102 tests across
10 files, including PGlite and ordinary-role PostgreSQL working-set and
materialization scenarios; core and diff lint. All six measurement campaigns
passed complete business verification and cleanup gates. No new SQL/storage or
publication implementation was introduced.

After restoring the runtime, the retained working-set suite passed again on
both PGlite and ordinary PostgreSQL (eight tests across two files). Both required
read-only reviewers found no actionable issue; they independently checked the
artifact hashes, arithmetic and final restoration. The TypeScript reviewer also
ran core and diff lint successfully. The reducer passes against the packaged
gzip reports, so the committed evidence can be reanalyzed without uncompressed
local campaign files.

Because the CPU gate failed, no candidate quiet-latency, larger-workload,
retained-memory or deployed-worker acceptance is claimed. No extra CPU profile
is needed to claim a removal that these runs did not demonstrate. Final native-
relative CPU and quiet-latency targets remain unmet. The existing ~112 ms mean
gap remains open; no new dominant removable cause was established here.
