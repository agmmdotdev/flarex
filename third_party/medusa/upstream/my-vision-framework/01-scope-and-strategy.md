# Scope and Strategy

## Goal

Build an extensible ecommerce framework inspired by Medusa that runs in
Cloudflare Workers/workerd without relying on Node-specific runtime behavior.

The framework should support:

- Built-in commerce modules and workflows.
- User-defined services, repositories, routes, workflows, jobs, subscribers,
  queue consumers, Durable Objects, and Agents.
- A strong typed configuration and dependency-injection experience.
- Selected Medusa Store and Admin API compatibility.
- Cloudflare-native deployment and durable execution.
- Small Worker bundles and statically analyzable builds.

## Decision: Start New, Keep Medusa as Reference

A fresh framework is preferable to refactoring a Medusa fork in place.

Refactoring the fork would require replacing deeply connected assumptions:

- Express request/response and middleware behavior.
- Awilix container behavior and dynamic loading.
- MikroORM entity and repository infrastructure.
- Node process, cluster, scheduler, filesystem, and HTTP server behavior.
- Redis, BullMQ, and long-running worker processes.
- Runtime discovery of routes, jobs, subscribers, modules, and workflows.

Keeping the fork operational while replacing all these foundations would create
long-lived compatibility layers and make it difficult to know which behavior is
intentional.

Medusa remains valuable as:

- A domain model reference.
- A workflow and compensation reference.
- An HTTP contract reference.
- A test-case and edge-case source.
- A source for understanding module boundaries and commerce behavior.

## Compatibility Target

Compatibility should be explicit and layered.

### Preserve Where Valuable

- Important Store API URLs.
- Important Admin API URLs.
- Request and response shapes.
- Query parameter semantics where practical.
- Workflow names and behavior where they improve migration.
- Domain events and their timing.
- Extension points with equivalent purpose.

### Do Not Preserve

- Express middleware signatures.
- `req.scope.resolve(...)` as the fundamental internal API.
- Awilix constructor-name injection.
- MikroORM entity/repository APIs.
- Node filesystem-based discovery.
- Redis/BullMQ implementation details.
- In-process global registries that depend on long-lived Node processes.

## Architecture Principle

Preserve external contracts and domain semantics, not internal implementation.

```text
Medusa behavior/API reference
            |
            v
Framework-neutral contracts
            |
            v
Cloudflare-native runtime adapters
```

## Framework Versus Application Concerns

The framework owns:

- Registration and compilation.
- DI and execution context.
- HTTP contract model.
- Module lifecycle.
- Workflow authoring semantics.
- Workflow execution abstraction.
- Event and queue contracts.
- Cloudflare adapters and generated artifacts.
- Compatibility test utilities.

Applications own:

- Enabled modules.
- Overrides.
- Custom services and repositories.
- Custom routes and workflows.
- Provider credentials and bindings.
- Deployment environments.
- Product-specific Admin UI extensions.

## Open Questions

- How much Medusa API compatibility should be promised for the first stable
  release?
- Should Medusa's current dashboard be supported as an explicit compatibility
  target, or should the framework ship its own smaller admin application?
- Which database targets are first-class: D1, Hyperdrive/Postgres, or both?
- Should Cloudflare Workflows be mandatory for durable workflows, or one runtime
  adapter among several?
