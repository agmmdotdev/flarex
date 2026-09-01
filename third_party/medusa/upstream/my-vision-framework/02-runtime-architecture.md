# Runtime Architecture

## Decision: Static Runtime Graph

The runtime graph should be compiled from explicit definitions. It should not
scan folders or dynamically import unknown modules at runtime.

```text
commerce.config.ts
    |
    v
framework compiler
    |
    +-- validates definitions and dependencies
    +-- creates route manifest
    +-- creates DI provider graph
    +-- creates workflow/job/consumer manifest
    +-- creates Cloudflare binding manifest
    |
    v
generated Worker entrypoints and deployment config
```

This gives:

- Workerd-compatible startup.
- Smaller and more predictable bundles.
- Build-time dependency graph validation.
- Generated binding types.
- No runtime filesystem access.
- Better tree shaking.

## Proposed Runtime Packages

```text
@commerce/core
  Tokens, definitions, context, errors, module contracts.

@commerce/di
  Typed providers, scopes, graph validation.

@commerce/http
  Route contracts, router adapter, validation, auth, query parsing.

@commerce/dal
  Repository contracts, query contracts, transaction helpers.

@commerce/drizzle
  Drizzle repository and transaction implementation.

@commerce/workflows
  Workflow definitions, step contracts, compensation, execution API.

@commerce/cloudflare
  Workers, Workflows, Queues, Durable Objects, Cron, binding compiler.

@commerce/vite
  Vite plugin for config loading, virtual modules, generated entrypoints,
  watch mode, Worker dev orchestration, and build integration.

@commerce/modules/*
  Product, pricing, cart, inventory, customer, order, and other modules.

@commerce/testing
  Contract tests, module tests, workflow tests, compatibility suites.

@commerce/cli
  Thin command wrapper around the compiler, Vite plugin, validation,
  development, and deployment flows.
```

## Runtime Boundaries

## Platform Service Contracts

The framework stance is Cloudflare-first, with portable commerce contracts.
Domain services should depend on framework tokens such as `eventBus`,
`workflowEngine`, `jobScheduler`, `lockManager`, repositories, and execution
contexts.

Product, cart, pricing, order, and custom services should not directly import
Cloudflare Queues, Durable Objects, Workflows, D1, KV, or Worker request
primitives unless they are intentionally implementing a Cloudflare adapter.

This keeps normal modules testable in a plain module test environment. The
Cloudflare adapter layer still needs real workerd/Vitest-pool tests for binding,
queue, Durable Object, Workflow, scheduled-event, and runtime compatibility
behavior.

## Development Runtime

Recommendation: use Vite as the default development and build orchestrator, but
do not make Vite the commerce runtime.

```text
yarn dev
  -> vite
  -> @commerce/vite plugin
  -> load commerce.config.ts
  -> generate manifest, entrypoints, bindings, and Wrangler config
  -> start or coordinate workerd/Wrangler dev runtime
  -> watch definitions and regenerate on change
```

Vite provides the plugin pipeline, watch mode, virtual modules, diagnostics, and
fast rebuild loop. The Worker runtime still needs workerd/Wrangler/Miniflare
semantics for bindings, Durable Objects, Queues, Workflows, and scheduled
handlers.

`vite.config.ts` should configure the build integration:

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

`commerce.config.ts` remains the application definition.

### HTTP Worker

Responsible for:

- Routing and validation.
- Auth and request context creation.
- Short queries and commands.
- Starting workflows.
- Returning API responses.

It should not contain every admin, queue, and workflow implementation when those
can live in separate Worker bundles.

### Queue Consumer Worker

Responsible for:

- Event subscribers.
- Background consumers.
- Fan-out work.
- Retryable external side effects.

Queue delivery is at-least-once, so consumers must use idempotency keys.

### Workflow Runtime

Responsible for:

- Durable execution and retries.
- Step state.
- Waiting for external events.
- Compensation orchestration.
- Workflow inspection and cancellation.

Cloudflare Workflows should provide durable execution where its model fits.
Framework-level Saga semantics remain our responsibility.

### Durable Objects

Use Durable Objects where a single logical owner and strongly consistent,
serialized coordination are valuable, for example:

- Inventory reservation coordination for a contested resource.
- Per-cart or per-order coordination when necessary.
- Workflow coordination features not covered by Cloudflare Workflows.
- User-defined stateful services and Agents.

Do not automatically put every service or workflow into a Durable Object.

### Database

The business database stores durable commerce state. Workflow execution state
must remain conceptually separate from product state, even if both use the same
physical database provider.

Each workflow step may use a short database transaction. A workflow must not
hold a database transaction open while waiting, retrying, calling external
providers, or executing other durable steps.

## Multi-Worker Direction

Recommendation:

```text
store-api Worker
admin-api Worker
webhook Worker
queue-consumer Worker(s)
workflow Worker(s)
admin frontend on Cloudflare Pages/Workers Assets
```

Applications should be able to start with fewer bundles, then split them as
features and bundle sizes grow.

## Execution Contexts

Use explicit contexts:

- `RequestContext`: actor, auth, locale, channel, request metadata, database.
- `OperationContext`: shared service/workflow execution contract.
- `WorkflowContext`: run id, step id, attempt, idempotency key, event group.
- `QueueContext`: message id, delivery attempt, consumer metadata.
- `ScheduledContext`: scheduled time and job id.

These contexts can share a common base but should not become one unbounded bag
of optional properties.
