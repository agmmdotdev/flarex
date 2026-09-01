# Bundle Size and Dependency Policy

## Constraint

Cloudflare Worker bundle and startup limits make dependency size an
architectural concern, not a final optimization task.

The framework should continuously measure:

- Compressed Worker size.
- Uncompressed Worker size.
- Startup time.
- Per-entrypoint dependency composition.
- Largest imported packages.

## Decision: Replace Heavy Node-Oriented Libraries

Current direction:

| Medusa/Node dependency | Proposed direction |
|---|---|
| MikroORM | Drizzle plus framework repository contracts |
| Express | Worker-native typed router |
| Awilix | Typed static provider graph |
| BullMQ/ioredis | Cloudflare Workflows, Queues, Cron, Durable Objects |
| node-schedule | Cron Triggers or scheduled Workflows |
| Multer | Web `Request`/`FormData` plus R2 upload abstraction |
| Node crypto/session utilities | Web Crypto and Worker-compatible auth |

## Dependency Rules

- Prefer Web Platform APIs.
- Prefer small packages with ESM and Worker support.
- Avoid packages that conditionally pull Node shims.
- Avoid dynamic imports for application discovery.
- Keep core contracts free of Cloudflare and database implementations.
- Keep optional capabilities in separate packages and entrypoints.
- Require a clear benefit before adding a runtime dependency.

## Bundle Splitting

Do not place all framework features into one Worker.

Recommended separation:

- Store API.
- Admin API.
- Webhooks.
- Queue consumers.
- Workflow runtimes.
- Admin frontend assets.

Modules should only be imported by entrypoints that use them.

## Tree-Shaking Requirements

Static config registration should allow the compiler to:

- Include only enabled modules.
- Include only registered routes.
- Include only required providers.
- Split queue consumers by queue.
- Split workflow definitions where practical.
- Exclude development and generation code.

No runtime folder scanning means unused user files do not enter the bundle.

## Database Considerations

Drizzle is smaller and more Worker-friendly than MikroORM, but database choice
still affects design:

- D1 is Cloudflare-native but has different operational characteristics from
  Postgres.
- Hyperdrive allows Postgres access but requires connection-aware query and
  transaction behavior.
- Repository and query contracts must avoid assuming one database's advanced
  features everywhere.

## CI Budgets

Set per-entrypoint bundle budgets early.

Example policy:

```text
store-api compressed target: <= 2 MB
admin-api compressed target: <= 3 MB
queue consumer compressed target: <= 1 MB
workflow entrypoint compressed target: <= 2 MB
```

These are design targets, not confirmed Cloudflare limits. Actual deployment
limits must be checked against the selected Cloudflare plan.

CI should report growth and fail when a budget is exceeded without an explicit
reviewed adjustment.

## Open Questions

- Which validation library provides acceptable inference and OpenAPI generation
  at the smallest cost?
- Should each commerce module be a separately deployable Worker option?
- How should shared code be split without producing excessive service-binding
  calls?
