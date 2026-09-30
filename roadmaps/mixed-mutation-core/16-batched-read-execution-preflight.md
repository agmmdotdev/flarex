# Bounded batched read execution

Status: **dependent draft; planning only, runtime scope unapproved.** Audit the
accepted and delivered [15 contract](./15-admission-protection-preflight.md)
before finalizing this scope. The [successor roadmap](./14-execution-redesign-roadmap.md)
owns sequence and common acceptance. Current source-complete closure is a
baseline; exact operation closure and new execution topology are unproved.

## Connected outcome and reason

Replace avoidable fixed per-method/read transactions with planner-driven bounded
trusted read frontiers, integrated with the root, working set, journal and native
framework seams. Batch actual storage demands within a trusted DAL call/frontier,
not a promise to batch an entire sequential workflow. Challenge the current root/journal/read topology itself rather
than optimize only queries inside it. Preserve one snapshot plus earlier pending
changes and exact ordered dependency capture. Real Product/Payload/workflow
consumers must execute through the replacement, not a benchmark-only batch API.

The [retained baseline](../../packages/flarex-backend/benchmarks/mixed-mutation-core/bundled-dependency-validation/README.md)
has 41 / 52 / 78 mixed transactions despite source-union sharing and existing
hydration batches. That motivates graph-level removal; it does not prove that
all calls can share one transaction. [Slice 13](./13-dependency-validation-preflight.md)
shares complete issued source readiness inside an accepting read transaction and
hydrates indexed histories in bounded order. Preserve those intended semantics.

## Owners and source contracts

| Existing owner | Redesign responsibility |
| --- | --- |
| [Query planner](../../packages/persistence-postgres/src/logicalDocuments/query.ts) and [relational query](../../packages/persistence-postgres/src/logicalDocuments/relationalQuery.ts) | Complete actual operation dependencies and legal trusted execution frontier, including negative membership and transitive obligations |
| [Working set](../../packages/persistence-postgres/src/logicalDocuments/workingSet.ts) and [root evaluator](../../packages/persistence-postgres/src/logicalDocuments/rootEvaluator.ts) | Shared pending/snapshot state, ordered decode/observation/budget/state transitions and bounded frontier consumption |
| [Source admission](../../packages/persistence-postgres/src/logicalDocuments/sourceAdmission.ts), [readiness](../../packages/persistence-postgres/src/logicalStorageReadiness.ts) and [app rows](../../packages/persistence-postgres/src/appRows.ts) | Owned operation closure, fresh acceptance and bounded historical row/absence/tombstone retrieval |
| [Attempt kernel](../../packages/persistence-postgres/src/transactionSessionAttemptKernel.ts) and [journal](../../packages/persistence-postgres/src/sessionJournalStore.ts) | Revised checked boundary, authenticated root sequencing/observations, seal and recovery connection |
| [Product attempt](../../packages/medusa-adapter/src/product-attempt.ts), [Payload adapter](../../packages/payload-adapter/src/adapter.ts), [workflow runtime](../../packages/medusa-adapter/src/workflow-runtime.ts) | Native service/Local API/step execution and borrowed capability translation; no planner-owned framework semantics |

The [Convex transaction](../../../../crates/database/src/transaction.rs),
[read set](../../../../crates/database/src/reads.rs) and
[write set](../../../../crates/database/src/writes.rs) anchor snapshot, accumulated
dependencies and coalesced pending state. They do not justify holding SQL across
callbacks. The pinned framework anchors and genuine consumer chains remain in
[01](./01-application-product-attempt-preflight.md),
[02](./02-payload-local-api-attempt-preflight.md) and
[03](./03-finite-medusa-workflow-preflight.md).

## Proposed contract and decisions to resolve

1. Trace each actual admitted graph: operations, inputs/results, foreign capture,
   framework callbacks, setup/readiness-only transactions, pending changes,
   planner selections, history reads,
   source/target/reverse/delete/unique dependencies and journal acknowledgement.
   Define legal batch frontiers from already known bounded trusted work. An
   arbitrary sequential callback's next read cannot be guessed or prefetched:
   later native demands can depend on earlier results. Quantify irreducible
   sequential demand rounds before agreeing transaction budgets.
2. Compare retaining current root/journal APIs, replacing their per-operation
   persistence/working-set seams, and moving a bounded trusted planner frontier
   under one checked short transaction. Recommend the smallest coherent topology
   that removes repetition. Do not assume one transaction per native method or
   one transaction for the whole framework graph. Select the actual cuts before
   implementation, including which evidence stays local until aggregate seal.
   Challenge source/root setup admission-only transactions and borrowed workflow
   construction alongside data access. Current working-set relational disjunctions
   issue separate selections; pages already combine page retrieval and hydration,
   while residual filtering can require further pages. Derive bounded demand
   rounds for these actual paths rather than promising one read per workflow.
3. Prove operation closure at the planner/evaluator, not from method grants or
   caller-authored dependency lists. Include absent rows, negative predicates,
   ordered pages/ranges, historical uniqueness, target existence, reverse/delete
   checks and pending changes that introduce a new requirement. Full checks remain
   for named paths whose closure is unproved; no selected proof becomes full
   entry/seal/publication admission merely by being smaller.
4. Keep each boundary's fresh scope, placement, binding/head pins, generation,
   revocation, session/lease/claim/fence, expiry and post-lock database time,
   required readiness/physical evidence and accepted protection tail guard.
   Only its accepting transaction may share live evidence. A later boundary
   repeats live acceptance even when structural preparation is reusable.
5. Capture/validate foreign inputs before SQL under local handle/lifetime/budget
   refusal. Never keep a transaction while asking framework code or sandbox code
   for the next read, running hooks/getters or waiting on remote effects. Close
   the frontier transaction before returning to that code.
6. Preserve snapshot revision/tombstone and pending overlay, positive/negative
   point/range/page/relation/unique observations and order-sensitive results.
   Sequentially decode, observe, charge resources and update state; earlier
   refusal must prevent later corruption or budget work from becoming visible.
   Preserve duplicate/missing/extra checks and bounded transfer semantics.
7. Batch equivalent selected readiness, identity hydration, ranges or constraint
   probes only where the graph proves equivalence. Fix row/byte/statement bounds
   and refusal order. Do not parallelize shared-transaction statements whose
   lock, validation or dependency order matters. Retain explicit byte-crossing
   behavior; withheld bodies cannot become fabricated absence or fallback reads.
8. Preserve native access/validation/hook order, omitted/null/empty behavior,
   intermediate results, nested same-request failure/rollback-only and finite
   workflow frames. Whole-root conflict retry recreates the graph with a fresh
   snapshot/state under finite budgets. Do not replay only the failing child.
9. Include query/index/search dependency or maintenance mechanics only for
   already admitted semantics. Historical text/JSON search remains unavailable
   where snapshot candidates and conflict evidence are unproved; refuse it.
   This package does not admit search by optimizing current-state readers.

Challenge blanket source-wide closure versus a proved operation closure; reject
an overgeneralized query DSL/registry or speculative prefetch optimizer. A batch
that preserves remote boundaries but repeats every validation is insufficient;
a batch that loses dependency/order/native lifecycle is incorrect. Real consumer
before/after graphs must justify the chosen topology and removal.

## Breaks, budget and cutover

Inventory replacement root, journal observation/receipt, working-set construction,
read capability and planner contracts plus actual native/framework callers. Any
durable journal/protocol change needs every reader, outstanding attempt and retained
outcome identified, with explicit drain/migration/isolated-reset disposition before
runtime. Preserve named durable evidence. Migrate consumers together and delete
displaced per-operation paths, exports, dependencies and test scaffolding; no dual
engine, compatibility wrapper or fallback. Standalone and durable profiles remain
only for their supported independent callers.

Before implementation, fix numeric per-graph transactions, sequential round trips
and server SQL from the complete operation graph, with bounded frontier formulas
for sources/identities/bytes/dependencies. Separate structural preparation,
fresh live checks, data work and seal/publication; count all statements inside a
batch. The [roadmap goals](./14-execution-redesign-roadmap.md#budget-and-attribution-gate)
remain 100/200/500 ms mixed p50 and 200/400/1,000 ms p95, standalone median
below 400 ms with regression strictly below 10%. Limits are unresolved draft
decisions; no arbitrary SQL/transaction guarantee follows from the current counts.

## Validation and exit

Use PGlite plus ordinary-role Postgres owner/consumer tests for point/range/page
and negative dependencies, tombstones/history, pending inserts/deletes/replacements,
unique/reference/reverse/delete closure, ordered errors/budgets and bounded bodies.
On distinct Postgres connections prove authority/readiness changes between
frontiers, blocked reads with fresh post-wait time, concurrent membership/coverage,
fencing/claim loss, epoch contention and physical tamper refusal. Native callback
instrumentation must show no SQL spans foreign code and no callback replay on
committed recovery. Preserve required versus unrelated readiness semantics.

Run real Product, Payload Local API and finite workflow success, late failure,
rollback-only, conflict and bounded whole-root retry, events, replay, cancellation
and uncertain COMMIT recovery; retain standalone and durable callers' regressions.
Apply Effect pattern/error guidance, affected type/build/Worker/source/lint gates,
both project reviewers on the final diff, re-review substantive fixes, cleanup,
staged lint and one scoped commit after successful validation.

Exit requires proved closure and legal frontiers, real consumer migration,
durable disposition, deletion of displaced topology and agreed structural bounds.
Functional delivery is distinct from latency acceptance. Measure attributable
server/wait/CPU/decode/hash, runtime/transport, seal/publication and matched quiet
traced/untraced distributions; preserve every sample/outlier and record unavailable
attribution. Green tests or fewer dispatches alone do not complete performance.
Advance to the next agreed connected slice when correctness, cleanup and this
slice's agreed stage cost budget pass, with a quantified remaining gap and named
cost owner. If the stage budget fails, reconcile it within this slice or explain
a changed contract before proceeding. The final latency goals govern the whole
successor, not a prerequisite that every intermediate slice already meets them.
Public APIs, new operations/search, hosted activation, waits/effects/resource locks
and advanced evolution remain outside this slice.
