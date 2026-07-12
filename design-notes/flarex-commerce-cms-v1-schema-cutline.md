# Flarex Commerce/CMS v1 Schema Cutline

Status: accepted v1 implementation cutline; replacement remains unimplemented

Authoritative review:

- [`flarex-db-accepted-design.md`](./flarex-db-accepted-design.md)

Related architecture note:

- `design-notes/flarex-commerce-cms-sections-blocks.md`

That larger note is a long-term architecture superset. This file is the stricter v1 cutline. It challenges the superset, removes non-essential tables from the first implementation, and defines the smaller schema that should actually be built first.

## 2026-07-10 Accepted Correction

The original cutline correctly reduced the physical table count, but it still
assumed Postgres read/write staging for every transaction and did not give edge
occurrences, scope isolation, snapshots, or schema evolution enough precision.

The corrected first implementation is:

```text
stable catalog ids + immutable versioned definitions
app row current + revision history
declared index current + revision history
stable current edge occurrences
unique-key enforcement
scope clock + commit/change atoms
authoritative fenced session/grant anchor + snapshot lease
result-bearing idempotency
leased transactional outbox
existing Postgres subscription registry during sync migration
```

SessionDO may later hold a bounded logical app journal, but the v1 schema does
not require deleting the authoritative Postgres session anchor. The generic
compiler covers only app operations with complete read-your-writes overlays.
Payload request transactions and Medusa transactions remain adapter-owned
lanes.

Naming rule: `scope_id` is the internal data-plane authority. In shared-table
mode, it participates in every
primary key, unique constraint, and intra-scope foreign key. It is derived from
trusted session authority, not supplied by the logical journal.

Snapshot rule:

```text
SnapshotToken = (scope_id, epoch, commit_seq)
```

Wall-clock `beginTs` and global/dense sequence assumptions are rejected.
Epoch rollover fences old sessions/subscriptions and requires full resnapshot,
but scope-local commit/outbox sequences remain strictly monotonic and are never
reset or reused. Current rows and uniqueness keys therefore survive the epoch
change. Records and cursors that interpret a token still carry epoch.
Engine revision retention is bounded by active snapshot leases and reconnect
cursors. Payload user-visible versions are excluded from engine-history GC.

The current `documents`/`indexes`/invoke-session/subscription/outbox schema is
the compatibility baseline. Introduce this cutline behind a generation flag,
then backfill, verify, dual-read compare, cut over by scope, and retain rollback.

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
  scope clock + exact snapshots + typed read sets + commit atoms + outbox +
  result-bearing idempotency
```

But the full design currently includes tables for field catalog, relation catalog, edge history, block metadata, Payload lifecycle, and more. Those are useful long-term, but many are not necessary to prove the first implementation.

V1 should build the few primitives that make the platform possible:

```text
rows
indexes
edges
uniqueness
commits
fenced session anchors / snapshot leases / typed read sets
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
  fx_schema_version.manifest_json + stable fx_table/fx_index identities
  + immutable fx_index_def rows

not:
  fx_table + fx_field + fx_relation_def + many metadata tables
```

## Recommended v1 physical schema

### Catalog

```text
fx_schema_version
fx_table
fx_index
fx_index_def
fx_index_build_state
```

`fx_schema_version.manifest_json` is the immutable submitted schema artifact.
`fx_table` keeps only stable table identity across versions. The manifest
repeats the namespace and logical name as a version-pinned assertion, but the
table definition itself is not copied into a normalized table-definition row.
Later `fx_index` identity and `fx_index_def` rows are the intentionally
normalized compiled index catalog, written transactionally and verified
against the manifest checksum rather than independently edited.

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
fx_scope_clock
fx_commit
fx_commit_write
fx_tx_session_anchor
fx_snapshot_lease
fx_sync_reconnect_lease
fx_outbox
fx_idempotency
```

These are non-negotiable for trusted execution, OCC, exact snapshots,
result replay, and post-commit recovery. A normalized dependency table is
optional when the trusted commit planner can validate a bounded typed batch
directly. A SessionDO journal is an implementation choice, not the authority
schema.

### Optional v1 if CMS editor requires it

```text
fx_block_index_current
```

But before adding a dedicated table, try representing block/section type metadata as hidden system indexes inside `fx_index_entry_current`.

## Suggested v1 table list

The v1 cut should look like this:

The short names in this cutline are conceptual. Executable migrations use the
namespaced physical families from the long-form schema so ownership is visible:

```text
catalog/control: fx_control_*
app rows/sidecars: fx_app_*
commit/session/outbox: fx_system_*
```

For example, `fx_row_current`, `fx_scope_clock`, and `fx_idempotency` below map
to `fx_app_row_current`, `fx_system_scope_clock`, and
`fx_system_idempotency`. The foundation schema plan is the implementation
checklist: [`../roadmaps/flarexdb-foundation/01-schema-and-migrations.md`](../roadmaps/flarexdb-foundation/01-schema-and-migrations.md).

```text
Required:
  fx_schema_version
  fx_table
  fx_index
  fx_index_def
  fx_index_build_state

  fx_row_current
  fx_row_rev

  fx_index_entry_current
  fx_index_entry_rev
  fx_unique_key

  fx_edge_current

  fx_scope_clock
  fx_commit
  fx_commit_write
  fx_tx_session_anchor
  fx_snapshot_lease
  fx_sync_reconnect_lease
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

Suggested v1 shape uses a stable table identity plus an immutable schema
manifest. Do not mutate a table identity into a new historical meaning:

```sql
fx_control_table (
  deployment_id text not null,
  table_id int not null,
  namespace text not null,
  logical_name text not null,
  created_at timestamptz not null default now(),
  primary key (deployment_id, table_id),
  unique (deployment_id, namespace, logical_name)
);

fx_control_schema_version (
  deployment_id text not null,
  schema_version_id text not null,
  version integer not null,
  manifest_codec_version integer not null,
  manifest_json jsonb not null,
  manifest_bytes bytea not null,
  manifest_sha256 bytea not null,
  created_at timestamptz not null default now(),
  primary key (deployment_id, schema_version_id),
  unique (deployment_id, version),
  check (octet_length(manifest_bytes) > 0),
  check (octet_length(manifest_sha256) = 32)
);
```

Accepted S03-A/S03-B1 refinement: stable table identity and immutable schema
artifacts are deployment-owned control metadata. `manifest_json` carries the
semantic schema input, while `manifest_bytes` retains the exact versioned
canonical UTF-8 encoding and `manifest_sha256` stores its raw 32-byte digest;
PostgreSQL `jsonb` is not checksum input. The artifact has no mutable status.
S03-D owns later validation lifecycle, and the scope's sole active-version
pointer changes only after required index backfills and validation succeed.

S03-B2a freezes only the semantic app-document table-definition section.
S03-B2b1 now plans stable IDs optimistically from the current
`fx_control_table` bindings and high-water mark, then revalidates that opaque
plan under the deployment lock before inserting exact IDs. S03-B2b2 now hashes
the exact planned section outside SQL and composes plan application with B1
artifact insertion in one transaction behind one app-schema persistence API.
Its private combined token prevents pairing a valid plan with artifact bytes
from another schema; typed stale races trigger at most three whole-preparation
attempts. This cutline does not authorize standalone ID reservation, a second
table-definition copy, or field/relation/constraint/index activation.

Accepted S03-B2a table-definition section (using conceptual short catalog
names in this cutline):

```json
{
  "kind": "tableDefinitions",
  "sectionVersion": 1,
  "tables": [
    {
      "tableId": 7,
      "namespace": "app",
      "logicalName": "productReviews",
      "definition": {
        "kind": "appDocument",
        "definitionVersion": 1,
        "documentType": {
          "type": "object",
          "value": {
            "status": {
              "fieldType": { "type": "string" },
              "optional": false
            }
          }
        }
      }
    }
  ]
}
```

The earlier unbound `fields`/`relations` JSON sketch was a design superset and
is superseded for this slice. Explicit relation/cardinality/on-delete objects,
Payload definitions, and Medusa relational DML need later source-driven
contracts and must not be added as opaque optional fields to section v1.

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

But for v1, it duplicates the immutable schema manifest.

Recommendation:

```text
v1:
  keep field metadata inside fx_schema_version.manifest_json

v2:
  materialize fx_field if schema introspection becomes hot or complex
```

### `fx_index` / `fx_index_def`: keep

This is required because index entries need stable index IDs.

Suggested shape:

```sql
fx_index (
  scope_id text not null,
  index_id int not null,
  table_id int not null,
  name text not null,
  created_at timestamptz not null default now(),
  primary key (scope_id, index_id),
  unique (scope_id, table_id, name),
  foreign key (scope_id, table_id)
    references fx_table (scope_id, table_id)
);

fx_index_def (
  scope_id text not null,
  schema_version bigint not null,
  index_id int not null,
  fields_json jsonb not null,
  unique_key boolean not null default false,
  key_codec_version int not null,
  primary key (scope_id, schema_version, index_id),
  foreign key (scope_id, schema_version)
    references fx_schema_version (scope_id, schema_version),
  foreign key (scope_id, index_id)
    references fx_index (scope_id, index_id)
);

fx_index_build_state (
  scope_id text not null,
  schema_version bigint not null,
  index_id int not null,
  state text not null default 'building',
  backfill_cursor_json jsonb,
  attempt int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (scope_id, schema_version, index_id),
  foreign key (scope_id, schema_version, index_id)
    references fx_index_def (scope_id, schema_version, index_id)
);
```

Definitions are immutable. Mutable lifecycle lives in
`fx_index_build_state`: `building -> backfilling -> validating -> enabled ->
retiring`. Query planning uses only definitions whose per-scope build state is
enabled for the active schema version.

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

For v1, store that metadata in `fx_schema_version.manifest_json`.

Recommendation:

```text
v1:
  no physical fx_relation_def
  stable relation ids and relation metadata live in
  fx_schema_version.manifest_json

v1.5/v2:
  add fx_relation_def if relation introspection becomes hot
```

`fx_edge_current` can exist without `fx_relation_def`, but every edge still
uses a stable non-null relation ID from the immutable schema manifest. It also
stores `source_path`, `target_table_id`, and `relation_kind`. Stable relation
identity is required before edge occurrence identity can be deterministic.

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
  scope_id text not null,
  epoch text not null,
  table_id int not null,
  row_id text not null,
  commit_seq bigint not null,
  schema_version bigint not null,
  value_codec_version integer not null,
  data_json jsonb not null,
  data_hash bytea not null,
  deleted boolean not null default false,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  status text,
  primary key (scope_id, table_id, row_id)
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
  scope_id text not null,
  epoch text not null,
  table_id int not null,
  row_id text not null,
  commit_seq bigint not null,
  prev_commit_seq bigint,
  schema_version bigint not null,
  value_codec_version integer not null,
  data_json jsonb not null,
  data_hash bytea not null,
  deleted boolean not null default false,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz,
  status text,
  primary key (scope_id, table_id, row_id, commit_seq)
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
  scope_id text not null,
  epoch text not null,
  index_id int not null,
  table_id int not null,
  row_id text not null,
  key_prefix bytea not null,
  key_suffix bytea,
  key_sha256 bytea not null,
  key_codec_version integer not null,
  locale text,
  commit_seq bigint not null,
  primary key (scope_id, index_id, key_sha256, row_id)
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
  scope_id text not null,
  epoch text not null,
  edge_id text not null,
  occurrence_key text not null,
  relation_id int not null,

  source_table_id int not null,
  source_row_id text not null,
  source_path text not null,

  target_table_id int not null,
  target_row_id text not null,

  relation_kind text not null,
  locale text,
  position int,
  commit_seq bigint not null,

  primary key (
    scope_id,
    edge_id
  ),
  unique (
    scope_id,
    source_table_id,
    source_row_id,
    occurrence_key
  )
);
```

`occurrence_key` includes the stable nested item/block id, source path, locale,
and occurrence identity. Position is ordering metadata, not identity. This is
required when the same target appears twice, in two locales, or in different
nested blocks.

Recommended indexes:

```sql
create index fx_edge_current_reverse
  on fx_edge_current (
    scope_id,
    target_table_id,
    target_row_id,
    source_table_id,
    source_path
  );

create index fx_edge_current_forward
  on fx_edge_current (
    scope_id,
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
  scope_id text not null,
  epoch text not null,
  constraint_id int not null,
  table_id int not null,
  row_id text not null,
  encoded_key bytea not null,
  key_hash bytea not null,
  key_codec_version integer not null,
  key_json jsonb not null,
  locale_key text not null default '',
  commit_seq bigint not null,
  primary key (scope_id, constraint_id, locale_key, key_hash)
);
```

The normalized `locale_key` is also part of canonical key encoding and hashing;
it is empty for non-localized constraints.

On an existing hash, trusted code compares `encoded_key`. Equal bytes mean the
same logical key; unequal bytes are a fatal `CanonicalKeyHashCollision` and the
mutation aborts. V1 does not attempt to store two unequal canonical keys behind
one SHA-256 uniqueness slot.

### `fx_commit`: keep

This is the logical commit timeline.

Suggested shape:

```sql
fx_commit (
  scope_id text not null,
  epoch text not null,
  commit_seq bigint not null,
  mutation_id text,
  actor_identity text,
  created_at timestamptz not null default now(),
  summary_json jsonb,
  primary key (scope_id, commit_seq),
  unique (scope_id, epoch, commit_seq)
);
```

### Authoritative session anchor and snapshot lease: keep

These are needed for trusted authority, fencing, exact-snapshot retention,
idempotent finish, and uncertain-result recovery. Active logical read/write
journals may remain in Postgres for compatibility or move to SessionDO for the
bounded app compiler; the authority fields remain in Postgres.

Required properties:

```text
session status
scope + storage generation/fence + epoch + begin commit sequence
package/artifact + function reference
identity/access-policy fingerprint
validated canonical arguments + authenticated inert authorization grant
allowed capabilities + policy revocation epoch
schema/policy version
attempt fence + protocol version + syscall sequence + journal digest
request key + canonical request hash
result/error + committed epoch/sequence
TTL/cleanup
```

Lifecycle is `created -> running -> finishing -> committing -> committed`, with
an OCC-only `committing -> retrying -> running` transition that increments the
attempt fence, replaces the snapshot lease, and discards the old journal.
`aborted` and `expired` remain terminal. Late syscalls are rejected once
finishing begins for the current attempt.
Repeated finish and lost responses resolve through the stored authoritative
outcome. Snapshot leases prevent history GC from passing a live attempt.
The trusted executor validates arguments against the pinned authoritative
validator before execution and validates the encoded return before commit.

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
claim_fence
next_attempt_at
last_error
delivered_at
dead_lettered_at
```

Never GC pending or claimed rows. Dead letters require explicit operator
policy. Compact delivered rows only after all required consumer progress and
delivery-idempotency retention requirements are satisfied; snapshot/reconnect
leases do not prove side-effect delivery.

### `fx_idempotency`: keep

Non-negotiable.

Without idempotency, client retries can double-apply mutations.

Database uniqueness/lookup key:

```text
scope_id
client mutation id / idempotency key
```

Stored match fields:

```text
identity/access-policy fingerprint
function reference
canonical argument/request hash
```

Stored result:

```text
in_progress / committed
epoch + commit_seq
result_json
error_json
```

The successful result is written atomically with data, commit atoms, and
outbox. Reusing the key for another identity, function, or request hash is an
error.
Only `committed` is replayable. OCC conflicts, SQL serialization/deadlock
rollbacks, and transport uncertainty are not terminal replayable failures.
Only the in-progress attempt lease expires. A committed key is never reusable:
after the result replay window, retain a compact identity/function/request-hash
and commit-token tombstone and return `CommittedResultExpired` to late retries.

### Payload-specific physical tables: defer

Derive the logical contract from Payload `BaseDatabaseAdapter`, sanitized
internal collections, and transaction/conformance tests rather than the table
names below. Drafts are version semantics; collection and global versions are
distinct; document-lock targets and owners can be polymorphic.

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
  scalar Payload CRUD and request transactions through reserved logical
  CMS/system collections over the row store

v2:
  relations, versions/drafts, globals, auth/locks, preferences/jobs/migrations,
  and hooks in conformance-tested slices; dedicated physical tables only if
  adapter performance/compatibility requires them
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
  review_1 at commit_seq 100

fx_index_entry_current:
  byProductStatusCreatedAt [prod_123, approved, 1730000000, review_1]

fx_index_entry_rev:
  insert current index key at commit_seq 100

fx_edge_current:
  review_1.product -> commerce.products.prod_123
  review_1.user -> users.user_456

fx_unique_key:
  only if schema declares a unique constraint

fx_commit:
  commit_seq 100

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
  pages.home at commit_seq 101

fx_index_entry_current:
  pages.bySlug [home]
  pages._byBlockType [sections, featuredProducts, home, sec_1]

fx_edge_current:
  pages.home.sections.sec_1.settings.products[0] -> commerce.products.prod_1
  pages.home.sections.sec_1.settings.products[1] -> commerce.products.prod_2

fx_commit:
  commit_seq 101

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

1. Add scope/epoch/commit-sequence tokens and a single active schema pointer.
2. Add stable catalog IDs plus immutable schema manifests and index lifecycle.
3. Add `fx_row_current` / `fx_row_rev` behind a storage-generation flag.
4. Add stable `fx_index`, immutable `fx_index_def`, and current/revision entries
   with a versioned ordered
   key codec.
5. Add `fx_unique_key` and stable-occurrence `fx_edge_current`.
6. Add the fenced session anchor, snapshot lease, typed dependency validation,
   result-bearing idempotency, commit atoms, and leased outbox.
7. Prove point CRUD and one indexed query on PGlite and real Postgres.
8. Backfill, verify, dual-read compare, scoped cut over, and preserve rollback.
9. Add two-phase live-query activation and per-scope contiguous catch-up while
   retaining the current Postgres subscription registry.
10. Add hidden block-type indexes through `fx_index_entry_current` if needed.
11. Add a scalar Payload adapter over reserved logical collections.
12. Only then consider normalized catalog tables, `fx_edge_rev`, dedicated
    Payload physical tables, or cache DOs.

## Documentation patch recommendation

The existing `flarex-commerce-cms-sections-blocks.md` should remain the superset architecture note.

It should be interpreted as:

```text
long-term design vocabulary
not v1 implementation inventory
```

This cutline should be referenced wherever implementation starts, so future work does not accidentally build every table in the superset note before proving the core.

Medusa is deliberately not part of this generic app-storage migration. Prove
one small Medusa module separately through its real DML, link/joiner,
migration, repository, workflow, and trusted Postgres transaction boundaries.
There is no general atomic `ctx.db + ctx.commerce` transaction.

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
stable edge occurrences
unique keys
exact snapshots + typed read sets
commit/change atoms
leased outbox
result-bearing idempotency
```

That is enough to prove the architecture without overbuilding it.
