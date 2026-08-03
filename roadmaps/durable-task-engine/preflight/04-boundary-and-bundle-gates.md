# DTE01-F Receipt: Boundary And Bundle Gates

## Receipt Status

**Status:** DTE01-F complete. The gates that have current repository owners are
executable now. Package, compatibility-runner, persistence, and Worker-bundle
checks have exact activation conditions and must fail closed when their owners
enter the implementation slice.

This receipt consumes the
[`source/package boundary`](./02-source-map-and-package-boundary.md) and the
[`provenance/harness contract`](./03-provenance-and-compatibility-harness.md).
It does not admit `@flarex/durable-task`; DTE01-G owns that decision.

## Gate Principle

A missing future package is not proof that its code is safe. Conversely, a
gate must not require a nonexistent package, persistence adapter, or Worker
composition and then report a misleading green result.

DTE01-F therefore has two explicit states:

```text
pre-admission
  -> verify frozen source and accepted map
  -> prove active workspace has no Trigger dependency/import path
  -> fix package and production-harness rejection rules

admitted package exists
  -> automatically require target hashes, headers, notices, licenses, and manifest closure
  -> run package typecheck/tests and compatibility receipts
  -> run owner-specific persistence and Worker bundle gates when those adapters enter
```

The source-map command prints which state it evaluated. It cannot silently skip
admitted-package checks after `packages/durable-task/` exists.

## Executable Gate 1: Frozen Source And Source Map

The root command is:

```text
pnpm check:durable-task-source-map
```

[`check-durable-task-source-map.mjs`](../../../scripts/check-durable-task-source-map.mjs)
currently validates all 29 accepted entries. In pre-admission mode it proves:

- the map schema, capability, target package, reuse class, and license class
  are closed contracts;
- the map commit equals `third_party/trigger.dev/SOURCE.json`;
- every entry repeats that commit and uses a normalized, contained upstream
  path;
- every mapped upstream file exists and matches its SHA-256;
- every retained upstream test path exists;
- selected-symbol claims are nonempty and not duplicated for one upstream
  owner;
- admitted entries target only `@flarex/durable-task` `src/` or `test/` paths;
  and
- discarded entries stay in the explicit discarded namespace.

The first run found and corrected a real map-shape defect: seven whole-file
test entries used a scalar `selectedSymbols` value even though the source-map
contract requires an array, and eight entries used prose in `retainedTests`
where auditable upstream paths were required. The checker now pins the corrected
shape rather than accommodating two representations.

The frozen-island command remains independent:

```text
pnpm trigger:source:verify
```

It verifies the island's complete 1,518-file and two-symlink checksum manifest.
The root source-map gate verifies only the admitted closure and its semantic
metadata. Neither substitutes for the other.

## Automatic Admitted-Package Mode

The same source-map command changes to `admitted-package` mode as soon as
`packages/durable-task/` exists. It then also requires:

- `packages/durable-task/trigger-source-map.json` retains every accepted entry
  and accepted field without reclassification or semantic-history loss;
- every non-discarded entry has `targetSha256`, `transformationRevision`, and
  `changeReceipt`;
- every target file exists, matches its target hash, and names the pinned
  Trigger commit plus its exact mapped upstream path (or the exact multi-source
  marker) in a leading attribution header;
- every file carrying an adapted-source header is mapped;
- `THIRD_PARTY_NOTICES.md` names Trigger.dev, its repository and pinned commit,
  both license groups, the core copyright, the source map, and the fact that
  Flarex changed the admitted source;
- the Apache and Trigger core MIT texts exactly match the pinned source; and
- the package manifest distributes `src`, notices, source map, and licenses.

This mode is intentionally stricter than the current pre-admission map. Target
fields are not invented before target files exist, but their absence becomes a
failure immediately after package creation.

## Executable Gate 2: Dependency And Import Boundary

The existing root command remains:

```text
pnpm check:trigger-compatibility-boundary
```

[`check-trigger-compatibility-boundary.mjs`](../../../scripts/check-trigger-compatibility-boundary.mjs)
continues to scan root/app/package manifests and executable source under apps,
packages, integration, and scripts. Its global rules reject:

- `@trigger.dev/*` and mapped Trigger internal package dependencies/imports;
- npm/workspace aliases that hide those package names; and
- file dependencies or module specifiers into `third_party/trigger.dev`.

DTE01-F adds rules scoped to the future durable-task owner. Its manifest must:

- use the exact `@flarex/durable-task`, `0.0.1`, private ESM identity;
- export only `./internal/run-attempt-v1` at the fixed target;
- have only root-catalog `effect` as a runtime dependency; and
- use the exact source, notice, map, and licenses distribution list.

Durable-task production source uses a positive import boundary: it may import
only root-catalog `effect` subpaths and relative modules that resolve inside
`packages/durable-task/src/`. This rejects Node built-ins, Prisma and generated
Prisma paths, Drizzle/persistence, Redis/Redlock/BullMQ, Docker/Kubernetes,
Cloudflare/Wrangler/workerd, backend/app/CLI, test-harness, and other workspace
authority without relying only on a package blacklist. These rules apply to
static, dynamic, CommonJS, export, and import-type module references through
the existing TypeScript-AST scanner.

The same AST pass rejects direct, captured, destructured, or computed
`Date.now` and `Math.random` references; zero-argument `Date()` and `new Date()`;
and bare or `globalThis` `process` use in production package source. Controlled
time, jitter, persistence time, and host configuration must enter through the
accepted domain/store contracts.

Production source in any app or package also rejects imports of the durable
task compatibility harness. Test paths and test files may import test-only
fixtures; production modules may not make the harness reachable through a
deployable graph.

Until a host roadmap adds its bundle gate and explicit allowlist in the same
checkpoint, other workspace manifests and production modules also reject any
dependency on or import of `@flarex/durable-task`, including npm, workspace,
`file:`, `link:`, and relative source aliases/paths. A directory named
`fixtures` under production `src/` does not create a test exemption. Local path
comparison is conservative for absolute paths and case-insensitive so the gate
does not rely on the checkout platform's path casing.

## Current Test Receipt

The gates are included in root script typechecking and `pnpm test:scripts`.
Focused validation covers:

- accepted pre-admission map analysis;
- unsafe path, hash drift, duplicate symbol, and invalid discard failures;
- live inspection of the pinned 29-entry repository map;
- the existing Trigger alias/import/file-dependency cases;
- exact future durable-task manifest acceptance and rejection; and
- Node, Prisma, Redis, and compatibility-harness import rejection.

The DTE01-F checkpoint receipt is:

```text
pnpm check:durable-task-source-map
pnpm check:trigger-compatibility-boundary
pnpm typecheck:scripts
pnpm vitest run \
  scripts/check-durable-task-source-map.test.js \
  scripts/check-trigger-compatibility-boundary.test.js \
  --exclude .codex-worktrees/**
```

## Package-Creation Gates

The first admitted implementation checkpoint must run, in order:

1. root install with the root lockfile unchanged except for the reviewed
   workspace package addition;
2. `pnpm check:durable-task-source-map` in admitted-package mode;
3. `pnpm check:trigger-compatibility-boundary`;
4. `pnpm --filter @flarex/durable-task typecheck`;
5. focused policy, Schema/error, service/Layer, and attribution tests; and
6. the deterministic compatibility-receipt lane once both runners exist.

The package checkpoint fails if its root-catalog Effect version causes the
transformed code or tests to change behavior. The frozen runner continues to
use its own pnpm 10.33.2 island and lockfile; no command installs Trigger
dependencies into the root workspace.

`@flarex/durable-task` must initially be absent from every app dependency graph.
Only focused package tests and the root compatibility orchestrator may reach it
before a host-composition roadmap explicitly imports it. Workspace manifest and
source scanning provide the static receipt; root recursive dependency listing
provides the package-manager receipt at that checkpoint.

## Compatibility Harness Gate

`pnpm test:durable-task-compatibility` becomes mandatory only when the scenario
schemas, oracle runner, candidate runner, and comparator all exist. The command
must preserve the separate-process/lockfile contract in the DTE01-E receipt and
must fail differently for:

- invalid scenario input;
- Trigger runner/bootstrap failure;
- Flarex runner/bootstrap failure; and
- canonical receipt mismatch.

No placeholder command may return success before those owners exist. Until
then, DTE01-G admits the harness contract, not fictitious parity evidence.

## Worker Bundle Activation Matrix

The domain package is host-neutral and initially production-inert. Bundle proof
activates when an owning deployable graph first imports it:

| Import owner | Required build receipt | Required graph inspection |
| --- | --- | --- |
| package only, no app | package typecheck/tests; recursive workspace dependency listing | prove no app depends on the package |
| `flarex-backend` composed into backend Worker | `pnpm --filter @flarex/backend deploy:dry-run` | Wrangler output/metafile contains only admitted package source and portable dependencies |
| executor Worker reaches task lifecycle | `pnpm --filter @flarex/executor-worker check:bundle` | extend its existing metafile verifier with durable-task forbidden markers |
| artifact-runtime Worker reaches task lifecycle | `pnpm --filter @flarex/artifact-runtime deploy:dry-run` | inspect its Wrangler graph with the same forbidden markers |

Every activated graph rejects inputs or output text containing:

```text
@trigger.dev/
@internal/run-engine
@internal/run-store
third_party/trigger.dev
@prisma/client
.prisma/client
ioredis
redlock
bullmq
supervisor
integration/durable-task-compatibility
packages/durable-task/test
```

It also rejects Node supervisor, Docker/Kubernetes, registry, and local harness
paths even if bundling happens to polyfill or dead-code-eliminate their public
imports. The metafile input graph is authoritative for reachability; searching
only final minified output is insufficient.

The package itself is not declared Worker-safe merely because TypeScript
compiles it. Static builtin rejection plus the first real Wrangler graph are
both required.

## Persistence And Runtime Test Activation

No DTE01 code introduces a Task System store adapter, so database tests are not
run as decorative evidence. When `@flarex/persistence-postgres` first implements
`TaskSystemRunAttemptStore`, that checkpoint must add:

- PGlite tests for codecs, transactions, conflicts, corruption, and durable
  effect intents;
- real-Postgres tests for concurrency, transaction visibility, database time,
  fencing, and lost-response recovery; and
- the integration compatibility lane only for claims the Trigger oracle can
  execute under its own Postgres/Redis test environment.

Cloudflare/workerd tests activate only when a Worker, Durable Object, queue,
alarm, or service-binding adapter enters. They prove host wake/delivery and
lifecycle ownership, not database transaction semantics.

## No Boundary Exceptions

DTE01-F adds no global compatibility exception. The frozen Trigger runner stays
outside active workspace discovery, and the root orchestrator communicates by
process input/output rather than an import. A later implementation that needs a
production exception must return to preflight; it cannot alter the forbidden
set or hide the dependency with an alias.

## DTE01-F Exit Decision

DTE01-F is accepted because:

1. source and retained-test provenance is executable before package admission;
2. creating the target package automatically enables stronger target, notice,
   license, and manifest checks;
3. forbidden Trigger, Node, Prisma, Redis, infrastructure, and harness imports
   are machine-enforceable at their relevant boundaries;
4. root and island validation remain separately runnable;
5. missing future owners are named activation conditions rather than false
   green tests; and
6. each deployable graph has a concrete existing dry-run/bundle command and an
   exact forbidden-input inspection requirement.

DTE01-G may now consolidate the accepted medium capability and choose admit,
narrow, defer, or reject. No source transplant occurs before that decision.
