# Effect Runtime Boundary Cleanup

This roadmap tracks the clean Effect runtime-boundary refactor. The goal is to
remove internal `Effect.runSync` helper/facade patterns instead of preserving
compatibility glue.

## Rule

Runtime execution belongs at the edge:

- `Effect.runPromise` is allowed at real async entrypoints: Worker `fetch`,
  Durable Object methods, CLI command boundaries, local dev server handlers,
  test boundaries, and explicitly awaited background tasks.
- `Effect.runSync` is not allowed in production helper/domain code.
- Internal APIs must prefer `Effect.Effect<A, E, R>` and compose with `yield*`.
- Sync wrappers over Effect helpers should be removed, not renamed or kept as
  compatibility layers.
- `Effect.sync(...)` is allowed when it suspends a synchronous side effect
  inside an Effect, such as generating an ID or mutating an internal staging
  map. It is not the target of this cleanup unless it hides domain failure
  handling.

## Current Inventory

Production `Effect.runSync` occurrences by file:

| Count | File | Treatment |
| ---: | --- | --- |
| 16 | `packages/flarex-backend/src/invoke.ts` | Convert domain helpers and validation branches to Effect-first composition. |
| 12 | `packages/flarex-protocol/src/deployment.ts` | Remove sync decoder exports and update internal callers/tests to use Effect decoders. |
| 8 | `packages/flarex-backend/src/partition/StorageRows.ts` | Remove `*Sync` JSON decode wrappers and make `PartitionDO` compose decoders through Effects. |
| 5 | `packages/flarex-protocol/src/registry.ts` | Remove sync decoder exports and keep Effect decoders as the only production API. |
| 4 | `packages/analysis/src/index.ts` | Remove sync analyzer conversion wrappers and update callers to use Effect exports. |
| 3 | `packages/flarex-backend/src/transaction.ts` | Remove sync mutation facades or restrict them to tests by converting test seeding to Effect helpers. |
| 3 | `packages/flarex-protocol/src/execution.ts` | Remove sync decoder exports and keep Effect decoders as the only production API. |
| 2 | `packages/flarex-backend/src/liveQueryDelivery.ts` | Convert live-query body/response helpers to Effect-returning functions. |
| 2 | `packages/flarex-dev/src/analyze.ts` | Remove sync analyzer facades; local dev callers use Effect APIs. |
| 1 | `packages/flarex-dev/src/backendPush.ts` | Remove helper-level `runSync` from protocol decode conversion. |
| 1 | `packages/flarex-protocol/src/invoke.ts` | Remove sync public invoke decoder. |

Production `Effect.runPromise` occurrences are reviewed separately. Most are
allowed async entrypoints, but each slice must re-check that no nested runtime
boundary remains inside reusable helpers.

## Implementation Slices

- [x] G-0. Create this concrete runtime-boundary cleanup roadmap and start the
  tracked goal.
- [x] G-1. Remove the newest dev/analyzer helper-level runtime collapses.
  - Convert `packages/flarex-dev/src/backendPush.ts` protocol decoding to stay
    inside Effect until the analyzer/HTTP boundary.
  - Remove sync analyzer conversion wrappers from `packages/analysis/src/index.ts`.
  - Update `packages/flarex-dev/src/backendPush.ts` and
    `packages/flarex-dev/src/analyze.ts` to use Effect exports directly.
  - Validation:
    - `corepack pnpm --filter @flarex/analysis typecheck`
    - `corepack pnpm --filter @flarex/analysis test`
    - `corepack pnpm --filter flarex-dev typecheck`
    - focused `flarex-dev` tests for analyzer/backend push
    - `git diff --check`
- [ ] G-2. Remove protocol sync decoder exports.
  - Delete sync wrappers from `flarex-protocol` deployment, registry,
    execution, and invoke modules.
  - Convert internal backend/dev/executor callers to `decode*Effect`.
  - Update protocol tests to assert Effect decoders directly.
  - Validation:
    - `corepack pnpm --filter flarex-protocol typecheck`
    - `corepack pnpm --filter flarex-protocol test`
    - affected backend/dev/executor typechecks
    - `git diff --check`
- [ ] G-3. Convert partition storage row decoding to Effect-first flow.
  - Delete `decodePartitionStorage*JsonSync` wrappers.
  - Thread typed storage decode errors through `PartitionDO` methods.
  - Preserve OCC/SQL semantics and storage row JSON formats.
  - Validation:
    - `corepack pnpm --filter flarex-backend typecheck`
    - focused partition/transaction tests
    - `git diff --check`
- [ ] G-4. Remove backend invoke domain-level `runSync`.
  - Convert exported sync helpers and private validation branches in
    `invoke.ts` to Effect-returning helpers.
  - Keep a single `runPromise` at request/runtime adapter boundaries.
  - Preserve invocation error mapping and partition validation behavior.
  - Validation:
    - `corepack pnpm --filter flarex-backend typecheck`
    - focused invoke tests
    - `git diff --check`
- [ ] G-5. Remove transaction sync mutation facades.
  - Replace `insert`, `replace`, and `delete` production/test callers with
    Effect helpers or async transaction helpers.
  - Keep developer-facing runtime DB APIs async where they already cross the
    invocation boundary.
  - Validation:
    - `corepack pnpm --filter flarex-backend typecheck`
    - transaction and invoke tests
    - `git diff --check`
- [ ] G-6. Clean live-query and remaining backend runtime collapses.
  - Convert live-query helper-level `runSync` to Effect composition.
  - Audit remaining `runPromise` calls and record which are true entrypoints.
  - Validation:
    - `corepack pnpm --filter flarex-backend typecheck`
    - live-query/delivery tests
    - `git diff --check`
- [ ] G-7. Final enforcement and audit.
  - Add a repo-local enforcement script or documented command that fails on
    production `Effect.runSync`.
  - Record allowed `Effect.runPromise` boundary files.
  - Run full relevant package validation and reviewers.

## Turn Protocol

Each turn should complete exactly one unchecked slice unless validation exposes
a small required fix.

1. Read this roadmap.
2. Confirm the next unchecked `G-*`.
3. Search current `Effect.runSync` and `Effect.runPromise` occurrences before
   editing.
4. Implement the slice without adding compatibility sync wrappers.
5. Tick the completed item and update the current checkpoint notes.
6. Run focused validation plus `git diff --check`.
7. For significant code/test changes, run both standing reviewers:
   - `typescript-diff-reviewer`
   - `code-quality-diff-reviewer`
8. Fix valid findings and commit the completed slice.

## Current Checkpoint

Status: G-1 completed. G-2 is next.

Previous completed checkpoint: `d05007a` (`Complete authoritative analysis
quality audit`).

What changed:

- Audited production `Effect.runSync` and `Effect.runPromise` usage and
  classified the cleanup into concrete slices.
- Removed analyzer-package sync conversion wrappers:
  `deploymentAnalysisFromCodegenAnalysis`,
  `backendCodegenAnalysisFromCodegenAnalysis`,
  `backendValidatorJsonFromValidatorJson`, and
  `backendRequiredValidatorJsonFromValidatorJson`.
- Exported and consumed Effect-first analyzer conversion helpers instead.
- Converted `packages/flarex-dev/src/analyze.ts` to run analyzer Effects only
  at its async local-analysis boundary.
- Converted `packages/flarex-dev/src/backendPush.ts` protocol analysis parsing
  to Effect-returning helpers, eliminating the helper-level `Effect.runSync`.
- Updated test fixtures to run the Effect-first helpers locally without
  restoring production sync exports.
- Resolved reviewer feedback by removing the temporary `flarex-dev`
  `backendAnalysisFromCodegenAnalysisEffect` alias and importing
  `deploymentAnalysisFromCodegenAnalysisEffect` directly from
  `@flarex/analysis` in tests.

Verification:

```sh
rg -n "Effect\\.runSync|backendAnalysisFromCodegenAnalysis\\(|backendCodegenAnalysisFromCodegenAnalysis\\(|backendRequiredValidatorJsonFromValidatorJson|deploymentAnalysisFromCodegenAnalysis\\(" packages/flarex-dev/src packages/analysis/src -g "*.ts"
corepack pnpm --filter @flarex/analysis typecheck
corepack pnpm --filter @flarex/analysis test
corepack pnpm --filter flarex-dev typecheck
corepack pnpm --filter flarex-dev exec vitest run test/backendPush.test.ts test/generate.test.ts test/runtimeMaterializer.test.ts test/backendSyncRuntime.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```
