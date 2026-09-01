# Cloudflare Runtime Tenancy

This record tracks platform-level tenant and deployment addressing primitives
for the Cloudflare runtime. It is separate from Medusa's commerce-level tenant
or store modeling.

## Tenant Runtime Context Package

Commit:

- This commit (`Add Cloudflare tenant runtime foundation`)

Status:

- Added `@medusajs/cloudflare-runtime` under `packages/core/cloudflare-runtime`.
- The package is Worker-safe and currently owns only:
  - `TenantRuntimeContext` validation.
  - deterministic Durable Object partition address creation.
  - deterministic projection scope key creation.
- Runtime scope is defined by:
  - `tenantId`;
  - `deploymentId`;
  - `environment`;
  - `deploymentVersion`.
- Address parts are normalized and restricted to delimiter-safe values so
  tenant IDs cannot collide through `:`-separated partition keys.

Affected boundary:

- Platform addressing and application-root composition only.
- No Medusa module service, DML model, repository, workflow, Index behavior, or
  HTTP handler behavior changed.
- This package does not implement the final hosted platform registry or final
  Durable Object topology.

Cloudflare app proof:

- `apps/medusa-cloudflare` resolves tenant context from request headers and
  environment defaults in `src/platform/tenant-resolution.ts`.
- The isolated Index proof Worker exposes `/tenant-runtime/check`.
- The existing workerd Index proof script verifies:
  - tenant A and tenant B produce different cart partition names;
  - tenant A and tenant B produce different catalog projection keys;
  - invalid delimiter-bearing tenant IDs are rejected at the Worker boundary.

Difference from original Medusa:

- Original Medusa has no Worker platform tenant/deployment runtime address
  primitive.
- This fork now has a shared Cloudflare-safe addressing package that future
  DO, D1, projection, and app-root composition code can reuse without importing
  Medusa module services or Node runtime code.

Validation performed:

- `yarn workspace @medusajs/cloudflare-runtime test` passed.
- `yarn workspace @medusajs/cloudflare-runtime build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed and included the
  tenant runtime scope checks.
- Worker bundle Node-only import guard passed with 1526 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

Current limitations:

- The proof uses static sample partition families (`cart`) and projection names
  (`catalog`) only to validate address scoping.
- It does not decide the final business transaction partition boundary.
- It does not introduce tenant registries, deployment lookup, user Worker
  dispatch, custom schema, or hosted programmable Medusa APIs.

## Tenant-Scoped Durable Object Routing

Commit:

- This commit (`Scope Index proof DO routing by tenant context`)

Status:

- The isolated Index proof Worker's `/do-index/:aggregateId/*` route now
  resolves `TenantRuntimeContext` before selecting a Durable Object instance.
- `INDEX_PROOFS.getByName` receives the deterministic partition address:

```text
partition:{tenantId}:{deploymentId}:{environment}:{deploymentVersion}:index:{aggregateId}
```

- The request path and `IndexProofDO` implementation remain unchanged. The
  Worker app-root owns only the platform address resolution.
- The Worker response includes `x-medusa-partition-name` so the workerd proof
  can assert which Durable Object name was selected without exposing platform
  addressing inside the Index module.

Affected boundary:

- Durable Object namespace addressing in the Cloudflare application root.
- No Index service behavior, Index persistence implementation, DML model,
  repository, workflow, or proof DO internals changed.

Difference from original Medusa:

- Original Medusa has no Cloudflare Durable Object namespace routing.
- This fork now scopes a real DO storage boundary by tenant/deployment context
  at the Worker edge.

Validation performed:

- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed and verified:
  - the same aggregate key under tenant A and tenant B maps to different DO
    partition names;
  - invalid tenant IDs are rejected before `getByName`;
  - the existing Index DO SQLite and D1 relation/composition/event/link proofs
    still pass.
- Worker bundle Node-only import guard passed with 1526 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

Current limitations:

- This proves tenant-scoped naming for the existing Index proof DO only.
- It does not decide the final Index production partition family or whether
  catalog writes should share a partition with other commerce services.
- D1 projection tenant scoping is still not implemented; this slice only
  covers a real Durable Object namespace boundary.

## Tenant-Scoped D1 Projection Database Selection

Commit:

- This commit (`Scope Index D1 projection by tenant context`)

Status:

- Added `createProjectionDatabaseAddress` to `@medusajs/cloudflare-runtime`.
- The address identifies a physical projection database namespace:

```text
projection-db:{tenantId}:{deploymentId}:{environment}:{deploymentVersion}:index
```

- `apps/medusa-cloudflare` now resolves the Index D1 database at the Worker
  app root through `src/platform/projection-database-resolution.ts`.
- The local Index proof Wrangler config has separate D1 bindings for:
  - `INDEX_DB` as the default local fallback;
  - `INDEX_DB_TENANT_A`;
  - `INDEX_DB_TENANT_B`.
- Tenant A and tenant B requests use separate D1 bindings. The proof does not
  add `tenant_id` columns to Index projection rows.

Affected boundary:

- D1 projection database selection for the isolated Index proof Worker.
- No Index service behavior, SQLite storage provider behavior, DML model,
  repository, workflow, or projection row shape changed.

Difference from original Medusa:

- Original Medusa has no Cloudflare D1 projection database selection.
- This fork now proves the intended production isolation model for projections:
  tenant/deployment context selects a physical D1 database namespace first.
  Row-level tenant columns may still be used later as defense-in-depth or local
  fallback, but they are not the primary production isolation boundary.

Validation performed:

- `yarn workspace @medusajs/cloudflare-runtime test` passed.
- `yarn workspace @medusajs/cloudflare-runtime build` passed.
- `yarn workspace medusa-cloudflare typecheck` passed.
- `yarn workspace medusa-cloudflare test:index-sqlite` passed and verified:
  - tenant A Index D1 query proof uses `INDEX_DB_TENANT_A`;
  - tenant B Index D1 query proof uses `INDEX_DB_TENANT_B`;
  - the projection database keys differ for the same Index proof path;
  - invalid tenant IDs are rejected before D1 selection;
  - the existing default D1 and Durable Object Index proofs still pass.
- Worker bundle Node-only import guard passed with 1526 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

Current limitations:

- This is a local/static binding proof, not the hosted deployment registry.
- Production mapping from tenant/deployment to D1 database ID remains a later
  platform concern.
- Only the isolated Index proof D1 boundary uses this resolver today. Other
  projection/database paths must adopt the same pattern when touched.

## Tenant-Scoped Cart Durable Object Routing

Commit:

- This commit (`Scope Cart proof DO routing by tenant context`)

Status:

- The main Cloudflare Worker's `/do-cart/:aggregateId/*` route now resolves
  `TenantRuntimeContext` before selecting a Durable Object instance.
- `CART_PROOFS.getByName` receives the deterministic partition address:

```text
partition:{tenantId}:{deploymentId}:{environment}:{deploymentVersion}:cart:{aggregateId}
```

- The request path and `CartProofDO` commerce proof behavior remain unchanged.
  The Worker app root owns only platform address resolution.
- The Worker response includes `x-medusa-partition-name` so the workerd proof
  can assert which Cart proof Durable Object was selected.

Affected boundary:

- Durable Object namespace addressing for the Cart-oriented Cloudflare proof
  route.
- No Cart module service, DML model, repository, workflow, HTTP handler, or
  commerce API behavior changed.

Difference from original Medusa:

- Original Medusa has no Cloudflare Worker tenant/deployment partition routing.
- This fork now proves the write-heavy actor direction on a real Cart-oriented
  DO boundary: tenant/deployment context selects the partition at the Worker
  platform edge while Medusa services continue to run unchanged inside that
  partition.

Validation performed:

- `yarn workspace medusa-cloudflare test:cart-do-sqlite` passed and verified:
  - the same Cart aggregate key under tenant A and tenant B maps to different
    DO partition names;
  - invalid tenant IDs are rejected before `getByName`;
  - the existing Cart-oriented DO SQLite proof still passes through real
    module services, queue dispatch, locking, workflow storage, scheduling,
    rollback, and commerce totals.
- `yarn workspace medusa-cloudflare typecheck` passed.
- Worker bundle Node-only import guard passed with 1532 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

Current limitations:

- This is still a proof route, not the final production Cart partition
  topology.
- It does not introduce the hosted deployment registry, user-code dispatch, or
  final business transaction partitioning rules.
- Other write-heavy boundaries must adopt tenant-scoped DO addressing only when
  they become real storage/runtime slices.

## Tenant-Scoped Currency Durable Object Routing

Commit:

- This commit (`Scope Currency proof DO routing by tenant context`)

Status:

- The main Cloudflare Worker's `/do-currency/:aggregateId/*` route now resolves
  `TenantRuntimeContext` before selecting a Durable Object instance.
- `CURRENCY_PROOFS.getByName` receives the deterministic partition address:

```text
partition:{tenantId}:{deploymentId}:{environment}:{deploymentVersion}:currency:{aggregateId}
```

- The request path and `CurrencyProofDO` service behavior remain unchanged.
  The Worker app root owns only platform address resolution.
- The Worker response includes `x-medusa-partition-name` so the workerd proof
  can assert which Currency proof Durable Object was selected.

Affected boundary:

- Durable Object namespace addressing for the Currency SQLite proof route.
- No Currency module service, DML model, repository, workflow, HTTP handler, or
  public commerce behavior changed.

Difference from original Medusa:

- Original Medusa has no Cloudflare Worker tenant/deployment partition routing.
- This fork now proves the same platform-level tenant/deployment address
  selection on the original Currency DO SQLite proof that first established
  actual module-service execution inside Durable Object storage.

Validation performed:

- `yarn workspace medusa-cloudflare test:do-sqlite` passed and verified:
  - the same Currency aggregate key under tenant A and tenant B maps to
    different DO partition names;
  - invalid tenant IDs are rejected before `getByName`;
  - the existing actual Currency module service create/list/rollback proof
    still passes through Durable Object SQLite.
- `yarn workspace medusa-cloudflare test:cart-do-sqlite` passed as a
  regression check for the shared tenant partition helper.
- `yarn workspace medusa-cloudflare typecheck` passed.
- Worker bundle Node-only import guard passed with 1532 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

Current limitations:

- This is still a proof route, not the final production Currency partition
  topology.
- Currency is not the final write-heavy commerce actor. This slice exists to
  keep all active DO storage proofs behind the same app-root tenant addressing
  rule while the real commerce partition model is still being designed.

## Durable Object Commerce Runtime Instance Isolation

Commit:

- This commit (`Isolate Cart DO module runtimes`)

Status:

- `apps/medusa-cloudflare` now assigns a unique runtime-scoped module alias to
  every static commerce module loaded for a Cart Durable Object runtime.
- The alias is only used to prevent `MedusaModule`'s global singleton cache from
  reusing module service instances across Durable Object runtimes in the same
  Worker isolate.
- The container registration keys, module definitions, Medusa services,
  joiner configs, Remote Query entrypoints, HTTP handlers, and public commerce
  behavior remain unchanged inside each runtime.

Why:

- Workerd rejected a second URL-derived Cart partition with:

```text
Cannot perform I/O on behalf of a different Durable Object.
```

- The failing query used a Drizzle executor closed over another Cart Durable
  Object's SQLite storage because static module loading had reused globally
  cached module service instances.
- Runtime-scoped aliases make the Medusa module cache distinguish per-DO
  runtime instances without clearing global module metadata while other
  Durable Objects may still be active.

Affected boundary:

- `apps/medusa-cloudflare/src/commerce-modules.ts`
- Cart Durable Object SQLite commerce module composition
- URL-derived Cart partition routing for top-level Store cart retrieval

Difference from original Medusa:

- Original Medusa runs one long-lived Node process/container and benefits from
  module singleton reuse.
- This fork can run multiple Durable Object commerce runtimes in one Worker
  isolate, where services must not share storage-bound executors across actor
  instances.

Validation performed:

- `cmd /c yarn workspace medusa-cloudflare typecheck` passed.
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite` passed and
  verified the scenario Cart DO and a second URL-derived missing-cart Cart DO
  can run in the same Worker isolate without cross-DO SQLite I/O.
- `cmd /c yarn workspace medusa-cloudflare test -- --testNamePattern "HTTP runtime status|bounded default route|store cart routes|Cart production partition|tenant partition"`
  passed with 30 Worker/request-scope assertions.
- Worker portable entrypoint, composed import, runtime source import, and real
  module import guards passed.
- `cmd /c yarn workspace @medusajs/framework build` passed.
- `cmd /c yarn workspace @medusajs/medusa build` passed.
- `git diff --check` passed.

Current limitations:

- The aliasing is app-local to the current commerce runtime composition proof.
- A package-owned Worker module runtime factory should eventually expose this
  isolation rule explicitly instead of leaving it as app composition code.
