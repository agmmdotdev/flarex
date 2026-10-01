# Mixed execution redesign

Status: **slices 15–17 and 19 delivered for the existing private profiles with their stage cost gates passed; final mixed latency targets remain unmet.**
The private finite Application/Product/Payload/workflow profile is implemented.
Its mixed latency targets remain unmet. This document selects the connected
redesign sequence. Delivered 15 owns target protection under existing full
attestation and privileged quiescence; delivered 16 owns aggregate full entry,
tentative local construction and bounded storage frontiers; delivered 17 owns
authenticated aggregate seal capture, separate finishing and batched settlement.
Delivered [19](./19-aggregate-entry-preflight.md) owns atomic request entry,
one prepared source graph and exact-transaction coverage reuse, including complete
initial authentication and renewal. New attestation/maintenance and host
contracts remain gated.

## Outcome and current evidence

Deliver efficient execution of the existing admitted graphs while preserving
one Postgres outcome, native framework behavior, exact snapshot-plus-pending
semantics and bounded retry/recovery. Existing root, transaction, journal and
working-set interfaces may be replaced when their topology causes repeated work.
The current implementation is a correctness baseline, not an API constraint.

The [accepted DB design](../../design-notes/flarex-db-accepted-design.md),
[mixed design](../../design-notes/flarexdb-mixed-mutation-execution.md) and
[package boundaries](../16-package-boundaries.md) govern authority and placement.
The [aggregate-entry evidence](../../packages/flarex-backend/benchmarks/mixed-mutation-core/aggregate-entry/README.md)
contains the complete authenticated profile. The prior
[settlement evidence](../../packages/flarex-backend/benchmarks/mixed-mutation-core/batched-settlement/README.md)
contains matched full traced/untraced series with zero exclusions and a separate
Node CPU diagnostic. The prior bounded-read baseline remains unchanged. The prior
[bundled evidence](../../packages/flarex-backend/benchmarks/mixed-mutation-core/bundled-dependency-validation/README.md)
and the [prepared-admission baseline](../../packages/flarex-backend/benchmarks/mixed-mutation-core/prepared-admission/README.md)
remain preserved with all their samples and outliers.

| Existing graph | SQL dispatches | Transactions | Warm p50 / p95 (ms) | Proposed p50 / p95 goal (ms) |
| --- | ---: | ---: | ---: | ---: |
| Product | 519 | 20 | 752.955 / 888.010 | 100 / 200 |
| Product + Payload | 542 | 21 | 678.637 / 695.351 | 200 / 400 |
| Mixed finite workflow | 845 | 34 | 1,196.599 / 1,289.494 | 500 / 1,000 |
| Standalone finite workflow | 309 | 6 | 314.581 / 336.328 | Median below 400; median regression strictly below 10% |

Slice 19 passes all-sample SQL ceilings **540 / 563 / 853 / 309** and complete
transaction ceilings **20 / 21 / 34 / 6**. Initial admission is **97** dispatches
and four transactions, including the required fresh renewal; structural entry
itself is three transactions. Warm terminal SQL is **173 / 178 / 216** in three
transactions. Standalone passes its median gate with a **9.586912%** increase.
All mixed latency targets remain unmet. The prior measured private fixture
omitted complete initial authentication and renewal: its **595.6 / 616.1,
627.4 / 784.6 and 1,056.7 / 1,094.7 ms** distributions do not establish profile
equivalence or a causal regression. Every outlier remains in the artifact owner,
including the current Product maximum **7,701.252 ms**.

The retained slice 17 profile passes its 633 / 660 / 1,024 / 354 dispatch and 25 / 26 / 39 / 6
transaction ceilings. Mixed terminal transactions are seven to three, with
175 / 180 / 218 dispatches below ceilings 228 / 236 / 321. The remaining
nonterminal SQL is 387 / 405 / 670 across 22 / 23 / 36 transactions, including
nine initial admission transactions, ten Product data frontiers and thirteen
additional workflow frontiers. The full ledger retains original observations,
definitions, chunks and measured bytes; unavailable reference/wire demands stay
unavailable. The previous read contract, business effects and durable formats
remain intact.

Within the retained slice 17 comparison, mixed warm medians improve
6.3% / 9.1% / 9.6%; standalone improves 10.6% and
passes both median gates. Product + Payload p95 rises from 751.7 to 784.6 ms.
All maxima remain in the artifact owner. Final mixed goals remain unmet; neither
SQL reductions nor the comparison establish a latency cause.

The benchmark creates a fresh single-use Worker per mixed request. Startup may
be a structural floor, but local lifecycle observations do not establish that
it caused the distribution changes or predict Cloudflare performance. Current
checkpoint comparisons also do not establish native Medusa parity: that claim
requires a matched ordinary-Postgres native baseline for the compared portion,
with mixed snapshot, journal, recovery and publication obligations identified.

## Ordered connected slices

**15–17 and 19 are delivered and their stage cost gates passed.** Slice 17 retains
the delivered read contract; [19](./19-aggregate-entry-preflight.md) adds atomic
creation-plus-entry and complete initial authentication. Draft 18 remains
conditional and unapproved.
Revisit ordering if the dependency graph shows that a safe
cutover must combine or rearrange owners; explain that change before runtime.

| Slice and readiness | Connected removal outcome | Main decision before implementation |
| --- | --- | --- |
| [15: admission and protection](./15-admission-protection-preflight.md), delivered; stage passed | Protect current immutable target metadata and remove repeated structure/clock reads across existing consumers | 23-table coverage, full existing attestation/quiescence, exact accepting-transaction clock provenance; measured SQL 862 / 1,068 / 1,663 meets ceilings 871 / 1,081 / 1,688 with unchanged 41 / 52 / 78 transactions |
| [16: batched read execution](./16-batched-read-execution-preflight.md), delivered; stage passed | Aggregate finite full entry, local method/construction and actual bounded storage frontiers; retain source-wide readiness and exact ordered data dependencies | Accepted tentative callback/live-check timing; measured 643 / 670 / 1,034 driver dispatches and 29 / 30 / 43 explicit transactions pass 798 / 924 / 1,439 and 33 / 34 / 50 ceilings; standalone 354 / 6 passes median gates |
| [17: batched settlement](./17-batched-settlement-preflight.md), delivered; stage passed | Separate aggregate seal and fresh finishing, remove the separate candidate planning-head preparation transaction, and batch remaining validation reads through existing owners | Detached authenticated seal body/authority/planning head after COMMIT; executor verification and candidate-guard compilation outside SQL; publication retains its existing fresh head recheck/full OCC; durable formats and recovery retained |
| [19: aggregate entry and prepared source graph](./19-aggregate-entry-preflight.md), delivered; stage passed | Connect existing private finiteRoot core entry and genuine consumers, bounded control/catalog construction and exact-transaction coverage reuse | Atomic creation plus full source entry, confirmed facts after COMMIT and guard lifecycle; structural entry 9 to 3 transactions, complete authenticated admission 97 SQL / 4 transactions with required renewal. Whole SQL 519 / 542 / 845 / 309 meets all-sample ceilings 540 / 563 / 853 / 309; complete-profile transactions are 20 / 21 / 34 / 6. Whole-request latency goals remain unmet. |
| [18: host lifecycle](./18-host-lifecycle-preflight.md), conditional draft | Remove attributable startup/serialization overhead if a separately accepted host contract permits it | Include or skip from evidence; isolation, capability lifetime, cleanup and host-specific parity |

These are medium-to-large coherent capabilities. A helper, test matrix, profile
capture or minor SQL edit is work within a slice, not a separate successor turn.
Measurements must answer an implementation or acceptance question. Each slice
includes affected real consumers, failure proofs, removal and one scoped commit
after validation; documents and profiling alone do not deliver runtime behavior.

### Slice 17 delivered terminal contract

One aggregate seal transaction returns detached authenticated body, authority
and candidate planning head after COMMIT. Existing executor crypto, schema,
signed-grant and input verification runs outside SQL, followed by a separate
fresh finishing transition. Seal and finishing cannot fuse: the current seal
candidate does not prove those grant/schema/input obligations. The seal captures
the candidate planning head, allowing candidate-guard compilation outside SQL
and removal of the separate planning-head preparation transaction. Publication
retains its existing fresh head recheck and full OCC validation in one SQL
transaction. No SQL transaction spans callbacks.

Journal, schema, result and event bytes, Repeatable Read recovery readers, and
the sealed-running and finishing state contracts remain retained. The healthy
seal/OCC path uses **5 to 2** transactions and publication **2 to 1**:
terminal **7 to 3**, removing four transactions, with whole-request counts **29 / 30 / 43 / 6 to
25 / 26 / 39 / 6**. Standalone benefits from shared owner batching at **309 dispatches / 6 transactions**.

The agreed combined terminal dispatch ceilings are **228 / 236 / 321**
against **238 / 246 / 331**; whole-request ceilings are **633 / 660 / 1,024 /
354**. These are conservative stage ceilings based on ten fewer
transaction-control queries. Meaningful batching of the
remaining original-snapshot, dependency, index and reference validation reads,
plus duplicate preparation cleanup, is mandatory through existing owners.
Materialization writes already batch. The focused preflight owns the exact bounds,
proofs and approved acceptance gates.

The Node diagnostic observes real readiness/index-build decoding and private JSON
capture ancestry, with Effect/Drizzle/driver work also present. Idle, generated
frames and profiler overhead are explicit and unassigned. These observations
support investigating existing metadata/admission/preparation owners before
choosing a host change; they neither quantify the entire remaining gap nor
establish another runtime slice. Approved 19 records the connected core direction
and its owner decisions; it predicts no additive latency saving. Slice
18 needs its own attributable host evidence
and contract decision. The whole latency goal remains unfinished.

## Owners and invariants

- Persistence owns canonical metadata, live acceptance, database transactions,
  history, conflict validation, materialization and durable recovery. Trusted
  executor owns root orchestration, retries, cancellation and budgets. Protocol
  owns exact serialized contracts. Hosts adapt lifecycle and transport.
- Product service, selected Payload Local API access/validation/hooks and finite
  Medusa workflow steps retain their native business and lifecycle ownership.
  Do not copy them into a planner, generic CRUD engine or adapter-owned admission.
- A prepared immutable object is not a live admission verdict. Each actual DB
  boundary keeps fresh scope, placement, binding, generation, revocation,
  session/lease/claim/fence and post-lock database-time checks. A local tentative
  operation may discover persisted revocation at its next DB boundary.
- Keep one logical snapshot plus ordered pending changes, exact positive and
  negative point/predicate/page/relation/unique evidence, revision/tombstone
  history and final OCC validation. Method grants do not prove dependency closure.
- No database transaction spans sandbox execution, foreign capture, framework
  callbacks asking for the next read, resource waits, workflow suspension or
  remote effects. Plans contain already bounded trusted work, not guessed future
  callbacks. Preserve validation, failure and resource-charge order.
- Root conflict retry discards the whole tentative graph and uses a fresh
  snapshot/framework state under finite budgets. Preserve rollback-only,
  cancellation, fencing, replay and exact retained outcome resolution before
  uncertain COMMIT can cause any callback replay. Only Postgres settles.
- Slice 15 extends existing ten-table legacy Application protection with thirteen
  immutable current target tables under full existing attestation/quiescence.
  Its actual optimized graphs use the legacy Application issuer and shared
  active-head/schema/binding readers; current relation Fold callers keep full
  proof. Live/physical and separately owned control evidence remain checked.
  Separate databases have no atomic joint generation.

## Budget and attribution gate

The latency goals above remain the acceptance question. Slice 15's numeric
dispatch and transaction stage limits passed. Before each later runtime
slice, complete the actual bounded operation/dependency graph for all four
workloads and agree numeric transaction, sequential round-trip and server SQL
limits, plus batch-size/byte formulas and retry/saturation limits. Slice 16's
approved source-derived preflight fixes conservative dispatch/transaction stage
ceilings. Slice 17 records approved terminal and whole-request limits. Slice 19
records delivered entry/construction/coverage limits and distinguishes structural
entry from the complete authenticated profile; slice 18 limits remain
conditional. A call containing 100 server statements still accounts for all 100 statements.

| Cost category | Required graph-derived budget and attribution |
| --- | --- |
| Structural preparation | Canonical body/closure reads, bytes, decode/hash CPU, installation verification and amortization lifetime; include invalidation/reprepare cost |
| Fresh live acceptance | Number of actual DB boundaries, checked transactions, authority/readiness/catalog work and tail guards per boundary |
| Data execution | Rows, ranges, misses, tombstones, relation/unique probes, bounded hydration, dependency observations and pending work |
| Seal and publication | Aggregate proof, journal bytes/rows, OCC, locks, materialization/history/index/constraint/event/outcome work |
| Runtime and transport | Framework/sandbox CPU, serialization/bytes, connection/driver time, startup and cleanup; distinguish local and hosted profiles |

Record server work, lock waits/hold time, driver await, CPU/decode/hash,
runtime/transport/startup, seal and publication where observed. Driver await
includes transport/server/waits; transaction intervals are not pure lock time.
Keep unavailable attribution explicit. Add only observations needed to choose
the owner or prove an agreed limit, within the connected implementation slice.
Account for total work per successful outcome including retries and contention.

## Replacement, validation and completion

Each focused preflight must resolve its contract decisions, exact callers and
durable disposition before dependent runtime changes. Necessary internal breaks
are welcome: replace root/journal/working-set/kernel contracts when warranted,
migrate consumers and delete displaced code, exports, dependencies, fixtures and
stale claims in that same slice. Do not retain wrappers, dual engines/readers,
fallbacks or hypothetical legacy obligations. Distinct standalone and durable
profiles stay only for their real callers. Named outstanding attempts, retained
outcomes and environments require explicit drain, migration or reset decisions;
never silently delete or reinterpret their evidence.

Validate affected owner and genuine Product/Payload/workflow/Worker consumers
through fast PGlite and distinct-connection ordinary-role PostgreSQL. Include
required/unrelated readiness, corruption/tamper, post-wait checks, scope/fencing,
positive/negative conflicts, pending/tombstones, late failures, bounded whole-root
retry, rollback-only, events, replay, cancellation and uncertain COMMIT recovery.
Retain unavailable historical-search refusal. Run affected typechecks, builds,
source/Worker boundary guards and lint, both project reviewers on the exact final
owned diff, re-review substantive fixes, staged lint and scoped commit. Stop
owned temporary runtimes. Preserve all measured samples and outliers.

Each slice's agreed graph-derived stage cost budget is its performance exit gate.
When correctness, cleanup and that budget pass, advance to the next agreed
connected slice with a quantified remaining gap and named cost owner. If the
stage budget fails, reconcile within that slice or explain the changed contract
before proceeding. Slice 15 passed its stage gate with the remaining latency gap
quantified above. Slice 16's focused graph, timing contract and measured stage
gate and slice 17's terminal contract are delivered.
The final latency targets govern whole-successor acceptance.

Functional delivery and whole-goal performance acceptance are separate: green
correctness checks and lower SQL counts do not satisfy the latency goal. After each cutover,
compare quiet traced structure and matched untraced distributions on unchanged
graphs, inputs, workload effects, deadlines, recovery and exclusion policy.
If a target is blocked by attributable host cost, record that separately and
decide whether 18 is warranted; do not claim the goal complete. If a slice is
functionally delivered but performance remains short, retain that truthful status
and the concrete remaining owner rather than inventing another helper slice.

Developer APIs, new framework support, arbitrary query/search admission, hosted
activation, waits/effects/resource locks and advanced schema evolution remain
separately gated. Local private evidence establishes no hosted capacity,
throughput or general ORM performance guarantee.
