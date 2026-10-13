# Repetition within relational reads and finite storage capture

Investigation against `313da4670`, current checkout. Production runtime, SQL,
business checks and failure order are unchanged; no new worktree.

The question is which part of the previously observed 45 ms read/capture family
repeats equivalent work and what that work costs. A repeated invocation of a
live authority check is not automatically a repeated pure computation.

## Result

**The proven duplicate pure preparation is small: about 0.3 ms of warm batch
CPU per workflow. No large removable part of the 45 ms is established.**

| Pure preparation within the read/capture family | Calls / workflow | Repeated equivalent inputs | Warm replay CPU for repeats / workflow |
| --- | ---: | ---: | ---: |
| Relational query preparation | 39 | 5 | 0.110–0.141 ms |
| Ordered index bounds compilation | 43 | 28 | 0.156–0.172 ms |

The replay lists contain precisely the repeated family calls, not the additional
bounds work performed during writes. Five blocks in each of two processes give
summed median list costs of 0.297 and 0.281 ms. In live roots, the corresponding
synchronous elapsed totals were 0.78–0.85 ms; elapsed is not thread CPU and may
include descheduling. Warm replay is not a hard upper bound on live cost.

The 43 selection executions call the query preparer 39 times: existing program
retention already skips four preparations. The additional five equal queries
and 28 equal bounds are concrete candidates for bounded private preparation
reuse, subject to the constraints below. Their cost does not justify presenting
query compilation as the dominant cause of the read budget or promising a root
saving. Runtime CPU reduced by this investigation: **none; runtime unchanged**.

Storage-input evidence is also specific: all **26 index snapshot preparations**
and **eight row snapshot preparations** have distinct semantic keys per workflow.
There is no exact duplicate among these 34 inputs. This is not proof of no
overlapping rows, and it does not classify the other four capture operations.
It provides no basis for dropping or merging checked database calls.

Other repeated invocation counts do not establish redundant work:

| Owner | Calls / workflow | Repeated argument keys | What executes |
| --- | ---: | ---: | --- |
| Attempt storage basis | 38 | 37 | Existing issuer lookup and retained basis reuse |
| Root metadata consumption | 559 | 350 | Live root/issuer checks and recording; first consumption is already retained |
| Private JSON handoff | 115 | 17 | Existing issued-value reuse with current budget/policy checks |
| Checked-out connection wrapper | 38 | 37 | Fresh pending-work tracking, fences, listeners and release state for each checkout |

Only 143 metadata dependency captures execute within selection; none repeats its
argument key. Repeated metadata consumption is not 559 complete schema decodes.
Same client/config arguments cannot justify retaining a previous checkout's
mutable tracking state. These stateful operations are deliberately not replayed.

## Where the larger observed cost remains

The stable cycle ranking places the largest disjoint residuals in candidate
selection/frontier consumption and physical command execution. These are not
pure compiler costs. Candidate processing includes unique/index lookup,
dependency and pending-row handling, borrowed-frontier continuation and related
Effect work; command execution includes acquisition, deadline/cancellation
ownership, driver/protocol/result mapping and settlement.

| Disjoint scope | Thread-cycle share, B / C | Observed thread CPU, B / C |
| --- | ---: | ---: |
| Candidate selection inside reads, excluding observed children | 9.02% / 9.17% | 14.900 / 14.150 ms |
| Physical command, excluding observed checkout/capability functions | 9.02% / 8.44% | 19.925 / 14.825 ms |
| Query compilation orchestration, excluding observed children | 4.99% / 5.13% | 6.275 / 7.825 ms |
| Transport capability check | 1.82% / 1.64% | 5.125 / 3.100 ms |

The transport check constructs a cancellation `Client` on each of 38 calls, but
also checks the current connection's SSL, authenticated cancellation identity,
configuration and startup timeout/options. This measures the whole check, not
the isolated constructor or a safely removable fraction. No constructor-only
CPU saving is claimed.

These fine-probe scopes are **not a calibrated partition of the original 45 ms**.
In these captures, total Flarex CPU is 175.100 / 166.300 ms and native is
29.325 / 24.250 ms. The fine read/capture totals are 70.650 / 63.250 ms. Observer
work and process variation are not separately estimated. Small scopes show
counter aliasing: live bounds CPU is 0.800 / 3.125 ms despite elapsed totals of
0.845 / 0.766 ms. This rules out treating individual coarse counter increments
as precise function timers; the retained cycles and warm replay avoid that claim.
The earlier uninstrumented added mean remains 106.9625 ms, not these probe totals.

The current evidence supports measuring candidate/frontier and driver lifecycle
work further if seeking a large reduction. It does not select another redesign,
remove authority checks, or call all remaining work necessary/irreducible.

## Measurement and proof boundaries

The existing complete native/Flarex SDK harness executes two fresh processes,
40 alternating matched pairs per process, after five warmups per lane. Both use
original SDK thread CPU counters and the existing Windows thread-cycle reader,
with V8 profiling disabled. Existing profiles selected the investigation sites.

Opt-in test transforms bracket the original synchronous functions, preserving
argument evaluation, return values and thrown identity. Existing operation
brackets split finite capture's command and header acceptance. Every original
business expression still executes. No duplicate is skipped or replaced.

The identity ledger establishes exact table, capability, page-limit, error-owner
and mechanics identity plus captured query contents for query preparation.
Bounds keys preserve the full validated specification and ordered expressions.
Index snapshot keys retain exact definition identity, scope, snapshot, bounds,
cursor and limit; catalog timestamps are excluded. Row snapshot keys retain the
actual scope, table, ordered row list and snapshot. Keys are computed after
successful preparation. Same bytes do not confer authority or prove freshness.

Both reducers use the existing strict operation partitioner. Family buckets
assign each exclusive interval to its nearest read-selection or capture ancestor;
nested captures are not charged to selection again. Repetition is counted only
inside those families and resets for each root. Selected pure replay items join
back to their exact root, interval ordinal and key.

After all live workflows and cleanup settle, the observer retains the last
Flarex root's repeated pure query/bounds preparations. Each of five replay blocks
runs that exact list 2,000 times. Thread CPU divided by 2,000 prices one workflow's
list. The original functions execute, with all their checks. No SQL or live
authority operation is replayed. Query demand and bounds output are compared
before and after replay; query compiler/access/inspection equivalence is not
established by that comparison.

Replay is warm batch cost, including loop/call overhead and inactive nested
diagnostic forwarding. It is neither saved request CPU nor a subtraction from
the original 45 ms. It does not include future reuse-key construction, retention,
budget charges or guard costs. No cycle-to-millisecond conversion is used.

## Correctness constraints on any future reuse

Query preparation validates table mechanics, envelope, fields, ordering, limits
and recursive predicate shape before consuming access metadata. The existing
find/count program already retains preparation for repeated execution of that
program. Any broader private retention must remain scoped to its immutable
table/capability/mechanics owner, bounded and charged, and consume current access
metadata at the original point. Fresh foreign inputs still require their original
capture and validation; equal serialized content is not permission to bypass it.

Bounds compilation validates specification, expression array shape, field order,
range values and encoded size. A private prepared selection could reuse successful
interpretation only after preserving those admission obligations and exact range,
cursor, snapshot, membership and budget semantics. Public caller-owned mutable
inputs cannot become a content-keyed bypass.

The root already retains first metadata consumption and index/row observations.
Repeated metadata consumers still check mutable root closure and genuine issuer
observations. Finite captures still authenticate the current execution claim,
snapshot, storage generation, metadata epoch, readiness and result layout. The
error order is observable: replacing these with one earlier check is not justified
by identical parameters. No authority or returned-result cache is proposed.

## Limits and reproduction

Fine diagnostic instrumentation increases request work and changes JIT/allocation
behavior. Its totals must not replace the earlier uninstrumented native-relative
baseline. Small Windows thread-CPU increments are quantized; individual zero
increments do not prove zero work. Cycles independently rank the measured scopes,
while synchronous elapsed measurements may include descheduling. Warm replay is
the separate, explicitly bounded measurement of repeated pure preparation.
Interval CPU can include other same-thread continuations; an enclosing residual
is not a leaf-function timer or proof of pure Effect/driver overhead.

Only the complete small mixed-workflow fixture is covered. There is no new
deployment, scale, query-plan or isolation claim. PGlite behavior is unchanged;
these diagnostic captures use the ordinary PostgreSQL fixture role and separate
provisioning role. Exploratory `read-smoke`, `read-a` and `read-final-a` captures
precede the final source checkpoint and are excluded from final results.

Capture with the existing attribution integration test, `FLAREX_MEASUREMENT_ATTRIBUTION=control`,
`FLAREX_MEASUREMENT_SAMPLES=40`, a fresh report directory and `read-profile.config.ts`.
Replay retained evidence with:

```powershell
pnpm exec vitest run --config work/validation/shared-execution-evidence/full-cpu-differential/read-analysis.config.ts
pnpm exec tsc -p work/validation/shared-execution-evidence/full-cpu-differential/tsconfig.json --noEmit
```

Final run IDs: B `6c924f51-c4eb-4054-a136-0dda7c9bc1d2`, C
`8fb5f994-beb1-44ce-9b00-24e3a08da624`. Both share authored-source hash
`538fc3029841137484c694a534f93ca9e295add368ca4c55681d8713904d0d68`, matching the
earlier baseline. Instrumentation inventories, transformed-source inventories
and native reader hashes agree across both cohorts. `read-artifacts.json`
records lossless gzip artifacts and hashes; `read-costs.json.gz` retains joins,
partitions, call facts and replay blocks.

Both 40-pair campaigns passed all business/cleanup gates. Four diagnostic replay
and forwarding tests passed, including original typed failures/defects and
snapshot definition identity with a catalog Date. PostgreSQL was stopped;
`pg_ctl status` confirmed no server running.
Historical operation replay's five tests, diagnostic typecheck and core/diff lint
passed. Both required read-only reviewers independently verified archive hashes,
root/interval/fact joins, repetition counts and report arithmetic; neither has
remaining findings. TypeScript review also regenerated all 17 transformed source
files and 45 call sites against captured hashes.
