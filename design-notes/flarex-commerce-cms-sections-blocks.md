# Flarex Commerce CMS Sections and Blocks

Status: design note / proposed direction

This note captures the agreed direction for supporting Payload-style blocks, Shopify-like commerce CMS section authoring, and Flarex relational app schemas on top of one Flarex-owned multitenant database design.

The goal is not to build a visual editor in v1. The goal is to define a durable schema and developer API that can power a high-quality form-based block editor now, while leaving room for a future visual editor.

## Executive summary

Flarex should expose one schema system, not separate document, relational, and CMS databases.

```text
defineTable(...)
  = the core Flarex table/row primitive

v.object(...), v.array(...), v.json()
  = embedded document-style values

v.relation.one(...), v.relation.many(...)
  = relational links backed by edge sidecars

v.blocks(...)
  = embedded block/component content backed by block/index/edge sidecars

.cms(...)
  = optional CMS/Payload exposure and lifecycle metadata

defineSection(...), defineTemplate(...), defineRegion(...)
  = higher-level commerce CMS authoring primitives compiled onto the same storage model
```

The primitive database model remains:

```text
typed relational schema catalog
+ authoritative row JSON
+ derived scalar indexes
+ derived relation/upload edges
+ derived block metadata
+ unique keys
+ commit/OCC/sync tables
```

This gives Flarex:

- Convex-like developer ergonomics, indexes, function execution, OCC, and live sync.
- Payload-compatible nested content, blocks, groups, relationships, uploads, drafts, versions, and globals.
- Shopify-inspired sections, templates, regions, presets, and commerce resource pickers.
- A fixed multitenant Postgres physical schema suitable for many apps in one database.

## Design goals

1. Keep Flarex schema as the source of truth.
2. Support simple document-style app tables without forcing CMS or relational modeling.
3. Support relational app tables using typed `v.relation.one` and `v.relation.many`.
4. Support Payload-compatible CMS collections and fields from the same schema metadata.
5. Support blocks as first-class Flarex fields, not as Payload-only internals.
6. Support commerce CMS authoring patterns inspired by Shopify sections, blocks, templates, regions, presets, and resource pickers.
7. Keep Postgres authoritative.
8. Keep Durable Objects for sync, freshness, live preview coordination, sessions, actors, and caches, not as the normal authoritative app database.
9. Avoid raw SQL/database handles in user code.
10. Avoid exposing Payload or Medusa internals directly to Flarex developers.

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

V1 should be a strong form-based CMS section/block editor with draft preview, not a full Shopify/Webflow-style visual builder.

## Primitive storage model

The same primitive storage model should support app rows, relational fields, CMS fields, and commerce sections.

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
  = derived relationship, upload, and picker edges

fx_block_index
  = derived block/section type, position, and path metadata

fx_unique_key
  = uniqueness enforcement

fx_commit / read sets / outbox / idempotency
  = transactional runtime, OCC, sync, and recovery
```

Blocks, groups, relations, uploads, and commerce picker values remain embedded in row JSON for normal read/render/edit flows, while Flarex derives sidecar rows for query, invalidation, uniqueness, and reverse lookup.

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

### 4. CMS block table

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

## Block storage shape

A CMS page row may contain:

```json
{
  "title": "Home",
  "slug": "home",
  "sections": [
    {
      "id": "blk_hero_1",
      "blockType": "hero",
      "variant": "split",
      "headline": "Build faster",
      "image": "media_123",
      "cta": {
        "label": "Start now",
        "href": "/start",
        "variant": "primary"
      }
    },
    {
      "id": "blk_grid_1",
      "blockType": "featuredCollection",
      "collection": "collection_123",
      "limit": 8
    }
  ]
}
```

Derived sidecars:

```text
fx_block_index
  page:home sections blk_hero_1 hero position=0
  page:home sections blk_grid_1 featuredCollection position=1

fx_edge_current
  page:home sections.blk_hero_1.image -> media:media_123
  page:home sections.blk_grid_1.collection -> collection:collection_123

fx_index_entry_current
  slug = home
  status/publishedAt = ...
```

This preserves Payload-like nested authoring while keeping Flarex relationally queryable and syncable.

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

v.commerce.product()
v.commerce.products({ max })
v.commerce.variant()
v.commerce.variants({ max })
v.commerce.collection()
v.commerce.collections({ max })

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
    collection: v.commerce.collection().required(),
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
    products: v.commerce.products({ max: 12 }),
  },
})
```

Internally:

```text
v.commerce.collection()
  -> relation to collections table
  -> row JSON value
  -> fx_edge_current / fx_edge_rev
  -> Payload/admin collection picker

v.commerce.products({ max: 12 })
  -> ordered relation list to products table
  -> row JSON array
  -> ordered edge rows
  -> Payload/admin product multi-picker
```

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

## Query and scalability rules

The section/block model is scalable only if the query compiler stays strict.

Allowed production query paths:

```text
get row by id
query by declared scalar/compound index
query by relation/edge
query by block type index
query by explicitly indexed block subfield
query by external search index
```

Avoid:

```text
arbitrary JSONB path scans
unbounded nested block filtering
unindexed block subfield queries
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
v.commerce.product
v.commerce.products
v.commerce.collection
v.commerce.collections
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
```

These should build on the same primitive storage model, not replace it.

## Implementation checklist

1. Add schema AST nodes for `defineBlock`, `defineSection`, `defineTemplate`, and `defineRegion`.
2. Keep `defineSection` as high-level sugar over block-like embedded section objects.
3. Add stable block/section ids to stored row JSON.
4. Add `fx_block_index` derivation for block/section type, path, position, and parent.
5. Derive `fx_edge_*` rows for relations/uploads/pickers inside blocks and sections.
6. Derive `fx_index_entry_*` rows for declared indexes, including block subfield indexes.
7. Add compiler support for commerce picker aliases over normal relations.
8. Generate Payload-compatible field/block configs from `.cms(...)` metadata.
9. Add CMS write policies and enforce them in mutation execution.
10. Add product/collection/media picker UI components in the admin.
11. Add form-based section/block editor UI.
12. Add draft preview URL/token support.
13. Add schema compile-time write amplification estimates.
14. Add query planner rejection for unindexed nested/block JSON queries.
15. Keep visual editor APIs out of v1 public docs.

## Open decisions

- Exact naming: `defineSection` vs `defineComponentSection`.
- Whether `v.upload(media)` should be core or sugar for `v.relation.one(media).cms({ widget: "upload" })`.
- Maximum default section count per template/page.
- Maximum default block count per section.
- Maximum nested block depth for v1.
- Whether regions are stored as Payload globals, Flarex system rows, or CMS singleton collections.
- How much Payload-specific admin metadata belongs in core schema vs `.cms(...)` metadata.
- Whether section presets are deploy-time schema metadata only or can be user-defined later.

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
+ Postgres-authoritative commit/OCC/sync
```
