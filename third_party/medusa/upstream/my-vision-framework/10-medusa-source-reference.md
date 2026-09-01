# Medusa Source Reference Map

The local source reference is Medusa `2.13.4` under:

```text
opensrc/repos/github.com/medusajs/medusa
```

These paths are references for behavior and architecture research. They are not
an instruction to copy Node-specific implementation into the Worker runtime.

## Store and Admin APIs

- Store API root:
  [`packages/medusa/src/api/store`](../opensrc/repos/github.com/medusajs/medusa/packages/medusa/src/api/store)
- Admin API root:
  [`packages/medusa/src/api/admin`](../opensrc/repos/github.com/medusajs/medusa/packages/medusa/src/api/admin)
- Combined middleware registration:
  [`packages/medusa/src/api/middlewares.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/medusa/src/api/middlewares.ts)
- Store create-cart route:
  [`packages/medusa/src/api/store/carts/route.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/medusa/src/api/store/carts/route.ts)
- Store cart middleware:
  [`packages/medusa/src/api/store/carts/middlewares.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/medusa/src/api/store/carts/middlewares.ts)
- Admin product route:
  [`packages/medusa/src/api/admin/products/route.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/medusa/src/api/admin/products/route.ts)
- Admin product middleware:
  [`packages/medusa/src/api/admin/products/middlewares.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/medusa/src/api/admin/products/middlewares.ts)

Use these to study:

- Route input/output shapes.
- Validation and query configuration.
- Authentication and policies.
- Workflows called by write endpoints.
- Refetch/query behavior after writes.

## Dashboard

- Dashboard package:
  [`packages/admin/dashboard`](../opensrc/repos/github.com/medusajs/medusa/packages/admin/dashboard)
- Dashboard API hooks:
  [`packages/admin/dashboard/src/hooks/api`](../opensrc/repos/github.com/medusajs/medusa/packages/admin/dashboard/src/hooks/api)

The dashboard uses `@medusajs/js-sdk` extensively. Supporting the existing
dashboard therefore requires detailed Admin API compatibility.

## Cart Workflow

- Create-cart workflow:
  [`packages/core/core-flows/src/cart/workflows/create-carts.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/core-flows/src/cart/workflows/create-carts.ts)
- Create-cart step and compensation:
  [`packages/core/core-flows/src/cart/steps/create-carts.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/core-flows/src/cart/steps/create-carts.ts)
- Event emission step:
  [`packages/core/core-flows/src/common/steps/emit-event.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/core-flows/src/common/steps/emit-event.ts)

Use these to study:

- Workflow composition.
- Parallel and nested workflows.
- Workflow hooks.
- Compensation inputs.
- Event grouping behavior.

## Workflow SDK

- Workflow composition:
  [`packages/core/workflows-sdk/src/utils/composer/create-workflow.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/workflows-sdk/src/utils/composer/create-workflow.ts)
- Step responses:
  [`packages/core/workflows-sdk/src/utils/composer/helpers/step-response.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/workflows-sdk/src/utils/composer/helpers/step-response.ts)
- Exported workflow execution and event release:
  [`packages/core/workflows-sdk/src/helper/workflow-export.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/workflows-sdk/src/helper/workflow-export.ts)

Use these to study:

- Workflow registration.
- Nested workflow transaction IDs.
- Parent step idempotency keys.
- Event group propagation.
- Workflow completion behavior.

## Orchestration

- Transaction orchestrator:
  [`packages/core/orchestration/src/transaction/transaction-orchestrator.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/orchestration/src/transaction/transaction-orchestrator.ts)
- Transaction types and options:
  [`packages/core/orchestration/src/transaction/types.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/orchestration/src/transaction/types.ts)
- Storage interfaces:
  [`packages/core/orchestration/src/transaction/datastore/abstract-storage.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/orchestration/src/transaction/datastore/abstract-storage.ts)
- Workflow scheduler:
  [`packages/core/orchestration/src/workflow/scheduler.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/orchestration/src/workflow/scheduler.ts)

Use these to study:

- Checkpoint state.
- Step state transitions.
- Retry/timeouts.
- Compensation and cancellation.
- Idempotency key construction.
- Pluggable transaction and scheduler storage.

## Workflow Engine Implementations

- In-memory engine:
  [`packages/modules/workflow-engine-inmemory`](../opensrc/repos/github.com/medusajs/medusa/packages/modules/workflow-engine-inmemory)
- Redis engine:
  [`packages/modules/workflow-engine-redis`](../opensrc/repos/github.com/medusajs/medusa/packages/modules/workflow-engine-redis)
- Redis storage implementation:
  [`packages/modules/workflow-engine-redis/src/utils/workflow-orchestrator-storage.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/modules/workflow-engine-redis/src/utils/workflow-orchestrator-storage.ts)
- Redis workflow orchestrator service:
  [`packages/modules/workflow-engine-redis/src/services/workflow-orchestrator.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/modules/workflow-engine-redis/src/services/workflow-orchestrator.ts)

Use these to distinguish framework workflow semantics from Redis/BullMQ
implementation details.

## Scheduled Jobs

- Job loader:
  [`packages/core/framework/src/jobs/job-loader.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/framework/src/jobs/job-loader.ts)

Medusa wraps scheduled job handlers as scheduled workflows. This is a useful
semantic to preserve even though runtime discovery and scheduling must change.

## Dependency Injection and Request Scopes

- Framework container:
  [`packages/core/framework/src/container.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/framework/src/container.ts)
- Medusa container utilities:
  [`packages/core/utils/src/common/medusa-container.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/utils/src/common/medusa-container.ts)
- Main loaders:
  [`packages/medusa/src/loaders/index.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/medusa/src/loaders/index.ts)
- Module container loader:
  [`packages/core/utils/src/modules-sdk/loaders/container-loader-factory.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/utils/src/modules-sdk/loaders/container-loader-factory.ts)

Use these to understand Medusa's Awilix registration and request-scope model,
then replace it with typed static providers.

## Medusa Context and Transactions

- Context parameter decorator:
  [`packages/core/utils/src/modules-sdk/decorators/context-parameter.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/utils/src/modules-sdk/decorators/context-parameter.ts)
- Manager injection:
  [`packages/core/utils/src/modules-sdk/decorators/inject-manager.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/utils/src/modules-sdk/decorators/inject-manager.ts)
- Transaction manager injection:
  [`packages/core/utils/src/modules-sdk/decorators/inject-transaction-manager.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/utils/src/modules-sdk/decorators/inject-transaction-manager.ts)
- DAL transaction wrapper:
  [`packages/core/utils/src/dal/utils.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/core/utils/src/dal/utils.ts)

Use these to understand hidden context/transaction propagation. The proposed
framework replaces decorator-driven propagation with an explicit first context
parameter.

## DAL and MikroORM Coupling

- DAL MikroORM implementation:
  [`packages/core/utils/src/dal/mikro-orm`](../opensrc/repos/github.com/medusajs/medusa/packages/core/utils/src/dal/mikro-orm)
- Dependency package:
  [`packages/deps/package.json`](../opensrc/repos/github.com/medusajs/medusa/packages/deps/package.json)

These paths demonstrate why replacing the persistence layer is a foundational
rewrite rather than a package substitution.

## Node Runtime Entrypoints

- Server startup:
  [`packages/medusa/src/commands/start.ts`](../opensrc/repos/github.com/medusajs/medusa/packages/medusa/src/commands/start.ts)
- Framework package dependencies:
  [`packages/core/framework/package.json`](../opensrc/repos/github.com/medusajs/medusa/packages/core/framework/package.json)

Use these to identify Node-only process/server behavior that should not enter
the Cloudflare-native framework.

## Vendure Testing Reference

Vendure is not the runtime target, but its explicit e2e test environment is a
good reference for our test harness shape.

- Test environment factory:
  [`packages/testing/src/create-test-environment.ts`](../opensrc/repos/github.com/vendurehq/vendure/packages/testing/src/create-test-environment.ts)
- Test server lifecycle:
  [`packages/testing/src/test-server.ts`](../opensrc/repos/github.com/vendurehq/vendure/packages/testing/src/test-server.ts)
- Default testing config:
  [`packages/testing/src/config/test-config.ts`](../opensrc/repos/github.com/vendurehq/vendure/packages/testing/src/config/test-config.ts)
- Initializer registry:
  [`packages/testing/src/initializers/initializers.ts`](../opensrc/repos/github.com/vendurehq/vendure/packages/testing/src/initializers/initializers.ts)
- Test database initializer contract:
  [`packages/testing/src/initializers/test-db-initializer.ts`](../opensrc/repos/github.com/vendurehq/vendure/packages/testing/src/initializers/test-db-initializer.ts)
- sql.js initializer cache:
  [`packages/testing/src/initializers/sqljs-initializer.ts`](../opensrc/repos/github.com/vendurehq/vendure/packages/testing/src/initializers/sqljs-initializer.ts)
- Local app wrapper:
  [`apps/vendure/tests/e2e/test-environment.ts`](../apps/vendure/tests/e2e/test-environment.ts)

Use these for the explicit config-in, environment-out testing flow: config,
database setup, seed/populate, API clients, direct service access where needed,
and cleanup. Do not copy Vendure's Nest container or TypeORM-specific
implementation.
