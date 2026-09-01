# Repository Agent Guidance

## Read First

Before changing fork architecture or runtime behavior, read:

- `plan/fork-changes/README.md`
- The relevant domain records under `plan/fork-changes/`
- `plan/cloudflare-port-refactor-plan.md`

The domain records document what differs from original Medusa. The refactor
plan records the adopted Cloudflare migration direction.

## Architecture Rules

- Refactor Medusa in place. Preserve actual Medusa module services, DML models,
  workflows, APIs, and public contracts.
- Existing Medusa integration assertions are the behavioral specification.
- Make persistence and runtime infrastructure adapter-driven underneath the
  existing services.
- Keep MikroORM/Postgres working as the default until a replacement path passes
  the same tests.
- Do not create or expand parallel portable module-service hierarchies.
- Keep `apps/medusa-cloudflare` as a thin deployment and composition root. Do
  not rebuild Medusa bootstrap, services, routes, middleware, events, or
  workflows in the app.
- Add static manifests as an alternative resolver for the existing Medusa
  bootstrap. Preserve Node filesystem discovery for the Node runtime.
- Preserve existing Medusa HTTP handlers and middleware. Replace Express
  registration with runtime adapters; do not rewrite handlers for Cloudflare
  when an adapter can run them unchanged.
- Complete one narrow vertical slice before expanding to events, workflows,
  HTTP, discovery, or other runtime systems.

## Bundling and Composition Rules

The Cloudflare target requires that Node-only code (MikroORM, `pg`, Node
crypto, etc.) is **physically absent** from the Worker bundle's import graph —
not merely unreachable at runtime. Conditional `if/else` or default-parameter
guards do not prevent a bundler from following static imports.

- **Shared infrastructure depends only on contracts.** Packages like
  `@medusajs/modules-sdk` and portable parts of `@medusajs/utils` must import
  adapter interfaces from `@medusajs/types`, never a concrete adapter
  implementation.
- **No static default adapter imports.** Do not use a concrete adapter as a
  default parameter value or fallback import in shared code. If no adapter is
  provided, fail loudly at startup.
- **Adapter implementations live in separate packages.** Each persistence
  backend (MikroORM, Drizzle) ships as its own package or isolated entry point
  that only the relevant deployment target imports.
- **Selection happens at the application root.** The application entrypoint
  selects bindings, adapters, and a static manifest. Reusable bootstrap,
  registration, routing, and behavior remain in shared Medusa packages.
- **Barrel exports must be tree-shakable.** Do not re-export backend-specific
  modules from shared barrel files (`index.ts`). Split barrels into portable
  vs backend-specific entry points when needed.
- **Validate with the import guard.** After any infrastructure refactor, run
  the Cloudflare portability import guard to confirm `@mikro-orm/*` and other
  Node-only specifiers are absent from the portable bundle graph.

## Current Acceptance Gate

The first migration milestone is complete only when the unchanged Currency
module service and unchanged Currency integration assertions pass with:

- MikroORM/Postgres.
- Drizzle/SQLite or D1.
- The Drizzle path running inside workerd without Node or MikroORM imports.

## Testing Rules

- Run the original affected module integration suite after infrastructure
  refactors.
- Do not replace existing module assertions with parallel contract tests.
- Add adapter-specific tests only for behavior not covered by the shared module
  suite, such as query translation, migrations, D1 limitations, and workerd
  compatibility.
- Use an isolated temporary PostgreSQL cluster for local integration validation
  when the installed PostgreSQL credentials are unknown. Do not alter the
  machine's existing PostgreSQL service configuration.
- Keep the Cloudflare portability import guard passing.

## Commit Rule

- Commit after each completed vertical slice once validation and documentation
  are updated. Do not let multiple module slices accumulate uncommitted.
- Use focused commit messages that name the module or runtime boundary changed.
- If a slice cannot be committed because validation is blocked, record the
  blocker in the relevant `plan/fork-changes/` domain record before moving on.

## Type-Safety Rules

- Avoid `any`, unchecked assertions, and broad `unknown` values.
- Use `unknown` only at genuinely unvalidated boundaries and narrow it before
  use.
- Isolate unavoidable assertions at one documented boundary.
- Prefer existing Medusa types over locally invented broad object shapes.
- TypeScript 6 requires explicit package `rootDir` when preserving output
  layout. Add `"rootDir": "./src"` to affected buildable packages as part of a
  focused migration.

## Documentation Rule

After every meaningful fork-specific architecture or behavior change:

1. Update the relevant domain record under `plan/fork-changes/`.
2. Create a new domain record when an existing file is not a good fit. Do not
   grow one giant summary file.
3. Keep `plan/fork-changes/README.md` as a small navigation index only.
4. Update `plan/cloudflare-port-refactor-plan.md` if the direction or sequence
   changed.
5. Keep this `AGENTS.md` guidance aligned with the implemented architecture.

Record the difference from original Medusa, affected boundary, validation
performed, and commit identifier in the relevant domain record.
