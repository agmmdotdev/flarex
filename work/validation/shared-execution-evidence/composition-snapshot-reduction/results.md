# Separate composition and immutable-handoff CPU results

**Neither runtime candidate was retained. This task delivers no demonstrated CPU reduction.** Both were implemented, behavior-tested and independently reviewed, then measured separately. Composition did not show a repeatable saving; the snapshot candidate measured worse. All four runtime files and the owning roadmap are restored exactly to base `70d2152967ef26c391760349a505f88ad82bf8d4`. Work stayed in the current checkout; no worktree was created.

## Separate measurements

Positive reduction means less current-thread CPU per complete workflow, after subtracting its matched complete native workflow. These are CPU counters, not SQL elapsed time or profile sample spacing.

| Candidate | Matched pairs | Before added CPU mean | After added CPU mean | Estimated reduction | Exploratory 95% interval for reduction | Disposition |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Contribution and dependency-evidence composition | 160 | 118.150 ms | 112.588 ms | 5.563 ms | -3.525 to 14.588 ms | Not retained; no reliable saving |
| Private immutable activity handoff | 80 | 104.600 ms | 115.600 ms | -11.000 ms | -21.775 to -0.250 ms | Rejected; measured regression |

Composition's original 80-pair cohort estimated 10.350 ms reduction. A fixed additional 80-pair replication, selected because the original interval crossed zero, estimated only 0.775 ms. Both before/after medians are 117 ms in the pooled cohort. All observations remain in the result. Excluding the first four-pair block from each process gives 4.542 ms reduction, interval -5.153 to 14.403 ms. This does not establish an actual saving.

Snapshot's corresponding warmup sensitivity is -10.833 ms reduction, interval -22.389 to 0.639 ms. Therefore the nominal regression interval must not be overstated as a stable causal effect across conditions. It gives no reason to retain an additional performance-only path.

Whole-process CPU is also inconclusive: composition estimates 11.100 ms reduction, interval -3.588 to 27.100 ms; snapshot estimates -5.750 ms reduction, interval -27.025 to 14.301 ms. See `summary.json` for raw statistics, block differences, initial/replication cohorts, source hashes and gates. `initial-summary.json` preserves the initial analysis before replication.

## Final restored-source control

The final 40-pair untransformed control measured **110.200 ms mean added thread CPU, 108 ms median**. Flarex averaged 139.925 ms and its matched native graph 29.725 ms. Whole-process added CPU averaged 118.600 ms, median 109.5 ms. All business-result gates and cleanup passed, with identical source fingerprints before/after the control. Historical 125 ms is context, never a subtraction baseline for these candidates. Because runtime is restored unchanged, this lower fresh-cohort figure is **not** an optimization saving.

## Candidate scope and behavior

1. `journalContribution.ts` and `journalEvidence.ts`: each complete synchronous validation/projection became an ordered Result pass beneath its original named lazy Effect operation. Existing identity, unique-key and Schema owners remained authoritative. Metadata encoding retained SchemaError. First refusal and foreign getter defects retained their order. This was a bounded participant-path change, not a broad Effect rewrite.
2. `detachChanges.ts` and `rootEvaluator.ts`: the private closing handoff reused activity JSON through its existing immutable issuing owner. Mutable dependency envelopes, canonical byte/digest buffers, public projections and unknown values remained detached. Closed handles still authenticated the original root/attempt and revoked on adoption. This was activity JSON only, not an authorization or whole-snapshot cache.

Both designs passed source review. The composition candidate removes incidental per-member Effect auto-yields. No I/O, resource acquisition or publication moved into the synchronous pass; surrounding interruption boundaries remained. Identical within-pass cancellation latency and maximum-bound responsiveness were not measured (finite producers permit up to 4,096 identities and 64 MiB working storage). Neither candidate is shipping, so current runtime scheduling and ownership behavior remain unchanged.

## Measurement design and reproducibility

Reused the existing measurement SDK's `compare`: complete `mixed-workflow`, small fixture, root counters, five warmups, 40 matched native/Flarex pairs per process. Source variants are selected before root-counter capture. No inspector, generator-cycle probe or SQL observer runs in measured requests. Campaigns ran sequentially without concurrent owned tests, lints or other benchmarks.

Composition processes a/b use ABBA/BAAB; fixed follow-up c/d reverses the process order, BAAB/ABBA. Snapshot uses a/b ABBA/BAAB. Every four-pair block has two before and two after variants, balancing native/Flarex execution order. Composition trials pin both snapshot files to their original implementations. Snapshot trials keep the composition candidate fixed, measuring its incremental handoff effect. Do not add these estimates to or subtract them from a historical 125 ms figure.

The analyzer uses 20,000 stratified block-bootstrap draws, seed 137. These are exploratory uncertainty estimates, not optional-stopping-corrected confirmation. No successful sample was discarded. Warmup sensitivity is additional to the complete primary data. The final analyzer requires all designated composition a/b/c/d, snapshot a/b and control manifests; missing evidence fails instead of silently omitting a cohort. Cohorts are named by lane, and raw reports are resolved beside their manifests rather than through an old checkout's absolute path.

Each campaign's `assignment.json` maps samples to variants and records baseline/transformed-source hashes; its UUID JSON report contains complete root counters, business-result gates and cleanup evidence. The four `baseline-*` files match the Git base after newline normalization. `candidate-*` preserves the tested implementations and candidate-only alias test. `initial-ab.config.ts` is the transform actually used for the recorded campaigns. `ab.config.ts` now reads those frozen candidate copies, allowing reproduction after restoration without silently benchmarking two baseline bodies. The recreated metadata Effect encoder exists only in the experiment and reproduces the original API call.

Use `run-campaign.ps1 -Stage composition|snapshot|control -Label <fresh-label>`; add `-Reverse` for BAAB. Existing output labels are refused to preserve evidence. The checked-in analyzer reads the recorded a/b/c/d and retained-control labels. A control with both candidates was interrupted during startup after the snapshot result; it produced no successful report and is excluded. Its log remains; `retained-control` is the final restored-source run.

## Validation and cleanup

Candidate validation:

- Projection and finite-root behavior: 21 tests passed, including private/public/foreign alias checks.
- Original-source first-failure control: 4 tests passed; candidate-only immutable-sharing test excluded.
- Three-source receipt/seal/commit: PGlite 1 and ordinary-role PostgreSQL 1 passed, including wrong-profile/method refusal, replay and changed-binding refusal. This test has empty row changes; it is not the nonempty-business witness.
- Same-page returned row/index corruption before a later trigger failure: PGlite 1 and ordinary-role PostgreSQL 1 passed.
- All 240 completed candidate pairs verified nonempty complete business workflows and cleanup in PostgreSQL.
- Persistence typecheck, core/diff lint and Effect boundary guard passed.
- Both required read-only reviewers found no runtime blocker. TypeScript reviewer independently ran core/diff lint. Systems reviewer independently matched all original files to the base. Performance acceptance remained separate from correctness.

The four original-compatible projection tests are retained as regression coverage. Final restored-source projection/finite-root tests passed (20 tests), as did persistence typecheck, core/diff lint and exact-index lint. Both reviewers checked restoration and the frozen reproduction configuration. Systems review independently reconciled all 280 raw paired counters, reproduced the summary byte-for-byte, verified equivalent transformed runtime bodies, and confirmed missing replication/control evidence fails before output. All 280 completed matched pairs verified results and cleanup. Owned PostgreSQL was stopped and verified not running. No claim of hosted deployment, production scale or resolution of the remaining native-relative CPU gap is made.
