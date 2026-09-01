# Fork Change Records

This folder records meaningful differences between this fork and original
Medusa. Records are split by domain so the history remains readable as the fork
grows.

Do not turn this index into a chronological change log. Update the relevant
domain file, or create a new domain file when an existing category is no longer
a good fit.

## Records

- [`baseline.md`](./baseline.md)
  - Fork origin, upstream relationship, and repository baseline.
- [`architecture.md`](./architecture.md)
  - Adopted in-place refactor strategy and architectural decisions.
- [`runtime-bootstrap-and-http.md`](./runtime-bootstrap-and-http.md)
  - Thin application roots, static discovery, shared Medusa bootstrap, and
    Express/Nitro HTTP adapter direction.
- [`http-static-manifest-migration-goal.md`](./http-static-manifest-migration-goal.md)
  - Route-group checklist for moving HTTP ownership from the Cloudflare proof
    manifest into package-owned Medusa static manifests.
- [`api-integration-test-runner.md`](./api-integration-test-runner.md)
  - Existing API/HTTP integration runner migration toward selectable
    Express/Cloudflare HTTP runtimes.
- [`module-integration-test-runner.md`](./module-integration-test-runner.md)
  - Existing module integration runner validation through selectable
    Express/Cloudflare HTTP runtimes.
- [`persistence-and-testing.md`](./persistence-and-testing.md)
  - Persistence adapter boundaries, module test runner changes, and Currency
    migration behavior.
- [`cloudflare-experiments.md`](./cloudflare-experiments.md)
  - Experimental portable packages, Worker app, and import guard.
- [`cloudflare-runtime-tenancy.md`](./cloudflare-runtime-tenancy.md)
  - Platform-level tenant/deployment runtime context, Durable Object partition
    addressing, and projection scope primitives.
- [`workflow-engine.md`](./workflow-engine.md)
  - Workflow Engine, core orchestration, and workflows SDK portability changes.
- [`event-bus.md`](./event-bus.md)
  - Event Bus provider behavior and Cloudflare Queue runtime changes.
- [`typescript-and-tooling.md`](./typescript-and-tooling.md)
  - Type-safety changes and TypeScript migration configuration.
- [`package-management.md`](./package-management.md)
  - pnpm workspace ownership, compatibility hoisting, patches, CI/helper
    conversion, and package-manager validation.
- [`test-runner-migration.md`](./test-runner-migration.md)
  - Jest-to-Vitest goal implementation, exact parity evidence, and Vite/Vitest
    toolchain compatibility decisions.
- [`validation-and-status.md`](./validation-and-status.md)
  - Verified behavior, current acceptance gate, and next implementation step.

## Maintenance

For every meaningful fork-specific architecture or behavior change:

1. Update the relevant domain record.
2. Add the affected boundary, validation performed, and commit identifier.
3. Create a new domain record instead of overloading an unrelated file.
4. Update this index only when records are added, renamed, or removed.
5. Update `../cloudflare-port-refactor-plan.md` when architecture direction or
   migration order changes.
6. Keep the root `AGENTS.md` aligned with active working rules.
