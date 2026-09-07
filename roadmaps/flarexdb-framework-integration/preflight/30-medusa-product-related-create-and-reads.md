# Product Related Creation And Reads

## Status And Decision

Implemented privately following user approval of the 2026-09-08 preflight to
make skipped original Product cases runnable. Related creation, associations
and bounded reads now admit the eight original cases below, for eleven total.
The original assertions remain unchanged. Validation evidence is recorded below.
The preflight service/runner baseline was `0c80319a`, including relation-helper
reuse in `20b3f338`. Implementation builds on the completed decoder work through
`c2c20e10` and extends its shared strict decoder boundary. The following sections
retain the accepted implementation contract and explicit admission limits.

Implement related-entity creation and the bounded Product associations and reads
below as one capability. Preserve the unchanged pinned Medusa service and its
assertions; extend the adapter beneath it. Reuse the already installed business
tables and the shared commerce transaction, row-fact, receipt and publication
machinery. No new core metadata table, column, migration, dispatcher or durable
business-event storage is proposed.

## Exact Original Cases Targeted

[Record 29](./29-medusa-original-product-tests.md) established three of the
57 registered original cases. The [inventory](./product-upstream-test-cases.json)
now records 11 admitted, 45 blocked, and 1 skipped by upstream. The following
eight cases are the additional admission under this record.

Event case identities have the prefix
`Product injected event bus > ProductModuleService Events > ` and come from
[`events.spec.ts`](../../../packages/medusa-product/integration-tests/__tests__/product-module-service/events.spec.ts).
Product case identities have the prefix
`Product service > ProductModuleService products > ` and come from
[`products.spec.ts`](../../../packages/medusa-product/integration-tests/__tests__/product-module-service/products.spec.ts).
Append the exact suffix below to the corresponding prefix.

| Suite | Exact identity suffix | Required behavior |
| --- | --- | --- |
| Event | `Product Tag Operations > should emit PRODUCT_TAG_CREATED event on createProductTags` | Standalone tag insertion and exactly one authenticated created event |
| Event | `Product Type Operations > should emit PRODUCT_TYPE_CREATED event on createProductTypes` | Standalone type insertion and exactly one authenticated created event |
| Event | `Product Collection Operations > should emit PRODUCT_COLLECTION_CREATED event on createProductCollections` | Collection normalization, create-only repository replacement path and exactly one created event |
| Product | `create > should create a product` | Create a tag, associate its existing identity, insert the product-tag pivot, populate tags and genuinely read empty categories alongside the existing nested graph |
| Product | `list > should return a list of products scoped by collection id` | Shared collection/tag setup, product collection FK, root filtering and belongs-to population |
| Product | `list > should return a list of products scoped by variant options` | Same setup, then correlated variant/option-value existence filtering before root pagination |
| Product | `list > should return empty array when querying for a collection that doesnt exist` | Same setup, actual category-ID relation filtering, and valid nested collection projection |
| Product | `images > should retrieve images ordered by rank` | Standalone image insertion for an existing product, preserved explicit ranks and ordered population |

Acceptance yields **11 admitted, 45 blocked and 1 upstream skip**
in these two files: 11 executed and 46 skipped per driver. Other Product suites
remain outside this registration. Do not enable a whole describe block or change
the original upstream skip.

The third list case has a misleading title. Its actual filter is
`categories: { id: ["collection-doesnt-exist-id"] }`, with
`select: ["title", "collection.title"]` and `relations: ["collection"]`.
Preserve that exact behavior. Returning a fabricated empty array or translating
the filter into a collection lookup would not prove compatibility.

## Source Findings And Implementation Boundaries

### Model metadata and command admission

[`product-schema.ts`](../../../packages/medusa-adapter/src/product-schema.ts)
already imports all ten actual Product models and compiles thirteen business
tables. The runtime now selects eight writable entities, two writable pivots,
and category/category-pivot reads from that compiler metadata. Keep IDs, prefixes, columns,
foreign keys and unique-pair keys derived from the pinned DML; do not duplicate
model definitions or add module-specific core schema.

Add private commands and table-bound repositories for `createProductTags`,
`createProductTypes`, `createProductCollections` and `createProductImages`.
Retain the existing Product create/retrieve/list/list-and-count commands.
Related repositories need the narrowly decoded reads used internally by those
services, including the tag lookup during Product creation. The baseline
[`product-service.ts`](../../../packages/medusa-adapter/src/product-service.ts)
supplied blocked repositories to those internal services; the implementation
now supplies their table-bound repositories sharing the same request bridge. The
Product graph repository cannot simply be reused as their implementation: its
create and query methods interpret every call as a Product graph/root.

Admit `tag_ids` and `collection_id` on Product creation, plus `type_id` with an
authored association proof. Admit existing-product `product_id` for standalone
images. Reject unknown fields, foreign managers, unsupported nested payloads,
and unadmitted commands at the owned boundary. Category tables participate in
reads only in this slice; category creation, tree mutations and `category_ids`
association writes remain refused. This is adapter command policy: the existing
core local table capability is `readInsert`, not a new core read-only table mode.
Keep read-table metadata distinct from entity creation/event admission so adding
category reads does not silently admit category writes.

### Preserve the real service call flow

The pinned
[`ProductModuleService`](../../../packages/medusa-product/src/services/product-module-service.ts)
owns normalization and domain behavior:

- Tags and types call their internal service's `create` and serialize the result.
- Collections normalize title/handle, then call internal `upsertWithReplace`
  with `relations: ["products"]`, even when creating a new collection.
- Product creation normalizes `tag_ids`, loads existing tags, refuses missing
  tags, and passes the resolved existing objects into its graph repository.
- Standalone images use the generated
  [`MedusaService`](../../../packages/medusa-utils/src/modules-sdk/medusa-service.ts)
  create method. Preserve supplied ranks; nested Product image normalization
  is a different service path.

For collections, implement only the repository subset reached by creating new
rows with no product reassignment. Accept caller-supplied fresh IDs, as the
original list setup requires. Reject existing-ID replacement, product assignment
payloads and unsupported replacement configurations; concurrent duplicate IDs
must fail atomically through the shared insert/constraint path. Do not expose
general upsert or rewrite `createProductCollections` to bypass its service.

The collection repository must return accurate `performedActions` with created
identities and empty updated/deleted maps. The pinned
[`MedusaInternalService`](../../../packages/medusa-utils/src/modules-sdk/medusa-internal-service.ts)
dispatches those actions itself for `upsertWithReplace`. Reusing the ordinary
create dispatch in that repository path would emit duplicates.

When Product creation references an existing tag, persist only the new pivot
alongside new Product graph rows. Do not reinsert the tag, change its identity,
or emit a second tag-created event. Apply the same existing-identity discipline
to collection/type FKs and image parent references, within the current scope.

### Bounded filtering and population

Reuse the promoted
[`relation-query` helpers](../../../packages/medusa-drizzle/src/relation-query.ts)
for descriptor resolution, tuple identity, grouping, population trees and field
projection wherever their contracts apply. The promoted descriptor and grouping
surface currently supports to-many relations; collection/type belongs-to
population needs an adapter extension. Before extracting additional pure helpers,
inspect the exact pinned source, keep provenance/promotion checks, and avoid
pulling its database execution engine into Flarex.

Extend the shared adapter relation machinery rather than embedding queries in
the upstream test runner. Resolve joins from compiler descriptors, apply the
existing soft-delete visibility, preserve null/empty relation semantics, and
read all related rows through the same owned commerce manager. Category reads
must query the declared category/pivot tables; the original cases only exercise
their empty/missing branch and do not prove category mutation or tree parity.

Translate admitted nested existence predicates into bounded related-table reads
and root-key predicates through the existing store `in`, `and`, `or`, `isNull`,
`find` and `count` operations. Predicates on an option ID and value must match
the same option-value row, connected through the declared pivot to the variant
and Product. Deduplicate matching root keys before applying pagination and
count. Filtering a previously paginated root window is incorrect.

Validate the complete query, including projection and relations, before any
empty-result shortcut. Preserve internal join keys until assembly and remove
unselected fields from the returned projection, including nested collection
fields. Count and list must use the same qualified root set in one transaction.

Every intermediate result must be known complete within existing limits. Use
bounded counts or another supported completeness proof before consuming a
limited related-row result; refuse overflow rather than treating the first 256
matches as all matches. Keep row, predicate, statement, byte and cancellation
budgets unchanged. This is a bounded adapter query capability, not general SQL
joins or unrestricted Medusa filtering.

### Shared core and local events

The current shared
[`commerce store`](../../../packages/persistence-postgres/src/commerceTransaction/store.ts)
already supplies scoped multi-table read/insert and declared-key facts. No
shared-owner defect has been demonstrated by this preflight. The expected work
is adapter metadata, repositories, command admission, relation queries, local
event validation and the runner's dispatch/selection surface. If execution
exposes a shared-owner defect or requires a new core primitive, record its
reproduction and owner and obtain the separately required correction approval
under AGENTS.md before changing that owner.

Extend the adapter's authenticated local event policy to the newly admitted
entity-created messages and explicitly declared association pivots. Every pivot
still needs its validated row key and fact; a pivot does not invent an entity
event. Do not exempt arbitrary non-entity tables from validation. Preserve exact
message/row matching, duplicate/missing-event rejection and whole-command
rollback. Release local events only after acknowledged commit; uncertain
settlement and retained-result replay keep record 28's existing behavior.
The common commit wake is unchanged. Business events remain in memory for these
private tests; neither durable delivery nor client query sync is activated.

## Acceptance And Efficient Validation

Keep the two original files byte-identical to the pin. After implementing the
capability, update the runner dispatch, exact full-identity coverage assertion
and eight inventory statuses together. Missing, duplicate, unexpected or wholly
skipped admitted coverage must still fail the run.

Run `pnpm --filter @flarex/medusa-adapter test:product:upstream` once successfully
on each driver, using `FLAREX_TEST_DRIVER=postgres` and an ordinary-role
`FLAREX_POSTGRES_DATABASE_URL` for PostgreSQL. Reuse the existing single installed
fixture per driver and per-case business-row cleanup; do not reinstall for every
case. Retain the 90-second installation/cold-open bound and existing hooks.

Add focused authored boundary coverage alongside the original assertions:

- Existing tags retain identity and emit no duplicate create event when linked;
  missing/foreign-scope identities and late insert failures roll back the graph,
  pivots, result publication and local event batch.
- Collection create with a fresh explicit ID succeeds; existing-ID replacement,
  product reassignment and all unadmitted methods fail. Exact collection event
  cardinality proves the `performedActions` dispatch is not duplicated.
- Type association and belongs-to null/selected-field behavior work; standalone
  image ranks and parent identity are preserved.
- Relation filtering covers matching/nonmatching rows, same-row correlation,
  duplicate matches, pagination, count and scope isolation. Invalid nested
  config fails even when no roots match. Intermediate overflow refuses instead
  of truncating. Category writes remain denied; the two original empty-category
  assertions are not reported as full category compatibility.
- Existing nested-create/event cases and rollback, uncertain-settlement and
  replay contracts remain intact for the expanded writable metadata.

Run the affected strict authored-code and Currency compatibility typechecks,
promotion/source guards, portable browser guard, focused Currency preservation,
lint and the two required code reviewers before the implementation commit.
Keep unrelated persistence suites out of this adapter-only acceptance unless
changes or failures justify them. Record driver timings and unavailable native
validation honestly. The original preflight added no database acceptance;
implementation validation is recorded below.

## Observed Implementation Validation (2026-09-08)

- All eleven original cases passed on PGlite (112.46 seconds) and ordinary-role
  PostgreSQL 18.3 (91.07 seconds), each reporting all 46 excluded cases.
- The focused PGlite suite passed 88 checks. Review then found an internal
  unpaginated tag lookup that defaulted to 15 rows. The adapter now proves its
  complete bounded result before projection, preserving explicit paging. A
  separate 16-existing-tag regression passed on PGlite (103.63 seconds including
  fixture setup), proving preserved identities, retrieval and no duplicate events.
- Strict authored adapter and Currency compatibility typechecking passed;
  source/promotion guards passed 37 tests and portable bundles checked 628 inputs.
  Both required reviewers accepted the correction. No shared-core source or
  migration changed, and no deadline was raised.
- PostgreSQL passed all 18 Product conformance cases (109.85 seconds), including
  the 16-tag regression, category-write denial, null/nested projections and
  positive/negative same-row filtering. Its five pure-test files also passed.
  An earlier native run timed out one insert at the existing one-second
  statement deadline; its dependent replacement check consequently failed.
  The two affected cases passed on a fresh targeted run, followed by the full
  18-case pass above. Limits and assertions were retained.
- Currency preservation passed all 19 live PGlite cases (62.94 seconds) and
  18 ordinary-role PostgreSQL cases (32.30 seconds), with its one PGlite-only
  interruption case skipped in the native lane.

## Following Capabilities

After this slice, plan updates and relationship replacement, then deletion,
soft-delete/restore and cascades. Standalone variant/option creation, category
tree behavior and variant-image assignment need their own exact call-flow and
event inventory; they are not unlocked merely by adding the four commands here.
The original 1000-image ordering case remains a separate scale capability beyond
the current 256-row bound. Preserve its input size and assertions. None of these
follow-ups imply production activation, durable events, mutable Module Links,
general Product parity or general Payload parity.

[Record 31](./31-medusa-keyed-updates-and-remaining-product-tests.md) owns the
next preflight: shared keyed updates proved by four unchanged tag/type cases,
and the dependencies for the remaining Product test groups.
