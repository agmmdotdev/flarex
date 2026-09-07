# Product Nested Creation And Durable Event Delivery

## Status And Outcome

Status: proposed transaction and event contract for discussion; runtime admission
is not implemented. The complete Product schema is implemented under
[record 26](./26-medusa-product-schema-and-relationships.md), with shared
installation reconstruction bounded by [record 27](./27-product-installation-reconstruction-cost.md).

The next coherent capability should execute the pinned, unchanged
`ProductModuleService.createProducts` through Flarex, read the committed nested
graph through that service, and recover and deliver its exact business events.
This closes the first real multi-table commerce command rather than attempting
all Product CRUD at once. Product remains a private, fresh-install profile.

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
Replacement and cascade publication are deferred together: physical FK cascade
conformance alone cannot establish complete child change facts.

## Source Evidence And Design Challenges

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
`pointCommitTransaction.ts`, `schema.ts` and `commitWakeOutbox.ts` under
`packages/persistence-postgres/src`, plus the private Medusa adapter.

Three assumptions need explicit correction. Runtime admission currently requires
one scalar table and an initialization dataset. Relational fact codec 1 accepts
declared primary keys, whereas implicit Product pivots have non-null unique
pairs without primary keys. Finally, `fx_system_outbox` admits only
`deployment_sync_commit_wake_v1`: a successful wake is not durable delivery of
the 12 domain messages. Neither the older deployment-document `outbox` nor an
in-memory after-commit callback closes that crash window.

The accepted [storage architecture](../../../design-notes/flarexdb-framework-storage-architecture.md#commit-feed-and-outbox)
requires typed, transaction-bound event intents and crash-resumable delivery.
The [Medusa authority design](../../../design-notes/flarexdb-medusa-commerce-adapter.md#transaction-and-workflow-authority)
keeps services in control of behavior and the existing Flarex finalizer in
control of settlement. Those requirements rule out a Product-owned commit log,
raw ORM managers and direct event-bus delivery during service execution.

## Proposed Shared Contracts

1. **Authenticated module profile and table capabilities.** Extend private
   runtime admission with an immutable table/operation capability set bound to
   the exact artifact, installation, active binding and transaction. Data cannot
   select arbitrary physical tables. Keep Currency's existing profile bytes,
   initialization checks and public read facade compatible. Represent a profile
   with no required initialization explicitly; Product needs structural readiness
   and runtime admission, not a synthetic empty seed receipt. Bind the new table,
   key and event capabilities into the runtime contract digest.
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
4. **Typed event capture with generic storage.** Preserve the pinned subscribers,
   message builders and aggregator. The injected event-bus adapter captures the
   exact allowed `*.created` messages for the five admitted entity kinds, rather
   than sending them. It checks names, metadata, IDs, options and the corresponding
   authenticated create observations. Unsupported event families or options
   poison the command even if service code catches the error. Flarex stores a
   bounded canonical envelope containing contract/codec identity, installation,
   artifact and payload digest; Medusa owns the business-message codec. A trusted
   profile capability validates the payload, not arbitrary caller JSON. The outer
   owner authenticates and consumes the complete event receipt collection once.
5. **One commit authority and durable batch delivery.** Add a shared
   `fx_system_commit_event_intent` child table, keyed by scope, commit and ordinal,
   with epoch, installation/artifact, contract/codec identity, canonical bytes
   and digest. Add generic event count and aggregate digest evidence to the commit
   header so deletion or substitution cannot silently shorten a batch. Currency
   and Application commits use canonical empty-event evidence. No Product-named table,
   header column, fixed count or event-name constraint belongs in core storage.
   Publish rows, row facts, intents, retained result and outbox records atomically
   through the current finalizer. Preserve the current sync wake and add one
   generic event-batch kind in the same `fx_system_outbox` for a nonempty batch.
   Reserve the required outbox sequence range under the existing scope lock;
   do not add a separate counter or commit sequence. Existing wake consumers
   remain restricted to their kind and must tolerate sequence gaps belonging
   to another kind.
6. **Delivery, recovery and retention.** Reuse the existing fenced claim, expiry,
   retry and settlement mechanics behind operation-specific facades. A private
   batch dispatcher reads and authenticates committed intents before invoking
   its injected destination. Give each message a stable delivery identity based
   on scope, epoch, commit and ordinal, separate from unchanged Medusa payload
   bytes. Delivery is at least once: a crash after destination acceptance but
   before acknowledgement can repeat the batch, so the destination must dedupe
   by those identities. Retain payload and authentication evidence while pending,
   claimed or dead-lettered; result expiry and commit pruning must not discard
   undelivered events. Explicit disposal/replay policy remains required for
   production. Lost COMMIT response recovery reads the retained command result
   without rerunning the service or minting new message identities.

The new child family, header evidence, key codec and second outbox kind are
material persistence/transaction contract changes proposed for approval here.
They are shared capabilities even while only this Product command admits events.
Keep current Currency and Application semantics and canonical contracts intact;
broadening a SQL check without matching readers and recovery is insufficient.
Verify whether any authoritative retained deployment needs a metadata upgrade
before defining one. Without that evidence, rebaseline the private fresh schema
instead of inventing a legacy migration or dual reader. No live routing or
external destination is activated by this proof.

## Implementation Ownership And Order

| Concern | Classification and action |
| --- | --- |
| Pinned Product service, decorators, event builders and selected assertions | Keep semantics; port the connected exact runtime closure with provenance and Worker import guards |
| Adapter repository graph, query translation, serialization and event capture | Implement in `packages/medusa-adapter` against mature Medusa contracts; reuse existing portable helpers where compatible |
| Currency manager authentication and Promise lifecycle | Keep behavior; consolidate the connected shared adapter machinery instead of cloning it for Product |
| Scalar commerce profile/store restrictions | Rewrite admission and storage into bounded table capabilities; preserve Currency's tested path and identity |
| Shared schema/readiness and relational fact storage | Keep owners; extend generic key codec and runtime readiness admission |
| Point commit finalizer and common outbox | Keep settlement authority; extend typed intent contributions, allocation, readers, retention and fenced delivery |
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
  cross-request replay. Include a differently named synthetic profile/key/event
  codec to expose accidental Product-specific core rules without widening live
  framework admission.
- Inject failures after child inserts, during event capture and finalization;
  assert no rows, facts, intents, result or outbox records survive rollback.
  Prove lost-response recovery, request-key conflicts and retained-result expiry.
- Prove no delivery before commit, event corruption/missing-child refusal,
  dispatcher crash/reclaim, stale acknowledgements, destination deduplication,
  retry and dead-letter retention. Native PostgreSQL supplies concurrent request,
  uniqueness and competing claim proofs; PGlite alone cannot prove those.
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
