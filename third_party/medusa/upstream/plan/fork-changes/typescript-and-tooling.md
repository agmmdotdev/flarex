# TypeScript And Tooling Changes

## Medusa Jest Framework HTTP Subpath Mapping

Commits:

- `41a7d9e3df Move Store products into Medusa static manifest`
- `a4f0c863dc Move Store product variants into Medusa static manifest`

The Medusa package Jest config now maps `@medusajs/framework` and
`@medusajs/framework/*` to the framework source tree, with a specific
`@medusajs/framework/awilix` exception for the dependency wrapper subpath.

Reason:

- Store product and product-variant middleware import runtime helpers from
  `@medusajs/framework/http`.
- Node resolves that package export correctly, but the Medusa package Jest
  resolver did not resolve the bare HTTP subpath once Store products were added
  to the generated static HTTP manifest.
- Mapping only the HTTP subpath to built `dist` files caused Jest to ignore
  internal relative imports under `dist`, while mapping only HTTP source split
  framework singleton state from the built `configManager`.
- Mapping the framework namespace consistently to source preserves one
  framework instance for this Jest config while keeping dependency wrappers
  explicit.

Validation:

- Focused Medusa static HTTP manifest Jest smoke passed with Store products
  and Store product variants in the generated manifest.
- Medusa package build passed when run by itself.

## Test Adapter Type Safety

Commit:

- `31675082d9 refactor: tighten module test adapter types`

The adapter-driven test runner was tightened to:

- Remove explicit `any` from the changed runner and adapter.
- Use a typed `ModuleTestConnection` lifecycle.
- Use `MedusaAppOutput` for the Medusa application result.
- Use `object[]` for discovered models.
- Narrow caught errors before logging.
- Remove unsafe dynamic mutation of test options during cleanup.
- Isolate the required generic deferred-proxy assertion in one helper.
- Expose the legacy `MikroOrmWrapper` through a checked compatibility getter.
- Add Jest and Node types to the test-utils TypeScript configuration.

Remaining `unknown` values represent intentionally unvalidated boundaries such
as injected dependencies, module options, dictionary values, and caught errors.

## TypeScript 6 Source Roots

Commits:

- `6407a034f6 fix: declare test utils source root`
- `999ca0b3c3 fix: declare package source roots`

Explicit `"rootDir": "./src"` was added to:

- `packages/medusa-test-utils/tsconfig.json`
- `packages/modules/currency/tsconfig.json`
- `packages/medusa/tsconfig.json`

This resolves TypeScript 6's requirement to explicitly declare the common
source directory while preserving package output layout.

Many untouched upstream packages still rely on inferred `rootDir`. Handle those
together in a separate mechanical TypeScript 6 migration rather than mixing
them into feature changes.

## Shared Leaf Utility Type Safety

Commit:

- `b4a47bb899 refactor: shrink Cloudflare framework utility shim`

The common helper and module-sdk decorator leaves used by the Worker proof were
tightened before being exposed as portable package entry points.

Changes:

- `deduplicate`, `isObject`, and `isString` no longer accept or default through
  `any`.
- `promiseAll` narrows rejected and fulfilled settled results before use and
  converts non-`Error` rejection reasons explicitly.
- The `promiseAll` unit test now expects the portable newline separator used by
  the runtime implementation instead of importing Node's `os.EOL`.
- `MedusaContext`, `InjectManager`, and `InjectTransactionManager` now isolate
  unavoidable metadata/context assertions at the decorator boundary and avoid
  broad `any` in their public implementation.

Validation:

- `@medusajs/utils` build passed.
- Focused `promiseAll` and module-sdk decorator tests: 6 passing.
- Cloudflare app type-check passed.
- Composed Worker import guard passed with 368 bundled inputs.

## Shared Medusa Error Type Safety

Commit:

- `da024ab2a3 refactor: use shared Medusa error in Worker`

The shared `MedusaError` leaf was tightened before replacing the app-local
Cloudflare shim copy.

Changes:

- Constructor forwarding now uses `ConstructorParameters<typeof Error>` instead
  of a broad `any` rest parameter.
- `MedusaError.isMedusaError` now accepts `unknown` and narrows by checking the
  branded `__isMedusaError` property.
- `@medusajs/utils/common/errors` is exported as a precise package subpath so
  Worker composition does not need the broad common barrel.

Validation:

- `@medusajs/utils` build passed.
- Cloudflare app type-check passed.
- Composed Worker import guard passed with 368 bundled inputs.

## Shared EmitEvents Type Safety

Commit:

- `54d675300c refactor: use shared EmitEvents in Worker`

The module-sdk event decorators were tightened before replacing the app-local
Cloudflare no-op `EmitEvents` copy.

Changes:

- `InjectIntoContext` no longer uses broad `any` or the global `Function` type.
- `EmitEvents` now uses typed decorator descriptors, narrows the service
  prototype and service instance boundary, and checks for a real
  `MessageAggregator` before reading emitted messages.
- `@medusajs/utils/modules-sdk/decorators/emit-events` is exported as a precise
  package subpath and covered by the portable-entrypoint guard.

Validation:

- `@medusajs/utils` build passed.
- Focused module-sdk `EmitEvents` tests: 2 passing.
- Cloudflare app type-check passed.
- Portable entrypoint guard passed for `emit-events`: 5 bundled inputs.
- Composed Worker import guard passed with 369 bundled inputs.

## Utils Export Map Declaration Metadata

Commit:

- This commit (`Expose utils declaration exports for module builds`)

The `@medusajs/utils` package export map now publishes existing declaration
files for:

- the package root export;
- `@medusajs/utils/modules-sdk/definition`;
- `@medusajs/utils/modules-sdk/portable-joiner-config-builder`.

Reason:

- `api-key`, `inventory`, and `order` package builds compile with Node16
  module resolution.
- Their source imports the broad `@medusajs/framework/utils` surface and their
  static manifests import precise `@medusajs/utils/modules-sdk/*` subpaths.
- The declarations already existed under `dist`, but the export map only
  exposed JavaScript files for those entries. TypeScript therefore could not
  see root re-exported utility members such as `Module`, `Modules`, `model`,
  `MedusaService`, and `defineJoinerConfig`, and could not resolve the static
  manifest subpaths.

Affected boundary:

- Package metadata for `@medusajs/utils`.
- No runtime utility implementation changed.
- No module service, DML model, repository, workflow, HTTP handler, or
  Cloudflare Worker behavior changed.

Validation:

- `@medusajs/api-key` build passed.
- `@medusajs/inventory` build passed.
- `@medusajs/order` build passed.
- `medusa-cloudflare` typecheck passed.
- `medusa-cloudflare test:cart-do-sqlite` passed.
- Worker bundle Node-only import guard passed with 1532 bundled inputs.
- Portable entrypoint guard passed.
- Real module import audit passed with 0 Worker blockers.

## Medusa Container Scope Return Type

Commit:

- This commit (`Add Cloudflare HTTP request scope factory`)

Type-safety change:

- `MedusaContainer` now omits Awilix `createScope` before declaring Medusa's
  scoped-container return type.
- Before this change, TypeScript could still resolve `createScope()` as
  Awilix's raw `AwilixContainer` return through the intersection type, which
  forced request-scope callers toward assertions.
- The Cloudflare HTTP request-scope factory now returns the Fetch adapter's
  expected request scope without an assertion.

Affected boundary:

- `packages/core/types/src/common/medusa-container.ts`
- `packages/core/framework/src/types/container.ts`
- Cloudflare HTTP request-scope typing

Validation:

- `@medusajs/framework` build passed.
- `@medusajs/types` build passed.
- `medusa-cloudflare` typecheck passed.

## Vite 8 Worker Type And Source Resolution

Commit:

- This commit (`test: upgrade Vitest and Vite toolchain`)

Vite 8 requires Node `^20.19.0 || >=22.12.0`. The root, private Cloudflare
app, admin bundler, and admin Vite plugin now state that tooling boundary;
repository CI and this validation use Node 24. The public Medusa runtime engine
remains unchanged because it does not execute Vite.

The Cloudflare app now includes `WebWorker.Iterable` so existing `Headers`
iteration is typed without assertions. Real workerd startup also exposed
pre-existing package subpaths that resolved to CommonJS `dist` output. The
application Vite composition and portability guard now mirror source aliases
for the affected package-owned workflow, GraphQL, Index proof/composition, and
Index manifest leaves.

These aliases do not move implementation ownership into the app. They preserve
the adopted package-source Worker graph and prevent Vite's ESM module runner
from evaluating generated CommonJS `exports` bindings.

Validation:

- Cloudflare app typecheck and production Vite 8.1.4 build passed;
- the Vite dev server remained healthy after full Worker export discovery;
- the real workerd/D1 Currency proof passed;
- the composed Worker import guard passed with 1,593 inputs;
- portable entrypoints and runtime source imports passed;
- the real Currency module audit found zero Worker blockers across 65 inputs.

See [`test-runner-migration.md`](./test-runner-migration.md) for the complete
toolchain and parity record.
