# Flarex Design Notes

This folder holds accepted architecture decisions and exploratory design
findings that are not implementation roadmaps yet.

Use this folder for architecture comparisons, alternative authority models, and
research write-ups that should inform later roadmap work but should not become
the chronological implementation history. When a design note becomes an
implementation checkpoint, record the active work in the relevant `roadmaps/`
domain file.

## Notes

- `flarex-durable-task-engine.md`
  - Accepted direction for extracting Trigger.dev's durable-run semantics into
    a host-neutral Flarex state machine backed by a private FlarexDB Task
    System API and Cloudflare/compute-provider adapters. Trigger remains an
    inactive compatibility island, and pnpm workspace integration is deferred
    to a separate design decision.

- `flarex-dynamic-worker-bundle-partitioning.md`
  - Accepted runtime design direction for automatic, size-bounded Dynamic
    Worker execution groups; transaction, edge-action, Node-action, and future
    heavy/job capability profiles; provider-neutral action placement; runtime
    projections; same-session remote nested calls; latency-aware colocation;
    speculative preparation; the verified Convex AWS Lambda and authenticated
    action-callback reference model; cross-provider readiness/rollback gates;
    and oversized-dependency diagnostics. Implementation remains owned by the
    runtime and push roadmaps.

- `flarex-db-accepted-design.md`
  - Authoritative review and accepted correction for the unified FlarexDB
    schema, commit compiler, sync engine, Payload adapter, and Medusa boundary.
    When an older design note conflicts with it, this document controls.

- `postgres-authoritative-sync.md`
  - Accepted v1 Postgres-authoritative sync topology and deferred cache layers.
- `postgres-multitenant-persistence-schema.md`
  - Implemented baseline for the current Convex-style generic document/index
    persistence. Future FlarexDB design notes supersede it for app/Payload
    storage with typed JSON rows plus relational sidecars.
- `flarex-instant-like-medusa-storage.md`
  - Research note on evolving FlarexDB toward a Convex-like transactional
    runtime with InstantDB-inspired derived edges/indexes, while sharing one
    Flarex-owned data plane with Medusa commerce and Payload-style CMS logic.
    Its mixed app/commerce transaction proposal is historical and is corrected
    by `flarex-db-accepted-design.md`.
- `flarex-internal-db-schema.md`
  - Proposed internal FlarexDB schema direction for platform catalog data,
    typed app/Payload JSON rows, relational sidecars, Medusa reserved system
    tables, commit/OCC metadata, outbox, sync cursors, locks, workflow state,
    and optional internal read models. Use its accepted-corrections section and
    `flarex-db-accepted-design.md` for implementation decisions.
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
