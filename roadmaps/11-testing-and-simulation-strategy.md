# Testing and Simulation Strategy

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
