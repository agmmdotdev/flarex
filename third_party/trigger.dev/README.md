# Trigger.dev Compatibility Island

This directory preserves the Trigger.dev run engine and supervisor boundary as
an inert, independently installable source island. It is a migration input for
Flarex durable execution, not an active Flarex runtime or public API.

## Boundary

- `upstream/` is an unmodified selective import pinned by `SOURCE.json` and
  `SOURCE_SHA256SUMS`.
- Source verification checks file contents and symlink targets against the
  working tree, then checks executable/symlink modes and the complete imported
  file set against Git's portable index metadata. Untracked build outputs do
  not affect the comparison.
- This nested pnpm workspace is intentionally excluded from Flarex's root
  `packages/*` and `apps/*` workspace globs.
- No Flarex package imports an upstream package.
- Trigger's Prisma schemas, Redis queue, Redlock, metrics, Docker, Kubernetes,
  and ECR assumptions remain compatibility dependencies only. They are not
  FlarexDB, routing, deployment, or compute authority.
- Trigger's web application, dashboard, SDK, CLI, bundler, and user runtime
  entrypoints are not imported.

Future integration must happen through Flarex-owned adapters. In particular,
Flarex identity and artifact projections must be verified before the engine can
schedule work, and AgentOS must implement a Flarex-owned workload provider
without exposing infrastructure capabilities to user code.

## Commands

Run from the Flarex repository root:

```sh
corepack pnpm@10.33.2 trigger:source:verify
corepack pnpm@10.33.2 trigger:install
corepack pnpm@10.33.2 trigger:generate
corepack pnpm@10.33.2 trigger:typecheck
corepack pnpm@10.33.2 trigger:test:unit
corepack pnpm@10.33.2 trigger:test
```

The complete upstream run-engine suite requires Docker because it provisions
PostgreSQL and Redis through Testcontainers. Source verification, generation,
typechecking, and the local unit-test subset do not activate or connect the
island to Flarex. The dedicated GitHub Actions lane runs the complete suite on
isolated runners with Docker available. Its four shards use the pinned
run-engine duration projection in `test-timings.json`.
