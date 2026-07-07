# Flarex Commerce/CMS v1 Schema Cutline

Status: design cutline / implementation guidance

Related architecture note:

- `design-notes/flarex-commerce-cms-sections-blocks.md`

That larger note is a long-term architecture superset. This file is the stricter v1 cutline. It challenges the superset, removes non-essential tables from the first implementation, and defines the smaller schema that should actually be built first.

## Verdict

The architecture direction is coherent, but the full schema in the commerce/CMS sections note is too large for v1.

The core idea is still correct:

```text
Flarex app/CMS data:
  row JSON is authoritative

Commerce/Medusa data:
  commerce/reserved tables are authoritative

Indexes:
  derived sidecars

Relations:
  derived edge sidecars

Blocks/sections:
  embedded in row JSON, with optional derived metadata/index sidecars

Transactions/sync:
  commit log + read sets + outbox + idempotency
```

But the full design currently includes tables for field catalog, relation catalog, edge history, block metadata, Payload lifecycle, and more. Those are useful long-term, but many are not necessary to prove the first implementation.

V1 should build the few primitives that make the platform possible:

```text
rows
indexes
edges
uniqueness
commits
sessions/read sets
outbox
idempotency
```

Everything else should be deferred until the implementation proves it is needed.

## What is not over-engineering

Do not remove these concepts:

```text
logical table ids
commerce resolver
row_current / row_rev
index_entry_current / index_entry_rev
edge_current
unique keys
commit log
read sets
outbox
idempotency
```

These are the real architecture.

Especially `fx_edge_current`: this is not optional if Flarex wants efficient app/CMS/media/commerce references. Without it, the system falls back to JSON scans for questions like:

```text
Which CMS pages use product prod_123?
Which reviews belong to product prod_123?
Which product sets include product prod_123?
Which rows use media file media_123?
```

## What is over-engineered for v1

The following concepts are useful, but should not be mandatory physical v1 tables unless implementation pressure proves otherwise:

```text
fx_field
fx_relation_def
fx_edge_rev
fx_block_index as a dedicated table
fx_payload_global
fx_payload_global_version
fx_payload_document_lock
physical commerce row extension tables
full commerce public graph projections
full dynamic product search sections
```

The main simplification is:

```text
v1 schema catalog:
  fx_table.schema_json + fx_index_def

not:
  fx_table + fx_field + fx_relation_def + many metadata tables
```

## Recommended v1 physical schema

### Catalog

```text
fx_table
fx_index_def
```

`fx_table.schema_json` should contain field, relation, block, CMS, and commerce metadata for v1.

Do not create physical `fx_field` or `fx_relation_def` in the first cut unless the compiler/runtime needs fast SQL-level introspection.

### App/CMS row data

```text
fx_row_current
fx_row_rev
```

`fx_row_current` stores latest Flarex-owned app/CMS rows.

`fx_row_rev` stores internal historical revisions for OCC/sync/history windows.

Do not store Medusa product/order/variant rows in `fx_row_current` unless Flarex later fully owns those physical commerce tables.

### Query/index sidecars

```text
fx_index_entry_current
fx_index_entry_rev
fx_unique_key
```

These power declared indexes, compound indexes, strict query planning, uniqueness, OCC, and live query invalidation.

### Relation sidecars

```text
fx_edge_current
```

V1 should keep current edges only.

A separate `fx_edge_rev` table can be deferred. Edge changes can be represented in commit summaries/outbox events while current edges are recomputed from row JSON at write time.

### Runtime/recovery

```text
fx_commit
fx_invoke_session
fx_invoke_session_reads
fx_invoke_session_writes
fx_outbox
fx_idempotency
```

These are non-negotiable for trusted execution, OCC, retry safety, and post-commit recovery.

### Optional v1 if CMS editor requires it

```text
fx_block_index_current
```

But before adding a dedicated table, try representing block/section type metadata as hidden system indexes inside `fx_index_entry_current`.

## Suggested v1 table list

The v1 cut should look like this:

```text
Required:
  fx_table
  fx_index_def

  fx_row_current
  fx_row_rev

  fx_index_entry_current
  fx_index_entry_rev
  fx_unique_key

  fx_edge_current

  fx_commit
  fx_invoke_session
  fx_invoke_session_reads
  fx_invoke_session_writes
  fx_outbox
  fx_idempotency

Optional:
  fx_block_index_current
```

The v1 cut should not initially include:

```text
fx_field
fx_relation_def
fx_edge_rev
fx_block_index_rev
dedicated Payload physical tables
physical arbitrary commerce extension tables
full Medusa internal edge projection tables
```

## Table-by-table challenge

### `fx_table`: keep

This is necessary.

It registers logical tables such as:

```text
commerce.products
commerce.collections
productReviews
pages
media
users
```

Important: `commerce.products` can be a first-class relation target even if product rows are fetched through a commerce resolver instead of `fx_row_current`.

Suggested v1 shape:

```sql
fx_table (
  deployment_id text not null,
  table_id int not null,
  name text not null,
  kind text not null,
  resolver text not null,
  schema_version bigint not null,
  schema_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (deployment_id, table_id),
  unique (deployment_id, name)
);
```

Example `schema_json` for a review table:

```json
{
  "fields": {
    "product": {
      "kind": "commerce_relation",
      "target": "commerce.products",
      "cardinality": "one",
      "indexed": true,
      "onDelete": "restrict"
    },
    "status": {
      "kind": "enum",
      "values": ["pending", "approved", "rejected"],
      "indexed": true
    },
    "createdAt": {
      "kind": "number",
      "indexed": true
    }
  },
  "relations": [
    {
      "name": "productReviews.product",
      "sourcePath": "product",
      "targetTable": "commerce.products",
      "cardinality": "one",
      "relationKind": "commerce_picker",
      "onDelete": "restrict"
    }
  ]
}
```

### `fx_field`: defer

`fx_field` is a normalized field catalog.

It is useful for:

```text
admin field search
schema diff queries
field-level migrations
field-level analytics
field-level permission indexing
```

But for v1, it duplicates `fx_table.schema_json`.

Recommendation:

```text
v1:
  keep field metadata inside fx_table.schema_json

v2:
  materialize fx_field if schema introspection becomes hot or complex
```

### `fx_index_def`: keep

This is required because index entries need stable index IDs.

Suggested shape:

```sql
fx_index_def (
  deployment_id text not null,
  index_id int not null,
  table_id int not null,
  name text not null,
  fields_json jsonb not null,
  unique_key boolean not null default false,
  state text not null default 'enabled',
  primary key (deployment_id, index_id),
  unique (deployment_id, table_id, name)
);
```

Example:

```text
index_id = 501
name = byProductStatusCreatedAt
table = productReviews
fields = [product, status, createdAt]
```

### `fx_relation_def`: defer

This is conceptually clean, but likely too early as a physical table.

It describes relation metadata such as:

```text
source table
source path
target table
cardinality
relation kind
on-delete behavior
admin exposure
```

For v1, store that metadata in `fx_table.schema_json`.

Recommendation:

```text
v1:
  no physical fx_relation_def
  relation metadata lives in schema_json

v1.5/v2:
  add fx_relation_def if relation introspection becomes hot
```

`fx_edge_current` can exist without `fx_relation_def`. It can store `source_path`, `target_table_id`, `relation_kind`, and optional `relation_id = null` until relation IDs become useful.

### `fx_row_current`: keep

This stores current app/CMS row values.

Example product review:

```json
{
  "product": "prod_123",
  "user": "user_456",
  "rating": 5,
  "body": "Great",
  "status": "approved",
  "createdAt": 1730000000
}
```

Example page:

```json
{
  "title": "Home",
  "slug": "home",
  "sections": [
    {
      "id": "sec_1",
      "sectionType": "featuredProducts",
      "settings": {
        "products": ["prod_1", "prod_2"]
      }
    }
  ]
}
```

Suggested shape:

```sql
fx_row_current (
  deployment_id text not null,
  table_id int not null,
  row_id text not null,
  commit_ts bigint not null,
  schema_version bigint not null,
  data_json jsonb not null,
  data_hash bytea not null,
  deleted boolean not null default false,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  status text,
  primary key (deployment_id, table_id, row_id)
);
```

### `fx_row_rev`: keep, but add retention

This stores historical app/CMS row revisions for OCC and sync windows.

It is not Payload user-visible version history.

Recommendation:

```text
keep fx_row_rev
but define retention / compaction from the beginning
```

Do not keep infinite internal row history by default.

Suggested shape:

```sql
fx_row_rev (
  deployment_id text not null,
  table_id int not null,
  row_id text not null,
  commit_ts bigint not null,
  prev_commit_ts bigint,
  schema_version bigint not null,
  data_json jsonb not null,
  data_hash bytea not null,
  deleted boolean not null default false,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  status text,
  primary key (deployment_id, table_id, row_id, commit_ts)
);
```

### `fx_index_entry_current`: keep

This stores current derived index keys.

It powers:

```text
withIndex queries
compound indexes
strict query planner
Payload indexed fields
commerce/app relation indexes
pagination
```

Suggested shape:

```sql
fx_index_entry_current (
  deployment_id text not null,
  index_id int not null,
  table_id int not null,
  row_id text not null,
  key_prefix bytea not null,
  key_suffix bytea,
  key_sha256 bytea not null,
  locale text,
  commit_ts bigint not null,
  primary key (deployment_id, index_id, key_sha256, row_id)
);
```

### `fx_index_entry_rev`: keep if OCC/index-range reads are v1

If Flarex keeps Convex-like OCC over index ranges in v1, this table is needed.

It supports:

```text
snapshot index reads
OCC index-range conflict detection
live query invalidation
sync/history windows
```

If implementation pressure is high, a fallback is:

```text
fx_index_entry_current
+ table/index freshness versions
+ commit write summaries
```

But the stronger Convex-like design keeps index revision history.

### `fx_edge_current`: keep

This is the generic connection layer.

It stores only relationship pointers, not duplicated target data.

Example edges:

```text
productReviews.review_1.product -> commerce.products.prod_123
pages.home.sections.sec_1.settings.products[0] -> commerce.products.prod_1
productSets.set_1.products[2] -> commerce.products.prod_3
media usage -> media.media_123
```

Suggested shape:

```sql
fx_edge_current (
  deployment_id text not null,
  relation_id int,

  source_table_id int not null,
  source_row_id text not null,
  source_path text not null,

  target_table_id int not null,
  target_row_id text not null,

  relation_kind text not null,
  locale text,
  position int,
  commit_ts bigint not null,

  primary key (
    deployment_id,
    source_table_id,
    source_row_id,
    source_path,
    target_table_id,
    target_row_id
  )
);
```

Recommended indexes:

```sql
create index fx_edge_current_reverse
  on fx_edge_current (
    deployment_id,
    target_table_id,
    target_row_id,
    source_table_id,
    source_path
  );

create index fx_edge_current_forward
  on fx_edge_current (
    deployment_id,
    source_table_id,
    source_row_id,
    source_path,
    position
  );
```

### `fx_edge_rev`: defer

This is useful later, but expensive early.

V1 can use:

```text
fx_edge_current
+ commit/outbox changed edge summaries
+ row revision history
```

Recommendation:

```text
v1:
  no fx_edge_rev unless relation-range historical reads are required

v2:
  add fx_edge_rev for relation-range OCC/sync/history if needed
```

### `fx_block_index`: maybe hidden index instead

Dedicated `fx_block_index` is nice for CMS/admin editor features, but it may be avoidable.

Alternative:

```text
represent block/section type metadata as hidden system indexes in fx_index_entry_current
```

Example hidden index:

```text
pages._byBlockType
  key = [field_path, block_type, row_id, block_id]
```

Recommendation:

```text
v1 default:
  block type metadata as hidden index entries

v1 optional:
  fx_block_index_current if editor queries need it

avoid in v1:
  fx_block_index_rev
```

### `fx_unique_key`: keep

Required for:

```text
users.email
pages.slug
productCmsMeta.product
wishlistItems unique [wishlist, product]
Payload unique fields
localized unique fields
```

Suggested shape:

```sql
fx_unique_key (
  deployment_id text not null,
  constraint_id int not null,
  table_id int not null,
  row_id text not null,
  key_hash bytea not null,
  key_json jsonb not null,
  locale text,
  commit_ts bigint not null,
  primary key (deployment_id, constraint_id, key_hash)
);
```

### `fx_commit`: keep

This is the logical commit timeline.

Suggested shape:

```sql
fx_commit (
  deployment_id text not null,
  commit_ts bigint not null,
  mutation_id text,
  actor_identity text,
  created_at timestamptz not null default now(),
  summary_json jsonb,
  primary key (deployment_id, commit_ts)
);
```

### `fx_invoke_session` / reads / writes: keep, with cleanup

These are needed for trusted executor staging and OCC.

Required properties:

```text
session status
begin timestamp
function path
identity
attempt count
result/error
commit timestamp
TTL/cleanup
```

Do not let session rows grow forever.

### `fx_outbox`: keep

Non-negotiable.

This is how Flarex recovers from:

```text
commit succeeded
but live invalidation/search/webhook/cache refresh failed
```

Production outbox needs:

```text
status
attempts
claimed_by
claimed_until
next_attempt_at
last_error
dead-letter state
```

### `fx_idempotency`: keep

Non-negotiable.

Without idempotency, client retries can double-apply mutations.

Required key shape:

```text
deployment_id
identity/session
function path
client mutation id / idempotency key
```

Stored result:

```text
started/committed/failed
commit_ts
result_json
error_json
```

### Payload-specific physical tables: defer

Instead of creating dedicated physical tables immediately:

```text
fx_payload_version
fx_payload_global
fx_payload_global_version
fx_payload_document_lock
```

use reserved Flarex system/CMS tables over the same row store:

```text
_payload_versions
_payload_globals
_payload_global_versions
_payload_locks
```

These can live in:

```text
fx_row_current
fx_row_rev
fx_index_entry_current
```

Recommendation:

```text
v1:
  Payload lifecycle as reserved CMS/system tables over row store

v2:
  dedicated physical Payload tables only if adapter performance/compatibility requires them
```

## Concrete v1 write example

Developer schema:

```ts
const productReviews = defineTable({
  product: c.product().required().index(),
  user: v.relation.one(users).required().index(),
  rating: v.number().min(1).max(5).index(),
  body: v.string(),
  status: v.enum(["pending", "approved", "rejected"]).index(),
  createdAt: v.number().index(),
})
  .index("byProductStatusCreatedAt", ["product", "status", "createdAt"])
```

Insert:

```json
{
  "product": "prod_123",
  "user": "user_456",
  "rating": 5,
  "body": "Great",
  "status": "approved",
  "createdAt": 1730000000
}
```

V1 writes:

```text
fx_row_current:
  productReviews.review_1 = full review JSON

fx_row_rev:
  review_1 at commit_ts 100

fx_index_entry_current:
  byProductStatusCreatedAt [prod_123, approved, 1730000000, review_1]

fx_index_entry_rev:
  insert current index key at commit_ts 100

fx_edge_current:
  review_1.product -> commerce.products.prod_123
  review_1.user -> users.user_456

fx_unique_key:
  only if schema declares a unique constraint

fx_commit:
  commit_ts 100

fx_outbox:
  notify live-query/search/cache/event workers

fx_idempotency:
  store mutation result keyed by client mutation id
```

No `fx_field`, no `fx_relation_def`, no `fx_edge_rev`, and no dedicated Payload tables are required for this first version.

## Concrete v1 CMS section example

Page row:

```json
{
  "title": "Home",
  "slug": "home",
  "sections": [
    {
      "id": "sec_1",
      "sectionType": "featuredProducts",
      "settings": {
        "heading": "Featured products",
        "products": ["prod_1", "prod_2"]
      }
    }
  ]
}
```

V1 writes:

```text
fx_row_current:
  pages.home = full page JSON

fx_row_rev:
  pages.home at commit_ts 101

fx_index_entry_current:
  pages.bySlug [home]
  pages._byBlockType [sections, featuredProducts, home, sec_1]

fx_edge_current:
  pages.home.sections.sec_1.settings.products[0] -> commerce.products.prod_1
  pages.home.sections.sec_1.settings.products[1] -> commerce.products.prod_2

fx_commit:
  commit_ts 101

fx_outbox:
  invalidate page render/live preview
```

This avoids a physical `fx_block_index` table by using a hidden system index for block type lookup.

## Dynamic product source v1 cut

Manual product lists are v1:

```ts
products: c.products({ max: 12, ordered: true })
```

Collection-based product source can be v1 if commerce product indexes exist:

```ts
source: c.productSource({
  modes: ["collection"],
  sorts: ["newest", "priceAsc", "priceDesc"],
  maxProducts: 24,
})
```

Full dynamic query/search source should be v1.5/v2 unless read-set/search invalidation is ready:

```text
full-text dynamic search sections
best-selling sort
personalized product queries
arbitrary product metafield filters
```

Do not write product edges for every dynamic query result. Store the query definition and record read-set/index dependencies at render/query time.

## Delete and stale-edge v1 policy

V1 should use conservative commerce delete behavior:

```text
Do not hard-delete commerce products by default.
Use soft delete / archive / unpublish.
Before hard delete, check fx_edge_current_reverse.
If references exist, block or warn according to schema policy.
If commerce rows are deleted outside Flarex, edges may become stale.
```

Safe rule:

```text
If commerce rows participate in Flarex relations,
commerce writes/deletes should go through ctx.commerce / trusted commerce adapter.
```

## V1 implementation order

1. `fx_table` with `schema_json`.
2. `fx_row_current` / `fx_row_rev`.
3. `fx_index_def` / `fx_index_entry_current` / `fx_index_entry_rev`.
4. `fx_unique_key`.
5. `fx_edge_current`.
6. Commit/session/read/write staging.
7. Outbox.
8. Idempotency.
9. Hidden block type indexes through `fx_index_entry_current`.
10. Reserved CMS/Payload lifecycle tables as normal row-store tables.
11. Only then consider physical `fx_field`, `fx_relation_def`, `fx_edge_rev`, or dedicated Payload tables.

## Documentation patch recommendation

The existing `flarex-commerce-cms-sections-blocks.md` should remain the superset architecture note.

It should be interpreted as:

```text
long-term design vocabulary
not v1 implementation inventory
```

This cutline should be referenced wherever implementation starts, so future work does not accidentally build every table in the superset note before proving the core.

## Final rule

Do not add a new physical table just because a concept exists.

Add a table only when one of these is true:

```text
It is needed for correctness.
It is needed for query performance.
It is needed for recovery/idempotency.
It removes impossible JSON scans.
It has a clear retention/cleanup plan.
```

For v1, the platform should be boring:

```text
row JSON
index entries
edge entries
unique keys
commits
read sets
outbox
idempotency
```

That is enough to prove the architecture without overbuilding it.
