# Flarex Commerce CMS Sections and Blocks

Status: design note / long-term architecture superset

Authoritative correction: see
[`flarex-db-accepted-design.md`](./flarex-db-accepted-design.md), then
[`flarex-commerce-cms-v1-schema-cutline.md`](./flarex-commerce-cms-v1-schema-cutline.md),
[`flarexdb-payload-relational-adapter.md`](./flarexdb-payload-relational-adapter.md),
and
[`flarexdb-medusa-commerce-adapter.md`](./flarexdb-medusa-commerce-adapter.md)
before building this design. This file intentionally describes broader
architecture vocabulary; it is not the v1 physical schema inventory. Any older
session, snapshot, scope-key, idempotency, Payload-table, Medusa, or sync detail
that conflicts with those documents is superseded.

This note captures the research direction for supporting Payload-style blocks,
Shopify-like commerce CMS section authoring, Flarex app relational schemas,
commerce-aware schema APIs, and the internal relationship/edge layer that
connects Flarex app/CMS rows to commerce/Medusa-reserved logical tables.

The goal is not to build a visual editor in v1. The goal is to define a durable schema, developer API, and storage model that can power a high-quality form-based block/section editor now, while leaving room for a future visual editor.

## 2026-07-22 Theme-composition correction

The storage direction in this note remains unchanged, but the storefront
composition lineage needs to be more precise:

```text
Flarex schema, Payload-compatible CMS lifecycle, and row JSON
  = content, persistence, drafts, versions, relations, and authority

Dawn / Shopify Online Store 2.0-style sections
  = the current section-centric composition vocabulary

Horizon-style theme blocks
  = the proposed reusable, bounded nested composition vocabulary
```

Flarex should therefore keep Payload/Flarex underneath and evolve the authoring
layer from section-owned settings and local blocks toward reusable theme blocks.
This is not a move to Liquid, Shopify theme files, or Shopify runtime
compatibility. It is a change to the logical theme AST, editor contract, and
renderer contract above the same authoritative row and sidecar model.

The target composition hierarchy is:

```text
template
  -> ordered page-level sections
      -> reusable theme blocks
          -> bounded child theme blocks
```

Sections remain important. They own page-level placement, route/resource
context, cache and rendering boundaries, and the allowed root block set. A
theme block owns reusable settings, presentation semantics, allowed children,
and an explicit context requirement. A section must not become an unbounded
generic canvas, and a block must not gain unrestricted database or commerce
query authority.

## Executive summary

Flarex should expose one schema system, not separate document, relational, CMS, and commerce databases.

```text
defineTable(...)
  = the core Flarex table/row primitive

v.object(...), v.array(...), v.json()
  = embedded document-style values

v.relation.one(...), v.relation.many(...)
  = core relation fields backed by edge sidecars

v.blocks(...)
  = embedded block/component content backed by block/index/edge sidecars

.cms(...)
  = optional CMS/Payload exposure and lifecycle metadata

defineThemeBlock(...), defineSection(...), defineTemplate(...), defineRegion(...)
  = higher-level storefront composition primitives compiled onto the same storage model

c.product(), c.products(), c.collection(), c.collections(), etc.
  = commerce-aware aliases over the same relation primitive
```

The primitive database model remains:

```text
typed relational schema catalog
+ authoritative row JSON
+ derived scalar indexes
+ derived relation/upload/commerce edges
+ derived block/section metadata
+ unique keys
+ commit/OCC/sync tables
```

This gives Flarex:

- Convex-like developer ergonomics, declared indexes, function execution, OCC, and live sync.
- Payload-compatible nested content, blocks, groups, relationships, uploads, drafts, versions, and globals.
- Shopify-inspired templates, section boundaries, reusable theme blocks,
  bounded block nesting, presets, and commerce resource pickers.
- App-to-commerce relationships such as product reviews, Q&A, wishlists, bundles, product sets, and CMS featured products.
- A fixed multitenant Postgres physical schema suitable for many apps in one database.

The key rule is:

```text
Separate developer packages.
Same schema compiler.
Same logical schema graph.
Same relation primitive.
Same DB sidecar system.
```

Commerce/CMS APIs are ergonomic layers, not separate storage engines.

## Design goals

1. Keep Flarex schema as the source of truth.
2. Support simple document-style app tables without forcing CMS, commerce, or relational modeling.
3. Support relational app tables using typed `v.relation.one` and `v.relation.many`.
4. Support Payload-compatible CMS collections and fields from the same schema metadata.
5. Support blocks as first-class Flarex fields, not as Payload-only internals.
6. Support commerce CMS authoring patterns inspired by Shopify templates,
   section boundaries, reusable theme blocks, bounded nesting, static blocks,
   subtree presets, and resource pickers.
7. Allow app tables to relate to commerce tables without exposing raw Medusa internals.
8. Keep Postgres authoritative.
9. Keep Durable Objects for sync, freshness, live preview coordination, sessions, actors, and caches, not as the normal authoritative app database.
10. Avoid raw SQL/database handles in user code.
11. Avoid exposing Payload, Medusa, module links, plugin hooks, or raw commerce repositories directly to Flarex developers.

## Non-goals for v1

Do not build these in v1:

- Full visual editor/canvas.
- Click-to-edit overlay in the frontend preview.
- Inline text editing inside the preview iframe.
- Drag/drop directly on rendered frontend components.
- Third-party Shopify app block compatibility.
- Liquid runtime or custom Liquid settings.
- Shopify theme import/export compatibility.
- Arbitrary deep nested block trees.
- Unrestricted generic layout canvases where every block can contain every
  other block.
- Arbitrary executable AI-generated, HTML, JavaScript, or Liquid blocks.
- Arbitrary JSON path querying without declared indexes.
- Table-per-user-model physical DDL as the default Flarex app storage model.
- Physical extension of commerce-owned product rows by arbitrary app fields.
- Full projection of every Medusa internal table/link into Flarex edges.

V1 should be a strong form-based CMS section/block editor with draft preview, commerce pickers, and relation-backed app extensions. It should not be a full Shopify/Webflow-style visual builder.

## Package and import boundaries

The API should be split into packages/namespaces for ergonomics, while still compiling to one schema graph.

Recommended imports:

```ts
import { defineSchema, defineTable, defineBlock, v } from "flarex/server"
import {
  defineThemeBlock,
  defineSection,
  defineTemplate,
  defineRegion,
} from "flarex/cms"
import { c } from "flarex/commerce"
```

### `flarex/server`

Core app/runtime schema primitives:

```ts
defineSchema
defineTable
defineBlock

v.string
v.number
v.boolean
v.enum
v.object
v.array
v.json
v.group
v.richText
v.blocks
v.relation.one
v.relation.many
v.optional
v.id
```

This package should not require commerce or CMS concepts.

### `flarex/cms`

Content/page composition primitives:

```ts
defineThemeBlock
defineSection
defineTemplate
defineRegion
```

`defineThemeBlock` is deliberately distinct from core `defineBlock`.
`defineBlock` describes a Payload-like structured content variant that can be
used in an arbitrary `v.blocks(...)` field. `defineThemeBlock` describes a
renderable storefront component with child, context, preset, and renderer
contracts. Both compile through the same row JSON, edge sidecar, and index
sidecar engine.

### `flarex/commerce`

Commerce table refs and picker aliases:

```ts
c.product()
c.products({ max, ordered })
c.variant()
c.variants({ max, ordered })
c.collection()
c.collections({ max, ordered })
c.category()
c.categories({ max, ordered })

c.tables.products
c.tables.variants
c.tables.collections
c.tables.categories

c.schema(...)
c.extend(...)
```

These are not a second relation system. They are typed aliases over `v.relation.one` / `v.relation.many` plus admin picker metadata.

For example:

```ts
c.product()
```

is conceptually:

```ts
v.relation.one(c.tables.products).cms({
  widget: "productPicker",
})
```

and:

```ts
c.products({ max: 12, ordered: true })
```

is conceptually:

```ts
v.relation.many(c.tables.products, {
  max: 12,
  ordered: true,
}).cms({
  widget: "productMultiPicker",
})
```

The selected ids are persisted in row JSON and mirrored into `fx_edge_*` rows. The helper is sugar; the connection is durable.

## Revised internal schema

This section is the canonical mental model for the internal Flarex schema proposed by this note.

The important distinction:

```text
Flarex app/CMS rows
  source of truth = fx_row_current / fx_row_rev

Commerce/Medusa-reserved rows
  source of truth = reserved commerce/Medusa tables or a trusted commerce adapter

fx_edge_current / fx_edge_rev
  source of truth = no, derived relationship index / dependency graph

fx_relation_def
  source of truth for relation metadata, not row values
```

Do not copy Medusa product/order/variant rows into `fx_row_current` just to
relate to them. Register allowed commerce entities as typed logical relation
targets and derive app/CMS reference edges that point at them. Medusa's own
module links remain authoritative reserved commerce link entities; this picker
projection does not replace or expose them.

### Table group overview

| Table | Purpose | Stores full app data? | Source of truth? |
| --- | --- | ---: | ---: |
| `fx_table` | Logical table registry for app, CMS, media, commerce, system tables | No | Yes for schema catalog |
| `fx_field` | Field/path metadata for logical tables | No | Yes for field catalog |
| `fx_index_def` | Declared scalar/compound/search-adjacent indexes | No | Yes for index catalog |
| `fx_relation_def` | Declared relation metadata | No | Yes for relation catalog |
| `fx_row_current` | Latest app/CMS row values | Yes, for app/CMS rows | Yes for app/CMS current state |
| `fx_row_rev` | Historical app/CMS row revisions | Yes, historical | Yes for internal history/OCC window |
| `fx_index_entry_current` | Current derived scalar/compound index entries | No | Derived sidecar |
| `fx_index_entry_rev` | Historical derived index entries | No | Derived sidecar for OCC/sync/history |
| `fx_edge_current` | Current derived relation/upload/picker edges | No | Derived sidecar |
| `fx_edge_rev` | Historical derived relation/upload/picker edges | No | Derived sidecar for OCC/sync/history |
| `fx_block_index` | Current block/section path/type/position metadata | No | Derived sidecar |
| `fx_unique_key` | Generic uniqueness enforcement | No full row | Yes for uniqueness claim |
| `fx_commit` | Commit timeline | No | Yes for commit log |
| `fx_invoke_session` | Query/mutation/action execution sessions | No | Yes for runtime bookkeeping |
| `fx_read_set` / invoke reads | OCC and live-query dependencies | No | Yes for runtime dependency tracking |
| `fx_outbox` | Durable post-commit events/deliveries | No | Yes for recovery pipeline |
| `fx_idempotency` | Mutation idempotency/result replay | No | Yes for retry safety |
| Payload-specific tables | Payload-visible versions/globals/locks | Payload/CMS-specific | Yes for CMS lifecycle data |

### `fx_table`

`fx_table` is the logical table registry.

It must include normal Flarex app tables, CMS collections, media collections, globals/singletons, exposed commerce entities, and any system table that participates in schema, query, or relation planning.

Example rows:

```text
table_id: 10
name: commerce.products
kind: commerce_reserved
resolver: commerce

table_id: 11
name: commerce.collections
kind: commerce_reserved
resolver: commerce

table_id: 20
name: productReviews
kind: app
resolver: fx_row

table_id: 30
name: pages
kind: cms_collection
resolver: fx_row

table_id: 40
name: media
kind: cms_collection
resolver: fx_row
```

`resolver` decides where the row is fetched from:

```text
fx_row
  fetch from fx_row_current / fx_row_rev

commerce
  fetch through trusted commerce adapter / reserved tables

system
  fetch through system resolver
```

The key point: `commerce.products` can be a first-class relation target even if products are not stored in `fx_row_current`.

Suggested shape:

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

### `fx_field`

`fx_field` stores normalized field/path metadata from the schema compiler.

It answers:

```text
What fields exist on this logical table?
Which paths are relations?
Which paths are localized?
Which paths are indexed?
Which paths are blocks/sections/groups?
Which paths are CMS exposed?
```

Example rows:

```text
productReviews.product
  kind = commerce_relation
  target = commerce.products
  indexed = true

pages.sections
  kind = blocks_or_sections
  indexed_block_types = true

pages.sections.*.settings.products
  kind = commerce_relation_many
  target = commerce.products
  ordered = true
  max = 12
```

Suggested shape:

```sql
fx_field (
  deployment_id text not null,
  table_id int not null,
  field_id int not null,
  path text not null,
  kind text not null,
  indexed boolean not null default false,
  unique_key boolean not null default false,
  localized boolean not null default false,
  cms_json jsonb,
  relation_json jsonb,
  block_json jsonb,
  primary key (deployment_id, table_id, field_id),
  unique (deployment_id, table_id, path)
);
```

### `fx_index_def`

`fx_index_def` stores declared indexes. It is the schema-level definition; it is not the index entries themselves.

Example:

```ts
const productReviews = defineTable({
  product: c.product().required().index(),
  status: v.enum(["pending", "approved", "rejected"]).index(),
  createdAt: v.number().index(),
})
  .index("byProductStatusCreatedAt", ["product", "status", "createdAt"])
```

Produces an index definition like:

```text
index_id = 501
name = byProductStatusCreatedAt
table = productReviews
fields = [product, status, createdAt]
```

The actual keys for each review row live in `fx_index_entry_current` and `fx_index_entry_rev`.

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

### `fx_relation_def`

`fx_relation_def` is the missing schema-level companion to `fx_edge_current`.

It describes what a relation means. `fx_edge_current` stores actual row-to-row edges.

Example relation definitions:

```text
relation_id = 700
name = productReviews.product
source = productReviews
source_path = product
target = commerce.products
cardinality = one
relation_kind = commerce_picker
on_delete = restrict

relation_id = 701
name = pages.sections.settings.products
source = pages
source_path = sections.*.settings.products
target = commerce.products
cardinality = many_ordered
relation_kind = commerce_picker
on_delete = soft_warn
```

Suggested shape:

```sql
fx_relation_def (
  deployment_id text not null,
  relation_id int not null,
  name text not null,

  source_table_id int not null,
  source_path text not null,
  target_table_id int not null,

  cardinality text not null,
  -- one | many | many_ordered | polymorphic_one | polymorphic_many | reverse_many

  relation_kind text not null,
  -- relation | upload | commerce_picker | cms_picker | block_ref | internal_commerce

  reverse_name text,
  indexed boolean not null default true,
  exposed_to_admin boolean not null default true,

  on_delete text not null default 'preserve',
  -- restrict | set_null | detach | cascade | preserve | soft_warn

  metadata_json jsonb not null default '{}',

  primary key (deployment_id, relation_id),
  unique (deployment_id, source_table_id, source_path, target_table_id)
);
```

Delete policy examples:

```text
product review -> product
  on_delete = restrict

CMS featured product list -> product
  on_delete = soft_warn or detach later

order line historical product reference
  on_delete = preserve

image upload field -> media
  on_delete = restrict or soft_warn
```

### `fx_row_current`

`fx_row_current` stores the latest row value for Flarex-owned app/CMS rows.

It should not normally store Medusa product/order/variant rows unless Flarex later fully owns those physical tables.

Example product review row:

```json
{
  "product": "prod_123",
  "user": "user_456",
  "rating": 5,
  "title": "Great product",
  "body": "Loved it",
  "status": "approved",
  "createdAt": 1730000000
}
```

Example page row:

```json
{
  "title": "Home",
  "slug": "home",
  "sections": [
    {
      "id": "sec_grid_1",
      "sectionType": "featuredProducts",
      "settings": {
        "heading": "Featured products",
        "products": ["prod_1", "prod_2"],
        "showPrices": true
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

  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  status text,

  data_json jsonb not null,
  data_hash bytea not null,
  deleted boolean not null default false,

  primary key (deployment_id, table_id, row_id)
);
```

### `fx_row_rev`

`fx_row_rev` stores historical row revisions for internal OCC/sync/history windows.

It is not the same as Payload user-visible versions.

Payload versions answer:

```text
What versions can an editor restore?
```

`fx_row_rev` answers:

```text
What did the database row look like at commit timestamp T?
Can this mutation commit without conflicting with reads?
What changed for sync/invalidation?
```

Suggested shape:

```sql
fx_row_rev (
  deployment_id text not null,
  table_id int not null,
  row_id text not null,
  commit_ts bigint not null,
  prev_commit_ts bigint,
  schema_version bigint not null,

  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  status text,

  data_json jsonb not null,
  data_hash bytea not null,
  deleted boolean not null default false,

  primary key (deployment_id, table_id, row_id, commit_ts)
);
```

### `fx_index_entry_current`

`fx_index_entry_current` stores current derived scalar/compound index keys.

Example:

```ts
.index("byProductStatusCreatedAt", ["product", "status", "createdAt"])
```

For review row `review_1`, Flarex writes an index entry like:

```text
index = byProductStatusCreatedAt
key = [prod_123, approved, 1730000000, review_1]
row = review_1
```

This powers:

```ts
ctx.db.query("productReviews")
  .withIndex("byProductStatusCreatedAt", q =>
    q.eq("product", productId)
     .eq("status", "approved")
  )
  .order("desc")
  .take(20)
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

### `fx_index_entry_rev`

`fx_index_entry_rev` stores historical index-entry changes.

It is needed for:

```text
snapshot index reads
OCC index-range conflict detection
live query invalidation
sync/history windows
```

If a product review changes from `pending` to `approved`, the old index key is tombstoned and the new index key is inserted in revision history.

Suggested shape:

```sql
fx_index_entry_rev (
  deployment_id text not null,
  index_id int not null,
  table_id int not null,
  row_id text not null,
  commit_ts bigint not null,

  key_prefix bytea not null,
  key_suffix bytea,
  key_sha256 bytea not null,
  locale text,
  deleted boolean not null default false,

  primary key (deployment_id, index_id, key_sha256, row_id, commit_ts)
);
```

### `fx_edge_current`

`fx_edge_current` stores current derived references between logical rows.

It is a relationship index, not a duplicate data table.

It can connect:

```text
app row -> app row
app row -> commerce product
app row -> CMS page
CMS section -> commerce product
CMS section -> collection
CMS block upload -> media
media usage -> CMS/app row
```

Example product review edge:

```text
source = productReviews.review_1.product
target = commerce.products.prod_123
relation_kind = commerce_picker
```

Example CMS section edges:

```text
source = pages.home.sections.sec_grid_1.settings.products[0]
target = commerce.products.prod_1
position = 0

source = pages.home.sections.sec_grid_1.settings.products[1]
target = commerce.products.prod_2
position = 1
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

Why it exists:

```text
Which pages use product prod_123?
Which reviews belong to product prod_123?
Which product sets include prod_123?
Which CMS sections reference collection col_999?
Which rows use media file media_123?
```

Without this table, those questions become JSON scans.

### `fx_edge_rev`

`fx_edge_rev` stores historical edge changes.

It is needed for:

```text
OCC checks over relation reads
live query invalidation when references change
sync history
rebuilding current edges
```

Example: editor removes `prod_2` from a featured-products section and adds `prod_3`.

`fx_edge_rev` records:

```text
tombstone edge page.home -> prod_2
insert edge page.home -> prod_3
```

Suggested shape is the same as `fx_edge_current`, plus:

```sql
commit_ts bigint not null,
deleted boolean not null default false
```

### `fx_block_index`

`fx_block_index` stores derived block/section metadata.

It does not store the block content. The content stays embedded in `fx_row_current.data_json`.

Example page JSON:

```json
{
  "sections": [
    {
      "id": "sec_hero_1",
      "sectionType": "hero",
      "settings": { "headline": "Build faster" }
    },
    {
      "id": "sec_grid_1",
      "sectionType": "featuredProducts",
      "settings": { "products": ["prod_1"] }
    }
  ]
}
```

Derived block index entries:

```text
page home has section hero at sections[0]
page home has section featuredProducts at sections[1]
```

Suggested shape:

```sql
fx_block_index (
  deployment_id text not null,
  table_id int not null,
  row_id text not null,

  field_path text not null,
  block_id text not null,
  block_type text not null,
  parent_block_id text,
  position int not null,
  locale text,
  commit_ts bigint not null,

  primary key (
    deployment_id,
    table_id,
    row_id,
    field_path,
    block_id
  )
);
```

Use cases:

```text
Find pages with a hero section.
Find pages using featuredProducts sections.
Support admin block lists/reordering.
Prepare for future visual-editor block selection.
Invalidate pages with certain block types if block renderer changes.
```

### `fx_unique_key`

`fx_unique_key` enforces uniqueness without creating per-app physical unique indexes.

Examples:

```text
users.email
pages.slug
productCmsMeta.product
wishlistItems unique [wishlist, product]
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

### `fx_commit`

`fx_commit` is the logical commit timeline.

It records that a trusted executor commit happened and ties together row revisions, index revisions, edge revisions, outbox messages, and sync invalidation.

Minimum fields:

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

### `fx_invoke_session` and read/write staging tables

These tables track query/mutation/action execution sessions.

They are used for:

```text
recording begin timestamp
recording read sets
staging writes
retrying OCC conflicts
recording errors/results
```

The user-facing function does not get a raw database transaction. It calls `ctx.db`; the trusted executor records reads/writes and commits through Flarex.

### `fx_read_set` / invoke session reads

Read-set tables record what a query/mutation read:

```text
row id
logical table scan
index range
edge range
block type range
search dependency later
```

This powers both:

```text
OCC conflict detection for mutations
live-query invalidation for subscriptions/previews
```

Example read set for approved product reviews:

```text
read index range:
  productReviews.byProductStatusCreatedAt
  product = prod_123
  status = approved
```

If a new approved review for `prod_123` commits, the live query can be invalidated.

### `fx_outbox`

`fx_outbox` stores durable post-commit work.

Examples:

```text
notify live-query invalidator
update search index
publish commerce/CMS event
refresh cached page render
send webhook
```

For production this should include:

```text
status
attempts
claimed_by
claimed_until
next_attempt_at
last_error
dead-letter state
```

### `fx_idempotency`

`fx_idempotency` prevents duplicate mutation application when a client retries after a timeout/network error.

It should key by:

```text
deployment_id
identity/user/session
function path
client mutation id / idempotency key
```

It stores:

```text
started/committed/failed status
commit_ts
result_json or error_json
```

If the same mutation is retried after commit, Flarex replays the result instead of applying it again.

### Payload-specific tables

Payload-visible lifecycle data should not be confused with internal `fx_row_rev` history.

Recommended optional tables:

```text
fx_payload_version
  user-visible collection document versions/drafts

fx_payload_global
  global/singleton values or pointers

fx_payload_global_version
  global version history

fx_payload_document_lock
  admin editing locks later
```

## Concrete end-to-end examples

### Example A: app product reviews referencing commerce products

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

Logical schema:

```text
fx_table:
  commerce.products -> commerce resolver
  productReviews -> fx_row resolver

fx_relation_def:
  productReviews.product -> commerce.products

fx_index_def:
  productReviews.byProductStatusCreatedAt(product, status, createdAt)
```

When inserting review `review_1`:

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

Flarex writes:

```text
fx_row_current:
  productReviews.review_1 = full review JSON

fx_row_rev:
  revision of review_1 at commit_ts 100

fx_index_entry_current:
  byProductStatusCreatedAt [prod_123, approved, 1730000000, review_1]

fx_edge_current:
  productReviews.review_1.product -> commerce.products.prod_123
  productReviews.review_1.user -> users.user_456

fx_commit:
  commit_ts 100

fx_outbox:
  invalidate product review queries / notify sync
```

Query:

```ts
ctx.db.query("productReviews")
  .withIndex("byProductStatusCreatedAt", q =>
    q.eq("product", "prod_123")
     .eq("status", "approved")
  )
  .order("desc")
  .take(20)
```

Reverse lookup:

```text
Which app/CMS rows reference prod_123?
  query fx_edge_current_reverse where target = commerce.products.prod_123
```

### Example B: CMS featured-products section

Developer schema:

```ts
const FeaturedProducts = defineSection({
  slug: "featuredProducts",
  label: "Featured products",
  category: "Commerce",

  settings: {
    heading: v.string(),
    products: c.products({ max: 12, ordered: true }),
    showPrices: v.boolean().default(true),
  },
})
```

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
        "products": ["prod_1", "prod_2"],
        "showPrices": true
      }
    }
  ]
}
```

Flarex writes:

```text
fx_row_current:
  pages.home = full page JSON

fx_block_index:
  pages.home sections sec_1 featuredProducts position=0

fx_edge_current:
  pages.home.sections.sec_1.settings.products[0] -> commerce.products.prod_1
  pages.home.sections.sec_1.settings.products[1] -> commerce.products.prod_2

fx_index_entry_current:
  pages.bySlug [home]
```

Forward relationship:

```text
page section -> product
  durable embedded value + durable edge sidecar
```

Reverse relationship:

```text
product -> pages/sections using it
  virtual query over fx_edge_current_reverse
```

### Example C: CMS dynamic product source

Manual product lists are stored as selected product ids. Dynamic product sources are different: they store a query definition.

Developer schema:

```ts
const ProductGrid = defineSection({
  slug: "productGrid",
  settings: {
    heading: v.string(),
    source: c.productSource({
      modes: ["manual", "collection", "query"],
      filters: ["status", "productType", "vendor", "tags", "inStock"],
      sorts: ["newest", "priceAsc", "priceDesc"],
      maxProducts: 24,
    }),
  },
})
```

Stored section value:

```json
{
  "id": "sec_grid_1",
  "sectionType": "productGrid",
  "settings": {
    "heading": "Summer collection",
    "source": {
      "type": "collection",
      "collection": "col_summer",
      "sort": "newest",
      "limit": 8
    }
  }
}
```

Edges:

```text
pages.home.sections.sec_grid_1.settings.source.collection
  -> commerce.collections.col_summer
```

Do not write permanent edges to every matching product. The matching products are dynamic query results.

At render time:

```text
1. Read page row.
2. Compile productSource to commerce product query.
3. Query commerce product index/search source.
4. Record read set over the product index/search dependency.
5. Return resolved products.
```

If the query result changes because product status/stock/price changes, invalidation must come from read-set/index dependency tracking, not static product edges.

### Example D: product set with bounded many products

Developer schema:

```ts
const productSets = defineTable({
  title: v.string(),
  products: c.products({ max: 24, ordered: true }),
  createdAt: v.number().index(),
})
```

Stored row:

```json
{
  "title": "Summer picks",
  "products": ["prod_1", "prod_2", "prod_3"]
}
```

Edges:

```text
productSets.set_1.products[0] -> commerce.products.prod_1
productSets.set_1.products[1] -> commerce.products.prod_2
productSets.set_1.products[2] -> commerce.products.prod_3
```

This is good for small curated lists. Do not use this for unbounded/high-write many-to-many relationships.

### Example E: wishlist join table

Developer schema:

```ts
const wishlists = defineTable({
  user: v.relation.one(users).required().index(),
  name: v.string(),
  createdAt: v.number().index(),
})
  .index("byUserCreatedAt", ["user", "createdAt"])

const wishlistItems = defineTable({
  wishlist: v.relation.one(wishlists).required().index(),
  product: c.product().required().index(),
  addedAt: v.number().index(),
  note: v.optional(v.string()),
})
  .unique(["wishlist", "product"])
  .index("byWishlistAddedAt", ["wishlist", "addedAt"])
  .index("byProductAddedAt", ["product", "addedAt"])
```

Writes:

```text
fx_row_current:
  wishlistItems.item_1 = { wishlist, product, addedAt, note }

fx_unique_key:
  unique [wishlist, product]

fx_index_entry_current:
  byWishlistAddedAt [wishlist_1, addedAt, item_1]
  byProductAddedAt [prod_123, addedAt, item_1]

fx_edge_current:
  wishlistItems.item_1.wishlist -> wishlists.wishlist_1
  wishlistItems.item_1.product -> commerce.products.prod_123
```

Use join tables when the relationship itself has data such as `quantity`, `position`, `note`, `role`, `status`, `createdAt`, price, or workflow state.

### Example F: product extension metadata

Developer schema:

```ts
const productCmsMeta = defineTable({
  product: c.product().unique(),
  seoTitle: v.optional(v.string()),
  seoDescription: v.optional(v.string()),
  merchPriority: v.optional(v.number()).index(),
})
```

This is preferred in v1 over physically extending commerce product rows.

Writes:

```text
fx_row_current:
  productCmsMeta.meta_1 = extension data

fx_unique_key:
  productCmsMeta.product unique prod_123

fx_edge_current:
  productCmsMeta.meta_1.product -> commerce.products.prod_123
```

The commerce product row remains owned by commerce/Medusa. The extension data is owned by Flarex app/CMS.

## Delete and stale-edge behavior

Edges only stay correct if writes/deletes go through Flarex-controlled APIs or a reliable projection process.

Safe rule:

```text
If commerce data participates in Flarex relations,
commerce writes/deletes should go through ctx.commerce / trusted commerce adapter.
```

When deleting or archiving a commerce product:

```text
1. Check fx_edge_current_reverse for references to commerce.products.prod_123.
2. Apply relation delete policies from fx_relation_def.
3. Prefer soft delete/archive/unpublish for commerce products.
4. Allow hard delete only when no blocking references exist.
5. Write commit/outbox invalidation.
```

If commerce rows are deleted outside Flarex:

```text
fx_edge_current may become stale unless there is CDC, an outbox integration, triggers, or a repair/rebuild job.
```

V1 recommendation:

```text
Do not hard-delete commerce products by default.
Use soft delete/archive.
Keep explicit app/CMS edges accurate.
Do not mirror every Medusa internal relationship.
Add stale-edge repair later as safety net.
```

## Relationship modeling rules

Use these defaults.

```text
Unbounded one-to-many:
  store the relation on the many/child side

Bounded curated many:
  store an ordered relation array on the parent using v.relation.many / c.products

Many-to-many or relation with metadata:
  use an explicit join table

Reverse relationships:
  virtual by default, backed by edge/index lookup

Physical extension of commerce-owned rows:
  avoid in v1; use app extension tables keyed by c.product().unique()
```

### Many-to-one and virtual one-to-many

`productReviews.product` is a many-to-one relation:

```text
many reviews -> one product
```

The product-to-reviews direction is one-to-many, but should normally not be stored as an array on the product row.

```ts
const reviews = await ctx.db
  .query("productReviews")
  .withIndex("byProductStatusCreatedAt", q =>
    q.eq("product", productId)
     .eq("status", "approved")
  )
  .order("desc")
  .take(20)
```

The product row does not need:

```json
{
  "reviews": ["review_1", "review_2"]
}
```

A generated helper can expose the reverse side:

```ts
c.extend("products", {
  relations: {
    reviews: v.reverseMany(productReviews, {
      via: "product",
      index: "byProductStatusCreatedAt",
    }),
  },
})
```

This adds generated helper/admin metadata, but does not mutate the underlying product row.

### One app row with many products

Use `c.products()` for bounded curated lists.

```ts
const productSets = defineTable({
  title: v.string(),
  products: c.products({
    max: 24,
    ordered: true,
  }),
  createdAt: v.number().index(),
})
```

Stored row JSON:

```json
{
  "title": "Summer picks",
  "products": ["prod_1", "prod_2", "prod_3"]
}
```

Derived edges:

```text
productSets.set_1.products[0] -> commerce.products.prod_1
productSets.set_1.products[1] -> commerce.products.prod_2
productSets.set_1.products[2] -> commerce.products.prod_3
```

This is good for:

```text
featured products
manual product carousel
bundle without per-item metadata
recommended products
lookbook products
section settings
small curated lists
```

It is not good for:

```text
millions of reviews
large wishlists
high-write cart items
large order line item history
large many-to-many graphs
```

### Explicit join table for many-to-many

Use a join table when the relationship has metadata or can grow unbounded.

Wishlist example:

```ts
const wishlists = defineTable({
  user: v.relation.one(users).required().index(),
  name: v.string(),
  createdAt: v.number().index(),
})
  .index("byUserCreatedAt", ["user", "createdAt"])

const wishlistItems = defineTable({
  wishlist: v.relation.one(wishlists).required().index(),
  product: c.product().required().index(),

  addedAt: v.number().index(),
  note: v.optional(v.string()),
})
  .unique(["wishlist", "product"])
  .index("byWishlistAddedAt", ["wishlist", "addedAt"])
  .index("byProductAddedAt", ["product", "addedAt"])
```

Bundle with metadata:

```ts
const productBundleItems = defineTable({
  bundleProduct: c.product().required().index(),
  childProduct: c.product().required().index(),

  quantity: v.number().default(1),
  position: v.number().index(),
  discountPercent: v.optional(v.number()),
})
  .unique(["bundleProduct", "childProduct"])
  .index("byBundlePosition", ["bundleProduct", "position"])
```

Do not use `c.products()` when each related product needs quantity, role, price, discount, position, note, status, createdAt, or workflow state. Use a join table.

### Product extension table

For v1, prefer app extension tables over physically extending commerce rows.

```ts
const productCmsMeta = defineTable({
  product: c.product().unique(),
  seoTitle: v.optional(v.string()),
  seoDescription: v.optional(v.string()),
  merchPriority: v.optional(v.number()).index(),
})
```

Avoid this in v1:

```ts
c.extend("products", {
  fields: {
    seoOverride: v.optional(v.string()),
    merchPriority: v.optional(v.number()),
  },
})
```

Physical commerce row extension becomes complicated if commerce is backed by Medusa-reserved relational tables. Extension tables keep the commerce core stable.

## Block and section storage shape

A simple section with all content in `settings` remains a valid compatibility
shape and is useful when the section is deliberately indivisible. That is the
current Dawn-like form:

```json
{
  "title": "Home",
  "slug": "home",
  "sections": [
    {
      "id": "sec_hero_1",
      "sectionType": "hero",
      "settings": {
        "variant": "split",
        "headline": "Build faster",
        "image": "media_123",
        "cta": {
          "label": "Start now",
          "href": "/start",
          "variant": "primary"
        }
      }
    },
    {
      "id": "sec_grid_1",
      "sectionType": "featuredCollection",
      "settings": {
        "heading": "Summer collection",
        "collection": "col_999",
        "products": ["prod_1", "prod_2"],
        "limit": 8
      }
    }
  ]
}
```

The proposed reusable-theme-block shape keeps the section as the page-level
boundary but moves composable presentation content into stable child block
instances:

```json
{
  "title": "Home",
  "slug": "home",
  "sections": [
    {
      "id": "sec_hero_1",
      "sectionType": "hero",
      "definitionVersion": 1,
      "settings": {
        "height": "medium",
        "colorScheme": "brand"
      },
      "blocks": [
        {
          "id": "group_1",
          "blockType": "group",
          "definitionVersion": 1,
          "settings": {
            "direction": "column",
            "gap": 16
          },
          "blocks": [
            {
              "id": "heading_1",
              "blockType": "text",
              "definitionVersion": 2,
              "settings": {
                "text": "Build faster",
                "style": "heading-xl"
              },
              "blocks": []
            },
            {
              "id": "button_1",
              "blockType": "button",
              "definitionVersion": 1,
              "settings": {
                "label": "Start now",
                "href": "/start",
                "variant": "primary"
              },
              "blocks": []
            }
          ]
        },
        {
          "id": "image_1",
          "blockType": "image",
          "definitionVersion": 1,
          "settings": {
            "image": "media_123"
          },
          "blocks": []
        }
      ]
    }
  ]
}
```

The canonical instance contract is:

```text
section instance
  stable id
  section type
  definition version
  section-owned settings
  ordered root blocks

theme-block instance
  stable id
  block type
  definition version
  block-owned settings
  ordered child blocks
```

Stable ids express identity; array order expresses presentation order. Moving a
block must not allocate a new id. Definition versions belong to definitions
and instances so a theme package can migrate stored settings and child shapes
without treating every old document as current-definition data. They are
distinct from the deployment's Flarex schema-version identity.

Derived sidecars for the proposed shape use id-addressed logical occurrence
paths rather than treating array positions as block identity:

```text
fx_block_index
  page:home sections sec_hero_1 hero position=0
  page:home sec_hero_1/group_1 group parent=sec_hero_1 position=0
  page:home sec_hero_1/group_1/heading_1 text parent=group_1 position=0
  page:home sec_hero_1/group_1/button_1 button parent=group_1 position=1
  page:home sec_hero_1/image_1 image parent=sec_hero_1 position=1

fx_edge_current
  page:home sec_hero_1/image_1.settings.image -> media.media_123

fx_index_entry_current
  slug = home
  status/publishedAt = ...
```

The physical row may still use ordinary nested arrays. The compiler derives the
stable logical occurrence path from section and block ids, validates
document-wide instance-id uniqueness, rejects cycles and excessive depth, and
records position separately.
This preserves Payload-like nested authoring while keeping Flarex relationally
queryable and syncable. It does not require a physical table per block or a
normalized block tree in v1.

## Are section-setting relations real or virtual?

For this section setting:

```ts
collection: c.collection()
products: c.products({ max: 12 })
```

there are three layers.

### API layer

`c.collection()` and `c.products()` are high-level picker aliases over the same relation primitive.

### Storage layer

The selected ids are real persisted data inside the page/section row JSON:

```json
{
  "collection": "col_999",
  "products": ["prod_1", "prod_2"]
}
```

Flarex also writes durable edge sidecars:

```text
page_home.sections.sec_grid_1.settings.collection -> commerce.collections.col_999
page_home.sections.sec_grid_1.settings.products[0] -> commerce.products.prod_1
page_home.sections.sec_grid_1.settings.products[1] -> commerce.products.prod_2
```

So the forward relationship from the page section to the product/collection is durable and relationally queryable.

### Reverse layer

The reverse relationship is virtual:

```text
product prod_1 -> pages/sections using it
collection col_999 -> pages/sections using it
```

This is answered through `fx_edge_current_reverse`, not by storing back-references on the product/collection row.

This distinction is important:

```text
Forward relation inside section setting:
  durable embedded value + durable edge sidecar

Reverse relation from commerce row to pages/sections:
  virtual query over edge sidecars
```

Section-setting edges are required because Flarex must answer:

```text
Which pages reference product prod_123?
Which live queries/render caches should update if prod_123 changes?
Can this editor access the selected product?
Can we prevent or warn on deleting a product used on a page?
Can admin show "used by"?
Can the frontend prefetch all products used by a page?
```

Without edge sidecars, those become JSON scans.

## Payload mapping

Flarex should generate Payload-compatible configuration from Flarex schema metadata where `.cms(...)` is used.

| Flarex concept | Payload concept | Flarex storage |
| --- | --- | --- |
| `defineTable(...).cms({ collection })` | Collection config | `fx_table` + `fx_row_*` |
| `defineTable(...).cms({ global })` | Global config | singleton/global row + optional global table |
| `v.string`, `v.number`, `v.boolean`, etc. | scalar fields | row JSON + optional index entries |
| `v.object` / `v.group` | group fields | nested row JSON |
| `v.array` | array fields | embedded row JSON |
| `v.blocks` | blocks field | embedded block array + `fx_block_index` |
| `v.relation.one/many` | relationship field | row JSON + `fx_edge_*` |
| `v.upload(media)` | upload field | media relation + `fx_edge_*` |
| `c.product`, `c.products`, `c.collection`, etc. | product/collection picker fields | relation to logical commerce tables + `fx_edge_*` |
| `v.localized(...)` | localized field | locale-keyed JSON + locale-aware indexes/edges |
| `.unique()` | unique field/index | `fx_unique_key` |
| `.index(...)` | indexed field/compound index | `fx_index_entry_*` |
| drafts/versions | Payload drafts/versions | Payload-visible version rows, separate from internal row revisions |

Payload is not the owner of the physical database. Payload is a CMS/admin/lifecycle harness generated from or adapted to Flarex schema.

## Shopify-inspired commerce CMS model

Flarex should borrow Shopify's authoring concepts, not Shopify's theme engine.

### Dawn lineage and current model

The original API examples in this note are closest to Dawn and Shopify Online
Store 2.0. The section is the primary reusable unit; it owns most settings and
normally owns the block types that can appear inside it. JSON page data then
stores ordered section instances, section settings, local block instances, and
their order.

That model remains valid for intentionally cohesive sections such as a cart
drawer, search results, or a specialized product gallery. It should no longer
be the only composition model. If every hero, banner, and content section owns
separate heading, text, image, button, alignment, and spacing fields, Flarex
duplicates schemas, renderers, migrations, and editor behavior.

### Horizon lineage and proposed model

Horizon keeps sections but makes reusable theme blocks first-class. A theme
block is registered independently, can be accepted by multiple sections or
parent blocks, and may accept bounded child blocks. Static blocks preserve
required structure, while presets can instantiate a configured subtree rather
than only a flat settings object.

Flarex should adopt those composition semantics with its own contracts:

```text
template
  orders and constrains sections for a route context

section
  owns page placement, route/resource context, rendering boundary,
  section settings, static structure, and allowed root block types

theme block
  owns reusable presentation settings, renderer identity,
  allowed child types, context requirements, and schema migrations

content block
  remains a Payload-like structured data variant for v.blocks(...)
  and is not automatically a storefront theme component
```

The initial maximum theme-block depth is three levels below the section root.
That is a Flarex product and write-amplification limit, not a copy of Shopify's
platform limit. A definition may choose a shallower limit or disallow children.

Parent-child compatibility is explicit. `accepts: "*"` and unconstrained
generic nesting are rejected for v1. Blocks should declare concrete allowed
children or a named capability such as `content`, `media`, or `commerce`, and
the compiler resolves that capability to a closed set in the deployed theme
manifest.

Static blocks have stable definition-owned ids. Editors may change their
settings and may hide them only when the definition permits it, but cannot
delete, duplicate, or reorder them outside their declared slot. Dynamic blocks
have document-owned stable ids and follow the parent's add/remove/reorder
policy.

Presets are immutable schema metadata that create new instances. A preset may
provide section settings plus a complete bounded child subtree. Applying a
preset never makes the resulting document depend on the preset by reference;
the editor receives normal owned block instances with fresh dynamic ids.

Theme definitions must be versioned. Changing accepted children, required
settings, static ids, or renderer semantics requires either a compatible
defaulting rule or an explicit migration from the stored definition version.
Theme deployment must reject a manifest that cannot decode or migrate
supported stored instances.

### Rendering and authority boundary

Theme blocks are presentation composition, not arbitrary query programs.
Sections obtain a typed route/resource context such as `page`, `product`, or
`collection`. Child blocks may request a declared facet of that context. They
may render stored relations already selected in their settings, but they do not
receive unrestricted `ctx.db` or `ctx.commerce` access.

Dynamic product sources remain section or service-owned operations with
declared indexes, read dependencies, limits, and invalidation policy. A generic
layout block cannot smuggle in a new database query merely because it contains
a commerce child.

The storefront renderer should remain server-first. Client JavaScript provides
progressive enhancement for interactions and preview, not the sole path for
product discovery, price formatting, navigation, or purchase-critical markup.

Borrow:

```text
templates
regions / section groups
sections
reusable theme blocks
bounded nested theme blocks
explicit allowed-child contracts
static blocks and slots
settings
subtree presets
resource pickers
commerce-aware field types
server-first rendering and progressive enhancement
```

Do not borrow for v1:

```text
Liquid runtime
theme files as source of truth
settings_data.json as the canonical storage model
arbitrary custom liquid/html execution
arbitrary generated executable blocks
third-party app block runtime
full theme marketplace compatibility
Shopify's exact file layout or platform limits
```

## High-level CMS/commerce APIs

The primitive schema APIs remain:

```ts
defineSchema(...)
defineTable(...)
defineBlock(...)
v.blocks(...)
v.group(...)
v.relation.one(...)
v.relation.many(...)
v.object(...)
v.json(...)
```

Add high-level commerce CMS APIs:

```ts
defineThemeBlock(...)
defineSection(...)
defineTemplate(...)
defineRegion(...)

c.product()
c.products({ max })
c.variant()
c.variants({ max })
c.collection()
c.collections({ max })

c.productSource(...)

v.cms.page()
v.cms.pages({ max })
v.cms.entry(table)
v.cms.entries(table, { max })

v.media.image()
v.media.video()
v.media.file()

v.design.color()
v.design.colorScheme()
v.design.range({ min, max, step })
v.design.select([...])
v.design.spacing()
v.design.textAlign()
```

The `v.*` and `c.*` entries are authoring/picker aliases over normal fields and
relations. The `defineThemeBlock` / section / template / region entries add
composition AST nodes and editor/renderer metadata. All of them still compile
to the same authoritative row JSON, edge sidecars, index sidecars, and
Payload-compatible field configs rather than a second storage engine.

## Sections

A section is a top-level page composition and authority boundary. Examples:
Hero, Featured Collection, Product Information, Testimonials, Announcement
Bar, Header Navigation, and Footer Navigation. A section may remain indivisible,
but a generally composable section should keep only section-level layout and
data-source policy in its own settings and accept reusable root theme blocks.

```ts
const HeroSection = defineSection({
  slug: "hero",
  version: 1,
  label: "Hero",
  category: "Marketing",
  contexts: ["page", "product", "collection"],

  settings: {
    height: v.enum(["small", "medium", "large"]).default("medium"),
    colorScheme: v.design.colorScheme(),
  },

  blocks: {
    accepts: [GroupThemeBlock, TextThemeBlock, ImageThemeBlock, ButtonThemeBlock],
    max: 12,
  },

  presets: [
    {
      name: "Centered hero",
      category: "Marketing",
      settings: {
        height: "medium",
        colorScheme: "brand",
      },
      blocks: [
        {
          type: GroupThemeBlock,
          settings: { direction: "column", gap: 16 },
          blocks: [
            {
              type: TextThemeBlock,
              settings: {
                text: "Welcome to our store",
                style: "heading-xl",
              },
            },
            {
              type: ButtonThemeBlock,
              settings: {
                label: "Shop now",
                href: "/collections/all",
                variant: "primary",
              },
            },
          ],
        },
      ],
    },
  ],
})
```

A section compiles to a section instance with `sectionType`,
`definitionVersion`, a stable id, section settings, ordered root blocks, and
derived sidecars. It is
not merely an alias for a theme block because it owns route context and the
page-level rendering boundary.

## Theme blocks and section-local blocks

Reusable storefront components use `defineThemeBlock`. This is the proposed
Horizon-inspired layer:

```ts
const TextThemeBlock = defineThemeBlock({
  slug: "text",
  version: 2,
  label: "Text",
  capability: "content",
  contexts: ["page", "product", "collection"],
  settings: {
    text: v.richText(),
    style: v.design.select(["body", "heading-sm", "heading-lg", "heading-xl"]),
    align: v.design.textAlign(),
  },
  blocks: { accepts: [], max: 0 },
})

const GroupThemeBlock = defineThemeBlock({
  slug: "group",
  version: 1,
  label: "Group",
  capability: "layout",
  settings: {
    direction: v.enum(["row", "column"]).default("column"),
    gap: v.design.spacing(),
    align: v.design.select(["start", "center", "end", "spaceBetween"]),
  },
  blocks: {
    accepts: ["content", "media", "commerce"],
    max: 12,
    maxDepth: 3,
  },
})
```

Capabilities are closed manifest groups, not runtime wildcards. The compiler
expands them to concrete deployed block types and rejects incompatible or
recursive definitions that exceed the depth limit.

Section-local blocks remain available for specialized structures that should
not be reusable elsewhere, such as one slide inside a particular slideshow or
a private product-gallery control. They use a section-owned definition and
cannot be selected by unrelated sections. Core `defineBlock` remains available
for non-theme Payload-like structured content.

Recommended v1 limit: section root plus at most three nested theme-block levels.
Definitions should usually choose one or two. Avoid deep arbitrary nesting and
do not use generic groups to erase meaningful commerce or accessibility
structure.

## Templates

A template defines which sections are allowed or initially present for a route/context such as homepage, product page, collection page, article page, or generic page.

```ts
const HomeTemplate = defineTemplate({
  slug: "home",
  label: "Homepage",
  context: "page",

  sections: [
    HeroSection,
    FeaturedCollectionSection,
    ProductCarouselSection,
  ],

  presets: [
    {
      name: "Commerce homepage",
      sections: [
        {
          type: "hero",
          settings: {
            variant: "split",
            headline: "New arrivals",
          },
        },
        {
          type: "featuredCollection",
          settings: {
            heading: "Featured collection",
            limit: 8,
          },
        },
      ],
    },
  ],
})
```

A product template can constrain sections to product-aware components:

```ts
const ProductTemplate = defineTemplate({
  slug: "product.default",
  label: "Default product",
  context: "product",
  sections: [
    ProductMainSection,
    ProductRecommendationsSection,
    RecentlyViewedSection,
  ],
})
```

## Regions

Regions are layout-level editable areas such as header, footer, announcement bar, sidebar, or checkout banner. They are analogous to Shopify section groups but should use Flarex terminology.

```ts
const HeaderRegion = defineRegion({
  slug: "header",
  label: "Header",
  type: "header",
  sections: [
    AnnouncementBarSection,
    HeaderNavigationSection,
    SearchBarSection,
  ],
  maxSections: 25,
})

const FooterRegion = defineRegion({
  slug: "footer",
  label: "Footer",
  type: "footer",
  sections: [
    FooterNavigationSection,
    NewsletterSignupSection,
    SocialLinksSection,
  ],
})
```

Regions should be stored as singleton/global CMS rows, not as separate physical database constructs.

## Commerce resource pickers

Commerce picker fields should compile to typed relations and edge rows.

```ts
const FeaturedCollectionSection = defineSection({
  slug: "featuredCollection",
  label: "Featured collection",
  category: "Commerce",

  settings: {
    heading: v.string().default("Featured collection"),
    collection: c.collection().required(),
    productLimit: v.number().min(2).max(24).default(8),
    showVendor: v.boolean().default(false),
    showQuickAdd: v.boolean().default(true),
  },
})

const ProductCarouselSection = defineSection({
  slug: "productCarousel",
  label: "Product carousel",
  category: "Commerce",

  settings: {
    heading: v.string(),
    products: c.products({ max: 12, ordered: true }),
  },
})
```

Internally:

```text
c.collection()
  -> relation to logical commerce collections table
  -> row JSON value
  -> fx_edge_current / fx_edge_rev
  -> Payload/admin collection picker

c.products({ max: 12 })
  -> ordered relation list to logical commerce products table
  -> row JSON array
  -> ordered edge rows
  -> Payload/admin product multi-picker
```

## Product source/query settings

Manual product pickers and dynamic product queries should be separate concepts.

```text
c.products(...)
  selected product relations; stores selected product ids and writes product edges

c.productSource(...)
  dynamic product source/query/search definition; stores query config and resolves products at render/query time
```

Example dynamic section:

```ts
const ProductGrid = defineSection({
  slug: "productGrid",
  label: "Product grid",
  category: "Commerce",

  settings: {
    heading: v.string(),

    source: c.productSource({
      modes: ["manual", "collection", "query"],
      filters: ["status", "productType", "vendor", "tags", "inStock"],
      sorts: ["newest", "priceAsc", "priceDesc"],
      maxProducts: 24,
    }),
  },
})
```

Stored collection-based source:

```json
{
  "type": "collection",
  "collection": "col_summer",
  "sort": "newest",
  "limit": 8
}
```

Edges:

```text
source.collection -> commerce.collections.col_summer
```

Do not write permanent product edges for every dynamic result. Dynamic result products are resolved through declared commerce indexes/search at render/query time.

## Full app + commerce + CMS schema example

```ts
import { defineSchema, defineTable, v } from "flarex/server"
import { defineSection, defineTemplate, defineThemeBlock } from "flarex/cms"
import { c } from "flarex/commerce"

const users = defineTable({
  name: v.string(),
  email: v.string().unique(),
})

const productReviews = defineTable({
  product: c.product().required().index(),
  user: v.relation.one(users).required().index(),

  rating: v.number().min(1).max(5).index(),
  title: v.string(),
  body: v.string(),

  status: v.enum(["pending", "approved", "rejected"]).index(),
  createdAt: v.number().index(),
})
  .index("byProductCreatedAt", ["product", "createdAt"])
  .index("byProductStatusRating", ["product", "status", "rating"])

const FeaturedProducts = defineSection({
  slug: "featuredProducts",
  label: "Featured products",
  category: "Commerce",

  settings: {
    heading: v.string(),
    products: c.products({ max: 12, ordered: true }),
    showPrices: v.boolean().default(true),
    showQuickAdd: v.boolean().default(true),
  },
})

const FeaturedCollection = defineSection({
  slug: "featuredCollection",
  label: "Featured collection",
  category: "Commerce",

  settings: {
    heading: v.string(),
    collection: c.collection().required(),
    limit: v.number().min(2).max(24).default(8),
  },
})

const HomeTemplate = defineTemplate({
  slug: "home",
  label: "Homepage",
  context: "page",

  sections: [
    FeaturedProducts,
    FeaturedCollection,
  ],
})

export default defineSchema({
  users,
  productReviews,

  cms: {
    templates: [HomeTemplate],
  },

  commerce: c.schema({
    expose: ["products", "variants", "collections"],
  }),
})
```

This creates one logical schema graph:

```text
users
productReviews
commerce.products
commerce.variants
commerce.collections
cms.templates.home
cms.sections.featuredProducts
cms.sections.featuredCollection
```

Commerce products may be physically backed by reserved commerce/Medusa tables, but they still have logical Flarex table ids for relation, edge, picker, invalidation, and generated API purposes.

## Product template example

```ts
const ProductTitleBlock = defineThemeBlock({
  slug: "productTitle",
  version: 1,
  label: "Product title",
  contexts: ["product"],
  settings: {
    headingSize: v.enum(["sm", "md", "lg"]).default("lg"),
  },
  blocks: { accepts: [], max: 0 },
})

const ProductPriceBlock = defineThemeBlock({
  slug: "productPrice",
  version: 1,
  label: "Product price",
  contexts: ["product"],
  settings: {
    showCompareAt: v.boolean().default(true),
    showTaxNote: v.boolean().default(true),
  },
  blocks: { accepts: [], max: 0 },
})

const BuyButtonsBlock = defineThemeBlock({
  slug: "buyButtons",
  version: 1,
  label: "Buy buttons",
  contexts: ["product"],
  settings: {
    showDynamicCheckout: v.boolean().default(true),
    showQuantitySelector: v.boolean().default(true),
  },
  blocks: { accepts: [], max: 0 },
})

const ProductMainSection = defineSection({
  slug: "productMain",
  label: "Product information",
  category: "Commerce",
  contexts: ["product"],

  settings: {
    mediaLayout: v.enum(["stacked", "carousel", "grid"]).default("carousel"),
    stickyInfo: v.boolean().default(true),
  },

  blocks: {
    accepts: [
      ProductTitleBlock,
      ProductPriceBlock,
      VariantPickerBlock,
      BuyButtonsBlock,
      ProductDescriptionBlock,
      CollapsibleTabBlock,
      ComplementaryProductsBlock,
    ],
    max: 30,
  },
})
```

This mirrors Horizon-style reusable product composition while remaining
Flarex/Payload-owned data. Each block reads only the declared `product` context
facet supplied by the section renderer; it does not independently query the
commerce repository.

## Rendering and populate flow

A frontend page read may look like:

```ts
const page = await ctx.cms.getPage("home", {
  populate: {
    "sections.settings.products": true,
    "sections.settings.collection": true,
  },
})
```

Internally:

```text
1. Read page row from fx_row_current.
2. Inspect schema for section settings.
3. Collect commerce product/collection refs from row JSON and/or forward edges.
4. Batch fetch products/collections through commerce resolver.
5. Return page + resolved resources.
6. Record read sets for the page and resolved commerce entities.
```

For sync/cache invalidation:

```text
if product prod_123 changes:
  reverse edge lookup finds pages/sections/product sets/reviews referencing prod_123
  affected live queries, render caches, and previews can be invalidated
```

## Relation, picker, and populate are different

These should stay separate concepts.

```text
Relation
  schema-level durable link, persisted in row JSON and mirrored into fx_edge_*

Picker
  admin UI behavior for choosing allowed resources

Populate
  query/render behavior for resolving ids into objects
```

Example:

```ts
products: c.products({ max: 12 })
```

means:

```text
relation:
  ordered list of product ids

picker:
  product multi-picker with max=12

populate:
  optional fetch of product objects during query/render
```

## Query and scalability rules

The section/block/commerce model is scalable only if the query compiler stays strict.

Allowed production query paths:

```text
get row by id
query by declared scalar/compound index
query by relation/edge
query by block/section type index
query by explicitly indexed block/section subfield
query by external search index
```

Avoid:

```text
arbitrary JSONB path scans
unbounded nested block filtering
unindexed block or section subfield queries
unbounded reverse relation scans
cross-tenant scans in OLTP
```

Recommended platform limits:

```text
max sections per page/template
max blocks per section
max nested block depth
max row JSON size
max indexed fields per table
max relation edges per row
max commerce picker selections per field
max derived index entries per write
max locales per deployment or per collection
max live-query read set size
```

Shopify-like limits are useful as product guidance, but Flarex should define its own limits based on storage and sync costs.

## CMS write policy

This long-term note previously proposed `cmsOnly`, `ctxDbValidated`, and
`ctxDbAllowed` flags. Those names and the chained `.cms(...)` example are
superseded. The accepted authority contract lives in
[`flarexdb-payload-relational-adapter.md`](./flarexdb-payload-relational-adapter.md)
and distinguishes presentation from write ownership:

```text
CMS view
  read-only Payload presentation; app-owned writes remain app-owned

CMS managed
  dashboard and generated ctx.cms use one Payload operation pipeline;
  ordinary ctx.db writes are not authorized

app-command managed
  dashboard stays read-only until its actions delegate to app-owned commands
```

Payload-owned and lifecycle-sensitive content tables are CMS managed. A
developer-owned table does not become writable through Payload merely because
the dashboard can display it. Privileged migration and repair paths are
separate capabilities and cannot bypass native FlarexDB invariants.

Commerce-owned tables should not accept arbitrary public `ctx.db` writes. Commerce writes should go through `ctx.commerce` or trusted internal commerce adapters.

## Preview plan

V1 should support form-based editing plus preview.

V1 scope:

```text
section list
block add/remove/duplicate
block reorder
bounded nested block tree
static block visibility/settings where permitted
allowed-child and context validation
variant selectors
media pickers
commerce pickers
relation pickers
draft state
version state
preview URL / draft preview token
optional side-by-side preview refresh
```

Do not build the full visual editor in v1.

Future visual editor support should be enabled by preserving:

```text
stable block ids
block type
block definition version
parent block id and static/dynamic ownership
slot and sibling position
field path
section path
component metadata
relation/edge sidecars
```

Future frontend components can render metadata such as:

```tsx
<section
  data-flarex-block-id={block.id}
  data-flarex-block-type={block.blockType}
  data-flarex-field-path="sections.0"
>
  ...
</section>
```

But v1 does not need click-to-edit, canvas overlays, or inline editing.

## V1 cut

V1 should include:

```text
defineTable
defineBlock
defineThemeBlock
defineSection
defineTemplate
defineRegion

v.object
v.json
v.group
v.blocks
v.relation.one
v.relation.many
v.upload / v.media.image
v.richText

c.product
c.products
c.collection
c.collections
c.variant
c.variants
c.productSource for manual/collection/simple query sources

v.cms.entry / v.cms.entries
v.design.color
v.design.range
v.design.select

block/section subtree presets
ordered sections
ordered blocks
reusable theme blocks
maximum three nested theme-block levels below a section
closed allowed-child capability groups
static section/block children
versioned theme definitions and explicit migrations
header/footer regions
commerce pickers
media pickers
app tables referencing commerce tables
virtual reverse relations
join-table guidance/generators
drafts/versions basic support
form-based preview
```

V1 should not include:

```text
full visual editor
custom Liquid/runtime code
third-party app blocks
Shopify import/export
arbitrary deep nested blocks
unrestricted wildcard child blocks
arbitrary executable generated blocks
arbitrary JSON path queries
block-level physical tables by default
physical arbitrary extension of commerce product rows
full projection of every Medusa internal relation
```

## V2 / future

V2 or later can add:

```text
click-to-select preview inspector
inline preview editing
frontend overlay SDK
reusable shared sections
market/context-aware regions
app/extension blocks
deeper or dynamically extensible theme-block graphs
A/B templates
advanced theme presets
Shopify import/export adapter
client patch protocol for live preview
collaborative editing/presence
physical commerce row extension if the adapter layer supports it
advanced commerce relation helpers
commerce public graph projections, such as product -> variants / collections / media
full-text dynamic product search sections
```

These should build on the same primitive storage model, not replace it.

## Implementation checklist

1. Add distinct schema AST nodes for core `defineBlock`, storefront
   `defineThemeBlock`, `defineSection`, `defineTemplate`, and `defineRegion`.
2. Add `flarex/cms` and `flarex/commerce` package boundaries.
3. Add commerce logical table refs under `c.tables.*`.
4. Add `fx_relation_def` as relation metadata catalog.
5. Keep `defineSection` as a page-level context/rendering boundary rather than
   reducing it to an alias for `defineThemeBlock`.
6. Add stable block/section ids and definition versions to stored row JSON.
7. Validate closed allowed-child sets, context compatibility, document-wide
   instance-id uniqueness, static ids, acyclicity, and the three-level
   nested-block limit.
8. Add definition migration contracts and reject deployment when supported
   stored instances cannot decode or migrate.
9. Add `fx_block_index` or hidden-index derivation for block/section type,
   id-addressed logical path, position, and parent.
10. Derive `fx_edge_*` rows for relations/uploads/pickers inside app rows,
    blocks, and sections.
11. Derive `fx_index_entry_*` rows for declared indexes, including
    block/section subfield indexes.
12. Add compiler support for commerce picker aliases over normal relations.
13. Add logical table resolver support for app, CMS, media, commerce reserved,
    and system targets.
14. Generate Payload-compatible field/block configs from `.cms(...)` metadata.
15. Add CMS write policies and enforce them in mutation execution.
16. Add product/collection/media picker UI components in the admin.
17. Add a form-based tree editor with static/dynamic ownership and permitted
    add/remove/duplicate/reorder operations.
18. Add draft preview URL/token support.
19. Add schema compile-time write amplification estimates, including relation
    edge and nested-block index counts.
20. Add query planner rejection for unindexed nested/block/section JSON queries.
21. Add relation modeling docs/generators for child tables, bounded many lists,
    and join tables.
22. Add safe commerce delete behavior: soft delete/archive by default and
    reverse-edge checks before hard delete.
23. Keep visual editor APIs and arbitrary generated executable blocks out of v1
    public docs.

## Open decisions

- Exact naming: `defineSection` vs `defineComponentSection`.
- Exact commerce import name: `c` vs `commerce`.
- Whether `v.upload(media)` should be core or sugar for `v.relation.one(media).cms({ widget: "upload" })`.
- Maximum default section count per template/page.
- Maximum default block count per section.
- Whether the initial depth-three limit should count static wrapper blocks
  against the same budget as merchant-added blocks.
- Maximum default `c.products()` / `c.collections()` selection count.
- Whether regions are stored as Payload globals, Flarex system rows, or CMS singleton collections.
- How much Payload-specific admin metadata belongs in core schema vs `.cms(...)` metadata.
- Whether user-authored reusable patterns should become a separate future
  document type; deployed section and block presets remain immutable schema
  metadata that allocate owned instances when applied.
- How much `c.extend(...)` should support in v1 beyond virtual reverse relations.
- Whether `fx_relation_def` should be a separate table or folded into `fx_field.relation_json` for v1.
- Which public commerce/Medusa relationships should be projected into `fx_edge_*` in v2.

## Reference notes

This design is inspired by, but does not clone, the following systems:

- Payload blocks, groups, relationships, uploads, drafts, versions, globals, hooks, and admin forms.
- Shopify Dawn / Online Store 2.0: JSON templates, section groups,
  section-centric composition, local blocks, presets, and resource picker
  settings.
- Shopify Horizon and theme blocks: independently reusable block definitions,
  bounded nested blocks, static blocks, allowed-child contracts, and subtree
  presets. Flarex borrows the composition semantics, not Liquid or Shopify's
  runtime and file limits.
- Convex: generated APIs, declared indexes, OCC, read sets, live query invalidation, and function execution ergonomics.
- InstantDB: relationship/edge sidecars and graph-oriented query ergonomics.

The key Flarex-specific decision is to keep one primitive storage model:

```text
row JSON as authoritative value
+ relational sidecars for indexes/edges/blocks/unique keys
+ logical table ids for app/CMS/media/commerce targets
+ Postgres-authoritative commit/OCC/sync
```

Primary external references:

- [Shopify theme blocks](https://shopify.dev/docs/storefronts/themes/architecture/blocks)
- [Shopify theme-block schema and nested blocks](https://shopify.dev/docs/storefronts/themes/architecture/blocks/theme-blocks/schema)
- [Shopify static theme blocks](https://shopify.dev/docs/storefronts/themes/architecture/blocks/theme-blocks/static-blocks)
- [Shopify Horizon source and design principles](https://github.com/Shopify/horizon)
- [Payload Blocks field](https://payloadcms.com/docs/fields/blocks)
- [Payload drafts](https://payloadcms.com/docs/versions/drafts)
- [Payload live preview](https://payloadcms.com/docs/live-preview)
