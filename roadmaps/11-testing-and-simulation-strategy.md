# Testing and Simulation Strategy

## Add The Fail-Closed Hosted Activation Harness

Previous completed checkpoint: `e2921b5` (`Prove executor Worker service
binding`).

What changed:

- Added unit coverage for missing probe configuration, exact bearer
  authorization, route/method/path allowlists, caller-header isolation,
  exact run ownership, distinct probe/executor capabilities, executor-token
  injection, hop/no-store receipts, and redacted service-binding failure.
- Added strict hosted-run configuration tests. The real lane requires an exact
  staging-mutation opt-in, non-local PostgreSQL URL, exact target-database name
  confirmation, non-downgradable TLS, HTTPS probe origin, probe token, and
  bounded unique run ID; target-override query parameters are rejected,
  malformed credential URLs are redacted, and missing configuration fails
  rather than skipping.
- Reused one typed OCC/SQL proof across H04 Miniflare and the future H05 hosted
  transport. The H04 PostgreSQL 18 rerun also exercised the new scoped cleanup
  and table-inventory gate, asserted deployment/scope rows were removed, and
  proved concurrent run-claim exclusion and reuse.
- Added separate, bounded Wrangler dry-run checks for the production executor
  and public probe. Ordinary tests remain fast and do not imply hosted proof.

Why it changed:

The hosted gate needs reproducible negative and positive evidence, and must not
turn unavailable staging credentials into a skipped green test. Preparing the
harness separately keeps the future Cloudflare mutation turn small and
auditable.

Convex references inspected:

- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`
- `crates/database/src/committer.rs`

How Flarex differs:

- Convex's comparable test boundary is runner to in-process committer. Flarex
  additionally proves an authenticated public test caller to private Worker
  service binding before the trusted PostgreSQL commit path.

Known limitations:

- Unit, dry-run, Miniflare, and direct PostgreSQL evidence cannot establish
  live Hyperdrive cache settings or Cloudflare routing/privacy. H05-B remains
  required and H05 remains unchecked.
- The public probe is intended to be ephemeral and must be removed or disabled
  after the hosted receipt is captured.

Verification:

```sh
corepack pnpm --filter @flarex/executor-worker typecheck
corepack pnpm --filter @flarex/executor-worker test # 6 files, 75 tests
corepack pnpm --filter @flarex/executor-worker check:bundle
corepack pnpm --filter @flarex/executor-worker deploy:h05-probe:dry-run
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/executor-worker test:service-binding:postgres
corepack pnpm --filter @flarex/executor-worker test:service-binding:hosted:postgres # expected fail-closed without H05 config
git diff --check
```

## Add The Named Workerd And PostgreSQL Host Proof

Previous completed checkpoint: `f0ec41b` (`Add private executor Worker bundle
gate`).

What changed:

- Added a conditional H04 integration lane that loads the exact Wrangler output
  into a Miniflare multi-Worker graph. The first Worker has a string-valued
  `FLAREX_EXECUTOR` binding; the target Worker is not directly reachable.
- Asserted the complete binding capability surface: the caller sees only the
  executor service, while the executor sees only its bearer token and local
  Hyperdrive binding. A caller-injected response header proves every assertion
  traversed that hop.
- Created one random disposable PostgreSQL database per proof, ran migrations
  and deployment seeding outside workerd, and polled for zero clients while
  workerd remained alive. The fixture then disposes workerd, reopens the
  database for authoritative assertions, performs a final zero-client poll,
  and drops the database normally. Forced drop exists only as failure cleanup.
- Added the explicit `test:service-binding:postgres` script, which rebuilds and
  verifies the Worker bundle before running the scenario. Ordinary tests
  exclude the real lane, while the explicit command fails closed when
  `FLAREX_POSTGRES_DATABASE_URL` is absent.
- The authorized proof exposed Elysia's forbidden workerd string code
  generation, so the test now guards the corrected plain Fetch adapter and the
  bundle gate permanently rejects compatibility-router inputs.

Why it changed:

Unit tests and a Wrangler dry-run could not prove actual named service dispatch,
authorized router construction, real PostgreSQL transactions, or client
cleanup. This lane is the smallest local system proof for those boundaries and
keeps hosted Hyperdrive claims out of local evidence.

Convex references inspected:

- `crates/function_runner/src/lib.rs`
- `crates/application/src/application_function_runner/mod.rs`
- `crates/database/src/committer.rs`

How Flarex differs:

- Convex tests its in-process runner/committer boundary. Flarex additionally
  needs a multi-Worker topology because untrusted execution and the trusted
  database executor communicate through a Cloudflare service binding.

Known limitations:

- Miniflare local Hyperdrive uses the supplied PostgreSQL connection directly;
  this test cannot prove hosted placement, pooling, or cache-disabled resource
  configuration. H05 owns that receipt.
- The real lane requires an external PostgreSQL URL and is intentionally not a
  mandatory dependency of the ordinary unit suite.

Verification:

```sh
corepack pnpm --filter @flarex/executor-worker test
corepack pnpm --filter @flarex/executor-worker check:bundle
FLAREX_POSTGRES_DATABASE_URL=... corepack pnpm --filter @flarex/executor-worker test:service-binding:postgres
git diff --check
```

## Test SDK Reset Coverage

Previous completed checkpoint: `d94ef92` Cover packed test SDK Postgres
subscriptions.

What changed:

- Added example-app coverage for `flarex-test.reset()` after a committed
  mutation.
- Added packed consumer coverage that calls `reset()` after live-query flows on
  both the legacy/default runtime and Postgres/PGlite executor runtime.
- The packed Postgres reset lane now uses a string `persistDir`, proving reset
  clears persisted local executor/dev-runtime state, not only in-memory state.
- Added focused path-safety coverage so reset deletion rejects `""`, `"."`,
  `".."`, project folders, and paths outside the app root.
- Added absolute-path guard coverage for both a valid path under `root/.flarex/`
  and an invalid path outside the app root.

Why it changed:

The test strategy needs isolation helpers before larger app suites can depend
on `flarex-test`. Recreating runtimes in every test file by hand would hide
package-boundary problems and make future Convex-style harness work harder to
validate.

Convex references inspected:

- Convex test helper ergonomics recorded in the Test SDK roadmap.
- `convex-test` API shape recorded in the roadmap includes harness-level state
  helpers rather than app tests manually deleting backend rows.

Flarex differences:

- Flarex reset is runtime recreation because the local harness exercises
  Miniflare Durable Objects and optional PGlite executor state. Convex's test
  helper owns a different in-memory/mock backend model.
- Persistence path resolution is shared with `flarex-dev`, which remains the
  source of truth for local runtime layout.
- Reset uses a stricter `flarex-dev` resolver that only allows deletion under
  `.flarex/`.
- `flarex-test` validates that resolver during harness creation instead of
  waiting until after runtime disposal.
- Added example coverage for concurrent `t.reset()` calls after a mutation.
- Added example coverage for `dispose()` racing with lifecycle operations so a
  disposed harness rejects later reset, reload, and query use.

Known limitations:

- Identity and seed helpers remain unimplemented.
- This is local test isolation only; real deployment data cleanup is a separate
  platform operation.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- dev.test.ts
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-test typecheck
corepack pnpm --filter flarex-test build
corepack pnpm --dir apps/example exec vitest run flarex/invoke-e2e.test.ts --hookTimeout=60000 --testTimeout=60000
corepack pnpm --filter @flarex/example typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Consumer Postgres Subscription

Previous completed checkpoint: `9b0486f` Cover packed test SDK Postgres invoke
flow.

What changed:

- Added Postgres live-query subscription behavior to the packed consumer
  `flarex-test` script.
- Reused one generated live-query assertion helper for both legacy and Postgres
  packed scripts so the subscription contract stays synchronized.
- The fresh install now verifies the Postgres transport can deliver a
  subscription update after a sync client mutation, using generated app
  references and the installed package graph.

Why it changed:

The testing strategy needs package-boundary coverage for both direct invoke and
live sync. Workspace E2E tests already covered Postgres sync, but a clean
installed consumer is the stronger regression gate for developer-facing app
tests.

Convex references inspected:

- `npm-packages/convex/src/browser/sync/client.ts`
  - live query callbacks are client-facing behavior, not only backend rerun
    internals.
- Convex testing helper ergonomics recorded in the Test SDK roadmap.

Flarex differences:

- Flarex's local Postgres sync path is PGlite-backed and bridged through
  Miniflare. Convex's equivalent client tests run against Convex's runtime
  model.

Known limitations:

- This does not test real Postgres concurrency, network distance, or hosted
  WebSocket deployment.
- Identity/reset/seed helpers remain unimplemented.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Consumer Postgres Invoke

Previous completed checkpoint: `d133982` Cover packed test SDK live query
flow.

What changed:

- Extended the fresh packed-consumer integration with a Postgres transport
  `flarex-test` script.
- The new script runs generated query and mutation references through
  `flarexTest({ executorTransport: "postgres" })` and verifies persisted
  read-after-write behavior.
- The existing consumer TypeScript gate now includes the Postgres packed
  script.

Why it changed:

The workspace already had Postgres executor tests and example E2E coverage, but
the app-testing strategy also needs a clean installed-consumer lane. This keeps
package-boundary regressions from hiding behind workspace source resolution.

Convex references inspected:

- Convex test helper ergonomics recorded in the Test SDK roadmap:
  application tests should use generated references and a compact harness API.
- `npm-packages/convex/package.json`
  - package export boundaries are part of what testing should protect.

Flarex differences:

- Flarex's local test harness currently lets tests choose the legacy or
  Postgres transport. Convex has one backend runtime model for this surface.
- The Postgres lane uses PGlite for fast local package validation. Real
  Postgres correctness remains a separate lane for locks and isolation.

Known limitations:

- This is direct invoke coverage only; packed Postgres live-query delivery is
  still a future test.
- Identity, reset, and seed helper tests remain future work.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Consumer Test SDK Subscription

Previous completed checkpoint: `a738186` Cover packed test SDK mutation flow.

What changed:

- Added a packed consumer live-query smoke to the existing fresh-consumer
  integration.
- The script now uses `flarexTest().client().onUpdate(...)`, observes the
  initial query result, performs `client.mutation(api.messages.send, ...)`, and
  waits for the subscription update using a semantic exact-set check instead of
  callback-count timing.

Why it changed:

Direct invoke tests do not prove the installed test SDK can drive the public
client/sync surface. This adds package-boundary coverage for a common
Convex-style app test pattern: subscribe to a query, mutate, and assert the
query result changes.

Convex references inspected:

- `npm-packages/convex/src/browser/sync/client.ts`
  - Convex's browser client owns live query subscription updates.
- Convex testing helper ergonomics recorded in the Test SDK roadmap.

Flarex differences:

- Flarex uses a Miniflare-backed WebSocket bridge in `flarex-test`. Convex's
  client connects to Convex's backend sync runtime.

Known limitations:

- This covers the legacy/local dev sync path from the packed consumer. The
  Postgres executor delivery path remains outside this packed fixture.
- Identity and reset helper packed tests remain future work.
- The fixture still validates source-mode packages with Bundler-style
  TypeScript resolution.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Consumer Test SDK Mutation

Previous completed checkpoint: `5cb7dee` Run packed test SDK against generated
app.

What changed:

- Added a generated mutation path to the packed fresh-consumer fixture.
- The packed consumer test now verifies:
  - initial generated query result is empty,
  - `flarexTest().mutation(api.messages.send, ...)` returns a message id,
  - a follow-up generated query sees the persisted message with the same `_id`
    and partition owner.

Why it changed:

The previous packed test SDK check proved a generated query only. A test SDK
consumer gate should also cover writes, because application tests commonly use
the harness to validate mutation behavior.

Convex references inspected:

- Convex testing helper ergonomics recorded in the Test SDK roadmap:
  application tests should use generated references and a compact harness API.
- `npm-packages/convex/package.json`
  - installed package metadata is part of the testable consumer contract.

Flarex differences:

- Flarex validates mutation behavior through the local dev runtime and
  source-mode packed packages. Convex's equivalent testing path is tied to
  Convex's backend/test runtime.

Known limitations:

- This covers one single-partition mutation and read-after-write check.
  Subscription coverage was added in the next checkpoint; identity, reset
  helpers, and Postgres-transport packed tests remain future work.
- The fixture still validates source-mode packages with Bundler-style
  TypeScript resolution.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Consumer Test SDK Invocation

Previous completed checkpoint: `44878a0` Add packed consumer smokes for test
and Nitro packages.

What changed:

- Added a second temp consumer runtime script,
  `packed-flarex-test.ts`, to the packed install integration.
- The script imports generated `api` from the temp consumer app and invokes
  `api.messages.list` through `flarexTest()` from the packed `flarex-test`
  tarball.
- The script constructs the user ID through the packed SDK's public
  `encodeFlarexId` helper.
- The numeric table id comes from generated `deploymentSchema`, so the fixture
  remains coupled to generated metadata rather than a magic table-id constant.
- The table name is constrained by generated `TableNames`, preventing the
  fixture from pairing one table brand with another table's generated id.
- The temp consumer declares `tsx` directly because the packed runtime smokes
  execute scripts with `pnpm exec tsx`.

Why it changed:

Import smokes catch package resolution failures, but they do not prove the
test SDK can run a generated app after install. This test adds a small
end-to-end app-test harness check while keeping the fixture deterministic and
read-only.

Convex references inspected:

- Convex testing helper ergonomics recorded in the Test SDK roadmap:
  application tests should use a compact harness API.
- `npm-packages/convex/package.json`
  - installed package metadata is part of the testable consumer contract.

Flarex differences:

- Flarex runs the packed test SDK through the local dev runtime and Miniflare.
  Convex's equivalent helper path is tied to Convex's backend/test runtime.

Known limitations:

- This covers a generated read-only query only. Mutation, subscription, and
  identity helper tests remain future work.
- The fixture still validates source-mode packages with Bundler-style
  TypeScript resolution.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Consumer Test SDK And Nitro Smoke

Previous completed checkpoint: `fad789f` Add test SDK and Nitro package
boundaries.

What changed:

- Extended `integration/fresh-consumer-pack.integration.test.ts` so the fresh
  temp consumer installs packed `flarex-test` and packed
  `@flarex/executor-nitro`.
- The packed override matrix now covers all packed internal packages so
  transitive dependencies resolve to the same local tarballs.
- The internal package metadata is shared with the tarball-shape test, while
  each test keeps its own expectations.
- Added a temp consumer `packed-smoke.ts` and `tsconfig.packed-smoke.json`.
- The integration test now verifies both TypeScript resolution with `tsc` and
  runtime import resolution with `tsx` for those packages.

Why it changed:

The package graph gate should represent what app and adapter consumers actually
do after install. Internal tarball shape tests can miss broken transitive
dependency rewriting or source-mode export resolution.

Convex references inspected:

- `npm-packages/convex/package.json`
  - package exports and dependency metadata define the installed SDK contract.

Flarex differences:

- The consumer still links external dependencies from the workspace store for
  deterministic offline tests, while Convex's published package is consumed
  from npm.
- Flarex's test SDK and Nitro adapter are separate packages because local tests
  and host adapters are part of this platform split.

Known limitations:

- This is an import/type/runtime smoke, not a full packed-app `flarexTest(...)`
  invocation.
- It does not boot Nitro. Nitro route behavior remains covered by
  package-level adapter tests.
- The consumer typecheck follows the existing generated-output
  Vite/Bundler-style resolution path, not a built NodeNext package artifact
  path.

Verification:

```sh
corepack pnpm --filter flarex-test typecheck
corepack pnpm --filter @flarex/executor-nitro typecheck
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/internal-packages-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/internal-packages-pack.integration.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Test SDK And Nitro Adapter Packability

Previous completed checkpoint: `339e671` Add packed consumer generated
typecheck gate.

What changed:

- Extended the shared internal package packability test to cover:
  - `flarex-test`,
  - `@flarex/executor-nitro`.
- Added package `files` boundaries for both packages so the tarballs exclude
  `test/` and `tsconfig.json`.

Why it changed:

The previous package graph gates covered the `flarex-dev` runtime graph. The
remaining workspace packages still needed the same tarball-shape protection so
test SDK and adapter packages do not leak repo-only files when packed.

Convex references inspected:

- `npm-packages/convex/package.json`
  - package metadata defines the testable install surface.

Flarex differences:

- Flarex has separate test SDK and Nitro adapter packages. Convex's hosted
  platform does not expose this same adapter split.

Known limitations:

- This does not run fresh-consumer install tests for `flarex-test` or
  `@flarex/executor-nitro`.
- This does not exercise `flarex-test` against an installed packed app.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/internal-packages-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/internal-packages-pack.integration.test.ts --testTimeout=120000 --hookTimeout=120000
git diff --check
```

## Packed Consumer Generated Typecheck Smoke

Previous completed checkpoint: `395ac9f` Add packed consumer codegen smoke.

What changed:

- Extended the packed consumer integration test to run normal codegen with
  `--typecheck enable` after the dry-run assertion.
- The fixture now includes direct consumer links for `typescript` and
  `@cloudflare/workers-types`, matching the generated typecheck command's
  requirements.
- The test asserts `_generated/server.ts` is written after normal codegen.

Why it changed:

Dry-run codegen skips the final generated-output typecheck path. This
checkpoint exercises that path from an installed packed CLI and catches missing
consumer type/runtime dependencies.

Convex references inspected:

- `npm-packages/convex/package.json`
  - npm SDK packages must work from an installed consumer project.
- `packages/flarex-dev/src/generatedTypecheck.ts`
  - source for the generated-output typecheck command and dependency
    resolution.

Flarex differences:

- The fixture still links public dependencies from the workspace rather than
  downloading from a registry, isolating package graph correctness from network
  availability.

Known limitations:

- Deploy/backend push is still not covered from the packed consumer.
- This does not yet cover built package output.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Packed Consumer Codegen Smoke

Previous completed checkpoint: `982396a` Add fresh consumer package install
gate.

What changed:

- Extended the fresh-consumer integration test beyond CLI help.
- The temp consumer now includes a minimal `flarex/schema.ts` and
  `flarex/functions/messages.ts`.
- After installing `flarex-dev` from packed tarballs, the test runs
  `flarex-dev codegen --dry-run --typecheck disable`, verifies generated write
  reporting, and verifies dry-run mode leaves `_generated/server.ts` absent.
- The consumer directly depends on the packed `flarex` tarball as well as
  `flarex-dev`, matching the source imports used by real application code.

Why it changed:

Install-only package tests can miss command-time module resolution and analyzer
failures. This turns the packed consumer into a real dry-run codegen smoke while
keeping it deterministic.

Convex references inspected:

- `npm-packages/convex/package.json`
  - package installability is a user-facing test boundary.
- `packages/flarex-dev/test/fixtures.ts`
  - existing minimal project fixture copied for the packed CLI smoke.

Flarex differences:

- The smoke disables generated-output typechecking to isolate installed CLI
  codegen behavior from the separate TypeScript typecheck lane.
- It still uses local tarball overrides because Flarex internal packages are not
  published.

Known limitations:

- This does not yet run generated-output typechecking from the packed consumer.
- This does not exercise backend push/deploy from the packed consumer.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Fresh Consumer Install Simulation

Previous completed checkpoint: `85faa2d` Add remaining package packability
gates.

What changed:

- Added a fresh-consumer integration test that installs packed Flarex tarballs
  into a temporary project and executes the installed `flarex-dev` CLI help
  command.
- The fixture uses real `pnpm pack` output for the SDK/dev/runtime packages
  required by `flarex-dev`.
- The fixture writes consumer-local `pnpm-workspace.yaml` overrides so
  unpublished internal package specs resolve to tarballs, while known public
  runtime dependencies resolve to workspace-local links.
- The fixture installs with a temp pnpm store in offline mode, so undeclared
  public dependencies cannot be hidden by the developer's default pnpm store.

Why it changed:

Tarball content tests can pass while install-time dependency resolution still
fails. This test covers the next boundary: whether a package-manager consumer
can install `flarex-dev` outside the workspace and start the CLI.

Convex references inspected:

- `npm-packages/convex/package.json`
  - Convex's npm package shape is treated as an installable SDK boundary, not
    only a source-tree boundary.

Flarex differences:

- Flarex still has unpublished internal packages, so the test simulates registry
  availability with local tarball overrides.
- Public dependencies are linked locally to avoid network flakiness; this is a
  package graph test, not an external registry smoke test.
- `flarex-test` and `@flarex/executor-nitro` are not covered because this slice
  targets the `flarex-dev` packed runtime graph.

Known limitations:

- The installed CLI smoke currently covers `--help` only.
- It does not typecheck a generated consumer app or run `flarex-dev codegen`.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/fresh-consumer-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/fresh-consumer-pack.integration.test.ts --testTimeout=240000 --hookTimeout=240000
git diff --check
```

## Remaining Internal Package Packability Coverage

Previous completed checkpoint: `e07b1e5` Add internal package packability
gates.

What changed:

- Extended `integration/internal-packages-pack.integration.test.ts` to cover:
  - `@flarex/persistence-postgres`,
  - `@flarex/freshness`,
  - `@flarex/executor`, and
  - `@flarex/executor-http`.
- The same shared helper now verifies their tarball identity, public export
  targets, absence of development-only package entries, and absence of
  local-only dependency protocols.
- Development-only package entry checks reject `test`, `tests`, `__tests__`,
  fixture directories, test/spec source files, and nested Vite/Vitest/
  TypeScript config filenames unless the package case explicitly allows a
  harness entry.
- The persistence package case also parses `drizzle/meta/_journal.json` and
  verifies every listed migration SQL file and snapshot is present under
  `package/drizzle`.

Why it changed:

The earlier shared packability gate covered only `flarex`, `flarex-backend`,
and `flarex-dev`. The remaining internal packages need the same gate before a
full packed install fixture can produce meaningful failures.

Convex references inspected:

- `npm-packages/convex/package.json`
  - package content and export declarations are treated as stable public npm
    surface.

Flarex differences:

- Flarex still uses source-mode tarballs. The packability test therefore checks
  TypeScript source files and migration files instead of built JS/type output.

Known limitations:

- The integration gate still inspects tarballs instead of installing them.
- It assumes current package `exports` maps are flat string targets.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/cli-pack.integration.test.ts integration/internal-packages-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/cli-pack.integration.test.ts integration/internal-packages-pack.integration.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter @flarex/persistence-postgres typecheck
corepack pnpm --filter @flarex/freshness typecheck
corepack pnpm --filter @flarex/executor typecheck
corepack pnpm --filter @flarex/executor-http typecheck
corepack pnpm --filter @flarex/persistence-postgres build
corepack pnpm --filter @flarex/freshness build
corepack pnpm --filter @flarex/executor build
corepack pnpm --filter @flarex/executor-http build
corepack pnpm --filter @flarex/persistence-postgres pack --dry-run
corepack pnpm --filter @flarex/freshness pack --dry-run
corepack pnpm --filter @flarex/executor pack --dry-run
corepack pnpm --filter @flarex/executor-http pack --dry-run
git diff --check
```

## Shared Package Packability Gates

Previous completed checkpoint: `000379c` Add flarex-dev packability gate.

What changed:

- Added `integration/packabilityHelpers.ts` for shared tarball inspection:
  - bounded `pnpm pack` execution,
  - dynamic tarball discovery,
  - packed/source manifest parsing,
  - export-target existence checks,
  - local dependency protocol checks, and
  - tarball entry reads.
- Added `integration/internal-packages-pack.integration.test.ts` covering
  `flarex` and `flarex-backend`.
- The existing `flarex-dev` pack test now reuses the same helpers.

Why it changed:

The first packability gate was specific to `flarex-dev`. The next steps need to
check multiple internal packages the same way, so the narrow shared helper keeps
the tests consistent without duplicating unsafe JSON parsing or process-spawn
logic.

Convex references inspected:

- `npm-packages/convex/package.json`
  - package `files`, `exports`, and `bin` shape are part of the public
    compatibility surface.

Flarex differences:

- These tests inspect source-mode tarballs, not built npm artifacts.
- `flarex-backend` keeps existing public test-namespaced exports; the test
  allows only the exact `package/test/backendHarness.ts` file under `test/`
  because `./test/sync-protocol` points at `src/syncProtocol.ts`.
- The internal package packability test asserts required optional peer
  dependencies and `peerDependenciesMeta.optional` for public test helpers such
  as the backend harness.

Known limitations:

- No full packed install fixture yet.
- The helper currently handles string export targets only, matching current
  Flarex package manifests.

Verification:

```sh
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest --allowImportingTsExtensions integration/cli-pack.integration.test.ts integration/internal-packages-pack.integration.test.ts integration/packabilityHelpers.ts
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/cli-pack.integration.test.ts integration/internal-packages-pack.integration.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex pack --dry-run
corepack pnpm --filter flarex-backend pack --dry-run
git diff --check
```

## CLI Packability Integration

Previous completed checkpoint: `5cf8dcd` Cover flarex-dev consumer bin shim.

What changed:

- Added `integration/cli-pack.integration.test.ts` as a fast tarball gate for
  `flarex-dev`.
- The test packs `flarex-dev` into a temp directory, lists the tarball, reads
  `package/package.json` from the tarball, and verifies the public CLI package
  surface without installing the package.
- The test discovers the generated tarball dynamically and compares packed
  package identity against the source manifest, so normal version bumps do not
  break the packaging gate.
- The test verifies every string target in the packed `exports` map exists in
  the tarball, not just the CLI launcher files.
- The test uses bounded process execution and cleans up its temp directory after
  each run.

Why it changed:

Consumer `.bin` coverage proved workspace command discovery. Packability
coverage catches a different class of regressions: accidentally publishing
tests, losing the CLI launcher, losing source entrypoints required by the
source-mode launcher, or leaking local-only dependency protocols.

Convex references inspected:

- `npm-packages/convex/package.json`
  - treats package files and bin entries as part of the stable public npm
    surface.

Flarex differences:

- This is tarball inspection rather than a packed install fixture.
- Flarex's package still uses source-mode TypeScript and `tsx`; Convex's
  package points at built CLI files.

Known limitations:

- No fresh-consumer packed install test exists yet.
- The test does not execute the packed tarball's bin after installation; it only
  proves the tarball has the needed launcher and dependency metadata.

Verification:

```sh
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/cli-pack.integration.test.ts --testTimeout=120000 --hookTimeout=120000
corepack pnpm exec tsc --noEmit --strict --module NodeNext --moduleResolution NodeNext --target ES2022 --types node,vitest integration/cli-pack.integration.test.ts
corepack pnpm --filter flarex-dev pack --dry-run
git diff --check
```

## Example App CLI Shim Integration

Previous completed checkpoint: `a45578c` Add flarex-dev package bin.

What changed:

- Added `integration/cli-bin.integration.test.ts` to execute `flarex-dev help`
  by command name with the example app's local `node_modules/.bin` on `PATH`.
- The test is cross-platform: it uses the `.CMD` shim on Windows and the POSIX
  shim elsewhere.
- The spawned command has a hard timeout so a broken shim cannot hang the
  Vitest worker.
- The assertion checks that the shim reaches the real CLI help surface,
  including the `codegen` and `deploy` commands.

Why it changed:

Package unit tests already cover the root export and direct launcher. The user
path is one layer higher: app scripts and local development commands invoke the
package-manager shim. Keeping this as an integration test avoids coupling
`flarex-dev` package unit tests to the example app's install layout.

Convex references inspected:

- `npm-packages/convex/package.json`
  - package `bin` entries are the public command surface package managers
    expose to applications.

Flarex differences:

- This is workspace-link integration coverage, not packed-package install
  coverage.
- The command target is still a source-mode development launcher.

Known limitations:

- No packed tarball install fixture exists yet.
- Only help output is validated through the consumer shim in this checkpoint.

Verification:

```sh
corepack pnpm exec vitest run --config integration/vitest.config.ts integration/cli-bin.integration.test.ts --testTimeout=60000 --hookTimeout=60000
cmd /c "set PATH=%CD%\apps\example\node_modules\.bin;%PATH%&& cd apps\example && flarex-dev help"
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev build
git diff --check
```

## CLI Bin Coverage

Previous completed checkpoint: `33b4f8f` Export CLI runner from flarex-dev
root.

What changed:

- Extended package-entrypoint coverage to read `flarex-dev`'s package `bin`
  metadata and assert that `flarex-dev` points at `./bin/flarex-dev.mjs`.
- The same test now executes the bin launcher with `help` and checks that it
  returns the normal CLI help output.
- Package metadata is parsed through an `unknown` boundary and narrowed before
  assertions, avoiding a broad package JSON type assertion in the test.

Why it changed:

The root export test protected programmatic imports. The package command also
needs coverage because future examples, local scripts, and automation should be
able to call the CLI through the package bin just like Convex users call
`convex`.

Convex references inspected:

- `npm-packages/convex/package.json`
  - declares CLI bin entries as part of the public package surface.
- `npm-packages/convex/src/cli/index.ts`
  - process bootstrap remains separate from the command implementation.

Flarex differences:

- The test invokes the local source-mode launcher, not a bundled published npm
  artifact.
- The launcher currently uses `tsx`; Convex's published package points at built
  command files.

Known limitations:

- This does not yet test installation from a packed tarball or package manager
  generated `.bin` shim.

Verification:

```sh
node packages/flarex-dev/bin/flarex-dev.mjs help
corepack pnpm --filter flarex-dev exec vitest run test/index.test.ts --testTimeout=60000 --hookTimeout=60000
```

## CLI Package Entrypoint Coverage

Previous completed checkpoint: `d35c94d` Add deploy JSON output.

What changed:

- Added package-entrypoint coverage proving `flarex-dev` exports
  `runFlarexDevCli(...)`, `FlarexDevCliOptions`, and deploy JSON output types.
- The test imports from the package self-reference `flarex-dev`, exercising the
  root export map instead of importing `src/cli` or `src/index` directly.

Why it changed:

The previous checkpoint established deploy JSON as a public automation surface.
The tests now protect the package-level import path that future examples,
adapters, and scripts should use.

Convex references inspected:

- `npm-packages/convex/package.json`
  - declares explicit public package exports.
- `npm-packages/convex/src/cli/lib/command.ts`
  - command behavior is part of the package's public developer tooling
    surface.

Flarex differences:

- This test targets the local TS-source package self-reference, not a built npm
  package artifact.

Known limitations:

- The test proves the root source entrypoint, not a future published binary.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/index.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Deploy JSON Output Coverage

Previous completed checkpoint: `21b5e38` Add finish rejection remediation
hints.

What changed:

- Added CLI coverage for `flarex-dev deploy --json` successful activation
  output.
- Added CLI coverage for rejected finish JSON output, including code,
  remediation, rejected push, backend error, and diagnostics.
- The rejected finish JSON coverage stores diagnostics only on the embedded
  push, proving JSON mode preserves the same fallback behavior as text output.
- JSON tests include backend-shaped analysis/codegen metadata on source
  responses and assert that deploy JSON output omits those internal fields.
- Added CLI coverage for generic deploy JSON failures so `--json` does not
  silently fall back to stderr outside finish rejections.
- Added CLI coverage for early deploy validation failures before backend option
  construction, using an empty explicit `--root`.
- Added programmatic deploy coverage proving rejected finishes throw
  `FlarexDeployFinishRejectedError` with the structured response and
  remediation hint.

Why it changed:

The previous tests protected human-readable finish rejection output. This
checkpoint protects the new automation surface and the typed error that keeps
CLI JSON output from depending on message parsing.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - deploy tests should cover the finish-push activation boundary.
- `npm-packages/convex/src/cli/lib/deployApi/finishPush.ts`
  - finish-push has a parsed response contract.
- `npm-packages/convex/src/cli/lib/command.ts`
  - machine-readable command modes deserve explicit output tests.

Flarex differences:

- Flarex asserts compact deploy JSON rather than Convex deploy diff/config
  output because those hosted deploy details do not exist yet.

Known limitations:

- The tests cover missing backend URL as the generic JSON failure case, but not
  every possible transport failure.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts test/generate.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Finish Rejection Remediation Coverage

Previous completed checkpoint: `fe5a981` Surface finish rejection codes in dev
errors.

What changed:

- Added a formatter test that asserts remediation text for every current stable
  finish rejection code.
- Extended CLI deploy, programmatic deploy, and local dev runtime failure tests
  to assert the remediation line reaches each shared formatter caller.

Why it changed:

The code line alone proves machine readability, but the developer-facing error
path also needs actionable guidance. The test matrix is compile-checked with
`satisfies Record<FinishPushRejectionCode, string>` so adding a new backend code
forces a corresponding test expectation.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - finish errors are handled at the deploy activation boundary.
- `npm-packages/convex/src/cli/lib/components.ts`
  - deploy reporting is driven by structured finish output.

Flarex differences:

- Flarex tests assert compact remediation lines rather than Convex's richer
  hosted deploy/config error output.

Known limitations:

- No JSON-mode CLI output exists yet, so automation consumers still need the
  typed dev API rather than structured CLI stdout.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts test/generate.test.ts test/dev.test.ts test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Developer-Facing Finish Rejection Code Coverage

Previous completed checkpoint: `31809e0` Add finish rejection codes.

What changed:

- Extended the CLI deploy activation-failure test to assert that stderr includes
  the stable finish rejection code.
- Extended the programmatic deploy and local dev runtime reload failure tests
  to assert the same code line from the shared formatter.
- Added a focused formatter regression proving rejected finish responses still
  surface diagnostics stored on the embedded push when the rejection envelope
  has no top-level diagnostics.

Why it changed:

The previous tests proved the parser accepted stable rejection codes, but not
that developers would actually see those codes when activation failed. This
checkpoint covers the three current callers of `devFinishPushErrorMessage(...)`
so formatter drift is caught at the user-facing boundary. The embedded-push
diagnostic fallback preserves the previous push-status formatter behavior for
custom coordinators and older backend-shaped responses.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - deploy tests should exercise the finish boundary rather than only lower
    parser helpers.
- `npm-packages/convex/src/cli/lib/components.ts`
  - deploy output is driven by structured finish-push response data.

Flarex differences:

- Flarex tests assert a compact rejection-code line instead of Convex's richer
  deployment diff/config output.
- The coverage remains focused on dev package callers because the backend
  response-code contract was already covered in the previous checkpoint.

Known limitations:

- There is still no CLI JSON output mode test because Flarex does not expose
  that mode yet.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts test/generate.test.ts test/dev.test.ts test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Finish Rejection Code Coverage

Previous completed checkpoint: `dbbb06f` Return finish rejection for missing
artifacts.

What changed:

- Backend push lifecycle coverage now asserts the R2 missing-artifact finish
  rejection includes `code: "missing_artifact"`.
- Existing failed and abandoned finish assertions now expect
  `code: "invalid_state"`.
- Dev push coordinator coverage now proves HTTP 409 finish rejection wrappers
  preserve a valid code and reject unknown rejection codes.
- Dev push coordinator coverage now runs a valid-code matrix for
  `invalid_state`, `missing_analysis`, and `missing_artifact`.
- Dev push coordinator coverage now proves malformed rejected envelopes with a
  missing `push` object reach the finish parser and fail with a contract error.
- Generator, dev-runtime, and CLI finish-failure fixtures now use the required
  code field, keeping public test doubles aligned with the backend contract.

Why it changed:

Finish rejections are now machine-readable. Tests need to protect that clients
can branch on a stable code instead of parsing the human error string.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deployApi/finishPush.ts`
  - finish-push has a parsed response contract.
- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - deploy parses finish-push output before continuing.
- `npm-packages/convex/src/cli/lib/components.ts`
  - finish output is structured deploy data.

Flarex differences:

- Flarex tests assert compact rejection codes, not Convex's richer hosted
  deploy diff/config response.
- Generic HTTP errors remain outside the finish rejection code test matrix.

Known limitations:

- No remediation-hint field exists yet.
- Future hosted deploy failure classes need explicit code additions and tests.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/push.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts test/generate.test.ts test/dev.test.ts test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Public Artifact Finish Rejection Coverage

Previous completed checkpoint: `1684c24` Use dedicated finish push responses.

What changed:

- Updated backend push lifecycle coverage for the R2-backed finish path.
- The missing-artifact case now asserts HTTP 409 plus the dedicated
  `{ result: "rejected", push, error }` finish response shape.
- The expected rejected body is checked against the backend `FinishPushResponse`
  rejected variant instead of a loose partial matcher.
- The same test still proves that writing the source package to durable R2
  storage allows the push to activate and records the active execution artifact
  reference.

Why it changed:

The finish response contract should cover public finish failures that occur
before `DeploymentDO.finish` when the worker can still identify the analyzed
push. The test now protects that boundary instead of accepting a generic error
body.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - finish-stage failures are surfaced through deploy.
- `npm-packages/convex/src/cli/lib/components.ts`
  - package upload and finish activation are separate deploy phases.
- `npm-packages/convex/src/cli/lib/deployApi/finishPush.ts`
  - finish-push response handling is a dedicated client contract.

Flarex differences:

- The missing-artifact check is Cloudflare/R2-specific. Convex's hosted deploy
  service does not expose the same worker-side R2 preflight boundary.
- The test asserts Flarex's compact finish rejection wrapper, not Convex's full
  hosted deploy error model.

Known limitations:

- The test does not cover malformed finish requests or unknown routes because
  those are generic HTTP boundary errors, not analyzed-push finish rejections.
- No stable error-code field exists yet.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/push.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Finish Push Response Contract Coverage

Previous completed checkpoint: `51cc7ba` Surface deploy finish diagnostics.

What changed:

- Backend push lifecycle tests now assert rejected finish attempts return the
  dedicated `{ result: "rejected", push, error, diagnostics? }` response shape.
- Backend sync and artifact-runtime activation helpers now unwrap successful
  `{ result: "activated", push }` finish responses.
- Dev push coordinator tests now cover HTTP finish wrappers and legacy raw
  finish status compatibility.
- Dev push coordinator tests now prove HTTP 409 finish wrappers parse as
  domain rejections and non-409 wrapper-shaped failures remain transport
  failures.
- Dev push coordinator tests now prove rejected finish wrappers require an
  explicit error and legacy raw finish compatibility only accepts activated
  statuses.
- Generator and dev-runtime tests now use rejected finish wrappers when
  asserting backend finish diagnostics in developer-facing errors.
- The backend sync runtime integration helper validates the finish wrapper at
  the cross-package boundary before continuing with live-query tests.

Why it changed:

The previous diagnostics tests proved useful text reached the developer, but
they did not protect the actual finish API contract. These tests pin finish as
an explicit success/rejection wrapper while keeping legacy compatibility
covered in the dev parser.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - deploy flow treats finish errors separately from earlier validation.
- `npm-packages/convex/src/cli/lib/components.ts`
  - component deploy orchestration keeps finish as a separate phase.
- `npm-packages/convex/src/cli/lib/deployApi/finishPush.ts`
  - finish-push has its own client-side response handling.

Flarex differences:

- Tests cover Flarex's compact activation/rejection wrapper, not Convex's full
  hosted deployment response surface.
- Compatibility tests intentionally allow old raw finish statuses in dev
  clients during the transition.

Known limitations:

- Pre-finish public route failures can still return generic HTTP error bodies,
  so those are documented but not converted by this test slice.
- No stable error-code assertions exist yet because finish responses only carry
  strings and diagnostics.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev build
git diff --check
```

## Deploy Finish Diagnostics Coverage

Previous completed checkpoint: `f29a231` Abandon failed deploy pushes.

What changed:

- Added generator deploy coverage proving a failed finish status includes the
  backend state, backend error, and backend diagnostics in the thrown message.
- Added CLI deploy coverage proving failed activation diagnostics are printed
  to stderr.
- Added dev-runtime startup reload coverage proving a failed backend finish
  status surfaces backend error and diagnostics through
  `createFlarexDevRuntime(...)`.
- Existing focused backend push/coordinator tests continue to prove finish
  response parsing preserves status `error` and diagnostics.

Why it changed:

Push finish is the activation boundary. Tests now protect the developer-facing
failure surface so backend diagnostics do not get collapsed into a bare state
string.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - finish-push errors are surfaced through the deploy flow.
- `npm-packages/convex/src/cli/lib/components.ts`
  - push orchestration reports finish-stage failures separately from start and
    validation.
- `npm-packages/convex/src/cli/lib/deployApi/finishPush.ts`
  - finish-push response handling is a separate API contract.

Flarex differences:

- Tests cover text formatting from `PushStatus.error` and diagnostics, not a
  Convex-style finish diff/config-error object.
- CLI output is currently plain stderr text.
- Dev-runtime finish failure coverage uses a push-coordinator factory to wrap
  the real local backend start path and force only the finish response.

Known limitations:

- No dedicated test exists for pretty-print/colorized diagnostic output because
  the CLI does not implement it yet.
- No hosted auth/project-selection failure diagnostics exist yet.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts test/generate.test.ts test/cli.test.ts test/dev.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Push Abandon Cleanup Coverage

Previous completed checkpoint: `3c13655` Add backend push deploy command.

What changed:

- Added backend push lifecycle coverage proving an analyzed push can be
  abandoned with a stored reason without changing the active deployment.
- Added backend coverage proving abandoned pushes cannot be finished later.
- Added backend coverage proving activated and unknown pushes cannot be
  abandoned.
- Added backend coverage proving malformed abandon request bodies return
  explicit 400 errors.
- Added backend coverage proving encoded public push IDs route to the intended
  stored push during abandon.
- Added HTTP backend push coordinator coverage for encoded abandon URLs,
  configured headers, request body, and abandoned response parsing.
- Updated generator deploy coverage so pre-finish validation failure calls
  `abandon` and still preserves the original validation error.
- Added generator coverage proving a failed best-effort abandon cleanup does
  not mask the original deploy validation error or call finish.
- Updated CLI deploy coverage so generated-output typecheck failure calls
  backend abandon instead of leaving the push in analyzed state.
- Updated push-state test helpers to accept the new `abandoned` terminal state.

Why it changed:

The deploy command introduced a new failure window after backend analysis and
before finish. Tests now prove that this window is explicit and terminal on
the backend, instead of depending on a later superseding push for cleanup.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/components.ts`
  - start/codegen/typecheck/finish order guides the test expectations.
- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - finish is treated as the activation boundary.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - backend start-push is the persisted candidate boundary.
- `npm-packages/convex/src/cli/lib/deployApi/finishPush.ts`
  - finish-push response is the activation boundary.

Flarex differences:

- Abandon coverage is Flarex-specific because the Cloudflare prototype exposes
  a persisted candidate that can fail local generated-output validation before
  activation.
- Tests assert best-effort cleanup behavior through observable abandon routing,
  while preserving the original local validation error.

Known limitations:

- No test yet proves artifact deletion on abandon because artifact deletion is
  not implemented.
- No hosted authorization coverage exists for abandon.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-backend exec vitest run test/push.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts test/generate.test.ts test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Backend Push Deploy CLI Coverage

Previous completed checkpoint: `f9d1484` Route codegen through backend push analysis.

What changed:

- Added generator tests proving `deployFlarex(...)` writes final generated
  files from backend push `codegenAnalysis` before calling finish.
- Added generator coverage proving deploy does not call finish if pre-finish
  validation fails after codegen.
- Added generator coverage proving deploy rejects pushes whose finish response
  does not activate.
- Added CLI coverage proving `flarex-dev deploy` sends a source package to the
  backend push start endpoint, runs generated-output typecheck, then calls
  finish.
- Added CLI coverage proving generated-output typecheck failures prevent
  finish in enable mode.
- Added CLI coverage proving `--typecheck try` logs the failure but still
  finishes the push.
- Added CLI coverage proving deploy rejects missing backend push options before
  invoking deploy/codegen work.
- Existing malformed `--path` coverage continues to prove config validation
  happens before codegen work even when generated-output typecheck is disabled.
- Typecheck coverage now enforces the narrowed deploy result contract by
  requiring fake analyzed deploy statuses to include `codegenAnalysis`.

Why it changed:

The deployment lifecycle now has a user-facing command. The tests need to
protect the most important correctness boundary: no backend activation after a
failed generated-output validation step.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/components.ts`
  - tests in this slice mirror the start/codegen/validate/finish ordering used
    by Convex's push orchestration.
- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - deploy is a phased lifecycle, not a single request.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - start-push is the backend analysis boundary.
- `npm-packages/convex/src/cli/lib/deployApi/finishPush.ts`
  - finish is the activation boundary.

Flarex differences:

- Tests use fake `fetch` and direct dependency injection instead of hosted auth
  and deployment selection.
- There is no schema/index waiting test yet because that phase does not exist
  in Flarex.
- `--typecheck try` is intentionally allowed to finish, matching the existing
  Flarex codegen try-mode behavior rather than claiming a production-safe
  hosted policy.

Known limitations:

- No end-to-end running backend deploy test exists.
- No failed-finish diagnostic test beyond non-activated state exists.
- No abandon/cleanup behavior exists for failed local validation after push
  start.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Backend Push Codegen CLI Coverage

Previous completed checkpoint: `3a27b91` Preserve analyzer codegen analysis in pushes.

What changed:

- Added `HttpBackendPushCoordinator` coverage proving source packages are sent
  to `/deployments/:deploymentId/push/start` with configured headers and the
  returned `codegenAnalysis` is parsed.
- Added generator coverage proving normal final codegen and dry-run codegen use
  backend push `codegenAnalysis` and do not call `finish`.
- Added generator failure coverage proving final generated files are not
  written when an analyzed push omits `codegenAnalysis`.
- Added CLI coverage for `--backend-url`, `--backend-header`,
  `--deployment-id`, dry-run forwarding, typecheck isolation, incomplete push
  options, malformed backend headers, and rejecting mixed analyzer/push modes.
- Added HTTP backend push URL-prefix coverage so mounted backend adapters do
  not lose their configured base path.
- Added HTTP backend push finish coverage for URL/path-prefix handling, encoded
  deployment and push IDs, headers, request body, and activated response
  parsing.
- Added invalid push-state coverage so inherited object property names like
  `toString` cannot pass the backend push status guard.
- Added compatibility coverage for explicit `undefined` handling in
  `analyzeFlarexSourcePackage(...)`.

Why it changed:

Backend push codegen metadata is now preserved by the backend. The test surface
needs to prove developer-facing codegen consumes that metadata through the
push coordinator rather than falling back to local reconstruction.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - backend push/start is the CLI analysis boundary.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - codegen output is driven by deployment analysis metadata.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - generated files and deployment state are coordinated by dev/deploy flows.

Flarex differences:

- Tests use fake `fetch` for HTTP push instead of hosted platform auth.
- Codegen tests assert no activation because Flarex does not have the deploy
  command that should own push finish yet.
- The temporary direct HTTP analyzer tests remain until backend push fully
  replaces that seam in user-facing CLI.
- CLI tests keep analyzer headers and backend headers separate so error
  messages point at the flag the developer actually passed.

Known limitations:

- No end-to-end hosted backend push/codegen test exists yet.
- No CLI deploy command exists to finish and activate source-package pushes.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts test/generate.test.ts test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
git diff --check
```

## Analyzer Codegen Analysis Persistence Coverage

Previous completed checkpoint: `a09a2b8` Wire codegen CLI to HTTP analyzer.

What changed:

- Added backend push coverage for a configured `FLAREX_ANALYZER` service
  binding on the public source-only push route.
- The test proves the backend sends `{ deploymentId, sourcePackage }` to the
  analyzer service.
- The test returns analyzer `codegenAnalysis` with a function order that would
  differ from reconstruction, then verifies push status and active deployment
  status preserve the analyzer-provided order.
- Added negative coverage proving mismatched `codegenAnalysis` is rejected
  instead of storing inconsistent generated metadata.
- Added coverage proving an OK analyzer response that omits `codegenAnalysis`
  becomes a failed source-only push instead of silently falling back to
  reconstruction.
- Added coverage proving `codegenAnalysis: null` also fails the source-only
  analyzer path, while absent codegen metadata remains an internal/direct
  compatibility fallback.
- Added coverage proving malformed analyzer `analysis` payloads return explicit
  validation errors instead of worker/runtime 500s.
- Added coverage proving codegen analysis source positions must match
  flattened deployment function metadata.
- Added coverage proving analyzer codegen metadata cannot split one module name
  across duplicate module entries.
- Existing analyzed-push tests continue to exercise the compatibility fallback
  where direct internal requests omit `codegenAnalysis`.

Why it changed:

The HTTP analyzer adapter and CLI flags are only useful if backend push storage
preserves the analyzer's authoritative codegen metadata. This test closes the
gap between "analyzer response has codegenAnalysis" and "activated deployment
still exposes that codegenAnalysis."

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - backend push response carries analysis metadata.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated files depend on backend analysis.
- `npm-packages/convex/src/cli/lib/components.ts`
  - analysis metadata flows from push/start into downstream codegen.

Flarex differences:

- The test uses a Miniflare service binding for `FLAREX_ANALYZER`; hosted
  Dynamic Worker analyzer coverage is still future work.
- The ordering assertion is a persistence signal, not a user-facing ordering
  guarantee.

Known limitations:

- No end-to-end hosted Dynamic Worker analyzer test exists yet.
- The test does not cover legacy rows created before `codegen_analysis_json`;
  existing push tests continue to cover fallback reconstruction through direct
  analyzed pushes.

Verification:

```sh
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/push.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter @flarex/backend typecheck
corepack pnpm --filter @flarex/backend build
git diff --check
```

## HTTP Backend Source Analyzer Coverage

Previous completed checkpoint: `2560e38` Route codegen through backend analysis seam.

What changed:

- Added tests for `HttpBackendSourceAnalyzer` success, remote failure
  diagnostics, and invalid successful responses without `codegenAnalysis`.
- Added tests for malformed nested `codegenAnalysis` and successful HTTP
  responses that incorrectly include an `error` field.
- Added regressions for malformed nested validator JSON preserving diagnostics
  and unsupported non-null `route` metadata being rejected.
- The malformed-response tests now assert path-aware contract errors for schema
  metadata, validators, route metadata, and impossible success-with-error
  bodies.
- Updated local analyzer service coverage to assert it returns `codegenAnalysis`
  alongside flattened backend analysis.
- Kept the tests at the backend-push boundary, where analyzer request/response
  contracts already live.

Why it changed:

The previous codegen seam is only useful for hosted analysis if the HTTP
adapter is reliable and fails clearly. These tests lock down the response shape
before CLI flags or hosted analyzer deployment are added.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/components.ts`
  - backend push response is the source of analysis truth.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - response parsing is part of the deploy API boundary.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated output depends on analyzed metadata.

Flarex differences:

- Tests use a fake `fetch` implementation rather than a live hosted analyzer.
- The adapter requires `codegenAnalysis` explicitly because the current Flarex
  analyzer response also contains flattened backend analysis for push storage.
- Diagnostics normalization is shared with local execution artifact analysis,
  including the same last-100 cap.
- The fake HTTP boundary is intentionally untyped at input and typed at the
  local service response, matching the real network boundary while keeping the
  backend response contract enforced by TypeScript.
- Backend push tests were updated so reconstructed codegen analysis uses
  `partition` metadata only; executable deployment metadata can still carry
  legacy `route` metadata where backend invocation needs it.

Known limitations:

- No CLI integration test for remote analyzer flags exists yet.
- No end-to-end hosted analyzer test exists yet.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-backend typecheck
git diff --check
```

## Codegen Backend Analysis Seam Coverage

Previous completed checkpoint: `5bdc5d9` Add codegen dry-run.

What changed:

- Added generator tests that inject a `BackendSourceAnalyzer` into
  `generateFlarex(...)` and `dryRunFlarexCodegen(...)`.
- The tests prove generated metadata comes from the injected backend analysis
  result and that dry-run still does not write final generated metadata.

Why it changed:

The codegen path is moving toward Convex's backend-authoritative analysis
model. Before wiring hosted push, tests need to prove the generator is no
longer hard-coded to direct local artifact analysis.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/components.ts`
  - push/start owns backend analysis.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - response carries analyzed metadata.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final codegen consumes backend-provided analysis.

Flarex differences:

- Tests inject a local fake `BackendSourceAnalyzer`; they do not run a hosted
  backend push.
- The default local analyzer still uses Miniflare execution artifacts behind
  the backend-shaped seam.

Known limitations:

- No hosted backend codegen test exists yet.
- This coverage does not prove persistence of authoritative analysis across
  deployments.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "injected backend source analysis" --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example generate
git diff --check
```

## Codegen Dry-Run Coverage

Previous completed checkpoint: `b40fb92` Preserve generated extension entries.

What changed:

- Added CLI dependency-boundary coverage proving `codegen --dry-run` calls the
  dry-run planner, prints write/delete lines, and skips normal generate and
  generated-output typecheck dependencies.
- Added CLI integration coverage proving real dry-run codegen does not create
  `_generated/server.ts` in the project.
- Added generator coverage proving `dryRunFlarexCodegen(...)` reports final
  writes and stale deletes while preserving real stale files and `_generated/ai`
  on disk.
- Added generator coverage for a project without a `flarex/` app directory so
  dry-run preserves normal initial-codegen compatibility without creating real
  project files.

Why it changed:

The previous checkpoints made dry-run pieces testable independently. This
checkpoint verifies the user-facing command and the non-mutating lower-level
planner together before more CLI behavior is layered on top.

Convex references inspected:

- `npm-packages/convex/src/cli/codegen.ts`
  - Convex has a first-class `--dry-run` flag on codegen.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Dry-run write reporting is part of shared codegen write behavior.
- `npm-packages/convex/src/cli/lib/fsUtils.ts`
  - Dry-run delete reporting is part of shared recursive delete behavior.

Flarex differences:

- Tests assert Flarex's temp-copy dry-run contract because local analysis needs
  generated imports to exist while bundling.
- Tests do not assert exact ordering of every dry-run line beyond the focused
  dependency-boundary output.

Known limitations:

- No hosted/backend-authoritative dry-run test exists yet.
- Dry-run typecheck behavior is intentionally skipped for now because the real
  generated files are not written.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts -t "dry-run" --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "dry-runs" --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts test/generate.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example generate
git diff --check
```

## Preserved Generated Entry Coverage

Previous completed checkpoint: `6dda926` Plan stale generated cleanup.

What changed:

- Extended generator coverage so `_generated/ai` is not reported as stale and
  survives normal `generateFlarex(...)` cleanup.
- The stale-entry test now proves the same helper both plans real stale entries
  and skips preserved generated entries.

Why it changed:

The previous stale-entry planner made dry-run deletion testable, but it still
needed Convex's preserved-entry behavior before the next CLI slice could claim
Convex-style deletion semantics.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Convex preserves `ai` in `PRESERVED_GENERATED_ENTRIES`.
  - Convex stale cleanup skips preserved entries before recursively deleting
    unknown generated output.

Flarex differences:

- The Flarex test uses real temporary directories and async Node filesystem
  APIs instead of Convex's CLI context filesystem abstraction.
- Coverage currently asserts only the `ai` preserved entry.

Known limitations:

- No CLI `--dry-run` test exists yet.
- Additional preserved generated extension entries will need explicit tests.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "plans stale generated entries" --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example generate
git diff --check
```

## Stale Generated Entry Plan Coverage

Previous completed checkpoint: `8531b41` Extract final codegen write plan.

What changed:

- Added focused generator coverage for `staleGeneratedEntries(...)`.
- The test creates a stale file and stale directory under `_generated`, verifies
  the planner reports both without deleting them, then runs normal generation
  and verifies stale cleanup still removes both entries.
- The package export is covered through the same public `flarex-dev` test import
  path used by other codegen helpers.

Why it changed:

A Convex-style `codegen --dry-run` test should eventually assert both files
that would be written and stale generated entries that would be deleted. This
coverage proves the deletion side can be tested independently before adding the
CLI flag.

Convex references inspected:

- `npm-packages/convex/src/cli/codegen.ts`
  - `--dry-run` is a command-level behavior.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated file mutation behavior is centralized behind shared helpers.

Flarex differences:

- The test covers the helper and normal generator behavior, not the final CLI
  dry-run surface.
- The helper returns filesystem entry metadata rather than Convex's exact
  command output.

Known limitations:

- No end-to-end dry-run command test exists yet.
- Output formatting and exit-code behavior are still open for the CLI slice.
- No preserved-entry test exists yet. Before generated extensions are
  supported, stale-entry coverage must add a preserved-name case matching the
  Convex `PRESERVED_GENERATED_ENTRIES` pattern.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "plans stale generated entries" --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example generate
git diff --check
```

## Final Generated Write Plan Coverage

Previous completed checkpoint: `f6a1984` Add codegen typecheck modes.

What changed:

- Added generator test coverage for `finalGeneratedFiles(...)`.
- The test runs initial codegen, bundles the source package, analyzes through
  the local execution artifact adapter, inspects the final write plan, and
  then verifies `finalCodegen(...)` writes the same final registry content.
- The test proves final-only files are not written by plan construction.

Why it changed:

The next Convex-style CLI behavior is dry-run codegen. Before testing a command
flag, Flarex needs coverage around a reusable generated-write planning
boundary that does not mutate the generated directory.

Convex references inspected:

- `npm-packages/convex/src/cli/codegen.ts`
  - `--dry-run` is a command-level codegen behavior.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated code behavior is shared across CLI workflows.

Flarex differences:

- The test still runs real initial codegen because functions import
  `_generated/server`.
- The test covers final write planning, not a full dry-run command.

Known limitations:

- No CLI `--dry-run` validation exists yet.
- Stale deletion planning is not represented.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "plans final generated output" --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example generate
git diff --check
```

## CLI Typecheck Mode Coverage

Previous completed checkpoint: `7eeb277` Add source CLI entrypoint.

What changed:

- Added CLI tests for `--typecheck disable`, `--typecheck try`, and invalid
  mode prevalidation.
- Existing tests continue to cover bare `--typecheck` as the enable shorthand.
- The example generated-output command now exercises explicit
  `--typecheck enable`.
- CLI help validation now shows `--typecheck <mode>`.

Why it changed:

Mode coverage is needed before the CLI grows more commands. Typecheck behavior
is a command contract, and invalid values must not write generated files before
failing.

Convex references inspected:

- `npm-packages/convex/src/cli/codegen.ts`
  - Convex typecheck behavior is a mode option, not only a boolean.
- `npm-packages/convex/src/cli/program.ts`
  - CLI command behavior belongs behind the process command boundary.

Flarex differences:

- Tests call the runner directly for error and mode behavior rather than a
  built binary.
- Flarex defaults typecheck mode to disabled for now.

Known limitations:

- There is no installed binary test yet.
- `try` mode is only covered for generated-output typecheck failure.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev cli -- codegen --help
corepack pnpm --filter @flarex/example typecheck:generated
corepack pnpm --filter @flarex/example generate
corepack pnpm --filter @flarex/example typecheck
git diff --check
```

## Source CLI Entrypoint Validation

Previous completed checkpoint: `24fcc04` Route example generate through CLI
runner.

What changed:

- Added `packages/flarex-dev/src/bin.ts` and validated it through
  `corepack pnpm --filter flarex-dev cli -- codegen --help`.
- Added CLI unit coverage proving the runner ignores the leading `--`
  separator that package scripts pass through to `process.argv`.
- Added `tsx` as a package-local dev dependency for the source entrypoint
  script.

Why it changed:

The runner tests covered direct function calls, and the example app exercised
the runner indirectly, but no test or command validated a process entrypoint.
This adds the first source-mode process boundary while avoiding a fake package
binary.

Convex references inspected:

- `npm-packages/convex/bin/main-dev`
  - source-mode CLI runs through `tsx`.
- `npm-packages/convex/bin/main.js`
  - packaged CLI imports built JavaScript.
- `npm-packages/convex/src/cli/program.ts`
  - command entrypoint registers CLI behavior.
- `npm-packages/convex/src/cli/codegen.ts`
  - codegen is command-level behavior.

Flarex differences:

- Validation uses a package script, not an installed npm binary.
- The separator normalization is needed because `pnpm run ... -- ...` forwards
  the separator to this source script.
- The command parser remains intentionally small until more commands exist.

Known limitations:

- No global binary installation is tested.
- No deploy/dev command process entrypoints exist yet.

Verification:

```sh
corepack pnpm --filter flarex-dev cli -- codegen --help
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example generate
corepack pnpm --filter @flarex/example typecheck:generated
corepack pnpm --filter @flarex/example typecheck
git diff --check
```

## Example Generate Validates CLI Runner

Previous completed checkpoint: `5efa1f7` Default codegen CLI root to project.

What changed:

- The example app's `generate` script now runs through `runFlarexDevCli(...)`.
- Validation now includes `corepack pnpm --filter @flarex/example generate` as
  a direct check of the normal app codegen path.
- Existing example typecheck commands now exercise CLI-runner codegen both
  directly and transitively.

Why it changed:

The previous tests covered the runner and generated typecheck, but the normal
example app generation command still used the lower-level helper. Moving that
script to the runner proves the app-facing codegen command shape works in the
real workspace package.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - codegen tests should exercise the command workflow, not only lower-level
    helpers.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - project-local command behavior is part of local workflow readiness.

Flarex differences:

- The command is still invoked through `tsx` because no built binary is
  published.
- The reusable helper remains tested directly for parser and option behavior.

Known limitations:

- This does not test global binary installation.
- This does not add deploy/dev CLI coverage.

Verification:

```sh
corepack pnpm --filter @flarex/example generate
corepack pnpm --filter @flarex/example typecheck:generated
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example typecheck
git diff --check
```

## CLI Default Project Root Coverage

Previous completed checkpoint: `1ae9066` Add source CLI runner for codegen.

What changed:

- Added CLI test coverage proving `codegen` defaults to the runner's project
  root when `--root` is omitted.
- Updated the real generated-output CLI test to use that default-root path.
- Replaced the old missing-root diagnostic expectation with empty-explicit-root
  validation.
- The example `typecheck:generated` script now exercises the no-`--root`
  command path.

Why it changed:

The previous runner tests proved explicit-root behavior. The more important
developer workflow is project-cwd execution, matching Convex's command model.
This test slice proves the command can be used that way while still rejecting
bad explicit root input.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - codegen is a project-local command.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - local workflows are coordinated from project context.

Flarex differences:

- Tests inject `projectRoot` to avoid depending on the Vitest process cwd.
- The example command still passes workspace TypeScript path mappings because
  this repo uses source workspace packages.

Known limitations:

- No installed binary test exists yet.
- No deploy/dev command coverage exists yet.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example typecheck:generated
git diff --check
```

## CLI Runner Coverage For Generated Typecheck

Previous completed checkpoint: `1a19708` Add example generated output
typecheck.

What changed:

- Added `packages/flarex-dev/test/cli.test.ts`.
- The test runs the new CLI runner through a real temp Flarex project and
  generated-output typecheck.
- Added parser coverage for missing `--root`, app/generated directory
  forwarding, repeated `--path` mappings, and malformed path mapping
  diagnostics.
- The example app's generated-output command now validates the same
  `runFlarexDevCli(...)` code path instead of duplicating helper calls.

Why it changed:

The previous checkpoint added an example command, but it did not create a
command boundary that could become a Convex-style CLI. Testing the runner
directly keeps codegen/typecheck behavior reusable across app scripts, future
CLI binaries, and dev tooling.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated code validation belongs to command workflow logic.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - developer commands coordinate readiness around generated/deployed state.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - generated TypeScript must remain typecheckable independently.

Flarex differences:

- Tests call the runner directly rather than invoking a package `bin`.
- The runner is dependency-injectable so parser tests can assert option
  forwarding without doing unnecessary file or compiler work.
- Workspace path mappings remain explicit until package distribution is
  settled.

Known limitations:

- This does not test an installed npm binary because no binary exists yet.
- This does not cover deploy/push/dev CLI commands.

Verification:

```sh
corepack pnpm --filter @flarex/example typecheck:generated
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Example Generated Output Typecheck Script

Previous completed checkpoint: `a902d50` Gate dev flow on generated typecheck.

What changed:

- Added an example-app `typecheck:generated` script that regenerates Flarex
  output and runs the reusable generated-output TypeScript gate.
- Added `apps/example/scripts/typecheck-generated.ts` so the manual validation
  path uses the same `flarex-dev` helper as the unit and dev-runtime tests.

Why it changed:

The generated-output gate had coverage inside `flarex-dev`, but the example app
did not yet prove that an application can call the helper as a real CI/manual
check. This makes the example closer to Convex's workflow where generated API
contracts are part of everyday developer validation.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated files are validated through developer commands.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - local workflow readiness depends on generated/deployed state.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - generated TypeScript should stay directly typecheckable.

Flarex differences:

- This is not a new Vitest case. It is an example-app script validation path
  that can run in CI or manually.
- Workspace path mappings are explicit until Flarex has a real published CLI
  and package-resolution story.

Known limitations:

- The command does not replace full app `tsc`; it only checks the generated
  tree.
- A future CLI should remove the need for each app to carry this helper script.

Verification:

```sh
corepack pnpm --filter @flarex/example typecheck:generated
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter flarex-dev typecheck
git diff --check
```

## Dev Runtime Generated Output Typecheck Coverage

Previous completed checkpoint: `7380900` Expose generated output typecheck.

What changed:

- `dev.test.ts` now enables generated-output typechecking for the local dev
  runtime fixture.
- The existing dev-runtime test covers the generated-output gate across the
  local backend push lifecycle and generated app startup.
- The Postgres executor dev-runtime path also enables the gate so both local
  execution transports share the same generated-output validation.
- Added a dev-runtime startup failure regression using a bad TypeScript CLI
  path to prove the generated-output gate is actually called before activation.
- Added a cleanup regression proving failed default-persist dev runtime startup
  removes `.flarex/dev`.
- Added a Vite plugin build regression proving the plugin-owned codegen path
  runs the generated-output gate when enabled.
- Added a Vite `dev: false` serve regression proving plugin-owned startup
  codegen/typecheck is not duplicated across Vite lifecycle hooks.
- Added a default Vite dev regression proving `typecheckGeneratedOutput` is
  forwarded into the dev runtime rather than swallowed by the plugin layer.
- Added a generated typecheck option regression proving structurally wider
  nested configs cannot override host codegen paths.
- Added a dev-runtime dispose regression proving normal `dispose()` reports
  default persist cleanup failures instead of swallowing them.
- Added a `dev: false` watcher regression proving generated-output failures
  are logged through Vite.
- Extracted repeated minimal Flarex project setup into
  `packages/flarex-dev/test/fixtures.ts`.

Why it changed:

The previous generator-only test proved the helper in isolation. The next test
surface must prove it is usable in the real local dev orchestration path after
final codegen and before activation.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - dev orchestration coordinates generated code with served deployment state.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated code and typecheck behavior belong to the shared dev workflow.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - generated TypeScript templates should remain valid in realistic app
    fixtures.

Flarex differences:

- Tests pass workspace path mappings because the example app is a workspace
  package without its own installed `node_modules`.
- Failure tests use a bad TypeScript CLI path so they prove gate ownership
  without depending on fragile generated TypeScript edits.

Known limitations:

- Vite watcher failure behavior is covered for `dev: false`; default dev
  runtime watcher reload success/failure is still only indirectly covered.
- No browser-facing diagnostic UX is tested yet.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generatedTypecheck.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/devDispose.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/dev.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/vite.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "typechecks generated output" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev build
```

## Reusable Generated Output Typecheck Helper

Previous completed checkpoint: `f7634e1` Typecheck generated output tree.

What changed:

- The generated-output TypeScript gate now uses the exported
  `typecheckGeneratedOutput(...)` helper from `flarex-dev` source.
- The test no longer owns child-process execution, TypeScript config
  construction, or error-output formatting.
- Test-specific workspace path mappings remain in the test, while the reusable
  helper owns generated directory discovery, temporary config cleanup, and
  compiler invocation.

Why it changed:

Keeping the compiler gate only in a test made it impossible for future dev
server, CLI, or example-app lanes to reuse the same behavior. This makes the
test cover the actual package API that will become the local developer
typecheck boundary.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - codegen/typecheck behavior is shared workflow logic, not isolated test
    code.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - generated TypeScript contracts require reusable validation.

Flarex differences:

- Flarex still validates through Vitest in this slice.
- The helper writes a focused temporary config and cleans it up rather than
  invoking a full app typecheck or leaving root-level generated config files.

Known limitations:

- Only the generator test currently exercises the helper.
- Future tests should cover failure output once the public CLI/dev gate exists.

Verification:

```sh
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "typechecks generated output" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev build
```

## Generated Directory Typecheck Coverage

Previous completed checkpoint: `53eda56` Typecheck generated Worker output.

What changed:

- The generated-source Vitest gate now compiles
  `flarex/_generated/**/*.ts`.
- The coverage includes generated runtime files and generated developer API
  files in the same TypeScript program.
- The helper and temporary tsconfig names now use generated-output wording
  instead of Worker-only wording.

Why it changed:

Generated files are authored as templates and do not get checked by the
package's own `tsconfig` unless tests compile emitted output. The prior
worker-only test closed the most urgent runtime hole; this extends the same
testing strategy to the complete generated directory.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Convex uses typecheck-aware codegen flows.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - Convex generated files are stable TypeScript contracts, so template output
    must remain type-correct.

Flarex differences:

- Flarex currently proves generated output through package tests only, not a
  public CLI command.
- The representative fixture is intentionally small to keep generator tests
  fast while still forcing imports through user functions and schema.

Known limitations:

- This is not exhaustive over every schema placement, validator, or partition
  API shape.
- Future slices should either add more generated-output fixtures or expose a
  reusable generated typecheck command for dev/plugin use.

Verification:

```sh
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "typechecks generated output" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev build
```

## Generated Runtime Typecheck Coverage

Previous completed checkpoint: `90df37a` Guard nested function execution.

What changed:

- Added test-only TypeScript compilation for generated
  `flarex/_generated/worker.ts`.
- The test writes a temporary strict TypeScript config into the generated app
  and runs the workspace TypeScript compiler with `noEmit`.
- The config includes Cloudflare Worker types and workspace path mappings so a
  temp app can typecheck generated imports without its own installed
  dependencies.

Why it changed:

Generated Worker code is authored as a template string inside `flarex-dev`.
Package typecheck validates the generator, not the emitted Worker. This test
lane closes that gap and would have caught the missing `nestedCallDepth` field
found during review.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Convex connects codegen with explicit typecheck modes.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
  - generated TypeScript is a maintained compatibility surface.

Flarex differences:

- Flarex starts with a focused Worker-template typecheck in Vitest instead of
  a full CLI typecheck mode.
- The temp config uses direct workspace path mappings because generated test
  projects are outside package manager resolution.

Known limitations:

- Generated API/server/dataModel files are still asserted mostly by string
  checks and downstream bundle tests.
- This is not yet exposed as a user command in local dev.

Verification:

```sh
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "typechecks generated Worker output" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev build
```

## PGlite Local And Test Lane

Previous completed checkpoint: `beef4d2` Document Postgres multitenant
persistence schema.

The Postgres-authoritative executor should use PGlite as the default local and
fast-test persistence backend.

Testing lanes now become:

```txt
PGlite lane:
  package tests
  example app tests
  Vite/local dev
  in-process executor harness
  no Nitro app required

real Postgres lane:
  isolation and lock correctness
  migration correctness
  production index/query behavior
  outbox dispatcher behavior

Nitro adapter lane:
  small HTTP/auth/route smoke tests only
```

This preserves the existing goal that tests reuse the real runtime logic rather
than a fake backend. The difference is that the real runtime logic moves from
Miniflare `PartitionDO` storage to framework-neutral executor core plus
PGlite/Postgres persistence adapters.

PGlite references:

- official PGlite docs describe Node/Bun/Deno and browser usage,
  in-memory storage, filesystem persistence, `.query`, `.exec`, and
  `.transaction(...)` callback semantics.

Convex references:

- `crates/database/src/transaction.rs`
- `crates/database/src/committer.rs`
- `crates/common/src/runtime/mod.rs`

Known limitation:

- PGlite is not a replacement for real Postgres concurrency validation. It is
  the fast lane. Real Postgres remains required for final transaction,
  isolation, lock, outbox, and migration confidence.

Verification:

```sh
git diff --check
```

## Goal

Flarex must guarantee transaction serializability, schema invariants, and data safety in a highly concurrent, distributed edge environment. To achieve this, Flarex needs a robust testing strategy that includes local unit/integration tests and deterministic simulation tests (e.g., monkey testing for restarts, latency injection, and partition failures).

## Implemented

- Added Vitest/Miniflare integration test suites under `custom/cloudflare-executor/apps/backend/test/` to verify transaction lifecycles, write coalescing, and OCC conflict propagation.
- Configured local Vitest tests for the SDK and compiler generator under `custom/cloudflare-executor/packages/flarex-backend/test/` and `packages/flarex/test/`.
- Configured automated workspace type-checking and lint checks.
- Added `apps/backend/vitest.config.ts` to run backend test files without file
  parallelism. Each backend test file creates its own Miniflare Worker/DO
  harness, and parallel harness startup can exceed default per-test hook
  timeouts on Windows.
- Added SDK ID codec tests and generator assertions so the canonical
  `{tableId}:{documentId}` format does not silently regress back to
  table-name-prefixed IDs.
- Added Miniflare integration tests for backend execution sessions:
  mutation syscalls stage writes until `/finish`, return validation prevents
  commits, and indexed query syscalls return snapshot reads.
- Added an example-app generated Worker E2E test with a Miniflare service
  binding to the backend harness. It verifies generated `/invoke` can execute
  a mutation and query through backend execution sessions and `PartitionDO`.
- Added `packages/flarex-test`, a first test SDK layer that reuses
  `flarex-dev` local runtime and the real `flarex-backend` Worker/DO runtime.
  The example E2E now uses `flarexTest()` instead of a hand-written Miniflare
  harness.
- Added an example-specific `vitest.config.ts` so Vitest does not load the
  app's Vite dev plugin during tests. This removes the lingering open file
  handles and close-timeout warning after example tests pass.
- Made the backend test harness resolve its Worker entry from the harness file
  path instead of the process cwd, so other packages can reuse it safely.
- Added a cross-package runtime materializer integration test proving a stored
  source package can be loaded from backend R2, materialized in Miniflare,
  invoked through public backend `/invoke`, and executed through backend
  sessions/syscalls. The test also verifies the runtime cache reuses the
  materialized artifact across mutation and query calls.

## Why This Shape

In a distributed environment built on Cloudflare Durable Objects, concurrency anomalies, network partitions, and Durable Object restarts (due to CPU limits, eviction, or crashes) are common failure modes. Standard unit tests are insufficient to uncover race conditions in multi-step transactions, cross-shard interactions, or index updates during concurrent writes.

Inspired by database simulation testing models (such as FoundationDB's simulation engine and Convex's proprietary randomized testing), Flarex must decouple the runtime engine from physical IO. This allows a simulation framework to:
1. Control the scheduling of asynchronous events and Durable Object storage operations.
2. Inject random network latency, Durable Object evictions/restarts, and storage transaction failures.
3. Run tests deterministically by controlling the global seed of a pseudo-random number generator (PRNG).

## Convex References

- `crates/common/src/runtime/mod.rs`
  - Defines the `Runtime` trait which abstracts time, scheduling, and IO to support deterministic testing/simulation.
- `crates/database/src/committer.rs`
  - Used in transactional commit checks and conflict resolution testing.
- Public `convex-backend` Repository Structure:
  - While Convex leverages advanced randomized simulation testing internally to ensure correctness, **these test frameworks are proprietary and excluded from the public open-source repository** (as noted in their `README.md`). Flarex must construct its own open simulation tools suitable for the Cloudflare worker stack.

## Cloudflare Differences

- Convex runs inside container/VM isolation layers (with V8 isolate execution) and coordinates transaction logs in a Rust-managed runtime.
- Flarex runs directly inside Cloudflare Durable Objects and Workers. Testing must simulate:
  - Durable Object lifetime states (active memory, storage eviction, system-triggered restarts).
  - Durable Object transactional storage locks and transactions.
  - Inter-DO network latency and HTTP failures.
  - Durable Object alarms (scheduled tasks).

## Known Limitations

- Tests are currently classic integration tests running against Miniflare. They do not support deterministic time, thread scheduling control, or pseudo-random seed repeatability.
- Backend Miniflare tests are intentionally serialized at the file level for
  stability. This reduces test throughput but avoids timing-sensitive Worker
  bundle/harness startup failures.
- Durable Object evictions/restarts are not yet simulated in concurrent execution paths.
- Network latency injection and network partitions between shards or DOs are not yet modeled.

## Next Work

1. **Virtual Runtime Abstraction:** Introduce a mock runtime layer for Flarex (similar to Convex's `Runtime` trait) that abstracts `scheduler`, `fetch`, `time`, and `storage`.
2. **Deterministic Simulator Runner:** Build a simulator that runs multiple client actors against a virtual DO cluster using mock time and controllable task queues.
3. **Fault Injection (Monkey Testing):**
   - Periodically delete/recreate Durable Object memory states to force disk reloads during active operations.
   - Inject network drops and HTTP `503` responses.
   - Randomly abort Durable Object storage transactions to verify transactional rollback and retries.
4. **Consistency Checking Invariants:** Define safety checkers (e.g., checking for double-spending, index inconsistencies, or lost updates) that run at the end of each simulation run.

## Verification

```sh
corepack pnpm --filter flarex test
corepack pnpm --filter @flarex/backend test
corepack pnpm --filter flarex-backend test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
```

## Runtime Materializer Test Update

Previous completed checkpoint: `0447832` Add artifact runtime materializer
cache.

`packages/flarex-dev/test/runtimeMaterializer.test.ts` now covers the full
stored-package invoke shape:

```txt
start analyzed push
  -> put source package in backend R2 store
  -> finish push
  -> public backend invoke
  -> artifact runtime cache
  -> local Miniflare materializer
  -> backend execution sessions
```

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - execution routes through a backend-owned runner after active deployment
    metadata is resolved.
- `crates/application/src/module_cache/mod.rs`
  - loaded execution state is cached by package/module identity.

Cloudflare difference: this is an integration test over Miniflare Workers,
Durable Objects, and R2 rather than Convex's internal simulation framework. It
proves the runtime boundary but does not yet simulate DO eviction, runtime
eviction, or concurrent OCC retries.

Verified with:

```sh
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts
```

## Dev Runtime Artifact Invoke Test Update

Previous completed checkpoint: `c8c16bb` Materialize stored source packages
locally.

The local dev runtime test now verifies `/__flarex_dev/invoke` through the
backend artifact runtime path. The test still uses the example app, but the
normal invoke request now reaches backend `/deployments/:deploymentId/invoke`
and therefore covers active deployment lookup, R2 artifact storage, runtime
materialization, backend execution sessions, and `PartitionDO` commit.

Convex reference:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - local dev should exercise the backend deployment/invoke loop rather than a
    separate app-local execution shortcut.

Cloudflare difference: this remains a Miniflare integration test, not a
hosted Dynamic Worker test. It is still the correct local proof because it
uses the same service-binding and stored-source-package boundaries.

Verified with:

```sh
corepack pnpm --filter flarex-dev test -- dev.test.ts
```

## Runtime Store Contract Test Update

Previous completed checkpoint: `ef50030` Use artifact runtime for local dev
invoke.

The artifact runtime tests now cover both runtime modes:

- compatibility mode, where backend invoke embeds `sourcePackage` in the
  runtime payload,
- runtime-store mode, where backend invoke sends only the artifact ref and the
  runtime service loads source package bytes from `BackendExecutionArtifactStore`.

`runtimeMaterializer.test.ts` now runs through the runtime-store mode with the
backend harness, R2 artifact storage, service binding runtime, and local
Miniflare materializer.

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - execution tests should validate package identity handoff to the runner.
- `crates/model/src/source_packages/mod.rs`
  - source package retrieval should be tested through the storage model.

Cloudflare difference: these are still Miniflare integration tests. They prove
the artifact-store service contract but not hosted Dynamic Worker eviction or
Cloudflare production R2 behavior.

Verified with:

```sh
corepack pnpm --filter flarex-backend test -- artifactRuntime.test.ts
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts dev.test.ts
```

## Artifact Lifecycle Test Update

Previous completed checkpoint: `e1ccf14` Let artifact runtime load source
packages.

`artifactRuntime.test.ts` now verifies materialized artifact cleanup:

- replacing a cached artifact with a new source hash disposes the old artifact,
- `delete()` disposes a single cached artifact,
- `clear()` disposes every cached artifact,
- runtime service `dispose()` clears the cache and disposes cached artifacts.

These tests are intentionally small and deterministic. They protect the local
Miniflare materializer from leaking nested runtimes and establish the lifecycle
contract the hosted Dynamic Worker runtime must implement later.

Convex reference:

- `crates/application/src/module_cache/mod.rs`
  - cache identity and ownership are part of runtime correctness.

Cloudflare difference: disposal currently means nested Miniflare cleanup. In
hosted Cloudflare it should map to Dynamic Worker eviction or platform runtime
release.

Verified with:

```sh
corepack pnpm --filter flarex-backend test -- artifactRuntime.test.ts
```
