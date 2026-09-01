# Flarex Monorepo Merge and pnpm Migration

Status: Isolated pnpm conversion complete in the Medusa fork. Flarex repo
movement remains deferred.

This records the staged plan for moving this Medusa Cloudflare fork into the
Flarex monorepo at:

`C:\Users\Admin\Documents\github\convex-backend\custom\cloudflare-executor`

The package-manager conversion has now been tested as its own slice in this
repo. The repo move should still not happen until a separate Flarex placement
slice is planned and validated.

## Goal

Eventually connect the Medusa Cloudflare fork to the Flarex multitenancy
platform and database runtime while preserving the current in-place Medusa
refactor strategy.

The merged shape should allow Flarex to own platform-level concerns:

- tenant/deployment routing
- Durable Object partition addressing
- D1/database binding resolution
- worker/runtime composition
- hosted programmable app integration

Medusa should still own commerce behavior:

- module services
- workflows
- HTTP handlers
- integration assertions
- commerce invariants

## Current State

The Medusa fork now uses pnpm in isolation:

- `pnpm-workspace.yaml` owns workspace discovery.
- `pnpm@11.7.0` and Node 24 are the package-manager/tooling baseline.
- The first pnpm layout uses `nodeLinker: hoisted` plus focused root
  `workspace:*` compatibility links for Medusa packages.
- All 409 dependency edges between active local packages use `workspace:*`,
  enforced by `pnpm check:workspace-dependencies`.
- Raw local npm publishing and the repository's pinned Yalc patch resolve
  workspace specifiers before creating contributor-facing packages.
- Yarn lock/config/release/plugin ownership has been removed.
- Cloudflare and Medusa pnpm gates passed in this repo before any Flarex move.

See [`../fork-changes/package-management.md`](../fork-changes/package-management.md)
for the implementation record and validation list.

A separate Jest-to-Vitest preparation stream is now planned in
[`jest-to-vitest-migration-goal.md`](./jest-to-vitest-migration-goal.md) and
[`jest-to-vitest-turn-tracker.md`](./jest-to-vitest-turn-tracker.md). It may run
before the repo move as a sequence of committed green checkpoints, but it must
not be combined with repo movement, catalogs, package privacy, or Flarex
runtime integration. The move baseline must be re-recorded from whichever
runner checkpoint is current when the move begins.

## Risk

This repo is now a pnpm workspace. The Flarex repo is also a pnpm workspace,
but it uses its own catalogs and workspace command surface.

Merging the repos is still risky because failures would be hard to attribute if
repo movement, shared catalogs, and runtime integration happen together.
Breakage could come from:

- hoisting and peer dependency differences
- workspace glob differences
- scripts that assume a smaller workspace command surface
- generated package output expectations
- Medusa package dependency ranges
- shared tooling versions such as TypeScript, Vite, Vitest, and Zod
- Flarex recursive commands accidentally running over the full Medusa fork
- Turbo 1.13.4 failing to construct a pnpm 11 workspace graph, which currently
  makes a clean concurrent root build nondeterministic

The remaining migration must stay staged.

## Recommended Sequence

### 1. Keep This Fork Independent Until the Move Slice

The pnpm conversion is complete in isolation. Do not start Flarex runtime
integration in this repo as part of package-manager cleanup.

Before the move slice, make the clean root build deterministic under pnpm 11.
The current Turbo version cannot parse pnpm 11's patched-dependency lock shape
and can run dependent package builds out of order.

### 2. Move Into the Flarex Monorepo

After pnpm works in isolation, move the fork into the Flarex monorepo.

Preferred placement should be isolated, for example:

- `vendor/medusa`
- `packages/medusa-fork`
- another explicit workspace boundary that avoids accidental broad recursive
  command execution

Avoid placing every Medusa package directly under the same broad Flarex
`packages/*` command surface unless Flarex scripts are filtered carefully.

### 3. Revalidate After the Move

After the repo move, rerun the same pnpm Medusa fork gates from the isolated
conversion before changing catalogs or runtime integration.

Any failure should be recorded as a move/package-manager migration issue, not
mixed with runtime refactor work.

### 4. Introduce Shared Catalogs Gradually

After the merge, move only shared infrastructure dependencies into Flarex pnpm
catalogs at first.

Good early catalog candidates:

- `typescript`
- `vite`
- `vitest`
- `zod`
- `@types/node`
- `@cloudflare/workers-types`
- `wrangler`

Leave Medusa-specific runtime dependencies pinned until their tests prove that a
catalog move is safe.

### 5. Connect Platform Runtime Boundaries

Only after the workspace and package manager are stable should the Flarex
runtime integration begin.

The runtime connection should happen at explicit boundaries:

- tenant runtime context
- Durable Object partition helpers
- D1/projection binding resolution
- Worker app composition
- event bus provider wiring
- workflow execution storage/provider wiring

Do not rebuild Medusa behavior inside Flarex. Flarex should compose and host the
Medusa runtime; Medusa should continue to provide the commerce behavior.

## Non-Goals

- Do not merge repos before pnpm is proven in this fork.
- Do not convert every dependency to catalogs in one pass.
- Do not rewrite Medusa services, APIs, workflows, or module behavior as part of
  the package-manager migration.
- Do not use the Flarex app layer as a parallel Medusa implementation.
- Do not mix package-manager migration failures with Cloudflare runtime
  behavior changes.

## Acceptance Gates

The next repo-move slice is ready to execute when:

- this pnpm conversion commit is cleanly merged
- the Medusa fork has a clean worktree
- the Flarex target placement is chosen explicitly
- validation commands are agreed before moving files
- rollback is simple because shared catalogs and runtime integration are not
  changed in the same slice
