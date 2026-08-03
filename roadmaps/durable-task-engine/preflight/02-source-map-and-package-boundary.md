# DTE01-B/C Receipt: Source Map And Package Boundary

## Receipt Status

**Status:** DTE01-B source classification and DTE01-C active package-boundary
decision complete for the first run-attempt capability.

This receipt consumes the
[`run-attempt lifecycle closure`](./01-run-attempt-lifecycle-closure.md) and
binds it to the machine-readable
[`source-map.run-attempt-v1.json`](./source-map.run-attempt-v1.json).

It did not independently authorize package creation. DTE01-D/E are fixed by the
[`provenance and compatibility harness receipt`](./03-provenance-and-compatibility-harness.md).
DTE01-F is fixed by the [`boundary gate receipt`](./04-boundary-and-bundle-gates.md),
and DTE01-G now admits the complete bounded checkpoint in the
[`final package admission`](./05-final-package-admission.md).

## Decision Summary

1. Admit the first transformed capability later as a new private package named
   `@flarex/durable-task`.
2. Expose only `@flarex/durable-task/internal/run-attempt-v1` during the private
   vertical. Do not add a package-root export.
3. Keep pure state, retry, error, lease, cancellation, and requested-effect
   policy in ordinary TypeScript modules.
4. Model the shared lifecycle and Task System persistence capabilities as
   narrow Effect services with exact typed failures.
5. Let `@flarex/persistence-postgres` implement the Task System store port with
   Drizzle, PGlite, and Postgres. The domain package never imports it.
6. Let `flarex-backend` compose the domain service, Postgres adapter, wake/effect
   delivery, and runtime dispatch adapters. Deployable apps remain thin hosts.
7. Keep Trigger package names, Prisma, Redis, Redlock, Node, Cloudflare, HTTP,
   Worker Loader, and product projections out of the new package.
8. Use Effect 4.0.0-beta.90 through the root catalog as the package's only
   initial runtime dependency.

This chooses DTE01 Candidate 1: transformed source in a host-neutral
durable-task domain package.

## Source Map Result

The v1 map contains 29 classified entries:

| Class | Entries | Meaning for this capability |
| --- | ---: | --- |
| `S` | 13 | Reuse transition, retry, error, lease, and recovery behavior after replacing authority-bearing seams. |
| `T` | 12 | Translate persistence, queue/wake, snapshot, OOM lookup, and test mechanics while preserving their semantic receipts. |
| `D` | 4 | Do not admit out-of-scope status helpers, Trigger runtime/product projections, Redis cache/metadata/billing compatibility, or waitpoint/runner/UI projections. |

The `D` entries are not implementation shortcuts. Each records why unchanged
reuse, seam adaptation, and adapter translation would all retain an unused or
incorrect authority. Their retained scenario evidence remains available to
the later owning roadmap.

## Exact Package Identity

The planned manifest identity is:

```json
{
  "name": "@flarex/durable-task",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "files": [
    "src",
    "THIRD_PARTY_NOTICES.md",
    "trigger-source-map.json",
    "licenses"
  ],
  "exports": {
    "./internal/run-attempt-v1": "./src/runAttempt/v1.ts"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "effect": "catalog:"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

This is the admitted future manifest contract. Its creation remains sequenced
behind the identity/scope start condition in the final admission receipt.

`private: true` is deliberate even though several older Flarex workspace
packages omit it. The first task surface is platform-internal and must not
enter an npm publication path accidentally.

No root export is allowed. A later roadmap must explicitly approve any second
subpath, protocol/wire contract, SDK exposure, or removal of `private: true`.

## Initial Domain Shape

The first admitted checkpoint should use this proportional domain-first shape:

```text
packages/durable-task/
  package.json
  tsconfig.json
  THIRD_PARTY_NOTICES.md
  trigger-source-map.json
  licenses/
    trigger-apache-2.0.txt
    trigger-core-mit.txt
  src/
    runAttempt/
      Model.ts
      Schema.ts
      Errors.ts
      Policy.ts
      Services/
        RunAttemptLifecycle.ts
        TaskSystemRunAttemptStore.ts
      Layers/
        RunAttemptLifecycleLive.ts
      v1.ts
  test/
    runAttempt/
      policy.test.ts
      lifecycle.test.ts
      compatibility-receipts.test.ts
```

The package is large enough for service/Layer separation because it has a
shared business service and a separately implemented persistence port. It does
not need generic `utils`, `adapters`, `common`, or `runtime` folders.

## Pure Domain Owners

### `Model.ts`

Owns readonly internal domain values:

- task scope supplied by Roadmap 02;
- durable run identity;
- attempt number;
- monotonic execution fence;
- run-attempt lifecycle and terminal outcome unions;
- execution evidence summaries;
- retry policy after validation;
- cancellation generation;
- lease duration and expiry evidence;
- completion identity for idempotent redelivery; and
- durable requested-effect data.

These are not database rows, public JSON, Trigger types, or public SDK types.

### `Schema.ts`

Owns Effect Schema decoders only for persisted or foreign run-attempt values
that require runtime validation. Stable decoders are hoisted. Schema proves
structure and value invariants; authorization, scope ownership, fence
freshness, database time, and transaction acceptance remain store/service
claims.

### `Errors.ts`

Owns:

- the Flarex execution-failure union;
- sanitization and bounded capture policy adapted from Trigger;
- retry/terminal/OOM classification adapted from Trigger;
- tagged lifecycle and persistence boundary failures; and
- exhaustive terminal-outcome mapping.

Foreign Drizzle/Postgres errors are not defined here. The persistence adapter
maps them once at their source to the store service's tagged integration
failures.

### `Policy.ts`

Owns pure decisions:

- valid lifecycle transitions;
- expected-fence checks;
- attempt ceiling;
- retry eligibility and exhaustion;
- deterministic backoff from an explicitly supplied jitter sample;
- immediate versus durable retry delivery;
- cancellation request/finalization decisions;
- stale wake behavior;
- lease-expiry outcome; and
- requested effects produced by an accepted transition.

Pure policies remain ordinary TypeScript. Use Effect v4 `Result` only when a
pure recoverable failure is intentionally returned as data; do not wrap total
guards or calculations in Effect.

## Service Boundary

### `RunAttemptLifecycle`

`RunAttemptLifecycle` is the shared business capability and therefore a
`Context.Service`. Its public service operations are conceptually:

```text
startAttempt
completeAttempt
requestCancellation
handleLeaseExpiry
inspectCurrentAttempt
```

Each implementation method is a named `Effect.fn` operation. Dependent reads,
policy decisions, branches, and commits use `Effect.gen` where that composition
is clearest. No service method calls `Effect.runPromise`.

The service accepts Flarex domain commands and returns accepted domain
outcomes. It does not return database rows, Trigger execution payloads, queue
receipts, HTTP responses, or public wire contracts.

### `TaskSystemRunAttemptStore`

`TaskSystemRunAttemptStore` is the private FlarexDB Task System capability
required by `RunAttemptLifecycle`. It is a `Context.Service` because it has
live Postgres/PGlite and deterministic test implementations and participates
in the Effect requirement graph.

The store contract is semantic, not generic CRUD. Its central operation must:

1. require task scope and run identity;
2. open the owning database transaction;
3. obtain authoritative database time;
4. load and decode the current run-attempt state;
5. invoke a synchronous, pure lifecycle decision supplied by the domain;
6. compare the expected monotonic fence;
7. atomically persist the transition, execution evidence, result/error
   reference, and durable requested-effect intents; and
8. return the accepted outcome and database-time receipt.

The pure decision callback cannot perform Effect, Promise work, logging,
network I/O, runtime dispatch, or queue delivery and cannot retain the
transaction capability. This keeps business policy with the domain while the
adapter retains transaction ownership.

The final TypeScript signature belongs to the package implementation preflight.
It must preserve these semantics and exact error channels; it must not expose a
Drizzle transaction, generic query builder, or table repository to the domain.

### Plain construction inputs

Run-attempt retry defaults and optional OOM escalation are lifecycle-free
policy values. Supply them to `RunAttemptLifecycleLive` as an owned immutable
configuration value. Do not create singleton Context services for every pure
policy function.

Authoritative time is not an injected host `Clock`. It is obtained by the
store inside the accepting database transaction. Effect `Clock` and
`TestClock` remain useful for non-authoritative scheduling policy and
deterministic tests but cannot establish persisted lease authority.

## Effect Success, Failure, And Requirement Channels

The planned service contract must keep these channels distinct:

| Operation concern | Success channel | Typed failure channel | Requirements |
| --- | --- | --- | --- |
| pure policy | domain decision or `Result` when invalid input is data | pure policy issue retained in `Result` | none |
| lifecycle command | accepted, idempotent-already-accepted, or current authoritative outcome | not found/non-disclosing scope failure, stale/conflicting fence, invalid transition, corrupt stored state, transient store failure, terminal store failure | `TaskSystemRunAttemptStore` |
| Postgres store operation | decoded authoritative state or committed transition receipt | tagged query, transaction, conflict, corruption, and unavailable errors | Postgres/Drizzle adapter requirements closed by its Layer |
| host delivery | effect delivery receipt | tagged retryable or terminal host-adapter failure | backend-owned wake/runtime/event adapter |

A repeated identical completion is a successful idempotent outcome, not an
integration failure. A conflicting or stale completion is a typed lifecycle
failure. Stored corruption is not absence. Unknown defects and interruption
remain Causes observed at the runtime boundary rather than becoming ordinary
task failures.

## Layer And Runtime Ownership

`RunAttemptLifecycleLive` is a substantial Layer that constructs the service
from `TaskSystemRunAttemptStore` plus immutable policy configuration. Layer
construction performs no task transition, migration, wake delivery, or
background polling.

The Postgres implementation Layer belongs to `@flarex/persistence-postgres`.
It closes Drizzle client, row codec, and transaction requirements and provides
`TaskSystemRunAttemptStore`.

`flarex-backend` owns the domain composition root. It combines:

```text
RunAttemptLifecycleLive
  <- PostgresTaskSystemRunAttemptStoreLive
  <- backend task-effect delivery adapter
  <- backend runtime-dispatch projection adapter
```

The backend host owns the one Effect runtime bridge appropriate to its request,
queue, alarm, or scheduled-event callback. A request, Durable Object, or
transaction capability must not be captured in a module-global Layer.

## Durable Requested Effects

The domain package owns only typed intent data and ordering policy. The first
capability may request:

- dispatch the accepted attempt;
- wake a retry at or after database-derived eligibility;
- request cancellation of a fenced execution;
- release queue/concurrency ownership;
- publish a normalized lifecycle event;
- notify a consumer to fetch the current state; and
- cancel obsolete heartbeat/lease work.

The Task System store persists these intents with the transition. Host adapters
deliver them idempotently after commit. This is task-lifecycle effect delivery;
it must not modify or duplicate the existing application-data commit compiler,
transaction journal, commit feed, or application outbox owners.

Waitpoint, batch, child-cancellation, and delayed-run intent variants are not
admitted in v1.

## Package Dependency Direction

The accepted direction is:

```text
flarex-backend composition
  -> @flarex/durable-task
  -> @flarex/persistence-postgres
       -> @flarex/durable-task

@flarex/executor or artifact-runtime adapter
  -> @flarex/durable-task internal models only when a later runtime projection
     preflight approves that dependency
```

There is no cycle because `@flarex/durable-task` depends only on Effect. The
domain does not import the Postgres implementation or backend composition.

The first package does not depend on `flarex-protocol`. No public or cross-
Worker task wire contract is approved yet. Roadmap 02 may later reuse an exact
existing application-revision/artifact contract or authorize a narrow protocol
subpath after it defines task identity and scope.

The first package also does not depend on `@flarex/utils`. A concrete exact
generic primitive may be added later; source similarity alone does not justify
the edge.

## Prohibited Production Imports

The future package boundary check must reject:

- `@trigger.dev/*` and Trigger internal packages;
- `third_party/trigger.dev` paths;
- Prisma, generated Prisma types, and `drizzle-orm`;
- `@flarex/persistence-postgres`;
- Redis clients, Redis worker, Redlock, and cache packages;
- Node built-ins and process APIs;
- Cloudflare, workerd, Wrangler, Durable Object, Worker Loader, HTTP, and Fetch
  host modules;
- `flarex-backend`, deployable apps, CLI, and test-harness packages;
- Trigger organization, project, environment, deployment, billing, and public
  SDK types; and
- direct `Date.now`, `new Date()` for authoritative decisions, and
  `Math.random()` inside retry policy.

Test-only compatibility runners may read frozen Trigger fixtures through a
separate-process harness. Production or package source may not.

## Export Boundary

`./internal/run-attempt-v1` may export only:

- the run-attempt service contract;
- the Task System store service contract required by its adapter;
- accepted command/outcome/error types needed by internal consumers;
- the live domain Layer constructor; and
- pure configuration/model types needed to compose that Layer.

It must not export:

- internal policy helpers merely for testing convenience;
- row codecs or persistence records;
- transaction callback implementation details;
- Trigger compatibility types or source-map metadata;
- host effect-delivery adapters;
- runtime payload projections;
- public API schemas; or
- a catch-all barrel.

Tests inside the package should import internal files locally. External tests
exercise the declared internal subpath.

## Compatibility Evidence Boundary

The frozen Trigger runner remains in its own workspace and process. The Flarex
runner uses `@flarex/durable-task` under the root workspace. Both consume a
versioned semantic scenario and emit canonical receipts; neither imports the
other.

The source map distinguishes retained upstream assertions from Flarex-added
correctness requirements. Deliberate divergences requiring explicit receipt
expectations include:

- database fence instead of Redis lock authority;
- database time instead of host time;
- idempotent duplicate completion;
- atomic durable effect intents;
- cancellation generation instead of premature terminal-only representation;
- corruption/unavailability distinction; and
- opaque compute escalation instead of Trigger machine pricing.

## DTE01-B Exit Gate

DTE01-B is complete for this capability because:

- every selected symbol or region has one primary `U`, `S`, `T`, or `D`
  classification;
- every `D` entry explains why all reuse forms are unsuitable;
- validation, failure, transition, effect, and event ordering changes are
  explicit;
- retained Trigger behavior and deliberate Flarex divergences have separate
  test ownership; and
- source hashes resolve to the pinned frozen import.

There are no `U` entries. Even the portable pure helpers require a Flarex type,
randomness, decoder, or authority seam, so describing them as unchanged would
hide semantic changes.

## DTE01-C Exit Gate

DTE01-C is complete for preflight purposes because:

- the exact future package name, private status, export, and initial dependency
  are fixed;
- domain, persistence, backend composition, runtime projection, and host
  delivery ownership are separated;
- the dependency direction is acyclic;
- public SDK and protocol exports remain excluded;
- Worker-portable prohibited imports are explicit; and
- no temporary Trigger compatibility package or merged workspace is required.

Final admission remains blocked on DTE01-D provenance mechanics, DTE01-E
compatibility receipt design, DTE01-F executable boundary/bundle gates, and the
DTE01-G consolidated decision.
