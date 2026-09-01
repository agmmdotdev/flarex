# Medusa Fork Source Island

This directory preserves the Cloudflare-oriented Medusa fork as a pinned,
refreshable, independently installable source island. It is the primary source
for incremental Medusa package convergence into Flarex, but it is not an active
Flarex workspace member or runtime dependency.

## Source pin

- Fork: `https://github.com/agmmdotdev/medusa-fork.git`
- Commit: `48d5cc675e4e8bc821e22c20c88a751acc66fb5f`
- Commit tree: `41cb1ea75b0ef88c352008adef4117a73266ad3c`
- Package baseline: `2.13.4`
- Package manager: `pnpm@11.7.0`
- Official provenance baseline: Medusa `v2.13.4` at
  `ad4437b298d499d1a51e54decad6de3f5ebd2181`

`SOURCE.json` records the complete provenance contract. The selected fork and
official source have no proven Git merge base; the official release is not a
second semantic authority.

## Boundary

- `upstream/` is the complete tracked fork snapshot produced from the selected
  Git commit object. It excludes `.git`, dependencies, generated output,
  caches, local data, and untracked diagnostics.
- `SOURCE_COMMIT` preserves the selected raw Git commit object, while
  `SOURCE_SHA256SUMS` pins every imported regular file. Source verification
  hashes the commit object, proves its declared tree, reconstructs that tree
  from source blobs and modes, checks index/worktree agreement, and checks the
  lockfile, patches, license, package-manager pin, package-manifest count, and
  total source bytes.
- The imported pnpm workspace retains its exact lockfile, workspace graph,
  hoisting policy, patches, package names, tests, and runtime lanes.
- The Flarex root workspace still contains only `packages/*` and `apps/*`.
  Ordinary root build, typecheck, lint, and test recursion does not enter this
  island.
- No active Flarex package may depend on or import `@medusajs/*` or any path in
  this island. The imported source may not depend on or import any package
  discovered in the Flarex root workspace, or escape into that workspace.
  Manifests, source references, TypeScript configuration, symlinks, scripts,
  and workspace membership are checked in both directions.
- Package promotion is a later source-map-gated change. Promoted source must be
  copied into a root-owned package and retain no runtime path dependency on this
  island.

## Commands

Run from the Flarex repository root:

```sh
pnpm medusa:source:verify
pnpm medusa:source:typecheck
pnpm test:medusa-source-island-boundary
pnpm check:medusa-source-island-boundary
pnpm medusa:install
pnpm medusa:build:foundation
pnpm medusa:test:foundation
pnpm medusa:check:workspace-dependencies
pnpm medusa:check:portable-entrypoints
pnpm medusa:check:real-module-imports
pnpm medusa:check:runtime-source-imports
pnpm medusa:test:workerd
```

The unchanged Currency source and integration assertions used by the first
later promotion candidate remain separately runnable:

```sh
pnpm medusa:build:drizzle
pnpm medusa:test:currency
pnpm medusa:test:currency:pglite
pnpm medusa:test:currency:drizzle
```

The original MikroORM/PostgreSQL lane remains
`corepack pnpm@11.7.0 --dir third_party/medusa/upstream --filter
@medusajs/currency test:integration` with the fork's `DB_HOST`, `DB_PORT`,
`DB_USERNAME`, and `DB_PASSWORD` environment contract. It is a distinct real
PostgreSQL claim and is not replaced by PGlite or Drizzle/SQLite.

Only the first four commands use the Flarex root installation. The remaining
commands explicitly select `third_party/medusa/upstream` with
`corepack pnpm@11.7.0`; they do not add the island to the Flarex workspace or
lockfile. The workerd command materializes build/test output inside the ignored
island working tree and does not activate a Flarex runtime path.

The path-filtered `Medusa source island` CI workflow runs the four admission
commands whenever the island or either workspace side of its boundary changes.

The frozen install uses the fork's own validated `--ignore-scripts` lane. This
avoids treating package lifecycle hooks as source admission authority; the
named build, import-guard, and workerd commands exercise the required generated
and native runtime behavior explicitly.

## Refresh policy

An island refresh is a separate reviewed source-admission change:

1. select a clean committed fork revision;
2. regenerate the exact commit-tree snapshot, provenance, file checksums, and
   license/patch inventory;
3. review workspace, lockfile, package, patch, and license changes;
4. rerun source verification, boundary checks, and admitted fork regressions;
5. identify affected source maps and promoted packages; and
6. leave active package updates to their own bounded promotion changes.

The island never follows a branch, package range, npm tag, install hook, or
network fetch during normal Flarex builds.
