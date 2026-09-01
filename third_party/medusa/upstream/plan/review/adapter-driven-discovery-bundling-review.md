# Review: Adapter-Driven Module Discovery (Static Import Bundling Problem)

## Commits Reviewed

- `7d32b9c646` — refactor: make module discovery persistence adapter-driven
- `d092d7d72c` — docs: record adapter-driven module discovery

## Verdict

The runtime adapter dispatch logic is correct. The `ModulePersistenceAdapter`
contract, the discovery threading, and the test coverage are solid. However the
approach **does not achieve Cloudflare bundle isolation** because the MikroORM
default adapter is statically imported by the shared infrastructure. A bundler
follows the static import graph, not runtime control flow.

---

## Problem: Static Imports Defeat Conditional Dispatch

A conditional runtime check (`if/else`, duck-typing guard, default parameter)
does not prevent a bundler from including the statically imported module in the
output. If the source file contains
`import { ... } from "./module-persistence-adapter"`, MikroORM code ships in
the bundle regardless of whether the code path executes.

### Where the static imports live

| File | What it imports | Why it pulls MikroORM |
|------|----------------|----------------------|
| `load-internal.ts` L32 | `ModulesSdkUtils` (namespace import of `@medusajs/utils/modules-sdk`) | The namespace barrel includes `mikroOrmModulePersistenceAdapter`, which imports `toMikroOrmEntities`, `MikroOrmBaseRepository`, `mikroOrmConnectionLoaderFactory`, and transitively `@mikro-orm/core` |
| `container-loader-factory.ts` L16–17 | `mikroOrmModulePersistenceAdapter` directly | Used as default parameter value — bundler must include it |
| `modules-sdk/index.ts` L12 | `export * from "./loaders/module-persistence-adapter"` | Re-exports the MikroORM adapter from the barrel; any consumer of `@medusajs/utils` modules-sdk inherits it |

### Import graph

```
load-internal.ts
  └─ import ModulesSdkUtils from @medusajs/utils
       └─ modules-sdk/index.ts  (barrel)
            ├─ export * from module-persistence-adapter.ts
            │    ├─ import toMikroOrmEntities        → @mikro-orm/core
            │    ├─ import MikroOrmBaseRepository     → @mikro-orm/core
            │    └─ import mikroOrmConnectionLoaderFactory → @mikro-orm/core
            ├─ export * from mikro-orm-connection-loader
            ├─ export * from mikro-orm-connection-loader-factory
            ├─ export * from create-medusa-mikro-orm-event-subscriber
            ├─ export * from migration-scripts        → @mikro-orm/migrations
            └─ export * from medusa-internal-service   → toMikroOrmEntities

container-loader-factory.ts
  └─ import { mikroOrmModulePersistenceAdapter }
       └─ (same tree as above)
```

Even when a Drizzle adapter is provided at runtime and MikroORM code is never
executed, the bundler follows every static `import` and includes `@mikro-orm/*`
and its Node-only dependencies in the Cloudflare Worker output.

---

## What The Commits Do Well

- The `ModulePersistenceAdapter` contract shape is correct:
  `prepareModels`, `createConnectionLoader`, `createBaseRepository`,
  `createRepository`.
- The contract lives in `@medusajs/types` — no MikroORM dependency.
- The adapter is threaded through discovery → connection loading → container
  registration consistently.
- Tests validate the adapter dispatch path.
- The docs accurately record remaining blockers.
- The approach avoids creating parallel service hierarchies.

## What Must Change

- `mikroOrmModulePersistenceAdapter` must not be statically imported by shared
  infrastructure (`load-internal.ts`, `container-loader-factory.ts`).
- `container-loader-factory.ts` must not use the MikroORM adapter as a default
  parameter value.
- The `@medusajs/utils` modules-sdk barrel re-exports MikroORM-specific code
  that every consumer inherits — this barrel needs splitting.
- `MedusaInternalService` still internally imports `toMikroOrmEntities` — same
  bundling issue.

---

## Required Direction

This is a **composition** problem, not a **conditional** problem. The MikroORM
code must be physically absent from the Cloudflare bundle's import graph — not
just unreachable at runtime.

### Separate adapter packages

```
@medusajs/persistence-adapter-mikroorm   ← Node/Postgres only
@medusajs/persistence-adapter-drizzle    ← Cloudflare-safe
```

The shared infrastructure should have no default import of any adapter. The
adapter must be explicitly provided by the application's module configuration.
Failing loudly on a missing adapter is safer than silently pulling MikroORM
into a Cloudflare bundle:

```typescript
// load-internal.ts — NO import of any adapter implementation
const persistenceAdapter = moduleResolution.options?.persistenceAdapter
if (!persistenceAdapter) {
  throw new Error(
    `Module ${moduleResolution.definition.key} requires a persistenceAdapter`
  )
}
```

### Application-level composition

Each deployment target composes its own adapter at the entrypoint:

```typescript
// Node entrypoint
import { mikroOrmPersistenceAdapter } from "@medusajs/persistence-adapter-mikroorm"

// Cloudflare Worker entrypoint
import { drizzlePersistenceAdapter } from "@medusajs/persistence-adapter-drizzle"
```

Neither adapter is ever imported by the shared framework code.

### Barrel splitting

The `@medusajs/utils` modules-sdk barrel must be split so shared portable
infrastructure does not re-export MikroORM-specific modules. MikroORM helpers
(`mikro-orm-connection-loader`, `migration-scripts`,
`create-medusa-mikro-orm-event-subscriber`, etc.) should move to the MikroORM
adapter package or a separate `@medusajs/utils/mikro-orm` entry point that
Cloudflare builds never reference.

---

## Immediate Next Steps

1. Move `mikroOrmModulePersistenceAdapter` and related MikroORM loader code out
   of the shared `@medusajs/utils` barrel into a dedicated adapter package.
2. Remove the default-parameter fallback in `container-loader-factory.ts` and
   `load-internal.ts` — require explicit adapter injection.
3. Split the `modules-sdk/index.ts` barrel: portable exports vs MikroORM
   exports.
4. Update `MedusaInternalService` to receive prepared models instead of
   internally calling `toMikroOrmEntities`.
5. Run the Cloudflare import guard to verify `@mikro-orm/*` is absent from the
   portable bundle.
