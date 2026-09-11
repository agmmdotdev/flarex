# Product Workflow: Sales Channel And First Stored Link

Status: Gate A approved and in progress; its shared installation-binding correction
is complete under preflight 51. Gates B and C remain unapproved.

## Outcome And Direction

The user-selected endpoint is end-to-end Product workflow integration on Flarex.
Use the pinned `createProductsWorkflow` as the first complete workflow target;
update/delete and other Product workflows require their own dependency traces.
The next connected milestone is:

```text
native Sales Channel service + existing Product service
  -> one configured schema candidate
  -> authoritative ProductSalesChannel Module Link
  -> native associateProductsWithSalesChannelsStep
  -> committed link reads, lifecycle, facts, events and replay
```

Customer was previously recommended as a structurally different adapter-reuse
proof. It is not a prerequisite for this workflow and is deferred. Follow the
actual dependency graph instead of completing unrelated modules first. Exercise
native workflow branches as foundations land, rather than postponing integration
until every module is independently complete.

This milestone has three ordered gates below. In particular, a Sales Channel
port alone must not be reported as completion of the connected milestone.

## Governing Evidence

- [Accepted Medusa boundary](../../../design-notes/flarex-db-accepted-design.md#medusa-boundary)
  and [package ownership](../../16-package-boundaries.md).
- [Medusa adoption](../06-medusa-adoption.md), especially complete configured
  candidates, first Link endpoint, commerce-link commit admission and lifecycle.
- [Shared adapter](./47-medusa-shared-persistence-adapter.md) for implemented
  module preparation, checked metadata and direct command binding.
- [Workflow foundations](../../workflow-foundations/README.md), especially
  existing private atomic execution, selected resources, graph reads and events.
- [Source pin](../../../third_party/medusa/SOURCE.json): fork
  `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, package baseline `2.13.4`.
  The source island is comparison/promotion input, not executable root source.

The current root `packages/medusa-core-flows/package.json` exports selected
Product workflows, not full Product creation or the Sales Channel association
step. `packages/medusa-modules-sdk` does not contain the native Link runtime.
There is no active Sales Channel package. These sources need explicit promotion;
their presence under `third_party` does not establish runtime availability.

### Product Creation Dependency Trace

Paths below are relative to the pinned `third_party/medusa/upstream/packages`.

| Native source | Required behavior |
| --- | --- |
| `core/core-flows/src/product/workflows/create-products.ts` | Creates Product rows, associates Sales Channels, links a supplied Fulfillment shipping profile, runs variant creation, emits Product events and exposes the products-created hook. |
| `core/core-flows/src/product/workflows/create-product-variants.ts` | Creates variants; validates existing Inventory items through remote query; creates default items for managed variants; creates Inventory links, Pricing price sets and variant-price-set links; emits events and exposes a hook. |
| `core/core-flows/src/inventory/workflows/create-inventory-items.ts` | Always calls the inventory-level child workflow, even when the derived level list is empty. |
| `core/core-flows/src/inventory/steps/validate-inventory-locations.ts` | Resolves remote query and queries `stock_location` without an empty-input early return. Stock Location query admission cannot be omitted solely because Product creation supplies no levels. |

Customer is absent from this traced path. Fulfillment here means shipping-profile
ownership, not arbitrary shipping providers. Store/default-channel administration,
HTTP authentication, checkout, payment and production hosting are separate needs.
Pricing and Inventory service internals still require focused capability audits
before their promotion; this table is not a complete implementation approval.

## Exact Sales Channel And Link Findings

### Sales Channel

The pinned `modules/sales-channel/src/static-manifest.ts` declares one model,
the actual module service, and no custom repositories, services or loaders.
The model has an `sc`-prefixed ID, searchable name, nullable searchable description,
`is_disabled` defaulting to false, and nullable metadata. Its service owns actual
create/update/upsert normalization and scalar-versus-array results; generated
Medusa service behavior supplies the remaining admitted operations.

The original `integration-tests/__tests__/services/sales-channel-module.spec.ts`
contains 14 cases: linkable metadata, creation, retrieval/error, update/error,
lists, list-and-count/filter/pagination/projection, disabled filtering and delete.
The two static-manifest tests are additional source witnesses. Inventorying them
does not mean they have been run against Flarex. Upsert and full soft-delete/
restore semantics need additional witnesses if exposed, not inferred coverage.

Reuse actual service methods and the existing `defineCommerceModule` and
`commerceServiceCommands` owners. Do not copy Product's Category/image policies
or create a universal CRUD surface. Admit Sales Channel events before its native
writes; derive event names/payloads from the actual service/event builders and
authenticate them against performed writes and successful command evidence.

### ProductSalesChannel Is Not A Product-Local Pivot

The pinned `modules/link-modules/src/definitions/product-sales-channel.ts`:

- names table `product_sales_channel`, ID prefix `prodsc`, and entity
  `LinkProductSalesChannel`;
- declares Product and Sales Channel endpoints with `hasMany: true` on both;
- supplies Link aliases and Product's `sales_channels` field alias;
- has no extra-data fields and no endpoint `deleteCascade: true` declaration.

The native storage generator `modules/link-modules/src/utils/generate-entity.ts`
makes the endpoint fields a composite primary key. `id` is a separate indexed
field, not the generated physical primary key. It retains managed timestamps,
soft deletion and active endpoint indexes. The Joiner `primaryKeys` list must
not be mistaken for that physical primary-key definition.

The native repository `modules/link-modules/src/repositories/link.ts` generates
an ID, sets `deleted_at = null`, and calls `upsertMany`. Therefore duplicate
attachment and attachment after dismissal are not generic insert-only behavior.
Characterize returned and persisted IDs/timestamps for repeated attachment before
freezing the adapter contract; do not assume conflict-time ID stability.

`LinkService.dismiss` soft-deletes matching pairs. `LinkModuleService` owns
normalization, serialization, attached/detached events and lifecycle return maps.
The high-level `core/modules-sdk/src/link.ts` owns endpoint routing and lifecycle
traversal. Its `delete` calls the soft-delete cascade path; it is not simply a
physical delete. The chosen definition must not cascade from a link into deletion
of the Product or Sales Channel endpoint. Other cardinalities remain unadmitted.

The association step returns early for empty `links`, before resolving `LINK`.
Nonempty input invokes native `Link.create`; its compensator invokes
`Link.dismiss`. The stored link is authoritative, not a derived Application edge.

## Concrete Gaps And Responsible Owners

| Gap | Current evidence | Required direction |
| --- | --- | --- |
| Configured schema composition | Product and Currency schema capture construct separate artifacts; shared DML lowering is not a module-set coordinator. | Medusa adapter owns deterministic configured-set collection and endpoint resolution; the existing artifact/install owner remains authoritative. |
| Several logical modules in one installation | `packages/persistence-postgres/src/atomicCommerce/participants.ts` rejects a repeated installation digest, even for different participants. | Separate logical participant/profile identity from physical installation admission in the existing core owner. Do not merely remove the duplicate check. |
| Link key mutation/lifecycle | `commerceTransaction/profile.ts` admits update/managed lifecycle only for scope plus one primary-key component; the native Link has scope plus two endpoint components. | A separately approved core contract must support the actual declared-key mutation, conflict and lifecycle behavior. No raw SQL or surrogate-key workaround in the adapter. |
| Link publication admission | `commerceTransaction/publication.ts` consumes authenticated relational row closures. No separately admitted commerce-link contract exists; the adoption roadmap explicitly requires one. | Complete the commit-owner preflight before Link writes. Reuse existing receipt/key-codec/publication machinery where sufficient; decide the endpoint evidence and fact representation explicitly rather than inventing a parallel finalizer. |
| Portable native Link | Native `Link` imports global `MedusaModule`; native Link repository/entity construction imports MikroORM. | Promote a bounded portable seam, retaining native normalization/routing/lifecycle algorithms. Explicit loaded modules replace global fallback; a DAL-backed repository replaces ORM mechanics. |
| Workflow and query binding | Existing workflow resources expose selected module methods, graph and events; no native Link resource is installed. Existing graph aliases require `methodSuffix`, absent from the raw Link alias. | Add an explicit scoped Link resource and the required Link read/alias translation in the Medusa owner. Do not fake a Product relation or infer aliases by entity-name dispatch. |

The existing relational key selector/codec already supports ordered text-key
components (`commitPublication/relationalRowKey.ts` and `relationalFacts.ts`).
That is reusable groundwork, not proof of admitted composite-key upsert/lifecycle.
Likewise multi-installation atomic execution does not prove multiple module
profiles sharing one installation.

### Recommended Core Contract Direction, Not Yet Approval

Prepare each authentic installation once and preserve separate logical module
participants with explicitly confined table/command/event capabilities. Group
physical admission/locks by installation while retaining the existing lock order,
shared request budget, rollback-only lifetime, one publication and one settlement.
Reject conflicting artifact/layout/target pins and accidental capability overlap.
Do not solve composition by giving every module the entire candidate's writes.

For links, retain the native endpoint-pair conflict key and actual row identity
behavior. First define attach/upsert, no-op, dismiss and restore observations,
then admit their receipts and event validation through the existing publisher.
Native Link construction does not declare physical endpoint FKs or validate
endpoint existence in `Link.create`. Adding such validation is a compatibility
decision, not a harmless schema improvement; scope isolation is still mandatory.

The focused core preflight must decide exact same-installation admission and
Link mutation/publication contracts before those core changes start. Existing
generic row facts may be reusable, but silently treating them as satisfaction of
the roadmap's commerce-link admission gate is not permitted. A new feed family
or protocol version is also not justified merely by the name "Module Link".

## Ordered Work And Approval Boundaries

### A. Sales Channel And Configured Endpoint Foundation

Approved foundation scope:

1. Freeze a promotion map for native Sales Channel model/service/static metadata,
   its exact dependency closure and preserved original tests. Keep the island
   unchanged; adapt portable imports in the promoted copy under source guards.
2. Build one immutable configured Product + Sales Channel schema candidate using
   actual checked metadata and the existing artifact/installation pipeline.
   Preserve owner-local table identities and reject collisions/unsupported models.
   This candidate contains no admitted stored Link yet. Currency remains its
   existing separate admitted consumer; inclusion/seeding is not implied.
3. Provide one Sales Channel command composition entry point that owns metadata,
   repository/service wiring, direct bindings, event policy and read registration.
   Preserve the existing Product entry point and module-specific extensions.
4. Prove schema/install/startup/read-only behavior first; admit exact endpoint
   event contracts before native create/update/delete compatibility tests.
   Test each module's confined profile on the configured installation without
   claiming a multi-participant atomic workflow.

No core transaction change or Link write is authorized by A. If A itself exposes
an insufficient shared contract, preserve the witness and pause at that owner.

#### Shared Installation Binding Prerequisite

The initial preflight placed same-installation composition only in Gate B.
Gate A already needs an additional core contract: separate confined Product and
Sales Channel profiles must both be authorized against one configured installation,
even when their commands run in separate transactions.

The shared owner is `packages/persistence-postgres/src/frameworkSchema/binding`,
with profile authentication and per-request confinement in `commerceTransaction`.
The [approved core correction](./51-commerce-installation-profile-bindings.md)
replaces repeated commerce role triplets with one installation coverage set and
direct profile membership. Loaded profiles alone still grant no execution access.
Preparation/activation validate every selected member; requests receive only the
requested profile's own table capabilities. No Sales Channel branch exists in core.

The connected `packages/medusa-adapter/test/sales-channel-binding.test.ts` witness
installs all 14 endpoint tables, refuses unbound Product access, then authorizes
both disjoint profiles through the same constructor and reads both endpoints.
Core regressions independently exercise three neutral profiles, isolated writes,
relational closure, revocation and canonical format refusals.

Reproduce with `pnpm --filter @flarex/medusa-adapter exec vitest run --config
vitest.sales-channel.config.ts`. Select `FLAREX_TEST_DRIVER=postgres` with an
ordinary-role `FLAREX_POSTGRES_DATABASE_URL` for the real database lane.

The owner confirmed no production data or retained binding compatibility obligation.
Old development encodings are removed, not preserved as a second execution design.
Same-installation atomic participants and stored Link behavior still belong to
Gate B. The existing transaction and publication owners remain unchanged.

Sales Channel service/command compatibility, guarded source promotion and the
original native integration cases remain incomplete. Partial foundation work
must not be reported as an integrated module or a completed Gate A.

### B. First Stored Link And Shared-Core Admission

Before implementation, complete and approve the focused core contract described
above, including characterization of native duplicate/reactivation outcomes.
Then add one fresh Product + Sales Channel + ProductSalesChannel candidate,
admit storage constraints and link receipts/events, and promote the portable
native Link closure. Fresh private fixtures are recreated; this is not an
existing-row module-set upgrade or production migration promise.

Prove attach, dismiss, soft-delete/restore, endpoint-triggered traversal with
the exact selected cascade configuration, and repeated/concurrent attachment.
Do not advertise arbitrary `deleteCascade`, extra-field or one-to-one support.
Preserve the native Link regression witnesses; their mock routing tests are
not substitutes for real stored-link conformance.

### C. Connected Native Association Workflow

Promote the actual association step and, where useful, the native Sales Channel
creation step. Compose a private bounded workflow using existing Product service
commands, the real Sales Channel service and native association behavior. Prove
pending and post-commit selected Link/endpoint reads through admitted query
boundaries, including the declared Product alias when exposed.

Use the existing workflow SDK/host. No new workflow engine, general scheduler,
wait/signal or provider subsystem. For the selected all-database profile, root
rollback handles transaction-covered writes; retain native compensator evidence
without claiming general cross-commit compensation or replay safety. Arbitrary
hooks, remote effects and suspension are excluded from this atomic root.

The milestone is complete only after C; full `createProductsWorkflow` remains
pending Pricing, Inventory/Stock Location, shipping-profile and transitive audits.

## Construction API And Reuse Check

The existing Product caller imports `makeLocalProductCommands` and receives its
commands, graph and workflow definitions. It does not assemble each repository
or internal service. Sales Channel should have the equivalent cohesive owner,
not require the caller to import metadata decoders, repository factories and
individual command generators.

Inside that owner, the established binding remains direct:

```ts
const commands = commerceServiceCommands(module.use);
const create = commands.write("salesChannelCreate", prepareCreate,
  (service, data) => service.createSalesChannels(data));
```

This illustrates an existing construction API, not an implemented Sales Channel
command or final naming contract. The configured-candidate owner must return
the prepared per-module views needed by the existing host; callers must not
reconstruct its normalization/lowering pipeline. Named module extensions stay
local. No entity switch, generic CRUD descriptor, nested registry or new service
locator is proposed. Medusa's native container is only the finite compatibility
surface at the workflow boundary, not application construction authority.

## Retain / Extend / Replace / Delete

| Action | Scope and completion rule |
| --- | --- |
| Retain | Exact pinned island, original behavioral assertions, existing Product/Currency APIs and native module semantics. Their independent compatibility profiles remain supported internal proof consumers, not fallback runtimes. |
| Extend | Existing checked schema/repository/command/query owners for the admitted configured set; core binding admission only under preflight 51 approval, and same-installation atomic/store/publication changes only under B's explicit contract. |
| Replace | Native Link global lookup and ORM infrastructure in the promoted closure with explicit scoped dependencies and existing Flarex persistence capabilities. Preserve source provenance and label infrastructure adaptations. |
| Delete | Temporary duplicate assembly, copied algorithms, provisional exports and diagnostic fixtures displaced during implementation. Remove after equivalent assertions move to the real owner; no later unspecified cleanup phase. |

Do not mass-refactor Product, introduce a second schema grammar, import the
fork's Drizzle manager, or silently repurpose Product's local-pivot operations.
Existing-row installations, issued IDs and migrations need a separate obligation
inventory before any destructive migration; private test recreation is not one.

## Validation And Completion Gates

- Preserve all 14 original Sales Channel cases and the selected source/static
  witnesses. Add omitted/null/default, metadata, scalar/array, managed-field,
  escaped-service and isolation checks for the exact exposed surface.
- Prove deterministic combined artifacts; missing endpoints, duplicate names,
  wrong scope/target/digest, cross-module capability leakage and unsupported links
  fail closed. Re-run existing Currency/Product regressions.
- Before B, retain a failing witness for same-installation participants and
  composite-key lifecycle admission. Owner correction tests must cover resource
  sharing, lock order, authentic membership, rollback, complete facts and events.
- Cover repeated attach, attach-after-dismiss, concurrent same-pair operations,
  multiple channels/products, missing endpoints, same IDs in different scopes,
  stale binding and native result/event identity. Freeze each expectation from
  source plus native characterization; do not substitute guessed semantics.
- Prove native nonempty and empty association branches, post-write failure/root
  rollback, exact-request replay, different-input rejection, uncertain-outcome
  recovery and no event delivery before commit. Native duplicate Link calls and
  Flarex request replay are distinct contracts.
- Run affected storage/transaction tests on both PGlite and an ordinary-role
  real PostgreSQL instance. Neither lane proves production scale or Cloudflare
  deployment. Preserve resource limits and existing timeout assertions.
- Run affected strict typechecks, exact promotion/test-port/source-island guards,
  physical Worker import/bundle guards, configured-root lint and both mandatory
  project reviews before significant implementation commits. Apply Effect skills
  to implementation and failure/lifetime changes.
- Update owning roadmaps only with resulting durable capability truth. Complete
  each approved gate with scoped validation, cleanup and a coherent commit.

This preflight owns capability decisions and blocker disposition, not test receipts.
Public APIs, HTTP bootstrap, Store administration, general migrations, arbitrary
modules/links, full Product workflows and production activation remain gated.
