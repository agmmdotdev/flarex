# Commerce CMS Sections And Blocks Roadmap

This roadmap records work related to the high-level commerce CMS authoring layer:
sections, blocks, templates, regions, presets, resource pickers, and their mapping
onto the primitive Flarex row/index/edge/block storage model.

## Current Status

The first checkpoint is design-only. No runtime code, schema migrations, API
exports, Payload generator, or admin UI implementation exists yet.

## Checkpoint History

### Add commerce CMS sections and blocks design note

- What changed:
  - Added `design-notes/flarex-commerce-cms-sections-blocks.md`.
  - Recorded a Shopify-inspired, Payload-compatible commerce CMS authoring layer
    with `defineSection`, `defineTemplate`, `defineRegion`, commerce/resource
    picker field aliases, presets, section/block storage shape, v1/v2 scope, and
    the mapping back to Flarex primitive row/index/edge/block sidecars.
- Why it changed:
  - The design discussion concluded that visual editing is too large for v1, but
    a form-based commerce CMS section/block model is useful now.
  - The note preserves the primitive Flarex schema direction while adding higher
    level authoring APIs for commerce storefront/page-builder use cases.
- Previous completed checkpoint:
  - `b115b14d6709b30637f40149bc5cf1ef0a5ce5c9` — Add draft design notes for
    Flarex Realtime Room Actors and Runtime Admin Extensions.
- Convex source files inspected or used as inspiration:
  - None in this docs-only checkpoint. The note assumes the existing
    Convex-inspired Flarex runtime/OCC/index model remains the foundation, but
    this domain concerns commerce CMS authoring primitives rather than Convex
    storage/runtime internals.
- How the Flarex design differs from Convex:
  - Convex-like `defineTable`, indexed queries, function execution, OCC, and sync
    remain the lower-level mental model.
  - Flarex adds a CMS/commerce layer with sections, blocks, templates, regions,
    resource pickers, Payload-compatible generation, and sidecar edge/block
    indexing for storefront content.
- Known limitations or follow-up work:
  - No implementation exists for `defineSection`, `defineTemplate`,
    `defineRegion`, or `v.commerce.*` aliases.
  - No Payload generator integration exists for the section/block layer.
  - No admin UI exists for section add/remove/reorder, presets, or resource
    pickers.
  - No migrations or runtime storage sidecar implementation was changed.
  - Visual editor, iframe selection, inline editing, app blocks, custom code
    fields, Shopify import/export, and deep nested blocks remain future scope.
- Verification commands run:
  - Not run. Documentation-only change.
