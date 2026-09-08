# Replacement And Cleanup

## Status And Scope

No additional replacement or DDL is selected yet. The
[ownership audit](./01-ownership-audit.md) determines the required scope. This
plan makes cleanup part of each selected replacement's completion contract.

## Initial Disposition

| Component | Current disposition | Condition for changing it |
| --- | --- | --- |
| Former inline common publisher, native-owned commerce finalizer and duplicate framework recovery routing | Removed under record 36 | No parallel or fallback path may be reintroduced |
| Native publication error projections | Retained for established error semantics | Replace only with an explicit equivalent owned error boundary |
| CMS/native materialization bridge | Retained by the completed slice; broader ownership disposition pending | Audit preparation, lowering, receipts, relation/unique/index handling and preference facts as one connected operation |
| Native journals, sessions and snapshot leases | Retain native execution guarantees | A selected execution change must first supersede their consumers and obligations |
| CMS pending state and commerce SQL stores | Retain admitted domain semantics | A proved replacement must preserve pending reads, nesting, constraints and complete facts |
| Scope clocks, commits, outcomes and outbox | Retain shared authority | No competing ledger or clock introduced for a framework |
| Relational and preference-deletion facts | Retain publication and lifecycle contracts | Replace writers, all readers and compactor/retention obligations together |
| Framework artifacts, installations, initialization, migrations and bindings | Retain control data | Change only for an explicitly selected binding/schema capability |

The inspected static schema has no separate CMS/commerce transaction-session
family corresponding to those two source folders. This is not a deployed-table
deletion inventory. Payment/order business records named transaction must not
be mistaken for transaction-engine state.

## Required Replacement Record

Before implementing a selected replacement, record:

1. The violated or improved ownership boundary and exact accepted target.
2. All callers, writes, reads, exports, codecs, tests and retention consumers
   affected by the replacement, including failure and recovery paths.
3. The intended semantics to preserve and every explicit contract change.
4. Evidence of shipped contracts, live traffic or durable data, if any.
5. The direct consumer switch and deletion list; for every retained temporary
   bridge, its consumer, reason and observable removal condition.
6. Migration/recovery procedure if persisted state changes, including invariant
   verification and a rollback or restore route appropriate to the data.
7. The decisive conformance, concurrency and performance gates.

## Data And Migration Policy

Follow [replacement authority](../../AGENTS.md#replacement-design-authority).
For disposable unshipped state, prefer a clean replacement and target-schema
rebaseline. Existing fixtures alone do not justify permanent compatibility or
a create-obsolete-then-drop-obsolete migration chain.

For durable data without live traffic, use the smallest backed-up, restartable
transformation with invariant and recovery proof. For live traffic or an
external supported contract, retain only evidence-justified compatibility and
name its retirement gate. Inspect actual catalogs and installations before
selecting physical deletions. Creating this roadmap authorizes no deletion.

## Runtime And Retention Cleanup

Preserve rollback/release, cancellation, closed-handle refusal, native
lease/fence cleanup, uncertain-outcome recovery and commit/effect retention.
Add a persistent cleanup job only when a selected lifecycle creates a real
retention obligation. Such a job needs bounded work, scope isolation,
idempotency, restart/concurrency safety and a retention policy before admission.
Do not create a new sweeper solely because ownership code moved folders.

## Exit

A selected slice is complete only after all consumers use the intended owner,
obsolete logic/exports/codecs/state are removed, required data migration is
verified, and every retained boundary is justified. An unexplained permanent
bridge or a deferred deletion promised as later housekeeping is unfinished work.
Report an explicit no-DDL disposition when nothing persisted was superseded.
