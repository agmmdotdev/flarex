# Direct Core Performance Harness

## Status And Outcome

Implemented for the bounded five-scenario graph. The daily measurement loop uses
`packages/executor/test/performance/`, composing the actual Payload Local API,
Medusa workflows and Flarex execution/persistence owners directly in Node.
The initial scope replaces test composition, not runtime admission, transaction,
journal or publication semantics. After the direct runner reproduced both mixed
failures, the owner additionally authorized fixing those failures at the shared
owner and optimizing the measured harness costs. This is a bounded resumption of
slice 20's failing connected consumers, not approval to silently replace its
authority, transaction, journal or publication contracts.

The daily runner separates one optional SQL diagnostic from quiet request samples,
retains bounded native seed hosts, and reports setup and cleanup explicitly.
The shared source-preparation and finite document-rejection defects described
below are corrected at their persistence owners. The
[measurement ledger](../../packages/executor/benchmarks/core-performance/README.md)
owns direct-run observations and remaining cost attribution. Cold readiness and
index construction still prevent consistently meeting the selected command and
matrix targets; native request parity remains outside this harness completion.
Historical full framework measurements retain their original cohorts and host
boundary. Standalone Payload and Medusa already invoked framework hosts directly,
so removing Worker transport alone does not explain their harness improvement.

The owner selects the [cost-attribution successor](#selected-cost-attribution-successor)
below: precise evidence for choosing core changes, with small measurement APIs
and explicit owners. This is a recorded design, not an implemented measurement
cutover. Runtime redesign and new benchmark runs remain paused for discussion.

## Ownership And Execution Contract

- Executor test support owns complete mixed scenario composition and the direct
  test driver. Framework adapters retain their native operations and workflows;
  persistence retains database setup, admission, execution and settlement mechanics.
- Core measurement must not import backend runtime, Miniflare or Workerd. Host
  integration tests receive their Worker driver explicitly and share the same
  scenario assembly. No production dependency on the framework adapters is added
  to executor or persistence.
- Reuse the existing runtime-neutral execution contract and restricted journal
  capabilities. A trusted in-process fixture is not a sandbox or hosted-security
  proof. Preserve normalized inputs, syscall ordering, framework hooks, pending
  state, fresh authority checks, OCC, seal, publication and real commit behavior.
  The direct transport adapter captures inputs before queueing and checks exact
  acknowledgements inside its terminal-failure boundary. Only authenticated point
  document-validation refusals retain the existing catch-and-retry behavior;
  participant failures and malformed acknowledgements still abort drain.
- Prepare one database installation and bounded framework host per selected
  series. Each invocation gets fresh request/attempt state and isolated input.
  Do not cache authority across requests or substitute an enclosing rollback for
  real transaction settlement. Setup and seeding remain outside request timing.
- Default to one selected scenario and a short warm series. Full sampling and SQL
  diagnostics are explicit options. SQL diagnostics use a separate invocation;
  small sample sets report observations and median without a P95 claim.
- Report loading, preparation/provisioning, seeding, request execution, checks,
  cleanup and total runner wall time where those boundaries are available.
  Failed invocations remain failures with partial counts clearly identified.

## Replacement Inventory

| Existing contract or path | Disposition |
| --- | --- |
| Backend-owned shared mixed fixture assembly | Move to executor test support; migrate all actual test consumers and remove the displaced assembly. |
| Worker construction and dispatch in shared fixtures | Extract as an explicit backend test adapter; retain for Worker lifecycle, transport and isolation witnesses. |
| Standalone Payload preparation in its latency test | Extract reusable test preparation; preserve the existing operation, admission and catalog assertions. |
| Medusa standalone workflow preparation | Reuse its adapter-owned fixture and real workflow host. |
| Full backend performance matrix | Retain as an explicit host integration measurement; it is no longer the default daily core loop. |
| Existing benchmark reports and raw evidence | Retain as historical measurements with their original execution boundary. Never relabel them as direct-core results. |
| Runtime/public APIs, schemas and durable journal formats | Unchanged; no migration or durable-data deletion. |

No compatibility forwarding wrapper is needed for moved private test assembly:
migrate its consumers in this slice. Host adapters remain because named Worker
tests still need them, not as a fallback for the direct runner.

## Validation And Completion

1. Focused CLI/report tests cover scenario selection, sampling, failures and
   cleanup. Typecheck affected test composition and preserve source boundaries.
2. Exercise actual standalone Payload and Medusa plus mixed Product against an
   ordinary PostgreSQL role. Keep an affected fast PGlite correctness witness.
3. The direct mixed Payload/workflow paths must reproduce the paused failures or
   explain their difference with concrete boundary evidence. Do not bypass the
   failing admission or raise budgets. The owner's follow-up authorizes correcting
   the reproduced `LogicalSourceAdmissionError: sourceMismatch` at its actual
   owner, with a focused witness and unchanged authority/isolation guarantees.
4. Check real committed results and rollback behavior, and a focused Worker
   integration witness after driver extraction. Detailed runtime recovery suites
   retain their own scope; a passing direct run is not hosted acceptance.
5. Measure command-to-exit wall time and disclose setup costs. A selected warm
   scenario target of 5–15 seconds and small-matrix target below one minute are
   engineering targets, not assumed results. Missing targets require attribution,
   not hiding work outside the reported runner total.
6. Both project reviews, affected checks, cleanup of displaced paths and a scoped
   commit complete this harness slice. Stop owned validation resources afterward.

This does not close slice 20, establish native parity, change production compute
hosting, or authorize broader framework capabilities.

## Authorized Failure And Iteration-Cost Follow-Up

Both direct mixed Payload and workflow requests reproduce the existing Worker
failures before publication. Their preserved nested errors identify
`LogicalSourceAdmissionError: sourceMismatch`. The localized defect is the
transaction-local full-binding observation reuse in
`logicalDocuments/sourceAdmission.ts`: a later prepared source can return from
the shared binding check before its bounded selected-projection preparation has
been initialized. The Product selection has that state while Payload or another
workflow source does not, so the later finite query-required read refuses it.
The replacement must carry genuinely authenticated preparation through the shared
observation with exact target/binding identity and bounded lifetime. A structurally
similar or foreign token must not acquire authority. Preserve the rejecting
witness and correct this owner rather than omitting the failing operation.

The selected private repository extension transfers only the immutable,
repository-authenticated selected structure from a successful shared binding
observation into the recipient source's own bounded preparation. Both leases must
be open; target location, protection token, database/epoch identity and retained
head sequence/digest must match. The destination retains its own preparation
lifetime and byte charge. This adds no SQL, transaction or settling authority;
later fresh head/schema/demand and final-guard checks remain required. Repository
tests must refuse foreign, stale, mismatched or closed preparations and preserve
detached output ownership. No schema or durable-format migration is needed.

A new recipient requires the accepting transaction's protected final guard and
real bounded donor and recipient leases. An already retained recipient with the
same authenticated identities and head needs no second retention or byte charge.
That no-op must also work during full publication verification, where fresh full
SQL authentication has already happened without a selected-read final guard.
Requiring a guard for that no-op incorrectly refuses final commit; omitting it
for a new recipient would weaken the selected-read preparation contract.

Completion requires successful native Payload/workflow results, real atomic
publication, relevant refusal/rollback coverage, and the affected ordinary-role
PostgreSQL/PGlite checks. Record a materially changed correctness contract here
before implementing it. No public API, durable-data deletion, production host
lifetime change or wider finite settlement redesign is included.

Harness cost work must attribute module loading, migration/installation, framework
preparation, seeding and cleanup before selecting a correction. Transform caching
may reuse compiled test modules; it must not cache request outcomes, live authority
or database state across unrelated runs. Reusing a migrated test installation
requires explicit isolation, cleanup and invalidation behavior. Keep command wall
time visible, and compare the same selected scenario and sampling plan.

The selected setup optimization retains native seed/read/tag-retirement hosts
inside one finite series, with fresh request keys and independent real commits.
Independent disposable control/target provisioning may overlap; both operations
must settle before failure cleanup begins. Readiness/index builders retain their
existing scope-clock ordering. Cold catalog/admission/index construction remains
the main iteration cost; reusing state across commands would require a separately
defined prepared-session lifetime and invalidation contract.

## Connected Pre-Effect Validation Correction

The real direct/Worker transport comparison exposes a second shared-owner
contradiction: the finite point journal unconditionally aborts and discards its
retained evidence when Application document validation rejects a proposed write.
The runtime and executor RPC permit the caller to catch that authenticated
pre-effect rejection, but its next valid call then receives `journalFailed`.
This violates the accepted mixed design's catchable pre-effect validation
contract; changing the transport cannot repair the finite journal state.

The owner's failure-fixing follow-up includes correcting that actual journal
owner. Extend the bounded runtime inventory to `sessionJournalStore.ts` point
failure classification. Preserve the rejected operation's error, earlier accepted
work, and the unconsumed syscall sequence. The exception is only one genuine
typed document-validation failure from the validator before staging any point,
receipt, counter, creation cursor or write event. Defects, interruption, combined
causes, authority/storage/final-guard failures and framework failures remain
root-aborting. This is not savepoint recovery and does not add a transaction,
change durable formats or make partially staged native work catchable.

Correlate the exception to the exact error object emitted at the document
validator, rather than exempting every matching class from the outer transaction.
Insert planning only chooses a candidate identity/time before validation. Patch
and replace planning may hydrate a point-read cache entry; on this precise
rejection remove only an entry newly introduced by that operation, preserving
pre-existing reads and accepted work. Keep final-guard and combined failures
outside that exception.

Validate the real rejected-then-valid operation through both transports and
PGlite/ordinary PostgreSQL. Include earlier accepted work, unchanged rejection
sequence/evidence, committed output and terminal-failure witnesses. Both reviews
must inspect the staging order and exception identity before this slice closes.

## Selected Cost-Attribution Successor

### Outcome, Scope And Current Gaps

Explain a complete request's cost, identify repeated work and database exchanges,
and establish whether a selected core change actually removes its claimed cost.
Extend the existing direct harness, trace and complete native-reference owners;
do not introduce a general tracing framework, production observability package,
metric registry or parallel benchmark engine. More observations are useful only
when their units, owner, timing boundary and collection cost are explicit.

The owner additionally selects a dedicated, test-only
[measurement SDK folder](../../packages/executor/test/performance/measurement/README.md)
with one public entry point. It constructs and connects collectors inside the
measurement runner. Core modules do not import this SDK, its artifact types or
Node tools, and do not construct measurement infrastructure. Existing narrow
owner observation hooks are injected at the trusted fixture boundary; missing
evidence may add a proportional hook at its real owner. No reverse dependency,
core-wide instrumentation registry or per-owner SDK client is selected.

The current persistence test trace already records nested phases, child-union
exclusive time, query awaits, checkout awaits, transaction lifetimes, structural
SQL fingerprints, parameter/result sizes and observation failures. Its
reconnaissance mode retains ordered events and source owners. The committed
direct runner uses grouped measurement mode and omits those ordered records and
owner mappings; its SQL summary also omits checkout/transaction groups. Separate
wait unions do not form a complete disjoint wall-time ledger. Trace preparation
and decoded-result sizing run inside the invocation without separate observer
accounting. The retained native reference does not run fresh comparison pairs.

The graph-expansion work belongs to preflight 25,
and native business semantics belong to [preflight 26](./26-native-business-baseline-preflight.md).
Reconcile their actual committed handoff before modifying shared files. Preserve
unrelated dirty work. This successor selects no runtime optimization, new
framework capability, authority change, hosted activation or durable-data change.

### Owners And Small API Contract

| Responsibility | Existing owner | Selected boundary |
| --- | --- | --- |
| Scenario execution | Executor performance composition and measurement SDK | Select one validated plan, own setup/seeding/verification/disposal, and invoke real native or Flarex requests. |
| Observation | Persistence test trace and existing harness CPU/server collectors | Capture immutable scalar evidence at actual boundaries; retain query/client/transaction identity and request lifetime. |
| Analysis | Measurement SDK analysis module | Pure calculations over validated retained observations: interval accounting, coverage, owner costs and paired excess. |
| Presentation | Measurement SDK report module | Render the same analysis as machine-readable evidence and a concise human report; own no calculations or acceptance policy. |

Only `measure(options)` and `compare(options)` are proposed SDK
entry operations. They own the complete measurement lifetime and return a
retained report reference and status. Callers import neither collector factories
nor internal event/phase/SQL/artifact types. Configuration is decoded once by
the SDK. Scenario definitions remain with the existing scenario owner; do not
duplicate business assembly or scenario selection inside the SDK. The CLI is a
thin consumer. Internal trace operations below are not public SDK exports.

Extend the existing trace's `withInvocation`, `withPhase`, scoped callback
binding and record draining. Do not add alternative Promise/Effect wrapper
families or a new executor. Phase identity is a typed owner/operation site;
request, event, parent, connection, checkout and transaction identities are
distinct. SQL fingerprints describe query structure; source-owner attribution
is separate and may be ambiguous. Stable owners come from actual source sites
and existing owner hooks, rather than a configurable string-matching registry.

Where actual core work needs additional evidence, use one narrow synchronous
observation sink through existing trusted fixture composition. Its events carry
an owner/site, request identity and bounded scalar counts/durations. It cannot
carry database authority, callbacks, full mutable working sets or new lifecycle
decisions. Do not add a runtime bridge per measurement event, duplicate business
logic in the harness, or introduce a second transaction/finalizer. Effect-owned
operations preserve their requirements, evaluation order, full failure outcome,
interruption and resource lifetime. Deliberate foreign Promise boundaries remain.

One measurement-artifact Schema owns retained shapes and intrinsic validation;
derive types from it. Existing domain codecs retain their own authority. Analysis
is a pure total calculation with explicit invalid/incomplete evidence results.
Capture clock/source identity once at the session boundary. Report modes and
limits are explicit data rather than combinations of loosely related booleans.
Missing, estimated, ambiguous and observed values are distinct; unavailable
measurements are never zero. A failed observer retains the primary request
outcome and marks diagnostic evidence incomplete rather than hiding either.

### Evidence Lanes And Observation Cost

Use separate lanes for distinct questions, sharing scenario identity and evidence
format without presenting observations from different requests as one trace:

- Quiet comparison owns actual request distributions and fresh native/Flarex
  pairs. No query stack collection, result serialization, CPU profiler or server
  tracing runs in its request interval.
- Timeline/database diagnostics retain ordered raw intervals, actual source
  ownership, checkout and transaction detail, bytes/rows and coverage failures.
  A bounded lighter timeline mode may explain owner boundaries, but its timing
  remains instrumented and requires its own perturbation comparison.
- CPU diagnostics retain original profiles, actual sampling intervals, request
  clock alignment, sampled self/inclusive stacks, GC, idle and inspector start/
  stop. Samples estimate CPU attribution; they are not exact wall accounting.
- Server diagnostics observe query execution and waits only through supported,
  authorized PostgreSQL instrumentation. Retain backend/query identity, settings,
  nesting and contention visibility. Aggregate statistics without exact request
  correlation cannot be relabelled per-request server cost.

Measure the observer's fingerprint/input work, source-stack capture, result
sizing, event recording and finalization at their actual positions. Render and
write reports after request settlement. Record bounded buffer capacity and any
dropped observations; truncation makes the relevant attribution incomplete.
Compare equivalent requests with and without each observer mode. Never subtract
an estimated observer cost to manufacture a quiet result. Decoded JSON bytes,
wire bytes and heap allocation remain different units.

### Complete Accounting And Required Report

Retain a monotonic invocation interval and ordered events before aggregation.
A deterministic sweep of interval endpoints partitions the root wall into
disjoint observation states. Each state records active phases, query/checkout
awaits and observer work. Preserve overlapping phases/waits explicitly; do not
arbitrarily choose one owner or add overlapping durations. Produce separate
phase and wait ledgers over the same partition, never add those ledgers together.
Their totals must reconcile to request wall within disclosed clock/rounding
precision. Uncovered or unexplained time stays visible. Reconciled accounting
does not establish complete semantic attribution.

Every report must provide:

- Complete native and Flarex distributions, paired excess when genuinely measured,
  warmups, all failures/tails, input cardinality, semantic differences and source/
  environment identity. Setup, imports/construction, seeding, verification,
  request cleanup, family disposal and command-to-exit cost have explicit,
  nonduplicated boundaries. Existing request envelopes remain comparable.
- An ordered request timeline and disjoint wall ledger, owner attribution coverage,
  unknown/ambiguous/overlap regions and instrumentation cost. Remaining wall
  cannot be called CPU, network, lock wait or framework cost without evidence.
- Each driver exchange's site, purpose, fingerprint, timing, input size and returned
  rows/bytes, linked checkout/connection/transaction, failures and settlement.
  Nested server statements and driver exchanges are separate counts. Driver await
  includes scheduling/driver/server/transport work until completion; report only
  the subparts actually observed. Retain real COMMIT and uncertain-outcome time.
- Actual owner work counts where available: original-row retention, pending reads/
  writes, capture/cache observations, copies, encodes/decodes, validation/hashing,
  frozen graph construction, materialization and publication. Measure counts or
  byte volumes at the real owner; do not create another copy to count copies.
  Framework call/hook/child/retry boundaries retain native semantics. Ordinary
  retained-row growth is not a substitute for executed work or allocation.
- Aligned diagnostic CPU families, process/event-loop/GC and database wait evidence
  when available, with collection mode and uncertainty. Link original artifacts
  and integrity hashes. Different lanes remain different requests.

### Native Pairing And Causal Decision Gate

Extend the current scenario/native composition boundary to execute fresh matched
pairs with declared ordering and pair IDs. Preserve actual framework operations,
versions, inputs, cardinality, hooks, returned results, real acknowledgements and
construction lifetime. Keep independent native commits and the Application SQL
surrogate limits explicit. Compute each pair's complete request excess before
percentiles. Preflight 26's five-millisecond added median / ten-millisecond added
P95 and sampling policy remain unchanged. Reference-only historical numbers do
not become pairs. Unmatched graphs retain an explicit missing-reference status.

Before a runtime correction, name the responsible owner, measured repeated work,
proposed removal and expected observable effect. Compare a pinned baseline and
candidate under the same harness and observation mode, retain all failures and
source/environment stability evidence, and check both the selected cost and the
complete request. A fall in SQL count or an isolated profile stack is insufficient.
Control the benchmark resources and disclose detected interference; do not infer
exclusive machine resources from a single boundary snapshot. Stop repeating full
measurements when no new hypothesis, source change or acceptance question exists.

### Cutover, Validation And Completion

First deliver one connected `mixed-product` attribution report using the existing
real scenario, not a new measurement matrix. Exercise timing/interval invariants,
overlapping work, raw event ordering, unknown owners, source changes, observer
overhead, dropped/lost context, foreign failures, cancellation and cleanup. Pure
interval analysis needs deterministic witnesses; real query/transaction claims
need PGlite assembly and focused ordinary-role PostgreSQL validation. Fresh native
pairing needs the actual native PostgreSQL implementations. Keep setup, observer
calibration and final quiet acceptance distinct and bounded by one concrete goal.

Changes to private trace/report shapes may break; migrate connected report/test
consumers and remove displaced grouping/selection/calculation paths in the same
slice. Historical artifacts remain immutable with their original limitations;
they require no parallel runtime measurement engine. Remove duplicate report
math, schemas and observers rather than adding compatibility wrappers. Existing
Worker integration and separate native collectors remain for their named lanes.

Implementation requires affected checks, applicable core/diff/staged lint, both
project reviews, explicit shared-file ownership, complete cleanup and one scoped
commit. A successful measurement-system cutover proves observation contracts,
not a Flarex latency improvement. Runtime work and new measurements remain paused
until this concrete design and the shared harness handoff are reconciled.
