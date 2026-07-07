# Flarex Commerce CMS Sections and Blocks

Status: design note / proposed direction

This note captures the agreed direction for supporting Payload-style blocks, Shopify-like commerce CMS section authoring, Flarex app relational schemas, and commerce-aware schema APIs on top of one Flarex-owned multitenant database design.

The goal is not to build a visual editor in v1. The goal is to define a durable schema, developer API, and storage model that can power a high-quality form-based block/section editor now, while leaving room for a future visual editor.

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

defineSection(...), defineTemplate(...), defineRegion(...)
  = higher-level commerce CMS authoring primitives compiled onto the same storage model

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
- Shopify-inspired sections, templates, regions, presets, and commerce resource pickers.
- App-to-commerce relationships such as product reviews, Q&A, wishlists, bundles, and CMS featured products.
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
6. Support commerce CMS authoring patterns inspired by Shopify sections, blocks, templates, regions, presets, and resource pickers.
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
- Arbitrary JSON path querying without declared indexes.
- Table-per-user-model physical DDL as the default Flarex app storage model.
- Physical extension of commerce-owned product rows by arbitrary app fields.

V1 should be a strong form-based CMS section/block editor with draft preview, commerce pickers, and relation-backed app extensions. It should not be a full Shopify/Webflow-style visual builder.

## Package and import boundaries

The API should be split into packages/namespaces for ergonomics, while still compiling to one schema graph.

Recommended imports:

```ts
import { defineSchema, defineTable, defineBlock, v } from "flarex/server"
import { defineSection, defineTemplate, defineRegion } from "flarex/cms"
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
defineSection
defineTemplate
defineRegion
```

These are high-level authoring primitives over the same row JSON, block sidecar, edge sidecar, and index sidecar engine.

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

## Primitive storage model

The same primitive storage model should support app rows, relational fields, CMS fields, commerce sections, and app-to-commerce edges.

Core physical table groups:

```text
fx_table
fx_field
fx_index_def

fx_row_current
fx_row_rev

fx_index_entry_current
fx_index_entry_rev

fx_edge_current
fx_edge_rev

fx_block_index
fx_unique_key

fx_commit
fx_invoke_session
fx_read_set / invoke session reads
fx_outbox
fx_idempotency
```

Optional Payload/CMS-specific table groups:

```text
fx_payload_version
fx_payload_global
fx_payload_global_version
fx_payload_document_lock
media collection / upload metadata rows
```

The central invariant:

```text
fx_row_current.data_json / fx_row_rev.data_json
  = authoritative value

fx_index_entry_*
  = derived scalar/compound index entries

fx_edge_*
  = derived relationship, upload, CMS picker, and commerce picker edges

fx_block_index
  = derived block/section type, position, parent, and path metadata

fx_unique_key
  = uniqueness enforcement

fx_commit / read sets / outbox / idempotency
  = transactional runtime, OCC, sync, and recovery
```

Blocks, groups, relations, uploads, and commerce picker values remain embedded in row JSON for normal read/render/edit flows, while Flarex derives sidecar rows for query, invalidation, uniqueness, reverse lookup, and cache/sync dependency tracking.

## Logical table ids and cross-kind relations

`fx_edge_*` must support targets that are not necessarily stored in `fx_row_current`.

Targets may be:

```text
app rows
CMS collection rows
CMS globals / singleton rows
media/upload rows
commerce reserved rows
Medusa-backed rows
system rows
```

Therefore `fx_table` should describe logical table ids:

```text
table_id: 10
name: commerce.products
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

`fx_edge_current.target_table_id` points to a logical Flarex table id, not necessarily a physical `fx_row_current` table. The resolver determines how to fetch the target.

Suggested edge shape:

```sql
fx_edge_current (
  deployment_id text not null,

  source_table_id int not null,
  source_row_id text not null,
  source_path text not null,

  target_table_id int not null,
  target_row_id text not null,

  relation_kind text not null, -- relation | upload | commerce_picker | cms_picker | block_ref
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

The same shape applies to `fx_edge_rev` with `commit_ts`/`deleted` history for OCC/sync.

## One schema system, several authoring styles

Flarex should support all of these without introducing separate database products.

### 1. Document-style app table

```ts
const logs = defineTable({
  type: v.string().index(),
  payload: v.json(),
  createdAt: v.number().index(),
})
```

This is useful for flexible event/config/state data. Querying arbitrary JSON paths should not be allowed in production unless those paths are declared as indexed paths.

### 2. Typed embedded object table

```ts
const users = defineTable({
  name: v.string(),
  email: v.string().unique().index(),
  profile: v.object({
    bio: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  }),
  settings: v.json(),
})
```

Embedded objects are still authoritative row data. Indexed paths produce sidecar index entries.

### 3. Relational app table

```ts
const posts = defineTable({
  title: v.string(),
  slug: v.string().unique(),
  author: v.relation.one(users).required().index(),
  status: v.enum(["draft", "published"]).index(),
  publishedAt: v.optional(v.number()).index(),
})
  .index("bySlug", ["slug"])
  .index("byAuthorStatusPublishedAt", ["author", "status", "publishedAt"])
  .index("byStatusPublishedAt", ["status", "publishedAt"])
```

Relations are stored in row JSON and mirrored into `fx_edge_current` / `fx_edge_rev`.

### 4. App table related to commerce

```ts
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
  .index("byProductStatusCreatedAt", ["product", "status", "createdAt"])
```

This is a stored many-to-one relation from reviews to products. The reverse one-to-many relation from product to reviews is virtual and backed by indexes/edges.

### 5. CMS block table

```ts
const hero = defineBlock({
  slug: "hero",
  label: "Hero",
  fields: {
    variant: v.enum(["centered", "split", "minimal"]).default("centered"),
    headline: v.string(),
    image: v.optional(v.upload(media)),
    cta: v.group({
      label: v.string(),
      href: v.string(),
      variant: v.enum(["primary", "secondary"]),
    }),
  },
})

const pages = defineTable({
  title: v.string().index(),
  slug: v.string().unique(),
  sections: v.blocks([hero]).indexBlockTypes(),
}).cms({
  collection: "pages",
  drafts: true,
  versions: true,
  writes: "cmsOnly",
})
```

Blocks are embedded arrays with stable block ids and block types. Sidecars are derived for block type lookup, relations inside blocks, and indexed block fields.

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

Physically:

```text
fx_row_current
  table = productReviews
  row = review_1
  data_json.product = prod_123

fx_index_entry_current
  byProductStatusCreatedAt(prod_123, approved, createdAt, review_1)

fx_edge_current
  productReviews.review_1.product -> commerce.products.prod_123
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

A CMS page row may contain:

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

Derived sidecars:

```text
fx_block_index
  page:home sections sec_hero_1 hero position=0
  page:home sections sec_grid_1 featuredCollection position=1

fx_edge_current
  page:home sections.sec_hero_1.settings.image -> media.media_123
  page:home sections.sec_grid_1.settings.collection -> commerce.collections.col_999
  page:home sections.sec_grid_1.settings.products[0] -> commerce.products.prod_1
  page:home sections.sec_grid_1.settings.products[1] -> commerce.products.prod_2

fx_index_entry_current
  slug = home
  status/publishedAt = ...
```

This preserves Payload-like nested authoring while keeping Flarex relationally queryable and syncable.

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

Borrow:

```text
templates
regions / section groups
sections
blocks inside sections
settings
presets
resource pickers
commerce-aware field types
```

Do not borrow for v1:

```text
Liquid runtime
theme files as source of truth
settings_data.json as the canonical storage model
arbitrary custom liquid/html execution
third-party app block runtime
full theme marketplace compatibility
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
defineSection(...)
defineTemplate(...)
defineRegion(...)

c.product()
c.products({ max })
c.variant()
c.variants({ max })
c.collection()
c.collections({ max })

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

These are authoring/picker aliases over normal fields and relations. They should compile to the same row JSON, edge sidecars, index sidecars, and Payload field configs.

## Sections

A section is a top-level page composition unit. Examples: Hero, Featured Collection, Product Information, Testimonials, Announcement Bar, Header Navigation, Footer Navigation.

```ts
const HeroSection = defineSection({
  slug: "hero",
  label: "Hero",
  category: "Marketing",

  settings: {
    variant: v.enum(["centered", "split", "imageBackground"]).default("centered"),
    headline: v.string(),
    subheadline: v.optional(v.string()),
    image: v.optional(v.media.image()),
    cta: v.group({
      label: v.string(),
      href: v.url(),
      style: v.enum(["primary", "secondary"]),
    }),
  },

  presets: [
    {
      name: "Centered hero",
      category: "Marketing",
      settings: {
        variant: "centered",
        headline: "Welcome to our store",
      },
    },
  ],
})
```

A section should compile to a block-like object in row JSON with `sectionType` or `blockType`, stable id, settings, optional child blocks, and derived sidecars.

## Blocks inside sections

Blocks are local child components inside sections.

```ts
const SlideBlock = defineBlock({
  slug: "slide",
  label: "Slide",
  fields: {
    image: v.media.image(),
    heading: v.string(),
    text: v.optional(v.string()),
    buttonLabel: v.optional(v.string()),
    buttonHref: v.optional(v.url()),
  },
})

const SlideshowSection = defineSection({
  slug: "slideshow",
  label: "Slideshow",

  settings: {
    autoplay: v.boolean().default(false),
    interval: v.number().default(5),
  },

  blocks: v.blocks([SlideBlock], {
    min: 1,
    max: 8,
    ordered: true,
  }),
})
```

Recommended v1 limit: section -> blocks -> optional shallow nested blocks. Avoid deep arbitrary nesting in v1.

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

## Full app + commerce + CMS schema example

```ts
import { defineSchema, defineTable, v } from "flarex/server"
import { defineSection, defineTemplate } from "flarex/cms"
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
const ProductTitleBlock = defineBlock({
  slug: "productTitle",
  label: "Product title",
  fields: {
    headingSize: v.enum(["sm", "md", "lg"]).default("lg"),
  },
})

const ProductPriceBlock = defineBlock({
  slug: "productPrice",
  label: "Product price",
  fields: {
    showCompareAt: v.boolean().default(true),
    showTaxNote: v.boolean().default(true),
  },
})

const BuyButtonsBlock = defineBlock({
  slug: "buyButtons",
  label: "Buy buttons",
  fields: {
    showDynamicCheckout: v.boolean().default(true),
    showQuantitySelector: v.boolean().default(true),
  },
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

  blocks: v.blocks([
    ProductTitleBlock,
    ProductPriceBlock,
    VariantPickerBlock,
    BuyButtonsBlock,
    ProductDescriptionBlock,
    CollapsibleTabBlock,
    ComplementaryProductsBlock,
  ], {
    max: 30,
  }),
})
```

This mirrors Shopify-style product page composition while remaining Flarex/Payload-owned data.

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

CMS-exposed tables should declare how writes are allowed.

```ts
.cms({
  collection: "pages",
  writes: "cmsOnly",
})
```

Suggested policies:

```text
cmsOnly
  only the CMS/Payload lifecycle can write; safest for drafts, versions, hooks, uploads, and content-heavy pages

ctxDbValidated
  ctx.db writes are allowed, but Flarex runs schema validation, index/edge derivation, uniqueness, and allowed lifecycle checks

ctxDbAllowed
  normal app-owned table; CMS is only an admin UI on top
```

Content-heavy Payload-style tables should default to `cmsOnly` until the lifecycle mapping is complete.

Commerce-owned tables should not accept arbitrary public `ctx.db` writes. Commerce writes should go through `ctx.commerce` or trusted internal commerce adapters.

## Preview plan

V1 should support form-based editing plus preview.

V1 scope:

```text
section list
block add/remove/duplicate
block reorder
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

v.cms.entry / v.cms.entries
v.design.color
v.design.range
v.design.select

block/section presets
ordered sections
ordered blocks
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
arbitrary JSON path queries
block-level physical tables by default
physical arbitrary extension of commerce product rows
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
nested theme blocks
A/B templates
advanced theme presets
Shopify import/export adapter
client patch protocol for live preview
collaborative editing/presence
physical commerce row extension if the adapter layer supports it
advanced commerce relation helpers
```

These should build on the same primitive storage model, not replace it.

## Implementation checklist

1. Add schema AST nodes for `defineBlock`, `defineSection`, `defineTemplate`, and `defineRegion`.
2. Add `flarex/cms` and `flarex/commerce` package boundaries.
3. Add commerce logical table refs under `c.tables.*`.
4. Keep `defineSection` as high-level sugar over block-like embedded section objects.
5. Add stable block/section ids to stored row JSON.
6. Add `fx_block_index` derivation for block/section type, path, position, and parent.
7. Derive `fx_edge_*` rows for relations/uploads/pickers inside app rows, blocks, and sections.
8. Derive `fx_index_entry_*` rows for declared indexes, including block/section subfield indexes.
9. Add compiler support for commerce picker aliases over normal relations.
10. Add logical table resolver support for app, CMS, media, commerce reserved, and system targets.
11. Generate Payload-compatible field/block configs from `.cms(...)` metadata.
12. Add CMS write policies and enforce them in mutation execution.
13. Add product/collection/media picker UI components in the admin.
14. Add form-based section/block editor UI.
15. Add draft preview URL/token support.
16. Add schema compile-time write amplification estimates, including relation edge counts.
17. Add query planner rejection for unindexed nested/block/section JSON queries.
18. Add relation modeling docs/generators for child tables, bounded many lists, and join tables.
19. Keep visual editor APIs out of v1 public docs.

## Open decisions

- Exact naming: `defineSection` vs `defineComponentSection`.
- Exact commerce import name: `c` vs `commerce`.
- Whether `v.upload(media)` should be core or sugar for `v.relation.one(media).cms({ widget: "upload" })`.
- Maximum default section count per template/page.
- Maximum default block count per section.
- Maximum nested block depth for v1.
- Maximum default `c.products()` / `c.collections()` selection count.
- Whether regions are stored as Payload globals, Flarex system rows, or CMS singleton collections.
- How much Payload-specific admin metadata belongs in core schema vs `.cms(...)` metadata.
- Whether section presets are deploy-time schema metadata only or can be user-defined later.
- How much `c.extend(...)` should support in v1 beyond virtual reverse relations.

## Reference notes

This design is inspired by, but does not clone, the following systems:

- Payload blocks, groups, relationships, uploads, drafts, versions, globals, hooks, and admin forms.
- Shopify Online Store themes: templates, section groups, sections, blocks, presets, and resource picker settings.
- Convex: generated APIs, declared indexes, OCC, read sets, live query invalidation, and function execution ergonomics.
- InstantDB: relationship/edge sidecars and graph-oriented query ergonomics.

The key Flarex-specific decision is to keep one primitive storage model:

```text
row JSON as authoritative value
+ relational sidecars for indexes/edges/blocks/unique keys
+ logical table ids for app/CMS/media/commerce targets
+ Postgres-authoritative commit/OCC/sync
```
