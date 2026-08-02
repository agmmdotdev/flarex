# Trigger.dev Compatibility Island

This directory preserves the Trigger.dev run engine and supervisor boundary as
an inert, independently installable source island. It also preserves the pinned
Trigger web application as source-only reference material for future Flarex
observability work. It is a migration input, not an active Flarex runtime,
dashboard, or public API.

## Boundary

- `upstream/` is an unmodified selective import pinned by `SOURCE.json` and
  `SOURCE_SHA256SUMS`.
- Source verification checks file contents and symlink targets against the
  working tree, then checks executable/symlink modes and the complete imported
  file set against Git's portable index metadata. Untracked build outputs do
  not affect the comparison.
- This nested pnpm workspace is intentionally excluded from Flarex's root
  `packages/*` and `apps/*` workspace globs.
- `upstream/apps/webapp` is deliberately not a member of the nested pnpm
  workspace. Its complete application source is preserved for inspection and
  bounded porting, but the original Trigger control plane is not installed,
  built, started, or treated as a Flarex application.
- No Flarex package imports an upstream package.
- Trigger's Prisma schemas, Redis queue, Redlock, metrics, Docker, Kubernetes,
  and ECR assumptions remain compatibility dependencies only. They are not
  FlarexDB, routing, deployment, or compute authority.
- Trigger's SDK, CLI, bundler, and user runtime entrypoints are not imported.
  The imported webapp retains Trigger-specific UI, loaders, API routes,
  presenters, services, engine integration, authentication, tenancy, billing,
  and deployment code only as frozen evidence. None of those owners are
  activated or accepted as Flarex architecture.

The observability extraction plan is recorded in
`design-notes/trigger-observability-webapp/plan.md`. Future Flarex UI code must
port bounded behavior behind Flarex-owned contracts; it must not import this
application directly.

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
