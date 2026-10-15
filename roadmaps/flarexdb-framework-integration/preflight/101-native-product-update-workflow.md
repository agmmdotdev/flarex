# Native Product Update Workflow

## Status And Authority

Status: implemented bounded private profile; hosted activation, scale and general
framework support retain separate gates.

The connected milestone is the actual `updateProductsWorkflow` and its
`upsertVariantPricesWorkflow` child. Authority is Medusa 2.13.4 at fork
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f` in `third_party/medusa/SOURCE.json`.
The source island remains read-only. Existing standalone Variant updates retain
their separate profile. The owner's continuing authorization includes necessary
adapter, portable-fork and shared-owner corrections, validation, review and
scoped commits. Hosted activation and destructive durable-data changes retain
separate gates.

Relevant pinned source under `third_party/medusa/upstream/`:

- `packages/core/core-flows/src/product/workflows/update-products.ts`
- `packages/core/core-flows/src/product/workflows/upsert-variant-prices.ts`
- `packages/core/core-flows/src/product/steps/update-products.ts`
- `packages/core/core-flows/src/common/steps/{use-remote-query,dismiss-remote-links,remove-remote-links}.ts`
- `packages/modules/product/src/services/product-module-service.ts`
- `packages/modules/pricing/src/services/pricing-module.ts`
- `packages/core/modules-sdk/src/link.ts`
- `packages/core/utils/src/modules-sdk/medusa-service.ts`
- Product, Pricing and Link DML and canonical joiner configurations.

## Native Behavior

The parent queries previous Variant IDs only for Products whose input supplies
`variants`. Its update step strips workflow-owned prices and cross-module links,
captures native preimages, and delegates Product upsert or selector update.
Empty batches skip that step's own Product list/upsert, but the parent still
performs its declared Query and child steps. Preserve these resource resolutions
and empty calls.

Explicit false Inventory management on an existing Variant dismisses its native
Inventory Links. It does not delete Inventory endpoints, adjust stock or create
Inventory for new Variants. Sales Channel and Shipping Profile inputs replace
their selected native Link tuples. Omission preserves existing associations;
empty Sales Channels clears them; null Shipping Profile dismisses its link.
Native dismissal first lists Link definitions for compensation preimages.

The child computes removed Variant IDs from the previous set and calls actual
`Link.delete` with the Product Variant endpoint selector. Native Link traverses
both Variant Link families. Only the canonical Variant–PriceSet relationship has
`deleteCascade` into Pricing. Pricing soft-deletes the PriceSet, all its Prices
(including PriceList prices), and their PriceRules. Inventory items remain
independent. Link-family and recursive traversal retain native concurrency.
Native `Link.delete` returns cascade errors as data; the private host's existing
sticky resource failure and rollback contract remains authoritative when an
invoked operation fails. Do not replace the router or swallow failures.

Existing Variants are classified by previous IDs. Their supplied truthy prices,
including `[]`, go through native PriceSet update. An existing Variant without a
Pricing Link is skipped by this child, unlike standalone Variant updates. New
Variants receive newly created PriceSets even when prices are omitted, followed
by positional Variant–PriceSet Link pairing. Preserve the native positional
Product/Variant result assumptions and the child's void result. PriceRule
replacement retains the separately documented native create-before-delete
uniqueness behavior from record 100.

The parent emits native `product.updated` workflow events, runs `productsUpdated`
with `additional_data`, and returns the native Product result. Keep compensation
declarations and one outer settlement. Root failure rolls back the pending graph;
inverse writes do not substitute for rollback.

## Finite Profile And Owners

Admit zero to four batch Products, each with an existing Product ID, or a bounded
ID selector and update. Admit at most four total previous Variants and four total
incoming/result Variants across the selected Products. Removed and newly created
Variant identities may therefore form a union of eight. Reuse the Product graph
envelope: two images, one option with four values, four tags and four categories
per Product. Decode scalar edits from checked module metadata and retain native
metadata semantics at their actual service path.

Each PriceSet admits two base prices and two stored PriceList prices, with at
most one rule per price. Incoming base prices retain their existing bound of two.
Whole persisted lifecycle closure must be checked before lifecycle writes;
truncation is forbidden. Pricing create/update calls retain their four-set
limit. Each Product admits two old/new Sales Channels and one Shipping Profile;
each Variant admits two Inventory Links.

The named root selects 512 calls, 2 MiB and 256 events through the existing
trusted identity-bound host API. Complete replacement exceeds both the ordinary
1 MiB allowance and the earlier 128-event candidate. Both refusals remain
rollback witnesses; the completed graph must retain its exact native events.
Default atomic OCC remains. This selection changes no other workflow profile.

The complete replacement graph exceeds the ordinary logical participant's
128-row working set. This root explicitly selects the existing 256-row logical
resource profile for Product through the core's identity-bound
`logicalResources` admission. Pricing and both Link participants explicitly keep
their ordinary 128-row working sets while admitting the shared 2 MiB request. The workflow facade owns that selection; fixtures
do not supply a substitute production policy. Other participants and existing
workflow defaults retain their profiles. This is use of an existing core
resource contract, not a new persistence mechanism.

Trusted workflow identities use the atomic policy configuration contract of
64 KiB and depth 64. The host previously applied the native business-value depth
limit of 16 to the assembled parent/child definition. Configuration capture now
preserves native optional-member omission and the complete canonical preimage
under the existing core policy bounds. Business values retain their separate
depth, node and byte limits; SDK identity encoding and durable replay preimages
are unchanged for previously admitted configurations.

Product owns native update/upsert admission, bounded graph results and receipts
for multiple Product roots with owned descendants. Pricing owns its named
Product-update profile, exact scalar values, soft-delete API and lifecycle event
evidence. Reuse checked DML lifecycle traversal with Product's existing lifecycle
owner while preserving Product-specific policies. Link owns authentic family
preparations, native routing, JSON resource ABI and source-local receipts.

The deprecated remote-query step is a narrow portable fork seam: native Product
composers keep their entry-point/list calls while the step uses the existing
bounded Query graph resource and complete-set proof. Service queries, arbitrary
variables, pagination and throwing relation options remain unadmitted. Partial
native graph result boundaries use checked decoders. No raw database, settlement
or native service capability crosses the workflow resource boundary.

## Shared Atomic Operation Finding

The complete replacement graph reaches both native Variant Link families during
`Link.delete`. Native traversal starts Inventory-Link and Pricing-Link calls
concurrently against the same admitted participant. The ordinary atomic root
rejects the second call with `overlappingOperation` while the first borrowed
participant context remains active. Product creation does not cover this branch:
its homogeneous Link batches select one service group at a time.

The authorized correction belongs to shared atomic operation scheduling. An
explicit, identity-bound `operationScheduling: "queued"` selection admits FIFO
root operations. Each complete participant invocation, activity cursor, receipt
validation and observation occupies one queue position. Arguments are detached
and charged before waiting. The original lifetime deadline and budgets apply;
the first full failure Cause is sticky even when a native caller catches it.
Queued cancellation, escaped active work and closure fail closed. The owner
revokes and joins its worker before database exit. Nested internal commands
retain their borrowed context and do not reenter the root queue.

The Product facade selects this profile. Ordinary roots retain overlap refusal;
Application, Payload, default atomic isolation and low-level lifetime exclusion
remain unchanged. No adapter queue, concurrent store access, extra transaction,
callback retry or reordered native Link algorithm is introduced. Neutral core
and native consumer proofs must pass in both database lanes before completion.

## Mixed Publication Finding

The complete replacement passes native execution but exceeds one source's
128-row materialization packet. The existing publication owner admits multiple
packets only for entirely created or entirely deleted rows; a mixed Product
source is therefore refused before publication. Raising its working-set
allowance alone does not establish settlement support.

The authorized shared-owner correction requires an explicit, identity-bound
logical participant `logicalPublication: "mixed"` selection and keeps its
working set at or below 256 identities. Product and Pricing select this mode;
Pricing retains its 128-row working set because unique-transition costs can
require multiple packets even below the row ceiling. The planner derives prior
and final unique keys using the authoritative canonical unique-key owner and
keeps each connected key transfer in one packet, and refuses a component exceeding an existing packet
ceiling. Every packet is accepted before any materialization. Facts retain their
canonical source order. Reference-replacement restrictions, unselected ordinary
profiles and larger batch profiles retain their existing contracts. Neutral
database proofs must include transfers spanning canonical packet boundaries, oversized
components and complete rollback, alongside pure create/delete regressions.
This correction adds neither larger commit packets nor an adapter transaction.

## Completion Gates

Prove batch and selector forms; empty inputs/selectors; scalar and owned graph
replacement; missing IDs; omitted/empty prices; existing and new Variants;
missing Pricing links; old PriceList descendants; Inventory-Link independence;
Sales Channel/Shipping Profile omission, replacement and clearing; native hooks
and ordered events; maximum mixed graph and oversized closure refusal.

Exercise late failure after deletion/replacement, sticky caught refusal,
capability authenticity and confinement, cancellation, identity-bound replay,
uncertain settlement and competing PostgreSQL updates. PGlite and ordinary-role
PostgreSQL establish separate database lanes. Regress the extracted Product
lifecycle owner and the existing Product, Pricing and Link workflow profiles.
Run affected types/builds, source and browser portability guards, core/diff lint,
both required read-only reviews and exact staged lint before committing.

General Product deletion/restoration, arbitrary Pricing administration, full
Inventory management for new Variants, Cart/Order, durable event delivery, hosted
activation and scale remain separate milestones.
