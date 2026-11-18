# Bounded validation composition and current-index envelope reduction

Baseline: `67882abd2` on the current `wip/candidate-admission` checkout.
No worktree was created. Runtime scope is the two authorized shared-owner
changes; no validators, charges, authority checks, hashes or write barriers
are removed.

## Implemented scope

1. The shared logical working set validates captured relational mutation inputs
   in one lazily sequenced Result fold before selecting or writing any row.
   Relational read inspection, ordering and projection likewise share one
   bounded synchronous fold after selection settles. Original per-row
   validators, error mapping, inspection/projection order, resource charges,
   immutable outputs and the outer named diagnostic operations remain.
   Storage, hashes, timestamps, admission, lifetime/cancellation ownership,
   uniqueness and immediate write validation remain at their existing boundaries.
2. Current-index demand-vector grouping decodes each ordinal/presence envelope
   once and owns its immutable scalar presence record. Raw bodies stay private
   and are decoded at their original demand/row ordinal. All batch-wide
   structural envelope checks still precede consumers; missing ordinals,
   semantic false presence, duplicate empty witnesses, row bounds, body/digest
   validation and consumer refusal retain their original order. No stored
   result, membership verdict or fresh authority is cached across calls.

The scalar capture intentionally makes already accepted envelope facts
independent of later mutation of a scripted driver's row alias. Consumers
receive immutable pages, never the envelope or raw driver rows. Body validation
still uses the original body at consumption; this change does not assert that
the complete raw row is immutable.

## Correctness witnesses and broader validation limit

New witnesses exercise actual working-set input validation before a storage
refusal, duplicate mutation keys, scalar envelope ownership under alias
mutation, malformed/unrequested/missing ordinals, duplicate empty witnesses,
semantic false presence, a first consumer refusal before a later defective
body getter, and the original getter defect Cause when that body is consumed.
Existing owner tests retain range/cursor/negative dependencies, fresh OCC,
budgets, rollback and earlier RETURNING corruption before a later write failure.

The broader Medusa suites exposed an existing readiness fixture defect:
`logicalSchemaBindingScenario` and `logicalSourceReadSelectionScenario`
changed an enabled index to validating while retaining enabled maintenance
pointers. Constraint `fx_system_index_build_maintenance_check` correctly refused
that invalid fixture state before the new runtime blocks were reached. The
original `67882abd2` runtime and original fixture sources reproduce the same
PGlite refusal in `baseline-regression.log`. A local exploratory fixture repair
exposed another cold-recovery refusal (`IndexMaintenanceError/storedState`) when
the suite deletes catalog unique-set evidence. That correction is outside this
CPU scope; all exploratory fixture edits were restored. Neither failure is
claimed fixed, and these broader Medusa suites are not claimed green. Focused
owner/consumer regressions and complete matched native/Flarex workflow proofs
provide this change's validation. Schema, constraints, production readiness and
all existing expected refusal assertions remain unchanged.

## Measurement protocol

Each change receives two sequential 40-pair processes, using the original SDK
root thread/process CPU readings and complete matched native business graphs.
Four-pair ABBA blocks in one process and BAAB blocks in the other balance local
drift; both variants receive warmups. Change 1 compares its two generator bodies
with their exact baseline bodies. Change 2 compares envelope consumption with
its exact baseline body while change 1 stays enabled. Test-only Vite transforms
select the variant before the original root counter begins, with no diagnostic
collector, inspector or forwarding engine in the measured requests.

Baseline file snapshots were byte-normalization checked against `67882abd2`.
AST manifests retain original/baseline/transformed hashes and selected bodies.
The final 40-pair control uses the authored current source without transforms.
Source/settings gates, request results, complete business graphs, durable proofs
and cleanup must pass. Positive before-minus-after paired mean denotes CPU
reduction; 95% intervals use a stratified 20,000-draw four-pair block bootstrap,
seed 137. Dropping the first block in each process is reported as warm sensitivity.
Windows thread CPU counters are coarse; small savings may remain unresolved.

## Measured CPU

**Neither change demonstrates a CPU saving.** These are actual complete-root
paired CPU readings, not SQL elapsed time or construction-profile estimates.

| Change | Before added thread CPU mean | After mean | Estimated reduction | 95% interval for reduction |
| --- | ---: | ---: | ---: | --- |
| 1. Bounded relational validation folds | 113.325 ms | 118.000 ms | **-4.675 ms** | -16.350 to +7.526 ms |
| 2. One captured batch envelope | 103.425 ms | 109.350 ms | **-5.925 ms** | -17.150 to +7.275 ms |

A negative reduction means more CPU. Both intervals include zero and both
possible directions. The change 1 median is 110 ms in both variants; change 2
medians are 109 and 109.5 ms. Whole-process estimates are -5.775 ms for change 1
(interval -24.000 to +10.551), and +2.675 ms for change 2 (interval -17.200 to
+29.551). Warm-sensitivity results also include zero. No samples are discarded
as outliers; the full process-counter spread is retained in `summary.json`.

The final **untransformed authored-source control** measures **109 ms median
added thread CPU**, **107.325 ms mean** across 40 matched pairs. Mean native CPU
is 25.025 ms and mean Flarex CPU 132.350 ms. Whole-process added CPU is 129.800 ms
mean and 109.5 ms median. Windows counter quantization explains zero readings
for some short native calls; those readings do not mean the native call did no
work. The earlier separate control's 125 ms median is historical. The difference
between independently timed controls cannot be attributed to these changes:
the controlled separate comparisons establish no reduction.

| Retained process | Run ID |
| --- | --- |
| Composition A, original envelope fixed | 56891b95-ffcb-4bb5-b996-c07bda48a692 |
| Composition B, reversed order | fd8a20f2-9dfd-4de2-9d1c-9348fd057ff2 |
| Envelope A, composition enabled | d41abb4d-dc52-4d60-9f67-978eeeb850e9 |
| Envelope B, reversed order | 9fcb759b-25e4-4b5c-8ef1-9bc4556d5b57 |
| Final authored-source control | 28484641-671b-4fdd-9a99-2692fd376ae3 |

All 200 retained pairs completed with successful request/business results,
stored proofs, settings/source gates and cleanup. All five runs retain the same
6,962-file authored-source inventory hash before/after:
`6cd1be23ec5f03acc550dba61d79b1f4e57e9d1680c5f5eba93fa10363d2cb76`.
The initial 40-pair composition pilot held the envelope change enabled in both
variants. It is excluded from the statistics and was replaced by the two
correctly isolated runs; its ledger remains in `composition-a/`.

This is SDK `root-counters` evidence, with performance acceptance deliberately
not evaluated. It does not establish whole-harness performance acceptance,
Workerd/Cloudflare performance, deployment readiness, or scale. Removal of
private composition and a duplicate envelope parse is implemented; removal of
the large CPU excess is **not proved**.

## Validation and handoff

Focused PGlite and ordinary-role PostgreSQL index, working-set, and row-write
regressions pass. New mutation-order witnesses also pass against the original
working-set implementation on both drivers. Current-envelope ownership,
failure-order and getter-defect witnesses pass on both drivers. The original
same-page row/index RETURNING corruption-before-later-trigger scenario also
passes on both drivers through `returning-barrier.config.ts` (2 tests); the
scenario itself is unchanged. Persistence,
executor and Medusa adapter typechecks, core/diff lint, the Effect runtime
boundary guard and the Medusa source-island guard pass. Broad Medusa readiness
suites retain the separately identified baseline fixture blocker above; they
are not represented as passing validation for this patch.

Owned PostgreSQL ran as `flarex_cpu_fixture`, without superuser privileges, with
fsync, synchronous_commit and full_page_writes on, duration/plan logging off.
After campaigns it had zero other client backends. The owned data directory was
resolved inside this checkout before fast shutdown; pg_ctl reports no server
and port 56434 has zero listeners. No owned Workerd/Wrangler process was started.
Unrelated Workerd test edits and `.codex-worktrees/` remain untouched. Ignored
scaffolding, snapshots, AST manifests, assignments and raw ledgers are preserved
locally for reproduction, rather than becoming production benchmark switches.

Both required read-only TypeScript/Effect and systems reviews found no
actionable defect. The folds remove intermediate cooperative scheduling points
inside bounded synchronous work; outer interruption, deadlines, failure
latching and cleanup remain enforced. Cancellation responsiveness within those
synchronous segments was not empirically measured, so identical scheduling or
cancellation latency is not claimed. Exact-index diff lint and whitespace
checks must pass before commit.
