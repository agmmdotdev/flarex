# Medusa Adapter

This private package binds the admitted native Medusa services and workflows to
existing Flarex storage and execution owners. The
[adoption roadmap](../../roadmaps/flarexdb-framework-integration/06-medusa-adoption.md)
owns capability status; the [organization plan](../../roadmaps/medusa-design-quality/02-organization-and-reuse.md)
owns the source and reuse boundaries. A shared helper does not admit another
native operation or module.

## Entry Points And Reading Order

| Operation | Start here | Continue through |
| --- | --- | --- |
| Product native module calls | [modules/product/service.ts](src/modules/product/service.ts) | [command profiles](src/modules/product/commands/services.ts), [native binding](src/modules/product/module.ts), [repository](src/modules/product/repository.ts) |
| Currency native reads | [modules/currency/service.ts](src/modules/currency/service.ts) | [repository](src/modules/currency/repository.ts), [query profile](src/modules/currency/read-profile.ts) |
| Ordinary scalar module | [modules/sales-channel/service.ts](src/modules/sales-channel/service.ts) | [named repository extension](src/modules/sales-channel/repository.ts), [shared scalar repository](src/repository/scalar.ts) |
| ShippingProfile capability | [modules/fulfillment/shipping-profile-service.ts](src/modules/fulfillment/shipping-profile-service.ts) | [selected repository](src/modules/fulfillment/shipping-profile-repository.ts); other Fulfillment operations remain refused |
| Pricing and Inventory | [modules/pricing/service.ts](src/modules/pricing/service.ts), [modules/inventory/service.ts](src/modules/inventory/service.ts) | Their checked schema, input and event owners; exact-number and empty-level rules remain explicit |
| Complete native Product creation | [workflows/product/creation.ts](src/workflows/product/creation.ts) | Native parent and child workflows, [composed Link resource](src/links/product-resource.ts), [workflow host](src/workflow/host.ts) |
| Existing-Product launch and relationships | [workflows/product/launch.ts](src/workflows/product/launch.ts), [workflows/product/relationships.ts](src/workflows/product/relationships.ts) | Selected native child calls and the same host; launch has distinct borrowed and direct outer entry points |
| Native stored Links | [links/product-service.ts](src/links/product-service.ts), [links/variant-service.ts](src/links/variant-service.ts) | [native service/router binding](src/links/service.ts), [repository](src/links/repository.ts), [call receipts](src/links/events.ts) |
| Trusted schema composition | [composition/schema.ts](src/composition/schema.ts) | Checked module/link definitions and the existing analysis/installation owners |

The module-only [Product create facade](src/workflows/product/create.ts) remains
distinct from the complete native parent: their input grammar, option/variant
behavior and consumers differ. Launch, relationship and standalone variant
facades also retain their named existing-Product obligations.

## Shared Owners

- [module/definition.ts](src/module/definition.ts) prepares immutable model,
  native service and extension definitions. [module/persistence.ts](src/module/persistence.ts)
  binds their repositories and generated native internal services.
- [module/commands.ts](src/module/commands.ts) owns ordinary decode/copy/refusal
  preparation and direct native command invocation. The native decoder and
  operation name stay at the module. Full results are captured before projection.
- [module/service-bridge.ts](src/module/service-bridge.ts) and
  [module/promise-owner.ts](src/module/promise-owner.ts) own the foreign Promise
  edge, pending continuations and cleanup for one command.
- [module/events.ts](src/module/events.ts) shares strict bounded event decoding
  and internal bus plumbing. Module policies still select event grammar, native
  naming, row correlation and the exact refusal context. The `check` callback
  preserves invocation-time snapshots and deferred current-context checks.
- [repository/context.ts](src/repository/context.ts) authenticates opaque native
  manager tokens and borrows nested contexts. [repository/denied.ts](src/repository/denied.ts)
  enumerates refused DAL methods while retaining bound manager/transaction methods.
- Scalar and Product DAL reads give native services detached mutable entities
  after complete projection validation. Core evidence stays immutable, and
  serialization captures the final native result.
- [schema/](src/schema), [query/](src/query) and [write/](src/write) own checked
  lowering, catalog/predicate/projection/read mechanics and keyed/graph writes.
  Module profiles retain admitted grammar, relations and lifecycle policy.
- [local-graph/module.ts](src/local-graph/module.ts) binds scalar graph reads
  from checked single-key metadata. Alias selection stays native/module-owned;
  Pricing relations and Link tuple ordering have explicit graph definitions.
- [workflow/host.ts](src/workflow/host.ts), [resources.ts](src/workflow/resources.ts)
  and [binding.ts](src/workflow/binding.ts) derive authenticated participants and
  finite resource bindings. Named workflow facades provide business composition,
  input/output contracts, events and limits rather than another policy registry.

## Product Receipts

[events/call-receipts.ts](src/modules/product/events/call-receipts.ts) validates
the call-local envelope and dispatches selected commands to their policy owners:
capture, result matching, memberships, related entities, Category, Collection,
Product, Variant, lifecycle and Tag. Native command provenance is authenticated
by the module owner before these receipts run.

Shared event decoding does not make mutation policy interchangeable. Product
soft deletion differs from scalar hard deletion; Link evidence retains repeated
IDs for distinct endpoint tuples. Category business rules remain native, and
Collection terminal replacement remains with the shared settlement owner.

## Adding An Admitted Module Or Workflow

Trace the native operation first, including empty branches, internal services,
queries, Links and events. Supply checked metadata and supported repository
policy to existing schema/query/write owners. Construct the native module through
`defineCommerceModule`; bind actual methods using `commerceServiceCommands` and
choose `commerceCommandPreparation(name)` with its existing decoder.

Use `commerceModuleEventBus` with explicit capture and check callbacks where
the native internal bus contract matches. Product Category, Pricing, Inventory,
read-only Stock Location and Link lifecycle keep their genuine extensions. Do
not add another general CRUD factory or recreate native algorithms.

A workflow snapshots its registration record, uses
`captureInstalledWorkflowModules` for selected bindings in declared order, and
retains size/hook checks at their native preparation boundary. It selects exact
methods through `prepareWorkflowResources`, prepares the native workflow and
passes its contract to the existing host. Installation and settlement remain
separate trusted owners; no raw database or finalizer enters native resources.

Prove the real native branch and its failure/lifetime behavior. Reuse claims need
another actual consumer or a neutral metadata witness, alongside module parity.
The executing source and provenance guards govern promotion; broader support,
remote effects and durable workflow suspension need their own admission.

## Validation

The promoted private `@medusajs/*` packages preserve selected fork semantics at
version 2.13.4. Their `source` export condition selects the portable graph;
default exports select checked local Node builds for comparison. Broad root
framework/utils imports and runtime source-island aliases remain refused.

The promotion manifest records exact source hashes, reviewed transformations,
licenses, dependencies, exports, native-test aliases and generated output hashes.
Native test ports preserve executable assertions and fixtures after type erasure.
Available builds use deterministic LF output and are verified; their absence is
allowed for source-only admission. Review transformations and refresh exact
authored/build hashes after changes. New paths require explicit manifest entries,
and the pinned source island remains unchanged.

The package scripts include affected main, compatibility, composed and native
integration typechecks. Module/shared owner tests, logical consumer tests and
native original suites have distinct configurations. Keep original assertions,
source guards and profile budgets intact.

Set `FLAREX_TEST_DRIVER` explicitly to `pglite` or `postgres` for logical and
native runner tests. PostgreSQL also requires the ordinary
`FLAREX_POSTGRES_DATABASE_URL` and, for protected-runtime fixtures, the separate
`FLAREX_POSTGRES_PROVISIONING_DATABASE_URL`. The Postgres Vitest configuration's
`MEDUSA_COMPARISON_DRIVER` alone does not switch every logical test to PostgreSQL.
Follow AGENTS.md for affected checks, both reviews and resource cleanup.
