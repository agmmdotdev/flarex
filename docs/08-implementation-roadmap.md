# Implementation Roadmap

The current primary implementation path is the partitioned Durable Object
model. Full Postgres/global OCC remains an alternative future path for stronger
Convex compatibility.

## Implementation Principle

Build the smallest complete developer experience first:

```txt
defineTable.partitionBy / colocateWith
  -> mutation
  -> Dynamic Worker
  -> staged ctx.db writes
  -> one partition Durable Object SQLite commit
  -> reactive query update
```

Do not begin with cross-partition workflows or projections before the
single-partition atomic path is correct.

## Phase 0: Contracts And Types

Deliverables:

- finalize terminology: partition, projection, workflow mutation
- define schema placement metadata
- define `partitionBy` and `colocateWith`
- define generated `ScopedId` and partition-aware context types
- define consistency contracts for every function/model type

Acceptance:

- TypeScript examples compile for valid same-partition mutations
- obvious cross-partition writes fail type checking
- projection reads fail type checking inside mutations
- runtime contract documents match generated types

## Phase 1: Worker Gateway And Dynamic Worker Runtime

Deliverables:

- Cloudflare Worker entrypoint
- compatible `/query`, `/mutation`, `/action`, and `/sync` route skeletons
- Dynamic Worker source package loading
- restricted syscall binding
- separate query, mutation, and action capability sets

Acceptance:

- existing Convex-shaped HTTP request invokes a Dynamic Worker function
- mutation runtime cannot use external side-effect bindings
- action runtime can use approved external bindings
- user code receives no raw Durable Object or database binding

## Phase 2: One Partition Durable Object

Deliverables:

- partition address resolver
- partition Durable Object with SQLite
- logical tables and indexes inside one partition
- document ID generation
- `ctx.db.get`, query, insert, patch, replace, delete syscalls
- staged write set
- read-your-own-writes overlay
- atomic final SQLite commit

Acceptance:

- one mutation updates multiple colocated tables atomically
- loops and `Promise.all` stage all writes into one mutation
- failure commits nothing
- later reads inside mutation see staged writes
- mutations targeting different partitions do not block each other

## Phase 3: Runtime Partition Enforcement

Deliverables:

- resolve every authoritative read/write to a partition
- infer or validate selected mutation partition
- reject multiple partitions before commit
- clear `CrossPartitionMutationError`
- build-time lint/analyzer checks

Acceptance:

- same-partition mutation succeeds
- accidental cross-partition mutation commits nothing
- JavaScript and unsafe TypeScript casts are still rejected at runtime
- error recommends `workflowMutation` when appropriate

## Phase 4: Reactive Queries And Sync

Deliverables:

- Connection Durable Object
- `/sync` protocol compatibility layer
- partition-local query subscriptions
- query dependency capture for partition-local tables/indexes
- query invalidation after partition commit
- Convex-style transitions

Acceptance:

- existing client connects to `/sync`
- `useQuery` receives initial result
- same-partition mutation invalidates affected query
- unrelated mutation does not rerun query
- reconnect rebuilds query set

## Phase 5: Projection Engine

Deliverables:

- `defineProjection`
- durable source mutation events
- projection processor
- target projection partition writes
- idempotent projection event processing
- reactive projection queries
- projection rebuild/version mechanism

Acceptance:

- source mutation automatically updates projection
- projection query receives live update
- projection read is unavailable in mutation context
- projection write is rejected
- processor restart catches up durable events
- projection can be rebuilt after definition change

## Phase 6: Workflow Mutations

Deliverables:

- `workflowMutation`
- planning/staging execution mode
- group operations by partition
- deterministic generated Workflow plan
- one atomic Cloudflare Workflow step per partition
- step idempotency records
- retries
- conditional compensation
- workflow status API

Acceptance:

- cross-partition loop/map executes without developer-written Workflow steps
- multiple operations in one partition become one atomic step
- independent partition steps can run concurrently
- retry does not duplicate writes
- compensation status is observable
- normal mutation never silently upgrades into workflow semantics

## Phase 7: Platform Completeness

Deliverables:

- actions and HTTP actions
- internal function calls
- scheduler and cron
- auth identity changes
- environment variables
- R2-backed storage
- logs and usage metrics

Acceptance:

- action can call mutation and workflow mutation
- scheduled function is durable and idempotent
- auth-sensitive query reruns after identity change
- storage upload and metadata flow works

## Phase 8: Hardening

Deliverables:

- partition migration tooling
- hot-partition metrics and limits
- Workflow concurrency controls
- projection lag metrics
- recovery and chaos tests
- compatibility tests against existing Convex clients
- cost/load benchmarks

Acceptance:

- partition failures do not corrupt SQLite state
- Workflow retries are idempotent
- projection failures recover without missing source events
- hot partition behavior is observable
- existing client compatibility suite passes

## First Code Slice

The first implementation should prove one atomic partition mutation:

```txt
POST /mutation
  -> Dynamic Worker mutation
  -> fake/generated partition-aware ctx.db
  -> stage several writes from a loop
  -> Partition DO SQLite transaction
  -> Convex-shaped response
```

Recommended first acceptance test:

```ts
await Promise.all(
  exercises.map(exercise =>
    ctx.db.insert("lessonProgress", {
      userId,
      lessonId: exercise.id,
      completed: true,
    }),
  ),
);

await ctx.db.patch(progressId, { completedCount: exercises.length });
```

Verify:

- every document belongs to one user partition
- all writes become visible together
- injected failure commits nothing
- a later read inside the mutation sees staged inserts

## Suggested Repo Layout

```txt
custom/cloudflare-executor/
  README.md
  CLOUDFLARE_CONVEX_RUNTIME.md
  docs/
  src/
    gateway/
    runtime/
    schema/
    partitions/
    transactions/
    sync/
    projections/
    workflows/
```

Introduce `src/` only when implementation begins.
