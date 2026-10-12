# Remaining mixed-workflow CPU: deeper attribution and quiet-policy experiment

Production source is unchanged. This investigation establishes recurring client
processing, finds a concrete diagnostic-policy gap in the fixture, and narrows
the next design target. It does **not** establish an exclusive explanation for
every millisecond of the excess or a large safe removable block.

The fresh untouched controls measure **140 ms median / 133.7 ms mean added
thread CPU** across 30 complete native/Flarex pairs. The earlier **125 ms median**
belongs to the previous cohort; it is not a fixed current value. Most of the
fresh mean difference is user-mode processing: **128.53 ms user / 5.17 ms
kernel**. A pricing await or ordinary wall-clock pause is not counted as added
thread CPU. The historical 172 ms pricing wait remains a separate unresolved
elapsed-time observation.

The main newly identified work is 4,800 selected Schema invocations, 893 named
Effect function Error constructions, and 824 ordinary span objects observed per
workflow. The first two have small distributed elapsed envelopes. Suppressing
ordinary spans through the existing quiet-default owner removes most ordinary
span objects, but its complete-root CPU comparison does not demonstrate a
reliable saving. There is still no evidence for a single removable 100 ms owner.

## Current counters and where execution lands

Two independent untouched counter processes each run 15 complete paired roots,
after five warmups per lane. The first added CPU mean/median is 130.93/140 ms;
the final repeat is 136.47/141 ms. Pooled paired differences are 133.7/140 ms,
range 78–187 ms. These are actual per-request Flarex-minus-native differences,
not subtraction of independently aggregated lane medians.

One intermediate control is excluded in full because a local CPU summary
calculation overlapped it. That attempt remains local and is replaced by the
final untouched control, run alone. The overlap is an exclusion reason, not a
proven explanation for variation in the other controls.

Ten separate paired profiles retain six existing Flarex phase counters. Their
full Flarex phase medians, including required work, are:

| Existing phase | Median thread CPU |
| --- | ---: |
| Request admission | 15 ms |
| Portable guarded business execution | **109.5 ms** |
| Runtime result validation | 0 observed counter quantum |
| Finite freeze and validation | 0 observed counter quantum |
| Authoritative publication | **39 ms** |
| Complete call cleanup | 0 observed counter quantum |

The phase counter increments sum exactly to the measured root for every
observed request. Their medians are not additive and these costs are not
native-subtracted excess. Zero means no counter quantum was observed, not zero
work. The profiler cohort's actual paired added CPU median is 124 ms; keep it
separate from the untouched controls.

Conservative clock alignment leaves 0.4481 ms uncertainty. Only samples inside
the measured request for every valid offset enter the retained frame analysis.
Of 994 Flarex terminal non-idle samples, 330 land in Effect machinery (33.2%),
217 in persistence owners (21.8%), and 113 in protocol owners (11.4%). The
remaining samples cover Node, Drizzle, pg, frameworks and other work. Important
terminal locations include Effect iterator construction and named functions,
Result generators, private JSON traversal, Schema parsing, canonical encoding,
metadata key retention and driver result construction. Inclusive Effect
ancestors also contain application callbacks; these percentages are executing
locations, not percentages of excess or removable CPU.

The profile's GC overlap is **3.252 ms median**, range 2.542–3.781 ms. GC is not
the large observed block in this cohort. Small kernel CPU and recurring
user-mode work also do not support attributing the complete excess to a rare PC
hang. Host/JIT/frequency and between-process variation have not been isolated.

Flarex supplies provisional writes, exact dependencies/OCC, revision history,
atomic settlement and durable outcomes in addition to the matched business
result. The native graph uses independently committed calls. Required work is
therefore present in the added processing; its presence does not prove all
current orchestration is necessary or authorize dropping those obligations.

## New synchronous attribution

A forwarding test-only facade preserves the installed Effect implementation,
all selected authoritative Schema parsers, Error construction and every SQL and
business check. Twelve observed roots among 24 pairs retain these stable counts:

| Selected mechanism | Count per workflow | Mean observed self elapsed |
| --- | ---: | ---: |
| Schema parser/validator invocations | **4,800** across 272 names | **15.67 ms** |
| Selected decoder factories during requests | 26 | **0.030 ms** |
| Authored named Effect function invocations | 758 | 3.065 ms excluding nested Error construction |
| Dynamic Effect function definitions | 135 | 0.356 ms excluding nested Error construction |
| Named function Error construction | **893**: 758 call + 135 definition | **7.995 ms** |

Timers measure synchronous elapsed time with observer overhead and possible
preemption, not exclusive CPU or safe savings. Suspended execution of an
Effect-returning Schema parser is outside its immediate invocation timer. The
observed/off added CPU means are 138.08/122.33 ms in this process: the observer
has material cost. Do not subtract that calibration to invent an uninstrumented
owner cost. Nested timers subtract Error construction from function self time.
The forwarding facade adds observable diagnostic frames and wrapper identities;
it is not used as a production-equivalent performance control.

A second located pass (six observed roots among 12 pairs) preserves all counts
and records Schema factory source positions once per new schema. Its additional
location observer changes timing, so its 19.20 ms parser and 8.61 ms Error
envelopes are not a performance improvement or regression. Selected locations:

| Authoritative decoder owner | Calls |
| --- | ---: |
| `flarex-protocol/ordered-index.ts:150`, hex key string | 485 |
| `flarex-protocol/app-document-id.ts:29`, scope namespace | 524 |
| `flarex-protocol/app-document-id.ts:41`, document identity | 149 |
| `flarex-protocol/ordered-index.ts:142`, hex string | 382 |
| `flarex-protocol/index-definition.ts:72`, digest string | 228 |
| `logicalDocuments/relationalQuery.ts:40`, predicate node | 106 |
| `logicalDocuments/relationalQuery.ts:39`, query envelope | 39 |
| `execution/finiteMetadataDependencies.ts:37`, metadata key | 122 |
| `execution/finiteMetadataDependencies.ts:38`, dependency | 85 |

No selected individual parser dominates the workflow. Counts do not prove that
fresh foreign fields or separate semantic contracts are redundant. Decoder
factory hoisting is especially weak: its total observed envelope is only
0.030 ms. The 135 dynamic function definitions' Error construction totals
0.878 ms observed mean, plus 0.356 ms definition self time. Hoisting all those
definitions would target a small envelope, not the full 7.995 ms call/definition
Error total.

In installed Effect 4.0.0-rc.112, `fn` constructs a definition Error and its
returned function constructs a call Error independently of `TracerEnabled`.
Turning tracing off therefore does not remove these Error objects. Their stacks
are retained lazily; the probe does not classify every Error as a formatted
stack. Public tracing and failure stacks are observable behavior, so switching
all named functions to untraced implementations is not a behavior-preserving
optimization.

The previous owner investigation also established 478 private JSON captures,
899 metadata consumptions, 694 cached metadata comparisons and 207 new metadata
captures. Those earlier counts remain historical evidence, not newly measured
in this probe. Existing metadata and issued-value reuse already operates.
Recursive canonical encoder calls do not count independent full-document
serializations. These owners need provenance and ordered-boundary analysis,
not an assumed general validation cache.

## Concrete fixture gap and causal tracing comparison

The existing quiet owner is
`persistence-postgres/src/execution/diagnostics/operation.ts`:
`withExecutionDiagnosticDefaults` disables tracing and span timing only when the
caller has not configured diagnostics or tracing. Configured callers retain
their original context. It already wraps direct atomic/commerce hosts and the
prepared finite attempt.

The mixed fixture starts fresh `runPromiseExit`/`runFork` runners through
`provideDiagnostic` and directly runs result acceptance and publication. When
the SDK diagnostic collector is absent, several branches pass the plain Effect
to the new runner. Such runners do not inherit quiet defaults from another
fiber. The original forwarding context probe observes **824 ordinary span
objects, 84 no-op span objects and 759 stack-frame objects** per workflow, with
3,629 context updates. No SDK collector is enabled in root-counter mode; the
ordinary spans come from default Effect behavior in these fixture runners.

A test-only transform forwards six unconfigured fixture branches through the
**existing** `withExecutionDiagnosticDefaults` owner. Configured-diagnostic
branches stay unchanged. Every SQL statement and business check remains. Two
independent 40-pair counter processes each measure 20 original and 20 quiet
requests in four-request ABBA blocks, with policy order reversed in the second
process. Native/Flarex root order remains balanced. Five SDK warmups are split
two/three between policies per process, reversed in the second; the cap is not
relaxed. No profiler, leaf timer or context hook overlaps these CPU comparisons.

| Counter process | Original added CPU mean | Quiet added CPU mean | Observed mean reduction |
| --- | ---: | ---: | ---: |
| First | 113.25 ms | 105.35 ms | 7.90 ms |
| Reversed repeat | 117.30 ms | 117.05 ms | **0.25 ms** |
| Pooled 40 requests per policy | 115.275 ms | 111.20 ms | **4.075 ms** |

Pooled paired-difference medians are 110.5/109.5 ms for original/quiet. A
deterministic 20,000-resample bootstrap of four-request blocks, stratified by
process, gives a mean-reduction interval of **−10.05 to +19.475 ms**. This
includes no benefit. Two local processes do not establish population or
between-process uncertainty. The selector facade exists in both variants;
do not treat their original values as the untouched controls or infer a source
improvement from their lower median.

A separate eight-pair context probe confirms the policy variant is effective:
four observed quiet roots each have **13 ordinary span objects, 732 no-op
objects, 759 stack-frame objects and 3,427 context updates**. All 13 remaining
ordinary objects were observed with tracing and timing enabled; they belong to
grant/protocol preparation outside the six selected branches. This measures
distinct installed objects, not every allocation. The observer-bearing CPU is
excluded from the policy comparison. The span-probe transform follows its
phase/root observer transform, so its loaded hashes differ from the two
counter-only policy manifests, as recorded in the summary.

Disposition: the fixture has a concrete quiet-policy consistency problem, but
the tested correction **does not demonstrate a reliable CPU saving**. It is not
the explanation for the large excess, and the fixture result does not establish
the same cost in a deployed Cloudflare host. Production remains unchanged.

## What can be removed or redesigned next

**First, correct quiet policy at its real measurement/foreign-runner owner.**
Reuse the existing default/context-capture owner at each trusted independent
runner; preserve configured diagnostics, caller tracing and original exits.
Check the remaining preparation runner as well as the six trial branches.
This is a measurement-policy correction with no demonstrated CPU credit.
Keep it independently measured; do not present it as the 125 ms solution.

**For the larger CPU target, redesign the connected ordered row acceptance and
projection path in persistence.** The evidence points to repeated small
construction, validation and private-value traversal distributed through
logical reads and publication. The next design should enumerate each accepting
frontier in `appRows.ts`, `storage/indexes/appIndexEntries.ts`,
`logicalDocuments/workingSet.ts` and the private JSON owner, then carry only
already-issued immutable row facts through internal hydration/projection.
Reduce freshly constructed internal carriers and Effect/Result dispatches
around those same facts only where they can be removed under the existing
issuer. Foreign inputs and mutable canonical buffers retain their full checks.
This is a candidate, not proof that current repeated calls are safely redundant
or that a particular number of milliseconds can be removed.

Convex's local `crates/database/src/reads.rs` keeps successful and missing reads
in the transaction read set and still records derived index dependencies. Its
`snapshot_manager.rs` owns versioned snapshots. An analogous internal
interpretation handoff here must retain exact dependencies and the Flarex
PostgreSQL authority/snapshot model; it cannot become a serving verdict cache.
The owning mixed-mutation roadmap already requires connected migration and
removal rather than parallel unchecked paths.

Before authorizing that implementation, the design must identify a witnessed
repetition and a concrete removable frontier. Keep membership/lookahead before
body acceptance, row decode/hydration order, earlier conflict before later
corruption, Proxy/getter/byte mutation behavior, first-crossing budget charges,
pending overlays, issuer/table/root identity, live generation checks and issuer
disposal. Use the existing authoritative codecs. Do not replay the failed
prepared-query handoff or header-acceptance experiments under a new name; this
proposal targets returned-row interpretation rather than query preparation or
capture headers. Every per-write RETURNING barrier and final stored publication
proof stays in place. No predicted CPU saving is assigned to this design yet.

**Lower priority: hoist the remaining dynamic named-function definitions where
state can be passed explicitly.** Commerce repository/event factories account
for several repeated definitions, but their measured total definition envelope
is about 1.23 ms. Preserve names, tracing, failures and request-local state.
Deleting all named wrappers would change observable behavior and is unsupported
by the measured saving evidence.

Decoder factory hoisting, generic result/authority caching, broad Effect
replacement, unchecked canonical rows, bulk materialization with late
validation and removing publication facts are not supported remedies. The
remaining large excess still needs connected owner proof; required semantic
work and avoidable orchestration have not been exclusively partitioned.

## Scope, reproducibility and cleanup

All accepted campaigns retain the same 6,962-file SDK source inventory digest
before/after, successful complete requests, settings/source/cleanup gates and
exact root CPU arithmetic. There are **172 accepted matched pairs** across
untouched controls and separate diagnostic cohorts; their statistics must not
be pooled as one performance control. Actual pairs, run IDs, hashes, loaded
policy manifests, calibrations and arithmetic checks are retained in
[summary.json](./summary.json). Raw reports/profiles and forwarding harnesses
remain local and ignored; the compact summary records their paths and hashes.

An initial policy request with 12 warmups was rejected before benchmark
execution by the unchanged five-warmup cap and is not a measured cohort. No
configuration limit or acceptance gate was weakened.

This is the small complete mixed graph on Windows/Node with an ordinary
PostgreSQL role. Server CPU is excluded. This task does not newly validate
PGlite, deployment, all five graphs, or complete native-relative performance
acceptance. The local diagnostic transforms preserve business checks and
request outcomes; the optional tracing variant intentionally changes default
tracing behavior. No new production algorithm, failure mapping or database
schema was introduced.

Final ordinary-role PostgreSQL settings remain fsync/full-page-writes/
synchronous-commit on, statement statistics and duration/auto-explain logging
disabled, with no other client connection. The owned PostgreSQL instance is
stopped and port 56434 has no listener. Runtime file hashes match the preceding
checkpoint. No worktree was created; unrelated workerd test edits and
`.codex-worktrees/` remain untouched. Only this report and its compact data
summary are retained in the scoped documentation commit.
