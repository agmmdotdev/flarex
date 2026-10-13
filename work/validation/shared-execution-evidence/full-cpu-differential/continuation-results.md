# Promise continuations, GC and observer cost

Diagnostic investigation against `56b5d45e5`, current checkout. No authored
production/runtime, SQL, business-check, failure-order or worktree changes.

## Result and removal decision

**Observed Promise-reaction work and main-thread GC are small parts of command
launch/completion. The detailed observer itself has a substantial measured
cost. No large safely removable runtime component is established.**

Four fresh processes ran 40 alternating complete native/Flarex pairs each,
after five warmups per lane: plain A, detailed A, detailed B, plain B. Plain
runs install no Promise hooks. Detailed runs alternate five-pair detail on/off
blocks, with opposite ABBA/BAAB ordering. Every workflow still launches the same
38 checked commands. All business workload gates and cleanup passed.

The following disjoint shares use each detailed command's original **thread
cycles** as denominator, including the measured observer work:

| Execution owner | Detailed A | Detailed B |
| --- | ---: | ---: |
| Driver preparation/send/receive/checked mapping | 42.94% | 43.39% |
| Effect execution, excluding named nested scopes | 12.51% | 12.77% |
| Explicit Promise bridge/fence/tracking callbacks | 5.67% | 5.60% |
| Promise reactions, excluding those named nested scopes | **2.52%** | **2.60%** |
| Main-thread GC callback intervals | **0.93%** | **1.67%** |
| Directly measured observer bookkeeping | **23.67%** | **21.83%** |
| Outside selected synchronous boundaries | **11.76%** | **12.14%** |

The independently measured GC share in plain runs is **5.98% / 3.62%** (10 / 6
collections across their 40 workflows). Detailed observed blocks contain only
1 / 2 collections across 20 workflows each. These sparse events cannot prove
that instrumentation reduces GC. They also do not establish a dominant GC cost
in this command stage. Collections elsewhere in the request are outside this
measurement, as is background GC worker CPU.

This is a fresh partition, not a direct subtraction from the previous probe's
19–36% residual: the instruments differ. It proves that the current detailed
instrument has a material, directly timed bookkeeping component. The old
residual cannot all be retroactively reassigned to that component.

### What the Promise reactions do

There are exactly **nine observed reactions per command, 342 per workflow**:

| Creation context of the reacting Promise | Reactions/workflow | Exclusive command-cycle share A / B |
| --- | ---: | ---: |
| Drizzle execute launch | 152 | 1.298% / 1.310% |
| node-postgres query launch | 38 | 0.258% / 0.281% |
| Pending-work registration | 76 | 0.599% / 0.624% |
| Another reaction | 38 | 0.225% / 0.245% |
| Effect/Promise bridge start | 38 | 0.138% / 0.143% |

Origin is captured by the V8 init hook from the current named execution scope;
it is not a function-level creation stack or proof that a reaction is redundant.
The before/after hooks bracket actual reaction execution, and nested driver,
mapper, tracker and Effect execution is charged to its own scope exactly once.
The remaining reaction bucket includes continuation/application instructions
and VM machinery inside those hook boundaries. It is **not pure Promise-engine
CPU**. VM dispatch outside the hooks remains in the outside bucket.

The installed Drizzle `NodePgPreparedQuery.execute` and
`PgPreparedQuery.queryWithCache` execute multiple async forwards. The latter
also wraps driver failure as `DrizzleQueryError`; the former consumes the result
through the checked mapper. The two pending-work mirrors retain distinct raw
driver and mapped-result failure evidence. Required first-failure retention,
closed work fences, deadline/interruption handling and drain-before-release
still apply.

**Removal assessment:**

- Exclude measured probe bookkeeping from attributed application execution.
  That is an accounting correction for diagnostic runs. These probes are
  already absent from the quiet runtime baseline, so it saves none of its CPU.
- Collapsing Drizzle async forwards is a possible narrowly scoped experiment,
  but the observed exclusive Drizzle-origin reaction body is only about 1.3%
  of command cycles. That is neither the total cost of those Promises nor a
  forecast saving. No behavior-equivalent replacement was implemented or priced.
  Do not replace required error wrapping or result validation with raw driver
  calls, or drop the two failure observations.
- No GC-driven redesign is selected. The study measures when GC runs, not which
  allocations caused it. It cannot identify safely removable allocations from
  a collection's timing alone.
- The remaining roughly 12% can include Node event dispatch, VM job dispatch,
  unobserved native/JS continuations and unmeasured probe dispatch/allocation.
  No additional runtime deletion is supported by that unresolved bucket.

**Actual runtime CPU reduction: zero.** The untouched matched baseline remains
106.9625 ms mean added CPU. This study does not explain all 107 ms and does not
replace that baseline with a new instrumented figure.

## Observer cost and limits

The observer reuses the SDK's existing telescoping cycle partition with a
virtual counter:

`execution counter = native thread cycles - cumulative GC cycles - measured probe-body cycles`

Bookkeeping pauses the virtual clock at its first snapshot, executes its own
counter/stack/WeakMap work, then charges the elapsed cycles to the observer.
GC during bookkeeping is subtracted from that charge and counted as GC once.
For every command the reducer requires:

`raw command cycles = execution buckets + GC cycles + measured probe-body cycles`

This measures a **subset of total observer overhead**. Native snapshot-call
edges, wrapper/argument allocation outside brackets, hook dispatch, changed JIT
behavior, command-finalization serialization and later GC consequences are not
fully priced by the observer-body bucket. GC callbacks themselves have a small
uncalibrated entry/exit cost and may enclose other synchronous GC callbacks.
There is no claim of a completely de-instrumented cost table.

| Whole SDK request, mean thread CPU | Flarex | Native |
| --- | ---: | ---: |
| Plain A, no Promise hooks | 146.875 ms | 31.225 ms |
| Detailed A, detail off / on | 160.000 / 150.050 ms | 37.450 / 36.650 ms |
| Detailed B, detail off / on | 193.000 / 169.750 ms | 42.200 / 36.750 ms |
| Plain B, no Promise hooks | 164.400 ms | 28.800 ms |

The mean across full detailed processes is 168.200 ms Flarex versus 155.6375 ms
across the plain processes; native means also differ (38.2625 versus 30.0125 ms).
Order/process variation and even negative within-process on/off deltas prevent
calling the 12.5625 ms difference a causal probe price or CPU saving. The controls
expose perturbation; they do not supply a stable correction factor.

Fine Windows thread-time edges remain too coarse for accepted leaf-ms prices.
No cycles are converted to milliseconds, no elapsed GC time is labelled CPU,
and no sampled stack gaps are assigned to continuations.

## Reproduction and preservation

Use the existing measurement harness with `continuation-profile.config.ts`,
ordinary PostgreSQL fixture role, attribution `control`, 40 samples and fresh
report directories. Run `FLAREX_CONTINUATION_MODE=plain` then `detailed` with
`FLAREX_LAUNCH_ORDER=abba`, followed by detailed then plain with order `baab`.
`continuation-costs.config.ts` reduces and validates the retained inputs.
`FLAREX_PROFILE_CONTINUATION_CORRELATION=on node work/validation/shared-execution-evidence/full-cpu-differential/retain.mjs`
creates lossless gzip files and the SHA-256 manifest.

The earlier launch AST transform and installed prototype wrappers are reused;
only their diagnostic observer factory is substituted. Preparation replay is
omitted. Promise hooks observe rather than replace Promises or add `.then`
handlers. Synchronous receivers, arguments, original returns/throws and full
Effect Exit/Cause remain forwarded. Diagnostic counter/ABI failure invalidates
the measurement; it is not a valid alternate business result. The native GC
probe is operator-only and is documented in `continuation-native/README.md`.
Its pinned Node headers, binary and source provenance are separate from runtime
packages. Source hashes are stable across all four captures:
`538fc3029841137484c694a534f93ca9e295add368ca4c55681d8713904d0d68`.

The reducer validates 160 matched pairs / 320 roots / 6,080 commands, exact
cycle conservation and counter domains, unique command/window joins, source
stability, opposite observation orders, 38 commands per Flarex workflow and
zero per native workflow, and exactly nine categorized reactions in each
observed command. The four-pair preflight smoke is excluded.

Validation: four observer tests (including actual V8 hooks with a rejecting
Promise and no later work), native forced-GC/disable/argument tests, strict
retained-evidence reducer and diagnostic TypeScript check pass. The existing
physical-session suite with the transforms and hooks passes 41 tests with one
TLS-specific case skipped. It has no SDK operation roots, so active attribution
during real database failure/cancellation is not covered; active synthetic
Promise rejection and full Cause forwarding are covered separately. Core/diff
lint passes. No new schema, isolation or query-plan claim; PGlite was not rerun.
Owned PostgreSQL is stopped. No forced GC or competing heavy tests/reviews ran
during accepted performance campaigns.
