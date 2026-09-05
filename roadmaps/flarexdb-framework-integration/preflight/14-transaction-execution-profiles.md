# Shared Transaction Ownership And Framework Execution Profiles

## Status And Scope

Status: accepted architecture direction and source-backed preflight;
transaction/store, commit-family, and cross-domain command implementation
contracts and proofs remain pending.

This decision makes shared Application, Payload, and Medusa transaction
ownership concrete without replacing their execution semantics. It refines
[the accepted design](../../../design-notes/flarex-db-accepted-design.md) and
[the transaction roadmap](../04-transactions-and-commit-publication.md).
Binding work continues under its own owner. No dependency, source-island,
runtime, schema, journal, lock-order, or public API change is made by this
decision. Existing lane adoption prerequisites remain in force.

## Source Evidence

Medusa authority is the repository's pinned fork at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, recorded in
[`SOURCE.json`](../../../third_party/medusa/SOURCE.json), rather than upstream
head or the fork's reduced experimental portable repository. Payload authority
is `payload@3.88.0`, release source
`fea6f8a47a50ff1330d8a5071b43e7dcffb97b22`, as frozen by
[its contract audit](./07-payload-release-and-adapter-contract.md).

| Observed contract | Design consequence |
| --- | --- |
| Medusa's [transaction decorator](../../../third_party/medusa/upstream/packages/core/utils/src/modules-sdk/decorators/inject-transaction-manager.ts) and [mature DAL wrapper](../../../third_party/medusa/upstream/packages/core/utils/src/dal/utils.ts) reuse a supplied transaction manager. | Preserve propagation through the adapter; one outer owner settles the physical transaction. |
| Medusa's [event decorator](../../../third_party/medusa/upstream/packages/core/utils/src/modules-sdk/decorators/emit-events.ts) hands aggregated messages to [the service event emitter](../../../third_party/medusa/upstream/packages/core/utils/src/modules-sdk/medusa-service.ts) after service return. | Borrowing an outer transaction requires capturing this handoff as typed event intent; service return alone cannot authorize external delivery. |
| The [product workflow](../../../third_party/medusa/upstream/packages/core/core-flows/src/product/workflows/create-products.ts) coordinates module/link/variant/event work. Its [creation step](../../../third_party/medusa/upstream/packages/core/core-flows/src/product/steps/create-products.ts) supplies a later compensating delete. | Service transaction reuse does not establish workflow-wide SQL atomicity. Preserve workflow checkpoints, retries, waiting, and compensation. |
| Payload's [transaction initializer](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/utilities/initTransaction.ts) distinguishes an existing request transaction from one created by the current operation. | Attach the admitted CMS operation to an authenticated outer session and preserve nested request reuse. |
| Payload's [create lifecycle](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/collections/operations/create.ts) executes `afterChange` before commit and includes pre-commit upload and verification-email paths. | Preserve supported hook order and pending-write visibility. Keep these external-effect features outside the first scalar profile; arbitrary callback replay is unsafe. |
| Payload's [rollback utility](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/payload/src/utilities/killTransaction.ts) clears the request transaction ID; its [Drizzle lookup](https://github.com/payloadcms/payload/blob/fea6f8a47a50ff1330d8a5071b43e7dcffb97b22/packages/drizzle/src/utilities/getTransaction.ts) can fall back to the default connection if a session is missing. | Preserve command admission independently of that mutable request field. A lost borrowed session must abort the command, never become standalone data access. |
| Flarex's [journal](../../../packages/flarex-protocol/src/commit-protocol.ts) carries `LogicalAppWriteV1`; [scoped execution](../../../packages/persistence-postgres/src/scopeExecution/ScopeExecution.ts) acquires the scope clock before Application-shaped operations. | Reuse existing authority through owned interfaces; neither source is an already neutral framework host. Preserve Application behavior and lock ordering during initial extraction. |

These are source findings and integration requirements, not executed adapter
conformance or production compatibility claims.

## Decision And Alternatives

Use one trusted persistence/commit foundation with distinct execution profiles:

| Profile | Execution and recovery | Shared responsibility |
| --- | --- | --- |
| Application mutation | Existing logical journal, explicit read dependencies, OCC validation and admitted rerun | Existing authoritative Application publication and recovery |
| Admitted CMS or commerce command | Bounded trusted database transaction, framework-compatible reads/writes and nested reuse | Scope/binding admission, physical ownership, settlement, typed receipts and finalization |
| Medusa workflow | Framework-owned steps, checkpoints, retries and compensation | Each admitted data transaction uses the common authority; workflow state and locks require their own provider gates |

All authoritative writes need durable commit evidence. That does not require
Payload and Medusa to use Application's temporary execution journal.

Rejected alternative: a universal journal interpreter now. Faithful support
would require transaction-local query overlays for filters, joins, aggregates,
constraints, generated values, locking, failure timing and callback retry
semantics. Appending commerce records alone proves none of these contracts.

Rejected alternative: independently committing framework adapters. It cannot
provide atomic cross-domain database changes or atomic Flarex publication.

Keep Application journal/OCC code and framework semantics. Adapt framework
persistence and event handoff through their narrow contracts. Refactor shared
transaction mechanics only within the approved transaction-owner capability;
do not create a temporary second journal, feed, or outbox authority.

## Ownership And Compatibility Contract

- One outer trusted host owns acquisition and final settlement. Borrowed
  capabilities are opaque and pinned to transaction, scope, generation,
  placement, exact binding, authorized owner/table set, and resource limits.
  No raw SQL handle or finalizer reaches framework or untrusted application
  code. Table ownership and framework validation remain enforced.
- Nested completion does not commit. Failure marks the command rollback-only
  unless a separately admitted savepoint contract proves safe recovery.
  Catching an error cannot reopen a failed transaction. Closed, foreign, or
  missing borrowed handles fail closed, including after request ID removal.
  Standalone reads remain legitimate only under their separate read contract.
- Reads inside the command see its pending writes under the admitted isolation
  policy. Preserve framework result/error behavior, constraints, and supported
  hook ordering. Do not treat Payload `afterChange` as after-commit delivery.
- No SQL transaction spans untrusted execution, arbitrary user callbacks,
  remote effects, or workflow suspension. The first Payload nested callback
  remains a fixed conformance fixture. Later hooks require a supported bounded
  execution contract rather than automatic admission.
- Do not apply Application OCC reruns to arbitrary framework operations.
  Explicitly define command idempotency, confirmed-rollback retries, and
  uncertain-commit recovery before implementation. Resolve uncertain outcomes
  through authoritative evidence rather than blindly executing the command
  again. Medusa workflow retry/compensation remains its own contract.
- Core finalization validates transaction-bound typed receipts and persists
  data, commit evidence, admitted event intents, and the common wake atomically.
  Dispatch only after successful settlement; retry delivery by stable identity.
  This does not guarantee exactly-once effects at an external service.
- Preserve the current scope-clock acquisition order initially. Any replacement
  order must cover all relevant Application, framework, activation and migration
  paths and prove concurrency behavior in genuine PostgreSQL. Shared connection
  mechanics alone do not establish the transaction host contract.

## Explicit Cross-Domain Atomic Command

After the participating lane proofs, a separately admitted named trusted command
may coordinate Application, Payload, and Medusa operations in one scope and one
physical transaction. Each operation enters through its domain capability; the
outer owner finalizes once. A binding across placements cannot supply this
atomicity.

Example target: update a commerce product through its service, create a CMS
announcement, and update an Application launch record. A failure at the final
operation rolls all database changes back and releases no success event.
Product and CMS feature gates must pass before this example is admitted. The
smaller first proof uses an Application row, a scalar CMS collection, and one
supported Currency service operation.

This is a separate command entry point, not an independently committing helper
called from within today's journal-based mutation. Such a helper would commit
before the enclosing logical mutation and break the requested atomicity.
Developer syntax, code generation, and runtime exposure remain separate public
API gates; no generic `transaction(callback)` API is selected here.

If the operation must wait for payment, a remote response, or approval, compose
committed workflow steps and durable intents with compensation. Do not keep the
database transaction open across that wait or describe compensation as rollback
of one uncommitted transaction.

## Sequence And Acceptance

1. Complete the existing binding capability. Use this preflight to constrain
   the next coherent transaction/store capability, with exact ownership,
   admitted operation set, lock order, failure and settlement contracts.
2. Complete typed commit-family admission under the commit owner. Preserve the
   synthetic shared-core proof and existing Application regression gate, then
   the ordered Payload scalar/native-relation and Medusa Currency lane proofs.
3. After those prerequisites, admit the private cross-domain command with an
   explicit Application capability and no bypass of CMS/commerce write owners.
   Its resource, retry, idempotency and recovery contract must be concrete before
   code; this direction does not itself authorize implementation.
4. Prove success and final-operation failure, same-transaction pending reads,
   nested completion without commit, caught nested failure, closed-session
   refusal, and rejection of cross-scope/placement/receipt mixing. Require no
   partial rows, sidecars, facts, wakes, or events on rollback; successful
   finalization includes every admitted contribution.
5. Prove cancellation, concurrent lock/isolation behavior, uncertain settlement,
   recovery, and post-commit dispatcher restart. Use focused PGlite functional
   cases plus genuine PostgreSQL for the physical transaction claims. Retain
   unchanged framework service assertions and separately prove workflow
   compensation/checkpoint behavior when its provider gate is opened.

No broad framework compatibility claim follows from a synthetic transaction
test, one scalar collection, or one Currency operation.
