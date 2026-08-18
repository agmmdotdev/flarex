# Preflight 43: Task Context Principal And Query Callback

Status: Implemented privately and production-inert. Authenticated-user
principal issuance, immutable publication, persisted run binding, launch
reconstruction, and the capability-only Worker query callback are complete.

This preflight owns the next DTE06-F0A core-runtime checkpoint. It does not
authorize observability APIs, UI work, mutation callbacks, outbound I/O,
nested scheduling, lifecycle changes, production routes, or Cloudflare
resource mutation.

## Why This Gate Exists

The shared Application query execution core and the backend-private
`ApplicationTaskQueryAuthority` now exist. The remaining Task-to-query path is
not merely an RPC adapter. This checkpoint now issues a scope-bound immutable
authenticated-user principal object, includes its exact reference in new
Application Task creation requests and run rows, and reconstructs an owned
identity at launch. The Worker receives no identity or selection authority.

Before this checkpoint, Application Task run creation contained only:

- the idempotent request key;
- the Application runtime-target digest; and
- the immutable Task input reference.

The creation authority already authenticated the active Application head and
runtime target. New Application Task requests now also hash and persist one
`authenticated_user` principal reference. The scope-local issuer accepts an
authenticated user identity rather than a caller-supplied reference, publishes
the canonical scope-bound object through the immutable R2 owner, and supplies
the resulting reference to run creation. Pre-existing private Application runs
marked `legacy_absent` fail closed during compute preparation; Legacy Task rows
remain `not_applicable`. Compute preparation carries the persisted reference,
and launch verifies its key, length, digest, canonical codec, user kind, and
scope before returning an owned frozen identity. The Worker session does not
receive that identity. The current Application Task Worker invokes the handler
as `task(ctx, payload)`, where the frozen context exposes only
`runQuery(functionPath, arguments)`.

The host binds that authenticated launch identity through
`ApplicationTaskQueryAuthority` before Worker start. The Worker receives a
separate RPC target that exposes only one bounded query invocation method.
Provider execution identity, run ID, scope, request key, and compute-dispatch
identity remain invalid substitutes. Anonymous request identity is explicitly
forbidden.

## Accepted Direction To Approve

The durable Task owner uses one immutable, authenticated execution-principal
reference in Application Task run creation. The reference, not raw caller
input, is part of the hashed creation request and replay contract. Its current
compatibility object binds:

- a concrete principal kind;
- a canonical codec and immutable object-store reference;
- exact byte length and digest;
- scope/run-creation correlation;
- retention and privacy policy; and
- the authority that is allowed to mint the reference.

A user-started Task principal must decode to the authenticated user identity
that existed when the run was created. A scheduled or system-started Task must
use a separately defined system-principal contract. It must not be represented
as anonymous user traffic, and it must not inherit an expired request object or
ambient host authentication state.

The exact persisted contract may be versioned because old and new run evidence
can coexist during migration. Product and capability names remain unversioned.

## Required Authority Flow

```text
authenticated caller or approved system scheduler
  -> Task principal issuer
  -> immutable principal object + exact reference
  -> hashed Application Task run-creation request
  -> persisted run authority
  -> launch authority reads and verifies the exact object
  -> ApplicationTaskQueryAuthority binds one owned principal
  -> Worker receives a capability-only query callback
```

The Worker must never receive the principal object, database handle, activation
repository, selection capability, or query host. It sends only a bounded query
request. The host uses the principal already bound to the accepted Task
session.

## First Callback Contract

The first admitted Task context member is read-only query execution. Its
private Worker RPC contract includes:

- one operation discriminant and compatibility version;
- a bounded function path;
- canonical bounded arguments;
- one host-allocated call identity;
- cancellation/interruption and absolute-deadline behavior;
- a host-owned per-session in-flight query ceiling;
- a canonical bounded result or typed failure; and
- exact single-settlement and late-result disposal rules.

The callback re-reads and correlates the active Application selection on
every call through `ApplicationTaskQueryAuthority`, then invoke the shared
selection-bound query port. The Worker cannot select scope, activation,
revision, candidate, principal, or snapshot.

The Standard Application runtime owns the exact handler order
`task(ctx, payload)`. There is no dual-signature fallback. Legacy Task execution
retains its existing handler contract and receives no Application query
capability.

The Worker request contains only the operation, bounded path, normalized
arguments, and semantic byte count. The host allocates the call identity and
absolute deadline, revalidates the active Application selection for every
call, and returns a strict success/failure envelope. Session close interrupts
in-flight host Effects; the Worker stops awaiting a callback on Task
interruption and disposes any late RPC result.

## Explicitly Deferred

- `ctx.runMutation`;
- outbound network calls;
- nested Task creation, enqueue, delay, or scheduling;
- durable or replay-significant callback ordinals; the current read-only query
  capability uses only an ephemeral session-local ordinal in its diagnostic
  call identity;
- requested-effect persistence for side-effecting callbacks;
- public API or SDK ergonomics;
- run dashboards, logs, traces, live subscriptions, or Trigger.dev UI reuse;
- production Queue, Cron, route, binding, Hyperdrive, or R2 activation.

Mutation, outbound, and scheduling callbacks require a Task-owned durable
effect/ordinal/replay contract and cannot reuse foreground Action callbacks.

## Required Proof Before Full Completion

1. anonymous, malformed, forged, cross-scope, and digest-mismatched principal
   identities, objects, and references fail before Worker start;
2. exact run-creation replay returns the same principal reference and a
   conflicting principal fails as an idempotency conflict;
3. retry, lease takeover, and fresh-host recovery reconstruct the same owned
   principal;
4. caller mutation, adapter mutation, and Worker input cannot retarget the
   bound principal;
5. one genuine Worker callback executes the existing selection-bound query
   core with the bound principal;
6. active-head movement, interruption, deadline, malformed request/result,
   Worker loss, and late RPC completion fail closed without lifecycle or
   mutation authority leakage;
7. a Task without an admitted principal/context cannot observe `runQuery`;
8. Legacy Task execution and foreground Query/Mutation/Action behavior remain
   unchanged; and
9. PGlite plus genuine PostgreSQL prove the new persisted reference, migration,
   replay, transaction, and constraint behavior.

## Stop Boundary

This implementation stops after the persisted Task-principal contract, exact
launch reconstruction, read-only query callback ABI, and private connected
proof. It does not authorize the deferred capabilities or any production
activation.
