# Roadmaps

This folder records future product and architecture directions that are not
yet implementation slices.

Keep these documents separate from `plan/fork-changes/`, which records concrete
differences already made in this fork.

## Records

- [`hosted-programmable-medusa.md`](./hosted-programmable-medusa.md)
  - Future Convex/Flarex-style platform layer for tenant deployments,
    isolated custom code, custom schema, workflows, and HTTP endpoints on top
    of the trusted Medusa runtime. Records the one Flarex project per Medusa
    project model, commerce extension boundary, custom links, and sync
    invalidation bridge.
- [`developer-framework-api-over-medusa-core.md`](./developer-framework-api-over-medusa-core.md)
  - Reconciliation between the `my-vision-framework/` API sketches and the
    active in-place Medusa fork refactor, using static manifests and restricted
    contexts as the bridge. Keeps Flarex core commerce-neutral and places
    `ctx.commerce` in a Medusa-specific extension package.
- [`fast-integration-and-cloudflare-e2e.md`](./fast-integration-and-cloudflare-e2e.md)
  - Future test-speed and full Cloudflare E2E plan: keep the canonical
    PostgreSQL Medusa compatibility lane, add faster PostgreSQL template reuse,
    add an in-process Cloudflare Fetch test SDK, use PGlite only as a labeled
    subset lane, and eventually replace static HTTP proof services with real
    Drizzle/D1/Durable Object SQLite persistence adapters.
- [`workflow-delayed-actions-runtime-goal.md`](./workflow-delayed-actions-runtime-goal.md)
  - Turn-by-turn goal for making Medusa Workflow Engine retry, step-timeout,
    and transaction-timeout delayed actions durable on Cloudflare without
    replacing workflow definitions or the existing Workflow Engine service.
- [`workflow-delayed-actions-turn-tracker.md`](./workflow-delayed-actions-turn-tracker.md)
  - Execution tracker for the remaining Workflow Engine delayed-action turns,
    including completed evidence, next slice, per-turn stop conditions, and
    validation gates.
- [`workflow-execution-colocated-do-goal.md`](./workflow-execution-colocated-do-goal.md)
  - Turn-by-turn goal for proving Workflow Engine execution persistence in
    colocated Durable Object SQLite storage, starting with the Cart proof DO
    and preserving Medusa as the workflow behavior owner.
- [`workflow-execution-colocated-do-turn-tracker.md`](./workflow-execution-colocated-do-turn-tracker.md)
  - Execution tracker for the colocated Workflow Execution DO goal, including
    per-turn status, required tests, and partitioning guardrails.
- [`portable-query-runtime-goal.md`](./portable-query-runtime-goal.md)
  - Reviewable turn-by-turn goal for replacing the temporary static
    `REMOTE_QUERY` and `QUERY.graph` bridge with the actual Medusa
    Query/Remote Query runtime refactored behind portable Cloudflare-safe
    boundaries.
- [`flarex-monorepo-merge-and-pnpm-migration.md`](./flarex-monorepo-merge-and-pnpm-migration.md)
  - Deferred plan for converting this Medusa Cloudflare fork from Yarn to pnpm,
    merging it into the Flarex monorepo, introducing shared pnpm catalogs
    gradually, and then wiring platform-level tenant/database runtime
    boundaries without rebuilding Medusa behavior in Flarex.
- [`jest-to-vitest-migration-goal.md`](./jest-to-vitest-migration-goal.md)
  - Compatibility-first, turn-by-turn goal for shadowing and replacing active
    Jest package and integration lanes with Vitest while preserving original
    Medusa assertions.
- [`jest-to-vitest-turn-tracker.md`](./jest-to-vitest-turn-tracker.md)
  - Operational queue, per-turn stop conditions, evidence ledger, and current
    next slice for the Jest-to-Vitest goal.
