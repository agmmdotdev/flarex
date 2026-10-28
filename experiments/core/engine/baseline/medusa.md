# Medusa consumer baseline

Status: **Private bounded profiles inspected; validation not rerun**.
The native source fork is `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, package
baseline 2.13.4, recorded in [SOURCE.json](../../../../third_party/medusa/SOURCE.json).
Promotion selects the executing closure from that source island. Each admitted
module/workflow's schemas, selected methods, graph permissions and resource
policy define supported branches; metadata presence alone grants no method.

## Existing consumer families

The canonical executing enumerations are
[adapter modules](../../../../packages/medusa-adapter/src/modules/),
[adapter workflows](../../../../packages/medusa-adapter/src/workflows/), their
confined constructors and connected adapter tests. The
[adoption owner](../../../../roadmaps/flarexdb-framework-integration/06-medusa-adoption.md)
and focused preflights explain their admission/status boundaries.

| Family | Existing bounded behavior to preserve |
| --- | --- |
| Currency, Product and Sales Channel | Native services, Product graph/lifecycle/events/category behavior and selected Sales Channel compositions. |
| API Key and Links | Create/update/revoke/delete and selected Sales Channel association/Link lifecycles. |
| Product compositions | Admitted create/update/batch, categories/types/tags/collections/options/variants and Inventory/Pricing/Shipping relationships. |
| Inventory, Stock Location and Store | Item/Level create/update/delete/batch, selected reservation/storing branches and lifecycle compositions. |
| Fulfillment | Profiles/types/options, service/geo-zone/set graphs, installed Links, local provider and selected create/cancel/shipment/delivery/return branches. |
| Pricing | PriceSet/PriceList/Price/Rule lifecycle and bounded update/batch compositions, selected variant/item pricing reads. |
| Tax | Region/Rate/Rule operations, rule replacement and item tax-line calculation. |
| Order | Archive/completion, bounded Change update/cancellation/decline/deletion and admitted checkout creation/accounting. |
| Payment | Session/Collection/account-holder and selected local System-provider authorization/capture/refund compositions. |
| Existing Cart checkout/context | Checkout from existing carts, Customer-context extension, Customer selection, variant-item pricing and inventory confirmation. |

These rows refer to the actual selected module/workflow contracts; they do not
admit every native method in those families. At inspection there were 123
workflow source files in 13 families, 17 module directories and 534 tracked
adapter test files, including 174 logical-* files. Counts identify source scope,
not supported-operation totals or passing results.

## Shared migration seams

- [defineCommerceModule](../../../../packages/medusa-adapter/src/module/definition.ts)
  constructs prepared modules and confined native repositories/services.
- [workflow host](../../../../packages/medusa-adapter/src/workflow/host.ts) owns
  AtomicWorkflowExecution, installed selection and trusted preparation.
- [runNativeMedusaWorkflow](../../../../packages/medusa-adapter/src/workflow/runtime.ts)
  uses genuine executeWorkflow, native callbacks and atomicRootOutcome policy
  with one outer outcome owner.
- [complete-cart](../../../../packages/medusa-adapter/src/workflows/cart/complete-cart.ts)
  selects 18 sources; its Customer-context extension adds a nineteenth. Read
  graph participation does not grant general module mutations.

Reuse native normalization, services, graphs, hooks, compensation and error
behavior while replacing their core-facing execution machinery. Core Flows
workflow exports and Workflows SDK ./native execute TypeScript directly; native
module services/models can use conditional source/dist exports. Each validation
lane must identify its actual selected build inputs.

## Canonical identities and documentation limits

| Artifact | Inspected working-byte SHA-256 | Scope |
| --- | --- | --- |
| SOURCE.json | `9f97efb20da45f0995866e325c6372dc0d9aa4be835437d28b164325e703b5b1` | Native pin and source manifest identity. |
| [Promotion manifest](../../../../roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json) | `427ce7c2db292994f8ad0fc362c15b572921a0a4feb22e0b2d809fcf18c84aa7` | 2,894 file records, 32 packages and 3,284 build-file records; dirty working state, not a reviewed release. |
| [Product upstream cases](../../../../roadmaps/flarexdb-framework-integration/preflight/product-upstream-test-cases.json) | `c50c45c1dc32384c5aecc726ffe98557ffa9649fa2cbc304aaf526fc16978c81` | Ten Product integration files, 205 admitted originals and one retained upstream skip. |

The older medusa-capability-source-map still describes an inactive runtime
source audit and only one connected profile; it is not an exhaustive current
support manifest. medusa-currency-runtime-inventory is explicitly a measured
preflight, not promotion authority or the complete integration inventory.

An older Cart-creation preflight says Promotion's service/static manifest are
unpromoted; the current
[Promotion checkout reader](../../../../packages/medusa-adapter/src/modules/promotion/checkout-read-service.ts)
and live promotion manifest establish bounded checkout reads. They do not select
Promotion computation, campaigns, budgets, writes or complete Cart creation.
Record this discrepancy rather than importing either broader interpretation.

## Pending foreign work and exclusions

Complete Cart creation remains outside the admitted baseline. Foreign changes to
Cart service/manifests/creation models and untracked Cart ownership tests are
pending work, distinct from existing-cart checkout. Preserve them and require a
coordinated handoff before including newly completed behavior in the goal.

General Customer/Group CRUD, arbitrary module sets, populated upgrades, remote
providers, resumable external sagas, automatic native replay and public/hosted
activation are not established by these bounded profiles.

Validation uses the existing logical-* driver selection, Product upstream case
inventory/config, all 14 original Sales Channel cases and profile-specific
source/promotion/portability guards. PGlite, ordinary-role PostgreSQL and native
Cloudflare hosting remain separate evidence. No fresh test pass is claimed here.
