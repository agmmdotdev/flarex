# Testing And Simulation Strategy

## Status And Scope

**Status:** Active domain authority with broad unit, PGlite, Miniflare,
packaging, real-Postgres, workerd/service-binding, and hosted-proof harnesses.
`TQ-A1` now exposes the stable lane matrix through one machine-readable
manifest and fail-closed selectors. Milestone-alias convergence, test-level
execution telemetry, live hosted H05 evidence, and a deterministic model
simulator remain incomplete. The docs-only `TQ-P` inventory and bounded
`TQ-A1` orchestration slice are complete. The `TQ-B` Application-native query
pilot is implemented, PGlite-validated, and package-typechecked, with genuine
PostgreSQL acceptance still pending; later work remains separately gated.

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

The current cross-package command, activation, concentration, pair, and ranked
consolidation baseline lives in
[`testing-and-simulation-inventory.md`](./testing-and-simulation-inventory.md).

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

[`test-lanes.json`](../test-lanes.json) owns stable fast, PGlite, integration,
real-Postgres, H04, H05, and release selectors. The root `test:lane:*` commands
run them through [`scripts/run-test-lane.mjs`](../scripts/run-test-lane.mjs),
which validates every selected lane prerequisite before starting any step and
emits a structured lane receipt. The persistence, executor, and system-test
`test:postgres` commands delegate to that manifest and therefore fail before
Vitest when `FLAREX_POSTGRES_DATABASE_URL` is absent. This prevents a selected
PostgreSQL sweep from becoming a false green even though conditionally
discovered PostgreSQL files can still skip under broader default commands.
Fast, PGlite, and root-integration lane children remove an inherited
`FLAREX_POSTGRES_DATABASE_URL`; the PGlite persistence selector also excludes
the three legacy unsuffixed PostgreSQL-owned suites, so those stable local lanes
cannot unexpectedly activate external database work.

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
- `SAC01-F2i` resolves `ST-CORE-014` and adds the first cooking-domain
  invariant with developer-visible structured failure. Point-mutation Host
  Response V2 directly replaces V1, preserves only authenticated and bounded
  `FlarexError` code/message/canonical data after journal settlement, and maps
  it to the executor-owned `PointMutationOccApplicationErrorV1`; generic user
  defects remain redacted. An incomplete but schema-valid second recipe calls
  an internal assessment query, fails publication with
  `RECIPE_NOT_PUBLISHABLE`, and is read back unchanged. Logical inspection
  proves the failed runtime added no row revision, committed idempotency
  outcome, commit, feed change, or outbox item before the successful lifecycle
  continues. This adds no alternate runtime, journal, OCC, commit, schema,
  persistence, activation, or routing owner. The parity audit records the
  separate open root-query projection gap as `ST-CORE-015` rather than hiding
  it in test glue.
- `SAC01-F2j` proves one deterministic cooking concurrency history over
  the existing Standard mutation and OCC owners. The private system-test
  client can safely expose the mutation harness's existing one-shot
  post-runtime/pre-commit interleaving point without exposing persistence,
  journals, commit capabilities, or retry control. The application mutation
  stages both a pantry decrement and recipe publication. Its preflight exposed
  the former singleton material-row planner limit as `ST-CORE-016`; the user
  approved bounded O09-A to extend the existing planner and transaction rather
  than adding test glue or another commit path. The PGlite Workerd proof now
  shows one competitor committing both rows, the original attempt conflicting
  and rerunning through O08, the rerun returning `INSUFFICIENT_STOCK`, no
  negative inventory or partial recipe publication, exact two-row commit-feed
  evidence, one outcome/outbox record, and replay without another runtime or
  commit. The genuine-PostgreSQL lane is accepted, and the direct point-commit
  suite retains its 128-row ceiling, exact intrinsic-sidecar assertions, and
  settlement-bounded eight-writer contention profile. No scheduler,
  model checker, retry API, alternate OCC/commit path, or production behavior
  is authorized by this slice.
- The O10-C cooking indexed-range preflight opened `ST-CORE-019`. The Standard
  definition can declare and publish a developer ordered index, C08 can
  maintain its S10 entries during later point commits, and readiness plus the
  indexed journal correctly require an enabled build. However, the only
  implemented C4 build executor is intrinsic-creation-time-only and rejects a
  developer definition. The simulation must remain blocked rather than seed
  enabled build state or add test-owned backfill/lowering logic. A separate
  production-inert C08 developer ordered-index build prerequisite is required
  before the cooking scenario can honestly prove indexed business decisions,
  phantom conflict, O08 rerun, rollback, and PostgreSQL plan behavior.
- O10-C closed `ST-CORE-020` through the Standard composition owner. Trusted
  host setup constructs one authenticated indexed-query port from the exact
  control database, session authority, and developer-index definition
  authority and passes it to the existing journal owner. The cooking simulation
  now proves a real indexed business decision, phantom-triggered replacement,
  losing-write rollback, replay, and terminal journal cleanup in PGlite and
  genuine PostgreSQL without a test-owned resolver.
- `SAC01-F2k` resolves `ST-CORE-021` and extends the cooking point lifecycle
  with real optional-field deletion. Point and indexed journal RPC admission
  now validates only the runtime bigint syscall sequence; canonical decimal
  strings remain encoded protocol/storage representations and are rejected at
  runtime admission. The test-only HTTP bridge preserves bigint and
  `undefined` with a tagged structured-value codec rather than masking the
  production RPC shape. The analyzed cooking mutation removes an existing
  `description`, replays without another runtime execution, reads the field as
  absent through the public query, proves the authoritative stored JSON omits
  it, and moves all three index sidecars to the deletion revision in PGlite and
  genuine PostgreSQL. This remains one active relation-free revision and does
  not yet authorize multi-revision schema compatibility or managed deployment.
- `SAC01-F2l` has a completed preflight and `M01-A` pure classifier in the
  separate private `@flarex/managed-schema` package plus the protocol-only
  `M01-B` candidate-validation frames. After managed-schema gates `M02`
  through `M03-C` exist, a separate cooking
  scenario must prove populated-field removal refusal and remediation,
  required-field expand/backfill/contract, validator tightening, concurrent
  candidate shadow validation, supersession, exact readiness and activation,
  and stale-attempt retry through the real analysis, runtime, journal/OCC,
  commit, storage, and inspection owners. The system-test package must not
  supply its own schema scanner, readiness receipt, activation pointer, or
  commit path to make those cases pass. Pure policy/model tests, golden
  protocol vectors, and one PGlite/PostgreSQL repository contract suite precede
  that end-to-end scenario.
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

## Test Quality Consolidation Preflight

**Status:** `TQ-P` inventory and the bounded `TQ-A1` lane-orchestration slice
are complete. The approved `TQ-B` Application-native query pilot is implemented,
PGlite-validated, and package-typechecked; its genuine PostgreSQL acceptance
remains open. The approved `TQ-C` Application-native mutation localization work
is in progress through a bounded candidate-guard observation slice. Remaining
`TQ-A`, later `TQ-C`, `TQ-D`, and `TQ-E` work requires separate implementation
approval. No test deletion, lane merger, fixture-lifetime change, or package
extraction is authorized by this section alone.

The repository has accumulated substantial correctness evidence through
roadmap checkpoints, but the executable shape has also accumulated milestone-
named package scripts, very large mixed-responsibility test files, repeated
PGlite/PostgreSQL lane wrappers, and system harnesses that collapse many
independent invariants into one aggregate proof receipt. Aggregate file or test
counts no longer communicate which invariant is uniquely protected, which lane
is decisive, how a failure localizes, or whether an older checkpoint test is
still stronger than its successors.

The correction is an evidence-architecture and maintainability program, not a
test-count reduction target. A consolidation is successful only when it makes
the protected invariant, owning domain, required lane, resource lifetime, and
failure signal more explicit. Deleting lines, shortening a package script, or
moving code into a shared harness is not by itself an improvement.

### Quality Model

Every retained correctness test should be classifiable as one of:

1. a pure policy, codec, type-contract, or deterministic model test owned by
   one domain;
2. a reusable contract suite whose complete behavioral contract is identical
   across two or more adapters;
3. a lane-specific persistence or host test whose database, transaction,
   concurrency, runtime, packaging, or Cloudflare semantics are themselves the
   subject;
4. a bounded cross-domain system scenario that composes production owners and
   returns attributable observations;
5. an explicitly named legacy or compatibility regression with a retained
   consumer or removal gate; or
6. a candidate duplicate or obsolete checkpoint test that must remain until an
   invariant-preservation review proves it can be removed.

The invariant inventory, rather than file names or roadmap chronology, becomes
the durable index. Each entry records the stable invariant, owner, minimum
lanes, decisive tests or contract suite, environment prerequisites, expected
runtime class, and any legacy/removal condition. One test may protect several
tightly connected facets of one invariant, but a long scenario must not hide a
catalog of unrelated Boolean success flags behind one test name.

### Harness Reuse Boundary

Reuse the exact mechanics that have one real owner:

- scoped environment construction and disposal;
- authenticated database provisioning and schema isolation;
- deterministic clocks, identifiers, deferred signals, and bounded fault
  controls;
- canonical fixture factories and observation/receipt collection; and
- a contract-suite definition when every participating adapter must satisfy the
  same behavior.

Keep domain decisions, expected failures, final assertions, lane-specific
semantics, and compatibility policy with their owning tests. A shared harness
must not become a second runtime, scheduler, persistence implementation, retry
loop, outcome classifier, or authority reconstruction. Prefer typed
observations such as stored rows, attempts, commits, feeds, outputs, and
failure tags over aggregate `true` fields that merely report that hidden
harness assertions ran.

PGlite and PostgreSQL may share a contract suite only for the exact portable
contract. PostgreSQL locking, isolation, SQLSTATE, transaction cancellation,
query-plan, extension, and connection-pool behavior remains PostgreSQL-owned.
PGlite facade and compatibility behavior remains PGlite-owned. Workerd,
Miniflare, packaging, and hosted boundaries likewise remain distinct even when
they consume the same scenario input.

Fixture reuse must preserve cancellation and isolation semantics. File-scoped
database reuse is allowed only for bounded tests that cannot remain active
after a runner timeout. Deferred, held-lock, fiber, trigger/DDL, interruption,
and similar suspendable tests retain disposable isolation unless a separately
validated lifecycle owner can cancel and settle every operation before reuse.

### Consolidation Gates

The work proceeds in bounded gates:

1. **`TQ-P` — inventory and baseline. Complete.** The living
   [`test evidence inventory`](./testing-and-simulation-inventory.md) records
   invariant families and minimum lanes, permanent versus checkpoint command
   concentration, hidden-skip behavior, file and harness concentrations,
   cross-lane pair classifications, the missing runtime-telemetry baseline, and
   ranked pilots without changing executable tests.
2. **`TQ-A` — honest lane orchestration.** This remains split so manifest
   authority is not confused with wholesale command deletion:
   - **`TQ-A1` — stable selectors and fail-closed prerequisites. Complete.**
     [`test-lanes.json`](../test-lanes.json) and the checked runner expose fast,
     PGlite, integration, PostgreSQL, workerd, hosted, and release selectors.
     All selected prerequisites are checked before execution; each run emits
     selected, passed, failed, skipped, and unavailable lane outcomes with the
     failing step when applicable. The three stable package PostgreSQL sweeps
     now delegate to this authority. Manifest validation also removed the stale
     persistence reference to the no-longer-present C07 PostgreSQL file rather
     than silently preserving command drift.
   - **`TQ-A2` — milestone-alias convergence.** Retain an alias only while a
     live roadmap or operator workflow names it, and move retained aliases to
     manifest-owned lane or invariant selectors instead of independently
     maintained file lists. Default recursive discovery still needs explicit
     skip attribution before it can claim conditional PostgreSQL evidence.
     The first bounded pilot retains the live `C08-B1a` and `C08-B1b`
     PostgreSQL command names from roadmap 04 while resolving both through one
     `c08-b1-postgres` lane; their distinct PGlite commands remain unchanged.
     This exact duplicate removal does not authorize merging the milestones or
     assuming that other similarly named commands protect the same invariant.
     The second bounded pilot likewise retains `DTE05-E2B` and `DTE05-E2C1`
     PGlite command names but routes their identical checkpoint regression
     through one `dte05-repair-checkpoint-pglite` lane. The lane is explicitly
     E2B-owned lower-layer evidence reused by E2C1; E2C1's executor and genuine-
     PostgreSQL connected-runner gates remain separate and decisive.
     The first near-duplicate pilot retains the live C08-B2 and O09-B PGlite
     and PostgreSQL commands. Ordered manifest test-file groups expand inside
     each original single Vitest invocation, so O09-B owns the shared unique-
     key/contention files while C08-B2 prepends its definition-lowering proof.
     This removes repeated file spelling without splitting process, fixture,
     ordering, timeout, or lane boundaries.
     The expanded O09-B PGlite lane currently reaches the intended tests but is
     red on shared-owner issue `C04A-VAL-001`, recorded in
     [`03-commit-compiler.md`](./flarexdb-foundation/03-commit-compiler.md).
     The former direct Vitest command reproduces the failure, so TQ-A2 stops at
     that ownership boundary and does not weaken or repair the journal decoder.
3. **`TQ-B` — one contract-suite pilot. Implemented; acceptance pending.** The
   Application-native query pair now defines its identical scenario name and
   proof assertion once behind a typed `runScenario<A>` adapter. The PGlite
   wrapper retains its fixture factory, while the PostgreSQL wrapper retains
   fail-closed environment activation plus temporary split-database provisioning
   and cleanup. The underlying harness requires an explicit fixture factory and
   crosses the Effect test boundary through the system-test runner helper. The
   focused PGlite suite passes. A single before/after sample measured 9.12/10.24
   seconds total and 4.16/4.32 seconds of test time, which is insufficient to
   claim a runtime change. With the PostgreSQL credential absent, the focused
   lane reports its explicit environment failure and skips the contract rather
   than passing falsely. The focused package typecheck passes. Genuine
   PostgreSQL execution remains pending; do not widen the pattern until that
   acceptance check is green. Application-native mutation is proceeding through
   `TQ-C` failure-localization work rather than a generic wrapper around its
   aggregate proof.
4. **`TQ-C` — monolith decomposition. In progress.** Split one oversized mixed-
   owner suite by invariant/domain boundary while retaining one exact fixture
   owner. The first bounded Application-native mutation slice replaces the four
   candidate-schema write-guard `true` fields with one typed observation whose
   exact, copied, foreign-authority, and missing cases retain their own
   disposition, while rejected cases expose their error tag and reason. The
   existing fixture, mutation ordering,
   aggregate runtime, and PGlite/PostgreSQL wrappers remain intact; no contract-
   suite reuse or test deletion is introduced. The touched Effect calls now use
   the established system-test runtime boundary helper instead of local raw
   runners. The focused PGlite suite and package typecheck pass. Without a
   PostgreSQL credential, that lane reports its explicit environment failure and
   skips the aggregate scenario. A single before/after sample measured
   11.75/13.06 seconds total and 6.51/7.67 seconds of test time, which is not
   sufficient to infer a runtime change. Replay, validation, concurrency, OCC,
   head movement, and terminalization remain aggregate follow-up work. File size
   is a review signal, not a deletion rule; later slices must improve attribution
   without weakening ordering, concurrency, transaction, or fault evidence.
5. **`TQ-D` — evidence-preserving pruning.** Remove a duplicate or obsolete
   test only when the inventory identifies the retained stronger proof, its
   required lanes execute without hidden skips, a relevant negative/fault case
   still fails for the intended reason, and no shipped compatibility or
   migration consumer depends on the displaced coverage.
6. **`TQ-E` — maintenance ratchet.** Record per-lane timing and skip telemetry,
   prohibit retry-based flake masking, require explicit justification for new
   very large test/harness files or permanent milestone commands, and review
   new coverage against the invariant inventory.

Each implementation-bearing gate is its own bounded slice. Test behavior,
expectation, fixture-lifetime, public contract, or package-boundary changes are
significant code changes and require the standing reviewers and proportional
lane validation before commit. A scenario that exposes a shared-owner defect
continues to follow the repository stop-and-record rule; consolidation does not
authorize repairing or reproducing that owner inside test code.

## Known Gaps And Limitations

- Root `pnpm test` omits root integration, H04, and H05 and does not guarantee
  that conditionally discovered real-Postgres files executed. Use the explicit
  `test:lane:*` selectors for attributable lane evidence.
- The lane receipt is lane-level. Vitest case/file selection, skip counts,
  timing history, and flake outcomes remain `TQ-E` work, so a default recursive
  suite must not be treated as proof of every conditionally discovered file.
- Milestone-named package commands still duplicate many historical file lists;
  `TQ-A2` owns their evidence-preserving convergence.
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
- Root query application-error parity remains open as `ST-CORE-015`. The query
  Workerd dispatcher currently projects only failure name/message and cannot
  preserve authenticated application data; mutation Host Response V2 does not
  authorize a query-specific protocol or dispatcher change.
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
- Roadmap checkpoint commands have accumulated as permanent package-script file
  lists. Their overlap, current consumers, and retirement conditions are not
  represented by one stable lane manifest.
- Several large suites and private system harnesses combine setup, orchestration,
  fault control, assertions, and aggregate proof projection. This makes focused
  reruns, ownership review, and failure attribution harder even when their
  underlying coverage is valuable.
- There is no repository test-maintainability ratchet for permanent command
  growth, exceptionally large test/harness files, duplicated lane assertions,
  or measured runtime concentration.
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

1. **Continue retained-alias convergence through `TQ-A2`.** `TQ-A1` owns
   stable fail-closed lane activation. The exact C08-B1a/B1b PostgreSQL and
   DTE05-E2B/E2C1 PGlite duplicates are thin-selector pilots with their
   different semantic roles recorded. The C08-B2/O09-B ordered-subset family is
   the bounded near-duplicate pilot. Remaining historical aliases need a live-
   consumer/removal review; do not add generic sharing for low-overlap lists
   merely to reduce manifest lines.
2. **Keep aggregate commands explicit.** Fast, integration, real-Postgres,
   H04, H05, and release selectors are separate; do not silently add external
   mutation to `pnpm test`. Add test-level skip/timing attribution through
   `TQ-E` before making broader claims from a lane pass.
3. **Finish bounded `TQ-B` acceptance.** Run the Application-native query
   contract against genuine PostgreSQL. The focused package typecheck is green;
   preserve the implemented shared scenario/assertion contract and each lane's
   activation, fixture construction, and resource-lifetime ownership.
4. **Continue bounded `TQ-C` localization.** Keep the candidate-guard typed
   observation, then separate the next independent Application-native mutation
   invariant without changing the shared fixture, sequential state transitions,
   or lane-specific resource ownership. Do not introduce cross-lane contract
   reuse while `TQ-B` PostgreSQL acceptance remains open.
5. **Bind active foundation work to invariant tests.** D2d is closed by focused
   PGlite facade/retry, declaration/work-cap, and staged byte-guard coverage
   plus a real-Postgres proof at the current 256-item operational boundary,
   concurrent replay, competing publication, separate table/index stale
   recovery, terminal conflict, and late rollback proof. This is a bounded
   correctness/regression gate, not a hosted-performance SLA. Apply the same
   explicit proportional pure/PGlite/real-Postgres boundary to every applicable
   schema/OCC/compiler gate before marking it complete.
5. **Close H05-B.** Run the credentialed staging proof, collect control/data/
   trace/source/cleanup evidence, validate the canonical bundle, and retain an
   attributable receipt without committing secrets or mutable staging state.
6. **Create the first deterministic model runner.** Start with the smallest
   accepted scope-clock plus point-read/point-mutation commit slice. Inject
   clock/IDs, record seed/history, compare with a reference model, replay, and
   shrink. Do not begin with a generic virtual Cloudflare cluster.
7. **Add recovery fault layers.** After the core model is stable, inject commit
   conflicts, retry exhaustion, crash boundaries, lost wakeups, duplicate
   outbox delivery, artifact eviction, sync actor restart, and catch-up; prove
   authoritative state and externally visible outcomes converge.
8. **Add consumer and browser release gates.** Test published-like compiled
   packages, registry installation, version upgrades/skew, Vite browser
   WebSocket reconnect, and SSR only as those product surfaces become real.
9. **Operationalize the matrix and `TQ-E`.** Add CI/scheduled/release
   ownership, database version coverage, timing/flake telemetry, retained
   failing seeds, and a concise invariant-to-lane index.
