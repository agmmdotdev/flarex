# Dependency Injection, Context, and Transactions

## Decision: Typed Static DI

Awilix should be replaced with an explicit typed provider graph.

Medusa commonly resolves dependencies from `req.scope` and injects constructor
objects by registration name. That is flexible, but it relies on runtime
registration, naming conventions, and dynamic behavior that are less suitable
for a small Worker runtime.

The new framework should keep powerful scoping and overrides while making
dependencies explicit and statically analyzable.

## Tokens

```ts
export const productTokens = {
  repository: token<ProductRepository>("product.repository"),
  service: token<ProductService>("product.service"),
}
```

Tokens provide:

- Stable registration identities.
- Type inference for dependencies.
- Override points.
- Build-time graph validation.
- No constructor parameter-name guessing.

## Service Definitions

`defineService` should support services with any dependency shape:

```ts
export const productService = defineService({
  token: productTokens.service,

  deps: {
    repo: productTokens.repository,
    events: coreTokens.eventBus,
  },

  create: ({ repo, events }) => ({
    async list(ctx, input) {
      return repo.find(ctx, input)
    },

    async create(ctx, input) {
      const product = await repo.create(ctx, input)
      await events.emit(ctx, {
        name: "product.created",
        data: { id: product.id },
      })
      return product
    },
  }),
})
```

`deps` is optional. A service may depend on repositories, services, providers,
configuration, loggers, or nothing.

```ts
export const slugService = defineService({
  token: slugTokens.service,
  create: () => ({
    create(value: string) {
      return normalizeSlug(value)
    },
  }),
})
```

## Low-Level Provider API

`provider()` is the lower-level DI primitive used when `defineService` is not
appropriate:

```ts
provider({
  deps: { repo: productTokens.repository },
  create: ({ repo }) => new CustomProductService(repo),
})
```

Use `value()` for an existing instance or immutable value.

```ts
value(customLogger)
```

The distinction matters:

- A value is already constructed.
- A provider describes construction and dependencies.
- A service definition adds service-oriented metadata and conventions.

## Overrides

```ts
export default defineCommerceConfig({
  modules: [productModule],

  overrides: {
    [productTokens.service.key]: customProductService,
  },
})
```

The compiler should validate that an override provides the correct token type
and that all dependencies are available.

## Scopes

Recommended scopes:

- `singleton`: immutable or application-wide service instance.
- `request`: created for one HTTP request.
- `workflow`: created for one workflow run when required.
- `transient`: created on every resolution.

Most domain services should be stateless singletons. Request and transaction
state should be passed through the operation context rather than captured inside
service construction.

## Decision: Context Is a Method Parameter

Do not inject `sharedContext` into `create({ ... })`.

Bad:

```ts
defineService({
  create: ({ repo, sharedContext }) => ({
    list(input) {
      return repo.find(sharedContext, input)
    },
  }),
})
```

This binds a service instance to one request/transaction and prevents safe
singleton reuse.

Preferred:

```ts
defineService({
  deps: { repo: productTokens.repository },
  create: ({ repo }) => ({
    list(ctx, input) {
      return repo.find(ctx, input)
    },
  }),
})
```

The context is explicit, testable, and visible in the service contract.

## Transaction Model

`ctx.db` represents the currently active database session:

- Outside a transaction, it is the normal database session.
- Inside a transaction, it is the transaction-scoped session.

```ts
await transactional(ctx, async (txCtx) => {
  await productService.create(txCtx, input)
  await inventoryService.attach(txCtx, inventoryInput)
})
```

Services called with `txCtx` automatically participate because their
repositories use `ctx.db`.

### Route-Level Transactions

Routes can declare a short transaction boundary:

```ts
defineRoute({
  method: "POST",
  path: "/admin/example",
  transactional: true,
  handler: async (ctx, input) => {
    // ctx.db is transactional here
  },
})
```

### Service-Level Transactions

Service methods still need a transaction helper when the method itself promises
an atomic business operation and can be called outside a transactional route.

Do not make every service method automatically transactional.

### Workflow Transactions

A durable workflow is not one database transaction. Each step may open a short
transaction. Compensation handles reversal across completed steps.

## Medusa Comparison

Medusa's `@MedusaContext`, `@InjectManager`, and
`@InjectTransactionManager` decorators hide context positioning and manager
selection. The new framework should preserve the useful behavior but make the
context explicit instead of relying on decorator metadata and wrapped methods.
