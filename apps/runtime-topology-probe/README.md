# Runtime Topology Probe

This private workspace app is an isolated Cloudflare communication and latency
probe. It does not implement Flarex transactions and is not an accepted
production runtime. The ordered experiment, boundaries, deployment controls,
and teardown requirements live in [`PLAN.md`](./PLAN.md).

## Current Slice

`P01` freezes the offline measurement protocol before any Worker, Durable
Object, facet, service binding, or Wrangler configuration exists. It owns:

- strict versioned request and sample-result schemas;
- branded run, sample, scope, session, attempt, code, and span identities;
- deterministic cross-field proof that every sample used the expected scope,
  session, facet attempt, and Dynamic Worker code identity;
- exact scenario-specific trace topologies;
- distinct Worker Loader and facet-startup callback observations;
- normalized errors with no raw cause or message in evidence; and
- deterministic per-hop, per-cohort nearest-rank latency summaries that count
  invalid or failed samples as failures.

All durations are caller-local monotonic round trips. The protocol never
subtracts absolute timestamps created by different isolates.

## Commands

```sh
corepack pnpm --filter @flarex/runtime-topology-probe typecheck
corepack pnpm --filter @flarex/runtime-topology-probe test
```

## Source Layout

- `src/identity.ts` validates and derives synthetic-only identities.
- `src/protocol.ts` owns strict wire schemas and typed decode failures.
- `src/trace.ts` validates completeness, parentage, cycles, and outcome
  agreement for each scenario.
- `src/statistics.ts` computes exact summaries without dropping failures.
