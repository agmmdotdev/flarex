# Flarex Commerce CMS Sections And Blocks

This note records the proposed high-level commerce CMS authoring layer for
Flarex.

It builds on the lower-level Flarex schema/database direction discussed in the
other design notes:

```text
one typed Flarex schema
+ authoritative row JSON
+ derived relational indexes
+ derived relation edges
+ derived block metadata
+ Payload-compatible CMS generation
+ Convex-inspired function execution, OCC, and live sync
```

The goal is to let developers build commerce/CMS frontends with a Shopify-like
section and block authoring model while keeping Flarex, not Payload, Medusa, or
Shopify, as the owner of the data plane.

This is a design direction. It is not an implementation status document.

## External References

This design borrows product concepts from Shopify Online Store themes, but it
should not copy Shopify's Liquid runtime or theme file model.

Useful Shopify references:

- Sections: https://shopify.dev/docs/storefronts/themes/architecture/sections
- Blocks: https://shopify.dev/docs/storefronts/themes/architecture/blocks
- JSON templates: https://shopify.dev/docs/storefronts/themes/architecture/templates/json-templates
- Section groups: https://shopify.dev/docs/storefronts/themes/architecture/section-groups
- Input settings: https://shopify.dev/docs/storefronts/themes/architecture/settings/input-settings
- Theme block schema and presets: https://shopify.dev/docs/storefronts/themes/architecture/blocks/theme-blocks/schema

The important ideas to borrow are:

```text
templates/pages contain ordered sections
sections have settings
sections can contain ordered blocks
blocks have settings
settings include commerce-aware pickers
presets make adding sections/blocks easy
header/footer-like areas are editable regions
```

The ideas not to copy are:

```text
Liquid as the application runtime
Shopify theme JSON files as the source of truth
settings_data.json as the physical storage model
unrestricted custom Liquid/HTML settings
arbitrary third-party app blocks in v1
deep nested block trees in v1
Shopify-specific object handles as canonical ids
```

## Product Position

Flarex should support a form-based component-block CMS first.

V1 should not promise a full Shopify/Webflow visual editor. Visual selection,
iframe overlays, direct drag/drop on the rendered page, inline editing, and
collaborative canvas state are product layers that can be added later.

V1 should provide:

```text
section/block definitions
ordered section lists
block add/remove/duplicate/reorder
variant selectors
media pickers
commerce resource pickers
relation pickers
drafts and preview URLs
Payload-compatible admin generation
```

This gives most of the commerce CMS value while preserving a small and stable
storage/runtime core.

## Core Design Rule

The commerce CMS layer must compile to the same primitive Flarex database model:

```text
fx_table / fx_field / fx_index_def
fx_row_current / fx_row_rev
fx_index_entry_current / fx_index_entry_rev
fx_edge_current / fx_edge_rev
fx_block_index
fx_unique_key
fx_commit / read-set / outbox / idempotency
```

No separate Shopify database model should exist.

No separate Payload-owned physical schema should be required for normal app
content.

No raw SQL or Medusa/Payload internal repositories should leak to Flarex app
developers.

## Primitive Schema Relationship

The lower-level schema stays generic:

```ts
const pages = defineTable({
  title: v.string(),
  slug: v.string().unique(),
  sections: v.blocks([Hero, FeaturedCollection, RichText]),
}).cms({
  collection: "pages",
  drafts: true,
  versions: true,
  writes: "cmsOnly",
})
```

The high-level commerce CMS API is sugar on top:

```ts
const HomeTemplate = defineTemplate({
  slug: "home",
  label: "Homepage",
  context: "page",
  sections: [HeroSection, FeaturedCollectionSection, RichTextSection],
})
```

Both compile to row JSON plus sidecars.

## Concepts

### Template

A template describes the allowed section composition for a route or resource
context.

Examples:

```text
home
page.default
product.default
collection.default
blog.default
article.default
search
cart
account
```

Recommended API:

```ts
const ProductTemplate = defineTemplate({
  slug: "product.default",
  label: "Default product template",
  context: "product",
  sections: [
    ProductMainSection,
    ProductRecommendationsSection,
    RecentlyViewedSection,
  ],
  limits: {
    maxSections: 25,
    maxBlocksPerSection: 50,
  },
})
```

Storage shape:

```json
{
  "template": "product.default",
  "context": {
    "type": "product"
  },
  "sections": [
    {
      "id": "sec_productMain_1",
      "sectionType": "productMain",
      "settings": {},
      "blocks": []
    },
    {
      "id": "sec_recommendations_1",
      "sectionType": "productRecommendations",
      "settings": {}
    }
  ]
}
```

### Region

A region is an editable layout-owned area such as header, footer, announcement
bar, cart drawer, or sidebar.

This is the Flarex name for the concept Shopify calls section groups.

Recommended API:

```ts
const HeaderRegion = defineRegion({
  slug: "header",
  label: "Header",
  type: "header",
  sections: [AnnouncementBar, HeaderNavigation, SearchBar],
  maxSections: 25,
})

const FooterRegion = defineRegion({
  slug: "footer",
  label: "Footer",
  type: "footer",
  sections: [FooterNavigation, NewsletterSignup, SocialLinks],
})
```

Storage shape:

```text
fx_row_current table=fx_cms_regions row_id=header
fx_row_current table=fx_cms_regions row_id=footer
```

### Section

A section is a top-level page-building unit: hero, image-with-text, featured
collection, product information, testimonials, announcement bar, footer, etc.

Recommended API:

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
    {
      name: "Split hero with image",
      category: "Marketing",
      settings: {
        variant: "split",
        headline: "New season essentials",
      },
    },
  ],
})
```

A section is represented in row JSON as a block-like object with a stable id and
section type:

```json
{
  "id": "sec_hero_1",
  "sectionType": "hero",
  "settings": {
    "variant": "split",
    "headline": "New season essentials",
    "image": "media_123"
  }
}
```

### Block

A block is an ordered child item inside a section or, later, inside another
block.

Blocks are useful for slides, buttons, product info rows, collapsible tabs,
testimonial cards, icon rows, navigation items, and similar repeatable content.

Recommended API:

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

Storage shape:

```json
{
  "id": "sec_slideshow_1",
  "sectionType": "slideshow",
  "settings": {
    "autoplay": false,
    "interval": 5
  },
  "blocks": [
    {
      "id": "blk_slide_1",
      "blockType": "slide",
      "image": "media_123",
      "heading": "New arrivals"
    }
  ]
}
```

### Preset

A preset is a default section or block configuration that appears in the add
section/block drawer.

Presets are important because they let editors start from real commerce layouts
instead of empty forms.

Recommended section preset shape:

```ts
presets: [
  {
    name: "Commerce homepage",
    category: "Commerce",
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
]
```

## Commerce CMS Field Library

The normal primitive fields remain available:

```ts
v.string()
v.number()
v.boolean()
v.enum([...])
v.object({...})
v.group({...})
v.array(...)
v.json()
v.blocks([...])
v.relation.one(table)
v.relation.many(table)
```

The commerce CMS layer should add semantic aliases that compile to relations,
edges, and editor picker metadata.

### Commerce Resources

```ts
v.commerce.product()
v.commerce.products({ max?: number })

v.commerce.variant()
v.commerce.variants({ max?: number })

v.commerce.collection()
v.commerce.collections({ max?: number })

v.commerce.category()
v.commerce.categories({ max?: number })
```

Example:

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
```

Internal compilation:

```text
collection setting
  -> row JSON value
  -> typed relation to commerce collections table
  -> fx_edge_current source section -> target collection
  -> picker metadata for the admin UI
```

### Content Resources

```ts
v.cms.page()
v.cms.pages({ max?: number })

v.cms.article()
v.cms.articles({ max?: number })

v.cms.entry(table)
v.cms.entries(table, { max?: number })
```

Example:

```ts
const Testimonials = defineTable({
  author: v.string(),
  quote: v.string(),
  avatar: v.optional(v.media.image()),
}).cms({
  collection: "testimonials",
})

const TestimonialSection = defineSection({
  slug: "testimonials",
  label: "Testimonials",
  settings: {
    heading: v.string(),
    items: v.cms.entries(Testimonials, { max: 12 }),
  },
})
```

Use Flarex terms such as `entry` instead of Shopify-specific terms such as
`metaobject` in the primary public API. A future Shopify import/export adapter
can map between terms.

### Media And Design Settings

V1 should keep these small:

```ts
v.media.image()
v.media.video()
v.media.file()

v.design.color()
v.design.colorScheme()
v.design.range({ min, max, step })
v.design.select([...])
v.design.spacing()
v.design.textAlign()
v.url()
v.richText()
```

Avoid unrestricted editable code fields in v1:

```text
custom Liquid
custom HTML
custom JavaScript
custom CSS
```

If any custom-code field is added later, it must be sandboxed, size-limited,
capability-limited, and clearly separated from trusted runtime code.

## Example: Commerce Homepage

```ts
const Hero = defineSection({
  slug: "hero",
  label: "Hero",
  category: "Marketing",
  settings: {
    variant: v.enum(["centered", "split"]),
    heading: v.string(),
    subheading: v.optional(v.string()),
    image: v.media.image(),
    ctaLabel: v.string(),
    ctaUrl: v.url(),
  },
})

const FeaturedCollection = defineSection({
  slug: "featuredCollection",
  label: "Featured collection",
  category: "Commerce",
  settings: {
    heading: v.string(),
    collection: v.commerce.collection(),
    limit: v.number().min(2).max(24).default(8),
    showQuickAdd: v.boolean().default(true),
  },
})

const ProductCarousel = defineSection({
  slug: "productCarousel",
  label: "Product carousel",
  category: "Commerce",
  settings: {
    heading: v.string(),
    products: v.commerce.products({ max: 12 }),
  },
})

const HomeTemplate = defineTemplate({
  slug: "home",
  label: "Homepage",
  context: "page",
  sections: [Hero, FeaturedCollection, ProductCarousel],
  presets: [
    {
      name: "Commerce homepage",
      sections: [
        {
          type: "hero",
          settings: {
            variant: "split",
            heading: "New arrivals",
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

## Example: Product Template

```ts
const ProductTitle = defineBlock({
  slug: "productTitle",
  label: "Product title",
  fields: {
    headingSize: v.enum(["sm", "md", "lg"]).default("lg"),
  },
})

const ProductPrice = defineBlock({
  slug: "productPrice",
  label: "Product price",
  fields: {
    showCompareAt: v.boolean().default(true),
    showTaxNote: v.boolean().default(true),
  },
})

const BuyButtons = defineBlock({
  slug: "buyButtons",
  label: "Buy buttons",
  fields: {
    showDynamicCheckout: v.boolean().default(true),
    showQuantitySelector: v.boolean().default(true),
  },
})

const ProductMain = defineSection({
  slug: "productMain",
  label: "Product information",
  category: "Commerce",
  contexts: ["product"],
  settings: {
    mediaLayout: v.enum(["stacked", "carousel", "grid"]).default("carousel"),
    stickyInfo: v.boolean().default(true),
  },
  blocks: v.blocks([
    ProductTitle,
    ProductPrice,
    VariantPicker,
    BuyButtons,
    ProductDescription,
    CollapsibleTab,
    ComplementaryProducts,
  ], {
    max: 30,
  }),
})

const ProductTemplate = defineTemplate({
  slug: "product.default",
  label: "Default product",
  context: "product",
  sections: [ProductMain, ProductRecommendations],
})
```

This mirrors the useful Shopify pattern where product templates are composed
from a main product section plus ordered product-information blocks, but Flarex
should not copy Liquid or Shopify theme internals.

## Payload Mapping

The Flarex API should generate Payload-compatible collection/global/block config
where CMS is enabled.

| Flarex concept | Payload-compatible output | Storage |
| --- | --- | --- |
| `defineTable(...).cms({ collection })` | Payload collection | `fx_row_*` plus sidecars |
| `defineRegion(...)` | Payload global or singleton collection | region row JSON |
| `defineTemplate(...)` | CMS template metadata and page/global rows | row JSON |
| `defineSection(...)` | block-like config with settings fields | embedded section JSON |
| `defineBlock(...)` | Payload block config | embedded block JSON |
| `v.commerce.product()` | relationship field with product picker | relation edge |
| `v.commerce.products()` | has-many relationship picker | ordered relation edges |
| `v.commerce.collection()` | relationship field with collection picker | relation edge |
| `v.media.image()` | upload/media field | relation edge to media |
| `v.cms.entry(table)` | relationship to CMS collection | relation edge |
| `v.design.color()` | text/select/admin field metadata | row JSON |
| preset | admin drawer default | schema metadata |

Payload should be a CMS/admin harness and lifecycle engine. Flarex schema remains
the source of truth.

## Database Mapping

High-level concepts must compile to primitive Flarex storage:

| High-level concept | Primitive storage |
| --- | --- |
| Template | row JSON with `sections[]` |
| Region/header/footer | singleton/global row with `sections[]` |
| Section | embedded object with stable `id`, `sectionType`, `settings`, optional `blocks[]` |
| Block | embedded object with stable `id`, `blockType`, fields |
| Preset | schema/catalog metadata |
| Product picker | `v.relation.one(products)` plus `fx_edge_current` |
| Product list | `v.relation.many(products)` plus ordered edges |
| Collection picker | `v.relation.one(collections)` plus edge |
| CMS entry picker | relation to CMS table plus edge |
| Image picker | media/upload relation plus edge |
| Settings | typed field schema inside section/block |
| Section order | JSON array order plus `fx_block_index.position` |
| Block order | nested JSON array order plus `fx_block_index.position` |

Example derived sidecars for a page:

```text
fx_block_index:
  page home has section hero at sections[0]
  page home has section featuredCollection at sections[1]
  page home has block buyButtons at sections[0].blocks[2]

fx_edge_current:
  sections.sec_hero_1.settings.image -> media_123
  sections.sec_featuredCollection_1.settings.collection -> collection_123
  sections.sec_productCarousel_1.settings.products[0] -> product_456

fx_index_entry_current:
  slug = "home"
  status/publishedAt = published, timestamp
```

The row JSON remains authoritative. Sidecars are derived for querying,
invalidation, uniqueness, relations, and live sync.

## Query And Sync Implications

Commerce CMS queries should be index/edge-backed.

Good:

```ts
ctx.db.query("pages")
  .withIndex("bySlug", q => q.eq("slug", slug))
  .unique()
```

Good:

```ts
ctx.db.query("pages")
  .withBlock("sections", "featuredCollection")
  .take(20)
```

Only allowed if block type indexing is declared:

```ts
sections: v.blocks([...]).indexBlockTypes()
```

Good:

```ts
ctx.db.related("pages", "sections.*.settings.collection")
  .from(collectionId)
  .take(20)
```

This must compile to `fx_edge_current`, not a JSON scan.

Avoid:

```text
arbitrary JSON path scans over sections
arbitrary filter over nested blocks without declared indexes
full-text rich text search through core row JSON
cross-app analytics on OLTP tables
```

## Blocks, Sections, And IDs

Every section and block instance should have a stable internal id.

```json
{
  "id": "sec_hero_1",
  "sectionType": "hero",
  "settings": {}
}
```

```json
{
  "id": "blk_button_1",
  "blockType": "button",
  "label": "Buy now"
}
```

Stable ids are needed for:

```text
draft editing
versions
OCC/read-set precision
edge derivation
block index derivation
future visual-editor selection
future collaboration
future block-to-block references
```

The public editor does not need to expose these ids directly.

## Block-To-Block References

V1 does not need visual wires between blocks. If references are needed, keep them
local to the same document by default.

Possible future API:

```ts
v.blockRef({
  within: "sections",
  allowedTypes: ["pricing", "signupForm"],
})
```

Rules:

```text
block refs are same-document by default
block ids are stable
validate target exists
validate target block type is allowed
avoid arbitrary cyclic block graphs in v1
```

Most commerce CMS relationships should point to real data rows such as products,
collections, media, pages, or CMS entries instead of to other embedded blocks.

## Reusable Sections And Blocks

V1 can defer reusable shared sections.

When added, model reusable content as real CMS rows, not as invisible shared
block internals.

Example:

```ts
const reusableSections = defineTable({
  name: v.string(),
  section: v.singleBlock([HeroSection, BannerSection, CtaSection]),
}).cms({
  collection: "reusableSections",
})

const ReusableSectionRef = defineSection({
  slug: "reusableSection",
  label: "Reusable section",
  settings: {
    section: v.relation.one(reusableSections),
  },
})
```

Tradeoff:

```text
embedded section
  = page owns content, simpler drafts/versions

reusable section relation
  = shared updates, harder invalidation/version semantics
```

Reusable content requires edge invalidation so every page that references it can
refresh or resync correctly.

## Limits

Start with conservative limits.

Recommended v1 defaults:

```text
max sections per template/page: 25
max blocks per section: 50
max nesting depth: 2 or 3
max commerce product list picker size: 50
max collection list picker size: 50
max block/section JSON size: bounded by row-size limits
max derived index entries per row: schema-compiled ceiling
max derived edges per row: schema-compiled ceiling
```

These numbers can be configurable later, but Flarex should keep explicit limits
so one tenant cannot generate unbounded write amplification in a shared
multitenant database.

## V1 Scope

V1 should include:

```text
defineSection
defineBlock
defineTemplate
defineRegion
section settings
section blocks
ordered blocks
block presets
section presets
commerce product picker
commerce product list picker
commerce collection picker
commerce collection list picker
media image picker
rich text
URL
color/select/range/boolean/text settings
header/footer regions
draft/preview URL support
Payload-compatible config generation
row JSON + edge/index/block sidecar compilation
```

V1 should not include:

```text
full visual editor
Liquid/custom-code settings
arbitrary app blocks from third-party extensions
deep nested block trees
Shopify theme export/import
theme marketplace compatibility
third-party app block runtime
inline editing inside preview iframe
frontend canvas drag/drop
collaborative visual editor state
```

## V2 And Later

V2 can add:

```text
light visual inspector
click a block in preview to open its form
stable frontend data attributes for selected blocks
live preview refresh without full page reload
reusable shared sections
nested theme blocks
market/context-specific regions
A/B templates
Shopify import/export adapter
```

Research/future:

```text
app/extension blocks
component marketplace
inline editing
canvas overlays
drag/drop in rendered preview
collaborative editing/presence
theme preset marketplace
custom-code sandbox
```

## Final Architecture Boundary

```text
Flarex primitive schema
  defineTable, defineBlock, v.blocks, v.group, v.relation, v.json

Flarex commerce CMS layer
  defineSection, defineTemplate, defineRegion,
  v.commerce.*, v.cms.*, v.media.*, v.design.*

Payload adapter/generator
  form-based admin, blocks, drafts, versions, globals, media, access/hooks

Medusa/commerce harness
  commerce behavior and product/catalog/order logic behind ctx.commerce

Postgres authoritative store
  row JSON, indexes, edges, block metadata, commit/OCC/outbox/idempotency

Cloudflare runtime
  generated APIs, function execution, live query sync, preview routing
```

The public product should feel like:

```text
Developers define typed sections and blocks.
Editors compose pages using form-based section/block controls.
Commerce pickers connect sections to products, variants, collections, media, and CMS entries.
Flarex compiles everything to one multitenant Postgres-authoritative storage engine.
```

That is the v1 target. Shopify-like visual editing can come later without
changing the primitive schema if stable section/block ids, sidecars, and preview
metadata exist from the beginning.
