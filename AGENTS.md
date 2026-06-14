# Flarex Agent Rules

These are operating rules for future agents working in this workspace. Feature
design records, implementation notes, Convex references, and Cloudflare
differences belong in `roadmaps/`, not in this file.

## Core Rule

Flarex is a Convex-inspired backend on Cloudflare. Implement it with care:
copy Convex semantics where they are portable, and explicitly document where
Cloudflare Durable Objects require a different design.

Do not build a generic CRUD server and call it Convex-like.

## Required Per-Turn Record

Every implementation turn must update the relevant domain file under
`roadmaps/`.

Record:

- what changed
- why it changed
- Convex source files inspected or used as inspiration
- how the Flarex design differs from Convex
- known limitations or follow-up work
- verification commands run

If a turn touches multiple domains, update multiple roadmap files. If no
existing domain file fits, create a new focused roadmap file instead of adding
one giant document.

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

## Backend Rules

1. Keep `apps/backend` backend-only.
   Do not add client APIs here. Client and generated developer APIs belong in
   `packages/flarex` and generator packages.

2. Treat `DeploymentDO` as the authoritative deployment metadata owner.
   Schema, table mapping, index definitions, placement rules, and function
   metadata belong there. `PartitionDO` may cache schema metadata, but it should
   not become the source of truth for schema.

3. Treat `PartitionDO` as the authoritative shard database.
   It owns local documents, indexes, write log, idempotency, and the local OCC
   boundary for one `{deploymentId, partitionKey}`.

4. Keep normal `mutation` single-shard.
   Do not add global transaction claims for cross-shard writes. Cross-shard
   writes must go through explicit workflow semantics.

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

9. Use Cloudflare storage transactions correctly.
   Durable Object SQLite should use `ctx.storage.transaction(...)` for atomic
   multi-statement changes. Do not manually issue `BEGIN` or `COMMIT` through
   `sql.exec`.

10. Keep DO names deterministic and tenant-scoped.

    ```txt
    registry:v1
    deployment:{deploymentId}
    partition:{deploymentId}:{partitionKey}
    connection:{deploymentId}:{sessionId}
    scheduler:{deploymentId}
    ```

11. Do not expose raw storage bindings to user code.
    Dynamic Worker user code should call a restricted syscall API. The backend
    owns routing, transaction state, OCC validation, and persistence.

12. Prefer conservative correctness over hidden convenience.
    If a feature cannot provide Convex-like semantics on Cloudflare, expose the
    limitation in API design and generated errors instead of pretending it is
    transparent.

## Verification Rules

When backend code changes, run at least:

```sh
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend test
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
