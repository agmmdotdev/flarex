# Runtime Topology Probe

This private workspace app is an isolated Cloudflare communication and latency
probe. It does not implement Flarex transactions and is not an accepted
production runtime. The ordered experiment, boundaries, deployment controls,
and teardown requirements live in [`PLAN.md`](./PLAN.md).

## Current Slice

`P06` is complete. It adds the optional sync-to-runtime rerun communication
loop without introducing a real executor, transaction, or sync engine. `P07`
is the next gate, but remains pending its own preflight and approval. The
current app owns:

- a bearer-protected per-sample gateway with bounded streaming JSON reads;
- `edge_echo` and gateway-to-`ProbeSessionDO` round-trip samples;
- a SQLite-backed `ProbeSessionDO` with untimed state controls for persistence,
  isolation, restart, and reset proofs;
- gateway trace fragments that deliberately omit the external root span;
- a collector helper that adds the true caller-measured external round trip;
- an in-memory Vite/Miniflare harness that executes the actual Worker bundle;
- an isolated Wrangler gateway configuration with its first SQLite Durable
  Object migration;
- fixed platform-owned direct Worker source loaded through Worker Loader with
  outbound networking disabled and no injected capabilities;
- stable and bounded new-code modes whose IDs include the `direct-v1` source
  profile; and
- `dynamic_direct_echo` fragments that separately record Worker Loader code
  callback execution and gateway-to-Dynamic-Worker round-trip latency;
- one platform-owned `ProbeInvocationFacet` per exact attempt, loaded from the
  SessionDO with no injected environment capability or outbound network;
- `facet_echo` and `facet_journal` traces that preserve caller-local nesting
  across gateway-to-session, session-to-facet, and facet-local SQLite work;
- a bounded synthetic journal that stores the actual payload in ordered rows,
  synchronizes storage, reads every row back, and returns a host-recomputed
  SHA-256 logical seal; and
- internal-only lifecycle controls proving warm reuse, abort-preserved facet
  storage, explicit delete/reset, restart rehydration, fresh-attempt isolation,
  and deletion of ordinary measurement facets before their response returns;
- a separate private mock Worker with restricted `MockReadEntrypoint` and
  `MockFinishEntrypoint` service-binding contracts;
- a separate private sync Worker that exclusively owns one deterministic,
  SQLite-backed `ProbeSyncDO` per synthetic scope;
- applied, duplicate, gap, and stale wake classification with exact cursor
  preservation/advance rules, reset, scope fencing, and restart persistence;
- a fixed `invoke-v1` Dynamic Worker facet that receives only `MOCK_READ`,
  keeps outbound networking disabled, writes and seals its temporary journal,
  and returns to the SessionDO before mock finish;
- `commit_wake` and `full_invoke` traces across mock read, facet journal,
  SessionDO-to-mock finish, mock-to-sync wake, and sync cursor I/O; and
- strict decoding of enumerable RPC wire fields while excluding Cloudflare's
  transport-owned `Symbol.dispose` marker from application protocol fields;
- a private `MockRerunEntrypoint` that forwards a per-call, one-shot `RpcTarget`
  through `ProbeSyncDO`, with no permanent reverse service binding;
- a gateway-local `ProbeRuntimeRerunEntrypoint` reached through `ctx.exports`
  that opens the depth-1 runtime path into a fresh SessionDO attempt facet;
- a capability-free `rerun-v1` facet with outbound networking and subrequests
  disabled, strict terminal receipts, and no second sync wake;
- an exact `external -> sync rerun -> session -> facet` trace whose successful
  receipt requires proof that the fresh facet startup callback ran; and
- cursor-preservation, same-identity normal cleanup replay, new-code isolation,
  missing-capability failure, and one-way binding-graph proofs in Miniflare.

This slice is local and dry-run-only. Production remains blocked until `P07`
adds server-owned run registration, atomic sample claims, aggregate budgets,
observed concurrency enforcement, and idempotent purge. Normal cleanup is
tested, but abrupt isolate termination can still leave tracked facet state;
P06 makes no crash-durable cleanup claim.

All durations are caller-local monotonic round trips. The protocol never
subtracts absolute timestamps created by different isolates.

## Commands

```sh
corepack pnpm --filter @flarex/runtime-topology-probe typecheck
corepack pnpm --filter @flarex/runtime-topology-probe test
corepack pnpm --filter @flarex/runtime-topology-probe test:local
corepack pnpm --filter @flarex/runtime-topology-probe deploy:sync:dry-run
corepack pnpm --filter @flarex/runtime-topology-probe deploy:mock:dry-run
corepack pnpm --filter @flarex/runtime-topology-probe deploy:gateway:dry-run
```

## Source Layout

- `src/identity.ts` validates and derives synthetic-only identities.
- `src/protocol.ts` owns strict wire schemas and typed decode failures.
- `src/commitProtocol.ts` owns synthetic mock-read, mock-finish, sync-wake,
  cursor, and receipt contracts.
- `src/runtimeProtocol.ts` owns per-sample gateway fragments and collector
  completion.
- `src/dynamicProtocol.ts` owns the direct Worker wire contract and fixed
  capability-free source package.
- `src/facetProtocol.ts` owns the strict facet/session wire contracts, logical
  journal seal, and fixed capability-free facet source package.
- `src/invokeProtocol.ts` owns the `invoke-v1` facet contract, logical journal
  seal, and fixed source package with only the mock-read capability.
- `src/rerunProtocol.ts` owns depth-0 sync requests, depth-1 runtime requests,
  terminal receipts, and the capability-free `rerun-v1` facet source.
- `src/rerunGuards.ts` owns deterministic one-shot and same-sample concurrency
  fences used at the two forwarded-call boundaries.
- `src/runtimeRerunEntrypoint.ts` owns the private runtime callback and its
  one-shot forwarded RPC target.
- `src/gateway.ts` owns the protected public boundary and local hop timing.
- `src/gatewayWorker.ts` is the Workers-only adapter that creates the target
  from `ctx.exports`; the host-neutral gateway core does not import
  `cloudflare:workers`.
- `src/sessionDO.ts` owns supervisor routing, facet lifecycle, cleanup tracking,
  and isolated SQLite Durable Object control state. It never opens facet journal
  storage.
- `src/mockCommitWorker.ts` owns the only synthetic finish-to-sync wake path.
- `src/probeSyncDO.ts` and `src/syncWorker.ts` own the isolated synthetic cursor
  actor and its private deployable Worker.
- `src/trace.ts` validates completeness, parentage, cycles, and outcome
  agreement for each scenario.
- `src/statistics.ts` computes exact summaries without dropping failures.
