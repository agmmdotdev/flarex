# Keyed Updates And Remaining Product Tests

## Status And Implemented Capability

Preflight prepared on 2026-09-08 after the related creation/read implementation
in [record 30](./30-medusa-product-related-create-and-reads.md). Implementation
and acceptance are complete following the user's go-ahead. The current original-test target is
15 admitted cases, leaving 41 blocked cases and the single upstream skip.

This foundation provides bounded updates of existing declared primary-key
rows, proved through the unchanged Product tag and type services. Medusa owns
the update/upsert behavior; Flarex owns the SQL transaction, authenticated facts
and publication. An explicit shared-core capability extension admits these
updates without Medusa-specific metadata tables.

The four added original cases come from
[`events.spec.ts`](../../../packages/medusa-product/integration-tests/__tests__/product-module-service/events.spec.ts).
Their full-name prefix is
`Product injected event bus > ProductModuleService Events > `:

| Exact suffix | Required proof |
| --- | --- |
| `Product Tag Operations > should emit PRODUCT_TAG_UPDATED event on updateProductTags` | Existing tag changes in place and emits one updated event |
| `Product Tag Operations > should emit appropriate events on upsertProductTags` | One new tag and one existing-tag update commit together with exactly two corresponding events |
| `Product Type Operations > should emit PRODUCT_TYPE_UPDATED event on updateProductTypes` | Existing type changes in place and emits one updated event |
| `Product Type Operations > should emit appropriate events on upsertProductTypes` | One new type and one existing-type update commit together with exactly two corresponding events |

This capability raises original coverage to **15 admitted, 41
blocked and 1 upstream skip**. These four tests require no category setup,
relationship replacement, cascade deletion or increased row limits.

## Pre-implementation Source Evidence

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

## Approved Contract And Owners

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

The operation-admission shape and authenticated-contract compatibility were
settled below before implementing the shared owner. Record 30 did
not authorize changing the shared insert-only profile. This proposal identifies
that next boundary explicitly rather than treating it as a test-harness fix.

Acceptance needs the four original cases on PGlite and ordinary-role PostgreSQL,
plus focused proofs of complete multi-ID lookup, preserved identity/timestamps,
mixed create/update rollback after a later failure, wrong-scope denial,
unchanged insert-only table refusal, event-operation matching, no-op/repeated
touch policy, and replay/uncertain-settlement preservation. Run the affected
shared-core and Currency preservation tests once per required driver, strict
typechecks, source/browser guards, lint and both reviewers. Keep existing bounds.

## Settled Implementation Contract

Trusted local table declarations gain optional `update: "existingPrimaryKey"`.
Omission retains `readInsert`; admission requires exactly one declared text
primary-key component and produces `readInsertUpdate`. Inserts still use the
existing relational insert kernel; only `update` enters the owned scalar update
kernel. SQL upsert and delete remain refused. Missing scoped keys fail the whole
update. Managed timestamp and soft-delete columns, and relationship foreign-key
columns, cannot be supplied as update data. Timestamp maintenance is selected
by the actual table identity, not by every table in a multi-table layout.

Unchanged local declarations retain canonical contract version 2 and their
existing hashes. A declaration with update authority uses version 3, with each
table's exact mode authenticated in the contract. Currency stays version 1.
The binding registry and host command fingerprints compare the complete
contract hash; an old binding cannot grant the new authority, and retained
requests are not reinterpreted under a changed contract. This is a new private
capability envelope, with no database migration or alternate execution path.

Only tag/type ID updates and array/single upserts are exposed. Update command
data cannot contain an ID; internal repository pairs may repeat the same ID as
their selected entity but cannot replace it. Duplicate upsert IDs are refused
before Medusa's data-only map could silently keep only the last input. The
internal `$or` selector is bounded and collapsed to an equivalent ID set, so
complete lookup preserves the existing query-node budget.

The pinned internal service always calls repository update for a found row;
the module's `afterUpdate` interceptor emits `updated` without value comparison.
An empty or equal-value update therefore maintains the managed timestamp and
records one update fact/event. The pinned MessageAggregator deduplicates equal
messages: this bounded profile refuses repeated same-operation touches within
one command rather than losing their multiplicity. Insert and update of the
same identity are distinct authenticated operations; missing, duplicate and
operation-mismatched messages still reject publication. Lifecycle changes stay
refused.

## Implementation And Validation

The shared profile/store now enforce the settled per-table contract. The
adapter enables four commands through the unchanged tag/type services, decodes
their normalized update pairs, and uses the pinned mutation dispatch helper.
The exact original test reporter and case inventory admit only these four
additional identities; original test bytes remain unchanged. No migration,
business-specific core metadata, durable event provider or query-sync path was
added.

On 2026-09-08, the complete 15-case original target passed on PGlite (158.60s)
and PostgreSQL 18.3 (101.52s), each with 42 exclusions. The native role
`flarex_scalar_test` was verified non-superuser. The 22 focused conformance
cases passed on PGlite (196.12s) and PostgreSQL (134.11s), including complete
16-ID updates, metadata merging, managed timestamps, mixed-write rollback,
wrong-scope refusal, immutable/lifecycle fields, unchanged table permissions,
missing/duplicate/operation-mismatched events, repeated-touch refusal, no-op
updates, replay and uncertain update settlement. The 72 pure adapter and three
shared profile tests passed. Adapter/compatibility and persistence package
typechecks, 37 source guards, the 628-input portable browser check, core/diff
lint and both read-only reviewers passed. Currency preservation passed on
PGlite (19 cases, 48.96s) and PostgreSQL (18 cases plus the existing PGlite-only
skip, 36.35s). The corrected parameterized wrong-scope fixture was rerun on
PGlite (one selected case, 111.18s); the complete native conformance run also
used that final fixture. Timings include each process's setup and imports;
no row, command, statement or setup deadline was increased. The next preflight is
[record 32](./32-medusa-standalone-options-and-variants.md).

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
