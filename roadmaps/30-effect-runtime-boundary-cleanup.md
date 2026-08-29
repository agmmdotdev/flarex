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

Production `Effect.runSync` occurrences by file: none.

Production `Effect.runPromise` occurrences are enforced by
`pnpm check:effect-boundaries`; new, removed, or moved production runtime
boundaries must update the audited call-site list in
`scripts/check-effect-boundaries.mjs`.

## Allowed Production `Effect.runPromise` Boundaries

G-7 audits the remaining production `Effect.runPromise` calls. The
allowed boundary categories are:

- Worker, Durable Object, WebSocket, Fetcher, alarm, and internal route
  adapters:
  - `packages/flarex-backend/src/worker.ts`
  - `packages/flarex-backend/src/executionDO.ts`
  - `packages/flarex-backend/src/connectionDO.ts`
  - `packages/flarex-backend/src/deliveryDO.ts`
  - `packages/flarex-backend/src/schedulerDO.ts`
  - `packages/flarex-backend/src/artifactRuntime.ts`
  - `packages/flarex-backend/src/deployment/InternalRouteBoundary.ts`
  - `packages/flarex-backend/src/registry/InternalRouteBoundary.ts`
  - `packages/flarex-backend/src/scheduler/InternalRouteBoundary.ts`
  - `packages/flarex-backend/src/partitionDO.ts`
- Public Promise-shaped backend and executor compatibility APIs:
  - `packages/executor/src/health.ts`
  - `packages/executor/src/sessions.ts`
  - `packages/flarex-backend/src/invoke.ts`
  - `packages/flarex-backend/src/transaction.ts`
  - `packages/flarex-backend/src/liveQueryDelivery.ts`
  - `packages/flarex-backend/src/artifactRuntime.ts`
- Cloudflare callback bridges that require Promise-returning callbacks:
  - `packages/flarex-backend/src/partitionDO.ts`
  - `packages/flarex-backend/src/deliveryDO.ts`
  - `packages/flarex-backend/src/schedulerDO.ts`
- Postgres driver and Drizzle transaction callbacks that require Promises:
  - `packages/persistence-postgres/src/postgresRuntime.ts`
  - `packages/persistence-postgres/src/stableTableCatalog.ts`
  - `packages/persistence-postgres/src/transactionSessionActivation.ts`
- Local development, analyzer, artifact materializer, executor HTTP, and
  backend push adapter APIs:
  - `packages/flarex-dev/src/analyze.ts`
  - `packages/flarex-dev/src/backendPush.ts`
  - `packages/flarex-dev/src/dev.ts`
  - `packages/flarex-dev/src/executionArtifact.ts`
  - `packages/flarex-dev/src/runtimeMaterializer.ts`
  - `packages/executor-http/src/liveQueryDelivery.ts`
  - `packages/executor-http/src/routeEffects.ts`

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
- [x] G-6. Clean live-query and remaining backend runtime collapses.
  - Convert live-query helper-level `runSync` to Effect composition.
  - Audit remaining `runPromise` calls and record which are true entrypoints.
  - Validation:
    - `corepack pnpm --filter flarex-backend typecheck`
    - live-query/delivery tests
    - `git diff --check`
- [x] G-7. Final enforcement and audit.
  - Add a repo-local enforcement script or documented command that fails on
    production `Effect.runSync`.
  - Check that the allowed `Effect.runPromise` boundary list does not drift.
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

Status: G-7 completed. Runtime-boundary cleanup goal is ready for final audit.

Previous completed checkpoint: `bd770d2` (`Remove live-query sync delivery
facades`).

What changed:

- Added `scripts/check-effect-boundaries.mjs` and the root
  `check:effect-boundaries` script.
- Added root `test:scripts` fixture coverage for generated `runSync`, local
  `Effect` aliases, local runtime destructuring, direct runtime imports, direct
  runtime import aliases, and `Effect.runPromise` / `Effect.runSync` property
  aliases.
- The enforcement script fails on any production `Effect.runSync` under
  `packages/**/src` source files, including generated worker source templates.
- The enforcement script fails when production `Effect.runPromise` call-site
  drift occurs against the audited allowlist.
- The enforcement script uses the TypeScript compiler API to detect Effect
  namespace aliases, runtime property aliases, and direct runtime imports from
  `effect` / `effect/Effect`.
- The audited `Effect.runPromise` list now covers backend, local dev/analyzer,
  executor, executor HTTP, and artifact materializer production source
  boundaries. The executor entries are the public `health()` Promise facade and
  the single session-lifecycle Promise bridge; internal session retry remains
  Effect-native.
- The Vite generated-directory watcher test asserts through the existing
  typecheck failure path, without adding private test hooks to the public plugin
  options type.

Verification:

```sh
corepack pnpm check:effect-boundaries
corepack pnpm typecheck:scripts
corepack pnpm test:scripts
corepack pnpm typecheck
corepack pnpm test
corepack pnpm --filter flarex-dev exec vitest run test/index.test.ts test/vite.test.ts --testTimeout=120000 --hookTimeout=120000 --maxWorkers=1
git diff --check
```
