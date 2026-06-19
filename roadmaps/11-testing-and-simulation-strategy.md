# Testing and Simulation Strategy

## PGlite Local And Test Lane

Previous completed checkpoint: `beef4d2` Document Postgres multitenant
persistence schema.

The Postgres-authoritative executor should use PGlite as the default local and
fast-test persistence backend.

Testing lanes now become:

```txt
PGlite lane:
  package tests
  example app tests
  Vite/local dev
  in-process executor harness
  no Nitro app required

real Postgres lane:
  isolation and lock correctness
  migration correctness
  production index/query behavior
  outbox dispatcher behavior

Nitro adapter lane:
  small HTTP/auth/route smoke tests only
```

This preserves the existing goal that tests reuse the real runtime logic rather
than a fake backend. The difference is that the real runtime logic moves from
Miniflare `PartitionDO` storage to framework-neutral executor core plus
PGlite/Postgres persistence adapters.

PGlite references:

- official PGlite docs describe Node/Bun/Deno and browser usage,
  in-memory storage, filesystem persistence, `.query`, `.exec`, and
  `.transaction(...)` callback semantics.

Convex references:

- `crates/database/src/transaction.rs`
- `crates/database/src/committer.rs`
- `crates/common/src/runtime/mod.rs`

Known limitation:

- PGlite is not a replacement for real Postgres concurrency validation. It is
  the fast lane. Real Postgres remains required for final transaction,
  isolation, lock, outbox, and migration confidence.

Verification:

```sh
git diff --check
```

## Goal

Flarex must guarantee transaction serializability, schema invariants, and data safety in a highly concurrent, distributed edge environment. To achieve this, Flarex needs a robust testing strategy that includes local unit/integration tests and deterministic simulation tests (e.g., monkey testing for restarts, latency injection, and partition failures).

## Implemented

- Added Vitest/Miniflare integration test suites under `custom/cloudflare-executor/apps/backend/test/` to verify transaction lifecycles, write coalescing, and OCC conflict propagation.
- Configured local Vitest tests for the SDK and compiler generator under `custom/cloudflare-executor/packages/flarex-backend/test/` and `packages/flarex/test/`.
- Configured automated workspace type-checking and lint checks.
- Added `apps/backend/vitest.config.ts` to run backend test files without file
  parallelism. Each backend test file creates its own Miniflare Worker/DO
  harness, and parallel harness startup can exceed default per-test hook
  timeouts on Windows.
- Added SDK ID codec tests and generator assertions so the canonical
  `{tableId}:{documentId}` format does not silently regress back to
  table-name-prefixed IDs.
- Added Miniflare integration tests for backend execution sessions:
  mutation syscalls stage writes until `/finish`, return validation prevents
  commits, and indexed query syscalls return snapshot reads.
- Added an example-app generated Worker E2E test with a Miniflare service
  binding to the backend harness. It verifies generated `/invoke` can execute
  a mutation and query through backend execution sessions and `PartitionDO`.
- Added `packages/flarex-test`, a first test SDK layer that reuses
  `flarex-dev` local runtime and the real `flarex-backend` Worker/DO runtime.
  The example E2E now uses `flarexTest()` instead of a hand-written Miniflare
  harness.
- Added an example-specific `vitest.config.ts` so Vitest does not load the
  app's Vite dev plugin during tests. This removes the lingering open file
  handles and close-timeout warning after example tests pass.
- Made the backend test harness resolve its Worker entry from the harness file
  path instead of the process cwd, so other packages can reuse it safely.
- Added a cross-package runtime materializer integration test proving a stored
  source package can be loaded from backend R2, materialized in Miniflare,
  invoked through public backend `/invoke`, and executed through backend
  sessions/syscalls. The test also verifies the runtime cache reuses the
  materialized artifact across mutation and query calls.

## Why This Shape

In a distributed environment built on Cloudflare Durable Objects, concurrency anomalies, network partitions, and Durable Object restarts (due to CPU limits, eviction, or crashes) are common failure modes. Standard unit tests are insufficient to uncover race conditions in multi-step transactions, cross-shard interactions, or index updates during concurrent writes.

Inspired by database simulation testing models (such as FoundationDB's simulation engine and Convex's proprietary randomized testing), Flarex must decouple the runtime engine from physical IO. This allows a simulation framework to:
1. Control the scheduling of asynchronous events and Durable Object storage operations.
2. Inject random network latency, Durable Object evictions/restarts, and storage transaction failures.
3. Run tests deterministically by controlling the global seed of a pseudo-random number generator (PRNG).

## Convex References

- `crates/common/src/runtime/mod.rs`
  - Defines the `Runtime` trait which abstracts time, scheduling, and IO to support deterministic testing/simulation.
- `crates/database/src/committer.rs`
  - Used in transactional commit checks and conflict resolution testing.
- Public `convex-backend` Repository Structure:
  - While Convex leverages advanced randomized simulation testing internally to ensure correctness, **these test frameworks are proprietary and excluded from the public open-source repository** (as noted in their `README.md`). Flarex must construct its own open simulation tools suitable for the Cloudflare worker stack.

## Cloudflare Differences

- Convex runs inside container/VM isolation layers (with V8 isolate execution) and coordinates transaction logs in a Rust-managed runtime.
- Flarex runs directly inside Cloudflare Durable Objects and Workers. Testing must simulate:
  - Durable Object lifetime states (active memory, storage eviction, system-triggered restarts).
  - Durable Object transactional storage locks and transactions.
  - Inter-DO network latency and HTTP failures.
  - Durable Object alarms (scheduled tasks).

## Known Limitations

- Tests are currently classic integration tests running against Miniflare. They do not support deterministic time, thread scheduling control, or pseudo-random seed repeatability.
- Backend Miniflare tests are intentionally serialized at the file level for
  stability. This reduces test throughput but avoids timing-sensitive Worker
  bundle/harness startup failures.
- Durable Object evictions/restarts are not yet simulated in concurrent execution paths.
- Network latency injection and network partitions between shards or DOs are not yet modeled.

## Next Work

1. **Virtual Runtime Abstraction:** Introduce a mock runtime layer for Flarex (similar to Convex's `Runtime` trait) that abstracts `scheduler`, `fetch`, `time`, and `storage`.
2. **Deterministic Simulator Runner:** Build a simulator that runs multiple client actors against a virtual DO cluster using mock time and controllable task queues.
3. **Fault Injection (Monkey Testing):**
   - Periodically delete/recreate Durable Object memory states to force disk reloads during active operations.
   - Inject network drops and HTTP `503` responses.
   - Randomly abort Durable Object storage transactions to verify transactional rollback and retries.
4. **Consistency Checking Invariants:** Define safety checkers (e.g., checking for double-spending, index inconsistencies, or lost updates) that run at the end of each simulation run.

## Verification

```sh
corepack pnpm --filter flarex test
corepack pnpm --filter @flarex/backend test
corepack pnpm --filter flarex-backend test
corepack pnpm --filter @flarex/example test
corepack pnpm typecheck
corepack pnpm test
```

## Runtime Materializer Test Update

Previous completed checkpoint: `0447832` Add artifact runtime materializer
cache.

`packages/flarex-dev/test/runtimeMaterializer.test.ts` now covers the full
stored-package invoke shape:

```txt
start analyzed push
  -> put source package in backend R2 store
  -> finish push
  -> public backend invoke
  -> artifact runtime cache
  -> local Miniflare materializer
  -> backend execution sessions
```

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - execution routes through a backend-owned runner after active deployment
    metadata is resolved.
- `crates/application/src/module_cache/mod.rs`
  - loaded execution state is cached by package/module identity.

Cloudflare difference: this is an integration test over Miniflare Workers,
Durable Objects, and R2 rather than Convex's internal simulation framework. It
proves the runtime boundary but does not yet simulate DO eviction, runtime
eviction, or concurrent OCC retries.

Verified with:

```sh
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts
```

## Dev Runtime Artifact Invoke Test Update

Previous completed checkpoint: `c8c16bb` Materialize stored source packages
locally.

The local dev runtime test now verifies `/__flarex_dev/invoke` through the
backend artifact runtime path. The test still uses the example app, but the
normal invoke request now reaches backend `/deployments/:deploymentId/invoke`
and therefore covers active deployment lookup, R2 artifact storage, runtime
materialization, backend execution sessions, and `PartitionDO` commit.

Convex reference:

- `npm-packages/convex/src/cli/lib/dev.ts`
  - local dev should exercise the backend deployment/invoke loop rather than a
    separate app-local execution shortcut.

Cloudflare difference: this remains a Miniflare integration test, not a
hosted Dynamic Worker test. It is still the correct local proof because it
uses the same service-binding and stored-source-package boundaries.

Verified with:

```sh
corepack pnpm --filter flarex-dev test -- dev.test.ts
```

## Runtime Store Contract Test Update

Previous completed checkpoint: `ef50030` Use artifact runtime for local dev
invoke.

The artifact runtime tests now cover both runtime modes:

- compatibility mode, where backend invoke embeds `sourcePackage` in the
  runtime payload,
- runtime-store mode, where backend invoke sends only the artifact ref and the
  runtime service loads source package bytes from `BackendExecutionArtifactStore`.

`runtimeMaterializer.test.ts` now runs through the runtime-store mode with the
backend harness, R2 artifact storage, service binding runtime, and local
Miniflare materializer.

Convex reference:

- `crates/application/src/application_function_runner/mod.rs`
  - execution tests should validate package identity handoff to the runner.
- `crates/model/src/source_packages/mod.rs`
  - source package retrieval should be tested through the storage model.

Cloudflare difference: these are still Miniflare integration tests. They prove
the artifact-store service contract but not hosted Dynamic Worker eviction or
Cloudflare production R2 behavior.

Verified with:

```sh
corepack pnpm --filter flarex-backend test -- artifactRuntime.test.ts
corepack pnpm --filter flarex-dev test -- runtimeMaterializer.test.ts dev.test.ts
```

## Artifact Lifecycle Test Update

Previous completed checkpoint: `e1ccf14` Let artifact runtime load source
packages.

`artifactRuntime.test.ts` now verifies materialized artifact cleanup:

- replacing a cached artifact with a new source hash disposes the old artifact,
- `delete()` disposes a single cached artifact,
- `clear()` disposes every cached artifact,
- runtime service `dispose()` clears the cache and disposes cached artifacts.

These tests are intentionally small and deterministic. They protect the local
Miniflare materializer from leaking nested runtimes and establish the lifecycle
contract the hosted Dynamic Worker runtime must implement later.

Convex reference:

- `crates/application/src/module_cache/mod.rs`
  - cache identity and ownership are part of runtime correctness.

Cloudflare difference: disposal currently means nested Miniflare cleanup. In
hosted Cloudflare it should map to Dynamic Worker eviction or platform runtime
release.

Verified with:

```sh
corepack pnpm --filter flarex-backend test -- artifactRuntime.test.ts
```
