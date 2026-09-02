# Medusa Fork Source Island And Incremental Package Convergence

Status: accepted architecture preflight with the inert source island imported
and verified and the exact capability audit complete; package promotion and
Flarex-backed adapter implementation pending

Last reviewed: 2026-09-02

## Decision

The primary Medusa source for Flarex integration is the independently evolved
Cloudflare-oriented fork currently maintained at
`https://github.com/agmmdotdev/medusa-fork.git`, not an official Medusa npm
release or the current official Medusa repository head.

The fork has entered this repository as an inert, independently installable
source island under:

```text
third_party/medusa/
```

Selected packages and connected behavior may later be promoted one bounded
closure at a time into the active Flarex root workspace after the prerequisites
in
[`05-core-first-three-lane-readiness.md`](./05-core-first-three-lane-readiness.md)
pass. Promotion reuses the fork's actual source, package contracts, control
flow, and tests; it is not a clean-room reimplementation and it does not make
the pinned island a production runtime dependency.

The official Medusa repository remains historical provenance, licensing input,
and compatibility evidence. It is not the source candidate that Flarex will
adapt because it does not contain the fork's Worker-safe and runtime-agnostic
refactors.

The inert source island and its verification boundary are now implemented.
This preflight does not authorize:

- a root-workspace `@medusajs/*` package;
- a Flarex-backed Medusa adapter;
- `RelationalSchema`, migration, transaction-host, or commit-owner code;
- a Medusa import from the Flarex kernel;
- a Flarex import from the pinned fork snapshot;
- runtime routing, a deployment binding, `ctx.commerce`, or a public export;
- database migration, dual write, comparison write, fallback, or activation;
  or
- a claim of Medusa, Worker, hosted, or production parity.

## Why The Fork Is The Source Authority

The fork's accepted direction is to refactor Medusa in place. It preserves the
actual Medusa module services, DML models, workflows, APIs, providers, and
integration assertions while moving persistence and runtime dependencies
behind portable contracts and runtime-specific adapters.

The source currently contains material that is absent from the official
Medusa distribution or is specific to this fork, including:

- `@medusajs/dml` and `@medusajs/dal` portable contract experiments;
- `@medusajs/drizzle` and `@medusajs/drizzle-cloudflare`;
- `@medusajs/cloudflare-runtime`;
- static module, workflow, HTTP, provider, subscriber, job, and Link manifest
  work;
- portable Query/runtime entrypoints and Worker import guards;
- Cloudflare workflow, queue/event, locking, D1, and Durable Object SQLite
  integrations;
- unchanged Medusa module-service and integration assertions exercised through
  multiple persistence lanes; and
- a large sequence of fork-owned portability, test-runner, and behavior fixes.

Those changes are migration assets. Flarex must reuse them where their
authority and dependency closure are compatible instead of restarting from the
official Node-oriented package graph.

## Source Identity Observed During Preflight

The local audit on 2026-09-01 observed:

| Field | Observed value |
| --- | --- |
| Local checkout | `C:\Users\Admin\Documents\github\effect-cf-workflows` |
| Fork remote | `https://github.com/agmmdotdev/medusa-fork.git` |
| Official upstream remote | `https://github.com/medusajs/medusa.git` |
| Fork baseline commit | `3eaaa4ac12be140260320b22cc94ecb8bc71ab25` |
| Observed `origin/main` / `HEAD` | `48d5cc675e4e8bc821e22c20c88a751acc66fb5f` |
| Package baseline spelling | `2.13.4` |
| Package manager | `pnpm@11.7.0` |

The fork was initialized with its own Git history. The audited checkout has no
ordinary merge base with the currently fetched `upstream/develop`; provenance
must therefore record the fork baseline and the historical official Medusa
source or release explicitly rather than imply normal ancestor history.

The observed working tree was not clean:

- `packages/modules/order/vitest.integration.config.mts` was modified;
- `packages/modules/order/integration-tests/__tests__/diag-shipping.spec.ts`
  was untracked; and
- the root path `110` was untracked and unclassified.

Those files are not part of an admitted source snapshot. The observed HEAD is
evidence, not the final pin. Source-island implementation must choose a clean
committed fork revision and must never archive uncommitted or untracked
working-tree content implicitly.

The fork's own baseline note still contains historical remote/setup wording
that no longer matches the audited Git configuration. Source admission trusts
Git facts, the selected commit object, exact tracked content, and refreshed
provenance metadata rather than stale narrative setup text.

## Source Island Shape

The implementation target is:

```text
third_party/medusa/
  upstream/                  exact complete tracked fork snapshot, including
                             its package.json, workspace, lockfile, and patches
  SOURCE.json                source and provenance manifest
  SOURCE_COMMIT              exact selected Git commit-object payload
  SOURCE_SHA256SUMS          tracked content checksums
  NOTICE.md                  attribution and use description
  licenses/                  applicable exact license texts
  scripts/
    verify-source.mjs        content, mode, link, and file-set verification
  README.md                  boundary, commands, and update procedure
```

The import should preserve the complete committed fork source needed to retain
its package graph, tests, plans, patches, and runtime boundaries. Mechanical
outputs such as `.git`, `node_modules`, caches, build output, local databases,
coverage, logs, and untracked diagnostics are excluded. Any other exclusion
must be explicit in `SOURCE.json` and must not leave an imported package or
test closure incomplete.

The snapshot is produced from the selected Git commit object by a deterministic
commit-tree extraction or equivalent exact import. It is not copied from a
mutable working directory.

## Independent Workspace Boundary

The source workspace rooted at `third_party/medusa/upstream` retains its own:

- pnpm workspace definition and `pnpm@11.7.0` package-manager pin;
- lockfile, dependency versions, hoisting/linker policy, patches, generation,
  build, and test commands;
- `@medusajs/*` package names and internal workspace relationships; and
- Node, PostgreSQL, PGlite, Drizzle/SQLite, D1, Durable Object SQLite, and
  workerd acceptance lanes without conflating their claims.

The Flarex root workspace currently includes only `packages/*` and `apps/*`.
`third_party/medusa` remains outside those globs. The two workspaces may be
installed and tested as separate processes, but active Flarex production code
must not create a dual runtime.

Before the source island is admitted, a mechanical boundary check must reject:

- `@medusajs/*` dependencies or imports in active Flarex packages unless a
  later package-promotion preflight explicitly admits the exact dependency;
- imports, file dependencies, TypeScript path aliases, symlinks, or bundler
  aliases from `packages/*` or `apps/*` into `third_party/medusa`;
- imports from the pinned Medusa source into Flarex persistence, protocol,
  executor, backend, query-sync, durable-task, or public SDK packages;
- imports from `third_party/medusa/upstream` into a promoted root package;
- Flarex package dependencies introduced into the pinned source workspace;
  and
- root recursive build/test commands silently entering the island.

Root convenience commands may invoke the source workspace explicitly with the
exact package-manager version and `--dir third_party/medusa/upstream`. They do
not make it a root workspace member.

## Source Verification Contract

`SOURCE.json` must identify at least:

- fork repository URL and selected clean commit;
- fork baseline commit;
- historical official Medusa repository and source/release baseline;
- package version spelling and exact pnpm version;
- import timestamp and deterministic import method;
- included tracked roots and explicit exclusions;
- required license and notice files;
- expected lockfile and patch inventory;
- executable and symbolic-link metadata required for a portable checkout; and
- the source-manifest schema used by the verifier.

`verify-source.mjs` must fail when:

- any admitted source byte differs;
- a tracked file is missing or an unexpected tracked file appears;
- an executable bit or symbolic-link target differs;
- the selected commit, package-manager pin, lockfile, or patch inventory does
  not match the manifest;
- a required notice or license is absent;
- a forbidden cross-workspace dependency or path enters either graph; or
- verification relies on ignored build output instead of committed source.

Checksums are generated from the selected commit, reviewed, and committed with
the snapshot. The verifier must not rewrite them during ordinary validation.

## Reuse And Promotion Classification

Every promoted connected capability receives one primary reuse classification:

| Classification | Meaning | Required treatment |
| --- | --- | --- |
| `unchanged` | The fork contract and implementation are already portable and have the correct Flarex boundary. | Move source and tests with only package/build-path changes that preserve semantics. |
| `seamAdapted` | Medusa control flow and decisions are correct, but an authority-bearing dependency must become a narrow Flarex port or supplied capability. | Preserve validation, transaction, failure, retry, and event order while replacing only the seam. |
| `adapterTranslated` | The source owns persistence, migration, lock, queue, HTTP, or host mechanics that Flarex implements differently. | Preserve observable Medusa behavior and tests while translating mechanics to the correct Flarex owner. |
| `discarded` | The source is obsolete proof code, duplicate framework behavior, Node-only product policy, or incompatible authority that cannot be separated safely. | Record the exact reason, retained invariants/tests, and why the three reuse forms above are unsuitable. |

Reimplementation is the last classification, not the default. Classification
is per connected operation or capability, not per convenient file. A large
file or package may contain several classifications, but the complete
operation and its failure ordering must be understood before it is split.

Each promotion source map records:

- fork commit and source file/symbol closure;
- target root package, file, and owner;
- reuse classification and allowed semantic-change budget;
- dependencies that remain Medusa-owned;
- dependencies translated to narrow Flarex contracts;
- original, promoted, differential, and Flarex-host test evidence;
- license and notice obligations; and
- unsupported or deferred behavior that must fail closed.

## Package Promotion Model

Promotion is distinct from source import and runtime activation:

```text
admit pinned fork snapshot
  -> select one connected package/capability closure
  -> characterize source, dependencies, and unchanged tests
  -> admit a source map and target owner
  -> wait for every shared-core, Flarex Application, and Payload prerequisite
     in 05-core-first-three-lane-readiness.md
  -> promote source into the Flarex root workspace
  -> establish the unchanged compatibility baseline
  -> adapt only admitted infrastructure seams
  -> prove the Flarex-backed behavior
  -> remove a displaced implementation only after replacement gates pass
```

A promoted package:

- is owned by the Flarex root workspace and uses root dependency versions,
  package boundaries, lint/typecheck rules, tests, and bundle gates;
- may retain its `@medusajs/*` manifest name when that name is part of the
  internal compatibility graph;
- contains no runtime import or file dependency on the source island;
- contains provenance pointing to the exact source map and fork commit;
- preserves actual Medusa services, DML, workflows, APIs, and public contracts
  unless the source map admits an exact compatibility change;
- receives only narrow Flarex contract dependencies through the Medusa adapter
  or an admitted host-composition boundary; and
- is not public, routed, hosted, or production-ready merely because it builds
  in the root workspace.

The physical root directory name and manifest package name are separate
decisions. No empty root packages are created to reserve the future graph.

## Current Fork Findings That Constrain Promotion

The fork is substantially more advanced than the source state summarized by
the earlier Flarex roadmap. The source audit must begin from the selected fork
pin and refresh every capability matrix rather than treating the official
Medusa source or old roadmap prose as current.

At the same time, existing limitations remain relevant:

- the mature relationship-capable module grammar is still reached primarily
  through `@medusajs/utils/dml/model` and framework compatibility entrypoints;
- the current standalone `@medusajs/dml` implementation remains a narrower
  portable experiment and must not be mistaken for the complete module grammar;
- `ModulePersistenceAdapter` and static manifests provide credible adapter and
  discovery seams, but the broad modules-sdk root still installs Node defaults,
  MikroORM, filesystem discovery, and Node migration loading; promoted Worker
  closures must use precise portable entrypoints;
- the current Drizzle preparation path retains module models in mutable
  process-global state, and `MedusaModule` retains process-global instance,
  resolution, loading, and Joiner maps; multi-app or multi-tenant Flarex use
  requires instance- or module-scoped ownership rather than another global;
- the fork deliberately preserves MikroORM/PostgreSQL lanes during migration;
- Node-only source remains valid behind explicit Node entrypoints and must be
  physically absent from Worker bundles rather than merely unreachable;
- D1's statement-oriented behavior and Durable Object SQLite's atomic callback
  behavior are distinct host contracts; neither proves a transaction spanning
  Medusa, Application, Payload, or the Flarex commit finalizer;
- current Drizzle Node migration code can generate baseline material but does
  not provide the Flarex-managed run/revert lifecycle, while Link entity,
  connection, and migration paths retain MikroORM/PostgreSQL-native ownership;
- current Drizzle, D1, Durable Object SQLite, static bootstrap, Query, event,
  workflow, lock, and HTTP work is valuable source and conformance evidence,
  but it is not a Flarex artifact, migration, transaction, commit, or binding
  implementation; and
- disposable Worker proofs and app-root composition do not become shared
  Medusa or Flarex platform authority merely because they run in workerd.

This distinction prevents two opposite mistakes: discarding proven fork work,
or treating Cloudflare portability as proof of FlarexDB integration.

An earlier read-only audit observed passing portable-entrypoint, real Currency,
composed Worker, and runtime source-reach-in guards. The admitted clean-pin
implementation receipt below now owns the exact reproducible results, including
the selected Workerd/D1 and unchanged Currency lanes. The completed exact
capability audit regenerates only the claims it accepts and records the 65-input
Currency graph as reproducible while retaining broader graph counts as
exploratory. Any later package-promotion source map must again freeze and
reproduce every capability claim it carries forward.

## Provisional Promotion Sequence

The exact source audit may narrow a promoted closure or the internal Medusa
sequence after the global hold. It cannot relax or reorder the prerequisites in
[`05-core-first-three-lane-readiness.md`](./05-core-first-three-lane-readiness.md).
The initial direction is:

1. Retain the admitted complete fork source island and independent regression
   commands. This step is complete.
2. Map the mature and portable DML entrypoints, DAL contracts, types, utility
   closure, module persistence adapter, static manifests, and unchanged tests.
   Do not promote standalone `@medusajs/dml` as if it were already the complete
   relationship grammar.
3. Use the fork's actual Currency model and Drizzle/integration behavior as
   source-backed constraints for Flarex `RelationalSchema` and the later shared
   mechanisms. Do not make Drizzle or D1 the Flarex schema or transaction
   authority.
4. Hold every active package promotion while the shared-core synthetic proof,
   full Flarex Application preservation proof, Payload scalar/request-
   transaction proof, and Payload non-reactive one/many relation proof complete
   in the order owned by
   [`05-core-first-three-lane-readiness.md`](./05-core-first-three-lane-readiness.md).
5. Make the first active promotion a private, test-only connected Currency
   portability closure rather than one superficially isolated npm package. It
   includes the actual Currency model, service, and static manifest; mature DML
   normalization; the exact portable DAL/modules-sdk/type/utility closure; the
   repository adapter needed for the relocation baseline; and unchanged
   Currency assertions across their separately claimed persistence/runtime
   lanes.
6. Before runtime adaptation, replace mutable prepared-model state with an
   immutable instance- or module-scoped adapter and define the isolation of
   `MedusaModule` state. Keep migrations, Link, workflows, locks, events,
   idempotency, CMS interaction, and public commerce APIs outside this first
   promoted closure.
7. Meet the shared-core track at the Flarex-backed Currency candidate only
   after commerce transaction ownership and typed commit participation pass
   their own gates.
8. Promote Product and its intra-module relationships, then both endpoint
   modules for the first real stored Module Link.
9. Admit custom repositories and Query, followed by workflows, locks,
   idempotency, events, and larger module/runtime closures according to their
   real dependency graphs and unchanged tests.
10. Promote Cart, Order, and other broad transactional modules only after their
   required module, Link, workflow, and transaction semantics are admitted.

This is not a claim that later fork work is unusable. It is the safe activation
order for Flarex authority.

## Interaction With Shared Core Work

Source constraint extraction may run alongside the exact Payload audit. Active
package convergence begins only after the core, Application, and Payload proof
track completes:

```text
Medusa fork track
  admitted source island -> source maps / fixtures -> promotion hold

core and earlier-lane track
  artifact repository -> RelationalSchema [complete] -> migration coordinator
  -> transaction-owner/store -> commit-owner/receipts/finalizer
  -> synthetic lifecycle/transaction proof
  -> Flarex Application preservation
  -> Payload scalar/request transaction -> Payload native one/many relations

promotion gate
  Currency closure -> commerce transaction/commit admission
  -> Flarex-backed Currency proof -> Product -> first stored Module Link
```

The exact fork audit must precede freezing `RelationalSchema`, because the real
DML, repository, Link, Query, transaction, migration, workflow, lock, event,
and idempotency contracts constrain its supported capability set. Conversely,
promoted Medusa packages must not bypass missing Flarex host gates merely
because the fork already runs on Drizzle, D1, or Durable Object SQLite.

Application and Payload remain separate semantic lanes:

- the Application lane retains its document schema, OCC, relation, and commit
  owners;
- Payload content continues through the authenticated Application schema path
  while Payload lifecycle uses Payload-owned plans and state; and
- Medusa uses promoted fork semantics over reserved relational commerce
  storage through the Medusa adapter.

The shared core owns exact mechanisms only after independent consumers prove
identical authority, failure behavior, and lifecycle. No universal framework
schema, database, migration language, or transaction API is introduced.

## Source-Island Acceptance Gate

The first implementation slice is complete only when:

- the selected fork revision is clean, committed, and recorded exactly;
- the deterministic snapshot matches the selected Git commit and source
  manifest;
- the complete admitted tracked file set, modes, links, lockfile, patches,
  licenses, and notices verify from a fresh checkout;
- the source workspace installs with exact `corepack pnpm@11.7.0` and
  `--dir third_party/medusa/upstream` selection plus its exact lockfile;
- the fork's package graph and workspace-dependency check pass;
- the selected foundational source closure builds and its source tests pass;
- the selected Cloudflare import guards and at least one current workerd
  regression lane pass without `nodejs_compat` or forbidden Node/MikroORM
  imports;
- the exact unchanged module tests required by the first later promotion are
  named, runnable, and retain their persistence-lane distinctions;
- the root boundary check rejects all unadmitted cross-workspace imports and
  dependencies;
- Flarex root builds and tests do not enter the island unless an explicit
  island command is invoked;
- no root package, adapter, runtime route, binding, schema, migration, or
  production behavior changes; and
- the roadmap records the exact receipts and remaining divergences without
  broad parity claims.

Full upstream Medusa or fork product parity is not required for source-island
admission. The island must preserve the exact selected source and make its
claimed regression lanes reproducible.

### Source-island implementation receipt (2026-09-01)

The inert admission slice is complete at clean fork commit
`48d5cc675e4e8bc821e22c20c88a751acc66fb5f`, tree
`41cb1ea75b0ef88c352008adef4117a73266ad3c`. The imported snapshot contains
8,496 checksum-pinned regular files, 42,554,626 source bytes, no symlinks or
executable files, 88 package manifests, and 86 active workspace projects. It
retains pnpm `11.7.0`, the exact lockfile, three fork patches, the upstream MIT
license, fork baseline `3eaaa4ac12be140260320b22cc94ecb8bc71ab25`, and
official `v2.13.4` provenance at
`ad4437b298d499d1a51e54decad6de3f5ebd2181` without claiming a merge base.

Passing admission evidence:

- `pnpm medusa:source:verify` hashes the preserved raw commit object, proves
  its declared tree, and verifies the exact indexed file set, worktree bytes,
  blob IDs, reconstructed fork tree ID, modes, pin, inventories, and the
  bidirectional workspace boundary;
- verifier strict typecheck and eighteen focused boundary tests pass;
- the live boundary scan covers all 34 Flarex manifests and their source,
  TypeScript-config, and symlink graph, plus 88 Medusa manifests, 95 Medusa
  TypeScript configs, zero Medusa symlinks, and exactly the 7,777
  checksum-admitted Medusa source files;
- a path-filtered CI admission job runs strict tooling typecheck, focused
  boundary tests, the live boundary scan, and exact source verification when
  either side of the isolation boundary changes;
- `pnpm medusa:install` passes with the exact frozen lockfile and the fork's
  validated `--ignore-scripts` install lane;
- the 86-project workspace-dependency check passes with every local edge using
  `workspace:*`;
- the selected five-project portable foundation builds, and the unchanged
  `@medusajs/modules-sdk` source suite passes 15 suites / 89 tests;
- portable entrypoint checks pass with 5, 43, 46, and 5 bundled inputs; the
  strict real-Currency audit passes with 65 bundled inputs and zero Worker
  blockers; and the runtime-source import guard passes;
- the real Currency module Workerd/D1 lane passes read, create, update,
  soft-delete, restore, and delete while reporting statement transaction
  semantics; and
- the unchanged Currency package tests pass 2/2, while the same 13 integration
  assertions pass separately through PGlite and Drizzle/SQLite.

The original MikroORM/PostgreSQL Currency command remains named and runnable,
but current local execution is not a passing PostgreSQL receipt: PostgreSQL 18
was accepting connections and SCRAM authentication rejected the absent
`DB_PASSWORD` with `client password must be a string`. PGlite and
Drizzle/SQLite are not reported as substitutes for that lane.

An exploratory `@medusajs/currency...` dependency build also exposed the fork's
known cyclic/broad development graph: Currency itself built, but the selected
73-project closure reached `@medusajs/medusa` before multiple module `dist`
outputs and failed module resolution. That broad selector is not an admitted
source-island command. The later Currency promotion source map must define a
bounded topological closure rather than inherit that development graph.

No root package, adapter, runtime route, binding, schema, migration, database
write, public export, or production behavior changed. Ordinary root recursion
still contains only `packages/*` and `apps/*`; entry into this island is explicit
through `medusa:*` commands.

## Promotion Gate For Every Package Or Capability

Before a promoted closure can enter the active root workspace:

- every shared-core, Flarex Application, and Payload prerequisite in
  [`05-core-first-three-lane-readiness.md`](./05-core-first-three-lane-readiness.md)
  has passed;
- its source map and package dependency closure are accepted;
- every selected operation has one reuse classification and target owner;
- unchanged fork tests pass before adaptation;
- promoted tests prove the same named behavior after relocation;
- adapter changes preserve transaction, error, retry, lifecycle, and event
  order or record an explicitly admitted divergence;
- Worker-facing closures pass a physical import-graph guard;
- Node compatibility remains intact where the fork deliberately supports it;
- raw ORM, database, migration, transaction, or Cloudflare infrastructure
  authority does not cross the target contract;
- no duplicate write authority, dual runtime, fallback, or production shadow
  path is introduced; and
- removal of a displaced implementation has its own passing replacement and
  rollback evidence.

## Update And Rollback Policy

Updating the island pin is a separate reviewed change. It must:

1. select a new clean fork commit;
2. regenerate the exact source file/mode/link inventory and checksums;
3. review package graph, lockfile, patch, license, and notice changes;
4. rerun island verification and admitted regression lanes;
5. identify affected source maps and promoted packages; and
6. leave active package updates for separately bounded promotion changes.

The island never updates implicitly through a Git branch, package range, npm
tag, install hook, or network fetch during normal Flarex builds.

Rollback of a failed promotion removes or reverts the active root-workspace
change while retaining the pinned island and its evidence. Rollback does not
route production to the island, revive a dual implementation, or write through
the fork's original database path.

## Stop Conditions

Stop for a new preflight rather than continuing when:

- no clean committed fork revision captures the intended source;
- official-upstream and fork provenance cannot be reconstructed adequately;
- a required license or notice is uncertain;
- the import cannot reproduce the selected fork's package graph or tests;
- a promoted closure requires direct runtime access to the pinned island;
- the Flarex kernel would need to import Medusa;
- a package move silently changes Medusa behavior or drops existing assertions;
- a Node/MikroORM dependency enters a Worker bundle;
- a fork proof would become Flarex transaction, schema, migration, commit, or
  tenancy authority without its owning gate; or
- the work would activate a public, hosted, or production path.

## Next Authorized Slice

The source island and exact package/capability audit are complete. The accepted
map is
[`06-medusa-package-capability-source-map.md`](./06-medusa-package-capability-source-map.md).
The private value-only `RelationalSchema` contract is also complete in
[`08-relational-schema-value-contract.md`](./08-relational-schema-value-contract.md).
The design-only relational installation/readiness/availability and structural
migration gate is accepted in
[`09-relational-installation-and-migration-coordination.md`](./09-relational-installation-and-migration-coordination.md).
Its pure value checkpoint, later binding gate, and every package-promotion or
runtime step remain ordered by
[`05-core-first-three-lane-readiness.md`](./05-core-first-three-lane-readiness.md).

Medusa package work remains source-only. It must stop before creating an active
root `@medusajs/*` package or any Flarex adapter/core/runtime integration.
Package promotion remains blocked until every prerequisite named by
[`05-core-first-three-lane-readiness.md`](./05-core-first-three-lane-readiness.md)
passes.
