# Isolated document pipeline replacement

The connected candidate passed focused correctness validation but **failed the
CPU performance gate**. Runtime and candidate-only tests were restored to
`5913fe15ec4c3bac8af311f634a20961b2f625af`. No optimization is retained.
Work used the current checkout; no new worktree was created. The unrelated
backend finite-snapshot test edit and `.codex-worktrees/` remain outside scope.

## Actual replacement tested

Unlike the earlier row-handoff checkpoints, this candidate changed ownership
across the executing document pipeline. The existing protocol codec privately
issued isolated canonical values. Byte/digest access and binary runtime leaves
were detached at escape; frozen nonbinary projections could be retained.
Only exact codec-issued identities received intrinsic facts. Clones, proxies,
foreign wrappers and raw exports retained their original integrity checks.

Application journal writers, relational writers, reference-page transitions and
stored-row decoding issued the representation before callback escape. Existing
table-semantic and stored-evidence provenance remained separate. Working-set
operations retained accepted runtime/native projections through validation,
pending state, result construction and private root closure. Public snapshots
still detached. Local synchronous operation segments were consolidated around
the same storage, validator, next-row, callback and resource boundaries.

All checks, charges, observations and tentative mutations remained at their
original semantic positions: an earlier validation failure still suppressed
later work; a return-budget failure still occurred after the original charges
and pending mutation. Per-row Effect sequencing, recursive borrowed frontiers,
full Causes, actual asynchronous validators and named diagnostic operations
remained. No codec format, SQL, durable schema, tuple-check, OCC, publication,
authority or settlement change was introduced.

Real raw consumers remained checked: foreign row-intent preparation, persisted
participant proof comparisons, the separate single-insert participant profile
and maintenance index construction. Those are not the complete mixed workflow's
journal path. The candidate did not replace the Effect interpreter or every
document-related operation in the repository.

## Measurements

Existing complete `mixed-workflow`, `small`, ordinary-role PostgreSQL harness;
five warmups and 40 alternating native/Flarex pairs per process. Each variant
has two independent processes (80 pairs); no samples were dropped. Inspector
profiling and factory probes were off. No competing benchmark, test, lint or
typecheck ran during measurement. The existing SDK reducer validates counter
identity, business gates, successful outcomes, cleanup and unchanged source
hashes. Values below are thread CPU means per complete business workflow.

| Cohort | Native | Flarex | Added CPU | Paired added median |
| --- | ---: | ---: | ---: | ---: |
| Baseline A | 25.800 ms | 134.100 ms | 108.300 ms | 110 ms |
| Baseline B | 27.325 ms | 132.950 ms | 105.625 ms | 108.5 ms |
| Replacement A | 25.900 ms | 131.650 ms | 105.750 ms | 109 ms |
| Replacement B | 28.425 ms | 142.550 ms | 114.125 ms | 110 ms |
| Baseline pooled | 26.5625 ms | 133.5250 ms | **106.9625 ms** | — |
| Replacement pooled | 27.1625 ms | 137.1000 ms | **109.9375 ms** | — |

Observed change: **+2.975 ms added CPU (+2.78%)**. This is not a demonstrated
causal regression of exactly 2.975 ms, and there is no demonstrated CPU saving.
The first replacement process alone was 1.2125 ms below the pooled baseline;
the independent repeat did not sustain it. Windows counters are quantized and
ten-pair block means vary substantially (all retained in the summary).

The agreed material-progress gate required at least 25% less added mean CPU:
a saving of 26.740625 ms and candidate added CPU at most 80.221875 ms. It failed.
Process CPU also supplies no positive result: pooled added means were
123.8375 ms baseline and 126.5250 ms replacement. Thread and process CPU are
different counters; neither is PostgreSQL elapsed time or quiet latency.

The current fresh baseline is about **107 ms added mean thread CPU**, not a new
measurement of the historical 125 ms figure. The older 172 ms pricing-query
wait remains a separate unresolved wall-time event. These repeated complete
workflow CPU measurements cannot be explained away as that one wait.

## Correctness and review evidence

Candidate validation passed:

- Protocol codec/value/runtime/evidence suite: 28 tests across three files.
- Focused persistence suite: 118 tests across 11 files, including working-set
  and materialization scenarios on both PGlite and ordinary-role PostgreSQL.
- Application journal and CMS command settlement: 16 tests across three files.
- Product schema composition: seven tests, covering PGlite and PostgreSQL.
- After the final producer/decoder migration, 74 affected raw/root/materialization
  tests and the seven product schema-composition tests passed again.
- Protocol, persistence, executor and analyzer typechecks; core and diff lint.
- Both required read-only TypeScript and systems reviewers found no actionable
  findings on the final candidate. This is correctness evidence, not CPU acceptance.

New candidate witnesses checked isolated binary/input/byte/digest mutation,
issuer-only provenance, corrupt decoder input, raw export corruption and private
root retention. Existing corruption, getter precedence, foreign wrapper and
failure-order witnesses remained. No new cancellation or response-loss recovery
campaign was run; those owners were unchanged. No quiet-latency, larger-workload,
retained-memory or deployed-worker acceptance is claimed after the CPU failure.

After restoring the runtime, all eight working-set failure-order/budget tests
passed again across PGlite and ordinary PostgreSQL. Core/diff lint, the exact
staged diff check, analyzer typecheck and gzip-based reduction passed. The owned
PostgreSQL fixture was stopped and its stopped status verified.
Both final read-only audits independently verified archive hashes, all 160
measurement pairs, summary arithmetic, patch reproducibility and exact runtime
restoration; neither found an actionable issue.

## Reproduction and disposition

`owned-pipeline-artifacts.json` records base revision, raw/gzip SHA-256 hashes
and lengths. Four lossless `.json.gz` reports, `owned-pipeline-summary.json`, and
the complete 13-file runtime/test `owned-pipeline-replacement.patch.gz` preserve
the experiment. The patch applies cleanly to the restored base. The campaign
source hashes are `538fc3029841137484c694a534f93ca9e295add368ca4c55681d8713904d0d68`
(baseline) and `9549467ac3022ea6087f48940169f1861ad98e698715eef1749b304c3b844db8`
(replacement), identical within each variant and before/after each campaign.

To reanalyze retained reports, set `FLAREX_PIPELINE_EVIDENCE_PREFIX=owned-pipeline`
and run the existing `pipeline-analysis.test.ts` with `analysis.config.ts`.
The reducer prefers gzip reports. The same prefix selects the corresponding
artifact manifest in `pipeline-retain.mjs`; its default historical behavior is
unchanged. Reproduction uses the existing `run-campaign.ps1 -Kind control`
with a fresh label and `-Samples 40` after preparing the recorded source variant.

The roughly 107 ms baseline excess remains open. The previous full profile
locates work among persistence, Effect and protocol owners; it does not prove
that 95 ms of checks or document transitions can be removed. This experiment
rejects the selected ownership/composition candidate as a material CPU fix.
It does not establish a new dominant removable cause or justify another runtime
rewrite from owner totals alone.
