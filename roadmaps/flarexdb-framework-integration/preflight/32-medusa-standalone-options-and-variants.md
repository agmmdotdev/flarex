# Product Mutation Coverage Milestone

## Status And Delivery Size

Both approved checkpoints are implemented privately. The complete **50 original
cases pass on PGlite and ordinary-role PostgreSQL**, with six blocked cases and
one upstream performance skip remaining. The complete original test files remain
unchanged; the exact coverage reporter requires every selected full identity to
execute once. The separately approved [shared write-kernel correction](./33-commerce-write-kernel-efficiency.md)
keeps graph replacement and mixed variant upsert within the existing budgets.

Adapter-local reads avoid a redundant relation count: `CommerceStore.find` already
bounds the entire scoped catalog before its SELECT, so taking the full admitted
catalog bound proves completeness in one read. The existing owned scope lock
preserves admitted-writer isolation. Overflow still fails in core before a
partial page can be consumed. Mutation planning also reuses table handles within
its operation; every actual read/write retains its manager/lifetime checks.
No shared limit or deadline has been raised.

This milestone adds **35 original cases** to the fifteen-case
[record 31 baseline](./31-medusa-keyed-updates-and-remaining-product-tests.md)
in one approved body of work, with two internal checkpoints. The outcome is a
usable Product mutation profile covering related entities, Product graph
replacement and image associations, covering **50 of the 56 non-skipped
originals** in the two registered files. Checkpoints organize implementation and
review; they are not separate user-approval requests for each method or test.

| Delivery group | Additional originals | Cumulative target | Main capability |
| --- | ---: | ---: | --- |
| Previous baseline | 15 | 15 | Creation, selected reads, tag/type updates |
| Completed related entities checkpoint | 11 | 26 | Options, variants, values, collections and root categories |
| Completed Product graph checkpoint | 24 | 50 | Product updates, relationship replacement, images and variant images |
| Following lifecycle slice | 5 | 55 | Physical delete, soft delete, restore and lifecycle visibility |
| Following scale slice | 1 | 56 | Complete and stable 1000-image creation/read flow |

The separately upstream-skipped performance test stays skipped. These counts
refer only to `events.spec.ts` and `products.spec.ts`; other Product module
suites are not counted as covered.

The [exact coverage plan](./product-upstream-coverage-plan.json) maps all 57
registered full test identities to one group each. It is planning-only. The
[admission inventory](./product-upstream-test-cases.json) and executable reporter
remain the authority for tests that actually run. Do not mark planned cases
admitted before their unchanged assertions pass on both drivers.

## Checkpoint One: Related Entities, Eleven Originals

| Original event group | New cases | Required behavior |
| --- | ---: | --- |
| Product Variant Operations | 2 | Standalone create and existing variant update |
| Product Option Operations | 3 | Create, update and mixed create/update upsert |
| Product Option Value Operations | 1 | Existing value update through its manual event-flush path |
| Product Collection Operations | 2 | Update and mixed create/update upsert |
| Product Category Operations | 3 | Root create, update and mixed create/update upsert |

The exact case names are the `related-entities` entries in the coverage plan.
All eleven must complete; the former two-case create proof is an internal
starting point, not the next milestone's stopping point.

Reuse complete table-bound option/variant reads, existing value references,
DML-derived IDs and prefixes, checked relation descriptors and the shared
insert/update kernels. Category roots must have real materialized paths and
sibling ranks. The selected originals create roots and change names; arbitrary
parent changes, reparenting and subtree reordering are not implied. Refuse those
unimplemented inputs explicitly, while preserving root behavior and proving it
with adapter conformance tests.

## Checkpoint Two: Product Graph, Twenty-Four Originals

| Original block | New cases | Required behavior |
| --- | ---: | --- |
| `products > update` | 20 | Scalar/batch updates, nested creates, identity preservation, replacement/removal and all original validation failures |
| `Events > Product Update` | 1 | Exact created/updated/deleted entity events for one graph replacement |
| `products > images` rank/empty-array cases | 2 | Reorder retained images and remove omitted owned images |
| `products > images` variant population | 1 | Persist explicit variant/image assignments and preserve general-image inheritance |

The exact case names are the `product-graph` entries in the coverage plan.
This includes the full update block, not just happy-path or validation-only
cases. Its unchanged beforeEach creates categories, types, tags, collections
and two Products, including a category association. Those are mandatory
prerequisites even for the missing-ID and scalar-update assertions.

Expose the required original service entry points through checked commands:
related creates/updates/upserts from checkpoint one, `updateProducts` in its
actual ID/selector or array overloads used by the tests, and `addImageToVariant`.
Extend existing retrieve/list/count projections, including the supported
meaning of `relations: ["*"]`. Expand that request through the checked Product
relation catalog; it must not expose unadmitted relations or bypass validation.
Do not enable every proxy property or framework method to obtain coverage.

## Source-Backed Execution Decisions

The source authority remains fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f` and the exact promoted packages.

- The unchanged [variant service](../../../packages/medusa-product/src/services/product-module-service.ts#L439)
  reads options with values and existing variants with options before assigning
  value IDs. Even a title-only update enters `updateVariants_` and
  `upsertWithReplace({ relations: ["options"] })`; a simple DAL `update` method
  does not cover that path. Normalized unchanged `product_id` is a checked
  reference, not permission for a caller to move a variant to another Product.
- The unchanged [option service](../../../packages/medusa-product/src/services/product-module-service.ts#L1063)
  matches supplied values to existing IDs, then calls replacement for `values`.
  Omitted relation data preserves the relation; an explicit empty array clears
  it. Reuse that normalization and preserve unchanged child identities.
- [Collection updates](../../../packages/medusa-product/src/services/product-module-service.ts#L1306)
  first update the collection, then use `$in`/`$nin` selectors to associate or
  dissociate Products when assignments are supplied. The original event cases
  need scalar updates; Product graph work adds its specific reference changes.
  Do not accidentally admit unrestricted collection assignment selectors.
- [Category methods](../../../packages/medusa-product/src/services/product-module-service.ts#L1385)
  call explicit event builders. The pinned category repository owns root rank
  and materialized-path semantics. DML alone does not fill required `mpath`.
  Preserve these bounded semantics in the adapter and ensure category events
  are dispatched once, including upsert; core stays unaware of category trees.
- [Product updates](../../../packages/medusa-product/src/services/product-module-service.ts#L1798)
  already have a portable `upsertWithReplace` branch. Current composition
  advertises `deepUpdate: refuse`, which selects the wrong branch for this
  capability. Omit that unsupported property deliberately and use the pinned
  portable branch and its `prepareProductsForDrizzleUpsertWithReplace_`.
  Do not emulate a MikroORM manager or maintain two Product update engines.
- The fork's [Drizzle replacement implementation](../../../third_party/medusa/upstream/packages/database/drizzle/src/medusa.ts#L813)
  is the behavioral reference for owned to-one, has-many, nested values, pivot
  differences and performed actions. Reuse its existing portable helpers;
  extract bounded pure planning helpers with source provenance where SQL is
  intertwined. Its SQLite database/manager must not enter Flarex's transaction.
  `replaceHasManyRelation` skips unchanged child writes; preserve that rule
  instead of manufacturing update facts for every populated child.
- [Internal replacement dispatch](../../../packages/medusa-utils/src/modules-sdk/medusa-internal-service.ts#L641)
  consumes performed actions after repository work. Select one dispatch owner
  using the existing pinned helpers; do not emit both repository and internal
  service events for the same mutation.
- [Option-value update](../../../packages/medusa-product/src/services/product-module-service.ts#L1927)
  manually flushes its message aggregator. Preserve that Promise/lifetime path
  through the current transaction-owned local buffer.
- [Variant image assignment](../../../packages/medusa-product/src/services/product-module-service.ts#L2511)
  uses the already-installed explicit VariantProductImage model and has no
  `EmitEvents` decorator. Its service later combines general images with
  assignments. Admit authentic assignment facts with an explicit adapter-owned
  no-domain-message rule for this operation; do not invent a created event or
  treat this entity as an implicit pivot. Preserve the pinned same-Product
  validation limitation as an explicit compatibility decision, while enforcing
  Flarex scope/installation authority in all cases.

## Implemented Shared-Core Contract

This approved extension beyond record 31 admits selected reference updates and
physical removal. Record 33 separately owns insert/update kernel efficiency.

1. **Selected reference-column updates.** Extend trusted local table admission
   with an explicit list of logical foreign-key column IDs that may change.
   Validate each against the captured layout and selected target key. Reuse
   scoped update SQL and compiled FK constraints; verify referenced identities
   in the same scoped transaction. Omitted permission keeps today's FK-update
   refusal. Ordinary keys and scope columns remain immutable, and managed
   timestamps/soft-delete columns remain inaccessible as arbitrary data.
2. **Declared-key physical removal.** Admit removal independently for selected
   primary-key entity tables and declared unique-pair pivots. Capture exact
   ordered key objects with the existing key codecs; never accept a raw where
   fragment. Reuse statement execution, budgets, row receipts and publication.
   Every removed row gets a delete fact. A parent deletion must not allow
   invisible FK cascades: the adapter plans children/pivots before parents,
   and the shared kernel rejects deletion while matching cascade dependents
   remain. Core derives that check from the captured FK layout, including
   dependencies outside the caller's selected table capability.
3. **Authenticated compatibility envelope.** Trusted declarations add
   `referenceColumns` and `remove: "declaredKey"` beside the existing optional
   update capability. A declaration using either new permission gets canonical
   contract version 4; preserve the exact existing versions 1, 2 and 3
   for unchanged declarations. The permissions and ordered column list enter
   the contract hash, bindings and request fingerprints. No old request or
   binding may silently acquire reference/deletion authority.
4. **Existing commit machinery.** Keep one transaction and complete relational
   facts/result/wake publication. No Medusa-specific core tables, generic SQL
   upsert, second transaction journal or business-event outbox is proposed.
   Preserve the current limits for this 35-case milestone. If measured original
   commands exceed them, report the exact shape/cost and decide the bounded
   correction before enlarging the envelope; do not trim original inputs.

The adapter owns relation replacement and semantic validation. The shared core
owns key capture, scope, admitted columns/operations, SQL and complete facts.
A newly exposed defect outside these named changes still follows `AGENTS.md`'s
shared-owner diagnostic/preflight rule. Routine implementation choices inside
this milestone do not need another per-method approval.

## Mutation And Event Accounting

Use one operation plan per command to preserve input order where semantic and
batch compatible independent writes. Validate identities, child ownership,
references and replacement differences before applying the plan where possible;
late SQL or publication errors must still roll back all earlier changes.

For each affected entity, distinguish created, changed, retained and removed
rows. Retained children and referenced values generate no fabricated writes.
Implicit pivot insert/delete facts need no domain message; entities with actual
created/updated/deleted messages must match their captured row operation and key.
The explicit variant-image assignment exception is checked by model and command,
not a general missing-event escape hatch.

Record 31's repeated-same-operation refusal remains the default. Normalize a
replacement graph into one final write per row when that preserves the pinned
semantics; do not silently deduplicate authenticated row facts afterward. If
source behavior requires repeated writes, settle the precise coalescing/event
contract within this milestone before enabling that input. Created+updated and
update+delete must not be equated merely because their IDs match.

Replacement can physically remove owned rows in this milestone. Public
`deleteProducts`, soft-delete and restore entry points remain in the lifecycle
slice; their semantics and event mapping differ from graph replacement.

## Validation And Test Cost

Use one installed fixture per database driver per test process, as the current
runner does. Build the two checkpoints with cheap decoder/planner tests and
focused failure cases; do not restart PostgreSQL/PGlite for every method.
Run database conformance at meaningful capability checkpoints and the full
50-original acceptance target at the final milestone boundary. Avoid concurrent
heavy compiler/database setup work when measuring the native statement budgets.

Acceptance includes:

- all 35 new originals plus the existing 15, unchanged, on PGlite and an ordinary
  PostgreSQL role; exact full-name coverage enforcement and inventory updates;
- complete lookup beyond 15 rows, counts before paging, parent/child identity
  preservation, empty-versus-omitted relations, rank ordering and wildcard reads;
- wrong scope/installation, missing/foreign child IDs, cross-parent ownership,
  missing references, duplicate variant combinations and duplicate keys;
- exact entity and pivot facts for insert/update/remove, no hidden FK cascades,
  event counts/operations, retained rows without fabricated mutations;
- late failure after mixed writes, publication failure, cancellation, borrowed
  transaction ownership, replay, uncertain settlement and local-buffer disposal;
- changed shared-kernel and Currency preservation proofs on both drivers;
  strict package/compatibility checks, source/hash/browser guards, scoped lint
  and both required reviewers at significant commit checkpoints.

Keep deterministic pure contract cases out of repeated database fixtures. Do
not reuse mutable business rows between original tests, skip negative proofs,
weaken deadlines or turn off coverage enforcement to reduce elapsed time.

## Following Larger Slices

**[Lifecycle: five originals, target 55](./34-medusa-product-lifecycle.md).** The coverage plan identifies the
Product cascade-delete event, five base-service physical deletions in one case,
soft-delete cascade behavior, explicit deleted-row reads and restore cascade
behavior. Reuse declared-key removal from this milestone. Add a separately
admitted managed lifecycle operation for soft-delete/restore; ordinary updates
must not write `deleted_at`. Resolve complete DML cascade closures, pivot
behavior, timestamp transitions, visibility, uniqueness conflicts on restore
and category sibling effects. An update row fact alone cannot authenticate
`deleted` versus `restored`: capture/verify the lifecycle transition before
expanding the local event policy. This needs its own concrete contract and
acceptance gate, not just enabling five methods.

**Scale: one original, target 56.** Preserve the original 1000-image input and
its repeated ordered-read assertions. Preflight command-wide row/fact/byte
limits, bounded batching under one transaction, complete paged hydration,
stable rank ordering, cancellation and late-chunk rollback. Raise only the
necessary authenticated bounds after measurements. Sharing PGlite setup does
not remove these semantic limits. Keep the separately upstream-skipped
performance case unchanged.

No milestone here activates a durable event provider, query sync, mutable
Module Links, public/production serving, general Payload compatibility or all
other Product module test suites.
