# Hosted Programmable Medusa Roadmap

## Vision

The long-term product direction is not only to run Medusa on Cloudflare. The
larger direction is a hosted programmable commerce platform:

```text
developer app code
  -> isolated deployment runtime
  -> restricted commerce and database APIs
  -> trusted Medusa core runtime
```

This is similar to the Convex and Flarex model: application code is colocated
with the app during development, then built and deployed to a central platform
runtime instead of each developer operating a full VPS-based Medusa server.

The hosted product should attach one Flarex project to each hosted Medusa
project. Flarex is the general programmable database/runtime layer for custom
application code. Medusa remains the trusted commerce engine.

```text
hosted Medusa project
  -> trusted Medusa core runtime
  -> attached Flarex project
       custom schema
       functions, actions, routes, schedules, hooks, workflows
       generated APIs and sync
```

This reduces platform surface area without making Flarex the immediate
replacement for Medusa's internal module persistence.

## Core Separation

There are two server API layers.

### Internal Medusa Runtime

This is trusted platform code maintained by this fork:

- Medusa core modules and module services.
- Medusa DML and internal schema compilation.
- Drizzle, D1, Durable Object SQLite, and projection adapters.
- Cart, order, product, pricing, inventory, payment, and checkout logic.
- Internal workflows, compensation, event handling, and projection rebuilds.
- Platform-owned migrations and upgrade logic.

This layer may continue to use internal schema and migration machinery because
it is not directly exposed to application developers.

### Developer Runtime

This is the client-facing server API for application developers:

```text
flarex/
  schema.ts
  functions/
  workflows/
  http/
  hooks/
  _generated/
```

This layer should be Convex-like:

- Developers define custom schema declaratively.
- Developers do not write Medusa module migrations.
- Developers author functions, workflows, hooks, and HTTP endpoints.
- Generated files provide type-safe server and client APIs.
- User code runs in an isolated runtime and receives a restricted context.
- User code cannot access the raw Medusa container, raw repositories, raw
  Durable Objects, raw D1 bindings, or platform secrets.

Flarex core should stay commerce-neutral. Commerce APIs are supplied by a
Medusa extension package and composed by the hosted Medusa platform:

```text
flarex core
  -> ctx.db
  -> ctx.auth
  -> ctx.scheduler
  -> ctx.storage
  -> sync and generated APIs

@medusajs/flarex-commerce
  -> ctx.commerce
  -> commerce ID validators
  -> commerce hooks/events
  -> Medusa facade syscalls
```

Generic Flarex apps should not import Medusa or know about commerce. Hosted
Medusa apps opt into the commerce extension.

## Developer Schema Model

Developer schema is not processed through Medusa's internal module migration
flow. It should be limited and platform-managed:

```ts
export default defineSchema({
  wishlists: defineTable({
    customerId: v.string(),
    productId: v.string(),
    note: v.optional(v.string()),
  }).index("by_customer", ["customerId"]),
})
```

The platform owns deployment schema lifecycle:

```text
schema declaration
  -> analyze and validate compatibility
  -> store deployment schema metadata
  -> apply safe storage changes
  -> rebuild derived projections when required
  -> reject unsafe changes unless an explicit platform mechanism exists
```

This is intentionally different from internal Medusa module migrations.

Custom schema is owned by the attached Flarex project. It can hold extension
data such as wishlists, loyalty points, CRM notes, storefront UI state, custom
catalog annotations, and custom link records to commerce resources. It should
not write Medusa module tables or Medusa internal Link records directly.

Custom schema may reference Medusa resources through typed commerce IDs:

```ts
export default defineSchema({
  cartGiftWrap: defineTable({
    cartId: commerce.id("cart"),
    message: v.string(),
    style: v.string(),
  }).index("by_cart", ["cartId"]),
})
```

These Flarex-owned relationships are extension links. Medusa Link remains the
internal mechanism for Medusa module-to-module relationships. If custom data
affects pricing, checkout, inventory, fulfillment, tax, payment, or order
state, the change must go through a trusted `ctx.commerce` facade or Medusa
workflow.

Extension data falls into three categories:

```text
display or metadata extension
  -> Flarex custom table linked by commerce ID
  -> eventual consistency is acceptable

commerce-affecting extension
  -> Medusa commerce facade or Medusa workflow
  -> Medusa owns the transaction and invariant

post-commit extension
  -> Medusa outbox/event
  -> Flarex hook writes custom data after commit
```

Examples:

- Cart notes, gift messages that do not affect price, wishlists, admin notes,
  and product annotations can be Flarex custom data.
- Gift wrap that changes price, custom checkout validation, discounts,
  inventory reservations, fulfillment, tax, and payment behavior must be
  Medusa-owned extension behavior.
- Loyalty points, CRM updates, and campaign events after order placement should
  use outbox/events and Flarex hooks.

The product rule is:

```text
Flarex extends the app.
Medusa extends commerce.
Outbox connects them.
```

## Developer Function Model

Developer code should use restricted APIs:

```ts
export const addWishlist = mutation({
  args: { productId: v.string() },
  handler: async (ctx, args) => {
    const customer = await ctx.auth.customer()

    await ctx.db.insert("wishlists", {
      customerId: customer.id,
      productId: args.productId,
    })
  },
})
```

Commerce access should also go through a restricted facade:

```ts
await ctx.commerce.cart.retrieve(cartId)
await ctx.commerce.product.retrieve(productId)
await ctx.commerce.workflow.run("completeCart", { cartId })
```

Do not expose:

```ts
container.resolve("cartModuleService")
```

The developer-facing surface may not expose Medusa modules at all. Modules are
an internal implementation mechanism. The product API can expose schema,
functions, workflows, custom HTTP endpoints, commerce hooks, and events.

The facade is provided by the Medusa commerce extension, not by Flarex core.
That keeps Flarex usable as a general Convex-like framework while letting
hosted Medusa projects expose first-class commerce capabilities.

## Tenant And Deployment Model

This is platform-level multi-tenancy, not simply Medusa store-level
multi-tenancy.

Every runtime operation should be scoped by:

```text
tenant_id
deployment_id
environment
deployment_version
```

Authoritative Durable Object names and projection storage must include tenant
and deployment scope:

```text
partition:{deploymentId}:{partitionFamily}:{partitionKey}
catalog_projection:{tenantId}
```

The final partition boundary is a business transaction boundary, not a Medusa
module boundary and not necessarily one record per Durable Object. One
partition may colocate several Medusa module tables and services when they
must participate in one atomic operation.

Projection storage may be:

- shared D1 databases with enforced tenant scoping for smaller tenants;
- dedicated D1 databases per tenant, store, or domain for larger tenants;
- another projection backend when D1 size or throughput limits are exceeded.

Tenant filtering must be enforced by platform adapters. User code must not be
able to skip tenant predicates manually.

Current implementation checkpoint:

- `@medusajs/cloudflare-runtime` now owns the first shared Worker-safe
  `TenantRuntimeContext`, partition address, and projection scope primitives.
- `apps/medusa-cloudflare` resolves the context at the Worker application root
  and proves tenant-separated address generation in the existing workerd Index
  proof.
- The existing Index proof Durable Object route now uses that context to scope
  `INDEX_PROOFS.getByName`, proving the same aggregate key resolves to
  different Durable Object names under different tenants.
- The existing Index proof D1 route now uses that context to select a physical
  D1 projection binding. The local proof uses separate tenant A/B bindings
  rather than adding `tenant_id` columns as the primary isolation mechanism.
- This is only the addressing foundation. It is not the hosted deployment
  registry, final partition topology, user-code runtime, or developer schema
  API.

## Authoritative State And Projections

Durable Objects are the authoritative coordination boundary for state that needs
serialized writes, read-your-own-writes, or checkout-time correctness. D1 is a
projection/query backend, not the primary write store for high-churn or
correctness-critical aggregates.

Target split:

```text
Worker / Nitro API
  -> resolve tenant, deployment, environment, version
  -> route command or query

Authoritative commands
  -> tenant/deployment scoped Durable Object partition
  -> local SQLite through the shared Drizzle persistence contract
  -> emit projection/update events

Listing and filter queries
  -> D1 projection tables, cache, or later search/index backend

Critical live reads
  -> Durable Object directly
  -> checkout, cart mutation, inventory reservation, payment/session state
```

The scalability model is many Durable Object instances, not one global Medusa
database object. A Durable Object class defines behavior; the instance name/id
is the partition and scale boundary.

Examples of likely partition families:

- `cart:{tenantId}:{deploymentId}:{cartId}` for active cart mutation state.
- `order:{tenantId}:{deploymentId}:{orderId}` for order lifecycle state.
- `inventory:{tenantId}:{deploymentId}:{locationOrSkuShard}` for serialized
  reservations.
- `workflow:{tenantId}:{deploymentId}:{workflowInstanceId}` for workflow
  execution state.
- `catalog:{tenantId}:{deploymentId}:{catalogShard}` for authoritative product
  mutation state when product writes need coordination.

Product/category listing, sorting, and filtering should read from projections.
Projection lag is acceptable for browse flows. Checkout and other correctness
paths must read or coordinate through authoritative Durable Objects.

Carts should not primarily live in D1. Active cart writes are high-churn and
benefit from a cart-scoped Durable Object. D1 may still receive cart-derived
events or projections for analytics, recovery, or support queries.

The attached Flarex project does not change the authority split:

```text
ctx.db
  -> Flarex custom application state

ctx.commerce
  -> Medusa authoritative commerce state

projections
  -> derived live/list/read models
```

Flarex may share storage primitives with the Medusa runtime, but custom
application tables and Medusa commerce tables remain separate authority
domains unless a future adapter proves unchanged Medusa module suites through a
Flarex-backed persistence path.

The important distinction is between Flarex's developer database API and the
platform storage substrate:

```text
Flarex ctx.db
  -> document/custom application data
  -> developer schema and indexes
  -> not the Medusa module persistence API

Flarex platform storage runtime
  -> tenant/project/deployment resolution
  -> Durable Object, D1, SQLite, or other binding lookup
  -> partition and projection address helpers

Medusa persistence adapters
  -> may consume the Flarex storage runtime underneath
  -> must still expose Medusa DML/repository/module behavior upward
  -> must pass unchanged Medusa integration suites before becoming trusted
```

So "shared database layer" means shared tenant-aware storage infrastructure,
not one shared logical document schema for both Flarex custom data and Medusa
commerce internals.

## Cross-Domain Transactions

The hosted platform should not promise an automatic global transaction across
Flarex custom data and arbitrary Medusa module operations.

Medusa already has its own transaction and workflow boundaries:

- module service transactions;
- DML and repository behavior;
- Link behavior;
- workflow compensation;
- module-specific commerce invariants.

Flarex has its own executor transactions for custom application data. Trying
to make every mixed `ctx.db` plus `ctx.commerce` mutation share one low-level
transaction would create a brittle adapter layer and would blur responsibility
for commerce correctness.

Developer-facing mutation semantics should be:

```text
ctx.db only
  -> Flarex transaction

ctx.commerce only
  -> Medusa service transaction or Medusa workflow

ctx.db + ctx.commerce
  -> no implicit all-or-nothing global transaction
  -> use explicit commerce APIs, workflows, or outbox/event consistency
```

If custom behavior must be atomic with cart, checkout, inventory, payment, tax,
fulfillment, or order state, expose it as a Medusa commerce extension API or
workflow. If it is display data, metadata, or post-commit custom state, store
it in Flarex and connect it with commerce IDs and invalidation tokens.

Postgres document adapters and same-partition DO SQLite colocation can still
be explored as deployment-specific optimizations. They are not the default
developer contract and must not replace the rule that Medusa owns commerce
invariants.

## Sync And Live Queries

Flarex should own the generic sync engine, generated client APIs, and websocket
connection management. Medusa participates by emitting commerce dependency
tokens and invalidation events, not by exposing raw internal table watching.

Mixed queries can read from both custom Flarex tables and trusted Medusa
facades:

```ts
export const cartSummary = query.with(commerce)({
  args: { cartId: commerce.id("cart") },
  handler: async (ctx, args) => {
    const cart = await ctx.commerce.cart.retrieve(args.cartId)

    const giftWrap = await ctx.db
      .query("cartGiftWrap")
      .withIndex("by_cart", (q) => q.eq("cartId", args.cartId))
      .unique()

    return { cart, giftWrap }
  },
})
```

The sync engine records both dependency kinds:

```text
commerce:cart:{cartId}
flarex:cartGiftWrap:by_cart:{cartId}
```

Medusa services and workflows should publish invalidation tokens through an
outbox or event bridge after commits:

```text
Medusa cart mutation
  -> commerce:cart:{cartId}
  -> Flarex sync router reruns affected queries
  -> subscribed clients receive updated results
```

Catalog, order, customer, and admin list queries should use projections or
other derived read models where broad fanout would be too expensive. Projection
updates can be live and reactive, but they are still derived. Checkout,
payment, inventory reservation, and order creation must use authoritative
Medusa workflows and services.

## Runtime Topology

Target production shape:

```text
Frontend / app repository
  -> Medusa developer code
  -> generated metadata and user Worker bundle
  -> platform upload

Cloudflare dispatch Worker
  -> resolve tenant, deployment, and version
  -> invoke isolated user Worker

User Worker
  -> run custom functions, workflows, HTTP endpoints, and hooks
  -> call trusted platform APIs through restricted bindings

Trusted Medusa runtime
  -> real Medusa services and workflows
  -> authoritative Durable Objects
  -> D1 projections
  -> platform event/workflow infrastructure

Flarex sync/runtime services
  -> generic query subscriptions
  -> custom schema persistence
  -> commerce invalidation bridge
```

Cloudflare Workers for Platforms is the likely production primitive for this
layer. Local development can use generated Worker code and Miniflare-style
service bindings before the production upload path is implemented.

## Non-Goals For The Current Milestone

Do not implement this platform layer during the current Drizzle and Durable
Object migration milestone.

Current `CurrencyProofDO` and future aggregate-specific proof classes are
temporary runtime fixtures. They prove that unchanged Medusa persistence
behavior can execute atomically in Durable Object SQLite. They must not become
the permanent tenant-routing architecture.

The current milestone remains:

- preserve Medusa's actual module services and tests;
- finish Drizzle relational parity;
- add DO SQLite as an authoritative aggregate storage option;
- prove an atomic Cart-oriented DO persistence vertical slice without
  committing to Cart-per-DO as the final topology;
- keep MikroORM/Postgres working until replacement paths pass the same tests.

This roadmap should guide later product architecture, not distract from the
first serverless core milestone.

## Risks

- Custom schema compatibility must be strictly validated.
- User code isolation must prevent access to raw platform bindings and Medusa
  internals.
- Tenant scoping mistakes become high-severity data isolation bugs.
- Local dev must reuse the real platform runtime rather than a divergent fake.
- Custom workflows and HTTP endpoints must not bypass checkout, payment,
  inventory, or authorization invariants.
- Worker-compatible dependency analysis is required for uploaded user code.
- Commerce-specific APIs leaking into Flarex core would make Flarex harder to
  reuse and would blur the trusted Medusa boundary.
- Custom links to commerce resources must not become unvalidated writes into
  Medusa internal Link storage.
- Promising adapter-level transactions across arbitrary Flarex custom data and
  Medusa module operations would hide commerce invariants behind the wrong
  abstraction.

## Implementation Order

1. Complete the current Medusa core Cloudflare milestone.
2. Add tenant and deployment identifiers to storage/projection/DO addressing.
3. Build a minimal developer-code bundle and generated metadata format.
4. Run one custom HTTP endpoint through an isolated user Worker in local tests.
5. Attach one Flarex project to a hosted Medusa project in local development.
6. Add the Medusa commerce extension package that supplies `ctx.commerce`
   without adding commerce concepts to Flarex core.
7. Add custom schema support with safe compatibility validation and typed
   commerce ID validators.
8. Add commerce dependency tokens and an invalidation bridge into Flarex sync.
9. Add custom links to Medusa resources as Flarex-owned extension data.
10. Add explicit commerce extension APIs for custom behavior that must affect
    pricing, checkout, inventory, fulfillment, tax, payment, or order state.
11. Add outbox/event-backed Flarex hooks for post-commit custom behavior.
12. Add hooks and workflows after the isolation and storage boundaries are
   proven.
