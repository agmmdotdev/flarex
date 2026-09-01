# Configuration, Compilation, and Cloudflare Bindings

## Decision: `commerce.config.ts` Is the Source of Truth

Users should register framework and Cloudflare resources through a typed
configuration file instead of manually maintaining most Wrangler bindings.

```ts
export default defineCommerceConfig({
  modules: [productModule, cartModule, orderModule],

  services: [customRecommendationService],
  workflows: [customOrderWorkflow],
  routes: [customRoutes],
  jobs: [abandonedCartJob],
  consumers: [orderCreatedConsumer],

  cloudflare: {
    durableObjects: [inventoryCoordinator],
    agents: [shoppingAgent],
  },
})
```

Cloudflare still requires deployment metadata and exported classes. The
framework compiler should generate those artifacts rather than pretending they
do not exist.

## Decision: Vite Plugin for Dev and Build

The default developer experience should be:

```json
{
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

The project wires the framework through `vite.config.ts`:

```ts
import { defineConfig } from "vite"
import { commerce } from "@commerce/vite"

export default defineConfig({
  plugins: [
    commerce({
      config: "./commerce.config.ts",
      target: "cloudflare",
    }),
  ],
})
```

This does not replace `commerce.config.ts`. The split is:

```text
commerce.config.ts  -> commerce application definition
vite.config.ts      -> dev/build integration
.commerce/*         -> generated Worker and Cloudflare artifacts
```

The plugin should coordinate the Worker development runtime. Plain Vite dev
server behavior is browser-oriented; Workers need workerd/Wrangler/Miniflare
semantics for bindings, Durable Objects, Queues, Workflows, Cron, and Worker
entrypoint handlers.

## Vite Plugin Responsibilities

The `@commerce/vite` plugin should:

1. Load and validate `commerce.config.ts`.
2. Generate the static commerce manifest.
3. Expose virtual modules such as `virtual:commerce/manifest` and
   `virtual:commerce/env`.
4. Generate Worker entrypoints and typed binding declarations.
5. Generate Wrangler JSONC or equivalent deployment metadata.
6. Watch modules, routes, workflows, jobs, consumers, and config imports.
7. Regenerate artifacts on definition changes.
8. Restart or notify the Worker dev runtime when runtime-sensitive artifacts
   change.
9. Surface definition and binding errors through Vite diagnostics.
10. Support bundle analysis and entrypoint splitting during build.

The framework CLI can wrap this flow with `commerce dev`, but `yarn dev`
through Vite should remain the default simple path.

## Compiler Responsibilities

The compiler should:

1. Load `commerce.config.ts` in the CLI/Vite/build environment.
2. Normalize all definitions into a static manifest.
3. Validate duplicate names, missing dependencies, binding collisions, and
   invalid combinations.
4. Generate Worker entrypoints with the required exported handlers/classes.
5. Generate Wrangler JSONC or equivalent deployment configuration.
6. Generate typed `Env` binding declarations.
7. Generate route, workflow, queue, and schedule manifests.
8. Track Durable Object migration-sensitive changes.
9. Provide generated artifacts to the Vite plugin or CLI so they can start the
   Worker development runtime.

Generated files should live in a dedicated ignored directory such as:

```text
.commerce/
  manifest.json
  generated-env.d.ts
  store-worker.ts
  admin-worker.ts
  queue-worker.ts
  workflow-worker.ts
  wrangler.generated.jsonc
```

## User-Defined Cloudflare Resources

Do not replace Cloudflare's Durable Object or Agent APIs with incompatible
framework abstractions.

Instead, offer thin typed registration helpers:

```ts
export const inventoryCoordinator = defineDurableObject({
  name: "InventoryCoordinator",
  class: InventoryCoordinator,
})

export const shoppingAgent = defineAgent({
  name: "ShoppingAgent",
  class: ShoppingAgent,
})
```

Users still write classes using the Cloudflare APIs. Registration gives the
compiler the information required to export and bind them.

## Framework-Owned Resources

Built-in commerce functionality may require framework-owned bindings, such as:

- Workflow bindings.
- Event queues.
- Dead-letter queues.
- Durable Object namespaces.
- Database bindings.
- R2 upload storage.
- Analytics or observability bindings.

The compiler should add these automatically based on enabled modules and
features.

Example:

```ts
defineCommerceConfig({
  modules: [
    cartModule({
      abandonedCart: {
        enabled: true,
        after: "24h",
      },
    }),
  ],
})
```

This might require a schedule or workflow binding without the user manually
editing Wrangler configuration.

## Durable Object Migration Safety

Durable Object class names and migrations are stateful deployment contracts.

The compiler must:

- Detect class renames and removals.
- Require explicit migration intent.
- Never silently recreate a stateful namespace under a new class name.
- Keep generated migration metadata reviewable.

## Escape Hatches

Users need a supported way to provide:

- Additional raw Wrangler configuration.
- Existing bindings managed outside the framework.
- Custom Worker entrypoints.
- Custom build plugins.
- Cloudflare features not yet modeled by the framework.

Escape hatches should be merged and validated where possible, not hidden behind
unsupported file edits.

## Open Question

Should generated Wrangler configuration be committed, or always generated into
an ignored build directory? The initial recommendation is ignored generated
output plus a human-readable manifest/check command.

Another open question: should `vite preview` serve a production-like Worker
runtime, or should preview remain a Vite static preview while `commerce preview`
starts the Worker runtime explicitly?
