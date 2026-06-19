# Flarex Agent Rules

These are operating rules for future agents working in this workspace. Feature
design records, implementation notes, Convex references, and Cloudflare
differences belong in `roadmaps/`, not in this file.

## Core Rule

Flarex is a Convex-inspired backend on Cloudflare. Implement it with care:
copy Convex semantics where they are portable, copy or closely port Convex SDK
and codegen logic where licensing and runtime boundaries allow it, and
explicitly document where Cloudflare Durable Objects require a different design.

Do not build a generic CRUD server and call it Convex-like.

## Convex-First System Rule

Flarex must be developed Convex-first across the whole system, not only the
type system.

For backend storage, OCC, sync/subscriptions, scheduling, deployment metadata,
function analysis, generated APIs, `_generated/server`, `_generated/dataModel`,
function references, validators, query builders, mutation/query/action
registration, client APIs, local dev server, CLI/codegen flow, testing strategy,
and operational behavior, inspect Convex first and either:

1. port the relevant Convex package logic closely, or
2. document exactly why Flarex must diverge because of Cloudflare runtime,
   partitioning, service bindings, licensing, or a deliberately different
   Flarex API.

Do not invent a new design when Convex already has a portable pattern. Flarex's
default should be "same developer mental model and same core behavior as
Convex"; differences should be narrow, named, and recorded in `roadmaps/`.

## Required Per-Turn Record

Every repository-changing turn must update the relevant domain file under
`roadmaps/`.

Record:

- what changed
- why it changed
- the previous completed checkpoint's commit ID and title
- Convex source files inspected or used as inspiration
- how the Flarex design differs from Convex
- known limitations or follow-up work
- verification commands run

If a turn touches multiple domains, update multiple roadmap files. If no
existing domain file fits, create a new focused roadmap file instead of adding
one giant document.

Implementation histories must remain domain-specific. Do not create a global
chronological implementation log or add all project history to one giant
roadmap file.

Each domain roadmap must keep its own concise implementation checkpoint
history. A Git commit cannot contain its own final ID because changing the
roadmap changes the commit ID. Therefore:

- record the previous completed checkpoint in its relevant domain roadmap
  during the next repository-changing turn,
- report the newly created commit ID and title in the final response, and
- carry that new checkpoint into its relevant domain roadmap on the following
  repository-changing turn.

Discussion-only and research-only turns that do not change repository files do
not require an empty roadmap update or commit.

## Automatic Checkpoint Commits

After a repository-changing turn is implemented, documented, and successfully
verified, create a Git commit automatically without waiting for an additional
user request.

- Keep each commit scoped to the completed implementation step.
- Use an imperative commit title that explains the checkpoint.
- Do not commit known failing work unless the user explicitly requests it.
- Do not include unrelated user changes in the commit.
- Always report the commit ID and title in the final response.
- If verification fails or the work is incomplete, leave it uncommitted and
  explain the blocker.

## Where To Put Records

- Backend database and DO shape:
  `roadmaps/01-backend-data-model-and-do-shape.md`
- Schema placement and shards:
  `roadmaps/02-schema-placement-and-shards.md`
- OCC and transaction engine:
  `roadmaps/03-occ-and-transactions.md`
- Index storage and range reads:
  `roadmaps/04-indexes.md`
- Sync and subscriptions:
  `roadmaps/05-sync-and-subscriptions.md`
- Dynamic Worker execution:
  `roadmaps/06-dynamic-worker-execution.md`
- Cross-shard workflows:
  `roadmaps/07-cross-shard-workflows.md`
- Projections and denormalized read models:
  `roadmaps/08-projections.md`
- SDK and CLI fork strategy:
  `roadmaps/09-sdk-and-cli-fork.md`
- Runtime argument and document validation:
  `roadmaps/10-runtime-validation.md`
- Cross-system Convex-first porting policy:
  `roadmaps/13-convex-first-system-porting.md`
- Local dev server and Vite plugin runtime:
  `roadmaps/14-local-dev-server.md`
- Test SDK:
  `roadmaps/15-test-sdk.md`
- Package boundaries and backend runtime reuse:
  `roadmaps/16-package-boundaries.md`
- Deployment push, authoritative module analysis, and activation:
  `roadmaps/17-deployment-analysis-and-push.md`
- Postgres trusted executor, Nitro adapter, and PGlite local/test lane:
  `roadmaps/20-postgres-executor.md`

## Backend Rules

1. Keep `packages/flarex-backend` backend-only.
   `apps/backend` is only the deployable Wrangler wrapper. Do not add client
   APIs to either backend location. Client and generated developer APIs belong
   in `packages/flarex`, `packages/flarex-dev`, and future test/dev packages.

2. Treat the Postgres trusted executor as the forward authoritative data path.
   The older Durable Object shard implementation is prototype/legacy
   scaffolding. New storage, OCC, sync invalidation, and client API work should
   target `roadmaps/20-postgres-executor.md` unless the user explicitly asks to
   maintain the DO prototype.

3. Keep Nitro as an adapter, not the executor core. Trusted transaction logic
   belongs in framework-neutral packages such as `flarex-executor` and
   `flarex-postgres`; `flarex-executor-nitro` should only map Nitro/Vercel
   requests to that core.

4. Use PGlite for local and fast test lanes, but keep real Postgres as the
   required correctness lane for isolation, locks, migrations, outbox behavior,
   and production query plans.

5. Preserve Convex's core transaction idea.
   Function execution produces reads and writes, then commit validates reads
   against writes after the begin timestamp.

6. Make reads explicit.
   `db.get`, index queries, table scans, and future search reads must record
   read-set entries that can be checked at commit and used for subscriptions.

7. Make writes versioned.
   Store history with commit timestamps and keep current rows only as an
   optimization. Do not lose `prev_ts` or tombstone information in the
   authoritative path.

8. Preserve idempotency.
   Mutation identifiers/idempotency keys are part of backend semantics so
   retries do not duplicate writes.

9. Use database transactions correctly.
   Postgres/PGlite transaction helpers should own `BEGIN`/`COMMIT`/rollback.
   Do not hold a Postgres transaction open while waiting on untrusted user code
   in Cloudflare.

10. Keep Cloudflare DO names deterministic and tenant-scoped where DOs remain
    useful for deployment metadata, sync connections, schedulers, and future
    cache/freshness mirrors.

    ```txt
    registry:v1
    deployment:{deploymentId}
    connection:{deploymentId}:{sessionId}
    scheduler:{deploymentId}
    version:{deploymentId}:{bucket}
    query-cache:{deploymentId}:{queryHash}
    ```

11. Do not expose raw storage or database handles to user code.
    Dynamic Worker user code should call a restricted syscall API. The backend
    owns routing, transaction state, OCC validation, and persistence.

12. Prefer conservative correctness over hidden convenience.
    If a feature cannot provide Convex-like semantics on Cloudflare, expose the
    limitation in API design and generated errors instead of pretending it is
    transparent.

13. Keep Flarex-managed execution artifacts invisible to developers.
    Developers write ordinary TypeScript modules under `flarex/`; they do not
    write Worker entrypoints, `fetch` handlers, Wrangler configuration, or
    Dynamic Worker code. Flarex tooling bundles only the `flarex/` developer
    modules into a source package, and the Flarex platform creates and manages
    the internal execution artifact.

14. Treat backend analysis as authoritative.
    Local analysis may provide fast feedback, but deployed function paths,
    kinds, visibility, validators, schema, and source positions must come from
    analysis performed by the backend-controlled dynamic execution isolate.
    Final codegen and runtime validation must consume that authoritative
    analysis.

## Verification Rules

When backend code changes, run at least:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
```

For workspace-level changes, run:

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

If `wrangler dev` is started for smoke testing, stop the Wrangler process and
any `workerd` children before finishing.

Use `corepack pnpm --filter @flarex/backend deploy:dry-run` only when checking
the deployable Cloudflare wrapper. It may be slower or environment-sensitive
because it invokes Wrangler; do not make the normal workspace `build` depend on
it.
