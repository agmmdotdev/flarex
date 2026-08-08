# Testing And Simulation Strategy

## Status And Scope

**Status:** Active domain authority with broad unit, PGlite, Miniflare,
packaging, real-Postgres, workerd/service-binding, and hosted-proof harnesses.
The test lanes are not yet exposed through one fail-closed matrix, live hosted
H05 evidence remains incomplete, and no deterministic model simulator exists.

This roadmap owns:

- the meaning and required evidence of each repository test lane;
- rules for claiming package, integration, Postgres, workerd, hosted, and
  simulation proof;
- proportional validation and lane selection by correctness boundary;
- deterministic scheduling, model-based testing, and fault-injection direction;
- external-resource isolation, cleanup, receipts, and fail-closed activation;
  and
- cross-domain gaps in test orchestration and evidence honesty.

It does not own:

- the behavior being tested, which remains in its domain roadmap and code;
- public test SDK ergonomics, covered by [`15-test-sdk.md`](./15-test-sdk.md);
- SDK packaging and fresh-consumer distribution, covered by
  [`09-sdk-and-cli-fork.md`](./09-sdk-and-cli-fork.md);
- local runtime composition, covered by
  [`14-local-dev-server.md`](./14-local-dev-server.md);
- hosted executor architecture and activation status, covered by
  [`20-postgres-executor.md`](./20-postgres-executor.md); or
- per-slice exit criteria, which remain in the
  [FlarexDB foundation plans](./flarexdb-foundation/README.md) and relevant
  domain authority.

Passing one lane proves only that lane's declared boundary. It must never be
reported as whole-repository, real-Postgres, hosted Cloudflare, registry, or
simulation evidence unless those exact boundaries ran and passed.

## Current Sources Of Truth

Use these sources in order when they disagree:

1. [`../AGENTS.md`](../AGENTS.md) for proportional validation and mandatory
   database/host gates;
2. [`../design-notes/flarex-db-accepted-design.md`](../design-notes/flarex-db-accepted-design.md)
   and the [foundation plans](./flarexdb-foundation/README.md) for correctness
   boundaries that require PGlite, real Postgres, or hosted proof;
3. active domain roadmaps for domain-specific exit criteria;
4. this roadmap for lane meanings and evidence policy;
5. current package scripts, test configuration, harnesses, and tests for exact
   executable behavior; and
6. old checkpoint receipts only as provenance, not current green status.

Current orchestration anchors include:

- [`package.json`](../package.json) for workspace test/typecheck/build and root
  integration commands;
- [`integration/vitest.config.ts`](../integration/vitest.config.ts) and the
  [`integration`](../integration) directory for cross-package invoke,
  materialized artifact, CLI, tarball, and fresh-consumer lanes;
- [`packages/persistence-postgres/package.json`](../packages/persistence-postgres/package.json)
  and its [`test`](../packages/persistence-postgres/test) directory for PGlite
  and real-Postgres persistence evidence;
- [`packages/executor/package.json`](../packages/executor/package.json) and its
  [`test`](../packages/executor/test) directory for trusted executor behavior;
- [`packages/flarex-backend/vitest.config.ts`](../packages/flarex-backend/vitest.config.ts)
  and [`packages/flarex-dev/vitest.config.ts`](../packages/flarex-dev/vitest.config.ts)
  for serialized Miniflare-heavy package suites;
- [`apps/executor/package.json`](../apps/executor/package.json),
  [`apps/executor/test/serviceBinding.postgres.test.ts`](../apps/executor/test/serviceBinding.postgres.test.ts),
  and [`apps/executor/test/serviceBinding.hosted.postgres.test.ts`](../apps/executor/test/serviceBinding.hosted.postgres.test.ts)
  for bundle, H04 workerd/Postgres, and H05 hosted lanes;
- [`apps/executor/h05`](../apps/executor/h05) for hosted proof, evidence,
  cleanup, and receipt contracts;
- [`packages/flarex-test/src/index.ts`](../packages/flarex-test/src/index.ts) and
  [`integration/fresh-consumer-pack.integration.test.ts`](../integration/fresh-consumer-pack.integration.test.ts)
  for generated-app/test-SDK consumer evidence; and
- [`scripts/check-effect-boundaries.mjs`](../scripts/check-effect-boundaries.mjs)
  for the repository-owned Effect runtime-boundary enforcement gate.

## Evidence Model

### Proof Vocabulary

Use these words literally:

- **passed**: the named command selected and completed the asserted tests with
  no relevant skip;
- **skipped**: prerequisites were absent and the test body did not run; this is
  not proof;
- **fail-closed**: absent or invalid prerequisites make the explicit proof
  command fail rather than skip or silently downgrade;
- **fast lane**: deterministic local evidence suitable for ordinary iteration;
- **correctness lane**: evidence required because an adapter cannot reproduce
  the relevant database, concurrency, host, or platform semantics;
- **receipt**: bounded, attributable evidence tied to exact source, runtime,
  configuration, resources, cleanup, and result; and
- **simulation**: seeded, replayable exploration against a model or controlled
  scheduler. Repeated integration tests with random values are not simulation.

The following substitutions are invalid:

| Evidence obtained | Claim it cannot make |
| --- | --- |
| Typecheck or build | Runtime behavior passed |
| PGlite | Real-Postgres locks, isolation, plans, or driver lifecycle passed |
| Miniflare/workerd | Hosted Cloudflare routing, Worker Loader, Hyperdrive configuration, or placement passed |
| Wrangler dry-run | A deployed Worker successfully handled traffic |
| Local tarballs and offline links | Registry publication or clean internet install passed |
| `describe.skip` because credentials are absent | The external correctness lane passed |
| Focused test file | The package or workspace suite passed |
| Root `pnpm test` without inspected environment/skip results | Root integration, guaranteed real-Postgres, service-binding, or hosted lanes passed |

### Lane Matrix

| Lane | Normal entry point | What it proves | What it does not prove |
| --- | --- | --- | --- |
| Static contract | package `typecheck`, `build`, `check:effect-boundaries`, bundle metadata checks | Types, import graph, generated/static constraints, Worker bundle exclusions | Runtime semantics or external services |
| Unit/domain | package `test` focused to pure modules or adapters | Deterministic functions, validation, state transitions, error mapping | Cross-package wiring or database/host behavior |
| PGlite fast persistence | default persistence/executor/local-dev tests and root integration | Real SQL/migrations through the PGlite adapter, executor composition, rollback and deterministic scenarios | PostgreSQL concurrency, locks, isolation, plans, `pg` lifecycle |
| Miniflare component | backend, dev, artifact-runtime, example, and test-SDK integrations | Worker/DO/R2/service-binding-shaped local behavior and cleanup | Hosted Cloudflare control plane and Hyperdrive |
| Root integration | `corepack pnpm test:integration` | Cross-package Nitro/PGlite invoke, Miniflare materialization, CLI/bin, tarball, and consumer flows | Package suites, real Postgres, hosted Cloudflare |
| Package distribution | focused CLI/internal/fresh-consumer integration files | Tarball contents, rewritten manifests, bin execution, local isolated consumer behavior | Registry, provenance, version upgrade/skew |
| Real Postgres | package `test:postgres` with an actual database URL | PostgreSQL transactions, locks, isolation, concurrent claims, migrations, cleanup, request-scoped clients | Worker service bindings or hosted Hyperdrive |
| H04 local workerd/Postgres | executor Worker `test:service-binding:postgres` | Exact Wrangler bundle in a named multi-Worker graph, private binding, auth, real PostgreSQL OCC, and connection cleanup | Live Cloudflare placement or Hyperdrive resource configuration |
| H05 hosted | executor Worker `test:service-binding:hosted:postgres` plus evidence collectors/receipt | Public probe to private Worker binding, cache-disabled Hyperdrive path, hosted traffic, authoritative SQL, source/config/trace/cleanup evidence | Broader product behavior outside the bounded proof |
| Deterministic simulation | Not implemented | Eventually: seeded histories, model invariants, controlled interleavings, replay, shrinking | Platform proof unless paired with adapter lanes; the SAC01-F1 deterministic real-system workload is integration replay, not this simulator |

### Current Command Boundaries

`corepack pnpm test` runs the Effect-boundary script tests and recursive package
`test` scripts. It does **not** invoke `corepack pnpm test:integration`, the
named package `test:postgres` scripts, H04, or H05. Some recursive Vitest suites
still discover `.postgres.test.ts` files: they run when
`FLAREX_POSTGRES_DATABASE_URL` is present and skip otherwise. A root result
therefore proves real Postgres only when its environment and executed/skip
counts are inspected explicitly.

The default executor Worker test command explicitly excludes both service-
binding Postgres files. H04 and H05 are separately named because they require
external state, bundle work, longer timeouts, and cleanup.

The persistence and executor `test:postgres` scripts currently select the
right files, but those files use `describe.skip` when
`FLAREX_POSTGRES_DATABASE_URL` is absent. Therefore those scripts are not yet
fail-closed and a zero-executed-test result must not be reported as green real-
Postgres evidence.

The H04 harness is fail-closed: it requires a database URL, builds/checks the
Worker bundle, creates isolated database state, proves the named binding and
OCC path, checks connection cleanup, and removes scoped data. H05 requires
explicit staging mutation authority and configuration; missing configuration
is an expected failure, not a skip.

## Validation Selection

Use the smallest lane set that covers every changed correctness boundary:

| Changed boundary | Minimum evidence |
| --- | --- |
| Markdown/governance only | Link resolution or relevant static doc checks plus `git diff --check` |
| Pure type/validator/compiler helper | Affected package typecheck and focused positive/negative unit tests |
| Public SDK/generated API | SDK/dev typechecks, focused runtime tests, generated-output typecheck, and relevant consumer/package test |
| Package exports/manifests/bin | Pack tests and fresh consumer when transitive installation changes |
| Backend Worker/DO route | Backend typecheck, focused serialized Miniflare tests, build; hosted adapter tests when host behavior changes |
| Local dev/test SDK | Dev/test SDK typechecks and focused Miniflare lifecycle/invoke/sync tests |
| PGlite schema/transaction/OCC | PGlite focused suite plus matching real-Postgres correctness file |
| SQL migration, lock, isolation, claim/outbox, or query plan | Explicit fail-closed real-Postgres lane; PGlite alone is insufficient |
| Executor Worker import/binding/lifecycle | Worker typecheck, unit tests, Wrangler bundle check, and H04 when service dispatch or database lifecycle changes |
| Hosted routing/Hyperdrive/control plane | Credentialed H05 proof with source/config/data/trace/cleanup receipt |
| Cross-package invoke/runtime protocol | Focused root integration plus owning package tests |
| Workspace-wide shared contract | Affected focused lanes first, then root typecheck/test/build only when the boundary is genuinely cross-cutting |

Broad commands are useful regression sweeps, not substitutes for missing
specialized lanes. If Windows resource pressure or an external dependency
prevents a broad command after focused gates pass, report the exact incomplete
command and preserve the focused receipts; never relabel the broad suite green.

## Invariants And Trust Boundaries

1. **Evidence scope is explicit.** Every result names the command, selected
   boundary, external prerequisites, skip count, and any unrun required lane.
2. **External correctness lanes fail closed.** Missing credentials, database,
   staging opt-in, bundle, or target confirmation cannot become skipped green.
3. **PGlite is fast, not authoritative for PostgreSQL semantics.** Every lock,
   isolation, concurrency, migration, outbox, and plan claim needs the matching
   real-Postgres lane.
4. **Hosted claims require hosted evidence.** Miniflare, workerd, and Wrangler
   dry-run remain necessary lower lanes but cannot close H05.
5. **Tests exercise the real contract path.** SDK/test helpers, runtime hosts,
   and adapters must reuse production domain logic rather than implement a
   parallel semantic backend.
6. **Failure and recovery are first-class.** Transaction rollback, retries,
   cancellation, partial activation, cleanup, duplicate delivery, stale reads,
   and restart/catch-up behavior require assertions, not only happy paths.
7. **External state is isolated and cleaned.** Use unique schemas/databases,
   bounded run IDs, ownership claims, idempotent teardown, and cleanup that does
   not hide the primary failure.
8. **Receipts bind to source and configuration.** Hosted proof must identify
   commit, clean-worktree/source hash, Wrangler version, bindings, target,
   traces, authoritative SQL state, and teardown.
9. **Time and identity are injectable where semantics depend on them.** Tests
   should not rely on wall-clock races or random IDs when deterministic values
   can make histories replayable.
10. **Concurrency tests prove an invariant.** `Promise.all` alone is not proof;
    assert the allowed outcomes and final authoritative state.
11. **Generated and packed consumers remain outside workspace resolution.**
    Workspace imports cannot prove publishable manifests or consumer behavior.
12. **Cleanup and leaked handles are test failures.** Miniflare, workerd,
    database pools/clients, timers, temp trees, and artifact caches need bounded
    ownership and disposal.
13. **No simulator may become a second authority.** Its model is an oracle for
    declared invariants; production code and accepted contracts remain the
    behavior source of truth.
14. **Legacy tests are labeled.** Durable Object storage and Nitro compatibility
    coverage preserve migration safety but do not define the replacement target.

15. **Shared defects cross an explicit ownership gate.** When a real-system
    workload exposes a defect in core or system logic, record the reproducible
    scenario, expected and actual behavior, affected owner, evidence, and
    disposition in its owning roadmap or design note and notify the user before
    changing that owner. The test slice may correct its own harness, but may not
    weaken the scenario or add a substitute core path to obtain green evidence.

## Decisions And Rationale

### Use A Layered Evidence Pyramid

Most changes should fail quickly in pure/unit and PGlite lanes. Expensive real-
Postgres, workerd, and hosted lanes exist only where their semantics are
irreducible. This keeps iteration practical without pretending emulation proves
production.

### Reuse Production Paths

`flarex-test`, local dev, integration materializers, the executor HTTP adapter,
and H04/H05 compose real runtime code. Thin fixtures may provision state or
inject deterministic clocks/IDs, but they cannot own alternate transaction,
analysis, artifact, or sync semantics.

`runtime-topology-probe` is retained only as experimental evidence and an
assertion source. Replacement acceptance must run the real backend, analyzer,
artifact-runtime, generated Dynamic Worker, executor, and Postgres owners; it
must not promote probe-specific routing, commit, storage, or authority code.
Declarative V2 may select verified runtime projections, but the test must use
the existing OCC/commit implementation unchanged.

### Keep External Proof Explicit

Real databases and Cloudflare staging mutate external resources and can be
slow, credentialed, and failure-prone. Named commands, strict configuration,
scoped cleanup, and attributable receipts make those costs visible and prevent
ordinary unit runs from making accidental external calls.

### Build The Simulator Around Postgres Authority

The earlier roadmap proposed a virtual Durable Object cluster as the central
simulation model. That assumption is superseded. Postgres is now the only
authoritative committed app-data store; Cloudflare owns execution,
coordination, WebSockets, and non-authoritative cache state.

The future simulator should therefore model the trusted executor, scope clock,
exact snapshots, read dependencies, commit compiler, idempotency outcomes,
revision/current rows, commit feed, and outbox first. Worker, service-binding,
DO, cache, alarm, and delivery failures belong in adapter/recovery simulation
around that kernel.

### Prefer Model Histories Over Timing-Based Monkey Tests

A useful simulator records a seed and operation history, controls scheduling
points, compares final and intermediate observations with a small reference
model, shrinks failures, and replays the minimal history. Random sleeps,
unseeded request storms, and process restarts without invariant checks are
stress tests, not deterministic simulation.

## Convex Compatibility And Flarex Divergences

Portable Convex testing patterns include:

- `crates/common/src/runtime/mod.rs` for injectable time, randomness,
  scheduling, and I/O boundaries;
- `crates/database/src/transaction.rs` and `committer.rs` for transaction and
  conflict invariants;
- `crates/function_runner` and
  `crates/application/src/application_function_runner` for runner-to-committer
  integration boundaries;
- `crates/sync` for backend-driven subscription state and recovery; and
- npm package/test helpers for generated APIs and developer-facing invocation.

Convex's advanced internal simulation framework is not available as a portable
open-source component. Flarex must build only the model and scheduler seams it
can justify from accepted invariants and current architecture.

Named Flarex differences are:

- Cloudflare splits public backend, artifact runtime, Dynamic Worker, and
  private executor across service bindings, so H04/H05 must prove capability
  boundaries that Convex can test in one owned runtime.
- PGlite supplies a fast in-process SQL lane, but PostgreSQL remains necessary
  for database concurrency and lifecycle semantics.
- Miniflare/workerd exercise Worker, DO, R2, WebSocket, and binding shapes,
  while live Cloudflare evidence is still required for hosted configuration.
- R2/artifact and DO/sync state are non-authoritative or coordination state in
  the replacement design; simulation must not restore legacy DO app-data
  authority.
- Flarex publishes a separately composed SDK/CLI/test package graph, requiring
  tarball and consumer lanes in addition to backend correctness tests.

## Implemented Capabilities

- Package-local Vitest suites across SDK, protocol, analysis, backend,
  persistence, executor, adapters, local dev, freshness, and hosted Workers.
- Serialized Miniflare-heavy backend/dev suites with bounded package-specific
  timeouts for Windows stability.
- PGlite schema, migration, executor, OCC, freshness, live-query, rollback,
  index, catalog, scope-authority, and local-runtime coverage.
- Real-Postgres files covering driver/client lifecycle, concurrency, locks,
  claims, scope clocks/authority, catalogs, schema artifacts/bindings, indexes,
  rollback, retry, and executor deployment authority.
- Root cross-package integration for Nitro/PGlite invocation, materialized
  Miniflare user code, OCC retry/abort, CLI/bin, package tarballs, and a fresh
  offline consumer.
- Test SDK and generated example coverage for query, mutation, invoke, reload,
  reset, disposal, and legacy/Postgres live subscriptions.
- Wrangler bundle checks that reject PGlite, filesystem migration, and control-
  plane imports from the executor Worker.
- H04 named local workerd service binding through the exact Worker bundle to
  real PostgreSQL, including authorization, OCC convergence, connection drain,
  and cleanup.
- Fail-closed H05 configuration, probe, evidence collection, canonical receipt,
  source verification, teardown, and proof-bundle validation infrastructure.
- Deterministic clock/ID injection in executor and integration tests, explicit
  conflict injection, concurrent outcome assertions, and rollback/failure
  coverage in persistence lanes.
- `SAC01-F1` private real-path PGlite workload evidence for one relation-free
  cooking revision through definition, analysis, registration, readiness,
  activation, real Workerd point mutation, exact replay, authoritative point
  query, and deterministic query replay. This is a representative integration
  workload, not a reference model, controlled scheduler, simulator, or
  genuine-PostgreSQL result. Its matching PostgreSQL lane is named and
  fail-closed but remains open until run with an authenticated database URL.
- `SAC01-F2a` reusable private lifecycle/invocation composition for independent
  cooking and English-learning definitions and workload Effects over the same
  real Standard mutation/query owners. Both PGlite consumers pass. This is
  cross-application integration reuse, not a serializable history corpus,
  reference model, controlled scheduler, shrinker, or concurrent
  multi-application environment; its matching PostgreSQL cases remain open.
- `SAC01-F2b` private controlled setup through the existing Standard mutation
  owner and immutable logical inspection of authoritative row-pointer,
  revision, commit-outcome, commit-feed, outbox, and runtime-execution evidence.
  Setup and workload use separate managed scopes. The PGlite lane covers two
  applications plus lifecycle, cancellation, typed inspection failures,
  post-workload freshness, and exact scope/deployment-predicate auditing;
  matching PostgreSQL cases are implemented and fail closed without a URL.
  This exposes neither raw database authority nor document values and remains
  an integration harness capability rather than a model simulator.
- `SAC01-F2c` starts realistic application-shape coverage with the cooking
  simulation while retaining the existing one-row point runtime boundary. Its
  recipe document exercises nested objects, arrays of objects, optional
  fields, literal unions, booleans, records, and nullable values through the
  real Standard definition, runtime, OCC/commit, and authoritative readback
  owners. Logical inspection separately proves the resulting commit sequence
  is aligned across the commit feed and outbox; it does not inspect rich values
  in those projections. The PGlite lane passes. Its genuine-PostgreSQL lane
  remains a separately required acceptance result, and this slice does not
  claim index scans, relation traversal, multi-row atomic mutation, or a model
  simulator.
- `SAC01-F2d` adds the first negative realistic cooking cases without changing
  a shared owner. One nested ingredient has the wrong scalar type and another
  omits a required nested field. The Standard mutation path returns the exact
  protocol-owned `ValidatorValueErrorV1` reason and nested path before runtime
  dispatch. Logical inspection proves both rejections add no runtime execution,
  application row/revision, committed outcome, commit, feed change, or outbox
  entry in PGlite. The matching genuine-PostgreSQL lane remains open.
- `SAC01-F2e` exercises the complete existing single-document mutation
  lifecycle without widening point authority. Separate public cooking modules
  patch two fields, replace the full recipe, and delete it; every operation is
  immediately replayed under its original request key. Authoritative queries
  prove patch preservation, full replacement, and the final null read, while
  logical inspection proves one tombstoned current row, four revisions, and
  commit sequences `1..4` aligned across outcomes, feed, and outbox in PGlite.
  Cooking and English-learning now own directly inspectable function-source fixtures in
  their application folders; the shared definition helper accepts source bytes
  and only composes declarations, validators, graph entries, and budgets. This
  is not automatic developer-file discovery or bundler coverage. The matching
  genuine-PostgreSQL lane remains open.
- `SAC01-F2f` extends that same cooking application with application-owned
  derived assessment and publication workflow modules. The Standard definition
  declares one private assessment query, one public assessment query, one
  private publication mutation, and one public publication mutation through
  the test-owned supplemental-function-module config. The public query calls
  the internal query; the public mutation calls that internal query and the
  internal mutation; and the internal mutation reads before and after its
  staged patch through the same journal. PGlite/Workerd proves custom derived
  values, one authoritative nested publication, exact replay without runtime
  re-execution, persisted readback, the final tombstone, and commit/outcome/feed/
  outbox sequences `1..5`. This reuses SAP06-A1/A2/A3 and the existing OCC/
  commit owners; it adds no alternate transaction or child-savepoint semantics.
  The matching genuine-PostgreSQL lane remains implemented but requires an
  authenticated URL. The work also exposed and resolved the test-owned
  `ST-CORE-004`, exposed the reproducible shared-boundary mismatch
  `ST-CORE-005` (now resolved), and exposed the now-resolved rejected-token
  restart-ownership defect `ST-CORE-006`. Their evidence and authority
  boundaries live in the package ledger rather than being hidden in simulation
  glue.
- `SAC01-F2g` broadens the cooking workload without adding a new runtime or
  persistence owner. A second independently keyed recipe omits an optional
  field, carries a Unicode localized-title record, and is created and replayed
  through the same Standard point-mutation path. The original recipe then
  completes its patch, replace, nested publication, and delete lifecycle while
  authoritative reads prove the second row remains unchanged and live. Three
  additional rejected creations cover a literal-union mismatch, a record-value
  mismatch, and an unexpected top-level field; inspection must prove all five
  invalid inputs remain pre-runtime and side-effect free. PGlite and genuine
  PostgreSQL use the same application definition and workload. This is
  multi-row isolation evidence over existing point operations, not a multi-row
  atomic mutation, relation traversal, index scan, reference model, controlled
  scheduler, or public Test SDK.
- `SAC01-F2h` adds user-code failure atomicity to that same cooking revision.
  Two declared point mutations each stage a real recipe patch: one then returns
  a value rejected by its Standard return validator and one throws from user
  code. Both must surface the executor-owned
  `PointMutationOccUserCodeV1Error`, execute exactly once, and leave current
  rows, revision history, committed idempotency outcomes, commit feed, and
  outbox unchanged. An authoritative read after both failures must recover the
  original recipe value before the successful lifecycle continues. This is
  application-level rollback evidence over the existing journal/OCC/commit
  owner; it adds no alternate transaction, retry, savepoint, or failure API.
- The next cooking-domain invariant slice is preflighted but intentionally not
  implemented. A root handler can construct a public `FlarexError` and the
  exact Workerd runtime preserves its application-owned code, message, and
  canonical data, but the V1 point-mutation host envelope reduces every such
  failure to `userCodeFailed`; the executor then exposes only a fresh generic
  cause. `ST-CORE-014` records the reproduction, owner boundary, prohibited
  test-local workarounds, and required acceptance evidence. This simulation
  roadmap does not authorize the shared protocol/executor change.
- `SAC01-G` private `@flarex/system-test` extraction. The package owns the
  real-system environment, unified `defineStandardApplicationSimulationV1`
  configuration contract, logical inspection, database lanes, and separate
  cooking and English-learning simulation folders. The config owns application
  identity, definition, setup/workload callbacks, and optional deterministic
  runtime-execution expectations; the database lane remains runner input. Its
  PGlite/Workerd lane reuses the existing
  FlarexDB/OCC/commit owners, and package-boundary tests reject reverse
  dependencies, source-tree escapes, and undeclared package edges across every
  TypeScript module-reference form. The historical FSV/SAP/PQV cross-owner
  integration suites move with their composition harnesses; persistence keeps
  its narrow storage regressions and publishes no test adapter. It remains
  integration replay rather than a model simulator,
  controlled scheduler, shrinker, generated history corpus, or public Test SDK.
- Effect runtime-boundary static enforcement and its own regression tests.

## Known Gaps And Limitations

- Root `pnpm test` omits root integration, H04, and H05 and does not guarantee
  that conditionally discovered real-Postgres files executed; there is no
  single machine-readable lane manifest or aggregate correctness command.
- Persistence and executor `test:postgres` commands can exit successfully with
  every selected suite skipped when the database URL is absent.
- No repository CI configuration currently shows which lanes are mandatory,
  conditional, scheduled, or release-gating.
- `@flarex/system-test` resolved the original analyzer arena/finalization
  defects `ST-CORE-001` through `ST-CORE-003`. The richer cooking workload then
  exposed the now-resolved aggregate-budget/per-record restart-codec defect
  `ST-CORE-005`. Minimized arrow and construction vectors then reproduced and
  resolved `ST-CORE-006`: these constructs remain typed canonical rejections,
  while their diagnostic-bearing module results now retain parser-owned
  rejection-terminal identity through restart serialization. `ST-CORE-007`
  then corrected the restart sequence's contradictory rejection of a
  module-owned link-phase diagnostic after a direct call. Its real Standard
  acceptance check exposed open `ST-CORE-008`: diagnostic-bearing parse
  evidence currently lacks an authenticated aggregate lifecycle gate before
  readiness and activation. The evidence, owners, limitations, and acceptance
  requirements remain in
  [`CORE-ISSUES.md`](../packages/system-test/CORE-ISSUES.md).
- The proposed cooking application-invariant coverage is blocked by open
  `ST-CORE-014`: root `FlarexError` evidence is preserved within Workerd but
  lost by the reason-only point-mutation host response and generic executor
  projection. The simulation must not compensate with a result wrapper,
  fallback, or weaker generic-error assertion. A separately approved versioned
  protocol/executor slice is required before the cooking workload can claim
  structured application-error behavior end to end.
- The live staging H05-B proof through real cache-disabled Hyperdrive remains
  incomplete; harness and dry-run evidence do not close production activation.
- The root integration suite uses source aliases and local workspace code for
  most files. Only the pack/fresh-consumer lane catches distribution isolation.
- Fresh-consumer installation uses local tarballs, linked external packages,
  offline store state, and overrides; registry publication, provenance,
  upgrade, and version-skew behavior are unproven.
- `flarex-test` has no package-local tests of its own (`--passWithNoTests`);
  decisive coverage currently lives in example and integration consumers.
- There is no browser-run Vite/WebSocket end-to-end lane, multi-browser matrix,
  SSR/Next.js lane, or reconnect/network-loss client suite.
- There is no deterministic simulator, reference model, controlled scheduler,
  shrinking, or generated history corpus. `SAC01-F1` through `SAC01-F2b` now
  provide two independent real-path PGlite replay workloads through private
  `@flarex/system-test` composition and a typed simulation config with
  controlled setup and logical inspection, but workload policy remains
  code-owned and does not close those simulation gaps.
- Current fault coverage is hand-authored. It does not systematically explore
  crashes between commit/outbox/notify, service-binding loss, delayed/duplicate
  delivery, artifact eviction, DO restart, or recovery catch-up.
- Real-Postgres tests use disposable schemas/databases but no published version
  matrix, extension matrix, long-running soak, or production query-plan budget.
- PGlite/Miniflare suites are broad and sometimes resource-sensitive on
  Windows; there is no durable flake quarantine, retry prohibition, timing
  telemetry, or slow-test budget.
- Coverage is organized by files and commands, not a traceable invariant-to-
  lane inventory. Important negative/recovery cases can still be omitted while
  aggregate test counts look healthy.
- Legacy DO and Nitro tests remain intermingled with forward evidence unless
  individual names/context are inspected.

## Target Direction

The target is a small, explicit evidence system:

```text
changed invariant
  -> declared owning domain and minimum lanes
  -> deterministic unit/model checks
  -> PGlite fast integration
  -> real Postgres when database semantics matter
  -> exact Worker/workerd boundary when host composition matters
  -> hosted receipt when Cloudflare configuration matters
  -> attributable command result with zero hidden skips
```

For the replacement correctness kernel, deterministic simulation should
eventually explore histories such as:

```text
provision scope and generation
  -> open exact snapshots
  -> interleave reads and staged logical writes
  -> compile and attempt commits
  -> retry, duplicate, abort, expire, or crash
  -> replay commit feed/outbox and recover consumers
  -> compare every observable result with the reference model
```

Cloudflare fault layers can then inject unavailable service bindings, artifact
eviction, Worker restart, dropped wakeups, duplicate delivery, delayed alarms,
and stale non-authoritative caches without changing the Postgres oracle.

## Next Correctness Gates

1. **Make lane activation honest.** Add a documented/machine-readable lane
   manifest and fail-closed wrappers that report selected, passed, failed,
   skipped, and unavailable tests. Make both package `test:postgres` commands
   fail when their required database is absent.
2. **Define aggregate commands without overclaiming.** Separate fast,
   integration, real-Postgres, H04, and H05 commands; make the default and
   release gate explicit. Do not silently add external mutation to `pnpm test`.
3. **Bind active foundation work to invariant tests.** D2d is closed by focused
   PGlite facade/retry, declaration/work-cap, and staged byte-guard coverage
   plus a real-Postgres proof at the current 256-item operational boundary,
   concurrent replay, competing publication, separate table/index stale
   recovery, terminal conflict, and late rollback proof. This is a bounded
   correctness/regression gate, not a hosted-performance SLA. Apply the same
   explicit proportional pure/PGlite/real-Postgres boundary to every applicable
   schema/OCC/compiler gate before marking it complete.
4. **Close H05-B.** Run the credentialed staging proof, collect control/data/
   trace/source/cleanup evidence, validate the canonical bundle, and retain an
   attributable receipt without committing secrets or mutable staging state.
5. **Create the first deterministic model runner.** Start with the smallest
   accepted scope-clock plus point-read/point-mutation commit slice. Inject
   clock/IDs, record seed/history, compare with a reference model, replay, and
   shrink. Do not begin with a generic virtual Cloudflare cluster.
6. **Add recovery fault layers.** After the core model is stable, inject commit
   conflicts, retry exhaustion, crash boundaries, lost wakeups, duplicate
   outbox delivery, artifact eviction, sync actor restart, and catch-up; prove
   authoritative state and externally visible outcomes converge.
7. **Add consumer and browser release gates.** Test published-like compiled
   packages, registry installation, version upgrades/skew, Vite browser
   WebSocket reconnect, and SSR only as those product surfaces become real.
8. **Operationalize the matrix.** Add CI/scheduled/release ownership, database
   version coverage, timing/flake telemetry, retained failing seeds, and a
   concise invariant-to-lane index.
