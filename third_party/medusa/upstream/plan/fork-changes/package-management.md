# Package Management

Commit:

- `c3a9e6bd8a` (`build: convert Medusa fork to pnpm workspace`)

## pnpm Workspace Ownership

This fork now uses pnpm as the package manager for the Medusa workspace.

Changes from original Medusa/Yarn ownership:

- `pnpm-workspace.yaml` is the canonical workspace definition.
- The workspace globs mirror the previous Yarn workspace package boundaries.
- `packageManager` is `pnpm@11.7.0`.
- pnpm uses `nodeLinker: hoisted` as the first compatibility bridge.
- Yarn `resolutions` moved to pnpm `overrides`.
- Active Yarn patches moved to the package-manager-neutral `patches/` folder
  and are referenced through pnpm `patchedDependencies`.
- Yarn lock/config/release/plugin ownership was removed after pnpm validation.

The root package also declares a focused set of `workspace:*` dev dependencies
for Medusa packages that were previously reachable through Yarn's workspace
layout. This keeps the first pnpm slice compatibility-first and avoids mixing
the package-manager migration with a broad dependency-declaration cleanup across
all package manifests.

## Internal Workspace Resolution

Commit:

- `8b02a0c77c` (`build: require workspace links for internal packages`)

All dependency edges between active packages in this pnpm workspace now use
`workspace:*`. The normalization covers `dependencies`, `devDependencies`,
`optionalDependencies`, and `peerDependencies`.

Affected boundary:

- 86 active pnpm projects and 409 local-package dependency edges.
- 364 edges changed in this slice: 313 exact `2.13.4` references, three exact
  `4.1.4` references to `@medusajs/ui`, and 48 `workspace:^` references in the
  private integration-test workspaces.
- 45 existing `workspace:*` references were already compliant.
- The excluded top-level `integration-tests/package.json` remains untouched;
  it is not an active pnpm workspace and still describes an older published
  integration fixture.

Package `version` fields, package privacy, public release configuration,
catalogs, and the compatibility-first hoisted linker are unchanged. This slice
only guarantees that an active local dependency cannot silently fall back to a
registry package with the same name.

The root `check:workspace-dependencies` command discovers the active workspace
with `pnpm list -r --depth -1 --json`, fails when a local edge is not
`workspace:*`, and supports a reviewed `--write` mode for mechanical fixes.

Local contributor publishing remains compatible with the new manifest form:

- `medusa-dev-cli` translates workspace specifiers in dependency, development,
  optional, and peer fields to concrete temporary versions before its existing
  raw `npm publish` call to Verdaccio.
- Yalc is pinned exactly to `1.0.0-pre.53` at both call sites and patched to
  resolve workspace versions directly
  from installed manifests instead of export-gated `require.resolve`, to fail
  instead of falling back to bare `*`, and to include optional dependencies.
  Plugin publish and develop commands therefore never rewrite the contributor's
  source manifest.

Lockfile validation found exactly 299 local importer `specifier` changes and no
resolved local-link changes. The other 65 normalized edges are peer
dependencies and therefore do not have importer entries in the pnpm lockfile.
The Yalc safety patch separately adds one patched-dependency hash and changes
two Yalc importer resolutions and the package snapshot key to the patched
variant.

Validation:

- `pnpm check:workspace-dependencies`
  - all 409 local edges across 86 active manifests use `workspace:*`.
- `pnpm list -r --depth -1 --json`
  - 86 active projects.
- `pnpm install --lockfile-only --ignore-scripts --no-frozen-lockfile`
- `pnpm install --frozen-lockfile --ignore-scripts`
- `pnpm --filter medusa-dev-cli test -- --runInBand`
  - three suites and four tests passed, including workspace-specifier
    translation for local publishing.
- `pnpm --filter @medusajs/medusa test -- --runInBand`
  - nine suites and 43 tests passed, including an emitted Yalc manifest with
    concrete dependency, optional-dependency, and peer-dependency versions and
    an unchanged source manifest.
- `pnpm --filter @medusajs/medusa build`
- `CHUNK=0 pnpm test:chunk`
- `CHUNK=1 pnpm test:chunk`
- `pnpm test:integration:pglite -- --only currency`
  - all 13 unchanged Currency assertions passed.
- `pnpm --filter medusa-cloudflare typecheck`
- `pnpm --filter medusa-cloudflare test:cart-do-sqlite`
- `pnpm --filter medusa-cloudflare check:imports`
- `pnpm --filter medusa-cloudflare check:runtime-source-imports`
- `pnpm --filter medusa-cloudflare check:portable-entrypoints`
- `pnpm --filter medusa-cloudflare check:real-module-imports`

The first root `pnpm build` attempt was not a passing gate. Turbo 1.13.4 again
failed to parse pnpm 11's `patchedDependencies` lockfile shape, lost workspace
dependency ordering, and started `@medusajs/index` before the Pricing and Sales
Channel generated subpaths existed. Sixty-two tasks passed before that failure;
explicit sequential builds of `@medusajs/pricing`,
`@medusajs/sales-channel`, and `@medusajs/index` then passed. Fixing or
replacing the stale Turbo graph is a separate prerequisite before the repo move.

## Tooling and CI

Affected boundary:

- Root package manager configuration.
- Package-local `packageManager` fields and package scripts.
- Cloudflare proof scripts that shell out to workspace commands.
- Medusa dev CLI local workspace discovery and install helpers.
- GitHub Actions dependency cache/setup/install commands.

CI and helper commands now use pnpm filters instead of Yarn workspace commands.
GitHub Actions were moved to Node 24 because pnpm 11 requires Node 22 or newer.

The Medusa dev CLI now discovers this workspace through `pnpm-workspace.yaml`
and `pnpm list -r --depth -1 --json`.

## Compatibility Fixes

The pnpm conversion exposed a few build/typecheck assumptions that Yarn's
layout hid:

- `@medusajs/admin-bundler` now declares `@medusajs/ui-preset`, which it
  requires directly.
- `@medusajs/currency` now declares direct Medusa workspace packages it imports.
- `@medusajs/auth-emailpass` now declares `@medusajs/utils`, which it imports
  directly.
- `@medusajs/link-modules` has an explicit repository constructor return type
  to avoid portable declaration paths leaking pnpm's local install layout.
- `emitEventStep` accepts string event payloads, matching existing workflow
  runtime behavior for ID payloads.
- `workflow-engine-redis` mirrors the existing in-memory workflow orchestrator
  type boundary for workflow container handoff and optional `thrownError`.
- `readDirRecursive` now declares the `path` property it attaches to returned
  `Dirent` objects at runtime.
- Cloudflare workerd proof scripts invoke pnpm through `cmd.exe` on Windows so
  nested pnpm commands work without relying on Yarn's checked-in release file.
- The root `test:chunk` command now uses a Node runner instead of the previous
  shell script. It discovers named pnpm workspaces, excludes the private root
  package to match Yarn workspace listing behavior, runs one workspace at a
  time by default, and invokes pnpm through `cmd.exe` on Windows.
- Package test scripts invoke local binaries directly instead of hard-coded
  `node_modules/.bin` paths, which were not portable across Windows and pnpm.
- Root package integration filters no longer rely on Unix single-quote
  handling, because Windows shells pass those quotes through to Turbo.
- `pnpm-workspace.yaml` disables pnpm's `verifyDepsBeforeRun` install check so
  test commands do not unexpectedly perform registry/network work.
- Windows path fixes were added for package-manager tests, local admin plugin
  path resolution, HTTP route-loader relative paths, and snapshot ordering.
- The Medusa instrumentation test fixture now registers module definitions the
  same way as the framework HTTP fixture, avoiding a metadata object being
  passed as `moduleExports`.

These are package-manager/tooling compatibility fixes. They do not change the
Medusa runtime architecture, module service ownership, workflows, APIs, or
Cloudflare adapter direction.

## Validation

Baseline Yarn behavior before removal:

- `cmd /c yarn workspace medusa-cloudflare typecheck`
- `cmd /c yarn workspace medusa-cloudflare test:cart-do-sqlite`
- `cmd /c yarn workspace medusa-cloudflare check:imports`
- `cmd /c yarn workspace medusa-cloudflare check:runtime-source-imports`
- `cmd /c yarn workspace medusa-cloudflare check:portable-entrypoints`
- `cmd /c yarn workspace medusa-cloudflare check:real-module-imports`
- `cmd /c yarn workspace @medusajs/medusa build`

The initial `cmd /c yarn install --immutable` was already blocked by stale
`yarn.lock` drift before the conversion.

pnpm validation:

- `pnpm install --frozen-lockfile`
- `pnpm list -r --depth -1 --json`
  - 86 named pnpm projects, including the private root package.
- `pnpm --filter @medusajs/framework build`
- `pnpm --filter @medusajs/currency build`
- `pnpm --filter @medusajs/drizzle build`
- `pnpm --filter medusa-cloudflare typecheck`
- `pnpm --filter medusa-cloudflare check:http-proof-manifest`
- `pnpm --filter medusa-dev-cli build`
- `pnpm --filter medusa-cloudflare test:cart-do-sqlite`
- `pnpm --filter medusa-cloudflare check:imports`
- `pnpm --filter medusa-cloudflare check:runtime-source-imports`
- `pnpm --filter medusa-cloudflare check:portable-entrypoints`
- `pnpm --filter medusa-cloudflare check:real-module-imports`
- `pnpm --filter @medusajs/medusa build`

pnpm test-runner follow-up validation:

- `CHUNK=0 pnpm test:chunk`
- `CHUNK=1 pnpm test:chunk`
- `pnpm --filter create-medusa-app test`
- `pnpm --filter @medusajs/utils test`
- `pnpm --filter @medusajs/framework test`
- `pnpm --filter @medusajs/medusa test`
- `pnpm --filter @medusajs/currency exec jest integration-tests/__tests__/currency-module-service.spec.ts --runInBand --no-cache --forceExit`
  against an isolated temporary PostgreSQL 18 cluster on `127.0.0.1:55432`
- `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle pnpm --filter @medusajs/currency exec jest integration-tests/__tests__/currency-module-service.spec.ts --runInBand --no-cache --forceExit`
- `pnpm --filter medusa-cloudflare typecheck`
- `pnpm --filter medusa-cloudflare test:cart-do-sqlite`
- `pnpm --filter medusa-cloudflare check:imports`
- `pnpm --filter medusa-cloudflare check:runtime-source-imports`
- `pnpm --filter medusa-cloudflare check:portable-entrypoints`
- `pnpm --filter medusa-cloudflare check:real-module-imports`
- `pnpm --filter @medusajs/framework build`

Full package integration was not proven in this local audit. With no database
environment, package integration failed against the machine's existing
PostgreSQL service because it requires SCRAM credentials. After switching to an
isolated temporary PostgreSQL cluster, Redis-backed integration stopped at
`@medusajs/locking-redis` because no local Redis service/binary was available.
A non-Redis package integration continuation then hit machine disk exhaustion
(`ENOSPC`) from Jest haste-map writes before completion. Turbo also emits a
warning because `turbo@1.13.4` does not understand pnpm 11's lockfile
`patchedDependencies` hash shape, although filtered Turbo tasks still execute.

Active source and CI scan:

- `rg -n 'yarn workspace|yarn workspaces|yarn run -T|cache: "yarn"|\.yarn/releases|yarn-3\.2\.1|Yarn workspace' .github scripts package.json apps packages integration-tests CLAUDE.md`

The final broad `yarn|Yarn|\.yarn` scan is intentionally not treated as a
failure for:

- historical planning records under `plan/`, because those records preserve
  pre-conversion validation history and deferred migration rationale;
- generated-app cleanup that removes a possible `yarn.lock`;
- package README install examples for consumers that still use Yarn;
- framework compiler support for copying a user's `yarn.lock` into generated
  output when the user project has one.

## Follow-Up

Keep `nodeLinker: hoisted` and the root compatibility workspace links until the
pnpm workspace is stable. Active package-level dependency declarations now use
`workspace:*`; tightening to stricter pnpm linking and removing the root
compatibility links remain a separate migration slice.

Before the repo move, make the full workspace build deterministic under pnpm
11 by fixing, upgrading, or replacing Turbo 1.13.4's broken workspace graph.

Do not introduce Flarex catalogs or move this repo into Flarex as part of this
package-manager conversion.

## Vite 8 And Vitest 4 Dependency Alignment

Commit:

- `48dea7e01f` (`test: upgrade Vitest and Vite toolchain`)

The pre-merge test-runner stream now resolves the existing Vite and Vitest
owners on Vite 8.1.4 and Vitest 4.1.10. The root override keeps Vite peer
consumers on one Vite major, and the coverage provider matches Vitest exactly.
Required Vite plugins, esbuild declarations, and the supported Storybook
10.4.6 companion packages were updated in the same lockfile slice.

This is dependency alignment only. Catalogs, package privacy, version-field
removal, the hoisted linker, and Jest dependency ownership are unchanged.

Validation:

- frozen-lockfile install passed;
- the 2,363-entry lockfile passed pnpm's configured supply-chain policy;
- installed commands report Vite 8.1.4 and Vitest 4.1.10;
- `pnpm peers check` reports no Vite, Vitest, coverage, Storybook, or
  Cloudflare mismatch;
- four unrelated pre-existing peer groups remain: legacy Rollup plugins,
  `eslint-plugin-unused-imports`, `tailwindcss-animate`, and AWS SDK client
  versions.

The exact runner and build evidence is recorded in
[`test-runner-migration.md`](./test-runner-migration.md).

## Currency Integration Vitest Shadow Commands And CI

Commit:

- `dca870fee4` (`test: shadow Currency integration with Vitest`)

Date verified: 2026-07-11.

Affected boundary:

- `@medusajs/currency` adds only `test:integration:vitest`; its existing
  `test:integration` value remains byte-identical and Jest-authoritative.
- The root adds `check:currency-integration-shadow`, implemented by the strict
  typed verifier under `scripts/test-runner/`.
- The root tooling typecheck includes both Currency Vitest configs.
- The PGlite orchestrator adds a Vitest command only for Currency. Its default
  runner and all existing Jest command arrays remain unchanged.
- GitHub Actions adds one focused `currency-integration-shadow` job that needs
  the existing setup job, downloads its build artifacts, and runs the root
  verifier without a matrix. PostgreSQL is its only external service; PGlite
  and Drizzle/SQLite run in process, and no Redis service is present.

The existing dedicated PGlite job remains exactly the unqualified
`pnpm test:integration:pglite` command, so it still selects Jest by default.
Existing package-integration matrix jobs are unchanged. Workflow-contract tests
freeze these ownership and service boundaries locally. The new hosted job is
pending until this fork is published. Under the later documented deferral
policy, that pending environment result does not block the locally proven
Currency cut-over; the job itself must remain intact and must run when a safe
publication target exists.

This slice changes no dependency range, package version, privacy field,
catalog, override, linker setting, or lockfile entry. Package privacy, removal
of publishable Medusa versioning, pnpm catalogs, and the repository merge remain
separate package-management work.

Validation:

- strict runner-tooling typecheck and seven tooling tests passed;
- the six-quadrant Currency verifier and both real PGlite selector mappings
  passed;
- the unchanged 25-lane default-Jest runner foundation passed;
- workspace dependency policy and the reviewed remaining-Jest inventory
  passed;
- package builds, Currency unit default/rollback, and the Cloudflare
  type/test/build/import regression set passed.

## Currency Integration Vitest Default And CI Sharding

Commit:

- `9e3da4fa6e` (`test: switch Currency integration to Vitest`)

Date verified: 2026-07-11.

Affected boundary:

- `@medusajs/currency` moves its proven Vitest command from the temporary
  `test:integration:vitest` alias to the `test:integration` default.
- The exact former Jest command moves to `test:integration:jest`; no Jest
  command bytes are changed.
- The serial PGlite orchestrator maps only Currency's default-Jest selection to
  `test:integration:jest --runInBand` and its Vitest selection to
  `test:integration`. Its global default remains Jest and the other 23 module
  command arrays are unchanged.
- The root `test:integration:packages:fast` command excludes Currency because
  the GitHub package matrix forwards a three-way shard and Vitest 4 rejects a
  shard count larger than Currency's one integration file.
- The unsharded `test:integration:packages` command remains inclusive. The
  dedicated `currency-integration-shadow` command remains unchanged and owns
  Currency's complete unsharded six-quadrant proof.
- The stable `integration-tests-packages` aggregate now depends on both the
  generic package matrix and dedicated Currency job. Failure, cancellation, or
  skipping in either dependency propagates to the aggregate check.
- The tooling contract parses the root manifest and workflow to freeze the
  exact fast/slow/all package commands, matrix forwarding, dedicated job,
  aggregate propagation, and existing default-Jest PGlite job.

Turbo reproduced the real forwarded failure before the exclusion:

```text
vitest run --config vitest.integration.config.mts --shard=1/3 --maxWorkers=2
Error: --shard <count> must be a smaller than count of test files.
Resolved 1 test files for --shard=1/3.
```

`passWithNoTests` does not affect this pre-selection validation. A filtered
Turbo dry-run then proved Currency absent from the fast package lane while API
Key remained. This is an explicit CI ownership move, not a coverage waiver.

The dedicated job command, dependencies, ranges, package versions, privacy
fields, catalogs, overrides, linker settings, and lockfile are unchanged. The
workflow edit only connects that existing job to the stable package aggregate.
Hosted execution remains deferred and is not claimed passing.

Validation:

- strict runner-tooling typecheck and seven tooling tests passed;
- exact six-quadrant default/rollback parity and both real Currency PGlite
  selectors passed;
- the full shared runner foundation, workspace policy, and remaining-Jest
  inventory passed;
- package builds, Currency unit default/rollback, and the Cloudflare
  type/test/build/workerd/import regression set passed.

## Auth Emailpass Empty Unit Manifest Ownership

Commit:

- `7910bb5dc3` (`test: retire empty Auth Emailpass unit lane`)

Date verified: 2026-07-11.

Affected boundary:

- `packages/modules/providers/auth-emailpass/package.json` removes only the
  inherited `test: jest --passWithNoTests src` key after direct discovery and
  history proved it owns zero unit files and zero assertions.
- The exact `test:integration` Jest command, `jest.config.js`, source, build and
  watch scripts, dependencies, version, privacy, and package exports remain
  unchanged.
- No replacement Vitest script or Jest rollback alias is added because there is
  no unit assertion lane to migrate or roll back.
- The package remains a remaining-Jest script owner through its active
  integration command; it is not marked migrated.

The inventory removes exactly the Auth Emailpass unit `manifestScripts` entry.
The digest becomes
`e9332f849f83ce9f748f191aef3bb82c145e5a971480aab93c00e8835a77b444`,
and manifest Jest script entries move from 116 to 115. Script owners remain 68,
and every other count is unchanged. There are no additions.

Turbo retains `@medusajs/auth-emailpass#test` only as a graph marker whose
command is `<NONEXISTENT>`. The correctly formed root command places the filter
before the argument separator:

```text
pnpm test --filter=@medusajs/auth-emailpass -- --shard=1/4 --maxWorkers=1 --passWithNoTests
```

It scopes only Auth Emailpass and executes zero tasks successfully.

No root manifest script, workflow, dependency, pnpm catalog, override, package
range, version, privacy field, workspace linker setting, or lockfile changed in
this turn.

Separate pre-existing finding: at the Turn 15 audit, the two unit-matrix
workflow commands used `pnpm test -- --filter=...`. With pnpm 11.7.0, those
filters bypassed Turbo, selected all 85 packages, and reached package runners;
Core Flows Vitest rejected `--filter`. Turn 16 later repairs and contract-tests
that shared workflow boundary.

Validation:

- package integration passed unchanged before and after at one suite, nine
  tests, and zero snapshots;
- package build and post-edit zero-file unit discovery passed;
- filtered root execution and Turbo dry-run proved the intended no-task graph
  behavior;
- workspace dependency policy, exact remaining-Jest inventory, and the full
  shared test-runner foundation passed.

## pnpm/Turbo Unit Workflow Filter Ownership

Commit:

- `c20de19286` (`ci: repair pnpm unit test filtering`)

Date verified: 2026-07-11.

Affected boundary:

- both unit-matrix commands move their Turbo `--filter` options before pnpm's
  explicit runner-argument separator;
- the general command retains Framework/Utils exclusions, four-way sharding,
  `--maxWorkers`, and `--passWithNoTests`;
- the serial command retains exact Framework/Utils inclusion, four-way
  sharding, and `--passWithNoTests`, while continuing to omit `--maxWorkers`
  beside the packages' owned `--runInBand` flags;
- an exact parsed-YAML contract freezes both strings, the unique workflow step,
  matrix, and root `test` Turbo delegation.

Turbo dry-runs now prove an 83-node general graph and a two-node serial graph.
The general lane excludes Framework and Utils; the serial lane contains exactly
those packages; their disjoint union retains all 85 current nodes. Twelve
general nodes own `<NONEXISTENT>` rather than executable scripts, so 83/2 is a
task-graph partition rather than a claim that every node runs tests.

Representative populated and empty general shards pass through both Jest and
Vitest. The exact serial shard-1 command selects only Framework and Utils and
passes without a worker conflict. The known Turbo 1.13.4 warning about pnpm 11
`patchedDependencies` graph parsing remains separate.

No root manifest script, package manifest, dependency, workspace range, version,
privacy field, package export, pnpm catalog, override, linker setting, lockfile,
or package runner command changes. This is only workflow invocation ownership
plus its typed regression contract. Hosted execution remains deferred until the
commit is published.

Validation:

- the contract failed against the exact pre-edit strings, then passed after the
  two-line workflow correction;
- strict runner-tooling typecheck and all eight tooling tests passed;
- 83/2 dry-runs and representative Jest/Vitest populated/empty shards passed;
- the exact serial Framework/Utils shard passed without `--maxWorkers`;
- workspace dependency policy, the unchanged remaining-Jest inventory, and the
  complete shared test-runner foundation passed.

## Auth Emailpass Integration Vitest Shadow Manifest

Commit:

- `ac03c9df21` (`test: add Auth Emailpass integration Vitest shadow`)

Date verified: 2026-07-11.

Affected boundary:

- `@medusajs/auth-emailpass` adds only
  `test:integration:vitest: vitest run --config vitest.integration.config.mts`;
- the exact Jest `test:integration` command remains the package default;
- the retired empty unit `test` key remains absent;
- the package-local Vitest config scopes one integration file and mirrors the
  five existing Jest/TypeScript aliases through the shared integration helper;
- no root script, workflow, CI aggregate, dependency, version, privacy field,
  export, workspace range, pnpm catalog, override, linker setting, or lockfile
  changes.

The Vitest-only script/config add no remaining-Jest ownership. A new
Jest-calling verifier is deliberately not created; the existing generic JSON
comparator proves exact parity without adding another foundation Jest owner.
The inventory therefore remains byte-identical at digest
`e9332f849f83ce9f748f191aef3bb82c145e5a971480aab93c00e8835a77b444`,
with 68 configs, 115 scripts, and 406 API files.

Validation:

- Jest default and Vitest shadow reporters matched exactly at one file, nine
  tests, all full names/statuses, and zero snapshots;
- the Vitest config passed strict standalone typechecking and the package build
  passed;
- workspace dependency policy, exact remaining-Jest ownership, and the full
  shared test-runner foundation passed.

The one-file shadow remains opt-in and unsharded. Turn 18 must assign explicit
unsharded CI ownership before making Vitest the default because the generic
package integration lane forwards a three-way shard.

## Auth Emailpass Integration Vitest Default And CI Ownership

Commit:

- `bc6dab98ea` (`test: switch Auth Emailpass integration to Vitest`)

Date verified: 2026-07-11.

Affected boundary:

- `@medusajs/auth-emailpass` changes `test:integration` to
  `vitest run --config vitest.integration.config.mts`;
- the byte-identical former default moves to `test:integration:jest` as the
  explicit rollback;
- the temporary `test:integration:vitest` key is removed and the retired unit
  `test` key remains absent;
- the root fast package command excludes Auth from its three-way shard, while
  the unsharded all-packages command remains inclusive;
- the workflow adds a dedicated, unsharded, service-free Auth integration job
  and makes the stable package aggregate propagate all of its terminal states;
- strict runner-tooling typecheck now includes the existing Auth Vitest config;
- no dependency, version, privacy field, export, workspace range, pnpm catalog,
  override, linker setting, or lockfile changes.

The real Vitest `--shard=1/3` run fails because the package owns one integration
file. The fast Turbo dry graph now has 56 tasks with Auth and Currency absent
and API Key retained; the unsharded all-packages graph retains Auth once with
the Vitest default. The dedicated job restores the existing pipeline/build
artifacts and runs only:

```text
pnpm --filter @medusajs/auth-emailpass test:integration
```

It has no matrix, service, database, Redis, or runner-specific environment.
The parsed workflow contract freezes its exact steps, generic-lane exclusion,
all-packages inclusion, and aggregate result propagation. This is local shape
proof; the first hosted result remains deferred until publication.

The remaining-Jest inventory moves only the byte-identical manifest command
from the `test:integration` key to `test:integration:jest`. No new verifier or
foundation Jest invocation owner is added. Its digest becomes
`f6a6a113dce80c75fcc951b80c60bc55e5012d7f4d72cf728638504af4c10570`,
with totals unchanged at 68 configs, 115 scripts, and 406 active API files.

Validation:

- exact pre/post reporter parity passed at one file, nine tests, all full
  names/statuses, and zero snapshots;
- both direct package commands, package build, strict runner-tooling typecheck,
  eight tooling tests, workspace dependency policy, Turbo dry graphs, and the
  exact inventory passed;
- the complete shared test-runner foundation passed.

No package-private/catalog/merge preparation is bundled into this turn. The
only manifest ownership change is the Auth runner default/rollback key swap.

## Auth GitHub Empty Unit Manifest Ownership

Commit:

- `4ac4a518eb` (`test: retire empty Auth GitHub unit lane`)

Date verified: 2026-07-11.

Affected boundary:

- `packages/modules/providers/auth-github/package.json` removes only the
  inherited `test: jest --passWithNoTests src` key after direct discovery proved
  it owns zero unit files and zero assertions;
- the exact `test:integration` Jest command, active `jest.config.js`, integration
  specification, provider source, build/watch scripts, dependencies, version,
  privacy, and package exports remain unchanged;
- no empty Vitest script or Jest rollback alias is added because no unit
  assertion lane exists to migrate or roll back;
- the package remains a Jest script/config/API owner through its active
  integration lane and is not marked migrated.

Before removal, the correctly filtered root command selected Auth GitHub and ran
one empty Jest task. After removal, the same command selects only the package,
executes zero tasks, and exits successfully. Turbo keeps
`@medusajs/auth-github#test` as a graph marker with command `<NONEXISTENT>`; the
general unit graph remains 83 nodes, now 70 executable and 13 markers.

The 56-task fast integration graph retains Auth GitHub once with the exact Jest
command. Its existing three-way Jest ownership remains valid: shard 1 runs the
single suite and all nine tests, while shards 2 and 3 find no tests and exit zero
through `--passWithNoTests`. No root manifest, Turbo configuration, workflow,
matrix, exclusion, or dedicated job changes in this unit-only turn.

The inventory removes exactly this ownership entry and adds none:

```text
manifestScripts  @medusajs/auth-github  test  jest --passWithNoTests src
```

Its digest becomes
`db9dd73f0c2a73589e8d50bc0f1a9f71923b3ecbec0c11a047f91b22a74f5ab9`.
Manifest Jest script entries move from 115 to 114; script owners remain 68
because the integration command survives. All 68 configs, 406 active API files,
11 dependency entries, and every other count remain unchanged.

Validation:

- direct unit discovery returned zero before and after the manifest edit;
- the unchanged integration command passed before and after at one suite, nine
  tests, and zero snapshots;
- package build, scoped/root and full Turbo graph checks, all three integration
  shards, workspace dependency policy, exact inventory, and the complete shared
  test-runner foundation passed.

No dependency, lockfile, catalog, override, package range, linker, package
privacy, repository-merge, persistence, runtime, or Cloudflare boundary changed.
The local unit graph is proven; hosted unit-matrix confirmation remains deferred
until publication.

## Auth GitHub Integration Vitest Shadow Manifest

Commit:

- `6c0e09c3de` (`test: add Auth GitHub integration Vitest shadow`)

Date verified: 2026-07-11.

Affected boundary:

- `@medusajs/auth-github` adds only
  `test:integration:vitest: vitest run --config vitest.integration.config.mts`;
- the exact Jest `test:integration` command remains the package default and the
  retired unit `test` key remains absent;
- the package-local Vitest config scopes one integration file, mirrors the five
  existing aliases, and consumes the shared serial integration/MSW profile;
- no root script, root tooling typecheck, workflow, CI aggregate, dependency,
  version, privacy field, export, workspace range, pnpm catalog, override,
  linker setting, or lockfile changes.

The Vitest-only script/config add no remaining-Jest ownership. A new
Jest-calling verifier is deliberately not created; the existing generic JSON
comparator proves exact parity without adding another foundation Jest owner.
The inventory therefore remains byte-identical at digest
`db9dd73f0c2a73589e8d50bc0f1a9f71923b3ecbec0c11a047f91b22a74f5ab9`,
with 68 configs, 114 scripts, and 406 API files.

The fast integration graph remains 56 tasks and keeps Auth GitHub once through
the unchanged Jest command. Its Jest shards still pass at 9/0/0 tests. A real
Vitest 1/3 shard fails for the one-file suite, so the later cut-over must assign
dedicated unsharded ownership; this shadow does not pre-stage a filter or job.

Validation:

- pre-edit Jest, post-edit Jest, and Vitest reporters matched exactly at one
  file, nine tests, all full names/statuses, and zero snapshots;
- unsharded Vitest listing and both direct package runners passed, with Vitest
  exiting naturally;
- the new config passed standalone strict/no-unchecked-index typechecking and
  the package build passed;
- workspace dependency policy, exact remaining-Jest ownership, and the complete
  shared test-runner foundation passed.

This turn changes no dependency, catalog, package-private/merge preparation,
root/CI ownership, source, assertion, persistence, runtime, or Cloudflare
boundary. The shadow remains local and opt-in; no hosted result is claimed.

## Auth GitHub Integration Vitest Default And CI Ownership

Commit:

- `6171c0b50d` (`test: switch Auth GitHub integration to Vitest`)

Date verified: 2026-07-11.

Affected boundary:

- `@medusajs/auth-github` changes `test:integration` to
  `vitest run --config vitest.integration.config.mts`;
- the byte-identical former default moves to `test:integration:jest` as the
  explicit rollback;
- the temporary `test:integration:vitest` key is removed and the retired unit
  `test` key remains absent;
- the root fast package command excludes Auth GitHub from its three-way shard,
  while the unsharded all-packages command remains inclusive;
- the workflow adds a dedicated unsharded, service-free Auth GitHub integration
  job and makes the stable package aggregate propagate all terminal states;
- persistent strict runner-tooling typecheck now owns the Auth GitHub config;
- no dependency, version, privacy field, export, workspace range, pnpm catalog,
  override, linker setting, or lockfile changes.

The real workflow-shaped Vitest `--shard=1/3` run fails because the package owns
one integration file. The fast Turbo dry graph now has 55 tasks with Auth
GitHub, Auth Emailpass, and Currency absent and API Key retained. The 63-task
unsharded all-packages graph retains Auth GitHub once with the Vitest default.

The dedicated job restores existing pipeline/build artifacts and runs only:

```text
pnpm --filter @medusajs/auth-github test:integration
```

It has no matrix, service, database, Redis, job environment, CPU probe, shard,
or worker flag. The parsed workflow contract freezes its exact steps, runner,
generic-lane exclusion, all-packages inclusion, typecheck ownership, and
aggregate propagation. This is local shape proof; the first hosted result
remains deferred until publication.

The remaining-Jest inventory moves only the byte-identical manifest command
from `test:integration` to `test:integration:jest`. No verifier or foundation
Jest invocation owner is added. Its digest becomes
`da4fc00cdf717ab98a8fc75b189aa4ce868d3a623c19d56a07a9c8f2418ee365`,
with totals unchanged at 68 configs, 114 scripts, and 406 API files.

Validation:

- exact pre/post reporter parity passed at one file, nine tests, all full
  names/statuses, and zero snapshots;
- direct default/rollback commands, authentic shard failure, package build,
  strict runner-tooling typecheck, eight tooling tests, workspace policy, Turbo
  dry graphs, and exact inventory passed;
- the complete shared test-runner foundation passed.

No dependency, catalog, package-private/merge preparation, assertion, source,
persistence, runtime, or Cloudflare boundary changed. Hosted execution of the
new job remains deferred.

## Auth Google Empty Unit Manifest Ownership

Commit:

- `7965f31068` (`test: retire empty Auth Google unit lane`)

Date verified: 2026-07-11.

Affected boundary:

- `@medusajs/auth-google` removes only the inherited
  `test: jest --passWithNoTests src` manifest entry;
- the exact integration command, Jest config, integration spec, package source,
  build/watch commands, dependencies, version, privacy field, and exports remain
  unchanged;
- no empty Vitest replacement or rollback command is added because no unit
  assertions exist to migrate;
- the package remains an explicit Jest owner through `test:integration`;
- no root command, workflow, CI job, runner-tooling contract, Jest config,
  dependency, catalog, override, linker setting, or lockfile changes.

Before removal, the package and filtered root unit commands each executed one
empty Jest task that passed only because of `--passWithNoTests`. After removal,
direct discovery still finds zero unit files, the filtered root command executes
zero tasks, and the scoped Turbo dry graph retains one `<NONEXISTENT>` marker.
The general unit graph remains 83 nodes: 69 executable and 14
`<NONEXISTENT>`.

Auth Google integration ownership is unchanged. The fast integration graph
remains at 55 tasks with Auth Google present exactly once on its existing Jest
command. The real three-way shard results are nine, zero, and zero passing
tests, respectively; the unsharded package command passes one suite and nine
tests. No database, Redis, external credential, or real network service is
required.

The remaining-Jest inventory removes exactly the retired unit manifest entry.
Its digest becomes
`919869b4243bfb9c8f3aee498ba2456c5a8720f30f697ecc3f270eff5c3c491f`;
manifest scripts fall from 114 to 113 while configs, script owners, and API
files remain at 68, 68, and 406. Every other inventory count is unchanged.

Validation:

- zero unit discovery was proved against both the migration baseline and the
  current package tree;
- the integration suite passed before and after the manifest edit at one suite,
  nine tests, and zero snapshots;
- direct discovery, filtered package/root behavior, package build, authentic
  integration shards, Turbo dry graphs, workspace dependency policy, exact
  remaining-Jest inventory, and the complete shared test-runner foundation
  passed.

This turn changes no dependency, catalog, package-private/merge preparation,
source, assertion, integration ownership, persistence, runtime, workerd, D1, or
Cloudflare boundary. The evidence is local graph and execution proof; hosted CI
execution remains deferred.

## Auth Google Integration Vitest Shadow

Commit:

- `6474ecbede` (`test: add Auth Google integration Vitest shadow`)

Date verified: 2026-07-11.

Affected boundary:

- `@medusajs/auth-google` adds only
  `test:integration:vitest: vitest run --config vitest.integration.config.mts`;
- the exact Jest `test:integration` default, Jest config, integration spec,
  source, build/watch commands, dependencies, version, privacy field, and
  exports remain unchanged;
- the package-local config uses the existing typed shared serial Node profile,
  all five aliases, an absolute root, and one explicit integration file;
- no root script, Turbo task, persistent tooling typecheck, tooling contract,
  workflow, CI job, aggregate, dependency, catalog, override, linker setting,
  or lockfile changes.

Vite 8.1.4 with built-in Rolldown and Vitest 4.1.10 are both installed and
registry-current. Exact JSON normalization proves pre-edit Jest, post-edit Jest,
and opt-in Vitest each own one file, nine passing tests with identical full
names/statuses, and zero failures/skips/todos/snapshots. The passing shadow
exercises Node `crypto`, CommonJS `jsonwebtoken`, framework JWT helpers, and MSW
without source changes; Vitest exits naturally and Jest's separate no-`forceExit`
open-handle probe is clean.

The fast and all-package integration graphs remain 55 and 63 tasks with Auth
Google present exactly once on the unchanged Jest default. Existing Jest shards
remain valid at 9/0/0 tests. A real Vitest `--shard=1/3` run fails because one
file cannot fill three shards, so root/CI ownership is deliberately deferred to
the separate cut-over turn.

The new script/config contain no Jest ownership. The remaining-Jest inventory is
byte-identical at digest
`919869b4243bfb9c8f3aee498ba2456c5a8720f30f697ecc3f270eff5c3c491f`,
with 68 configs, 113 scripts across 68 owners, and 406 API files.

Validation:

- exact pre/post Jest and Jest/Vitest reporter parity, direct shadow execution,
  unsharded nine-test discovery, and cleanup probes passed;
- standalone strict config typecheck, package build, authentic Jest/Vitest shard
  behavior, both Turbo graphs, workspace policy, and exact inventory passed;
- the complete shared test-runner foundation passed.

No dependency, catalog, package-private/merge preparation, default/rollback,
root/CI ownership, source, assertion, persistence, runtime, workerd, D1, or
Cloudflare boundary changed. This is local Node shadow evidence only; no hosted
result is claimed.

## Auth Google Integration Vitest Default And CI Ownership

Commit:

- `4c051d2d0c` (`test: switch Auth Google integration to Vitest`)

Date verified: 2026-07-11.

Affected boundary:

- `@medusajs/auth-google` changes `test:integration` to
  `vitest run --config vitest.integration.config.mts`;
- the byte-identical former default moves to `test:integration:jest` as explicit
  rollback, the temporary shadow key is removed, and the unit key remains
  absent;
- the root fast package command excludes Auth Google from its three-way shard,
  while the unsharded all-packages command remains inclusive;
- the workflow adds a dedicated unsharded, service-free Auth Google integration
  job and makes the stable package aggregate propagate every terminal state;
- persistent strict tooling typecheck and its no-`any` parsed contract now own
  the Auth Google config, package scripts, hashes, root commands, job, and
  aggregate boundary;
- no dependency, version, privacy field, export, workspace range, pnpm catalog,
  override, linker setting, or lockfile changes.

The real Vitest `--shard=1/3` command fails because the package owns one file.
The fast Turbo graph therefore moves from 55 to 54 tasks with Auth Google,
Auth GitHub, Auth Emailpass, and Currency absent and API Key retained. The
63-task unsharded graph retains Auth Google once on the Vitest default.

The dedicated job restores existing pipeline/build artifacts and runs only:

```text
pnpm --filter @medusajs/auth-google test:integration
```

It has no matrix, service, database, Redis, job environment, CPU probe, shard,
or worker flag. The parsed workflow contract freezes its exact steps, runner,
fast-lane exclusion, all-packages inclusion, typecheck ownership, and aggregate
propagation. This is local shape proof; the first hosted result remains deferred
until publication.

The remaining-Jest inventory moves only the byte-identical manifest command
from `test:integration` to `test:integration:jest`. No verifier or foundation
Jest invocation owner is added. Its digest becomes
`b20c248031f53a5c0704505f278e3215313d99624fdde7484e0e8fb8684b462a`,
with totals unchanged at 68 configs, 113 scripts across 68 owners, and 406 API
files.

Validation:

- exact pre/post reporter stability and post-cut-over Jest/Vitest parity pass at
  one file, nine full names/statuses, and zero snapshots;
- direct default/rollback commands, rollback shards at 9/0/0, authentic Vitest
  shard failure, package build, strict tooling typecheck, eight contract tests,
  workspace policy, Turbo graphs, and exact inventory pass;
- the complete shared test-runner foundation passes.

No dependency, catalog, package-private/merge preparation, assertion, source,
persistence, runtime, or Cloudflare boundary changed. Hosted execution of the
new job remains deferred.

## File Local Empty Unit Manifest Ownership

Commit:

- `824920b3a8` (`test: retire empty File Local unit lane`)

Date verified: 2026-07-11.

Affected boundary:

- `@medusajs/file-local` removes only the inherited
  `test: jest --passWithNoTests src` manifest entry;
- the exact integration command, Jest config, integration spec, JPEG fixture,
  package source, build/watch commands, dependencies, version, privacy field,
  and exports remain unchanged;
- no empty Vitest replacement or rollback command is added because no unit
  assertions exist to migrate;
- the package remains an explicit Jest owner through `test:integration`;
- no root command, workflow, CI job, runner-tooling contract, dependency,
  catalog, override, linker setting, or lockfile changes.

Before removal, the package and filtered root unit commands execute one empty
Jest task that passes only through `--passWithNoTests`. After removal, direct
discovery still finds zero unit files, the filtered root command executes zero
tasks, and scoped Turbo retains one `<NONEXISTENT>` marker. The general unit
graph remains 83 nodes and moves from 69 executable/14 markers to 68/15.

File Local integration ownership is unchanged. Fast/all integration graphs
remain 54/63 and own File Local exactly once on its existing Jest command.
Authentic forwarded shards pass 2/0/0 tests; the unsharded command passes one
suite, two tests, and zero snapshots. It uses only a writable local filesystem,
streams, Buffer, and a JPEG fixture, then removes the uploads directory. The
localhost URL is string construction only; no external service is required.

The remaining-Jest inventory removes exactly the retired unit manifest entry.
Its digest becomes
`51374a391ab1c1226af20bf875439a3198c1a61525859332425a6a3ff92bf9cd`;
manifest scripts fall from 113 to 112 while configs, script owners, and API files
remain at 68, 68, and 406. Every other inventory count is unchanged.

Validation:

- zero unit discovery is proved against both the migration baseline and current
  package tree;
- integration passes before and after at one suite, two tests, and zero
  snapshots, with exact source/config/fixture hashes and cleanup;
- package build, filtered root/Turbo behavior, unit/integration graphs,
  authentic shards, workspace policy, exact inventory, and the complete shared
  foundation pass.

The integration's existing direct `@medusajs/utils` import is not declared in
this package manifest. That resolution/dependency decision belongs to the later
Vitest shadow, where Vite/Rolldown behavior can prove whether a `workspace:*`
devDependency is required; it is not mixed into this empty-unit retirement.

This turn changes no dependency, catalog, package-private/merge preparation,
source, assertion, fixture, integration ownership, persistence, runtime,
workerd, D1, or Cloudflare boundary. Local graph proof passes; hosted unit-matrix
execution remains deferred.

## File Local Vitest Shadow Dependency Ownership

Commit:

- `39e78ba87d` (`test: add File Local integration Vitest shadow`)

Date verified: 2026-07-11.

Affected boundary:

- `@medusajs/file-local` adds the opt-in
  `test:integration:vitest: vitest run --config vitest.integration.config.mts`
  manifest entry while its exact Jest `test:integration` command remains the
  default;
- its integration spec directly imports `FileSystem` from `@medusajs/utils`, so
  the package now declares `@medusajs/utils: workspace:*` as a dev dependency;
- the lockfile changes only the File Local importer with
  `workspace:* -> link:../../../core/utils`;
- no catalog, root dependency, override, resolution, linker setting, package
  privacy/version field, production dependency, or unrelated importer changes.

The utils edge is test-only, so dev dependency ownership is narrower than a
production dependency. Before this turn the import succeeded through accidental
root-hoist availability even though File Local declared only
`@medusajs/framework`. The explicit edge now makes the package independently
responsible for what its integration test imports.

The parsed lock importer contains exactly the `workspace:*` specifier and
`link:../../../core/utils` version. The package-local
`node_modules/@medusajs/utils` junction targets the `packages/core/utils`
workspace. The lockfile delta is three importer lines; snapshots, catalogs,
resolutions, root ownership, and all other importers remain unchanged.

Workspace-wide and File-Local-filtered frozen offline install attempts timed out
locally after approximately five and three minutes without reporting a lockfile
mismatch. They are not claimed as passing install gates. The accepted evidence
is the parsed manifest/importer pair, package-local workspace junction, passing
workspace dependency policy, package build, and real Jest/Vitest execution.

Runner and ownership proof:

- pre-edit Jest, post-edit Jest, and opt-in Vitest match exactly at one file, two
  full test names/statuses, zero failures/skips/todos, and zero snapshots;
- both runners exit naturally, every successful run removes the uploads
  directory, and Vitest exercises the package-root fixture, filesystem, stream,
  Buffer, URL, delete, and recursive-cleanup path through Vite 8.1.4 with
  built-in Rolldown and Vitest 4.1.10;
- all three real Vitest shard runs exit 1 because one discovered file cannot
  satisfy three shards, so no generic-shard ownership is added in this shadow;
- unit and fast/all integration graphs remain 83/68/15 and 54/63, with File
  Local owned once by its unchanged Jest default;
- strict config typecheck, package build, workspace policy, exact inventory, and
  the complete shared test-runner foundation pass.

The remaining-Jest inventory remains byte-identical at digest
`51374a391ab1c1226af20bf875439a3198c1a61525859332425a6a3ff92bf9cd`,
with 68 configs, 112 scripts, and 406 active API files.

This shadow changes no root manifest, CI/workflow, persistent tooling contract,
assertion, fixture, test/production source, persistence, production runtime,
workerd, D1, or Cloudflare bundle boundary. PostgreSQL, PGlite, Redis, network,
and hosted execution are not applicable to the opt-in local filesystem lane.
The later cut-over must preserve this explicit dev dependency while adding a
dedicated unsharded service-free CI owner and retaining exact Jest rollback.

## File Local Vitest Default And CI Ownership

Commit:

- `12681b0912` (`test: switch File Local integration to Vitest`)

Date verified: 2026-07-11.

Affected boundary:

- `@medusajs/file-local` promotes
  `vitest run --config vitest.integration.config.mts` to `test:integration`;
- the byte-identical Jest command moves to `test:integration:jest`, and the
  temporary `test:integration:vitest` key is removed;
- the root fast-package command adds only the File Local exclusion, while the
  all-packages command remains unchanged;
- strict tooling typecheck gains the File Local config path exactly once;
- the workflow gains one dedicated unsharded `file-local-integration` job and
  aggregate result propagation;
- the remaining-Jest inventory moves only the File Local command's manifest key.

The package's version, privacy field, exports, build/watch scripts, peer
dependency, and explicit `@medusajs/framework` plus test-only
`@medusajs/utils: workspace:*` dev dependencies remain unchanged. The lockfile
also remains unchanged, retaining the exact `link:../../../core/utils` importer
edge from Turn 26. No catalog, override, resolution, linker, root dependency, or
unrelated importer changes.

The dedicated workflow job uses `needs: setup`, `ubuntu-latest`, a ten-minute
timeout, the existing dependency-cache action with `skip-build: "true"`, the
existing build artifact, and the exact command
`pnpm --filter @medusajs/file-local test:integration`. It has no matrix,
services, environment, database, Redis, credentials, or runner flag. The
package aggregate now propagates its failure, cancellation, skip, and success.

Root ownership proof:

- the generic fast integration graph moves 54 to 53 tasks and excludes File
  Local;
- the unchanged all-packages graph remains 63 tasks and owns File Local once on
  Vitest;
- general and Framework/Utils serial unit graphs remain 83/68/15 and 2/2/0;
- the strict parsed contract freezes the exact root commands, File Local
  scripts/dependency/config token/hashes, job shape, steps, and aggregate
  conditions;
- strict tooling typecheck and all eight tooling tests pass.

Runner proof remains exact at one file, two passed tests, matching full
names/statuses, and zero failures/skips/todos/snapshots across pre-edit Jest,
post-edit Jest rollback, and post-edit Vitest default. All successful commands
remove the uploads directory. Vitest shards fail closed for the one-file lane;
Jest rollback shards pass 2/0/0.

The reviewed inventory key move produces digest
`47a7f12afdddc0caeb2123cc74ac21c16f7a261b9b9e910967f699022df9715b`.
Counts remain 68 configs, 112 scripts across 68 owners, and 406 active API
files, with every detailed count unchanged.

Package build, workspace dependency policy, exact inventory, direct graph
checks, tooling tests/typecheck, and the complete shared test-runner foundation
pass. This turn changes no dependency, lockfile, package-private/merge
preparation, assertion, source, fixture, persistence, production runtime,
workerd, D1, or Cloudflare boundary. The local command and workflow contract
prove the new job shape; hosted execution remains deferred until publication.

The next package-management slice is the separate File S3 unit ownership
decision. It must not combine its integration migration or external-service
behavior with retirement of a zero-test unit manifest key.

## File S3 Empty Unit Manifest Ownership

Commit:

- `02a48c210e` (`test: retire empty File S3 unit lane`)

Date verified: 2026-07-11.

Affected boundary:

- `@medusajs/file-s3` removes only the inherited
  `test: jest --passWithNoTests src` manifest entry;
- the exact `test:integration` command, Jest config, integration spec, JPEG
  fixture, package source, build/watch commands, dependencies, version, privacy
  field, peer dependency, exports, and keywords remain unchanged;
- no empty Vitest replacement or rollback command is added because no unit
  assertion source exists;
- the package remains a Jest owner through its separate integration command;
- no root command, workflow, CI job, persistent tooling contract, catalog,
  override, resolution, linker setting, dependency, or lockfile changes.

The package and direct Jest unit commands discover zero files and pass only
through `--passWithNoTests`. Without that flag, the same `src` target exits 1
after checking four files. Migration-baseline and current `src` trees are
identical and contain only `index.ts` plus `services/s3-file.ts`.

After removal, the filtered root command selects File S3 but executes zero
tasks, while scoped Turbo retains a `<NONEXISTENT>` marker. The general unit
graph remains 83 nodes and moves 68 executable/15 markers to 67/16. The separate
Framework/Utils graph remains 2/2/0.

Fast/all integration graphs remain 53/63 and own File S3 once through the
byte-identical Jest command. Pre/post reporters match at one skipped suite,
eight skipped tests, and zero snapshots; authentic shards retain 8 skipped/0/0.
Because the whole suite is `describe.skip`, no S3 credential, AWS SDK request,
Axios request, or assertion executes. This is integration ownership stability,
not live S3 behavior.

The remaining-Jest inventory removes exactly the retired File S3 unit entry.
Its digest becomes
`f7cba2d34e540fdf98b6ffee7257b671202c6e978531e59fc3bad8d6244d30c5`;
manifest scripts fall 112 to 111 while script owners, configs, and API files
remain 68, 68, and 406. Every other inventory count is unchanged.

Validation:

- baseline/current tree and zero-discovery proof pass;
- unchanged integration reporters, authentic shards, and immutable
  source/spec/config/fixture hashes pass;
- package build, filtered root/Turbo behavior, unit/integration graphs,
  workspace policy, exact inventory, and the complete shared foundation pass.

The skipped integration spec's direct test-only Axios import remains undeclared
and root-hoisted. If the suite is ever enabled, it also needs six `S3_TEST_*`
values, real network access, and stronger failure-safe cleanup. Those belong to
the later integration shadow/activation boundary, not this manifest-only unit
retirement.

This turn changes no package-private/merge preparation, dependency, lockfile,
catalog, source, assertion, fixture, integration ownership, persistence,
production runtime, workerd, D1, or Cloudflare boundary. There is no new
workflow or hosted result to claim.

## File S3 Integration Shadow Dependency Ownership

Commit:

- `dbbe6511b7` (`test: add File S3 integration Vitest shadow`)

Date verified: 2026-07-11.

Affected boundary:

- `@medusajs/file-s3` keeps its exact Jest-authoritative `test:integration`
  command and adds only opt-in `test:integration:vitest`;
- the package adds `axios: ^1.13.1` to `devDependencies` because the unchanged
  integration spec imports Axios directly and production source does not;
- the File S3 lock importer adds exactly `specifier: ^1.13.1` and
  `version: 1.13.2` beneath Axios;
- the existing `axios@1.13.2` package/snapshot records and root override remain
  unchanged, and Axios has no peer dependency suffix to encode;
- no root manifest, workspace override, catalog, unrelated importer,
  package/snapshot record, version, privacy field, production dependency, or
  peer dependency changes.

Before this turn, the test's direct import was undeclared by File S3 and resolved
only by climbing to the root hoisted Axios installation. That runtime success
masked package ownership. The new dev dependency and importer edge make the
test-only ownership explicit without promoting Axios into the published runtime
dependency surface.

The repository still has no pnpm catalog migration in this runner slice. The
existing root Axios range and override remain `^1.13.1`; catalog/private-package
and repository-merge preparation stay separate from Jest-to-Vitest turns.

Validation:

- the manifest and parsed lock importer agree on `^1.13.1` resolving to the
  existing `1.13.2` record;
- a targeted `--frozen-lockfile --offline --ignore-scripts` install passes with
  no downloads and confirms the lockfile is current;
- workspace dependency policy passes for all 86 manifests;
- the File S3 Vitest shadow imports successfully and exact Jest/Vitest reporter
  parity passes at one file and eight skipped tests;
- package build, formatting, `git diff --check`, exact inventory, unchanged
  task graphs, and the complete shared test-runner foundation pass.

This turn changes no package-private/merge preparation, catalog strategy,
assertion, skip state, fixture, source, Jest config, root script, workflow,
persistence, production runtime, workerd, D1, or Cloudflare boundary. Because
the suite remains wholly skipped, dependency ownership is fixed but no Axios or
S3 network behavior is claimed.

The next package-management boundary is Turn 30's File S3 runner cut-over. It
should retain this Axios edge unchanged while switching the package default and
adding unsharded root/workflow ownership in the test-runner records. It must not
combine catalogs, private-package changes, live credentials, cleanup repair, or
another provider.

## File S3 Integration Vitest Cut-Over Ownership

Commit:

- `da5bd98f53` (`test: switch File S3 integration to Vitest`)

Date verified: 2026-07-11.

Affected boundary:

- `@medusajs/file-s3` promotes the existing Vitest command to
  `test:integration`, moves the byte-identical Jest command to
  `test:integration:jest`, and removes the temporary shadow key;
- root `typecheck:test-runner-tooling` adds the File S3 Vitest config exactly
  once;
- root `test:integration:packages:fast` adds only the File S3 exclusion because
  a one-file Vitest lane cannot consume the generic three-way shard;
- the all-packages and slow commands remain unchanged;
- the workflow adds dedicated unsharded `file-s3-integration` and propagates all
  of its terminal states through the package aggregate;
- no package version, privacy field, publication metadata, peer dependency,
  production dependency, dev dependency, workspace override, catalog, or
  lockfile change.

The test-only Axios ownership from Turn 29 remains exactly:

```text
devDependencies.axios  ^1.13.1
lock importer          1.13.2
dependencies.axios     absent
```

The typed contract now protects that placement as well as exact package/root
commands, one config typecheck token, the complete runner-neutral workflow job,
aggregate conditions, and immutable spec/config/fixture hashes. Production
source hashes remain turn-scoped evidence rather than a permanent runner gate.
No new root wrapper or package-specific verifier is added.

The remaining-Jest inventory accepts only the unchanged command's manifest-key
move from `test:integration` to `test:integration:jest`. Counts remain 68
configs, 111 scripts across 68 owners, and 406 active API files; the reviewed
new digest is
`1ac908587ec53d1de09104422e0b9dc34a227119b3e9ca67f96ca5e5d2721447`.

Task ownership becomes:

- fast integration: 52 total, 33 executable, 19 markers, no File S3;
- all integration: 63 total, 44 executable, 19 markers, File S3 once on Vitest;
- general/serial units: unchanged 83/67/16 and 2/2/0.

Validation:

- exact pre-Jest/post-Jest/Vitest reporter parity passes at one file and eight
  skipped tests;
- direct default/rollback commands, authentic shards, package build, strict
  tooling typecheck, and all eight contract tests pass;
- workspace dependency policy, exact inventory, formatting, graph ownership,
  and the complete shared test-runner foundation pass;
- registry and local versions agree on Vite 8.1.4/Rolldown and Vitest 4.1.10.

This turn changes test-runner and CI ownership, not package-private/merge
preparation or catalog strategy. It changes no Axios resolution, lockfile,
assertion, skip state, fixture, source, config, persistence, production runtime,
workerd, D1, or Cloudflare boundary. The unsharded job has locally proven shape
and command behavior; hosted execution remains deferred and no live S3 behavior
is claimed.

The next package-management slice is Notification Local's separate empty-unit
ownership decision. It must preserve that package's integration lane and must
not combine catalogs, private-package changes, dependencies, CI, Notification
SendGrid, or another provider.

## Notification Local Empty Unit Manifest Ownership

Commit:

- `6dececa1d0` (`test: retire empty Notification Local unit lane`)

Date verified: 2026-07-12.

Affected boundary:

- `@medusajs/notification-local` removes only the inherited
  `test: jest --passWithNoTests src` manifest entry;
- the exact `test:integration` command, Jest config, one-test integration spec,
  package source, build/watch commands, dev/peer framework dependency, version,
  privacy field, publication metadata, and keywords remain unchanged;
- no empty Vitest replacement or rollback command is added because no unit
  assertion source exists;
- the package remains a Jest owner through its separate integration command;
- no root command, workflow, CI job, persistent tooling contract, catalog,
  override, resolution, dependency, or lockfile changes.

The package unit command discovers zero files and passes only through
`--passWithNoTests`. Direct listing is empty; direct execution without the flag
exits 1 after four files are checked and zero match. Goal baseline/current `src`
trees are identical and contain only `index.ts` plus `services/local.ts`, with
no unit assertion, test, mock, fixture, or snapshot ownership.

After removal, the scoped root command executes zero tasks while Turbo retains
one `<NONEXISTENT>` marker. General units remain 83 nodes and move 67/16 to
66/17 executable/marker ownership; Framework/Utils remains 2/2/0.

Fast/all integration graphs remain 52/63 and own Notification Local once on the
byte-identical Jest command. Pre/post reporters match at one passing file/test,
the exact full name, and zero snapshots; authentic shards remain 1/0/0. The
integration is local-only and uses a restored `console.info` spy, not a database,
Redis, filesystem, network, credential, workerd, or Cloudflare service.

The remaining-Jest inventory removes exactly the empty unit entry. Its digest
becomes
`b89e589f285d2e272e60e864ad1af9c7b38792d9165d92ff290ae792c36df4df`;
manifest scripts fall 111 to 110 while owners, configs, and API files remain 68,
68, and 406. Every other inventory count is unchanged.

Validation:

- baseline/current tree, hashes, and zero-unit-discovery proof pass;
- unchanged integration reporters, shards, and no-force-exit diagnostic pass;
- package build, scoped/general/serial/integration graphs, workspace policy,
  exact inventory, formatting, and the complete shared foundation pass.

This turn changes no package-private/merge preparation, catalog strategy,
dependency, lockfile, source, assertion, config, integration ownership,
persistence, production runtime, workerd, D1, or Cloudflare boundary. No
workflow or hosted result changes.

The next package-management slice is the separate Notification Local
integration Vitest shadow. It should add only an opt-in script/config and retain
Jest authority; it must not combine catalogs, private-package changes,
dependencies, CI, Notification SendGrid, or another provider.

## Notification Local Integration Shadow Ownership

Commit:

- `0bead05d23` (`test: add Notification Local integration Vitest shadow`)

Date verified: 2026-07-12.

Affected boundary:

- `@medusajs/notification-local` keeps the exact Jest-authoritative
  `test:integration` command and adds only opt-in `test:integration:vitest`;
- a package-local config consumes the existing shared serial Node integration
  helper, five aliases, and sole integration spec;
- the retired unit lane remains absent;
- no package version, privacy field, publication metadata, build/watch command,
  production dependency, dev dependency, peer dependency, root manifest,
  workspace override, catalog, lock importer, package/snapshot record, or
  workflow changes.

No dependency edge is required. The spec imports only local source, the source
uses the package's existing `@medusajs/framework: workspace:*` dev/peer
ownership, and the config imports only `node:url` plus the relative shared
helper. The lockfile therefore remains byte-identical.

Runner proof is exact at one file, one passed test, the same full name/status,
zero failures/skips/todos/snapshots, and a restored local console spy across
pre/post Jest plus opt-in Vitest. The config hash is
`3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`.
The shared Vitest helper also loads the repository's test-worker-only
`setup-env.js`, which loads `.env.test`, reads optional `CHUNK`/`DB_TEMP_NAME`,
and, when `DB_TEMP_NAME` is absent, resolves a validated worker ID from
`MEDUSA_TEST_WORKER_ID`, `VITEST_POOL_ID`, or `JEST_WORKER_ID` (falling back to
`1`) before initializing the name. It also replaces `global.performance`. Jest
does not load that file. The unchanged assertion observes none of this state and
requires no caller-provided environment or external service, so the harness
difference is accepted without a manifest or dependency change.

Task ownership remains:

- general/serial units: 83/66/17 and 2/2/0;
- fast integrations: 52 total, 33 executable, 19 markers, Notification Local
  once on Jest;
- all integrations: 63 total, 44 executable, 19 markers, Notification Local
  once on Jest.

The remaining-Jest inventory is byte-identical at digest
`b89e589f285d2e272e60e864ad1af9c7b38792d9165d92ff290ae792c36df4df`,
with 68 configs, 110 scripts across 68 owners, and 406 active API files. No root
command, CI job, or persistent tooling contract changes in this shadow turn.

Validation:

- exact reporter/name/status parity, unsharded listing, natural exit, and
  authentic Jest/Vitest shard behavior pass;
- strict standalone config typecheck, package build, workspace dependency
  policy, exact inventory, formatting, hashes, graphs, and the complete shared
  foundation pass;
- registry and local versions agree on Vite 8.1.4/Rolldown and Vitest 4.1.10.

This turn changes no package-private/merge preparation, catalog strategy,
dependency, lockfile, assertion, source, Jest config, persistence, production
runtime, workerd, D1, or Cloudflare boundary. No workflow or hosted result
changes.

The next package-management boundary is Notification Local's separate Vitest
cut-over. It should retain dependencies/lockfile unchanged while moving the
Jest command to rollback, excluding the one-file lane from generic fast shards,
and adding dedicated unsharded root/workflow ownership. It must not combine
catalogs, private-package changes, Notification SendGrid, or another provider.

## Notification Local Vitest Default And CI Ownership

Commit:

- `07a1caabd5` (`test: switch Notification Local integration to Vitest`)

Date verified: 2026-07-12.

Affected boundary:

- `@medusajs/notification-local` promotes the existing Vitest command to
  `test:integration`, moves the byte-identical Jest command to
  `test:integration:jest`, and removes the temporary shadow key;
- the retired unit lane remains absent and the Jest config stays for rollback;
- root strict tooling adds the existing package config exactly once;
- the root fast command adds only the Notification Local exclusion, while slow
  and all-packages commands remain unchanged;
- the workflow adds dedicated unsharded `notification-local-integration` and
  propagates all terminal states through the package aggregate;
- no package version, privacy field, publication metadata, dependency,
  peer/development dependency, workspace override, catalog, lock importer,
  package/snapshot record, or lockfile changes.

Manifest ownership is now:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
test                   absent
```

No new root wrapper or package-specific verifier is added. The typed contract
protects the exact package/root commands, one config typecheck token, immutable
spec/Jest/Vitest hashes, the complete runner-neutral workflow job, absent job
environment/services/strategy, and aggregate terminal-state propagation. It
uses strict narrowing and adds no `any`, enum, cast, suppression, or weak type.

Task ownership becomes:

- general/serial units: unchanged 83/66/17 and 2/2/0;
- fast integrations: 51 total, 32 executable, 19 markers, no Notification Local;
- all integrations: 63 total, 44 executable, 19 markers, Notification Local
  once on Vitest.

The remaining-Jest inventory accepts only the byte-identical command's manifest
key move from `test:integration` to `test:integration:jest`. Counts stay 68
configs, 110 scripts across 68 owners, and 406 active API files. The reviewed
digest is
`2994c111cab4cf88af15777b67086bad827e4a8308036679ce735a5aeda222c4`.

Validation:

- committed pre-Jest, rollback Jest, and default Vitest reporters compare
  pairwise at one file, one passed test, the exact full name/status, and zero
  snapshots;
- direct default/rollback/list, natural exit, no-force Jest, authentic
  fail-closed Vitest shards, and Jest 1/0/0 pass expected outcomes;
- frozen offline install leaves the lockfile unchanged; package build, workspace
  dependency policy, strict tooling, eight contract tests, formatting, hashes,
  graphs, and exact inventory pass;
- after a low-disk native PGlite retry and bounded pnpm cache prune, the isolated
  three-file/34-test adapter and the complete 248-second foundation rerun pass
  all 25 selectors and exact adapter parity;
- registry and local versions agree on Vite 8.1.4/Rolldown and Vitest 4.1.10.

This turn changes package/root/CI runner ownership, not package-private/merge
preparation or catalog strategy. It changes no assertion, source, config,
dependency, lockfile, persistence, production runtime, workerd, D1, or
Cloudflare boundary. The unsharded job has locally proven shape and exact
command behavior, but hosted setup/cache/artifact scheduling and aggregate
execution remain deferred until publication.

The next package-management slice is Notification SendGrid's separate empty-unit
ownership decision. It must preserve that package's integration lane,
`@sendgrid/mail` ownership, source, dependencies/lockfile, and root/workflow
shape. It must not combine the later integration migration, catalogs,
private-package changes, locking providers, or CI.

## Notification SendGrid Empty Unit Manifest Ownership

Commit:

- `ac345e53be` (`test: retire empty Notification SendGrid unit lane`)

Date verified: 2026-07-12.

Affected boundary:

- `@medusajs/notification-sendgrid` removes only the inherited
  `test: jest --passWithNoTests src` manifest entry;
- the exact Jest integration command/config, wholly skipped five-case spec,
  package source, build/watch scripts, metadata, and keywords remain unchanged;
- production `@sendgrid/mail: ^8.1.6` and framework `workspace:*` dev/peer
  ownership remain unchanged, with the lock importer still resolving SendGrid
  Mail 8.1.6;
- no empty Vitest replacement or rollback is added because no unit assertion
  source exists;
- the package remains a Jest owner through its separate integration command;
- no root command, workflow, CI job, persistent tooling contract, catalog,
  override, dependency, importer, package/snapshot record, or lockfile changes.

The removed command lists zero unit paths and exits 0 only through
`--passWithNoTests`. Direct execution without the flag exits 1 after four files
are checked and `src` has zero matches. Goal-baseline/current source trees are
identical and contain only `index.ts` plus `services/sendgrid.ts`, with no unit
assertion, test, mock, fixture, or snapshot ownership.

The separate integration remains one skipped suite/five skipped tests with
exact pre/post reporter parity, zero snapshots, shards five/zero/zero, and a
clean no-force diagnostic. All four `SENDGRID_TEST_*` variables are absent, and
`describe.skip` prevents real email/API traffic. If enabled manually, the suite
can deliver email and depends on remote errors; this turn proves no live
SendGrid behavior.

Task ownership becomes:

- general units: 83 total, 65 executable, 18 markers, with SendGrid unit as
  `<NONEXISTENT>`;
- Framework/Utils units: unchanged 2/2/0;
- fast integrations: unchanged 51/32/19, SendGrid once on Jest;
- all integrations: unchanged 63/44/19, SendGrid once on Jest.

The remaining-Jest inventory removes exactly the empty unit entry. Its digest
becomes
`c508a382b600ddaf38321a536b4e4d3f252851777cf2e1d0c5e188b2d0f8516a`;
manifest scripts fall 110 to 109 while owners, configs, and API files remain 68,
68, and 406. Every other inventory count is unchanged.

Validation:

- baseline/current tree, normalized hashes, zero-unit discovery, and direct
  no-pass failure proof pass;
- unchanged integration reporters, names/statuses, shards, environment absence,
  and no-force diagnostic pass;
- frozen offline install keeps the lockfile byte-identical; package build,
  workspace dependency policy, scoped/general/serial/integration graphs, exact
  inventory, formatting, and the complete 267.7-second foundation pass.

This turn changes no package-private/merge preparation, catalog strategy,
dependency, lockfile, source, assertion, config, integration ownership,
persistence, production runtime, workerd, D1, or Cloudflare boundary. No root,
workflow, or new hosted result changes.

## Notification SendGrid Integration Shadow Ownership

Commit:

- `1e68aa8b1f` (`test: add Notification SendGrid integration Vitest shadow`)

Date verified: 2026-07-12.

Affected boundary:

- `@medusajs/notification-sendgrid` adds only
  `test:integration:vitest: vitest run --config vitest.integration.config.mts`;
- its exact Jest `test:integration` value remains authoritative and
  byte-identical;
- the package-root config uses the shared serial Node integration profile,
  standard five aliases, and only `services.spec.ts`;
- the manifest's production dependency remains `@sendgrid/mail: ^8.1.6`, and
  pnpm still resolves 8.1.6 from the same importer/lock record;
- framework dev/peer edges remain `workspace:*`; build/watch scripts, package
  metadata, version, public/private state, files, and keywords remain
  unchanged;
- no dependency, override, catalog, importer, package snapshot, root manifest,
  workflow, CI job, persistent typecheck, or lockfile change.

The new script is opt-in and not owned by Turbo or the hosted workflow. General
and serial units remain 83/65/18 and 2/2/0. Fast/all integration graphs remain
51/32/19 and 63/44/19 and own SendGrid once on the unchanged Jest command.

Exact normalized pre-Jest/post-Jest/Vitest parity is one file, zero passed or
failed, five skipped, zero todo, and zero snapshots. Vitest 4.1.10 running on
the Vite 8.1.4 foundation imports the unchanged service and CommonJS
`@sendgrid/mail` default successfully, then exits naturally. Jest `/3` shards
remain five/zero/zero and exit 0; all Vitest `/3` runs fail closed because one
file cannot satisfy three shards.

All four `SENDGRID_TEST_*` variables remain absent. Top-level `describe.skip`
prevents service construction, SendGrid singleton mutation, assertions, HTTPS
requests, delivery, remote-error handling, and cleanup. The package-management
change proves no live SendGrid behavior.

The remaining-Jest inventory is unchanged at digest
`c508a382b600ddaf38321a536b4e4d3f252851777cf2e1d0c5e188b2d0f8516a`:
68 configs, 109 scripts across 68 owners, and 406 active API files. A frozen
offline install reports all 86 workspaces up to date and preserves lock hash
`40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.

Validation:

- exact reporter/name/status parity, CommonJS import, natural exit, shard
  behavior, credentials absence, preserved hashes, and protected boundaries
  pass;
- package build, one-shot strict config typecheck, frozen offline install,
  workspace dependency policy, exact inventory, and all graph checks pass;
- the complete 237.4-second foundation passes strict tooling, eight tooling
  tests, five-file parity, all 25 selectors, real adapters, exact three-file/
  34-test parity, and inventory.

This turn changes test-runner manifest/config ownership only. It does not
advance package-private merge preparation, `workspace:*` policy, catalogs,
dependencies, lockfile, persistence, production runtime, workerd, D1, or the
Cloudflare bundle. No hosted result applies to this opt-in script.

## Notification SendGrid Vitest Default And CI Ownership

Commit:

- `4dc562a1e3` (`test: switch Notification SendGrid integration to Vitest`)

Date verified: 2026-07-12.

Affected boundary:

- `test:integration` becomes the byte-identical proven Vitest command;
- the byte-identical Jest command moves to `test:integration:jest` and the
  temporary shadow key is removed;
- the root fast-package command adds only the SendGrid exclusion;
- persistent strict tooling typecheck adds the SendGrid config exactly once;
- the workflow adds a runner-neutral dedicated unsharded SendGrid job and the
  existing package aggregate propagates all of its terminal states;
- the existing strict typed contract expands to package/root/workflow and
  immutable runner-artifact ownership;
- the remaining-Jest inventory accepts only the manifest-key move.

The manifest retains version 2.13.4, its public state, metadata, files,
build/watch commands, and production `@sendgrid/mail: ^8.1.6`. Pnpm still
resolves SendGrid Mail 8.1.6. Framework dev/peer dependencies remain
`workspace:*`. No catalog, override, dependency, importer, package snapshot, or
lockfile change occurs.

The fast integration graph moves 51/32/19 to 50/31/19 and has no SendGrid task.
The all-package graph remains 63/44/19 and owns SendGrid once on Vitest. General
and Framework/Utils unit graphs stay 83/65/18 and 2/2/0.

The dedicated job has `needs: setup`, Ubuntu, a ten-minute timeout, existing
checkout/cache/artifact steps, and exact unsharded package execution. It has no
environment, service, strategy, matrix, shard, CPU probe, worker flag,
credential, or runner name. The aggregate handles failure, cancelled, skipped,
and success states under its existing `always()` boundary.

Pre/post/default/rollback normalized reporters are exact at one file, five
skipped, zero passed/failed/todo/snapshots, with unchanged names. The unsharded
Vitest default exits naturally; Jest rollback remains five/zero/zero; every
Vitest `/3` invocation fails closed. All four credentials remain absent, and
the skipped suite executes no constructor, singleton mutation, assertion,
network request, delivery, remote error, or cleanup path.

Remaining-Jest counts stay 68 configs, 109 scripts across 68 owners, and 406
API files. Only the rollback key changes, producing digest
`ccf3ead2e047791b66e16c98d2e178a021b639e9719278366338677300f46404`.
A frozen offline install keeps lock hash
`40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.

Validation:

- the typed contract passes before extension, fails exactly against the old
  root fast command, then passes after implementation with strict typecheck and
  all eight tooling tests;
- exact reporter/name/status parity, natural exit, shards, no-force diagnostic,
  credentials absence, dependency resolution, hashes, and graph ownership
  pass;
- package build, frozen install, workspace dependency policy, inventory,
  formatting, and the complete 234.4-second foundation pass.

This turn changes test-runner/root/workflow ownership only. It does not advance
package-private merge preparation, catalog strategy, workspace dependency
policy, dependency versions, lockfile, persistence, production runtime,
workerd, D1, or the Cloudflare bundle.

Local workflow parsing, typed contract execution, graph inspection, and the
exact dedicated command do not prove hosted checkout/cache/artifact scheduling
or aggregate execution. Hosted confirmation remains deferred. Even hosted
green would prove only collection of the wholly skipped suite, not live
SendGrid delivery or errors.

## Locking Postgres Empty Unit Manifest Ownership

Commit:

- `91a6b91fc8` (`test: retire empty Locking Postgres unit lane`)

Date verified: 2026-07-12.

Affected boundary:

- `@medusajs/locking-postgres` removes only
  `test: jest --passWithNoTests src` after direct discovery proves zero unit
  files and assertions;
- the separate Jest integration command/spec/config remains authoritative and
  unchanged;
- source, migration snapshot/migration, models, advisory-lock service,
  MikroORM config, tsconfig, watch/build/alias/migration commands, metadata,
  version, and package public/private state remain unchanged;
- framework dev/peer ownership remains `workspace:*`;
- no Vitest replacement or rollback is added for nonexistent unit coverage;
- no root manifest, workflow, CI job, persistent tooling contract, catalog,
  override, dependency, importer, package snapshot, or lockfile change.

The removed command lists `[]`, exits 0 only through `--passWithNoTests`, and
exits 1 without the flag after eight package files are checked with zero `src`
matches. Goal-baseline/current source trees are identical at six tracked files
and contain no unit test surface.

The separate integration is real PostgreSQL coverage. A temporary PostgreSQL
18.3 cluster ran under the system temporary directory on port 55437 without
touching the installed service. The runner's shared pool requires deterministic
`medusa-locking-integration-1` to exist before startup; an empty-cluster attempt
failed with missing-database/`ECONNRESET`, while pre-creating that database made
the unchanged suite pass consistently.

Pre/post reporters match one file, five passed, one skipped, no failures/todos/
snapshots. The exact package command and no-force diagnostic pass; authentic
Jest shards are five-plus-one/zero/zero. The isolated cluster was stopped and
removed after confirming no active test connections.

Task ownership becomes:

- general units: 83 total, 64 executable, 19 markers, with Locking Postgres as
  `<NONEXISTENT>`;
- Framework/Utils units: unchanged 2/2/0;
- fast integrations: unchanged 50/31/19, Locking Postgres once on Jest;
- all integrations: unchanged 63/44/19, Locking Postgres once on Jest.

The remaining-Jest inventory removes exactly the empty unit entry. Its digest
becomes
`2f4d7d288d2921136018774ca486b6bceacbef18716e43599384c355a413c2e1`;
manifest scripts move 109 to 108 while owners/configs/API files remain
68/68/406. Every other count is unchanged.

Validation:

- baseline/current tree, zero-unit discovery, no-pass failure, and normalized
  hashes pass;
- isolated PostgreSQL lifecycle diagnosis, pre/post reporter parity, exact
  command, no-force exit, shards, and safe cleanup pass;
- package build and alias resolution, frozen offline install, workspace policy,
  exact inventory, formatting, graphs, and the complete 260.5-second foundation
  pass.

This turn changes unit manifest ownership only. It does not advance
package-private merge preparation, catalog strategy, dependency/lockfile,
integration migration, persistence, production runtime, workerd, D1, or the
Cloudflare bundle. No root/workflow or hosted result changes.

## Locking Postgres Integration Vitest Shadow Ownership

Commit:

- This commit (`test: add Locking Postgres integration Vitest shadow`)

Date verified: 2026-07-12.

Affected boundary:

- `@medusajs/locking-postgres` retains its exact Jest `test:integration`
  default and adds only
  `test:integration:vitest: vitest run --config vitest.integration.config.mts`;
- a package-root config reuses the existing hoisted Vite 8.1.4/Vitest 4.1.10
  toolchain, shared serial Node profile, five aliases, and sole `index.spec.ts`;
- one integration bootstrap line changes from raw source-directory resolution
  to `require.resolve("@medusajs/locking-postgres")` so both runners consume the
  freshly built declared production entry;
- all tests/assertions/skips/mocks/timeouts and both pre-existing `any[]` remain
  unchanged;
- no dependency, catalog, override, package version/private state, importer,
  package snapshot, or lockfile change;
- no root manifest, Turbo config, workflow, CI job, persistent tooling contract,
  or another package script changes.

Live installed and registry `latest` values match Vite 8.1.4 and Vitest 4.1.10.
The Locking package resolves both through the established root-tooling hoist;
no package-local dependency is required for this shadow. The inherited direct
test import of `@medusajs/test-utils` is also hoist-resolved and remains a future
strict-linker audit item rather than a dependency silently mixed into this
turn.

The source-resolution change is deliberate and bounded. An unchanged relative
directory cannot resolve `src/index.ts` under native Vitest `require.resolve`;
an explicit TypeScript entry later escapes Vite into the built CJS loader; and
an imported provider export is not registered by the current dynamic internal
loader. The accepted production package name resolves after a clean build to:

```text
packages/modules/providers/locking-postgres/dist/index.js
```

It exports module `locking` with `PostgresAdvisoryLockProvider`. No shared AST
rewrite, require hook, global loader mutation, or modules-sdk change is added.

The new normalized hashes are:

- integration spec:
  `027b840cb2e10e1d9286456a430c30f2df7f8b69bb1a8b87cc5b9253e09b3b8d`;
- Vitest config:
  `69b01480ab6cce348730a134543f7c5ef37a29f23f55f54e787cac831d7eb632`.

Source, migration, Jest config, tsconfig, MikroORM config, and raw lock hashes
remain unchanged. The raw lock SHA-256 is
`40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.
The frozen offline install reports all 86 workspace projects up to date, and
the workspace dependency policy reports all 86 manifests using `workspace:*`.

Task ownership remains:

- scoped/general/Framework-Utils units: 1/0/1, 83/64/19, and 2/2/0;
- fast integrations: 50/31/19, with Locking Postgres once on Jest;
- all integrations: 63/44/19, with Locking Postgres once on Jest.

The new opt-in key has no root or workflow owner. The remaining-Jest inventory
is byte-identical at digest
`2f4d7d288d2921136018774ca486b6bceacbef18716e43599384c355a413c2e1`,
68 configs, 108 scripts across 68 owners, and 406 API files.

Validation:

- clean build/alias resolution and production-entry inspection pass;
- strict standalone config typecheck, formatting, diff hygiene, hashes, exact
  inventory, workspace policy, and frozen install pass;
- one isolated PostgreSQL 18.3 cluster with separate Jest/Vitest worker-named
  databases proves exact pre-Jest/post-Jest/Vitest 5-pass/1-skip parity,
  natural exit, no-force behavior, shards, and zero retained connections;
- after safely removing the completed temporary database cluster, the complete
  shared test-runner foundation passes in 262.7 seconds.

This turn changes package-local test ownership only. It does not advance
package-private merge preparation, pnpm catalog strategy, root/CI ownership,
default runner ownership, persistence, production runtime, workerd, D1, or the
Cloudflare bundle. No hosted result applies.

The next package-management slice is the Locking Postgres integration cut-over:
move the exact Jest default to `test:integration:jest`, make Vitest the default,
remove the temporary shadow key, exclude the one-file lane only from generic
fast sharding, and add dedicated runner-neutral PostgreSQL workflow ownership.
That local workflow edit needs no GitHub access; hosted confirmation remains
deferred. Do not combine Locking Redis, dependency/lockfile/catalog/private-
package work, PGlite, or Cloudflare claims.

## Locking Postgres Vitest Default And PostgreSQL CI Ownership

Commit:

- This commit (`test: switch Locking Postgres integration to Vitest`)

Date verified: 2026-07-12.

Affected boundary:

- `test:integration` becomes the proven
  `vitest run --config vitest.integration.config.mts` command;
- the byte-identical Jest command moves to `test:integration:jest`, the
  temporary `test:integration:vitest` key is removed, and the retired unit key
  remains absent;
- persistent strict tooling adds the existing Locking Postgres config exactly
  once;
- the root fast integration command adds only the Locking Postgres exclusion,
  while slow and unsharded all-packages commands remain unchanged;
- the workflow adds a dedicated unsharded PostgreSQL job and the existing
  package aggregate propagates all of its terminal states;
- the strict typed contract expands to package/root/hash/PostgreSQL-job/
  aggregate ownership;
- the remaining-Jest inventory accepts only the manifest-key move.

Manifest ownership is now:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
test                   absent
```

The package keeps version 2.13.4, public state, metadata, build/watch/alias and
migration commands, and no production `dependencies` field. Framework
development and peer edges remain `workspace:*`. No package-private merge
preparation, catalog, override, dependency, importer, package snapshot, or
lockfile change occurs; raw lock SHA-256 remains
`40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.

The dedicated `locking-postgres-integration` job has `needs: setup`, Ubuntu, a
ten-minute timeout, the existing PostgreSQL health/port convention, and four
standard checkout/cache/artifact/run steps. Its service sets
`POSTGRES_DB=medusa-locking-integration-vitest-1`, `POSTGRES_USER=postgres`, and
`POSTGRES_PASSWORD=postgres`. The run step supplies the four explicit `DB_*`
connection values and invokes only the runner-neutral package default:

```text
pnpm --filter @medusajs/locking-postgres test:integration
```

It has no job environment, strategy, matrix, shard, CPU probe, explicit worker
identity, or runner-specific name. Build-artifact download remains required for
the package's declared `dist/index.js` production entry and the shared built
test-worker identity. The package aggregate retains `always()` and handles the
new job's failure, cancelled, skipped, and success states.

Local validation used an isolated PostgreSQL 18.3 trust-auth cluster on port
55439 with both runner-aware databases pre-created. The installed
`postgresql-x64-18` service was untouched. Committed Jest, rollback Jest, and
default Vitest reporters match at one file, five passed, one skipped, zero
failed/todo/snapshots, and exact names/statuses. Jest `/3` remains
five-plus-one/zero/zero; every Vitest `/3` invocation fails closed before
import; unsharded list returns the five runnable names; and both databases have
zero active connections after execution. The cluster was stopped and its
verified temporary directory removed.

Task ownership becomes:

- scoped/general/Framework-Utils units: unchanged 1/0/1, 83/64/19, and 2/2/0;
- fast integrations: 50/31/19 to 49/30/19, with no Locking Postgres task;
- all integrations: unchanged 63/44/19, with Locking Postgres once on Vitest.

The remaining-Jest inventory keeps 68 configs, 108 scripts across 68 owners,
and 406 active API files. Only the rollback key changes, producing digest
`b30b0e5a8cd7ced2711fea1b34c52216ae8b3cf8b6acc5ebb97a55812fd4034b`.

Validation passes package build/alias resolution, strict tooling and eight
contract tests, exact reporter/shard/list/connection proof, workflow parsing,
typed contract, frozen offline install, all 86 workspace dependency checks,
protected hashes, graphs, inventory, formatting, and the complete 239.1-second
foundation. Installed and live registry values still agree on Vite 8.1.4 with
built-in Rolldown and Vitest 4.1.10.

This turn changes test-runner/root/workflow ownership only. It changes no
assertion, name, skip, mock, timeout, snapshot, source, migration, Jest/Vitest
config, tsconfig, MikroORM config, package dependency, lockfile, persistence,
production runtime, workerd, D1, or Cloudflare bundle boundary. All protected
Turn 38 hashes remain unchanged.

Local workflow parsing and contract execution do not prove GitHub scheduling,
PostgreSQL service startup, cache/artifact restoration, or aggregate execution.
There was no GitHub access; hosted CI confirmation remains explicitly deferred.

## Locking Redis Empty Unit Manifest Ownership

Commit:

- This commit (`test: retire empty Locking Redis unit lane`)

Date verified: 2026-07-12.

Affected boundary:

- `@medusajs/locking-redis` removes only
  `test: jest --passWithNoTests src` after direct discovery proves zero unit
  files and assertions;
- the separate Jest Redis integration command/spec/config remains active,
  authoritative, and byte-identical;
- source, tsconfig, watch/build/alias commands, metadata, version, and package
  public/private state remain unchanged;
- `ioredis: ^5.4.1` remains a production dependency at lock resolution 5.8.2,
  while framework dev/peer ownership remains `workspace:*`;
- no Vitest replacement or rollback is added for nonexistent unit coverage;
- no root manifest, workflow, CI job, persistent tooling contract, catalog,
  override, importer, package snapshot, dependency, or lockfile change.

Direct listing returns no path. The package unit command exits 0 only because
`--passWithNoTests` is present; direct `jest --no-cache --runInBand src` exits
1 after six files are checked and reports `Pattern: src - 0 matches`. The one
global `testMatch` match is the separate integration spec outside `src`, not a
unit file. Goal-baseline/current source trees are identical at entrypoint,
loader, Redis-lock service, and options type, with no unit spec, test API,
assertion, mock, fixture, or snapshot.

The protected integration command remains:

```text
jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

Its sole `index.spec.ts` has six `it`, 24 `expect`, five `jest.fn`, one
`jest.setTimeout`, two pre-existing `any[]`, and no snapshots. It targets
`REDIS_URL` or `redis://localhost:6379` and exercises real Redis-backed locking,
not an in-memory substitute.

Turn 40 found no process/user/machine `REDIS_URL`, Redis CLI/server or Docker
command, Redis service/process, port-6379 listener, or reachable local Redis
endpoint. The integration was therefore explicitly not executed. No local
Redis parity, cleanup, timing, or production behavior is claimed. The existing
generic package workflow continues to supply its unchanged Redis service,
health check, mapped port, and Jest integration ownership; no new hosted result
is claimed.

Normalized-LF hashes remain:

- integration spec:
  `a97ad9aac8520dbe551f9406af4e548a453454bc07b744abfe57e510e5dfa094`;
- Jest config:
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- tsconfig:
  `444e89a6ca86a1e65c2000babbbf18f68fde9bfa1c78c676721d6e6c8e644166`;
- entrypoint, loader, service, and types:
  `52f165b1a0e6bcb9d2c9aab22305c4218498637bb1c34f46397d894de25e8e23`,
  `c5ae2941bb5009ef6f09753d6fbdb866c1f228adfd96d599f4980f4fd6aa76b8`,
  `66f49c9450e18953b0b12f8df11d1f104125742d398b1da2b4d863bfb7f60777`,
  and `b191f1d798e9444028e9a83d949edd453c00f5df017ea10d9c0a38ec66428261`.

The exact one-line removal produces normalized package-manifest hash
`8c70c68f8f9f7ae9fb282eadb50c1d0bdb574286cef5d04aa8399e27c4141bac`.
Root, workflow, lockfile, and tooling-contract hashes remain respectively
`ddea099bc0d49a4334d9809f2252c50fd9081b9757988fd09ceb7914bc3dd369`,
`c745b0b3e49bac055e3eb8b2496701918657970f073f5ad21619eec678067411`,
`40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`,
and `f7f5c9fb1dd36cb139a0753fe76c8eb9b6c22a8c8b87fb97a5959d44a427740b`.

Task ownership becomes:

- scoped units: 1/0/1 with Locking Redis `<NONEXISTENT>`;
- general units: 83/63/20;
- Framework/Utils units: unchanged 2/2/0;
- fast integrations: unchanged 49/30/19, Locking Redis once on Jest;
- all integrations: unchanged 63/44/19, Locking Redis once on Jest.

The remaining-Jest inventory removes exactly the empty Locking Redis unit
entry and adds nothing. Its digest becomes
`fc107ce908df6f9a0ab7d2f9233f4360bf775fddcb2c2c105c62c685b13f62f1`;
manifest scripts move 108 to 107 while owners/configs/API files remain
68/68/406.

Validation passes zero-unit discovery, direct no-pass failure,
baseline/current source identity, protected hashes, exact one-line diff,
package build/alias resolution, frozen offline install, all 86 workspace
dependency-policy checks, unit/integration graphs, exact inventory, formatting,
diff hygiene, and the complete 235.5-second test-runner foundation. No Redis
process was started and no machine service was reconfigured. The foundation
does not substitute for the deliberately unrun Redis integration.

This turn changes unit manifest ownership only. It does not advance the
Locking Redis integration runner, package-private merge preparation, catalog
strategy, dependency/lockfile ownership, persistence, production runtime,
workerd, D1, or the Cloudflare bundle. No root/workflow or hosted result changes.

The next package-management slice is Turn 41 only: add an opt-in Locking Redis
integration Vitest shadow while retaining the exact Jest default. Supply a real
isolated Redis service and prove assertion-level parity and cleanup before
accepting the shadow. Do not cut over the default, remove Jest ownership,
change root/workflow sharding, or combine catalogs, private-package work,
production Redis, workerd, D1, or Cloudflare changes.

## Locking Redis Natural-Exit Jest Ownership

Commit:

- This commit (`fix: clean up Locking Redis test lifecycle`)

Date verified: 2026-07-12.

Affected package-management boundary:

- `@medusajs/locking-redis` keeps Jest as authoritative
  `test:integration` ownership and removes only `--forceExit` from that command;
- no Vitest shadow/default/rollback key is added in this prerequisite turn;
- the existing spec retains six original cases and adds one focused late-lock
  cleanup regression, so the authoritative result is now 1 file / 7 tests;
- Jest config, tsconfig, `ioredis: ^5.4.1`, framework `workspace:*` edges,
  package metadata/public state, root scripts, workflow, and lockfile remain
  unchanged;
- no catalog, override, importer, private-package, repository-merge, or package
  publication change is combined with the lifecycle fix.

The accepted manifest command is:

```text
jest --passWithNoTests --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

Its normalized manifest hash is
`86a6e86f4c04440f692aacb7270901847d11d97b859f769a92f0398b47974228`.
The raw lockfile remains
`40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.

The remaining-Jest baseline changes the one manifest command from force-exit
to natural-exit and records additive Jest API calls in the already active Redis
integration file. It remains exact at 68 configs, 107 scripts across 68 owners,
and 406 API files, with digest
`6fc3f7d4842045b671b2f344448c651b76e09c247064dca81837568db23a0b51`.

Task graphs remain scoped unit 1/0/1, general unit 83/63/20, serial unit 2/2/0,
fast integration 49/30/19, and all integration 63/44/19. Locking Redis remains
owned once by Jest in fast/all integration graphs. No generic-shard exclusion
or dedicated CI job is introduced.

Validation proves the exact natural-exit command at 7/7, open-handle detection,
`/3` execution at 7/0/0, isolated database/key/socket cleanup, a closed-
PostgreSQL independence probe, affected builds, frozen offline install, all 86
workspace-link checks, exact inventory, Cloudflare typecheck/import guards, and
the complete 233.6-second shared foundation. The temporary service provenance
and cleanup are recorded in `test-runner-migration.md`; hosted workflow
execution remains deferred.

Turn 42, recorded below, is the separate Locking Redis integration Vitest
shadow. It retains the natural-exit Jest command, provisions a new isolated
service, and proves exact seven-case parity without a default cut-over or any
catalog, private-package/merge, dependency/lockfile, production Redis, workerd,
D1, or Cloudflare runtime change.

## Locking Redis Opt-in Vitest Manifest Ownership

Commit:

- This commit (`test: add Locking Redis integration Vitest shadow`)

Date verified: 2026-07-12.

Affected package-management boundary:

- `@medusajs/locking-redis` retains its byte-identical natural-exit Jest
  `test:integration` default;
- it adds only
  `test:integration:vitest: vitest run --config vitest.integration.config.mts`;
- no `test:integration:jest` rollback key exists until cut-over;
- the package adds one canonical config and changes only the spec's dynamic
  resolver from the raw source directory to the built workspace package;
- Vite 8.1.4 and Vitest 4.1.10 are reused from the root toolchain;
- version/public state, `ioredis: ^5.4.1`, framework `workspace:*` edges,
  root/workflow/tooling ownership, dependencies, and lockfile remain unchanged;
- no catalog, override, importer, package privacy, publication, or repository-
  merge change is combined with the shadow.

The manifest commands are:

```text
test:integration         jest --passWithNoTests --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The manifest normalized hash moves from
`86a6e86f4c04440f692aacb7270901847d11d97b859f769a92f0398b47974228`
to `a44b3fa8762e1e767cb9404d342502e410b9cb5e87c5682e819aac84bc1b8c25`.
The resolver-only spec hash becomes
`71ba55deaa77220ed6bb4ce47751d5099c10255b0ec76ca77be5a1de21ae7ab7`,
and the new config hash is
`69b01480ab6cce348730a134543f7c5ef37a29f23f55f54e787cac831d7eb632`.
The root manifest, workspace file, workflow, and raw lockfile remain
`ddea099bc0d49a4334d9809f2252c50fd9081b9757988fd09ceb7914bc3dd369`,
`9d6f93ab070a82d1de245eaf4ac949b14fe0a0dc0b2f67fbb040fb7f4960d731`,
`c745b0b3e49bac055e3eb8b2496701918657970f073f5ad21619eec678067411`,
and `40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.

The remaining-Jest inventory has zero delta. It stays exact at 68 configs, 107
scripts across 68 owners, and 406 API files with digest
`6fc3f7d4842045b671b2f344448c651b76e09c247064dca81837568db23a0b51`;
the baseline file is untouched.

Task graphs remain all units 85/65/20, scoped units 1/0/1, general units
83/63/20, serial units 2/2/0, fast integration 49/30/19, slow integration 5/5/0,
and all integration 63/44/19. Locking Redis remains owned once by Jest in
fast/all graphs; the opt-in Vitest key has no root/Turbo/workflow owner. No
generic exclusion or dedicated job is added in the shadow.

Validation proves clean build and `dist/index.js` resolution, standalone strict
config typecheck, exact pre-Jest/post-Jest/Vitest seven-case parity, exact
default and shadow commands, list and shard behavior, isolated Redis cleanup,
closed-PostgreSQL independence, frozen offline install, all 86 workspace links,
unchanged inventory/graphs, Cloudflare typecheck/import guards, and the complete
236.7-second foundation. The temporary service provenance and cleanup are
recorded in `test-runner-migration.md`.

No project-repository remote/connector access, push, workflow edit, or hosted
Actions run occurs. Existing generic workflow Redis/Jest ownership remains
unchanged; local third-party service parity does not prove its Redis image/engine
or hosted aggregate execution.

## Locking Redis Vitest Default And Dedicated CI Ownership

Commit:

- `f980a459ef` (`test: cut over Locking Redis integration to Vitest`)

Date verified: 2026-07-13.

Affected package-management boundary:

- `@medusajs/locking-redis` promotes its existing
  `vitest run --config vitest.integration.config.mts` command to
  `test:integration`;
- the byte-identical natural-exit Jest command moves to
  `test:integration:jest`, with no `--forceExit`;
- the temporary `test:integration:vitest` shadow key is removed;
- `ioredis: ^5.4.1`, both framework `workspace:*` edges, package version/public
  state, config files, test source, and production source remain unchanged;
- the root fast-integration script excludes only Locking Redis because its sole
  Vitest file fails closed when the generic workflow forwards `/3`;
- the root persistent tooling typecheck registers the Redis config exactly once;
- slow and unsharded all-packages commands remain unchanged;
- no dependency, importer, override, catalog, package-privacy, publication,
  merge-preparation, or lockfile change is combined with the cut-over.

The manifest commands are now:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

Normalized hashes are:

- package manifest before cut-over:
  `a44b3fa8762e1e767cb9404d342502e410b9cb5e87c5682e819aac84bc1b8c25`;
- package manifest after cut-over:
  `7b9563f7b17177621e4b6fe503703c0d3b59609682715b1c30c06957b1687e1e`;
- root manifest after exact filter/typecheck appends:
  `15edb7a673a0490c8172b1c632c1174708ed929aa7e2777e82daf3ab3640b5b1`;
- unchanged workspace file and raw lockfile:
  `9d6f93ab070a82d1de245eaf4ac949b14fe0a0dc0b2f67fbb040fb7f4960d731`
  and `40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.

The workflow adds a runner-neutral, unsharded `locking-redis-integration` job.
It depends on setup, restores dependencies and the shared build artifact, owns
only the existing Redis image/health/port shape, and runs the package default
with `REDIS_URL=redis://127.0.0.1:6379`. It has no matrix, shard, CPU probe,
PostgreSQL service, or runner-named command. Artifact download is required by
the unchanged `@medusajs/locking-redis` to `dist/index.js` resolver.

The package aggregate adds the job to `needs` and handles its failure,
cancelled, skipped, and success states under `always()`. The generic package
matrix keeps its Redis service because other Redis-backed work remains. The
workflow normalized hash is
`674cfbe4d288e04d6a70138aa7263fd41d52a7b5d8986628fd0036f896243e56`.
The strict typed workflow/package contract also rejects job/step-level
`continue-on-error` failure masking and has hash
`66e89c9bf95873a450e24db410c0bbff4f551093560684bc49e54e1621100978`.

Task graphs become:

- all/scoped/general/serial units: 85/65/20, 1/0/1, 83/63/20, and 2/2/0;
- fast integrations: 48/29/19, with Locking Redis absent;
- slow integrations: unchanged 5/5/0;
- all integrations: unchanged 63/44/19, owning Locking Redis once through the
  Vitest default.

The remaining-Jest inventory accepts exactly one script-key move from
`test:integration` to `test:integration:jest`. Counts remain 68 configs, 107
scripts across 68 owners, and 406 API files; the digest becomes
`43230df4bd1e5594fe39362f107171e0b6dbe73f79a4fd5f96753a77180b4611`.

Validation passes fresh isolated Redis default/rollback parity and cleanup,
package build, persistent strict tooling typecheck, eight typed contracts,
frozen offline install across all 86 projects, workspace dependency checks, all
dry graphs, exact inventory, Cloudflare typecheck/import guards, and the full
253-second test-runner foundation. The service-backed evidence and provenance
are recorded in `test-runner-migration.md`.

Local workflow parsing does not prove GitHub-hosted scheduling, cache/artifact
transfer, the floating Redis image/engine, aggregate execution, or production
Redis. No project-repository connector or git remote access, push, or hosted
Actions run occurred. No catalog, package privacy, merge preparation,
dependency/lockfile, production Redis, PGlite, workerd, D1, or Cloudflare
runtime change is included.

## API Key Unit Vitest Shadow

Commit:

- `68504ce7b3` (`test: shadow API Key unit lane with Vitest`)

Date verified: 2026-07-14.

The pre-edit audit corrected the planned one-file shorthand: API Key's Jest unit
command discovers the static-manifest spec and an unsuffixed noop suite. Both
remain owned by the exact default Jest command. The package adds only:

```text
test:vitest  vitest run --config vitest.config.mts
```

The new canonical Node config mirrors all four package aliases and limits
discovery to `src`. The exact `test`, `test:integration`, build/watch/migration
scripts, package version/public metadata, exports, `workspace:*` edges,
dependencies, and peer dependencies remain unchanged. No dependency, importer,
override, catalog, package-privacy, publication, merge-preparation, or lockfile
change is combined with the shadow.

The root manifest, workflow, Turbo configuration, and persistent tooling script
are unchanged. The opt-in key has no root or hosted owner. All/scoped/general/
serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and 2/2/0. Fast/slow/all
integration graphs remain 48/29/19, 5/5/0, and 63/44/19, with API Key's
PostgreSQL-backed integration command still owned once by Jest in fast/all.

Both Jest and Vitest pass the existing CI-shaped four-way unit commands at
1/1/0/0 because the workflow already supplies `--passWithNoTests`. No exclusion,
dedicated job, aggregate change, connector, remote repository, or GitHub access
is needed for this shadow. Hosted execution is not claimed.

The remaining-Jest inventory is byte-identical at digest
`43230df4bd1e5594fe39362f107171e0b6dbe73f79a4fd5f96753a77180b4611`,
68 configs, 107 scripts across 68 owners, and 406 API files. Frozen offline
install reports all 86 projects up to date; workspace policy confirms all local
edges across 86 workspace manifests use `workspace:*`; the raw lockfile stays
`40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.

Validation passes exact two-file/two-test reporter parity, direct default and
shadow commands, Vitest list, all unit shards, package build, strict config
typecheck, all dry graphs, workspace policy, exact inventory, Cloudflare
type/import guards, isolated integration foundation, and the complete shared
test-runner foundation. Service and low-disk retry provenance are recorded in
`test-runner-migration.md`.

## API Key Unit Vitest Cut-over

Commit:

- `a3cfe7b644` (`test: switch API Key unit lane to Vitest`)

Date verified: 2026-07-14.

API Key's package manifest now owns this exact split:

```text
test              vitest run --config vitest.config.mts
test:jest         jest --bail --forceExit --testPathPattern=src
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The temporary `test:vitest` key is gone. The former Jest default is retained
byte-for-byte under `test:jest`, and the integration key remains byte-for-byte
Jest-authoritative. The existing API Key Vitest config is now registered once
in root `typecheck:test-runner-tooling`. No dependency, importer, override,
catalog, package-privacy, publication, merge-preparation, Turbo, workflow, or
lockfile change is combined with the cut-over.

Normalized-LF ownership hashes are:

- API Key package manifest:
  `98ed584b7b6c8490b8f01738e0d23161448c8536a3f422ff587344d78d5139a7`;
- root manifest:
  `da7f9cef83fc23e15ad534a105b1f4d169aba5037b10091b479f74b44c704722`;
- regenerated inventory file:
  `07481e892ad6da4853252a102a0f3afb0142a937f60b859644ec208b167cb1f3`;
- unchanged workspace and lockfile:
  `9d6f93ab070a82d1de245eaf4ac949b14fe0a0dc0b2f67fbb040fb7f4960d731`
  and `40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.

The reviewed remaining-Jest ownership delta removes only API Key's unit command
from key `test` and adds the identical value at `test:jest`. Its digest is now
`eebfb1b76932592649e260810e19e746d3f97f009b95b93b21e8782092d4af3d`;
counts remain 68 configs, 107 scripts across 68 owners, and 406 API files.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0, but API Key's one executable unit task now invokes Vitest. Fast/slow/all
integration graphs remain 48/29/19, 5/5/0, and 63/44/19; API Key integration
is still owned once by Jest in fast/all. The exact root CI-shaped `/4` command,
direct Vitest default, and direct Jest rollback all pass at 1/1/0/0. No filter,
dedicated job, aggregate edit, project connector, remote repository access, or
hosted execution is needed or claimed.

Validation passes exact pre/post/rollback reporter parity, unsharded unit and
integration list-only discovery, strict persistent tooling, API Key build,
frozen offline install across all 86 projects, exact `workspace:*` policy, all
seven dry graphs, exact inventory, all three Cloudflare gates, and the complete
243-second shared runner foundation. Registry and local versions remain Vite
8.1.4 and Vitest 4.1.10 without a dependency or lockfile edit.

## API Key Integration Vitest Shadow Ownership

Commit:

- `8e299ab14b` (`test: add API Key integration Vitest shadow`)

Date verified: 2026-07-14.

API Key's package manifest now owns this exact command split:

```text
test                      vitest run --config vitest.config.mts
test:jest                 jest --bail --forceExit --testPathPattern=src
test:integration          jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
test:integration:vitest   vitest run --config vitest.integration.config.mts
```

Only `test:integration:vitest` is new. The unit default/rollback and integration
default are byte-identical to Turn 45. Root `typecheck:test-runner-tooling` adds
the new config exactly once; the existing PGlite script adds an explicit API Key
Vitest capability mapping. There is no root parity command, Turbo filter,
workflow edit, dedicated CI job, dependency, importer, override, lockfile,
catalog, package-privacy, publication, or repository-merge change.

Normalized-LF ownership hashes are:

- API Key package manifest:
  `a622569e1a79a187b17d16a8944c0c6e558f15305a73abb7ad2e3da8da3298b4`;
- root manifest:
  `fb047a3e0dd4d1447d39eba98fe7f916db61af7a27a9b9ec9e726057d254f14f`;
- new integration config:
  `27209ecc3e77d13c47bb8456a18ac2477b77ef7c1712b00543c75349a6ce27b8`;
- regenerated inventory file:
  `0a2586f3552082cdd53e6b8d79b3ee203c0fa32b4b311c5c0821b89be04ceaea`;
- unchanged workspace, lockfile, and workflow:
  `9d6f93ab070a82d1de245eaf4ac949b14fe0a0dc0b2f67fbb040fb7f4960d731`,
  `40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`,
  and `674cfbe4d288e04d6a70138aa7263fd41d52a7b5d8986628fd0036f896243e56`.

The accepted inventory digest is
`5aec0543df3abfa78f8b5932130c003d49895f57149b17ff4dc6452b63ab6235`.
Counts remain 68 configs, 107 scripts across 68 owners, and 406 API files; both
foundation Jest-API files remain explicitly owned.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0. Fast/slow/all integration graphs remain 48/29/19, 5/5/0, and 63/44/19.
API Key is owned once by Vitest for units and once by Jest for integration in the
generic graphs. The opt-in integration shadow has no Turbo or workflow owner.
Its real one-file Vitest `/3` execution exits 1 because shards outnumber files,
so no hosted-CI claim is made.

Validation passes both API Key PGlite selectors, exact six-quadrant backend/
runner parity, package build and unit default/rollback, strict tooling and nine
tooling tests, frozen offline install across 86 projects, exact `workspace:*`
policy, all seven graphs, inventory, all three Cloudflare gates, and the complete
287.4-second shared runner foundation. Installed versions remain Vite 8.1.4 and
Vitest 4.1.10 without a dependency or lockfile edit.

The next package-management slice is Turn 47 only: switch the integration
default after fresh parity, retain the old command at `test:integration:jest`,
exclude API Key from the generic fast `/3` graph, and add a dedicated unsharded
job plus aggregate ownership. Keep both Jest rollbacks, dependencies, lockfile,
catalogs, privacy, publication, and repository-merge work unchanged.

## API Key Integration Vitest Default Ownership

Commit:

- `62c89b3ad6` (`test: switch API Key integration to Vitest`)

Date verified: 2026-07-14.

API Key's final Turn 47 command split is:

```text
test                      vitest run --config vitest.config.mts
test:jest                 jest --bail --forceExit --testPathPattern=src
test:integration          vitest run --config vitest.integration.config.mts
test:integration:jest     jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The shadow key is removed and the former integration default is retained
byte-for-byte. Root package management changes only the existing fast command by
appending `--filter=!./packages/modules/api-key`; strict config ownership remains
exactly once. Slow and unsharded all commands, Turbo configuration, dependencies,
importers, overrides, lockfile, catalogs, package privacy, publication, and
repository-merge preparation remain unchanged.

The workflow adds one direct, unsharded `api-key-integration` job with PostgreSQL
and the package default command. The package aggregate requires it and propagates
all terminal states. There is no matrix, shard, runner-named command, new root
verifier/script, or hosted result. The parsed tooling contract protects the
exact job/service/steps and aggregate shape.

Ownership hashes before/after are:

- API Key manifest:
  `a622569e1a79a187b17d16a8944c0c6e558f15305a73abb7ad2e3da8da3298b4`
  to `c30c426a2be57ee6562f07349357a3c94d989cdcc2e3e873b707c85d28a0e850`;
- root manifest:
  `fb047a3e0dd4d1447d39eba98fe7f916db61af7a27a9b9ec9e726057d254f14f`
  to `63628f1f1a95973a977def1ccb24e02be7ca2a015c833092d1ceff434bdd30bb`;
- PGlite script:
  `fa1397b37eb2910e161cdf3b9d0e2ef85e8e9368f651f071125b7cc02e647628`
  to `86590a32be51db419d33054c29fa18599ff6781289b6324aeb7e59666e5008bd`;
- tooling contract:
  `153e44c01438e4f38fb63762d5dd79e1a366fdd1f0e9121d0d36db93c8cf72e6`
  to `858a82792fb6dc2c8c89c38f1392d61f5b0653697b4708b152a7f7aad5db66fe`;
- inventory file:
  `0a2586f3552082cdd53e6b8d79b3ee203c0fa32b4b311c5c0821b89be04ceaea`
  to `ae6c07deb5bcd6b02ccf4260adb59657ad6fcede3a35e3e2f9000b5b6287e95d`;
- workflow:
  `674cfbe4d288e04d6a70138aa7263fd41d52a7b5d8986628fd0036f896243e56`
  to `cae2adb1e7bdd055614c2f6d16494da915e24b85ab00ccf97f5e5748496ebc71`.

Workspace and lockfile remain
`9d6f93ab070a82d1de245eaf4ac949b14fe0a0dc0b2f67fbb040fb7f4960d731`
and `40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.
Inventory digest becomes
`2d775e3a998ccba2b88231bca95377c84ab0da1ee5601b2eb9aa8e51f98d5fa0`
with unchanged 68 configs, 107 scripts across 68 owners, 406 API files, and two
foundation Jest-API files.

Dry ownership remains 85/65/20, 1/1/0, 83/63/20, and 2/2/0 for unit graphs.
Fast integration moves to 47/28/19 with API Key absent; slow remains 5/5/0; all
remains 63/44/19 with API Key exactly once on Vitest. Frozen offline install
across all 86 projects, exact `workspace:*` policy, package build/unit rollback,
strict tooling, inventory, Cloudflare gates, and the 276.9-second foundation all
pass. Vite 8.1.4 and Vitest 4.1.10 remain installed without package-resolution
changes.

## Translation Unit Vitest Shadow Ownership

Commit:

- `0c8ea06b00` (`test: shadow Translation unit lane with Vitest`)

Date verified: 2026-07-14.

Translation's package manifest retains both authoritative Jest values
byte-for-byte and adds one opt-in command:

```text
test              jest --passWithNoTests --bail --forceExit --testPathPattern=src
test:vitest       vitest run --config vitest.config.mts
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The only implementation ownership changes are the one manifest key and new
package-local config. The config consumes the existing shared Node/forks/SWC
profile, canonical source discovery, absolute root, and Translation's five
existing aliases without a setup file or legacy Jest bridge. No root manifest,
dependency, importer, override, catalog, package privacy, publication,
repository-merge preparation, PGlite mapping, workflow, or lockfile changes.

Normalized-LF ownership hashes are:

- Translation manifest before/after:
  `03118ea57a6965bfd4d6611c1f43b81e92cd9929569e354a8fcb468469a0c44b`
  and `306a1e9abc2be602cf371ecdead6a74ca616958665e8269899b839432a5a68cc`;
- new Vitest config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- unchanged root manifest, workspace, lockfile, inventory, workflow, and PGlite
  orchestrator:
  `63628f1f1a95973a977def1ccb24e02be7ca2a015c833092d1ceff434bdd30bb`,
  `9d6f93ab070a82d1de245eaf4ac949b14fe0a0dc0b2f67fbb040fb7f4960d731`,
  `40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`,
  `ae6c07deb5bcd6b02ccf4260adb59657ad6fcede3a35e3e2f9000b5b6287e95d`,
  `cae2adb1e7bdd055614c2f6d16494da915e24b85ab00ccf97f5e5748496ebc71`,
  and `86590a32be51db419d33054c29fa18599ff6781289b6324aeb7e59666e5008bd`.

The remaining-Jest inventory is byte-identical at digest
`2d775e3a998ccba2b88231bca95377c84ab0da1ee5601b2eb9aa8e51f98d5fa0`,
68 configs, 107 scripts across 68 owners, and 406 API files. Translation remains
owned once on Jest in all/scoped/general unit graphs and fast/all integration
graphs. The manual Vitest key has no root, Turbo, workflow, shard, or aggregate
owner.

Frozen offline install across all 86 projects, exact `workspace:*` policy,
Translation build, standalone strict config typecheck, exact Jest/Vitest parity,
all eight `/4` commands, all seven graphs, Cloudflare gates, inventory, and the
complete 262.3-second foundation pass. Vite 8.1.4 and Vitest 4.1.10 remain
installed without package-resolution changes.

The next package-management slice is Turn 49 only: switch Translation's unit
default to Vitest, retain its exact old Jest value at `test:jest`, remove the
temporary shadow key, and register the config once in root strict tooling. Keep
Translation integration/PGlite/workflow ownership, API Key rollbacks,
dependencies, lockfile, catalogs, privacy, publication, and merge work
unchanged.

## Translation Unit Vitest Default Ownership

Commit:

- `dc36f4cf40` (`test: switch Translation unit lane to Vitest`)

Date verified: 2026-07-15.

Translation's final Turn 49 command split is:

```text
test              vitest run --config vitest.config.mts
test:jest         jest --passWithNoTests --bail --forceExit --testPathPattern=src
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The temporary unit shadow key is removed and the former unit default is retained
byte-for-byte at `test:jest`. Root package management changes only the existing
strict test-runner tooling command by adding the existing Translation config
exactly once. No new root script, verifier, tooling-contract source, workflow
owner, dependency, importer, override, catalog, package privacy/publication,
merge-preparation, or lockfile change is included.

Normalized-LF ownership hashes before/after are:

- Translation manifest:
  `306a1e9abc2be602cf371ecdead6a74ca616958665e8269899b839432a5a68cc`
  to `499021a976bc0c3a750788465b0ab17a35353b025e5398823434e7eca7217c39`;
- root manifest:
  `63628f1f1a95973a977def1ccb24e02be7ca2a015c833092d1ceff434bdd30bb`
  to `044322509ea41f6c17c51b681248f0a3284f6606c4447d3f11a2998f7fd59cbf`;
- remaining-Jest inventory file:
  `ae6c07deb5bcd6b02ccf4260adb59657ad6fcede3a35e3e2f9000b5b6287e95d`
  to `8ce2ad53831d57160e39312d79d2614c2289beda7205613882d0bf8ed699aa91`.

Workspace and lockfile remain
`9d6f93ab070a82d1de245eaf4ac949b14fe0a0dc0b2f67fbb040fb7f4960d731`
and `40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.
Workflow and PGlite orchestrator remain
`cae2adb1e7bdd055614c2f6d16494da915e24b85ab00ccf97f5e5748496ebc71`
and `86590a32be51db419d33054c29fa18599ff6781289b6324aeb7e59666e5008bd`.

The remaining-Jest inventory moves only the byte-identical Translation unit
command from key `test` to `test:jest`. Counts remain 68 configs, 107 scripts
across 68 owners, and 406 API files; the accepted digest becomes
`c41c83b8cfeee131d905cf5305199b1ba09636721e63fe39e07773c47b72e33f`.
No dependency graph or package-resolution state changes.

Unit dry ownership remains 85/65/20, 1/1/0, 83/63/20, and 2/2/0, with only
Translation's runner changing from Jest to Vitest. Integration ownership remains
47/28/19, 5/5/0, and 63/44/19 with Translation still on Jest. Package/direct
Turbo `/4` probes pass 1/0/0/0 because the existing workflow forwards
`--passWithNoTests`; no dedicated workflow job is required.

Exact four-state unit parity, Translation build/post-build discovery/default,
strict tooling, frozen offline install across all 86 projects, exact
`workspace:*` policy, inventory, all seven graphs, all Cloudflare gates, and the
complete 534.9-second foundation pass. Vite 8.1.4 and Vitest 4.1.10 remain
installed without package-resolution changes. The 2026-07-21 registry refresh
reports Vite 8.1.5 while Vitest and coverage remain current at 4.1.10; the Vite
patch belongs to the separate Turn 50 baseline refresh.

## Vite 8.1.5 Package Baseline

Commit:

- `c11241db2c` (`test: refresh Vite baseline to 8.1.5`)

Date verified: 2026-07-30.

The package-management source of truth for Vite is one central override and
four direct manifest owners, not a pnpm catalog:

```text
pnpm-workspace.yaml                                overrides.vite
package.json                                       devDependencies.vite
apps/medusa-cloudflare/package.json                devDependencies.vite
packages/admin/admin-bundler/package.json          dependencies.vite
packages/admin/admin-vite-plugin/package.json      devDependencies.vite
```

All five ranges move from `^8.1.4` to `^8.1.5`. Vitest and
`@vitest/coverage-v8` remain `^4.1.10`. A fresh 2026-07-30 npm-registry read,
local binaries, and all installed owners agree on Vite 8.1.5 and
Vitest/coverage 4.1.10.

The pnpm 11 lock now resolves 39 Vite 8.1.5 peer contexts and no Vite 8.1.4
context. Vite 8.1.5 requires PostCSS `^8.5.17`, so the shared resolution moves
from 8.5.16 to 8.5.20 and adds NanoID 3.3.16. Rolldown remains 1.1.5. Other
lock changes are pnpm peer-context normalization rather than new direct ranges.

Regeneration linked the admin Vite plugin's exact `fdir@6.1.1` optional peer to
Picomatch 4, exposing its Picomatch-3-only declaration in `pnpm peers check`.
The package now owns current `fdir@6.5.0`, whose peer range accepts Picomatch 3
or 4. Its unchanged tests and real admin consumers pass. The peer audit is back
to only four pre-existing unrelated mismatch groups: legacy Rollup plugins,
`eslint-plugin-unused-imports`, `tailwindcss-animate`, and the AWS SDK pair.
There is no Vite, Vitest, coverage, Storybook, Cloudflare, fdir, or Picomatch
mismatch.

Normalized-LF hashes move as follows:

- workspace:
  `9d6f93ab070a82d1de245eaf4ac949b14fe0a0dc0b2f67fbb040fb7f4960d731`
  to `c3d56ab0ac3486655845f4c728c09afae0e30cad039b887800d12f4634aa7fda`;
- root:
  `044322509ea41f6c17c51b681248f0a3284f6606c4447d3f11a2998f7fd59cbf`
  to `45949d7478f6e80a69936744920d4cd161cd30e4ecbf106df4839a561c48404f`;
- Cloudflare app:
  `46553232ab3eab1a0e177bd35ed3dac2ab3ea65e7ff1a5b9e0dedc40b59afbe2`
  to `bae98cca57cddc4b44f47289bd599bdcf84bf01785dba136e11064cf70195226`;
- admin bundler:
  `18a14c02dcba9473095966b6cc1ecbf47a322dd0499122e7edd8bcb841fbb8e4`
  to `97e72d53d75ffeb2d0c9ca852d6254a5d7839d7eab42aa45d76c07031b355996`;
- admin Vite plugin:
  `21961c4d23214f618dafa1361bc796732216159b7a1191187648aec47fa3edca`
  to `6417dbf5c304866d3747abb6bcf82f14a830e3c35cff9bfaa2057a8ddf380085`;
- lockfile:
  `40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`
  to `1e50ff0e0386d22e8c070181aa73312971fe89684e99068dcdeea30045007277`.

Lockfile-only generation and a frozen install pass across all 86 workspaces
with supply-chain policy enforcement. Exact `workspace:*` policy, all migrated
runner lanes, coverage, PGlite cross-runner proofs, admin/Storybook/Cloudflare
build consumers, Cloudflare portability gates, workerd Currency/D1 behavior,
and the final 293.1-second foundation pass. Remaining-Jest inventory, workflow,
PGlite orchestration, test scripts/configs/sources, assertions, runner
ownership, persistence/runtime behavior, privacy/publication, and merge
preparation remain unchanged.

## Translation Integration Vitest Shadow Ownership

Commit:

- `e07b25bebc` (`test: add Translation integration Vitest shadow`)

Date verified: 2026-07-30.

Translation's package-management boundary now owns this command split:

```text
test:integration         jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

Jest remains authoritative. The root manifest changes only the existing strict
test-runner tooling command by registering the new package-local integration
config exactly once. There is no new root test command, dependency, importer,
override, catalog, package privacy/publication, workflow owner, or lockfile
change.

Normalized-LF ownership hashes are:

- Translation manifest:
  `499021a976bc0c3a750788465b0ab17a35353b025e5398823434e7eca7217c39`
  to `76a9a09b8cef48bd0f90bbb68ab50a86f720e4356910517e3521e9b5c7a401b1`;
- root manifest:
  `45949d7478f6e80a69936744920d4cd161cd30e4ecbf106df4839a561c48404f`
  to `23b631693e6237e2b02c41715d8bcc6c89db08a5d5e570b7b64d064da25f91b3`;
- new integration config:
  `ce18dae67e8247368ae9afed93d7421cf50359a82908a76dfe0ee0f0b53e3439`;
- PGlite orchestrator:
  `86590a32be51db419d33054c29fa18599ff6781289b6324aeb7e59666e5008bd`
  to `99dc14d61bc81c86c11d9011a4bf97b725faa75a51f1e5871fdb63f061afec11`;
- inventory file:
  `8ce2ad53831d57160e39312d79d2614c2289beda7205613882d0bf8ed699aa91`
  to `6e8d288c617d99af0ceb7d2ad8808951f0621d895d493e305991069f5c1d1c33`.

The workspace and lockfile remain
`c3d56ab0ac3486655845f4c728c09afae0e30cad039b887800d12f4634aa7fda`
and `1e50ff0e0386d22e8c070181aa73312971fe89684e99068dcdeea30045007277`.
The workflow remains
`cae2adb1e7bdd055614c2f6d16494da915e24b85ab00ccf97f5e5748496ebc71`.

Remaining-Jest counts remain 68 configs, 107 scripts, and 406 API files at
accepted digest
`a2c432f27f7510d7871b1b8251d4bea2f293511e7a8dfa960eaff99f6ff91b96`.
All seven task graphs preserve the existing 85/65/20, 1/1/0, 83/63/20,
2/2/0, 47/28/19, 5/5/0, and 63/44/19 ownership shapes. Vite 8.1.5 with
built-in Rolldown and Vitest/coverage 4.1.10 are reused without package
resolution changes.

Frozen offline install across all 86 projects, exact `workspace:*` policy,
Translation package commands, three-backend parity, full runner foundation,
inventory, and Cloudflare portability/workerd gates pass.

## Translation Integration Vitest Default Ownership

Commit:

- `0eeb819d16` (`test: switch Translation integration to Vitest`)

Date verified: 2026-07-30.

Translation's final command split is:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The temporary shadow key is removed. Root package management changes only the
fast integration filter by adding
`--filter=!./packages/modules/translation`; the strict tooling registration is
unchanged. The workflow adds one unsharded PostgreSQL owner and stable aggregate
propagation. No dependency, importer, override, catalog, package privacy,
publication, or lockfile change is included.

Normalized-LF ownership hashes are:

- Translation manifest:
  `76a9a09b8cef48bd0f90bbb68ab50a86f720e4356910517e3521e9b5c7a401b1`
  to `8eb01d7954721cb1c1b22d11d1bf9afcc579ced35012599039ff60eb35038cf8`;
- root manifest:
  `23b631693e6237e2b02c41715d8bcc6c89db08a5d5e570b7b64d064da25f91b3`
  to `39eb416b94c8f48cc88f690c0550e22e7b7330a58611b00681c861aae518602a`;
- workflow:
  `cae2adb1e7bdd055614c2f6d16494da915e24b85ab00ccf97f5e5748496ebc71`
  to `d75101499b4ac60f38b6918ad965bd7a941d35d24d99b6c4e8e01a50fe3116e0`;
- PGlite orchestrator:
  `99dc14d61bc81c86c11d9011a4bf97b725faa75a51f1e5871fdb63f061afec11`
  to `225849e0794ee04133ffa3b8c62b9eff2a098db4d474925fb8a29028c1076fb2`;
- inventory:
  `6e8d288c617d99af0ceb7d2ad8808951f0621d895d493e305991069f5c1d1c33`
  to `9de145966b8db11c147f24d7063f729c72141280e8c5629604331c82fb01d194`.

Workspace and lockfile remain
`c3d56ab0ac3486655845f4c728c09afae0e30cad039b887800d12f4634aa7fda`
and `1e50ff0e0386d22e8c070181aa73312971fe89684e99068dcdeea30045007277`.
Remaining-Jest counts remain 68 configs, 107 scripts, and 406 API files at
accepted digest
`345a7cec5fdb071f78e9efadf91a3bdbd65e44912e14aaac1acd769d127a69e3`.

Fast integration ownership moves from 47/28/19 to 46/27/19 with Translation
absent. Slow remains 5/5/0 and unsharded all remains 63/44/19 with Translation
owned once through Vitest. Vite 8.1.5/Rolldown and Vitest/coverage 4.1.10 are
reused without package-resolution changes.

Frozen install, `workspace:*` policy, exact 12-state parity, package commands,
typed workflow/aggregate contract, full runner foundation, and Cloudflare
portability/workerd gates pass.

## Vite 8.2.0 Package Baseline

Commit:

- `f32d89b30f` (`test: refresh Vite baseline to 8.2.0`)

Date verified: 2026-07-30.

A live registry read reports Vite 8.2.0 as npm `latest`, while Vitest and
`@vitest/coverage-v8` remain 4.1.10. The package-management source of truth
remains one central override and four direct manifest ranges:

```text
pnpm-workspace.yaml                                overrides.vite
package.json                                       devDependencies.vite
apps/medusa-cloudflare/package.json                devDependencies.vite
packages/admin/admin-bundler/package.json          dependencies.vite
packages/admin/admin-vite-plugin/package.json      devDependencies.vite
```

All five ranges move from `^8.1.5` to `^8.2.0`. No Vite catalog, importer,
package privacy, publication, or local `workspace:*` edge changes.

Vite 8.2.0 was published inside the configured minimum-release-age window. Pnpm
therefore added:

```yaml
minimumReleaseAgeExclude:
  - vite@8.2.0
```

This exact exception is required for the user-requested latest stable baseline;
strict age policy remains active for every other package. Remove the exception
in a separate package-management slice after the normal age window passes.

The lock now contains 39 textual Vite 8.2.0 references across 17 Vite-bearing
snapshot keys and no Vite 8.1.5 reference. The package delta is limited to
Vite's declared closure: Rolldown 1.2.0, Lightning CSS 1.33.0, PostCSS 8.5.24,
OXC 0.140.0, platform bindings, and required EMNAPI/Wasm runtime support.
Vitest/coverage stay 4.1.10, and peer auditing retains only the same four
unrelated legacy groups.

Normalized-LF ownership hashes are:

- root manifest:
  `39eb416b94c8f48cc88f690c0550e22e7b7330a58611b00681c861aae518602a`
  to `f142205ee3b8ea1938bdc0792aedea1fae9bc366374fec557c4caa77777408a9`;
- Cloudflare app:
  `bae98cca57cddc4b44f47289bd599bdcf84bf01785dba136e11064cf70195226`
  to `7ac5329bed8612df7b624c9d73b6ec9477443f57ffc8053f2842677e06379cd6`;
- admin bundler:
  `97e72d53d75ffeb2d0c9ca852d6254a5d7839d7eab42aa45d76c07031b355996`
  to `650dc8a772402502b58fb5dfaeb5909038b391f23f12a8df662399b8dad5a484`;
- admin Vite plugin:
  `6417dbf5c304866d3747abb6bcf82f14a830e3c35cff9bfaa2057a8ddf380085`
  to `61b87d383388b9ee048555838c6e9f384bdfbd37bdbdb8a99b65bbad2e779d0a`;
- workspace:
  `c3d56ab0ac3486655845f4c728c09afae0e30cad039b887800d12f4634aa7fda`
  to `af3ec0941ce1dc79137f176286d051fd92f228f728ef0dd7ea32a4271e72cb63`;
- lockfile:
  `1e50ff0e0386d22e8c070181aa73312971fe89684e99068dcdeea30045007277`
  to `acf2fd6e54a63d40e90409289825716a6f4ff42e2c37432b3c8834c141d1ce80`.

Follow-up commit `b6071d16cd` (`fix: synchronize Vite 8.2 lock metadata`)
corrects pnpm's effective override metadata after final review found five stale
Vite 8.1.5 importer specifiers. Canonical lock generation also updates eleven
peer-range metadata entries from `^8.1.5` to `^8.2.0`; resolved package and
snapshot keys remain unchanged. The corrected lock hash is
`2c9390dce87526e7f8ecef2c808f57ec2659befa0387bf88fb772c877c5204fe`,
with 39 Vite 8.2.0 references and zero Vite 8.1.5 exact or range references.
Frozen offline installation and supply-chain policy now pass against the
corrected committed metadata.

Frozen install/supply-chain policy across all 86 projects, exact
`workspace:*` policy, original Vitest tests and coverage, admin/Storybook/
Cloudflare build consumers, all task graphs, exact inventory, complete runner
foundation, Cloudflare import audits, and workerd Currency/D1 behavior pass.

## Settings Unit Vitest Shadow Ownership

Commit:

- `7360cb4030` (`test: shadow Settings unit lane with Vitest`)

Date verified: 2026-07-30.

Settings retains both authoritative Jest commands byte-for-byte and adds one
manual package-local shadow:

```text
test              jest --passWithNoTests --bail --forceExit --testPathPattern=src
test:vitest       vitest run --config vitest.config.mts
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The only implementation ownership changes are the one manifest key and new
package-local config. The config consumes the shared Node/forks/SWC profile,
canonical source-only discovery, an absolute package root, and Settings' five
existing Jest aliases. It has no setup file or legacy Jest bridge. No root
manifest, dependency, importer, override, catalog, package privacy,
publication, repository-merge preparation, PGlite mapping, workflow, or
lockfile changes.

Normalized-LF ownership hashes are:

- Settings manifest:
  `50a9c61938b34beced24c1b4cfeb7cab2300f76ac03a3795cd00b7f296eda1fe`
  to `5ebf3c6e1eb7bfb398b9764e0f47c855729fa31ac3b1f4bfcc2fb50cbc401b09`;
- new Vitest config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- unchanged root manifest, workspace, lockfile, inventory, workflow, and PGlite
  orchestrator:
  `f142205ee3b8ea1938bdc0792aedea1fae9bc366374fec557c4caa77777408a9`,
  `af3ec0941ce1dc79137f176286d051fd92f228f728ef0dd7ea32a4271e72cb63`,
  `2c9390dce87526e7f8ecef2c808f57ec2659befa0387bf88fb772c877c5204fe`,
  `9de145966b8db11c147f24d7063f729c72141280e8c5629604331c82fb01d194`,
  `d75101499b4ac60f38b6918ad965bd7a941d35d24d99b6c4e8e01a50fe3116e0`,
  and `225849e0794ee04133ffa3b8c62b9eff2a098db4d474925fb8a29028c1076fb2`.

The remaining-Jest inventory is byte-identical at digest
`345a7cec5fdb071f78e9efadf91a3bdbd65e44912e14aaac1acd769d127a69e3`,
68 configs, 107 scripts, and 406 API files. Settings remains owned once through
Jest in every applicable unit and integration graph. The opt-in `test:vitest`
key has no root, Turbo, workflow, shard, or aggregate owner.

Frozen offline install across all 86 projects, exact `workspace:*` policy,
Settings build, standalone strict config typecheck, exact Jest/Vitest parity,
all eight `/4` probes, all seven graphs, PGlite fail closure, the
286-second complete foundation, and all Cloudflare portability/workerd gates
pass on Vite 8.2.0, Rolldown 1.2.0, and Vitest 4.1.10.

## Settings Unit Vitest Default Ownership

Commit:

- `bd02b6d954` (`test: switch Settings unit lane to Vitest`)

Date verified: 2026-07-30.

Settings' unit ownership now reads:

```text
test              vitest run --config vitest.config.mts
test:jest         jest --passWithNoTests --bail --forceExit --testPathPattern=src
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The already-proven Vitest command becomes the package and Turbo unit default.
The byte-identical former Jest default moves to `test:jest`; the temporary
`test:vitest` key is removed. Settings' existing config is registered exactly
once in the root strict/no-unchecked tooling command. No dependency, importer,
override, catalog, package privacy, publication, PGlite capability, integration
command, workflow, or lockfile change is included.

The exact remaining-Jest ownership move is only:

```text
removed  @medusajs/settings test
added    @medusajs/settings test:jest
```

Both entries contain the same Jest command. Counts remain 68 configs, 107
scripts, and 406 API files; the accepted digest moves from
`345a7cec5fdb071f78e9efadf91a3bdbd65e44912e14aaac1acd769d127a69e3`
to `d87dc3c4caa49878ddd77802f9f0276d558c1000eebe13c44f2ce62ac9e44757`.

Normalized-LF ownership hashes move as follows:

- Settings manifest:
  `5ebf3c6e1eb7bfb398b9764e0f47c855729fa31ac3b1f4bfcc2fb50cbc401b09`
  to `8b83739025b0e6f6cf21f28762a4c05a9ceb06b78932c1c5f3b1a7851c4032c6`;
- root manifest:
  `f142205ee3b8ea1938bdc0792aedea1fae9bc366374fec557c4caa77777408a9`
  to `b6cd530ce4d1440cd31b1d53f2dfec86d6291e6d4922b4446273cc30dee60523`;
- inventory file:
  `9de145966b8db11c147f24d7063f729c72141280e8c5629604331c82fb01d194`
  to `e7d2e6a76eaacae3c964a14fab6edfd9388dbac2b318ea93540505abcef2beaa`.

The Settings config, unit/integration sources, Jest/TypeScript configs,
workspace, corrected lockfile, workflow, and PGlite orchestrator remain
`9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`,
`28415d1a9bad8360b20e458ce4bc9abc886824ff0c3c46b943d105b73f3f9dcb`,
`672ffc69ac91c98fc19ab19ccd1490f4f18157a66b8246bb3b71615aed9e9df5`,
`abe0c3cacda174ac06f22404fe754c2d9a762c311164b6f97bd23ac0cd89a470`,
`f32039f892e4b6995f132bb8679d21f3d5528dfa51cce1f96002a110de1b8f95`,
`af3ec0941ce1dc79137f176286d051fd92f228f728ef0dd7ea32a4271e72cb63`,
`2c9390dce87526e7f8ecef2c808f57ec2659befa0387bf88fb772c877c5204fe`,
`d75101499b4ac60f38b6918ad965bd7a941d35d24d99b6c4e8e01a50fe3116e0`,
and `225849e0794ee04133ffa3b8c62b9eff2a098db4d474925fb8a29028c1076fb2`.

Frozen offline install across all 86 projects, exact `workspace:*` policy,
Settings build, strict tooling, all pre/post reporter comparisons, both `/4`
runner matrices, all seven graphs, integration/PGlite fail closure, the
294.9-second foundation, and all Cloudflare portability/workerd gates pass on
Vite 8.2.0, Rolldown 1.2.0, and Vitest 4.1.10.

## Settings Integration Vitest Shadow Ownership

Commit:

- `bc15396832` (`test: add Settings integration Vitest shadow`)

Date verified: 2026-07-30.

Settings keeps its Jest integration default and adds one manual shadow:

```text
test                     vitest run --config vitest.config.mts
test:jest                jest --passWithNoTests --bail --forceExit --testPathPattern=src
test:integration         jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The new config consumes the existing serial Node integration profile, the same
five aliases as Settings' Jest/unit profiles, and one exact integration file.
It is registered exactly once in strict/no-unchecked tooling. Explicit Settings
Vitest selection is added to the serial PGlite orchestrator while its global
default remains Jest. No Turbo or workflow owner is added.

Package-management ownership moves only:

- Settings manifest:
  `8b83739025b0e6f6cf21f28762a4c05a9ceb06b78932c1c5f3b1a7851c4032c6`
  to `ba5759d30088307ca2efc38406cf820d7593ea3933533ad730e50c54bd682edd`;
- root manifest:
  `b6cd530ce4d1440cd31b1d53f2dfec86d6291e6d4922b4446273cc30dee60523`
  to `a32e1cbe30f08d39c7f0ff83bbfe75140402af6baa314b459efc998e02874cbd`;
- new integration config:
  `7a162924556ae07e68c3fd942989d8674818ad0a17c0f36cdaf3e5b8fc73fbc0`;
- PGlite orchestrator:
  `225849e0794ee04133ffa3b8c62b9eff2a098db4d474925fb8a29028c1076fb2`
  to `1696c296bc652bf75dd5c672a81c659de42f4bb3543f6c58cb1d3704b52d69bf`;
- inventory file:
  `e7d2e6a76eaacae3c964a14fab6edfd9388dbac2b318ea93540505abcef2beaa`
  to `959428f8cf0d01d1385c6b0d38d309b3ed7636dac7e49e0b371818677abd5fca`.

The accepted remaining-Jest digest moves from
`d87dc3c4caa49878ddd77802f9f0276d558c1000eebe13c44f2ce62ac9e44757`
to `336bfe35a03d775627c2dd71626121c3e1749aa7a8c4f0fc33cd6c307b23862a`
only because the two already-inventoried runner/orchestrator files changed.
Counts remain 68 configs, 107 scripts, and 406 API files; Settings' Jest
integration command remains byte-identical and inventoried.

Dependencies, importers, overrides, catalogs, package privacy/publication,
workspace, corrected lockfile, workflow, unit ownership, source assertions,
Jest/unit configs, production composition, and repository-merge preparation
remain unchanged. Frozen offline install across 86 workspaces, exact
`workspace:*`, all nine runner/backend reports, both real PGlite selectors,
all seven task graphs, the 268.8-second foundation, and all Cloudflare
portability/workerd gates pass on Vite 8.2.0, Rolldown 1.2.0, and Vitest
4.1.10.

## Settings Integration Vitest Default Ownership

Commit:

- `118ff23c15` (`test: switch Settings integration to Vitest`)

Date verified: 2026-07-30.

Settings integration ownership now reads:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The temporary shadow key is removed. The exact former Jest command remains
available at the rollback key. The PGlite orchestrator keeps Jest as its global
default and routes Settings' Jest selector to the rollback while explicit
Vitest selection invokes the package default.

Package execution ownership changes in two places:

- generic fast integration excludes `./packages/modules/settings`, moving its
  dry graph from 46/27/19 to 45/26/19;
- one runner-neutral, unsharded PostgreSQL workflow job owns the package
  default and is required by the stable package aggregate for all terminal
  states.

The all integration graph remains 63/44/19 and owns Settings once on Vitest;
slow remains 5/5/0. Unit graphs remain 85/65/20, 1/1/0, 83/63/20, and 2/2/0.
The workflow shape and exact command pass locally; this does not claim a hosted
Actions result or require GitHub repository access.

Remaining-Jest ownership moves only:

```text
removed  @medusajs/settings test:integration
added    @medusajs/settings test:integration:jest
```

The command is byte-identical. Counts remain 68 configs, 107 scripts, and 406
API files. The accepted digest moves from
`336bfe35a03d775627c2dd71626121c3e1749aa7a8c4f0fc33cd6c307b23862a`
to `85c05079e8eb99e90f64152fae9d6cdf4b584e7e346f10c9624ed5ec78ade22c`.

Normalized-LF ownership hashes move:

- root manifest:
  `a32e1cbe30f08d39c7f0ff83bbfe75140402af6baa314b459efc998e02874cbd`
  to `fcd05db692b4f7f6684baa2302d890336cb7dbd614f21d5f653a0c761549f661`;
- Settings manifest:
  `ba5759d30088307ca2efc38406cf820d7593ea3933533ad730e50c54bd682edd`
  to `6c5c40832e5cc20788b8949ebf774165c677dfe91b5cd8b33e5a271ef206c7d0`;
- PGlite orchestrator:
  `1696c296bc652bf75dd5c672a81c659de42f4bb3543f6c58cb1d3704b52d69bf`
  to `7bc65022a844a8edf2a3d611e555f92bb014235a1128d01bd25e077076616c27`;
- strict ownership contract:
  `2099eae531ba645d007b5a9964b1325947447afe0f7d5c2fd8c31fe002e86cee`
  to `ad397d05465d24251ed9330dfdadc66af524276d126b9c58ad3451b6a6d84d57`;
- inventory file:
  `959428f8cf0d01d1385c6b0d38d309b3ed7636dac7e49e0b371818677abd5fca`
  to `f98003203490cb65fa713bce21204f6f0309d420b1dd5392496b89fe8cbf91bf`;
- workflow:
  `d75101499b4ac60f38b6918ad965bd7a941d35d24d99b6c4e8e01a50fe3116e0`
  to `a08a800a72f521f819c7bcf48a50bfc43a113288a7efdcd24f431f819ae3a2ad`.

The Settings integration config, assertion source, workspace, and corrected
lockfile remain unchanged. Dependencies, importers, overrides, catalogs,
package privacy/publication, production composition, persistence
implementation, workerd/D1 behavior, and repository-merge preparation are
also unchanged.

Frozen offline install across 86 workspaces, exact `workspace:*`, all 12
runner/backend/ownership reports, both real PGlite selectors, Store fail
closure, all seven task graphs, the 295.8-second foundation, and all Cloudflare
portability/workerd gates pass on Vite 8.2.0, built-in Rolldown 1.2.0, and
Vitest 4.1.10.

## Store Unit Vitest Shadow Ownership

Commit:

- `54c2aef227` (`test: shadow Store unit lane with Vitest`)

Date verified: 2026-07-30.

Store keeps both authoritative Jest commands and adds only a manual unit
shadow:

```text
test              jest --bail --forceExit --testPathPattern=src
test:vitest       vitest run --config vitest.config.mts
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The new source-only config uses the canonical Node/forks/SWC profile and the
same five aliases as Store's Jest and TypeScript configs. It has no setup,
legacy bridge, root/Turbo/workflow owner, or integration capability.

The audit corrected the planned one-file assumption: Store owns two source
unit files, two tests, and six assertions. Exact pre/post Jest/Vitest parity is
two passed files/tests, identical full names/statuses, zero
failures/skips/todos/snapshots, and normalized digest
`90a03ed5034fa67349c6d826af88f8dc229553a33e0737150b8a7bdd6dc10c3f`.
Both runners pass the real `/4` matrix at 1/1/0/0 and cover both test signatures
exactly once.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 45/26/19,
5/5/0, and 63/44/19. Store remains Jest-owned once in every applicable unit
and integration graph. Its PGlite lane remains Jest-only and explicit Vitest
selection fails closed before spawning.

Remaining-Jest ownership is byte-identical at digest
`85c05079e8eb99e90f64152fae9d6cdf4b584e7e346f10c9624ed5ec78ade22c`,
68 configs, 107 scripts, and 406 API files.

Normalized-LF ownership hashes are:

- Store manifest:
  `188723695900f67ed0b818e705c72c590234fdcee0ba71f07d0d75f8509a67e3`
  to `6111814288334b0aee162f5428bb351284eb1eb939cd17277c99ef5c7a2506a1`;
- new Vitest config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`.

Root manifest, workspace, corrected lockfile, inventory, workflow, PGlite
orchestrator, dependencies, importers, overrides, catalogs, package
privacy/publication, production composition, persistence, workerd/D1 behavior,
and repository-merge preparation remain unchanged.

Frozen offline install across 86 workspaces, exact `workspace:*`, Store build,
standalone strict config typecheck, post-build source discovery, exact
Jest/Vitest parity, both `/4` matrices, all seven graphs, PGlite fail closure,
the 276.3-second foundation, and all Cloudflare portability/workerd gates pass
on Vite 8.2.0, built-in Rolldown 1.2.0, and Vitest 4.1.10.

## Store Unit Vitest Default Ownership

Commit:

- `4853277b69` (`test: switch Store unit lane to Vitest`)

Date verified: 2026-07-30.

Store's proven unit lane now uses:

```text
test              vitest run --config vitest.config.mts
test:jest         jest --bail --forceExit --testPathPattern=src
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The exact former Jest unit command moves only from `test` to `test:jest`, the
temporary shadow key is removed, and the existing Store config is registered
once in root strict/no-unchecked tooling. Fresh pre/post reports and both
runners' fresh pre/post `/4` matrices preserve the same two files, two tests,
six assertions, 1/1/0/0 shard shape, exact aggregate signatures, and digest
`90a03ed5034fa67349c6d826af88f8dc229553a33e0737150b8a7bdd6dc10c3f`.

All seven graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 45/26/19, 5/5/0,
and 63/44/19. Store moves to Vitest only in applicable unit graphs and remains
Jest-owned in fast/all integration. Store PGlite Vitest selection remains
fail-closed.

Remaining-Jest counts stay at 68 configs, 107 scripts, and 406 API files. The
ownership-only digest changes from
`85c05079e8eb99e90f64152fae9d6cdf4b584e7e346f10c9624ed5ec78ade22c`
to
`f072923b9665dd48a67dc4a5f7611cd633d94cbfeba0264a1fe8e1f467f28572`.
Normalized-LF manifest hashes move:

- root:
  `fcd05db692b4f7f6684baa2302d890336cb7dbd614f21d5f653a0c761549f661`
  to `99f3a85377d4eb6e9321fa254ae0071d9413b820e6978ead7c9baa30eacf34d0`;
- Store:
  `6111814288334b0aee162f5428bb351284eb1eb939cd17277c99ef5c7a2506a1`
  to `6c4815417064e434470c149c6e773b22edd77e7eff06aa2714b30ad78b824d69`.

Workspace, corrected lockfile, dependencies, importers, overrides, catalogs,
package privacy/publication, workflow, PGlite orchestrator, production
composition, persistence, workerd/D1 behavior, and repository-merge
preparation remain unchanged. Frozen offline install across 86 workspaces,
exact `workspace:*`, Store build, strict tooling, parity/matrices, all seven
graphs, exact inventory, the 300.2-second foundation, and all Cloudflare
Vite/import/workerd gates pass on Vite 8.2.0, built-in Rolldown 1.2.0, and
Vitest 4.1.10.

## Store Integration Vitest Shadow Ownership

Commit:

- `c292d65a57` (`test: add Store integration Vitest shadow`)

Date verified: 2026-07-30.

Store keeps its authoritative Jest integration command and adds only:

```text
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The new exact-file serial profile is registered once in persistent
strict/no-unchecked tooling. Its nine pre/post reports preserve one file, 12
tests, 15 assertions, zero failures/skips/todos/snapshots, and digest
`19726c857ba3909d0e724c0d90e365b22c19378e5fe9d966fdf2313f2a22866b`
across PostgreSQL, PGlite, and Drizzle/SQLite.

Both real Store PGlite selectors pass 12/12 while the global matrix stays
Jest-default; Auth becomes the next unsupported Vitest lane. All three Store
Vitest `/3` invocations fail before import, so the shadow has no workflow or
aggregate owner. All seven task graphs remain 85/65/20, 1/1/0, 83/63/20,
2/2/0, 45/26/19, 5/5/0, and 63/44/19 with Store still Jest-owned in fast/all
integration.

Remaining-Jest counts stay at 68 configs, 107 scripts, and 406 API files. The
orchestrator/verifier ownership digest changes from
`f072923b9665dd48a67dc4a5f7611cd633d94cbfeba0264a1fe8e1f467f28572`
to
`0bdc0cf1c8f889f36319dc8a60c9e99512a08680ab0841d28870e2313574c098`.
Normalized-LF hashes move:

- root manifest:
  `99f3a85377d4eb6e9321fa254ae0071d9413b820e6978ead7c9baa30eacf34d0`
  to `e5830ea871b811ee439650280cc88f3f46c4cc66541fe034973ec9e9c6c1fc3a`;
- Store manifest:
  `6c4815417064e434470c149c6e773b22edd77e7eff06aa2714b30ad78b824d69`
  to `ab85ee6ad7645c1f0d964d5f8661007242a4be8bcec45862dcc80aa9b0acf478`;
- new integration config:
  `72604382520d901bd177420fed668dea22347518b1a343705f6ea121ff13bce9`.

Workspace, corrected lockfile, dependencies, importers, overrides, catalogs,
package privacy/publication, workflow, production composition, persistence,
workerd/D1 behavior, and repository-merge preparation remain unchanged.
Frozen offline install across 86 workspaces, exact `workspace:*`, Store
build/unit lanes, strict tooling, three-backend parity, selectors/shard
boundaries, all graphs, exact inventory, the 332.2-second foundation, and all
Cloudflare Vite/import/workerd gates pass.

## Store Integration Vitest Default Ownership

Commit:

- `57b24eaddd` (`test: switch Store integration to Vitest`)

Date verified: 2026-07-30.

Store integration now defaults to
`vitest run --config vitest.integration.config.mts`; its byte-identical former
Jest command is retained at `test:integration:jest`, and the temporary shadow
key is removed. The root fast integration script excludes Store because its
one file cannot consume `/3` sharding. A dedicated runner-neutral, unsharded
PostgreSQL workflow job owns the default and the stable aggregate propagates
its success and failure/cancelled/skipped states.

All 12 pre/post runner/backend/ownership reports preserve one file, 12 tests,
15 assertions, zero failures/skips/todos/snapshots, and digest
`19726c857ba3909d0e724c0d90e365b22c19378e5fe9d966fdf2313f2a22866b`
across PostgreSQL, PGlite, and Drizzle/SQLite. Both real Store PGlite selectors
pass 12/12, Auth stays fail-closed for Vitest, all `/3` probes reject before
import, and the exact dedicated command passes against PostgreSQL.

Unit graphs remain 85/65/20, 1/1/0, 83/63/20, and 2/2/0. Integration graphs
are now 44/25/19, 5/5/0, and 63/44/19, with Store absent from fast/slow and
owned once by Vitest in all. Remaining-Jest counts remain 68/107/406 and the
accepted digest moves from
`0bdc0cf1c8f889f36319dc8a60c9e99512a08680ab0841d28870e2313574c098`
to
`bf09ea4647e8eb27fa1baa019c1ec531b56319b5a21f3992141aa0be9e663849`.

Normalized-LF hashes move:

- root manifest:
  `e5830ea871b811ee439650280cc88f3f46c4cc66541fe034973ec9e9c6c1fc3a`
  to `4e690749e5629ea18fc719a8f5ebeeae8ec8e8a207b5925a4817c6fed656f914`;
- Store manifest:
  `ab85ee6ad7645c1f0d964d5f8661007242a4be8bcec45862dcc80aa9b0acf478`
  to `f304d157e061cd66cb568c95f5ca38d54ef746f8493246edff96a0ec0b28f67e`;
- PGlite orchestrator:
  `c0d208629ae75c98348c06e3f082f65bcc065839d2a3ea184d37918455115b6b`
  to `7e332ea7a23a43da381eb6bcde59ce3d3314f67447f7e82795d8977a56ef728b`;
- workflow:
  `a08a800a72f521f819c7bcf48a50bfc43a113288a7efdcd24f431f819ae3a2ad`
  to `1009b9a3038877d0d290f33b26b07c633a148100353f2626fd2b507810126723`.

Workspace, lockfile, dependencies, importers, overrides, catalogs, package
privacy/publication, persistence, production composition, workerd/D1 behavior,
and repository-merge preparation remain unchanged. Frozen offline install,
exact `workspace:*`, the 360.6-second foundation, and all Cloudflare
Vite/import/workerd gates pass on Vite 8.2.0, built-in Rolldown 1.2.0, and
Vitest 4.1.10. The workflow contract and local command do not claim a hosted
GitHub Actions result.

## Auth Unit Vitest Shadow Ownership

Commit:

- `e7ff8ccb61` (`test: shadow Auth unit lane with Vitest`)

Date verified: 2026-07-30.

Auth keeps its authoritative Jest unit and integration commands and adds only:

```text
test:vitest  vitest run --config vitest.config.mts
```

The new source-only four-alias profile proves the unchanged one-file/one-test
unit lane without a compatibility bridge. Fresh pre/post Jest and Vitest,
including post-build discovery, preserve one test, ten assertions, zero
failures/skips/todos/snapshots, and digest
`4d55bc4e4dd8e8e6ad3741be3946df33f51a32f8c0f494370284025420f007d8`.
Both `/4` matrices are 1/0/0/0 with exact aggregate signature ownership.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 44/25/19,
5/5/0, and 63/44/19. Auth remains Jest-owned in every applicable persistent
unit/integration graph. Remaining-Jest ownership is unchanged at 68/107/406
and digest
`bf09ea4647e8eb27fa1baa019c1ec531b56319b5a21f3992141aa0be9e663849`.

Normalized-LF hashes are:

- Auth manifest:
  `57049b28cc7e3a647d600ae3e0ba5540e1e287f78d9e6fbb6bb64d2f68049809`
  to `90186fe2cff3e9c387f45d0fa9d20410690256b7ee87ad3a38927b427d4b1ffd`;
- new Auth Vitest config:
  `52958a368def2a79e1d0cfd5c8278d996f0f6fcd5f948d55124adbb2b9df5935`.

Root manifest, workspace, corrected lockfile, dependencies, importers,
overrides, catalogs, package privacy/publication, workflow, PGlite,
persistence, production composition, workerd/D1 behavior, and
repository-merge preparation remain unchanged. Frozen offline install,
standalone strict typecheck, exact `workspace:*`, the 405.1-second foundation,
and all Cloudflare Vite/import/workerd gates pass on Vite 8.2.0, built-in
Rolldown 1.2.0, and Vitest 4.1.10.

## Auth Unit Vitest Default Ownership

Commit:

- This commit (`test: switch Auth unit lane to Vitest`)

Date verified: 2026-07-30.

Auth's proven unit lane now defaults to
`vitest run --config vitest.config.mts`. Its byte-identical former Jest command
moves to `test:jest`, the temporary shadow key is removed, and the config is
registered once in root strict/no-unchecked tooling. Integration remains on
the unchanged Jest command.

Fresh pre/post default/rollback reports preserve one file, one test, ten
assertions, zero failures/skips/todos/snapshots, and digest
`4d55bc4e4dd8e8e6ad3741be3946df33f51a32f8c0f494370284025420f007d8`.
Both runners' pre/post `/4` matrices remain 1/0/0/0 with exact aggregate
signature ownership. The Jest-default PGlite integration selector passes all
36 tests and explicit Vitest integration remains fail-closed.

All seven graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 44/25/19, 5/5/0,
and 63/44/19. Only Auth's applicable unit owner moves to Vitest; integration
stays once on Jest in fast/all. Remaining-Jest counts stay 68/107/406 and the
accepted digest moves from
`bf09ea4647e8eb27fa1baa019c1ec531b56319b5a21f3992141aa0be9e663849`
to
`14a4ed7a7de36fa3462e348ab038a4c8735219ce31cd04d5711b4fb0b4c3b8b2`.

Normalized-LF hashes move:

- root manifest:
  `4e690749e5629ea18fc719a8f5ebeeae8ec8e8a207b5925a4817c6fed656f914`
  to `494e84083c4b143fbaf5398429f533f9efa80e22bfb0246d16e04d1b062451f8`;
- Auth manifest:
  `90186fe2cff3e9c387f45d0fa9d20410690256b7ee87ad3a38927b427d4b1ffd`
  to `fe0ce35ed3ac07047db4231b338e9913275b281d04db2ec125c8ca7ce1043abf`.

Workspace, corrected lockfile, dependencies, importers, overrides, catalogs,
package privacy/publication, workflow, PGlite routing, persistence, production
composition, workerd/D1 behavior, and repository-merge preparation remain
unchanged. Frozen offline install, exact `workspace:*`, the green 305.0-second
foundation rerun, and all Cloudflare Vite/import/workerd gates pass on Vite
8.2.0, built-in Rolldown 1.2.0, and Vitest 4.1.10.

## Auth Integration Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Auth integration lane with Vitest`)

Date verified: 2026-07-31.

Auth keeps its authoritative
`jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"`
integration command and adds only:

```text
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The new serial exact-file integration config owns the existing four package
aliases and limited Jest bridge. The root tooling command registers that config
once and separately runs strict `allowJs`/`checkJs`/
`noUncheckedIndexedAccess` validation for the path-loaded provider fixture.
The PGlite orchestrator maps only explicit `--runner=vitest --only=auth` to the
shadow; its default Auth route remains Jest.

Fresh pre-edit Jest, post-edit Jest, and Vitest prove the same three files and
36 tests on PostgreSQL 18, PGlite, and Drizzle/SQLite. All full names/statuses,
zero-skip/todo/snapshot state, and normalized digest
`f6f80d32667d147070651243e02b4a4e29c037dc86f9fd56a0eb7314e2422eff`
match. Both real PGlite selectors and both runners' complete `/3` aggregates
pass.

The original raw TypeScript provider path could not pass from Vite into the
built native Medusa loader across the repository's Node engine range. Its
single test-fixture implementation is now explicit checked CommonJS
JavaScript, loaded by both runners. No package dependency, catalog, override,
lockfile, or production loader changed.

All seven graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 44/25/19, 5/5/0,
and 63/44/19. Auth stays Jest-owned once in fast/all integration.
Remaining-Jest counts remain 68/107/406; the accepted digest moves from
`14a4ed7a7de36fa3462e348ab038a4c8735219ce31cd04d5711b4fb0b4c3b8b2`
to
`d186f4a82c0b271162f21b0b43f062d4bda5a5c524e72ea70b9934fa4c024043`
only for the revised PGlite/foundation capability ownership.

Normalized-LF hashes move:

- root manifest:
  `494e84083c4b143fbaf5398429f533f9efa80e22bfb0246d16e04d1b062451f8`
  to `57bf7fa50fcae3f4f8e6f66c6122b64f7bdc8f80e9b9451b957ea6f57fc24309`;
- Auth manifest:
  `fe0ce35ed3ac07047db4231b338e9913275b281d04db2ec125c8ca7ce1043abf`
  to `21dc8256b81c88da7be123232bc4ccb7ad21df7dbc369faf568b986bff42e475`;
- new integration config:
  `1c5d5e398c4d35dce9cb42a51f9d15678440c3f5f2f105894af8a88d12df94c6`;
- PGlite orchestrator:
  `7e332ea7a23a43da381eb6bcde59ce3d3314f67447f7e82795d8977a56ef728b`
  to `daf7636587dc2af7befa991d378a01eadfc9ede9943a2e8478db499c3d25fad6`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, the
285.5-second complete foundation, and all Cloudflare
Vite/import/D1/Durable-Object workerd gates pass. Workspace, corrected
lockfile, dependencies, catalogs, package privacy/publication, workflow,
persistence, production composition, and repository-merge preparation remain
unchanged. No hosted GitHub Actions result is claimed.

The next package-management slice is Turn 65 only: promote Auth's proven
integration shadow, retain the exact Jest rollback, and preserve the existing
generic fast/all CI graph because its three files already populate all three
shards. Keep dependencies, lockfile, catalogs, privacy, publication,
persistence, production, and merge preparation unchanged.

## Auth Integration Vitest Default Ownership

Commit:

- This commit (`test: switch Auth integration lane to Vitest`)

Date verified: 2026-07-31.

Auth's proven three-file integration lane now exposes:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The exact former Jest command moved to the rollback key and the temporary
`test:integration:vitest` key was removed. The global PGlite matrix maps its
default Jest selector to that rollback and explicit Vitest selection to the
package default. Auth remains in the existing generic fast/all integration
graphs because its three files populate all three shards; no dedicated job or
workflow edit is needed.

Fresh pre/post reports preserve exact three-file/36-test parity on PostgreSQL
18, PGlite, and Drizzle/SQLite. Both PGlite selectors and both `/3` aggregates
pass. All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0,
44/25/19, 5/5/0, and 63/44/19. Remaining-Jest counts remain 68/107/406; the
accepted ownership digest moves from
`d186f4a82c0b271162f21b0b43f062d4bda5a5c524e72ea70b9934fa4c024043`
to
`da9b67395197e480c9570535b1cbda9793c92d9e0e3b876f2e3b92f4600d35ae`.

Normalized-LF hashes move:

- Auth manifest:
  `21dc8256b81c88da7be123232bc4ccb7ad21df7dbc369faf568b986bff42e475`
  to `269374e37d7e129ab48f4dd5de851bce90da710e98e7d6244b094c7130e9aff7`;
- PGlite orchestrator:
  `daf7636587dc2af7befa991d378a01eadfc9ede9943a2e8478db499c3d25fad6`
  to `db71b27ab55224690ffb43d4cd504a6d7326209bf907c3b31afac81d3f8fc05d`;
- strict foundation contract:
  `d7a77d573aab3bac789a1c339817d8d035b5252453bc31d7d31b354d7efde4d0`
  to `d40ce4b16df54b4408f4b61d761f2ea6f92056e34ce1f63ba345444c3bd8cff0`.

The root manifest, workspace definition, lockfile, dependencies, catalogs,
overrides, package privacy/publication, workflow, assertions, fixtures,
Vitest configs, persistence, production composition, and repository-merge
preparation remain unchanged. The live registry baseline remains Vite 8.2.0,
Vitest and `@vitest/coverage-v8` 4.1.10. Vite 8.2.0 declares built-in
Rolldown `~1.2.0`; this install resolves 1.2.0. The separately published
Rolldown 1.2.1 patch is not mixed into this ownership-only turn.

The next package-management slice is Turn 66 only: add a Vitest shadow for
Region's one-file source unit lane while leaving Region's Jest unit and
integration defaults authoritative.

## Region Unit Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Region unit lane with Vitest`)

Date verified: 2026-07-31.

Region keeps its exact Jest unit and integration defaults and adds only:

```text
test:vitest  vitest run --config vitest.config.mts
```

The new package-root config scopes Vitest to the existing source test, uses the
shared Node/forks/SWC profile, and reproduces Region's five package aliases.
The root strict-tooling command registers that config once. No dependency,
catalog, override, lockfile, workspace, workflow, package-privacy,
publication, persistence, production, or repository-merge behavior changes.

Fresh pre-edit Jest, post-edit Jest, and shadow Vitest reports preserve exactly
one file and one passed test, with zero failures/skips/todos/snapshots and
normalized result digest
`ab01db67f70a6857632ed929df6a9a9a72c523052e475f8a4f1274844af59410`.
Both runners preserve `/4` coverage at 1/0/0/0. Region's existing PGlite Jest
integration selector still passes its one file and 18 tests; explicit Vitest
integration selection still fails closed before spawning.

All seven graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 44/25/19, 5/5/0,
and 63/44/19. Remaining-Jest counts and accepted ownership digest remain
68/107/406 and
`da9b67395197e480c9570535b1cbda9793c92d9e0e3b876f2e3b92f4600d35ae`.

Normalized-LF hashes move:

- root manifest:
  `57bf7fa50fcae3f4f8e6f66c6122b64f7bdc8f80e9b9451b957ea6f57fc24309`
  to `d2889a75b554b1a0dfe5ae190065f6210493daab5b6ad369671475b6f40b7f46`;
- Region manifest:
  `74c2313d3f6d5e35dbf6612ed1bff4287c585cbb505ce28a32944a968df59af6`
  to `f49c7d4d8add09b7f5b83b015dcc1a2a946977820e928506bcd576ab17452f12`;
- new Region config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- strict foundation contract:
  `d40ce4b16df54b4408f4b61d761f2ea6f92056e34ce1f63ba345444c3bd8cff0`
  to `b86a6ec5467a97ef5ab5e6c58ed28b75e37a8cb5674db7c680fe500ecce6f995`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, Region
build, the complete 296.4-second foundation, and all Cloudflare
Vite/import/D1/Durable-Object workerd gates pass. The live registry baseline
remains Vite 8.2.0, Vitest and coverage 4.1.10, Vite-bundled Rolldown 1.2.0,
and standalone Rolldown 1.2.1. No hosted GitHub Actions result is claimed.

The next package-management slice is Turn 67 only: promote Region's proven
unit shadow, preserve the exact Jest rollback, and keep Region integration
Jest-authoritative and explicitly fail-closed for Vitest.

## Region Unit Vitest Default Ownership

Commit:

- This commit (`test: switch Region unit lane to Vitest`)

Date verified: 2026-07-31.

Region's proven source-unit lane now exposes:

```text
test       vitest run --config vitest.config.mts
test:jest  jest --passWithNoTests --bail --forceExit --testPathPattern=src
```

The exact former Jest command moved to the rollback key and the temporary
`test:vitest` key was removed. Region's integration command remains unchanged
and Jest-authoritative. No root manifest, config, dependency, catalog,
override, lockfile, workspace, workflow, package-privacy, publication,
persistence, production, or repository-merge behavior changed.

Fresh pre-cut-over default-Jest/shadow-Vitest and post-cut-over
default-Vitest/rollback-Jest reports preserve exactly one file and one passed
test, zero failures/skips/todos/snapshots, and normalized result digest
`ab01db67f70a6857632ed929df6a9a9a72c523052e475f8a4f1274844af59410`.
All four canonical pre/post runner comparisons pass. Both `/4` matrices remain
1/0/0/0. Region build introduces no duplicate discovery.

All seven graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 44/25/19, 5/5/0,
and 63/44/19. Region moves exactly once from Jest to Vitest in all/scoped/
general unit graphs and remains Jest-owned in fast/all integration.
Remaining-Jest counts remain 68/107/406; the accepted digest moves from
`da9b67395197e480c9570535b1cbda9793c92d9e0e3b876f2e3b92f4600d35ae`
to
`d876ba9c0b475bf422d61bcf78a6d5f8f7a3daeea684d9e084d0a34bbfc4f6ce`.

Normalized-LF hashes move:

- Region manifest:
  `f49c7d4d8add09b7f5b83b015dcc1a2a946977820e928506bcd576ab17452f12`
  to `58a9e79d19514bd8d332ce52f0e1a6ca2662bee70e6a06812be2e9af28a544cb`;
- strict foundation contract:
  `b86a6ec5467a97ef5ab5e6c58ed28b75e37a8cb5674db7c680fe500ecce6f995`
  to `abc3f2993b0db1e69278f1e02a1111baf5a47dcec04eea7ce0af3c2667125db2`;
- remaining-Jest inventory:
  `30959eabcb1da898296969ed1e7f834ca0b33bc729ead81b13e1775150871ed6`
  to `f1efd22984d698b59a027cba362d8518594d2b89f256bee16956d26177783ce7`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, the
complete 311.3-second foundation, and all Cloudflare
Vite/import/D1/Durable-Object workerd gates pass. Live registry versions remain
Vite 8.2.0, Vitest and coverage 4.1.10, Vite-declared Rolldown `~1.2.0`
(resolved 1.2.0), and standalone Rolldown 1.2.1. No hosted GitHub Actions
result is claimed.

The next package-management slice is Turn 68 only: add a separate Region
integration Vitest shadow, preserve its Jest default, and prove the unchanged
18-test suite across PostgreSQL, PGlite, and Drizzle/SQLite before any
integration cut-over.

## Region Integration Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Region integration lane with Vitest`)

Date verified: 2026-07-31.

Region retains its exact Jest integration default and adds only:

```text
test:integration         jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The new package-root config scopes Vitest to the unchanged
`region-module.spec.ts`, reproduces the five existing aliases, and uses the
shared serial Node integration profile with its limited Jest-global bridge.
The root strict-tooling command registers the config once. The PGlite
orchestrator now exposes explicit Region Vitest selection while leaving
default Region selection on Jest. No dependency, catalog, override, lockfile,
workspace, workflow, package-privacy, publication, persistence, production,
or repository-merge behavior changes.

Fresh pre-edit Jest, post-edit Jest, and opt-in Vitest reports on isolated
PostgreSQL 18, PGlite, and Drizzle/SQLite preserve exactly one file and 18
passed tests with identical full names/statuses, zero
failures/skips/todos/snapshots, and normalized result digest
`aebfb5091728f37e059beeb845e462cd78f03dd4c9fcaabbb871bfd093a59e13`.
All nine canonical same-backend runner/time comparisons and all three
pre-edit cross-backend Jest comparisons pass. Both real PGlite selectors pass
18 tests; RBAC remains the next unsupported Vitest selector and fails before
spawn.

All three authentic Vitest `/3` runs fail because a single discovered file
cannot satisfy three shards. Region therefore keeps its existing Jest owner in
the unchanged fast/all integration graphs and gains no workflow owner in this
shadow. Jest's `/3` aggregate remains 18/0/0. All seven graph shapes remain
85/65/20, 1/1/0, 83/63/20, 2/2/0, 44/25/19, 5/5/0, and 63/44/19.
Remaining-Jest counts remain 68/107/406; the accepted digest moves from
`d876ba9c0b475bf422d61bcf78a6d5f8f7a3daeea684d9e084d0a34bbfc4f6ce`
to
`b846faaa1971e3b84f6db1f4eb2e2ed7c3a5835950e4ae7977c2b77fdf33c215`
only for the shared PGlite/tooling ownership hashes.

Normalized-LF hashes move:

- root manifest:
  `d2889a75b554b1a0dfe5ae190065f6210493daab5b6ad369671475b6f40b7f46`
  to `4a3e06a7c33544c245b015eb236fc1d98a5721d7cf5a60f98a781c24e276355b`;
- Region manifest:
  `58a9e79d19514bd8d332ce52f0e1a6ca2662bee70e6a06812be2e9af28a544cb`
  to `70326dba72f1d9902aaf2b3abc96e2bc8edb68fe135c61162ae0b1a9d92b4c9e`;
- new Region integration config:
  `bc37718b8a248afe0d060beb308ed011a46b454b443923ec0f8dd193553dbf7d`;
- PGlite orchestrator:
  `db71b27ab55224690ffb43d4cd504a6d7326209bf907c3b31afac81d3f8fc05d`
  to `9cb0adfe3300d5a2834cf0ddd1e4f61495d5f0ed8177f9710f7b403c36efd21e`;
- integration verifier:
  `2e4012b4c0e4fc8121f75a4ddd9e25cced79181b6ee1d45f0f1498f4e6dff752`
  to `bd9457717aa315d111c6628c98bb9df8d4b68e0af74703b21f9944ca686c8cbc`;
- strict foundation contract:
  `abc3f2993b0db1e69278f1e02a1111baf5a47dcec04eea7ce0af3c2667125db2`
  to `7379e9e1ebac3246f9df463796e47fd65307218cfab7c40bddb3dfc4e79c1cc5`;
- remaining-Jest inventory:
  `f1efd22984d698b59a027cba362d8518594d2b89f256bee16956d26177783ce7`
  to `bd8634d2762f08739d9729301ffcd28e7cd49de49d7e93f92d18ae73cc97994c`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, Region
build and both unit runners, strict tooling, the complete 303.2-second
foundation, and all Cloudflare Vite/import/D1/Durable-Object workerd gates
pass. The live registry baseline is Vite 8.2.0, Vitest and coverage 4.1.10,
Vite-declared Rolldown `~1.2.0` resolved at 1.2.0, and standalone Rolldown
1.2.1. No hosted GitHub Actions result is claimed.

The next package-management slice is Turn 69 only: promote Region integration
to Vitest after fresh parity, retain the exact Jest rollback, and give its
one-file default a dedicated runner-neutral unsharded PostgreSQL workflow
owner instead of placing it in the generic `/3` shard.

## Region Integration Vitest Default Ownership

Commit:

- This commit (`test: switch Region integration lane to Vitest`)

Date verified: 2026-07-31.

Region's proven integration lane now exposes:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The exact former Jest command moved to the rollback key and the temporary
`test:integration:vitest` key was removed. The PGlite orchestrator now maps
default selection to the Jest rollback and explicit Vitest selection to the
package default.

Because Vitest rejects all three `/3` shards for a one-file suite, Region is
excluded only from the generic fast integration graph. A new runner-neutral,
unsharded `region-integration` workflow job runs the default command against
PostgreSQL and propagates failure, cancellation, skip, and success through the
package aggregate. No dependency, catalog, override, lockfile, workspace,
package-privacy, publication, persistence, production, or repository-merge
behavior changes.

Fresh pre-cut-over default-Jest/shadow-Vitest and post-cut-over
rollback-Jest/default-Vitest reports on isolated PostgreSQL 18, PGlite, and
Drizzle/SQLite preserve one file, 18 passed tests, every full name/status, zero
failures/skips/todos/snapshots, and normalized digest
`aebfb5091728f37e059beeb845e462cd78f03dd4c9fcaabbb871bfd093a59e13`.
All 12 canonical per-backend comparisons and all cross-backend runner pairs
before and after cut-over pass. Both PGlite selectors pass 18 tests; RBAC
remains fail-closed before spawn.

The Vitest default `/3` probes exit 1 before suite import. Jest rollback shards
pass at 18/0/0 and aggregate the suite exactly once. Unit graphs remain
85/65/20, 1/1/0, 83/63/20, and 2/2/0. Fast integration moves from 44/25/19 to
43/24/19 with Region absent; slow remains 5/5/0; all remains 63/44/19 with
Region on Vitest. Remaining-Jest counts remain 68/107/406; the accepted digest
moves from
`b846faaa1971e3b84f6db1f4eb2e2ed7c3a5835950e4ae7977c2b77fdf33c215`
to
`0dfc629497c92d6be08d200ac8d1d5a690d80fcbda50756701dbf5e97cf906bd`.

Normalized-LF hashes move:

- root manifest:
  `4a3e06a7c33544c245b015eb236fc1d98a5721d7cf5a60f98a781c24e276355b`
  to `ef5ac8ad8925498eb1e20ce0e1e2e9b5b78a9f89309988a352b2738ddb9c59ae`;
- Region manifest:
  `70326dba72f1d9902aaf2b3abc96e2bc8edb68fe135c61162ae0b1a9d92b4c9e`
  to `a712e726119ab8b57495e15e96513880484c0795dfa9082bb590aa9bf8bb9333`;
- PGlite orchestrator:
  `9cb0adfe3300d5a2834cf0ddd1e4f61495d5f0ed8177f9710f7b403c36efd21e`
  to `4028e9a122ef2901eed8285121031ade801aca85df8882341689daa7d19fd9e9`;
- strict foundation contract:
  `7379e9e1ebac3246f9df463796e47fd65307218cfab7c40bddb3dfc4e79c1cc5`
  to `668f2d86affa78fc10c33379b3f75a2d4fe3ac614322604707512e35814635fc`;
- remaining-Jest inventory:
  `bd8634d2762f08739d9729301ffcd28e7cd49de49d7e93f92d18ae73cc97994c`
  to `e7e4d804d4cbc64b07843cb022d63ce138622e622bceb53f12348cf83d4dfdaa`;
- workflow:
  `1009b9a3038877d0d290f33b26b07c633a148100353f2626fd2b507810126723`
  to `bf3bcc0b51857a4d50ef8719a736eee55cf4baaede6294e0455bff97f4ee633a`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, Region
build/unit default/unit rollback, the complete 322.9-second foundation, and
the 118.9-second Cloudflare Vite/import/D1/Durable-Object workerd gate set
pass. The registry and installed baseline remains Vite 8.2.0, Vitest and
coverage 4.1.10, Vite-declared Rolldown `~1.2.0` resolved at 1.2.0, and
standalone Rolldown 1.2.1.

The workflow shape and direct PostgreSQL command are proven locally. No hosted
GitHub Actions result is claimed. The next package-management slice is Turn 70
only: audit and shadow RBAC's source-unit lane while leaving RBAC integration
Jest-authoritative and Vitest selection fail-closed.

## RBAC Unit Vitest Shadow Ownership

Commit:

- This commit (`test: shadow RBAC unit lane with Vitest`)

Date verified: 2026-07-31.

RBAC keeps its exact Jest unit and integration defaults and adds only:

```text
test:vitest  vitest run --config vitest.config.mts
```

The new package-root config scopes Vitest to the existing source test through
the shared source discovery globs, reproduces RBAC's five aliases, and uses the
shared Node/forks/SWC profile without the Jest compatibility bridge. The root
strict-tooling command registers the config exactly once.

Fresh pre-edit Jest, post-edit Jest, shadow Vitest, and post-build Vitest
reports preserve one file, one passed test, every full name/status, zero
failures/skips/todos/snapshots, and normalized digest
`06a1fff8f4c84d800d3f759bc2997d7f661380675dd92c563a300f26dd4f8a0a`.
Both real `/4` matrices cover the file once at 1/0/0/0. The unchanged PGlite
Jest integration selector passes six tests with one existing skip before and
after the shadow; explicit RBAC Vitest integration selection fails before
spawn.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 43/24/19,
5/5/0, and 63/44/19. RBAC remains Jest-owned exactly once in applicable unit
and integration graphs. Remaining-Jest counts, accepted digest, and inventory
file remain unchanged at 68/107/406,
`0dfc629497c92d6be08d200ac8d1d5a690d80fcbda50756701dbf5e97cf906bd`,
and
`e7e4d804d4cbc64b07843cb022d63ce138622e622bceb53f12348cf83d4dfdaa`.

Normalized-LF hashes move:

- root manifest:
  `ef5ac8ad8925498eb1e20ce0e1e2e9b5b78a9f89309988a352b2738ddb9c59ae`
  to `2d4ba67bfb6f66ca6d0c829f064bf0f44ce77cc5beb1c4e2288d32b75c1f6088`;
- RBAC manifest:
  `e55ab7ab9babdeb4da41390f0ee37d292a8088e6409dbaadf67684a45f89a619`
  to `9f051922bf8e8db638fac1866ed788a8de0d7eea3348eadd6f92b174d992128f`;
- new RBAC config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- strict foundation contract:
  `668f2d86affa78fc10c33379b3f75a2d4fe3ac614322604707512e35814635fc`
  to `cd16f00969adfa01dce24be07a4c1b9a5d1090725262f42b11fca0ac9e563636`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, RBAC
build, strict tooling, the complete 279.1-second foundation, and the
114-second Cloudflare Vite/import/D1/Durable-Object workerd gate set pass.
Live registry values remain Vite 8.2.0, Vitest and coverage 4.1.10, and
standalone Rolldown 1.2.1; the installed Vite build uses Rolldown 1.2.0.

No dependency, catalog, override, lockfile, workspace, workflow,
package-privacy, publication, persistence, production, or repository-merge
behavior changes. No hosted GitHub Actions result is claimed.

The next package-management slice is Turn 71 only: promote RBAC's proven unit
shadow, preserve the exact Jest rollback, and keep RBAC integration
Jest-authoritative and explicitly fail-closed for Vitest.

## RBAC Unit Vitest Default Ownership

Commit:

- This commit (`test: switch RBAC unit lane to Vitest`)

Date verified: 2026-07-31.

RBAC's source-unit runner ownership is now:

```text
test       vitest run --config vitest.config.mts
test:jest  jest --passWithNoTests --bail --forceExit --testPathPattern=src
```

The temporary `test:vitest` shadow key is removed. The existing Vitest config,
source, aliases, root config registration, Jest integration command, and
explicit PGlite Vitest fail closure are unchanged.

Fresh pre-cut-over default Jest/shadow Vitest and post-cut-over default
Vitest/rollback Jest plus post-build Vitest preserve one file, one passed test,
every full name/status, zero failures/skips/todos/snapshots, and normalized
digest
`06a1fff8f4c84d800d3f759bc2997d7f661380675dd92c563a300f26dd4f8a0a`.
All four canonical pre/post comparisons pass. Both real `/4` matrices cover
the file once at 1/0/0/0.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 43/24/19,
5/5/0, and 63/44/19. RBAC moves exactly once from Jest to Vitest in
all/scoped/general unit graphs and remains Jest-owned in fast/all integration.
Remaining-Jest counts stay 68/107/406; the accepted digest moves from
`0dfc629497c92d6be08d200ac8d1d5a690d80fcbda50756701dbf5e97cf906bd`
to
`6b697ef51ed5877d24492d07b6eb7cf809a1e0228c8fd570b08ef4c2a4327b1b`.

Normalized-LF hashes move:

- RBAC manifest:
  `9f051922bf8e8db638fac1866ed788a8de0d7eea3348eadd6f92b174d992128f`
  to `9acd1637fd21663f002033642c94ba4f6f1c3eeeac328fd81ed360c638b5b630`;
- strict foundation contract:
  `cd16f00969adfa01dce24be07a4c1b9a5d1090725262f42b11fca0ac9e563636`
  to `b89708e2abb44911041419012d9ff814fd7ec7f3d0d93631cb225d9d19bf1f60`;
- remaining-Jest inventory:
  `e7e4d804d4cbc64b07843cb022d63ce138622e622bceb53f12348cf83d4dfdaa`
  to `9dadfbfe1a107d0292349d0065bf9bc869294fc0f4133082de8fc5ba9428c4d3`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, RBAC
build, strict tooling, the complete 276.2-second foundation, and the
95.0-second 13-gate Cloudflare Vite/import/D1/Durable-Object workerd set pass.
Live registry values remain Vite 8.2.0, Vitest and coverage 4.1.10, and
standalone Rolldown 1.2.1; Vite declares `rolldown ~1.2.0` and resolves 1.2.0.

No dependency, catalog, override, lockfile, workspace, workflow,
package-privacy, publication, persistence, production, or repository-merge
behavior changes. No hosted GitHub Actions result is claimed.

The next package-management slice is Turn 72 only: add a separate RBAC
integration Vitest shadow, preserve its Jest default, and prove the unchanged
suite across PostgreSQL, PGlite, and Drizzle/SQLite before any integration
cut-over or CI ownership change.

## RBAC Integration Vitest Shadow Ownership

Commit:

- This commit (`test: shadow RBAC integration lane with Vitest`)

Date verified: 2026-07-31.

RBAC keeps the exact Jest `test:integration` default and adds only
`test:integration:vitest`. The new config is registered once in strict
tooling, includes only the unchanged RBAC integration file, reproduces five
aliases, and uses the narrow shared Jest bridge for the preserved
`jest.setTimeout` call.

The PGlite runner now maps explicit RBAC Vitest selection to the shadow while
leaving default/Jest selection unchanged. User becomes the next unsupported
Vitest lane and fails before spawn. No dependency, catalog, override,
lockfile, workspace, workflow, package-privacy, publication, persistence,
production, or repository-merge behavior changes.

Three persistence backends and both runners preserve one file, six
passed/one skipped test, exact names/statuses, zero
failures/todos/snapshots, and normalized digest
`b4454deb8f38de5e2de90ee7d15dcd595e191c25e582753cc3e56662c9553655`.
Both PGlite selectors pass. Under `/3`, shard 1 owns the only file and shards
2/3 pass empty, so the future default needs dedicated unsharded CI ownership.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 43/24/19,
5/5/0, and 63/44/19. Remaining-Jest counts stay 68/107/406; the accepted
digest becomes
`cb4a27d2c1bfbbecdba32a3f01a7ad7917a562e6d3df923220c7ff1720e89ea5`.
Frozen offline install across all 86 workspaces, exact `workspace:*`, RBAC
build and unit runners, strict tooling, the complete 313.4-second foundation,
and the 104.9-second 13-gate Cloudflare set pass. No hosted GitHub Actions
result is claimed.

The next package-management slice is Turn 73 only: cut RBAC integration over
to Vitest with exact Jest rollback and add dedicated runner-neutral unsharded
PostgreSQL workflow ownership plus aggregate propagation.

## RBAC Integration Vitest Default Ownership

Commit:

- This commit (`test: switch RBAC integration lane to Vitest`)

Date verified: 2026-07-31.

RBAC integration now uses:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The temporary shadow key is removed. PGlite routes Jest to the rollback and
Vitest to the default. The fast integration graph excludes RBAC, and a
dedicated runner-neutral unsharded PostgreSQL job now owns it with exact
package-aggregate propagation.

All 12 per-backend pre/post comparisons plus pre/post cross-backend checks
preserve one file, six passed/one skipped test, names/statuses, zero
failures/todos/snapshots, and digest
`b4454deb8f38de5e2de90ee7d15dcd595e191c25e582753cc3e56662c9553655`.
Both PGlite selectors and the exact workflow command pass locally.

Unit graphs remain 85/65/20, 1/1/0, 83/63/20, and 2/2/0. Fast integration
moves to 42/23/19; slow/all remain 5/5/0 and 63/44/19. Remaining-Jest counts
stay 68/107/406 and accepted digest becomes
`4fee6c2e3fa5a3c84ffad29f7a0e978cc2ac79583df65e6daf8126b2017d4333`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, RBAC
build and unit runners, strict tooling, the complete 268.7-second foundation,
and the 93.1-second 13-gate Cloudflare set pass. Dependencies, catalogs,
overrides, lockfile, workspace shape, package privacy/publication,
persistence, production, and repository-merge behavior remain unchanged. The
workflow contract and command are locally proven; no hosted result is claimed.

The next package-management slice is Turn 74 only: add an opt-in User
source-unit Vitest shadow while preserving its exact Jest defaults and
fail-closed Vitest integration boundary.

## User Unit Vitest Shadow Ownership

Commit:

- This commit (`test: shadow User unit lane with Vitest`)

Date verified: 2026-07-31.

User keeps the exact Jest `test` and `test:integration` defaults and adds only
`test:vitest`. The new config is registered exactly once in strict tooling,
uses the shared source discovery globs, reproduces five aliases, and has no
legacy-Jest bridge.

All five canonical source-unit reports preserve one passed file/test, exact
name/status, zero failures/skips/todos/snapshots, and digest
`8bafc05bff8d1b2a7107cf1a86564afa3997360751d7272675e0f938ce511ead`.
Both `/4` aggregates are 1/0/0/0, post-build discovery is unique, unchanged
PGlite Jest integration passes two files/28 tests before and after, and User
Vitest integration selection remains fail-closed before spawn.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 42/23/19,
5/5/0, and 63/44/19. Remaining-Jest counts and digest stay 68/107/406 and
`4fee6c2e3fa5a3c84ffad29f7a0e978cc2ac79583df65e6daf8126b2017d4333`.
The root manifest moves to
`7c22f227a78f643a6a3893358ee1f537640a665d367f2a0f4d534a2b77552aba`,
the User manifest to
`a2d3dcd040b2c6eb29fec305daa508e8a804f12c3d6d73ac65603a22b3a7dc0d`,
the new config is
`9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`,
and the strict contract moves to
`8a4bf680720419e60a9fa0aea1f183801c55b449ddf3a8ac011792c9abeb6ad5`.

Frozen offline install across 86 workspaces, exact `workspace:*`, User build,
strict tooling, nine contracts, the 284.1-second foundation, and all 13
Cloudflare commands pass. Dependencies, catalogs, overrides, lockfile,
workspace shape, workflow, package privacy/publication, persistence,
production, and repository-merge behavior remain unchanged.

The next package-management slice is Turn 75 only: promote User's proven unit
shadow, retain the exact Jest rollback, and keep User integration
Jest-authoritative and Vitest-fail-closed.

## User Unit Vitest Default Ownership

Commit:

- This commit (`test: switch User unit lane to Vitest`)

Date verified: 2026-07-31.

User's source-unit runner ownership is now:

```text
test       vitest run --config vitest.config.mts
test:jest  jest --passWithNoTests --bail --forceExit --testPathPattern=src
```

The temporary shadow key is absent. The exact source, config, integration
default, PGlite routing, root manifest, dependencies, catalogs, overrides,
lockfile, workspace shape, workflow, privacy/publication, persistence,
production, and repository-merge behavior remain unchanged.

All pre/post reports preserve one passed file/test, exact name/status, zero
failures/skips/todos/snapshots, and digest
`8bafc05bff8d1b2a7107cf1a86564afa3997360751d7272675e0f938ce511ead`.
Both `/4` aggregates remain 1/0/0/0. PGlite Jest integration passes two
files/28 tests before and after, while User Vitest integration selection
remains fail-closed before spawn.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 42/23/19,
5/5/0, and 63/44/19. User moves once to Vitest only in unit graphs.
Remaining-Jest counts stay 68/107/406; only `test` becomes `test:jest`, and the
accepted digest becomes
`88315b005bc36b5da06e07082f0ebf02a77e7a5de4ed1a0b6a0d9d7d6978db8f`.

User manifest moves to
`fa8704d759b121d6dfbdb9c9cd6cebaa1b788cbe7d2c1161dff748bcfb2d3ce1`,
the strict contract to
`266d59f84805473f492d8ff3d312aea599e5579d13ee1b74cc3c0d653a004db9`,
and the inventory file to
`8c0b2c1ac9897ba0d6eec7118bb9c07c8e15b7283c87fd10b385ae15aedcd201`.
Frozen offline install across 86 workspaces, exact `workspace:*`, User build,
strict tooling, nine contracts, the 269.7-second foundation, and all 13
Cloudflare commands pass.

The next package-management slice is Turn 76 only: add a separate User
integration Vitest shadow and explicit PGlite routing while preserving the
exact Jest integration default.

## User Integration Vitest Shadow Ownership

Commit:

- This commit (`test: shadow User integration lane with Vitest`)

Date verified: 2026-07-31.

User keeps the exact Jest `test:integration` default and adds only
`test:integration:vitest`. The new config is registered exactly once in strict
tooling, consumes the shared serial integration profile, reproduces five
aliases, and uses the existing narrow legacy-Jest bridge. PGlite routes
explicit Vitest User selection to the shadow and leaves default/Jest selection
unchanged.

Every pre/post Jest and Vitest report across PostgreSQL, PGlite, and
Drizzle/SQLite preserves two passed files/28 tests, exact names/statuses, zero
failures/skips/todos/snapshots, and digest
`2c413d71bd1c98f181215ded94940e420e868ac52426e57a487e76af47c6867d`.
Both PGlite selectors pass, unsupported Vitest selection advances to Sales
Channel, and both runners' `/3` aggregates pass at 14/14/0. No dedicated
workflow job is needed for the later default.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 42/23/19,
5/5/0, and 63/44/19. Remaining-Jest counts stay 68/107/406; accepted digest
becomes
`ea2b4d574cd8c878797845d11535bebadd0796ee91dde05d97a6446be0892ea7`.
The root manifest moves to
`0462f3b4bfa18fa090b5f8da505d9754c360a45441804a40e087f724efcbb05f`,
the User manifest to
`223ffcd24b14ac8f1a5f0dd37b2ac8c70159103575b56718b91f95fd7863e27d`,
the new integration config is
`d638776636212ba2f0ea0193cad8f63e4b268d44c1aec6be9a4ecf2cdfaf13c7`,
and the strict contract moves to
`5785c820f0f891fee33dd7d53955476216cc17734f85ff2ab4c67022585e8756`.

Frozen offline install across 86 workspaces, exact `workspace:*`, User build
and both unit runners, strict tooling, nine contracts, the 268.5-second
foundation, and all 13 Cloudflare commands pass. Dependencies, catalogs,
overrides, lockfile, workspace shape, workflow, package privacy/publication,
persistence, production, and repository-merge behavior remain unchanged.

The next package-management slice is Turn 77 only: promote User's proven
integration shadow, retain the exact Jest rollback, update PGlite routing, and
keep generic fast-shard ownership without adding a workflow job.

## User Integration Vitest Default Ownership

Commit:

- This commit (`test: switch User integration lane to Vitest`)

Date verified: 2026-07-31.

User integration ownership is now:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The temporary shadow key is absent. PGlite routes its default/Jest selector to
the rollback and explicit Vitest selection to the package default.

Every fresh pre/post report across PostgreSQL, PGlite, and Drizzle/SQLite
preserves two passed files/28 tests, exact names/statuses, zero
failures/skips/todos/snapshots, and digest
`2c413d71bd1c98f181215ded94940e420e868ac52426e57a487e76af47c6867d`.
Both PGlite selectors and both `/3` aggregates pass at 14/14/0. User stays in
generic fast sharding; no workflow job is added.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 42/23/19,
5/5/0, and 63/44/19. Remaining-Jest counts stay 68/107/406; only the exact
script key moves, and accepted digest becomes
`fb4c00ea649f7860044cd06e9a7847bccd7cc9aa9c058ecb6cb26dfb5e24c8db`.

User manifest moves to
`59a5d7503c1d204c70b46a9b351546c740039c3a98e58c5c03b180581259b463`,
PGlite routing to
`7bdb36011d0add2afe035e075b414845512fdf47859a8c8a1f75328b3acf83e7`,
the strict contract to
`a675d3f50c5f71efed54ef15d4f8a70b23a60a857f28ef913241d6726b9117bc`,
and the inventory file to
`622a96625464a505ce992fc35e5dfb39c927c907e98ba57fb1d8c2952835a51b`.

Frozen offline install across 86 workspaces, exact `workspace:*`, User build
and both unit runners, strict tooling, nine contracts, the 268.0-second
foundation, and all 13 Cloudflare commands pass. Dependencies, catalogs,
overrides, lockfile, workspace shape, workflow, package privacy/publication,
persistence, production, and repository-merge behavior remain unchanged.

The next package-management slice is Turn 78 only: add a Sales Channel
source-unit Vitest shadow while preserving its exact Jest defaults and
fail-closed Vitest integration boundary.

## Sales Channel Unit Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Sales Channel unit lane with Vitest`)

Date verified: 2026-07-31.

Sales Channel keeps its exact Jest unit and integration defaults and adds only:

```text
test:vitest  vitest run --config vitest.config.mts
```

The new package-root config scopes Vitest to the existing two source tests,
uses the shared Node/forks/SWC profile, reproduces five aliases, and is
registered once in strict tooling. No compatibility bridge is needed.

Fresh pre-edit Jest, post-edit Jest, shadow Vitest, and post-build reports
preserve two files/three passed tests, exact names/statuses, zero
failures/skips/todos/snapshots, and digest
`e9f67ef782e472c2ecad05d59fd2c3430a1afa761896ce6316d9261c8c63567c`.
Both `/4` matrices cover one file on shards 1/2 and pass shards 3/4 empty;
the different 1/2 versus 2/1 test distribution still aggregates to all three
tests exactly once.

The unchanged PGlite Jest integration selector passes one file/14 tests and
explicit Vitest integration selection fails before spawn. All seven graph
shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 42/23/19, 5/5/0, and
63/44/19. Remaining-Jest counts and accepted digest remain 68/107/406 and
`fb4c00ea649f7860044cd06e9a7847bccd7cc9aa9c058ecb6cb26dfb5e24c8db`.

Normalized-LF hashes move:

- root manifest to
  `df15e90cadc8715e2c57e2464068fdec97f0f5f6b05569a0f1407ead93d88ecf`;
- Sales Channel manifest to
  `92706544b5f2d143e2d02a4b32c74f3bb988d4592a37adc7a62bf4f35fc9fd41`;
- new config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- strict contract to
  `47a185ee9828c713e0d1d60ca91933bb1a35241bc8d10bf15f97dac4525c49c3`.

Frozen offline install across 86 workspaces, exact `workspace:*`, Sales
Channel build, strict tooling, nine contracts, the 267.3-second foundation,
and all 13 Cloudflare commands pass. Dependencies, catalogs, overrides,
lockfile, workspace shape, workflow, package privacy/publication, persistence,
production, and repository-merge behavior remain unchanged.

The next package-management slice is Turn 79 only: promote the proven Sales
Channel unit shadow, retain the exact Jest rollback, and keep integration
Jest-authoritative and Vitest selection fail-closed.

## Sales Channel Unit Vitest Default Ownership

Commit:

- This commit (`test: switch Sales Channel unit lane to Vitest`)

Date verified: 2026-07-31.

Sales Channel's proven source-unit lane now exposes:

```text
test       vitest run --config vitest.config.mts
test:jest  jest --bail --forceExit --testPathPattern=src
```

The temporary shadow key is absent and the integration default remains
byte-identical under Jest.

Fresh pre/post and post-build reports preserve two files/three passed tests,
exact names/statuses, zero failures/skips/todos/snapshots, and digest
`e9f67ef782e472c2ecad05d59fd2c3430a1afa761896ce6316d9261c8c63567c`.
All four canonical comparisons pass. Both `/4` matrices cover the complete
three-test aggregate and pass shards 3/4 empty.

The unchanged PGlite Jest integration selector passes one file/14 tests before
and after cut-over, while explicit Vitest integration selection remains
fail-closed. Graph shapes stay 85/65/20, 1/1/0, 83/63/20, 2/2/0, 42/23/19,
5/5/0, and 63/44/19, moving Sales Channel exactly once to Vitest only in unit
graphs.

Remaining-Jest counts stay 68/107/406; the exact rollback-key move changes the
accepted digest to
`fb62eac6a76f38c13c3992695d616194a7634605b8fa06c274866dacfb1c32c2`.
Normalized-LF hashes move:

- Sales Channel manifest to
  `feda3fcb2a62bfa0fb20a940c18c5f318376c1c2bf45f2e782a3ef00fffc2c18`;
- strict contract to
  `c4919bdbeb155a65ae65fe96e1f7d58675cb01c8cdc5faa3a95b5cc82437f802`;
- inventory file to
  `0dfd12c18ff522d328a5bf4b09ec43c0844fd29d77b54307437379c643c33247`.

Frozen offline install across 86 workspaces, exact `workspace:*`, Sales
Channel build, strict tooling, nine contracts, the 266.8-second foundation,
and all 13 Cloudflare commands pass. Root manifest, dependencies, catalogs,
overrides, lockfile, workspace shape, workflow, package privacy/publication,
persistence, production, and repository-merge behavior remain unchanged.

The next package-management slice is Turn 80 only: add a Sales Channel
integration Vitest shadow after exact three-backend baseline proof, preserving
Jest authority and adding no workflow owner before shard measurement.

## Sales Channel Integration Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Sales Channel integration lane with Vitest`)

Date verified: 2026-07-31.

Sales Channel keeps its exact Jest integration default and adds only:

```text
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The new exact-file config uses the shared serial integration profile, five
aliases, and the narrow compatibility bridge for the unchanged timeout call.
No default or workflow owner changes.

Fresh pre/post Jest and Vitest reports preserve one file/14 tests, exact
names/statuses, zero failures/skips/todos/snapshots, and digest
`2abda1932abcd108e0a006b536978950c2486113c1221477c497c14caa0ed1b2`
on PostgreSQL 18, PGlite, and Drizzle/SQLite. All 18 Cartesian pre/post
comparisons pass. Both PGlite selectors pass and Customer is the next
fail-closed Vitest lane.

All three real Vitest `/3` commands reject the one-file suite. Jest runs all
14 tests on shard 1 and lets shards 2/3 pass empty, so the shadow has no
generic, workflow, aggregate, or hosted owner.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 42/23/19,
5/5/0, and 63/44/19. Remaining-Jest counts stay 68/107/406; accepted digest
becomes
`4ccce2217a5343bcf77c3eb372e9fac02a6e0adb70a31684de319897153a70ef`.

Normalized-LF hashes move:

- root manifest to
  `641eb605be7a5f8b7b0abcf0ce52c1657f95bfefaefea0ecbf74ca3c66634553`;
- Sales Channel manifest to
  `aaf97a05ebffe69e01a2a57a29f921155eff0ac72af617d920112e751f9b7df7`;
- new integration config:
  `ab88fc6a6cfe162e0406742ed6e34076d472a77bcf477aa99f37c8ecb3deafbf`;
- PGlite runner to
  `a06c694c2c08de6bf616b46e1b16ff043e3d5343898abcc49c3dd70a857d1d71`;
- integration verifier to
  `dd9fa189e0ee657f004407441737acbfd60785076f33b209426d99dc5110dad7`;
- strict contract to
  `b12a740356cf07af5d9f1e9100437414389bb82e98c678c79bfd6bb7ecac18b7`;
- inventory file to
  `340ab67e630b24662b289d51f8750a9bccbd78dff404232b66747f2267308b6c`.

Frozen offline install across 86 workspaces, exact `workspace:*`, Sales
Channel build/unit runners, strict tooling, nine contracts, the 268.1-second
foundation, and all 13 Cloudflare commands pass. Dependencies, catalogs,
overrides, lockfile, workspace shape, workflow, package privacy/publication,
persistence, production, and repository-merge behavior remain unchanged.

The next package-management slice is Turn 81 only: promote the proven Sales
Channel integration lane, preserve the exact Jest rollback, route both PGlite
selectors, remove it from generic fast sharding, and add one runner-neutral
unsharded PostgreSQL job with aggregate propagation.

## Sales Channel Integration Vitest Default Ownership

Commit:

- This commit (`test: switch Sales Channel integration lane to Vitest`)

Date verified: 2026-07-31.

Sales Channel now owns:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The temporary shadow key is removed. The root fast integration command excludes
Sales Channel because its one-file Vitest config rejects `/3`; the unsharded
all-packages graph still owns it once. The workflow adds one runner-neutral
PostgreSQL job and propagates all four terminal states into
`integration-tests-packages`.

Both root PGlite selectors pass all 14 tests. All 12 pre/post reports across
PostgreSQL, PGlite, and Drizzle/SQLite match in all 66 possible pairs. Unit
graphs stay 85/65/20, 1/1/0, 83/63/20, and 2/2/0. Integration graphs are now
41/22/19, 5/5/0, and 63/44/19.

Remaining-Jest counts stay 68/107/406; only the rollback key and PGlite
orchestrator digest move. Accepted digest becomes
`cf9845867e17ab02f0aea25780b2a1700fdbbfee29502990212d4f072db1f77b`.

Normalized-LF hashes move:

- root manifest to
  `558536e3314c2a1fcf0cda9cb31a5dc3f3a1428881e74f32dfff254f3f5a75f2`;
- Sales Channel manifest to
  `1bfef403362e1e81decfa4c5a49032d7700b5bd4648596cf3b2f05fcb3918404`;
- PGlite runner to
  `c328fa8ec9d478be5f221803475808c7ea731480811b715a2458d7a7b11b08ec`;
- strict contract to
  `1640eee4ce619eb49ff30ca54c7cf95ea142a7ad27711ba02a6afedf222221bb`;
- inventory file to
  `4aceb83cb0fb61ecf2166dd3ca6db2963a8587006b72dfaf02f8713ee50391d4`;
- workflow to
  `4e638a0f7cfb6d55a7e71ffa9599377bfd4de12feb3d147d12d452dc6e9ff966`.

Frozen offline install across 86 workspaces, exact `workspace:*`, Sales Channel
build/unit/integration runners, the 258.7-second foundation, and all 13
Cloudflare commands pass. Dependencies, catalogs, overrides, lockfile,
workspace shape, package privacy/publication, persistence, production, and
repository-merge behavior remain unchanged. No hosted GitHub Actions result is
claimed.

The next package-management slice is Turn 82 only: audit Customer's source-unit
lane and add an opt-in Vitest shadow without changing defaults, integration,
workflow, dependencies, or persistence.

## Customer Source-Unit Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Customer unit lane with Vitest`)

Date verified: 2026-07-31.

Customer retains its exact Jest unit and integration defaults and adds one
opt-in `test:vitest` command plus one source-only config. The root tooling
typecheck owns that config exactly once. No package receives a new dependency,
and the pnpm catalog, overrides, lockfile, workspace shape, privacy/publication
metadata, workflow, and merge preparation remain unchanged.

Five fresh pre/post/post-build reports match at one file/one passed test with
zero snapshots, and all 10 pairwise comparisons pass. Jest and Vitest `/4`
both distribute 1/0/0/0. All seven graphs remain 85/65/20, 1/1/0, 83/63/20,
2/2/0, 41/22/19, 5/5/0, and 63/44/19; only the executable opt-in package
command is added, with no graph or CI owner.

Remaining-Jest counts and inventory stay byte-identical at 68/107/406.
Normalized-LF hashes move only for the root manifest to
`e2aa800cf33667ebca5d5f8e6ac980187907b70085362e5e55c1d7f16b31409e`,
Customer manifest to
`a9a2371e991c28946f656321df47a6f77d461859d2a316d1ab19a60db938cf6b`,
new config to
`52958a368def2a79e1d0cfd5c8278d996f0f6fcd5f948d55124adbb2b9df5935`,
and strict contract to
`07e8278d393b4bd949758c8755239152ed294298f6b50b65d6e5a2b829ab75b2`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, Customer
build and both unit runners, the 285.9-second foundation, and all 13
Cloudflare commands pass. Customer's PGlite Jest integration lane remains
47/47 and explicit Vitest integration selection remains fail-closed.

The next package-management slice is Turn 83 only: make the proven Customer
unit shadow the default, preserve the exact Jest rollback, and remove the
temporary shadow key without changing integration, workflow, dependencies,
catalogs, lockfile, privacy/publication, persistence, or production.

## Customer Source-Unit Vitest Default Ownership

Commit:

- This commit (`test: switch Customer unit lane to Vitest`)

Date verified: 2026-07-31.

Customer now owns:

```text
test       vitest run --config vitest.config.mts
test:jest  jest --bail --passWithNoTests --forceExit --testPathPattern=src
```

The temporary shadow key is removed. Six pre/post/post-build reports match in
all 15 possible pairs at one file/one passed test with zero snapshots. Both
runners' `/4` distributions remain 1/0/0/0.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 41/22/19,
5/5/0, and 63/44/19. Customer moves exactly once to Vitest in applicable unit
graphs while its integration command remains Jest-owned.

Remaining-Jest counts stay 68/107/406. Only the byte-identical Customer Jest
command moves to `test:jest`; accepted ownership digest becomes
`591d4acff7892ba1b1cad404dea48f90fae73794e13b980dd6e5dbf138f32ebf`.
Normalized-LF hashes move only for the Customer manifest to
`3c775a816cc08ec3c132a0735b50f82f8cc5d055bd0d40df321ca1e2359f2898`,
strict contract to
`14cb17d5e7a990f3438b021de7aadf61aceeb4de1c466f5d9968c4c61c91a31d`,
and inventory file to
`e1255640386d95406afed99ac9fb66f843eb970d2391d1754913a55170248845`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, Customer
build and both unit runners, the 273.6-second foundation, and all 13
Cloudflare commands pass. Customer's PGlite Jest integration lane remains
47/47 and explicit Vitest integration selection remains fail-closed.

Dependencies, catalogs, overrides, lockfile, workspace shape,
privacy/publication metadata, workflow, persistence, production, and merge
preparation remain unchanged.

The next package-management slice is Turn 84 only: add an opt-in Customer
integration Vitest shadow after exact backend parity without changing the
integration default, workflow, dependencies, catalogs, lockfile,
privacy/publication, persistence, or production.

## Customer Integration Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Customer integration lane with Vitest`)

Date verified: 2026-07-31.

Customer retains its exact Jest integration default and adds one opt-in
`test:integration:vitest` command plus one exact-file integration config. The
root tooling typecheck owns that config exactly once. No package receives a new
dependency.

Nine PostgreSQL/PGlite/Drizzle reports preserve one file/47 tests and zero
snapshots under both runners, and all 36 report pairs pass. Both root PGlite
selectors pass 47/47. Both runners' `/3` distributions are 47/0/0, so the
later cut-over can remain in generic fast sharding without a dedicated job.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 41/22/19,
5/5/0, and 63/44/19. Customer remains Jest-owned in integration graphs and the
shadow has no graph or workflow owner.

Remaining-Jest counts stay 68/107/406; accepted digest becomes
`3c11614cf41f4ce3721b8863e983be278982d86700b3801b3d18aa324124361a`.
Normalized-LF hashes move to:

- root manifest:
  `3a44f9b95669f411355ad26fde293896d9ff7d150e6273b4d85bce06d1083ca0`;
- Customer manifest:
  `701373830fbdebc236d2fb3c031f3edbd0f8e5d879953cf9f52fb762bb269b9e`;
- integration config:
  `6fbdfe940a2039dd405df109ba6d84ee7c636db6507b451092371a752ef057e9`;
- PGlite runner:
  `6a9c383d9f8d53ae98759e7efdbc6673c2e14cc8411650a810022f380a4e6f2d`;
- integration verifier:
  `f9d1b0fa4a6a7ba1c8d6dc99266498e565ae59d1644cf67a0c61782a220f14f7`;
- strict contract:
  `923d8b0b0579f9a396d5d558e140d95fcbd42b9793d2c932a19617aa47d13592`;
- inventory file:
  `8f3a8819bd7f1104ed11333e174c1a50ebe7ec368d2ea23d3b7c4b56b428bbe9`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, Customer
build/unit runners, the 257.9-second foundation, and all 13 Cloudflare
commands pass. Dependencies, catalogs, overrides, lockfile, workspace shape,
privacy/publication metadata, workflow, persistence, production, and merge
preparation remain unchanged.

The next package-management slice is Turn 85 only: promote the proven Customer
integration shadow, retain exact Jest rollback, route both PGlite selectors,
and remain in generic fast sharding without adding a workflow job.

## Customer Integration Vitest Default Ownership

Commit:

- This commit (`test: switch Customer integration lane to Vitest`)

Date verified: 2026-07-31.

Customer promotes the proven integration config to `test:integration`, moves
the byte-identical Jest command to `test:integration:jest`, and removes the
temporary shadow key. The PGlite orchestrator routes its global Jest selector
to the rollback and explicit Vitest selector to the package default. No
package receives a dependency.

Twelve PostgreSQL/PGlite/Drizzle reports preserve one file/47 tests and zero
snapshots; all 66 report pairs and both real PGlite selectors pass. Both
runners distribute `/3` as 47/0/0, so Customer stays in generic fast sharding
without a workflow change.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 41/22/19,
5/5/0, and 63/44/19. Customer moves exactly once from Jest to Vitest in
fast/all integration and remains absent from slow.

Remaining-Jest counts stay 68/107/406; accepted digest becomes
`1778bcf206ba7712e20a726f4d1365315b5ad597d41d9c04811d48d429066bf4`.
Normalized-LF hashes move to:

- Customer manifest:
  `c62d5f7e7c1265e6dc2192e28aa507c7d5fde1d082cb29420af75d5d9fa76090`;
- PGlite runner:
  `ca773281faeca4b5737c138610da64fd6bf5f0b473ca53d55fdbb0cce9594ebe`;
- strict contract:
  `e943c82c25d333b74fc19d1a257c68b67a028b38a0c1eb994cf8112147e0730a`;
- inventory file:
  `72b045c89dbf91be53c131b87dcb593f7ddc42532188f94c4383e759f8692d7e`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, Customer
build/unit runners, the 257.3-second foundation, and all 13 Cloudflare
commands pass. Dependencies, catalogs, overrides, lockfile, workspace shape,
privacy/publication metadata, workflow, persistence, production, and merge
preparation remain unchanged.

The next package-management slice is Turn 86 only: add an opt-in Analytics
source-unit Vitest shadow without changing either Analytics default,
integration ownership, dependencies, catalogs, lockfile, workflow,
privacy/publication, persistence, or production.

## Analytics Source-Unit Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Analytics unit lane with Vitest`)

Date verified: 2026-07-31.

Analytics retains its exact Jest unit/integration defaults and adds one opt-in
`test:vitest` command plus one source-only config. The root tooling typecheck
owns that config exactly once. No package receives a dependency.

Five pre/post/post-build reports preserve one source file/one test and zero
snapshots under both runners; all 10 report pairs pass. Both runners'
authentic `/4` distributions are 1/0/0/0. The shadow has no graph or workflow
owner.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 41/22/19,
5/5/0, and 63/44/19. Analytics remains Jest-owned in applicable unit and
integration graphs. Its PGlite Jest integration passes 3/3 and explicit
Vitest integration selection remains fail-closed.

Remaining-Jest ownership stays byte-identical at 68/107/406, accepted digest
`1778bcf206ba7712e20a726f4d1365315b5ad597d41d9c04811d48d429066bf4`.
Normalized-LF hashes move to:

- root manifest:
  `f3071bc43b790bdf12236ebe4eb0039743cbf63b0b488dced9cb4848637907e0`;
- Analytics manifest:
  `bb7bda71dcd693273e4344ec543ea9d07755e7f1a1fb90c3949fbef733d678a5`;
- Analytics config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- strict contract:
  `45b29fe8041d1cae0ed45d172ec3b2be1086a36f80837583cd294fde287cbbf4`.

Frozen offline install across all 86 workspaces, exact `workspace:*`,
Analytics build/runners, the 259.7-second foundation, and all 13 Cloudflare
commands pass. Dependencies, catalogs, overrides, lockfile, workspace shape,
privacy/publication metadata, workflow, persistence, production, and merge
preparation remain unchanged.

The next package-management slice is Turn 87 only: promote the proven
Analytics source-unit shadow, retain exact Jest rollback, remove the temporary
shadow key, and leave integration ownership and all package-management/runtime
boundaries unchanged.

## Analytics Source-Unit Vitest Default Ownership

Commit:

- This commit (`test: switch Analytics unit lane to Vitest`)

Date verified: 2026-07-31.

Analytics promotes the proven source-unit Vitest command to `test`, moves the
byte-identical Jest command to `test:jest`, and removes `test:vitest`. The
integration default remains Jest-only. No package receives a dependency, and
the root tooling typecheck continues to own the existing Analytics config once.

Six reports preserve one file/one test and zero snapshots; all 15 report pairs
pass. Direct Vitest-default and Jest-rollback `/4` distributions remain
1/0/0/0. All seven graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0,
41/22/19, 5/5/0, and 63/44/19. Analytics moves once to Vitest in applicable
unit graphs and remains Jest-owned in applicable integration graphs.

The exact scoped root unit command exposed the older single-separator pnpm
`test` alias defect. Both unit-matrix lines now contain separate pnpm and Turbo
separators. Parsed contracts, 83-node general and 2-node serial dry graphs,
all four Analytics general shards, and all four Framework/Utils serial shards
prove the corrected forwarding. No integration workflow line changes.

Remaining-Jest ownership remains 68/107/406 and changes only the Analytics
script key from `test` to `test:jest`; accepted digest becomes
`10fbe08d6fac527f2bf5d0f9a7c5d3b7db7aa23db5046241378cb066d66d3bca`.
Normalized-LF hashes move to:

- Analytics manifest:
  `363ac47257c544a6db563842b18f60c0668855577371c6ff22cf251f3612f750`;
- strict contract:
  `886666826b06b0896802ab2ea0bf826238fe828a2e2a027bc824847533dd81cd`;
- inventory:
  `222e09bfbf705ac76952dd406132caf86730032f12606b8ac3b2592da1e8489c`;
- workflow:
  `cba622f101f8d859f440f530d3ba4c359782ddca948b1bf3f342d017df295cb9`.

Frozen offline install across all 86 workspaces, exact `workspace:*`,
Analytics build/runners, the 272.7-second foundation, and all 13 Cloudflare
commands pass. Dependencies, catalogs, overrides, lockfile, workspace shape,
privacy/publication metadata, persistence, production, and merge preparation
remain unchanged. Hosted workflow execution is not claimed.

The next package-management slice is Turn 88 only: add an Analytics integration
Vitest shadow without changing its Jest integration default, dependencies,
catalogs, lockfile, production composition, or package publication ownership.

## Analytics Integration Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Analytics integration lane with Vitest`)

Date verified: 2026-07-31.

Analytics retains its exact Jest integration default and adds one opt-in
`test:integration:vitest` command plus one exact-file integration config. The
root tooling typecheck owns that config and the checked CommonJS provider
fixture exactly once. No package receives a dependency.

Nine PostgreSQL/PGlite/Drizzle reports preserve one file/three tests and zero
snapshots under both runners; all 36 report pairs pass. Both root PGlite
selectors pass 3/3, File becomes the next fail-closed Vitest lane, and both
runners distribute `/3` as 3/0/0 with all shards successful.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 41/22/19,
5/5/0, and 63/44/19. Analytics remains Jest-owned in integration graphs, and
the shadow has no graph or workflow owner.

Remaining-Jest counts stay 68/107/406; accepted digest becomes
`4493c251a6d93e9ef7c86296779d6d9d6e6f00df573dcb6d154e56c0e233f334`.
Normalized-LF hashes move to:

- root manifest:
  `ed4a75d1c372c3e44a855f5b9ac9a39f44791ec982458949b3570cca3a80524a`;
- Analytics manifest:
  `65393f2f57d9b88365483babd272148ed06ca07a659926a4ae6b5150c56f5b10`;
- integration config:
  `60b74722fe1a4e2e2aec0fe8581613c2f771548f0db6283076a240005a47e727`;
- strict contract:
  `9b7f5024ffc686454fb3ebea88b3b9c34d9d4be383ff8515618092f16bf06bb7`;
- inventory file:
  `357cdac7c9afa401315d290ff0d675bdcdda65d564a73dd71e35f33f81a18108`.

Frozen offline install across all 86 workspaces, exact `workspace:*`,
Analytics build/unit runners, the 348.5-second foundation, and all 13
Cloudflare commands pass. Dependencies, catalogs, overrides, lockfile,
workspace shape, privacy/publication metadata, workflow, persistence,
production, and merge preparation remain unchanged.

The next package-management slice is Turn 89 only: promote the proven
Analytics integration shadow, retain exact Jest rollback, route both PGlite
selectors, and remain in generic fast sharding without adding a workflow job.

## Analytics Integration Vitest Default Ownership

Commit:

- This commit (`test: switch Analytics integration lane to Vitest`)

Date verified: 2026-07-31.

Analytics now owns Vitest at `test:integration` and preserves the exact Jest
command at `test:integration:jest`; the temporary shadow key is removed. The
PGlite orchestrator maps the two runner selectors to those established
package commands. No package dependency or root command changes.

Twelve PostgreSQL/PGlite/Drizzle reports preserve one file/three tests and
zero snapshots under both runners; all 66 report pairs pass. Both root PGlite
selectors pass, File remains fail-closed for Vitest, and both runners retain
the `/3` distribution 3/0/0.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 41/22/19,
5/5/0, and 63/44/19. Analytics moves once to Vitest in fast/all integration,
stays absent from slow, and needs no workflow edit or dedicated job.

Remaining-Jest counts stay 68/107/406; accepted digest becomes
`fe53124f95797aaaa8156f2cdcf07371e495f2a56dd98d3600c2d72ab695b3f8`.
Normalized-LF hashes move to:

- Analytics manifest:
  `8b397fe78ac7053b7efc5574fa8336891705895d4936a0defe1e422f2c086e91`;
- PGlite orchestrator:
  `e982bb4c0111a3e6adfb64906430f61ec86924ce86d622feaae36f35e810a85f`;
- strict contract:
  `20140afcd058f1933dd033088d8918deb92dfe26f89b30cfacf90731c8387e13`;
- inventory:
  `66cda6d6f10003f10acf118aa166bf892c4b7e2650fefe932a51dcd09ae4745c`.

Frozen offline install across all 86 workspaces, exact `workspace:*`,
Analytics build/runners, the 329.9-second foundation, and all 13 Cloudflare
commands pass. Dependencies, catalogs, overrides, lockfile, workspace shape,
privacy/publication metadata, workflow, persistence, production, and merge
preparation remain unchanged. No hosted GitHub Actions result is claimed.

The next package-management slice is Turn 90 only: add a File source-unit
Vitest shadow without changing either Jest default, its separate integration
lane, dependencies, catalogs, lockfile, workflow, or publication ownership.

## File Source-Unit Vitest Shadow Ownership

Commit:

- This commit (`test: shadow File unit lane with Vitest`)

Date verified: 2026-07-31.

File retains its exact Jest unit and integration defaults and gains one opt-in
`test:vitest` command plus one four-alias source-only config. The root strict
tooling command owns that config exactly once. No package receives a
dependency.

Five fresh pre/post/post-build reports preserve two files/two tests, ten
expectation sites, and zero Jest APIs or snapshots under both runners. All 10
report pairs pass with digest
`d13d56d514b40ce97e7e19da791470cdc34f95587b1fe48673d88c99cae9a3cf`.
Direct Jest/Vitest and scoped root Jest `/4` runs all distribute 1/1/0/0.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 41/22/19,
5/5/0, and 63/44/19. File remains Jest-owned in unit and integration graphs;
the shadow has no graph, workflow, aggregate, or hosted owner. The unchanged
PGlite Jest integration lane passes one file/four tests, while Vitest
selection remains fail-closed before spawn.

Remaining-Jest ownership stays byte-identical at 68/107/406, accepted digest
`fe53124f95797aaaa8156f2cdcf07371e495f2a56dd98d3600c2d72ab695b3f8`.
Normalized-LF hashes move to:

- root manifest:
  `501b1875d478072ff0fedfb3ce38b4071cc6787a046832882a8df552e55a7f8e`;
- File manifest:
  `e7e213ea859825b730e8804a783cab1b734f45fe4d7454b06c97f53ad332ffe9`;
- new File Vitest config:
  `52958a368def2a79e1d0cfd5c8278d996f0f6fcd5f948d55124adbb2b9df5935`;
- strict contract:
  `d2e6bd229db95f9a641eb786b8981f3889777d73322f155444786ceec834e5f2`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, File
build/runners, the complete 515.1-second foundation rerun, and the complete
288.6-second 13-command Cloudflare rerun pass. Dependencies, catalogs,
overrides, lockfile, workspace shape, privacy/publication metadata, workflow,
persistence, production, and merge preparation remain unchanged. No hosted
GitHub Actions result is claimed.

The next package-management slice is Turn 91 only: promote the proven File
source shadow to default with exact Jest rollback, without changing its
separate integration lane, dependencies, catalogs, lockfile, workflow, or
publication ownership.

## File Source-Unit Vitest Default Ownership

Commit:

- This commit (`test: switch File unit lane to Vitest`)

Date verified: 2026-07-31.

File now owns Vitest at `test`, preserves the byte-identical Jest command at
`test:jest`, and removes the temporary `test:vitest` key. Its source tests,
four-alias config, separate Jest integration command, and all dependency
metadata remain unchanged. No syntax adapter is required because the two
source files contain zero Jest-only APIs.

Six pre/post/post-build reports preserve two files/two tests and zero snapshots
under both runners. All 15 pairs pass with digest
`d13d56d514b40ce97e7e19da791470cdc34f95587b1fe48673d88c99cae9a3cf`;
direct Vitest, direct Jest rollback, and scoped-root Vitest `/4` runs all
distribute 1/1/0/0.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 41/22/19,
5/5/0, and 63/44/19. File moves once to Vitest in applicable unit graphs while
its integration lane remains once on Jest. PGlite integration passes 4/4
before and after; explicit Vitest integration selection remains fail-closed.

Remaining-Jest counts stay 68/107/406; only the rollback script key moves and
the accepted digest becomes
`0ea4911f5dbf19a794830d9356bb63f2615f9785f0fe714206b787116b1d8902`.
Normalized-LF hashes move to:

- File manifest:
  `548b5d44da385bc357502956f5bb0a0c60fd19660ade5e5b6026e8984c2f42d4`;
- strict contract:
  `de9d379d41c941f65727588850b181a32f415f6f43f722f78af9e444f647df0c`;
- inventory:
  `d3bf075eb6bbb86e87b285af497860ed34bc532178ba2fec8e17295093bf34f1`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, File
build/runners, the complete 529.7-second foundation, and the complete
218.2-second 13-command Cloudflare set pass. Dependencies, catalogs,
overrides, lockfile, workspace shape, privacy/publication metadata, workflow,
persistence, production, and merge preparation remain unchanged. No hosted
GitHub Actions result is claimed.

The next package-management slice is Turn 92 only: add File's separate
integration Vitest shadow and explicitly migrate its single Jest-only timeout
API, without changing the proven unit default or dependency/publication
ownership.

## File Integration Native Vitest Shadow Ownership

Commit:

- This commit (`test: shadow File integration lane with Vitest`)

Date verified: 2026-07-31.

File keeps Jest at `test:integration`, moves its 100-second timeout from the
source global into that command, and adds `test:integration:vitest`. The new
config uses the shared serial integration profile without the legacy bridge
and owns matching test/hook timeouts. Existing profile consumers preserve
their current defaults.

The path-loaded provider fixture moves from TypeScript to strictly checked
CommonJS JavaScript because the built Medusa loader cannot resolve the raw
TypeScript path under native Vitest. The root tooling command owns both the new
config and checked fixture exactly once. No package dependency is added.

Nine PostgreSQL/PGlite/Drizzle reports preserve one file/four tests, six
expectation sites, and zero snapshots under Jest and native Vitest. All 36
pairs pass with digest
`976233a8271cf7b030f1f3ad625e4135f120c94331e742793ff0f85d1c1252ee`.
Both PGlite selectors pass 4/4, Stock Location is the next fail-closed lane,
and both PostgreSQL `/3` aggregates are 4/0/0.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 41/22/19,
5/5/0, and 63/44/19. File integration remains Jest-owned in fast/all and
absent from slow; its shadow has no graph or workflow owner.

Remaining-Jest ownership becomes 68 configs, 107 scripts, and 405 API files;
accepted digest becomes
`89031c157378f4eda7b203569918756f0ba8be86069163b1819a1a985c1e0787`.
Key normalized-LF hashes are:

- root manifest:
  `eba2f8c70f004122f06145f7ff171890b9248d445d5e3b669379582720eda7ce`;
- File manifest:
  `7f1b43af60c051de762f24199792ec82b7fa3d10e220ae8ec1e7f30879465e97`;
- integration source:
  `dd8b415a5cfe357e0d39ee82eca960ac2a8c85d18dcbf1ae8ef525aebeb2cffe`;
- checked provider fixture:
  `1d9fe1a76d9562a6ea8b0deef4c17dca63ecadb51bbd3cabccf2d0faf6665de0`;
- new integration config:
  `92e1d02f11f99fc1954999aa5f76171556d59d69862bfdcc58040c666eead715`;
- strict contract:
  `e27645053d96fdd209f61489e844f63b2bd35ae73e22e577d717876bab30caaf`;
- inventory:
  `821fb69692e515dd54dc5130ba1aa9084616392d7efd350a7e63ceeccfc895de`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, File
build/runners, the complete 416.7-second foundation, and the complete
240.1-second 13-command Cloudflare set pass. Dependencies, catalogs,
overrides, lockfile, workspace shape, privacy/publication metadata, workflow,
production composition, and merge preparation remain unchanged. No hosted
GitHub Actions result is claimed.

The next package-management slice is Turn 93 only: promote the proven File
integration shadow with exact Jest rollback. Its successful 4/0/0 aggregate
requires no workflow or dependency change.

## File Integration Vitest Default Ownership

Commit:

- This commit (`test: switch File integration lane to Vitest`)

Date verified: 2026-08-01.

File now owns native Vitest at `test:integration`, preserves the exact Jest
command at `test:integration:jest`, and removes `test:integration:vitest`.
The PGlite orchestrator points its Jest and Vitest modes at those stable
rollback/default keys. No dependency, catalog, override, lockfile, workspace,
workflow, privacy/publication, or package export changes.

Twelve PostgreSQL/PGlite/Drizzle reports and all 66 pairs preserve one
file/four tests, six expectation sites, zero snapshots, and digest
`976233a8271cf7b030f1f3ad625e4135f120c94331e742793ff0f85d1c1252ee`.
Both PGlite selectors pass 4/4, Stock Location remains fail-closed, and both
PostgreSQL `/3` aggregates stay 4/0/0.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 41/22/19,
5/5/0, and 63/44/19. File moves exactly once to Vitest in fast/all integration
without a workflow edit. Remaining-Jest ownership stays 68/107/405 with
accepted digest
`a0d41f08e8e41db25bbfcf6555c369d80c32ffa4a530db18018bc05eb9c3a20a`.

Key normalized-LF hashes become:

- File manifest:
  `eb10c87e5abfdf5254c76adf119940c6eac0267dbd39a657426ac12cb5622806`;
- PGlite orchestrator:
  `572eee29bf9bead59ec18dfa82825bcf0a28cc773276d8df2c5bda49787a5ba7`;
- strict contract:
  `3f3b56042bf45d5647f372f888d345b3eacb588aa0b1caca8682c3e3b33b17c4`;
- inventory:
  `545e1d64efda91b8bd175d3786aee5b5ebaea0414aeef76e72067de1f78378d9`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, File
build/runners, strict tooling, the complete 395.5-second foundation, and the
complete 237.5-second 13-command Cloudflare set pass. Early native V8 OOMs
under host commit pressure passed on unchanged retries; no repository memory
or timeout workaround was added. No hosted GitHub Actions result is claimed.

The next package-management slice is Turn 94 only: add a Stock Location
source-unit Vitest shadow without changing either default, dependencies,
catalogs, workflow, or publication ownership.

## Stock Location Source-Unit Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Stock Location unit lane with Vitest`)

Date verified: 2026-08-01.

Stock Location keeps both exact Jest defaults and adds only the opt-in
`test:vitest` source command. Its new shared-profile config owns the package's
existing five aliases and is strictly typechecked exactly once. No dependency,
catalog, override, lockfile, workspace, workflow, export, or
privacy/publication metadata changes.

Five reports and all 10 pairs preserve two source files/two tests, nine
expectation sites, zero Jest APIs/snapshots, and digest
`9a8130aa81ad85e8d365607af15e580125a8dc2c8e44cbb90286bc737625264c`.
Both direct `/4` aggregates and the scoped-root Jest aggregate pass at
1/1/0/0. The unchanged PGlite Jest integration passes 8/8 before and after;
explicit Vitest integration selection remains fail-closed before spawn.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 41/22/19,
5/5/0, and 63/44/19. Stock Location remains Jest-owned in applicable graphs;
the shadow has no workflow owner. Remaining-Jest ownership stays 68/107/405
with accepted digest
`a0d41f08e8e41db25bbfcf6555c369d80c32ffa4a530db18018bc05eb9c3a20a`.

Key normalized-LF hashes become:

- root manifest:
  `7c0bbce44ae0fc4e17ee3dd8875ac4fb9dcdbf7999a98a4e29996d36d8c13707`;
- Stock Location manifest:
  `23154481cc7c0de43df51702163ffc477cb15ed802195b5b4c23cfa8deaef2f4`;
- new source config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- strict contract:
  `86d511a5c0c78f1c63568391edd529a082b962b3830780252d4c997678269f44`;
- unchanged inventory:
  `545e1d64efda91b8bd175d3786aee5b5ebaea0414aeef76e72067de1f78378d9`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, Stock
Location build/runners, strict tooling, the complete 396.8-second foundation,
and the complete 248.7-second 13-command Cloudflare set pass. No hosted GitHub
Actions result is claimed.

The next package-management slice is Turn 95 only: promote the proven source
shadow with exact Jest rollback, without changing integration, dependencies,
catalogs, workflow, or publication ownership.

## Stock Location Source-Unit Vitest Default Ownership

Commit:

- This commit (`test: switch Stock Location unit lane to Vitest`)

Date verified: 2026-08-01.

Stock Location now owns native Vitest at `test`, preserves the exact previous
Jest command at `test:jest`, and removes `test:vitest`. Its integration default
remains Jest. No dependency, catalog, override, lockfile, workspace, workflow,
export, or privacy/publication metadata changes.

Six reports and all 15 pairs preserve two source files/two tests, nine
expectation sites, zero Jest APIs/snapshots, and digest
`9a8130aa81ad85e8d365607af15e580125a8dc2c8e44cbb90286bc737625264c`.
Default Vitest, Jest rollback, and scoped-root default `/4` aggregates all pass
at 1/1/0/0. The unchanged PGlite Jest integration passes 8/8 before and after;
explicit Vitest integration selection stays fail-closed before spawn.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 41/22/19,
5/5/0, and 63/44/19. Stock Location moves once to Vitest only in applicable
unit graphs. Remaining-Jest ownership stays 68/107/405 with accepted digest
`f823411e2055f8c528416f42061a7262a5aa68f2c87b0ada7c863a19c7bc2110`.

Key normalized-LF hashes become:

- Stock Location manifest:
  `f6e71d355143c742aab8999ff4e685be77101fd1cd5750ef7f49c3af6b338047`;
- strict contract:
  `ed04fce0f3ec83339e4733e59c9662619b631e300658e74252346a64a648e556`;
- inventory:
  `91f58bc770261be0c3727c19617c6dcf63b7858fefe9b71728a63c82865e4f67`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, Stock
Location build/runners, strict tooling, the complete 387.0-second foundation,
and the complete 130.8-second 13-command Cloudflare set pass. No hosted GitHub
Actions result is claimed.

The next package-management slice is Turn 96 only: add the separate Stock
Location integration shadow and move its Jest-only timeout to runner-owned
configuration without changing the proven unit default or package ownership.

## Stock Location Integration Native Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Stock Location integration lane with Vitest`)

Date verified: 2026-08-01.

Stock Location keeps Jest at `test:integration` with an explicit 100-second
CLI timeout and adds `test:integration:vitest` backed by a strictly checked
native/no-bridge config. Its source-level `jest.setTimeout` is removed. No
dependency, catalog, override, lockfile, workspace, export,
privacy/publication, or workflow metadata changes.

Nine PostgreSQL/PGlite/Drizzle reports and all 36 pairs preserve one file,
eight passed tests, nine expectation sites, zero snapshots, and digest
`9cdd60a75316fb7d555d48e0e3456686eaffee0189273a61df9cad0992bae990`.
Both PGlite selectors pass 8/8 and Inventory becomes the next fail-closed
Vitest lane. Jest's real `/3` aggregate is 8/0/0; Vitest rejects the one-file
`/3` request, proving that default cut-over requires dedicated unsharded
PostgreSQL workflow ownership.

All seven graph shapes remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 41/22/19,
5/5/0, and 63/44/19. The shadow has no graph or workflow owner. Remaining-Jest
ownership becomes 68 configs, 107 scripts, and 404 API files with accepted
digest
`2cc63584311e26acd4c03f3d6b28cd844e46fe82576702958c30ad94e4553f0a`.

Key normalized-LF hashes become:

- root manifest:
  `03bb6eb9dee7a8c3f121d92275a1f90926262821a9613988e7810f07ad7ad87e`;
- Stock Location manifest:
  `ebf6315c4002f086297b3ac8222263c03f49af74fb704b6c4e1faefb7aa2e041`;
- integration source:
  `51aae9196ebdda1242c260f667fe82391d323f28885eb3d0e7cade81f44ad7e6`;
- new integration config:
  `b16f68566d6a5a357f8c38f01fe875cc06ad4f23a5d385a9bdea362a83aa6286`;
- PGlite orchestrator:
  `1df367f39fab11a17c441540ee8eb510ef28367ca46b6c983f74e66910763a7a`;
- strict contract:
  `accb5ed539047c32ff4e4ad077956e3d509fc18ebeaecf7838358c7a1198eb2d`;
- inventory:
  `de0b99a3f63f37f6dad45f2f47501ec35bff1fd954cf537efa76c031d8d68d90`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, Stock
Location runners, strict tooling, the complete 331.7-second foundation, and
all 13 Cloudflare gates pass after one unchanged workerd-startup retry. Vite
8.2.0 with built-in Rolldown and Vitest 4.1.10 remain unchanged. No hosted
GitHub Actions result is claimed.

The next package-management slice is Turn 97 only: promote the integration
shadow with exact Jest rollback and add the required dedicated unsharded
PostgreSQL workflow owner, without changing dependencies, catalogs, exports,
or publication ownership.

## Stock Location Integration Vitest Default Ownership

Commit:

- This commit (`test: switch Stock Location integration lane to Vitest`)

Date verified: 2026-08-01.

Stock Location now owns native Vitest at `test:integration`, preserves the
exact Jest command at `test:integration:jest`, and removes the temporary
shadow key. The PGlite orchestrator selects those stable default/rollback
keys. No dependency, catalog, override, lockfile, workspace, export, or
privacy/publication metadata changes.

Twelve PostgreSQL/PGlite/Drizzle reports and all 66 pairs preserve one file,
eight tests, nine expectation sites, zero snapshots, and digest
`9cdd60a75316fb7d555d48e0e3456686eaffee0189273a61df9cad0992bae990`.
Both PGlite selectors pass 8/8 and Inventory remains fail-closed.

Stock Location is excluded from fast `/3` ownership and receives one locally
contract-tested, runner-neutral, unsharded PostgreSQL workflow job with
aggregate failure/success propagation. Dry integration shapes become
40/21/19 fast, 5/5/0 slow, and 63/44/19 all. Remaining-Jest ownership stays
68/107/404 with accepted digest
`26bde82560b12f9c5b3d3f284ba3060f1ce9386768f7d649bec840383004b6d8`.

Key normalized-LF hashes become:

- root manifest:
  `24c73ca633b086ea807c6c06f93d99f4521db0d00d7050c3c2d2a702b321986e`;
- Stock Location manifest:
  `1cc5a5affab5f970de9058159b1a658eb7406af1aedc13c53dee8d53f225c052`;
- PGlite orchestrator:
  `cf536cbb0dd2a5d28646a84dfe0f3061c8b8ee66c5a64f3f25d6619ad8972032`;
- workflow:
  `76e57af8b8ab873a981d6565e5c57e1a2dad89a09a6f51d789f203f0b5f88b38`;
- strict contract:
  `64dad993d4325a4325ef2786ae37137431dc6955b21e610db6fc5206faff5e42`;
- inventory:
  `3d7e4db344e70cd88191eb75055b238dc375e87f61d5242ea32779474790f347`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, Stock
Location runners, strict tooling, the complete 315.4-second foundation, and
all 13 Cloudflare gates pass after stopping the completed isolated PostgreSQL
cluster relieved local workerd startup pressure. Vite 8.2.0 with built-in
Rolldown and Vitest 4.1.10 remain unchanged. No hosted GitHub Actions result
is claimed.

The next package-management slice is Turn 98 only: add an Inventory source-unit
Vitest shadow without changing dependencies, catalogs, integration ownership,
or publication metadata.

## Inventory Source-Unit Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Inventory unit lane with Vitest`)

Date verified: 2026-08-01.

Inventory retains both exact Jest defaults and adds only `test:vitest` plus a
source-only shared Vitest/SWC config. The new config is strictly typechecked
exactly once and owns the same five aliases as the existing Jest config. No
dependency, catalog, override, lockfile, workspace, export, or
privacy/publication metadata changes.

Five pre/post/post-build reports and all ten pairs preserve two files, two
tests, ten expectation sites, zero snapshots, and normalized digest
`d8c5611e5df9f41668483147d1eb09c6a48dd918db1a17d3596e5e366617a9ce`.
Direct Jest, direct Vitest, and the authentic root-scoped Jest command all pass
four-way sharding at 1/1/0/0 across 12 valid probes.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 40/21/19,
5/5/0, and 63/44/19. Inventory stays Jest-owned exactly once where applicable;
the opt-in shadow has no task-graph, workflow, aggregate, or hosted owner.
Remaining-Jest ownership stays byte-identical at 68/107/404 with accepted
digest
`26bde82560b12f9c5b3d3f284ba3060f1ce9386768f7d649bec840383004b6d8`.

Key normalized-LF hashes move only at the source-shadow ownership boundary:

- root manifest:
  `24c73ca633b086ea807c6c06f93d99f4521db0d00d7050c3c2d2a702b321986e`
  to `5ab818ab10776c8c27ed5761d232a72185b83e01e68bbbf1f3c4762485ae90c6`;
- Inventory manifest:
  `b91bbbf49df48a99603266bffd97bee85af5acc2878c82f0191ec2ef33a8a535`
  to `0f1d6ab5e52ff3f242a59f1e3bc619ece6cb091e376ac2f03722837b4d44351d`;
- new Inventory Vitest config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- strict contract:
  `64dad993d4325a4325ef2786ae37137431dc6955b21e610db6fc5206faff5e42`
  to `2ce2b84a91c0b382590de5c115e5b48295f8ad7daa873078bccaf4be12e2f983`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, Inventory
build/runners, strict tooling, the complete 349.0-second foundation, and all
13 Cloudflare gates pass after one unchanged local workerd-startup retry.
Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain unchanged. No
hosted GitHub Actions result is claimed.

The next package-management slice is Turn 99 only: promote the proven Inventory
source shadow while retaining exact Jest rollback and keeping integration
Jest-only.

## Inventory Source-Unit Vitest Default Ownership

Commit:

- This commit (`test: switch Inventory unit lane to Vitest`)

Date verified: 2026-08-01.

Inventory now owns Vitest at `test`, preserves the exact previous Jest command
at `test:jest`, and removes the temporary shadow key. The source-only config
and its single strict typecheck entry remain unchanged. No dependency,
catalog, override, lockfile, workspace, export, or privacy/publication metadata
changes.

Six pre/post/post-build reports and all 15 pairs preserve two files, two tests,
ten expectation sites, zero snapshots, and normalized digest
`d8c5611e5df9f41668483147d1eb09c6a48dd918db1a17d3596e5e366617a9ce`.
Default Vitest, exact Jest rollback, and the authentic root-scoped default all
pass four-way sharding at 1/1/0/0 across 12 commands.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 40/21/19,
5/5/0, and 63/44/19. Inventory moves exactly once from Jest to Vitest in
applicable unit graphs while integration stays Jest-owned. Remaining-Jest
ownership stays 68/107/404; only the exact rollback key moves, with accepted
digest
`4ba7781d052ed7438a21cca958811c8cc19ac96b97320db89bce2358b5f05c0c`.

Normalized-LF hashes move only at the cutover boundary:

- Inventory manifest:
  `0f1d6ab5e52ff3f242a59f1e3bc619ece6cb091e376ac2f03722837b4d44351d`
  to `2ed3bd52d28cc3d12a2f4ac4da470414858de7459310bed2a264e17e52735695`;
- strict contract:
  `2ce2b84a91c0b382590de5c115e5b48295f8ad7daa873078bccaf4be12e2f983`
  to `646031741912a18b5d02a461dd3e1a5c11326939bc9b7cee8c670839efa587ef`;
- remaining-Jest inventory:
  `3d7e4db344e70cd88191eb75055b238dc375e87f61d5242ea32779474790f347`
  to `503ea180ee7905de4c7983ce54eaa0f279baabea7a7893844c7508eec5107a48`.

The root manifest, Vitest config, PGlite orchestrator, workflow, dependency
graph, catalogs, and lockfile remain unchanged. Frozen offline install across
all 86 workspaces, exact `workspace:*`, Inventory build/runners, strict
tooling, the complete 352.6-second foundation, and the uninterrupted
140.2-second 13-command Cloudflare set pass. Vite 8.2.0 with built-in Rolldown
and Vitest 4.1.10 remain unchanged. No hosted GitHub Actions result is claimed.

The next package-management slice is Turn 100 only: add a separate Inventory
integration Vitest shadow without changing dependencies, catalogs, workflow
ownership, or publication metadata.

## Inventory Integration Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Inventory integration lane with Vitest`)

Date verified: 2026-08-01.

Inventory retains Jest at `test:integration` and adds only the opt-in
`test:integration:vitest` command. The new native/no-bridge config and narrow
package-local Jest rollback shim are each owned exactly once by strict root
tooling. No dependency, catalog, override, lockfile, workspace, export,
privacy/publication, workflow, or repository-merge metadata changes.

The source now uses imported `vi.spyOn` and contains zero `jest.*`; runner
timeouts live in the Jest CLI and Vitest config. Both runners pass one file/35
tests on PostgreSQL, PGlite, and Drizzle/SQLite. Both PGlite selectors pass.
The shadow remains outside task/workflow graphs because its one file rejects
generic Vitest `/3` sharding.

Remaining-Jest ownership moves from 68/107/404 to 68/107/403 with accepted
digest `e943997da072baa63400a7384b784e1d3dad4ec755e10ab2bcf99f69fa4ebd89`.
Frozen offline install across all 86 workspaces, exact `workspace:*`, Inventory
build, strict tooling, ten contracts, the complete 417.1-second foundation,
and all 13 Cloudflare gates pass in 202.6 seconds. Vite 8.2.0 with built-in
Rolldown and Vitest 4.1.10 remain unchanged. No hosted CI result is claimed.

The next package-management slice is Turn 101 only: promote the proven
integration shadow with exact Jest rollback and dedicated unsharded ownership.

## Inventory Integration Vitest Default Ownership

Commit:

- This commit (`test: switch Inventory integration lane to Vitest`)

Date verified: 2026-08-01.

Inventory moves the proven native integration command to `test:integration`,
moves the byte-identical Jest command to `test:integration:jest`, and removes
the shadow key. The generic fast graph excludes Inventory, while one dedicated
runner-neutral PostgreSQL workflow job owns the unsharded default and propagates
its result to the package aggregate.

No dependency, catalog, override, lockfile, workspace, export,
privacy/publication, or repository-merge metadata changes. Remaining-Jest
counts stay 68/107/403 with digest
`19528db8149de345cffbe190041bc9a54fa948c983f9b4a4f9cacb5b413ee0d2`.
Frozen install across 86 workspaces, exact `workspace:*`, strict tooling, the
complete 451.9-second foundation, and the uninterrupted 212.9-second
Cloudflare set pass. The workflow shape is locally contract-tested; its first
hosted result remains deferred.

The next package-management slice is Turn 102 only: add a Tax source-unit
shadow without changing integration, CI, dependency, or publication ownership.

## Tax Source-Unit Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Tax unit lane with Vitest`)

Date verified: 2026-08-01.

Tax retains its exact Jest `test` and `test:integration` defaults. The package
adds only an opt-in `test:vitest` command and source-only shared Vitest config;
the root strict tooling command adds that config exactly once. No dependency,
catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes.

Five reports and all ten pairs preserve two source files, two tests, 12 direct
expectation calls, zero snapshots, and normalized digest
`91fc1cde13d3187d8162b508ce3350cf7c05aae3fe5c0c81fc5613385c74ffe5`.
Direct Jest, direct Vitest, and authentic root-scoped Jest commands all pass
four-way sharding at 1/1/0/0 across 12 commands.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 39/20/19,
5/5/0, and 63/44/19. Tax stays Jest-owned exactly once where applicable; the
opt-in shadow has no task-graph, workflow, aggregate, or hosted owner. The
unchanged PGlite Jest integration passes two files/35 tests, while Tax/Vitest
integration selection fails closed before spawn.

Remaining-Jest ownership stays byte-identical at 68 configs, 107 scripts, and
403 API files with accepted digest
`19528db8149de345cffbe190041bc9a54fa948c983f9b4a4f9cacb5b413ee0d2`.
Frozen offline install across all 86 workspaces, exact `workspace:*`, Tax
build/runners, strict tooling, the complete 461.6-second foundation, and all 13
Cloudflare gates pass in 129.2 seconds. Vite 8.2.0 with built-in Rolldown and
Vitest 4.1.10 remain unchanged. No hosted GitHub Actions result is claimed.

The next package-management slice is Turn 103 only: promote the proven Tax
source shadow while retaining exact Jest rollback and keeping integration
Jest-only. It must not combine catalogs, package privatization, dependencies,
CI, or publication changes.

## Tax Source-Unit Vitest Default Ownership

Commit:

- This commit (`test: switch Tax unit lane to Vitest`)

Date verified: 2026-08-01.

Tax now owns Vitest at `test`, preserves the exact previous Jest command at
`test:jest`, and removes the temporary shadow key. The source-only config and
its single strict typecheck entry remain unchanged. No dependency, catalog,
override, lockfile, workspace, export, workflow, CI, privacy/publication, or
repository-merge metadata changes.

Six pre/post/post-build reports and all 15 pairs preserve two source files, two
tests, 12 direct expectation calls, zero snapshots, and normalized digest
`91fc1cde13d3187d8162b508ce3350cf7c05aae3fe5c0c81fc5613385c74ffe5`.
Default Vitest, exact Jest rollback, and the authentic root-scoped default all
pass four-way sharding at 1/1/0/0 across 12 commands.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 39/20/19,
5/5/0, and 63/44/19. Tax moves exactly once from Jest to Vitest in applicable
unit graphs while integration stays Jest-owned. Both pre/post PGlite Jest
selectors pass two files/35 tests; Tax/Vitest integration remains fail-closed.

Remaining-Jest ownership stays 68 configs, 107 scripts, and 403 API files;
only the exact rollback command key moves, with accepted digest
`84b4fc54e05453714b3aa302a48a4c612b1b9065d9ec37c9f051785965adcfad`.
Frozen offline install across all 86 workspaces, exact `workspace:*`, Tax
build/runners, strict tooling, the complete 535.8-second foundation, and the
uninterrupted 115.1-second Cloudflare set pass. Vite 8.2.0 with built-in
Rolldown and Vitest 4.1.10 remain unchanged. No hosted GitHub Actions result is
claimed.

The next package-management slice is Turn 104 only: add a separate Tax
integration Vitest shadow without changing dependencies, catalogs, workflow,
CI, publication, or repository-merge ownership.

## Tax Integration Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Tax integration lane with Vitest`)

Date verified: 2026-08-01.

Tax retains Jest at `test:integration` and adds an opt-in
`test:integration:vitest` command. Its new two-file native/no-bridge config is
owned exactly once by strict root tooling. The two source timeout calls move to
the Jest CLI and Vitest config; no assertions change.

Both runners pass two files/35 tests on isolated PostgreSQL 18, PGlite, and
Drizzle/SQLite, and all 36 pairs across nine reports are exact. Both PGlite
selectors pass. Jest `/3` remains 34/1/0, while all Vitest `/3` commands reject
because three shards exceed two files, so the shadow receives no CI owner.

No dependency, catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes. Remaining-Jest
ownership becomes 68 configs, 107 scripts, and 401 API files with accepted
digest `03652555ffb8f16b9fb5dba556ad6fa972ffdaccba6275c770c0d776c4bb257a`.
Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 367.0-second foundation, and all 13 Cloudflare gates in
172.8 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted CI result is claimed.

The next package-management slice is Turn 105 only: promote the proven Tax
integration shadow with exact Jest rollback and dedicated unsharded PostgreSQL
ownership. It must not combine catalogs, privatization, dependencies, or
publication changes.

## Tax Integration Vitest Default Package Ownership

Commit:

- This commit (`test: switch Tax integration lane to Vitest`)

Date verified: 2026-08-01.

Tax now maps `test:integration` to the existing native Vitest config, retains
the exact prior Jest command at `test:integration:jest`, and removes
`test:integration:vitest`. The root fast graph excludes Tax because its two
files cannot consume `/3`; one dedicated unsharded PostgreSQL workflow job and
aggregate propagation own the default command.

No dependency, catalog, override, lockfile, workspace, export,
privacy/publication, or repository-merge metadata changes. Remaining-Jest
counts stay 68/107/401 with accepted digest
`a9c763420f7f77d4c19d8a3423f78e9185d9663953d8f1aa46127882e1fef4b5`.
Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 359.8-second foundation, and all 13 independent
Cloudflare gates pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10
remain unchanged. No hosted CI result is claimed.

The next package-management slice is Turn 106 only: add a Payment source-unit
Vitest shadow without combining dependencies, catalogs, privatization,
workflow, CI, or publication changes.

## Payment Source-Unit Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Payment unit lane with Vitest`)

Date verified: 2026-08-01.

Payment retains its exact Jest `test` and `test:integration` defaults. The
package adds only an opt-in `test:vitest` command and source-only shared Vitest
config; the root strict tooling command adds that config exactly once.

No dependency, catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes. Five reports and
all ten pairs preserve two source files, three tests, 20 direct expectation
calls, and zero snapshots. Direct Jest, direct Vitest, and authentic
root-scoped Jest `/4` probes all pass with aggregate two-file/three-test
coverage.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 38/19/19,
5/5/0, and 63/44/19. The opt-in shadow has no graph, workflow, aggregate, or
hosted owner. Remaining-Jest ownership stays byte-identical at 68 configs, 107
scripts, and 401 API files with accepted digest
`a9c763420f7f77d4c19d8a3423f78e9185d9663953d8f1aa46127882e1fef4b5`.
Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 494.7-second foundation, and all 13 Cloudflare gates in
234.7 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted result is claimed.

The next package-management slice is Turn 107 only: promote the proven Payment
source shadow with exact Jest rollback. It must not combine integration,
catalogs, privatization, dependencies, workflow, CI, or publication changes.

## Payment Source-Unit Vitest Default Package Ownership

Commit:

- This commit (`test: switch Payment unit lane to Vitest`)

Date verified: 2026-08-01.

Payment now maps `test` to the existing native/no-bridge Vitest config, retains
the exact prior Jest source command at `test:jest`, and removes `test:vitest`.
The separate Jest `test:integration` command remains unchanged.

No dependency, catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes. Six reports and all
15 pairs preserve two source files, three tests, 20 direct expectation sites,
zero snapshots, and digest
`c6e366aa9379fd5e02aef08add09a1f2aee430fa8b731b55203d501e5ca87c72`.
Default Vitest, exact Jest rollback, and authentic root-scoped default `/4`
probes pass across all 12 commands with aggregate two-file/three-test coverage.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 38/19/19,
5/5/0, and 63/44/19. Payment moves once from Jest to Vitest only in applicable
unit graphs; integration remains Jest-owned and fail-closed for Vitest.
Remaining-Jest ownership stays 68 configs, 107 scripts, and 401 API files,
with only the rollback key move changing the accepted digest to
`cd2aa0861138adb0030597725f2a6d5a915d12514692fb78cac664d23bd7f3cb`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 448.3-second foundation, and all 13 Cloudflare gates in
198.7 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted result is claimed.

The next package-management slice is Turn 108 only: audit and add a separate
Payment integration Vitest shadow while retaining the exact Jest default. It
must not combine default cut-over, catalogs, privatization, dependencies,
workflow, CI, persistence, or publication changes.

## Payment Integration Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Payment integration lane with Vitest`)

Date verified: 2026-08-02.

Payment retains Jest at `test:integration` and adds an opt-in
`test:integration:vitest` command. The new native/no-bridge config and its
Jest-only two-operation compatibility shim are each owned exactly once by
strict root tooling. Both source timeouts move into runner ownership; one clear
and ten spies use imported Vitest `vi` syntax without changing an assertion.

No dependency, catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes. Nine
PostgreSQL/PGlite/Drizzle reports and all 36 pairs preserve two files, 36 tests,
56 direct expectation sites, zero snapshots, and normalized digest
`c9765002192f9fd799236738fe6cd8564599a6144599b7486606b372f0565c55`.
Both PGlite selectors pass. Jest `/3` remains 31/5/0; all native Vitest `/3`
commands reject because three shards exceed two files, so the shadow receives
no graph or workflow owner.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 38/19/19,
5/5/0, and 63/44/19. Remaining-Jest ownership becomes 68 configs, 107 scripts,
and 399 API files with accepted digest
`af1bb8fe1f293c7c8fa04c84d0053c2dca856405b04675bd4eb2f8aba6278dcd`.
Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 418.2-second foundation, and all 13 Cloudflare gates pass.
Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain unchanged. No hosted
CI result is claimed.

The next package-management slice is Turn 109 only: promote the proven Payment
integration shadow with exact Jest rollback and dedicated unsharded PostgreSQL
ownership. It must not combine catalogs, privatization, dependencies,
persistence, publication, or repository-merge changes.

## Payment Integration Vitest Default Package Ownership

Commit:

- This commit (`test: switch Payment integration lane to Vitest`)

Date verified: 2026-08-02.

Payment now maps `test:integration` to the existing native/no-bridge Vitest
config, retains the exact prior Jest command at `test:integration:jest`, and
removes `test:integration:vitest`. The root fast graph excludes Payment because
its two files cannot consume `/3`; one dedicated unsharded PostgreSQL workflow
job and aggregate propagation own the default command.

No dependency, catalog, override, lockfile, workspace, export,
privacy/publication, or repository-merge metadata changes. Twelve
pre/post-cut-over PostgreSQL/PGlite/Drizzle reports and all 66 pairs preserve
two files, 36 tests, 56 direct expectation sites, zero snapshots, and digest
`c9765002192f9fd799236738fe6cd8564599a6144599b7486606b372f0565c55`.
Both PGlite selectors and the unsharded PostgreSQL workflow command pass 36/36.

Fast integration becomes 37/18/19 with Payment absent; slow/all remain 5/5/0
and 63/44/19, with Payment once on Vitest in all. Remaining-Jest counts stay
68/107/399 with accepted digest
`13a0869985874f31dd42581cf592dd264e0f226a2779262a7e023a9a9f57f305`.
Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 463.3-second foundation, and all 13 Cloudflare gates in
191.8 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted CI result is claimed.

The next package-management slice is Turn 110 only: add a Notification
source-unit Vitest shadow without combining integration, catalogs,
privatization, dependencies, workflow, CI, persistence, or publication work.

## Notification Source-Unit Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Notification unit lane with Vitest`)

Date verified: 2026-08-20.

Notification retains its exact Jest `test` and `test:integration` defaults. The
package adds only an opt-in `test:vitest` command and source-only shared Vitest
config; the root strict tooling command adds that config exactly once.

No dependency, catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes. Five reports and
all ten pairs preserve one source file, one test, nine direct expectation
calls, and zero snapshots. Direct Jest, direct Vitest, and authentic
root-scoped Jest `/4` probes all pass with aggregate one-file/one-test
coverage.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 37/18/19,
5/5/0, and 63/44/19. The opt-in shadow has no graph, workflow, aggregate, or
hosted owner. Remaining-Jest ownership stays byte-identical at 68 configs, 107
scripts, and 399 API files with accepted digest
`13a0869985874f31dd42581cf592dd264e0f226a2779262a7e023a9a9f57f305`.
Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 294.7-second foundation, and all 13 Cloudflare gates in
236.4 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted result is claimed.

The next package-management slice is Turn 111 only: promote the proven
Notification source shadow with exact Jest rollback. It must not combine
integration, catalogs, privatization, dependencies, workflow, CI, or
publication changes.

## Notification Source-Unit Vitest Default Package Ownership

Commit:

- This commit (`test: switch Notification unit lane to Vitest`)

Date verified: 2026-08-20.

Notification now maps `test` to the existing native/no-bridge Vitest config,
retains the exact prior Jest source command at `test:jest`, and removes
`test:vitest`. The separate Jest `test:integration` command remains unchanged.

No dependency, catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes. Six reports and all
15 pairs preserve one source file, one test, nine direct expectation sites,
zero snapshots, and digest
`a2a70662b003f4f7c15f70105721c4e39dc420f8cd9fd523112120a3e2e40f11`.
Default Vitest, exact Jest rollback, and authentic root-scoped default `/4`
probes pass across all 12 commands with aggregate one-file/one-test coverage.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 37/18/19,
5/5/0, and 63/44/19. Notification moves once from Jest to Vitest only in
applicable unit graphs; integration remains Jest-owned and fail-closed for
Vitest. Remaining-Jest ownership stays 68 configs, 107 scripts, and 399 API
files, with only the rollback key move changing the accepted digest to
`0a81055c74fdd8dca9b8fd62da28fbb9a93b5bf1490dd5ae9d16d4b747b23fbe`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 261.1-second foundation, and all 13 Cloudflare gates in
234.7 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted result is claimed.

The next package-management slice is Turn 112 only: audit and add a separate
Notification integration Vitest shadow while retaining the exact Jest default.
It must not combine default cut-over, catalogs, privatization, dependencies,
workflow, CI, or publication changes.

## Notification Integration Vitest Shadow Package Ownership

Commit:

- This commit (`test: shadow Notification integration lane with Vitest`)

Date verified: 2026-08-20.

Notification retains its exact Jest `test:integration` default, now with
`--testTimeout=30000`, and adds only an opt-in `test:integration:vitest`
command plus a native/no-bridge integration config. The root strict tooling
command adds that config, the Jest shim, and the checked CommonJS provider
fixture exactly once. No dependency, catalog, override, lockfile, workspace,
export, workflow, CI, privacy/publication, or repository-merge metadata
changes.

Six reports and all 15 pairs preserve two files, 11 tests, 32 direct
expectation sites, zero snapshots, and digest
`5a1c4c7e9f47db69569e29c5153ea1996db1d51d5e4f9b5c2f487cd34fe0dd7c`.
Both PGlite selectors pass; Fulfillment is the next fail-closed Vitest lane.
Jest `/3` is 7/4/0, and every native Vitest `/3` rejects before import.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 37/18/19,
5/5/0, and 63/44/19. The opt-in shadow has no graph, workflow, aggregate, or
hosted owner. Remaining-Jest ownership becomes 68 configs, 107 scripts, and
397 API files with accepted digest
`8164c5c8793434d911cf781f65da8eaaa0ff5f1067d62de5286d1f8944f8cecc`.
Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 244.4-second foundation, and all 13 Cloudflare gates in
140.4 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted result is claimed.

The next package-management slice is Turn 113 only: promote the proven
Notification integration shadow with exact Jest rollback, exclude the two-file
lane from generic fast `/3`, and add one runner-neutral unsharded PostgreSQL
job. It must not combine fulfillment, catalogs, privatization, dependencies,
or publication changes.

## Notification Integration Vitest Default Package Ownership

Commit:

- This commit (`test: switch Notification integration lane to Vitest`)

Date verified: 2026-08-20.

Notification now maps `test:integration` to the existing native/no-bridge
Vitest config, retains the exact prior Jest command at `test:integration:jest`,
and removes `test:integration:vitest`. The root fast command adds only the
Notification exclusion; slow remains unchanged. One runner-neutral unsharded
PostgreSQL workflow job owns the two-file lane, and the package aggregate
propagates that job. No dependency, catalog, override, lockfile, workspace,
export, privacy/publication, or repository-merge metadata changes.

Twelve reports and all 66 pairs preserve two files, 11 tests, 32 direct
expectation sites, zero snapshots, and digest
`5a1c4c7e9f47db69569e29c5153ea1996db1d51d5e4f9b5c2f487cd34fe0dd7c`.
Both PGlite selectors and the exact workflow command pass 11/11. Fulfillment
is the next fail-closed Vitest lane.

All seven task graphs become 85/65/20, 1/1/0, 83/63/20, 2/2/0, 36/17/19,
5/5/0, and 63/44/19. Remaining-Jest ownership stays 68 configs, 107 scripts,
and 397 API files, with only the rollback key move changing the accepted digest
to `a5da8fc9947387b33ac83adce97b0b66472be639caccbf26b81defa70ba48fdd`.
Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 251.3-second foundation, and all 13 Cloudflare gates in
100.2 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted result is claimed.

The next package-management slice is Turn 114 only: audit and add a separate
Fulfillment source-unit Vitest shadow while retaining the exact Jest default.
It must not combine integration, catalogs, privatization, dependencies,
workflow, CI, or publication changes.

## Fulfillment Source-Unit Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Fulfillment unit lane with Vitest`)

Date verified: 2026-08-20.

Fulfillment retains its exact Jest `test` and `test:integration` defaults and
adds only an opt-in `test:vitest` command plus a native/no-bridge unit config.
The root strict tooling command adds that config exactly once. No dependency,
catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes.

Five reports and all ten pairs preserve two files, 23 tests, 33 direct
expectation sites, zero snapshots, and digest
`2942500312a6eb86a6174e41caf2e9c34f107f3a9aff56162696df14d62991b8`.
Direct Jest, direct Vitest, and authentic root-scoped Jest `/4` probes pass
across all four shards with aggregate two-file/23-test coverage.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 36/17/19,
5/5/0, and 63/44/19. The opt-in shadow has no graph, workflow, aggregate, or
hosted owner. Remaining-Jest ownership stays 68 configs, 107 scripts, and 397
API files with digest
`a5da8fc9947387b33ac83adce97b0b66472be639caccbf26b81defa70ba48fdd`.
Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 253.9-second foundation, and all 13 Cloudflare gates in
178.1 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted result is claimed.

The next package-management slice is Turn 115 only: promote the proven
Fulfillment source shadow with exact Jest rollback. It must not combine
integration, catalogs, privatization, dependencies, workflow, CI, or
publication changes.

## Fulfillment Source-Unit Vitest Default Package Ownership

Commit:

- This commit (`test: switch Fulfillment unit lane to Vitest`)

Date verified: 2026-08-20.

Fulfillment now maps `test` to the existing native/no-bridge Vitest config,
retains the exact prior Jest source command at `test:jest`, and removes
`test:vitest`. The separate Jest `test:integration` command remains unchanged.

No dependency, catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes. Six reports and all
15 pairs preserve two source files, 23 tests, 33 direct expectation sites,
zero snapshots, and digest
`2942500312a6eb86a6174e41caf2e9c34f107f3a9aff56162696df14d62991b8`.
Default Vitest, exact Jest rollback, and authentic root-scoped default `/4`
probes pass across all 12 commands with aggregate two-file/23-test coverage.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 36/17/19,
5/5/0, and 63/44/19. Fulfillment moves once from Jest to Vitest only in
applicable unit graphs; integration remains Jest-owned and fail-closed for
Vitest. Remaining-Jest ownership stays 68 configs, 107 scripts, and 397 API
files, with only the rollback key move changing the accepted digest to
`aa4ff263bd2bfeb7b236ffd955d60accf4b9df2f19965b3a91de3158fbdfe9be`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 271.2-second foundation, and all 13 Cloudflare gates in
107.6 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted result is claimed.

The next package-management slice is Turn 116 only: audit and add a separate
Fulfillment integration Vitest shadow while retaining the exact Jest default.
It must not combine default cut-over, catalogs, privatization, dependencies,
workflow, CI, or publication changes.

## Fulfillment Integration Vitest Shadow Package Ownership

Commit:

- This commit (`test: shadow Fulfillment integration lane with Vitest`)

Date verified: 2026-08-20.

Fulfillment retains the exact Jest `test:integration` command, including the
moved 1_000_000 ms CLI timeout, and adds only `test:integration:vitest`. No
dependency, catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes. Six reports and all
15 pairs preserve seven files, 75 tests, 263 expect() sites, zero snapshots,
and digest
`94275a7ae05b2266121ff33b2587e3e4b5ae1db1f05805bc594c728b5921663d`.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 36/17/19,
5/5/0, and 63/44/19. The shadow has no graph or workflow owner. Remaining-Jest
ownership is 68 configs, 107 scripts, and 390 API files, with accepted digest
`218465edf4a10674b69f76e98a088ad655f81c3b415fe6a9c3026afe23f8c340`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 276.0-second foundation, and all 13 Cloudflare gates in
194.7 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted result is claimed.

The next package-management slice is Turn 117 only: promote the proven
Fulfillment integration shadow to `test:integration` with exact Jest rollback.
It must not combine Promotion, catalogs, privatization, dependencies,
workflow, CI, or publication changes.

## Fulfillment Integration Vitest Default Package Ownership

Commit:

- This commit (`test: switch Fulfillment integration lane to Vitest`)

Date verified: 2026-08-20.

Fulfillment now maps `test:integration` to the existing native/no-bridge
Vitest config, retains the exact prior Jest integration command at
`test:integration:jest`, and removes `test:integration:vitest`. No dependency,
catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes. Twelve reports and
all 66 pairs preserve seven files, 75 tests, 263 expect() sites, zero
snapshots, and digest
`94275a7ae05b2266121ff33b2587e3e4b5ae1db1f05805bc594c728b5921663d`.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 36/17/19,
5/5/0, and 63/44/19. Fulfillment stays in generic fast `/3` with no dedicated
job. Remaining-Jest ownership stays 68 configs, 107 scripts, and 390 API
files, with only the rollback key move changing the accepted digest to
`6d6f67dd4cdfae93513fd685a6a76a84af90dc0ef42c84db9d6ff61faf394efc`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 260.3-second foundation, and all 13 Cloudflare gates in
179.3 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted result is claimed.

The next package-management slice is Turn 118 only: audit and add a separate
Promotion source-unit Vitest shadow while retaining the exact Jest default.
It must not combine integration, catalogs, privatization, dependencies,
workflow, CI, or publication changes.

## Promotion Source-Unit Vitest Shadow Ownership

Commit:

- This commit (`test: shadow Promotion unit lane with Vitest`)

Date verified: 2026-08-20.

Promotion retains its exact Jest `test` and `test:integration` defaults and
adds only an opt-in `test:vitest` command plus a native/no-bridge unit config.
The root strict tooling command adds that config exactly once. No dependency,
catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes.

Five reports and all ten pairs preserve one file, one test, 5 direct
expectation sites, zero snapshots, and digest
`4c9ba44eacff934d2fa46947f9c9ababb43f6499f6c494c2195ce95765969a10`.
Direct Jest, direct Vitest, and authentic root-scoped Jest `/4` probes pass
across all four shards with aggregate one-file/one-test coverage.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 36/17/19,
5/5/0, and 63/44/19. The opt-in shadow has no graph, workflow, aggregate, or
hosted owner. Remaining-Jest ownership stays 68 configs, 107 scripts, and 390
API files with digest
`6d6f67dd4cdfae93513fd685a6a76a84af90dc0ef42c84db9d6ff61faf394efc`.
Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 260.4-second foundation, and all 13 Cloudflare gates in
128.2 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted result is claimed.

The next package-management slice is Turn 119 only: promote the proven
Promotion source shadow with exact Jest rollback. It must not combine
integration, catalogs, privatization, dependencies, workflow, CI, or
publication changes.

## Promotion Source-Unit Vitest Default Package Ownership

Commit:

- This commit (`test: switch Promotion unit lane to Vitest`)

Date verified: 2026-08-20.

Promotion now maps `test` to the existing native/no-bridge Vitest config,
retains the exact prior Jest source command at `test:jest`, and removes
`test:vitest`. No dependency, catalog, override, lockfile, workspace, export,
workflow, CI, privacy/publication, or repository-merge metadata changes. Six
reports and all 15 pairs preserve one file, one test, 5 expect() sites, zero
snapshots, and digest
`4c9ba44eacff934d2fa46947f9c9ababb43f6499f6c494c2195ce95765969a10`.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 36/17/19,
5/5/0, and 63/44/19. Remaining-Jest ownership stays 68 configs, 107 scripts,
and 390 API files, with only the rollback key move changing the accepted
digest to
`e27c8d21896cb74195597ddbf0b3b1e2fb6f7a34ee73e743d3f0e32bf65fae98`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 263.6-second foundation, and all 13 Cloudflare gates in
125.1 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted result is claimed.

The next package-management slice is Turn 120 only: audit and add a separate
Promotion integration Vitest shadow while retaining the exact Jest default.
It must not combine default cut-over, catalogs, privatization, dependencies,
workflow, CI, or publication changes.

## Promotion Integration Vitest Shadow Package Ownership

Commit:

- This commit (`test: shadow Promotion integration lane with Vitest`)

Date verified: 2026-08-20.

Promotion retains its exact Jest `test:integration` default, now with an
explicit 30_000 ms CLI timeout, and adds only an opt-in
`test:integration:vitest` command plus a native/no-bridge integration config.
The root strict tooling command adds that config exactly once. No dependency,
catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes.

Six reports and all 15 pairs preserve six files, 178 tests, 239 expect()
sites, zero snapshots, and digest
`5ded7a0f633a9dd46a06f14c7296ed992a430380d713316c4b1c6f2e9e33ce2f`.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 36/17/19,
5/5/0, and 63/44/19. The opt-in shadow has no graph, workflow, aggregate, or
hosted owner. Remaining-Jest ownership is 68 configs, 107 scripts, and 385
API files with digest
`296f9841a6037845b7b25cfab5160ce3af35541616151de7423d0ea4ea7be22f`.
Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 274.2-second foundation, and all 13 Cloudflare gates in
193.8 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted result is claimed.

The next package-management slice is Turn 121 only: promote the proven
Promotion integration shadow to `test:integration` with exact Jest rollback.
It must not combine Product, catalogs, privatization, dependencies,
workflow, CI, or publication changes.

## Promotion Integration Vitest Default Package Ownership

Commit:

- This commit (`test: switch Promotion integration lane to Vitest`)

Date verified: 2026-08-20.

Promotion now maps `test:integration` to the existing native/no-bridge Vitest
config, retains the exact prior Jest command at `test:integration:jest`, and
removes `test:integration:vitest`. No dependency, catalog, override, lockfile,
workspace, export, workflow, CI, privacy/publication, or repository-merge
metadata changes. Twelve reports and all 66 pairs preserve six files, 178
tests, 239 expect() sites, zero snapshots, and digest
`5ded7a0f633a9dd46a06f14c7296ed992a430380d713316c4b1c6f2e9e33ce2f`.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 36/17/19,
5/5/0, and 63/44/19. Promotion stays in generic fast `/3` with no dedicated
workflow job. Remaining-Jest ownership stays 68 configs, 107 scripts, and 385
API files, with only the rollback key move and PGlite orchestrator digest
changing the accepted digest to
`107e8331facafbc61ddcc7220fac6b31f8000c8b6cefeee10d50b1d0c68b8b34`.
Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 262.7-second foundation, and all 13 Cloudflare gates in
135.1 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted result is claimed.

The next package-management slice is Turn 122 only: audit and add a separate
Product source-unit Vitest shadow while retaining the exact Jest default.
It must not combine integration, catalogs, privatization, dependencies,
workflow, CI, or publication changes.

## Product Source-Unit Vitest Shadow Package Ownership

Commit:

- This commit (`test: shadow Product unit lane with Vitest`)

Date verified: 2026-08-20.

Product retains its exact Jest `test` and `test:integration` defaults and
adds only an opt-in `test:vitest` command plus a native/no-bridge source
config. The root strict tooling command adds that config exactly once. No
dependency, catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes.

Five reports and all 10 pairs preserve two files, four tests, 23 expect()
sites, zero snapshots, and digest
`5405f6cc036555864b376b686a66e2367641eb780a086caeae6558691e241866`.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 36/17/19,
5/5/0, and 63/44/19. The opt-in shadow has no graph, workflow, aggregate, or
hosted owner. Remaining-Jest ownership stays 68 configs, 107 scripts, and 385
API files with digest
`107e8331facafbc61ddcc7220fac6b31f8000c8b6cefeee10d50b1d0c68b8b34`.
Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 262.3-second foundation, and all 13 Cloudflare gates in
94.8 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted result is claimed.

The next package-management slice is Turn 123 only: promote the proven
Product source shadow with exact Jest rollback. It must not combine
integration, catalogs, privatization, dependencies, workflow, CI, or
publication changes.

## Product Source-Unit Vitest Default Package Ownership

Commit:

- This commit (`test: switch Product unit lane to Vitest`)

Date verified: 2026-08-20.

Product now maps `test` to the existing native/no-bridge Vitest config,
retains the exact prior Jest source command at `test:jest`, and removes
`test:vitest`. No dependency, catalog, override, lockfile, workspace, export,
workflow, CI, privacy/publication, or repository-merge metadata changes. Six
reports and all 15 pairs preserve two files, four tests, 23 expect() sites,
zero snapshots, and digest
`5405f6cc036555864b376b686a66e2367641eb780a086caeae6558691e241866`.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 36/17/19,
5/5/0, and 63/44/19. Remaining-Jest ownership stays 68 configs, 107 scripts,
and 385 API files, with only the rollback key move changing the accepted
digest to
`7240bf3c54c1784faec7f89567b14142fd792155d40ff6bb8eb71a660dc4b4ea`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, strict
tooling, the complete 262.0-second foundation, and all 13 Cloudflare gates in
94.0 seconds pass. Vite 8.2.0 with built-in Rolldown and Vitest 4.1.10 remain
unchanged. No hosted result is claimed.

The next package-management slice is Turn 124 only: audit and add a separate
Product integration Vitest shadow while retaining the exact Jest default.
It must not combine default cut-over, catalogs, privatization, dependencies,
workflow, CI, or publication changes.

The Product integration Jest three-backend freeze is unblocked (10/205+1 on
isolated PostgreSQL 18, PGlite, and Drizzle). Turn 124 may add
`test:integration:vitest` as an opt-in shadow only.

## Product Integration Vitest Shadow Package Ownership

Commit:

- This commit (`test: shadow Product integration lane with Vitest`)

Date verified: 2026-08-22.

Product retains its exact Jest `test:integration` default, now with an
explicit `--testTimeout=300000` CLI flag replacing ten source-level
`jest.setTimeout` calls, and adds only an opt-in `test:integration:vitest`
command plus a native/no-bridge integration config. The root strict tooling
command adds that config and the package-local `vitest-jest-shim` fixture
exactly once each. The PGlite orchestrator maps `@medusajs/product` to the
opt-in Vitest script, and the integration-foundation verifier moves its
fail-closed unsupported-Vitest example from product to pricing. No dependency,
catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes.

The opt-in shadow matches Jest exactly on all three persistence backends:
10 files / 205 passed / 1 skipped on an isolated PostgreSQL 18 cluster, PGlite,
and Drizzle/SQLite. Remaining-Jest ownership is 68 configs, 107 scripts, and
375 active API files with digest
`d4c0ede7ceaffeb72256c807ef190d1db24938392380d129623b10ee76d30623`. Strict
tooling, the ten-contract tooling suite, foundation parity, and the
integration-foundation gate pass. Frozen offline install, CI sharding, and the
Cloudflare gates were not rerun in this slice and remain cut-over-turn
requirements. No hosted result is claimed.

The next package-management slice is Turn 125 only: prove the remaining shadow
gates and promote this shadow to `test:integration` with exact Jest rollback.
It must not combine Pricing, catalogs, privatization, dependencies, workflow,
CI, or publication changes.

## Product Integration Vitest Default Package Ownership

Commit:

- This commit (`test: switch Product integration lane to Vitest`)

Date verified: 2026-08-22.

Product maps `test:integration` to the proven native/no-bridge Vitest config,
retains the byte-identical Jest command at `test:integration:jest`, and
removes the temporary `test:integration:vitest` key. The PGlite orchestrator
maps both product runners through the shared `test:integration` and
`test:integration:jest` selectors with no package-specific ternary. No
dependency, catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes.

All ten files distribute under `/3`, so Product stays in the generic fast
integration graph with no dedicated workflow job. Both PGlite selectors pass
10 files / 205 passed / 1 skipped, and authentic Vitest `/3` shards cover
every test exactly once at 75/(68+1 skipped)/62 across 4/3/3 files.
Remaining-Jest ownership is 68 configs, 107 scripts, and 375 active API files
with digest
`f7be351c8de7e2d5241dff938807ed9738a8bfdd10ba9bc739c973255b34371e`.
Frozen offline install across all 86 workspaces, the complete foundation,
and the full Cloudflare Vite/import/D1/workerd gate set in one uninterrupted
94-second run pass. No hosted result is claimed.

The next package-management slice is Turn 126 only: audit and add a separate
Pricing integration Vitest shadow while retaining the exact Jest default. It
must not combine default cut-over, catalogs, privatization, dependencies,
workflow, CI, or publication changes.

## Pricing Integration Vitest Shadow Package Ownership

Commit:

- This commit (`test: shadow Pricing integration lane with Vitest`)

Date verified: 2026-08-22.

Pricing retains its exact Jest `test:integration` default, now with an
explicit `--testTimeout=30000` CLI flag replacing six source-level
`jest.setTimeout` calls, and adds only an opt-in `test:integration:vitest`
command plus a native/no-bridge integration config. The root strict tooling
command adds that config and the package-local `vitest-jest-shim` fixture
exactly once each. The PGlite orchestrator maps `@medusajs/pricing` to the
opt-in Vitest script, and the integration-foundation verifier moves its
fail-closed unsupported-Vitest example from pricing to cart. No dependency,
catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes.

The opt-in shadow matches Jest exactly on all three persistence backends:
6 files / 126 passed tests on an isolated PostgreSQL 18 cluster, PGlite, and
Drizzle/SQLite. The Pricing unit lane remains Jest-owned. Remaining-Jest
ownership is 68 configs, 107 scripts, and 369 active API files with digest
`1bc4aa126bf6482f746756a1cf3f79fa88687c4d68f331347b81b9cc9430065b`. Strict
tooling, the ten-contract tooling suite, foundation parity, and the
integration-foundation gate pass. Frozen offline install, CI sharding, and the
Cloudflare gates were not rerun in this slice and remain cut-over-turn
requirements. No hosted result is claimed.

The next package-management slice is Turn 127 only: prove the remaining shadow
gates and promote this shadow to `test:integration` with exact Jest rollback.
It must not combine Cart, Order, catalogs, privatization, dependencies,
workflow, CI, or publication changes.

## Pricing Integration Vitest Default Package Ownership

Commit:

- This commit (`test: switch Pricing integration lane to Vitest`)

Date verified: 2026-08-22.

Pricing maps `test:integration` to the proven native/no-bridge Vitest config,
retains the byte-identical Jest command at `test:integration:jest`, and
removes the temporary `test:integration:vitest` key. The PGlite orchestrator
maps both pricing runners through the shared `test:integration` and
`test:integration:jest` selectors with no package-specific ternary. No
dependency, catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes.

All six files distribute evenly under `/3`, so Pricing stays in the generic
fast integration graph with no dedicated workflow job. Both PGlite selectors
pass 6 files / 126 passed tests, and authentic Vitest `/3` shards cover every
test exactly once at 29/27/70 across 2/2/2 files. Remaining-Jest ownership is
68 configs, 107 scripts, and 369 active API files with digest
`aa2bc5060641031ec27c4e42c4964dcc1cee42fdc729665d5c6d24fa8cc73e15`.
Frozen offline install across all 86 workspaces, the complete foundation, and
the full Cloudflare Vite/import/D1/workerd gate set in one uninterrupted
225-second run pass. No hosted result is claimed.

The next package-management slice is Turn 128 only: audit and add a separate
Cart integration Vitest shadow while retaining the exact Jest default. It must
not combine default cut-over, Order, catalogs, privatization, dependencies,
workflow, CI, or publication changes.

## Cart Integration Vitest Shadow Package Ownership

Commit:

- This commit (`test: shadow Cart integration lane with Vitest`)

Date verified: 2026-08-22.

Cart retains its exact Jest `test:integration` default, now with an explicit
`--testTimeout=50000` CLI flag replacing the single source-level
`jest.setTimeout` call, and adds only an opt-in `test:integration:vitest`
command plus a native/no-bridge integration config. The root strict tooling
command adds that config exactly once; no shim fixture is needed because the
suite uses no spy or mock APIs. The PGlite orchestrator maps `@medusajs/cart`
to the opt-in Vitest script, and the integration-foundation verifier moves its
fail-closed unsupported-Vitest example from cart to order. No dependency,
catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes.

The opt-in shadow matches Jest exactly on all three persistence backends:
1 file / 63 passed tests on an isolated PostgreSQL 18 cluster, PGlite, and
Drizzle/SQLite. Remaining-Jest ownership is 68 configs, 107 scripts, and 368
active API files with digest
`dde6f334244fd62f588262be8cdf857c321b1fab55771fc73c8c215476505863`. Strict
tooling, the ten-contract tooling suite, foundation parity, and the
integration-foundation gate pass. Frozen offline install, CI sharding, and the
Cloudflare gates were not rerun in this slice and remain cut-over-turn
requirements. No hosted result is claimed.

The next package-management slice is Turn 129 only: prove the remaining shadow
gates and promote this shadow to `test:integration` with exact Jest rollback.
It must not combine Order, catalogs, privatization, dependencies, workflow,
CI, or publication changes.

## Cart Integration Vitest Default Package Ownership

Commit:

- This commit (`test: switch Cart integration lane to Vitest`)

Date verified: 2026-08-22.

Cart maps `test:integration` to the proven native/no-bridge Vitest config,
retains the byte-identical Jest command at `test:integration:jest`, and
removes the temporary `test:integration:vitest` key. The PGlite orchestrator
maps both cart runners through the shared `test:integration` and
`test:integration:jest` selectors with no package-specific ternary. No
dependency, catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes.

The one-file lane fails closed under authentic Vitest `/3` sharding ("shard
must be smaller than count of test files"), matching Currency precedent; Cart
stays outside the generic fast integration filter as before with no workflow
or CI change. Both PGlite selectors pass 1 file / 63 passed tests.
Remaining-Jest ownership is 68 configs, 107 scripts, and 368 active API files
with digest
`5469e8948fe323a2d25864874be35c9922e9a0b8891ffb3a977e7a242f554f68`.
Frozen offline install across all 86 workspaces, the complete foundation, and
the full Cloudflare Vite/import/D1/workerd gate set in one uninterrupted
137-second run pass. No hosted result is claimed.

The next package-management slice is the Order integration Vitest shadow only:
audit and add it while retaining the exact Jest default. It must not combine
default cut-over, catalogs, privatization, dependencies, workflow, CI, or
publication changes.

## Order Integration Vitest Shadow Package Ownership

Commit:

- This commit (`test: shadow Order integration lane with Vitest`)

Date verified: 2026-08-22.

Order retains its exact Jest `test:integration` default, now with an explicit
`--testTimeout=1000000` CLI flag replacing eight source-level
`jest.setTimeout` calls, and adds only an opt-in `test:integration:vitest`
command plus a native/no-bridge integration config. The root strict tooling
command adds that config exactly once; no shim fixture is needed. The PGlite
orchestrator maps `@medusajs/order` to the opt-in Vitest script. With Order
supported, every module lane lists under Vitest selection and the
integration-foundation verifier's fail-closed assertions become positive.
No dependency, catalog, override, lockfile, workspace, export, workflow, CI,
privacy/publication, or repository-merge metadata changes.

The shadow matches Jest exactly on every backend: 9 files / 77 passed on PGlite
and Drizzle/SQLite, and identical 74 passed / 3 failed outcomes on isolated
PostgreSQL 18 for both runners — a pre-existing MikroORM-PostgreSQL gap
(claim/exchange shipping-method lookup and return-flow row count) recorded as
a hard prerequisite fix before any Order cut-over. Remaining-Jest ownership is
68 configs, 107 scripts, and 360 active API files with digest
`193bd34cd2c203b39ad2230dab44ae4e34533d729ca9b207fec01581f76ef303`. Strict
tooling, the ten-contract tooling suite, foundation parity, and the
integration-foundation gate pass. Frozen offline install, CI sharding, and the
Cloudflare gates were not rerun in this slice. No hosted result is claimed.

The next package-management slice is the Order MikroORM/PostgreSQL fix only:
make both runners pass 9 files / 77 tests on PostgreSQL with unchanged
assertions. It must not combine cut-over, catalogs, privatization,
dependencies, workflow, CI, or publication changes.
