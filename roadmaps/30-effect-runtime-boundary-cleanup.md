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
| 2 | `packages/flarex-backend/src/liveQueryDelivery.ts` | Convert live-query body/response helpers to Effect-returning functions. |

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
- [x] G-2. Remove protocol sync decoder exports.
  - Delete sync wrappers from `flarex-protocol` deployment, registry,
    execution, and invoke modules.
  - Convert internal backend/dev/executor callers to `decode*Effect`.
  - Update protocol tests to assert Effect decoders directly.
  - Validation:
    - `corepack pnpm --filter flarex-protocol typecheck`
    - `corepack pnpm --filter flarex-protocol test`
    - affected backend/dev/executor typechecks
    - `git diff --check`
- [x] G-3. Convert partition storage row decoding to Effect-first flow.
  - Delete `decodePartitionStorage*JsonSync` wrappers.
  - Thread typed storage decode errors through `PartitionDO` methods.
  - Preserve OCC/SQL semantics and storage row JSON formats.
  - Validation:
    - `corepack pnpm --filter flarex-backend typecheck`
    - focused partition/transaction tests
    - `git diff --check`
- [x] G-4. Remove backend invoke domain-level `runSync`.
  - Convert exported sync helpers and private validation branches in
    `invoke.ts` to Effect-returning helpers.
  - Keep a single `runPromise` at request/runtime adapter boundaries.
  - Preserve invocation error mapping and partition validation behavior.
  - Validation:
    - `corepack pnpm --filter flarex-backend typecheck`
    - focused invoke tests
    - `git diff --check`
- [x] G-5. Remove transaction sync mutation facades.
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

Status: G-5 completed. G-6 is next.

Previous completed checkpoint: `220c81a` (`Remove invoke sync helper facades`).

What changed:

- Removed `SingleShardTransaction.insert`, `replace`, and `delete` sync
  facades from `packages/flarex-backend/src/transaction.ts`.
- Kept Effect mutation helpers as the direct transaction write API.
- Kept developer-facing runtime DB APIs async at the invocation boundary.
- Updated transaction, invoke, and execution tests to run
  `insertEffect`/`replaceEffect`/`deleteEffect` at test boundaries.
- Reconfirmed production `Effect.runSync` remains only in
  `packages/flarex-backend/src/liveQueryDelivery.ts`.
- TypeScript and code-quality reviewers reported no findings for this slice.

Verification:

```sh
rg -n "Effect\\.runSync|\\b(insert|replace|delete)\\(tableId|\\b(insert|replace|delete)\\(.*\\):" packages/flarex-backend/src/transaction.ts
corepack pnpm --filter flarex-backend typecheck
corepack pnpm --filter flarex-backend exec vitest run test/transaction.test.ts test/invoke.test.ts test/executionDO.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
corepack pnpm --filter flarex-backend exec vitest run test/partitionFlow.test.ts test/partitionRouteBoundary.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```
