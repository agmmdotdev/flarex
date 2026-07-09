# Flarex Instant-Like Medusa And Payload Storage Research

## Purpose

This note records the architecture discussion about whether Flarex storage can
grow an InstantDB-like layer and become the shared storage substrate for Flarex
applications, the Medusa runtime, and Payload CMS logic.

For the current proposed internal table layout, use
[`flarex-internal-db-schema.md`](./flarex-internal-db-schema.md) as the
canonical schema direction. This file keeps the broader reasoning and rejected
alternatives.

The short answer is yes, but only as a hybrid platform storage layer under
separate adapters. Medusa should use a Flarex-backed Medusa persistence
adapter. Payload should use a Flarex-backed Payload database adapter generated
from CMS-marked Flarex app schema. It should not mean that Medusa module
services use Flarex's public application `ctx.db` API directly, and it should
not mean that Medusa commerce behavior or Payload CMS semantics are rewritten
as generic Flarex application code.

## Verdict

A Flarex storage core with an InstantDB-like entity, attribute, link, and
transaction layer could support Medusa, but only if it satisfies Medusa's
existing repository, transaction, workflow, locking, and integration-test
contracts.

The viable Medusa shape is:

```text
Medusa module services, workflows, APIs, and public contracts
  -> existing MedusaService / generated internal services
  -> existing repository and transaction context contracts
  -> Flarex-backed Medusa persistence adapter
  -> internal FlarexDB persistence API
  -> FlarexDB executor/storage engine
  -> physical backend selected by Flarex
       typed row JSON for app/Payload content
       derived index, edge, unique-key, and block-metadata sidecars
       optional internal read models
       commit log, outbox, freshness, and sync invalidation
       system stores for workflows and locks
```

This keeps the in-place Medusa refactor intact while allowing Flarex to own the
lower-level storage runtime.

The viable Payload shape is:

```text
Flarex defineTable app schema
  -> CMS-marked tables, fields, relationships, uploads, auth, and versions
  -> generated Payload config artifact
  -> Payload collection/global operation lifecycle
  -> @payloadcms/db-flarex adapter
  -> the same Flarex app rows, sidecar indexes, sidecar edges, unique keys,
     block metadata, and transaction protocol
```

This keeps Payload as the CMS semantics engine while Flarex remains the source
of truth for schema, tenant/deployment routing, storage, indexes, transactions,
sync invalidation, and migrations.

## Boundary Rule

Do not collapse these two APIs into one surface:

```text
Flarex app ctx.db
  -> developer custom schema
  -> custom application data
  -> display metadata, extension records, custom links to commerce IDs

Medusa persistence adapter
  -> internal commerce schema
  -> module DML and repository behavior
  -> transactional service methods
  -> module integration-test compatibility

Payload database adapter
  -> CMS-marked Flarex app schema
  -> generated Payload config and operation lifecycle
  -> collection/global CRUD, auth, uploads, versions, drafts, and hooks
  -> adapter-level mapping into Flarex app rows, sidecar indexes, sidecar
     edges, unique keys, block metadata, and Payload system tables
```

The same physical database can be shared. The same Flarex platform catalog and
tenant/deployment routing can be shared. The public logical API should remain
separate.

## Internal FlarexDB Adapter Boundary

The Flarex-backed Medusa adapter should not receive raw Postgres, Hyperdrive,
D1, Durable Object SQLite, or physical SQL table access.

The adapter boundary should be:

```text
Medusa services and workflows
  -> Medusa repository/session contract
  -> Flarex-backed Medusa persistence adapter
  -> internal FlarexDB persistence API
  -> FlarexDB executor/storage engine
  -> Postgres, Hyperdrive, Durable Object SQLite, D1, or another backend
```

Not:

```text
Medusa adapter
  -> raw Postgres client
  -> raw physical Flarex tables
```

The internal FlarexDB persistence API owns:

- platform tenant/project/deployment scope injection;
- reserved namespace access for Medusa commerce tables;
- schema catalog and migration mapping;
- relation/link storage;
- typed indexes and uniqueness checks;
- commit protocol, database transaction binding, OCC/read-set validation, and
  rollback behavior;
- outbox, freshness, live-query invalidation, and optional internal read-model
  maintenance.

That means Postgres or Hyperdrive is a physical executor behind FlarexDB, not
the API contract exposed to Medusa. The same rule should apply to Payload's
adapter: it should call FlarexDB logical storage APIs generated from the
Flarex schema instead of interpreting the physical SQL layout independently.

This preserves one storage authority:

```text
Public app API
  ctx.db

Internal framework APIs
  flarexDb.medusa.*
  flarexDb.payload.*

Physical executors
  Postgres / Hyperdrive / DO SQLite / D1
```

Medusa and Payload can be first-class framework integrations without becoming
owners of the physical database schema.

## Foundation Storage Model

The current foundation direction is one FlarexDB control plane with three
storage classes underneath it. The important correction from earlier notes is
that the app/Payload class is not pure EAV/triples as the authoritative value
store. It is a typed row store with embedded structured JSON plus relational
sidecars.

```text
FlarexDB control plane
  schema catalog
  transaction/session manager
  OCC/read-set validator
  commit log and commit cursor
  outbox/freshness/live-query invalidation
  live-query cache and read-set indexes
  tenant/project/deployment scope

Storage class A: app and Payload content
  typed authoritative row JSON
  derived scalar/compound index sidecars
  derived relationship/upload/join edge sidecars
  derived unique-key sidecars
  optional block type/order metadata sidecars
  flexible developer-defined logical tables
  CMS-marked app tables and fields
  public ctx.db access according to schema policies

Storage class B: Payload system state
  fixed Payload lifecycle tables
  versions, drafts, uploads, globals, auth/session state, locks, scheduled publish
  adapter-only writes where Payload lifecycle semantics are required

Storage class C: Medusa system data
  DML-generated real relational system tables
  DML-generated link/pivot tables
  DML-generated indexes and constraints
  adapter-only access through Medusa repositories and workflows
```

This avoids two bad extremes:

- Do not force Medusa Product, Pricing, Order, Inventory, RBAC, and Index into a
  generic triples/entities-only physical model first.
- Do not force Payload blocks, arrays, rich text, groups, tabs, and localized
  values into normalized child rows or EAV triples by default.
- Do not make every app/Payload scalar field an authoritative triple. Store the
  row value once, then derive sidecars for the fields that need query,
  uniqueness, relationships, OCC, and sync.
- Do not let Medusa own raw Postgres or bypass the FlarexDB transaction,
  tenancy, schema, outbox, and invalidation layers.

FlarexDB owns both storage shapes through internal schema compilers and
adapters:

```text
Flarex app schema
  -> app/Payload row-and-sidecar schema compiler
  -> row JSON, index entries, relation/upload edges, unique keys, block metadata

Medusa DML metadata
  -> Medusa system schema compiler
  -> generated relational system tables

Both shapes
  -> same FlarexDB transaction/session/OCC layer
  -> same commit log
  -> same outbox/freshness/live-query invalidation model
```

The shared control plane is the important product boundary. Storage shape is an
implementation decision per namespace. App/Payload storage borrows InstantDB's
relationship/index/transaction ideas, but not InstantDB's full EAV/triple value
store as the authoritative storage for every field.

## Current Sync Foundation After Lunora Review

The current sync direction is Convex-like server query reactivity with selected
Lunora protocol ideas, not a mandatory client-side database.

Default sync unit:

```text
Flarex query function
  -> runs on the server
  -> reads FlarexDB source tables or fresh-enough internal read models
  -> returns a result
  -> records read dependencies
  -> client caches that result
```

Default write unit:

```text
Flarex mutation or explicit transaction
  -> records read dependencies and write intent while user code runs
  -> trusted executor opens the short physical Postgres transaction
  -> validates OCC, idempotency, watermarks, locks, and constraints
  -> writes app, Payload, Medusa, workflow, commit, and outbox rows
  -> commits once
  -> directly wakes DeploymentSyncDO with a compact commit summary
```

Therefore the default architecture is not:

```text
Postgres source data
  -> mandatory SQLite or Durable Object projection store
  -> client-side TanStack DB as the normal query engine
```

The default architecture is:

```text
Postgres / FlarexDB
  -> authoritative source of truth and transactional commit

DeploymentSyncDO
  -> hot live-sync coordinator
  -> query-result cache
  -> read-set indexes
  -> commit cursor/outbox cursor
  -> coalesced query reruns
  -> result-hash based skip or settled notification

ConnectionDO
  -> hibernating WebSocket sessions
  -> client protocol delivery

Flarex client
  -> simple query-result cache
  -> reconnect resume cursor
  -> optional durable read cache
  -> optional durable mutation outbox
  -> optimistic layers
```

After reviewing InstantDB's sync engine, the v1 semantic target should be:

```text
dependency topics/read sets
  -> coarse invalidation first
  -> rerun stale server queries
  -> compare result hash
  -> send changed result or settled acknowledgement
  -> let the client reconcile optimistic pending mutations
```

This is intentionally not a perfect query-cache patching engine. If a query is
hard to match precisely, the safe v1 behavior is to mark it stale and rerun it
from Postgres/FlarexDB through the normal query runtime. Exact row movement,
bounded-list refill, and in-memory patching are optimizations after the
invalidation/rerun model is proven.

The Lunora ideas worth borrowing are protocol and recovery ideas:

- every successful commit gets a monotonic commit cursor;
- clients reconnect with their last cursor and epoch;
- if the cursor is too old or the epoch changed, the server re-seeds;
- if a mutation commits but a subscribed result is byte-identical, send a
  lightweight `settled` acknowledgement so optimistic state can clear;
- offline writes use stable idempotency keys;
- advanced offline/local-first writes may use `clientId + mutationSeq`
  watermarks so duplicates are acknowledged and gaps are rejected;
- server-resolved shapes can exist later for partial row replication, where the
  client asks for a named shape plus args and never sends raw `where` clauses.

The InstantDB ideas worth borrowing for v1 are the simpler server-side sync
semantics:

- represent query dependencies as topics/dependency keys;
- subscribe before or during query execution so in-flight queries do not miss
  commits;
- use broad dependencies while the query is running, then refine the read set
  after the query resolves;
- rerun stale queries instead of trying to patch every result in memory;
- suppress unchanged reruns by comparing result hashes;
- keep pending mutations on the client until subscribed queries have caught up
  to the acknowledged commit cursor.

TanStack DB is not the Flarex sync engine. It can be an optional adapter later:

```text
@flarex/client
  -> base protocol, cache, subscriptions, cursor resume, outbox

@flarex/react
  -> Convex-style useQuery/useMutation over server query results

@flarex/tanstack-db
  -> optional local-first collection adapter for apps that want browser-side
     filtering, joins, sorting, and deeper offline behavior
```

Most app, Payload, and Medusa flows should not require TanStack DB because
complex query logic already belongs in Flarex server query functions.

## Medusa DML As The Source For FlarexDB System Schema

Medusa already owns its persistence shape through DML models such as
`model.define(...)`. A FlarexDB Medusa adapter should consume those DML models
directly and generate the `system.medusa` schema from them. Flarex should not
hand-author a second copy of Medusa tables in its public app schema or physical
schema files.

The current fork already proves the compiler shape:

```text
Medusa model.define(...)
  -> PortableEntity / ModulePersistenceModel
  -> compileDmlSchema(...)
  -> neutral DatabaseSchema IR
  -> Drizzle SQLite table, D1 SQL migration, and repository implementation
```

For FlarexDB, the target should change while the source remains the same:

```text
Medusa model.define(...)
  -> PortableEntity / ModulePersistenceModel
  -> shared DML schema compiler
  -> neutral DatabaseSchema IR
  -> FlarexDB system schema manifest
  -> FlarexDB catalog rows
  -> generated internal Drizzle/Postgres tables
  -> Flarex-backed Medusa repositories
```

The foundation should therefore be a FlarexDB schema compiler target, not a new
Medusa schema authoring system.

Conceptually:

```ts
export const flarexMedusaPersistenceAdapter: ModulePersistenceAdapter = {
  name: "flarexdb",

  prepareModels(models) {
    // Collect Medusa DML models.
    // Compile them to a FlarexDB system schema manifest.
    return models
  },

  createConnectionLoader() {
    // Inject an internal FlarexDB Medusa manager/session.
  },

  createRepository(model) {
    // Return a generic Flarex-backed repository for DML CRUD.
  },

  createCustomRepository({ repositoryName, moduleModels, model }) {
    // RBAC, Pricing, InventoryLevel, Order helpers, Index, etc.
  },

  createEventSubscriber(keys, service) {
    // Bridge Medusa mutation events to Flarex outbox/freshness.
  },
}
```

The existing `compileDmlSchema(...)` lives under the Drizzle package today, but
architecturally it is the reusable compiler IR that FlarexDB should depend on.
The D1 SQL renderer and `toDrizzleSqliteTable(...)` are backend targets. The
FlarexDB target should be another target that records namespace, ownership,
visibility, write policy, tenant scope, catalog version, and physical table
mapping.

Example for Currency:

```text
Currency model.define("currency", ...)
  -> system.medusa table: currency
  -> physical table: medusa_currency or medusa.currency
  -> owner: medusa
  -> visibility: adapter-only
  -> write_policy: medusa-adapter
  -> repository: FlarexMedusaRepository(Currency)
```

Recommended foundation order:

1. Extract or share the DML-to-`DatabaseSchema` compiler IR so it is not
   conceptually owned by the Drizzle SQLite package.
2. Add a FlarexDB Medusa schema registry that stores compiled tables, columns,
   indexes, checks, foreign keys, relationships, module name, schema hash,
   namespace, visibility, and write policy.
3. Add a Flarex physical renderer for Postgres/Drizzle-backed internal tables.
4. Add the `@medusajs/db-flarex` `ModulePersistenceAdapter` implementation.
5. Prove the path with a small DML module such as Currency, Store, or Region
   before Product, Pricing, RBAC, or Index.
6. Add custom repository adapters after generic DML CRUD passes unchanged
   module tests.

## Ownership Model

The target has three owners with different authority:

```text
Flarex owns the data plane
  -> DB engine and executor bindings
  -> source-of-truth schema catalog
  -> app/Payload row JSON storage
  -> derived relation edges, indexes, unique keys, block metadata, and read models
  -> transaction authority, OCC/read-set validation, and commit log
  -> migrations, tenant/project/deployment isolation, outbox, freshness, sync

Medusa owns commerce semantics
  -> module services, DML model intent, workflows, APIs, and invariants
  -> validation behavior and existing module/API integration compatibility
  -> commerce transactions through Medusa repository/session contracts

Payload owns CMS semantics
  -> config lifecycle, field behavior, validation, access, and hooks
  -> auth, uploads, drafts, versions, localization, and admin/API operations
  -> CMS transactions through Payload adapter request sessions
```

Medusa and Payload are backend/runtime harnesses over FlarexDB. They must not
introduce separate physical databases, separate storage engines, or separate
database designs that compete with FlarexDB.

The allowed framework-specific pieces are metadata and generated adapter
manifests:

```text
Medusa
  -> reserved Flarex namespace compiled from Medusa DML/module metadata
  -> generated Medusa-to-Flarex persistence mapping
  -> generated internal Medusa Link compatibility for original module links
  -> adapter implements Medusa repository/session contracts

Payload
  -> CMS metadata on Flarex app tables and fields
  -> generated Payload config
  -> generated Payload-to-Flarex field and relation mapping
  -> adapter implements Payload database/session contracts
```

That is still one FlarexDB design: typed app rows, derived relation/upload
edges, declared indexes, unique constraints, commit protocol, outbox,
freshness, migrations, and tenant/deployment scope. Medusa and Payload may
project their semantics onto that design, but they should not fork the data
plane.

## BaaS Product Scope

The product thesis is sound:

```text
self-hosted Convex-like application backend
  + Payload-powered CMS semantics
  + Medusa-powered commerce semantics
  + one FlarexDB data plane
```

This can cover a large class of normal application work: content sites, stores,
marketplaces, SaaS dashboards, internal tools, memberships, creator commerce,
booking flows, catalogs, and admin-heavy business apps.

It should not claim to solve every software category. Banking-grade ledgers,
complex ERP, low-latency multiplayer games, heavy analytics, regulated
healthcare workflows, hard multi-region consistency, and deeply specialized
warehouse or industrial systems may need dedicated architectures.

The difference between a good BaaS and an overcomplicated framework is what the
developer sees.

Good developer surface:

```text
one developer schema
  -> Flarex schema

one app DB API
  -> ctx.db

one commerce API
  -> ctx.commerce

one CMS marker system
  -> .cms()

generated internals
  -> Payload config and adapter manifest
  -> Medusa persistence/link/query compatibility manifest
```

Bad developer surface:

```text
define Flarex table
then define Payload collection
then define Medusa custom link
then define SQL migration
then define sync projection API
then decide which transaction model owns the write
```

The platform should hide Payload and Medusa internals behind generated
adapters. Payload and Medusa can be powerful backend harnesses, but the app
developer should mostly experience Flarex schema, `ctx.db`, `ctx.commerce`,
and CMS markers.

### MVP Scope

The first product slice should be deliberately narrow:

1. Flarex app schema and realtime database.
2. Payload-generated CMS for CMS-marked Flarex app tables.
3. Commerce entity references from Flarex app data, such as product pickers.
4. `ctx.commerce` for real commerce actions and commerce-affecting behavior.
5. Medusa internal tables, links, workflows, and invariants hidden behind the
   Medusa adapter.

Do not start by supporting every Payload field edge case, every Medusa
extension point, every cross-schema relation, and every possible global
transaction. The product becomes valuable when the common path is seamless.

## Medusa Link Is Internal Compatibility

Flarex developers should not get a public custom Medusa Link API.

Application developers should describe relationships only in Flarex schema:

```ts
const posts = defineTable("posts", {
  title: v.string(),
  product: v.relation.one(commerce.product).cms(),
})
```

That relationship is a Flarex relation edge. Payload can use it. Flarex app
queries can use it. Medusa does not see it by default, and it should not be
compiled into a Medusa Module Link just because it points at a commerce entity.

Medusa Link semantics are still required internally for unchanged Medusa
behavior:

```text
existing Medusa module links
  -> product <-> sales channel
  -> product variant <-> price set
  -> product variant <-> inventory item
  -> cart <-> payment collection
  -> order <-> fulfillment

Medusa Query and Index
  -> use joiner/link metadata to traverse existing Medusa module boundaries

Medusa workflows
  -> may create, dismiss, or query links through existing Medusa services
```

The Flarex-backed Medusa adapter should therefore generate or emulate Medusa
Link metadata from Medusa's own module/link definitions in a reserved internal
namespace. It should not expose `defineLink`, `.medusaLink(...)`, or
`.commerceLink(...)` as general Flarex app schema features.

Default rule:

```text
Flarex app relation to commerce entity
  -> Flarex relation edge
  -> visible to Flarex app code and Payload according to schema/write policy
  -> invisible to Medusa services, workflows, Query, and Index by default

Original Medusa module relation/link
  -> generated internal Medusa compatibility link
  -> reserved Flarex namespace
  -> visible only through Medusa services, workflows, Query, and Index
```

If a future product requirement truly needs Medusa to traverse custom app data,
add a narrow platform-managed internal read model later. Do not start with a
general public custom-link or projection layer; it would force app developers to
reason about Flarex schema, Payload config, Medusa Link schema, and sync read
models at the same time.

## Payload CMS Over Flarex App Schema

Payload should not create a second app database or own a separate physical
schema for CMS collections. In the proposed model, the Flarex app schema is the
source of truth and Payload config is a generated runtime artifact.

```text
Flarex defineTable
  -> source of truth schema, indexes, migrations, tenant/deployment scope

Generated Payload config
  -> CMS view of selected Flarex tables and fields
  -> Payload collections, globals, fields, auth, upload, version, draft config

Payload runtime
  -> CMS logic engine
  -> validation, access control, hooks, field behavior, REST/local API shape

@payloadcms/db-flarex
  -> maps Payload adapter operations to Flarex storage primitives
  -> preserves request transaction sessions
  -> never owns the physical app schema
```

Rule:

```text
Payload owns CMS semantics. Flarex owns the data plane.
```

Payload can decide what a CMS operation means. Flarex decides how data is
stored, indexed, isolated, versioned, migrated, committed, and synchronized.

### Marking Flarex Tables As CMS Collections

A Flarex developer should mark CMS behavior directly on the Flarex schema,
not author a separate Payload schema by hand.

```ts
export default defineSchema({
  users: defineTable({
    name: v.string().cms({ type: "text", required: true }),
    email: v.string().index("by_email").cms({
      type: "email",
      required: true,
      unique: true,
    }),
  }).cms({
    collection: true,
    auth: true,
    admin: { useAsTitle: "email" },
  }),

  posts: defineTable({
    title: v.string().cms({ type: "text", required: true }),
    slug: v.string().index("by_slug").cms({
      type: "text",
      required: true,
      unique: true,
    }),
    status: v.string().cms({
      type: "select",
      options: ["draft", "published"],
    }),
    authorId: v.id("users").cms({
      type: "relationship",
      relationTo: "users",
    }),
    content: v.json().cms({ type: "richText" }),
  }).cms({
    collection: true,
    versions: { drafts: true },
    admin: { useAsTitle: "title" },
  }),
})
```

The compiler should emit three artifacts:

1. Flarex storage schema and migrations.
2. Generated Payload config.
3. Payload-to-Flarex mapping manifest for the database adapter.

### Payload Field Mapping

Payload's field system is broad, but it can fit this storage design if Flarex
does not force every field into one flat document shape.

| Payload field family | Flarex representation |
| --- | --- |
| `text`, `textarea`, `email`, `code`, `checkbox`, `date`, `number`, `radio`, single `select` | Embedded in row JSON; extract declared indexes/unique keys into sidecars. |
| `json`, `richText` | Embedded JSON first; optional declared subpath indexes/search read models for queried paths. |
| Named `group` and named `tab` | Embedded nested JSON object with stable field-path metadata. |
| `array` | Embedded ordered JSON array by default; sidecar indexes/edges only for declared queryable subfields or refs. |
| `blocks` | Embedded ordered JSON array with `blockType` by default; optional block metadata and declared subfield sidecars. |
| `relationship` | Embedded Payload relationship shape plus derived edge sidecars, including polymorphic relation metadata. |
| `upload` | Embedded relationship shape plus derived edge to upload/media collection and fixed upload system metadata. |
| `text`, `number`, or `select` with `hasMany` | Embedded multi-value array; sidecar indexes only for declared filters/sorts/uniqueness. |
| Localized fields | Embedded locale-keyed JSON; locale included in index/edge/unique sidecars. |
| `join` | Virtual/query-only reverse relation resolved by edge sidecars and indexes. |
| `point` | Embedded point value; advanced geospatial queries require a dedicated index. |
| `row`, `collapsible`, unnamed layout tabs, and `ui` | Presentational config only; no stored field unless nested data fields exist. |
| Payload auth/system fields | Generated hidden Payload system rows/fields for email/username, password hash/salt, reset tokens, API key indexes, verification, sessions, locks, and login attempts. |

This means all Payload field families can be represented, but not all should be
represented as simple columns. Arrays, blocks, localized content, polymorphic
relationships, uploads, and joins need first-class Flarex storage patterns.

### Payload Complex Field Storage Rules

The Payload adapter cannot treat every CMS field as a flat Flarex attr. Payload
itself distinguishes simple fields from complex fields in its SQL adapters:
arrays and blocks need order and identity, relationships need population and
reverse lookup, localized values need locale-aware query behavior, and versions
use separate version records. Flarex should preserve those semantics without
forcing the default physical representation to become one SQL row or one EAV
triple per nested value.

Required Flarex primitives for Payload:

```text
authoritative row JSON
  -> CMS collection row

declared scalar index sidecar
  -> indexed scalar field, localized scalar field, sortable field

optional block metadata sidecar
  -> block type, block id, field path, order, optional locale

typed relation edge
  -> relationship, upload reference, app relation

polymorphic relation edge
  -> relationship/upload where relationTo is multiple collections
  -> target collection discriminator plus target id

locale-scoped row value plus sidecars
  -> localized fields, localized arrays, localized blocks, localized relations

hidden system table
  -> versions, drafts, auth state, sessions, upload metadata, document locks

virtual reverse relation
  -> Payload join field
  -> no stored field value; resolved from relation indexes

internal read model/search index
  -> admin search, deep filters, expensive nested browse paths
```

The compiler should choose the representation from the field's semantics:

| Payload feature | Preferred Flarex representation |
| --- | --- |
| Simple scalar fields | Row JSON plus declared index/unique sidecars when needed. |
| `json` / `richText` | Embedded JSON first; extracted indexes only for queried subpaths. |
| `group` / named `tab` | Stable nested field paths inside row JSON. |
| `array` | Embedded ordered JSON array by default; optional v2 child rows only for block/array-level editing at scale. |
| `blocks` | Embedded ordered JSON array with `blockType`; derived block metadata and declared subfield sidecars when needed. |
| `relationship` has-one | Embedded Payload relationship shape plus derived edge sidecar. |
| `relationship` has-many | Embedded ordered/unordered relationship values plus derived edge sidecars. |
| Polymorphic relationship | Relation edge with target collection discriminator. |
| `upload` | Relation edge to upload collection plus file/storage metadata. |
| `join` | Virtual reverse relation resolved by relation indexes; no stored field value. |
| Localized field | Locale-keyed row JSON with locale in derived index/edge/unique sidecars. |
| Drafts and versions | Fixed Payload version/draft system rows linked to the parent row. |
| Auth/session fields | Fixed Payload system rows, not normal app fields. |
| Document locks | Hidden Payload lock/system store, separate from Medusa locks. |

JSON is allowed, but it should be an explicit choice:

- Use JSON for rich text, opaque editor payloads, plugin data, or content that
  is usually fetched as a whole.
- Do not use only JSON for fields that need Payload admin filtering, relationship
  population, localized merging, ordered row updates, reverse joins, drafts, or
  version diff behavior.
- Allow extracted indexes or projections over JSON subpaths later, but do not
  make async projections the source of truth for CMS validation.

This keeps the Flarex source of truth compatible with Payload without copying
Payload's SQL table design one-for-one.

### Type-Safe Relationship Schema

Payload's relationship field supports has-one, has-many, polymorphic has-one,
and polymorphic has-many shapes. Payload config expresses those with
`relationTo` strings or arrays and a `hasMany` boolean. Flarex should expose a
more familiar type-safe developer API and compile down to Payload's shape.

Use relation builders that read like Drizzle or Payload concepts without
copying Payload's stringly typed config:

```ts
v.relation.one(table)      // one target collection, one value
v.relation.many(table)     // one target collection, many values
v.relation.oneOf(map)      // many possible target collections, one value
v.relation.manyOf(map)     // many possible target collections, many values
```

Example:

```ts
const users = defineTable("users", {
  name: v.string(),
  email: v.string().unique(),
}).cmsCollection({ auth: true })

const organizations = defineTable("organizations", {
  name: v.string(),
}).cmsCollection()

const categories = defineTable("categories", {
  title: v.string(),
}).cmsCollection()

const posts = defineTable("posts", {
  title: v.string(),

  author: v.relation.one(users)
    .required()
    .cms(),

  categories: v.relation.many(categories)
    .ordered()
    .min(1)
    .cms({ admin: { sortable: true } }),

  owner: v.relation.oneOf({
    user: users,
    organization: organizations,
  }).cms(),

  related: v.relation.manyOf({
    user: users,
    organization: organizations,
  }).ordered().cms(),
}).cmsCollection({
  admin: { useAsTitle: "title" },
})
```

The compiler infers the Payload relationship config:

| Flarex schema | Generated Payload config |
| --- | --- |
| `v.relation.one(users)` | `type: "relationship"`, `relationTo: "users"`, `hasMany: false` |
| `v.relation.many(users)` | `type: "relationship"`, `relationTo: "users"`, `hasMany: true` |
| `v.relation.oneOf({ user, organization })` | `type: "relationship"`, `relationTo: ["users", "organizations"]`, `hasMany: false` |
| `v.relation.manyOf({ user, organization })` | `type: "relationship"`, `relationTo: ["users", "organizations"]`, `hasMany: true` |

Relation modifiers should compile to both Payload config and Flarex storage
metadata:

| Flarex modifier | Meaning |
| --- | --- |
| `.required()` | Payload `required`; Flarex non-null relation constraint. |
| `.index()` | Payload `index`; Flarex relation lookup index. |
| `.unique()` | Payload `unique`; only valid for has-one relations unless a scoped uniqueness rule is declared. |
| `.localized()` | Payload `localized`; locale-scoped relation edges. |
| `.ordered()` | Stable link-row ordering; Payload sortable admin support for has-many relations. |
| `.min(n)` / `.max(n)` | Payload `minRows` / `maxRows`; Flarex cardinality validation. |
| `.cms({ maxDepth })` | Payload `maxDepth`; Flarex population/query planning hint. |

Inferred document types should preserve target identity:

```ts
type Post = InferDoc<typeof posts>

type PostOwner =
  | { type: "user"; id: Id<typeof users> }
  | { type: "organization"; id: Id<typeof organizations> }
```

Populated reads should be typed separately from stored relation values:

```ts
const post = await ctx.db.get(posts, postId, {
  include: {
    author: true,
    categories: true,
    owner: true,
  },
})
```

The result type can then infer:

```ts
{
  author: Doc<typeof users>
  categories: Array<Doc<typeof categories>>
  owner:
    | { type: "user"; doc: Doc<typeof users> }
    | { type: "organization"; doc: Doc<typeof organizations> }
}
```

Storage should use relation-aware primitives instead of opaque JSON:

```text
single target has-one
  -> source table, source id, field, target table, target id

polymorphic has-one
  -> source table, source id, field, target discriminator, target id

has-many
  -> relation edge rows with source, field, target, and optional position

polymorphic has-many
  -> relation edge rows with source, field, target discriminator, target id,
     and optional position
```

This gives Payload its expected request and response shapes while Flarex keeps
typed IDs, relation indexes, reverse traversal, cardinality checks, ordered
links, and query planning.

### Reverse Relations And Joins

Payload's normal relationship field is one-way. Bidirectional authoring uses
the Join field. Flarex should model this explicitly with virtual reverse
relations:

```ts
const posts = defineTable("posts", {
  category: v.relation.one(categories)
    .inverse("posts")
    .cms(),
})

const categories = defineTable("categories", {
  posts: v.relation.back(posts, "category")
    .cmsJoin(),
})
```

`v.relation.back(...)` stores no field value. It compiles to Payload `join`
metadata and resolves from Flarex relation indexes. This prevents duplicate
write paths for the same relationship while still giving Payload the
bidirectional CMS authoring experience.

### Payload Adapter Transactions

Payload database adapters expose request-scoped transactions. A Flarex adapter
should map those to Flarex storage sessions:

```text
Payload operation
  -> beginTransaction(req)
  -> validation, access, hooks, field transforms
  -> create/find/update/delete through @payloadcms/db-flarex
  -> Flarex storage session stages row JSON, index sidecars, edge sidecars,
     unique keys, Payload system rows, versions, uploads
  -> commitTransaction(req)
  -> Flarex commit protocol writes revisions, indexes, outbox, invalidations
```

The Payload adapter must preserve Payload's lifecycle order while delegating
transaction authority to Flarex. Payload hooks can decide what to write, but
Flarex performs schema validation, OCC or transactional conflict handling,
index updates, commit logging, and sync invalidation.

### CMS-Marked Data And Direct Writes

Sharing the same Flarex app table does not mean every write path has the same
semantics.

If a table or field is CMS-managed, the schema should declare its write policy:

```text
payload-only
  -> writes must go through Payload local API, REST API, or generated CMS facade
  -> required for auth, uploads, versions, drafts, hooks, and access behavior

shared
  -> direct ctx.db writes are allowed
  -> only safe for simple content where Payload lifecycle side effects are not
     required
```

The default should be conservative: CMS-managed collections that enable auth,
uploads, drafts, versions, or write hooks should be `payload-only`. Otherwise a
Flarex mutation could update the same rows while bypassing Payload validation,
hook order, access checks, version snapshots, draft status, upload cleanup, or
session state.

### Payload Support Levels

Implement Payload support in levels instead of claiming full parity on day one.

1. CMS scalar collections: text-like fields, numbers, booleans, dates, JSON,
   rich text as JSON, basic indexes, unique constraints, access, and hooks.
2. Content structures: groups, tabs, arrays, blocks, localized fields, and
   drafts/versions.
3. Relation-rich CMS: relationships, uploads, polymorphic relations, auth
   generated fields, sessions, and reverse joins.
4. Advanced query parity: geospatial point indexes, complex localized relation
   filters, deeply queried blocks, full version/draft edge cases, and admin
   query performance tuning.

## Transaction Model

The agreed transaction model has four different surfaces. They may share a
physical database transaction underneath in some deployment modes, but they
should not be exposed as one universal developer transaction API.

```text
Flarex app transaction
  -> custom application rows, row JSON, edge sidecars, index sidecars, and
     unique keys
  -> includes tables and fields that are marked CMS-managed
  -> Instant-inspired tx steps over Flarex row/sidecar operations
  -> Flarex OCC/read-set validation, commit log, outbox, and sync freshness

Payload CMS transaction
  -> CMS-marked Flarex app tables and fields
  -> Payload collection/global operation lifecycle
  -> generated Payload config and adapter mapping manifest
  -> hidden behind @payloadcms/db-flarex

Medusa persistence transaction
  -> Medusa reserved schema or namespace
  -> existing Medusa RepositoryContext and DatabaseSession contracts
  -> hidden behind a Flarex-backed Medusa persistence adapter

Workflow and locking transaction
  -> reserved system stores or provider state
  -> workflow execution, delayed actions, leases, locks, and recovery metadata
```

These surfaces sit above two lower-level guarantees:

```text
Postgres or executor transaction
  -> physical atomicity for rows written by one commit
  -> BEGIN / COMMIT / ROLLBACK, or the equivalent executor primitive

Flarex commit protocol
  -> logical app/database consistency
  -> commit timestamp allocation
  -> document, table, index, and relation read-set validation
  -> schema and constraint validation
  -> document/entity revisions, relation edges, index entries
  -> commit record, outbox event, freshness, and sync invalidation
```

The public `ctx.db.transact(...)` API should not replace either layer. It is
the developer-facing way to stage one logical Flarex commit. The executor
transaction remains the physical atomicity layer, and the Flarex commit
protocol remains the consistency and invalidation layer.

### Flarex App Transactions

For developer-owned application data, Flarex can expose an InstantDB-like
transaction shape:

```ts
await ctx.db.transact([
  ctx.db.tx.wishlists[wishlistId].update({ name: "Summer" }),
  ctx.db.tx.wishlistItems[itemId].link({ productId }),
])
```

Internally, this should still use the current Flarex/Convex-style commit model
and executor transaction. The API is explicit, but the authority stays below
it:

```text
ctx.db.transact([...])
  -> create or reuse invoke session
  -> record document/entity reads
  -> record table, index, relation, or range reads
  -> stage document/entity attr writes and relation edge writes
  -> commitInvokeSessionWrites or successor commit entrypoint
       allocate commit timestamp
       validate read-set and OCC conflicts
       validate schema and constraints
       open executor transaction
       write revisions, entities, relation edges, and index entries
       write commit record
       write outbox and invalidation events
       finish invoke session
       commit executor transaction
  -> subscribed queries rerun from freshness/dependency tokens
```

This differs from a plain SQL transaction. The SQL transaction gives atomic
storage writes. The Flarex commit protocol gives deterministic reactive app
semantics, conflict detection, commit ordering, and sync invalidation.

InstantDB's `transact` model is still a useful API reference. The borrowed idea
is a declarative list of tx steps such as add, update, link, unlink, merge, or
delete. The part Flarex should keep from its existing core is read-set
validation, commit timestamps, revision history, outbox, and freshness
tracking.

The nesting rule should be:

```text
inside a mutation
  -> ctx.db.transact joins the current invoke session and stages one commit

outside a mutation or inside a short-lived app API call
  -> ctx.db.transact creates a short-lived invoke session, stages steps,
     commits, and closes the session

inside Payload or Medusa adapters
  -> use the adapter transaction/session boundary
  -> do not expose public app ctx.db.transact as the internal adapter API
```

If the schema adds first-class relations, the commit protocol should add
relation-edge staging and validation. It should not introduce a second
transaction engine.

### Bounded User Code And Transaction Limits

Flarex should adopt a bounded mutation model similar to Convex because the
storage design depends on short deterministic transaction phases.

Convex's current production limits document records these reference limits:

```text
query / mutation execution time
  -> 1 second of user code
  -> database operations are not counted in that user-code time

action execution time
  -> 10 minutes

per query/mutation transaction limits
  -> 16 MiB data read
  -> 16 MiB data written
  -> 32,000 documents scanned
  -> 4,096 index ranges read
  -> 16,000 documents written
```

Reference checked: <https://docs.convex.dev/production/state/limits>.

Flarex does not have to copy every number exactly, but it should copy the
shape:

```text
mutation / ctx.db.transact
  -> short deterministic user code
  -> app and Medusa DB-local reads/writes
  -> OCC/read-set recording
  -> schema, constraint, and write-policy validation
  -> outbox enqueue
  -> no long external side effects

action / workflow / job
  -> long-running work
  -> external APIs
  -> AI calls
  -> webhooks, email, payment, shipping, retries
  -> commits results through short mutations
```

This matters because an open Flarex transaction is holding staged writes, read
sets, event groups, workflow context, possible locks, and transaction/session
leases. Long-running user code increases conflict rates, extends lock
duration, makes crash recovery harder, and can produce external side effects
that cannot be rolled back if the final commit fails.

The proposed Flarex runtime rule:

```text
ctx.db mutation user code budget
  -> small hard limit, Convex-like, measured outside storage waits where
     practical

ctx.db.transact callback
  -> joins the current mutation budget or receives an even smaller nested
     budget

tx.commerce.* inside ctx.db.transact
  -> allowed only for Medusa DB-local workflow phases that can join the Flarex
     transaction and defer event release

long work
  -> schedule an action/workflow/job through the outbox and return
```

Operationally, Flarex should enforce:

- maximum user-code time per mutation;
- maximum transaction wall-clock lease;
- maximum read bytes and write bytes;
- maximum rows/documents scanned;
- maximum rows/documents written;
- maximum index/range reads;
- maximum queued outbox events from one transaction;
- clear errors that tell developers to move long work into actions or
  workflows.

This keeps the database layer predictable:

```text
short transaction
  -> low lock time
  -> bounded OCC read set
  -> bounded retry cost
  -> reliable event/outbox release
  -> easier crash recovery

long work
  -> durable workflow/action
  -> explicit retries
  -> idempotent follow-up mutations
```

### Medusa Transactions

Medusa must not call public `ctx.db.transact` for internal commerce state.

Medusa should continue to see its existing transaction boundary:

```text
Medusa service or workflow
  -> Medusa transaction manager
  -> RepositoryContext / DatabaseSession
  -> module repositories
  -> Flarex-backed Medusa persistence adapter
  -> Medusa reserved namespace in Flarex storage
```

The adapter may translate Medusa repository operations into the same underlying
entity, attribute, link, index, commit, and outbox storage primitives. That
translation is private to the Medusa adapter. It must preserve Medusa rollback,
read-your-own-writes, nested transaction propagation, event/mutation sink
behavior, and unchanged module integration assertions.

Conceptually:

```ts
class FlarexMedusaDatabaseSession {
  transaction<T>(
    operation: (session: FlarexMedusaDatabaseSession) => Promise<T>
  ): Promise<T> {
    // Reuse an existing transaction/session when nested.
    // Otherwise open a Flarex storage transaction.
    // Expose only Medusa repository/session behavior upward.
  }
}
```

### Mixed App And Commerce Mutations

The two-storage-shape model can support atomic app-and-commerce writes only if
FlarexDB remains the single commit authority across both shapes.

The shared transaction session must be able to stage and validate:

```text
app/Payload row-and-sidecar writes
  -> row JSON revisions/current rows
  -> declared index and unique-key sidecars
  -> relation/upload edge sidecars
  -> optional block metadata sidecars

Medusa system relational writes
  -> generated DML rows
  -> generated link/pivot rows
  -> Medusa indexes and constraints

shared commit protocol
  -> app entity/attr/relation read sets
  -> Medusa row read sets
  -> Medusa query/index/range read sets
  -> constraint validation
  -> commit log
  -> outbox/freshness/live-query invalidation
```

That gives a real path for cross-shape conflict detection:

```text
app mutation reads product product_123 at version 20
Medusa workflow updates product product_123 at version 21
app mutation attempts to commit
FlarexDB validates the Medusa row read set
commit conflicts or retries instead of using stale commerce data
```

However, this is not permission for app code to mutate Medusa tables directly.

```text
ctx.db only
  -> Flarex app transaction

ctx.commerce only
  -> Medusa service transaction or Medusa workflow

ctx.db + ctx.commerce in an explicit FlarexDB transaction
  -> one shared FlarexDB commit session
  -> app writes use shared Flarex app storage
  -> commerce writes use Medusa-owned commands, workflows, repositories, and
     adapter semantics
  -> app code still cannot write system.medusa tables directly
```

If extension behavior must be atomic with commerce invariants, it belongs
behind a Medusa-owned commerce facade, command, or workflow that can join the
shared FlarexDB transaction session:

```ts
await ctx.db.transact(async (tx) => {
  const post = await tx.insert(posts, { title: "Drop" })
  const product = await tx.commerce.products.create({
    title: "Drop product",
    handle: "drop-product",
  })

  await tx.insert(postProducts, {
    postId: post.id,
    productId: product.id,
  })
})
```

Internally, `tx.commerce.products.create(...)` must run Medusa validation,
workflow/repository logic, mutation events, and constraints. It is not a raw row
insert into `system.medusa`.

So the rule is:

- Atomic app plus commerce writes are allowed through explicit FlarexDB
  transaction sessions.
- The commerce part must be expressed as a Medusa-owned command or workflow.
- App code cannot directly mutate Medusa reserved tables.
- Arbitrary calls to unrelated external commerce APIs are not automatically
  atomic; they need workflows, compensation, or outbox/event consistency.
- Display-only metadata can stay in app graph data and connect through typed
  commerce IDs, dependency tokens, and outbox events.

### Medusa Workflow Boundary Inside Flarex Transactions

Existing Medusa workflows should stay Medusa-owned. The Flarex integration
should not fork or rewrite `create-products`, cart completion, order, inventory,
or pricing workflows as Flarex workflows.

The refactor point is the workflow execution boundary:

```text
ctx.db.transact(...)
  -> creates one FlarexDB transaction/session
  -> tx.commerce.products.create(...)
  -> runs the existing Medusa create-products workflow or command path
  -> injects Flarex-backed Medusa transactionManager/session
  -> injects Flarex eventGroupId
  -> sets preventReleaseEvents while the outer Flarex commit is open
  -> Medusa services/repositories reuse the Flarex transaction session
  -> Medusa workflow finishes logically
  -> Flarex validates OCC, constraints, locks, and read sets
  -> Flarex commits or rolls back both app and commerce writes
  -> Flarex releases or clears grouped Medusa events after the outer decision
```

This uses Medusa's existing shape:

- module services already accept a shared transaction context;
- nested service methods should reuse an existing transaction manager instead
  of opening independent transactions;
- workflow event grouping can prevent event release until a higher-level owner
  releases the group.

The Flarex adapter/runtime must make those abstractions point to FlarexDB:

```text
Medusa transactionManager
  -> FlarexDB shared transaction/session

Medusa eventGroupId
  -> FlarexDB transaction event group or outbox group

Medusa workflow success
  -> logical workflow completion only

FlarexDB commit success
  -> durable data commit and event release authority
```

Therefore, the target is not:

```text
Medusa workflow commits product independently
Flarex app write commits later
```

The target is:

```text
Medusa workflow stages commerce writes in the Flarex session
Flarex app code stages app writes in the same session
one FlarexDB commit publishes both or neither
```

If a Medusa workflow contains external side effects that cannot be rolled back,
such as webhooks, email, payment capture, shipping calls, or arbitrary user
plugin code, those effects must not execute inside the uncommitted atomic
phase. They must be post-commit outbox work, compensating workflow work, or a
separate orchestration step.

### Failure And Recovery Rules

The shared transaction design is safe only if FlarexDB remains the single commit
authority when commerce runs inside `ctx.db.transact`.

Required failure behavior:

```text
server dies before Flarex commit
  -> physical transaction rolls back or staged session expires
  -> Medusa grouped events are not released
  -> workflow transaction is cancelled, reverted, or recovered as failed

server dies after Medusa workflow returns but before Flarex commit
  -> no Flarex commit record exists
  -> app writes and Medusa reserved-table writes are not visible
  -> grouped events/outbox entries remain unreleased or are cleared by recovery

server dies after Flarex commit but before event delivery
  -> commit record and outbox rows exist
  -> recovery replays the outbox idempotently
  -> product.created may arrive late, but it must not disappear

OCC or constraint conflict at final commit
  -> app writes and Medusa writes abort together
  -> grouped Medusa events are cleared
  -> caller can retry the whole transaction

external subscriber fails after commit
  -> committed data remains valid
  -> outbox retries or dead-letter handling owns delivery failure
```

The invalid state to prevent is:

```text
Medusa product committed
Flarex app relation failed
product.created already delivered
```

That state is only prevented if Medusa repositories, workflow storage, grouped
events, and outbox writes all participate in the Flarex-owned transaction or
are explicitly deferred until after the Flarex commit record exists.

Deadlock and long-running workflow rules:

- Acquire commerce locks late, close to the atomic write phase.
- Sort multi-key locks deterministically.
- Do not hold commerce locks while arbitrary app code or external calls run.
- Do not open nested independent database transactions inside a shared Flarex
  transaction.
- Use transaction leases, timeouts, and recovery for abandoned sessions.
- Use idempotency keys for workflow steps, commit records, and event delivery.
- Treat async projections, internal read models, and search indexes as derived
  infrastructure, not authoritative validation sources.

If a built-in Medusa workflow cannot obey these rules in a given path, Flarex
should not allow that path inside `ctx.db.transact`. It should run as a normal
Medusa workflow and connect app data through an idempotent follow-up command,
hook, or outbox subscriber.

### Worker And Hyperdrive Commit Executor

The preferred Cloudflare deployment shape is:

```text
Dynamic Worker
  -> runs untrusted user code
  -> exposes restricted ctx.db / ctx.commerce / ctx.cms APIs
  -> records read dependencies, predicates, and write intent
  -> does not receive raw Postgres or Hyperdrive access
  -> does not hold a SQL transaction open

FlarexDB executor Worker
  -> trusted internal platform service
  -> uses Hyperdrive or another Flarex-selected physical executor
  -> opens the final SQL transaction only after user code finishes
  -> validates OCC read sets, ranges, constraints, and locks
  -> applies app, Payload, Medusa, workflow, freshness, and outbox writes
  -> commits or aborts as the single authority

Postgres
  -> authoritative physical store for the Hyperdrive-backed deployment shape
```

Hyperdrive can replace a Node-side Postgres executor as the Worker transport,
but it must not become the consistency model. FlarexDB remains responsible for
OCC, transaction sessions, commit records, outbox rows, freshness markers,
schema scope, tenant scope, and adapter write policies.

Correctness paths must use no-cache or cache-disabled database access:

- mutation reads;
- read-your-write reads;
- OCC document, row, edge, range, and predicate validation;
- Medusa workflow and repository reads inside the atomic phase;
- Payload request-transaction reads;
- live-query reruns that claim freshness;
- commit, lock, outbox, and workflow-state reads.

Hyperdrive query caching can be used for ordinary one-shot reads only when the
caller accepts possible staleness. It must not be used as proof that a live
query, OCC validation, or commerce invariant is fresh.

The transaction-pooling rule is:

```text
run user code
record reads and write intent
finish user code

BEGIN
validate read sets, ranges, constraints, and locks
apply authoritative writes
write commit log, freshness markers, workflow state, and outbox rows
COMMIT
```

The SQL transaction should be short because it starts after user code has
finished. It should not include arbitrary JavaScript, remote APIs, event
delivery, live-query reruns, cache updates, search updates, optional
read-model rebuilds, email, webhook delivery, payment calls, or shipping calls.

### Live Sync DO Topology And Direct Wake

The new FlarexDB design should simplify the executor outbox and live-sync
runtime, but it should not collapse WebSocket ownership into the same object
that performs all sync work.

Cloudflare Durable Object WebSocket hibernation changes the right split:

- Hibernating WebSockets can remain connected while the Durable Object sleeps.
- Cloudflare permits many WebSockets per Durable Object, but CPU and memory
  usage lower the practical ceiling for real workloads.
- A Durable Object invocation still has a bounded CPU budget, so heavy query
  reruns, optional read-model work, and fanout should not share one hot object
  with a large WebSocket set.
- Outbound WebSockets and always-running timers prevent the same hibernation
  behavior, so the WebSocket-facing object should stay simple.

The foundation split should therefore be:

```text
ConnectionDO
  -> owns browser WebSocket connections
  -> uses WebSocket Hibernation
  -> stores connection-local subscription state or references
  -> receives changed query results from DeploymentSyncDO
  -> sends protocol transitions to clients

DeploymentSyncDO
  -> owns deployment commit/outbox drain cursor
  -> owns a hot in-memory write-log window
  -> owns in-memory read-set indexes for active live queries
  -> owns freshness mirror state needed for live sync and recovery
  -> maps compact commit summaries to affected subscriptions
  -> coalesces and deduplicates reruns for the same query
  -> invokes query runtime/executor for affected live queries
  -> sends changed results to the right ConnectionDOs

FlarexDB executor Worker
  -> commits authoritative data and outbox rows
  -> directly wakes DeploymentSyncDO after commit with a compact commit summary
```

Do not start with this larger split:

```text
ConnectionDO
SyncDO
QueryDO
ProjectionDO
DeliveryDO
```

That creates too many coordination edges and recovery cases before the product
has measured pressure. Add those objects later only when a bottleneck appears:

- `QueryDO` when many users share the same expensive query and rerun dedupe is
  a proven bottleneck;
- `DeliveryDO` when fanout is too large for direct `ConnectionDO` delivery or
  delivery needs a separate retry/dead-letter lifecycle;
- read-model workers or queues when optional read-model rebuilds are too
  expensive for the sync drain loop;
- sharded `ConnectionDO`s when one deployment has too many active WebSockets for
  one object to handle comfortably.

This means the normalized query-shape cache discussed for lists such as
`product.list({ status: "published", orderBy: "createdAt", limit: 1000 })` is
not part of the v1 foundation. It is a later optimization if Postgres reruns
and `DeploymentSyncDO` coalescing become a measured bottleneck.

Future query-cache optimization shape:

```text
client query
  -> normal Flarex query endpoint
  -> route to QueryShardDO(queryShapeHash) only when enabled by the planner
  -> if warm, return cached result chunks
  -> if cold or dirty, query Postgres/FlarexDB through the executor
  -> store bounded result ids, selected fields, result hash, read set, cursor
```

The cache key should be a normalized logical query shape plus arguments, not a
developer-authored cache name:

```text
table/products
where tenant/scope, status, category, declared filters
order createdAt desc
limit 1000
select id,title,handle,status,createdAt
schema version and auth/scope boundary
```

Do not expose this as `.live()`, `.cache()`, or a public projection API. The
developer writes normal queries. The compiler/runtime may classify a query as
cacheable, refresh-on-change, or one-shot internally. Coarse invalidation is
the correctness baseline: if a commit changes fields that affect filter,
ordering, relation membership, authorization, or an unknown dependency, mark
the cached query dirty and refresh from Postgres/FlarexDB. Exact in-memory
patching is an optimization only for simple proven cases such as selected field
updates on rows already in the cached result.

The direct wake path is:

```text
FlarexDB final commit succeeds
  -> commit row and outbox rows are durable
  -> executor Worker calls DeploymentSyncDO.wakeCommit(deploymentId, commitTs, commitSummary)

DeploymentSyncDO
  -> appends commitSummary to its hot write-log window
  -> advances or verifies its durable outbox cursor
  -> updates freshness mirrors
  -> matches changed docs/rows/edges/index ranges against in-memory read-set maps
  -> coalesces affected queries to the latest useful commit version
  -> reruns affected queries
  -> hashes results and skips unchanged results
  -> forwards changed results to ConnectionDOs
```

This is the Convex-like part of the design. Convex gets low live-sync latency
because commit publication, write-log append, subscription invalidation, query
rerun, and client transition are one tight timestamped path. FlarexDB should
copy that shape with `DeploymentSyncDO` as the hot sync engine:

```text
commit summary
  -> changed document ids
  -> changed app entity/attr ids
  -> changed relation edge keys
  -> changed Medusa row ids and link row ids
  -> changed table ids
  -> changed index/range keys
  -> changed internal read-model dependency keys, if any
  -> write source, deployment/tenant scope, commit ts, outbox sequence

active read-set indexes in DeploymentSyncDO
  document id -> subscribed live queries
  row id -> subscribed live queries
  relation edge key -> subscribed live queries
  table id -> subscribed live queries
  index/range interval -> subscribed live queries
  internal read-model dependency key/version -> subscribed live queries
```

The commit summary must be compact enough to pass through the direct wake path
without forcing `DeploymentSyncDO` to rescan physical data after every commit.
When the summary is too large, the wake can pass a pointer to the durable commit
record and `DeploymentSyncDO` can load the exact summary from FlarexDB. That
fallback should still be a bounded summary read, not a generic table scan.

The durable recovery path is:

```text
direct wake fails, Worker crashes, or DeploymentSyncDO is evicted
  -> outbox rows still exist in FlarexDB
  -> DeploymentSyncDO alarm, cron, or maintenance route drains from cursor later
  -> idempotent consumers catch up
```

Therefore:

```text
durable outbox = recovery and ordering source
direct DO wake = fast path
Cloudflare Queue = optional scale/retry transport
REST callback = remote-executor compatibility adapter
```

For the new Worker/Hyperdrive executor path, local calls should replace
executor-to-backend REST callbacks wherever both sides live inside the same
Cloudflare deployment. The REST callback shape remains useful for a Node/VPS
executor, a remote regional executor, or external integration delivery.

### Live Query Read Flow And Internal Read Models

Live subscribers should not be forced through a public projection API. Query
planning should choose the best source that can prove freshness for the
requested query.

```text
simple point/document/row query
  -> read source FlarexDB app data, Payload-marked app data, or Medusa reserved
     table data directly

ordinary leaderboard/list/admin query
  -> prefer shared Flarex app storage with declared indexes, app edges,
     Medusa reserved tables, and Medusa/Payload fixed system tables

expensive list/search/admin/browse query
  -> planner may use an internal materialized read model only if it is fresh
     enough for the required commit version and query dependency set

internal read model missing or stale
  -> rerun from authoritative source data if practical
  -> or wait/retry until the internal read model catches up
```

Postgres changes the public API decision. The original projection idea was
mostly motivated by Cloudflare SQLite/Durable Object limits and cross-partition
read pressure. With Postgres/Hyperdrive as the durable data plane, many
leaderboards, admin lists, and browse queries should be declared-index,
relation-edge, or reserved-system-table queries. Do not expose
`ctx.db.projection(...)` as a primary developer API.

Internal read-model rows should live in Flarex-owned internal namespaces in the
same FlarexDB physical database by default. They can be moved to a
Flarex-managed projection database later if scale requires it, but they remain
derived data and must be rebuildable from shared app rows, app edges, Medusa
reserved tables, Payload system tables, commits, and outbox records.

Developer-facing query surface should stay simple:

```text
ctx.db.get(...)
ctx.db.query(...).withIndex(...).order(...).take(...)
ctx.db.relation(...)
ctx.db.transact(...)

not as the default public surface:
ctx.db.projection(...)
```

The live sync flow should be:

```text
1. Client subscribes
   Browser -> ConnectionDO

2. Initial query runs
   ConnectionDO or DeploymentSyncDO -> query runtime / executor
   query reads source data or a fresh-enough internal read model
   query records read dependencies:
     rows / relation edges / block metadata / declared index ranges /
     internal read-model
     version
   subscription metadata is stored for rerun and reconnect

3. Mutation commits
   Dynamic Worker runs user code
   FlarexDB executor validates OCC
   Postgres commit writes:
     authoritative source data
     relation/link rows
     commit row
     freshness/outbox rows

4. Fast wake
   Executor Worker -> DeploymentSyncDO.wakeCommit(...)

5. Sync drain
   DeploymentSyncDO drains outbox
   updates freshness mirror
   finds affected subscriptions from read dependencies
   reruns only affected queries

6. Delivery
   changed result -> ConnectionDO -> WebSocket transition to browser
   unchanged result -> update freshness/result cursor without sending data
```

Connection/session state can be persisted in FlarexDB or the `ConnectionDO`
storage where needed for reconnect, but the authoritative data and replayable
outbox remain in FlarexDB.

### Final Commit Planning And Round Trips

Current detailed roadmap: see
[`roadmaps/35-commit-compiler-and-session-intent.md`](../roadmaps/35-commit-compiler-and-session-intent.md).
That file owns the SessionDO intent journal, `beginTs`, read-your-writes
overlay, `CommitIntent`, and final Postgres round-trip strategy. This section
keeps the Medusa/Payload storage motivation.

The final commit must not be implemented as a generic ORM loop that performs one
awaited SQL statement per row or per Medusa entity.

Bad shape:

```text
BEGIN
select product version
select variant version
select inventory version
insert product
insert variant
insert price
insert inventory
insert link row
insert workflow state
insert outbox event
COMMIT
```

If each step is a separate Worker-to-database round trip, the Hyperdrive
transaction connection remains checked out for too long. Product, cart,
inventory, order, and pricing flows can touch many tables, so a naive adapter
would turn Medusa complexity into connection-pool pressure and avoidable
latency.

The FlarexDB executor should compile the whole commit intent before opening the
SQL transaction:

```text
commit intent
  -> classify app graph writes, Payload writes, Medusa system writes, locks,
     workflow writes, freshness writes, and outbox writes
  -> build set-based read/range/lock validation batches
  -> build bulk document/entity/row/edge/link write batches
  -> build commit/freshness/outbox/workflow-state batches
  -> execute as one short physical transaction
```

For simple app/Payload writes, the physical transaction should look closer to:

```text
BEGIN
validate app row, relation edge, block metadata, declared index, and range reads
  in set-based queries
bulk insert/update app row revisions/current rows, index sidecars, edge
  sidecars, unique keys, and optional block metadata
bulk insert commit, freshness, and outbox rows
COMMIT
```

For complex Medusa writes, the physical transaction should look closer to:

```text
BEGIN
validate commerce rows, link rows, uniqueness, locks, and range reads in
  set-based queries
bulk insert/update Product, Variant, Price, Inventory, Link, Workflow, and
  Idempotency rows
bulk insert commit, freshness, workflow-state, and outbox rows
COMMIT
```

Allowed optimizations:

- batch validation with `where in (...)`, joins, common table expressions, or
  generated validation tables;
- batch writes with multi-row `insert`, `insert ... on conflict`, `unnest(...)`,
  JSON-to-recordset, or generated CTEs;
- use deterministic lock ordering and set-based lock checks;
- compile Medusa DML write intent into a table-aware FlarexDB commit plan;
- keep the executor Worker close to the database with Worker placement when the
  commit needs multiple sequential SQL calls;
- for very complex commits, consider a database-side function such as
  `select flarexdb_commit($1::jsonb)` so validation and writes happen inside
  Postgres with one Worker-to-database call.

The database-side function option is an optimization boundary, not a new
authority. The FlarexDB commit protocol still owns the plan format, tenant
scope, schema version, OCC rules, write policies, outbox semantics, and adapter
contracts.

Implementation rules:

- Do not let Medusa services, Payload adapters, or app code emit arbitrary raw
  SQL during final commit.
- Do not call Medusa repository methods row-by-row inside the final physical
  transaction when the whole write set is already known.
- Do not deliver events, run subscribers, rerun live queries, update search, or
  rebuild projections inside the final physical transaction.
- Do record enough outbox/freshness/workflow data inside the transaction for
  post-commit workers to complete those jobs idempotently.
- Do keep a Node/Postgres adapter and a Worker/Hyperdrive adapter as separate
  physical executor implementations behind the same FlarexDB commit contract.

## Why Instant-Like Storage Helps

The current Convex-inspired Flarex document model is good for isolated app
documents, OCC validation, live queries, outbox events, and sync freshness.
Medusa needs more relational structure than plain documents provide.

InstantDB's core ideas are useful because they add:

- entity metadata;
- typed attributes;
- forward and reverse references;
- link traversal;
- transaction records;
- flexible schema per app or tenant;
- sync invalidation over a shared storage substrate.

Those capabilities map naturally to Medusa DML relations such as Product to
Variant, Product to Option, Product to Category, Variant to OptionValue, and
ProductCategory parent/child trees.

## Medusa DB Layers That Must Be Preserved

The current fork already has the right insertion point. Medusa behavior flows
through:

```text
API or workflow
  -> module service
  -> MedusaService / generated internal service
  -> repository contract
  -> selected persistence adapter
  -> transaction manager / database session
```

The Flarex-backed path must implement the same persistence boundary. It should
not introduce a parallel module-service hierarchy.

The minimum Medusa layer compatibility requirements are:

- DML model compilation into the selected storage backend.
- Internal Medusa Link compatibility generated from original Medusa link and
  joiner metadata, not from public Flarex app custom-link APIs.
- Repository methods for find, count, create, update, delete, soft delete,
  restore, upsert, serialization, and relation loading.
- Transaction propagation through existing Medusa context and decorators.
- Rollback and read-your-own-writes behavior.
- Mutation/event sink compatibility.
- Existing module integration assertions passing unchanged.

## Raw SQL And Custom Repository Escape Hatches

Some Medusa modules do not use only generated CRUD. They contain custom
repository or provider logic that currently reaches through MikroORM to Knex,
raw SQL, or database-specific execution primitives.

Known examples in this fork include:

- RBAC role hierarchy and cycle checks through recursive SQL in
  `packages/modules/rbac/src/repositories/rbac.ts`.
- Pricing rule and price selection logic in
  `packages/modules/pricing/src/repositories/pricing.ts`.
- Inventory level custom repository behavior in
  `packages/modules/inventory/src/repositories/inventory-level.ts`.
- Order custom find helpers in
  `packages/modules/order/src/utils/base-repository-find.ts`.
- Index module query builder, partition creation, data synchronization, and
  Postgres provider behavior under `packages/modules/index/src`.
- Postgres advisory locking in
  `packages/modules/providers/locking-postgres/src/services/advisory-lock.ts`.
- Historical SQL migration scripts that alter tables, copy rows, or query
  `information_schema`.

Those paths cannot be carried into a FlarexDB adapter by handing Medusa raw
Postgres access. They must be classified and reimplemented under the adapter
boundary.

The rule is:

```text
Generic Medusa DML CRUD
  -> generated FlarexDB repository support

Custom module repository logic
  -> module-specific FlarexDB repository adapter

Provider-specific SQL behavior
  -> FlarexDB provider implementation or unsupported for the Flarex path

Old SQL migrations
  -> Flarex schema/migration compiler or one-time data migration plan
```

RBAC is the model for this approach. The MikroORM repository can keep using
Knex/raw SQL in the Node/Postgres path, while the FlarexDB path provides a
separate `createFlarexRbacRepository(...)` that implements the same
`listPoliciesForRoles(...)` and `checkForCycle(...)` behavior through internal
FlarexDB graph/query APIs. The existing Drizzle path already follows this
pattern with `createDrizzleRbacRepository(...)`.

For RBAC specifically, FlarexDB should model:

```text
rbac_role
rbac_policy
rbac_role_policy
rbac_role_parent
```

Then implement inheritance with either query-time graph traversal or a
maintained internal closure/index table. The choice is an adapter optimization;
the service contract and tests stay the same.

The implementation standard is unchanged:

- Do not rewrite `RbacModuleService`, Pricing service, Inventory service, Order
  service, Index service, or Locking module behavior as Flarex application
  code.
- Do not expose raw physical database clients through the FlarexDB adapter.
- Add adapter-specific repository/provider implementations for behavior not
  covered by generated DML CRUD.
- Use existing Medusa module/API integration assertions as the behavioral
  compatibility gate.
- Add adapter-specific tests only for the FlarexDB query/traversal/migration
  mechanics that the shared Medusa assertions do not cover.

## Payload DB Layers That Must Be Preserved

Payload behavior also has layers that Flarex should not rewrite as generic
storage code.

Payload owns:

- config sanitization and plugin transforms;
- collection/global operation lifecycle;
- field validation and field-level behavior;
- access control evaluation;
- hook execution order;
- REST/local API operation shape;
- upload, auth, version, draft, and localization semantics when enabled.

Flarex owns:

- source-of-truth schema and migration history;
- tenant, project, deployment, and environment isolation;
- document/entity/link storage;
- typed indexes and query execution;
- transaction authority, OCC, commit log, outbox, and sync invalidation;
- user-code sandboxing and app deployment lifecycle.

The adapter boundary is:

```text
Payload create/update/find/delete/count/etc.
  -> @payloadcms/db-flarex
  -> generated mapping manifest
  -> Flarex storage transaction/session
  -> CMS-marked Flarex app rows, index sidecars, edge sidecars, unique keys,
     optional block metadata, and Payload system tables
```

Payload's config should be compiled from Flarex schema. It should not become a
second source of truth that can drift from Flarex migrations.

## Product Is The Stress Test

The Product module is the main proof that a naive document or triple-only store
is not enough.

Product requires:

- scalar fields, JSON fields, enums, searchable fields, and translatable fields;
- belongs-to, has-many, many-to-many, and self-referential relations;
- pivot/link entities for options, option values, images, tags, and categories;
- cascade delete behavior;
- soft-delete-aware unique constraints;
- composite unique constraints;
- relation population and selected nested fields;
- ordering and pagination;
- category tree traversal and `mpath` behavior;
- query operators over root and nested relation fields;
- deep update and upsert-with-replace behavior for variants, options, images,
  tags, and categories;
- stable output ordering because some Medusa flows rely on preserving input
  order.

An Instant-like entity/link layer helps model those relations, but a production
Medusa adapter still needs typed indexes, constraint enforcement, and
projection support. A single generic triples table will likely become too slow
or too complex for Product, catalog, and admin filtering workloads.

## Workflow Storage

Workflow execution state should be treated as system runtime storage, not as
ordinary Flarex app rows.

Workflow storage needs:

- composite identity such as workflow id, transaction id, and run id;
- JSON execution and context payloads;
- state indexes;
- retention cleanup;
- latest execution lookup;
- delayed action scheduling for retries, step timeouts, and transaction
  timeouts;
- recovery behavior after Worker or Durable Object restarts.
- linkage to a Flarex transaction/session when a workflow step executes inside
  `ctx.db.transact`;
- event-group or outbox metadata that can be released only after the owning
  Flarex commit succeeds.

This can still live in the same physical database or same Flarex-governed
storage substrate, but it should be a reserved system namespace or typed system
store. It should not be exposed as normal application `ctx.db` data.

## Locking Storage

Locking should also remain a provider boundary.

Medusa already has this boundary. The real contract is `ILockingModule` and its
provider interface, not a Flarex app table API. Existing workflows and services
call `Modules.LOCKING` for coordination, including cart completion, inventory
reservation, payment, order edit, and index synchronization paths.

Medusa lock behavior requires:

- multi-key acquisition;
- deterministic key sorting to avoid deadlocks;
- owner tokens;
- TTL;
- wait and poll behavior;
- release on failure;
- release-all by owner;
- safe use inside workflows such as cart completion and inventory reservation.

A Flarex-backed Medusa runtime should preserve that module contract and replace
only the provider underneath:

```text
Medusa workflow/service
  -> Modules.LOCKING
  -> ILockingModule
  -> FlarexDB or Cloudflare-safe locking provider
  -> reserved Flarex system lease store or Durable Object coordinator
```

Not:

```text
app developer ctx.db table
  -> custom lock rows
  -> commerce workflow coordination
```

The provider implementation can use a Flarex system lease table, a Durable
Object coordinator, Redis for Node/VPS deployments, or another Flarex-managed
runtime primitive. In the shared FlarexDB design, the preferred long-term shape
is an internal provider such as `@medusajs/locking-flarexdb` backed by reserved
system rows:

```text
system.lock_leases
  tenant_id
  project_id
  deployment_id
  module_scope
  lock_key
  owner_id
  expires_at
  fencing_token
  created_at
  updated_at
```

This store is infrastructure state. It is not app schema, not Payload schema,
not Medusa reserved commerce data, and not visible through public `ctx.db`.

Locks also do not replace OCC or transactions:

```text
lock
  -> prevent high-contention operations from running concurrently

OCC/read-set validation
  -> detect stale reads or conflicting writes before commit

database transaction / Flarex commit
  -> atomically publish data rows, indexes, commit record, and outbox
```

The FlarexDB transaction layer should pass the active transaction/session as
`sharedContext` when Medusa calls locking APIs. That lets lock acquisition,
commerce writes, workflow state, and event grouping share one runtime scope
without exposing raw database access.

Locking rules:

- Acquire multi-key locks in a deterministic global order.
- Prefer late acquisition near the atomic write phase.
- Do not hold locks across arbitrary app code, remote APIs, user think time, or
  long workflow pauses.
- Use TTLs, owner IDs, and fencing tokens so expired lock holders cannot commit
  stale writes after a newer owner acquires the same key.
- Release locks on rollback or logical workflow failure.
- If the process dies, rely on TTL/lease expiry plus idempotent retry rather
  than manual cleanup.
- Treat the lock provider as an internal Medusa/Flarex runtime component, not a
  public developer extension point.

Ordinary app-level triples are therefore the wrong abstraction for locks.

## Outbox And Derived Layers

The outbox is the reliable bridge from authoritative FlarexDB commits to
derived or external work.

It should not be treated as source data:

```text
source of truth
  -> Flarex app row JSON plus derived sidecars
  -> Medusa reserved relational tables
  -> relation/upload/link rows
  -> correctness indexes
  -> commit log

outbox
  -> durable post-commit event records
  -> "commit happened, these records/ranges/events changed"

derived consumers
  -> freshness versions
  -> live-query reruns and websocket delivery
  -> optional projections and read models
  -> search indexing
  -> analytics feeds
  -> Payload hooks/events that can run after commit
  -> Medusa workflow/domain events such as product.created
  -> webhooks, emails, jobs, and external integrations
```

The commit rule should be:

```text
one physical commit
  -> write authoritative app data
  -> write authoritative Medusa reserved data
  -> write correctness indexes and relation/link rows
  -> write commit log row
  -> write outbox rows
  -> commit
```

Then, after commit:

```text
DeploymentSyncDO direct wake fast path
  -> receive commit summary or load bounded commit summary by commit ts
  -> append to hot in-memory write-log window
  -> match changed keys/ranges against in-memory read-set indexes
  -> coalesce affected query reruns to the latest useful commit version
  -> rerun affected live queries
  -> hash results and skip unchanged results
  -> send changed results to ConnectionDOs

outbox maintenance/recovery path
  -> scan from durable consumer cursor
  -> rebuild missed hot write-log/freshness state after crash or eviction
  -> retry missed or failed work
  -> update optional read-model/search/event bridges
  -> dead-letter or surface stuck external deliveries
```

This solves the classic failure case:

```text
database commit succeeds
server dies before notifications or projections update
```

Because the outbox row was written in the same commit as the source data, a
worker can recover later and replay the derived work idempotently.

The current Flarex executor already follows this shape for app data:

```text
commitInvokeSessionWrites
  -> writes document revisions
  -> writes index entries
  -> writes commit row
  -> writes commit outbox event

outbox delivery
  -> applies commit events to freshness versions
  -> stale live-query subscriptions are detected from read sets
  -> stale queries rerun
  -> changed results create live-query delivery rows
  -> delivery workers fan out to connection/WebSocket targets
  -> acknowledgements, retries, stuck delivery checks, and dead letters finish
     the delivery lifecycle
```

The future FlarexDB design should extend this existing pattern instead of
inventing a separate event mechanism for Medusa or Payload:

```text
Flarex commit outbox
  -> app freshness/live sync
  -> Payload post-commit hooks and derived CMS tasks
  -> Medusa grouped workflow/domain events
  -> optional Medusa/Payload/Search read-model rebuilds
```

For Convex-like latency, the future FlarexDB design should not make that durable
outbox consumer the normal hot live-sync path. The normal path is direct:

```text
Postgres/Hyperdrive commit succeeds
  -> executor wakes DeploymentSyncDO immediately
  -> DeploymentSyncDO uses commit summary + in-memory read-set maps
  -> affected queries rerun and push transitions

outbox cursor
  -> proves no commit was missed
  -> replays after DO eviction, Worker failure, region failover, or deploy
  -> feeds slower derived consumers
```

Important rules:

- Outbox consumers must be idempotent.
- Outbox delivery can be at-least-once; consumers deduplicate by commit/event
  key and consumer name.
- Direct `DeploymentSyncDO` wake is an optimization after commit, not the source
  of truth. If the wake fails, the durable outbox cursor must let sync catch up.
- `DeploymentSyncDO` is the hot live-sync engine. It should keep a bounded
  in-memory write-log window, active read-set indexes, coalesced rerun queues,
  and result hashes for live queries. Durable tables are recovery and replay,
  not the preferred per-commit matching engine.
- Live-query reruns must be coalesced. If several commits touch the same query
  before it reruns, rerun once at the latest safe commit version.
- A live-query rerun does not imply a client send. If the result hash is
  unchanged, update the subscription freshness/result cursor without sending a
  WebSocket transition.
- Cloudflare Queues are optional scale/retry transports for heavy or external
  consumers. They are not required for the first same-Worker sync path.
- REST callbacks remain a compatibility adapter for Node/VPS or remote executor
  deployments. They should not be the default path when the executor and sync
  runtime live in the same Cloudflare deployment.
- Authoritative validation must not depend on async read models or projections
  updated from the outbox.
- Events must not be delivered before the Flarex commit succeeds.
- If the commit fails, no outbox event exists and no derived work should run.
- If derived work fails after commit, retry or dead-letter the outbox work
  without rolling back already-committed source data.

## Medusa Reserved Tables, Not First-Class App Tables

Medusa commerce storage should start as real authoritative system tables in
FlarexDB, not as projection tables pretending to be source data.

```text
FlarexDB physical database

Flarex app namespace
  posts
  pages
  reviews
  custom business data

Flarex CMS view
  Payload generated over app tables marked .cms()

Medusa reserved commerce namespace
  medusa_product
  medusa_product_variant
  medusa_price_set
  medusa_inventory_item
  medusa_cart
  medusa_order
  medusa_link_*

Flarex internal index namespace
  scalar indexes
  relation lookup indexes
  unique indexes
  soft-delete-aware lookup indexes
```

The Medusa reserved commerce tables are source-of-truth commerce tables, but
they are not public `ctx.db` tables. They are writable only through the
Flarex-backed Medusa persistence adapter and Medusa-owned services, workflows,
and repository/session contracts.

Application tables can reference Medusa public commerce IDs with typed Flarex
relations, but those references do not make application tables part of Medusa:

```text
Flarex app table -> commerce product
  -> Flarex relation edge owned by app schema
  -> visible to Flarex queries and Payload if the field is CMS-marked
  -> invisible to Medusa services, workflows, Query, and Index by default

Medusa product -> variant -> price set -> inventory item
  -> Medusa reserved commerce relations
  -> visible only through Medusa adapter/services/workflows
```

This keeps the three surfaces from collapsing into each other:

- Payload can be generated directly over CMS-marked app tables.
- Medusa can own real commerce tables in the same FlarexDB.
- App-to-commerce relationships stay app-owned references, not custom Medusa
  links.

## Internal Read Model Policy

Projection/materialized read-model tables should be optional internal read
helpers, not public developer APIs and not the first representation of Medusa or
Flarex app data.

Use internal read models only when a query shape is too expensive against the
real tables, relations, and Postgres-backed indexes:

- product browse lists;
- admin product filtering and sorting;
- category tree traversal;
- search/display denormalization;
- broad dashboard counts or cross-partition reads.
- heavy leaderboard or ranking views that cannot be served by a normal indexed
  stats table.

Internal read-model rules:

- Internal read-model rows live in Flarex internal namespaces in the same
  FlarexDB or a Flarex-managed projection database selected by the same
  tenant/deployment context.
- Internal read-model rows are rebuildable from authoritative shared app rows,
  app edges, app indexes, Medusa reserved tables, Payload system tables, and
  commit/outbox records.
- App developers cannot write internal read models directly.
- Do not expose `ctx.db.projection(...)` as the primary public developer API.
- Public app code should prefer logical app tables, declared relations,
  declared indexes, and app-owned derived fields when the app owns the data.
  For example, a learning leaderboard should usually be a logical `userStats`
  table with indexed `weeklyPoints`, `rating`, `learningMinutes`, and
  `leaderboardScore` fields.
- Medusa and Payload do not own read-model storage; they only request query
  behavior through their adapters.
- Transactional read helpers can update in the same Flarex commit when Medusa,
  Payload, or app behavior requires read-after-write behavior.
- Async read models can update from the commit outbox, but workflows,
  commerce validation, Payload lifecycle validation, and authoritative mutation
  checks must not depend on stale async read-model reads.

The default implementation should therefore be:

```text
authoritative commerce write
  -> Medusa service/workflow
  -> Flarex Medusa adapter
  -> reserved Medusa table writes
  -> reserved relation/link writes
  -> required indexes and transactional read helpers
  -> commit
  -> optional outbox-driven async internal read-model/search update
```

## Medusa Multitenancy

Medusa multitenancy should be Flarex platform tenancy, not a separate Medusa
tenant model.

```text
Flarex tenant/project/deployment/environment
  -> selects one commerce space
  -> scopes Medusa reserved commerce tables
  -> scopes app tables
  -> scopes Payload-generated CMS views
```

Medusa services should continue to behave as if they are running inside one
commerce application. The Flarex runtime and adapter inject the platform scope
below Medusa:

```text
request / worker / invocation
  -> resolve TenantRuntimeContext
  -> select partition, database, schema, or namespace
  -> create Medusa adapter session scoped to that commerce space
  -> execute unchanged Medusa service/workflow logic
```

Do not expose this as ordinary developer-managed `tenant_id` columns on Medusa
tables. Row-level scope columns may exist as a physical implementation detail or
defense-in-depth fallback, but the primary isolation boundary is the Flarex
tenant/project/deployment routing layer.

Commerce concepts remain inside the commerce space:

```text
Flarex tenant/project/deployment
  -> platform isolation

Medusa store, region, sales channel
  -> commerce domain data inside that isolated space
```

Recommended rollout:

1. MVP/self-hosted: one physical FlarexDB with internal scope keys or schemas
   selected by the Flarex runtime.
2. Stronger isolation: per-project schema or database selected by the same
   tenant/deployment context.
3. Cloudflare scale: tenant-scoped Durable Object partitions for write-heavy
   authority, with Flarex-managed projection databases only for read models.

## Recommended Physical Shape

The practical target is one database and one platform storage catalog, but not
one undifferentiated table for everything.

```text
shared Postgres or Hyperdrive-backed database

Flarex platform catalog
  apps / tenants / deployments / environments
  logical tables / fields / relations / indexes
  commits / outbox / freshness / live query topics

Flarex application data
  developer-defined logical tables
  typed row JSON plus relational sidecars
  public ctx.db access
  declared app indexes, unique keys, relation/upload edges, block metadata

Flarex CMS-marked application data
  developer-defined tables and fields with CMS metadata
  generated Payload config view
  Payload adapter access to the same app row JSON and sidecars
  fixed Payload system tables for auth, uploads, versions, drafts, globals,
  locks, and scheduled publish

Medusa reserved commerce namespace
  real authoritative DML-derived tables, links, and constraints
  repository adapter access only
  typed indexes and transactional read helpers
  soft-delete-aware unique constraints

Medusa system namespace
  workflow execution state
  delayed actions
  locks or lock-provider metadata
  event/outbox bridge

Flarex internal projection namespace
  optional derived read models
  generated from app and Medusa reserved tables
  rebuildable from commits/outbox
  not directly writable through ctx.db, Payload, or Medusa services
```

In this model, "shared schema" has two meanings:

- For Payload, the CMS data can be the same Flarex app tables and columns
  because Payload is a logic layer over CMS-marked app schema.
- For Medusa, the same physical database and Flarex storage substrate can be
  shared, but Medusa commerce data remains in a reserved logical namespace
  behind the Medusa persistence adapter.
- For projections, the data can live in the same physical FlarexDB or a
  Flarex-selected projection database, but it is derived infrastructure, not a
  third source-of-truth schema.

That distinction prevents Payload CMS content from becoming a separate app DB
while still preventing public `ctx.db` code from bypassing Medusa commerce
invariants.

## Required Flarex Capabilities

Before this can be treated as a real Medusa storage candidate, Flarex needs:

1. Shared FlarexDB control plane for schema catalog, transaction/session/OCC,
   commit log, outbox, freshness, live-query invalidation, and
   tenant/project/deployment scope across both shared app storage and Medusa
   system table storage.
2. Flarex app/Payload storage target based on shared row history/current rows,
   declared index-entry sidecars, relationship/upload edge sidecars,
   unique-key rows, and optional block metadata sidecars.
3. Medusa storage target based on real DML-generated relational system tables,
   link/pivot tables, indexes, and constraints.
4. Shared or extracted DML-to-schema compiler IR that consumes Medusa
   `model.define(...)` metadata instead of duplicating Medusa table definitions.
5. FlarexDB Medusa schema registry for compiled DML tables, columns,
   relationships, indexes, constraints, namespace, visibility, write policy,
   schema hash, and physical table mapping.
6. Shared transaction sessions that can stage app graph writes and Medusa
   system table writes in one FlarexDB commit when the commerce work enters
   through Medusa-owned commands, workflows, repositories, and adapter
   semantics.
7. Expanded OCC/read-set support for app rows, declared index ranges, relation
   edges, block metadata sidecars, Medusa rows, Medusa relation/link rows, and
   Medusa query/index/range reads.
8. Table/field/relation catalog compatible with Flarex app schema and Medusa
   DML metadata.
9. Reference and reverse-reference storage with relation traversal.
10. Typed indexes for scalar and relation queries.
11. Partial and composite unique constraint support.
12. Soft delete semantics compatible with Medusa queries and uniqueness.
13. Query planner for Medusa filters, nested filters, ordering, pagination, and
   counts.
14. Mutation planner for nested create/update/delete/upsert-with-replace.
15. Adapter-specific repository hooks for module behavior that is not expressible
   as generated DML CRUD, including RBAC hierarchy traversal, Pricing selection,
   Inventory level helpers, Order find helpers, and Index query behavior.
16. Provider-specific implementations for behavior currently backed by
   database-specific SQL or runtime services, such as Postgres advisory locking,
   Redis locking, and Durable Object locking.
17. Flarex schema/migration compiler or one-time migration plan for historical
    SQL migrations.
18. Transaction/session API compatible with Medusa transaction managers.
19. OCC/read-set or database transaction semantics strong enough for Medusa
   service methods.
20. Public `ctx.db.transact(...)` implemented as a staging API over the Flarex
    commit protocol and executor transaction, not as a separate transaction
    engine.
21. Reserved system stores for workflow execution and locking, including lock
    leases, owner tokens, TTLs, fencing tokens, and release/retry metadata.
22. Outbox and invalidation tokens for Flarex sync subscriptions.
23. Worker-safe import graph with Node-only persistence implementations kept
    out of Cloudflare bundles.
24. Worker/Hyperdrive physical executor adapter for the trusted FlarexDB commit
    lane, with no-cache correctness reads, short transaction-pooling windows,
    and Worker placement near Postgres when final commits require multiple
    sequential SQL calls.
25. Commit planner that compiles app, Payload, Medusa, workflow, lock,
    freshness, and outbox intent into set-based validation and bulk write
    batches instead of row-by-row ORM loops.
26. Optional database-side commit function boundary for high-complexity commits,
    such as `flarexdb_commit(jsonb)`, while preserving FlarexDB as the commit
    protocol and schema authority.
27. Same-deployment direct wake path from the FlarexDB executor Worker to
    `DeploymentSyncDO` after commit, carrying a compact commit summary or a
    pointer to a bounded durable commit summary, with durable outbox cursor
    recovery if the direct wake fails.
28. Compact commit summaries that include changed row ids, app table ids,
    declared index/range keys, relation/upload edge keys, block metadata keys,
    Medusa row ids, Medusa link row ids, optional internal read-model
    dependency keys, write source, deployment/tenant scope, commit ts, and
    outbox sequence.
29. Foundation live-sync topology with `ConnectionDO` owning hibernating
    WebSocket sessions and `DeploymentSyncDO` owning commit/outbox/freshness,
    affected-subscription discovery, rerun dedupe, and push to `ConnectionDO`s.
30. `DeploymentSyncDO` hot-state indexes: bounded in-memory write-log window,
    document/row/edge/table/range/internal-read-model read-set maps, coalesced
    rerun queues, subscription freshness cursors, and result hashes.
31. Query planner freshness rules so live queries can read internal read models
    only when the read model is fresh enough for the required
    commit/dependency version; stale internal read models must not be published
    as fresh live results.
32. Public developer query APIs based on tables, relations, indexes, ordering,
    pagination, and normal derived fields; internal read models remain planner
    infrastructure rather than a primary `ctx.db.projection(...)` API.
33. Bounded mutation execution, transaction leases, and transaction-size quotas
    for user code, reads, writes, scans, range reads, and outbox fanout. Long
    work must move to actions, workflows, jobs, or post-commit outbox
    subscribers.
34. Explicit lock or serialized-partition path for high-contention domains such
    as inventory, checkout, payment state, order-number allocation, stock
    reservation, counters, and Medusa workflow coordination. OCC remains the
    default optimistic path; hot correctness domains need a deliberate
    serialization mechanism.

Before this can be treated as a real Payload storage candidate, Flarex also
needs:

1. CMS metadata on tables and fields.
2. A compiler from Flarex schema to Payload config.
3. A generated mapping manifest from Payload fields to row JSON paths,
   declared index sidecars, relation/upload edge sidecars, unique-key sidecars,
   optional block metadata sidecars, and hidden system fields.
4. Payload adapter methods for create, find, count, update, delete, versions,
   globals, migrations, and transaction sessions.
5. Type-safe relation builders for has-one, has-many, polymorphic has-one,
   polymorphic has-many, ordered relation edges, and virtual reverse
   relations.
6. Storage patterns for arrays, blocks, localized fields, polymorphic
   relationships, uploads, auth fields, and reverse joins.
7. Query translation for Payload filters, sorting, pagination, relationship
   population, drafts, versions, locales, and admin search.
8. CMS write-policy enforcement so direct `ctx.db` writes cannot bypass
   Payload lifecycle semantics for `payload-only` collections or fields.
9. Embedded ordered arrays/blocks with stable item ids, field path, position,
   locale, and block type metadata, plus optional v2 child-row storage only
   where block-level editing/querying at scale requires it.
10. Polymorphic relation-edge sidecars with target collection discriminator and
    relation indexes for has-one, has-many, uploads, and reverse joins.
11. Hidden system stores for Payload versions, drafts, auth/session state,
    upload metadata, document locks, and scheduled publish metadata.
12. JSON subpath indexing or projection hooks for selected rich text, block, and
    plugin fields that need admin search or filtering.
13. Compatibility tests against Payload's own adapter expectations and a
    representative generated Payload app.

## Validation Order

Do not start with Product or Cart.

The proof order should be:

1. Currency through Flarex-backed storage with unchanged Medusa assertions.
2. Product read/list/query coverage with DML-derived schema and relations.
3. Product nested mutations, category tree behavior, and constraint behavior.
4. Index/query projection compatibility for Product browse/admin routes.
5. Locking provider compatibility.
6. Workflow execution and delayed action storage compatibility.
7. Cart and inventory workflows that combine service transactions, locks,
   workflow state, and event/outbox behavior.
8. workerd validation with Node-only imports absent from the bundle graph.

Payload should follow a separate proof order:

1. Generated Payload config from a small Flarex schema.
2. Scalar collection CRUD through `@payloadcms/db-flarex`.
3. Request-scoped transactions with hooks and rollback.
4. Arrays, blocks, rich text, localization, and versions/drafts.
5. Relationships, uploads, auth, sessions, and joins.
6. Admin/API query parity and performance checks.

The acceptance standard remains unchanged Medusa behavior, not a parallel
contract test that only proves the Flarex adapter's own API.

## Risks

- A pure EAV/triple store may make commerce queries expensive without typed
  indexes or projections.
- Partial unique constraints such as soft-delete-aware handles and SKUs are not
  trivial in a generic schema.
- Deep Product mutations require exact Medusa semantics, not just successful
  writes.
- Workflow and locking semantics are runtime coordination problems, not normal
  entity persistence.
- Treating Medusa locks as public app records would let application code bypass
  commerce coordination and corrupt high-contention workflows.
- Sharing one physical database can create false confidence if the authority
  boundaries are not visible in code.
- Letting Medusa commit commerce rows or release workflow events independently
  while nested inside a Flarex transaction would create split-brain app and
  commerce state.
- Holding commerce locks across arbitrary user code, remote APIs, or long
  workflow pauses can deadlock or block unrelated commerce operations.
- Letting expired lock holders commit without fencing tokens can overwrite
  newer work after a retry or crash recovery path.
- Replaying workflow or event recovery without idempotency keys can duplicate
  events or side effects after crash recovery.
- Exposing internal Medusa storage through public Flarex `ctx.db` would bypass
  commerce invariants.
- Exposing Medusa Link as a public Flarex app API would create a third schema
  language for developers and blur Medusa's internal compatibility boundary.
- Letting Payload own the schema would create a second app data model and break
  the Flarex source-of-truth rule.
- Treating every Payload field as a flat column would fail for arrays, blocks,
  localized fields, polymorphic relationships, uploads, versions, and joins.
- Treating every complex Payload field as opaque JSON would make simple demos
  work but break admin filters, relationship population, localized merging,
  reverse joins, version diffs, ordered updates, and cleanup behavior.
- Allowing direct `ctx.db` writes to Payload-managed auth, upload, draft,
  version, or hook-sensitive fields would bypass Payload semantics.
- Exposing Flarex schema, Payload config, Medusa links, SQL migrations, and
  sync/read-model maintenance as separate developer responsibilities would make
  the BaaS feel like three frameworks instead of one platform.

## Current Decision

The direction is worth researching further, but only under these constraints:

- Flarex core stays commerce-neutral.
- Medusa remains the trusted commerce behavior owner.
- Payload remains the trusted CMS behavior owner.
- The public developer experience must stay Flarex-first: one schema, `ctx.db`
  for app data, `.cms()` for CMS exposure, and `ctx.commerce` for commerce
  behavior.
- FlarexDB remains the single data-plane design; Medusa and Payload only add
  metadata, generated config, and adapter mappings.
- The foundation model is one FlarexDB control plane with three physical
  storage classes: typed shared app/Payload row JSON with relational sidecars,
  fixed Payload system tables for CMS lifecycle state, and Medusa
  DML-generated real relational system tables for commerce.
- Medusa and Payload adapters talk to internal FlarexDB persistence APIs, not
  raw Postgres, Hyperdrive, D1, Durable Object SQLite, or physical SQL tables.
- Medusa DML models are the source of truth for `system.medusa` schema;
  FlarexDB should compile Medusa `model.define(...)` metadata into internal
  catalog rows and physical table mappings instead of manually duplicating
  Medusa table definitions.
- Medusa Link remains internal compatibility for original Medusa module links;
  Flarex app developers use Flarex relations, not public custom Medusa links.
- Flarex app schema is the source of truth for CMS-marked Payload collections.
- CMS-managed collections need explicit write policies; lifecycle-sensitive
  collections default to Payload-only writes.
- Payload complex fields compile to Flarex storage primitives: embedded row
  JSON for normal CMS content, derived app edges for relationships/uploads and
  joins, derived index/unique sidecars for declared queryable fields, optional
  block metadata sidecars, fixed Payload system tables for
  drafts/versions/auth/uploads/locks/globals/scheduled publish, and virtual
  reverse relations for Join fields.
- JSON is the authoritative row value for app/Payload content, but it must not
  be the only representation for fields that need filtering, sorting,
  uniqueness, relationship population, reverse joins, block lookup, OCC
  dependency tracking, or live-sync invalidation.
- Flarex app schema and Medusa reserved commerce schema remain separate logical
  layers inside the same FlarexDB data plane.
- Medusa reserved commerce tables are real authoritative system tables, not
  projection tables and not public `ctx.db` app tables.
- Existing raw-SQL/custom-repository behavior becomes FlarexDB
  adapter-specific repository or provider work; it does not justify exposing
  raw physical database access to Medusa.
- Cross app-and-commerce atomicity is possible only through explicit shared
  FlarexDB transaction sessions where app writes use shared app storage and
  commerce writes enter through Medusa-owned commands, workflows, repositories,
  and adapter semantics.
- Flarex mutations and `ctx.db.transact` callbacks should be bounded like
  Convex-style transactional functions: short deterministic user code,
  explicit transaction-size quotas, and long work moved to actions, workflows,
  jobs, or post-commit outbox subscribers.
- Dynamic Workers can run untrusted user code, while a trusted FlarexDB executor
  Worker can run the final commit through Hyperdrive. The executor opens the
  SQL transaction only after user code finishes.
- Hyperdrive is a physical database transport, not the consistency authority.
  OCC, read-set validation, commit records, freshness markers, outbox rows,
  schema scope, tenant scope, and adapter write policies remain FlarexDB-owned.
- Correctness paths must use no-cache or cache-disabled database access:
  mutation reads, read-your-write reads, OCC validation, Medusa workflow reads,
  Payload request transactions, live-query reruns, locks, workflow state, and
  outbox reads.
- Final commits should be compiled into set-based validation and bulk write
  batches. Medusa Product, Cart, Order, Pricing, Inventory, workflow, and link
  writes must not become one awaited SQL round trip per row inside the final
  transaction.
- Node/Postgres and Worker/Hyperdrive should be separate physical executor
  adapters behind the same FlarexDB commit contract.
- The first Cloudflare live-sync topology should split only where there is a
  real platform reason: `ConnectionDO` owns WebSocket hibernation and client
  sessions, while `DeploymentSyncDO` owns commit/outbox/freshness, affected
  query discovery, rerun dedupe, and delivery to `ConnectionDO`s.
- `DeploymentSyncDO` should be the Convex-like hot live-sync engine. It should
  keep a bounded in-memory write-log window, active read-set indexes,
  coalesced rerun queues, subscription freshness cursors, and result hashes.
  Durable Postgres rows remain the replay and recovery layer, not the preferred
  per-commit invalidation engine.
- Do not start with separate `QueryDO`, `ProjectionDO`, or `DeliveryDO`
  services. Add them later only when shared-query reruns, optional read-model
  rebuilds, or delivery fanout create measured pressure.
- Same-Worker deployments should directly wake `DeploymentSyncDO` after commit.
  The durable FlarexDB outbox remains the recovery and ordering source; direct
  DO wake is only the fast path.
- Direct wake should carry a compact commit summary or a pointer to a bounded
  durable summary. The summary should include changed rows, relation/upload
  edges, block metadata keys, Medusa rows/link rows, table ids, declared
  index/range keys, and internal read-model dependency keys, so live-sync
  matching does not need to rescan physical tables after every commit.
- Live-query reruns should be coalesced to the latest safe commit version and
  deduped by result hash before sending WebSocket transitions.
- Cloudflare Queues are optional for heavy/external consumers. REST callbacks
  are compatibility adapters for remote executors, not the default same-Worker
  sync path.
- Internal read-model rows live in Flarex-owned internal namespaces in the same
  FlarexDB by default. Live query planners may read them only when their
  freshness is sufficient; otherwise they rerun from source data or wait for
  read-model catch-up.
- Do not expose projections as a primary public developer API. Public app
  queries should use logical app tables, declared relations, declared indexes,
  ordering, pagination, and explicit app-owned derived fields first. Internal
  read models remain Flarex planner/runtime infrastructure.
- Existing Medusa workflow definitions should remain intact. The Flarex-backed
  commerce facade should inject a Flarex transaction manager/session,
  eventGroupId, and event-release policy into the workflow runtime instead of
  editing product/cart/order workflow logic.
- Existing Medusa locking semantics should remain intact. Medusa workflows and
  services keep calling `Modules.LOCKING`; Flarex provides an internal
  FlarexDB, Durable Object, Redis, or deployment-specific provider underneath.
- A FlarexDB lock provider should use reserved system lease storage with
  tenant/project/deployment scope, owner tokens, TTLs, deterministic multi-key
  acquisition, and fencing tokens. It must not expose lock rows through public
  `ctx.db` or Payload CMS.
- When a Medusa workflow runs inside `ctx.db.transact`, workflow success is not
  the commit authority. The outer FlarexDB commit decides whether Medusa events
  are released or cleared.
- Crash recovery must distinguish pre-commit, post-workflow/pre-commit, and
  post-commit/pre-event-release states using Flarex commit records, workflow
  state, leases, and outbox idempotency.
- The OCC/read-set model must expand from documents, tables, indexes, and
  relation edges to include Medusa rows, Medusa link rows, and Medusa
  query/index/range reads.
- App-to-commerce relationships are typed Flarex-owned references by default;
  they do not become Medusa Module Links unless a future platform-managed
  feature explicitly requires that.
- Projections/materialized read models are optional Flarex-owned internal read
  helpers, generated from authoritative app and Medusa reserved data, and
  rebuildable from commits or outbox records.
- The default live sync path is server query reactivity: Flarex query
  functions run on the server, `DeploymentSyncDO` caches and reruns affected
  query results, and clients render simple cached results. A mandatory
  Postgres-to-SQLite projection layer is not the default.
- Lunora's useful lessons are commit cursors, epoch/cursor resume, settled
  acknowledgements, idempotent offline replay, optional client watermarks, and
  server-resolved shapes. These are protocol ideas, not a requirement to adopt
  Lunora's DO-SQLite storage model.
- TanStack DB is optional client infrastructure for future local-first
  collection adapters. It is not required for Flarex core sync because complex
  query logic stays in Flarex server query functions.
- Outbox is a durable post-commit synchronization layer for freshness,
  live-query reruns, projections, search, Medusa events, Payload events, and
  external jobs. It is not source data and must be written atomically with the
  source commit.
- Medusa multitenancy is injected by Flarex tenant/project/deployment runtime
  context; Medusa `store`, `region`, and `sales_channel` remain commerce data
  inside that isolated space.
- A Flarex-backed Medusa adapter must pass the same module and workflow tests
  as the existing MikroORM/Postgres and Drizzle/SQLite paths.
- A Flarex-backed Payload adapter must preserve Payload's operation lifecycle,
  field behavior, access rules, hooks, transactions, auth, uploads, versions,
  drafts, and query semantics where those features are enabled.
- Workflow and locking should use reserved system stores or provider adapters,
  not ordinary app triples, CMS tables, or custom developer-managed Medusa Link
  records.
- The current Drizzle/Durable Object Cloudflare milestone remains the active
  implementation path until a Flarex-backed adapter proves parity.

## Current Challenge Verdict

This is the strongest current architecture direction for the goal, but it is
not proven enough to call perfect.

The design fits the product constraints:

```text
many Flarex apps
  -> shared app storage, no physical table explosion

Payload
  -> CMS content can share app storage, lifecycle state uses fixed system tables

Medusa
  -> real reserved commerce tables, not generic app rows

Flarex
  -> owns schema catalog, OCC, commits, outbox, live sync, tenant/scope

PostgreSQL 19
  -> optional future graph-query layer, not required for v1
```

The design still needs proof in these areas:

```text
shared fx_app_row_rev/current and fx_app_edge_rev/current query performance at scale
fx_app_index_entry_rev/current ordered-key layout for rich declared indexes
Payload block sidecar extraction without turning blocks into default child rows
OCC dependency tracking over rows, edges, block metadata, index ranges, Payload tables, and Medusa tables
Medusa adapter compatibility for Product, Cart, Order, Inventory, Pricing, workflows, locks, Query/Index
Payload adapter compatibility for blocks, drafts, versions, auth, uploads, hooks, access rules
DeploymentSyncDO recovery after hibernation or eviction
cross-scope/global query strategy for analytics, marketplaces, and global leaderboards
```

The first proof should be a small Flarex-only vertical slice:

```text
logical posts/categories schema
  -> fx_app_row_rev/current rows
  -> fx_app_edge_rev/current relation rows
  -> fx_app_index_entry_rev/current declared index rows
  -> fx_app_unique_key rows where needed
  -> tx commit + outbox
  -> live query by category reruns through DeploymentSyncDO
```

Only after that should Payload and Medusa adapter proofs be layered on top.
