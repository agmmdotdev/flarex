# Product Nested Creation And Local Event Conformance

## Status And Outcome

Status: implemented and validated as a private fresh-install conformance
capability. Required TypeScript and code-quality reviews are complete.
This record does not authorize serving.
This record narrows the earlier combined persistence/durable-delivery proposal
to a private local Product proof. Durable event storage and dispatch remain
undecided and deferred. The complete Product schema is implemented under
[record 26](./26-medusa-product-schema-and-relationships.md), with shared
installation reconstruction bounded by [record 27](./27-product-installation-reconstruction-cost.md).

The approved capability executes the pinned, unchanged
`ProductModuleService.createProducts` through Flarex, reads the committed nested
graph through that service, and verifies its exact business events with an injected,
transaction-buffered in-memory test adapter.
This closes the first real multi-table commerce command rather than attempting
all Product CRUD at once. Product remains a private, fresh-install test profile;
successful database recovery does not imply durable event recovery.

Admit creation of products with images, options, option values and variants,
including the implicit variant/option-value pairs. Admit bounded retrieval and
listing of those products with explicitly selected `images`, `options`,
`options.values`, `variants` and `variants.options` population paths. List filters
initially cover IDs and handles, with deterministic pagination and explicit
projection checks. Input fields and query options outside the proven profile
must fail before writes, not be silently ignored or return incomplete DTOs.

Existing-entity associations to tags, categories, types and collections,
variant-specific image associations, update/upsert/replacement, soft delete,
restore and hard delete remain unadmitted. Their installed tables do not grant
repository authority. Stored Module Links, Query, workflows, arbitrary custom
repositories, public `ctx.commerce` and production dispatch remain later gates.
This capability adds no event-intent table, event header fields, outbox event
kind, dispatcher, Redis/Cloudflare event provider or query-sync routing.
Replacement and cascade publication are deferred together: physical FK cascade
conformance alone cannot establish complete child change facts.

## Source Evidence And Design Challenges

### Product query reuse

The Product read adapter now consumes the selected storage-independent parts
of the pinned Drizzle Medusa repository through the private
`@medusajs/drizzle/relation-query` export. The extraction includes populate
trees, to-many descriptor resolution, tuple grouping and scalar projection.
It is a reviewed selection of the fork's algorithms, not the complete Drizzle
repository: SQL execution, wildcard/to-one/versioned relations and nested
field selection are not promoted by this change.

`commerce-relations.ts` executes the admitted tree with the current Flarex
manager and bounded stores. Product retains its query grammar, supported paths
and image-rank ordering. The same extracted grouping assembles newly inserted
rows without a database re-read. Variant option reads traverse the declared
pivot directly; target-key ordering retains the private profile's option order.
No new mutation, serving or transaction authority is introduced.

Focused validation is `pnpm --filter @flarex/medusa-adapter exec vitest run
--config vitest.product-query.config.ts`; this includes the existing local
Product conformance suite, runtime metadata checks and extraction regressions.

The source authority remains fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f` under
`third_party/medusa/upstream`. Relevant paths relative to that island are:

- `packages/modules/product/src/services/product-module-service.ts`: manager
  propagation, nested input normalization, validation, entity IDs and event
  subscriber composition. `createProducts_` passes a nested graph to the internal
  Product service; separate scalar inserts alone do not implement this contract.
- `packages/core/utils/src/modules-sdk/medusa-internal-service.ts`: repository
  transactions and persistence event subscriber registration.
- `packages/core/utils/src/modules-sdk/medusa-service.ts` and
  `decorators/emit-events.ts`: entity mutation interception, message aggregation
  and an awaited event-bus `emit` before the outer Flarex transaction settles.
- `packages/modules/product/integration-tests/__tests__/product-module-service/events.spec.ts`
  and `integration-tests/__fixtures__/product/data/create-product.ts`: the nested
  create case expects one batch of 12 messages: one Product, two Options, five
  Option Values, two Variants and two Images. Its four variant/option-value pairs
  also require physical rows, but no corresponding extra business messages.
- `packages/database/drizzle/src/repository.ts`: the newer portable repository
  performs scalar inserts and is not an unchanged nested-graph implementation.
  The mature persistence adapters and pinned integration assertions are the
  compatibility reference for graph persistence and serialization; test-only
  PGlite discovery, SQL acquisition and module-global state cannot be promoted
  into the Flarex runtime.

Current Flarex boundaries to extend are `commerceTransaction/profile.ts`,
`host.ts`, `store.ts`, `commitPublication/relationalFacts.ts`,
and the existing `pointCommitTransaction.ts` finalizer under
`packages/persistence-postgres/src`, plus the private Medusa adapter.

Three assumptions need explicit correction. Runtime admission currently requires
one scalar table and an initialization dataset. Relational fact codec 1 accepts
declared primary keys, whereas implicit Product pivots have non-null unique
pairs without primary keys. Finally, `fx_system_outbox` admits only
`deployment_sync_commit_wake_v1`: a successful wake is not durable delivery of
the 12 domain messages. Neither the older deployment-document `outbox` nor an
in-memory after-commit callback closes that crash window.

The accepted [storage architecture](../../../design-notes/flarexdb-framework-storage-architecture.md#commit-feed-and-outbox)
requires typed, transaction-bound event intents and crash-resumable delivery for
the durable destination. The local-only proof here deliberately does not satisfy
that exit gate and cannot authorize general event-bearing commerce serving.
The [Medusa authority design](../../../design-notes/flarexdb-medusa-commerce-adapter.md#transaction-and-workflow-authority)
keeps services in control of behavior and the existing Flarex finalizer in
control of settlement. Those requirements rule out a Product-owned commit log,
raw ORM managers and direct event-bus delivery during service execution.

## Dispatcher And Query-Sync Audit

The audited owners must not be treated as one existing event dispatcher:

| Owner | Verified boundary | Consequence for this capability |
| --- | --- | --- |
| `packages/query-sync` | Portable query state, evaluation and publication orchestration; `ResultPublisher` accepts `PendingQueryPublication`, including query key, generation and result digest | Preserve this query-result contract; do not encode business events as query results |
| `flarex-backend/deploymentSync` and `deploymentSyncDO.ts` | SQLite state and authenticated Postgres catch-up composition; the DO exposes a private catch-up probe | Some host integration is implemented, but normal client registration/evaluation/delivery is not connected to the new engine |
| `flarex-backend/deliveryDO.ts`, existing delivery routes, executor outbox/freshness APIs | Older delivery path uses legacy live-query delivery records and deployment/timestamp outbox identities | Leave those callers untouched; do not extend or route Product through this displaced architecture |
| `persistence-postgres/commitWakeOutbox.ts` | Current foundation's fixed-kind `fx_system_outbox` repository implements fenced claim/retry/settlement; runtime dispatch is absent | Keep it distinct from the legacy outbox. Repository operations are candidate reuse for later dispatch work, not proof of an implemented dispatcher |

Evidence owners are the [query-sync status matrix](../../query-sync-engine/README.md#status-and-scope),
[host composition contract](../../query-sync-engine/preflight/13-qsync-fx02-postgres-host-composition.md),
[query-result publisher port](../../../packages/query-sync/src/orchestration/publication/Ports.ts),
[current DO](../../../packages/flarex-backend/src/deploymentSyncDO.ts),
[existing client delivery routes](../../../packages/flarex-backend/src/worker.ts),
and [fixed-kind repository](../../../packages/persistence-postgres/src/commitWakeOutbox.ts).
The audit checked source and callers, not deployed traffic. Merely sharing a
scope commit does not make Product rows query-sync-compatible: the current
Flarex source projection covers Application rows and document adjacency;
commerce dependency/change mapping requires its own compatibility proof.

Medusa already has an injected event-bus boundary. The pinned
`packages/modules/event-bus-local/src/services/event-bus-local.ts` can schedule
listeners during `emit`; it does not know when Flarex's outer transaction commits.
Use the selected Medusa `emit` contract with a request-owned test buffer, not a
direct provider call during database work. Full provider/package promotion is
unnecessary for a bounded recording adapter.

## Proposed Shared Contracts

1. **Authenticated module profile and table capabilities.** Extend private
   runtime admission with an immutable table/operation capability set bound to
   the exact artifact, installation, active binding and transaction. Data cannot
   select arbitrary physical tables. Keep Currency's existing profile bytes,
   initialization checks and public read facade compatible. Represent a profile
   with no required initialization explicitly; Product needs structural readiness
   and runtime admission, not a synthetic empty seed receipt. Bind the new table,
   key and explicit local-test event policy into the runtime contract digest.
   Issue the local composition only through private test support; request data
   cannot turn on an in-memory event mode for an ordinary commerce host.
2. **One transaction and one adapter lifecycle.** All generated repositories,
   persistence subscribers and the event capture adapter share the authenticated
   request manager and cancellation owner. Nested decorators borrow that owner;
   they cannot commit, open an independent transaction or escape rollback-only
   failure. Capture external JSON once, then let Medusa normalize its owned
   in-memory graph. Resolve repeated entity references and declared relationships
   in the adapter; reject conflicting identities and unsupported graph shapes.
   Generate defaults and IDs according to the pinned model/service contract,
   persist in FK-safe order, and serialize supported DTOs without cycles.
3. **Generic row identity and complete store receipts.** Reuse the shared
   relational change table. Keep primary-key codec 1 decoding and bytes intact;
   add an explicit codec for a selected declared non-null unique key, bound to
   table/key identity and ordered text components. It must reject partial unique
   indexes, nullable keys and undeclared key choices. This admits implicit pivot
   identity without inventing IDs or changing their physical schema. The store
   owns receipts for every successful row write; commands cannot fabricate,
   omit, duplicate or replay them across transactions. A create fixture with 12
   entities and four pairs must account for all 16 inserted rows independently
   of its 12 business messages.
4. **Typed local event capture.** Preserve the pinned subscribers,
   message builders and aggregator. The injected event-bus adapter captures the
   exact allowed `*.created` messages for the five admitted entity kinds, rather
   than sending them. It checks names, metadata, IDs, options and the corresponding
   authenticated create observations. Unsupported event families or options
   poison the command even if service code catches the error. Medusa owns the
   message codec. Keep captured messages detached, count/byte bounded and isolated
   per outer request; seal and validate the complete buffer before finalization.
   No core event child records are persisted. The local test composition must
   not weaken ordinary hosts' refusal of unadmitted events.
5. **One row commit and release after confirmation.** Publish business rows,
   complete relational facts, retained result and the existing fixed-kind wake
   atomically through the current finalizer. Only the local outer composition,
   after successful database settlement, may release its sealed buffer to the
   injected in-memory recording/listener destination. Nested calls cannot release
   it. Rollback or unresolved COMMIT outcome releases nothing. Release happens
   outside the SQL transaction and closed repository lifetime; destination work
   has a separate bounded test lifetime and no borrowed database manager.
6. **Explicit local failure and recovery limits.** Lost-response recovery still
   proves database result/row idempotency. Release an in-memory buffer at most
   once after acknowledged settlement of its own attempt. Any uncertain COMMIT
   discards that buffer and records local delivery loss, even when database-result
   recovery succeeds. An identical competing request can provide the retained
   result after the first attempt rolled back; neither request identity, a reused
   tentative commit sequence, equal results nor equal row facts proves which
   attempt committed. The local profile adds no durable attempt identity to
   resolve that ambiguity. A replay that
   merely reads a stored result must not reconstruct or emit messages. Process
   loss, cancellation between commit and release, or loss of the buffer can
   permanently lose local notifications. This profile makes no at-least-once or
   exactly-once delivery claim. A local listener failure after commit cannot roll
   back rows or change the stored successful result: report it separately in the
   test harness, without rerunning the mutation or adding automatic delivery retry.

The new multi-table runtime admission and row-key codec remain the material
contracts proposed here. Core schema metadata, commit header fields, outbox
allocation, wake kinds and retention policy do not change for local events.
Preserve current Currency/Application semantics and canonical contracts.

## Deferred Durable Event Decision

The earlier `fx_system_commit_event_intent` table, event header evidence and
second outbox kind are withdrawn from this capability. They remain possible
designs, not accepted requirements. Durable event storage is necessary for a
database-to-provider crash-safe handoff, but a separate table is not inevitable.
The later preflight must compare extending shared outbox payload storage with
separate immutable intent storage, against actual authority, retention, ordering,
integrity and delivery-consumer requirements. Redis or another external provider
alone cannot make its enqueue atomic with a Flarex database commit.

That capability must identify the real dispatch owner, review overlap with the
new query-sync wake/publication work, and prove any reusable claim/settlement
mechanics before extracting shared code. Do not copy the legacy dispatcher,
turn query-result publication into a general event bus, add another commit log,
or require query-sync production activation merely to prove Product persistence.
Provider integration, delivery identities, uncertain acceptance, retry, claims,
dead letters, retention and crash recovery belong in that later coherent proof.

The local buffer is a temporary test bridge whose only consumer is this private
conformance harness. Replace its role in any future serving composition with the
accepted durable capture/dispatch path before event-bearing serving is admitted;
it may remain an explicit test double. Production cannot silently fall back to
memory. Verify actual retained-data obligations before prescribing a metadata
migration; fixtures alone do not justify dual storage or legacy readers.

## Implementation Ownership And Order

Model definitions remain imports from the pinned `@medusajs/product/models`
package. The adapter derives entity table identity, ID prefixes, foreign keys
and pivot columns from those models and the existing DML compiler output. It
reuses Medusa's ID generation, event-name construction and portable mutation
subscriber dispatch. A second handwritten Product entity/schema registry is
not an accepted source of truth. Explicit supported operation and relation lists
remain adapter capability policy; importing a model does not admit every method.
Currency and Product share input capture, manager authentication and the owned
Promise/transaction bridge. The Product service's business implementation stays
unchanged apart from imports into the promoted portable source closure.

| Concern | Classification and action |
| --- | --- |
| Pinned Product service, decorators, event builders and selected assertions | Keep semantics; port the connected exact runtime closure with provenance and Worker import guards |
| Adapter repository graph, query translation, serialization and event capture | Implement in `packages/medusa-adapter` against mature Medusa contracts; reuse existing portable helpers where compatible |
| Currency manager authentication and Promise lifecycle | Keep behavior; consolidate the connected shared adapter machinery instead of cloning it for Product |
| Scalar commerce profile/store restrictions | Rewrite admission and storage into bounded table capabilities; preserve Currency's tested path and identity |
| Shared schema/readiness and relational fact storage | Keep owners; extend generic key codec and runtime readiness admission |
| Point commit finalizer and common outbox | Keep row settlement, retained result and fixed-kind wake behavior; extend only connected generic row-key handling |
| Local event buffer and recording destination | Temporary test bridge in the private adapter/host harness; confirmed-commit release and explicit crash-loss limitation |
| New query-sync engine and current commit-wake repository | Keep unchanged; consult their owners for the later durable-delivery capability |
| Legacy delivery/outbox/freshness path | Keep current callers untouched; exclude from new Product integration |
| ORM/database acquisition and test-specific runtime adapters | Keep as reference only; no temporary raw SQL or independent publication bridge |

Implement the connected contracts, source promotion, adapter and end-to-end
conformance as one capability. Ordinary implementation details, integration
failures and required review fixes do not create further micro approval gates.

## Completion Proof

- Freeze the runtime promotion inventory and preserve the selected pinned create,
  retrieval and event assertions. Prove the exact 12 messages independently from
  all entity and pivot row facts; include generated defaults, invalid variants,
  duplicate handles/SKUs, unsupported associations and query refusal.
- Prove pending reads through borrowed managers, committed nested population,
  scope/binding isolation, duplicate graph identity refusal, cancellation and
  late/overlapping DAL work. Reject forged table, row and event receipts and
  cross-request replay. Include a differently named synthetic table/key profile
  to expose accidental Product-specific core rules without widening framework
  admission. Prove a request flag cannot enable the local-only composition.
- Inject failures after child inserts, during event capture and finalization;
  assert no rows, facts, result or wake records survive rollback and no local
  subscriber observes a message.
  Prove lost-response recovery, request-key conflicts and retained-result expiry.
- Prove the 12 captured messages release only after confirmed commit, with
  subscriber reads observing all 16 rows. Test nested buffering, malformed/late
  events, rollback disposal, uncertain settlement, retained-result replay without
  re-emission, listener failure after commit and deliberate buffer-loss behavior.
  Database durability must remain distinct from local event delivery. Native
  PostgreSQL supplies concurrent request and uniqueness proofs; PGlite alone
  cannot prove those. Dispatcher claims/retry/retention are deferred, not passed.
- Use one parameterized conformance body and an installed baseline per database
  lane, with isolated/reset case data. Do not reinstall 13 Product tables for
  every assertion or add independent PGlite engines for the same fixture. Run
  cheap codec/source tests first, focused integration tests next and affected
  Currency/Payload/commit-wake preservation checks once after integration. Keep
  cancellable setup and measured command budgets; do not hide regressions with
  unbounded waits or weakened deadlines.
- Run affected package builds/typechecks, portable-source guards, required lint
  and both repository reviewers before the coherent code commit. Reconcile this
  proposal and the gate matrix only with observed evidence, distinguishing native
  PostgreSQL, PGlite and untested deployed runtime behavior.

## Observed Acceptance (2026-09-07)

- Product: the same 14 conformance cases passed on PGlite and ordinary-role
  PostgreSQL 18.3. The nested graph contains 12 entity rows, four pivot rows,
  16 authenticated relational facts and the exact 12 Medusa messages. Selected
  create/event assertions retain provenance to the pinned Product events test;
  additional Flarex authority, rollback, recovery and retention tests are authored.
- Installation plus cold-profile reopening: 79.266 seconds on PGlite and 71.634
  seconds on PostgreSQL, within the unchanged cancellable 90-second budget.
  Complete Product commands took 135.45 and 116.97 seconds respectively.
- Currency preservation: 19 cases passed on PGlite; 18 passed on PostgreSQL with
  one PGlite-specific interruption case skipped. Coordinator stored restoration,
  graph read-pass and synthetic commerce admission checks: 13 cases passed.
- CMS host/lifetime, binding and wake/schema preservation: 28 of 32 cases passed
  in the combined run; four PostgreSQL wake cases exceeded the existing default
  five-second test timeout. An isolated rerun passed five of six PostgreSQL wake
  cases, with migration upgrade/replay still exceeding five seconds. All six
  passed with a diagnostic CLI timeout of 30 seconds (17.73 seconds for the file).
  This establishes functional preservation, not default-budget acceptance for
  that existing migration fixture. No timeout configuration or assertion changed.
- Affected Medusa builds, adapter and persistence typechecks, source promotion
  and browser guards (614 inputs), lint and both required reviewers passed.
  Product model metadata checks also passed. The generated migration snapshot
  matches the generic row-key codec constraint; no event table was introduced.

The remaining migration-fixture timing issue is test-owner follow-up; it does
not relax the Product setup budget. No deployed Cloudflare runtime, general
Product CRUD, durable event provider or production-serving claim follows from
these local database proofs. Retained-result expiry is exercised separately from
feed compaction, which must preserve the live result and business rows.
