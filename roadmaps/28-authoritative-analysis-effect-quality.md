# Authoritative Analysis Effect Quality

This roadmap tracks the next core implementation stream after execution
artifact lifecycle parity: make deployment analysis backend-authoritative while
raising the Effect code quality bar around analyzer, push, and activation
boundaries.

## Current Diagnosis

The local execution artifact analyzer in
`packages/flarex-dev/src/executionArtifact.ts` currently embeds a large
generated worker source string. That worker performs real semantic work:

- imports the developer execution and schema modules inside Miniflare,
- extracts schema, function, validator, source position, and partition
  metadata,
- blocks import-time side effects such as `fetch`, random UUIDs, and
  nondeterministic time,
- normalizes diagnostics and returns analysis to the dev push pipeline.

The backend has already moved toward an authoritative hosted shape:

- public `POST /push` sends the source package to `FLAREX_ANALYZER`;
- analyzer responses are decoded and semantically validated before storage;
- artifact storage recomputes deterministic artifact refs from source packages;
- finish-push verifies artifact availability before activation.

The remaining quality gap is that the semantic analyzer logic is not shared in
a typed, reviewable module. The local analyzer string and hosted analyzer path
can drift, and the internal `/push/start-analyzed` route still represents a
prototype trust boundary that must be protected or removed from normal hosted
production flow.

## Target Architecture

The target is a Convex-shaped source package lifecycle:

```txt
developer source
  -> source package
  -> backend-controlled analyzer
  -> validated deployment analysis and codegen analysis
  -> durable deployment metadata
  -> runtime invocation consumes active analyzed metadata
```

Local dev may run the same analyzer implementation for fast feedback, but local
analysis is not hosted authority. Hosted deployment metadata must come from a
backend-controlled analyzer or from explicitly trusted internal test/platform
plumbing.

## Effect Quality Bar

Every implementation slice in this stream must satisfy these rules:

- Analyzer failures are typed with tagged errors at the first failing boundary.
- Recovery uses `Effect.catchTag` or `Effect.catchTags` for known domain
  failures; broad `catchAll` belongs only at adapter response boundaries.
- Public route handlers keep one runtime boundary per Worker/DO/adapter
  entrypoint.
- Reusable Effect functions use `Effect.fn("Qualified.name")`.
- Schema decoders and Effect Schema compiler calls are hoisted, not rebuilt in
  hot request paths.
- No client-provided deployment analysis is trusted as hosted authority.
- `ValidatorJson` remains the user validation format. Effect Schema validates
  transport, route, service, and persisted metadata around it.
- Shared analyzer code must not depend on Miniflare, R2, Durable Objects, or
  Cloudflare bindings. Host adapters own those mechanics.
- No explicit `any`, weak assertions, or duplicated public contract shapes.
  Use `unknown`, Effect Schema decoders, `satisfies`, and existing exported
  types instead.

## Implementation Slices

- [x] A-0. Create this concrete authoritative-analysis roadmap and matching
  goal checklist.
- [x] A-1. Audit current analyzer and Convex deployment analysis references,
  then freeze the exact shared analyzer contract.
  - Decide whether the shared code lives in a new `@flarex/analysis` package
    or an existing package.
  - Identify which logic is pure analyzer semantics versus host adapter code.
  - Record source files, exported types, error tags, and test fixtures.
- [x] A-2. Extract pure analyzer semantics into the shared analyzer module
  without changing runtime behavior.
  - Move schema analysis, function export analysis, validator JSON assertion,
    partition validation/lowering, source-position parsing, and diagnostics
    normalization behind typed functions.
  - Add Node-level unit tests for valid analysis, invalid validators,
    partition errors, diagnostics limits, source-map positions, and
    nondeterminism-sensitive metadata.
- [x] A-3. Refactor the local Miniflare analyzer worker to call the shared
  analyzer semantics.
  - Keep Miniflare creation, module loading, console capture, deterministic
    globals, and rejected import-time globals as local analyzer host mechanics.
  - Keep behavior-compatible local push/codegen tests.
- [x] A-4. Make the backend analyzer response path prove it is consuming the
  same shared analyzer contract.
  - Decode analyzer success envelopes and diagnostics through shared analyzer
    helpers.
  - Verify normalized analyzer success payloads against the shared protocol
    analysis/codegen contract.
  - Keep backend-local failure mapping and deployment semantic validation in
    the backend adapter.
  - Preserve current `/push` response behavior.
- [x] A-5. Protect or remove normal public trust in `/push/start-analyzed`.
  - Treat direct analyzed-start traffic as internal platform/test plumbing.
  - Add the smallest enforceable guard for hosted production, or move tests to
    an internal-only dispatch path before removal.
  - Keep local dev usable through the source-only push path or an explicitly
    trusted local harness.
- [ ] A-6. Add forged-analysis and source/analysis mismatch tests.
  - Prove public clients cannot activate analysis that was not produced by the
    backend analyzer path.
  - Prove mismatched source package, schema, function metadata, or codegen
    analysis is rejected before activation.
- [ ] A-7. Align local dev codegen and deploy with authoritative backend
  analysis where a backend is configured.
  - Local-only mode may still analyze locally for speed.
  - Backend deploy mode must consume backend-returned `codegenAnalysis` for
    final generated files.
- [ ] A-8. Final audit and cleanup.
  - Confirm no duplicate analyzer semantic helpers remain outside the shared
    analyzer module.
  - Confirm remaining string-generated worker code is only a host adapter shell.
  - Confirm all relevant Effect quality gates and reviewers pass.

## Turn-By-Turn Loop

Every turn in this goal should do exactly one unchecked slice unless validation
or reviewer feedback exposes a small required fix.

1. Read this file and
   `roadmaps/29-authoritative-analysis-effect-quality-goals.md`.
2. Confirm the next unchecked item.
3. Inspect the relevant Convex source files before designing the patch.
4. Implement the slice with typed Effect boundaries and focused tests.
5. Update both roadmap files:
   - tick completed items;
   - record files changed;
   - record previous completed checkpoint commit when known;
   - record Convex references and Cloudflare differences;
   - record validation commands.
6. Run focused package validation plus `git diff --check`.
7. For significant code/test changes, run both standing reviewers:
   - `typescript-diff-reviewer`
   - `code-quality-diff-reviewer`
8. Fix valid findings, rerun validation, and commit the completed slice.

Docs-only checklist updates do not require reviewer subagents.

## Convex References To Start From

- `crates/application/src/deploy_config.rs`
  - `finish_push`, source package fetch, and server-side analysis before
    committed deployment metadata.
- `crates/application/src/application_function_runner/mod.rs`
  - backend-owned analyze path and runtime execution consuming active metadata.
- `crates/isolate/src/environment/analyze.rs`
  - isolate analysis environment and extraction of analyzed functions/routes.
- `crates/model/src/modules/mod.rs`
  - analyzed module metadata is required and stored with modules.
- `crates/model/src/modules/module_versions.rs`
  - analyzed function metadata, validator strings, source positions, and module
    version metadata.
- `crates/udf/src/validation.rs`
  - runtime path, visibility, args, and return validation use stored analyzed
    metadata.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - codegen is produced from analysis results.
- `npm-packages/convex/src/server/impl/registration_impl.ts`
  - function registration exports metadata that analysis reads.

## Cloudflare Difference

Convex can run analysis and persist module metadata inside its integrated Rust
backend. Flarex must split this across Workers, service bindings, Durable
Objects, R2, Miniflare, and Dynamic Worker-like execution artifacts.

That difference does not change the authority rule. It only changes the host
adapter:

- local host adapter: Miniflare plus local file watching and fast feedback;
- hosted analyzer adapter: backend-controlled service binding or managed
  Dynamic Worker analyzer;
- deployment adapter: Durable Object push state plus R2 artifact storage;
- runtime adapter: active deployment metadata plus artifact runtime invocation.

The shared analyzer semantics must sit below those adapters.

## Analyzer Contract Audit

Previous completed checkpoint: `7b14f30` (`Plan authoritative analysis Effect
quality goal`).

What changed:

- Audited the current local analyzer, hosted analyzer response path, protocol
  contracts, backend deployment validation, and Convex analysis references.
- Froze the shared analyzer package-boundary decision and the semantic contract
  for A-2 extraction.
- Identified the exact duplicated analyzer surfaces that must converge before
  production trust-boundary hardening begins.

### Current Flarex Surfaces

| Surface | Current role | A-2/A-3 treatment |
| --- | --- | --- |
| `packages/flarex-dev/src/analyze.ts` | Typed local analyzer semantics for Vite-loaded modules and source packages. | Becomes the primary source for extracting shared semantics. File-scanning and Vite bundling remain in `flarex-dev`. |
| `packages/flarex-dev/src/executionArtifact.ts` | Miniflare execution-artifact analyzer host plus duplicated analyzer semantics inside `analysisWorkerSource(...)`. | Keep Miniflare, deterministic globals, console capture, rejected globals, and response decoding here; replace duplicated semantic functions with shared analyzer calls. |
| `packages/flarex-dev/src/backendPush.ts` | Local and HTTP analyzer adapters; local analyzer double-runs cold artifacts to reject nondeterministic analysis; local analyzer service returns backend-shaped `analysis` plus `codegenAnalysis`. | Keep transport/adapters here; move codegen-to-backend analysis conversion to shared analyzer package or protocol-adjacent helpers. |
| `packages/flarex-backend/src/backendAnalyzerResponse.ts` | Public Worker calls `FLAREX_ANALYZER`, decodes analyzer response, and validates it through deployment validation. | Keep service-binding fetch and public dispatch error mapping here; consume shared analyzer response/analysis validation helpers. |
| `packages/flarex-backend/src/deployment/Validation.ts` | Backend semantic validation for source package, deployment analysis, codegen analysis, and partition consistency. | Keep backend activation/persistence validation here; deduplicate conversion and shared analyzer output validation where portable. |
| `packages/flarex-protocol/src/deployment.ts` | Effect Schema transport contracts for source packages, deployment analysis, codegen analysis, and analyzed start-push envelopes. | Remains the transport schema owner. Shared analyzer should use these exported types/decoders rather than duplicating shapes. |
| `packages/flarex-backend/src/worker.ts` | Public `/push` uses `FLAREX_ANALYZER`; public `/push/start-analyzed` still forwards direct analyzed payloads. | A-5/A-6 will protect or remove public trust in direct analyzed-start after the shared analyzer contract is in place. |

### Package-Boundary Decision

A-2 should introduce a new shared package:

```txt
packages/analysis
name: @flarex/analysis
```

Rationale:

- `flarex-backend` must not depend on `flarex-dev`; local tooling is not
  production authority.
- `flarex-dev` should not import analyzer semantics from `flarex-backend`;
  that would blur host adapter ownership and make local tooling backend-shaped.
- `flarex-protocol` should remain a transport-schema package, not a module
  evaluation/analyzer package.
- The public `flarex` SDK should keep developer-facing registration,
  validators, client APIs, and artifact refs; analyzer internals are platform
  tooling, not public app code.

The shared package should depend only on:

- `effect` for tagged errors and Effect helpers,
- `flarex` for `ValidatorJson`/validator assertion semantics,
- `flarex-protocol` for deployment analysis/source package transport types.

It must not depend on `miniflare`, `vite`, `flarex-dev`, `flarex-backend`,
Durable Objects, R2, Worker bindings, or test harnesses.

### Shared Analyzer Contract

The shared package should expose semantic helpers that operate after a host has
loaded user modules:

```ts
type LoadedExecutionModules = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

type AnalyzerSourceMapInput = Readonly<Record<string, string>>;

type AnalyzeLoadedSourcePackageInput = {
  readonly executionModules: LoadedExecutionModules;
  readonly schemaDefinition: unknown;
  readonly sourceMaps: AnalyzerSourceMapInput;
};

type AnalyzeLoadedSourcePackageSuccess = {
  readonly analysis: DeploymentAnalysis;
  readonly codegenAnalysis: DeploymentCodegenAnalysis;
};
```

The shared package should also expose these smaller typed helpers:

- `analyzeSchemaDefinitionEffect(...)`
- `analyzeExecutionModulesEffect(...)`
- `validateAndLowerFunctionPartitionsEffect(...)`
- `deploymentAnalysisFromCodegenAnalysis(...)`
- `sourcePositionResolverFromSourceMaps(...)`
- `normalizeAnalyzerDiagnostics(...)`

Host adapters stay responsible for:

- source-package bundling and file discovery;
- Vite, Miniflare, or Dynamic Worker materialization;
- importing the execution and schema modules;
- deterministic import-time globals and rejected globals;
- console capture and diagnostic collection;
- service-binding fetch, HTTP route handling, and response mapping;
- local double-run nondeterminism checks.

### Output Semantics

The shared analyzer output is authoritative only when invoked by the hosted
backend-controlled analyzer path. Local dev can use the same semantics for
speed and parity, but hosted activation must not trust local output by default.

The semantic output must preserve:

- schema version `1` until the deployment store owns real schema versioning;
- sorted tables and indexes with deterministic generated IDs;
- table validators as `ValidatorJson`, requiring object validators for table
  documents;
- default table placement `{ kind: "partitionBy", field: "_id" }`;
- function kind from exactly one of `isQuery`, `isMutation`,
  `isWorkflowMutation`, or `isAction`;
- function visibility from exactly one of `isPublic` or `isInternal`;
- handler validation via `_handler` or direct function export;
- `exportArgs()` defaulting to `v.any()` and requiring object or `any`;
- `exportReturns()` defaulting to `null`;
- `exportPartition()` validation and root-model lowering into executable
  `partition` or `partitionCreateRoot` metadata;
- source positions from source maps when available;
- diagnostics capped to the latest 100 entries.

### Typed Error Contract

A-2 should model analyzer failures as tagged errors at source:

| Error tag | Failure class | Example source |
| --- | --- | --- |
| `AnalyzerSchemaError` | Schema export or table/index/placement metadata is invalid. | Invalid schema default export, non-object document validator, invalid index fields. |
| `AnalyzerFunctionMetadataError` | Function export markers, visibility, or handler shape is invalid. | Multiple kind markers, missing visibility, non-function handler. |
| `AnalyzerValidatorError` | `exportArgs()`/`exportReturns()` returned invalid JSON or invalid `ValidatorJson`. | Bad JSON, unknown validator type, non-object args validator. |
| `AnalyzerPartitionError` | Partition metadata cannot be validated or lowered against schema. | Unknown partition table, non-partitioned table, ambiguous root ID args. |
| `AnalyzerSourceMapError` | Source-map parsing failed when strict parsing is required. | A future strict host may reject malformed source maps; local parity may continue to ignore bad maps until behavior is intentionally changed. |
| `AnalyzerHostImportError` | Host failed to import execution/schema modules. | Owned by host adapters, not pure semantics, but should map into analyzer response diagnostics. |
| `AnalyzerNondeterministicError` | Two cold analyzer runs produced different semantic output. | Owned by `LocalExecutionArtifactBackendAnalyzer` unless hosted analyzer later adds the same gate. |

Known semantic validation failures should be `Effect.fail(...)`. Unexpected
impossible states may remain defects. Adapter response mapping should convert
typed analyzer failures to current HTTP response shapes.

### Required Fixtures Before Code Movement

A-2 should add focused tests for the shared package before changing the
Miniflare worker:

- valid schema plus query/mutation/action/workflow metadata;
- invalid schema default export;
- invalid table validator and invalid index metadata;
- ambiguous function kind and ambiguous visibility skipped or rejected with the
  current behavior preserved;
- invalid `exportArgs()`, `exportReturns()`, and `exportPartition()` shapes;
- root-model partition lowering for existing-root and create-root mutations;
- query root-model partition without a required ID rejected;
- ambiguous multiple root IDs rejected;
- source-position extraction from source maps;
- diagnostics normalization and 100-entry cap;
- conversion between grouped codegen analysis and flattened backend
  deployment analysis.

Behavioral compatibility requirement: tests must first prove the shared
package matches `packages/flarex-dev/src/analyze.ts` and the current
`LocalMiniflareExecutionArtifactAdapter` output for representative source
packages before A-3 removes duplicated worker-string logic.

### Convex References Inspected

- `crates/application/src/deploy_config.rs`
  - `finish_push(...)` downloads uploaded source packages and applies analyzed
    component definitions in the backend transaction.
  - `evaluate_app_push(...)` uploads the source package, then runs analyze to
    validate modules before returning push metadata.
- `crates/application/src/application_function_runner/mod.rs`
  - `analyze(...)` dispatches isolate and Node analysis and merges analyzed
    module results.
- `crates/isolate/src/environment/analyze.rs`
  - `AnalyzeEnvironment::analyze(...)` imports/evaluates modules in the
    controlled isolate and extracts UDFs, HTTP routes, crons, source positions,
    validators, kind, and visibility.
- `crates/model/src/modules/mod.rs`
  - non-dependency modules require `AnalyzedModule`, and runtime lookups read
    stored `analyze_result`.
- `crates/udf/src/validation.rs`
  - runtime path, kind, visibility, args, and return validation consume stored
    analyzed function metadata.
- `npm-packages/convex/src/cli/lib/codegen.ts`
  - initial generated files make code analyzable; final generated files depend
    on backend analysis results.
- `npm-packages/convex/src/server/impl/registration_impl.ts`
  - function builders attach `exportArgs`, `exportReturns`, visibility, and
    handler metadata that backend analysis reads.
- `npm-packages/convex/src/cli/lib/deployApi/modules.ts`
  - deploy API analysis metadata includes analyzed function name, UDF type,
    visibility, args, returns, and source position.

### Cloudflare Difference

Convex persists analyzed module metadata in its backend model layer and later
validates runtime invocation against that stored metadata. Flarex must split the
same authority across a Worker service-binding analyzer, Durable Object push
state, R2 execution artifact storage, and local Miniflare tooling.

The target difference is adapter-only: Flarex may use Miniflare locally and
Dynamic Worker/service bindings hosted, but both must call the same shared
semantic analyzer. The public developer model remains source-only push; direct
analyzed-start remains prototype/internal until A-5 hardens it.

Known limitations:

- This checkpoint is still docs-only. It does not create `@flarex/analysis`,
  move analyzer code, or protect `/push/start-analyzed`.
- Current generated worker code still embeds duplicate semantic analyzer logic.
- Current local and hosted analyzer envelopes still use existing response
  shapes.

Verification:

```sh
git diff --check
```

## Current Checkpoint

Previous completed checkpoint: `9e89cad` (`Share backend analyzer response
contract`).

What changed in this checkpoint:

- Added `FLAREX_ANALYZED_START_TOKEN` and a typed
  `PublicAnalyzedStartAuthorizationError` guard for public direct
  `/push/start-analyzed` traffic.
- The public Worker rejects direct analyzed-start requests before JSON parsing
  unless the caller sends `Authorization: Bearer <token>`.
- Backend-owned source-only `/push/start` still uses `FLAREX_ANALYZER`, stores
  the analyzed source artifact, and forwards to the DeploymentDO internal
  start-analyzed route without requiring the public direct-route token.
- Test and local-dev harnesses now opt into the prototype/internal path through
  an explicit test bearer token.

Known limitations:

- The route still exists as internal/prototype plumbing for tests and trusted
  platform callers. Full forged-analysis and source/analysis mismatch
  assertions remain A-6.
- A future cleanup may remove the public route entirely once all dev and
  platform flows use source-only push or internal service dispatch.

Convex references:

- No new Convex files were needed beyond the A-1 audit. This slice continues
  the Convex-shaped boundary where analyzed deployment metadata is backend
  authority, not a normal public client input.

Cloudflare difference:

- Hosted analyzer output still flows through Worker service bindings and
  Durable Object push state.
- Direct analyzed-start traffic is now visibly outside the normal hosted public
  developer path and must be explicitly authorized.

Verification:

```sh
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter @flarex/analysis test
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/publicAnalyzedStartAuthorization.test.ts test/push.test.ts -t "public analyzed start authorization|keeps public start source-only|rejects malformed analyzed push request bodies" --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend test
git diff --check
```
