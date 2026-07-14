# Flarex

Flarex is a Convex-inspired application backend for the Cloudflare runtime.
This workspace contains the accepted replacement design, its active roadmaps,
and executable prototypes that are being replaced by the first intended
shippable FlarexDB architecture.

Future implementation work should follow [AGENTS.md](./AGENTS.md). Domain
decisions and implementation records live in [roadmaps/](./roadmaps/), split by
feature area with Convex references and Cloudflare differences.

## Prototype Workspace

- `packages/flarex`: schema validators, Convex-style function authoring
  APIs, and a minimal application client for calling generated references.
- `packages/flarex-dev`: Vite plugin, local dev runtime, and code generator.
- `packages/flarex-backend`: backend Worker runtime, Cloudflare coordination,
  and removable Durable Object app-data prototype code.
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

Developers write ordinary TypeScript modules under `flarex/`; they do not write
Worker entrypoints or Wrangler configuration. The hosted platform bundles those
modules into an internal Flarex-managed execution artifact for dynamic
execution.

The repository currently contains two unshipped app-data prototypes: the older
`PartitionDO`/Durable Object SQLite path and the initial Postgres `legacy_v1`
path. Neither is the accepted future authority. The accepted target is
`flarexdb_v1`: trusted execution through a private executor Worker with
Postgres as the only authoritative committed app-data store. Durable Objects
own explicitly non-authoritative coordination, connection, and freshness state.
The target foundation is only partially implemented, so current runnable
behavior must not be mistaken for the finished architecture.

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

The accepted target topology is:

```text
client
  -> public backend Worker
  -> Flarex-managed Dynamic Worker execution artifact
  -> private trusted executor Worker
  -> cache-disabled Hyperdrive
  -> authoritative Postgres / FlarexDB
  -> canonical commit feed
  -> non-authoritative DeploymentSyncDO / ConnectionDO coordination
```

Postgres owns committed app data, exact snapshots, OCC validation, durable
outcomes, and the canonical commit/change feed. Cloudflare hosts sandboxed user
execution, service bindings, WebSockets, and rebuildable coordination or cache
state. User code receives a restricted logical syscall API, never raw database
or storage handles.

Start with [CLOUDFLARE_CONVEX_RUNTIME.md](./CLOUDFLARE_CONVEX_RUNTIME.md).
The accepted architecture is owned by
[the FlarexDB design](./design-notes/flarex-db-accepted-design.md), and active
execution order is owned by
[the FlarexDB foundation roadmap](./roadmaps/flarexdb-foundation/README.md).
The files under [docs/](./docs/) are retained as a historical first-design
archive, not as current design authority.

### Current Scope

- preserve the Convex developer mental model and portable core semantics
- keep Postgres as the only authoritative committed app-data store
- isolate untrusted functions behind a restricted syscall boundary
- provide exact-snapshot reads, explicit dependencies, OCC, versioned writes,
  idempotent outcomes, and ordered commit/change information
- use Cloudflare Durable Objects only for deterministic coordination,
  WebSockets, and explicitly non-authoritative freshness/cache state
- document every necessary Flarex divergence from Convex

### Next Work

Do not infer the next implementation gate from this overview. Research and
preflight the next unchecked gate in
[the FlarexDB foundation roadmap](./roadmaps/flarexdb-foundation/README.md), then
obtain explicit user approval. The durable sequence is to complete one vertical
`flarexdb_v1` snapshot/OCC/commit proof, build the target sync path, activate it
for clean scopes, switch internal callers, and remove both unshipped prototype
app-data architectures. Backfill, dual operation, and rollback machinery are
added only if a shipped-state inventory proves a real migration obligation.
