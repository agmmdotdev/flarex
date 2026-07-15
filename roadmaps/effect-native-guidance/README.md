# Effect-Native Engineering Guidance

Status: active cross-cutting implementation guidance.

Evidence snapshot: 2026-07-15 current working tree. Re-check the code and the
installed Effect version before using a specific API.

## Purpose

This folder records recurring Effect patterns currently visible across Flarex
and the direction future implementation slices should follow. It exists
because the completed boundary migration established typed routes, named
operations, and controlled runtime runners, but did not make every executor or
persistence flow Effect-native.

The goal is a coherent programming model:

- keep pure, total logic as ordinary TypeScript;
- represent pure recoverable validation as `Result` when failure is data;
- emit expected failures in an Effect flow with `Effect.fail` or `yield*` a
  tagged error;
- use `Effect.try` and `Effect.tryPromise` only at narrow throwing or rejecting
  foreign boundaries;
- use services, Layers, Scope, and structured concurrency when they express a
  real capability or lifecycle owner; and
- keep runtime runners at executable or unavoidable Promise callback edges.

This is not a file-by-file refactor plan, a demand to maximize Effect imports,
or authorization for a repository-wide migration. A future behavior-changing
slice still requires the preflight and validation required by
[`../../AGENTS.md`](../../AGENTS.md).

## Main Conclusions

1. Plain TypeScript does not imply `Effect.try`. A pure function that cannot
   fail stays plain. A pure function with recoverable validation failure can
   return `Result`. Only code that may actually throw needs a throwing
   boundary.
2. A broad `Effect.try` around owned validation and state construction is an
   Effect veneer. It loses exact error provenance and can normalize defects as
   ordinary business failures.
3. Explicit constructor or factory injection is already dependency injection.
   Introduce `Context.Service` and `Layer` when the capability is shared,
   lifecycle-owned, substituted across tests or hosts, or part of a larger
   Effect graph—not merely to make a file look more Effect-like.
4. Postgres persistence is the largest architectural gap. Its public ports are
   predominantly Promise/throw contracts, so callers repeatedly adapt them and
   reconstruct error unions. The target is an Effect-native persistence
   surface with narrow driver adapters, while preserving transaction ownership
   and Postgres correctness. Drizzle's native Effect v4 integration is a
   candidate, but it currently requires the Drizzle v1 release-candidate line;
   it is not available in the installed Drizzle 0.45 package.
5. `Option`, `Result`, `Exit`, `Match`, `pipe`, and `Effect.gen` are semantic
   tools, not style quotas. Use each where its data or control-flow meaning is
   real; an exhaustive native `switch` or a simple guard is often correct.
6. Ordinary outbound HTTP from an Effect-native service should use the
   installed Effect `HttpClient` service. Cloudflare service bindings and
   Durable Object stubs remain typed platform adapters unless a deliberate
   custom client preserves their routing and capability semantics.

## Document Map

- [`01-boundaries-and-failures.md`](./01-boundaries-and-failures.md) — pure
  logic, typed failures, foreign exceptions, defects, and recovery.
- [`02-services-layers-and-runtime-ownership.md`](./02-services-layers-and-runtime-ownership.md)
  — explicit ports, services, Layers, Scope, concurrency, and runners.
- [`03-postgres-persistence-and-transactions.md`](./03-postgres-persistence-and-transactions.md)
  — the Promise/throw persistence gap and the target database boundary.
- [`04-data-types-schema-and-control-flow.md`](./04-data-types-schema-and-control-flow.md)
  — `Option`, `Result`, `Exit`, `Match`, Schema, `Effect.fn`, `Effect.gen`, and
  `pipe` selection.
- [`05-testing-observability-and-adoption.md`](./05-testing-observability-and-adoption.md)
  — tests, runtime diagnostics, and bounded incremental adoption.
- [`06-current-repository-evidence.md`](./06-current-repository-evidence.md) —
  the current evidence snapshot and representative patterns behind this guide.
- [`07-conditional-flow-examples.md`](./07-conditional-flow-examples.md) —
  concrete rules and rewrites for guards, tagged unions, outcome values, and
  Effect success/failure branches.
- [`08-effect-http-client.md`](./08-effect-http-client.md) — the installed
  Effect HTTP client stack, status/Schema/retry policy, test Layers, and the
  Cloudflare adapter cutline.

- [`09-drizzle-effect-postgres.md`](./09-drizzle-effect-postgres.md) - the
  version compatibility matrix, current narrow adapter, native RC candidate,
  and PGlite/Hyperdrive proof gates.

## How To Use This Guidance

For a future approved slice:

1. inspect the changed operation and its smallest connected persistence,
   service/Layer, runtime, and test flow;
2. classify each touched legacy path as `keep`, `port`, `rewrite`, `delete`, or
   `temporary bridge`;
3. choose the intended success, failure, and requirement channels before
   editing implementation syntax;
4. correct bounded touched-flow debt when behavior can be preserved and
   focused validation exists; and
5. stop for a new preflight if the correction changes a public contract,
   transaction boundary, trust boundary, lifecycle owner, or execution order.

Neighboring code is evidence of the current state, not authority for the next
implementation.
