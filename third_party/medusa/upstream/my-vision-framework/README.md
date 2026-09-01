# Medusa-Inspired Commerce Framework for Cloudflare

This folder records the current design direction for a new ecommerce framework
that preserves useful Medusa concepts and selected API compatibility while
running natively on Cloudflare Workers/workerd.

This is not intended to be a line-by-line port of Medusa. The proposed approach
keeps Medusa as a source and behavior reference, then implements a smaller,
statically compiled, Cloudflare-native runtime.

The folder name intentionally matches the requested `meudsa-cloudflare-port`
name.

## Current Direction

- Start a new framework rather than continuously patching a Medusa fork.
- Keep Medusa in `opensrc` as the implementation and behavior reference.
- Preserve selected public API paths, request shapes, response shapes, and
  behavior tests.
- Do not preserve Node-specific internals, Express middleware contracts, Awilix,
  MikroORM, dynamic folder scanning, or Redis/BullMQ assumptions.
- Use explicit, typed registration through `commerce.config.ts`.
- Use a Vite plugin for the default `yarn dev` and `yarn build` experience,
  while keeping commerce definitions out of `vite.config.ts`.
- Compile registered modules, routes, services, workflows, jobs, consumers, and
  Cloudflare resources into Worker entrypoints and deployment configuration.
- Use Drizzle and small runtime dependencies.
- Use Cloudflare Workflows, Queues, Durable Objects, Cron Triggers, and storage
  primitives according to their specific strengths.
- Keep domain modules behind commerce-level service contracts so module tests
  can run without Cloudflare, then verify Cloudflare adapters with real
  workerd/Vitest-pool integration tests.

## Documents

1. [Scope and strategy](./01-scope-and-strategy.md)
2. [Runtime architecture](./02-runtime-architecture.md)
3. [Dependency injection and execution context](./03-di-context-and-transactions.md)
4. [Configuration, compilation, and Cloudflare bindings](./04-config-compilation-and-bindings.md)
5. [Workflows, jobs, queues, and events](./05-workflows-jobs-queues-and-events.md)
6. [HTTP and API design](./06-http-and-api-design.md)
7. [Migration roadmap](./07-migration-roadmap.md)
8. [Compatibility and testing](./08-compatibility-and-testing.md)
9. [Bundle size and dependency policy](./09-bundle-size-and-dependencies.md)
10. [Medusa source reference map](./10-medusa-source-reference.md)
11. [Framework API sketches](./11-framework-api-sketches.md)
12. [Cloudflare primitive reference](./12-cloudflare-primitive-reference.md)

## Status Language

- **Decision**: direction agreed during discussion.
- **Recommendation**: strong proposed direction that should be validated during
  the first implementation slice.
- **Open question**: intentionally unresolved and should not be silently decided
  during implementation.

## Immediate Validation Target

The first proof should be a narrow, complete product and cart slice:

```text
typed config
  -> Vite plugin dev/build integration
  -> module and service registration
  -> Drizzle repository
  -> request context
  -> workflow and compensation
  -> Store API routes
  -> generated Worker entrypoint/config
  -> compatibility tests
```

That slice should demonstrate framework viability before attempting broad Admin
API coverage or advanced order workflows.
