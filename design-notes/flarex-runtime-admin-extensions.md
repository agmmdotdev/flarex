# Flarex Runtime Admin Extensions

This note records the proposed architecture for user-defined admin UI
extensions in a centralized Flarex dashboard that combines Flarex app data,
Medusa commerce, and Payload-style CMS behavior.

The key decision is:

```text
Flarex dashboard is a stable central shell.
User admin UI is built and deployed separately.
Dashboard extension injection happens at runtime from signed manifests.
User components talk to the dashboard only through scoped Flarex Admin ctx APIs.
```

This follows the same design philosophy as Flarex backend functions and
components: user code can extend the platform, but it does not get implicit
access to host internals.

## Why Payload And Medusa Admin Extension Models Are Not Enough

Payload and Medusa both have useful admin extension concepts, but their native
extension mechanisms assume the extension is part of the app build.

Payload custom admin components are configured through component paths and a
generated import map. The import map is regenerated during startup, build, HMR,
or manual generation. That works for a single app admin build, but not for a
central dashboard that must load many tenant/project extensions at runtime.

Medusa Admin has strong concepts for UI routes, widgets, menus, custom fields,
and injection zones. In the current Medusa admin implementation, route and
widget files are discovered by a Vite plugin from admin source folders and
statically imported into generated virtual modules. The dashboard then consumes
those plugin modules. This is a good shape for local Medusa apps, but the build
time discovery model does not fit a centralized Flarex dashboard.

Therefore Flarex should borrow the concepts, not the direct mechanisms:

```text
Borrow:
  Medusa-style routes, widgets, menus, injection zones
  Payload-style component slots around CMS collections, fields, views, blocks

Do not expose:
  raw Medusa admin widgets/plugins
  raw Payload admin components/plugins
  build-time imports into the central Flarex dashboard
```

## Design Philosophy

```text
Flarex owns:
  dashboard shell
  runtime extension loader
  signed extension manifests
  slot registry
  user/session/project/deployment context
  admin ctx capability enforcement
  audit logs
  sandbox policy

Medusa owns:
  commerce semantics
  commerce operations
  commerce workflow meaning
  commerce validation rules

Payload owns:
  CMS operation semantics
  CMS field behavior
  CMS lifecycle rules
  CMS validation/access semantics

User components own:
  their own extension UI
  their own declared admin routes/widgets
  their own declared component capabilities
```

The public extension model should be Flarex-first:

```text
Components extend Flarex dashboard slots.
Flarex translates intent into commerce/CMS/app APIs.
Developers do not extend Medusa or Payload internals directly.
```

## Extension Build And Deploy Model

Each Flarex component can include backend functions and admin frontend code.
They should be built as separate artifacts, even when they are activated under
one deployment version.

```text
component source
  -> schema and capability metadata
  -> backend functions bundle
  -> admin UI bundle
  -> admin extension manifest

recommended source layout
  component/schema/*
  component/functions/*
  component/admin/*

schema artifact
  -> table definitions, indexes, relations, CMS/commerce/admin metadata,
     declared capabilities, and migration/deployment manifest

backend artifact
  -> user functions/actions/workflows, backend runtime metadata, and
     isolate/Dynamic Worker bundle

admin artifact
  -> admin extension manifest, JS/CSS/assets bundle, renderer policy,
     integrity hashes, and slot/route declarations

admin extension manifest
  -> extension id
  -> component version
  -> target project/deployment
  -> route and slot declarations
  -> bundle URLs
  -> integrity hashes
  -> renderer policy
  -> declared capabilities
  -> required Flarex Admin SDK version
```

Do not bundle admin UI into the backend artifact. The runtimes have different
security, caching, deployment, and compatibility requirements:

```text
backend artifact
  -> server-side execution
  -> no browser APIs
  -> isolated function runtime
  -> Flarex backend ctx
  -> strict resource limits

admin artifact
  -> browser execution
  -> CDN/R2 asset delivery
  -> iframe/native renderer contract
  -> Flarex Admin ctx RPC
  -> UI SDK compatibility and asset integrity
```

The deploy command can build them in one pipeline, but it should publish them
as separate artifacts:

```text
flarex deploy
  -> compile schema
  -> build backend functions
  -> build admin extension bundle
  -> upload backend artifact to function runtime storage
  -> upload admin assets to Flarex asset storage/CDN/R2
  -> publish deployment manifest
  -> activate deployment version atomically

deployment version v42
  schemaManifest: v42/schema.json
  backendBundle: v42/functions.bundle
  adminManifest: v42/admin/manifest.json
  adminAssets: v42/admin/assets/*
```

That gives Flarex both properties:

```text
separate physical artifacts and runtimes
one coherent active deployment version
```

The central dashboard does not rebuild when a project installs or updates a
component. Instead:

```text
dashboard startup / project switch
  -> fetch extension manifest list for project/deployment
  -> verify manifest signatures and integrity
  -> filter by current user permissions
  -> render matching routes and slots at runtime
```

## Renderer Strategy

The extension contract should be renderer-agnostic.

The first foundation renderer should be sandboxed iframe islands for
user-owned, tenant-owned, and marketplace components:

```text
sandboxed iframe
  -> real browser isolation boundary
  -> separate JS global/window
  -> restricted storage/navigation/forms/popups
  -> communication only through postMessage/RPC
```

An optional native renderer can come later for trusted first-party Flarex
components:

```text
native renderer / Isolet-like Shadow DOM renderer
  -> faster integration
  -> better UX for trusted code
  -> style/package isolation
  -> not a security boundary
```

Do not make Isolet, Module Federation, or Shadow DOM the core security model.
They can help packaging and styling, but untrusted components still need iframe
or equivalent browser isolation.

## Developer API Shape

The developer writes one API. Flarex decides how to render it.

```ts
export default defineAdminExtension({
  id: "reviews-admin",
  slots: [
    defineCommerceAdminComponent({
      slot: "commerce.product.list.before",
      label: "Product List Banner",
      component: "./ProductListBanner",
      capabilities: {
        commerce: { read: ["product"] },
        db: { read: ["reviews"], write: ["reviews"] },
        actions: ["reviews.syncFromSupplier"],
        ui: ["toast", "navigate"],
      },
    }),

    defineCommerceAdminComponent({
      slot: "commerce.product.details.side",
      label: "Reviews",
      component: "./ProductReviewsPanel",
      capabilities: {
        commerce: { read: ["product"] },
        db: { read: ["reviews"], write: ["reviews"] },
        actions: ["reviews.approve", "reviews.reject"],
        ui: ["toast", "dialog"],
      },
    }),

    defineCmsAdminComponent({
      slot: "cms.collection.posts.edit.afterFields",
      label: "SEO Preview",
      component: "./SeoPreview",
      capabilities: {
        cms: { read: ["posts"] },
        ui: ["toast"],
      },
    }),

    defineAdminRoute({
      path: "/reviews",
      label: "Reviews",
      component: "./ReviewsPage",
      capabilities: {
        db: { read: ["reviews"], write: ["reviews"] },
        actions: ["reviews.moderate"],
      },
    }),
  ],
})
```

The `slot` names are Flarex-owned. They can be inspired by Medusa and Payload
but should stay stable even if the internal commerce or CMS engine changes.

Examples:

```text
commerce.product.list.before
commerce.product.list.after
commerce.product.details.side
commerce.product.details.actions
commerce.order.details.timeline.after
commerce.cart.details.actions

cms.collection.posts.list.toolbar
cms.collection.posts.edit.beforeFields
cms.collection.posts.edit.afterFields
cms.field.posts.body.preview
cms.global.settings.edit.side

app.dashboard.cards
app.nav.primary
app.settings.project.after
```

## Admin Component Runtime Props

Admin components receive slot data and a scoped admin ctx.

```tsx
function ProductListBanner({ ctx, data }: AdminComponentProps) {
  return (
    <button
      onClick={async () => {
        await ctx.action("reviews.syncFromSupplier", {
          filters: data.filters,
        })
        ctx.toast.success("Supplier sync started")
      }}
    >
      Sync supplier catalog
    </button>
  )
}
```

Slot data is owned by the dashboard screen:

```text
commerce.product.list.before slot data
  -> current filters
  -> selected product ids
  -> current page/sort
  -> total count if known
  -> user/deployment/project metadata
```

Slot data should be useful context, not a privileged object. Mutating data must
go through `ctx`.

## Admin Ctx

Admin frontend ctx is not the same as backend function ctx.

```text
backend ctx
  ctx.db
  ctx.commerce
  ctx.cms
  ctx.auth
  ctx.storage
  ctx.runAction

admin frontend ctx
  ctx.query
  ctx.subscribe
  ctx.mutation
  ctx.action
  ctx.commerce
  ctx.cms
  ctx.toast
  ctx.dialog
  ctx.navigate
  ctx.selection
  ctx.theme
  ctx.refresh
```

Admin ctx is a scoped client capability object:

```text
ctx is generated per component instance
ctx is scoped to the extension manifest
ctx is scoped to current project/deployment/tenant
ctx is scoped to the current admin user permissions
ctx is revocable
ctx calls are audited
ctx never exposes raw tokens
ctx never exposes raw Postgres, Medusa, Payload, or dashboard internals
```

For iframe mode:

```text
component iframe
  -> calls Flarex Admin SDK
  -> SDK sends postMessage/RPC to dashboard shell
  -> dashboard checks declared capabilities and current user permission
  -> dashboard calls Flarex backend/admin endpoint
  -> backend rechecks capabilities and permissions
  -> result returns over RPC
```

For a future native trusted renderer:

```text
dashboard loads trusted bundle
  -> creates same scoped ctx object
  -> mounts component into slot
  -> ctx calls still pass through capability gates
```

The transport changes, not the developer API.

## Capability Enforcement

The manifest declares what the component wants:

```ts
capabilities: {
  commerce: { read: ["product"], write: [] },
  cms: { read: ["posts"], write: [] },
  db: { read: ["reviews"], write: ["reviews"] },
  actions: ["reviews.approve"],
  ui: ["toast", "dialog", "navigate"],
}
```

Every ctx call must pass two checks:

```text
manifest capability check
  -> did this extension declare this operation?

admin permission check
  -> is the current user allowed to perform it now?
```

The backend must repeat the checks. Frontend checks are for UX and defense in
depth, not the authority.

## Runtime Injection Flow

Example for a small UI before the product list:

```text
1. Dashboard opens Product List.
2. Dashboard loads current project's extension manifests.
3. Dashboard finds components registered for commerce.product.list.before.
4. Dashboard creates slot data:
     filters, selected ids, sort, total count, deployment/user metadata.
5. Dashboard creates scoped admin ctx for each component.
6. Dashboard renders each component in sandboxed iframe.
7. Component calls ctx.action or ctx.commerce through RPC.
8. Dashboard/backend enforce capabilities and permissions.
9. Component receives result and may call ctx.toast or ctx.refresh.
```

The component never imports or mutates the product list implementation. It only
occupies a declared slot.

## Relationship To Live Sync

Admin extensions should use the same query/sync engine as the rest of Flarex.

```text
ctx.subscribe(...)
  -> registers live query for the component instance
  -> query records read set
  -> commit summary invalidates through DeploymentSyncDO
  -> dashboard/iframe receives transition
```

This keeps app admin widgets, commerce widgets, and CMS widgets on the same
Flarex live-sync path:

```text
query result + read set
commit summary
DeploymentSyncDO overlap check
rerun affected query
push changed result to component
```

## What Not To Expose

Do not expose these to user extensions:

```text
raw Payload admin plugin injection
raw Medusa admin plugin/widget injection
raw Payload config mutation
raw Medusa module links
raw dashboard React internals
raw route registry mutation
raw Postgres/Hyperdrive/D1 access
raw auth/session tokens
same-page arbitrary JS for untrusted extensions
```

Flarex can implement internal adapters that translate Flarex admin slots into
Medusa/Payload behavior, but the public surface remains Flarex-owned.

## Risks

- Runtime admin extension loading can become a security liability if untrusted
  components run as same-page JavaScript.
- Too many low-level slots can recreate Medusa/Payload plugin complexity under
  a new name.
- If `ctx` exposes broad APIs, component capabilities become meaningless.
- If backend permission checks rely on frontend checks, iframe isolation is not
  enough.
- If the dashboard shell and extension SDK versioning are loose, old component
  bundles can break new dashboards.
- If all extensions are iframes, UX and layout integration need careful slot
  sizing, theming, focus, and keyboard handling.

## Current Decision

- Build one Flarex Admin Extension API.
- Use runtime signed manifests for admin extension discovery.
- Build schema, backend functions, and admin UI as separate artifacts, even
  when one deploy command activates them under the same deployment version.
- Do not bundle admin UI into backend function artifacts.
- Publish admin assets separately to Flarex-managed asset storage/CDN/R2 and
  reference them from the signed admin manifest with integrity hashes.
- Use sandboxed iframe islands first for user-owned and marketplace
  extensions.
- Keep native/Isolet-like rendering optional for trusted first-party extensions
  only.
- Provide one scoped admin ctx API regardless of renderer.
- Enforce capabilities in both dashboard shell and backend.
- Model extension points as Flarex-owned slots inspired by Medusa injection
  zones and Payload component slots.
- Do not expose raw Medusa Admin or Payload Admin plugin systems to app
  developers.
- Keep admin extension frontend code isolated just like Flarex backend
  functions are isolated.
