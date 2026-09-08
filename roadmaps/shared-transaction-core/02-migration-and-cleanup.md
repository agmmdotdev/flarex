# Replacement And Cleanup

## Status And Scope

The [completed audit](./01-ownership-audit.md) identifies R1 physical resource
ownership and R2 CMS participant/shared materialization. R1 is implemented with
its displaced logic removed; R2 awaits approval. No DDL is selected. The [proposal](./04-implementation-proposal.md)
defines their direct consumer switches and deletion sets. Cleanup is part of
each replacement's completion contract.

## Component Disposition

| Component | Current disposition | Condition for changing it |
| --- | --- | --- |
| Former inline common publisher, native-owned commerce finalizer and duplicate framework recovery routing | Removed under record 36 | No parallel or fallback path may be reintroduced |
| Native publication error projections | Retained for established error semantics | Replace only with an explicit equivalent owned error boundary |
| Artifact-owned physical driver used by relational sessions | Displaced mechanics removed under R1 | One neutral physical owner serves both consumers; retain artifact schema composition, repository decisions and exact error projections |
| CMS/native materialization bridge | Replace ownership under R2; preserve shared lowering | Extract CMS preparation/finalization and connected Application materializer; remove reverse dependency and displaced helper bodies |
| Native journals, sessions and snapshot leases | Retain native execution guarantees | A selected execution change must first supersede their consumers and obligations |
| CMS pending state and commerce SQL stores | Retain admitted domain semantics | A proved replacement must preserve pending reads, nesting, constraints and complete facts |
| Scope clocks, commits, outcomes and outbox | Retain shared authority | No competing ledger or clock introduced for a framework |
| Relational and preference-deletion facts | Retain publication and lifecycle contracts | Replace writers, all readers and compactor/retention obligations together |
| Framework artifacts, installations, initialization, migrations and bindings | Retain control data | Change only for an explicitly selected binding/schema capability |

The inspected static schema has no separate CMS/commerce transaction-session
family corresponding to those two source folders. This is not a deployed-table
deletion inventory. Payment/order business records named transaction must not
be mistaken for transaction-engine state.

## Persisted State And Cleanup Inventory

| Family and source | Writer/reader or lifecycle obligation | Disposition |
| --- | --- | --- |
| Native sessions, execution claims, journals, point/range/relation dependencies, write events, latest receipts and snapshot leases in [core schema](../../packages/persistence-postgres/src/schema.ts) | Native activation, journal storage, OCC validation, terminalization and lease cleanup use these records | Retain. Framework bounded SQL does not supersede native tracked execution. |
| Scope clock, commits, idempotency outcomes and wake outbox in core schema | Shared publisher, retained outcome resolver, commit feed and wake owners require their authority and ordering | Retain. No framework-specific replacement ledger. |
| Native row/index history, current rows, unique keys, edges and adjacency versions in core schema | Native and CMS materialization, snapshot/query readers and bounded history compactors share these guarantees | Retain. Moving lowering code does not replace its data model. |
| [Relational facts](../../packages/persistence-postgres/src/commitPublication/relationalFactsSchema.ts), [preference-deletion facts](../../packages/persistence-postgres/src/payloadPreferences/factsSchema.ts), native row and adjacency facts | Commerce/CMS/native publication and feed validation require complete family counts. [Commit compaction](../../packages/persistence-postgres/src/retainedCommitHistoryCompaction.ts) explicitly validates/deletes all admitted fact families | Retain the families and compactor participation. Preference facts are durable evidence, not a redundant transaction table. |
| [Artifact control](../../packages/persistence-postgres/src/frameworkSchema/artifact/schema.ts), [installations/readiness/availability](../../packages/persistence-postgres/src/frameworkSchema/installation/schema.ts), [initialization](../../packages/persistence-postgres/src/frameworkSchema/installation/initializationSchema.ts), [bindings](../../packages/persistence-postgres/src/frameworkSchema/binding/schema.ts) and [migration records](../../packages/persistence-postgres/src/migrationCoordination/schema.ts) | Registration, installation, DDL recovery, profile admission, binding activation and bootstrap replay rely on these records | Retain under their control/schema owners. R1 changes resource dependency, not control data authority. |
| Dynamically installed Medusa tables and Payload preference storage | Framework repositories, lifecycle cleanup and binding/migration evidence use installed layouts | Retain. These are additional to static core table declarations. |
| Legacy documents/indexes, commits/outbox and invoke-session/read/write tables in core schema | [Runtime persistence](../../packages/persistence-postgres/src/runtimePersistence.ts), [invoke sessions](../../packages/persistence-postgres/src/invokeSessions.ts) and the legacy executor route still have consumers | Separate legacy serving migration. Do not delete them as CMS/commerce cleanup. |
| CMS preparations/pending documents, commerce closures, borrowed managers and local event buffers | Request-owned registries are sealed/revoked/closed, with ambiguous local buffers discarded before recovery | In-memory lifecycle cleanup; no persisted transaction table or scheduled sweeper to migrate. |

This is a source-family inventory, not a deployed catalog or a claim that every
stored family has automatic garbage collection. Engine history maintenance does
not expire result payloads, delete scope-lifetime request keys or collect pending
outbox work. Their owning contracts remain separate. R1/R2 create no new durable
obligation, so their explicit data migration and cleanup-job disposition is
**no DDL, no backfill, no additional persistent job**.

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
