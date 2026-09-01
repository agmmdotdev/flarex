# Compatibility and Testing

## Compatibility Is a Product Contract

Do not describe the framework as Medusa-compatible without a versioned,
test-backed compatibility definition.

Compatibility should be tracked separately for:

- Store API endpoints.
- Admin API endpoints.
- Authentication.
- Query and field-selection behavior.
- Response and error shapes.
- Domain events.
- Workflow behavior.
- Extension APIs.
- Dashboard support.
- Provider integrations.

## Compatibility Levels

Suggested labels:

- **Compatible**: intended to match Medusa behavior and covered by contract
  tests.
- **Equivalent**: different API or implementation with the same commerce
  capability.
- **Partial**: supported with documented limitations.
- **Unsupported**: intentionally omitted.
- **Planned**: accepted but not implemented.

## Test Layers

The test strategy should copy Vendure's explicit test-environment shape, not
Vendure's Nest/TypeORM implementation. A test receives a complete typed config,
boots an environment, exposes admin/store clients and service resolution, and
then tears the environment down.

Core commerce modules are included by the framework by default in tests, just
like in production. Test configs should only list custom modules, overrides,
providers, and database/runtime choices.

### Definition Tests

Validate:

- Duplicate tokens and route names.
- Missing dependencies.
- Invalid overrides.
- Binding collisions.
- Invalid workflow graphs.
- Durable Object migration-sensitive changes.

### Unit Tests

Test pure domain logic, validation, query planning, and small helpers without a
runtime.

### Module Contract Tests

Each repository/provider implementation must pass the same behavioral contract
tests.

Examples:

- D1 product repository.
- Hyperdrive/Postgres product repository.
- In-memory test product repository.

### Module Environment Tests

Use `createCommerceModuleTestEnvironment()` for most service and module tests.
This environment should not require Cloudflare's worker pool.

It should provide:

- The same explicit config graph used in production.
- Automatically installed core modules unless disabled intentionally.
- In-memory or SQLite-backed repositories.
- In-memory `eventBus`.
- Fake clock and deterministic `jobScheduler`.
- Deterministic inline `workflowEngine`.
- Explicit provider overrides for payment, email, external APIs, and AI.
- Typed `resolve(token)` and `createScope(...)` helpers.

This is where normal service behavior is tested:

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

const scope = env.createScope({ actor: adminActor })
const carts = scope.resolve(cartTokens.cartService)

await carts.create(scope.ctx, input)

expect(env.events.emitted()).toContainEqual({
  type: "cart.created",
})
```

### Workflow Tests

Use a deterministic inline workflow runtime to test:

- Step order and parallel dependencies.
- Stored outputs.
- Compensation order.
- Retry behavior.
- Permanent failures.
- Cancellation.
- Event grouping.
- Nested workflows.
- Idempotent re-entry.

### Cloudflare Worker-Pool Tests

Use `createCommerceWorkerTestEnvironment()` for tests that must prove the
Cloudflare implementation is real. This should run through
`@cloudflare/vitest-pool-workers`, not through hand-written Cloudflare mocks.

Run worker-pool integration tests for:

- Worker routing.
- Bindings.
- Queues.
- Durable Objects.
- Cloudflare Workflows.
- D1/R2 where enabled.
- `ctx.waitUntil`.
- Cron/scheduled events.
- Runtime module compatibility.

These tests should focus on framework adapters and runtime wiring, not every
domain permutation. Domain behavior belongs in module and workflow tests first.

### Database Initializer Registry

Mirror Vendure's initializer idea for local and CI speed:

```ts
registerDatabaseInitializer("sqlite", new SqliteInitializer(".commerce-test"))
registerDatabaseInitializer("d1", new D1Initializer({ migrationsDir: "drizzle" }))
registerDatabaseInitializer("postgres", new PostgresInitializer())
```

The initializer contract should be small:

```ts
export interface TestDatabaseInitializer<TOptions> {
  init(testFileName: string, options: TOptions): Promise<TOptions>
  populate(populate: () => Promise<void>): Promise<void>
  destroy(): Promise<void> | void
}
```

SQLite local tests should be able to cache a migrated and seeded baseline per
test file, similar to Vendure's sql.js initializer. D1 tests should use the
Cloudflare test APIs and migrations in the worker-pool environment.

### Environment Split

```text
createCommerceModuleTestEnvironment
  -> fast service/module tests
  -> injected fake commerce system services
  -> no Cloudflare runtime

createCommerceWorkflowTestEnvironment
  -> deterministic workflow/idempotency/compensation tests
  -> inline workflow runtime
  -> no Cloudflare runtime by default

createCommerceWorkerTestEnvironment
  -> real workerd through Cloudflare Vitest pool
  -> D1, DO, Queues, Workflows, Cron, bindings
  -> adapter and runtime compatibility tests

commerce build --check
  -> bundle size
  -> Node import detection
  -> generated Wrangler/Worker artifacts
```

### Medusa Contract Tests

Run equivalent HTTP requests against:

1. A pinned Medusa reference server.
2. The new framework.

Compare:

- Status.
- Response structure and relevant values.
- Error structure.
- Database-visible behavior.
- Events released.

Not every generated ID or timestamp must match.

## Idempotency Test Cases

Every command-oriented workflow should test:

- Same external idempotency key sent concurrently.
- Same queue message delivered multiple times.
- Step succeeds but acknowledgement is lost.
- Worker stops between side effect and checkpoint.
- External callback arrives multiple times.
- Compensation retries.
- Workflow restarts after deployment.

## API Compatibility Matrix

Recommended columns:

```text
Medusa version
method
path
module
status
request compatibility
response compatibility
query compatibility
auth compatibility
test file
notes
```

## Dashboard Compatibility

Dashboard support should be tested by user-visible workflows, not merely by
confirming endpoints exist.

Examples:

- Create and edit a product.
- Configure inventory.
- View and fulfill an order.
- Manage a customer.
- Configure region/shipping/payment.

## Versioning

- Pin the Medusa reference version used by compatibility tests.
- Treat behavior changes in newer Medusa versions as explicit adoption work.
- Version framework route/workflow contracts independently.
- Define how in-progress durable workflows behave across framework upgrades.
