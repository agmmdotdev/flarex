# Measurement SDK Design

Status: the SDK covers the adopted 25-flow catalog with `quiet`, `timeline`,
`root-counters`, `resources`, `database`, `cpu` and `server` diagnostics. Matched fresh native pairs cover the
five original small graphs. SDK-owned Effect
Layers collect diagnostics at the existing trusted composition boundary;
production and quiet requests provide no measurement Layer or collectors.
The current attribution slice adds lighter observation before selecting another
runtime redesign. The
[owning preflight](../../../../../roadmaps/mixed-mutation-core/21-core-performance-harness-preflight.md#selected-complete-cost-attribution)
owns scope, evidence lanes, accounting, validation and cutover. Existing scenario
expansion is owned by this SDK delivery after the explicit handoff. Extended
native reference work retains its declared gates.

## Public Boundary

This folder owns a test-only SDK for collecting and explaining real core cost.
One `index.ts` exposes the high-level operations. The caller selects the question;
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
matched native/Flarex pairs and their retained complete-request excess.
Both reuse existing family fixtures and actual native business composition.
`measure` accepts all 25 catalog names and `small` or `typical` size; each report
retains actual workload cardinality and any fixed-size limitations. `compare`
accepts only the five original small graphs. Missing native mappings fail before
resource acquisition. The CLI owns existing daily/all family iteration; the SDK
selects one declared graph per bounded command.
Diagnostic mode is one discriminant, not overlapping SQL/CPU/server booleans.
The complete design selects `quiet`, `root-counters`, `timeline`, `resources`, `database`, `cpu` and `server`.
`compare` accepts an optional `mode: "quiet" | "root-counters"`, defaulting to quiet.
Only fully quiet comparisons evaluate elapsed acceptance. Sampling defaults
are retained in the report: one warmup and one sample for `measure`, five warmups
and 30 fresh pairs for `compare`. The adopted fixture supports 105 fresh attempts:
100 quiet pairs plus five warmups, or at most 99 diagnostics with five warmups
and a separate calibration. Root counters allow 100 complete observed pairs plus
five quiet warmups; their back-to-back counter calibration does not consume a
business attempt. Resource mode reserves two fresh attempts per sample
and alternates quiet/diagnostic order after its warmups. Its `observerPairs`
calibrate observation using separate Flarex executions; they are not native
acceptance pairs. This is fixture capacity, not a core budget change.
Sampling, stable
sources/settings, complete comparable results and
cleanup must satisfy the existing acceptance policy before `passed` is possible.

`diagnoseHistoricalCaptures` is the focused server diagnostic selected by the
[historical capture preflight](../../../../../roadmaps/mixed-mutation-core/27-shared-execution-evidence-redesign-preflight.md#historical-capture-result-handoff-preflight).
The SDK constructs its existing Product seed fixture, genuine admitted read
scope, server resource, submission observer and reports. It accepts only an
output directory, the optional provisioning connection string and a verified
absolute plan-log path with the required prefix. Its fixed budget is two serial
passes of nine source-equivalent uncached reads, at most eighteen captures, with
no retry or measured complete business/native graph. The first pass records the
real compiler demands; the second invokes those original capture operations
inside the same open admitted scope. Checked initial observation faults skip
the read. Source/settings drift, nonselected activity, incomplete required
plans and cleanup failures stop the campaign and retain partial artifacts.
First-use and second-pass server planning/execution remain separate; overlapping
top-level and nested times are never added. This diagnostic does not evaluate
native latency acceptance or establish exact client CPU/transport cost.
The earlier instrumented campaign retained eighteen complete input windows but
failed final close because its fixture sealed inside the active deadline wrapper.
The fixture now completes that wrapper before checking and closing the same
borrow; its isolated eighteen-capture execution completes with zero changes or
events. A separate corrected strict diagnostic completes all eighteen windows
and cleanup; the earlier failed artifact remains incomplete. The source
fingerprint includes already-loaded promoted Medusa compiled modules alongside
authored sources and the upstream island, so compiled execution drift invalidates
the evidence. Diagnostic arming, pool verification and the source baseline run
through the existing prepared-context callback before initial finite admission
starts its lease supervisor. Renewal remains enabled at its normal interval;
overlap inside a measured window still invalidates that isolated capture.
The owning preflight preserves the bounded stop/no-retry gate.

The `measure` and `compare` options share one SDK-owned Schema. Inputs may use inference; callers need no
imports for plans, sites, spans, clients, transactions, recorders or artifact
types. Their result has four fields: `runId`, `execution`, `acceptance`
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

The focused historical diagnostic has its own bounded options contract and
returns `{ runId, status, reports }`; `status` is `complete` or `incomplete`.
It evaluates evidence completeness without a native acceptance verdict.
An incomplete run rejects with `HistoricalCaptureRunFailure`, retaining the
original causes and raw/human partial report paths. Artifact persistence failure
retains available partial paths through the existing infrastructure error.
If construction fails before the fixture hands off its resources, cleanup is
`unverified`: the SDK preserves the constructor's complete cause without guessing
whether its internal releases succeeded. Explicit owned release failures report
`failed`; a complete run requires completed cleanup.

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

Physical capture diagnostics use an optional `PhysicalSessionObservation`
constructed by the request's Effect collector. The retained target resolves the
current binding through the existing fixture diagnostic setter; it retains no
request collector and creates no driver per sample. An absent binding returns
the original work before diagnostic timing, events or wrappers.

`PostgresPhysicalSession.drain`, `.release`, `.cancel` and `.quarantine` reuse
the SDK's Effect spans with owner `physicalSession`, the actual parent at
evaluation, and complete Exit completion including finalizers. An owner-supplied
typed predicate classifies a returned refusal as scalar outcome `failure` while
retaining its genuine successful Exit and null Cause. Actual typed failures,
defects, interruption and combined Causes retain their existing classifications.
Foreign predicate, clock or observation faults invalidate evidence only after
business settlement through the collector's health check. These intervals are
inclusive: nested cancellation and quarantine must not be summed as exclusive
component CPU. Query await timing still cannot separate server, lock or network
cost. Default resource diagnostics keep these short lifecycle spans as wall
intervals; CPU counters remain on the existing coarse operation brackets.

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

`root-counters` adds exactly two readings through the existing Node resource
adapter around `sample.run()` on native and Flarex calls. Flarex's real attempt
finalizers remain inside that call. Fixture setup, seeding, verification, sample
disposal, command cleanup, sanitization and report/readback remain outside.
No Effect tracer, SQL/publication observer, inspector, heap or GC collector is
constructed in this lane; it adds no production-core imports. The existing
Promise boundary retains business return values, rejected Causes/Exits and
cancellation ownership. Either reader failing still allows actual execution and
the other read; it invalidates evidence without replacing the business outcome.

Each request's `rootCounters` retains Schema-checked absolute process/thread
readings, deltas, actual call wall window and both acquisition wall windows.
Thread counters can be unavailable (`null`) while process evidence remains valid.
Counter units are microseconds, but actual platform counter resolution and wall
clock precision remain explicitly unknown. Zero CPU deltas can be quantization;
they cannot resolve a budget below counter granularity. Process counters include
other threads and background work; external contention is unavailable. Control
sibling/background work when using this lane.

The command retains eight synchronous back-to-back pairs in
`counterCalibration`, outside business calls. They disclose adapter/clock cost
and observed quantization without claiming precise platform resolution or
subtracting that cost. `compare` alternates fresh complete native/Flarex calls,
retains every completed side even if partner acquisition fails and records
signed user/system/total excess in `cpuPairs`. Process and optional thread CPU
remain separate; no nested sums, event-loop CPU inference or traced-overhead
subtraction is performed. Counter-observed elapsed pairs are retained as
observations and never evaluate fully quiet elapsed acceptance. This mode uses
`acceptance: "notEvaluated"`; a CPU budget is declared by the owning preflight
from actual complete matched evidence and its resolution limits.

`resources` records coarse operation wall time, process/thread CPU deltas and
event-loop counters through the SDK's existing tracer. It retains exact driver
submission/completion, operation parentage, checkout, backend PID, outcomes and
plain transaction controls. It performs no SQL fingerprinting, stack capture,
parameter/result sizing, heap sampling, inspector work or server logging.
Unavailable sizes and statement counts remain unavailable rather than zero.
`measure({ mode: "resources", observation: "owners", ... })` selects root,
native and a bounded set of existing coarse owner counter brackets. The default
resources lane retains its existing full span and driver observation. The selected
lane installs no tracer primitive-evaluation context hook, SQL trace, inspector,
allocation or GC observer. Unselected spans retain their normal Effect lifetime
without collector records or counter reads. Existing Promise phases and actual
Effect parent chains preserve selected ancestry through omitted spans; independent
async bridges require their existing explicit parent propagation. Fiber identity
can remain unavailable.

The exact selected core producers are
`ApplicationRelationReadinessFold.validatePreparedInTransaction`,
`ApplicationRelationReadinessFold.validateProtectedReplay`,
`ApplicationBindingProjection.readAccepted`, `InstallationRuntime.accept`,
`ApplicationActivation.prepareBindingSelection`,
`ApplicationReadiness.validateStoredIssuedReadiness`,
`ApplicationReadiness.authenticateInstalled`, `ApplicationReadiness.readReady`,
`ScopeAuthority.resolveLocatedTrustedById`, `CmsCommit.finalize`, `CmsCommit.publishOutcome` and
`PointCommitTransaction.publishFinite`, plus `AtomicCommerce.attempt`,
`AtomicCommerce.executeRequest`, `DataBinding.verifyLogicalSchema`,
`LogicalStorageReadiness.inspect`, `LogicalCommerce.make`, `Workflow.runAtomic`,
`MedusaWorkflow.runNative`, `AtomicCommerce.closeContributions` and
`CommerceCommit.finalize`, alongside existing native/outer fixture
phases and coarse publication publisher/transaction/durablePublication phases.
These are inclusive envelopes; an admission wrapper can include business work
and publication. Atomic/workflow envelopes retain their actual nesting, including
the outer `native Medusa workflow` fixture phase. Logical binding/readiness spans
observe discrete initial acceptance; `LogicalCommerce.make` counts actual
participant working-set construction, not each module invocation. Callback-bearing
admissions wrappers and per-step/per-row spans remain unselected. The legacy Medusa
path's full binding preparation and stored-readiness validations retain their own
producer spans; their nested costs remain inclusive. Counts of installed
authentication and canonical `readReady` spans distinguish renewal checks from
canonical preparation or epoch-change reproof. Actual parentage places a
canonical span under its preparation or authentication caller; an authentication
count alone does not establish that reproof ran. Nested CPU windows overlap and
must not be added or treated as exclusive costs. The report records resolved observation selection and explicitly
unavailable full timeline and driver detail. Selected samples retain the existing
Schema-checked events and only the analyzer's integrity/resource projection;
unavailable database totals, driver unions and deepest/context ledgers are absent.
Missing selected observations and counter faults invalidate diagnostics without
replacing business values, Causes or cleanup. Existing alternating quiet/resource
pairs disclose perturbation; selected counters are not quiet or exclusive CPU and
must not be summed. This diagnostic selects an owner correction; it is not an
acceptance result.
`database` retains full driver detail; `cpu` and `server` use resource-only
driver detail to avoid unrelated observer work.

Counter windows bracket the observed operation with small observer work at the
edges and are retained independently of operation timestamps. Counters are
inclusive: nested windows overlap, process CPU includes other threads and
thread CPU includes observation and platform quantization. A zero CPU delta
can reflect quantization rather than zero work. Event-loop idle is
not network or database time. Descendant driver unions use actual operation
ancestry. These quantities cannot be added or subtracted to infer exclusive
CPU, transport cost or quiet phase durations. Unsupported thread counters are
explicitly null. Counter faults invalidate diagnostics without changing business
values, failures or settlement. Resource mode's alternating fresh quiet pairs
expose total observer perturbation and run variation; neither is subtracted.

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

For CPU/GC stacks without full tracing or heap sampling, use
`measure({ mode: "cpu", observation: "root", driver: "postgres", selection:
{ scenario: "mixed-product" }, size: "small", warmups: 5, samples: 5,
outputDirectory: "work/measurements/root-cpu" })`. This profiles the same actual
business call with no Effect collector/context hook, SQL trace or publication
observer. Raw CPU evidence and its genuine call-window analysis are retained
independently of timeline normalization. Timeline, driver totals and allocation
evidence are explicitly unavailable; disabled heap sampling is distinct from a
failed enabled capture. The default CPU mode keeps its full observers and heap
sampling.

Root CPU uses alternating fresh quiet/diagnostic Flarex pairs. The example
consumes exactly fifteen calls including warmups. `observerPairs` retains the
actual call differences; these are diagnostic perturbation and variation, never
subtracted to invent quiet timings or treated as native acceptance. Profiler
setup/stop remains outside the business-call timer, so the pair difference does
not include all observer acquisition/release cost. Raw command and call windows
retain those boundaries. Inspector and GC observation still perturb execution;
this mode cannot retrospectively explain a separate quiet stall or establish
exclusive owner CPU.

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
fields and exact direct-root plan query IDs as signed-int64 decimal strings.
The logged header query context is retained separately and can identify a prior
or enclosing query. Missing plan IDs are unavailable; header IDs never substitute
for them. SQL text, predicates, outputs and parameters
are excluded from persisted artifacts. No write is replayed through EXPLAIN.
Without that source, actual plans are explicitly unavailable. A parsed log
window does not prove all log output flushed or every statement was observed.

CPU stack coordinates come from the executing profiler runtime. Transformed
Vite code may report lines that differ from the authored TypeScript source;
source paths identify owner candidates, not verified authored line coordinates.

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

Database event counts describe submitted driver statements and exchanges. An
installed publication routine can execute several internal SQL statements within
one exchange; reducing exchanges does not prove that internal SQL or server CPU
fell. Use the server lane's nested statement statistics for that distinction and
complete quiet requests for the latency result.

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

The [complete cost inventory](../../../benchmarks/core-performance/complete-attribution/README.md)
retains lighter resource diagnostics, actual alternating observer pairs and
source-owned admission/readiness/working-set/publication inventories for the five
original profiles. Quiet phase CPU and PostgreSQL CPU remain unavailable; these
reports identify replacement boundaries without claiming a runtime speedup.

## Running The SDK Proofs

### Matched CPU attribution

`compare({ mode: "cpu", ... })` profiles each genuine native and Flarex call
with the existing root-only CPU/GC collector and independent complete-call CPU
counters. It retains source/settings, business verification and cleanup gates.
It evaluates no quiet performance acceptance. `cpuAnalysis.selfLocations`
partitions conservatively admitted self samples by executing source category
and original runner ancestry. The nearest authored stack caller is retained
separately as provenance; sampled spacing is not CPU duration, and executing
profile coordinates are not asserted to be authored TypeScript lines.

For the existing Windows cycle reader, `compare({ mode: "root-counters",
attribution: { readerPath, detail: "engine", order: "abba" }, ... })` observes
the original installed Effect runner in alternating four-pair on/off blocks.
`order: "baab"` reverses assignment in a separate process. Native calls retain
root cycles; only selected Flarex roots enter synchronous scopes. The disjoint
ledger reconciles to its own native cycle readings, separately from the SDK's
millisecond CPU counters. Cycles are never converted to milliseconds. Attribution
defaults to 32 samples and rejects counts that are not multiples of four before
acquisition. Observed Flarex roots require a nonzero engine observation; a missed
executing instance invalidates evidence even if the outside bucket reconciles.

`detail: "generators"` additionally requires the diagnostic-only Vite config
`attribution.vitest.config.ts`, with `FLAREX_MEASUREMENT_CYCLE_DETAIL=generators`.
It reuses the earlier probe's AST wrapping of authored runtime generator
expressions. Factories and `next`/`throw`/`return` forward the original receiver,
arguments and outcome. A bounded source/hash/site manifest records transformed
code. No source file or installed dependency is rewritten. The inner scopes
measure synchronous advances only; no scope crosses a yield or await. Engine
residual includes unobserved helpers, parsers and library work and must not be
called pure interpreter overhead. Observer faults mark the diagnostic incomplete
without replacing business failures. Original request verification and settlement
always remain owned by the existing harness.

The native reader source is `native/threadCycles.cc`, promoted unchanged from
the existing probe. Build it as a Windows x64 Node-API DLL with MSVC (`/LD /EHsc`),
official headers matching the running Node ABI, and a `.node` output extension;
its exported Node-API entry points resolve against the actual Node host.
Pass the explicit built path; there is no silent fallback to coarse counters.
The report records binary and installed-engine hashes, native thread identity,
empirical counter increments and balanced observer assignment. Increment
calibration does not establish guaranteed hardware resolution. On/off roots
still contain forwarding factories and root cycle acquisition; use a separate
untransformed control. Instrumentation cost is disclosed and never subtracted
to manufacture quiet owner timings.

The actual mixed-workflow entry is `attribution.integration.test.ts`. Select
`FLAREX_MEASUREMENT_ATTRIBUTION=cycles`, `cpu`, or `control`, set the existing
PostgreSQL endpoints and `FLAREX_MEASUREMENT_REPORT_DIRECTORY`, and run Vitest
with `attribution.vitest.config.ts`. Cycles also require
`FLAREX_MEASUREMENT_CYCLE_READER`; optional `FLAREX_MEASUREMENT_CYCLE_ORDER` is
`abba` or `baab`. `FLAREX_MEASUREMENT_SAMPLES` defaults to 32; cycle campaigns
use a multiple of four. CPU and control campaigns omit generator transforms.
All campaigns run sequentially, with profiler/observer-free controls and full
business proofs. No production CPU improvement follows merely from this API.

Typecheck the SDK against its actual promoted framework declaration owner:

```sh
pnpm exec tsc -p packages/executor/test/performance/measurement/tsconfig.json
```

The promoted framework and the native comparison island share a package name
and version but have different portable exports. The focused type project binds
the SDK's portable import to the promoted declaration used by its actual
adapter runtime. It adds no runtime alias or helper stub; native-island
compatibility remains subject to its separate owner checks.

Run the deterministic SDK and connected-owner suite from the workspace root:

```sh
pnpm exec vitest run --config packages/executor/test/performance/measurement/vitest.config.ts
```

The connected mixed-request observer proof in `integration.test.ts` uses
`FLAREX_MEASUREMENT_INTEGRATION=1`; additionally set
`FLAREX_MEASUREMENT_POSTGRES=1` and the actual PostgreSQL fixture endpoints to
exercise both databases. It checks the replacement acceptance/materialization
producers, actual driver correlation and complete request accounting. A default
SDK run that skips these fixtures does not prove the connected observer path.

Actual requests are explicitly gated so this suite does not start framework or
database fixtures by default. Set `FLAREX_MEASUREMENT_INTEGRATION` to one of
`pglite-resources`, `pglite-cpu`, `postgres-cpu`, `postgres-server`, `product-timeline`,
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
