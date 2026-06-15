# Flarex

Flarex is a Convex-inspired application backend for the Cloudflare runtime.
This workspace contains the architecture documents and the first executable
prototype.

Future implementation work should follow [AGENTS.md](./AGENTS.md). Domain
decisions and implementation records live in [roadmaps/](./roadmaps/), split by
feature area with Convex references and Cloudflare differences.

## Prototype Workspace

- `packages/flarex`: schema validators, Convex-style function authoring
  APIs, and a minimal application client for calling generated references.
- `packages/flarex-dev`: Vite plugin, local dev runtime, and code generator.
- `packages/flarex-backend`: backend Worker runtime and Durable Object
  database model.
- `packages/flarex-test`: Convex-style test SDK backed by the real local
  Flarex Worker/Durable Object runtime.
- `apps/backend`: thin Wrangler deployable wrapper around `flarex-backend`.
- `apps/example`: an application that defines its schema and functions with
  `flarex`.

The generator discovers application functions and emits:

- `flarex/_generated/server.ts`
- `flarex/_generated/api.ts`
- `flarex/_generated/dataModel.ts`
- `flarex/_generated/worker.ts`

The generated Worker currently provides `/health`, `/sync`, `/invoke`, and an
internal metadata route for local dev. In app development the Vite plugin owns
the local Miniflare backend/app Worker runtime and proxies through
`/__flarex_dev/*`; the application does not need to be a Wrangler app.

Application generation should not own a Wrangler config. The client should
point at either a hosted Flarex deployment URL or the local dev URL exposed by
the plugin. The Flarex platform/backend itself remains the Wrangler deployment
target.

This is intentionally the first vertical slice. Dynamic Worker isolation,
reactive query invalidation, argument validation, schema migrations,
projections, and cross-partition workflow mutations are not implemented yet.

`packages/flarex-backend` is now the first standalone server runtime. It
defines
`RegistryDO`, `DeploymentDO`, `PartitionDO`, `ConnectionDO`, and `SchedulerDO`.
The partition object is the authoritative shard: it owns document history,
current documents, index entries, write log, idempotency keys, and conservative
OCC validation for document/table/index read sets.

## Run The Prototype

```sh
corepack pnpm install
corepack pnpm generate
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Run the backend Worker locally:

```sh
corepack pnpm --filter @flarex/backend dev
```

Application code lives in `apps/example/flarex`. Adding an exported function
there and running generation updates the typed API references and Worker
function registry.

## Architecture

The old executor-only spike has been removed. The current primary design uses
Dynamic Workers for isolated user code, partition Durable Objects with SQLite
for authoritative atomic mutations, declarative projections for global live
views, and Cloudflare Workflows for durable cross-partition operations.

Start with [CLOUDFLARE_CONVEX_RUNTIME.md](./CLOUDFLARE_CONVEX_RUNTIME.md).
Detailed domain docs live under [docs/](./docs/).

### Current Scope

- define the Cloudflare runtime and database architecture
- preserve Convex-like query, mutation, action, and subscription semantics
- prevent user functions from receiving raw database or Durable Object bindings
- preserve normal loops, maps, and `Promise.all` inside mutations
- provide atomic authoritative mutations inside one partition
- provide type-level and runtime cross-partition protection
- provide automatic projection maintenance
- provide automatic one-step-per-partition Workflow planning

### Next Work

1. Finalize the partition model in
   [09-partitioned-data-model.md](./docs/09-partitioned-data-model.md).
2. Finalize generated APIs and safety rules in
   [10-developer-api-and-type-safety.md](./docs/10-developer-api-and-type-safety.md).
3. Move generated function execution behind a restricted Dynamic Worker
   syscall boundary.
4. Add projections from
   [11-projections-and-consistency.md](./docs/11-projections-and-consistency.md).
5. Add cross-partition orchestration from
   [12-cross-partition-workflow-mutations.md](./docs/12-cross-partition-workflow-mutations.md).
