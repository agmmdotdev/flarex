# Migration Roadmap

## Strategy

Build a new framework in vertical slices while continuously using Medusa source
and behavior tests as references.

Do not port module after module without first proving the runtime foundations.

## Phase 0: Compatibility Inventory

- Select the target Medusa version.
- Build a Store/Admin endpoint inventory.
- Classify endpoints as required, later, or intentionally unsupported.
- Inventory domain events, workflows, hooks, modules, and providers.
- Record expected request/response fixtures.

Deliverable: versioned compatibility matrix.

## Phase 1: Core Contracts

- Tokens and typed definitions.
- Provider graph and scopes.
- Explicit execution contexts.
- Framework errors.
- Module definition and override model.
- Static `commerce.config.ts`.

Deliverable: modules and services can register and resolve without Node dynamic
loading or Awilix.

## Phase 2: DML and DAL

- Drizzle schema conventions.
- Repository contracts.
- Query/filter/pagination contracts.
- Short transaction helpers.
- Migration conventions.
- D1 and/or Hyperdrive/Postgres adapter decision.

Deliverable: one module can persist and query data through portable contracts.

## Phase 3: HTTP Foundation

- Worker router adapter.
- `defineRoute`.
- Validation.
- Standard responses/errors.
- Auth strategy interface.
- Request context.
- Field selection and pagination.
- OpenAPI/SDK generation skeleton.

Deliverable: custom typed routes run on workerd.

## Phase 4: First Vertical Module

Recommendation: Product plus a minimal related set.

- Product schema/repository/service.
- Product workflows.
- Store product endpoints.
- Admin product endpoints.
- API compatibility tests.

Deliverable: a real module works end to end.

## Phase 5: Workflow Runtime

- `defineWorkflow` and `defineStep`.
- Step outputs and compensation inputs.
- Deterministic execution and step IDs.
- Retry and timeout policy.
- Inline test runtime.
- Cloudflare Workflows runtime adapter.
- Workflow inspection API.

Deliverable: a cart-oriented Saga can execute, retry, and compensate.

## Phase 6: Events, Queues, and Jobs

- Domain event definitions.
- Transactional outbox/grouped event behavior.
- `defineConsumer`.
- Cloudflare Queue adapter.
- Idempotent delivery records.
- `defineJob`.
- Cron/scheduled Workflow compilation.

Deliverable: successful workflows release events once to idempotent consumers.

## Phase 7: Cart Vertical Slice

- Region/currency/sales-channel prerequisites.
- Pricing and inventory contracts.
- Create/retrieve/update cart.
- Line items.
- Taxes/promotions integration points.
- Shipping options.
- Store API compatibility tests.
- Compensation and duplicate-command tests.

Deliverable: usable Store cart lifecycle.

## Phase 8: Order and Payment

- Payment provider contract.
- Cart completion.
- Order creation.
- Inventory reservations.
- Payment/fulfillment workflow boundaries.
- Long-running workflow callbacks.

Deliverable: first complete checkout flow.

## Phase 9: Admin Expansion

Add Admin API coverage module by module based on the compatibility matrix and
dashboard requirements.

## Phase 10: Extension Ecosystem

- Custom modules and services.
- Custom routes.
- Custom workflows, steps, hooks, jobs, and consumers.
- Durable Object and Agent registration.
- Provider packages.
- Framework CLI and templates.

## Implementation Rule

For every module:

```text
contract
  -> schema
  -> repository
  -> service
  -> workflow
  -> Store/Admin routes
  -> compatibility and runtime tests
```

Avoid building all DAL modules first and delaying workflows/APIs until later.
The first vertical slices will expose missing framework requirements earlier.
