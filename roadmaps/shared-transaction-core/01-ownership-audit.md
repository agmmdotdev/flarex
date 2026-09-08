# Ownership Completion Audit

## Status And Scope

Complete as a source ownership assessment of currently admitted native,
CMS/Payload and commerce/Medusa paths. R1 physical ownership and R2 CMS
participant/Application materialization are implemented. Overall status lives in the
[domain index](./README.md#next-correctness-gates).

The accepted design remains sound: shared core guarantees with distinct
execution profiles. Remaining work is the CMS participant/materialization split
and representative measured validation. Replacing
framework execution with native logical OCC is unnecessary for this default
design. Neither ownership replacement supersedes persisted state.

This assessment covers source callers, authority registries, settlement,
recovery, schema declarations, package surfaces and relevant test assertions.
It does not certify deployed catalogs, full framework parity or throughput.
The findings are ownership and maintenance gaps, not observed atomicity failures.
Record 36 proves its completed extraction; it does not prove the proposed work.

## Caller And Authority Map

| Path | Actual execution and settlement |
| --- | --- |
| Native Application | [ApplicationMutationSystem](../../packages/standard-application-invocation/src/ApplicationMutationSystem.ts) composes admission, authenticated claims and journals. [Native commit](../../packages/persistence-postgres/src/pointCommitTransaction.ts) validates dependencies and materializes within the [located PostgreSQL runner](../../packages/persistence-postgres/src/postgresLocatedReadCommitted.ts). Shared publication surrounds native session/journal/lease completion. |
| CMS/Payload | [Payload runtime](../../packages/persistence-postgres/src/payloadScalar/runtime.ts) registers commands with the [CMS host](../../packages/persistence-postgres/src/cmsTransaction/host.ts). Commands run the pinned Payload Local API; the [database adapter](../../packages/persistence-postgres/src/payloadScalar/adapter.ts) borrows request capabilities. The host owns a [relational session](../../packages/persistence-postgres/src/relationalTransaction/session.ts), seals pending state and invokes the [CMS participant](../../packages/persistence-postgres/src/cmsTransaction/publication.ts), which shares Application materialization with native commit. |
| Commerce/Medusa | Registered commands enter the [commerce host](../../packages/persistence-postgres/src/commerceTransaction/host.ts). [Service composition](../../packages/medusa-adapter/src/commerce-service-bridge.ts) runs admitted Medusa behavior; [repository context](../../packages/medusa-adapter/src/commerce-repository-context.ts) propagates authentic borrowed managers. The [store](../../packages/persistence-postgres/src/commerceTransaction/store.ts) executes SQL and captures row evidence; [finalization](../../packages/persistence-postgres/src/commerceTransaction/publication.ts) consumes it and invokes shared publication inside the relational session. |
| Synthetic relational proof | The separate [relational host](../../packages/persistence-postgres/src/relationalTransaction/host.ts) exercises synthetic admission and receipts. [Collection admission](../../packages/persistence-postgres/src/commitPublication/collection.ts) rejects any recorded or marked mutation with `unadmittedFinalization`. Read settlement and rollback proofs are not another successful framework write path. |

Both framework hosts resolve current located authority for each attempt, check
exact database/session composition, acquire the scope clock before business
work, and revalidate bindings under the transaction. [CMS admission](../../packages/persistence-postgres/src/cmsTransaction/admission.ts)
and [commerce admission](../../packages/persistence-postgres/src/commerceTransaction/admission.ts)
issue tokens through private WeakMaps and revoke them on exit. Matching fields,
a request ID or a manager-shaped object cannot issue authority. Preparation
before SQL begins does not replace transaction-bound admission.

## Responsibility Dispositions

| Responsibility | Disposition | Evidence and consequence |
| --- | --- | --- |
| Framework physical acquisition, settlement, drain and quarantine | **Satisfied: R1** | [Neutral physical mechanics](../../packages/persistence-postgres/src/physicalSession/postgres.ts) own acquisition, settlement, drain and quarantine. Relational sessions consume neutral deadlines/errors directly. [Artifact composition](../../packages/persistence-postgres/src/frameworkSchema/artifact/postgresControlSession.ts) supplies its schema and exact error constructors; artifact lifecycle decisions remain outside the core. |
| Native physical runner and Effect bridge | **Intentional boundary** | The located runner supports pool-owned and externally owned connected clients, callback/cleanup classification and quarantine. [Its Effect bridge](../../packages/persistence-postgres/src/locatedReadCommittedEffect.ts) preserves complete Cause and admitted SQL retry policy. It is already persistence core; forcing framework deadlines or artifact recovery into it would change policy. |
| Bounded request lifetime and nesting | **Satisfied for CMS/commerce** | [Common lifetime](../../packages/persistence-postgres/src/boundedRequestLifetime.ts) owns rollback-only latching, asynchronous ID rechecks, overlap/depth/budget checks, seal and close. [CMS projection](../../packages/persistence-postgres/src/cmsTransaction/lifetime.ts) supplies its errors/limits. Borrowed operations cannot settle; caught failures cannot reopen a command. |
| Scope, generation, placement and binding | **Satisfied mechanics; intentional participant policies** | Both hosts use located authority, scope-clock and binding/installation owners. Authentic admission registries are transaction-bound. CMS content/preference checks differ from commerce profile/initialization checks; retain them without a permissive union token or generic issuer. |
| CMS finalization and Application lowering | **Satisfied by R2** | `cmsTransaction/publication.ts` owns preparation, CMS error projection, closures, receipts and preference facts. Native and CMS consume one `applicationDocumentMaterialization` owner. Native journal/OCC/session policy and error contracts stay outside that owner; the former CMS entry points are removed from native commit. |
| Commerce finalization | **Satisfied** | Its participant authenticates admission, closing lifetime and one-use row closure, publishes relational facts and required bootstrap initialization before clock advancement. Store/query/lifecycle rules remain commerce policy. |
| Commit allocation, facts, result, wake and clock | **Satisfied** | [Shared publisher](../../packages/persistence-postgres/src/commitPublication/publication.ts) owns allocation and common writes. Between prefix and clock CMS inserts preference facts, commerce inserts initialization, and native completes session/journal/lease work. Only physical settlement acknowledges success. |
| Uncertain settlement and replay | **Satisfied routing; intentional reconciliation policies** | [Request recovery](../../packages/persistence-postgres/src/relationalTransaction/requestRecovery.ts) permits one keyed, single ordinary uncertain-failure recovery entry. Hosts re-resolve authority/binding and consult the [retained outcome resolver](../../packages/persistence-postgres/src/committedPointOutcome.ts) before business work. Recovery-only absence refuses execution. Composite Cause, defect or interruption does not become a callback retry. Native recovery remains native. |
| Framework working state and events | **Intentional boundary** | CMS stages native documents; commerce executes SQL and records facts. [Product local events](../../packages/medusa-adapter/src/product-local-events.ts) keep their admitted local semantics. The host discards ambiguous event buffers before recovery; recovered results do not authorize replay delivery. Durable dispatch is separate. |
| Synthetic lifetime/store/receipts | **Intentional proof boundary** | Current consumers are focused test/support paths, with no package entry exposing a successful synthetic publisher. Preserve refusal and rollback/corruption coverage. This lifetime does not power CMS/commerce and must not become their fallback. Retirement first requires relocating its unique proofs. |
| Artifact and migration transactions | **Intentional control/schema boundaries; R1 corrects resource dependency** | [Artifact lifecycle](../../packages/persistence-postgres/src/frameworkSchema/artifact/controlSession.ts) owns created/existing resolution and recovery after quarantine. [Migration target](../../packages/persistence-postgres/src/migrationCoordination/postgresTarget.ts) owns separately bounded DDL, statement limits and excluded recovery identity. These are not CMS/commerce business committers. R1 does not replace migration coordination. |
| Persisted state and retention | **Retain; no DDL selected** | The [inventory](./02-migration-and-cleanup.md#persisted-state-and-cleanup-inventory) identifies active native execution, shared publication and framework control families. No dedicated CMS/commerce transaction-session family was found in inspected source schema. Runtime close, native lease cleanup and bounded history compaction remain required. |
| Sandbox invocation and mixed atomicity | **Independent capability** | Proposed `ctx.cms`/`ctx.commerce` names do not admit sandbox serving. Standalone CMS admission refuses a commerce frame; the implemented [named command](./05-named-command-preflight.md) has separately authenticated composite admission. [Application invocation](./06-application-command-invocation-preflight.md) is now preflighted but unimplemented; arbitrary mixed native OCC remains separate. Sequential root-host calls cannot join a transaction. |
| Representative performance | **Decision required: criteria; measurement pending** | Scope-level write serialization is shared across native/framework publishers. Framework business work holds that lock longer than native final publication. Validate cost, same-scope contention, independent scopes and mixed load; extraction suite duration is insufficient. |

## Why The Replacements Are Necessary

R1 separates physical resources from artifact control, eliminating the
application-data frameworks' dependency on that control-domain implementation. It includes connected deadline, drain,
connection identity, cancellation, settlement and cleanup mechanics. Another
wrapper would leave this dependency intact. Artifact repository decisions and
schema registration stay outside the neutral resource implementation. Native
connected-client and migration DDL policies remain explicit separate boundaries.

R2 removes the native OCC module's former dependency on CMS admission,
lifetime, document closure and Payload preference policy. Both participants
consume one Application row/index/unique/relation implementation. Composition
identity is checked by the participants through narrow predicates; materialization
does not issue native sessions, CMS admission or publication authority. The
old CMS entry points and shared helper bodies are removed from native commit.

These are connected refactors, not a whole-kernel rewrite or a new public API.
The [implementation proposal](./04-implementation-proposal.md) names consumers,
contracts, deletion sets and decisive validation.

## Invocation And Retention Limits

Private Standard Application mutation composition differs from normal executor
routing: [executor construction](../../packages/executor/src/index.ts) still
installs the legacy-only app-data engine registry. Private CMS runtime and
internal commerce exports do not establish production sandbox serving. SQL
transactions cannot span arbitrary user hooks, sandbox execution, remote effects
or workflow suspension.

Legacy `commits`, `outbox` and `invoke_session` families exist with source
consumers. They are not redundant CMS/commerce engine tables. Their retirement
belongs to the legacy serving migration. Static inspection does not establish
which tables or durable obligations exist in a deployed database.

History compaction does not expire result payloads or remove scope-lifetime
request keys; the [foundation retention contract](../flarexdb-foundation/02-occ-and-transactions.md)
separates those obligations. An expired-outcome decoder does not prove a cleanup
worker exists. R1/R2 introduce no new persistent cleanup obligation.

## Implementation Order And Audit Exit

1. R1 physical ownership, artifact consumption, schema/error projections, consumer switch and displaced-logic removal are implemented with physical-resource conformance.
2. [R2 CMS participant/materialization](./04-implementation-proposal.md#r2-cms-participant-and-application-materialization) is implemented with both consumer switches and displaced-logic removal.
3. Satisfy the [performance and completion contract](./03-validation-and-completion.md), or explicitly accept a measured limitation.

Every audited responsibility now has a disposition. Overall redesign stays open
until replacements and completion gates are resolved. Root Payload transactions,
public APIs, broader composition beyond the named command, general mixed OCC, durable events and
Product scale retain independent capability decisions.
