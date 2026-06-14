# Actions, Scheduling, Auth, And Storage

The first milestone can focus on query, mutation, and sync. But Convex
compatibility also requires actions, scheduled functions, auth, environment
variables, and file storage.

## Actions

Actions are the side-effect boundary.

They can:

- call external APIs with `fetch`
- send email
- call payment providers
- call LLM APIs
- call `ctx.runQuery`
- call `ctx.runMutation`
- call `ctx.runAction`

They cannot:

- directly access partition Durable Object storage
- participate in mutation OCC
- rely on automatic transaction retry

Action database access should go through the same public/internal function
execution path used by Convex.

## Action Runtime

```txt
Action Dynamic Worker
  -> action ctx
       runQuery
       runMutation
       runAction
       scheduler
       storage
       auth
       fetch allowed
  -> Application API
```

This runtime may expose more platform capability than mutations. Keep it
separate from the mutation runtime so deterministic restrictions do not become
ambiguous.

## Scheduled Functions

Scheduling from a mutation must be transactional. If the mutation rolls back or
retries, the scheduled function should not be duplicated.

Mutation scheduling path:

```txt
ctx.scheduler.runAfter(...)
  -> stage scheduled function in transaction
  -> commit coordinator writes schedule record with same commit
  -> scheduler worker/DO later dispatches action or mutation
```

Suggested table:

```sql
create table scheduled_functions (
  deployment_id text not null,
  job_id text not null,
  due_at timestamptz not null,
  function_path text not null,
  function_type text not null,
  args_jsonb jsonb not null,
  state text not null,
  created_commit_ts bigint not null,
  primary key (deployment_id, job_id)
);

create index scheduled_functions_due
  on scheduled_functions (deployment_id, state, due_at);
```

Dispatch can use a Durable Object alarm per deployment or a polling Worker.

## Cron Jobs

Cron configuration is deployment metadata. It should compile from source config
into system records.

Cron dispatch:

```txt
Cloudflare scheduled event
  -> deployment scheduler coordinator
  -> find due cron jobs
  -> enqueue scheduled function records
  -> dispatch through Application API
```

Do not call user functions directly from the scheduled event without recording
durable job state.

## Auth

Auth should preserve the `ctx.auth.getUserIdentity()` behavior.

Auth flow:

```txt
Gateway extracts token
  -> Auth service validates token
  -> Identity attached to request/session
  -> Dynamic Worker receives identity through ctx.auth syscall
```

For sync:

- connection starts with unknown or authenticated identity
- auth changes bump identity version
- affected queries rerun under new identity
- server sends transition reflecting auth-sensitive query changes

Auth state is part of query behavior. Queries that read auth identity need to
rerun when identity changes.

## Environment Variables

Environment variables are deployment configuration. If queries can read them,
changes may invalidate many or all subscriptions because env values are not
part of query args.

Start with a conservative rule:

- env var changes invalidate all query subscriptions for the deployment
- mutations/actions read latest env values through host syscalls
- Dynamic Workers do not receive raw secret bindings directly unless scoped to
  the function type and deployment

## File Storage

Storage has two pieces:

- object bytes in R2 or another object store
- metadata and authorization in authoritative partition storage

Suggested metadata:

```sql
create table file_storage (
  deployment_id text not null,
  storage_id text not null,
  component_id text not null,
  sha256 text,
  content_type text,
  size_bytes bigint,
  state text not null,
  created_commit_ts bigint,
  primary key (deployment_id, storage_id)
);
```

Upload flow:

```txt
ctx.storage.generateUploadUrl()
  -> create signed upload intent
  -> client uploads bytes to R2
  -> finalize metadata through mutation or internal endpoint
```

Mutation writes involving storage metadata should be staged with the transaction
when they affect application-visible state.

## Internal Function Calls

Actions and scheduled jobs need internal calls:

```txt
ctx.runQuery(api.foo.bar, args)
ctx.runMutation(api.foo.bar, args)
ctx.runAction(api.foo.bar, args)
```

These should call the same Application API implementation as public calls, but
with an internal caller identity and component path.

Do not special-case internal calls by bypassing auth, read-set tracking, or OCC.

## Security Boundaries

- Dynamic Workers do not get raw Durable Object or storage bindings.
- Mutation workers do not get external network capability.
- Action workers get external network capability but no raw DB capability.
- Storage signing keys remain in trusted host services.
- Source packages are verified before loading.
- Syscall requests include deployment ID, execution ID, function type, and
  caller identity.

## Required Tests

- action can call external fetch and then run mutation
- mutation cannot call external fetch
- scheduled function created by rolled-back mutation is not dispatched
- scheduled function created by committed mutation dispatches once
- auth identity change reruns subscribed auth-sensitive query
- env var update invalidates affected queries
- storage upload metadata is visible only after authorization/finalization
