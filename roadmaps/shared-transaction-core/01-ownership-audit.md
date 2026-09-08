# Ownership Completion Audit

## Status And Scope

Pending. This is the audit contract and an initial source map, not a completed
assessment or approval to rewrite each listed subsystem. Overall status lives
in the [domain index](./README.md#next-correctness-gates).

## Responsibility Map To Complete

For each row, trace native, CMS and commerce entry points through actual callers,
authority issuance, settlement, failure and recovery. Record the accepted target
owner, evidence, remaining mismatch and disposition. Shared imports alone do
not prove a clean boundary; different domain policies alone do not prove duplication.

| Responsibility | Initial implementation evidence | Audit question |
| --- | --- | --- |
| Physical transaction acquisition, settlement and resource lifetime | [Relational session](../../packages/persistence-postgres/src/relationalTransaction/session.ts), [native located transaction](../../packages/persistence-postgres/src/locatedReadCommittedEffect.ts), [scoped execution](../../packages/persistence-postgres/src/scopeExecution/ScopeExecution.ts) | Which guarantees are already shared, and which distinct native/framework mechanics are required by their execution profiles? |
| Bounded request lifetime and nested borrowing | [Common lifetime](../../packages/persistence-postgres/src/boundedRequestLifetime.ts), [CMS lifetime projection](../../packages/persistence-postgres/src/cmsTransaction/lifetime.ts) | Do all admitted paths preserve one outer settlement owner, rollback-only state, closed-handle refusal and cleanup? |
| Scope, generation, placement and binding checks | [CMS host](../../packages/persistence-postgres/src/cmsTransaction/host.ts), [commerce host](../../packages/persistence-postgres/src/commerceTransaction/host.ts), scoped execution | Which checks are common authority mechanics and which enforce genuinely different participant bindings? Trace issuance, not just matching field shapes. |
| Complete contribution admission and finalization | [Native/CMS materialization](../../packages/persistence-postgres/src/pointCommitTransaction.ts), [commerce participant](../../packages/persistence-postgres/src/commerceTransaction/publication.ts) | Are policy, authentic evidence consumption and core guarantees in their intended owners? Does retained CMS coupling warrant a coherent extraction? |
| Commit allocation, facts, outcome, wake and clock advancement | [Common publisher](../../packages/persistence-postgres/src/commitPublication/publication.ts), [private model](../../packages/persistence-postgres/src/commitPublication/scopePublicationModel.ts) | Does every admitted participant preserve complete publication and its required intermediate completion work? |
| Uncertain settlement and replay | [Framework router](../../packages/persistence-postgres/src/relationalTransaction/requestRecovery.ts), both hosts, native commit path | Are shared routing, participant authority rechecks, native recovery and business retry policies clearly separated and correctly owned? |
| Framework working state and local events | [CMS documents](../../packages/persistence-postgres/src/cmsTransaction/documents.ts), [commerce store](../../packages/persistence-postgres/src/commerceTransaction/store.ts), [Product local events](../../packages/medusa-adapter/src/product-local-events.ts) | Which state belongs to supported framework semantics, and is any displaced state or alternate path still active? |
| Retention and physical schema | [Core schema](../../packages/persistence-postgres/src/schema.ts), [retained history compactor](../../packages/persistence-postgres/src/retainedCommitHistoryCompaction.ts), framework schema and installation owners | Which writers, readers, compactors and durable obligations justify each retained family? |
| Sandbox-facing invocation and atomicity | Accepted shared-owner design and foundation/framework entry points | Which APIs are implemented, merely proposed or independently settled? Are unsupported atomic combinations refused? |

## Required Dispositions

Classify each inspected responsibility as one of:

- **Satisfied:** target ownership already exists, with direct caller and
  failure/concurrency evidence.
- **Intentional domain boundary:** retain it, naming the semantic or authority
  distinction that requires it and its conformance proof.
- **Required replacement:** accepted design is not met; identify the exact
  current and target owners, all consumers, required contract and deletion set.
- **Decision required:** evidence exposes an unresolved authority, execution,
  schema or compatibility choice; present alternatives before implementation.
- **Independent capability:** identify its separate owner and gate; do not count
  general mixed OCC, public serving or full framework parity as incidental cleanup.

A temporary bridge also needs a consumer, reason and removal condition. Do not
label retained CMS materialization temporary merely because it remained after
record 36. Conversely, do not declare it the final target merely because it exists.

## Deliverable And Exit

Produce a complete responsibility/disposition matrix, dependency and caller map,
schema/logic retention inventory, and an ordered proposal for any further
implementation. Include explicit reasons when no replacement is warranted.
Estimate scope from concrete coupled responsibilities rather than file count.

Connect each proposed slice to the
[replacement checklist](./02-migration-and-cleanup.md) and
[validation contract](./03-validation-and-completion.md). Name material design
choices requiring approval; ordinary details within an approved coherent slice
do not create repeated approval gates. The audit exits when every relevant
boundary has a disposition and the next required capability is concrete and
reviewable. Do not claim overall completion merely because record 36 is complete.
