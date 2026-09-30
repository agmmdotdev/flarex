# Mixed execution redesign

Status: **slice 15 delivered with its stage cost gate passed; slice 16 is the next preflight gate.**
The private finite Application/Product/Payload/workflow profile is implemented.
Its mixed latency targets remain unmet. This document selects the connected
redesign sequence. The delivered 15 preflight owns its target
protection extension under existing full attestation and privileged quiescence;
later runtime, new attestation/maintenance and host contracts remain gated.

## Outcome and current evidence

Deliver efficient execution of the existing admitted graphs while preserving
one Postgres outcome, native framework behavior, exact snapshot-plus-pending
semantics and bounded retry/recovery. Existing root, transaction, journal and
working-set interfaces may be replaced when their topology causes repeated work.
The current implementation is a correctness baseline, not an API constraint.

The [accepted DB design](../../design-notes/flarex-db-accepted-design.md),
[mixed design](../../design-notes/flarexdb-mixed-mutation-execution.md) and
[package boundaries](../16-package-boundaries.md) govern authority and placement.
The [prepared-admission evidence](../../packages/flarex-backend/benchmarks/mixed-mutation-core/prepared-admission/README.md)
contains 16 traced and 104 untraced samples with zero exclusions. The prior
[bundled evidence](../../packages/flarex-backend/benchmarks/mixed-mutation-core/bundled-dependency-validation/README.md)
and the separate historical 120-sample checkpoint remain preserved with their
outliers.

| Existing graph | SQL dispatches | Transactions | Warm p50 / p95 (ms) | Proposed p50 / p95 goal (ms) |
| --- | ---: | ---: | ---: | ---: |
| Product | 862 | 41 | 783.7 / 1,011.6 | 100 / 200 |
| Product + Payload | 1,068 | 52 | 973.8 / 1,006.0 | 200 / 400 |
| Mixed finite workflow | 1,663 | 78 | 1,676.6 / 1,714.8 | 500 / 1,000 |
| Standalone finite workflow | 354 | 6 | 309.4 / 395.3 | Median below 400; median regression strictly below 10% |

Slice 15 removes 126 / 184 / 316 dispatches from the prior 988 / 1,252 / 1,979
graphs and passes its original 871 / 1,081 / 1,688 ceilings. Transaction counts
remain unchanged. Warm medians fall 16.7% / 10.4% / 6.2%; standalone falls 3.3%
and passes its median gate. All maxima remain, including mixed workflow's
2,800.9 ms sample. The comparison does not isolate latency causes. The mixed
final goals remain unmet; slice 16 owns the next decision on repeated read
transactions and legal execution frontiers.

The benchmark creates a fresh single-use Worker per mixed request. Startup may
be a structural floor, but local lifecycle observations do not establish that
it caused the distribution changes or predict Cloudflare performance. Current
checkpoint comparisons also do not establish native Medusa parity: that claim
requires a matched ordinary-Postgres native baseline for the compared portion,
with mixed snapshot, journal, recovery and publication obligations identified.

## Ordered connected slices

**15 is delivered and its stage cost gate passed.** Slice 16 is the next
preflight gate; its runtime is not approved. Draft 17 depends on the preceding
accepted contract and audited implementation. Draft 18 is conditional. They
remain planning documents. Revisit ordering if the dependency graph shows that a safe
cutover must combine or rearrange owners; explain that change before runtime.

| Slice and readiness | Connected removal outcome | Main decision before implementation |
| --- | --- | --- |
| [15: admission and protection](./15-admission-protection-preflight.md), delivered; stage passed | Protect current immutable target metadata and remove repeated structure/clock reads across existing consumers | 23-table coverage, full existing attestation/quiescence, exact accepting-transaction clock provenance; measured SQL 862 / 1,068 / 1,663 meets ceilings 871 / 1,081 / 1,688 with unchanged 41 / 52 / 78 transactions |
| [16: batched read execution](./16-batched-read-execution-preflight.md), next preflight gate | Replace fixed per-method/read transaction topology with bounded planner-owned execution frontiers across root, journal, working set and frameworks | Complete operation closure and legal batch frontiers; exact validation/dependency/budget order; root/journal cutover |
| [17: batched settlement](./17-batched-settlement-preflight.md), dependent draft | Remove repeated terminal validation and row-at-a-time materialization where equivalent; connect seal, history, indexes, constraints, events and retained recovery | Aggregate authenticated contribution contract; lock/serialization plan; durable formats and uncertain-outcome disposition |
| [18: host lifecycle](./18-host-lifecycle-preflight.md), conditional draft | Remove attributable startup/serialization overhead if a separately accepted host contract permits it | Include or skip from evidence; isolation, capability lifetime, cleanup and host-specific parity |

These are medium-to-large coherent capabilities. A helper, test matrix, profile
capture or minor SQL edit is work within a slice, not a separate successor turn.
Measurements must answer an implementation or acceptance question. Each slice
includes affected real consumers, failure proofs, removal and one scoped commit
after validation; documents and profiling alone do not deliver runtime behavior.

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
limits, plus batch-size/byte formulas and retry/saturation limits. **Those later
limits are unresolved draft gates, not invented guarantees.** A call containing 100
server statements still accounts for all 100 statements.

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
quantified above. Slice 16 now requires its focused graph and contract preflight;
the final latency targets govern whole-successor acceptance.

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
