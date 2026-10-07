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
and explicit owners. The SDK covers the adopted 25-flow catalog with
quiet/timeline/resources/database/CPU/server diagnostics; matched native
comparisons cover the five original small graphs. The
[complete cost-attribution continuation](#selected-complete-cost-attribution)
uses lighter operation resource brackets and fresh alternating observer pairs
to distinguish repeated mechanics from required semantics before selecting
another runtime redesign. Native-relative performance acceptance remains open;
diagnostic completion does not close it.

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
The owner also accepts focused core refactoring for internal measurement. The
SDK constructs diagnostic Effect Layers using the existing Tracer service;
core operations use named spans and bounded scalar work observations. Production
and quiet comparisons provide no measurement Layer or collectors. This expands
the observation design, not transaction, authority or business semantics.

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

Only `measure(options)` and `compare(options)` are public SDK
entry operations. They own the complete measurement lifetime and return a
retained report reference and status. Callers import neither collector factories
nor internal event/phase/SQL/artifact types. Configuration is decoded once by
the SDK. Scenario definitions remain with the existing scenario owner; do not
duplicate business assembly or scenario selection inside the SDK. The CLI is a
thin consumer. Internal trace operations below are not public SDK exports.

Failed execution retains original sample and cleanup causes in a tagged SDK
rejection carrying the same report/status fields. Persist only bounded ordered
stage-specific reason kinds and safe tags; diagnostic tracer failures use the
actual full Exit/Cause. A quiet foreign rejection cannot reveal reasons already
squashed by an existing framework/runtime bridge. Do not infer them from error
classes or install tracing in quiet calls. Preserve single original failure
identity and every original member when request, cleanup and artifact persistence
fail together. Missing observations remain an explicit incomplete report.

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

The first connected report and SDK-composed Effect Layer are implemented. Its
original cohort was small `mixed-product` with quiet/timeline/database and
30-pair capacity. The selected diagnostic completion below supersedes that
cohort gate: the owner explicitly transfers the frozen scenario expansion here,
including its 105-attempt fixture capacity. All 25 catalog flows are available to
`measure`; matched native `compare` remains the original five small graphs.
This changes fixture capacity, not core runtime budgets.

Completion requires affected checks, applicable core/diff/staged lint, both
project reviews, explicit shared-file ownership, complete cleanup and one scoped
commit. A successful measurement-system cutover proves observation contracts,
not a Flarex latency improvement. Runtime optimization remains paused; selected
SDK correctness and attribution measurements are authorized. The broader
benchmark handoff is accepted; unrelated chats retain their unrelated work.

The [retained first-cohort reports](../../packages/executor/benchmarks/core-performance/measurement-sdk/README.md)
demonstrate connected collection and fresh native construction, not latency
acceptance. Reconciled diagnostic wall accounting retains substantial unknown
and ambiguous owner time. In that first cohort, CPU/GC, server execution, lock
waits and transport were unavailable; conservative source ownership was an
explicit evidence gap. The diagnostic completion below extends these lanes.
A complete report does not imply every bottleneck has been identified. Runtime
work must still select a measured owner and a concrete removal hypothesis before
new performance iterations.

### Selected Operation-Context Continuation

The owner authorizes continuing the measurement system. The next connected
slice restores tracing across existing framework/transaction Promise runtimes
and correlates actual database submissions to retained operation identities.
It remains measurement work: no core latency optimization, new framework
capability, transaction authority, schema, durable format or hosted activation
is selected. Its earlier CPU/server and scenario gates are superseded by the
selected diagnostic completion below.

The first retained PostgreSQL report exposes the defect precisely. Its 40 driver
exchanges have no operation parent; 27 lack source ownership and the remaining
13 identify the physical-session query proxy. Source stacks cannot reconstruct
asynchronous operation ownership. Medusa DAL construction, located read bodies
and publication transaction bodies start independent Effect runtimes without
the enclosing tracer/parent. Existing named relational operations therefore
disappear from the collected request. The publication observation decorator
also needs to supply its tracer at its actual independent runtime boundary.

The existing owners remain responsible:

- Medusa's Promise owner captures only the injected tracer and current parent
  inside its owning Effect. Its service/workflow consumers acquire that factory
  through Effect; cancellation, sticky refusal, pending tracking and close/join
  stay with the same owner. The private synchronous factory contract breaks;
  migrate its two runtime callers and four test callers without a wrapper.
- Persistence's existing Effect transaction and located-read callback bridges
  carry the same minimal tracing Context into their existing runtimes. Do not
  transfer business services, Clock, transaction capabilities or another Scope.
  Preserve callback Cause identity, rollback signals, cleanup and settlement.
- The SDK's publication decorator supplies the collector tracer and enclosing
  parent. Core modules continue to import no SDK or artifact types.
- The existing persistence test trace snapshots one synchronous request-local
  operation identity at pool submission/direct-client query and checkout entry.
  Pool delegation retains the initiating snapshot rather than sampling a later
  pg callback. The SDK binds that reader, translates retained identities after
  settlement, and keeps source provenance separate from semantic ownership.
  Transaction lifetime is not parented to a shorter BEGIN operation.

No new telemetry service, global registry, SQL classifier, per-query runtime
bridge or configurable owner map is selected. Missing, dropped, foreign or
escaped operation contexts remain explicit gaps or invalid/incomplete evidence;
never assign them by overlapping timestamps or a generic callsite.

The request supervisor's span is a coordination lifetime: it forks and joins
the body/heartbeat while the fixture body awaits completion. Keep its interval
and the current conservative deepest-operation ledger. Add a separately named
nearest-known operation-context summary, retaining unknown descendants and
coordination overlap. That summary establishes enclosing responsibility, not
CPU, exclusive execution cost or deepest-operation ownership. Concurrent
foreground leaves with different known owners, or known and unresolved contexts,
remain ambiguous. Concurrent leaves with the same known owner retain all their
identities and overlap while establishing that owner's enclosing responsibility.
Do not upgrade strict coverage merely by
discarding unknown children or a waiting supervisor.

Completion requires direct-parent correlation tests through same-SQL operations,
pool delegation, concurrent fibers and isolated requests; observer faults,
missing parents and original Promise/callback/error semantics; original full
Cause and joined-cleanup tests for changed bridges; and deterministic witnesses
distinguishing strict attribution, contextual responsibility and coordination.
One connected PGlite diagnostic and one ordinary-role PostgreSQL diagnostic must
expose existing relational/transaction-body spans and link real driver exchanges
without extra business SQL or lost context. Keep quiet collector absence and
the actual committed Application/Product checks. Retain the new raw/human
evidence, run affected typechecks, source-boundary guards, lint and both reviews,
remove displaced construction and commit one scoped slice. Existing historical
reports remain immutable; unrelated uncommitted harness expansion is excluded.

This continuation is implemented. The private Medusa factory's callers use its
owning Effect; existing persistence callbacks and publication retain tracing
through their actual runtimes. Driver observations carry exact operation parents
and separate source provenance. Strict attribution, enclosing owner responsibility
and coordination remain distinct, with unknown and competing contexts visible.
The [retained operation-context reports](../../packages/executor/benchmarks/core-performance/measurement-operation-context/README.md)
expose deeper named framework/publication operations and their SQL links. Complete
correlation is not complete semantic ownership or a core performance improvement.
These operation-context-only reports lack CPU/server evidence; the diagnostic
completion below owns its extension. Runtime optimization remains paused.

### Selected Diagnostic Completion

The owner now authorizes implementing the missing CPU/GC/allocation and
PostgreSQL server/wait diagnostics through the same SDK, and broader workflow
coverage to support the next core design decision. This replaces the earlier
deferral of these diagnostic lanes. Runtime optimization, business/schema
changes, hosted activation and arbitrary framework expansion remain separate.
The SDK retains `measure` and `compare` as its only public entry points; diagnostic
requests stay separate from quiet native pairs. Production imports no collector.

The `cpu` lane owns one request-local Node inspector session, CPU sampling,
sampled allocation stacks including major/minor-collected objects, asynchronous
GC observation, process/thread CPU counters and timestamped memory endpoints.
Start after sample preparation and stop after the actual call settles, before
verification or artifact export. Preserve separate profiler-command brackets,
complete call and Effect-root windows. CPU sample clocks have bracketed alignment
and explicit uncertainty; allocation ordinals have no timestamps and remain
window-level evidence. CPU counters are process/thread observations, sampled
stack weights are estimates, and memory deltas are occupancy rather than total
allocation. Do not infer exact CPU, allocations, copies or per-span allocation.
No heap snapshots, Runtime object inspection, debugger opening or payload capture.

Inspector setup, command drainage, every started-profiler stop, GC delivery drain
and disconnect share one scoped collector lifetime. Expected setup/cleanup
failures invalidate diagnostics without replacing the original business Cause.
Serialize SDK diagnostic commands and refuse known conflicting profiler/debugger
configuration; record the limit of isolate-local conflict detection and external
contention. Bound retained nodes, samples, depth, labels, duration and exported
bytes. Timer expiry ends observation, not business execution; V8's transient
profile memory and timers delayed by synchronous JavaScript are not hard bounds.
Sanitize generated/external source paths and labels at the inspector boundary.

The `server` lane owns a disposable isolated PostgreSQL database, supplied through
the existing fixture preparation owners by explicit endpoints. Provision its
settings and a read-only observer outside timed requests; keep executing roles
ordinary and durable. The fixture remains the schema/installation/business owner.
Do not mutate process environment to redirect module-captured database inputs.
Reuse existing server snapshot/plan collection responsibilities when their
isolation and lifetime contracts fit, rather than reproducing business queries.
The observer covers all actual executing roles, including SECURITY DEFINER work.
No global statistics reset, synthetic write replay, EXPLAIN ANALYZE mutation or
authority/transaction change is selected.

Capture actual backend PID at driver submission without another SQL command.
Server counter deltas retain database/user/query identities and reset/deallocation
guards. Bounded activity/wait/blocker observations retain their sampling times,
query identities and unavailable states. Actual backend observations may identify
operation-overlap candidates; a SQL text, fingerprint or concurrent timestamp is
not proof of a unique initiating operation. Parent/child server statements and
plan timings are non-additive. Driver await, server elapsed time, sampled waits
and network/queue residuals remain distinct evidence with explicit limitations.
Any optional actual-plan collection has a separately validated bounded log
source and settings; absence is unavailable, never zero. Restore/close every
owned observer and fixture before removing its disposable database.

Installation and diagnostic activation have distinct boundaries. Keep plan
logging disabled during fixture migrations. After preparation, arm only the
owned target database and retire the fixture's verified idle serving sessions
through the public pool API so replacement sessions inherit the diagnostic
defaults. Prove ordinary role, database identity and idle ownership before
arming; busy pools fail closed. Verify effective runtime settings before warming
or timing. No backend termination, timed SET calls or runtime limit changes are
selected. Administrative setup/cleanup has a separate bounded 30-second budget;
the default sampler query budget remains one second. Internal observation and
file resources use Effect scopes; business Promise callbacks keep their original
settlement and rejection identity.

Workflow coverage reuses the real existing scenario/verification owners.
The frozen expansion is adopted by this chat after explicit ownership
transfer; no uncommitted dependency or broad Git staging is selected. Once
transferred, revalidate the handed-off flows against the committed
core, migrate SDK consumers coherently, and retain source/fixture/native limits.
Extra scenarios without a matched native graph may be measured diagnostically
but cannot claim paired acceptance. Future framework capabilities remain gated.

Completion requires deterministic profile/counter/clock/bounds/privacy witnesses,
original failure and partial-acquisition cleanup, conflicts and quiet absence;
real Node profiler proof; connected PGlite and ordinary-role PostgreSQL proofs;
actual server execution and controlled lock-wait evidence without extra business
SQL; affected typechecks, source guards, lint, both reviews, retained raw/human
evidence, displaced-path cleanup and scoped commits. The final report must name
every remaining unavailable or ambiguous category. Even combined diagnostics
cannot promise discovery of every possible future bottleneck.

### Exact Actual Plan Identity

Actual-plan evidence retains the direct JSON root's `Query Identifier` as a
canonical signed-int64 decimal string, independently of the logged `%Q` context.
The latter can name a prior or enclosing query and is not a plan identity.
Capture the numeric token before JavaScript number rounding; reject duplicate
root identifiers and malformed/noncanonical values. An omitted plan identifier
is explicitly unavailable, with no header fallback. SQL text and parameters stay
excluded. Existing archived evidence retains its original format and limitation;
do not reinterpret its logged identifier as the plan's identifier.

### Selected Complete Cost Attribution

Implemented SDK contract. The [current owner inventory and evidence](../../packages/executor/benchmarks/core-performance/complete-attribution/README.md)
separates finite mixed execution from standalone CMS and Medusa profiles. Their
different admission, definition, readiness and settlement contracts must remain
explicit in the connected redesign. Fresh authority and durable atomic outcomes
remain requirements; repeated immutable reconstruction and proof transport are
replacement candidates. Exact quiet per-function CPU and PostgreSQL server CPU
remain unavailable rather than inferred from elapsed or overlapping counters.

The owner requests enough current-source attribution to select the connected
core redesign. Aggregate latency, instrumented SQL totals and sampled stacks
have not yet ranked the quiet gap by responsible work. This continuation adds
a low-observer `resources` measurement through the existing SDK, driver trace
and actual scenario owners. `measure` and `compare` remain the only public
entry points. Production and quiet composition remain collector-free.

Resource diagnostics retain operation wall intervals, coarse process/thread CPU
counter brackets, exact originating operation identity, driver submission and
completion, checkout, backend PID, outcome and recognized plain transaction
controls. They omit SQL fingerprints, source stacks, input/result serialization,
heap sampling, inspector and server logging. The existing driver trace owns this
lighter detail profile; absent statement, row and byte evidence is unavailable,
not zero. Full database diagnostics keep their query-shape evidence. CPU/server
diagnostics use resource-only driver detail so unrelated reconnaissance does not
obscure the question. Counter intervals are inclusive process/thread observations;
concurrency, observer cost and platform counter resolution prevent exact causal
per-function CPU claims.

First classify already named, source-proven operations and preserve genuinely
unknown or competing children. Observe capture preparation, execution/mapping
and acceptance, entry construction/acceptance, result verification/root freeze,
command preparation, actual publication families, and complete call cleanup at
their real boundaries when the first resource pass shows a material grouping
gap. Counts cover actual captures, rows, memberships, definitions and already
known bytes, with no per-row Context lookup, payload copy or serialization for
measurement. SDK composition constructs diagnostics; core owners carry only their
existing tracing or observation capability. No new authority, transaction,
business service, universal telemetry registry or alternate execution path is
selected.

Use the retained quiet native comparison as the acceptance reference. Calibrate
the minimal observer against fresh quiet Flarex calls in ten alternating pairs
after five warmups; this is an observer comparison, not native acceptance, and
its difference is never subtracted to invent quiet timings. A first pass and at
most one targeted refinement must answer which owner work is repeated, which
database exchanges are distinct demands, and which source-proven repetition has
enough measured cost to change the design. Bound the primary mixed-Product
campaign to 35 fresh attempts. The other original profiles have separate bounded
resource diagnostics only where their admission/transaction contract differs;
do not combine them into one latency population. Additional CPU/server requests
must resolve a named question, rather than repeat aggregate gap measurements.

Completion requires current complete committed readback, reconciled operation
and driver intervals, observer comparison, intentional unavailable fields,
original values/Cause/cancellation and joined cleanup, ordinary-role PostgreSQL,
focused deterministic collector proofs, affected typechecks/lint, both reviews,
safe retained evidence and a scoped commit. Record the redesign inventory with
required semantics, measured repeated mechanics, affected owners and remaining
uncertainty. This investigation does not claim knowledge of every possible
future bottleneck or authorize speculative performance changes merely to improve
an isolated helper.

#### Selected Root CPU Attribution

Implemented private SDK contract. Root observation separates inspector CPU/GC evidence from full Effect,
driver and publication observation. `measure({ mode: "cpu", observation:
"root", ... })` profiles the existing complete `sample.run` call without an
Effect collector, primitive-evaluation hook, driver trace, publication observer
or heap sampling. Default CPU diagnostics retain their existing full detail.
The CPU collector owns its genuine call window independently; reports retain
raw CPU evidence, analysis and profiler faults even when Effect normalization
is absent or fails. No synthetic span, per-owner CPU attribution or replacement
business execution path is introduced.

The collector accepts `allocations: false`. Its evidence records whether
allocation sampling was enabled; disabled configuration, profiles and windows
are explicitly absent. Analysis distinguishes intentionally disabled allocation
evidence from failed capture, and only requires heap evidence when enabled.
This changes the private CPU artifact contract: current producers, fixtures,
analysis and rendering migrate together. Historical saved artifacts remain
retained investigation records; no durable application data or execution
protocol changes. Existing real failure, interruption, bounded profiler stop,
resource exclusivity, committed readback and joined cleanup semantics remain
requirements.

Root CPU diagnostics use the existing alternating quiet/diagnostic Flarex pair
policy. Five warmups and five pairs consume exactly fifteen fresh attempts;
there is no extra hidden calibration call. The comparison retains both real
calls and discloses observer effects without subtracting them or claiming
native acceptance. Profiler acquisition and release are outside the timed
business call, while their actual capture boundaries remain in raw evidence.
Inspector sampling and GC observation still perturb execution; sampled stack
weights, process CPU and overlapping GC intervals do not establish exact
exclusive function CPU, scheduler delay or PostgreSQL CPU.

Use Application + Product as the primary graph. Rank actual retained sampled
stacks against current source, distinguish required business/settlement work
from repeated immutable reconstruction and orchestration, and select a core
owner only when demonstrated whole-call cost supports a substantial change.
Allow at most one targeted refinement, with thirty-five fresh attempts as the
total campaign bound. Investigate exceptional mixed-workflow stalls as a
separate named question; quiet artifacts cannot retrospectively supply missing
CPU, GC or server evidence. The five-graph suite remains a group milestone
after an evidenced core change, rather than the default loop for this SDK slice.

Completion requires deterministic disabled-heap and independent-evidence
proofs, real inspector lifecycle and failure preservation, proportional SDK
typechecking/lint, ordinary-role PostgreSQL complete-call diagnostics, both
reviews, retained raw artifacts and a scoped commit. Earlier unrelated dirty
core changes remain outside this slice and outside its review and commit.

The focused SDK type project uses the promoted framework's actual portable
declaration. The upstream comparison island has the same package name/version
but a different export facade, so an undifferentiated type graph can select
the wrong declaration owner. This verification binding follows the adapter's
runtime package junction; it introduces no runtime redirect or stub and does
not promote the independently gated native island.

Root diagnostics show meaningful execution-thread CPU alongside idle intervals;
idle does not identify a database, network or lock owner. Current source and
sampled synchronous ancestry identify repeated `Effect.fn` invocation machinery:
even unnamed functions capture a diagnostic Error and install `CurrentStackFrame`
regardless of tracer enablement. These invocations are spread across physical
sessions, finite captures, logical working sets and the journal. Successful
physical calls also construct timeout refusal Errors while building race
branches. Disabling spans therefore does not eliminate all diagnostic
construction. Small clone, encoding and timeout helpers alone do not explain
the complete native-relative gap.

The next focused investigation is the connected working-set, capture and
physical-session composition: establish which repeated construction can move to
its lifetime owner or become failure-only, then test its complete-call effect.
Preserve fresh authority, exact captured dependencies, cancellation/deadline
behavior, first failure, joined callback cleanup and framework-owned business
semantics. Sample spacing and synchronous stack association are candidate
evidence, not exact component CPU or predicted quiet savings. Unbound async
Effect work, ambiguous boundary samples and exceptional quiet stalls remain
explicit gaps. This selects an owner investigation, not a broad rewrite or a
claim that the native-latency gate has passed.
