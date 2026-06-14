# Testing and Simulation Strategy

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
- Made the backend test harness resolve its Worker entry from the harness file
  path instead of the process cwd, so other packages can reuse it safely.

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
