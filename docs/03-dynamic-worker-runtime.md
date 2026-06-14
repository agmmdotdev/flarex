# Dynamic Worker Runtime

Dynamic Workers are the user-code isolation layer. They are not the database
engine, not the sync engine, and not the commit coordinator.

## Runtime Goal

Run Convex user functions on Cloudflare while preserving the Convex function
model:

- queries are read-only
- mutations are deterministic and retryable
- actions can perform side effects
- HTTP actions handle HTTP requests
- user code does not receive raw database connections

## Runtime Topology

```txt
Application API
  -> Function Executor
       loads source package
       chooses function entrypoint
       chooses function type
  -> Dynamic Worker
       receives restricted bindings
       calls host syscalls
  -> Syscall Coordinator
       records reads and writes
       calls transaction/storage/auth services
```

## Source Packages

The runtime should load a verified source package by stable package ID:

```ts
type SourcePackageRef = {
  deploymentId: string;
  packageId: string;
  packageHash: string;
  modules: Record<string, string>;
  entrypoints: FunctionRegistry;
};
```

The Worker loader key should include:

```txt
deployment_id
source_package_hash
runtime_kind
compatibility_date
```

This prevents accidentally reusing stale code across deployments.

## Restricted Bindings

User code receives a binding facade, not direct platform bindings:

```ts
type ConvexWorkerEnv = {
  CONVEX_SYSCALLS: Fetcher;
  CONVEX_EXECUTION: {
    deploymentId: string;
    requestId: string;
    functionType: "query" | "mutation" | "action" | "httpAction";
    functionPath: string;
  };
};
```

The user-facing `ctx` object is built on top:

```ts
type QueryCtx = {
  db: DatabaseReader;
  auth: Auth;
  storage: StorageReader;
};

type MutationCtx = {
  db: DatabaseWriter;
  auth: Auth;
  scheduler: Scheduler;
  storage: StorageWriter;
};

type ActionCtx = {
  runQuery: RunQuery;
  runMutation: RunMutation;
  runAction: RunAction;
  auth: Auth;
  scheduler: Scheduler;
  storage: StorageActionAccess;
};
```

## Query Runtime Rules

Queries:

- can read database documents and indexes
- can read auth state
- can read environment variables if supported
- cannot write documents
- cannot schedule functions
- cannot perform external side effects
- return value plus read-set token

The query runtime should reject mutation-only syscalls.

## Mutation Runtime Rules

Mutations:

- can read documents and indexes
- can stage inserts, patches, replaces, and deletes
- can schedule functions transactionally
- can write storage metadata transactionally where supported
- cannot call arbitrary external network APIs
- cannot perform non-deterministic side effects
- can be retried from the beginning on OCC conflict

The mutation runtime should treat deterministic retry as a correctness
requirement. If a mutation can send email or call Stripe directly, retry becomes
unsafe. That must stay in actions.

## Action Runtime Rules

Actions:

- can call external APIs
- can use `fetch`
- can call `ctx.runQuery`
- can call `ctx.runMutation`
- can call `ctx.runAction`
- are not automatically retried as transactions
- should not receive direct database connections

Actions use queries and mutations as the database boundary.

## HTTP Action Runtime Rules

HTTP actions:

- receive an HTTP request
- return an HTTP response
- can perform side effects
- can call queries and mutations
- must preserve Convex HTTP action routing behavior

HTTP action streaming can be added after the base function runtime works.

## Syscall Protocol

All database operations become syscalls:

```ts
type SyscallRequest =
  | { type: "db.get"; table: string; id: string }
  | { type: "db.queryPage"; table: string; index: string; range: Range; limit: number }
  | { type: "db.insert"; table: string; value: unknown }
  | { type: "db.patch"; id: string; patch: unknown }
  | { type: "db.replace"; id: string; value: unknown }
  | { type: "db.delete"; id: string }
  | { type: "auth.getUserIdentity" }
  | { type: "scheduler.runAfter"; path: string; args: unknown; delayMs: number }
  | { type: "storage.generateUploadUrl" };
```

The coordinator attaches these syscalls to an execution context:

```ts
type ExecutionContextState = {
  executionId: string;
  functionType: FunctionType;
  snapshotTs: bigint;
  readSet: ReadSet;
  writeSet: WriteSet;
  scheduledFunctions: ScheduledFunction[];
  usage: FunctionUsage;
};
```

## Error Shape

Runtime errors should preserve Convex-style redacted function errors:

- user error name/message
- optional error data
- stack frames when allowed
- log lines
- execution timing
- syscall trace when enabled

The HTTP and sync protocols should not expose raw internal Cloudflare, Durable
Object, SQLite, Workflow, or storage errors.

## Determinism Guardrails

For mutation Dynamic Workers:

- remove or wrap `fetch`
- avoid exposing uncontrolled random APIs
- avoid exposing Date/time except through deterministic host APIs
- forbid raw platform bindings
- make all database writes staged
- make scheduler calls staged until commit

If a capability cannot be made deterministic, expose it only in actions.

## Local Testing Strategy

Start with fake syscalls:

```txt
Dynamic Worker
  -> fake in-memory coordinator
  -> deterministic test data
```

Then replace fake syscalls with partition Durable Object-backed syscalls. This
lets the runtime and bundling path be tested before projections and workflow
mutations are complete.
