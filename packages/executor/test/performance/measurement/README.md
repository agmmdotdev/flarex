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

Core owners contribute only through their existing small observation hooks.
Add a missing hook only when a specific measurement cannot be captured at the
current boundary. The hook carries domain-owned scalar evidence and is supplied
by trusted fixture composition. The SDK converts this evidence into its private
artifact shape. That conversion is observation translation, not another business
or authority path. A core module should not construct a measurement client,
register metric names, assemble tracing contexts or import the SDK's event types.

No singleton, ambient cross-request recorder or per-owner SDK instance is
selected. Correlation, buffering, timing and observer-cost accounting stay inside
the scoped collector. Preserve full outcomes, cancellation, evaluation order
and existing resource ownership; instrumentation introduces no extra runtime
bridge per event, database command, transaction or settling capability.

## Internal Modules

The proposed layout gives each responsibility one owner:

```text
measurement/
  index.ts           two high-level exports
  run.ts             bounded session and existing scenario composition
  artifact.ts        one observation schema and derived internal types
  analysis.ts        pure interval, attribution and pair calculations
  report.ts          rendering and post-request artifact persistence
  collectors/        bindings to existing database, CPU and server collectors
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
