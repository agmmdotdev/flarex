# Stored Product Sales Channel Link: B3 Preflight

Status: proposed, awaiting implementation approval. B1 and B2 are complete;
this document does not activate native Link storage or workflow Gate C.

## Outcome And Why Now

Install one fresh Product + Sales Channel + ProductSalesChannel candidate and
exercise the actual native Link router/services through three confined profiles
in the existing atomic commerce host. Prove attach, dismiss, endpoint-selected
soft-delete/restore, Link-root reads, events and replay against stored rows.
This supplies the `LINK` dependency of the native
`associate-products-with-channels` step; that step remains Gate C.

The accepted [Medusa boundary](../../../design-notes/flarex-db-accepted-design.md#medusa-boundary),
[commerce-owned Link design](../../../design-notes/flarexdb-medusa-commerce-adapter.md#2-commerce-owned-link-entity),
[adoption gate](../06-medusa-adoption.md#commerce-link-commit-admission),
[shared-installation contract](./55-shared-installation-atomic-commerce.md) and
[native storage contract](./56-native-link-storage-contract.md) govern this slice.
No new Flarex persistence, settlement, feed family, core branch, resource ceiling
or versioned API is proposed. If that assumption fails, preserve the witness and
stop at the shared-core owner; do not repair it in the Link consumer.

## Current Source Evidence

The semantic source remains `third_party/medusa/SOURCE.json`'s pinned fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, package baseline `2.13.4`.
The island is inert; active workspace packages are separately promoted copies.
Reference paths below are relative to its `packages/` directory.

| Owner | Relevant contract or mismatch |
| --- | --- |
| `modules/link-modules/src/definitions/product-sales-channel.ts` | Many-to-many endpoint pair; `id` is non-key; no extra fields or endpoint FK/liveness enforcement. Native Link-root aliases have no method suffix. |
| `modules/link-modules/src/utils/generate-entity.ts` | Owns endpoint primary-key fields, timestamps, ID index and active endpoint indexes, but returns a MikroORM `EntitySchema`. The DML compiler is not this Link's schema source. |
| `modules/link-modules/src/repositories/link.ts` | Generates IDs, mutates native input objects for event construction, and uses ORM `create`/`upsertMany`. Replace the persistence mechanism, not native attach identity semantics. |
| `modules/link-modules/src/services/link.ts` | Owns native query construction and dismiss/endpoint selectors; forwards the transaction manager to repository methods. |
| `modules/link-modules/src/services/link-module-service.ts` | Owns tuple normalization, serialization, lifecycle return maps and attached/detached event building. `create` builds events from its input objects, not merely its returned rows. |
| `modules/link-modules/src/services/dynamic-service-class.ts` and `loaders/container.ts` | Own native service/config naming and Joiner exposure. Construction can be direct and scoped; no Awilix/connection bootstrap is required. |
| `core/modules-sdk/src/link.ts` | Owns routing, grouping and traversal. Constructor falls back to global `MedusaModule` for omitted or empty module lists. Cascade returns errors as data and can launch parallel branches. |
| `core/modules-sdk/src/__tests__/remote-link.spec.ts` | Original routing/traversal witnesses use mocked modules; retain them, but they are not storage evidence. |
| `core/core-flows/src/sales-channel/steps/associate-products-with-channels.ts` | Nonempty invocation needs `LINK.create`; compensation needs `LINK.dismiss`. Empty forward input returns before resolution, but compensation with `[]` still resolves LINK. |

B2's core already supplies full-key mutation, explicit active-row upsert,
unchanged restore observations and trusted non-key event evidence. Existing
Product/Sales Channel schema composition contains fourteen endpoint tables;
`packages/medusa-modules-sdk` currently exposes definitions, not a Link runtime.

## Ownership And Construction

1. Promote the finite native Link closure into a private
   `packages/medusa-link-modules` owner and a portable explicit `./link` entry in
   the existing `packages/medusa-modules-sdk`. Preserve source hashes and label
   infrastructure adaptations. Do not import the source island at runtime or
   promote every link definition, loaders, migrations or ORM packages.
2. Keep structural Link generation with the promoted native Link owner. Extract
   the selected value-only definition from the native generator's algorithm;
   check its endpoint key, columns and indexes against the reference generator.
   Translate it through the existing checked table/lowering owner with Link
   provenance. Do not invent a DML model or copy fifteen hand-authored tables.
3. Put repository, event validation and composition in `medusa-adapter`. Reuse
   `commerceRepositoryContext`, `withCommerceService`, `commerceServiceCommands`,
   query capture/projection/execution and the existing host. Bind actual native
   methods directly. Do not force a non-DML Link through generated ordinary-model
   internal services, or create a general Link registry/CRUD factory.
4. One Link construction entry point owns metadata checks, repository binding,
   native service/router wiring, commands and event policy. Callers provide the
   checked configured candidate and their existing host dependencies. They must
   not individually construct repository, base repository, service, event builder,
   router or manager. The host still explicitly selects the three participants.
5. Keep existing fourteen-table endpoint-only consumers as supported smaller
   configurations, not a runtime fallback. Add the fifteen-table candidate through
   their existing configured-schema owner; Product, Sales Channel and Link grants
   remain disjoint. This is a fresh private fixture, not an existing-row upgrade.

There is no current working stored-Link caller to compare against. The proposed
caller shape is one prepared Link module exposing command tokens/event policy,
then the existing atomic participant configuration. Exact exported names belong
to implementation; no fake API is claimed to exist in this preflight.

## Shared Graph Mismatch: Correct The Owner, Not The Link

The current `medusa-adapter/src/local-graph/module.ts` refuses native aliases
without `args.methodSuffix`; `local-graph/query.ts` also requires a nonblank suffix
and exactly one `ReadTable.primaryKeys` component. Its `graphOrder` uses the first
key and treats each `uniqueOrder` column as independently unique.

Source-level reproducer: give `prepareLocalGraph` an authentic read command and
a table with `primaryKeys: ["left_id", "right_id"]`, matching scalar columns,
ordinary projection/decoder and a valid alias. Even with a nonblank matching
suffix, preparation returns `unsupportedProfile` before the command executes.
Separately, `moduleAliases(ProductSalesChannel)` refuses its native unsuffixed
aliases. These are current explicit guards, not results of a new database run.
Replacing the table key with `id` would misstate native uniqueness; supplying a
made-up suffix would conceal the actual method binding. Neither is acceptable.

Proposed correction belongs to the shared **Medusa graph adapter**, not Flarex:

- Bind each admitted native alias/model to its actual authenticated read command.
  Remove the redundant method-suffix requirement from graph dispatch metadata;
  preserve native suffix checks where a module constructor actually uses them.
  Migrate Product/Currency graph definitions and workflow metadata capture together.
- Retain the complete declared key and deterministic tuple tie-breaking. Do not
  describe a component as independently unique. Reuse the existing bounded read
  window and physical store's full-key tie-break ordering; no new query executor.
- Prove a renamed neutral composite table, equal leading components, duplicate
  non-key IDs, stable offset/count/projection, malformed aliases and existing
  Product/Currency behavior. Existing command and profile authorization remains.
- B3 graph admission is Link-root scalar reads for the declared singular/plural
  aliases. Endpoint modules retain their own reads. Cross-module graph hydration
  such as `product.sales_channels.*`, arbitrary relation filters and reverse
  aliases are not silently included; add them from the next workflow requirement.

Disposition: identified at the owning shared adapter; correction proposed for
B3 approval, not implemented or bypassed by this research.

## Native Compatibility And Refusal Boundaries

- Preserve the characterized endpoint-pair key, replacement ID on repeated attach,
  whole-batch duplicate refusal, native selectors/maps, and attached/detached
  envelopes. Retain B2's approved authoritative timestamp divergence; do not
  reproduce stale flush responses or manager-dependent precision loss.
- Capture caller input before the native repository's ID mutation. The event
  builder must observe the generated ID on its own input object; storage evidence
  must independently validate it. Do not emit substitute adapter-authored events.
- Validate actual native aggregation using operation-local stored rows, including
  earlier IDs replaced later in the same root and no-write repeated restores.
  All durable events still use the existing common commit/outbox owner.
- Require explicit loaded modules; an empty list must not reach global fallback.
  No module set, table, event contract or service can be registered by command code.
- Admit endpoint-triggered traversal from one selected endpoint module/key per
  native call, including batches of IDs. The selected definition has one related
  Link and no endpoint delete cascade, so it does not require parallel transaction
  branches. Reject unsupported multi-origin/multi-link traversal before execution;
  do not introduce a scheduling queue or weaken the core overlap refusal.
- Native cascade errors-as-data are not atomic success. Validate the complete
  returned tuple and latch/refuse a nonempty error list before projecting IDs.
  Preserve already-latched failures, defects and interruption through existing
  Promise/Effect ownership. Test caught failures and escaped native services.
- High-level `Link.delete` is endpoint-selected soft deletion, not physical row
  deletion. Direct Link-module hard delete is not admitted in this slice: its
  native event payload path needs its own identity characterization if required.

## Validation And Completion Gates

- Compare the checked Link schema with native generator metadata: pair PK,
  nonunique ID, timestamp defaults, deletion and endpoint indexes; all fifteen
  tables installed through existing compilation/installation owners.
- Preserve original native routing assertions and preflight 56's storage cases.
  Label portability/timestamp differences separately from unchanged source cases.
- On both PGlite and ordinary-role PostgreSQL: create both endpoints and attach
  through native Link in one root, read pending state, validate all three profiles'
  facts/events, commit once and replay unchanged. Then prove replacement, dismiss,
  repeated restore, endpoint-selected traversal, duplicate batches and missing rows.
- Prove wrong event ID, late native failure, nonempty cascade errors, cancellation,
  wrong scope/participant, escaped manager, limit refusal and uncertain settlement.
  For overlapping attaches, force a real PostgreSQL lock-wait interleaving; two
  concurrent Promises alone are not that witness. Keep existing ceilings/assertions.
- Run shared graph owner and Product/Currency regressions, existing Product/Sales
  Channel/atomic storage consumers, relevant typechecks, provenance/portable/test
  guards, core/diff/staged lint, both required reviewers and one scoped commit.
- Gate C, Pricing, Inventory/Stock Location, shipping-profile dependencies, full
  Product creation, workflow pauses, remote effects and production remain closed.
  Customer is not a prerequisite for this Link or association step.

## Retain / Extend / Replace / Delete

| Action | Owner and completion gate |
| --- | --- |
| Retain | Pinned island, original routing/storage witnesses, existing endpoint configurations, command/profile authority and receipt/finalizer. |
| Extend | Finite promoted native Link package/SDK entry, existing schema composition/lowering, shared graph declared-key support and adapter-owned Link integration. |
| Replace | ORM repository/entity output and global bootstrap with checked values and scoped native bindings; redundant graph suffix dispatch metadata with direct authenticated command binding. |
| Delete | Displaced graph fields/caller assembly within this slice; temporary diagnostics after moving meaningful witnesses to their owners. No legacy API, synthetic key, second event bus or storage fallback. |
