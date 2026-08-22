# Preflight 42: DTE06-F Hosted Runtime Proof

## Status And Decision

**Decision:** approved as the implementation-ready boundary for the
production-inert DTE06-F proof. Runtime/provider convergence and the connected
PGlite/genuine-PostgreSQL acceptance matrix are complete. The private
event-lifetime host kernel and its immutable launch-resource composition are
complete as separate F1 checkpoints below. The first private hosted PGlite
vertical and its ordinary-role genuine-PostgreSQL counterpart are also
complete. DTE06-F1 is complete privately. The active checkpoint is now
DTE06-F2 fresh-host recovery and takeover.
Any deployment to a real Cloudflare account, creation of R2 or Hyperdrive
resources, secret write, or external database mutation remains a separate
explicit approval gate.

DTE06-A through DTE06-E are complete privately. They already provide the
provider-neutral contract, fenced delivery repository, bounded connected
runner, authenticated Application task launch, fresh Worker Loader session,
heartbeat, cancellation acknowledgement, immutable result publication,
completion/retry settlement, and connected PGlite/Miniflare matrix. DTE06-F
must prove those owners survive a real host/resource topology and a fresh-host
recovery cycle. It must not create another task engine or reopen their contracts
for convenience.

This preflight does **not** authorize a production route, Queue consumer, Cron
Trigger, public task API, observability feed, dashboard, fallback runtime,
Legacy/Application comparison path, or production activation.

## Why This Gate Exists

The current connected system test intentionally owns all resources in one
process and waits for supervision before releasing its Effect scope. That is
the correct DTE06-E semantic proof, but it does not establish these hosted
facts:

- the real task runtime and result objects can be read/written through R2;
- the control directory and located Task System operations can run through
  cache-disabled Hyperdrive and genuine PostgreSQL with their deadline owners;
- one Cloudflare event keeps the provider Layer alive through every accepted
  session it owns;
- losing that host cannot turn process-local provider state into authority;
- a fresh host can resume from persisted delivery/lifecycle evidence without
  duplicating result or completion authority; and
- Worker Loader, database, R2, RPC, and event resources settle or are handed
  back to the existing lease-recovery path within explicit bounds.

DTE06-F is an operational/topology proof over the current core. It is not a
license to rewrite the core under a new hosted abstraction.

## Corrections To Earlier Shorthand

### Warm Does Not Mean Reusing A Task Worker

The accepted Application task runtime uses fresh `WorkerLoader.load` isolation.
DTE06-F must preserve that rule. A repeated invocation may reuse immutable R2
objects, module bytes, or platform compilation artifacts only where the
existing owner already permits it. It must still create a fresh task Worker
session and must not switch to `WorkerLoader.get`, a shared user-code isolate,
or a process-local workload cache.

The proof matrix therefore uses these terms:

- **cold object path:** the host reads and verifies all required immutable
  runtime objects without assuming a resident cache;
- **repeat object path:** the same content-addressed objects are requested
  again and may benefit from owner/platform caching without weakening any
  digest or authority check; and
- **fresh execution:** every dispatch uses a newly loaded task Worker in both
  paths.

### Provider Scope Is Part Of Host Correctness

`WorkerLoaderTaskComputeProvider` owns accepted sessions and their supervisors
inside its Layer scope. `TaskComputeDeliveryConnectedRunner.run` can return
after provider acceptance while supervision continues in that scope. A hosted
event must therefore keep the scope alive until every session admitted by that
event has one observed supervisor `Exit`, or until the event itself is lost and
the database lease becomes the only recovery authority.

Returning a runner receipt and immediately closing the Layer is invalid. So is
detaching a Promise without connecting it to the Cloudflare event lifetime.
DTE06-F may add a backend-private host drain/admission tracker, but it may not
widen `TaskComputeProvider` or make the tracker durable authority.

### Restart Means A Fresh Host With No Shared Memory

The recovery proof must construct a second provider/runner/host scope with no
references to the first scope. It must use only persisted lifecycle, delivery,
checkpoint, runtime-object, and result evidence. Process-local execution IDs,
session maps, fibers, promises, and observers are deliberately unavailable.

## Runtime And Provider Convergence Decision

The current Application runtime is already partly shared, but its orchestration
is deliberately split:

- `ApplicationQuerySystem` and `ApplicationMutationSystem` are separate Effect
  services and both execute through `ApplicationExecutionHost.runTransaction`;
- `ApplicationActionSystem` is a separate foreground external-I/O service and
  executes through `ApplicationExecutionHost.runAction`;
- `ApplicationTaskSystem` owns Task selection and run creation; and
- `TaskComputeProvider` plus `TaskWorkerSessionHost` own asynchronous Task
  dispatch, cancellation, accepted-session supervision, and fresh Worker
  execution.

That semantic split remains correct. Query snapshot authority, mutation
journal/OCC authority, foreground action request/outcome authority, and Task
run/attempt authority must not be collapsed into one universal provider or one
union capability bag.

The runtime substrate beneath them must converge. The accepted target is one
Application-owned Worker runtime/materialization composition that shares exact
source and runtime-object loading, Worker definition construction,
`WorkerLoader.load` isolation, host policy, RPC ownership, cleanup, and narrow
callback mechanics. Operation-specific adapters retain distinct contracts:

```text
Application runtime substrate
  -> transaction execution adapter -> QuerySystem / MutationSystem
  -> foreground external adapter   -> ApplicationActionSystem
  -> accepted session adapter       -> TaskComputeProvider
```

`TaskComputeProvider` remains the provider-neutral dispatch/cancellation
contract because Worker Loader, AgentOS, or another approved compute backend
may implement it. Query and mutation are not routed through that asynchronous
contract.

The Task runtime must gain an authenticated, scope-bound context capability
instead of remaining payload-only. Its admitted surface is:

- `ctx.runQuery` through the existing Application query authority;
- `ctx.runMutation` through the existing Application mutation/OCC authority;
- controlled outbound I/O through the existing host-owned policy where the
  Task definition admits it; and
- `ctx.scheduler`/enqueue through Task System creation or scheduling
  capabilities, never raw scheduler tables or a Cloudflare trigger.

Each callback is an independent owned invocation/transaction. The Task Worker
never receives raw Postgres, Drizzle, Task tables, a transaction handle,
provider credentials, or an ambient application service container.

### Durable Task Callback Admission Dependency

The context surface cannot be implemented by handing the foreground Action
callback bundle to a Task Worker. `ctx.runMutation`, outbound I/O, and nested
Task creation/scheduling can survive an attempt retry only when the Task owner
defines their stable operation identity, durable intent ordering, replay, and
uncertain-settlement rules. The compute dispatch identity's
`requestedEffectSequence` identifies the already-persisted dispatch effect; it
is not an available in-attempt syscall counter and must not be repurposed.

F0A therefore orders the context work as follows:

1. add a read-only `ctx.runQuery` callback only after the host can revalidate
   the launch subject's exact Application activation/revision evidence and
   invoke the existing selection-bound query port;
2. preflight each side-effecting capability separately, beginning with the
   mutation/replay boundary in
   [`44-dte06-task-mutation-callback-and-replay.md`](./44-dte06-task-mutation-callback-and-replay.md),
   including stable keys, durable intent, retry/replay, cancellation, and
   lost-response behavior;
3. project only the individually admitted operations into the Worker context;
   and
4. keep every unimplemented member absent rather than routing it through
   `ApplicationActionSystem` or maintaining process-local ordinals.

This dependency does not authorize a new Task table, lifecycle event, effect
kind, manifest generation, or compatibility fallback. Any such contract change
must be recorded and approved at its existing Task or Standard Application
owner before implementation.

The read-only query slice has this exact correlation order:

1. bind one backend-private query capability to the authenticated
   `ApplicationTaskRuntimeLaunchSubject`; never accept a caller-selected scope,
   revision, candidate, or activation;
2. capture and bound the function path and arguments inside the Task Worker
   before crossing RPC;
3. re-read the active Application selection and claim its opaque selection
   basis through the existing activation owner;
4. compare scope, activation sequence, active-head digest, readiness digest,
   revision, candidate, analysis, source root, publication, task catalog,
   runtime-host identity, and compatibility date with the launch creation
   authority/runtime target;
5. invoke the Effect-native, selection-bound query port only after every facet
   matches; its live adapter must reuse the existing Application query
   execution core rather than the foreground Action callback bundle;
6. normalize and bound the result before returning it to user code; and
7. stop query delivery on Task interruption or callback deadline without
   creating a mutation journal, Task lifecycle transition, or requested-effect
   row.

An active-head movement is a typed stale-launch failure for this attempt. It is
not permission to silently execute the old Task against the newly active
revision, nor to fabricate an `ApplicationActiveSelection` from persisted
digest fields. The first implementation remains provider-private and
production-inert.

Durable Tasks are the sole engine for background, queued, delayed, retryable,
and scheduled work. `ApplicationActionSystem` remains only the current
foreground request/response external-I/O contract. It is not a scheduler
target and may not be invoked inside a Task attempt: doing so would create two
durable request/outcome authorities for one execution. If the foreground
action API is later removed, that requires its own consumer inventory,
migration, and Legacy/removal gate.

## Existing Owners That Must Be Reused

| Responsibility | Current owner | DTE06-F disposition |
| --- | --- | --- |
| Task definition, retry, lease, cancellation, and terminal policy | `@flarex/durable-task` | Reuse unchanged through existing decisions and lifecycle stores. |
| Active Application selection and run creation | `ApplicationTaskSystem` | Reuse; no hosted selection fork. |
| Query and mutation callback authority | `ApplicationQuerySystem` and `ApplicationMutationSystem` | Reuse through narrow authenticated Task callback capabilities; no raw database access. |
| Foreground external-I/O invocation | `ApplicationActionSystem` | Retain as a separate foreground contract; never use it as Task or scheduler authority. |
| Connected discovery, claim, recovery, and bounded continuation | backend candidate/connected runner plus persistence repository | Reuse; host supplies resources and budgets only. |
| Application source/runtime/input authentication | task runtime launch authority and Standard Application publication chain | Replace in-memory test readers with existing immutable object/read owners. |
| Worker execution and session ABI | Worker Loader provider and `TaskWorkerSessionHost` | Reuse fresh-load semantics and exact session contracts. |
| Heartbeat, result-before-completion, retry, and cancellation acknowledgement | `TaskAttemptSupervisor` plus lifecycle gateway/result store | Reuse; no host-owned terminal state machine. |
| Control and located database deadlines | persistence PostgreSQL deadline/transaction owners | Reuse with Hyperdrive-compatible resource construction and settlement proof. |
| Runtime/result bodies | existing immutable R2 owners | Use separate owned key spaces or buckets; never store raw bodies in Task System rows. |
| Cloudflare event lifetime | new private DTE06-F host composition | Own Layer acquisition, admission tracking, drain, cleanup, and bounded receipt only. |
| Scheduled wake and deployment | DTE05-E3 | Remains deferred until DTE06-F closes. |
| Public reads, streams, traces, and UI | Roadmap 07 | Excluded. |

Trigger.dev remains the frozen behavior/provenance oracle recorded by the
connected-runtime source map. DTE06-F adds no Trigger runtime package, Prisma,
Redis/Redlock, Organization identity, workload HTTP route, or Trigger compute
manager. If implementation introduces a new orchestration decision rather than
adapting a Flarex platform seam, the source map must be amended before code is
accepted.

## Required Private Host Shape

The host is a private, bounded event capability. Its exact code name is left to
implementation, but its contract must have these semantics:

```text
acquire one host scope
  -> validate deployment/host configuration
  -> acquire control and located database resources
  -> acquire R2 runtime/result resources
  -> construct launch authority, lifecycle gateway, result store,
     supervisor, Worker Loader provider, trusted directory, and runner
  -> run one bounded connected delivery cycle
  -> retain the event scope for every session admitted by that cycle
  -> observe and redact each supervision Exit exactly once
  -> drain/close owned sessions and database resources
  -> return only a bounded operational receipt
```

The receipt may contain counts, bounded reason codes, timings, and whether the
host drained or handed work back to lease recovery. It must not contain task
arguments, results, database values, source bytes, module text, headers, URLs,
tokens, tenant/customer identifiers, or raw errors.

The first host implementation remains callable only from tests or an isolated
probe entrypoint. It is not imported by `apps/backend`, `apps/executor`, or an
existing scheduled handler.

## Resource And Authority Rules

### PostgreSQL And Hyperdrive

- Use the trusted control directory to resolve a concrete scope authority; do
  not substitute tenant/customer identity for `scopeId`.
- Reuse the located scope target and lifecycle/delivery transaction owners.
- Use cache-disabled Hyperdrive for authoritative reads and writes.
- Keep database-owned connection, lock, statement, transaction, rollback,
  release, quarantine, and replacement behavior intact.
- Do not pass a top-level autocommit client where the existing operation
  requires a transaction capability.
- A saturated pool, blocked lock, statement timeout, transaction timeout,
  connection loss, or cleanup failure must preserve its existing typed or
  uncertain disposition; the host must not translate it into task failure.

### R2

- Read exact runtime publication objects through their existing key, length,
  digest, role, and codec validation.
- Publish task results through the existing conditional-create/reconcile
  owner before lifecycle success.
- A lost create response must reconcile exact bytes before success. Unknown
  settlement leaves lifecycle recovery authoritative.
- Do not add deletion or garbage-collection authority. Orphan cleanup remains
  separately gated.

### Worker Loader And Event Lifetime

- Every task execution uses `WorkerLoader.load` and a fresh task Worker.
- The host must retain the provider scope through accepted-session
  supervision. A Cloudflare handler must await that owned program or attach the
  whole scoped program to the event lifetime; attaching only a child Promise is
  insufficient.
- Event cancellation/interruption must propagate through Effect scope release,
  session close, late-RPC disposal, and full-Cause observation.
- A host crash cannot acknowledge cancellation, confirm a result, or complete
  an attempt. Only persisted evidence and the database lifecycle may do so.

## Ordered Implementation

### DTE06-F0: Preflight And Owner Inventory — Complete

- record this exact topology, authority map, terminology correction, and stop
  boundary;
- retain the current Trigger source map and current Flarex owners; and
- prohibit deployment work until the local host contract is proven.

### DTE06-F0A/F0B: Runtime Convergence And Database Acceptance — Complete

The first bounded implementation checkpoint gives
`ApplicationExecutionHost` and `TaskWorkerSessionHost` one backend-private
`ApplicationWorkerRuntime` owner for fresh `WorkerLoader.load` entrypoint
acquisition, exact Worker Loader code projection, and caller-specific typed
failure mapping. The transaction/action host still owns one-shot RPC execution
and the Task host still owns accepted session lifetime, cancellation,
settlement, and close. Runtime-object materialization and authenticated Task
callback mechanics now share those existing owners rather than creating a
second action/runtime system.

The next foundation now adds `ApplicationTaskQueryAuthority`. Its post-launch
composition binds the already-authenticated launch creation authority and
runtime target once, then exposes a session whose query calls accept no launch
identity. Each call re-reads and claims the opaque active Application selection,
rejects any activation/head/readiness/revision/candidate/catalog/runtime-policy
drift, and only then delegates through a read-only Effect-native selection query
port. It does not import the backend Task launch authority, accept per-callback
caller-selected identity, or reuse the foreground Action callback bundle.

The live selection-query adapter now extracts and reuses the existing
Application query snapshot, source-reading, request-construction, and
transaction-Worker execution core. The public `ApplicationQuerySystem`
delegates through the same adapter after resolving its active selection. The
adapter accepts one issuer-owned opaque selection and exposes only
`runTransaction`; it has no activation-choice, mutation, or foreground Action
capability. The Task authority owns the per-call Scope and requires an exact
authenticated user execution identity from the trusted post-launch
composition; neither the Task authority nor the selection adapter may accept
or invent an anonymous default. A scheduled or system Task principal requires
its own separately approved identity contract rather than reuse of anonymous
request identity.

New Application Task creation now uses a scope-local issuer to publish an exact
authenticated-user principal object and persist its reference. Compute
preparation carries that stored reference, and launch verifies and reconstructs
the owned user identity under approved Preflight 43. The Application Task
Worker now receives a separate query-only RPC target and invokes current task
handlers as `task(ctx, payload)`. `ctx.runQuery` uses a bounded exact envelope,
host-allocated call identity and deadline, per-call selection revalidation,
session interruption, and late-result disposal. Genuine Worker connected proof
reaches the existing selection-bound query core with the launch-bound user
identity. Mutation now follows the separately approved Preflight 44 boundary.
It does not create another mutation engine: it extends the already-admitted
`durable_task_attempt` branch
of the shared external-effect evidence contract and routes the callback through
the existing `ApplicationMutationSystem`. The stable Application mutation
request key is run-and-ordinal scoped across attempts, while exact callee,
arguments, runtime target, and principal remain committed conflict evidence.
Outbound and scheduling operations remain later, separate gates.

- inventory the exact shared and distinct mechanics in
  `ApplicationExecutionHost`, `TaskWorkerSessionHost`, Worker definition
  builders, callback bridges, and runtime-object readers;
- define one internal Application runtime-substrate boundary with separate
  transaction, foreground external, and accepted-session operations rather
  than a universal `ComputeProvider` union;
- add the Task context capability for authenticated `runQuery`, `runMutation`,
  controlled outbound I/O, and Task scheduling/enqueue where individually
  admitted;
- preserve `TaskComputeProvider` as the provider-neutral asynchronous adapter;
- prove a Task cannot receive mutation journal authority through `runQuery`,
  cannot receive raw database/Task/provider capabilities, and cannot invoke
  `ApplicationActionSystem` as a nested lifecycle; and
- keep every capability absent unless its exact Task definition/runtime policy
  admits it.

F0A began with this bounded owner/contract preflight over the existing code.
Its implementation extracted only mechanics proven identical. It did not
change query snapshot semantics, mutation OCC/commit semantics, action
settlement semantics, or Task lifecycle decisions merely to make the runtime
surface uniform.

F0B then proved the connected Application Task path against both PGlite and an
ordinary-role genuine PostgreSQL 18 instance while retaining genuine Worker
execution. The dedicated persistence acceptance matrix passed 2/2, the
connected PostgreSQL matrix passed 14/14, and the corresponding PGlite matrices
passed 9/9 and 13/13. Those receipts do not activate production hosting.

### DTE06-F1: Production-Compatible Private Host — Complete

- depend on the completed F0A runtime and Task-context boundary;
- add one backend-private host composition around the current
  `ApplicationTaskComputeDelivery` Layer;
- add an event-local admission/drain observer that accounts for every accepted
  session without becoming lifecycle authority;
- replace the E5 harness's memory runtime/result resources with the existing
  immutable object-store adapters behind injected ports;
- compose PGlite first, then ordinary-role genuine PostgreSQL with the same
  control/located resource boundaries; and
- prove configuration capture, receiver ownership, interruption, full-Cause
  observation, scope release, and zero production imports.

The first F1 checkpoint is deliberately smaller than the full hosted-resource
matrix but substantial enough to establish the event-lifetime invariant. It
adds one backend-private, test-only host around a freshly constructed
`ApplicationTaskComputeDelivery` Layer. One host invocation runs exactly one
connected delivery cycle. The supervised provider emits a distinct admission
signal only after a new accepted session is retained and its supervisor is
installed; the host never infers admission from connected-runner outcome
counters. After the runner exits, a private provider control stops new
admissions and waits for every in-flight start to be classified before the host
seals the exact admission count. The Layer scope remains open until every
admitted session has one observed supervisor `Exit` or the single bounded
quiescence-and-drain deadline expires. The observer and control are accounting
evidence only; they cannot decide lifecycle, settlement, retry, cancellation,
or completion.

The host's redacted receipt may retain only an explicit projection of bounded
connected-runner counters and aggregate expected/observed/succeeded/failed
supervision counts. The encoded continuation is handed back separately as
private resume control state and is not part of that receipt. The receipt must
not retain or return dispatch identity, tenant/scope identity, arguments,
results, source, acceptance objects, raw failures, or raw `Cause`. Invalid host
policy, observer/count disagreement, and drain expiry are typed host failures.
A non-interrupted runner failure still quiesces and drains, then re-emits its
original full `Cause`; if that drain itself fails, the host drain failure takes
precedence because event-lifetime safety was not proved. External interruption
remains interruption, closes the event scope immediately, and is never
flattened into an ordinary host error. Application directory, launch, provider,
and runner policy records are snapped at host construction while capability
receiver ownership is retained.

The second F1 checkpoint composes immutable launch resources without creating a
parallel loader or changing Task lifecycle authority. It adds the previously
missing concrete Task-input object-store adapter over the existing shared
immutable-R2 byte-store mechanics. Publication canonicalizes the Flarex value,
enforces the durable input-reference byte budget, conditionally creates the
content-addressed object, and preserves lost-response reconciliation and
uncertain settlement. Reads validate the exact durable reference before I/O,
then verify object key, byte length, digest, and canonical Flarex value while
returning owned bytes.

One backend-private resource directory now adapts located database evidence,
legacy runtime objects, Task input, Application source artifacts, and execution
principals into the existing `TaskRuntimeLaunchAuthority` directory. It owns no
cache, lifecycle decision, object-key derivation, or fallback. Missing,
corrupt, and resource failures remain distinct at each launch port, including
the corrected missing-source classification. Malformed located host resources
are a non-retryable configuration failure rather than a retryable resource
outage, and source-reader internal invariants are not mislabeled as corrupt
application content. The Application resource event
host constructs that directory and delegates to the same event-lifetime host;
it does not create another event or session owner. Immutable task-result
publication remains the existing `TaskAttemptSupervisor` dependency and needs
no second host wrapper.

Focused memory and genuine Miniflare R2 tests prove conditional no-replace
publication, lost-create reconciliation, unresolved settlement, hostile
reference rejection before I/O, cold and repeated reads with fresh owned byte
arrays, receiver ownership, absence/corruption/resource separation, and no
adapter-local cache. Existing launch-authority, event-lifetime,
runtime-object, principal, and result-store suites remain green.

Those first two checkpoints did not complete F1 because no real database and
Worker execution had yet entered through the composed event/resource host.

The third F1 checkpoint adds the first private hosted PGlite vertical without
duplicating the E5 semantic harness. One dedicated success lane reuses the real
PGlite run/lifecycle repositories and genuine Miniflare Worker Loader execution,
but enters through `ApplicationTaskDeliveryResourceEventHost` instead of
resolving the connected runner directly. Four distinct Miniflare R2 bindings
back Task input, execution principals, legacy runtime objects, and Task results.
The exact input reference is published before run creation, principal issue and
read use the principal binding, successful settlement publishes and reads the
result binding, and the Application generation proves zero legacy
runtime-object reads. The event host observes one admission and one successful
supervisor exit before closing its Layer scope, and its bounded receipt contains
neither input data nor run/scope identity.

This PGlite vertical deliberately retains the fixture-owned
`ApplicationAnalysisSourceReader`; it does not claim that the fixture's
historical synthetic source root was republished as a finalized Source Artifact
V2 R2 graph. That separate source-publication topology must not be invented in
the Task host. Existing Source Artifact R2 readers remain the production adapter
accepted by the resource directory when a real finalized artifact is supplied.
The unchanged E5 PGlite suite remains green across all thirteen success,
callback, failure, timeout, cancellation, stale-fence, lease-loss, uncertain
publication, lost-response, duplicate-delivery, and race scenarios.

The fourth F1 checkpoint reuses that exact hosted success topology with the
ordinary-role genuine-PostgreSQL lane. The test does not introduce a second
host or PostgreSQL-specific orchestration path: the lane supplies the existing
split control/located persistence resources to the same lane-agnostic hosted
harness, and the same Miniflare R2 resource directory, genuine Worker Loader,
event-lifetime admission/drain accounting, result publication, and redacted
receipt remain in force. The active persistence connection now verifies
PostgreSQL major version 18 and rejects a role with superuser, database-creation,
or role-creation privileges before each scenario. The full PostgreSQL file
passed 15/15 under that ordinary database-owner role: the acceptance-environment
guard, all thirteen existing connected lifecycle/callback/failure/race
scenarios, and the hosted event-path scenario. The dedicated hosted PGlite test
remains green 1/1.

This proves the private host composition can cross a real local PostgreSQL 18
transaction/connection boundary without changing its runtime or resource
owners. It does not prove Hyperdrive, deployed Cloudflare event lifetime, real
R2, or crash recovery. Those claims remain with F2 through F4.

F1 must not add a Worker entrypoint, Wrangler binding, route, Queue, Cron, or
external resource.

### DTE06-F2: Fresh-Host Recovery And Takeover — Pending

- start host A, admit one exact dispatch, and stop A after an explicitly chosen
  persistence/Worker boundary;
- construct host B from scratch with no shared process state;
- prove no replay occurs while current persisted authority says the dispatch
  or attempt is still live;
- advance only through the existing database-clock lease/recovery lifecycle,
  then prove the newly granted attempt/fence can execute;
- reject a late heartbeat, cancellation receipt, result commitment, or
  completion from host A as stale/current without mutating the winner; and
- prove duplicate delivery, lost provider receipt, lost result response, and
  lost completion response retain their existing exact decisions.

If the existing lifecycle/repair owners cannot produce the required
post-expiry transition, record that blocker at their owner and stop. Do not add
host-local retry, a second lease, or a synthetic completion.

### DTE06-F3: Isolated Cloudflare/Hyperdrive/R2 Probe — Separately Gated

After F1 and F2 pass locally:

- add an isolated probe topology with names and resources that cannot collide
  with production Flarex applications;
- use one private task-runtime probe Worker with Worker Loader, isolated R2,
  and cache-disabled Hyperdrive bindings;
- if remote invocation is required, use a separate bearer-protected probe
  gateway rather than exposing the runtime Worker directly;
- default every deployment command to dry-run and require explicit account,
  resource-absence, credential, cost, and teardown approval before mutation;
- use a dedicated PostgreSQL schema/role and isolated R2 key space or bucket;
  and
- remove Workers, service bindings, Hyperdrive configuration, R2 data,
  database schema/role, secrets, and local recovery material after evidence is
  captured.

The existing `apps/runtime-topology-probe` records are patterns for isolated
resource naming, bearer protection, Hyperdrive proof, and teardown. DTE06-F
must not silently append to or revive their completed experiments, and those
experiments are not evidence that the Task System topology works.

### DTE06-F4: Hosted Scenario Matrix And Close — Pending

The same isolated topology must prove, as applicable:

1. cold object path plus fresh Worker success;
2. repeat object path plus a still-fresh Worker;
3. typed handler failure and existing retry policy;
4. exact cancellation delivery and acknowledgement;
5. completion winning a cancellation race;
6. duplicate wake and provider replay suppression;
7. lost/uncertain R2 create response behavior;
8. lost PostgreSQL completion response replay;
9. fresh-host restart/takeover with stale old-host evidence rejected;
10. bounded database, Worker RPC, event, and cleanup settlement; and
11. complete isolated-resource teardown and absence proof.

DTE06-F closes only when local, genuine-PostgreSQL, Miniflare/Workerd, and real
Cloudflare evidence agree on the claims each platform owns. A local mock does
not prove Hyperdrive or deployed Worker Loader behavior; a hosted smoke test
does not replace deterministic lifecycle/race coverage.

## Required Failure And Race Matrix

| Scenario | Required durable outcome |
| --- | --- |
| Provider acceptance only | Attempt remains non-terminal; no result reference exists. |
| Host dies before provider call | Delivery claim expires/retries through existing repository policy; no execution is invented. |
| Host dies after call but before receipt | Existing uncertain-replay probe decides moved/unchanged/uncertain; host does not guess. |
| Host dies after acceptance | Lease and persisted delivery evidence remain authoritative; process memory is irrelevant. |
| Heartbeat loses fence or lease | Session closes; no completion/result is confirmed. |
| Result create response is lost | Exact read-back may reconcile; otherwise lifecycle remains unchanged. |
| Completion response is lost | Same owned completion replays to idempotent lifecycle receipt. |
| Cancellation wins | Exact generation acknowledgement reaches terminal cancellation. |
| Completion wins | Success/failure is submitted unchanged and cancellation becomes `superseded_by_completion`. |
| Old host responds after takeover | Stale attempt/fence/lease evidence is rejected with no winner mutation. |
| Event is interrupted during cleanup | Full Cause is observed; owned resources settle or are quarantined within policy. |

## Validation Gates

| Claim | Minimum proof |
| --- | --- |
| Host configuration and scope lifetime | deterministic Effect tests, hostile configuration capture, interruption/finalizer tests, exact admitted-session drain accounting |
| Runtime convergence | operation-specific type/capability tests prove shared mechanics without a universal authority union |
| Task context | real Task Worker tests call authenticated query and mutation callbacks, reject unavailable members, and expose no raw database/provider/Task authority |
| Background ownership | scheduler/enqueue tests create Task System work directly and prove no nested `ApplicationActionSystem` lifecycle |
| No new authority | import/bundle boundary checks and static review showing lifecycle, delivery, result, and object owners are reused |
| Local end-to-end semantics | PGlite plus genuine Miniflare/Workerd using real current Worker definitions |
| PostgreSQL behavior | ordinary-role genuine PostgreSQL tests for locks, timeouts, rollback/reuse, uncertain settlement, two-host exclusion, and takeover |
| R2 behavior | Miniflare R2 fast lane plus isolated real R2 create/reconcile/corruption evidence |
| Hyperdrive behavior | isolated real Cloudflare cache-disabled Hyperdrive probe; local `pg` is insufficient |
| Fresh execution | Worker Loader evidence proves `load`, distinct session/execution identity, and no task Worker cache fallback |
| Crash/restart | host B is a newly constructed scope/process with no references to host A; only persisted evidence is supplied |
| Privacy | bounded receipts and logs contain no raw arguments, results, source, database values, tokens, headers, URLs, tenant/customer IDs, or unredacted causes |
| Teardown | independent absence checks for Worker, binding, Hyperdrive, R2, database, secret, and local state resources |
| Reuse/provenance | connected-runtime source map remains exact or is amended before any new orchestration decision |

## Explicit Non-Goals

DTE06-F does not authorize:

- a production scheduled handler, Queue consumer, Cron Trigger, HTTP route, or
  public task invocation API;
- observability query APIs, subscriptions, task-output streams, trace/log
  ingestion, dashboard reuse, or Trigger frontend integration;
- direct import of Trigger runtime packages, Prisma, Redis/Redlock, Trigger
  Organization/Project/Environment identity, or Trigger workload HTTP;
- one universal query/mutation/action/task provider or ambient capability bag;
- routing query or mutation execution through `TaskComputeProvider`;
- invoking `ApplicationActionSystem` inside a Task attempt or scheduling a
  direct action as though it were a Task definition;
- warm reuse of a task Worker or fallback to Legacy execution;
- changes to lifecycle decisions, retry policy, delivery schema, checkpoint
  authority, OCC, commit/journal/outbox/feed owners, or Application-row
  semantics;
- storing raw task input/result/source bytes in Postgres lifecycle rows;
- result/object deletion or retention policy; or
- production credentials/resources merely because dry-run and local gates pass.

## Stop Boundary And Next Gate

The DTE06-F1 event-lifetime host, immutable launch-resource composition, hosted
PGlite vertical, and ordinary-role genuine-PostgreSQL counterpart described
above are complete privately. F0A/F0B remain complete. The next active
checkpoint is DTE06-F2 fresh-host recovery: construct a new host scope with no
shared process state and prove takeover only through existing persisted
lifecycle and delivery authority. The backend-private host, bounded redacted
receipt, lifecycle owners, and every production entrypoint remain unchanged.
F3/F4 require separate approval before any external mutation.

After DTE06-F closes, DTE05-E3 may separately preflight a real scheduled event
host and Wrangler Cron binding. DTE06-G then owns final provenance, package,
platform, privacy, teardown, and admission review. Roadmap 07 may continue its
private read-model design, but public observability APIs or UI remain outside
this gate.
