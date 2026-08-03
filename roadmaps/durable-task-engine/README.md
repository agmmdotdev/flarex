# Flarex Durable Task Engine Roadmaps

## Status And Scope

**Status:** Vision authority; focused roadmap decomposition and implementation
preflight remain pending.

This folder will own the focused execution roadmaps for a Flarex-native durable
task engine derived from the pinned Trigger.dev compatibility source. For now,
this README records the shared vision, non-negotiable boundaries, target system
shape, and proposed roadmap decomposition. It does not authorize package
creation, schema or migration changes, workspace merging, public APIs,
scheduling, deployment, or production activation.

The accepted architecture direction remains recorded in
[`../../design-notes/flarex-durable-task-engine.md`](../../design-notes/flarex-durable-task-engine.md).
The frozen source and workspace boundary remain documented in
[`../../third_party/trigger.dev/README.md`](../../third_party/trigger.dev/README.md).
Focused plans added here must refine those authorities rather than silently
replacing them.

## Vision

Build a Flarex-owned durable task system by reusing Trigger.dev's mature run
engine logic, invariants, algorithms, and failure tests while replacing the
parts whose authority belongs to Trigger.dev's product, Prisma/Redis storage,
long-running Node hosts, or deployment platform.

"Flarex-owned" does not mean "rewrite from a blank page." The default migration
order is:

1. reuse source and tests unchanged where the contract is already portable;
2. preserve control flow while carving database, queue, clock, identity,
   observability, and compute dependencies behind narrow Flarex ports;
3. translate Prisma and Redis adapters to Flarex-owned implementations while
   preserving operation semantics, transaction order, failure behavior, and
   race coverage; and
4. reimplement only when the original module cannot be separated from
   Trigger-specific product policy or conflicts with Flarex authority.

The target product is not an embedded or rebranded Trigger.dev deployment. It
is a Flarex durable task capability that shares Flarex application revisions,
runtime artifacts, tenant and scope resolution, trusted execution, Postgres
authority, Cloudflare hosting, and observability boundaries.

## Current Reality

The imported Trigger.dev source is a frozen, independently installable pnpm
workspace under [`../../third_party/trigger.dev`](../../third_party/trigger.dev).
It has its own lockfile, generated Prisma clients, dependency versions, test
lane, and Node/Postgres/Redis assumptions. It is excluded from the Flarex root
workspace and runtime graph, and the repository boundary checker rejects direct
Trigger package or source-island dependencies from active Flarex packages.

Trigger.dev supplies substantial reusable behavior for:

- runs, attempts, snapshots, retries, cancellation, TTL, and delayed work;
- waitpoints, checkpoints, debounce, batching, concurrency, and fair queues;
- idempotency, event ordering, restart recovery, and uncertainty handling;
- compute supervision and runtime coordination; and
- trace, log, metric, dashboard, and live-update concepts.

Its current run-engine construction also mixes that behavior with:

- Prisma-generated types, query shapes, transactions, and schemas;
- Trigger organization, project, environment, deployment, auth, billing, and
  product-routing models;
- Redis queues, Lua/keyspace protocols, pub/sub, and Redlock coordination;
- process-local timers and long-running Node supervisor lifecycle;
- Docker, Kubernetes, registry, and Trigger compute assumptions; and
- Trigger public SDK, management API, and dashboard contracts.

No active Flarex package currently implements the general durable task
lifecycle, and no imported Trigger package is production-routed.

## Foundation Decisions

### 1. Reuse Is The Default

Every extraction preflight must start from the concrete Trigger source and
tests. It must identify which implementation can be lifted, which dependencies
must become ports, which adapter mechanics require translation, and which
product policies must be discarded. A fresh implementation requires a written
reason why source adaptation is unsafe or materially less correct.

Adapted source must retain provenance to the pinned Trigger commit and the
required upstream license notices. Behavioral compatibility must be proved
with ported or differential tests rather than inferred from similar-looking
code.

### 2. The Two Workspaces Remain Separate During Extraction

Do not merge the Trigger and Flarex pnpm workspaces or lockfiles merely to begin
reuse. The Trigger workspace remains an immutable source and regression oracle.
Transformed capabilities enter the root workspace only as Flarex-owned source
with root-owned manifests, dependency versions, package boundaries, tests, and
bundle gates.

No active package may depend on `@trigger.dev/*`, Trigger internal package
names, generated Trigger Prisma clients, or a `third_party/trigger.dev` path.
Test tooling may run the two workspaces as separate processes and compare
normalized receipts; production code may not create a dual runtime.

### 3. Trigger Product Identity Is Replaced, Not Renamed

Trigger's organization, membership, project, environment, deployment, and
authentication ownership will not be migrated table-for-table. Flarex resolves
the durable task's tenant, project, environment, deployment, concrete data
scope, immutable application revision, and runtime artifact through trusted
Flarex authority.

A Flarex tenant is the customer and administrative boundary. A scope is the
concrete data-plane authority. They are not interchangeable, and a mechanical
`organizationId -> tenantId` or `environmentId -> scopeId` rename is invalid.

### 4. Task State Lives Behind A Private FlarexDB Task System API

Durable run state is reserved platform state, not arbitrary developer app data.
A private Task System API will own operation-specific atomic capabilities such
as run creation, due-run discovery, fenced attempt claims, heartbeats,
completion, retries, cancellation, waitpoints, and ordered task events.

The durable task engine must not receive Prisma, Drizzle, raw SQL, physical
locators, or an open database transaction. The Postgres implementation may use
Drizzle inside `@flarex/persistence-postgres`, but the domain contract remains
storage-neutral.

Task lifecycle transactions govern task state only. User-code database effects
continue through the existing executor, OCC, commit, outcome, feed, and outbox
owners. Durable task work must not create a parallel application-data commit
system or change those owners incidentally.

### 5. Durable Truth Is Reconstructable

The authoritative database clock, monotonic attempt fence, lease, cancellation
generation, run version, idempotency identity, and terminal outcome must be
durable. Every Worker invocation must reconstruct authority from stored state.

Cloudflare Queues, Durable Object alarms, cron triggers, notifications, and
process-local timers may reduce latency, but delivery is not authoritative.
Missed and duplicated wakeups must recover through bounded durable discovery
and fenced claims.

### 6. Execution Reuses Existing Flarex Runtime Owners

The task engine schedules and supervises task attempts; it does not create a
second user-code runtime. Attempts bind to immutable Flarex application
revisions and runtime artifacts and execute through a Flarex-owned
`ComputeProvider`, using the existing Worker Loader/runtime boundary or another
approved provider such as AgentOS.

User code receives the same restricted execution and database capabilities as
other Flarex runtime paths. It never receives task tables, Postgres, Drizzle,
Cloudflare infrastructure authority, or compute-provider credentials.

### 7. Observability Has Separate State, Trace, And Stream Lanes

The web application will consume safe, scope-authorized read models rather than
raw task tables. Durable run/attempt state, trace/log projections, live change
notifications, and user-defined output streams have different contracts:

- query APIs return durable run, attempt, event, and trace projections;
- live APIs publish bounded invalidations or version/cursor advancement and
  clients refetch authoritative projections;
- logs, traces, metrics, and large output bodies use their owning
  observability or object store; and
- user-defined streams such as AI tokens remain separate from authoritative
  task-state transitions.

Notification loss may delay a UI refresh but must not lose durable state.
Observability projections and analytics never replace the Task System API's
authoritative run and attempt records.

## Target Dependency Direction

```text
private then public Flarex task APIs
        -> reused and adapted durable-run engine logic
             -> private FlarexDB Task System API
                  -> Drizzle/Postgres implementation
             -> Flarex task event and observability ports
             -> Cloudflare wake and coordination adapters
             -> Flarex ComputeProvider
                  -> Worker Loader runtime
                  -> AgentOS or another approved provider
```

Likely package owners include a workspace-private host-neutral durable-task
domain package, `@flarex/persistence-postgres` for database mechanics,
`@flarex/executor` for trusted execution adaptation, and `flarex-backend` plus
thin deployable apps for hosted APIs and Cloudflare composition. Exact package
names, exports, dependency direction, and admission order remain decisions for
the package roadmap; this README does not create them.

Public SDK ergonomics come last. The first real-system-compatible task
definition, analysis, registration, and invocation surfaces must be private
and capability-gated through the Standard Application owners before the public
`flarex` package exposes a task API.

## Reuse And Migration Evidence

Each extracted capability should carry a source map containing:

- pinned upstream commit and source path;
- target Flarex owner and source path;
- classification as unchanged, seam-adapted, adapter-translated, or discarded;
- semantic changes and their authority rationale;
- upstream tests and hostile scenarios retained;
- Flarex-specific tests added for tenant/scope, fencing, Cloudflare restart,
  and Worker bundle behavior; and
- applicable license and notice requirements.

Where practical, a test-only compatibility runner should execute one normalized
scenario against the frozen Trigger implementation and the transformed Flarex
implementation, then compare transition receipts. This comparison must remain
outside production and must not become dual writes, shadow task execution, or a
runtime fallback.

## First Bounded Product Proof

The first proof remains deliberately smaller than Trigger parity:

1. define and analyze one private Flarex task;
2. bind it to one immutable application revision and runtime artifact;
3. create one idempotent durable run inside one trusted scope;
4. discover the due run through the private Task System API;
5. acquire one attempt using the authoritative database clock, a lease, and a
   monotonic execution fence;
6. execute through the existing Flarex runtime boundary;
7. record bounded heartbeat evidence;
8. commit one terminal result or bounded retry decision; and
9. recover correctly from duplicate wakeups, worker loss, lease expiry, stale
   completion, and a lost completion response.

The proof begins with one queue and a bounded retry policy. Cron, batches,
debounce, waitpoints, checkpoints, advanced fairness, broad observability UI,
cross-provider placement, and public SDK integration remain later gates.

## Roadmap Decomposition

The first focused preflight now exists. The remaining files are candidates for
the next discussions; their names and order are not approved by this README:

1. [`01-source-reuse-and-package-admission.md`](./01-source-reuse-and-package-admission.md)
   - source map, license/provenance, dependency closure, workspace strategy,
     transformed package ownership, and compatibility receipt harness;
2. `02-task-definition-identity-and-scope.md`
   - private task definition, Standard Application stages, tenant/project/
     environment/deployment/scope resolution, revision and artifact binding;
3. `03-run-attempt-engine.md`
   - reused statuses, retry policy, run/attempt lifecycle, cancellation,
     leases, fences, clocks, failures, and deterministic transition evidence;
4. `04-task-system-api-and-postgres.md`
   - private operation contracts, Drizzle schema, transactions, idempotency,
     discovery, ordered events, corruption policy, PGlite, and real Postgres;
5. `05-cloudflare-wake-and-scheduling.md`
   - Queues, alarms, cron, missed-wakeup recovery, duplicate delivery, bounded
     schedulers, and fail-closed activation;
6. `06-compute-provider-and-runtime.md`
   - Worker Loader reuse, compute assignment, heartbeats, interruption,
     checkpoints, AgentOS boundary, and restricted user capabilities;
7. `07-observability-live-apis-and-ui.md`
   - run/attempt read models, traces/logs, cursors, live invalidation, streams,
     authorization, retention, privacy, and dashboard consumption;
8. `08-trigger-compatibility-and-parity.md`
   - upstream scenario inventory, differential receipts, races, uncertainty,
     performance, package bundles, and capability retirement gates;
9. `09-first-private-vertical.md`
   - end-to-end production-inert composition and hosted proof; and
10. `10-public-api-readiness-and-activation.md`
    - public SDK, management API, quotas, operational readiness, routing,
      rollout, and eventual compatibility-island retirement.

Roadmap 01 must identify the smallest connected Trigger source slice worth
lifting first and complete its admission preflight before implementation.

## Non-Goals

This roadmap family does not authorize:

- copying Trigger's complete Prisma schema into Drizzle;
- exposing Trigger organizations or Trigger public API compatibility;
- merging pnpm lockfiles or making the root workspace depend on the source
  island;
- adopting Redis, Redlock, Docker, Kubernetes, or a permanent Node supervisor
  as Flarex authority;
- treating Queue, alarm, cron, SSE, or live-sync delivery as durable truth;
- storing large artifacts, logs, traces, payloads, or checkpoints redundantly
  in task-state rows;
- changing existing application-row OCC, commit, feed, outbox, or outcome
  semantics as an incidental task-engine step;
- public task APIs before the private real-system vertical and capability gates
  are proven; or
- production activation, dual execution, silent fallback, or compatibility
  cutover merely because a package or schema exists.

## Authority And References

Use these sources in order until focused plans refine the domain:

1. [`../../design-notes/flarex-durable-task-engine.md`](../../design-notes/flarex-durable-task-engine.md)
   for the accepted durable-task architecture direction;
2. this README for the roadmap-family vision and decomposition boundary;
3. future focused plans in this folder for accepted gates and status;
4. [`../../third_party/trigger.dev/README.md`](../../third_party/trigger.dev/README.md),
   [`../../third_party/trigger.dev/SOURCE.json`](../../third_party/trigger.dev/SOURCE.json),
   and the frozen upstream source for migration evidence and provenance;
5. [`../16-package-boundaries.md`](../16-package-boundaries.md) for active
   workspace ownership and dependency direction;
6. [`../../design-notes/flarexdb-system-apis-proposal.md`](../../design-notes/flarexdb-system-apis-proposal.md)
   for the discussion-stage private Task System API and tenant/scope model;
7. [`../42-standard-application-apis.md`](../42-standard-application-apis.md)
   for private definition, analysis, registration, and invocation ownership;
8. [`../06-dynamic-worker-execution.md`](../06-dynamic-worker-execution.md)
   for runtime artifact and Worker Loader authority; and
9. current code and tests for implemented behavior, never as proof that an
   unapproved imported path is production-ready.
