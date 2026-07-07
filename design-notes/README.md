# Flarex Design Notes

This folder holds exploratory design findings that are not implementation
roadmaps yet.

Use this folder for architecture comparisons, alternative authority models, and
research write-ups that should inform later roadmap work but should not become
the chronological implementation history. When a design note becomes an
implementation checkpoint, record the active work in the relevant `roadmaps/`
domain file.

## Notes

- `postgres-authoritative-sync.md`
  - Postgres as source of truth with Cloudflare WebSocket/cache/freshness
    layers.
- `postgres-multitenant-persistence-schema.md`
  - Convex-style multitenant generic document/index persistence for the
    Postgres-authoritative Flarex track.
- `flarex-instant-like-medusa-storage.md`
  - Research note on evolving FlarexDB toward an InstantDB-like relational
    graph, while sharing one Flarex-owned data plane with Medusa commerce and
    Payload-style CMS logic.
- `flarex-internal-db-schema.md`
  - Proposed internal FlarexDB schema direction for platform catalog data,
    app/Payload data, Medusa reserved system tables, commit/OCC metadata,
    outbox, sync cursors, locks, workflow state, and optional internal read
    models.
- `flarex-developer-backend-api.md`
  - Proposed backend-only developer API for schemas, validators, relations,
    indexes, functions, `ctx.db`, transactions, commerce, CMS, live sync, and
    query ceilings.
- `flarex-runtime-admin-extensions.md`
  - Runtime admin extension architecture for a centralized Flarex dashboard
    with signed manifests, scoped admin context APIs, and sandboxed runtime
    slots.
- `flarex-realtime-room-actors-draft.md`
  - Draft-only future idea for Durable Object backed actor hot state, separate
    from `ctx.db`, for chat rooms, AI agents, multiplayer sessions, presence,
    collaboration, and other low-latency workloads.
