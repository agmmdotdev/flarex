# Keyed Updates And Remaining Product Tests

## Status And Recommended Next Capability

Preflight prepared on 2026-09-08 after the related creation/read implementation
in [record 30](./30-medusa-product-related-create-and-reads.md). This record is a
proposal, not additional runtime admission. The current original-test target is
11 admitted cases, leaving 45 blocked cases and the single upstream skip.

The next foundation should be bounded updates of existing declared primary-key
rows, proved through the unchanged Product tag and type services. Medusa owns
the update/upsert behavior; Flarex owns the SQL transaction, authenticated facts
and publication. This needs an explicit shared-core capability extension, not
another Medusa-specific metadata table or a bypass around the insert-only gate.

Start with four original cases from
[`events.spec.ts`](../../../packages/medusa-product/integration-tests/__tests__/product-module-service/events.spec.ts).
Their full-name prefix is
`Product injected event bus > ProductModuleService Events > `:

| Exact suffix | Required proof |
| --- | --- |
| `Product Tag Operations > should emit PRODUCT_TAG_UPDATED event on updateProductTags` | Existing tag changes in place and emits one updated event |
| `Product Tag Operations > should emit appropriate events on upsertProductTags` | One new tag and one existing-tag update commit together with exactly two corresponding events |
| `Product Type Operations > should emit PRODUCT_TYPE_UPDATED event on updateProductTypes` | Existing type changes in place and emits one updated event |
| `Product Type Operations > should emit appropriate events on upsertProductTypes` | One new type and one existing-type update commit together with exactly two corresponding events |

Passing this capability would raise original coverage to **15 admitted, 41
blocked and 1 upstream skip**. These four tests require no category setup,
relationship replacement, cascade deletion or increased row limits.

## Current Source Evidence

The shared
[`profile issuer`](../../../packages/persistence-postgres/src/commerceTransaction/profile.ts)
currently registers every local Product table as `readInsert`. The
[`store`](../../../packages/persistence-postgres/src/commerceTransaction/store.ts)
explicitly refuses update/upsert for that mode and permits delete only under
the existing scalar profile. The scalar issuer admits a single restricted
table without business relationships; registering the Product layout as scalar
would misrepresent the contract. This refusal is intentional, not a newly
discovered database defect.

The existing scalar store already groups keyed updates, maintains timestamps,
checks returned identities, and records insert/update facts. Assess and reuse
that owned kernel where its constraints apply. Do not duplicate its SQL in the
Medusa adapter or enable all mutation methods for every installed table.

The pinned
[`ProductModuleService`](../../../packages/medusa-product/src/services/product-module-service.ts)
retrieves a tag/type before an ID-based update, then calls its internal service.
Its upsert path partitions inputs into creates without an ID and updates with
an ID; it does not ask the repository for an unrestricted SQL upsert. New rows
are created first, making a later update failure an important atomicity proof.

The pinned
[`MedusaInternalService`](../../../packages/medusa-utils/src/modules-sdk/medusa-internal-service.ts)
builds an `$or` of primary-key selectors, loads the corresponding rows, rejects
missing data-only identities, merges metadata, and passes `{ entity, update }`
pairs to the repository. The current related-query decoder admits ID predicates
only. It must gain bounded key-selector disjunctions with complete lookup, not
skip that unchanged internal flow.

The current adapter event policy admits only created events and insert facts.
It must bind each newly admitted updated event to an authentic update of that
same entity. A matching ID alone cannot authenticate the operation.

## Proposed Contract And Owners

1. **Shared commerce profile/store:** admit a trusted, operation-specific update
   capability for selected primary-key tables. Preserve all existing profile
   refusals by default, immutable row keys, scoped predicates, managed columns,
   budgets, cancellation and authenticated result/publication contracts. Keep
   this first extension limited to existing-row updates; do not add pivot-key
   delete, cascades or general relational upsert incidentally. Include operation
   admission in the authenticated profile contract. Check whether its persisted
   compatibility envelope needs a new version rather than silently reusing an
   old hash interpretation.
2. **Medusa adapter:** enable tag/type update and service-owned mixed create/update
   commands. Decode repository pairs using DML field metadata and verify that
   an update cannot move an identity or write an undeclared/managed column.
   Reuse the unchanged internal missing-ID and metadata-merge behavior. Add only
   the bounded query operators its concrete call path requires.
3. **Events:** reuse the pinned mutation dispatch helpers and existing local
   buffer. Validate table, identity and operation against captured facts, and
   define repeated-touch/no-op behavior from exact pinned service evidence
   before enabling those inputs. Missing, forged, duplicate or mismatched
   messages must reject the command. Acknowledged commit, uncertain settlement
   and replay retain their current local-delivery behavior.
4. **Tests and promotion:** preserve original source bytes, extend the exact
   full-identity reporter and inventory together, and refresh reviewed source
   hashes. Keep the existing one-install-per-driver fixture lifecycle.

Before implementing the shared owner, settle the exact operation-admission
shape and authenticated-contract compatibility in this record. Record 30 did
not authorize changing the shared insert-only profile. This proposal identifies
that next boundary explicitly rather than treating it as a test-harness fix.

Acceptance needs the four original cases on PGlite and ordinary-role PostgreSQL,
plus focused proofs of complete multi-ID lookup, preserved identity/timestamps,
mixed create/update rollback after a later failure, wrong-scope denial,
unchanged insert-only table refusal, event-operation matching, no-op/repeated
touch policy, and replay/uncertain-settlement preservation. Run the affected
shared-core and Currency preservation tests once per required driver, strict
typechecks, source/browser guards, lint and both reviewers. Keep existing bounds.

## Route To The Other Original Cases

The remaining tests are capability work, not a switch in Vitest configuration:

- **Standalone variants/options:** their create-event cases can reuse the
  insert substrate, but need the real service lookup/normalization paths,
  existing option-value associations and exact event cardinality. The option
  case expects one option plus three option-value events. The variant case
  expects only the new variant event when values already exist.
- **Categories and Product updates:** the entire `products > update` block's
  `beforeEach` creates two categories, then creates a Product with a category
  association. Even a scalar-looking test in that block needs real category
  initialization and Product/category linking first. Category creation also
  calls an explicit event builder in the module service; generic repository
  event dispatch alone is not evidence that its event count is correct.
  Preserve category materialized paths/ranks and selected tree-service behavior.
- **Relationship replacement and collection changes:** inventory inserted,
  updated and removed identities across the affected entities and unique-pair
  pivots. Extend generic keyed change capabilities where needed, while keeping
  replacement policy in Medusa. Physical FK success cannot substitute for
  complete row-fact and event publication.
- **Soft delete, restore and cascades:** preserve visibility and lifecycle
  semantics, enumerate every affected row, and prove complete atomic facts and
  corresponding events. Do not relabel soft deletion as physical deletion.
- **Variant images:** the original case calls `addImageToVariant` and requests
  `variants.images`; it needs the explicit VariantProductImage entity and the
  service's assignment/population behavior, not only the existing image table.
- **Scale:** the original image ordering case supplies 1000 images. It cannot
  pass under the current 256-row graph/catalog contract. Preflight bounded
  chunking, whole-command atomicity, complete reads, byte/statement budgets,
  cancellation and measured costs before increasing a limit. Preserve the
  original data size and keep the separately upstream-skipped performance case
  skipped unless a new request deliberately changes that source contract.

Complete each capability with its exact original and authority-focused proofs
before admitting the next. No stage implies production serving, a durable
business-event provider, query-sync activation, mutable Module Links or general
framework parity.
