# Architecture Decisions

## Refactor Medusa In Place

Decision recorded in:

- `4beed5bcec docs: record in-place persistence refactor strategy`

The fork will refactor Medusa in place instead of building parallel portable
commerce services.

We preserve:

- Existing Medusa module service classes.
- Existing DML models and public module contracts.
- Existing workflows and API behavior.
- Existing module integration assertions as the behavioral specification.
- MikroORM as the working default during migration.

We progressively make infrastructure adapter-driven so the same module service
can run with MikroORM/Postgres or Drizzle/SQLite/D1.

The target dependency flow is:

```text
existing Medusa module service
        |
        v
existing MedusaService-generated methods
        |
        v
portable internal-service and repository contracts
        |
        +-- MikroORM adapter
        |
        +-- Drizzle adapter
```

## Prohibited Direction

Do not create or expand side-by-side portable module-service hierarchies.

The parallel portable Currency service was removed after its useful
implementation pieces moved underneath Medusa's actual services, loaders, and
test runner.

Do not rebuild Medusa bootstrap, repository registration, module services,
route behavior, middleware behavior, events, or workflows inside
`apps/medusa-cloudflare`. The app is a deployment and composition root, not a
second framework implementation.

## Migration Discipline

- Complete one narrow vertical slice at a time.
- Keep MikroORM behavior passing while adding adapters.
- Preserve interfaces before replacing implementations.
- Refactor shared Medusa packages so Node and Cloudflare compositions reuse the
  same bootstrap and behavior.
- Do not simultaneously refactor persistence, events, workflows, HTTP,
  discovery, and Cloudflare bootstrap.

See `../cloudflare-port-refactor-plan.md` for the complete migration sequence.

## Durable Object Proof Versus Final Partition Topology

Decision:

- Continue the current in-place Medusa and Drizzle persistence refactor.
- Treat `CurrencyProofDO` and later aggregate-specific DO slices as disposable
  acceptance fixtures.
- Do not introduce the final hosted platform tenant/deployment partition
  runtime during the current persistence milestone.
- Do not encode module-per-DO, record-per-DO, or aggregate-per-DO assumptions
  into shared repository, manager, module-service, or DML contracts.

The future hosted runtime may use a generic tenant/deployment-scoped partition
DO that colocates multiple Medusa modules within a useful business transaction
boundary. It must reuse the portable and atomic persistence contract proven by
the current milestone rather than forcing another module-service rewrite.

## Flarex Storage Boundary

Decision:

- Do not make Flarex's developer-facing document `ctx.db` the Medusa module
  persistence API.
- Keep Medusa commerce data owned by Medusa persistence adapters, DML models,
  module services, workflows, and unchanged integration assertions.
- Allow Medusa adapters to consume a Flarex-owned platform storage runtime for
  tenant, project, deployment, Durable Object, D1, SQLite, Postgres, partition,
  and projection binding resolution.
- Keep Flarex `ctx.db` for custom application data and extension records that
  reference Medusa resources by typed commerce IDs.
- Bridge custom data and commerce behavior through `ctx.commerce`, Medusa
  workflows, outbox events, dependency tokens, and projections.

This preserves the distinction between sharing a multitenant storage substrate
and sharing one logical schema. A future Flarex-backed Medusa persistence
adapter is allowed only if it passes the unchanged Medusa module and API
integration suites through the real Medusa service paths.

Affected boundary:

- `plan/roadmaps/hosted-programmable-medusa.md`
- `plan/roadmaps/developer-framework-api-over-medusa-core.md`
- Future Flarex/Medusa storage resolver and persistence adapter composition.

Validation:

- Documentation-only clarification. No runtime behavior changed.

Commit:

- `docs: clarify flarex medusa storage boundary`

## FlarexDB Medusa Reserved Tables And Tenancy

Decision:

- Treat a future Flarex-backed Medusa storage adapter as a Medusa reserved
  commerce namespace inside the FlarexDB data plane.
- The accepted foundation model is one FlarexDB control plane with two storage
  shapes: app/Payload data uses an Instant-like entity, attribute, and relation
  graph; Medusa system data uses real relational tables generated from Medusa
  DML.
- CMS-marked Payload collections remain sourced from Flarex app schema. Payload
  config is a generated runtime artifact, and Payload's database adapter maps
  operation semantics into Flarex primitives instead of owning a second app
  schema.
- Complex Payload fields must not be flattened into simple attrs by default.
  Arrays and queryable blocks compile to ordered child entities; relationships
  and uploads compile to typed relation edges; polymorphic relationships include
  a target collection discriminator; localized data uses locale-scoped attrs,
  child rows, or edges; Join fields are virtual reverse relations; versions,
  drafts, auth state, sessions, uploads, and document locks use hidden system
  stores.
- JSON remains valid for rich text, opaque blocks, plugin data, and whole-value
  reads, but it is not sufficient for fields that need Payload admin filtering,
  relationship population, localized merging, reverse joins, ordered row
  updates, or version/draft semantics.
- Lifecycle-sensitive CMS collections and fields default to Payload-only writes.
  Direct public `ctx.db` writes must not bypass Payload validation, access,
  hooks, upload cleanup, auth/session behavior, draft status, or version
  snapshots.
- Medusa DML models remain the source of truth for that reserved commerce
  schema. A FlarexDB adapter should compile Medusa `model.define(...)` metadata
  into internal FlarexDB catalog records, schema versions, and physical table
  mappings instead of hand-authoring duplicate Medusa tables in Flarex.
- The Flarex-backed Medusa adapter must call an internal FlarexDB persistence
  API. It must not receive raw Postgres, Hyperdrive, D1, Durable Object SQLite,
  or physical SQL table access.
- The internal FlarexDB layer remains responsible for tenant scope injection,
  schema catalog mapping, migrations, relation/link storage, indexes,
  constraints, commit protocol, transaction binding, OCC/read-set validation,
  outbox, freshness, sync invalidation, and projection maintenance.
- Medusa modules that currently use raw SQL, Knex, query builders, or
  provider-specific database execution must be handled as FlarexDB
  adapter-specific repository or provider implementations. The service layer
  and shared Medusa assertions remain the behavior owner.
- Cross app-and-commerce atomicity requires an explicit shared FlarexDB
  transaction session. App writes use app graph storage, while commerce writes
  must enter through Medusa-owned commands, workflows, repositories, and
  adapter semantics. App code must not directly mutate Medusa reserved tables.
- Flarex mutations and `ctx.db.transact` callbacks should be bounded
  transaction phases, not long-running arbitrary jobs. The design follows the
  Convex-style split where short deterministic transactional user code commits
  state, while long work runs in actions, workflows, jobs, or post-commit
  outbox subscribers.
- FlarexDB should enforce transaction leases and quotas for user-code time,
  read/write bytes, rows or documents scanned, rows or documents written,
  index/range reads, and outbox fanout so retries, OCC validation, lock
  duration, and crash recovery remain bounded.
- Existing Medusa workflow definitions remain the commerce behavior owner. A
  Flarex-backed commerce facade should run those workflows with a
  Flarex-backed transaction manager/session, a Flarex-owned event group, and
  event release disabled until the outer Flarex commit succeeds.
- Existing Medusa locking semantics remain the commerce coordination contract.
  Medusa workflows and services should keep calling `Modules.LOCKING` and
  `ILockingModule`; the Flarex-backed runtime supplies the provider underneath.
- A FlarexDB lock provider should use reserved system lease storage or a
  Cloudflare-safe coordinator such as Durable Objects, with
  tenant/project/deployment scope, owner tokens, TTLs, deterministic multi-key
  acquisition, and fencing tokens. Lock rows must not be exposed through public
  `ctx.db`, Payload CMS, or custom app schema.
- When a Medusa workflow is nested inside `ctx.db.transact`, Medusa workflow
  success is only logical completion. FlarexDB remains the commit authority for
  app writes, Medusa reserved-table writes, workflow state, grouped events, and
  outbox release.
- Crash recovery must handle pre-commit, post-workflow/pre-commit, and
  post-commit/pre-event-release states. Pre-commit failures roll back or expire
  staged app and commerce writes and clear grouped events; post-commit failures
  replay the Flarex outbox idempotently.
- The outbox is a durable post-commit synchronization layer, not source data.
  It must be written atomically with authoritative app graph writes, Medusa
  reserved-table writes, correctness indexes, relation/link rows, and commit
  records. Freshness, live-query reruns, projections, search, Medusa events,
  Payload events, webhooks, and jobs consume outbox records idempotently.
- In the Worker/Hyperdrive deployment shape, the FlarexDB executor Worker should
  directly wake `DeploymentSyncDO` after a successful commit. That direct call is
  only the fast path; the durable FlarexDB outbox and consumer cursor remain the
  recovery and ordering source if the wake fails, the Worker crashes, or the DO
  is evicted.
- The first Cloudflare live-sync topology should split only on real platform
  pressure: `ConnectionDO` owns hibernating browser WebSockets and client
  sessions, while `DeploymentSyncDO` owns commit/outbox/freshness state,
  affected-subscription discovery, query rerun dedupe, and delivery to
  `ConnectionDO`s.
- `DeploymentSyncDO` is the Convex-like hot live-sync engine in the proposed
  FlarexDB path. It should keep a bounded in-memory write-log window, active
  read-set indexes, coalesced rerun queues, subscription freshness cursors, and
  result hashes. Durable FlarexDB tables and outbox cursors remain the replay
  and recovery layer, not the normal per-commit invalidation engine.
- Do not introduce separate `QueryDO`, `ProjectionDO`, or `DeliveryDO` services
  at the foundation. Add them later only when shared-query reruns, projection
  rebuilds, or delivery fanout become measured bottlenecks.
- Direct wake should carry a compact commit summary, or a pointer to a bounded
  durable summary, containing changed document ids, app entity/attr ids,
  relation edge keys, Medusa row ids, Medusa link-row ids, table ids,
  index/range keys, projection dependency keys, write source, deployment/tenant
  scope, commit ts, and outbox sequence. Live-sync matching should not require
  rescanning physical tables after every commit.
- Live-query reruns should be coalesced to the latest safe commit version and
  deduped by result hash before sending WebSocket transitions.
- Cloudflare Queues are optional scale/retry transports for heavy or external
  consumers. REST callbacks remain compatibility adapters for Node/VPS or remote
  executor deployments, not the default same-Worker sync path.
- Projection/materialized read-model rows are Flarex-owned derived read
  helpers, stored in internal namespaces in the same FlarexDB by default. Live
  query planners may read them only when their freshness is sufficient for the
  required commit/dependency version; otherwise queries rerun from source data
  or wait for catch-up.
- Do not expose projections as a primary public developer API in the proposed
  FlarexDB design. Public app code should use normal tables, relations,
  indexes, ordering, pagination, and explicit app-owned derived fields first;
  internal read models remain Flarex planner/runtime infrastructure.
- Commerce locks must be acquired in deterministic order, held only for the
  atomic write phase, and not held across arbitrary app code, remote APIs, or
  long workflow pauses. Locks reduce high-contention concurrency; OCC/read-set
  validation and the Flarex commit protocol still provide final correctness.
- The FlarexDB OCC/read-set model must expand beyond document, table, index,
  and relation-edge reads to include Medusa row reads, Medusa link-row reads,
  and Medusa query/index/range reads.
- Medusa commerce records are real authoritative system tables, not projection
  tables and not public Flarex application `ctx.db` tables.
- Medusa reserved tables are writable only through Medusa-owned services,
  workflows, repository contracts, and the Flarex-backed Medusa adapter.
- Flarex application tables may reference public commerce IDs through typed
  Flarex-owned relations, but those references do not become Medusa Module
  Links or Medusa-owned schema by default.
- Projection/materialized read-model tables remain optional Flarex-owned
  internal read helpers for expensive browse, admin, search, leaderboard, or
  cross-partition read paths. They are rebuildable from authoritative app
  tables, Medusa reserved tables, commits, and outbox records.
- Medusa multitenancy is injected by Flarex tenant/project/deployment runtime
  context. Medusa `store`, `region`, and `sales_channel` remain commerce domain
  records inside that isolated commerce space, not the primary platform tenant
  boundary.

Affected boundary:

- `plan/roadmaps/flarex-instant-like-medusa-storage.md`
- Future Flarex-backed Medusa persistence adapter.
- Future Flarex tenant/deployment storage resolver.

Validation:

- Documentation-only clarification. No runtime behavior changed.

Commit:

- Pending.
