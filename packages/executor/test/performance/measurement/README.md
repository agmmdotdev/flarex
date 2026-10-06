# Measurement SDK Design

Status: the SDK covers the adopted 25-flow catalog with `quiet`, `timeline`,
`database`, `cpu` and `server` diagnostics. Matched fresh native pairs cover the
five original small graphs. SDK-owned Effect
Layers collect diagnostics at the existing trusted composition boundary;
production and quiet requests provide no measurement Layer or collectors.
Runtime performance optimization remains paused. The
[owning preflight](../../../../../roadmaps/mixed-mutation-core/21-core-performance-harness-preflight.md#selected-cost-attribution-successor)
owns scope, evidence lanes, accounting, validation and cutover. Existing scenario
expansion is owned by this SDK delivery after the explicit handoff. Extended
native reference work retains its declared gates.

## Public Boundary

This folder owns a test-only SDK for collecting and explaining real core cost.
One `index.ts` exposes two high-level operations. The caller selects the question;
the SDK constructs the session, collectors, observation bindings, analysis and
report, and releases its resources. No new workspace or production package is
selected merely to provide this boundary.

The call shape is:

```ts
import { measure, compare } from "./measurement";

await measure({
  selection: { scenario: "mixed-product" },
  size: "small",
  mode: "database",
  outputDirectory,
});

await compare({
  selection: { scenario: "mixed-product" },
  size: "small",
  samples: 30,
  warmups: 5,
  outputDirectory,
});
```

`measure`
executes one declared quiet or diagnostic plan. `compare` owns fresh
matched native/Flarex quiet pairs and their retained complete-request excess.
Both reuse existing family fixtures and actual native business composition.
`measure` accepts all 25 catalog names and `small` or `typical` size; each report
retains actual workload cardinality and any fixed-size limitations. `compare`
accepts only the five original small graphs. Missing native mappings fail before
resource acquisition. The CLI owns existing daily/all family iteration; the SDK
selects one declared graph per bounded command.
Diagnostic mode is one discriminant, not overlapping SQL/CPU/server booleans.
The complete design selects `quiet`, `timeline`, `database`, `cpu` and `server`.
`compare` accepts no diagnostic mode: its timed requests are quiet. Sampling defaults
are retained in the report: one warmup and one sample for `measure`, five warmups
and 30 fresh pairs for `compare`. The adopted fixture supports 105 fresh attempts:
100 quiet pairs plus five warmups, or at most 99 diagnostics with five warmups
and a separate calibration. This is fixture capacity, not a core budget change.
Sampling, stable
sources/settings, complete comparable results and
cleanup must satisfy the existing acceptance policy before `passed` is possible.

Options have one SDK-owned Schema. Inputs may use inference; callers need no
imports for plans, sites, spans, clients, transactions, recorders or artifact
types. The result has four fields: `runId`, `execution`, `acceptance`
and `reports`. `execution` is `complete`, `failed` or `incomplete`; `acceptance`
is `passed`, `failed` or `notEvaluated`; `reports` contains raw and human artifact
paths and optional sanitized profile exports. Only a genuine complete comparison can pass acceptance. A complete
diagnostic uses `notEvaluated`. Known business failures use `failed`; missing,
lost or unsettled required observations use `incomplete`. A failed execution
rejects with those four report/status fields and the original sample and cleanup
causes, in order; a single failure retains its object identity. Artifacts retain
ordered stage-specific reason kinds and safe tags rather than arbitrary messages,
stack contents or payloads. Diagnostic tracer Exits retain actual typed failure,
defect, interruption and combined reasons. Quiet foreign rejections remain foreign:
the SDK cannot reconstruct Cause reasons already squashed by an existing runtime
bridge, and installs no collector to discover them. Invalid configuration
rejects before resources are acquired. Infrastructure failures preserve their
original error/Cause and any partial artifact references; combined execution,
cleanup and persistence failures retain all original causes. The SDK cannot return
successful artifact paths when persistence failed.

## Core Integration

Construction belongs in the SDK and trusted measurement composition root.
Production core never imports `test/performance/measurement`, Node inspectors,
PostgreSQL diagnostic tools or report schemas. The dependency direction is
measurement SDK -> existing fixtures/collectors -> real core owners.

The physical database trace remains with its current persistence test owner.
The SDK installs it once for its bounded command lifetime and consumes its raw
events. Framework and native construction remain with existing scenario and
framework owners. The SDK imports those implementations; it does not reproduce
transactions, readiness, hooks, storage traversal or business verification.

The owner accepts focused core refactoring for deeper observation, including
Effect tracing and SDK-composed measurement Layers. Instrument real operation
boundaries and selected synchronous work through the contract below. Hooks carry
domain-owned scalar evidence and are supplied by trusted fixture composition.
The SDK converts this evidence into its private artifact shape. That conversion
is observation translation, not another business or authority path. A core module
should not construct a measurement client, register metric names, assemble SDK
event contexts or import the SDK's event types. Existing Promise runtime bridges
may carry the injected tracer and parent in a minimal Effect Context; they do not
construct collectors or transfer business capabilities.

No singleton, ambient cross-request recorder or per-owner SDK instance is
selected. Correlation, buffering, timing and observer-cost accounting stay inside
the scoped collector. Preserve full outcomes, cancellation, evaluation order
and existing resource ownership; instrumentation introduces no extra runtime
bridge per event, database command, transaction or settling capability.

## Effect Measurement Layers

Use the installed Effect tracer as the shared injected tracing capability.
The SDK constructs a private measurement Layer and provides it once at the
trusted diagnostic composition boundary. Reuse `Tracer.Tracer`, named
`Effect.fn` operations and `Effect.withSpan`; do not create another generic
telemetry Context service or a Layer for each core module. An inert tracer can
use `Layer.succeed`; a collector with resources uses scoped Layer construction.
The SDK owns those resources. Existing prepared-host, request, connection and
transaction owners keep their lifetimes and finalizers.

Core operations retain ordinary Effect signatures and their existing imports.
Observe admission, demanded data capture, working-set processing, framework
calls, freeze/preparation, current validation, materialization, publication and
outcome resolution at their real owners. Add selected internal phases for
canonical capture, copying, validation, encoding/hashing and relation traversal
when a concrete cost question warrants them. Layers provide capabilities;
they do not automatically discover these internal operations.

Counts and known byte sizes use one operation/request-bound synchronous sink
captured at an existing boundary. Accumulate scalars and emit coarse span
attributes/events. No per-row service lookup, runtime bridge, Layer provision,
serialization or copied payload is selected. Counts of actual work complement
span durations; elapsed spans alone cannot establish allocations or copies.
Migrate displaced custom phase wrappers and observation construction into this
contract when their consumers move, preserving the native Promise boundaries
that still exist. Do not retain two parallel core observation frameworks.

Each diagnostic invocation gets one root span and a fresh bounded record.
Structured child fibers inherit the tracer and parent; all owned work must
settle before the record closes. Independent existing Promise/runtime bridges
explicitly carry the captured tracer and parent into their genuine Effect
runtime. A JavaScript request ID alone does not establish Effect parentage.
Record fiber identity at selected entries when needed; no global current-request
variable or mutation of business service Context is selected.

Production and quiet comparison composition provide no measurement Layer,
collector, count sink, profiler or exporter. They perform no measurement event
serialization or export. Additional diagnostic-only wrapping is selected at the
existing composition/factory boundary; absent observation retains the original
work. Built-in disabled tracing still has span/context/finalizer machinery in
the pinned Effect version, so disabling it is not a zero-overhead proof. Measure
the normal path and the instrumented path separately; do not leave new always-on
profiling work in core and compensate by subtracting its estimated cost.

The installed Effect span timestamps use the business Clock's wall time.
The SDK records an independent monotonic timestamp synchronously when its tracer
receives span start/end, retaining Effect timestamps separately for correlation.
Do not replace the business Clock to obtain performance timers. One SDK clock
aligns local span and driver observations; cross-process clocks retain their
own correlation/uncertainty. Span completion preserves the full Exit, including
typed failure, defect and interruption. Collector faults are reported as
diagnostic failures without changing business settlement or swallowing its Cause.

Effect spans observe elapsed scoped operations, including asynchronous waits.
They do not directly measure scheduler CPU, GC, allocations, wire transport,
driver queueing or PostgreSQL lock/execution time. Database, CPU and server
collectors remain necessary. The completion report must show both attribution
coverage and what remains unexplained; no Layer can guarantee discovery of every
bottleneck from one run.

## Internal Modules

### CPU And Server Resources

`cpu` owns one Node inspector session and a bounded GC observer around the
actual request. Profiler setup/stop stays outside its request timer. It retains
sanitized `.cpuprofile` and allocation JSON exports, exact samples/deltas,
command windows, counters and faults. CPU clock alignment uses start/stop
brackets and a shared monotonic-rate assumption. Allocation samples have no
timestamps and cover the profiler window; endpoint memory is occupancy, not
total allocation or peak memory. Sampled stack spacing is not exact scheduler
CPU. SDK commands run sequentially; isolate exclusivity requires a controlled
process, and external contention remains unavailable. Bounds stop observation
without changing business settlement.

`server` requires the trusted PostgreSQL provisioning endpoint. It creates a
disposable target database and separate observer database/ordinary roles, then
passes explicit endpoints into the existing fixture owners. Installation runs
with plan logging disabled. After preparation the SDK arms its owned database,
retires existing idle serving clients through the public pool API and verifies
replacement runtime sessions before warming or timing. Busy pools fail closed.
Administrative provisioning/cleanup has a separate 30-second budget; the default
observer query budget is one second. It never redirects
process environment or adds business queries. All actual execution roles,
including SECURITY DEFINER work, contribute to statement counter deltas.
Before/after counters, planning counts/time, execution elapsed, block counts,
activity, wait types and blockers retain their exact database/query identities.
The serial observer has bounded polls/rows/duration/query timeouts and joins
before release. Effect owns internal observer/file scopes; existing public
Promise callbacks retain their original values and rejections. Counter resets,
eviction and collection faults invalidate the
diagnostic rather than masquerading as a successful zero delta.

An owned server log can be selected through
`FLAREX_MEASUREMENT_SERVER_LOG` with the verified prefix
`FXPLAN[%p][%d][%c][%Q]`. The SDK enables bounded actual `auto_explain` observation
only for its target database. Plans retain safe operator/cardinality/cost/buffer
fields and exact header query IDs; SQL text, predicates, outputs and parameters
are excluded from persisted artifacts. No write is replayed through EXPLAIN.
Without that source, actual plans are explicitly unavailable. A parsed log
window does not prove all log output flushed or every statement was observed.

Server samples correlate PID/time candidates with driver awaits. Queue overlap,
PID reuse, short queries and asynchronous timestamps retain ambiguity or missing
identity. Wait observations are samples, not exact lock durations. Top-level
and nested server elapsed times overlap. Observer awaits do not capture its
entire contention cost. Server calibration uses the same declared diagnostic
GUCs and is not a quiet PostgreSQL baseline. Quiet `compare` installs none of
these collectors or server settings.

The layout gives each responsibility one owner:

```text
measurement/
  index.ts           two high-level exports
  run.ts             bounded session and existing scenario composition
  cpu.ts             scoped Node profiler acquisition and pure CPU analysis
  server.ts          disposable PostgreSQL acquisition and pure server analysis
  artifact.ts        one observation schema and derived internal types
  analysis.ts        pure interval, attribution and pair calculations
  report.ts          rendering and post-request artifact persistence
  collectors/        Effect measurement Layer and existing DB/CPU/server bindings
```

This is a responsibility map, not a requirement to create empty modules. Keep
an operation local until a real responsibility or lifetime warrants separation.
Imports go through `index.ts` at SDK consumers; internal modules remain private.
Existing native-reference composition stays with its owner and is called by
`run.ts`. Collector factories are not re-exported. Report rendering cannot
recalculate intervals or acceptance, and collectors cannot decide acceptance.

Move only actual measurement orchestration and analysis into this boundary.
Remove displaced duplicate math, artifact validation and collector construction
when consumers migrate. Retain underlying owner collectors rather than copying
them into this folder. Do not add facade layers around facade layers, per-mode
runner families, configurable plugin registries or a universal instrumentation
interface. Historical reports retain their original formats and limitations.

## Useful Evidence And Precision

Reports expose complete paired cost when available, ordered requests and SQL,
checkout/transaction identities, owner work counts and byte units, observer cost,
coverage gaps and failures. The CPU lane adds sampled stacks and allocations,
GC intervals, CPU counters, event-loop utilization and memory endpoints. The
server lane adds isolated statement statistics and PID/query/wait samples.
Raw events remain available alongside the ranked summary. Each value states
whether it is observed, estimated, ambiguous or unavailable.

Quiet results and each diagnostic lane remain separate requests. Disjoint wall
accounting reconciles each diagnostic to its own root interval, retains overlaps
and unexplained time, and does not label residual wall as CPU. Sampling is not
exact allocation or wall attribution. Driver await is not server execution;
decoded JSON bytes are not wire traffic or heap allocation. Collector overhead
is measured and disclosed rather than subtracted to invent quiet latency.

The current cutover uses the existing family and request owners. Genuine
framework and transaction Promise runtimes carry only the tracer and parent;
business services, Clock and settlement stay with their existing owners. Database
submission snapshots the actual retained operation ID, including the initiating
pool-query context through checkout delegation. Source frames and source-owner
candidates remain provenance, never a guessed semantic owner. Missing operation
contexts invalidate collection rather than silently reverting to stack ownership.

Reports retain two separate attribution ledgers. Strict deepest-operation wall
keeps unknown children and concurrent coordination ambiguous. Enclosing operation
context follows actual ancestry to the nearest known owner, while retaining each
unknown leaf and competing context. The supervisor's coordination lifetime stays
visible separately; its actual child work still participates. A wrapper waiting
for that supervisor remains an ancestor. Context establishes responsibility, not
exclusive execution, CPU cost or deepest-operation ownership. These ledgers and
overlapping unions must never be added.

Complete collection and reconciled wall accounting do not imply complete owner
attribution, and driver awaits cannot identify server execution, network or lock
waits. Timeline-only runs collect no database events; their empty database totals
represent an unavailable lane rather than zero SQL work. The
[first retained reports](../../../benchmarks/core-performance/measurement-sdk/README.md)
and [operation-context reports](../../../benchmarks/core-performance/measurement-operation-context/README.md)
record these limits. The owning
preflight requires affected checks, deterministic accounting witnesses, real
database/native lanes, both reviews, shared-file handoff, cleanup and a scoped
commit. It grants no claim of improved core performance merely because the SDK
can collect more data.

The [CPU/server completion evidence](../../../benchmarks/core-performance/measurement-diagnostics/README.md)
retains representative reports and sanitized profiles. These are diagnostic and
assembly proofs; native-relative acceptance remains open.

## Running The SDK Proofs

Run the deterministic SDK and connected-owner suite from the workspace root:

```sh
pnpm exec vitest run --config packages/executor/test/performance/measurement/vitest.config.ts
```

Actual requests are explicitly gated so this suite does not start framework or
database fixtures by default. Set `FLAREX_MEASUREMENT_INTEGRATION` to one of
`pglite-cpu`, `postgres-cpu`, `postgres-server`, `product-timeline`,
`payload-database` or `postgres-compare`, then run the same command with
`packages/executor/test/performance/measurement/run.integration.test.ts` as its
file argument. Select one proof per process. `FLAREX_MEASUREMENT_REPORT_DIRECTORY`
optionally selects the retained output directory.

PostgreSQL proofs use the existing fixture endpoints and, for server mode, the
trusted provisioning endpoint. Server diagnostics require PostgreSQL statement
statistics and actual-plan observation capabilities; unsupported configuration
fails before timing. Actual plans additionally require the owned server log
source and exact prefix described above. These capabilities and disposable
roles/databases belong to the diagnostic lifetime. Quiet comparisons do not
enable them. `postgres-compare` runs one fresh Payload pair to prove assembly;
use `compare` with its full sampling policy for acceptance.
