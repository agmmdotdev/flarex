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

## Proposed Flarex Physical Schema

The exact DDL can evolve, but the shape should start here:

```sql
deployments (
  deployment_id text primary key,
  project_id text not null,
  active_schema_version bigint not null,
  active_push_id text,
  created_at timestamptz not null
);

table_mapping (
  deployment_id text not null,
  table_name text not null,
  table_id bigint not null,
  table_kind text not null,
  document_validator jsonb not null,
  primary key (deployment_id, table_name),
  unique (deployment_id, table_id)
);

index_definitions (
  deployment_id text not null,
  index_id bigint not null,
  table_id bigint not null,
  index_name text not null,
  fields jsonb not null,
  state text not null,
  primary key (deployment_id, index_id),
  unique (deployment_id, table_id, index_name)
);

documents (
  deployment_id text not null,
  table_id bigint not null,
  document_id text not null,
  commit_version bigint not null,
  json_value jsonb,
  deleted boolean not null,
  prev_version bigint,
  primary key (deployment_id, commit_version, table_id, document_id)
);

current_documents (
  deployment_id text not null,
  table_id bigint not null,
  document_id text not null,
  commit_version bigint not null,
  json_value jsonb,
  deleted boolean not null,
  primary key (deployment_id, table_id, document_id)
);

index_entries (
  deployment_id text not null,
  index_id bigint not null,
  encoded_key bytea not null,
  commit_version bigint not null,
  table_id bigint not null,
  document_id text not null,
  deleted boolean not null,
  primary key (deployment_id, index_id, encoded_key, commit_version)
);

commits (
  deployment_id text not null,
  commit_version bigint not null,
  source text not null,
  write_summary jsonb not null,
  committed_at timestamptz not null,
  primary key (deployment_id, commit_version)
);

outbox (
  deployment_id text not null,
  commit_version bigint not null,
  sequence bigint not null,
  event jsonb not null,
  delivered_at timestamptz,
  primary key (deployment_id, commit_version, sequence)
);
```

The `current_documents` table is an optimization, not the source of historical
truth. The versioned `documents`, `index_entries`, `commits`, and `outbox`
tables are what make OCC, sync invalidation, replay, and cache repair possible.

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
  users   -> table_id 1
  lessons -> table_id 2

index_definitions
  users.by_name   -> index_id 10
  lessons.by_user -> index_id 11

documents
  deployment_id, table_id=1, document_id=...
  deployment_id, table_id=2, document_id=...

index_entries
  deployment_id, index_id=10, encoded_key=(name, _id)
  deployment_id, index_id=11, encoded_key=(userId, _id)
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
- Existing Flarex code still has a Durable Object authoritative prototype.
  This Postgres schema is the intended persistence shape for the
  Postgres-authoritative track.

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
