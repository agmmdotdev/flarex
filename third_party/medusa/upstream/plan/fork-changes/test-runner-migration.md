# Test Runner Migration

## Vite 8 And Vitest 4 Baseline

Commit:

- `48dea7e01f` (`test: upgrade Vitest and Vite toolchain`)

Date verified: 2026-07-10.

This fork now uses one supported Vite 8 and Vitest 4 baseline before any
Jest-owned lane is migrated:

- Vite `8.1.4`;
- Vitest `4.1.10`;
- `@vitest/coverage-v8` `4.1.10`;
- `@vitejs/plugin-react` `6.0.3`;
- `vite-plugin-inspect` `11.4.1`;
- esbuild `0.28.1` where it remains a direct tool or override;
- Storybook `10.4.6` and matching React, docs, themes, and Vite packages.

Vite 8 already contains Rolldown as its unified production and dependency
bundler. The fork does not install `rolldown-vite` or select Rolldown through a
second package. Vite 8.1's `experimental.bundledDev` option remains disabled;
it is an independent experimental serving mode, not the switch that enables
Rolldown.

The exact Vite and Vitest versions were selected from the npm registry with
`pnpm view` and checked against the official release and migration material:

- <https://vite.dev/blog/announcing-vite8>
- <https://vite.dev/blog/announcing-vite8-1>
- <https://vitest.dev/guide/migration.html>

The root, the private Cloudflare app, `@medusajs/admin-bundler`, and
`@medusajs/admin-vite-plugin` now state Vite 8's Node engine boundary:
`^20.19.0 || >=22.12.0`. Local validation and repository CI use Node 24. This
does not narrow `@medusajs/medusa`'s public runtime engine because that package
does not depend on or execute Vite.

## Difference From Original Medusa

Original Medusa's active Jest lanes remain authoritative and unchanged. This
turn changes only the nine workspaces that already used Vitest and the Vite
tooling they consume. It does not migrate a Jest test, change a Jest default,
remove a Jest config, or alter an assertion, fixture, snapshot, or skip state.

The pre-upgrade fork resolved:

- root/admin Vite `5.4.21` and Cloudflare Vite `8.0.16`;
- Vitest `3.2.4`, which resolved a separate Vite 7 engine;
- `@vitest/coverage-v8` `0.32.4`, which crashed both design-system coverage
  commands with `TypeError: this.resolveReporters is not a function`;
- Storybook 8 packages whose Vite peer boundary excluded Vite 8.

The lockfile now resolves the selected owners to Vite `8.1.4`, Vitest
`4.1.10`, and coverage `4.1.10`. Storybook is pinned to the supported 10.4.6
companion line rather than coupling this migration to a just-published release.
The existing `@cloudflare/vite-plugin` 1.40.2 and Wrangler 4.100.0 remain
because their Vite 8 peer boundary is valid and both the production Worker and
real workerd gates pass; upgrading unrelated Cloudflare tooling is a separate
decision.

## Vitest 4 Compatibility

Vitest 4 changed defaults and configuration in ways that affect collection:

- `deps.optimizer.web` became `deps.optimizer.client` in the Cloudflare app;
- removed `coverage.all` entries were deleted while explicit coverage include
  and exclude rules were preserved;
- Vitest 4's smaller default exclusion list would collect generated `dist`
  tests, so package-local configs now exclude `**/dist/**` in
  `@medusajs/cloudflare-runtime`, `@medusajs/dal`, `@medusajs/dml`, and
  `@medusajs/drizzle`;
- the design-system configs reference `vitest/config` for their test config
  types.

The first Vitest 4 run proved why the explicit `dist` exclusion is required:
source tests passed, but generated CommonJS tests were collected a second time.
After the configs were added, collection returned to the exact baseline.

## Vite 8 And Rolldown Compatibility

Admin plugin builds now use `build.rolldownOptions` instead of the deprecated
Rollup-named option. The unsupported output `interop` setting was removed.
Dependencies declared by a plugin remain external, while internal admin helper
code stays bundleable. In particular, `@medusajs/admin-shared` is not added as
an undeclared external: a real draft-order plugin build proves that the emitted
admin artifact has no phantom bare import.

Storybook's supported companion migration replaces the removed Storybook 8
addon bundle with the Storybook 10 docs and themes addons. The previous theme
decorator now comes from `@storybook/addon-themes`. The separate
`vite-plugin-turbosnap` dependency and Vite hook were removed because Storybook
10 owns that behavior directly.

The Cloudflare app adds `WebWorker.Iterable` to its TypeScript libraries so the
Worker `Headers` iteration surface used by the existing source is typed under
the Vite 8 build boundary. No Worker request behavior changed.

## Pre-existing Cloudflare Gate Repair

The Vite 8.1 workerd validation exposed a pre-existing static-resolution gap,
not a Vitest behavior difference. Several recently reachable Medusa routes and
Index proof exports resolved linked workspace subpaths to CommonJS `dist`
files. Vite's workerd module runner then evaluated a bare `exports` reference
while identifying Worker exports.

The existing application composition policy already resolves portable Worker
code to package-owned TypeScript sources. The missing aliases were completed
for:

- user role assignment and removal workflows;
- two GraphQL utility leaves;
- the Index relation proof and Worker composition leaves;
- Link Modules, Pricing, Product, and Sales Channel Index manifests.

The portability import guard mirrors those aliases. This repair does not move
the implementations into the app, change a public package export, or rewrite a
Medusa route. It lets the existing package-owned source graph run in workerd
without evaluating generated CommonJS as an ESM module. It is recorded in this
turn because the real workerd gate was required for accepting the new toolchain.

## Validation

Exact existing-Vitest parity on Vitest 4.1.10:

| Workspace                      |   Files |   Tests |
| ------------------------------ | ------: | ------: |
| `medusa-cloudflare`            |       2 |      30 |
| `@medusajs/admin-vite-plugin`  |       4 |      16 |
| `@medusajs/dashboard`          |       2 |      11 |
| `@medusajs/cloudflare-runtime` |       1 |       4 |
| `@medusajs/dal`                |       1 |       1 |
| `@medusajs/dml`                |       0 |       0 |
| `@medusajs/drizzle`            |       5 |      60 |
| `@medusajs/icons`              |     464 |     464 |
| `@medusajs/ui`                 |      15 |      36 |
| **Total**                      | **494** | **622** |

`@medusajs/dml` intentionally retains its zero-file pass through
`--passWithNoTests`.

Coverage:

- `pnpm --filter @medusajs/icons test:coverage`
  - 464 files and 464 tests passed; V8 coverage completed.
- `pnpm --filter @medusajs/ui test:coverage`
  - 15 files and 36 tests passed; V8 coverage completed.

Vite/Rolldown consumers:

- `@medusajs/admin-vite-plugin` build passed.
- `@medusajs/admin-bundler` build passed.
- `@medusajs/draft-order` real plugin build passed without a bare
  `@medusajs/admin-shared` artifact import.
- `@medusajs/dashboard` preview build passed on Vite 8.1.4.
- `@medusajs/ui` Storybook 10.4.6 static build passed on Vite 8.1.4.
- `@medusajs/cloudflare-runtime`, `@medusajs/dal`, `@medusajs/dml`,
  `@medusajs/drizzle`, and `@medusajs/types` builds passed.

Cloudflare:

- app typecheck passed;
- production Vite 8.1.4 Worker build passed;
- composed Worker import guard passed with 1,593 bundled inputs;
- portable entrypoint guard passed;
- real Currency module audit passed with 65 inputs and zero Worker blockers;
- runtime source import check passed;
- the real workerd/D1 Currency proof passed read, create, update, soft-delete,
  restore, and delete with statement transaction semantics.

Package management:

- frozen-lockfile install passed and the 2,363-entry lockfile passed the
  configured supply-chain policy;
- the installed commands report Vite 8.1.4 and Vitest 4.1.10;
- `pnpm peers check` reports no Vite, Vitest, coverage, Storybook, or Cloudflare
  mismatch. It still exits nonzero for four pre-existing unrelated peer groups:
  legacy Rollup plugins, `eslint-plugin-unused-imports`,
  `tailwindcss-animate`, and an AWS SDK client range.

Non-blocking build output remains limited to existing Browserslist data-age,
large-chunk, and Rolldown plugin-timing warnings.

## Shared Node Vitest Foundation

Commit:

- `f2c34a47b3` (`test: add shared Node Vitest foundation`)

Date verified: 2026-07-10.

### Difference From Original Medusa

Original Medusa's Jest commands, package configs, and assertions remain
authoritative. This turn adds repository-only migration tooling under
`scripts/test-runner`; it does not add a workspace, publish a package, switch a
package default, or change production source.

The shared profile now makes the behavior previously implicit in
`define_jest_config.js` explicit for Vitest:

- a direct `@swc/core` Vite pre-transform parses TypeScript decorators and
  preserves `legacyDecorator`, `decoratorMetadata`,
  `useDefineForClassFields: false`, ES2021 output, ESM modules, and source maps;
- project `.js` and `.ts` files are transformed, while `node_modules` stays
  outside that transform except for the existing `until-async` and `msw`
  exceptions;
- the Node environment, Vitest globals, fork pool, list-ordered hooks and setup
  files, and Jest-compatible `dist`, fixture, and mock exclusions are explicit;
- callers must supply an absolute package root, an explicit file-discovery
  lane, and ordered aliases with root-relative replacements;
- the exported discovery contract includes both `*.spec`/`*.test` files and
  unsuffixed JavaScript/TypeScript files beneath `__tests__`.

Aliases are not inferred from TypeScript paths and internal package namespaces
are not globally redirected. This preserves the later package-by-package review
of standard aliases, the Medusa/Framework singleton mapping, and CLI-specific
ESM rules.

### Limited Dual-Runner Bridge

Vitest setup may install a frozen compatibility object at `globalThis.jest`
with exactly five members:

- `fn`;
- `spyOn`;
- `clearAllMocks`;
- `restoreAllMocks`;
- `setTimeout`.

Cleanup methods return the limited bridge so chaining cannot expose `vi`.
`setTimeout` updates both `testTimeout` and `hookTimeout`. Jest runs do not load
the setup and continue to use native Jest.

The bridge deliberately does not cover:

- `jest.mock`, `jest.doMock`, or synchronous `jest.requireActual`, because a
  runtime global cannot reproduce Jest's transform-time hoisting;
- fake timers;
- `resetAllMocks`, `.mockReset`, module reset, or module isolation;
- manual mock resolution;
- `@jest/globals` imports;
- Jest namespace types.

Those surfaces remain separate migration blockers with their own required
contracts. The root now declares `@types/jest` 29.5.14 directly so this
foundation's explicit Jest type lane resolves Jest 29 rather than depending on
jest-dom's transitive Jest 30 types. Other consumers of nested jest-dom typings
remain package-level migration concerns.

A second, isolated TypeScript lane replaces the Jest ambient namespace with
the readonly five-method bridge. It proves the allowed APIs and proves through
expected type errors that assignment, module mocks, fake timers, and module
reset are unavailable. This avoids weakening the Jest-native rollback type
lane while making the compatibility type surface explicit.

### Exact Parity Contract

The result normalizer validates unknown JSON boundaries and compares only
runner-stable behavioral data:

- repository-relative file paths;
- the top-level runner success result;
- ancestor titles, test titles, and full test names;
- passed, failed, skipped, and todo states;
- derived suite and test counts;
- snapshot totals, matched/unmatched/update states, and unchecked keys.

Durations, timestamps, and runner-formatted failure text are intentionally not
parity fields. Unknown result statuses, malformed success values, or malformed
snapshot values fail loudly.

The same five files run sequentially under Jest 29 and Vitest 4:

- the tooling alias/dependency/mock/lifecycle contract, stored as an
  unsuffixed file under `__tests__`;
- the tooling decorator metadata and assignment-field contract;
- the tooling result-normalizer contract;
- the unchanged
  `packages/core/utils/src/dal/mikro-orm/__tests__/big-number-field.spec.ts`,
  which detects define-style class fields shadowing the decorator-installed
  prototype accessor;
- the unchanged
  `packages/core/utils/src/modules-sdk/decorators/__tests__/emit-events.ts`,
  which proves method and parameter decorators, unsuffixed discovery, and
  `jest.fn` compatibility.

Exact normalized result under each runner: five files, eight passed, one
skipped, one todo, and one matched inline snapshot. The MikroORM proof uses
`connect: false`; no PostgreSQL or Redis service is involved.

### Remaining-Jest Ownership Guard

`check:remaining-jest` stores the canonical file-level and API-level ownership
entries, their SHA-256 digest, and a human-readable summary. A failure prints
the exact added and removed entries. Any addition, removal, rename, runner-file
change, command/dependency change, or API-count change fails until the
completed migration turn explicitly reviews and updates the baseline.

The Turn 2 baseline records:

- 68 Jest config files, including the inactive aggregate integration config;
- 116 Jest runner-script entries across 68 workspace owners;
- 11 Jest dependency entries across four workspace owners;
- 406 active JavaScript/TypeScript files containing Jest API ownership and
  1,546 API occurrences;
- 127 files using `jest.fn`, correcting the planning snapshot's stale count of
  126;
- 54 files using `jest.spyOn`;
- 286 files using `jest.setTimeout`;
- six fake-timer files, 20 module-mock/actual files, three module-isolation
  files, five `jest.resetAllMocks` files, one `.mockReset` file, 17 Jest
  namespace-type files, and three explicit `@jest/globals` import files;
- 15 manual mock files, 17 tracked snapshot files (one active and 16 in the API
  archive), nine snapshot-matcher files, and four `JEST_WORKER_ID` owners;
- the foundation's own Jest config and two contract API/type files tracked
  separately from the active Medusa migration count.

The CI setup job runs `check:test-runner-foundation` once after dependency
installation. It is not prepended to the sharded root test command, so Jest and
Vitest CLI flags cannot leak into the foundation orchestrator.

### Validation

- `pnpm install --frozen-lockfile --offline` passed across all 86 workspaces.
- `pnpm check:test-runner-foundation` passed:
  - Jest-native and limited-bridge tooling typechecks;
  - one Vitest tooling file and five tests;
  - exact five-file Jest/Vitest shadow parity;
  - exact remaining-Jest inventory check.
- `pnpm --filter @medusajs/locking-cloudflare test` passed its unchanged Jest
  default with one file and one test.
- `pnpm --filter @medusajs/locking-cloudflare build` passed.
- `pnpm check:workspace-dependencies` passed all 86 manifests.
- `medusa-cloudflare` typecheck passed.
- composed Worker import guard passed with 1,593 bundled inputs.
- runtime source import guard passed.
- portable entrypoint guard passed all four inputs, including the shared
  `EmitEvents` leaf.
- `pnpm peers check` introduced no peer regression and remains limited to the
  four pre-existing Rollup, ESLint, Tailwind, and AWS SDK groups.
- `git diff --check` passed.

## Locking Cloudflare Vitest Shadow

Commit:

- `83b4deec8c` (`test: shadow locking Cloudflare with Vitest`)

Date verified: 2026-07-10.

### Difference From Original Medusa

`@medusajs/locking-cloudflare` now owns an additional package-local Vitest
shadow configuration and `test:vitest` command. Its original Jest config and
authoritative `test` command remain unchanged:

```text
jest --passWithNoTests src
```

No production source, test source, assertion, expected value, fixture,
snapshot, skip state, package export, or runtime adapter changed.

The Vitest config supplies:

- the package directory as an absolute root;
- the shared JavaScript/TypeScript Node discovery globs scoped beneath `src/`,
  matching the positional boundary of the authoritative Jest command;
- the existing `@services` alias mapped to `src/services`;
- no legacy Jest bridge, because this lane has no Jest-specific API.

This is a shadow only. Vitest does not become authoritative until the separate
Turn 4 cut-over and Jest remains the one-command rollback candidate.

### Exact Baseline And Parity

The authoritative Jest baseline is:

- file:
  `packages/modules/providers/locking-cloudflare/src/__tests__/provider.spec.ts`;
- full test name:
  `locking cloudflare provider export exports the Durable Object locking provider service`;
- one passed test;
- zero failed, skipped, or todo tests;
- zero snapshots;
- Node environment, with no database, Redis, workerd, environment variable, or
  external service requirement.

The reusable `test:test-runner-compare` command now validates two JSON reporter
outputs through the strict Turn 2 normalizer and also requires the exact
expected file list. The Jest and Vitest outputs match exactly on runner success,
file, full name, status, suite/test counts, and snapshot summary. Matching
failed or empty runs are rejected rather than accepted as parity.

### Validation

- `pnpm --filter @medusajs/locking-cloudflare test` passed one file and one test
  through the unchanged Jest default.
- `pnpm --filter @medusajs/locking-cloudflare test:vitest` passed one file and
  one test on Vitest 4.1.10.
- strict JSON comparison passed with one expected file, one passed test, and
  zero failed, skipped, todo, or snapshot results.
- the shared runner contract rejects matching failed results and matching empty
  results, so equal red or zero-test runs cannot certify a shadow.
- `pnpm --filter @medusajs/locking-cloudflare build` passed.
- `pnpm check:remaining-jest` remained exact at 68 configs, 116 runner scripts,
  and 406 API files; no rollback ownership was removed or added.
- `pnpm check:workspace-dependencies` passed all 86 manifests.
- `medusa-cloudflare` typecheck passed.
- composed Worker import guard passed with 1,593 bundled inputs.
- runtime source import and portable entrypoint guards passed.
- `pnpm check:test-runner-foundation` passed after adding the generic result
  comparator.
- `git diff --check` passed.

## Locking Cloudflare Vitest Cut-Over

Commit:

- `dcd9b7b81d` (`test: switch locking Cloudflare to Vitest`)

Date verified: 2026-07-10.

### Difference From Original Medusa

`@medusajs/locking-cloudflare` now uses Vitest as its authoritative unit-test
runner. The package scripts are:

```text
test      -> vitest run --config vitest.config.mts
test:jest -> jest --passWithNoTests src
```

The temporary `test:vitest` shadow alias is removed. The Jest command value and
`jest.config.js` remain unchanged, so rollback is one command and does not
require a source-code revert. Jest rollback and config retirement remain
deferred to a later rollback-retirement turn.

No Jest or Vitest config, production source, test source, test name, assertion,
expected value, fixture, snapshot, skip/todo state, package export, persistence
behavior, or runtime adapter changed.

### Root And CI Argument Boundary

The unit-test CI job forwards `--shard`, `--maxWorkers`, and
`--passWithNoTests` through pnpm and Turbo. Under the current pnpm 11 and Turbo
1.13.4 toolchain, its previous command lost Turbo's task-argument separator and
failed before any package test with `unexpected argument '--shard'`:

```text
pnpm test -- --shard=... --maxWorkers=... --passWithNoTests
```

The global task audit then exposed two existing serial Jest scripts,
`@medusajs/framework` and `@medusajs/utils`, that already own `--runInBand`.
Jest rejects a forwarded `--maxWorkers` beside that flag. It also exposed the
inactive `@medusajs/types` script, whose previous shell built-in `exit 0`
rejected forwarded arguments under the Ubuntu POSIX shell.

The CI step was intended to split the 85-task surface into an 83-task general
lane plus the two serial packages, but Turn 15 invalidated the recorded exact
workflow-command proof. The then-committed strings placed Turbo filters after
pnpm's separator:

```text
pnpm test -- --filter='!@medusajs/framework' --filter='!@medusajs/utils' -- --shard=... --maxWorkers=... --passWithNoTests
pnpm test -- --filter=@medusajs/framework --filter=@medusajs/utils -- --shard=... --passWithNoTests
```

With pnpm 11.7.0, those exact strings forward `--filter` to package runners
instead of applying it in Turbo. The desired general lane retains worker
capping; the desired serial lane preserves each package's intentional
`--runInBand` behavior without the conflicting flag.
`@medusajs/types` remains in the general task surface, but its no-op is now the
cross-platform, argument-tolerant command below:

```text
node -e "process.exit(0)" --
```

This does not activate the five Types files that remain subject to their own
later restore-or-retire decision. The Types no-op accepted the forwarded CI
arguments under both the Windows package shell and Git Bash.

Turbo-level dry-runs with correctly positioned filters confirmed the desired
83/2 partition, and direct package executions proved the selected runners accept
their intended forwarded arguments. They did not prove the exact workflow
strings. Turn 15 reproduced those strings selecting all 85 packages and failing
when Vitest received `--filter`; Turn 16 later repairs the workflow and adds the
parsed contract.

For Locking Cloudflare itself, shard 1 runs the provider test. Shards 2 through
4 intentionally discover no file and exit successfully because the CI command
retains `--passWithNoTests`. The Jest rollback accepts the same arguments and
has the same populated/empty shard behavior.

Turbo continues to report the pre-existing pnpm 11 `patchedDependencies`
package-graph warning. The scoped task still selects exactly one package and
passes; repairing or upgrading that separate graph boundary is not part of this
runner cut-over.

### Exact Parity And Ownership

Exact JSON comparison was reconfirmed before and after the default switch:

- file:
  `packages/modules/providers/locking-cloudflare/src/__tests__/provider.spec.ts`;
- full test name:
  `locking cloudflare provider export exports the Durable Object locking provider service`;
- one passed test and zero failed, skipped, or todo tests;
- zero snapshots;
- successful Jest and Vitest reporter results.

The initial remaining-Jest guard failed with exactly one expected ownership
replacement:

```text
removed: script=test      command=jest --passWithNoTests src
added:   script=test:jest command=jest --passWithNoTests src
```

After review, the exact baseline was updated to digest
`b6778e4dc592bba58d8db382402a4f0e1f37e4ba9cc8953eaf05b6e86b50a6bc`.
All counts remain unchanged: 68 Jest configs, 116 Jest runner-script entries
across 68 owners, 11 Jest dependency entries across four owners, and 406 Jest
API files. The retained rollback therefore remains visible rather than being
misreported as Jest removal.

### Validation

- package Vitest default passed one file and one test;
- package Jest rollback passed the identical file and test;
- all four direct package CI shard shapes exited successfully;
- scoped root Turbo delegation passed populated and empty Locking Cloudflare
  shards;
- the global Turbo audit found 85 task nodes: 74 executable test scripts using
  only Jest, Vitest, or the intentional Types no-op, plus 11 packages without a
  test script;
- Turbo dry runs proved the 83-task general and two-task serial partition;
- the representative general lane passed Locking Cloudflare and Types together;
- the real serial shard passed Framework's 9 suites and 49 tests plus Utils' 24
  suites, 142 passed tests, one skipped test, and two matched snapshots per
  package, without the conflicting worker flag;
- the Types no-op accepted forwarded arguments under Windows and Git Bash
  without activating its discoverable tests;
- strict post-switch JSON parity passed;
- package build passed;
- `pnpm check:remaining-jest` passed with the reviewed ownership baseline;
- `pnpm check:workspace-dependencies` passed all 86 manifests;
- `medusa-cloudflare` typecheck passed;
- composed Worker import guard passed with 1,593 bundled inputs;
- runtime source import and all four portable entrypoint guards passed;
- `pnpm check:test-runner-foundation` passed its strict type lanes, five tooling
  tests, exact five-file Jest/Vitest parity, and inventory gate;
- Prettier and `git diff --check` passed;
- independent command-boundary and inventory reviews passed after findings were
  resolved.

## Payment Stripe Vitest Shadow

Commit:

- `67de3aadca` (`test: shadow Payment Stripe with Vitest`)

Date verified: 2026-07-10.

### Difference From Original Medusa

`@medusajs/payment-stripe` now owns an additional package-local Vitest shadow
configuration and `test:vitest` command. Its original Jest config and
authoritative command remain unchanged:

```text
test        -> jest --passWithNoTests src
test:vitest -> vitest run --config vitest.config.mts
```

No production source, test source, test name, assertion, expected value,
fixture, snapshot, skip/todo state, package export, Stripe behavior, or runtime
adapter changed. This turn does not switch the package default.

The Vitest config supplies:

- the package directory as an absolute root;
- the shared JavaScript/TypeScript Node discovery globs scoped beneath `src/`,
  preserving the authoritative Jest positional boundary and excluding the
  built `dist` copy of the test;
- the existing `@models`, `@services`, `@repositories`, `@types`, and `@utils`
  mappings in Jest-config order;
- no legacy Jest bridge or setup file, because the lane uses only
  `describe`/`it`/`expect` globals.

The current test imports its utility relatively, so the five aliases are
preserved configuration inputs but are not behaviorally exercised by this
shadow. They remain subject to proof when a migrated test actually imports
them.

### Exact Baseline And Parity

The authoritative Jest baseline and exact post-shadow result are:

- file:
  `packages/modules/providers/payment-stripe/src/utils/__tests__/get-smallest-unit.ts`;
- full test name:
  `getSmallestUnit should convert an amount to the format required by Stripe based on currency`;
- one passed test file and one passed test;
- nine unchanged expectation calls inside that test;
- zero failed, skipped, or todo tests;
- zero snapshots;
- successful Jest and Vitest reporter results.

`vitest list` returns only the source test. Strict JSON comparison matches the
file, full name, status, normalized file/test counts, and snapshot summary
exactly.

This Node-only unit lane requires no Stripe API key, environment variable,
network request, database, Redis, workerd runtime, or external service. The
production Stripe client is outside the test import graph. The runtime path is
the source currency helper through the built CommonJS
`@medusajs/framework/utils` barrel into Medusa's number utilities and
`bignumber.js`; passing under Vitest proves that second-provider interop
boundary.

### Remaining-Jest Ownership

The package retains exactly its two existing Jest ownership entries:

- `packages/modules/providers/payment-stripe/jest.config.js`;
- package script `test` with `jest --passWithNoTests src`.

Adding a Vitest config and a Vitest-only shadow command does not change the
remaining-Jest ledger. The baseline stays byte-identical at digest
`b6778e4dc592bba58d8db382402a4f0e1f37e4ba9cc8953eaf05b6e86b50a6bc`,
with 68 Jest configs, 116 runner-script entries across 68 owners, 11 Jest
dependency entries across four owners, and 406 Jest API files. No inventory
update was run.

### Validation

- authoritative package Jest command passed one file and one test;
- package Vitest shadow passed the identical file and test on Vitest 4.1.10;
- package Vitest config passed a strict standalone TypeScript check with
  `noUncheckedIndexedAccess`;
- `vitest list` returned only the source test;
- strict sequential JSON parity passed with zero snapshots;
- package build passed;
- `pnpm check:remaining-jest` passed without a baseline update;
- `pnpm check:workspace-dependencies` passed all 86 manifests;
- `medusa-cloudflare` typecheck passed;
- composed Worker import guard passed with 1,593 bundled inputs;
- runtime source import and all four portable entrypoint guards passed;
- `pnpm check:test-runner-foundation` passed its strict type lanes, five tooling
  tests, exact five-file Jest/Vitest parity, and inventory gate;
- Prettier and `git diff --check` passed;
- independent config/import-graph and inventory reviews passed.

## Payment Stripe Vitest Cut-Over

Commit:

- `897cb804ea` (`test: switch Payment Stripe to Vitest`)

Date verified: 2026-07-10.

### Difference From Original Medusa

`@medusajs/payment-stripe` now uses Vitest as its authoritative unit-test
runner. The package scripts are:

```text
test      -> vitest run --config vitest.config.mts
test:jest -> jest --passWithNoTests src
```

The temporary `test:vitest` shadow alias is removed. The Jest command value and
`jest.config.js` remain unchanged, so rollback is one command and does not
require a source-code revert. Jest rollback and config retirement remain
deferred to a later rollback-retirement turn.

No Jest or Vitest config, production source, test source, test name, assertion,
expected value, fixture, snapshot, skip/todo state, alias, package export,
Stripe behavior, persistence behavior, or runtime adapter changed.

### Package And Root Argument Boundary

Direct package proof ran both the Vitest default and Jest rollback with the
unit-CI arguments on every shard:

```text
pnpm --filter @medusajs/payment-stripe test -- --shard=N/4 --maxWorkers=1 --passWithNoTests
pnpm --filter @medusajs/payment-stripe test:jest -- --shard=N/4 --maxWorkers=1 --passWithNoTests
```

Scoped root proof used the intended general unit-CI filters in their correct
pnpm/Turbo position without modifying the workflow:

```text
pnpm test --filter=@medusajs/payment-stripe --filter='!@medusajs/framework' --filter='!@medusajs/utils' -- --shard=N/4 --maxWorkers=1 --passWithNoTests
```

For all three command shapes, shard 1 runs the source test and shards 2 through
4 intentionally discover no file and exit successfully. `--passWithNoTests`
therefore remains required. Turbo selects exactly Payment Stripe in this
corrected-position scoped root proof. It did not prove the then-malformed
workflow string, which Turn 16 later repairs. The pre-existing pnpm 11
`patchedDependencies` graph warning remains separate and does not prevent the
selected task from passing.

Payment Stripe belongs to the intended 83-task general lane and does not own
`--runInBand`, so this cut-over required no package-specific workflow edit. Turn
16 later repairs the exact shared workflow-command defect.

### Exact Parity And Ownership

Exact JSON comparison was reconfirmed before and after the default switch:

- file:
  `packages/modules/providers/payment-stripe/src/utils/__tests__/get-smallest-unit.ts`;
- full test name:
  `getSmallestUnit should convert an amount to the format required by Stripe based on currency`;
- one passed test file and one passed test;
- nine unchanged expectation calls;
- zero failed, skipped, or todo tests;
- zero snapshots;
- successful Jest and Vitest reporter results.

The source-scoped config continues to exclude the built `dist` copy. The live
Vitest default continues to prove the CommonJS Framework utilities-barrel path,
while the Stripe client and external service paths remain outside the test
graph. The five preserved package aliases remain unexercised and are not
claimed as behaviorally proven.

The initial remaining-Jest guard failed with exactly one expected ownership
replacement:

```text
removed: script=test      command=jest --passWithNoTests src
added:   script=test:jest command=jest --passWithNoTests src
```

After review, the exact baseline was updated to digest
`70c390f75069251fbb5fdccbd4bde6214bef0d1e922525b516e2db4bc12f54a0`.
All counts remain unchanged: 68 Jest configs, 116 Jest runner-script entries
across 68 owners, 11 Jest dependency entries across four owners, and 406 Jest
API files. The package's retained Jest config and rollback remain visible.

### Validation

- package Vitest default and Jest rollback each passed one file and one test;
- all four direct default and rollback shard shapes exited successfully;
- all four scoped root/general-lane shard shapes selected only Payment Stripe
  and exited successfully;
- strict pre-switch and post-switch JSON parity passed with zero snapshots;
- package build passed;
- package Vitest config passed its standalone strict TypeScript check with
  `noUncheckedIndexedAccess`;
- `pnpm check:remaining-jest` passed with the reviewed ownership baseline;
- `pnpm check:workspace-dependencies` passed all 86 manifests;
- `medusa-cloudflare` typecheck passed;
- composed Worker import guard passed with 1,593 bundled inputs;
- runtime source import and all four portable entrypoint guards passed;
- `pnpm check:test-runner-foundation` passed its strict type lanes, five tooling
  tests, exact five-file Jest/Vitest parity, and inventory gate;
- Prettier and `git diff --check` passed;
- independent command-boundary and inventory reviews passed.

## Core Flows Vitest Shadow

Commit:

- `5f62a07187` (`test: shadow Core Flows with Vitest`)

Date verified: 2026-07-10.

### Difference From Original Medusa

`@medusajs/core-flows` now owns an additional package-local Vitest shadow
configuration and `test:vitest` command. Its original Jest config and
authoritative command remain unchanged:

```text
test        -> jest --bail --forceExit --passWithNoTests
test:vitest -> vitest run --config vitest.config.mts
```

No production source, test source, test name, assertion, expected value,
fixture, snapshot, skip/todo state, package export, workflow behavior,
persistence behavior, or runtime adapter changed. This turn does not switch the
package default.

The Vitest config supplies:

- the package directory as an absolute root;
- the shared JavaScript/TypeScript Node discovery globs scoped beneath `src/`,
  which collect the package's complete current three-file test surface and
  exclude built `dist` output;
- an empty alias list because the package Jest config defines no
  `moduleNameMapper` and the tests use relative source imports plus workspace
  package entrypoints;
- no legacy Jest bridge or setup file because the lane uses runner-neutral
  globals and no Jest API.

This is a shadow only. Vitest does not become authoritative until the separate
Turn 8 cut-over, and Jest remains the current default.

### Exact Baseline And Parity

The authoritative Jest baseline and exact Vitest shadow result are:

- `src/cart/utils/__tests__/prepare-confirm-inventory-input.spec.ts`: eight
  passed tests;
- `src/common/steps/__tests__/use-query-graph-step.spec.ts`: three passed tests;
- `src/order/utils/__tests__/aggregate-status.spec.ts`: two passed tests;
- three passed test files and 13 passed tests in total;
- zero failed, skipped, or todo tests;
- zero snapshots;
- successful Jest and Vitest reporter results.

These are all test files currently present below Core Flows `src/`. The
`vitest list` command returns exactly the same 13 full test names. Strict JSON
comparison matches runner success, all three files, every full name and status,
normalized file/test counts, and the snapshot summary exactly. Matching failed
or empty runs remain rejected by the shared comparator.

### Import And Runtime Boundary

The three tests use relative imports for their Core Flows source and fixture.
The live package resolution proof reaches these real built workspace/runtime
entrypoints:

```text
@medusajs/framework        -> packages/core/framework/dist/index.js
@medusajs/framework/awilix -> packages/core/framework/dist/deps/awilix.js
@medusajs/framework/utils  -> packages/core/framework/dist/utils/index.js
@medusajs/workflows-sdk    -> packages/core/workflows-sdk/dist/index.js
@medusajs/utils            -> packages/core/utils/dist/index.js
expect-type                -> node_modules/expect-type/dist/index.js
```

The shared-core proof therefore covers Framework utilities and container
composition, an in-memory Awilix container, Workflows SDK workflow/step
execution, Utils registration keys, and the existing `expect-type` assertions.
It requires no database, Redis, network request, workerd runtime, environment
variable, or external service. The Jest command continues to print its standard
`--forceExit` advisory; this turn neither introduces nor claims to diagnose that
pre-existing runner behavior.

### Root And Inventory Boundary

All four scoped root/general-lane proofs place their filters before pnpm's
separator and select only Core Flows through the unchanged Jest default:

```text
pnpm test --filter=@medusajs/core-flows --filter='!@medusajs/framework' --filter='!@medusajs/utils' -- --shard=N/4 --maxWorkers=1 --passWithNoTests
```

Shard 1 runs the three Query Graph tests, shard 2 runs the two aggregate-status
tests, shard 3 runs the eight inventory-input tests, and shard 4 intentionally
collects no test and exits successfully. `--passWithNoTests` remains required.
Turbo selects exactly Core Flows. The pre-existing pnpm 11
`patchedDependencies` graph warning remains separate and does not prevent the
selected task from passing. This proves the intended Turbo filter set, not the
then-malformed workflow string later repaired in Turn 16. Because the
authoritative package script is unchanged, no package-script or CI workflow
change is made in this shadow turn.

Adding a Vitest config and Vitest-only script does not change remaining-Jest
ownership. The baseline remains byte-identical at digest
`70c390f75069251fbb5fdccbd4bde6214bef0d1e922525b516e2db4bc12f54a0`,
with 68 Jest configs, 116 runner-script entries across 68 owners, 11 Jest
dependency entries across four owners, and 406 Jest API files.

### Validation

- authoritative package Jest command passed three files and 13 tests;
- package Vitest shadow passed the identical files and tests on Vitest 4.1.10;
- `vitest list` returned exactly the 13 expected full test names;
- strict JSON parity passed with zero failures, skips, todos, or snapshots;
- all four scoped root/general-lane Jest shard shapes selected only Core Flows
  and exited successfully;
- package build passed;
- package Vitest config passed its standalone strict TypeScript check with
  `noUncheckedIndexedAccess`;
- `pnpm check:remaining-jest` passed without a baseline update;
- `pnpm check:workspace-dependencies` passed all 86 manifests;
- `medusa-cloudflare` typecheck passed;
- composed Worker import guard passed with 1,593 bundled inputs;
- runtime source import and all four portable entrypoint guards passed;
- `pnpm check:test-runner-foundation` passed its strict type lanes, five tooling
  tests, exact five-file Jest/Vitest parity, and inventory gate;
- Prettier and `git diff --check` passed;
- independent config/command-boundary and evidence-ledger reviews passed.

## Core Flows Vitest Cut-Over

Commit:

- `0eb789b960` (`test: switch Core Flows to Vitest`)

Date verified: 2026-07-10.

### Difference From Original Medusa

`@medusajs/core-flows` now uses Vitest as its authoritative unit-test runner.
The package scripts are:

```text
test      -> vitest run --config vitest.config.mts
test:jest -> jest --bail --forceExit --passWithNoTests
```

The temporary `test:vitest` shadow alias is removed. The Jest command value and
`jest.config.js` remain unchanged, so rollback is one command and retains the
legacy bail, force-exit, and empty-suite behavior. Jest rollback and config
retirement remain deferred to a later rollback-retirement turn.

The Vitest default intentionally remains the exact command proven by the
shadow. Its shared profile fails a normal package run when discovery becomes
empty. The existing unit-CI lane explicitly forwards `--passWithNoTests`
because one of its four shards is legitimately empty. `--forceExit` has no
Vitest equivalent and is unnecessary because the shadow/default exits
naturally. Vitest's numeric, test-oriented `--bail` is not treated as identical
to Jest's bare suite-oriented flag; the exact old semantics remain in
`test:jest`.

No Jest or Vitest config, production source, test source, test name, assertion,
expected value, fixture, snapshot, skip/todo state, alias, package export,
workflow behavior, persistence behavior, or runtime adapter changed.

### Package And Root Argument Boundary

Direct package proof ran both the Vitest default and Jest rollback with the
unit-CI arguments on every shard:

```text
pnpm --filter @medusajs/core-flows test -- --shard=N/4 --maxWorkers=1 --passWithNoTests
pnpm --filter @medusajs/core-flows test:jest -- --shard=N/4 --maxWorkers=1 --passWithNoTests
```

Scoped root proof used the intended general unit-CI filters in their correct
pnpm/Turbo position without modifying the workflow:

```text
pnpm test --filter=@medusajs/core-flows --filter='!@medusajs/framework' --filter='!@medusajs/utils' -- --shard=N/4 --maxWorkers=1 --passWithNoTests
```

Vitest assigns aggregate-status to shard 1, inventory-input to shard 2, Query
Graph to shard 3, and no file to shard 4, producing a 2/8/3/0 test distribution.
Jest rollback assigns Query Graph, aggregate-status, inventory-input, and no
file respectively, producing 3/2/8/0. Runner-specific hashing therefore changes
shard placement, but both cover all three files and 13 tests exactly once.
Shard 4 requires `--passWithNoTests` for both runners.

Turbo selects exactly Core Flows in every scoped root proof and reproduces the
Vitest 2/8/3/0 distribution. The pre-existing pnpm 11 `patchedDependencies`
graph warning remains separate and does not prevent the selected task from
passing. This proof did not validate the then-malformed workflow string later
repaired in Turn 16. Core Flows remains in the intended general unit lane and
owns no `--runInBand` conflict, so this turn made no CI workflow change.

### Exact Parity And Ownership

Exact JSON comparison was reconfirmed before and after the default switch:

- `src/cart/utils/__tests__/prepare-confirm-inventory-input.spec.ts`: eight
  passed tests;
- `src/common/steps/__tests__/use-query-graph-step.spec.ts`: three passed tests;
- `src/order/utils/__tests__/aggregate-status.spec.ts`: two passed tests;
- three passed test files and 13 passed tests in total;
- zero failed, skipped, or todo tests;
- zero snapshots;
- successful Jest and Vitest reporter results.

The source-scoped config, empty alias list, built shared-core entrypoints, and
runner-neutral tests remain unchanged from the accepted shadow. The strict
comparator continues to match every file, full name, status, normalized count,
and snapshot summary rather than relying on runner-specific shard placement.

The initial remaining-Jest guard failed with exactly one expected ownership
replacement:

```text
removed: script=test      command=jest --bail --forceExit --passWithNoTests
added:   script=test:jest command=jest --bail --forceExit --passWithNoTests
```

After review, the exact baseline was updated to digest
`f2bdfce9776c46d5288800902632077246e6d210df2c7ba78d95c60ece6d3b3a`.
All counts remain unchanged: 68 Jest configs, 116 Jest runner-script entries
across 68 owners, 11 Jest dependency entries across four owners, and 406 Jest
API files. The package's retained Jest config and rollback remain visible.

### Validation

- package Vitest default and Jest rollback each passed three files and 13 tests;
- all four direct default and rollback shard shapes exited successfully;
- all four scoped root/general-lane shard shapes selected only Core Flows and
  exited successfully;
- strict pre-switch and post-switch JSON parity passed with zero snapshots;
- package build passed;
- package Vitest config passed its standalone strict TypeScript check with
  `noUncheckedIndexedAccess`;
- `pnpm check:remaining-jest` passed with the reviewed ownership baseline;
- `pnpm check:workspace-dependencies` passed all 86 manifests;
- `medusa-cloudflare` typecheck passed;
- composed Worker import guard passed with 1,593 bundled inputs;
- runtime source import and all four portable entrypoint guards passed;
- `pnpm check:test-runner-foundation` passed its strict type lanes, five tooling
  tests, exact five-file Jest/Vitest parity, and inventory gate;
- Prettier and `git diff --check` passed;
- independent command-boundary and inventory/evidence reviews passed.

## Currency Unit Vitest Shadow

Commit:

- `ef06812651` (`test: shadow Currency unit lane with Vitest`)

Date verified: 2026-07-10.

### Difference From Original Medusa

`@medusajs/currency` now owns an additional package-local Vitest unit shadow
configuration and `test:vitest` command. Both original Jest commands remain
byte-identical and authoritative:

```text
test             -> jest --bail --forceExit --testPathPattern=src
test:vitest      -> vitest run --config vitest.config.mts
test:integration -> jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

No production source, test source, test name, assertion, expected value,
fixture, snapshot, skip/todo state, package export, persistence behavior,
integration runner, or runtime adapter changed. This turn does not switch the
unit default and does not migrate Currency integration.

The Vitest config supplies:

- the package directory as an absolute root;
- the shared JavaScript/TypeScript Node discovery globs scoped beneath `src/`,
  matching the unit Jest path boundary while including unsuffixed
  `src/services/__tests__/noop.ts`;
- the existing `@models`, `@services`, `@repositories`, and `@types` aliases in
  Jest mapper order;
- no legacy Jest bridge or setup file because the two unit files use only
  runner-neutral globals.

The explicit source scope excludes both rebuilt `dist` copies and the root
`integration-tests` tree. Vitest remains a manual shadow until the separate
Turn 10 unit cut-over.

### Exact Unit Baseline And Parity

The authoritative Jest unit baseline and exact Vitest shadow result are:

- `src/__tests__/static-manifest.spec.ts`, full name
  `Currency static manifest matches the normal Currency module export and joiner config`;
- `src/services/__tests__/noop.ts`, full name `noop should run`;
- two passed test files and two passed tests;
- six unchanged assertion calls: five static-manifest assertions and one noop
  assertion;
- zero failed, skipped, or todo tests;
- zero snapshots;
- successful Jest and Vitest reporter results.

`noop.ts` is a real collected and passing suite, not an ignored placeholder.
After the package build recreated `dist`, `vitest list` still returned exactly
the two expected source tests. Strict JSON comparison matches runner success,
both files, both full names and statuses, normalized counts, and the snapshot
summary exactly.

### Alias, Import, And Runtime Boundary

The static-manifest test imports Currency source relatively, then exercises
`@services` through `src/index.ts` and `@models` through the service/loader
graph. `@repositories` and `@types` remain preserved configuration inputs but
are not behaviorally exercised by these tests.

The live package resolution proof reaches these built workspace entrypoints:

```text
@medusajs/modules-sdk
@medusajs/modules-sdk/definitions
@medusajs/utils/modules-sdk/definition
@medusajs/utils/modules-sdk/portable-joiner-config-builder
@medusajs/framework/modules-sdk/definition
@medusajs/framework/modules-sdk/module
@medusajs/utils/modules-sdk/medusa-service
@medusajs/utils/dml/model
```

The unchanged `.toBe` checks prove service identity across the normal module and
static manifest, while the schema comparison proves portable joiner/model
metadata. This is an in-memory import and identity proof: the imported loader is
not executed, and the unit lane requires no database, Redis, network request,
workerd runtime, environment variable, or external service.

### Integration, Root, And Inventory Boundary

Currency owns one shared Jest config; its package script path patterns separate
unit from integration. The unchanged integration command lists exactly:

```text
integration-tests/__tests__/currency-module-service.spec.ts
```

That suite retains `jest.setTimeout(100000)` and
`moduleIntegrationTestRunner`. This turn only lists the file; it does not run or
claim PostgreSQL, PGlite/Drizzle, workerd/D1, or any integration backend.

All four scoped root/general-lane proofs place their filters before pnpm's
separator and select only Currency through the unchanged Jest unit default:

```text
pnpm test --filter=@medusajs/currency --filter='!@medusajs/framework' --filter='!@medusajs/utils' -- --shard=N/4 --maxWorkers=1 --passWithNoTests
```

Shard 1 runs `noop.ts`, shard 2 runs `static-manifest.spec.ts`, and shards 3 and
4 intentionally collect no test and exit successfully. `--passWithNoTests`
remains required. Turbo selects exactly Currency. The pre-existing pnpm 11
`patchedDependencies` graph warning remains separate and does not prevent the
selected task from passing. This proves the intended Turbo filter set, not the
then-malformed workflow string later repaired in Turn 16. Because both
authoritative package scripts are unchanged, no package-script or
integration-workflow change is required.

Adding a Vitest config and Vitest-only shadow script does not change any of
Currency's four remaining-Jest ownership records: integration API use,
`jest.config.js`, unit `test`, and `test:integration`. The exact baseline stays
byte-identical at digest
`f2bdfce9776c46d5288800902632077246e6d210df2c7ba78d95c60ece6d3b3a`,
with 68 Jest configs, 116 runner-script entries across 68 owners, 11 Jest
dependency entries across four owners, and 406 Jest API files. No inventory
update was run.

### Validation

- authoritative package Jest unit command passed two files and two tests;
- package Vitest unit shadow passed the identical files and tests on Vitest
  4.1.10;
- post-build `vitest list` returned exactly the two source tests;
- strict JSON parity passed with zero failures, skips, todos, or snapshots;
- the unchanged integration command listed exactly its one separate Jest file
  without executing it;
- all four scoped root/general-lane Jest shard shapes selected only Currency and
  exited successfully;
- package build passed;
- package Vitest config passed its standalone strict TypeScript check with
  `noUncheckedIndexedAccess`;
- `pnpm check:remaining-jest` passed without a baseline update;
- `pnpm check:workspace-dependencies` passed all 86 manifests;
- `medusa-cloudflare` typecheck passed;
- composed Worker import guard passed with 1,593 bundled inputs;
- runtime source import and all four portable entrypoint guards passed;
- `pnpm check:test-runner-foundation` passed its strict type lanes, five tooling
  tests, exact five-file Jest/Vitest parity, and inventory gate;
- Prettier and `git diff --check` passed;
- independent alias/import-boundary and inventory/evidence reviews passed.

## Currency Unit Vitest Cut-Over

Commit:

- `135dd713a8` (`test: switch Currency unit lane to Vitest`)

Date verified: 2026-07-10.

### Difference From Original Medusa

`@medusajs/currency` now uses Vitest as its authoritative unit-test runner while
Currency integration remains on Jest. The package scripts are:

```text
test             -> vitest run --config vitest.config.mts
test:jest        -> jest --bail --forceExit --testPathPattern=src
test:integration -> jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The temporary `test:vitest` shadow alias is removed. The Jest unit command value
and shared `jest.config.js` remain unchanged, so unit rollback is one command
and retains the legacy bail, force-exit, and source-path behavior. The
integration command, integration Jest API, and backend boundary remain
byte-identical and separately owned.

The Vitest unit default remains the exact command proven by the shadow. Its
source-scoped shared profile replaces the unit `--testPathPattern=src` boundary
and fails a normal package run when discovery becomes empty. Unit CI explicitly
forwards `--passWithNoTests` because two of its four shards are legitimately
empty. `--forceExit` has no Vitest equivalent and is unnecessary because the
shadow/default exits naturally. Vitest's numeric, test-oriented `--bail` is not
treated as identical to Jest's bare suite-oriented flag; the exact old unit
semantics remain in `test:jest`.

No Jest or Vitest config, production source, test source, test name, assertion,
expected value, fixture, snapshot, skip/todo state, alias, package export,
integration behavior, persistence behavior, or runtime adapter changed.

### Unit Package And Root Argument Boundary

Direct package proof ran both the Vitest unit default and Jest unit rollback
with the unit-CI arguments on every shard:

```text
pnpm --filter @medusajs/currency test -- --shard=N/4 --maxWorkers=1 --passWithNoTests
pnpm --filter @medusajs/currency test:jest -- --shard=N/4 --maxWorkers=1 --passWithNoTests
```

Scoped root proof used the intended general unit-CI filters in their correct
pnpm/Turbo position without modifying the workflow:

```text
pnpm test --filter=@medusajs/currency --filter='!@medusajs/framework' --filter='!@medusajs/utils' -- --shard=N/4 --maxWorkers=1 --passWithNoTests
```

Both runners assign `noop.ts` to shard 1, `static-manifest.spec.ts` to shard 2,
and no file to shards 3 or 4, producing an identical 1/1/0/0 test distribution.
The empty shards require `--passWithNoTests`. Turbo selects exactly Currency in
every scoped root proof and reproduces the Vitest distribution. The pre-existing
pnpm 11 `patchedDependencies` graph warning remains separate and does not
prevent the selected task from passing. This proof did not validate the
then-malformed workflow string later repaired in Turn 16. Currency remains in
the intended general unit lane and owns no `--runInBand` conflict, so this turn
made no CI workflow change.

Vitest 4.1.10 `list --shard=N/4` is not valid evidence when four shards outnumber
the two files: it can print an unhandled shard-count collection error while
exiting zero. This turn uses unsharded `vitest list` for exact discovery and
real `vitest run` output for every shard result.

### Exact Unit Parity And Ownership

Exact JSON comparison was reconfirmed before and after the unit default switch:

- `src/__tests__/static-manifest.spec.ts`, full name
  `Currency static manifest matches the normal Currency module export and joiner config`;
- `src/services/__tests__/noop.ts`, full name `noop should run`;
- two passed test files and two passed tests;
- six unchanged assertion calls;
- zero failed, skipped, or todo tests;
- zero snapshots;
- successful Jest and Vitest reporter results.

The source-scoped config, four aliases, built package entrypoints, identity
checks, and runner-neutral tests remain unchanged from the accepted shadow. The
strict comparator continues to match every file, full name, status, normalized
count, and snapshot summary.

The initial remaining-Jest guard failed with exactly one expected unit ownership
replacement:

```text
removed: script=test      command=jest --bail --forceExit --testPathPattern=src
added:   script=test:jest command=jest --bail --forceExit --testPathPattern=src
```

After review, the exact baseline was updated to digest
`4c07940bea5982f8ed55d330580061af42af620a2d0eb40cfb5f572c21a9e41e`.
All counts remain unchanged: 68 Jest configs, 116 Jest runner-script entries
across 68 owners, 11 Jest dependency entries across four owners, and 406 Jest
API files. Currency retains four visible Jest records: integration API use,
shared config, unit rollback, and `test:integration`.

### Integration Boundary

The unchanged integration command still lists exactly:

```text
integration-tests/__tests__/currency-module-service.spec.ts
```

That suite remains on Jest with `jest.setTimeout(100000)` and
`moduleIntegrationTestRunner`. This turn only lists it; no PostgreSQL,
PGlite/Drizzle, workerd/D1, or other integration backend is executed or claimed
as migrated.

### Validation

- package Vitest unit default and Jest unit rollback each passed two files and
  two tests;
- all four direct default and rollback unit shard shapes exited successfully;
- all four scoped root/general-lane unit shard shapes selected only Currency and
  exited successfully;
- strict pre-switch and post-switch unit JSON parity passed with zero snapshots;
- package build passed;
- post-build unsharded `vitest list` returned exactly the two source tests;
- the unchanged integration command listed exactly its one separate Jest file
  without executing it;
- package Vitest config passed its standalone strict TypeScript check with
  `noUncheckedIndexedAccess`;
- `pnpm check:remaining-jest` passed with the reviewed ownership baseline;
- `pnpm check:workspace-dependencies` passed all 86 manifests;
- `medusa-cloudflare` typecheck passed;
- composed Worker import guard passed with 1,593 bundled inputs;
- runtime source import and all four portable entrypoint guards passed;
- `pnpm check:test-runner-foundation` passed its strict type lanes, five tooling
  tests, exact five-file Jest/Vitest parity, and inventory gate;
- Prettier and `git diff --check` passed;
- independent unit/integration-boundary and inventory/evidence reviews passed.

## Runner-Neutral Worker Identity

Commit:

- `02bba6a19c` (`test: add runner-neutral worker identity`)

Date verified: 2026-07-10.

### Difference From Original Medusa

Original Medusa derived test database and Redis isolation directly from
`JEST_WORKER_ID` in four runtime/setup files. This fork now has one pure, typed
`@medusajs/test-utils` boundary at `src/test-worker-identity.ts`. The two
TypeScript test runners import the source leaf relatively, and both CommonJS
integration helpers require only the built
`@medusajs/test-utils/dist/test-worker-identity` leaf.

This turn changes no Jest or Vitest command, config, default runner, CI workflow,
existing Medusa assertion, expected value, fixture, snapshot, skip/todo state,
persistence adapter, integration lifecycle, HTTP behavior, or Cloudflare
composition. It does not add the Turn 12 integration Vitest profile or execute
a module integration assertion.

### Identity Contract

The numeric worker slot uses this strict precedence:

1. `MEDUSA_TEST_WORKER_ID` explicit override;
2. `VITEST_POOL_ID`;
3. `JEST_WORKER_ID`;
4. default worker `1`.

The selected value must be a full positive safe-integer string. Empty, zero,
negative, signed, fractional, exponential, partial, leading-zero, and unsafe
integer values fail loudly instead of inheriting `parseInt`'s partial-input
behavior. A present invalid higher-priority value is not silently skipped.

The identity reports the selected source separately from the actual runner.
Vitest wins the runner namespace when `VITEST_POOL_ID` is present, even if a
stale Jest value is inherited or `MEDUSA_TEST_WORKER_ID` supplies the numeric
slot. Jest is selected next; otherwise the runner is `default`. Therefore:

- Vitest database suffixes are `vitest-N`;
- Jest database suffixes remain exactly `N`;
- no-runner database suffixes remain exactly `N`;
- Redis remains the existing zero-based numeric projection `N - 1`.

Vitest 4.1.10's bounded `VITEST_POOL_ID` is used rather than the globally unique
isolated-worker counter. This keeps resource allocation within the configured
pool width.

### Consumer And Override Boundaries

The four previous direct consumers now use the shared result:

- `module-test-runner.ts` composes
  `medusa-<module>-integration-<databaseSuffix>`;
- `medusa-test-runner.ts` composes the same database shape;
- `integration-tests/setup-env.js` composes
  `medusa-integration-<databaseSuffix>-<chunk>`;
- `integration-tests/environment-helpers/setup-server.js` appends the
  zero-based Redis database to the supplied Redis URL.

Existing stronger overrides remain intact. `config.dbName ?? generatedName`
keeps both TypeScript runners from resolving an identity when the caller owns
the complete database name. `setup-env.js` still leaves an existing
`DB_TEMP_NAME` untouched. `setup-server.js` resolves an identity only when a
base Redis URL is supplied, and its final `...env` spread still lets a caller's
`REDIS_URL` win.

The CommonJS integration setup deliberately avoids the package root barrel,
which eagerly loads database, Framework, bootstrap, and runner code. The built
leaf is available after `@medusajs/test-utils` build and is included by the
package's existing `dist` files policy. CI already builds and downloads package
artifacts before integration jobs. No restrictive package `exports` map was
introduced. The parent `integration-tests` directory is not itself selected by
the active `integration-tests/**/*` workspace pattern, so the existing root
`@medusajs/test-utils: workspace:*` link remains the resolution owner and no
inactive manifest or lockfile edge was added.

### Exact Compatibility Evidence

The pure resolver and built CommonJS leaf preserve these values:

| Environment                                       | Database suffix | Currency database                      | Setup database                  | Redis database |
| ------------------------------------------------- | --------------- | -------------------------------------- | ------------------------------- | -------------: |
| no runner values                                  | `1`             | `medusa-currency-integration-1`        | `medusa-integration-1-1`        |              0 |
| Jest worker `3`, chunk `2`                        | `3`             | `medusa-currency-integration-3`        | `medusa-integration-3-2`        |              2 |
| Vitest pool `3`, stale Jest worker `8`, chunk `2` | `vitest-3`      | `medusa-currency-integration-vitest-3` | `medusa-integration-vitest-3-2` |              2 |
| explicit `7` inside Vitest pool `3`, chunk `4`    | `vitest-7`      | `medusa-currency-integration-vitest-7` | `medusa-integration-vitest-7-4` |              6 |

A five-case `setup-env.js` subprocess matrix also proved that an existing
`DB_TEMP_NAME` survives even when the unused explicit worker value is invalid.
A four-case spawn-stub matrix proved Jest Redis `/2`, Vitest Redis `/1`, no
identity resolution when Redis is absent, and caller-owned `REDIS_URL`
precedence. It did not start a server or contact Redis.

The setup-server branch is currently dormant in active tests: it is reachable
through `start-server-with-environment.js`, but the audit found no active
callsite. Its runner-neutral wiring is retained for the later integration
foundation without claiming service-backed coverage in this turn.

### Redis Namespace Boundary

Database strings can carry a `vitest-` namespace; a Redis logical-database URL
can carry only a number. Preserving Jest workers 1 through 15 already reserves
logical databases 0 through 14 on a default 16-database Redis instance. A
disjoint multi-worker Vitest range therefore cannot be added honestly while
preserving every Jest mapping.

This turn keeps the legacy Redis projection and makes no cross-runner Redis
isolation claim. Before a Redis-backed shadow can run concurrently, a later
turn must select a separate Redis URL, add a key namespace, or define a safely
constrained dedicated database policy. Currency's upcoming PGlite shadow does
not use Redis.

### Remaining-Jest Ownership

The first inventory run failed with exactly the expected consolidation:

```text
removed: integration-tests/environment-helpers/setup-server.js
removed: integration-tests/setup-env.js
removed: packages/medusa-test-utils/src/medusa-test-runner.ts
removed: packages/medusa-test-utils/src/module-test-runner.ts
added:   packages/medusa-test-utils/src/test-worker-identity.ts
```

After review, the exact baseline was updated from
`4c07940bea5982f8ed55d330580061af42af620a2d0eb40cfb5f572c21a9e41e` to
`8207b56a09a907ae7a30954af11edf3c1e4471f89d9b28e9e97035268ae17c5b`.
`JEST_WORKER_ID` ownership falls from four files to one. All other counts remain
unchanged: 68 Jest configs, 116 Jest runner-script entries across 68 owners, 11
Jest dependency entries across four owners, and 406 Jest API files.

### Validation

- the focused worker-identity suite passed six tests;
- the helper and its test passed a standalone strict TypeScript check with
  `noUncheckedIndexedAccess`;
- the full `@medusajs/test-utils` Jest lane passed five active suites and 43
  tests, with its PGlite suite and 28 tests still skipped by their existing
  environment gate;
- the package build passed and emitted the lightweight CommonJS leaf;
- the built leaf and five-case `setup-env.js` subprocess matrix passed;
- the four-case setup-server spawn-stub Redis matrix passed without a service;
- strict test-runner type lanes and five tooling tests passed;
- shared Jest/Vitest foundation parity remained exact at five files, eight
  passed tests, one skip, one todo, and one matched snapshot;
- `pnpm check:remaining-jest` passed with the reviewed one-owner baseline;
- `pnpm check:workspace-dependencies` passed all 86 active manifests;
- `medusa-cloudflare` typecheck passed;
- the composed Worker import guard passed with 1,593 bundled inputs;
- runtime source import and all four portable entrypoint guards passed;
- `pnpm check:test-runner-foundation` passed its strict type lanes, five tooling
  tests, exact five-file parity, and inventory gate;
- scoped Prettier checks for the new helper/test, CommonJS setup files, barrel,
  inventory, and migration records passed, and `git diff --check` passed;
- independent identity/consumer and inventory/documentation reviews passed.

## Integration Vitest Profile And PGlite Runner Selector

Commit:

- `f8444e6f69` (`test: add Vitest integration foundation`)

Date verified: 2026-07-11.

### Difference From Original Medusa

The fork now has a Vitest 4 integration profile for a narrow, runner-neutral
PGlite foundation. The existing PGlite orchestrator accepts a typed
`--runner jest|vitest` selector but continues to default to Jest. The
repository's dedicated PGlite-matrix CI command remains
`pnpm test:integration:pglite`, so this turn does not switch an integration
default. The existing CI setup job already invokes
`check:test-runner-foundation`; that aggregate now also runs the focused
default-Jest/Vitest adapter proof.

Only the `@medusajs/test-utils` adapter/foundation lane has a Vitest command.
The other 24 lanes remain Jest-only. The orchestrator plans every selected lane
before spawning; a Vitest request for Currency, another module, or the full
matrix fails before adapter work begins. `--list` still reports the exact 25
default-Jest lanes, while an unsupported Vitest list fails rather than implying
that those lanes are runnable.

Jest keeps its existing command flags and the orchestrator appends
`--experimental-vm-modules`. The orchestrator does not append that experimental
flag for Vitest, and caller-owned `NODE_OPTIONS` remain unchanged. Vitest also
receives neither Jest-only `--runInBand` nor `--forceExit`. Both runners receive
the same PGlite selector environment.

### Shared Integration Profile

`defineNodeVitestIntegrationConfig` composes the existing shared Node profile
and adds only integration requirements:

- the limited legacy Jest bridge already used by runner-neutral shadows;
- the existing CommonJS `integration-tests/setup-env.js` environment setup,
  which loads the built worker-identity helper leaf;
- one fork with `fileParallelism: false` and `maxWorkers: 1`;
- non-concurrent tests and list-ordered setup files and hooks;
- the shared five-second test and hook defaults.

The package-local profile includes exactly:

```text
src/__tests__/module-test-persistence-selection.spec.ts
src/__tests__/pglite-module-test-persistence-adapter.spec.ts
test-runner-contracts/module-test-runner-lifecycle.spec.ts
```

The lifecycle contract is outside `src`, so the package's authoritative unit
command continues to collect the same five active suites and 43 tests. It uses
the real PGlite adapter, the built test-module fixture, and a small DML model.
Two ordered tests prove connection creation, database preparation, per-test
setup and clear, both module initialization hooks, non-overlapping tests, and a
closed client after final cleanup. The module runner's generated database name
uses the runner-aware worker suffix, while a caller-owned `DB_TEMP_NAME` remains
valid. No production module service or Medusa module assertion runs here.

Explicit ten-second timeout arguments on the canary hooks and tests prove that
both runner APIs accept the wiring. This is not evidence for timeout failure,
cancellation, or Currency's existing `jest.setTimeout(100000)` behavior; that
belongs to the Currency shadow.

### Exact Parity And Command Proof

The pre-change adapter baseline was two files, 32 passed tests, and zero
snapshots. Adding only the two-test lifecycle contract produces the accepted
foundation surface:

| Runner | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ------ | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest   |     3 |     34 |      0 |       0 |    0 |         0 |
| Vitest |     3 |     34 |      0 |       0 |    0 |         0 |

Default Jest and Vitest adapter selections passed through the real
orchestrator; the explicit-Jest option forms were also parsed and planned. The
durable integration-foundation gate executes the real default-Jest and Vitest
mappings, then runs both reporters and compares exact normalized files, test
names, statuses, counts, and snapshots. Vitest exits naturally. The retained
Jest adapter command still uses `--forceExit`; its standard warning is not
presented as clean Jest teardown evidence.

The selector contract also proves both option syntaxes, missing/empty/unknown
runner rejection, the unchanged 25-lane order, `--from currency` selecting 24
lanes, and unsupported Vitest lane/full/list rejection without a spawn.

### Remaining-Jest Ownership

Review found the expected single ownership replacement:

```text
removed rootAndCiInvocations:
  scripts/run-pglite-integration-tests.mjs
  98e2e7e306423147ca315556b0bd3891f75373c1862f7ee96e7fff51414c71a2
added rootAndCiInvocations:
  scripts/run-pglite-integration-tests.mjs
  022c86fc03a0a7a3ca40e56a5d520652e85c0159478a0093bbc649fb1cf23a5f
```

Final review also found that the inventory's broad exclusion for
`scripts/test-runner/*` hid direct Jest execution in the parity verifiers. The
scanner now has an explicit foundation-invocation category:

```text
foundationJestInvocations:
  scripts/test-runner/verify-foundation.mts
  05b398f073f1f47228b2e953529944295721641c713844415c0fbfeebd268959
  scripts/test-runner/verify-integration-foundation.mts
  06d1cafa0858df9fc76d05c2a45320ac0240bf050d0481ec65c7bd872f964d3a
```

The first owner is the pre-existing shared Jest/Vitest parity verifier; the
second is this turn's integration verifier. Tracking both ensures the final
zero-Jest gate cannot pass while its own CI proof still invokes Jest.

The exact baseline digest moves from
`8207b56a09a907ae7a30954af11edf3c1e4471f89d9b28e9e97035268ae17c5b` to
`c05a7080116c9600fbeaee4cef092cbdc13c0a507c4144b6e4cc5f1359a8bbf3`.
The new `foundationJestInvocationFiles` summary is `2`. All previously reported
counts remain unchanged: 68 active Jest configs, 116 Jest script entries across
68 owners, 11 Jest dependency entries across four owners, 406 active Jest API
files, one worker-ID owner, and one root/CI invocation owner.

### Validation

- package build passed and emitted the built fixture and public test-utils
  entrypoints consumed by the contract;
- strict TypeScript/check-JavaScript lanes passed for the shared tooling,
  orchestrator, integration config, and lifecycle contract;
- six shared tooling tests passed;
- default Jest and Vitest orchestrator adapter commands each passed three files
  and 34 tests, and explicit-Jest selector forms passed the planning contract;
- the durable integration-foundation gate passed its real command executions,
  exact normalized parity, selector, and fail-closed checks;
- the full package Jest unit lane remained five active suites and 43 tests;
- shared Jest/Vitest foundation parity remained exact at five files, eight
  passed tests, one skip, one todo, and one matched snapshot;
- workspace dependency policy and the reviewed remaining-Jest inventory passed;
- the inventory explicitly retained both Jest-executing foundation verifiers;
- Cloudflare app typecheck, composed import guard, runtime-source import guard,
  and all portable-entrypoint guards passed;
- scoped Prettier and `git diff --check` passed;
- two independent final diff-only reviews passed.

### Accepted Boundary

This proves only the serial, in-process PGlite adapter and module-runner
lifecycle foundation. It does not prove a production module service, Currency,
PostgreSQL, Redis, HTTP, workerd, D1, or the other 24 PGlite lanes under Vitest.
The existing `ModuleTestRunner` installs process signal handlers twice and
cleanup removes all `SIGINT`/`SIGTERM` listeners. Serial execution limits the
foundation exposure, but that pre-existing ownership problem is not refactored
inside this runner migration turn.

## Currency Integration Six-Quadrant Vitest Shadow

Commit:

- `dca870fee4` (`test: shadow Currency integration with Vitest`)

Date verified: 2026-07-11.

### Difference From Original Medusa

The unchanged Currency module-service integration specification now has an
opt-in Vitest 4 shadow. The existing package `test:integration` script remains
byte-identical and Jest-authoritative; `test:integration:vitest` is the only new
package command. No production source, model, service, assertion, expected
value, snapshot, Jest configuration, dependency, or lockfile changed.

The shadow proves three separate persistence backends under both runners:

- MikroORM against real PostgreSQL;
- the custom `@electric-sql/pglite` module-test persistence adapter at
  `memory://`;
- the Drizzle adapter against Node's in-memory SQLite database.

PGlite is not a Drizzle lane. Earlier roadmap shorthand that combined
"PGlite/Drizzle" is superseded by this explicit six-quadrant boundary.

### Unchanged Assertion And Configuration Boundary

The sole assertion source remains
`packages/modules/currency/integration-tests/__tests__/currency-module-service.spec.ts`.
Its normalized-LF SHA-256 is
`73b9ff980e9e4431fa18e3f4ed87f13dfed35e6f3e02b1388be6a439027d754f`.
It contains 13 tests and 18 `expect` calls, with no skip, todo, or snapshot
ownership.

The package-local integration config includes exactly that file, preserves the
four Jest aliases in their existing models/services/repositories/types order,
and composes the shared serial integration profile. Package-root execution is
required because the unchanged module discovery path reads the package working
directory and built `dist` output.

The source's existing top-level `jest.setTimeout(100000)` remains unchanged.
The deliberately limited compatibility bridge maps it to Vitest test and hook
timeouts before the module hooks register. This proves the existing Currency
timeout request; it does not broaden the bridge to general Jest mocking APIs.

### Exact Six-Quadrant Proof

The pre-edit Jest baseline passed one file, 13 tests, and zero snapshots on each
backend. The durable verifier now executes and normalizes all six results:

| Backend               | Runner | Files | Passed | Failed | Skipped | Todo | Snapshots |
| --------------------- | ------ | ----: | -----: | -----: | ------: | ---: | --------: |
| PostgreSQL/MikroORM   | Jest   |     1 |     13 |      0 |       0 |    0 |         0 |
| PostgreSQL/MikroORM   | Vitest |     1 |     13 |      0 |       0 |    0 |         0 |
| PGlite custom adapter | Jest   |     1 |     13 |      0 |       0 |    0 |         0 |
| PGlite custom adapter | Vitest |     1 |     13 |      0 |       0 |    0 |         0 |
| Drizzle/SQLite        | Jest   |     1 |     13 |      0 |       0 |    0 |         0 |
| Drizzle/SQLite        | Vitest |     1 |     13 |      0 |       0 |    0 |         0 |

Every pair has the exact normalized file, full test-name/status set, counts,
and snapshot result. The verifier also compares each Jest backend result with
the PostgreSQL baseline, so backend drift cannot hide behind runner-local
parity. Vitest exits naturally on all three paths. Jest retains the package's
existing `--forceExit`, which remains rollback behavior rather than clean
teardown evidence.

The verifier requires explicit `DB_HOST`, `DB_PORT`, and `DB_USERNAME` for the
PostgreSQL quadrant and removes database-service variables for the two
in-process quadrants. Local PostgreSQL proof used an isolated PostgreSQL 18
cluster on `127.0.0.1:55433`; the machine's configured PostgreSQL service was
not changed.

### Selector And CI Boundary

Currency is now the second Vitest-capable PGlite orchestrator lane after the
adapter foundation. Both the real default-Jest and explicit-Vitest Currency
selectors pass one lane, one file, and 13 tests. The default list remains the
same 25 Jest lanes. `api-key` is now the first unsupported Vitest module lane,
and full, list, and `--from=currency` Vitest requests fail during planning
before any child command spawns. The other 23 production module lanes remain
Jest-only.

A focused `currency-integration-shadow` GitHub Actions job runs the full
six-quadrant verifier with one PostgreSQL service, no Redis service, no matrix,
and the existing setup build artifacts. The pre-existing dedicated PGlite job
remains the unqualified default-Jest `pnpm test:integration:pglite` command.
Workflow structure and command ownership pass locally. At commit `dca870fee4`,
hosted execution was pending and recorded as blocking Turn 14; the later
deferral decision below supersedes only that sequencing requirement.

### Remaining-Jest Ownership

The reviewed inventory moves from the Turn 12 overall digest
`c05a7080116c9600fbeaee4cef092cbdc13c0a507c4144b6e4cc5f1359a8bbf3` to:

```text
overall digest:
  18ffae8873e062a7c6dc23d2468aa847215f96ccfadbad5b2c389b361dd1ad70
rootAndCiInvocations (previously 022c86fc03a0a7a3ca40e56a5d520652e85c0159478a0093bbc649fb1cf23a5f):
  scripts/run-pglite-integration-tests.mjs
  fcc009126b08554ea2d99332615dff2947d0766c4a8b49e7c98ac88541c183ae
foundationJestInvocations (integration verifier previously 06d1cafa0858df9fc76d05c2a45320ac0240bf050d0481ec65c7bd872f964d3a):
  scripts/test-runner/verify-integration-foundation.mts
  da45cf3d01665173967d50f6476c38452af160ae97ef9833e8bc5c0347458c0d
  scripts/test-runner/verify-currency-integration-shadow.mts
  a6a2d066ecc5faa74add4ee7ca9a565de6cd850b1dbb090ce1827284978196f1
```

The new verifier raises `foundationJestInvocationFiles` from two to three. All
other reviewed counts remain unchanged: 68 active Jest configs, 116 Jest script
entries across 68 owners, 11 Jest dependency entries across four owners, 406
active Jest API files, one worker-ID owner, and one root/CI invocation owner.

### Validation

- `pnpm check:currency-integration-shadow` passed the exact six-quadrant proof
  plus both real Currency PGlite selector executions;
- the unchanged integration-foundation gate passed all 25 default-Jest lane
  contracts and the exact three-file/34-test adapter proof;
- `@medusajs/test-utils` and `@medusajs/currency` builds passed;
- Currency's Vitest unit default and explicit Jest rollback each remained two
  files and two tests;
- strict test-runner TypeScript and the seven tooling tests passed;
- workspace dependency policy and the remaining-Jest inventory passed;
- the Cloudflare app passed typecheck, 30 Vitest tests, and the Vite 8.1.4
  production build;
- D1 workerd and Durable Object SQLite Currency service/rollback proofs passed;
- the composed Worker import guard passed with 1,593 bundled inputs, the
  runtime-source guard passed, all four portable-entrypoint guards passed at
  5/43/46/5 inputs, and the real Currency import audit passed with 65 inputs
  and zero blockers.

### Accepted Boundary

This is Node integration-runner parity for one unchanged Currency
module-service specification. The Cloudflare checks are separate regressions;
they do not claim that this Node specification ran inside workerd. Redis-backed
suites, HTTP behavior, the other 23 module lanes, and the integration-default
switch remain outside this turn. Hosted CI is not yet evidence and must not be
claimed as passing.

## Hosted Currency Shadow Deferral

Commit:

- `17b1781e4d` (`docs: defer hosted Currency shadow gate`)

Date decided: 2026-07-11.

### Decision

The hosted `currency-integration-shadow` result remains pending but no longer
blocks the local Turn 14 cut-over. At the time of the 2026-07-11 decision, this
custom fork had no safe publication remote: the local checkout configured only
Medusa upstream, and the available user fork had unrelated history. Repository
publication is external lifecycle work, not a test-runner behavior requirement.

This does not replace hosted evidence with a narrower test. Turn 13 already
executes the exact CI command locally and proves all six Jest/Vitest x
PostgreSQL/PGlite/Drizzle quadrants, both real PGlite selector mappings, package
build/default/rollback behavior, the strict inventory, and the complete
Cloudflare regression set. A parsed workflow contract separately freezes the
hosted job's command, PostgreSQL as its only external service, `setup`
dependency, timeout, and absence of Redis or a matrix.

### Safeguards

- Keep the hosted job committed and unchanged during the Turn 14 cut-over.
- Repeat the same six-quadrant verifier after switching the package default.
- Keep an explicit Jest rollback and prove that the Jest selector still invokes
  Jest rather than following the new package default accidentally.
- Record hosted status as deferred, never green or passing.
- When a safe remote exists, run the committed workflow. Any hosted failure
  reopens the affected turn and must be fixed before claiming hosted support.
- Do not use this deferral to waive Redis, workerd, package, inventory, or
  assertion-parity gates that are locally executable.

## Currency Integration Vitest Cut-Over

Commit:

- `9e3da4fa6e` (`test: switch Currency integration to Vitest`)

Date verified: 2026-07-11.

### Difference From Original Medusa

Currency's integration package default now runs the proven Vitest 4 profile:

```text
test:integration        vitest run --config vitest.integration.config.mts
test:integration:jest   jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The temporary `test:integration:vitest` shadow alias is removed. The old Jest
command is byte-identical under its rollback key. No assertion, expected value,
snapshot, skip state, integration config, production source, dependency, or
lockfile changed.

The root PGlite orchestrator still defaults to Jest. Currency's Jest command
now explicitly invokes `test:integration:jest --runInBand`, while its Vitest
command invokes the new `test:integration` default. The adapter lane and all 23
other production module Jest command arrays remain unchanged. The durable
Currency verifier asserts this ownership, executes reporters through default
and rollback, freezes the unchanged source digest, and runs both real selector
paths.

### Package CI Sharding Boundary

The existing package integration matrix forwards `--shard=<index>/3` through
Turbo. A real post-cut-over reproduction for Currency failed before test setup:

```text
--shard <count> must be a smaller than count of test files.
Resolved 1 test files for --shard=1/3.
```

`passWithNoTests` cannot change this Vitest pre-selection rule. Currency is now
excluded only from `test:integration:packages:fast` with
`--filter=!./packages/modules/currency`. Turbo dry-run proves Currency is absent
and API Key remains as a control. The unsharded `test:integration:packages`
command remains inclusive.

The unchanged, non-matrix `currency-integration-shadow` job owns Currency's
complete unsharded CI command. Its stable name and root command remain even
though the verifier now proves Vitest default plus Jest rollback. The stable
`integration-tests-packages` aggregate now needs both the generic matrix and
dedicated Currency job; failure, cancellation, or skipping from either result
forces the aggregate red. The tooling contract freezes the exact fast/slow/all
commands, three-way matrix forwarding, dedicated job, aggregate dependencies
and result propagation, and unqualified default-Jest PGlite job. Hosted
execution remains deferred and is not claimed passing.

### Exact Six-Quadrant Proof

Fresh pre-edit and post-edit executions both produced:

| Backend               | Runner         | Files | Passed | Failed | Skipped | Todo | Snapshots |
| --------------------- | -------------- | ----: | -----: | -----: | ------: | ---: | --------: |
| PostgreSQL/MikroORM   | Jest rollback  |     1 |     13 |      0 |       0 |    0 |         0 |
| PostgreSQL/MikroORM   | Vitest default |     1 |     13 |      0 |       0 |    0 |         0 |
| PGlite custom adapter | Jest rollback  |     1 |     13 |      0 |       0 |    0 |         0 |
| PGlite custom adapter | Vitest default |     1 |     13 |      0 |       0 |    0 |         0 |
| Drizzle/SQLite        | Jest rollback  |     1 |     13 |      0 |       0 |    0 |         0 |
| Drizzle/SQLite        | Vitest default |     1 |     13 |      0 |       0 |    0 |         0 |

Every normalized file, full test name/status, count, and snapshot result is
exact across runner pairs and all three backends. The authoritative source
remains byte-for-byte unchanged with normalized-LF SHA-256
`73b9ff980e9e4431fa18e3f4ed87f13dfed35e6f3e02b1388be6a439027d754f`:
13 tests, 18 `expect` calls, no skip/todo, and no snapshot ownership. Local
PostgreSQL validation used an isolated PostgreSQL 18 cluster on
`127.0.0.1:55434`; the machine's configured service was not changed.

### Remaining-Jest Ownership

The exact inventory digest moves from
`18ffae8873e062a7c6dc23d2468aa847215f96ccfadbad5b2c389b361dd1ad70` to
`2f807e78677ec81542d38b4b88055e6014438d5047fb44660e6f7731e7ee3f1c`.
The reviewed delta is limited to:

```text
Currency manifest ownership:
  test:integration -> test:integration:jest
  command bytes unchanged
rootAndCiInvocations:
  scripts/run-pglite-integration-tests.mjs
  fcc009126b08554ea2d99332615dff2947d0766c4a8b49e7c98ac88541c183ae
  -> 241b8d496216dca9b817cad76a9b1b6f91bf0240231c79ac07b7b22a0060369c
foundationJestInvocations:
  scripts/test-runner/verify-currency-integration-shadow.mts
  a6a2d066ecc5faa74add4ee7ca9a565de6cd850b1dbb090ce1827284978196f1
  -> 094734834e18ba99bfb0801e9c8581f0321702ead1361c5bc8906cc9128bd8b3
```

All counts remain unchanged: 68 active Jest configs, 116 Jest script entries
across 68 owners, 11 Jest dependency entries across four owners, 406 active
Jest API files, three foundation invocation files, one worker-ID owner, and one
root/CI invocation owner.

### Validation

- strict runner-tooling typecheck and seven tooling tests passed;
- the focused cut-over verifier passed all six quadrants plus both real
  Currency PGlite selector executions;
- Turbo reproduced the one-file `--shard=1/3` failure, then dry-run proved the
  focused exclusion while retaining API Key;
- `@medusajs/test-utils` and `@medusajs/currency` builds passed;
- Currency's unit Vitest default and Jest rollback each remained two files and
  two tests;
- workspace dependency policy and the exact remaining-Jest inventory passed;
- the full shared foundation passed strict typing, seven tooling tests, exact
  five-file runner parity, 25 default-Jest lanes, and exact three-file/34-test
  adapter parity;
- Cloudflare typecheck, 30 app tests, and the Vite 8.1.4 production build
  passed;
- D1 workerd and Durable Object SQLite Currency service/rollback proofs passed;
- the composed import guard passed with 1,593 inputs, the runtime-source guard
  passed, portable entrypoints passed at 5/43/46/5 inputs, and the real Currency
  audit passed with 65 inputs and zero blockers.

### Accepted Boundary

This switches only Currency's Node integration package default. The global
PGlite matrix remains Jest-authoritative, the other 23 production module lanes
remain Jest-only, and Redis/HTTP/top-level integrations remain outside this
turn. Cloudflare checks are separate regressions and do not mean the Node
integration specification ran in workerd or D1. The dedicated hosted job is
unchanged and pending under the explicit deferral policy.

## Auth Emailpass Empty Unit Lane Retirement

Commit:

- `7910bb5dc3` (`test: retire empty Auth Emailpass unit lane`)

Date verified: 2026-07-11.

### Difference From Original Medusa

`@medusajs/auth-emailpass` inherited this unit command:

```text
test  jest --passWithNoTests src
```

Direct `jest --listTests src` returned no files. The package's `src` tree owns
only `index.ts` and `services/emailpass.ts`, and the command exited zero only
because of `--passWithNoTests`. The original fork baseline and fetched upstream
history retain the same empty command without any historical unit assertion
source. Turn 15 therefore removes only this `test` manifest key. It does not add
an empty Vitest replacement, invent new assertions, or create a Jest rollback
for a lane that had no assertions.

The exact integration command remains Jest-authoritative and byte-identical:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

`jest.config.js` also remains unchanged because this live integration lane
consumes its root and TypeScript transform. The package alias mappings stay
preserved, but this relative-import specification does not exercise them. The
integration source, provider source, dependencies, build/watch scripts, root
integration selection, and lockfile are unchanged.

### Assertion And Task Ownership Proof

The unchanged integration lane passed before and after the manifest edit at one
suite, nine tests, and zero snapshots. Its normalized-LF SHA-256 remains
`6892c74183528270d00d64bce8c0769a165aada8d45c8b3c64e819ca81689645`,
with nine `it` declarations and 19 `expect` calls. No skip, todo, or snapshot
ownership exists.

Before the edit, Turbo's Auth Emailpass unit task command was the empty Jest
command. After removal, its dry-run graph marker remains present with command
`<NONEXISTENT>`; that marker is not an executable unit lane. The correctly
formed root command:

```text
corepack pnpm test --filter=@medusajs/auth-emailpass -- --shard=1/4 --maxWorkers=1 --passWithNoTests
```

selected only Auth Emailpass, executed zero tasks, and exited successfully.
Post-edit direct Jest discovery under `src` also remained zero files.

### Remaining-Jest Ownership

The exact inventory digest moves from
`2f807e78677ec81542d38b4b88055e6014438d5047fb44660e6f7731e7ee3f1c` to
`e9332f849f83ce9f748f191aef3bb82c145e5a971480aab93c00e8835a77b444`.
The sole ownership removal is:

```text
manifestScripts  @medusajs/auth-emailpass  test  jest --passWithNoTests src
```

Jest manifest-script entries move from 116 to 115. Script owners remain 68
because the package still owns its integration script. All 68 config owners, 11
dependency entries across four owners, 406 active Jest API files, three
foundation invocation files, one worker-ID owner, one root/CI owner, and every
other inventory count remain unchanged. No ownership entries were added.

### Validation

- the package integration lane passed before and after at one suite, nine tests,
  and zero snapshots;
- the package build passed;
- direct post-edit Jest discovery confirmed zero unit files;
- the correctly filtered root command scoped only Auth Emailpass and executed
  zero tasks, while Turbo dry-run represented its unit task as `<NONEXISTENT>`;
- workspace dependency policy and the exact remaining-Jest inventory passed;
- the full test-runner foundation passed strict typing, seven tooling tests,
  shared Jest/Vitest parity, all 25 default-Jest integration lanes, and exact
  three-file/34-test adapter parity.

### Accepted Boundary And Separate Workflow Finding

This is retirement of nonexistent unit coverage, not Vitest parity, a package
migration, or an integration default switch. The unchanged mocked provider
integration does not require PostgreSQL, PGlite, Redis, or another external
service. No workerd or Cloudflare claim is inferred from it.

The audit separately reproduced a pre-existing unit-workflow defect. At that
point both unit commands used `pnpm test -- --filter=...`; under pinned pnpm
11.7.0, the first separator sent `--filter` to package runners instead of Turbo.
The exact workflow-shaped reproduction selected all 85 packages and failed in
Core Flows Vitest with `CACError: Unknown option --filter`. The initially
accepted command shape was `pnpm test --filter=... -- --shard=...`. Turn 87's
exact execution later proved that pnpm's built-in `test` alias consumes that
single separator and requires a second separator for Turbo. This defect
predated Turn 15 and was recorded rather than mixed into the retirement.

## pnpm/Turbo Unit CI Forwarding Repair

Commit:

- `c20de19286` (`ci: repair pnpm unit test filtering`)

Date verified: 2026-07-11.

### Difference From Original Medusa And The Fork

The unit matrix previously invoked both root commands with an extra separator
before their Turbo filters:

```text
pnpm test -- --filter='!@medusajs/framework' --filter='!@medusajs/utils' -- --shard=... --maxWorkers=... --passWithNoTests
pnpm test -- --filter=@medusajs/framework --filter=@medusajs/utils -- --shard=... --passWithNoTests
```

Under the pinned pnpm 11.7.0 toolchain, the root `test` script received those
filters after Turbo's task-argument boundary. Turbo selected all 85 graph nodes,
and Vitest rejected the forwarded `--filter` option. Turn 16 moves both filter
sets before pnpm's explicit task-argument separator:

```text
pnpm test --filter='!@medusajs/framework' --filter='!@medusajs/utils' -- --shard=${{ matrix.shard_index }}/4 --maxWorkers=${{ steps.cpu-cores.outputs.count }} --passWithNoTests
pnpm test --filter=@medusajs/framework --filter=@medusajs/utils -- --shard=${{ matrix.shard_index }}/4 --passWithNoTests
```

Turn 87 supersedes these two historical intermediate strings. Exact execution
under the same pnpm 11.7.0 and Turbo 1.13.4 versions proved that the built-in
`pnpm test` alias consumes the single separator, leaving Turbo to reject
`--shard`. The current source of truth contains two separators before
`--shard`: the first belongs to pnpm and the second reaches Turbo.

The general command retains worker capping and excludes the two Jest scripts
that already own `--runInBand`. The serial command selects exactly those scripts
and deliberately omits `--maxWorkers`. Both keep four-way sharding and
`--passWithNoTests`.

No package test command or runner default changes. Jest rollback aliases,
integration commands, source assertions, snapshots, aliases, production code,
dependencies, and the lockfile remain unchanged.

### Parsed Workflow Contract

The eighth tooling contract reads the live YAML through an `unknown` boundary,
narrows records, steps, strings, and the exact two-line block, and fails closed
without `any` or unchecked assertions. It freezes:

- the root `test` script as
  `turbo run test --no-daemon --no-cache --force`;
- the unique `Run unit tests` step and four-shard matrix;
- both complete then-accepted workflow command strings;
- filters before pnpm's task-argument separator;
- general-lane `--maxWorkers` and its absence from the serial lane.

The contract was added before the workflow edit and failed with an exact
expected/received diff showing the extra separator in both commands. After the
two-line correction, the focused test and complete eight-test tooling suite
pass, along with strict TypeScript tooling checks.

### Turbo Graph And Real Runner Proof

Post-edit Turbo dry-runs prove:

| Lane    | Graph nodes | Executable scripts | Nonexistent markers | Required selection                  |
| ------- | ----------: | -----------------: | ------------------: | ----------------------------------- |
| General |          83 |                 71 |                  12 | excludes Framework and Utils        |
| Serial  |           2 |                  2 |                   0 | exactly Framework and Utils         |
| Union   |          85 |                 73 |                  12 | complete and disjoint current graph |

These are graph-node counts, not a claim that every node executes a test
script. Every general dry-run node receives shard, worker, and
pass-with-no-tests arguments; both serial nodes receive shard and
pass-with-no-tests without `--maxWorkers`.

Representative general-lane execution proves both runner families through the
corrected root shape:

- shard 1 selects mocked Event Bus Redis under Jest at one suite and 34 tests,
  and Payment Stripe under Vitest at one file and one test;
- shard 4 selects the same packages, both discover zero files, and both exit
  zero through the forwarded `--passWithNoTests`;
- this mocked unit execution does not claim a Redis service gate.

Additional four-shard Vitest proof retains Core Flows' full 13-test 2/8/3/0
distribution and Locking Cloudflare's one-test 1/0/0/0 distribution. The latter
is a package unit proof, not workerd, D1, or bundle evidence.

The exact serial shard-1 root command selects only Framework and Utils.
Framework passes nine suites, 49 tests, and two snapshots. Utils passes 24
suites, 142 tests, one existing skip, and two snapshots. Both preserve
`--runInBand`, and no mutually exclusive worker flags reach Jest.

### Validation

- the red-before-green parsed workflow contract passed after the two-line fix;
- strict runner-tooling typecheck and all eight tooling tests passed;
- exact 83/2 dry-runs proved the complete disjoint task graph;
- mixed Jest/Vitest populated and empty general shards passed;
- all four Core Flows and Locking Cloudflare Vitest shards passed;
- the exact serial Framework/Utils shard passed;
- workspace dependency policy and the unchanged remaining-Jest inventory
  passed;
- the full shared test-runner foundation passed strict typing, eight tooling
  tests, shared runner parity, all 25 default-Jest integration lanes, and exact
  three-file/34-test adapter parity.

### Accepted Boundary

This is a unit-workflow invocation repair, not a package migration or full local
execution of all 83 general graph nodes. It changes no runner ownership,
assertion, backend, external-service boundary, or Cloudflare runtime/import
graph. The existing Turbo 1.13.4/pnpm 11 `patchedDependencies` graph warning
remains separate and did not prevent parsed graph or scoped execution. Hosted
execution cannot be claimed until the committed workflow is published; that
environment evidence remains deferred.

Turn 87 re-opened this boundary using the exact committed command rather than
the parsed YAML alone. Its later Analytics cut-over record contains the
superseding red/green command proof and current double-separator contract.

## Auth Emailpass Integration Vitest Shadow

Commit:

- `ac03c9df21` (`test: add Auth Emailpass integration Vitest shadow`)

Date verified: 2026-07-11.

### Difference From Original Medusa

The exact existing package default remains Jest-authoritative:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

Turn 17 adds only this opt-in command:

```text
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The new package-local config calls the shared
`defineNodeVitestIntegrationConfig`, so it inherits the SWC legacy transform,
Node/fork environment, single-worker serial execution, compatibility setup
before integration setup, global APIs, and fail-closed nonempty discovery. It
includes only `integration-tests/__tests__/services.spec.ts`.

All five Jest/TypeScript aliases are mirrored in the Vitest config:
`@models`, `@services`, `@repositories`, `@types`, and `@utils`. The unchanged
spec imports `../../src/services/emailpass` relatively, so this turn preserves
those mappings but does not claim to exercise them.

No timeout, `forceExit`, or runner-specific source rewrite is added to Vitest.
The unchanged `jest.setTimeout(100000)` call flows through the existing bridge
and configures both Vitest timeout domains.

### Exact Assertion And Discovery Proof

The authoritative integration source remains byte-identical with normalized-LF
SHA-256
`6892c74183528270d00d64bce8c0769a165aada8d45c8b3c64e819ca81689645`.
It retains nine `it` declarations, 19 root `expect` calls, no skip/todo/only,
and no snapshot matchers. Its compatibility surface is limited to 12
`jest.fn`, one `jest.restoreAllMocks`, and one `jest.setTimeout`, all provided
by the frozen bridge.

The active `jest.config.js` remains byte-identical at normalized-LF SHA-256
`5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`.

Fresh Jest and Vitest JSON reporters were executed through their package
scripts. The existing generic comparator matched the normalized discovered
file, all nine full test names and statuses, suite/test counts, and snapshot
summary exactly:

| Runner        | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ------------- | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest default  |     1 |      9 |      0 |       0 |    0 |         0 |
| Vitest shadow |     1 |      9 |      0 |       0 |    0 |         0 |

The suite uses only local auth-service fakes and CPU-local `scrypt-kdf`. It does
not open a database, Redis, network, workerd, or D1 boundary. A separate Jest
run without `--forceExit` and with `--detectOpenHandles` also exited normally;
that observation does not change the authoritative command.

### Remaining-Jest Ownership

The new manifest script and config are Vitest-only. No dedicated Jest-calling
verifier is added, so the migration does not create a fourth foundation Jest
invocation owner merely to compare a simple provider shadow.

The remaining-Jest inventory is byte-identical at digest
`e9332f849f83ce9f748f191aef3bb82c145e5a971480aab93c00e8835a77b444`:
68 active configs, 115 Jest script entries across 68 owners, 11 dependency
entries across four owners, 406 active API files, three foundation invocation
files, one worker-ID owner, and one root/CI invocation owner.

### Validation

- exact generic JSON comparison passed at one file, nine tests, and zero
  snapshots;
- the direct Jest default and Vitest shadow commands passed;
- the package-local Vitest config passed strict standalone typechecking;
- the Auth Emailpass package build passed;
- workspace dependency policy and the unchanged remaining-Jest inventory
  passed;
- the full shared test-runner foundation passed strict typing, eight tooling
  tests, exact shared parity, all 25 default-Jest integration lanes, and exact
  three-file/34-test adapter parity.

### Accepted Boundary

This is a local, opt-in Node integration shadow. Jest remains authoritative;
the retired empty unit lane is not restored; no default, rollback, root script,
workflow, CI aggregate, dependency, lockfile, production source, assertion,
persistence, or Cloudflare runtime/import boundary changes. The package is not
yet migrated while its integration default remains Jest.

No hosted result is claimed because the shadow is not added to CI in this turn.
The generic package lane still safely invokes Jest for Auth Emailpass. Before a
Vitest default switch, the one-file suite must leave the generic three-way shard
and receive explicit unsharded CI ownership.

## Auth Emailpass Integration Vitest Cut-over

Commit:

- `bc6dab98ea` (`test: switch Auth Emailpass integration to Vitest`)

Date verified: 2026-07-11.

### Difference From Original Medusa

The package integration default is now Vitest, while the original command is
retained byte-identically as a rollback:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

The temporary `test:integration:vitest` alias is removed and the retired unit
`test` key remains absent. The authoritative spec, Jest config, Vitest config,
production sources, and shared compatibility bridge are unchanged.

The strict tooling contract freezes normalized-LF SHA-256 values for all three
runner inputs:

- spec:
  `6892c74183528270d00d64bce8c0769a165aada8d45c8b3c64e819ca81689645`;
- Jest config:
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- Vitest config:
  `3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`.

The Vitest-config hash matters even though this relative-import spec does not
exercise its five preserved aliases. It keeps discovery, setup, shared profile,
and alias behavior from drifting behind an unchanged test result.

### Exact Assertion And Discovery Proof

Fresh reporters were compared immediately before the package-script switch and
again after the switch through `test:integration:jest` and the new default. The
generic normalizer matched the discovered file, all full names and statuses,
suite/test counts, and snapshot summary exactly:

| Runner         | Files | Passed | Failed | Skipped | Todo | Snapshots |
| -------------- | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest rollback  |     1 |      9 |      0 |       0 |    0 |         0 |
| Vitest default |     1 |      9 |      0 |       0 |    0 |         0 |

No assertion, expected value, full name, skip/todo state, or snapshot changed.
The suite still uses only local auth-service fakes and CPU-local `scrypt-kdf`.

### Shard And CI Ownership

A real one-file Vitest run with the generic package lane's `--shard=1/3`
exited 1:

```text
--shard <count> must be a smaller than count of test files.
Resolved 1 test files for --shard=1/3.
```

The root fast package command therefore excludes Auth Emailpass. Its dry graph
contains 56 tasks, with Auth and Currency absent and API Key retained. The
unsharded all-packages graph still contains Auth exactly once, with
`vitest run --config vitest.integration.config.mts`.

The workflow adds `auth-emailpass-integration`, a dedicated unsharded job that:

- needs only `setup`;
- checks out, restores the pipeline dependencies, and downloads existing build
  artifacts;
- owns no strategy, matrix, service, database, Redis, or runner-specific env;
- runs only `pnpm --filter @medusajs/auth-emailpass test:integration`.

The stable package aggregate now depends on this job, fails when it fails,
cancels, or skips, and succeeds only when it succeeds. A parsed YAML contract
freezes this exact shape and its runner-neutral name. Hosted execution is not
claimed until the committed workflow is published.

### Remaining-Jest Ownership

No Auth-specific verifier was added. A permanent verifier would have become a
fourth foundation Jest invocation owner solely to re-run this mocked one-file
suite. The existing generic comparator supplied turn evidence without creating
new Jest debt.

The exact inventory changes only the Auth manifest script key from
`test:integration` to `test:integration:jest`; the command bytes are unchanged.
Its digest is now
`f6a6a113dce80c75fcc951b80c60bc55e5012d7f4d72cf728638504af4c10570`,
while totals remain 68 configs, 115 Jest script entries across 68 owners, 406
active API files, and three foundation Jest invocation files.

The updater guidance was also corrected for pnpm 11: the supported command is
`pnpm check:remaining-jest --update`. Adding a literal separator forwards `--`
to the inventory script and is rejected rather than updating the baseline.

### Validation

- exact pre-cut-over and post-cut-over JSON parity passed at one file, nine
  tests, every full name/status, and zero snapshots;
- the direct Vitest default and Jest rollback commands passed;
- the real one-file/three-shard Vitest command failed closed as required;
- the fast and all-package Turbo dry graphs matched their expected ownership;
- package build, workspace dependency policy, strict tooling typecheck, all
  eight tooling tests, and the exact remaining-Jest inventory passed;
- the complete shared foundation passed five-file parity, all 25 Jest-default
  integration selectors, and exact three-file/34-test adapter parity.

### Accepted Boundary

This turn switches only Auth Emailpass integration runner ownership and its CI
composition. It does not restore an empty unit lane, retire the Jest rollback,
rewrite Jest APIs, migrate another provider, or change dependencies, lockfiles,
assertions, production code, persistence, Cloudflare runtime behavior, package
privacy, catalogs, or repository-merge scope.

PostgreSQL, PGlite, Redis, network, workerd, D1, and Cloudflare import-graph
results are not applicable to this mocked Node provider suite. The dedicated CI
job has local command and parsed-workflow proof only; hosted confirmation remains
deferred.

## Auth GitHub Empty Unit Lane Retirement

Commit:

- `4ac4a518eb` (`test: retire empty Auth GitHub unit lane`)

Date verified: 2026-07-11.

### Difference From Original Medusa

`@medusajs/auth-github` inherited this unit command:

```text
test  jest --passWithNoTests src
```

The exact package command and direct Jest list both discovered zero files. The
package's `src` tree contains only `index.ts` and `services/github.ts`; the
migration baseline contains the same two production files, the same empty
command, and no unit assertion source. The command exited zero only because of
`--passWithNoTests`.

Turn 19 therefore removes only this `test` manifest key. It does not add an
empty Vitest replacement, invent assertions, or create a Jest rollback for a
lane that had nothing to roll back.

The active integration command remains byte-identical and Jest-authoritative:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

`jest.config.js` also remains unchanged. Resolved configuration proves the
integration lane consumes a Node environment, the SWC TypeScript transform, and
the MSW transform-ignore exception. Removing it with the empty unit script would
break a separate active ownership boundary.

### Assertion And Task Ownership Proof

The unchanged integration lane passed before and after the manifest edit at one
suite, nine tests, and zero snapshots. Its normalized-LF SHA-256 remains
`1679ec9a5a3da285a95ac0d170f9376f661a6d3f1c076199baa196e75aab42c8`,
with nine `it` declarations, nine `expect` calls, and no skip/todo/only or
snapshot matchers. Its active Jest surface is 11 `jest.fn` calls, one
`jest.restoreAllMocks`, and one `jest.setTimeout`.

The unchanged Jest config remains normalized-LF SHA-256
`5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`.
MSW intercepts the GitHub OAuth HTTP requests in process, so the test does not
require a real network or external service.

Before removal, Turbo's scoped unit task invoked the empty Jest command. After
removal, the dry graph retains one `@medusajs/auth-github#test` marker with
`<NONEXISTENT>`, while the correctly filtered real root command:

```text
corepack pnpm test --filter=@medusajs/auth-github -- --shard=1/4 --maxWorkers=1 --passWithNoTests
```

selects only Auth GitHub, executes zero tasks, and exits successfully. The
general unit graph remains 83 nodes, with 70 executable tasks and 13
`<NONEXISTENT>` markers.

Auth GitHub's separate integration task remains once in the 56-task fast graph
with its byte-identical Jest command. The current generic three-way Jest lane is
safe: shard 1 passes the one suite/nine tests, while shards 2 and 3 discover zero
tests and exit successfully through `--passWithNoTests`. That proof preserves
existing CI ownership; no exclusion or dedicated job is introduced in this
unit-only turn.

### Remaining-Jest Ownership

The exact inventory first failed with one removed entry and no additions:

```text
manifestScripts  @medusajs/auth-github  test  jest --passWithNoTests src
```

After reviewing that delta, the accepted digest becomes
`db9dd73f0c2a73589e8d50bc0f1a9f71923b3ecbec0c11a047f91b22a74f5ab9`.
Manifest Jest script entries move from 115 to 114. Script owners stay 68 because
Auth GitHub still owns its integration command. All 68 config files, 406 active
API files, 11 dependency entries across four owners, three foundation invocation
files, one worker-ID owner, one root/CI owner, and every other count remain
unchanged. No ownership entry was added.

The exact inventory is the permanent fail-closed contract for this deletion. A
new provider-specific TypeScript contract would duplicate it without proving a
test result, so no tooling-contract change is added.

### Validation

- direct unit discovery returned zero files before and after the edit;
- the unchanged integration lane passed before and after at one suite, nine
  tests, and zero snapshots;
- the package build passed;
- the scoped root run executed zero tasks and Turbo retained only a
  `<NONEXISTENT>` unit marker;
- the 83-node general unit graph and 56-task fast integration graph retained
  their intended ownership;
- all three existing Jest integration shards passed at 9/0/0 tests;
- workspace dependency policy and the exact remaining-Jest inventory passed;
- the full test-runner foundation passed strict typing, eight tooling tests,
  five-file shared parity, all 25 integration selectors, and exact
  three-file/34-test adapter parity.

### Accepted Boundary

This is retirement of nonexistent unit coverage, not Vitest parity, an
integration shadow, a package migration, or a default switch. It changes no
test or production source, integration command, Jest config, dependency,
lockfile, root script, workflow, persistence adapter, or runtime behavior.

PostgreSQL, PGlite, Redis, real network, workerd, D1, and Cloudflare import-graph
results are not applicable to this manifest-only decision. The local unit
command and graph proofs pass, but no hosted unit-matrix result is claimed before
publication. The known Turbo 1.13.4/pnpm 11 patched-dependency graph warning
remains separate and does not prevent the successful scoped/full graph proofs.

## Auth GitHub Integration Vitest Shadow

Commit:

- `6c0e09c3de` (`test: add Auth GitHub integration Vitest shadow`)

Date verified: 2026-07-11.

### Difference From Original Medusa

The exact package integration default remains Jest-authoritative:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

Turn 20 adds only this opt-in command:

```text
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The new package-local config calls the shared
`defineNodeVitestIntegrationConfig`, so it inherits the legacy SWC transform,
Node/fork environment, single-worker serial execution, compatibility setup
before integration setup, global APIs, fail-closed nonempty discovery, and
inline handling for `msw` and `until-async`. It includes only
`integration-tests/__tests__/services.spec.ts`.

All five Jest/TypeScript aliases are mirrored in the Vitest config: `@models`,
`@services`, `@repositories`, `@types`, and `@utils`. The unchanged spec imports
`../../src/services/github` relatively, so this turn preserves those mappings
but does not claim to exercise them.

No package-specific setup, timeout, dependency, `forceExit`, source rewrite, or
unsafe TypeScript assertion is added. The unchanged `jest.setTimeout(100000)`
flows through the existing bridge and configures both Vitest timeout domains.

### Exact Assertion And Discovery Proof

The authoritative integration source remains byte-identical with normalized-LF
SHA-256
`1679ec9a5a3da285a95ac0d170f9376f661a6d3f1c076199baa196e75aab42c8`.
It retains nine `it` declarations, nine `expect` calls, no skip/todo/only, and no
snapshot matchers. Its compatibility surface is limited to 11 `jest.fn`, one
`jest.restoreAllMocks`, and one `jest.setTimeout`, all supplied by the frozen
bridge.

The active `jest.config.js` remains byte-identical at normalized-LF SHA-256
`5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`.
The new Vitest config is normalized-LF SHA-256
`3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`.

Fresh JSON reporters were captured before the edit and again after it. The
generic normalizer proved that pre-edit Jest equals post-edit Jest and post-edit
Jest equals Vitest by discovered file, all nine full test names and statuses,
suite/test counts, and snapshot summary:

| Runner                 | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ---------------------- | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest pre-edit baseline |     1 |      9 |      0 |       0 |    0 |         0 |
| Jest post-edit default |     1 |      9 |      0 |       0 |    0 |         0 |
| Vitest opt-in shadow   |     1 |      9 |      0 |       0 |    0 |         0 |

Vitest's raw top-level suite counters include nested structure differently, so
the accepted proof uses normalized file/suite/test results rather than comparing
that raw field. Unsharded `vitest list` prints exactly the nine expected tests.

MSW's `setupServer` intercepts every GitHub OAuth request in process. Vitest
exits naturally after `server.close()`, and a separate Jest
`--detectOpenHandles` run also exits without the authoritative command's
`--forceExit`. No real network or external service is involved.

### CI And Future Cut-over Boundary

The current 56-task fast integration graph continues to own Auth GitHub exactly
once through the unchanged Jest default. Its existing Jest shards pass at 9/0/0
tests. No root filter, workflow, aggregate, service, or dedicated job changes in
this opt-in shadow.

A real Vitest `--shard=1/3` run exits 1 because the package owns one discovered
file. That is recorded for Turn 21: the later cut-over must move Auth GitHub out
of the generic shard and give the Vitest default dedicated unsharded ownership.
It does not justify pre-staging CI changes while Jest remains authoritative.

### Remaining-Jest Ownership

The new manifest script and config are Vitest-only. No dedicated Jest-calling
verifier is added; the existing generic comparator proves parity without
creating a fourth foundation Jest invocation owner.

The remaining-Jest inventory is byte-identical at digest
`db9dd73f0c2a73589e8d50bc0f1a9f71923b3ecbec0c11a047f91b22a74f5ab9`:
68 active configs, 114 Jest script entries across 68 owners, 11 dependency
entries across four owners, 406 active API files, three foundation invocation
files, one worker-ID owner, and one root/CI invocation owner.

### Validation

- exact pre/post Jest and Jest/Vitest JSON comparisons passed at one file, nine
  tests, every full name/status, and zero snapshots;
- unsharded Vitest list and direct package runner commands passed;
- the real one-file/three-shard Vitest command failed closed as expected for the
  future cut-over;
- the package-local config passed strict/no-unchecked-index standalone
  typechecking without widening the unchanged legacy spec;
- the Auth GitHub package build passed;
- workspace dependency policy and the unchanged remaining-Jest inventory passed;
- the full shared foundation passed strict tooling, eight tooling tests,
  five-file parity, all 25 integration selectors, and exact three-file/34-test
  adapter parity.

### Accepted Boundary

This is a local, opt-in Node integration shadow. Jest remains authoritative; no
default, rollback, root typecheck, root script, workflow, CI aggregate,
dependency, lockfile, production source, assertion, persistence, or Cloudflare
runtime/import boundary changes. The package is not migrated while its
integration default remains Jest.

PostgreSQL, PGlite, Redis, real network, workerd, D1, and Cloudflare import-graph
results are not applicable to this intercepted provider suite. No hosted result
is claimed because the shadow is not CI-owned.

## Auth GitHub Integration Vitest Cut-over

Commit:

- `6171c0b50d` (`test: switch Auth GitHub integration to Vitest`)

Date verified: 2026-07-11.

### Difference From Original Medusa

The package integration default is now Vitest, while the original command is
retained byte-identically as a rollback:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

The temporary `test:integration:vitest` alias is removed and the retired unit
`test` key remains absent. The authoritative spec, Jest config, Vitest config,
production sources, shared compatibility/MSW profile, dependencies, and lockfile
are unchanged.

The strict tooling contract freezes normalized-LF SHA-256 values for all three
runner inputs:

- spec:
  `1679ec9a5a3da285a95ac0d170f9376f661a6d3f1c076199baa196e75aab42c8`;
- Jest config:
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- Vitest config:
  `3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`.

The spec still owns nine `it`, nine `expect`, 11 `jest.fn`, one
`jest.restoreAllMocks`, one `jest.setTimeout`, and no skip/todo/only/snapshot
surface. MSW continues to intercept all GitHub OAuth traffic in process.

### Exact Assertion And Discovery Proof

Fresh reporters were compared immediately before the script switch and again
after it through `test:integration:jest` and the new default. The generic
normalizer matched the discovered file, every full name/status, counts, and
snapshot summary exactly:

| Runner         | Files | Passed | Failed | Skipped | Todo | Snapshots |
| -------------- | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest rollback  |     1 |      9 |      0 |       0 |    0 |         0 |
| Vitest default |     1 |      9 |      0 |       0 |    0 |         0 |

Vitest's raw top-level suite counter includes nested structure differently; the
accepted proof uses normalized file/suite/test results. No assertion, expected
value, full name, skip/todo state, or snapshot changed.

### Shard And CI Ownership

The real workflow-shaped Turbo command forwards `--shard=1/3` to the new Vitest
default and exits 1:

```text
--shard <count> must be a smaller than count of test files.
Resolved 1 test files for --shard=1/3.
```

The fast package command therefore excludes Auth GitHub. Its dry graph contains
55 tasks, with Auth GitHub, Auth Emailpass, and Currency absent and API Key
retained. The 63-task unsharded all-packages graph retains Auth GitHub exactly
once with `vitest run --config vitest.integration.config.mts`.

The workflow adds `auth-github-integration`, a dedicated unsharded job that:

- needs only `setup`;
- checks out, restores pipeline dependencies, and downloads existing build
  artifacts;
- owns no strategy, matrix, service, environment, CPU probe, shard, or worker
  flags;
- runs only `pnpm --filter @medusajs/auth-github test:integration`.

The stable package aggregate now requires the generic matrix, Currency, Auth
Emailpass, and Auth GitHub jobs. It fails when Auth GitHub fails, cancels, or
skips, and succeeds only when Auth GitHub succeeds. The parsed YAML contract
freezes the exact job, runner-neutral name, aggregate conditions, package
scripts, hashes, filters, and absence of a package-specific verifier.

Persistent `typecheck:test-runner-tooling` now owns the Auth GitHub config once.
The strict contract checks that path without widening the parsed JSON/YAML
boundaries or adding `any` or unsafe assertions.

### Remaining-Jest Ownership

No permanent comparator is added. It would create a fourth foundation Jest
invocation owner for a one-file intercepted provider suite; the generic
turn-local comparator and frozen contract supply the required proof.

The exact inventory changes only the Auth GitHub manifest script key from
`test:integration` to `test:integration:jest`; the command bytes are unchanged.
Its digest becomes
`da4fc00cdf717ab98a8fc75b189aa4ce868d3a623c19d56a07a9c8f2418ee365`,
while totals remain 68 configs, 114 Jest scripts across 68 owners, 406 active API
files, and three foundation Jest invocation files.

### Validation

- exact pre/post reporter parity passed at one file, nine tests, every full
  name/status, and zero snapshots;
- the direct Vitest default and Jest rollback commands passed;
- the authentic Turbo one-file/three-shard command failed closed as required;
- the 55-task fast and 63-task all-package graphs matched expected ownership;
- the dedicated default-only command passed one file/nine tests;
- package build, workspace dependency policy, strict tooling typecheck, all
  eight tooling tests, and exact remaining-Jest ownership passed;
- the complete foundation passed five-file parity, all 25 integration selectors,
  and exact three-file/34-test adapter parity.

### Accepted Boundary

This turn switches only Auth GitHub integration runner and CI ownership. It does
not restore an empty unit lane, retire the Jest rollback, rewrite Jest APIs,
migrate another provider, or change dependencies, lockfiles, assertions,
production code, persistence, package privacy/catalogs, or Cloudflare runtime
behavior.

PostgreSQL, PGlite, Redis, real network, workerd, D1, and Cloudflare import-graph
results are not applicable to this intercepted provider suite. The dedicated job
has local command and parsed-workflow proof only; hosted confirmation remains
deferred until publication.

## Auth Google Empty Unit Lane Retirement

Commit:

- `7965f31068` (`test: retire empty Auth Google unit lane`)

Date verified: 2026-07-11.

### Difference From Original Medusa

`@medusajs/auth-google` inherited this unit command:

```text
test  jest --passWithNoTests src
```

The exact package command and direct Jest list both discover zero files. Without
`--passWithNoTests`, the same `src` pattern exits 1 with zero matches. The
package's current and migration-baseline `src` trees contain only `index.ts` and
`services/google.ts`, with no unit assertion source.

Turn 22 therefore removes only this `test` manifest key. It does not add an
empty Vitest replacement, invent assertions, or create a Jest rollback for a
lane that had nothing to roll back.

The active integration command remains byte-identical and Jest-authoritative:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

`jest.config.js` also remains unchanged. Resolved configuration proves the
integration consumes a Node environment, the SWC TypeScript transform, and the
MSW transform-ignore exception. Removing it with the empty unit script would
break a separate active ownership boundary.

### Assertion And Task Ownership Proof

The unchanged integration lane passes before and after the manifest edit at one
suite, nine tests, and zero snapshots. Its normalized-LF SHA-256 remains
`3ac8100ddd8f69b15c8161dfb1ebd2fbe681d195f1577eaf790e24a198d19a4d`,
with nine `it`, nine `expect`, no skip/todo/only, and no snapshot matchers. Its
active Jest surface is 11 `jest.fn`, one `jest.restoreAllMocks`, and one
`jest.setTimeout`.

The unchanged Jest config remains normalized-LF SHA-256
`5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`.
MSW intercepts the Google OAuth token request in process and returns 404 for any
unmatched request, so the test requires no real network or credentials.

Before removal, Turbo's scoped unit task invoked the empty Jest command. After
removal, the dry graph retains one `@medusajs/auth-google#test` marker with
`<NONEXISTENT>`, while the correctly filtered root command:

```text
corepack pnpm test --filter=@medusajs/auth-google -- --shard=1/4 --maxWorkers=1 --passWithNoTests
```

selects only Auth Google, executes zero tasks, and exits successfully. The
general unit graph remains 83 nodes, with 69 executable tasks and 14 markers.

Auth Google's separate integration task remains once in the 55-task fast graph
with its byte-identical Jest command. The current generic three-way lane is
safe: shard 1 passes the one suite/nine tests, while shards 2 and 3 discover zero
tests and exit successfully through `--passWithNoTests`. No exclusion or
dedicated job is introduced in this unit-only turn.

### Remaining-Jest Ownership

The exact inventory first fails with one removed entry and no additions:

```text
manifestScripts  @medusajs/auth-google  test  jest --passWithNoTests src
```

After reviewing that delta, the accepted digest becomes
`919869b4243bfb9c8f3aee498ba2456c5a8720f30f697ecc3f270eff5c3c491f`.
Manifest Jest script entries move from 114 to 113. Script owners stay 68 because
Auth Google still owns its integration command. All 68 configs, 406 active API
files, 11 dependency entries across four owners, three foundation invocation
files, one worker-ID owner, one root/CI owner, and every other count remain
unchanged. No ownership entry is added.

The exact inventory is the permanent fail-closed contract for this deletion; a
provider-specific tooling contract would duplicate it without proving a test
result.

### Validation

- direct unit discovery returns zero files before and after the edit;
- the unchanged integration passes before and after at one suite, nine tests,
  and zero snapshots;
- all three existing Jest integration shards pass at 9/0/0 tests;
- the package build passes;
- the scoped root run executes zero tasks and Turbo retains only a
  `<NONEXISTENT>` unit marker;
- the 83-node general unit graph and 55-task fast integration graph retain their
  intended ownership;
- workspace policy and exact remaining-Jest ownership pass;
- the complete foundation passes strict tooling, eight tooling tests, five-file
  parity, all 25 integration selectors, and exact three-file/34-test adapter
  parity.

### Accepted Boundary

This is retirement of nonexistent unit coverage, not Vitest parity, an
integration shadow, a package migration, or a default switch. It changes no
test/production source, integration command, Jest config, dependency, lockfile,
root script, workflow, persistence adapter, or runtime behavior.

PostgreSQL, PGlite, Redis, real network, workerd, D1, and Cloudflare import-graph
results are not applicable to this manifest-only decision. The local unit graph
passes, but no hosted unit-matrix result is claimed before publication. The
known Turbo 1.13.4/pnpm 11 graph warning remains separate.

## Auth Google Integration Vitest Shadow

Commit:

- `6474ecbede` (`test: add Auth Google integration Vitest shadow`)

Date verified: 2026-07-11.

### Difference From Original Medusa

The exact package integration default remains Jest-authoritative:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

Turn 23 adds only this opt-in command:

```text
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The new package-local config calls `defineNodeVitestIntegrationConfig`, so it
inherits the shared SWC transform, Node/fork environment, one-worker serial
execution, global APIs, fail-closed discovery, limited Jest bridge, integration
environment setup, and inline handling for `msw` and `until-async`. It includes
only `integration-tests/__tests__/services.spec.ts` and mirrors all five Jest
aliases: `@models`, `@services`, `@repositories`, `@types`, and `@utils`.

The installed versions and the current registry releases both resolve Vite
8.1.4 with built-in Rolldown and Vitest 4.1.10. No package-specific setup,
timeout, transform, dependency, `forceExit`, source rewrite, or unsafe
TypeScript assertion is added. The unchanged `jest.setTimeout(100000)` flows
through the existing bridge and configures both Vitest timeout domains.

### Exact Assertion, Import, And Discovery Proof

The authoritative integration source remains byte-identical with normalized-LF
SHA-256
`3ac8100ddd8f69b15c8161dfb1ebd2fbe681d195f1577eaf790e24a198d19a4d`.
It retains nine `it`, nine `expect`, no skip/todo/only, and no snapshot matchers.
Its compatibility surface remains 11 `jest.fn`, one `jest.restoreAllMocks`, and
one `jest.setTimeout`, all supplied by the frozen bridge.

The active Jest config remains byte-identical at normalized-LF SHA-256
`5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`.
The new Vitest config is normalized-LF SHA-256
`3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`.

Fresh JSON reporters were captured before the edit and again after it. The
generic normalizer proves pre-edit Jest equals post-edit Jest and post-edit Jest
equals Vitest by discovered file, all nine full test names and statuses,
suite/test counts, and snapshot summary:

| Runner                 | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ---------------------- | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest pre-edit baseline |     1 |      9 |      0 |       0 |    0 |         0 |
| Jest post-edit default |     1 |      9 |      0 |       0 |    0 |         0 |
| Vitest opt-in shadow   |     1 |      9 |      0 |       0 |    0 |         0 |

Unsharded `vitest list` prints exactly the nine expected tests. The passing
Vitest run exercises the spec's framework `generateJwtToken` import and the
service's bare Node `crypto`, CommonJS `jsonwebtoken`, JWT decoding, and
framework utility imports through Vite/Rolldown. MSW intercepts the Google token
exchange in process and rejects unmatched requests, so no real network or
credentials are required.

Vitest exits naturally after `server.close()`. A separate Jest run without
`--forceExit` and with `--detectOpenHandles` also passes and exits cleanly. This
proves the current lifecycle does not need a Vitest-specific cleanup patch.

### CI And Future Cut-over Boundary

The fast and all-packages integration dry graphs remain 55 and 63 tasks. Each
owns Auth Google exactly once through the byte-identical Jest default. The
existing Jest shards pass at 9/0/0 tests, so no root filter, workflow, aggregate,
service, or dedicated job changes in this opt-in shadow.

A real `vitest run --shard=1/3` exits 1 because the package owns one discovered
file and the shard count is three. Turn 24 must therefore exclude Auth Google
from the generic fast shard and give the Vitest default dedicated unsharded CI
ownership. This failure is future cut-over evidence; it does not justify
pre-staging CI changes while Jest remains authoritative.

### Remaining-Jest Ownership

The new manifest script and config are Vitest-only. No dedicated Jest-calling
verifier is added, and the opt-in config remains standalone-typechecked rather
than entering persistent root tooling ownership before cut-over.

The remaining-Jest inventory is byte-identical at digest
`919869b4243bfb9c8f3aee498ba2456c5a8720f30f697ecc3f270eff5c3c491f`:
68 active configs, 113 Jest script entries across 68 owners, 11 dependency
entries across four owners, 406 active API files, three foundation invocation
files, one worker-ID owner, and one root/CI invocation owner.

### Validation

- exact pre/post Jest and Jest/Vitest JSON comparisons pass at one file, nine
  tests, every full name/status, and zero snapshots;
- unsharded Vitest listing, direct package shadow, and natural cleanup probes
  pass;
- the Google-specific crypto/JWT/framework/MSW import path executes under Vite
  8.1.4/Rolldown and Vitest 4.1.10;
- the real one-file/three-shard Vitest command fails closed as expected for the
  future cut-over;
- the package-local config passes standalone strict/no-unchecked-index
  typechecking and the Auth Google package build passes;
- both existing Jest graphs, all three current Jest shards, workspace policy,
  and byte-identical remaining-Jest inventory pass;
- the complete shared foundation passes strict tooling, eight tooling tests,
  five-file parity, all 25 integration selectors, and exact three-file/34-test
  adapter parity.

### Accepted Boundary

This is a local, opt-in Node integration shadow. Jest remains authoritative; no
default, rollback, root typecheck, root script, workflow, CI aggregate,
dependency, lockfile, production source, assertion, persistence, or Cloudflare
runtime/import boundary changes. The package is not migrated while its
integration default remains Jest.

PostgreSQL, PGlite, Redis, real network, workerd, D1, and Cloudflare import-graph
results are not applicable to this intercepted provider suite. No hosted result
is claimed because the shadow is not CI-owned. The known Turbo 1.13.4/pnpm 11
package-graph warning remains separate from the successful ownership proofs.

## Auth Google Integration Vitest Cut-over

Commit:

- `4c051d2d0c` (`test: switch Auth Google integration to Vitest`)

Date verified: 2026-07-11.

### Difference From Original Medusa

Auth Google's package integration default now runs the proven Vitest 4 profile,
while the original Jest command remains byte-identical as rollback:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

The temporary `test:integration:vitest` alias is removed and the retired unit
`test` key remains absent. The authoritative spec, Jest config, Vitest config,
provider source, shared compatibility/MSW profile, dependencies, and lockfile
are unchanged.

Normalized-LF SHA-256 values remain:

- integration source:
  `3ac8100ddd8f69b15c8161dfb1ebd2fbe681d195f1577eaf790e24a198d19a4d`;
- Jest config:
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- Vitest config:
  `3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`.

The spec still owns nine `it`, nine `expect`, 11 `jest.fn`, one
`jest.restoreAllMocks`, one `jest.setTimeout`, no skip/todo/only, and no snapshot
matcher. The preserved rollback remains necessary while the limited bridge owns
those Jest calls.

### Exact Cut-over Parity

Fresh reporters were captured before and after the script-key switch. The
generic normalizer proves pre/post Jest stability, pre/post Vitest stability,
and post-cut-over Jest/Vitest parity by discovered file, every full test name
and status, suite/test totals, and snapshot summary:

| Runner                 | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ---------------------- | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest before cut-over   |     1 |      9 |      0 |       0 |    0 |         0 |
| Vitest before cut-over |     1 |      9 |      0 |       0 |    0 |         0 |
| Jest rollback after    |     1 |      9 |      0 |       0 |    0 |         0 |
| Vitest default after   |     1 |      9 |      0 |       0 |    0 |         0 |

Unsharded Vitest discovery still lists exactly nine tests. The default continues
to exercise Node `crypto`, CommonJS `jsonwebtoken`, framework JWT generation and
decoding, and MSW token interception through Vite 8.1.4/Rolldown and Vitest
4.1.10 without assertion or source changes. The Jest rollback's existing shards
still pass at 9/0/0 tests.

### Root And CI Ownership

A real `vitest run --shard=1/3` exits 1 because the package owns one discovered
file and three shards. The root fast command therefore excludes Auth Google.
Its dry graph moves from 55 to 54 tasks, with Auth Google, Auth GitHub, Auth
Emailpass, and Currency absent while API Key remains. The 63-task unsharded
all-packages graph retains Auth Google exactly once with the Vitest default.

The workflow adds `auth-google-integration`, a dedicated unsharded job that:

- depends only on `setup`;
- restores the existing dependency cache and build artifact;
- runs only `pnpm --filter @medusajs/auth-google test:integration`;
- has no matrix, services, environment, database, Redis, shard, or worker flag.

The stable `integration-tests-packages` aggregate now requires the existing
matrix, Currency, Auth Emailpass, Auth GitHub, and Auth Google jobs. Its failure
branch propagates Google failure, cancellation, and skip; its success branch
requires Google success.

Persistent `typecheck:test-runner-tooling` owns the Auth Google config exactly
once. The typed parsed-workflow contract narrows JSON/YAML through the existing
guards and freezes the package scripts, absent unit/shadow/verifier keys,
source/config hashes, exact root filters, typecheck ownership, job shape, and
aggregate conditions without `any`, assertions, or coercive widening.

### Remaining-Jest Ownership

No dedicated Jest-calling verifier is added. The exact inventory changes only
one manifest key for the byte-identical rollback:

```text
removed  @medusajs/auth-google  test:integration
added    @medusajs/auth-google  test:integration:jest
```

Its accepted digest becomes
`b20c248031f53a5c0704505f278e3215313d99624fdde7484e0e8fb8684b462a`.
All counts remain 68 configs, 113 manifest Jest scripts across 68 owners, 11
dependency entries across four owners, 406 active API files, three foundation
invocation files, one worker-ID owner, and one root/CI invocation owner.

### Validation

- exact pre/post and post-cut-over JSON parity passes at one file, nine full
  names/statuses, and zero failures/skips/todos/snapshots;
- direct Vitest default, exact Jest rollback, unsharded listing, rollback shards
  at 9/0/0, real Vitest shard failure, and package build pass;
- strict persistent tooling typecheck and all eight typed workflow/tooling tests
  pass;
- the 54-task fast and 63-task all-packages graphs have exact intended
  ownership despite the separate known Turbo/pnpm warning;
- workspace dependency policy and exact remaining-Jest inventory pass;
- the complete foundation passes five-file Jest/Vitest parity, all 25
  integration selectors, real Jest/Vitest executions, and exact
  three-file/34-test adapter parity.

### Accepted Boundary

This turn switches only Auth Google integration runner and CI ownership. It does
not restore the empty unit lane, retire the Jest rollback, rewrite Jest APIs,
migrate another provider, or change dependencies, lockfiles, assertions,
production code, persistence, package privacy/catalogs, or Cloudflare runtime
behavior.

MSW intercepts all provider traffic in process. PostgreSQL, PGlite, Redis, real
network, workerd, D1, and Cloudflare import-graph results are not applicable to
this provider suite. The dedicated job has local command and parsed-workflow
proof only; hosted confirmation remains deferred until publication.

## File Local Empty Unit Lane Retirement

Commit:

- `824920b3a8` (`test: retire empty File Local unit lane`)

Date verified: 2026-07-11.

### Difference From Original Medusa

`@medusajs/file-local` inherited this unit command:

```text
test  jest --passWithNoTests src
```

The exact package command and direct Jest list discover zero files. Without
`--passWithNoTests`, the same `src` pattern exits 1 after checking four files
with zero matches. The package's migration-baseline and current `src` trees each
contain only `index.ts` and `services/local-file.ts`, with no unit assertion
source.

Turn 25 therefore removes only this `test` manifest key. It does not add an
empty Vitest replacement, invent assertions, or create a Jest rollback for a
lane that had nothing to roll back.

The active integration command remains byte-identical and Jest-authoritative:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/[^/]*\.spec\.ts"
```

`jest.config.js` also remains unchanged. It continues to own the Node/SWC/alias
boundary for the separate TypeScript filesystem spec.

### Assertion, Fixture, And Task Ownership Proof

The unchanged integration passes before and after the manifest edit at one
suite, two tests, and zero snapshots. Its normalized-LF SHA-256 remains
`a71b84503c0c2214552e4705b8094c7bb3bd930b683a9c92d15c6e5eb5aa4a01`.
It retains two `it`, ten direct `expect` calls, four asymmetric string matchers,
one `jest.setTimeout(10000)`, no mocks/spies/skip/todo/only/snapshots, and two
pre-existing `as any` boundaries that this manifest-only turn does not rewrite.

The unchanged Jest config remains normalized-LF SHA-256
`5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`.
The 24,003-byte JPEG fixture remains binary SHA-256
`68ca5bf09d8850ea11adc9f6a1dd0660dc52a4ec900a5f9cfb718673a2e01268`.

The integration exercises real local filesystem reads/writes, a writable stream,
Buffer comparison, URL construction, deletion, and directory cleanup. Its
`http://localhost:9000/static` value is used only to construct result strings;
there is no fetch, network request, database, Redis, credential, or external
service. The post-run uploads directory is absent.

Before removal, the scoped root unit command runs one empty Jest task. After
removal it selects File Local, executes zero tasks, and exits successfully. The
scoped dry graph retains one `@medusajs/file-local#test` marker with
`<NONEXISTENT>`. The general unit graph remains 83 nodes and moves from 69
executable/14 markers to 68 executable/15 markers; Framework/Utils remains
2/2/0.

Fast/all integration graphs remain 54/63 and retain File Local once with the
byte-identical Jest command. Authentic Turbo-forwarded shards pass 2/0/0 tests.
No root filter, workflow, dedicated job, or tooling contract changes in this
unit-only turn.

### Remaining-Jest Ownership

The exact inventory first fails with one removed entry and no additions:

```text
manifestScripts  @medusajs/file-local  test  jest --passWithNoTests src
```

After reviewing that delta, the accepted digest becomes
`51374a391ab1c1226af20bf875439a3198c1a61525859332425a6a3ff92bf9cd`.
Manifest Jest scripts move from 113 to 112. Script owners stay 68 because File
Local retains its integration command. All 68 configs, 406 active API files, 11
dependency entries across four owners, three foundation invocation files, one
worker-ID owner, one root/CI owner, and every other count remain unchanged.

The exact inventory is the permanent fail-closed contract for this deletion; a
provider-specific tooling contract would duplicate it without proving a test
result.

### Validation

- direct unit discovery returns zero files before and after the edit;
- the unchanged integration passes before and after at one suite, two tests, and
  zero snapshots, with cleanup leaving no uploads directory;
- all three authentic Jest integration shards pass at 2/0/0 tests;
- package build, scoped/root behavior, the 83/68/15 unit graph, and 54/63
  integration graphs pass;
- workspace policy and exact remaining-Jest ownership pass;
- the complete foundation passes strict tooling, eight tooling tests, five-file
  parity, all 25 integration selectors, and exact three-file/34-test adapter
  parity.

### Accepted Boundary

This is retirement of nonexistent unit coverage, not Vitest parity, an
integration shadow, a package migration, or a default switch. It changes no
test/production source, fixture, integration command, Jest config, dependency,
lockfile, root script, workflow, persistence adapter, or runtime behavior.

PostgreSQL, PGlite, Redis, network, workerd, D1, and Cloudflare import-graph
results are not applicable to this manifest-only decision. The local unit graph
passes, but no hosted unit-matrix result is claimed before publication. The
known Turbo 1.13.4/pnpm 11 graph warning remains separate.

## File Local Integration Vitest Shadow

Commit:

- `39e78ba87d` (`test: add File Local integration Vitest shadow`)

Date verified: 2026-07-11.

### Difference From Original Medusa

`@medusajs/file-local` keeps its exact Jest-authoritative integration command
and active `jest.config.js`. Turn 26 adds only this opt-in command:

```text
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The new package-local config consumes the shared serial Node integration
profile with all five established aliases, an absolute package root, and the
sole explicit include `integration-tests/__tests__/services.spec.ts`. The root
is intentionally the package directory because the unchanged spec resolves its
JPEG fixture and uploads directory from `process.cwd()`.

The spec directly imports `FileSystem` from `@medusajs/utils`, but the package
previously declared only `@medusajs/framework`. Root-hoist resolution masked
that missing ownership. Because the import is test-only, this turn adds
`@medusajs/utils: workspace:*` as a dev dependency and the matching File Local
lockfile importer edge to `link:../../../core/utils`. No production dependency,
catalog, root manifest, override, resolution, or unrelated lock entry changes.

### Assertion And Filesystem Parity

The integration source remains normalized-LF SHA-256
`a71b84503c0c2214552e4705b8094c7bb3bd930b683a9c92d15c6e5eb5aa4a01`.
It still contains two `it` calls, ten direct `expect` calls, four asymmetric
string matchers, one `jest.setTimeout(10000)`, no mocks, spies, skipped/todo/only
tests, or snapshots, and two pre-existing `as any` boundaries. This shadow does
not rewrite its assertions or compatibility typing.

The unchanged Jest config remains normalized-LF SHA-256
`5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`.
The new Vitest config is
`3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`.
The unchanged 24,003-byte JPEG fixture remains binary SHA-256
`68ca5bf09d8850ea11adc9f6a1dd0660dc52a4ec900a5f9cfb718673a2e01268`.

Normalized JSON reporters prove exact pre-edit Jest to post-edit Jest stability
and post-edit Jest to Vitest parity:

| Runner             | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ------------------ | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest before shadow |     1 |      2 |      0 |       0 |    0 |         0 |
| Jest after shadow  |     1 |      2 |      0 |       0 |    0 |         0 |
| Vitest shadow      |     1 |      2 |      0 |       0 |    0 |         0 |

The comparison also matches both full test names and statuses. Unsharded
Vitest discovery lists exactly those two tests.

Vite 8.1.4 with built-in Rolldown and Vitest 4.1.10 execute the unchanged Node
filesystem path: fixture reads, directory creation, writable-stream completion,
Buffer comparison, URL construction, deletion, and recursive directory cleanup.
The `localhost` URL is only a returned string; no request is made. Every
successful reporter, list, and run check leaves the uploads directory absent.
Vitest exits naturally. Jest also exits naturally without `--forceExit` under
`--detectOpenHandles`, with no open handles reported.

All three real Vitest shard runs exit 1 before collection because one discovered
file cannot satisfy a three-way shard. This is accepted shadow evidence, not a
passing sharded lane. Jest remains authoritative until the cut-over can assign
the suite to a dedicated unsharded job.

### Dependency And Ownership Proof

The manifest and lockfile importer parse as exactly:

```text
specifier  workspace:*
version    link:../../../core/utils
```

The package-local `node_modules/@medusajs/utils` junction targets the workspace
`packages/core/utils`. Workspace-wide and File-Local-filtered frozen offline
installs timed out locally after approximately five and three minutes without
reporting a lockfile mismatch. Those attempts are recorded as timeouts and are
not claimed as passing install gates. The dependency proof instead consists of
the parsed manifest/importer pair, package-local junction, workspace policy,
real Jest/Vitest executions, and package build.

Unit ownership remains 83 nodes, 68 executable tasks, and 15 markers. Fast and
all-packages integration graphs remain 54 and 63 tasks, with File Local owned
once by its unchanged Jest default. The remaining-Jest inventory is
byte-identical at digest
`51374a391ab1c1226af20bf875439a3198c1a61525859332425a6a3ff92bf9cd`,
with 68 configs, 112 scripts, and 406 active API files.

### Validation

- the exact Jest baseline, post-edit Jest command, and opt-in Vitest command pass
  at one file, two matching tests, and zero snapshots;
- Jest natural-exit/open-handle proof, Vitest natural exit, unsharded listing,
  and uploads cleanup pass;
- all three authentic Vitest shard runs fail closed as expected for one file;
- standalone strict Vitest-config typecheck, package build, workspace dependency
  policy, parsed lock importer, and exact remaining-Jest inventory pass;
- unit and integration graph ownership remains 83/68/15 and 54/63;
- the complete foundation passes strict tooling, eight tooling tests, five-file
  Jest/Vitest parity, all 25 integration selectors, real adapter commands, and
  exact three-file/34-test adapter parity.

### Accepted Boundary

This turn proves an opt-in local Node filesystem shadow. It does not switch the
package default, rename the Jest command, change CI ownership, add a workflow or
persistent tooling contract, migrate another provider, or modify assertions,
fixtures, production source, persistence, or runtime behavior.

PostgreSQL, PGlite, Redis, real network, workerd, D1, and Cloudflare import-graph
results are not applicable. No hosted result is claimed because the opt-in
command is not owned by CI.

## File Local Integration Vitest Cut-Over

Commit:

- `12681b0912` (`test: switch File Local integration to Vitest`)

Date verified: 2026-07-11.

### Difference From Original Medusa

`@medusajs/file-local` now makes the proven Vite 8.1.4/Rolldown and Vitest
4.1.10 command authoritative:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/[^/]*\.spec\.ts"
```

The Jest command moved byte-for-byte from `test:integration` to the explicit
rollback key. The temporary `test:integration:vitest` shadow key is removed.
The retired unit lane remains absent.

The spec, active Jest config, Vitest config, binary fixture, source, assertions,
and two legacy `as any` test boundaries remain unchanged. The explicit test-only
`@medusajs/utils: workspace:*` dev dependency and lockfile link to
`../../../core/utils` also remain unchanged; this cut-over has no dependency or
lockfile delta.

### Default And Rollback Parity

Absolute-path JSON reporters compare the committed pre-cut-over Jest default,
post-cut-over Jest rollback, and post-cut-over Vitest default. All three
pairwise comparisons pass exactly:

| Runner                     | Files | Passed | Failed | Skipped | Todo | Snapshots |
| -------------------------- | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest before cut-over       |     1 |      2 |      0 |       0 |    0 |         0 |
| Jest rollback after switch |     1 |      2 |      0 |       0 |    0 |         0 |
| Vitest default             |     1 |      2 |      0 |       0 |    0 |         0 |

Both full test names and statuses match. Unsharded Vitest listing returns
exactly those two tests.

The package-root execution continues to exercise fixture reads, directory
creation, writable-stream completion, Buffer comparison, URL construction,
deletion, and recursive cleanup. The localhost URL remains string construction
only. Every default, rollback, reporter, list, and shard probe leaves the
uploads directory absent.

All three real Vitest shard runs exit 1 before collection because one discovered
file cannot satisfy the generic three-way shard. The retained Jest rollback
remains authentically shardable and passes 2/0/0. This is why the Vitest default
is assigned to a dedicated unsharded job rather than the generic shard matrix.

The immutable hashes remain:

- spec: `a71b84503c0c2214552e4705b8094c7bb3bd930b683a9c92d15c6e5eb5aa4a01`;
- Jest config: `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- Vitest config: `3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`;
- 24,003-byte JPEG fixture:
  `68ca5bf09d8850ea11adc9f6a1dd0660dc52a4ec900a5f9cfb718673a2e01268`.

### Root And CI Ownership

The root fast-package command adds only
`--filter=!./packages/modules/providers/file-local`. Its direct Turbo dry graph
moves from 54 to 53 tasks and contains no File Local owner. The unchanged
all-packages command remains 63 tasks and owns exactly one
`@medusajs/file-local#test:integration` command on Vitest. The general unit graph
remains 83/68/15; the separate Framework/Utils serial graph remains 2/2/0.

The workflow adds `file-local-integration` with:

- `needs: setup`, `ubuntu-latest`, and a ten-minute timeout;
- the existing checkout, dependency cache, and build-artifact download steps;
- exact package-root execution through
  `pnpm --filter @medusajs/file-local test:integration`;
- no matrix, environment, service, database, Redis, credential, or worker flag.

The `integration-tests-packages` aggregate now depends on that job, fails for
its failure/cancelled/skipped states, and requires its success state. The job is
runner-neutral by name and unsharded by construction.

The persistent strict tooling contract parses the root manifest, File Local
manifest, workflow YAML, and filesystem evidence. It owns:

- the absent unit/shadow/root-wrapper scripts and exact default/rollback values;
- the retained `@medusajs/utils: workspace:*` test dependency;
- exactly one File Local config token in strict tooling typecheck;
- all four immutable hashes, including raw binary fixture hashing;
- exact fast/slow/all root commands;
- the dedicated job's complete shape and four steps;
- all aggregate dependencies and terminal result conditions.

No explicit `any`, enum, weak assertion, or duplicated type is added.
Strict tooling typecheck and all eight tooling tests pass.

### Remaining-Jest Ownership

The inventory first fails with exactly one removed and one added entry: the
unchanged File Local command moves from the `test:integration` key to
`test:integration:jest`. After accepting that reviewed key-only move, the digest
is `47a7f12afdddc0caeb2123cc74ac21c16f7a261b9b9e910967f699022df9715b`.

Counts remain 68 active configs, 112 manifest scripts across 68 owners, 406
active API files, 11 dependency entries across four owners, three foundation
invocation files, and one root/CI owner. Every other inventory count is
unchanged.

### Validation

- all three pre/post reporter comparisons pass at one file, two matching tests,
  and zero snapshots;
- direct Vitest default, exact Jest rollback, unsharded list, Vitest shard
  fail-closed evidence, Jest rollback shards at 2/0/0, and cleanup pass;
- package build, strict tooling typecheck, all eight tooling tests, workspace
  dependency policy, exact inventory, and direct Turbo graph checks pass;
- the complete foundation passes five-file Jest/Vitest parity, all 25
  integration selectors, real Jest/Vitest adapter execution, and exact
  three-file/34-test adapter parity.

### Accepted Boundary

This turn changes only File Local runner, root test ownership, persistent
tooling proof, and CI shape. It does not retire the Jest rollback, restore the
empty unit lane, migrate File S3, alter dependencies/lockfile/catalogs, or change
assertions, source, fixtures, persistence, production runtime, or Cloudflare
bundle behavior.

PostgreSQL, PGlite, Redis, real network, workerd, D1, and Cloudflare import-graph
results are not applicable to this local filesystem suite. The dedicated job's
exact command and parsed workflow contract pass locally; hosted execution is
deferred until publication.

## File S3 Empty Unit Lane Retirement

Commit:

- `02a48c210e` (`test: retire empty File S3 unit lane`)

Date verified: 2026-07-11.

### Difference From Original Medusa

`@medusajs/file-s3` inherited this unit command:

```text
test  jest --passWithNoTests src
```

The exact package command and direct Jest listing discover zero files. The
command exits successfully only because of `--passWithNoTests`; the same `src`
target without that flag exits 1 after Jest checks four files and finds zero
matches.

The migration-baseline and current `src` trees are identical. Each contains
only `src/index.ts` and `src/services/s3-file.ts`, with no unit assertion,
`__tests__`, mock, fixture, spec, or test file. Their normalized-LF hashes remain
`8aa40ba11e48a0f334da9a46c79ec0deed63b1b402aa9b697b3e286349c141d6`
and `54951de5968ecdaf7606e8133f717ae87ca14349e2fab6e487d13839715d2ee1`.

Turn 28 therefore removes only the empty `test` manifest key. It does not add an
empty Vitest replacement, invent assertions, or create a Jest rollback for a
lane that had nothing to roll back.

The separate integration command remains byte-identical and Jest-authoritative:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/[^/]*\.spec\.ts"
```

`jest.config.js`, the integration spec, fixture, production source,
dependencies, lockfile, root scripts, workflow, and persistent tooling contract
also remain unchanged.

### Integration Ownership And Service Boundary

Pre/post normalized Jest reporters match exactly:

| Runner             | Files | Tests passed | Tests skipped | Failed | Todo | Snapshots |
| ------------------ | ----: | -----------: | ------------: | -----: | ---: | --------: |
| Before unit retire |     1 |            0 |             8 |      0 |    0 |         0 |
| After unit retire  |     1 |            0 |             8 |      0 |    0 |         0 |

The one suite is pending and all eight materialized tests are skipped. Seven
syntactic `it` sites produce eight cases because the public/private case is
parameterized. The spec retains 15 direct `expect` sites, 12
`expect.stringMatching` sites, one `jest.setTimeout(100000)`, one
`describe.skip`, no mocks/spies/MSW/Axios adapter/snapshots, and one pre-existing
`as any` boundary. Zero assertions execute.

The immutable integration hashes remain:

- spec: `3061da765a3afd73cc117f119d104af3205705304efef426f08c794fc4b0410b`;
- Jest config: `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- 24,003-byte JPEG fixture:
  `68ca5bf09d8850ea11adc9f6a1dd0660dc52a4ec900a5f9cfb718673a2e01268`.

Authentic Jest shards pass with skipped distribution 8/0/0. A direct explicit
file run without `--forceExit` also exits naturally under `--detectOpenHandles`,
but that proves only the skipped path.

This is not mocked/local S3 coverage. If enabled, the suite consumes six
`S3_TEST_*` values and makes real AWS SDK plus Axios GET/PUT requests. It has no
failure-safe `afterEach`, `afterAll`, or `finally` cleanup, two upload cases do
not delete their objects, and service deletion suppresses errors. Live cleanup
and open-handle behavior remain unproven. Its direct test-only Axios import is
undeclared and currently succeeds through root-hoist resolution. Those facts
belong to the later integration shadow/activation boundary; they do not justify
retaining a zero-test unit command.

### Task And Inventory Ownership

Before removal, the general unit graph is 83 nodes, 68 executable tasks, and 15
markers. After removal it remains 83 nodes and becomes 67 executable/16 markers.
The scoped root command selects File S3 but executes zero tasks, while the scoped
Turbo graph retains `@medusajs/file-s3#test` as `<NONEXISTENT>`. The separate
Framework/Utils serial graph remains 2/2/0.

Fast/all integration graphs remain 53/63 and retain File S3 exactly once on its
byte-identical Jest command. No root filter, workflow, CI job, or tooling
contract changes in this unit-only turn.

The remaining-Jest inventory first fails with exactly one removed entry and no
additions:

```text
manifestScripts  @medusajs/file-s3  test  jest --passWithNoTests src
```

After accepting that reviewed deletion, its digest becomes
`f7cba2d34e540fdf98b6ffee7257b671202c6e978531e59fc3bad8d6244d30c5`.
Manifest Jest scripts move 112 to 111. Script owners remain 68 because File S3
retains integration ownership. All 68 configs, 406 active API files, 11
dependency entries across four owners, three foundation invocation files, one
root/CI owner, and every other count remain unchanged.

### Validation

- exact unit discovery proves zero files before and after the manifest edit;
- pre/post integration reporter stability passes at one skipped suite, eight
  skipped tests, zero executed assertions, and zero snapshots;
- authentic Jest integration shards remain 8 skipped/0/0;
- package build, scoped root behavior, 83/67/16 general unit graph, 2/2/0 serial
  graph, and unchanged 53/63 integration graphs pass;
- workspace dependency policy and exact remaining-Jest ownership pass;
- the complete foundation passes strict tooling, eight tooling tests, five-file
  parity, all 25 integration selectors, and exact three-file/34-test adapter
  parity.

### Accepted Boundary

This is retirement of nonexistent unit coverage, not Vitest parity, an
integration shadow, activation of the live S3 suite, or a package-default
switch. It changes no assertion, source, fixture, Jest config, integration
command, dependency, lockfile, root script, workflow, persistence adapter, or
runtime behavior.

No S3 credential or endpoint is configured locally, and no real network call
executes because the suite is skipped. PostgreSQL, PGlite, Redis, workerd, D1,
and Cloudflare import-graph results are not applicable. No workflow changes, so
no new hosted result is claimed. The known Turbo 1.13.4/pnpm 11 graph warning
remains separate.

## File S3 Integration Vitest Shadow

Commit:

- `dbbe6511b7` (`test: add File S3 integration Vitest shadow`)

Date verified: 2026-07-11.

### Difference From Original Medusa

`@medusajs/file-s3` retains the exact Jest-authoritative command:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/[^/]*\.spec\.ts"
```

Turn 29 adds only this opt-in shadow:

```text
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The new config resolves its package root with `fileURLToPath`, consumes the
shared serial Node integration profile, preserves the five Jest aliases, and
includes only `integration-tests/__tests__/services.spec.ts`. Vite 8.1.4 and
Vitest 4.1.10 import and collect that file successfully. The config's
normalized-LF hash is
`3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`.

The unchanged test imports Axios directly, so File S3 now declares test-only
`axios: ^1.13.1`. Its lock importer resolves the already-owned
`axios@1.13.2`. The lock change is exactly that importer edge: it adds no new
package/snapshot record, peer suffix, root dependency, workspace override,
catalog, or unrelated importer change. A targeted frozen offline install passes
and confirms manifest/lock consistency.

### Exact Shadow Parity And Service Boundary

Normalized reporter results are exact:

| Runner         | Files | Passed | Skipped | Failed | Todo | Snapshots |
| -------------- | ----: | -----: | ------: | -----: | ---: | --------: |
| Pre-edit Jest  |     1 |      0 |       8 |      0 |    0 |         0 |
| Post-edit Jest |     1 |      0 |       8 |      0 |    0 |         0 |
| Opt-in Vitest  |     1 |      0 |       8 |      0 |    0 |         0 |

The exact full-name order and statuses match, including two parameterized cases
with the same public/private full name. Seven syntactic `it` sites still
materialize eight skipped cases. The spec retains 15 direct `expect` sites, 12
`expect.stringMatching` sites, `jest.setTimeout(100000)`, `describe.skip`, one
`beforeAll`, no failure-safe cleanup hooks, no mocks/spies, no snapshots, and
one pre-existing `as any` boundary.

All six `S3_TEST_*` variables are absent. Module import/collection and the
legacy bridge's top-level timeout compatibility execute, but `describe.skip`
prevents `beforeAll`, fixture reads, service construction, assertions,
credentials, AWS/Axios requests, streams, deletion, and cleanup from running.
This proves runner compatibility only; it does not prove S3 behavior, fixture
path behavior, cleanup, or live open-handle behavior.

The immutable hashes remain:

- spec: `3061da765a3afd73cc117f119d104af3205705304efef426f08c794fc4b0410b`;
- Jest config: `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- 24,003-byte JPEG fixture:
  `68ca5bf09d8850ea11adc9f6a1dd0660dc52a4ec900a5f9cfb718673a2e01268`;
- `src/index.ts`:
  `8aa40ba11e48a0f334da9a46c79ec0deed63b1b402aa9b697b3e286349c141d6`;
- `src/services/s3-file.ts`:
  `54951de5968ecdaf7606e8133f717ae87ca14349e2fab6e487d13839715d2ee1`.

### Shards, Tasks, And Inventory

Authentic Jest shards pass with skipped distribution 8/0/0. Real Vitest 1/3,
2/3, and 3/3 runs each exit 1 before collection because one resolved file cannot
satisfy a three-way shard. `vitest list --json` also omits wholly skipped tests,
so reporter normalization is the authoritative name/count proof. A later
cut-over must use an unsharded lane rather than forwarding the generic shard.

General/serial unit graphs remain 83/67/16 and 2/2/0. Fast/all integration
graphs remain 53/63 and retain exactly one File S3 task on the byte-identical
Jest command. No root filter, workflow, CI job, aggregate dependency, or
persistent tooling contract changes in this shadow turn.

The remaining-Jest inventory stays byte-identical at digest
`f7cba2d34e540fdf98b6ffee7257b671202c6e978531e59fc3bad8d6244d30c5`:
68 configs, 111 scripts across 68 owners, and 406 active API files. Adding an
opt-in Vitest command does not alter Jest ownership.

### Validation

- exact pre/post Jest and Jest/Vitest reporter parity passes at one file and
  eight skipped tests with full-name/status parity and zero snapshots;
- all six service variables are absent; skipped execution performs no network
  request or credential use;
- strict standalone config typecheck and the package build pass;
- the targeted frozen offline install, workspace dependency policy, formatting,
  exact inventory, and lock importer review pass;
- authentic Jest/Vitest shard behavior and unchanged 83/67/16, 2/2/0, and
  53/63 graphs pass;
- the complete foundation passes strict tooling, eight tooling tests, five-file
  parity, all 25 integration selectors, real Jest/Vitest adapter execution, and
  exact three-file/34-test adapter parity.

### Accepted Boundary

This is an opt-in runner shadow, not activation of the manual live-service
suite or a default switch. It changes only the File S3 manifest, a package-local
Vitest config, the direct test-only Axios ownership edge, and documentation. It
changes no test/source assertion, skip state, fixture, Jest config, root script,
workflow, persistence adapter, production runtime, or Cloudflare bundle.

No PostgreSQL, PGlite, Redis, real S3/network, workerd, D1, or Cloudflare result
is applicable or claimed. No workflow changed, so no hosted execution or GitHub
repository access is required for this turn. Existing hosted confirmation
remains separately deferred.

## File S3 Integration Vitest Cut-Over

Commit:

- `da5bd98f53` (`test: switch File S3 integration to Vitest`)

Date verified: 2026-07-11.

### Difference From Original Medusa

`@medusajs/file-s3` now makes the registry- and locally-confirmed Vite
8.1.4/Rolldown and Vitest 4.1.10 command authoritative:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/[^/]*\.spec\.ts"
```

The former Jest default moves byte-for-byte to the rollback key and the
temporary `test:integration:vitest` shadow key is removed. The retired unit lane
remains absent. The Jest/Vitest configs, integration spec, JPEG fixture,
production source, assertions, skip state, dependencies, and lockfile remain
unchanged. Axios stays test-only at `^1.13.1`, with the existing File S3 lock
importer resolving `1.13.2`.

### Default And Rollback Parity

Fresh absolute-path reporters compare the committed pre-cut-over Jest default,
post-cut-over Jest rollback, and post-cut-over Vitest default. All three pairwise
comparisons pass exactly:

| Runner                     | Files | Passed | Failed | Skipped | Todo | Snapshots |
| -------------------------- | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest before cut-over       |     1 |      0 |      0 |       8 |    0 |         0 |
| Jest rollback after switch |     1 |      0 |      0 |       8 |    0 |         0 |
| Vitest default             |     1 |      0 |      0 |       8 |    0 |         0 |

Full-name order and statuses match, including the duplicate public/private
parameterized name. Vitest's list command returns no cases for a wholly skipped
`describe`, so JSON run reporters—not list output—are the authoritative eight-
case proof.

All three real Vitest shard runs exit 1 before import because one resolved file
cannot satisfy a three-way shard. The Jest rollback remains authentically
shardable and passes 8 skipped/0/0. Direct unsharded default and rollback
commands both pass.

All six `S3_TEST_*` values are absent. Module import/collection and the legacy
timeout bridge execute, but `describe.skip` prevents `beforeAll`, fixture reads,
service construction, assertions, credentials, AWS/Axios requests, streams,
deletion, and cleanup. This remains runner and skip-state proof only.

The typed contract freezes these runner/test artifact hashes:

- spec: `3061da765a3afd73cc117f119d104af3205705304efef426f08c794fc4b0410b`;
- Jest config: `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- Vitest config:
  `3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`;
- 24,003-byte JPEG fixture:
  `68ca5bf09d8850ea11adc9f6a1dd0660dc52a4ec900a5f9cfb718673a2e01268`.

Turn-scoped diff/hash evidence separately confirms unchanged production source:

- `src/index.ts`:
  `8aa40ba11e48a0f334da9a46c79ec0deed63b1b402aa9b697b3e286349c141d6`;
- `src/services/s3-file.ts`:
  `54951de5968ecdaf7606e8133f717ae87ca14349e2fab6e487d13839715d2ee1`.

Those production hashes are intentionally not permanent test-runner-contract
assertions, so legitimate future File S3 behavior changes do not fail an
unrelated runner gate.

### Root And CI Ownership

The root fast-package command adds only
`--filter=!./packages/modules/providers/file-s3`. Its direct Turbo graph moves
53 to 52 tasks, with 33 executable tasks, 19 markers, and no File S3 owner. The
unchanged all-packages command remains 63 tasks (44 executable/19 markers) and
owns File S3 once on Vitest. General/serial unit graphs remain 83/67/16 and
2/2/0.

The workflow adds runner-neutral `file-s3-integration` with:

- `needs: setup`, `ubuntu-latest`, and a ten-minute timeout;
- existing checkout, dependency-cache, and build-artifact download steps;
- exact unsharded execution through
  `pnpm --filter @medusajs/file-s3 test:integration`;
- no job environment, strategy, services, database, Redis, S3 credentials, or
  worker flags.

The `integration-tests-packages` aggregate now depends on that job, fails for
its failure/cancelled/skipped states, and requires its success. The matrix and
slow lane remain unchanged.

The persistent strict tooling contract parses the root/File S3 manifests,
workflow YAML, and repository files. It owns:

- the absent unit/shadow/root-wrapper scripts and exact default/rollback values;
- Axios `^1.13.1` in dev dependencies and absent from production dependencies;
- exactly one File S3 config token in strict tooling typecheck;
- exact fast/slow/all root commands and graph ownership shape;
- the four runner/test artifact hashes;
- the dedicated job's complete four-step shape and absent services/env/strategy;
- aggregate dependencies and every terminal-state condition.

No explicit `any`, enum, cast, or weak I/O-boundary type is added. Strict
tooling typecheck and all eight tooling tests pass.

### Remaining-Jest Ownership

The inventory first fails with exactly one removed and one added entry: the
unchanged File S3 command moves from `test:integration` to
`test:integration:jest`. After accepting that key-only move, the digest becomes
`1ac908587ec53d1de09104422e0b9dc34a227119b3e9ca67f96ca5e5d2721447`.

Counts remain 68 active configs, 111 manifest scripts across 68 owners, 406
active API files, 11 dependency entries across four owners, three foundation
invocation files, and one root/CI owner. Every other inventory count remains
unchanged.

### Validation

- all three reporter comparisons pass at one file, eight skipped tests, exact
  full names/statuses, and zero snapshots;
- direct Vitest default, exact Jest rollback, real Vitest fail-closed shards,
  and Jest rollback shards at 8/0/0 pass their expected outcomes;
- package build, strict tooling typecheck, all eight tooling tests, workspace
  policy, exact inventory, formatting, and direct graph checks pass;
- the complete foundation passes five-file Jest/Vitest parity, all 25
  integration selectors, real Jest/Vitest adapter execution, and exact
  three-file/34-test adapter parity.

### Accepted Boundary

This cut-over changes File S3 runner ownership plus root/CI and persistent
contract shape. It does not activate the manual live-service suite, change an
assertion, fixture, source, config, dependency, lockfile, persistence adapter,
production runtime, or Cloudflare bundle.

No PostgreSQL, PGlite, Redis, real S3/network, workerd, D1, or Cloudflare result
is applicable or claimed. Local YAML parsing, contract tests, graph ownership,
and the exact dedicated command pass. Only a published GitHub Actions run can
prove hosted setup/cache/artifact and aggregate scheduling, so hosted status
remains deferred. Even hosted green would prove eight preserved skips, not live
S3 behavior.

## Notification Local Empty Unit Lane Retirement

Commit:

- `6dececa1d0` (`test: retire empty Notification Local unit lane`)

Date verified: 2026-07-12.

### Difference From Original Medusa

`@medusajs/notification-local` inherited this unit command:

```text
test  jest --passWithNoTests src
```

The exact package command exits 0 with no tests only because execution includes
`--passWithNoTests`. Direct Jest listing returns zero files. Direct execution
without the flag exits 1 after checking four files and finding zero matches.

Goal baseline `8b02a0c77c` and current `src` trees are identical. Both contain
only `src/index.ts` and `src/services/local.ts`; scans find no `__tests__`,
`__mocks__`, `__fixtures__`, spec/test file, snapshot, assertion, test API, or
mock/fixture reference.

Their normalized-LF hashes remain:

- `src/index.ts`:
  `3fd401c42677199a8ace4810e6db7af4cbe379926bc0c7248c86adfef48c07af`;
- `src/services/local.ts`:
  `7f19b33639e38e1d07bd997eba6b7fdde73e9796abd14509ec172bdd75e15dee`.

Turn 31 removes only the empty `test` manifest key. It adds no empty Vitest
replacement, invents no assertions, and creates no Jest rollback for a lane
with nothing to roll back.

The separate integration command remains byte-identical and Jest-authoritative:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

The Jest config, integration spec, source, dependencies, lockfile, root scripts,
workflow, and persistent tooling contract also remain unchanged.

### Integration Ownership Stability

Pre/post normalized Jest reporters match exactly:

| Runner             | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ------------------ | ----: | -----: | -----: | ------: | ---: | --------: |
| Before unit retire |     1 |      1 |      0 |       0 |    0 |         0 |
| After unit retire  |     1 |      1 |      0 |       0 |    0 |         0 |

The exact full name remains
`Local notification provider sends logs to the console output with the notification details`.
The spec retains one `it`, two `expect` calls, `jest.setTimeout(100000)`, one
call-through `jest.spyOn(console, "info")`, an `afterEach` cleanup using
`jest.restoreAllMocks()`, no snapshots, and one pre-existing `as any` boundary.

Authentic Jest integration shards remain 1/0/0. A diagnostic run without
`--forceExit`, using `--detectOpenHandles`, passes and terminates naturally with
no open-handle report; the ordinary force-exit message alone is not evidence of
a leak.

This integration is local and service-free. It constructs
`LocalNotificationService`, formats one message, calls `console.info`, and
returns `{}`. It uses no module mock, fake timer, environment variable,
filesystem, network client, socket, database, Redis, workerd, or Cloudflare
runtime.

The preserved hashes are:

- integration spec:
  `c9b0e5be6be8dce37d0f0d2baf38f2b030a9c1e7d40e103170c433196587b4b6`;
- Jest config:
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`.

### Task And Inventory Ownership

The general unit graph remains 83 nodes and moves from 67 executable/16 markers
to 66/17. A scoped root command selects Notification Local and executes zero
tasks; its scoped Turbo graph retains
`@medusajs/notification-local#test` as `<NONEXISTENT>`. Framework/Utils serial
units remain 2/2/0.

Fast/all integration graphs remain 52/63 (33/19 and 44/19
executable/marker splits) and retain Notification Local exactly once on its
unchanged Jest command.

The inventory first fails with exactly one removed entry and no additions:

```text
manifestScripts  @medusajs/notification-local  test  jest --passWithNoTests src
```

After accepting that deletion, the digest becomes
`b89e589f285d2e272e60e864ad1af9c7b38792d9165d92ff290ae792c36df4df`.
Manifest Jest scripts move 111 to 110. Script owners remain 68 because
Notification Local retains integration ownership. Active configs and API files
remain 68 and 406; every other inventory count is unchanged.

### Validation

- exact unit discovery proves zero files and zero assertions before removal;
- baseline/current source tree and normalized hashes match;
- pre/post integration reporter stability passes at one file/one test, exact
  full name/status, and zero snapshots;
- authentic integration shards remain 1/0/0 and the no-force-exit diagnostic
  terminates cleanly;
- package build, scoped root behavior, 83/66/17 general units, 2/2/0 serial
  units, and unchanged 52/63 integration graphs pass;
- workspace dependency policy, exact inventory, formatting, and the complete
  foundation pass.

### Accepted Boundary

This is retirement of nonexistent unit coverage, not Vitest parity, integration
migration, or a package-default switch. It changes no integration assertion,
source, config, dependency, lockfile, root script, workflow, persistence,
production runtime, or Cloudflare bundle behavior.

No PostgreSQL, PGlite, Redis, network, credential, workerd, D1, Cloudflare, or
hosted result is applicable or claimed.

## Notification Local Integration Vitest Shadow

Commit:

- `0bead05d23` (`test: add Notification Local integration Vitest shadow`)

Date verified: 2026-07-12.

### Difference From Original Medusa

`@medusajs/notification-local` retains the exact Jest-authoritative command:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

Turn 32 adds only this opt-in shadow:

```text
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The new config resolves its package root with `fileURLToPath`, consumes the
shared serial Node integration profile, preserves all five Jest aliases, and
includes only `integration-tests/__tests__/services.spec.ts`. Registry and local
tooling agree on Vite 8.1.4 with built-in Rolldown and Vitest 4.1.10. The
config's normalized-LF hash is
`3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`.

As with every consumer of `defineNodeVitestIntegrationConfig`, the shadow also
loads `integration-tests/setup-env.js` inside the Vitest worker. That setup
loads `.env.test`, reads optional `CHUNK`/`DB_TEMP_NAME`, and, when
`DB_TEMP_NAME` is absent, resolves a validated worker ID from
`MEDUSA_TEST_WORKER_ID`, `VITEST_POOL_ID`, or `JEST_WORKER_ID` (falling back to
`1`) before initializing the name. It also replaces `global.performance`. The
Jest baseline does not load this file. Notification Local's unchanged assertion
reads none of that state, requires no caller-supplied environment, and preserves
exact observable parity, so this test-worker-only harness difference is
accepted.

No dependency or lockfile change is needed. The spec imports only package-local
source; that source uses the already-owned `@medusajs/framework` dev/peer edge.
The config imports only `node:url` and the relative shared helper.

### Exact Shadow Parity And Bridge Behavior

Normalized reporter results are exact:

| Runner         | Files | Passed | Failed | Skipped | Todo | Snapshots |
| -------------- | ----: | -----: | -----: | ------: | ---: | --------: |
| Pre-edit Jest  |     1 |      1 |      0 |       0 |    0 |         0 |
| Post-edit Jest |     1 |      1 |      0 |       0 |    0 |         0 |
| Opt-in Vitest  |     1 |      1 |      0 |       0 |    0 |         0 |

All pairwise comparisons preserve the exact full name:
`Local notification provider sends logs to the console output with the notification details`.

The unchanged spec retains one `it`, two `expect` calls,
`jest.setTimeout(100000)`, one call-through `jest.spyOn(console, "info")`, an
`afterEach` cleanup using `jest.restoreAllMocks()`, no snapshots, and one
pre-existing `as any` boundary. The typed shared bridge maps those three Jest
APIs to Vitest's timeout configuration, spy, and restoration behavior. The real
service formats the deterministic message, calls the injected logger once, and
returns `{}` under both runners.

Unsharded Vitest listing returns exactly the sole spec/test, and the direct
Vitest run exits naturally after cleanup. All real Vitest 1/3, 2/3, and 3/3
runs exit 1 before import because one resolved file cannot satisfy a three-way
shard. Jest remains the default graph owner and retains authentic 1/0/0 shards.

The preserved normalized-LF hashes are:

- spec: `c9b0e5be6be8dce37d0f0d2baf38f2b030a9c1e7d40e103170c433196587b4b6`;
- Jest config: `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- `src/index.ts`:
  `3fd401c42677199a8ace4810e6db7af4cbe379926bc0c7248c86adfef48c07af`;
- `src/services/local.ts`:
  `7f19b33639e38e1d07bd997eba6b7fdde73e9796abd14509ec172bdd75e15dee`.

### Task And Inventory Ownership

General/serial unit graphs remain 83/66/17 and 2/2/0. Fast/all integration
graphs remain 52/63 (33/19 and 44/19 executable/marker splits) and retain
Notification Local exactly once on its byte-identical Jest command. The opt-in
script has no root or workflow owner.

The remaining-Jest inventory stays byte-identical at digest
`b89e589f285d2e272e60e864ad1af9c7b38792d9165d92ff290ae792c36df4df`:
68 active configs, 110 scripts across 68 owners, and 406 active API files. The
new Vitest script/config adds no Jest ownership.

### Validation

- all three reporter comparisons pass at one file/one test, exact full
  name/status, and zero snapshots;
- direct Vitest shadow, exact Jest default, unsharded list, natural exit, real
  Vitest fail-closed shards, and Jest shards at 1/0/0 pass expected outcomes;
- strict standalone config typecheck, package build, workspace policy,
  formatting, exact inventory, and hash/graph proof pass;
- the complete foundation passes strict tooling, eight tooling tests, five-file
  shared parity, all 25 integration selectors, real Jest/Vitest adapter
  execution, and exact three-file/34-test adapter parity.

### Accepted Boundary

This is an opt-in runner shadow, not a default switch or CI ownership change. It
changes only the Notification Local manifest, a package-local Vitest config, and
documentation. It changes no assertion, source, Jest config, dependency,
lockfile, root script, workflow, persistent tooling contract, persistence,
production runtime, or Cloudflare bundle.

The assertion is local-only and needs no database, Redis, caller-provided
environment, filesystem, network, credential, workerd, D1, Cloudflare, or
external service. The accepted shared Vitest worker setup above is the only
environmental side effect and is outside the service/assertion behavior. No
hosted result is applicable or claimed.

## Next Boundary

Turn 33 should switch Notification Local's default integration command to
Vitest, retain the exact Jest command as `test:integration:jest`, and remove the
temporary shadow key. Because the one-file Vitest lane cannot enter the generic
three-way shard, remove Notification Local from that fast graph and add a
dedicated unsharded runner-neutral job, aggregate terminal-state propagation,
persistent strict config typecheck, and typed local workflow-contract coverage.
Preserve assertions, cleanup, hashes, service-free behavior, and rollback
parity; accept only the expected Jest inventory-key move to digest
`2994c111cab4cf88af15777b67086bad827e4a8308036679ce735a5aeda222c4`.
Do not change dependencies/lockfile, combine Notification SendGrid, or claim
hosted execution before publication.

## Notification Local Integration Vitest Cut-Over

Commit:

- `07a1caabd5` (`test: switch Notification Local integration to Vitest`)

Date verified: 2026-07-12.

### Difference From Original Medusa

`@medusajs/notification-local` now makes the registry- and locally-confirmed
Vite 8.1.4 with built-in Rolldown and Vitest 4.1.10 command authoritative:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

The exact former Jest default moves to the rollback key, the temporary
`test:integration:vitest` key is removed, and the retired unit lane remains
absent. The integration assertion, Jest/Vitest configs, source, aliases,
dependencies, and lockfile remain unchanged.

The shared Vitest profile still loads `integration-tests/setup-env.js`. It
loads `.env.test`; leaves an existing `DB_TEMP_NAME` untouched; otherwise
selects and validates `MEDUSA_TEST_WORKER_ID`, `VITEST_POOL_ID`,
`JEST_WORKER_ID`, or fallback `1`; reads `CHUNK`; initializes the generated name;
and replaces `global.performance`. Jest rollback does not load that file. The
unchanged Notification Local assertion observes none of this worker state and
requires no caller-provided environment or external service.

### Default And Rollback Parity

Fresh absolute-path reporters compare the committed pre-cut-over Jest default,
post-cut-over Jest rollback, and post-cut-over Vitest default. Every pairwise
comparison passes:

| Runner                     | Files | Passed | Failed | Skipped | Todo | Snapshots |
| -------------------------- | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest before cut-over       |     1 |      1 |      0 |       0 |    0 |         0 |
| Jest rollback after switch |     1 |      1 |      0 |       0 |    0 |         0 |
| Vitest default             |     1 |      1 |      0 |       0 |    0 |         0 |

All preserve the exact passed name:
`Local notification provider sends logs to the console output with the notification details`.
The spec still owns one `it`, two `expect` calls, `jest.setTimeout(100000)`, a
call-through `console.info` spy, and `jest.restoreAllMocks()` cleanup. No
snapshot, module mock, fake timer, database, Redis, filesystem, network client,
credential, workerd, D1, or Cloudflare runtime is involved.

Unsharded Vitest list/run returns exactly the one spec/test and exits naturally.
All real Vitest 1/3, 2/3, and 3/3 runs exit 1 before import because one resolved
file cannot satisfy three shards. Jest rollback remains 1/0/0 with the two empty
shards exiting successfully through `--passWithNoTests`. A separate no-force
Jest `--detectOpenHandles` run exits naturally with no open-handle report; the
retained force-exit warning is not leak evidence.

The permanent typed contract freezes normalized-LF hashes for:

- spec: `c9b0e5be6be8dce37d0f0d2baf38f2b030a9c1e7d40e103170c433196587b4b6`;
- Jest config: `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- Vitest config:
  `3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`.

Turn-scoped evidence separately confirms unchanged production source:

- `src/index.ts`:
  `3fd401c42677199a8ace4810e6db7af4cbe379926bc0c7248c86adfef48c07af`;
- `src/services/local.ts`:
  `7f19b33639e38e1d07bd997eba6b7fdde73e9796abd14509ec172bdd75e15dee`.

These source hashes are intentionally not permanent runner-contract assertions,
so later legitimate provider changes do not fail an unrelated test-runner gate.

### Root And CI Ownership

The root fast-package command adds only
`--filter=!./packages/modules/providers/notification-local`. Its direct Turbo
graph moves 52/33/19 to 51 total, 32 executable, and 19 markers, with no
Notification Local owner. Slow remains unchanged. The unsharded all-packages
graph stays 63/44/19 and owns exactly one
`@medusajs/notification-local#test:integration` command on Vitest. General and
Framework/Utils unit graphs remain 83/66/17 and 2/2/0.

The workflow adds runner-neutral `notification-local-integration` with:

- `needs: setup`, `ubuntu-latest`, and a ten-minute timeout;
- existing checkout, dependency-cache, and build-artifact download steps;
- exact unsharded execution through
  `pnpm --filter @medusajs/notification-local test:integration`;
- no job environment, strategy, services, matrix, database, Redis, shard, CPU
  probe, or worker flag.

The build-artifact download is required even for this local assertion because
the shared setup loads the built
`@medusajs/test-utils/dist/test-worker-identity` leaf. The
`integration-tests-packages` aggregate now depends on the dedicated job, fails
for its failure/cancelled/skipped states, requires its success, and retains
`if: ${{ always() }}`.

The strict typed contract parses the Notification Local/root manifests,
workflow YAML, and immutable runner files. It protects:

- absent unit/shadow/root-wrapper scripts and exact default/rollback values;
- exactly one Notification Local config token in persistent strict typecheck;
- exact fast/slow/all root commands;
- the spec/Jest/Vitest hashes;
- the dedicated job's complete four-step shape, runner-neutral name, and absent
  job environment/services/strategy;
- aggregate dependencies and every failure/cancelled/skipped/success condition.

No explicit `any`, enum, cast, suppression, or weak I/O-boundary type is added.
Strict tooling typecheck and all eight tooling tests pass.

### Remaining-Jest Ownership

Before acceptance, the inventory reports exactly one removed and one added
entry: the byte-identical Jest command moves from manifest key
`test:integration` to `test:integration:jest`. Every summary count is identical.
After accepting only that key move, the digest is
`2994c111cab4cf88af15777b67086bad827e4a8308036679ce735a5aeda222c4`.

Counts remain 68 active configs, 110 scripts across 68 owners, 406 active API
files, 11 dependency entries across four owners, three foundation invocation
files, and one root/CI owner.

### Validation

- all three reporter comparisons pass at one file, one test, exact full
  name/status, and zero snapshots;
- unsharded default/list, exact rollback, natural exit, no-force Jest, real
  Vitest fail-closed shards, and Jest rollback 1/0/0 pass expected outcomes;
- package build, frozen offline install, workspace dependency policy, strict
  typecheck, all eight tooling tests, exact inventory, formatting, hashes, and
  direct graph proof pass;
- an initial complete-foundation run reached the existing PGlite Vitest child
  and crashed with Windows status `3221226505` while C: had 0.36 GB free. A
  bounded `pnpm store prune` removed 11,237 cache files (about 2.1 GB) and left
  about 6.6 GB free. The isolated Vitest adapter then passed three files and 34
  tests;
- the complete 248-second foundation rerun passed five-file shared parity, all
  25 integration selectors, real Jest/Vitest adapter execution, exact
  three-file/34-test parity, and the reviewed inventory.

### Accepted Boundary

This cut-over changes package runner ownership plus root/CI and persistent
contract shape. It changes no assertion, source, config, dependency, lockfile,
persistence adapter, production runtime, workerd, D1, or Cloudflare bundle.

Local YAML parsing, typed workflow contract execution, graph ownership, the
exact dedicated command, and aggregate conditions pass. They do not prove
GitHub scheduling, checkout/cache/artifact behavior, or real aggregate
execution. Hosted confirmation remains deferred until publication. Even hosted
green proves only this one local valid-send formatting/logger assertion, not
broad provider behavior or an external-service boundary.

## Next Boundary

Turn 34 should audit Notification SendGrid's empty unit lane. Remove its
`jest --passWithNoTests src` script only after fresh discovery confirms zero
files and assertions. Preserve its Jest integration command/config/spec,
`@sendgrid/mail` dependency, source, and root/workflow ownership. Do not create
empty Vitest coverage, begin its integration shadow, change dependencies or the
lockfile, add CI, combine locking providers, or mix catalog/private-package work
into the unit-only decision.

## Notification SendGrid Empty Unit Lane Retirement

Commit:

- `ac345e53be` (`test: retire empty Notification SendGrid unit lane`)

Date verified: 2026-07-12.

### Difference From Original Medusa

`@medusajs/notification-sendgrid` inherited this unit command:

```text
test  jest --passWithNoTests src
```

Direct listing returns `[]`. The package command exits 0 with zero suites/tests
only because `--passWithNoTests` is present. Direct `jest src` without the flag
exits 1 after checking four files and reporting `Pattern: src - 0 matches`.

Goal baseline `8b02a0c77c` and current source trees are identical and contain
only `src/index.ts` plus `src/services/sendgrid.ts`. Scans find no `__tests__`,
spec/test file, assertion, test API, mock, fixture, or snapshot. Their
normalized-LF hashes are:

- `src/index.ts`:
  `f645f39a46863814f53cbed3e91c49f8255ebbf19b13a6e6c078cc81c5a2582a`;
- `src/services/sendgrid.ts`:
  `45fe35339429262ece0bd2df3080ad0c3f1d2bddf522c2c5d8c7244b10fcb443`.

Turn 34 removes only the empty `test` manifest key. It adds no empty Vitest
replacement and no Jest rollback for a lane with nothing to roll back. The
separate integration command stays byte-identical and Jest-authoritative:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

The Jest config, integration spec, package source, `@sendgrid/mail: ^8.1.6`
dependency, framework dev/peer edges, build/watch commands, metadata, lockfile,
root scripts, workflow, and persistent tooling contract remain unchanged.

### Integration Ownership Stability

Pre/post normalized reporters match exactly:

| Runner             | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ------------------ | ----: | -----: | -----: | ------: | ---: | --------: |
| Before unit retire |     1 |      0 |      0 |       5 |    0 |         0 |
| After unit retire  |     1 |      0 |      0 |       5 |    0 |         0 |

The exact pending names and order remain:

1. `Sendgrid notification provider sends an email with the specified template`;
2. `Sendgrid notification provider sends an email with the specified email body`;
3. `Sendgrid notification provider throws an exception if the subject is not present for html content`;
4. `Sendgrid notification provider throws an exception if the template does not exist`;
5. `Sendgrid notification provider throws an exception if the to email is not valid`.

The spec retains five `it`/`expect` pairs, `jest.setTimeout(100000)`, one
`beforeAll`, one pre-existing `as any`, and top-level `describe.skip` ownership.
Authentic Jest integration shards remain five skipped/zero/zero. A diagnostic
without `--forceExit`, using `--detectOpenHandles`, exits naturally with no
open-handle report. This proves only skipped import/collection, not live
request cleanup.

The four latent variables are all absent locally:

- `SENDGRID_TEST_API_KEY`;
- `SENDGRID_TEST_FROM`;
- `SENDGRID_TEST_TEMPLATE`;
- `SENDGRID_TEST_TO`.

Because the entire suite is skipped, `beforeAll`, variable reads, service
construction, SendGrid singleton API-key mutation, assertions, and HTTP requests
do not execute. If manually enabled, all five cases call real SendGrid HTTPS;
the first two can deliver email and the remaining cases depend on exact remote
400 messages. No request interception, sandbox isolation, singleton reset, or
failure-safe cleanup exists. No delivery, error-response, credential, network,
or cleanup behavior is claimed.

Preserved normalized-LF hashes are:

- integration spec:
  `a4c687431dc46a9c8c535fe3ac13ac96eda8b7e8a39546288dad9bb2bc7695f8`;
- Jest config:
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- `tsconfig.json`:
  `444e89a6ca86a1e65c2000babbbf18f68fde9bfa1c78c676721d6e6c8e644166`.

### Task And Inventory Ownership

The general unit graph remains 83 nodes and moves from 66 executable/17 markers
to 65/18. The Corepack-invoked scoped root command executes zero tasks, while
the scoped Turbo graph retains `@medusajs/notification-sendgrid#test` as
`<NONEXISTENT>`. Framework/Utils serial units remain 2/2/0.

Fast/all integration graphs remain 51/32/19 and 63/44/19 and retain
Notification SendGrid exactly once on its unchanged Jest command.

The inventory first fails with exactly one removed entry and no additions:

```text
manifestScripts  @medusajs/notification-sendgrid  test  jest --passWithNoTests src
```

After accepting only that deletion, the digest becomes
`c508a382b600ddaf38321a536b4e4d3f252851777cf2e1d0c5e188b2d0f8516a`.
Manifest Jest scripts move 110 to 109. Script owners remain 68 because the
package retains integration ownership. Active configs and API files remain 68
and 406; every other inventory count is unchanged.

### Validation

- exact unit listing/zero-run/no-pass failure and baseline source-tree proof
  pass;
- pre/post integration reporters, exact names/statuses, authentic shards, and
  the no-force diagnostic remain stable;
- package build, frozen offline install, workspace dependency policy, scoped
  root behavior, all four graph shapes, exact inventory, formatting, and hashes
  pass;
- the complete 267.7-second foundation passes strict tooling, eight tooling
  tests, five-file shared parity, all 25 integration selectors, real Jest/Vitest
  adapter execution, exact three-file/34-test parity, and the reviewed
  inventory.

### Accepted Boundary

This is retirement of nonexistent unit coverage, not Vitest parity, integration
migration, or a package-default switch. It changes no integration assertion,
source, config, dependency, lockfile, root script, workflow, persistent tooling
contract, persistence, production runtime, workerd, D1, or Cloudflare bundle.

No new hosted result is applicable or claimed. The generic hosted integration
lane remains Jest and still collects five skipped cases; even a hosted green
result would not prove live SendGrid behavior.

## Notification SendGrid Integration Vitest Shadow

Commit:

- `1e68aa8b1f` (`test: add Notification SendGrid integration Vitest shadow`)

Date verified: 2026-07-12.

### Difference From Original Medusa

`@medusajs/notification-sendgrid` adds one opt-in command:

```text
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The package-root `vitest.integration.config.mts` uses
`defineNodeVitestIntegrationConfig` with:

- the standard `@models`, `@services`, `@repositories`, `@types`, and `@utils`
  aliases;
- only `integration-tests/__tests__/services.spec.ts` in its include list;
- the shared serial Node integration profile, which supplies one worker,
  disabled file/concurrent execution, Node environment, ordered hooks/setup,
  the Jest compatibility bridge, integration environment setup, and
  `passWithNoTests: false`.

The authoritative package command remains byte-identical:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

No assertion, skip, source, Jest config, tsconfig, dependency, lockfile, root
script, workflow, persistent tooling contract, or production behavior changes.
Fresh npm-registry and local CLI reads agree on Vite 8.1.4 and Vitest 4.1.10,
so the shadow executes on the repository's Vite 8 built-in Rolldown baseline.

### Exact Reporter And Import Parity

The reusable repository comparator normalizes Jest's `pending` and Vitest's
`skipped` statuses and derives file counts instead of trusting incompatible raw
suite counters. Fresh reporters prove:

| Runner             | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ------------------ | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest before shadow |     1 |      0 |      0 |       5 |    0 |         0 |
| Jest after shadow  |     1 |      0 |      0 |       5 |    0 |         0 |
| Vitest shadow      |     1 |      0 |      0 |       5 |    0 |         0 |

All five full names, ancestor titles, titles, and statuses match. The
unsharded Vitest package script exits naturally with one skipped file and five
skipped tests; it has no force-exit option.

`@sendgrid/mail` 8.1.6 has no package `type` and declares `main: index.js`, so
this is a CommonJS default-import boundary. A native ESM probe exposes both
`setApiKey` and `send` as functions. More importantly, Vitest transforms the
unchanged `import sendgrid from "@sendgrid/mail"` service and imports it during
spec collection without an interop error. Because construction occurs only in
the skipped `beforeAll`, this proof does not mutate the SendGrid singleton.

Authentic shard behavior remains intentionally asymmetric:

- Jest `/3`: five skipped/zero/zero, with every shard exiting 0 through the
  preserved `--passWithNoTests`;
- Vitest `/3`: all three runs exit 1 with
  `--shard <count> must be a smaller than count of test files` after resolving
  one file. No shard silently succeeds without coverage.

### External-Service Boundary

The unchanged spec retains top-level `describe.skip`, five `it`/`expect` pairs,
`jest.setTimeout(100000)`, one `beforeAll`, and one pre-existing `as any`. The
following process variables are absent:

- `SENDGRID_TEST_API_KEY`;
- `SENDGRID_TEST_FROM`;
- `SENDGRID_TEST_TEMPLATE`;
- `SENDGRID_TEST_TO`.

Neither runner executes variable reads, service construction, `setApiKey`, an
assertion, an HTTPS request, email delivery, remote 400 handling, or cleanup.
If deliberately enabled later, the first two cases can send real email and the
last three depend on exact remote error text without interception, isolation,
singleton reset, or failure-safe cleanup. This turn claims only import,
collection, and skip parity.

### Preserved Hashes And Ownership

Normalized-LF SHA-256 remains:

- integration spec:
  `a4c687431dc46a9c8c535fe3ac13ac96eda8b7e8a39546288dad9bb2bc7695f8`;
- Jest config:
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- tsconfig:
  `444e89a6ca86a1e65c2000babbbf18f68fde9bfa1c78c676721d6e6c8e644166`;
- `src/index.ts`:
  `f645f39a46863814f53cbed3e91c49f8255ebbf19b13a6e6c078cc81c5a2582a`;
- `src/services/sendgrid.ts`:
  `45fe35339429262ece0bd2df3080ad0c3f1d2bddf522c2c5d8c7244b10fcb443`.

The new canonical Vitest config is normalized-LF SHA-256
`3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`.

Production `@sendgrid/mail: ^8.1.6` still resolves 8.1.6. Framework dev/peer
edges remain `workspace:*`. A frozen offline install reports all 86 workspaces
up to date and preserves raw lock SHA-256
`40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.

### Task And Inventory Ownership

The scoped root unit command still selects SendGrid and executes zero tasks;
the scoped dry graph retains `@medusajs/notification-sendgrid#test` as
`<NONEXISTENT>`. General and Framework/Utils unit graphs remain 83/65/18 and
2/2/0.

Fast/all integration graphs remain 51/32/19 and 63/44/19. Each owns SendGrid
exactly once on the unchanged Jest command. The new opt-in script enters no
Turbo root command, workflow job, shard, or aggregate gate.

The remaining-Jest inventory remains exact at digest
`c508a382b600ddaf38321a536b4e4d3f252851777cf2e1d0c5e188b2d0f8516a`:
68 configs, 109 scripts across 68 owners, and 406 active API files. The added
Vitest script/config does not add, move, or remove Jest ownership.

### Validation

- exact pre/post Jest and Vitest reporter parity, full-name/status comparison,
  natural exit, CommonJS import, credential absence, and shard behavior pass;
- package build and a one-shot strict/no-unchecked config typecheck pass;
- frozen offline install, workspace dependency policy, scoped/general/serial/
  integration graphs, exact inventory, and protected-hash checks pass;
- the complete 237.4-second foundation passes strict tooling, eight tooling
  tests, five-file shared parity, all 25 integration selectors, real Jest/
  Vitest adapter execution, exact three-file/34-test parity, and the reviewed
  inventory.

### Accepted Boundary

This is an opt-in shadow only. Jest remains authoritative in the package, both
root integration graphs, and the existing hosted matrix. No root/workflow or
hosted result changes, and prior hosted confirmations remain deferred. A green
shadow proves no SendGrid delivery, remote-error, credential, network-cleanup,
persistence, production-runtime, workerd, D1, or Cloudflare behavior.

## Notification SendGrid Integration Vitest Cut-Over

Commit:

- `4dc562a1e3` (`test: switch Notification SendGrid integration to Vitest`)

Date verified: 2026-07-12.

### Difference From Original Medusa

`@medusajs/notification-sendgrid` now owns:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

The temporary `test:integration:vitest` key is removed. The Vitest command is
byte-identical to the proven shadow and the Jest rollback is byte-identical to
the previous default. No assertion or test API is rewritten, so the compatibility
bridge remains necessary for `jest.setTimeout(100000)` while rollback remains.

The existing typed package-integration contract passed all eight tooling tests
before extension. Turn 36 added SendGrid expectations first; the focused run
then failed exactly because the root fast command lacked the SendGrid
exclusion. After package/root/workflow implementation, the same contract and
strict tooling typecheck pass. The extension adds no explicit `any`, cast,
enum, suppression, or weak unvalidated I/O shape.

### Default And Rollback Parity

The repository comparator proves all relevant pairs:

| Runner/state         | Files | Passed | Failed | Skipped | Todo | Snapshots |
| -------------------- | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest before cut-over |     1 |      0 |      0 |       5 |    0 |         0 |
| Vitest shadow before |     1 |      0 |      0 |       5 |    0 |         0 |
| Jest rollback after  |     1 |      0 |      0 |       5 |    0 |         0 |
| Vitest default after |     1 |      0 |      0 |       5 |    0 |         0 |

All five full names, ancestor titles, titles, and normalized statuses remain
exact. The unsharded default exits naturally at one skipped file/five skipped
tests. Jest rollback remains five/zero/zero across `/3`, with all shards exiting
0 through `--passWithNoTests`. Each Vitest `/3` run exits 1 before import with
the one-file shard-count error, so no empty shard is accepted silently.

A Jest diagnostic without `--forceExit` still exits naturally under
`--detectOpenHandles` and emits no open-handle report. The retained force-exit
warning is inherited command behavior, not evidence of a leak.

### External-Service Boundary

The spec remains top-level `describe.skip` with five `it`/`expect` pairs,
`jest.setTimeout(100000)`, one `beforeAll`, and one pre-existing `as any`.
`SENDGRID_TEST_API_KEY`, `SENDGRID_TEST_FROM`, `SENDGRID_TEST_TEMPLATE`, and
`SENDGRID_TEST_TO` are absent.

Both runners import the unchanged service and register skipped cases. Neither
executes the variable reads, constructor, `setApiKey`, an assertion, HTTPS
request, delivery, remote 400 handling, or cleanup. If enabled deliberately,
the first two cases can send real email and the last three depend on exact
remote response text with no request interception, isolation, singleton reset,
or failure-safe cleanup. Default migration proves no live provider behavior.

### Preserved Files And Dependencies

Normalized-LF SHA-256 remains:

- integration spec:
  `a4c687431dc46a9c8c535fe3ac13ac96eda8b7e8a39546288dad9bb2bc7695f8`;
- Jest config:
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- Vitest config:
  `3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`;
- tsconfig:
  `444e89a6ca86a1e65c2000babbbf18f68fde9bfa1c78c676721d6e6c8e644166`;
- `src/index.ts`:
  `f645f39a46863814f53cbed3e91c49f8255ebbf19b13a6e6c078cc81c5a2582a`;
- `src/services/sendgrid.ts`:
  `45fe35339429262ece0bd2df3080ad0c3f1d2bddf522c2c5d8c7244b10fcb443`.

The permanent contract freezes the spec/Jest/Vitest runner artifacts and exact
package scripts/dependency edges. Source/tsconfig hashes remain turn-scoped so
later legitimate provider changes do not fail an unrelated workflow contract.

Production `@sendgrid/mail: ^8.1.6` still resolves 8.1.6. Framework dev/peer
edges remain `workspace:*`. The frozen offline install keeps raw lock SHA-256
`40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.

### Root And CI Ownership

The root fast-package command adds only
`--filter=!./packages/modules/providers/notification-sendgrid`. Its direct
graph moves from 51/32/19 to 50 total, 31 executable, and 19 markers, with no
SendGrid task. Slow remains byte-identical. The unsharded all-packages graph
stays 63/44/19 and owns exactly one
`@medusajs/notification-sendgrid#test:integration` command on Vitest. General
and Framework/Utils unit graphs remain 83/65/18 and 2/2/0.

The workflow adds runner-neutral `notification-sendgrid-integration` with:

- `needs: setup`, `ubuntu-latest`, and a ten-minute timeout;
- existing checkout, dependency-cache, and build-artifact download steps;
- exact unsharded execution through
  `pnpm --filter @medusajs/notification-sendgrid test:integration`;
- no job environment, services, strategy, matrix, shard, CPU probe, worker
  flag, credentials, or Jest/Vitest runner name.

The `integration-tests-packages` aggregate now depends on the dedicated job,
fails for its failure/cancelled/skipped states, requires its success, and
retains `if: ${{ always() }}`. The local exact job command passes at one file/
five skips.

The SendGrid Vitest config is appended exactly once to persistent strict
tooling typecheck. The existing contract parses the root/package manifests and
workflow YAML, then protects package default/rollback/shadow absence,
dependency edges, exact fast/slow/all commands, immutable hashes, the complete
four-step job, runner-neutral name, absent optional boundaries, aggregate
dependencies, and every terminal-state condition.

### Remaining-Jest Ownership

Before acceptance, the checker reports exactly one removed and one added entry:
the byte-identical Jest command moves from `test:integration` to
`test:integration:jest`. Every summary count is unchanged. After accepting
only that move, digest becomes
`ccf3ead2e047791b66e16c98d2e178a021b639e9719278366338677300f46404`.

Counts remain 68 active configs, 109 scripts across 68 owners, 406 active API
files, 11 Jest dependency entries across four owners, three foundation
invocation files, and one root/CI invocation owner.

### Validation

- contract green/red/green proof, strict tooling typecheck, and all eight
  tooling tests pass;
- all reporter comparisons, names/statuses, exact default/rollback commands,
  natural exit, Jest/Vitest shards, no-force diagnostic, dependency resolution,
  environment absence, and preserved hashes pass;
- package build, frozen offline install, workspace dependency policy, exact
  inventory, and scoped/general/serial/fast/all graph checks pass;
- the complete 234.4-second foundation passes five-file shared parity, all 25
  integration selectors, real Jest/Vitest adapter execution, exact three-file/
  34-test parity, and the reviewed inventory.

### Accepted Boundary

This is a local default switch with exact rollback, not live SendGrid proof.
Local YAML parsing, typed contract execution, graph inspection, and exact job
command prove the workflow shape. They do not prove GitHub scheduling,
checkout/cache/artifact restoration, aggregate execution, or provider network
behavior. Hosted confirmation remains deferred until publication.

No dependency, lockfile, assertion, source, persistence, production-runtime,
workerd, D1, or Cloudflare bundle change occurs. The new job owns only the
wholly skipped integration collection boundary.

## Locking Postgres Empty Unit Lane Retirement

Commit:

- `91a6b91fc8` (`test: retire empty Locking Postgres unit lane`)

Date verified: 2026-07-12.

### Difference From Original Medusa

`@medusajs/locking-postgres` inherited:

```text
test  jest --passWithNoTests src
```

Direct listing returns `[]`. The package command exits 0 with no suites/tests
only because `--passWithNoTests` is present. Direct `jest src` exits 1 after
checking eight package files and reports `Pattern: src - 0 matches`.

Goal baseline `8b02a0c77c` and current source trees are identical at six
tracked files:

- `src/index.ts`;
- `src/migrations/.snapshot-medusa-locking-postgres.json`;
- `src/migrations/Migration20241009222919_InitialSetupMigration.ts`;
- `src/models/index.ts`;
- `src/models/locking.ts`;
- `src/services/advisory-lock.ts`.

There is no source test/spec file, `__tests__`, test API, assertion, mock,
fixture, or snapshot. Turn 37 removes only the empty `test` key. It adds no
empty Vitest replacement and no rollback for a lane with nothing to roll back.

The separate integration remains Jest-authoritative and byte-identical:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

Watch, build, alias-resolution, migration/ORM commands, package metadata,
framework dev/peer edges, source, migration snapshot, integration spec, Jest
config, tsconfig, MikroORM CLI config, root scripts, workflow, and lockfile are
unchanged.

### Integration Ownership And PostgreSQL Boundary

The unchanged specification has five ordinary `it`, one `it.skip`, 24
`expect`, five `jest.fn`, one `jest.setTimeout`, two pre-existing `any[]`, and
zero snapshots. It boots the real Locking module with the Postgres advisory
lock provider and exercises:

- unlocked oversell versus serialized execution under a key;
- owner-aware acquire and release;
- repeated and competing parallel acquisition;
- release after a callback failure.

The skipped timeout case remains skipped. This is a real MikroORM/PostgreSQL
integration boundary, not PGlite, D1, workerd, Redis, or Cloudflare coverage.

Validation used PostgreSQL 18.3 in a separate trust-auth cluster at
`127.0.0.1:55437` under the system temporary directory. The installed Windows
service was neither started, stopped, nor reconfigured.

The first exact run against an empty cluster exposed an existing lifecycle
precondition. The shared module connection targets deterministic
`medusa-locking-integration-1` before MikroORM's automatic ensure/create step;
the server logged the missing database and the client pool returned
`ECONNRESET`, producing five secondary failures. The server itself stayed
healthy. After pre-creating only that deterministic database, the unchanged
suite passed consistently.

Fresh normalized reporters prove:

| State       | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ----------- | ----: | -----: | -----: | ------: | ---: | --------: |
| Before edit |     1 |      5 |      0 |       1 |    0 |         0 |
| After edit  |     1 |      5 |      0 |       1 |    0 |         0 |

All six names and statuses match. The exact package command passes. A direct
run without `--forceExit` and with `--detectOpenHandles` exits naturally with
no open-handle report. Authentic `/3` shards are five passed plus one skipped/
zero/zero, and all exit 0 through the unchanged `--passWithNoTests` behavior.

After validation there were no active test connections. The temporary cluster
was stopped and its verified temporary directory removed.

### Preserved Hashes

Normalized-LF SHA-256 remains:

- integration spec:
  `bcf123f16de0e98047fd7d15ffa51ea176231c3ac8407f9c66d3094cfd5a8db6`;
- Jest config:
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- tsconfig:
  `444e89a6ca86a1e65c2000babbbf18f68fde9bfa1c78c676721d6e6c8e644166`;
- MikroORM CLI config:
  `f68987173a0169cd2fa96373b78979b570a88b4ed82216f4849b7b38ff8d9f89`;
- source entrypoint:
  `dadc352d43e3dd9780aed6bfbfb5c8a951a945740e1cfab41c1f30dcb9d72939`;
- migration snapshot:
  `4a868b43657742a61ac8f2267f5b9bebbc97a1b71a297fdda208ee5b4674a596`;
- migration:
  `a7781015f48a4432bc2197eb2bbcc346c988dec748bff9bf4aec65967bdcc71a`;
- model barrel:
  `9949ac5e8e49f5b46fb5cc1f1020f7c3dca6d9ac41e17f734fadf1adbb6d85c4`;
- locking model:
  `7526c2a023631530dc8b67c8593eca093ec27c51d4355735fdb8c6ba37021f49`;
- advisory-lock service:
  `2d5025ff54b9b1619b411503692f56c0179d97ee62c0a843fce5d3870f821c19`.

### Task And Inventory Ownership

Before removal, the correctly filtered root command executes one empty Jest
task. After removal it selects Locking Postgres, executes zero tasks, and exits 0. The scoped dry graph retains
`@medusajs/locking-postgres#test: <NONEXISTENT>`.

General units remain 83 nodes and move 65 executable/18 markers to 64/19.
Framework/Utils serial units remain 2/2/0. Fast/all integration graphs remain
50/31/19 and 63/44/19 and own Locking Postgres exactly once on unchanged Jest.

The inventory first reports exactly one removal and no addition:

```text
manifestScripts  @medusajs/locking-postgres  test  jest --passWithNoTests src
```

After accepting only that deletion, digest becomes
`2f4d7d288d2921136018774ca486b6bceacbef18716e43599384c355a413c2e1`.
Manifest Jest scripts move 109 to 108. Owners remain 68 because the package
retains integration ownership; active configs and API files remain 68 and 406.

### Validation

- zero-unit listing/package/no-pass proof and baseline/current source-tree
  comparison pass;
- isolated PostgreSQL precondition diagnosis, exact package command, pre/post
  reporter comparison, authentic shards, no-force diagnostic, and safe cluster
  cleanup pass;
- package build including alias resolution, frozen offline install, workspace
  dependency policy, scoped/general/serial/integration graphs, protected hashes,
  formatting, and exact inventory pass;
- the complete 260.5-second foundation passes strict tooling, eight tooling
  tests, five-file shared parity, all 25 integration selectors, real Jest/
  Vitest adapters, exact three-file/34-test parity, and the reviewed inventory.

### Accepted Boundary

This is retirement of nonexistent unit coverage, not Vitest parity or an
integration/default migration. It changes no source, integration assertion,
migration, config, dependency, lockfile, alias/build/watch command, root,
workflow, persistence implementation, production runtime, workerd, D1, or
Cloudflare bundle.

The PostgreSQL prerequisite is an existing validation-environment condition,
not a new repository behavior. No hosted result is applicable or claimed.

## Locking Postgres Integration Vitest Shadow

Commit:

- This commit (`test: add Locking Postgres integration Vitest shadow`)

Date verified: 2026-07-12.

### Difference From Original Medusa

`@medusajs/locking-postgres` adds an opt-in runner only:

```text
test:integration         jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The exact Jest command remains authoritative. The new package-root config uses
`defineNodeVitestIntegrationConfig`, five standard aliases, the serial
one-worker Node integration profile, and only
`integration-tests/__tests__/index.spec.ts`.

Installed and live npm-registry `latest` values both report Vite 8.1.4 and
Vitest 4.1.10. The existing root toolchain is reused; there is no dependency,
catalog, importer, override, or lockfile change.

### Source-Resolution Compatibility Decision

The planned byte-identical `require.resolve("../../src")` path is not a valid
Vitest compatibility claim:

1. native `require.resolve("../../src")` fails before collection because Node
   does not directory-resolve `src/index.ts`;
2. rewriting only to `../../src/index.ts` collects the file but the built CJS
   Medusa loader then native-loads the TypeScript entry outside Vite and fails
   on its extensionless source imports;
3. statically importing the provider export lets Vite load the source graph and
   collect all six tests, but the current dynamic internal loader skips a
   `ModuleProviderExports` object that owns `services`, so the actual provider
   registration is absent and all five active tests fail.

No partial shared AST resolver, native TypeScript require hook, global loader
mutation, or core module-loader change is accepted in this package shadow.
Those mechanisms would either preserve only the first lookup, bypass Vite, or
silently broaden a test-runner turn into module/runtime architecture.

The accepted assertion-neutral plumbing change is:

```text
resolve: require.resolve("@medusajs/locking-postgres")
```

A clean package build immediately precedes validation. The name resolves to the
declared workspace production entry `dist/index.js`, whose default export owns
module `locking` and `PostgresAdvisoryLockProvider`. Post-edit Jest and Vitest
therefore execute the same fresh production entry. The pre-edit Jest source run
remains the behavioral comparison baseline.

This intentionally changes the spec's normalized-LF SHA-256 from
`bcf123f16de0e98047fd7d15ffa51ea176231c3ac8407f9c66d3094cfd5a8db6`
to `027b840cb2e10e1d9286456a430c30f2df7f8b69bb1a8b87cc5b9253e09b3b8d`.
Every assertion/test API is unchanged: five ordinary `it`, one `it.skip`, 24
`expect`, five `jest.fn`, one `jest.setTimeout`, two pre-existing `any[]`, six
full names, and zero snapshots.

The canonical new config hash is
`69b01480ab6cce348730a134543f7c5ef37a29f23f55f54e787cac831d7eb632`.
Preserved normalized hashes are:

- Jest config:
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- tsconfig:
  `444e89a6ca86a1e65c2000babbbf18f68fde9bfa1c78c676721d6e6c8e644166`;
- MikroORM CLI config:
  `f68987173a0169cd2fa96373b78979b570a88b4ed82216f4849b7b38ff8d9f89`;
- six source/migration files:
  `dadc352d43e3dd9780aed6bfbfb5c8a951a945740e1cfab41c1f30dcb9d72939`,
  `4a868b43657742a61ac8f2267f5b9bebbc97a1b71a297fdda208ee5b4674a596`,
  `a7781015f48a4432bc2197eb2bbcc346c988dec748bff9bf4aec65967bdcc71a`,
  `9949ac5e8e49f5b46fb5cc1f1020f7c3dca6d9ac41e17f734fadf1adbb6d85c4`,
  `7526c2a023631530dc8b67c8593eca093ec27c51d4355735fdb8c6ba37021f49`,
  and `2d5025ff54b9b1619b411503692f56c0179d97ee62c0a843fce5d3870f821c19`.

### PostgreSQL And Exact Parity

Validation used one isolated PostgreSQL 18.3 trust-auth cluster at
`127.0.0.1:55438`. The installed `postgresql-x64-18` service remained running
at its original process and was never reconfigured, restarted, or stopped.

Runner-aware module database names differ by design. Both must exist before
the shared pool initializes:

- Jest: `medusa-locking-integration-1`;
- Vitest: `medusa-locking-integration-vitest-1`.

`DB_TEMP_NAME` controls a different setup boundary and cannot replace these
module-runner names.

Fresh normalized reporters prove:

| Runner                         | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ------------------------------ | ----: | -----: | -----: | ------: | ---: | --------: |
| Pre-edit Jest on source        |     1 |      5 |      0 |       1 |    0 |         0 |
| Post-edit Jest on fresh `dist` |     1 |      5 |      0 |       1 |    0 |         0 |
| Opt-in Vitest on fresh `dist`  |     1 |      5 |      0 |       1 |    0 |         0 |

All three pairwise comparisons preserve the exact file, normalized full names
and statuses, counts, and snapshot state. The real suite still exercises
MikroORM/PostgreSQL module bootstrap, advisory-lock serialization,
acquire/release ownership, parallel calls, and failure cleanup.

Direct Vitest exits naturally. The bridge executes `jest.setTimeout` and the
two active `jest.fn` calls. The skipped timeout test remains collected and
reported, but its three mock-creation calls are never invoked. The exact Jest
package command passes; a separate no-force `--detectOpenHandles` run exits
naturally without an open-handle report.

Authentic Jest `/3` shards are five passed plus one skipped/zero/zero, all with
exit 0. Each real Vitest `/3` run exits 1 before import because one discovered
file cannot satisfy three shards. Unsharded `vitest list --json` returns the
five runnable test names; the skipped test is correctly absent from list output
but present in the reporter.

After every real run, both databases have zero active test connections. The
cluster is stopped and only its verified temporary parent is removed. Removing
that completed cluster reclaimed about 0.8 GB; the installed service remains
untouched.

### Task, Inventory, And Validation Ownership

The new opt-in key has no root or workflow owner. Dry graphs remain:

- scoped unit: 1/0/1 with Locking Postgres `<NONEXISTENT>`;
- general units: 83/64/19;
- Framework/Utils units: 2/2/0;
- fast integrations: 50/31/19;
- all integrations: 63/44/19.

Both integration graphs own Locking Postgres exactly once on its unchanged Jest
command. Task input hashes change legitimately because the manifest/config/spec
are package inputs; graph topology and command ownership do not.

The remaining-Jest inventory stays byte-identical at digest
`2f4d7d288d2921136018774ca486b6bceacbef18716e43599384c355a413c2e1`,
68 active configs, 108 scripts across 68 owners, and 406 active API files. The
new Vitest script/config and assertion-neutral resolver string add no Jest
ownership.

Validation passes:

- clean package build plus alias resolution and production-entry inspection;
- standalone strict/no-unchecked config typecheck with no new `any`, enum,
  assertion, suppression, or weak boundary;
- pre/post/Vitest reporters and all pairwise normalizer comparisons;
- exact Jest default, direct Vitest, no-force Jest, unsharded list, Jest shards,
  fail-closed Vitest shards, and zero PostgreSQL connections;
- frozen offline install, all 86 workspace dependency checks, five graph
  shapes, protected hashes, formatting, diff hygiene, and exact inventory;
- the first complete-foundation attempt reached the PGlite Vitest child and
  exited 1 while C: had about 2.1 GB free. After the completed temporary
  PostgreSQL cluster was safely removed, the focused adapter passed in 176.2
  seconds and the full aggregate passed in 262.7 seconds: strict tooling, eight
  tooling tests, five-file parity, all 25 selectors, real Jest/Vitest adapters,
  exact three-file/34-test parity, and exact inventory.

### Accepted Boundary

This is an opt-in runner shadow and a production-entry test bootstrap change,
not a default switch or provider/runtime migration. It preserves every Medusa
assertion and PostgreSQL behavior while honestly dropping the disproven claim
that Vitest executes this provider through raw source-directory resolution.

No shared runner helper, module loader, production source, migration, Jest
config, dependency, lockfile, root script, workflow, persistent CI contract,
workerd, D1, or Cloudflare bundle changes. The unchanged shared foundation
regression-revalidates its existing PGlite adapter, but no Locking Postgres
PGlite, Redis, Cloudflare, or hosted CI behavior is claimed.

## Locking Postgres Integration Vitest Cut-Over

Commit:

- This commit (`test: switch Locking Postgres integration to Vitest`)

Date verified: 2026-07-12.

### Difference From Original Medusa

`@medusajs/locking-postgres` now assigns the unchanged integration suite to
Vitest by default while retaining the exact Jest command as its rollback lane:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

The temporary `test:integration:vitest` key is removed and the retired empty
unit `test` key remains absent. The package-root config, five aliases, sole
`index.spec.ts`, production-entry resolver, Jest config, and shared serial
one-worker integration profile remain byte-identical.

The installed and live npm-registry `latest` values still agree on Vite 8.1.4
with its built-in Rolldown pipeline and Vitest 4.1.10. The package continues to
consume the hoisted root toolchain; no dependency or lockfile change is needed.

Every behavioral artifact remains unchanged: five ordinary `it`, one
`it.skip`, 24 `expect`, five `jest.fn`, one `jest.setTimeout`, two pre-existing
`any[]`, the six exact full names/statuses, and zero snapshots. Both runners
continue to resolve the freshly built `@medusajs/locking-postgres` production
entry at `dist/index.js`; no raw-source loader, AST transform, require hook, or
module-loader behavior changes.

### PostgreSQL And Exact Parity

Validation used a separate PostgreSQL 18.3 trust-auth cluster at
`127.0.0.1:55439`. The runner-specific databases were pre-created before pool
startup:

- Jest: `medusa-locking-integration-1`;
- Vitest: `medusa-locking-integration-vitest-1`.

The installed `postgresql-x64-18` service remained running and was never
reconfigured, restarted, or stopped. After validation, both databases reported
zero active test connections, the isolated cluster was stopped, and only its
verified temporary directory was removed.

Fresh normalized reporters prove exact three-way parity:

| Runner                 | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ---------------------- | ----: | -----: | -----: | ------: | ---: | --------: |
| Committed-default Jest |     1 |      5 |      0 |       1 |    0 |         0 |
| Rollback Jest          |     1 |      5 |      0 |       1 |    0 |         0 |
| Default Vitest         |     1 |      5 |      0 |       1 |    0 |         0 |

All pairwise comparisons preserve the exact file, full names, statuses,
counts, and snapshot state. The unsharded default exits naturally, the exact
rollback command passes, and the no-force `--detectOpenHandles` Jest diagnostic
also exits naturally without an open-handle report.

Authentic Jest `/3` rollback shards remain five passed plus one skipped, zero,
and zero, with all three commands exiting 0. Each real Vitest `/3` invocation
continues to fail closed with exit 1 before import because the one-file lane
cannot satisfy three shards. Unsharded Vitest list output contains the five
runnable names; the unchanged skipped timeout test remains absent from list
output and present in the full reporter.

### Root And Workflow Ownership

The persistent strict tooling command adds
`./packages/modules/providers/locking-postgres/vitest.integration.config.mts`
exactly once. The generic fast-package command adds only the Locking Postgres
exclusion; the slow and unsharded all-packages commands remain byte-identical.

The workflow adds dedicated `locking-postgres-integration` ownership with:

- `needs: setup`, Ubuntu, and a ten-minute timeout;
- the existing PostgreSQL image, `pg_isready` health policy, and mapped port
  5432;
- service initialization through
  `POSTGRES_DB=medusa-locking-integration-vitest-1` plus the existing PostgreSQL
  username/password convention;
- checkout, dependency-cache, and build-artifact download steps followed by
  the runner-neutral command
  `pnpm --filter @medusajs/locking-postgres test:integration`;
- explicit `DB_HOST`, `DB_PORT`, `DB_USERNAME`, and `DB_PASSWORD` on the run
  step;
- no strategy, matrix, shard, CPU probe, worker override, or runner name.

The downloaded build artifact is required because the assertion resolves the
package's declared `dist/index.js` production entry and shared setup resolves
the built test-worker identity. `POSTGRES_DB` creates the Vitest-default
database for this hosted job; exact Jest rollback parity remains a separately
proven local lane and is not executed by the dedicated workflow command.

The existing `integration-tests-packages` aggregate now needs this job and
propagates its failure, cancelled, skipped, and success states while retaining
`if: ${{ always() }}`. The strict typed contract protects the exact package and
root commands, one typecheck token, immutable spec/Jest/Vitest hashes, complete
PostgreSQL service/run-step shape, runner-neutral name, and aggregate
terminal-state propagation without adding an unsafe TypeScript boundary.

### Task, Inventory, And Validation Ownership

Dry ownership becomes:

- scoped unit: unchanged 1/0/1 with Locking Postgres `<NONEXISTENT>`;
- general units: unchanged 83/64/19;
- Framework/Utils serial units: unchanged 2/2/0;
- fast integrations: 50/31/19 to 49/30/19, with no Locking Postgres task;
- all integrations: unchanged 63/44/19, with Locking Postgres once on Vitest.

The remaining-Jest inventory accepts only the byte-identical command's key move
from `test:integration` to `test:integration:jest`. Counts remain 68 configs,
108 scripts across 68 owners, and 406 active API files. The reviewed digest is
`b30b0e5a8cd7ced2711fea1b34c52216ae8b3cf8b6acc5ebb97a55812fd4034b`.

Validation passes:

- package build plus alias resolution and production-entry inspection;
- strict tooling typecheck, all eight tooling tests, workflow parsing, and the
  expanded typed package/root/hash/job/aggregate contract;
- exact three-way reporters, pairwise comparison, default/rollback commands,
  natural/no-force exits, list, authentic shards, and zero retained PostgreSQL
  connections;
- frozen offline install, all 86 workspace dependency checks, protected hashes,
  five dry graphs, exact inventory, formatting, and diff hygiene;
- the complete 239.1-second foundation, including five-file shared parity, all
  25 integration selectors, real Jest/Vitest adapters, and exact
  three-file/34-test adapter parity.

### Accepted Boundary

This turn changes package, root, workflow, and typed-contract runner ownership;
it does not change a Medusa assertion, test name, skip, mock, timeout, snapshot,
provider implementation, migration, or production behavior. The integration
spec, Jest/Vitest configs, tsconfig, MikroORM config, all six source/migration
files, package metadata, version, and public/private state remain protected at
their Turn 38 hashes.

The package still has no production dependency and retains only
`@medusajs/framework: workspace:*` in both development and peer ownership. No
catalog, override, dependency, importer, package snapshot, or lockfile changes;
the raw lock SHA-256 remains
`40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.
Persistence semantics, production runtime, workerd, D1, the Cloudflare bundle,
and the existing shared PGlite foundation are unchanged. No Locking Postgres
PGlite, Redis, workerd, D1, or Cloudflare behavior is newly claimed.

The local YAML parse, typed contract, PostgreSQL execution, artifact-dependent
package command, and aggregate shape do not prove GitHub scheduling, service
startup, cache/artifact restoration, or aggregate execution. There was no
GitHub access; hosted CI confirmation remains explicitly deferred.

## Locking Redis Empty Unit Lane Retirement

Commit:

- This commit (`test: retire empty Locking Redis unit lane`)

Date verified: 2026-07-12.

### Difference From Original Medusa

`@medusajs/locking-redis` inherited an apparent unit command:

```text
test  jest --passWithNoTests src
```

Direct Jest listing produces no path. The exact package command exits 0 with
no suite or test only because `--passWithNoTests` is present. Direct
`jest --no-cache --runInBand src` exits 1 after checking six package files and
reports `Pattern: src - 0 matches`. Its one repository-wide `testMatch` match
is the separate integration spec outside `src`; it is not unit ownership.

Goal baseline `8b02a0c77c` and the pre-edit Turn 40 source tree are identical
at four tracked files:

- `src/index.ts`;
- `src/loaders/index.ts`;
- `src/services/redis-lock.ts`;
- `src/types/index.ts`.

There is no source spec/test file, `__tests__`, test API, assertion, mock,
fixture, or snapshot. Turn 40 therefore removes only the empty `test` manifest
key. It adds no empty Vitest substitute and no Jest rollback for a lane with
nothing to roll back. The post-removal normalized manifest hash is
`8c70c68f8f9f7ae9fb282eadb50c1d0bdb574286cef5d04aa8399e27c4141bac`.

The separate integration remains Jest-authoritative and byte-identical:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

The Jest config remains required for that active integration lane. Watch,
build, alias-resolution, package metadata, version/public state, tsconfig,
source, dependency ownership, lockfile, root scripts, workflow, and persistent
test-runner tooling remain unchanged. The separately stale `watch:test`
ownership is not folded into this unit decision.

### Integration Ownership And Redis Boundary

Unsharded Jest listing finds exactly
`integration-tests/__tests__/index.spec.ts`. The protected specification has
six `it`, 24 `expect`, five `jest.fn`, one `jest.setTimeout`, two pre-existing
`any[]`, and zero snapshots. It boots the real Locking module with the Redis
provider and exercises:

- unlocked oversell versus key-serialized execution;
- owner-aware acquisition and release;
- repeated and competing parallel acquisition;
- release after callback failure and timeout behavior.

The provider option uses `REDIS_URL` when supplied and otherwise targets
`redis://localhost:6379`. During Turn 40 there was no process, user, or machine
`REDIS_URL`; no `redis-server`, `redis-cli`, or Docker command; no Redis Windows
service or process; no listener on port 6379; and no successful TCP connection
to `127.0.0.1:6379`.

Accordingly, Turn 40 did not execute the integration suite and claims no local
Redis assertion parity, service startup, cleanup, timing, or production
behavior. The empty unit command does not import the provider or connect to
Redis, so its retirement proof remains valid without that external service.
The unchanged package-integration workflow still supplies a Redis container,
PING health check, and mapped port 6379 to the generic fast matrix, but no new
hosted result is claimed.

### Preserved Hashes And Dependency Ownership

Normalized-LF SHA-256 remains:

- integration spec:
  `a97ad9aac8520dbe551f9406af4e548a453454bc07b744abfe57e510e5dfa094`;
- Jest config:
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- tsconfig:
  `444e89a6ca86a1e65c2000babbbf18f68fde9bfa1c78c676721d6e6c8e644166`;
- source entrypoint:
  `52f165b1a0e6bcb9d2c9aab22305c4218498637bb1c34f46397d894de25e8e23`;
- loader:
  `c5ae2941bb5009ef6f09753d6fbdb866c1f228adfd96d599f4980f4fd6aa76b8`;
- Redis locking service:
  `66f49c9450e18953b0b12f8df11d1f104125742d398b1da2b4d863bfb7f60777`;
- options type:
  `b191f1d798e9444028e9a83d949edd453c00f5df017ea10d9c0a38ec66428261`.

The broader protected boundaries remain:

- root manifest:
  `ddea099bc0d49a4334d9809f2252c50fd9081b9757988fd09ceb7914bc3dd369`;
- workflow:
  `c745b0b3e49bac055e3eb8b2496701918657970f073f5ad21619eec678067411`;
- lockfile:
  `40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`;
- persistent tooling contract:
  `f7f5c9fb1dd36cb139a0753fe76c8eb9b6c22a8c8b87fb97a5959d44a427740b`.

`ioredis` remains a production dependency at manifest range `^5.4.1` and lock
resolution 5.8.2. `@medusajs/framework` remains `workspace:*` in both
development and peer ownership. No catalog, override, importer, package
snapshot, dependency, or lockfile change occurs.

### Task And Inventory Ownership

Before removal, the correctly filtered scoped root command executes one empty
Jest task. After removal it executes zero tasks while the scoped dry graph
retains `@medusajs/locking-redis#test: <NONEXISTENT>`.

Dry ownership becomes:

- scoped units: 1/0/1;
- general units: 83 total, 63 executable, 20 markers;
- Framework/Utils serial units: unchanged 2/2/0;
- fast integrations: unchanged 49/30/19, with Locking Redis once on Jest;
- all integrations: unchanged 63/44/19, with Locking Redis once on Jest.

The remaining-Jest inventory reports and accepts exactly one deletion:

```text
manifestScripts  @medusajs/locking-redis  test  jest --passWithNoTests src
```

No ownership entry is added. Its reviewed digest becomes
`fc107ce908df6f9a0ab7d2f9233f4360bf775fddcb2c2c105c62c685b13f62f1`.
Manifest Jest scripts move 108 to 107 while owners remain 68 because the same
package retains its Jest integration. Active configs remain 68 and active API
files remain 406.

### Validation

- direct unit list, exact package no-test behavior, direct no-pass failure,
  baseline/current source identity, integration listing, and protected hashes
  pass;
- the exact one-line manifest diff, scoped/general/serial unit graphs, fast/all
  integration graphs, and exact inventory delta pass;
- package build plus alias resolution, frozen offline install, and all 86
  workspace dependency-policy checks pass without changing the lockfile;
- formatting, diff hygiene, and the complete 235.5-second test-runner
  foundation pass.

No Redis process was started or machine service reconfigured for this turn.
The integration lane was deliberately not run, so the successful foundation
is not evidence of its six Redis-backed assertions.

### Accepted Boundary

This is retirement of nonexistent unit ownership, not Vitest parity, an
integration shadow, a default switch, or a Redis/provider migration. It
changes no Medusa assertion, test name, mock, timeout, pre-existing `any`,
source, config, dependency, lockfile, root command, workflow, tooling contract,
persistence implementation, production runtime, workerd, D1, or Cloudflare
bundle behavior.

The existing generic workflow's Redis service and Jest integration ownership
remain unchanged. Local service absence and hosted CI execution remain explicit
external-environment boundaries rather than silently weakened acceptance
criteria.

## Locking Redis Lifecycle Prerequisite

Commit:

- This commit (`fix: clean up Locking Redis test lifecycle`)

Date verified: 2026-07-12.

### Difference From Original Medusa

Turn 41 started as the planned Locking Redis Vitest shadow. A real isolated
Redis endpoint made assertion parity visible, but also exposed a prerequisite
that the old `--forceExit` command concealed. The unchanged six integration
cases passed on Jest and on temporary Vitest shadow plumbing, but the exact Jest
lane without `--forceExit` remained alive beyond bounded 30- and 90-second
watchdogs. Redis `CLIENT LIST` showed six idle `ioredis` 5.8.2 connections, and
Jest `--detectOpenHandles` identified two losing acquisition-timeout handles.

The temporary Vitest script, config, and production-entry resolver experiment
were fully reverted. Turn 41 is therefore a separate behavior-fix prerequisite,
not a shadow or runner migration. The accepted source differences are:

- `initModules` runs prepare-shutdown and shutdown in order for owned and
  injected shared connection paths, still attempts later cleanup after an
  earlier failure, then aggregates errors. It destroys a PostgreSQL connection
  only when the runner owns it. The PGlite path uses the same ordered helper;
- Locking forwards both lifecycle phases to configured providers through a
  strict hook guard. Hooks retain the provider as `this`, every provider is
  attempted, and failures are aggregated only after all hooks settle;
- the Redis provider disconnects its owned `ioredis` connection on shutdown;
- each `execute` acquisition receives a unique owner, aborts its losing
  `node:timers/promises` timeout, releases already acquired keys after failure,
  and releases an acquisition that completes after cancellation;
- the existing timeout error and six original integration cases remain
  unchanged. One additive deterministic case proves the losing timer is
  aborted, owners are execution-unique, a partial multi-key acquisition and a
  late acquisition are both released, and the timed-out job is never invoked;
- the authoritative package command remains Jest and removes only
  `--forceExit`:

```text
jest --passWithNoTests --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

The public Locking API, provider selection, ordinary acquisition/job/release
semantics, Jest config, tsconfig, dependencies, lockfile, root scripts, and
workflow ownership are unchanged. Production shutdown and timeout cleanup are
intentionally corrected.

### Regression And Type-Safety Boundaries

The lifecycle fixes have focused coverage without weakening existing tests:

- the test-utils unit suite proves prepare-shutdown finishes before shutdown and
  that shutdown is still attempted after prepare-shutdown fails;
- the existing Locking unit file proves regular-method hooks receive their
  provider and a first provider failure does not prevent the second cleanup;
- the existing Redis integration file retains all six original cases and adds
  only the late-acquisition cleanup regression;
- the hook boundary narrows structurally before reading or invoking `__hooks`;
  no new `any`, unchecked assertion, enum, or broad `unknown` is introduced.

Normalized-LF SHA-256 after the fix is:

- `init-modules.ts`:
  `f199c9b97d7f8ccf3136037da95a384780673a4448da9c3e11db6ea815d96388`;
- its existing unit file:
  `0051a23555ae61a48b19895bd83a0c70d04323604983157f93fafe718a8b91f7`;
- Locking module service:
  `42a4b191546ec951577c699325c8b5f13f0a4d65bbd3d27083819e208621435f`;
- its existing unit file:
  `8b933316aeaeb79f27f3a22be942702a3e4edef49d9856e38c6a98b53b7e7e83`;
- Redis provider:
  `8362276c3e88a06bfb42fd66e6dc14a732a59ebb30564995a4ac3bea945886b0`;
- expanded Redis integration spec:
  `a21bc0f7704304a2193af0df5d620de638264ffe1762bbf09d8705686d60a953`;
- Redis provider manifest:
  `86a6e86f4c04440f692aacb7270901847d11d97b859f769a92f0398b47974228`.

Jest config, tsconfig, raw lockfile, and root manifest remain respectively
`5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`,
`444e89a6ca86a1e65c2000babbbf18f68fde9bfa1c78c676721d6e6c8e644166`,
`40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`,
and `ddea099bc0d49a4334d9809f2252c50fd9081b9757988fd09ceb7914bc3dd369`.

### Isolated Redis Provenance And Cleanup

The machine had no Redis server/CLI, Docker, Podman, or WSL distribution. The
local proof used the third-party open-source `redis-windows` 8.8.0 development
release, not an official production Redis-on-Windows distribution:

- release:
  `https://github.com/redis-windows/redis-windows/releases/tag/8.8.0`;
- asset: `Redis-8.8.0-Windows-x64-msys2.zip`;
- verified SHA-256:
  `8af6fd6c4aac3e13ded36f249da8114b3be32df60ab589da7c3513aa8b1a86cd`.

It bound only `127.0.0.1:56379`, used logical database 15 and the existing
`medusa_lock:` namespace, disabled RDB/AOF persistence, and limited memory to
64 MB. After validation, database 15 reported zero keys, no namespaced key or
test socket remained, the server received `SHUTDOWN NOSAVE`, the extracted
asset and logs were deleted, and port 56379 was closed. No Windows service,
machine configuration, or project-repository remote was changed.

This service proves local Redis protocol, isolation, and lifecycle behavior. It
does not prove the repository workflow's Redis image/engine, production Redis,
or hosted GitHub Actions execution. The GitHub release download is recorded
above; no project-repository connector/remote access, push, or hosted run
occurred.

### Task, Inventory, And Validation

Task ownership remains:

- scoped units: 1/0/1;
- general units: 83/63/20;
- Framework/Utils serial units: 2/2/0;
- fast integrations: 49/30/19, with Locking Redis once on Jest;
- all integrations: 63/44/19, with Locking Redis once on Jest.

The exact remaining-Jest inventory changes only the Redis manifest command and
additive Jest API occurrences in the already active integration file. Counts
remain 68 configs, 107 scripts across 68 owners, and 406 active API files. The
reviewed digest is
`6fc3f7d4842045b671b2f344448c651b76e09c247064dca81837568db23a0b51`.

Local validation passes:

- affected builds for Locking, Locking Redis, and test-utils;
- Locking unit 2/2 and test-utils 45 passing / 28 skipped;
- Redis Jest 7/7 with exact default, `--detectOpenHandles`, and `/3` results
  7/0/0, all exiting naturally; database/key/socket cleanup is empty;
- the same Redis 7/7 result with PostgreSQL deliberately pointed at closed port
  1, proving Redis is the only live service for this file;
- unchanged in-memory Locking integration 6/6;
- Auth Emailpass Vitest default and Jest rollback 9/9 each;
- frozen offline install, all 86 workspace dependency checks, exact inventory,
  package builds, Cloudflare typecheck, composed 1,593-input import guard,
  runtime-source import guard, graph checks, formatting, and diff hygiene;
- the complete 233.6-second shared test-runner foundation after the final source
  and inventory changes.

Hosted execution remains deferred. This turn changes no root command, workflow,
CI service, dependency, lockfile, package privacy, catalog, repository merge,
persistence adapter, workerd, D1, or Cloudflare runtime composition.

## Locking Redis Integration Vitest Shadow

Commit:

- This commit (`test: add Locking Redis integration Vitest shadow`)

Date verified: 2026-07-12.

### Difference From Original Medusa

`@medusajs/locking-redis` adds one opt-in runner while retaining its exact
natural-exit Jest default:

```text
test:integration         jest --passWithNoTests --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The package-root `vitest.integration.config.mts` uses the shared serial Node
integration profile, five standard aliases, one worker, disabled file/test
concurrency, and only `integration-tests/__tests__/index.spec.ts`. The installed
toolchain is Vite 8.1.4 and Vitest 4.1.10. No dependency, catalog, importer,
override, or lockfile changes.

### Production-Entry Resolver Decision

The pre-edit harness used:

```text
resolve: require.resolve("../../src")
```

That native Node lookup cannot directory-resolve the TypeScript package entry
under Vitest, and configuration aliases cannot intercept `require.resolve`.
Loading `src/index.ts` still sends the dynamic Medusa loader outside Vite for
extensionless source imports. Turn 42 therefore follows the accepted Locking
Postgres boundary:

```text
resolve: require.resolve("@medusajs/locking-redis")
```

A clean package build precedes post-edit validation. The workspace name resolves
to `packages/modules/providers/locking-redis/dist/index.js`, so the six module-
service cases bootstrap the same fresh production package under post-edit Jest
and Vitest. The additive timer/late-acquisition case still statically imports
the provider source through each runner. The pre-edit Jest source-resolver run
remains the behavioral baseline; no test assertion or production source changes.

Normalized-LF hashes are:

- spec before resolver edit:
  `a21bc0f7704304a2193af0df5d620de638264ffe1762bbf09d8705686d60a953`;
- spec after resolver edit:
  `71ba55deaa77220ed6bb4ce47751d5099c10255b0ec76ca77be5a1de21ae7ab7`;
- manifest before shadow key:
  `86a6e86f4c04440f692aacb7270901847d11d97b859f769a92f0398b47974228`;
- manifest with shadow key:
  `a44b3fa8762e1e767cb9404d342502e410b9cb5e87c5682e819aac84bc1b8c25`;
- canonical new Vitest config:
  `69b01480ab6cce348730a134543f7c5ef37a29f23f55f54e787cac831d7eb632`.

The sole spec still owns seven ordinary `it`, 36 textual `expect`, eight
`jest.fn`, one `jest.spyOn`, one `jest.setTimeout`, two inherited `any[]`, and
zero skips, todos, or snapshots. The bridge executes those Jest APIs unchanged;
there is no `vi` import or test-API rewrite.

Preserved normalized hashes include:

- Jest config:
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- tsconfig:
  `444e89a6ca86a1e65c2000babbbf18f68fde9bfa1c78c676721d6e6c8e644166`;
- package entry:
  `52f165b1a0e6bcb9d2c9aab22305c4218498637bb1c34f46397d894de25e8e23`;
- loader:
  `c5ae2941bb5009ef6f09753d6fbdb866c1f228adfd96d599f4980f4fd6aa76b8`;
- Redis provider:
  `8362276c3e88a06bfb42fd66e6dc14a732a59ebb30564995a4ac3bea945886b0`;
- provider options:
  `b191f1d798e9444028e9a83d949edd453c00f5df017ea10d9c0a38ec66428261`;
- shared lifecycle helper:
  `f199c9b97d7f8ccf3136037da95a384780673a4448da9c3e11db6ea815d96388`;
- Locking service:
  `42a4b191546ec951577c699325c8b5f13f0a4d65bbd3d27083819e208621435f`;
- root manifest, workspace file, workflow, and lockfile:
  `ddea099bc0d49a4334d9809f2252c50fd9081b9757988fd09ceb7914bc3dd369`,
  `9d6f93ab070a82d1de245eaf4ac949b14fe0a0dc0b2f67fbb040fb7f4960d731`,
  `c745b0b3e49bac055e3eb8b2496701918657970f073f5ad21619eec678067411`,
  and `40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.

### Isolated Redis And Exact Parity

Validation used the same third-party open-source `redis-windows` 8.8.0
development asset recorded in Turn 41:

- release:
  `https://github.com/redis-windows/redis-windows/releases/tag/8.8.0`;
- asset: `Redis-8.8.0-Windows-x64-msys2.zip`;
- verified SHA-256:
  `8af6fd6c4aac3e13ded36f249da8114b3be32df60ab589da7c3513aa8b1a86cd`.

The first bounded download timed out with a partial archive. A range-resumed
download completed and matched the expected hash before any server started. The
service bound only `127.0.0.1:56380`, used database 15 and `medusa_lock:`,
disabled RDB/AOF persistence, and limited memory to 64 MB.

Sequential normalized reporters prove:

| Runner                         | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ------------------------------ | ----: | -----: | -----: | ------: | ---: | --------: |
| Pre-edit Jest on source        |     1 |      7 |      0 |       0 |    0 |         0 |
| Post-edit Jest on fresh `dist` |     1 |      7 |      0 |       0 |    0 |         0 |
| Opt-in Vitest on fresh `dist`  |     1 |      7 |      0 |       0 |    0 |         0 |

Pre/post Jest and post-Jest/Vitest normalizer comparisons preserve the exact
file, seven full names and statuses, aggregate counts, and zero snapshot state.
The real suite continues to exercise Redis serialization, owner-aware
acquisition/release, parallel calls, failure and timeout cleanup, losing-timer
abort, execution-unique owners, partial multi-key cleanup, and late acquisition
cleanup.

The exact Jest package default and direct Vitest shadow exit naturally.
Unsharded `vitest list --json` returns all seven names. A Vitest run with every
PostgreSQL variable pointed at closed port 1 still passes 7/7, proving Redis is
the file's only live external service.

Authentic Jest `/3` results are 7/0/0, all exit zero. Each real Vitest `/3` run
exits 1 before import because a single discovered file cannot satisfy three
shards. The fail-closed Vitest runs create no client or key. Sharded Vitest list
is deliberately not used as evidence.

After every reporter, ordinary run, list, closed-PostgreSQL run, and shard,
database 15 has zero keys, no `medusa_lock:*` key, zero database-15 clients when
queried from database 0, and zero established test sockets. The server received
`SHUTDOWN NOSAVE`; the verified download, extraction, logs, and reports were
removed; port 56380 is closed. No Windows service or machine configuration was
changed.

### Task, Inventory, And Validation Ownership

Dry ownership remains:

- all units: 85/65/20;
- scoped Locking Redis units: 1/0/1;
- general units: 83/63/20;
- Framework/Utils serial units: 2/2/0;
- fast integrations: 49/30/19;
- slow integrations: 5/5/0;
- all integrations: 63/44/19.

Fast/all own Locking Redis exactly once through the byte-identical Jest default.
The opt-in Vitest key has no Turbo, root, or workflow owner. Task input hashes
change legitimately for package inputs; graph topology and command ownership do
not.

The remaining-Jest inventory remains byte-identical at digest
`6fc3f7d4842045b671b2f344448c651b76e09c247064dca81837568db23a0b51`,
68 configs, 107 scripts across 68 owners, and 406 API files. The Vitest key,
config, and resolver-only string change add no Jest ownership, so the baseline
file is untouched.

Validation passes:

- clean package build/alias resolution and production-entry probe;
- standalone strict/no-unchecked config typecheck with no new `any`, assertion,
  enum, suppression, or weak boundary;
- exact reporter comparisons, package commands, list, shard, closed-PostgreSQL,
  service-state, and natural-exit checks;
- frozen offline install, all 86 workspace-link checks, all seven dry graphs,
  exact inventory, formatting, and diff hygiene;
- Cloudflare typecheck, the 1,593-input composed import guard, and runtime-source
  import guard;
- the complete 236.7-second shared test-runner foundation: strict tooling,
  eight tooling tests, five-file parity, all 25 integration selectors, real
  Jest/Vitest adapters, exact three-file/34-test parity, and exact inventory.

### Accepted Boundary

This is an opt-in runner shadow and production-entry test-harness change, not a
default switch or Redis/provider migration. The existing generic workflow still
supplies Redis and owns the unchanged Jest command. Turn 42 adds no generic
exclusion, dedicated Redis job, root typecheck registration, aggregate contract,
or hosted result.

Local third-party service proof does not establish the workflow Redis image/
engine, hosted scheduling, checkout/cache/artifact restoration, aggregate
execution, or production Redis compatibility. No project-repository connector/
remote access, push, or hosted Actions run occurred.

No shared helper, Jest config, dependency, lockfile, root script, workflow,
production source, persistence adapter, package privacy, catalog, repository
merge, PGlite, workerd, D1, or Cloudflare runtime behavior changes.

## Locking Redis Integration Vitest Cut-over

Commit:

- `f980a459ef` (`test: cut over Locking Redis integration to Vitest`)

Date verified: 2026-07-13.

### Difference From Original Medusa

`@medusajs/locking-redis` now uses its already-proven Vitest 4 integration
profile as the default while preserving the exact natural-exit Jest command as
an explicit rollback:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

The temporary `test:integration:vitest` shadow key is removed. No `--forceExit`
is added to the rollback. The spec, Jest config, Vitest config, production
provider/loader, module service, lifecycle helper, dependencies, and lockfile
are unchanged.

The package manifest normalized hash moves from
`a44b3fa8762e1e767cb9404d342502e410b9cb5e87c5682e819aac84bc1b8c25`
to `7b9563f7b17177621e4b6fe503703c0d3b59609682715b1c30c06957b1687e1e`.
Preserved normalized hashes are:

- integration spec:
  `71ba55deaa77220ed6bb4ce47751d5099c10255b0ec76ca77be5a1de21ae7ab7`;
- Jest config:
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- Vitest config:
  `69b01480ab6cce348730a134543f7c5ef37a29f23f55f54e787cac831d7eb632`;
- tsconfig:
  `444e89a6ca86a1e65c2000babbbf18f68fde9bfa1c78c676721d6e6c8e644166`;
- package entry, loader, provider, and options:
  `52f165b1a0e6bcb9d2c9aab22305c4218498637bb1c34f46397d894de25e8e23`,
  `c5ae2941bb5009ef6f09753d6fbdb866c1f228adfd96d599f4980f4fd6aa76b8`,
  `8362276c3e88a06bfb42fd66e6dc14a732a59ebb30564995a4ac3bea945886b0`,
  and `b191f1d798e9444028e9a83d949edd453c00f5df017ea10d9c0a38ec66428261`;
- workspace and raw lockfile:
  `9d6f93ab070a82d1de245eaf4ac949b14fe0a0dc0b2f67fbb040fb7f4960d731`
  and `40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.

The spec retains seven ordinary tests, 36 textual `expect`, eight `jest.fn`, one
`jest.spyOn`, one `jest.setTimeout`, two inherited `any[]`, and zero skips,
todos, or snapshots. The existing compatibility bridge runs those Jest APIs
under Vitest; this cut-over adds no `vi` import or assertion rewrite.

### Generic Shard And Dedicated Redis Ownership

Vitest 4.1.10 rejects every real `/3` run before test import because the config
contains exactly one file. The root fast-integration command therefore adds only:

```text
--filter=!./packages/modules/providers/locking-redis
```

The slow and unsharded all-packages commands remain unchanged. The existing
Redis Vitest config is appended exactly once to persistent
`typecheck:test-runner-tooling`. The normalized root manifest becomes
`15edb7a673a0490c8172b1c632c1174708ed929aa7e2777e82daf3ab3640b5b1`.

The runner-neutral `locking-redis-integration` workflow job has:

- `needs: setup`, Ubuntu, and a ten-minute timeout;
- only the existing `redis` image/service convention, PING health check, and
  port 6379;
- no matrix, shard, CPU probe, PostgreSQL service, or job-level runner flag;
- standard checkout, dependency cache with `skip-build: "true"`, build-artifact
  download, and package-default run steps;
- `REDIS_URL=redis://127.0.0.1:6379` on the run step, avoiding localhost/IPv6
  ambiguity without depending on a non-default logical database.

Build-artifact restoration is required because the unchanged spec resolves
`@medusajs/locking-redis` and the package entry is `dist/index.js`. The package
aggregate adds the job to `needs` and checks its failure, cancelled, skipped,
and success states under `always()`. The generic matrix keeps its Redis service
because other Redis-backed packages remain in the slow group.

The normalized workflow hash is
`674cfbe4d288e04d6a70138aa7263fd41d52a7b5d8986628fd0036f896243e56`.
The strict typed foundation contract parses and freezes the exact package
scripts, dependency edges, immutable test/config hashes, root exclusion and
typecheck path, Redis-only job shape, four steps, runner-neutral name/command,
and all aggregate terminal states. It adds no unsafe `any`, assertion, enum, or
suppression. Exact aggregate steps and explicit job assertions reject
`continue-on-error` failure masking. The normalized hash is
`66e89c9bf95873a450e24db410c0bbff4f551093560684bc49e54e1621100978`.

### Fresh Isolated Redis Parity

Turn 43 downloaded the same open-source third-party `redis-windows` 8.8.0
development asset used by the prerequisite turns:

- release:
  `https://github.com/redis-windows/redis-windows/releases/tag/8.8.0`;
- asset: `Redis-8.8.0-Windows-x64-msys2.zip`;
- verified SHA-256:
  `8af6fd6c4aac3e13ded36f249da8114b3be32df60ab589da7c3513aa8b1a86cd`.

The checksum passed before extraction or startup. The service bound only
`127.0.0.1:56381`, used database 15 and the existing `medusa_lock:` namespace,
disabled RDB/AOF persistence, and capped memory at 64 MB. Jest and Vitest ran
sequentially because Redis logical database numbers are not runner-namespaced.

Before the ownership edit, the committed Jest default and Vitest shadow each
passed 1 file / 7 tests naturally. After the edit, exact ordinary commands and
machine-readable reporters prove:

| Runner                   | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ------------------------ | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest rollback on `dist`  |     1 |      7 |      0 |       0 |    0 |         0 |
| Vitest default on `dist` |     1 |      7 |      0 |       0 |    0 |         0 |

The normalizer preserves the exact file, seven full names/statuses, aggregate
counts, and zero snapshot state. Unsharded `vitest list --json` returns all
seven names. Vitest default still passes 7/7 with every PostgreSQL variable
pointed at closed port 1, proving Redis is the file's only live external service.

Authentic Jest `/3` remains 7/0/0 and every command exits zero. All three real
Vitest `/3` commands exit 1 before import with the one-file shard-count error;
database 15, clients, and sockets remain zero. Sharded list is not used as
evidence.

After every baseline, ordinary, reporter, closed-PostgreSQL, and shard run,
database 15 has zero keys, no `medusa_lock:*` key, zero database-15 clients when
queried from database 0, and zero established test sockets. Redis logged
`SHUTDOWN NOSAVE`; zero Redis processes and active sockets remained, and the
verified archive, extraction, reports, and logs were removed. No Windows service
or machine configuration changed.

### Task, Inventory, And Validation Ownership

Dry task ownership is:

- all units: 85/65/20;
- scoped Locking Redis units: 1/0/1;
- general units: 83/63/20;
- Framework/Utils serial units: 2/2/0;
- fast integrations: 48/29/19, with no Locking Redis task;
- slow integrations: 5/5/0;
- all integrations: 63/44/19, with Locking Redis exactly once on Vitest.

The remaining-Jest inventory changes only the Locking Redis manifest entry's
script key from `test:integration` to `test:integration:jest`. Counts remain 68
configs, 107 scripts across 68 owners, and 406 API files. The accepted digest is
`43230df4bd1e5594fe39362f107171e0b6dbe73f79a4fd5f96753a77180b4611`;
the normalized inventory file hash is
`3212b0848fce9dda8366b94608b9c1ebbd0eead48a358d9108a07b86ad5c36c9`.

Validation passes:

- clean Locking Redis build/alias resolution and fresh `dist/index.js` entry;
- persistent strict/no-unchecked tooling typecheck and eight typed workflow/
  runner contracts;
- exact default/rollback commands and reporter parity, seven-name list, closed-
  PostgreSQL independence, authentic shard behavior, and service cleanup;
- frozen offline install across all 86 workspaces, exact workspace links, all
  seven dry graphs, and exact remaining-Jest inventory;
- Cloudflare typecheck, 1,593-input composed import guard, and runtime-source
  import guard;
- complete 253-second shared foundation: strict tooling, eight tooling tests,
  five-file parity, all 25 selectors, real adapters, exact three-file/34-test
  parity, and exact inventory.

The npm registry and local binaries report Vite 8.1.4 and Vitest 4.1.10, matching
the existing root ranges. Local YAML parsing and third-party Redis execution do
not prove hosted scheduling, checkout/cache/artifact restoration, the floating
workflow Redis image/engine, aggregate execution, or production Redis
compatibility. No project-repository connector or git remote access, push, or
hosted Actions run occurred.

This turn changes no test assertion/API, Jest or Vitest config, shared helper,
production source, dependency, lockfile, package privacy, catalog, repository
merge, persistence adapter, PGlite, workerd, D1, or Cloudflare runtime behavior.
The adopted migration sequence is unchanged, so the Cloudflare refactor plan and
fork index do not require edits.

## API Key Unit Vitest Shadow

Commit:

- `68504ce7b3` (`test: shadow API Key unit lane with Vitest`)

Date verified: 2026-07-14.

### Difference From Original Medusa

`@medusajs/api-key` retains both authoritative Jest commands byte-for-byte and
adds one opt-in unit shadow:

```text
test              jest --bail --forceExit --testPathPattern=src
test:vitest       vitest run --config vitest.config.mts
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The package-local config uses `defineNodeVitestConfig`, an absolute package
root, canonical source discovery globs, the Node/forks profile, and the existing
`@models`, `@services`, `@repositories`, and `@types` aliases. It adds no setup
file or legacy Jest bridge. The include list cannot reach `integration-tests`
or `dist`.

The audit corrected the previous next-boundary shorthand. Jest owns two unit
files, not one:

- `src/__tests__/static-manifest.spec.ts` owns the full name
  `API Key static manifest matches the normal API Key module export and joiner config`
  and five assertions;
- `src/services/__tests__/noop.ts` owns `noop should run` and one assertion.

Together they retain two tests, six textual `expect` calls, three `toEqual`,
three `toBe`, and zero Jest APIs, mocks, hooks, async cases, skips, todos, or
snapshots. No assertion, name, source, Jest config, timeout, or forced-exit
behavior changes.

The separate PostgreSQL-backed
`integration-tests/__tests__/api-key-module-service.spec.ts` remains listed by
the exact integration Jest pattern and excluded from Vitest. It was not run or
migrated in this unit-only turn.

### Exact Parity And Sharding

Machine-readable results are:

| Runner           | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ---------------- | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest before edit |     2 |      2 |      0 |       0 |    0 |         0 |
| Jest after edit  |     2 |      2 |      0 |       0 |    0 |         0 |
| Vitest shadow    |     2 |      2 |      0 |       0 |    0 |         0 |

All pairwise normalizer comparisons preserve both repository-relative files,
both full names/statuses, counts, and zero snapshot state. `vitest list --json`
returns exactly the same two source files.

The existing unit workflow forwards `/4`, `--maxWorkers`, and
`--passWithNoTests`. Authentic package commands prove both Jest and Vitest run
one test in shard 1, one in shard 2, and zero in shards 3 and 4; all eight
commands exit zero. Unlike the one-file integration profiles, this two-file unit
lane therefore does not need a generic unit exclusion or dedicated unsharded
job for a future default switch.

### Protected Hashes And Ownership

Normalized-LF SHA-256 values are:

- package manifest before/after:
  `85c1f211849b8cc72e4377e85cc4ea46f12935b64c9ff352beccf6f53eaadc37`
  and `0c7ee4ad26ab13a24bd8b99701b7c48e9f28a9b55c9d764271f1376228dcb742`;
- new Vitest config:
  `52958a368def2a79e1d0cfd5c8278d996f0f6fcd5f948d55124adbb2b9df5935`;
- static-manifest spec and noop suite:
  `04483e85a009b663fd4eaa1073e6dff2593f0f8716565694f2b4caecd7dfeb4c`
  and `a8fce584e64fea146c0a551341a1a9e7effd794270765f7bebd9347c4942b75d`;
- Jest config and TypeScript config:
  `ee7d6ed8b351066f0fd908d319e8ebd3ee00146b5dc51c36601ac5a21fcd95a9`
  and `e4a0e8beb92f159284d70b75a703d41b667a9d84e5e965844fa6bb77a0218086`;
- untouched integration spec:
  `5d8cddfb7adc1be6187cd9a75e816d22e268d4dd3dfd4d1799c26715568797e2`;
- unchanged root manifest, workspace file, and raw lockfile:
  `15edb7a673a0490c8172b1c632c1174708ed929aa7e2777e82daf3ab3640b5b1`,
  `9d6f93ab070a82d1de245eaf4ac949b14fe0a0dc0b2f67fbb040fb7f4960d731`,
  and `40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.

Dry ownership remains:

- all units: 85/65/20;
- scoped API Key units: 1/1/0, on Jest;
- general units: 83/63/20, with API Key once on Jest;
- Framework/Utils serial units: 2/2/0, without API Key;
- fast integrations: 48/29/19, with API Key once on Jest;
- slow integrations: 5/5/0, without API Key;
- all integrations: 63/44/19, with API Key once on Jest.

`test:vitest` has no root, Turbo, workflow, shard, or aggregate owner. Package
input hashes change legitimately; graph topology and authoritative commands do
not. The remaining-Jest inventory remains byte-identical at digest
`43230df4bd1e5594fe39362f107171e0b6dbe73f79a4fd5f96753a77180b4611`,
68 configs, 107 scripts across 68 owners, and 406 API files.

### Validation And Boundary

Validation passes:

- direct Jest baseline/default and Vitest shadow, exact three-way reporter
  parity, unsharded list, integration listing, and all CI-shaped unit shards;
- strict/no-unchecked standalone config typecheck with no new `any`, enum,
  assertion, suppression, or weak boundary;
- clean API Key build and alias resolution;
- frozen offline install across all 86 workspaces, exact `workspace:*` edges,
  all seven dry graphs, and exact inventory;
- Cloudflare typecheck, 1,593-input composed import guard, and runtime-source
  import guard;
- isolated 213-second integration foundation and complete 343-second shared
  foundation: strict tooling, eight tooling tests, five-file parity, all 25
  selectors, real adapters, exact three-file/34-test parity, and inventory.

The first complete-foundation attempt crashed in the existing PGlite Jest child
with a Node `Fatal process out of memory: Zone` error while C: had only about
0.3 GB free. No code, timeout, worker, or memory workaround was introduced.
After external free space recovered to 3.8 GB and no test process remained, the
isolated and complete reruns above passed; no cache was pruned.

Registry `latest` and local commands remain Vite 8.1.4 with built-in Rolldown
and Vitest 4.1.10. No dependency, lockfile, root script, workflow, CI aggregate,
package privacy, catalog, merge preparation, production source, persistence,
PGlite selection, workerd, D1, or Cloudflare runtime behavior changes. The fork
index and Cloudflare refactor plan need no edit because record topology,
architecture, and accepted sequence are unchanged.

No project-repository connector, remote access, push, or hosted Actions run was
needed. This local opt-in command has no CI owner, and this turn makes no hosted
execution claim.

## API Key Unit Vitest Cut-over

Commit:

- `a3cfe7b644` (`test: switch API Key unit lane to Vitest`)

Date verified: 2026-07-14.

### Difference From Original Medusa

`@medusajs/api-key` now uses the already-proven Vitest config as its unit
default and retains the exact former Jest command as an explicit rollback:

```text
test              vitest run --config vitest.config.mts
test:jest         jest --bail --forceExit --testPathPattern=src
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The temporary `test:vitest` key is removed. The existing config is registered
exactly once in persistent root `typecheck:test-runner-tooling`. No unit source,
assertion, name, config, alias, setup, Jest config, integration source/command,
production source, dependency, lockfile, workflow, or runtime behavior changes.

The source boundary remains two unit files, two tests, and six textual `expect`
calls with no Jest APIs, skips, todos, or snapshots. Unsharded Vitest discovery
lists only `src/__tests__/static-manifest.spec.ts` and the unsuffixed
`src/services/__tests__/noop.ts`. Jest list-only still finds the separate
`integration-tests/__tests__/api-key-module-service.spec.ts`; that PostgreSQL-
backed suite was neither executed nor migrated in this unit turn.

### Exact Parity And Sharding

Machine-readable results are:

| Runner                       | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ---------------------------- | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest pre-cut-over            |     2 |      2 |      0 |       0 |    0 |         0 |
| Vitest pre-cut-over shadow   |     2 |      2 |      0 |       0 |    0 |         0 |
| Vitest post-cut-over default |     2 |      2 |      0 |       0 |    0 |         0 |
| Jest post-cut-over rollback  |     2 |      2 |      0 |       0 |    0 |         0 |

All pairwise normalizer comparisons preserve both repository-relative files,
both full names/statuses, counts, and zero snapshot state. Direct Vitest,
direct Jest rollback, and the authentic root CI-shaped command each run one
test in shard 1, one in shard 2, and zero in shards 3 and 4. All 12 post-cut-over
commands exit zero with `--maxWorkers=1 --passWithNoTests`.

The real dry graphs prove the triplets are total/executable/nonexistent tasks;
switching the executable command does not create a graph marker:

- all units: unchanged 85/65/20, API Key once on Vitest;
- scoped API Key units: unchanged 1/1/0, on Vitest;
- general units: unchanged 83/63/20, API Key once on Vitest;
- Framework/Utils serial units: unchanged 2/2/0, without API Key;
- fast integrations: unchanged 48/29/19, API Key once on Jest;
- slow integrations: unchanged 5/5/0, without API Key;
- all integrations: unchanged 63/44/19, API Key once on Jest.

No generic filter, dedicated unit job, workflow edit, or repository access is
justified. The root workflow hash remains
`674cfbe4d288e04d6a70138aa7263fd41d52a7b5d8986628fd0036f896243e56`.

### Protected Hashes And Ownership

Normalized-LF SHA-256 values are:

- package manifest before/after:
  `0c7ee4ad26ab13a24bd8b99701b7c48e9f28a9b55c9d764271f1376228dcb742`
  and `98ed584b7b6c8490b8f01738e0d23161448c8536a3f422ff587344d78d5139a7`;
- root manifest before/after:
  `15edb7a673a0490c8172b1c632c1174708ed929aa7e2777e82daf3ab3640b5b1`
  and `da7f9cef83fc23e15ad534a105b1f4d169aba5037b10091b479f74b44c704722`;
- unchanged Vitest config, Jest config, and integration spec:
  `52958a368def2a79e1d0cfd5c8278d996f0f6fcd5f948d55124adbb2b9df5935`,
  `ee7d6ed8b351066f0fd908d319e8ebd3ee00146b5dc51c36601ac5a21fcd95a9`,
  and `5d8cddfb7adc1be6187cd9a75e816d22e268d4dd3dfd4d1799c26715568797e2`;
- unchanged static-manifest and noop sources:
  `04483e85a009b663fd4eaa1073e6dff2593f0f8716565694f2b4caecd7dfeb4c`
  and `a8fce584e64fea146c0a551341a1a9e7effd794270765f7bebd9347c4942b75d`;
- regenerated inventory file:
  `07481e892ad6da4853252a102a0f3afb0142a937f60b859644ec208b167cb1f3`;
- unchanged workspace and lockfile:
  `9d6f93ab070a82d1de245eaf4ac949b14fe0a0dc0b2f67fbb040fb7f4960d731`
  and `40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.

The reviewed inventory delta removes only the API Key unit Jest entry under
`test` and adds the byte-identical entry under `test:jest`. The accepted digest
is `eebfb1b76932592649e260810e19e746d3f97f009b95b93b21e8782092d4af3d`;
counts remain 68 configs, 107 scripts across 68 owners, and 406 API files. The
Jest config remains active because both rollback and integration still use it.

### Validation And Boundary

Validation passes:

- fresh pre/post default/rollback reporters, all exact comparisons, unsharded
  discovery, integration list-only proof, and all direct/root `/4` runs;
- standalone strict/no-unchecked config typecheck, persistent strict tooling,
  and clean API Key build/alias resolution;
- frozen offline install across all 86 workspaces, exact `workspace:*` policy,
  all seven dry graphs, and exact inventory;
- Cloudflare typecheck, 1,593-input composed import guard, and runtime-source
  import guard;
- complete 243-second shared foundation: eight tooling tests, five-file parity,
  all 25 Jest-default selectors, real adapter executions, exact three-file/
  34-test parity, fail-closed unsupported Vitest lanes, and exact inventory.

Registry and local binaries remain Vite 8.1.4 with built-in Rolldown and Vitest
4.1.10. No dependency/lockfile, workflow/CI aggregate, package privacy, catalog,
merge preparation, persistence, PGlite selection, workerd, D1, or Cloudflare
runtime behavior changes. No project-repository connector, remote access, push,
or hosted Actions run was needed or claimed.

## API Key Integration Vitest Shadow

Commit:

- `8e299ab14b` (`test: add API Key integration Vitest shadow`)

Date verified: 2026-07-14.

### Difference From Original Medusa

`@medusajs/api-key` now owns an opt-in Vitest integration shadow while the
existing Jest command remains authoritative:

```text
test                      vitest run --config vitest.config.mts
test:jest                 jest --bail --forceExit --testPathPattern=src
test:integration          jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
test:integration:vitest   vitest run --config vitest.integration.config.mts
```

The new serial integration config includes exactly
`integration-tests/__tests__/api-key-module-service.spec.ts`, preserves the four
existing aliases, and composes the canonical integration helper. Root strict
tooling owns it once. No assertion, test name, fixture, Jest config, unit command,
default integration command, dependency, lockfile, workflow, production source,
or runtime behavior changes.

### Unchanged Assertion And Bridge Boundary

The frozen suite remains one file, 25 tests, 46 textual `expect` calls, and zero
skips, todos, or snapshots. Its existing Jest calls are one `setTimeout`, two
`spyOn`, one `restoreAllMocks`, two chained
`useFakeTimers().setSystemTime`, and two `useRealTimers`.

The shared typed bridge grows from five to exactly eight allowed keys:

```text
clearAllMocks
fn
restoreAllMocks
setSystemTime
setTimeout
spyOn
useFakeTimers
useRealTimers
```

`useFakeTimers`, `setSystemTime`, and `useRealTimers` reuse Vitest's parameter
types and return the narrow frozen bridge so chaining works without exposing
unrequired timer controls. Strict type contracts accept the real chain and
reject broader APIs such as `advanceTimersByTime`; runtime contracts verify
argument forwarding, real fake time, the exact allowlist, and blocked advanced
timer/module APIs. No `any`, unchecked assertion, or broad `unknown` boundary is
introduced.

### Exact Six-Quadrant Proof

Fresh machine-readable results for the unchanged source are:

| Persistence backend       | Jest files/tests | Vitest files/tests | Failed | Skipped | Todo | Snapshots |
| ------------------------- | ---------------: | -----------------: | -----: | ------: | ---: | --------: |
| MikroORM/PostgreSQL       |             1/25 |               1/25 |      0 |       0 |    0 |         0 |
| PGlite adapter            |             1/25 |               1/25 |      0 |       0 |    0 |         0 |
| Drizzle/SQLite `:memory:` |             1/25 |               1/25 |      0 |       0 |    0 |         0 |

Ten exact comparisons pass: Jest/Vitest within each backend, pre/post Jest on
each backend, and both alternate backends against PostgreSQL under each runner.
Every repository-relative file, full name, status, count, and zero-snapshot
state matches.

### PGlite Selector And CI Boundary

The serial PGlite orchestrator maps only the explicit API Key Vitest selection
to `test:integration:vitest`. Both real commands pass all 25 tests:

```text
pnpm test:integration:pglite --only=api-key
pnpm test:integration:pglite --runner=vitest --only=api-key
```

The unqualified list remains the same ordered 25 lanes and defaults to Jest.
Vitest now supports adapter, Currency, and API Key; Translation becomes the
first unsupported production-module lane and fails closed for direct, list,
resume, and matrix selections.

An authentic `vitest run ... --shard=1/3` execution exits 1 because the shard
count exceeds the one discovered file. This is not treated as a test failure or
hidden with a workflow workaround. The shadow has no CI owner; a future default
cut-over must exclude API Key from the generic fast `/3` graph and add a
dedicated unsharded job plus aggregate ownership.

All dry graph triplets remain unchanged:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integrations: 48/29/19, 5/5/0, and 63/44/19;
- API Key unit appears once on Vitest; API Key integration appears once on Jest
  in fast/all. The opt-in shadow appears in no generic graph.

### Protected Hashes And Remaining-Jest Ownership

Normalized-LF SHA-256 values are:

- package manifest before/after:
  `98ed584b7b6c8490b8f01738e0d23161448c8536a3f422ff587344d78d5139a7`
  and `a622569e1a79a187b17d16a8944c0c6e558f15305a73abb7ad2e3da8da3298b4`;
- root manifest before/after:
  `da7f9cef83fc23e15ad534a105b1f4d169aba5037b10091b479f74b44c704722`
  and `fb047a3e0dd4d1447d39eba98fe7f916db61af7a27a9b9ec9e726057d254f14f`;
- new integration config:
  `27209ecc3e77d13c47bb8456a18ac2477b77ef7c1712b00543c75349a6ce27b8`;
- unchanged assertion source and fixtures:
  `5d8cddfb7adc1be6187cd9a75e816d22e268d4dd3dfd4d1799c26715568797e2`
  and `d58ffcbac802bccc5b3263575dce2aa71973c84218d400eec1d780999bedde37`;
- bridge, type contract, and runtime tooling contract:
  `79298af5735cf0cd0cbe94f7a90d83a425a0df5e366c9cc0676c0e48cd571ee1`,
  `2842e29289a7717614bf825f22bce80a13abed16aa11f2e48391643d32c39773`,
  and `153e44c01438e4f38fb63762d5dd79e1a366fdd1f0e9121d0d36db93c8cf72e6`;
- PGlite selector, integration verifier, and inventory file:
  `fa1397b37eb2910e161cdf3b9d0e2ef85e8e9368f651f071125b7cc02e647628`,
  `3eec5152537de6dd16987383a5418ec627362e76a0fc1e3b8034d4081fd36cd1`,
  and `0a2586f3552082cdd53e6b8d79b3ee203c0fa32b4b311c5c0821b89be04ceaea`.

The reviewed inventory accepts only the new shadow ownership, the typed bridge
contract calls, and the two selector/verifier digests. Counts remain 68 configs,
107 scripts across 68 owners, 406 API files, and two foundation Jest-API files
at digest `5aec0543df3abfa78f8b5932130c003d49895f57149b17ff4dc6452b63ab6235`.
Workspace, lockfile, and workflow hashes remain unchanged.

### Validation And Accepted Boundary

Validation passes:

- test-first red/green type and runtime contracts, strict/no-unchecked tooling,
  and nine tooling tests;
- all six integration quadrants, ten exact comparisons, both real API Key PGlite
  selectors, exact 25-lane list/fail-closed planning, and the accepted `/3`
  failure proof;
- API Key build, two-file/two-test Vitest unit default, exact two-suite/two-test
  Jest unit rollback, frozen offline install across all 86 workspaces, exact
  `workspace:*` policy, all seven dry graphs, and exact inventory;
- Cloudflare typecheck, 1,593-input composed import guard, and runtime-source
  guard;
- complete 287.4-second shared foundation: strict tooling, nine tooling tests,
  five-file Jest/Vitest parity, all 25 Jest-default lanes, real adapter runs,
  exact three-file/34-test parity, and fail-closed unsupported Vitest lanes.

Local PostgreSQL proof used an isolated PostgreSQL 18 cluster at
`127.0.0.1:55435`; the configured machine service was untouched. The temporary
cluster was stopped, verified unavailable, and its data/log safely removed.
Installed Vite 8.1.4 uses its built-in Rolldown path and Vitest is 4.1.10. No
GitHub repository access, remote action, push, hosted result, package privacy,
catalog, publication, merge preparation, D1, workerd, or production Cloudflare
runtime claim is part of this turn.

## API Key Integration Vitest Cut-over

Commit:

- `62c89b3ad6` (`test: switch API Key integration to Vitest`)

Date verified: 2026-07-14.

### Difference From Original Medusa

`@medusajs/api-key` now uses Vitest for unit and integration defaults while
retaining the exact Jest commands as explicit rollbacks:

```text
test                      vitest run --config vitest.config.mts
test:jest                 jest --bail --forceExit --testPathPattern=src
test:integration          vitest run --config vitest.integration.config.mts
test:integration:jest     jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The temporary `test:integration:vitest` key is removed. The integration source,
fixture, four aliases, exact-file serial config, Jest config, unit config, typed
eight-key bridge, unit commands, dependencies, and production code remain
unchanged.

### Exact Pre/Post Six-Quadrant Proof

Fresh pre-cut-over and post-cut-over reports cover both runners on three distinct
Node persistence paths:

| Persistence backend       | Pre Jest | Pre Vitest | Post Jest rollback | Post Vitest default |
| ------------------------- | -------: | ---------: | -----------------: | ------------------: |
| MikroORM/PostgreSQL       |     1/25 |       1/25 |               1/25 |                1/25 |
| PGlite adapter            |     1/25 |       1/25 |               1/25 |                1/25 |
| Drizzle/SQLite `:memory:` |     1/25 |       1/25 |               1/25 |                1/25 |

All twelve reports normalize exactly to the same repository-relative file, 25
full names/statuses, zero failures/skips/todos, and zero snapshots. The frozen
source remains 25 tests and 46 textual `expect` calls. The first shell probe that
forwarded a literal `--` was rejected as invalid diagnostic evidence because it
ran unsharded without database credentials; the corrected direct Vitest command
fails during `/3` planning before setup because one file cannot satisfy three
shards.

### PGlite, Task Graph, And CI Ownership

The global PGlite matrix remains Jest-default. API Key now mirrors Currency:

```text
default Jest selector   --filter=@medusajs/api-key test:integration:jest --runInBand
explicit Vitest         --filter=@medusajs/api-key test:integration
```

Both real API Key selectors pass all 25 tests. The ordered list remains 25 lanes;
Translation remains the first unsupported Vitest production lane and direct,
list, resume, and matrix requests still fail closed before spawning.

The root fast command adds only `--filter=!./packages/modules/api-key`. Dry graph
triplets are:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast integrations: 47/28/19, with API Key absent;
- slow integrations: unchanged 5/5/0;
- unsharded all integrations: unchanged 63/44/19, with API Key exactly once on
  its Vitest default.

The workflow adds one runner-neutral `api-key-integration` job with `needs:
setup`, Ubuntu, ten-minute timeout, and only the existing PostgreSQL image/health
shape. Checkout, cached dependency installation, and build-artifact download are
followed by this unsharded command with explicit database environment:

```text
pnpm --filter @medusajs/api-key test:integration
```

There is no strategy, matrix, shard, CPU probe, worker override, Redis service,
runner-named command, or root parity verifier. The stable package aggregate
requires this job and propagates failure, cancelled, skipped, and success states.
The job proves the Vitest default on PostgreSQL; PGlite, Drizzle, and Jest
rollback parity remain local acceptance evidence.

The strict parsed contract was written first and failed on the missing fast
exclusion. After implementation, all nine tooling tests pass. It freezes the
final package scripts, one strict config token, immutable source/fixture/config
hashes, exact fast command, PostgreSQL service and steps, runner-neutral job
name, and complete aggregate propagation without introducing `any`, weak
assertions, or a broader type boundary.

### Protected Hashes And Remaining-Jest Ownership

Normalized-LF SHA-256 values are:

- API Key package manifest before/after:
  `a622569e1a79a187b17d16a8944c0c6e558f15305a73abb7ad2e3da8da3298b4`
  and `c30c426a2be57ee6562f07349357a3c94d989cdcc2e3e873b707c85d28a0e850`;
- root manifest before/after:
  `fb047a3e0dd4d1447d39eba98fe7f916db61af7a27a9b9ec9e726057d254f14f`
  and `63628f1f1a95973a977def1ccb24e02be7ca2a015c833092d1ceff434bdd30bb`;
- PGlite orchestrator before/after:
  `fa1397b37eb2910e161cdf3b9d0e2ef85e8e9368f651f071125b7cc02e647628`
  and `86590a32be51db419d33054c29fa18599ff6781289b6324aeb7e59666e5008bd`;
- tooling/workflow contract before/after:
  `153e44c01438e4f38fb63762d5dd79e1a366fdd1f0e9121d0d36db93c8cf72e6`
  and `858a82792fb6dc2c8c89c38f1392d61f5b0653697b4708b152a7f7aad5db66fe`;
- inventory file before/after:
  `0a2586f3552082cdd53e6b8d79b3ee203c0fa32b4b311c5c0821b89be04ceaea`
  and `ae6c07deb5bcd6b02ccf4260adb59657ad6fcede3a35e3e2f9000b5b6287e95d`;
- workflow before/after:
  `674cfbe4d288e04d6a70138aa7263fd41d52a7b5d8986628fd0036f896243e56`
  and `cae2adb1e7bdd055614c2f6d16494da915e24b85ab00ccf97f5e5748496ebc71`.

Unchanged source, fixture, Jest config, unit Vitest config, integration Vitest
config, bridge, bridge type contract, integration-foundation verifier, workspace,
and lockfile hashes are respectively
`5d8cddfb7adc1be6187cd9a75e816d22e268d4dd3dfd4d1799c26715568797e2`,
`d58ffcbac802bccc5b3263575dce2aa71973c84218d400eec1d780999bedde37`,
`ee7d6ed8b351066f0fd908d319e8ebd3ee00146b5dc51c36601ac5a21fcd95a9`,
`52958a368def2a79e1d0cfd5c8278d996f0f6fcd5f948d55124adbb2b9df5935`,
`27209ecc3e77d13c47bb8456a18ac2477b77ef7c1712b00543c75349a6ce27b8`,
`79298af5735cf0cd0cbe94f7a90d83a425a0df5e366c9cc0676c0e48cd571ee1`,
`2842e29289a7717614bf825f22bce80a13abed16aa11f2e48391643d32c39773`,
`3eec5152537de6dd16987383a5418ec627362e76a0fc1e3b8034d4081fd36cd1`,
`9d6f93ab070a82d1de245eaf4ac949b14fe0a0dc0b2f67fbb040fb7f4960d731`,
and `40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.

The reviewed inventory moves only the byte-identical API Key Jest integration
command from key `test:integration` to `test:integration:jest` and updates the
PGlite script digest. Counts remain 68 configs, 107 scripts across 68 owners, 406
API files, and two foundation Jest-API files at digest
`2d775e3a998ccba2b88231bca95377c84ab0da1ee5601b2eb9aa8e51f98d5fa0`.

### Validation And Accepted Boundary

Validation passes:

- twelve fresh integration reports and eleven exact comparisons to one frozen
  baseline across all runners, backends, and pre/post states;
- both real PGlite selectors, ordered/fail-closed selector foundation, corrected
  direct `/3` planning failure, and all seven dry graphs;
- strict tooling, nine tooling tests, API Key build, two-file/two-test unit
  Vitest default, exact two-suite/two-test Jest unit rollback, exact inventory,
  frozen offline install across all 86 projects, and `workspace:*` policy;
- Cloudflare typecheck, 1,593-input composed import guard, and runtime-source
  import guard;
- complete 276.9-second foundation with five-file Jest/Vitest parity, all 25
  Jest-default selector lanes, real adapter runs, and exact three-file/34-test
  adapter parity.

Local PostgreSQL proof used an isolated PostgreSQL 18.3 cluster at
`127.0.0.1:55436`; the machine service was untouched. The cluster was stopped,
verified unavailable, and its data/log safely removed. Vite 8.1.4 and Vitest
4.1.10 remain installed without dependency or lockfile changes. Workflow parsing
and direct local commands do not establish hosted Actions success. No remote
repository access, push, catalog/privacy/publication change, persistence/runtime
implementation, workerd, D1, or production Cloudflare claim is included.

## Translation Unit Vitest Shadow

Commit:

- `0c8ea06b00` (`test: shadow Translation unit lane with Vitest`)

Date verified: 2026-07-14.

### Difference From Original Medusa

`@medusajs/translation` retains both authoritative Jest commands byte-for-byte
and adds one opt-in unit shadow:

```text
test              jest --passWithNoTests --bail --forceExit --testPathPattern=src
test:vitest       vitest run --config vitest.config.mts
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The new package-local config uses `defineNodeVitestConfig`, an absolute package
root, canonical `src/` discovery globs, the Node/forks/SWC profile, and the same
five aliases as Translation's Jest and TypeScript configuration: `@models`,
`@services`, `@repositories`, `@types`, and `@utils`. It has no legacy Jest
bridge or setup file. Its include list cannot reach `integration-tests` or
rebuilt `dist` copies.

No production source, unit source, assertion, name, expected value, Jest config,
integration source/fixture/command, dependency, lockfile, root script, PGlite
capability, workflow, persistence adapter, workerd, D1, or Cloudflare runtime
changed.

### Frozen Unit Boundary And Exact Parity

The authoritative source lane is exactly:

- `src/__tests__/static-manifest.spec.ts`;
- full name
  `Translation static manifest matches the normal Translation module export and explicit static resources`;
- one passed test with 11 textual assertions: five `toBe`, five `toEqual`, and
  one `toMatchObject`;
- zero Jest APIs, mocks, hooks, async cases, skips, todos, snapshots, environment
  reads, network calls, database setup, or external service requirements.

Machine-readable results are:

| Runner           | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ---------------- | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest before edit |     1 |      1 |      0 |       0 |    0 |         0 |
| Jest after edit  |     1 |      1 |      0 |       0 |    0 |         0 |
| Vitest shadow    |     1 |      1 |      0 |       0 |    0 |         0 |

All three exact comparisons preserve the repository-relative file, full name,
status, normalized counts, and zero-snapshot state. `vitest list --json` returns
only that source file. Jest list-only still returns the separate
`integration-tests/__tests__/translation-module-service.spec.ts` without
executing it. That integration suite retains its existing `jest.setTimeout`,
`jest.spyOn`, `jest.SpyInstance`, persistence, and assertion boundary.

### Sharding, Graphs, And PGlite Boundary

The existing unit workflow forwards `/4`, `--maxWorkers`, and
`--passWithNoTests`. All four package-shaped commands pass for each runner:
both Jest and Vitest place the sole test in shard 1 and exit zero with empty
shards 2-4. The opt-in `test:vitest` key has no root, Turbo, workflow, shard, or
aggregate owner.

Dry task ownership remains exact:

- all units: 85/65/20, Translation once on Jest;
- scoped Translation units: 1/1/0, on Jest;
- general units: 83/63/20, Translation once on Jest;
- Framework/Utils serial units: 2/2/0, without Translation;
- fast integrations: 47/28/19, Translation once on Jest;
- slow integrations: 5/5/0, without Translation;
- unsharded all integrations: 63/44/19, Translation once on Jest.

The serial PGlite list remains the same ordered 25 lanes with Translation at
position 4. The matrix remains globally Jest-default, and
`--runner=vitest --only=translation` still fails closed before spawning with
Translation as the first unsupported production-module lane. Unit shadow proof
does not change integration capability.

### Protected Hashes And Remaining-Jest Ownership

Normalized-LF SHA-256 values are:

- Translation manifest before/after:
  `03118ea57a6965bfd4d6611c1f43b81e92cd9929569e354a8fcb468469a0c44b`
  and `306a1e9abc2be602cf371ecdead6a74ca616958665e8269899b839432a5a68cc`;
- new Vitest config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- unchanged unit source, Jest config, and TypeScript config:
  `7c0edf4af74919cc6098f7fe20b47ee345bf0d4ef1333e8921203a808b1f9510`,
  `8d576098455343f4025810089e414c229b432e90557adaff7af8acf655d6432a`,
  and `146b7bfd74e75043ef315ba6c7cb0d29753dbc83a8832b34e6f827176b18e318`;
- unchanged integration source and fixture:
  `82c07ea1896c5b10f09616d708b0ecbff5f80645d5404f832c62c199016b4822`
  and `b9fc360f33e2488ac15487b999dee2663fb736178d508e545894b914952a2ee6`;
- unchanged root manifest, workspace, raw lockfile, inventory, workflow, and
  PGlite orchestrator:
  `63628f1f1a95973a977def1ccb24e02be7ca2a015c833092d1ceff434bdd30bb`,
  `9d6f93ab070a82d1de245eaf4ac949b14fe0a0dc0b2f67fbb040fb7f4960d731`,
  `40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`,
  `ae6c07deb5bcd6b02ccf4260adb59657ad6fcede3a35e3e2f9000b5b6287e95d`,
  `cae2adb1e7bdd055614c2f6d16494da915e24b85ab00ccf97f5e5748496ebc71`,
  and `86590a32be51db419d33054c29fa18599ff6781289b6324aeb7e59666e5008bd`.

The remaining-Jest guard is byte-identical at digest
`2d775e3a998ccba2b88231bca95377c84ab0da1ee5601b2eb9aa8e51f98d5fa0`,
68 configs, 107 runner scripts across 68 owners, and 406 API files. Both
Translation Jest commands and its Jest config remain explicitly owned. The
inventory updater was not run because no Jest ownership changed.

### Validation And Accepted Boundary

Validation passes:

- expected-red missing-shadow command, exact reporter comparisons, unsharded
  unit/integration discovery, both package commands, and all eight `/4` probes;
- standalone strict/no-unchecked config typecheck with no new `any`, enum,
  assertion, suppression, or weak type boundary;
- clean Translation build and alias resolution;
- frozen offline install across all 86 workspaces, exact `workspace:*` policy,
  all seven dry graphs, exact inventory, Prettier, and diff hygiene;
- Cloudflare typecheck, 1,593-input composed import guard, and runtime-source
  guard;
- complete 262.3-second shared foundation: strict tooling, nine tooling tests,
  five-file Jest/Vitest parity, all 25 Jest-default selectors, real adapters,
  exact three-file/34-test adapter parity, fail-closed unsupported Vitest lanes,
  and exact inventory.

Installed Vite 8.1.4 continues to use the adopted Rolldown line and Vitest
remains 4.1.10; this turn changes neither dependency range nor lockfile. The
opt-in unit shadow needs no database, Redis, workerd, D1, GitHub repository
access, hosted Actions result, root verifier, workflow edit, or persistence/
production runtime claim. Persistent root typecheck ownership belongs to the
separate default cut-over.

## Translation Unit Vitest Default Ownership

Commit:

- `dc36f4cf40` (`test: switch Translation unit lane to Vitest`)

Date verified: 2026-07-15.

### Difference From Original Medusa

`@medusajs/translation` now uses the already-proven Vitest unit lane by default
while retaining the exact former Jest command as an explicit rollback:

```text
test              vitest run --config vitest.config.mts
test:jest         jest --passWithNoTests --bail --forceExit --testPathPattern=src
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The temporary `test:vitest` key is removed. The existing config is registered
exactly once in the root strict/no-unchecked test-runner tooling command. No new
verifier or tooling-contract source is needed: the package scripts, inventory,
strict config token, real commands, and existing graph verifiers own this
cut-over. No unit or integration test source, assertion, config behavior,
integration command, PGlite mapping, workflow, dependency, lockfile,
persistence, production, workerd, D1, or Cloudflare runtime changed.

### Exact Parity, Sharding, And Discovery

Four fresh machine-readable states compare exactly to the same frozen baseline:

| Runner/state           | Files | Passed | Failed | Skipped | Todo | Snapshots |
| ---------------------- | ----: | -----: | -----: | ------: | ---: | --------: |
| Jest before cut-over   |     1 |      1 |      0 |       0 |    0 |         0 |
| Vitest before cut-over |     1 |      1 |      0 |       0 |    0 |         0 |
| Vitest default after   |     1 |      1 |      0 |       0 |    0 |         0 |
| Jest rollback after    |     1 |      1 |      0 |       0 |    0 |         0 |

All preserve the repository-relative file, full name, passed status, 11 textual
assertions, and zero skipped/todo/snapshot state. Post-build Vitest list/default
execution still finds only `src/__tests__/static-manifest.spec.ts`; Jest
integration list-only still finds only the separate
`integration-tests/__tests__/translation-module-service.spec.ts`.

All package and direct root/Turbo `/4` commands pass at 1/0/0/0 with
`--maxWorkers=2 --passWithNoTests`. The first attempted wrapper form placed
`--shard` on Turbo rather than the package task and was rejected as invalid
evidence; direct `node_modules/.bin/turbo.cmd run test ... -- --shard=N/4`
proved the real root/Turbo forwarding boundary. No workflow change or dedicated
one-file unit job is required.

### Graphs, PGlite, And Remaining Jest

Dry ownership after the switch is exact:

- all units: 85/65/20, Translation once on Vitest;
- scoped Translation units: 1/1/0, on Vitest;
- general units: 83/63/20, Translation once on Vitest;
- Framework/Utils serial units: 2/2/0, without Translation;
- fast integrations: 47/28/19, Translation once on Jest;
- slow integrations: 5/5/0, without Translation;
- unsharded all integrations: 63/44/19, Translation once on Jest.

The ordered 25-lane PGlite matrix remains globally Jest-default. Explicit
`--runner=vitest --only=translation` still exits 1 before spawning because the
integration lane has no Vitest capability. Unit ownership does not imply
integration compatibility.

The reviewed inventory changes exactly one key: the byte-identical Translation
unit Jest command moves from `test` to `test:jest`. Counts remain 68 configs,
107 scripts across 68 owners, and 406 API files. The accepted digest becomes
`c41c83b8cfeee131d905cf5305199b1ba09636721e63fe39e07773c47b72e33f`;
the normalized inventory file hash becomes
`8ce2ad53831d57160e39312d79d2614c2289beda7205613882d0bf8ed699aa91`.

### Protected Hashes And Validation

Normalized-LF hashes before/after are:

- Translation manifest:
  `306a1e9abc2be602cf371ecdead6a74ca616958665e8269899b839432a5a68cc`
  to `499021a976bc0c3a750788465b0ab17a35353b025e5398823434e7eca7217c39`;
- root manifest:
  `63628f1f1a95973a977def1ccb24e02be7ca2a015c833092d1ceff434bdd30bb`
  to `044322509ea41f6c17c51b681248f0a3284f6606c4447d3f11a2998f7fd59cbf`;
- inventory file:
  `ae6c07deb5bcd6b02ccf4260adb59657ad6fcede3a35e3e2f9000b5b6287e95d`
  to `8ce2ad53831d57160e39312d79d2614c2289beda7205613882d0bf8ed699aa91`.

The Vitest config, Jest config, TypeScript config, unit source, integration
source/fixtures, workspace, lockfile, workflow, and PGlite orchestrator remain
at their Turn 48 hashes.

Validation passes:

- exact four-state reporter parity, post-build discovery/default execution,
  both package runners, all package/direct-Turbo `/4` probes, and all graphs;
- Translation build, persistent strict/no-unchecked tooling typecheck with the
  config exactly once, no new `any`, enum, assertion, suppression, or weak type
  boundary, and no new tooling source;
- exact inventory, frozen offline install across all 86 projects, `workspace:*`
  policy, Prettier, and diff hygiene;
- Cloudflare typecheck, 1,593-input composed import guard, and runtime-source
  import guard;
- complete 534.9-second foundation: strict tooling, nine tooling tests,
  five-file Jest/Vitest parity, all 25 Jest-default selectors, real adapters,
  exact three-file/34-test adapter parity, fail-closed unsupported Vitest lanes,
  and exact inventory.

Vite 8.1.4 and Vitest 4.1.10 remain installed without dependency resolution
changes. A 2026-07-21 registry refresh reports Vite 8.1.5 while Vitest and
coverage remain current at 4.1.10; that patch refresh is isolated to Turn 50.
Direct local/Turbo proof does not establish hosted Actions success. No GitHub
repository access, remote result, catalog/privacy/publication change, merge
work, persistence/runtime implementation, workerd, D1, or production Cloudflare
claim is included.

## Vite 8.1.5 Test-Runner Baseline

Commit:

- `c11241db2c` (`test: refresh Vite baseline to 8.1.5`)

Date verified: 2026-07-30.

### Difference From Original Medusa

The adopted fork test-runner baseline now resolves Vite 8.1.5 with its built-in
Rolldown path. Vitest and `@vitest/coverage-v8` remain 4.1.10. This is a
dependency-only refresh: no package test command, config, setup, source,
assertion, snapshot, runner ownership, rollback, PGlite selector, or workflow
owner changes.

The repository has no Vite pnpm-catalog entry. Vite ownership is one central
`overrides.vite` range plus four direct ranges in the root, Cloudflare app,
admin bundler, and admin Vite plugin manifests. All five move from `^8.1.4` to
`^8.1.5`. The regenerated lock moves all 39 Vite peer contexts, PostCSS from
8.5.16 to 8.5.20, and adds NanoID 3.3.16; Rolldown remains 1.1.5.

Fresh lock generation exposed the admin plugin's existing `fdir@6.1.1`
optional peer as Picomatch-3-only while the resolved graph supplies Picomatch 4.
The focused correction to current `fdir@6.5.0` accepts Picomatch `^3 || ^4`.
Its unchanged four-file/16-test suite and the real admin build consumers pass.
The peer audit returns only the four pre-existing unrelated Rollup, ESLint,
Tailwind, and AWS SDK groups, with no mismatch in this refreshed toolchain.

### Preserved Runner And Integration Behavior

The original nine Vitest workspaces still report exactly 494 files/622 tests,
including unchanged Icons and UI V8 coverage. All six migrated unit packages
and seven service-free migrated integration packages pass under both their
Vitest defaults and exact Jest rollbacks. Currency's 13-test and API Key's
25-test PGlite suites pass under both runners.

Remaining-Jest ownership is byte-identical at 68 configs, 107 scripts across 68
owners, and 406 API files. Translation remains Vitest-authoritative only for
unit tests and Jest-authoritative for integration; explicit Vitest PGlite
selection remains fail-closed. Workflow and PGlite orchestration hashes remain
`cae2adb1e7bdd055614c2f6d16494da915e24b85ab00ccf97f5e5748496ebc71`
and `86590a32be51db419d33054c29fa18599ff6781289b6324aeb7e59666e5008bd`.

### Validation

Validation passes:

- policy-clean lockfile-only generation and frozen install across all 86
  workspaces, exact `workspace:*` policy, installed-version reads, peer audit,
  strict tooling, and exact inventory;
- the complete migrated unit/service-free integration cross-runner matrix plus
  Currency/API Key PGlite cross-runner proof;
- admin Vite plugin, admin bundler, draft-order plugin, dashboard preview,
  Storybook, ordered portable core, and Cloudflare production builds;
- Cloudflare typecheck, 1,593-input composed import guard, portable entrypoint,
  real-module, and runtime-source audits, plus real Currency D1 behavior inside
  workerd;
- final 293.1-second shared foundation with nine tooling tests, five-file
  Jest/Vitest parity, 25 Jest-default integration selectors, exact
  three-file/34-test adapter parity, fail-closed unsupported Vitest lanes, and
  exact inventory.

No GitHub repository access or hosted Actions result is required for this local
gate. No persistence behavior, production runtime implementation, workerd/D1
implementation, privacy, publication, or repository-merge claim is included.

## Translation Integration Vitest Shadow

Commit:

- `e07b25bebc` (`test: add Translation integration Vitest shadow`)

Date verified: 2026-07-30.

### Difference From Original Medusa

Translation's unchanged module-service integration specification now has one
opt-in Vitest command and exact-file config. Jest remains authoritative through
the byte-identical `test:integration` value. The original service, test source,
60 test cases, 104 textual assertions, fixture, timeout, spy/type APIs, Jest
config, unit config, expected values, and persistence adapters are unchanged.

The new profile reuses `defineNodeVitestIntegrationConfig`, an absolute package
root, the existing five Translation aliases, and only
`integration-tests/__tests__/translation-module-service.spec.ts`. The typed
foundation contract freezes the command split, strict config registration,
immutable source/fixture/Jest/unit-config digests, new integration-config
digest, and absence of a root or workflow owner.

### PGlite And Foundation Routing

The serial PGlite matrix remains globally Jest-default and keeps all 25 lanes
in their established order. Translation's Jest route still invokes
`test:integration`; its explicit Vitest route invokes
`test:integration:vitest`. Both real selectors pass all 60 tests. Settings is
now the first unsupported Vitest lane, and direct/list/resume/matrix verifier
probes fail closed there before spawning.

Remaining-Jest counts stay at 68 configs, 107 scripts across 68 owners, and 406
API files. Only the expected verifier and orchestrator digests move; accepted
inventory digest becomes
`a2c432f27f7510d7871b1b8251d4bea2f293511e7a8dfa960eaff99f6ff91b96`.
All seven dry task graphs retain their exact 85/65/20, 1/1/0, 83/63/20,
2/2/0, 47/28/19, 5/5/0, and 63/44/19 shapes. Translation remains one Jest
integration task in fast/all; the shadow has no generic owner.

### Three-Backend Runner Parity

Pre-edit Jest and post-edit Jest/Vitest each passed one file and all 60 tests
on:

- MikroORM with an isolated PostgreSQL 18 cluster;
- the module-test PGlite adapter at `memory://`;
- Drizzle with Node SQLite `:memory:`.

All nine normalized reports preserve the exact repository-relative file, 60
full names/statuses, counts, and zero-snapshot state at digest
`8025698d0223bf2025a09234db22efbb35795bea399ad5f86b2d9b81cf53ea90`.
A real Vitest `run --shard=1/3` exits 1 before import because one test file
cannot satisfy three shards. The opt-in shadow therefore receives no root,
Turbo, workflow, aggregate, hosted-CI, or GitHub owner. That ownership belongs
to the later default cut-over.

### Validation And Accepted Boundary

Validation passes Translation build, Vitest unit default, Jest unit rollback,
both integration selectors, exact unsharded 60-test discovery, strict tooling,
nine tooling contracts, frozen offline install across all 86 workspaces,
`workspace:*` policy, exact inventory, and the complete 290.3-second runner
foundation. Cloudflare Vite 8.1.5 typecheck/build, the 1,593-input composed
import guard, portable-entrypoint/real-module/runtime-source audits, and real
Currency D1 behavior inside workerd also pass.

The isolated PostgreSQL server used `127.0.0.1:55440`; after proof, it was
stopped, the port had no listener, and the verified temporary data/log paths
were removed. The machine service and credentials were not changed.

No workflow, dependency, lockfile, assertion, fixture, persistence
implementation, production source, workerd/D1 implementation, Cloudflare
runtime, privacy/publication, or repository-merge change is included.

## Translation Integration Vitest Default Ownership

Commit:

- `0eeb819d16` (`test: switch Translation integration to Vitest`)

Date verified: 2026-07-30.

### Difference From Original Medusa

Translation's unchanged 60-test module-service integration specification now
runs through Vitest by default. The exact former Jest command is retained at
`test:integration:jest`; the temporary shadow key is removed. The service,
assertions, fixture, expected values, timeout, spy/type APIs, and all three
persistence implementations are unchanged.

The serial PGlite matrix remains globally Jest-default. Translation's Jest route
now selects the rollback command and its explicit Vitest route selects the
package default. Both real selectors pass all 60 tests, and Settings remains
the first fail-closed unsupported Vitest lane.

### Workflow And Aggregate Ownership

A real Vitest `run --shard=1/3` exits 1 because the suite has one file.
Translation is therefore excluded from only the generic fast package matrix.
The unsharded all-packages graph still owns it exactly once through Vitest.

The runner-neutral `translation-integration` job:

- depends on `setup`, runs on Ubuntu, and has no matrix, shard, CPU probe, or
  runner-named command;
- owns the standard PostgreSQL service and exact DB connection environment;
- restores the shared build artifact and runs
  `pnpm --filter @medusajs/translation test:integration` unsharded;
- is required by the stable package aggregate for failure, cancellation, skip,
  and success propagation under `always()`.

The typed contract parses and freezes the package scripts, immutable
source/config hashes, fast exclusion, exact job/service/steps, absence of
failure masking, and every aggregate terminal state.

### Exact Parity And Validation

Fresh pre-cut-over default/shadow and post-cut-over rollback/default reports
cover Jest and Vitest on PostgreSQL, PGlite, and Drizzle/SQLite. All 12 reports
normalize to the same one file, 60 full names/statuses, counts, zero-snapshot
state, and digest
`8025698d0223bf2025a09234db22efbb35795bea399ad5f86b2d9b81cf53ea90`.

Unit graph shapes remain 85/65/20, 1/1/0, 83/63/20, and 2/2/0. Fast
integration moves to 46/27/19 with Translation absent; slow remains 5/5/0;
unsharded all remains 63/44/19 with Translation once on Vitest. Remaining-Jest
counts remain 68 configs, 107 scripts, and 406 API files at accepted digest
`345a7cec5fdb071f78e9efadf91a3bdbd65e44912e14aaac1acd769d127a69e3`.

Validation passes Translation build/unit default/unit rollback, both PGlite
selectors, strict tooling, all nine typed contracts, frozen offline install
across 86 workspaces, exact `workspace:*` policy, the complete 282.8-second
runner foundation, and all Cloudflare portability/workerd gates.

The dedicated job's exact command passes locally against isolated PostgreSQL
18 on `127.0.0.1:55441`; the parsed local contract does not establish a hosted
Actions result. No GitHub repository access, dependency, lockfile, test source,
assertion, config, persistence implementation, production source, workerd/D1
implementation, privacy/publication, or merge change is included.

## Vite 8.2.0 Test-Runner Baseline

Commit:

- `f32d89b30f` (`test: refresh Vite baseline to 8.2.0`)

Date verified: 2026-07-30.

### Difference From Original Medusa

The adopted fork test-runner baseline now resolves npm-latest Vite 8.2.0 with
its built-in Rolldown 1.2.0 path. Vitest and `@vitest/coverage-v8` remain
4.1.10. This is a dependency-only refresh: no package test command, config,
setup, source, assertion, snapshot, runner ownership, rollback, PGlite selector,
or workflow owner changes.

Vite ownership remains one central `overrides.vite` range plus four direct
ranges in the root, Cloudflare app, admin bundler, and admin Vite plugin
manifests. All five move from `^8.1.5` to `^8.2.0`; no Vite catalog is
introduced.

Because Vite 8.2.0 was published inside the workspace minimum-release-age
window, pnpm adds one exact `vite@8.2.0` exception. Strict age policy remains
active for every other package. The lock contains 39 Vite 8.2.0 references,
17 Vite-bearing snapshot keys, and no Vite 8.1.5 reference. Its package delta
is limited to Vite's declared Rolldown, Lightning CSS, PostCSS, OXC,
platform-binding, and EMNAPI/Wasm runtime closure.

### Preserved Runner And Integration Behavior

The original nine Vitest workspaces still pass exactly 494 files/622 tests,
including DML's intentional zero-file pass and unchanged Icons/UI V8 coverage.
All seven unit/integration task graphs remain 85/65/20, 1/1/0, 83/63/20,
2/2/0, 46/27/19, 5/5/0, and 63/44/19. The complete foundation preserves the
five-file Jest/Vitest parity corpus, 25 Jest-default integration selectors,
exact three-file/34-test adapter parity, unsupported-lane fail closure, and
remaining-Jest ownership at 68 configs/107 scripts/406 API files.

Vite 8.2.0 emits warnings for existing extensionless test-config imports and
ESM config syntax loaded as CommonJS when describing a future native-loader
default. Current Vite 8.2/Vitest 4 behavior passes. Config module-identity
cleanup is not disguised as part of this dependency refresh.

Follow-up commit `b6071d16cd` (`fix: synchronize Vite 8.2 lock metadata`)
corrects five stale effective importer specifiers and eleven peer-range metadata
entries left at `^8.1.5` by the first lock serialization. The correction changes
no resolved package or snapshot key. The canonical lock now has hash
`2c9390dce87526e7f8ecef2c808f57ec2659befa0387bf88fb772c877c5204fe`,
39 Vite 8.2.0 references, and zero Vite 8.1.5 exact or range references. Frozen
offline installation and supply-chain policy pass against the corrected
committed metadata.

### Validation

Validation passes:

- lock generation, frozen install, and supply-chain policy across all 86
  workspaces; exact `workspace:*` policy; installed version reads; lock closure;
  and the same four unrelated peer-audit groups;
- every original Vitest owner plus coverage; admin plugin/bundler, draft-order,
  dashboard preview, Storybook, and ordered portable-core builds;
- Cloudflare typecheck and Vite 8.2.0 production build, the 1,593-input composed
  import guard, portable/real/runtime-source audits, and real Currency D1
  behavior inside workerd;
- the final 281.4-second complete test-runner foundation.

No GitHub repository access or hosted Actions result is required for this local
gate. No persistence behavior, production runtime implementation, workerd/D1
implementation, privacy/publication, or repository-merge claim is included.

## Settings Unit Vitest Shadow

Commit:

- `7360cb4030` (`test: shadow Settings unit lane with Vitest`)

Date verified: 2026-07-30.

### Difference From Original Medusa

`@medusajs/settings` retains both authoritative Jest commands byte-for-byte and
adds one opt-in unit shadow:

```text
test              jest --passWithNoTests --bail --forceExit --testPathPattern=src
test:vitest       vitest run --config vitest.config.mts
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The new package-local config uses `defineNodeVitestConfig`, an absolute package
root, canonical `src/` discovery globs, the Node/forks/SWC profile, and the same
five aliases as Settings' Jest config: `@models`, `@services`, `@repositories`,
`@types`, and `@utils`. It has no legacy Jest bridge or setup file. Its include
list cannot reach `integration-tests` or rebuilt `dist` copies.

No production source, unit source, assertion, expected value, Jest config,
integration source/command, dependency, lockfile, root script, PGlite
capability, workflow, persistence adapter, workerd, D1, or Cloudflare runtime
changed.

### Frozen Unit Boundary And Exact Parity

The authoritative unit lane is exactly:

- `src/__tests__/static-manifest.spec.ts`;
- full name
  `Settings static manifest matches the normal Settings module export and explicit static resources`;
- one passed test with ten textual assertions: five `toBe`, four `toEqual`,
  and one `toMatchObject`;
- zero Jest APIs, mocks, hooks, async cases, skips, todos, snapshots,
  environment reads, network calls, database setup, or external services.

The repository's canonical result normalizer proves exact pre-edit Jest,
post-edit Jest, and Vitest parity: one file, one passed test, the same full
name/status, zero failures/skips/todos, and zero snapshots. Unsharded Vitest
discovery returns only the source unit file. Jest integration discovery still
returns only `integration-tests/__tests__/settings-module.spec.ts`, which keeps
its `jest.setTimeout(30000)`, 11 async cases, and database-backed module runner.

Both runners pass all four real unit shards with `--maxWorkers=2
--passWithNoTests`: shard 1 runs the sole test and shards 2-4 exit zero empty.
The opt-in shadow has no persistent root, Turbo, workflow, shard, or aggregate
owner.

### Preserved Graph And PGlite Boundaries

Dry ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integrations: 46/27/19, 5/5/0, and 63/44/19.

Settings remains Jest-owned once in all, scoped, and general units and in fast
and all integrations. The ordered 25-lane PGlite matrix still places Settings
fifth. Explicit `--runner=vitest --only=settings` fails closed before spawning
because only the Jest integration runner is supported.

### Protected Hashes And Validation

Normalized-LF SHA-256 values are:

- Settings manifest:
  `50a9c61938b34beced24c1b4cfeb7cab2300f76ac03a3795cd00b7f296eda1fe`
  to `5ebf3c6e1eb7bfb398b9764e0f47c855729fa31ac3b1f4bfcc2fb50cbc401b09`;
- new Vitest config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- unchanged unit source, Jest config, TypeScript config, and integration source:
  `28415d1a9bad8360b20e458ce4bc9abc886824ff0c3c46b943d105b73f3f9dcb`,
  `abe0c3cacda174ac06f22404fe754c2d9a762c311164b6f97bd23ac0cd89a470`,
  `f32039f892e4b6995f132bb8679d21f3d5528dfa51cce1f96002a110de1b8f95`,
  and `672ffc69ac91c98fc19ab19ccd1490f4f18157a66b8246bb3b71615aed9e9df5`.

Validation passes the expected-red missing-shadow check; Settings build;
standalone strict/no-unchecked config typecheck; canonical exact result
comparison; source/integration discovery; all eight `/4` probes; frozen offline
install across 86 workspaces; `workspace:*` policy; all seven task graphs;
exact inventory; and the complete 286-second foundation. Cloudflare Vite 8.2.0
typecheck/build, the 1,593-input composed guard, portable/real/runtime-source
audits, and real Currency D1 behavior inside workerd also pass.

The existing Vite 8.2 future native-loader warning covers the new config's
extensionless shared-config import; current behavior passes and module-identity
cleanup remains a separate repository-wide concern. No GitHub repository access
or hosted result is required for this manual shadow gate.

## Settings Unit Vitest Default Ownership

Commit:

- `bd02b6d954` (`test: switch Settings unit lane to Vitest`)

Date verified: 2026-07-30.

### Difference From Original Medusa

Settings' already-proven source unit lane now defaults to Vitest:

```text
test              vitest run --config vitest.config.mts
test:jest         jest --passWithNoTests --bail --forceExit --testPathPattern=src
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The exact former Jest command remains available as the explicit rollback and
the temporary shadow key is removed. The existing Vitest config is registered
exactly once in the persistent root strict/no-unchecked typecheck. No new
TypeScript source, assertion, setup, config behavior, dependency, lockfile,
integration capability, workflow owner, persistence adapter, production
runtime, workerd, D1, privacy/publication, or merge behavior is added.

### Exact Pre/Post Parity And Sharding

The canonical result normalizer proves every compared pre/post pair at one
file, one passed test, the same full name/status, zero
failures/skips/todos/snapshots, and unchanged ten-assertion source:

- pre-cut-over Jest default versus Vitest shadow;
- pre-cut-over Jest default versus post-cut-over Vitest default;
- post-cut-over Jest rollback versus post-cut-over Vitest default;
- post-cut-over Jest rollback versus pre-cut-over Vitest shadow.

Both real post-cut-over runners pass `/4` with `--maxWorkers=2
--passWithNoTests`: shard 1 runs the sole test and shards 2-4 exit zero empty.
Unsharded Vitest discovery remains source-only.

### Preserved Integration And Task Ownership

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0. Only Settings' unit command changes from Jest to Vitest in the first
three graphs.

Fast/slow/all integration graphs remain 46/27/19, 5/5/0, and 63/44/19.
Settings remains owned once through its byte-identical Jest integration command
in fast and all. Jest discovery still returns only the separate 11-case
database-backed integration file. The ordered 25-lane PGlite matrix still puts
Settings fifth, and explicit `--runner=vitest --only=settings` fails closed
before spawning.

### Inventory, Hashes, And Validation

Remaining-Jest ownership moves only the identical Settings unit command from
`test` to `test:jest`. Counts stay 68 configs, 107 scripts, and 406 API files;
the digest changes from
`345a7cec5fdb071f78e9efadf91a3bdbd65e44912e14aaac1acd769d127a69e3`
to `d87dc3c4caa49878ddd77802f9f0276d558c1000eebe13c44f2ce62ac9e44757`.

Normalized-LF SHA-256 values move:

- Settings manifest:
  `5ebf3c6e1eb7bfb398b9764e0f47c855729fa31ac3b1f4bfcc2fb50cbc401b09`
  to `8b83739025b0e6f6cf21f28762a4c05a9ceb06b78932c1c5f3b1a7851c4032c6`;
- root manifest:
  `f142205ee3b8ea1938bdc0792aedea1fae9bc366374fec557c4caa77777408a9`
  to `b6cd530ce4d1440cd31b1d53f2dfec86d6291e6d4922b4446273cc30dee60523`;
- inventory file:
  `9de145966b8db11c147f24d7063f729c72141280e8c5629604331c82fb01d194`
  to `e7d2e6a76eaacae3c964a14fab6edfd9388dbac2b318ea93540505abcef2beaa`.

Config, source, Jest/TypeScript config, integration source, workflow, PGlite
orchestrator, workspace, and corrected lockfile hashes remain unchanged.

Validation passes the expected-red missing-rollback command, all exact reporter
comparisons, both `/4` matrices, source/integration discovery, Settings build,
persistent strict tooling, frozen offline install across 86 workspaces,
`workspace:*` policy, all seven graphs, exact inventory, and the complete
294.9-second foundation. Cloudflare Vite 8.2.0 typecheck/build, the 1,593-input
composed guard, portable/real/runtime-source audits, and real Currency D1
behavior inside workerd also pass. Wrangler's cleanup subprocess reached its
bounded timeout, but the lifecycle assertion passed and a process audit found
no leftover Vite or Wrangler process.

The existing Vite future-native-loader warning remains an inherited
repository-wide cleanup item. No GitHub repository access or hosted result is
required for this unit cut-over.

## Settings Integration Vitest Shadow

Commit:

- `bc15396832` (`test: add Settings integration Vitest shadow`)

Date verified: 2026-07-30.

### Difference From Original Medusa

Settings' unchanged integration lane remains Jest-authoritative and gains one
manual Vitest shadow:

```text
test:integration         jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The package-local profile uses the canonical serial Node integration config,
the existing environment setup and limited Jest bridge, Settings' same five
aliases, and exactly
`integration-tests/__tests__/settings-module.spec.ts`. It is registered once
in persistent strict/no-unchecked tooling. The source, Jest config, unit
default/rollback, persistence adapters, dependencies, lockfile, workflow,
production runtime, workerd, and D1 composition do not change.

### Exact Three-Backend Parity

The unchanged file owns 11 async tests, 29 textual assertions, one
`jest.setTimeout(30000)`, and zero skips, todos, or snapshots. Pre-edit Jest,
post-edit Jest, and post-edit Vitest each pass one file and all 11 tests on
MikroORM/PostgreSQL, PGlite, and Drizzle/SQLite.

All nine reports normalize to the same repository-relative file, full
names/statuses, counts, zero-snapshot state, and digest
`1131bec9188e368dec5fd14f0dcf36849957697d7b2b21316fbca10854df5a6b`.
The source digest remains
`672ffc69ac91c98fc19ab19ccd1490f4f18157a66b8246bb3b71615aed9e9df5`.

The isolated PostgreSQL 18 cluster on `127.0.0.1:55442` was stopped after the
proof, its port was verified closed, and its temporary data/log artifacts were
removed without reading or modifying the machine service.

### Selector, Shard, Graph, And Inventory Boundaries

Both real Settings PGlite selectors pass all 11 tests. The ordered 25-lane
matrix remains globally Jest-default, Settings is now explicitly
Vitest-capable, and Store becomes the next fail-closed frontier before
spawning.

Each authentic Vitest `/3` invocation exits 1 before import because three
shards cannot be formed from one file. The shadow therefore has no root
execution script, Turbo, workflow, sharded CI, aggregate, hosted-CI, or GitHub
owner.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0. Fast/slow/all integration graphs remain 46/27/19, 5/5/0, and 63/44/19;
Settings remains Jest-owned once in fast/all.

Remaining-Jest counts stay 68 configs, 107 scripts, and 406 API files. Only
the hashes of the already-inventoried PGlite orchestrator and integration
foundation verifier move, yielding accepted digest
`336bfe35a03d775627c2dd71626121c3e1749aa7a8c4f0fc33cd6c307b23862a`.

### Validation And Ownership Hashes

Validation passes Settings build/unit default/unit rollback; strict tooling and
nine tooling tests; exact nine-state backend parity; both PGlite selectors;
Store fail closure; all task graphs; frozen offline install across 86
workspaces; exact `workspace:*` and inventory; the complete 268.8-second
foundation; Cloudflare Vite 8.2.0 typecheck/build; the 1,593-input composed
guard; portable/real/runtime-source audits; and real Currency D1 behavior
inside workerd. Wrangler cleanup reached its inherited bounded timeout, while
the lifecycle assertion passed and a process/port audit found no leftover
Vite, Wrangler, or workerd process.

Normalized-LF hashes are:

- new Settings integration config:
  `7a162924556ae07e68c3fd942989d8674818ad0a17c0f36cdaf3e5b8fc73fbc0`;
- Settings manifest:
  `8b83739025b0e6f6cf21f28762a4c05a9ceb06b78932c1c5f3b1a7851c4032c6`
  to `ba5759d30088307ca2efc38406cf820d7593ea3933533ad730e50c54bd682edd`;
- root manifest:
  `b6cd530ce4d1440cd31b1d53f2dfec86d6291e6d4922b4446273cc30dee60523`
  to `a32e1cbe30f08d39c7f0ff83bbfe75140402af6baa314b459efc998e02874cbd`;
- PGlite orchestrator:
  `225849e0794ee04133ffa3b8c62b9eff2a098db4d474925fb8a29028c1076fb2`
  to `1696c296bc652bf75dd5c672a81c659de42f4bb3543f6c58cb1d3704b52d69bf`;
- integration foundation verifier:
  `25c0ac49f24b6353fb292ae675cf31b67d30d1663dbfa0e5f2f074fe5a602d4d`
  to `39d66592e640f2da340437c3f770c6276ee9dedcaba82e2b01e03743d63ffd5c`;
- strict ownership contract:
  `2285f6627971c3afa728b28e6cae31960832757451069f34402ac28752b3e09e`
  to `2099eae531ba645d007b5a9964b1325947447afe0f7d5c2fd8c31fe002e86cee`;
- inventory:
  `e7d2e6a76eaacae3c964a14fab6edfd9388dbac2b318ea93540505abcef2beaa`
  to `959428f8cf0d01d1385c6b0d38d309b3ed7636dac7e49e0b371818677abd5fca`.

The existing Vite future-native-loader warning remains a repository-wide
cleanup item and is not hidden in this package migration.

## Settings Integration Vitest Default Ownership

Commit:

- `118ff23c15` (`test: switch Settings integration to Vitest`)

Date verified: 2026-07-30.

### Difference From Original Medusa

Settings' unchanged integration lane now defaults to Vitest:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The exact former Jest command is retained as the rollback and the temporary
shadow key is removed. The global PGlite matrix remains Jest-default:
unqualified Settings selection invokes the rollback, while explicit Vitest
selection invokes the package default.

The one-file suite is excluded from the generic `/3` fast graph and is owned by
one dedicated, unsharded, runner-neutral `Settings Integration` PostgreSQL job.
The stable aggregate now requires that job and propagates its failure,
cancelled, skipped, and success states. The typed workflow contract freezes the
service, credentials, steps, exact package command, lack of matrix strategy,
and runner-neutral name. No GitHub access or hosted result is claimed.

No source test, assertion, fixture, expected value, config behavior,
dependency, lockfile, persistence adapter, production runtime, workerd, D1,
privacy/publication, or repository-merge behavior changed.

### Exact Backend And Rollback Proof

Fresh pre-cut-over Jest/Vitest and post-cut-over default/rollback reports cover
all 12 runner/backend/ownership states across isolated PostgreSQL 18, PGlite,
and Drizzle/SQLite. Every report preserves the same one source file, 11 passed
tests, full names/statuses, zero failures/skips/todos/snapshots, and normalized
digest
`1131bec9188e368dec5fd14f0dcf36849957697d7b2b21316fbca10854df5a6b`.

Both real Settings PGlite selectors pass all 11 tests. Store remains the first
unsupported Vitest lane and fails closed before spawning. The exact workflow
command passes against the isolated PostgreSQL cluster on
`127.0.0.1:55443`. After validation the cluster was stopped, ports `55443` and
`8791` were closed, no scoped Vite/Wrangler/workerd process remained, and all
temporary cluster/report artifacts were removed.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0. Fast integration moves from 46/27/19 to 45/26/19 with Settings absent;
slow remains 5/5/0; all remains 63/44/19 with Settings owned exactly once by
Vitest. All three direct Settings `/3` runs still exit 1, proving why the
dedicated unsharded owner is required.

### Inventory, Hashes, And Validation

Remaining-Jest ownership moves only the byte-identical Settings command from
`test:integration` to `test:integration:jest`, plus the expected PGlite
orchestrator digest. Counts remain 68 configs, 107 scripts, and 406 API files;
the accepted digest moves from
`336bfe35a03d775627c2dd71626121c3e1749aa7a8c4f0fc33cd6c307b23862a`
to `85c05079e8eb99e90f64152fae9d6cdf4b584e7e346f10c9624ed5ec78ade22c`.

Normalized-LF SHA-256 values move:

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

The integration config, assertion source, foundation verifier, workspace, and
lockfile remain
`7a162924556ae07e68c3fd942989d8674818ad0a17c0f36cdaf3e5b8fc73fbc0`,
`672ffc69ac91c98fc19ab19ccd1490f4f18157a66b8246bb3b71615aed9e9df5`,
`39d66592e640f2da340437c3f770c6276ee9dedcaba82e2b01e03743d63ffd5c`,
`af3ec0941ce1dc79137f176286d051fd92f228f728ef0dd7ea32a4271e72cb63`,
and `2c9390dce87526e7f8ecef2c808f57ec2659befa0387bf88fb772c877c5204fe`.

Validation passes Settings build/unit default/unit rollback, strict tooling,
exact 12-state backend parity, both PGlite selectors, Store fail closure, all
task graphs, frozen offline install across 86 workspaces, exact `workspace:*`
and inventory, the complete 295.8-second foundation, Cloudflare Vite 8.2.0
typecheck/build, the 1,593-input composed import guard, portable/real/runtime
source audits, and real Currency D1 behavior inside workerd.

## Store Unit Vitest Shadow

Commit:

- `54c2aef227` (`test: shadow Store unit lane with Vitest`)

Date verified: 2026-07-30.

### Difference From Original Medusa

`@medusajs/store` retains both authoritative Jest commands byte-for-byte and
adds one opt-in unit shadow:

```text
test              jest --bail --forceExit --testPathPattern=src
test:vitest       vitest run --config vitest.config.mts
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The package-local config uses `defineNodeVitestConfig`, an absolute package
root, canonical `src/` discovery globs, the Node/forks/SWC profile, and Store's
same five aliases: `@models`, `@services`, `@repositories`, `@types`, and
`@utils`. It has no setup file or legacy Jest bridge. Its include list cannot
reach `integration-tests` or rebuilt `dist` copies.

No production source, test source, assertion, expected value, Jest config,
integration command/capability, dependency, lockfile, root script, PGlite
mapping, workflow, persistence adapter, workerd, D1, privacy/publication, or
repository-merge behavior changed.

### Corrected Two-File Boundary And Exact Parity

The pre-edit audit corrected the planned one-file assumption. Store's Jest unit
command authoritatively discovers two files and two tests:

- `src/__tests__/static-manifest.spec.ts` owns
  `Store static manifest matches the normal Store module export and joiner config`
  with five textual assertions;
- `src/services/__tests__/noop.ts` owns `noop should run` with one textual
  assertion.

Together they own six assertions, zero Jest APIs, hooks, mocks, async tests,
skips, todos, snapshots, environment reads, network access, database setup, or
external services. The static-manifest source retains its existing narrowed
`IModuleService` type assertion; this turn does not rewrite test source.

Canonical normalization proves exact pre-edit Jest, post-edit Jest, and Vitest
parity: two files, two passed tests, the same full names/statuses, zero
failures/skips/todos/snapshots, and digest
`90a03ed5034fa67349c6d826af88f8dc229553a33e0737150b8a7bdd6dc10c3f`.
Vitest discovery remains exactly those two source files after Store is built,
with no integration or `dist` copy.

Both runners pass all four real unit shards with `--maxWorkers=2
--passWithNoTests` at 1/1/0/0. Aggregate signatures cover both authoritative
files and full test names exactly once for each runner.

### Preserved Integration And Ownership Boundaries

Jest integration discovery remains only
`integration-tests/__tests__/store-module-service.spec.ts`, including its
`jest.setTimeout(100000)` and database-backed module runner. The ordered
25-lane PGlite matrix keeps Store on Jest; explicit
`--runner=vitest --only=store` still fails closed before spawning.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0, with Store Jest-owned once in the first three. Fast/slow/all integration
graphs remain 45/26/19, 5/5/0, and 63/44/19, with Store Jest-owned once in fast
and all. The opt-in shadow has no persistent root, Turbo, workflow, shard, or
aggregate owner.

Remaining-Jest ownership is byte-identical at 68 configs, 107 scripts, 406 API
files, and digest
`85c05079e8eb99e90f64152fae9d6cdf4b584e7e346f10c9624ed5ec78ade22c`.

### Protected Hashes And Validation

Normalized-LF SHA-256 values are:

- Store manifest:
  `188723695900f67ed0b818e705c72c590234fdcee0ba71f07d0d75f8509a67e3`
  to `6111814288334b0aee162f5428bb351284eb1eb939cd17277c99ef5c7a2506a1`;
- new Vitest config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- unchanged unit sources:
  `e5466c1d0108bf1a5a8cc816e2656f5c52f043d9780597df415ffd4737b3f7e4`
  and
  `a8fce584e64fea146c0a551341a1a9e7effd794270765f7bebd9347c4942b75d`;
- unchanged Jest config, TypeScript config, and integration source:
  `22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76`,
  `e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a`,
  and
  `0ab033fde113a47dd26cf93144b35622e3e2ef94f01d0a7b5fd72b939ae2088c`.

Validation passes the expected-red missing-shadow check; Store build;
standalone strict/no-unchecked config typecheck; canonical exact result
comparison; post-build source/integration discovery; both complete `/4`
matrices and aggregate signatures; Store PGlite fail closure; frozen offline
install across 86 workspaces; exact `workspace:*`; all seven task graphs; exact
inventory; and the complete 276.3-second foundation. Cloudflare Vite 8.2.0
typecheck/build, the 1,593-input composed guard, portable/real/runtime-source
audits, and real Currency D1 behavior inside workerd also pass. Port `8791` is
closed and no scoped Vite/Wrangler/workerd process remains.

The inherited Vite future-native-loader warning covers the new config's
extensionless shared-config import. Current Vite 8.2/Vitest 4 execution passes;
module-identity cleanup remains a separate repository-wide concern.

## Store Unit Vitest Default

Commit:

- `4853277b69` (`test: switch Store unit lane to Vitest`)

Date verified: 2026-07-30.

### Difference From Original Medusa

Store's already-proven two-file unit lane now defaults to Vitest while the exact
former Jest command remains the explicit rollback:

```text
test              vitest run --config vitest.config.mts
test:jest         jest --bail --forceExit --testPathPattern=src
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The temporary `test:vitest` shadow key is removed. The existing source-only
config is registered exactly once in persistent strict/no-unchecked test-runner
tooling. No test source, assertion, expected value, config behavior,
integration capability, dependency, lockfile, workflow, PGlite route,
persistence adapter, production runtime, workerd/D1 behavior,
privacy/publication, or repository-merge behavior changed.

### Exact Cut-Over And Rollback Proof

Fresh pre-cut-over Jest and Vitest reports and fresh post-cut-over default and
rollback reports all contain exactly the same two files, two passed tests, full
names/statuses, zero failures/skips/todos/snapshots, six textual assertions,
and normalized digest
`90a03ed5034fa67349c6d826af88f8dc229553a33e0737150b8a7bdd6dc10c3f`.

Both runners pass fresh pre- and post-cut-over `/4` matrices at 1/1/0/0.
Every matrix aggregates to the exact two files and two signatures once, with
no duplicate or missing ownership.

Store integration discovery remains only
`integration-tests/__tests__/store-module-service.spec.ts`. The ordered
25-lane PGlite matrix still maps Store only to Jest, and explicit
`--runner=vitest --only=store` still fails closed before spawning.

### Persistent Ownership And Inventory

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0. Store is Vitest-owned exactly once in all, scoped, and general units and
absent from serial units. Fast/slow/all integration graphs remain 45/26/19,
5/5/0, and 63/44/19; Store remains Jest-owned exactly once in fast and all and
absent from slow.

Remaining-Jest counts remain 68 configs, 107 scripts, and 406 API files. The
only ownership change moves Store's byte-identical Jest unit command from
`test` to `test:jest`; accepted digest changes from
`85c05079e8eb99e90f64152fae9d6cdf4b584e7e346f10c9624ed5ec78ade22c`
to
`f072923b9665dd48a67dc4a5f7611cd633d94cbfeba0264a1fe8e1f467f28572`.

### Protected Hashes And Validation

Normalized-LF SHA-256 values are:

- root manifest:
  `fcd05db692b4f7f6684baa2302d890336cb7dbd614f21d5f653a0c761549f661`
  to `99f3a85377d4eb6e9321fa254ae0071d9413b820e6978ead7c9baa30eacf34d0`;
- Store manifest:
  `6111814288334b0aee162f5428bb351284eb1eb939cd17277c99ef5c7a2506a1`
  to `6c4815417064e434470c149c6e773b22edd77e7eff06aa2714b30ad78b824d69`;
- unchanged Store Vitest config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- unchanged unit sources:
  `e5466c1d0108bf1a5a8cc816e2656f5c52f043d9780597df415ffd4737b3f7e4`
  and
  `a8fce584e64fea146c0a551341a1a9e7effd794270765f7bebd9347c4942b75d`;
- unchanged Jest config and integration source:
  `22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76`
  and
  `0ab033fde113a47dd26cf93144b35622e3e2ef94f01d0a7b5fd72b939ae2088c`.

Validation passes strict/no-unchecked config ownership, Store build, frozen
offline install across 86 workspaces, exact `workspace:*`, exact inventory,
all four result comparisons, both fresh pre/post runner matrices, preserved
integration discovery and PGlite fail closure, all seven task graphs, and the
complete 300.2-second foundation. Cloudflare Vite 8.2.0 typecheck/build,
Rolldown 1.2.0, the 1,593-input composed guard, portable/real/runtime-source
audits, and real Currency D1 behavior inside workerd also pass. Port `8791` is
closed and no scoped Vite/Wrangler/workerd process remains.

## Store Integration Vitest Shadow

Commit:

- `c292d65a57` (`test: add Store integration Vitest shadow`)

Date verified: 2026-07-30.

### Difference From Original Medusa

Store's unchanged database-backed integration lane remains Jest-authoritative
and gains one manual Vitest shadow:

```text
test:integration         jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The package-local profile uses the canonical serial Node integration config,
the existing environment setup and limited Jest bridge, Store's same five
aliases, and exactly
`integration-tests/__tests__/store-module-service.spec.ts`. It is registered
once in persistent strict/no-unchecked tooling. Source, fixture, Jest/unit
configs, unit default/rollback, persistence adapters, dependencies, lockfile,
workflow, production runtime, workerd, D1, privacy/publication, and
repository-merge behavior do not change.

### Exact Three-Backend Parity

The unchanged file owns 12 async tests, 15 textual assertions, one
`jest.setTimeout(100000)`, and zero skips, todos, or snapshots. Pre-edit Jest,
post-edit Jest, and post-edit Vitest each pass the same one file and all 12
tests on:

- MikroORM with isolated PostgreSQL 18;
- the PGlite module-test adapter at `memory://`;
- the Drizzle test adapter with Node SQLite `:memory:`.

All nine reports normalize to the same repository-relative file, full
names/statuses, counts, zero-snapshot state, and digest
`19726c857ba3909d0e724c0d90e365b22c19378e5fe9d966fdf2313f2a22866b`.
PGlite is not Drizzle/SQLite, and neither local adapter is D1 or Durable Object
SQLite.

The isolated PostgreSQL 18 cluster used `127.0.0.1:55444` with trust
authentication. It was stopped after parity, the port was verified closed,
and its temporary data and log artifacts were removed without reading or
changing the machine service.

### Selector, Shard, Graph, And Inventory Boundaries

Both real Store PGlite selectors pass all 12 tests. The ordered 25-lane matrix
remains globally Jest-default, Store is now explicitly Vitest-capable, and Auth
becomes the next fail-closed frontier before spawning.

Each authentic Store Vitest `/3` invocation exits 1 before import because three
shards cannot be formed from one file. The shadow therefore has no root
execution script, Turbo, workflow, sharded CI, aggregate, hosted-CI, or GitHub
owner.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0. Fast/slow/all integration graphs remain 45/26/19, 5/5/0, and 63/44/19;
Store remains Jest-owned once in fast and all.

Remaining-Jest counts stay 68 configs, 107 scripts, and 406 API files. Only
the hashes of the already-inventoried PGlite orchestrator and integration
foundation verifier move, changing the accepted digest from
`f072923b9665dd48a67dc4a5f7611cd633d94cbfeba0264a1fe8e1f467f28572`
to
`0bdc0cf1c8f889f36319dc8a60c9e99512a08680ab0841d28870e2313574c098`.

### Validation And Ownership Hashes

Normalized-LF SHA-256 values are:

- new Store integration config:
  `72604382520d901bd177420fed668dea22347518b1a343705f6ea121ff13bce9`;
- Store manifest:
  `6c4815417064e434470c149c6e773b22edd77e7eff06aa2714b30ad78b824d69`
  to `ab85ee6ad7645c1f0d964d5f8661007242a4be8bcec45862dcc80aa9b0acf478`;
- root manifest:
  `99f3a85377d4eb6e9321fa254ae0071d9413b820e6978ead7c9baa30eacf34d0`
  to `e5830ea871b811ee439650280cc88f3f46c4cc66541fe034973ec9e9c6c1fc3a`;
- PGlite orchestrator:
  `7bc65022a844a8edf2a3d611e555f92bb014235a1128d01bd25e077076616c27`
  to `c0d208629ae75c98348c06e3f082f65bcc065839d2a3ea184d37918455115b6b`;
- integration foundation verifier:
  `39d66592e640f2da340437c3f770c6276ee9dedcaba82e2b01e03743d63ffd5c`
  to `02706348c87c847c641edd84d6ad1c067d588d6413c9bc1462c9edef3cb77db8`;
- unchanged integration source and fixture:
  `0ab033fde113a47dd26cf93144b35622e3e2ef94f01d0a7b5fd72b939ae2088c`
  and
  `759ef4e1e67efe309e30c77aae52bfa0bbd5da94754423cc6a8623a1672553df`.

Validation passes Store build/unit default/unit rollback; strict tooling; exact
nine-state backend parity; both real PGlite selectors; Auth fail closure; all
three authentic `/3` probes; all seven task graphs; frozen offline install
across 86 workspaces; exact `workspace:*` and inventory; and the complete
332.2-second foundation. Cloudflare Vite 8.2.0 typecheck/build, Rolldown 1.2.0,
the 1,593-input composed guard, portable/real/runtime-source audits, and real
Currency D1 behavior inside workerd also pass. Port `8791` is closed and no
scoped Vite/Wrangler/workerd process remains.

## Store Integration Vitest Default

Commit:

- `57b24eaddd` (`test: switch Store integration to Vitest`)

Date verified: 2026-07-30.

### Difference From Original Medusa

Store's unchanged database-backed integration lane now defaults to Vitest:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The exact former Jest command is retained as the rollback and the temporary
shadow key is removed. The global 25-lane PGlite matrix remains Jest-default:
Store's Jest selector invokes `test:integration:jest`, while explicit Vitest
selection invokes the package default. Auth remains fail-closed for explicit
Vitest selection.

Because the single Store file cannot consume `/3` sharding, the generic fast
graph excludes Store. A dedicated runner-neutral, unsharded PostgreSQL job owns
the default command and is propagated through both terminal states of the
stable integration aggregate. No source, fixture, assertion, expected value,
config behavior, persistence adapter, dependency, lockfile, production
runtime, workerd/D1 behavior, privacy/publication, or repository-merge
behavior changed.

### Exact Cut-Over And Rollback Proof

Fresh pre-cut-over Jest and Vitest reports and fresh post-cut-over default and
rollback reports each pass the same one file and 12 tests separately on
PostgreSQL 18, PGlite `memory://`, and Drizzle with Node SQLite `:memory:`.
All 12 runner/backend/ownership states normalize to the same repository-relative
file, full test names/statuses, counts, zero-snapshot state, and digest
`19726c857ba3909d0e724c0d90e365b22c19378e5fe9d966fdf2313f2a22866b`.

Both real PGlite selectors pass 12/12. Auth rejects unsupported explicit Vitest
selection before spawning. All three authentic Store `/3` invocations exit 1
before import because the shard count exceeds the one-file suite, confirming
the dedicated job must remain unsharded. The exact dedicated default command
passes 12/12 against isolated PostgreSQL.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0. Fast integration moves from 45/26/19 to 44/25/19 with Store absent;
slow remains 5/5/0; all remains 63/44/19 with Store owned exactly once by
Vitest.

Remaining-Jest counts remain 68 configs, 107 scripts, and 406 API files. The
exact Store command moves from `test:integration` to
`test:integration:jest`, and the already-inventoried PGlite orchestrator hash
moves. Accepted ownership digest changes from
`0bdc0cf1c8f889f36319dc8a60c9e99512a08680ab0841d28870e2313574c098`
to
`bf09ea4647e8eb27fa1baa019c1ec531b56319b5a21f3992141aa0be9e663849`.

### Protected Hashes And Validation

Normalized-LF SHA-256 values are:

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
  to `1009b9a3038877d0d290f33b26b07c633a148100353f2626fd2b507810126723`;
- unchanged integration config, source, and fixture:
  `72604382520d901bd177420fed668dea22347518b1a343705f6ea121ff13bce9`,
  `0ab033fde113a47dd26cf93144b35622e3e2ef94f01d0a7b5fd72b939ae2088c`,
  and
  `759ef4e1e67efe309e30c77aae52bfa0bbd5da94754423cc6a8623a1672553df`.

Validation passes Store build/unit default/unit rollback; strict tooling; exact
12-state three-backend parity; both PGlite selectors; Auth fail closure; all
three `/3` probes; the dedicated PostgreSQL command; all seven task graphs;
frozen offline install across 86 workspaces; exact `workspace:*` and inventory;
and the complete 360.6-second foundation. Cloudflare Vite 8.2.0 typecheck/build,
built-in Rolldown 1.2.0, the 1,593-input composed guard,
portable/real/runtime-source audits, and real Currency D1 behavior inside
workerd also pass. PostgreSQL port `55445` and workerd port `8791` are closed,
temporary database/report artifacts are removed, and no scoped runtime process
remains.

The parsed workflow shape and local command do not establish a hosted GitHub
Actions result. The dedicated job proves the Vitest default against PostgreSQL
only; local PGlite/Drizzle/Jest rollback parity remains separate evidence.

## Auth Unit Vitest Shadow

Commit:

- `e7ff8ccb61` (`test: shadow Auth unit lane with Vitest`)

Date verified: 2026-07-30.

### Difference From Original Medusa

Auth keeps both authoritative Jest commands and adds only:

```text
test:vitest  vitest run --config vitest.config.mts
```

The new source-only profile uses the canonical Node/forks/SWC configuration,
the same four aliases as Auth's Jest and TypeScript configs, and only canonical
`src` discovery globs. It does not enable the legacy Jest bridge because the
unit source owns no Jest-only API.

The audit freezes one source file, one test, ten textual assertions, zero
Jest APIs, and zero snapshots. Auth's three database-backed integration files
remain outside this turn. Both Jest commands, unit and integration default/CI
ownership, PGlite routing, workflow, dependencies, lockfile, persistence,
production runtime, workerd/D1 behavior, privacy/publication, and
repository-merge behavior remain unchanged.

### Exact Shadow And Shard Proof

Fresh pre-edit Jest, post-edit Jest, post-edit Vitest, and post-build Vitest
reports all contain exactly
`packages/modules/auth/src/__tests__/static-manifest.spec.ts`, the same full
test name/status, one passed test, zero failures/skips/todos/snapshots, and
normalized digest
`4d55bc4e4dd8e8e6ad3741be3946df33f51a32f8c0f494370284025420f007d8`.
Post-build Vitest discovers no `dist` or integration copy.

Both real Jest and Vitest `/4` matrices pass with `--passWithNoTests` at
1/0/0/0. Each aggregate owns the one full test signature exactly once. The
explicit Auth integration PGlite Vitest selector still fails closed before
spawning.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0. Fast/slow/all integration graphs remain 44/25/19, 5/5/0, and 63/44/19.
Auth remains Jest-owned once in all/scoped/general unit and fast/all
integration graphs and absent from serial unit and slow integration.

Remaining-Jest ownership is byte-identical at 68 configs, 107 scripts, 406 API
files, and digest
`bf09ea4647e8eb27fa1baa019c1ec531b56319b5a21f3992141aa0be9e663849`.

### Protected Hashes And Validation

Normalized-LF SHA-256 values are:

- Auth manifest:
  `57049b28cc7e3a647d600ae3e0ba5540e1e287f78d9e6fbb6bb64d2f68049809`
  to `90186fe2cff3e9c387f45d0fa9d20410690256b7ee87ad3a38927b427d4b1ffd`;
- new Auth Vitest config:
  `52958a368def2a79e1d0cfd5c8278d996f0f6fcd5f948d55124adbb2b9df5935`;
- unchanged assertion source:
  `f1588645cc48bf8c2e70ffaae45ed53d121bb63f557e9bb5f7cda73748af401d`;
- unchanged Jest and TypeScript configs:
  `ee7d6ed8b351066f0fd908d319e8ebd3ee00146b5dc51c36601ac5a21fcd95a9`
  and
  `e4a0e8beb92f159284d70b75a703d41b667a9d84e5e965844fa6bb77a0218086`.

Validation passes Auth build; authoritative Jest and manual Vitest unit lanes;
standalone strict/no-unchecked config typecheck; exact four-state parity;
post-build discovery; both `/4` matrices; PGlite fail closure; all seven task
graphs; frozen offline install across 86 workspaces; exact `workspace:*` and
inventory; and the complete 405.1-second foundation. Cloudflare Vite 8.2.0
typecheck/build, built-in Rolldown 1.2.0, the 1,593-input composed guard,
portable/real/runtime-source audits, and real Currency D1 behavior inside
workerd also pass. Port `8791` is closed and no scoped runtime process remains.

No workflow or hosted result is claimed for the manual shadow.

## Auth Unit Vitest Default

Commit:

- This commit (`test: switch Auth unit lane to Vitest`)

Date verified: 2026-07-30.

### Difference From Original Medusa

Auth's proven source unit lane now uses:

```text
test              vitest run --config vitest.config.mts
test:jest         jest --bail --passWithNoTests --forceExit --testPathPattern=src
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The exact former Jest unit command moves only from `test` to `test:jest`, the
temporary `test:vitest` key is removed, and the existing source-only config is
registered exactly once in persistent strict/no-unchecked tooling. No test
source, assertion, expected value, config behavior, integration command,
PGlite routing, workflow, dependency, lockfile, persistence adapter,
production runtime, workerd/D1 behavior, privacy/publication, or
repository-merge behavior changed.

### Exact Cut-Over, Shard, And Integration Proof

Fresh pre-cut-over Jest and Vitest reports and fresh post-cut-over default and
rollback reports contain exactly the same one file/test, full name/status, zero
failures/skips/todos/snapshots, ten textual assertions, and normalized digest
`4d55bc4e4dd8e8e6ad3741be3946df33f51a32f8c0f494370284025420f007d8`.

Both runners pass fresh pre- and post-cut-over `/4` matrices at 1/0/0/0. Every
matrix aggregates to the one full test signature exactly once. The unchanged
Auth integration lane passes all 36 tests through the global Jest-default
PGlite selector, while explicit Vitest selection still fails closed before
spawning.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0. Auth is Vitest-owned exactly once in all/scoped/general unit graphs and
absent from serial. Fast/slow/all integration graphs remain 44/25/19, 5/5/0,
and 63/44/19; Auth stays Jest-owned once in fast/all and absent from slow.

Remaining-Jest counts remain 68 configs, 107 scripts, and 406 API files. The
only ownership change moves Auth's byte-identical Jest unit command from
`test` to `test:jest`; accepted digest changes from
`bf09ea4647e8eb27fa1baa019c1ec531b56319b5a21f3992141aa0be9e663849`
to
`14a4ed7a7de36fa3462e348ab038a4c8735219ce31cd04d5711b4fb0b4c3b8b2`.

### Protected Hashes And Validation

Normalized-LF SHA-256 values are:

- root manifest:
  `4e690749e5629ea18fc719a8f5ebeeae8ec8e8a207b5925a4817c6fed656f914`
  to `494e84083c4b143fbaf5398429f533f9efa80e22bfb0246d16e04d1b062451f8`;
- Auth manifest:
  `90186fe2cff3e9c387f45d0fa9d20410690256b7ee87ad3a38927b427d4b1ffd`
  to `fe0ce35ed3ac07047db4231b338e9913275b281d04db2ec125c8ca7ce1043abf`;
- strict foundation contract:
  `0dc7597f3fbfadf324e167baa4c2c621bb9cac25b23e94bf2863349ad388be53`
  to `8c2fdb1390f48f0a7e6f92b6ceda508c7b820c9994e4ff65763769739df49f8e`;
- unchanged Auth config and source:
  `52958a368def2a79e1d0cfd5c8278d996f0f6fcd5f948d55124adbb2b9df5935`
  and
  `f1588645cc48bf8c2e70ffaae45ed53d121bb63f557e9bb5f7cda73748af401d`.

Validation passes Auth build/unit default/unit rollback; strict tooling; exact
pre/post parity; both pre/post `/4` matrices; the 36-test PGlite Jest
integration selector and Vitest fail closure; all seven task graphs; frozen
offline install across 86 workspaces; exact `workspace:*` and inventory; and
the complete 305.0-second foundation rerun. The first aggregate attempt failed
after 265.8 seconds when the shared PGlite lifecycle `beforeEach` exceeded its
existing five-second timeout. No timeout or unrelated lifecycle code changed;
the unchanged focused integration foundation passed in 283.0 seconds before
the full rerun passed.

Cloudflare Vite 8.2.0 typecheck/build, built-in Rolldown 1.2.0, the 1,593-input
composed guard, portable/real/runtime-source audits, and real Currency D1
behavior inside workerd also pass. Port `8791` is closed and no scoped runtime
process remains.

## Auth Integration Vitest Shadow

Commit:

- This commit (`test: shadow Auth integration lane with Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

Auth now exposes:

```text
test:integration         jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The new package-root config uses the shared serial Node integration profile,
the existing limited Jest compatibility bridge, four aliases, and exact
discovery of:

- `auth-identity.spec.ts`;
- `index.spec.ts`;
- `medusa-cloud-auth.spec.ts`.

The original three sources still own 36 tests, 74 textual assertions, three
`jest.setTimeout(30000)` calls, one `jest.fn`, four mock resets, and zero
skips/todos/snapshots. Only `index.spec.ts` changes assertion-neutral provider
resolution to an explicit `.js` path.

The first Vitest PostgreSQL probe passed 31/36 tests and correctly exposed that
the built Medusa loader cannot resolve the extensionless raw TypeScript
provider fixture. An explicit `.ts` path then loaded a frozen ESM namespace
that the loader attempts to mutate. This turn does not hide that boundary in a
core loader change, AST rewrite, native TypeScript hook, or Node-24-only
assumption. The one provider fixture implementation is instead checked
CommonJS JavaScript with explicit input/invariant narrowing, so both runners
exercise the same path-loaded provider on Node 20/22/24.

### Exact Backend And Shard Proof

Fresh pre-edit Jest, post-edit Jest, and post-edit Vitest reports pass on:

- isolated MikroORM/PostgreSQL 18 at `127.0.0.1:55446`;
- PGlite `memory://`;
- Drizzle/SQLite `:memory:`.

Every canonical pre/post and runner comparison contains exactly three files,
36 passed tests, identical full names/statuses, zero
failures/skips/todos/snapshots, and normalized digest
`f6f80d32667d147070651243e02b4a4e29c037dc86f9fd56a0eb7314e2422eff`.
Both real PGlite selectors pass and Region becomes the next fail-closed
Vitest lane.

Vitest `/3` shards pass 11/5/20 tests; Jest `/3` shards pass 20/11/5. File
assignment differs by runner, but both aggregates own all three files and 36
tests exactly once. Because the Jest default remains in this shadow turn,
Auth keeps its existing generic fast/all integration graph ownership and no
workflow job is added.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0. Fast/slow/all integration graphs remain 44/25/19, 5/5/0, and
63/44/19. Remaining-Jest counts remain 68 configs, 107 scripts, and 406 API
files; accepted digest becomes
`d186f4a82c0b271162f21b0b43f062d4bda5a5c524e72ea70b9934fa4c024043`.

### Protected Hashes And Validation

Normalized-LF SHA-256 values are:

- new integration config:
  `1c5d5e398c4d35dce9cb42a51f9d15678440c3f5f2f105894af8a88d12df94c6`;
- unchanged Auth Identity and Medusa Cloud Auth sources:
  `b850f81257e340d6504390de1695dfb7beafd478a16c743e1fbb5bccf7296bd0`
  and
  `21cc0e876b8f047752435173779196827058f6241d33e6926e06163275b29b16`;
- provider-loading source:
  `c7ca21a25d08a12d392ddde6dee1c17a1b37d23ffd33d28e8113c756d5bf4513`
  to `f149ae477b43443b3dc728c122190ad7d6d718259f9532d6fef22c5f3965570f`;
- auth-identity fixture remains
  `e9100b84c79bb0a4ed948797a3125ac4995481069fba300d5147aff895ebf9bd`;
- provider fixture moves from TypeScript
  `93b1482ecac994c4f18bdddb5460ddeac0b21e89e36751f6fc1f76e5dcda7ee2`
  to checked CommonJS JavaScript
  `afb01b5f86b2f1d1177b96bd73619c2d046562ab240430517b4516f5f3554695`;
- provider barrel:
  `ba971756cb694c35959f927c3f4c278c82feb717ea6b02f222880b977b85cbac`
  to `c73070f55df71c562e3b68cdcdbea41c5bdbf5cd8bde1cf17eeaeaa362a58739`.

Validation passes both Auth unit runners and build; all three backend runner
pairs; six canonical comparisons; unsharded discovery; both `/3` aggregates;
both PGlite selectors; strict config/fixture tooling; frozen install across 86
workspaces; exact `workspace:*`, task graphs, and inventory; and the complete
285.5-second foundation. Cloudflare Vite 8.2.0 typecheck/tests/build, built-in
Rolldown 1.2.0, the 1,593-input composed guard, portable/real/runtime-source
audits, D1 migrations, and Currency/Index/Cart workerd proofs pass.

The isolated PostgreSQL cluster has zero test connections, is stopped and
removed, ports 55446/8791/8792/8793/8794 are closed, and no scoped runtime
process remains. Dependencies, lockfile, workflow, persistence, production,
privacy/publication, and repository-merge behavior remain unchanged. No hosted
result or GitHub access is claimed.

## Next Boundary

Turn 65 should promote only this proven Auth integration lane to Vitest,
retain the exact former Jest command at `test:integration:jest`, and route the
global PGlite Jest selector to that rollback while explicit Vitest selection
uses the default. Re-prove all three backends and both `/3` aggregates. Keep
the existing generic fast/all CI ownership; do not add a dedicated job.

## Auth Integration Vitest Default

Commit:

- This commit (`test: switch Auth integration lane to Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

Auth's proven integration lane now uses:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

Only runner ownership changed. The temporary shadow key is removed, the exact
former Jest command is retained, and the PGlite command map points Jest to the
rollback and Vitest to the default. Test sources, fixtures, configs,
assertions, dependencies, lockfile, workflow, persistence, and production
runtime are unchanged.

### Exact Backend, Selector, Shard, And Graph Proof

Fresh pre/post reports cover default Jest, shadow Vitest, default Vitest, and
rollback Jest on PostgreSQL 18, PGlite, and Drizzle/SQLite. All 12 canonical
comparisons preserve exactly three files, 36 passed tests, full names/statuses,
zero failures/skips/todos/snapshots, and digest
`f6f80d32667d147070651243e02b4a4e29c037dc86f9fd56a0eb7314e2422eff`.

Both PGlite selectors pass. Vitest default `/3` shards remain 11/5/20; Jest
rollback shards remain 20/11/5. Both aggregates cover the complete suite
exactly once. All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0,
83/63/20, and 2/2/0. Fast/slow/all integration graphs remain 44/25/19, 5/5/0,
and 63/44/19; Auth moves from Jest to Vitest ownership exactly once in
fast/all without a workflow change.

Remaining-Jest counts remain 68 configs, 107 scripts, and 406 API files. The
accepted digest becomes
`da9b67395197e480c9570535b1cbda9793c92d9e0e3b876f2e3b92f4600d35ae`.

### Protected Hashes And Validation

Normalized-LF SHA-256 values are:

- Auth manifest:
  `21dc8256b81c88da7be123232bc4ccb7ad21df7dbc369faf568b986bff42e475`
  to `269374e37d7e129ab48f4dd5de851bce90da710e98e7d6244b094c7130e9aff7`;
- PGlite orchestrator:
  `daf7636587dc2af7befa991d378a01eadfc9ede9943a2e8478db499c3d25fad6`
  to `db71b27ab55224690ffb43d4cd504a6d7326209bf907c3b31afac81d3f8fc05d`;
- strict foundation contract:
  `d7a77d573aab3bac789a1c339817d8d035b5252453bc31d7d31b354d7efde4d0`
  to `d40ce4b16df54b4408f4b61d761f2ea6f92056e34ce1f63ba345444c3bd8cff0`;
- unchanged integration config:
  `1c5d5e398c4d35dce9cb42a51f9d15678440c3f5f2f105894af8a88d12df94c6`.

Validation passes Auth build/unit default/unit rollback; all backend and shard
proofs; both PGlite selectors; strict tooling; frozen install across 86
workspaces; exact `workspace:*`, graphs, and inventory; and the complete
291.4-second foundation. Cloudflare Vite 8.2.0/Vitest 4.1.10 typecheck,
30 tests, build, import guards, D1 migrations, and Currency/Index/Cart workerd
proofs pass. The installed Vite build uses its built-in Rolldown 1.2.0; the
standalone 1.2.1 patch is outside this runner-ownership turn.

The isolated PostgreSQL cluster has zero test connections, is stopped and
removed, ports 55447/8791/8792/8793/8794 are closed, and no scoped runtime
process remains. No hosted result or GitHub access is claimed.

## Next Boundary

Turn 66 should add only a Region source-unit Vitest shadow. Preserve Region's
Jest unit and integration defaults, audit its one static-manifest spec and
aliases first, and leave the PGlite Vitest integration selector fail-closed.

## Region Source-Unit Vitest Shadow

Commit:

- This commit (`test: shadow Region unit lane with Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

Region retains:

```text
test              jest --passWithNoTests --bail --forceExit --testPathPattern=src
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

It adds only `test:vitest` with a source-scoped Node/forks/SWC config. The
config mirrors the existing `@models`, `@services`, `@repositories`, `@types`,
and `@utils` aliases and does not use the Jest compatibility bridge.

### Evidence And Accepted Boundary

The missing script and missing config probes fail red before the change.
Explicit Region PGlite Vitest integration selection fails closed before
spawning both before and after the change.

Fresh pre-edit Jest, post-edit Jest, post-build Vitest, and shadow Vitest
reports preserve exactly one source file, one passed test, full name/status,
zero failures/skips/todos/snapshots, and normalized result digest
`ab01db67f70a6857632ed929df6a9a9a72c523052e475f8a4f1274844af59410`.
Both runners' `/4` aggregates remain 1/0/0/0 and Region build introduces no
duplicate discovery. The unchanged PGlite Jest integration lane passes its one
file and 18 tests.

Strict/noUnchecked config validation, nine foundation contracts, frozen
offline install across 86 workspaces, exact `workspace:*`, unchanged seven
task graphs, exact 68/107/406 remaining-Jest inventory, and the complete
296.4-second foundation pass. Cloudflare Vite 8.2.0/Vitest 4.1.10
typecheck/tests/build, built-in Rolldown 1.2.0, import guards, D1 migrations,
and Currency/Index/Cart workerd proofs pass.

Source, Jest config, and TypeScript config hashes remain
`325e94aa0180eb7e2dffa4d7a7d71854a90d754b87b045be67f142caa5a8dd35`,
`22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76`,
and `e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a`.
No assertion, integration routing, dependency, lockfile, workflow,
persistence, production, or Cloudflare behavior changed. No hosted result or
GitHub access is claimed, and ports 8791/8792/8793/8794 are closed.

## Next Boundary

Turn 67 should promote only this proven Region unit lane to Vitest, retain the
exact former Jest unit command at `test:jest`, remove the temporary shadow
key, and keep Region integration Jest-authoritative with Vitest selection
fail-closed.

## Region Source-Unit Vitest Default

Commit:

- This commit (`test: switch Region unit lane to Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

Region's source-unit runner ownership is now:

```text
test       vitest run --config vitest.config.mts
test:jest  jest --passWithNoTests --bail --forceExit --testPathPattern=src
```

The Vitest package config and source are unchanged. Only the proven
default/shadow keys switch ownership; the exact Jest rollback remains. Region
integration continues to use its original Jest command.

### Exact Cut-Over Proof

Fresh pre-cut-over default Jest and shadow Vitest plus post-cut-over default
Vitest, rollback Jest, and post-build Vitest reports preserve exactly one
source file, one passed test, every full name/status, zero
failures/skips/todos/snapshots, and normalized digest
`ab01db67f70a6857632ed929df6a9a9a72c523052e475f8a4f1274844af59410`.
All four pre/post runner comparisons pass. Both real `/4` matrices pass at
1/0/0/0 and own the full test exactly once.

The unchanged PGlite Jest integration selector passes one file/18 tests before
and after cut-over. Explicit Vitest integration selection remains unsupported
and fails before spawning. All/scoped/general/serial unit graphs remain
85/65/20, 1/1/0, 83/63/20, and 2/2/0; Region moves once to Vitest in each
applicable graph. Fast/slow/all integration remain 44/25/19, 5/5/0, and
63/44/19, with Region Jest-owned once in fast/all.

Strict/noUnchecked tooling, nine contracts, frozen offline install across 86
workspaces, exact `workspace:*`, updated exact 68/107/406 inventory, the
complete 311.3-second foundation, and all Cloudflare gates pass. Region source,
Jest config, TypeScript config, Vitest config, root manifest, PGlite routing,
lockfile, workflow, persistence, production, privacy/publication, and merge
preparation remain unchanged. No hosted result or GitHub access is claimed.

## Next Boundary

Turn 68 should add only a Region integration Vitest shadow and explicit PGlite
Vitest capability. Preserve the Jest integration default and prove the
unchanged one-file/18-test suite on isolated PostgreSQL, PGlite, and
Drizzle/SQLite before considering cut-over or CI ownership.

## Region Integration Vitest Shadow

Commit:

- This commit (`test: shadow Region integration lane with Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

Region retains:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

It adds only `test:integration:vitest` with a package-root config scoped to the
existing `region-module.spec.ts`. The config reproduces the five Jest aliases
and uses the shared serial Node integration profile with the limited
Jest-global bridge required by the unchanged `jest.setTimeout(30000)` call.
The PGlite orchestrator maps explicit Region Vitest selection to the shadow
key and keeps default Region selection on Jest.

### Exact Shadow Proof

Missing-script, missing-config, and unsupported-Region-selector probes fail red
before the change. The integration source remains one file with 18 tests, 25
direct expectation sites, one Jest-global call, and no snapshots.

Fresh pre-edit Jest, post-edit Jest, and opt-in Vitest reporters pass on
isolated PostgreSQL 18, PGlite, and Drizzle/SQLite. All nine same-backend
runner/time comparisons and all three pre-edit cross-backend Jest comparisons
preserve the exact 18 full names/statuses, zero failures/skips/todos/snapshots,
and normalized digest
`aebfb5091728f37e059beeb845e462cd78f03dd4c9fcaabbb871bfd093a59e13`.
Both real PGlite selectors pass all 18 tests. RBAC is now the next unsupported
Vitest lane and its only/list/from/matrix probes fail before spawn.

Unsharded Vitest discovery lists the exact 18 test signatures. All three
authentic Vitest `/3` runs exit 1 before importing the suite because a single
file cannot satisfy three shards. Region therefore remains Jest-owned exactly
once in the unchanged fast/all integration graphs and gains no workflow owner
in this shadow. The Jest `/3` aggregate passes at 18/0/0.

All seven graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 44/25/19, 5/5/0,
and 63/44/19. Strict/noUnchecked tooling, nine contracts, frozen offline
install across 86 workspaces, exact `workspace:*`, updated exact 68/107/406
inventory, Region build and unit default/rollback, and the complete
303.2-second foundation pass. Cloudflare Vite 8.2.0/Vitest 4.1.10
typecheck, 30 tests, build with built-in Rolldown 1.2.0, import guards, D1
migrations, and Currency/Index/Cart workerd proofs pass.

The integration source, Jest config, TypeScript config, unit Vitest config,
workspace file, lockfile, and workflow remain unchanged at:

- source:
  `4c062b161e2b2e8d7325fd07fe600f855abf845a1772e99fb373349663957888`;
- Jest config:
  `22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76`;
- TypeScript config:
  `e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a`;
- unit Vitest config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- workspace:
  `af3ec0941ce1dc79137f176286d051fd92f228f728ef0dd7ea32a4271e72cb63`;
- lockfile:
  `2c9390dce87526e7f8ecef2c808f57ec2659befa0387bf88fb772c877c5204fe`;
- workflow:
  `1009b9a3038877d0d290f33b26b07c633a148100353f2626fd2b507810126723`.

Post-change hashes for the new config and shared ownership surfaces are:

- Region integration config:
  `bc37718b8a248afe0d060beb308ed011a46b454b443923ec0f8dd193553dbf7d`;
- root manifest:
  `4a3e06a7c33544c245b015eb236fc1d98a5721d7cf5a60f98a781c24e276355b`;
- Region manifest:
  `70326dba72f1d9902aaf2b3abc96e2bc8edb68fe135c61162ae0b1a9d92b4c9e`;
- PGlite orchestrator:
  `9cb0adfe3300d5a2834cf0ddd1e4f61495d5f0ed8177f9710f7b403c36efd21e`;
- integration verifier:
  `bd9457717aa315d111c6628c98bb9df8d4b68e0af74703b21f9944ca686c8cbc`;
- strict foundation contract:
  `7379e9e1ebac3246f9df463796e47fd65307218cfab7c40bddb3dfc4e79c1cc5`;
- inventory:
  `bd8634d2762f08739d9729301ffcd28e7cd49de49d7e93f92d18ae73cc97994c`.

PostgreSQL, PGlite, and Drizzle/SQLite are distinct Node persistence paths.
The Cloudflare checks are production-graph regressions and do not claim Region
ran inside workerd. No assertion, persistence, dependency, lockfile, workflow,
production, privacy/publication, or merge-preparation behavior changed. No
hosted result or GitHub access is claimed. The isolated cluster was removed
and ports 55448/8791/8792/8793/8794 are closed.

## Next Boundary

Turn 69 should promote only this proven Region integration lane to Vitest,
retain the exact former Jest command at `test:integration:jest`, remove the
temporary shadow key, and invert PGlite default/rollback routing. Because its
one file cannot consume generic `/3` sharding, exclude Region only from the
fast graph and add a dedicated runner-neutral unsharded PostgreSQL job with
aggregate propagation.

## Region Integration Vitest Default

Commit:

- This commit (`test: switch Region integration lane to Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

Region integration ownership is now:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

Only runner ownership changed. The temporary shadow key is removed, the exact
former Jest command is retained, and PGlite maps Jest to the rollback and
Vitest to the default. Test source, aliases, configs, assertions, dependencies,
lockfile, persistence, and production runtime are unchanged.

### Exact Backend, Selector, Shard, Graph, And Workflow Proof

Fresh pre-cut-over default-Jest/shadow-Vitest and post-cut-over
rollback-Jest/default-Vitest reports pass on isolated PostgreSQL 18, PGlite,
and Drizzle/SQLite. All 12 canonical per-backend comparisons and all
cross-backend runner pairs before and after cut-over preserve exactly one
file, 18 passed tests, every full name/status, zero
failures/skips/todos/snapshots, and digest
`aebfb5091728f37e059beeb845e462cd78f03dd4c9fcaabbb871bfd093a59e13`.

Both PGlite selectors pass and RBAC remains the next unsupported Vitest lane,
failing before process spawn. All three authentic Vitest `/3` commands exit 1
before importing the one-file suite. Jest rollback shards pass 18/0/0 and
cover all 18 tests exactly once.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0. Fast integration moves from 44/25/19 to 43/24/19 with Region absent;
slow stays 5/5/0; all stays 63/44/19 with Region on Vitest. Region's new
runner-neutral, unsharded PostgreSQL job has the same service/install/artifact
shape as Settings/Store, runs the package default, and propagates failure,
cancellation, skip, and success through the package aggregate. The direct
command and typed YAML contract pass locally; no hosted result is claimed.

Remaining-Jest counts remain 68 configs, 107 scripts, and 406 API files. The
accepted digest moves to
`0dfc629497c92d6be08d200ac8d1d5a690d80fcbda50756701dbf5e97cf906bd`
only for the Region rollback-key and PGlite-orchestrator ownership changes.

### Protected Hashes And Validation

Normalized-LF SHA-256 values are:

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

The integration source, Jest/TypeScript/unit/integration Vitest configs,
integration verifier, workspace, and lockfile remain unchanged at their
Turn 68 hashes. Frozen offline install across 86 workspaces, exact
`workspace:*`, Region build and unit default/rollback, strict tooling, the
complete 322.9-second foundation, and all 13 Cloudflare gates pass.

PostgreSQL, PGlite, and Drizzle/SQLite remain separate Node paths. Cloudflare
results are production-graph regressions, not Region workerd execution. The
isolated PostgreSQL cluster reached zero scoped connections and all scoped
ports are closed. Installed/live versions remain Vite 8.2.0, Vitest/coverage
4.1.10, Vite-bundled Rolldown 1.2.0, and standalone Rolldown 1.2.1.

## Next Boundary

Turn 70 should audit and freeze only RBAC's source-unit lane, add an opt-in
Vitest shadow with exact aliases and discovery, and preserve its Jest unit and
integration defaults. Keep explicit RBAC PGlite Vitest integration selection
fail-closed until a later integration shadow.

## RBAC Source-Unit Vitest Shadow

Commit:

- This commit (`test: shadow RBAC unit lane with Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

RBAC retains:

```text
test              jest --passWithNoTests --bail --forceExit --testPathPattern=src
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

It adds only `test:vitest` with a source-scoped Node/forks/SWC config. The
config mirrors the existing `@models`, `@services`, `@repositories`, `@types`,
and `@utils` aliases. The unchanged source unit has one file, one test, ten
expectation sites, no Jest-only API, and no snapshot, so no compatibility
bridge is enabled.

### Evidence And Accepted Boundary

The missing script and missing config probes fail red before the change.
Fresh pre-edit Jest, post-edit Jest, shadow Vitest, and post-build Vitest
reports preserve exactly one file, one passed test, full name/status, zero
failures/skips/todos/snapshots, and normalized result digest
`06a1fff8f4c84d800d3f759bc2997d7f661380675dd92c563a300f26dd4f8a0a`.
All four canonical comparisons pass. Both real `/4` matrices cover the file at
1/0/0/0, unsharded Vitest discovery lists the exact test signature, and RBAC
build introduces no duplicate discovery.

The unchanged PGlite Jest integration selector passes one file, six tests, and
one existing skip before and after the unit shadow. Explicit RBAC Vitest
integration selection remains unsupported and fails before spawn.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0, with RBAC Jest-owned exactly once where applicable. Fast/slow/all
integration remain 43/24/19, 5/5/0, and 63/44/19, with RBAC Jest-owned once in
fast/all. The exact remaining-Jest inventory remains 68 configs, 107 scripts,
406 API files, and digest
`0dfc629497c92d6be08d200ac8d1d5a690d80fcbda50756701dbf5e97cf906bd`.

Source, Jest config, and TypeScript config hashes remain:

- source:
  `d40b045b410d79cd82a68a0dc77c45c809d552615a5c4c4ac1ca90654ed4c8bc`;
- Jest config:
  `22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76`;
- TypeScript config:
  `e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a`.

Changed hashes are:

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

Strict/noUnchecked config validation, nine foundation contracts, frozen
offline install across 86 workspaces, exact `workspace:*`, unchanged
inventory, the complete 279.1-second foundation, and all 13 Cloudflare gates
pass. The Cloudflare checks are production-graph regressions, not RBAC
integration execution in workerd. No assertion, integration routing,
dependency, lockfile, workflow, persistence, production, privacy/publication,
or merge-preparation behavior changed. No hosted result is claimed.

## Next Boundary

Turn 71 should promote only this proven RBAC unit lane to Vitest, retain the
exact former Jest unit command at `test:jest`, remove the temporary shadow key,
and keep RBAC integration Jest-authoritative with Vitest selection
fail-closed.

## RBAC Source-Unit Vitest Default

Commit:

- This commit (`test: switch RBAC unit lane to Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

RBAC's source-unit runner ownership is now:

```text
test       vitest run --config vitest.config.mts
test:jest  jest --passWithNoTests --bail --forceExit --testPathPattern=src
```

Only the proven default/shadow keys switch ownership. The exact Jest rollback,
Vitest config, source assertions, aliases, and Jest integration default remain
unchanged. The temporary `test:vitest` key is absent.

### Exact Cut-Over Proof

Fresh pre-cut-over default Jest and shadow Vitest plus post-cut-over default
Vitest, rollback Jest, and post-build Vitest reports preserve exactly one
source file, one passed test, every full name/status, zero
failures/skips/todos/snapshots, and normalized digest
`06a1fff8f4c84d800d3f759bc2997d7f661380675dd92c563a300f26dd4f8a0a`.
All four canonical pre/post runner comparisons pass. Vitest 4's `list`
subcommand returns the exact test signature. Both real `/4` matrices are
1/0/0/0 and aggregate the file and test exactly once.

The unchanged PGlite Jest integration selector passes six tests with one
existing skip before and after cut-over. Explicit RBAC Vitest integration
selection remains unsupported and fails before spawning.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0; RBAC moves once to Vitest in each applicable graph. Fast/slow/all
integration remain 43/24/19, 5/5/0, and 63/44/19, with RBAC Jest-owned once in
fast/all.

Remaining-Jest counts remain 68 configs, 107 scripts, and 406 API files. The
only accepted ownership move is RBAC's byte-identical Jest command from `test`
to `test:jest`; accepted digest becomes
`6b697ef51ed5877d24492d07b6eb7cf809a1e0228c8fd570b08ef4c2a4327b1b`.

Source, Jest config, TypeScript config, and Vitest config hashes remain:

- source:
  `d40b045b410d79cd82a68a0dc77c45c809d552615a5c4c4ac1ca90654ed4c8bc`;
- Jest config:
  `22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76`;
- TypeScript config:
  `e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a`;
- Vitest config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`.

Changed hashes are:

- RBAC manifest:
  `9f051922bf8e8db638fac1866ed788a8de0d7eea3348eadd6f92b174d992128f`
  to `9acd1637fd21663f002033642c94ba4f6f1c3eeeac328fd81ed360c638b5b630`;
- strict foundation contract:
  `cd16f00969adfa01dce24be07a4c1b9a5d1090725262f42b11fca0ac9e563636`
  to `b89708e2abb44911041419012d9ff814fd7ec7f3d0d93631cb225d9d19bf1f60`;
- remaining-Jest inventory:
  `e7e4d804d4cbc64b07843cb022d63ce138622e622bceb53f12348cf83d4dfdaa`
  to `9dadfbfe1a107d0292349d0065bf9bc869294fc0f4133082de8fc5ba9428c4d3`.

Strict/noUnchecked tooling, nine contracts, frozen offline install across 86
workspaces, exact `workspace:*`, the complete 276.2-second foundation, and all
13 Cloudflare gates pass. The Cloudflare checks are production-graph
regressions, not RBAC integration execution in workerd. Root manifest, PGlite
routing, integration verifier, workspace, lockfile, workflow, dependencies,
persistence, production, privacy/publication, and merge preparation remain
unchanged. No hosted result or GitHub access is claimed.

## Next Boundary

Turn 72 should add only an RBAC integration Vitest shadow and explicit PGlite
Vitest capability. Preserve the Jest integration default and prove the
unchanged suite on isolated PostgreSQL, PGlite, and Drizzle/SQLite before
considering cut-over or dedicated CI ownership.

## RBAC Integration Vitest Shadow

Commit:

- This commit (`test: shadow RBAC integration lane with Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

RBAC retains its exact authoritative command:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

It adds only:

```text
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The narrow integration config includes only the unchanged RBAC specification,
reproduces its five aliases, and uses the shared serial Node/forks/SWC profile.
The shared legacy-Jest bridge is enabled only because the source still calls
`jest.setTimeout(30000)`. No source rewrite or broad global compatibility was
introduced.

The PGlite orchestrator advertises RBAC as Vitest-capable. Default RBAC
selection still invokes the Jest default; explicit `--runner=vitest` invokes
the shadow. Unsupported Vitest selection advances to User and fails before
process spawn for only/list/from/full-matrix forms.

### Exact Shadow Proof

The protected source remains one file with seven test declarations, one
existing skip, six active tests, 50 expectation sites, one Jest API, zero
snapshots, and hash
`e8785589b08cd3cce24c2d2d4e8d1698135cd441a29b85096aa0405c0f39490c`.

Fresh pre/post Jest and shadow Vitest reports on isolated
MikroORM/PostgreSQL 18, PGlite, and Drizzle/SQLite all preserve one file, six
passed/one skipped test, every full name/status, zero
failures/todos/snapshots, and normalized digest
`b4454deb8f38de5e2de90ee7d15dcd595e191c25e582753cc3e56662c9553655`.
All nine pre/post/same-backend canonical comparisons and all three post-shadow
cross-backend comparisons pass.

Both real PGlite selectors pass the same six/one result. Unsharded Vitest
discovery lists the six active signatures; the skipped declaration remains
proven in execution reports. Both runners' `/3` commands put the sole file on
shard 1 and let shards 2/3 pass under `--passWithNoTests`. That is valid shard
mechanics but not three-shard coverage, so cutover requires a dedicated
unsharded PostgreSQL job.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0. Fast/slow/all integration remain 43/24/19, 5/5/0, and 63/44/19; RBAC
remains Jest-owned in fast/all because the default did not move.

Remaining-Jest counts remain 68 configs, 107 scripts, and 406 API files. Only
the integration-foundation verifier and PGlite orchestrator hashes move;
accepted digest becomes
`cb4a27d2c1bfbbecdba32a3f01a7ad7917a562e6d3df923220c7ff1720e89ea5`.

Normalized-LF hashes move:

- root manifest:
  `2d4ba67bfb6f66ca6d0c829f064bf0f44ce77cc5beb1c4e2288d32b75c1f6088`
  to `9e238694fea6abd4bd3dec0e685d021c1a803fc5a4471f27d06a9ce5c4137d1e`;
- RBAC manifest:
  `9acd1637fd21663f002033642c94ba4f6f1c3eeeac328fd81ed360c638b5b630`
  to `f3884a9849f8bcfa8499835f3820a20ec4ae13dba4a4ce678017e116ad8b0c00`;
- new integration config:
  `b6e519d8cbfbd3108f5020d88f5ca16b766c4e3c1525635a29f99f432f47af4d`;
- PGlite orchestrator:
  `4028e9a122ef2901eed8285121031ade801aca85df8882341689daa7d19fd9e9`
  to `5766f34d014302d39f09bedee0dfc3681024b67a798d2895a580d0ec7f983b13`;
- integration verifier:
  `bd9457717aa315d111c6628c98bb9df8d4b68e0af74703b21f9944ca686c8cbc`
  to `d159c0e6dd4644adaf2fbaad472244c9f308b38a6c26a1fb51a17878c8b58c33`;
- strict foundation contract:
  `b89708e2abb44911041419012d9ff814fd7ec7f3d0d93631cb225d9d19bf1f60`
  to `7998a94c1321586aa34ee5b719deb7886b259ba9402a6db066c98d4e5fbe0013`;
- remaining-Jest inventory:
  `9dadfbfe1a107d0292349d0065bf9bc869294fc0f4133082de8fc5ba9428c4d3`
  to `ae914f8cfa4175da2f20e26d9ce5d7d0437e2f2557841b9c2e06daac578a116f`.

RBAC build and both unit runners, frozen offline install across 86 workspaces,
exact `workspace:*`, strict/noUnchecked tooling, nine contracts, the complete
313.4-second foundation, and the 104.9-second 13-gate Cloudflare
Vite/import/D1/workerd set pass.

Source assertions, Jest/TypeScript/unit-Vitest configs, dependencies, lockfile,
workspace, workflow, persistence, production, package privacy/publication,
and repository-merge behavior are unchanged. PostgreSQL, PGlite, and
Drizzle/SQLite are separate Node acceptance paths. Cloudflare gates are
production-graph regressions, not this integration suite running in workerd.
The isolated PostgreSQL cluster reached zero scoped connections/databases, was
stopped and removed, and ports 55450/8791/8792/8793/8794 are closed. No
hosted result or GitHub access is claimed.

## Next Boundary

Turn 73 should promote only this proven RBAC integration lane to Vitest,
retain the exact former Jest command at `test:integration:jest`, route PGlite
Jest selection to that rollback, and add dedicated runner-neutral unsharded
PostgreSQL workflow ownership with aggregate propagation. Re-prove all three
backends and the direct workflow command.

## RBAC Integration Vitest Default

Commit:

- This commit (`test: switch RBAC integration lane to Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

RBAC integration ownership is now:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

Only the proven default/shadow keys switch ownership. The exact Jest command,
integration config, unchanged source, five aliases, and narrow timeout bridge
remain intact. The temporary `test:integration:vitest` key is absent.

PGlite maps default/Jest selection to `test:integration:jest` and explicit
Vitest selection to the package default. User remains unsupported for Vitest
and fails before spawn for only/list/from/full-matrix forms.

### Exact Cut-Over Proof

Fresh pre-cutover Jest/Vitest and post-cutover default/rollback reports on
isolated MikroORM/PostgreSQL 18, PGlite, and Drizzle/SQLite preserve one file,
six passed/one skipped test, every full name/status, zero
failures/todos/snapshots, and normalized digest
`b4454deb8f38de5e2de90ee7d15dcd595e191c25e582753cc3e56662c9553655`.
All 12 per-backend pre/post runner comparisons, six pre-cutover cross-backend
comparisons, and six post-cutover cross-backend comparisons pass.

Both real PGlite selectors pass. Unsharded discovery lists all six active test
signatures and execution preserves the existing skip. Both runners' `/3`
commands place the one file on shard 1 and allow shards 2/3 to pass empty.

RBAC is therefore excluded from the generic fast integration graph and owned
by a dedicated `rbac-integration` workflow job with:

- runner-neutral `RBAC Integration` naming;
- no strategy or job-level environment;
- one healthy PostgreSQL service;
- the existing checkout, dependency-cache, and build-artifact steps;
- one unsharded
  `pnpm --filter @medusajs/rbac test:integration` command with explicit
  PostgreSQL variables.

The exact workflow command passes locally against isolated PostgreSQL. The
strict parsed workflow contract proves the service, steps, lack of sharding,
runner-neutral naming, and package aggregate propagation for success, failure,
cancellation, and skip states. This local proof does not establish a hosted
GitHub Actions result.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0. Fast integration moves from 43/24/19 to 42/23/19 with RBAC absent.
Slow/all remain 5/5/0 and 63/44/19; RBAC is Vitest-owned exactly once in all.

Remaining-Jest counts remain 68 configs, 107 scripts, and 406 API files. The
exact RBAC Jest command moves from `test:integration` to
`test:integration:jest`; the PGlite orchestrator hash also moves. Accepted
digest becomes
`4fee6c2e3fa5a3c84ffad29f7a0e978cc2ac79583df65e6daf8126b2017d4333`.

Normalized-LF hashes move:

- root manifest:
  `9e238694fea6abd4bd3dec0e685d021c1a803fc5a4471f27d06a9ce5c4137d1e`
  to `3de5c9ea0c5c7eaf421ee878933715188931f330e9c011d46d8a35f56078b153`;
- RBAC manifest:
  `f3884a9849f8bcfa8499835f3820a20ec4ae13dba4a4ce678017e116ad8b0c00`
  to `f902ca9b817edcb2654c8527d64db9c23fdcfcf1db243822cdb95e822341dbe6`;
- PGlite orchestrator:
  `5766f34d014302d39f09bedee0dfc3681024b67a798d2895a580d0ec7f983b13`
  to `c8048fd373426d5231b238e9cbaa43acee91d49d69a4edefc9fbf8a12c17e4d9`;
- strict foundation contract:
  `7998a94c1321586aa34ee5b719deb7886b259ba9402a6db066c98d4e5fbe0013`
  to `25eeac3c345ed83230339f90975ff1be39146a4067117f11279707c4a50da1f2`;
- remaining-Jest inventory:
  `ae914f8cfa4175da2f20e26d9ce5d7d0437e2f2557841b9c2e06daac578a116f`
  to `46dc79fe0c3cb02c75c71c83c5efa518225cef5eb8725e6130c41b7e4452989b`;
- workflow:
  `bf3bcc0b51857a4d50ef8719a736eee55cf4baaede6294e0455bff97f4ee633a`
  to `12cd8dc0cf73100002178fe302e6c4ea3c312b2eb9ab5b3484e2caa0ca100671`.

The source, Jest config, TypeScript config, unit Vitest config, integration
Vitest config, integration verifier, workspace, and lockfile hashes remain
unchanged. RBAC build and both unit runners, frozen offline install across 86
workspaces, exact `workspace:*`, strict/noUnchecked tooling, nine contracts,
the complete 268.7-second foundation, and the 93.1-second 13-gate Cloudflare
Vite/import/D1/workerd set pass.

PostgreSQL, PGlite, and Drizzle/SQLite remain distinct Node acceptance paths.
Cloudflare checks are production-graph regressions, not this integration suite
running in workerd. The isolated cluster reached zero scoped
connections/databases, was stopped and removed, and ports
55451/8791/8792/8793/8794 are closed. No hosted GitHub Actions result is
claimed.

## Next Boundary

Turn 74 should audit and shadow only User's source-unit lane while preserving
the exact Jest unit and integration defaults. Keep explicit User PGlite Vitest
integration selection fail-closed before spawn.

## User Source-Unit Vitest Shadow

Commit:

- This commit (`test: shadow User unit lane with Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

User retains its exact Jest unit and integration defaults and adds only:

```text
test:vitest  vitest run --config vitest.config.mts
```

The new source-only config consumes the shared discovery globs, reproduces the
five User aliases, and needs no legacy-Jest bridge. The unchanged source
contains one file, one test, five expectations, zero Jest API sites, and zero
snapshots.

### Exact Shadow Proof

Pre-edit Jest, pre-build Jest, post-edit Jest, shadow Vitest, and post-build
Vitest each report one passed file/test, identical full name/status, zero
failures/skips/todos/snapshots, and normalized digest
`8bafc05bff8d1b2a7107cf1a86564afa3997360751d7272675e0f938ce511ead`.
Unsharded discovery prints the exact static-manifest assertion. Both runners'
real `/4` aggregates are 1/0/0/0, and the build introduces no duplicate
discovery.

The unchanged PGlite User Jest integration selector passes two files/28 tests
before and after the shadow. Explicit User Vitest integration selection exits
before process spawn. All/scoped/general/serial unit graphs remain 85/65/20,
1/1/0, 83/63/20, and 2/2/0. Fast/slow/all integration remain 42/23/19,
5/5/0, and 63/44/19, with User Jest-owned exactly once where applicable.

Remaining-Jest inventory remains exactly 68 configs, 107 scripts, and 406 API
files with digest
`4fee6c2e3fa5a3c84ffad29f7a0e978cc2ac79583df65e6daf8126b2017d4333`.

Normalized-LF protected hashes are:

- source:
  `d1f735b3f46a93975cb9239c92cf604114668258ce04471a1958efce185be4c6`;
- Jest config:
  `22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76`;
- TypeScript config:
  `e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a`;
- new Vitest config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- PGlite runner:
  `c8048fd373426d5231b238e9cbaa43acee91d49d69a4edefc9fbf8a12c17e4d9`;
- workspace:
  `af3ec0941ce1dc79137f176286d051fd92f228f728ef0dd7ea32a4271e72cb63`;
- lockfile:
  `2c9390dce87526e7f8ecef2c808f57ec2659befa0387bf88fb772c877c5204fe`;
- workflow:
  `12cd8dc0cf73100002178fe302e6c4ea3c312b2eb9ab5b3484e2caa0ca100671`.

User build, frozen offline install across 86 workspaces, exact `workspace:*`,
strict/noUnchecked tooling, nine contracts, the complete 284.1-second
foundation, and the 98.9-second 13-command Cloudflare Vite/import/D1/workerd
set pass. Cloudflare checks are production-graph regressions, not User
integration execution in workerd. Source, assertions, integration ownership,
PGlite routing, dependencies, lockfile, workflow, persistence, production,
package privacy/publication, and merge preparation remain unchanged. No hosted
GitHub Actions result is claimed.

## Next Boundary

Turn 75 should promote only this proven User unit lane to Vitest, retain its
exact Jest command at `test:jest`, and keep User integration Jest-authoritative
with explicit PGlite Vitest selection fail-closed before spawn.

## User Source-Unit Vitest Default

Commit:

- This commit (`test: switch User unit lane to Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

User's source-unit runner ownership is now:

```text
test       vitest run --config vitest.config.mts
test:jest  jest --passWithNoTests --bail --forceExit --testPathPattern=src
```

Only the proven default/shadow keys switch ownership. The former Jest command
is byte-identical, `test:vitest` is absent, and the existing source-only
Vitest config remains unchanged.

### Exact Cut-Over Proof

Fresh pre-cutover default-Jest, shadow-Vitest, pre-build Vitest, post-cutover
default-Vitest, rollback-Jest, and post-build Vitest reports preserve one
passed file/test, every name/status, zero failures/skips/todos/snapshots, and
normalized digest
`8bafc05bff8d1b2a7107cf1a86564afa3997360751d7272675e0f938ce511ead`.
All applicable pre/post runner comparisons pass. Unsharded discovery prints
the exact static-manifest assertion, and both runners' real `/4` aggregates
remain 1/0/0/0.

The unchanged PGlite User Jest integration selector passes two files/28 tests
before and after cut-over. Explicit User Vitest integration selection still
fails before process spawn. All/scoped/general/serial unit graphs remain
85/65/20, 1/1/0, 83/63/20, and 2/2/0, moving User exactly once from Jest to
Vitest. Fast/slow/all integration remain 42/23/19, 5/5/0, and 63/44/19, with
User Jest-owned once where applicable.

Remaining-Jest counts remain 68 configs, 107 scripts, and 406 API files. Only
the byte-identical User unit command moves from `test` to `test:jest`; accepted
digest becomes
`88315b005bc36b5da06e07082f0ebf02a77e7a5de4ed1a0b6a0d9d7d6978db8f`.

Normalized-LF hashes move:

- User manifest:
  `a2d3dcd040b2c6eb29fec305daa508e8a804f12c3d6d73ac65603a22b3a7dc0d`
  to `fa8704d759b121d6dfbdb9c9cd6cebaa1b788cbe7d2c1161dff748bcfb2d3ce1`;
- strict foundation contract:
  `8a4bf680720419e60a9fa0aea1f183801c55b449ddf3a8ac011792c9abeb6ad5`
  to `266d59f84805473f492d8ff3d312aea599e5579d13ee1b74cc3c0d653a004db9`;
- remaining-Jest inventory:
  `46dc79fe0c3cb02c75c71c83c5efa518225cef5eb8725e6130c41b7e4452989b`
  to `8c0b2c1ac9897ba0d6eec7118bb9c07c8e15b7283c87fd10b385ae15aedcd201`.

Source and all config hashes, root manifest, PGlite routing, workspace,
lockfile, and workflow remain unchanged. User build, frozen offline install
across 86 workspaces, exact `workspace:*`, strict/noUnchecked tooling, nine
contracts, the complete 269.7-second foundation, and the 89.8-second
13-command Cloudflare set pass. Cloudflare checks are production-graph
regressions, not User integration execution in workerd. No hosted GitHub
Actions result is claimed.

## Next Boundary

Turn 76 should add only a User integration Vitest shadow and explicit PGlite
Vitest routing while retaining the exact Jest integration default. Prove the
unchanged two-file/28-test suite across PostgreSQL, PGlite, and Drizzle/SQLite
before any integration cut-over or workflow change.

## User Integration Vitest Shadow

Commit:

- This commit (`test: shadow User integration lane with Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

User retains its exact Jest integration default and adds only:

```text
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The new config consumes the shared serial integration profile, reproduces all
five User aliases, discovers exactly `invite.spec.ts` and `user.spec.ts`, and
uses the narrow legacy-Jest bridge for the unchanged timeout, mock-reset, and
spy calls. The source remains two files, 28 tests, 42 expectation sites, and
zero snapshots.

### Exact Shadow Proof

Fresh pre-edit Jest, post-edit Jest, and shadow Vitest reports on isolated
PostgreSQL 18, PGlite, and Drizzle/SQLite each preserve two passed files/28
tests, every full name/status, zero failures/skips/todos/snapshots, and
normalized digest
`2c413d71bd1c98f181215ded94940e420e868ac52426e57a487e76af47c6867d`.
All nine pre-Jest/post-Vitest and all nine post-Jest/post-Vitest exact backend
comparisons pass.

Both real PGlite selectors pass. Vitest file discovery lists the exact two
owned files; the run reports preserve all 28 test names despite dynamic
module-runner registration not printing names through regular `vitest list`.
Unsupported Vitest selection advances to Sales Channel and exits before
process spawn.

Both runners' real `/3` aggregates are 14/14/0 tests, with the empty third
shard succeeding through `--passWithNoTests`. User can therefore remain in
generic fast sharding after a later cut-over; no dedicated workflow job is
needed. All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0,
83/63/20, and 2/2/0. Fast/slow/all integration remain 42/23/19, 5/5/0, and
63/44/19, with User Jest-owned exactly once where applicable.

Remaining-Jest inventory remains exactly 68 configs, 107 scripts, and 406 API
files; accepted digest becomes
`ea2b4d574cd8c878797845d11535bebadd0796ee91dde05d97a6446be0892ea7`.

Normalized-LF protected hashes are:

- integration sources:
  `170a1eaee231069615f8af46eac3983b696c69188ae6f0c9509c27068e9124e7`
  and
  `ab5fcb38ea396d2228451c30163ab74ece2619d5f026971da7d4c5c3535b7ccf`;
- Jest config:
  `22a0f432979cd34c2ee8f4ee190d603c223c23ba57ce57ad8f90cc3c997cdc76`;
- TypeScript config:
  `e99c0c48bf2b04d39c76a6a1c159eed565c280b11a656d70b0f99efffc4cf95a`;
- unit Vitest config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- new integration Vitest config:
  `d638776636212ba2f0ea0193cad8f63e4b268d44c1aec6be9a4ecf2cdfaf13c7`;
- root manifest:
  `0462f3b4bfa18fa090b5f8da505d9754c360a45441804a40e087f724efcbb05f`;
- User manifest:
  `223ffcd24b14ac8f1a5f0dd37b2ac8c70159103575b56718b91f95fd7863e27d`;
- PGlite runner:
  `51a2af85b6b162cf95dfb14576630a24bef007e6089e997a3079fd6df43db146`;
- integration verifier:
  `af807f671c4576098b4e8afb2de2b92f8d51a9fc5511d3336913fbe10e96824d`;
- strict foundation contract:
  `5785c820f0f891fee33dd7d53955476216cc17734f85ff2ab4c67022585e8756`;
- remaining-Jest inventory:
  `bf3a7e62346f369b2ccc74381d34e9a4cdfbe92a926313c65a8f21216452832b`;
- workspace:
  `af3ec0941ce1dc79137f176286d051fd92f228f728ef0dd7ea32a4271e72cb63`;
- lockfile:
  `2c9390dce87526e7f8ecef2c808f57ec2659befa0387bf88fb772c877c5204fe`;
- workflow:
  `12cd8dc0cf73100002178fe302e6c4ea3c312b2eb9ab5b3484e2caa0ca100671`.

User build and both unit runners, frozen offline install across 86 workspaces,
exact `workspace:*`, strict/noUnchecked tooling, nine contracts, the complete
268.5-second foundation, and the 92.1-second 13-command Cloudflare
Vite/import/D1/workerd set pass. Cloudflare checks are production-graph
regressions, not User integration execution in workerd. Source, assertions,
dependencies, lockfile, workflow, persistence, production, package
privacy/publication, and merge preparation remain unchanged. The isolated
PostgreSQL cluster had zero active client connections before it was stopped
and removed. No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 77 should promote only this proven User integration lane to Vitest,
retain its exact Jest command as `test:integration:jest`, and route both PGlite
selectors correctly. Keep User in generic fast sharding and make no workflow
change.

## User Integration Vitest Default

Commit:

- This commit (`test: switch User integration lane to Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

User integration ownership is now:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

Only the proven default/shadow keys switch ownership. The former Jest command
is byte-identical, `test:integration:vitest` is absent, and the shared
integration config and legacy-Jest bridge remain unchanged.

### Exact Cut-Over Proof

Fresh pre-cutover default-Jest/shadow-Vitest and post-cutover
default-Vitest/rollback-Jest reports on PostgreSQL 18, PGlite, and
Drizzle/SQLite preserve two passed files/28 tests, every full name/status, zero
failures/skips/todos/snapshots, and normalized digest
`2c413d71bd1c98f181215ded94940e420e868ac52426e57a487e76af47c6867d`.
Seven pre-cutover and 16 post-cutover same-runner, cross-runner, same-backend,
and cross-backend comparisons pass.

Both real PGlite selectors pass, Vitest file discovery lists the exact two
owned files, and unsupported Vitest selection remains fail-closed at Sales
Channel before spawn. Both runners' real `/3` aggregates remain 14/14/0, with
the empty third shard successful. User therefore remains in generic fast
sharding without a dedicated workflow job.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0. Fast/slow/all integration remain 42/23/19, 5/5/0, and 63/44/19 while
User moves exactly once from Jest to Vitest in fast/all.

Remaining-Jest counts remain 68 configs, 107 scripts, and 406 API files. Only
the byte-identical User integration command moves from `test:integration` to
`test:integration:jest`; accepted digest becomes
`fb4c00ea649f7860044cd06e9a7847bccd7cc9aa9c058ecb6cb26dfb5e24c8db`.

Normalized-LF hashes move:

- User manifest:
  `223ffcd24b14ac8f1a5f0dd37b2ac8c70159103575b56718b91f95fd7863e27d`
  to `59a5d7503c1d204c70b46a9b351546c740039c3a98e58c5c03b180581259b463`;
- PGlite runner:
  `51a2af85b6b162cf95dfb14576630a24bef007e6089e997a3079fd6df43db146`
  to `7bdb36011d0add2afe035e075b414845512fdf47859a8c8a1f75328b3acf83e7`;
- strict foundation contract:
  `5785c820f0f891fee33dd7d53955476216cc17734f85ff2ab4c67022585e8756`
  to `a675d3f50c5f71efed54ef15d4f8a70b23a60a857f28ef913241d6726b9117bc`;
- remaining-Jest inventory:
  `bf3a7e62346f369b2ccc74381d34e9a4cdfbe92a926313c65a8f21216452832b`
  to `622a96625464a505ce992fc35e5dfb39c927c907e98ba57fb1d8c2952835a51b`.

Integration sources, assertions, all configs, root manifest, integration
verifier, workspace, lockfile, and workflow hashes remain unchanged. User
build and both unit runners, frozen offline install across 86 workspaces,
exact `workspace:*`, strict/noUnchecked tooling, nine contracts, the complete
268.0-second foundation, and the 89.3-second 13-command Cloudflare
Vite/import/D1/workerd set pass. Cloudflare checks are production-graph
regressions, not User integration execution in workerd. The isolated
PostgreSQL cluster had zero active client connections before it was stopped
and removed. No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 78 should audit and shadow only Sales Channel's source-unit lane while
preserving its exact Jest unit and integration defaults. Keep explicit Sales
Channel PGlite Vitest integration selection fail-closed before spawn.

## Sales Channel Source-Unit Vitest Shadow

Commit:

- This commit (`test: shadow Sales Channel unit lane with Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

Sales Channel retains its exact Jest defaults:

```text
test              jest --bail --forceExit --testPathPattern=src
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

It adds only `test:vitest` with a source-scoped Node/forks/SWC config. The
config reproduces the existing `@models`, `@services`, `@repositories`,
`@types`, and `@utils` aliases and needs no Jest compatibility bridge.

### Exact Shadow And Boundary Proof

The pre-change missing-script/config probes fail red. Fresh pre-edit Jest,
post-edit Jest, shadow Vitest, and post-build reports preserve the exact two
source files, three passed tests, every full name/status, zero
failures/skips/todos/snapshots, and normalized digest
`e9f67ef782e472c2ecad05d59fd2c3430a1afa761896ce6316d9261c8c63567c`.
Post-build discovery still lists only the two source files.

Both runners cover one file on each of the first two `/4` shards and let the
last two shards pass empty. Jest assigns 1/2 tests to shards 1/2 while Vitest
assigns 2/1; both aggregate to all three tests exactly once. Runner shard
numbers are not treated as a parity contract.

The unchanged PGlite Jest integration lane passes one file/14 tests. Explicit
Sales Channel Vitest integration selection remains unsupported and exits
before process spawn. All/scoped/general/serial unit graphs remain
85/65/20, 1/1/0, 83/63/20, and 2/2/0. Fast/slow/all integration remain
42/23/19, 5/5/0, and 63/44/19. Sales Channel remains Jest-owned in every
generic graph; the shadow has no workflow owner.

Remaining-Jest inventory stays exactly 68 configs, 107 scripts, and 406 API
files at accepted digest
`fb4c00ea649f7860044cd06e9a7847bccd7cc9aa9c058ecb6cb26dfb5e24c8db`.

Normalized-LF hashes move:

- root manifest:
  `0462f3b4bfa18fa090b5f8da505d9754c360a45441804a40e087f724efcbb05f`
  to `df15e90cadc8715e2c57e2464068fdec97f0f5f6b05569a0f1407ead93d88ecf`;
- Sales Channel manifest:
  `1d4eb7e39c653d580673378a4402d1928380cf7463559f74779c9056545327a4`
  to `92706544b5f2d143e2d02a4b32c74f3bb988d4592a37adc7a62bf4f35fc9fd41`;
- new Sales Channel config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- strict foundation contract:
  `a675d3f50c5f71efed54ef15d4f8a70b23a60a857f28ef913241d6726b9117bc`
  to `47a185ee9828c713e0d1d60ca91933bb1a35241bc8d10bf15f97dac4525c49c3`.

The two source hashes, Jest/TypeScript configs, PGlite runner, integration
verifier, inventory file, workspace, lockfile, and workflow remain unchanged.
Sales Channel build, frozen offline install across 86 workspaces, exact
`workspace:*`, strict/noUnchecked tooling, nine contracts, the complete
267.3-second foundation, and the 100.6-second 13-command Cloudflare
Vite/import/D1/workerd set pass. Cloudflare checks are production-graph
regressions, not Sales Channel integration execution in workerd. No hosted
GitHub Actions result is claimed. Temporary parity reports are removed, ports
8791/8792/8793/8794 are closed, and no scoped runtime process remains.

## Next Boundary

Turn 79 should promote only this proven Sales Channel source-unit lane to
Vitest, retain the exact former Jest unit command at `test:jest`, remove the
temporary shadow key, and keep integration Jest-authoritative and Vitest
selection fail-closed.

## Sales Channel Source-Unit Vitest Default

Commit:

- This commit (`test: switch Sales Channel unit lane to Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

Sales Channel source-unit ownership is now:

```text
test       vitest run --config vitest.config.mts
test:jest  jest --bail --forceExit --testPathPattern=src
```

The exact former Jest command moved to the rollback key and the temporary
`test:vitest` key is absent. The integration command remains byte-identical,
Jest-authoritative, and unsupported by the PGlite Vitest selector.

### Exact Cut-Over Proof

Fresh pre-cut-over default-Jest/shadow-Vitest and post-cut-over
default-Vitest/rollback-Jest reports preserve the exact two source files,
three passed tests, every full name/status, zero
failures/skips/todos/snapshots, and normalized digest
`e9f67ef782e472c2ecad05d59fd2c3430a1afa761896ce6316d9261c8c63567c`.
All four canonical pre/post runner comparisons pass. Post-build discovery
still lists only the two source files.

Both runners cover one file on each of the first two `/4` shards and let
shards 3/4 pass empty. Vitest assigns 2/1 tests to shards 1/2 and Jest assigns
1/2; both aggregate to all three tests exactly once.

The unchanged PGlite Jest integration lane passes one file/14 tests before and
after cut-over. Explicit Sales Channel Vitest integration selection continues
to exit before process spawn.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0 while Sales Channel moves exactly once from Jest to Vitest in the
applicable graphs. Fast/slow/all integration remain 42/23/19, 5/5/0, and
63/44/19 with Sales Channel still Jest-owned in fast/all.

Remaining-Jest counts remain exactly 68 configs, 107 scripts, and 406 API
files. Only the byte-identical Sales Channel unit command moves from `test` to
`test:jest`; accepted digest changes from
`fb4c00ea649f7860044cd06e9a7847bccd7cc9aa9c058ecb6cb26dfb5e24c8db`
to
`fb62eac6a76f38c13c3992695d616194a7634605b8fa06c274866dacfb1c32c2`.

Normalized-LF hashes move:

- Sales Channel manifest:
  `92706544b5f2d143e2d02a4b32c74f3bb988d4592a37adc7a62bf4f35fc9fd41`
  to `feda3fcb2a62bfa0fb20a940c18c5f318376c1c2bf45f2e782a3ef00fffc2c18`;
- strict foundation contract:
  `47a185ee9828c713e0d1d60ca91933bb1a35241bc8d10bf15f97dac4525c49c3`
  to `c4919bdbeb155a65ae65fe96e1f7d58675cb01c8cdc5faa3a95b5cc82437f802`;
- remaining-Jest inventory:
  `622a96625464a505ce992fc35e5dfb39c927c907e98ba57fb1d8c2952835a51b`
  to `0dfd12c18ff522d328a5bf4b09ec43c0844fd29d77b54307437379c643c33247`.

The sources, assertions, Jest/TypeScript/Vitest configs, root manifest,
PGlite runner, integration verifier, workspace, lockfile, and workflow remain
unchanged. Sales Channel build, frozen offline install across 86 workspaces,
exact `workspace:*`, strict/noUnchecked tooling, nine contracts, the complete
266.8-second foundation, and the 88.5-second 13-command Cloudflare
Vite/import/D1/workerd set pass. Cloudflare checks are production-graph
regressions, not Sales Channel integration execution in workerd. No hosted
GitHub Actions result is claimed.

## Next Boundary

Turn 80 should audit Sales Channel's unchanged integration suite and add only
an opt-in Vitest shadow after exact PostgreSQL, PGlite, and Drizzle/SQLite
baseline proof. Keep Jest authoritative and add no workflow owner before shard
behavior is measured.

## Sales Channel Integration Vitest Shadow

Commit:

- This commit (`test: shadow Sales Channel integration lane with Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

Sales Channel retains its exact Jest integration default:

```text
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

It adds only:

```text
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The exact-file config uses the shared serial integration profile, reproduces
all five package aliases, and applies the narrow legacy-Jest bridge solely for
the unchanged `jest.setTimeout(30000)` call. The suite remains one file,
14 tests, 22 expectation sites, and zero snapshots.

### Three-Backend Exact Shadow Proof

Fresh pre-edit Jest, post-edit Jest, and post-edit Vitest reports each pass one
file/14 tests on:

- MikroORM with an isolated PostgreSQL 18 cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle with Node SQLite `:memory:`.

All nine reports preserve every full name/status, zero
failures/skips/todos/snapshots, and normalized digest
`2abda1932abcd108e0a006b536978950c2486113c1221477c497c14caa0ed1b2`.
All 18 pre-Jest/post-Vitest and post-Jest/post-Vitest Cartesian backend
comparisons pass.

Both real PGlite selectors pass 14/14. Customer becomes the first unsupported
Vitest lane, and direct/list/resume/matrix verifier paths fail closed there
before spawning.

Vitest discovery lists the exact owned file and all 14 test names. Every real
Vitest `/3` command rejects before execution because one discovered file
cannot satisfy a three-shard request. Jest places all 14 tests on shard 1 and
lets shards 2/3 exit zero through its existing `--passWithNoTests`. The shadow
therefore receives no root, Turbo, workflow, aggregate, hosted-CI, or GitHub
owner.

All/scoped/general/serial unit graphs remain 85/65/20, 1/1/0, 83/63/20, and
2/2/0. Fast/slow/all integration remain 42/23/19, 5/5/0, and 63/44/19 with
Sales Channel Jest-owned exactly once in fast/all.

Remaining-Jest counts stay exactly 68 configs, 107 scripts, and 406 API files.
Only the PGlite orchestrator and integration verifier digests move; accepted
inventory digest changes from
`fb62eac6a76f38c13c3992695d616194a7634605b8fa06c274866dacfb1c32c2`
to
`4ccce2217a5343bcf77c3eb372e9fac02a6e0adb70a31684de319897153a70ef`.

Normalized-LF hashes move:

- root manifest:
  `df15e90cadc8715e2c57e2464068fdec97f0f5f6b05569a0f1407ead93d88ecf`
  to `641eb605be7a5f8b7b0abcf0ce52c1657f95bfefaefea0ecbf74ca3c66634553`;
- Sales Channel manifest:
  `feda3fcb2a62bfa0fb20a940c18c5f318376c1c2bf45f2e782a3ef00fffc2c18`
  to `aaf97a05ebffe69e01a2a57a29f921155eff0ac72af617d920112e751f9b7df7`;
- new integration config:
  `ab88fc6a6cfe162e0406742ed6e34076d472a77bcf477aa99f37c8ecb3deafbf`;
- PGlite orchestrator:
  `7bdb36011d0add2afe035e075b414845512fdf47859a8c8a1f75328b3acf83e7`
  to `a06c694c2c08de6bf616b46e1b16ff043e3d5343898abcc49c3dd70a857d1d71`;
- integration verifier:
  `af807f671c4576098b4e8afb2de2b92f8d51a9fc5511d3336913fbe10e96824d`
  to `dd9fa189e0ee657f004407441737acbfd60785076f33b209426d99dc5110dad7`;
- strict foundation contract:
  `c4919bdbeb155a65ae65fe96e1f7d58675cb01c8cdc5faa3a95b5cc82437f802`
  to `b12a740356cf07af5d9f1e9100437414389bb82e98c678c79bfd6bb7ecac18b7`;
- remaining-Jest inventory:
  `0dfd12c18ff522d328a5bf4b09ec43c0844fd29d77b54307437379c643c33247`
  to `340ab67e630b24662b289d51f8750a9bccbd78dff404232b66747f2267308b6c`.

The integration source hash remains
`10d9f98b9c52f0e67cdc2584c9d4e0599941ad67c35b2673057f10235230a147`.
Assertions, unit ownership/config, Jest/TypeScript configs, dependencies,
lockfile, workspace shape, workflow, persistence implementation, and
production composition remain unchanged.

Sales Channel build/unit default/unit rollback, frozen offline install across
86 workspaces, exact `workspace:*`, strict/noUnchecked tooling, nine contracts,
the complete 268.1-second foundation, and the 106.2-second 13-command
Cloudflare Vite/import/D1/workerd set pass. Cloudflare checks are independent
production-graph regressions, not this Node integration suite running in
workerd.

The isolated PostgreSQL cluster reached zero scoped clients, stopped, and its
data/log/report paths were removed. Ports 55454/8791/8792/8793/8794 are
closed, no scoped runtime process remains, and no hosted GitHub Actions result
is claimed.

## Next Boundary

Turn 81 should promote only this proven integration shadow, retain the exact
Jest rollback, route both PGlite selectors, exclude Sales Channel from the
generic fast integration graph, and add a runner-neutral unsharded PostgreSQL
job with package-aggregate propagation. Preserve all assertions and add no
other workflow owner.

## Sales Channel Integration Vitest Default

Commit:

- This commit (`test: switch Sales Channel integration lane to Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

Sales Channel integration ownership is now:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The temporary `test:integration:vitest` shadow key is removed. The integration
source, 14 tests, 22 expectation sites, one compatibility timeout call, five
aliases, and zero-snapshot state remain unchanged.

### Exact Three-Backend Cut-Over Proof

Fresh pre-cut-over default-Jest/shadow-Vitest and post-cut-over
default-Vitest/rollback-Jest reports cover:

- MikroORM with an isolated PostgreSQL 18 cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle with Node SQLite `:memory:`.

All 12 reports preserve one passed file, all 14 full names/statuses, zero
failures/skips/todos/snapshots, and normalized digest
`2abda1932abcd108e0a006b536978950c2486113c1221477c497c14caa0ed1b2`.
Every one of the 66 possible report pairs passes the strict normalizer.

The real root PGlite Jest and Vitest selectors each pass 14/14. Customer remains
the first unsupported Vitest lane, and direct/list/resume/matrix selection
fails closed there before process spawn.

Every real post-cut-over Vitest `/3` command still rejects before execution
because the exact config discovers one file. Sales Channel is therefore
removed from the generic fast `/3` graph and receives one runner-neutral
`sales-channel-integration` workflow job. The job uses the existing PostgreSQL
service shape, downloads the setup artifact, and runs the package default
without a shard argument. It has no strategy and no runner name in its job or
step labels.

The `integration-tests-packages` aggregate now needs this job and propagates
its failure, cancellation, skipped, and success terminal states. No
`continue-on-error` or failure masking is added.

Dry task ownership is exact:

- all/scoped/general/serial units remain 85/65/20, 1/1/0, 83/63/20, and
  2/2/0;
- fast integration changes from 42/23/19 to 41/22/19, with Sales Channel
  absent;
- slow integration remains 5/5/0;
- unsharded all integration remains 63/44/19, with Sales Channel exactly once
  on its Vitest default.

Remaining-Jest counts remain exactly 68 configs, 107 scripts, and 406 API
files. Only the Sales Channel integration script key moves from
`test:integration` to `test:integration:jest`, and the PGlite orchestrator
digest changes. The accepted inventory digest becomes
`cf9845867e17ab02f0aea25780b2a1700fdbbfee29502990212d4f072db1f77b`.

Normalized-LF hashes move:

- root manifest:
  `641eb605be7a5f8b7b0abcf0ce52c1657f95bfefaefea0ecbf74ca3c66634553`
  to `558536e3314c2a1fcf0cda9cb31a5dc3f3a1428881e74f32dfff254f3f5a75f2`;
- Sales Channel manifest:
  `aaf97a05ebffe69e01a2a57a29f921155eff0ac72af617d920112e751f9b7df7`
  to `1bfef403362e1e81decfa4c5a49032d7700b5bd4648596cf3b2f05fcb3918404`;
- PGlite orchestrator:
  `a06c694c2c08de6bf616b46e1b16ff043e3d5343898abcc49c3dd70a857d1d71`
  to `c328fa8ec9d478be5f221803475808c7ea731480811b715a2458d7a7b11b08ec`;
- strict foundation contract:
  `b12a740356cf07af5d9f1e9100437414389bb82e98c678c79bfd6bb7ecac18b7`
  to `1640eee4ce619eb49ff30ca54c7cf95ea142a7ad27711ba02a6afedf222221bb`;
- remaining-Jest inventory:
  `340ab67e630b24662b289d51f8750a9bccbd78dff404232b66747f2267308b6c`
  to `4aceb83cb0fb61ecf2166dd3ca6db2963a8587006b72dfaf02f8713ee50391d4`;
- workflow:
  `12cd8dc0cf73100002178fe302e6c4ea3c312b2eb9ab5b3484e2caa0ca100671`
  to `4e638a0f7cfb6d55a7e71ffa9599377bfd4de12feb3d147d12d452dc6e9ff966`.

The integration config remains
`ab88fc6a6cfe162e0406742ed6e34076d472a77bcf477aa99f37c8ecb3deafbf`
and the source remains
`10d9f98b9c52f0e67cdc2584c9d4e0599941ad67c35b2673057f10235230a147`.

Sales Channel build, unit default/rollback, both integration defaults, frozen
offline install across 86 workspaces, exact `workspace:*`, strict tooling, nine
contracts, the complete 258.7-second foundation, and the 92.7-second
13-command Cloudflare Vite/import/D1/workerd set pass. Cloudflare remains a
separate production-graph regression, not this Node integration suite running
inside workerd.

The isolated cluster reached zero other client backends before shutdown. Its
data/log/report root was removed, ports 55455/8791/8792/8793/8794 are closed,
and no scoped runtime process remains. No hosted GitHub Actions result is
claimed.

## Next Boundary

Turn 82 should audit only Customer's source-unit lane and add an opt-in Vitest
shadow if the audit supports exact parity. Preserve Customer's Jest unit and
integration defaults, keep the integration lane fail-closed under explicit
Vitest selection, and make no workflow or persistence change.

## Customer Source-Unit Vitest Shadow

Commit:

- This commit (`test: shadow Customer unit lane with Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

Customer keeps its exact Jest unit and integration defaults and adds only:

```text
test:vitest  vitest run --config vitest.config.mts
```

The new source-only config uses the shared Node profile and Customer's four
existing aliases. The source file, one test, eight expectation calls, Jest
config, TypeScript config, integration command, and integration assertions are
unchanged. No Jest compatibility bridge is needed.

### Exact Shadow Proof

Fresh pre-edit Jest, post-edit Jest/Vitest, and post-build Jest/Vitest reports
all preserve one passed source file, one passed test, zero
failures/skips/todos/snapshots, and normalized digest
`085a838f92e80eaad98273639560d217aac284492d89143a570b41810c35c47d`.
All 10 pairwise comparisons pass. Both post-build runners discover only
`src/__tests__/static-manifest.spec.ts`; generated `dist` output is not
duplicated.

Authentic Jest and Vitest `/4` commands both distribute files/tests as
1/0/0/0, aggregate to exactly one passing test, and allow the three empty
shards to succeed. The shadow has no task-graph or workflow owner.

All dry graphs remain exact:

- unit all/scoped/general/serial: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- integration fast/slow/all: 41/22/19, 5/5/0, and 63/44/19.

Customer remains owned once by its exact Jest commands in the applicable unit
and integration graphs. Its unchanged PGlite Jest integration lane passes one
file/47 tests. Explicit Customer Vitest integration selection still rejects
before process spawn because only Jest is supported.

Remaining-Jest ownership is byte-identical at 68 configs, 107 scripts, and 406
API files. Normalized-LF hashes move only at the unit-shadow boundary:

- root manifest:
  `558536e3314c2a1fcf0cda9cb31a5dc3f3a1428881e74f32dfff254f3f5a75f2`
  to `e2aa800cf33667ebca5d5f8e6ac980187907b70085362e5e55c1d7f16b31409e`;
- Customer manifest:
  `b5662ebe47fb65b92f9aa0031968df81b96dd949919b9ea242821e2f470331e3`
  to `a9a2371e991c28946f656321df47a6f77d461859d2a316d1ab19a60db938cf6b`;
- new Customer Vitest config:
  `52958a368def2a79e1d0cfd5c8278d996f0f6fcd5f948d55124adbb2b9df5935`;
- strict foundation contract:
  `1640eee4ce619eb49ff30ca54c7cf95ea142a7ad27711ba02a6afedf222221bb`
  to `07e8278d393b4bd949758c8755239152ed294298f6b50b65d6e5a2b829ab75b2`.

The source, Jest/TypeScript configs, remaining-Jest inventory, PGlite
orchestrator, integration verifier, workflow, workspace catalog, and lockfile
hashes remain unchanged. Frozen offline install across 86 workspaces, exact
`workspace:*`, Customer build, both unit runners, strict/noUnchecked tooling,
nine contracts, the complete 285.9-second foundation, and the 86.6-second
13-command Cloudflare Vite/import/D1/workerd set pass.

No dependency, catalog, override, lockfile, workspace-shape, integration,
workflow, persistence, production, package privacy/publication, or
repository-merge behavior changed. The Cloudflare gates are independent
production-graph regressions, not this source-unit suite running in workerd.
No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 83 should promote only the proven Customer source-unit shadow to the
default, retain the exact Jest command at `test:jest`, and remove the temporary
`test:vitest` key. Preserve Customer integration as Jest-only and fail-closed
under explicit Vitest selection; make no workflow, persistence, dependency, or
production change.

## Customer Source-Unit Vitest Default

Commit:

- This commit (`test: switch Customer unit lane to Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

Customer source-unit ownership is now:

```text
test       vitest run --config vitest.config.mts
test:jest  jest --bail --passWithNoTests --forceExit --testPathPattern=src
```

The exact former Jest command moved to the rollback key and the temporary
`test:vitest` key is absent. The integration default remains byte-identical,
Jest-authoritative, and unsupported by the explicit PGlite Vitest selector.

### Exact Cut-Over Proof

Fresh pre-cut-over default-Jest/shadow-Vitest, post-cut-over
default-Vitest/rollback-Jest, and post-build default/rollback reports preserve
the exact source file, one passed test, every full name/status, zero
failures/skips/todos/snapshots, and normalized digest
`085a838f92e80eaad98273639560d217aac284492d89143a570b41810c35c47d`.
All 15 possible report pairs pass. Post-build discovery remains source-only.

Both runners' pre/post `/4` commands distribute files/tests as 1/0/0/0,
aggregate to exactly one passing test, and allow all three empty shards to
succeed.

The unchanged Customer PGlite Jest integration lane passes one file/47 tests
before and after cut-over. Explicit Customer Vitest integration selection
continues to reject before process spawn.

All graph shapes remain exact:

- unit all/scoped/general/serial: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- integration fast/slow/all: 41/22/19, 5/5/0, and 63/44/19.

Customer moves exactly once from Jest to Vitest in the applicable unit graphs.
Its integration lane remains owned once by Jest in fast/all and absent from
slow.

Remaining-Jest counts remain exactly 68 configs, 107 scripts, and 406 API
files. Only the byte-identical Customer unit command moves from `test` to
`test:jest`; accepted digest changes from
`cf9845867e17ab02f0aea25780b2a1700fdbbfee29502990212d4f072db1f77b`
to
`591d4acff7892ba1b1cad404dea48f90fae73794e13b980dd6e5dbf138f32ebf`.

Normalized-LF hashes move:

- Customer manifest:
  `a9a2371e991c28946f656321df47a6f77d461859d2a316d1ab19a60db938cf6b`
  to `3c775a816cc08ec3c132a0735b50f82f8cc5d055bd0d40df321ca1e2359f2898`;
- strict foundation contract:
  `07e8278d393b4bd949758c8755239152ed294298f6b50b65d6e5a2b829ab75b2`
  to `14cb17d5e7a990f3438b021de7aadf61aceeb4de1c466f5d9968c4c61c91a31d`;
- remaining-Jest inventory:
  `4aceb83cb0fb61ecf2166dd3ca6db2963a8587006b72dfaf02f8713ee50391d4`
  to `e1255640386d95406afed99ac9fb66f843eb970d2391d1754913a55170248845`.

The source, assertions, Jest/TypeScript/Vitest configs, root manifest, PGlite
orchestrator, integration verifier, workflow, workspace catalog, lockfile,
dependencies, persistence, production, package privacy/publication, and merge
preparation remain unchanged. Customer build, both unit runners, frozen
offline install across 86 workspaces, exact `workspace:*`, strict/noUnchecked
tooling, nine contracts, the complete 273.6-second foundation, and the
90.7-second 13-command Cloudflare Vite/import/D1/workerd set pass.

Cloudflare checks are independent production-graph regressions, not Customer
integration execution in workerd. No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 84 should audit Customer's unchanged integration suite and add only an
opt-in Vitest shadow after exact PostgreSQL, PGlite, and Drizzle/SQLite proof.
Keep Jest authoritative and add no workflow owner before real `/3` behavior is
measured.

## Customer Integration Vitest Shadow

Commit:

- This commit (`test: shadow Customer integration lane with Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

Customer keeps its exact Jest integration default and adds only:

```text
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The exact-file config uses the shared serial integration profile, four existing
aliases, and the shared narrow legacy-Jest bridge for the unchanged
`jest.setTimeout(30000)` call. The suite remains one file, 47 tests, 64
expectation sites, one Jest API call, and zero snapshots.

### Three-Backend Exact Shadow Proof

Fresh pre-edit Jest, post-edit Jest, and post-edit Vitest reports each pass one
file/47 tests through:

- MikroORM with an isolated PostgreSQL 18 cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle with Node SQLite `:memory:`.

All nine reports preserve every full name/status, zero
failures/skips/todos/snapshots, and normalized digest
`6f5d4ea25436106c87939ea69fbf8d217c7189eb8aa89ff7f7bd94a4de1a7c9a`.
All 36 possible report pairs pass.

Both real root PGlite selectors pass one file/47 tests. Analytics becomes the
next unsupported Vitest lane, and direct/list/resume/matrix selection fails
closed there before process spawn.

Current Vitest 4.1.10 accepts Customer's one-file suite under `/3`: both Jest
and Vitest distribute 47/0/0 tests, let shards 2/3 pass empty, and aggregate
all 47 tests exactly once. The opt-in shadow has no generic, workflow,
aggregate, or hosted owner. This positive shard proof means the later default
can remain in generic fast sharding without a dedicated PostgreSQL job.

Dry task ownership is unchanged:

- all/scoped/general/serial units remain 85/65/20, 1/1/0, 83/63/20, and
  2/2/0;
- fast/slow/all integration remains 41/22/19, 5/5/0, and 63/44/19;
- Customer remains owned once by Jest in fast/all and absent from slow.

Remaining-Jest counts remain exactly 68 configs, 107 scripts, and 406 API
files. Only the PGlite orchestrator and fail-closed integration verifier
digests move; accepted inventory digest changes from
`591d4acff7892ba1b1cad404dea48f90fae73794e13b980dd6e5dbf138f32ebf`
to
`3c11614cf41f4ce3721b8863e983be278982d86700b3801b3d18aa324124361a`.

Normalized-LF hashes move:

- root manifest:
  `e2aa800cf33667ebca5d5f8e6ac980187907b70085362e5e55c1d7f16b31409e`
  to `3a44f9b95669f411355ad26fde293896d9ff7d150e6273b4d85bce06d1083ca0`;
- Customer manifest:
  `3c775a816cc08ec3c132a0735b50f82f8cc5d055bd0d40df321ca1e2359f2898`
  to `701373830fbdebc236d2fb3c031f3edbd0f8e5d879953cf9f52fb762bb269b9e`;
- new Customer integration config:
  `6fbdfe940a2039dd405df109ba6d84ee7c636db6507b451092371a752ef057e9`;
- PGlite orchestrator:
  `c328fa8ec9d478be5f221803475808c7ea731480811b715a2458d7a7b11b08ec`
  to `6a9c383d9f8d53ae98759e7efdbc6673c2e14cc8411650a810022f380a4e6f2d`;
- integration verifier:
  `dd9fa189e0ee657f004407441737acbfd60785076f33b209426d99dc5110dad7`
  to `f9d1b0fa4a6a7ba1c8d6dc99266498e565ae59d1644cf67a0c61782a220f14f7`;
- strict foundation contract:
  `14cb17d5e7a990f3438b021de7aadf61aceeb4de1c466f5d9968c4c61c91a31d`
  to `923d8b0b0579f9a396d5d558e140d95fcbd42b9793d2c932a19617aa47d13592`;
- remaining-Jest inventory:
  `e1255640386d95406afed99ac9fb66f843eb970d2391d1754913a55170248845`
  to `8f3a8819bd7f1104ed11333e174c1a50ebe7ec368d2ea23d3b7c4b56b428bbe9`.

The integration source remains
`3d90479251097aba0c6e99fdecf89cb474a734d0b4e446ae0230e0f2790a0f0f`.
Unit ownership/config, Jest/TypeScript configs, dependencies, lockfile,
workspace shape, workflow, persistence, production, package
privacy/publication, and merge preparation remain unchanged.

Customer build and unit default/rollback, frozen offline install across 86
workspaces, exact `workspace:*`, strict/noUnchecked tooling, nine contracts,
the complete 257.9-second foundation, and the 103.0-second 13-command
Cloudflare Vite/import/D1/workerd set pass. Cloudflare is an independent
production-graph regression, not this Node integration suite running in
workerd.

The isolated PostgreSQL cluster reached zero other client backends before
shutdown and port 55456 closed. No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 85 should promote only this proven integration shadow, retain the exact
Jest rollback, route both PGlite selectors, and keep Customer in generic fast
sharding. Remove the temporary shadow key and add no dedicated workflow job.

## Customer Integration Vitest Default

Commit:

- This commit (`test: switch Customer integration lane to Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

Customer's unchanged integration suite now uses:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The temporary `test:integration:vitest` key is removed. The integration
config, four aliases, shared serial profile, narrow timeout bridge, source
file, 47 tests, 64 expectation sites, one `jest.setTimeout(30000)` call, and
zero snapshots remain unchanged.

### Three-Backend Exact Cut-Over Proof

Six fresh pre-cut-over default/shadow reports and six fresh post-cut-over
default/rollback reports each pass the same one file/47 tests through:

- MikroORM with an isolated PostgreSQL 18 cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle with Node SQLite `:memory:`.

All 12 reports preserve every full name/status, zero
failures/skips/todos/snapshots, and normalized digest
`6f5d4ea25436106c87939ea69fbf8d217c7189eb8aa89ff7f7bd94a4de1a7c9a`.
All 66 possible report pairs pass.

The globally Jest-default PGlite selector routes Customer to
`test:integration:jest`; explicit `--runner=vitest` routes it to the package
default. Both real selectors pass 47/47. Analytics remains the next
unsupported Vitest lane and still fails closed before process spawn.

Both post-cut-over runners' `/3` distributions are 47/0/0, all six shard
commands exit successfully, and the aggregate contains every test exactly
once. Customer therefore stays in generic fast sharding with no dedicated
workflow job.

Dry task ownership remains exact:

- all/scoped/general/serial units remain 85/65/20, 1/1/0, 83/63/20, and
  2/2/0;
- fast/slow/all integration remains 41/22/19, 5/5/0, and 63/44/19;
- Customer appears exactly once on Vitest in fast/all and remains absent from
  slow.

Remaining-Jest counts remain exactly 68 configs, 107 scripts, and 406 API
files. Only Customer's byte-identical command key and the PGlite orchestrator
digest move; accepted inventory digest changes from
`3c11614cf41f4ce3721b8863e983be278982d86700b3801b3d18aa324124361a`
to
`1778bcf206ba7712e20a726f4d1365315b5ad597d41d9c04811d48d429066bf4`.

Normalized-LF hashes move:

- Customer manifest:
  `701373830fbdebc236d2fb3c031f3edbd0f8e5d879953cf9f52fb762bb269b9e`
  to `c62d5f7e7c1265e6dc2192e28aa507c7d5fde1d082cb29420af75d5d9fa76090`;
- PGlite orchestrator:
  `6a9c383d9f8d53ae98759e7efdbc6673c2e14cc8411650a810022f380a4e6f2d`
  to `ca773281faeca4b5737c138610da64fd6bf5f0b473ca53d55fdbb0cce9594ebe`;
- strict foundation contract:
  `923d8b0b0579f9a396d5d558e140d95fcbd42b9793d2c932a19617aa47d13592`
  to `e943c82c25d333b74fc19d1a257c68b67a028b38a0c1eb994cf8112147e0730a`;
- remaining-Jest inventory:
  `8f3a8819bd7f1104ed11333e174c1a50ebe7ec368d2ea23d3b7c4b56b428bbe9`
  to `72b045c89dbf91be53c131b87dcb593f7ddc42532188f94c4383e759f8692d7e`.

The root manifest, integration source/config, unit ownership/config,
Jest/TypeScript configs, integration verifier, workflow, workspace catalog,
lockfile, dependencies, persistence, production, package
privacy/publication, and merge preparation remain unchanged.

Customer build and unit default/rollback, frozen offline install across 86
workspaces, exact `workspace:*`, strict/noUnchecked tooling, nine contracts,
the complete 257.3-second foundation, and the 84.5-second 13-command
Cloudflare Vite/import/D1/workerd set pass. Cloudflare is an independent
production-graph regression, not this Node integration suite running in
workerd.

The isolated PostgreSQL cluster reached zero other client backends before
shutdown and port 55457 closed. No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 86 should audit Analytics's source-unit lane and add only an opt-in Vitest
shadow after exact discovery, assertion, mock, and shard parity. Keep both
Analytics defaults on Jest and keep integration fail-closed until its separate
shadow turn.

## Analytics Source-Unit Vitest Shadow

Commit:

- This commit (`test: shadow Analytics unit lane with Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

Analytics retains both exact Jest defaults and adds only:

```text
test:vitest  vitest run --config vitest.config.mts
```

The new source-only config uses the shared Node Vitest/SWC profile, the five
existing package aliases, source-prefixed discovery, and no legacy-Jest
bridge. The unchanged source boundary remains one file, one test, eight
expectation sites, zero Jest APIs, and zero snapshots.

The integration lane is deliberately separate: its one file/three tests still
use `jest.setTimeout`, `jest.SpyInstance`, `jest.spyOn`, and
`jest.clearAllMocks`. It remains Jest-default and explicit Vitest PGlite
selection fails closed before process spawn.

### Exact Shadow Proof

Fresh pre-edit Jest, post-edit Jest/Vitest, and post-build Jest/Vitest reports
all preserve the exact source file, full name/status, one passed test, zero
failures/skips/todos/snapshots, and normalized digest
`c06d35fca0798b76dab6056cb66022e1e8aae94981e31782dee46bedecaddc4a`.
All 10 possible report pairs pass.

Both authentic `/4` commands distribute 1/0/0/0 tests, all eight shard
commands exit successfully, and each runner aggregates the one test exactly
once. The opt-in shadow has no task-graph, workflow, aggregate, or hosted
owner.

Dry task ownership remains exact:

- all/scoped/general/serial units remain 85/65/20, 1/1/0, 83/63/20, and
  2/2/0;
- fast/slow/all integration remains 41/22/19, 5/5/0, and 63/44/19;
- Analytics remains owned once by Jest in applicable unit and integration
  graphs and remains absent from serial/slow.

The unchanged real PGlite Jest integration selector passes one file/three
tests before and after the source edit. Explicit Analytics Vitest integration
selection continues to reject before spawn.

Remaining-Jest ownership remains byte-identical at 68 configs, 107 scripts,
and 406 API files, accepted digest
`1778bcf206ba7712e20a726f4d1365315b5ad597d41d9c04811d48d429066bf4`,
and inventory-file hash
`72b045c89dbf91be53c131b87dcb593f7ddc42532188f94c4383e759f8692d7e`.

Normalized-LF hashes move only at the unit-shadow boundary:

- root manifest:
  `3a44f9b95669f411355ad26fde293896d9ff7d150e6273b4d85bce06d1083ca0`
  to `f3071bc43b790bdf12236ebe4eb0039743cbf63b0b488dced9cb4848637907e0`;
- Analytics manifest:
  `edc87bdff3ddbecdda161b2da05dcbea14477285bb4a8d118c98884d08054eba`
  to `bb7bda71dcd693273e4344ec543ea9d07755e7f1a1fb90c3949fbef733d678a5`;
- new Analytics Vitest config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- strict foundation contract:
  `e943c82c25d333b74fc19d1a257c68b67a028b38a0c1eb994cf8112147e0730a`
  to `45b29fe8041d1cae0ed45d172ec3b2be1086a36f80837583cd294fde287cbbf4`.

The source, integration source, Jest/TypeScript configs, remaining-Jest
inventory, PGlite orchestrator, integration verifier, workflow, workspace
catalog, lockfile, dependencies, persistence, production, package
privacy/publication, and merge preparation remain unchanged.

Analytics build, Jest default, Vitest shadow, frozen offline install across 86
workspaces, exact `workspace:*`, strict/noUnchecked tooling, nine contracts,
the complete 259.7-second foundation, and the 84.2-second 13-command
Cloudflare Vite/import/D1/workerd set pass. Cloudflare is an independent
production-graph regression, not this Node source suite running in workerd.
No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 87 should promote only the proven Analytics source-unit shadow to the
default, retain the exact Jest command at `test:jest`, and remove the temporary
`test:vitest` key. Keep Analytics integration Jest-only and fail-closed for
Vitest until its separate shadow turn.

## Analytics Source-Unit Vitest Default

Commit:

- This commit (`test: switch Analytics unit lane to Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

Analytics now owns:

```text
test              vitest run --config vitest.config.mts
test:jest         jest --passWithNoTests --bail --forceExit --testPathPattern=src
test:integration  jest --passWithNoTests --forceExit --testPathPattern="integration-tests/__tests__/.*\.ts"
```

The temporary `test:vitest` key is removed. The exact Jest source-unit command
and active Jest config remain available for one-command rollback. The
source-only Vitest config, its five aliases, the source specification, all
eight expectation sites, and every expected value remain unchanged.

Analytics integration remains a separate Jest-only boundary. Its one
file/three tests still own `jest.setTimeout`, `jest.SpyInstance`,
`jest.spyOn`, and `jest.clearAllMocks`; explicit Vitest PGlite selection still
fails closed before process spawn.

### Exact Default And Rollback Proof

Six fresh pre-edit, post-edit, and post-build Jest/Vitest reports all preserve
the exact source file and test name/status, one passed file/test, zero
failures/skips/todos/snapshots, and normalized digest
`c06d35fca0798b76dab6056cb66022e1e8aae94981e31782dee46bedecaddc4a`.
All 15 possible report pairs pass.

The direct Vitest default and Jest rollback both pass every real unit-CI `/4`
command with `--maxWorkers=1 --passWithNoTests`, distribute 1/0/0/0 tests,
and aggregate the one test exactly once. The corrected scoped root command
selects only Analytics and reproduces the same four successful shard results.

Dry graph ownership remains:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 41/22/19, 5/5/0, and 63/44/19.

Analytics moves exactly once from Jest to Vitest in all/scoped/general unit
graphs, remains absent from serial, and stays owned once by Jest in fast/all
integration while absent from slow.

The unchanged real PGlite Jest integration selector passes one file/three
tests before and after the cut-over. Explicit Analytics Vitest integration
selection rejects before spawn both times.

### Superseding Unit CI Separator Repair

The exact Turn 86 workflow-shaped command exposed a pre-existing failure:

```text
pnpm test --filter=... -- --shard=...
```

With pnpm 11.7.0's built-in `test` alias, pnpm consumes that separator. Turbo
then receives `--shard` as its own option and exits before package execution:

```text
unexpected argument '--shard'
```

Turn 87 advances the parsed contract first, captures the expected exact
single-versus-double-separator failure, and changes only the two unit-matrix
lines to:

```text
pnpm test --filter='!@medusajs/framework' --filter='!@medusajs/utils' -- -- --shard=${{ matrix.shard_index }}/4 --maxWorkers=${{ steps.cpu-cores.outputs.count }} --passWithNoTests
pnpm test --filter=@medusajs/framework --filter=@medusajs/utils -- -- --shard=${{ matrix.shard_index }}/4 --passWithNoTests
```

The first separator belongs to pnpm; the second is retained by Turbo. Exact
dry execution proves all 83 general nodes receive shard, worker, and
pass-with-no-tests arguments, while the two serial nodes receive shard and
pass-with-no-tests without `--maxWorkers`. All four exact Analytics general
shards and all four Framework/Utils serial shards pass. The serial shard-1
proof preserves Framework's 9 suites/49 tests/2 snapshots and Utils's 24
suites/142 passed/1 skipped tests/2 snapshots.

The custom package-integration script path is distinct: its single separator
is retained and reached a package test before the bounded diagnostic was
stopped. Turn 87 therefore changes no integration workflow command and makes
no result claim from that stopped diagnostic.

### Inventory, Hashes, And Validation

Remaining-Jest counts stay exact at 68 configs, 107 scripts, and 406 API
files. Only Analytics's unchanged Jest command key moves from `test` to
`test:jest`; the reviewed digest becomes
`10fbe08d6fac527f2bf5d0f9a7c5d3b7db7aa23db5046241378cb066d66d3bca`.

Normalized-LF hashes move:

- Analytics manifest:
  `bb7bda71dcd693273e4344ec543ea9d07755e7f1a1fb90c3949fbef733d678a5`
  to `363ac47257c544a6db563842b18f60c0668855577371c6ff22cf251f3612f750`;
- strict foundation contract:
  `45b29fe8041d1cae0ed45d172ec3b2be1086a36f80837583cd294fde287cbbf4`
  to `886666826b06b0896802ab2ea0bf826238fe828a2e2a027bc824847533dd81cd`;
- remaining-Jest inventory:
  `72b045c89dbf91be53c131b87dcb593f7ddc42532188f94c4383e759f8692d7e`
  to `222e09bfbf705ac76952dd406132caf86730032f12606b8ac3b2592da1e8489c`;
- workflow:
  `4e638a0f7cfb6d55a7e71ffa9599377bfd4de12feb3d147d12d452dc6e9ff966`
  to `cba622f101f8d859f440f530d3ba4c359782ddca948b1bf3f342d017df295cb9`.

The root manifest, source, integration source, Jest/Vitest/TypeScript configs,
PGlite orchestrator, integration verifier, workspace catalog, lockfile,
dependencies, persistence, production, package privacy/publication, and merge
preparation remain unchanged.

Analytics build/default/rollback, frozen offline install across all 86
workspaces, exact `workspace:*`, strict/noUnchecked tooling, nine contracts,
the complete 272.7-second foundation, and the 196.8-second 13-command
Cloudflare Vite/import/D1/workerd set pass. Cloudflare is an independent
production-graph regression, not this Node source suite running in workerd.
No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 88 should add only an Analytics integration Vitest shadow after auditing
its timeout, spy, namespace-type, and mock-reset compatibility. Keep the
Vitest source-unit default and exact Jest unit rollback unchanged; keep the
integration default on Jest until exact PostgreSQL/PGlite/Drizzle and shard
proof is complete.

## Analytics Integration Vitest Shadow

Commit:

- This commit (`test: shadow Analytics integration lane with Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

Analytics keeps its exact Jest integration default and adds only:

```text
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The new config selects the exact integration file through the shared serial
profile, five existing aliases, and the narrow legacy-Jest bridge. The
unchanged assertions still use `jest.setTimeout`, `jest.SpyInstance`,
`jest.spyOn`, and `jest.clearAllMocks`.

The first PostgreSQL Vitest probe proved that Medusa's built CommonJS provider
loader cannot resolve the original path-loaded TypeScript fixture. Analytics
therefore follows the already-proven Auth boundary: its single provider
fixture is checked CommonJS JavaScript, the runtime path names `.js`
explicitly, and the test validates the native-required module before spying on
the exact constructor held in Node's module cache. No unchecked assertion or
`any` bridge is introduced, and all three test expectations are unchanged.

### Three-Backend Exact Shadow Proof

Fresh pre-edit Jest, post-edit Jest, and post-edit Vitest reports each pass one
file/three tests through:

- MikroORM with an isolated PostgreSQL 18 cluster;
- PGlite through the shared module-test persistence adapter;
- Drizzle with Node SQLite `:memory:`.

All nine reports preserve every full name/status, zero
failures/skips/todos/snapshots, and normalized digest
`689d13219971cc7e1fca75fdfc4fc4c3d99c2da51814a55ebbc4a5646a95f389`.
All 36 possible report pairs pass.

Both real root PGlite selectors pass one file/three tests. File becomes the
next unsupported Vitest lane, and direct/list/resume/matrix selection fails
closed there before process spawn.

Both runners distribute the one-file PostgreSQL suite across `/3` as 3/0/0
with `--passWithNoTests`, and all six commands exit successfully. The opt-in
shadow has no generic graph, workflow, aggregate, or hosted owner. This proof
allows Turn 89 to retain the generic fast graph if the default is promoted.

Dry task ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 41/22/19, 5/5/0, and 63/44/19.

Analytics remains owned once by Jest in fast/all integration and absent from
slow. Remaining-Jest counts remain 68 configs, 107 scripts, and 406 API files.
Only the PGlite orchestrator and integration verifier ownership hashes move;
accepted digest becomes
`4493c251a6d93e9ef7c86296779d6d9d6e6f00df573dcb6d154e56c0e233f334`.

Normalized-LF hashes move:

- root manifest:
  `f3071bc43b790bdf12236ebe4eb0039743cbf63b0b488dced9cb4848637907e0`
  to `ed4a75d1c372c3e44a855f5b9ac9a39f44791ec982458949b3570cca3a80524a`;
- Analytics manifest:
  `363ac47257c544a6db563842b18f60c0668855577371c6ff22cf251f3612f750`
  to `65393f2f57d9b88365483babd272148ed06ca07a659926a4ae6b5150c56f5b10`;
- integration source:
  `4c76c977040f8bc61c54d9ec365002f8a3bbad21c3cab579c08b82a97f45c813`
  to `b260f6cbcd3895198d175a97e591ada66e894a6b331c985e551d6799e730851b`;
- provider fixture moves from TypeScript
  `2d66d071ad6aefc8fc03758470fa44551c79a1597a9b777590619abfdf61db0d`
  to checked CommonJS JavaScript
  `79eba31652a6926ba24984ccb9be3fa9f3a8ae2992a103a1aadf26e7bbba3f14`;
- provider barrel:
  `ba971756cb694c35959f927c3f4c278c82feb717ea6b02f222880b977b85cbac`
  to `c73070f55df71c562e3b68cdcdbea41c5bdbf5cd8bde1cf17eeaeaa362a58739`;
- new integration config:
  `60b74722fe1a4e2e2aec0fe8581613c2f771548f0db6283076a240005a47e727`;
- PGlite orchestrator:
  `ca773281faeca4b5737c138610da64fd6bf5f0b473ca53d55fdbb0cce9594ebe`
  to `b73128a8c87d8b18b9936d20ae0f6890c8c135ed43c2d3981b5f3a31010fe1bc`;
- integration verifier:
  `f9d1b0fa4a6a7ba1c8d6dc99266498e565ae59d1644cf67a0c61782a220f14f7`
  to `59dfa5cfc260b96fbf11055e0d91f488957328f70c8e914cd930fa71543acae1`;
- strict foundation contract:
  `886666826b06b0896802ab2ea0bf826238fe828a2e2a027bc824847533dd81cd`
  to `9b7f5024ffc686454fb3ebea88b3b9c34d9d4be383ff8515618092f16bf06bb7`;
- remaining-Jest inventory:
  `222e09bfbf705ac76952dd406132caf86730032f12606b8ac3b2592da1e8489c`
  to `357cdac7c9afa401315d290ff0d675bdcdda65d564a73dd71e35f33f81a18108`.

Analytics build/unit default/Jest rollback, strict/noUnchecked fixture and
runner tooling, nine contracts, frozen offline install across all 86
workspaces, exact `workspace:*`, the complete 348.5-second foundation, and the
279.5-second 13-command Cloudflare Vite/import/D1/workerd set pass.
Cloudflare is an independent production-graph regression, not this Node
integration suite running in workerd. Dependencies, catalogs, lockfile,
workflow, persistence adapters, production composition, package
privacy/publication, and repository-merge preparation remain unchanged. The
isolated PostgreSQL cluster reached zero other client backends before
shutdown, its temporary data/log/report root is removed, and no hosted GitHub
Actions result is claimed.

## Analytics Integration Vitest Default

Commit:

- This commit (`test: switch Analytics integration lane to Vitest`)

Date verified: 2026-07-31.

Turn 89 promotes only the proven Analytics integration lane:

- `test:integration` now runs the existing exact-file Vitest profile;
- the byte-for-byte Jest command moves to `test:integration:jest`;
- the temporary `test:integration:vitest` key is removed;
- the root PGlite selector maps `jest` to the rollback and `vitest` to the
  default.

No test source, assertion, expected value, snapshot, provider fixture, config,
root manifest, workflow, dependency, catalog, lockfile, persistence adapter,
or production composition changes. The strict contract was advanced before
the manifest change and failed with the exact old-default/new-default
mismatch.

Fresh pre-cut-over default Jest/shadow Vitest and post-cut-over default
Vitest/rollback Jest reports pass on MikroORM/PostgreSQL 18, PGlite, and
Drizzle/SQLite. All 12 reports preserve one file/three tests, every full
name/status, zero failures/skips/todos/snapshots, and normalized digest
`689d13219971cc7e1fca75fdfc4fc4c3d99c2da51814a55ebbc4a5646a95f389`.
All 66 possible report pairs pass.

Both real Analytics PGlite selectors pass 3/3. Explicit File/Vitest selection
fails closed before process spawn. Both default Vitest and rollback Jest
distribute the PostgreSQL suite across `/3` as 3/0/0 with all six commands
successful.

All dry graph triplets remain exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 41/22/19, 5/5/0, and 63/44/19.

Analytics moves exactly once from Jest to Vitest in fast/all integration and
remains absent from slow. No dedicated job or workflow edit is needed.
Remaining-Jest counts remain 68 configs, 107 scripts, and 406 API files;
accepted digest becomes
`fe53124f95797aaaa8156f2cdcf07371e495f2a56dd98d3600c2d72ab695b3f8`.

Normalized-LF hashes move only at cut-over ownership boundaries:

- Analytics manifest:
  `65393f2f57d9b88365483babd272148ed06ca07a659926a4ae6b5150c56f5b10`
  to `8b397fe78ac7053b7efc5574fa8336891705895d4936a0defe1e422f2c086e91`;
- PGlite orchestrator:
  `b73128a8c87d8b18b9936d20ae0f6890c8c135ed43c2d3981b5f3a31010fe1bc`
  to `e982bb4c0111a3e6adfb64906430f61ec86924ce86d622feaae36f35e810a85f`;
- strict foundation contract:
  `9b7f5024ffc686454fb3ebea88b3b9c34d9d4be383ff8515618092f16bf06bb7`
  to `20140afcd058f1933dd033088d8918deb92dfe26f89b30cfacf90731c8387e13`;
- remaining-Jest inventory:
  `357cdac7c9afa401315d290ff0d675bdcdda65d564a73dd71e35f33f81a18108`
  to `66cda6d6f10003f10acf118aa166bf892c4b7e2650fefe932a51dcd09ae4745c`.

The root manifest, integration config/source/fixture, and workflow retain their
Turn 88 hashes. Analytics build/unit default/Jest rollback, frozen offline
install across all 86 workspaces, exact `workspace:*`, strict/noUnchecked
tooling, nine contracts, the complete 329.9-second foundation, and the
188.1-second 13-command Cloudflare set pass. Cloudflare remains an independent
production-graph regression and does not claim this Node integration suite
ran in workerd. No hosted GitHub Actions result is claimed.

## File Source-Unit Vitest Shadow

Commit:

- This commit (`test: shadow File unit lane with Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

File retains both exact Jest defaults and adds only:

```text
test:vitest  vitest run --config vitest.config.mts
```

The new source-only config uses the shared Node Vitest/SWC profile, the four
aliases already owned by File's Jest and TypeScript configs, source-prefixed
discovery, and no legacy-Jest bridge. The unchanged source boundary remains
two files, two tests, ten expectation sites, zero Jest APIs, and zero
snapshots.

The integration lane remains deliberately separate. Its one file/four tests
stays Jest-default, passes through the real PGlite selector before and after
the source change, and explicit File/Vitest integration selection fails closed
before process spawn.

### Exact Shadow Proof

Fresh pre-edit Jest, post-edit Jest/Vitest, and post-build Jest/Vitest reports
all preserve both exact source files, full names/statuses, two passed tests,
zero failures/skips/todos/snapshots, and normalized digest
`d13d56d514b40ce97e7e19da791470cdc34f95587b1fe48673d88c99cae9a3cf`.
All 10 possible report pairs pass.

Both direct runners distribute the two tests across `/4` as 1/1/0/0 with
`--maxWorkers=1 --passWithNoTests`; all eight commands exit successfully and
each runner aggregates exactly two tests. The authentic scoped root Jest
command has the same four successful shards and 1/1/0/0 distribution. The
opt-in Vitest shadow has no task-graph, workflow, aggregate, or hosted owner.

Dry task ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 41/22/19, 5/5/0, and 63/44/19.

File remains owned once by Jest in applicable unit and integration graphs and
remains absent from serial/slow. Remaining-Jest ownership is byte-identical at
68 configs, 107 scripts, 406 API files, accepted digest
`fe53124f95797aaaa8156f2cdcf07371e495f2a56dd98d3600c2d72ab695b3f8`,
and inventory-file hash
`66cda6d6f10003f10acf118aa166bf892c4b7e2650fefe932a51dcd09ae4745c`.

Normalized-LF hashes move only at the File source-shadow boundary:

- root manifest:
  `ed4a75d1c372c3e44a855f5b9ac9a39f44791ec982458949b3570cca3a80524a`
  to `501b1875d478072ff0fedfb3ce38b4071cc6787a046832882a8df552e55a7f8e`;
- File manifest:
  `7631878c9f13db1c61453de76062a32d2822e46457ebb00e05ffe7d7d60e6912`
  to `e7e213ea859825b730e8804a783cab1b734f45fe4d7454b06c97f53ad332ffe9`;
- new File Vitest config:
  `52958a368def2a79e1d0cfd5c8278d996f0f6fcd5f948d55124adbb2b9df5935`;
- strict foundation contract:
  `20140afcd058f1933dd033088d8918deb92dfe26f89b30cfacf90731c8387e13`
  to `d2e6bd229db95f9a641eb786b8981f3889777d73322f155444786ceec834e5f2`.

Both source files, the integration source, Jest/TypeScript configs,
remaining-Jest inventory, PGlite orchestrator, workflow, dependencies,
catalogs, lockfile, persistence, production, package privacy/publication, and
merge preparation remain unchanged.

File build/Jest default/Vitest shadow, frozen offline install across all 86
workspaces, exact `workspace:*`, strict/noUnchecked tooling, nine contracts,
and the complete foundation pass. The first full foundation attempt reached a
Vitest fork-termination timeout; the isolated 279.2-second integration gate
and complete 515.1-second foundation rerun passed unchanged.

The first Cloudflare sequence reached a load-sensitive Vite/workerd startup
timeout. An isolated diagnostic proved the unchanged server became healthy
just beyond that attempt's 30-second health window; the unchanged workerd
gate then passed, followed by the complete 288.6-second 13-command
Vite/import/D1/workerd set. Cloudflare is an independent production-graph
regression, not this Node source suite running in workerd. No hosted GitHub
Actions result is claimed.

## Next Boundary

Turn 91 should promote only the proven File source-unit shadow to the default,
retain the exact Jest command at `test:jest`, and remove the temporary
`test:vitest` key. Keep File integration Jest-only and fail-closed for Vitest
until its separate shadow turn.

## File Source-Unit Vitest Default

Commit:

- This commit (`test: switch File unit lane to Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

File source-unit ownership now exposes:

```text
test       vitest run --config vitest.config.mts
test:jest  jest --passWithNoTests --bail --forceExit --testPathPattern=src
```

The temporary `test:vitest` shadow key is removed. Neither source test changes:
their shared `describe`/`it`/`expect` calls are already native Vitest syntax,
and the boundary still contains zero Jest-only APIs. The exact Jest command is
retained only as rollback.

File integration remains deliberately separate and Jest-default. Its four
tests and active `jest.setTimeout(100000)` are not hidden behind the unit
cut-over; they remain the explicit native-syntax work for the integration
shadow.

### Exact Cut-Over Proof

Six fresh pre-cut-over, post-cut-over, and post-build reports preserve both
exact source files, full names/statuses, two passed tests, zero
failures/skips/todos/snapshots, and normalized digest
`d13d56d514b40ce97e7e19da791470cdc34f95587b1fe48673d88c99cae9a3cf`.
All 15 possible report pairs pass.

Direct default Vitest, exact Jest rollback, and authentic scoped-root default
each distribute the two tests across `/4` as 1/1/0/0 with
`--maxWorkers=1 --passWithNoTests`; all 12 commands exit successfully.

Dry task ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 41/22/19, 5/5/0, and 63/44/19.

File moves exactly once from Jest to Vitest in all/scoped/general unit graphs
and remains absent from serial. Integration stays owned once by Jest in
fast/all and absent from slow.

The unchanged real PGlite Jest selector passes one file/four tests before and
after cut-over. The first pre-cut-over attempt hit a native process
out-of-memory failure under machine pressure before assertions; the unchanged
retry passed 4/4, as did the post-cut-over run. Explicit File/Vitest
integration selection rejects before process spawn both times.

Remaining-Jest counts stay exactly 68 configs, 107 scripts, and 406 API files.
Only the exact File rollback ownership key moves from `test` to `test:jest`;
accepted digest becomes
`0ea4911f5dbf19a794830d9356bb63f2615f9785f0fe714206b787116b1d8902`.

Normalized-LF ownership hashes move only at the promoted boundary:

- File manifest:
  `e7e213ea859825b730e8804a783cab1b734f45fe4d7454b06c97f53ad332ffe9`
  to `548b5d44da385bc357502956f5bb0a0c60fd19660ade5e5b6026e8984c2f42d4`;
- strict foundation contract:
  `d2e6bd229db95f9a641eb786b8981f3889777d73322f155444786ceec834e5f2`
  to `de9d379d41c941f65727588850b181a32f415f6f43f722f78af9e444f647df0c`;
- remaining-Jest inventory:
  `66cda6d6f10003f10acf118aa166bf892c4b7e2650fefe932a51dcd09ae4745c`
  to `d3bf075eb6bbb86e87b285af497860ed34bc532178ba2fec8e17295093bf34f1`.

Root manifest, File Vitest/Jest/TypeScript configs, both source tests,
integration source, PGlite orchestrator, workflow, dependencies, catalogs,
lockfile, persistence, production, privacy/publication, and merge preparation
remain unchanged.

File build/default/rollback, frozen offline install across all 86 workspaces,
exact `workspace:*`, strict/noUnchecked tooling, nine contracts, the complete
529.7-second foundation, and the complete 218.2-second 13-command
Vite/import/D1/workerd set pass. Cloudflare remains an independent
production-graph regression; no hosted GitHub Actions result is claimed.

## Next Boundary

Turn 92 should add only the separate File integration Vitest shadow, migrate
its one `jest.setTimeout` call to an explicit native Vitest-compatible timeout
boundary, and prove the unchanged four tests across the applicable
database lanes. Keep Jest as the integration default until that shadow is
proven.

## File Integration Native Vitest Shadow

Commit:

- This commit (`test: shadow File integration lane with Vitest`)

Date verified: 2026-07-31.

### Difference From Original Medusa

File retains its Jest integration default and adds:

```text
test:integration         jest ... --testTimeout=100000 ...
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The source-level `jest.setTimeout(100000)` call is removed. Jest now owns that
timeout explicitly in its command, while the File Vitest config owns matching
100-second test and hook timeouts. The shared integration profile gains
optional timeout and legacy-bridge controls; all existing consumers retain the
same five-second defaults and legacy bridge. File explicitly disables the
bridge, so its integration spec contains zero Jest-only APIs.

The first native PostgreSQL Vitest probe proved that Medusa's built CommonJS
provider loader cannot resolve the extensionless TypeScript fixture. File
therefore follows the proven Auth/Analytics boundary: the single fixture is
strictly checked CommonJS JavaScript, the runtime path names `.js` explicitly,
and the provider barrel names the same file. Buffer input is normalized to the
provider contract's string storage without changing any test expectation.

### Three-Backend Exact Shadow Proof

Nine pre/post reports cover Jest and native Vitest across:

- isolated PostgreSQL 18;
- PGlite through the module-test persistence adapter;
- Drizzle/SQLite through the shared DML/repository adapter.

All nine reports preserve the exact one file/four tests, full names/statuses,
six expectation sites, zero failures/skips/todos/snapshots, and normalized
digest
`976233a8271cf7b030f1f3ad625e4135f120c94331e742793ff0f85d1c1252ee`.
All 36 possible report pairs pass.

Both real PGlite File selectors pass 4/4. Unsupported Vitest ownership advances
exactly to Stock Location and still rejects before process spawn. Both
PostgreSQL runners consume `/3` successfully as 4/0/0, so a future File
integration cut-over can remain in the generic fast graph.

All dry task shapes remain exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 41/22/19, 5/5/0, and 63/44/19.

File remains owned once by Vitest in applicable unit graphs and once by Jest in
fast/all integration while absent from serial/slow. The opt-in integration
shadow has no task-graph, workflow, aggregate, or hosted owner.

Remaining-Jest ownership falls from 406 to 405 API files and from 286 to 285
`jest.setTimeout` files. Configs/scripts remain 68/107; accepted digest becomes
`89031c157378f4eda7b203569918756f0ba8be86069163b1819a1a985c1e0787`.

Normalized-LF hashes move at the native integration boundary:

- root manifest:
  `501b1875d478072ff0fedfb3ce38b4071cc6787a046832882a8df552e55a7f8e`
  to `eba2f8c70f004122f06145f7ff171890b9248d445d5e3b669379582720eda7ce`;
- File manifest:
  `548b5d44da385bc357502956f5bb0a0c60fd19660ade5e5b6026e8984c2f42d4`
  to `7f1b43af60c051de762f24199792ec82b7fa3d10e220ae8ec1e7f30879465e97`;
- integration source:
  `6fdf263bc0493d0d438f69db551e9f8c03411f1796319dc7fe81340f1d660dcd`
  to `dd8b415a5cfe357e0d39ee82eca960ac2a8c85d18dcbf1ae8ef525aebeb2cffe`;
- provider fixture moves from TypeScript
  `fba4b73be2c55599d819b4f88bf30aab7832b6e179b21214bb891482bcc93154`
  to checked CommonJS JavaScript
  `1d9fe1a76d9562a6ea8b0deef4c17dca63ecadb51bbd3cabccf2d0faf6665de0`;
- provider barrel:
  `ba971756cb694c35959f927c3f4c278c82feb717ea6b02f222880b977b85cbac`
  to `c73070f55df71c562e3b68cdcdbea41c5bdbf5cd8bde1cf17eeaeaa362a58739`;
- new integration config:
  `92e1d02f11f99fc1954999aa5f76171556d59d69862bfdcc58040c666eead715`;
- shared Node profile:
  `a79a1ff83c9ec52fd84efe41492d2b59264523784f9c99054bdfb2fe7fe8c0b7`
  to `833f3d0afc6974eb0e2591ed4dd802522cc3afde014f609502146b45cc15d439`;
- shared integration profile:
  `4f3d86e994555a03ba34d193eae24694ddfcad28ed0202bb7a119a9802c2590d`
  to `92d72ec2c372d2802628b1add74aefc6a31b5a7c040d460d8663745f419c4616`;
- strict contract:
  `de9d379d41c941f65727588850b181a32f415f6f43f722f78af9e444f647df0c`
  to `e27645053d96fdd209f61489e844f63b2bd35ae73e22e577d717876bab30caaf`;
- PGlite orchestrator:
  `e982bb4c0111a3e6adfb64906430f61ec86924ce86d622feaae36f35e810a85f`
  to `79f03cc7daf6717950268f5a0255db76608489330cc0135534d0f475ed7d32df`;
- integration verifier:
  `59dfa5cfc260b96fbf11055e0d91f488957328f70c8e914cd930fa71543acae1`
  to `7ef9dceff625915bbed1bbf9a670649eaf9c9d90a8b2fd77c1e7b1f841790ca9`;
- remaining-Jest inventory:
  `d3bf075eb6bbb86e87b285af497860ed34bc532178ba2fec8e17295093bf34f1`
  to `821fb69692e515dd54dc5130ba1aa9084616392d7efd350a7e63ceeccfc895de`.

File build/unit default/Jest rollback, strict/noUnchecked fixture and runner
tooling, ten contracts, frozen offline install across all 86 workspaces, exact
`workspace:*`, the isolated 272.5-second integration foundation, the complete
416.7-second foundation, the complete 240.1-second 13-command
Vite/import/D1/workerd set, and the final 496.4-second formatted-state dual
selector plus integration-foundation rerun pass.

The temporary PostgreSQL cluster was stopped after the backend and shard proof.
Cloudflare remains an independent production-graph regression, not this Node
integration suite running in workerd. Dependencies, catalogs, lockfile,
workflow, persistence adapters, production composition, privacy/publication,
and merge preparation remain unchanged. No hosted GitHub Actions result is
claimed.

## Next Boundary

Turn 93 should promote only the proven File integration shadow to
`test:integration`, retain the exact Jest command at `test:integration:jest`,
and remove `test:integration:vitest`. Keep File in the generic fast graph; no
workflow edit or dedicated job is required by the proven 4/0/0 aggregate.

## File Integration Vitest Default Ownership

Commit:

- This commit (`test: switch File integration lane to Vitest`)

Date verified: 2026-08-01.

### Difference From Original Medusa

File's native/no-bridge Vitest integration lane is now the package default:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest ... --testTimeout=100000 ...
```

The temporary `test:integration:vitest` key is removed. The exact Jest command
is retained as rollback, including its explicit 100-second timeout. The
integration source, checked CommonJS provider fixture, Vitest config, four
aliases, module service, assertions, expected values, and timeout value remain
byte-identical to the proven Turn 92 shadow.

The PGlite orchestrator now selects `test:integration:jest` for its Jest mode
and the default `test:integration` for Vitest mode. Stock Location remains the
next unsupported Vitest lane and still fails closed before process spawn.

### Exact Cut-Over Proof

Twelve fresh pre/post reports cover default/shadow before promotion and
default/rollback after promotion across:

- isolated MikroORM/PostgreSQL 18;
- PGlite through the shared module-test persistence adapter;
- Drizzle/SQLite through the shared DML/repository adapter.

All 66 possible report pairs preserve one file, four passed tests, every full
name/status, six expectation sites, zero failures/skips/todos/snapshots, and
normalized digest
`976233a8271cf7b030f1f3ad625e4135f120c94331e742793ff0f85d1c1252ee`.
Both real root PGlite selectors pass 4/4.

Both default Vitest and rollback Jest consume the real PostgreSQL `/3` shape
as 4/0/0 with all six commands successful. All dry task shapes remain exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 41/22/19, 5/5/0, and 63/44/19.

File remains owned once by Vitest in applicable unit graphs, moves exactly
once from Jest to Vitest in fast/all integration, and remains absent from
serial/slow. The unchanged workflow therefore needs no dedicated File job.

Remaining-Jest counts stay 68 configs, 107 scripts, and 405 API files. Only
the exact File rollback script key and PGlite orchestrator digest move;
accepted inventory digest becomes
`a0d41f08e8e41db25bbfcf6555c369d80c32ffa4a530db18018bc05eb9c3a20a`.

Normalized-LF ownership hashes move only at the promoted boundary:

- File manifest:
  `7f1b43af60c051de762f24199792ec82b7fa3d10e220ae8ec1e7f30879465e97`
  to `eb10c87e5abfdf5254c76adf119940c6eac0267dbd39a657426ac12cb5622806`;
- PGlite orchestrator:
  `79f03cc7daf6717950268f5a0255db76608489330cc0135534d0f475ed7d32df`
  to `572eee29bf9bead59ec18dfa82825bcf0a28cc773276d8df2c5bda49787a5ba7`;
- strict contract:
  `e27645053d96fdd209f61489e844f63b2bd35ae73e22e577d717876bab30caaf`
  to `3f3b56042bf45d5647f372f888d345b3eacb588aa0b1caca8682c3e3b33b17c4`;
- remaining-Jest inventory:
  `821fb69692e515dd54dc5130ba1aa9084616392d7efd350a7e63ceeccfc895de`
  to `545e1d64efda91b8bd175d3786aee5b5ebaea0414aeef76e72067de1f78378d9`.

The first post-cut-over PGlite Vitest reporter and early foundation attempts
hit native V8 `Zone` out-of-memory failures under host commit pressure before
usable assertions completed. The unchanged reporter retry passed; direct
Jest and Vitest adapter lanes each passed three files/34 tests; and the final
unchanged canonical foundation passed in 395.5 seconds. No heap, timeout,
runner, or runtime source was edited to mask the environment failure.

Frozen offline install across all 86 workspaces, exact `workspace:*`, File
build/unit runners, strict/noUnchecked tooling, ten contracts, the complete
395.5-second foundation, and the complete 237.5-second 13-command
Vite/import/D1/workerd set pass. Cloudflare remains an independent
production-graph regression, not this Node integration suite running in
workerd. Dependencies, catalogs, lockfile, workflow, persistence adapters,
production composition, privacy/publication, and merge preparation remain
unchanged. No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 94 should add only a Stock Location source-unit Vitest shadow. Freeze its
source files, aliases, Jest API surface, integration boundary, task graphs,
and rollback command before adding an opt-in runner; keep both Stock Location
defaults on Jest until that unit shadow is proven.

## Stock Location Source-Unit Vitest Shadow

Commit:

- This commit (`test: shadow Stock Location unit lane with Vitest`)

Date verified: 2026-08-01.

### Difference From Original Medusa

Stock Location retains both exact Jest defaults and adds only:

```text
test:vitest  vitest run --config vitest.config.mts
```

The new config uses the shared Node Vitest/SWC profile, source-prefixed
discovery, and all five aliases already owned by the package's Jest and
TypeScript configs. It does not enable the legacy Jest bridge. The two source
files are unchanged and already use runner-shared `describe`/`it`/`expect`
syntax: two tests, nine expectation sites, zero Jest-only APIs, and zero
snapshots.

The integration suite remains an explicit Jest-only boundary. Its unchanged
one file/eight tests still owns `jest.setTimeout(100000)` and continues to run
through `test:integration`; no Vitest integration config or command is added.

### Exact Shadow Proof

Fresh pre-edit Jest, post-edit Jest/Vitest, and post-build Jest/Vitest reports
preserve both exact source files, every full name/status, two passed tests,
zero failures/skips/todos/snapshots, and normalized digest
`9a8130aa81ad85e8d365607af15e580125a8dc2c8e44cbb90286bc737625264c`.
All 10 possible report pairs pass.

Direct Jest, direct Vitest shadow, and the authentic scoped-root Jest command
all consume `/4` successfully as 1/1/0/0 with `--maxWorkers=1` and
`--passWithNoTests`; all 12 commands exit successfully and each aggregate owns
exactly two tests. The shadow has no task-graph, workflow, aggregate, or hosted
owner.

Dry ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 41/22/19, 5/5/0, and 63/44/19.

Stock Location remains owned once by Jest in applicable unit and integration
graphs and remains absent from serial/slow. Its real PGlite Jest selector
passes one file/eight tests before and after the source change. Explicit
Stock Location/Vitest integration selection rejects before process spawn both
times.

Remaining-Jest ownership is byte-identical at 68 configs, 107 scripts, and
405 API files, with accepted digest
`a0d41f08e8e41db25bbfcf6555c369d80c32ffa4a530db18018bc05eb9c3a20a`
and inventory-file hash
`545e1d64efda91b8bd175d3786aee5b5ebaea0414aeef76e72067de1f78378d9`.

Normalized-LF hashes move only at the Stock Location source-shadow boundary:

- root manifest:
  `eba2f8c70f004122f06145f7ff171890b9248d445d5e3b669379582720eda7ce`
  to `7c0bbce44ae0fc4e17ee3dd8875ac4fb9dcdbf7999a98a4e29996d36d8c13707`;
- Stock Location manifest:
  `6464ef6bd0925b472ebcf754eefecf960347c46562c0cc859d48dfa2a2220df5`
  to `23154481cc7c0de43df51702163ffc477cb15ed802195b5b4c23cfa8deaef2f4`;
- new Stock Location Vitest config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- strict foundation contract:
  `3f3b56042bf45d5647f372f888d345b3eacb588aa0b1caca8682c3e3b33b17c4`
  to `86d511a5c0c78f1c63568391edd529a082b962b3830780252d4c997678269f44`.

Both source files, the integration source, Jest/TypeScript configs,
remaining-Jest inventory, PGlite orchestrator, workflow, dependencies,
catalogs, lockfile, persistence, production, privacy/publication, and merge
preparation remain unchanged.

Stock Location build/Jest default/Vitest shadow, frozen offline install across
all 86 workspaces, exact `workspace:*`, strict/noUnchecked tooling, ten
contracts, the complete 396.8-second foundation, and the complete 248.7-second
13-command Vite/import/D1/workerd set pass. Cloudflare is an independent
production-graph regression, not this Node source suite running in workerd.
No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 95 should promote only the proven Stock Location source-unit shadow to
`test`, retain the exact Jest source command at `test:jest`, and remove the
temporary `test:vitest` key. Keep Stock Location integration Jest-only and
fail-closed for Vitest until its separate native-syntax migration turn.

## Stock Location Source-Unit Vitest Default

Commit:

- This commit (`test: switch Stock Location unit lane to Vitest`)

Date verified: 2026-08-01.

### Difference From Original Medusa

Stock Location source-unit ownership now exposes:

```text
test       vitest run --config vitest.config.mts
test:jest  jest --bail --forceExit --testPathPattern=src
```

The temporary `test:vitest` shadow key is removed. Neither source file nor the
shared-profile config changes: the two tests already use native
Vitest-compatible `describe`/`it`/`expect` syntax and contain zero Jest-only
APIs. The exact previous Jest command is retained only as rollback.

Stock Location integration remains deliberately separate and Jest-default.
Its unchanged one-file/eight-test suite still owns
`jest.setTimeout(100000)`; the unit cut-over neither bridges nor hides that
native-syntax work.

### Exact Cut-Over Proof

Six fresh pre-cut-over, post-cut-over, and post-build reports preserve both
source files, every full name/status, two passed tests, nine expectation sites,
zero failures/skips/todos/snapshots, and normalized digest
`9a8130aa81ad85e8d365607af15e580125a8dc2c8e44cbb90286bc737625264c`.
All 15 possible report pairs pass.

Direct default Vitest, exact Jest rollback, and authentic scoped-root default
all consume `/4` successfully as 1/1/0/0 with `--maxWorkers=1` and
`--passWithNoTests`; all 12 commands exit successfully.

Dry ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 41/22/19, 5/5/0, and 63/44/19.

Stock Location moves exactly once from Jest to Vitest in applicable unit
graphs and remains absent from serial. Integration stays owned once by Jest in
fast/all and absent from slow. The unchanged real PGlite Jest selector passes
one file/eight tests before and after cut-over; explicit Vitest integration
selection rejects before process spawn both times.

Remaining-Jest counts stay exactly 68 configs, 107 scripts, and 405 API files.
Only the Stock Location source rollback key moves from `test` to `test:jest`;
the accepted digest becomes
`f823411e2055f8c528416f42061a7262a5aa68f2c87b0ada7c863a19c7bc2110`.

Normalized-LF ownership hashes move only at the promoted boundary:

- Stock Location manifest:
  `23154481cc7c0de43df51702163ffc477cb15ed802195b5b4c23cfa8deaef2f4`
  to `f6e71d355143c742aab8999ff4e685be77101fd1cd5750ef7f49c3af6b338047`;
- strict foundation contract:
  `86d511a5c0c78f1c63568391edd529a082b962b3830780252d4c997678269f44`
  to `ed04fce0f3ec83339e4733e59c9662619b631e300658e74252346a64a648e556`;
- remaining-Jest inventory:
  `545e1d64efda91b8bd175d3786aee5b5ebaea0414aeef76e72067de1f78378d9`
  to `91f58bc770261be0c3727c19617c6dcf63b7858fefe9b71728a63c82865e4f67`.

Root manifest, Vitest/Jest/TypeScript configs, both source tests, integration
source, PGlite orchestrator, workflow, dependencies, catalogs, lockfile,
persistence, production, privacy/publication, and merge preparation remain
unchanged.

Stock Location build/default/rollback, frozen offline install across all 86
workspaces, exact `workspace:*`, strict/noUnchecked tooling, ten contracts,
the complete 387.0-second foundation, and the complete 130.8-second
13-command Vite/import/D1/workerd set pass. Cloudflare remains an independent
production-graph regression, not this Node source suite running in workerd.
No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 96 should add only the separate Stock Location integration Vitest shadow,
migrate its single `jest.setTimeout(100000)` call to explicit runner-owned
timeouts, and prove the unchanged eight assertions through the applicable
database lanes. Keep Jest as the integration default until that native shadow
is proven.

## Stock Location Integration Native Vitest Shadow

Commit:

- This commit (`test: shadow Stock Location integration lane with Vitest`)

Date verified: 2026-08-01.

### Difference From Original Medusa

Stock Location keeps Jest authoritative for integration and adds one opt-in
native Vitest command:

```text
test:integration         jest --passWithNoTests --forceExit --testTimeout=100000 --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The suite's only Jest-specific source API, `jest.setTimeout(100000)`, is
removed. The Jest CLI and native Vitest config now own matching 100-second
timeouts. The new serial integration config includes the one integration
file, preserves all five package aliases, is strictly typechecked exactly
once, and explicitly sets `legacyJestBridge: false`. The source now contains
zero `jest.*` calls; its existing `describe`/`it`/`expect` syntax is already
native Vitest syntax and is intentionally unchanged.

### Exact Shadow Proof

Nine pre/post reports cover Jest before the edit plus Jest and native Vitest
after the edit on each distinct Node persistence path:

- isolated MikroORM/PostgreSQL 18;
- PGlite through the shared module-test persistence adapter;
- Drizzle/SQLite through the shared DML compiler and repository adapter.

All 36 report pairs preserve the exact one file/eight passed tests, every full
name/status, nine expectation sites, zero failures/skips/todos/snapshots, and
normalized result digest
`9cdd60a75316fb7d555d48e0e3456686eaffee0189273a61df9cad0992bae990`.
Both real root PGlite selectors pass 8/8, and unsupported Vitest ownership
advances fail-closed to Inventory.

The authentic PostgreSQL Jest `/3` commands all exit successfully with
8/0/0 aggregate distribution. Native Vitest 4 rejects the one-file suite at
`--shard=1/3` because the shard count exceeds the file count. That negative
proof is an intentional cut-over gate: the shadow has no task-graph or
workflow owner, and Stock Location must be excluded from the generic fast
integration shard and receive one runner-neutral unsharded PostgreSQL job
before Vitest becomes the default.

Dry ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 41/22/19, 5/5/0, and 63/44/19.

Stock Location stays owned once by Jest in fast/all integration and remains
absent from slow. The opt-in Vitest shadow is deliberately unowned by CI.
Remaining-Jest ownership decreases only for the removed source API: 68
configs, 107 scripts, and 404 API files, with accepted digest
`2cc63584311e26acd4c03f3d6b28cd844e46fe82576702958c30ad94e4553f0a`.

Normalized-LF ownership hashes move only at this boundary:

- root manifest:
  `7c0bbce44ae0fc4e17ee3dd8875ac4fb9dcdbf7999a98a4e29996d36d8c13707`
  to `03bb6eb9dee7a8c3f121d92275a1f90926262821a9613988e7810f07ad7ad87e`;
- Stock Location manifest:
  `f6e71d355143c742aab8999ff4e685be77101fd1cd5750ef7f49c3af6b338047`
  to `ebf6315c4002f086297b3ac8222263c03f49af74fb704b6c4e1faefb7aa2e041`;
- integration source:
  `368676d68ba5deaaf77ec7b4593fe7a54defb3a4b44cede61782e0e7dc65f555`
  to `51aae9196ebdda1242c260f667fe82391d323f28885eb3d0e7cade81f44ad7e6`;
- new integration config:
  `b16f68566d6a5a357f8c38f01fe875cc06ad4f23a5d385a9bdea362a83aa6286`;
- PGlite orchestrator:
  `572eee29bf9bead59ec18dfa82825bcf0a28cc773276d8df2c5bda49787a5ba7`
  to `1df367f39fab11a17c441540ee8eb510ef28367ca46b6c983f74e66910763a7a`;
- integration-foundation verifier:
  `7ef9dceff625915bbed1bbf9a670649eaf9c9d90a8b2fd77c1e7b1f841790ca9`
  to `67de658789df1dbe7ca1737d43dce0687a2d9630da08525924a184be6dee629e`;
- strict foundation contract:
  `ed04fce0f3ec83339e4733e59c9662619b631e300658e74252346a64a648e556`
  to `accb5ed539047c32ff4e4ad077956e3d509fc18ebeaecf7838358c7a1198eb2d`;
- remaining-Jest inventory:
  `91f58bc770261be0c3727c19617c6dcf63b7858fefe9b71728a63c82865e4f67`
  to `de0b99a3f63f37f6dad45f2f47501ec35bff1fd954cf537efa76c031d8d68d90`.

Stock Location build/source default/source rollback/integration default/native
shadow, frozen offline install across all 86 workspaces, exact `workspace:*`,
strict/noUnchecked tooling, ten contracts, and the complete 331.7-second
foundation pass. The 13-command Cloudflare production-graph set also passes:
the first loop completed 10/13 before `test:workerd` timed out waiting for its
local Vite/workerd server; the unchanged retry passed in 64.4 seconds and the
final two SQLite/workerd gates passed in 19.1 seconds. No timeout, heap,
runner, or production source was changed to mask that transient startup.

No persistence adapter, query, connection, transaction, migration, DML model,
module service, repository, fixture, assertion, expected value, dependency,
catalog, lockfile, privacy/publication metadata, production composition, or
workflow changes. Cloudflare is an independent production-graph regression;
it does not claim this Node integration suite ran in workerd, D1, or Durable
Object SQLite. No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 97 should promote only this proven integration shadow, preserve the exact
Jest integration command at `test:integration:jest`, remove the temporary
shadow key, exclude Stock Location from generic fast integration sharding,
and add one runner-neutral unsharded PostgreSQL job with aggregate result
propagation. Keep Inventory fail-closed until its own source and integration
turns.

## Stock Location Integration Vitest Default

Commit:

- This commit (`test: switch Stock Location integration lane to Vitest`)

Date verified: 2026-08-01.

### Difference From Original Medusa

Stock Location integration now exposes stable runner ownership:

```text
test:integration       vitest run --config vitest.integration.config.mts
test:integration:jest  jest --passWithNoTests --forceExit --testTimeout=100000 --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
```

The temporary `test:integration:vitest` key is removed. The source, native
no-bridge config, all five aliases, 100-second timeout, one file, eight tests,
nine expectation sites, and zero-`jest.*` boundary remain unchanged from the
proven Turn 96 shadow.

### Exact Cut-Over Proof

Twelve fresh pre/post reports cover default/shadow before promotion and
default/rollback after promotion across:

- isolated MikroORM/PostgreSQL 18;
- PGlite through the shared module-test persistence adapter;
- Drizzle/SQLite through the shared DML/repository adapter.

All 66 report pairs preserve the exact one file/eight passed tests, every full
name/status, nine expectation sites, zero failures/skips/todos/snapshots, and
normalized digest
`9cdd60a75316fb7d555d48e0e3456686eaffee0189273a61df9cad0992bae990`.
Both real root PGlite selectors pass 8/8 through the new rollback/default
keys. Inventory remains the next fail-closed Vitest integration lane.

The exact CI command, unsharded
`pnpm --filter @medusajs/stock-location test:integration`, passes PostgreSQL
with all eight tests. Stock Location is excluded from the generic fast `/3`
graph and now has one runner-neutral unsharded PostgreSQL workflow job. The
job name contains neither Jest nor Vitest; it uses the shared setup artifact,
PostgreSQL health check, explicit database environment, and the package's
stable default command. Both aggregate failure and success conditions include
the job.

Dry ownership is exact:

- all/scoped/general/serial units remain 85/65/20, 1/1/0, 83/63/20, and
  2/2/0;
- fast integration becomes 40/21/19 with Stock Location absent;
- slow integration remains 5/5/0 with Stock Location absent;
- unsharded all integration remains 63/44/19 with Stock Location exactly once
  on Vitest.

Remaining-Jest ownership stays 68 configs, 107 scripts, and 404 API files.
Only the exact rollback key and PGlite orchestrator digest move; accepted
digest becomes
`26bde82560b12f9c5b3d3f284ba3060f1ce9386768f7d649bec840383004b6d8`.

Normalized-LF ownership hashes move only at the promoted boundary:

- root manifest:
  `03bb6eb9dee7a8c3f121d92275a1f90926262821a9613988e7810f07ad7ad87e`
  to `24c73ca633b086ea807c6c06f93d99f4521db0d00d7050c3c2d2a702b321986e`;
- Stock Location manifest:
  `ebf6315c4002f086297b3ac8222263c03f49af74fb704b6c4e1faefb7aa2e041`
  to `1cc5a5affab5f970de9058159b1a658eb7406af1aedc13c53dee8d53f225c052`;
- PGlite orchestrator:
  `1df367f39fab11a17c441540ee8eb510ef28367ca46b6c983f74e66910763a7a`
  to `cf536cbb0dd2a5d28646a84dfe0f3061c8b8ee66c5a64f3f25d6619ad8972032`;
- workflow:
  `cba622f101f8d859f440f530d3ba4c359782ddca948b1bf3f342d017df295cb9`
  to `76e57af8b8ab873a981d6565e5c57e1a2dad89a09a6f51d789f203f0b5f88b38`;
- strict foundation contract:
  `accb5ed539047c32ff4e4ad077956e3d509fc18ebeaecf7838358c7a1198eb2d`
  to `64dad993d4325a4325ef2786ae37137431dc6955b21e610db6fc5206faff5e42`;
- remaining-Jest inventory:
  `de0b99a3f63f37f6dad45f2f47501ec35bff1fd954cf537efa76c031d8d68d90`
  to `3d7e4db344e70cd88191eb75055b238dc375e87f61d5242ea32779474790f347`.

The integration source remains
`51aae9196ebdda1242c260f667fe82391d323f28885eb3d0e7cade81f44ad7e6`
and the native config remains
`b16f68566d6a5a357f8c38f01fe875cc06ad4f23a5d385a9bdea362a83aa6286`.

Stock Location build/source default/source rollback/integration default/
integration rollback, frozen offline install across all 86 workspaces, exact
`workspace:*`, strict/noUnchecked tooling, ten contracts, and the complete
315.4-second foundation pass. All 13 Cloudflare gates also pass. The first
10/13 loop reached `test:workerd` after 249.5 seconds; two local Vite/workerd
startups timed out while the isolated PostgreSQL cluster remained active.
After the completed backend cluster was stopped, the unchanged workerd command
passed in 69.5 seconds and the final two SQLite/workerd gates passed in 53.7
seconds. No timeout, heap, runner, or production source was changed to mask
the resource pressure.

No test source/config/fixture, assertion, expected value, persistence adapter,
query, connection, transaction, migration, DML model, module service,
repository, dependency, catalog, lockfile, privacy/publication metadata, or
production composition changes. The workflow job is locally parsed and
command-proven; no hosted GitHub Actions result is claimed. Cloudflare remains
an independent production-graph regression and does not claim this Node suite
ran in workerd, D1, or Durable Object SQLite.

## Next Boundary

Turn 98 should add only an Inventory source-unit native Vitest shadow. Freeze
its current source files, discovery, aliases, Jest API surface, integration
boundary, task graphs, and exact Jest defaults before adding the opt-in runner.
Keep Inventory integration Jest-only and fail-closed for Vitest until its own
separate integration turn.

## Inventory Source-Unit Vitest Shadow

Commit:

- This commit (`test: shadow Inventory unit lane with Vitest`)

Date verified: 2026-08-01.

### Difference From Original Medusa

Inventory retains both exact Jest defaults and adds only:

```text
test:vitest  vitest run --config vitest.config.mts
```

The new config uses the shared Node Vitest/SWC profile, source-prefixed
discovery, and all five aliases already owned by the package's Jest config. It
does not enable the legacy Jest bridge. Neither source file changes because
both already use runner-shared `describe`/`it`/`expect` syntax: two tests, ten
expectation sites, zero Jest-only APIs, and zero snapshots.

The integration suite remains an explicit Jest-only boundary. Its unchanged
one file/35-test PGlite run continues through `test:integration`; no Vitest
integration config, command, or PGlite mapping is added.

### Exact Shadow Proof

Fresh pre-edit Jest, post-edit Jest/Vitest, and post-build Jest/Vitest reports
preserve both exact source files, every full name/status, two passed tests,
zero failures/skips/todos/snapshots, and normalized digest
`d8c5611e5df9f41668483147d1eb09c6a48dd918db1a17d3596e5e366617a9ce`.
All ten possible report pairs pass.

Direct Jest, direct Vitest shadow, and the authentic root-scoped Jest command
all consume `/4` successfully as 1/1/0/0 with one worker and
`--passWithNoTests`; all 12 valid commands exit successfully. An initial local
root-scoped harness invocation contained one extra separator, causing Jest to
treat the shard flags as path patterns. Those four runs were excluded, the
invocation was corrected to the real single Turbo separator, and all four
valid root-scoped shard probes passed.

The shadow has no task-graph, workflow, aggregate, or hosted owner. Dry
ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 40/21/19, 5/5/0, and 63/44/19.

Inventory remains owned once by Jest in applicable unit and integration
graphs and remains absent from serial/slow. Its real PGlite Jest selector
passes one file/35 tests before and after the source change. Explicit
Inventory/Vitest integration selection rejects before process spawn both
times.

Remaining-Jest ownership is byte-identical at 68 configs, 107 scripts, and
404 API files, with accepted digest
`26bde82560b12f9c5b3d3f284ba3060f1ce9386768f7d649bec840383004b6d8`
and inventory-file hash
`3d7e4db344e70cd88191eb75055b238dc375e87f61d5242ea32779474790f347`.

Normalized-LF hashes move only at the Inventory source-shadow boundary:

- root manifest:
  `24c73ca633b086ea807c6c06f93d99f4521db0d00d7050c3c2d2a702b321986e`
  to `5ab818ab10776c8c27ed5761d232a72185b83e01e68bbbf1f3c4762485ae90c6`;
- Inventory manifest:
  `b91bbbf49df48a99603266bffd97bee85af5acc2878c82f0191ec2ef33a8a535`
  to `0f1d6ab5e52ff3f242a59f1e3bc619ece6cb091e376ac2f03722837b4d44351d`;
- new Inventory Vitest config:
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- strict foundation contract:
  `64dad993d4325a4325ef2786ae37137431dc6955b21e610db6fc5206faff5e42`
  to `2ce2b84a91c0b382590de5c115e5b48295f8ad7daa873078bccaf4be12e2f983`.

Both source files, the integration source, Jest/TypeScript configs,
remaining-Jest inventory, PGlite orchestrator, workflow, dependencies,
catalogs, lockfile, persistence, production, privacy/publication, and merge
preparation remain unchanged.

Inventory build/Jest default/Vitest shadow, frozen offline install across all
86 workspaces, exact `workspace:*`, strict/noUnchecked tooling, ten contracts,
and the complete 349.0-second foundation pass. The first ten Cloudflare gates
passed in 65.3 seconds; the first `test:workerd` attempt timed out waiting for
local Vite health after 73.7 seconds. Ports and scoped processes were clean,
the unchanged command passed in 22.0 seconds, and the final two SQLite/workerd
gates passed in 17.8 seconds. No timeout, heap, runner, or runtime source was
changed to mask the transient startup.

Cloudflare is an independent production-graph regression, not this Node
source suite running in workerd. No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 99 should promote only this proven Inventory source-unit shadow to
`test`, retain the exact Jest source command at `test:jest`, and remove the
temporary `test:vitest` key. Keep Inventory integration Jest-only and
fail-closed for Vitest until its separate migration turns.

## Inventory Source-Unit Vitest Default

Commit:

- This commit (`test: switch Inventory unit lane to Vitest`)

Date verified: 2026-08-01.

### Difference From Original Medusa

Inventory source-unit ownership now exposes:

```text
test       vitest run --config vitest.config.mts
test:jest  jest --bail --forceExit --testPathPattern=src
```

The temporary `test:vitest` key is removed. Neither source file nor the
source-only no-bridge config changes: both tests already use native
Vitest-compatible `describe`/`it`/`expect` syntax and contain zero Jest-only
APIs. The exact previous Jest command is retained only as rollback.

Inventory integration remains deliberately separate and Jest-only. Its
unchanged one-file/35-test suite still contains `jest.setTimeout(100000)` and
one `jest.spyOn`; the unit cutover neither bridges nor hides that native-syntax
work.

### Exact Cutover Proof

Six fresh pre-cutover, post-cutover, and post-build reports preserve both
source files, every full name/status, two passed tests, ten expectation sites,
zero failures/skips/todos/snapshots, and normalized digest
`d8c5611e5df9f41668483147d1eb09c6a48dd918db1a17d3596e5e366617a9ce`.
All 15 possible report pairs pass.

Direct default Vitest, exact Jest rollback, and the authentic root-scoped
default all consume `/4` successfully as 1/1/0/0 with one worker and
`--passWithNoTests`; all 12 commands exit successfully.

Dry ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 40/21/19, 5/5/0, and 63/44/19.

Inventory moves exactly once from Jest to Vitest in applicable unit graphs and
remains absent from serial. Integration stays owned once by Jest in fast/all
and absent from slow. Its real PGlite Jest selector passes one file/35 tests
before and after cutover, while explicit Vitest integration selection rejects
before process spawn both times.

Remaining-Jest ownership stays 68 configs, 107 scripts, and 404 API files.
Only the exact Jest command's key moves from `test` to `test:jest`; accepted
digest becomes
`4ba7781d052ed7438a21cca958811c8cc19ac96b97320db89bce2358b5f05c0c`.

Normalized-LF hashes move only at the Inventory unit-cutover boundary:

- Inventory manifest:
  `0f1d6ab5e52ff3f242a59f1e3bc619ece6cb091e376ac2f03722837b4d44351d`
  to `2ed3bd52d28cc3d12a2f4ac4da470414858de7459310bed2a264e17e52735695`;
- strict foundation contract:
  `2ce2b84a91c0b382590de5c115e5b48295f8ad7daa873078bccaf4be12e2f983`
  to `646031741912a18b5d02a461dd3e1a5c11326939bc9b7cee8c670839efa587ef`;
- remaining-Jest inventory:
  `3d7e4db344e70cd88191eb75055b238dc375e87f61d5242ea32779474790f347`
  to `503ea180ee7905de4c7983ce54eaa0f279baabea7a7893844c7508eec5107a48`.

The root manifest remains
`5ab818ab10776c8c27ed5761d232a72185b83e01e68bbbf1f3c4762485ae90c6`
and the Vitest config remains
`9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`.
Both source files, the integration source, Jest/TypeScript configs, PGlite
orchestrator, workflow, dependencies, catalogs, lockfile, persistence,
production, privacy/publication, and merge preparation remain unchanged.

Inventory build/default/rollback, frozen offline install across all 86
workspaces, exact `workspace:*`, strict/noUnchecked tooling, ten contracts,
the complete 352.6-second foundation, and the uninterrupted 140.2-second
13-command Cloudflare Vite/import/D1/workerd set pass. Cloudflare is an
independent production-graph regression, not this Node source suite running in
workerd. No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 100 should add only a separate Inventory integration Vitest shadow.
Freeze its one file, 35 tests, assertions, two Jest-only sites, aliases,
timeout, three-backend behavior, PGlite routing, and `/3` distribution before
migrating runner-specific timeout/spy ownership. Keep Vitest opt-in until that
parity is proven.

## Inventory Integration Native Vitest Shadow

Commit:

- This commit (`test: shadow Inventory integration lane with Vitest`)

Date verified: 2026-08-01.

Inventory integration remains Jest-owned at `test:integration`; the new
`test:integration:vitest` command is an opt-in native shadow. Its serial config
owns the same five aliases, a 100-second hook/test timeout, and
`legacyJestBridge: false`.

This is a syntax migration, not only a runner swap. The source imports `vi`
from `vitest`, uses `vi.spyOn`, and contains no `jest.*`. The suite-level Jest
timeout moved to the exact Jest CLI command and Vitest config. A package-local
Jest module mapper resolves only the imported `vi.spyOn` capability for
rollback; it does not install the shared global bridge.

Both runners pass one file, 35 tests, 56 direct expectation calls, zero
failures/skips/todos, and zero snapshots on isolated PostgreSQL 18, PGlite,
and Drizzle/SQLite. Both real PGlite selectors pass 35/35. Jest `/3` passes at
35/0/0; every native Vitest `/3` request exits 1 because one discovered file
cannot be split three ways. The shadow remains outside task/workflow ownership.

Key normalized-LF hashes are:

- source: `4cbe73bcd241b83fbae956ff9f95d0a51242d891c853f0ec11c64b8ab8b8594e`;
- Jest rollback shim: `5bbe1cac9fad3ed79fc388c22225001a9ce2604de585659ce94c61ed24341c9f`;
- Jest config: `6f009cd30f3606a3f9960cf1ebad1a3aee13b5a6797c73f764237dbe141b74df`;
- Vitest integration config: `dd02aab839e0ba3c68a6ecf66775bbf347f5e83e65fec7597ae3393c0ea6e891`.

Active Jest API files decrease from 404 to 403; configs/scripts remain 68/107
with accepted digest
`e943997da072baa63400a7384b784e1d3dad4ec755e10ab2bcf99f69fa4ebd89`.
Frozen install, exact `workspace:*`, Inventory build, strict tooling, ten
contracts, the complete 417.1-second foundation, and all 13 Cloudflare gates
pass in 202.6 seconds. No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 101 should promote only this proven Inventory integration shadow, retain
the Jest rollback, and add dedicated unsharded PostgreSQL ownership. Do not
alter test assertions or force this one-file suite through generic `/3`.

## Inventory Integration Native Vitest Default

Commit:

- This commit (`test: switch Inventory integration lane to Vitest`)

Date verified: 2026-08-01.

Inventory now owns native/no-bridge Vitest at `test:integration`, preserves the
exact previous Jest command at `test:integration:jest`, and removes the
temporary shadow key. The integration source, config, five aliases, timeout,
and package-local rollback shim remain byte-identical to Turn 100.

Six pre-cutover and six post-cutover PostgreSQL/PGlite/Drizzle reports pass 13
targeted runner/backend/cut-over comparisons at one file, 35 tests, every full
name/status, 56 direct expectation calls, and zero snapshots. Both real PGlite
selectors pass 35/35. The exact unsharded PostgreSQL workflow command passes
35/35.

Inventory is excluded from generic fast `/3`; dry integration shapes move from
40/21/19 to 39/20/19 fast and remain 5/5/0 slow and 63/44/19 all. A new
runner-neutral unsharded PostgreSQL job is locally parsed and its result is
required by both aggregate paths. No hosted result is claimed.

Remaining-Jest counts remain 68 configs, 107 scripts, and 403 active API files.
Only the command key and PGlite orchestration digest move; accepted digest is
`19528db8149de345cffbe190041bc9a54fa948c983f9b4a4f9cacb5b413ee0d2`.

Frozen install across 86 workspaces, exact `workspace:*`, Inventory build,
strict tooling, ten contracts, the final 451.9-second foundation, and all 13
Cloudflare gates pass in 212.9 seconds. The first aggregate attempt had three
transient 5-second adapter timeouts; the unchanged focused 3-file/34-test proof
and unchanged full aggregate then passed without timeout changes.

## Next Boundary

Turn 102 should add only a Tax source-unit native Vitest shadow. Freeze source
discovery, aliases, Jest API usage, defaults, integration ownership, and graph
shapes before implementation; keep Tax integration Jest-only.

## Tax Source-Unit Native Vitest Shadow

Commit:

- This commit (`test: shadow Tax unit lane with Vitest`)

Date verified: 2026-08-01.

### Difference From Original Medusa

Tax retains both exact Jest defaults and adds only:

```text
test:vitest  vitest run --config vitest.config.mts
```

The source-only config consumes the shared Node Vitest/SWC profile, scopes both
repository discovery globs beneath `src/`, and preserves all five aliases from
the existing Jest config. It does not enable the legacy Jest bridge. Neither
source test changes: the suffixed static-manifest specification and unsuffixed
noop test already use runner-shared `describe`/`it`/`expect` syntax, with two
tests, 12 direct expectation calls, zero Jest-only APIs, and zero snapshots.

Tax integration remains a separate Jest-only boundary. Its exact command, two
files, 35 tests, 55 direct expectation calls, and two
`jest.setTimeout(30000)` sites remain unchanged. No Vitest integration command
or config is added.

### Exact Shadow Proof

The final-form ownership contract first failed exactly at the absent
`test:vitest` command, then all ten contract tests passed after the package
script, config, and single strict tooling token were added.

Five fresh pre/post/post-build Jest and Vitest reports preserve both exact
source files, every full name/status, two passed tests, zero
failures/skips/todos/snapshots, and normalized digest
`91fc1cde13d3187d8162b508ce3350cf7c05aae3fe5c0c81fc5613385c74ffe5`.
All ten possible report pairs pass.

Direct Jest, direct Vitest shadow, and the authentic root-scoped Jest command
all consume `/4` successfully as 1/1/0/0 with one worker and
`--passWithNoTests`; all 12 commands exit successfully. The shadow has no task
graph, workflow, aggregate, or hosted owner. Dry ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 39/20/19, 5/5/0, and 63/44/19.

Tax remains owned once by Jest in applicable unit and integration graphs and
absent from serial/slow. Its real PGlite Jest selector passes two files/35
tests. Explicit Tax/Vitest integration selection rejects before process spawn
with the exact unsupported-runner message.

Remaining-Jest ownership is byte-identical at 68 configs, 107 scripts, and 403
active API files, with accepted digest
`19528db8149de345cffbe190041bc9a54fa948c983f9b4a4f9cacb5b413ee0d2`.
The two source files, two integration files, Jest/TypeScript configs, PGlite
orchestrator, workflow, dependencies, catalogs, lockfile, persistence,
production, privacy/publication, and repository-merge behavior remain
unchanged. The new source config has normalized-LF digest
`9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`.

Tax build/Jest default/Vitest shadow, frozen offline install across all 86
workspaces, exact `workspace:*`, strict/noUnchecked tooling, ten contracts,
the complete 461.6-second foundation, and the uninterrupted 129.2-second
13-command Cloudflare Vite/import/D1/workerd set pass. Cloudflare is an
independent production-graph regression, not this Node source suite running in
workerd. No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 103 should promote only this proven Tax source-unit shadow to `test`,
retain the exact Jest source command at `test:jest`, and remove the temporary
`test:vitest` key. Keep Tax integration Jest-only and fail-closed for Vitest
until its separate migration turns.

## Tax Source-Unit Native Vitest Default

Commit:

- This commit (`test: switch Tax unit lane to Vitest`)

Date verified: 2026-08-01.

### Difference From Original Medusa

Tax source-unit ownership now exposes:

```text
test       vitest run --config vitest.config.mts
test:jest  jest --bail --forceExit --testPathPattern=src
```

The temporary `test:vitest` key is removed. Neither source file nor the
source-only no-bridge config changes: both tests already use native
Vitest-compatible `describe`/`it`/`expect` syntax and contain zero Jest-only
APIs. The exact previous Jest command is retained only as rollback.

Tax integration remains deliberately separate and Jest-only. Its unchanged
two-file/35-test suite still contains two `jest.setTimeout(30000)` calls; the
unit cut-over neither bridges nor hides that native-syntax work.

### Exact Cut-Over Proof

The final-form contract first failed exactly at the old Jest `test` value, then
all ten contract tests passed after the three-key manifest cut-over.

Six fresh pre-cut-over, post-cut-over, and post-build reports preserve both
source files, every full name/status, two passed tests, 12 direct expectation
calls, zero failures/skips/todos/snapshots, and normalized digest
`91fc1cde13d3187d8162b508ce3350cf7c05aae3fe5c0c81fc5613385c74ffe5`.
All 15 possible report pairs pass. An initial PowerShell report invocation
split `--outputFile=` from its path; both runners passed, but those artifacts
were excluded and replaced by correctly assembled fresh reports.

Direct default Vitest, exact Jest rollback, and the authentic root-scoped
default all consume `/4` successfully as 1/1/0/0 with one worker and
`--passWithNoTests`; all 12 commands exit successfully.

Dry ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 39/20/19, 5/5/0, and 63/44/19.

Tax moves exactly once from Jest to Vitest in applicable unit graphs and
remains absent from serial. Integration stays owned once by Jest in fast/all
and absent from slow. Its real PGlite Jest selector passes two files/35 tests
before and after cut-over, while explicit Vitest integration selection rejects
before process spawn both times.

Remaining-Jest ownership stays 68 configs, 107 scripts, and 403 active API
files. Only the exact Jest command's key moves from `test` to `test:jest`;
accepted digest becomes
`84b4fc54e05453714b3aa302a48a4c612b1b9065d9ec37c9f051785965adcfad`.

Both source files, both integration files, Jest/TypeScript/Vitest configs,
PGlite orchestrator, workflow, dependencies, catalogs, lockfile, persistence,
production, privacy/publication, and repository-merge behavior remain
unchanged.

Tax build/default/rollback, frozen offline install across all 86 workspaces,
exact `workspace:*`, strict/noUnchecked tooling, ten contracts, the complete
535.8-second foundation, and the uninterrupted 115.1-second 13-command
Cloudflare Vite/import/D1/workerd set pass. Cloudflare is an independent
production-graph regression, not this Node source suite running in workerd. No
hosted GitHub Actions result is claimed.

## Next Boundary

Turn 104 should add only a separate Tax integration native Vitest shadow.
Freeze its two files, 35 tests, assertions, two Jest-only timeout sites, five
aliases, timeout, three-backend behavior, PGlite routing, and `/3` distribution
before changing runner syntax. Keep Vitest opt-in until that parity is proven.

## Tax Integration Native Vitest Shadow

Commit:

- This commit (`test: shadow Tax integration lane with Vitest`)

Date verified: 2026-08-01.

### Difference From Original Medusa

Tax retains Jest at `test:integration` and adds only the opt-in native command:

```text
test:integration         jest --passWithNoTests --forceExit --testTimeout=30000 --testPathPattern="integration-tests/__tests__/.*\.spec\.ts"
test:integration:vitest  vitest run --config vitest.integration.config.mts
```

The new serial config owns the same two explicit files and five aliases, uses
30-second hook/test timeouts, and sets `legacyJestBridge: false`. The two
`jest.setTimeout(30000)` source calls move to runner configuration. Both test
files now contain zero `jest.*`; all 35 tests, 55 direct expectation sites,
fixtures, assertions, and expected values remain unchanged.

The final-form ownership contract first failed exactly at the old Jest command
without its CLI timeout, then all ten contract tests and strict
`noUncheckedIndexedAccess` tooling passed. The PGlite selector routes explicit
Tax/Vitest requests to the shadow command only; Jest remains authoritative and
unsupported Vitest selection advances fail-closed to Payment.

### Exact Backend, Selector, Shard, And Graph Proof

Nine fresh reports cover pre-edit Jest, post-edit Jest, and post-edit native
Vitest on isolated PostgreSQL 18, PGlite, and Drizzle/SQLite. All 36 report
pairs preserve exactly two files, 35 passed tests, every full name/status, zero
failures/skips/todos, and zero snapshots. Both real PGlite selectors pass
35/35.

Pre/post Jest PostgreSQL `/3` remains 34/1/0 with all commands successful.
Each native Vitest `/3` command exits 1 before collection because three shards
exceed two discovered files. The shadow therefore has no task, workflow,
aggregate, or hosted owner; Turn 105 needs a dedicated unsharded PostgreSQL
owner before cut-over.

Dry ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 39/20/19, 5/5/0, and 63/44/19.

Tax stays owned once by Jest in fast/all integration and absent from slow.
Remaining-Jest ownership changes only by removing the two timeout API sites:
68 configs, 107 scripts, and 401 active API files, with accepted digest
`03652555ffb8f16b9fb5dba556ad6fa972ffdaccba6275c770c0d776c4bb257a`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, Tax
build/default/rollback, both integration runners, strict tooling, the complete
367.0-second foundation, and all 13 Cloudflare Vite/import/D1/workerd gates in
172.8 seconds pass. `test:workerd` reported its existing local D1 migration
cleanup timeout and continued to a successful runtime assertion. Cloudflare is
an independent production-graph regression, not this Node integration suite
running in workerd. No hosted GitHub Actions result is claimed.

No dependency, catalog, override, lockfile, workflow, CI, persistence adapter,
production composition, privacy/publication, or repository-merge behavior
changes.

## Next Boundary

Turn 105 should promote only the proven Tax integration shadow, retain the
exact Jest command at `test:integration:jest`, remove the temporary shadow key,
exclude Tax from generic fast `/3`, and add one runner-neutral unsharded
PostgreSQL workflow owner with aggregate propagation. Do not change assertions,
persistence semantics, dependencies, catalogs, or publication metadata.

## Tax Integration Vitest Default Ownership

Commit:

- This commit (`test: switch Tax integration lane to Vitest`)

Date verified: 2026-08-01.

### Difference From Original Medusa

Tax now owns native/no-bridge Vitest at `test:integration`, preserves the exact
previous Jest command at `test:integration:jest`, and removes the temporary
shadow key. Neither integration source file nor the proven Vitest config
changes; all 35 original Medusa tests and 55 direct expectation sites remain
unchanged.

The PGlite orchestrator now routes Tax's explicit Jest rollback request to
`test:integration:jest` and its Vitest/default request to `test:integration`.
Unsupported Vitest selection remains fail-closed at Payment. Tax is excluded
from generic fast `/3`, whose three shards cannot represent its two files, and
is owned by one dedicated runner-neutral unsharded PostgreSQL workflow job.
The aggregate job propagates Tax failure, cancellation, skip, and success.
Those workflow semantics are locally contract-tested; no hosted run is
claimed.

### Exact Backend, Selector, Shard, And Graph Proof

Six pre-cutover and six post-cutover reports cover default and rollback runners
on isolated PostgreSQL 18, PGlite, and Drizzle/SQLite. All 66 report pairs
preserve exactly two files, 35 passed tests, every full name/status, and zero
failures, skips, todos, or snapshots. Both post-cutover real PGlite selectors
pass 35/35. The exact workflow command,
`pnpm --filter @medusajs/tax test:integration`, passes unsharded against
PostgreSQL with the workflow environment.

Dry ownership is exact:

- all/scoped/general/serial units remain 85/65/20, 1/1/0, 83/63/20, and
  2/2/0;
- fast integration becomes 38/19/19 with Tax absent;
- slow integration remains 5/5/0;
- all integration remains 63/44/19 with Tax present exactly once on Vitest.

Remaining-Jest ownership stays 68 configs, 107 scripts, and 401 active API
files. Only the authoritative and rollback command keys move; accepted digest
becomes
`a9c763420f7f77d4c19d8a3423f78e9185d9663953d8f1aa46127882e1fef4b5`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, Tax
build/default/rollback, both PGlite selectors, strict tooling, ten contracts,
and the complete 359.8-second foundation pass. All 13 independent Cloudflare
Vite/import/D1/workerd gates also pass. The Currency workerd gate required
unchanged cold-start retries after its known local D1 cleanup warning, then
passed in 93.1 seconds; no timeout, runtime, or production source was changed.

No assertion, test source/config, fixture, dependency, catalog, override,
lockfile, persistence semantic, production composition, privacy/publication,
or repository-merge behavior changes.

## Next Boundary

Turn 106 should audit and add only a separate Payment source-unit native
Vitest shadow. Freeze its current files, tests, assertions, Jest-only APIs,
aliases, timeout behavior, build discovery, `/4` distribution, and exact Jest
default before editing. Keep Payment integration Jest-only and fail-closed
until its own shadow and backend-parity turns.

## Payment Source-Unit Native Vitest Shadow

Commit:

- This commit (`test: shadow Payment unit lane with Vitest`)

Date verified: 2026-08-01.

### Difference From Original Medusa

Payment retains both exact Jest defaults and adds only:

```text
test:vitest  vitest run --config vitest.config.mts
```

The source-only config consumes the shared Node Vitest/SWC profile, scopes both
repository discovery globs beneath `src/`, and preserves all five aliases from
the existing Jest config. It does not enable the legacy Jest bridge. Neither
source test changes: the suffixed static-manifest specification and unsuffixed
`get-smallest-unit.ts` test already use runner-shared
`describe`/`it`/`expect` syntax, with two files, three tests, 20 direct
expectation calls, zero Jest-only APIs, and zero snapshots.

Payment integration remains a separate Jest-only boundary. Its exact command,
two files, 36 tests, assertions, and persistence behavior remain unchanged. No
Vitest integration command or config is added.

### Exact Shadow Proof

The final-form ownership contract first failed exactly at the absent
`test:vitest` command, then all ten contract tests passed after the package
script, config, and single strict tooling token were added. Strict
`noUncheckedIndexedAccess` tooling also passes without a suppression or weak
assertion.

Five fresh pre/post/post-build Jest and Vitest reports preserve both exact
source files, every full name/status, three passed tests, zero
failures/skips/todos/snapshots, and normalized digest
`c6e366aa9379fd5e02aef08add09a1f2aee430fa8b731b55203d501e5ca87c72`.
All ten possible report pairs pass.

Direct Jest, direct Vitest shadow, and the authentic root-scoped Jest command
all consume `/4` successfully with one worker and `--passWithNoTests`; all 12
valid commands exit successfully. Each runner owns one file on shards 1 and 2
and none on shards 3 and 4. Jest distributes tests as 1/2/0/0 and Vitest as
2/1/0/0 because their deterministic file ordering differs; both aggregates
remain exactly two files and three tests. One obsolete single-separator root
probe reproduced the already-documented pnpm/Turbo `unexpected argument
'--shard'` rejection and was excluded before the correct double-separator
commands passed.

The shadow has no task-graph, workflow, aggregate, or hosted owner. Dry
ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 38/19/19, 5/5/0, and 63/44/19.

Payment remains owned once by Jest in applicable unit and integration graphs
and absent from serial/slow. Its real PGlite Jest selector passes two files/36
tests. Explicit Payment/Vitest integration selection rejects before process
spawn with the exact unsupported-runner message before and after the shadow.

Remaining-Jest ownership is byte-identical at 68 configs, 107 scripts, and
401 active API files, with accepted digest
`a9c763420f7f77d4c19d8a3423f78e9185d9663953d8f1aa46127882e1fef4b5`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, Payment
build/runners, strict tooling, ten contracts, the complete 494.7-second
foundation, and the uninterrupted 234.7-second 13-command Cloudflare
Vite/import/D1/workerd set pass. The first full foundation attempt failed one
existing PGlite adapter test at its unchanged five-second limit after 5.846
seconds; the unchanged focused integration foundation passed in 345.4 seconds
and the next complete run passed. No timeout or source was changed to mask it.

No test source, integration script, Jest config, dependency, catalog, override,
lockfile, workflow, CI, persistence semantic, production composition,
privacy/publication, or repository-merge behavior changes.

## Next Boundary

Turn 107 should promote only the proven Payment source shadow to `test`, retain
the exact Jest source command at `test:jest`, and remove the temporary
`test:vitest` key. Keep Payment integration Jest-only and fail-closed. Do not
combine integration, dependency, catalog, workflow, CI, or publication work.

## Payment Source-Unit Vitest Default Ownership

Commit:

- This commit (`test: switch Payment unit lane to Vitest`)

Date verified: 2026-08-01.

### Difference From Original Medusa

Payment now maps `test` to the proven native/no-bridge Vitest config, retains
the exact previous Jest source command at `test:jest`, and removes the
temporary `test:vitest` key. Neither source test nor the Vitest config changes:
both files already use runner-shared `describe`/`it`/`expect` syntax and retain
three tests, 20 direct expectation sites, zero Jest-only APIs, and zero
snapshots.

The separate `test:integration` command remains byte-for-byte Jest-owned. No
Vitest integration config, adapter route, task, workflow, or hosted owner is
added in this source-unit cut-over.

### Exact Cut-Over Proof

The final-form ownership contract first failed exactly because `test` still
held Jest. After the three-key manifest cut-over, all ten contract tests and
strict `noUncheckedIndexedAccess` tooling passed.

Six fresh pre/post/post-build default and rollback reports preserve both exact
source files, every full name/status, three passed tests, zero
failures/skips/todos/snapshots, and normalized digest
`c6e366aa9379fd5e02aef08add09a1f2aee430fa8b731b55203d501e5ca87c72`.
All 15 possible report pairs pass. The package build leaves both runners'
discovery and results unchanged.

Direct default Vitest, direct Jest rollback, and authentic root-scoped default
Vitest `/4` commands all pass with one worker and `--passWithNoTests`; all 12
valid commands exit successfully. Each aggregate owns one file on shards 1
and 2 and none on shards 3 and 4. Vitest distributes tests as 2/1/0/0 and Jest
as 1/2/0/0 because their deterministic file ordering differs; every aggregate
remains exactly two files and three tests.

Dry ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 38/19/19, 5/5/0, and 63/44/19.

Payment moves exactly once from Jest to Vitest in applicable unit graphs and
remains absent from serial. Integration remains owned once by Jest in the
applicable graphs. Its real PGlite/Jest selector passes two files and 36 tests;
explicit Payment/Vitest selection still rejects before process spawn with the
unsupported-runner contract.

Remaining-Jest ownership stays 68 configs, 107 scripts, and 401 active API
files. Only the exact source command's manifest key moves from `test` to
`test:jest`; accepted digest becomes
`cd2aa0861138adb0030597725f2a6d5a915d12514692fb78cac664d23bd7f3cb`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, Payment
build/default/rollback, strict tooling, ten contracts, and the complete
448.3-second foundation pass. The first aggregate attempt timed out the
existing lifecycle contract's unchanged five-second hook; the exact focused
contract passed 2/2 unchanged and the next complete aggregate passed. All 13
independent Cloudflare Vite/import/D1/workerd gates pass in 198.7 seconds. No
timeout or runtime source was changed.

No test source/config, integration script/source/config, dependency, catalog,
override, lockfile, workflow, CI, persistence semantic, production
composition, privacy/publication, or repository-merge behavior changes.

## Next Boundary

Turn 108 should audit and add only a separate Payment integration native
Vitest shadow while Jest remains authoritative. Freeze its exact two files,
36 tests, assertion and Jest-API surface, aliases, timeout ownership, backend
behavior, and sharding before editing. Do not combine the shadow with default
cut-over, workflow, dependency, catalog, persistence, or publication work.

## Payment Integration Native Vitest Shadow

Commit:

- This commit (`test: shadow Payment integration lane with Vitest`)

Date verified: 2026-08-02.

### Difference From Original Medusa

Payment retains Jest at `test:integration` and adds only the opt-in
`test:integration:vitest` command. The exact Jest file scope and force-exit
behavior remain; its 30-second timeout moves from two source-level
`jest.setTimeout` calls to the Jest CLI. The new native/no-bridge Vitest config
owns the same 30-second test/hook timeout, serial execution, both exact
integration files, and the five existing aliases.

The integration source now uses imported Vitest `vi` syntax for one
`clearAllMocks` and ten `spyOn` operations and contains zero direct `jest.*`.
The unchanged Jest default resolves only the `vitest` import to a package-local
two-operation shim backed by Jest. No test body, assertion, expected value,
fixture, or snapshot changes. The authoritative suite remains two files, 36
tests, 56 direct expectation sites, and zero snapshots.

### Exact Shadow Proof

The final-form ownership contract first failed exactly because the Jest command
did not yet own the moved timeout. After implementation, strict
`noUncheckedIndexedAccess` tooling and all ten ownership contracts pass. The
config, source, shim, Jest config, selector, verifier, and normalized-suite
hashes are frozen by that contract.

Nine fresh PostgreSQL/PGlite/Drizzle reports and all 36 possible pairs preserve
both files, every full name/status, 36 passed tests, zero
failures/skips/todos/snapshots, and normalized digest
`c9765002192f9fd799236738fe6cd8564599a6144599b7486606b372f0565c55`.
Both real PGlite selectors pass 36/36. Notification becomes the next
fail-closed Vitest lane and rejects before process spawn.

Jest `/3` remains 31/5/0 before and after, with all three pre/post shard pairs
exact. Every authentic native Vitest `/3` command rejects before importing a
test because three shards exceed two discovered files. Therefore the shadow
has no generic graph, workflow, aggregate, or hosted owner. Dry ownership stays
exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 38/19/19, 5/5/0, and 63/44/19.

Payment remains owned once by Jest in applicable integration graphs. The
remaining-Jest inventory accepts the moved timeout and native API surface at 68
configs, 107 scripts, and 399 active API files, with digest
`af1bb8fe1f293c7c8fa04c84d0053c2dca856405b04675bd4eb2f8aba6278dcd`.

The isolated PostgreSQL 18 proof created only
`medusa-payment-integration-1` and
`medusa-payment-integration-vitest-1`, observed zero other database clients,
then stopped with port 55451 closed. Frozen offline install across all 86
workspaces, exact `workspace:*`, Payment build/unit default/unit rollback, both
integration runners, strict tooling, ten contracts, and the complete
418.2-second foundation pass. Two earlier resource-sensitive aggregate attempts
were recovered by unchanged focused passes and the final full rerun; no timeout
or source workaround was added.

All 13 independent Cloudflare Vite/import/D1/workerd gates also pass. The
Currency workerd gate initially exhausted its unchanged local cold-start wait,
then passed unchanged in 65.1 seconds with Vite 8.2.0 ready in 27.4 seconds;
Index SQLite/D1 and Cart Durable Object SQLite then passed in 12.9 and 12.2
seconds. No Cloudflare timeout, runtime, or production source changed.

No dependency, catalog, override, lockfile, workflow, CI, persistence semantic,
production composition, privacy/publication, or repository-merge behavior
changes. No hosted result is claimed.

## Next Boundary

Turn 109 should promote only the proven Payment integration shadow to
`test:integration`, retain the exact Jest command at `test:integration:jest`,
remove `test:integration:vitest`, and add one dedicated runner-neutral,
unsharded PostgreSQL workflow owner because native Vitest cannot consume `/3`.
Audit the workflow and aggregate contract before editing; do not combine
dependencies, catalogs, persistence, publication, or repository-merge work.

## Payment Integration Vitest Default Ownership

Commit:

- This commit (`test: switch Payment integration lane to Vitest`)

Date verified: 2026-08-02.

### Difference From Original Medusa

Payment now maps `test:integration` to the proven native/no-bridge Vitest
config, retains the exact prior Jest command at `test:integration:jest`, and
removes the temporary `test:integration:vitest` key. Neither integration source
file, runner config, Jest shim, Jest config, fixture, test body, assertion, nor
expected value changes. The suite remains two files, 36 tests, 56 direct
expectation sites, 11 imported `vi` operations, zero direct `jest.*`, and zero
snapshots.

Because native Vitest rejects `/3` when only two files exist, Payment leaves the
generic fast integration graph and gains one runner-neutral, unsharded
PostgreSQL workflow job. The package aggregate now propagates that job's
failure, cancellation, skip, and success states. The job name and command do not
couple CI to a runner, so future rollback remains a package-script decision.

### Exact Cut-Over Proof

The final-form ownership contract first failed exactly because Payment still
belonged to the generic fast graph. After the package key swap, PGlite routing,
fast exclusion, workflow job, and aggregate propagation landed, strict
`noUncheckedIndexedAccess` tooling and all ten contracts pass.

Six preserved shadow reports plus six fresh cut-over reports produce all 66
possible exact comparisons across isolated PostgreSQL 18, PGlite, and
Drizzle/SQLite. Every pair preserves both files, every full name/status, 36
passed tests, zero failures/skips/todos/snapshots, and normalized digest
`c9765002192f9fd799236738fe6cd8564599a6144599b7486606b372f0565c55`.
Both post-cut-over PGlite selectors pass 36/36: default selection uses
`test:integration` and rollback uses `test:integration:jest`. Notification
remains the next fail-closed Vitest lane.

The exact runner-neutral workflow command passes 36/36 unsharded on PostgreSQL.
All three authentic native Vitest `/3` package commands reject before test
import because three shards exceed two files. Dry ownership is exact:

- all/scoped/general/serial units remain 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast integration becomes 37/18/19 with Payment absent;
- slow remains 5/5/0;
- all remains 63/44/19 with Payment owned exactly once by Vitest.

The isolated PostgreSQL cluster contained only
`medusa-payment-integration-1`,
`medusa-payment-integration-vitest-1`, and `postgres`, observed zero other
client backends, then stopped with port 55451 closed.

Remaining-Jest ownership moves only the byte-identical Payment command from
`test:integration` to `test:integration:jest` and updates the already-owned
PGlite orchestrator digest. Counts remain 68 configs, 107 scripts, and 399 API
files; accepted digest becomes
`13a0869985874f31dd42581cf592dd264e0f226a2779262a7e023a9a9f57f305`.

Frozen offline install across all 86 workspaces, exact `workspace:*`, Payment
build/unit default/unit rollback, both integration selectors, strict tooling,
ten contracts, and the complete 463.3-second foundation pass. All 13
independent Cloudflare Vite/import/D1/workerd gates pass in 191.8 seconds;
Currency workerd starts Vite 8.2.0 in 20.3 seconds. No timeout, runtime, or
production source changes.

No dependency, catalog, override, lockfile, test source/config, persistence
semantic, production composition, privacy/publication, or repository-merge
behavior changes. The workflow is locally schema/contract tested; no hosted
GitHub Actions result is claimed.

## Next Boundary

Turn 110 should audit and add only a separate Notification source-unit native
Vitest shadow while Jest remains authoritative. Freeze its exact source files,
test/assertion/Jest-API surface, aliases, timeouts, build discovery, and shard
behavior before editing. Keep Notification integration Jest-only and
fail-closed until its separate migration turns.

## Notification Source-Unit Native Vitest Shadow

Commit:

- This commit (`test: shadow Notification unit lane with Vitest`)

Date verified: 2026-08-20.

### Difference From Original Medusa

Notification retains both exact Jest defaults and adds only:

```text
test:vitest  vitest run --config vitest.config.mts
```

The source-only config consumes the shared Node Vitest/SWC profile, scopes both
repository discovery globs beneath `src/`, and preserves all five aliases from
the existing Jest config. It does not enable the legacy Jest bridge. The source
test does not change: `static-manifest.spec.ts` already uses runner-shared
`describe`/`it`/`expect` syntax, with one file, one test, nine direct
expectation calls, zero Jest-only APIs, and zero snapshots.

Notification integration remains a separate Jest-only boundary. Its exact
command, two files, 11 tests, assertions, and persistence behavior remain
unchanged. No Vitest integration command or config is added.

### Exact Shadow Proof

The final-form ownership contract asserts the shadow command, the single
strict tooling token, source/config hashes, and zero `jest.*` APIs; all ten
contract tests and strict `noUncheckedIndexedAccess` tooling pass without a
suppression or weak assertion.

Five fresh pre/post/post-build Jest and Vitest reports preserve the exact
source file, every full name/status, one passed test, zero
failures/skips/todos/snapshots, and normalized digest
`a2a70662b003f4f7c15f70105721c4e39dc420f8cd9fd523112120a3e2e40f11`.
All ten possible report pairs pass.

Direct Jest, direct Vitest shadow, and the authentic root-scoped Jest command
all consume `/4` successfully with one worker and `--passWithNoTests`; all 12
valid commands exit successfully. Each runner owns the file on shard 1 and
none on shards 2, 3, and 4. Both aggregates remain exactly one file and one
test.

The shadow has no task-graph, workflow, aggregate, or hosted owner. Dry
ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 37/18/19, 5/5/0, and 63/44/19.

Notification remains owned once by Jest in applicable unit and integration
graphs and absent from serial/slow. Its real PGlite Jest selector passes two
files/11 tests. Explicit Notification/Vitest integration selection rejects
before process spawn with the exact unsupported-runner message.

Remaining-Jest ownership is byte-identical at 68 configs, 107 scripts, and
399 active API files, with accepted digest
`13a0869985874f31dd42581cf592dd264e0f226a2779262a7e023a9a9f57f305`.

Frozen offline install across all 86 workspaces, exact `workspace:*`,
Notification build/runners, strict tooling, ten contracts, the complete
294.7-second foundation, and the uninterrupted 236.4-second 13-command
Cloudflare Vite/import/D1/workerd set pass. `test:workerd` reported its
existing local D1 migration cleanup timeout, then started Vite 8.2.0 in 15.1
seconds and passed. No timeout or source was changed to mask it.

No test source, integration script, Jest config, dependency, catalog, override,
lockfile, workflow, CI, persistence semantic, production composition,
privacy/publication, or repository-merge behavior changes.

## Next Boundary

Turn 111 should promote only the proven Notification source shadow to `test`,
retain the exact Jest source command at `test:jest`, and remove the temporary
`test:vitest` key. Keep Notification integration Jest-only and fail-closed. Do
not combine integration, dependency, catalog, workflow, CI, or publication
work.

## Notification Source-Unit Vitest Default Ownership

Commit:

- This commit (`test: switch Notification unit lane to Vitest`)

Date verified: 2026-08-20.

### Difference From Original Medusa

Notification now maps `test` to the proven native/no-bridge Vitest config,
retains the exact previous Jest source command at `test:jest`, and removes the
temporary `test:vitest` key. Neither the source test nor the Vitest config
changes: the file already uses runner-shared `describe`/`it`/`expect` syntax
and retains one test, nine direct expectation sites, zero Jest-only APIs, and
zero snapshots.

The separate `test:integration` command remains byte-for-byte Jest-owned. No
Vitest integration config, adapter route, task, workflow, or hosted owner is
added in this source-unit cut-over.

### Exact Cut-Over Proof

The final-form ownership contract asserts the new Vitest default, the exact
Jest rollback key, and the absent shadow key; all ten contract tests and
strict `noUncheckedIndexedAccess` tooling pass.

Six fresh pre/post/post-build default and rollback reports preserve the exact
source file, every full name/status, one passed test, zero
failures/skips/todos/snapshots, and normalized digest
`a2a70662b003f4f7c15f70105721c4e39dc420f8cd9fd523112120a3e2e40f11`.
All 15 possible report pairs pass. The package build leaves both runners'
discovery and results unchanged.

Direct default Vitest, exact Jest rollback, and authentic root-scoped default
Vitest `/4` commands all pass with one worker and `--passWithNoTests`; all 12
valid commands exit successfully. Each aggregate owns the file on shard 1 and
none on shards 2, 3, and 4.

Dry ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 37/18/19, 5/5/0, and 63/44/19.

Notification moves exactly once from Jest to Vitest in applicable unit graphs
and remains absent from serial. Integration remains owned once by Jest in the
applicable graphs. Its real PGlite/Jest selector passes two files and 11 tests;
explicit Notification/Vitest selection still rejects before process spawn with
the unsupported-runner contract.

Remaining-Jest ownership stays 68 configs, 107 scripts, and 399 active API
files. Only the exact source command's manifest key moves from `test` to
`test:jest`; accepted digest becomes
`0a81055c74fdd8dca9b8fd62da28fbb9a93b5bf1490dd5ae9d16d4b747b23fbe`.

Frozen offline install across all 86 workspaces, exact `workspace:*`,
Notification build/default/rollback, strict tooling, ten contracts, the
complete 261.1-second foundation, and the uninterrupted 234.7-second
13-command Cloudflare Vite/import/D1/workerd set pass. `test:workerd` reported
its existing local D1 migration cleanup timeout, then started Vite 8.2.0 in
12.3 seconds and passed. No timeout or source was changed to mask it.

No test source/config, integration script/source/config, dependency, catalog,
override, lockfile, workflow, CI, persistence semantic, production
composition, privacy/publication, or repository-merge behavior changes.

## Next Boundary

Turn 112 should audit and add only a separate Notification integration native
Vitest shadow while Jest remains authoritative. Freeze its exact two files, 11
tests, assertions, Jest-only APIs, aliases, timeout behavior, three-backend
behavior, and `/3` distribution before editing. Keep Vitest opt-in until that
parity is proven.

## Notification Integration Native Vitest Shadow

Commit:

- This commit (`test: shadow Notification integration lane with Vitest`)

Date verified: 2026-08-20.

### Difference From Original Medusa

Notification retains Jest at `test:integration` and adds only the opt-in
`test:integration:vitest` command. The exact Jest file scope and force-exit
behavior remain; its 30-second timeout moves from two source-level
`jest.setTimeout` calls to the Jest CLI. The new native/no-bridge Vitest config
owns the same 30-second test/hook timeout, serial execution, both exact
integration files, and the five existing aliases.

The integration source now uses imported Vitest `vi` syntax for four `spyOn`
operations and contains zero direct `jest.*`. The unchanged Jest default
resolves only the `vitest` import to a package-local one-operation shim backed
by Jest. The first Vitest probe proved that Medusa's built CommonJS provider
loader cannot resolve the original path-loaded TypeScript fixture, so
Notification follows Auth/Analytics/File: the provider fixture is checked
CommonJS JavaScript and the runtime path names `.js` explicitly. No assertion,
expected value, or snapshot changes. The authoritative suite remains two files,
11 tests, 32 direct expectation sites, and zero snapshots.

### Exact Shadow Proof

After implementation, strict `noUncheckedIndexedAccess` tooling and all ten
ownership contracts pass. The config, source, shim, provider fixture, Jest
config, selector, verifier, and normalized-suite hashes are frozen by that
contract.

Six fresh PostgreSQL/PGlite/Drizzle reports and all 15 pairwise comparisons
preserve both files, every full name/status, 11 passed tests, zero
failures/skips/todos/snapshots, and normalized digest
`5a1c4c7e9f47db69569e29c5153ea1996db1d51d5e4f9b5c2f487cd34fe0dd7c`.
Both real PGlite selectors pass 11/11. Fulfillment becomes the next fail-closed
Vitest lane and rejects before process spawn.

Jest `/3` is 7/4/0. Every authentic native Vitest `/3` command rejects before
importing a test because three shards exceed two discovered files. Therefore
the shadow has no generic graph, workflow, aggregate, or hosted owner. Dry
ownership stays exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 37/18/19, 5/5/0, and 63/44/19.

Notification remains owned once by Jest in applicable integration graphs. The
remaining-Jest inventory accepts the moved timeout, native API surface, and
checked CommonJS fixture at 68 configs, 107 scripts, and 397 active API files,
with digest
`8164c5c8793434d911cf781f65da8eaaa0ff5f1067d62de5286d1f8944f8cecc`.

The isolated PostgreSQL 18 proof created only
`medusa-notification-integration-1` and
`medusa-notification-integration-vitest-1`, observed zero other database
clients, then stopped with port 55451 closed. Frozen offline install across all
86 workspaces, exact `workspace:*`, Notification build/unit default/unit
rollback, both integration runners, strict tooling, ten contracts, and the
complete 244.4-second foundation pass.

All 13 independent Cloudflare Vite/import/D1/workerd gates also pass in 140.4
seconds. `test:workerd` started Vite 8.2.0 in 13.1 seconds and passed; no
timeout, runtime, or production source changed.

No dependency, catalog, override, lockfile, workflow, CI, persistence semantic,
production composition, privacy/publication, or repository-merge behavior
changes. No hosted result is claimed.

## Next Boundary

Turn 113 should promote only the proven Notification integration shadow to
`test:integration`, retain the exact Jest command at `test:integration:jest`,
remove `test:integration:vitest`, and add one dedicated runner-neutral,
unsharded PostgreSQL workflow owner because native Vitest cannot consume `/3`.
Audit the workflow and aggregate contract before editing; do not combine
dependencies, catalogs, persistence, publication, or repository-merge work.

## Notification Integration Vitest Default Ownership

Commit:

- This commit (`test: switch Notification integration lane to Vitest`)

Date verified: 2026-08-20.

### Difference From Original Medusa

Notification now maps `test:integration` to the proven native/no-bridge Vitest
config, retains the exact prior Jest command at `test:integration:jest`, and
removes the temporary `test:integration:vitest` key. Neither integration source
file, runner config, Jest shim, Jest config, fixture, test body, assertion, nor
expected value changes. The suite remains two files, 11 tests, 32 direct
expectation sites, four imported `vi` operations, zero direct `jest.*`, and
zero snapshots.

Because native Vitest rejects `/3` when only two files exist, Notification
leaves the generic fast integration graph and gains one runner-neutral,
unsharded PostgreSQL workflow job. The package aggregate now propagates that
job's failure, cancellation, skip, and success states. The job name and command
do not couple CI to a runner, so future rollback remains a package-script
decision.

### Exact Cut-Over Proof

The final-form ownership contract asserts the new Vitest default, the exact
Jest rollback key, the absent shadow key, the fast-graph exclusion, the
dedicated PostgreSQL job, and aggregate propagation; all ten contract tests
and strict `noUncheckedIndexedAccess` tooling pass.

Six preserved shadow reports plus six fresh cut-over reports produce all 66
possible exact comparisons across isolated PostgreSQL 18, PGlite, and
Drizzle/SQLite. Every pair preserves both files, every full name/status, 11
passed tests, zero failures/skips/todos/snapshots, and normalized digest
`5a1c4c7e9f47db69569e29c5153ea1996db1d51d5e4f9b5c2f487cd34fe0dd7c`.
Both post-cut-over PGlite selectors pass 11/11: default selection uses
`test:integration` and rollback uses `test:integration:jest`. Fulfillment
remains the next fail-closed Vitest lane.

The exact runner-neutral workflow command passes 11/11 unsharded on PostgreSQL.
Dry ownership is exact:

- all/scoped/general/serial units remain 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast integration becomes 36/17/19 with Notification absent;
- slow remains 5/5/0;
- all remains 63/44/19 with Notification owned exactly once by Vitest.

The isolated PostgreSQL cluster contained only
`medusa-notification-integration-1`,
`medusa-notification-integration-vitest-1`, and `postgres`, observed zero other
client backends, then stopped with port 55451 closed.

Remaining-Jest ownership moves only the byte-identical Notification command
from `test:integration` to `test:integration:jest` and updates the already-owned
PGlite orchestrator digest. Counts remain 68 configs, 107 scripts, and 397 API
files; accepted digest becomes
`a5da8fc9947387b33ac83adce97b0b66472be639caccbf26b81defa70ba48fdd`.

Frozen offline install across all 86 workspaces, exact `workspace:*`,
Notification build/unit default/unit rollback, both integration selectors,
strict tooling, ten contracts, and the complete 251.3-second foundation pass.
All 13 independent Cloudflare Vite/import/D1/workerd gates pass in 100.2
seconds; Currency workerd starts Vite 8.2.0 in 13.5 seconds. No timeout,
runtime, or production source changes.

No dependency, catalog, override, lockfile, test source/config, persistence
semantic, production composition, privacy/publication, or repository-merge
behavior changes. The workflow is locally schema/contract tested; no hosted
GitHub Actions result is claimed.

## Next Boundary

Turn 114 should audit and add only a separate Fulfillment source-unit native
Vitest shadow while Jest remains authoritative. Freeze its exact source files,
test/assertion/Jest-API surface, aliases, timeouts, build discovery, and shard
behavior before editing. Keep Fulfillment integration Jest-only and
fail-closed until its separate migration turns.

## Fulfillment Source-Unit Native Vitest Shadow

Commit:

- This commit (`test: shadow Fulfillment unit lane with Vitest`)

Date verified: 2026-08-20.

### Difference From Original Medusa

Fulfillment retains both exact Jest defaults and adds only:

- `test:vitest` mapped to a native/no-bridge Vitest config that reuses the five
  existing aliases and discovers only `src/` tests;
- one persistent strict typecheck token for that config.

Neither source file uses Jest-only APIs. The suite remains two files, 23 tests,
33 direct expectation sites, and zero snapshots. The separate
`test:integration` command remains byte-for-byte Jest-owned. No Vitest
integration config, adapter route, task, workflow, or hosted owner is added.

### Exact Shadow Proof

After implementation, strict `noUncheckedIndexedAccess` tooling and all ten
ownership contracts pass. The config, source, Jest config, and tsconfig hashes
are frozen by that contract.

Five fresh pre/post/post-build Jest and Vitest reports preserve both files,
every full name/status, 23 passed tests, zero failures/skips/todos/snapshots,
and normalized digest
`2942500312a6eb86a6174e41caf2e9c34f107f3a9aff56162696df14d62991b8`.
All 10 possible report pairs pass. The package build leaves both runners'
discovery and results unchanged.

Direct Jest, direct Vitest, and authentic root-scoped Jest `/4` commands all
pass with `--passWithNoTests`; shard 1 owns 22 tests, shard 2 owns one test,
and shards 3 and 4 are empty. Direct Vitest `/4` via `exec` matches that
22/1/0/0 split.

Dry ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 36/17/19, 5/5/0, and 63/44/19.

Fulfillment remains owned once by Jest in applicable unit and integration
graphs. Its real PGlite/Jest selector passes seven files and 75 tests; explicit
Fulfillment/Vitest integration selection still rejects before process spawn
with the unsupported-runner contract.

Remaining-Jest ownership stays 68 configs, 107 scripts, and 397 active API
files with unchanged digest
`a5da8fc9947387b33ac83adce97b0b66472be639caccbf26b81defa70ba48fdd`.

Frozen offline install across all 86 workspaces, exact `workspace:*`,
Fulfillment build/runners, strict tooling, ten contracts, the complete
253.9-second foundation, and the uninterrupted 178.1-second 13-command
Cloudflare Vite/import/D1/workerd set pass. `test:workerd` started Vite 8.2.0
in 14.1 seconds and passed. No timeout or source was changed to mask it.

No test source, integration script, Jest config, dependency, catalog, override,
lockfile, workflow, CI, persistence semantic, production composition,
privacy/publication, or repository-merge behavior changes.

## Next Boundary

Turn 115 should promote only the proven Fulfillment source shadow to `test`,
retain the exact Jest source command at `test:jest`, and remove the temporary
`test:vitest` key. Keep Fulfillment integration Jest-only and fail-closed. Do
not combine integration, dependency, catalog, workflow, CI, or publication
work.

## Fulfillment Source-Unit Vitest Default Ownership

Commit:

- This commit (`test: switch Fulfillment unit lane to Vitest`)

Date verified: 2026-08-20.

### Difference From Original Medusa

Fulfillment now maps `test` to the proven native/no-bridge Vitest config,
retains the exact previous Jest source command at `test:jest`, and removes the
temporary `test:vitest` key. Neither source file nor the Vitest config
changes: both files already use runner-shared `describe`/`it`/`expect` syntax
and retain two files, 23 tests, 33 direct expectation sites, zero Jest-only
APIs, and zero snapshots.

The separate `test:integration` command remains byte-for-byte Jest-owned. No
Vitest integration config, adapter route, task, workflow, or hosted owner is
added in this source-unit cut-over.

### Exact Cut-Over Proof

The final-form ownership contract asserts the new Vitest default, the exact
Jest rollback key, and the absent shadow key; all ten contract tests and
strict `noUncheckedIndexedAccess` tooling pass.

Six fresh pre/post/post-build default and rollback reports preserve both
source files, every full name/status, 23 passed tests, zero
failures/skips/todos/snapshots, and normalized digest
`2942500312a6eb86a6174e41caf2e9c34f107f3a9aff56162696df14d62991b8`.
All 15 possible report pairs pass. The package build leaves both runners'
discovery and results unchanged.

Direct default Vitest, exact Jest rollback, and authentic root-scoped default
Vitest `/4` commands all pass with `--passWithNoTests`; shard 1 owns 22 tests,
shard 2 owns one test, and shards 3 and 4 are empty.

Dry ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 36/17/19, 5/5/0, and 63/44/19.

Fulfillment moves exactly once from Jest to Vitest in applicable unit graphs
and remains absent from serial. Integration remains owned once by Jest in the
applicable graphs. Its real PGlite/Jest selector passes seven files and 75
tests; explicit Fulfillment/Vitest selection still rejects before process
spawn with the unsupported-runner contract.

Remaining-Jest ownership stays 68 configs, 107 scripts, and 397 active API
files. Only the exact source command's manifest key moves from `test` to
`test:jest`; accepted digest becomes
`aa4ff263bd2bfeb7b236ffd955d60accf4b9df2f19965b3a91de3158fbdfe9be`.

Frozen offline install across all 86 workspaces, exact `workspace:*`,
Fulfillment build/default/rollback, strict tooling, ten contracts, the
complete 271.2-second foundation, and the uninterrupted 107.6-second
13-command Cloudflare Vite/import/D1/workerd set pass. `test:workerd` started
Vite 8.2.0 in 15.0 seconds and passed. No timeout or source was changed to
mask it.

No test source/config, integration script/source/config, dependency, catalog,
override, lockfile, workflow, CI, persistence semantic, production
composition, privacy/publication, or repository-merge behavior changes.

## Next Boundary

Turn 116 should audit and add only a separate Fulfillment integration native
Vitest shadow while Jest remains authoritative. Freeze its exact files, tests,
assertions, Jest-only APIs, aliases, timeout behavior, three-backend behavior,
and `/3` distribution before editing. Keep Vitest opt-in until that parity is
proven.

## Fulfillment Integration Native Vitest Shadow

Commit:

- This commit (`test: shadow Fulfillment integration lane with Vitest`)

Date verified: 2026-08-20.

### Difference From Original Medusa

Fulfillment retains Jest at `test:integration` and adds only the opt-in
`test:integration:vitest` command. The exact Jest file scope and force-exit
behavior remain; its 1_000_000 ms timeout moves from seven source-level
`jest.setTimeout` calls to the Jest CLI. The new native/no-bridge Vitest config
owns the same 1_000_000 ms test/hook timeout, serial execution, all seven
exact integration files, and the five existing aliases.

The integration source now uses imported Vitest `vi` syntax for 28
`clearAllMocks`/`spyOn` operations and contains zero direct `jest.*`. The
unchanged Jest default resolves only the `vitest` import to a package-local
shim backed by Jest. The path-loaded provider fixture follows
Auth/Analytics/File/Notification: checked CommonJS JavaScript with explicit
`.js` resolve paths, retaining the original `Promise<any>` empty-object
returns.

`src/joiner-config.ts` now passes the same 12 DML models the static manifest
already lists. Jest previously discovered those models through Node `require()`
of `.ts` files; Vitest cannot, and would otherwise emit 6 of the 12 asserted
linkable keys. The `Module(...).linkable` assertion is unchanged and still
expects those 12 keys. No other assertion, expected value, or snapshot
changes. The authoritative suite remains seven files, 75 tests, 263 expect()
sites, and zero snapshots.

### Exact Shadow Proof

After implementation, strict `noUncheckedIndexedAccess` tooling and all ten
ownership contracts pass. The config, source, shim, provider fixture, Jest
config, selector, verifier, and normalized-suite hashes are frozen by that
contract. `jobs["fulfillment-integration"]` remains undefined.

Six fresh PostgreSQL/PGlite/Drizzle reports and all 15 pairwise comparisons
preserve all seven files, every full name/status, 75 passed tests, zero
failures/skips/todos/snapshots, and normalized digest
`94275a7ae05b2266121ff33b2587e3e4b5ae1db1f05805bc594c728b5921663d`.
Both real PGlite selectors pass 7/75. Promotion becomes the next fail-closed
Vitest lane and rejects before process spawn.

Authentic Jest `/3` is 17/32/26 and covers all seven files. The shadow has no
generic graph, workflow, aggregate, or hosted owner. Dry ownership stays
exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 36/17/19, 5/5/0, and 63/44/19.

Fulfillment remains owned once by Jest in applicable integration graphs. The
remaining-Jest inventory accepts the moved timeout, native API surface, and
checked CommonJS fixture at 68 configs, 107 scripts, and 390 active API files,
with digest
`218465edf4a10674b69f76e98a088ad655f81c3b415fe6a9c3026afe23f8c340`.

The isolated PostgreSQL 18 proof created only
`medusa-fulfillment-integration-1` and
`medusa-fulfillment-integration-vitest-1`, observed one proof-client backend,
then stopped with port 55451 closed. Frozen offline install across all 86
workspaces, exact `workspace:*`, Fulfillment build/unit default/unit rollback,
both integration runners, strict tooling, ten contracts, and the complete
276.0-second foundation pass.

All 13 independent Cloudflare Vite/import/D1/workerd gates also pass in 194.7
seconds. `test:workerd` started Vite 8.2.0 in 17.1 seconds and passed; no
timeout or runtime workaround was added.

No dependency, catalog, override, lockfile, workflow, CI, persistence semantic,
privacy/publication, or repository-merge behavior changes. No hosted result is
claimed.

## Next Boundary

Turn 117 should promote only the proven Fulfillment integration shadow: map
`test:integration` to native Vitest, retain the exact Jest command at
`test:integration:jest`, and remove `test:integration:vitest`. Keep Promotion
integration Jest-only and fail-closed until its own migration turns.

## Fulfillment Integration Vitest Default Ownership

Commit:

- This commit (`test: switch Fulfillment integration lane to Vitest`)

Date verified: 2026-08-20.

### Difference From Original Medusa

Fulfillment now maps `test:integration` to the proven native/no-bridge Vitest
config, retains the exact prior Jest command at `test:integration:jest`, and
removes the temporary `test:integration:vitest` key. Neither integration
source file, runner config, Jest shim, Jest config, fixture, test body,
assertion, nor expected value changes. The suite remains seven files, 75
tests, 263 expect() sites, 28 imported `vi` operations, zero direct `jest.*`,
and zero snapshots.

Because seven files shard under `/3`, Fulfillment stays in the generic fast
integration graph. No dedicated PostgreSQL workflow job is added.
`jobs["fulfillment-integration"]` remains undefined.

### Exact Cut-Over Proof

The final-form ownership contract asserts the new Vitest default, the exact
Jest rollback key, and the absent shadow key; all ten contract tests and
strict `noUncheckedIndexedAccess` tooling pass.

Six preserved shadow reports plus six fresh cut-over reports produce all 66
possible exact comparisons across isolated PostgreSQL 18, PGlite, and
Drizzle/SQLite. Every pair preserves all seven files, every full name/status,
75 passed tests, zero failures/skips/todos/snapshots, and normalized digest
`94275a7ae05b2266121ff33b2587e3e4b5ae1db1f05805bc594c728b5921663d`.
Both post-cut-over PGlite selectors pass 7/75: default selection uses
`test:integration` and rollback uses `test:integration:jest`. Promotion
remains the next fail-closed Vitest lane.

Authentic default Vitest `/3` is 53/11/11 and exact Jest rollback `/3` remains
17/32/26; both aggregates cover all 75 tests once. Dry ownership is exact:

- all/scoped/general/serial units remain 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration remain 36/17/19, 5/5/0, and 63/44/19.

The isolated PostgreSQL cluster contained only
`medusa-fulfillment-integration-1`,
`medusa-fulfillment-integration-vitest-1`, and `postgres`, observed one
proof-client backend, then stopped with port 55451 closed.

Remaining-Jest ownership moves only the byte-identical Fulfillment command
from `test:integration` to `test:integration:jest` and updates the already-owned
PGlite orchestrator digest. Counts remain 68 configs, 107 scripts, and 390 API
files; accepted digest becomes
`6d6f67dd4cdfae93513fd685a6a76a84af90dc0ef42c84db9d6ff61faf394efc`.

Frozen offline install across all 86 workspaces, exact `workspace:*`,
Fulfillment build/unit default/unit rollback, both integration selectors,
strict tooling, ten contracts, and the complete 260.3-second foundation pass.
All 13 independent Cloudflare Vite/import/D1/workerd gates pass in 179.3
seconds; Currency workerd starts Vite 8.2.0 in 13.3 seconds. No timeout,
runtime, or production source changes.

No dependency, catalog, override, lockfile, test source/config, workflow, CI,
persistence semantic, production composition, privacy/publication, or
repository-merge behavior changes. No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 118 should audit and add only a separate Promotion source-unit native
Vitest shadow while Jest remains authoritative. Keep Promotion integration
Jest-only and fail-closed until its own migration turns.

## Promotion Source-Unit Native Vitest Shadow

Commit:

- This commit (`test: shadow Promotion unit lane with Vitest`)

Date verified: 2026-08-20.

### Difference From Original Medusa

Promotion retains both exact Jest defaults and adds only:

- `test:vitest` mapped to a native/no-bridge Vitest config that reuses the five
  existing aliases and discovers only `src/` tests;
- one persistent strict typecheck token for that config.

The one source file uses no Jest-only APIs. The suite remains one file, one
test, 5 direct expectation sites, and zero snapshots. The separate
`test:integration` command remains byte-for-byte Jest-owned. No Vitest
integration config, adapter route, task, workflow, or hosted owner is added.
`jobs["promotion-integration"]` remains undefined.

### Exact Shadow Proof

After implementation, strict `noUncheckedIndexedAccess` tooling and all ten
ownership contracts pass. The config, source, Jest config, and tsconfig hashes
are frozen by that contract.

Five fresh pre/post/post-build Jest and Vitest reports preserve the one file,
every full name/status, one passed test, zero failures/skips/todos/snapshots,
and normalized digest
`4c9ba44eacff934d2fa46947f9c9ababb43f6499f6c494c2195ce95765969a10`.
All 10 possible report pairs pass. The package build leaves both runners'
discovery and results unchanged.

Direct Jest, direct Vitest, and authentic root-scoped Jest `/4` commands all
pass with `--passWithNoTests`; shard 1 owns one test and shards 2-4 are empty.
Direct Vitest `/4` via `exec` matches that 1/0/0/0 split.

Dry ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 36/17/19, 5/5/0, and 63/44/19.

Promotion remains owned once by Jest in applicable unit and integration
graphs. Its real PGlite/Jest selector passes six files and 178 tests; explicit
Promotion/Vitest integration selection still rejects before process spawn
with the unsupported-runner contract.

Remaining-Jest ownership stays 68 configs, 107 scripts, and 390 active API
files with unchanged digest
`6d6f67dd4cdfae93513fd685a6a76a84af90dc0ef42c84db9d6ff61faf394efc`.

Frozen offline install across all 86 workspaces, exact `workspace:*`,
Promotion build/runners, strict tooling, ten contracts, the complete
260.4-second foundation, and the uninterrupted 128.2-second 13-command
Cloudflare Vite/import/D1/workerd set pass. `test:workerd` started Vite 8.2.0
in 13.0 seconds and passed. No timeout or source was changed to mask it.

No test source, integration script, Jest config, dependency, catalog, override,
lockfile, workflow, CI, persistence semantic, production composition,
privacy/publication, or repository-merge behavior changes.

## Next Boundary

Turn 119 should promote only the proven Promotion source shadow to `test`,
retain the exact Jest source command at `test:jest`, and remove the temporary
`test:vitest` key. Keep Promotion integration Jest-only and fail-closed. Do
not combine integration, dependency, catalog, workflow, CI, or publication
work.

## Promotion Source-Unit Vitest Default Ownership

Commit:

- This commit (`test: switch Promotion unit lane to Vitest`)

Date verified: 2026-08-20.

### Difference From Original Medusa

Promotion now maps `test` to the proven native/no-bridge Vitest config,
retains the exact previous Jest source command at `test:jest`, and removes the
temporary `test:vitest` key. The source file and Vitest config do not change:
the one file already uses runner-shared `describe`/`it`/`expect` syntax and
retains one file, one test, 5 direct expectation sites, zero Jest-only APIs,
and zero snapshots.

The separate `test:integration` command remains byte-for-byte Jest-owned. No
Vitest integration config, adapter route, task, workflow, or hosted owner is
added in this source-unit cut-over. `jobs["promotion-integration"]` remains
undefined.

### Exact Cut-Over Proof

The final-form ownership contract asserts the new Vitest default, the exact
Jest rollback key, and the absent shadow key; all ten contract tests and
strict `noUncheckedIndexedAccess` tooling pass.

Six fresh pre/post/post-build default and rollback reports preserve the one
source file, every full name/status, one passed test, zero
failures/skips/todos/snapshots, and normalized digest
`4c9ba44eacff934d2fa46947f9c9ababb43f6499f6c494c2195ce95765969a10`.
All 15 possible report pairs pass. The package build leaves both runners'
discovery and results unchanged.

Direct default Vitest, exact Jest rollback, and authentic root-scoped default
Vitest `/4` commands all pass with `--passWithNoTests`; shard 1 owns one test
and shards 2-4 are empty.

Dry ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 36/17/19, 5/5/0, and 63/44/19.

Promotion moves exactly once from Jest to Vitest in applicable unit graphs
and remains absent from serial. Integration remains owned once by Jest in the
applicable graphs. Its real PGlite/Jest selector passes six files and 178
tests; explicit Promotion/Vitest selection still rejects before process
spawn with the unsupported-runner contract.

Remaining-Jest ownership stays 68 configs, 107 scripts, and 390 active API
files. Only the exact source command's manifest key moves from `test` to
`test:jest`; accepted digest becomes
`e27c8d21896cb74195597ddbf0b3b1e2fb6f7a34ee73e743d3f0e32bf65fae98`.

Frozen offline install across all 86 workspaces, exact `workspace:*`,
Promotion build/default/rollback, strict tooling, ten contracts, the
complete 263.6-second foundation, and the uninterrupted 125.1-second
13-command Cloudflare Vite/import/D1/workerd set pass. `test:workerd` started
Vite 8.2.0 in 12.9 seconds and passed. No timeout or source was changed to
mask it.

No test source/config, integration script/source/config, dependency, catalog,
override, lockfile, workflow, CI, persistence semantic, production
composition, privacy/publication, or repository-merge behavior changes.

## Next Boundary

Turn 120 should audit and add only a separate Promotion integration native
Vitest shadow while Jest remains authoritative. Freeze its exact files, tests,
assertions, Jest-only APIs, aliases, timeout behavior, backend behavior, and
`/3` distribution before editing. Keep Vitest opt-in until that parity is
proven.

## Promotion Integration Native Vitest Shadow

Commit:

- This commit (`test: shadow Promotion integration lane with Vitest`)

Date verified: 2026-08-20.

### Difference From Original Medusa

Promotion retains Jest at `test:integration` and adds only the opt-in
`test:integration:vitest` command. The exact Jest file scope and force-exit
behavior remain; its 30_000 ms timeout moves from five source-level
`jest.setTimeout` calls to the Jest CLI. The new native/no-bridge Vitest config
owns the same 30_000 ms test/hook timeout, serial execution, all six exact
integration files, and the five existing aliases.

The integration source contains zero direct `jest.*` and needs no `vi` shim:
the suite never used `fn`/`spyOn`/`clearAllMocks`. The `evaluate-rule-value-condition`
file already had no Jest-only APIs. No provider fixture or joiner-config
production change is required; `PromotionModuleService` already lists the same
seven DML models the linkable assertion checks.

The authoritative suite remains six files, 178 tests, 239 expect() sites, and
zero snapshots. `jobs["promotion-integration"]` remains undefined.

### Exact Shadow Proof

After implementation, strict `noUncheckedIndexedAccess` tooling and all ten
ownership contracts pass. The config, source, Jest config, selector, verifier,
and normalized-suite hashes are frozen by that contract.

Six fresh PostgreSQL/PGlite/Drizzle reports and all 15 pairwise comparisons
preserve all six files, every full name/status, 178 passed tests, zero
failures/skips/todos/snapshots, and normalized digest
`5ded7a0f633a9dd46a06f14c7296ed992a430380d713316c4b1c6f2e9e33ce2f`.
Both real PGlite selectors pass 6/178. Product becomes the next fail-closed
Vitest lane and rejects before process spawn.

Authentic Jest `/3` is 10/61/107 and covers all six files. Direct Vitest `/3`
is 74/15/89. The shadow has no generic graph, workflow, aggregate, or hosted
owner. Dry ownership stays exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 36/17/19, 5/5/0, and 63/44/19.

Promotion remains owned once by Jest in applicable integration graphs. The
remaining-Jest inventory accepts the moved timeout and native API surface at
68 configs, 107 scripts, and 385 active API files, with digest
`296f9841a6037845b7b25cfab5160ce3af35541616151de7423d0ea4ea7be22f`.

The isolated PostgreSQL 18 proof created only
`medusa-promotion-integration-1` and
`medusa-promotion-integration-vitest-1`, observed one proof-client backend,
then stopped with port 55451 closed. Frozen offline install across all 86
workspaces, exact `workspace:*`, Promotion build/unit default/unit rollback,
both integration runners, strict tooling, ten contracts, and the complete
274.2-second foundation pass.

All 13 independent Cloudflare Vite/import/D1/workerd gates also pass in
193.8 seconds. `test:workerd` started Vite 8.2.0 in 14.6 seconds and
passed; no timeout or runtime workaround was added.

No dependency, catalog, override, lockfile, workflow, CI, persistence semantic,
privacy/publication, or repository-merge behavior changes. No hosted result is
claimed.

## Next Boundary

Turn 121 should promote only the proven Promotion integration shadow: map
`test:integration` to native Vitest, retain the exact Jest command at
`test:integration:jest`, and remove `test:integration:vitest`. Keep Product
integration Jest-only and fail-closed until its own migration turns.

## Promotion Integration Vitest Default Ownership

Commit:

- This commit (`test: switch Promotion integration lane to Vitest`)

Date verified: 2026-08-20.

### Difference From Original Medusa

Promotion now maps `test:integration` to the proven native/no-bridge Vitest
config, retains the exact prior Jest command at `test:integration:jest`, and
removes the temporary `test:integration:vitest` key. Neither integration
source file, runner config, Jest config, test body, assertion, nor expected
value changes. The suite remains six files, 178 tests, 239 expect() sites,
zero direct `jest.*`, no `vi` shim, and zero snapshots.

Because six files shard under `/3`, Promotion stays in the generic fast
integration graph. No dedicated PostgreSQL workflow job is added.
`jobs["promotion-integration"]` remains undefined.

### Exact Cut-Over Proof

The final-form ownership contract asserts the new Vitest default, the exact
Jest rollback key, and the absent shadow key; all ten contract tests and
strict `noUncheckedIndexedAccess` tooling pass.

Six preserved shadow reports plus six fresh cut-over reports produce all 66
possible exact comparisons across isolated PostgreSQL 18, PGlite, and
Drizzle/SQLite. Every pair preserves all six files, every full name/status,
178 passed tests, zero failures/skips/todos/snapshots, and normalized digest
`5ded7a0f633a9dd46a06f14c7296ed992a430380d713316c4b1c6f2e9e33ce2f`.
Both post-cut-over PGlite selectors pass 6/178: default selection uses
`test:integration` and rollback uses `test:integration:jest`. Product
remains the next fail-closed Vitest lane.

Authentic default Vitest `/3` is 74/15/89 and exact Jest rollback `/3` remains
10/61/107; both aggregates cover all 178 tests once. Dry ownership is exact:

- all/scoped/general/serial units remain 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration remain 36/17/19, 5/5/0, and 63/44/19.

The isolated PostgreSQL cluster contained only
`medusa-promotion-integration-1`,
`medusa-promotion-integration-vitest-1`, and `postgres`, observed one
proof-client backend, then stopped with port 55451 closed.

Remaining-Jest ownership moves only the byte-identical Promotion command
from `test:integration` to `test:integration:jest` and updates the already-owned
PGlite orchestrator digest. Counts remain 68 configs, 107 scripts, and 385 API
files; accepted digest becomes
`107e8331facafbc61ddcc7220fac6b31f8000c8b6cefeee10d50b1d0c68b8b34`.

Frozen offline install across all 86 workspaces, exact `workspace:*`,
Promotion build/unit default/unit rollback, both integration selectors,
strict tooling, ten contracts, and the complete 262.7-second foundation pass.
All 13 independent Cloudflare Vite/import/D1/workerd gates pass in 135.1
seconds; Currency workerd starts Vite 8.2.0 in 14.4 seconds. No timeout,
runtime, or production source changes.

No dependency, catalog, override, lockfile, test source/config, workflow, CI,
persistence semantic, production composition, privacy/publication, or
repository-merge behavior changes. No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 122 should audit and add only a separate Product source-unit native
Vitest shadow while Jest remains authoritative. Keep Product integration
Jest-only and fail-closed until its own migration turns.

## Product Source-Unit Native Vitest Shadow

Commit:

- This commit (`test: shadow Product unit lane with Vitest`)

Date verified: 2026-08-20.

### Difference From Original Medusa

Product retains both exact Jest defaults and adds only:

- `test:vitest` mapped to a native/no-bridge Vitest config that reuses the five
  existing aliases and discovers only `src/` tests;
- one persistent strict typecheck token for that config.

The two source files use no Jest-only APIs. The suite remains two files, four
tests, 23 direct expectation sites, and zero snapshots. The separate
`test:integration` command remains byte-for-byte Jest-owned. No Vitest
integration config, adapter route, task, workflow, or hosted owner is added.
`jobs["product-integration"]` remains undefined.

### Exact Shadow Proof

After implementation, strict `noUncheckedIndexedAccess` tooling and all ten
ownership contracts pass. The config, source, Jest config, and tsconfig hashes
are frozen by that contract.

Five fresh pre/post/post-build Jest and Vitest reports preserve the two files,
every full name/status, four passed tests, zero failures/skips/todos/snapshots,
and normalized digest
`5405f6cc036555864b376b686a66e2367641eb780a086caeae6558691e241866`.
All 10 possible report pairs pass. The package build leaves both runners'
discovery and results unchanged.

Direct Jest and direct Vitest both pass two files and four tests. Direct Jest
`/4` is 1/3/0/0 and direct Vitest `/4` is 3/1/0/0; both pass with
`--passWithNoTests` and cover all four tests once.

Dry ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 36/17/19, 5/5/0, and 63/44/19.

Product remains owned once by Jest in applicable unit and integration
graphs. Its real PGlite/Jest selector passes ten files with 205 passed tests
and 1 skipped; explicit Product/Vitest integration selection still rejects
before process spawn with the unsupported-runner contract.

Remaining-Jest ownership stays 68 configs, 107 scripts, and 385 active API
files with unchanged digest
`107e8331facafbc61ddcc7220fac6b31f8000c8b6cefeee10d50b1d0c68b8b34`.

Frozen offline install across all 86 workspaces, exact `workspace:*`,
Product build/runners, strict tooling, ten contracts, the complete
262.3-second foundation, and the uninterrupted 94.8-second 13-command
Cloudflare Vite/import/D1/workerd set pass. `test:workerd` started Vite 8.2.0
in 12.1 seconds and passed. No timeout or source was changed to mask it.

No test source, integration script, Jest config, dependency, catalog, override,
lockfile, workflow, CI, persistence semantic, production composition,
privacy/publication, or repository-merge behavior changes.

## Next Boundary

Turn 123 should promote only the proven Product source shadow to `test`,
retain the exact Jest source command at `test:jest`, and remove the temporary
`test:vitest` key. Keep Product integration Jest-only and fail-closed. Do
not combine integration, dependency, catalog, workflow, CI, or publication
work.

## Product Source-Unit Vitest Default Ownership

Commit:

- This commit (`test: switch Product unit lane to Vitest`)

Date verified: 2026-08-20.

### Difference From Original Medusa

Product now maps `test` to the proven native/no-bridge Vitest config,
retains the exact previous Jest source command at `test:jest`, and removes the
temporary `test:vitest` key. The source files and Vitest config do not change:
the two files already use runner-shared `describe`/`it`/`expect` syntax and
retain two files, four tests, 23 direct expectation sites, zero Jest-only APIs,
and zero snapshots.

The separate `test:integration` command remains byte-for-byte Jest-owned. No
Vitest integration config, adapter route, task, workflow, or hosted owner is
added in this source-unit cut-over. `jobs["product-integration"]` remains
undefined.

### Exact Cut-Over Proof

The final-form ownership contract asserts the new Vitest default, the exact
Jest rollback key, and the absent shadow key; all ten contract tests and
strict `noUncheckedIndexedAccess` tooling pass.

Six preserved shadow and fresh cut-over reports preserve the two source files,
every full name/status, four passed tests, zero
failures/skips/todos/snapshots, and normalized digest
`5405f6cc036555864b376b686a66e2367641eb780a086caeae6558691e241866`.
All 15 possible report pairs pass. The package build leaves both runners'
discovery and results unchanged.

Direct default Vitest `/4` is 3/1/0/0 and exact Jest rollback `/4` is 1/3/0/0;
both pass with `--passWithNoTests` and cover all four tests once.

Dry ownership remains exact:

- all/scoped/general/serial units: 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
- fast/slow/all integration: 36/17/19, 5/5/0, and 63/44/19.

Product moves exactly once from Jest to Vitest in applicable unit graphs
and remains absent from serial. Integration remains owned once by Jest in the
applicable graphs. Explicit Product/Vitest integration selection still rejects
before process spawn with the unsupported-runner contract.

Remaining-Jest ownership stays 68 configs, 107 scripts, and 385 active API
files. Only the exact source command's manifest key moves from `test` to
`test:jest`; accepted digest becomes
`7240bf3c54c1784faec7f89567b14142fd792155d40ff6bb8eb71a660dc4b4ea`.

Frozen offline install across all 86 workspaces, exact `workspace:*`,
Product build/default/rollback, strict tooling, ten contracts, the
complete 262.0-second foundation, and the uninterrupted 94.0-second
13-command Cloudflare Vite/import/D1/workerd set pass. `test:workerd` started
Vite 8.2.0 in 12.2 seconds and passed. No timeout or source was changed to
mask it.

No test source/config, integration script/source/config, dependency, catalog,
override, lockfile, workflow, CI, persistence semantic, production
composition, privacy/publication, or repository-merge behavior changes.

## Next Boundary

Turn 124 should audit and add only a separate Product integration native
Vitest shadow while Jest remains authoritative. Freeze its exact files, tests,
assertions, Jest-only APIs, aliases, timeout behavior, backend behavior, and
sharding before editing. Keep Vitest opt-in until that parity is proven.

The Product integration Jest three-backend freeze is unblocked: isolated
PostgreSQL 18, PGlite, and Drizzle/SQLite each pass 10 files / 205 passed /
1 skipped. Do not skip to Pricing.

## Product Integration Native Vitest Shadow

Commit:

- This commit (`test: shadow Product integration lane with Vitest`)

Date verified: 2026-08-22.

### Difference From Original Medusa

Product retains Jest at `test:integration`, whose 30_000 ms timeout moves from
ten source-level `jest.setTimeout` calls to an explicit `--testTimeout=300000`
CLI flag, and adds only the opt-in `test:integration:vitest` command backed by
a native/no-bridge integration config. That config owns the same 300_000 ms
test/hook timeout, serial execution (`fileParallelism: false`,
`maxWorkers: 1`), all ten exact integration files, the five existing aliases,
and `legacyJestBridge: false`.

The ten integration files drop every direct `jest.*` usage (ten
`setTimeout`, eight `clearAllMocks`, one `spyOn`, and one `jest.SpyInstance`
type annotation) in favor of `vi` imported from `vitest`. The Jest rollback
stays available through the narrowest package-local adapter:
`integration-tests/__fixtures__/vitest-jest-shim.ts` re-exports jest's
`clearAllMocks`/`spyOn`, and the package Jest config maps `^vitest$` to it, so
both runners execute byte-identical sources with no global bridge.

The PGlite orchestrator adds `@medusajs/product` to its Vitest lanes through
the opt-in script, and the integration-foundation verifier's fail-closed
unsupported-Vitest example moves from product to pricing.

The authoritative suite remains ten files, 206 tests (205 passed, 1 skipped),
zero snapshots.

### Exact Shadow Proof

Strict tooling typecheck and all ten ownership contracts pass; the config,
shim, spec, selector, verifier, and normalized-suite hashes are frozen by
those contracts.

The shadow was proven on three persistence backends with identical results,
10 files / 205 passed / 1 skipped each time:

- isolated PostgreSQL 18 cluster (trust auth on 127.0.0.1:55599): 267.91s;
- PGlite through `pnpm test:integration:pglite --runner=vitest --only=product`:
  153.45s, with the Jest lane matching at 62.86s;
- Drizzle/SQLite (`MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`): 40.34s.

Gates: strict runner-tooling typecheck, the ten-contract tooling suite,
Jest/Vitest foundation parity (5 files, 8 passed, 1 skipped, 1 todo), the
integration-foundation gate (25 Jest-default lanes and fail-closed unsupported
Vitest selection), and the exact remaining-Jest inventory at 68 configs, 107
scripts, and 375 active API files with digest
`d4c0ede7ceaffeb72256c807ef190d1db24938392380d129623b10ee76d30623`.

Not claimed in this slice: frozen offline install, CI sharding distribution,
Cloudflare Vite/import/D1/workerd gates, and workerd execution were not rerun;
they remain cut-over-turn requirements before `test:integration` may move off
Jest. The package script fails outside the orchestrator environment for both
runners because the lanes depend on injected database configuration; the
orchestrator remains the supported entrypoint. No hosted result is claimed.

## Next Boundary

Turn 125 should prove the remaining shadow gates (frozen install, Cloudflare
gates, sharding) and then promote only this proven Product integration shadow:
map `test:integration` to native Vitest, retain the exact Jest command at
`test:integration:jest`, and remove `test:integration:vitest`. Do not skip to
Pricing.

## Product Integration Vitest Default Ownership

Commit:

- This commit (`test: switch Product integration lane to Vitest`)

Date verified: 2026-08-22.

### Difference From Original Medusa

Product now maps `test:integration` to the proven native/no-bridge Vitest
config, retains the byte-identical prior Jest command at
`test:integration:jest`, and removes the temporary `test:integration:vitest`
key. No integration source file, runner config, Jest config, test body,
assertion, or expected value changes: the suite remains ten files, 205 passed
tests, 1 skipped, zero snapshots, and the package-local `vitest-jest-shim`
fixture mapped by the package Jest config alone keeps the rollback on
byte-identical sources.

Because all ten files distribute under `/3`, Product stays in the generic fast
integration graph. No dedicated workflow job is added;
`jobs["product-integration"]` remains undefined.

### Exact Cut-Over Proof

The final-form ownership contract asserts the new Vitest default, the exact
Jest rollback key, and the absent shadow key; all ten contract tests and
strict tooling typecheck pass.

Both post-cut-over PGlite orchestrator selectors pass ten files / 205 passed /
1 skipped: default selection uses `test:integration` in 59.53s and rollback
uses `test:integration:jest` in 58.22s. Authentic default Vitest `/3` shards
with `--maxWorkers=2` under the orchestrator environment
(`MEDUSA_MODULE_TEST_PERSISTENCE=pglite`, `MEDUSA_PGLITE_TESTS=1`) are
4/3/3 files and 75/(68+1 skipped)/62 tests, covering every test exactly once.
PostgreSQL and Drizzle behavior is carried by the byte-identical Turn 124
shadow reports plus these fresh PGlite reports; no backend-specific source
changed between shadow and default.

The complete foundation passes, and remaining-Jest ownership moves exactly the
product command from `test:integration` to `test:integration:jest` plus the
already-owned PGlite orchestrator digest. Counts remain 68 configs, 107
scripts, and 375 active API files; accepted digest becomes
`f7be351c8de7e2d5241dff938807ed9738a8bfdd10ba9bc739c973255b34371e`.

Frozen offline install across all 86 workspaces passes. The complete
Cloudflare Vite/import/D1/workerd gate set passes uninterrupted in 94 seconds:
build, typecheck, worker spec, portable/runtime-source/real-module import
guards, HTTP proof manifest, D1 migration generate-check and runtime check,
Currency workerd proof, Currency/Cart/Index DO SQLite proofs, and Cart DO
proof. No timeout or source workaround was added.

No dependency, catalog, override, lockfile, test source/config, workflow, CI,
persistence semantic, production composition, privacy/publication, or
repository-merge behavior changes. No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 126 should audit and add only a separate Pricing integration native
Vitest shadow while Jest remains authoritative. Freeze its exact files, tests,
assertions, Jest-only APIs, aliases, timeout behavior, backend behavior, and
sharding before editing. Keep Vitest opt-in until that parity is proven.

## Pricing Integration Native Vitest Shadow

Commit:

- This commit (`test: shadow Pricing integration lane with Vitest`)

Date verified: 2026-08-22.

### Difference From Original Medusa

Pricing retains Jest at `test:integration`, whose 30_000 ms timeout moves from
six source-level `jest.setTimeout` calls (five specs plus the
`seed-price-data` fixture) to an explicit `--testTimeout=30000` CLI flag, and
adds only the opt-in `test:integration:vitest` command backed by a
native/no-bridge integration config. That config owns the same 30_000 ms
test/hook timeout, serial execution (`fileParallelism: false`,
`maxWorkers: 1`), all six exact integration files, the five existing aliases,
and `legacyJestBridge: false`.

The six integration files drop every direct `jest.*` usage (six `setTimeout`,
two `spyOn`, two `clearAllMocks`) in favor of `vi` imported from `vitest`.
The Jest rollback stays available through the narrowest package-local adapter:
`integration-tests/__fixtures__/vitest-jest-shim.ts` re-exports jest's
`clearAllMocks`/`spyOn`, and the package Jest config maps `^vitest$` to it, so
both runners execute byte-identical sources with no global bridge.

The PGlite orchestrator maps `@medusajs/pricing` to the opt-in Vitest script,
and the integration-foundation verifier's fail-closed unsupported-Vitest
example moves from pricing to cart.

The authoritative suite remains six files, 126 passed tests, zero snapshots.
The Pricing unit lane (`jest --bail --forceExit --testPathPattern=src`)
remains untouched Jest-owned.

### Exact Shadow Proof

Strict tooling typecheck and all ten ownership contracts pass; the config,
shim, fixture, spec, selector, verifier, jest-config, and tsconfig hashes are
frozen by those contracts.

The shadow was proven on three persistence backends with identical results,
6 files / 126 passed tests each time:

- isolated PostgreSQL 18 cluster (trust auth on 127.0.0.1:55601): 63.67s;
- PGlite through `pnpm test:integration:pglite --runner=vitest --only=pricing`:
  28.82s, with the Jest lane matching at 27.89s;
- Drizzle/SQLite (`MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`): 17.45s.

Gates: strict runner-tooling typecheck, the ten-contract tooling suite,
Jest/Vitest foundation parity (5 files, 8 passed, 1 skipped, 1 todo), the
integration-foundation gate (25 Jest-default lanes and fail-closed unsupported
Vitest selection at cart), and the exact remaining-Jest inventory at 68
configs, 107 scripts, and 369 active API files with digest
`1bc4aa126bf6482f746756a1cf3f79fa88687c4d68f331347b81b9cc9430065b`.

Not claimed in this slice: frozen offline install, CI sharding distribution,
Cloudflare Vite/import/D1/workerd gates, and workerd execution were not rerun;
they remain cut-over-turn requirements before `test:integration` may move off
Jest. No hosted result is claimed.

## Next Boundary

Turn 127 should prove the remaining shadow gates (frozen install, Cloudflare
gates, sharding) and then promote only this proven Pricing integration shadow:
map `test:integration` to native Vitest, retain the exact Jest command at
`test:integration:jest`, and remove `test:integration:vitest`. Do not skip to
Cart.

## Pricing Integration Vitest Default Ownership

Commit:

- This commit (`test: switch Pricing integration lane to Vitest`)

Date verified: 2026-08-22.

### Difference From Original Medusa

Pricing now maps `test:integration` to the proven native/no-bridge Vitest
config, retains the byte-identical prior Jest command at
`test:integration:jest`, and removes the temporary `test:integration:vitest`
key. No integration source file, runner config, Jest config, fixture, test
body, assertion, or expected value changes: the suite remains six files, 126
passed tests, zero snapshots, and the package-local `vitest-jest-shim`
fixture mapped by the package Jest config alone keeps the rollback on
byte-identical sources.

Because all six files distribute evenly under `/3`, Pricing stays in the
generic fast integration graph. No dedicated workflow job is added;
`jobs["pricing-integration"]` remains undefined.

### Exact Cut-Over Proof

The final-form ownership contract asserts the new Vitest default, the exact
Jest rollback key, and the absent shadow key; all ten contract tests and
strict tooling typecheck pass.

Both post-cut-over PGlite orchestrator selectors pass six files / 126 passed
tests: default selection uses `test:integration` in 35.34s and rollback uses
`test:integration:jest`. Authentic default Vitest `/3` shards with
`--maxWorkers=2` under the orchestrator environment
(`MEDUSA_MODULE_TEST_PERSISTENCE=pglite`, `MEDUSA_PGLITE_TESTS=1`) are
2/2/2 files and 29/27/70 tests, covering every test exactly once. PostgreSQL
and Drizzle behavior is carried by the byte-identical Turn 126 shadow reports
plus these fresh PGlite reports; no backend-specific source changed between
shadow and default.

The complete foundation passes, and remaining-Jest ownership moves exactly the
pricing command from `test:integration` to `test:integration:jest` plus the
already-owned PGlite orchestrator digest. Counts remain 68 configs, 107
scripts, and 369 active API files; accepted digest becomes
`aa2bc5060641031ec27c4e42c4964dcc1cee42fdc729665d5c6d24fa8cc73e15`.

Frozen offline install across all 86 workspaces passes. The complete
Cloudflare Vite/import/D1/workerd gate set passes uninterrupted in 225
seconds: build, typecheck, worker spec, portable/runtime-source/real-module
import guards, HTTP proof manifest, D1 migration generate-check and runtime
check, Currency workerd proof, Currency/Cart/Index DO SQLite proofs, and Cart
DO proof. No timeout or source workaround was added.

No dependency, catalog, override, lockfile, test source/config, workflow, CI,
persistence semantic, production composition, privacy/publication, or
repository-merge behavior changes. No hosted GitHub Actions result is claimed.

## Next Boundary

Turn 128 should audit and add only a separate Cart integration native Vitest
shadow while Jest remains authoritative. Freeze its exact files, tests,
assertions, Jest-only APIs, aliases, timeout behavior, backend behavior, and
sharding before editing. Keep Vitest opt-in until that parity is proven.

## Cart Integration Native Vitest Shadow

Commit:

- This commit (`test: shadow Cart integration lane with Vitest`)

Date verified: 2026-08-22.

### Difference From Original Medusa

Cart retains Jest at `test:integration`, whose 50_000 ms timeout moves from
the single source-level `jest.setTimeout(50000)` call to an explicit
`--testTimeout=50000` CLI flag, and adds only the opt-in
`test:integration:vitest` command backed by a native/no-bridge integration
config. That config owns the same 50_000 ms test/hook timeout, serial
execution (`fileParallelism: false`, `maxWorkers: 1`), the one exact
integration file, the four existing aliases, and `legacyJestBridge: false`.

The integration source drops its only direct `jest.*` usage and needs no
`vi` shim: the suite never used spy, mock, or clear APIs. The package Jest
config stays byte-identical.

The PGlite orchestrator maps `@medusajs/cart` to the opt-in Vitest script,
and the integration-foundation verifier's fail-closed unsupported-Vitest
example moves from cart to order, which becomes the last Jest-owned module
integration lane.

The authoritative suite remains one file, 63 passed tests, zero snapshots.

### Exact Shadow Proof

Strict tooling typecheck and all ten ownership contracts pass; the config,
spec, selector, verifier, jest-config, and tsconfig hashes are frozen by those
contracts.

The shadow was proven on three persistence backends with identical results,
1 file / 63 passed tests each time:

- isolated PostgreSQL 18 cluster (trust auth on 127.0.0.1:55602): 23.49s;
- PGlite through `pnpm test:integration:pglite --runner=vitest --only=cart`,
  with the Jest lane matching;
- Drizzle/SQLite (`MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`): 4.49s.

Gates: strict runner-tooling typecheck, the ten-contract tooling suite,
Jest/Vitest foundation parity, the integration-foundation gate (25
Jest-default lanes and fail-closed unsupported Vitest selection at order), and
the exact remaining-Jest inventory at 68 configs, 107 scripts, and 368 active
API files with digest
`dde6f334244fd62f588262be8cdf857c321b1fab55771fc73c8c215476505863`.

Not claimed in this slice: frozen offline install, CI sharding distribution,
Cloudflare Vite/import/D1/workerd gates, and workerd execution were not rerun;
they remain cut-over-turn requirements before `test:integration` may move off
Jest. No hosted result is claimed.

## Next Boundary

Turn 129 should prove the remaining shadow gates (frozen install, Cloudflare
gates, sharding) and then promote only this proven Cart integration shadow:
map `test:integration` to native Vitest, retain the exact Jest command at
`test:integration:jest`, and remove `test:integration:vitest`. Do not skip to
Order.

## Cart Integration Vitest Default Ownership

Commit:

- This commit (`test: switch Cart integration lane to Vitest`)

Date verified: 2026-08-22.

### Difference From Original Medusa

Cart now maps `test:integration` to the proven native/no-bridge Vitest
config, retains the byte-identical prior Jest command at
`test:integration:jest`, and removes the temporary `test:integration:vitest`
key. No integration source file, runner config, Jest config, fixture, test
body, assertion, or expected value changes: the suite remains one file, 63
passed tests, zero snapshots, and no `vi` shim exists because the suite uses
no spy or mock APIs.

The one-file lane cannot distribute under `/3`: authentic Vitest
`--shard=1/3 --maxWorkers=2` fails closed with "shard must be smaller than
count of test files", matching Currency precedent. Cart also stays outside
the generic fast integration filter as before, so no workflow or CI change is
required and `jobs["cart-integration"]` remains undefined.

### Exact Cut-Over Proof

The final-form ownership contract asserts the new Vitest default, the exact
Jest rollback key, and the absent shadow key; all ten contract tests and
strict tooling typecheck pass.

Both post-cut-over PGlite orchestrator selectors pass one file / 63 passed
tests: default selection uses `test:integration` and rollback uses
`test:integration:jest`. PostgreSQL and Drizzle behavior is carried by the
byte-identical Turn 128 shadow reports plus these fresh PGlite reports; no
backend-specific source changed between shadow and default.

The complete foundation passes, and remaining-Jest ownership moves exactly the
cart command from `test:integration` to `test:integration:jest` plus the
already-owned PGlite orchestrator digest. Counts remain 68 configs, 107
scripts, and 368 active API files; accepted digest becomes
`5469e8948fe323a2d25864874be35c9922e9a0b8891ffb3a977e7a242f554f68`.

Frozen offline install across all 86 workspaces passes. The complete
Cloudflare Vite/import/D1/workerd gate set passes uninterrupted in 137
seconds: build, typecheck, worker spec, portable/runtime-source/real-module
import guards, HTTP proof manifest, D1 migration generate-check and runtime
check, Currency workerd proof, Currency/Cart/Index DO SQLite proofs, and Cart
DO proof. No timeout or source workaround was added.

No dependency, catalog, override, lockfile, test source/config, workflow, CI,
persistence semantic, production composition, privacy/publication, or
repository-merge behavior changes. No hosted GitHub Actions result is claimed.

## Next Boundary

Order is the last Jest-owned module integration lane. The next slice should
audit and add only a separate Order integration native Vitest shadow while
Jest remains authoritative, then promote it in its own turn to complete the
module-integration wave.

## Order Integration Native Vitest Shadow

Commit:

- This commit (`test: shadow Order integration lane with Vitest`)

Date verified: 2026-08-22.

### Difference From Original Medusa

Order retains Jest at `test:integration`, whose timeout moves from eight
source-level `jest.setTimeout` calls (six at 100_000 ms plus two at
1_000_000 ms) to an explicit `--testTimeout=1000000` CLI flag matching the
Fulfillment precedent, and adds only the opt-in `test:integration:vitest`
command backed by a native/no-bridge integration config. That config owns a
1_000_000 ms test/hook timeout, serial execution (`fileParallelism: false`,
`maxWorkers: 1`), all nine exact integration files, the five existing aliases,
and `legacyJestBridge: false`.

The nine integration files drop every direct `jest.*` usage and need no
`vi` shim: the suite never used spy, mock, or clear APIs. The package Jest
config stays byte-identical.

The PGlite orchestrator maps `@medusajs/order` to the opt-in Vitest script.
With Order supported, no module lane remains fail-closed under Vitest
selection: the integration-foundation verifier replaces its unsupported-lane
assertions with positive ones (Order lists under `--runner=vitest --list`, and
all 25 lanes now list).

### Shadow Proof And PostgreSQL Blocker

Strict tooling typecheck, all ten ownership contracts, foundation parity, the
integration-foundation gate, and the exact remaining-Jest inventory pass at 68
configs, 107 scripts, and 360 active API files with digest
`193bd34cd2c203b39ad2230dab44ae4e34533d729ca9b207fec01581f76ef303`.

Runner parity is exact on every persistence backend:

- PGlite: 9 files / 77 passed for both runners;
- Drizzle/SQLite (`MEDUSA_MODULE_TEST_PERSISTENCE=drizzle`): 9 files /
  77 passed in 31.08s;
- isolated PostgreSQL 18 cluster on 127.0.0.1:55603 (trust auth): both runners
  fail identically at 74 passed / 3 failed.

The three PostgreSQL failures are a pre-existing MikroORM-PostgreSQL behavior
gap, not a runner difference: Jest fails on exactly the same tests
(`should claim an item and add two new items to the order` and exchange
equivalent failing with "OrderShippingMethod ... was not found", and the
return flow asserting length 2 but receiving 3), while the fork's PGlite and
Drizzle adapters pass all 77. This mirrors the Product freeze-blocker
precedent. The isolated cluster was stopped with `pg_ctl stop -m fast` and
port 55603 confirmed closed.

Blocker recorded: fixing these three Order behaviors on MikroORM/PostgreSQL is
its own slice and a hard prerequisite before any Order cut-over turn. The
unchanged Medusa assertions remain the specification.

Not claimed in this slice: frozen offline install, CI sharding distribution,
Cloudflare gates, workerd execution, and the PostgreSQL fix above. No hosted
result is claimed.

## Next Boundary

The next slice should diagnose and fix only the three Order
MikroORM/PostgreSQL failures so both runners pass 9 files / 77 tests there,
using the unchanged assertions as the specification. The Order shadow
promotion, frozen install, Cloudflare gates, and sharding follow only after
that fix.

## Order MikroORM/PostgreSQL Fix Slice One

Commit:

- This commit (`fix(order): create claim and exchange shipping methods explicitly`)

Date verified: 2026-08-22.

### Difference From Original Medusa

`createOrderShippingMethodsBulk_` now creates the underlying
`OrderShippingMethod` rows and the versioned `OrderShipping` join rows as two
explicit queued creates instead of one nested create. The nested new shipping
method was never scheduled on the entity manager (no cascade on the
`hasOne foreignKey` relation, confirmed empirically: the UoW queue contained
only `OrderClaim`/`OrderShipping`), so auto-flush skipped it and an immediate
`retrieveOrderShippingMethod` inside the same transaction returned
not-found while the row only appeared at outer-commit flush. The alternative
adapters persist eagerly and were unaffected.

### Exact Proof

On isolated PostgreSQL 18 (127.0.0.1:55604, trust auth, stopped afterwards
with port confirmed closed):

- Vitest: 9 files / 74 passed / 3 failed;
- Jest rollback: identical counts and identical failing tests.

PGlite and Drizzle/SQLite remain 9 files / 77 passed for both runners. The
complete foundation passes and remaining-Jest ownership is unchanged at 68
configs / 107 scripts / 360 active API files with digest
`193bd34cd2c203b39ad2230dab44ae4e34533d729ca9b207fec01581f76ef303`.

The claim and exchange flows now progress past creation into their assertion
blocks. The three remaining PostgreSQL failures are identical for both
runners and were diagnosed empirically this session:

- `claim.return` hydrates null because the post-create internal-service
  update of `order_claim.return_id` does not persist (a direct public
  `updateOrderClaims([{ id, return_id }])` call does not stick either); the
  Return row itself persists correctly with `claim_id` set;
- reordering the creates (return before claim) fails entirely: the FKs are
  circular (`order_claim.return_id` -> return, `return.claim_id` ->
  order_claim) and only upstream's deferred commit-time flush ordered them;
  eager per-call flushing surfaces the cycle;
- a global `flushMode: "always"` connection setting was tested and reverted:
  it made inserts eager but did not fix any of the three failures;
- raw `order.items` hydration was verified correct; the crossing appears in
  the serialized claim/exchange response wiring.

Root cause context: the Cloudflare static-runtime port of the action files
replaced managed `em.create` entities with plain objects plus explicit service
creates, which loses upstream's deferred unit-of-work semantics these flows
were written against.

## Next Boundary

The next slice should make the claim/exchange/return flows persist their
circular foreign keys deterministically on PostgreSQL/MikroORM (for example by
creating both entities through one repository call whose flush orders the
inserts, or by restoring managed-entity creation for these actions), then
drive both runners to 9 files / 77 passed there. The Order shadow promotion
follows only after that.
