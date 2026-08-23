# Test Evidence Inventory

## Status And Authority

**Status:** Active inventory. `TQ-P` and the bounded `TQ-A1` stable-lane slice
are complete. Historical alias convergence remains `TQ-A2`; runtime timing and
test-level skip attribution remain explicit telemetry gaps rather than inferred
results.

This file is the living operational inventory for
[`11-testing-and-simulation-strategy.md`](./11-testing-and-simulation-strategy.md).
Code, package manifests, Vitest configuration, and tests own exact executable
behavior. Roadmap 11 owns lane meaning, evidence policy, and consolidation
rules. Update this inventory when orchestration, major test ownership, or the
ranked consolidation direction changes materially; do not append chronological
checkpoint receipts.

This inventory is diagnostic. It does not authorize deleting tests, merging
lanes, changing fixture lifetime, moving package ownership, weakening an
assertion, or repairing a shared owner exposed by a scenario.

## Inventory Scope And Method

The current baseline covers first-party files under `packages/`, `apps/`,
`integration/`, `scripts/`, and `tools/`. It excludes `third_party`, installed
dependencies, and Codex worktrees. The test surface includes runnable
`*.test.*` and `*.spec.*` files plus non-runnable fixtures, harnesses, and
support modules under `test`, `tests`, `integration`, or `support` directories.

The numeric baseline reflects the current worktree, including concurrent
in-progress files. Counts are concentration signals, not quality scores or
removal targets. The approximate case count is a lexical count of `test(...)`
and `it(...)`, not an executed Vitest receipt. No repository-owned structured
timing history exists, so this inventory does not claim the slowest tests from
timeouts or file size alone.

## Current Concentration Baseline

| Surface | Current observation | Meaning |
| --- | ---: | --- |
| Combined test/support files | 916 | Broad maintenance surface, not runnable-test count |
| Runnable `test`/`spec` files | 779 | Files selected only according to their package/config/command rules |
| Non-runnable support/harness files | 137 | Fixture and orchestration concentration |
| Combined lines | 387,880 | Diagnostic scale; generated and third-party sources excluded |
| Approximate cases | 5,494 | Lexical estimate, not an executed or passed count |
| Files above 500 lines | 214 | Review candidates |
| Files above 1,000 lines | 81 | Explicit ownership/decomposition review candidates |
| Files above 2,000 lines | 23 | High-concentration candidates |
| Files above 4,000 lines | 9 | Highest-concentration candidates |

The concentration is uneven:

| Owner | Runnable files | Support files | Combined lines | Approximate cases | Current interpretation |
| --- | ---: | ---: | ---: | ---: | --- |
| `@flarex/persistence-postgres` | 224 | 44 | 148,386 | 1,584 | Largest surface; portable PGlite behavior and PostgreSQL-only correctness are intermingled by naming and commands |
| `flarex-backend` | 150 | 15 | 71,268 | Route, DO, runtime-host, R2, Miniflare, and compatibility evidence |
| `@flarex/system-test` | 68 | 50 | 33,303 | Support/orchestration dominates case count; cross-domain proof must remain test-owned |
| `@flarex/executor` | 40 | 7 | 29,042 | Session, journal, authentication, retry, redelivery, and scheduling policy |
| `flarex-protocol` | 77 | 0 | 23,259 | Mostly domain-owned codec and contract vectors; comparatively direct failure localization |
| `flarex-dev` | 21 | 2 | 12,042 | Local materialization/runtime and compatibility behavior |
| `runtime-topology-probe` | 29 | 3 | 11,746 | Miniflare and topology/probe evidence with specialized runtime cost |
| `@flarex/executor-http` | 6 | 0 | 8,705 | Few files with broad HTTP route/codec matrices |
| executor Worker app | 52 | 3 | 8,625 | H04/H05 support plus Cloudflare evidence and configuration contracts |
| `@flarex/durable-task` | 21 | 3 | 6,846 | Domain lifecycle and retained compatibility vectors |

`@flarex/system-test` is the clearest harness-maintainability signal: its
support modules carry substantially more code than its runnable assertions.
That is not automatically wrong because it composes real owners, but new
capabilities must reduce or reuse exact mechanics rather than grow another
scenario-specific environment.

## Command And Activation Inventory

The workspace and first-party package manifests currently expose 185 scripts
whose names begin with `test`:

| Command characteristic | Count |
| --- | ---: |
| Default `test` commands | 28 |
| Named test commands | 157 |
| Names containing `pglite` | 64 |
| Names containing `postgres` | 66 |
| Explicit test-file references across package commands | 231 |
| Unique explicitly referenced test files across package commands | 180 |

Two manifests dominate the command catalog:

| Manifest | Test commands | Named commands | Current issue |
| --- | ---: | ---: | --- |
| [`packages/persistence-postgres/package.json`](../packages/persistence-postgres/package.json) | 70 | 69 | Roadmap aliases repeat overlapping file lists; one file can appear in as many as six named commands |
| [`packages/system-test/package.json`](../packages/system-test/package.json) | 54 | 53 | Nearly every completed vertical retains separate PGlite/PostgreSQL aliases |

Repeated command membership is not additional evidence. For example, the
PGlite migration suite is named by six commands, stored-attempt evidence by
five PGlite commands, and the real-PostgreSQL point-commit transaction suite by
five commands. `TQ-A1` moved the three stable PostgreSQL sweep lists behind the
root lane manifest. `TQ-A2` must preserve useful operator/roadmap aliases while
making retained names resolve through manifest-owned lane or invariant
selectors instead of independently maintained file lists.

The first `TQ-A2` pilot found one exact live duplicate: roadmap 04 still names
both `test:c08-b1a:postgres` and `test:c08-b1b:postgres`, and both commands ran
only `appUniqueConstraintSetBuildV1.postgres.test.ts` with identical runner
options. Both names now resolve to one fail-closed `c08-b1-postgres` lane. The
different B1a/B1b PGlite lists remain separate, so this is command-list
deduplication rather than milestone or invariant merger.

The second exact duplicate is the PGlite checkpoint regression named by both
`test:dte05-e2b:pglite` and `test:dte05-e2c1:pglite`. No in-repository roadmap,
script, or workflow invokes either command name directly, so both are retained
as compatibility aliases pending an explicit removal decision. They now resolve
to one `dte05-repair-checkpoint-pglite` lane whose proof is deliberately narrow:
E2B owns the checkpoint protocol, while E2C1 reuses that regression alongside
its separate executor and genuine-PostgreSQL connected-runner proof.

The root `test` command remains a recursive package sweep, not an aggregate
correctness gate. Root integration, H04, H05, and explicitly required
PostgreSQL proof remain separate as defined by roadmap 11. The added
`test:lane:*` commands are stable orchestration selectors; their increase in
named-command count is deliberate and does not represent new test evidence.
The fast, PGlite, and root-integration selectors clear inherited PostgreSQL
activation before spawning their child steps; the PGlite persistence lane also
excludes the three known unsuffixed PostgreSQL-owned suites.

### Conditional Activation

The current source surface contains 124 files with explicit or conditional
skip constructs. Of these, 123 are PostgreSQL-conditioned files.

| Owner | PostgreSQL-conditioned files | Activation assessment |
| --- | ---: | --- |
| `@flarex/persistence-postgres` | 89 | Many use `describe.skip` without a separate required-environment assertion; default discovery can report success without PostgreSQL proof, while the stable `test:postgres` selector now fails closed |
| `@flarex/system-test` | 29 | Current PostgreSQL wrappers include explicit non-skipped environment assertions and are intentionally fail-closed when selected |
| `@flarex/executor` | 4 | Conditional files still skip under broader discovery; the stable `test:postgres` selector now fails closed |
| analyzer app | 1 | Connected PostgreSQL composition is conditional |

The heuristic inventory found 72 PostgreSQL-conditioned files without the
repository's current explicit fail-closed assertion pattern. This remains a
review queue, not a verdict on each file. `TQ-A1` now owns required activation
for the stable PostgreSQL selectors at the manifest boundary so individual
files do not each need to reinvent the same environment guard. Broader default
discovery remains conditional and must not be reported as PostgreSQL proof.

## Invariant Family To Lane Inventory

| Invariant family | Primary owners | Minimum fast evidence | Additional decisive lanes | Current inventory verdict |
| --- | --- | --- | --- | --- |
| Pure values, codecs, canonical encodings, error projections, and type contracts | protocol, utils, owning domain packages | Focused package unit/type tests | Consumer/package tests when a public or persisted contract changes | Keep local and direct; do not centralize merely to reduce file count |
| Schema and migration shape | persistence plus protocol/schema owner | PGlite migration and decoder tests | Fail-closed PostgreSQL for real DDL, constraints, extensions, or driver representation | Shared fixture mechanics are possible; dialect assertions remain lane-owned |
| Scope authority, snapshots, session journals, OCC, commits, outcomes, feed, and outbox | persistence and executor | Pure policy plus PGlite transaction composition | PostgreSQL for locking, isolation, SQLSTATE, cancellation, contention, and plans | Highest correctness concentration; classify by invariant before splitting files |
| Application Analysis, registration, readiness, and activation | analysis, backend, persistence, Standard APIs | Pure analysis/codec tests plus PGlite composition | PostgreSQL for stored lifecycle; Workerd/host proof where runtime materialization matters | Retain stage boundaries; older FSV/AA aliases are selector debt, not automatic test debt |
| Worker/runtime dispatch and syscall behavior | function runtime, backend, executor | Pure runtime and local adapter tests | Workerd/Miniflare for exact host boundary; hosted only when platform configuration matters | Never replace exact-runtime proof with in-process harness reuse |
| Durable Task definition, run, attempt, delivery, retry, cancellation, and recovery | durable-task, persistence, backend, Standard invocation, system-test | Domain lifecycle tests plus PGlite composition | PostgreSQL for lifecycle storage/concurrency; Workerd/hosted for provider and fresh-host behavior | Keep command/query/log/status/output channels and lifecycle authority separate |
| Sync, live-query delivery, freshness, and reconnect | backend, executor, client/dev packages | Pure projection and package integration | Miniflare/workerd; browser/network lane remains missing | Large legacy/forward mixed suites require inventory before decomposition |
| Public HTTP, auth, route, and response contracts | executor-http, backend, executor Worker app | Focused route/codec tests | Workerd/H04 for binding and DB lifecycle; H05 for hosted configuration | Parameterized route tables may help, but host lanes cannot be merged |
| Package, CLI, generated output, and clean-consumer behavior | root integration, example, public packages | Build/typecheck and focused local integration | Tarball/fresh consumer; registry and version-skew lanes remain missing | Root integration is separate from recursive package tests |
| Public Test SDK behavior | `flarex-test`, `flarex-dev`, integration consumers | Package-local lifecycle/type tests should be decisive | Miniflare consumer and later browser/WebSocket lanes | Package still has no runnable package-local tests; consumer evidence is carrying the contract |
| Cross-domain Standard Application scenarios | `@flarex/system-test` | PGlite real-system replay | Explicit PostgreSQL and exact runtime lanes according to the exercised boundary | Integration evidence, not a model simulator; harness may compose but not decide outcomes |
| Deterministic generated histories and fault exploration | roadmap 11 future owner | Not implemented | Adapter lanes only after the reference model is stable | Do not expand broad fault harnesses before `TQ-A` and the first bounded pilots |

## Cross-Lane Pair Inventory

Normalizing `.postgres`, `.pglite`, `.workerd`, `.miniflare`, and `.hosted`
suffixes produces 126 multi-lane filename groups:

| Owner | Paired groups | Combined lines in those groups | Initial classification |
| --- | ---: | ---: | --- |
| `@flarex/persistence-postgres` | 81 | 104,449 | Mostly requires invariant-by-invariant review; names alone do not prove a shared contract |
| `@flarex/system-test` | 29 | 6,658 | Many use one scenario with lane-specific fixture activation; best contract-suite search surface |
| `flarex-backend` | 9 | 8,830 | Default versus Workerd/Miniflare commonly proves different host boundaries |
| analyzer app | 2 | 1,088 | Local versus connected/hosted composition distinctions |
| runtime topology probe | 2 | 3,083 | Unit versus Miniflare topology behavior |
| executor package | 2 | 1,494 | Local versus PostgreSQL/runtime-specific evidence |
| executor Worker app | 1 | 438 | PGlite/PostgreSQL deployment-scope boundary |

### Reuse Candidates

1. **Preferred `TQ-B` pilot: Application-native query.**
   [`applicationNativeQuery.test.ts`](../packages/system-test/test/integration/applicationNativeQuery.test.ts)
   and
   [`applicationNativeQuery.postgres.test.ts`](../packages/system-test/test/integration/applicationNativeQuery.postgres.test.ts)
   run the same scenario and repeat the same result assertions. Their material
   difference is lane activation and fixture construction. This is small enough
   to test an exact contract-suite shape without simultaneously decomposing a
   large proof harness.
2. **Secondary candidates: managed-schema cooking A-G.** The wrappers share
   environment and assertion patterns, but each schema gate owns different
   lifecycle evidence and the surrounding managed-schema plans remain active.
   Do not pilot here while those owners or manifests are changing.
3. **Decomposition candidate, not the first contract pilot:
   Application-native mutation.** Its PGlite/PostgreSQL wrappers repeat the
   same aggregate receipt, but the shared harness internally checks many
   independent replay, validation, concurrency, OCC, terminalization, and
   capability-identity behaviors. First separate attributable scenario
   observations and test names; wrapping the existing Boolean proof in a
   generic suite would preserve the localization problem.

### Non-Candidates Without Further Proof

- A PGlite/PostgreSQL filename pair is not reusable merely because its base
  name matches. PostgreSQL concurrency, locking, isolation, SQLSTATE,
  cancellation, driver, and plan assertions remain separate.
- Default versus Workerd or Miniflare tests ordinarily prove different runtime
  and structured-clone boundaries and must not be collapsed into one in-process
  test.
- Migration compatibility and retained Legacy tests require an identified
  shipped consumer or removal gate before pruning.
- The very large stored-attempt PGlite and PostgreSQL suites share domain
  vocabulary but contain different correctness concentrations. They require
  `TQ-C` invariant decomposition before any contract-suite decision.

## Highest Concentration Review Queue

| Surface | Lines | Initial action |
| --- | ---: | --- |
| [`storedAttemptEvidence.test.ts`](../packages/persistence-postgres/test/storedAttemptEvidence.test.ts) | 9,652 | `TQ-C` owner/invariant decomposition after the current persistence slice is clear; do not infer duplicate coverage from its PostgreSQL peer |
| [`sync.test.ts`](../packages/flarex-backend/test/sync.test.ts) | 7,883 | First separate retained Legacy, forward sync, projection, and delivery invariants |
| [`storedAttemptAuthentication.test.ts`](../packages/executor/test/storedAttemptAuthentication.test.ts) | 6,550 | Compare executor authentication/recovery ownership with persistence stored-evidence coverage before moving fixtures |
| [`storedAttemptEvidence.postgres.test.ts`](../packages/persistence-postgres/test/storedAttemptEvidence.postgres.test.ts) | 5,041 | Preserve genuine PostgreSQL authority and transaction evidence; coordinate with the PGlite decomposition only at exact fixture seams |
| [`pointCommitTransaction.postgres.test.ts`](../packages/persistence-postgres/test/pointCommitTransaction.postgres.test.ts) | 4,830 | Database correctness concentration; size alone does not justify splitting transaction histories |
| [`applicationReadiness.test.ts`](../packages/persistence-postgres/test/applicationReadiness.test.ts) | 4,462 | Classify repository contract, migration, and lifecycle assertions before decomposition |
| [`sessionJournalStore.test.ts`](../packages/persistence-postgres/test/sessionJournalStore.test.ts) | 4,439 | Preserve suspendable/fiber and fixture-lifetime isolation while separating portable repository behavior |
| [`pglite.runtime.test.ts`](../packages/persistence-postgres/test/pglite.runtime.test.ts) | 4,298 | Inventory facade, retry, migration, and driver-compatibility invariants before parameterization |
| [`http.test.ts`](../packages/executor-http/test/http.test.ts) | 4,182 | Candidate for domain-named route/codec matrices, not a generic HTTP harness |
| [`managedSchemaCookingHarness.ts`](../packages/system-test/support/managedSchemaCookingHarness.ts) | 2,999 | Prevent new schema gates from adding more aggregate proof flags; reuse exact environment mechanics only |

## Runtime And Flake Baseline

The repository cannot yet answer which invariant consumes the most wall time or
which suite flakes most often from durable evidence. Current command shape
shows risk concentration—many PGlite/PostgreSQL selectors disable file
parallelism and declare 120-480 second timeouts, while backend/system suites
serialize resource-heavy files—but timeout ceilings are not measurements.

`TQ-A1` now makes selected, passed, failed, skipped, and unavailable lane
outcomes attributable and records the failing step. `TQ-E` still owns per-file
and per-test execution/skip counts, per-file and per-lane duration history,
environment identity, and flake outcomes without automatic retries. Until that
exists, runtime-based pruning or fixture sharing is not authorized.

## Ranked Next Gates

1. **Continue `TQ-A2` milestone-alias convergence.** `TQ-A1` removed
   false-green stable PostgreSQL commands. The C08-B1a/B1b PostgreSQL and
   DTE05-E2B/E2C1 PGlite pairs are now exact thin-selector pilots. Next audit
   near-duplicate rather than byte-identical lists by invariant, and do not
   merge them merely because they share files.
2. **`TQ-B` Application-native query contract pilot.** Small, completed,
   currently untouched pair; retain separate lane activation and PostgreSQL
   resource ownership while sharing only the exact scenario/assertion contract.
3. **`TQ-C` Application-native mutation failure localization.** Replace the
   one aggregate Boolean proof with named invariant scenarios or typed
   attributable observations before considering cross-lane suite reuse.
4. **`TQ-C` stored-attempt evidence decomposition.** Highest line
   concentration and broadest owner interaction; begin only after the active
   persistence preflight work is complete and review every transaction,
   interruption, and fixture-lifetime boundary.
5. **Public Test SDK local contract coverage.** Add package-local lifecycle,
   reset/dispose, invocation-error, and resource-ownership tests before relying
   further on example/root integration as the sole decisive surface.

`TQ-P` and `TQ-A1` are complete. `TQ-A2` is the next orchestration cleanup;
`TQ-B` remains the first harness-reuse pilot. Neither is authorized merely by
this inventory.
