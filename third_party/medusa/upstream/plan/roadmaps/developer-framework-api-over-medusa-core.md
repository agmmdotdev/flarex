# Developer Framework API Over Medusa Core

## Purpose

This roadmap reconciles two directions that currently appear mixed together:

1. The active Medusa fork refactor.
2. The future developer-facing framework API sketched in
   `my-vision-framework/`.

The current fork work remains an in-place Medusa refactor. We preserve Medusa
modules, DML models, workflows, services, API behavior, provider contracts, and
tests while making the runtime Cloudflare-compatible.

The `my-vision-framework/` design should be treated as the future
developer-facing authoring API and compiler surface, not as a replacement for
the trusted Medusa core during the current milestone.

## Core Separation

There are three different layers.

```text
developer framework API
  -> static definitions and generated manifests
  -> restricted runtime context
  -> trusted Medusa core services and workflows
```

### 1. Internal Medusa Core

This is the trusted commerce implementation maintained by the fork.

It includes:

- Medusa module services.
- Medusa DML and internal schema compilation.
- Core workflows and compensation behavior.
- Store and Admin API behavior.
- Provider contracts.
- Persistence adapters such as MikroORM/Postgres, Drizzle/SQLite, D1, and
  Durable Object SQLite.
- Runtime infrastructure for events, workflows, locks, jobs, queues, and HTTP.

This layer is refactored in place. It is not replaced by a parallel commerce
service hierarchy.

### 2. Runtime Adapter Layer

This layer removes Node-only runtime assumptions from the trusted Medusa core.

It owns:

- Static discovery manifests.
- HTTP runtime adapters.
- Request and response adaptation.
- Drizzle/D1/Durable Object persistence adapters.
- Cloudflare Queues event adapters.
- Cloudflare Workflow or Durable Object workflow execution adapters.
- Runtime-safe import boundaries.
- Worker bundle validation.

This layer is the bridge between Medusa internals and Cloudflare deployment.

### 3. Developer Framework API

This is the future product-facing API inspired by `my-vision-framework/` and
the hosted programmable Medusa roadmap.

It may expose APIs such as:

```ts
export default defineCommerceConfig({
  routes: [customRoutes],
  services: [customServices],
  workflows: [customWorkflows],
  hooks: [customHooks],
})
```

and:

```ts
export const createWishlistRoute = defineRoute({
  method: "POST",
  path: "/store/wishlists",
  body: CreateWishlistBody,
  handler: async (ctx, request) => {
    const customer = await ctx.auth.customer()

    await ctx.db.insert("wishlists", {
      customerId: customer.id,
      productId: request.body.productId,
    })

    return response.ok({})
  },
})
```

This API is for developer ergonomics, static analysis, and hosted platform
deployment. It should not expose raw Medusa internals.

The general programmable runtime should remain Flarex-owned and
commerce-neutral. Flarex core should provide the Convex-like primitives:

- `defineSchema`, `defineTable`, validators, and generated data-model types;
- `query`, `mutation`, `action`, HTTP functions, schedules, and workflows;
- isolated user-code execution;
- `ctx.db`, `ctx.auth`, `ctx.scheduler`, `ctx.storage`, and sync primitives.

Commerce should be added through a Medusa-specific extension package rather
than built into Flarex core:

```text
flarex core
  -> general application database, functions, sync, and code generation

@medusajs/flarex-commerce
  -> commerce validators such as commerce IDs
  -> ctx.commerce types
  -> trusted Medusa facade syscalls
  -> commerce invalidation tokens
  -> commerce hooks and events
```

Generic Flarex applications must be able to run without Medusa. A hosted
Medusa project composes Flarex with the Medusa commerce extension at the
platform root.

## Important Decision

Do not use the `my-vision-framework/` sketches as a reason to abandon the
current in-place Medusa refactor.

The sketches are valuable because they describe a cleaner future authoring
surface:

- explicit `defineCommerceConfig`;
- typed `defineRoute`;
- typed `defineService`;
- typed `defineWorkflow`;
- typed tokens and provider overrides;
- generated manifests;
- Cloudflare binding generation;
- restricted `ctx.commerce` and `ctx.db` APIs;
- Convex-style local development and deployment ergonomics.

But those APIs should compile into the same runtime bridge that the Medusa core
will use. They should not create a second commerce implementation.

## Static Manifest As The Convergence Point

The shared convergence point should be a static manifest format.

Current Medusa source:

```text
packages/medusa/src/api/**/route.ts
packages/medusa/src/api/**/middlewares.ts
```

can become:

```text
filesystem discovery at build time
  -> static Medusa route manifest
  -> runtime-neutral route descriptors
  -> Express adapter, Hono adapter, Nitro adapter, or Worker adapter
```

Future developer APIs:

```ts
defineRoute(...)
defineRoutes(...)
defineCommerceConfig(...)
```

can become:

```text
typed definitions
  -> static developer route manifest
  -> same runtime-neutral route descriptors
  -> same HTTP runtime adapters
```

This prevents two routing systems from diverging.

## HTTP Runtime Position

Hono, Nitro, or another Worker router can be used under the hood, but they must
not become the developer-facing contract.

Preferred developer contract:

```ts
handler: async (ctx, request) => {
  return response.ok(data)
}
```

Avoid exposing adapter-specific contracts:

```ts
handler: async (honoContext) => {}
handler: async (expressReq, expressRes) => {}
```

The framework API owns the request context. Hono/Nitro/Express/Worker Fetch are
adapter implementations.

## Medusa Service Access

Developer code should not receive the raw Medusa container.

Avoid:

```ts
ctx.container.resolve("cartModuleService")
req.scope.resolve("productModuleService")
```

Preferred:

```ts
await ctx.commerce.cart.retrieve(cartId)
await ctx.commerce.product.list(query)
await ctx.commerce.workflow.run("completeCart", input)
```

Internally, those facades may call real Medusa services and workflows:

```text
ctx.commerce.cart.create(...)
  -> trusted commerce facade
  -> Medusa cart workflow or module service
  -> Medusa persistence/runtime adapters
```

This keeps developer APIs simple while preserving the real Medusa behavior
underneath.

`ctx.commerce` is not part of Flarex core. It is supplied by the Medusa
commerce extension when a Flarex project is attached to a hosted Medusa
project. The extension maps developer-facing commerce calls to trusted
platform syscalls, and those syscalls call real Medusa services and workflows.

```text
user Worker
  -> ctx.commerce.cart.retrieve(...)
  -> commerce syscall
  -> trusted Medusa facade
  -> real Medusa service or workflow
  -> Medusa persistence/runtime adapter
```

The backend is platform-owned, but the package boundary still matters: it keeps
Flarex reusable and prevents Medusa-specific imports from entering the generic
Flarex SDK or runtime.

## Custom Schema Boundary

Developer custom schema is separate from internal Medusa schema.

Internal Medusa schema:

- DML models.
- Module migrations.
- Platform-owned migration strategy.
- Drizzle/MikroORM transition.
- Commerce invariants.

Developer schema:

- Convex-style declarative schema.
- Platform-managed compatibility checks.
- No direct Medusa module migrations.
- Tenant/deployment scoped storage.
- Restricted `ctx.db` access.

Developer schema must not mutate internal Medusa module tables directly unless
the platform exposes an explicit safe extension point.

Every hosted Medusa project may have one attached Flarex project for custom
application data and user code. That does not make Flarex the internal Medusa
database. The first boundary is:

```text
ctx.db
  -> Flarex custom application tables

ctx.commerce
  -> trusted Medusa commerce facade
  -> real Medusa modules and workflows
```

Flarex may become an internal Medusa persistence adapter only if unchanged
Medusa module integration suites pass through that adapter. Until then, it is
the programmable extension database/runtime layer around Medusa, not a
replacement for Medusa core storage.

When this document says Flarex can share storage with Medusa, it means the
low-level platform substrate, not the developer-facing document API:

```text
ctx.db
  -> Flarex document/custom schema for app data
  -> may reference Medusa resources by typed commerce IDs
  -> does not implement Medusa module repositories

Flarex storage runtime
  -> resolves tenant/project/deployment storage locations
  -> provides DO/D1/SQLite/Postgres binding and partition metadata
  -> can be consumed by Medusa persistence adapters

Medusa adapter
  -> maps Medusa DML/repository behavior to the selected storage backend
  -> owns commerce schema, migrations, relation semantics, and tests
```

This keeps Flarex generic while still letting the hosted product share
multitenant storage routing and deployment infrastructure.

## Custom Links To Commerce Resources

Medusa's internal Link system remains the core commerce relationship mechanism
between Medusa modules. Developer custom data should use a Flarex-owned link
model that references Medusa resources by typed commerce IDs.

Example:

```ts
export default defineSchema({
  cartGiftWrap: defineTable({
    cartId: commerce.id("cart"),
    message: v.string(),
    style: v.string(),
  }).index("by_cart", ["cartId"]),
})
```

This is a custom extension link. It does not write into Medusa's internal Link
tables and does not mutate the Cart module schema.

Developer queries can compose Medusa commerce data with Flarex custom data:

```ts
export const cartWithGiftWrap = query.with(commerce)({
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

Relationship ownership rules:

- Custom-to-custom relationships use normal Flarex IDs and indexes.
- Custom-to-Medusa relationships use typed commerce IDs and Flarex-owned
  custom link tables.
- Medusa-to-Medusa relationships remain Medusa Link/internal module behavior.
- Custom data that affects price, checkout, inventory, fulfillment, tax,
  payment, or order state must cross a commerce facade or workflow, not a raw
  Flarex write.

Not every custom link needs a Medusa transaction. Display and metadata
extensions can live entirely in Flarex:

```text
cart note
gift message that does not affect price
wishlist row
admin CRM note
product annotation
```

Commerce-affecting extensions must become Medusa-owned behavior:

```text
gift wrap that changes price
custom checkout validation
custom discount
inventory reservation rule
fulfillment, tax, or payment behavior
```

Those cases should be exposed as explicit commerce facade APIs or hooks:

```ts
await ctx.commerce.cart.addGiftWrap({
  cartId,
  message,
  style,
})
```

Internally, Medusa can store the result in a Medusa extension module, a
Medusa-owned extension table, Link-managed relationship, workflow state, or
cart/order adjustment. The developer-facing Flarex write must not need to
join arbitrary Medusa module transactions.

Post-commit extensions should use events and hooks:

```text
Medusa order placed
  -> outbox event
  -> Flarex hook
  -> loyalty points or CRM custom data write
```

This keeps the rule simple:

```text
Flarex extends the app.
Medusa extends commerce.
Outbox connects them.
```

## Transaction Semantics Across Flarex And Medusa

Do not promise one generic transaction across arbitrary `ctx.db` and
`ctx.commerce` operations.

Medusa already owns module-service transaction boundaries, DML/repository
behavior, Link behavior, workflow compensation, and commerce invariants.
Flarex owns custom application data and its own executor transactions. Forcing
both into a generic adapter-level transaction would create a hybrid database
layer that neither Medusa nor Flarex naturally owns.

Developer mutation semantics should be explicit:

```text
ctx.db only
  -> Flarex transaction

ctx.commerce only
  -> Medusa service transaction or workflow

ctx.db + ctx.commerce
  -> no automatic global transaction
  -> use a commerce facade, workflow, or outbox/event boundary
```

If an extension must be committed atomically with commerce behavior, it belongs
behind a Medusa commerce facade or workflow, not as an arbitrary Flarex custom
table write. If extension data can lag or be rebuilt, store it in Flarex and
connect it through commerce IDs, dependency tokens, and outbox events.

A future shared Postgres transaction adapter may be useful for a
Postgres-deployment mode, and a future same-partition DO SQLite transaction may
be useful for explicitly colocated extension data. Neither should be the
default contract for developer code. The default product contract is explicit
commerce APIs for commerce-affecting behavior and event-driven consistency for
post-commit extension behavior.

## Sync And Query Invalidation

Flarex should own the generic sync engine and websocket protocol. Medusa should
not expose raw table watching to that engine. Instead, Medusa facade reads
should emit dependency tokens that Flarex can subscribe to alongside normal
Flarex database read sets.

```text
client useQuery(api.cart.get, { cartId })
  -> Flarex sync connection
  -> isolated user query
  -> ctx.commerce.cart.retrieve(cartId)
  -> trusted Medusa facade returns data and dependency token
  -> sync subscription records commerce:cart:{cartId}
```

When Medusa commits a relevant change:

```text
Medusa service/workflow commit
  -> outbox/invalidation event
  -> commerce:cart:{cartId}
  -> Flarex sync router reruns subscribed queries
  -> websocket pushes the updated result
```

A mixed query can therefore depend on both authority domains:

```text
commerce:cart:{cartId}
flarex:cartGiftWrap:by_cart:{cartId}
```

If either the Medusa cart or the Flarex custom link changes, the query reruns.
Broad product, order, customer, and admin list views should use projections or
other derived read models rather than subscribing to every internal Medusa row.
Checkout and other correctness paths must still call authoritative Medusa
workflows and services.

## Tenant And Deployment Context

The developer framework API must assume hosted platform scoping from the start,
even if the current milestone does not implement the hosted runtime yet.

Every developer runtime operation should eventually carry:

```text
tenant_id
deployment_id
environment
deployment_version
```

The restricted context should carry these values. User code should not manually
construct Durable Object names, D1 tenant predicates, or raw binding access.

## What This Means For The Current HTTP Bootstrap Work

The current HTTP bootstrap refactor should focus on Medusa first:

- Preserve current Medusa route files and middleware behavior.
- Extract route discovery output into static descriptors.
- Keep existing handlers working.
- Add an adapter boundary around registration and execution.
- Keep Express working while adding a Worker-compatible path.
- Treat Express middleware shape as adapter-specific. The shared boundary is
  the Medusa HTTP resource model and semantics, not `(req, res, next)` as the
  permanent portable API.

The future developer route API should target the same descriptor and adapter
boundary later.

This means the HTTP direction is:

```text
Medusa filesystem route conventions
  -> build-time/static manifest
  -> runtime-neutral Medusa route descriptors
  -> HTTP adapter
```

and later:

```text
defineRoute API
  -> build-time/static manifest
  -> runtime-neutral developer route descriptors
  -> same HTTP adapter family
```

The first current-milestone HTTP slice is not a Hono or Nitro rewrite. It is
to make the existing Express path consume an adapter boundary:

```text
ApiLoader discovery output
  -> Medusa HTTP resource descriptors
  -> ExpressHttpAdapter
  -> unchanged Express behavior
```

Only after that should the Cloudflare/Hono/Nitro adapter consume the same
descriptors.

## What This Means For Services

The current Medusa module services remain the source of commerce behavior.

The developer-facing `defineService` API is useful for custom application
services, but it should not replace Medusa core module services during the
current milestone.

Good use:

```text
custom recommendation service
custom wishlist service
custom storefront endpoint
custom workflow hook
```

Bad use during the current milestone:

```text
rewrite product service as a new defineService service
rewrite cart service as a new defineService service
rewrite order service as a new defineService service
```

Core commerce services should be refactored underneath their existing Medusa
contracts first. Developer services can call restricted commerce facades.

## What This Means For Workflows

Medusa workflows and compensation semantics remain the trusted internal model.

The future `defineWorkflow` API can be a cleaner authoring surface for custom
developer workflows, but it must not bypass Medusa's checkout, payment,
inventory, or order invariants.

Developer workflows should call:

```ts
await ctx.commerce.workflow.run("completeCart", input)
```

or a typed generated equivalent, instead of resolving and invoking arbitrary
internal workflow functions.

## Compatibility Principle

The fork should preserve Medusa behavior internally while improving the
developer surface externally.

```text
internal compatibility
  -> unchanged Medusa module and integration tests

external compatibility
  -> Store/Admin API behavior where promised

developer platform compatibility
  -> generated APIs, custom schema, functions, routes, workflows, hooks
```

These are related but not the same test target.

## Non-Goals For The Current Milestone

Do not implement the developer framework API during the current Drizzle,
Durable Object, and HTTP bootstrap milestone.

Do not:

- Replace Medusa services with new `defineService` services.
- Replace Medusa workflows with new `defineWorkflow` workflows.
- Move custom schema into Medusa module migrations.
- Expose raw Medusa containers to developer code.
- Build a new Hono application that reimplements Medusa routes by hand.
- Treat `my-vision-framework/` as the active implementation source.

The current milestone remains:

- preserve Medusa's real module services and tests;
- make persistence adapter-driven;
- finish Drizzle relational parity;
- prove Durable Object SQLite where it matters;
- extract static discovery and HTTP adapter boundaries;
- keep Node/MikroORM/Postgres working until replacement paths pass the same
  behavioral tests.

## Future Adoption Sequence

The developer framework API should be adopted only after the core runtime
boundary is stable enough to host it.

Recommended sequence:

1. Finish the current Medusa core portability milestone.
2. Define the static manifest shape for Medusa HTTP resources.
3. Make Express consume that manifest without changing behavior.
4. Add a Worker/Hono/Nitro adapter that consumes the same manifest.
5. Add a small `defineRoute` prototype that emits the same manifest shape.
6. Attach a Flarex project to a hosted Medusa project in local development.
7. Add a Medusa commerce extension package that supplies `ctx.commerce`
   without adding commerce concepts to Flarex core.
8. Add restricted `ctx.commerce` facade calls into real Medusa services.
9. Add custom schema and `ctx.db` only after tenant/deployment scoping is
   explicit.
10. Add commerce dependency tokens and invalidation events into Flarex sync.
11. Add Flarex-owned custom links to Medusa resources through typed commerce
   IDs.
12. Add custom workflows/hooks once workflow isolation and invariant boundaries
   are proven.

## Summary

The clean organization is:

```text
Medusa core refactor now
developer framework API later
static manifests and restricted contexts as the bridge
```

This keeps the good parts of the `my-vision-framework/` design without
derailing the current fork into a parallel rewrite. The future API should make
Medusa easier and safer to program, but the trusted commerce behavior should
continue to come from the refactored Medusa core.
