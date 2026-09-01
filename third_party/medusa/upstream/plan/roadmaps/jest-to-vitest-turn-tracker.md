# Jest to Vitest Turn Tracker

Status: active; the Order MikroORM/PostgreSQL fix slice one is complete
locally. Claim/exchange shipping-method creation now persists explicitly and
both runners fail identically at 74/77 on PostgreSQL (down from not-found
errors during creation); PGlite and Drizzle/SQLite remain 77/77 for both
runners. Remaining diagnosed gaps (claim/exchange `return` hydration,
return-cancel row visibility) are recorded as fix slice two. Migrated Wave B
packages through Cart use Vitest integration defaults with exact Jest
rollbacks. Order integration remains Jest-default with a proven opt-in Vitest
shadow.

Goal document:

- [`jest-to-vitest-migration-goal.md`](./jest-to-vitest-migration-goal.md)

## Active Goal

Migrate the active Jest test surface to Vitest through one reviewed package or
test-lane checkpoint at a time while preserving the original Medusa assertions
and keeping Jest available as the rollback runner until final cleanup.

## Goal Stop Condition

Stop only when:

- all active package and CI lanes use Vitest;
- original assertions, test names, skip/todo state, fixtures, and snapshots are
  preserved;
- PostgreSQL, PGlite/Drizzle, Redis, and Cloudflare gates are proven in their
  correct lanes;
- no active Jest scripts, configs, globals, imports, or types remain;
- legacy Jest dependencies are removed;
- the API archive has an explicit decision;
- documentation and commit evidence are complete;
- the worktree is clean.

## Standing Turn Loop

For every active turn:

1. Read this tracker and the goal document.
2. Confirm the worktree is clean and identify exactly one package or lane.
3. Record the authoritative Jest command, discovered files, full test names,
   result counts, snapshots, services, and environment.
4. Add or run the Vitest shadow without switching defaults.
5. Convert true Jest-only APIs to native Vitest APIs. When rollback must remain,
   preserve it through the narrowest package-local adapter; do not keep a
   global Jest bridge enabled for a lane claimed as native.
6. Run both runners sequentially and compare results.
7. Run package build/typecheck plus the relevant persistence/runtime gates.
8. Scan the scope for remaining Jest ownership.
9. Update this tracker and the relevant fork-change record.
10. Review the diff and resolve findings.
11. Commit the completed turn.
12. Stop. Do not start the next queue item in the same turn.

## Completed Turns

### Turn 0 - Planning Baseline

Status: completed in this planning slice.

Commit:

- `db53bf3601` (`docs: plan Jest to Vitest migration loop`)

Result:

- Audited the current runner, config, file, API, CI, and integration coupling
  surface.
- Recorded migration invariants, risk tiers, fixed first turns, later waves,
  acceptance gates, rollback rules, and completion criteria.
- Added this operational tracker.
- Changed no package scripts, configs, dependencies, tests, snapshots, or
  runtime source.

## Completed Implementation Turns

### Turn 1 - Upgrade Existing Vitest Workspaces

Status: completed in this toolchain baseline slice.

Scope:

- `medusa-cloudflare`, `@medusajs/admin-vite-plugin`,
  `@medusajs/dashboard`, `@medusajs/cloudflare-runtime`, `@medusajs/dal`,
  `@medusajs/dml`, `@medusajs/drizzle`, `@medusajs/icons`, and
  `@medusajs/ui`;
- Vite `8.1.4` with built-in Rolldown, Vitest `4.1.10`, and matching coverage;
- Vite peer owners and required companion plugin compatibility;
- the UI Storybook static-build boundary because it consumes root Vite;
- the pre-existing Cloudflare CommonJS source-resolution gaps exposed by the
  required real workerd gate;
- no Jest dependency, command, config, test source, or Jest-owned lane change;
- no shared migration harness yet.

Checklist:

- [x] Capture the exact existing Vitest workspace/file/result baseline and all
      four current configuration owners: 494 files and 622 tests pass; DML
      intentionally discovers zero files.
- [x] Confirm the stable target: Vite 8.1.4, Vitest 4.1.10, and coverage 4.1.10.
- [x] Record the pre-upgrade coverage failure in both design-system packages:
      `TypeError: this.resolveReporters is not a function`.
- [x] Align `@vitest/coverage-v8` with Vitest 4.
- [x] Prove the existing `test:coverage` commands in `@medusajs/icons` and
      `@medusajs/ui`.
- [x] Upgrade direct Vite owners and Vite peers to the Vite 8 line.
- [x] Upgrade Vite plugins whose current peer ranges exclude Vite 8.
- [x] Keep Storybook's static-build boundary supported on root Vite 8.
- [x] Apply only documented Vitest 4 config migrations: coverage `all`
      removal, optimizer `web` to `client`, and restoration of the old `dist`
      exclusion.
- [x] Prove the Cloudflare app's shared Vite config under Vitest 4.
- [x] Run every existing Vitest workspace without changing assertions.
- [x] Run Cloudflare app typecheck, build, and existing workerd/import gates.
- [x] Run admin-vite-plugin, admin-bundler, dashboard preview, and UI Storybook
      builds.
- [x] State Vite 8's supported Node engine boundary on direct tooling owners.
- [x] Record the pre-existing Cloudflare source-alias gate repair separately
      from test-runner behavior.
- [x] Record exact version decisions and results here.
- [x] Update concrete fork-change records.
- [x] Review the completed diff and resolve the blocking findings.
- [x] Commit the completed turn.

Stop condition:

- all 494 existing Vitest files and 622 tests are green on Vite 8/Vitest 4;
- both coverage commands and all applicable Vite/Storybook/Cloudflare gates
  pass;
- all Jest dependencies, commands, configs, test sources, and lane behavior
  remain unchanged.

Result:

- exact parity retained: 494 files and 622 tests passed;
- both design-system V8 coverage commands passed;
- DML retained its intentional zero-file pass;
- admin plugin, bundler, real draft-order plugin, dashboard preview, and
  Storybook builds passed on Vite 8.1.4/Rolldown;
- Cloudflare typecheck, production build, workerd Currency proof, and all
  portability gates passed;
- no experimental bundled-dev mode or Jest-lane change was introduced;
- complete evidence is in
  [`../fork-changes/test-runner-migration.md`](../fork-changes/test-runner-migration.md).

### Turn 2 - Shared Node Vitest Foundation

Status: completed in this repository-tooling slice.

Scope:

- repository-only shared Node Vitest configuration under
  `scripts/test-runner`;
- direct SWC transform parity for legacy decorators, metadata,
  assignment-style class fields, ES2021, ESM output, and source maps;
- explicit discovery and ordered alias inputs;
- a frozen, Vitest-only five-method bridge for the early rollback waves;
- strict Jest/Vitest JSON result normalization and comparison;
- exact remaining-Jest ownership inventory and CI guard;
- no package default, production source, Medusa assertion, fixture, or
  snapshot change.

Checklist:

- [x] Audit the effective shared Jest transform, discovery, aliases, and
      early-wave API surface.
- [x] Add the typed shared Node Vitest factory and direct SWC pre-transform.
- [x] Prove unsuffixed `__tests__` discovery and exclusion of `dist`,
      `__fixtures__`, and `__mocks__` poison files.
- [x] Prove exact, nested, and non-matching alias resolution.
- [x] Prove `until-async` and `msw` dependency handling.
- [x] Add the frozen `fn`, `spyOn`, `clearAllMocks`, `restoreAllMocks`, and
      `setTimeout` bridge without exposing the complete `vi` object.
- [x] Keep module mocks, fake timers, reset/isolation APIs, and Jest namespace
      types outside the bridge.
- [x] Add strict result normalization for files, full names, statuses,
      skip/todo state, aggregate counts, and snapshots.
- [x] Run the same five files sequentially under Jest and Vitest.
- [x] Include the unchanged real Utils assignment-field and method/parameter
      decorator tests in that parity run.
- [x] Add the exact remaining-Jest inventory digest and root/CI gate.
- [x] Keep `@medusajs/locking-cloudflare` on its original Jest default and
      prove its test and build.
- [x] Run the Cloudflare typecheck and portability import guards.
- [x] Run the frozen install, workspace dependency check, aggregate foundation
      check, and diff validation.
- [x] Update the roadmap and implementation record.
- [x] Review and commit the completed turn.

Result:

- tooling contract: one Vitest file and five tests passed, plus an isolated
  limited-bridge typecheck lane;
- exact shadow parity: five files, eight passed, one skipped, one todo, and one
  matched inline snapshot under each runner;
- exact active ownership baseline: 68 Jest configs, 116 Jest runner-script
  entries across 68 owners, 11 Jest dependency entries across four owners, 406
  Jest API files, and four `JEST_WORKER_ID` owners;
- the planning count for files using `jest.fn` was corrected from 126 to 127;
- the first canary's authoritative Jest command remains unchanged and passes
  one file and one test;
- complete evidence is in
  [`../fork-changes/test-runner-migration.md`](../fork-changes/test-runner-migration.md).

### Turn 3 - Locking Cloudflare Shadow

Status: completed in this package-local shadow slice.

Scope:

- `@medusajs/locking-cloudflare` unit lane only;
- one existing file and one existing assertion;
- a package-local Vitest config using the shared Node profile;
- an explicit `test:vitest` shadow command;
- no package-default switch, source edit, assertion edit, fixture edit, or Jest
  config edit.

Checklist:

- [x] Capture the authoritative Jest file, full name, result counts, snapshot
      count, environment, and service requirements.
- [x] Add `vitest.config.mts` with explicit package root, `src/`-scoped standard
      discovery, and the existing `@services` alias.
- [x] Keep the limited Jest bridge disabled because this test uses no Jest API.
- [x] Add `test:vitest` without changing the existing `test` command.
- [x] Run both runners sequentially with JSON reporters.
- [x] Compare normalized runner success, file paths, full names, statuses,
      counts, and snapshots; reject matching failed or empty runs.
- [x] Cover failed and empty comparator inputs in the shared runner contract.
- [x] Require the exact expected provider spec path in the comparator.
- [x] Run the authoritative Jest command, Vitest shadow, and package build.
- [x] Keep the remaining-Jest inventory exactly unchanged.
- [x] Run workspace dependency and Cloudflare type/import gates.
- [x] Update the roadmap and implementation record.
- [x] Review and commit the completed turn.

Result:

- both runners collect only
  `src/__tests__/provider.spec.ts`;
- both report the full name
  `locking cloudflare provider export exports the Durable Object locking provider service`;
- exact parity is one file, one passed test, zero failed, skipped, or todo tests,
  and zero snapshots;
- `test` remains `jest --passWithNoTests src` and passes;
- `test:vitest` passes through the shared SWC Node profile;
- package build and Cloudflare type/import gates pass;
- complete evidence is in
  [`../fork-changes/test-runner-migration.md`](../fork-changes/test-runner-migration.md).

### Turn 4 - Locking Cloudflare Cut-Over

Status: completed in this package-default switch slice.

Scope:

- the primary migration boundary is the `@medusajs/locking-cloudflare` unit
  lane;
- Vitest becomes `test`, while the unchanged Jest command becomes `test:jest`;
- the temporary `test:vitest` shadow alias is removed;
- the intended unit-test partition separates general and existing serial Jest
  tasks; Turn 15 later invalidates the exact checked-in pnpm command strings and
  reopens their correction for Turn 16;
- `@medusajs/types` keeps its test lane inactive through a cross-platform,
  argument-tolerant Node no-op;
- no Jest/Vitest config, production source, test source, assertion, fixture,
  snapshot, or skip-state change.

Checklist:

- [x] Reconfirm exact one-file/one-test Jest and Vitest parity before switching.
- [x] Make `test` invoke the proven package-local Vitest config.
- [x] Preserve `jest --passWithNoTests src` exactly as `test:jest`.
- [x] Prove default and rollback commands directly.
- [x] Prove all four package-level shard shapes with `--maxWorkers` and
      `--passWithNoTests`.
- [x] Correct the exact root unit-test CI commands so pnpm applies Turbo filters
      before forwarding task arguments. Turn 15 invalidated the earlier
      acceptance; Turn 16 repairs and contract-tests it.
- [x] Keep `--maxWorkers` out of the two existing `--runInBand` Jest tasks.
- [x] Preserve the inactive Types decision while making its no-op tolerate
      forwarded arguments under Windows and POSIX shells.
- [x] Audit the complete 85-task unit surface and prove the intended 83-task
      general plus two-task serial partition with correctly positioned
      Turbo-level filters.
- [x] Prove correctly positioned root Turbo delegation on a populated and an
      empty shard; do not treat it as proof of the then-malformed workflow
      strings.
- [x] Reconfirm exact JSON result parity after switching.
- [x] Run package build, workspace policy, and Cloudflare type/import gates.
- [x] Accept only the reviewed `test` to `test:jest` ownership move in the
      remaining-Jest inventory.
- [x] Run the aggregate shared test-runner foundation gate.
- [x] Update the roadmap and implementation record.
- [x] Review and commit the completed turn.

Result:

- `test` runs Vitest 4.1.10 and passes one file and one test;
- `test:jest` remains a one-command rollback with the identical Jest result;
- all four package shard commands exit successfully: shard 1 runs the test and
  shards 2 through 4 intentionally collect no files;
- correctly positioned scoped root Turbo delegation passes both a populated
  shard and an empty shard;
- representative correctly filtered general-lane execution passes Locking
  Cloudflare and the Types no-op together, while the serial-lane command accepts
  shard arguments for Framework and Utils without `--maxWorkers`;
- Turn 15 later proves the checked-in workflow strings do not apply those
  filters in Turbo; Turn 16 repairs the strings and adds exact parsed-workflow,
  dry-run, and real-run evidence;
- the real serial shard passes 9 Framework suites with 49 tests and 24 Utils
  suites with 142 passed tests plus one existing skip;
- exact normalized parity remains one file, one passed test, zero failed,
  skipped, or todo tests, and zero snapshots;
- the Jest ownership counts remain 68 configs, 116 runner scripts across 68
  owners, and 406 API files;
- package build, shared foundation, workspace policy, and Cloudflare type/import
  gates pass;
- complete evidence is in
  [`../fork-changes/test-runner-migration.md`](../fork-changes/test-runner-migration.md).

### Turn 5 - Payment Stripe Shadow

Status: completed in this second package-local shadow slice.

Scope:

- `@medusajs/payment-stripe` unit lane only;
- one existing unsuffixed file under `src/utils/__tests__` and one test with nine
  existing expectation calls;
- a source-scoped package-local Vitest config preserving all five Jest aliases;
- an explicit `test:vitest` shadow command;
- no package-default, Jest config, production source, test source, assertion,
  fixture, snapshot, or skip-state change.

Checklist:

- [x] Capture the authoritative Jest file, full test name, result counts,
      expectation count, snapshot count, environment, and service requirements.
- [x] Add `vitest.config.mts` with an absolute root and `src/`-scoped shared
      discovery.
- [x] Preserve `@models`, `@services`, `@repositories`, `@types`, and `@utils`
      aliases explicitly.
- [x] Keep the limited Jest bridge disabled because the test uses no Jest API.
- [x] Typecheck the package Vitest config under strict mode with
      `noUncheckedIndexedAccess`.
- [x] Add `test:vitest` without changing the existing `test` command.
- [x] List Vitest discovery and require only the source test despite a built
      `dist` copy.
- [x] Compare normalized runner success, exact file, full name, statuses,
      counts, and snapshots.
- [x] Run the authoritative Jest command, Vitest shadow, and package build.
- [x] Keep the exact remaining-Jest inventory byte-identical.
- [x] Run workspace policy, Cloudflare type/import gates, and the aggregate
      shared test-runner foundation.
- [x] Update the roadmap and implementation record.
- [x] Review and commit the completed turn.

Result:

- both runners collect only
  `src/utils/__tests__/get-smallest-unit.ts`;
- both report the full name
  `getSmallestUnit should convert an amount to the format required by Stripe based on currency`;
- exact parity is one file, one passed test, zero failed, skipped, or todo tests,
  and zero snapshots;
- all nine existing expectation calls remain unchanged;
- Vitest proves the runtime import path through the built CommonJS Framework
  utilities barrel, while the Stripe client and network path remain unreachable;
- the five preserved aliases remain unexercised by this relative-import test and
  therefore require later consumer proof;
- `test` remains `jest --passWithNoTests src` and passes;
- `test:vitest` passes on Vitest 4.1.10 through the shared SWC Node profile;
- the package Vitest config passes its standalone strict TypeScript check;
- package build, shared foundation, workspace policy, and Cloudflare type/import
  gates pass;
- complete evidence is in
  [`../fork-changes/test-runner-migration.md`](../fork-changes/test-runner-migration.md).

### Turn 6 - Payment Stripe Cut-Over

Status: completed in this second package-default switch slice.

Scope:

- `@medusajs/payment-stripe` unit-lane scripts only;
- Vitest becomes `test`, while the unchanged Jest command becomes `test:jest`;
- the temporary `test:vitest` shadow alias is removed;
- the existing general unit-CI lane and workflow remain unchanged;
- no Jest/Vitest config, production source, test source, test name, assertion,
  fixture, snapshot, alias, or skip-state change.

Checklist:

- [x] Reconfirm exact one-file/one-test parity before switching.
- [x] Make `test` invoke the proven package-local Vitest config.
- [x] Preserve `jest --passWithNoTests src` exactly as `test:jest`.
- [x] Prove default and rollback commands directly.
- [x] Prove all four default and rollback shard shapes with `--maxWorkers=1`
      and `--passWithNoTests`.
- [x] Prove all four scoped root/general-lane shard shapes without changing CI.
- [x] Reconfirm exact JSON parity after switching.
- [x] Run package build and the standalone strict config typecheck.
- [x] Accept only the reviewed `test` to `test:jest` ownership move in the
      remaining-Jest inventory.
- [x] Run workspace policy, Cloudflare type/import gates, and the aggregate
      shared test-runner foundation.
- [x] Update the roadmap and implementation record.
- [x] Review and commit the completed turn.

Result:

- `test` runs Vitest 4.1.10 and passes the one source file and one test;
- `test:jest` remains a one-command rollback with the identical normalized
  result;
- all four direct default and rollback shard commands exit successfully: shard
  1 runs the test and shards 2 through 4 intentionally collect no files;
- all four scoped root Turbo commands select only Payment Stripe and have the
  same populated/empty shard behavior;
- exact normalized parity remains one file, one passed test, zero failed,
  skipped, or todo tests, and zero snapshots;
- all nine expectation calls and the built CommonJS Framework utilities import
  path remain unchanged;
- the five preserved aliases remain unexercised and are not claimed as proven;
- the Jest ownership command moves only from `test` to `test:jest`, with all
  counts unchanged;
- package build, strict config typing, shared foundation, workspace policy, and
  Cloudflare type/import gates pass;
- complete evidence is in
  [`../fork-changes/test-runner-migration.md`](../fork-changes/test-runner-migration.md).

### Turn 7 - Core Flows Shadow

Status: completed in this first shared-core package shadow slice.

Scope:

- the complete current `@medusajs/core-flows` unit surface: three source files
  and 13 tests;
- a source-scoped package-local Vitest config with no aliases, setup file, or
  legacy Jest bridge;
- an explicit `test:vitest` shadow command;
- no package-default, Jest config, production source, test source, assertion,
  fixture, snapshot, package export, or skip-state change.

Checklist:

- [x] Capture the authoritative Jest files, names, result counts, snapshots,
      environment, and service requirements.
- [x] Confirm the three planned files are the complete current package test
      surface.
- [x] Add `vitest.config.mts` with an absolute root and `src/`-scoped shared
      discovery.
- [x] Confirm no alias is required by the Jest config or selected imports.
- [x] Keep the limited Jest bridge disabled because the tests use no Jest API.
- [x] Typecheck the package Vitest config under strict mode with
      `noUncheckedIndexedAccess`.
- [x] Add `test:vitest` without changing the existing `test` command.
- [x] List exact Vitest discovery and compare normalized runner success, files,
      names, statuses, counts, and snapshots.
- [x] Prove the built shared-core package entrypoints used at runtime.
- [x] Run the authoritative Jest command, Vitest shadow, package build, and all
      four scoped root/general-lane Jest shards.
- [x] Keep the exact remaining-Jest inventory byte-identical.
- [x] Run workspace policy, Cloudflare type/import gates, and the aggregate
      shared test-runner foundation.
- [x] Update the roadmap and implementation record.
- [x] Review and commit the completed turn.

Result:

- both runners collect the same three source files and report exactly 13 passed
  tests, zero failed, skipped, or todo tests, and zero snapshots;
- `test` remains `jest --bail --forceExit --passWithNoTests` and passes;
- `test:vitest` passes on Vitest 4.1.10 through the shared SWC Node profile;
- the config has no aliases because the package Jest config has no mapper and
  these tests use relative source imports plus workspace package entrypoints;
- live resolution reaches built Framework, Framework Awilix and utilities,
  Workflows SDK, Utils, and `expect-type` entrypoints;
- scoped root shards 1 through 3 run 3, 2, and 8 tests respectively, while
  shard 4 intentionally collects none and passes with `--passWithNoTests`;
- the package Vitest config passes its standalone strict TypeScript check;
- the remaining-Jest digest and all ownership counts remain unchanged;
- package build, shared foundation, workspace policy, and Cloudflare type/import
  gates pass;
- complete evidence is in
  [`../fork-changes/test-runner-migration.md`](../fork-changes/test-runner-migration.md).

### Turn 8 - Core Flows Cut-Over

Status: completed in this first shared-core package-default switch slice.

Scope:

- `@medusajs/core-flows` unit-lane scripts only;
- Vitest becomes `test`, while the unchanged Jest command becomes `test:jest`;
- the temporary `test:vitest` shadow alias is removed;
- the existing general unit-CI lane and workflow remain unchanged;
- no Jest/Vitest config, production source, test source, test name, assertion,
  fixture, snapshot, package export, alias, or skip-state change.

Checklist:

- [x] Reconfirm exact three-file/13-test parity before switching.
- [x] Make `test` invoke the proven package-local Vitest config.
- [x] Preserve `jest --bail --forceExit --passWithNoTests` exactly as
      `test:jest`.
- [x] Keep normal Vitest discovery fail-closed and rely on the existing CI
      `--passWithNoTests` argument only for its empty shard.
- [x] Prove default and rollback commands directly.
- [x] Prove all four default and rollback shard shapes with `--maxWorkers=1`
      and `--passWithNoTests`.
- [x] Prove all four scoped root/general-lane shard shapes without changing CI.
- [x] Record distinct Vitest and Jest shard placement without weakening
      aggregate discovery parity.
- [x] Reconfirm exact JSON parity after switching.
- [x] Run package build and the standalone strict config typecheck.
- [x] Accept only the reviewed `test` to `test:jest` ownership move in the
      remaining-Jest inventory.
- [x] Run workspace policy, Cloudflare type/import gates, and the aggregate
      shared test-runner foundation.
- [x] Update the roadmap and implementation record.
- [x] Review and commit the completed turn.

Result:

- `test` runs Vitest 4.1.10 and passes all three source files and 13 tests;
- `test:jest` remains a one-command rollback with the identical normalized
  result and exact legacy flags;
- all four direct Vitest shards exit successfully with a 2/8/3/0 test
  distribution;
- all four direct Jest rollback shards exit successfully with a 3/2/8/0 test
  distribution;
- all four scoped root Turbo commands select only Core Flows and reproduce the
  Vitest 2/8/3/0 distribution;
- both runners cover the same three files and 13 full names exactly once, while
  shard 4 intentionally remains empty and requires `--passWithNoTests`;
- exact normalized parity remains three files, 13 passed tests, zero failed,
  skipped, or todo tests, and zero snapshots;
- the Jest ownership command moves only from `test` to `test:jest`, with all
  counts unchanged;
- package build, strict config typing, shared foundation, workspace policy, and
  Cloudflare type/import gates pass;
- complete evidence is in
  [`../fork-changes/test-runner-migration.md`](../fork-changes/test-runner-migration.md).

### Turn 9 - Currency Unit Shadow

Status: completed in this first module unit-lane shadow slice.

Scope:

- Currency's complete current unit lane: two source files, two tests, and six
  existing assertion calls;
- a source-scoped package-local Vitest config preserving all four Jest aliases;
- an explicit `test:vitest` unit shadow command;
- both Currency Jest unit and integration commands remain authoritative and
  byte-identical;
- no production source, test source, assertion, fixture, snapshot, integration
  config, package export, or skip-state change.

Checklist:

- [x] Capture the authoritative Jest unit files, full names, result counts,
      assertion count, snapshots, environment, and service requirements.
- [x] Confirm `noop.ts` is a real collected and passed suite.
- [x] Add `vitest.config.mts` with an absolute root and `src/`-scoped shared
      discovery.
- [x] Preserve `@models`, `@services`, `@repositories`, and `@types` in Jest
      mapper order.
- [x] Keep the limited Jest bridge disabled because the unit files use no Jest
      API.
- [x] Typecheck the package Vitest config under strict mode with
      `noUncheckedIndexedAccess`.
- [x] Add `test:vitest` without changing `test` or `test:integration`.
- [x] Rebuild Currency, then prove Vitest still lists only the two source tests
      and excludes `dist` duplicates plus integration.
- [x] Compare normalized runner success, exact files, full names, statuses,
      counts, and snapshots.
- [x] Prove the source aliases and built package entrypoints used at runtime.
- [x] List the one integration file through Jest without executing it or
      including it in unit parity.
- [x] Run the authoritative Jest unit command, Vitest shadow, package build, and
      all four scoped root/general-lane Jest shards.
- [x] Keep the exact remaining-Jest inventory byte-identical.
- [x] Run workspace policy, Cloudflare type/import gates, and the aggregate
      shared test-runner foundation.
- [x] Update the roadmap and implementation record.
- [x] Review and commit the completed turn.

Result:

- both runners collect exactly `src/__tests__/static-manifest.spec.ts` and
  `src/services/__tests__/noop.ts`;
- both report the full names
  `Currency static manifest matches the normal Currency module export and joiner config`
  and `noop should run`;
- exact parity is two files, two passed tests, zero failed, skipped, or todo
  tests, and zero snapshots;
- all six existing assertion calls remain unchanged;
- `test` and `test:integration` remain their exact Jest commands;
- `test:vitest` passes on Vitest 4.1.10 through the shared SWC Node profile;
- `@services` and `@models` are exercised transitively; `@repositories` and
  `@types` remain preserved but unexercised;
- the static-manifest identity and schema checks prove built Modules SDK,
  Framework, Utils, MedusaService, DML model, and portable joiner entrypoints;
- scoped root Jest shards select only Currency with a 1/1/0/0 test distribution;
- the integration command lists one separate `jest.setTimeout` suite, but no
  PostgreSQL, PGlite/Drizzle, workerd/D1, or other integration backend is claimed
  as executed by this unit turn;
- the package Vitest config passes its standalone strict TypeScript check;
- the remaining-Jest digest and all ownership counts remain unchanged;
- package build, shared foundation, workspace policy, and Cloudflare type/import
  gates pass;
- complete evidence is in
  [`../fork-changes/test-runner-migration.md`](../fork-changes/test-runner-migration.md).

### Turn 10 - Currency Unit Cut-Over

Status: completed in this module unit-only package-default switch slice.

Scope:

- Currency unit-lane scripts only;
- Vitest becomes unit `test`, while the unchanged Jest unit command becomes
  `test:jest`;
- the temporary `test:vitest` shadow alias is removed;
- `test:integration`, its Jest API ownership, and all integration workflows
  remain unchanged;
- no Jest/Vitest config, production source, test source, test name, assertion,
  fixture, snapshot, package export, alias, or skip-state change.

Checklist:

- [x] Reconfirm exact two-file/two-test unit parity before switching.
- [x] Make unit `test` invoke the proven package-local Vitest config.
- [x] Preserve `jest --bail --forceExit --testPathPattern=src` exactly as
      `test:jest`.
- [x] Keep `test:integration` byte-identical and outside unit parity.
- [x] Keep normal Vitest discovery fail-closed and rely on the existing CI
      `--passWithNoTests` argument only for empty unit shards.
- [x] Prove default and unit rollback commands directly.
- [x] Prove all four default and rollback unit shard shapes with
      `--maxWorkers=1` and `--passWithNoTests`.
- [x] Prove all four scoped root/general-lane unit shard shapes without changing
      CI.
- [x] Use real runner output for shard proof and reject sharded `vitest list` as
      evidence when shards outnumber files.
- [x] Reconfirm exact JSON parity after switching.
- [x] Rebuild Currency, prove unsharded source-only discovery, and re-list the
      unchanged integration file without executing it.
- [x] Run package build and the standalone strict config typecheck.
- [x] Accept only the reviewed unit `test` to `test:jest` ownership move in the
      remaining-Jest inventory.
- [x] Run workspace policy, Cloudflare type/import gates, and the aggregate
      shared test-runner foundation.
- [x] Update the roadmap and implementation record.
- [x] Review and commit the completed turn.

Result:

- unit `test` runs Vitest 4.1.10 and passes the two source files and two tests;
- `test:jest` remains a one-command unit rollback with the identical normalized
  result and exact legacy flags/path boundary;
- `test:integration` remains the byte-identical Jest command and lists exactly
  `currency-module-service.spec.ts` without execution;
- all four direct Vitest and Jest rollback unit shards exit successfully with
  identical noop/static/empty/empty placement and a 1/1/0/0 test distribution;
- all four scoped root Turbo commands select only Currency and reproduce the
  Vitest 1/1/0/0 distribution;
- exact normalized unit parity remains two files, two passed tests, zero failed,
  skipped, or todo tests, and zero snapshots;
- all six existing assertions and the source alias/built entrypoint proof remain
  unchanged;
- unsharded `vitest list` remains exact after rebuild, while real `vitest run`
  output—not sharded list—is the authoritative shard evidence;
- the unit Jest ownership command moves only from `test` to `test:jest`, while
  integration/config/API ownership and all counts remain unchanged;
- package build, strict config typing, shared foundation, workspace policy, and
  Cloudflare type/import gates pass;
- complete evidence is in
  [`../fork-changes/test-runner-migration.md`](../fork-changes/test-runner-migration.md).

### Turn 11 - Runner-Neutral Worker Identity

Status: completed as an integration-foundation prerequisite with all runner
defaults unchanged.

Scope:

- add one typed worker-identity leaf to `@medusajs/test-utils`;
- replace the four direct runtime/setup reads of `JEST_WORKER_ID` with that
  boundary;
- preserve exact Jest/default database names and Redis database numbers;
- add a distinct `vitest-N` database suffix for Vitest pool workers;
- do not add an integration Vitest profile, change a package/CI runner, execute
  a module assertion, or claim Redis-backed cross-runner isolation.

Checklist:

- [x] Audit all four direct consumers and their exact current outputs.
- [x] Resolve `MEDUSA_TEST_WORKER_ID` before `VITEST_POOL_ID`, then
      `JEST_WORKER_ID`, then default worker `1`.
- [x] Validate selected IDs as positive safe integers instead of retaining
      `parseInt`'s partial-input behavior.
- [x] Keep the actual runner namespace separate from the numeric ID source.
- [x] Preserve caller-owned `config.dbName` and `DB_TEMP_NAME` short-circuiting.
- [x] Preserve caller-owned child-process `REDIS_URL` precedence and skip worker
      resolution when no Redis URL is supplied.
- [x] Load only the built CommonJS worker-identity leaf from integration setup;
      do not load the eager package barrel or add a restrictive exports map.
- [x] Prove the pure resolver, package build, full package Jest lane, built leaf,
      setup-env database matrix, and setup-server Redis matrix.
- [x] Accept only the reviewed four-to-one worker-ID ownership consolidation in
      the remaining-Jest inventory.
- [x] Run workspace policy, Cloudflare type/import gates, and the aggregate
      shared test-runner foundation.
- [x] Record the unresolved numeric Redis namespace boundary explicitly.
- [x] Update the roadmap and implementation record.
- [x] Review and commit the completed turn.

Result:

- the helper reports the selected source, actual runner, one-based worker ID,
  runner-aware database suffix, and legacy zero-based Redis database;
- Jest worker `3` still produces `medusa-<module>-integration-3`,
  `medusa-integration-3-2` for chunk `2`, and Redis database `2`;
- the no-runner default still uses suffix `1` and Redis database `0`;
- Vitest pool `3` produces database suffix `vitest-3`, even if a stale Jest
  environment value is also present;
- `MEDUSA_TEST_WORKER_ID=7` overrides the slot while retaining the actual runner
  namespace, so a Vitest process uses `vitest-7` and a Jest process uses `7`;
- the helper is the only remaining `JEST_WORKER_ID` owner: the exact count falls
  from four to one and the digest becomes
  `8207b56a09a907ae7a30954af11edf3c1e4471f89d9b28e9e97035268ae17c5b`;
- all Jest script/config/dependency/API counts remain unchanged, and no runner
  default or CI command changes;
- the default 16 logical Redis databases cannot provide disjoint multi-worker
  Jest and Vitest ranges while retaining every Jest mapping, so Turn 12 must use
  a separate URL/key namespace or remain outside Redis-backed shadow claims;
- package build/tests, CommonJS/setup matrices, shared foundation, workspace
  policy, and Cloudflare type/import gates pass;
- complete evidence is in
  [`../fork-changes/test-runner-migration.md`](../fork-changes/test-runner-migration.md).

### Turn 12 - Integration Vitest Profile And PGlite Runner Selector

Status: completed as a Jest-authoritative integration-foundation shadow.

Scope:

- add a serial shared Vitest integration profile over the existing Node
  foundation;
- add a strict Jest/Vitest selector to the PGlite orchestrator while preserving
  Jest as the dedicated PGlite matrix default; the existing CI foundation gate
  now also runs the focused dual-run adapter proof;
- shadow only the two existing PGlite adapter specs plus one isolated
  runner-neutral lifecycle contract;
- do not migrate Currency or any production module-service assertion and do not
  claim PostgreSQL, Redis, HTTP, workerd, or full-matrix Vitest parity.

Checklist:

- [x] Record the Jest adapter baseline at two files, 32 tests, and zero
      snapshots before adding the lifecycle contract.
- [x] Keep the default lane order at exactly 25 entries and preserve the
      existing unqualified CI command.
- [x] Accept `--runner jest`, `--runner=jest`, `--runner vitest`, and
      `--runner=vitest`; reject missing, empty, and unknown runner values.
- [x] Preflight every selected lane before spawning so unsupported Vitest
      module/full selections fail closed.
- [x] Keep Jest-only CLI flags out of the Vitest command and do not append
      `--experimental-vm-modules` for Vitest; preserve caller-owned
      `NODE_OPTIONS`.
- [x] Configure Vitest with one fork, disabled file parallelism, non-concurrent
      tests, list-ordered hooks/setup files, the existing setup environment, and
      the limited compatibility bridge.
- [x] Preserve the shared five-second defaults and prove explicit timeout
      arguments without claiming timeout-failure behavior.
- [x] Exercise real PGlite create/prepare/setup/clear/cleanup behavior and both
      module initialization hooks in two ordered, non-overlapping tests.
- [x] Compare normalized Jest and Vitest output for the exact three-file,
      34-test, zero-snapshot surface.
- [x] Preserve the package's default `jest --passWithNoTests src` unit
      collection by locating the lifecycle contract outside `src`.
- [x] Accept the reviewed root/CI invocation digest replacement and add explicit
      ownership for both Jest-executing foundation verifiers to the
      remaining-Jest inventory.
- [x] Run package, shared-foundation, workspace-policy, and Cloudflare
      type/import regression gates.
- [x] Update the roadmap and both fork-change records.
- [x] Review and commit the completed turn.

Result:

- the real default-Jest adapter command passes three files and 34 tests with the
  existing force-exit behavior retained, while the selector contract proves the
  explicit-Jest forms map to the same runner;
- the Vitest adapter selection passes the identical files and tests and exits
  naturally;
- the automated foundation check proves exact names/status/count/snapshot
  parity plus the selector contract;
- the inventory now tracks two foundation Jest invocations: the pre-existing
  shared parity verifier and this turn's integration parity verifier;
- caller-owned `DB_TEMP_NAME` remains accepted, while the lifecycle runner's own
  generated database name carries the runner-aware worker suffix;
- the 24 production module lanes remain Jest-only and no production module
  assertion has moved;
- complete evidence is in
  [`../fork-changes/test-runner-migration.md`](../fork-changes/test-runner-migration.md)
  and
  [`../fork-changes/persistence-and-testing.md`](../fork-changes/persistence-and-testing.md).

### Turn 13 - Currency Integration Vitest Shadow

Status: implementation and local acceptance completed with Jest still
authoritative; hosted execution is deferred until the fork has a safe
publication target and does not block Turn 14.

Scope:

- shadow the one unchanged Currency integration file under Vitest;
- prove MikroORM/PostgreSQL, PGlite, and Drizzle/SQLite as three distinct
  backends under both runners;
- enable Vitest only for Currency in the PGlite selector;
- add a focused CI job whose only external service is PostgreSQL, without
  changing the existing PGlite or package-integration jobs;
- retain Currency unit defaults, integration Jest default, assertions,
  production behavior, and Cloudflare boundaries.

Checklist:

- [x] Record pre-edit Jest baselines at one file, 13 passed tests, and zero
      snapshots for PostgreSQL, PGlite, and Drizzle/SQLite.
- [x] Freeze the unchanged assertion source digest and exact 13 full test names.
- [x] Add an exact one-file, four-alias, serial integration Vitest config.
- [x] Add only `test:integration:vitest`; keep `test:integration` byte-identical.
- [x] Prove the unchanged `jest.setTimeout(100000)` through the limited bridge.
- [x] Compare normalized output in all six runner/backend quadrants.
- [x] Execute both Currency PGlite mappings through the real orchestrator.
- [x] Keep the default 25-lane list/order and fail unsupported Vitest selections
      before spawning, with `api-key` now the first unsupported module lane.
- [x] Add and locally validate one non-matrix CI shadow job whose only external
      service is PostgreSQL.
- [x] Preserve Currency unit default/rollback and package builds.
- [x] Run workspace, shared foundation, inventory, and Cloudflare regression
      gates.
- [x] Update the roadmap and test-runner, persistence, and package-management
      fork records.
- [x] Review and commit the locally completed implementation.
- [ ] Observe the hosted `currency-integration-shadow` job after publication.
      This is deferred environment evidence, not a Turn 14 prerequisite.

Result:

- the unchanged source retains 13 tests, 18 assertion calls, and no
  skip/todo/snapshot ownership;
- all six Jest/Vitest x PostgreSQL/PGlite/Drizzle results are exact at one file,
  13 passes, zero failures/skips/todos, and zero snapshots;
- Vitest exits naturally on all three backends; Jest retains its existing
  force-exit behavior without being treated as teardown evidence;
- the real default-Jest and Vitest Currency PGlite selectors both pass one lane,
  one file, and 13 tests;
- the focused CI workflow shape is locally enforced by the seventh tooling
  test; PostgreSQL is its only external service, with no Redis or matrix;
- the existing dedicated PGlite job remains an unqualified Jest-default
  `pnpm test:integration:pglite` run;
- complete evidence is in
  [`../fork-changes/test-runner-migration.md`](../fork-changes/test-runner-migration.md),
  [`../fork-changes/persistence-and-testing.md`](../fork-changes/persistence-and-testing.md),
  and
  [`../fork-changes/package-management.md`](../fork-changes/package-management.md).

### Turn 14 - Currency Integration Vitest Cut-Over

Status: implementation and local acceptance completed with Vitest as the
Currency integration default and an explicit Jest rollback. Hosted environment
confirmation remains deferred.

Scope:

- switch only Currency's integration package default from the proven Vitest
  shadow to `test:integration`;
- retain the byte-identical Jest command as `test:integration:jest` and remove
  the temporary Vitest shadow alias;
- deliberately remap both Currency PGlite runner commands while leaving the
  global runner default and the other 23 module Jest commands unchanged;
- keep the exact assertion/config/backend/Cloudflare boundaries;
- move Currency from the incompatible generic three-way package shard to its
  existing dedicated unsharded six-quadrant CI command, and propagate that job
  through the stable package aggregate.

Checklist:

- [x] Re-run the pre-edit six-quadrant baseline at one file, 13 tests, and zero
      snapshots on PostgreSQL, PGlite, and Drizzle/SQLite under both runners.
- [x] Make `test:integration` the Vitest default.
- [x] Preserve the exact former Jest default as `test:integration:jest`.
- [x] Remove `test:integration:vitest` rather than retaining duplicate Vitest
      command ownership.
- [x] Keep the PGlite orchestrator default Jest and route Currency's Jest
      selection explicitly through the rollback script.
- [x] Route Currency's Vitest selection through the new package default and
      leave all other module mappings unchanged.
- [x] Update the strict verifier to assert and execute default/rollback
      ownership while retaining the source digest and exact result contract.
- [x] Reproduce the real Turbo-forwarded `--shard=1/3` Vitest failure for the
      one-file suite.
- [x] Exclude Currency only from `test:integration:packages:fast`, retain it in
      the unsharded all-packages command, and keep the dedicated job command
      unchanged.
- [x] Make the stable package aggregate require both the generic matrix and the
      Currency job, including failure/cancellation/skipping propagation.
- [x] Expand the tooling contract to freeze the exact fast/slow/all commands,
      matrix forwarding, dedicated job, and aggregate result ownership.
- [x] Accept only the reviewed script-key and verifier/orchestrator digest moves
      in the remaining-Jest inventory.
- [x] Repeat post-edit six-quadrant parity and both real PGlite selectors.
- [x] Rebuild test-utils/Currency and prove Currency unit default/rollback.
- [x] Run workspace policy and the full shared test-runner aggregate.
- [x] Run Cloudflare type/test/build, D1 workerd, Durable Object SQLite, and all
      import guards.
- [x] Preserve the deferred hosted job without claiming it passed.
- [x] Update the roadmap and test-runner, persistence, and package-management
      records.
- [x] Review and commit the completed implementation.

Result:

- Vitest is the Currency integration default; the exact old Jest command is
  available only as `test:integration:jest`;
- the unchanged source still hashes to
  `73b9ff980e9e4431fa18e3f4ed87f13dfed35e6f3e02b1388be6a439027d754f`
  and retains 13 tests, 18 assertions, no skip/todo, and no snapshots;
- Vitest default and Jest rollback results are exact across all six
  runner/backend quadrants at one file and 13 passes;
- the unqualified Currency PGlite selector still executes Jest through the
  rollback, while the explicit Vitest selector executes the package default;
- the generic fast package matrix no longer selects Currency because Vitest 4
  rejects a three-way shard for one file; API Key remains in that lane and the
  unsharded all-packages command remains inclusive;
- the unchanged dedicated `currency-integration-shadow` command remains the CI
  owner for the complete unsharded Currency proof; its name is retained for
  workflow stability even though the verifier now checks default and rollback;
- the stable `integration-tests-packages` aggregate cannot pass unless both the
  generic package matrix and dedicated Currency job pass;
- all remaining-Jest counts stay unchanged at 68 configs, 116 scripts across
  68 owners, 11 dependencies across four owners, 406 active API files, three
  foundation invocation files, one worker-ID owner, and one root/CI owner;
- complete evidence is in
  [`../fork-changes/test-runner-migration.md`](../fork-changes/test-runner-migration.md),
  [`../fork-changes/persistence-and-testing.md`](../fork-changes/persistence-and-testing.md),
  and
  [`../fork-changes/package-management.md`](../fork-changes/package-management.md).

### Turn 15 - Auth Emailpass Empty Unit Lane Retirement

Status: completed as a zero-test ownership decision. No Vitest parity or
package-default cut-over is claimed.

Scope:

- audit the inherited `@medusajs/auth-emailpass` unit command and assertion
  history before choosing retain, retire, or restore;
- retire only the empty `test: jest --passWithNoTests src` manifest key;
- preserve the exact Jest integration command, active shared Jest config,
  integration assertions, provider source, and package dependencies;
- keep Auth Emailpass incomplete in Wave A while its integration lane remains
  Jest-authoritative;
- record, but do not mix in, the separately discovered pnpm/Turbo unit-workflow
  forwarding defect.

Checklist:

- [x] Prove pre-edit direct Jest discovery under `src` returns zero files and
      the unit command exits zero only through `--passWithNoTests`.
- [x] Verify the original fork baseline and fetched upstream still contain the
      empty command without a historical unit assertion surface.
- [x] Remove only the unit `test` manifest key without creating a meaningless
      empty Vitest command or Jest rollback alias.
- [x] Keep `test:integration` and `jest.config.js` byte-identical.
- [x] Run the unchanged integration lane before and after the edit at one file,
      nine passed tests, and zero snapshots.
- [x] Freeze the unchanged normalized-LF integration source digest and its 19
      `expect` calls.
- [x] Verify the package build and post-edit direct Jest discovery.
- [x] Prove the correctly formed filtered root command scopes only Auth
      Emailpass and executes zero unit tasks.
- [x] Verify Turbo changes the package unit task command from the inherited Jest
      command to `<NONEXISTENT>` while retaining the graph marker.
- [x] Accept exactly one removed manifest-script inventory entry and no other
      ownership delta.
- [x] Run workspace policy, the exact remaining-Jest check, and the full shared
      test-runner foundation.
- [x] Record why PostgreSQL, PGlite, Redis, workerd, and Cloudflare execution are
      not evidence for this mocked provider integration lane.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed retirement.

Result:

- Auth Emailpass no longer advertises a unit test lane that owns zero test
  files; this retires nonexistent coverage rather than migrating it;
- the active Jest integration lane remains exact at one suite, nine tests, 19
  `expect` calls, and zero snapshots, with normalized-LF SHA-256
  `6892c74183528270d00d64bce8c0769a165aada8d45c8b3c64e819ca81689645`;
- `jest.config.js` remains active because that integration lane consumes its
  root and TypeScript transform; its package alias mappings remain preserved but
  are not exercised by this relative-import specification;
- a Turbo dry-run now represents the package's unit graph marker with
  `<NONEXISTENT>`, and a correctly filtered root execution performs zero tasks
  successfully;
- the remaining-Jest digest is
  `e9332f849f83ce9f748f191aef3bb82c145e5a971480aab93c00e8835a77b444`;
  script entries move from 116 to 115 while all other counts remain unchanged;
- a separate reproduction proved the then-existing workflow placed pnpm/Turbo
  filters after a separator, selected 85 packages, and forwarded an invalid
  `--filter` option into Vitest. Turn 16 repairs that workflow before the Auth
  integration shadow proceeds.

### Turn 16 - pnpm/Turbo Unit CI Forwarding Repair

Status: completed as a workflow/test-foundation correction. Existing package
runner defaults and rollback lanes remain unchanged.

Scope:

- move both unit-matrix package filter sets before pnpm's runner-argument
  separator;
- preserve four-way sharding, general-lane worker capping,
  `--passWithNoTests`, and the serial packages' `--runInBand` ownership;
- add an exact parsed workflow contract rather than relying on historical
  command intent;
- prove current general/serial selection through Turbo dry-runs and
  representative real Jest/Vitest executions;
- make no package-script, assertion, integration, persistence, or runtime
  change.

Checklist:

- [x] Add the parsed contract first and capture its exact red failure against
      both malformed `pnpm test -- --filter=...` strings.
- [x] Move the Framework/Utils exclusions before the separator in the general
      command.
- [x] Move the Framework/Utils inclusions before the separator in the serial
      command.
- [x] Freeze the exact root Turbo delegation, four-shard matrix, unique named
      run step, both full commands, general `--maxWorkers`, and serial omission
      of that flag.
- [x] Keep the YAML boundary strict without `any`, weak assertions, or broad
      unvalidated shapes.
- [x] Run strict tooling typecheck and all eight tooling tests.
- [x] Prove the general Turbo graph has 83 nodes and excludes Framework/Utils.
- [x] Prove the serial graph has exactly the two intended Jest packages and the
      disjoint graph union retains all 85 nodes.
- [x] Run mixed Jest/Vitest general-lane populated and empty shards to prove
      filter and runner-argument forwarding.
- [x] Run all four Core Flows and Locking Cloudflare Vitest shards, including
      intentional empty shards.
- [x] Run the exact Framework/Utils serial shard without `--maxWorkers`.
- [x] Run workspace policy, exact remaining-Jest ownership, and the complete
      shared test-runner foundation.
- [x] Record hosted execution as deferred rather than passing.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed repair.

Result:

- both workflow commands now place Turbo filters before `--`, so only runner
  shard/worker/pass-with-no-tests arguments cross the task boundary;
- the new eighth tooling test fails closed on command drift and also protects
  the root `test` script and matrix ownership;
- dry-runs prove an 83-node general graph with 71 executable scripts and 12
  `<NONEXISTENT>` markers, plus a two-node Framework/Utils serial graph;
- the mixed general shard proves Jest Event Bus Redis at 1 suite/34 tests and
  Vitest Payment Stripe at 1 file/1 test; both intentionally empty shard-4
  selections exit zero;
- Core Flows covers all 13 Vitest tests across 2/8/3/0 shards, while Locking
  Cloudflare covers its one Vitest test across 1/0/0/0 shards;
- serial shard 1 passes Framework at 9 suites/49 tests and Utils at 24
  suites/142 passed/1 existing skip, with two snapshots in each package and no
  worker conflict;
- the remaining-Jest inventory stays exact at digest
  `e9332f849f83ce9f748f191aef3bb82c145e5a971480aab93c00e8835a77b444`:
  68 configs, 115 scripts, and 406 active API files;
- no Redis service is claimed by the mocked Event Bus Redis unit suite, and the
  Locking Cloudflare unit proof does not imply workerd, D1, or a production
  bundle gate;
- the pre-existing Turbo package-graph warning remains separate, and hosted
  execution remains deferred.

### Turn 17 - Auth Emailpass Integration Vitest Shadow

Status: completed as an opt-in integration shadow with Jest still authoritative.

Scope:

- keep the exact `test:integration` Jest command and active Jest config
  unchanged;
- add only a `test:integration:vitest` script and package-local shared-profile
  config;
- preserve all five package alias mappings while scoping Vitest to the one
  unchanged integration spec;
- compare exact JSON results rather than treating matching counts as parity;
- do not switch the default, restore a unit script, or alter CI.

Checklist:

- [x] Capture the pre-edit Jest discovery and exact one-file/nine-test result.
- [x] Freeze the normalized-LF spec and Jest-config digests.
- [x] Audit all Jest APIs and confirm they fit the existing compatibility bridge.
- [x] Add only `test:integration:vitest`; keep `test:integration` byte-identical.
- [x] Add a strict package-local Vitest integration config using the shared
      serial integration helper.
- [x] Mirror `@models`, `@services`, `@repositories`, `@types`, and `@utils`
      without claiming this relative-import spec exercises them.
- [x] Run both reporters through their package scripts and use the generic
      comparator to match file, full names, statuses, counts, and snapshots.
- [x] Confirm exact one-file/nine-test/zero-snapshot parity with no skip/todo.
- [x] Strictly typecheck the Vitest config and build Auth Emailpass.
- [x] Keep the remaining-Jest inventory byte-identical rather than adding a new
      Jest-calling foundation verifier.
- [x] Run workspace policy and the complete shared test-runner foundation.
- [x] Record that PostgreSQL, PGlite, Redis, workerd, D1, and hosted CI are not
      claimed by this mocked local shadow.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed shadow.

Result:

- Jest remains the package integration default; Vitest 4.1.10 is available only
  through `test:integration:vitest`;
- both runners discover only
  `integration-tests/__tests__/services.spec.ts` and report the same nine full
  names/statuses with zero snapshots;
- the unchanged source digest is
  `6892c74183528270d00d64bce8c0769a165aada8d45c8b3c64e819ca81689645`,
  retaining 19 root assertions and bridge-supported `fn`, `restoreAllMocks`, and
  `setTimeout` ownership;
- the unchanged Jest-config digest is
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`;
- package build, strict config typecheck, workspace policy, and the complete
  runner foundation pass;
- the remaining-Jest inventory stays at digest
  `e9332f849f83ce9f748f191aef3bb82c145e5a971480aab93c00e8835a77b444`,
  with 68 configs, 115 scripts, and 406 active API files;
- the suite uses only local fakes and CPU-local scrypt. No external-service,
  Cloudflare runtime, or hosted-CI execution is claimed;
- the one-file suite remains in the generic three-way package lane only because
  Jest is still authoritative. Turn 18 must establish unsharded ownership before
  switching the default.

### Turn 18 - Auth Emailpass Integration Vitest Cut-over

Status: completed locally with Vitest authoritative, an explicit Jest rollback,
and hosted execution of the dedicated job deferred.

Scope:

- repeat exact reporter parity immediately before and after the switch;
- make the proven Vitest command the default, move the byte-identical Jest
  command to `test:integration:jest`, and remove the temporary shadow alias;
- reproduce the one-file/three-shard incompatibility with a real Vitest run;
- exclude Auth from the generic sharded lane and assign one dedicated unsharded
  default-only CI job with stable aggregate propagation;
- freeze package, source/config, root-command, workflow, and inventory ownership
  without adding another Jest-calling verifier.

Checklist:

- [x] Repeat exact pre-cut-over Jest/Vitest JSON parity at one file, nine tests,
      every full name/status, and zero snapshots.
- [x] Preserve the normalized-LF source and Jest-config hashes and freeze the
      Vitest-config hash.
- [x] Switch only the package script keys; keep the unit lane absent and the
      Jest rollback command byte-identical.
- [x] Reproduce the real `--shard=1/3` Vitest failure for one discovered file.
- [x] Exclude Auth from the fast package graph while retaining it once in the
      unsharded all-packages graph.
- [x] Add a no-service, non-matrix dedicated job that runs only the Vitest
      default and consumes the existing setup/build artifacts.
- [x] Propagate Auth success, failure, cancellation, and skip through the stable
      package aggregate.
- [x] Freeze the exact cut-over and CI shape in the strict parsed-workflow
      tooling contract.
- [x] Refresh the exact inventory with only the manifest-key ownership move and
      no new foundation Jest invocation owner.
- [x] Run direct default/rollback tests, package build, strict tooling,
      workspace policy, Turbo dry graphs, inventory, and the full foundation.
- [x] Record that external services, Cloudflare runtime gates, and hosted CI are
      not applicable or not yet claimed.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed cut-over.

Result:

- Vitest 4.1.10 is now authoritative through `test:integration`; the exact Jest
  command is retained at `test:integration:jest`, and the shadow alias is gone;
- both runners still report one file, nine passed tests, zero skipped/todo, and
  zero snapshots with exact full-name parity;
- normalized-LF hashes are frozen for the unchanged source
  (`6892c74183528270d00d64bce8c0769a165aada8d45c8b3c64e819ca81689645`),
  unchanged Jest config
  (`5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`),
  and Vitest config
  (`3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`);
- the fast dry graph contains 56 tasks, excludes Auth and Currency, and retains
  API Key; the all-packages graph contains Auth once with its Vitest command;
- the dedicated `auth-emailpass-integration` job is unsharded, runner-neutral,
  service-free, and represented in both aggregate result branches;
- the exact inventory digest is now
  `f6a6a113dce80c75fcc951b80c60bc55e5012d7f4d72cf728638504af4c10570`.
  Counts remain 68 configs, 115 scripts, and 406 active API files;
- the complete runner foundation passes, including strict typechecking, eight
  tooling tests, five-file shared parity, 25 Jest-default integration lanes,
  and exact three-file/34-test adapter parity;
- no assertion, source, dependency, lockfile, persistence, production runtime,
  or Cloudflare bundle behavior changed. The new workflow has a local contract
  proof only; its first hosted result remains deferred.

### Turn 19 - Auth GitHub Empty Unit Lane Retirement

Status: completed as a zero-test ownership decision. No Vitest parity,
integration shadow, or package-default cut-over is claimed.

Scope:

- repeat direct unit discovery against the inherited
  `test: jest --passWithNoTests src` command and inspect the actual `src` tree;
- retire only that empty manifest key without inventing an empty Vitest lane or
  meaningless Jest rollback;
- preserve the exact integration command, active Jest config, integration
  assertions, provider source, package dependencies, root scripts, and workflow;
- prove the package/root unit graph safely converts the empty command to a
  non-executable marker while the generic integration lane remains valid.

Checklist:

- [x] Prove the pre-edit package unit command and direct Jest list discover zero
      files and exit zero only through `--passWithNoTests`.
- [x] Confirm the current and migration-baseline `src` trees contain only two
      production files and no unit assertion source.
- [x] Remove only the empty `test` key without adding a Vitest replacement or
      Jest rollback alias.
- [x] Keep `test:integration` and `jest.config.js` byte-identical and record
      their active TypeScript/MSW transform ownership.
- [x] Run the unchanged integration lane before and after at one suite, nine
      tests, and zero snapshots.
- [x] Freeze the unchanged integration-source and Jest-config hashes and record
      nine `it`, nine `expect`, and no skip/todo/snapshot ownership.
- [x] Prove post-edit unit discovery remains empty and the correctly filtered
      root command selects only Auth GitHub while executing zero tasks.
- [x] Confirm Turbo retains one `<NONEXISTENT>` Auth GitHub unit graph marker and
      the general graph remains 83 nodes at 70 executable/13 markers.
- [x] Confirm the fast integration graph retains the exact Jest lane and all
      three existing shards remain valid.
- [x] Accept exactly one removed inventory entry, no additions, and no other
      ownership-count change.
- [x] Run package build, workspace policy, exact inventory, and the complete
      shared test-runner foundation.
- [x] Record why external-service, persistence, workerd, D1, and Cloudflare
      results are not applicable to this manifest-only turn.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed retirement.

Result:

- Auth GitHub no longer advertises a unit lane with zero files or assertions;
  this retires nonexistent coverage rather than migrating it;
- the active Jest integration lane remains exact at one suite, nine tests, nine
  `expect` calls, and zero snapshots, with normalized-LF source SHA-256
  `1679ec9a5a3da285a95ac0d170f9376f661a6d3f1c076199baa196e75aab42c8`;
- `jest.config.js` remains active at normalized-LF SHA-256
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`
  because the integration lane consumes its Node/SWC/MSW transform boundary;
- the real root unit run executes zero tasks, the scoped dry graph keeps a
  `<NONEXISTENT>` marker, and the general unit graph is 83/70/13;
- the generic fast integration graph remains 56 tasks and owns Auth GitHub once;
  its current Jest shards pass at 9/0/0 tests, so CI ownership is unchanged;
- the remaining-Jest digest is
  `db9dd73f0c2a73589e8d50bc0f1a9f71923b3ecbec0c11a047f91b22a74f5ab9`;
  script entries move 115 to 114 while all other counts remain unchanged;
- no test/production source, integration command, Jest config, dependency,
  root/workflow, persistence, runtime, or Cloudflare boundary changed. Local
  unit graph proof passes; hosted unit-matrix execution remains deferred.

### Turn 20 - Auth GitHub Integration Vitest Shadow

Status: completed as an opt-in integration shadow with Jest still authoritative.

Scope:

- keep the exact Jest `test:integration` command and active Jest config
  unchanged;
- add only a `test:integration:vitest` script and package-local shared-profile
  config;
- preserve the five package alias mappings, MSW transform/runtime boundary, and
  one-file discovery without changing the specification;
- compare exact JSON results rather than treating matching counts as parity;
- do not switch the default, add root/CI ownership, or change dependencies.

Checklist:

- [x] Capture the pre-edit Jest discovery and exact one-file/nine-test result.
- [x] Freeze normalized-LF hashes for the spec, Jest config, and new Vitest
      config.
- [x] Audit all Jest APIs and confirm they fit the existing compatibility bridge.
- [x] Confirm the shared profile already handles `msw` and `until-async` through
      its inline SWC boundary.
- [x] Add only `test:integration:vitest`; keep `test:integration` byte-identical.
- [x] Add a strict package-local Vitest integration config with one explicit
      include and all five aliases.
- [x] Compare pre-edit Jest, post-edit Jest, and post-edit Vitest JSON results.
- [x] Confirm exact file/full-name/status parity at nine tests and zero
      snapshots, skips, todos, or failures.
- [x] Prove unsharded Vitest listing contains exactly the nine expected tests,
      Vitest exits naturally, and a separate no-`forceExit` Jest probe is clean.
- [x] Record the real one-file Vitest shard failure as future cut-over evidence
      without changing CI in the shadow.
- [x] Strictly typecheck only the new config and build Auth GitHub; do not mix in
      legacy spec/source typing changes.
- [x] Keep root tooling, workflow, fast graph, Jest shards, and remaining-Jest
      inventory unchanged.
- [x] Run workspace policy and the complete shared test-runner foundation.
- [x] Record that external services, Cloudflare runtime gates, and hosted CI are
      not claimed by this local opt-in shadow.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed shadow.

Result:

- Jest remains the package integration default; Vitest 4.1.10 is available only
  through `test:integration:vitest`;
- all three reporter outputs resolve one file, nine passed tests, identical
  full names/statuses, and zero snapshots/skips/todos/failures;
- the unchanged source, unchanged Jest config, and new Vitest config hashes are
  `1679ec9a5a3da285a95ac0d170f9376f661a6d3f1c076199baa196e75aab42c8`,
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`,
  and `3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`;
- the shared compatibility/MSW boundary covers 11 `fn`, one
  `restoreAllMocks`, one `setTimeout`, and intercepted GitHub HTTP traffic;
- standalone strict config typecheck, package build, workspace policy, and the
  complete runner foundation pass;
- the remaining-Jest inventory stays byte-identical at
  `db9dd73f0c2a73589e8d50bc0f1a9f71923b3ecbec0c11a047f91b22a74f5ab9`,
  with 68 configs, 114 scripts, and 406 active API files;
- root/CI ownership and existing Jest shards remain unchanged. The real Vitest
  1/3 shard failure is deferred to the separate cut-over design;
- no assertion, source, dependency, lockfile, persistence, production runtime,
  or Cloudflare bundle behavior changed, and no hosted result is claimed.

### Turn 21 - Auth GitHub Integration Vitest Cut-over

Status: completed locally with Vitest authoritative, an explicit Jest rollback,
and hosted execution of the dedicated job deferred.

Scope:

- repeat exact reporter parity immediately before and after the switch;
- make the proven Vitest command the default, move the byte-identical Jest
  command to `test:integration:jest`, and remove the shadow alias;
- reproduce the one-file/three-shard incompatibility through the real Turbo
  forwarding boundary;
- exclude Auth GitHub from the generic fast lane and assign one dedicated
  unsharded default-only job with stable aggregate propagation;
- add persistent strict typecheck ownership and freeze the complete boundary
  without adding another Jest-calling verifier.

Checklist:

- [x] Repeat pre-cut-over and post-cut-over exact JSON parity at one file, nine
      tests, every full name/status, and zero snapshots.
- [x] Preserve the source/Jest/Vitest normalized-LF hashes and assertion/API
      surface.
- [x] Switch only the package script keys; keep the unit lane absent and the
      Jest rollback byte-identical.
- [x] Reproduce the real workflow-shaped `--shard=1/3` Vitest failure.
- [x] Exclude Auth GitHub from the fast graph while retaining it once in the
      unsharded all-packages graph.
- [x] Add a no-service, non-matrix dedicated job that runs only the Vitest
      default and consumes existing setup/build artifacts.
- [x] Propagate Auth GitHub success, failure, cancellation, and skip through the
      stable package aggregate.
- [x] Add the config once to persistent strict root tooling typecheck.
- [x] Freeze package, hash, root-command, typecheck, job, and aggregate ownership
      through the narrowed parsed-workflow contract.
- [x] Refresh the exact inventory with only the manifest-key move and no new
      foundation Jest invocation owner.
- [x] Run direct default/rollback tests, package build, strict tooling, workspace
      policy, Turbo graphs, inventory, and the complete foundation.
- [x] Record that external services, Cloudflare runtime gates, and hosted CI are
      not applicable or not yet claimed.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed cut-over.

Result:

- Vitest 4.1.10 is authoritative through `test:integration`; the exact Jest
  command is retained at `test:integration:jest`, and the shadow alias is gone;
- pre/post comparisons remain one file, nine passed tests, zero
  failed/skipped/todo, and zero snapshots with exact full-name parity;
- normalized-LF source/Jest/Vitest hashes stay
  `1679ec9a5a3da285a95ac0d170f9376f661a6d3f1c076199baa196e75aab42c8`,
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`,
  and `3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`;
- the fast dry graph contains 55 tasks, excludes Auth GitHub/Auth Emailpass/
  Currency, and retains API Key. The 63-task all-packages graph contains Auth
  GitHub once with its Vitest command;
- the dedicated `auth-github-integration` job is unsharded, runner-neutral,
  service-free, and represented in both aggregate result branches;
- strict root typecheck and the permanent tooling contract own the config and
  complete CI boundary;
- the inventory digest is
  `da4fc00cdf717ab98a8fc75b189aa4ce868d3a623c19d56a07a9c8f2418ee365`;
  counts remain 68 configs, 114 scripts, and 406 active API files;
- the complete foundation passes strict tooling, eight tooling tests, five-file
  parity, 25 integration selectors, and exact three-file/34-test adapter parity;
- no assertion, source, dependency, lockfile, persistence, production runtime,
  or Cloudflare bundle behavior changed. Hosted execution remains deferred.

### Turn 22 - Auth Google Empty Unit Lane Retirement

Status: completed as a zero-test ownership decision. No Vitest parity,
integration shadow, or package-default cut-over is claimed.

Scope:

- repeat direct unit discovery against the inherited
  `test: jest --passWithNoTests src` command and inspect the actual `src` tree;
- retire only that empty manifest key without inventing an empty Vitest lane or
  meaningless Jest rollback;
- preserve the exact integration command, active Jest config, assertions,
  provider source, dependencies, root scripts, and workflow;
- prove the unit graph safely converts the empty command to a non-executable
  marker while the generic integration lane remains valid.

Checklist:

- [x] Prove the pre-edit unit command and direct Jest list discover zero files
      and exit zero only through `--passWithNoTests`.
- [x] Confirm the current and migration-baseline `src` trees contain only two
      production files and no unit assertion source.
- [x] Remove only the empty `test` key without adding a Vitest replacement or
      Jest rollback alias.
- [x] Keep `test:integration` and `jest.config.js` byte-identical and record
      their active TypeScript/MSW ownership.
- [x] Run the unchanged integration lane before and after at one suite, nine
      tests, and zero snapshots.
- [x] Freeze the integration-source and Jest-config hashes plus the unchanged
      assertion/API surface.
- [x] Prove post-edit unit discovery remains empty and the filtered root command
      selects only Auth Google while executing zero tasks.
- [x] Confirm Turbo retains one `<NONEXISTENT>` unit marker and the general graph
      remains 83 nodes at 69 executable/14 markers.
- [x] Confirm the 55-task fast graph retains the exact Jest integration command
      and all three existing shards remain valid at 9/0/0 tests.
- [x] Accept exactly one removed inventory entry, no additions, and no other
      ownership-count change.
- [x] Run package build, workspace policy, exact inventory, and the complete
      shared foundation.
- [x] Record why external-service, persistence, workerd, D1, and Cloudflare
      results are not applicable to this manifest-only turn.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed retirement.

Result:

- Auth Google no longer advertises a unit lane with zero files or assertions;
  this retires nonexistent coverage rather than migrating it;
- the active Jest integration remains exact at one suite, nine tests, nine
  `expect`, and zero snapshots, with normalized-LF source SHA-256
  `3ac8100ddd8f69b15c8161dfb1ebd2fbe681d195f1577eaf790e24a198d19a4d`;
- `jest.config.js` remains active at normalized-LF SHA-256
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`
  because the integration consumes its Node/SWC/MSW boundary;
- the root unit run executes zero tasks, the scoped dry graph keeps a
  `<NONEXISTENT>` marker, and the general unit graph is 83/69/14;
- the fast integration graph remains 55 tasks and owns Auth Google once; its
  current Jest shards pass at 9/0/0 tests, so CI ownership is unchanged;
- the inventory digest is
  `919869b4243bfb9c8f3aee498ba2456c5a8720f30f697ecc3f270eff5c3c491f`;
  script entries move 114 to 113 while all other counts remain unchanged;
- no assertion, test/production source, integration command, Jest config,
  dependency, root/workflow, persistence, runtime, or Cloudflare boundary
  changed. Local graph proof passes; hosted unit-matrix execution is deferred.

### Turn 23 - Auth Google Integration Vitest Shadow

Status: completed as an opt-in integration shadow with Jest still
authoritative.

Scope:

- keep the exact Jest `test:integration` command and active Jest config
  unchanged;
- add only a direct `test:integration:vitest` command and package-local shared
  profile config;
- preserve the five alias mappings, serial Node/MSW setup, source assertions,
  dependencies, root tooling, and workflow;
- prove exact reporter parity plus Google-specific Vite/Rolldown imports without
  switching the default or pre-staging CI ownership.

Checklist:

- [x] Confirm Vite 8.1.4 and Vitest 4.1.10 are both installed and current on the
      package registry.
- [x] Capture pre-edit Jest discovery and the exact one-file/nine-test reporter
      result.
- [x] Keep `test:integration` byte-identical and add only
      `test:integration:vitest`.
- [x] Add one strict package-local config using the shared serial Node profile,
      all five aliases, and the sole explicit integration include.
- [x] Freeze normalized-LF hashes for the unchanged spec, unchanged Jest config,
      and new Vitest config.
- [x] Compare pre-edit Jest, post-edit Jest, and Vitest JSON by file, every full
      test name/status, counts, and snapshots.
- [x] Prove exactly nine unsharded Vitest discoveries and natural MSW cleanup;
      separately run Jest without `--forceExit` under open-handle detection.
- [x] Exercise bare Node `crypto`, CommonJS `jsonwebtoken`, framework JWT
      generation, JWT decoding, and MSW through Vite/Rolldown.
- [x] Reproduce the real one-file Vitest `--shard=1/3` failure as future cut-over
      evidence without changing CI in the shadow.
- [x] Confirm fast/all integration graphs remain 55/63 with Auth Google exactly
      once on the Jest default and existing shards still passing 9/0/0.
- [x] Run standalone strict config typecheck, package build, workspace policy,
      exact unchanged inventory, and the complete shared foundation.
- [x] Record that persistence, external-service, workerd, D1, Cloudflare, and
      hosted CI evidence is not applicable to this local Node shadow.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed shadow.

Result:

- Jest remains the package default; Vitest is available only through the opt-in
  `test:integration:vitest` command;
- pre-edit Jest, post-edit Jest, and Vitest each resolve one file, nine passed
  tests, identical full names/statuses, and zero failures/skips/todos/snapshots;
- the source, Jest config, and Vitest config normalized-LF hashes are
  `3ac8100ddd8f69b15c8161dfb1ebd2fbe681d195f1577eaf790e24a198d19a4d`,
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`,
  and `3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`;
- Vite 8.1.4/Rolldown and Vitest 4.1.10 load the Google crypto/JWT/framework
  path and MSW lifecycle unchanged, and both runners exit naturally in the
  dedicated cleanup probes;
- fast/all graphs remain 55/63 with Auth Google once on Jest; existing Jest
  shards pass 9/0/0 while the real Vitest 1/3 shard fails closed;
- the inventory remains byte-identical at digest
  `919869b4243bfb9c8f3aee498ba2456c5a8720f30f697ecc3f270eff5c3c491f`,
  with 68 configs, 113 scripts, and 406 active API files;
- strict config typecheck, package build, workspace policy, inventory, and the
  complete shared foundation pass;
- no root/tooling contract, workflow, CI, dependency, lockfile, source,
  persistence, runtime, or Cloudflare boundary changed, and no hosted result is
  claimed.

### Turn 24 - Auth Google Integration Vitest Cut-over

Status: completed locally with Vitest authoritative, an explicit Jest rollback,
and hosted execution of the dedicated job deferred.

Scope:

- repeat exact reporter parity immediately before and after changing ownership;
- make the proven Vitest command the default, move the byte-identical Jest
  command to `test:integration:jest`, and remove the shadow alias;
- exclude the one-file Vitest lane from the generic three-way shard and add one
  dedicated service-free unsharded CI job;
- propagate every terminal job state through the package aggregate and add
  permanent strict tooling/contract ownership.

Checklist:

- [x] Capture pre-cut-over Jest/Vitest reporters and prove one-file/nine-test
      parity with zero snapshots.
- [x] Switch only package script ownership while retaining the exact Jest
      command and absent unit lane.
- [x] Preserve the source, Jest config, Vitest config, aliases, assertions,
      dependencies, and lockfile byte-for-byte.
- [x] Compare pre/post Jest rollback, pre/post Vitest default, and post-cut-over
      runners by every full name/status and snapshot summary.
- [x] Reproduce the real one-file Vitest `--shard=1/3` failure and exclude Auth
      Google from the generic fast lane.
- [x] Add one unsharded `auth-google-integration` job with no matrix, services,
      environment, database, Redis, or worker flags.
- [x] Propagate Google success, failure, cancellation, and skip through the
      stable package aggregate.
- [x] Add the config exactly once to persistent strict root typecheck and freeze
      the full package/root/workflow/hash boundary in the typed contract.
- [x] Confirm the fast graph is 54 tasks with Google absent and the all-packages
      graph is 63 tasks with Google once on Vitest.
- [x] Refresh only the reviewed Jest manifest-key move and keep every inventory
      count unchanged.
- [x] Run default/rollback commands, nine-test listing, package build, rollback
      shards, strict tooling, eight contract tests, workspace policy, inventory,
      and the complete shared foundation.
- [x] Record that external services, Cloudflare runtime gates, and hosted CI are
      not claimed by local workflow-shape proof.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed cut-over.

Result:

- Vitest 4.1.10 is authoritative through `test:integration`; the exact Jest
  command is retained at `test:integration:jest`, and the shadow alias is gone;
- pre/post reporters remain one file, nine passed tests, identical full
  names/statuses, and zero failures/skips/todos/snapshots;
- normalized-LF source/Jest/Vitest hashes remain
  `3ac8100ddd8f69b15c8161dfb1ebd2fbe681d195f1577eaf790e24a198d19a4d`,
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`,
  and `3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`;
- the fast/all graphs are 54/63; Auth Google is absent from the fast shard and
  appears once on Vitest in the unsharded all-packages graph;
- dedicated `auth-google-integration` is unsharded, runner-neutral, and
  service-free, with all terminal states represented by the aggregate;
- strict root typecheck and the no-`any` parsed contract own the config, scripts,
  hashes, graph filters, job shape, and aggregate propagation;
- the inventory digest is
  `b20c248031f53a5c0704505f278e3215313d99624fdde7484e0e8fb8684b462a`,
  with 68 configs, 113 scripts across 68 owners, and 406 active API files;
- package/default/rollback, rollback shards at 9/0/0, build, strict tooling,
  workspace policy, inventory, and the complete foundation pass;
- no assertion, source, dependency, lockfile, persistence, production runtime,
  or Cloudflare bundle behavior changed. Hosted execution remains deferred.

### Turn 25 - File Local Empty Unit Lane Retirement

Status: completed as a zero-test ownership decision. No Vitest parity,
integration shadow, or package-default cut-over is claimed.

Scope:

- repeat direct unit discovery against the inherited
  `test: jest --passWithNoTests src` command and compare the migration-baseline
  and current `src` trees;
- retire only that empty manifest key without inventing a Vitest lane or
  meaningless Jest rollback;
- preserve the exact filesystem integration command, active Jest config, spec,
  JPEG fixture, source, dependencies, root scripts, and workflow;
- prove the unit graph converts the empty task to a marker while the substantive
  integration lane and its cleanup remain valid.

Checklist:

- [x] Prove the pre-edit unit command and direct Jest listing discover zero files
      and pass only through `--passWithNoTests`.
- [x] Confirm baseline/current `src` trees contain exactly two production files
      and no unit assertion source.
- [x] Remove only the empty `test` key without adding an empty Vitest replacement
      or Jest rollback alias.
- [x] Keep `test:integration`, `jest.config.js`, the spec, fixture, source, and
      two pre-existing `as any` boundaries byte-identical.
- [x] Run the filesystem integration before and after at one suite, two tests,
      ten direct expectations, and zero snapshots.
- [x] Freeze hashes for the integration source, Jest config, and binary fixture.
- [x] Prove created files and the uploads directory are removed and no network or
      external service is required.
- [x] Confirm the filtered root command executes zero tasks, scoped Turbo keeps
      one marker, and the general unit graph moves to 83/68/15.
- [x] Confirm fast/all integration graphs remain 54/63 with File Local once on
      Jest and authentic forwarded shards pass 2/0/0.
- [x] Accept exactly one removed inventory entry, no additions, and no other
      ownership-count change.
- [x] Run package build, workspace policy, exact inventory, and the complete
      shared foundation.
- [x] Record why database, Redis, network, workerd, D1, and Cloudflare results do
      not apply to this manifest-only turn.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed retirement.

Result:

- File Local no longer advertises a unit lane with zero files or assertions;
  this retires nonexistent coverage rather than migrating it;
- its active Jest integration remains exact at one file, two tests, ten direct
  `expect` calls, one `jest.setTimeout`, and zero snapshots, with source hash
  `a71b84503c0c2214552e4705b8094c7bb3bd930b683a9c92d15c6e5eb5aa4a01`;
- Jest config and binary fixture hashes remain
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`
  and `68ca5bf09d8850ea11adc9f6a1dd0660dc52a4ec900a5f9cfb718673a2e01268`;
- the root unit run executes zero tasks, scoped Turbo keeps a marker, and the
  general unit graph is 83/68/15;
- fast/all integration graphs remain 54/63, own File Local once on Jest, and its
  real forwarded shards pass 2/0/0 with filesystem cleanup complete;
- the inventory digest is
  `51374a391ab1c1226af20bf875439a3198c1a61525859332425a6a3ff92bf9cd`;
  scripts move 113 to 112 while every other count remains unchanged;
- no assertion, source, fixture, integration command, Jest config, dependency,
  root/workflow, persistence, runtime, or Cloudflare boundary changed. Local
  graph proof passes; hosted unit-matrix execution is deferred.

### Turn 26 - File Local Integration Vitest Shadow

Status: completed as an opt-in integration shadow with Jest still authoritative.

Scope:

- keep the exact Jest integration command/config and assertion source unchanged;
- add only a direct `test:integration:vitest` command and package-local shared
  profile config;
- make the test's direct `@medusajs/utils` import an explicit `workspace:*` dev
  dependency with the matching importer-only lockfile edge;
- preserve package-root fixture/upload behavior and prove exact filesystem
  parity without switching CI ownership.

Checklist:

- [x] Capture pre-edit Jest discovery and exact one-file/two-test reporter
      output, plus natural cleanup without `--forceExit`.
- [x] Keep `test:integration`, Jest config, spec, fixture, source, assertions,
      and existing test typing boundaries byte-identical.
- [x] Add only `test:integration:vitest` and one shared-profile config with an
      explicit one-file include and package-root `process.cwd()` boundary.
- [x] Replace accidental root-hoist resolution with a declared test-only
      `@medusajs/utils: workspace:*` devDependency and exact lock importer link.
- [x] Freeze hashes for the spec, Jest config, Vitest config, and fixture.
- [x] Compare pre-edit Jest, post-edit Jest, and Vitest JSON by file, both full
      names/statuses, counts, and snapshots.
- [x] Exercise Node filesystem reads/writes, writable streams, Buffer, URL,
      fixture discovery, deletion, and recursive cleanup through Vite/Rolldown.
- [x] Prove unsharded Vitest lists exactly two tests, both runners exit naturally,
      and no uploads directory or open handle remains.
- [x] Reproduce all three one-file Vitest shard failures as future cut-over
      evidence without changing CI in this shadow.
- [x] Confirm unit and fast/all graphs remain 83/68/15 and 54/63 with File Local
      once on the Jest default.
- [x] Run standalone strict config typecheck, package build, workspace policy,
      unchanged inventory, and the complete shared foundation.
- [x] Record the timed-out frozen offline install attempts without claiming a
      passing install gate.
- [x] Record why external-service, persistence, workerd, D1, and Cloudflare
      results do not apply to this local Node shadow.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed shadow.

Result:

- Jest remains the package integration default; Vitest is available only through
  `test:integration:vitest`;
- pre-edit Jest, post-edit Jest, and Vitest each resolve one file, two passed
  tests, identical full names/statuses, and zero failures/skips/todos/snapshots;
- source/Jest-config/Vitest-config/fixture hashes remain
  `a71b84503c0c2214552e4705b8094c7bb3bd930b683a9c92d15c6e5eb5aa4a01`,
  `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`,
  `3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`,
  and `68ca5bf09d8850ea11adc9f6a1dd0660dc52a4ec900a5f9cfb718673a2e01268`;
- Vite 8.1.4/Rolldown and Vitest 4.1.10 execute the package-root filesystem,
  stream, Buffer, fixture, URL, and cleanup path unchanged;
- the direct utils edge is now declared and lock-parsed as
  `workspace:* -> link:../../../core/utils`; the package-local junction targets
  that workspace;
- all three Vitest shards fail closed, while graphs remain 83/68/15 and 54/63
  with Jest still authoritative;
- inventory stays byte-identical at
  `51374a391ab1c1226af20bf875439a3198c1a61525859332425a6a3ff92bf9cd`,
  with 68 configs, 112 scripts, and 406 active API files;
- strict config typecheck, build, workspace policy, inventory, and the complete
  foundation pass. Frozen offline install attempts time out without a mismatch
  and are not claimed as passing;
- no assertion, source, fixture, root/tooling contract, workflow, CI,
  persistence, production runtime, or Cloudflare boundary changed.

### Turn 27 - File Local Integration Vitest Cut-Over

Status: locally completed with hosted CI confirmation deferred.

Scope:

- switch File Local's integration default to the proven Vitest command;
- retain the exact Jest command as `test:integration:jest` and remove only the
  temporary shadow alias;
- exclude the one-file Vitest lane from the generic three-way fast shard and
  give it dedicated unsharded service-free CI ownership;
- make package scripts, root filters/typecheck, workflow aggregation, immutable
  hashes, and the explicit utils dependency persistent typed-contract owners.

Checklist:

- [x] Capture the committed Jest default and Vitest shadow reporters before the
      edit and prove exact one-file/two-test parity.
- [x] Move the exact Jest command to `test:integration:jest`, promote Vitest to
      `test:integration`, and remove `test:integration:vitest`.
- [x] Preserve the retired unit lane, spec, Jest/Vitest configs, source, fixture,
      assertions, legacy typing boundaries, utils dev dependency, and lockfile.
- [x] Compare pre-edit Jest, post-edit Jest rollback, and post-edit Vitest default
      by file, both full names/statuses, counts, and snapshots.
- [x] List exactly two Vitest tests and prove successful runs leave no uploads
      directory.
- [x] Reproduce all three real Vitest shard failures and prove the retained Jest
      rollback shards pass 2/0/0.
- [x] Exclude File Local from the generic fast command while retaining it once
      in the all-packages command.
- [x] Add an unsharded `file-local-integration` job with setup/cache/artifact
      flow, no services/environment/strategy, and aggregate result propagation.
- [x] Add the config to persistent strict typecheck and extend the parsed tooling
      contract without `any` or weak assertions.
- [x] Confirm general/serial unit graphs remain 83/68/15 and 2/2/0; confirm
      fast/all integration graphs become 53/63.
- [x] Accept only the File Local inventory-key move with unchanged counts and
      digest `47a7f12afdddc0caeb2123cc74ac21c16f7a261b9b9e910967f699022df9715b`.
- [x] Run package build, workspace policy, exact inventory, tooling typecheck,
      all eight tooling tests, and the complete shared foundation.
- [x] Record why persistence, external-service, workerd, D1, Cloudflare, and
      hosted results are not claimed.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed cut-over.

Result:

- File Local now defaults to Vite 8.1.4 with built-in Rolldown and Vitest
  4.1.10; the byte-identical Jest command remains an explicit rollback;
- all three reporter comparisons resolve one file, two passed tests, identical
  full names/statuses, and zero failures/skips/todos/snapshots;
- the package-root filesystem/stream/Buffer/URL/fixture/delete/cleanup behavior
  stays unchanged and every successful run leaves no uploads directory;
- all three Vitest shards fail closed, while Jest rollback shards pass 2/0/0;
- the dedicated unsharded service-free job and aggregate propagation are owned
  by the strict parsed workflow contract; its hosted result remains deferred;
- general/serial unit graphs remain 83/68/15 and 2/2/0. Fast integration moves
  54 to 53 with File Local excluded; all-packages remains 63 with File Local
  once on Vitest;
- remaining-Jest counts stay 68 configs, 112 scripts across 68 owners, and 406
  active API files at digest
  `47a7f12afdddc0caeb2123cc74ac21c16f7a261b9b9e910967f699022df9715b`;
- strict tooling, eight contract tests, build, workspace policy, inventory, and
  the complete foundation pass;
- no dependency, lockfile, assertion, source, fixture, persistence, production
  runtime, or Cloudflare bundle behavior changed.

### Turn 28 - File S3 Empty Unit Lane Retirement

Status: completed as a zero-test ownership decision. No Vitest parity,
integration shadow, or package-default cut-over is claimed.

Scope:

- repeat direct unit discovery against `test: jest --passWithNoTests src` and
  compare migration-baseline/current File S3 source ownership;
- retire only that empty manifest key without inventing a Vitest lane or Jest
  rollback;
- preserve the separate manual S3 integration lane and every source, fixture,
  dependency, lockfile, root, workflow, and runtime boundary;
- record the wholly skipped live-service integration surface honestly rather
  than presenting it as passing S3 behavior.

Checklist:

- [x] Prove the package unit command and direct Jest listing discover zero files
      and pass only through `--passWithNoTests`.
- [x] Prove the same `src` target exits 1 without `--passWithNoTests` after four
      files are checked.
- [x] Confirm baseline/current `src` trees are identical with exactly two
      production files and no unit assertion source.
- [x] Remove only the empty `test` key; add no empty Vitest replacement or Jest
      rollback.
- [x] Keep the Jest integration command/config, spec, JPEG fixture, source,
      dependencies, lockfile, root scripts, workflow, and tooling unchanged.
- [x] Freeze both source hashes plus integration spec/config/fixture hashes.
- [x] Compare pre/post Jest integration reporters at one skipped suite, eight
      skipped tests, and zero snapshots.
- [x] Prove authentic Jest integration shards remain 8 skipped/0/0.
- [x] Record that no assertion executes and no S3/network/credential behavior is
      proven because the entire suite is `describe.skip`.
- [x] Confirm the scoped root command executes zero tasks and general/serial unit
      graphs become 83/67/16 and remain 2/2/0.
- [x] Confirm fast/all integration graphs remain 53/63 with File S3 once on Jest.
- [x] Accept exactly one removed inventory entry, scripts 112 to 111, and no
      other ownership-count change.
- [x] Run package build, workspace policy, exact inventory, and the complete
      shared foundation.
- [x] Record the live cleanup/open-handle and undeclared Axios boundaries for the
      later integration shadow.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed retirement.

Result:

- File S3 no longer advertises a unit lane with zero files or assertions;
- migration-baseline/current source ownership remains the exact two-file
  production tree, with source hashes
  `8aa40ba11e48a0f334da9a46c79ec0deed63b1b402aa9b697b3e286349c141d6`
  and `54951de5968ecdaf7606e8133f717ae87ca14349e2fab6e487d13839715d2ee1`;
- the separate integration remains byte-identical and Jest-authoritative at one
  skipped suite, eight skipped tests, zero executed assertions/snapshots, and
  authentic shard distribution 8/0/0;
- general/serial unit graphs become 83/67/16 and remain 2/2/0; fast/all
  integration graphs remain 53/63;
- the inventory digest becomes
  `f7cba2d34e540fdf98b6ffee7257b671202c6e978531e59fc3bad8d6244d30c5`,
  with 68 configs, 111 scripts across 68 owners, and 406 active API files;
- build, workspace policy, inventory, graph/reporter/shard proof, and the
  complete foundation pass;
- no integration assertion, source, config, fixture, dependency, lockfile,
  root/workflow, external service, production runtime, or Cloudflare boundary
  changed.

### Turn 29 - File S3 Integration Vitest Shadow

Status: completed as an opt-in runner shadow. Jest remains authoritative and no
live S3 behavior or package-default cut-over is claimed.

Scope:

- keep the exact Jest integration command as `test:integration` and add only an
  opt-in `test:integration:vitest` command;
- reuse the shared package-root serial Node integration profile for the sole
  File S3 spec and preserve all five existing aliases;
- replace root-hoist dependency masking with explicit test-only Axios ownership
  and an importer-only lock edge;
- preserve the whole-suite skip, every assertion/name/fixture/source/config
  boundary, and all root, workflow, persistence, and runtime ownership.

Checklist:

- [x] Record the fresh pre-edit Jest reporter and exact eight-name sequence.
- [x] Add the opt-in Vitest script and typed package-local integration config.
- [x] Add `axios: ^1.13.1` to File S3 dev dependencies and resolve the existing
      `axios@1.13.2` only in its lock importer.
- [x] Keep the exact Jest default command, integration spec, Jest config, JPEG
      fixture, source, root scripts, workflow, and tooling contract unchanged.
- [x] Compare pre-edit Jest, post-edit Jest, and Vitest reporters at one file,
      eight skipped tests, zero passed/failed/todo tests, and zero snapshots.
- [x] Confirm exact full-name/status order, including the duplicate
      public/private parameterized name.
- [x] Confirm all six `S3_TEST_*` values are absent and `describe.skip` prevents
      every hook, assertion, fixture read, service construction, and request.
- [x] Prove Jest shards remain 8 skipped/0/0 and all three real Vitest shards
      fail closed because one file cannot be divided by three.
- [x] Preserve the frozen spec/Jest-config/JPEG/source hashes and record the new
      config hash.
- [x] Pass strict standalone config typecheck, package build, and a targeted
      frozen offline install.
- [x] Confirm general/serial unit graphs remain 83/67/16 and 2/2/0.
- [x] Confirm fast/all integration graphs remain 53/63 with File S3 once on
      Jest.
- [x] Keep the remaining-Jest inventory byte-identical at digest
      `f7cba2d34e540fdf98b6ffee7257b671202c6e978531e59fc3bad8d6244d30c5`.
- [x] Pass workspace policy, formatting, exact inventory, and the complete
      shared foundation.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed shadow.

Result:

- Vite 8.1.4/Vitest 4.1.10 import and collect the unchanged file through the
  shared profile; the config hash is
  `3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`;
- normalized runner results are exact at one file, eight skipped tests, zero
  passed/failed/todo tests, and zero snapshots across all three reporters;
- only module import/collection and top-level `jest.setTimeout` compatibility
  execute. The hook, fixture, service, assertion, credential, AWS/Axios,
  stream, delete, and cleanup paths remain unexecuted and unproven;
- File S3 now owns its direct test-only Axios import explicitly, and the frozen
  install validates the three-line importer-only lock change;
- Jest remains the fast/all graph owner at unchanged 53/63 task counts;
  general/serial unit graphs remain 83/67/16 and 2/2/0;
- inventory stays at 68 configs, 111 scripts across 68 owners, and 406 active
  API files; the full foundation remains green;
- no live service, database, network, workerd, D1, Cloudflare, workflow, hosted
  CI, source, assertion, fixture, or production-runtime result changed.

### Turn 30 - File S3 Integration Vitest Cut-Over

Status: locally completed with hosted CI confirmation deferred. Vitest is the
package default and the exact Jest command remains the rollback lane.

Scope:

- promote the proven Vitest command to `test:integration`, move the unchanged
  Jest command to `test:integration:jest`, and remove the temporary shadow key;
- exclude the one-file Vitest lane from the generic three-way fast shard and add
  dedicated runner-neutral unsharded ownership;
- make package scripts, root commands/typecheck, workflow aggregation, Axios
  placement, and immutable test/config/fixture hashes persistent typed contract
  owners while retaining source hashes as turn evidence;
- preserve all assertions, skip state, source, configs, fixture, dependencies,
  lockfile, production runtime, and Cloudflare boundaries.

Checklist:

- [x] Capture fresh committed Jest-default and Vitest-shadow reporters and prove
      exact one-file/eight-skipped parity before editing.
- [x] Promote Vitest, preserve the Jest command byte-for-byte as rollback, and
      remove only the shadow alias.
- [x] Compare pre-edit Jest, post-edit Jest rollback, and post-edit Vitest
      pairwise by full name/status, counts, and snapshots.
- [x] Record that Vitest list output is empty for the wholly skipped suite and
      use run reporters as the authoritative eight-case proof.
- [x] Reproduce all three real Vitest shard failures and prove Jest rollback
      shards remain 8 skipped/0/0.
- [x] Exclude File S3 from the fast graph while retaining it once in all-packages
      on Vitest.
- [x] Add unsharded `file-s3-integration` with setup/cache/artifact flow, no
      services/environment/strategy, and aggregate terminal-state propagation.
- [x] Add the config exactly once to persistent strict typecheck and extend the
      typed contract without `any`, enums, casts, or weak assertions.
- [x] Preserve Axios as dev-only and keep the existing lock importer unchanged.
- [x] Accept only the Jest inventory-key move with unchanged counts and digest
      `1ac908587ec53d1de09104422e0b9dc34a227119b3e9ca67f96ca5e5d2721447`.
- [x] Confirm general/serial unit graphs remain 83/67/16 and 2/2/0; confirm
      fast/all integration graphs become 52/63.
- [x] Run direct default/rollback commands, package build, workspace policy,
      exact inventory, strict tooling, all eight contract tests, and the full
      foundation.
- [x] Record the skipped live-service and hosted-execution boundaries.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed cut-over.

Result:

- registry and local installations agree on Vite 8.1.4 with built-in Rolldown
  and Vitest 4.1.10; File S3 now defaults to that command with exact Jest
  rollback;
- all three reporter pairings normalize to one file, eight skipped tests, zero
  passed/failed/todo tests, and zero snapshots with exact names/statuses;
- the unsharded default and rollback commands pass, all three Vitest shards fail
  closed, and Jest rollback remains 8/0/0;
- fast/all integration graphs become 52/63, with File S3 absent from fast and
  present once on Vitest in all-packages; unit graphs remain unchanged;
- the dedicated job and aggregate propagation are locally parsed and owned by
  the strict typed contract; hosted execution remains deferred;
- inventory counts stay 68 configs, 111 scripts across 68 owners, and 406 API
  files at the reviewed new digest;
- only import/collection and skip preservation are proven. No hook, fixture,
  service, assertion, credential, AWS/Axios request, stream, delete, cleanup,
  database, workerd, D1, or Cloudflare behavior executes or changes.

### Turn 31 - Notification Local Empty Unit Lane Retirement

Status: completed as a zero-test ownership decision. No Vitest parity,
integration shadow, or package-default cut-over is claimed.

Scope:

- prove the inherited `test: jest --passWithNoTests src` command owns no unit
  files or assertions;
- compare the goal baseline and current two-file production source tree;
- retire only the empty manifest key without adding an empty Vitest lane or Jest
  rollback;
- preserve the separate one-test Jest integration lane and every source,
  config, dependency, lockfile, root, workflow, and runtime boundary.

Checklist:

- [x] Prove the package command and direct Jest list discover zero unit files.
- [x] Prove execution without `--passWithNoTests` exits 1 after four files are
      checked and zero match.
- [x] Confirm baseline/current `src` trees are identical with exactly two
      production files and no tests/assertions/mocks/fixtures/snapshots.
- [x] Remove only the empty `test` key; add no Vitest replacement or rollback.
- [x] Preserve normalized source hashes and the integration spec/config hashes.
- [x] Compare pre/post integration reporters at one file, one passing test,
      exact full name/status, and zero snapshots.
- [x] Prove authentic integration shards remain 1/0/0 and a no-force-exit
      diagnostic terminates without an open-handle report.
- [x] Confirm the integration remains a local console-spy test with no external
      service, database, filesystem, environment, or network dependency.
- [x] Confirm the scoped root run executes zero tasks and the general/serial
      unit graphs become 83/66/17 and remain 2/2/0.
- [x] Confirm fast/all integration graphs remain 52/63 with Notification Local
      once on its unchanged Jest command.
- [x] Accept exactly one removed inventory entry, scripts 111 to 110, and no
      other ownership-count change.
- [x] Run package build, workspace policy, exact inventory, formatting, and the
      complete shared foundation.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed retirement.

Result:

- Notification Local no longer advertises a unit lane with zero files or
  assertions, and no empty Vitest substitute exists;
- source remains the exact baseline two-file production tree at hashes
  `3fd401c42677199a8ace4810e6db7af4cbe379926bc0c7248c86adfef48c07af`
  and `7f19b33639e38e1d07bd997eba6b7fdde73e9796abd14509ec172bdd75e15dee`;
- the separate Jest integration remains byte-identical at one file/one passing
  test, two expectations, zero snapshots, and authentic shards 1/0/0;
- general/serial unit graphs become 83/66/17 and remain 2/2/0; fast/all
  integration graphs remain 52/63;
- inventory becomes 68 configs, 110 scripts across 68 owners, and 406 active
  API files at digest
  `b89e589f285d2e272e60e864ad1af9c7b38792d9165d92ff290ae792c36df4df`;
- build, policy, inventory, reporter/shard/hash/graph proof, and the complete
  foundation pass;
- no integration assertion, source, config, dependency, lockfile, root/workflow,
  persistence, production runtime, hosted CI, or Cloudflare boundary changes.

### Turn 32 - Notification Local Integration Vitest Shadow

Status: completed as an opt-in runner shadow. Jest remains authoritative and no
package-default or CI cut-over is claimed.

Scope:

- keep the exact Jest integration command as `test:integration` and add only an
  opt-in `test:integration:vitest` command;
- reuse the shared package-root serial Node integration profile for the sole
  spec and preserve all five aliases;
- preserve the real console-spy assertion, cleanup, timeout, source/config
  hashes, dependencies, lockfile, root, workflow, production, and external-service
  boundaries while explicitly accepting the shared Vitest profile's test-worker-only
  `setup-env.js` side effect;
- prove the later one-file unsharded cut-over requirement without implementing
  it in this shadow.

Checklist:

- [x] Capture fresh pre-edit Jest reporter/full-name/status baseline.
- [x] Add only the opt-in Vitest script and strict package-local config.
- [x] Keep the exact Jest default, retired unit lane, source, spec, Jest config,
      dependencies, lockfile, root scripts, workflow, and tooling unchanged.
- [x] Prove the shared bridge preserves `setTimeout`, `spyOn`, and
      `restoreAllMocks` on the unchanged assertion.
- [x] Compare pre-edit Jest, post-edit Jest, and Vitest reporters at one file,
      one passed test, exact full name/status, and zero snapshots.
- [x] List exactly the sole Vitest spec/test and prove the unsharded command
      exits naturally.
- [x] Prove all three real Vitest shards fail closed while Jest remains 1/0/0.
- [x] Pass strict standalone config typecheck and package build.
- [x] Preserve source/spec/Jest hashes and record the new config hash.
- [x] Confirm general/serial unit graphs remain 83/66/17 and 2/2/0.
- [x] Confirm fast/all integration graphs remain 52/63 with Notification Local
      once on Jest.
- [x] Keep the remaining-Jest inventory byte-identical at digest
      `b89e589f285d2e272e60e864ad1af9c7b38792d9165d92ff290ae792c36df4df`.
- [x] Run workspace policy, formatting, exact inventory, and the complete shared
      foundation.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed shadow.

Result:

- Vite 8.1.4/Rolldown and Vitest 4.1.10 run the unchanged one-test local
  integration through the shared bridge with exact Jest parity;
- all three reporters normalize to one file, one passed test, zero
  failures/skips/todos/snapshots, and the exact documented full name;
- the console spy observes the real deterministic message and the cleanup hook
  restores it; no caller-provided environment, external service, or persistence
  behavior is required. The Vitest worker alone receives the documented shared
  environment setup, which the unchanged assertion does not observe;
- unsharded listing is exact, all Vitest three-way shards fail closed, and Jest
  remains 1/0/0;
- unit/integration graphs and the 68-config/110-script/406-API inventory remain
  unchanged;
- strict config, build, policy, formatting, hashes, runner proof, and the full
  foundation pass;
- no dependency, lockfile, assertion, source, Jest config, root/workflow,
  persistent tooling, hosted CI, production runtime, or Cloudflare boundary
  changes.

### Turn 33 - Notification Local Integration Vitest Cut-Over

Status: completed locally with hosted CI confirmation deferred. Vitest is the
package default and the exact Jest command remains as rollback.

Scope:

- promote the existing Vitest command to `test:integration`, move the exact
  Jest command to `test:integration:jest`, and remove the temporary shadow key;
- exclude the one-file lane from generic fast `/3` shards while preserving it
  once in the unsharded all-packages graph;
- add dedicated runner-neutral unsharded workflow ownership and aggregate
  terminal-state propagation;
- add the existing config exactly once to persistent strict typecheck and
  extend the typed package/root/hash/workflow contract;
- accept only the remaining-Jest manifest-key move, with no dependency,
  lockfile, assertion, source, config, production, persistence, or Cloudflare
  change.

Checklist:

- [x] Capture fresh committed pre-cut-over Jest and Vitest reporter baselines.
- [x] Switch the default, preserve the exact Jest rollback, and remove the
      shadow key without restoring the retired unit lane.
- [x] Compare pre-Jest, rollback Jest, and default Vitest pairwise at one file,
      one passed test, exact full name/status, and zero snapshots.
- [x] Prove unsharded Vitest list/run and natural exit, Jest rollback 1/0/0,
      real Vitest fail-closed 1/3, 2/3, 3/3, and clean no-force Jest exit.
- [x] Preserve the spec, Jest/Vitest configs, source, dependencies, lockfile,
      assertions, cleanup, and documented worker-setup boundary.
- [x] Move fast integrations 52/33/19 to 51/32/19, keep all integrations
      63/44/19 with Notification Local once on Vitest, and preserve unit graphs
      83/66/17 and 2/2/0.
- [x] Add dedicated `notification-local-integration` with no job environment,
      services, strategy, matrix, shard, CPU probe, or runner-specific name.
- [x] Propagate failure/cancelled/skipped and success through the package
      aggregate while retaining `if: ${{ always() }}`.
- [x] Add one strict config typecheck token and typed scripts/root/hash/job/
      aggregate assertions without unsafe TypeScript.
- [x] Accept only the inventory-key move to digest
      `2994c111cab4cf88af15777b67086bad827e4a8308036679ce735a5aeda222c4`.
- [x] Pass package build, frozen offline install, workspace policy, formatting,
      exact inventory, focused contracts, graph proof, and the full foundation.
- [x] Record the hosted execution boundary and update all four migration
      records.
- [x] Review and commit the completed cut-over.

Result:

- Vite 8.1.4/Rolldown and Vitest 4.1.10 now own the unchanged local integration
  by default, with exact Jest rollback and all three reporter comparisons green;
- bridge-supported timeout/spy/restoration behavior, the exact assertion name,
  one passed test, zero snapshots, natural Vitest exit, and clean Jest lifecycle
  remain proven;
- the dedicated job downloads build artifacts because the shared worker setup
  loads the built test-worker-identity leaf. The assertion itself needs no
  caller environment, database, Redis, filesystem, network, credential,
  workerd, D1, Cloudflare, or external service;
- strict typing, eight tooling tests, five-file shared parity, all 25 selectors,
  real adapter execution, exact three-file/34-test adapter parity, and the
  68-config/110-script/406-API inventory pass;
- an initial full-foundation attempt crashed the existing Windows PGlite Vitest
  child while C: had 0.36 GB free. A bounded pnpm cache prune raised free space
  to at least 6.6 GB; the isolated adapter and complete 248-second rerun then
  passed;
- local workflow parsing and contract execution are green, but GitHub
  scheduling, cache/artifact restoration, and aggregate execution remain
  unproven until publication. Hosted confirmation is therefore deferred.

### Turn 34 - Notification SendGrid Empty Unit Lane Retirement

Status: completed as a zero-test ownership decision. No Vitest parity,
integration shadow, or package-default switch is claimed.

Scope:

- prove `test: jest --passWithNoTests src` owns no files or assertions;
- compare the goal baseline and current two-file production source tree;
- remove only the empty manifest key without adding an empty Vitest lane or
  rollback;
- preserve the separate wholly skipped Jest integration lane, SendGrid
  dependency, source/config/spec, lockfile, root/workflow, and live-service
  boundary.

Checklist:

- [x] Prove the package command and direct Jest list discover zero unit files.
- [x] Prove direct execution without `--passWithNoTests` exits 1 after four
      files are checked and `src` has zero matches.
- [x] Confirm baseline/current source trees contain only two production files
      with no tests/assertions/mocks/fixtures/snapshots.
- [x] Remove only the unit `test` key; add no empty Vitest replacement or Jest
      rollback.
- [x] Preserve source, integration-spec, Jest-config, and tsconfig hashes.
- [x] Compare pre/post integration reporters at one skipped suite, five pending
      tests, exact full names/statuses, and zero snapshots.
- [x] Prove integration shards remain five skipped/zero/zero and a no-force
      diagnostic exits without an open-handle report.
- [x] Confirm all four `SENDGRID_TEST_*` variables are absent and
      `describe.skip` prevents service construction, singleton mutation,
      assertions, real email/API requests, and remote 400 behavior.
- [x] Confirm the scoped root run executes zero tasks, general units become
      83/65/18, and serial units remain 2/2/0.
- [x] Confirm fast/all integrations remain 51/32/19 and 63/44/19 with
      Notification SendGrid once on unchanged Jest.
- [x] Accept exactly one removed inventory entry and digest
      `c508a382b600ddaf38321a536b4e4d3f252851777cf2e1d0c5e188b2d0f8516a`.
- [x] Pass package build, frozen offline install, workspace policy, exact
      inventory, formatting, graphs, and the complete foundation.
- [x] Update the roadmap and test-runner/package-management records.
- [x] Review and commit the completed retirement.

Result:

- Notification SendGrid no longer advertises a zero-file unit lane, and no
  empty Vitest substitute exists;
- source remains the baseline two-file production tree at hashes
  `f645f39a46863814f53cbed3e91c49f8255ebbf19b13a6e6c078cc81c5a2582a`
  and `45fe35339429262ece0bd2df3080ad0c3f1d2bddf522c2c5d8c7244b10fcb443`;
- the separate integration remains byte-identical at one skipped suite, five
  skipped tests, zero snapshots, and authentic shards five/zero/zero;
- general/serial units become 83/65/18 and remain 2/2/0; fast/all integration
  graphs remain 51/32/19 and 63/44/19;
- inventory becomes 68 configs, 109 scripts across 68 owners, and 406 active
  API files at the documented digest;
- package build, policy, reporter, shard, hash, and graph checks pass; the
  complete 267.7-second foundation covers eight tooling tests, five-file parity,
  all 25 selectors, and exact three-file/34-test adapter parity;
- no live SendGrid request executes and no integration assertion, dependency,
  lockfile, source, config, root/workflow, persistence, production runtime,
  hosted CI, or Cloudflare boundary changes.

### Turn 35 - Notification SendGrid Integration Vitest Shadow

Status: completed as an opt-in skipped-suite shadow. Jest remains the package
default and generic fast/all integration owner.

Scope:

- add only `test:integration:vitest` and a package-root Vitest config;
- use the shared serial Node integration profile, five standard aliases, and
  sole `services.spec.ts` include;
- preserve the exact Jest default, manual suite, production source,
  dependencies/lockfile, root/workflow, inventory, and external-service
  boundary;
- prove Vite 8/Vitest 4 import, collection, skip, exit, and shard behavior
  without enabling credentials or claiming live SendGrid behavior.

Checklist:

- [x] Capture byte/normalized hashes, Jest JSON baseline, exact full names,
      no-force exit, dependency resolution, and absent credentials before edit.
- [x] Add only the opt-in manifest key and canonical one-file config.
- [x] Keep `test:integration` byte-identical on Jest and preserve every skip,
      assertion, timeout, hook, and pre-existing type.
- [x] Prove exact normalized pre-Jest/post-Jest/Vitest reporter parity at one
      file, five skipped tests, zero failures/todos/snapshots.
- [x] Prove CommonJS `@sendgrid/mail` 8.1.6 default import exposes `setApiKey`
      and `send`, and Vitest imports the unchanged service during collection.
- [x] Prove the unsharded Vitest script exits naturally at one file/five skips.
- [x] Prove authentic Jest shards remain five/zero/zero and all exit 0; prove
      every Vitest `/3` run fails closed because one file cannot be split into
      three shards.
- [x] Confirm all four credentials remain absent and the skipped suite executes
      no constructor, singleton mutation, assertion, HTTPS request, delivery,
      remote error, or cleanup path.
- [x] Preserve normalized source/spec/Jest/tsconfig hashes and freeze the new
      canonical Vitest config hash.
- [x] Preserve `@sendgrid/mail: ^8.1.6`, its 8.1.6 lock resolution, framework
      workspace edges, and the raw lock hash through a frozen offline install.
- [x] Keep scoped/general/serial unit graphs at zero plus marker, 83/65/18, and
      2/2/0; keep fast/all integrations at 51/32/19 and 63/44/19 with SendGrid
      once on unchanged Jest.
- [x] Keep the remaining-Jest inventory exact at 68 configs, 109 scripts across
      68 owners, 406 API files, and the same digest.
- [x] Pass package build, one-shot strict config typecheck, workspace policy,
      frozen install, graph/import/reporter/shard gates, formatting, and the
      complete foundation.
- [x] Update all four records, complete fresh independent reviews, and commit
      the shadow.

Result:

- the package has an opt-in Vitest integration shadow but remains
  Jest-authoritative;
- exact normalized parity is one file, zero passed/failed, five skipped, zero
  todo, and zero snapshots with unchanged names;
- Vite 8.1.4/Vitest 4.1.10 load the CommonJS SendGrid dependency through the
  unchanged service, and the package script exits naturally;
- Jest shards remain five/zero/zero; all Vitest `/3` runs fail closed;
- source/spec/Jest/tsconfig hashes, dependency/lock ownership, root/workflow,
  graphs, and inventory remain unchanged; the canonical Vitest config hash is
  `3cf6eb214c24ce840be1cb2ca6fcb942a5e3b5b8b525d6fc070d33079cc8c241`;
- package build, strict config typecheck, frozen install, policy, and the full
  237.4-second foundation pass;
- no credential, network, delivery, remote-error, persistence, hosted CI,
  production runtime, workerd, D1, or Cloudflare behavior is executed or
  claimed.

### Turn 36 - Notification SendGrid Integration Vitest Cut-Over

Status: locally accepted with hosted execution deferred. Vitest is the package
default and the exact Jest command remains under `test:integration:jest`.

Scope:

- move the proven Vitest command to `test:integration`, move exact Jest to the
  rollback key, and remove the shadow key;
- exclude the one-file default from generic three-way fast sharding and add a
  dedicated unsharded runner-neutral workflow job;
- propagate all terminal states through the package aggregate;
- add the config exactly once to persistent strict typecheck and extend the
  existing typed workflow contract;
- preserve the wholly skipped suite, CommonJS import, dependencies/lockfile,
  source/config hashes, and credential/network non-execution.

Checklist:

- [x] Capture fresh Jest/Vitest reporters, package/root/workflow/inventory
      baselines, hashes, graph counts, dependency resolution, and credentials.
- [x] Prove the existing eight-test contract passes before extension.
- [x] Extend the strict contract first and capture its exact red failure on the
      missing SendGrid fast-lane exclusion.
- [x] Switch default/rollback keys and remove the temporary shadow key without
      changing either runner command.
- [x] Add only the SendGrid exclusion to fast packages; preserve slow/all
      command values otherwise.
- [x] Add a four-step unsharded workflow job with no environment, services,
      strategy, matrix, shard, CPU probe, worker flag, credentials, or runner
      name.
- [x] Add failure/cancelled/skipped and success propagation to the existing
      `always()` aggregate.
- [x] Add the config exactly once to persistent strict typecheck and verify the
      typed contract without `any`, cast, enum, suppression, or weak boundary.
- [x] Prove pre/post/default/rollback normalized reporter parity at one file,
      five skipped, zero passed/failed/todo/snapshots, and exact names/statuses.
- [x] Prove unsharded default natural exit, Jest rollback five/zero/zero, and
      fail-closed Vitest `/3` behavior.
- [x] Confirm all four credentials remain absent and no constructor, singleton
      mutation, assertion, HTTPS request, delivery, remote error, or cleanup
      path executes.
- [x] Confirm general/serial units remain 83/65/18 and 2/2/0; move fast
      integrations from 51/32/19 to 50/31/19 with no SendGrid owner; keep all
      integrations 63/44/19 with SendGrid once on Vitest.
- [x] Accept only the Jest inventory-key move at unchanged counts and digest
      `ccf3ead2e047791b66e16c98d2e178a021b639e9719278366338677300f46404`.
- [x] Preserve all immutable hashes, `@sendgrid/mail` 8.1.6 resolution,
      framework workspace edges, and raw lock hash.
- [x] Pass package build, strict tooling typecheck, eight tooling tests, exact
      workflow contract, frozen offline install, policy, inventory, reporters,
      shards, graphs, formatting, and the complete foundation.
- [x] Update all four records, complete fresh independent reviews, and commit
      the cut-over.

Result:

- Notification SendGrid now defaults to Vitest with exact Jest rollback and no
  shadow key;
- all reporter comparisons remain one file/five skipped with no failure, todo,
  snapshot, assertion, source, or external-service behavior change;
- fast integrations become 50/31/19 and exclude SendGrid; all integrations stay
  63/44/19 and own SendGrid once on Vitest; unit graphs stay unchanged;
- dedicated unsharded workflow and aggregate terminal-state ownership are
  locally parsed and contract-tested, with the exact command passing locally;
- inventory remains 68 configs, 109 scripts across 68 owners, and 406 API files
  at the new reviewed digest;
- package build, strict typing, frozen install, dependency policy, and the full
  234.4-second foundation pass;
- hosted scheduling/cache/artifact/aggregate execution and every live SendGrid
  delivery/error/credential/network claim remain deferred.

### Turn 37 - Locking Postgres Empty Unit Lane Retirement

Status: completed as a zero-test ownership decision. No Vitest parity,
integration shadow, or provider migration is claimed.

Scope:

- prove `test: jest --passWithNoTests src` owns no test file or assertion;
- compare goal-baseline/current source trees and preserve every source,
  migration, config, alias/build/watch, and framework edge;
- remove only the empty unit manifest key;
- run the unchanged database-backed integration before/after against an
  isolated PostgreSQL cluster without touching the machine service;
- preserve root/workflow and all non-unit ownership.

Checklist:

- [x] Prove direct unit listing is `[]`, the package command exits 0 only via
      `--passWithNoTests`, and direct no-pass execution exits 1 after eight
      files are checked with zero `src` matches.
- [x] Confirm goal-baseline/current source trees are identical at six tracked
      files and contain no unit test API, assertion, mock, fixture, or snapshot.
- [x] Capture source/spec/Jest/tsconfig/MikroORM hashes and integration API
      counts before edit.
- [x] Start a separate PostgreSQL 18 trust-auth cluster under the temporary
      directory and leave the installed service untouched.
- [x] Record the existing empty-cluster shared-pool failure, then pre-create
      deterministic `medusa-locking-integration-1` and establish a green
      integration baseline.
- [x] Remove only `test: jest --passWithNoTests src`; add no empty Vitest lane
      or rollback.
- [x] Prove pre/post integration parity at one file, five passed, one skipped,
      no failures/todos/snapshots, and exact names/statuses.
- [x] Prove the exact package command, a no-force diagnostic, and authentic
      Jest integration shards five-plus-one/zero/zero.
- [x] Stop and remove the isolated cluster after confirming no active test
      connections.
- [x] Confirm the scoped root command moves one task to zero, general units
      become 83/64/19, and serial units remain 2/2/0.
- [x] Keep fast/all integrations 50/31/19 and 63/44/19 with Locking Postgres
      once on unchanged Jest.
- [x] Accept exactly one removed inventory entry at 68 configs, 108 scripts
      across 68 owners, 406 API files, and digest
      `2f4d7d288d2921136018774ca486b6bceacbef18716e43599384c355a413c2e1`.
- [x] Pass package build/alias resolution, frozen install, workspace policy,
      inventory, reporters, shards, graphs, formatting, and full foundation.
- [x] Update all four records, complete fresh independent reviews, and commit
      the retirement.

Result:

- Locking Postgres no longer advertises an empty unit lane and has no empty
  Vitest substitute;
- its six-file source/migration tree and every runner/config hash remain
  unchanged;
- the unchanged PostgreSQL integration passes 5/1 before and after when its
  deterministic database is pre-created in the isolated cluster;
- unit graphs become 83/64/19 and 2/2/0; integration graphs remain 50/31/19 and
  63/44/19 with unchanged Jest ownership;
- inventory becomes 68 configs, 108 scripts across 68 owners, and 406 API files
  at the reviewed digest;
- package build, policy, frozen install, isolated PostgreSQL validation, and
  the complete 260.5-second foundation pass;
- no source, assertion, migration, dependency, lockfile, root/workflow,
  machine-service, persistence, production-runtime, workerd, D1, or Cloudflare
  behavior changes.

### Turn 38 - Locking Postgres Integration Vitest Shadow

Status: completed as an opt-in production-entry shadow. Jest remains the
package default and integration-graph owner.

Scope:

- add only the opt-in Vitest script and canonical one-file package config;
- preserve all test/assertion/skip/type ownership and the exact Jest default;
- resolve the provider through the freshly built workspace package so both
  runners use supported production-entry loading;
- run exact three-way parity against one isolated PostgreSQL cluster with
  separate Jest/Vitest worker-named databases;
- preserve root/workflow, dependencies/lockfile, shared runner helpers,
  source/migrations, and Cloudflare boundaries.

Checklist:

- [x] Confirm installed and registry-latest Vite 8.1.4/Vitest 4.1.10 and capture
      manifest/spec/config/source/lock baselines.
- [x] Establish the pre-edit Jest source baseline at one file, five passed, one
      skipped, zero failures/todos/snapshots, and exact names/statuses.
- [x] Start an isolated PostgreSQL 18.3 trust-auth cluster without changing the
      installed Windows service.
- [x] Correct the prior single-database assumption: pre-create
      `medusa-locking-integration-1` and
      `medusa-locking-integration-vitest-1`; do not claim `DB_TEMP_NAME`
      controls module-runner naming.
- [x] Add `test:integration:vitest` and the shared serial config with five
      aliases and sole `index.spec.ts`.
- [x] Reject the incomplete config-only source path after live proof:
      directory `require.resolve` fails, explicit `index.ts` escapes Vite into
      native TypeScript loading, and direct provider exports are skipped by the
      current dynamic internal loader.
- [x] Add no shared AST rewrite, native require hook, global loader mutation,
      or core loader behavior change.
- [x] Change only provider-resolution plumbing to
      `require.resolve("@medusajs/locking-postgres")`, run a clean package build,
      and prove it resolves `dist/index.js` with the real advisory-lock service.
- [x] Keep five `it`, one `it.skip`, 24 `expect`, five `jest.fn`, one
      `jest.setTimeout`, two pre-existing `any[]`, all names, and zero snapshots
      unchanged.
- [x] Prove exact pre-Jest(source)/post-Jest(dist)/Vitest(dist) reporter parity
      at one file, five passed, one skipped, no failures/todos/snapshots.
- [x] Prove natural Vitest exit, unchanged exact Jest default, a no-force Jest
      diagnostic, and zero remaining PostgreSQL connections.
- [x] Prove Jest `/3` is five-plus-one/zero/zero with three zero exits and every
      real Vitest `/3` run fails closed with exit 1 before import.
- [x] Preserve unit graphs at 1/0/1, 83/64/19, and 2/2/0; preserve integration
      graphs at 50/31/19 and 63/44/19 with Locking Postgres once on Jest.
- [x] Keep the exact inventory at digest
      `2f4d7d288d2921136018774ca486b6bceacbef18716e43599384c355a413c2e1`,
      68 configs, 108 scripts across 68 owners, and 406 API files.
- [x] Pass package build, standalone strict config typecheck, frozen install,
      workspace policy, formatting, hashes, reporters, shards, graphs, and the
      complete foundation.
- [x] Stop/remove the verified temporary cluster, update all four records,
      complete fresh independent reviews, and commit the shadow.

Result:

- Jest remains authoritative and byte-identical in the manifest; Vitest is an
  opt-in PostgreSQL-backed shadow;
- all assertions/test APIs are unchanged while the provider bootstrap moves
  from raw `src` directory resolution to the freshly built production package
  entry for both runners;
- spec hash becomes
  `027b840cb2e10e1d9286456a430c30f2df7f8b69bb1a8b87cc5b9253e09b3b8d`;
  config hash is
  `69b01480ab6cce348730a134543f7c5ef37a29f23f55f54e787cac831d7eb632`;
- three-way exact parity is one file, five passed, one skipped, zero failures/
  todos/snapshots, with identical full names and statuses;
- the shared bridge executes the timeout and two active mocks; the skipped
  timeout test is reported, but its three mock-creation calls are never invoked;
- graphs, inventory, source/migration/config hashes, dependency/lock ownership,
  root/workflow, and the installed PostgreSQL service remain unchanged;
- after a low-disk first aggregate failure, focused adapter validation passed
  in 176.2 seconds and the complete foundation passed in 262.7 seconds after
  safe removal of the completed temporary PostgreSQL cluster;
- the unchanged shared foundation regression-revalidates its existing PGlite
  adapter, but no Locking Postgres PGlite, Redis, workerd, D1, Cloudflare,
  hosted CI, catalog, or private-package result is claimed.

### Turn 39 - Locking Postgres Integration Vitest Cut-over

Status: locally accepted with hosted execution explicitly deferred. Vitest is
the package default; the byte-identical Jest command remains the rollback.

Scope:

- promote the proven one-file PostgreSQL Vitest shadow to `test:integration`;
- move the exact former Jest default to `test:integration:jest` and remove the
  temporary shadow key;
- preserve the production-entry resolver, every assertion/test API/skip, Jest
  config, source/migrations, and dependency/lockfile ownership;
- exclude only this one-file lane from the generic `/3` fast graph and give it
  a dedicated runner-neutral PostgreSQL workflow job;
- prove default/rollback parity locally against separate runner-named databases
  without claiming hosted CI, PGlite, Redis, workerd, D1, or Cloudflare results.

Checklist:

- [x] Confirm installed and registry-latest Vite 8.1.4 with built-in Rolldown
      and Vitest 4.1.10; preserve all protected spec/config/source/lock hashes.
- [x] Start an isolated PostgreSQL 18.3 trust-auth cluster on
      `127.0.0.1:55439`, pre-create `medusa-locking-integration-1` and
      `medusa-locking-integration-vitest-1`, and leave the installed service
      untouched.
- [x] Move the byte-identical Jest command to `test:integration:jest`, promote
      `vitest run --config vitest.integration.config.mts` to
      `test:integration`, and remove `test:integration:vitest`.
- [x] Keep the production package entry, five ordinary `it`, one `it.skip`, 24
      `expect`, five `jest.fn`, one `jest.setTimeout`, two pre-existing `any[]`,
      all six names, and zero snapshots unchanged.
- [x] Prove exact default-Vitest/Jest-rollback reporter parity at
      files/passed/failed/skipped/todo/snapshots `1/5/0/1/0/0`, including exact
      normalized full names and statuses.
- [x] Prove exact
      `pnpm --filter @medusajs/locking-postgres test:integration` and
      `pnpm --filter @medusajs/locking-postgres test:integration:jest` commands,
      natural Vitest exit, and a direct Jest no-force `--detectOpenHandles`
      diagnostic with no open-handle report.
- [x] Prove authentic Jest `/3` shards at five passed plus one skipped/zero/zero
      with three zero exits, while all three real Vitest shards exit 1 before
      import and unsharded Vitest list returns the five runnable names.
- [x] Confirm zero active connections in both runner-named databases after the
      real runs, then stop and remove only the verified temporary cluster.
- [x] Preserve unit graphs at scoped 1/0/1, general 83/64/19, and serial 2/2/0;
      move fast integrations to 49/30/19 with Locking Postgres absent; retain
      all integrations at 63/44/19 with 35 Jest and nine Vitest owners.
- [x] Add an unsharded `locking-postgres-integration` job whose PostgreSQL
      service creates `medusa-locking-integration-vitest-1` through
      `POSTGRES_DB`, then propagate failure/cancelled/skipped/success through the
      package aggregate.
- [x] Parse and freeze the exact runner-neutral workflow/service/step shape,
      database environment, manifest scripts, typecheck token, immutable
      hashes, graph commands, and aggregate conditions in the typed local
      contract; do not contact GitHub.
- [x] Accept the reviewed Jest inventory key move at digest
      `b30b0e5a8cd7ced2711fea1b34c52216ae8b3cf8b6acc5ebb97a55812fd4034b`,
      retaining 68 configs, 108 scripts across 68 owners, and 406 API files.
- [x] Pass clean package build/alias resolution, frozen offline install, all 86
      workspace dependency checks, strict tooling typecheck, all eight tooling
      tests, reporters, shards, graphs, formatting, and the complete
      239.1-second foundation.
- [x] Update all four records, complete fresh independent reviews, and commit
      the cut-over as one narrow slice.

Result:

- Locking Postgres now defaults to Vitest through the fresh production entry,
  retains the exact Jest rollback, and has no duplicate shadow key;
- default/rollback parity remains one file, five passed, one skipped, zero
  failures/todos/snapshots, with every assertion, name, status, and compatibility
  call preserved;
- the one-file lane leaves only the sharded fast graph, remains once in the
  unsharded all-packages graph, and has dedicated PostgreSQL workflow ownership;
- the local YAML/typed contract proves `POSTGRES_DB` database creation, service
  credentials, build-artifact path, exact package command, and aggregate
  terminal-state propagation, but hosted scheduling/cache/artifact/service
  execution remains deferred and no GitHub access was used;
- the isolated PostgreSQL 18.3 cluster is removed after zero-connection proof,
  while the installed service remains untouched;
- package build, frozen install, 86-manifest policy, strict typecheck, eight
  tooling tests, exact inventory, and the complete 239.1-second foundation pass;
- no source, assertion, skip, migration, dependency, lockfile, persistence,
  production runtime, PGlite, Redis, workerd, D1, Cloudflare, catalog, package-
  privacy, or repository-merge behavior changes.

### Turn 40 - Locking Redis Empty Unit Lane Retirement

Status: completed as a zero-test ownership decision. No Vitest parity,
integration shadow, Redis runtime validation, or package-default cut-over is
claimed.

Scope:

- prove `test: jest --passWithNoTests src` owns no test file or assertion;
- compare the goal-baseline/current four-file production source tree;
- remove only the empty unit manifest key without adding an empty Vitest lane
  or Jest rollback for nonexistent coverage;
- preserve the separate Redis-backed Jest integration command/config/spec,
  `ioredis`, framework workspace edges, dependencies/lockfile, root/workflow,
  source, and production behavior.

Checklist:

- [x] Prove direct unit listing is `[]`, the package command exits 0 only via
      `--passWithNoTests`, and direct no-pass execution exits 1 after six files
      are checked with zero `src` matches.
- [x] Confirm goal-baseline/current source trees are identical at
      `src/index.ts`, `src/loaders/index.ts`, `src/services/redis-lock.ts`, and
      `src/types/index.ts`, with no unit test API, assertion, mock, fixture, or
      snapshot.
- [x] Remove only `test: jest --passWithNoTests src`; add no empty Vitest
      substitute or rollback.
- [x] Preserve the exact Jest integration command, sole listed
      `integration-tests/__tests__/index.spec.ts`, six `it`, 24 `expect`, five
      `jest.fn`, one `jest.setTimeout`, two pre-existing `any[]`, all names, and
      zero skips/snapshots.
- [x] Preserve normalized-LF hashes: integration spec
      `a97ad9aac8520dbe551f9406af4e548a453454bc07b744abfe57e510e5dfa094`,
      Jest config
      `5835bb3569f89cb8edcf9fc227d9e4fbc41d1b6a1e02d20609dc30b59cd3b5f8`,
      tsconfig
      `444e89a6ca86a1e65c2000babbbf18f68fde9bfa1c78c676721d6e6c8e644166`,
      and source files
      `52f165b1a0e6bcb9d2c9aab22305c4218498637bb1c34f46397d894de25e8e23`,
      `c5ae2941bb5009ef6f09753d6fbdb866c1f228adfd96d599f4980f4fd6aa76b8`,
      `66f49c9450e18953b0b12f8df11d1f104125742d398b1da2b4d863bfb7f60777`,
      and
      `b191f1d798e9444028e9a83d949edd453c00f5df017ea10d9c0a38ec66428261`.
- [x] Keep `ioredis: ^5.4.1` at lock resolution 5.8.2, framework development
      and peer edges at `workspace:*`, and raw lock SHA-256
      `40729cc986f41e2dabdfd4411cf0e6b2cfb7ee07ca13fa4270f4066f8c45aee9`.
- [x] List the one integration file without connecting to Redis; do not run or
      claim the Redis-backed integration because no real Redis service is
      supplied in this unit-only turn.
- [x] Confirm scoped units move 1/1/0 to 1/0/1, all units move 85/66/19 to
      85/65/20, general units move 83/64/19 to 83/63/20, and serial units remain
      2/2/0.
- [x] Keep fast, slow, and all integration graphs at 49/30/19, 5/5/0, and
      63/44/19, with Locking Redis once in fast/all on unchanged Jest.
- [x] Accept exactly one removed inventory entry at digest
      `fc107ce908df6f9a0ab7d2f9233f4360bf775fddcb2c2c105c62c685b13f62f1`,
      retaining 68 configs, 107 scripts across 68 owners, and 406 API files.
- [x] Pass package build/alias resolution, frozen offline install, all 86
      workspace dependency checks, direct discovery, scoped execution, dry
      graphs, exact inventory, formatting, and the complete 235.5-second
      foundation.
- [x] Update all four records, complete fresh independent reviews, and commit
      the retirement as one narrow slice.

Result:

- Locking Redis no longer advertises an empty unit lane and has no empty Vitest
  substitute or rollback;
- the four-file production source tree, integration spec/config, every test API
  and assertion, dependencies, lockfile, root scripts, and workflow remain
  unchanged;
- the Redis-backed integration remains Jest-authoritative at one file/six tests,
  but only discovery is proven: no Redis process, command execution, parity,
  isolation, cleanup, timeout, or open-handle result is claimed;
- unit graphs become scoped 1/0/1, all 85/65/20, general 83/63/20, and serial
  2/2/0; integration graphs remain fast 49/30/19, slow 5/5/0, and all 63/44/19;
- inventory becomes 68 configs, 107 scripts across 68 owners, and 406 API files
  at the reviewed digest;
- package build, frozen install, 86-manifest policy, exact inventory, and the
  complete 235.5-second foundation pass;
- no integration default, Jest config, source, assertion, dependency, lockfile,
  root/workflow, hosted CI, production runtime, PGlite, PostgreSQL, workerd, D1,
  Cloudflare, catalog, package-privacy, or repository-merge behavior changes.
  No GitHub access was used, and no new hosted result applies to this turn.

### Turn 41 - Locking Redis Lifecycle Prerequisite

Status: completed locally as a prerequisite behavior fix. The attempted Vitest
shadow was rejected and fully reverted; runner parity is handled separately by
Turn 42 below.

Scope:

- provision a real isolated Redis service and run the unchanged authoritative
  suite without relying on `--forceExit`;
- treat a clean assertion result with a live process, client, or timer as a
  failed acceptance gate;
- make shared-connection module teardown execute application lifecycle hooks,
  forward those hooks through Locking, disconnect the Redis provider, and cancel
  losing timeout races;
- preserve every integration assertion/API/name/status plus Jest default,
  config, dependencies, lockfile, root/workflow ownership, and production
  locking semantics.

Checklist:

- [x] Bind a temporary Redis-compatible service to loopback port 56379, isolate
      database 15 and `medusa_lock:` keys, disable persistence, verify its
      published asset checksum, and leave machine services unchanged.
- [x] Establish the unchanged six-test Jest assertion baseline and experimental
      Vitest result, then reject the shadow because the no-force Jest process
      remains alive beyond 30- and 90-second watchdogs.
- [x] Capture six idle `ioredis` 5.8.2 clients and two losing timeout handles,
      then revert every temporary Vitest script/config/resolver edit.
- [x] Run application prepare/shutdown hooks even when `initModules` receives a
      shared connection, attempt every later cleanup phase before aggregating
      failures, and preserve connection destruction ownership.
- [x] Forward lifecycle hooks to configured Locking providers through a strict
      type guard, preserve `this`, attempt all providers before aggregating
      errors, and disconnect the Redis client on shutdown.
- [x] Abort each losing `node:timers/promises` timeout in `Promise.race` without
      changing the asserted `Timed-out acquiring lock.` behavior.
- [x] Give each execution a unique owner, abort the losing timer, and release
      partial/late multi-key acquisitions after timeout; add one deterministic
      regression without modifying the six original cases.
- [x] Remove only `--forceExit` from the authoritative Jest integration script;
      keep Jest as `test:integration` and retain its config/spec ownership.
- [x] Preserve all six original tests, 24 expectations, five mocks, timeout API,
      names, statuses, pre-existing annotations, and zero snapshots; change the
      spec only by the additive late-acquisition regression.
- [x] Pass the exact Jest package command at 7/7 naturally in about 7.9 seconds with no
      open-handle report, database 15 at zero keys, no namespaced keys, and no
      remaining test socket; pass Jest `/3` as 7/0/0 with natural exits.
- [x] Pass the same Redis assertions with a closed PostgreSQL endpoint, proving
      the suite's only live service dependency is Redis.
- [x] Pass the Locking in-memory 6/6 lane, Auth Emailpass Vitest/Jest 9/9
      regression, Locking 2/2 unit, and test-utils 45 passing / 28 skipped.
- [x] Pass all three affected builds, frozen offline install, all 86 workspace
      dependency checks, Cloudflare typecheck/import guards, task graphs, exact
      inventory, formatting/diff hygiene, and the complete 233.6-second
      foundation.
- [x] Shut down and delete the temporary service/artifacts, verify port 56379 is
      closed, update all four records, obtain fresh independent reviews, and
      commit only the lifecycle prerequisite.

Result:

- the authoritative package default remains Jest but now proves natural exit;
- all six original cases remain unchanged and one additive late-acquisition
  regression makes the authoritative result 1 file / 7 tests with cleanup and
  timeout-handle evidence instead of process termination;
- Jest config, tsconfig, dependencies, lockfile, root scripts, and workflow are
  unchanged;
- inventory remains 68 configs / 107 scripts / 68 owners / 406 API files at
  digest `6fc3f7d4842045b671b2f344448c651b76e09c247064dca81837568db23a0b51`;
- generic graphs remain scoped unit 1/0/1, general unit 83/63/20, serial unit
  2/2/0, fast integration 49/30/19, and all integration 63/44/19, with Locking
  Redis owned once on Jest;
- temporary local service evidence does not prove the workflow's Redis engine,
  hosted CI, or Vitest parity. No project-repository remote/connector access,
  push, or hosted Actions run occurred. Production lifecycle cleanup is the
  intentional behavior fix; production-engine compatibility remains unproven.

### Turn 42 - Locking Redis Integration Vitest Shadow

Status: completed locally as an opt-in shadow. Jest remains the authoritative
package default.

Scope:

- add only an opt-in `test:integration:vitest` command and canonical package-
  root serial integration config;
- replace only the dynamic provider locator with the freshly built production
  package entry required by native `require.resolve`;
- preserve all seven cases, assertions, names, statuses, Jest APIs, source,
  default ownership, dependencies/lockfile, root/workflow, and production
  behavior;
- prove pre-edit Jest source, post-edit Jest `dist`, and Vitest `dist` parity
  sequentially against one isolated real Redis endpoint.

Checklist:

- [x] Freeze the clean Turn 41 baseline and protected hashes at commit
      `868913f7ae`.
- [x] Provision checksum-verified Redis-compatible 8.8.0 on loopback port 56380,
      database 15, persistence disabled, existing `medusa_lock:` namespace, and
      64 MB memory limit.
- [x] Capture the pre-edit natural-exit Jest source reporter at 1 file / 7 passed
      / 0 failed, skipped, todo, or snapshots, with zero keys/clients/sockets.
- [x] Add only the opt-in Vitest key, canonical 32-line config, and resolver
      change to `require.resolve("@medusajs/locking-redis")`.
- [x] Clean-build the package and prove the workspace name resolves to fresh
      `dist/index.js`; pass the standalone strict/no-unchecked config typecheck.
- [x] Preserve seven `it`, 36 `expect`, eight `jest.fn`, one `jest.spyOn`, one
      `jest.setTimeout`, two inherited `any[]`, and zero skips/todos/snapshots.
- [x] Compare pre-Jest source to post-Jest `dist`, then post-Jest `dist` to
      Vitest, at exact one-file/seven-name/status/snapshot parity.
- [x] Pass the exact Jest default, direct Vitest shadow, seven-name unsharded
      Vitest list, and Vitest with PostgreSQL deliberately closed.
- [x] Prove database 15, namespaced keys, database-15 clients, and test sockets
      are all zero after every execution.
- [x] Pass authentic Jest `/3` at 7/0/0; prove each real Vitest `/3` run exits 1
      before import and leaves Redis untouched.
- [x] Shut down/delete the verified service, reports, and download; confirm port
      56380 is closed and no machine service/configuration changed.
- [x] Preserve unit graphs 85/65/20, scoped 1/0/1, general 83/63/20, serial
      2/2/0, and integration graphs fast 49/30/19, slow 5/5/0, all 63/44/19,
      with Locking Redis once on Jest in fast/all.
- [x] Keep the exact inventory byte-identical at 68 configs / 107 scripts / 68
      owners / 406 API files and digest
      `6fc3f7d4842045b671b2f344448c651b76e09c247064dca81837568db23a0b51`.
- [x] Pass package build, frozen offline install, all 86 workspace-link checks,
      Cloudflare typecheck/import guards, diff hygiene, and the complete
      236.7-second foundation.
- [x] Complete fresh independent reviews, update all four records, and commit
      only the seven-file Turn 42 shadow.

Result:

- Jest remains `test:integration`; Vitest exists only as
  `test:integration:vitest` with no root or workflow owner;
- six module-service cases load the fresh built package under post-edit Jest and
  Vitest, while the additive lifecycle case statically imports provider source
  under both runners;
- exact three-way service-backed parity is 1 file / 7 passed / 0 failed,
  skipped, todo, or snapshots, with clean keys/clients/sockets;
- the resolver-only spec hash is
  `71ba55deaa77220ed6bb4ce47751d5099c10255b0ec76ca77be5a1de21ae7ab7`,
  manifest hash is
  `a44b3fa8762e1e767cb9404d342502e410b9cb5e87c5682e819aac84bc1b8c25`,
  and config hash is
  `69b01480ab6cce348730a134543f7c5ef37a29f23f55f54e787cac831d7eb632`;
- local Redis parity does not prove the workflow Redis image/engine, hosted CI,
  production Redis, or aggregate scheduling. No project-repository remote,
  connector, push, or hosted Actions run occurred.

### Turn 43 - Locking Redis Integration Vitest Cut-over

Status: completed locally. Vitest is the package default, the natural-exit Jest
command remains an explicit rollback, and hosted workflow execution is deferred.

Scope:

- move `vitest run --config vitest.integration.config.mts` to
  `test:integration`, move the byte-identical Jest command to
  `test:integration:jest`, and remove `test:integration:vitest`;
- exclude only Locking Redis from the generic fast `/3` graph while preserving
  unsharded all-packages ownership;
- register the existing config exactly once in persistent strict tooling
  typecheck;
- add one runner-neutral, unsharded, Redis-only workflow job and propagate all
  aggregate terminal states;
- preserve the spec, both configs, production source, dependencies, lockfile,
  and all assertion/test API behavior.

Checklist:

- [x] Freeze commit `15090837f1`, clean worktree, toolchain, protected hashes,
      graph ownership, and exact remaining-Jest inventory before editing.
- [x] Confirm npm `latest` and installed versions are Vite 8.1.4 and Vitest
      4.1.10, matching the existing root ranges.
- [x] Download and checksum-verify Redis-compatible 8.8.0, bind it only to
      loopback port 56381, use database 15, disable persistence, and cap memory
      at 64 MB.
- [x] Re-prove the committed Jest default and opt-in Vitest shadow at 1 file / 7
      passed / 0 failed, skipped, todo, or snapshots before cut-over.
- [x] Make only the manifest ownership switch; preserve the exact natural-exit
      Jest command without `--forceExit`.
- [x] Add only the Locking Redis fast exclusion and config typecheck path to the
      root manifest; leave slow and unsharded all commands unchanged.
- [x] Add the four-step `locking-redis-integration` job with only Redis,
      artifact restore, explicit loopback URL, no matrix/shard/CPU/PostgreSQL,
      and a runner-neutral package-default command.
- [x] Add the dedicated job to aggregate `needs` and to failure, cancelled,
      skipped, and success predicates under `always()`.
- [x] Extend the strict typed contract to freeze package commands, dependency
      edges, immutable hashes, graph exclusion, typecheck registration, exact
      workflow service/steps, aggregate propagation, and absence of
      `continue-on-error` failure masking.
- [x] Accept exactly one remaining-Jest ownership-key move while preserving 68
      configs / 107 scripts / 68 owners / 406 API files.
- [x] Pass the exact Vitest default and Jest rollback naturally at 7/7; compare
      their JSON reporters at exact one-file/seven-name/status parity.
- [x] Return all seven names from unsharded Vitest list and pass 7/7 with every
      PostgreSQL variable pointed at closed port 1.
- [x] Preserve authentic Jest `/3` at 7/0/0; prove every real Vitest `/3` exits
      1 before import and leaves Redis untouched.
- [x] Prove zero database-15 keys, zero `medusa_lock:*`, zero database-15
      clients, and zero established test sockets after every service run.
- [x] Shut down Redis without persistence, remove all temporary artifacts, and
      confirm zero Redis processes or active sockets remain.
- [x] Prove unit graphs 85/65/20, 1/0/1, 83/63/20, and 2/2/0; fast 48/29/19,
      slow 5/5/0, and all 63/44/19 with exactly one Vitest Redis owner in all.
- [x] Pass package build, frozen offline install across 86 projects, workspace
      links, persistent typecheck, eight tooling tests, exact inventory,
      Cloudflare typecheck/import guards, and the complete 253-second
      foundation.
- [x] Update all four records, complete fresh reviews, and commit only the
      nine-file Turn 43 cut-over.

Result:

- package manifest hash:
  `7b9563f7b17177621e4b6fe503703c0d3b59609682715b1c30c06957b1687e1e`;
- root manifest hash:
  `15edb7a673a0490c8172b1c632c1174708ed929aa7e2777e82daf3ab3640b5b1`;
- workflow hash:
  `674cfbe4d288e04d6a70138aa7263fd41d52a7b5d8986628fd0036f896243e56`;
- typed contract hash:
  `66e89c9bf95873a450e24db410c0bbff4f551093560684bc49e54e1621100978`;
- accepted inventory digest:
  `43230df4bd1e5594fe39362f107171e0b6dbe73f79a4fd5f96753a77180b4611`;
- spec and both configs remain byte-for-byte normalized unchanged, with all
  seven cases exercised by both runners and clean Redis lifecycle;
- local YAML/contract and third-party Redis proof do not prove hosted Actions,
  cache/artifact transfer, the floating workflow Redis image, aggregate
  scheduling, or production Redis compatibility. No project-repository
  connector or git remote access, push, or hosted run occurred.

### Turn 44 - API Key Unit Vitest Shadow

Status: complete locally. Jest remains the unit default and the PostgreSQL-
backed integration lane remains Jest-authoritative.

Scope:

- audit the complete `@medusajs/api-key` source test lane before editing;
- add only `test:vitest` and a canonical package-local Node Vitest config;
- preserve the exact unit/integration Jest commands, specs, Jest config,
  dependencies, root scripts, workflow, inventory, and integration ownership;
- prove the current four-way unit matrix is runner-compatible without assigning
  the opt-in command any root, Turbo, or workflow owner.

Checklist:

- [x] Correct the planned one-file assumption: Jest discovers
      `src/__tests__/static-manifest.spec.ts` and
      `src/services/__tests__/noop.ts`.
- [x] Freeze two files, two tests, six textual assertions, both full names, zero
      skips/todos/snapshots, no Jest APIs, and the separate integration file.
- [x] Preserve the exact Jest `test` and `test:integration` values.
- [x] Add `test:vitest: vitest run --config vitest.config.mts` only.
- [x] Add the canonical Node config with source-only discovery, all four aliases,
      and no legacy Jest bridge or setup file.
- [x] Compare pre-edit Jest, post-edit Jest, and Vitest reporters at exact
      two-file/two-name/status parity.
- [x] List exactly both unit files under Vitest and list, but do not execute or
      migrate, the one PostgreSQL-backed integration file.
- [x] Prove direct Jest and Vitest commands pass, including CI-shaped `/4`
      commands at 1/1/0/0 with `--passWithNoTests`.
- [x] Prove all/scoped/general/serial unit graphs remain 85/65/20, 1/1/0,
      83/63/20, and 2/2/0.
- [x] Prove fast/slow/all integration graphs remain 48/29/19, 5/5/0, and
      63/44/19 with API Key integration owned once by Jest in fast/all.
- [x] Keep the remaining-Jest inventory exact at 68 configs, 107 scripts, 68
      owners, 406 API files, and digest
      `43230df4bd1e5594fe39362f107171e0b6dbe73f79a4fd5f96753a77180b4611`.
- [x] Pass package build, strict/no-unchecked config typecheck, frozen offline
      install across 86 projects, workspace links, Cloudflare type/import
      guards, isolated integration foundation, and the complete foundation.
- [x] Record the low-disk first-run failure and successful no-workaround reruns.
- [x] Update all four records, complete fresh reviews, and commit only Turn 44.

Result:

- package manifest moves from
  `85c1f211849b8cc72e4377e85cc4ea46f12935b64c9ff352beccf6f53eaadc37`
  to `0c7ee4ad26ab13a24bd8b99701b7c48e9f28a9b55c9d764271f1376228dcb742`;
- new Vitest config hash:
  `52958a368def2a79e1d0cfd5c8278d996f0f6fcd5f948d55124adbb2b9df5935`;
- unchanged static-manifest/noop/Jest-config hashes:
  `04483e85a009b663fd4eaa1073e6dff2593f0f8716565694f2b4caecd7dfeb4c`,
  `a8fce584e64fea146c0a551341a1a9e7effd794270765f7bebd9347c4942b75d`,
  and `ee7d6ed8b351066f0fd908d319e8ebd3ee00146b5dc51c36601ac5a21fcd95a9`;
- npm `latest` and installed commands remain Vite 8.1.4 and Vitest 4.1.10;
- no source assertion, integration behavior, dependency, lockfile, root script,
  workflow, CI ownership, persistence, or Cloudflare runtime changed;
- no project connector, remote repository, push, or hosted Actions run was used.

### Turn 45 - API Key Unit Vitest Cut-over

Status: complete locally. Vitest is the unit default, the exact Jest unit
command remains at `test:jest`, and PostgreSQL integration remains on Jest.

Scope:

- promote only the already-proven API Key unit command;
- move the byte-identical former Jest default to an explicit rollback and
  remove the temporary shadow key;
- register the existing config once in persistent strict tooling;
- preserve integration, workflow, dependency, lockfile, and runtime boundaries.

Checklist:

- [x] Capture fresh pre-cut-over Jest/Vitest JSON reports and exact two-file/
      two-test/full-name/status/zero-snapshot parity.
- [x] Change `test` to Vitest, add exact `test:jest`, remove `test:vitest`, and
      keep `test:integration` byte-identical.
- [x] Register `packages/modules/api-key/vitest.config.mts` exactly once in root
      `typecheck:test-runner-tooling`.
- [x] Re-prove post-cut-over default/rollback parity and unsharded discovery;
      list but do not execute the separate integration file.
- [x] Prove direct Vitest, direct Jest rollback, and authentic root `/4` runs
      all distribute 1/1/0/0 with `--passWithNoTests`.
- [x] Prove all/scoped/general/serial unit graphs remain 85/65/20, 1/1/0,
      83/63/20, and 2/2/0, with API Key now once on Vitest.
- [x] Prove fast/slow/all integration graphs remain 48/29/19, 5/5/0, and
      63/44/19, with API Key once on Jest in fast/all.
- [x] Accept only the remaining-Jest script-key move at unchanged counts and
      digest `eebfb1b76932592649e260810e19e746d3f97f009b95b93b21e8782092d4af3d`.
- [x] Pass standalone/persistent strict tooling, API Key build, frozen offline
      install, workspace policy, all Cloudflare gates, and complete foundation.
- [x] Update all four records, complete fresh reviews, and commit only Turn 45.

Result:

- package manifest hash becomes
  `98ed584b7b6c8490b8f01738e0d23161448c8536a3f422ff587344d78d5139a7`;
- root manifest hash becomes
  `da7f9cef83fc23e15ad534a105b1f4d169aba5037b10091b479f74b44c704722`;
- inventory file hash becomes
  `07481e892ad6da4853252a102a0f3afb0142a937f60b859644ec208b167cb1f3`,
  with 68 configs, 107 scripts across 68 owners, and 406 API files;
- exact parity remains two files, two tests, six textual assertions, and zero
  failures/skips/todos/snapshots before and after the switch;
- all seven graph triplets remain unchanged; only API Key's executable unit
  command changes from Jest to Vitest;
- the complete shared foundation passes in 243 seconds, including all 25
  Jest-default integration selectors and exact three-file/34-test adapter parity;
- no workflow edit, GitHub access, hosted-CI result, source/config change,
  dependency/lockfile change, or integration/runtime claim is included.

### Turn 46 - API Key Integration Vitest Shadow

Status: complete locally. Jest remains the authoritative integration runner;
Vitest is an opt-in shadow across the same three Node persistence backends.

Scope:

- extend the typed shared legacy bridge only for API Key's real fake-timer API;
- add one exact-file serial integration config and opt-in package command;
- add explicit API Key Vitest selection to PGlite without changing its default;
- preserve all assertions, defaults, rollback lanes, graphs, and CI ownership.

Checklist:

- [x] Freeze one file, 25 tests, 46 textual assertions, all full names, zero
      skips/todos/snapshots, and the existing Jest API counts.
- [x] Add only `useFakeTimers`, chained `setSystemTime`, and `useRealTimers` to
      the strict legacy bridge, with exact eight-key type/runtime contracts.
- [x] Add `test:integration:vitest` and a canonical serial config with the same
      four aliases and exact one-file include; keep `test:integration` on Jest.
- [x] Register the config once in persistent strict tooling and map only the
      explicit API Key Vitest PGlite selector to the shadow.
- [x] Prove pre/post Jest and post Vitest exact parity on MikroORM/PostgreSQL,
      PGlite, and Drizzle/SQLite: six quadrants at 1 file / 25 tests each.
- [x] Prove both real API Key PGlite selectors pass and the unqualified 25-lane
      matrix remains Jest-default with Translation first unsupported on Vitest.
- [x] Capture the authentic one-file Vitest `/3` failure and keep the shadow out
      of workflow ownership until a dedicated unsharded cut-over job exists.
- [x] Preserve graph triplets 85/65/20, 1/1/0, 83/63/20, 2/2/0, 48/29/19,
      5/5/0, and 63/44/19.
- [x] Keep inventory counts at 68 configs, 107 scripts across 68 owners, 406 API
      files, and two foundation Jest-API files.
- [x] Pass API Key build/default/rollback, strict tooling, nine tooling tests,
      frozen offline install, workspace policy, Cloudflare gates, and the
      complete 287.4-second foundation.
- [x] Safely stop and remove the isolated PostgreSQL cluster, update all five
      records, complete fresh reviews, and commit only Turn 46.

Result:

- bridge/config/package/root/inventory normalized-LF hashes are
  `79298af5735cf0cd0cbe94f7a90d83a425a0df5e366c9cc0676c0e48cd571ee1`,
  `27209ecc3e77d13c47bb8456a18ac2477b77ef7c1712b00543c75349a6ce27b8`,
  `a622569e1a79a187b17d16a8944c0c6e558f15305a73abb7ad2e3da8da3298b4`,
  `fb047a3e0dd4d1447d39eba98fe7f916db61af7a27a9b9ec9e726057d254f14f`,
  and `0a2586f3552082cdd53e6b8d79b3ee203c0fa32b4b311c5c0821b89be04ceaea`;
- assertion and fixture hashes remain
  `5d8cddfb7adc1be6187cd9a75e816d22e268d4dd3dfd4d1799c26715568797e2`
  and `d58ffcbac802bccc5b3263575dce2aa71973c84218d400eec1d780999bedde37`;
- no workflow, dependency, lockfile, production source, persistence
  implementation, catalog, privacy, publication, or runtime boundary changed.

### Turn 47 - API Key Integration Vitest Cut-over

Status: locally accepted with hosted execution explicitly deferred. Vitest is
the integration default; the exact Jest command remains as rollback.

Scope:

- promote only the already-proven API Key integration shadow;
- preserve both exact Jest rollback lanes and every source assertion;
- keep the PGlite matrix globally Jest-default through explicit rollback routing;
- exclude the one-file Vitest lane from generic `/3` and add unsharded CI
  ownership with fail-closed aggregate propagation.

Checklist:

- [x] Capture fresh pre-cut-over six-quadrant reports and exact normalized parity.
- [x] Switch `test:integration` to Vitest, add exact
      `test:integration:jest`, and remove `test:integration:vitest`.
- [x] Update PGlite so default API Key selection invokes the Jest rollback and
      explicit Vitest selection invokes the package default.
- [x] Re-prove all six post-cut-over quadrants and compare all twelve pre/post
      reports to one exact one-file/25-test baseline.
- [x] Re-prove both real API Key selectors and the direct one-file `/3` planning
      failure before excluding API Key only from the fast graph.
- [x] Add a runner-neutral, unsharded PostgreSQL API Key job and propagate all
      aggregate success/failure/cancelled/skipped states.
- [x] Extend the strict parsed contract first red, then green, covering package,
      config hashes, fast exclusion, service/job steps, and aggregate ownership.
- [x] Preserve unit graphs 85/65/20, 1/1/0, 83/63/20, and 2/2/0; prove fast,
      slow, and all integration graphs 47/28/19, 5/5/0, and 63/44/19.
- [x] Keep inventory at 68 configs, 107 scripts across 68 owners, 406 API files,
      and two foundation Jest-API files.
- [x] Pass API Key build/unit default/unit rollback, strict tooling, nine tooling
      tests, frozen offline install, workspace policy, all Cloudflare gates, and
      the complete 276.9-second foundation.
- [x] Safely stop/remove the isolated PostgreSQL cluster, update all five
      records, obtain fresh reviews, and commit only Turn 47.

Result:

- every one of the twelve pre/post reports has one file, 25 passed tests, zero
  failures/skips/todos/snapshots, and the same full-name/status set;
- changed package/root/PGlite/contract/inventory/workflow hashes are
  `c30c426a2be57ee6562f07349357a3c94d989cdcc2e3e873b707c85d28a0e850`,
  `63628f1f1a95973a977def1ccb24e02be7ca2a015c833092d1ceff434bdd30bb`,
  `86590a32be51db419d33054c29fa18599ff6781289b6324aeb7e59666e5008bd`,
  `858a82792fb6dc2c8c89c38f1392d61f5b0653697b4708b152a7f7aad5db66fe`,
  `ae6c07deb5bcd6b02ccf4260adb59657ad6fcede3a35e3e2f9000b5b6287e95d`,
  and `cae2adb1e7bdd055614c2f6d16494da915e24b85ab00ccf97f5e5748496ebc71`;
- source/config/bridge/workspace/lockfile boundaries remain unchanged;
- the direct CI job proves unsharded Vitest/PostgreSQL locally by contract only;
  hosted execution and hosted PGlite/Drizzle/Jest parity are not claimed.

### Turn 48 - Translation Unit Vitest Shadow

Status: complete locally. Jest remains the authoritative Translation unit and
integration runner; Vitest is an opt-in, package-local unit shadow only.

Scope:

- freeze Translation's exact source unit lane and integration exclusion;
- add only the canonical source-scoped Node Vitest config and `test:vitest`;
- preserve both Jest defaults, integration/PGlite/CI ownership, and every
  source assertion;
- keep dependencies, lockfile, catalogs, privacy, publication, production,
  persistence, workerd, D1, and Cloudflare runtime unchanged.

Checklist:

- [x] Capture the expected missing-shadow command failure before editing.
- [x] Freeze one file, one full test name, 11 textual assertions, matcher
      counts, and zero Jest APIs/hooks/async/skips/todos/snapshots.
- [x] Preserve the exact Jest `test` and `test:integration` values and add only
      `test:vitest: vitest run --config vitest.config.mts`.
- [x] Add the canonical shared Node/forks/SWC config with source-only discovery,
      absolute root, five existing aliases, and no bridge/setup.
- [x] Prove exact pre-Jest/post-Jest/Vitest reporter parity at one file and one
      passed test with zero failures/skips/todos/snapshots.
- [x] Prove unsharded Vitest list returns only the unit source and Jest
      integration list returns the separate integration spec without executing it.
- [x] Run all four Jest and Vitest `/4` package commands with
      `--passWithNoTests`; both runners produce 1/0/0/0 and all exit zero.
- [x] Preserve all seven graphs at 85/65/20, 1/1/0, 83/63/20, 2/2/0,
      47/28/19, 5/5/0, and 63/44/19 with Translation still Jest-owned.
- [x] Preserve the ordered 25-lane Jest-default PGlite matrix and prove explicit
      Translation Vitest selection still fails closed before spawning.
- [x] Keep remaining-Jest inventory byte-identical at 68 configs, 107 scripts,
      406 API files, and digest
      `2d775e3a998ccba2b88231bca95377c84ab0da1ee5601b2eb9aa8e51f98d5fa0`.
- [x] Pass Translation build, standalone strict/no-unchecked config typecheck,
      frozen offline install, workspace policy, Cloudflare gates, and the
      complete 262.3-second shared foundation.
- [x] Backfill Turn 47's commit, update the five applicable records, obtain
      fresh reviews, and commit only Turn 48.

Result:

- Translation manifest moves from
  `03118ea57a6965bfd4d6611c1f43b81e92cd9929569e354a8fcb468469a0c44b`
  to `306a1e9abc2be602cf371ecdead6a74ca616958665e8269899b839432a5a68cc`;
- the new config hash is
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- unchanged unit source, Jest config, integration source, and fixture hashes are
  `7c0edf4af74919cc6098f7fe20b47ee345bf0d4ef1333e8921203a808b1f9510`,
  `8d576098455343f4025810089e414c229b432e90557adaff7af8acf655d6432a`,
  `82c07ea1896c5b10f09616d708b0ecbff5f80645d5404f832c62c199016b4822`,
  and `b9fc360f33e2488ac15487b999dee2663fb736178d508e545894b914952a2ee6`;
- root/workspace/lockfile/inventory/workflow/PGlite hashes remain unchanged;
- no root tooling registration, integration migration, CI ownership, hosted
  result, GitHub access, dependency, or production/runtime claim is included.

### Turn 49 - Translation Unit Vitest Default Cut-Over

Status: complete locally. Vitest is the unit default, the exact Jest unit
command remains at `test:jest`, and Translation integration remains on Jest.

Scope:

- promote only the already-proven Translation unit command;
- move the byte-identical former Jest default to an explicit rollback and
  remove the temporary shadow key;
- register the existing config once in persistent strict tooling;
- preserve integration, PGlite, workflow, dependency, lockfile, and runtime
  boundaries.

Checklist:

- [x] Freeze exact pre-cut-over Jest/Vitest reports, manifest/config/source
      hashes, `/4` behavior, all seven graphs, and remaining-Jest ownership.
- [x] Set `test` to `vitest run --config vitest.config.mts`, move exact Jest to
      `test:jest`, remove `test:vitest`, and leave `test:integration` unchanged.
- [x] Register `./packages/modules/translation/vitest.config.mts` exactly once
      in the root strict/no-unchecked tooling typecheck with no new TS source.
- [x] Prove exact pre/post default/rollback parity: one file, one passed test,
      the same full name/status, 11 assertions, and zero skipped/todo/snapshots.
- [x] Prove all package and direct root/Turbo `/4` runs at 1/0/0/0 with
      `--maxWorkers=2 --passWithNoTests`.
- [x] Prove source-only Vitest discovery, separate Jest integration discovery,
      and fail-closed Translation Vitest PGlite selection.
- [x] Preserve unit graphs at 85/65/20, 1/1/0, 83/63/20, and 2/2/0 while
      switching only Translation's unit runner to Vitest.
- [x] Preserve integration graphs at 47/28/19, 5/5/0, and 63/44/19 with
      Translation integration still on Jest.
- [x] Review and accept the one-key remaining-Jest move from `test` to
      `test:jest`; preserve 68 configs, 107 scripts, and 406 API files at digest
      `c41c83b8cfeee131d905cf5305199b1ba09636721e63fe39e07773c47b72e33f`.
- [x] Pass Translation build/post-build default/list, strict tooling, workspace
      policy, frozen offline install, all Cloudflare gates, and the complete
      534.9-second foundation.
- [x] Backfill Turn 48's commit, update the four applicable records, obtain
      fresh reviews, and commit only Turn 49.

Result:

- Translation manifest moves from
  `306a1e9abc2be602cf371ecdead6a74ca616958665e8269899b839432a5a68cc`
  to `499021a976bc0c3a750788465b0ab17a35353b025e5398823434e7eca7217c39`;
- root manifest moves from
  `63628f1f1a95973a977def1ccb24e02be7ca2a015c833092d1ceff434bdd30bb`
  to `044322509ea41f6c17c51b681248f0a3284f6606c4447d3f11a2998f7fd59cbf`;
- inventory file moves from
  `ae6c07deb5bcd6b02ccf4260adb59657ad6fcede3a35e3e2f9000b5b6287e95d`
  to `8ce2ad53831d57160e39312d79d2614c2289beda7205613882d0bf8ed699aa91`;
- config, unit/integration sources, fixtures, Jest/TypeScript configs, workspace,
  lockfile, workflow, and PGlite orchestrator hashes remain unchanged;
- no integration migration, workflow/CI ownership change, hosted result, GitHub
  access, dependency, catalog/privacy/publication, persistence, or runtime claim
  is included.

### Turn 50 - Vite 8.1.5 Baseline Refresh

Status: complete locally. The refresh changes dependency ownership and the
lockfile only; it does not change any test runner owner or behavior boundary.

Scope:

- move the central `overrides.vite` owner and four direct manifest ranges from
  `^8.1.4` to `^8.1.5`;
- regenerate and frozen-install the pnpm 11 lock across all 86 workspaces;
- resolve the newly exposed fdir/Picomatch peer mismatch with `fdir@6.5.0`;
- re-prove the complete test-runner, migrated-package, admin consumer, and
  Cloudflare baselines;
- leave Translation integration and every other package lane untouched.

Checklist:

- [x] Reconfirm npm `latest` and installed versions: Vite 8.1.5,
      Vitest/coverage 4.1.10, and Rolldown 1.1.5.
- [x] Correct the plan's ownership language: this repo has one Vite override
      and four direct ranges, not a Vite catalog.
- [x] Update all five Vite declaration owners and generate a policy-clean lock.
- [x] Upgrade the admin plugin's fdir 6.1.1 to 6.5.0 after the fresh lock linked
      its Picomatch-3-only peer to installed Picomatch 4.
- [x] Pass lockfile-only and frozen installs across all 86 workspaces.
- [x] Prove all nine original Vitest workspaces at 494 files/622 tests and
      preserve Icons/UI coverage.
- [x] Prove all six migrated unit packages and seven service-free migrated
      integration packages under both Vitest defaults and Jest rollbacks.
- [x] Prove Currency (13) and API Key (25) PGlite assertions under both runners.
- [x] Pass admin plugin tests, ordered admin/plugin/dashboard/Storybook builds,
      ordered portable core builds, and the Cloudflare production build.
- [x] Pass Cloudflare typecheck, all import audits, workerd Currency/D1 behavior,
      exact workspace policy, and exact remaining-Jest inventory.
- [x] Reduce the peer audit to the four pre-existing unrelated groups with no
      Vite/Vitest/coverage/Cloudflare/Storybook/fdir mismatch.
- [x] Pass the final 293.1-second complete test-runner foundation.
- [x] Backfill Turn 49's commit, update all four applicable records, self-review
      the exact diff, and commit only Turn 50.

Result:

- Vite declaration ranges are `^8.1.5`; all 39 lock peer contexts resolve to
  Vite 8.1.5, with Vitest and coverage unchanged at 4.1.10;
- Vite's dependency floor resolves PostCSS 8.5.20 and NanoID 3.3.16; Rolldown
  remains 1.1.5;
- fdir 6.5.0 accepts the installed Picomatch 4 and its four-file/16-test suite
  plus real admin consumer builds pass;
- remaining-Jest ownership stays exact at 68 configs, 107 scripts, and 406 API
  files; workflow and PGlite orchestration are byte-identical;
- no test source, assertion, runner script/config, CI owner, persistence,
  production/runtime, workerd/D1 implementation, privacy/publication, or merge
  preparation changes.

### Turn 51 - Translation Integration Vitest Shadow

Status: complete locally. Jest remains the package integration default; Vitest
is opt-in only.

Scope:

- add `test:integration:vitest` and one exact-file package-local integration
  profile while preserving `test:integration` byte-for-byte;
- preserve the unchanged 60-test/104-assertion suite, fixture, timeout,
  spy/type APIs, service implementation, Jest config, and unit ownership;
- add explicit Translation Vitest routing to the serial PGlite orchestrator
  without changing its global Jest default;
- move the fail-closed Vitest frontier from Translation to Settings;
- prove exact Jest/Vitest parity on PostgreSQL, PGlite, and Drizzle/SQLite
  without adding workflow or aggregate ownership.

Checklist:

- [x] Freeze pre-edit Jest results and immutable hashes on all three backends.
- [x] Add the canonical integration profile with Translation's five aliases
      and sole integration include.
- [x] Register the config exactly once in strict tooling and freeze the
      manifest/config/source/fixture/Jest ownership contract.
- [x] Pass all nine normalized pre/post runner/backend comparisons at the same
      60-name/status digest.
- [x] Pass both real Translation PGlite selectors and keep the 25-lane default
      matrix on Jest with Settings fail-closed for Vitest.
- [x] Prove real Vitest `/3` exits 1 because one file cannot satisfy three
      shards; retain no CI owner in this shadow turn.
- [x] Preserve all seven task graphs at 85/65/20, 1/1/0, 83/63/20, 2/2/0,
      47/28/19, 5/5/0, and 63/44/19.
- [x] Pass Translation build/unit default/unit rollback/integration commands,
      full runner foundation, inventory, frozen install, workspace policy, and
      all Cloudflare portability/workerd gates.
- [x] Stop and remove the isolated PostgreSQL 18 cluster without touching the
      machine service.
- [x] Backfill Turn 50's commit, update all five applicable records, review the
      exact diff, and commit only Turn 51.

Result:

- Jest remains authoritative through `test:integration`; the sole new package
  command is `test:integration:vitest`;
- all nine normalized states match digest
  `8025698d0223bf2025a09234db22efbb35795bea399ad5f86b2d9b81cf53ea90`;
- the PGlite matrix remains globally Jest-default, Translation accepts an
  explicit Vitest selector, and Settings is the next unsupported lane;
- remaining-Jest counts stay 68/107/406 at accepted digest
  `a2c432f27f7510d7871b1b8251d4bea2f293511e7a8dfa960eaff99f6ff91b96`;
- no workflow, dependency, lockfile, persistence implementation, production
  source, privacy/publication, or merge-preparation change is included.

### Turn 52 - Translation Integration Vitest Default Cut-Over

Status: complete locally; hosted execution remains deferred.

Scope:

- promote the proven Vitest integration command to `test:integration`;
- retain the exact Jest value at `test:integration:jest` and remove the
  temporary shadow key;
- route Translation's default-Jest PGlite selector to the rollback and explicit
  Vitest selection to the package default;
- exclude the one-file suite from the generic fast `/3` matrix;
- add one runner-neutral, unsharded PostgreSQL workflow job and propagate all
  terminal states through the stable package aggregate.

Checklist:

- [x] Freeze fresh pre-cut-over Jest/Vitest reports on PostgreSQL, PGlite, and
      Drizzle/SQLite.
- [x] Switch only manifest/orchestrator ownership and preserve all source,
      assertion, fixture, config, and persistence hashes.
- [x] Parse and freeze the exact dedicated PostgreSQL job, fast exclusion, and
      aggregate failure/cancellation/skip/success contract.
- [x] Pass all 12 pre/post runner/backend reports at exact 60-name/status
      parity and normalized digest
      `8025698d0223bf2025a09234db22efbb35795bea399ad5f86b2d9b81cf53ea90`.
- [x] Pass both real Translation PGlite selectors after their ownership swap.
- [x] Confirm authentic Vitest `/3` exits 1 and dedicated unsharded ownership is
      required.
- [x] Preserve unit graphs and change fast integration only to 46/27/19;
      retain slow 5/5/0 and all 63/44/19 with Translation once on Vitest.
- [x] Pass build/unit lanes, strict tooling, exact inventory, frozen install,
      workspace policy, full foundation, and all Cloudflare portability/workerd
      gates.
- [x] Backfill Turn 51's commit, update all five applicable records, clean the
      isolated PostgreSQL proof, review the exact diff, and commit only Turn 52.

Result:

- Translation unit and integration defaults are Vitest, with exact unit and
  integration Jest rollbacks;
- the global PGlite matrix remains Jest-default and Settings remains the first
  unsupported Vitest lane;
- the dedicated job locally proves the authoritative PostgreSQL command and
  the aggregate contract is fail-closed; its first hosted result is not
  claimed;
- remaining-Jest counts remain 68/107/406 at accepted digest
  `345a7cec5fdb071f78e9efadf91a3bdbd65e44912e14aaac1acd769d127a69e3`;
- no dependency, lockfile, persistence implementation, production source,
  workerd/D1 implementation, privacy/publication, or merge-preparation change is
  included.

### Turn 53 - Vite 8.2.0 Baseline Refresh

Status: complete locally. Runner ownership is unchanged.

Scope:

- respond to the live npm `latest` moving from Vite 8.1.5 to 8.2.0;
- move only the central override and four direct manifest ranges to `^8.2.0`;
- accept pnpm's exact `vite@8.2.0` release-age exception because the stable
  release is newer than the repository's normal minimum-age window;
- regenerate/frozen-install only Vite's dependency and peer closure;
- shift the untouched Settings shadow/cut-over pair to Turns 54/55.

Checklist:

- [x] Verify npm `latest` and installed versions: Vite 8.2.0, Vitest/coverage
      4.1.10, and built-in Rolldown 1.2.0.
- [x] Confirm ownership remains one override plus four direct manifests, with
      no Vite catalog.
- [x] Audit the lock delta as Vite/Rolldown/Lightning CSS/PostCSS/OXC and their
      required platform/runtime closure only.
- [x] Pass frozen install and supply-chain policy across all 86 workspaces,
      with 39 Vite 8.2.0 lock references and zero 8.1.5 references.
- [x] Pass all nine original Vitest workspaces at 494 files/622 tests, DML's
      intentional zero-file pass, and unchanged Icons/UI V8 coverage.
- [x] Pass admin plugin/bundler, draft-order extension, dashboard preview,
      Storybook, and ordered portable core builds.
- [x] Preserve all seven task graphs at 85/65/20, 1/1/0, 83/63/20, 2/2/0,
      46/27/19, 5/5/0, and 63/44/19.
- [x] Pass workspace policy, exact inventory, Cloudflare typecheck/build/import
      audits, and real workerd Currency/D1 behavior.
- [x] Pass the final 281.4-second complete test-runner foundation.
- [x] Backfill Turn 52's commit, update all applicable records, review the
      exact diff, and commit only Turn 53.

Result:

- Vite is installed and locked at 8.2.0 with Rolldown 1.2.0; Vitest and
  coverage remain 4.1.10;
- the exact release-age exception is limited to `vite@8.2.0`; every other
  package remains under the normal strict age policy;
- peer auditing remains at the same four unrelated legacy groups, with no
  refreshed-toolchain mismatch;
- Vite's new future-native-loader warnings are recorded but not mixed with this
  dependency-only change because current Vite 8.2/Vitest 4 behavior passes;
- follow-up `b6071d16cd` corrects five stale effective importer specifiers and
  eleven peer-range metadata entries to `^8.2.0` without changing resolved
  package or snapshot keys; frozen install now passes against the canonical
  corrected lock;
- remaining-Jest ownership stays exact at 68/107/406 and all runner commands,
  assertions, configs, rollbacks, workflow owners, and persistence/runtime
  boundaries remain unchanged.

### Turn 54 - Settings Unit Vitest Shadow

Status: complete locally. Jest remains authoritative for Settings unit and
integration; Vitest is an opt-in package-local unit shadow only.

Scope:

- freeze Settings' exact source unit lane, aliases, and integration exclusion;
- add only the canonical source-scoped Node Vitest config and `test:vitest`;
- preserve both Jest defaults, integration/PGlite/CI ownership, and every
  source assertion;
- keep dependencies, lockfile, catalogs, privacy, publication, production,
  persistence, workerd, D1, and Cloudflare runtime unchanged.

Checklist:

- [x] Capture the expected missing-shadow command failure before editing.
- [x] Freeze one file, one full test name, ten textual assertions, matcher
      counts, and zero Jest APIs/hooks/async/skips/todos/snapshots.
- [x] Preserve the exact Jest `test` and `test:integration` values and add only
      `test:vitest: vitest run --config vitest.config.mts`.
- [x] Add the shared Node/forks/SWC config with source-only discovery, absolute
      root, five existing aliases, and no bridge/setup.
- [x] Prove exact pre-Jest/post-Jest/Vitest reporter parity at one file and one
      passed test with zero failures/skips/todos/snapshots.
- [x] Prove Vitest lists only the unit source while Jest integration listing
      still returns only the separate 11-case database-backed spec.
- [x] Run all four real Jest and Vitest `/4` commands with
      `--maxWorkers=2 --passWithNoTests`; both runners produce 1/0/0/0.
- [x] Preserve all seven graphs at 85/65/20, 1/1/0, 83/63/20, 2/2/0,
      46/27/19, 5/5/0, and 63/44/19 with Settings still Jest-owned.
- [x] Preserve the ordered 25-lane Jest-default PGlite matrix and prove explicit
      Settings Vitest selection still fails closed before spawning.
- [x] Keep remaining-Jest ownership byte-identical at 68 configs, 107 scripts,
      406 API files, and digest
      `345a7cec5fdb071f78e9efadf91a3bdbd65e44912e14aaac1acd769d127a69e3`.
- [x] Pass Settings build, standalone strict/no-unchecked config typecheck,
      frozen offline install, workspace policy, the 286-second complete
      foundation, and all Cloudflare portability/workerd gates.
- [x] Backfill Turn 53's commit, update all applicable records, review the
      exact diff, and commit only Turn 54.

Result:

- Settings manifest moves from
  `50a9c61938b34beced24c1b4cfeb7cab2300f76ac03a3795cd00b7f296eda1fe`
  to `5ebf3c6e1eb7bfb398b9764e0f47c855729fa31ac3b1f4bfcc2fb50cbc401b09`;
- the new config hash is
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- unchanged unit source, Jest config, TypeScript config, and integration source
  hashes are
  `28415d1a9bad8360b20e458ce4bc9abc886824ff0c3c46b943d105b73f3f9dcb`,
  `abe0c3cacda174ac06f22404fe754c2d9a762c311164b6f97bd23ac0cd89a470`,
  `f32039f892e4b6995f132bb8679d21f3d5528dfa51cce1f96002a110de1b8f95`,
  and `672ffc69ac91c98fc19ab19ccd1490f4f18157a66b8246bb3b71615aed9e9df5`;
- root/workspace/lockfile/inventory/workflow/PGlite hashes remain unchanged;
- no root tooling registration, integration migration, CI ownership, hosted
  result, GitHub access, dependency, or production/runtime claim is included.

### Turn 55 - Settings Unit Vitest Default Cut-Over

Status: complete locally. Vitest is the unit default, exact Jest remains at
`test:jest`, and Settings integration remains Jest-authoritative.

Scope:

- promote only the already-proven Settings unit command;
- move the byte-identical former Jest default to an explicit rollback and
  remove the temporary shadow key;
- register the existing config once in persistent strict tooling;
- preserve integration, PGlite, workflow, dependency, lockfile, and runtime
  boundaries.

Checklist:

- [x] Verify live/installed Vite 8.2.0, Vitest 4.1.10, and Rolldown 1.2.0.
- [x] Capture the expected-red missing `test:jest` command and exact pre-cut-over
      Jest/Vitest reports.
- [x] Set `test` to Vitest, move exact Jest to `test:jest`, remove
      `test:vitest`, and leave `test:integration` unchanged.
- [x] Register `packages/modules/settings/vitest.config.mts` exactly once in
      root strict/no-unchecked tooling without new TypeScript source.
- [x] Prove every pre/post default/rollback comparison at one file/test, the
      same name/status, and zero failures/skips/todos/snapshots.
- [x] Prove post-cut-over Vitest default and Jest rollback `/4` behavior at
      1/0/0/0 with `--maxWorkers=2 --passWithNoTests`.
- [x] Preserve all seven graph shapes while switching only Settings' unit
      command to Vitest in all/scoped/general unit graphs.
- [x] Preserve Jest integration discovery, ordered PGlite position five, and
      explicit Settings Vitest fail closure before spawning.
- [x] Review and accept the one-key remaining-Jest move from `test` to
      `test:jest`; preserve 68/107/406 counts at digest
      `d87dc3c4caa49878ddd77802f9f0276d558c1000eebe13c44f2ce62ac9e44757`.
- [x] Pass Settings build, strict tooling, frozen offline install, workspace
      policy, the 294.9-second foundation, and all Cloudflare
      portability/workerd gates.
- [x] Backfill Turn 54's commit, update applicable records, review the exact
      diff, and commit only Turn 55.

Result:

- Settings manifest moves from
  `5ebf3c6e1eb7bfb398b9764e0f47c855729fa31ac3b1f4bfcc2fb50cbc401b09`
  to `8b83739025b0e6f6cf21f28762a4c05a9ceb06b78932c1c5f3b1a7851c4032c6`;
- root manifest moves from
  `f142205ee3b8ea1938bdc0792aedea1fae9bc366374fec557c4caa77777408a9`
  to `b6cd530ce4d1440cd31b1d53f2dfec86d6291e6d4922b4446273cc30dee60523`;
- inventory moves from
  `9de145966b8db11c147f24d7063f729c72141280e8c5629604331c82fb01d194`
  to `e7d2e6a76eaacae3c964a14fab6edfd9388dbac2b318ea93540505abcef2beaa`;
- config, sources, Jest/TypeScript configs, workspace, corrected lockfile,
  workflow, and PGlite orchestrator hashes remain unchanged;
- no integration migration, workflow/CI ownership change, hosted result,
  GitHub access, dependency, persistence, or production/runtime claim is
  included.

### Turn 56 - Settings Integration Vitest Shadow

Status: complete locally. Jest remains the integration default; Vitest is
manual through `test:integration:vitest`.

Scope:

- add one exact-file serial Settings integration profile and manual script;
- preserve the byte-identical Jest integration default and both unit commands;
- register the config once in strict tooling and expose only explicit Settings
  Vitest selection in the PGlite orchestrator;
- preserve workflow, dependency, lockfile, persistence, and runtime boundaries.

Checklist:

- [x] Verify installed Vite 8.2.0, Vitest 4.1.10, and Rolldown 1.2.0.
- [x] Freeze expected-red missing shadow/selector behavior, the one integration
      file, 11 test names, 29 textual assertions, timeout, and source digest.
- [x] Pass pre-edit Jest at one file / 11 tests / zero snapshots separately on
      PostgreSQL, PGlite, and Drizzle/SQLite.
- [x] Add only `test:integration:vitest` and the canonical one-file, five-alias
      serial profile; leave `test:integration` byte-identical.
- [x] Register the config exactly once in root strict/no-unchecked tooling and
      freeze package/config/source/Jest ownership in the typed contract.
- [x] Pass all nine pre/post Jest/Vitest x backend reports with identical
      file, names/statuses, counts, snapshots, and digest
      `1131bec9188e368dec5fd14f0dcf36849957697d7b2b21316fbca10854df5a6b`.
- [x] Pass both real Settings PGlite selectors, keep the global Jest default,
      and move fail closure to Store before spawning.
- [x] Prove all three authentic Vitest `/3` invocations exit 1 before import;
      retain no workflow/aggregate owner in this shadow turn.
- [x] Preserve all seven graphs at 85/65/20, 1/1/0, 83/63/20, 2/2/0,
      46/27/19, 5/5/0, and 63/44/19.
- [x] Keep remaining-Jest counts at 68/107/406 and accept only the two
      inventoried orchestration/verifier digest moves at
      `336bfe35a03d775627c2dd71626121c3e1749aa7a8c4f0fc33cd6c307b23862a`.
- [x] Pass Settings build/unit lanes, strict tooling, frozen install,
      workspace policy, the 268.8-second foundation, and all Cloudflare
      portability/workerd gates.
- [x] Stop/remove the isolated PostgreSQL 18 cluster, verify port 55442 closed,
      update all five applicable records, review, and commit only Turn 56.

Result:

- Settings manifest moves from
  `8b83739025b0e6f6cf21f28762a4c05a9ceb06b78932c1c5f3b1a7851c4032c6`
  to `ba5759d30088307ca2efc38406cf820d7593ea3933533ad730e50c54bd682edd`;
- root manifest moves from
  `b6cd530ce4d1440cd31b1d53f2dfec86d6291e6d4922b4446273cc30dee60523`
  to `a32e1cbe30f08d39c7f0ff83bbfe75140402af6baa314b459efc998e02874cbd`;
- new integration config hash is
  `7a162924556ae07e68c3fd942989d8674818ad0a17c0f36cdaf3e5b8fc73fbc0`;
- source/Jest/unit configs, workspace, corrected lockfile, workflow,
  dependencies, persistence implementation, and production/runtime boundaries
  remain unchanged;
- no hosted result or GitHub access is claimed.

### Turn 57 - Settings Integration Vitest Cut-Over

Status: complete locally; the first hosted result remains deferred. Vitest is
the integration default and the exact former Jest command is retained at
`test:integration:jest`.

Scope:

- promote only the already-proven Settings integration shadow;
- preserve source assertions, unit default/rollback, global PGlite Jest
  default, persistence implementations, dependencies, lockfile, and runtime;
- remove Settings from generic `/3` fast ownership and add one dedicated
  runner-neutral, unsharded PostgreSQL workflow job with aggregate propagation.

Checklist:

- [x] Capture expected-red missing Jest rollback and missing dedicated owner.
- [x] Pass fresh pre-cut-over Jest/Vitest reports at one file / 11 tests on
      PostgreSQL, PGlite, and Drizzle/SQLite.
- [x] Promote the default, retain the byte-identical rollback, remove the
      temporary shadow key, and update both PGlite runner mappings.
- [x] Exclude Settings from the generic fast graph and add the dedicated
      PostgreSQL job to every aggregate terminal expression.
- [x] Freeze the exact fast command, package scripts, job/service/steps, and
      aggregate shape through strict/no-unchecked TypeScript tooling.
- [x] Pass all six post-cut-over default/rollback backend reports and compare
      all 12 states at exact normalized digest
      `1131bec9188e368dec5fd14f0dcf36849957697d7b2b21316fbca10854df5a6b`.
- [x] Pass both real Settings PGlite selectors and keep Store fail-closed.
- [x] Prove direct Settings `/3` exits 1 for all three shards.
- [x] Preserve unit graph shapes at 85/65/20, 1/1/0, 83/63/20, and 2/2/0;
      move fast integration to 45/26/19; preserve slow/all at 5/5/0 and
      63/44/19 with Settings exactly once in all.
- [x] Keep remaining-Jest counts at 68/107/406 and accept digest
      `85c05079e8eb99e90f64152fae9d6cdf4b584e7e346f10c9624ed5ec78ade22c`.
- [x] Pass the exact workflow command against isolated PostgreSQL 18 on
      `127.0.0.1:55443`, strict tooling, frozen install, workspace policy,
      Settings build/unit lanes, the 295.8-second foundation, and every
      Cloudflare portability/workerd gate.
- [x] Stop/remove the isolated cluster and reports, verify ports 55443/8791
      closed with no scoped runtime process, update all five records, review,
      and commit only Turn 57.

Result:

- root manifest moves from
  `a32e1cbe30f08d39c7f0ff83bbfe75140402af6baa314b459efc998e02874cbd`
  to `fcd05db692b4f7f6684baa2302d890336cb7dbd614f21d5f653a0c761549f661`;
- Settings manifest moves from
  `ba5759d30088307ca2efc38406cf820d7593ea3933533ad730e50c54bd682edd`
  to `6c5c40832e5cc20788b8949ebf774165c677dfe91b5cd8b33e5a271ef206c7d0`;
- PGlite orchestrator moves from
  `1696c296bc652bf75dd5c672a81c659de42f4bb3543f6c58cb1d3704b52d69bf`
  to `7bc65022a844a8edf2a3d611e555f92bb014235a1128d01bd25e077076616c27`;
- strict contract, inventory file, and workflow move to
  `ad397d05465d24251ed9330dfdadc66af524276d126b9c58ad3451b6a6d84d57`,
  `f98003203490cb65fa713bce21204f6f0309d420b1dd5392496b89fe8cbf91bf`,
  and `a08a800a72f521f819c7bcf48a50bfc43a113288a7efdcd24f431f819ae3a2ad`;
- integration config, source, foundation verifier, workspace, and lockfile stay
  unchanged;
- no hosted result, GitHub access, adapter/runtime change, or merge-preparation
  claim is included.

### Turn 58 - Store Unit Vitest Shadow

Status: complete locally. Store remains Jest-authoritative for both unit and
integration; Vitest is manual through `test:vitest`.

Scope:

- audit Store's actual source unit discovery before implementation;
- preserve both Jest commands and add only a source-only unit shadow;
- keep integration/PGlite capability, root/Turbo/workflow ownership,
  dependencies, lockfile, persistence, and runtime unchanged.

Checklist:

- [x] Verify installed Vite 8.2.0, Vitest 4.1.10, and Rolldown 1.2.0.
- [x] Capture expected-red missing shadow/config and Store PGlite Vitest fail
      closure.
- [x] Correct the one-file assumption: freeze two source files, two full test
      names, six textual assertions, zero Jest APIs, and zero snapshots.
- [x] Pass pre-edit Jest at two files / two tests / zero snapshots and freeze
      normalized digest
      `90a03ed5034fa67349c6d826af88f8dc229553a33e0737150b8a7bdd6dc10c3f`.
- [x] Add only `test:vitest` and a canonical source-only, five-alias Node
      profile; leave both Jest commands byte-identical.
- [x] Pass post-edit Jest/Vitest exact parity and post-build discovery with no
      integration or `dist` copy.
- [x] Pass both real `/4` matrices at 1/1/0/0 and prove exact 2/2 aggregate
      signature coverage for each runner.
- [x] Preserve Store integration discovery and explicit PGlite Vitest fail
      closure.
- [x] Preserve all seven graph shapes at 85/65/20, 1/1/0, 83/63/20, 2/2/0,
      45/26/19, 5/5/0, and 63/44/19 with Store still Jest-owned.
- [x] Keep remaining-Jest ownership byte-identical at 68/107/406 and digest
      `85c05079e8eb99e90f64152fae9d6cdf4b584e7e346f10c9624ed5ec78ade22c`.
- [x] Pass Store build, standalone strict/no-unchecked config typecheck, frozen
      install, workspace policy, the 276.3-second foundation, and all
      Cloudflare portability/workerd gates.
- [x] Verify port 8791 closed with no scoped runtime process, remove all
      reports, update all five applicable records, review, and commit only
      Turn 58.

Result:

- Store manifest moves from
  `188723695900f67ed0b818e705c72c590234fdcee0ba71f07d0d75f8509a67e3`
  to `6111814288334b0aee162f5428bb351284eb1eb939cd17277c99ef5c7a2506a1`;
- new Store Vitest config hash is
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- sources, Jest/TypeScript configs, integration behavior, root manifest,
  strict tooling, inventory, PGlite, workflow, workspace, corrected lockfile,
  dependencies, persistence, and production/runtime boundaries remain
  unchanged;
- no default switch, hosted result, GitHub access, or integration/runtime claim
  is included.

### Turn 59 - Store Unit Vitest Cut-Over

Status: complete locally. Store unit defaults to Vitest with exact Jest
rollback; Store integration remains Jest.

Scope:

- promote only the proven two-file unit shadow;
- retain the byte-identical Jest rollback and register existing config
  ownership exactly once;
- keep integration/PGlite capability, workflow, dependencies, lockfile,
  persistence, production, and Cloudflare runtime unchanged.

Checklist:

- [x] Capture fresh pre-cut-over Jest/Vitest parity and both real `/4`
      matrices.
- [x] Switch `test` to Vitest, move the exact former Jest command to
      `test:jest`, and remove `test:vitest`.
- [x] Register Store's existing config exactly once in strict/no-unchecked
      tooling.
- [x] Pass exact pre/post default/rollback parity at two files, two tests, six
      assertions, zero failures/skips/todos/snapshots, and digest
      `90a03ed5034fa67349c6d826af88f8dc229553a33e0737150b8a7bdd6dc10c3f`.
- [x] Pass fresh pre/post Jest and Vitest `/4` matrices at 1/1/0/0 with exact
      aggregate signature ownership.
- [x] Preserve Store integration discovery and explicit PGlite Vitest fail
      closure.
- [x] Preserve all seven graph shapes at 85/65/20, 1/1/0, 83/63/20, 2/2/0,
      45/26/19, 5/5/0, and 63/44/19; move only Store unit ownership.
- [x] Preserve remaining-Jest counts at 68/107/406 and accept ownership digest
      `f072923b9665dd48a67dc4a5f7611cd633d94cbfeba0264a1fe8e1f467f28572`.
- [x] Pass Store build, frozen offline install, workspace policy, the
      300.2-second foundation, and all Cloudflare portability/workerd gates.
- [x] Verify port 8791 closed with no scoped runtime process, remove all
      reports, update the four applicable records, review, and commit only
      Turn 59.

Result:

- root manifest moves from
  `fcd05db692b4f7f6684baa2302d890336cb7dbd614f21d5f653a0c761549f661`
  to `99f3a85377d4eb6e9321fa254ae0071d9413b820e6978ead7c9baa30eacf34d0`;
- Store manifest moves from
  `6111814288334b0aee162f5428bb351284eb1eb939cd17277c99ef5c7a2506a1`
  to `6c4815417064e434470c149c6e773b22edd77e7eff06aa2714b30ad78b824d69`;
- config/source/integration/PGlite/workflow/workspace/lockfile/dependencies/
  persistence and production/runtime boundaries remain unchanged;
- no hosted result, GitHub access, integration default, or merge-preparation
  claim is included.

### Turn 60 - Store Integration Vitest Shadow

Status: complete locally. Store integration remains Jest-authoritative and
Vitest is manual through `test:integration:vitest`.

Scope:

- audit and freeze Store's unchanged database-backed integration boundary;
- add only an exact-file Vitest shadow and explicit PGlite selector;
- keep default/CI ownership, dependencies, lockfile, persistence, production,
  and runtime unchanged.

Checklist:

- [x] Capture expected-red missing script/config and Store Vitest PGlite fail
      closure.
- [x] Freeze one file, 12 tests, 15 assertions, one timeout bridge call, zero
      skips/todos/snapshots, and unchanged source/fixture hashes.
- [x] Pass fresh pre-edit Jest baselines on PostgreSQL, PGlite, and
      Drizzle/SQLite.
- [x] Add only `test:integration:vitest`, an exact-file five-alias serial
      profile, strict ownership, and explicit Store Vitest PGlite mapping.
- [x] Pass exact nine-state parity at one file / 12 tests and digest
      `19726c857ba3909d0e724c0d90e365b22c19378e5fe9d966fdf2313f2a22866b`.
- [x] Pass both real Store PGlite selectors and move fail closure to Auth.
- [x] Prove all three authentic Vitest `/3` invocations exit 1 before import.
- [x] Preserve graph shapes 85/65/20, 1/1/0, 83/63/20, 2/2/0, 45/26/19,
      5/5/0, and 63/44/19 with Store still Jest-owned in integration.
- [x] Preserve remaining-Jest counts at 68/107/406 and accept digest
      `0bdc0cf1c8f889f36319dc8a60c9e99512a08680ab0841d28870e2313574c098`.
- [x] Pass Store build/unit lanes, strict tooling, frozen install, workspace
      policy, the 332.2-second foundation, and all Cloudflare gates.
- [x] Stop/remove isolated PostgreSQL, verify ports 55444/8791 and scoped
      processes clean, remove reports, update five records, review, and commit
      only Turn 60.

Result:

- root manifest moves from
  `99f3a85377d4eb6e9321fa254ae0071d9413b820e6978ead7c9baa30eacf34d0`
  to `e5830ea871b811ee439650280cc88f3f46c4cc66541fe034973ec9e9c6c1fc3a`;
- Store manifest moves from
  `6c4815417064e434470c149c6e773b22edd77e7eff06aa2714b30ad78b824d69`
  to `ab85ee6ad7645c1f0d964d5f8661007242a4be8bcec45862dcc80aa9b0acf478`;
- new integration config hash is
  `72604382520d901bd177420fed668dea22347518b1a343705f6ea121ff13bce9`;
- source/fixture/config/workflow/workspace/lockfile/dependencies/persistence and
  production/runtime boundaries remain unchanged;
- no default switch, hosted result, GitHub access, or merge-preparation claim
  is included.

### Turn 61 - Store Integration Vitest Cut-Over

Status: complete locally. Store unit and integration default to Vitest with
exact Jest rollbacks; the first hosted result is deferred.

Scope:

- promote only the proven integration shadow and retain the exact former Jest
  command as `test:integration:jest`;
- preserve global PGlite Jest-default behavior while routing explicit Store
  Vitest selection to the default;
- exclude the one-file suite from generic `/3` fast sharding and add one
  dedicated runner-neutral, unsharded PostgreSQL job with aggregate
  propagation;
- keep source, fixtures, assertions, integration config, dependencies,
  lockfile, persistence, production, and Cloudflare runtime unchanged.

Checklist:

- [x] Capture fresh pre-cut-over Jest/Vitest parity and fresh post-cut-over
      default/rollback evidence on PostgreSQL, PGlite, and Drizzle/SQLite.
- [x] Switch `test:integration` to Vitest, move the exact former Jest command
      to `test:integration:jest`, and remove `test:integration:vitest`.
- [x] Preserve all 12 states at one file, 12 tests, zero
      failures/skips/todos/snapshots, and digest
      `19726c857ba3909d0e724c0d90e365b22c19378e5fe9d966fdf2313f2a22866b`.
- [x] Pass both real Store PGlite selectors and retain Auth fail closure.
- [x] Prove all three authentic `/3` invocations exit 1 before import and the
      dedicated unsharded default command passes 12/12 against PostgreSQL.
- [x] Preserve unit graphs at 85/65/20, 1/1/0, 83/63/20, and 2/2/0; move fast
      integration to 44/25/19; preserve slow/all at 5/5/0 and 63/44/19 with
      Store owned once by Vitest in all.
- [x] Preserve remaining-Jest counts at 68/107/406 and accept digest
      `bf09ea4647e8eb27fa1baa019c1ec531b56319b5a21f3992141aa0be9e663849`.
- [x] Pass Store build/unit lanes, strict tooling, frozen install, workspace
      policy, the 360.6-second foundation, and all Cloudflare gates.
- [x] Stop/remove isolated PostgreSQL, verify ports 55445/8791 and scoped
      processes clean, remove reports, update five records, review, and commit
      only Turn 61.

Result:

- root manifest moves from
  `e5830ea871b811ee439650280cc88f3f46c4cc66541fe034973ec9e9c6c1fc3a`
  to `4e690749e5629ea18fc719a8f5ebeeae8ec8e8a207b5925a4817c6fed656f914`;
- Store manifest moves from
  `ab85ee6ad7645c1f0d964d5f8661007242a4be8bcec45862dcc80aa9b0acf478`
  to `f304d157e061cd66cb568c95f5ca38d54ef746f8493246edff96a0ec0b28f67e`;
- integration config/source/fixture/workspace/lockfile/dependencies/persistence
  and production/runtime boundaries remain unchanged;
- workflow and PGlite ownership change exactly as recorded; no hosted result,
  GitHub access, or merge-preparation claim is included.

### Turn 62 - Auth Unit Vitest Shadow

Status: complete locally. Auth remains Jest-authoritative for unit and
integration; Vitest is manual through `test:vitest`.

Scope:

- audit Auth's actual source unit discovery, aliases, assertions, and
  compatibility requirements;
- preserve both Jest defaults and add only a source-only unit shadow;
- keep integration/PGlite capability, root/Turbo/workflow ownership,
  dependencies, lockfile, persistence, and runtime unchanged.

Checklist:

- [x] Verify installed Vite 8.2.0, Vitest 4.1.10, and Rolldown 1.2.0.
- [x] Capture expected-red missing shadow/config and Auth integration PGlite
      Vitest fail closure.
- [x] Freeze one source file, one full test name, ten textual assertions, four
      aliases, zero Jest APIs, and zero snapshots.
- [x] Pass pre-edit Jest, post-edit Jest, post-edit Vitest, and post-build
      Vitest at one file/test and normalized digest
      `4d55bc4e4dd8e8e6ad3741be3946df33f51a32f8c0f494370284025420f007d8`.
- [x] Add only `test:vitest` and a canonical source-only four-alias Node
      profile without the legacy bridge; leave both Jest commands
      byte-identical.
- [x] Pass both real `/4` matrices at 1/0/0/0 with exact aggregate signature
      coverage and no `dist` or integration duplicate.
- [x] Preserve all seven graph shapes at 85/65/20, 1/1/0, 83/63/20, 2/2/0,
      44/25/19, 5/5/0, and 63/44/19 with Auth still Jest-owned.
- [x] Preserve remaining-Jest ownership byte-identically at 68/107/406 and
      digest
      `bf09ea4647e8eb27fa1baa019c1ec531b56319b5a21f3992141aa0be9e663849`.
- [x] Pass Auth build, standalone strict config typecheck, frozen install,
      workspace policy, the 405.1-second foundation, and all Cloudflare gates.
- [x] Verify port 8791 and scoped processes clean, remove reports, update five
      records, review, and commit only Turn 62.

Result:

- Auth manifest moves from
  `57049b28cc7e3a647d600ae3e0ba5540e1e287f78d9e6fbb6bb64d2f68049809`
  to `90186fe2cff3e9c387f45d0fa9d20410690256b7ee87ad3a38927b427d4b1ffd`;
- new Auth Vitest config hash is
  `52958a368def2a79e1d0cfd5c8278d996f0f6fcd5f948d55124adbb2b9df5935`;
- source, Jest/TypeScript configs, integration behavior, root manifest, strict
  tooling, inventory, PGlite, workflow, workspace, corrected lockfile,
  dependencies, persistence, and production/runtime boundaries remain
  unchanged;
- no default switch, hosted result, GitHub access, integration parity, or
  merge-preparation claim is included.

### Turn 63 - Auth Unit Vitest Cut-Over

Status: complete locally. Auth unit defaults to Vitest with exact Jest
rollback; integration remains Jest.

Scope:

- promote only the proven one-file unit shadow;
- retain the byte-identical Jest rollback and register the existing config
  exactly once;
- keep integration/PGlite routing, workflow, dependencies, lockfile,
  persistence, production, and Cloudflare runtime unchanged.

Checklist:

- [x] Capture fresh pre-cut-over Jest/Vitest parity and both real `/4`
      matrices.
- [x] Switch `test` to Vitest, move the exact former Jest command to
      `test:jest`, and remove `test:vitest`.
- [x] Register Auth's existing config exactly once in persistent
      strict/no-unchecked tooling and freeze script/config/source ownership.
- [x] Pass exact pre/post default/rollback parity at one file/test, ten
      assertions, zero failures/skips/todos/snapshots, and digest
      `4d55bc4e4dd8e8e6ad3741be3946df33f51a32f8c0f494370284025420f007d8`.
- [x] Pass fresh pre/post Jest and Vitest `/4` matrices at 1/0/0/0 with exact
      aggregate signature ownership.
- [x] Pass all 36 tests through the unchanged Jest-default Auth PGlite
      integration selector and preserve explicit Vitest fail closure.
- [x] Preserve all seven graph shapes at 85/65/20, 1/1/0, 83/63/20, 2/2/0,
      44/25/19, 5/5/0, and 63/44/19; move only Auth unit ownership.
- [x] Preserve remaining-Jest counts at 68/107/406 and accept digest
      `14a4ed7a7de36fa3462e348ab038a4c8735219ce31cd04d5711b4fb0b4c3b8b2`.
- [x] Pass Auth build, frozen offline install, workspace policy, strict
      tooling, the green 305.0-second foundation rerun, and all Cloudflare
      gates.
- [x] Record the first aggregate's transient PGlite five-second hook timeout,
      the 283.0-second focused pass, and the unchanged full rerun; do not change
      unrelated lifecycle behavior.
- [x] Verify port 8791 and scoped processes clean, remove reports, update five
      records, review, and commit only Turn 63.

Result:

- root manifest moves from
  `4e690749e5629ea18fc719a8f5ebeeae8ec8e8a207b5925a4817c6fed656f914`
  to `494e84083c4b143fbaf5398429f533f9efa80e22bfb0246d16e04d1b062451f8`;
- Auth manifest moves from
  `90186fe2cff3e9c387f45d0fa9d20410690256b7ee87ad3a38927b427d4b1ffd`
  to `fe0ce35ed3ac07047db4231b338e9913275b281d04db2ec125c8ca7ce1043abf`;
- config/source/Jest/TypeScript/integration/PGlite/workflow/workspace/lockfile/
  dependencies/persistence and production/runtime boundaries remain
  unchanged;
- no hosted result, GitHub access, integration shadow, or merge-preparation
  claim is included.

### Turn 64 - Auth Integration Vitest Shadow

Status: complete locally. Auth integration remains Jest-authoritative and
Vitest is manual through `test:integration:vitest`.

Scope:

- audit and freeze Auth's three-file database-backed integration lane;
- add only exact-file Vitest discovery, strict ownership, and explicit PGlite
  runner selection;
- preserve the Jest default and generic fast/all CI ownership;
- keep dependencies, lockfile, persistence, production, and Cloudflare runtime
  behavior unchanged.

Checklist:

- [x] Capture expected-red missing config/script and explicit Auth Vitest
      PGlite fail closure.
- [x] Freeze three files, 36 tests, 74 textual assertions, three timeout bridge
      calls, one `jest.fn`, four mock resets, and zero
      skips/todos/snapshots.
- [x] Capture fresh pre-edit Jest baselines on PostgreSQL 18, PGlite, and
      Drizzle/SQLite.
- [x] Add `test:integration:vitest`, a canonical serial four-alias exact-file
      config, persistent strict config/fixture typing, and explicit Auth Vitest
      PGlite routing.
- [x] Reject extensionless/native-TypeScript and frozen-ESM-namespace probes
      without changing the core Medusa loader or adding a global hook.
- [x] Convert the one provider fixture implementation to explicit checked
      CommonJS JavaScript for Node 20/22/24 path-based loading under both
      runners.
- [x] Pass all six post-edit backend/runner reports and all six canonical
      pre/post plus Jest/Vitest comparisons at three files / 36 tests, zero
      failures/skips/todos/snapshots, and digest
      `f6f80d32667d147070651243e02b4a4e29c037dc86f9fd56a0eb7314e2422eff`.
- [x] Pass both real PGlite selectors and move fail closure to Region.
- [x] Pass all three real Vitest `/3` shards at 11/5/20 and all three real
      Jest `/3` shards at 20/11/5 with exact aggregate coverage.
- [x] Preserve all graph shapes at 85/65/20, 1/1/0, 83/63/20, 2/2/0,
      44/25/19, 5/5/0, and 63/44/19 with Auth still Jest-owned in integration.
- [x] Preserve remaining-Jest counts at 68/107/406 and accept capability-only
      digest
      `d186f4a82c0b271162f21b0b43f062d4bda5a5c524e72ea70b9934fa4c024043`.
- [x] Pass Auth build/unit lanes, frozen install, workspace policy, strict
      tooling, the complete 285.5-second foundation, and all Cloudflare
      Vite/import/D1/Durable Object workerd gates.
- [x] Reach zero isolated PostgreSQL test connections, stop/remove the cluster,
      verify ports 55446/8791/8792/8793/8794 closed, remove reports, update the
      five records, review, and commit only Turn 64.

Result:

- root manifest moves from
  `494e84083c4b143fbaf5398429f533f9efa80e22bfb0246d16e04d1b062451f8`
  to `57bf7fa50fcae3f4f8e6f66c6122b64f7bdc8f80e9b9451b957ea6f57fc24309`;
- Auth manifest moves from
  `fe0ce35ed3ac07047db4231b338e9913275b281d04db2ec125c8ca7ce1043abf`
  to `21dc8256b81c88da7be123232bc4ccb7ad21df7dbc369faf568b986bff42e475`;
- the new integration config hash is
  `1c5d5e398c4d35dce9cb42a51f9d15678440c3f5f2f105894af8a88d12df94c6`;
- the provider-loading spec and fixture hashes become
  `f149ae477b43443b3dc728c122190ad7d6d718259f9532d6fef22c5f3965570f`
  and
  `afb01b5f86b2f1d1177b96bd73619c2d046562ab240430517b4516f5f3554695`;
- dependencies, lockfile, workflow, integration default/CI graph,
  persistence, production runtime, privacy/publication, and merge preparation
  remain unchanged;
- no hosted result or GitHub access is claimed.

### Turn 65 - Auth Integration Vitest Cut-Over

Status: complete locally. Auth integration defaults to Vitest with exact Jest
rollback.

Scope:

- switch only the proven Auth integration default to Vitest;
- move the byte-identical former Jest command to `test:integration:jest` and
  remove `test:integration:vitest`;
- map the PGlite Jest selector to rollback and Vitest selector to default;
- preserve the existing generic fast/all CI ownership;
- keep assertions, fixtures, configs, dependencies, lockfile, workflow,
  persistence, production, and Cloudflare behavior unchanged.

Checklist:

- [x] Capture six fresh pre-cut-over backend reports and prove exact Jest/
      Vitest parity on PostgreSQL 18, PGlite, and Drizzle/SQLite.
- [x] Pass both pre-cut-over PGlite selectors and both runners' complete `/3`
      aggregates at Vitest 11/5/20 and Jest 20/11/5.
- [x] Switch the two Auth integration keys and the PGlite command map only.
- [x] Update the strict contract and accept only the reviewed ownership
      inventory delta.
- [x] Pass all six post-cut-over reports and all 12 canonical comparisons at
      three files/36 tests, zero failures/skips/todos/snapshots, and digest
      `f6f80d32667d147070651243e02b4a4e29c037dc86f9fd56a0eb7314e2422eff`.
- [x] Pass both post-cut-over PGlite selectors and both `/3` aggregates.
- [x] Preserve graph shapes 85/65/20, 1/1/0, 83/63/20, 2/2/0, 44/25/19,
      5/5/0, and 63/44/19 while moving Auth once to Vitest in fast/all.
- [x] Preserve remaining-Jest counts at 68/107/406 and accept digest
      `da9b67395197e480c9570535b1cbda9793c92d9e0e3b876f2e3b92f4600d35ae`.
- [x] Pass Auth build/unit lanes, frozen install, workspace policy, strict
      tooling, the 291.4-second foundation, and every Cloudflare gate.
- [x] Reach zero PostgreSQL test connections, stop/remove the cluster, verify
      ports 55447/8791/8792/8793/8794 closed, remove reports, update the five
      records, review, and commit only Turn 65.

Result:

- Auth manifest moves from
  `21dc8256b81c88da7be123232bc4ccb7ad21df7dbc369faf568b986bff42e475`
  to `269374e37d7e129ab48f4dd5de851bce90da710e98e7d6244b094c7130e9aff7`;
- PGlite orchestrator moves from
  `daf7636587dc2af7befa991d378a01eadfc9ede9943a2e8478db499c3d25fad6`
  to `db71b27ab55224690ffb43d4cd504a6d7326209bf907c3b31afac81d3f8fc05d`;
- root manifest, lockfile, workflow, sources, fixtures, config, persistence,
  production runtime, privacy/publication, and merge preparation remain
  unchanged;
- Vite 8.2.0 and Vitest/coverage 4.1.10 remain the current live-registry
  baseline. The Vite-bundled Rolldown remains 1.2.0; standalone Rolldown 1.2.1
  is outside this turn;
- no hosted result or GitHub access is claimed.

### Turn 66 - Region Source-Unit Vitest Shadow

Status: complete locally. Region remains Jest-default for unit and integration;
its one-file source-unit lane has an exact Vitest shadow.

Scope:

- add only `test:vitest` and a source-scoped package config;
- mirror Region's five Jest/TypeScript aliases without a legacy bridge;
- register the config once in strict/noUnchecked tooling;
- preserve unit/integration Jest defaults and explicit PGlite Vitest fail
  closure;
- keep assertions, integration routing, dependencies, lockfile, workflow,
  persistence, production, privacy/publication, and merge preparation
  unchanged.

Checklist:

- [x] Audit one source test, one test, ten textual expectations, five aliases,
      zero Jest APIs, and zero snapshots.
- [x] Capture fresh pre-edit Jest and expected-red missing script/config plus
      unsupported Region PGlite Vitest selection.
- [x] Add only the shadow script/config and strict ownership contract.
- [x] Pass fresh post-edit Jest and Vitest at one file/one test, zero
      failures/skips/todos/snapshots, and digest
      `ab01db67f70a6857632ed929df6a9a9a72c523052e475f8a4f1274844af59410`.
- [x] Pass Region build, post-build Vitest discovery, both `/4` aggregates at
      1/0/0/0, and unchanged PGlite Jest integration at one file/18 tests.
- [x] Preserve graph shapes 85/65/20, 1/1/0, 83/63/20, 2/2/0, 44/25/19,
      5/5/0, and 63/44/19.
- [x] Preserve remaining-Jest counts/digest at 68/107/406 and
      `da9b67395197e480c9570535b1cbda9793c92d9e0e3b876f2e3b92f4600d35ae`.
- [x] Pass frozen install, workspace policy, strict tooling, nine contracts,
      the 296.4-second foundation, and every Cloudflare gate.
- [x] Verify ports 8791/8792/8793/8794 closed, remove reports, update the five
      records, review, and commit only Turn 66.

Result:

- root manifest moves from
  `57bf7fa50fcae3f4f8e6f66c6122b64f7bdc8f80e9b9451b957ea6f57fc24309`
  to `d2889a75b554b1a0dfe5ae190065f6210493daab5b6ad369671475b6f40b7f46`;
- Region manifest moves from
  `74c2313d3f6d5e35dbf6612ed1bff4287c585cbb505ce28a32944a968df59af6`
  to `f49c7d4d8add09b7f5b83b015dcc1a2a946977820e928506bcd576ab17452f12`;
- new config is
  `9d6cd5a60d9a17848c7e363a080602fa59aeb97a0d21aa62ecf6ddd470b76605`;
- source, Jest config, TypeScript config, PGlite routing, lockfile, workflow,
  persistence, and production runtime remain unchanged;
- Vite 8.2.0 and Vitest/coverage 4.1.10 remain the current live-registry
  baseline. Vite's built-in Rolldown resolves 1.2.0; standalone Rolldown 1.2.1
  remains outside this test-ownership turn;
- no hosted result or GitHub access is claimed.

### Turn 67 - Region Source-Unit Vitest Cut-Over

Status: complete locally. Region unit defaults to Vitest with exact Jest
rollback; Region integration remains Jest-authoritative.

Scope:

- switch only the proven Region unit default to Vitest;
- move the byte-identical former Jest command to `test:jest` and remove
  `test:vitest`;
- preserve the package config, source, unit graph shape, and integration
  ownership;
- keep assertions, dependencies, lockfile, workflow, persistence, production,
  privacy/publication, and merge preparation unchanged.

Checklist:

- [x] Capture fresh pre-cut-over default-Jest and shadow-Vitest reports plus
      pre-cut-over PGlite Jest integration and Vitest fail closure.
- [x] Switch only the two Region unit keys and update the strict ownership
      contract.
- [x] Review and accept only the remaining-Jest key move from `test` to
      `test:jest`, preserving counts at 68/107/406.
- [x] Pass default Vitest, rollback Jest, post-build Vitest, and all four
      canonical pre/post comparisons at one file/one passed test, zero
      failures/skips/todos/snapshots, and digest
      `ab01db67f70a6857632ed929df6a9a9a72c523052e475f8a4f1274844af59410`.
- [x] Pass both real `/4` matrices at 1/0/0/0 and own the test exactly once.
- [x] Pass Region build and the unchanged post-cut-over PGlite Jest
      integration lane at one file/18 tests; preserve Vitest fail closure.
- [x] Preserve graph shapes 85/65/20, 1/1/0, 83/63/20, 2/2/0, 44/25/19,
      5/5/0, and 63/44/19 while moving Region once to Vitest only in unit
      graphs.
- [x] Pass frozen install, workspace policy, strict tooling, nine contracts,
      the 311.3-second foundation, and every Cloudflare gate.
- [x] Verify ports 8791/8792/8793/8794 closed, remove reports, update the five
      records, review, and commit only Turn 67.

Result:

- Region manifest moves from
  `f49c7d4d8add09b7f5b83b015dcc1a2a946977820e928506bcd576ab17452f12`
  to `58a9e79d19514bd8d332ce52f0e1a6ca2662bee70e6a06812be2e9af28a544cb`;
- strict contract moves from
  `b86a6ec5467a97ef5ab5e6c58ed28b75e37a8cb5674db7c680fe500ecce6f995`
  to `abc3f2993b0db1e69278f1e02a1111baf5a47dcec04eea7ce0af3c2667125db2`;
- inventory digest becomes
  `d876ba9c0b475bf422d61bcf78a6d5f8f7a3daeea684d9e084d0a34bbfc4f6ce`;
- source, Jest/TypeScript/Vitest configs, root manifest, PGlite routing,
  lockfile, workflow, persistence, and production runtime remain unchanged;
- Vite 8.2.0 and Vitest/coverage 4.1.10 remain the current live-registry
  baseline. Vite's built-in Rolldown resolves 1.2.0; standalone Rolldown 1.2.1
  remains outside this runner-ownership turn;
- no hosted result or GitHub access is claimed.

### Turns 68-73 - Region And RBAC Integration Progression

Status: complete locally. The previously committed turns are:

- Turn 68, Region integration shadow: `ffb34a085e`;
- Turn 69, Region integration cut-over: `296f3c55dc`;
- Turn 70, RBAC source-unit shadow: `995637d2f7`;
- Turn 71, RBAC source-unit cut-over: `ebe9aa1f4f`;
- Turn 72, RBAC integration shadow: `9445949048`;
- Turn 73, RBAC integration cut-over: `238aa4c310`.

The detailed parity, backend, sharding, workflow, rollback, inventory, and
Cloudflare receipts remain recorded in the goal and fork-change records. This
tracker correction changes no test or runtime behavior and claims no hosted
GitHub Actions result.

### Turn 74 - User Source-Unit Vitest Shadow

Status: complete locally. User remains Jest-default for unit and integration;
its one-file source-unit lane has an exact opt-in Vitest shadow.

Checklist:

- [x] Audit one source file/test, five expectations, five aliases, zero Jest
      APIs, and zero snapshots.
- [x] Capture pre-edit and pre-build Jest baselines plus expected-red missing
      User Vitest config and unsupported PGlite Vitest selection.
- [x] Add only `test:vitest`, a source-scoped package config, and strict
      ownership/hash contracts.
- [x] Pass all five canonical reports at one passed file/test, exact name and
      status, and digest
      `8bafc05bff8d1b2a7107cf1a86564afa3997360751d7272675e0f938ce511ead`.
- [x] Pass User build, post-build discovery, and both `/4` aggregates at
      1/0/0/0.
- [x] Pass unchanged PGlite Jest integration before/after at two files/28
      tests and preserve User Vitest integration fail closure before spawn.
- [x] Preserve graph shapes 85/65/20, 1/1/0, 83/63/20, 2/2/0, 42/23/19,
      5/5/0, and 63/44/19.
- [x] Preserve remaining-Jest counts/digest at 68/107/406 and
      `4fee6c2e3fa5a3c84ffad29f7a0e978cc2ac79583df65e6daf8126b2017d4333`.
- [x] Pass frozen install, exact `workspace:*`, strict tooling, nine contracts,
      the 284.1-second foundation, and all 13 Cloudflare commands.

No source, assertion, integration routing, dependency, lockfile, workflow,
persistence, production, privacy/publication, or merge behavior changed.

### Turn 75 - User Source-Unit Vitest Cut-Over

Status: complete locally. User unit defaults to Vitest with exact Jest
rollback; User integration remains Jest-authoritative.

Checklist:

- [x] Capture fresh pre-cutover default-Jest, shadow-Vitest, pre-build Vitest,
      and PGlite Jest/fail-closed evidence.
- [x] Switch only `test` and `test:jest`, remove `test:vitest`, and update the
      strict ownership contract.
- [x] Move only the exact remaining-Jest ownership entry from `test` to
      `test:jest`, retaining counts at 68/107/406 and accepting digest
      `88315b005bc36b5da06e07082f0ebf02a77e7a5de4ed1a0b6a0d9d7d6978db8f`.
- [x] Pass all applicable pre/post comparisons at one passed file/test, exact
      name/status, zero failures/skips/todos/snapshots, and digest
      `8bafc05bff8d1b2a7107cf1a86564afa3997360751d7272675e0f938ce511ead`.
- [x] Pass User build, exact post-build discovery, and both `/4` aggregates at
      1/0/0/0.
- [x] Pass unchanged PGlite Jest integration before/after at two files/28
      tests and preserve explicit Vitest integration fail closure before
      spawn.
- [x] Preserve graph shapes 85/65/20, 1/1/0, 83/63/20, 2/2/0, 42/23/19,
      5/5/0, and 63/44/19 while moving User once to Vitest only in unit
      graphs.
- [x] Pass frozen install, exact `workspace:*`, strict tooling, nine contracts,
      the 269.7-second foundation, and the 89.8-second Cloudflare set.

Source, assertions, configs, integration routing, dependencies, lockfile,
workflow, persistence, production, privacy/publication, and merge behavior
remain unchanged.

### Turn 76 - User Integration Vitest Shadow

Status: complete locally. User integration remained Jest-default and gained an
exact Vitest shadow on PostgreSQL, PGlite, and Drizzle/SQLite.

Checklist:

- [x] Preserve two files, 28 tests, 42 expectations, 11 legacy-Jest API sites,
      zero snapshots, and five aliases.
- [x] Pass all pre/post and cross-backend shadow comparisons at two passed
      files/28 tests and digest
      `2c413d71bd1c98f181215ded94940e420e868ac52426e57a487e76af47c6867d`.
- [x] Pass both PGlite selectors and advance Vitest fail closure to Sales
      Channel.
- [x] Prove both runners' `/3` aggregates at 14/14/0 with all shards
      successful.
- [x] Preserve all graph shapes and remaining-Jest counts at 68/107/406.
- [x] Pass the 268.5-second foundation and 92.1-second Cloudflare set.

### Turn 77 - User Integration Vitest Cut-Over

Status: complete locally. User integration now defaults to Vitest with the
exact Jest rollback retained and explicit PGlite routing.

Checklist:

- [x] Capture fresh default-Jest/shadow-Vitest reports on PostgreSQL, PGlite,
      and Drizzle/SQLite before the ownership switch.
- [x] Switch only the default, rollback, and temporary shadow keys; update
      PGlite routing and the strict ownership contract.
- [x] Pass seven pre-cutover and 16 post-cutover exact comparisons at two
      passed files/28 tests, zero failures/skips/todos/snapshots, and digest
      `2c413d71bd1c98f181215ded94940e420e868ac52426e57a487e76af47c6867d`.
- [x] Pass both PGlite selectors, exact two-file discovery, Sales Channel fail
      closure, and both `/3` aggregates at 14/14/0.
- [x] Preserve graph shapes 85/65/20, 1/1/0, 83/63/20, 2/2/0, 42/23/19,
      5/5/0, and 63/44/19 while moving User integration once to Vitest in
      fast/all.
- [x] Preserve remaining-Jest counts at 68/107/406 and accept only the exact
      script-key and PGlite hash moves; digest becomes
      `fb4c00ea649f7860044cd06e9a7847bccd7cc9aa9c058ecb6cb26dfb5e24c8db`.
- [x] Pass User build/unit runners, frozen install, exact `workspace:*`, strict
      tooling, nine contracts, the 268.0-second foundation, and the 89.3-second
      Cloudflare set.
- [x] Make no workflow change, remove the isolated PostgreSQL/report
      artifacts, and close ports 55453/8791/8792/8793/8794.

### Turn 78 - Sales Channel Source-Unit Vitest Shadow

Status: complete locally. Sales Channel keeps its exact Jest unit and
integration defaults and gains one opt-in source-unit Vitest shadow.

Checklist:

- [x] Audit and freeze two files, three tests, 11 expectations, zero Jest APIs,
      zero snapshots, and five aliases.
- [x] Capture expected-red missing script/config probes and preserve
      fail-closed Vitest integration selection before process spawn.
- [x] Add only `test:vitest`, one source-scoped config, one strict-tooling
      registration, and typed ownership/hash contracts.
- [x] Preserve pre/post/post-build parity at two passed files/three tests, zero
      failures/skips/todos/snapshots, and digest
      `e9f67ef782e472c2ecad05d59fd2c3430a1afa761896ce6316d9261c8c63567c`.
- [x] Prove exact discovery, complete `/4` aggregate coverage with empty shards
      3/4, and no build-output duplicate discovery.
- [x] Pass unchanged PGlite Jest integration at one file/14 tests and keep
      Vitest integration unsupported.
- [x] Preserve all seven graph shapes and remaining-Jest ownership at
      68/107/406 with accepted digest
      `fb4c00ea649f7860044cd06e9a7847bccd7cc9aa9c058ecb6cb26dfb5e24c8db`.
- [x] Pass Sales Channel build, frozen install, exact `workspace:*`, strict
      tooling, nine contracts, the 267.3-second foundation, and the
      100.6-second 13-command Cloudflare set.
- [x] Make no integration, workflow, dependency, lockfile, persistence,
      production, privacy/publication, or repository-merge change.
- [x] Remove temporary reports, close ports 8791/8792/8793/8794, and leave no
      scoped runtime process.

### Turn 79 - Sales Channel Source-Unit Vitest Cut-Over

Status: complete locally. Sales Channel source-unit tests now default to
Vitest with the exact former Jest command retained at `test:jest`.

Checklist:

- [x] Capture fresh pre-cut-over default-Jest/shadow-Vitest reports and prove
      the desired ownership condition is red before editing.
- [x] Switch only the default, rollback, and temporary shadow keys while
      preserving the exact integration default and protected hashes.
- [x] Pass four canonical pre/post comparisons and post-build parity at two
      files/three tests, zero failures/skips/todos/snapshots, and digest
      `e9f67ef782e472c2ecad05d59fd2c3430a1afa761896ce6316d9261c8c63567c`.
- [x] Prove exact discovery, no build-output duplicates, and both runners'
      complete `/4` aggregate coverage with shards 3/4 empty.
- [x] Pass unchanged PGlite Jest integration before and after cut-over at one
      file/14 tests while keeping Vitest integration fail-closed.
- [x] Preserve all seven graph shapes while moving Sales Channel exactly once
      to Vitest only in applicable unit graphs.
- [x] Preserve remaining-Jest counts at 68/107/406 and accept only the exact
      rollback-key move; digest becomes
      `fb62eac6a76f38c13c3992695d616194a7634605b8fa06c274866dacfb1c32c2`.
- [x] Pass Sales Channel build, frozen install, exact `workspace:*`, strict
      tooling, nine contracts, the 266.8-second foundation, and the
      88.5-second 13-command Cloudflare set.
- [x] Make no integration, workflow, dependency, lockfile, persistence,
      production, privacy/publication, or repository-merge change.
- [x] Remove temporary reports, close ports 8791/8792/8793/8794, and leave no
      scoped runtime process.

### Turn 80 - Sales Channel Integration Vitest Shadow

Status: complete locally. Sales Channel integration remains Jest-default and
gains exact Vitest shadow parity across PostgreSQL, PGlite, and Drizzle/SQLite.

Checklist:

- [x] Audit and freeze one file, 14 tests, 22 expectations, one timeout bridge
      site, zero snapshots, and five aliases.
- [x] Capture expected-red missing script/config and unsupported PGlite
      selector probes before editing.
- [x] Add only the integration shadow/config, strict registration/contracts,
      PGlite routing, and Customer fail closure.
- [x] Preserve all nine pre/post reports at one file/14 tests, zero
      failures/skips/todos/snapshots, and digest
      `2abda1932abcd108e0a006b536978950c2486113c1221477c497c14caa0ed1b2`.
- [x] Pass all 18 Cartesian pre/post runner/backend comparisons and both real
      PGlite selectors.
- [x] List the exact file/14 names and prove all three Vitest `/3` commands
      reject the one-file suite; assign no generic or workflow shadow owner.
- [x] Preserve all seven graph shapes and remaining-Jest counts at 68/107/406;
      accepted digest becomes
      `4ccce2217a5343bcf77c3eb372e9fac02a6e0adb70a31684de319897153a70ef`.
- [x] Pass Sales Channel build/unit runners, frozen install, exact
      `workspace:*`, strict tooling, nine contracts, the 268.1-second
      foundation, and the 106.2-second 13-command Cloudflare set.
- [x] Stop the zero-client isolated PostgreSQL cluster, remove all temp paths,
      close ports 55454/8791/8792/8793/8794, and leave no scoped runtime
      process.
- [x] Make no default, workflow, dependency, lockfile, persistence, production,
      privacy/publication, or repository-merge change.

### Turn 81 - Sales Channel Integration Vitest Cut-Over

Status: complete locally; hosted CI deferred. Sales Channel integration now
defaults to Vitest with the exact Jest rollback and one unsharded PostgreSQL
workflow owner.

Checklist:

- [x] Capture six fresh pre-cut-over default/shadow reports and pass all 15
      pairwise comparisons before editing.
- [x] Advance the strict ownership contract first and capture the expected-red
      missing fast-graph exclusion.
- [x] Promote `test:integration`, retain the byte-identical Jest command at
      `test:integration:jest`, and remove the temporary shadow key.
- [x] Route both real PGlite selectors through the correct default/rollback and
      pass 14/14 on each.
- [x] Preserve all 12 pre/post reports and all 66 possible comparisons at one
      file/14 tests, zero failures/skips/todos/snapshots, and digest
      `2abda1932abcd108e0a006b536978950c2486113c1221477c497c14caa0ed1b2`.
- [x] Prove all three Vitest `/3` commands reject, exclude Sales Channel from
      generic fast sharding, and keep it exactly once in unsharded all.
- [x] Add one runner-neutral PostgreSQL job with no strategy and propagate
      failure/cancelled/skipped/success into the package aggregate.
- [x] Preserve unit graphs at 85/65/20, 1/1/0, 83/63/20, and 2/2/0; prove
      integration graphs at 41/22/19, 5/5/0, and 63/44/19.
- [x] Preserve remaining-Jest counts at 68/107/406; accepted digest becomes
      `cf9845867e17ab02f0aea25780b2a1700fdbbfee29502990212d4f072db1f77b`.
- [x] Pass Sales Channel build/unit runners, frozen install, exact
      `workspace:*`, strict tooling, nine contracts, the 258.7-second
      foundation, and the 92.7-second 13-command Cloudflare set.
- [x] Stop the zero-client isolated PostgreSQL cluster, remove its temp root,
      close ports 55455/8791/8792/8793/8794, and leave no scoped runtime
      process.
- [x] Make no dependency, lockfile, persistence, production,
      privacy/publication, repository-merge, or Cloudflare-composition change.
- [x] Make no hosted GitHub Actions claim.

### Turn 82 - Customer Source-Unit Vitest Shadow

Status: complete locally; hosted CI is not applicable. Customer remains
Jest-authoritative and gains an opt-in source-unit Vitest lane.

Checklist:

- [x] Audit the one source file/one test/eight expectation calls, four aliases,
      exact defaults, configs, task ownership, inventory, and immutable hashes.
- [x] Advance the strict ownership contract first and capture the expected-red
      missing `test:vitest` command.
- [x] Add one source-only shared Node Vitest config and opt-in package command
      without a compatibility bridge.
- [x] Preserve five pre/post/post-build reports and all 10 pairwise comparisons
      at one file/one passed test, zero snapshots, and digest
      `085a838f92e80eaad98273639560d217aac284492d89143a570b41810c35c47d`.
- [x] Prove post-build discovery remains source-only and both runners' `/4`
      distribution is 1/0/0/0 with an exact one-test aggregate.
- [x] Preserve graph shapes 85/65/20, 1/1/0, 83/63/20, 2/2/0, 41/22/19,
      5/5/0, and 63/44/19, with Customer owned once by Jest where applicable.
- [x] Pass Customer's unchanged PGlite Jest lane at 47/47 and keep explicit
      Vitest integration selection fail-closed before spawn.
- [x] Preserve remaining-Jest ownership byte-for-byte at 68/107/406.
- [x] Pass Customer build/Jest/Vitest, frozen offline install, exact
      `workspace:*`, strict tooling, nine contracts, the 285.9-second
      foundation, and the 86.6-second 13-command Cloudflare set.
- [x] Make no default, rollback, integration, workflow, dependency, catalog,
      lockfile, persistence, production, privacy/publication, or
      repository-merge change.
- [x] Make no hosted GitHub Actions claim.

### Turn 83 - Customer Source-Unit Vitest Cut-Over

Status: complete locally. Customer source-unit tests now default to Vitest
with the exact former Jest command retained at `test:jest`.

Checklist:

- [x] Capture fresh pre-cut-over default-Jest/shadow-Vitest reports and prove
      the desired ownership condition red before implementation.
- [x] Switch only the default, rollback, and temporary shadow keys while
      preserving the exact integration default and protected hashes.
- [x] Preserve six canonical pre/post/post-build reports and all 15 possible
      comparisons at one file/one passed test, zero snapshots, and digest
      `085a838f92e80eaad98273639560d217aac284492d89143a570b41810c35c47d`.
- [x] Prove source-only post-build discovery and both runners' pre/post `/4`
      distribution at 1/0/0/0 with exact one-test aggregates.
- [x] Pass unchanged PGlite Jest integration before and after at 47/47 while
      keeping Vitest integration fail-closed before spawn.
- [x] Preserve all seven graph shapes while moving Customer exactly once to
      Vitest only in applicable unit graphs.
- [x] Preserve remaining-Jest counts at 68/107/406 and accept only the exact
      rollback-key move; digest becomes
      `591d4acff7892ba1b1cad404dea48f90fae73794e13b980dd6e5dbf138f32ebf`.
- [x] Pass Customer build and both unit runners, frozen offline install, exact
      `workspace:*`, strict tooling, nine contracts, the 273.6-second
      foundation, and the 90.7-second 13-command Cloudflare set.
- [x] Make no integration, workflow, dependency, catalog, lockfile,
      persistence, production, privacy/publication, or repository-merge
      change.
- [x] Make no hosted GitHub Actions claim.

### Turn 84 - Customer Integration Vitest Shadow

Status: complete locally. Customer integration remains Jest-default and gains
exact Vitest parity across PostgreSQL, PGlite, and Drizzle/SQLite.

Checklist:

- [x] Audit and freeze one file, 47 tests, 64 expectation sites, one timeout
      bridge call, zero snapshots, and four aliases.
- [x] Capture expected-red missing script/config and unsupported PGlite
      selector probes before implementation.
- [x] Add only `test:integration:vitest`, one exact-file config, strict
      registration/contracts, PGlite routing, and Analytics fail-closure.
- [x] Preserve all nine pre/post reports and all 36 possible comparisons at
      one file/47 tests, zero snapshots, and digest
      `6f5d4ea25436106c87939ea69fbf8d217c7189eb8aa89ff7f7bd94a4de1a7c9a`.
- [x] Pass both real PGlite selectors at 47/47.
- [x] Prove both runners' `/3` distribution at 47/0/0 with all shards
      successful; assign no graph or workflow owner to the opt-in shadow.
- [x] Preserve all seven graph shapes and Customer's Jest-default integration
      ownership.
- [x] Preserve remaining-Jest counts at 68/107/406; accepted digest becomes
      `3c11614cf41f4ce3721b8863e983be278982d86700b3801b3d18aa324124361a`.
- [x] Pass Customer build/unit runners, frozen install, exact `workspace:*`,
      strict tooling, nine contracts, the 257.9-second foundation, and the
      103.0-second 13-command Cloudflare set.
- [x] Stop the zero-client isolated PostgreSQL cluster and close port 55456.
- [x] Make no default, rollback, workflow, dependency, catalog, lockfile,
      persistence, production, privacy/publication, or repository-merge
      change.
- [x] Make no hosted GitHub Actions claim.

### Turn 85 - Customer Integration Vitest Cut-Over

Status: complete locally; hosted execution is deferred. Customer integration
now defaults to Vitest with the exact Jest rollback and remains in generic fast
sharding.

Checklist:

- [x] Capture six fresh pre-cut-over default/shadow reports and pass all 15
      pairwise comparisons before implementation.
- [x] Advance the strict ownership contract first and capture the expected-red
      Customer integration default mismatch.
- [x] Promote `test:integration`, retain the byte-identical Jest command at
      `test:integration:jest`, and remove the temporary shadow key.
- [x] Route both real PGlite selectors through the correct default/rollback
      and pass 47/47 on each.
- [x] Preserve all 12 pre/post reports and all 66 possible comparisons at one
      file/47 tests, zero snapshots, and digest
      `6f5d4ea25436106c87939ea69fbf8d217c7189eb8aa89ff7f7bd94a4de1a7c9a`.
- [x] Prove both runners' `/3` distribution at 47/0/0 with all six shard
      commands successful.
- [x] Preserve all seven graph shapes while moving Customer exactly once to
      Vitest in fast/all and keeping it absent from slow.
- [x] Preserve remaining-Jest counts at 68/107/406; accepted digest becomes
      `1778bcf206ba7712e20a726f4d1365315b5ad597d41d9c04811d48d429066bf4`.
- [x] Pass Customer build/unit runners, frozen install, exact `workspace:*`,
      strict tooling, nine contracts, the 257.3-second foundation, and the
      84.5-second 13-command Cloudflare set.
- [x] Stop the zero-client isolated PostgreSQL cluster and close port 55457.
- [x] Make no workflow, dependency, catalog, lockfile, persistence, production,
      privacy/publication, repository-merge, or Cloudflare-composition change.
- [x] Make no hosted GitHub Actions claim.

### Turn 86 - Analytics Source-Unit Vitest Shadow

Status: complete locally; hosted CI is not applicable. Analytics retains both
Jest defaults and gains an opt-in source-only Vitest lane.

Checklist:

- [x] Audit and freeze one source file, one test, eight expectation sites, zero
      Jest APIs, zero snapshots, and five aliases.
- [x] Keep the separate integration timeout/spy/type/mock-reset compatibility
      work outside this source-only turn.
- [x] Capture expected-red missing script/config and unsupported Vitest
      integration probes before implementation.
- [x] Add only `test:vitest`, one source-only config without a compatibility
      bridge, exact root typecheck registration, and strict ownership/hashes.
- [x] Preserve all five pre/post/post-build reports and all 10 comparisons at
      one file/one test, zero snapshots, and digest
      `c06d35fca0798b76dab6056cb66022e1e8aae94981e31782dee46bedecaddc4a`.
- [x] Prove both runners' `/4` distribution at 1/0/0/0 with all eight commands
      successful.
- [x] Preserve all seven graph shapes and Analytics's Jest-default unit and
      integration ownership.
- [x] Pass unchanged PGlite Jest integration before/after at 3/3 and keep
      explicit Vitest integration fail-closed before spawn.
- [x] Preserve remaining-Jest ownership byte-for-byte at 68/107/406 and digest
      `1778bcf206ba7712e20a726f4d1365315b5ad597d41d9c04811d48d429066bf4`.
- [x] Pass Analytics build/runners, frozen install, exact `workspace:*`, strict
      tooling, nine contracts, the 259.7-second foundation, and the
      84.2-second 13-command Cloudflare set.
- [x] Make no default, rollback, integration, workflow, dependency, catalog,
      lockfile, persistence, production, privacy/publication, repository-merge,
      or Cloudflare-composition change.
- [x] Make no hosted GitHub Actions claim.

### Turn 87 - Analytics Source-Unit Vitest Cut-Over

Status: complete locally; hosted CI remains deferred. Analytics source-unit
tests default to Vitest with exact Jest rollback; integration remains
Jest-only.

Checklist:

- [x] Promote the proven Vitest command to `test`, move exact Jest to
      `test:jest`, and remove `test:vitest`.
- [x] Preserve six pre/post/post-build reports and all 15 comparisons at one
      file/one test, zero snapshots, and digest
      `c06d35fca0798b76dab6056cb66022e1e8aae94981e31782dee46bedecaddc4a`.
- [x] Prove direct default/rollback `/4` distributions at 1/0/0/0 with all
      eight commands successful.
- [x] Preserve all seven graph shapes, move Analytics once to Vitest in
      applicable unit graphs, and retain Jest integration ownership.
- [x] Pass unchanged PGlite Jest integration before/after at 3/3 and keep
      explicit Vitest integration fail-closed before spawn.
- [x] Reproduce the exact single-separator root unit failure, then add separate
      pnpm and Turbo separators to only the two unit workflow lines.
- [x] Advance the parsed contract red-before-green; prove exact general/serial
      dry arguments plus all four Analytics and Framework/Utils root shards.
- [x] Preserve remaining-Jest counts at 68/107/406 while moving only the
      Analytics Jest script key; accept digest
      `10fbe08d6fac527f2bf5d0f9a7c5d3b7db7aa23db5046241378cb066d66d3bca`.
- [x] Pass Analytics build/runners, frozen install, exact `workspace:*`,
      strict tooling, nine contracts, the 272.7-second foundation, and the
      196.8-second 13-command Cloudflare set.
- [x] Make no integration workflow, dependency, catalog, lockfile,
      persistence, production, privacy/publication, repository-merge, or
      Cloudflare-composition change.
- [x] Make no hosted GitHub Actions claim.

### Turn 88 - Analytics Integration Vitest Shadow

Status: complete locally; hosted CI is not applicable. Analytics integration
remains Jest-default with an opt-in Vitest shadow.

Checklist:

- [x] Capture expected-red missing script/config and unsupported Analytics
      Vitest PGlite selection.
- [x] Freeze three tests, three expectation sites, six Jest API/type sites,
      zero snapshots, and the separate path-loaded provider boundary.
- [x] Pass fresh pre-edit Jest baselines on isolated PostgreSQL 18, PGlite,
      and Drizzle/SQLite.
- [x] Add only `test:integration:vitest`, an exact-file five-alias serial
      profile, strict ownership, and explicit Analytics Vitest PGlite mapping.
- [x] Replace only the non-portable TypeScript provider fixture with strictly
      checked CommonJS JavaScript and validate the native-required module
      before spying on the loader's cached constructor.
- [x] Preserve all nine reports at one file/three tests, zero snapshots, and
      digest
      `689d13219971cc7e1fca75fdfc4fc4c3d99c2da51814a55ebbc4a5646a95f389`;
      pass all 36 report pairs.
- [x] Pass both real Analytics PGlite selectors and advance fail closure to
      File before process spawn.
- [x] Prove both runners' `/3` distribution at 3/0/0 with all six commands
      successful and assign no graph/workflow owner to the shadow.
- [x] Preserve all seven graph shapes at 85/65/20, 1/1/0, 83/63/20, 2/2/0,
      41/22/19, 5/5/0, and 63/44/19 with Analytics still Jest-owned in
      integration.
- [x] Preserve remaining-Jest counts at 68/107/406 and accept digest
      `4493c251a6d93e9ef7c86296779d6d9d6e6f00df573dcb6d154e56c0e233f334`.
- [x] Pass Analytics build/unit runners, frozen install, exact `workspace:*`,
      strict tooling, nine contracts, the 348.5-second foundation, and the
      279.5-second 13-command Cloudflare set.
- [x] Stop and remove isolated PostgreSQL/report paths, verify scoped ports
      and processes clean, update five records, review, and commit only Turn 88.
- [x] Make no integration-default, workflow, dependency, catalog, lockfile,
      persistence, production, privacy/publication, repository-merge, hosted
      GitHub Actions, or Cloudflare-composition claim.

### Turn 89 - Analytics Integration Vitest Cut-Over

Status: complete locally; hosted CI is not applicable. Analytics unit and
integration tests default to Vitest with exact Jest rollbacks.

Checklist:

- [x] Advance the strict package contract red-before-green and capture the
      exact old-default/new-default mismatch.
- [x] Promote `test:integration` to the proven Vitest config, retain the exact
      Jest command at `test:integration:jest`, and remove the shadow key.
- [x] Route the real PGlite `jest` selector to rollback and `vitest` selector
      to default; retain File fail closure before spawn.
- [x] Preserve all 12 pre/post PostgreSQL/PGlite/Drizzle reports at one
      file/three tests, zero snapshots, and digest
      `689d13219971cc7e1fca75fdfc4fc4c3d99c2da51814a55ebbc4a5646a95f389`;
      pass all 66 report pairs.
- [x] Prove both runners' PostgreSQL `/3` distribution at 3/0/0 with all six
      shard commands successful.
- [x] Preserve graph shapes 85/65/20, 1/1/0, 83/63/20, 2/2/0, 41/22/19,
      5/5/0, and 63/44/19; move Analytics once to Vitest in fast/all and add
      no workflow job.
- [x] Preserve remaining-Jest counts at 68/107/406 and accept digest
      `fe53124f95797aaaa8156f2cdcf07371e495f2a56dd98d3600c2d72ab695b3f8`.
- [x] Pass Analytics build/runners, frozen install, exact `workspace:*`,
      strict tooling, nine contracts, the 329.9-second foundation, and the
      188.1-second 13-command Cloudflare set.
- [x] Make no test source/config/fixture, assertion, dependency, catalog,
      lockfile, workflow, persistence, production, privacy/publication,
      repository-merge, or hosted GitHub Actions claim.

### Turn 90 - File Source-Unit Vitest Shadow

Status: complete locally; hosted CI is not applicable. File retains both Jest
defaults and gains an opt-in source-only Vitest lane.

Checklist:

- [x] Audit and freeze two source files, two tests, ten expectation sites,
      zero Jest APIs, zero snapshots, four aliases, and the separate
      one-file/four-test integration boundary.
- [x] Capture expected-red missing script/config, strict ownership, and
      unsupported File/Vitest integration failures before implementation.
- [x] Add only `test:vitest`, one source-only four-alias config without a
      compatibility bridge, exact root typecheck registration, and strict
      ownership/hashes.
- [x] Preserve all five pre/post/post-build reports and all 10 comparisons at
      two files/two tests, zero snapshots, and digest
      `d13d56d514b40ce97e7e19da791470cdc34f95587b1fe48673d88c99cae9a3cf`.
- [x] Prove direct Jest/Vitest and scoped root Jest `/4` distributions at
      1/1/0/0 with all 12 commands successful.
- [x] Preserve all seven graph shapes and File's Jest-default unit and
      integration ownership.
- [x] Pass unchanged PGlite Jest integration before/after at 4/4 and retain
      explicit Vitest integration fail closure before spawn.
- [x] Preserve remaining-Jest ownership byte-for-byte at 68/107/406 and digest
      `fe53124f95797aaaa8156f2cdcf07371e495f2a56dd98d3600c2d72ab695b3f8`.
- [x] Pass File build/runners, frozen install, exact `workspace:*`, strict
      tooling, nine contracts, the complete 515.1-second foundation rerun,
      and the complete 288.6-second 13-command Cloudflare rerun.
- [x] Record the initial load-sensitive foundation/workerd timeouts and the
      unchanged isolated/full reruns; edit no timeout or runtime source.
- [x] Make no default, rollback, integration, workflow, dependency, catalog,
      lockfile, persistence, production, privacy/publication, repository-merge,
      or hosted GitHub Actions claim.

### Turn 91 - File Source-Unit Vitest Cut-Over

Status: complete locally; hosted CI is not applicable. File source units now
default to Vitest with the exact Jest rollback retained; integration remains
Jest-only.

Checklist:

- [x] Capture fresh pre-cut-over Jest/Vitest reports and prove unchanged
      PGlite Jest 4/4 plus explicit Vitest fail closure.
- [x] Advance the strict contract first, capture the exact expected red, then
      move `test` to Vitest, retain the exact command at `test:jest`, and
      remove `test:vitest`.
- [x] Change no source test: both files already use native runner-shared syntax
      and contain zero Jest-only APIs.
- [x] Preserve six pre/post/post-build reports and all 15 comparisons at two
      files/two tests, zero snapshots, and digest
      `d13d56d514b40ce97e7e19da791470cdc34f95587b1fe48673d88c99cae9a3cf`.
- [x] Prove direct Vitest, exact Jest rollback, and scoped-root default `/4`
      distributions at 1/1/0/0 with all 12 commands successful.
- [x] Preserve all seven graph shapes, move File once to Vitest only in
      applicable unit graphs, and keep integration once on Jest.
- [x] Pass unchanged PGlite Jest integration after cut-over at 4/4 and retain
      explicit Vitest integration fail closure before spawn.
- [x] Preserve remaining-Jest counts at 68/107/406; move only the File rollback
      key and accept digest
      `0ea4911f5dbf19a794830d9356bb63f2615f9785f0fe714206b787116b1d8902`.
- [x] Pass File build/default/rollback, frozen install, exact `workspace:*`,
      strict tooling, nine contracts, the complete 529.7-second foundation,
      and the complete 218.2-second 13-command Cloudflare set.
- [x] Record the initial machine-pressure PGlite native OOM and unchanged
      successful retry; edit no memory, timeout, integration, or runtime source.
- [x] Make no integration-default, workflow, dependency, catalog, lockfile,
      persistence, production, privacy/publication, repository-merge, or hosted
      GitHub Actions claim.

### Turn 92 - File Integration Native Vitest Shadow

Status: complete locally; hosted CI is not applicable. File integration keeps
its Jest default and gains a native Vitest shadow without the legacy bridge.

Checklist:

- [x] Freeze one file/four tests, six expectation sites, one
      `jest.setTimeout`, zero snapshots, four aliases, and the provider-loader
      fixture boundary.
- [x] Capture three fresh pre-edit Jest reports across PostgreSQL 18, PGlite,
      and Drizzle/SQLite plus expected-red profile/manifest contracts and
      fail-closed File/Vitest selection.
- [x] Add optional native/no-bridge and timeout controls to the shared
      integration profile while preserving all existing defaults.
- [x] Move timeout ownership from `jest.setTimeout(100000)` to Jest CLI and
      native Vitest config; leave zero Jest APIs in the File integration spec.
- [x] Convert the path-loaded provider fixture to strictly checked CommonJS
      JavaScript with an explicit `.js` path after the native loader probe
      failed before assertions.
- [x] Preserve nine PostgreSQL/PGlite/Drizzle reports and all 36 comparisons at
      one file/four tests, zero snapshots, and digest
      `976233a8271cf7b030f1f3ad625e4135f120c94331e742793ff0f85d1c1252ee`.
- [x] Pass both PGlite selectors 4/4, advance fail closure exactly to Stock
      Location, and preserve both PostgreSQL `/3` aggregates at 4/0/0.
- [x] Preserve all seven graph shapes and File's Jest-default integration
      ownership; add no shadow graph, workflow, aggregate, or hosted owner.
- [x] Reduce remaining-Jest ownership to 68 configs, 107 scripts, and 405 API
      files with accepted digest
      `89031c157378f4eda7b203569918756f0ba8be86069163b1819a1a985c1e0787`.
- [x] Pass File build/unit runners, frozen install, exact `workspace:*`,
      strict tooling, ten contracts, the complete 416.7-second foundation, and
      the complete 240.1-second 13-command Cloudflare set.
- [x] Re-run both File PGlite selectors plus the integration foundation against
      the final formatted sources in 496.4 seconds.
- [x] Stop the isolated PostgreSQL cluster and make no assertion, dependency,
      catalog, lockfile, workflow, persistence, production,
      privacy/publication, repository-merge, or hosted GitHub Actions claim.

### Turn 93 - File Integration Vitest Cut-Over

Status: complete locally; hosted CI is not applicable. File integration now
defaults to native Vitest with the exact Jest command retained as rollback.

Checklist:

- [x] Capture six fresh pre-cut-over Jest/Vitest reports across PostgreSQL 18,
      PGlite, and Drizzle/SQLite before changing ownership.
- [x] Add expected-red ownership assertions before implementation and prove
      that the old Jest default fails the new contract.
- [x] Promote native Vitest to `test:integration`, retain the byte-identical
      Jest command at `test:integration:jest`, and remove
      `test:integration:vitest`.
- [x] Move only PGlite runner routing to the stable default/rollback keys;
      preserve Stock Location as the next fail-closed Vitest lane.
- [x] Preserve 12 reports and all 66 comparisons at one file/four tests, zero
      snapshots, and digest
      `976233a8271cf7b030f1f3ad625e4135f120c94331e742793ff0f85d1c1252ee`.
- [x] Pass both root PGlite selectors 4/4 and both PostgreSQL `/3` aggregates
      at 4/0/0 with all six shard commands successful.
- [x] Preserve all seven graph shapes while moving File exactly once from Jest
      to Vitest in fast/all integration; add no workflow or dedicated job.
- [x] Preserve remaining-Jest counts at 68 configs, 107 scripts, and 405 API
      files with accepted digest
      `a0d41f08e8e41db25bbfcf6555c369d80c32ffa4a530db18018bc05eb9c3a20a`.
- [x] Pass frozen install, exact `workspace:*`, File build/unit runners,
      strict/noUnchecked tooling, ten contracts, the complete 395.5-second
      foundation, and the complete 237.5-second 13-command Cloudflare set.
- [x] Record early host-pressure native V8 OOMs and unchanged successful
      retries; add no heap, timeout, runner, workflow, or runtime workaround.
- [x] Stop the isolated PostgreSQL cluster and make no test-source, config,
      fixture, assertion, dependency, catalog, lockfile, workflow,
      persistence, production, privacy/publication, repository-merge, or
      hosted GitHub Actions claim.

### Turn 94 - Stock Location Source-Unit Vitest Shadow

Status: complete locally; hosted CI is not applicable. Both Stock Location
defaults remain Jest-owned and the source-only Vitest lane is opt-in.

Checklist:

- [x] Freeze the two source files, nine expectation sites, zero Jest APIs, five
      aliases, exact Jest defaults, integration source/timeout, graph
      ownership, and remaining-Jest inventory before implementation.
- [x] Capture the two-file/two-test pre-edit Jest report and pass the real
      PGlite Jest integration at one file/eight tests before the source change.
- [x] Add expected-red ownership assertions and prove they fail exactly at the
      missing `test:vitest` command.
- [x] Add only `test:vitest` plus a source-prefixed shared Vitest/SWC config
      with no legacy bridge; strictly typecheck that config exactly once.
- [x] Preserve five reports and all 10 comparisons at two files/two tests,
      zero snapshots, and digest
      `9a8130aa81ad85e8d365607af15e580125a8dc2c8e44cbb90286bc737625264c`.
- [x] Pass direct Jest, direct Vitest, and scoped-root Jest `/4` aggregates at
      1/1/0/0 across all 12 commands.
- [x] Preserve all seven graph shapes and Stock Location's Jest ownership; add
      no shadow graph, workflow, aggregate, or hosted owner.
- [x] Pass the unchanged PGlite Jest integration 8/8 after the source change
      and preserve fail-closed Vitest selection before spawn.
- [x] Preserve remaining-Jest ownership at 68 configs, 107 scripts, and 405 API
      files with accepted digest
      `a0d41f08e8e41db25bbfcf6555c369d80c32ffa4a530db18018bc05eb9c3a20a`.
- [x] Pass frozen install, exact `workspace:*`, Stock Location build/runners,
      strict/noUnchecked tooling, ten contracts, the complete 396.8-second
      foundation, and the complete 248.7-second 13-command Cloudflare set.
- [x] Make no integration source/timeout, assertion, dependency, catalog,
      lockfile, workflow, persistence, production, privacy/publication,
      repository-merge, or hosted GitHub Actions claim.

### Turn 95 - Stock Location Source-Unit Vitest Cut-Over

Status: complete locally; hosted CI is not applicable. Stock Location source
units now default to Vitest with the exact previous Jest command retained as
rollback. Integration remains Jest-only.

Checklist:

- [x] Capture fresh pre-cut-over default Jest and shadow Vitest reports plus
      the exact seven graph shapes and Stock Location ownership.
- [x] Pass the real pre-cut-over PGlite Jest integration at one file/eight
      tests and preserve fail-closed Vitest selection before spawn.
- [x] Add expected-red cut-over ownership assertions before implementation and
      prove failure exactly at the old Jest default.
- [x] Promote Vitest to `test`, retain the byte-exact Jest command at
      `test:jest`, and remove `test:vitest` without changing sources/config.
- [x] Preserve six reports and all 15 comparisons at two files/two tests, zero
      snapshots, and digest
      `9a8130aa81ad85e8d365607af15e580125a8dc2c8e44cbb90286bc737625264c`.
- [x] Pass default Vitest, Jest rollback, and scoped-root default `/4`
      aggregates at 1/1/0/0 across all 12 commands.
- [x] Preserve all seven graph shapes while moving Stock Location exactly once
      to Vitest in applicable unit graphs; keep integration Jest-owned.
- [x] Pass the unchanged PGlite Jest integration 8/8 after cut-over and retain
      fail-closed Vitest integration selection before spawn.
- [x] Preserve remaining-Jest totals at 68/107/405 with only the rollback key
      moving and accepted digest
      `f823411e2055f8c528416f42061a7262a5aa68f2c87b0ada7c863a19c7bc2110`.
- [x] Pass frozen install, exact `workspace:*`, Stock Location build/runners,
      strict/noUnchecked tooling, ten contracts, the complete 387.0-second
      foundation, and the complete 130.8-second 13-command Cloudflare set.
- [x] Keep the integration source/timeout, assertions, dependencies, catalogs,
      lockfile, workflow, persistence, production, privacy/publication,
      repository merge, and hosted GitHub Actions claims unchanged.

### Turn 96 - Stock Location Integration Vitest Shadow

Status: complete locally; hosted CI is not applicable. Integration remains
Jest-default with a native no-bridge Vitest shadow.

Checklist:

- [x] Remove only the source-owned Jest timeout and transfer equal timeout
      ownership to the Jest CLI and native Vitest integration config.
- [x] Preserve nine PostgreSQL/PGlite/Drizzle reports and all 36 comparisons
      at one file/eight tests, nine expectation sites, zero snapshots, and
      digest
      `9cdd60a75316fb7d555d48e0e3456686eaffee0189273a61df9cad0992bae990`.
- [x] Pass both real PGlite selectors 8/8 and keep Inventory fail-closed.
- [x] Prove native Vitest rejects the one-file `/3` request, requiring a
      dedicated unsharded PostgreSQL owner before cut-over.
- [x] Preserve all seven task shapes, keep the shadow unowned, pass the full
      foundation and all 13 Cloudflare gates, and make no behavior claim.

### Turn 97 - Stock Location Integration Vitest Cut-Over

Status: complete locally; the first hosted workflow result remains deferred.
Integration defaults to Vitest with exact Jest rollback.

Checklist:

- [x] Promote only the proven integration shadow and move PGlite routing to
      the stable default/rollback keys.
- [x] Preserve 12 PostgreSQL/PGlite/Drizzle reports and all 66 comparisons at
      one file/eight tests, zero snapshots, and digest
      `9cdd60a75316fb7d555d48e0e3456686eaffee0189273a61df9cad0992bae990`.
- [x] Pass both PGlite selectors 8/8 and the exact unsharded PostgreSQL default
      command 8/8.
- [x] Exclude the one-file suite from generic fast `/3` and add one
      runner-neutral unsharded PostgreSQL workflow job with aggregate
      failure/success propagation.
- [x] Pass the full foundation and all 13 Cloudflare gates without changing
      tests, dependencies, persistence, or production composition.

### Turn 98 - Inventory Source-Unit Vitest Shadow

Status: complete locally; hosted CI is not applicable. Both Inventory defaults
remain Jest-owned and the source-only Vitest lane is opt-in.

Checklist:

- [x] Freeze two source files, two tests, ten expectation sites, zero Jest
      APIs, five aliases, exact Jest defaults, integration boundary, seven
      task graphs, and remaining-Jest ownership before implementation.
- [x] Capture the pre-edit two-file/two-test Jest report, pass real PGlite Jest
      integration 35/35, and prove Vitest integration fails closed.
- [x] Add an expected-red ownership contract and prove it fails exactly at the
      missing `test:vitest` key.
- [x] Add only `test:vitest` plus a source-prefixed shared Vitest/SWC config
      with no legacy bridge; strictly typecheck that config exactly once.
- [x] Preserve five reports and all ten comparisons at two files/two tests,
      zero snapshots, and digest
      `d8c5611e5df9f41668483147d1eb09c6a48dd918db1a17d3596e5e366617a9ce`.
- [x] Pass direct Jest, direct Vitest, and authentic root-scoped Jest `/4`
      aggregates at 1/1/0/0 across 12 valid commands.
- [x] Preserve all seven graph shapes and Inventory's Jest ownership; add no
      shadow graph, workflow, aggregate, or hosted owner.
- [x] Pass unchanged PGlite Jest integration 35/35 after the source change and
      preserve fail-closed Vitest selection before spawn.
- [x] Preserve remaining-Jest ownership byte-for-byte at 68/107/404 with
      accepted digest
      `26bde82560b12f9c5b3d3f284ba3060f1ce9386768f7d649bec840383004b6d8`.
- [x] Pass frozen install, exact `workspace:*`, Inventory build/runners,
      strict/noUnchecked tooling, ten contracts, the complete 349.0-second
      foundation, and all 13 Cloudflare gates after one unchanged startup
      retry.
- [x] Make no test-source, integration, assertion, dependency, catalog,
      lockfile, workflow, persistence, production, privacy/publication,
      repository-merge, or hosted GitHub Actions claim.

### Turn 99 - Inventory Source-Unit Vitest Cutover

Status: complete locally; hosted CI is not applicable. Inventory source units
now default to Vitest with the exact previous Jest command retained as
rollback. Integration remains Jest-only.

Checklist:

- [x] Capture fresh pre-cutover default Jest and shadow Vitest reports plus
      exact source/config hashes, all seven graph shapes, and Inventory
      ownership.
- [x] Pass real pre-cutover PGlite Jest integration at one file/35 tests and
      preserve fail-closed Vitest selection before spawn.
- [x] Add expected-red cutover ownership assertions and prove failure exactly
      at the old Jest default.
- [x] Promote Vitest to `test`, retain the byte-exact Jest command at
      `test:jest`, and remove `test:vitest` without changing sources/config.
- [x] Preserve six reports and all 15 comparisons at two files/two tests, ten
      expectation sites, zero snapshots, and digest
      `d8c5611e5df9f41668483147d1eb09c6a48dd918db1a17d3596e5e366617a9ce`.
- [x] Pass default Vitest, Jest rollback, and root-scoped default `/4`
      aggregates at 1/1/0/0 across all 12 commands.
- [x] Preserve all seven graph shapes while moving Inventory exactly once to
      Vitest in applicable unit graphs; keep integration Jest-owned.
- [x] Pass unchanged PGlite Jest integration 35/35 after cutover and retain
      fail-closed Vitest integration selection before spawn.
- [x] Preserve remaining-Jest totals at 68/107/404 with only the rollback key
      moving and accepted digest
      `4ba7781d052ed7438a21cca958811c8cc19ac96b97320db89bce2358b5f05c0c`.
- [x] Pass frozen install, exact `workspace:*`, Inventory build/runners,
      strict/noUnchecked tooling, ten contracts, the complete 352.6-second
      foundation, and the uninterrupted 140.2-second 13-command Cloudflare
      set.
- [x] Keep the integration source and its `jest.setTimeout`/`jest.spyOn`,
      assertions, dependencies, catalogs, lockfile, workflow, persistence,
      production, privacy/publication, repository merge, and hosted GitHub
      Actions claims unchanged.

### Turn 100 - Inventory Integration Vitest Shadow

Status: complete locally; hosted CI is not applicable. The integration default
remains Jest and the native/no-bridge Vitest lane is opt-in.

Checklist:

- [x] Freeze one file, 35 tests, 56 direct expectation calls, zero snapshots,
      two Jest-only sites, five aliases, timeout, three persistence backends,
      PGlite routing, `/3` behavior, and current task ownership.
- [x] Preserve pre-edit Jest at one file/35 tests on isolated PostgreSQL 18,
      PGlite, and Drizzle/SQLite.
- [x] Replace `jest.spyOn` with imported `vi.spyOn`; move
      `jest.setTimeout(100000)` to the Jest CLI and Vitest config.
- [x] Add a serial `test:integration:vitest` with
      `legacyJestBridge: false`; retain Jest at `test:integration`.
- [x] Preserve rollback through a package-local `vitest` mapper exposing only
      `spyOn`, with shim/config strictly typechecked exactly once.
- [x] Pass both runners at one file/35 tests/zero snapshots on PostgreSQL,
      PGlite, and Drizzle/SQLite, plus both real PGlite selectors.
- [x] Preserve Jest `/3` at 35/0/0. Confirm every native Vitest `/3` command
      exits 1 because three shards exceed one file, requiring dedicated
      unsharded ownership in Turn 101.
- [x] Advance fail-closed PGlite Vitest ownership to Tax and preserve all seven
      task shapes because the shadow has no graph or workflow owner.
- [x] Reduce active Jest API files from 404 to 403 while retaining 68 configs
      and 107 scripts; accept digest
      `e943997da072baa63400a7384b784e1d3dad4ec755e10ab2bcf99f69fa4ebd89`.
- [x] Pass frozen install across 86 workspaces, exact `workspace:*`, Inventory
      build, strict tooling, ten contracts, the complete 417.1-second
      foundation, and the uninterrupted 202.6-second Cloudflare set.
- [x] Change no assertion, dependency, catalog, lockfile, workflow,
      persistence semantic, production composition, privacy/publication,
      repository-merge, or hosted GitHub Actions claim.

### Turn 101 - Inventory Integration Vitest Cutover

Status: complete locally; the new workflow job is contract-tested but its first
hosted result is deferred. Inventory unit and integration now default to native
Vitest with exact Jest rollbacks.

Checklist:

- [x] Freeze six pre-cutover PostgreSQL/PGlite/Drizzle reports and exact
      one-file/35-test/zero-snapshot runner and backend parity.
- [x] Add expected-red ownership assertions and fail exactly at the old Jest
      `test:integration` default.
- [x] Promote Vitest to `test:integration`, retain the exact Jest command at
      `test:integration:jest`, and remove the temporary shadow key.
- [x] Route default/explicit PGlite selectors through Jest rollback/native
      Vitest respectively, both passing 35/35.
- [x] Preserve 12 pre/post reports through 13 targeted comparisons across
      runners, backends, and the cut-over boundary.
- [x] Exclude Inventory from generic fast `/3`; integration shapes move from
      40/21/19 to 39/20/19 fast and remain 5/5/0 slow and 63/44/19 all.
- [x] Add one runner-neutral unsharded PostgreSQL workflow job and require its
      result in aggregate failure and success paths.
- [x] Pass the exact unsharded PostgreSQL default at 35/35 and preserve the
      source/config/rollback-shim boundary byte-for-byte.
- [x] Preserve remaining-Jest totals at 68/107/403 with only the rollback key
      and orchestration digest moving; accept digest
      `19528db8149de345cffbe190041bc9a54fa948c983f9b4a4f9cacb5b413ee0d2`.
- [x] Pass frozen install, exact `workspace:*`, Inventory build, strict tooling,
      ten contracts, the final 451.9-second foundation, and all 13 Cloudflare
      gates in 212.9 seconds.
- [x] Record the initial aggregate's transient PGlite adapter timeouts; pass
      the unchanged focused 3-file/34-test selector and unchanged complete
      foundation without relaxing timeouts.
- [x] Change no assertion, source/config/fixture, dependency, catalog, lockfile,
      persistence semantic, production composition, privacy/publication, or
      repository-merge behavior, and claim no hosted CI result.

### Turn 102 - Tax Source-Unit Vitest Shadow

Status: complete locally; hosted CI is not applicable. Both Tax defaults remain
Jest and the native/no-bridge source-unit Vitest lane is opt-in.

Checklist:

- [x] Freeze two source files/tests, 12 direct expectation calls, zero
      snapshots/Jest-only source APIs, five aliases, exact defaults, two-file/
      35-test integration ownership, and all seven task graphs.
- [x] Capture the pre-edit Jest report and add a final-form expected-red
      contract that fails exactly at the missing `test:vitest` command.
- [x] Add only `test:vitest`, a source-scoped shared config with all five
      aliases and no legacy bridge, and one strict/noUnchecked tooling token.
- [x] Preserve five pre/post/post-build reports through all ten comparisons at
      two files/two passed tests/zero snapshots and digest
      `91fc1cde13d3187d8162b508ce3350cf7c05aae3fe5c0c81fc5613385c74ffe5`.
- [x] Pass direct Jest, direct Vitest, and authentic root-scoped Jest `/4`
      aggregates at 1/1/0/0 across all 12 commands.
- [x] Preserve all seven graph shapes at 85/65/20, 1/1/0, 83/63/20, 2/2/0,
      39/20/19, 5/5/0, and 63/44/19; keep Tax Jest-owned and the shadow
      outside graph/workflow ownership.
- [x] Pass unchanged Tax PGlite Jest integration at two files/35 tests and
      preserve exact fail-closed Tax/Vitest selection before spawn.
- [x] Preserve remaining-Jest totals/digest byte-for-byte at 68 configs, 107
      scripts, 403 API files, and
      `19528db8149de345cffbe190041bc9a54fa948c983f9b4a4f9cacb5b413ee0d2`.
- [x] Pass frozen install, exact `workspace:*`, Tax build/runners,
      strict/noUnchecked tooling, ten contracts, the complete 461.6-second
      foundation, and all 13 Cloudflare gates in 129.2 seconds.
- [x] Change no test source, integration command/config, assertion, dependency,
      catalog, lockfile, workflow, persistence semantic, production
      composition, privacy/publication, repository-merge behavior, or hosted
      GitHub Actions claim.

### Turn 103 - Tax Source-Unit Vitest Cut-Over

Status: complete locally; hosted CI is not applicable. Tax source tests now
default to native/no-bridge Vitest with exact Jest rollback; integration
remains Jest-only.

Checklist:

- [x] Freeze fresh pre-cut-over Jest/Vitest reports, both source/config hashes,
      exact defaults, PGlite integration behavior, and all seven task graphs.
- [x] Add final-form expected-red ownership assertions and fail exactly at the
      old Jest `test` default.
- [x] Promote Vitest to `test`, retain the byte-identical Jest command at
      `test:jest`, and remove the temporary `test:vitest` key.
- [x] Preserve six pre/post/post-build reports through all 15 comparisons at
      two files/two passed tests/zero snapshots and digest
      `91fc1cde13d3187d8162b508ce3350cf7c05aae3fe5c0c81fc5613385c74ffe5`.
- [x] Pass default Vitest, Jest rollback, and root-scoped default `/4`
      aggregates at 1/1/0/0 across all 12 commands.
- [x] Preserve all seven graph shapes while moving Tax exactly once to Vitest
      in applicable unit graphs; keep integration Jest-owned.
- [x] Pass unchanged PGlite Jest integration 35/35 before and after cut-over
      and retain fail-closed Vitest integration selection before spawn.
- [x] Preserve remaining-Jest totals at 68/107/403 with only the rollback key
      moving and accepted digest
      `84b4fc54e05453714b3aa302a48a4c612b1b9065d9ec37c9f051785965adcfad`.
- [x] Pass frozen install, exact `workspace:*`, Tax build/default/rollback,
      strict/noUnchecked tooling, ten contracts, the complete 535.8-second
      foundation, and the uninterrupted 115.1-second 13-command Cloudflare
      set.
- [x] Keep both integration files and their two Jest-only timeout sites,
      assertions, dependencies, catalogs, lockfile, workflow, persistence,
      production, privacy/publication, repository merge, and hosted GitHub
      Actions claims unchanged.

## Fixed Upcoming Turns

| Turn | Scope                                                 | Status                          | Default after turn                               |
| ---: | ----------------------------------------------------- | ------------------------------- | ------------------------------------------------ |
|    2 | Shared Node Vitest transform/config/parity foundation | complete                        | No Jest default changes                          |
|    3 | `@medusajs/locking-cloudflare` shadow                 | complete                        | Jest                                             |
|    4 | `@medusajs/locking-cloudflare` cut-over               | complete                        | Vitest, with `test:jest` rollback                |
|    5 | `@medusajs/payment-stripe` shadow                     | complete                        | Jest                                             |
|    6 | `@medusajs/payment-stripe` cut-over                   | complete                        | Vitest, with rollback                            |
|    7 | `@medusajs/core-flows` shadow                         | complete                        | Jest                                             |
|    8 | `@medusajs/core-flows` cut-over                       | complete                        | Vitest, with rollback                            |
|    9 | Currency unit shadow                                  | complete                        | Jest unit and integration                        |
|   10 | Currency unit cut-over                                | complete                        | Vitest unit; Jest integration                    |
|   11 | Runner-neutral worker identity                        | complete                        | Existing runner defaults                         |
|   12 | Integration Vitest profile and PGlite runner selector | complete                        | Jest integration                                 |
|   13 | Unchanged Currency integration shadow                 | local accepted; hosted deferred | Jest integration                                 |
|   14 | Currency integration cut-over                         | local accepted; hosted deferred | Vitest integration, with rollback                |
|   15 | Auth Emailpass zero-test unit retirement              | complete                        | No unit script; Jest integration                 |
|   16 | pnpm/Turbo unit CI forwarding                         | complete                        | Existing package defaults                        |
|   17 | Auth Emailpass integration shadow                     | complete                        | Jest integration                                 |
|   18 | Auth Emailpass integration cut-over                   | local accepted; hosted deferred | Vitest integration, with rollback                |
|   19 | Auth GitHub zero-test unit ownership                  | complete                        | No unit script; Jest integration                 |
|   20 | Auth GitHub integration shadow                        | complete                        | Jest integration                                 |
|   21 | Auth GitHub integration cut-over                      | local accepted; hosted deferred | Vitest integration, with rollback                |
|   22 | Auth Google zero-test unit ownership                  | complete                        | No unit script; Jest integration                 |
|   23 | Auth Google integration shadow                        | complete                        | Jest integration                                 |
|   24 | Auth Google integration cut-over                      | local accepted; hosted deferred | Vitest integration, with rollback                |
|   25 | File Local zero-test unit ownership                   | complete                        | No unit script; Jest integration                 |
|   26 | File Local integration shadow                         | complete                        | Jest integration                                 |
|   27 | File Local integration cut-over                       | local accepted; hosted deferred | Vitest integration, with rollback                |
|   28 | File S3 zero-test unit ownership                      | complete                        | No unit script; Jest integration                 |
|   29 | File S3 integration shadow                            | complete                        | Jest integration                                 |
|   30 | File S3 integration cut-over                          | local accepted; hosted deferred | Vitest integration, with rollback                |
|   31 | Notification Local zero-test unit ownership           | complete                        | No unit script; Jest integration                 |
|   32 | Notification Local integration shadow                 | complete                        | Jest integration                                 |
|   33 | Notification Local integration cut-over               | local accepted; hosted deferred | Vitest integration, with rollback                |
|   34 | Notification SendGrid zero-test unit ownership        | complete                        | No unit script; Jest integration                 |
|   35 | Notification SendGrid integration shadow              | complete                        | Jest integration                                 |
|   36 | Notification SendGrid integration cut-over            | local accepted; hosted deferred | Vitest integration, with rollback                |
|   37 | Locking Postgres zero-test unit ownership             | complete                        | No unit script; Jest integration                 |
|   38 | Locking Postgres integration shadow                   | complete                        | Jest integration                                 |
|   39 | Locking Postgres integration cut-over                 | local accepted; hosted deferred | Vitest integration, with rollback                |
|   40 | Locking Redis zero-test unit ownership                | complete                        | No unit script; Jest integration                 |
|   41 | Locking Redis lifecycle prerequisite                  | complete                        | Jest integration; natural exit                   |
|   42 | Locking Redis integration shadow                      | complete                        | Jest integration; Vitest shadow                  |
|   43 | Locking Redis integration cut-over                    | local accepted; hosted deferred | Vitest integration, with rollback                |
|   44 | API Key unit shadow                                   | complete                        | Jest unit and integration                        |
|   45 | API Key unit cut-over                                 | complete                        | Vitest unit; Jest integration                    |
|   46 | API Key integration shadow                            | complete                        | Vitest unit; Jest integration with Vitest shadow |
|   47 | API Key integration cut-over                          | local accepted; hosted deferred | Vitest unit/integration; Jest rollbacks          |
|   48 | Translation unit shadow                               | complete                        | Jest unit and integration                        |
|   49 | Translation unit cut-over                             | complete                        | Vitest unit; Jest integration                    |
|   50 | Vite 8.1.5 baseline refresh                           | complete                        | Runner ownership unchanged                       |
|   51 | Translation integration shadow                        | complete                        | Vitest unit; Jest integration with Vitest shadow |
|   52 | Translation integration cut-over                      | local accepted; hosted deferred | Vitest unit/integration; Jest rollbacks          |
|   53 | Vite 8.2.0 baseline refresh                           | complete                        | Runner ownership unchanged                       |
|   54 | Settings unit shadow                                  | complete                        | Jest unit/integration; Vitest unit shadow        |
|   55 | Settings unit cut-over                                | complete                        | Vitest unit; Jest integration                    |
|   56 | Settings integration shadow                           | complete                        | Vitest unit; Jest integration with Vitest shadow |
|   57 | Settings integration cut-over                         | local accepted; hosted deferred | Vitest unit/integration; Jest rollbacks          |
|   58 | Store unit shadow                                     | complete                        | Jest unit/integration; Vitest unit shadow        |
|   59 | Store unit cut-over                                   | complete                        | Vitest unit; Jest integration                    |
|   60 | Store integration shadow                              | complete                        | Vitest unit; Jest integration with shadow        |
|   61 | Store integration cut-over                            | local accepted; hosted deferred | Vitest unit/integration; Jest rollbacks          |
|   62 | Auth unit shadow                                      | complete                        | Jest unit/integration; Vitest unit shadow        |
|   63 | Auth unit cut-over                                    | complete                        | Vitest unit; Jest integration                    |
|   64 | Auth integration shadow                               | complete                        | Vitest unit; Jest integration with shadow        |
|   65 | Auth integration cut-over                             | local accepted; hosted deferred | Vitest unit/integration; Jest rollbacks          |
|   66 | Region unit shadow                                    | complete                        | Jest unit/integration; Vitest unit shadow        |
|   67 | Region unit cut-over                                  | complete                        | Vitest unit; Jest integration                    |
|   68 | Region integration shadow                             | complete                        | Vitest unit; Jest integration with shadow        |
|   69 | Region integration cut-over                           | local accepted; hosted deferred | Vitest unit/integration; Jest rollbacks          |
|   70 | RBAC unit shadow                                      | complete                        | Jest unit/integration; Vitest unit shadow        |
|   71 | RBAC unit cut-over                                    | complete                        | Vitest unit; Jest integration                    |
|   72 | RBAC integration shadow                               | complete                        | Vitest unit; Jest integration with shadow        |
|   73 | RBAC integration cut-over                             | local accepted; hosted deferred | Vitest unit/integration; Jest rollbacks          |
|   74 | User unit shadow                                      | complete                        | Jest unit/integration; Vitest unit shadow        |
|   75 | User unit cut-over                                    | complete                        | Vitest unit; Jest integration                    |
|   76 | User integration shadow                               | complete                        | Vitest unit; Jest integration with shadow        |
|   77 | User integration cut-over                             | local accepted; hosted deferred | Vitest unit/integration; Jest rollbacks          |
|   78 | Sales Channel unit shadow                             | complete                        | Jest unit/integration; Vitest unit shadow        |
|   79 | Sales Channel unit cut-over                           | complete                        | Vitest unit; Jest integration                    |
|   80 | Sales Channel integration shadow                      | complete                        | Vitest unit; Jest integration with shadow        |
|   81 | Sales Channel integration cut-over                    | local accepted; hosted deferred | Vitest unit/integration; Jest rollbacks          |
|   82 | Customer unit shadow                                  | complete                        | Jest unit/integration; Vitest unit shadow        |
|   83 | Customer unit cut-over                                | complete                        | Vitest unit; Jest integration                    |
|   84 | Customer integration shadow                           | complete                        | Vitest unit; Jest integration with shadow        |
|   85 | Customer integration cut-over                         | local accepted; hosted deferred | Vitest unit/integration; Jest rollbacks          |
|   86 | Analytics unit shadow                                 | complete                        | Jest unit/integration; Vitest unit shadow        |
|   87 | Analytics unit cut-over                               | complete                        | Vitest unit; Jest integration                    |
|   88 | Analytics integration shadow                          | complete                        | Vitest unit; Jest integration with shadow        |
|   89 | Analytics integration cut-over                        | complete locally                | Vitest unit/integration; Jest rollbacks          |
|   90 | File unit shadow                                      | complete                        | Jest unit/integration; Vitest unit shadow        |
|   91 | File unit cut-over                                    | complete                        | Vitest unit; Jest integration                    |
|   92 | File integration shadow                               | complete                        | Vitest unit; Jest integration with shadow        |
|   93 | File integration cut-over                             | complete                        | Vitest unit/integration; Jest rollbacks          |
|   94 | Stock Location unit shadow                            | complete                        | Jest unit/integration; Vitest unit shadow        |
|   95 | Stock Location unit cut-over                          | complete                        | Vitest unit; Jest integration                    |
|   96 | Stock Location integration shadow                     | complete                        | Vitest unit; Jest integration with shadow        |
|   97 | Stock Location integration cut-over                   | complete locally                | Vitest unit/integration; Jest rollbacks          |
|   98 | Inventory unit shadow                                 | complete                        | Jest unit/integration; Vitest unit shadow        |
|   99 | Inventory unit cut-over                               | complete                        | Vitest unit; Jest integration                    |
|  100 | Inventory integration shadow                          | complete                        | Vitest unit; Jest integration with shadow        |
|  101 | Inventory integration cut-over                        | complete locally                | Vitest unit/integration; Jest rollbacks          |
|  102 | Tax unit shadow                                       | complete                        | Jest unit/integration; Vitest unit shadow        |
|  103 | Tax unit cut-over                                     | complete                        | Vitest unit; Jest integration                    |
|  104 | Tax integration shadow                                | complete                        | Vitest unit; Jest integration with shadow        |
|  105 | Tax integration cut-over                              | complete locally                | Vitest unit/integration; Jest rollbacks          |
|  106 | Payment unit shadow                                   | complete                        | Jest unit; Vitest unit shadow; Jest integration  |
|  107 | Payment unit cut-over                                 | complete                        | Vitest unit; Jest integration                    |
|  108 | Payment integration shadow                            | complete                        | Vitest unit; Jest integration with shadow        |
|  109 | Payment integration cut-over                          | complete locally                | Vitest unit/integration; Jest rollbacks          |
|  110 | Notification unit shadow                              | complete                        | Jest unit/integration; Vitest unit shadow        |
|  111 | Notification unit cut-over                            | complete                        | Vitest unit; Jest integration                    |
|  112 | Notification integration shadow                       | planned                         | Vitest unit; Jest integration with Vitest shadow |

## Later Queue

Turns 44-47 started Wave B and completed API Key's unit and integration shadow/
cut-over pairs. Both Jest rollbacks remain for later retirement. Turns 48-49
complete Translation's unit shadow/cut-over pair. Turn 50 refreshes the central
Vite override and four direct owners to 8.1.5 without changing runner
ownership. Turn 51 completes Translation's separate integration shadow and Turn
52 promotes it with exact rollback plus dedicated unsharded ownership. Turn 53
refreshes the shared Vite baseline to npm-latest 8.2.0 without changing runner
ownership. Turns 54-55 complete Settings' unit shadow/cut-over pair. Turn 56
completes its separate integration shadow and Turn 57 promotes that proven lane
with exact rollback and dedicated unsharded ownership. Turn 58 completes
Store's corrected two-file unit shadow, Turn 59 promotes only that proven unit
lane, Turn 60 adds only the separately proven integration shadow, and Turn 61
promotes that integration lane with exact rollback and dedicated unsharded
ownership. Turn 62 completes Auth's one-file unit shadow and Turn 63 promotes
only that proven lane. Turn 64 completes Auth's three-file integration shadow
after exact three-backend parity; Turn 65 promotes only that proven lane with
exact rollback. Turns 66-69 complete Region's unit and integration pairs.
Turns 70-73 complete RBAC's unit and integration pairs. Turns 74-77 complete
User's unit and integration shadow/cut-over pairs. Turn 78 starts Sales
Channel with its source-unit shadow; Turn 79 promotes only that proven lane.
Turn 80 adds the separate Sales Channel integration shadow. Turn 81 promotes
that lane with exact rollback and dedicated unsharded ownership. Turn 82 starts
Customer with its source-unit shadow only; Turn 83 promotes only that proven
unit lane. Turn 84 starts the separate Customer integration shadow; Turn 85
promotes it after exact backend and shard proof. Turn 86 starts Analytics with
its source-unit shadow; Turn 87 completes the unit cut-over and supersedes the
older single-separator unit workflow assumption. Turns 88-89 complete the
separate integration shadow/cut-over sequence. Turns 90-91 complete File's
source-unit shadow/cut-over pair; Turn 92 completes its separate native
integration shadow and explicit `jest.setTimeout` migration. Turn 93 promotes
that proven lane with exact rollback. Turns 94-95 complete Stock Location's
source-unit shadow/cut-over pair; Turns 96-97 complete its separate native
integration shadow/cut-over pair and dedicated unsharded ownership. Turn 98
starts Inventory with its source-unit shadow; Turn 99 promotes only that proven
source lane. Turn 100 starts its separate integration shadow and owns the two
remaining Jest-specific integration sites explicitly. Turn 101 promotes
Inventory integration with exact rollback and dedicated unsharded ownership.
Turns 102-103 complete Tax's unit pair; Turns 104-105 complete its integration
pair and dedicated unsharded ownership. Turns 106-107 complete Payment's
source-unit pair. Turn 108 adds Payment's separate integration shadow; Turn 109
promotes it with exact rollback and dedicated unsharded PostgreSQL ownership.
Turn 110 starts Notification with its source-unit shadow only. Turn 111
promotes only that proven source shadow. Turn 112 should add only a separate
Notification integration Vitest shadow.
The default package-migration unit remains one workspace and one lane.

For every listed workspace, create a separate queue item for each active Jest
script or lane, including `test` and `test:integration`. Unit goes first;
service-backed integration waits until the Turn 12 foundation. Do not check off
a workspace while any active Jest lane remains unless Wave F records an
explicit retirement decision.

A cut-over retains its Jest rollback. Add a later rollback-retirement queue item
for that same workspace or lane after its Vitest default is stable. In that
separate turn, remove the Jest script/config together and convert compatibility
Jest APIs to explicit Vitest APIs. Retire only one workspace or lane per turn.

### Wave A - Simple Provider Workspaces, Unit First

- [ ] auth-emailpass - unit retired; integration default Vitest; rollback retained
- [ ] auth-github - unit retired; integration default Vitest; rollback retained
- [ ] auth-google - unit retired; integration default Vitest; rollback retained
- [ ] file-local - unit retired; integration default Vitest; rollback retained
- [ ] file-s3 - unit retired; integration default Vitest; rollback retained
- [ ] notification-local - unit retired; integration default Vitest; rollback retained
- [ ] notification-sendgrid - unit retired; integration default Vitest; rollback retained
- [ ] locking-postgres - unit retired; integration default Vitest; rollback retained
- [ ] locking-redis - unit retired; integration default Vitest; rollback retained

The pre-Turn 15 audit found that all nine Wave A unit scripts discovered zero
Jest tests, and all nine now have explicit unit retirement decisions. Keep any
shared Jest config required by an untouched integration lane. Empty Vitest
execution is not parity.
All nine Wave A providers remain unchecked because their explicit integration
rollback lanes still own Jest. Locking Redis now shares the same state: its
Redis-backed default is Vitest, but rollback retirement remains separate.

### Wave B - Standard Modules And PGlite Order

- [ ] api-key - unit and integration default Vitest; exact Jest rollbacks retained
- [ ] translation - unit and integration default Vitest; exact Jest rollbacks retained
- [ ] settings - unit and integration default Vitest; exact Jest rollbacks retained
- [ ] store - unit and integration default Vitest; exact Jest rollbacks retained
- [ ] auth - unit and integration default Vitest; exact Jest rollbacks retained
- [ ] region
- [ ] rbac
- [ ] user - unit and integration default Vitest; exact Jest rollbacks retained
- [ ] sales-channel
- [ ] customer
- [ ] analytics
- [ ] file
- [ ] stock-location
- [ ] inventory
- [ ] tax
- [ ] payment
- [ ] notification
- [ ] fulfillment
- [ ] promotion
- [ ] product
- [ ] pricing
- [ ] cart
- [ ] order

For each module, track unit and integration status separately. A passing unit
turn does not mark its integration lane complete.

### Wave C - Mocking-Heavy Core And CLI

- [ ] test-utils
- [ ] utils
- [ ] modules-sdk
- [ ] orchestration
- [ ] workflows-sdk
- [ ] js-sdk
- [ ] link-modules
- [ ] framework
- [ ] medusa
- [ ] create-medusa-app
- [ ] medusa-cli
- [ ] medusa-dev-cli

### Wave D - External Services And Orchestration

- [ ] cache-inmemory
- [ ] cache-redis
- [ ] caching
- [ ] event-bus-local
- [ ] event-bus-redis
- [ ] event-bus-cloudflare
- [ ] locking
- [ ] index
- [ ] workflow-engine-cloudflare
- [ ] workflow-engine-inmemory
- [ ] workflow-engine-redis

Redis-backed validation must be recorded separately from non-Redis results.

### Wave E - Top-Level Integration

- [ ] `integration-tests/modules`
- [ ] `integration-tests/http`

### Wave F - Special Decisions And Cleanup

- [x] Pull Auth Emailpass's zero-test unit decision forward: retire its empty
      unit script without claiming Vitest parity; retain its active
      integration-consuming Jest config.
- [ ] Decide whether `@medusajs/types`' five currently skipped-by-script files
      should be activated or remain outside the package gate.
- [ ] Retire or restore the zero-test Jest scripts/configs in
      `@medusajs/telemetry`, `@medusajs/analytics-local`,
      `@medusajs/analytics-posthog`, `@medusajs/caching-redis`, and
      `@medusajs/fulfillment-manual` without counting them as migrated tests.
- [ ] Decide whether the API `.txt` archive is restored, retained as archive,
      or removed in a separately approved cleanup.
- [ ] Remove or replace the inactive aggregate integration Jest config.
- [ ] Audit 35 `watch:test` scripts, including the 34 references to missing
      `tsconfig.spec.json` files.
- [ ] Complete rollback-retirement turns one workspace or lane at a time; do
      not batch the Jest-to-Vitest API conversion into the final commit.
- [ ] Run the zero-Jest final cleanup gate.

## Evidence Ledger

| Turn | Package or lane                 | Jest baseline           | Vitest parity           | Default switched   | Required services            | Commit       |
| ---: | ------------------------------- | ----------------------- | ----------------------- | ------------------ | ---------------------------- | ------------ |
|    0 | Planning only                   | not run                 | not run                 | no                 | none                         | `db53bf3601` |
|    1 | Existing Vitest/Vite owners     | Jest lanes unchanged    | 494 files / 622 tests   | no                 | local D1/workerd             | `48dea7e01f` |
|    2 | Shared Node foundation          | 5 files / 10 tests      | exact 5-file parity     | no                 | none                         | `f2c34a47b3` |
|    3 | Locking Cloudflare shadow       | 1 file / 1 test         | exact 1-file parity     | no                 | none                         | `83b4deec8c` |
|    4 | Locking Cloudflare cut-over     | 1 file / 1 test         | exact 1-file parity     | yes                | none                         | `dcd9b7b81d` |
|    5 | Payment Stripe shadow           | 1 file / 1 test         | exact 1-file parity     | no                 | none                         | `67de3aadca` |
|    6 | Payment Stripe cut-over         | 1 file / 1 test         | exact 1-file parity     | yes                | none                         | `897cb804ea` |
|    7 | Core Flows shadow               | 3 files / 13 tests      | exact 3-file parity     | no                 | none                         | `5f62a07187` |
|    8 | Core Flows cut-over             | 3 files / 13 tests      | exact 3-file parity     | yes                | none                         | `0eb789b960` |
|    9 | Currency unit shadow            | 2 files / 2 tests       | exact 2-file parity     | no                 | none                         | `ef06812651` |
|   10 | Currency unit cut-over          | 2 files / 2 tests       | exact 2-file parity     | yes                | none                         | `135dd713a8` |
|   11 | Worker identity boundary        | Jest values retained    | Vitest namespaced       | no                 | none                         | `02bba6a19c` |
|   12 | PGlite adapter foundation       | 3 files / 34 tests      | exact 3-file parity     | no                 | in-process PGlite            | `f8444e6f69` |
|   13 | Currency integration shadow     | 1 file / 13 tests       | exact on 3 backends     | no                 | PostgreSQL + PGlite + SQLite | `dca870fee4` |
|   14 | Currency integration cut-over   | 1 file / 13 tests       | exact on 3 backends     | yes                | PostgreSQL + PGlite + SQLite | `9e3da4fa6e` |
|   15 | Auth Emailpass unit ownership   | 0 files / 0 tests       | not claimed             | retired empty lane | none                         | `7910bb5dc3` |
|   16 | Unit CI forwarding boundary     | malformed 85-node run   | 83/2 graph + real lanes | no                 | none                         | `c20de19286` |
|   17 | Auth Emailpass integration      | 1 file / 9 tests        | exact 1-file parity     | no                 | none                         | `ac03c9df21` |
|   18 | Auth Emailpass integration      | 1 file / 9 tests        | exact 1-file parity     | yes                | none                         | `bc6dab98ea` |
|   19 | Auth GitHub unit ownership      | 0 files / 0 tests       | not claimed             | retired empty lane | none                         | `4ac4a518eb` |
|   20 | Auth GitHub integration         | 1 file / 9 tests        | exact 1-file parity     | no                 | none                         | `6c0e09c3de` |
|   21 | Auth GitHub integration         | 1 file / 9 tests        | exact 1-file parity     | yes                | none                         | `6171c0b50d` |
|   22 | Auth Google unit ownership      | 0 files / 0 tests       | not claimed             | retired empty lane | none                         | `7965f31068` |
|   23 | Auth Google integration         | 1 file / 9 tests        | exact 1-file parity     | no                 | none                         | `6474ecbede` |
|   24 | Auth Google integration         | 1 file / 9 tests        | exact 1-file parity     | yes                | none                         | `4c051d2d0c` |
|   25 | File Local unit ownership       | 0 files / 0 tests       | not claimed             | retired empty lane | none                         | `824920b3a8` |
|   26 | File Local integration          | 1 file / 2 tests        | exact 1-file parity     | no                 | local filesystem             | `39e78ba87d` |
|   27 | File Local integration          | 1 file / 2 tests        | exact 1-file parity     | yes                | local filesystem             | `12681b0912` |
|   28 | File S3 unit ownership          | 0 files / 0 tests       | not claimed             | retired empty lane | none                         | `02a48c210e` |
|   29 | File S3 integration shadow      | 1 file / 8 skipped      | exact skipped parity    | no                 | none executed                | `dbbe6511b7` |
|   30 | File S3 integration cut-over    | 1 file / 8 skipped      | exact skipped parity    | yes                | none executed                | `da5bd98f53` |
|   31 | Notification Local unit         | 0 files / 0 tests       | not claimed             | retired empty lane | none                         | `6dececa1d0` |
|   32 | Notification Local integration  | 1 file / 1 test         | exact 1-file parity     | no                 | none                         | `0bead05d23` |
|   33 | Notification Local cut-over     | 1 file / 1 test         | exact 1-file parity     | yes                | none                         | `07a1caabd5` |
|   34 | Notification SendGrid unit      | 0 files / 0 tests       | not claimed             | retired empty lane | none                         | `ac345e53be` |
|   35 | Notification SendGrid shadow    | 1 file / 5 skipped      | exact skipped parity    | no                 | none executed                | `1e68aa8b1f` |
|   36 | Notification SendGrid cut-over  | 1 file / 5 skipped      | exact skipped parity    | yes                | none executed                | `4dc562a1e3` |
|   37 | Locking Postgres unit           | 0 files / 0 tests       | not claimed             | retired empty lane | PostgreSQL integration kept  | `91a6b91fc8` |
|   38 | Locking Postgres shadow         | 1 file / 6 tests        | exact 1-file parity     | no                 | PostgreSQL 18.3              | `96c15c8b13` |
|   39 | Locking Postgres cut-over       | 1 file / 6 tests        | exact 1-file parity     | yes                | PostgreSQL 18.3              | `038b3e12d7` |
|   40 | Locking Redis unit              | 0 files / 0 tests       | not claimed             | retired empty lane | Redis integration kept       | `77aa7baf87` |
|   41 | Locking Redis lifecycle         | 1 file / 7 tests        | not a Vitest shadow     | no                 | isolated Redis, natural exit | `868913f7ae` |
|   42 | Locking Redis shadow            | 1 file / 7 tests        | exact 1-file parity     | no                 | Redis-compatible 8.8.0       | `15090837f1` |
|   43 | Locking Redis cut-over          | 1 file / 7 tests        | exact 1-file parity     | yes                | Redis-compatible 8.8.0       | `f980a459ef` |
|   44 | API Key unit shadow             | 2 files / 2 tests       | exact 2-file parity     | no                 | none                         | `68504ce7b3` |
|   45 | API Key unit cut-over           | 2 files / 2 tests       | exact 2-file parity     | yes                | none                         | `a3cfe7b644` |
|   46 | API Key integration shadow      | 1 file / 25 tests       | exact on 3 backends     | no                 | PostgreSQL + PGlite + SQLite | `8e299ab14b` |
|   47 | API Key integration cut-over    | 1 file / 25 tests       | exact on 3 backends     | yes                | PostgreSQL + PGlite + SQLite | `62c89b3ad6` |
|   48 | Translation unit shadow         | 1 file / 1 test         | exact 1-file parity     | no                 | none                         | `0c8ea06b00` |
|   49 | Translation unit cut-over       | 1 file / 1 test         | exact 1-file parity     | yes                | none                         | `dc36f4cf40` |
|   50 | Vite 8.1.5 baseline refresh     | ownership unchanged     | full baseline re-proved | unchanged          | none newly required          | `c11241db2c` |
|   51 | Translation integration shadow  | 1 file / 60 tests       | exact on 3 backends     | no                 | PostgreSQL + PGlite + SQLite | `e07b25bebc` |
|   52 | Translation integration cutover | 1 file / 60 tests       | exact on 3 backends     | yes                | PostgreSQL + PGlite + SQLite | `0eeb819d16` |
|   53 | Vite 8.2.0 baseline refresh     | ownership unchanged     | full baseline re-proved | unchanged          | none newly required          | `f32d89b30f` |
|   54 | Settings unit shadow            | 1 file / 1 test         | exact 1-file parity     | no                 | none                         | `7360cb4030` |
|   55 | Settings unit cut-over          | 1 file / 1 test         | exact 1-file parity     | yes                | none                         | `bd02b6d954` |
|   56 | Settings integration shadow     | 1 file / 11 tests       | exact on 3 backends     | no                 | PostgreSQL + PGlite + SQLite | `bc15396832` |
|   57 | Settings integration cut-over   | 1 file / 11 tests       | exact on 3 backends     | yes                | PostgreSQL + PGlite + SQLite | `118ff23c15` |
|   58 | Store unit shadow               | 2 files / 2 tests       | exact 2-file parity     | no                 | none                         | `54c2aef227` |
|   59 | Store unit cut-over             | 2 files / 2 tests       | exact 2-file parity     | yes                | none                         | `4853277b69` |
|   60 | Store integration shadow        | 1 file / 12 tests       | exact on 3 backends     | no                 | PostgreSQL + PGlite + SQLite | `c292d65a57` |
|   61 | Store integration cut-over      | 1 file / 12 tests       | exact on 3 backends     | yes                | PostgreSQL + PGlite + SQLite | `57b24eaddd` |
|   62 | Auth unit shadow                | 1 file / 1 test         | exact 1-file parity     | no                 | none                         | `e7ff8ccb61` |
|   63 | Auth unit cut-over              | 1 file / 1 test         | exact 1-file parity     | yes                | none                         | `19a411a98e` |
|   64 | Auth integration shadow         | 3 files / 36 tests      | exact on 3 backends     | no                 | PostgreSQL + PGlite + SQLite | `13c4fae717` |
|   65 | Auth integration cut-over       | 3 files / 36 tests      | exact on 3 backends     | yes                | PostgreSQL + PGlite + SQLite | This commit  |
|   66 | Region unit shadow              | 1 file / 1 test         | exact 1-file parity     | no                 | none                         | This commit  |
|   67 | Region unit cut-over            | 1 file / 1 test         | exact 1-file parity     | yes                | none                         | This commit  |
|   68 | Region integration shadow       | 1 file / 18 tests       | exact on 3 backends     | no                 | PostgreSQL + PGlite + SQLite | `ffb34a085e` |
|   69 | Region integration cut-over     | 1 file / 18 tests       | exact on 3 backends     | yes                | PostgreSQL + PGlite + SQLite | `296f3c55dc` |
|   70 | RBAC unit shadow                | 1 file / 1 test         | exact 1-file parity     | no                 | none                         | `995637d2f7` |
|   71 | RBAC unit cut-over              | 1 file / 1 test         | exact 1-file parity     | yes                | none                         | `ebe9aa1f4f` |
|   72 | RBAC integration shadow         | 1 file / 7 declarations | exact on 3 backends     | no                 | PostgreSQL + PGlite + SQLite | `9445949048` |
|   73 | RBAC integration cut-over       | 1 file / 7 declarations | exact on 3 backends     | yes                | PostgreSQL + PGlite + SQLite | `238aa4c310` |
|   74 | User unit shadow                | 1 file / 1 test         | exact 1-file parity     | no                 | none                         | This commit  |
|   75 | User unit cut-over              | 1 file / 1 test         | exact 1-file parity     | yes                | none                         | This commit  |
|   76 | User integration shadow         | 2 files / 28 tests      | exact on 3 backends     | no                 | PostgreSQL + PGlite + SQLite | This commit  |
|   77 | User integration cut-over       | 2 files / 28 tests      | exact on 3 backends     | yes                | PostgreSQL + PGlite + SQLite | This commit  |

Add one row after every completed implementation turn. Do not rewrite prior
rows when a later turn changes another package.

## Known Remaining Risks

- The shared SWC profile is proven by two provider shadows and the Core Flows
  shared-core shadow, but every remaining package still needs an explicit
  alias/discovery review before it can consume the profile.
- One helper still reads `JEST_WORKER_ID` for Jest compatibility; the four
  runtime/setup consumers no longer own runner-specific environment logic.
- SQL/PGlite database names are runner-namespaced, but Redis logical database
  numbers are not. Cross-runner Redis shadows need a separate URL/key namespace
  or an explicitly constrained allocation before they can be claimed isolated.
- Jest discovers files under `__tests__` that a default Vitest glob may omit.
- Module aliases and the Medusa/Framework singleton mapping must be preserved.
- Module mocks, fake timers, reset/isolation, Jest namespace types, and CJS
  tests require focused turns.
- Directly replacing `jest.*` with `vi.*` breaks the promised Jest rollback;
  dual-run compatibility and later rollback retirement must remain separate.
- The PGlite runner still defaults to Jest. Its adapter foundation, Currency,
  API Key, Translation, Settings, Store, and Auth support Vitest. Each
  migrated module's default-Jest selector invokes its rollback while explicit
  Vitest selection invokes its package default. Region is the first
  unsupported lane, and later production module lanes remain Jest-only until
  migrated one at a time.
- All three migration-foundation verifiers still execute Jest for parity. Their
  files are explicitly inventoried and must be retired or made Vitest-only in
  the final zero-Jest cleanup.
- Turn 16 corrects the unit-matrix pnpm/Turbo filter placement and freezes the
  exact strings through a parsed workflow contract. Local 83/2 dry-runs and
  representative real Jest/Vitest executions pass, but the first hosted result
  after publication remains deferred rather than claimed. The focused Currency
  integration job is a separate locally checked boundary whose hosted result is
  also deferred. Currency's one-file integration suite cannot consume the
  generic three-way package shard and remains owned by its dedicated unsharded
  job.
- Jest and Vitest can assign the same files to different shard numbers; require
  exact aggregate coverage rather than runner-to-runner shard identity.
- A package can share one Jest config across unit and integration scripts;
  Vitest profiles must scope discovery to the lane being migrated.
- Auth Emailpass's one-file Vitest integration suite cannot consume the generic
  package lane's three-way shard. It is now excluded from that lane and owned by
  a dedicated unsharded job with aggregate result propagation. The job shape is
  locally contract-tested, but its first hosted result remains deferred.
- Auth GitHub's one-file Vitest integration is now excluded from the generic
  fast shard and owned by a dedicated unsharded job with aggregate propagation.
  The local workflow contract/command pass, but its first hosted result remains
  deferred.
- Auth Google's one-file Vitest integration is now excluded from the generic
  fast shard and owned by a dedicated unsharded job with aggregate propagation.
  Its Google-specific crypto/JWT/MSW path and exact rollback parity pass
  locally, but the new job's first hosted result remains deferred.
- File Local's one-file Vitest integration is now excluded from the generic fast
  shard and owned by a dedicated unsharded service-free job with aggregate
  propagation. Exact filesystem/rollback parity and the parsed workflow contract
  pass locally, but the job's first hosted result remains deferred.
- File S3's retained integration suite is entirely `describe.skip`: eight cases
  are discovered but none executes. It now has a dedicated unsharded default
  job with locally proven contract shape, but the first hosted result remains
  deferred. Even hosted green proves only collection/skip preservation. Live
  credentials, isolation, AWS/Axios traffic, failure-safe cleanup, and
  open-handle behavior still require deliberate later work.
- Notification Local's one local console-spy integration now defaults to Vitest
  with exact rollback parity for `jest.setTimeout`, `jest.spyOn`, and
  `jest.restoreAllMocks`. Its one-file lane is excluded from the generic shard
  and owned by a dedicated unsharded job with locally proven aggregate contract;
  the first hosted result remains deferred.
- Notification SendGrid now defaults to Vitest with exact Jest rollback. Its
  wholly skipped five-case manual live-service suite is excluded from generic
  sharding and owned by a dedicated unsharded job with locally proven aggregate
  shape. The first hosted result remains deferred. Even hosted green would prove
  only collection/skip preservation; enabling the suite can send real email and
  depends on remote errors without interception or cleanup.
- Locking Postgres now defaults to Vitest with exact Jest rollback. Its one-file
  lane cannot consume generic `/3` sharding, so it is excluded only from the
  fast graph and owned by a dedicated unsharded PostgreSQL job. The local typed
  contract freezes `POSTGRES_DB: medusa-locking-integration-vitest-1`, service
  credentials, steps, and aggregate terminal states; the first hosted result is
  deferred. The shared pool still opens before automatic database creation, so
  local parity must pre-create `medusa-locking-integration-1` for Jest and
  `medusa-locking-integration-vitest-1` for Vitest. `DB_TEMP_NAME` does not
  replace those module-runner names.
- Native Vitest `require.resolve("../../src")` cannot preserve this suite's raw
  TypeScript provider path through the built Medusa loader. The accepted shadow
  resolves the freshly built production package for both runners. A future
  source-through-Vite solution needs a separate module/resource-loader and
  direct `ModuleProviderExports` registration contract; do not hide it in an
  AST rewrite or native require hook.
- The Locking Postgres package still relies on the inherited hoisted
  `@medusajs/test-utils` integration-test import. This turn does not silently
  add a dependency, but strict-linker preparation must audit it separately.
- Turn 43 cuts Locking Redis over after fresh service-backed parity and cleanup,
  preserves natural-exit Jest rollback, and adds locally contract-tested
  unsharded workflow ownership. The third-party service and YAML parser still
  do not establish the hosted workflow Redis image/engine or execution.
- The first Turn 38 aggregate foundation attempt reached the PGlite Vitest
  child and exited 1 while C: had about 2.1 GB free. After the completed
  temporary PostgreSQL cluster was safely removed, the focused adapter and
  complete 262.7-second aggregate passed. Keep disk pressure separate from
  runner behavior.
- Vitest 4 sharded `list` can print an unhandled shard-count error while exiting
  zero when shards outnumber files; use unsharded list for discovery and real
  `run` output for shard evidence.
- API Key's one-file Vitest integration exits 1 under the generic `/3` shard.
  Turn 47 excludes it from fast, adds a dedicated unsharded PostgreSQL job, and
  propagates that job through the package aggregate. The local parsed contract
  and direct command do not establish a hosted result or hosted PGlite/Drizzle/
  Jest rollback parity.
- Translation's unit default is one Vitest file, but the existing unit workflow
  forwards `--passWithNoTests`; package and direct Turbo `/4` probes pass at
  1/0/0/0 without a dedicated job. Translation integration now defaults to
  Vitest with exact three-backend rollback parity. Its real `/3` run exits 1,
  so the package is excluded from the generic fast shard and owned by a
  dedicated unsharded PostgreSQL job with aggregate propagation. The parsed
  contract and direct command pass locally; the first hosted result remains
  deferred.
- Vite 8.2.0 with built-in Rolldown 1.2.0 is now the installed and locked
  baseline; Vitest and `@vitest/coverage-v8` remain 4.1.10. Because 8.2.0 was
  published inside the normal minimum-release-age window, the workspace owns an
  exact `vite@8.2.0` exception that should be removed separately after the age
  window passes. The four remaining peer-audit groups are pre-existing and
  unrelated to this goal.
- Vite 8.2.0 warns about existing extensionless config imports and ESM syntax
  loaded through CommonJS when describing a future native-loader default.
  Current Vite 8.2/Vitest 4 execution passes; module-identity cleanup must not
  be hidden inside a package migration.
- Settings' unit and integration defaults are Vitest with exact Jest rollbacks.
  The unit lane passes `/4` at 1/0/0/0. The database-backed integration lane
  has exact default/rollback parity on PostgreSQL, PGlite, and Drizzle/SQLite.
  Its one file cannot consume generic `/3` sharding, so Settings is excluded
  from fast and owned by a locally contract-tested, dedicated, runner-neutral,
  unsharded PostgreSQL job. Its first hosted result remains deferred.
- Store's unit lane owns two source files, not one: the real static-manifest
  specification and an existing noop test. Vitest now owns the default with
  exact Jest rollback, parity, and `/4` aggregate coverage. Store integration
  remains Jest-owned but now has exact PostgreSQL/PGlite/Drizzle Vitest shadow
  parity. Both PGlite selectors pass, and
  Store's one-file shadow has no sharded CI owner.
- Auth integration now defaults to Vitest with exact Jest rollback and exact
  three-file/36-test PostgreSQL, PGlite, and Drizzle/SQLite parity. Both
  PGlite selectors and both runners' complete `/3` aggregates pass; runner
  shard numbers differ, so aggregate ownership is authoritative. The
  path-loaded provider fixture remains one checked CommonJS JavaScript
  implementation because the built Medusa loader cannot consume the original
  raw TypeScript path portably across the supported Node range. Region is the
  next fail-closed Vitest PGlite lane.
- Region's one-file source-unit lane now defaults to Vitest with exact Jest
  rollback parity and `/4` aggregate coverage. Its one-file/18-test integration
  lane now defaults to Vitest with exact Jest rollback parity across
  PostgreSQL, PGlite, and Drizzle/SQLite. Both PGlite selectors pass. The
  one-file default cannot consume `/3`, so Region is excluded from fast and
  owned by a locally contract-tested, runner-neutral, unsharded PostgreSQL job
  with aggregate propagation. The first hosted result remains deferred. RBAC
  is the next fail-closed PGlite Vitest lane.
- RBAC's one-file source-unit lane now defaults to Vitest with exact Jest
  rollback parity, post-build discovery, and both runners' `/4` coverage at
  1/0/0/0. Integration now defaults to Vitest with exact Jest rollback parity
  on PostgreSQL, PGlite, and Drizzle/SQLite at six passed/one skipped test.
  Both PGlite selectors pass and User is the next fail-closed Vitest lane. The
  one integration file lands only on shard 1 under `/3`, so RBAC is excluded
  from generic fast sharding and owned by a locally contract-tested,
  runner-neutral, unsharded PostgreSQL job. Its first hosted result remains
  deferred.
- User's one-file source-unit lane now defaults to Vitest with exact Jest
  rollback parity, post-build discovery, and both `/4` aggregates at 1/0/0/0.
  User's two-file/28-test integration now defaults to Vitest with exact Jest
  rollback parity on PostgreSQL, PGlite, and Drizzle/SQLite. Both PGlite
  selectors pass, and Sales Channel is the next fail-closed Vitest lane. Both
  runners' `/3` aggregates are 14/14/0 with all shards successful, so User
  remains in the generic fast graph without a dedicated job.
- Sales Channel's two-file/three-test source unit lane and one-file/14-test
  integration lane now default to Vitest with exact Jest rollbacks. Integration
  has exact PostgreSQL/PGlite/Drizzle parity, both PGlite selectors pass, and
  Customer is the next fail-closed lane. Every Vitest `/3` command rejects the
  one-file suite, so Sales Channel is excluded from generic fast sharding and
  owned by one runner-neutral unsharded PostgreSQL job with package-aggregate
  propagation.
- Analytics's one-file source-unit lane now defaults to Vitest with exact Jest
  rollback, six-report parity, and both runners' `/4` distribution at
  1/0/0/0. Its one-file/three-test integration lane now also defaults to
  Vitest with exact Jest rollback and PostgreSQL/PGlite/Drizzle parity. Both
  PGlite selectors pass, File is the next fail-closed integration lane, and
  both runners retain `/3` distribution 3/0/0. Analytics remains in generic
  fast sharding without a dedicated job.
- File's two-file/two-test source-unit lane and one-file/four-test integration
  lane now default to Vitest with exact Jest rollbacks. Integration remains
  native/no-bridge with exact PostgreSQL/PGlite/Drizzle parity, runner-owned
  timeouts, both PGlite selectors passing, and both `/3` aggregates at 4/0/0.
  File remains in generic fast ownership; Stock Location is the next
  fail-closed lane.
- Stock Location's two-file/two-test source-unit and one-file/eight-test
  integration lanes now default to native Vitest with exact Jest rollbacks.
  Integration preserves exact PostgreSQL/PGlite/Drizzle parity, contains no
  `jest.*`, and keeps runner-owned timeouts. Both PGlite selectors pass and
  Inventory is next fail-closed. The integration suite cannot consume `/3`,
  so Stock Location is excluded from generic fast sharding and owned by one
  locally contract-tested, runner-neutral, unsharded PostgreSQL workflow job
  with aggregate propagation. Its first hosted result remains deferred.
- Inventory's two-file/two-test source-unit and one-file/35-test integration
  lanes now default to native Vitest with exact Jest rollbacks. Integration
  preserves PostgreSQL/PGlite/Drizzle parity, uses imported `vi.spyOn`, and has
  no global Jest bridge. Both PGlite selectors pass and Tax is next fail-closed.
  The one integration file cannot consume `/3`, so Inventory is excluded from
  fast sharding and owned by one locally contract-tested, runner-neutral,
  unsharded PostgreSQL workflow job. Its first hosted result remains deferred.
- Tax's two-file/two-test source-unit and two-file/35-test integration lanes
  now default to native/no-bridge Vitest with exact Jest rollbacks. Integration
  preserves PostgreSQL/PGlite/Drizzle parity, both PGlite selectors pass, both
  files contain zero `jest.*`, and runner configuration owns the 30-second
  timeout. The integration suite cannot consume generic `/3`, so Tax is
  excluded from fast and owned by one locally contract-tested, runner-neutral,
  unsharded PostgreSQL workflow job. Its first hosted result remains deferred;
  Payment is the next fail-closed PGlite/Vitest lane.
- Payment's two-file/three-test source-unit and two-file/36-test integration
  lanes now default to native/no-bridge Vitest with exact Jest rollbacks.
  Integration preserves PostgreSQL/PGlite/Drizzle parity and dedicated
  unsharded PostgreSQL ownership. Notification is the next fail-closed
  PGlite/Vitest lane.
- Notification's one-file/one-test source-unit lane now defaults to
  native/no-bridge Vitest with exact Jest rollback and six-report parity before
  and after build. The source file contains zero `jest.*`; direct default
  Vitest, Jest rollback, and authentic root-scoped default `/4` aggregates
  cover the file on shard 1 and none on shards 2, 3, and 4. Notification
  integration remains Jest/PGlite-only and fail-closed for Vitest.
- The temporary Turn 42 Redis-compatible Windows service proves local parity
  and cleanup only. The repository workflow's Redis image/engine and hosted
  execution remain unproven.
- Turbo 1.13.4's pnpm 11 graph issue remains separate from this goal.

## Turn 104 Receipt

Tax integration now has a native/no-bridge Vitest shadow while Jest remains
authoritative. The two source timeout calls moved into runner configuration;
all assertions remain unchanged and both files contain zero `jest.*`.

Nine PostgreSQL/PGlite/Drizzle reports and all 36 pairs preserve two files, 35
tests, every full name/status, and zero snapshots. Both PGlite selectors pass.
Jest `/3` remains 34/1/0; all native Vitest `/3` commands reject because three
shards exceed two files. The seven task graphs remain 85/65/20, 1/1/0,
83/63/20, 2/2/0, 39/20/19, 5/5/0, and 63/44/19, so the shadow has no CI owner.

Remaining-Jest ownership is 68 configs, 107 scripts, and 401 active API files
with digest
`03652555ffb8f16b9fb5dba556ad6fa972ffdaccba6275c770c0d776c4bb257a`.
Frozen install, workspace-edge validation, Tax build/runners, strict tooling,
the complete 367.0-second foundation, and all 13 Cloudflare gates in 172.8
seconds pass. No hosted result is claimed.

## Next Command Slice

Start Turn 105 only: promote Tax integration to native Vitest, retain exact
Jest rollback, exclude it from generic fast `/3`, and add a runner-neutral
unsharded PostgreSQL job with aggregate propagation. Do not change assertions,
persistence semantics, dependencies, catalogs, or publication metadata.

## Turn 105 Receipt

Tax integration now defaults to native/no-bridge Vitest, retains the exact
Jest rollback, and no longer has a temporary shadow key. Twelve reports and all
66 PostgreSQL/PGlite/Drizzle comparisons preserve two files, 35 passed tests,
every full name/status, and zero snapshots. Both post-cutover PGlite selectors
and the exact unsharded PostgreSQL workflow command pass 35/35.

Tax leaves generic fast `/3` and gains one locally contract-tested,
runner-neutral unsharded PostgreSQL job with aggregate propagation. Unit graph
shapes remain 85/65/20, 1/1/0, 83/63/20, and 2/2/0; integration shapes become
38/19/19 fast and remain 5/5/0 slow and 63/44/19 all. Remaining-Jest ownership
stays 68/107/401 with digest
`a9c763420f7f77d4c19d8a3423f78e9185d9663953d8f1aa46127882e1fef4b5`.

Frozen install, workspace-edge validation, Tax build/runners, strict tooling,
the complete 359.8-second foundation, and all 13 independent Cloudflare gates
pass. The Currency workerd gate required unchanged cold-start retries after
its known local D1 cleanup warning, then passed in 93.1 seconds. No hosted
result is claimed.

## Next Command Slice

Start Turn 106 only: audit and add a separate Payment source-unit native
Vitest shadow. Freeze the exact Jest baseline, source/config/API inventory,
build discovery, and `/4` distribution first. Keep Payment integration
Jest-only and fail-closed until its separate migration turns.

## Turn 106 Receipt

Payment source tests retain their exact Jest default and gain only an opt-in
native/no-bridge Vitest shadow. Five reports and all ten comparisons preserve
two files, three tests, every full name/status, 20 direct expectation sites,
and zero snapshots, with normalized digest
`c6e366aa9379fd5e02aef08add09a1f2aee430fa8b731b55203d501e5ca87c72`.

Direct Jest, direct Vitest, and authentic root-scoped Jest `/4` commands all
pass with one file on shards 1 and 2 and empty shards 3 and 4. All seven task
graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 38/19/19, 5/5/0, and
63/44/19, so the shadow has no graph or workflow owner. Payment's real PGlite
Jest integration passes two files/36 tests; Vitest integration remains
fail-closed before spawn.

Remaining-Jest ownership is byte-identical at 68/107/401 with digest
`a9c763420f7f77d4c19d8a3423f78e9185d9663953d8f1aa46127882e1fef4b5`.
Frozen install, workspace-edge validation, Payment build/runners, strict
tooling, the complete 494.7-second foundation, and all 13 Cloudflare gates in
234.7 seconds pass. One initial unrelated PGlite adapter timeout passed on an
unchanged focused recovery and full rerun. No hosted result is claimed.

## Next Command Slice

Start Turn 107 only: promote Payment source tests to native Vitest, retain the
exact Jest command at `test:jest`, and remove `test:vitest`. Keep Payment
integration Jest-only and fail-closed until its separate migration turns.

## Turn 107 Receipt

Payment source tests now default to native/no-bridge Vitest with the exact Jest
source command retained at `test:jest`; the temporary shadow key is removed.
Six reports and all 15 comparisons preserve two files, three tests, every full
name/status, 20 direct expectation sites, zero snapshots, and normalized digest
`c6e366aa9379fd5e02aef08add09a1f2aee430fa8b731b55203d501e5ca87c72`.

Direct default Vitest, direct Jest rollback, and authentic root-scoped default
Vitest `/4` commands all pass across 12 valid commands. Vitest distributes
tests 2/1/0/0, Jest distributes 1/2/0/0, and both distribute files 1/1/0/0.
The seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 38/19/19,
5/5/0, and 63/44/19, moving Payment exactly once only in applicable unit
graphs. Payment's unchanged PGlite/Jest integration passes two files/36 tests;
Vitest remains fail-closed before spawn.

Remaining-Jest ownership stays 68 configs, 107 scripts, and 401 active API
files, with accepted digest
`cd2aa0861138adb0030597725f2a6d5a915d12514692fb78cac664d23bd7f3cb`.
Frozen install, workspace-edge validation, Payment build/runners, strict
tooling, the complete 448.3-second foundation, and all 13 Cloudflare gates in
198.7 seconds pass. The first foundation attempt hit the existing lifecycle
contract's unchanged five-second hook limit; the exact focused contract and
the complete rerun passed unchanged. No hosted result is claimed.

## Next Command Slice

Start Turn 108 only: audit and add a separate Payment integration native
Vitest shadow while Jest remains authoritative. Freeze its two files, 36 tests,
assertions, Jest-only APIs, aliases, timeout ownership, backend behavior, and
sharding before editing. Do not combine default cut-over, workflow, dependency,
catalog, persistence, or publication changes.

## Turn 108 Receipt

Payment integration retains its exact Jest default and gains an opt-in
native/no-bridge Vitest shadow. The two 30-second source timeout calls move into
runner ownership; one clear and ten spies now use imported `vi`, with a narrow
Jest-only resolver shim preserving rollback/default execution. Both source
files contain zero direct `jest.*`, and no assertion changes.

Nine PostgreSQL/PGlite/Drizzle reports and all 36 comparisons preserve two
files, 36 tests, every full name/status, 56 direct expectation sites, zero
snapshots, and normalized digest
`c9765002192f9fd799236738fe6cd8564599a6144599b7486606b372f0565c55`.
Both PGlite selectors pass; Notification is the next fail-closed Vitest lane.

Jest `/3` remains 31/5/0 before and after, while every native Vitest `/3`
command rejects before import because three shards exceed two files. All seven
graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 38/19/19, 5/5/0, and
63/44/19, so the shadow has no graph or workflow owner.

Remaining-Jest ownership becomes 68/107/399 with digest
`af1bb8fe1f293c7c8fa04c84d0053c2dca856405b04675bd4eb2f8aba6278dcd`.
Frozen install, workspace-edge validation, Payment build/runners, strict
tooling, the final complete 418.2-second foundation, and all 13 Cloudflare gates
pass. Resource-sensitive foundation and workerd attempts recovered unchanged;
no timeout or source workaround was added. No hosted result is claimed.

## Next Command Slice

Start Turn 109 only: promote Payment integration to native Vitest, retain exact
Jest rollback, exclude it from generic fast `/3`, and add a runner-neutral
unsharded PostgreSQL job with aggregate propagation. Do not change assertions,
persistence semantics, dependencies, catalogs, or publication metadata.

## Turn 109 Receipt

Payment integration now defaults to native/no-bridge Vitest, retains the exact
Jest rollback, and no longer has a temporary shadow key. Twelve reports and all
66 PostgreSQL/PGlite/Drizzle comparisons preserve two files, 36 passed tests,
every full name/status, 56 expectation sites, zero snapshots, and digest
`c9765002192f9fd799236738fe6cd8564599a6144599b7486606b372f0565c55`.
Both post-cut-over PGlite selectors and the exact unsharded PostgreSQL workflow
command pass 36/36.

Payment leaves generic fast `/3` and gains one locally contract-tested,
runner-neutral unsharded PostgreSQL job with aggregate propagation. Unit graph
shapes remain 85/65/20, 1/1/0, 83/63/20, and 2/2/0; integration shapes become
37/18/19 fast and remain 5/5/0 slow and 63/44/19 all. Remaining-Jest ownership
stays 68/107/399 with digest
`13a0869985874f31dd42581cf592dd264e0f226a2779262a7e023a9a9f57f305`.

Frozen install, workspace-edge validation, Payment build/runners, strict
tooling, the complete 463.3-second foundation, and all 13 independent
Cloudflare gates in 191.8 seconds pass. No source/config or timeout workaround
was added, and no hosted result is claimed.

## Next Command Slice

Start Turn 110 only: audit and add a separate Notification source-unit native
Vitest shadow while Jest remains authoritative. Keep Notification integration
Jest-only and fail-closed until its own migration turns; do not combine
dependencies, catalogs, persistence, workflow, CI, or publication work.

## Turn 110 Receipt

Notification source tests retain their exact Jest default and gain only an
opt-in native/no-bridge Vitest shadow. Five reports and all ten comparisons
preserve one file, one test, nine direct expectation sites, every full
name/status, and zero snapshots, with normalized digest
`a2a70662b003f4f7c15f70105721c4e39dc420f8cd9fd523112120a3e2e40f11`.

Direct Jest, direct Vitest, and authentic root-scoped Jest `/4` commands all
pass with the one file on shard 1 and empty shards 2, 3, and 4. All seven task
graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 37/18/19, 5/5/0, and
63/44/19, so the shadow has no graph or workflow owner. Notification's real
PGlite Jest integration passes two files/11 tests; Vitest integration remains
fail-closed before spawn.

Remaining-Jest ownership is byte-identical at 68/107/399 with digest
`13a0869985874f31dd42581cf592dd264e0f226a2779262a7e023a9a9f57f305`.
Frozen install, workspace-edge validation, Notification build/runners, strict
tooling, the complete 294.7-second foundation, and all 13 Cloudflare gates in
236.4 seconds pass. `test:workerd` reported its existing local D1 migration
cleanup timeout, then started Vite 8.2.0 in 15.1 seconds and passed; no timeout
or source workaround was added. No hosted result is claimed.

## Next Command Slice

Start Turn 111 only: promote Notification source tests to native Vitest, retain
the exact Jest command at `test:jest`, and remove `test:vitest`. Keep
Notification integration Jest-only and fail-closed until its separate
migration turns.

## Turn 111 Receipt

Notification source tests now default to native/no-bridge Vitest with the exact
Jest source command retained at `test:jest`; the temporary shadow key is
removed. Six reports and all 15 comparisons preserve one file, one test, nine
direct expectation sites, every full name/status, zero snapshots, and
normalized digest
`a2a70662b003f4f7c15f70105721c4e39dc420f8cd9fd523112120a3e2e40f11`.

Direct default Vitest, direct Jest rollback, and authentic root-scoped default
Vitest `/4` commands all pass with the one file on shard 1 and empty shards 2,
3, and 4. The seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0,
37/18/19, 5/5/0, and 63/44/19, moving Notification exactly once only in
applicable unit graphs. Notification's unchanged PGlite/Jest integration
passes two files/11 tests; Vitest remains fail-closed before spawn.

Remaining-Jest ownership stays 68 configs, 107 scripts, and 399 active API
files, with accepted digest
`0a81055c74fdd8dca9b8fd62da28fbb9a93b5bf1490dd5ae9d16d4b747b23fbe`.
Frozen install, workspace-edge validation, Notification build/runners, strict
tooling, the complete 261.1-second foundation, and all 13 Cloudflare gates in
234.7 seconds pass. `test:workerd` reported its existing local D1 migration
cleanup timeout, then started Vite 8.2.0 in 12.3 seconds and passed; no timeout
or source workaround was added. No hosted result is claimed.

## Next Command Slice

Start Turn 112 only: audit and add a separate Notification integration native
Vitest shadow while Jest remains authoritative. Freeze its two files, 11 tests,
assertions, Jest-only APIs, aliases, timeout ownership, backend behavior, and
sharding before editing. Do not combine default cut-over, workflow, dependency,
catalog, persistence, or publication changes.

## Turn 112 Receipt

Notification integration retains its exact Jest default and gains an opt-in
native/no-bridge Vitest shadow. The two 30-second source timeout calls move into
runner ownership; four spies now use imported `vi`, with a narrow Jest-only
resolver shim preserving default execution. Both source files contain zero
direct `jest.*`. The path-loaded provider fixture follows Auth/Analytics/File as
checked CommonJS JavaScript with an explicit `.js` runtime path because the
built Medusa loader cannot resolve the original TypeScript path under Vitest.

Six PostgreSQL/PGlite/Drizzle reports and all 15 pairwise comparisons preserve
two files, 11 tests, every full name/status, 32 direct expectation sites, zero
snapshots, and normalized digest
`5a1c4c7e9f47db69569e29c5153ea1996db1d51d5e4f9b5c2f487cd34fe0dd7c`.
Both PGlite selectors pass 11/11; Fulfillment is the next fail-closed Vitest
lane.

Jest `/3` is 7/4/0, while every native Vitest `/3` command rejects before import
because three shards exceed two files. All seven graphs remain 85/65/20, 1/1/0,
83/63/20, 2/2/0, 37/18/19, 5/5/0, and 63/44/19, so the shadow has no graph or
workflow owner.

Remaining-Jest ownership becomes 68/107/397 with digest
`8164c5c8793434d911cf781f65da8eaaa0ff5f1067d62de5286d1f8944f8cecc`.
Frozen install, workspace-edge validation, Notification build/runners, strict
tooling, the complete 244.4-second foundation, and all 13 Cloudflare gates in
140.4 seconds pass. `test:workerd` started Vite 8.2.0 in 13.1 seconds and
passed; no timeout or source workaround was added. No hosted result is claimed.

## Next Command Slice

Start Turn 113 only: promote Notification integration to native Vitest, retain
exact Jest rollback, exclude it from generic fast `/3`, and add a runner-neutral
unsharded PostgreSQL job with aggregate propagation. Do not change assertions,
persistence semantics, dependencies, catalogs, or publication metadata.

## Turn 113 Receipt

Notification integration now defaults to native/no-bridge Vitest, retains the
exact Jest rollback, and no longer has a temporary shadow key. Twelve reports
and all 66 PostgreSQL/PGlite/Drizzle comparisons preserve two files, 11 passed
tests, every full name/status, 32 direct expectation sites, zero snapshots, and
digest `5a1c4c7e9f47db69569e29c5153ea1996db1d51d5e4f9b5c2f487cd34fe0dd7c`.
Both post-cut-over PGlite selectors and the exact unsharded PostgreSQL workflow
command pass 11/11.

Notification leaves generic fast `/3` and gains one locally contract-tested,
runner-neutral unsharded PostgreSQL job with aggregate propagation. Unit graph
shapes remain 85/65/20, 1/1/0, 83/63/20, and 2/2/0; integration shapes become
36/17/19 fast and remain 5/5/0 slow and 63/44/19 all. Remaining-Jest ownership
stays 68/107/397 with digest
`a5da8fc9947387b33ac83adce97b0b66472be639caccbf26b81defa70ba48fdd`.

Frozen install, workspace-edge validation, Notification build/runners, strict
tooling, the complete 251.3-second foundation, and all 13 independent
Cloudflare gates in 100.2 seconds pass. `test:workerd` started Vite 8.2.0 in
13.5 seconds and passed. No source/config or timeout workaround was added, and
no hosted result is claimed.

## Next Command Slice

Start Turn 114 only: audit and add a separate Fulfillment source-unit native
Vitest shadow while Jest remains authoritative. Keep Fulfillment integration
Jest-only and fail-closed until its own migration turns; do not combine
dependencies, catalogs, persistence, workflow, CI, or publication work.

## Turn 114 Receipt

Fulfillment source tests retain their exact Jest default and gain only an
opt-in native/no-bridge Vitest shadow. Five reports and all ten comparisons
preserve two files, 23 tests, 33 direct expectation sites, every full
name/status, and zero snapshots, with normalized digest
`2942500312a6eb86a6174e41caf2e9c34f107f3a9aff56162696df14d62991b8`.

Direct Jest, direct Vitest, and authentic root-scoped Jest `/4` commands all
pass with 22 tests on shard 1, one test on shard 2, and empty shards 3 and 4.
All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 36/17/19,
5/5/0, and 63/44/19, so the shadow has no graph or workflow owner.
Fulfillment's real PGlite Jest integration passes seven files/75 tests; Vitest
integration remains fail-closed before spawn.

Remaining-Jest ownership is byte-identical at 68/107/397 with digest
`a5da8fc9947387b33ac83adce97b0b66472be639caccbf26b81defa70ba48fdd`.
Frozen install, workspace-edge validation, Fulfillment build/runners, strict
tooling, the complete 253.9-second foundation, and all 13 Cloudflare gates in
178.1 seconds pass. `test:workerd` started Vite 8.2.0 in 14.1 seconds and
passed; no timeout or source workaround was added. No hosted result is claimed.

## Next Command Slice

Start Turn 115 only: promote Fulfillment source tests to native Vitest, retain
the exact Jest command at `test:jest`, and remove `test:vitest`. Keep
Fulfillment integration Jest-only and fail-closed until its separate
migration turns.

## Turn 115 Receipt

Fulfillment source tests now default to native/no-bridge Vitest with the exact
Jest source command retained at `test:jest`; the temporary shadow key is
removed. Six reports and all 15 comparisons preserve two files, 23 tests, 33
direct expectation sites, every full name/status, zero snapshots, and
normalized digest
`2942500312a6eb86a6174e41caf2e9c34f107f3a9aff56162696df14d62991b8`.

Direct default Vitest, direct Jest rollback, and authentic root-scoped default
Vitest `/4` commands all pass with 22 tests on shard 1, one test on shard 2,
and empty shards 3 and 4. The seven task graphs remain 85/65/20, 1/1/0,
83/63/20, 2/2/0, 36/17/19, 5/5/0, and 63/44/19, moving Fulfillment exactly once
only in applicable unit graphs. Fulfillment's unchanged PGlite/Jest integration
passes seven files/75 tests; Vitest remains fail-closed before spawn.

Remaining-Jest ownership stays 68 configs, 107 scripts, and 397 active API
files, with accepted digest
`aa4ff263bd2bfeb7b236ffd955d60accf4b9df2f19965b3a91de3158fbdfe9be`.
Frozen install, workspace-edge validation, Fulfillment build/runners, strict
tooling, the complete 271.2-second foundation, and all 13 Cloudflare gates in
107.6 seconds pass. `test:workerd` started Vite 8.2.0 in 15.0 seconds and
passed; no timeout or source workaround was added. No hosted result is claimed.

## Next Command Slice

Start Turn 116 only: audit and add a separate Fulfillment integration native
Vitest shadow while Jest remains authoritative. Freeze its exact files, tests,
assertions, Jest-only APIs, aliases, timeout ownership, backend behavior, and
sharding before editing. Do not combine default cut-over, workflow, dependency,
catalog, persistence, or publication changes.

## Turn 116 Receipt

Fulfillment integration retains the exact Jest default and gains only an
opt-in native/no-bridge Vitest shadow. Six reports and all 15 comparisons
preserve seven files, 75 passed tests, every full name/status, 263 expect()
sites, zero snapshots, and digest
`94275a7ae05b2266121ff33b2587e3e4b5ae1db1f05805bc594c728b5921663d`.
Authentic Jest `/3` is 17/32/26. Both PGlite selectors pass 7/75. Promotion is
the next fail-closed Vitest lane.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 36/17/19,
5/5/0, and 63/44/19, so the shadow has no graph or workflow owner.
Remaining-Jest ownership is 68 configs, 107 scripts, and 390 active API files
with digest
`218465edf4a10674b69f76e98a088ad655f81c3b415fe6a9c3026afe23f8c340`.

Frozen install, workspace-edge validation, Fulfillment build/runners, strict
tooling, the complete 276.0-second foundation, and all 13 Cloudflare gates in
194.7 seconds pass. `test:workerd` started Vite 8.2.0 in 17.1 seconds and
passed; no timeout or source workaround was added. No hosted result is claimed.

## Next Command Slice

Start Turn 117 only: promote the proven Fulfillment integration shadow to
`test:integration`, retain the exact Jest command at `test:integration:jest`,
and remove `test:integration:vitest`. Do not combine Promotion, workflow,
dependency, catalog, or publication work.

## Turn 117 Receipt

Fulfillment integration now defaults to native/no-bridge Vitest with the exact
Jest command retained at `test:integration:jest`; the temporary shadow key is
removed. Twelve reports and all 66 comparisons preserve seven files, 75 passed
tests, every full name/status, 263 expect() sites, zero snapshots, and
digest `94275a7ae05b2266121ff33b2587e3e4b5ae1db1f05805bc594c728b5921663d`.
Default Vitest `/3` is 53/11/11; exact Jest rollback `/3` remains 17/32/26.
Both post-cut-over PGlite selectors pass 7/75. Promotion remains fail-closed.

Seven files shard under `/3`, so Fulfillment stays in generic fast integration
with no dedicated workflow job. Graph shapes remain 85/65/20, 1/1/0, 83/63/20,
2/2/0, 36/17/19, 5/5/0, and 63/44/19. Remaining-Jest ownership stays 68/107/390
with digest
`6d6f67dd4cdfae93513fd685a6a76a84af90dc0ef42c84db9d6ff61faf394efc`.

Frozen install, workspace-edge validation, Fulfillment build/runners, strict
tooling, the complete 260.3-second foundation, and all 13 Cloudflare gates in
179.3 seconds pass. `test:workerd` started Vite 8.2.0 in 13.3 seconds and
passed; no timeout or source workaround was added. No hosted result is claimed.

## Next Command Slice

Start Turn 118 only: audit and add a separate Promotion source-unit native
Vitest shadow while Jest remains authoritative. Keep Promotion integration
Jest-only and fail-closed until its own migration turns.

## Turn 118 Receipt

Promotion source tests retain the exact Jest default and gain only an opt-in
native/no-bridge Vitest shadow. Five reports and all 10 comparisons preserve
one file, one passed test, every full name/status, 5 expect() sites, zero
snapshots, and digest
`4c9ba44eacff934d2fa46947f9c9ababb43f6499f6c494c2195ce95765969a10`.
Direct Jest, direct Vitest, and authentic root-scoped Jest `/4` are 1/0/0/0.
Direct Vitest `/4` via `exec` matches that split. Promotion integration remains
Jest-only; PGlite Jest passes 6/178 and Vitest selection stays fail-closed.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 36/17/19,
5/5/0, and 63/44/19, so the shadow has no graph or workflow owner.
Remaining-Jest ownership stays 68/107/390 with digest
`6d6f67dd4cdfae93513fd685a6a76a84af90dc0ef42c84db9d6ff61faf394efc`.

Frozen install, workspace-edge validation, Promotion build/runners, strict
tooling, the complete 260.4-second foundation, and all 13 Cloudflare gates in
128.2 seconds pass. `test:workerd` started Vite 8.2.0 in 13.0 seconds and
passed; no timeout or source workaround was added. No hosted result is claimed.

## Next Command Slice

Start Turn 119 only: promote the proven Promotion source shadow to `test`,
retain the exact Jest source command at `test:jest`, and remove the temporary
`test:vitest` key. Keep Promotion integration Jest-only and fail-closed.

## Turn 119 Receipt

Promotion source tests now default to native/no-bridge Vitest with the exact
Jest command retained at `test:jest`; the temporary shadow key is removed.
Six reports and all 15 comparisons preserve one file, one passed test, every
full name/status, 5 expect() sites, zero snapshots, and digest
`4c9ba44eacff934d2fa46947f9c9ababb43f6499f6c494c2195ce95765969a10`.
Default Vitest `/4` and exact Jest rollback `/4` are both 1/0/0/0. Promotion
integration remains Jest-only; PGlite Jest passes 6/178 and Vitest selection
stays fail-closed.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 36/17/19,
5/5/0, and 63/44/19. Remaining-Jest ownership stays 68/107/390 with digest
`e27c8d21896cb74195597ddbf0b3b1e2fb6f7a34ee73e743d3f0e32bf65fae98`.

Frozen install, workspace-edge validation, Promotion build/runners, strict
tooling, the complete 263.6-second foundation, and all 13 Cloudflare gates in
125.1 seconds pass. `test:workerd` started Vite 8.2.0 in 12.9 seconds and
passed; no timeout or source workaround was added. No hosted result is claimed.

## Next Command Slice

Start Turn 120 only: audit and add a separate Promotion integration native
Vitest shadow while Jest remains authoritative. Freeze its exact files, tests,
assertions, Jest-only APIs, aliases, timeout ownership, backend behavior, and
sharding before editing. Do not combine default cut-over, workflow, dependency,
catalog, persistence, or publication changes.

## Turn 120 Receipt

Promotion integration retains the exact Jest default and gains only an opt-in
native/no-bridge Vitest shadow. Six reports and all 15 comparisons preserve
six files, 178 passed tests, every full name/status, 239 expect() sites, zero
snapshots, and digest
`5ded7a0f633a9dd46a06f14c7296ed992a430380d713316c4b1c6f2e9e33ce2f`.
Authentic Jest `/3` is 10/61/107. Direct Vitest `/3` is 74/15/89. Both PGlite
selectors pass 6/178. Product is the next fail-closed Vitest lane.

Six files shard under `/3`, so Promotion stays in generic fast integration
with no dedicated workflow job. Graph shapes remain 85/65/20, 1/1/0, 83/63/20,
2/2/0, 36/17/19, 5/5/0, and 63/44/19. Remaining-Jest ownership is 68/107/385
with digest
`296f9841a6037845b7b25cfab5160ce3af35541616151de7423d0ea4ea7be22f`.

Frozen install, workspace-edge validation, Promotion build/runners, strict
tooling, the complete 274.2-second foundation, and all 13 Cloudflare gates in
193.8 seconds pass. `test:workerd` started Vite 8.2.0 in 14.6 seconds and
passed; no timeout or source workaround was added. No hosted result is claimed.

## Next Command Slice

Start Turn 121 only: promote the proven Promotion integration shadow to
`test:integration`, retain the exact Jest command at `test:integration:jest`,
and remove `test:integration:vitest`. Do not combine Product, workflow,
dependency, catalog, or publication work.

## Turn 121 Receipt

Promotion integration now defaults to native/no-bridge Vitest with the exact
Jest command retained at `test:integration:jest`; the temporary shadow key is
removed. Twelve reports and all 66 comparisons preserve six files, 178 passed
tests, every full name/status, 239 expect() sites, zero snapshots, and
digest `5ded7a0f633a9dd46a06f14c7296ed992a430380d713316c4b1c6f2e9e33ce2f`.
Default Vitest `/3` is 74/15/89; exact Jest rollback `/3` remains 10/61/107.
Both post-cut-over PGlite selectors pass 6/178. Product remains fail-closed.

Six files shard under `/3`, so Promotion stays in generic fast integration
with no dedicated workflow job. Graph shapes remain 85/65/20, 1/1/0, 83/63/20,
2/2/0, 36/17/19, 5/5/0, and 63/44/19. Remaining-Jest ownership stays 68/107/385
with digest
`107e8331facafbc61ddcc7220fac6b31f8000c8b6cefeee10d50b1d0c68b8b34`.

Frozen install, workspace-edge validation, Promotion build/runners, strict
tooling, the complete 262.7-second foundation, and all 13 Cloudflare gates in
135.1 seconds pass. `test:workerd` started Vite 8.2.0 in 14.4 seconds and
passed; no timeout or source workaround was added. No hosted result is claimed.

## Next Command Slice

Start Turn 122 only: audit and add a separate Product source-unit native
Vitest shadow while Jest remains authoritative. Keep Product integration
Jest-only and fail-closed until its own migration turns.

## Turn 122 Receipt

Product source tests retain the exact Jest default and gain only an opt-in
native/no-bridge Vitest shadow. Five reports and all 10 comparisons preserve
two files, four passed tests, every full name/status, 23 expect() sites, zero
snapshots, and digest
`5405f6cc036555864b376b686a66e2367641eb780a086caeae6558691e241866`.
Direct Jest and direct Vitest both pass 2/4. Direct Jest `/4` is 1/3/0/0;
direct Vitest `/4` is 3/1/0/0. Both cover all four tests once with
`--passWithNoTests`. Product integration remains Jest-only; PGlite Jest
passes 10 files with 205 passed and 1 skipped, and Vitest selection stays
fail-closed.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 36/17/19,
5/5/0, and 63/44/19, so the shadow has no graph or workflow owner.
Remaining-Jest ownership stays 68/107/385 with digest
`107e8331facafbc61ddcc7220fac6b31f8000c8b6cefeee10d50b1d0c68b8b34`.

Frozen install, workspace-edge validation, Product build/runners, strict
tooling, the complete 262.3-second foundation, and all 13 Cloudflare gates in
94.8 seconds pass. `test:workerd` started Vite 8.2.0 in 12.1 seconds and
passed; no timeout or source workaround was added. No hosted result is claimed.

## Next Command Slice

Start Turn 123 only: promote the proven Product source shadow to `test`,
retain the exact Jest source command at `test:jest`, and remove the temporary
`test:vitest` key. Keep Product integration Jest-only and fail-closed.

## Turn 123 Receipt

Product source tests now default to native/no-bridge Vitest with the exact
Jest command retained at `test:jest`; the temporary shadow key is removed.
Six reports and all 15 comparisons preserve two files, four passed tests,
every full name/status, 23 expect() sites, zero snapshots, and digest
`5405f6cc036555864b376b686a66e2367641eb780a086caeae6558691e241866`.
Default Vitest `/4` is 3/1/0/0; exact Jest rollback `/4` is 1/3/0/0. Product
integration remains Jest-only; PGlite Vitest selection stays fail-closed.

All seven task graphs remain 85/65/20, 1/1/0, 83/63/20, 2/2/0, 36/17/19,
5/5/0, and 63/44/19. Remaining-Jest ownership stays 68/107/385 with digest
`7240bf3c54c1784faec7f89567b14142fd792155d40ff6bb8eb71a660dc4b4ea`.

Frozen install, workspace-edge validation, Product build/runners, strict
tooling, the complete 262.0-second foundation, and all 13 Cloudflare gates in
94.0 seconds pass. `test:workerd` started Vite 8.2.0 in 12.2 seconds and
passed; no timeout or source workaround was added. No hosted result is claimed.

## Next Command Slice

Start Turn 124 only: audit and add a separate Product integration native
Vitest shadow while Jest remains authoritative. Freeze its exact files, tests,
assertions, Jest-only APIs, aliases, timeout ownership, backend behavior, and
sharding before editing. Do not combine default cut-over, workflow, dependency,
catalog, persistence, or publication changes.

The Product integration Jest freeze is unblocked: isolated PostgreSQL 18,
PGlite, and Drizzle/SQLite each pass 10 files / 205 passed / 1 skipped
(`it.skip("test update performance")`). Do not skip to Pricing.

## Turn 124 Receipt

Product integration keeps the exact Jest default plus an explicit
`--testTimeout=300000` flag and gains the opt-in
`test:integration:vitest` shadow backed by a native/no-bridge config owning
the same 300_000 ms test/hook timeout, serial execution, all ten exact
integration files, five aliases, and `legacyJestBridge: false`. The ten
integration sources drop every direct `jest.*` usage in favor of `vi` from
`vitest`; the package-local `vitest-jest-shim` fixture, mapped by the package
Jest config alone, keeps the Jest rollback on byte-identical sources with no
global bridge.

The shadow matches Jest at 10 files / 205 passed / 1 skipped on all three
persistence backends: an isolated PostgreSQL 18 cluster (trust auth,
127.0.0.1:55599, stopped and port confirmed closed) in 267.91s, PGlite through
`pnpm test:integration:pglite --runner=vitest --only=product` in 153.45s with
the Jest lane matching at 62.86s, and Drizzle/SQLite via
`MEDUSA_MODULE_TEST_PERSISTENCE=drizzle` in 40.34s.

Strict runner-tooling typecheck, the ten-contract tooling suite, Jest/Vitest
foundation parity, and the integration-foundation gate pass; fail-closed
unsupported Vitest selection moves from product to pricing. Remaining-Jest
ownership is exact at 68 configs / 107 scripts / 375 active API files with
digest `d4c0ede7ceaffeb72256c807ef190d1db24938392380d129623b10ee76d30623`.

Frozen offline install, CI sharding distribution, Cloudflare gates, and
workerd execution were not rerun in this slice and remain cut-over-turn
requirements. The package scripts depend on orchestrator-injected database
configuration; the PGlite orchestrator remains the supported entrypoint. No
hosted result is claimed.

## Next Command Slice

Start Turn 125 only: prove the remaining shadow gates (frozen install,
Cloudflare gates, sharding) and then promote only this proven Product
integration shadow to `test:integration`, retain the exact Jest command at
`test:integration:jest`, and remove `test:integration:vitest`. Do not combine
Pricing, workflow, dependency, catalog, persistence, or publication changes.
Do not skip to Pricing.

## Turn 125 Receipt

Product integration defaults to native/no-bridge Vitest; the byte-identical
Jest command is retained at `test:integration:jest` and the temporary shadow
key is removed. Both PGlite orchestrator selectors pass ten files /
205 passed / 1 skipped (Vitest 59.53s, Jest rollback 58.22s). Authentic
Vitest `/3` shards with `--maxWorkers=2` under the orchestrator environment
cover every test exactly once: 4/3/3 files and 75/(68+1 skipped)/62 tests.
All ten files distribute under `/3`, so Product stays in generic fast
integration with no dedicated workflow job.

Frozen offline install across all 86 workspaces passes, and the complete
Cloudflare Vite/import/D1/workerd gate set passes in one uninterrupted
94-second run (build, typecheck, worker spec, portable/runtime-source/
real-module import guards, HTTP proof manifest, both D1 checks, Currency
workerd, Currency/Cart/Index DO SQLite proofs, Cart DO proof). The complete
foundation passes; remaining-Jest ownership moves exactly the product command
key from `test:integration` to `test:integration:jest` plus the orchestrator
digest, staying at 68 configs / 107 scripts / 375 active API files with
digest `f7be351c8de7e2d5241dff938807ed9738a8bfdd10ba9bc739c973255b34371e`.

PostgreSQL and Drizzle behavior is carried by the byte-identical Turn 124
shadow reports; no backend-specific source changed between shadow and
default. No hosted GitHub Actions result is claimed.

## Turn 126 Receipt

Pricing integration keeps the exact Jest default plus an explicit
`--testTimeout=30000` flag and gains the opt-in `test:integration:vitest`
shadow backed by a native/no-bridge config owning the same 30_000 ms test/hook
timeout, serial execution, all six exact integration files, five aliases, and
`legacyJestBridge: false`. The six integration sources drop every direct
`jest.*` usage in favor of `vi` from `vitest`; the package-local
`vitest-jest-shim` fixture, mapped by the package Jest config alone, keeps the
Jest rollback on byte-identical sources with no global bridge.

The shadow matches Jest at 6 files / 126 passed on all three persistence
backends: an isolated PostgreSQL 18 cluster (trust auth, 127.0.0.1:55601,
stopped and port confirmed closed) in 63.67s, PGlite through
`pnpm test:integration:pglite --runner=vitest --only=pricing` in 28.82s with
the Jest lane matching at 27.89s, and Drizzle/SQLite via
`MEDUSA_MODULE_TEST_PERSISTENCE=drizzle` in 17.45s.

Strict runner-tooling typecheck, the ten-contract tooling suite, Jest/Vitest
foundation parity, and the integration-foundation gate pass; fail-closed
unsupported Vitest selection moves from pricing to cart. Remaining-Jest
ownership is exact at 68 configs / 107 scripts / 369 active API files with
digest `1bc4aa126bf6482f746756a1cf3f79fa88687c4d68f331347b81b9cc9430065b`.

Frozen offline install, CI sharding distribution, Cloudflare gates, and
workerd execution were not rerun in this slice and remain cut-over-turn
requirements. The Pricing unit lane remains Jest-owned. No hosted result is
claimed.

## Turn 127 Receipt

Pricing integration defaults to native/no-bridge Vitest; the byte-identical
Jest command is retained at `test:integration:jest` and the temporary shadow
key is removed. Both PGlite orchestrator selectors pass six files / 126 passed
tests (Vitest default 35.34s). Authentic Vitest `/3` shards with
`--maxWorkers=2` under the orchestrator environment cover every test exactly
once: 2/2/2 files and 29/27/70 tests. All six files distribute evenly under
`/3`, so Pricing stays in generic fast integration with no dedicated workflow
job.

Frozen offline install across all 86 workspaces passes, and the complete
Cloudflare Vite/import/D1/workerd gate set passes in one uninterrupted
225-second run (build, typecheck, worker spec, portable/runtime-source/
real-module import guards, HTTP proof manifest, both D1 checks, Currency
workerd, Currency/Cart/Index DO SQLite proofs, Cart DO proof). The complete
foundation passes; remaining-Jest ownership moves exactly the pricing command
key from `test:integration` to `test:integration:jest` plus the orchestrator
digest, staying at 68 configs / 107 scripts / 369 active API files with
digest `aa2bc5060641031ec27c4e42c4964dcc1cee42fdc729665d5c6d24fa8cc73e15`.

PostgreSQL and Drizzle behavior is carried by the byte-identical Turn 126
shadow reports; no backend-specific source changed between shadow and
default. The Pricing unit lane remains Jest-owned. No hosted GitHub Actions
result is claimed.

## Turn 128 Receipt

Cart integration keeps the exact Jest default plus an explicit
`--testTimeout=50000` flag and gains the opt-in `test:integration:vitest`
shadow backed by a native/no-bridge config owning the same 50_000 ms test/hook
timeout, serial execution, the one exact integration file, four aliases, and
`legacyJestBridge: false`. The integration source drops its only direct
`jest.*` usage and needs no `vi` shim because the suite uses no spy or mock
APIs; the package Jest config stays byte-identical.

The shadow matches Jest at 1 file / 63 passed on all three persistence
backends: an isolated PostgreSQL 18 cluster (trust auth, 127.0.0.1:55602,
stopped and port confirmed closed) in 23.49s, PGlite through
`pnpm test:integration:pglite --runner=vitest --only=cart` with the Jest lane
matching, and Drizzle/SQLite via `MEDUSA_MODULE_TEST_PERSISTENCE=drizzle` in
4.49s.

Strict runner-tooling typecheck, the ten-contract tooling suite, Jest/Vitest
foundation parity, and the integration-foundation gate pass; fail-closed
unsupported Vitest selection moves from cart to order. Remaining-Jest
ownership is exact at 68 configs / 107 scripts / 368 active API files with
digest `dde6f334244fd62f588262be8cdf857c321b1fab55771fc73c8c215476505863`.

Frozen offline install, CI sharding distribution, Cloudflare gates, and
workerd execution were not rerun in this slice and remain cut-over-turn
requirements. Order integration remains the last Jest-owned module integration
lane. No hosted result is claimed.

## Turn 129 Receipt

Cart integration defaults to native/no-bridge Vitest; the byte-identical
Jest command is retained at `test:integration:jest` and the temporary shadow
key is removed. Both PGlite orchestrator selectors pass one file / 63 passed
tests. Authentic Vitest `/3` sharding fails closed for the one-file lane
("shard must be smaller than count of test files"), matching Currency
precedent; Cart stays outside the generic fast integration filter as before
with no workflow or CI change and `jobs["cart-integration"]` undefined.

Frozen offline install across all 86 workspaces passes, and the complete
Cloudflare Vite/import/D1/workerd gate set passes in one uninterrupted
137-second run (build, typecheck, worker spec, portable/runtime-source/
real-module import guards, HTTP proof manifest, both D1 checks, Currency
workerd, Currency/Cart/Index DO SQLite proofs, Cart DO proof). The complete
foundation passes; remaining-Jest ownership moves exactly the cart command
key from `test:integration` to `test:integration:jest` plus the orchestrator
digest, staying at 68 configs / 107 scripts / 368 active API files with
digest `5469e8948fe323a2d25864874be35c9922e9a0b8891ffb3a977e7a242f554f68`.

PostgreSQL and Drizzle behavior is carried by the byte-identical Turn 128
shadow reports; no backend-specific source changed between shadow and
default. Order integration remains the last Jest-owned module integration
lane. No hosted GitHub Actions result is claimed.

## Turn 130 Receipt

Order integration keeps the exact Jest default plus an explicit
`--testTimeout=1000000` flag and gains the opt-in `test:integration:vitest`
shadow backed by a native/no-bridge config owning the same 1_000_000 ms
test/hook timeout, serial execution, all nine exact integration files, five
aliases, and `legacyJestBridge: false`. The nine integration sources drop
every direct `jest.*` usage and need no `vi` shim; the package Jest config
stays byte-identical. With Order supported, every module lane lists under
Vitest selection and the integration-foundation verifier's fail-closed
assertions become positive.

Runner parity is exact on every backend: PGlite and Drizzle/SQLite pass
9 files / 77 tests for both runners (Drizzle 31.08s); isolated PostgreSQL 18
on 127.0.0.1:55603 fails identically at 74 passed / 3 failed for both runners.
The three failures are a pre-existing MikroORM-PostgreSQL behavior gap — claim
and exchange flows report "OrderShippingMethod ... was not found" after
creation, and the return flow observes one extra joined row — while the
fork's PGlite and Drizzle adapters pass all 77. The cluster was stopped with
port confirmed closed.

Strict runner-tooling typecheck, the ten-contract tooling suite, Jest/Vitest
foundation parity, and the integration-foundation gate pass. Remaining-Jest
ownership is exact at 68 configs / 107 scripts / 360 active API files with
digest `193bd34cd2c203b39ad2230dab44ae4e34533d729ca9b207fec01581f76ef303`.

Blocker recorded: fixing the three Order MikroORM-PostgreSQL behaviors is its
own slice and a hard prerequisite before the Order shadow promotion. Frozen
offline install, CI sharding distribution, Cloudflare gates, and workerd
execution were not rerun in this slice. No hosted result is claimed.

## Next Command Slice

Start the next slice only: diagnose and fix the three Order
MikroORM/PostgreSQL failures so both runners pass 9 files / 77 tests there
with unchanged assertions as the specification. Do not combine cut-over,
workflow, dependency, catalog, persistence-semantics, or publication changes
beyond that fix.

## Fix Slice One Receipt (Order PostgreSQL)

`createOrderShippingMethodsBulk_` now creates the shipping method and the
versioned join row as two explicit queued creates; the nested new method was
never scheduled on the entity manager (verified: UoW queue contained only the
parent classes), so auto-flush skipped it and same-transaction reads returned
not-found. After the fix both runners fail identically at 74/77 on isolated
PostgreSQL 18 (claim/exchange progress past creation into assertion blocks);
PGlite and Drizzle/SQLite remain 77/77 for both runners.

Diagnosed this slice with empirical evidence:

- `order_claim.return_id` updates through the internal service do not persist
  (a direct public `updateOrderClaims` call does not stick either), so claim
  responses hydrate `return` as null; the Return row itself persists with the
  correct `claim_id`;
- the claim/return FKs are circular and only upstream's deferred commit-time
  flush ordered their inserts — creating the return first fails entirely
  under eager flushing;
- a global `flushMode: "always"` connection setting was tested and reverted:
  inserts became eager but none of the three failures changed;
- raw `order.items` hydration is correct; the crossing appears in the
  serialized claim/exchange response wiring inherited from the Cloudflare
  static-runtime port's plain-object action entities.

The complete foundation passes; remaining-Jest ownership is unchanged at 68
configs / 107 scripts / 360 active API files with digest
`193bd34cd2c203b39ad2230dab44ae4e34533d729ca9b207fec01581f76ef303`.

## Next Command Slice

Start fix slice two only: make the claim/exchange/return flows persist their
circular foreign keys deterministically on PostgreSQL/MikroORM (single
repository call whose flush orders the inserts, or managed-entity creation
for these actions) and drive both runners to 9 files / 77 passed there. The
Order shadow promotion follows only after that.
