# Flarex Design Notes

This folder holds accepted architecture decisions and exploratory design
findings that are not implementation roadmaps yet.

Use this folder for architecture comparisons, alternative authority models, and
research write-ups that should inform later roadmap work but should not become
the chronological implementation history. When a design note becomes an
implementation checkpoint, record the active work in the relevant `roadmaps/`
domain file.

## Authority Order

For FlarexDB app-data and relationship work, use these sources in order:

1. `flarex-db-accepted-design.md` owns the general Postgres authority,
   transaction, migration, sync, Payload, and Medusa boundaries.
2. `flarexdb-framework-storage-architecture.md` owns shared cross-framework
   artifact, installation, binding, migration, transaction, commit, relation-
   profile, and adapter boundaries.
3. `flarexdb-native-relational-system.md` owns application/document relation
   API layering, logical semantics, identity, edge authority, OCC,
   build/readiness, and reactive invalidation.
4. `flarexdb-payload-relational-adapter.md` owns only the mapping from Payload
   relationship, upload, join, transaction, population, and lifecycle behavior
   onto the native FlarexDB relational system.
5. `flarexdb-medusa-commerce-adapter.md` owns Medusa reserved-table,
   schema-compilation, Module Link, transaction, CMS-interaction, scalability,
   and adapter-admission semantics over FlarexDB.
6. The focused files under `roadmaps/flarexdb-foundation/` own application-
   foundation execution and status; `roadmaps/flarexdb-framework-integration/`
   owns shared-mechanism extraction and adapter execution/status.

Older relationship examples in broad CMS, commerce, developer-API, InstantDB,
or internal-schema notes remain research vocabulary. They do not override the
native relational authority above.

## Notes

- `runtime-agnostic-query-sync-engine.md`
  - Accepted cross-domain decision to extract one small private query-result
    synchronization engine with runtime-neutral state semantics and
    conformance, while retaining Postgres/Flarex/Cloudflare as adapters and
    evaluating upstream Durable Streams only as the replaceable delivery log.
    Implementation order and gates live under `roadmaps/query-sync-engine/`.

- `flarex-postgres-persistence-domain-separation-idea.md`
  - Exploratory, snapshot-based idea for separating domain policy,
    orchestration, repository contracts, Postgres adapters, transactions, and
    compatibility surfaces that currently coexist in
    `@flarex/persistence-postgres`. It authorizes no migration and must be
    revalidated against the working tree before becoming a roadmap.

- `flarex-durable-task-engine.md`
  - Accepted direction for extracting Trigger.dev's first-class task-definition
    and durable-run semantics into a canonical Standard Application task
    catalog plus a host-neutral Flarex state machine backed by a private
    FlarexDB Task System API and Cloudflare/compute-provider adapters. Current
    Flarex actions are not task authority. Trigger remains an inactive
    compatibility island rather than a runtime dependency. Private lifecycle,
    Postgres, scheduling, provider, and delivery foundations now exist, while
    connected runtime work is held behind a capability-local Trigger source
    audit and the first end-to-end private vertical.

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
    When an older general FlarexDB design note conflicts with it, this document
    controls.

- `flarexdb-framework-storage-architecture.md`
  - Accepted cross-domain architecture for one Flarex-managed committed-data
    authority, separate Application/Payload/Medusa semantic lanes, document and
    reserved-relational storage profiles, schema artifact/install/binding
    coordination, migration and transaction hosts, typed commit participation,
    relation authority profiles, and private framework adapters.

- `flarexdb-native-relational-system.md`
  - Accepted application/document relation architecture. Native relations are
    represented by Standard Application intent, executed through FlarexDB
    System APIs, proved first by internal test producers, and made ergonomic
    later by developer APIs. Authoritative row values derive current edge
    sidecars; compatible Payload content adapts to this system. Medusa Module
    Link semantics remain Medusa-owned over the separate relational substrate.

- `flarexdb-payload-relational-adapter.md`
  - Accepted Payload adapter boundary over the native FlarexDB relation system.
    It maps Payload relationships, uploads, joins, request transactions,
    population, nested/localized fields, and later lifecycle behavior without
    copying Payload's physical `_rels` model or creating another row authority.
    It also owns the CMS view, CMS-managed, and app-command-managed write
    authority distinction: an editable CMS table uses one Payload command
    pipeline for dashboard and generated `ctx.cms` writes rather than retaining
    an unrestricted parallel `ctx.db` writer.

- `flarexdb-medusa-commerce-adapter.md`
  - Accepted Medusa adapter boundary over Flarex-owned physical storage. Medusa
    retains module, repository, Query, Link, workflow, lock, soft-delete, and
    commerce-invariant authority. Reserved commerce link rows may reuse native
    identity, adjacency-OCC, query, and change-fact algorithms where their
    semantics match, without treating current app-edge storage as a link table,
    becoming public app relations, or creating a second writable authority.

- `postgres-authoritative-sync.md`
  - Accepted Flarex Postgres/Cloudflare adapter topology, per-scope durable
    coordination and deferred cache layers over the separately owned portable
    Query Sync Engine semantics.
- `postgres-multitenant-persistence-schema.md`
  - Implemented baseline for the current Convex-style generic document/index
    persistence. Future FlarexDB design notes supersede it for app/Payload
    storage with typed JSON rows plus relational sidecars.
- `flarex-instant-like-medusa-storage.md`
  - Condensed archive of the broad InstantDB, Payload, and Medusa storage
    research. It preserves durable findings and rejected alternatives only;
    Git retains the former long-form chronology. It is not a current decision
    owner.
- `flarex-internal-db-schema.md`
  - Proposed internal FlarexDB schema direction for platform catalog data,
    typed app/Payload JSON rows, relational sidecars, Medusa reserved commerce
    tables/link entities, commit/OCC metadata, outbox, sync cursors, locks,
    workflow state, and optional internal read models. Use its
    accepted-corrections section and the focused authority notes for
    implementation decisions.
- `flarex-developer-backend-api.md`
  - Proposed backend-only developer API for schemas, validators, relations,
    indexes, functions, `ctx.db`, transactions, commerce, CMS, live sync, and
    query ceilings. Its relation syntax is ergonomic research only; the native
    System and Standard relation contracts control.
- `flarex-commerce-cms-sections-blocks.md`
  - Long-term CMS/commerce and storefront-composition vocabulary. Its relation
    examples describe desired product ergonomics but do not define the native
    FlarexDB System API, Standard relation AST, edge storage, or Payload adapter
    authority.
- `flarex-runtime-admin-extensions.md`
  - Runtime admin extension architecture for a centralized Flarex dashboard
    with signed manifests, scoped admin context APIs, and sandboxed runtime
    slots.
- `flarex-realtime-room-actors-draft.md`
  - Draft-only future idea for Durable Object backed actor hot state, separate
    from `ctx.db`, for chat rooms, AI agents, multiplayer sessions, presence,
    collaboration, and other low-latency workloads.
