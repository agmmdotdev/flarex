# Framework API Sketches

These sketches collect the proposed framework authoring experience in one
place. They are design targets, not finalized TypeScript signatures.

The exact APIs should be validated while building the first product/cart
vertical slice.

## Design Requirements

Definitions should be:

- Explicitly imported and registered.
- Fully typed.
- Statically analyzable.
- Validatable before deployment.
- Tree-shakable.
- Usable in deterministic tests without Cloudflare.
- Portable across supported runtime adapters where practical.

## Application Configuration

`commerce.config.ts` owns commerce definitions:

```ts
export default defineCommerceConfig({
  modules: [
    productModule,
    cartModule,
    orderModule,
  ],

  services: [
    recommendationService,
  ],

  routes: [
    recommendationRoutes,
  ],

  workflows: [
    customOrderWorkflow,
  ],

  jobs: [
    abandonedCartJob,
  ],

  consumers: [
    orderCreatedConsumer,
  ],

  overrides: {
    [productTokens.service.key]: customProductService,
  },

  cloudflare: {
    durableObjects: [inventoryCoordinator],
    agents: [shoppingAgent],
  },
})
```

`vite.config.ts` owns dev/build integration:

```ts
import { defineConfig } from "vite"
import { commerce } from "@commerce/vite"

export default defineConfig({
  plugins: [
    commerce({
      config: "./commerce.config.ts",
      target: "cloudflare",
    }),
  ],
})
```

Package scripts can stay familiar:

```json
{
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

The Vite plugin loads `commerce.config.ts`, generates the Worker artifacts, and
coordinates the local Worker dev runtime.

## Tokens

```ts
export const productTokens = defineTokens("product", {
  repository: token<ProductRepository>(),
  service: token<ProductService>(),
})
```

Alternative explicit keys:

```ts
export const productRepositoryToken =
  token<ProductRepository>("product.repository")
```

Tokens should expose a stable serializable key plus their compile-time type.

## Providers

Low-level factory provider:

```ts
provider({
  deps: {
    repo: productTokens.repository,
  },
  create: ({ repo }) => new CustomProductService(repo),
  lifetime: "singleton",
})
```

Existing value:

```ts
value(customLogger)
```

Provider graph rules:

- Dependencies must be tokens.
- Missing or circular dependencies fail during compilation.
- Overrides must satisfy the target token.
- Request-scoped dependencies cannot be injected into singleton providers.

## Services

```ts
export const productService = defineService({
  token: productTokens.service,

  deps: {
    repo: productTokens.repository,
    events: coreTokens.eventBus,
  },

  create: ({ repo, events }) => ({
    async retrieve(ctx, input: { id: string }) {
      return repo.retrieve(ctx, input.id)
    },

    async create(ctx, input: CreateProductInput) {
      const product = await repo.create(ctx, input)
      await events.stage(ctx, "product.created", { id: product.id })
      return product
    },
  }),
})
```

The execution context is passed to operations, not injected into the service
factory.

## Modules

```ts
export const productModule = defineModule({
  name: "product",

  tokens: productTokens,
  providers: [
    productRepository,
    productService,
  ],

  routes: [
    storeProductRoutes,
    adminProductRoutes,
  ],

  workflows: [
    createProductWorkflow,
    updateProductWorkflow,
  ],

  exports: [
    productTokens.service,
  ],
})
```

Modules provide registration and ownership boundaries. They should not create
hidden runtime containers.

## Repositories

Framework-neutral contract:

```ts
export interface ProductRepository {
  retrieve(ctx: OperationContext, id: string): Promise<Product>
  list(ctx: OperationContext, query: ProductQuery): Promise<Page<Product>>
  create(ctx: OperationContext, input: CreateProductRecord): Promise<Product>
  update(ctx: OperationContext, input: UpdateProductRecord): Promise<Product>
  delete(ctx: OperationContext, id: string): Promise<void>
}
```

Drizzle implementation:

```ts
export const productRepository = defineRepository({
  token: productTokens.repository,
  deps: {
    database: coreTokens.database,
  },
  create: ({ database }) => createDrizzleProductRepository(database),
})
```

Repositories only handle persistence. Domain decisions belong in services or
workflows.

## Routes

```ts
export const createCartRoute = defineRoute({
  id: "store.cart.create",
  method: "POST",
  path: "/store/carts",

  auth: optionalCustomerAuth(),
  body: StoreCreateCart,
  query: selectParams(cartSelection),

  responses: {
    200: StoreCartResponse,
  },

  handler: async (ctx, request) => {
    const cart = await createCartWorkflow.run(ctx, {
      ...request.body,
      customerId: ctx.actor?.customerId,
      idempotencyKey: ctx.idempotencyKey,
    })

    return response.ok({
      cart: await cartQueries.retrieve(ctx, cart.id, request.query),
    })
  },
})
```

Route group:

```ts
export const storeCartRoutes = defineRoutes({
  prefix: "/store/carts",
  routes: [
    createCartRoute,
    retrieveCartRoute,
    addCartLineItemRoute,
  ],
})
```

## Authentication and Policies

```ts
defineRoute({
  auth: adminAuth({
    strategies: ["session", "bearer", "api-key"],
  }),

  policies: [
    can("product", "create"),
    requireSalesChannelAccess(),
  ],
})
```

Auth resolves the actor and authentication metadata into `RequestContext`.
Policies authorize an already-authenticated actor.

## Workflows

```ts
export const createCartWorkflow = defineWorkflow({
  name: "cart.create",
  input: CreateCartInput,
  output: Cart,

  run: async (workflow, input) => {
    const [region, customer] = await workflow.parallel([
      workflow.step(findRegionStep, { id: input.regionId }),
      workflow.step(findCustomerStep, { id: input.customerId }),
    ])

    await workflow.hook("validate", { input, region, customer })

    const cart = await workflow.step(createCartStep, {
      input,
      region,
      customer,
    })

    await workflow.step(updateCartTaxLinesStep, { cartId: cart.id })
    await workflow.step(emitCartCreatedStep, { cartId: cart.id })

    await workflow.hook("cartCreated", { cart })

    return cart
  },
})
```

Workflow invocation:

```ts
await createCartWorkflow.run(ctx, input, {
  executionId: ctx.idempotencyKey,
})
```

The runtime should generate an execution ID when none is supplied. Generated IDs
create distinct executions; deterministic IDs provide command-level
idempotency.

## Steps

```ts
export const createCartStep = defineStep({
  name: "cart.create-record",

  retry: {
    attempts: 3,
    backoff: "exponential",
  },

  run: async (ctx, input: CreateCartRecord) => {
    const cart = await cartService.create(ctx, input)

    return stepResult({
      output: cart,
      compensate: { cartId: cart.id },
    })
  },

  compensate: async (ctx, input: { cartId: string }) => {
    await cartService.delete(ctx, input)
  },
})
```

Steps must be idempotent or guarded by stored execution state. Compensation is
also retryable and must be idempotent.

## Hooks

Built-in workflows expose named extension points:

```ts
export const validateCustomCartData = attachWorkflowHook({
  workflow: createCartWorkflow,
  hook: "validate",
  name: "validate-custom-cart-data",

  run: async (ctx, input) => {
    // Application-specific validation.
  },
})
```

Hooks should compile into workflow steps with deterministic ordering, not mutate
global workflow definitions at runtime.

## Events

```ts
export const orderCreated = defineEvent({
  name: "order.created",
  payload: OrderCreatedPayload,
})
```

```ts
await events.stage(ctx, orderCreated, {
  orderId: order.id,
})
```

`stage` indicates the event participates in the active workflow/outbox group.
An immediate emission API may exist but should be used deliberately.

## Consumers

```ts
export const orderCreatedConsumer = defineConsumer({
  name: "send-order-confirmation",
  event: orderCreated,

  retry: {
    attempts: 5,
  },

  run: async (ctx, event) => {
    await notificationService.sendOrderConfirmation(ctx, event.data)
  },
})
```

The runtime derives a consumer idempotency key from event ID and consumer name.

## Jobs

```ts
export const abandonedCartJob = defineJob({
  name: "cart.abandoned.scan",
  schedule: every("1 hour"),
  concurrency: "forbid",

  run: async (ctx) => {
    await abandonedCartWorkflow.start(ctx, {
      before: ctx.scheduledAt,
    })
  },
})
```

## Durable Objects and Agents

```ts
export const inventoryCoordinator = defineDurableObject({
  name: "InventoryCoordinator",
  class: InventoryCoordinator,
})
```

```ts
export const shoppingAgent = defineAgent({
  name: "ShoppingAgent",
  class: ShoppingAgent,
})
```

These helpers register Cloudflare-native classes for generated exports,
bindings, and migration checks. They should not hide Cloudflare's class APIs.

## Testing

Every definition should be usable in a Vendure-style explicit test environment.
The test environment receives the same config graph as production, installs core
modules automatically, and lets tests override individual providers by token.

Module tests should use injected commerce system services instead of Cloudflare
mocks:

```ts
const env = await createCommerceModuleTestEnvironment({
  config: defineCommerceTestConfig({
    modules: [blogModule],
    database: sqliteTestDatabase(),
    overrides: {
      [paymentTokens.provider.key]: fakePaymentProvider,
    },
  }),
})

const response = await env.store.request("/store/carts", {
  method: "POST",
  body: createCartInput,
})

expect(env.events.emitted("cart.created")).toHaveLength(1)
```

Runtime tests should use the real Cloudflare worker-pool adapter:

```ts
const env = await createCommerceWorkerTestEnvironment({
  config: commerceTestConfig,
})

await env.worker.fetch("/store/carts", {
  method: "POST",
  body: JSON.stringify(createCartInput),
})

await env.queues.get("events").expectAcked()
```

This split means we abstract commerce services such as events, workflows, jobs,
locks, and idempotency, but still test the Cloudflare implementations in real
workerd. The framework remains Cloudflare-first without forcing every service
test to boot Cloudflare.

## Unresolved API Questions

- Should workflow composition use imperative `await workflow.step(...)`, a
  declarative graph builder, or support both?
- Should token keys be symbols internally, strings, or typed string objects?
- Should route responses require explicit schemas for every status?
- Should hooks be registered only through config, or also through module
  definitions?
- How much adapter-specific configuration belongs directly on definitions?
