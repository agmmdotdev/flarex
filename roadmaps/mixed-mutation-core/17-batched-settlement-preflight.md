# Batched authoritative settlement

Status: **dependent draft; planning only, runtime scope unapproved.** Audit the
accepted and delivered [15](./15-admission-protection-preflight.md) and
[16](./16-batched-read-execution-preflight.md) contracts before finalizing this
cutover. The [successor roadmap](./14-execution-redesign-roadmap.md) owns order
and shared acceptance; no new terminal authority or durable format is approved here.

## Connected outcome and reason

Deliver one frozen terminal contribution graph, one coherent authoritative
settlement plan and a bounded authenticated aggregate seal across the root/journal
lifecycle, execution-claim fencing and asynchronous runner closure. The plan covers
efficient OCC, materialization, revision/tombstone history, ordered/search
indexes, unique/relation constraints, events and retained outcome recovery.
Replace repeated terminal checks and row-at-a-time work where the complete graph
proves equivalent batching. Challenge the current journal/commit contract when
it forces redundant work, while preserving one Postgres settlement authority.
This is a connected consumer cutover, not an independent index or SQL helper.

The [current evidence](../../packages/flarex-backend/benchmarks/mixed-mutation-core/bundled-dependency-validation/README.md)
retains one commit per graph and exact row/index/event effects: 1/1/1 for Product,
2/3/1 for Product + Payload, 7/36/7 for mixed workflow and 5/33/6 for standalone.
Those effects and the existing terminal/recovery witnesses are the baseline.
Dispatch totals alone do not attribute terminal latency or justify changing locks.

## Owners and decisive contracts

| Existing owner | Proposed responsibility |
| --- | --- |
| [Journal](../../packages/persistence-postgres/src/sessionJournalStore.ts), [activation](../../packages/persistence-postgres/src/transactionSessionActivation.ts) and [attempt kernel](../../packages/persistence-postgres/src/transactionSessionAttemptKernel.ts) | Authenticate complete aggregate pending/dependency/result/event evidence and one terminal transition |
| [Commit transaction](../../packages/persistence-postgres/src/pointCommitTransaction.ts) and [scope clock](../../packages/persistence-postgres/src/scopeClock.ts) | One locked acceptance, full OCC/authority, allocation, materialization, commit/result/event persistence and outcome recovery |
| [Document materialization](../../packages/persistence-postgres/src/applicationDocumentMaterialization/materialization.ts) and [app rows](../../packages/persistence-postgres/src/appRows.ts) | Coalesced final rows with preserved revision/tombstone/history and logical effects |
| [Ordered index maintenance](../../packages/persistence-postgres/src/appDeveloperIndexCommitV1.ts), [search entries](../../packages/persistence-postgres/src/logicalDocuments/searchEntries.ts), [unique keys](../../packages/persistence-postgres/src/appUniqueKeys.ts) | Equivalent bounded writes, complete selected definitions and atomic coverage/constraint enforcement |
| [Strong references](../../packages/persistence-postgres/src/logicalStrongReferenceProjection.ts), [foreign keys](../../packages/persistence-postgres/src/logicalDocuments/relationalForeignKeys.ts), [contributions](../../packages/persistence-postgres/src/logicalDocuments/contribution.ts) | Complete cross-source effects/constraint evidence and trusted settlement-only affected-set selection |
| [Committed events](../../packages/persistence-postgres/src/commitEvents/store.ts) | Exact framework grouping, identity, order/cardinality and retained durable intent under the same outcome |

The real Product, selected Payload Local API and finite workflow chain remains
the executing source, with framework lifecycle owned by its adapter/runtime.
The [mixed design](../../design-notes/flarexdb-mixed-mutation-execution.md#retry-recovery-and-settlement)
and accepted DB design govern uncertain outcomes and lock/authority boundaries.

## Proposed contract and unresolved decisions

1. Derive the complete terminal operation graph from actual admitted contributions:
   observations, source/member identities, authority, pending final rows, lifecycle
   operations, indexes/search, uniqueness, target/reverse/delete constraints,
   result/events and journal usage. Choose the aggregate authenticated representation
   and bounds, including late asynchronous runner completion and claim fencing.
   Decide whether seal and publication remain separate transactions. If retained,
   name the distinct sealed-but-unpublished recovery obligation and prove it; if
   replaced, inventory the changed durable journal/protocol/data boundary and
   prove crash and uncertain-COMMIT recovery across the cutover. No stable digest
   alone repairs the known publication-body proof
   limitation; retain its existing checks unless a complete replacement is approved.
2. Compare extending existing seal/commit inputs with replacing their duplicated
   journal/contribution representation. Choose one canonical terminal owner rather
   than a second evaluator or adapter-produced finalizer. Preserve intermediate
   native results, operation evidence and budget charges even if final writes coalesce.
3. Before accepting seal and again at publication/recovery as required, keep fresh
   scope/placement/binding/source pins, generation, revocation, exact session/
   lease/claim/fence, expiry and post-lock DB time. Retain full readiness and final
   protection guards under the accepted 15 contract. A read closure is not proof
   of complete terminal dependencies. Never reuse a live DB verdict across boundaries.
4. Validate exact OCC for point absence, revision/tombstones, ranges/pages and
   negative membership, relations/unique claims and retention. Preserve all
   independently committed writers' history/conflict participation. A new row in
   a previously empty predicate must conflict even when returned rows did not change.
5. Batch already bounded authenticated rows/history/index/search/constraint/event
   writes at their persistence owner with explicit row/byte/statement limits.
   Preserve missing/extra/duplicate refusals, deterministic lock order/strength,
   foreign-key/delete behavior, null/predicate uniqueness, coverage/frontiers,
   error ordering and rollback. Maintain only already admitted search semantics;
   do not add unavailable snapshot search or new index capabilities.
6. Shorten serialization only when attributable lock/hold evidence warrants it.
   Moving work before the scope-clock lock requires a proof that it is immutable
   or revalidated after locking. Partitioning/removing serialization requires an
   explicit coordinated writer, activation and migration protocol across all
   publishers, unique/relation/history/maintenance/recovery owners. It is not a
   default promise or a local batch optimization.
7. Keep data, history, indexes, constraints, commit feed, exact retained result,
   idempotency and event intents atomic. No event dispatch or external success
   before confirmed settlement. Preserve exact source ownership; an Application
   grant cannot authorize framework rows. No SQL transaction spans callbacks,
   sandbox execution, waits or effects.
8. Preserve confirmed-abort bounded settlement retry versus unknown COMMIT.
   Resolve exact retained evidence before re-executing any service, hook or
   workflow. Conflict discards the whole graph and retries from a fresh snapshot
   under finite root budgets. Cancellation racing settlement returns the actual
   durable outcome and revokes later work; it is not proof of rollback.
9. Preserve early relation-conflict aggregate terminal evidence, durable conflict
   replacement and crash recovery. Add the targeted lost-COMMIT-response witness
   for that early transition; do not label it proved by unrelated recovery tests.

Challenge statement batching that hides unchanged server work, defers acknowledged
durability or weakens complete evidence. Also challenge preserving a duplicated
root/journal/terminal format solely because it exists. Prefer one coherent
representation and bounded writes with exact settlement semantics. Do not move
business rules into persistence or repair a core gap with framework SQL.

## Breaks, cutover and budget

List all affected seal/journal/protocol/commit/contribution/event inputs and readers,
ordinary Application, standalone framework and durable-operation callers, retained
results and outstanding attempts before runtime. If formats, identities or schema
change, choose explicit drain/migration/isolated-reset and activation order with
the owner. Preserve named durable data; never reinterpret old bytes or discard
unresolved outcomes. Migrate every affected real consumer and remove displaced
terminal loops/codecs/APIs/exports/fixtures in the same slice. No dual reader,
fallback settlement engine or compatibility wrapper without a named obligation
and removal gate. Supported distinct profiles retain their real contracts.

Before implementation, fix numeric per-graph SQL/transactions/round trips and
bounded formulas for observations, changes, histories, index/constraint/event
rows, journal/result bytes and retries using the complete operation graph.
Separate structural preparation, fresh live acceptance, data, seal and publication
work. Count server statements within batches and lock wait/hold/connection occupancy.
The [roadmap latency goals](./14-execution-redesign-roadmap.md#budget-and-attribution-gate)
remain 100/200/500 ms mixed p50 and 200/400/1,000 ms p95; standalone median
below 400 ms and regression strictly below 10%. Exact structural limits remain
unresolved draft gates, not numerical promises from a partial inventory.

## Validation and exit

Use PGlite and ordinary-role Postgres for authenticated aggregate corruption,
missing/extra/duplicate contributions, exact positive/negative OCC, concurrent
standalone writers, snapshot expiry, pending/tombstones, unique/null/predicate and
reference/delete constraints, history/index/search/event atomicity. Distinct
connections must exercise ordered lock contention/deadlocks, post-wait authority/
time, revocation/claim loss, readiness/epoch changes and concurrent activation.
Any serialization redesign needs the complete coordinated-writer witnesses.

Run the genuine Product/Payload/workflow graphs with intermediate results, late
failures, rollback-only, bounded whole-root retry, replay, events, cancellation
and COMMIT-response-loss recovery, including early conflict. Confirm one retained
outcome with no duplicate callbacks/events. Preserve standalone/durable regressions.
Apply Effect/error guidance, affected types/builds/Worker/source/lint checks,
both project reviewers on the final diff, substantive-fix re-review, cleanup,
staged lint and one scoped commit after successful validation.

Exit requires authenticated aggregate settlement, preserved failure/recovery,
real consumer migration, explicit durable disposition, removal and agreed
structural limits. Functional completion and performance acceptance remain
separate: measure attributed seal/publication/server/wait/CPU/decode/hash and
matched quiet traced/untraced distributions with all samples/outliers retained.
Green tests or fewer calls do not meet latency acceptance. This slice's agreed
graph-derived stage budget must pass alongside correctness and cleanup; reconcile
a failed stage budget within the slice or explain a changed contract before
proceeding. Quantify any remaining gap and assign its owner before deciding whether
18 is justified. Final latency goals govern whole-successor acceptance. Report remaining
targets and cost owners; new framework/query support, developer APIs, hosted
activation, waits/effects/locks and advanced evolution remain separately gated.
