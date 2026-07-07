# Flarex Internal Database Schema Direction

## Purpose

This note is the current internal FlarexDB schema direction after the Medusa,
Payload, InstantDB, Convex, and Lunora sync discussions.

It exists to avoid mixing three different ideas:

```text
old idea:
  mandatory Postgres -> SQLite/DO projections for sync

not chosen as core:
  TanStack DB as the normal client query engine

current direction:
  Postgres/FlarexDB is source of truth
  Flarex server query functions are the default sync unit
  DeploymentSyncDO caches/reruns/fans out live query results
  projections/read models are optional internal optimizations only
```

This is a logical schema direction, not a finished migration file. Exact
physical names can change, but ownership boundaries should not.

## Core Rules

- One physical FlarexDB can contain app data, Payload-backed CMS data, Medusa
  reserved commerce data, workflow state, locks, commits, outbox, and sync
  control tables.
- Postgres/FlarexDB is the authoritative data store for the proposed
  Hyperdrive/Worker executor path.
- Flarex app data uses a shared physical app storage schema by default. App
  tables remain logical tables in the catalog, not one physical Postgres table
  per app table.
- Payload CMS content can share Flarex app storage for CMS-marked app tables,
  while Payload lifecycle/system state uses fixed `fx_payload_*` tables.
- Medusa data is generated from Medusa DML into reserved system tables.
- Payload and Medusa adapters call internal FlarexDB APIs, not raw Postgres.
- Live sync reads server query results by default. It does not require a
  browser-side database.
- Internal read models are optional performance helpers, not public app tables.
- `tenant_id` is not a developer-facing app concept. Physical scope columns may
  exist internally for shared-database isolation, but Flarex runtime routing is
  the primary isolation boundary.
- `tenant_id` belongs to the platform control plane. `scope_id` belongs to the
  data plane and identifies the concrete deployment/project authority being
  read or written.
- Commit and outbox cursors must be monotonic inside a `scope_id`. They should
  not depend on one global sequence being dense or meaningful across unrelated
  deployments.

## Namespaces

Use logical namespaces even if the first implementation is one Postgres schema
with prefixed tables.

```text
fx_control.*
  platform catalog, schema catalog, deployment state

fx_app.*
  shared physical app rows, app edges, app indexes, and app unique keys

fx_payload.*
  fixed Payload/CMS system tables for drafts, versions, uploads, auth, locks,
  globals, and scheduled publish

fx_medusa.*
  Medusa DML-generated reserved commerce tables

fx_system.*
  commits, OCC, idempotency, locks, workflow state, outbox

fx_sync.*
  live sync cursors, durable recovery state, optional query cache metadata

fx_read_model.*
  optional internal materialized read models/search documents
```

If one shared Postgres schema is easier at first, use prefixes:

```text
__fx_control_*
__fx_app_*
__fx_payload_*
__fx_medusa_*
__fx_system_*
__fx_sync_*
__fx_rm_*
```

## Control Catalog

These tables describe platform scope and generated schema. They are source of
truth for the compiler/runtime, not normal user data.

```sql
fx_control_tenant (
  id text primary key,
  slug text not null unique,
  created_at timestamptz not null
)

fx_control_project (
  id text primary key,
  tenant_id text not null,
  slug text not null,
  created_at timestamptz not null,
  unique (tenant_id, slug)
)

fx_control_deployment (
  id text primary key,
  project_id text not null,
  environment text not null,
  active_schema_version_id text,
  status text not null,
  created_at timestamptz not null
)

fx_control_scope (
  id text primary key,
  deployment_id text not null,
  project_id text not null,
  tenant_id text not null,
  environment text not null,
  active_schema_version_id text,
  isolation_kind text not null, -- shared_database, schema_per_scope, database_per_scope
  physical_locator_json jsonb,
  created_at timestamptz not null,
  unique (deployment_id)
)

fx_control_schema_version (
  id text primary key,
  deployment_id text not null,
  version integer not null,
  checksum text not null,
  status text not null,
  created_at timestamptz not null,
  unique (deployment_id, version)
)
```

Schema catalog:

```sql
fx_control_table (
  id text primary key,
  schema_version_id text not null,
  namespace text not null, -- app, payload, medusa, system
  logical_name text not null,
  physical_name text not null,
  access_policy text not null, -- public_ctx_db, payload_only, medusa_reserved, system
  cms_enabled boolean not null default false,
  created_at timestamptz not null,
  unique (schema_version_id, namespace, logical_name)
)

fx_control_column (
  id text primary key,
  table_id text not null,
  logical_name text not null,
  physical_name text not null,
  validator_json jsonb not null,
  nullable boolean not null,
  unique_key boolean not null default false,
  cms_metadata jsonb,
  created_at timestamptz not null,
  unique (table_id, logical_name)
)

fx_control_index (
  id text primary key,
  table_id text not null,
  name text not null,
  columns_json jsonb not null,
  unique_index boolean not null default false,
  predicate_json jsonb,
  created_at timestamptz not null,
  unique (table_id, name)
)

fx_control_constraint (
  id text primary key,
  table_id text not null,
  name text not null,
  constraint_kind text not null, -- not_null, check, foreign_key, unique, exclusion
  definition_json jsonb not null,
  created_at timestamptz not null,
  unique (table_id, name)
)

fx_control_relation (
  id text primary key,
  schema_version_id text not null,
  source_table_id text not null,
  source_field text not null,
  target_table_id text,
  relation_kind text not null, -- one, many, one_of, many_of, back
  polymorphic_targets_json jsonb,
  ordered boolean not null default false,
  physical_strategy text not null, -- app_json_ref, app_edge, payload_system, medusa_reserved_link, virtual_reverse
  graph_label text,
  source_graph_label text,
  target_graph_label text,
  graph_exposable boolean not null default false,
  created_at timestamptz not null
)

fx_control_migration (
  id text primary key,
  scope_id text not null,
  schema_version_id text not null,
  migration_name text not null,
  status text not null, -- planned, running, applied, failed, rolled_back
  started_at timestamptz,
  finished_at timestamptz,
  error_json jsonb,
  unique (scope_id, schema_version_id, migration_name)
)
```

## Flarex App Shared Storage And Payload Content

Default hosted Flarex app tables should not compile to one physical Postgres
table per app table. That would pollute a shared database when thousands of apps
exist.

Instead, app tables are logical catalog tables stored in a fixed shared physical
schema:

```text
fx_app_row
  logical app rows/documents

fx_app_edge
  logical app relationships

fx_app_index_entry
  declared query indexes

fx_app_unique_key
  declared unique constraints
```

Example Flarex schema:

```ts
posts: defineTable({
  title: v.string(),
  body: v.richText().cms(),
  author: v.relation.one(users).index(),
  categories: v.relation.many(categories).ordered().index(),
}).cms()
```

Generated catalog rows describe `posts`, `users`, `categories`, columns,
relations, indexes, CMS metadata, and write policies. The physical app data goes
into shared tables:

```sql
fx_app_row (
  scope_id text not null,
  table_id text not null,
  row_id text not null,
  schema_version_id text not null,
  data_json jsonb not null,
  fx_version bigint not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  primary key (scope_id, table_id, row_id)
)

create index fx_app_row_live_version_idx
  on fx_app_row (scope_id, table_id, fx_version);
```

`scope_id` is internal deployment/project isolation. Developers should not model
their own app tenancy by relying on this column. If the deployment uses
per-project schemas/databases, `scope_id` can disappear physically while the
logical contract remains.

Forward has-one relations can be stored inside `data_json` and extracted into
indexes when they are queried. Many, ordered many, polymorphic, CMS, and
cross-table references use `fx_app_edge`:

```sql
fx_app_edge (
  scope_id text not null,
  relation_id text not null,
  source_table_id text not null,
  source_row_id text not null,
  target_table_id text not null,
  target_row_id text not null,
  position integer,
  locale text,
  metadata_json jsonb,
  fx_version bigint not null,
  deleted_at timestamptz,
  primary key (
    scope_id,
    relation_id,
    source_table_id,
    source_row_id,
    target_table_id,
    target_row_id
  )
)

create index fx_app_edge_source_idx
  on fx_app_edge (scope_id, relation_id, source_table_id, source_row_id, position);

create index fx_app_edge_target_idx
  on fx_app_edge (scope_id, relation_id, target_table_id, target_row_id);
```

Declared app indexes are not arbitrary JSON scans. The compiler writes index
rows when app rows change:

```sql
fx_app_index_entry (
  scope_id text not null,
  index_id text not null,
  table_id text not null,
  row_id text not null,
  key_json jsonb not null,
  key_hash text not null,
  key_text_1 text,
  key_text_2 text,
  key_num_1 numeric,
  key_num_2 numeric,
  key_time_1 timestamptz,
  key_bool_1 boolean,
  fx_version bigint not null,
  primary key (scope_id, index_id, key_hash, row_id)
)

create index fx_app_index_scan_idx
  on fx_app_index_entry (scope_id, index_id, key_text_1, key_text_2, row_id);
```

Declared unique constraints use a fixed unique-key table:

```sql
fx_app_unique_key (
  scope_id text not null,
  constraint_id text not null,
  key_hash text not null,
  table_id text not null,
  row_id text not null,
  primary key (scope_id, constraint_id, key_hash)
)
```

This keeps hosted Flarex from creating thousands of physical app tables while
still preserving logical tables, relations, indexes, uniqueness, OCC, and live
sync semantics.

Do not store Medusa commerce data in `fx_app_row`. Medusa has its own reserved
system tables. Do not store Payload lifecycle state in `fx_app_row` unless it is
normal CMS content for a CMS-marked app table.

Payload complex fields use shared app storage for normal CMS content plus
generated fixed system support:

```sql
fx_payload_child_entity (
  id text primary key,
  scope_id text not null,
  parent_table text not null,
  parent_id text not null,
  field_path text not null,
  block_type text,
  locale text,
  position integer not null,
  value_json jsonb not null,
  fx_version bigint not null,
  fx_deleted_at timestamptz
)

fx_payload_version (
  id text primary key,
  scope_id text not null,
  collection text not null,
  document_id text not null,
  version_number integer not null,
  snapshot_json jsonb not null,
  created_by text,
  created_at timestamptz not null,
  unique (scope_id, collection, document_id, version_number)
)

fx_payload_draft (
  scope_id text not null,
  collection text not null,
  document_id text not null,
  draft_json jsonb not null,
  updated_by text,
  updated_at timestamptz not null,
  primary key (scope_id, collection, document_id)
)

fx_payload_upload (
  id text primary key,
  scope_id text not null,
  collection text not null,
  document_id text not null,
  bucket text not null,
  object_key text not null,
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  metadata jsonb,
  created_at timestamptz not null
)

fx_payload_global_state (
  scope_id text not null,
  global_slug text not null,
  value_json jsonb not null,
  fx_version bigint not null,
  updated_by text,
  updated_at timestamptz not null,
  primary key (scope_id, global_slug)
)

fx_payload_document_lock (
  scope_id text not null,
  collection text not null,
  document_id text not null,
  owner_id text not null,
  expires_at timestamptz not null,
  metadata jsonb,
  primary key (scope_id, collection, document_id)
)

fx_payload_scheduled_publish (
  id text primary key,
  scope_id text not null,
  collection text not null,
  document_id text not null,
  action text not null, -- publish, unpublish
  run_at timestamptz not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
)

fx_payload_auth_account (
  id text primary key,
  scope_id text not null,
  collection text not null,
  document_id text not null,
  email text,
  username text,
  password_hash text,
  verified_at timestamptz,
  reset_token_hash text,
  reset_token_expires_at timestamptz,
  metadata jsonb,
  unique (scope_id, collection, email),
  unique (scope_id, collection, username)
)

fx_payload_session (
  id text primary key,
  scope_id text not null,
  account_id text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null
)
```

Payload uses these through `@payloadcms/db-flarex`. Public `ctx.db` can read or
write CMS-marked app tables only according to the collection write policy.
Lifecycle-sensitive fields can be `payload_only`.

Only generate Payload system tables when the corresponding feature is enabled.
For simple CMS-marked logical app tables, shared app rows plus app edges may be
enough.

## Medusa Reserved Tables

Medusa tables are real relational tables generated from Medusa DML, but they are
reserved. App developers do not access them through public `ctx.db`.

Example shape:

```sql
fx_medusa_product (
  id text primary key,
  scope_id text not null,
  title text not null,
  handle text,
  status text not null,
  metadata jsonb,
  fx_version bigint not null,
  deleted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
)

create unique index fx_medusa_product_handle_uq
  on fx_medusa_product (scope_id, handle)
  where deleted_at is null;

fx_medusa_product_variant (
  id text primary key,
  scope_id text not null,
  product_id text not null,
  title text not null,
  sku text,
  metadata jsonb,
  fx_version bigint not null,
  deleted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
)

fx_medusa_link_product_sales_channel (
  scope_id text not null,
  product_id text not null,
  sales_channel_id text not null,
  fx_version bigint not null,
  deleted_at timestamptz,
  primary key (scope_id, product_id, sales_channel_id)
)
```

Rules:

- Medusa DML is the schema source for `fx_medusa_*`.
- Medusa services/workflows access these tables through the Flarex-backed
  Medusa adapter.
- Medusa modules or services that use raw SQL, database-specific query helpers,
  or custom repositories must be classified during adapter work. They cannot
  bypass FlarexDB by receiving raw Postgres access in the Worker path.
- App-to-commerce references should normally live in app tables or
  `fx_app_edge`, not as public Medusa Module Links.
- Internal Medusa Module Links remain allowed where original Medusa expects
  them.

## Commit, OCC, And Transaction Tables

The commit log is the source of sync ordering. It replaces the old idea that a
projection database is the normal sync source.

```sql
fx_system_scope_clock (
  scope_id text primary key,
  next_commit_seq bigint not null,
  next_outbox_seq bigint not null,
  epoch text not null,
  updated_at timestamptz not null
)

fx_system_commit (
  commit_id bigserial unique,
  scope_id text not null,
  commit_seq bigint not null,
  epoch text not null,
  schema_version_id text not null,
  actor_id text,
  source text not null, -- app, payload, medusa, workflow, system
  mutation_id text,
  summary_json jsonb not null,
  committed_at timestamptz not null,
  primary key (scope_id, commit_seq)
)

create index fx_commit_source_idx
  on fx_system_commit (scope_id, source, committed_at);

fx_system_commit_write (
  scope_id text not null,
  commit_seq bigint not null,
  write_id text not null,
  namespace text not null,
  table_name text not null,
  row_id text,
  relation_key text,
  index_key text,
  operation text not null,
  primary key (scope_id, commit_seq, write_id)
)

create index fx_commit_write_lookup_idx
  on fx_system_commit_write (scope_id, namespace, table_name, row_id, relation_key, index_key);
```

OCC/read validation can be stored compactly for retries, debugging, and recovery:

`fx_system_scope_clock` is locked only during the final trusted commit phase.
Do not hold this row lock while user code, Payload hooks, Medusa workflow steps,
network calls, or long actions are running.

```sql
fx_system_tx_session (
  id text primary key,
  scope_id text not null,
  actor_id text,
  state text not null, -- staged, committing, committed, aborted, expired
  read_set_json jsonb not null,
  write_intent_json jsonb not null,
  created_at timestamptz not null,
  expires_at timestamptz not null
)

fx_system_tx_dependency (
  id text primary key,
  scope_id text not null,
  tx_session_id text not null,
  dependency_kind text not null, -- row, relation, index_range, table_version
  namespace text not null,
  table_name text not null,
  row_id text,
  relation_key text,
  index_name text,
  range_start_json jsonb,
  range_end_json jsonb,
  observed_version bigint,
  observed_commit_seq bigint,
  created_at timestamptz not null
)

create index fx_tx_dependency_lookup_idx
  on fx_system_tx_dependency (scope_id, tx_session_id, dependency_kind, namespace, table_name);

fx_system_row_version (
  scope_id text not null,
  namespace text not null,
  table_name text not null,
  row_id text not null,
  version bigint not null,
  updated_commit_seq bigint not null,
  primary key (scope_id, namespace, table_name, row_id)
)
```

Many physical tables also carry `fx_version`. `fx_system_row_version` is useful
when generic rows, relation edges, Payload child entities, or Medusa reserved
tables need one common OCC lookup path.

`fx_system_tx_dependency` can be omitted for tiny prototype transactions if the
executor stores `read_set_json` only. It becomes useful when read sets include
many rows, relation edges, index ranges, or table-version reads and the commit
validator needs set-based checks instead of parsing one large JSON value.

## Idempotency And Client Watermarks

Stable mutation IDs prevent duplicate application after retries.

```sql
fx_system_idempotency (
  scope_id text not null,
  actor_fingerprint text not null,
  mutation_id text not null,
  result_json jsonb,
  commit_seq bigint,
  status text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (scope_id, actor_fingerprint, mutation_id)
)
```

Optional advanced local-first/offline sequencing can use client watermarks:

```sql
fx_system_client_watermark (
  scope_id text not null,
  actor_fingerprint text not null,
  client_id text not null,
  last_mutation_seq bigint not null,
  updated_at timestamptz not null,
  primary key (scope_id, actor_fingerprint, client_id)
)
```

The basic Flarex client can use stable mutation IDs without watermarks.
Watermarks are for stricter offline/custom-mutator ordering:

```text
seq <= watermark
  -> already applied, acknowledge

seq == watermark + 1
  -> apply and advance watermark

seq > watermark + 1
  -> reject as gap / ask client to replay missing write
```

## Outbox And Recovery

Outbox is durable recovery and derived work. It is not the normal hot path for
same-Worker live sync.

```sql
fx_system_outbox (
  outbox_id bigserial unique,
  scope_id text not null,
  outbox_seq bigint not null,
  commit_seq bigint not null,
  event_type text not null,
  consumer_group text not null,
  idempotency_key text,
  payload_json jsonb not null,
  status text not null default 'pending',
  created_at timestamptz not null,
  available_at timestamptz not null,
  attempts integer not null default 0,
  last_error text,
  primary key (scope_id, outbox_seq)
)

create index fx_outbox_consumer_pending_idx
  on fx_system_outbox (scope_id, consumer_group, status, available_at, outbox_seq);

create unique index fx_outbox_idempotency_idx
  on fx_system_outbox (scope_id, consumer_group, idempotency_key)
  where idempotency_key is not null;

fx_system_outbox_cursor (
  scope_id text not null,
  consumer_name text not null,
  last_outbox_seq bigint not null,
  updated_at timestamptz not null,
  primary key (scope_id, consumer_name)
)
```

Typical consumers:

```text
deployment-sync-recovery
payload-post-commit-hooks
medusa-domain-events
search-indexer
read-model-builder
webhooks
email
analytics
```

Same-Worker live sync fast path:

```text
commit succeeds
  -> executor directly wakes DeploymentSyncDO with compact summary
  -> DeploymentSyncDO matches active read sets and reruns affected queries
```

Outbox recovery path:

```text
direct wake fails or DO was evicted
  -> DeploymentSyncDO drains fx_system_outbox or fx_system_commit from cursor
  -> rebuilds missed hot state
  -> reruns affected queries
```

## Live Sync Durable Tables

Most live sync state is hot state inside `DeploymentSyncDO` and `ConnectionDO`.
Do not mirror every active subscription row-by-row in Postgres by default.

Durable sync tables should be small recovery checkpoints:

```sql
fx_sync_deployment_cursor (
  scope_id text primary key,
  last_seen_commit_seq bigint not null,
  last_seen_outbox_seq bigint not null,
  epoch text not null,
  updated_at timestamptz not null
)

fx_sync_query_cache (
  scope_id text not null,
  query_key_hash text not null,
  schema_version_id text not null,
  result_hash text not null,
  result_json jsonb,
  read_set_summary_json jsonb not null,
  commit_seq bigint not null,
  expires_at timestamptz,
  primary key (scope_id, query_key_hash)
)
```

`fx_sync_query_cache` is optional. The first implementation can keep query
results in `DeploymentSyncDO` memory and only persist cursor/recovery state.
Use durable query cache when it measurably reduces Postgres load or improves
cold resume.

The first design should not require a separate `QueryShardDO` or persistent
cache row per arbitrary `where` clause. Normal live sync can rerun affected
server queries through `DeploymentSyncDO` and fall back to indexed
Postgres/FlarexDB reads.

Future optimization, not v1:

```text
normalized query shape + args + scope + schema version
  -> query shape hash
  -> optional QueryShardDO or durable fx_sync_query_cache entry
  -> bounded result ids/selected fields/read set/result hash/cursor
```

This optimization exists to reduce Postgres load for hot shared query shapes
such as large product lists, leaderboards, or common CMS collection views. It
must remain disposable: if invalidation is uncertain, mark the query dirty and
refresh from Postgres/FlarexDB. Coarse invalidation is the correctness model;
precise row patching is a later performance optimization.

Client read cache is not part of this server schema. Browser cache belongs in
the Flarex client, usually IndexedDB.

Important recovery rule:

```text
ConnectionDO owns websocket/session/subscription attachment state.
DeploymentSyncDO owns hot read-set indexes and rerun scheduling.

If DeploymentSyncDO loses memory:
  -> reload scope cursor
  -> ask ConnectionDOs to replay active subscription registrations
  -> rebuild read-set maps by rerunning active queries or loading a valid query cache

If ConnectionDO loses memory but websockets hibernate:
  -> restore subscription metadata from websocket attachments
  -> re-register with DeploymentSyncDO

If both are unavailable or attachments are stale:
  -> client reconnects with last cursor/epoch and resubscribes
```

That is why this schema does not include a large
`fx_sync_active_subscription` table by default.

## Locks And Hot Partitions

Locks are system lease records, not public app data.

```sql
fx_system_lock_lease (
  scope_id text not null,
  lock_key text not null,
  owner_id text not null,
  fencing_token bigint not null,
  acquired_at timestamptz not null,
  expires_at timestamptz not null,
  metadata jsonb,
  primary key (scope_id, lock_key)
)
```

Use this for high-contention domains:

```text
inventory reservation
checkout completion
payment state transition
order number allocation
Medusa workflow critical sections
```

OCC remains the normal optimistic path. Locks are for domains where retrying
optimistically is too expensive or unsafe.

## Workflow And Scheduler State

Workflow state belongs in reserved system tables so Medusa workflow behavior can
remain intact while Flarex owns storage and recovery.

```sql
fx_system_workflow_execution (
  id text primary key,
  scope_id text not null,
  workflow_id text not null,
  transaction_id text,
  state text not null,
  input_json jsonb,
  result_json jsonb,
  event_group_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null
)

fx_system_workflow_step (
  scope_id text not null,
  execution_id text not null,
  step_id text not null,
  state text not null,
  input_json jsonb,
  output_json jsonb,
  error_json jsonb,
  updated_at timestamptz not null,
  primary key (scope_id, execution_id, step_id)
)

fx_system_delayed_action (
  id text primary key,
  scope_id text not null,
  kind text not null,
  payload_json jsonb not null,
  due_at timestamptz not null,
  status text not null,
  attempts integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null
)
```

These tables can back Medusa Workflow Engine persistence, Flarex scheduled
functions, and recovery paths. The app API should expose scheduler/workflow
commands, not raw workflow rows.

## Optional Internal Read Models

Read models exist to reduce load on Postgres for known hot or expensive query
shapes. They are optional.

Catalog:

```sql
fx_read_model_definition (
  id text primary key,
  scope_id text not null,
  name text not null,
  owner text not null, -- app, payload, medusa, search, system
  source_tables_json jsonb not null,
  freshness_policy_json jsonb not null,
  physical_name text not null,
  created_at timestamptz not null,
  unique (scope_id, name)
)

fx_read_model_cursor (
  scope_id text not null,
  read_model_id text not null,
  last_built_commit_seq bigint not null,
  status text not null,
  updated_at timestamptz not null,
  primary key (scope_id, read_model_id)
)
```

Example generated read model table:

```sql
fx_rm_product_browse (
  scope_id text not null,
  product_id text not null,
  title text not null,
  handle text,
  status text not null,
  category_ids jsonb,
  collection_id text,
  search_text text,
  sort_rank numeric,
  source_commit_seq bigint not null,
  primary key (scope_id, product_id)
)
```

Rules:

- App developers do not write read models directly.
- Query planner may read a read model only when its cursor is fresh enough for
  the requested commit/dependency version.
- If stale, the planner reruns from source tables or waits/retries until the
  read model catches up.
- Mutation validation must not depend on async read models.
- Search indexes are also derived read models.

## Query And Mutation Flow Against This Schema

Live query:

```text
Client useQuery(api.leaderboard, args)
  -> ConnectionDO registers subscription
  -> DeploymentSyncDO checks hot query cache
  -> if missing/stale, Query Executor runs Flarex query function
  -> query reads source tables or a fresh-enough read model
  -> query returns result + read-set summary
  -> DeploymentSyncDO caches result/read set by query key
  -> client receives data(result, commitCursor)
```

Mutation:

```text
Client mutation(args, mutationId)
  -> user code runs without a SQL transaction
  -> reads and write intents are staged
  -> trusted executor opens Postgres transaction
  -> validates fx_version/read sets/ranges/locks/idempotency
  -> writes app/Payload/Medusa/source rows
  -> writes relation edges and required indexes
  -> writes fx_system_commit and fx_system_outbox
  -> writes idempotency/watermark rows when applicable
  -> commits
  -> wakes DeploymentSyncDO with summary
```

DeploymentSyncDO after commit:

```text
commit summary
  -> changed row ids / relation keys / index ranges / table ids
  -> match active read-set maps
  -> coalesce affected query reruns
  -> rerun once at latest useful commit
  -> if result changed, send data/delta
  -> if result did not change, send settled acknowledgement
```

V1 sync should follow an InstantDB-style invalidation model:

```text
query starts
  -> record broad dependency topics/read-set keys before expensive reads
query finishes
  -> refine dependencies from actual rows, relations, indexes, and ranges read
commit arrives
  -> mark matching queries stale
  -> rerun stale queries against Postgres/FlarexDB or fresh internal read models
  -> compare result hash
  -> send changed result, or settled acknowledgement if unchanged
```

The schema should support this model with commit summaries, read-set summaries,
result hashes, and cursor checkpoints. It should not require v1 to maintain
perfect per-query materialized caches or to compute exact list patches for
every possible `where` clause. Coarse invalidation plus authoritative rerun is
the correctness baseline.

## What This Schema Explicitly Avoids

Do not make these the default internal schema:

```text
mandatory app table -> projection table -> SQLite sync table
mandatory TanStack DB local collections
public ctx.db.projection(...)
public access to fx_medusa_* tables
Payload-owned physical schema separate from Flarex app schema
Medusa-owned raw Postgres schema separate from FlarexDB
locks/workflow/outbox rows as ordinary app documents
```

The clean mental model is:

```text
source data:
  Flarex app logical rows in fx_app_row
  Flarex app logical relations in fx_app_edge
  Flarex app declared indexes/unique keys in fx_app_index_entry/fx_app_unique_key
  Payload-marked app content in shared Flarex app storage
  Payload lifecycle/system state in fixed fx_payload_* tables
  Medusa DML-generated reserved tables

control data:
  schema catalog
  commits/OCC/idempotency/watermarks
  locks/workflows/outbox

sync hot path:
  DeploymentSyncDO cache/read-set maps/reruns

derived data:
  optional internal read models/search indexes
```

## Design Lineage And References

This design is not a direct clone of Convex, InstantDB, Lunora, Medusa, or
Payload. It borrows specific ideas from each system, then changes the storage
shape where Flarex needs one shared data plane for app data, Payload CMS
semantics, Medusa commerce semantics, and Cloudflare deployment constraints.

### Convex-Inspired Pieces

References:

- [Convex OCC and Atomicity](https://docs.convex.dev/database/advanced/occ)
- [Convex Writing Data](https://docs.convex.dev/database/writing-data)
- [Convex Overview](https://docs.convex.dev/understanding/overview)
- [How Convex Works](https://stack.convex.dev/how-convex-works)

Borrowed:

- Short server-side query and mutation functions.
- Mutation writes staged during user code and committed together at the end.
- Optimistic concurrency control based on read sets and write sets.
- Live queries that react to committed database changes.
- Query invalidation by dependency/read-set tracking, not by pushing raw table
  changes directly to the browser.

Changed for Flarex:

- Convex owns one integrated database/runtime. Flarex must also host Medusa and
  Payload as backend harnesses, so the commit/OCC layer covers shared app rows,
  app edges, app index entries, Payload system tables, Medusa reserved
  relational tables, locks, workflow state, and outbox rows.
- Convex hides the physical database. Flarex's proposed implementation still
  uses Postgres/Hyperdrive for the authoritative physical commit, so OCC is the
  logical validation layer and Postgres is the final atomic durability layer.
- Convex does not need Medusa-style workflow locks for commerce hot paths.
  Flarex adds `fx_system_lock_lease` for inventory, checkout, payment state,
  order numbers, and workflow critical sections where pure OCC would retry too
  much or be too risky.

Schema pieces from this lineage:

```text
fx_system_tx_session
fx_system_row_version
fx_system_commit
fx_system_commit_write
fx_sync_deployment_cursor
DeploymentSyncDO read-set maps and query reruns
```

### InstantDB-Inspired Pieces

References:

- [InstantDB Modeling Data](https://www.instantdb.com/docs/modeling-data)
- [InstantDB Writing Data](https://www.instantdb.com/docs/instaml)
- [InstantDB Backend](https://www.instantdb.com/docs/backend)

Borrowed:

- Developer-friendly schema over entities, attributes, indexes, uniqueness,
  and relationships.
- Type-safe `query` and `transact` style ergonomics generated from schema.
- Relationship-first thinking instead of treating everything as isolated JSON
  documents.
- Multi-operation transaction API where several entity/relation writes can be
  committed as one logical mutation.
- Sync semantics based on dependency topics, coarse invalidation, query rerun,
  result-hash comparison, and client-side pending mutation reconciliation.

Changed for Flarex:

- InstantDB's public data model is closer to an entity/attribute/link graph.
  Flarex app data should use a similar shared row/edge/index shape so hosted
  Flarex can support thousands of logical app schemas without creating
  thousands of physical Postgres tables.
- InstantDB can be the whole application database. Flarex also needs Medusa DML
  compatibility, so Medusa commerce gets reserved real relational tables rather
  than being forced through the same generic app graph.
- InstantDB's relation/transact ergonomics inspire the public API, but Flarex
  adds internal schema catalog and access policies so Payload and Medusa cannot
  bypass their own semantics.
- InstantDB tails Postgres WAL to discover novelty. Flarex should prefer the
  executor's post-commit summary as the hot path because Flarex owns the final
  commit. Durable commit/outbox rows remain the replay path if direct wake or
  hot sync state is lost.

Schema pieces from this lineage:

```text
fx_control_table
fx_control_column
fx_control_index
fx_control_relation
fx_app_row
fx_app_edge
fx_app_index_entry
fx_app_unique_key
fx_system_idempotency
```

### Lunora-Inspired Pieces

References:

- [Lunora GitHub README](https://github.com/anolilab/lunora)
- [Lunora site](https://lunora.sh/)

Borrowed:

- Convex-style developer experience on Cloudflare Workers and Durable Objects.
- Cloudflare-native split between server functions, live subscriptions, durable
  state, SQL storage, blob storage, and jobs.
- Commit cursor / resume thinking for reconnect and recovery.
- Offline/client mutation ideas such as stable mutation IDs and optional
  client sequencing.
- The idea that useful sync protocol details can be borrowed without adopting a
  full client-side database as the normal query engine.

Changed for Flarex:

- Lunora's current public positioning includes D1/Durable Objects as core
  Cloudflare storage building blocks. The current Flarex direction keeps
  Postgres/FlarexDB as authoritative storage and uses Durable Objects primarily
  for live connection coordination, hot query caches, cursor recovery, and
  reruns.
- We borrow cursor/resume/settled/offline concepts, but do not make TanStack DB
  or a browser-side normalized DB mandatory. Default Flarex reads are still
  server query results.
- We avoid the older Flarex idea of mandatory Postgres -> SQLite/DO projection
  stores. Read models remain optional internal optimizations.

Schema pieces from this lineage:

```text
fx_system_client_watermark
fx_system_idempotency
fx_sync_deployment_cursor
optional fx_sync_query_cache
commit_seq + epoch resume model
settled acknowledgement after unchanged rerun results
```

### Cloudflare Durable Object Pieces

References:

- [Cloudflare Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Cloudflare Durable Object Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Cloudflare Durable Object SQLite Storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Cloudflare Durable Object Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)

Borrowed:

- Durable Objects are a natural place to coordinate long-lived WebSocket
  connections and per-deployment hot sync state.
- Hibernation means in-memory state can disappear, so important recovery cursors
  must be persisted outside the hot object memory.
- Alarms can recover missed work after direct wake fails or an object was
  evicted.

Changed for Flarex:

- Durable Objects are not the authoritative app database in this design.
  `DeploymentSyncDO` is a hot coordination/cache/rerun actor. FlarexDB remains
  authoritative.
- We split durable recovery data from hot live subscription maps. The schema
  stores small recovery checkpoints, not every active WebSocket subscription as
  Postgres rows.

Schema pieces from this lineage:

```text
fx_sync_deployment_cursor
fx_system_outbox_cursor
optional fx_sync_query_cache
DeploymentSyncDO in-memory read-set indexes
ConnectionDO WebSocket session ownership
```

### Medusa-Driven Pieces

References:

- [Medusa Data Models / DML](https://docs.medusajs.com/learn/fundamentals/data-models)
- [Medusa Modules](https://docs.medusajs.com/learn/fundamentals/modules)
- [Medusa Module Links](https://docs.medusajs.com/learn/fundamentals/module-links)
- [Medusa Read-Only Module Links](https://docs.medusajs.com/learn/fundamentals/module-links/read-only)
- [Medusa Workflow Engine Module](https://docs.medusajs.com/resources/infrastructure-modules/workflow-engine)
- [Medusa Locking Module](https://docs.medusajs.com/resources/infrastructure-modules/locking)
- [Medusa Locking Operations in Workflows](https://docs.medusajs.com/learn/fundamentals/workflows/locks)

Borrowed:

- Medusa DML is already the source for module table shapes.
- Medusa services are the commerce behavior boundary.
- Medusa Module Links are an internal compatibility mechanism for module
  isolation and query traversal.
- Medusa workflows need durable step state, reliable rollback/compensation
  semantics, and event grouping.
- Medusa locking is required for shared commerce resources such as inventory.

Changed for Flarex:

- Medusa does not own raw Postgres in the Flarex design. A Flarex-backed Medusa
  adapter compiles Medusa DML into reserved `fx_medusa_*` system tables and
  executes through internal FlarexDB APIs.
- Medusa Module Link is not exposed as a public Flarex developer API. App
  developers use Flarex relations. Medusa links are generated/emulated only
  where original Medusa internals expect them.
- Medusa events and workflow side effects must be buffered behind the FlarexDB
  commit authority. If the final commit fails, Medusa domain events and Payload
  post-commit hooks must not publish as if the write succeeded.

Schema pieces from this lineage:

```text
fx_medusa_* reserved tables
fx_medusa_link_* compatibility tables
fx_system_workflow_execution
fx_system_workflow_step
fx_system_delayed_action
fx_system_lock_lease
fx_system_outbox events for medusa-domain-events
```

### Payload-Driven Pieces

References:

- [Payload Fields Overview](https://payloadcms.com/docs/fields/overview)
- [Payload Relationship Field](https://payloadcms.com/docs/fields/relationship)
- [Payload Join Field](https://payloadcms.com/docs/fields/join)
- [Payload Versions](https://payloadcms.com/docs/versions/overview)
- [Payload Collections](https://payloadcms.com/docs/configuration/collections)
- [Payload Globals](https://payloadcms.com/docs/configuration/globals)

Borrowed:

- Payload fields are the CMS schema semantics: validation, access control,
  hooks, admin behavior, relationship options, virtual fields, arrays, blocks,
  drafts, versions, uploads, auth, collections, and globals.
- Relationship fields can be one-way, has-many, polymorphic, sortable, and
  joined back through virtual join fields.
- Some fields are stored data, some are presentational, and some are virtual.

Changed for Flarex:

- Payload config is generated from Flarex app schema. Payload does not create a
  separate source-of-truth app database.
- Flarex shared app storage remains the main stored CMS content for
  CMS-marked app tables. Payload-only complexity uses `fx_payload_*` system
  tables for child entities, versions, drafts, uploads, locks, sessions, and
  auth support.
- Public `ctx.db` may access CMS-marked app fields according to Flarex write
  policy, but it cannot directly bypass Payload-only lifecycle-sensitive rows.

Schema pieces from this lineage:

```text
cms_enabled and cms_metadata in fx_control_*
fx_app_row / fx_app_edge for CMS-marked collections
fx_payload_child_entity
fx_payload_version
fx_payload_draft
fx_payload_upload
relation edges for Payload relationship/join shapes
```

### Flarex-Original Decisions

These are not copied directly from one reference system. They are the result of
combining all constraints above:

- One FlarexDB control plane for schema catalog, deployments, commit/OCC,
  outbox, locks, workflows, sync recovery, and optional read models.
- Three authoritative physical storage classes under that control plane:
  shared Flarex app storage, fixed Payload system tables, and Medusa
  DML-generated reserved relational system tables.
- Payload and Medusa are backend harnesses over FlarexDB, not separate database
  owners.
- Public developer APIs stay simple: `ctx.db`, `ctx.db.transact`,
  `ctx.commerce`, and `ctx.cms` facades. No public Payload plugin API, no public
  Medusa Link API, and no public projection API in the first design.
- Projections/read models are internal planner/runtime optimizations only. They
  can live in the same FlarexDB or a Flarex-selected derived store later, but
  they are never the source of truth.
- The final commit phase is short: user code stages intent, then the trusted
  executor opens a real Postgres transaction, validates OCC/locks/idempotency,
  writes all authoritative rows, writes commit/outbox records, commits, and
  wakes sync.

## Future PostgreSQL 19 SQL/PGQ Compatibility

PostgreSQL 19 adds SQL/PGQ property graph queries. This should improve FlarexDB
later, but it should not become a first-version dependency.

Reference:

- [PostgreSQL 19 Property Graphs](https://www.postgresql.org/docs/19/ddl-property-graphs.html)

Important rule:

```text
PostgreSQL property graphs are read/query views over relational tables.
They are not a replacement storage engine and not a write authority.
```

Therefore the current FlarexDB schema should be shaped to be graph-compatible,
without requiring PostgreSQL 19:

```text
Now:
  shared Flarex app storage: fx_app_row, fx_app_edge, fx_app_index_entry
  Medusa reserved relational tables
  Payload system tables
  graph metadata in fx_control_table and fx_control_relation
  no per-app physical table explosion

Later on PostgreSQL 19:
  generate CREATE PROPERTY GRAPH views from the catalog
  use GRAPH_TABLE for traversal, admin/debug views, recommendations,
  permission analysis, schema visualization, and selected read query planning
```

Example future generated app graph over shared storage:

```sql
CREATE PROPERTY GRAPH flarex_app_graph
  VERTEX TABLES (
    fx_app_row
      KEY (scope_id, table_id, row_id)
      LABEL app_entity
      PROPERTIES (scope_id, table_id, row_id, data_json)
  )
  EDGE TABLES (
    fx_app_edge
      KEY (scope_id, relation_id, source_table_id, source_row_id, target_table_id, target_row_id)
      SOURCE KEY (scope_id, source_table_id, source_row_id)
        REFERENCES fx_app_row (scope_id, table_id, row_id)
      DESTINATION KEY (scope_id, target_table_id, target_row_id)
        REFERENCES fx_app_row (scope_id, table_id, row_id)
      LABEL app_relation
  );
```

That generic app graph is useful for internal traversal, admin/debug views, and
schema visualization. It is less optimized than a graph over typed physical
tables, but it avoids table pollution in hosted shared-schema mode.

Medusa can still get more specific graph definitions because Medusa uses fixed
reserved system tables:

```sql
CREATE PROPERTY GRAPH flarex_commerce_graph
  VERTEX TABLES (
    fx_medusa_product LABEL product,
    fx_medusa_product_variant LABEL variant
  )
  EDGE TABLES (
    fx_medusa_link_product_variant
      SOURCE fx_medusa_product
      DESTINATION fx_medusa_product_variant
      LABEL has_variant
  );
```

This is intentionally generated infrastructure. Application developers should
not write raw `GRAPH_TABLE` queries as the primary public API. Public queries
still go through Flarex query functions so Flarex can enforce scope, auth,
read-set/OCC tracking, Payload/Medusa boundaries, and live-sync dependencies.

Graph views are good for:

```text
relationship traversal
admin relationship inspection
permission graph analysis
recommendations
schema graph visualization
commerce/content relationship browsing
query planner experiments
```

Graph views are not good as:

```text
mutation authority
OCC authority
outbox authority
replacement for typed Medusa tables
replacement for Payload lifecycle semantics
replacement for Flarex query functions
```

This means the current schema adjustment is shared-storage discipline: Flarex
app data goes through `fx_app_row`, `fx_app_edge`, declared app indexes, and
unique keys; Medusa and Payload system state keep fixed reserved tables.
PostgreSQL 19 graph support can be generated later over those shapes without
changing the source-of-truth storage model.

## Challenge Results And Remaining Risks

After reviewing this schema against the older projection-heavy design and the
newer Postgres/DeploymentSyncDO design, these are the main risks to keep
visible.

This is a strong architecture direction, not a proven database yet. The design
should be treated as correct only after focused vertical slices prove the shared
app storage path, OCC path, live-sync path, Payload adapter path, and Medusa
adapter path.

### Shared App Storage Performance

The shared app schema avoids table explosion, but it creates a new pressure
point: many logical app tables share `fx_app_row`, `fx_app_edge`,
`fx_app_index_entry`, and `fx_app_unique_key`.

The implementation must prove:

```text
point reads by scope/table/row stay fast
declared index reads do not become JSON scans
edge traversal stays fast for common relation shapes
large apps do not degrade small apps in the same physical database
Postgres autovacuum/index bloat remains manageable
hot scopes can be isolated, partitioned, or promoted when needed
```

The rule is: app queries must use primary keys, declared indexes, declared
relations, search indexes, or internal read models. Arbitrary unindexed scans
over `data_json` should not become the normal API promise.

### Cursor Semantics

Commit and outbox cursors must be scoped. A single global Postgres sequence is
useful for debugging, but client sync should not rely on global sequence density
or ordering across unrelated deployments. Use `(scope_id, commit_seq)` and
`(scope_id, outbox_seq)` as the sync cursors.

### Read-Set Granularity

OCC cannot stop at single-row versions, especially with shared app storage. The
validator must understand:

```text
row reads
app edge reads
declared app index reads
index range reads
table-version reads
Medusa link/table reads
Payload child/version/draft reads
```

If read-set tracking is too coarse, unrelated writes will cause excessive
conflicts. If it is too narrow, stale query results can commit incorrectly.

The first implementation can store read sets as JSON for simplicity, but the
production path needs normalized or compiled dependency checks so commits do
not parse huge JSON blobs under a row lock.

### Live Subscription Recovery

The schema intentionally avoids a large durable active-subscription table. That
means the runtime must implement one of these recovery paths correctly:

```text
ConnectionDO websocket attachment restore
DeploymentSyncDO read-set map rebuild from ConnectionDO registrations
client cursor/epoch reconnect and resubscribe
```

If that is not implemented, hibernation or eviction can silently drop live
query invalidation state.

### Medusa Compatibility

Generated DML CRUD is not the hard part. The hard parts are Product, Cart,
Order, Pricing, Inventory, workflow state, locks, module links, Query/Index,
and any module path that currently uses raw SQL or adapter-specific behavior.
Those paths need compatibility tests before the adapter is considered real.

### Payload Compatibility

Simple collections are easy. The hard parts are arrays, blocks, rich text,
localized fields, polymorphic relationships, globals, auth, document locks,
scheduled publish, drafts, versions, uploads, access rules, and hook order. The
schema now has placeholders for the major system tables, but the adapter still
has to prove Payload lifecycle compatibility.

The key boundary to test is that CMS content can share `fx_app_row` and
`fx_app_edge`, while Payload-only lifecycle state remains in fixed
`fx_payload_*` tables and cannot be bypassed by direct `ctx.db` writes.

### Cross-Scope And Global Queries

The default model is scope-local. Global leaderboards, cross-project analytics,
multi-store admin search, and marketplace-wide product search should not be
pretended to be ordinary strongly consistent `ctx.db` queries. They need
explicit internal read models, analytics stores, or bounded cross-scope query
APIs with clear freshness rules.

### Authorization Is Not Fully Designed Here

This file records storage and sync schema. It does not fully define Flarex auth,
role/permission storage, API-key storage, or field-level authorization. Payload
auth support is represented only for Payload-backed collections. Platform auth
and app auth still need their own design record.

### First Proof Slice

The first implementation slice should be deliberately small:

```text
logical tables:
  posts
  categories

shared storage:
  fx_app_row
  fx_app_edge
  fx_app_index_entry
  fx_app_unique_key

operation:
  ctx.db.transact creates a post, categories, edge rows, index rows,
  commit row, outbox row

live query:
  query posts by category
  change category edge
  DeploymentSyncDO reruns affected query
```

This proves the Flarex app storage foundation before adding Payload or Medusa
adapter complexity.

## Open Implementation Choices

These are still implementation choices, not product boundary changes:

- one Postgres schema with prefixes vs multiple Postgres schemas;
- whether any high-scale paid deployment can opt into promoted physical app
  tables later, while hosted shared-schema mode remains the default;
- exact layout and type columns for `fx_app_index_entry` so declared indexes are
  efficient without creating app-specific physical tables;
- whether PostgreSQL 19 `CREATE PROPERTY GRAPH` generation is enabled only for
  admin/internal tooling at first or also for selected query-planner paths;
- durable server query cache enabled by default or only after measurement;
- whether app graph views should expose one generic `app_entity/app_relation`
  graph or generated label-specific graph views filtered by table/relation id;
- exact `fx_version` representation on Medusa reserved tables;
- whether high-volume commit summaries stay JSONB or split into typed summary
  tables.

Changing those physical choices should not change the public API or ownership
rules above.
