# Cloudflare Primitive Reference

This document records the current intended mapping to Cloudflare products.
Platform details and limits can change, so official documentation must be
rechecked before implementation and release decisions.

## Workers and workerd

Use Workers/workerd as the primary HTTP and event runtime.

Relevant documentation:

- [Workers documentation](https://developers.cloudflare.com/workers/)
- [Workers runtime APIs](https://developers.cloudflare.com/workers/runtime-apis/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)

Framework implication:

- Prefer Web Platform APIs.
- Do not assume Node processes, filesystem discovery, long-running servers, or
  unrestricted Node package compatibility.

## Cloudflare Workflows

Use Cloudflare Workflows for durable multi-step execution where its model fits.

Relevant documentation:

- [Workflows overview](https://developers.cloudflare.com/workflows/)
- [Rules of Workflows](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- [Sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)
- [Events and parameters](https://developers.cloudflare.com/workflows/build/events-and-parameters/)
- [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)

Framework implication:

- Cloudflare supplies durable step execution, retries, sleeps, and events.
- The commerce framework must add explicit compensation, grouped event release,
  domain hooks, and Medusa-inspired workflow contracts.
- Side-effecting steps still require idempotency.

## Queues

Use Queues for background delivery, subscribers, and fan-out.

Relevant documentation:

- [Queues documentation](https://developers.cloudflare.com/queues/)
- [Delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Configuration](https://developers.cloudflare.com/queues/configuration/)

Framework implication:

- Consumers must assume at-least-once delivery.
- Consumer idempotency and dead-letter behavior are framework-level concerns.
- Queues are not the workflow state machine.

## Durable Objects

Use Durable Objects for stateful single-owner coordination.

Relevant documentation:

- [Durable Objects documentation](https://developers.cloudflare.com/durable-objects/)
- [Durable Object storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
- [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)

Framework implication:

- Durable Objects are valuable coordinators but should not automatically host
  every commerce service.
- Durable Object class names and migrations are deployment contracts.
- Registration through `commerce.config.ts` should generate bindings and
  migration checks.

## Cron Triggers

Use Cron Triggers for recurring entrypoints where appropriate.

Relevant documentation:

- [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

Framework implication:

- `defineJob` may compile to a Cron Trigger.
- Longer or stateful scheduled work should start a durable workflow rather than
  execute entirely in the scheduled handler.

## D1 and Hyperdrive

The database strategy remains an open decision.

Relevant documentation:

- [D1 documentation](https://developers.cloudflare.com/d1/)
- [Hyperdrive documentation](https://developers.cloudflare.com/hyperdrive/)

Framework implication:

- Repository and transaction contracts must account for the chosen provider.
- D1 and Postgres should not be treated as behaviorally identical.
- Drizzle is the proposed query/schema layer, but the framework owns portable
  repository contracts.

## R2

Use R2 as a likely built-in upload/blob provider.

Relevant documentation:

- [R2 documentation](https://developers.cloudflare.com/r2/)

Framework implication:

- Upload routes should use Web `FormData` and a storage provider contract.
- The HTTP layer should not depend on Multer.

## Service Bindings

Use Service Bindings when splitting the application into multiple Workers.

Relevant documentation:

- [Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)

Framework implication:

- Splitting Workers reduces bundle size but introduces network/runtime
  boundaries.
- Keep strongly related synchronous operations together unless the binding
  boundary removes meaningful operational complexity.

## Agents

Expose Cloudflare Agents as an advanced native registration option, not as the
foundation for every commerce workflow.

Relevant documentation:

- [Agents documentation](https://developers.cloudflare.com/agents/)

Framework implication:

- Users may register Agent classes through typed config.
- Built-in commerce workflows should remain usable without Agents.

## Generated Configuration

Wrangler configuration and exported entrypoint classes remain necessary
Cloudflare deployment artifacts.

Relevant documentation:

- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [TypeScript declarations](https://developers.cloudflare.com/workers/languages/typescript/)

Framework implication:

- `commerce.config.ts` is the application-facing source of truth.
- The framework compiler generates reviewable Wrangler configuration,
  entrypoints, and binding types.
- Raw Wrangler escape hatches remain necessary for unsupported platform
  features.

## Vite Integration

Vite should be used as the default dev/build integration layer through
`@commerce/vite`.

Relevant documentation:

- [Vite plugin API](https://vite.dev/guide/api-plugin/)

Framework implication:

- Vite virtual modules can expose generated manifests and typed runtime helpers.
- Vite watch mode can drive regeneration and diagnostics.
- Vite's dev server is not itself a full Worker runtime, so the plugin must
  coordinate workerd/Wrangler/Miniflare behavior for Cloudflare features.
- `commerce.config.ts` remains the source of truth; `vite.config.ts` only wires
  the plugin into the build tool.
