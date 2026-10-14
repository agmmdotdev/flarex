# Native Product Creation Workflow Preflight

## Status And Admitted Outcome

Status: approved and implemented bounded private admission. The user approved
the complete root and separately approved its 128-event allowance after the
maximum graph exceeded 64 events. The admitted outcome executes the pinned native
`createProductsWorkflow`, including its complete variant child, through one
existing trusted settlement owner. Performance optimization remains paused.

This admits a bounded complete business graph, not arbitrary Medusa DTOs,
administrative APIs, hosted activation or the rest of Fulfillment/Inventory.
The [accepted design](../../../design-notes/flarex-db-accepted-design.md),
[package boundaries](../../16-package-boundaries.md),
[Medusa adoption](../06-medusa-adoption.md), and
[workflow foundations](../../workflow-foundations/README.md) retain authority.

The source is the fork pinned in
[SOURCE.json](../../../third_party/medusa/SOURCE.json):
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, baseline `2.13.4`.
The native parent is
[`create-products.ts`](../../../third_party/medusa/upstream/packages/core/core-flows/src/product/workflows/create-products.ts).
Its parent and workflow DTO closure are promoted/exported by the executing
core-flows, framework and types packages through the existing provenance guards.

## Native Execution Trace

| Stage | Native behavior and dependency |
| --- | --- |
| Prepare and validate | Strip transient Sales Channel, ShippingProfile and variant input from the Product-module call. Reject Products without a nonempty options array using the native error. |
| Create Products | Call Product `createProducts`, creating options/values and other selected module-owned rows. Preserve native defaults, result shape and input order. |
| Associate Sales Channels | Derive links by matching each created Product to its input ordinal. The association step returns early for an empty link array; it does not create Sales Channels. |
| Associate ShippingProfiles | Derive one optional supplied profile link per Product and call `createRemoteLinkStep`. That step resolves `link` even for an empty array, then skips the write. The root does not create ShippingProfiles. |
| Create variants | Flatten variants in Product/input order, assign their parent identity and invoke the actual `createProductVariantsWorkflow` child. It owns Inventory validation/defaults, Inventory links, Pricing and PriceSet links. |
| Assemble result | Group returned variants by `product_id` and attach them to the native created Product DTOs. This is not a cross-module graph hydration query. |
| Emit and hook | Emit ordered `product.created` IDs after the variant child's `product-variant.created` events; call `productsCreated` with the native result and root `additional_data`. |

Important source details:

- The validation step's comment mentions a shipping-profile check, but its body
  checks only options. An omitted shipping profile skips that association.
- A Product with no variants still reaches the native child with an empty
  array. Empty Product variant, Inventory item/level, Inventory/Stock Location
  query and Pricing calls must remain real calls. Empty variant event input
  produces no variant messages.
- The parent passes only `product_variants` into the child. It does not forward
  root `additional_data` or register a child hook handler. Preserve that behavior;
  the proposed root facade exposes `productsCreated` only.
- The native flattening spreads the input variant after assigning `product_id`.
  The finite root profile should refuse a nested `product_id` override rather
  than silently attach a variant to another Product or rewrite the native body.
- Stored native Links do not automatically prove endpoint existence: current
  Link metadata has no foreign keys and routing validates cardinality. Use
  pre-created scoped endpoints for positive witnesses and characterize unknown
  IDs against the pin before claiming any stronger rejection behavior.

## Executable Owners And Construction

Product creation/options and Sales Channel/ShippingProfile associations already
have shared-logical witnesses. The
[Inventory admission](./95-product-variant-inventory-workflow.md) executes the
actual variant child with Inventory, Stock Location reads and Pricing. No new
commerce module, provider or database engine is required by this root.

The connected construction responsibilities are:

1. Promote the native parent, its actual workflow DTO closure and selected
   Product event export through the existing provenance/portability guards.
   Translate portable imports, strict optional/indexed typing and the transformed
   child options envelope, as in the admitted Inventory child. Keep the native
   business algorithm and validation order.
2. Compose four native Link families behind one `link` resource. Today
   `prepareLocalProductLinks` covers Product–SalesChannel and
   Product–ShippingProfile; `prepareLocalVariantLinks` covers
   Variant–InventoryItem and Variant–PriceSet. A workflow selection currently
   binds one module/resource to one participant and one logical storage source.
   Registering both under the same resource name cannot represent this root.
3. Add finite root input/output/hook admission. The standalone variant facade's
   one-Product and minimum-one-variant checks are facade limits; the underlying
   native child/method contracts already accept a flattened array of zero to
   four variants. Reuse that child without opening another host or imposing the
   standalone facade's unrelated constraint. Admit already-supported Product
   scalar fields through their current metadata/value owner: the workflow method's
   smaller argument schema must not arbitrarily reduce them to ID/title or become
   a permissive parallel JSON contract. The facade derives admitted scalar names
   from compiled Product metadata; the existing Product value/DAL owner validates
   native normalized values and refuses managed fields.
4. Correlate both external workflow event families against authentic Product
   and variant command results. Reuse the ordered Product event owner and retain
   each participant's internal module/Link receipt policy. Module-only event
   validation cannot admit this parent.

## Implemented Construction

Keep the two existing Link schema sources, lineage/table identities and their
independent command/receipt owners. At the existing adapter workflow resource
binding owner, admit a finite composed `link` resource backed by authenticated
source participants. Its actual native Link router must retain cardinality,
grouping and service behavior; loaded service operations delegate through the
authentic command belonging to their source. Commands borrow the same outer
root; no command gains another source's raw DAL/context.

This uses a deliberate adapter contract change in the existing workflow
module/resource/host/binding owners, rather than a manual family switch in the
Product workflow, nested Link routers or a second transaction. Prove the
multi-source resource binding with a neutral two-source example as well as the
four native Link families. Exact routing/service ABI and receipt correlation
must be fixed before promoting the parent into the executing profile.

Do not merge the four Links into a new schema lineage merely to fit today's
resource API. That changes table identities and raises a populated-data cutover
obligation. No populated-data migration, ownership transfer or deletion is
proposed here. Existing source compilers/storage definitions remain authoritative.

Product, Pricing, Inventory and Stock Location retain their selected profiles.
Sales Channel and ShippingProfile endpoints are prepared before this root;
their scalar graph reads may be selected for the trusted hook/proof, without
granting endpoint creation or full Fulfillment/provider methods. Enforce the
configured Product/ShippingProfile Link dependency at the schema-composition
owner, matching the existing Sales Channel dependency check.

The existing atomic host owns request identity, rollback-only refusal, fencing,
publication, cancellation and uncertain settlement. The portable workflow SDK
owns child frames and transaction-covered compensation. No shared persistence
correction was identified by the static preflight. Native `createProductVariants([])` exposed
an adapter receipt mismatch: native creation succeeds, but the Product receipt
required an inserted Variant. Its Product owner now admits authentic empty
input/results with zero mutations, lifecycle changes, events, set-null or
reference-replacement effects. Required native reads and their scanned-row
observations remain intact; forged emptiness and hidden writes are refused. The
SDK type-owner correction for native Date and callable DTO leaves is recorded in
the workflow composition owner.

Regression execution also exposed a pre-existing shared reference-index gate
that rejected current binding maintenance before its coverage proof. The
separately approved correction and expected/actual witness belong to the
[Collection reference owner](../../shared-logical-storage/30-product-collection-reference-cutover.md).
The shared owner now validates binding maintenance through its existing exact
scope/head/table/physical-definition coverage proof and still refuses
Application maintenance. No Product-specific core branch, adapter workaround
or second writer is added. An executing shared-owner failure
requires its own witness/disposition before dependent work continues.

## Finite Input And Resource Contract

- One to four new Products; zero to four variants across the entire batch.
  This is a batch-wide bound, not four variants per Product.
- Each Product has one option with one to four values. Support the existing
  metadata-validated Product scalar creation fields and native defaults, including
  ID/title, handle/status, descriptions, flags and metadata. Optional existing
  Collection/Type references, up to four existing Tag/Category references each,
  and up to two images reuse admitted module-local behavior. New inline relation
  creation or other unsupported DTO representations remain refused.
- Optional zero to two Sales Channel references and one ShippingProfile ID per
  Product. No implicit endpoint provisioning.
- Variants retain the admitted native fields, options, managed/unmanaged and
  supplied/default Inventory behavior: at most two Inventory references, two
  base prices and one string-valued rule per price. Nested parent-ID overrides
  and nonempty levels/reservations remain unsupported.
- Root `additional_data` remains JSON, captured once at the existing boundary.
  Validate the full native result before any public projection; preserve Product
  order, empty variant arrays and returned variant prices/defaults.

The complete default-Inventory maximum graph, including four pending Link-family
hook reads, consumes 282 bounded calls. Its named `productCreationResources`
selects 512 calls and the separately approved 128 events through the existing
trusted identity-bound APIs. Smaller 256-call and 64-event allowances retain
whole-root rollback witnesses. Existing profiles and all other byte/row/fact/time
limits remain intact. This is capacity admission, not performance tuning.

The existing shared publisher uses three bounded acceptance/materialization
packet pairs for this 116-row graph, under one settlement, commit and durable
result. One commit does not imply a single SQL packet.

Duplicate delivery retains the existing bounded PostgreSQL lock deadline. A
contending call can receive SQL `55P03`; replaying the same request key after the
successful owner settles returns its durable result without repeating the hook.
No workflow retry wrapper or relaxed deadline is introduced.

## Implementation Sequence And Completion Gates

1. Settle and implement the finite multi-source Link resource seam, preserving
   old source identities and validating each operation/event against its actual
   participant. Migrate overlapping router assembly to the common native owner;
   avoid duplicate enforcement or a general runtime registry.
2. Promote the actual native Product parent and prepare one complete root facade
   with the contracts above, actual child calls, root hook and both event families.
   No synthetic Product recreation or workflow algorithm copy belongs in the
   adapter. Keep endpoint setup outside this root.
3. Prove the complete maximum graph and resource envelope. Exercise multiple
   Products with distinct options; zero variants; mixed managed/unmanaged and
   supplied/default Inventory; omitted/empty associations; exact missing-option,
   duplicate/missing Inventory and duplicate-SKU errors; all four Link routes;
   pending scalar/Link reads; full native result and event order.
4. Prove one publication with exact facts/events, late hook failure, caught
   unsupported operations, cancellation/revocation, replay and concurrent
   duplicate delivery, uncertain commit and two-shop matching business IDs on
   PGlite and focused ordinary-role PostgreSQL. Regress existing Product, Pricing,
   Inventory, ShippingProfile, Link and child-composition consumers.
5. Preserve native witnesses proportionally. The pinned query-graph integration
   suite creates Products through this parent, but its broader Translation/full
   graph/bootstrap fixture is not admitted by this slice. Reuse its native
   Product input/result behavior as labeled characterization; do not claim the
   original whole test is promoted unchanged. Existing unchanged module tests
   and their AST guards remain intact.
6. Run affected builds/typechecks, source/test-port/browser guards, required lint
   and both project reviewers. Update capability truth and create one scoped
   implementation commit only after the connected gates pass.

## Cutover And Retained Consumers

The direct Product creation facade admits module-only input, including Products
without options and inline variants. Its existing consumers retain a distinct
contract from the native root. Direct Product-module
creation remains a valid distinct operation and must not acquire native workflow
option requirements accidentally. The standalone variant facade also remains a
distinct existing-Product operation.

The Pricing-only launch graph has named consumers in
`packages/executor/test/performance/support/mixedMutationProductFixture.ts`,
`packages/medusa-adapter/test/support/product-launch-performance-fixture.ts` and
its regression tests. It creates a variant on an existing Product and updates a
Tag; it is not equivalent to creating new Products. Preserve those consumers
and their frozen measurements while performance work is paused. Its retirement
requires explicit migration of that existing-Product/Tag behavior and provenance,
not merely shipping this new root. Remove obsolete assembly only when its actual
consumers have migrated; do not rewrite performance baselines in this slice.
