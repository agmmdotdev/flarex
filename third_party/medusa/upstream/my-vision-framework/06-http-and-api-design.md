# HTTP and API Design

## Scope

The local Medusa 2.13.4 source contains approximately:

| API | Route files | HTTP handlers |
|---|---:|---:|
| Store API | 44 | 51 |
| Admin API | 240 | 379 |

The route functions are often thin. The larger workload is reproducing the
shared API infrastructure and domain behavior around them.

## Decision: Routes Are Typed Static Definitions

Routes should be registered explicitly and compiled into Worker routing tables.

```ts
export const createCartRoute = defineRoute({
  method: "POST",
  path: "/store/carts",

  auth: optionalCustomerAuth(),
  body: StoreCreateCart,
  query: selectParams(cartSelection),

  handler: async (ctx, request) => {
    const cart = await createCartWorkflow.run(ctx, {
      ...request.body,
      customerId: ctx.actor?.customerId,
    })

    return response.ok({
      cart: await cartQueries.retrieve(ctx, cart.id, request.query),
    })
  },
})
```

`defineRoute` is imported from the framework. It should:

- Infer body, params, query, and response types.
- Produce runtime validation metadata.
- Declare authentication and authorization requirements.
- Declare optional transaction behavior.
- Generate OpenAPI/SDK metadata.
- Compile to the selected HTTP router adapter.

## Proposed Route Contract

```ts
defineRoute({
  method,
  path,

  params,
  query,
  body,
  headers,

  auth,
  policies,
  transactional,
  rateLimit,

  responses,
  handler,
})
```

Not every route needs every property.

## Handler Contract

```ts
handler: async (
  ctx: RequestContext,
  request: {
    params: Params
    query: Query
    body: Body
    headers: Headers
  }
) => ApiResponse<ResponseBody>
```

The handler should not receive Express `req`, `res`, or `next`.

## Custom Routes

Users register custom routes through configuration:

```ts
export const customRoutes = defineRoutes([
  defineRoute({
    method: "GET",
    path: "/store/recommendations",
    query: RecommendationQuery,
    handler: async (ctx, request) => {
      return response.ok({
        products: await recommendationService.list(ctx, request.query),
      })
    },
  }),
])
```

```ts
export default defineCommerceConfig({
  routes: [customRoutes],
})
```

There is no runtime folder scanning. The application may organize files however
it wants, but definitions must ultimately be imported into configuration.

## Middleware and Policies

Avoid Express-style mutable middleware as the fundamental model.

Use typed request policies and lifecycle hooks:

```ts
defineRoute({
  auth: adminAuth(),
  policies: [
    can("product", "create"),
    requireSalesChannelAccess(),
  ],
  before: [attachPricingContext()],
  handler,
})
```

Low-level middleware can exist as an escape hatch, but core behavior should use
typed contracts so it remains portable and analyzable.

## Shared API Infrastructure Required

Before broad route implementation, build:

- Request parsing and validation.
- Authentication strategies.
- Actor/request context creation.
- Admin authorization and policies.
- Publishable key and sales-channel scoping.
- Field selection and relation expansion.
- Filtering, ordering, pagination, and search.
- Query/refetch helpers.
- Standard errors and response envelopes.
- Batch endpoint helpers.
- Upload abstraction.
- Idempotency-key handling.
- OpenAPI and SDK generation.

## Query Design

Medusa APIs heavily use field selection, relation filters, and refetching after
workflow writes. A reusable typed query contract is essential.

Example:

```ts
const cartSelection = defineSelection(cartSchema, {
  defaults: ["id", "currency_code", "region_id", "items.*"],
  allowed: ["*", "items.variant.product.*", "shipping_methods.*"],
})
```

```ts
await cartQueries.retrieve(ctx, cartId, {
  fields: request.query.fields,
})
```

The query layer must not expose arbitrary SQL or unrestricted relation graphs.
Store API selections especially need security-aware field and relation limits.

## Store API Strategy

Implement Store API first because it is smaller and proves the important
customer-facing commerce flows.

Recommended sequence:

1. Products, variants, collections, categories.
2. Regions, currencies, sales channels, publishable keys.
3. Cart create/retrieve/update and line items.
4. Pricing, promotions, inventory, and shipping options.
5. Payment collections.
6. Cart completion and orders.
7. Customer authentication and accounts.
8. Returns.

## Admin API Strategy

Do not implement all Admin API endpoints before the framework is proven.

Add Admin endpoints alongside each vertical module:

- Products and variants.
- Inventory and stock locations.
- Regions and sales channels.
- Shipping configuration.
- Orders.
- Customers.
- Store settings.

Later modules include promotions, advanced pricing, returns, exchanges, claims,
order edits, RBAC management, workflow inspection, and provider configuration.

## Dashboard Strategy

Medusa's dashboard uses `@medusajs/js-sdk` and expects detailed Admin API
compatibility. Reusing it is possible only for endpoints and semantics that the
new framework supports.

Recommendation:

- Deploy dashboard assets separately from API Workers.
- Initially provide a small native admin application or a constrained Medusa
  dashboard compatibility mode.
- Maintain an endpoint compatibility matrix.
- Do not make full dashboard compatibility a prerequisite for the first
  framework release.

## API Generation

Typed route definitions should generate:

- Worker routing registrations.
- Runtime validators.
- OpenAPI documents.
- TypeScript SDK methods.
- API contract tests.
- Optional Medusa compatibility reports.

## Open Questions

- Should the framework use a small existing Worker router or provide its own
  compiled matcher?
- Which validation library best balances bundle size, inference, and generated
  OpenAPI support?
- How closely should error payloads match Medusa?
