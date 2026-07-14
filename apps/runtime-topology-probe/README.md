# Runtime Topology Probe

This private workspace app is an isolated Cloudflare communication and latency
probe. It does not implement Flarex transactions and is not an accepted
production runtime. The ordered experiment, boundaries, deployment controls,
and teardown requirements live in [`PLAN.md`](./PLAN.md).

## Current Slice

`P03` adds the direct Dynamic Worker control without introducing facets, mock
commit, or sync behavior. The current app owns:

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
  callback execution and gateway-to-Dynamic-Worker round-trip latency.

This slice is local and dry-run-only. Production remains blocked until `P07`
adds server-owned run registration, atomic sample claims, aggregate budgets,
and observed concurrency enforcement.

All durations are caller-local monotonic round trips. The protocol never
subtracts absolute timestamps created by different isolates.

## Commands

```sh
corepack pnpm --filter @flarex/runtime-topology-probe typecheck
corepack pnpm --filter @flarex/runtime-topology-probe test
corepack pnpm --filter @flarex/runtime-topology-probe test:local
corepack pnpm --filter @flarex/runtime-topology-probe deploy:gateway:dry-run
```

## Source Layout

- `src/identity.ts` validates and derives synthetic-only identities.
- `src/protocol.ts` owns strict wire schemas and typed decode failures.
- `src/runtimeProtocol.ts` owns per-sample gateway fragments and collector
  completion.
- `src/dynamicProtocol.ts` owns the direct Worker wire contract and fixed
  capability-free source package.
- `src/gateway.ts` owns the protected public boundary and local hop timing.
- `src/sessionDO.ts` owns the isolated SQLite Durable Object control state.
- `src/trace.ts` validates completeness, parentage, cycles, and outcome
  agreement for each scenario.
- `src/statistics.ts` computes exact summaries without dropping failures.
