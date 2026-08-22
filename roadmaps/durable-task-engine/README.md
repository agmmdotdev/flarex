# Flarex Durable Task Engine Roadmaps

## Status And Scope

**Status:** Vision authority. DTE01 source reuse/package admission, DTE02 task
identity/scope admission, and Roadmap 03 lifecycle admission are complete.
DTE03-A's
Trigger-to-Flarex lifecycle inventory, DTE03-B's exact five-phase aggregate,
DTE03-C's failure/retry/attempt policy, and DTE03-D's cancellation, heartbeat,
lease, completion, and race tables, and DTE03-E's closed outcome, inspection,
acceptance, evidence, effect, and error contract are complete. DTE03-F's 65
canonical lifecycle vectors, 37 exact named divergences, and executable
contract gate are also complete. DTE03-G chose **admit**, and DTE-IP01 now
implements the private production-inert `@flarex/durable-task` package with its
closed schemas, pure decisions, service/Layer boundary, provenance map, and
deterministic compatibility suite. Roadmap 04 is **complete: admit** through
DTE04-F: the five-table schema/migration, scope-bound Drizzle lifecycle,
creation, due-discovery, and requested-effect read capabilities now exist with
connected PGlite and real-Postgres proofs, a complete canonical compatibility
lane, and final provenance, package, bundle, migration, and boundedness gates.
Of 65 canonical vectors, all remain
covered by the pure oracle: 62 transition-derived histories plus one explicit
near-overflow setup execute through the adapter, and two invalid commands remain
at the decoder boundary. No canonical vector is deferred. DTE04-C now adds a
scope-bound, production-inert run-creation capability with immutable Standard
task binding/authority checks, the sole legal initial aggregate, atomic
idempotent replay/conflict handling, captured lazy-operation configuration,
canonical stored-authority correlation, terminal identity exhaustion, and
connected PGlite concurrency and lifecycle-interoperation proof. DTE04-D adds
production-inert due-discovery and requested-effect-ledger reads with stable
bounded snapshots, and DTE04-E proves their real-Postgres parity together with
the creation and lifecycle race/uncertainty matrix. Roadmap 05 is now active:
DTE05-A admits a scope-bound host-neutral scheduling boundary, DTE05-B
completes the production-inert standard runner plus deterministic in-memory
adapters, DTE05-C1 completes only the located-scope Postgres composition, and
DTE05-C2 completes the production-inert trusted partition directory.
DTE05-D completes the private, unwired Queue wake-hint adapter and fresh
partition resolver. DTE05-E1 adds a private host-neutral repair sweep and
repair-tolerant trusted directory. DTE05-E2A completes its canonical
continuation evidence and distinct Task-owned scheduler row, and DTE05-E2B
completes the private fenced claim/checkpoint transaction protocol. The E2C1
connected runner now proves canonical static restart in PGlite plus
duplicate-host exclusion and expiry takeover in PGlite and genuine PostgreSQL.
The E1 continuation correction proves exact directory high-water restart by
persisting a correlated continuing cursor or exact exhausted high-water marker
after an active candidate and freshly re-resolving that exact candidate before
resuming its inner due cursor.
E2C2 now completes DTE05-E2 with a production-inert, dedicated-pool PostgreSQL
deadline policy, database-owned lock/statement/whole-transaction limits,
checked-out-client termination evidence and quarantine, and genuine
PostgreSQL 18 proof. Its exact contract is recorded in
[`preflight/32-dte05-postgres-deadline-policy.md`](./preflight/32-dte05-postgres-deadline-policy.md).
DTE06-A records the ComputeProvider/runtime foundation, and DTE06-B now
completes the private production-inert provider-neutral Effect contract,
strict dispatch/cancellation codecs and receipt correlation, plus the
deterministic in-memory conformance adapter. DTE06-C0 completes the docs-only
operation-specific delivery schema, prepared-execution, fenced-transaction,
uncertainty, and bounded-discovery preflight. DTE06-C1 now completes the
canonical dispatch/cancellation evidence boundary and its two Task-owned
Postgres checkpoint tables. The approved C1 prepared-subject correction now
hands C2 an owned runtime-binding commitment reconstructed from the canonical
definition bytes; the later runtime owner remains responsible for loading the
full manifest and verifying that commitment. DTE06-C2 now completes the private
production-inert scope-bound fenced repository with focused PGlite and
ordinary-role genuine-PostgreSQL transaction proofs. The approved bounded C2
correction now durably rejects an older provider-stale cancellation generation
as `provider_stale_generation`, without a receipt or Task cancellation
acknowledgement, and proves the outcome in PGlite and genuine PostgreSQL.
DTE06-C3 is complete and production-inert. Its candidate persistence-discovery
implementation now proves the strict V1 cursor, operation-specific semantics,
database-owned deadlines, and PGlite plus ordinary-role genuine-PostgreSQL
behavior. Its accepted pending-membership amendment now atomically projects
compute requested effects, consumes membership with C2 checkpoint creation,
backfills legacy unmaterialized effects, and proves bounded discovery over
large checkpointed history with `EXPLAIN ANALYZE (BUFFERS)`. Provider
composition now exists through the private single-candidate operation and
deterministic bounded multi-scope runner core. Its private deadline-owned
control-directory adapter now proves stable PGlite pagination and genuine-
PostgreSQL server timeout, settled rollback, and safe pool reuse. The connected
PGlite system test now composes the existing lifecycle, control directory, C3
discovery, C2 repository, backend runners, and deterministic provider. It
proves two-host live-claim exclusion, fresh-runner exact-scope resume, dispatch
acceptance, lifecycle-owned cancellation delivery, fair progress across two
real scope databases, and conservative charged-versus-confirmed accounting
when an accepted dispatch receipt is lost. The ordinary-role genuine-
PostgreSQL 18 lane proves the equivalent two-scope connected transaction path,
exact resume, alternating delivery, and stored settlement; that C3 lane
deliberately composes no Worker host. The
mandatory connected-runtime reuse audit in
[`preflight/37-dte06-connected-runtime-reuse-audit.md`](./preflight/37-dte06-connected-runtime-reuse-audit.md)
maps the exact Trigger dispatch, supervision, heartbeat, cancellation,
settlement, and recovery sources and admits one connected vertical. Its first
approved implementation checkpoint now supplies the trusted directory,
Trigger-derived recovery decision, and single-candidate provider operations.
The canonical active-scope continuation is now implemented with strict
canonical evidence, exact directory/operation correlation, and restart-stable
per-operation fairness charges. The deterministic bounded runner core and its
connected PGlite transaction/provider proof across two real scopes are now
implemented, including a persistence-backed lost-receipt case and ordinary-role
genuine-PostgreSQL 18 parity. The connected C3 persistence gate and final
unknown-delivery recovery subgate are complete and production-inert. The
recovery path reuses Trigger's mapped moved/unchanged/probe-uncertain decision
over a Flarex-owned exact fenced persistence probe. Fresh-runner PGlite and
ordinary-role PostgreSQL 18 tests prove dispatch and cancellation replay the
same stored provider request after post-start uncertainty without minting a
second identity. DTE06-D is now complete through its private Worker Loader
provider adapter. The Standard Application task-runtime publication sequence
closed the earlier D1 stop: canonical role contracts, immutable object
publication, database receipt and membership, readiness and activation
correlation, exact located runtime/input reads, the private Worker ABI/runtime
core, exhaustive Legacy and Application launch authority, generation-specific
Worker definitions, the shared accepted-start session, and the real
`WorkerLoaderTaskComputeProvider` now exist. The provider remains
provider-neutral and returns only after the exact Worker accepts the correlated
execution identity. Provider acceptance alone is not Task lifecycle
completion. The current E5 connected slices now supervise the Application
composition after that acceptance boundary and prove durable success,
task-failure retry, exact cancellation acknowledgement, maximum-duration
terminal timeout, authoritative stale-fence/lease-loss stops, and both
reconciled and unresolved R2 publication outcomes; retained compositions remain
separately gated.
The current private `ApplicationTaskSystem` now owns active Application task
selection and exact run creation/replay, while
`ApplicationTaskComputeDelivery` is the only composition that admits
Application compute discovery together with the real Worker Loader provider.
Its connected PGlite private proof now holds settlement after one fresh
Application Worker start, proves acceptance alone is non-terminal, then reaches
immutable result publication plus fenced terminal completion, a real handler
failure plus the existing durable retry policy, exact durable cancellation
delivery and acknowledgement, exact maximum-duration interruption followed by
terminal timeout policy, or stale-fence/database-time lease-loss closure with
no lifecycle mutation. A lost R2 create response is verified before durable
success, while unresolved publication leaves the lifecycle unchanged. A lost
completion response replays the same owned completion to an idempotent
lifecycle receipt without a second result publication. The six nonsuccess
paths publish no confirmed result, a duplicate connected wake makes no second
provider call, a completion-first cancellation race records
`superseded_by_completion`, and all eleven paths read zero
Legacy runtime objects. The same harness remains the
genuine-PostgreSQL E5 gate. Retained compositions remain explicitly
`legacy_only`; no fallback,
comparison provider, second scheduler, public caller, route, binding, or
production activation was added. The ordered DTE06-D boundary remains recorded in
[`preflight/38-dte06-worker-loader-task-adapter.md`](./preflight/38-dte06-worker-loader-task-adapter.md),
and the publication chain remains recorded in
[`preflight/39-standard-application-task-runtime-publication.md`](./preflight/39-standard-application-task-runtime-publication.md)
and
[`preflight/40-standard-application-task-runtime-persistence.md`](./preflight/40-standard-application-task-runtime-persistence.md).
The approved DTE06-E supervision and settlement boundary is recorded in
[`preflight/41-dte06-attempt-supervision-and-settlement.md`](./preflight/41-dte06-attempt-supervision-and-settlement.md).
The approved DTE06-F hosted-runtime proof, event-scope ownership, fresh-host
recovery order, and separately gated Cloudflare topology are recorded in
[`preflight/42-dte06-hosted-runtime-proof.md`](./preflight/42-dte06-hosted-runtime-proof.md).
E1 through E5 are complete privately. The current
session preserves exact terminal
values, typed failures, and interruption provenance, and the pure mapper cannot
claim durable success before result publication. The backend-private Task
result store now canonicalizes and bounds successful values, publishes them
through the shared immutable R2 core, and returns the exact durable-task-owned
commitment. The private scope-bound lifecycle gateway now reuses the exact
Legacy/Application stores and decisions for inspect, heartbeat, and completion
without adding a lifecycle or runtime call inside a transaction. The isolated
backend-private supervisor now owns bounded heartbeats, result-before-completion
ordering, deadline-bounded identical completion replay, exact cancellation
acknowledgement, observed supervision exits, and structured session close while
preserving interruption. Terminal Worker evidence stops heartbeat renewal
before result or completion I/O. The current E5 slices now bind the real
scope-aware gateway and result store into the sole private Application delivery
composition and prove connected success, no false durability, real Worker
`handler_failed` evidence flowing through failed completion into
`retry_scheduled`, and exact generation-correlated cancellation flowing through
the live Worker session into `terminal_cancelled`, plus exact
`maximum_duration` evidence flowing through `maximum_duration_exceeded` into
`terminal_failed`. Stale-fence and database-time lease-loss receipts also close
the Worker without lifecycle mutation or result publication. Exact R2
reconciliation proceeds to success; unresolved R2 settlement preserves the
typed cause and leaves lifecycle recovery authoritative. A completion whose
committed response is lost is replayed byte-for-byte to the existing idempotent
lifecycle contract without republishing its result. A duplicate connected wake
is suppressed by the persisted dispatch checkpoint while the accepted Worker
remains live. A Worker success held at the supervisor boundary while durable
cancellation is requested is submitted unchanged, and the existing lifecycle
records that cancellation as `superseded_by_completion`. The DTE06-F preflight
is approved; F0A runtime/provider convergence and F0B authenticated Task
query/mutation plus PostgreSQL settlement are complete privately. F1's
production-compatible private host is also complete through hosted PGlite and
ordinary-role PostgreSQL. F2 fresh-host recovery and takeover is blocked on
the separately approved DTE05-C3 Application scheduling-parity correction.
The full discovery, continuation, budget, and original stop boundary are
recorded in
[`preflight/36-dte06-connected-mock-delivery.md`](./preflight/36-dte06-connected-mock-delivery.md).
The exact Worker
Loader reuse boundary, operation-specific delivery ownership, and
in-memory-before-Cloudflare adapter order remain fixed. Their contract and receipt are recorded in
[`06-compute-provider-and-runtime.md`](./06-compute-provider-and-runtime.md) and
[`preflight/33-dte06-compute-provider-and-runtime-contract.md`](./preflight/33-dte06-compute-provider-and-runtime-contract.md),
with the C0 decision in
[`preflight/34-dte06-durable-compute-delivery.md`](./preflight/34-dte06-durable-compute-delivery.md)
and the C2 contract and receipt in
[`preflight/35-dte06-scope-bound-fenced-repository.md`](./preflight/35-dte06-scope-bound-fenced-repository.md).
The real provider is wired only inside the private Application compute
composition and its system-test/AA-R7 proof. Cloudflare task deployment
bindings, a scheduled Worker host, public APIs, production Worker settlement,
production compute delivery, and production activation do not exist yet.

This folder will own the focused execution roadmaps for a Flarex-native durable
task engine derived from the pinned Trigger.dev compatibility source. For now,
this README records the shared vision, non-negotiable boundaries, target system
shape, and proposed roadmap decomposition. Its current implementation authority
has completed the admitted DTE-IP01 private package checkpoint and Roadmap 04
described above. Roadmap 05 authorizes only its explicitly completed or active
production-inert checkpoints; it does not authorize delivery, public APIs,
deployment bindings, compute execution, or production activation.
That checkpoint includes fail-closed legal-state decoding, owned frozen
aggregate snapshots, and an executable compatibility harness whose inputs do
not derive from its expected receipts.

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

- stable task definitions, metadata/manifests, resource catalogs, duplicate-ID
  detection, handler lookup, retry/duration policy, and task execution hooks;
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

`@flarex/durable-task` now implements the admitted private run-attempt
lifecycle, and `@flarex/persistence-postgres` owns its scope-bound lifecycle,
run-creation, discovery, delivery-checkpoint, and repair adapters. The private
Application Task composition connects active selection, run creation, shared
lifecycle, compute discovery, trusted launch resolution, Worker Loader start
acceptance, and the E4 supervisor. The current E5 checkpoint proves real
Application delivery through bounded heartbeat, result publication, lifecycle
completion, cancellation, maximum-duration settlement, and authoritative
stale-fence/lease-loss shutdown. R2 lost-response reconciliation and unresolved
publication recovery handoff are also proven, as is exact completion replay
after a committed PostgreSQL response is lost. Duplicate connected delivery is
also suppressed before another provider call. The cancel/complete race is
proven in both directions by exact cancellation acknowledgement when
cancellation wins and `superseded_by_completion` when Worker success wins.
No imported Trigger package or private Task composition is production-routed.

The admitted run-attempt source map contains 29 explicit decisions: 13
seam-adapted entries, 12 adapter-translated entries, and four discarded entries;
it contains no unchanged source entry. This is substantial reuse of Trigger
control flow, algorithms, invariants, and tests, but it is not direct package or
file reuse. Roadmap 05 is likewise a Flarex-authored scheduling seam that
preserves selected Trigger behavior, while the Drizzle/Postgres, trusted-scope,
Cloudflare, and compute-delivery infrastructure is Flarex-owned adapter code.
Completed foundation work therefore must not be described as Trigger product
parity or as a completed Trigger integration.

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

An admitted source map authorizes only its named capability closure. A later
scheduler, delivery, runtime, supervision, observability, or SDK capability
must start again from its concrete Trigger sources and tests. Reusing an
existing Flarex abstraction, or independently reproducing the same observable
behavior, is not by itself evidence that Trigger source was reused.

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

### 4. Tasks Are First-Class Definitions, Not Action Aliases

The durable task contract is derived from Trigger.dev's stable task ID,
metadata, manifest, handler, retry, duration, queue, and catalog semantics. It
will enter the private Standard Application chain as a canonical task catalog
beside the existing function catalog.

The displaced Flarex `action` and `internalAction` prototypes do not own task
semantics. The current private unversioned `ApplicationActionSystem` is now a
real Application action owner with durable request/outcome and external-effect
uncertainty, but it remains separate from the Task System and does not own task
identity, task metadata, task context, artifact grouping, retry, scheduling, or
run/attempt lifecycle.
`TaskIdV1`, not function path, is the logical task identity across application
revisions.

Durable Tasks are the sole engine for background, queued, delayed, retryable,
and scheduled work. The current direct `ApplicationActionSystem` remains only
a foreground request/response external-I/O contract. It is not a scheduler
target and must not be nested inside a Task attempt. A later action-removal
decision requires its own consumer inventory and migration gate; until then,
foreground Action and background Task are distinct public semantics over a
converging runtime substrate.

### 5. Task State Lives Behind A Private FlarexDB Task System API

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

### 6. Durable Truth Is Reconstructable

The authoritative database clock, monotonic attempt fence, lease, cancellation
generation, run version, idempotency identity, and terminal outcome must be
durable. Every Worker invocation must reconstruct authority from stored state.

Cloudflare Queues, Durable Object alarms, cron triggers, notifications, and
process-local timers may reduce latency, but delivery is not authoritative.
Missed and duplicated wakeups must recover through bounded durable discovery
and fenced claims.

### 7. Execution Reuses Existing Flarex Runtime Owners

The task engine schedules and supervises task attempts; it does not create a
second user-code runtime. Attempts bind to immutable Flarex application
revisions and runtime artifacts and execute through a Flarex-owned
`ComputeProvider`, using the existing Worker Loader/runtime boundary or another
approved provider such as AgentOS.

User code receives the same restricted execution and database capabilities as
other Flarex runtime paths. It never receives task tables, Postgres, Drizzle,
Cloudflare infrastructure authority, or compute-provider credentials.

The compute substrate may share R2 materialization, sandbox, outbound I/O,
query/mutation callback, and resource-control mechanics with the independently
invokable edge-action runtime. That reuse does not make a task an action alias:
the task keeps its stable task ID, `durable_task` target/profile, task context,
run/attempt authority, and eventual-result semantics, while a direct edge action
keeps its function identity and request/response contract.

The shared substrate is not one universal query/mutation/action/task provider.
`ApplicationQuerySystem`, `ApplicationMutationSystem`,
`ApplicationActionSystem`, and `TaskComputeProvider` retain operation-specific
authority. DTE06-F0A instead converges their exact Worker Loader,
materialization, host-policy, RPC, cleanup, and callback mechanics. The Task
runtime then receives only an authenticated context capability whose admitted
members route `runQuery` and `runMutation` through the existing Application
systems and route scheduler/enqueue operations through Task System creation;
it never receives ambient services, raw database authority, or a nested Action
lifecycle.

Sequenced `flarex.task-requested-effect.v1` values are task-orchestration
instructions such as dispatch, wakeup, cancellation, event publication, and
notification. They are not evidence that an arbitrary user HTTP/payment/email
effect was dispatched. A separately admitted external-effect evidence owner may
be reused by both execution adapters, but it must not gain task scheduling,
lease, retry, cancellation, or terminal-transition authority.

The exact shared-subject and no-duplication receipt is
[`../47-aav-a1-direct-action-and-shared-effect-authority.md`](../47-aav-a1-direct-action-and-shared-effect-authority.md).
Its first implementation admits only the direct-action parent; task host
integration remains separately gated by
[`preflight/44-dte06-task-mutation-callback-and-replay.md`](./preflight/44-dte06-task-mutation-callback-and-replay.md).
That gate reuses the same external-effect table and the existing
`ApplicationMutationSystem`; it does not add child mutation to the Task
lifecycle requested-effect union.

### 8. Observability Has Separate State, Trace, And Stream Lanes

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
        -> canonical Standard Application task definitions
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
`flarex` package exposes a task API. A future Trigger-style
`task({ id, run, ... })` producer must lower into that canonical private model.

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

The map must identify the actual retained implementation unit or control-flow
segment, not merely a related upstream file or a list of similar behaviors. A
Flarex-authored implementation may still be the correct adapter, authority, or
host boundary, but it must be classified honestly and must not consume the
source-reuse credit of a different capability.

Where practical, a test-only compatibility runner should execute one normalized
scenario against the frozen Trigger implementation and the transformed Flarex
implementation, then compare transition receipts. This comparison must remain
outside production and must not become dual writes, shadow task execution, or a
runtime fallback.

## First Bounded Product Proof

The first proof remains deliberately smaller than Trigger parity:

1. define and analyze one first-class private Flarex task manifest with a
   stable task ID;
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

This connected proof is now the progress gate. After the mandatory Roadmap 06
reuse audit, do not add another generalized task foundation merely because it
may be useful later. The next executable work must close the shortest private
path from durable requested effect through provider delivery, the reused Flarex
runtime, heartbeat or cancellation, and fenced terminal settlement.

## Roadmap Decomposition

The first four focused roadmaps are complete. Roadmap 03's source inventory,
exact aggregate, failure/retry policy, cancellation/heartbeat/lease/race
tables, closed service contract, canonical compatibility vectors, named
divergences, and executable contract gate are admitted as one lifecycle model.
Roadmap 04's private Task System API and Postgres implementation are admitted
without activation. Roadmap 05 now owns the active scheduling work; later
files remain candidates:

1. [`01-source-reuse-and-package-admission.md`](./01-source-reuse-and-package-admission.md)
   - **complete: admit** the medium run-attempt lifecycle source closure into a
     future private `@flarex/durable-task` package, with provenance,
     compatibility, and executable boundary gates;
2. [`02-task-definition-identity-and-scope.md`](./02-task-definition-identity-and-scope.md)
   - **complete: admit:** private task definition, Standard Application stages,
     tenant/project/environment/deployment/scope resolution, revision,
     artifact binding, private domain identities, and DTE-IP01 command/store
     contracts; DTE02-A through DTE02-G are complete;
3. [`03-run-attempt-engine.md`](./03-run-attempt-engine.md)
   - **complete: admit:** DTE03-A through DTE03-G close the lifecycle model and
     authorize only the production-inert DTE-IP01 package transplant;
4. [`04-task-system-api-and-postgres.md`](./04-task-system-api-and-postgres.md)
   - **complete: admit; DTE04-A1 through DTE04-F complete:** domain-owned persisted
     aggregate/effect envelopes and the five-phase persistence projection are
     implemented and validated; the immutable input-reference, exact creation
     request/digest preimages, stable receipt, and typed conflict contract are
     also implemented, together with the private canonical Standard
     Application task catalog, immutable runtime binding, and separate
     creation-authority receipt. The five scope-qualified Drizzle tables,
     generated migration, constraints, indexes, and PGlite/real-Postgres
     migration proofs are complete. DTE04-B's scope-bound lifecycle adapter,
     transaction/error mapping, connected PGlite matrix, and focused
     real-Postgres writer-lock/database-time proof are implemented. The
     canonical lane executes 62 transition-derived histories plus one explicit
     near-overflow setup through the adapter and two invalid commands at the
     decoder boundary. DTE04-C adds the separate scope-bound creation
     capability, trusted binding/authority capture, exact initial aggregate,
     atomic creation identity, stable replay, typed conflict, run-ID collision
     retry, and connected PGlite concurrency/lifecycle proof. DTE04-D adds
     separate scope-bound due-discovery and requested-effect-ledger reads with
     stable bounded snapshots, canonical row correlation, and PGlite
     no-write/corruption/authority proofs. DTE04-E proves connected
     real-Postgres read, creation, lifecycle, race, rollback, plan, and
     uncertainty parity. DTE04-F closes provenance, package, migration,
     boundedness, and final-review admission. Delivery, host integration, and
     runtime activation remain closed;
5. [`05-cloudflare-wake-and-scheduling.md`](./05-cloudflare-wake-and-scheduling.md)
   - **active; DTE05-A through DTE05-D and DTE05-E1/E2 complete; C3 is blocked
     pending approval and E3 remains DTE06-F-gated:** standard scope-bound
     scheduler contracts, host-neutral
     bounded recovery, deterministic memory adapters, located-scope Postgres
     composition, trusted partition discovery, Queue hints, durable cron-repair
     semantics/checkpointing, optional alarm acceleration, and fail-closed
     admission. No scheduled Worker host or Cron Trigger is active;
6. [`06-compute-provider-and-runtime.md`](./06-compute-provider-and-runtime.md)
   - **active; DTE06-A through DTE06-E complete privately; DTE06-F preflight
     approved, F0A/F0B/F1 complete privately, and F2 blocked on DTE05-C3:** the
     provider-neutral contract, delivery evidence, fenced
     repository, bounded discovery, trusted directory, continuation, recovery,
     multi-scope runner, and Postgres deadline owners remain production-inert.
     The Standard Application publication chain now supplies authenticated task
     runtime objects, readiness/activation evidence, and exact located reads.
     The private Worker ABI/runtime core, exhaustive Legacy/Application launch
     authority, genuine Worker definitions, accepted-start session, and real
     `WorkerLoaderTaskComputeProvider` are implemented. The unversioned
     `ApplicationTaskSystem` and `ApplicationTaskComputeDelivery` composition
     connect authentic active Application selection through run creation,
     discovery, preparation, Source Artifact V2 loading, and exactly one
     accepted Application Worker start, with retained compositions remaining
     `legacy_only`. Preflight 41 fixes the approved terminal-outcome,
     interruption-provenance, result-store, heartbeat, cancellation, and
     fenced-settlement topology without changing the provider-neutral API.
     E1 implements the exact terminal contract and pure disposition; E2 adds
     the isolated immutable Task-result store; E3 adds the scope-bound
     Legacy/Application lifecycle gateway; and E4 adds an isolated bounded
     attempt supervisor. The current E5 slices now connect that supervisor
     in the real private Application delivery composition and prove successful
     durable settlement, real handler-failure retry settlement, exact
     cancellation delivery/acknowledgement, maximum-duration terminal timeout,
     authoritative stale-fence/lease-loss stops, and reconciled/unresolved R2
     settlement, exact lost-completion-response replay, and duplicate-delivery
     suppression. Its cancel/complete proof records exact acknowledgement when
     cancellation wins and `superseded_by_completion` when success wins.
     DTE06-F0A first converges the shared Application Worker runtime substrate
     and adds individually admitted authenticated Task capabilities without
     creating a universal provider. Its authenticated-user principal is
     scope-bound, immutably published, persisted, and reconstructed at launch.
     The current Application Task Worker receives distinct query and mutation
     RPC targets. `task(ctx, payload)` can call the existing selection-bound
     query core via `ctx.runQuery`, with the launch-bound user and per-call
     active-selection revalidation. Its private `ctx.runMutation` bridge now
     carries exact sequential ordinals through the generated Worker, accepted
     session host, supervised Worker Loader provider, absolute deadline,
     cancellation, and callback close/drain lifetime. The Worker drains even
     unawaited admitted mutation calls before terminal settlement; the host
     independently gates that settlement on callback revocation/drain and
     advertises the combined close bound. The separately gated Task
     mutation checkpoint also owns its
     strict private callback contract and the run-and-ordinal stable key plus
     exact-request commitment. Its Task-attempt external-effect authority now
     derives that stable key under an opaque current-attempt capability and
     owns prepared, dispatching, failed-before-dispatch, confirmed, uncertain,
     replay, and conflict transitions in the existing shared table. New
     issuance, preparation, and dispatch declaration require the authoritative
     database-time lease to remain live; post-dispatch reconciliation may run
     after expiry only while the same attempt and fence remain current. The
     existing Application mutation replay owner now also has an opaque
     principal-bound entry while retaining anonymous foreground invocation;
     both paths reuse its validation, grant, OCC, journal, commit, and replay
     core. The private mutation callback coordinator now uses one
     persistence-owned terminal reconciliation operation rather than separate
     process-local phase guesses. Its Task-specific located target installs
     database deadlines, advertises the settlement budget, and is rejected when
     that budget exceeds callback close.
     [Preflight 45](./preflight/45-dte06-task-mutation-settlement-reconciliation.md)
     owns the completed private persistence reconciliation and deadline gate.
     Genuine PostgreSQL settlement acceptance and the genuine connected Worker
     mutation proof now pass, closing DTE06-F0B privately. This composition
     remains test-only and production-inert.
     Outbound and scheduling context members remain deferred. F1 now provides the
     production-compatible private event host, hosted PGlite proof, and
     ordinary-role PostgreSQL counterpart around those current owners. F2 next
     proves fresh-host recovery and takeover without shared process state, but
     its preflight found that due discovery and scheduler composition remain
     Legacy-only and cannot advance an `application_v1` retry. Preflight 46
     records the bounded DTE05-C3 correction and prohibited harness
     workarounds. Real
     Cloudflare, Hyperdrive, and R2 resource mutation
     remains a separately approved later subgate. No scheduled host, public
     API, route, binding, fallback, dual execution, or production activation
     exists;
7. [`07-observability-live-apis-and-ui.md`](./07-observability-live-apis-and-ui.md)
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

Roadmap 01 identified the complete run-attempt lifecycle as the first
substantial connected Trigger capability. Its admitted package checkpoint is
large enough to exercise transition, failure, retry, cancellation, lease,
fence, service, Layer, and requested-effect seams while excluding persistence
implementation and host activation.

That first source map is not a blanket migration permit for scheduling,
delivery, compute, observability, or public Trigger capabilities. Each of those
closures must earn its own reuse decision before implementation. Existing
Flarex-authored foundations remain admitted, but they do not make a future
clean-room implementation the default.

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
