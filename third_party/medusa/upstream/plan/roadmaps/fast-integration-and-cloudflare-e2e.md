# Fast Integration and Cloudflare E2E Roadmap

## Purpose

The current Cloudflare HTTP integration path is valuable but slow. It runs
official Medusa HTTP integration assertions against the Cloudflare HTTP runtime
selector, while the surrounding test runner still performs real Medusa setup,
real PostgreSQL database lifecycle, migrations, and external Worker dev-server
startup.

This roadmap records two connected goals:

1. Make the current official integration-test loop faster without weakening the
   canonical Medusa compatibility proof.
2. Add a later full Cloudflare E2E lane that runs real Cloudflare persistence
   boundaries with Drizzle, D1, and Durable Object SQLite instead of the current
   static HTTP proof resources.

These are not replacements for the existing route-by-route migration work. The
existing official Medusa test files remain the behavioral specification.

## Current State

The current command shape is still the official HTTP integration workspace:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare yarn workspace integration-tests-http test:integration --testPathPattern=<spec> --runInBand
```

What this currently proves:

- Jest runs the original Medusa HTTP integration files.
- The existing `api.get(...)`, `api.post(...)`, and related helpers send HTTP
  traffic to the Cloudflare runtime branch.
- The Cloudflare runtime imports selected real Medusa route and middleware
  files through a generated static HTTP manifest.
- Worker import guards catch Node-only modules that enter the Worker graph.

What is still transitional:

- The Node test runner still creates real PostgreSQL databases.
- The Node test runner still runs Medusa migrations and link sync.
- The Node test runner still loads the Medusa container for fixture helpers and
  setup code.
- The Cloudflare branch starts an external `medusa-cloudflare` dev server.
- Worker route handlers currently resolve static proof resources and narrow
  proof workflow/query services for many routes, not the final real
  Drizzle/D1/DO-backed Medusa module runtime.

This split is intentional for the current milestone: it lets unchanged Medusa
HTTP assertions exercise Worker-compatible HTTP routing while the deeper module
and persistence runtime is refactored in place.

## Non-Negotiables

- Do not replace the official integration assertions with a parallel
  Cloudflare-only suite.
- Do not treat a fast PGlite or in-process fetch lane as equivalent to the
  canonical Medusa/PostgreSQL compatibility gate.
- Do not hide Worker import problems by testing only in Node.
- Do not expand static proof resources into a second commerce implementation.
  They are a temporary bridge until the real Cloudflare module runtime exists.
- Keep all new speed paths behind explicit selectors so the default Medusa
  runner behavior remains understandable.

## Lane 1: Canonical Compatibility Gate

This lane stays slow but authoritative.

```text
official Medusa HTTP spec
  -> Medusa test runner
  -> real PostgreSQL database
  -> real migrations and link sync
  -> selected HTTP runtime
       Express by default
       Cloudflare when MEDUSA_TEST_HTTP_RUNTIME=cloudflare
```

Purpose:

- Preserve confidence that the fork still behaves like Medusa.
- Catch PostgreSQL, MikroORM, migration, link, module, and fixture-helper
  assumptions.
- Serve as the final per-slice acceptance gate until the Cloudflare runtime has
  real persistence parity.

Near-term rule:

- Every newly ported HTTP integration file should still pass in this lane
  before the slice is committed.

## Lane 2: Faster PostgreSQL Compatibility

The first speed improvement should keep real PostgreSQL semantics.

Preferred approach:

```text
start one local PostgreSQL cluster
  -> create template database
  -> run Medusa migrations and link sync once
  -> clone template database per focused spec file
  -> run tests
  -> drop cloned database
```

Why this comes before PGlite:

- It preserves real PostgreSQL behavior.
- It keeps `pg`, migrations, advisory-lock behavior, SQL dialect, and
  extension assumptions in the loop.
- It reduces repeated migration cost, which is one of the largest current
  delays.

Implementation direction:

- Add a test-runner database strategy selector, for example:

```bash
MEDUSA_TEST_DB_STRATEGY=postgres-template
```

- Keep the existing strategy as:

```bash
MEDUSA_TEST_DB_STRATEGY=postgres-create-drop
```

- Cache only migrated template state that is safe for the current config,
  feature flags, module set, and migration hash.
- Invalidate the template when migrations, module config, feature flags, or
  Medusa config relevant to schema changes.

Acceptance:

- The same focused HTTP spec passes with the existing Postgres create/drop
  strategy and the template clone strategy.
- Template reuse must never skip behavior that the canonical lane is meant to
  catch.

## Lane 3: PGlite Subset Lane

PGlite is useful, but it should not become the first canonical replacement for
real PostgreSQL.

Valid uses:

- Drizzle repository and query translation tests.
- DML-to-Drizzle schema compiler tests.
- Fast module/service smoke tests where Postgres-only behavior is not under
  review.
- Local deterministic checks for SQL generated by the portable persistence
  layer.

Invalid uses for now:

- Claiming full Medusa HTTP integration compatibility.
- Replacing real PostgreSQL for migration-heavy suites.
- Replacing tests that depend on `pg`, MikroORM PostgreSQL behavior,
  database-level concurrency, advisory locks, or production PostgreSQL driver
  semantics.

Possible selector:

```bash
MEDUSA_TEST_DB_STRATEGY=pglite
```

Acceptance:

- PGlite lanes must be labeled as fast subset validation.
- Any PGlite-passing behavior that is relevant to Medusa compatibility must
  still be confirmed by the canonical PostgreSQL lane.

## Lane 4: In-Process Cloudflare HTTP Test Runtime

External Worker dev-server startup is another repeated cost. A test SDK should
allow the integration runner to call the Cloudflare fetch handler directly
without starting a separate dev server for every focused run.

Target API shape:

```ts
const runtime = await createCloudflareHttpTestRuntime({
  manifest,
  env,
  container,
})

const response = await runtime.fetch(request)
await runtime.shutdown()
```

Runner integration:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare-local-fetch
```

or:

```bash
MEDUSA_TEST_HTTP_RUNTIME=cloudflare
MEDUSA_TEST_CLOUDFLARE_STARTUP=local-fetch
```

What it should preserve:

- Same route and middleware static manifest.
- Same Fetch HTTP adapter.
- Same request/response adaptation behavior.
- Same test `api.get(...)` and `api.post(...)` shape.

What it cannot replace:

- Real workerd compatibility checks.
- Worker bundle import guards.
- Wrangler/Vite/dev-server integration smoke checks.

Acceptance:

- A focused official HTTP integration file passes through the local fetch
  runtime and through the existing external Worker runtime.
- Import guards still run for slices that change Worker-reachable code.
- Any Node-only API accidentally used by the local fetch runtime must still be
  caught by the Worker import guard or real workerd lane.

## Lane 5: Real Cloudflare Persistence E2E

This is the future full E2E lane. It should prove the Cloudflare runtime can
execute real Medusa behavior with Cloudflare-native persistence instead of
static proof services.

Target topology:

```text
official Medusa HTTP spec
  -> Cloudflare HTTP runtime
  -> static route, middleware, workflow, subscriber, provider manifests
  -> real Medusa service and workflow boundaries
  -> Drizzle repositories
  -> D1 projections and query reads
  -> Durable Object SQLite authoritative writes where required
```

Persistence split:

- Durable Objects own serialized authoritative state for boundaries that need
  strong per-aggregate correctness, such as carts and checkout-critical state.
- D1 owns broad query projections and read-optimized listing/filtering data.
- Drizzle is the SQL abstraction used for SQLite/D1/PostgreSQL-compatible
  persistence where the module boundary allows it.
- PostgreSQL/MikroORM remains available as the Node compatibility lane until a
  replacement passes the same assertions.

This lane should not start by rewriting the HTTP tests. It should replace the
temporary static proof services behind the same existing Medusa route and
workflow boundaries.

Acceptance:

- A focused official HTTP integration file passes with Worker route handling
  and real Cloudflare persistence adapters.
- The same file still passes in the canonical PostgreSQL compatibility lane.
- Worker import guard confirms MikroORM, `pg`, Express, and other Node-only
  implementation imports are absent from the Worker graph.
- Workerd/Durable Object SQLite validation proves the actual runtime APIs used
  by the adapter, not only Node-side simulations.

## Suggested Sequence

### Step 1: Keep Porting Official Specs

Continue the current route-by-route official HTTP integration work until the
repeated cost is painful enough to justify a test-runner slice.

Reason:

- The current work is still exposing real route, manifest, workflow, and proof
  gaps.
- Optimizing too early risks building a speed path around the wrong runtime
  boundary.

### Step 2: Add PostgreSQL Template Reuse

Implement `postgres-template` as the first speed lane.

Expected benefit:

- Avoid rerunning all migrations for every focused file.
- Keep real PostgreSQL semantics.

### Step 3: Add Local Fetch Cloudflare Runtime

Implement an in-process Fetch runtime for fast iteration.

Expected benefit:

- Avoid repeated external Worker dev-server startup.
- Keep route/middleware adapter behavior in process.

### Step 4: Add PGlite for Drizzle Subsets

Use PGlite only where the test target is the portable Drizzle layer, not full
Medusa/PostgreSQL compatibility.

Expected benefit:

- Fast persistence feedback while building the Drizzle path.

### Step 5: Replace Static Proof Services with Real Cloudflare Adapters

Start with one module or vertical HTTP file.

Example candidate:

```text
Store shipping options
  -> route manifest already exists
  -> workflows already invoked by id
  -> current static proof behavior is understood
  -> replace proof query/workflow pieces with real Drizzle/DO-backed services
```

Expected benefit:

- Move from route proof to real Cloudflare persistence proof without changing
  the official test file.

## Decision Points

Stop and ask before making these choices:

- Making PGlite the canonical replacement for real PostgreSQL.
- Removing the real PostgreSQL compatibility lane.
- Changing official Medusa test assertions to fit Cloudflare limitations.
- Introducing a second commerce implementation instead of replacing static
  proof services with real Medusa module adapters.
- Choosing the first module whose authoritative state belongs in Durable
  Objects rather than D1/Drizzle.

## Status

The PGlite subset lane is implemented for the accepted module-service matrix
and is available through `pnpm test:integration:pglite`. It remains labeled as
fast subset validation and does not replace the canonical PostgreSQL lane.

The first uninterrupted aggregate run passed all 25 lanes on July 10, 2026:
65 suites, 1,158 passing tests, and 2 existing skipped tests in 8 minutes 25
seconds. The main Medusa pipeline now invokes the same serial command in one
non-matrix job with no PostgreSQL or Redis service containers and a 20-minute
timeout. Hosted execution still requires confirmation after the commit is
pushed.

The other roadmap lanes are not declared complete by this status update.
