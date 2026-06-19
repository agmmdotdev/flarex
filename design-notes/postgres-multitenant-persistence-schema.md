# Postgres Multitenant Persistence Schema

This note records the storage-shape decision for the Postgres-authoritative
Flarex design.

```txt
Developer-facing schema stays Convex-style.
Physical Postgres schema is a shared multitenant document/index store.
Flarex does not create one SQL table per developer table.
```

## Decision

Flarex should copy Convex's logical persistence model closely:

- `defineSchema` and `defineTable` remain the public developer schema model.
- Developer tables are logical tables with stable table IDs.
- Documents are stored in generic physical tables keyed by deployment,
  logical table ID, document ID, and version.
- User indexes are stored as encoded index entries in generic physical index
  tables.
- Commits write document history, index history, and sync/outbox metadata
  together.
- Multitenancy is represented by a deployment/project identity column on every
  authoritative physical table.

This is different from a Prisma/Supabase-style design where every app table
becomes its own SQL table. That SQL-native approach would make normal Postgres
queries easier, but it would move Flarex away from Convex's schema push,
generated data model, logical document IDs, versioned history, OCC, and live
query invalidation model.

## Convex Reference Shape

Convex's Postgres persistence has a multitenant mode. The cluster code chooses
`PostgresMultitenant`, propagates a schema/search path, and marks persistence
as multitenant. The DB connection layer then passes `schema`,
`instance_name`, and `multitenant` into `PostgresOptions`.

Convex's physical Postgres tables are generic persistence tables. The key
ones are:

```txt
documents
indexes
leases
read_only
persistence_globals
```

In multitenant mode, those tables include `instance_name` and queries filter by
that instance. `documents` stores document history by timestamp, table ID, and
document ID. `indexes` stores encoded index keys by index ID, timestamp, table
ID, and document ID.

Convex source references:

- `crates/clusters/src/lib.rs`
  - `DbDriverTag::PostgresMultitenant` sets `schema: Some(...)` and
    `multitenant: true`.
- `crates/db_connection/src/lib.rs`
  - `PostgresOptions` carries `schema`, `instance_name`, and `multitenant`.
- `crates/postgres/src/sql.rs`
  - defines generic `documents` and `indexes` tables with optional
    `instance_name` columns and filters.
- `crates/value/src/table_mapping.rs`
  - separates logical table names from internal table numbers/tablets.

## Implemented First Flarex Physical Schema

The first implemented migration intentionally copies Convex's current
Postgres persistence table shape more closely than the earlier rough sketch.
The authoritative document and index payload columns are byte-encoded so the
future value codec can stay Convex-compatible instead of locking the storage
layer to JSONB too early.

The TypeScript source of truth for this schema now lives in Drizzle table
definitions under `packages/persistence-postgres/src/schema.ts`. Migration files
are package-local under `packages/persistence-postgres/drizzle/` and generated with
Drizzle Kit from the package-local `drizzle.config.ts`.

The initial migration keeps one manual SQL adjustment: Drizzle Kit renders the
custom `bytea` type as a quoted custom type (`"bytea"`), so the generated SQL is
edited to use Postgres' built-in `bytea` type. This preserves the
Convex-compatible binary storage layout while still letting Drizzle Kit own the
migration snapshot and history.

```sql
deployments (
  deployment_id text primary key,
  project_id text not null,
  active_package_id text,
  active_schema_version bigint not null default 0,
  created_at timestamptz not null default now()
);

documents (
  deployment_id text not null,
  id bytea not null,
  ts bigint not null,
  table_id bytea not null,
  json_value bytea not null,
  deleted boolean not null,
  prev_ts bigint,
  primary key (deployment_id, ts, table_id, id)
);

indexes (
  deployment_id text not null,
  index_id bytea not null,
  ts bigint not null,
  key_prefix bytea not null,
  key_suffix bytea,
  key_sha256 bytea not null,
  deleted boolean,
  table_id bytea,
  document_id bytea,
  primary key (deployment_id, index_id, key_sha256, ts)
);

leases (
  deployment_id text primary key,
  ts bigint not null
);

read_only (
  deployment_id text primary key
);

persistence_globals (
  deployment_id text not null,
  key text not null,
  json_value bytea not null,
  primary key (deployment_id, key)
);

commits (
  deployment_id text not null,
  ts bigint not null,
  source text not null,
  write_summary jsonb not null,
  committed_at timestamptz not null,
  primary key (deployment_id, ts)
);

outbox (
  deployment_id text not null,
  ts bigint not null,
  sequence bigint not null,
  event jsonb not null,
  delivered_at timestamptz,
  primary key (deployment_id, ts, sequence)
);
```

The `documents`, `indexes`, `leases`, `read_only`, and `persistence_globals`
tables are copied from Convex's multitenant Postgres persistence shape with
`deployment_id` replacing Convex's `instance_name`.

The `deployments`, `commits`, and `outbox` tables are Flarex-owned platform
tables. They support hosted deployment metadata, commit ordering, and live sync
fanout. They are deliberately separate from the Convex-like persistence tables.

The earlier `current_documents`, `table_mapping`, and `index_definitions`
sketch is deferred. Convex stores much of this as system metadata rather than
SQL-native app tables. Flarex should avoid adding these until the source
package/deployment metadata model proves which parts need SQL tables versus
versioned system documents or `persistence_globals`.

## Drizzle Boundary

Use Drizzle for:

- table definitions,
- typed platform metadata access,
- typed raw SQL expressions via Drizzle `sql`,
- package-local migration generation and tracking,
- local/test PGlite wiring,
- future drizzle-kit generated migrations for non-hot-path tables.

Keep explicit SQL for:

- exact Convex-style `documents` and `indexes` DDL,
- hot read/index scan queries expressed as Drizzle `sql` objects,
- batch document/index writes expressed as Drizzle `sql` objects,
- OCC conflict checks expressed as Drizzle `sql` objects,
- any query where the specific plan or index order is part of correctness.

This split avoids raw ad hoc SQL for ordinary metadata while preserving full
control over the storage-engine paths that need to mimic Convex. The
`@flarex/persistence-postgres` persistence interface exposes `execute(sql``...``)` for these
engine paths and keeps plain string `exec/query` only as a lower-level adapter
escape hatch.

## Logical Data Model

For a developer schema like this:

```ts
export default defineSchema({
  users: defineTable({
    name: v.string(),
  }).index("by_name", ["name"]),

  lessons: defineTable({
    userId: v.id("users"),
    title: v.string(),
  }).index("by_user", ["userId"]),
});
```

Postgres should not create physical `users` and `lessons` tables. Instead:

```txt
table_mapping
  users   -> table_id bytes
  lessons -> table_id bytes

index metadata
  users.by_name   -> index_id bytes
  lessons.by_user -> index_id bytes

documents
  deployment_id, table_id=1, document_id=...
  deployment_id, table_id=2, document_id=...

indexes
  deployment_id, index_id=10, key_prefix/key_suffix/key_sha256=(name, _id)
  deployment_id, index_id=11, key_prefix/key_suffix/key_sha256=(userId, _id)
```

The developer still sees Convex-style IDs, validators, generated API refs, and
query builders. The physical tables stay generic.

## Why This Fits Flarex

This design matches the user's platform goal:

```txt
one hosted Flarex platform
many projects/deployments
Convex-like client and server APIs
Cloudflare Dynamic Worker execution
Postgres authoritative commits
Cloudflare sync/cache fanout
```

Generic multitenant persistence makes it possible to run many deployments on
one Postgres cluster without per-app DDL. It also lets the deployment push flow
activate schema changes as metadata, like Convex, instead of requiring SQL
migrations for every developer table.

## Differences From Convex

Flarex should copy the model, not the exact implementation:

- Convex's backend and database engine run close together; Flarex may run
  untrusted user code in Cloudflare Dynamic Workers and commit through a
  trusted executor near Postgres.
- Convex names the tenant discriminator `instance_name`; Flarex should use a
  platform term such as `deployment_id` or `project_deployment_id`.
- Convex has mature table mapping, tablet, timestamp, retention, import/export,
  and lease machinery; Flarex should add only the subset needed for the first
  correct transaction and sync loop.
- Existing Flarex code still has a Durable Object authoritative prototype, but
  that implementation is now legacy scaffolding. This Postgres schema is the
  intended authoritative persistence shape.

## Operational Notes

The first Postgres implementation should prioritize correctness over SQL-native
convenience:

- every authoritative row must include `deployment_id`,
- every query must scope by `deployment_id`,
- table IDs and index IDs must be stable across active schema versions,
- document history must preserve tombstones and previous versions,
- mutations must write document/index changes and outbox events in the same
  transaction,
- live query invalidation must consume committed outbox/change-log events,
- caches in Cloudflare must be rebuildable from Postgres.

Physical SQL projections can be added later for analytics, search, reporting,
or very hot app-specific workloads. They must not become the authoritative
Convex-style data model unless the API semantics are deliberately changed.

## Open Questions

- Should the tenant discriminator be named `deployment_id`, `instance_name`, or
  a pair of `project_id` and `deployment_id`?
- Do we keep a separate `current_documents` table or use partial indexes/views
  over versioned history for the first implementation?
- Do range freshness versions live in `commits`, a separate range-version
  table, or only in the sync cache layer?
- How much of Convex's tablet/table-number model should be ported before the
  first production schema?
- Should enterprise tenants be movable from shared tables to dedicated
  Postgres databases without changing public IDs?
