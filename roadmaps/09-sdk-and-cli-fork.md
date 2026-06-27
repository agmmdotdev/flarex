# SDK And CLI Fork

## Package Bin Command Surface

Previous completed checkpoint: `33b4f8f` Export CLI runner from flarex-dev
root.

What changed:

- Added a `flarex-dev` package `bin` entry pointing at
  `./bin/flarex-dev.mjs`.
- Added a thin Node launcher that boots the existing TypeScript CLI entrypoint
  through the package-owned `tsx` loader.
- Included the bin launcher in `flarex-dev` typechecking with JS checking
  enabled, so the public command surface is covered by the package type gate.
- Moved `tsx` into `flarex-dev` runtime dependencies because the source-mode
  launcher needs it when the package command is invoked.
- Updated the package `cli` script to invoke the same bin file instead of a
  separate `tsx src/bin.ts` path.

Why it changed:

The previous checkpoint exported the reusable CLI runner, but examples and
automation still lacked a stable package command. Convex exposes its CLI
through package `bin` entries, and Flarex should expose the same shape while
the command implementation remains centralized in `runFlarexDevCli(...)`.

Convex references inspected:

- `npm-packages/convex/package.json`
  - exposes `convex` and `convex-bundled` through package `bin` entries.
- `npm-packages/convex/src/cli/index.ts`
  - keeps a thin process bootstrap around the actual command program.

Flarex differences:

- Convex publishes a built CLI artifact. Flarex still runs TypeScript source in
  this workspace, so the bin launcher resolves `tsx` and then invokes
  `src/bin.ts`.
- The launcher is intentionally small and does not duplicate CLI parsing,
  deploy behavior, or output formatting.

Known limitations:

- This is still a source-mode development command, not a bundled production CLI
  artifact.
- A future packaging step should replace the `tsx` launcher with a built JS
  command before publishing.

Verification:

```sh
node packages/flarex-dev/bin/flarex-dev.mjs help
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/index.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Root Package Exports CLI Runner

Previous completed checkpoint: `d35c94d` Add deploy JSON output.

What changed:

- The root `flarex-dev` package entrypoint now re-exports
  `runFlarexDevCli(...)`.
- The root entrypoint also re-exports `FlarexDevCliOptions` beside the deploy
  JSON output types, so automation and tests can import the full CLI contract
  from one package surface.

Why it changed:

The previous checkpoint added deploy JSON output as an automation contract, but
the reusable runner was still only available from the `flarex-dev/cli` subpath.
Convex keeps package-level exports explicit, and Flarex should make stable
developer-facing automation types reachable from the root development package
entrypoint.

Convex references inspected:

- `npm-packages/convex/package.json`
  - exposes explicit package root and subpath exports.
- `npm-packages/convex/src/cli/lib/command.ts`
  - command output modes are treated as command-level public behavior.

Flarex differences:

- Convex's published CLI is a built package command surface. Flarex still uses
  TS-source package exports in this workspace, so this checkpoint only aligns
  the source-level package entrypoint.

Known limitations:

- There is still no stable published `flarex-dev` binary entry in
  `package.json`.
- The root export does not make deploy JSON available for dev server logs or
  non-deploy commands.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/index.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Deploy Command JSON Output

Previous completed checkpoint: `21b5e38` Add finish rejection remediation
hints.

What changed:

- Added deploy-only `--json` output to `flarex-dev deploy`.
- Successful deploys now write a structured `{ command, result, started,
  finished }` JSON object to stdout.
- Failed deploy finish rejections now write a structured JSON error object to
  stdout with the rejected finish code, remediation hint, rejected push, backend
  error, and diagnostics.
- Non-finish failures in JSON mode still produce a structured generic CLI error
  object instead of plain stderr text.
- Deploy JSON push fields use a compact DTO: `pushId`, `state`, optional
  `error`, and optional diagnostics. Backend analysis/codegen metadata is not
  leaked into command output.

Why it changed:

The previous checkpoint made finish rejection codes and remediation visible in
plain text, but automation still had to scrape stderr. Convex parses finish
responses into structured deploy data before CLI reporting, and Flarex should
provide a narrow structured command surface for the activation boundary.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/deploy2.ts`
  - parses finish-push responses before reporting deploy completion/failure.
- `npm-packages/convex/src/cli/lib/deployApi/finishPush.ts`
  - defines the structured finish-push response contract.
- `npm-packages/convex/src/cli/lib/command.ts`
  - shows explicit output-mode flags for commands that need machine-readable
    output.

Flarex differences:

- Convex deploy does not currently expose a direct deploy `--json` flag in the
  checked source. Flarex adds one because it does not yet have Convex's richer
  command context/error system and needs a stable automation boundary.
- The JSON mode is deploy-only for now; codegen and dry-run keep their existing
  text output.

Known limitations:

- The JSON shape is still compact and Flarex-specific. It does not include
  Convex-style deploy diffs, component diffs, or hosted project metadata.
- JSON mode is only implemented for CLI deploy output, not dev server logs.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts test/generate.test.ts --testTimeout=60000 --hookTimeout=60000
```

## Codegen CLI Can Use HTTP Backend Analyzer

Previous completed checkpoint: `5aff422` Add HTTP backend source analyzer.

What changed:

- Added `flarex-dev codegen --analyzer-url <url> --deployment-id <id>` so
  final codegen and dry-run codegen can use `HttpBackendSourceAnalyzer`.
- Added repeatable `--analyzer-header name=value` for the temporary hosted
  analyzer auth/header lane.
- CLI dependency typing now passes `FlarexCodegenOptions`, matching the real
  generator boundary that already accepts `sourceAnalyzer`.
- Generated-output typecheck options are built from the plain codegen paths
  only; `sourceAnalyzer` is not leaked into the typecheck boundary.
- CLI coverage proves both normal codegen and dry-run receive a working HTTP
  analyzer by calling `sourceAnalyzer.analyze(...)` through a stubbed fetch.
- CLI coverage proves generated-output typecheck does not receive runtime-only
  analyzer options when `--typecheck` and analyzer flags are used together.
- CLI coverage rejects incomplete analyzer options and malformed analyzer
  headers before codegen starts.

Why it changed:

The previous checkpoint added the HTTP analyzer adapter but left it unreachable
from the user-facing codegen command. Convex codegen can target a selected
deployment and consumes backend-produced analysis. This checkpoint gives Flarex
the equivalent development seam while the hosted push/deployment selection
flow is still being built.

Convex references inspected:

- `npm-packages/convex/src/cli/codegen.ts`
  - `codegen` accepts hidden deployment URL/admin-key options and routes
    through deployment selection before running codegen.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final generated output is written after backend/deployment analysis.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - backend push response is the analysis response boundary.

Flarex differences:

- Flarex exposes explicit analyzer flags for now instead of Convex's
  deployment selection and admin-key flow.
- `--analyzer-header` is a temporary generic header hook. The platform API key,
  project selection, and hosted auth convention remain future work.
- The command still defaults to local backend-style analysis when analyzer
  flags are absent.

Known limitations:

- No config-file or environment-variable discovery exists for analyzer URL,
  deployment ID, or auth headers.
- The hosted Dynamic Worker analyzer service is still future work; these flags
  only connect codegen to an HTTP analyzer once one is available.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
```

## HTTP Backend Source Analyzer

Previous completed checkpoint: `2560e38` Route codegen through backend analysis seam.

What changed:

- Added `HttpBackendSourceAnalyzer` to `flarex-dev`.
- The adapter posts `{ deploymentId, sourcePackage }` to an analyzer URL and
  consumes `codegenAnalysis` plus diagnostics from the response.
- The adapter validates the returned codegen analysis shape before returning it
  to final codegen.
- Malformed nested validator JSON is treated as an invalid analyzer response
  and still preserves backend diagnostics.
- Non-null legacy `route` metadata is rejected at the HTTP boundary because the
  current codegen analysis contract preserves `partition` metadata, not route
  policy metadata.
- `DeploymentCodegenFunction` no longer advertises `route` as accepted wire
  metadata, so the backend response type and HTTP parser agree.
- Exported `HttpBackendSourceAnalyzer` and its options from the package root so
  future CLI codegen can opt into a remote backend analyzer without changing
  `generateFlarex(...)` or `dryRunFlarexCodegen(...)`.
- `createLocalAnalyzerService(...)` now returns `codegenAnalysis` alongside the
  flattened backend deployment analysis.

Why it changed:

The previous checkpoint made codegen depend on a `BackendSourceAnalyzer` seam.
This checkpoint adds the first non-local implementation of that seam, moving
Flarex toward Convex's model where codegen consumes backend-produced analysis.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/components.ts`
  - source-package push calls the backend and receives analyzed metadata.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - `StartPushResponse` is the backend response boundary for analysis.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final codegen is downstream of backend analysis.

Flarex differences:

- The adapter targets the Flarex analyzer endpoint directly instead of the full
  hosted push lifecycle.
- The response requires `codegenAnalysis` to avoid lossy reconstruction from
  flattened backend function metadata.
- Analyzer diagnostics are normalized through the shared last-100 diagnostics
  helper used by local execution artifact analysis.
- Local analyzer service responses are typed against
  `AnalyzeSourcePackageResponse` and convert local SDK validator JSON into the
  backend-safe validator JSON contract.
- Invalid analyzer response messages include the failing `codegenAnalysis`
  path instead of collapsing all parse failures into a missing-analysis error.
- CLI flags for selecting a remote analyzer are not wired yet.

Known limitations:

- No authentication convention is standardized yet; the adapter accepts headers
  but the final platform token/API-key flow is still future work.
- The hosted analyzer service itself is not implemented in this slice.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-backend typecheck
git diff --check
```

## Codegen Backend Analysis Seam

Previous completed checkpoint: `5bdc5d9` Add codegen dry-run.

What changed:

- Added `analyzeFlarexSourcePackage(...)` as the shared codegen analysis seam.
- `generateFlarex(...)` and `dryRunFlarexCodegen(...)` now consume
  `BackendSourceAnalyzer` through `FlarexCodegenOptions`.
- The default analyzer is `LocalExecutionArtifactBackendAnalyzer`, so local
  codegen uses the same backend-style source-package analysis boundary and
  nondeterminism guard as local backend push.
- Added tests proving normal final codegen and dry-run codegen use injected
  backend source analysis instead of reading analysis directly from the
  execution artifact adapter.

Why it changed:

Convex final codegen is driven by backend analysis from the push/start flow.
Flarex CLI codegen still runs locally, but this checkpoint removes the direct
artifact-analysis dependency from generator orchestration and replaces it with
a backend source analyzer seam. Hosted codegen can later supply a remote
analyzer without changing generated-file planning.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/components.ts`
  - builds the source-package request and calls `startPush(...)`.
- `npm-packages/convex/src/cli/lib/deployApi/startPush.ts`
  - defines the request/response boundary for backend push analysis.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final component codegen consumes `StartPushResponse` analysis rather than
    independently re-analyzing local files.

Flarex differences:

- The default analyzer remains local and Miniflare-backed; it is backend-shaped
  but not hosted.
- `FlarexCodegenOptions.sourceAnalyzer` is a tooling seam, not a developer app
  API.
- Dry-run still uses a temporary app directory before analysis to avoid
  mutating the real generated directory.

Known limitations:

- CLI codegen does not yet call a hosted Flarex backend for authoritative
  analysis.
- Backend source analysis still returns the codegen `DeploymentAnalysis` shape;
  long term, hosted push should persist backend deployment metadata and return
  codegen-safe analysis from that authoritative state.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "injected backend source analysis" --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example generate
git diff --check
```

## Codegen Dry-Run Command

Previous completed checkpoint: `b40fb92` Preserve generated extension entries.

What changed:

- Added `dryRunFlarexCodegen(...)` to compute final generated writes and stale
  deletions without mutating the real project.
- Added `generatedFileWrites(...)` so dry-run reports only generated files whose
  current on-disk contents are missing or different.
- Added `flarex-dev codegen --dry-run`, which prints Convex-style
  `Command would write file: ...` and `Command would delete ...` lines.
- Dry-run skips normal final codegen writes, stale deletion, and generated
  output typecheck.
- The dry-run temp app input copies the real Flarex app when it exists and
  creates an empty temp app directory when it does not, preserving normal
  initial-codegen compatibility for fresh projects.

Why it changed:

Convex exposes `codegen --dry-run` for checking generated output without
writing it. Flarex now has the same command-level shape, using the previously
split final write plan, stale-entry plan, and preserved-entry policy.

Convex references inspected:

- `npm-packages/convex/src/cli/codegen.ts`
  - Defines the `--dry-run` flag on the `codegen` command.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - `writeFormattedFile(...)` prints `Command would write file: ...` when
    dry-run is enabled.
  - Cleanup receives the same dry-run option used by writes.
- `npm-packages/convex/src/cli/lib/fsUtils.ts`
  - `recursivelyDelete(...)` prints `Command would delete file/directory: ...`
    during dry-run.

Flarex differences:

- Flarex local analysis still needs `_generated` bootstrap files to exist while
  bundling developer modules, so dry-run analyzes a temporary copy of the
  Flarex app directory instead of writing bootstrap files into the real project.
- The first dry-run output reports the final generated write/delete plan. It
  does not print generated file contents.
- Generated-output typecheck is skipped in dry-run because final generated
  files are intentionally not written to the real project.

Known limitations:

- Dry-run uses local Miniflare analysis; deployed push still needs
  backend-authoritative analysis before final production codegen.
- Dry-run copies the Flarex app directory when present, so source imports that
  escape the app directory are not a supported contract.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts -t "dry-run" --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "dry-runs" --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts test/generate.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example generate
git diff --check
```

## Preserved Generated Entries

Previous completed checkpoint: `6dda926` Plan stale generated cleanup.

What changed:

- Added a module-local `PRESERVED_GENERATED_ENTRIES` policy to `flarex-dev`,
  initially preserving the top-level `_generated/ai` entry.
- `staleGeneratedEntries(...)` now skips preserved generated entries, so normal
  cleanup and future dry-run deletion output share the same exclusion rule.
- Exported `isPreservedGeneratedEntry(...)` from the package root for future CLI
  dry-run code without exposing mutable cleanup state.

Why it changed:

Convex's stale generated cleanup does not delete every unknown `_generated`
entry. It preserves `_generated/ai`, and Flarex needs the same kind of explicit
policy before exposing deletion planning as Convex-style dry-run behavior.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Defines `PRESERVED_GENERATED_ENTRIES = new Set(["ai"])`.
  - `cleanupStaleGeneratedEntries(...)` skips preserved entries before deleting
    unknown generated files.

Flarex differences:

- Flarex exposes the policy through `isPreservedGeneratedEntry(...)` and async
  filesystem planning because its generator already uses Node `fs/promises`.
- Only `ai` is preserved for now. Additional generated extension directories
  must be added deliberately instead of being implicitly preserved.

Known limitations:

- No user-facing `codegen --dry-run` command exists yet.
- Preserved entries are name-based top-level `_generated` entries, matching
  Convex's current cleanup boundary rather than a nested pattern matcher.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "plans stale generated entries" --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example generate
git diff --check
```

## Stale Generated Entry Plan

Previous completed checkpoint: `8531b41` Extract final codegen write plan.

What changed:

- Added `staleGeneratedEntries(generatedDir, writtenFiles)` to `flarex-dev`
  and re-exported its `StaleGeneratedEntry` result type from the package root.
- `finalCodegen(...)` stale cleanup now consumes the same stale-entry plan that
  a future dry-run command can report.
- Added generator coverage proving stale-entry planning does not delete files,
  while normal `generateFlarex(...)` still removes stale files and directories.

Why it changed:

Convex's CLI supports `codegen --dry-run`. Flarex needs dry-run output to cover
both generated writes and stale deletions; otherwise the command would describe
only half of what normal codegen mutates. This checkpoint creates the deletion
planning boundary before exposing a user-facing dry-run flag.

Convex references inspected:

- `npm-packages/convex/src/cli/codegen.ts`
  - Convex exposes `--dry-run` as command behavior.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated file writing and stale cleanup live in shared codegen workflow.

Flarex differences:

- This is still not a user-facing dry-run command.
- The helper reports filesystem entries as `{ name, path, kind }`; the final
  CLI output format is intentionally not designed in this checkpoint.
- Initial codegen still writes bootstrap files so local analysis can compile
  source modules that import `_generated/server`.

Known limitations:

- CLI `--dry-run` still needs a follow-up command slice.
- Dry-run output still needs to merge `finalGeneratedFiles(...)` writes with
  `staleGeneratedEntries(...)` deletions.
- Stale planning still treats every unknown `_generated` entry as removable.
  Before generated extensions are supported or deletion output is presented as
  fully Convex-style, Flarex needs an explicit preserved-entry policy like
  Convex's `PRESERVED_GENERATED_ENTRIES`.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "plans stale generated entries" --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example generate
git diff --check
```

## Final Codegen Write Plan

Previous completed checkpoint: `f6a1984` Add codegen typecheck modes.

What changed:

- Added `finalGeneratedFiles(analysis)` to `flarex-dev` and re-exported it
  from the package root.
- The helper returns the final `_generated` write plan as typed
  `{ name, contents }` entries without writing to disk.
- `finalCodegen(...)` now writes from that shared plan in plan order and still
  owns stale generated-file cleanup.
- Added generator coverage proving the plan contains final-only files and does
  not write those files until `finalCodegen(...)` runs.

Why it changed:

Convex's CLI exposes `codegen --dry-run`; Flarex cannot implement that honestly
until generated output can be computed separately from filesystem writes. This
checkpoint creates that reusable write-output boundary before adding a CLI
`--dry-run` flag.

Convex references inspected:

- `npm-packages/convex/src/cli/codegen.ts`
  - Convex exposes `--dry-run` as codegen command behavior.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated file behavior is shared workflow logic.

Flarex differences:

- This is not yet a user-facing dry-run command.
- Initial codegen still writes bootstrap files because source analysis depends
  on `_generated` imports compiling in local fixtures.
- Stale cleanup remains part of `finalCodegen(...)`, not this write plan.

Known limitations:

- CLI `--dry-run` still needs a follow-up command slice.
- A complete dry-run must also plan stale deletions; `finalGeneratedFiles(...)`
  intentionally models writes only.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "plans final generated output" --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example generate
git diff --check
```

## Codegen Typecheck Modes

Previous completed checkpoint: `7eeb277` Add source CLI entrypoint.

What changed:

- `flarex-dev codegen` now accepts Convex-style generated-output typecheck
  modes: `--typecheck enable`, `--typecheck try`, and `--typecheck disable`.
- Existing bare `--typecheck` remains supported as shorthand for
  `--typecheck enable`.
- `--typecheck try` runs generated-output typecheck but warns and keeps exit
  code `0` if typechecking fails.
- `--typecheck disable` skips generated-output typecheck.
- Invalid typecheck modes fail before codegen runs.
- The example app's `typecheck:generated` script now passes
  `--typecheck enable` explicitly.

Why it changed:

Convex's `codegen` command exposes `--typecheck <mode>` rather than a pure
boolean. Flarex should follow that shape so future CI/dev commands can express
strict, best-effort, and disabled typecheck behavior without adding more flags.

Convex references inspected:

- `npm-packages/convex/src/cli/codegen.ts`
  - Convex defines `--typecheck <mode>` with `enable`, `try`, and `disable`.
- `npm-packages/convex/src/cli/program.ts`
  - command behavior is registered centrally through the CLI entrypoint.

Flarex differences:

- Convex defaults typecheck mode to `try`; Flarex currently defaults to
  `disable` because workspace examples still require explicit TypeScript path
  mappings for source packages.
- Flarex keeps bare `--typecheck` as `enable` for backward compatibility with
  the existing runner script.
- Flarex still uses a small hand-rolled parser instead of Commander.

Known limitations:

- `try` mode only controls generated-output typecheck, not a full app
  typecheck.
- The CLI still only has `codegen`.
- Defaulting to Convex's `try` mode should wait until normal package
  resolution is stable without workspace-specific path flags.

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

## Source CLI Entrypoint Script

Previous completed checkpoint: `24fcc04` Route example generate through CLI
runner.

What changed:

- Added `packages/flarex-dev/src/bin.ts` as a process entrypoint that calls
  `runFlarexDevCli()` and assigns the returned code to `process.exitCode`.
- Added a `flarex-dev` package script, `cli`, that runs the source entrypoint
  through `tsx`.
- Added `tsx` as a `flarex-dev` dev dependency and refreshed
  `pnpm-lock.yaml`.
- `runFlarexDevCli(...)` now ignores one leading `--` separator so package
  script invocations like `pnpm --filter flarex-dev cli -- codegen --help`
  route to the intended command.
- Added CLI runner test coverage for the package-script separator behavior.

Why it changed:

The previous checkpoints moved app scripts onto the command runner, but there
was still no source process entrypoint for the runner itself. Convex has both a
development entrypoint for running the CLI from source and a built packaged
entrypoint. Flarex now has the source entrypoint side while still explicitly
deferring a published `bin` until the package emits JavaScript.

Convex references inspected:

- `npm-packages/convex/package.json`
  - Convex exposes real `bin` entries for `convex` and `convex-bundled`.
- `npm-packages/convex/bin/main-dev`
  - Convex's monorepo development CLI runs source through `tsx`.
- `npm-packages/convex/bin/main.js`
  - Convex's packaged CLI imports the built bundle.
- `npm-packages/convex/src/cli/program.ts`
  - Convex has a command program entrypoint that registers command handlers.
- `npm-packages/convex/src/cli/codegen.ts`
  - codegen is a CLI command workflow.

Flarex differences:

- Flarex still does not declare a published package `bin`; the package is
  source-only with `noEmit`.
- The `cli` package script is a development/source-mode process entrypoint,
  not the final npm command.
- Flarex uses a small hand-rolled parser for now instead of Convex's Commander
  program because only `codegen` exists.

Known limitations:

- No installed `flarex` or `flarex-dev` binary exists yet.
- The packaged CLI path must wait for JS emit or a deliberate runtime loader
  strategy.
- The CLI still only implements `codegen`.

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

## Example Generate Uses CLI Runner

Previous completed checkpoint: `5efa1f7` Default codegen CLI root to project.

What changed:

- `apps/example/scripts/generate.ts` now calls `runFlarexDevCli(...)` from
  `flarex-dev/cli` instead of importing `generateFlarex(...)` directly.
- The example app's normal `generate` script now exercises the same
  command-shaped codegen path as `typecheck:generated`.
- The script relies on the package script cwd and the CLI runner's default app
  root, matching the project-command shape introduced in the previous
  checkpoint.

Why it changed:

The previous checkpoint made `codegen` default to the current project root, but
the example app's normal generation path still bypassed the CLI runner. Convex
keeps codegen behind developer commands. Flarex should move app-facing
workflows through the same command boundary before adding a real package
binary.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated API files are produced through CLI workflow code.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - local workflows coordinate codegen from project context.

Flarex differences:

- This still runs through an app-local `tsx` script because `flarex-dev` does
  not emit a published executable binary yet.
- The low-level `generateFlarex(...)` API remains exported for tests and direct
  programmatic use.

Known limitations:

- No installed `flarex` binary exists yet.
- The example still uses a separate `typecheck:generated` script until a
  stable `codegen --typecheck` binary command exists.

Verification:

```sh
corepack pnpm --filter @flarex/example generate
corepack pnpm --filter @flarex/example typecheck:generated
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example typecheck
git diff --check
```

## Codegen CLI Defaults To Project Root

Previous completed checkpoint: `1ae9066` Add source CLI runner for codegen.

What changed:

- `runFlarexDevCli(...)` now defaults `codegen` root to the current project
  directory when `--root` is omitted.
- Added a runner/test integration `projectRoot` option so the default-root
  behavior is deterministic without depending on the test process cwd.
- Empty explicit `--root ""` is rejected before codegen runs.
- The example app's `typecheck:generated` command no longer passes `--root`;
  it relies on the package script cwd like a normal project-level command.
- CLI usage now documents `--root` as optional.

Why it changed:

Convex's developer commands are normally run from the app/project directory.
Requiring every Flarex app script to pass `--root` kept the command shaped more
like a low-level helper than a real CLI. This moves the runner closer to the
Convex mental model while keeping explicit `--root` available for tests and
nonstandard scripts.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - codegen is a project command, not only an explicit-root helper.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - developer workflows assume a project cwd and orchestrate codegen from
    there.

Flarex differences:

- The package still exposes a source runner, not a published executable binary.
- `projectRoot` is a runner/test integration option, not a CLI flag.
- Workspace-specific `--path` mappings remain in the example script until
  package distribution and module resolution are settled.

Known limitations:

- There is still no `flarex` package binary.
- The runner still only implements `codegen`; deploy/push/dev commands remain
  future slices.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
corepack pnpm --filter @flarex/example typecheck:generated
git diff --check
```

## Source CLI Runner For Codegen Typecheck

Previous completed checkpoint: `1a19708` Add example generated output
typecheck.

What changed:

- Added `packages/flarex-dev/src/cli.ts` with a reusable
  `runFlarexDevCli(...)` runner.
- Added a package subpath export, `flarex-dev/cli`, for the runner.
- The runner supports `codegen --root <path>` and optional
  `--typecheck`, `--cwd`, `--typescript-cli`, `--app-dir`,
  `--generated-dir`, and repeated `--path alias=target` mappings.
- The example app's `typecheck:generated` script now calls the runner through
  `flarex-dev/cli`, so the app-facing command exercises the same code path
  that can become a real CLI binary later.
- Added `packages/flarex-dev/test/cli.test.ts` covering a real generated-output
  typecheck path, missing-root diagnostics, option forwarding, repeated path
  mappings, and malformed path mapping errors.

Why it changed:

The previous checkpoint proved an example-local generated-output check, but the
script still called the low-level helper directly. Convex's CLI keeps codegen
and generated TypeScript validation behind developer commands. Flarex now has a
tested command runner boundary while deferring the package `bin` decision until
the package emits stable JavaScript.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - codegen and generated-output validation are developer command concerns.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - dev readiness flows through generated/deployed state, not app-local helper
    scripts.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - generated TypeScript is part of the public app contract.

Flarex differences:

- This is a source-level runner and subpath export, not a published executable
  `bin` yet.
- The runner exposes `--path alias=target` because this monorepo validates
  TS-source workspace packages; a packaged CLI should infer normal package
  resolution when Flarex is installed as built npm packages.
- The command returns an exit code instead of calling `process.exit(...)`,
  keeping it directly testable and reusable by app scripts.

Known limitations:

- There is still no stable `flarex` or `flarex-dev` binary.
- The runner only implements `codegen`; future Convex-style commands still need
  deploy/push/dev integration.
- Diagnostics are plain stderr strings, not structured Convex-style command
  errors yet.

Verification:

```sh
corepack pnpm --filter @flarex/example typecheck:generated
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/cli.test.ts --testTimeout=60000 --hookTimeout=60000
git diff --check
```

## Example Generated Output Typecheck Command

Previous completed checkpoint: `a902d50` Gate dev flow on generated typecheck.

What changed:

- The example app now has a `typecheck:generated` script that runs
  `pnpm generate` and then checks `flarex/_generated/**/*.ts` through the
  public `typecheckGeneratedOutput(...)` helper from `flarex-dev`.
- Added `apps/example/scripts/typecheck-generated.ts` as the first app-facing
  command path for the generated-output gate.
- The script uses the same workspace TypeScript path mappings already covered
  by the dev-runtime and Vite tests, so manual and CI validation exercise the
  same generated-output checker.

Why it changed:

The previous checkpoint made generated-output typechecking part of the dev
runtime and Vite plugin lifecycle, but there was still no direct app command to
run the same gate outside Vite. Convex exposes codegen/typecheck behavior as a
developer workflow, not just an internal dev-server detail. Flarex needs that
same direction before a full CLI fork/port is introduced.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Convex keeps generated API output tied to developer commands.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - dev orchestration gates serving on generated/deployed state.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - generated TypeScript remains a stable app import contract.

Flarex differences:

- This is an example-app script, not a published `flarex codegen --typecheck`
  command yet.
- The script passes workspace path mappings because this repo runs the example
  against TS-source workspace packages.
- The command checks generated output only; full app typechecking remains the
  existing `typecheck` script.

Known limitations:

- There is still no stable CLI binary because `flarex-dev` currently publishes
  TS-source exports and does not emit a built JS command entry.
- The app script is workspace-specific; the future CLI should infer package
  resolution from the project environment instead of hardcoding monorepo path
  mappings.

Verification:

```sh
corepack pnpm --filter @flarex/example typecheck:generated
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter flarex-dev typecheck
git diff --check
```

## Generated Output Typecheck Dev Integration

Previous completed checkpoint: `7380900` Expose generated output typecheck.

What changed:

- `FlarexPluginOptions` now exposes
  `typecheckGeneratedOutput?: false | FlarexGeneratedOutputTypecheckConfig`.
- The Vite plugin invokes `typecheckGeneratedOutput(...)` after codegen when
  the option is provided.
- `FlarexDevRuntimeOptions` exposes the same option so direct dev-runtime
  users can enforce generated-output typechecking without going through Vite.
- `generatedOutputTypecheckOptions(...)` centralizes the merge from
  root/appDir/generatedDir plus the nested typecheck config.
- The helper applies host `root`, `appDir`, and `generatedDir` after the nested
  config so structurally wider caller objects cannot override the authoritative
  app paths.
- The public nested config type forbids host codegen keys and the runtime merge
  drops them defensively before rebuilding canonical host paths.
- The host option merge helper remains internal to `flarex-dev`; the package
  export surface exposes the executable typecheck helper and public option
  types only.

Why it changed:

Generated code validation needs to be part of the SDK/dev API surface, not only
an exported utility. This keeps Flarex moving toward Convex's developer model:
codegen, analysis, final generated APIs, and typechecking are one coherent
workflow.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - codegen is wired into developer workflow checks.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - dev orchestration gates serving on generated/deployed state.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - generated APIs remain developer-visible TypeScript contracts.

Flarex differences:

- This is an opt-in SDK option, not the default CLI behavior yet.
- The typecheck scope is generated output only, which is narrower than a full
  app typecheck.
- In serve mode with local dev enabled, the dev runtime owns authoritative
  final-codegen typechecking instead of the plugin running an extra startup
  gate.
- In serve mode with `dev: false`, plugin-owned codegen/typecheck runs once
  even if Vite invokes both configure-server and build-start paths.

Known limitations:

- There is still no `flarex codegen --typecheck` command.
- Vite watcher failure reporting is still logger-only when reload fails after
  startup.

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

## Generated Output Typecheck API

Previous completed checkpoint: `f7634e1` Typecheck generated output tree.

What changed:

- `flarex-dev` now exports `typecheckGeneratedOutput(...)`.
- The generated-output typecheck implementation moved from
  `generate.test.ts` into `packages/flarex-dev/src/generatedTypecheck.ts`.
- The API writes a generated-output tsconfig into a temporary directory by
  default, removes it after the compiler exits, compiles
  `flarex/_generated/**/*.ts`, and accepts overrides for the TypeScript CLI JS
  entrypoint, working directory, path mappings, ambient types, type roots, and
  output buffer size.
- `flarex-dev` now declares `typescript` and `@cloudflare/workers-types` as
  peer dependencies because this API resolves the compiler and defaults to
  Worker ambient types at runtime.

Why it changed:

The previous checkpoint proved generated output only inside a package test.
Convex treats generated code and typechecking as part of the developer
workflow. Flarex needs the same direction: generated files should be
typechecked by reusable dev tooling, then later wired into CLI/dev-server
flows.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Convex couples codegen with typecheck-capable workflows.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - generated TypeScript remains a stable developer-facing API surface.

Flarex differences:

- Flarex exposes this as a package API first, not a CLI command yet.
- The API is configurable so tests can typecheck temp apps without installed
  dependencies while real apps can rely on normal package resolution. Callers
  can pass `tsconfigPath` only when they intentionally want a persisted config
  for debugging. Relative `paths`, `typeRoots`, and `typescriptCliPath` values
  resolve from `cwd ?? root`, which keeps the temp config location invisible to
  callers.

Known limitations:

- No `flarex codegen --typecheck` command exists yet.
- The Vite/dev runtime does not call this API automatically yet.

Verification:

```sh
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "typechecks generated output" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev build
```

## Generated Output Typecheck Gate

Previous completed checkpoint: `53eda56` Typecheck generated Worker output.

What changed:

- The `generateFlarex` generated-source typecheck now includes the whole
  emitted `_generated` TypeScript tree.
- The test now proves `_generated/api.ts`, `_generated/server.ts`,
  `_generated/dataModel.ts`, `_generated/functionRegistry.ts`,
  `_generated/functionMetadata.ts`, `_generated/deploymentSchema.ts`, and
  `_generated/worker.ts` typecheck together.
- The helper names now describe generated output generally, not only Worker
  output.

Why it changed:

Flarex wants Convex-style generated APIs where the generated files are the
developer's stable import surface. Only compiling `worker.ts` left a gap for
API/server/dataModel template drift. The generator test should catch that drift
before app developers do.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Convex treats codegen and typechecking as coupled developer workflow.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - generated TypeScript templates define the public function-reference,
    server-builder, and data-model surfaces.

Flarex differences:

- Flarex compiles generated output inside one focused generator test for now.
- The temp config uses workspace source path mappings instead of installed
  package resolution because test apps live in temporary directories.

Known limitations:

- There is still no user-facing `flarex codegen --typecheck` or equivalent
  command.
- The representative fixture exercises nested query references, but broader
  generated API shape coverage should grow as more Convex-style APIs are
  ported.

Verification:

```sh
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "typechecks generated output" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev build
```

## Generated Worker Typecheck Gate

Previous completed checkpoint: `90df37a` Guard nested function execution.

What changed:

- `generateFlarex` tests now run TypeScript against emitted
  `_generated/worker.ts`.
- The temporary generated-app `tsconfig` uses strict settings,
  `exactOptionalPropertyTypes`, Cloudflare Worker types, and workspace path
  mappings for `flarex` package imports.
- This protects generated Worker API/runtime contracts such as
  `executionContextForSession(...)`, `ctx.runQuery`, `ctx.runMutation`, and
  `nestedCallDepth`.

Why it changed:

The SDK/codegen contract is only useful if emitted files typecheck for app
developers. Vite bundling transpiles the Worker but does not prove TypeScript
correctness. This checkpoint adds the missing generated-source check.

Convex references inspected:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Convex wires codegen to function typechecking modes.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
  - generated TypeScript is treated as an authored API surface.

Flarex differences:

- This is a test helper, not a public CLI flag yet.
- Path mappings are explicit because Flarex generator tests use temp projects
  without their own `node_modules`.

Known limitations:

- The helper currently typechecks `worker.ts` only.
- Generated API/server/dataModel typecheck coverage should be added as those
  templates become more behaviorful.

Verification:

```sh
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "typechecks generated Worker output" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev build
```

## Server Context Nested Call Guardrails

Previous completed checkpoint: `185775f` Execute same-artifact nested
functions.

What changed:

- `ctx.runQuery` and `ctx.runMutation` now fail with a clear maximum-depth
  error when same-artifact nested calls recurse too deeply.
- Query contexts continue to reject `ctx.runMutation` at runtime, matching the
  existing TypeScript contract.
- Generated Worker and materialized runtime tests cover these developer-facing
  errors.

Why it changed:

Convex-style server contexts should be easy to use, but recursive function
references need a bounded failure mode. Without this guard, a developer typo
could show up as a generic stack overflow instead of a Flarex/Convex-style
runtime error.

Convex references inspected:

- `crates/common/src/knobs.rs`
  - `MAX_REACTOR_CALL_DEPTH` defaults to `8`.
- `crates/isolate/src/environment/udf/async_syscall.rs`
  - checks nested call depth before running the nested UDF.

Flarex differences:

- Flarex enforces the limit inside execution artifacts for now, not inside a
  Rust isolate reactor.
- The limit is not yet configurable through project/deployment settings.

Known limitations:

- No `ctx.runAction` API or runtime path yet.
- No cross-artifact nested function calls yet.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "nested server-side|derives Postgres invoke visibility" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts -t "nested|Postgres executor invoke routes" --testTimeout=30000 --hookTimeout=30000
```

## Server Context Same-Artifact Execution

Previous completed checkpoint: `4428c8d` Add fail-closed server context calls.

What changed:

- The previously typed `ctx.runQuery` and `ctx.runMutation` API now has a
  first runtime implementation in generated Worker and local materialized
  execution artifacts.
- The API remains Convex-style at the developer boundary: functions pass a
  generated function reference plus optional args for no-arg functions.
- Generated Worker execution validates nested function args and return values
  using the same generated validator metadata as top-level invokes.

Why it changed:

The SDK surface should not remain a typed dead end. Same-artifact nested
execution is the smallest useful step toward Convex parity while preserving
the Flarex backend-owned transaction/session model.

Convex references inspected:

- `npm-packages/convex/src/server/registration.ts`
  - server contexts expose `ctx.runQuery` and `ctx.runMutation`.
- `npm-packages/convex/src/server/api.ts`
  - function references and optional rest args shape the callable API.

Flarex differences:

- Convex can execute nested functions through its integrated function runner.
  Flarex currently supports same-artifact dispatch only; the active invoke
  session remains owned by the trusted executor.
- The local materialized runtime lacks generated validator metadata, so its
  nested calls check function kind only. Generated Worker output performs
  nested arg and return validation and reuses the SDK `getFunctionName`
  helper. The materialized runtime keeps a local reference resolver because it
  builds an unbundled Miniflare Worker source string.

Known limitations:

- No `ctx.runAction` API or runtime path yet.
- No cross-artifact nested function calls yet.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts -t "nested server-side|derives Postgres invoke visibility" --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts -t "nested|Postgres executor invoke routes" --testTimeout=30000 --hookTimeout=30000
```

## Server Context Internal Call Contract

Previous completed checkpoint: `0fef4db` Guard public client visibility
types.

What changed:

- `QueryCtx` now exposes a typed `runQuery`.
- `MutationCtx` and partition-scoped mutation contexts now expose typed
  `runQuery` and `runMutation`.
- `ActionCtx` now exposes typed `runQuery` and `runMutation` instead of
  untyped `unknown` argument/return shapes.
- Server-side `runQuery` and `runMutation` use Convex-style optional argument
  tuples, so no-arg functions can be called without passing `{}` while argful
  functions still require an argument object.
- Registration type tests prove internal query and mutation references are
  accepted in server-side contexts, no-arg references allow omitted args, and
  invalid function-kind or missing-arg calls are rejected at compile time.

Why it changed:

Generated public clients now reject internal references, so internal references
need the Convex-style server-side home. This checkpoint establishes the typed
contract before wiring the real nested execution bridge. That keeps developer
code pointed at the correct API while the runtime still fails closed.

Convex references inspected:

- `npm-packages/convex/src/server/registration.ts`
  - `GenericQueryCtx`, `GenericMutationCtx`, and `GenericActionCtx` expose
    typed `runQuery`/`runMutation` using public or internal function
    references.
- `npm-packages/convex/src/server/api.ts`
  - `FunctionReference`, `FunctionArgs`, `FunctionReturnType`, and
    `OptionalRestArgs` provide the type plumbing for server-side calls.

Flarex differences:

- Convex runs nested functions in its integrated function runner and database
  transaction model. Flarex only adds the typed contract in this checkpoint;
  generated/runtime execution stubs throw a clear unsupported error.
- Flarex still has no server-side `ctx.runAction`, matching the currently
  implemented context surface.

Known limitations:

- `ctx.runQuery` and `ctx.runMutation` are fail-closed in generated execution
  sessions until the trusted executor supports nested same-session execution.
- No sub-transaction semantics are implemented yet for nested mutations.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex exec vitest run test/registration.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-dev build
git diff --check
```

## Public Client Visibility Guards

Previous completed checkpoint: `7e4955b` Split generated public and internal
APIs.

What changed:

- Added compile-time guards proving `FlarexClient.query`,
  `FlarexClient.watchQuery`, `FlarexClient.onUpdate`, and
  `FlarexClient.mutation` reject internal function references.
- Added compile-time guards proving React `useQuery`,
  `useQuery_experimental`, and `useMutation` reject internal function
  references.
- Added `flarex-test` type coverage and a type-only fixture proving convenience
  `t.query`/`t.mutation`/`t.action` mirror public client visibility, while
  `t.invokeRaw` remains the explicit test escape hatch for internal
  references.
- Included `packages/flarex-test/test` in the package typecheck scope.

Why it changed:

After generated `_generated/api.ts` began exporting separate public `api` and
internal `internal` trees, the public client surfaces needed a proof that they
do not accidentally accept internal references through generic widening. This
keeps the Convex-style mental model: public clients use `api.*`; server/test
orchestration uses `internal.*` only through deliberate internal-capable APIs.

Convex references inspected:

- `npm-packages/convex/src/react/client.ts`
  - public React/client methods are typed around `FunctionReference<"query">`
    and `FunctionReference<"mutation">`.
- `npm-packages/convex/src/react/queries_observer.ts`
  - query observation accepts public query references through the client layer.
- `npm-packages/convex/src/server/registration.ts`
  - server-side execution APIs accept public or internal references separately
    from public client APIs.

Flarex differences:

- Flarex does not yet have Convex's server-side `ctx.runQuery` /
  `ctx.runMutation` implementation. `flarex-test.invokeRaw` is kept as the
  explicit internal-capable testing boundary until that server-side execution
  API exists.
- Runtime enforcement still lives in the trusted executor visibility check;
  these tests protect TypeScript DX and accidental public-surface widening.

Known limitations:

- `flarex-test.action` is now covered by the public visibility guard, but
  action runtime execution is still not implemented as part of the current
  `/invoke` path.
- This checkpoint adds type guards only; it does not introduce server-side
  internal execution helpers.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex-test typecheck
corepack pnpm --filter flarex exec vitest run test/client.test.ts test/react.test.ts --testTimeout=30000 --hookTimeout=30000
corepack pnpm --filter flarex-test test
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-test build
git diff --check
```

## Current Decision

Fork the Convex npm package as the starting point for Flarex's developer SDK,
but treat it as a compatibility SDK, not as the backend source of truth.

The goal is to keep the developer-facing experience as close to Convex as
possible while replacing hosted Convex transport, deployment, analysis, and
runtime assumptions with Flarex's Cloudflare backend.

## What To Reuse Heavily

Reuse or closely port these Convex npm-package surfaces:

- `query`
- `mutation`
- `action`
- `defineSchema`
- `defineTable`
- table `.index(...)`
- validators from `convex/values`
- `FunctionReference`
- generated `api`
- generated `_generated/server`
- query builder style:

```ts
ctx.db
  .query("lessonProgress")
  .withIndex("by_user_lesson", q =>
    q.eq("userId", args.userId).eq("lessonId", args.lessonId),
  )
  .collect()
```

- React/client API shapes where portable:
  - `useQuery`
  - `useMutation`
  - `useAction`
- Next.js helpers where they only depend on public client APIs.

This should keep most app code visually and mentally close to Convex.

## What To Replace

Replace or rewrite these areas:

- Convex cloud deployment selection and authentication.
- Convex push/analyze protocol.
- Convex hosted backend endpoints:
  - `/api/query`
  - `/api/mutation`
  - `/api/action`
  - `/api/sync`
- Direct assumptions about Convex's Rust backend, module analyzer, function
  runner, and sync server.
- CLI commands that manage Convex projects, teams, deployments, dashboard,
  WorkOS, or cloud tokens.
- Any code path that assumes global transactional writes across one deployment
  database.

Flarex transport should target:

```txt
POST /deployments/:deploymentId/invoke
POST /invoke
future /deployments/:deploymentId/sync
future Dynamic Worker function registry / loader
```

## Flarex-Specific Additions

Flarex needs a small set of intentional API differences:

```ts
definePartitionTable(...)
defineColocatedTable("documents", "documentId", ...)
defineGlobalTable(...)
defineProjection(...)

partition: model.documents
```

Legacy prototype forms remain temporarily implemented but are no longer the v1
product target:

```ts
defineTable(...).partitionBy("_id")
defineTable(...).colocateWith("users", "userId")
defineTable(...).global()
partition: model.documents.byId("documentId")
```

These differences are not optional implementation details. They are how Flarex
stays honest about Durable Object shard boundaries.

## Convex References

Primary npm package areas to fork or study:

- `npm-packages/convex/src/server/schema.ts`
  `defineSchema`, `defineTable`, table indexes, schema typing.
- `npm-packages/convex/src/server/registration.ts`
  `query`, `mutation`, `action`, context types, handler registration.
- `npm-packages/convex/src/server/database.ts`
  `GenericDatabaseReader`, `GenericDatabaseWriter`, table query APIs.
- `npm-packages/convex/src/server/query.ts`
  Query initializer and query builder types.
- `npm-packages/convex/src/server/index_range_builder.ts`
  `q.eq` and index range builder shape.
- `npm-packages/convex/src/server/api.ts`
  `FunctionReference` and generated API reference model.
- `npm-packages/convex/src/values`
  Validators and value typing.
- `npm-packages/convex/src/browser/http_client.ts`
  HTTP client shape, but not endpoints as-is.
- `npm-packages/convex/src/browser/sync`
  Fork/refactor target for live sync state, public client behavior, and protocol
  shape. The transport URL, authentication, timestamp encoding, and
  partition-routing fields must be adapted for Flarex.
- `npm-packages/convex/src/react`
  React hook shapes.
- `npm-packages/convex/src/nextjs`
  Next.js helper shapes.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  Codegen control flow.
- `npm-packages/convex/src/cli/codegen_templates`
  Generated `api`, `server`, and data model templates.

Backend behavior references remain:

- `crates/database/src/transaction.rs`
- `crates/database/src/committer.rs`
- `crates/database/src/reads.rs`
- `crates/function_runner/src/lib.rs`
- `crates/isolate/src/environment/udf/syscall.rs`

## Cloudflare Difference

Convex's npm package talks to Convex's hosted/Rust backend. Flarex's SDK must
talk to Cloudflare Workers and Durable Objects:

```txt
SDK / generated API
  -> Flarex invoke or sync transport
  -> Worker route
  -> DeploymentDO metadata
  -> PartitionDO shard
  -> OCC commit
```

The SDK should preserve developer ergonomics, but it must not hide impossible
cross-shard transaction semantics. Normal mutations remain single-shard unless
the developer explicitly opts into workflow-style cross-shard behavior.

## Migration Plan

1. Create a forked SDK package from the Convex npm package subset, not the full
   hosted CLI.
2. Port values, schema, registration, function references, and query-builder
   types first.
3. Add explicit Flarex placement constructors:
   `definePartitionTable`, `defineColocatedTable`, and `defineGlobalTable`.
4. Generate `model.<rootTable>` as the normal function partition API.
5. Replace generated transport with Flarex `/invoke`.
6. Keep generated `_generated/api` and `_generated/server` close to Convex.
7. Add a minimal Flarex CLI/codegen command before porting larger Convex CLI
   behavior.
8. Port the Convex sync client layering before React hooks:
   `LocalSyncState`-style query-set bookkeeping, `BaseConvexClient`-style
   sync transport boundary, and `ConvexClient`-style public callback API.
9. Add React/Next.js helpers after the live client exposes stable
   `onUpdate`, `watchQuery`, `mutation`, and connection-state semantics.
10. Revisit optimistic updates, paginated sync, auth refresh, and reconnect
   polish after the first partition-aware live client is working.

## Known Limitations

- `packages/flarex` now exists as the first compatibility-SDK foundation, but
  it still contains a deliberately small subset of Convex's public SDK.
- Current `packages/flarex-dev` generator is still a prototype and does not
  yet generate a deployment manifest.
- Dynamic Worker loading is not connected yet, so generated functions are not
  deployed through the new backend invoke registry.
- Generated clients currently infer partition routing for functions that
  declare `partition: model.<table>.by<Field>(...)`, but the v1 target is
  `partition: model.<table>`.
- Generated `_generated/server.ts` currently exposes
  `model.<table>.by<Field>(...)` partition selectors. These need migration to
  root model objects.
- Generated `_generated/server.ts` now emits `PartitionScopes` and narrows
  `mutation` / `internalMutation` / `workflowMutation` handler write tables
  when a function declares first-class partition metadata.
- Live sync now has an initial `packages/flarex` client-side stack, but it is
  still smaller than Convex's full browser client.

## Explicit Partition API Redesign

Checkpoint title: `Plan explicit partition table API`

Previous completed checkpoint: `ff5dae0` Generate partition-scoped mutation
types.

What changed:

- The SDK/codegen target now uses explicit table constructors:
  `definePartitionTable`, `defineColocatedTable`, and `defineGlobalTable`.
- Root partition tables are `_id` owned only in v1.
- Generated `_generated/server.ts` should expose root partition model objects:
  `model.documents`, `model.rooms`, `model.carts`.
- Function definitions should use `partition: model.documents` for both
  create and existing single-shard mutations; analyzer/runtime decides mode
  from args and schema.
- Selector methods such as `model.documents.byId("documentId")` become
  compatibility-only implementation details until removed or demoted.

Target app code:

```ts
export default defineSchema({
  documents: definePartitionTable({
    title: v.string(),
  }),
  comments: defineColocatedTable("documents", "documentId", {
    documentId: v.id("documents"),
    body: v.string(),
  }).index("by_document", ["documentId"]),
});

export const addComment = mutation({
  partition: model.documents,
  args: { documentId: v.id("documents"), body: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("comments", args);
  },
});
```

Convex references:

- `npm-packages/convex/src/server/schema.ts`
  - schema authoring should stay compact and generated-model friendly.
- `npm-packages/convex/src/server/registration.ts`
  - function registration is the public layer for metadata and typed handler
    contexts.
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
  - generated server files bind SDK generics to app-specific generated types.
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - data model codegen should continue to derive document/table types from the
    developer schema.

Cloudflare difference:

- Convex does not need developer-visible physical placement APIs. Flarex does,
  but the v1 API should expose one simple concept: root partition tables and
  colocated child tables.

Known limitations:

- This checkpoint does not implement the constructors yet.
- Current tests/examples still use legacy chain placement and selector model
  APIs.
- Backend invoke/sync still expects analyzed partition metadata with an
  argument field. Create-mode root preallocation is a follow-up.
- Do not remove `model.<rootTable>.byId(...)` until root-model partition
  metadata is implemented in analysis, backend invoke/session start, sync,
  generated clients, and examples/tests.

Verification:

```sh
Documentation-only change; no runtime validation required.
```

## Explicit Schema Constructor Update

Checkpoint title: `Add explicit schema table constructors`

Previous completed checkpoint: `ebf431a` Plan explicit partition table API.

What changed:

- `flarex/server` now exports the new public schema constructors:
  `definePartitionTable`, `defineColocatedTable`, and `defineGlobalTable`.
- The constructors preserve the existing Convex-style `defineTable` typing for
  document validators, field paths, indexes, and generated data model
  inference.
- The implementation is intentionally a thin compatibility layer over current
  placement metadata so no backend or generator behavior changes in this
  checkpoint.
- Schema tests now cover each explicit constructor and verify it records the
  expected placement metadata.

Convex references:

- `npm-packages/convex/src/server/schema.ts`
  - schema constructors should preserve validator and field-path inference.
- `npm-packages/convex/src/server/registration.ts`
  - generated function types depend on schema-derived data model fidelity.
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - data model codegen stays downstream of the schema definition shape.

Cloudflare difference:

- Flarex adds named placement constructors because physical placement is part
  of correctness on Durable Objects. Convex keeps physical placement hidden
  behind its logical database.

Known limitations:

- Existing example apps and generator tests still use chain-style placement.
- `model.table` root partition declarations are not implemented yet.
- Backend execution still consumes selector-style partition metadata.
- `model.table.byId(...)` remains necessary compatibility API until backend
  execution can resolve `model.table` policies for both existing-root and
  create-root modes.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
```

## Root Model Migration Order

Checkpoint title: `Document root model migration order`

Previous completed checkpoint: `fa7bf98` Add explicit schema table
constructors.

What changed:

- Documented that `.byId(...)` must remain until `model.<rootTable>` is
  supported end to end.
- The migration order is:
  1. generate `model.<rootTable>` root objects alongside current selectors,
  2. update analysis to emit root-model partition policies,
  3. update backend invoke/execution-session/sync to handle existing-root and
     create-root policy shapes,
  4. update generated clients to infer or omit wire `partitionKey` based on
     policy mode,
  5. migrate examples and tests to `partition: model.<rootTable>`,
  6. remove or demote `model.<rootTable>.byId(...)` and selector metadata.

Convex references:

- `npm-packages/convex/src/cli/codegen_templates/server.ts`
  - generated server files should expose the stable app-facing helpers before
    old helpers are removed.
- `npm-packages/convex/src/server/registration.ts`
  - function declarations remain the metadata boundary.
- `npm-packages/convex/src/server/api.ts`
  - generated function references carry metadata used by clients.

Cloudflare difference:

- Convex can change generated helper shapes without coordinating Durable
  Object routing metadata. Flarex must keep the old selector helper until the
  backend can choose or allocate a `PartitionDO` from root-model metadata.

Known limitations:

- This is documentation only. Current code still requires selector-style
  partition metadata for normal execution.
- Removing `.byId(...)` before backend support would break client partition
  inference, invoke validation, execution sessions, sync, and current tests.

Verification:

```sh
Documentation-only change; no runtime validation required.
```

## Generated Root Model Object Update

Checkpoint title: `Generate root model objects`

Previous completed checkpoint: `c469473` Document root model migration order.

What changed:

- Final `_generated/server.ts` now emits each partition root model entry as a
  root metadata object:

  ```ts
  model.users.type === "partitionRoot"
  model.users.table === "users"
  model.users.partitionField === "_id"
  ```

- Existing selector methods remain on the same object:

  ```ts
  model.users.byId("userId")
  ```

- Initial dynamic codegen mirrors the same shape so imports can resolve before
  authoritative backend analysis completes.
- Generator tests now assert that root metadata and legacy selector metadata
  are both emitted.

Convex references:

- `npm-packages/convex/src/cli/codegen_templates/server.ts`
  - generated server helpers are the stable app-facing surface.
- `npm-packages/convex/src/server/registration.ts`
  - function declarations consume generated helper metadata.

Cloudflare difference:

- Convex generated server helpers do not need physical shard metadata. Flarex
  root model objects carry the table identity needed for future
  existing-root/create-root analysis.

Known limitations:

- `partition: model.table` is generated but not yet accepted as executable
  backend partition metadata.
- `model.table.byId(...)` remains required for current invoke, sync, generated
  client inference, and examples.
- Root create-mode analysis and backend preallocation remain follow-up work.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- --run packages/flarex-dev/test/generate.test.ts
corepack pnpm --filter @flarex/example generate
corepack pnpm --filter @flarex/example typecheck
```

## Partition-Scoped Mutation Type Update

Checkpoint title: `Generate partition-scoped mutation types`

Previous completed checkpoint: `d3ef699` Infer client partition keys from
partition metadata.

What changed:

- `packages/flarex` now exports `DatabaseWriterForTables`,
  `MutationCtxForTables`, `MutationCtxForPartition`, and `PartitionScopeMap`.
- `MutationBuilder` accepts generated partition scopes as an extra type
  parameter. Object-form mutations with
  `partition: model.<table>.by<Field>(...)` receive a handler `ctx.db` whose
  write methods are narrowed to the root table and colocated tables for that
  partition root.
- `packages/flarex-dev` derives `PartitionScopes` from analyzed schema
  placement and emits it into `_generated/server.ts`.
- Generated `mutation`, `internalMutation`, and `workflowMutation` are now
  bound as `MutationBuilder<DataModel, ..., PartitionScopes>`.
- Direct handlers and legacy `partition: routeFromArgs(...)` definitions keep
  the full `MutationCtx<DataModel>` type. They are not the final normal path,
  but this preserves compatibility while partition metadata becomes mandatory
  at runtime.

Example generated scope:

```ts
export type PartitionScopes = {
  users: "lessonProgress" | "users";
};
```

Convex references:

- `npm-packages/convex/src/server/registration.ts`
  - Convex `MutationBuilder` gives generated mutation handlers a
    `GenericMutationCtx<DataModel>`.
  - `GenericMutationCtxWithTable` shows the existing pattern of specializing
    the mutation context by replacing `db`.
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
  - generated `_generated/server` binds generic builders to the app
    `DataModel`.
- `npm-packages/convex/src/server/data_model.ts`
  - data model table-name and document typing remain the foundation for
    typed `ctx.db`.

Cloudflare difference:

- Convex can expose a full `GenericDatabaseWriter<DataModel>` because one
  logical deployment database owns mutation atomicity. Flarex must narrow
  normal partitioned mutation writes because the runtime transaction is owned
  by one `PartitionDO`.

Known limitations:

- This is compile-time DX only. Runtime placement validation in backend
  syscalls and `PartitionDO` commit remains authoritative.
- Reads are intentionally not narrowed yet; cross-partition reads still need a
  clearer query/projection policy before static enforcement.
- The scope computation follows `colocateWith(...)` chains to a partition root
  and excludes `global()` tables from normal partitioned mutation writes.
- Cross-shard writes remain future `atomicMutation` or workflow work, not
  normal `mutation` semantics.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test -- --run packages/flarex-dev/test/generate.test.ts
corepack pnpm --filter @flarex/example typecheck
```

## Sync Client Fork Plan

The live client should not be a new hand-written WebSocket wrapper. It should
selectively port Convex's browser sync client architecture and keep the
Flarex-specific changes narrow and named.

### Convex Files To Port Closely

- `npm-packages/convex/src/browser/sync/local_state.ts`
  - Owns query tokens, query IDs, query-set versions, subscription
    deduplication, restart query-set reconstruction, and `Remove` emission
    only after the last subscriber unsubscribes.
- `npm-packages/convex/src/browser/sync/client.ts`
  - Owns the base sync client boundary: subscribe, local query result,
    mutation enqueueing, server message handling, and transition callbacks.
- `npm-packages/convex/src/browser/simple_client.ts`
  - Owns the public `ConvexClient` style: `onUpdate`, `query`, `mutation`,
    unsubscribe objects, callback dispatch, and connection-state subscription.
- `npm-packages/convex/src/browser/sync/protocol.ts`
  - Owns message names and payload shape. Flarex should keep names such as
    `ModifyQuerySet`, `Transition`, `QueryUpdated`, `QueryFailed`,
    `QueryRemoved`, `Mutation`, and `MutationResponse`.

### Flarex Adaptations

- Flarex sync URLs target the Flarex backend, not Convex's
  `/api/{version}/sync` path.
- The initial live client must include `partitionKey` in `AddQuery` and
  `Mutation` messages, and the query token must include that partition route.
- Client protocol types belong in `packages/flarex`, not by importing
  `packages/flarex-backend`. The client package may mirror the shared protocol
  shape, but it must not depend on backend-only code.
- Keep the current HTTP `/invoke` client as a compatibility path while the live
  sync client is introduced.
- Stage out Convex features that require backend support Flarex does not have
  yet: auth refresh, component paths, optimistic updates, paginated reactive
  sync, transition chunks, action-over-sync, and production reconnect polish.

### First Implementation Slice

1. Add `packages/flarex/src/sync/protocol.ts` with a client-side mirror of the
   current Flarex `/sync` messages, using Convex names.
2. Add `packages/flarex/src/sync/localState.ts` as a close Flarex port of
   Convex `LocalSyncState`, adapted for `partitionKey`.
3. Add a minimal `BaseFlarexClient` that opens a WebSocket, sends
   `ModifyQuerySet` and `Mutation`, ingests `Transition` and
   `MutationResponse`, and exposes local query results.
4. Extend `FlarexClient` with Convex-style live APIs while keeping existing
   HTTP invoke APIs:

```ts
const unsubscribe = client.onUpdate(
  api.lessons.list,
  args,
  result => {
    // result changed
  },
  error => {
    // query failed
  },
  { partitionKey: userId },
);

await client.mutation(api.lessons.complete, args, {
  partitionKey: userId,
});
```

5. Cover the slice with fake-WebSocket tests that assert exact protocol
   messages and local callback behavior.

### Current Planning Checkpoint

Previous completed checkpoint: `dbac8a6` Add mutation execution over sync.

This planning update promotes `npm-packages/convex/src/browser/sync` from
"future inspiration" to a concrete fork/refactor target for the next SDK slice.
The first code step should port the client state machine and public live-client
shape closely, while rewriting only the Flarex transport and explicit
partition-routing differences.

Verification:

```sh
git diff --check
```

## Watch Query API Update

Previous completed checkpoint: `04fc3cb` Default client mutations to sync
transport.

Added `FlarexClient.watchQuery()` as the primitive live-query API, matching
Convex's public watch shape:

```ts
const watch = client.watchQuery(api.lessons.list, { userId }, { partitionKey });

const unsubscribe = watch.onUpdate(() => {
  const result = watch.localQueryResult();
});
```

`watchQuery()` is inert until `watch.onUpdate()` is called, so creating a watch
does not open a WebSocket or modify the backend query set. The existing
value-callback `FlarexClient.onUpdate(...)` API now wraps `watchQuery()` instead
of owning separate subscription state.

Convex references:

- `npm-packages/convex/src/react/client.ts`
  - public `watchQuery()` returns a watch with `onUpdate()` and
    `localQueryResult()`.
- `npm-packages/convex/src/browser/sync/client.ts`
  - base sync client owns subscription registration and local query-result
    lookup.

Current differences from Convex:

- Flarex still requires explicit `partitionKey` in `watchQuery()` options until
  generated routing metadata can infer the shard route.
- Query tokens still include the partition route.
- `localQueryLogs()` is not implemented yet.
- React hooks are still pending; this checkpoint only adds the client primitive
  they can build on.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example build
```

## Last Update

Added generated model partition selectors to `_generated/server.ts`.

Checkpoint title: `Generate model partition selectors`

Previous completed checkpoint: `d70c486` Enforce partition owner uniqueness.

What changed:

- `flarex/server` function builders now accept `partition` alongside `route`.
- `packages/flarex-dev` initial codegen emits a permissive dynamic `model` so
  source analysis can evaluate function declarations before schema analysis is
  authoritative.
- Final codegen emits concrete schema-derived selectors:
  `model.users.byId(...)`, `model.teams.bySlug(...)`, and similar.
- Selectors return the existing `FunctionRoutePolicy`, so generated API
  references and client route inference continue using the same path as
  `routeFromArgs(...)`.
- Added generator coverage for `partition: model.teams.bySlug("teamSlug")`.

Convex references:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated SDK files are rebuilt from analyzed metadata.
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
  - generated server entrypoint exports typed function builders.
- `npm-packages/convex/src/server/registration.ts`
  - query/mutation declarations are the correct place to attach metadata.

Cloudflare difference:

- This is a Flarex-specific generated API because Cloudflare execution must
  select one `PartitionDO` before the function starts. Convex has no equivalent
  public routing selector.

Remaining limitations:

- The first selectors are route metadata only; they do not yet create scoped
  `ctx.db` table surfaces.
- The dynamic initial model is intentionally permissive until final backend
  analysis regenerates concrete selectors.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter @flarex/example generate
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

## Previous Update

Added `useQuery_experimental()` to the `flarex/react` entrypoint with
Convex-style object query state:

```ts
const lessons = useQuery_experimental({
  query: api.lessons.list,
  args: { courseId: "english" },
  partitionKey: userId,
});
```

It returns `pending`, `success`, or `error` states and supports
`throwOnError: true`.

Previous completed checkpoint: `81850e6` Add Convex-style React client hooks.

Convex references:

- `npm-packages/convex/src/react/client.ts`
  - `useQuery_experimental()` object-result contract and `throwOnError`
    behavior.

Current differences from Convex:

- `useQuery_experimental()` requires top-level `partitionKey` unless `args` is
  `"skip"`.
- It also accepts optional `journal` because Flarex watch options are
  explicitly routed for now.
- Next routing ergonomics step: add provider-level default `partitionKey` so
  user-sharded apps can write `useQuery(api.lessons.list, args)` and
  `await complete(args)` under `<FlarexProvider partitionKey={userId}>`.
- Later routing step: generated APIs infer routes from schema placement
  metadata when unambiguous.
- `useAction`, pagination, optimistic updates, auth helpers, connection state,
  hydration, and Next.js helpers are still pending.

Detailed notes are recorded in
[`18-react-client-hooks.md`](./18-react-client-hooks.md).

Validation:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example build
corepack pnpm --filter @flarex/example test
```

## Initial Sync Client Slice

Implemented the first Convex-style sync client slice in `packages/flarex`.
This ports the browser sync layering at a small scale:

- protocol mirror in `src/sync/protocol.ts`
- query-set state in `src/sync/localState.ts`
- base WebSocket client in `src/sync/baseClient.ts`
- public live option/unsubscribe types in `src/sync/simpleClient.ts`
- `FlarexClient.onUpdate(...)` in `src/client.ts`
- initial opt-in sync mutation via `mutation(..., { transport: "sync" })`,
  promoted to the default mutation transport in the following checkpoint

Previous completed checkpoint: `6ca1454` Plan Convex-style sync client port.

Convex references:

- `npm-packages/convex/src/browser/sync/protocol.ts`
- `npm-packages/convex/src/browser/sync/local_state.ts`
- `npm-packages/convex/src/browser/sync/client.ts`
- `npm-packages/convex/src/browser/simple_client.ts`

Current differences from Convex:

- Flarex still requires explicit `partitionKey` in live query and sync mutation
  options.
- Query tokens include the partition route.
- HTTP `/invoke` remained the default for `client.mutation()` in this initial
  slice. The next checkpoint changed the default to sync transport.
- The first base client has no auth refresh, reconnect/backoff manager,
  optimistic updates, paginated sync, action-over-sync, transition chunks, or
  connection-state subscriptions yet.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
```

## Initial SDK Package Update

Renamed the prototype `packages/flarex-client` package to the canonical
`packages/flarex` SDK and switched application imports to Convex-style package
entry points:

```ts
import { query, mutation } from "flarex/server";
import { v } from "flarex/values";
import { FlarexClient } from "flarex/browser";
```

Ported the core function-reference model inspired by:

- `npm-packages/convex/src/server/api.ts`
- `npm-packages/convex/src/server/functionName.ts`
- `npm-packages/convex/src/server/registration.ts`
- `npm-packages/convex/src/cli/codegen_templates/api.ts`

Flarex now provides `anyApi`, `makeFunctionReference`, `getFunctionName`,
`ApiFromModules`, typed function arguments and typed function returns. The
generator now emits an API proxy typed from application function modules,
instead of emitting untyped literal references.

Unlike Convex, Flarex references retain a serializable `_path`, and client
invocations still require an explicit `partitionKey`. This preserves the
Cloudflare shard routing contract rather than implying a deployment-wide
transaction boundary.

Also added the missing `.global()` table placement API. Full database query
builder types, CLI commands, React, Next.js, and sync transport remain
follow-up work. `packages/flarex/LICENSE.convex` preserves the upstream
Apache-2.0 license for selectively ported Convex SDK work.

## Typed Data Model Update

Implemented the next selective SDK-fork slice:

- Expanded `flarex/values` with Convex-style validator types and metadata:
  - `v.id`
  - `v.null`
  - `v.number` / `v.float64`
  - `v.int64`
  - `v.boolean`
  - `v.string`
  - `v.bytes`
  - `v.literal`
  - `v.array`
  - `v.object`
  - `v.record`
  - `v.union`
  - `v.optional`
  - `v.nullable`
  - `v.any`
- Added optional-field inference and validator JSON metadata.
- Changed `defineSchema` to return a typed `SchemaDefinition` containing
  authoritative table definitions and Flarex placement metadata.
- Added `DataModelFromSchemaDefinition`, `DocumentByName`,
  `TableNamesInDataModel`, and `WithoutSystemFields`.
- Typed `DatabaseReader` and `DatabaseWriter` from the generated data model.
- Added generic query, mutation, workflow mutation, and action builders.
- The generator now emits `_generated/dataModel.ts`.
- The generator now specializes `_generated/server.ts` builders and contexts
  with the application's generated `DataModel`.

This follows the shape of:

- `npm-packages/convex/src/values/validator.ts`
- `npm-packages/convex/src/values/validators.ts`
- `npm-packages/convex/src/server/schema.ts`
- `npm-packages/convex/src/server/data_model.ts`
- `npm-packages/convex/src/server/registration.ts`
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
- `npm-packages/convex/src/cli/codegen_templates/server.ts`

Flarex still differs by retaining `partitionBy`, `colocateWith`, `global`, and
projection definitions in schema metadata. The validator layer currently
exports metadata and types, but invoke-time argument/document validation is not
yet connected to the backend execution boundary. Broader query-builder
features beyond exact indexed equality are still pending.

## Query Builder Update

Implemented the first Convex-style database query-builder slice:

```ts
const progress = await ctx.db
  .query("lessonProgress")
  .withIndex("by_user", q => q.eq("userId", userId))
  .collect();
```

The generated data model now drives:

- valid table names
- valid index names
- required index-field order
- equality value types
- returned document types

Added lazy query construction and `collect`, `take`, `first`, and `unique`
consumers. The public shape follows:

- `npm-packages/convex/src/server/database.ts`
- `npm-packages/convex/src/server/query.ts`
- `npm-packages/convex/src/server/index_range_builder.ts`

Flarex now supports whole-index reads, partial equality prefixes, and typed
`gt`, `gte`, `lt`, and `lte` bounds on the next index field. The authoritative
backend resolves names through deployment schema metadata, compiles expressions
into ordered half-open bounds, and records the numeric index interval in the
transaction read set for OCC.

The query SDK now also provides Convex-style ordered cursor pagination:

```ts
const result = await ctx.db
  .query("scores")
  .withIndex("by_user_score", q => q.eq("userId", userId))
  .order("desc")
  .paginate({ numItems: 25, cursor });
```

`paginationOptsValidator`, `PaginationOptions`, and `PaginationResult` are
exported from `flarex/server`. Cursors are currently ordered index-key strings;
query fingerprint validation and reactive page splitting remain future work.

Verified with:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check -- custom/cloudflare-executor
```

## Generated WithIndex Runtime Contract

Previous completed checkpoint: `9b27ea9` Add indexed query syscall OCC.

What changed:

- Confirmed the app-facing `flarex` query builder already emits the Postgres
  executor indexed query request shape:
  - `{ table, index, range }` for `withIndex`,
  - `{ limit }` for `take`,
  - `{ cursor, limit }` for pagination,
  - `{ order }` only when `.order(...)` is called.
- Added a schema/data-model type assertion proving declared indexes flow into
  `DataModel`, which is what makes generated `ctx.db.query(table).withIndex(...)`
  type-safe.
- Aligned the local execution-artifact materializer's inline query builder with
  the shared SDK semantics by no longer sending an implicit `order: "asc"`.
- Added a materialized execution-artifact test that runs real user handler code:

```ts
await db
  .query("messages")
  .withIndex("by_lesson_text", q =>
    q.eq("lessonId", args.lessonId).eq("text", "hello")
  )
  .take(2);
```

and verifies the backend syscall body is:

```ts
{
  op: "query",
  request: {
    table: "messages",
    index: "by_lesson_text",
    range: {
      expressions: [
        { op: "eq", field: "lessonId", value: "1:lesson" },
        { op: "eq", field: "text", value: "hello" },
      ],
    },
    limit: 2,
  },
}
```

Why it changed:

The Postgres executor now accepts indexed query syscalls. The SDK/generation
side needed a recorded proof that Convex-style app code reaches that backend
contract without developers manually constructing syscall JSON.

Convex references:

- `npm-packages/convex/src/server/index_range_builder.ts`
  - chained `q.eq(...)` range construction.
- `npm-packages/convex/src/server/query.ts`
  - lazy query object with consumer methods like `collect` and `take`.
- `npm-packages/convex/src/cli/codegen_templates/dataModel.ts`
  - generated schema data model drives table/index names and document types.

Flarex differences:

- The local execution-artifact materializer still targets the legacy
  `/deployments/:deploymentId/executions/...` transport because it runs against
  the current `flarex-backend` harness.
- The Postgres executor transport is `/invoke/start`, `/invoke/syscall`, and
  `/invoke/finish`; moving generated execution artifacts to that route shape is
  a separate transport migration.

Known limitations:

- No generated standalone app Worker route migration to the Postgres executor
  adapter yet.
- No static placement-field requirement for colocated table index ranges yet.
- No reactive sync pagination/`watchQuery` integration for indexed pages yet.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
git diff --check
```

## Runtime Validator Update

The validator metadata exported by `flarex/values` is now executable through
`validateValue` and `validateFunctionArgs`. The generated standalone Worker
uses these helpers before user function execution and before document writes.

This follows Convex's separation between SDK validator declarations and backend
runtime enforcement, particularly:

- `crates/udf/src/validation.rs`
- `crates/model/src/modules/function_validators.rs`
- `crates/common/src/schemas/validator.rs`

Unlike Convex, the generated Worker currently imports the application schema
directly and validates writes locally. The authoritative Flarex backend also
validates at `PartitionDO.commit`; generated Worker storage remains a prototype
until it is replaced by the authoritative syscall/OCC path.

See `10-runtime-validation.md` for the complete contract, limitations, and
follow-up work.

## Function Metadata Generation

The generator now emits `_generated/functionMetadata.ts`. It imports the
application's registered functions and serializes:

- path
- kind
- visibility
- argument validator JSON
- return validator placeholder

The generated artifact is intended to be uploaded to:

```txt
PUT /deployments/:deploymentId/functions
```

This follows Convex's analyzed module metadata shape in:

- `crates/model/src/modules/module_versions.rs`
- `npm-packages/convex/src/cli/lib/deployApi/modules.ts`

Flarex does not yet run a full Convex-style analyzer. The current generator
uses the registered function objects directly, which is sufficient for typed
argument metadata but does not yet capture source positions or return
validators.

Return validators are now part of the registered function object:

```ts
export const complete = mutation({
  args: { lessonId: v.string() },
  returns: v.object({ completed: v.boolean() }),
  handler: async (ctx, args) => {
    return { completed: true };
  },
});
```

The generator serializes `fn.returns` into function metadata with
`validatorToJson`. This follows Convex's `returns` field in:

- `npm-packages/convex/src/server/registration.ts`
- `npm-packages/convex/src/server/impl/registration_impl.ts`

The registration type now also constrains the handler return when `returns` is
declared. For example, this is rejected by `tsc`:

```ts
mutation({
  args: {},
  returns: v.object({ ok: v.boolean() }),
  handler: () => ({ ok: "yes" }),
});
```

This follows Convex's `ReturnValueForOptionalValidator` and overloaded builder
pattern in `npm-packages/convex/src/server/registration.ts`. Runtime validation
remains authoritative, but common handler/validator mismatches are now caught
before deploy.

## Canonical ID Validation Update

The SDK validator runtime now accepts an optional ID resolver:

```ts
validateValue(v.id("users"), value, "$", {
  validateId: (tableName, id, path) => {
    // Runtime-specific table check.
  },
});
```

The generated Worker and authoritative backend both use this hook with numeric
table IDs. This keeps the SDK runtime portable while preserving Convex's
`v.id("table")` semantics.

The generator previously emitted standalone Worker storage code. It now emits
a Worker that calls backend execution sessions through a `FLAREX_BACKEND`
service binding. Generated Worker code imports:

```ts
import { createQueryInitializer, parseFlarexId } from "flarex/server";
```

Generated `ctx.db` operations no longer write to local Worker SQLite state.
They call:

```txt
/deployments/:deploymentId/executions/start
/deployments/:deploymentId/executions/:sessionId/syscall
/deployments/:deploymentId/executions/:sessionId/finish
```

The generated Worker still derives a deterministic table-id map from sorted
schema table names for local `v.id("table")` argument and return validation.
Deployment-owned table IDs from `DeploymentSchema.tables` remain authoritative
for backend validation and commits.

The example app now has an end-to-end test proving the generated Worker can use
the generated service-binding path against the backend execution session API.
This is not the final CLI deploy flow yet, but it verifies the generated
runtime contract:

- generated function metadata is accepted by the backend
- local generated validation rejects malformed IDs before `/executions/start`
- `ctx.db.insert` and `ctx.db.query(...).withIndex(...).collect()` cross the
  backend syscall API
- committed documents are read back through the authoritative backend index

Convex reference:

- `npm-packages/convex/src/server/registration.ts`
  - The developer-facing function and validator APIs stay portable and typed.
- `crates/common/src/schemas/validator.rs`
  - Backend ID validation resolves encoded IDs against schema/table metadata.

Cloudflare difference:

- Convex's analyzer and backend own the deployed table mapping. Flarex's
  generated Worker still performs local fast validation, but all data syscalls
  now route through the authoritative backend/OCC path.

## Generated Deployment Metadata Update

The generator now emits `_generated/deploymentSchema.ts` next to
`functionMetadata.ts`. It imports the developer schema, converts table
validators with `validatorToJson`, assigns deterministic table IDs from sorted
table names, assigns deterministic index IDs from sorted tables and declared
index order, and preserves Flarex placement metadata.

The generated Worker now exposes:

```txt
GET /__flarex_internal/metadata
```

returning:

```ts
{
  schema: deploymentSchema,
  functions: functionMetadata,
}
```

This gives the local dev runtime a generated metadata source instead of
manually duplicating schema/function conversion in the Vite plugin.

Convex reference:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Convex prepares generated files and writes them in dependency order so the
    app can be analyzed and typechecked consistently.
- `npm-packages/convex/src/cli/lib/components.ts`
  - Convex's push/codegen flow sends analyzed schema/function metadata to the
    backend as part of deployment.

Cloudflare difference:

- Convex analysis is backend-owned. Flarex currently generates deployment
  metadata in the generated Worker bundle and the local dev runtime reads it
  from an internal Worker route before deploying it to backend Durable Objects.

Verification:

```sh
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm typecheck
corepack pnpm test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex build
corepack pnpm --filter @flarex/example build
```

The deployable backend wrapper no longer runs Wrangler as its normal `build`.
Wrangler deployment validation is available through
`corepack pnpm --filter @flarex/backend deploy:dry-run`.

## App Wrangler Generation Cleanup

`generateFlarex` no longer writes `wrangler.generated.jsonc` by default.
Application projects are not required to be Wrangler Workers just to use
Flarex. The Vite plugin and future test SDK should own local Miniflare runtime
setup for app development and tests.

The old opt-in `generateWrangler: true` escape hatch and `workerName` option
have now been removed. In the Convex-like model, application code generation
emits typed bindings and runtime bundles for the Flarex platform/dev server; it
does not emit an app-owned Wrangler deployment config.

The application client should talk to either:

```txt
hosted Flarex deployment URL
local Flarex dev URL, e.g. /__flarex_dev
```

not to an app Wrangler Worker the developer has to deploy.

Convex reference:

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - Convex codegen emits generated TypeScript bindings for the application; it
    does not make the user's frontend app a backend deployment artifact.
- `npm-packages/convex/src/cli/lib/dev.ts`
  - Convex dev owns the local backend/deployment orchestration separately from
    frontend app bundling.

Cloudflare difference:

- Flarex still generates an app Worker bundle because user functions must run
  in a Cloudflare-compatible Worker runtime, but that bundle is owned by the
  Flarex dev/test/platform runtime, not by the user's app Wrangler config.
- Self-hosting should deploy the Flarex backend/platform Worker, not each
  individual application as its own generated Wrangler Worker.

Follow-up:

1. Make the generated client default to the Flarex hosted URL in production and
   the Vite/dev URL in development.
2. Keep Wrangler config only in the backend/platform deployment target.

Verification:

```sh
corepack pnpm --filter flarex-backend test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter @flarex/example generate
corepack pnpm typecheck
corepack pnpm test
corepack pnpm --filter flarex-backend build
corepack pnpm --filter flarex build
corepack pnpm --filter @flarex/example build
```

Confirmed `apps/example/wrangler.generated.jsonc` is not generated by default
after `generate` or `build`.

## Convex-Style Module Analysis And Two-Phase Codegen

The generator no longer discovers functions by scanning source text with
regular expressions. It now follows the same broad sequence as Convex:

```txt
discover function modules
  -> write initial generated dataModel/server/api files
  -> bundle and execute modules for analysis
  -> inspect actual registered function exports
  -> write final generated files in dependency order
  -> remove stale generated entries
```

`packages/flarex-dev/src/analyze.ts` uses Vite/Rollup to bundle the actual
developer modules, then inspects exported runtime values carrying the
`__flarexFunction` registration marker. This correctly handles named, aliased,
reexported, default, public, and internal function exports while ignoring
non-function helper exports.

Function entry-point discovery also ports Convex's relevant `entryPoints`
rules: it rejects reserved `_deps` content and skips `_generated`, schemas,
dotfiles, editor temp files, multi-dot test/spec files, spaced paths, unsupported
extensions, and TypeScript files without an import or export.

Final codegen emits a shared `_generated/functionRegistry.ts`. Both
`functionMetadata.ts` and the generated Worker import that registry, avoiding
two independently generated function maps.

Generated files are written in dependency order:

```txt
dataModel.ts
server.ts
api.ts
functionRegistry.ts
functionMetadata.ts
deploymentSchema.ts
worker.ts
```

### Convex References

- `npm-packages/convex/src/cli/lib/codegen.ts`
  - `doInitialComponentCodegen` writes enough generated code for module
    bundling and analysis.
  - `doCodegen` writes generated files in dependency order and removes stale
    generated entries.
- `npm-packages/convex/src/bundler/index.ts`
  - `entryPoints` defines which developer files become deployable function
    modules and which common support/test/generated files are skipped.
- `npm-packages/convex/src/cli/lib/components.ts`
  - `startComponentsPushAndCodegen` runs initial codegen before bundling and
    backend analysis, then runs final codegen from `StartPushResponse`.
- `npm-packages/convex/src/cli/lib/deployApi/modules.ts`
  - Defines Convex's serialized `AnalyzedModule` and `AnalyzedFunction` shapes.
- `crates/model/src/modules/module_versions.rs`
  - Defines the authoritative backend analyzed-module model.

### Cloudflare Difference

Convex sends bundled modules to its backend, where its isolate/runtime performs
authoritative analysis and returns analyzed modules for final codegen. Flarex
currently performs trusted local analysis inside the `flarex-dev` Node process
using Vite, then generates the Cloudflare Worker registry from those results.

### Known Limitations

- Analysis executes trusted developer module import-time code in the local
  Node/Vite process. Hosted deployment must eventually analyze inside the
  Dynamic Worker/isolate boundary.
- The analyzed model does not yet include source positions, serialized
  validators, HTTP routes, cron specs, module environment, or source maps.
- Stale cleanup currently removes every unknown `_generated` entry. Before
  supporting generated extensions, add an explicit preserved-entry policy like
  Convex's `PRESERVED_GENERATED_ENTRIES`.
- Final codegen does not yet consume an authoritative backend analysis response.

### Authoritative Push Direction

The next codegen change must not make developers write or deploy Worker code.
Developers continue writing ordinary modules under `flarex/`. Flarex tooling
will bundle those modules and send the source package to the Flarex backend.
The platform will create the internal Flarex-managed execution artifact,
analyze it inside a backend-controlled dynamic execution isolate, and return
authoritative analysis for final codegen.

The detailed Convex analysis, validation, `start_push`, and `finish_push` porting
plan is recorded in `roadmaps/17-deployment-analysis-and-push.md`.

### Verification

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter @flarex/example generate
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
git diff --check
```

The generator tests cover alias exports, reexports, internal functions, default
exports, ignored helper exports, the shared registry, stale cleanup, and the
absence of app Wrangler generation. Full workspace typecheck, tests, build, and
diff checks pass. No app `.flarex` persistence directory or generated Wrangler
configuration remains after verification.

## Static Final Metadata Codegen Update

Final codegen now emits `functionMetadata.ts` as static data derived directly
from analyzed modules. It no longer imports `functionRegistry.ts` or reads
runtime compatibility fields from registered function objects.

The generated Worker uses this analyzed metadata for validation and backend
execution-session requests. The function registry is limited to executable
handler resolution through `_handler`.

This follows Convex's split between initial codegen and analysis-informed final
codegen. Flarex still emits runtime metadata into the generated execution
artifact, while Convex persists authoritative analyzed metadata in its backend.

## Phased Generation And Source Package Update

Exposed explicit `initialCodegen`, `bundleFlarexSourcePackage`,
`analyzeSourcePackageLocally`, and `finalCodegen` APIs. `generateFlarex`
orchestrates them for compatibility.

This makes the current local development flow follow Convex's initial-codegen,
bundle, analyze, final-codegen ordering and gives future backend push logic a
serializable immutable artifact instead of requiring access to the developer's
filesystem.

The detailed source-package contract, Convex references, determinism rules,
differences, and tests are recorded in
`roadmaps/17-deployment-analysis-and-push.md`.

## Complete Deployment Analysis Update

`analyzeSourcePackageLocally()` now returns one complete deployment analysis
containing analyzed functions and analyzed schema. `finalCodegen()` consumes
that result rather than reading schema runtime objects from the developer
filesystem.

Generated runtime deployment schema and Worker table metadata are static
analysis outputs. Generated `dataModel.ts` still imports the developer schema
solely for TypeScript type inference.

## Architecture Terminology Cleanup

Previous completed checkpoint: `da42b4a` Add analysis import phase prelude.

Normalized SDK/CLI wording around deployment input. Flarex tooling sends the
`flarex/` source package to the backend; it does not bundle the developer's
whole app or require developers to deploy Worker code.

Verification:

```sh
git diff --check
```

## Source Position Metadata Codegen Update

Previous completed checkpoint: `c471b67` Gate analysis on cold isolate
consistency.

Final codegen now preserves optional analyzed function source positions in
`functionMetadata.ts`. This keeps generated metadata aligned with the backend
analysis response instead of dropping dev-tooling context after push analysis.

Convex reference:

- `crates/model/src/modules/module_versions.rs`
  - analyzed function metadata includes an optional source position.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final generated artifacts are produced from deployment analysis context.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
```

## Partition-Aware Generated API Update

Checkpoint title: `Infer client partition keys from partition metadata`

Previous completed checkpoint: `79d11ce` Require partition metadata for
execution.

Generated API references now carry partition metadata directly and SDK
partition-key inference uses `_partition`, not `_route`.

What changed:

- `FunctionReference` now includes optional `_partition` metadata.
- `createApi()` accepts analysis-derived reference metadata with both `route`
  and `partition`, while still reading old route-map values for compatibility.
- Final codegen writes `{ route, partition }` entries into `_generated/api.ts`.
- `FlarexClient`, React hooks, and `flarex-test` all use
  `reference._partition.argField` to derive the wire `partitionKey`.
- Route-only generated references no longer infer automatically. They require
  an explicit `{ partitionKey }`, and the backend will still require active
  partition metadata for normal execution.
- Example E2E now proves generated refs call without explicit partition
  options and report partition-validation errors for mismatched overrides.

Convex references:

- `npm-packages/convex/src/server/api.ts`
  - generated function references are the client-facing API handle.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated API files are based on analyzed function metadata.
- `npm-packages/convex/src/react/client.ts`
  - React hooks delegate routing/invocation to the client layer.

Flarex difference:

- Convex references do not need shard metadata. Flarex references carry
  `_partition` so the SDK can compute the `PartitionDO` transport key while the
  backend remains the authority.

Remaining SDK limitation:

- `_route` still exists as compatibility metadata and for old generated files,
  but it is no longer used for automatic partition inference.
- Explicit `{ partitionKey }` remains a low-level override, primarily for tests
  and future non-partition policies. Normal generated app calls should use
  `_partition`.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter flarex-test typecheck
corepack pnpm --filter flarex-test test
corepack pnpm --filter @flarex/example generate
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

## Partition Selector Metadata Update

Checkpoint title: `Preserve partition selector metadata`

Previous completed checkpoint: `63896da` Generate model partition selectors.

Final codegen now emits Convex-style generated model helpers that preserve
Flarex partition-selector metadata:

```ts
import { model, mutation } from "../_generated/server";

export const create = mutation({
  args: { teamSlug: v.string(), name: v.string() },
  partition: model.teams.bySlug("teamSlug"),
  handler: async ctx => {
    // runs through route metadata derived from teamSlug today
  },
});
```

The generated helper returns:

```ts
{
  type: "partition",
  table: "teams",
  selector: "bySlug",
  partitionField: "slug",
  argField: "teamSlug",
}
```

What changed:

- `_generated/server.ts` keeps `routeFromArgs` for compatibility and now
  exposes `model` helpers as first-class partition metadata producers.
- Generated selector return values use literal-preserving `as const` so
  TypeScript accepts them as `FunctionPartitionPolicy`.
- `functionMetadata.ts` includes both `route` and `partition`. Current
  generated clients still use `route` for partition-key inference.
- The dynamic initial-codegen `model` proxy uses the same metadata shape as
  final codegen so initial bundling and final TypeScript behavior agree.

Convex references:

- `npm-packages/convex/src/server/schema.ts`
  - schema definitions drive generated types and helpers.
- `npm-packages/convex/src/server/registration.ts`
  - function builders own the metadata contract.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated `_generated/server` and API files are analysis-informed.

Flarex difference:

- Convex table helpers do not expose shard selectors because Convex functions
  run against one logical transactional database. Flarex adds `model.table.byX`
  to make the selected `PartitionDO` explicit while keeping the normal
  query/mutation declaration shape familiar.

Remaining SDK limitation:

- The helper validates declaration metadata, but TypeScript does not yet infer
  a scoped `ctx.db` writer surface from `partition: model.table.byX(...)`.
- `partition` still lowers to route metadata for client calls; richer
  generated client behavior can come after scoped execution contexts exist.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter @flarex/example generate
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

## Route-Aware Generated API Update

Checkpoint title: `Add route-aware generated client inference`

Final codegen now emits generated API references through
`createApi(routeByPath)` instead of plain `anyApi`. The route map comes from
analyzed function metadata, so SDK calls can infer the partition key for
functions declared with:

```ts
export const list = query({
  args: { userId: v.id("users") },
  route: routeFromArgs("userId"),
  handler: async ctx => {
    // ...
  },
});
```

Normal client/test/React calls can now omit the explicit partition option:

```ts
await client.mutation(api.lessons.complete, { userId, lessonId: "intro" });
const lessons = useQuery(api.lessons.list, { userId });
await t.invokeRaw(api.lessons.list, { userId });
```

Convex reference:

- `npm-packages/convex/src/server/api.ts`
  - generated function references are the stable client-facing API surface.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final generated files consume analysis output rather than only filesystem
    shape.

Flarex difference:

- `_route` is Flarex-specific metadata needed to select a `PartitionDO`.
  Convex generated refs do not expose shard placement because Convex routes
  through one logical backend database.

Remaining SDK limitation:

- `anyApi` remains route-less and still requires explicit `{ partitionKey }`.
- Only exact `routeFromArgs(field)` inference is implemented.

## Implementation Checkpoints

### `601256a` Classify create-root partition analysis

Previous completed checkpoint: `14c303e` Prefer root model partitions in
example.

Raw deployment analysis now has a named create-root partition policy:

```ts
{
  type: "partitionCreateRoot",
  table: "users",
  partitionField: "_id",
}
```

This is produced for mutation/workflow declarations like:

```ts
export const create = mutation({
  partition: model.users,
  args: { name: v.string() },
  handler: async () => null,
});
```

Final codegen still rejects the policy because generated clients cannot infer a
partition key until the backend can preallocate the new root id before user
code starts.

Convex references:

- `npm-packages/convex/src/server/registration.ts`
  - function declarations carry typed metadata beside the handler.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - codegen consumes analysis output and should reject unsupported analyzed
    shapes before emitting generated files.
- `crates/model/src/modules/module_versions.rs`
  - analyzed module metadata is a backend-owned deployment contract.

Cloudflare difference:

- Convex inserts can allocate ids inside one global transaction. Flarex must
  route to a concrete `PartitionDO` before the handler runs, so root creation
  needs a backend preallocation step that does not exist yet.

Remaining limitations:

- `partitionCreateRoot` is analysis-only and not client-executable.
- Final codegen rejects create-root metadata with a preallocation error.
- Queries/actions without a required root id remain invalid for
  `partition: model.table`.

Verification:

```sh
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter @flarex/example generate
corepack pnpm --filter @flarex/example test
```

### `14c303e` Prefer root model partitions in example

Previous completed checkpoint: `40b9999` Infer existing root partitions from
model table.

The example app now uses the preferred v1 root model API for normal
single-root functions:

```ts
export const complete = mutation({
  partition: model.users,
  args: { userId: v.id("users"), lessonId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("lessonProgress", {
      userId: args.userId,
      lessonId: args.lessonId,
      completed: true,
    });
  },
});
```

Generated metadata is still selector-shaped after analysis, so the client,
test SDK, sync path, and backend invoke path continue to infer the partition
key from `args.userId`.

Convex references:

- `npm-packages/convex/src/server/registration.ts`
  - application functions keep compact declarations beside validators.
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
  - generated server APIs are the normal developer entrypoint.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - generated API metadata comes from analysis results.

Cloudflare difference:

- Convex does not expose placement metadata in app code. Flarex still needs a
  generated `model.users` marker so analysis can select the correct
  `PartitionDO` without making developers pass `{ partitionKey }` manually.

Remaining limitations:

- `.byId(...)` remains available for compatibility and explicit edge tests.
- Non-`_id` partition roots still use generated selectors such as
  `model.teams.bySlug("teamSlug")`.
- Create-root mutations still require backend id preallocation before
  `partition: model.users` can omit an existing root id.

Verification:

```sh
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex test
```

### `40b9999` Infer existing root partitions from model table

Previous completed checkpoint: `3bd5d77` Generate root model objects.

The generated `model.table` object is now accepted as a function `partition`
input for the existing-root case:

```ts
export const rename = mutation({
  args: { userId: v.id("users"), name: v.string() },
  partition: model.users,
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { name: args.name });
  },
});
```

The SDK records this as a root partition policy during registration, and
analysis lowers it to the existing selector metadata used by clients and the
backend:

```ts
{
  type: "partition",
  table: "users",
  selector: "byId",
  partitionField: "_id",
  argField: "userId",
}
```

Convex references:

- `npm-packages/convex/src/server/registration.ts`
  - function declarations keep handler metadata beside the handler value.
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
  - generated server helpers are the app-facing API, not hand-authored runtime
    wiring.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - final generated files are driven by backend/analyzer metadata.

Cloudflare difference:

- Convex does not expose shard placement through generated model helpers.
  Flarex accepts `model.table` only as a shorthand for selecting the root
  `PartitionDO` from one required root document id.

Remaining limitations:

- Create-root mode is deliberately rejected until backend id preallocation
  and root `PartitionDO` creation are implemented.
- `model.table` requires exactly one required `v.id(table)` argument.
- Tables partitioned by a field other than `_id` must still use the explicit
  selector form, for example `model.teams.bySlug("teamSlug")`.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter @flarex/example generate
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
corepack pnpm --filter @flarex/example build
```

### `772fce2` Refactor Flarex runtime and add Convex-style codegen

Separated reusable backend runtime, development tooling, test SDK, and
deployable wrapper packages; added Convex-style generated APIs and local
development behavior.

### Create-Root Generated Runtime Bridge

Previous completed checkpoint: `10c02a4` Run create-root execution sessions.

Generated code now treats `partition: model.<rootTable>` with no required root
id argument as executable create-root metadata instead of a codegen error.

Developer-facing API:

```ts
export const create = mutation({
  args: { name: v.string() },
  partition: model.users,
  handler: async (ctx, args) => {
    const userId = await ctx.db.insert("users", { name: args.name });
    return userId;
  },
});
```

What changed:

- final codegen preserves `partitionCreateRoot` in generated function metadata,
- generated API references expose create-root partition metadata,
- `FlarexClient.mutation(...)` omits `partitionKey` for create-root references
  and routes them over HTTP instead of sync,
- generated worker and materialized artifact runtime start backend execution
  sessions without a partition key when none is supplied, and
- dev invoke forwarding no longer forces a partition key before the backend can
  inspect active metadata.

Convex references:

- `npm-packages/convex/src/server/registration.ts`
  - user code keeps normal `mutation({ args, handler })` ergonomics.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
  - generated references carry metadata for client invocation.
- `crates/function_runner/src/lib.rs`
  - the backend controls function execution and storage access.
- `crates/isolate/src/environment/udf/syscall.rs`
  - user code uses database syscalls rather than a direct connection.

Cloudflare difference: Flarex still needs explicit partition metadata because
Cloudflare Durable Objects require a routing key. For create-root functions the
backend preallocates that key after the client call arrives, so the generated
client must deliberately omit `partitionKey`.

Remaining limitations:

- Historical note: this checkpoint was superseded by
  `1d239b1` Run create-root mutations over sync. Create-root mutations no
  longer need to force HTTP invoke; they can use sync without `partitionKey`.
- Create-root support is limited to `_id` partition roots and single-shard
  colocated writes.
- Cross-shard create flows still require the future workflow/atomic-mutation
  design.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex exec vitest run test/client.test.ts test/api.test.ts --maxWorkers=1
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/generate.test.ts --maxWorkers=1
corepack pnpm --filter flarex-dev exec vitest run test/executionArtifact.test.ts --maxWorkers=1
corepack pnpm --filter flarex-dev exec vitest run test/runtimeMaterializer.test.ts --maxWorkers=1
corepack pnpm --filter flarex-dev build
```

### Create-Root Sync Client Default

Previous completed checkpoint: `b5c9780` Enable create-root generated
execution.

The generated create-root client path now matches the normal Convex-style
mutation default more closely:

```ts
await client.mutation(api.users.create, { name: "Ada" });
```

For references carrying:

```ts
{
  type: "partitionCreateRoot",
  table: "users",
  partitionField: "_id",
}
```

the client sends a sync `Mutation` message without `partitionKey`. Existing-root
references still infer and send `partitionKey` from args, and explicit
`{ transport: "http" }` still forces HTTP invoke.

Convex references:

- `npm-packages/convex/src/browser/sync/client.ts`
  - mutations use the sync transport by default.
- `npm-packages/convex/src/browser/sync/protocol.ts`
  - mutation messages contain request id, function path, and encoded args.

Cloudflare difference: omitting `partitionKey` is valid only for create-root
metadata. The backend still validates active metadata before allowing execution
because Durable Object routing cannot be guessed for existing roots.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex exec vitest run test/client.test.ts --maxWorkers=1
```

### Create-Root Client Transport Hardening

Previous completed checkpoint: `1d239b1` Run create-root mutations over sync.

The client API now has regression coverage for both supported create-root
transports:

```ts
await client.mutation(api.users.create, { name: "Ada" });
await client.mutation(api.users.create, { name: "Ada" }, { transport: "http" });
```

Both paths omit `partitionKey` because generated references carrying
`partitionCreateRoot` tell the backend that it must allocate the root
partition. Existing-root references still infer `partitionKey` from generated
metadata and send it over the wire.

Convex references:

- `npm-packages/convex/src/browser/simple_client.ts`
  exposes the simple public `mutation()` API.
- `npm-packages/convex/src/browser/sync/client.ts`
  makes sync the normal mutation transport.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
  generated references are the stable public calling surface.

Cloudflare difference: Flarex generated references carry extra partition
metadata that Convex does not need. That metadata determines whether the
client sends an existing-root `partitionKey` or deliberately omits it for
create-root backend allocation.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex exec vitest run test/client.test.ts --maxWorkers=1
corepack pnpm --filter flarex build
```

### Remove Legacy SDK Route APIs

Previous completed checkpoint: `75b84c8` Remove direct deployment metadata
routes.

The public SDK no longer exposes the old route policy surface:

- `routeFromArgs(...)` is no longer generated or exported from
  `_generated/server.ts`.
- `FunctionReference` no longer carries `_route`.
- `makeFunctionReference(...)` and `createApi(...)` only use generated
  `_partition` metadata for routing inference.
- unpartitioned functions do not emit client metadata entries just to preserve
  route information.

The schema SDK also moved away from chain-based placement methods for the
public path:

```ts
definePartitionTable({ name: v.string() });
defineColocatedTable("users", "userId", { userId: v.id("users") });
defineGlobalTable({ message: v.string() });
```

This keeps app code closer to the current Flarex mental model: root tables are
Durable Object partitions, colocated tables live under a root partition, and
global tables are intentionally separate.

Convex references:

- `npm-packages/convex/src/server/registration.ts`
  function builders carry validators and execution metadata with the handler.
- `npm-packages/convex/src/cli/codegen_templates/api.ts`
  generated API references are the stable public call surface.
- `npm-packages/convex/src/cli/codegen_templates/server.ts`
  generated server files expose the app-facing builder APIs.

Cloudflare difference: Convex does not need generated partition metadata
because routing is hidden behind one logical transactional database. Flarex
keeps generated `_partition` metadata because the client/backend must route to
the correct `PartitionDO`, but it no longer exposes a second route API.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex build
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
corepack pnpm --filter flarex-dev build
corepack pnpm --filter @flarex/example typecheck
corepack pnpm --filter @flarex/example test
```

### Generated `ctx.db.replace`

Previous completed checkpoint: `0e3b118` Add invoke replace syscall.

What changed:

- Added `ctx.db.replace(id, value)` to the public `DatabaseWriter` and
  scoped `DatabaseWriterForTables` types.
- Generated Worker source now includes `replace` on its syscall-backed
  `ctx.db`.
- The local execution artifact materializer now exposes the same `replace`
  method to user functions.
- Added generation coverage that pins the generated Worker syscall body.

Convex references:

- `npm-packages/convex/src/server/database.ts`
  - `DatabaseWriter.replace` is part of the mutation writer surface.
- `npm-packages/convex/src/server/impl/database_impl.ts`
  - Convex forwards `replace` through a distinct backend syscall.

Flarex differences:

- Convex's replacement value type allows optional system fields. Flarex keeps
  this first slice aligned with its current insert/patch convention and accepts
  `WithoutSystemFields<Document>`.
- Convex's syscall name is `"1.0/replace"`. Flarex's executor syscall shape is
  `{ op: "replace", id, value }`.

Known limitations:

- Table-scoped writer helpers like `ctx.db.table("users").replace(...)` are
  not part of the current Flarex API surface.
- The generated scoped writer narrows writable tables, but deeper Convex-style
  table writer overloads remain future SDK parity work.

Verification:

```sh
corepack pnpm --filter flarex typecheck
corepack pnpm --filter flarex test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev test
git diff --check
```
