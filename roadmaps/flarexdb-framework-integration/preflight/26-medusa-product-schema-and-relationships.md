# Product Schema And Physical Relationships

Status: private fresh-schema capability implemented.
The ten actual models compile to thirteen tables and an 85-step fresh plan.
Shared reconstruction is corrected under [record 27](./27-product-installation-reconstruction-cost.md).
Currency host and shared relational publication are implemented under
[record 25](./25-medusa-currency-host-and-publication.md). Product service
mutations remain unadmitted.

## Capability

The complete pinned Product model set compiles into a Medusa-owned relational
artifact and installs through the existing Flarex coordinator. Its physical
constraints are covered by the same PGlite and ordinary-role PostgreSQL
conformance body. Generic schema mechanisms carry the required features;
Product names, model interpretation and navigation stay in the adapter.

This is one capability from actual DML through database readiness, including
source promotion, normalization, closed value contracts, physical lowering,
catalog verification and failure recovery.

The nearest subsequent milestone is an unchanged Product service operation
with nested relationships and atomic row/event publication. Establishing the
complete schema first makes that operation's storage contract explicit. It
does not establish repository population, relation replacement, soft-delete
cascades, restore, category tree behavior or event delivery.

## Source Evidence And Corrections

All paths below refer to the admitted fork at
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, beneath
[`third_party/medusa/upstream`](../../../third_party/medusa/upstream).

- `packages/modules/product/src/static-manifest.ts` declares ten module models.
  Its nine-model Joiner list omits the explicit `ProductVariantProductImage`
  entity; that list must not be mistaken for the complete physical schema.
- `packages/modules/product/src/models/` declares Product, Variant, Option,
  OptionValue, Type, Tag, Collection, Category, Image and VariantProductImage.
  ProductImage explicitly uses table name `image`.
- Product tags, categories and variant options declare three implicit pivots:
  `product_tags`, `product_category_product`, `product_variant_option`.
  The promoted compiler produces exactly ten entity tables and these three
  pivots; the static manifest, model exports and compiler agree on the inventory.
- `packages/database/drizzle/src/schema.ts` and `schema.spec.ts` define physical
  FK and pivot normalization. An implicit pivot has non-null endpoint columns,
  endpoint indexes, an unconditional unique pair and cascading endpoint FKs.
  It has no primary key, surrogate ID or entity lifecycle columns. Explicit
  `pivotEntity` relationships skip this factory: VariantProductImage retains
  its own ID and entity lifecycle; do not invent pair uniqueness for it.
- The same compiler emits delete cascade where the inverse DML declaration
  requires it and otherwise omits the referential action. Preserve that
  distinction; PostgreSQL's default `NO ACTION` is not the existing core's
  explicit `RESTRICT` contract.
- Product has boolean defaults and a status enum; active-row unique indexes
  cover handles, variant identifiers and option/value combinations. Nullable
  unique values must retain PostgreSQL's ordinary null behavior. Category has
  a self-reference; its `mpath` and rank algorithms remain service/repository
  behavior, not a consequence of that FK.
- `packages/core/utils/src/dml/helpers/entity-builder/define-property.ts`
  maps the current mature DML `number` to PostgreSQL `integer`, boolean to
  `boolean`, and bigNumber to `numeric`. Product dimensions are text; Variant
  dimensions and ranks use `number`. The initial Product migration used
  numeric fields, but later migrations changed these to integer. Use current
  DML and its pinned mapping for the fresh baseline, not the initial archive
  or SQLite's permissive type behavior. Enum membership needs a closed typed
  check in Flarex; do not pass a source SQL expression through as authority.
- `packages/modules/product/integration-tests/__tests__/product-module-service/events.spec.ts`
  expects twelve events for its nested create fixture: one Product, two
  Options, five OptionValues, two Variants and two Images. Currency currently
  rejects all nonempty event handoffs. Product writes cannot use that gate
  unchanged or suppress events and claim compatibility.

Current Flarex definitions in
[`relationalSchema/model.ts`](../../../packages/persistence-postgres/src/relationalSchema/model.ts)
and its policy/lowering owners carry boolean values/defaults, typed text-set
checks, partial unique indexes and explicit FK actions. Keyless tables require
an unconditional non-null unique key. The opaque schema-only commerce profile
admits the complete structural plan without widening the single-table runtime
profile.

## Shared Contracts

1. Use generic boolean/default, text-membership-check, partial-unique-index and
   explicit referential-action representations. Retain closed predicate and
   constraint values; normalize the admitted `deleted_at IS NULL` form in the
   adapter and reject unsupported expressions.
2. Preserve physical keys accurately. Permit a table without a primary key only
   when its admitted shape has an unconditional, non-null unique key suitable
   for identifying every row. The implicit pivot's ordered endpoint pair meets
   that requirement. Do not silently turn it into a primary key or add an ID.
   A future mutation profile must explicitly authenticate its chosen row key;
   current single-primary-key commerce admission remains unchanged here.
3. Represent physical joins through tables and owning FKs. Keep inverse names,
   many-to-many navigation, translatable markers, Joiner aliases and business
   cascade intent in immutable Medusa-owned normalized metadata. Their retention
   does not grant runtime support for translation or relationship queries.
4. Lower all FK endpoints through the same scope-qualified installation map,
   including self-references. Install tables before cyclic/self FK constraints
   as needed, with deterministic names and exact structural verification.
5. Carry every newly admitted semantic distinction through canonical capture,
   digesting, artifact rehydration, physical planning, execution and catalog
   readiness. Existing Currency/Payload artifact bytes and digests must remain
   valid; do not rewrite stored artifacts or bump a global version as incidental
   cleanup. New features must be present in their canonical evidence and reject
   unsupported execution profiles.
6. Use shared installation/readiness metadata. Product's empty fresh catalog
   does not require Currency's initialization dataset or a Product-specific
   metadata table/count. Structural readiness here does not produce a Product
   service binding or authenticate new transaction capabilities.

Native commerce FKs deliberately follow the accepted
[commerce storage design](../../../design-notes/flarexdb-medusa-commerce-adapter.md),
not Application document-edge storage. The checked-in Convex
`crates/database/src/transaction.rs` (relative to the outer repository),
especially `FinalTransaction::new`, remains reference evidence for outer
transaction finalization after nested work. This capability changes no
Application OCC, transaction ownership, publication ordering or commit owner.

## Owners And Reuse

| Path or concern | Classification and action |
| --- | --- |
| Pinned Product model definitions | Keep semantics; promote the exact model dependency closure with provenance and unchanged source assertions |
| Mature DML and pure Drizzle schema helpers | Port only the connected normalization needed by actual models; preserve compiler relationship tests; no eager ORM/Node migration graph |
| Medusa adapter normalization | Extend under `packages/medusa-adapter`; interpret the pinned Product compiler through closed schema values while retaining Currency-specific admission and dataset policy |
| Core schema, physical plan and catalog readiness | Extend generic closed contracts in `packages/persistence-postgres`; no Product-named core contracts or metadata |
| Coordinator, installation identity and scope isolation | Keep authority and recovery; exercise existing owners with the complete Product artifact |
| Historical migrations | Keep as compatibility evidence; no replay or legacy database import in this fresh-only capability |
| Product service, repositories, events and live commerce host | Keep unchanged and unadmitted for Product execution in this capability |

The promoted framework exposes only the two portable utilities required by
Product models. The exact source/build/type closure is manifested; loading DML
does not promote Product services or a broad framework runtime.
No runtime dependency may point into the inert source island. No temporary
storage or publication bridge is proposed.

## Correctness Gates

- Reproduce the exact complete model and derived-pivot inventory from actual
  promoted DML, independently compare it with the pinned compiler, and retain
  source hashes and a Worker-safe model bundle graph. Assert the explicit
  pivot's distinct identity/lifecycle and `image` name.
- Prove deterministic normalization despite input ordering; reject missing
  endpoints, unsupported expressions, nullable/nonunique proposed row keys,
  malformed values and unsupported runtime profiles before activation.
- Freshly install Product in isolated scopes through the shared coordinator.
  Verify catalog types, defaults, enum checks, index uniqueness/predicates,
  FK targets/actions, implicit keys and explicit entity keys. Exercise cold
  rehydration, interrupted installation/retry and tampered readiness evidence.
- Use one shared conformance body for PGlite and ordinary-role PostgreSQL:
  active duplicate rejection, null uniqueness, reuse after soft delete,
  invalid enum/FK rejection, cross-scope rejection, self-FKs, physical hard-delete
  cascades and unique pivot pairs. Fixture DML is test-only physical proof,
  not a Product repository or service mutation path. Native PostgreSQL supplies
  the concurrent duplicate/constraint proof.
- Reuse the existing database test core and installed baselines. Run pure
  compiler tests first; avoid a database/process per assertion. Run focused
  Currency, Payload and artifact/coordinator preservation lanes once after
  integration; rerun only affected failures or changed owners.
- Complete package typechecks, source/promotion guards, required lint and both
  repository diff reviewers. Reconcile this record and the master matrix with
  exact evidence, then commit the capability together.

The shared conformance harness exercises both database drivers with one isolated
installation per file. Installation runs in a cancellable setup hook so dependent
assertions cannot run against an incomplete schema. Existing coordinator recovery
and corruption tests cover receipt/head restoration and refusal before readiness.
Existing-row Currency-to-Product upgrades, live Product serving, Module Links,
Query, workflows and production activation remain outside this fresh-schema proof.

## Next Service Boundary

After the schema proof, [record 28](./28-medusa-product-create-and-event-delivery.md)
proposes nested creation, bounded population and complete entity/pivot row facts
through transaction-bound repositories. Its selected unchanged service messages
are captured in a local-only in-memory adapter and released after confirmed
commit. Prove row rollback and lost-commit recovery while explicitly preserving
the local notification crash-loss limitation.

Durable event storage and dispatch are deferred to a separate reviewed contract;
the local proof does not implement that guarantee. Replacement and lifecycle/
cascade publication follow as another coherent capability. SQL cascade success
alone cannot prove that every deleted child has a published change fact.

Runtime admission must remain explicit and reuse shared relational publication
and readiness receipts. There will be no per-module core change tables, commit
counters or seed rules. Query-sync production wiring and legacy dispatch are
not prerequisites or integration shortcuts for this local service proof.
