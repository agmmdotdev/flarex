# Runtime Topology Probe

This private workspace app is an isolated Cloudflare communication and latency
probe. It does not implement Flarex transactions and is not an accepted
production runtime. The ordered experiment, boundaries, deployment controls,
and teardown requirements live in [`PLAN.md`](./PLAN.md).

## Current Slice

`P04` adds the SessionDO-supervised Dynamic Worker facet and its synthetic
temporary journal without introducing mock commit or sync behavior. The
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
  and deletion of ordinary measurement facets before their response returns.

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
- `src/facetProtocol.ts` owns the strict facet/session wire contracts, logical
  journal seal, and fixed capability-free facet source package.
- `src/gateway.ts` owns the protected public boundary and local hop timing.
- `src/sessionDO.ts` owns supervisor routing, facet lifecycle, cleanup tracking,
  and isolated SQLite Durable Object control state. It never opens facet journal
  storage.
- `src/trace.ts` validates completeness, parentage, cycles, and outcome
  agreement for each scenario.
- `src/statistics.ts` computes exact summaries without dropping failures.
