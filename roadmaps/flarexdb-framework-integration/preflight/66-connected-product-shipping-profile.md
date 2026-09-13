# Connected Product Shipping Profile: Preflight

Status: approved; implementation remains paused at its connected native
module, Link and workflow completion gates. The shared installation redesign
has completed its separate bounded validation and performance gate. This refines preflight 59 B
after the implemented inequality, native batch-cardinality and scalar-Link
storage foundations. It does not activate Fulfillment or a new workflow yet.

## Outcome And Recommended Scope

Add one connected private proof: create a ShippingProfile, a Sales Channel and a
bounded batch of simple Products, associate each Product with both through native
steps, read pending roots, then settle once through the existing atomic workflow
host. ShippingProfile is an optional Product branch, not a requirement for every
Product; Customer is not a prerequisite.

Use one coherent implementation slice with construction, module, Link and
connected-workflow completion gates. Do not postpone the connected proof until
after unrelated Fulfillment APIs. No Flarex core, workflow-engine, transaction,
public API, production routing or installed-schema migration change is proposed.

## Current Evidence And Owners

The accepted design's Medusa boundary and package roadmap 16 retain native
commerce semantics with Medusa and authoritative scope, constraints, transaction
settlement, facts, publication and replay with Flarex. Adoption roadmap 06,
workflow-foundations 09/10/11 and preflights 58/59/61/63 own the existing proof.

The comparison source remains fork `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`
(baseline 2.13.4), as recorded in `third_party/medusa/SOURCE.json`. It defines the
compatibility baseline for promoted `packages/medusa-*` runtime code. The
uncommitted Fulfillment/ShippingProfile draft has only the bounded selected-fixture
proof described below; native provenance, complete module and connected workflow
completion remain separate gates.

Native paths below are relative to the island's `packages/` directory:

| Source | Consequence for this slice |
| --- | --- |
| `modules/fulfillment/src/services/fulfillment-module-service.ts` | Constructor forwards the complete container to MedusaService and retains actual internal services. Create normalizes scalar/array input, returns early inside the empty-array path, delegates to ShippingProfile's internal create, and serializes with the original base repository. No provider is called on this path. |
| `modules/fulfillment/src/services/fulfillment-provider.ts` | Constructor retains its repository/container and logger; provider lookup occurs in provider operations, not construction. The actual provider service can be a named native replacement without registering an external provider. This remains a construction proof obligation. |
| `modules/fulfillment/src/static-manifest.ts`, `models/`, `joiner-config.ts` | Twelve native models and their relationships form the source closure; source presence does not grant twelve tables or service APIs. |
| `modules/fulfillment/src/models/shipping-profile.ts` | `sp` ID, required name/type, nullable metadata, lifecycle columns and active-name uniqueness. `shipping_options` is an inverse has-many relation, not an outgoing physical FK from this table. |
| `core/core-flows/src/fulfillment/steps/create-shipping-profiles.ts` | Calls native create even for an empty array; compensation retains created IDs and invokes delete only for nonempty IDs. |
| `core/core-flows/src/common/steps/create-remote-links.ts` | Resolves `link` before empty-input return; result and compensation data are the input definitions, not generated Link rows. Its inverse calls dismiss for an empty array because that value is truthy. |
| `core/core-flows/src/product/workflows/create-products.ts` | Associates Sales Channels before ShippingProfiles; omits absent profile IDs. Full options/variants/pricing/inventory composition remains outside this slice. |
| `modules/link-modules/src/definitions/product-shipping-profile.ts` | Product `hasMany: true`, profile `hasMany` absent: one active profile per Product, many Products per profile, with native `prodsp` non-key IDs and complete-pair primary identity. |

## Native Construction And Finite Promotion

Promote a private `@medusajs/fulfillment` package with only required entry points:
actual models, service classes and static/joiner/schema metadata. The finite
closure includes model imports, both native service classes, their required
types and rule/event utilities, plus required portable utility/type dependencies.
Source-map every copied file and retain the pinned source hashes. Do not copy
loaders, historical migrations or the provider/HTTP bootstrap into the runtime
graph merely because they share the upstream package.

Use `defineCommerceModule` and its existing explicit replacement seam:

- Construct the real native internal services over the existing persistence
  adapter, including the real `FulfillmentProviderService` replacement.
- Bind ShippingProfile to its selected repository. Bind unadmitted models to
  explicit fail-closed repository capabilities, never to ShippingProfile's table
  by alias and never to fabricated successful/empty data.
- Supply the same borrowed persistence adapter and native event subscriber
  wiring to all constructed services. Do not use dummy provider registrations,
  fake service objects, lazy global containers or a second transaction owner.
- Expose only actual bound ShippingProfile create/retrieve/list/listAndCount
  methods. Unsupported hydration, writes and provider calls must be refused
  before any unadmitted storage/effect, including caught refusal.

The constructor/source-browser closure must be proved first within the approved
slice. If it requires a new native construction contract, extra table, external
effect or shared-owner correction, stop and propose that changed boundary. Do
not silently turn this into full Fulfillment or copy the create business method.

## Selected Schema And Small APIs

Capture full native DML metadata; select the actual ShippingProfile table for
physical storage, with its lifecycle and active-name unique index. Preserve
native relationship metadata while explicitly refusing hydration and deletion.
Deleting or soft-deleting a ShippingProfile calls native validation of
`shipping_options.id`; this slice cannot truthfully implement that validation.

Use a fresh configured schema: the existing fifteen Product/Sales Channel/Link
tables plus `shipping_profile` and `product_shipping_profile`. Seventeen is the
required inventory to prove, not an already compiled result. Do not rewrite an
existing installation. Product, Sales Channel and Fulfillment retain separate
profiles; one Link profile owns exactly the two selected Link tables.

Reuse shared query, projection, row validation, event and borrowed-context owners
for the ShippingProfile repository. Extract only genuinely repeated scalar
mechanics if needed; leave Sales Channel update/deletion and Product's richer
operations as explicit extensions. No universal CRUD base or module-name switch.

Extend the existing Link construction to assemble the two checked native
definitions under one actual native `Link` router and one borrowed service
owner. Reuse `link-schema`, `link-repository` and operation-local event evidence.
Compose validation by each selected definition's table/event identity; reject
unmatched or leftover evidence. Do not add a second workflow `link` resolver,
request-time registry or handwritten association dispatcher.

Keep the existing ProductSalesChannel-only entry point and canonical identity
unchanged. A named Product-Link entry point selects this two-definition set;
callers do not rebuild repositories, native service classes or router metadata.

Proposed connected caller shape (installed bindings are prepared by their owning
module/set construction):

```ts
const workflow = yield* prepareProductShippingProfileWorkflow({
  execution,
  modules: { product, sales_channel, fulfillment, link },
  revision,
  subscribers,
});
```

The facade admits one supplied ShippingProfile `{ name, type }`, one Sales
Channel and one to four simple Products as a proposed target. Do not invent a
default type. Verify the complete worst-case envelope against existing budgets;
the old maximum does not grant a larger budget. If four does not fit, report
the measured boundary before choosing a different declared input limit. No raised
limits, hidden chunked commits or local bypasses.

## Connected Execution And Failure Semantics

Use the actual create-ShippingProfiles step, existing Sales Channel/Product
creation steps, Sales Channel association step, and create-remote-links step.
Preserve Sales Channel association before profile association. Query five
separate pending scalar roots: Products, Sales Channel, ShippingProfile and both
Link roots; this does not admit cross-module graph hydration.

Keep one native `link.create` workflow method. Admit empty or homogeneous batches
for one selected Link family per call and refuse mixed-family batches before
native dispatch. Sequential native steps therefore do not activate the router's
parallel mixed-service `promiseAll` path.

Promote the two new steps with the existing explicit `transactionCovered`
registration, retaining their original invocation and inverse bodies. Prove
empty-input resolution, returned values and compensation data separately. The
connected root rolls back database changes instead of invoking deletion/dismissal
compensators; no saga, remote effect or suspension capability follows from this.

Retain the existing private commerce failure envelope. In particular, native
database failures may surface as `rollbackOnly` after checked DAL refusal. This
slice does not invent a ShippingProfile-specific conflict translation.

The pinned ShippingProfile integration file contains five tests. Two creation
tests assert returned rows/events; a third duplicate-name test also requires
`err.message` to contain `exists`. The pinned PGlite test adapter explicitly maps
SQLSTATE `23505` to an `already exists` message; that mapping is not performed by
the ShippingProfile business method and is not the current Flarex host contract.

Recommended explicit compatibility decision: run the two creation/event bodies
unchanged where the harness permits; preserve the entire original five-test
source. Add separate Flarex-backed duplicate-name/atomic-rollback witnesses, but
do not claim the third test's exact error-message parity. Keep that error-message
case and both deletion cases clearly deferred, not silently rewritten or counted
as passing native coverage. A future normalized Medusa error surface must be
designed at the shared boundary, not patched per module or in the test harness.

## Alternatives, Cleanup And Completion Gates

- **Retain:** native models/services/step bodies, original tests and comparison
  sources; existing ProductSalesChannel and neutral singular-Link proofs remain
  supported independent profiles, not legacy fallbacks.
- **Extend:** selected module metadata/repositories, shared Link composition and
  named workflow facade, exact source/build receipts and finite promotion guards.
- **Replace/delete:** any superseded repeated Link wiring in the touched path;
  temporary construction diagnostics. No second cardinality algorithm or fake
  service implementation is retained.
- **Defer:** ShippingOptions, provider registration/execution, rates, shipments,
  deletion/update APIs, relation hydration, mixed-family Link calls, full native
  Product composer, Pricing/Inventory/Stock Location, installed-schema migration,
  public HTTP/error compatibility and production deployment.

Rejected alternatives: promote all Fulfillment tables merely for constructor
convenience; create a fake scalar model; handwrite native create/Link semantics;
add a per-module core branch; map every rollback error to a duplicate-name error;
or split the connected root into independently committed module operations.

Completion requires native construction/serialization and browser closure; the
exact selected schema; scalar/array/empty create and events; required fields,
IDs and active-name conflicts; denied relations/provider/deletion access; both
Link families and scalar graph roots; same-profile reuse across Products;
conflicting assignment/restore; exact operation-local facts/events; late/caught
failure rollback; replay/revision/uncertain settlement; cancellation/escaped
capabilities and subscriber failure. Prove scope/profile isolation and ordinary-
role PostgreSQL concurrency without confusing host serialization with index
contention. Reuse the completed neutral physical-constraint witness where its
contract is unchanged, plus connected native/module concurrency evidence.

Run PGlite and ordinary-role PostgreSQL separately, unchanged ProductSalesChannel
and native workflow regressions, affected typechecks/builds, exact promotion and
browser/source guards, lint and both required final reviewers. Preserve existing
deadlines and stop owned resources. Reconcile durable roadmap truth and create
one scoped implementation commit only after completion. Any newly exposed core
defect remains a stop-and-approval boundary, not authority to glue-fix it here.

## Current Installation Gate

The shared installation stop is resolved by the approved
[framework installation redesign](./76-framework-installation-core-redesign.md).
The unchanged seventeen-table suite now completes installation and ready replay
through the shared owner on both drivers and exercises its native scalar/array/
empty creation, scalar read/count, event, required-field, denied-hydration and
duplicate-name rollback assertions. Frozen acceptance is owned by record 91;
exact samples and validation receipts belong in artifacts and Git history.

The historical witness was installation exhausting the existing Effect deadline
before native assertions, with repeated growing-history restoration and repeated
publication prerequisites. The correction is in persistence's protected progress,
full verification and publication owners. No ShippingProfile-specific bypass,
new transaction, weaker assertion or larger deadline was added. Earlier local
restoration candidates remain withdrawn; their chronology does not describe the
retained runtime.

These remain bounded installer/adapter assertions. They do not establish the
complete native Fulfillment test file, two-Link workflow, full module coverage,
production routing or activation. The uncommitted connected ShippingProfile work
must still satisfy this preflight's native construction, provenance, Link,
workflow, failure/recovery and review gates before capability completion. Keep
its private commerce error envelope rather than claiming the pinned test adapter's
duplicate-name message or full Fulfillment parity.
