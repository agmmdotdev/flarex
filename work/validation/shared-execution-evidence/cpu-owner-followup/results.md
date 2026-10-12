# Remaining mixed-workflow CPU: current owner attribution and design options

Runtime code is unchanged by this investigation. The excess is repeated active
client work in guarded logical business execution, with additional admission and
publication. The strongest next design target is the connected logical
read/capture path. No measured owner envelope is a proven saving.

## Current measurements

Two independent counters-only processes each run 15 alternating complete
native/Flarex pairs, after five warmups per lane. Across those 30 pairs, added
thread CPU is **125 ms median / 131.1 ms mean**, range 78–233 ms. The first block
is 156 ms median / 154 ms mean; the final repeat is 95 ms median / 108.2 ms mean.
That between-process variation is real in the retained counters but its cause is
unresolved. Source stability does not establish host, JIT or scheduling stability;
do not assign the change to any one of them. Lane medians are native 31 ms and
Flarex 156.5 ms; paired differences are aggregated separately. Final paired
statistics and actual pairs are in `receipt.json`. Keep this cohort separate from the earlier
110 ms control and 109 ms retained relation-hoist cohort. No optimization was
applied between the two new controls.

Four separate diagnostic processes retain another 62 matched pairs: ten paired
profiles; twenty broad synchronous-timer pairs; sixteen focused timer pairs; and
sixteen selected-owner counter pairs. Each numeric timer/owner cohort alternates
observer-on/off blocks. The facade and inactive wrapper paths remain in its off
lane; it is not a counter-only control. All six processes retain the same SDK
source digest, 6,962 inventoried files, successful requests, unchanged durable
settings and completed cleanup.

Detailed timers add material overhead. Broad observed/off paired added CPU means
are 201.3/135.9 ms; focused means 177.75/128.75 ms; selected-owner means
156.625/138.5 ms. These are calibrations inside their respective processes.
Neither their differences nor an observer-bearing duration predicts a runtime
saving. Windows thread counters resolve about 15–16 ms, so short-owner sums can
vary greatly even when their call counts and elapsed envelopes are stable.

## What owns the CPU

The unmodified-code paired-profile cohort retains these full Flarex phase CPU
medians. They include required work and are not native-subtracted excess:

| Existing phase | Median thread CPU |
| --- | ---: |
| Admission | 16 ms |
| Portable guarded business execution | 117 ms |
| Authoritative publication | 32 ms |
| Result validation, finite freeze, cleanup | Below the observed counter quantum individually |

Every root's phase counter sum matches its complete root counter. Phase medians
need not sum to the median complete call. Without profiles or numeric sync
timers, the detailed probe's off lane still spends 112.6 ms mean CPU in business
execution; the selected-owner off lane spends 119.125 ms. Business execution is
the dominant phase across these separate diagnostic cohorts.

After original-call boundary filtering, ten Flarex profiles contain 1,083
non-idle terminal self samples: Effect 345 (31.9%), logical persistence 246
(22.7%), protocol/value 130 (12.0%), Node 85, Drizzle 56, Medusa 54, pg 43, GC 26,
and explicit other/program/remaining locations. These locate executing stacks;
they are not percentages of the historical excess or removable CPU. Native's
matched profiles execute the independently committed native business graph.
Do not charge inclusive application work to a generic Effect ancestor.
GC overlaps a median 3.14 ms, range 2.36–4.13 ms, in the Flarex profile roots.
It is not a dominant explanation in this cohort.

Selected-owner counters narrow the business path. Each observed workflow runs
43 relational selections, seven provisional relational changes and 38 finite
storage captures. Their observed mean/median summed CPU is respectively
48.625/47 ms, 25.625/31 ms and 36.875/46 ms. These owners overlap: captures sit
inside reads and writes, and mutation reads sit inside changes. **Do not add
these rows.** Twenty-five captures are completely inside relational selections
in every observed root. After subtracting only those enclosed captures, the
per-root relational-read remainder is 23.375 ms mean / 30.5 ms median, range
0–47 ms. This is a quantized observer-bearing envelope containing required
query, dependency, pending-state and returned-row work, not exclusive avoidable
orchestration. Same-name span non-overlap was checked before summation.

The native graph provides the same business result through independently
committed calls. Flarex additionally supplies provisional writes, exact
dependencies/OCC, revision/history effects, atomic settlement and durable
outcomes. Those obligations account for real additional work; the native
baseline does not authorize their deletion. The measured excess is accumulated
processing, not a reclassified PostgreSQL await. The historical 172 ms pricing
wait remains a separate unresolved elapsed-time observation.

## Specific repeated work and rejected explanations

The synchronous probes retain these stable counts per complete Flarex workflow:

| Mechanism | Count | Observed synchronous envelope |
| --- | ---: | --- |
| Effect interpreter loop operations | 36,288 across 826 chunks | Loop remainder includes untimed business/driver work; not exclusive interpreter CPU |
| Effect continuation/context operations | 12,826 / 3,629 | Broad combined timer self envelope about 7.3 ms |
| Authored Effect invocation/construction | Many named and primitive calls | Broad timer self envelope 14.45 ms; includes hooks |
| Result generators | 1,768; 5,507 next calls | Focused bookkeeping 5.79 ms; body remainder 19.62 ms includes untimed validation |
| Private JSON capture | 478 | Focused capture self envelope about 8.7 ms |
| Root metadata consumption | 899 | Whole synchronous broad envelope about 7.19 ms; includes child checks |
| Cached metadata observation comparison / new capture | 694 / 207 | Existing reuse already operates; they are not 899 full decoder passes |
| Selected Result/Sync decoder factories during requests | Small | Focused total about 0.03 ms; repeated compilation is not established as the problem |
| Selected synchronous Result/Sync schema parsing | Multiple existing decoders | Focused timer self envelope about 11.6 ms |
| structuredClone | 315 | Focused total about 4.15 ms |

Effect-returning schema decoders are outside those selected synchronous schema
timers; their work remains in the other measured owners and loop remainder.
The broad Result.gen 22 ms self envelope included application/validation work
inside generator.next. The focused probe brackets those next calls separately;
it does not establish 22 ms of removable Result machinery. Both experiments
preserve the installed Result implementation and its short-circuiting.

Canonical JSON's 5,741 encode calls include recursive nodes, not 5,741 independent
whole-document serializations. The focused timer excludes recursive self-hook
nesting. Do not infer duplicate documents from that count. Private capture sees
428 distinct object identities: only 30 repeat, at most five times. Top-level
paths are 331 not-yet-issued inputs through the trusted handoff, 42 through full
capture, 100 already-issued handoffs, and five already-issued full captures.
Fresh wrappers and required foreign capture are not interchangeable with a
cache hit, and identity repetition alone does not establish safe reuse.

Copy-site attribution also rejects a broad copying remedy. Protocol snapshot
detachment makes 121 clones in about 0.77 ms; root graph detachment makes eight
top-level clones in about 0.68 ms; workflow value capture makes 42 clones in
about 0.53 ms. The complete 42 workflow-value Effect operations total about
4.13 ms observed elapsed. Logical working-set construction (seven instances)
totals about 0.37 ms; immutable source-acceptance preparation about 0.36 ms.
These are small envelopes, not the large remaining CPU block.

## Designs to discuss before implementation

**A bounded capture correction: consolidate client acceptance at its existing
owner.** `execution/finiteStorageCapture.ts` already reuses fixed SQL shapes and
binds fresh scalars on every checkout. Its returned header is still consumed
through several Effect schema decoders and conversions: reason, database time,
serving sequence and retention floor, followed by epoch/layout/operation checks.
Prepare the existing authoritative Schema Result decoders once, perform one
ordered pure header acceptance, and enter Effect once for that verdict. Keep
the original attempt-replacement and retirement branch positions, raw-row layout
refusal, timestamp/sequence checks, authority and metadata comparisons. Do not
move fresh SQL authorization to the client, transfer unseen bodies early, or
retain an accepted header between captures. This targets repeated small
interpretation steps in a measured hot owner; the 38-capture envelope is not
its predicted saving. The actual dispatch allocation saved must be measured.

**The connected read correction: continue prepared queries through the trusted read path.**
`logicalDocuments/workingSet.ts` recaptures each query wrapper, compiles it and
consumes access metadata before selecting current/pending rows. It already
retains query preparation when the exact read preparation is supplied. Preserve
that owner and extend the actual trusted adapter handoff to carry its issued
immutable query interpretation instead of rebuilding and decoding a known
synthetic predicate/order envelope. Foreign queries still undergo complete
descriptor/bounds/schema validation at their original frontier. Every execution
still charges its original budget, consumes live metadata evidence, observes
the exact snapshot/index membership and pending overlays, validates returned
rows, and applies the original predicate/projection/ordering. No new validator,
result cache, serving verdict or generic transaction interface is warranted.
The existing 43 compile operations total about 7.07 ms observed elapsed; this
proposal must not be sold as a 100 ms fix. The larger read path remains the
connected measurement boundary for checking whether the handoff also reduces
downstream interpretation.

Prioritize the connected read path for the larger CPU investigation; the capture
acceptor is a smaller independently measurable part of it. These are bounded
experiments supported by an identified hot path, not proof of a large removable
block. Several small savings still would not establish full performance
acceptance. Measure the direct accepting substeps before implementing either
proposal if their exact repetition/removal frontier remains uncertain.

Both proposals stay inside the current persistence/read owners. Keep named
observable boundaries and real framework Promise runner lifetimes; only purely
synchronous internal verdict composition is a candidate to consolidate. Neither
a broad Effect rewrite nor further helper-definition hoists is supported as
the next performance deliverable. No row-integrity comparison, storage demand,
metadata freshness check, immediate RETURNING barrier or stored publication
proof is approved for removal. The previous safe row shortcut regressed and
remains removed.

Before either runtime experiment: preserve malformed/later-input and stored-body
failure winners, empty/cursor/lookahead evidence, budget first crossing, mutable
buffer/getter/Proxy behavior, exact dependencies and pending-state visibility;
prove cancellation/rollback and concurrent metadata/storage changes on PGlite
and ordinary-role PostgreSQL; run affected consumers, strict/lint/source checks
and both project reviewers; then compare each candidate separately with complete
matched native roots and source-stable counter-only measurements. Retain the
existing full CPU and quiet-latency gates. No savings are established yet.

## Provenance, diagnostic limits and cleanup

Work stayed in the current checkout; no worktree was created. Initial HEAD was
`79867dc39`; a peer committed the already-present OCC work during this
investigation. SDK source bytes remained stable across the processes despite
the Git/status change. Existing unrelated runtime and test changes were not
edited. Diagnostic transforms/facades and raw SDK reports remain local artifacts
under this directory. `receipt.json` retains run IDs, actual pairs, source and
durability gates, selected owner summaries and artifact locations.

The numeric probes change diagnostic overhead and some diagnostic stack
locations; no check or database operation is removed. No instrumentation is
installed in production files. Inspector acquisition/release and clock landmarks
stay outside original CPU windows. Profile alignment uncertainty is 0.487 ms;
only samples inside the original call for every admitted offset are retained.
Async ancestry is not invented. The two diagnostic initialization failures
(TypeScript 7 lacks the AST API; clone hook absent during module initialization)
occurred before business tests and are retained. The corrected probes reuse the
installed TypeScript 6 API and forward startup clones without a hook.

Ordinary PostgreSQL uses the owned investigation data directory on port 56434,
with fsync, full-page writes and synchronous commit enabled. SQL duration logs,
auto-explain and statement statistics are disabled for these CPU campaigns.
PostgreSQL server CPU is excluded. Same-isolate background work, coarse Windows
counters, external contention, observer cost and one local small graph limit
interpretation. This does not establish Cloudflare performance, all-five-graph
acceptance, or an exact exclusive partition of the historical 125 ms.

The owned PostgreSQL fixture is stopped at handoff; no unrelated process or
database is stopped. Runtime redesign remains for discussion, not implemented.
