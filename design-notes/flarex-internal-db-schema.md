# Flarex Internal Database Schema Direction

Status: accepted logical target and physical-policy inventory with an explicit
staged v1 cutline; prototype storage and part of the replacement foundation
are implemented, while exact current status belongs to the focused roadmaps

Authoritative correction: see
[`flarex-db-accepted-design.md`](./flarex-db-accepted-design.md). When an older
example in this long-form note conflicts with that decision record or the v1
cutline below, the accepted design controls.

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
  app/Payload data is stored as typed JSON rows plus relational sidecars
  Medusa data is stored in Flarex-owned reserved relational system tables
  Flarex server query functions are the default sync unit
  one DeploymentSyncDO per scope tracks a contiguous commit cursor, reruns,
  and fanout
  projections/read models are optional internal optimizations only
```

This is a logical schema direction, not a finished migration file. Exact
physical names can change, but ownership boundaries should not.

## Accepted Corrections And Status

This note previously blended a long-term schema, a v1 inventory, and an
unimplemented SessionDO/cache design. Use these statuses:

| Item | Status |
| --- | --- |
| Current `documents`, `indexes`, Postgres invoke sessions, subscriptions, and outbox | Implemented unshipped prototype baseline; regression evidence only |
| Typed app row JSON plus derived index/edge/unique sidecars | S06 row revision/current kernel implemented internally; derived sidecars remain accepted planned consumers |
| Edge revision history | Long-term target; current-only stable occurrence rows are sufficient for the first slice when commit atoms cover invalidation |
| Dedicated physical Payload lifecycle tables | Deferred until adapter parity or measurement; start with reserved logical collections |
| Medusa relational tables | Accepted, but generated from DML, links/joiner metadata, migrations, and adapter capabilities; not DML alone |
| Generic SessionDO for Payload/Medusa | Rejected as a v1 assumption |
| Per-scope DeploymentSyncDO plus Postgres commit feed and fenced cursor mirror | Accepted v1 target; the prototype Postgres query registry is not a required dual owner |
| VersionDO, DocCacheDO, QueryCacheDO | Deferred optimization |

Additional invariants:

- `scope_id` is mandatory authority in shared-table data and operational state
  and participates in every primary key, unique constraint, and intra-scope
  foreign key. Control catalog IDs may be globally unique, but composite
  foreign keys must prevent definitions from mixing deployments.
- One `SnapshotToken { scopeId, epoch, commitSeq }` replaces ambiguous
  wall-clock `beginTs` comparisons.
- Stable catalog identities are separated from immutable versioned
  definitions.
- Relation sidecars key each occurrence, including nested path and locale; a
  repeated target must not collide with another occurrence.
- A generic `ctx.db + ctx.commerce` atomic transaction is not supported.
  Commerce-affecting atomic behavior belongs behind a Medusa-owned
  facade/workflow and trusted transaction lane.
- The current unshipped prototypes use clean replacement: trusted activation
  fence, target-native validation, internal-caller switch, and prototype
  removal. Backfill, comparison, scoped cutover, and runtime rollback are
  conditional on proven shipped data, traffic, or external contracts.

## Canonical Storage Rule

For Flarex app data and Payload CMS-shaped content, the authoritative value is
the typed row JSON body. Relational tables around it are sidecars derived during
the same final commit:

```text
fx_app_row_rev/current.data_json
  = source of truth for app/Payload row value

fx_app_index_entry_rev/current
  = declared scalar/compound index acceleration and range read dependencies

fx_app_edge_rev/current
  = relationship, upload, join, reverse lookup, access, and invalidation graph

fx_app_unique_key
  = uniqueness enforcement, including sparse/localized Payload semantics

fx_app_block_index or equivalent declared index entries
  = block type/order metadata when block queries need it
```

This is not a loose document database and not pure InstantDB-style EAV. It is a
typed relational row store with JSON value bodies and normalized sidecars.

Medusa is different: Medusa commerce data uses Flarex-owned reserved relational
system tables generated from DML, link/joiner metadata, migration history, and
adapter capabilities. Medusa rows are not stored in the generic app/Payload row
table.

## Core Rules

- One physical FlarexDB can contain app data, Payload-backed CMS data, Medusa
  reserved commerce data, workflow state, locks, commits, outbox, and sync
  control tables.
- Postgres/FlarexDB is the authoritative data store for the proposed
  Hyperdrive/Worker executor path.
- Flarex app data uses a shared physical app storage schema by default: typed
  authoritative row JSON plus derived relational sidecars for scalar indexes,
  relationships/uploads, uniqueness, block metadata, read-set/OCC, and sync.
  App tables remain logical tables in the catalog, not one physical Postgres
  table per app table.
- Payload CMS content can share Flarex app storage for CMS-marked app tables,
  while Payload lifecycle/system state starts as reserved logical collections;
  dedicated `fx_payload_*` tables are a later parity/performance choice.
- Payload blocks, arrays, rich text, groups, and localized values stay embedded
  in the authoritative row by default. Only declared queryable fields,
  relationships/uploads, uniqueness, and block metadata are extracted into
  sidecars.
- Medusa data is generated from its complete persistence manifest into reserved
  relational system tables. Product, Cart, Order, Pricing, Inventory, workflow,
  and link tables are not stored in generic app row storage.
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

## Normative Physical Identifier And Index Policy

The SQL blocks in this document are logical DDL sketches. Earlier sketches use
`text` broadly for convenience; those declarations are not an accepted mandate
for replacement migrations. Concrete DDL must follow this section and the
accepted architecture's physical identifier policy.

```text
trusted authority:
  scope_id, epoch               -> native uuid in shared Postgres tables
  branded scope_/epoch_ strings -> API/protocol representation only

ordered transaction identity:
  commit_seq, outbox_seq        -> scope-local bigint

catalog identity:
  table_id, logical_index_id,
  relation_id, constraint_id    -> compact trusted numeric logical key
  index_definition_id           -> separately branded deployment-local
                                   positive signed-32-bit physical spec key
  public/global reference       -> optional separate opaque uuid

Flarex app document identity:
  developer representation     -> v1 positive compact table ID plus canonical
                                   lowercase UUID; opaque and table-qualified
  physical representation      -> compact table key + the UUID's exact 16 bytes
  generator                    -> current v1 compatibility path remains UUIDv4;
                                   UUIDv7 requires a later measured decision

adapter-owned identity:
  Payload/Medusa IDs            -> compiled from the real adapter schema
  wide external identity       -> external unique key plus compact surrogate
                                  when required by hot index economics
```

UUID bytes have no ordering semantics. UUIDv7 is not the transaction cursor and
must not become implicit business ordering. If selected by a later identity
contract, its time disclosure, clock behavior, insertion locality, and
divergence from Convex must be recorded and benchmarked first. Payload and
Medusa are not forced into that choice.

Index column order follows the actual access path: equality authority prefixes
first, the range/order column next, and a unique row identity last. Thus stable
updated-row pagination is `(scope_id, table_id, updated_at DESC, row_id)`, and
declared app index pagination is
`(scope_id, index_definition_id, encoded_key, row_id)`.
Commit/outbox feeds retain their scope-local numeric cursors.

Do not create a second latest-revision index solely to reverse `commit_seq` when
the primary-key B-tree can satisfy the lookup with a backward scan. Every
additional index requires an explicit query/OCC/uniqueness owner and measured
justification because it increases write amplification. The physical plan must
also define a maximum `encoded_key` size and test that bound before publication.

## Namespaces

Use logical namespaces even if the first implementation is one Postgres schema
with prefixed tables.

```text
fx_control.*
  platform catalog, schema catalog, deployment state

fx_app.*
  shared physical app row history/current rows, derived app edges, declared
  app indexes, block metadata indexes, and app unique keys

fx_payload.*
  reserved Payload/CMS logical collections first; optional dedicated physical
  tables later for drafts, versions, uploads, auth, locks, globals, and
  scheduled publish

fx_medusa.*
  Medusa reserved commerce tables generated from DML, link/joiner metadata,
  migration history, and adapter capabilities

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
  unique (deployment_id),
  unique (id, deployment_id),
  foreign key (deployment_id) references fx_control_deployment (id),
  foreign key (deployment_id, active_schema_version_id)
    references fx_control_schema_version (deployment_id, schema_version_id)
)

fx_control_schema_version (
  deployment_id text not null,
  schema_version_id text not null,
  version integer not null,
  manifest_codec_version integer not null,
  manifest_json jsonb not null,
  manifest_bytes bytea not null,
  manifest_sha256 bytea not null,
  created_at timestamptz not null,
  primary key (deployment_id, schema_version_id),
  unique (deployment_id, version),
  check (octet_length(manifest_bytes) > 0),
  check (octet_length(manifest_sha256) = 32),
  foreign key (deployment_id) references deployments (deployment_id)
)
```

Accepted S03-B1/S03-B2a refinement: the schema-version row is a deployment-owned,
immutable source artifact, not a lifecycle row. `manifest_json` is the semantic
schema input; `manifest_bytes` retains the exact versioned canonical UTF-8
encoding; and `manifest_sha256` stores its raw 32-byte SHA-256 digest. PostgreSQL
`jsonb` serialization is never checksum input. Stable identity and intentionally
normalized operational catalog rows are compiled from and verified against
this artifact rather than edited independently. A table-definition projection
is not one of those rows.

The artifact has no mutable `status` in S03-B1. D4 owns separate validation
evidence/readiness; S04 owns activation writes. Any mutable state remains
separate from the immutable source artifact.
`fx_control_scope.active_schema_version_id` remains the sole future activation
authority.

`fx_control_scope.active_schema_version_id` is the only data-plane activation
pointer. Deployment records may expose a derived/control-plane view, but must
not own a second independently mutable active version.

`fx_control_scope` locates the physical data plane. The authoritative active
storage generation and its fence live on the data-plane scope-clock row that
every final commit locks. Control-plane routing may cache that state, but it is
not allowed to lead the data-plane fence or become a second commit authority.

The accepted stable table catalog is the implemented S03-A shape:

```sql
fx_control_table (
  deployment_id text not null,
  table_id integer not null,
  namespace text not null, -- app, payload, medusa, system
  logical_name text not null,
  created_at timestamptz not null default now(),
  primary key (deployment_id, table_id),
  unique (deployment_id, namespace, logical_name),
  check (table_id between 1 and 2147483647),
  foreign key (deployment_id) references deployments (deployment_id)
)
```

There is deliberately no `fx_control_table_definition`. Its proposed
`physical_name` and `definition_json` columns would copy the same versioned
table definition already held by `fx_control_schema_version.manifest_json` and
create drift/reconciliation risk. S03-B2a instead defines a closed,
deterministically ordered `tableDefinitions` manifest section; S03-B2b will
bind its asserted names to `fx_control_table` and persist only the existing
schema-version artifact.

Accepted S03-B2b refinement: binding is an optimistic plan, not an independent
catalog publication. Trusted code validates at most 10,000 app declarations,
observes existing bindings plus the deployment catalog high-water mark, and
assigns missing IDs deterministically outside a lock. After the planned section
is hashed outside SQL, the final transaction locks the deployment, rejects any
stale observation, inserts the exact planned mappings, and inserts/replays the
B1 artifact atomically. The B2b1 transaction helper remains internal and never
commits by itself. B2b2 adds one public persistence-facade coordinator, retains
both prepared child tokens in one private combined token, and performs at most
three fresh attempts. Only typed stale plans retry; every retry replans and
rehashes, while conflicts, corruption, invalid input, and SQL errors are
terminal.

The following column/relation/constraint sketches remain longer-range
provenance, not accepted S03-B2a DDL. The `fx_control_index`, physical
definition, and developer schema-binding blocks are now refined by S03-C2/C3:
the physical ID is a separate signed-32-bit brand, the stored semantic payload
is the accepted S05-A spec plus canonical evidence, and a composite foreign key
proves each developer binding matches its definition owner. C4 now refines the
build-state block into located data-plane DDL with a local clock parent and
clock-joined fenced read. Column/relation/constraint blocks remain unaccepted
proposals.

```sql
fx_control_column (
  id text primary key,
  deployment_id text not null,
  table_id text not null,
  stable_name text not null,
  created_at timestamptz not null,
  unique (deployment_id, id),
  unique (deployment_id, table_id, stable_name),
  foreign key (deployment_id, table_id)
    references fx_control_table (deployment_id, id)
)

fx_control_column_definition (
  deployment_id text not null,
  schema_version_id text not null,
  column_id text not null,
  table_id text not null,
  logical_name text not null,
  physical_name text not null,
  validator_json jsonb not null,
  nullable boolean not null,
  unique_key boolean not null default false,
  cms_metadata jsonb,
  primary key (deployment_id, schema_version_id, column_id),
  unique (deployment_id, schema_version_id, table_id, logical_name),
  foreign key (deployment_id, schema_version_id)
    references fx_control_schema_version (deployment_id, id),
  foreign key (deployment_id, column_id)
    references fx_control_column (deployment_id, id),
  foreign key (deployment_id, table_id)
    references fx_control_table (deployment_id, id)
)

fx_control_index (
  deployment_id text not null,
  logical_index_id integer not null,
  table_id integer not null,
  descriptor text not null,
  created_at timestamptz not null default now(),
  primary key (deployment_id, logical_index_id),
  unique (deployment_id, table_id, descriptor),
  foreign key (deployment_id, table_id)
    references fx_control_table (deployment_id, table_id)
)

fx_control_index_definition (
  deployment_id text not null,
  index_definition_id integer not null,
  access_kind text not null, -- developer | by_creation_time
  access_identity_id integer not null,
  table_id integer not null,
  logical_index_id integer,
  physical_spec_codec_version integer not null,
  physical_spec_json jsonb not null,
  physical_spec_bytes bytea not null,
  physical_spec_sha256 bytea not null,
  created_at timestamptz not null default now(),
  primary key (deployment_id, index_definition_id),
  unique (deployment_id, index_definition_id, logical_index_id),
  unique (
    deployment_id,
    access_kind,
    access_identity_id,
    physical_spec_sha256
  ),
  foreign key (deployment_id, table_id)
    references fx_control_table (deployment_id, table_id),
  foreign key (deployment_id, logical_index_id, table_id)
    references fx_control_index (
      deployment_id,
      logical_index_id,
      table_id
    ),
  check (
    (access_kind = 'developer'
      and logical_index_id is not null
      and access_identity_id = logical_index_id)
    or
    (access_kind = 'by_creation_time'
      and logical_index_id is null
      and access_identity_id = table_id)
  )
)

fx_control_schema_version_index_binding (
  deployment_id text not null,
  schema_version_id text not null,
  logical_index_id integer not null,
  index_definition_id integer not null,
  required_for_activation boolean not null,
  primary key (deployment_id, schema_version_id, logical_index_id),
  foreign key (deployment_id, schema_version_id)
    references fx_control_schema_version (deployment_id, schema_version_id),
  foreign key (
    deployment_id,
    index_definition_id,
    logical_index_id
  ) references fx_control_index_definition (
    deployment_id,
    index_definition_id,
    logical_index_id
  ),
  check (required_for_activation is true)
)

-- C3 persists developer definition/binding pairs through one package-internal
-- caller-owned transaction operation. by_creation_time is representable as a
-- table-owned definition. D1 now compiles canonical developer plus intrinsic
-- creation-time requirements from the bound full artifact, but writes none of
-- them. D2a composes one authenticated, process-local, no-write full-envelope
-- preparation. D2b derives per-table identity-only tokens from that state,
-- reuses D1 canonical evidence, and ensures table-owned intrinsic definitions
-- through the shared C3 allocator after exact locked table-parent verification.
-- It adds no intrinsic schema-binding row. D2c applies and verifies the full
-- projection in one control transaction; D2d owns bounded retry, the routed
-- facade, quota, and whole-publication concurrency proof. D3 now owns
-- idempotent located build reconciliation under the current scope clock, and
-- D4 owns evidence-based
-- readiness. by_id is direct row-identity access and has no definition/build
-- row.

-- This table is located with fx_system_scope_clock. It deliberately carries no
-- deployment copy and has no cross-database control-catalog foreign key.
fx_system_index_build_state (
  scope_id text not null,
  index_definition_id integer not null,
  storage_generation text not null check (storage_generation = 'flarexdb_v1'),
  storage_generation_fence bigint not null check (storage_generation_fence >= 1),
  epoch text not null,
  start_commit_seq bigint not null check (start_commit_seq >= 0),
  lifecycle text not null, -- declared, building, backfilling, validating, enabled, retiring
  cursor_codec_version integer not null check (cursor_codec_version = 1),
  backfill_cursor_row_id bytea,
  attempt_fence bigint not null check (attempt_fence >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope_id, index_definition_id),
  foreign key (scope_id)
    references fx_system_scope_clock (scope_id),
  check (
    backfill_cursor_row_id is null
    or octet_length(backfill_cursor_row_id) = 16
  ),
  check (
    lifecycle not in ('declared', 'building')
    or backfill_cursor_row_id is null
  ),
  check (updated_at >= created_at)
)

-- Cursor v1 is the exclusive last fully committed 16-byte row identity in an
-- ascending exact-snapshot scan. A clock-joined read classifies absent,
-- exact-current, or stale authority without implying enabled/readiness.
-- S03-D3 authenticates the deployment-owned immutable requirement set before
-- resolving this target. Its short transaction locks the local scope clock,
-- inserts missing rows as declared, replays exact-current rows, and resets a
-- stale row to declared while monotonically increasing attempt_fence. The
-- control catalog is re-read after commit; there is intentionally no
-- cross-database foreign key or distributed transaction.

fx_control_constraint (
  id text primary key,
  deployment_id text not null,
  table_id text not null,
  name text not null,
  created_at timestamptz not null,
  unique (deployment_id, id),
  unique (deployment_id, table_id, name),
  foreign key (deployment_id, table_id)
    references fx_control_table (deployment_id, id)
)

fx_control_constraint_definition (
  deployment_id text not null,
  schema_version_id text not null,
  constraint_id text not null,
  constraint_kind text not null, -- not_null, check, foreign_key, unique, exclusion
  definition_json jsonb not null,
  primary key (deployment_id, schema_version_id, constraint_id),
  foreign key (deployment_id, schema_version_id)
    references fx_control_schema_version (deployment_id, id),
  foreign key (deployment_id, constraint_id)
    references fx_control_constraint (deployment_id, id)
)

fx_control_relation (
  id text primary key,
  deployment_id text not null,
  source_table_id text not null,
  target_table_id text,
  stable_name text not null,
  created_at timestamptz not null,
  unique (deployment_id, id),
  unique (deployment_id, source_table_id, stable_name),
  foreign key (deployment_id, source_table_id)
    references fx_control_table (deployment_id, id),
  foreign key (deployment_id, target_table_id)
    references fx_control_table (deployment_id, id)
)

fx_control_relation_definition (
  deployment_id text not null,
  schema_version_id text not null,
  relation_id text not null,
  source_field text not null,
  relation_kind text not null, -- one, many, one_of, many_of, back
  polymorphic_targets_json jsonb,
  ordered boolean not null default false,
  physical_strategy text not null, -- app_json_ref, app_edge, payload_system, medusa_reserved_link, virtual_reverse
  graph_label text,
  source_graph_label text,
  target_graph_label text,
  graph_exposable boolean not null default false,
  primary key (deployment_id, schema_version_id, relation_id),
  foreign key (deployment_id, schema_version_id)
    references fx_control_schema_version (deployment_id, id),
  foreign key (deployment_id, relation_id)
    references fx_control_relation (deployment_id, id)
)

fx_control_migration (
  id text not null,
  scope_id text not null,
  deployment_id text not null,
  schema_version_id text not null,
  owner_module text not null,
  migration_name text not null,
  checksum text not null,
  depends_on_json jsonb not null,
  direction text not null,
  transactional_mode text not null,
  status text not null, -- planned, running, applied, failed, rolled_back
  attempt integer not null default 0,
  lease_owner text,
  lease_fence bigint,
  lease_expires_at timestamptz,
  backfill_cursor_json jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  error_json jsonb,
  primary key (scope_id, id),
  unique (scope_id, schema_version_id, migration_name),
  foreign key (scope_id, deployment_id)
    references fx_control_scope (id, deployment_id),
  foreign key (deployment_id, schema_version_id)
    references fx_control_schema_version (deployment_id, id)
)
```

The index sketches intentionally omit `unique_index` and `predicate_json`.
Convex ordinary database indexes define only a descriptor and ordered fields;
uniqueness, partial predicates, text indexes, and vector indexes need separate
source-driven contracts rather than nullable placeholders. Lifecycle policy is
also not physical-spec identity. A staged/required-for-activation change can
reuse a physical definition; a kind, field, predicate, or codec change cannot.
The build-state fence columns above are requirements, not accepted C1 DDL.

## Flarex App Shared Storage And Payload Content

Default hosted Flarex app tables should not compile to one physical Postgres
table per app table. That would pollute a shared database when thousands of apps
exist.

Instead, app tables are logical catalog tables stored in a fixed shared
physical schema. The authoritative value is the row JSON body. Queryable and
consistency structures are derived relational sidecars.

```text
fx_app_row_rev
  authoritative app/Payload row history

fx_app_row_current
  current authoritative app/Payload rows

fx_app_index_entry_rev/current
  declared scalar and compound query indexes

fx_app_edge_rev/current
  derived relationship, upload, join, and reverse lookup edges

fx_app_unique_key
  declared unique constraints

fx_app_block_index
  optional block type/order metadata for Payload-style blocks
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
into shared row-history/current tables. S06 replaces the earlier text-heavy SQL
sketch with this accepted physical contract:

```text
fx_app_row_rev
  key
    native scope UUID
    positive compact table ID
    exact 16-byte row identity
    positive scope-local commit sequence
  provenance
    native write-epoch UUID (not a visibility key)
    optional prior commit sequence
    immutable schema-version ID
    trusted positive finite float64 creation time
  live evidence
    Value Codec V1 JSON
    retained canonical bytes
    SHA-256
  tombstone evidence
    explicit tombstone discriminator
    SQL NULL value JSON, canonical bytes, and hash

fx_app_row_current
  key
    native scope UUID + compact table ID + exact 16-byte row identity
  payload
    one commit-sequence pointer with a composite foreign key to fx_app_row_rev
  authority
    latest-read optimization only; no duplicated row value
```

The revision primary-key B-tree serves backward point history lookup, so S06
does not add a duplicate latest-revision index. Generic status/timestamp columns
and updated-time pagination remain unowned and are not part of the row kernel.

`scope_id` is internal deployment/project isolation. Developers should not model
their own app tenancy by relying on this column. If the deployment uses
per-project schemas/databases, `scope_id` can disappear physically while the
logical contract remains.

Forward has-one relations, Payload relationship fields, Payload upload refs,
and relationships nested inside blocks stay in `data_json` in the shape the
runtime expects. Flarex also extracts them into edge sidecars for joins, reverse
lookups, access checks, invalidation, and generated relation APIs:

The following edge SQL is an older long-form sketch, not accepted S12 DDL. It
predates the R01/R02 logical-versus-semantic-versus-physical definition split,
final compact physical policy, canonical occurrence/collision evidence, and the
O10-R snapshot protocol. The foundation roadmaps control those contracts.

```sql
fx_app_edge_rev (
  scope_id text not null,
  epoch text not null,
  edge_id text not null,
  occurrence_key text not null,
  relation_id text not null,
  source_table_id text not null,
  source_row_id text not null,
  target_table_id text not null,
  target_row_id text not null,
  field_path text,
  relation_to text,
  position integer,
  locale text,
  metadata_json jsonb,
  commit_seq bigint not null,
  deleted boolean not null default false,

  primary key (
    scope_id,
    edge_id,
    commit_seq
  )
)

create index fx_app_edge_rev_source_idx
  on fx_app_edge_rev (
    scope_id,
    relation_id,
    source_table_id,
    source_row_id,
    position,
    commit_seq desc
  );

create index fx_app_edge_rev_target_idx
  on fx_app_edge_rev (
    scope_id,
    relation_id,
    target_table_id,
    target_row_id,
    commit_seq desc
  );

fx_app_edge_current (
  scope_id text not null,
  epoch text not null,
  edge_id text not null,
  occurrence_key text not null,
  relation_id text not null,
  source_table_id text not null,
  source_row_id text not null,
  target_table_id text not null,
  target_row_id text not null,
  field_path text,
  relation_to text,
  position integer,
  locale text,
  metadata_json jsonb,
  commit_seq bigint not null,
  primary key (scope_id, edge_id),
  unique (scope_id, relation_id, source_table_id, source_row_id, occurrence_key)
)

create index fx_app_edge_current_source_idx
  on fx_app_edge_current (
    scope_id,
    relation_id,
    source_table_id,
    source_row_id,
    position
  );

create index fx_app_edge_current_target_idx
  on fx_app_edge_current (
    scope_id,
    relation_id,
    target_table_id,
    target_row_id
);
```

`edge_id` is a stable occurrence identity derived from relation id, source row,
stable nested item/block id, field path, locale, and occurrence identity.
`position` is mutable ordering metadata and is not identity. This allows the
same target to appear more than once, in more than one locale, or under more
than one nested path without a primary-key collision.

Declared app indexes are not arbitrary JSON scans. The compiler writes index
rows when app rows change:

```sql
fx_app_index_entry_rev (
  scope_id text not null,
  epoch text not null,
  index_definition_id integer not null,
  table_id text not null,
  row_id text not null,
  commit_seq bigint not null,

  encoded_key bytea not null,
  key_hash bytea not null,
  key_codec_version integer not null,
  key_json jsonb not null,
  locale text,
  deleted boolean not null default false,

  primary key (scope_id, index_definition_id, key_hash, row_id, commit_seq)
)

create index fx_app_index_entry_rev_scan_idx
  on fx_app_index_entry_rev (
    scope_id,
    index_definition_id,
    encoded_key,
    row_id,
    commit_seq desc
  );

fx_app_index_entry_current (
  scope_id text not null,
  epoch text not null,
  index_definition_id integer not null,
  table_id text not null,
  row_id text not null,
  commit_seq bigint not null,

  encoded_key bytea not null,
  key_hash bytea not null,
  key_codec_version integer not null,
  key_json jsonb not null,
  locale text,

  primary key (scope_id, index_definition_id, key_hash, row_id)
)

create index fx_app_index_entry_current_scan_idx
  on fx_app_index_entry_current (
    scope_id,
    index_definition_id,
    encoded_key,
    row_id
  );
```

`encoded_key` is the ordered scan key. `key_hash` is for equality, dedupe, and
unique enforcement. The exact codec is a core database contract; it must sort
strings, numbers, booleans, time values, null/sparse markers, locale, compound
segments, and row-id tie breakers consistently across Postgres and any future
executor.

The physical definition identity is required here. A stable logical index ID
cannot key these rows because a changed spec must backfill beside the old
enabled spec until cutover. The active schema resolves logical index identity
to one enabled physical definition before reads or OCC dependencies are
recorded.

Declared unique constraints use a fixed unique-key table:

```sql
fx_app_unique_key (
  scope_uuid uuid not null,
  constraint_id integer not null,
  locale_key text not null,
  canonical_key_sha256 bytea not null,
  key_codec_version integer not null,
  encoded_key bytea not null,
  table_id integer not null,
  row_id bytea not null,
  schema_version_id text not null,
  write_epoch_uuid uuid not null,
  commit_seq bigint not null,
  primary key (
    scope_uuid,
    constraint_id,
    locale_key,
    canonical_key_sha256
  ),
  unique (
    scope_uuid,
    constraint_id,
    locale_key,
    table_id,
    row_id
  ),
  foreign key (scope_uuid)
    references fx_system_scope_clock(scope_uuid),
  foreign key (
    scope_uuid,
    table_id,
    row_id,
    write_epoch_uuid,
    commit_seq
  ) references fx_app_row_rev(
    scope_uuid,
    table_id,
    row_id,
    write_epoch_uuid,
    commit_seq
  )
)
```

`locale_key` is empty for non-localized constraints and the normalized locale
for localized constraints. Ordered Index V1 encodes that locale as the leading
component, so the stored bytes and SHA-256 bind localization. PostgreSQL stores
the current target-native ownership claim and exact row-revision provenance;
it does not store a second JSON representation of the key or resolve semantic
constraint definitions. C08 supplies that trusted lowering later.

Trusted code compares `encoded_key` whenever a `canonical_key_sha256` slot
already exists.
Equal bytes enforce ordinary uniqueness. Unequal bytes are a fatal
`CanonicalKeyHashCollision`; V1 aborts the mutation rather than pretending the
hash alone proves equality or attempting to store two unequal keys in one hash
slot.

This keeps hosted Flarex from creating thousands of physical app tables while
still preserving logical tables, relations, indexes, uniqueness, OCC, and live
sync semantics.

Payload blocks are the stress test for this rule. Do not default to one SQL row
per block, and do not store every block subfield as an authoritative triple.
Blocks, arrays, rich text, groups, tabs, and localized values stay embedded in
`data_json` by default:

```json
{
  "content": [
    {
      "id": "block_1",
      "blockType": "hero",
      "headline": "Hello",
      "image": "media_123"
    },
    {
      "id": "block_2",
      "blockType": "richText",
      "body": {}
    }
  ]
}
```

Extract sidecars only where needed:

```text
declared scalar/block subfield index
  -> fx_app_index_entry_rev/current

relationship/upload inside a block
  -> fx_app_edge_rev/current

block type/order lookup
  -> fx_app_block_index, or an equivalent declared index entry
```

Optional block metadata table:

```sql
fx_app_block_index (
  scope_id text not null,
  epoch text not null,
  table_id text not null,
  row_id text not null,
  field_path text not null,
  block_id text not null,
  block_type text not null,
  position integer not null,
  locale_key text not null default '',
  commit_seq bigint not null,
  primary key (scope_id, table_id, row_id, field_path, locale_key, block_id)
)

create index fx_app_block_index_type_idx
  on fx_app_block_index (
    scope_id,
    table_id,
    field_path,
    locale_key,
    block_type,
    row_id
  );
```

If block metadata participates in OCC or sync invalidation, it must be updated
inside the same final commit as the row and either carry `commit_seq` or be
represented by normal revision/current sidecars.

Do not store Medusa commerce data in `fx_app_row_current` or
`fx_app_row_rev`. Medusa has its own reserved system tables. Do not store
Payload lifecycle state in app rows unless it is normal CMS content for a
CMS-marked app table.

Payload complex fields use shared app storage for normal CMS content. Reserved
logical Payload collections initially hold lifecycle state that Payload owns:
versions, drafts, uploads, globals, document locks, scheduled publish, and
auth/session state. Dedicated tables below are optional later mappings.

For v1, represent these as reserved logical Payload collections over the app
row store and derive their exact shape from `BaseDatabaseAdapter` plus adapter
conformance. The physical tables below are long-term examples, not the first
implementation inventory. In particular, drafts are version semantics,
collection and global versions are distinct, and lock target/owner identities
must support globals and polymorphic auth collections.

Do not create `fx_payload_child_entity` by default. It is a possible v2 escape
hatch for block-level editing/querying at scale, not the v1 representation for
normal blocks and arrays. The v1 representation is embedded row JSON plus
declared index/edge/block metadata sidecars.

```sql
fx_payload_version (
  id text not null,
  scope_id text not null,
  collection text not null,
  document_id text not null,
  version_number integer not null,
  snapshot_json jsonb not null,
  created_by text,
  created_at timestamptz not null,
  primary key (scope_id, id),
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
  id text not null,
  scope_id text not null,
  collection text not null,
  document_id text not null,
  bucket text not null,
  object_key text not null,
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  metadata jsonb,
  created_at timestamptz not null,
  primary key (scope_id, id)
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
  id text not null,
  scope_id text not null,
  collection text not null,
  document_id text not null,
  action text not null, -- publish, unpublish
  run_at timestamptz not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (scope_id, id)
)

fx_payload_auth_account (
  id text not null,
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
  primary key (scope_id, id),
  unique (scope_id, collection, email),
  unique (scope_id, collection, username)
)

fx_payload_session (
  id text not null,
  scope_id text not null,
  account_id text not null,
  token_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  primary key (scope_id, id),
  unique (scope_id, token_hash),
  foreign key (scope_id, account_id)
    references fx_payload_auth_account (scope_id, id)
)
```

Payload uses these through `@payloadcms/db-flarex`. Public `ctx.db` can read or
write CMS-marked app tables only according to the collection write policy.
Lifecycle-sensitive fields can be `payload_only`.

Only generate dedicated Payload system tables after the adapter slice and
measurement justify them, and only for enabled features. For simple CMS-marked
logical app tables, shared app rows plus app edges may be enough.

## Medusa Reserved Tables

Medusa tables are real relational tables generated from Medusa DML, link/joiner
metadata, migration history, and declared custom adapter capabilities. They are
reserved. App developers do not access them through public `ctx.db`.

Example shape:

```sql
fx_medusa_product (
  id text not null,
  scope_id text not null,
  title text not null,
  handle text,
  status text not null,
  metadata jsonb,
  fx_version bigint not null,
  deleted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (scope_id, id)
)

create unique index fx_medusa_product_handle_uq
  on fx_medusa_product (scope_id, handle)
  where deleted_at is null;

fx_medusa_product_variant (
  id text not null,
  scope_id text not null,
  product_id text not null,
  title text not null,
  sku text,
  metadata jsonb,
  fx_version bigint not null,
  deleted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (scope_id, id),
  foreign key (scope_id, product_id)
    references fx_medusa_product (scope_id, id)
)

fx_medusa_link_product_sales_channel (
  scope_id text not null,
  product_id text not null,
  sales_channel_id text not null,
  fx_version bigint not null,
  deleted_at timestamptz,
  primary key (scope_id, product_id, sales_channel_id),
  foreign key (scope_id, product_id)
    references fx_medusa_product (scope_id, id)
)
```

Rules:

- Medusa DML is one schema input for `fx_medusa_*`; ModuleJoinerConfig/link
  definitions, ModuleMigrationAdapter history, backfills/triggers, and custom
  repository/provider capabilities are also required.
- Medusa services/workflows access these tables through the Flarex-backed
  Medusa adapter.
- Medusa modules or services that use raw SQL, database-specific query helpers,
  or custom repositories must be classified during adapter work. They cannot
  bypass FlarexDB by receiving raw Postgres access in the Worker path.
- App-to-commerce references should normally live in app tables or
  app edge sidecars, not as public Medusa Module Links.
- Internal Medusa Module Links remain allowed where original Medusa expects
  them.
- Shared physical Medusa tables require one homogeneous platform Medusa schema
  and module set. Staggered versions or custom modules use per-scope
  schemas/databases until another safe strategy is proven.
- Medusa reads are current relational reads inside a Medusa-owned transaction.
  They are not generic SessionDO exact-snapshot reads unless a separate MVCC
  representation and complete query overlay are implemented.

## Commit, OCC, And Transaction Tables

The commit log is the source of sync ordering. It replaces the old idea that a
projection database is the normal sync source. The following S08 inventory
supersedes the earlier generic `bigserial` commit ID, text scope/epoch,
`summary_json`, source/mutation metadata, and polymorphic commit-write sketch.
Those shapes are not the accepted target.

```text
fx_system_scope_clock
  existing native scope_uuid and epoch_uuid projections
  scope-lifetime last_commit_seq
  oldest_available_commit_seq, fixed at 0 until O11 owns advancement

fx_system_commit
  key: native (scope_uuid, commit_seq)
  child authority: unique (scope_uuid, epoch_uuid, commit_seq)
  exact typed-app-row change_count in 0..16,000
  finite database-owned committed_at metadata

fx_system_commit_app_row_change
  key: (scope_uuid, commit_seq, change_ordinal)
  exact commit FK: (scope_uuid, epoch_uuid, commit_seq)
  exact row-revision FK including the same epoch provenance
  numeric table_id plus 16-byte row_id
  no operation duplication, JSON summary, global surrogate ID, or text scope

fx_app_row_rev
  narrow unique projection including write_epoch_uuid so the change child
  physically proves that header and revision epoch provenance agree
```

The package-private `listAfter` contract captures the scope clock, floor,
headers, and children in one read-only repeatable-read snapshot. It selects the
largest contiguous prefix after an exclusive cursor without splitting a
commit, capped at 100 headers and 16,000 children, and returns explicit
continuation. Missing interior or tail headers, count/ordinal mismatches, or
scope/epoch/revision mismatches are corruption. The floor has no S08 writer and
must remain `0`; retention advancement and reconnect/reset semantics belong to
O11 and roadmap 21 respectively.

The authoritative snapshot token is `(scope_uuid, epoch_uuid, commit_seq)`. Do
not use wall-clock time as the transaction begin token.

An empty scope has `last_commit_seq = 0`. The final trusted transaction locks
the scope clock, allocates `last_commit_seq + 1`, publishes that commit and all
authoritative effects, then advances the stored counter before the same SQL
transaction commits. Rollback consumes no sequence. Outbox ordering follows
the same rule with its own counter; it is not the live-query commit cursor.

Epoch rollover fences every old session and subscription and forces a full
resnapshot, but it does not reset authoritative data. Scope-local commit/outbox
sequences remain monotonic and are never reused. Current rows and uniqueness
keys stay epoch-independent; durable tokens/cursors still store epoch so an
old-epoch attempt cannot commit.
An epoch column on a persisted row records the epoch of its last write; readers
do not hide untouched rows merely because their write epoch is older.

The active read/write journal may later live in SessionDO SQLite, but the
located Postgres data plane keeps two small S07 authorities. Exact executable
DDL belongs to migration 0026 and the focused schema roadmap; this inventory
records ownership rather than providing copy-paste SQL.

```text
fx_system_tx_session
  key:
    native scope UUID
    native UUID session ID
  immutable request authority:
    flarexdb_v1 generation and positive signed-int64 fence
    package ID, dynamic-worker artifact ID/source hash/execution module
    mutation function path/kind, schema version, and policy version
    canonical validated-argument JSON, Value Codec V1 bytes, and SHA-256
    cryptographic identity/access-policy SHA-256 for matching only
    authorization grant ID, canonical grant JSON and Value Codec V1 bytes,
      SHA-256, expiry, and nonnegative signed-int64 revocation epoch
    nonblank internal request key bounded to 1,024 UTF-8 bytes for its
      PostgreSQL lookup index, and request SHA-256
  mutable fenced state:
    lifecycle
    current positive signed-int64 attempt fence
    protocol version 1
    hard expiry
    created/updated timestamps
  relational key:
    unique (scope UUID, session ID, current attempt fence)

fx_system_snapshot_lease
  key:
    at most one row per (scope UUID, session ID)
  current-attempt projection:
    attempt fence
    snapshot epoch UUID
    nonnegative signed-int64 snapshot commit sequence
    lease expiry
  relationship:
    (scope UUID, session ID, attempt fence) restrictively references the
    session's exact current attempt
```

The session owns generation and request authority; the lease owns only the
current attempt's snapshot-retention pin. The lease does not cascade through a
parent update or delete. O03-B enforces that every active session has a current
lease. O08-A now enters `retrying`, deletes the exact journal root and its
cascading children before the old lease, advances the parent fence, inserts the
fresh lease and pristine root, and returns to `running` in one transaction.

Package, artifact, schema, and policy pins may refer to control-plane records
in another database, so trusted creation verifies them and stores copied pins
rather than inventing impossible cross-database foreign keys. Canonical grant
evidence retains the minimized inert claims/capabilities needed for trusted
revalidation; the identity/policy digest and legacy FNV fingerprint are not
standalone authorization.

S07 adds no normalized dependency table, syscall sequence, journal digest,
committed-result evidence, token, or S09-A idempotency authority. S07-A adds the
scope-wide revocation column and storage primitive; O03-A supplies signed-grant
semantics; O03-B owns atomic activation and basic exact-fence lease mechanics;
O04 owns point dependencies; C02 owns the journal protocol; C05-A introduces
the private exact-fence transition to `finishing` and its same-process
continuation; C05-B owns fresh-process finishing reconstruction and complete
publication composition; C06 orchestrates the finish endpoint; C03 rejects
late syscalls; S09-A supplies the private success-
receipt shape; O07 deletes the exact lease and stores committed state plus that
durable outcome; O08-A owns exact-attempt replacement while O08-B/C/D retain
the retry coordinators.

`fx_system_scope_clock` is locked only during short trusted authority
transactions such as revocation-epoch advance, O03-B session activation, and
the final commit phase. Do not hold this row lock while user code, Payload
hooks, Medusa workflow steps, network calls, or long actions are running.

## Idempotency And Client Watermarks

Stable internal request keys prevent duplicate application after retries.
S09-A supersedes the earlier text-scope, generic-status sketch with this
private committed-success inventory:

```sql
fx_system_idempotency (
  scope_uuid uuid not null,
  request_key text not null,
  identity_access_policy_sha256 bytea not null,
  function_path text not null,
  request_sha256 bytea not null,
  epoch_uuid uuid not null,
  commit_seq bigint not null,
  result_state text not null, -- available | expired
  result_value_codec_version integer,
  result_semantic_bytes integer,
  result_bytes bytea,
  result_sha256 bytea,
  result_expired_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (scope_uuid, request_key),
  foreign key (scope_uuid) references fx_system_scope_clock(scope_uuid)
)
```

The current internal key is nonblank PostgreSQL text bounded to 1,024 UTF-8
bytes, not yet a public client key. Match digests are exactly 32 bytes, the
function path is nonblank, and the commit sequence is positive. `available`
retains strict Value Codec V1 result evidence within the accepted semantic and
canonical-byte ceilings; `expired` removes all result evidence and records a
finite database-owned expiry time. Both states denote the same committed
success. There is no in-progress, error, log, claim, or attempt-expiry state.

O07 later writes this receipt in the same transaction as authoritative data,
the S08 commit header, committed session state, and S09-B outbox. The receipt's
commit token intentionally has no foreign key to `fx_system_commit`: O11 may
compact pre-floor feed history, while the scope-lifetime key remains
non-reusable and unambiguous. Result-payload expiration and feed/outbox
retention are separate policies. The previous `actor_fingerprint`, JSON
result/error/log, generic status, and attempt-expiry columns are superseded and
are neither migration inputs nor alternate target DDL.

Optional advanced local-first/offline sequencing can use client watermarks:

```sql
fx_system_client_watermark (
  scope_id text not null,
  epoch text not null,
  actor_fingerprint text not null,
  client_id text not null,
  last_mutation_seq bigint not null,
  updated_at timestamptz not null,
  primary key (scope_id, epoch, actor_fingerprint, client_id)
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

The following generic multi-consumer sketch is superseded for the accepted v1
slice. S09-B implements one private `deployment_sync_commit_wake_v1` row keyed
by `(scope_uuid, outbox_seq)`, unique per scope/commit, and owned by the scope
clock without an FK to compactable commit headers. It has no arbitrary payload,
consumer group/cursor, global surrogate ID, allocator, producer, sink, GC, or
redrive API. Its database-time pending/claimed/delivered/dead-lettered state,
claim fence, attempts, retry time, and bounded failure evidence support
at-least-once low-latency wake delivery; the S08 commit/change feed remains the
canonical recovery authority. Generic consumers require a separately accepted
first-consumer contract.

Superseded proposal sketch:

```sql
fx_system_outbox (
  outbox_id bigserial unique,
  scope_id text not null,
  epoch text not null,
  outbox_seq bigint not null,
  commit_seq bigint not null,
  event_type text not null,
  consumer_group text not null,
  idempotency_key text,
  payload_json jsonb not null,
  status text not null default 'pending',
  created_at timestamptz not null,
  available_at timestamptz not null,
  next_attempt_at timestamptz not null,
  attempts integer not null default 0,
  claimed_by text,
  claim_fence bigint,
  claimed_until timestamptz,
  delivered_at timestamptz,
  dead_lettered_at timestamptz,
  last_error text,
  primary key (scope_id, outbox_seq),
  foreign key (scope_id, epoch, commit_seq)
    references fx_system_commit (scope_id, epoch, commit_seq)
)

create index fx_outbox_consumer_pending_idx
  on fx_system_outbox (scope_id, epoch, consumer_group, status, next_attempt_at, claimed_until, outbox_seq);

create unique index fx_outbox_idempotency_idx
  on fx_system_outbox (scope_id, consumer_group, idempotency_key)
  where idempotency_key is not null;

fx_system_outbox_cursor (
  scope_id text not null,
  consumer_name text not null,
  epoch text not null,
  last_outbox_seq bigint not null,
  updated_at timestamptz not null,
  primary key (scope_id, consumer_name)
)
```

Outbox GC is independent from snapshot/reconnect MVCC retention. Pending and
claimed rows are never removed. Dead letters follow explicit operator policy.
Delivered rows compact only after every required consumer has advanced and the
consumer/delivery idempotency window or tombstone policy is satisfied.

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
  -> executor or dispatcher directly wakes the scope's DeploymentSyncDO with a
     compact summary
  -> DeploymentSyncDO matches active read sets and reruns affected queries
```

Durable recovery path:

```text
direct wake fails or DO was evicted
  -> a queue/cron/executor sweep detects scope cursor behind latest commit
  -> DeploymentSyncDO drains fx_system_commit in contiguous order
  -> rebuilds missed hot state
  -> reruns affected queries
```

## Live Sync Durable Tables

The current implementation has an unshipped Postgres live-query registry and
connection leases. Treat them as regression/removal inputs while a deterministic
per-scope `DeploymentSyncDO` becomes the target query/dependency/rerun owner.
Remove the prototype registry after target-only hibernation, reconnect,
state-loss reset, lease cleanup, initial activation, lost-wake recovery, and
caller-migration tests pass; do not dual-register by default.

Postgres keeps a fenced operational cursor mirror for the external sweep. The
following reconnect lease is a future sync-owned proposal, not S07 or accepted
physical DDL. Roadmap 21 must resolve reconnect identity, duration, history
budget, renewal, expiry, and reset semantics before fixing its columns and
constraints:

```sql
fx_sync_deployment_cursor (
  scope_id text primary key,
  applied_through_commit_seq bigint not null,
  epoch text not null,
  updated_at timestamptz not null
)

fx_sync_reconnect_lease (
  scope_uuid uuid not null,
  connection_or_session_id text not null,
  epoch_uuid uuid not null,
  minimum_required_commit_seq bigint not null,
  storage_generation text not null,
  storage_generation_fence bigint not null,
  registration_generation bigint not null,
  expires_at timestamptz not null,
  primary key (scope_id, connection_or_session_id)
)
```

DeploymentSyncDO SQLite, not JavaScript memory alone, stores:

```text
epoch and contiguous appliedThroughCommitSeq
canonical query definitions and generations
dependency -> canonical query index
dirtyThrough/runningAt/resultHash
active ConnectionDO targets or recoverable registrations
bounded continuation state
```

The canonical query key includes scope, scope epoch, active package hash,
schema and policy version, function/component path, canonical arguments, and
identity/access-policy fingerprint. Epoch and package hash are both required.

Initial subscriptions use provisional registration, known-snapshot execution,
durable Postgres registry upsert of the generation/epoch/package/policy/
identity/dependency/result hash, DeploymentSyncDO dependency installation, and
refresh through the current contiguous cursor before publication. Removal
deactivates the registry before the DO forgets the registration. This closes
the execute-before-register and publish-before-registry races.

DeploymentSyncDO SQLite is the actor cursor authority. The DO advances the
fenced Postgres mirror only after committing its local cursor. The mirror may
lag but must never lead; the external lagging-scope sweep reads the mirror, so
lag creates a harmless duplicate wake.

GC retains commit/change history through the minimum live snapshot lease and
reconnect lease plus a safety margin. A reconnect cursor from another epoch or
below the retained floor receives an explicit reset/resnapshot response, never
a partial replay presented as complete.

Cursor rule:

```text
N == appliedThrough + 1 -> apply and advance
N <= appliedThrough     -> duplicate; ignore idempotently
N > appliedThrough + 1  -> load and apply the missing Postgres interval first
epoch mismatch          -> fence old generations and perform a full resnapshot
```

`VersionDO`, `DocCacheDO`, `QueryCacheDO`, and durable query-result tables are
future measured optimizations. Mutation snapshots and initial live-query
correctness do not depend on them. Client read cache remains a browser concern.

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

Flarex-native workflow state belongs in reserved system tables. These generic
tables do not claim compatibility with the Medusa Workflow Engine.

```sql
fx_system_workflow_execution (
  id text not null,
  scope_id text not null,
  workflow_id text not null,
  transaction_id text,
  state text not null,
  input_json jsonb,
  result_json jsonb,
  event_group_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (scope_id, id)
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
  id text not null,
  scope_id text not null,
  kind text not null,
  payload_json jsonb not null,
  due_at timestamptz not null,
  status text not null,
  attempts integer not null default 0,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (scope_id, id)
)
```

These tables back Flarex scheduled functions and Flarex-native recovery paths.
Medusa workflow persistence is compiled from its real DML model, including its
composite workflow/transaction/run identity, execution/context fields,
retention behavior, and partial indexes, or is handled by a lossless
adapter-specific schema. The app API exposes scheduler/workflow commands, not
raw workflow rows.

## Optional Internal Read Models

Read models exist to reduce load on Postgres for known hot or expensive query
shapes. They are optional.

Catalog:

```sql
fx_read_model_definition (
  id text not null,
  scope_id text not null,
  name text not null,
  owner text not null, -- app, payload, medusa, search, system
  source_tables_json jsonb not null,
  freshness_policy_json jsonb not null,
  physical_name text not null,
  created_at timestamptz not null,
  primary key (scope_id, id),
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
  -> ConnectionDO asks the scope's DeploymentSyncDO for a provisional query
     generation at its contiguous cursor
  -> authoritative Query Executor runs the Flarex query at a known snapshot
  -> query returns result + resultHash + typed read set + snapshot token
  -> DeploymentSyncDO installs dependencies and refreshes them through its
     current contiguous cursor
  -> if invalidated during activation, rerun before publication
  -> client receives data(result, commitCursor)
```

Mutation:

```text
Client mutation(args, mutationId)
  -> user code runs without a SQL transaction
  -> supported logical app reads and writes are journaled
  -> trusted executor opens Postgres transaction
  -> validates authority/snapshot/read sets/ranges/locks/idempotency
  -> derives and writes app rows and sidecars
  -> writes relation edges and required indexes
  -> writes fx_system_commit and fx_system_outbox
  -> writes the private successful result-only idempotency receipt
  -> commits
  -> wakes DeploymentSyncDO with summary
```

Payload request transactions and Medusa commerce transactions use their own
trusted adapter lanes. They participate in the same scope commit/change/outbox
protocol, but they are not automatically lowered from the generic app
SessionDO journal and are not exposed as one `ctx.db + ctx.commerce`
transaction.

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
  -> provisionally register before execution
query finishes
  -> refine dependencies from actual rows, relations, indexes, and ranges read
  -> refresh the query token through the current contiguous cursor
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
  Flarex app logical row history/current rows in fx_app_row_rev/current
  Flarex app logical relations/uploads in fx_app_edge_rev/current
  Flarex app declared indexes/unique keys in fx_app_index_entry_*/fx_app_unique_key
  optional block metadata in fx_app_block_index or declared index entries
  Payload-marked app content in shared Flarex app storage
  Payload lifecycle/system state in reserved logical collections, with optional
  later dedicated fx_payload_* tables
  Medusa reserved tables generated from DML, links/joiner metadata, migration
  history, and adapter capabilities

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

- Convex owns one integrated database/runtime. Flarex hosts app, Payload, and
  Medusa adapter lanes over shared scope-clock/commit/change/outbox
  infrastructure; the generic app OCC journal does not execute every adapter.
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
fx_app_row_rev
fx_system_commit
fx_system_commit_app_row_change
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
  Flarex borrows the graph/index/transaction thinking, but app/Payload scalar
  values should not all become authoritative EAV triples. The authoritative
  app value is a typed row JSON body; scalar indexes, relationship/upload
  edges, uniqueness keys, block metadata, OCC dependencies, and sync topics are
  derived relational sidecars.
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
fx_app_row_rev/current
fx_app_edge_rev/current
fx_app_index_entry_rev/current
fx_app_unique_key
fx_app_block_index
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
  for live connection coordination, durable sync cursors/dependency indexes,
  reruns, and optional later caches.
- We borrow cursor/resume/settled/offline concepts, but do not make TanStack DB
  or a browser-side normalized DB mandatory. Default Flarex reads are still
  server query results.
- We avoid the older Flarex idea of mandatory Postgres -> SQLite/DO projection
  stores. Read models remain optional internal optimizations.

Schema pieces from this lineage:

```text
fx_system_client_watermark
fx_system_idempotency
fx_sync_deployment_cursor operational mirror
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
- The current Postgres subscription registry and connection leases are
  unshipped prototype evidence. DeploymentSyncDO SQLite owns target query,
  dependency, generation, and rerun coordination. Remove the prototype registry
  after target-only hibernation, reconnect, state-loss reset, and lost-wake
  parity; no live dual-registry migration is required.

Schema pieces from this lineage:

```text
fx_sync_deployment_cursor
fx_system_outbox_cursor
DeploymentSyncDO durable SQLite canonical-query/dependency indexes
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

- Medusa DML is the source for module table shapes, while links/joiner metadata,
  migration history, and custom capabilities complete the persistence schema.
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
Medusa-owned workflow persistence compiled from the real workflow model
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
- Flarex shared app storage remains the main stored CMS content for CMS-marked
  app tables: embedded row JSON for blocks/arrays/rich text/localization, plus
  derived index, edge, unique-key, and optional block-metadata sidecars.
  Payload-only lifecycle complexity starts in reserved logical collections for
  versions, drafts, uploads, locks, sessions, globals, scheduled publish, and
  auth support.
- Public `ctx.db` may access CMS-marked app fields according to Flarex write
  policy, but it cannot directly bypass Payload-only lifecycle-sensitive rows.

Schema pieces from this lineage:

```text
cms_enabled and cms_metadata in fx_control_*
fx_app_row_rev/current for CMS-marked row values
fx_app_edge_rev/current for Payload relationships/uploads/joins
fx_app_index_entry_rev/current for declared CMS indexes
fx_app_block_index or equivalent index entries for block metadata
reserved logical Payload lifecycle collections
optional later fx_payload_* physical tables after parity/measurement
relation edges for Payload relationship/join shapes
```

### Flarex-Original Decisions

These are not copied directly from one reference system. They are the result of
combining all constraints above:

- One FlarexDB control plane for schema catalog, deployments, commit/OCC,
  outbox, locks, workflows, sync recovery, and optional read models.
- Three authoritative physical storage classes under that control plane:
  shared Flarex app storage, reserved Payload logical storage (with optional
  later dedicated tables), and Medusa relational tables compiled from DML,
  links, migrations, and adapter capabilities.
- Payload and Medusa use Flarex-owned persistence infrastructure, but preserve
  their own adapter/transaction semantics. They are not automatically executed
  through the generic app SessionDO compiler.
- Public developer APIs stay simple: `ctx.db`, `ctx.db.transact`,
  `ctx.commerce`, and `ctx.cms` facades. No public Payload plugin API, no public
  Medusa Link API, and no public projection API in the first design.
- Projections/read models are internal planner/runtime optimizations only. They
  can live in the same FlarexDB or a Flarex-selected derived store later, but
  they are never the source of truth.
- Each lane's final commit phase is short. The trusted lane validates its own
  OCC/transaction invariants, acquires the common scope commit lane, writes
  authoritative rows plus commit/change/outbox records, commits, and wakes
  sync.

## Future PostgreSQL 19 SQL/PGQ Compatibility

PostgreSQL 19 adds SQL/PGQ property graph queries. It may improve expression or
planning for selected fixed-hop FlarexDB reads later, but no performance
improvement is assumed and it must not become a first-version dependency.

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
  shared Flarex app storage:
    fx_app_row_rev/current
    fx_app_edge_rev/current
    fx_app_index_entry_rev/current
    fx_app_unique_key
    optional fx_app_block_index
  Medusa reserved relational tables
  reserved Payload logical collections and optional later physical tables
  graph metadata in fx_control_table and fx_control_relation
  no per-app physical table explosion

Later on PostgreSQL 19:
  capability-gate one or a small fixed number of platform-owned
  CREATE PROPERTY GRAPH views per physical placement
  retain indexed relational SQL as the portable PGlite/older-Postgres path
  compare SQL and GRAPH_TABLE result, authorization, pagination, dependency,
  planning, and execution behavior before selecting a fixed-hop query shape
```

Example future generated app graph over shared storage:

```sql
CREATE PROPERTY GRAPH flarex_app_graph
  VERTEX TABLES (
    fx_app_row_current
      KEY (scope_id, table_id, row_id)
      LABEL app_entity
      PROPERTIES (scope_id, table_id, row_id)
  )
  EDGE TABLES (
    fx_app_edge_current
      KEY (scope_id, edge_id)
      SOURCE KEY (scope_id, source_table_id, source_row_id)
        REFERENCES fx_app_row_current (scope_id, table_id, row_id)
      DESTINATION KEY (scope_id, target_table_id, target_row_id)
        REFERENCES fx_app_row_current (scope_id, table_id, row_id)
      LABEL app_relation
  );
```

This abbreviated graph assumes an app-to-app edge subset; polymorphic and
commerce-target edges need generated label-specific views with valid endpoint
tables. That generic app graph is useful for internal traversal, admin/debug
views, and schema visualization. It is less optimized than a graph over typed
physical tables, but it avoids table pollution in hosted shared-schema mode.
It is conceptual PG19 DDL, not accepted S12 edge DDL. R01/R02/S12 must first
freeze immutable semantic and physical edge-definition identity, canonical
occurrence/collision evidence, endpoint projection uniqueness, and
relation-aware access paths.
The graph projection stays identity-first. Complete row JSON is resolved through
the normal Flarex point-read and codec boundary rather than exposed as a default
vertex property.

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
The platform does not create a graph object per scope, app, schema version, or
logical relation. Mutation relation reads remain disabled until the dedicated
one-hop snapshot, registration-race, phantom, and read-your-writes gate passes;
SQL/PGQ does not satisfy that gate merely by expressing the joins.

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
app data goes through `fx_app_row_rev/current`,
`fx_app_edge_rev/current`, declared app indexes, unique keys, and optional
block metadata; Payload starts with reserved logical collections and Medusa
keeps adapter-owned relational tables compiled from all required schema inputs.
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
point: many logical app tables share `fx_app_row_rev/current`,
`fx_app_edge_rev/current`, `fx_app_index_entry_rev/current`,
`fx_app_unique_key`, and optional block metadata sidecars.

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

The replacement migration must additionally prove index economics rather than
only query correctness: native authority-key width, compact catalog-key width,
stable cursor plans, encoded-key bounds, duplicate/overlapping index removal,
write amplification, and per-scope skew. BRIN, fixed-count hash partitioning,
and hot-scope promotion remain measurement-triggered options.

### Cursor Semantics

Commit and outbox cursors must be scoped. A single global Postgres sequence is
useful for debugging, but client sync should not rely on global sequence density
or ordering across unrelated deployments. Live sync uses
`(scope_id, epoch, commit_seq)`. The former epoch-bearing generic outbox-cursor
proposal is superseded: S09-B exposes no consumer cursor, its `outbox_seq` is
scope-lifetime monotonic, and epoch is write provenance rather than claim
eligibility. Any future delivery-progress cursor must be frozen with its first
accepted consumer and is never the canonical live-query cursor.

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

The migration intentionally retains the current Postgres active-subscription
registry and connection leases while DeploymentSyncDO durable SQLite becomes
the hot invalidation owner. Recovery combines:

```text
Postgres registry/lease rebuild
DeploymentSyncDO SQLite cursor/query/dependency state
ConnectionDO websocket attachment restore and idempotent re-registration
client cursor/epoch reconnect and resubscribe
```

Removing the Postgres registry is a post-migration possibility only after these
paths pass eviction, hibernation, reconnect, activation-race, and lost-wake
tests.

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

The key boundary to test is that CMS content can share app row JSON and derived
sidecars, while Payload-only lifecycle state remains in reserved logical
collections (or later justified `fx_payload_*` tables) and cannot be bypassed by
direct `ctx.db` writes. Blocks and arrays are
embedded by default; child-row storage is a future optimization, not the v1
baseline.

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
  fx_app_row_rev/current
  fx_app_edge_current
  fx_app_index_entry_rev/current
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
- exact ordered-key codec and table layout for `fx_app_index_entry_rev/current`
  so declared indexes are efficient without creating app-specific physical
  tables;
- whether PostgreSQL 19 `CREATE PROPERTY GRAPH` generation is enabled only for
  admin/internal tooling at first or also for selected query-planner paths;
- durable server query cache enabled by default or only after measurement;
- whether app graph views should expose one generic `app_entity/app_relation`
  graph or generated label-specific graph views filtered by table/relation id;
- exact `fx_version` representation on Medusa reserved tables;
- whether high-volume commit summaries stay JSONB or split into typed summary
  tables;
- whether a future ID-generation contract retains UUIDv4 or deliberately adopts
  UUIDv7 after Postgres locality benchmarks and a documented timestamp-
  disclosure review. Document ID V1's table-qualified UUID mapping and exact
  16-byte physical projection are already fixed and do not depend on that
  future generator choice.

Changing those physical choices should not change the public API or ownership
rules above.
