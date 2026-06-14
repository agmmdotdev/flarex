# Postgres Storage Model

> Status: alternative storage design for full Convex-style global OCC. The
> current primary Cloudflare-native design uses partition Durable Objects with
> SQLite for authoritative partition-local data and projections for global read
> models.

Postgres is the source of truth, but the logical model should remain a Convex
document database, not arbitrary user-defined SQL tables.

## Design Goal

Store enough information to support:

- snapshot reads
- ordered index scans
- atomic document writes
- OCC read-set validation
- live query invalidation
- mutation idempotence
- retention and compaction

## Logical Tables

Convex user tables are logical tables. Postgres stores them generically:

```txt
logical table name -> table_id
logical document id -> document_id
logical index name -> index_id
encoded index value -> index_key bytea
```

This keeps the generated Convex API stable while allowing the backend to use a
fixed physical schema.

## Core Schema

### Commits

```sql
create table commits (
  deployment_id text not null,
  commit_ts bigint not null,
  write_source text,
  created_at timestamptz not null default now(),
  primary key (deployment_id, commit_ts)
);
```

`commit_ts` is the serialization order for a deployment.

### Document Revisions

```sql
create table document_revisions (
  deployment_id text not null,
  table_id text not null,
  document_id text not null,
  commit_ts bigint not null,
  prev_ts bigint,
  value_jsonb jsonb,
  deleted boolean not null,
  primary key (deployment_id, table_id, document_id, commit_ts)
);
```

This table supports snapshot reads and historical reconstruction.

### Current Documents

```sql
create table current_documents (
  deployment_id text not null,
  table_id text not null,
  document_id text not null,
  commit_ts bigint not null,
  value_jsonb jsonb,
  deleted boolean not null,
  primary key (deployment_id, table_id, document_id)
);
```

This table is an optimization for latest reads. Correctness still depends on
revision and commit-log data.

### Index Entries

```sql
create table index_entries (
  deployment_id text not null,
  index_id text not null,
  index_key bytea not null,
  document_id text not null,
  commit_ts bigint not null,
  deleted boolean not null,
  primary key (deployment_id, index_id, index_key, document_id, commit_ts)
);
```

This table supports ordered index scans at a snapshot. A later optimization can
add `current_index_entries`, but the revision form is needed for historical
snapshots.

### Index Write Log

```sql
create table index_write_log (
  deployment_id text not null,
  commit_ts bigint not null,
  index_id text not null,
  index_key bytea not null,
  document_id text not null,
  direction text not null check (direction in ('old', 'new')),
  primary key (
    deployment_id,
    commit_ts,
    index_id,
    index_key,
    document_id,
    direction
  )
);
```

This table is used for both OCC validation and subscription invalidation.

## Metadata Tables

Start with explicit system metadata:

```sql
create table tables (
  deployment_id text not null,
  table_id text not null,
  table_name text not null,
  state text not null,
  primary key (deployment_id, table_id),
  unique (deployment_id, table_name)
);

create table indexes (
  deployment_id text not null,
  index_id text not null,
  table_id text not null,
  index_name text not null,
  fields jsonb not null,
  state text not null,
  primary key (deployment_id, index_id),
  unique (deployment_id, table_id, index_name)
);

create table source_packages (
  deployment_id text not null,
  package_id text not null,
  package_hash text not null,
  manifest jsonb not null,
  created_at timestamptz not null default now(),
  primary key (deployment_id, package_id)
);
```

Metadata reads must be included in read sets. If an index definition changes,
queries that depended on the old index metadata must rerun or fail cleanly.

## Required Indexes

```sql
create index document_revisions_snapshot
  on document_revisions (deployment_id, table_id, document_id, commit_ts desc);

create index index_entries_scan
  on index_entries (deployment_id, index_id, index_key, document_id, commit_ts desc);

create index index_write_log_overlap
  on index_write_log (deployment_id, index_id, index_key, commit_ts);

create index commits_created_at
  on commits (deployment_id, created_at);
```

For snapshot index scans, the query must choose the latest index entry at or
before `snapshot_ts` for each `(index_key, document_id)` and ignore entries
whose latest state is deleted.

## Index Key Encoding

Index keys must sort bytewise in the same order as Convex index values.

The encoding must support:

- null
- booleans
- numbers
- strings
- bytes
- arrays/objects where allowed by index rules
- document IDs
- tie-breaker document ID

The index key should include the indexed field values plus document ID as a
stable final component:

```txt
index_key = encode(field_1) || encode(field_2) || ... || encode(document_id)
```

This gives deterministic ordering and disambiguates duplicate field values.

## Snapshot Reads

Document snapshot read:

```sql
select value_jsonb, deleted, commit_ts
from document_revisions
where deployment_id = $1
  and table_id = $2
  and document_id = $3
  and commit_ts <= $4
order by commit_ts desc
limit 1;
```

Index range read conceptually:

```sql
select distinct on (document_id) document_id, index_key, deleted, commit_ts
from index_entries
where deployment_id = $1
  and index_id = $2
  and index_key >= $3
  and index_key < $4
  and commit_ts <= $5
order by document_id, commit_ts desc;
```

The exact SQL may need optimization, but the semantics are latest entry at
snapshot timestamp.

## Write Path

For each committed document write:

1. insert into `document_revisions`
2. upsert `current_documents`
3. compute old index keys
4. compute new index keys
5. insert deleted old index entries
6. insert live new index entries
7. insert old/new keys into `index_write_log`
8. insert row into `commits`

All of these happen in one short Postgres transaction.

## Retention And Compaction

Revision history and index write logs cannot grow forever.

Retention must account for:

- oldest active subscription timestamp
- oldest active mutation retry timestamp
- oldest snapshot export timestamp
- configured point-in-time recovery window

Only compact data older than the minimum required timestamp.

Compaction can:

- delete old document revisions superseded before retention
- delete old index entries superseded before retention
- delete old index write log rows after no subscription can need them

## Hyperdrive

Use Hyperdrive for connection pooling and connection setup latency.

Do not use cached reads for:

- mutation reads
- query subscriptions
- commit validation
- read-your-write paths
- sync reruns

If Hyperdrive is used in these paths, configure a no-cache binding.
