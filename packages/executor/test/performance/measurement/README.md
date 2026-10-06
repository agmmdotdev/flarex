# Measurement SDK Design

Status: selected design only. The SDK operations and module layout below are
unimplemented. Runtime development and new measurements remain paused. The
[owning preflight](../../../../../roadmaps/mixed-mutation-core/21-core-performance-harness-preflight.md#selected-cost-attribution-successor)
owns scope, evidence lanes, accounting, validation and cutover. Existing scenario
expansion and native reference work retain their own owners and handoff gates.

## Public Boundary

This folder owns a test-only SDK for collecting and explaining real core cost.
One `index.ts` exposes two high-level operations. The caller selects the question;
the SDK constructs the session, collectors, observation bindings, analysis and
report, and releases its resources. No new workspace or production package is
selected merely to provide this boundary.

The proposed call shape is:

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
  samples: 100,
  warmups: 5,
  outputDirectory,
});
```

These are design examples, not commands for current code. `measure`
executes one declared quiet or diagnostic plan. `compare` owns fresh
matched native/Flarex quiet pairs and their retained complete-request excess.
Both reuse the existing scenario catalog, sampling policy and real business
composition. Missing native mappings are explicit unsupported comparisons.
Diagnostic mode is one discriminant, not overlapping SQL/CPU/server booleans.
The selected modes are `quiet`, `timeline`, `database`, `cpu` and `server`.
`compare` accepts no diagnostic mode: its timed requests are quiet. Sampling
defaults come from the existing sampling-plan owner and are retained in the
report. Sampling, stable sources/settings, complete comparable results and
cleanup must satisfy the existing acceptance policy before `passed` is possible.
The catalog-backed selection chooses a scenario, family or existing daily/all
group. A multi-scenario selection has one bounded SDK session and preserves
existing family reuse/disposal; the CLI must not create a session per item.

Options have one SDK-owned Schema. Inputs may use inference; callers need no
imports for plans, sites, spans, clients, transactions, recorders or artifact
types. The proposed result has four fields: `runId`, `execution`, `acceptance`
and `reports`. `execution` is `complete`, `failed` or `incomplete`; `acceptance`
is `passed`, `failed` or `notEvaluated`; `reports` contains raw and human artifact
paths. Only a genuine complete comparison can pass acceptance. A complete
diagnostic uses `notEvaluated`. Known business failures use `failed`; missing,
lost or unsettled required observations use `incomplete`. Preserve full original
sample failures and cleanup outcomes in retained evidence. Invalid configuration
rejects before resources are acquired. Infrastructure failures preserve their
original error/Cause and any partial artifact references; the SDK cannot return
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
should not construct a measurement client, register metric names, assemble
tracing contexts or import the SDK's event types.

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

The proposed layout gives each responsibility one owner:

```text
measurement/
  index.ts           two high-level exports
  run.ts             bounded session and existing scenario composition
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
checkout/transaction identities, owner work counts and byte units, CPU/GC
diagnostics, observed server waits, observer cost, coverage gaps and failures.
Raw events remain available alongside the ranked summary. Each value states
whether it is observed, estimated, ambiguous or unavailable.

Quiet results and each diagnostic lane remain separate requests. Disjoint wall
accounting reconciles each diagnostic to its own root interval, retains overlaps
and unexplained time, and does not label residual wall as CPU. Sampling is not
exact allocation or wall attribution. Driver await is not server execution;
decoded JSON bytes are not wire traffic or heap allocation. Collector overhead
is measured and disclosed rather than subtracted to invent quiet latency.

Start with one connected existing `mixed-product` report, not every flow and
mode at once. A first cutover must make the current request explainable and
validate the observation contracts before extending the matrix. The owning
preflight requires affected checks, deterministic accounting witnesses, real
database/native lanes, both reviews, shared-file handoff, cleanup and a scoped
commit. It grants no claim of improved core performance merely because the SDK
can collect more data.
