# SDK, Generated APIs, CLI, And Packaging

## Status And Scope

**Status:** Active domain authority with an implemented TypeScript-source SDK,
code generator, minimal CLI, Vite integration, client/React surface, test SDK,
and packed-consumer proof. It is not yet a production-ready published ecosystem
or full Convex SDK/CLI replacement.

This roadmap owns:

- the public `flarex` developer SDK surface;
- generated `_generated` files and their authority;
- `flarex-dev` CLI/codegen/deploy behavior;
- client and React developer ergonomics;
- npm package/export/tarball shape and licensing provenance; and
- the boundary between Convex-compatible ergonomics and intentional Flarex
  extensions.

It does not own:

- the workspace-internal Standard Application APIs that developer tooling
  lowers into, covered by
  [`42-standard-application-apis.md`](./42-standard-application-apis.md);
- backend analysis and push authority, covered by
  [`17-deployment-analysis-and-push.md`](./17-deployment-analysis-and-push.md);
- local dev runtime composition, covered by
  [`14-local-dev-server.md`](./14-local-dev-server.md);
- the test SDK's detailed lifecycle, covered by
  [`15-test-sdk.md`](./15-test-sdk.md);
- client sync correctness, covered by
  [`21-cloudflare-freshness-cache.md`](./21-cloudflare-freshness-cache.md); or
- package dependency direction, covered by
  [`16-package-boundaries.md`](./16-package-boundaries.md).

## Current Sources Of Truth

Use these sources in order when they disagree:

1. [`../AGENTS.md`](../AGENTS.md) and its Convex-first/accepted-design rules;
2. active architecture roadmaps for backend and runtime semantics;
3. this roadmap for public developer-surface direction;
4. package manifests, export maps, generated templates, CLI parser/help,
   integration tests, and actual generated output for exact current behavior;
   and
5. older SDK roadmap checkpoints only as migration/provenance evidence.

Primary implementation anchors:

- [`packages/flarex/package.json`](../packages/flarex/package.json) and
  [`src`](../packages/flarex/src) for public SDK exports;
- [`packages/flarex-dev/package.json`](../packages/flarex-dev/package.json),
  [`bin/flarex-dev.mjs`](../packages/flarex-dev/bin/flarex-dev.mjs), and
  [`src/cli.ts`](../packages/flarex-dev/src/cli.ts) for CLI packaging/commands;
- [`packages/flarex-dev/src/generate.ts`](../packages/flarex-dev/src/generate.ts)
  and [`sourcePackage.ts`](../packages/flarex-dev/src/sourcePackage.ts) for
  generation and bundling;
- [`packages/flarex-dev/src/generatedTypecheck.ts`](../packages/flarex-dev/src/generatedTypecheck.ts)
  for optional generated-output typechecking;
- [`packages/flarex-dev/src/vite.ts`](../packages/flarex-dev/src/vite.ts) for
  Vite integration;
- [`packages/flarex-test/package.json`](../packages/flarex-test/package.json)
  and [`src/index.ts`](../packages/flarex-test/src/index.ts) for the packaged test
  harness;
- [`integration/cli-pack.integration.test.ts`](../integration/cli-pack.integration.test.ts),
  [`internal-packages-pack.integration.test.ts`](../integration/internal-packages-pack.integration.test.ts),
  and [`fresh-consumer-pack.integration.test.ts`](../integration/fresh-consumer-pack.integration.test.ts)
  for tarball and installed-consumer evidence; and
- [`packages/flarex/LICENSE.convex`](../packages/flarex/LICENSE.convex) for the
  preserved Apache-2.0 Convex license text shipped with the SDK package.

## Package Roles

| Package | Public role | Boundary |
| --- | --- | --- |
| `flarex` | SDK values, schema, registration, function references, data model/query types, client, sync client, React hooks, auth types, IDs, artifact helpers | No backend storage, host configuration, CLI, or trusted executor APIs |
| `flarex-dev` | `flarex-dev` binary, codegen, deploy client, source bundling, Vite plugin, local runtime composition, generated-output typecheck | Developer-process only; broad internal dependencies must not enter app/runtime bundles |
| `flarex-test` | Typed test harness backed by the real local dev runtime | Test-only convenience; not a second backend implementation |
| `flarex-protocol` | Internal/shared transport contracts consumed by SDK and platform packages | Not a normal developer import surface unless a specific contract is intentionally public |

The SDK is derived from and modeled closely on portable Convex npm-package
patterns. It is a compatibility SDK, not the backend source of truth and not a
license to reuse Convex cloud-specific behavior unchanged.

### Relationship To Standard Application APIs

The public SDK and `flarex-dev` are Developer API producers. Their ergonomic
objects are not the stable contract consumed directly by replacement
analysis, registration, or runtime owners:

```text
defineSchema / defineTable / query / mutation / action
  -> flarex-dev SDK inspection, codegen, bundling, and producer policy
  -> Standard Application definition API
  -> canonical program and artifact materializer owners
  -> later Standard analysis, registration, and invocation APIs
```

Roadmap 42 owns the Standard layer. The SDK retains authoring ergonomics,
TypeScript inference, runtime markers, codegen, source packaging, and
developer-facing diagnostics. It lowers those values into explicit Standard
inputs; it does not make SDK class identity, function closures, generated
files, or source-package conventions downstream authority.

The first Standard definition package is workspace-internal and is not
re-exported from `flarex`. Publication and semver compatibility require a
separate consumer and release preflight.

The approved Standard `SAA01` slice establishes shared pure typed
validator/function-contract/reference lowering used first by system tests. A
later developer-producer adapter should delegate every exactly compatible
validator and function contract to that same lowering. It must retain explicit
handling for public SDK-only compatibility semantics instead of widening the
protocol `ValidatorJsonV1` contract or maintaining a parallel Standard wire
representation.

## Public SDK Surface

### Export Map

`flarex` currently exports:

```text
flarex
flarex/browser
flarex/client
flarex/react
flarex/artifacts
flarex/auth
flarex/ids
flarex/server
flarex/validator-json
flarex/values
```

The root entrypoint exports client, API/function-reference, auth, data model,
IDs, query builder, server registration/schema, values, validation, and selected
sync types. React stays on `flarex/react`, though React is currently declared as
a package-wide peer dependency.

### Values And Schema

Implemented developer schema/value concepts include:

- `v` validators and inferred types;
- `Id<Table>` and canonical ID helpers;
- `defineSchema` and `defineTable`;
- `.index(name, fields)`;
- `definePartitionTable`;
- `defineColocatedTable`;
- `defineGlobalTable`; and
- `defineProjection` as an exposed but not end-to-end supported placeholder.

The partition/colocation/global constructors are current routing-compatibility
surface. They must not be interpreted as caller control over Postgres physical
placement, storage generation, or scope authority. The accepted replacement
needs an explicit API reconciliation before these names are declared durable
v1 semantics.

`defineProjection` currently creates SDK metadata, but no accepted projection
architecture or complete backend/runtime implementation consumes it. Roadmap 08
is legacy; new code must not treat the constructor's existence as an active
projection requirement.

### Function Registration And Contexts

Implemented registration builders include:

- `query` / `internalQuery`;
- `mutation` / `internalMutation`;
- `workflowMutation`; and
- `action` / `internalAction`.

They support direct handlers and object definitions with `args`, `returns`, and
`handler`, plus runtime markers and validator exporters used by analysis.

Generated/server types provide:

- `ctx.db` reader/writer types;
- table/index-aware query builders;
- `ctx.auth`;
- same-artifact `ctx.runQuery` and `ctx.runMutation` types;
- mutation writer narrowing from partition scope metadata; and
- public/internal typed function references.

Runtime capability is narrower than registration surface: the current Dynamic
Worker/executor path executes queries and mutations. Actions and
`workflowMutation` are not yet executable end to end. Exposing their builders
preserves the intended API direction but does not claim runtime support.

### Query Builder

The typed query surface includes named index selection, ordered equality/range
expressions, lazy collection, `first`, `unique`, ordering, and cursor pagination
request shapes. Generated data-model types constrain table, index, field, and
document types.

Exact ordering, snapshot, pagination, and replacement-index correctness remain
backend/runtime concerns. Type-safe builder output cannot promise semantics the
active storage generation has not proven.

### Function References And Generated API

Generated function references carry path, kind, visibility, argument/return
types, and Flarex routing metadata. Public client APIs accept public references;
internal references remain server-context only at the type boundary.

Current routing metadata can infer a partition key from generated function
metadata and arguments. That is compatibility behavior. Clients must never
select storage generation/fence or physical placement, and replacement routing
should progressively remove public transport details that the trusted executor
can derive from active metadata.

## Client And React Surface

### `FlarexClient`

The current client supports:

- one-shot typed queries over HTTP;
- mutations over sync by default or explicit HTTP transport;
- `watchQuery` and `onUpdate` live-query subscriptions;
- duplicate subscription/watch sharing;
- bearer auth refresh and clear;
- trusted dev/test identity headers behind an explicit shared token;
- sync authentication generation/race handling; and
- explicit `close()`.

The client does not currently expose a public `action()` method. It also lacks a
complete production reconnect/backoff protocol, optimistic updates, mutation
queue persistence, paginated live-query behavior, and the full Convex browser
client lifecycle.

### React

`flarex/react` currently provides:

- `FlarexReactClient`;
- `FlarexProvider`;
- `useFlarex`;
- `useQuery`;
- `useQuery_experimental` with explicit state/error behavior;
- `useQueries`; and
- `useMutation`.

There is no `useAction`, Next.js helper package, SSR preload contract, optimistic
update API, or complete reconnect/loading parity with Convex. React event objects
are rejected when accidentally passed directly to mutation calls.

## Generated Files And Authority

Generation writes under `flarex/_generated` by default:

```text
dataModel.ts
server.ts
api.ts
functionRegistry.ts
functionMetadata.ts
deploymentSchema.ts
worker.ts
```

Generation is two-phase:

1. initial codegen writes enough data-model/server/API scaffolding to bundle
   developer modules;
2. tooling bundles a deterministic source package;
3. local or backend-controlled analysis returns deployment/codegen metadata;
4. final codegen rewrites the complete generated set from that metadata; and
5. stale generated entries are removed only after the final write plan is
   accepted.

Backend deploy mode must use backend-returned codegen analysis. Offline codegen
may use the local Miniflare analyzer for feedback, but that output is not hosted
deployment authority.

Generated `worker.ts`, registry, and metadata files are internal compatibility
artifacts. Developers do not edit or deploy them with Wrangler. Hosted Flarex
materializes its own managed execution shell from the source package.

Dry-run computes writes and deletions without mutating the project. Unchanged
files are omitted from the report. Final generation preserves non-generated
developer files and removes only stale entries owned by the generated directory.

## CLI Contract

The packaged executable is:

```text
flarex-dev
```

It is a small Node shim that launches the TypeScript CLI source with `tsx`.
Implemented commands are:

```text
flarex-dev help
flarex-dev codegen
flarex-dev deploy
```

### `codegen`

Supported modes/options include:

- project/app/generated directory selection;
- dry-run;
- local analyzer by default;
- HTTP analyzer selection;
- backend push coordinator selection;
- deployment ID and repeated headers;
- generated-output typecheck modes `enable`, `try`, or `disable`;
- explicit TypeScript CLI, cwd, and path mappings.

Backend and standalone analyzer options are mutually exclusive. A backend push
used only for codegen creates an analyzed candidate; callers must manage whether
that candidate is later finished or abandoned.

### `deploy`

`deploy` requires a backend URL and deployment ID and performs:

```text
initial codegen
  -> source package
  -> backend start push
  -> final codegen from returned analysis
  -> optional generated-output typecheck hook
  -> finish, or abandon when the hook fails
```

`--json` emits a stable command/result envelope with push state, diagnostics,
finish-rejection code, and remediation. Human mode writes errors to stderr.

Generated-output typechecking defaults to `disable`; it runs only when the user
chooses `enable` or `try` (or when another caller supplies a pre-finish hook).
Therefore the CLI help's conceptual “typecheck before activation” is not a
default safety guarantee yet.

There is no CLI login, project/team management, dashboard, cloud token,
deployment selection, logs, data import/export, migration, or standalone `dev`
command. Vite integration currently owns the local watch/runtime experience.

## Vite And Local Integration

The `flarex-dev/vite` plugin starts/reuses the real local runtime composition,
coordinates generation and reload, and disposes resources with the Vite server.
It does not turn the application into a deployable backend Worker.

The generated source package contains only developer Flarex modules and Flarex
managed metadata. Frontend/Next/mobile application code is outside the backend
artifact.

## Test SDK Relationship

`flarex-test` wraps `createFlarexDevRuntime` and exposes typed query, mutation,
raw invoke, client, WebSocket, fetch, reload, reset, and dispose behavior.

Its `action` method is present at the TypeScript surface but the current runtime
does not execute actions, so it is not a proof of action support. The harness is
valuable because packed-consumer tests exercise both legacy and PGlite/Postgres
query/mutation/live-query paths through generated API references.

## Packaging And Distribution

### Current Tarball Shape

Packages publish TypeScript source and explicit export targets rather than
compiled `dist` JavaScript/declaration output. `pnpm pack` rewrites local
workspace/catalog dependency protocols to package versions and excludes most
tests/configuration. The persistence package includes its Drizzle migrations;
the backend includes narrowly exported test harness files intentionally.

Integration coverage proves:

- all public export targets exist in tarballs;
- manifests contain no `workspace:`, `catalog:`, `link:`, or `file:` protocols;
- development-only files are excluded except approved harness exports;
- the `flarex-dev` bin shim is included and callable;
- an isolated consumer can install the complete locally packed internal graph;
- help, codegen dry-run, real codegen, generated typecheck, runtime import,
  `flarex-test`, reset, legacy live queries, and PGlite/Postgres live queries
  work in that fixture.

This is strong packability evidence, not registry publication proof. The fresh
consumer test uses local tarballs, local linked external dependencies, offline
installation, and workspace overrides.

### Versioning And Licensing

All publishable packages currently use version `0.0.1` and have no
`publishConfig` or release automation. No npm registry publication, provenance,
signature, dist-tag, semver-compatibility, upgrade, or multi-version skew test is
established.

`flarex` ships `LICENSE.convex` containing Apache License 2.0 because the SDK is
derived from or closely ports Convex npm-package ideas/code. Any further close
port must preserve required notices and provenance. A filename alone does not
replace a release-level license/NOTICE audit across every published package.

## Invariants And Trust Boundaries

1. **Developer ergonomics follow Convex first.** Reuse portable public concepts
   and mental models before inventing alternatives.
2. **Backend truth does not live in generated files.** Generated metadata is
   feedback/input; backend-controlled analysis and active state remain
   authoritative.
3. **Developers write modules, not Worker infrastructure.** No app-owned fetch
   handler, Wrangler config, service binding, or database handle is required.
4. **Public and internal references stay separated.** Client APIs cannot accept
   internal function references merely because the path is known.
5. **Types cannot promise unsupported runtime behavior.** Builders, test methods,
   or metadata for actions/workflows/projections do not imply execution support.
6. **Clients do not select physical authority.** Partition compatibility
   metadata cannot expose storage generation/fence, physical index IDs, scope
   placement, or transaction ownership.
7. **Final codegen follows analysis.** Deploy codegen consumes the exact backend
   push response; it does not rescan locally and silently diverge.
8. **Activation follows caller validation.** When typecheck/build validation is
   requested, failure must abandon/preserve the candidate rather than finish.
9. **Dry-run is non-mutating.** It reports owned writes/deletes without changing
   application files.
10. **Generated cleanup is scoped.** Tooling deletes only stale entries it owns
    under the selected generated directory.
11. **Tarballs are self-consistent.** Every exported/bin target exists and
    published manifests contain no local dependency protocols.
12. **Runtime dependencies are declared.** The source CLI cannot rely on a
    workspace-global `tsx`, TypeScript, Vite, or Cloudflare type installation.
13. **Licensing provenance is preserved.** Close ports retain applicable
    license/notice obligations and name the Convex source areas used.
14. **Test SDK reuses the real local runtime.** It cannot define semantics that
    production packages do not implement.
15. **Compatibility additions remain explicit.** Flarex-specific schema/routing
    concepts are named, documented, and re-evaluated against accepted Postgres
    authority instead of being mislabeled as Convex behavior.
16. **Developer APIs lower through the Standard layer.** Once the relevant
    Standard capability is implemented, replacement developer tooling must
    delegate to it rather than maintain a parallel canonical/materialization,
    analysis, registration, or invocation sequence.

## Decisions And Rationale

### Fork A Portable SDK Subset, Not The Convex Cloud Product

Values, schemas, function registration, generated references, query builders,
clients, and hooks carry the developer mental model. Convex cloud selection,
team/project auth, hosted endpoints, dashboard, and Rust-backend assumptions do
not port to Flarex's Cloudflare/Postgres architecture.

### Keep Codegen Two-Phase

Developer modules depend on generated server/model types, while final generated
API metadata depends on backend analysis. Initial scaffolding breaks that cycle;
final codegen then consumes authoritative analysis before activation.

### Ship A Minimal CLI Before Porting Operational Breadth

`codegen` and `deploy` exercise the essential developer contract without
copying project/team/cloud commands whose backend does not exist. New commands
should follow real platform capabilities, not a superficial Convex CLI clone.

### Test Installed Tarballs, Not Only Workspace Imports

Workspace resolution can hide missing files, local protocols, undeclared
dependencies, bin failures, and peer assumptions. Packed installation and
consumer type/runtime tests catch those packaging defects while remaining
bounded and reproducible.

### Keep Flarex-Specific Routing Honest

Current schema and generated metadata expose partition/colocation concepts
because the compatibility runtime needs them. The accepted Postgres design
changes physical authority. The API should preserve only developer-relevant
logical semantics and remove fields the trusted executor can derive.

## Convex Compatibility And Flarex Divergences

Closely followed Convex areas include:

- `npm-packages/convex/src/server/schema.ts`, `registration.ts`, `database.ts`,
  `query.ts`, `index_range_builder.ts`, and `api.ts`;
- `npm-packages/convex/src/values`;
- browser HTTP/sync and React package layering;
- `npm-packages/convex/src/cli/lib/codegen.ts`; and
- Convex codegen templates for API, server, and data-model output.

Named Flarex divergences:

- Flarex transports target Cloudflare Workers, WebSockets, managed Dynamic
  Workers, and a private Postgres executor rather than Convex cloud endpoints;
- the SDK currently exposes partition/colocation/global/workflow concepts;
- generated internal Worker/runtime files support Flarex's execution artifact
  boundary;
- local analysis uses Miniflare and hosted analysis is a separate service;
- the CLI uses source TypeScript via `tsx` and has only codegen/deploy;
- packages currently ship TypeScript source rather than compiled artifacts; and
- the browser/React client is a bounded subset without actions, full reconnect,
  optimistic updates, or Next.js helpers.

## Implemented Capabilities

- Public SDK values, schema, registration, validator exports, function
  references, generated data-model/query types, and partition-aware server
  context typing.
- Typed HTTP/sync client queries, mutations, live-query watches, auth refresh,
  public/internal guards, and React query/mutation hooks.
- Initial/final codegen, deterministic source-package bundling, backend/local
  analyzer seams, dry-run planning, stale cleanup, and generated typecheck.
- `codegen` and `deploy` CLI commands with structured deploy JSON output and
  candidate abandon behavior.
- Vite integration and a test SDK backed by the real local runtime.
- `flarex-dev` definition prebuilds enter the workspace-internal Standard
  canonical-program and artifact-materialization stages while retaining SDK
  inspection, source-package lowering, and developer-specific failures.
- Tarballs for the internal package graph with export/bin/migration/license
  contents and rewritten dependency protocols.
- Fresh packed-consumer installation, codegen, TypeScript, runtime import,
  legacy/PGlite query-mutation-live-query, reset, and disposal proof.

## Known Gaps And Limitations

- Packages ship TypeScript source. Consumers need compatible ESM/bundler/tsx
  tooling; Node cannot treat the package set like ordinary compiled JS without
  that toolchain.
- There is no npm registry release process, compiled declaration/build artifact,
  semver policy, changelog, provenance/signing, dist-tag, or upgrade/skew test.
- The fresh-consumer test uses local tarballs, offline local external links, and
  overrides. It does not prove installation from a public/private registry or a
  clean environment without workspace-adjacent dependency caches.
- `flarex-dev` is a heavyweight composition package because codegen/local/test
  paths depend on analysis, backend, executor, persistence, Miniflare, and Vite.
  CLI packaging works, but production apps must not bundle this graph.
- React is a mandatory peer of `flarex` even for consumers that import only
  server/client subpaths. It should be evaluated as an optional peer or split
  package before publication.
- Deploy generated-output typechecking defaults to disabled, so activation is
  not typecheck-gated unless the user opts in.
- The SDK exposes `action`, `workflowMutation`, `defineProjection`, and
  `flarexTest.action`, but those capabilities are not implemented end to end.
- `FlarexClient`/React lack actions, optimistic updates, robust reconnect/backoff,
  persisted mutation queues, paginated live sync, SSR/Next.js helpers, and full
  Convex client state semantics.
- Partition/colocation/global constructors and generated partition inference are
  tied to compatibility routing assumptions. Their durable logical meaning under
  scope-based Postgres authority has not been accepted.
- Generated `worker.ts` and some metadata artifacts preserve compatibility
  roles while hosted execution now materializes a managed shell. Their eventual
  public/private status and removal criteria need consolidation.
- `codegen` with a backend push coordinator can leave an analyzed candidate when
  used outside `deploy`; candidate cleanup policy is not automatic.
- CLI has no project/deployment discovery, credentials/login, config file,
  environment profiles, dev command, logs, migrations, data tools, telemetry
  policy, update notification, or machine-readable codegen output.
- License provenance is explicit for `flarex`, but a complete release audit for
  every package and all closely ported Convex code is not recorded.
- The forward executor function argument/return validation gap in roadmap 10
  means generated types and compatibility-runtime validation cannot yet prove
  production safety.

## Target Direction

Deliver a small, compiled, versioned package set that preserves Convex's
developer model while exposing only proven Flarex differences:

```text
developer modules + generated types
  -> source-only codegen/deploy CLI
  -> Standard Application definition preparation
  -> backend-controlled analysis
  -> final codegen and mandatory validation policy
  -> active managed execution artifact
  -> typed client/sync/React APIs
  -> trusted Postgres executor semantics
```

Public APIs should describe logical application behavior. Storage generation,
scope placement, physical indexes, service bindings, Dynamic Worker shells, and
transaction routing remain platform internals.

## Next Correctness Gates

1. **Resolve misleading exposed capabilities.** Either implement or explicitly
   experimentalize/remove action, workflow mutation, projection, and test-action
   surfaces so public typing cannot imply unsupported runtime behavior.
2. **Reconcile routing APIs with accepted Postgres authority.** Decide the
   durable logical meaning of partition/colocation/global schema constructors
   and generated partition metadata; remove physical/client authority the
   trusted executor can derive.
3. **Make deploy validation safe by default.** Establish a default generated
   typecheck/build policy, clear opt-out semantics, candidate abandonment for
   every failed local gate, and cleanup for codegen-only backend candidates.
4. **Produce publishable compiled packages.** Emit JS and declarations with
   conditional exports/source maps, make React optional/split, reduce CLI
   runtime/tooling assumptions, and test Node/bundler consumers.
5. **Create a real release process.** Add coordinated versions, semver policy,
   changelog, license/NOTICE audit, registry provenance, dist-tags, clean
   registry-install smoke, and previous-version upgrade/skew tests.
6. **Complete client parity by need.** Prioritize reconnect/auth recovery and
   explicit connection state, then actions/optimistic updates/paginated sync and
   SSR helpers only after backend semantics exist.
7. **Connect replacement schemas to codegen.** Generate from the exact immutable
   active FlarexDB schema/package artifacts and prove stale generation/fence
   metadata cannot produce runnable client/server output.
