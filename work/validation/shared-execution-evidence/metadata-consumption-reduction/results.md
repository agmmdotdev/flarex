# Issued metadata and consumption reductions

Both authorized changes are implemented on the current checkout, based on
`04005e463`. Neither establishes a complete-workflow CPU saving. No worktree was
created. The historical 125 ms median is not a subtraction baseline for this
campaign; the historical 172 ms pricing wait is elapsed time and remains a
separate unresolved observation.

## Separate complete-workflow CPU comparisons

Positive reduction means lower CPU. These are actual paired Flarex-minus-native
root CPU deltas, not SQL time, owner elapsed envelopes, or a subtraction of lane
medians. Each step has two fresh processes, 40 native/Flarex pairs per process,
40 before and 40 after requests overall. Each process uses balanced four-pair
ABBA or BAAB blocks, with the assignment reversed in the second process. The
interval is a stratified block bootstrap with 20,000 draws, seed 137.

| Isolated step | Before mean added thread CPU | After mean added thread CPU | Estimated reduction | 95% interval |
| --- | ---: | ---: | ---: | ---: |
| Issued selector/identity reuse | 112.88 ms | 112.05 ms | 0.83 ms | -12.33 to +14.33 ms |
| Table/access Result composition, with step 1 enabled in both variants | 109.85 ms | 112.40 ms | -2.55 ms | -16.40 to +12.30 ms |

Whole-process CPU also does not establish a saving: selector reduction -13.05 ms
(95% interval -34.10 to +5.85 ms), composition -8.00 ms (-25.85 to +11.33 ms).
This includes worker/background CPU, whereas the thread counter tracks the main
request thread. Neither establishes a regression either. The Windows counters
are quantized at roughly 15–16 ms, and the observed request scatter is material.

Five fixture warmups use the after path. To check the initial exposure of the
before body, a sensitivity analysis excludes the first balanced four-pair block
of each process: 72 pairs, still balanced. Thread reduction becomes -1.69 ms
(-15.14 to +12.19 ms) for selectors and -3.28 ms (-17.92 to +12.50 ms) for
composition. The conclusion does not change. No sum of these separate campaigns
is claimed as a net saving.

## Current authored-source control

Fresh run `2cf711c8-4773-48e8-8b71-b7a5d4eec724` uses the final authored code,
without AST transforms, profiling, leaf timers or a diagnostic collector.
Five warmups and 15 matched complete workflows pass every source/settings,
business-result, final-proof and cleanup gate. Reviewers and other owned
validation jobs were idle during collection.

| Counter | Native mean CPU | Flarex mean CPU | Mean paired added CPU | Median paired added CPU |
| --- | ---: | ---: | ---: | ---: |
| Request thread | 22.93 ms | 139.80 ms | 116.87 ms | **125 ms** |
| Whole process | 29.13 ms | 171.87 ms | 142.73 ms | 126 ms |

The current request-thread excess remains around the historical 125 ms median.
This independent control is a current measurement, not causal evidence from
subtracting historical controls. Neither authorized reduction explains the main
remaining excess. `current.config.ts`/`current.test.ts` reproduce this lane.

## Scope and preserved behavior

Step 1 removes repeated contract-key construction and identity encoding only
for exact immutable present keys issued by the finite metadata owner. Selector
maps are private to the existing projection. Definition indexes share the
original namespace/source owner across tables; cross-table selection gains no
new association restriction or multiplied retained entries. Missing selectors
remain unretained, and foreign values keep the generic encoder and full decoder.
Global weak identity entries are encodings of immutable facts, not authority;
they can survive projection disposal while those facts remain referenced.

Every consumption still checks root closure, projection issuance, watermark,
observation equality, dependency consistency, required membership and budgets.
The server's final metadata comparison remains unchanged. New selector indexes
are constructed during preparation, outside the request counter. This campaign
isolates warm request reuse and does not establish cold/preparation CPU or heap
savings. The before variant shares those preparation indexes but ignores them.
Its generic identity route has the common helper handoff/variant dispatch.

Step 2 replaces the two-success table Result.gen with Result.flatMap, selecting
source policy only after table consumption succeeds. The access loop retains
Result.gen and its existing family/unique-field order, yielding each unused
Result directly rather than delegating through its iterator. It adds no eager
traversal, recursion, outcome extraction, failure reboxing or iterator closing.
All named Effect diagnostics, lifetimes, checks and surrounding storage steps
remain intact. A later refusal cannot supersede the original failure.

## Measurement provenance

The disposable local harness switches only selected authored function bodies
using TypeScript AST transforms. It keeps one instance of Effect and of each
private metadata registry. Variant selection occurs outside the actual root
counter interval. No leaf timers, profiler, factory counters or execution
diagnostic collectors run in these comparisons. The native business graph is
unchanged. Baseline body snapshots come from `04005e463`; the step 2 before body
is measured with step 1 enabled. Authored package sources/settings stay stable
within each run.

| Stage/process | Run ID |
| --- | --- |
| Selectors A | 75552360-e7b6-42c3-b172-0075282468e7 |
| Selectors B | 6f8b2793-e599-4b4c-83be-3997dffb3db4 |
| Composition A | e49101db-7154-4e43-8d33-d0fd1b04c921 |
| Composition B | 38cb09a2-e17f-46e5-a388-0991912f3b4c |

All 160 matched pairs completed, including request-result checks, complete
native/Flarex graph verification, final durable proofs, source/settings gates
and resource cleanup. Raw reports, AST manifests, assignments, original source
snapshots and disposable scripts remain in this directory; compact statistics
and block estimates are in `summary.json`. Reproduction uses `ab.config.ts`,
`ab.test.ts` and `analyze.mjs`, with `METADATA_STAGE=selectors|composition` and
`METADATA_REVERSE=0|1`. Changing implementations requires new snapshots and
measurements, not reuse of these results.

## Correctness and handoff

Focused metadata tests pass on PGlite and ordinary-role PostgreSQL; working-set
read regressions pass on both drivers. Unit witnesses cover repeated table,
definition and access selectors, negative/foreign inputs, merged/subprojection
issuers, disposal, root consistency and byte limits. Two actual working-set
failure witnesses revoke later metadata at the first refusal and verify exactly
one original error, no later selection failure and no storage entry.

The same-page row/index RETURNING-corruption-before-trigger test passes on both
drivers. Persistence and executor typechecks, core/diff lint and the Effect
runtime boundary guard pass. Scope is focused validation; no new Workerd,
deployment, scale or complete five-graph performance acceptance is claimed.

Both required read-only project reviewers cleared the stable runtime/test
checkpoint with no findings: TypeScript/contracts/reuse/Effect and systems/data/
trust/lifecycle/failure order. They also examined the disposable measurement
scripts, baseline snapshot equality and reported arithmetic. They did not rerun
database or performance campaigns; the TypeScript reviewer independently reran
core/diff lint. The final control and report finalization followed those reviews
without further runtime changes.

Owned PostgreSQL was verified under `flarex_cpu_fixture` with fsync and
synchronous_commit on, plan/duration logging off, and zero other client backends
before shutdown. The owned data directory was resolved inside this checkout;
fast shutdown succeeded, pg_ctl reported no server running, and port 56434 has
no listener. No owned Workerd/Wrangler process was started. Unrelated Workerd
test changes and `.codex-worktrees/` remain untouched. Exact-index lint and the
scoped commit are completed by the main handoff procedure.
